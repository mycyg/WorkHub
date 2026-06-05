import assert from "node:assert/strict";
import test from "node:test";

import { loadSettings } from "@workhub/config";

import {
  allowWithDefaultBudget,
  buildUsageRecord,
  chooseModelRoute,
  createMemoryUsageSink,
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

  assert.equal(budget.maxSteps, 15);
  assert.equal(budget.totalTimeoutSeconds, 300);
  assert.equal(budget.maxTokens, 120000);
  assert.equal(budget.maxCostCny, "5");
  assert.equal(allowWithDefaultBudget(settings, { provider: "deepseek", model: "m", reason: "default" }).allowed, true);
});

test("model routing can prefer cheaper models for low risk or near-budget runs", () => {
  const premium = { provider: "deepseek", model: "premium", inputCost: 10, outputCost: 20 };
  const cheap = { provider: "deepseek", model: "cheap", inputCost: 1, outputCost: 2 };

  assert.equal(chooseModelRoute([premium, cheap], { risk: "medium" }).model, "premium");
  assert.equal(chooseModelRoute([premium, cheap], { risk: "low" }).model, "cheap");
  assert.equal(chooseModelRoute([premium, cheap], { budgetRatio: 0.96 }).reason, "near_budget_downgrade");
});
