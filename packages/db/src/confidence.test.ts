import assert from "node:assert/strict";
import test from "node:test";

import { createAiDecisionRepository } from "./repositories/confidence.js";
import { agentRuns, escalationEvents, taskPlanItems, taskPlans, workItems } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences, queryTextFragments } from "./test-query-recorder.js";

const workspaceId = "94000000-0000-4000-8000-000000000201";
const workItemId = "94000000-0000-4000-8000-000000000202";
const escalationId = "94000000-0000-4000-8000-000000000203";
const taskPlanId = "94000000-0000-4000-8000-000000000204";
const taskPlanItemId = "94000000-0000-4000-8000-000000000205";
const agentRunId = "94000000-0000-4000-8000-000000000206";
const delegateTargetUserId = "94000000-0000-4000-8000-000000000207";
const now = new Date("2026-07-03T12:00:00.000Z");

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

test("R9.7 resolving a child retry resets the task-plan item before work-item retry", async () => {
  const updatedEscalation = {
    id: escalationId,
    workItemId,
    agentRunId,
    handoffJson: {
      task_plan_id: taskPlanId,
      task_plan_item_id: taskPlanItemId
    }
  };
  const { db, queries } = createQueryRecorder([
    [updatedEscalation],
    [{ id: taskPlanItemId }],
    [{ id: taskPlanId }],
    []
  ]);
  const repository = createAiDecisionRepository(db);

  await repository.resolveEscalation({
    escalationId,
    targetStatus: "ai_working",
    workspaceId,
    taskPlanAction: "retry",
    at: now
  });

  const [escalationUpdate, itemUpdate, planUpdate] = queries;
  assert.equal(escalationUpdate?.targetTable, escalationEvents);
  assert.equal(itemUpdate?.targetTable, taskPlanItems);
  assert.deepEqual(itemUpdate?.setValue, { status: "pending", updatedAt: now });
  assert.ok(queryReferences(itemUpdate?.where, taskPlanItems.planId));
  assert.ok(queryReferences(itemUpdate?.where, taskPlanItems.id));
  assert.ok(queryReferences(itemUpdate?.where, taskPlanItems.status));
  assert.ok(queryReferences(itemUpdate?.where, taskPlans.workspaceId));
  assert.ok(queryParamValues(itemUpdate?.where).includes(taskPlanId));
  assert.ok(queryParamValues(itemUpdate?.where).includes(taskPlanItemId));
  assert.equal(planUpdate?.targetTable, taskPlans);
  assert.deepEqual(planUpdate?.setValue, { status: "dispatching", updatedAt: now });
  assert.ok(queryReferences(planUpdate?.where, taskPlans.id));
  assert.ok(queryReferences(planUpdate?.where, taskPlans.workspaceId));
  // R9.7: the old assertion expected a parent work_items update here, but this
  // escalation is scoped to a child task-plan item; retry must not mutate the
  // parent work item status/version.
  assert.equal(queries.some((query) => query.targetTable === workItems), false);
});

test("R9.7 escalation resolution mutations are fenced by workspace", async () => {
  const updatedEscalation = {
    id: escalationId,
    workItemId,
    agentRunId: null,
    handoffJson: {}
  };
  const { db, queries } = createQueryRecorder([
    [updatedEscalation],
    [{ id: workItemId }],
    []
  ]);
  const repository = createAiDecisionRepository(db);

  await repository.resolveEscalation({
    escalationId,
    targetStatus: "pm_mode",
    workspaceId,
    at: now
  });

  const [escalationUpdate, workItemUpdate] = queries;
  assert.equal(escalationUpdate?.targetTable, escalationEvents);
  assert.ok(queryReferences(escalationUpdate?.where, escalationEvents.id));
  assert.ok(queryReferences(escalationUpdate?.where, escalationEvents.resolvedAt));
  assert.ok(queryReferences(escalationUpdate?.where, workItems.workspaceId));
  assert.ok(queryParamValues(escalationUpdate?.where).includes(workspaceId));
  assert.equal(workItemUpdate?.targetTable, workItems);
  assert.ok(queryReferences(workItemUpdate?.where, workItems.id));
  assert.ok(queryReferences(workItemUpdate?.where, workItems.status));
  assert.ok(queryReferences(workItemUpdate?.where, workItems.deletedAt));
  assert.ok(queryReferences(workItemUpdate?.where, workItems.workspaceId));
  assert.ok(queryParamValues(workItemUpdate?.where).includes(workspaceId));
});

test("R9.7 escalation delegation mutation is fenced by workspace", async () => {
  const { db, queries } = createQueryRecorder([
    [{ id: escalationId }],
    []
  ]);
  const repository = createAiDecisionRepository(db);

  await repository.delegateEscalation({
    escalationId,
    toUserId: delegateTargetUserId,
    workspaceId,
    at: now
  });

  const [escalationUpdate] = queries;
  assert.equal(escalationUpdate?.targetTable, escalationEvents);
  assert.ok(queryReferences(escalationUpdate?.where, escalationEvents.id));
  assert.ok(queryReferences(escalationUpdate?.where, escalationEvents.resolvedAt));
  assert.ok(queryReferences(escalationUpdate?.where, workItems.workspaceId));
  assert.ok(queryParamValues(escalationUpdate?.where).includes(workspaceId));
});

