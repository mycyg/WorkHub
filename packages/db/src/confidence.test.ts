import assert from "node:assert/strict";
import test from "node:test";

import { createAiDecisionRepository } from "./repositories/confidence.js";
import { escalationEvents, workItems } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences, queryTextFragments } from "./test-query-recorder.js";

const workspaceId = "94000000-0000-4000-8000-000000000201";

test("R9.7 unresolved escalation listing excludes legacy null-workspace rows", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const repository = createAiDecisionRepository(db);

  await repository.listUnresolvedEscalationsForWorkspace({ workspaceId, limit: 7 });

  assert.equal(queries.length, 1);
  const [query] = queries;
  assert.equal(query?.fromTable, escalationEvents);
  assert.deepEqual(query?.joins.map((join) => [join.kind, join.table]), [
    ["inner", workItems]
  ]);
  assert.equal(query?.limit, 7);
  assert.ok(queryReferences(query?.where, escalationEvents.resolvedAt));
  assert.ok(queryReferences(query?.where, workItems.deletedAt));
  assert.ok(queryReferences(query?.where, workItems.workspaceId));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
  assert.equal(
    queryTextFragments(query?.where).filter((fragment) => fragment === " is null").length,
    2,
    "only unresolved escalation and live work-item null checks are allowed; workspace null rows must not match"
  );
});
