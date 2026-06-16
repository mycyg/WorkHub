import assert from "node:assert/strict";
import test from "node:test";

import { loadSettings } from "@workhub/config";
import type { CostLedgerEntry } from "@workhub/cost";

import { buildCostDashboardPage } from "./pages/cost.js";

const settings = loadSettings({ APP_ENV: "test", COOKIE_SECRET: "test-cookie-secret" });

function entry(over: Partial<CostLedgerEntry> & Pick<CostLedgerEntry, "source" | "estimatedCostCny">): CostLedgerEntry {
  return {
    id: `e-${over.id ?? over.usageRecordId ?? Math.round(Number(over.estimatedCostCny) * 1e6)}`,
    usageRecordId: over.usageRecordId ?? `u-${over.source}-${over.estimatedCostCny}`,
    scope: { kind: "team", teamId: "team-1" },
    periodBucket: "2026-06-16",
    tokenIn: 100,
    tokenOut: 50,
    currency: "CNY",
    model: "deepseek-v4-flash",
    provider: "deepseek",
    createdAt: "2026-06-16T01:00:00.000Z",
    ...over
  };
}

test("buildCostDashboardPage splits spend into production vs self-improvement (K5)", () => {
  const cost = buildCostDashboardPage({
    settings,
    isAdmin: true,
    userId: "00000000-0000-4000-8000-000000000001",
    generatedAt: new Date("2026-06-16T02:00:00.000Z"),
    ledgerEntries: [
      entry({ usageRecordId: "u1", source: "agent_step", estimatedCostCny: "0.6" }),
      entry({ usageRecordId: "u2", source: "review", estimatedCostCny: "0.2" }),
      entry({ usageRecordId: "u3", source: "curation", estimatedCostCny: "0.2" })
    ]
  });
  assert.ok(cost.labor_split, "labor_split should be present when there are entries");
  assert.equal(cost.labor_split?.production_cost_cny, "0.8"); // agent_step + review
  assert.equal(cost.labor_split?.self_improvement_cost_cny, "0.2"); // curation
  assert.equal(cost.labor_split?.self_improvement_ratio, 0.2); // 0.2 / 1.0
});

test("buildCostDashboardPage omits labor_split when there is no usage (K5)", () => {
  const cost = buildCostDashboardPage({
    settings,
    isAdmin: true,
    userId: "00000000-0000-4000-8000-000000000001",
    generatedAt: new Date("2026-06-16T02:00:00.000Z"),
    ledgerEntries: []
  });
  assert.equal(cost.labor_split, undefined);
  assert.equal(cost.empty_state, "no_agent_runs");
});

test("buildCostDashboardPage labor_split ratio is 0 when only production spend exists (K5)", () => {
  const cost = buildCostDashboardPage({
    settings,
    isAdmin: true,
    userId: "00000000-0000-4000-8000-000000000001",
    generatedAt: new Date("2026-06-16T02:00:00.000Z"),
    ledgerEntries: [entry({ usageRecordId: "u1", source: "agent_step", estimatedCostCny: "1.5" })]
  });
  assert.equal(cost.labor_split?.self_improvement_cost_cny, "0");
  assert.equal(cost.labor_split?.self_improvement_ratio, 0);
  assert.equal(cost.labor_split?.production_cost_cny, "1.5");
});