test("R9.7 child retry resolution fails closed when the target item is stale", async () => {
  const updatedEscalation = {
    id: escalationId,
    workItemId,
    agentRunId,
    handoffJson: {
      task_plan_id: taskPlanId,
      task_plan_item_id: taskPlanItemId
    }
  };
  const { db, queries, transactions } = createQueryRecorder([
    [updatedEscalation],
    []
  ]);
  const repository = createAiDecisionRepository(db);

  await assert.rejects(
    repository.resolveEscalation({
      escalationId,
      targetStatus: "ai_working",
      workspaceId,
      taskPlanAction: "retry",
      at: now
    }),
    /task_plan_resolution_conflict/
  );

  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "Error" }]);
  assert.deepEqual(queries.map((query) => query.targetTable ?? query.fromTable), [
    escalationEvents,
    taskPlanItems
  ]);
});

test("R9.7 child retry resolution fails closed when the plan cannot be resumed", async () => {
  const updatedEscalation = {
    id: escalationId,
    workItemId,
    agentRunId,
    handoffJson: {
      task_plan_id: taskPlanId,
      task_plan_item_id: taskPlanItemId
    }
  };
  const { db, queries, transactions } = createQueryRecorder([
    [updatedEscalation],
    [{ id: taskPlanItemId }],
    []
  ]);
  const repository = createAiDecisionRepository(db);

  await assert.rejects(
    repository.resolveEscalation({
      escalationId,
      targetStatus: "ai_working",
      workspaceId,
      taskPlanAction: "retry",
      at: now
    }),
    /task_plan_resolution_conflict/
  );

  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "Error" }]);
  assert.deepEqual(queries.map((query) => query.targetTable ?? query.fromTable), [
    escalationEvents,
    taskPlanItems,
    taskPlans
  ]);
});

test("R9.7 resolving a child cancel cancels the active child run and skips child/dependents", async () => {
  const skippedDependentId = "94000000-0000-4000-8000-000000000207";
  const failedDependentId = "94000000-0000-4000-8000-000000000208";
  const updatedEscalation = {
    id: escalationId,
    workItemId,
    agentRunId,
    handoffJson: {
      task_plan_id: taskPlanId,
      task_plan_item_id: taskPlanItemId,
      failed_item_ids: [failedDependentId],
      skipped_item_ids: [skippedDependentId]
    }
  };
  const { db, queries } = createQueryRecorder([
    [updatedEscalation],
    [],
    [{ id: taskPlanItemId }, { id: skippedDependentId }, { id: failedDependentId }],
    []
  ]);
  const repository = createAiDecisionRepository(db);

  await repository.resolveEscalation({
    escalationId,
    targetStatus: "cancelled",
    workspaceId,
    taskPlanAction: "cancel",
    at: now
  });

  const [, runUpdate, itemUpdate] = queries;
  assert.equal(runUpdate?.targetTable, agentRuns);
  assert.deepEqual(runUpdate?.setValue, { status: "cancelled", finishedAt: now, updatedAt: now });
  assert.ok(queryReferences(runUpdate?.where, agentRuns.id));
  assert.ok(queryReferences(runUpdate?.where, agentRuns.workspaceId));
  assert.ok(queryReferences(runUpdate?.where, agentRuns.workItemId));
  assert.ok(queryReferences(runUpdate?.where, agentRuns.taskPlanId));
  assert.ok(queryReferences(runUpdate?.where, agentRuns.taskPlanItemId));
  assert.ok(queryReferences(runUpdate?.where, agentRuns.status));
  assert.ok(queryParamValues(runUpdate?.where).includes(agentRunId));
  assert.equal(itemUpdate?.targetTable, taskPlanItems);
  assert.deepEqual(itemUpdate?.setValue, { status: "skipped", updatedAt: now });
  assert.ok(queryReferences(itemUpdate?.where, taskPlanItems.planId));
  assert.ok(queryReferences(itemUpdate?.where, taskPlanItems.id));
  assert.ok(queryReferences(itemUpdate?.where, taskPlanItems.status));
  assert.ok(queryReferences(itemUpdate?.where, taskPlans.workspaceId));
  assert.ok(queryParamValues(itemUpdate?.where).includes(taskPlanId));
  assert.ok(queryParamValues(itemUpdate?.where).includes(taskPlanItemId));
  assert.ok(queryParamValues(itemUpdate?.where).includes(skippedDependentId));
  assert.ok(queryParamValues(itemUpdate?.where).includes(failedDependentId));
  // R9.7: the old assertion expected child cancel to cancel the parent
  // work_items row too, but child escalation actions must stay task-scoped.
  assert.equal(queries.some((query) => query.targetTable === workItems), false);
});
