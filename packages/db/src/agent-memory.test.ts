import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentMemoryWriteConflict,
  createAgentMemoryRepository
} from "./repositories/agent-memory.js";
import { agentMemory, agentMemoryVersions, agentRuns, taskPlanItems, taskPlans } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

const now = new Date("2026-07-03T00:00:00.000Z");
const memoryId = "83000000-0000-4000-8000-000000000001";
const versionId = "83000000-0000-4000-8000-000000000002";
const workspaceId = "83000000-0000-4000-8000-000000000003";
const taskPlanItemId = "83000000-0000-4000-8000-000000000004";
const runId = "83000000-0000-4000-8000-000000000005";
const planId = "83000000-0000-4000-8000-000000000006";
const userId = "83000000-0000-4000-8000-000000000007";

const memoryRow = {
  id: memoryId,
  workspaceId,
  agentContextId: taskPlanItemId,
  category: "preference",
  key: "concise_approach",
  valueMd: "用户偏好短路径，不要铺垫。",
  confidence: 0.7,
  sourceRunId: runId,
  baseVersion: 0,
  currentVersion: 1,
  createdAt: now,
  updatedAt: now
};

test("R9.3 agent memory repository writes new L1 memory with an append-only version", async () => {
  const { db, queries } = createQueryRecorder([
    [{ item: { id: taskPlanItemId }, plan: { id: planId, workspaceId } }],
    [],
    [memoryRow],
    [{ id: versionId, memoryId, version: 1, baseVersion: 0, valueMd: memoryRow.valueMd, sourceRunId: runId, createdAt: now }]
  ]);
  const repository = createAgentMemoryRepository(db);

  const result = await repository.upsertPrivateMemory({
    workspaceId,
    agentContextId: taskPlanItemId,
    category: "preference",
    key: "concise_approach",
    valueMd: memoryRow.valueMd,
    confidence: 0.7,
    sourceRunId: runId,
    now
  });

  assert.equal(result.id, memoryId);
  assert.equal(queries.length, 4);
  const [contextQuery, lookup, memoryInsert, versionInsert] = queries;
  assert.equal(contextQuery?.fromTable, taskPlanItems);
  assert.deepEqual(contextQuery?.joins.map((join) => [join.kind, join.table]), [
    ["inner", taskPlans]
  ]);
  assert.equal(contextQuery?.limit, 1);
  // R9.7 redline: a supplied agent_context_id is only safe after proving that
  // its parent task plan belongs to the memory workspace.
  assert.ok(queryReferences(contextQuery?.where, taskPlanItems.id));
  assert.ok(queryReferences(contextQuery?.where, taskPlans.workspaceId));
  assert.ok(queryParamValues(contextQuery?.where).includes(taskPlanItemId));
  assert.ok(queryParamValues(contextQuery?.where).includes(workspaceId));

  assert.equal(lookup?.fromTable, agentMemory);
  assert.equal(lookup?.limit, 1);
  assert.ok(queryReferences(lookup?.where, agentMemory.workspaceId));
  assert.ok(queryReferences(lookup?.where, agentMemory.agentContextId));
  assert.ok(queryReferences(lookup?.where, agentMemory.category));
  assert.ok(queryReferences(lookup?.where, agentMemory.key));
  assert.ok(queryParamValues(lookup?.where).includes(workspaceId));
  assert.ok(queryParamValues(lookup?.where).includes(taskPlanItemId));

  assert.equal(memoryInsert?.targetTable, agentMemory);
  const inserted = memoryInsert?.valuesValue as typeof memoryRow & { id: string };
  assert.equal(inserted.workspaceId, workspaceId);
  assert.equal(inserted.agentContextId, taskPlanItemId);
  assert.equal(inserted.currentVersion, 1);
  assert.equal(inserted.baseVersion, 0);

  assert.equal(versionInsert?.targetTable, agentMemoryVersions);
  const version = versionInsert?.valuesValue as { memoryId: string; version: number; baseVersion: number };
  assert.equal(version.memoryId, inserted.id);
  assert.equal(version.version, 1);
  assert.equal(version.baseVersion, 0);
});

