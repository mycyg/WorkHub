import assert from "node:assert/strict";
import test from "node:test";

import { createDriveRepository, DriveRepositoryConflictError } from "./repositories/drive.js";
import {
  auditLogs,
  projectDriveItems,
  projectDriveOperations,
  projectDriveVersions,
  users
} from "./schema/index.js";
import { createQueryRecorder, queryReferences } from "./test-query-recorder.js";

// R12 批 6（网盘整合 + git 化）：packages/db drive 仓库新增的两个只读/回滚方法——
// listVersionsForItem（单文件版本历史，带操作者昵称）与 rollbackToVersion（回滚=追加新版本，不抹历史）。
// 这两个方法在 DriveRepository 类型上是可选字段（见 repositories/drive.ts 顶部注释），
// 不强迫既有测试里的几十个 DriveRepository 假对象字面量跟着补桩。

const projectId = "91000000-0000-4000-8000-000000000301";
const workspaceId = "91000000-0000-4000-8000-000000000302";
const itemId = "91000000-0000-4000-8000-000000000303";
const currentVersionId = "91000000-0000-4000-8000-000000000304";
const previousVersionId = "91000000-0000-4000-8000-000000000305";
const actorUserId = "91000000-0000-4000-8000-000000000306";
const newVersionId = "91000000-0000-4000-8000-000000000307";

function projectRow() {
  return {
    id: projectId,
    orgId: null,
    workspaceId,
    name: "Drive versions project",
    code: "DRIVEV",
    archived: false,
    deletedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z")
  };
}

function itemRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: itemId,
    projectId,
    parentId: null,
    name: "report.md",
    kind: "file",
    currentVersionId,
    createdByUserId: actorUserId,
    updatedByUserId: actorUserId,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides
  };
}

function versionRow(id: string, versionNo: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    itemId,
    versionNo,
    filename: "report.md",
    mime: "text/markdown",
    sizeBytes: 100 + versionNo,
    storagePath: `drive/${projectId}/${itemId}/${id}/report.md`,
    sha256: id.replace(/-/gu, "").padEnd(64, "0"),
    parsedText: null,
    parsedTextPath: null,
    createdByUserId: actorUserId,
    createdAt: new Date(`2026-07-0${versionNo}T00:00:00.000Z`),
    updatedAt: new Date(`2026-07-0${versionNo}T00:00:00.000Z`),
    ...overrides
  };
}

test("listVersionsForItem returns version history with operator label in a fixed number of queries (no N+1)", async () => {
  const versions = [
    { version: versionRow(currentVersionId, 2), createdByLabel: "Amber" },
    { version: versionRow(previousVersionId, 1), createdByLabel: "Amber" }
  ];
  const responses = [
    [{ project: projectRow(), orgId: null }],
    [itemRow()],
    versions
  ];
  const { db, queries } = createQueryRecorder(responses);
  const repository = createDriveRepository(db);

  const result = await repository.listVersionsForItem!({ projectId, itemId, limit: 10 });

  assert.ok(result);
  assert.equal(result!.item.id, itemId);
  assert.deepEqual(result!.versions.map((row) => row.id), [currentVersionId, previousVersionId]);
  assert.deepEqual(result!.versions.map((row) => row.createdByLabel), ["Amber", "Amber"]);
  // 恰好三条查询（project / item / versions join users），版本数增长不应触发额外查询。
  assert.equal(queries.length, 3);
  const versionsQuery = queries.find((query) => query.fromTable === projectDriveVersions);
  assert.ok(versionsQuery, "must query project_drive_versions");
  assert.ok(versionsQuery!.joins.some((join) => join.table === users), "must join users for the operator label");
  assert.ok(queryReferences(versionsQuery!.where, projectDriveItems.id) || queryReferences(versionsQuery!.where, projectDriveVersions.itemId));
  assert.equal(versionsQuery!.limit, 10);
});

test("listVersionsForItem clamps an out-of-range limit into [1, 200]", async () => {
  const responses = [
    [{ project: projectRow(), orgId: null }],
    [itemRow()],
    []
  ];
  const { db, queries } = createQueryRecorder(responses);
  const repository = createDriveRepository(db);

  await repository.listVersionsForItem!({ projectId, itemId, limit: 100_000 });

  const versionsQuery = queries.find((query) => query.fromTable === projectDriveVersions);
  assert.equal(versionsQuery!.limit, 200);
});

