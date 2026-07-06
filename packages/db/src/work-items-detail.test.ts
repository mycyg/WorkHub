import assert from "node:assert/strict";
import test from "node:test";

import { createWorkItemRepository } from "./repositories/work-items.js";
import {
  agentRuns,
  taskPlanItems,
  taskPlans,
  workItems
} from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

const now = new Date("2026-07-03T00:00:00.000Z");
const workItemId = "93000000-0000-4000-8000-000000000201";
const projectId = "93000000-0000-4000-8000-000000000101";
const workspaceId = "93000000-0000-4000-8000-000000000001";
const submitterId = "93000000-0000-4000-8000-000000000301";
const planId = "93000000-0000-4000-8000-000000000901";
const researchId = "93000000-0000-4000-8000-000000000902";
const produceId = "93000000-0000-4000-8000-000000000903";

test("R9.1 work item detail reads the latest task plan through workspace scope with capped items", async () => {
  const workItem = {
    id: workItemId,
    code: "DEMO-PLAN",
    projectId,
    workspaceId,
    submitterUserId: submitterId,
    claimedByUserId: null,
    title: "调研并产出短剧选题报告",
    rawDescription: "调研+产出一篇短剧选题报告。",
    summaryMd: null,
    status: "in_review",
    priority: "normal",
    syncState: "pending",
    version: 1,
    mode: "worker",
    humanReserved: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
  const plan = {
    id: planId,
    workItemId,
    workspaceId,
    status: "approved",
    objectiveId: null,
    budgetJson: { total_share_pct: 100 },
    decompositionContextJson: { source: "meta_planner" },
    createdByUserId: submitterId,
    createdAt: now,
    updatedAt: now
  };
  const item = {
    id: researchId,
    planId,
    parentItemId: null,
    seq: 1,
    title: "整理竞品证据",
    role: "research",
    objectiveMd: "查清三类竞品的最新打法。",
    acceptanceMd: "列出至少 3 条可核验来源。",
    budgetSharePct: 35,
    dependsOn: [],
    status: "pending",
    createdAt: now,
    updatedAt: now
  };
  const { db, queries } = createQueryRecorder([
    [{
      workItem,
      projectName: "Demo",
      projectOwnerUserId: submitterId,
      projectWorkspaceId: workspaceId,
      projectArchived: false,
      projectDeletedAt: null
    }],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [{ plan }],
    [item]
  ]);
  const repository = createWorkItemRepository(db);

  const result = await repository.readWorkItemDetail(workItemId);

  assert.equal(result?.taskPlan?.plan.id, planId);
  assert.deepEqual(result?.taskPlan?.items, [item]);
  assert.equal(result?.taskPlan?.itemsCapped, false);

  const taskPlanQuery = queries.find((query) => query.fromTable === taskPlans);
  assert.ok(taskPlanQuery, "task plan query should run after the work item workspace is known");
  assert.equal(taskPlanQuery.limit, 1);
  assert.ok(queryReferences(taskPlanQuery.where, taskPlans.workItemId));
  assert.ok(queryReferences(taskPlanQuery.where, taskPlans.workspaceId));
  assert.ok(queryReferences(taskPlanQuery.where, taskPlans.status));
  assert.ok(queryParamValues(taskPlanQuery.where).includes(workItemId));
  assert.ok(queryParamValues(taskPlanQuery.where).includes(workspaceId));
  assert.ok(queryParamValues(taskPlanQuery.where).includes("cancelled"));

  const itemQuery = queries.find((query) => query.fromTable === taskPlanItems);
  assert.equal(itemQuery?.limit, 51);
  assert.ok(queryReferences(itemQuery?.where, taskPlanItems.planId));
  assert.ok(queryParamValues(itemQuery?.where).includes(planId));
  assert.equal(queries[0]?.fromTable, workItems);
});

test("R9.2 work item detail reads child runs for the latest task plan with a capped plan-scoped query", async () => {
  const workItem = {
    id: workItemId,
    code: "DEMO-PLAN",
    projectId,
    workspaceId,
    submitterUserId: submitterId,
    claimedByUserId: null,
    title: "调研并产出短剧选题报告",
    rawDescription: "调研+产出一篇短剧选题报告。",
    summaryMd: null,
    status: "ai_working",
    priority: "normal",
    syncState: "pending",
    version: 1,
    mode: "worker",
    humanReserved: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
  const plan = {
    id: planId,
    workItemId,
    workspaceId,
    status: "dispatching",
    objectiveId: null,
    budgetJson: { total_share_pct: 100, max_cost_cny: "3.000000" },
    decompositionContextJson: { source: "meta_planner" },
    createdByUserId: submitterId,
    createdAt: now,
    updatedAt: now
  };
  const research = {
    id: researchId,
    planId,
    parentItemId: null,
    seq: 1,
    title: "整理竞品证据",
    role: "research",
    objectiveMd: "查清三类竞品的最新打法。",
    acceptanceMd: "列出至少 3 条可核验来源。",
    budgetSharePct: 35,
    dependsOn: [],
    status: "succeeded",
    createdAt: now,
    updatedAt: now
  };
  const produce = {
    id: produceId,
    planId,
    parentItemId: null,
    seq: 2,
    title: "产出短报告",
    role: "produce",
    objectiveMd: "把证据整理成短报告。",
    acceptanceMd: "报告包含结论、证据和下一步建议。",
    budgetSharePct: 65,
    dependsOn: [researchId],
    status: "dispatched",
    createdAt: now,
    updatedAt: now
  };
  const researchRun = {
    id: "93000000-0000-4000-8000-000000000911",
    parentRunId: null,
    workItemId,
    taskPlanId: planId,
    taskPlanItemId: researchId,
    agentRole: "research",
    title: "整理竞品证据",
    status: "succeeded",
    costEstimate: "0.450000",
    outcomeReason: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: now
  };
  const produceRun = {
    id: "93000000-0000-4000-8000-000000000912",
    parentRunId: null,
    workItemId,
    taskPlanId: planId,
    taskPlanItemId: produceId,
    agentRole: "produce",
    title: "产出短报告",
    status: "running",
    costEstimate: "0.250000",
    outcomeReason: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null
  };
  const { db, queries } = createQueryRecorder([
    [{
      workItem,
      projectName: "Demo",
      projectOwnerUserId: submitterId,
      projectWorkspaceId: workspaceId,
      projectArchived: false,
      projectDeletedAt: null
    }],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [{ plan }],
    [research, produce],
    [researchRun, produceRun]
  ]);
  const repository = createWorkItemRepository(db);

  const result = await repository.readWorkItemDetail(workItemId);

  assert.deepEqual(result?.taskPlan?.runs, [researchRun, produceRun]);
  assert.equal(result?.taskPlan?.runsCapped, false);

  const runQuery = queries.find((query) => query.fromTable === agentRuns && query.limit === 101);
  assert.ok(runQuery, "task plan run tree query should be capped and scoped to the latest plan");
  assert.ok(queryReferences(runQuery.where, agentRuns.workItemId));
  assert.ok(queryReferences(runQuery.where, agentRuns.taskPlanId));
  assert.ok(queryParamValues(runQuery.where).includes(workItemId));
  assert.ok(queryParamValues(runQuery.where).includes(planId));
});
