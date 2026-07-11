import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentRunRepository,
  type AgentRunRow,
  type AgentStepRow
} from "./repositories/agent-runs.js";
import { agentRuns, agentSteps, taskPlanItems } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

const now = new Date("2026-07-04T00:00:00.000Z");
const workspaceId = "00000000-0000-4000-8000-000000000001";
const workItemId = "50000000-0000-4000-8000-000000000001";
const actorUserId = "10000000-0000-4000-8000-000000000001";
const taskPlanId = "81000000-0000-4000-8000-000000000001";

function runRow(id: string, taskPlanItemId: string): AgentRunRow {
  return {
    id,
    orgId: null,
    workspaceId,
    workItemId,
    branchId: null,
    parentRunId: null,
    taskPlanId,
    taskPlanItemId,
    taskPlanItemEpoch: 0,
    objectiveId: null,
    agentRole: "produce",
    objectiveMd: null,
    mode: "worker",
    actor: "human",
    actorUserId,
    title: "Recovered child run",
    status: "succeeded",
    model: "deepseek-v4-flash",
    turnsUsed: 1,
    maxTurns: 15,
    totalTimeoutS: 300,
    maxTokens: 120000,
    maxCostCny: "5",
    seconds: 1,
    tokenIn: 1,
    tokenOut: 1,
    costEstimate: "0",
    budgetDecisionJson: {},
    outcomeReason: null,
    handoffMd: null,
    handoffJson: null,
    workdirRef: null,
    claimedBy: null,
    claimedAt: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
    executionHint: "server",
    sourceConversationId: null,
    sourceActionCardItemId: null,
    recoverAttempts: 0,
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now
  };
}

function stepRow(id: string, agentRunId: string): AgentStepRow {
  return {
    id,
    agentRunId,
    seq: 1,
    stepNo: 1,
    phase: "final",
    toolName: null,
    inputJson: {},
    outputExcerpt: "Done.",
    controlSignal: "stop",
    snapshotId: null,
    createdAt: now
  };
}

test("R9.7 agent run repository lists unsettled task-plan terminal runs with a dispatched-item cap", async () => {
  const firstRun = runRow("40000000-0000-4000-8000-000000000071", "81000000-0000-4000-8000-000000000071");
  const secondRun = runRow("40000000-0000-4000-8000-000000000072", "81000000-0000-4000-8000-000000000072");
  const firstStep = stepRow("41000000-0000-4000-8000-000000000071", firstRun.id);
  const secondStep = stepRow("41000000-0000-4000-8000-000000000072", secondRun.id);
  const { db, queries } = createQueryRecorder([
    [{ run: firstRun }, { run: secondRun }],
    [firstStep, secondStep]
  ]);
  const repository = createAgentRunRepository(db);

  const rows = await repository.listUnsettledTaskPlanRuns({ limit: 250 });

  assert.deepEqual(rows.map((row) => row.run.id), [firstRun.id, secondRun.id]);
  assert.deepEqual(rows[0]?.steps.map((step) => step.id), [firstStep.id]);
  assert.deepEqual(rows[1]?.steps.map((step) => step.id), [secondStep.id]);
  assert.equal(queries.length, 2, "unsettled recovery should batch-load steps instead of querying per run");

  const [runQuery, stepQuery] = queries;
  assert.equal(runQuery?.operation, "select");
  assert.equal(runQuery?.fromTable, agentRuns);
  assert.deepEqual(runQuery?.joins.map((join) => [join.kind, join.table]), [["inner", taskPlanItems]]);
  assert.equal(runQuery?.limit, 100);
  assert.ok(queryReferences(runQuery?.where, agentRuns.status));
  assert.ok(queryReferences(runQuery?.where, taskPlanItems.status));
  assert.ok(queryReferences(runQuery?.joins[0]?.on, taskPlanItems.id));
  assert.ok(queryReferences(runQuery?.joins[0]?.on, agentRuns.taskPlanItemId));
  assert.ok(queryParamValues(runQuery?.where).includes("dispatched"));
  assert.ok(queryParamValues(runQuery?.where).includes("succeeded"));

  assert.equal(stepQuery?.operation, "select");
  assert.equal(stepQuery?.fromTable, agentSteps);
  assert.ok(queryReferences(stepQuery?.where, agentSteps.agentRunId));
});
