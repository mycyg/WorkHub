import assert from "node:assert/strict";
import test from "node:test";

import { createUserMemoryRepository, type UserMemoryRow } from "./repositories/user-memory.js";
import { userMemories } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

const userId = "84000000-0000-4000-8000-000000000001";
const workspaceId = "84000000-0000-4000-8000-000000000002";

function row(over: Partial<UserMemoryRow>): UserMemoryRow {
  return {
    id: "84000000-0000-4000-8000-000000000101",
    userId,
    workspaceId,
    category: "preference",
    key: "style",
    valueMd: "回复要简洁。",
    confidence: 0.8,
    sourceRunId: null,
    lastUsedAt: null,
    expiresAt: null,
    deletedAt: null,
    createdAt: new Date("2026-07-03T00:00:00.000Z"),
    updatedAt: new Date("2026-07-03T00:00:00.000Z"),
    ...over
  } as UserMemoryRow;
}

test("upsert lookup scopes L2 memories by workspace before updating", async () => {
  const existing = row({ valueMd: "旧偏好。" });
  const updated = row({ valueMd: "新偏好。", confidence: 0.9 });
  const { db, queries } = createQueryRecorder([[existing], [updated]]);

  const repository = createUserMemoryRepository(db);
  const result = await repository.upsert({
    userId,
    workspaceId,
    category: "preference",
    key: "style",
    valueMd: "新偏好。",
    confidence: 0.9
  });

  assert.equal(result.valueMd, "新偏好。");
  const lookup = queries[0];
  assert.equal(lookup?.operation, "select");
  assert.deepEqual(queryParamValues(lookup?.where).slice(0, 4), [userId, workspaceId, "preference", "style"]);
});

test("R9.7 upsert update keeps the L2 memory workspace fence", async () => {
  const existing = row({ valueMd: "旧偏好。" });
  const updated = row({ valueMd: "新偏好。", confidence: 0.9 });
  const { db, queries } = createQueryRecorder([[existing], [updated]]);

  const repository = createUserMemoryRepository(db);
  await repository.upsert({
    userId,
    workspaceId,
    category: "preference",
    key: "style",
    valueMd: "新偏好。",
    confidence: 0.9
  });

  const update = queries.find((query) => query.operation === "update");
  assert.equal(update?.targetTable, userMemories);
  assert.ok(queryReferences(update?.where, userMemories.id));
  assert.ok(queryReferences(update?.where, userMemories.workspaceId));
  assert.deepEqual(queryParamValues(update?.where).slice(0, 2), [existing.id, workspaceId]);
});

test("listForUser injects only global and current-workspace L2 memories", async () => {
  const { db, queries } = createQueryRecorder([[row({}), row({ id: "84000000-0000-4000-8000-000000000102", workspaceId: null })]]);
  const repository = createUserMemoryRepository(db);

  await repository.listForUser(userId, {
    workspaceId,
    categories: ["preference"],
    limit: 8
  });

  const query = queries[0];
  assert.equal(query?.operation, "select");
  assert.ok(queryParamValues(query?.where).includes(userId));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
  assert.ok(queryParamValues(query?.where).includes("preference"));
  // B-R9.3-3 shadow 去重：带 workspaceId 时 SQL limit 放大一倍（同 key 至多工作区+全局两行），
  // JS 层按工作区行优先去重后再截回 limit。
  assert.equal(query?.limit, 16);
});

test("R9.7 touch marks only visible L2 memories as used", async () => {
  const touchedAt = new Date("2026-07-03T00:10:00.000Z");
  const { db, queries } = createQueryRecorder([[]]);
  const repository = createUserMemoryRepository(db);

  await repository.touch(["84000000-0000-4000-8000-000000000101"], touchedAt, { workspaceId });

  const update = queries[0];
  assert.equal(update?.targetTable, userMemories);
  assert.ok(queryReferences(update?.where, userMemories.id));
  assert.ok(queryReferences(update?.where, userMemories.workspaceId));
  assert.deepEqual(queryParamValues(update?.where).slice(0, 2), ["84000000-0000-4000-8000-000000000101", workspaceId]);
});

test("R9.7 touch batches multiple visible L2 memories into one update", async () => {
  const touchedAt = new Date("2026-07-03T00:10:00.000Z");
  const firstId = "84000000-0000-4000-8000-000000000101";
  const secondId = "84000000-0000-4000-8000-000000000102";
  const { db, queries } = createQueryRecorder([[]]);
  const repository = createUserMemoryRepository(db);

  await repository.touch([firstId, secondId], touchedAt, { workspaceId });

  const updates = queries.filter((query) => query.operation === "update");
  assert.equal(updates.length, 1, "prompt-context touch must not issue one update per returned memory");
  const [update] = updates;
  assert.equal(update?.targetTable, userMemories);
  assert.ok(queryReferences(update?.where, userMemories.id));
  assert.ok(queryReferences(update?.where, userMemories.workspaceId));
  const values = queryParamValues(update?.where);
  assert.equal(values.includes(firstId), true);
  assert.equal(values.includes(secondId), true);
  assert.equal(values.includes(workspaceId), true);
});

