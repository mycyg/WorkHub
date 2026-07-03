import assert from "node:assert/strict";
import test from "node:test";

import { createTaskPlanRepository } from "./repositories/task-plans.js";
import {
  agentRuns,
  escalationEvents,
  objectiveWorkItemLinks,
  objectives,
  taskPlanItems,
  taskPlans,
  workItems
} from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

const now = new Date("2026-07-03T00:00:00.000Z");
const planId = "91000000-0000-4000-8000-000000000001";
const workItemId = "91000000-0000-4000-8000-000000000002";
const workspaceId = "91000000-0000-4000-8000-000000000003";
const userId = "91000000-0000-4000-8000-000000000004";
const firstItemId = "91000000-0000-4000-8000-000000000011";
const secondItemId = "91000000-0000-4000-8000-000000000012";
const objectiveId = "91000000-0000-4000-8000-000000000013";
const firstRunId = "91000000-0000-4000-8000-000000000014";
const escalationId = "91000000-0000-4000-8000-000000000015";
const runlessEscalationId = "91000000-0000-4000-8000-000000000016";

test("R9.1 task plan repository writes draft plans and items in one transaction", async () => {
  const { db, queries } = createQueryRecorder();
  const repository = createTaskPlanRepository(db);

  await repository.createDraftPlan({
    id: planId,
    workItemId,
    workspaceId,
    createdByUserId: userId,
    budgetJson: { total_share_pct: 100 },
    decompositionContextJson: { source: "test" },
    items: [
      {
        id: firstItemId,
        seq: 1,
        title: "查资料",
        role: "research",
        objectiveMd: "查清背景。",
        acceptanceMd: "列出来源。",
        budgetSharePct: 40,
        dependsOn: []
      },
      {
        id: secondItemId,
        seq: 2,
        title: "写初稿",
        role: "produce",
        objectiveMd: "写出初稿。",
        acceptanceMd: "初稿包含结论。",
        budgetSharePct: 60,
        dependsOn: [firstItemId]
      }
    ],
    now
  });

  assert.equal(queries.length, 2);
  const [planInsert, itemInsert] = queries;
  assert.equal(planInsert?.operation, "insert");
  assert.equal(planInsert?.targetTable, taskPlans);
  assert.deepEqual(planInsert?.valuesValue, {
    id: planId,
    workItemId,
    workspaceId,
    status: "draft",
    objectiveId: null,
    budgetJson: { total_share_pct: 100 },
    decompositionContextJson: { source: "test" },
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now
  });
  assert.equal(itemInsert?.operation, "insert");
  assert.equal(itemInsert?.targetTable, taskPlanItems);
  assert.deepEqual(itemInsert?.valuesValue, [
    {
      id: firstItemId,
      planId,
      parentItemId: null,
      seq: 1,
      title: "查资料",
      role: "research",
      objectiveMd: "查清背景。",
      acceptanceMd: "列出来源。",
      budgetSharePct: 40,
      dependsOn: [],
      status: "pending",
      createdAt: now,
      updatedAt: now
    },
    {
      id: secondItemId,
      planId,
      parentItemId: null,
      seq: 2,
      title: "写初稿",
      role: "produce",
      objectiveMd: "写出初稿。",
      acceptanceMd: "初稿包含结论。",
      budgetSharePct: 60,
      dependsOn: [firstItemId],
      status: "pending",
      createdAt: now,
      updatedAt: now
    }
  ]);
});

