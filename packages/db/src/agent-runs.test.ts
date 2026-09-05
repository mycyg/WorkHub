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
    remindersJson: null,
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

// INF-05（取消竞态）：cancelActiveRun 只翻 status、不摘 claimedBy，worker 随后落终态的 UPDATE 仅凭
// claimedBy fencing 仍能命中，把 cancelled 覆盖回 succeeded。终态 + fencing 的 UPDATE 现在必须额外带
// status='running' 谓词；行已不在 running 即命中 0 行，调用方走 lost-claim 出口。
test("INF-05: a fenced terminal updateRun carries a status='running' predicate", async () => {
  const runId = "40000000-0000-4000-8000-0000000000d1";
  const workerId = "worker-cancel-race";
  const base = {
    runId,
    workspaceId,
    workItemId,
    actorUserId,
    mode: "worker" as const,
    title: "Terminal fenced write",
    model: "deepseek-v4-flash",
    budget: { maxSteps: 15, totalTimeoutS: 300, maxTokens: 120000, maxCostCny: "5" },
    budgetDecisionJson: {},
    usage: { stepsUsed: 1, tokenIn: 1, tokenOut: 1, estimatedCostCny: "0" },
    createdAt: now,
    updatedAt: now
  };
  const { db, queries } = createQueryRecorder([[runRow(runId, "81000000-0000-4000-8000-0000000000d1")]]);
  const repository = createAgentRunRepository(db);

  await repository.updateRun({ ...base, status: "succeeded" }, workerId);

  const terminalQuery = queries.at(-1);
  assert.equal(terminalQuery?.operation, "update");
  assert.equal(terminalQuery?.targetTable, agentRuns);
  assert.ok(queryReferences(terminalQuery?.where, agentRuns.claimedBy));
  assert.ok(queryReferences(terminalQuery?.where, agentRuns.status));
  assert.ok(queryParamValues(terminalQuery?.where).includes(runId));
  assert.ok(queryParamValues(terminalQuery?.where).includes(workerId));
  assert.ok(
    queryParamValues(terminalQuery?.where).includes("running"),
    "fenced terminal writes must require the row to still be running"
  );
});

test("INF-05: non-terminal or unfenced updateRun writes keep the old predicates", async () => {
  const runId = "40000000-0000-4000-8000-0000000000d2";
  const workerId = "worker-mid-run";
  const base = {
    runId,
    workspaceId,
    workItemId,
    actorUserId,
    mode: "worker" as const,
    title: "Mid-run fenced write",
    model: "deepseek-v4-flash",
    budget: { maxSteps: 15, totalTimeoutS: 300, maxTokens: 120000, maxCostCny: "5" },
    budgetDecisionJson: {},
    usage: { stepsUsed: 0, tokenIn: 0, tokenOut: 0, estimatedCostCny: "0" },
    createdAt: now,
    updatedAt: now
  };
  const { db, queries } = createQueryRecorder([
    [runRow(runId, "81000000-0000-4000-8000-0000000000d2")],
    [runRow(runId, "81000000-0000-4000-8000-0000000000d2")]
  ]);
  const repository = createAgentRunRepository(db);

  // 非终态 + fencing（执行中的进度写）：只按 id + claimedBy 收窄，不得多出 status 谓词。
  await repository.updateRun({ ...base, status: "running" }, workerId);
  const midRunQuery = queries.at(-1);
  assert.deepEqual(queryParamValues(midRunQuery?.where).sort(), [runId, workerId].sort());

  // 终态但无 fencing（enqueue 补偿等非执行路径）：只按 id，保持原无守卫语义。
  await repository.updateRun({ ...base, status: "failed" });
  const unfencedQuery = queries.at(-1);
  assert.deepEqual(queryParamValues(unfencedQuery?.where), [runId]);
});

// R26 批 B6b（重复动作提醒的持久化）：agent_runs.reminders_json 的写入侧。钉两件事——
// (a) 调用方带了 remindersJson 时，INSERT / UPDATE 都真的把它写进这一列（漏掉就等于提醒只活在内存里，
//     worker 一换人、回放页一打开就什么都看不到）；
// (b) 调用方没带时，UPDATE 的 set 里**不出现**这个键——drizzle 跳过 undefined，已存的提醒不会被
//     一次无关的进度写清成 null。
test("R26-B6b agent run repository writes reminders_json on insert and update, and leaves it alone when absent", async () => {
  const runId = "40000000-0000-4000-8000-0000000000e1";
  const reminders = [
    { step_no: 3, tier: 1, repeats: 3, shape: "identical", tool_id: "read_file" }
  ];
  const base = {
    runId,
    workspaceId,
    workItemId,
    actorUserId,
    mode: "worker" as const,
    status: "running" as const,
    title: "Repeat-reminded run",
    model: "deepseek-v4-flash",
    budget: { maxSteps: 15, totalTimeoutS: 300, maxTokens: 120000, maxCostCny: "5" },
    budgetDecisionJson: {},
    usage: { stepsUsed: 3, tokenIn: 3, tokenOut: 3, estimatedCostCny: "0" },
    createdAt: now,
    updatedAt: now
  };
  const row = runRow(runId, "81000000-0000-4000-8000-0000000000e1");
  const { db, queries } = createQueryRecorder([[row], [row], [row]]);
  const repository = createAgentRunRepository(db);

  await repository.createRun({ ...base, remindersJson: reminders });
  const insert = queries.at(-1);
  assert.equal(insert?.operation, "insert");
  assert.equal(insert?.targetTable, agentRuns);
  assert.deepEqual((insert?.valuesValue as Record<string, unknown>).remindersJson, reminders);

  await repository.updateRun({ ...base, remindersJson: reminders });
  const update = queries.at(-1);
  assert.equal(update?.operation, "update");
  assert.deepEqual((update?.setValue as Record<string, unknown>).remindersJson, reminders);

  await repository.updateRun(base);
  const untouched = queries.at(-1);
  assert.equal(
    "remindersJson" in (untouched?.setValue as Record<string, unknown>)
      && (untouched?.setValue as Record<string, unknown>).remindersJson !== undefined,
    false,
    "没带提醒的进度写不许把已存的 reminders_json 清空"
  );
});
