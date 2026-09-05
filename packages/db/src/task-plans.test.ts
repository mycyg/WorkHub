import assert from "node:assert/strict";
import test from "node:test";

import { createTaskPlanArbitrationRepository } from "./repositories/task-plan-arbitration.js";
import { createTaskPlanRepository } from "./repositories/task-plans.js";
import {
  agentRuns,
  branches,
  escalationEvents,
  objectiveWorkItemLinks,
  objectives,
  proposals,
  taskPlanItems,
  taskPlans,
  workItems
} from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences, queryTextFragments } from "./test-query-recorder.js";

const now = new Date("2026-07-03T00:00:00.000Z");
const planId = "91000000-0000-4000-8000-000000000001";
const foreignPlanId = "91000000-0000-4000-8000-000000000005";
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
  const { db, queries } = createQueryRecorder([[{ workItemId }], []]);
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

  // R9.7 redline: the old assertion expected only scope + plan/item inserts. That was wrong
  // because it missed the duplicate-draft guard required for slow double-click retries.
  assert.equal(queries.length, 4);
  const [scopeQuery, duplicateQuery, planInsert, itemInsert] = queries;
  assert.equal(scopeQuery?.operation, "select");
  assert.equal(scopeQuery?.fromTable, workItems);
  assert.equal(scopeQuery?.limit, 1);
  assert.equal(scopeQuery?.lock, "update");
  assert.ok(queryReferences(scopeQuery?.where, workItems.id));
  assert.ok(queryReferences(scopeQuery?.where, workItems.workspaceId));
  assert.ok(queryReferences(scopeQuery?.where, workItems.deletedAt));
  assert.ok(queryParamValues(scopeQuery?.where).includes(workItemId));
  assert.ok(queryParamValues(scopeQuery?.where).includes(workspaceId));
  assert.equal(duplicateQuery?.operation, "select");
  assert.equal(duplicateQuery?.fromTable, taskPlans);
  assert.equal(duplicateQuery?.limit, 1);
  assert.ok(queryReferences(duplicateQuery?.where, taskPlans.workItemId));
  assert.ok(queryReferences(duplicateQuery?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(duplicateQuery?.where, taskPlans.status));
  assert.ok(queryParamValues(duplicateQuery?.where).includes(workItemId));
  assert.ok(queryParamValues(duplicateQuery?.where).includes(workspaceId));
  assert.ok(queryParamValues(duplicateQuery?.where).includes("draft"));
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

test("R9.7 task plan repository rejects duplicate draft plans for one work item", async () => {
  const { db, queries, transactions } = createQueryRecorder([[{ workItemId }], [{ id: planId }]]);
  const repository = createTaskPlanRepository(db);

  await assert.rejects(
    () => repository.createDraftPlan({
      id: foreignPlanId,
      workItemId,
      workspaceId,
      createdByUserId: userId,
      items: [],
      now
    }),
    { name: "TaskPlanDraftAlreadyExists" }
  );

  assert.equal(queries.length, 2);
  assert.equal(queries[0]?.lock, "update");
  assert.equal(queries[1]?.fromTable, taskPlans);
  assert.ok(queryReferences(queries[1]?.where, taskPlans.workItemId));
  assert.ok(queryReferences(queries[1]?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(queries[1]?.where, taskPlans.status));
  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "TaskPlanDraftAlreadyExists" }]);
});

test("R9.7 task plan repository rejects parent links outside the draft item graph", async () => {
  const { db, queries, transactions } = createQueryRecorder([[{ workItemId }], [], [], []]);
  const repository = createTaskPlanRepository(db);

  await assert.rejects(
    () => repository.createDraftPlan({
      id: planId,
      workItemId,
      workspaceId,
      createdByUserId: userId,
      items: [{
        id: firstItemId,
        parentItemId: foreignPlanId,
        seq: 1,
        title: "查资料",
        role: "research",
        objectiveMd: "查清背景。",
        acceptanceMd: "列出来源。",
        budgetSharePct: 40,
        dependsOn: []
      }],
      now
    }),
    { name: "TaskPlanItemGraphMismatch" }
  );

  assert.deepEqual(queries, []);
  assert.deepEqual(transactions, []);
});