test("R9.7 soft delete removes only visible L2 memories", async () => {
  const deletedAt = new Date("2026-07-03T00:20:00.000Z");
  const { db, queries } = createQueryRecorder([[{ id: "84000000-0000-4000-8000-000000000101" }]]);
  const repository = createUserMemoryRepository(db);

  await repository.softDeleteForUser(userId, "84000000-0000-4000-8000-000000000101", deletedAt, { workspaceId });

  const update = queries[0];
  assert.equal(update?.targetTable, userMemories);
  assert.ok(queryReferences(update?.where, userMemories.id));
  assert.ok(queryReferences(update?.where, userMemories.userId));
  assert.ok(queryReferences(update?.where, userMemories.workspaceId));
  assert.ok(queryReferences(update?.where, userMemories.deletedAt));
  assert.deepEqual(
    queryParamValues(update?.where).slice(0, 3),
    ["84000000-0000-4000-8000-000000000101", userId, workspaceId]
  );
});

test("mergeUpsert automatically merges non-overlapping L2 memory edits with a base snapshot", async () => {
  const base = "答复用中文。\n保留证据。";
  const current = "答复用中文。\n保留引用证据。";
  const incoming = "先给结论。\n保留证据。";
  const merged = "先给结论。\n保留引用证据。";
  const existing = row({ valueMd: current });
  const { db } = createQueryRecorder([[existing], [row({ valueMd: merged })]]);
  const repository = createUserMemoryRepository(db);

  const result = await repository.mergeUpsert({
    userId,
    workspaceId,
    category: "preference",
    key: "style",
    baseValueMd: base,
    valueMd: incoming,
    confidence: 0.92
  });

  assert.equal(result.status, "merged");
  assert.equal(result.userMemory.valueMd, merged);
});

test("R9.7 mergeUpsert updates only the L2 value it merged from", async () => {
  const base = "回复要简洁。";
  const incoming = "回复只给结论。";
  const existing = row({ valueMd: base });
  const { db, queries } = createQueryRecorder([[existing], [row({ valueMd: incoming })]]);
  const repository = createUserMemoryRepository(db);

  const result = await repository.mergeUpsert({
    userId,
    workspaceId,
    category: "preference",
    key: "style",
    baseValueMd: base,
    valueMd: incoming,
    confidence: 0.95
  });

  assert.equal(result.status, "upserted");
  const update = queries.find((query) => query.operation === "update");
  assert.equal(update?.targetTable, userMemories);
  assert.ok(queryReferences(update?.where, userMemories.id));
  assert.ok(queryReferences(update?.where, userMemories.workspaceId));
  assert.ok(queryReferences(update?.where, userMemories.valueMd));
  assert.equal(queryParamValues(update?.where).includes(base), true);
});

test("mergeUpsert returns a conflict instead of overwriting overlapping L2 memory edits", async () => {
  const existing = row({ valueMd: "回复要详细解释。" });
  const { db, queries } = createQueryRecorder([[existing]]);
  const repository = createUserMemoryRepository(db);

  const result = await repository.mergeUpsert({
    userId,
    workspaceId,
    category: "preference",
    key: "style",
    baseValueMd: "回复要简洁。",
    valueMd: "回复只给结论。",
    confidence: 0.95
  });

  assert.equal(result.status, "conflict");
  assert.equal(result.current.valueMd, "回复要详细解释。");
  assert.equal(queries.some((query) => query.operation === "update"), false);
});


test("B-R9.3 listForUser shadows same-key global rows behind workspace rows", async () => {
  // 0045 回填避开唯一撞时会留下同 key 的全局 shadow 行——读侧必须让工作区行遮蔽它，
  // 不然同一偏好出现两个版本、prompt 注入会自相矛盾。
  const workspaceRow = {
    id: "86000000-0000-4000-8000-000000000001",
    userId: "86000000-0000-4000-8000-000000000011",
    workspaceId: "86000000-0000-4000-8000-000000000021",
    category: "preference",
    key: "reply_style",
    valueMd: "工作区版：要简洁。",
    confidence: 0.9,
    sourceRunId: null,
    lastUsedAt: null,
    deletedAt: null,
    createdAt: new Date("2026-07-03T00:00:00.000Z"),
    updatedAt: new Date("2026-07-03T00:00:00.000Z")
  };
  const globalShadow = {
    ...workspaceRow,
    id: "86000000-0000-4000-8000-000000000002",
    workspaceId: null,
    valueMd: "全局旧版：要详细。",
    confidence: 0.95
  };
  const globalOnly = {
    ...workspaceRow,
    id: "86000000-0000-4000-8000-000000000003",
    workspaceId: null,
    key: "evidence_first",
    valueMd: "全局独有：先给证据。",
    confidence: 0.8
  };
  const { db } = createQueryRecorder([[globalShadow, workspaceRow, globalOnly]]);
  const repository = createUserMemoryRepository(db);

  const rows = await repository.listForUser(workspaceRow.userId, {
    workspaceId: workspaceRow.workspaceId,
    limit: 8
  });

  assert.deepEqual(rows.map((row) => row.id), [workspaceRow.id, globalOnly.id]);
  assert.equal(rows.some((row) => row.valueMd.includes("全局旧版")), false);
});
