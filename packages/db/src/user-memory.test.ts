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
  // R9.3 triage: the old assertion pinned SQL LIMIT to the caller limit, which was wrong once
  // workspace rows can shadow global fallback rows; limiting before dedupe can underfill unique memories.
  assert.equal(query?.limit, 16);
});

test("listForUser lets workspace L2 memories shadow global rows with the same category and key", async () => {
  const workspaceSpecific = row({
    id: "84000000-0000-4000-8000-000000000201",
    workspaceId,
    key: "style",
    valueMd: "工作区内回复先给结论。",
    confidence: 0.6
  });
  const globalDuplicate = row({
    id: "84000000-0000-4000-8000-000000000202",
    workspaceId: null,
    key: "style",
    valueMd: "全局回复详细解释。",
    confidence: 0.99
  });
  const globalOnly = row({
    id: "84000000-0000-4000-8000-000000000203",
    workspaceId: null,
    key: "evidence",
    valueMd: "全局偏好保留证据。",
    confidence: 0.8
  });
  const { db } = createQueryRecorder([[globalDuplicate, workspaceSpecific, globalOnly]]);
  const repository = createUserMemoryRepository(db);

  const rows = await repository.listForUser(userId, { workspaceId, limit: 8 });

  assert.equal(rows.some((memory) => memory.id === workspaceSpecific.id), true);
  assert.equal(rows.some((memory) => memory.id === globalOnly.id), true);
  assert.equal(rows.some((memory) => memory.id === globalDuplicate.id), false);
  assert.equal(rows.length, 2);
});

test("mergeUpsert does not silently keep current L2 when incoming equals a fake base snapshot", async () => {
  const existing = row({ valueMd: "回复要详细解释。" });
  const { db, queries } = createQueryRecorder([[existing]]);
  const repository = createUserMemoryRepository(db);

  const result = await repository.mergeUpsert({
    userId,
    workspaceId,
    category: "preference",
    key: "style",
    baseValueMd: "回复要简洁。",
    valueMd: "回复要简洁。",
    confidence: 0.95
  });

  assert.equal(result.status, "conflict");
  assert.equal(result.current.valueMd, "回复要详细解释。");
  assert.equal(queries.some((query) => query.operation === "update"), false);
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

test("mergeUpsert updates only the L2 value it merged from", async () => {
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