test("R9.7 task plan repository rejects dependency links outside the draft item graph", async () => {
  const { db, queries, transactions } = createQueryRecorder([[{ workItemId }], [], [], []]);
  const repository = createTaskPlanRepository(db);

  await assert.rejects(
    () => repository.createDraftPlan({
      id: planId,
      workItemId,
      workspaceId,
      createdByUserId: userId,
      items: [{
        id: firstItemId,
        seq: 1,
        title: "查资料",
        role: "research",
        objectiveMd: "查清背景。",
        acceptanceMd: "列出来源。",
        budgetSharePct: 40,
        dependsOn: [secondItemId]
      }],
      now
    }),
    { name: "TaskPlanItemGraphMismatch" }
  );

  assert.deepEqual(queries, []);
  assert.deepEqual(transactions, []);
});

test("R9.1 task plan repository persists a linked objective only after scoped validation", async () => {
  const { db, queries, transactions } = createQueryRecorder([[{ workItemId }], [], [{ objectiveId }], []]);
  const repository = createTaskPlanRepository(db);

  await repository.createDraftPlan({
    id: planId,
    workItemId,
    workspaceId,
    objectiveId,
    createdByUserId: userId,
    budgetJson: { max_cost_cny: "8.000000" },
    decompositionContextJson: { objective: "linked" },
    items: [],
    now
  });

  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  assert.equal(queries.length, 4);
  const [workItemScopeQuery, duplicateQuery, objectiveScopeQuery, planInsert] = queries;
  assert.equal(workItemScopeQuery?.operation, "select");
  assert.equal(workItemScopeQuery?.fromTable, workItems);
  assert.equal(workItemScopeQuery?.lock, "update");
  assert.equal(duplicateQuery?.operation, "select");
  assert.equal(duplicateQuery?.fromTable, taskPlans);
  assert.equal(objectiveScopeQuery?.operation, "select");
  assert.equal(objectiveScopeQuery?.fromTable, objectives);
  assert.deepEqual(objectiveScopeQuery?.joins.map((join) => [join.kind, join.table]), [
    ["inner", objectiveWorkItemLinks],
    ["inner", workItems]
  ]);
  assert.ok(queryReferences(objectiveScopeQuery?.where, objectives.id));
  assert.ok(queryReferences(objectiveScopeQuery?.where, objectives.workspaceId));
  assert.ok(queryReferences(objectiveScopeQuery?.where, objectiveWorkItemLinks.objectiveId));
  assert.ok(queryReferences(objectiveScopeQuery?.where, objectiveWorkItemLinks.workItemId));
  assert.ok(queryReferences(objectiveScopeQuery?.where, objectiveWorkItemLinks.workspaceId));
  assert.ok(queryReferences(objectiveScopeQuery?.where, workItems.id));
  assert.ok(queryReferences(objectiveScopeQuery?.where, workItems.workspaceId));
  assert.ok(queryReferences(objectiveScopeQuery?.where, workItems.deletedAt));
  assert.ok(queryParamValues(objectiveScopeQuery?.where).includes(objectiveId));
  assert.ok(queryParamValues(objectiveScopeQuery?.where).includes(workItemId));
  assert.ok(queryParamValues(objectiveScopeQuery?.where).includes(workspaceId));
  assert.equal(planInsert?.operation, "insert");
  assert.equal(planInsert?.targetTable, taskPlans);
  // R9.7: the old schema assertion grepped migration 0040 for an objective FK.
  // That was wrong because migration source text did not prove draft-plan writes validate and persist
  // the objective only for the same workspace work item at runtime.
  assert.deepEqual(planInsert?.valuesValue, {
    id: planId,
    workItemId,
    workspaceId,
    status: "draft",
    objectiveId,
    budgetJson: { max_cost_cny: "8.000000" },
    decompositionContextJson: { objective: "linked" },
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now
  });
});

