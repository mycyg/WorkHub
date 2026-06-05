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
  assert.deepEqual(policies.map((policy) => policy.id), [
    "pcost-workitem-run-v0",
    "pcost-user-day-v0",
    "pcost-team-day-v0",
    "pcost-team-month-v0"
  ]);
  assert.equal(policies.find((policy) => policy.id === "pcost-user-day-v0")?.maxTokens, 500000);
  assert.equal(policies.find((policy) => policy.id === "pcost-team-month-v0")?.maxCostCny, "2000");
  assert.equal(allowWithDefaultBudget(settings, { provider: "deepseek", model: "m", reason: "default" }).allowed, true);
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

  const snapshots = ledger.usageSnapshots({
    workItemId: "workitem-1",
    userId: "user-1",
    teamId: "team-1"
  });
  assert.equal(snapshots.find((snapshot) => snapshot.scope.kind === "user")?.tokenIn, 1000);
  assert.equal(snapshots.find((snapshot) => snapshot.scope.kind === "team")?.estimatedCostCny, "0.006");
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
  assert.equal(ledger.usageSnapshots({ userId: "user-1", teamId: "team-1" }).every((snapshot) => snapshot.tokenIn === 0), true);
  assert.equal(ledger.usageSnapshots({ evalSuite: "nightly" })[0]?.estimatedCostCny, "0.002");
});
