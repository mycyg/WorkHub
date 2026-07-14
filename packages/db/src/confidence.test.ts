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

test("R9.7 unresolved escalation listing clamps direct repository callers to the scan probe cap", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const repository = createAiDecisionRepository(db);

  await repository.listUnresolvedEscalationsForWorkspace({ workspaceId, limit: 10_000 });

  assert.equal(queries.length, 1);
  assert.equal(queries[0]?.limit, 101);
});

test("R9.7 escalation direct lookup is scoped to the workspace before service auth", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const repository = createAiDecisionRepository(db);

  await repository.findEscalationById({ id: escalationId, workspaceId });

  assert.equal(queries.length, 1);
  const [query] = queries;
  assert.equal(query?.fromTable, escalationEvents);
  assert.deepEqual(query?.joins.map((join) => [join.kind, join.table]), [
    ["inner", workItems]
  ]);
  assert.ok(queryReferences(query?.where, escalationEvents.id));
  assert.ok(queryReferences(query?.where, workItems.workspaceId));
  assert.ok(queryReferences(query?.where, workItems.deletedAt));
  assert.ok(queryParamValues(query?.where).includes(escalationId));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
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

test("R9.7 resolving a plan-level arbitration retry resumes the plan without mutating the parent work item", async () => {
  const updatedEscalation = {
    id: escalationId,
    workItemId,
    agentRunId: null,
    handoffJson: {
      source: "task_dispatcher",
      reason: "arbitration_blocked",
      task_plan_id: taskPlanId,
      skipped_item_ids: []
    }
  };
  const resolvedEscalation = {
    id: escalationId,
    workItemId,
    agentRunId: null,
    projectId: "94000000-0000-4000-8000-000000000209",
    title: "仲裁测试",
    reasonMd: "仲裁未通过。",
    trigger: "unqualified",
    handoffJson: updatedEscalation.handoffJson,
    suggestedLeadUserId: null,
    createdAt: now,
    resolvedAt: now,
    workItemStatus: "escalated",
    workspaceId
  };
  const { db, queries } = createQueryRecorder([
    [updatedEscalation],
    [{ id: taskPlanId }],
    [resolvedEscalation]
  ]);
  const repository = createAiDecisionRepository(db);

  const row = await repository.resolveEscalation({
    escalationId,
    targetStatus: "ai_working",
    workspaceId,
    taskPlanAction: "retry",
    at: now
  });

  assert.equal(row?.id, escalationId);
  assert.equal(row?.workItemStatus, "escalated");
  assert.deepEqual(queries.map((query) => query.targetTable ?? query.fromTable), [
    escalationEvents,
    taskPlans,
    escalationEvents
  ]);
  const [, planUpdate] = queries;
  assert.equal(planUpdate?.targetTable, taskPlans);
  assert.deepEqual(planUpdate?.setValue, { status: "dispatching", updatedAt: now });
  assert.ok(queryReferences(planUpdate?.where, taskPlans.id));
  assert.ok(queryReferences(planUpdate?.where, taskPlans.workItemId));
  assert.ok(queryReferences(planUpdate?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(planUpdate?.where, taskPlans.status));
  assert.ok(queryParamValues(planUpdate?.where).includes(taskPlanId));
  assert.ok(queryParamValues(planUpdate?.where).includes(workItemId));
  assert.ok(queryParamValues(planUpdate?.where).includes(workspaceId));
  assert.equal(
    queries.some((query) => query.targetTable === workItems),
    false,
    "plan-level arbitration retry must redispatch the plan without mutating the parent work item"
  );
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

// R14 GAP-2 补测：上面这条只覆盖了 happy path。plain（非任务计划）升级 resolve 的两处 CAS 守卫
// ——escalation_events.resolvedAt IS NULL 与 work_items.status IN (合法前驱)——此前从没有用例
// 让 UPDATE ... RETURNING 命中 0 行,没验证过「重复 resolve」与「工单已离开 escalated」这两个
// 真实会发生的竞态分支。task-plan 分支（pm_mode taskPlanAction）已有对应用例
// （"B-R9.0 pm_mode surfaces a conflict when the work item cannot transition"），这里补 plain 分支。
test("R14 GAP-2：重复 resolve 一条已被处理过的升级，CAS 落空返回 null，且不再触碰工作项（幂等，不二次迁移）", async () => {
  const { db, queries } = createQueryRecorder([
    [] // escalation_events 的 UPDATE ... WHERE resolved_at IS NULL 命中 0 行：已经被并发的另一次 resolve 抢先处理过。
  ]);
  const repository = createAiDecisionRepository(db);

  const result = await repository.resolveEscalation({
    escalationId,
    targetStatus: "pm_mode",
    workspaceId,
    at: now
  });

  assert.equal(result, null);
  assert.equal(queries.length, 1, "escalation CAS 落空后不许再发起 work_items 的写");
  assert.equal(queries[0]?.targetTable, escalationEvents);
  assert.ok(queryReferences(queries[0]?.where, escalationEvents.resolvedAt));
});

test("R14 GAP-2：工单已经离开 escalated（终态/被并发迁走）时，plain resolve 报 escalation_status_transition_conflict 而不是静默写坏状态", async () => {
  const updatedEscalation = {
    id: escalationId,
    workItemId,
    agentRunId: null,
    handoffJson: {}
  };
  const { db, transactions } = createQueryRecorder([
    [updatedEscalation],
    [] // work_items 的 UPDATE ... WHERE status IN (合法前驱) 命中 0 行：当前状态不是 pm_mode 的合法前驱（例如已被取消）。
  ]);
  const repository = createAiDecisionRepository(db);

  await assert.rejects(
    repository.resolveEscalation({
      escalationId,
      targetStatus: "pm_mode",
      workspaceId,
      at: now
    }),
    /escalation_status_transition_conflict/
  );
  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "Error" }]);
});

test("R9.7 finish-current-output budget decision moves the work item to review", async () => {
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
        target_status: "in_review",
        resolved_at: now.toISOString()
      }
    },
    suggestedLeadUserId: null,
    createdAt: now,
    resolvedAt: now,
    workItemStatus: "in_review",
    workspaceId
  };
  const { db, queries } = createQueryRecorder([
    [{ id: escalationId, workItemId, handoffJson: {} }],
    [{ id: workItemId }],
    [resolvedEscalation]
  ]);
  const repository = createAiDecisionRepository(db);

  const row = await repository.resolveBudgetDecision({
    escalationId,
    workspaceId,
    actionId: "finish_current_output",
    targetStatus: "in_review",
    at: now
  });

  assert.equal(row?.id, escalationId);
  assert.equal(row?.workItemStatus, "in_review");
  assert.deepEqual(row?.handoffJson["budget_resolution"], {
    action_id: "finish_current_output",
    target_status: "in_review",
    resolved_at: now.toISOString()
  });
  const [escalationUpdate] = queries;
  assert.equal(escalationUpdate?.targetTable, escalationEvents);
  assert.deepEqual((escalationUpdate?.setValue as { resolvedAt?: Date })?.resolvedAt, now);
  const handoffUpdate = (escalationUpdate?.setValue as { handoffJson?: unknown })?.handoffJson;
  assert.ok(queryReferences(handoffUpdate, escalationEvents.handoffJson));
  assert.ok(queryTextFragments(handoffUpdate).includes(" || "));
  assert.ok(queryTextFragments(handoffUpdate).includes("::jsonb"));
  assert.ok(queryRawStrings(handoffUpdate).includes(JSON.stringify({
    budget_resolution: {
      action_id: "finish_current_output",
      target_status: "in_review",
      resolved_at: now.toISOString()
    }
  })));
  assert.ok(queryReferences(escalationUpdate?.where, escalationEvents.id));
  assert.ok(queryReferences(escalationUpdate?.where, escalationEvents.resolvedAt));
  assert.ok(queryReferences(escalationUpdate?.where, workItems.workspaceId));
  assert.ok(queryParamValues(escalationUpdate?.where).includes(workspaceId));
  const workItemUpdate = queries.find((query) => query.targetTable === workItems);
  // R9.7 review: the old assertion explicitly expected no work-item mutation,
  // but that dismissed the budget card without applying "finish current output"
  // semantics. The terminal choice must stop automation and enter review.
  assert.equal(workItemUpdate?.targetTable, workItems);
  const workItemSet = workItemUpdate?.setValue as { status?: string; version?: unknown; updatedAt?: Date } | undefined;
  assert.equal(workItemSet?.status, "in_review");
  assert.ok(queryReferences(workItemSet?.version, workItems.version));
  assert.equal(workItemSet?.updatedAt, now);
  assert.ok(queryReferences(workItemUpdate?.where, workItems.id));
  assert.ok(queryReferences(workItemUpdate?.where, workItems.workspaceId));
  assert.ok(queryReferences(workItemUpdate?.where, workItems.status));
  assert.ok(queryReferences(workItemUpdate?.where, workItems.deletedAt));
  assert.ok(queryParamValues(workItemUpdate?.where).includes(workItemId));
  assert.ok(queryParamValues(workItemUpdate?.where).includes(workspaceId));
  const escalationLookup = queries.find((query) => query.fromTable === escalationEvents);
  assert.equal(escalationLookup?.fromTable, escalationEvents);
});