test("R9.7 task plan repository finds an existing draft in the same workspace work item", async () => {
  const draftPlan = {
    id: planId,
    workItemId,
    workspaceId,
    status: "draft",
    objectiveId: null,
    budgetJson: {},
    decompositionContextJson: {},
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now
  };
  const { db, queries } = createQueryRecorder([[{ plan: draftPlan }]]);
  const repository = createTaskPlanRepository(db);

  const found = await repository.findDraftPlanForWorkItem({ workItemId, workspaceId });

  assert.equal(found, draftPlan);
  const query = queries[0];
  assert.equal(query?.fromTable, taskPlans);
  assert.deepEqual(query?.joins.map((join) => [join.kind, join.table]), [["inner", workItems]]);
  assert.equal(query?.limit, 1);
  assert.ok(queryReferences(query?.where, taskPlans.workItemId));
  assert.ok(queryReferences(query?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(query?.where, taskPlans.status));
  assert.ok(queryReferences(query?.where, workItems.workspaceId));
  assert.ok(queryReferences(query?.where, workItems.deletedAt));
  assert.ok(queryParamValues(query?.where).includes(workItemId));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
  assert.ok(queryParamValues(query?.where).includes("draft"));
});

test("R9.7 task plan repository rejects draft plans for work items outside the workspace", async () => {
  const { db, queries, transactions } = createQueryRecorder([[]]);
  const repository = createTaskPlanRepository(db);

  await assert.rejects(
    () => repository.createDraftPlan({
      id: planId,
      workItemId,
      workspaceId,
      createdByUserId: userId,
      items: [],
      now
    }),
    { name: "TaskPlanWorkItemScopeMismatch" }
  );

  assert.equal(transactions[0]?.outcome, "rejected");
  assert.equal(transactions[0]?.errorName, "TaskPlanWorkItemScopeMismatch");
  assert.equal(queries.length, 1);
  const [scopeQuery] = queries;
  assert.equal(scopeQuery?.operation, "select");
  assert.equal(scopeQuery?.fromTable, workItems);
  assert.equal(scopeQuery?.limit, 1);
  assert.ok(queryReferences(scopeQuery?.where, workItems.id));
  assert.ok(queryReferences(scopeQuery?.where, workItems.workspaceId));
  assert.ok(queryReferences(scopeQuery?.where, workItems.deletedAt));
  assert.ok(queryParamValues(scopeQuery?.where).includes(workItemId));
  assert.ok(queryParamValues(scopeQuery?.where).includes(workspaceId));
});

test("R9.4 arbitration repository reads child proposals with plan workspace scope and hard cap", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const repository = createTaskPlanArbitrationRepository(db);

  await repository.listCandidates({
    planId,
    workspaceId,
    workItemId,
    limit: 9
  });

  assert.equal(queries.length, 1);
  const [query] = queries;
  assert.equal(query?.operation, "select");
  assert.equal(query?.fromTable, agentRuns);
  assert.deepEqual(query?.joins.map((join) => [join.kind, join.table]), [
    ["inner", taskPlanItems],
    ["inner", branches],
    ["inner", proposals]
  ]);
  assert.equal(query?.limit, 9);
  assert.ok(queryReferences(query?.where, agentRuns.taskPlanId));
  assert.ok(queryReferences(query?.where, agentRuns.workspaceId));
  assert.ok(queryReferences(query?.where, agentRuns.workItemId));
  assert.ok(queryReferences(query?.where, agentRuns.status));
  assert.ok(queryReferences(query?.joins[0]?.on, taskPlanItems.id));
  assert.ok(queryReferences(query?.joins[0]?.on, agentRuns.taskPlanItemId));
  assert.ok(queryReferences(query?.joins[0]?.on, taskPlanItems.planId));
  assert.ok(queryReferences(query?.joins[1]?.on, branches.agentRunId));
  assert.ok(queryReferences(query?.joins[1]?.on, agentRuns.id));
  assert.ok(queryReferences(query?.joins[1]?.on, branches.workItemId));
  assert.ok(queryReferences(query?.joins[2]?.on, proposals.branchId));
  assert.ok(queryReferences(query?.joins[2]?.on, branches.id));
  assert.ok(queryReferences(query?.joins[2]?.on, proposals.workItemId));
  assert.ok(queryReferences(query?.joins[2]?.on, proposals.status));
  assert.ok(queryParamValues(query?.where).includes(planId));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
  assert.ok(queryParamValues(query?.where).includes(workItemId));
  assert.ok(queryParamValues(query?.where).includes("succeeded"));
});

