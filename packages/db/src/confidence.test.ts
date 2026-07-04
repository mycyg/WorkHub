import assert from "node:assert/strict";
import test from "node:test";

import { createAiDecisionRepository } from "./repositories/confidence.js";
import { agentRuns, escalationEvents, taskPlanItems, taskPlans, workItems } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryRawStrings, queryReferences, queryTextFragments } from "./test-query-recorder.js";

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
    [{
      planStatus: "dispatching",
      itemId: taskPlanItemId,
      itemStatus: "failed"
    }],
    [{ id: escalationId }],
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

  // R9.7 review: the old assertion expected retry to reset the child item immediately
  // after resolving the card. That was wrong because a later dispatcher failure needs
  // the pre-reset task-plan state to reopen the same decision without losing failure facts.
  const [escalationUpdate, snapshotQuery, snapshotUpdate, itemUpdate, planUpdate] = queries;
  assert.equal(escalationUpdate?.targetTable, escalationEvents);
  assert.equal(snapshotQuery?.fromTable, taskPlanItems);
  assert.equal(snapshotUpdate?.targetTable, escalationEvents);
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

test("R9.7 resolving a child retry records a rollback snapshot before resetting task items", async () => {
  const skippedItemId = "94000000-0000-4000-8000-000000000208";
  const updatedEscalation = {
    id: escalationId,
    workItemId,
    agentRunId,
    handoffJson: {
      task_plan_id: taskPlanId,
      task_plan_item_id: taskPlanItemId,
      skipped_item_ids: [skippedItemId]
    }
  };
  const { db, queries } = createQueryRecorder([
    [updatedEscalation],
    [{
      planStatus: "done",
      itemId: taskPlanItemId,
      itemStatus: "failed"
    }, {
      planStatus: "done",
      itemId: skippedItemId,
      itemStatus: "skipped"
    }],
    [{ id: escalationId }],
    [{ id: taskPlanItemId }, { id: skippedItemId }],
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

  const [, snapshotQuery, snapshotUpdate, itemUpdate] = queries;
  assert.equal(snapshotQuery?.fromTable, taskPlanItems);
  assert.deepEqual(snapshotQuery?.joins.map((join) => [join.kind, join.table]), [
    ["inner", taskPlans]
  ]);
  assert.ok(queryReferences(snapshotQuery?.where, taskPlanItems.planId));
  assert.ok(queryReferences(snapshotQuery?.where, taskPlanItems.id));
  assert.ok(queryReferences(snapshotQuery?.where, taskPlans.workspaceId));
  assert.ok(queryParamValues(snapshotQuery?.where).includes(taskPlanId));
  assert.ok(queryParamValues(snapshotQuery?.where).includes(taskPlanItemId));
  assert.ok(queryParamValues(snapshotQuery?.where).includes(skippedItemId));
  assert.equal(snapshotUpdate?.targetTable, escalationEvents);
  const snapshotSet = snapshotUpdate?.setValue as { handoffJson?: unknown } | undefined;
  assert.ok(queryReferences(snapshotSet?.handoffJson, escalationEvents.handoffJson));
  assert.ok(queryRawStrings(snapshotSet?.handoffJson).some((fragment) => fragment.includes("retry_rollback")));
  assert.equal(itemUpdate?.targetTable, taskPlanItems);
  assert.deepEqual(itemUpdate?.setValue, { status: "pending", updatedAt: now });
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

test("R9.7 budget decision resolution records the action without mutating the work item", async () => {
  const resolvedEscalation = {
    id: escalationId,
    workItemId,
    agentRunId: null,
    projectId: "94000000-0000-4000-8000-000000000209",
    title: "预算测试",
    reasonMd: "预算耗尽。",
    trigger: "budget_exhausted",
    handoffJson: {
      attention_kind: "budget",
      notice: {
        options: [
          { id: "finish_current_output", label: "就用现有产出收尾" }
        ]
      },
      budget_resolution: {
        action_id: "finish_current_output",
        resolved_at: now.toISOString()
      }
    },
    suggestedLeadUserId: null,
    createdAt: now,
    resolvedAt: now,
    workItemStatus: "ai_working",
    workspaceId
  };
  const { db, queries } = createQueryRecorder([
    [{ id: escalationId }],
    [resolvedEscalation]
  ]);
  const repository = createAiDecisionRepository(db);

  const row = await repository.resolveBudgetDecision({
    escalationId,
    workspaceId,
    actionId: "finish_current_output",
    at: now
  });

  assert.equal(row?.id, escalationId);
  assert.equal(row?.workItemStatus, "ai_working");
  assert.deepEqual(row?.handoffJson["budget_resolution"], {
    action_id: "finish_current_output",
    resolved_at: now.toISOString()
  });
  const [escalationUpdate, escalationLookup] = queries;
  assert.equal(escalationUpdate?.targetTable, escalationEvents);
  assert.deepEqual((escalationUpdate?.setValue as { resolvedAt?: Date })?.resolvedAt, now);
  const handoffUpdate = (escalationUpdate?.setValue as { handoffJson?: unknown })?.handoffJson;
  assert.ok(queryReferences(handoffUpdate, escalationEvents.handoffJson));
  assert.ok(queryTextFragments(handoffUpdate).includes(" || "));
  assert.ok(queryTextFragments(handoffUpdate).includes("::jsonb"));
  assert.ok(queryRawStrings(handoffUpdate).includes(JSON.stringify({
    budget_resolution: {
      action_id: "finish_current_output",
      resolved_at: now.toISOString()
    }
  })));
  assert.ok(queryReferences(escalationUpdate?.where, escalationEvents.id));
  assert.ok(queryReferences(escalationUpdate?.where, escalationEvents.resolvedAt));
  assert.ok(queryReferences(escalationUpdate?.where, workItems.workspaceId));
  assert.ok(queryParamValues(escalationUpdate?.where).includes(workspaceId));
  assert.equal(escalationLookup?.fromTable, escalationEvents);
  assert.equal(queries.some((query) => query.targetTable === workItems), false);
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

test("R9.7 reopening a child retry escalation does not require parent work item transition", async () => {
  const reopenedEscalation = {
    id: escalationId,
    workItemId,
    handoffJson: {
      task_plan_id: taskPlanId,
      task_plan_item_id: taskPlanItemId
    }
  };
  const reopenedRow = {
    id: escalationId,
    workItemId,
    agentRunId,
    projectId: "94000000-0000-4000-8000-000000000209",
    title: "子任务重试失败",
    reasonMd: "需要重新显示给用户。",
    trigger: "doom_loop",
    handoffJson: reopenedEscalation.handoffJson,
    suggestedLeadUserId: null,
    createdAt: now,
    resolvedAt: null,
    workItemStatus: "escalated",
    workspaceId
  };
  const { db, queries } = createQueryRecorder([
    [reopenedEscalation],
    [reopenedRow]
  ]);
  const repository = createAiDecisionRepository(db);

  const row = await repository.reopenEscalation?.({
    escalationId,
    targetStatus: "escalated",
    workspaceId,
    at: now
  });

  assert.equal(row?.id, escalationId);
  assert.deepEqual(queries.map((query) => query.targetTable ?? query.fromTable), [
    escalationEvents,
    escalationEvents
  ]);
  const [escalationUpdate] = queries;
  assert.equal(escalationUpdate?.targetTable, escalationEvents);
  assert.deepEqual((escalationUpdate?.setValue as { resolvedAt?: Date | null })?.resolvedAt, null);
  assert.equal(
    queries.some((query) => query.targetTable === workItems),
    false,
    "task-scoped retry compensation must not fail just because the parent is already escalated"
  );
});

test("R9.7 reopening a failed child retry restores the task-plan rollback snapshot", async () => {
  const skippedItemId = "94000000-0000-4000-8000-000000000208";
  const reopenedEscalation = {
    id: escalationId,
    workItemId,
    handoffJson: {
      task_plan_id: taskPlanId,
      task_plan_item_id: taskPlanItemId,
      skipped_item_ids: [skippedItemId],
      retry_rollback: {
        plan_status: "done",
        item_statuses: {
          [taskPlanItemId]: "failed",
          [skippedItemId]: "skipped"
        }
      }
    }
  };
  const reopenedRow = {
    id: escalationId,
    workItemId,
    agentRunId,
    projectId: "94000000-0000-4000-8000-000000000209",
    title: "子任务重试失败",
    reasonMd: "需要重新显示给用户。",
    trigger: "doom_loop",
    handoffJson: reopenedEscalation.handoffJson,
    suggestedLeadUserId: null,
    createdAt: now,
    resolvedAt: null,
    workItemStatus: "escalated",
    workspaceId
  };
  const { db, queries } = createQueryRecorder([
    [reopenedEscalation],
    [{ id: taskPlanItemId }],
    [{ id: skippedItemId }],
    [{ id: taskPlanId }],
    [reopenedRow]
  ]);
  const repository = createAiDecisionRepository(db);

  const row = await repository.reopenEscalation?.({
    escalationId,
    targetStatus: "escalated",
    workspaceId,
    at: now
  });

  assert.equal(row?.id, escalationId);
  assert.deepEqual(queries.map((query) => query.targetTable ?? query.fromTable), [
    escalationEvents,
    taskPlanItems,
    taskPlanItems,
    taskPlans,
    escalationEvents
  ]);
  const [, failedRestore, skippedRestore, planRestore] = queries;
  assert.deepEqual(failedRestore?.setValue, { status: "failed", updatedAt: now });
  assert.ok(queryParamValues(failedRestore?.where).includes(taskPlanItemId));
  assert.deepEqual(skippedRestore?.setValue, { status: "skipped", updatedAt: now });
  assert.ok(queryParamValues(skippedRestore?.where).includes(skippedItemId));
  assert.deepEqual(planRestore?.setValue, { status: "done", updatedAt: now });
  assert.equal(
    queries.some((query) => query.targetTable === workItems),
    false,
    "task-scoped retry compensation must restore task-plan state without mutating the parent work item"
  );
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
    [{
      planStatus: "dispatching",
      itemId: taskPlanItemId,
      itemStatus: "failed"
    }],
    [{ id: escalationId }],
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
  // R9.7 review: the old assertion expected the plan-resume failure path to only
  // contain item reset + plan resume. That missed the required rollback snapshot
  // that lets dispatch-failure compensation restore the child state.
  assert.deepEqual(queries.map((query) => query.targetTable ?? query.fromTable), [
    escalationEvents,
    taskPlanItems,
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
