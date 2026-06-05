import assert from "node:assert/strict";
import test from "node:test";

import { loadSettings } from "@workhub/config";

import {
  allowWithDefaultBudget,
  applyBudgetPolicyPatch,
  buildUsageRecord,
  chooseModelRoute,
  createMemoryBudgetPolicyStore,
  createMemoryUsageSink,
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
