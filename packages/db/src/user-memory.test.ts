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
  assert.equal(query?.limit, 8);
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
