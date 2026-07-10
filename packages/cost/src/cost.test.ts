import assert from "node:assert/strict";
import test from "node:test";

import { loadSettings } from "@workhub/config";

import {
  allowWithDefaultBudget,
  applyBudgetPolicyPatch,
  buildUsageRecord,
  chooseModelRoute,
  createMemoryBudgetPolicyStore,
  createMemoryCostLedgerStore,
  createMemoryUsageSink,
  decideRunBudget,
  defaultBudgetPoliciesFromSettings,
  defaultRunBudgetFromSettings,
  usageToLedgerEntry
} from "./index.js";

test("usage records estimate cost without serializing secrets", async () => {
  const sink = createMemoryUsageSink();
  const record = buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "worker",
    actorId: "run-1",
    inputTokens: 1000,
    outputTokens: 500,
    costTier: { inputCnyPerMtok: 2, outputCnyPerMtok: 8 },
    createdAt: new Date("2026-06-05T00:00:00.000Z")
  });

  await sink.recordUsage(record);

  assert.equal(record.estimatedCostCny, "0.006");
  assert.equal(JSON.stringify(record).includes("api_key"), false);
  assert.equal(sink.records.length, 1);
  assert.equal(usageToLedgerEntry(record, { kind: "user", userId: "user-1" }).tokenIn, 1000);
});

test("default budget mirrors P-COST v0 values from settings", () => {
  const settings = loadSettings({});
  const budget = defaultRunBudgetFromSettings(settings);
  const policies = defaultBudgetPoliciesFromSettings(settings);

  assert.equal(budget.maxSteps, 15);
  assert.equal(budget.totalTimeoutSeconds, 300);
  assert.equal(budget.maxTokens, 120000);
  assert.equal(budget.maxCostCny, "5");
  // R9.5 adds task/objective budgets as first-class default scopes; the old five-policy list was correct only
  // before child task plans and OKR objectives became budget boundaries.
  assert.deepEqual(policies.map((policy) => policy.id), [
    "pcost-workitem-run-v0",
    "pcost-task-run-v0",
    "pcost-objective-month-v0",
    "pcost-user-day-v0",
    "pcost-team-day-v0",
    "pcost-team-month-v0",
    "pcost-eval-day-v0"
  ]);
  assert.equal(policies.find((policy) => policy.id === "pcost-user-day-v0")?.maxTokens, 500000);
  assert.equal(policies.find((policy) => policy.id === "pcost-team-month-v0")?.maxCostCny, "2000");
  // eval 套件日预算现在有上限（此前 eval 在决策层无策略=无限）。
  assert.equal(policies.find((policy) => policy.id === "pcost-eval-day-v0")?.scopeKind, "eval");
  assert.equal(policies.find((policy) => policy.id === "pcost-eval-day-v0")?.maxCostCny, "80");
  assert.equal(allowWithDefaultBudget(settings, { provider: "deepseek", model: "m", reason: "default" }).allowed, true);
});

