import assert from "node:assert/strict";
import test from "node:test";

import { createWorkItemRepository } from "./repositories/work-items.js";
import {
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
