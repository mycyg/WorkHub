import assert from "node:assert/strict";
import test from "node:test";

import { createDriveRepository, isActivePathUniqueViolation } from "./repositories/drive.js";
import {
  createWorkItemRepository,
  resolveDriveFolderPath,
  WorkItemAcceptedDeliverableRestoreError
} from "./repositories/work-items.js";
import {
  acceptedDeliverableChanges,
  chatMessages,
  projectDriveComments,
  projectDriveItems,
  projectDriveOperations,
  projectDriveVersions,
  projects,
  workItems
} from "./schema/index.js";
import {
  createQueryRecorder,
  queryParamValues,
  queryReferences,
  queryTextFragments,
  type RecordedQuery
} from "./test-query-recorder.js";

const now = new Date("2026-07-04T00:00:00.000Z");
const projectId = "94000000-0000-4000-8000-000000000101";
const workspaceId = "94000000-0000-4000-8000-000000000001";
const workItemId = "94000000-0000-4000-8000-000000000201";
const actorUserId = "94000000-0000-4000-8000-000000000301";
const proposalId = "94000000-0000-4000-8000-000000000401";
const itemId = "94000000-0000-4000-8000-000000000501";
const versionId = "94000000-0000-4000-8000-000000000601";
const previousVersionId = "94000000-0000-4000-8000-000000000602";
const acceptedChangeId = "94000000-0000-4000-8000-000000000701";
const previousAcceptedChangeId = "94000000-0000-4000-8000-000000000702";

// Old assertions in this file read repository source and matched implementation text.
// That was wrong because the R9 redline requires tests to drive repository behavior.
// These tests call the real repositories and inspect returned rows plus recorded DB
// boundaries instead of treating source text as coverage.