test("R9.5 task and objective scopes participate in ledger snapshots and budget decisions", async () => {
  const settings = loadSettings({});
  const taskPlanId = "95000000-0000-4000-8000-000000000501";
  const objectiveId = "95000000-0000-4000-8000-000000000502";
  const ledger = createMemoryCostLedgerStore({ teamId: "workspace-r95" });
  await ledger.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    task: "worker",
    runId: "95000000-0000-4000-8000-000000000503",
    workItemId: "95000000-0000-4000-8000-000000000504",
    userId: "95000000-0000-4000-8000-000000000505",
    workspaceId: "workspace-r95",
    taskPlanId,
    objectiveId,
    inputTokens: 900,
    outputTokens: 100,
    costTier: { inputCnyPerMtok: 1, outputCnyPerMtok: 1 },
    createdAt: new Date("2026-07-03T00:00:00.000Z")
  }));

  assert.deepEqual(ledger.entries.map((entry) => entry.scope.kind).sort(), [
    "objective",
    "task",
    "team",
    "user",
    "workitem"
  ]);
  // R9.7: the old DB schema assertion grepped migration 0037 for task/objective cost columns.
  // That was wrong because migration source text did not prove task/objective IDs flow through
  // runtime ledger entries and budget decisions.
  const taskEntry = ledger.entries.find((entry) => entry.scope.kind === "task");
  assert.equal(taskEntry?.taskPlanId, taskPlanId);
  assert.equal(taskEntry?.objectiveId, objectiveId);
  assert.deepEqual(taskEntry?.scope, { kind: "task", taskPlanId });
  const objectiveEntry = ledger.entries.find((entry) => entry.scope.kind === "objective");
  assert.equal(objectiveEntry?.taskPlanId, taskPlanId);
  assert.equal(objectiveEntry?.objectiveId, objectiveId);
  assert.deepEqual(objectiveEntry?.scope, { kind: "objective", objectiveId });
  const snapshots = await ledger.usageSnapshots({ taskPlanId, objectiveId }, {
    now: new Date("2026-07-03T00:00:00.000Z")
  });
  assert.equal(snapshots.find((snapshot) => snapshot.scope.kind === "task" && snapshot.period === "day")?.tokenIn, 900);
  assert.equal(snapshots.find((snapshot) => snapshot.scope.kind === "objective" && snapshot.period === "month")?.tokenOut, 100);

  const decision = decideRunBudget({
    settings,
    decisionId: "decision-r95-objective",
    now: new Date("2026-07-03T00:00:00.000Z"),
    scopeIds: { taskPlanId, objectiveId },
    policies: [
      {
        id: "pcost-objective-month-v0",
        scopeKind: "objective",
        period: "month",
        maxTokens: 1000,
        maxCostCny: "99",
        warningRatio: 0.8,
        criticalRatio: 0.95,
        onWarning: "notify",
        onExhausted: "block_new_run",
        modelRouteHint: "balanced",
        enabled: true,
        version: 1
      }
    ],
    usage: snapshots
  });

  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.limitingScope, { kind: "objective", objectiveId });
  assert.equal(decision.notice?.recommendedAction, "add_budget");
  assert.deepEqual(decision.notice?.options?.map((option) => option.id), [
    "add_budget",
    "finish_current_output",
    "close_scope"
  ]);
});

test("B-R9.5 task lifetime budget really exhausts through the total-period snapshot", async () => {
  // branch-review 护栏假：task 维度策略此前挂 period=run，而 run 快照恒 0——结构性
  // 永不超限。total 快照=plan 生命周期累计，累计超 cap 必须真 402。
  const settings = loadSettings({ BUDGET_DEFAULT_TASK_PLAN_COST_CNY: "10" });
  const taskPlanId = "95000000-0000-4000-8000-000000000601";
  const ledger = createMemoryCostLedgerStore({ teamId: "workspace-r95" });
  // 两个子 run 累计花掉 ¥12（超过计划默认预算 ¥10）。
  for (const [runId, tokens] of [["95000000-0000-4000-8000-000000000602", 600_000], ["95000000-0000-4000-8000-000000000603", 600_000]] as const) {
    await ledger.recordUsage(buildUsageRecord({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      task: "worker",
      runId,
      workItemId: "95000000-0000-4000-8000-000000000604",
      userId: "95000000-0000-4000-8000-000000000605",
      workspaceId: "workspace-r95",
      taskPlanId,
      inputTokens: tokens,
      outputTokens: 0,
      costTier: { inputCnyPerMtok: 10, outputCnyPerMtok: 10 },
      createdAt: new Date("2026-07-01T00:00:00.000Z")
    }));
  }
  const snapshots = await ledger.usageSnapshots({ taskPlanId }, { now: new Date("2026-07-03T00:00:00.000Z") });
  const totalSnapshot = snapshots.find((snapshot) => snapshot.scope.kind === "task" && snapshot.period === "total");
  // total 跨天累计（不是当日 day 快照）。
  assert.equal(totalSnapshot?.tokenIn, 1_200_000);
  const taskPolicy = defaultBudgetPoliciesFromSettings(settings).find((policy) => policy.id === "pcost-task-run-v0");
  assert.equal(taskPolicy?.period, "total");
  assert.equal(taskPolicy?.maxCostCny, "10");

  const decision = decideRunBudget({
    settings,
    decisionId: "decision-r95-task-total",
    now: new Date("2026-07-03T00:00:00.000Z"),
    scopeIds: { taskPlanId },
    policies: [taskPolicy!],
    usage: snapshots
  });

  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.limitingScope, { kind: "task", taskPlanId });
  assert.equal(decision.notice?.code, "budget_exhausted");
});