test("listVersionsForItem returns null when the project does not exist (short-circuits before touching versions)", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const repository = createDriveRepository(db);

  const result = await repository.listVersionsForItem!({ projectId, itemId });

  assert.equal(result, null);
  assert.equal(queries.length, 1, "must not query drive items/versions once the project lookup misses");
});

test("listVersionsForItem returns null when the item does not exist or is a folder", async () => {
  const responses = [
    [{ project: projectRow(), orgId: null }],
    []
  ];
  const { db, queries } = createQueryRecorder(responses);
  const repository = createDriveRepository(db);

  const result = await repository.listVersionsForItem!({ projectId, itemId });

  assert.equal(result, null);
  assert.equal(queries.length, 2, "must not query project_drive_versions once the item lookup misses");
});

test("rollbackToVersion appends a new version copying the target's stored content, without deleting history", async () => {
  const target = versionRow(previousVersionId, 1, { filename: "report-v1.md", sizeBytes: 111, sha256: "b".repeat(64) });
  const insertedVersion = { ...target, id: newVersionId, versionNo: 3, createdByUserId: actorUserId, createdAt: new Date("2026-07-05T00:00:00.000Z") };
  const updatedItem = itemRow({ currentVersionId: newVersionId, updatedByUserId: actorUserId });
  const operationRow = {
    id: "91000000-0000-4000-8000-000000000308",
    projectId,
    actorUserId,
    opType: "restore_version",
    payloadJson: { drive_item_id: itemId },
    undoneAt: null,
    createdAt: new Date("2026-07-05T00:00:00.000Z"),
    updatedAt: new Date("2026-07-05T00:00:00.000Z")
  };
  const responses = [
    [{ project: projectRow(), orgId: null }], // findProject
    [itemRow()], // item lookup (FOR UPDATE)
    [target], // target version lookup
    [{ versionNo: target.versionNo }], // nextVersionNoForItem's select
    [insertedVersion], // insert projectDriveVersions .returning()
    [updatedItem], // update projectDriveItems .returning()
    [operationRow], // insert projectDriveOperations .returning()
    [] // insert auditLogs (no .returning())
  ];
  const { db, queries, transactions } = createQueryRecorder(responses);
  const repository = createDriveRepository(db);

  const result = await repository.rollbackToVersion!({
    actorKind: "human",
    actorUserId,
    projectId,
    itemId,
    targetVersionId: previousVersionId,
    at: new Date("2026-07-05T00:00:00.000Z")
  });

  assert.ok(result);
  assert.equal(result!.item.currentVersionId, newVersionId);
  assert.equal(result!.version!.id, newVersionId);
  assert.equal(result!.version!.filename, "report-v1.md");
  assert.equal(result!.version!.storagePath, target.storagePath, "rollback must point at the same immutable storage path, not copy bytes");
  assert.equal(result!.operation.opType, "restore_version");
  assert.equal(transactions.at(-1)?.outcome, "resolved");

  // 没有任何一条查询删除/修改历史版本行——只 insert 一条新版本 + update item 指针。
  const versionDeletes = queries.filter((query) => query.operation !== "select" && query.targetTable === projectDriveVersions && query.steps.includes("set"));
  assert.equal(versionDeletes.length, 0, "rollback must never mutate a historical version row");
  const auditInsert = queries.find((query) => query.targetTable === auditLogs);
  assert.ok(auditInsert, "rollback must write an audit log entry");
  const operationInsert = queries.find((query) => query.targetTable === projectDriveOperations);
  assert.ok(operationInsert, "rollback must write a drive operation entry");
});

test("rollbackToVersion refuses to roll back onto the version that is already current", async () => {
  const responses = [
    [{ project: projectRow(), orgId: null }],
    [itemRow({ currentVersionId })],
    [versionRow(currentVersionId, 2)]
  ];
  const { db, queries, transactions } = createQueryRecorder(responses);
  const repository = createDriveRepository(db);

  await assert.rejects(
    () => repository.rollbackToVersion!({
      actorKind: "human",
      actorUserId,
      projectId,
      itemId,
      targetVersionId: currentVersionId
    }),
    (error: unknown) => error instanceof DriveRepositoryConflictError && error.code === "drive_version_is_current"
  );

  // 抛错之前绝不能已经 insert 新版本——只应发生 3 条查询（project/item/target version)。
  assert.equal(queries.length, 3);
  assert.equal(transactions.at(-1)?.outcome, "rejected");
});