test("R9.7 finish-current-output budget decision skips remaining task-plan work", async () => {
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
      task_plan_id: taskPlanId,
      budget_resolution: {
        action_id: "finish_current_output",
        resolved_at: now.toISOString()
      }
    },
    suggestedLeadUserId: null,
    createdAt: now,
    resolvedAt: now,
    workItemStatus: "in_review",
    workspaceId
  };
  const { db, queries } = createQueryRecorder([
    [{ id: escalationId, workItemId, handoffJson: { task_plan_id: taskPlanId } }],
    [],
    [{ id: taskPlanItemId }],
    [{ id: taskPlanId }],
    [{ id: workItemId }],
    [resolvedEscalation]
  ]);
  const repository = createAiDecisionRepository(db);

  const row = await repository.resolveBudgetDecision({
    escalationId,
    workspaceId,
    actionId: "finish_current_output",
    targetStatus: "in_review",
    at: now
  });

  assert.equal(row?.workItemStatus, "in_review");
  assert.deepEqual(queries.map((query) => query.targetTable ?? query.fromTable), [
    escalationEvents,
    agentRuns,
    taskPlanItems,
    taskPlans,
    workItems,
    escalationEvents
  ]);
  const [, runUpdate, itemUpdate, planUpdate, workItemUpdate] = queries;
  assert.equal(runUpdate?.targetTable, agentRuns);
  assert.deepEqual(runUpdate?.setValue, { status: "cancelled", finishedAt: now, updatedAt: now });
  assert.ok(queryReferences(runUpdate?.where, agentRuns.taskPlanId));
  assert.ok(queryReferences(runUpdate?.where, agentRuns.status));
  assert.equal(itemUpdate?.targetTable, taskPlanItems);
  assert.deepEqual(itemUpdate?.setValue, { status: "skipped", updatedAt: now });
  assert.ok(queryReferences(itemUpdate?.where, taskPlanItems.planId));
  assert.ok(queryReferences(itemUpdate?.where, taskPlanItems.status));
  assert.ok(queryReferences(itemUpdate?.where, taskPlans.workspaceId));
  assert.equal(planUpdate?.targetTable, taskPlans);
  assert.deepEqual(planUpdate?.setValue, { status: "done", updatedAt: now });
  assert.ok(queryReferences(planUpdate?.where, taskPlans.id));
  assert.ok(queryReferences(planUpdate?.where, taskPlans.workspaceId));
  assert.equal(workItemUpdate?.targetTable, workItems);
  const workItemSet = workItemUpdate?.setValue as { status?: string; version?: unknown; updatedAt?: Date } | undefined;
  assert.equal(workItemSet?.status, "in_review");
  assert.ok(queryReferences(workItemSet?.version, workItems.version));
  assert.equal(workItemSet?.updatedAt, now);
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

