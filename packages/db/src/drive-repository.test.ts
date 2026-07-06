import assert from "node:assert/strict";
import test from "node:test";

import { createDriveRepository } from "./repositories/drive.js";
import {
  acceptedDeliverableChanges,
  projectDriveItems,
  projects
} from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences, queryTextFragments } from "./test-query-recorder.js";

const projectId = "91000000-0000-4000-8000-000000000101";
const workspaceId = "91000000-0000-4000-8000-000000000102";
const itemId = "91000000-0000-4000-8000-000000000103";

function projectRow() {
  return {
    id: projectId,
    orgId: null,
    workspaceId,
    name: "Drive project",
    code: "DRIVE",
    archived: false,
    deletedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z")
  };
}

function driveItem(currentVersionId: string) {
  return {
    id: itemId,
    projectId,
    parentId: null,
    name: "accepted.md",
    kind: "file",
    mime: "text/markdown",
    sizeBytes: 120,
    currentVersionId,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z")
  };
}

function driveVersion(id: string, versionNo: number) {
  return {
    id,
    itemId,
    versionNo,
    storagePath: `/tmp/${id}.md`,
    sha256: id,
    sizeBytes: 120 + versionNo,
    mime: "text/markdown",
    parsedTextPath: null,
    createdByUserId: null,
    createdAt: new Date(`2026-07-01T00:0${versionNo}:00.000Z`)
  };
}

// Old assertions regexed repositories/drive.ts. That was wrong because the risk is the
// repository issuing a capped historical-marker query, not the source containing a phrase.
test("drive readPage fetches the latest historical accepted marker per loaded version", async () => {
  const versions = [
    driveVersion("91000000-0000-4000-8000-000000000201", 1),
    driveVersion("91000000-0000-4000-8000-000000000202", 2),
    driveVersion("91000000-0000-4000-8000-000000000203", 3)
  ];
  const item = driveItem(versions[2]!.id);
  const responses = [
    [projectRow()],
    [item],
    versions.map((version) => ({ version })),
    [],
    [],
    [],
    [{ kind: "file", value: 1 }],
    [{ value: versions.length }],
    [{ value: 0 }],
    [{ value: 0 }],
    [{ value: 0 }],
    [{ value: 0 }],
    [],
    [],
    [],
    []
  ];
  const { db, queries } = createQueryRecorder(responses);
  const repository = createDriveRepository(db);

  await repository.readPage({ projectId, limit: 3 });

  const rankedHistoricalQuery = queries.find((query) => {
    const fragments = queryTextFragments(query.selection).join(" ");
    return query.fromTable === acceptedDeliverableChanges
      && queryReferences(query.where, acceptedDeliverableChanges.driveVersionId)
      && /row_number\(\) over/iu.test(fragments);
  });
  assert.ok(rankedHistoricalQuery, "historical accepted markers must be ranked inside the DB query");
  assert.equal(rankedHistoricalQuery.limit, undefined);
  const rankingSql = queryTextFragments(rankedHistoricalQuery.selection).join(" ");
  assert.match(rankingSql, /partition by/iu);
  assert.ok(queryReferences(rankedHistoricalQuery.selection, acceptedDeliverableChanges.driveVersionId));
  assert.ok(queryReferences(rankedHistoricalQuery.selection, acceptedDeliverableChanges.createdAt));

  const heuristicLimitQuery = queries.find((query) =>
    query.fromTable === acceptedDeliverableChanges
    && queryReferences(query.where, acceptedDeliverableChanges.driveVersionId)
    && query.limit === versions.length * 2
  );
  assert.equal(heuristicLimitQuery, undefined, "historical marker query must not cap by versionIds.length * 2");
  assert.ok(
    queries.some((query) => queryReferences(query.where, projectDriveItems.id)),
    "readPage still scopes marker candidates through loaded drive items"
  );
  const rankedParams = queryParamValues(rankedHistoricalQuery.where)
    .flatMap((value) => Array.isArray(value) ? value : [value]);
  for (const version of versions) {
    assert.ok(rankedParams.includes(version.id), "readPage still scopes marker candidates through loaded drive versions");
  }
  assert.ok(
    queries.some((query) => query.fromTable === projects),
    "test exercises the public readPage repository path"
  );
});
