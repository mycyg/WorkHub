import assert from "node:assert/strict";
import test from "node:test";

import { createTaskPlanRepository } from "./repositories/task-plans.js";
import {
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
  assert.deepEqual(result?.items, [firstItem]);
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
  assert.equal(itemQuery?.limit, 2);
  assert.ok(itemQuery && itemQuery.steps.indexOf("where") < itemQuery.steps.indexOf("limit"));
  assert.ok(queryReferences(itemQuery?.where, taskPlanItems.planId));
  assert.ok(queryParamValues(itemQuery?.where).includes(planId));
});

test("R9.1 task plan repository approves a draft only within the workspace scope", async () => {
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
  assert.ok(queryReferences(query?.where, taskPlans.status));
  assert.ok(queryParamValues(query?.where).includes(planId));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
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
  assert.ok(queryReferences(query?.where, taskPlanItems.planId));
  assert.ok(queryReferences(query?.where, taskPlanItems.id));
  assert.ok(queryReferences(query?.where, taskPlanItems.status));
  assert.ok(queryParamValues(query?.where).includes(planId));
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
  assert.ok(queryReferences(query?.where, taskPlanItems.planId));
  assert.ok(queryReferences(query?.where, taskPlanItems.id));
  assert.ok(queryReferences(query?.where, taskPlanItems.status));
  assert.ok(queryParamValues(query?.where).includes(planId));
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
    itemIds: [secondItemId],
    skippedAt: now
  });

  assert.deepEqual(result.map((row) => row.id), [secondItemId]);
  const [query] = queries;
  assert.equal(query?.operation, "update");
  assert.equal(query?.targetTable, taskPlanItems);
  assert.deepEqual(query?.setValue, { status: "skipped", updatedAt: now });
  assert.equal(query?.returningCalled, true);
  assert.ok(queryReferences(query?.where, taskPlanItems.planId));
  assert.ok(queryReferences(query?.where, taskPlanItems.id));
  assert.ok(queryReferences(query?.where, taskPlanItems.status));
  assert.ok(queryParamValues(query?.where).includes(planId));
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