test("R9.7 agent memory repository refuses L1 writes outside the workspace task-plan context", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const repository = createAgentMemoryRepository(db);

  await assert.rejects(
    repository.upsertPrivateMemory({
      workspaceId,
      agentContextId: taskPlanItemId,
      category: "preference",
      key: "concise_approach",
      valueMd: memoryRow.valueMd,
      now
    }),
    { name: "AgentMemoryContextNotFound" }
  );

  assert.equal(queries.length, 1);
  const [contextQuery] = queries;
  assert.equal(contextQuery?.fromTable, taskPlanItems);
  assert.deepEqual(contextQuery?.joins.map((join) => [join.kind, join.table]), [
    ["inner", taskPlans]
  ]);
  assert.ok(queryReferences(contextQuery?.where, taskPlanItems.id));
  assert.ok(queryReferences(contextQuery?.where, taskPlans.workspaceId));
  assert.ok(queryParamValues(contextQuery?.where).includes(taskPlanItemId));
  assert.ok(queryParamValues(contextQuery?.where).includes(workspaceId));
});

test("R9.3 agent memory repository reads only one task-plan-item context with an honest cap", async () => {
  const { db, queries } = createQueryRecorder([[memoryRow, { ...memoryRow, id: versionId, key: "quality_signal" }]]);
  const repository = createAgentMemoryRepository(db);

  const result = await repository.listPrivateForContext({
    workspaceId,
    agentContextId: taskPlanItemId,
    limit: 1
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.capped, true);
  const [query] = queries;
  assert.equal(query?.fromTable, agentMemory);
  assert.equal(query?.limit, 2);
  assert.ok(query && query.steps.indexOf("where") < query.steps.indexOf("limit"));
  assert.ok(queryReferences(query?.where, agentMemory.workspaceId));
  assert.ok(queryReferences(query?.where, agentMemory.agentContextId));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
  assert.ok(queryParamValues(query?.where).includes(taskPlanItemId));
});

test("R9.3 agent memory repository rolls back appended versions on optimistic write conflicts", async () => {
  const { db, queries, transactions } = createQueryRecorder([
    [{ item: { id: taskPlanItemId }, plan: { id: planId, workspaceId } }],
    [memoryRow],
    [{ id: versionId, memoryId, version: 2, baseVersion: 1, valueMd: "新偏好", sourceRunId: runId, createdAt: now }],
    []
  ]);
  const repository = createAgentMemoryRepository(db);

  await assert.rejects(
    repository.upsertPrivateMemory({
      workspaceId,
      agentContextId: taskPlanItemId,
      category: "preference",
      key: "concise_approach",
      valueMd: "新偏好",
      sourceRunId: runId,
      now
    }),
    AgentMemoryWriteConflict
  );

  assert.equal(transactions.length, 1);
  assert.deepEqual(transactions[0], {
    outcome: "rejected",
    errorName: "AgentMemoryWriteConflict"
  });
  assert.equal(queries.length, 4);
  const [, , versionInsert, update] = queries;
  assert.equal(versionInsert?.targetTable, agentMemoryVersions);
  assert.equal(update?.targetTable, agentMemory);
  assert.ok(queryReferences(update?.where, agentMemory.currentVersion));
});

test("R9.7 agent memory repository appends when a concurrent first L1 write wins the unique key", async () => {
  const updatedRow = {
    ...memoryRow,
    valueMd: "并发输家补充偏好",
    baseVersion: 1,
    currentVersion: 2,
    updatedAt: now
  };
  const { db, queries, transactions } = createQueryRecorder([
    [{ item: { id: taskPlanItemId }, plan: { id: planId, workspaceId } }],
    [],
    [],
    [memoryRow],
    [{ id: versionId, memoryId, version: 2, baseVersion: 1, valueMd: updatedRow.valueMd, sourceRunId: runId, createdAt: now }],
    [updatedRow]
  ]);
  const repository = createAgentMemoryRepository(db);

  const result = await repository.upsertPrivateMemory({
    workspaceId,
    agentContextId: taskPlanItemId,
    category: "preference",
    key: "concise_approach",
    valueMd: updatedRow.valueMd,
    sourceRunId: runId,
    now
  });

  assert.equal(result.id, memoryId);
  assert.equal(result.currentVersion, 2);
  assert.deepEqual(transactions.map((transaction) => transaction.outcome), ["resolved", "resolved"]);
  assert.equal(queries.length, 6);
  const [, lookup, memoryInsert, conflictLookup, versionInsert, update] = queries;
  assert.equal(lookup?.fromTable, agentMemory);
  assert.equal(memoryInsert?.targetTable, agentMemory);
  assert.ok(memoryInsert?.steps.includes("onConflictDoNothing"));
  assert.ok(queryReferences((memoryInsert?.onConflict as { target?: unknown })?.target, agentMemory.workspaceId));
  assert.ok(queryReferences((memoryInsert?.onConflict as { target?: unknown })?.target, agentMemory.agentContextId));
  assert.ok(queryReferences((memoryInsert?.onConflict as { target?: unknown })?.target, agentMemory.category));
  assert.ok(queryReferences((memoryInsert?.onConflict as { target?: unknown })?.target, agentMemory.key));

  assert.equal(conflictLookup?.fromTable, agentMemory);
  assert.equal(conflictLookup?.limit, 1);
  assert.equal(versionInsert?.targetTable, agentMemoryVersions);
  const version = versionInsert?.valuesValue as { memoryId: string; version: number; baseVersion: number };
  assert.equal(version.memoryId, memoryId);
  assert.equal(version.version, 2);
  assert.equal(version.baseVersion, 1);
  assert.equal(update?.targetTable, agentMemory);
  assert.ok(queryReferences(update?.where, agentMemory.currentVersion));
});

test("R9.3 memory promotion context reads same-plan L1 candidates with source actor and workspace filters", async () => {
  const sibling = {
    ...memoryRow,
    id: "83000000-0000-4000-8000-000000000008",
    agentContextId: "83000000-0000-4000-8000-000000000009",
    valueMd: "用户偏好短答案。"
  };
  const { db, queries } = createQueryRecorder([
    [{
      memory: memoryRow,
      item: { id: taskPlanItemId, planId },
      sourceRun: { id: runId, actorUserId: userId }
    }],
    [{ memory: memoryRow }, { memory: sibling }]
  ]);
  const repository = createAgentMemoryRepository(db);

  const result = await repository.readPromotionContext({
    workspaceId,
    memoryId,
    limit: 1
  });

  assert.equal(result?.entry.id, memoryId);
  assert.equal(result?.planId, planId);
  assert.equal(result?.sourceActorUserId, userId);
  assert.equal(result?.candidates.length, 1);
  assert.equal(result?.capped, true);
  assert.equal(queries.length, 2);
  const [entryQuery, candidatesQuery] = queries;
  assert.equal(entryQuery?.fromTable, agentMemory);
  assert.equal(entryQuery?.joins.length, 3);
  assert.equal(entryQuery?.joins[0]?.table, taskPlanItems);
  assert.equal(entryQuery?.joins[1]?.table, taskPlans);
  assert.equal(entryQuery?.joins[2]?.table, agentRuns);
  assert.ok(queryReferences(entryQuery?.joins[2]?.on, agentRuns.workspaceId));
  assert.ok(queryReferences(entryQuery?.where, agentMemory.workspaceId));
  assert.ok(queryReferences(entryQuery?.where, agentMemory.id));
  // R9.7 redline: entry joins used to trust the task-plan item id alone; the
  // parent task_plans.workspace_id must also be pinned before deriving planId.
  assert.ok(queryReferences(entryQuery?.where, taskPlans.workspaceId));
  assert.ok(queryParamValues(entryQuery?.where).includes(workspaceId));
  assert.ok(queryParamValues(entryQuery?.where).includes(memoryId));

  assert.equal(candidatesQuery?.fromTable, agentMemory);
  assert.equal(candidatesQuery?.joins[0]?.table, taskPlanItems);
  assert.equal(candidatesQuery?.joins[1]?.table, taskPlans);
  assert.equal(candidatesQuery?.limit, 2);
  assert.ok(queryReferences(candidatesQuery?.where, agentMemory.workspaceId));
  assert.ok(queryReferences(candidatesQuery?.where, taskPlanItems.planId));
  assert.ok(queryReferences(candidatesQuery?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(candidatesQuery?.where, agentMemory.category));
  assert.ok(queryReferences(candidatesQuery?.where, agentMemory.key));
  assert.ok(queryParamValues(candidatesQuery?.where).includes(workspaceId));
  assert.ok(queryParamValues(candidatesQuery?.where).includes(planId));
});