test("R9.7 task plan repository rejects objectives outside the plan work item scope", async () => {
  const { db, queries, transactions } = createQueryRecorder([[{ workItemId }], [], []]);
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
  // R9.7 redline: the old assertion only checked work-item + objective scoping. That
  // missed the duplicate-draft guard required before objective linkage on slow retries.
  assert.equal(queries.length, 3);
  const [workItemScopeQuery, duplicateQuery, scopeQuery] = queries;
  assert.equal(workItemScopeQuery?.operation, "select");
  assert.equal(workItemScopeQuery?.fromTable, workItems);
  assert.equal(workItemScopeQuery?.limit, 1);
  assert.equal(workItemScopeQuery?.lock, "update");
  assert.ok(queryReferences(workItemScopeQuery?.where, workItems.id));
  assert.ok(queryReferences(workItemScopeQuery?.where, workItems.workspaceId));
  assert.ok(queryReferences(workItemScopeQuery?.where, workItems.deletedAt));
  assert.ok(queryParamValues(workItemScopeQuery?.where).includes(workItemId));
  assert.ok(queryParamValues(workItemScopeQuery?.where).includes(workspaceId));
  assert.equal(duplicateQuery?.operation, "select");
  assert.equal(duplicateQuery?.fromTable, taskPlans);
  assert.ok(queryReferences(duplicateQuery?.where, taskPlans.workItemId));
  assert.ok(queryReferences(duplicateQuery?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(duplicateQuery?.where, taskPlans.status));
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
    workItemId,
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
  // API-01：取消必须带 workItemId 谓词——否则伪造提议可跨事项取消他人草稿（IDOR）。
  assert.ok(queryReferences(query?.where, taskPlans.workItemId));
  assert.ok(queryParamValues(query?.where).includes(planId));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
  assert.ok(queryParamValues(query?.where).includes(workItemId));
  assert.ok(queryParamValues(query?.where).includes("draft"));
});

test("API-01 task plan repository scopes draft lookup by work item for proposal validation", async () => {
  const draftRow = {
    id: planId,
    workItemId,
    workspaceId,
    status: "draft",
    objectiveId: null,
    budgetJson: {},
    decompositionContextJson: {},
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now
  };
  const { db, queries } = createQueryRecorder([[draftRow]]);
  const repository = createTaskPlanRepository(db);

  const result = await repository.findDraftPlanByIdAndWorkItem({ planId, workItemId });

  assert.equal(result?.id, planId);
  const [query] = queries;
  assert.ok(queryReferences(query?.where, taskPlans.id));
  assert.ok(queryReferences(query?.where, taskPlans.workItemId));
  assert.ok(queryReferences(query?.where, taskPlans.status));
  assert.ok(queryParamValues(query?.where).includes(planId));
  assert.ok(queryParamValues(query?.where).includes(workItemId));
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
  // B-R9.2-3：派发时代际 +1（SQL 表达式），set 里必须带 dispatchEpoch。
  const setValue = query?.setValue as { status?: string; updatedAt?: Date; dispatchEpoch?: unknown };
  assert.equal(setValue?.status, "dispatched");
  assert.equal(setValue?.updatedAt, now);
  assert.ok(setValue?.dispatchEpoch, "markItemDispatched must bump dispatch_epoch");
  assert.match(queryTextFragments(setValue.dispatchEpoch).join(""), /\+ 1/u);
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
  const [runJoin, , planLevelJoin] = escalationQuery?.joins ?? [];
  assert.ok(queryReferences(runJoin?.on, agentRuns.workspaceId));
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

// B-R9.6 §3.4：项目主页军团 pill 的取数——两条查询（计划批量 + 子任务 group by），
// 不逐计划 N+1；每个工作项只取最新活跃计划；两条都钉死 workspace/plan 作用域。
test("B-R9.6 task plan repository batches army progress reads without per-plan fan-out", async () => {
  const secondWorkItemId = "44444444-4444-4444-8444-4444444444f2";
  const newerPlanId = "55555555-5555-4555-8555-5555555555f1";
  const { db, queries } = createQueryRecorder([
    [
      { id: newerPlanId, workItemId },
      { id: planId, workItemId },
      { id: "55555555-5555-4555-8555-5555555555f2", workItemId: secondWorkItemId }
    ],
    [
      { planId: newerPlanId, totalItems: 4, doneItems: 2 },
      { planId: "55555555-5555-4555-8555-5555555555f2", totalItems: 0, doneItems: 0 }
    ]
  ]);
  const repository = createTaskPlanRepository(db);

  const progress = await repository.listArmyProgressByWorkItemIds({
    workspaceId,
    workItemIds: [workItemId, secondWorkItemId, workItemId]
  });

  assert.equal(queries.length, 2);
  const [planQuery, countQuery] = queries;
  assert.equal(planQuery?.fromTable, taskPlans);
  assert.ok(queryReferences(planQuery?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(planQuery?.where, taskPlans.workItemId));
  assert.ok(queryReferences(planQuery?.where, taskPlans.status));
  assert.ok(queryParamValues(planQuery?.where).includes(workspaceId));

  assert.equal(countQuery?.fromTable, taskPlanItems);
  assert.ok(queryReferences(countQuery?.where, taskPlanItems.planId));
  // 只对每个工作项的最新计划取计数（排序后首个），不把旧计划一并扫进来。
  assert.ok(queryParamValues(countQuery?.where).includes(newerPlanId));
  assert.ok(!queryParamValues(countQuery?.where).includes(planId));

  // 最新计划优先；total=0 的计划不产出 pill（诚实：没有子任务就没有进度可言）。
  // done 口径=仅 succeeded（与工作项面板/指挥台同口径，skipped 不算完成）。
  assert.deepEqual(progress.get(workItemId), { planId: newerPlanId, doneItems: 2, totalItems: 4 });
  assert.equal(progress.has(secondWorkItemId), false);

  // 空入参零查询。
  const before = queries.length;
  const empty = await repository.listArmyProgressByWorkItemIds({ workspaceId, workItemIds: [] });
  assert.equal(empty.size, 0);
  assert.equal(queries.length, before);
});

// B-R9.6 §3.1：暂停/恢复 CAS——暂停只吃 approved/dispatching，恢复只吃 paused，
// 两边都钉死 workspace 作用域；错状态返回 null（路由层转 409）。
test("B-R9.6 task plan repository pauses and resumes dispatch with status CAS in workspace scope", async () => {
  const pausedRow = { id: planId, status: "paused" };
  const { db, queries } = createQueryRecorder([[pausedRow]]);
  const repository = createTaskPlanRepository(db);
  const paused = await repository.pausePlan({ planId, workspaceId });
  assert.equal((paused as { status?: string } | null)?.status, "paused");
  const [pauseQuery] = queries;
  assert.ok(queryReferences(pauseQuery?.where, taskPlans.id));
  assert.ok(queryReferences(pauseQuery?.where, taskPlans.workspaceId));
  assert.ok(queryReferences(pauseQuery?.where, taskPlans.status));
  const pauseParams = queryParamValues(pauseQuery?.where);
  assert.ok(pauseParams.includes(planId));
  assert.ok(pauseParams.includes(workspaceId));
  assert.ok(pauseParams.includes("approved"));
  assert.ok(pauseParams.includes("dispatching"));
  assert.ok(!pauseParams.includes("done"));

  const resumedRow = { id: planId, status: "dispatching" };
  const resumeRecorder = createQueryRecorder([[resumedRow]]);
  const resumeRepository = createTaskPlanRepository(resumeRecorder.db);
  const resumed = await resumeRepository.resumePlan({ planId, workspaceId });
  assert.equal((resumed as { status?: string } | null)?.status, "dispatching");
  const [resumeQuery] = resumeRecorder.queries;
  const resumeParams = queryParamValues(resumeQuery?.where);
  assert.ok(resumeParams.includes(planId));
  assert.ok(resumeParams.includes(workspaceId));
  assert.ok(resumeParams.includes("paused"));

  // CAS 未命中（错状态被 where 挡掉，returning 空）→ null。
  const missRecorder = createQueryRecorder([[]]);
  const missRepository = createTaskPlanRepository(missRecorder.db);
  assert.equal(await missRepository.pausePlan({ planId, workspaceId }), null);
});