test("B-R9.0 resolving pm_mode halts the plan and moves the work item into pm_mode", async () => {
  // branch-review 状态语义：pm_mode 与 cancel 原先 DB 层完全一样，「转成我来做」永不生效。
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
    [],
    [{ id: taskPlanItemId }],
    [],
    [{ id: workItemId }],
    []
  ]);
  const repository = createAiDecisionRepository(db);

  await repository.resolveEscalation({
    escalationId,
    targetStatus: "pm_mode",
    workspaceId,
    taskPlanAction: "pm_mode",
    at: now
  });

  const planUpdate = queries.find((query) => query.targetTable === taskPlans);
  assert.ok(planUpdate, "pm_mode must stop the army plan from dispatching");
  assert.deepEqual(planUpdate.setValue, { status: "cancelled", updatedAt: now });
  assert.ok(queryReferences(planUpdate.where, taskPlans.id));
  assert.ok(queryReferences(planUpdate.where, taskPlans.status));
  assert.ok(queryParamValues(planUpdate.where).includes(taskPlanId));

  const workItemUpdate = queries.find((query) => query.targetTable === workItems);
  assert.ok(workItemUpdate, "pm_mode must actually move the work item");
  assert.equal((workItemUpdate.setValue as { status?: string } | undefined)?.status, "pm_mode");
  assert.ok(queryReferences(workItemUpdate.where, workItems.id));
  assert.ok(queryReferences(workItemUpdate.where, workItems.status));
  assert.ok(queryReferences(workItemUpdate.where, workItems.deletedAt));
  assert.ok(queryParamValues(workItemUpdate.where).includes(workItemId));
  // 人从跑着的军团手里接管：ai_working 必须是合法前驱。
  assert.ok(queryParamValues(workItemUpdate.where).includes("ai_working"));
});

