import assert from "node:assert/strict";
import test from "node:test";

import { createUserMemoryRepository, type UserMemoryRow } from "./repositories/user-memory.js";
import { agentRuns, projectConversations, userMemories, workItems } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

const userId = "84000000-0000-4000-8000-000000000001";
const workspaceId = "84000000-0000-4000-8000-000000000002";
const memoryId = "84000000-0000-4000-8000-000000000101";
const runId = "84000000-0000-4000-8000-000000000201";

function row(over: Partial<UserMemoryRow> = {}): UserMemoryRow {
  return {
    id: memoryId,
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
    editedByUserId: null,
    editedAt: null,
    createdAt: new Date("2026-07-03T00:00:00.000Z"),
    updatedAt: new Date("2026-07-03T00:00:00.000Z"),
    ...over
  };
}

test("getForUser scopes by id + userId + workspace visibility and does NOT filter deletedAt", async () => {
  const target = row();
  const { db, queries } = createQueryRecorder([[target]]);
  const repository = createUserMemoryRepository(db);

  const result = await repository.getForUser(userId, memoryId, { workspaceId });

  assert.deepEqual(result, target);
  const select = queries[0];
  assert.equal(select?.operation, "select");
  assert.ok(queryReferences(select?.where, userMemories.id), "where must fence by id");
  assert.ok(queryReferences(select?.where, userMemories.userId), "where must fence by userId");
  assert.ok(queryReferences(select?.where, userMemories.workspaceId), "where must apply workspace visibility");
  // 关键：不过滤 deletedAt——detail/patch 要据 deletedAt 判 404/409，仓库不能提前把已删行藏掉。
  assert.equal(queryReferences(select?.where, userMemories.deletedAt), false, "getForUser must not filter deletedAt");
  assert.equal(select?.limit, 1);
  assert.deepEqual(queryParamValues(select?.where).slice(0, 2), [memoryId, userId]);
});

test("getForUser returns undefined when no row matches", async () => {
  const { db } = createQueryRecorder([[]]);
  const repository = createUserMemoryRepository(db);
  assert.equal(await repository.getForUser(userId, memoryId, { workspaceId }), undefined);
});

test("updateValueForUser writes value + edit-provenance, never confidence, and fences on expectedValueMd", async () => {
  const updated = row({ valueMd: "改成这样。", editedByUserId: userId, editedAt: new Date("2026-07-04T00:00:00.000Z") });
  const { db, queries } = createQueryRecorder([[updated]]);
  const repository = createUserMemoryRepository(db);

  const result = await repository.updateValueForUser({
    userId,
    id: memoryId,
    valueMd: "改成这样。",
    expectedValueMd: "回复要简洁。",
    editedByUserId: userId,
    at: new Date("2026-07-04T00:00:00.000Z"),
    workspaceId
  });

  assert.deepEqual(result, updated);
  const update = queries[0];
  assert.equal(update?.operation, "update");
  assert.equal(update?.targetTable, userMemories);
  const setKeys = Object.keys((update?.setValue ?? {}) as Record<string, unknown>).sort();
  assert.deepEqual(setKeys, ["editedAt", "editedByUserId", "updatedAt", "valueMd"]);
  // 绝不触发 upsert 的 confidence+0.1 强化：set 里不得出现 confidence。
  assert.equal("confidence" in ((update?.setValue ?? {}) as Record<string, unknown>), false);
  // 竞态兜底 + 水平越权 fence + 已删行不可写。
  assert.ok(queryReferences(update?.where, userMemories.id));
  assert.ok(queryReferences(update?.where, userMemories.userId));
  assert.ok(queryReferences(update?.where, userMemories.deletedAt), "must not resurrect a soft-deleted row");
  assert.ok(queryReferences(update?.where, userMemories.valueMd), "must fence race on expected valueMd");
});

test("updateValueForUser returns undefined when the optimistic guard misses (concurrent edit)", async () => {
  const { db } = createQueryRecorder([[]]);
  const repository = createUserMemoryRepository(db);
  const result = await repository.updateValueForUser({
    userId,
    id: memoryId,
    valueMd: "x",
    expectedValueMd: "stale",
    editedByUserId: userId,
    workspaceId
  });
  assert.equal(result, undefined);
});

test("resolveRunProvenance short-circuits on empty input without querying", async () => {
  const { db, queries } = createQueryRecorder([]);
  const repository = createUserMemoryRepository(db);
  assert.deepEqual(await repository.resolveRunProvenance([]), []);
  assert.equal(queries.length, 0, "empty runIds must not hit the DB");
});

test("resolveRunProvenance left-joins runs → work items → conversations, keyed by inArray(runIds)", async () => {
  const provenance = {
    runId,
    title: "周报生成",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    workItemId: "84000000-0000-4000-8000-000000000301",
    workItemTitle: "生成 Q2 周报",
    sourceConversationId: null,
    conversationTitle: null
  };
  const { db, queries } = createQueryRecorder([[provenance]]);
  const repository = createUserMemoryRepository(db);

  const rows = await repository.resolveRunProvenance([runId]);

  assert.deepEqual(rows, [provenance]);
  const select = queries[0];
  assert.equal(select?.operation, "select");
  assert.equal(select?.fromTable, agentRuns);
  assert.deepEqual(
    select?.joins.map((join) => join.kind),
    ["left", "left"],
    "provenance join must be LEFT (missing work item / conversation must not drop the run)"
  );
  const joinedTables = select?.joins.map((join) => join.table);
  assert.ok(joinedTables?.includes(workItems));
  assert.ok(joinedTables?.includes(projectConversations));
  assert.ok(queryReferences(select?.where, agentRuns.id), "must filter by agent_runs.id in the run id set");
  assert.deepEqual(queryParamValues(select?.where), [runId]);
});