test("budget policy store updates policies without mutating settings defaults", () => {
  const settings = loadSettings({});
  const store = createMemoryBudgetPolicyStore();
  const updated = store.updatePolicy(settings, "user", "pcost-user-day-v0", {
    maxTokens: 250000,
    maxCostCny: "12.5",
    onWarning: "notify"
  });

  assert.equal(updated?.version, 2);
  assert.equal(updated?.maxTokens, 250000);
  assert.equal(store.listPolicies(settings).find((policy) => policy.id === "pcost-user-day-v0")?.maxCostCny, "12.5");
  assert.equal(defaultBudgetPoliciesFromSettings(settings).find((policy) => policy.id === "pcost-user-day-v0")?.maxCostCny, "20");
  assert.equal(store.updatePolicy(settings, "eval", "missing", { enabled: false }), undefined);
  assert.throws(() =>
    applyBudgetPolicyPatch(defaultBudgetPoliciesFromSettings(settings)[0]!, {
      warningRatio: 0.98
    })
  );
});

test("model routing can prefer cheaper models for low risk or near-budget runs", () => {
  const premium = { provider: "deepseek", model: "premium", inputCost: 10, outputCost: 20 };
  const cheap = { provider: "deepseek", model: "cheap", inputCost: 1, outputCost: 2 };

  assert.equal(chooseModelRoute([premium, cheap], { risk: "medium" }).model, "premium");
  assert.equal(chooseModelRoute([premium, cheap], { risk: "low" }).model, "cheap");
  assert.equal(chooseModelRoute([premium, cheap], { budgetRatio: 0.96 }).reason, "near_budget_downgrade");
});

test("budget decision warns near policy limits and trims the run budget", () => {
  const settings = loadSettings({});
  const decision = decideRunBudget({
    settings,
    decisionId: "decision-critical",
    now: new Date("2026-06-05T12:00:00.000Z"),
    scopeIds: { workItemId: "workitem-1", userId: "user-1" },
    modelRoute: { provider: "deepseek", model: "deepseek-v4-flash", reason: "default" },
    usage: [
      {
        policyId: "pcost-user-day-v0",
        scope: { kind: "user", userId: "user-1" },
        tokenIn: 475000,
        tokenOut: 0,
        estimatedCostCny: "1"
      }
    ]
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "critical");
  assert.equal(decision.runBudget.maxTokens, 25000);
  assert.equal(decision.modelRoute.reason, "near_budget_downgrade");
  assert.equal(decision.notice?.code, "budget_warning");
  assert.equal(decision.notice?.recommendedAction, "downgrade_model");
  assert.equal(decision.limitingUsage?.policyId, "pcost-user-day-v0");
});

test("budget decision blocks exhausted scopes with traceable details", () => {
  const settings = loadSettings({});
  const decision = decideRunBudget({
    settings,
    decisionId: "decision-exhausted",
    now: new Date("2026-06-05T12:00:00.000Z"),
    scopeIds: { workItemId: "workitem-1", userId: "user-1" },
    modelRoute: { provider: "deepseek", model: "deepseek-v4-flash", reason: "default" },
    usage: [
      {
        policyId: "pcost-user-day-v0",
        scope: { kind: "user", userId: "user-1" },
        tokenIn: 500000,
        tokenOut: 1,
        estimatedCostCny: "20"
      }
    ]
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "budget_exhausted");
  assert.equal(decision.notice?.code, "budget_exhausted");
  assert.equal(decision.notice?.options?.some((option) => option.id === "ask_admin"), true);
  assert.equal(decision.limitingUsage?.status, "exhausted");
  assert.equal(decision.limitingUsage?.remainingTokens, 0);
  assert.equal(decision.limitingUsage?.remainingCostCny, "0");
});

test("cost ledger reconciles usage into scoped entries and budget snapshots", async () => {
  const ledger = createMemoryCostLedgerStore({ teamId: "team-1" });
  const record = buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "worker",
    runId: "run-1",
    workItemId: "workitem-1",
    userId: "user-1",
    inputTokens: 1000,
    outputTokens: 500,
    costTier: { inputCnyPerMtok: 2, outputCnyPerMtok: 8 },
    createdAt: new Date("2026-06-05T00:00:00.000Z")
  });

  await ledger.recordUsage(record);
  await ledger.recordUsage(record);

  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.entries.length, 3);
  assert.deepEqual(ledger.entries.map((entry) => entry.scope.kind).sort(), ["team", "user", "workitem"]);

  // now 钉到 entry 当天，让 day 快照捕获这次用量（run 快照按新语义恒为 0——per-run 上限运行时管控）。
  const snapshots = await ledger.usageSnapshots({
    workItemId: "workitem-1",
    userId: "user-1",
    teamId: "team-1"
  }, { now: new Date("2026-06-05T00:00:00.000Z") });
  assert.equal(snapshots.find((snapshot) => snapshot.scope.kind === "user" && snapshot.period === "day")?.tokenIn, 1000);
  assert.equal(snapshots.find((snapshot) => snapshot.scope.kind === "team" && snapshot.period === "day")?.estimatedCostCny, "0.006");
  // 新语义：per-run 快照恒为 0（这次 run 决策时尚未花费），避免 scope 全量把 per-run 上限卡死。
  assert.equal(snapshots.find((snapshot) => snapshot.scope.kind === "workitem" && snapshot.period === "run")?.tokenIn, 0);
});