test("B-R9.0 pm_mode surfaces a conflict when the work item cannot transition", async () => {
  const updatedEscalation = {
    id: escalationId,
    workItemId,
    handoffJson: { task_plan_id: taskPlanId }
  };
  const { db, transactions } = createQueryRecorder([
    [updatedEscalation],
    [],
    []
  ]);
  const repository = createAiDecisionRepository(db);

  await assert.rejects(
    repository.resolveEscalation({
      escalationId,
      targetStatus: "pm_mode",
      workspaceId,
      taskPlanAction: "pm_mode",
      at: now
    }),
    /escalation_status_transition_conflict/
  );
  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "Error" }]);
});

test("B-R9.0 plan-scope cancel cancels both the plan and the work item", async () => {
  const updatedEscalation = {
    id: escalationId,
    workItemId,
    handoffJson: { task_plan_id: taskPlanId }
  };
  const { db, queries } = createQueryRecorder([
    [updatedEscalation],
    [{ id: taskPlanId }],
    [{ id: workItemId }],
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

  const planUpdate = queries.find((query) => query.targetTable === taskPlans);
  assert.ok(planUpdate);
  assert.deepEqual(planUpdate.setValue, { status: "cancelled", updatedAt: now });
  const workItemUpdate = queries.find((query) => query.targetTable === workItems);
  assert.ok(workItemUpdate, "plan-scope cancel must cancel the work item too");
  assert.equal((workItemUpdate.setValue as { status?: string } | undefined)?.status, "cancelled");
  assert.ok(queryParamValues(workItemUpdate.where).includes(workItemId));
});
