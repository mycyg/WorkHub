import assert from "node:assert/strict";
import test from "node:test";

import { memoryConflicts } from "./schema/index.js";
import { createMemoryConflictRepository, type MemoryConflictRow } from "./repositories/memory-conflicts.js";
import { createQueryRecorder, queryParamValues, queryReferences, queryTextFragments } from "./test-query-recorder.js";

const conflictId = "85000000-0000-4000-8000-000000000001";
const workspaceId = "85000000-0000-4000-8000-000000000002";
const userId = "85000000-0000-4000-8000-000000000003";
const sourceRunId = "85000000-0000-4000-8000-000000000004";
const now = new Date("2026-07-03T10:30:00.000Z");

function row(over: Partial<MemoryConflictRow> = {}): MemoryConflictRow {
  return {
    id: conflictId,
    workspaceId,
    userId,
    sourceRunId,
    category: "preference",
    key: "reply_style",
    currentValueMd: "回复要详细解释。",
    incomingValueMd: "回复只给结论。",
    baseValueMd: "回复要简洁。",
    candidateMemoryIds: ["85000000-0000-4000-8000-000000000101"],
    status: "open",
    resolution: null,
    resolvedValueMd: null,
    resolvedByUserId: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over
  } as MemoryConflictRow;
}

test("R9.3 memory conflict repository lists only open user/workspace cards with an honest cap", async () => {
  const { db, queries } = createQueryRecorder([
    [row(), row({ id: "85000000-0000-4000-8000-000000000005" })]
  ]);
  const repository = createMemoryConflictRepository(db);

  const result = await repository.listOpenForUser({ workspaceId, userId, limit: 1 });

  assert.equal(result.rows.length, 1);
  assert.equal(result.capped, true);
  const query = queries[0];
  assert.equal(query?.fromTable, memoryConflicts);
  assert.equal(query?.limit, 2);
  // R9.7: the old schema assertion grepped migration 0038 for memory_conflicts index/status text.
  // That was wrong because migration source text did not prove the repository reads only open
  // workspace/user cards with an honest cap at runtime.
  assert.ok(queryReferences(query?.where, memoryConflicts.workspaceId));
  assert.ok(queryReferences(query?.where, memoryConflicts.userId));
  assert.ok(queryReferences(query?.where, memoryConflicts.status));
  assert.deepEqual(queryParamValues(query?.where).slice(0, 3), [workspaceId, userId, "open"]);
});

test("R9.3 memory conflict repository resolves only the actor's open workspace card", async () => {
  const resolvedAt = new Date("2026-07-03T10:35:00.000Z");
  const { db, queries } = createQueryRecorder([
    [row({ status: "resolved", resolution: "accept_incoming", resolvedAt, resolvedByUserId: userId })]
  ]);
  const repository = createMemoryConflictRepository(db);

  const result = await repository.resolve({
    workspaceId,
    userId,
    conflictId,
    resolution: "accept_incoming",
    resolvedValueMd: "回复只给结论。",
    resolvedAt
  });

  assert.equal(result?.status, "resolved");
  const update = queries[0];
  assert.equal(update?.targetTable, memoryConflicts);
  assert.ok(queryReferences(update?.where, memoryConflicts.id));
  assert.ok(queryReferences(update?.where, memoryConflicts.workspaceId));
  assert.ok(queryReferences(update?.where, memoryConflicts.userId));
  assert.ok(queryReferences(update?.where, memoryConflicts.status));
  assert.deepEqual(queryParamValues(update?.where).slice(0, 4), [conflictId, workspaceId, userId, "open"]);
});

test("R9.3 memory conflict repository deduplicates one open card per user key", async () => {
  const { db, queries } = createQueryRecorder([
    [row()],
    [row({ id: "85000000-0000-4000-8000-000000000099", incomingValueMd: "回复只给结论，并列步骤。" })]
  ]);
  const repository = createMemoryConflictRepository(db);

  await repository.createOrUpdateOpen({
    id: conflictId,
    workspaceId,
    userId,
    sourceRunId,
    category: "preference",
    key: "reply_style",
    currentValueMd: "回复要详细解释。",
    incomingValueMd: "回复只给结论。",
    baseValueMd: "回复要简洁。",
    candidateMemoryIds: ["85000000-0000-4000-8000-000000000101"],
    now
  });
  await repository.createOrUpdateOpen({
    id: "85000000-0000-4000-8000-000000000099",
    workspaceId,
    userId,
    sourceRunId,
    category: "preference",
    key: "reply_style",
    currentValueMd: "回复要详细解释。",
    incomingValueMd: "回复只给结论，并列步骤。",
    baseValueMd: "回复要简洁。",
    candidateMemoryIds: ["85000000-0000-4000-8000-000000000101", "85000000-0000-4000-8000-000000000102"],
    now
  });

  const inserts = queries.filter((query) => query.operation === "insert");
  assert.equal(inserts.length, 2);
  const secondInsert = inserts[1];
  assert.equal(secondInsert?.targetTable, memoryConflicts);
  const secondValues = secondInsert?.valuesValue as { status?: unknown; resolution?: unknown; resolvedValueMd?: unknown; resolvedByUserId?: unknown; resolvedAt?: unknown } | undefined;
  assert.equal(secondValues?.status, "open");
  assert.equal(secondValues?.resolution, null);
  assert.equal(secondValues?.resolvedValueMd, null);
  assert.equal(secondValues?.resolvedByUserId, null);
  assert.equal(secondValues?.resolvedAt, null);
  assert.equal(secondInsert?.returningCalled, true);
  // R9.7: the old schema assertion grepped migration 0039 for the open-card unique index.
  // That was wrong because source text did not prove conflict creation uses the open-only
  // upsert target and resets stale resolution fields for the runtime row.
  assert.ok(
    queryReferences((secondInsert?.onConflict as { target?: unknown })?.target, memoryConflicts.workspaceId),
    "open conflict upsert must target workspace_id"
  );
  assert.ok(
    queryReferences((secondInsert?.onConflict as { target?: unknown })?.target, memoryConflicts.userId),
    "open conflict upsert must target user_id"
  );
  assert.ok(
    queryReferences((secondInsert?.onConflict as { target?: unknown })?.target, memoryConflicts.category),
    "open conflict upsert must target category"
  );
  assert.ok(
    queryReferences((secondInsert?.onConflict as { target?: unknown })?.target, memoryConflicts.key),
    "open conflict upsert must target key"
  );
  assert.ok(
    queryTextFragments((secondInsert?.onConflict as { targetWhere?: unknown })?.targetWhere).join(" ").includes("open"),
    "open conflicts must upsert by the one-open-card-per-key index"
  );
});