test("cost ledger uses a usage workspace id as the team scope when present", async () => {
  const ledger = createMemoryCostLedgerStore({ teamId: "default-team" });
  await ledger.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "worker",
    runId: "run-tenant",
    workItemId: "workitem-tenant",
    userId: "user-tenant",
    workspaceId: "workspace-b",
    inputTokens: 1000,
    outputTokens: 0,
    costTier: { inputCnyPerMtok: 2, outputCnyPerMtok: 8 },
    createdAt: new Date("2026-06-05T00:00:00.000Z")
  }));

  assert.equal(ledger.entries.some((entry) => entry.scope.kind === "team" && entry.scope.teamId === "default-team"), false);
  assert.equal(ledger.entries.some((entry) => entry.scope.kind === "team" && entry.scope.teamId === "workspace-b"), true);
  const snapshots = await ledger.usageSnapshots({ teamId: "workspace-b" }, { now: new Date("2026-06-05T00:00:00.000Z") });
  assert.equal(snapshots.find((snapshot) => snapshot.scope.kind === "team" && snapshot.period === "day")?.tokenIn, 1000);
});

test("findings[19] distinct calls with identical tokens in the same ms are not deduped when seq differs", async () => {
  const base = {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "worker",
    runId: "run-1",
    workItemId: "workitem-1",
    userId: "user-1",
    inputTokens: 1000,
    outputTokens: 500,
    costTier: { inputCnyPerMtok: 2, outputCnyPerMtok: 8 },
    createdAt: new Date("2026-06-05T00:00:00.000Z")
  };

  // 两次真正不同的调用（不同步号），token / 成本 / 毫秒全相同——seq 区分，二者都必须计入，不再被误并少记。
  const ledger = createMemoryCostLedgerStore({ teamId: "team-1" });
  await ledger.recordUsage(buildUsageRecord({ ...base, seq: 1 }));
  await ledger.recordUsage(buildUsageRecord({ ...base, seq: 2 }));
  assert.equal(ledger.records.length, 2);
  const userTokens = ledger.entries
    .filter((entry) => entry.scope.kind === "user")
    .reduce((sum, entry) => sum + entry.tokenIn, 0);
  assert.equal(userTokens, 2000);

  // 同一次调用被重复落账（同 seq）仍幂等去重——不会因加了 seq 而把重试/双写双计。
  const dupLedger = createMemoryCostLedgerStore({ teamId: "team-1" });
  const once = buildUsageRecord({ ...base, seq: 3 });
  await dupLedger.recordUsage(once);
  await dupLedger.recordUsage(once);
  assert.equal(dupLedger.records.length, 1);
});