test("R9.7 task plan repository rejects objectives outside the plan work item scope", async () => {
  const { db, queries, transactions } = createQueryRecorder([[]]);
  const repository = createTaskPlanRepository(db);

  await assert.rejects(
    () => repository.createDraftPlan({
      id: planId,
      workItemId,
      workspaceId,
      objectiveId,
      createdByUserId: userId,
      items: [],
      now
    }),
    { name: "TaskPlanObjectiveScopeMismatch" }
  );

  assert.equal(transactions[0]?.outcome, "rejected");
  assert.equal(transactions[0]?.errorName, "TaskPlanObjectiveScopeMismatch");
  assert.equal(queries.length, 1);
  const [scopeQuery] = queries;
  assert.equal(scopeQuery?.operation, "select");
  assert.equal(scopeQuery?.fromTable, objectives);
  assert.deepEqual(scopeQuery?.joins.map((join) => [join.kind, join.table]), [
    ["inner", objectiveWorkItemLinks],
    ["inner", workItems]
  ]);
  assert.equal(scopeQuery?.limit, 1);
  assert.ok(queryReferences(scopeQuery?.where, objectives.id));
  assert.ok(queryReferences(scopeQuery?.where, objectives.workspaceId));
  assert.ok(queryReferences(scopeQuery?.where, objectiveWorkItemLinks.objectiveId));
  assert.ok(queryReferences(scopeQuery?.where, objectiveWorkItemLinks.workItemId));
  assert.ok(queryReferences(scopeQuery?.where, objectiveWorkItemLinks.workspaceId));
  assert.ok(queryReferences(scopeQuery?.where, workItems.id));
  assert.ok(queryReferences(scopeQuery?.where, workItems.workspaceId));
  assert.ok(queryReferences(scopeQuery?.where, workItems.deletedAt));
  assert.ok(queryParamValues(scopeQuery?.where).includes(objectiveId));
  assert.ok(queryParamValues(scopeQuery?.where).includes(workItemId));
  assert.ok(queryParamValues(scopeQuery?.where).includes(workspaceId));
});

