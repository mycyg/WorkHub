import assert from "node:assert/strict";
import test from "node:test";

import { createWorkItemRepository } from "./repositories/work-items.js";
import {
  acceptedDeliverableChanges,
  actionCardItems,
  agentRuns,
  auditLogs,
  projectDriveItems,
  projectDriveOperations,
  projectDriveVersions,
  reviews,
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
const acceptedChangeId = "93000000-0000-4000-8000-000000000904";
const previousAcceptedChangeId = "93000000-0000-4000-8000-000000000905";
const currentDriveItemId = "93000000-0000-4000-8000-000000000906";
const previousDriveItemId = "93000000-0000-4000-8000-000000000907";
const currentDriveVersionId = "93000000-0000-4000-8000-000000000908";
const previousDriveVersionId = "93000000-0000-4000-8000-000000000909";

function acceptedDeliverable(overrides: Record<string, unknown> = {}) {
  return {
    id: acceptedChangeId,
    workItemId,
    projectId,
    proposalId: "93000000-0000-4000-8000-000000000910",
    branchId: null,
    changeId: "change-1",
    targetKind: "file",
    targetEntityType: "project_drive_item",
    targetEntityId: null,
    targetPath: "outputs/report.md",
    targetKey: "delivery:/outputs/report.md",
    changeType: "replace",
    acceptedVersion: 3,
    baseVersionRef: null,
    acceptedRef: "outputs/report.md",
    driveItemId: currentDriveItemId,
    driveVersionId: currentDriveVersionId,
    sha256Before: "before-current",
    sha256After: "after-current",
    previewRefJson: null,
    manifestChangeJson: { kind: "file" },
    supersededAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

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

test("accepted deliverable restore finds previous versions by project target instead of same drive item", async () => {
  const currentAccepted = acceptedDeliverable();
  const previousAccepted = acceptedDeliverable({
    id: previousAcceptedChangeId,
    workItemId: "93000000-0000-4000-8000-000000000999",
    driveItemId: previousDriveItemId,
    driveVersionId: previousDriveVersionId,
    acceptedVersion: 2,
    sha256After: "after-previous",
    supersededAt: now
  });
  const { db, queries, transactions } = createQueryRecorder([
    [{ projectId }],
    [],
    [{
      accepted: currentAccepted,
      driveItem: {
        id: currentDriveItemId,
        projectId,
        currentVersionId: currentDriveVersionId,
        deletedAt: null
      },
      driveVersion: { id: currentDriveVersionId }
    }],
    [{
      accepted: previousAccepted,
      driveItem: {
        id: previousDriveItemId,
        projectId,
        currentVersionId: previousDriveVersionId,
        deletedAt: null
      },
      driveVersion: { id: previousDriveVersionId }
    }],
    [],
    [],
    [],
    [],
    [],
    []
  ]);
  const repository = createWorkItemRepository(db);

  await repository.restoreAcceptedDeliverable({
    workItemId,
    acceptedChangeId,
    actorKind: "human",
    actorUserId: submitterId,
    at: now
  });

  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  const previousVersionQuery = queries.find((query) =>
    query.fromTable === acceptedDeliverableChanges &&
    query.orderBy.length === 2 &&
    query.limit === 1
  );
  assert.ok(previousVersionQuery, "restore should query the previous accepted version");
  assert.deepEqual(previousVersionQuery.joins.map((join) => [join.kind, join.table]), [
    ["left", projectDriveItems],
    ["left", projectDriveVersions]
  ]);
  // R9.7: the old assertion grepped repository source for absence of a current-drive-item predicate.
  // That was wrong because source text did not prove the actual restore query can cross drive items
  // while staying scoped to the same project target and earlier accepted version.
  assert.ok(queryReferences(previousVersionQuery.where, acceptedDeliverableChanges.projectId));
  assert.ok(queryReferences(previousVersionQuery.where, acceptedDeliverableChanges.targetKey));
  assert.ok(queryReferences(previousVersionQuery.where, acceptedDeliverableChanges.acceptedVersion));
  assert.ok(queryReferences(previousVersionQuery.where, acceptedDeliverableChanges.supersededAt));
  assert.ok(queryReferences(previousVersionQuery.where, acceptedDeliverableChanges.driveVersionId));
  assert.ok(queryReferences(previousVersionQuery.where, projectDriveItems.id));
  assert.ok(queryReferences(previousVersionQuery.where, projectDriveItems.deletedAt));
  assert.equal(queryReferences(previousVersionQuery.where, acceptedDeliverableChanges.driveItemId), false);
  assert.equal(queryParamValues(previousVersionQuery.where).includes(currentDriveItemId), false);
  assert.ok(queryParamValues(previousVersionQuery.where).includes(projectId));
  assert.ok(queryParamValues(previousVersionQuery.where).includes(currentAccepted.targetKey));
  assert.ok(queryParamValues(previousVersionQuery.where).includes(currentAccepted.acceptedVersion));

  const insertedAccepted = queries.find((query) =>
    query.operation === "insert" && query.targetTable === acceptedDeliverableChanges
  );
  assert.equal((insertedAccepted?.valuesValue as { driveItemId?: string } | undefined)?.driveItemId, previousDriveItemId);
  assert.equal(queries.some((query) => query.operation === "update" && query.targetTable === projectDriveItems), false);
  assert.ok(queries.some((query) => query.operation === "insert" && query.targetTable === projectDriveOperations));
  assert.ok(queries.some((query) => query.operation === "insert" && query.targetTable === auditLogs));
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
    workspaceId,
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
    workspaceId,
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
  assert.ok(queryReferences(runQuery.where, agentRuns.workspaceId));
  assert.ok(queryReferences(runQuery.where, agentRuns.taskPlanId));
  assert.ok(queryParamValues(runQuery.where).includes(workItemId));
  assert.ok(queryParamValues(runQuery.where).includes(workspaceId));
  assert.ok(queryParamValues(runQuery.where).includes(planId));
});

// R13 批 P4：workitem detail batch-attaches reviewer_kind (from the latest approve review on the
// deliverable's proposal) and the observer action-card source (via action_card_items.work_item_id).
test("R13 P4 work item detail attaches reviewer_kind and the observer conversation source in one batch each", async () => {
  const workItem = {
    id: workItemId,
    code: "DEMO-OBSERVER",
    projectId,
    workspaceId,
    submitterUserId: submitterId,
    claimedByUserId: null,
    title: "由观察者创建的工单",
    rawDescription: null,
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
  const accepted = acceptedDeliverable({ acceptedVersion: 1 });
  const observerConversationId = "93000000-0000-4000-8000-000000000950";
  const observerCreatedAt = new Date("2026-07-05T00:00:00.000Z");
  const { db, queries } = createQueryRecorder([
    [{
      workItem,
      projectName: "Demo",
      projectOwnerUserId: submitterId,
      projectWorkspaceId: workspaceId,
      projectArchived: false,
      projectDeletedAt: null
    }],
    [], // latestRunRows
    [], // assignments
    [], // acceptance
    [], // latestProposals
    [{ accepted, driveItem: null, driveVersion: null }], // acceptedDeliverables
    [], // evidenceBindings
    [], // driveSourceComments
    [], // meetingSourceInsights
    [], // latestTaskPlans (none — no task plan queries follow)
    [], // approvalDecisionRows
    [{ proposalId: accepted.proposalId, reviewerKind: "ai" }], // reviews (reviewer_kind batch lookup)
    [{ conversationId: observerConversationId, createdAt: observerCreatedAt }] // action_card_items (observer source)
  ]);
  const repository = createWorkItemRepository(db);

  const result = await repository.readWorkItemDetail(workItemId);

  assert.equal(result?.acceptedDeliverables[0]?.reviewerKind, "ai");
  assert.deepEqual(result?.observerActionCardItem, {
    conversationId: observerConversationId,
    createdAt: observerCreatedAt
  });

  const reviewsQuery = queries.find((query) => query.fromTable === reviews);
  assert.ok(reviewsQuery, "should batch-query reviews for the accepted deliverables' proposal ids");
  assert.ok(queryReferences(reviewsQuery.where, reviews.proposalId));
  assert.ok(queryReferences(reviewsQuery.where, reviews.decision));
  assert.ok(queryParamValues(reviewsQuery.where).includes(accepted.proposalId));
  assert.ok(queryParamValues(reviewsQuery.where).includes("approve"));

  const actionCardQuery = queries.find((query) => query.fromTable === actionCardItems);
  assert.ok(actionCardQuery, "should query action_card_items by work_item_id for the observer source");
  assert.ok(queryReferences(actionCardQuery.where, actionCardItems.workItemId));
  assert.equal(actionCardQuery.limit, 1);
  assert.ok(queryParamValues(actionCardQuery.where).includes(workItemId));
});

test("R13 P4 work item detail leaves reviewer_kind undefined and observer source null with no matching rows", async () => {
  const workItem = {
    id: workItemId,
    code: "DEMO-NO-REVIEW",
    projectId,
    workspaceId,
    submitterUserId: submitterId,
    claimedByUserId: null,
    title: "无评审记录、非观察者创建的工单",
    rawDescription: null,
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
  const accepted = acceptedDeliverable({ acceptedVersion: 1 });
  const { db } = createQueryRecorder([
    [{
      workItem,
      projectName: "Demo",
      projectOwnerUserId: submitterId,
      projectWorkspaceId: workspaceId,
      projectArchived: false,
      projectDeletedAt: null
    }],
    [], // latestRunRows
    [], // assignments
    [], // acceptance
    [], // latestProposals
    [{ accepted, driveItem: null, driveVersion: null }], // acceptedDeliverables
    [], // evidenceBindings
    [], // driveSourceComments
    [], // meetingSourceInsights
    [], // latestTaskPlans
    [], // approvalDecisionRows
    [], // reviews — no approve review found for this proposal
    [] // action_card_items — this work item was not observer-created
  ]);
  const repository = createWorkItemRepository(db);

  const result = await repository.readWorkItemDetail(workItemId);

  assert.equal(result?.acceptedDeliverables[0]?.reviewerKind, undefined);
  assert.equal(result?.observerActionCardItem, null);
});