test("eval usage is reconciled separately from user and team quota", async () => {
  const ledger = createMemoryCostLedgerStore({ teamId: "team-1", evalSuite: "nightly" });
  await ledger.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "eval",
    userId: "user-1",
    inputTokens: 1000,
    outputTokens: 1000,
    source: "eval",
    costTier: { inputCnyPerMtok: 1, outputCnyPerMtok: 1 },
    createdAt: new Date("2026-06-05T00:00:00.000Z")
  }));

  assert.equal(ledger.entries.length, 1);
  assert.deepEqual(ledger.entries[0]?.scope, { kind: "eval", suite: "nightly" });
  const at = { now: new Date("2026-06-05T00:00:00.000Z") };
  const userSnapshots = await ledger.usageSnapshots({ userId: "user-1", teamId: "team-1" }, at);
  const evalSnapshots = await ledger.usageSnapshots({ evalSuite: "nightly" }, at);
  assert.equal(userSnapshots.every((snapshot) => snapshot.tokenIn === 0), true);
  assert.equal(evalSnapshots.find((snapshot) => snapshot.period === "day")?.estimatedCostCny, "0.002");
});

test("findings[#164] curation usage lands in an isolated curation scope, not the team production budget", async () => {
  const ledger = createMemoryCostLedgerStore({ teamId: "team-1" });
  await ledger.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "skill-curation",
    inputTokens: 1000,
    outputTokens: 1000,
    source: "curation",
    costTier: { inputCnyPerMtok: 1, outputCnyPerMtok: 1 },
    createdAt: new Date("2026-06-05T00:00:00.000Z")
  }));

  // 蒸馏花费只产出 1 条 curation-scoped 账目（仍进 cost_ledger_entries 供 labor_split 分账），
  // 绝不扇成 team/user/workitem——后者会被团队生产预算统计、吃掉生产额度。
  assert.equal(ledger.entries.length, 1);
  assert.deepEqual(ledger.entries[0]?.scope, { kind: "curation", teamId: "team-1" });

  // 团队生产预算快照对蒸馏花费视而不见（curation scope 不在 team scopeIds 里）。
  const at = { now: new Date("2026-06-05T00:00:00.000Z") };
  const teamSnapshots = await ledger.usageSnapshots({ userId: "user-1", teamId: "team-1" }, at);
  assert.equal(teamSnapshots.every((snapshot) => snapshot.tokenIn === 0), true);
});

test("usage snapshots are period-aware: day/month ignore prior-period usage", async () => {
  const ledger = createMemoryCostLedgerStore({ teamId: "team-1" });
  await ledger.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "worker",
    userId: "user-1",
    inputTokens: 999999,
    outputTokens: 0,
    costTier: { inputCnyPerMtok: 1, outputCnyPerMtok: 1 },
    createdAt: new Date("2000-01-15T00:00:00.000Z") // long ago — must not count toward current periods
  }));
  const snaps = await ledger.usageSnapshots({ userId: "user-1", teamId: "team-1" }, { now: new Date() });
  const userDay = snaps.find((s) => s.scope.kind === "user" && s.period === "day");
  const teamMonth = snaps.find((s) => s.scope.kind === "team" && s.period === "month");
  // 否则日/月预算把全部历史都算进去 → 误判超额、用一阵后永久卡死所有 run（C3）。
  assert.equal(userDay?.tokenIn, 0);
  assert.equal(teamMonth?.tokenIn, 0);
});

test("findings[#74/#80] listEntries(sinceBucket) windows the admin read instead of full-scanning all history", async () => {
  const ledger = createMemoryCostLedgerStore({ teamId: "team-1" });
  const common = {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "worker",
    workItemId: "workitem-1",
    userId: "user-1",
    inputTokens: 10,
    outputTokens: 10,
    costTier: { inputCnyPerMtok: 1, outputCnyPerMtok: 1 }
  };
  await ledger.recordUsage(buildUsageRecord({ ...common, runId: "old", createdAt: new Date("2026-01-01T00:00:00.000Z") }));
  await ledger.recordUsage(buildUsageRecord({ ...common, runId: "recent", createdAt: new Date("2026-06-10T00:00:00.000Z") }));

  // 每次用量扇成 workitem+user+team 三条账目。
  const all = await ledger.listEntries?.();
  const windowed = await ledger.listEntries?.({ sinceBucket: "2026-06-01" });
  assert.equal(all?.length, 6);
  assert.equal(windowed?.length, 3); // 只剩窗口内那次用量的三条
  assert.equal(windowed?.every((entry) => entry.periodBucket >= "2026-06-01"), true);
});