function project() {
  return {
    id: projectId,
    workspaceId,
    ownerUserId: actorUserId,
    slug: "pilot",
    name: "Pilot",
    archived: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function projectLookupRow() {
  return { project: project(), orgId: null };
}

function driveComment(overrides: Record<string, unknown> = {}) {
  return {
    id: "94000000-0000-4000-8000-000000000801",
    projectId,
    folderId: null,
    authorUserId: actorUserId,
    body: "Please turn this Drive comment into a draft.",
    status: "draft_created",
    draftWorkItemId: workItemId,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function driveOperation(overrides: Record<string, unknown> = {}) {
  return {
    id: "94000000-0000-4000-8000-000000000901",
    projectId,
    actorUserId,
    opType: "draft_to_proposal",
    payloadJson: {
      drive_comment_id: "94000000-0000-4000-8000-000000000801",
      work_item_id: workItemId,
      proposal_id: proposalId
    },
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function driveItem(overrides: Record<string, unknown> = {}) {
  return {
    id: itemId,
    projectId,
    parentId: null,
    name: "report.md",
    kind: "file",
    currentVersionId: versionId,
    createdByUserId: actorUserId,
    updatedByUserId: actorUserId,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function driveVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: versionId,
    itemId,
    versionNo: 2,
    filename: "report.md",
    mime: "text/markdown",
    sizeBytes: 120,
    storagePath: "drive/report.md",
    sha256: "sha",
    parsedText: null,
    parsedTextPath: null,
    createdByUserId: actorUserId,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function acceptedChange(overrides: Record<string, unknown> = {}) {
  return {
    id: acceptedChangeId,
    workItemId,
    projectId,
    proposalId,
    branchId: null,
    changeId: "change-1",
    targetKind: "file",
    targetEntityType: "project_drive_item",
    targetEntityId: itemId,
    targetPath: "/report.md",
    targetKey: "file:/report.md",
    changeType: "update",
    acceptedVersion: 2,
    baseVersionRef: null,
    acceptedRef: null,
    driveItemId: itemId,
    driveVersionId: versionId,
    sha256Before: null,
    sha256After: "sha",
    previewRefJson: null,
    manifestChangeJson: { files: ["report.md"] },
    supersededAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function acceptedRow(overrides: {
  accepted?: Record<string, unknown>;
  driveItem?: Record<string, unknown> | null;
  driveVersion?: Record<string, unknown> | null;
} = {}) {
  return {
    accepted: acceptedChange(overrides.accepted),
    driveItem: overrides.driveItem === null ? null : driveItem(overrides.driveItem),
    driveVersion: overrides.driveVersion === null ? null : driveVersion(overrides.driveVersion)
  };
}

function queriesFrom(queries: RecordedQuery[], table: unknown) {
  return queries.filter((query) => query.fromTable === table);
}

function mutationsOn(queries: RecordedQuery[], table: unknown, operation?: "insert" | "update") {
  return queries.filter((query) =>
    query.targetTable === table && (operation ? query.operation === operation : true)
  );
}

function actorInput() {
  return { actorKind: "human" as const, actorUserId };
}

test("findings[#low] isActivePathUniqueViolation only matches the active-path unique index 23505", () => {
  assert.equal(
    isActivePathUniqueViolation({ code: "23505", constraint: "project_drive_items_active_path_uq" }),
    true
  );
  assert.equal(isActivePathUniqueViolation({ code: "23505", constraint: "some_other_uq" }), false);
  assert.equal(isActivePathUniqueViolation({ code: "23503" }), false);
  assert.equal(isActivePathUniqueViolation({ code: "23505" }), false);
  assert.equal(isActivePathUniqueViolation(new Error("boom")), false);
  assert.equal(isActivePathUniqueViolation(null), false);
});

// R24 S3：drizzle-orm 真实把裸 pg 错误包进 `.cause`（顶层没有 code/constraint）——上面那组测试用的
// 顶层塞 code 的假错误形状在生产里并不真实存在。这一条锁死 isActivePathUniqueViolation 也接得住
// 真实的嵌套包装，不只是接住测试自己编的形状。
test("R24 S3: isActivePathUniqueViolation also matches when the pg error is nested under drizzle-orm's `.cause`", () => {
  const pgDatabaseError = Object.assign(
    new Error('duplicate key value violates unique constraint "project_drive_items_active_path_uq"'),
    { code: "23505", constraint: "project_drive_items_active_path_uq" }
  );
  const drizzleQueryError = Object.assign(new Error('Failed query: insert into "project_drive_items" ...'), {
    cause: pgDatabaseError
  });

  assert.equal(isActivePathUniqueViolation(drizzleQueryError), true);
});

test("recordDraftProposal locks the drive comment before the idempotency gate", async () => {
  const existingOperation = driveOperation();
  const { db, queries } = createQueryRecorder([
    [driveComment({ status: "proposal_created" })],
    [projectLookupRow()],
    [existingOperation]
  ]);
  const repository = createDriveRepository(db);

  const result = await repository.recordDraftProposal({
    ...actorInput(),
    workItemId,
    proposalId
  });

  assert.equal(result?.operation, existingOperation);
  const commentIndex = queries.findIndex((query) => query.fromTable === projectDriveComments);
  const operationIndex = queries.findIndex((query) => query.fromTable === projectDriveOperations);
  const commentQuery = queries[commentIndex];
  assert.ok(commentIndex > -1 && operationIndex > commentIndex);
  assert.equal(commentQuery?.lock, "update");
  assert.ok(queryReferences(commentQuery?.where, projectDriveComments.draftWorkItemId));
});

test("recordDraftProposal does not resurrect dismissed drive comments", async () => {
  const { db, queries } = createQueryRecorder([
    [driveComment({ status: "dismissed" })],
    [projectLookupRow()],
    []
  ]);
  const repository = createDriveRepository(db);

  const result = await repository.recordDraftProposal({
    ...actorInput(),
    workItemId,
    proposalId
  });

  assert.equal(result, null);
  const update = mutationsOn(queries, projectDriveComments, "update")[0];
  assert.ok(update, "dismissed comments should only reach the guarded update");
  assert.ok(queryReferences(update.where, projectDriveComments.status));
  assert.deepEqual(
    queryParamValues(update.where).filter((value) => value === "draft_created" || value === "proposal_created"),
    ["draft_created", "proposal_created"]
  );
});

test("recordDraftProposal idempotency does not depend on the recent operations window", async () => {
  const { db, queries } = createQueryRecorder([
    [driveComment({ status: "proposal_created" })],
    [projectLookupRow()],
    [driveOperation()]
  ]);
  const repository = createDriveRepository(db);

  await repository.recordDraftProposal({
    ...actorInput(),
    workItemId,
    proposalId
  });

  const operationQuery = queries.find((query) => query.fromTable === projectDriveOperations);
  assert.equal(operationQuery?.limit, 1);
  assert.ok(queryReferences(operationQuery?.where, projectDriveOperations.payloadJson));
  assert.ok(queryReferences(operationQuery?.where, projectDriveOperations.opType));
});

test("commentToDraft locks and only claims pending drive comments", async () => {
  const newWorkItem = {
    id: workItemId,
    code: "PILOT-001",
    projectId,
    workspaceId,
    submitterUserId: actorUserId,
    title: "Please turn this Drive comment into a draft.",
    rawDescription: "Please turn this Drive comment into a draft.",
    summaryMd: "Please turn this Drive comment into a draft.",
    status: "ai_clarifying",
    priority: "normal",
    mode: "worker",
    humanReserved: false,
    planningNote: "source=drive_comment",
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
  const updatedComment = driveComment({ status: "draft_created", draftWorkItemId: workItemId });
  const { db, queries } = createQueryRecorder([
    [projectLookupRow()],
    [driveComment({ status: "pending_llm", draftWorkItemId: null })],
    [{ slug: "pilot", next_seq: 1 }],
    [],
    [newWorkItem],
    [],
    [updatedComment],
    [driveOperation({ opType: "comment_to_draft" })],
    [],
    []
  ]);
  const repository = createDriveRepository(db);

  const result = await repository.commentToDraft({
    ...actorInput(),
    projectId,
    commentId: "94000000-0000-4000-8000-000000000801"
  });

  assert.equal(result?.created, true);
  assert.equal(result?.workItem, newWorkItem);
  const commentQuery = queriesFrom(queries, projectDriveComments)[0];
  assert.equal(commentQuery?.lock, "update");
  const commentUpdate = mutationsOn(queries, projectDriveComments, "update")[0];
  assert.ok(queryReferences(commentUpdate?.where, projectDriveComments.status));
  assert.ok(queryReferences(commentUpdate?.where, projectDriveComments.draftWorkItemId));
  assert.ok(queryParamValues(commentUpdate?.where).includes("pending_llm"));
  assert.equal(mutationsOn(queries, workItems, "insert").length, 1);
  assert.equal(mutationsOn(queries, chatMessages, "insert").length, 1);
});

test("accepted deliverable restore creates a fresh current row for the requesting work item", async () => {
  const previousRow = acceptedRow({
    accepted: {
      id: previousAcceptedChangeId,
      acceptedVersion: 2,
      driveVersionId: previousVersionId,
      supersededAt: new Date("2026-07-03T00:00:00.000Z")
    },
    driveVersion: { id: previousVersionId, versionNo: 1 }
  });
  const restoredRow = acceptedRow({
    accepted: {
      id: "94000000-0000-4000-8000-000000000703",
      acceptedVersion: 4,
      driveVersionId: previousVersionId
    },
    driveVersion: { id: previousVersionId, versionNo: 1 }
  });
  const { db, queries } = createQueryRecorder([
    [{ projectId }],
    [],
    [acceptedRow({ accepted: { acceptedVersion: 3 } })],
    [previousRow],
    [{ id: itemId }],
    [],
    [],
    [],
    [],
    [],
    [restoredRow],
    [{ targetKey: "file:/report.md", projectId, workItemId, acceptedVersion: 2 }]
  ]);
  const repository = createWorkItemRepository(db);

  const result = await repository.restoreAcceptedDeliverable({
    ...actorInput(),
    workItemId,
    acceptedChangeId,
    at: now
  });

  assert.equal(result?.accepted.acceptedVersion, 4);
  const insert = mutationsOn(queries, acceptedDeliverableChanges, "insert")[0];
  const values = insert?.valuesValue as Record<string, unknown> | undefined;
  assert.equal(values?.workItemId, workItemId);
  assert.equal(values?.acceptedVersion, 4);
  assert.equal(values?.driveVersionId, previousVersionId);
  const operation = mutationsOn(queries, projectDriveOperations, "insert")[0]?.valuesValue as
    | { payloadJson?: Record<string, unknown> }
    | undefined;
  assert.equal(operation?.payloadJson?.source_accepted_change_id, previousAcceptedChangeId);
});

test("accepted deliverable restore reports a superseded current id as version changed", async () => {
  const { db } = createQueryRecorder([
    [{ projectId }],
    [],
    [],
    [{ supersededAt: now }]
  ]);
  const repository = createWorkItemRepository(db);

  await assert.rejects(
    repository.restoreAcceptedDeliverable({
      ...actorInput(),
      workItemId,
      acceptedChangeId,
      at: now
    }),
    (error) =>
      error instanceof WorkItemAcceptedDeliverableRestoreError &&
      error.code === "deliverable_version_changed"
  );
});

test("drive page readPage limits current accepted rows while backfilling superseded rows for loaded version labels", async () => {
  const historical = acceptedRow({
    accepted: {
      id: previousAcceptedChangeId,
      acceptedVersion: 1,
      supersededAt: new Date("2026-07-03T00:00:00.000Z")
    }
  });
  const { db, queries } = createQueryRecorder([
    [projectLookupRow()],
    [driveItem()],
    [{ version: driveVersion() }],
    [acceptedRow()],
    [],
    [],
    [{ kind: "file", value: 1 }],
    [{ value: 1 }],
    [{ value: 1 }],
    [{ value: 0 }],
    [{ value: 0 }],
    [{ value: 0 }],
    [],
    [],
    [historical],
    [{ targetKey: "file:/report.md", projectId, workItemId, acceptedVersion: 1 }],
    []
  ]);
  const repository = createDriveRepository(db);

  const page = await repository.readPage({ projectId, limit: 1 });

  assert.deepEqual(
    page.acceptedDeliverables.map((row) => row.accepted.id),
    [acceptedChangeId, previousAcceptedChangeId]
  );
  assert.equal(page.acceptedDeliverables[0]?.canRestore, true);

  const acceptedQueries = queriesFrom(queries, acceptedDeliverableChanges);
  const currentListQuery = acceptedQueries[0];
  assert.equal(currentListQuery?.limit, 1);
  assert.ok(queryReferences(currentListQuery?.where, acceptedDeliverableChanges.supersededAt));
  // R9 branch-review fix-batch2-3：历史采纳标记按 drive_version_id 分区取每版本最新一条，
  // 配额与版本数一一对应，不再用 loadedVersionIds*2 的粗 limit 让历史行挤占名额。
  const rankedSubquery = acceptedQueries.find((query) => query.steps.includes("as"));
  assert.ok(rankedSubquery, "historical accepted rows should be deduped per version via a ranked subquery");
  assert.match(queryTextFragments(rankedSubquery.selection).join(""), /row_number\(\) over \(partition by/u);
  assert.ok(queryReferences(rankedSubquery.where, acceptedDeliverableChanges.driveVersionId));
  assert.ok(queryReferences(rankedSubquery.where, acceptedDeliverableChanges.supersededAt));
  const historicalOuter = queries.find((query) =>
    (query.fromTable as { __alias?: string } | undefined)?.__alias === "ranked_historical_accepted_deliverables"
  );
  assert.ok(historicalOuter, "outer backfill should read rank-1 rows from the ranked subquery");
  // eq(子查询列, 1) 的字面量会被 drizzle 内联进 queryChunks 而非 Param，直接断言 chunks。
  const outerWhereChunks = (historicalOuter.where as { queryChunks?: unknown[] } | undefined)?.queryChunks ?? [];
  assert.ok(outerWhereChunks.some((chunk) =>
    (chunk as { __subqueryAlias?: string; name?: string } | null)?.__subqueryAlias === "ranked_historical_accepted_deliverables"
    && (chunk as { name?: string }).name === "rowNumber"
  ));
  assert.ok(outerWhereChunks.includes(1));
});

test("drive page readPage blocks child restore links when the deleted parent is outside the loaded slice", async () => {
  const deletedParentId = "94000000-0000-4000-8000-000000000511";
  const deletedChild = driveItem({
    id: "94000000-0000-4000-8000-000000000512",
    parentId: deletedParentId,
    name: "child.md",
    deletedAt: now,
    currentVersionId: null
  });
  const { db, queries } = createQueryRecorder([
    [projectLookupRow()],
    [],
    [deletedChild],
    [],
    [],
    [],
    [{ kind: "file", value: 0 }],
    [{ value: 0 }],
    [{ value: 0 }],
    [{ value: 0 }],
    [{ value: 2 }],
    [{ value: 0 }],
    [],
    [],
    []
  ]);
  const repository = createDriveRepository(db);

  const page = await repository.readPage({
    projectId,
    includeDeleted: true,
    limit: 1
  });

  assert.deepEqual(page.restoreBlockedItemIds, [deletedChild.id]);
  const parentBatchQuery = queries.find((query) =>
    query.fromTable === projectDriveItems &&
    queryReferences(query.where, projectDriveItems.id) &&
    queryReferences(query.where, projectDriveItems.projectId) &&
    query.limit === undefined
  );
  assert.ok(parentBatchQuery, "restore blocking should batch-load parent rows inside the project");
});

test("softDeleteItem folder emptiness checks only same-project active children", async () => {
  const folder = driveItem({ kind: "folder", currentVersionId: null });
  const { db, queries } = createQueryRecorder([
    [projectLookupRow()],
    [folder],
    [],
    [{ id: "94000000-0000-4000-8000-000000000513" }]
  ]);
  const repository = createDriveRepository(db);

  await assert.rejects(
    repository.softDeleteItem({
      ...actorInput(),
      projectId,
      itemId,
      at: now
    }),
    { code: "drive_folder_not_empty" }
  );

  const childQuery = queries.find((query) =>
    query.fromTable === projectDriveItems &&
    query.limit === 1 &&
    queryReferences(query.where, projectDriveItems.parentId)
  );
  assert.ok(childQuery, "folder emptiness check should query active children");
  assert.ok(queryReferences(childQuery.where, projectDriveItems.projectId));
  assert.ok(queryReferences(childQuery.where, projectDriveItems.deletedAt));
});

test("recent project files only expose accepted work items for the current file version", async () => {
  const { db, queries } = createQueryRecorder([
    [{ id: itemId, name: "report.md", updatedAt: now, currentVersionId: versionId }],
    [{ driveItemId: itemId, workItemId }]
  ]);
  const repository = createDriveRepository(db);

  const files = await repository.listRecentFilesByProject(projectId, 5);

  assert.deepEqual(files, [{
    id: itemId,
    name: "report.md",
    updatedAt: now,
    acceptedWorkItemIds: [workItemId]
  }]);
  const acceptedQuery = queriesFrom(queries, acceptedDeliverableChanges)[0];
  assert.ok(queryReferences(acceptedQuery?.where, acceptedDeliverableChanges.driveItemId));
  assert.ok(queryReferences(acceptedQuery?.where, acceptedDeliverableChanges.driveVersionId));
  assert.ok(queryReferences(acceptedQuery?.where, acceptedDeliverableChanges.supersededAt));
});

type Node = { id: string; parentId: string | null; name: string };

function mapFetch(nodes: Node[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return async (id: string) => byId.get(id);
}

test("findings[#24] resolveDriveFolderPath walks the parent chain (bounded, no full project scan)", async () => {
  const nodes: Node[] = [
    { id: "a", parentId: null, name: "a" },
    { id: "b", parentId: "a", name: "b" },
    { id: "c", parentId: "b", name: "c" }
  ];
  assert.equal(await resolveDriveFolderPath(nodes[2]!, mapFetch(nodes)), "/a/b/c");
});

test("resolveDriveFolderPath returns /name for a root folder", async () => {
  const root: Node = { id: "r", parentId: null, name: "root" };
  assert.equal(await resolveDriveFolderPath(root, mapFetch([root])), "/root");
});

test("resolveDriveFolderPath stops if a parent row is missing", async () => {
  const leaf: Node = { id: "x", parentId: "gone", name: "x" };
  assert.equal(await resolveDriveFolderPath(leaf, mapFetch([leaf])), "/x");
});

test("resolveDriveFolderPath caps depth at 50 levels", async () => {
  const nodes: Node[] = [];
  for (let i = 0; i < 60; i += 1) {
    nodes.push({ id: `n${i}`, parentId: i === 0 ? null : `n${i - 1}`, name: `n${i}` });
  }
  const path = await resolveDriveFolderPath(nodes[59]!, mapFetch(nodes));
  assert.equal(path.split("/").filter(Boolean).length, 50);
});

test("resolveDriveFolderPath breaks parent cycles instead of looping forever", async () => {
  const nodes: Node[] = [
    { id: "a", parentId: "b", name: "a" },
    { id: "b", parentId: "a", name: "b" }
  ];
  assert.equal(await resolveDriveFolderPath(nodes[0]!, mapFetch(nodes)), "/b/a");
});