test("rollbackToVersion returns null when the target version does not belong to this item", async () => {
  const responses = [
    [{ project: projectRow(), orgId: null }],
    [itemRow()],
    [] // target version lookup misses (wrong item / deleted / bad id)
  ];
  const { db, queries } = createQueryRecorder(responses);
  const repository = createDriveRepository(db);

  const result = await repository.rollbackToVersion!({
    actorKind: "human",
    actorUserId,
    projectId,
    itemId,
    targetVersionId: "91000000-0000-4000-8000-0000000000ff"
  });

  assert.equal(result, null);
  assert.equal(queries.length, 3, "must not insert anything once the target version lookup misses");
});

test("rollbackToVersion returns null when the item is missing, deleted, or a folder", async () => {
  const responses = [
    [{ project: projectRow(), orgId: null }],
    [itemRow({ deletedAt: new Date("2026-07-02T00:00:00.000Z") })]
  ];
  const { db, queries } = createQueryRecorder(responses);
  const repository = createDriveRepository(db);

  const result = await repository.rollbackToVersion!({
    actorKind: "human",
    actorUserId,
    projectId,
    itemId,
    targetVersionId: previousVersionId
  });

  assert.equal(result, null);
  assert.equal(queries.length, 2, "must not query versions once the item is deleted");
});

// ——— R12 E-01（人工验收打回）：同 parent 下重名上传此前直接 409，用户没有出路。
// uploadFile 现在对撞上的【活跃文件】追加新版本（沿用上面 rollbackToVersion 的追加先例：insert 新
// version 行 + 更新 item.currentVersionId 指针 + operations/audit 留痕，历史版本不删/不改）。撞的若是
// 文件夹仍然 409——不能把版本挂在文件夹名下。———

test("uploadFile appends a new version instead of 409ing when an active file with the same name already exists", async () => {
  const existingItem = itemRow();
  const insertedVersion = versionRow(newVersionId, 3, { filename: "report.md", sizeBytes: 555, sha256: "c".repeat(64) });
  const updatedItem = itemRow({ currentVersionId: newVersionId, updatedByUserId: actorUserId });
  const operationRow = {
    id: "91000000-0000-4000-8000-000000000309",
    projectId,
    actorUserId,
    opType: "upload_file",
    payloadJson: { drive_item_id: itemId },
    undoneAt: null,
    createdAt: new Date("2026-07-06T00:00:00.000Z"),
    updatedAt: new Date("2026-07-06T00:00:00.000Z")
  };
  const responses = [
    [{ project: projectRow(), orgId: null }], // findProject
    [existingItem], // activeItemByName (name-conflict precheck)
    [existingItem], // FOR UPDATE re-lock inside appendUploadedVersion
    [{ versionNo: 2 }], // nextVersionNoForItem
    [insertedVersion], // insert projectDriveVersions .returning()
    [updatedItem], // update projectDriveItems .returning()
    [operationRow], // insert projectDriveOperations .returning()
    [] // insert auditLogs (no .returning())
  ];
  const { db, queries, transactions } = createQueryRecorder(responses);
  const repository = createDriveRepository(db);

  const result = await repository.uploadFile({
    actorKind: "human",
    actorUserId,
    projectId,
    filename: "report.md",
    mime: "text/markdown",
    sizeBytes: 555,
    sha256: "c".repeat(64),
    at: new Date("2026-07-06T00:00:00.000Z")
  });

  assert.ok(result, "same-name upload onto an active file must succeed, not throw");
  assert.equal(result!.item.currentVersionId, newVersionId, "item now points at the freshly appended version");
  assert.equal(result!.version!.id, newVersionId);
  assert.equal(result!.version!.versionNo, 3, "version number increments off the item's existing history, not reset to 1");
  assert.equal(result!.operation.opType, "upload_file");
  assert.equal(transactions.at(-1)?.outcome, "resolved");

  // 没有任何一条查询删除/修改历史版本行——只 insert 一条新版本 + update item 指针。
  const versionMutations = queries.filter(
    (query) => query.targetTable === projectDriveVersions && query.steps.includes("set")
  );
  assert.equal(versionMutations.length, 0, "re-upload must never mutate/delete a historical version row");
  const versionInserts = queries.filter(
    (query) => query.targetTable === projectDriveVersions && query.steps.includes("values")
  );
  assert.equal(versionInserts.length, 1, "re-upload appends exactly one new version row");
  const itemUpdates = queries.filter(
    (query) => query.targetTable === projectDriveItems && query.steps.includes("set")
  );
  assert.equal(itemUpdates.length, 1, "exactly one pointer update to the item's currentVersionId");
  const auditInsert = queries.find((query) => query.targetTable === auditLogs);
  assert.ok(auditInsert, "re-upload must still write an audit log entry");
  const operationInsert = queries.find((query) => query.targetTable === projectDriveOperations);
  assert.ok(operationInsert, "re-upload must still write a drive operation entry");
});