test("R9.1 task plan repository reads through workspace scope with an honest item cap", async () => {
  const planRow = {
    id: planId,
    workItemId,
    workspaceId,
    status: "proposed",
    objectiveId: null,
    budgetJson: { total_share_pct: 100 },
    decompositionContextJson: { source: "test" },
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now
  };
  const firstItem = {
    id: firstItemId,
    planId,
    parentItemId: null,
    seq: 1,
    title: "查资料",
    role: "research",
    objectiveMd: "查清背景。",
    acceptanceMd: "列出来源。",
    budgetSharePct: 40,
    dependsOn: [],
    status: "pending",
    createdAt: now,
    updatedAt: now
  };
  const secondItem = {
    ...firstItem,
    id: secondItemId,
    seq: 2,
    title: "写初稿",
    role: "produce",
    budgetSharePct: 60,
    dependsOn: [firstItemId]
  };
  const { db, queries } = createQueryRecorder([
    [{ plan: planRow }],
    [firstItem, secondItem]
  ]);
  const repository = createTaskPlanRepository(db);

  const result = await repository.getPlanWithItems({
    planId,
    workspaceId,
    itemLimit: 1
  });

  assert.equal(result?.plan.id, planId);
  assert.equal(result?.itemsCapped, true);
  assert.equal(queries.length, 2);

  const [planQuery, itemQuery] = queries;
  assert.equal(planQuery?.fromTable, taskPlans);
  assert.deepEqual(planQuery?.joins.map((join) => [join.kind, join.table]), [
    ["inner", workItems]
  ]);
  assert.equal(planQuery?.limit, 1);
  assert.ok(queryReferences(planQuery?.where, taskPlans.id));
  assert.ok(queryReferences(planQuery?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(planQuery?.where, workItems.workspaceId));
  assert.ok(queryReferences(planQuery?.where, workItems.deletedAt));
  assert.ok(queryParamValues(planQuery?.where).includes(planId));
  assert.ok(queryParamValues(planQuery?.where).includes(workspaceId));

  assert.equal(itemQuery?.fromTable, taskPlanItems);
  assert.deepEqual(itemQuery?.joins.map((join) => [join.kind, join.table]), [
    ["inner", taskPlans]
  ]);
  assert.equal(itemQuery?.limit, 2);
  assert.ok(itemQuery && itemQuery.steps.indexOf("where") < itemQuery.steps.indexOf("limit"));
  // R9.7 redline: the old assertion only pinned task_plan_items.plan_id. Because
  // task_plan_items has no workspace_id, every child read must also prove the parent plan workspace.
  assert.ok(queryReferences(itemQuery?.where, taskPlanItems.planId));
  assert.ok(queryReferences(itemQuery?.where, taskPlans.workspaceId));
  assert.ok(queryParamValues(itemQuery?.where).includes(planId));
  assert.ok(queryParamValues(itemQuery?.where).includes(workspaceId));
  assert.deepEqual(result?.items, [firstItem]);
});

test("R9.1 task plan repository approves a draft only within the workspace and work item scope", async () => {
  const approvedRow = {
    id: planId,
    workItemId,
    workspaceId,
    status: "approved",
    objectiveId: null,
    budgetJson: {},
    decompositionContextJson: {},
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now
  };
  const { db, queries } = createQueryRecorder([[approvedRow]]);
  const repository = createTaskPlanRepository(db);

  const result = await repository.approvePlan({
    planId,
    workspaceId,
    workItemId,
    approvedAt: now
  });

  assert.equal(result?.id, planId);
  assert.equal(result?.status, "approved");
  assert.equal(queries.length, 1);
  const [query] = queries;
  assert.equal(query?.operation, "update");
  assert.equal(query?.targetTable, taskPlans);
  assert.deepEqual(query?.setValue, { status: "approved", updatedAt: now });
  assert.equal(query?.returningCalled, true);
  assert.ok(queryReferences(query?.where, taskPlans.id));
  assert.ok(queryReferences(query?.where, taskPlans.workspaceId));
  // R9.7: the old workspace-only assertion missed forged task-plan manifests that
  // approved a different work item's draft inside the same workspace.
  assert.ok(queryReferences(query?.where, taskPlans.workItemId));
  assert.ok(queryReferences(query?.where, taskPlans.status));
  assert.ok(queryParamValues(query?.where).includes(planId));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
  assert.ok(queryParamValues(query?.where).includes(workItemId));
  assert.ok(queryParamValues(query?.where).includes("draft"));
});

test("R9.1 task plan repository cancels only draft plans within the workspace scope", async () => {
  const cancelledRow = {
    id: planId,
    workItemId,
    workspaceId,
    status: "cancelled",
    objectiveId: null,
    budgetJson: {},
    decompositionContextJson: {},
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now
  };
  const { db, queries } = createQueryRecorder([[cancelledRow]]);
  const repository = createTaskPlanRepository(db);

  const result = await repository.cancelDraftPlan({
    planId,
    workspaceId,
    cancelledAt: now
  });

  assert.equal(result?.id, planId);
  assert.equal(result?.status, "cancelled");
  assert.equal(queries.length, 1);
  const [query] = queries;
  assert.equal(query?.operation, "update");
  assert.equal(query?.targetTable, taskPlans);
  assert.deepEqual(query?.setValue, { status: "cancelled", updatedAt: now });
  assert.equal(query?.returningCalled, true);
  assert.ok(queryReferences(query?.where, taskPlans.id));
  assert.ok(queryReferences(query?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(query?.where, taskPlans.status));
  assert.ok(queryParamValues(query?.where).includes(planId));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
  assert.ok(queryParamValues(query?.where).includes("draft"));
});

test("R9.2 task plan repository starts dispatching only approved plans within the workspace scope", async () => {
  const dispatchingRow = {
    id: planId,
    workItemId,
    workspaceId,
    status: "dispatching",
    objectiveId: null,
    budgetJson: {},
    decompositionContextJson: {},
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now
  };
  const { db, queries } = createQueryRecorder([[dispatchingRow]]);
  const repository = createTaskPlanRepository(db);

  const result = await repository.startDispatchingPlan({
    planId,
    workspaceId,
    startedAt: now
  });

  assert.equal(result?.id, planId);
  assert.equal(result?.status, "dispatching");
  const [query] = queries;
  assert.equal(query?.operation, "update");
  assert.equal(query?.targetTable, taskPlans);
  assert.deepEqual(query?.setValue, { status: "dispatching", updatedAt: now });
  assert.equal(query?.returningCalled, true);
  assert.ok(queryReferences(query?.where, taskPlans.id));
  assert.ok(queryReferences(query?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(query?.where, taskPlans.status));
  assert.ok(queryParamValues(query?.where).includes(planId));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
  assert.ok(queryParamValues(query?.where).includes("approved"));
});

test("R9.2 task plan repository uses CAS when marking items dispatched", async () => {
  const dispatchedItem = {
    id: firstItemId,
    planId,
    parentItemId: null,
    seq: 1,
    title: "查资料",
    role: "research",
    objectiveMd: "查清背景。",
    acceptanceMd: "列出来源。",
    budgetSharePct: 40,
    dependsOn: [],
    status: "dispatched",
    createdAt: now,
    updatedAt: now
  };
  const { db, queries } = createQueryRecorder([[dispatchedItem]]);
  const repository = createTaskPlanRepository(db);

  const result = await repository.markItemDispatched({
    planId,
    workspaceId,
    itemId: firstItemId,
    dispatchedAt: now
  });

  assert.equal(result?.id, firstItemId);
  assert.equal(result?.status, "dispatched");
  const [query] = queries;
  assert.equal(query?.operation, "update");
  assert.equal(query?.targetTable, taskPlanItems);
  assert.deepEqual(query?.setValue, { status: "dispatched", updatedAt: now });
  assert.equal(query?.returningCalled, true);
  // R9.7 redline: the pre-hardening CAS assertion only scoped by plan_id. Parent
  // workspace proof is required because task_plan_items does not carry workspace_id.
  assert.ok(queryReferences(query?.where, taskPlanItems.planId));
  assert.ok(queryReferences(query?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(query?.where, taskPlanItems.id));
  assert.ok(queryReferences(query?.where, taskPlanItems.status));
  assert.ok(queryParamValues(query?.where).includes(planId));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
  assert.ok(queryParamValues(query?.where).includes(firstItemId));
  assert.ok(queryParamValues(query?.where).includes("pending"));
});

test("R9.2 task plan repository settles only dispatched items", async () => {
  const succeededItem = {
    id: firstItemId,
    planId,
    parentItemId: null,
    seq: 1,
    title: "查资料",
    role: "research",
    objectiveMd: "查清背景。",
    acceptanceMd: "列出来源。",
    budgetSharePct: 40,
    dependsOn: [],
    status: "succeeded",
    createdAt: now,
    updatedAt: now
  };
  const { db, queries } = createQueryRecorder([[succeededItem]]);
  const repository = createTaskPlanRepository(db);

  const result = await repository.settleDispatchedItem({
    planId,
    workspaceId,
    itemId: firstItemId,
    status: "succeeded",
    settledAt: now
  });

  assert.equal(result?.id, firstItemId);
  assert.equal(result?.status, "succeeded");
  const [query] = queries;
  assert.equal(query?.operation, "update");
  assert.equal(query?.targetTable, taskPlanItems);
  assert.deepEqual(query?.setValue, { status: "succeeded", updatedAt: now });
  assert.equal(query?.returningCalled, true);
  // R9.7 redline: the old dispatched-item guard relied on plan_id alone; the
  // child update must also be tied back to the parent task_plans.workspace_id.
  assert.ok(queryReferences(query?.where, taskPlanItems.planId));
  assert.ok(queryReferences(query?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(query?.where, taskPlanItems.id));
  assert.ok(queryReferences(query?.where, taskPlanItems.status));
  assert.ok(queryParamValues(query?.where).includes(planId));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
  assert.ok(queryParamValues(query?.where).includes(firstItemId));
  assert.ok(queryParamValues(query?.where).includes("dispatched"));
});

test("R9.2 task plan repository skips pending items in one bounded set update", async () => {
  const skippedItem = {
    id: secondItemId,
    planId,
    parentItemId: null,
    seq: 2,
    title: "写初稿",
    role: "produce",
    objectiveMd: "写出初稿。",
    acceptanceMd: "初稿包含结论。",
    budgetSharePct: 60,
    dependsOn: [firstItemId],
    status: "skipped",
    createdAt: now,
    updatedAt: now
  };
  const { db, queries } = createQueryRecorder([[skippedItem]]);
  const repository = createTaskPlanRepository(db);

  const result = await repository.skipPendingItems({
    planId,
    workspaceId,
    itemIds: [secondItemId],
    skippedAt: now
  });

  assert.deepEqual(result.map((row) => row.id), [secondItemId]);
  const [query] = queries;
  assert.equal(query?.operation, "update");
  assert.equal(query?.targetTable, taskPlanItems);
  assert.deepEqual(query?.setValue, { status: "skipped", updatedAt: now });
  assert.equal(query?.returningCalled, true);
  // R9.7 redline: skipping pending children was previously bounded but not
  // workspace-pinned; the parent plan workspace is now part of the guard.
  assert.ok(queryReferences(query?.where, taskPlanItems.planId));
  assert.ok(queryReferences(query?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(query?.where, taskPlanItems.id));
  assert.ok(queryReferences(query?.where, taskPlanItems.status));
  assert.ok(queryParamValues(query?.where).includes(planId));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
  assert.ok(queryParamValues(query?.where).includes(secondItemId));
  assert.ok(queryParamValues(query?.where).includes("pending"));
});

test("R9.2 task plan repository marks dispatching plans done only within workspace scope", async () => {
  const doneRow = {
    id: planId,
    workItemId,
    workspaceId,
    status: "done",
    objectiveId: null,
    budgetJson: {},
    decompositionContextJson: {},
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now
  };
  const { db, queries } = createQueryRecorder([[doneRow]]);
  const repository = createTaskPlanRepository(db);

  const result = await repository.markPlanDone({
    planId,
    workspaceId,
    doneAt: now
  });

  assert.equal(result?.id, planId);
  assert.equal(result?.status, "done");
  const [query] = queries;
  assert.equal(query?.operation, "update");
  assert.equal(query?.targetTable, taskPlans);
  assert.deepEqual(query?.setValue, { status: "done", updatedAt: now });
  assert.equal(query?.returningCalled, true);
  assert.ok(queryReferences(query?.where, taskPlans.id));
  assert.ok(queryReferences(query?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(query?.where, taskPlans.status));
  assert.ok(queryParamValues(query?.where).includes(planId));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
  assert.ok(queryParamValues(query?.where).includes("dispatching"));
});

test("R9.6 task plan repository reads dashboard plans with capped batched joins", async () => {
  const planRow = {
    id: planId,
    workItemId,
    workspaceId,
    status: "dispatching",
    objectiveId,
    budgetJson: { max_cost_cny: "3.000000" },
    decompositionContextJson: { judge: { decision: "approve" } },
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now
  };
  const workItemRow = {
    id: workItemId,
    code: "DEMO-960",
    title: "竞品资料梳理",
    status: "ai_working"
  };
  const objectiveRow = {
    id: objectiveId,
    title: "季度上市策略",
    progressPercent: 40
  };
  const itemRow = {
    id: firstItemId,
    planId,
    parentItemId: null,
    seq: 1,
    title: "竞品调研",
    role: "research",
    objectiveMd: "查清背景。",
    acceptanceMd: "列出来源。",
    budgetSharePct: 50,
    dependsOn: [],
    status: "succeeded",
    createdAt: now,
    updatedAt: now
  };
  const runRow = {
    id: firstRunId,
    parentRunId: null,
    workItemId,
    workspaceId,
    taskPlanId: planId,
    taskPlanItemId: firstItemId,
    agentRole: "research",
    title: "竞品调研",
    status: "succeeded",
    costEstimate: "1.250000",
    outcomeReason: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: now
  };
  const escalationRow = {
    id: escalationId,
    workItemId,
    planId,
    runId: firstRunId,
    reasonMd: "证据互相冲突。",
    createdAt: now
  };
  const runlessEscalationRow = {
    id: runlessEscalationId,
    workItemId,
    planId,
    runId: null,
    reasonMd: "依赖图需要人工调整。",
    createdAt: now
  };
  const { db, queries } = createQueryRecorder([
    [{ plan: planRow, workItem: workItemRow, objective: objectiveRow }],
    [itemRow],
    [runRow],
    [escalationRow, runlessEscalationRow]
  ]);
  const repository = createTaskPlanRepository(db);

  const result = await repository.listDashboardPlans({
    workspaceId,
    planLimit: 1,
    itemLimit: 2,
    runLimit: 3,
    escalationLimit: 2
  });

  assert.equal(result.plans[0]?.plan.id, planId);
  assert.equal(result.plansCapped, false);
  assert.equal(result.itemsCapped, false);
  assert.equal(result.runsCapped, false);
  assert.equal(result.escalationsCapped, false);
  assert.equal(queries.length, 4);

  const [planQuery, itemQuery, runQuery, escalationQuery] = queries;
  assert.equal(planQuery?.fromTable, taskPlans);
  assert.deepEqual(planQuery?.joins.map((join) => [join.kind, join.table]), [
    ["inner", workItems],
    ["left", objectives]
  ]);
  assert.equal(planQuery?.limit, 2);
  assert.ok(queryReferences(planQuery?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(planQuery?.where, workItems.workspaceId));
  assert.ok(queryReferences(planQuery?.where, workItems.deletedAt));
  assert.ok(queryParamValues(planQuery?.where).includes(workspaceId));
  assert.ok(queryParamValues(planQuery?.where).includes("dispatching"));

  assert.equal(itemQuery?.fromTable, taskPlanItems);
  assert.deepEqual(itemQuery?.joins.map((join) => [join.kind, join.table]), [
    ["inner", taskPlans]
  ]);
  assert.equal(itemQuery?.limit, 3);
  // R9.7 redline: dashboard child reads used the already-visible plan id list
  // but did not independently pin the parent workspace in SQL.
  assert.ok(queryReferences(itemQuery?.where, taskPlanItems.planId));
  assert.ok(queryReferences(itemQuery?.where, taskPlans.workspaceId));
  assert.ok(queryParamValues(itemQuery?.where).includes(planId));
  assert.ok(queryParamValues(itemQuery?.where).includes(workspaceId));

  assert.equal(runQuery?.fromTable, agentRuns);
  assert.equal(runQuery?.limit, 4);
  assert.ok(queryReferences(runQuery?.where, agentRuns.workspaceId));
  assert.ok(queryReferences(runQuery?.where, agentRuns.taskPlanId));
  assert.ok(queryParamValues(runQuery?.where).includes(workspaceId));

  assert.equal(escalationQuery?.fromTable, escalationEvents);
  // R9.7: dependency/cycle escalations are plan-level and intentionally have no
  // agent_run_id, so the dashboard query must not inner-join them away.
  assert.deepEqual(escalationQuery?.joins.map((join) => [join.kind, join.table]), [
    ["left", agentRuns],
    ["inner", workItems],
    ["left", taskPlans]
  ]);
  assert.equal(escalationQuery?.limit, 3);
  const [, , planLevelJoin] = escalationQuery?.joins ?? [];
  assert.ok(queryReferences(planLevelJoin?.on, taskPlans.id));
  assert.ok(queryReferences(planLevelJoin?.on, taskPlans.workItemId));
  assert.ok(queryReferences(planLevelJoin?.on, taskPlans.workspaceId));
  assert.ok(queryReferences(planLevelJoin?.on, escalationEvents.handoffJson));
  assert.ok(queryReferences(escalationQuery?.where, workItems.workspaceId));
  assert.ok(queryReferences(escalationQuery?.where, escalationEvents.resolvedAt));
  assert.ok(queryReferences(escalationQuery?.where, agentRuns.taskPlanId));
  assert.ok(queryReferences(escalationQuery?.where, taskPlans.id));
  assert.ok(queryParamValues(escalationQuery?.where).includes(workspaceId));
  assert.deepEqual(result.items.map((item) => item.id), [firstItemId]);
  assert.deepEqual(result.runs.map((run) => run.id), [firstRunId]);
  assert.deepEqual(result.escalations.map((escalation) => escalation.id), [escalationId, runlessEscalationId]);
});