test("uploadFile still rejects with a 409 name conflict when the same-name active entry is a folder", async () => {
  const folderItem = { ...itemRow(), kind: "folder", currentVersionId: null };
  const responses = [
    [{ project: projectRow(), orgId: null }], // findProject
    [folderItem] // activeItemByName
  ];
  const { db, queries, transactions } = createQueryRecorder(responses);
  const repository = createDriveRepository(db);

  await assert.rejects(
    () =>
      repository.uploadFile({
        actorKind: "human",
        actorUserId,
        projectId,
        filename: "report.md",
        sizeBytes: 10
      }),
    (error: unknown) => error instanceof DriveRepositoryConflictError && error.code === "drive_name_conflict"
  );

  // 撞的是文件夹——在锁/建版本之前就必须拒绝，不能把版本挂在文件夹名下。
  assert.equal(queries.length, 2, "must reject before ever locking a target item once the collision is a folder");
  assert.equal(transactions.at(-1)?.outcome, "rejected");
});

test("uploadFile still creates a brand-new item+version when no active item shares the name", async () => {
  const createdItem = itemRow({ id: "91000000-0000-4000-8000-00000000030a", currentVersionId: newVersionId });
  const createdVersion = versionRow(newVersionId, 1, { filename: "new-report.md" });
  const operationRow = {
    id: "91000000-0000-4000-8000-00000000030b",
    projectId,
    actorUserId,
    opType: "upload_file",
    payloadJson: { drive_item_id: createdItem.id },
    undoneAt: null,
    createdAt: new Date("2026-07-06T00:00:00.000Z"),
    updatedAt: new Date("2026-07-06T00:00:00.000Z")
  };
  const responses = [
    [{ project: projectRow(), orgId: null }], // findProject
    [], // activeItemByName misses — no active namesake
    [createdItem], // insert projectDriveItems .returning()
    [createdVersion], // insert projectDriveVersions .returning()
    [operationRow], // insert projectDriveOperations .returning()
    [] // insert auditLogs (no .returning())
  ];
  const { db, transactions } = createQueryRecorder(responses);
  const repository = createDriveRepository(db);

  const result = await repository.uploadFile({
    actorKind: "human",
    actorUserId,
    projectId,
    filename: "new-report.md",
    sizeBytes: 42,
    at: new Date("2026-07-06T00:00:00.000Z")
  });

  assert.ok(result);
  assert.equal(result!.version!.versionNo, 1, "brand-new file still starts at version 1");
  assert.equal(transactions.at(-1)?.outcome, "resolved");
});

test("uploadFile treats a same-name active file that gets soft-deleted between the precheck and the row lock as a conflict, not a silent new item", async () => {
  const raceItem = { ...itemRow(), deletedAt: new Date("2026-07-06T00:00:00.000Z") };
  const responses = [
    [{ project: projectRow(), orgId: null }], // findProject
    [itemRow()], // activeItemByName (precheck sees it active)
    [raceItem] // FOR UPDATE re-lock sees it now soft-deleted (concurrent race)
  ];
  const { db, queries, transactions } = createQueryRecorder(responses);
  const repository = createDriveRepository(db);

  await assert.rejects(
    () =>
      repository.uploadFile({
        actorKind: "human",
        actorUserId,
        projectId,
        filename: "report.md",
        sizeBytes: 10
      }),
    (error: unknown) => error instanceof DriveRepositoryConflictError && error.code === "drive_name_conflict"
  );

  assert.equal(queries.length, 3, "must reject right after the lock re-check, without inserting a version");
  assert.equal(transactions.at(-1)?.outcome, "rejected");
});
