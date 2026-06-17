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
    scope: { kind: "team", teamId: "00000000-0000-4000-8000-0000000000a1" },
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

test("findings[H10/H13] per-scope breakdowns count each usage once, not 2-3x", () => {
  const uid = "00000000-0000-4000-8000-000000000001";
  const tid = "00000000-0000-4000-8000-0000000000a1";
  const wid = "00000000-0000-4000-8000-0000000000b2";
  // 生产里一次用量被 usageToLedgerEntries 扇成 user+team+workitem 三条 entry，且每条都复制了同一份
  // 反规范化 userId/teamId/workItemId 列。按反规范化列聚合会数 3 次；正确实现按 scope.kind 各记一次。
  const denorm = { source: "agent_step" as const, estimatedCostCny: "0.6", userId: uid, teamId: tid, workItemId: wid };
  const cost = buildCostDashboardPage({
    settings,
    isAdmin: true,
    userId: uid,
    generatedAt: new Date("2026-06-16T02:00:00.000Z"),
    ledgerEntries: [
      entry({ ...denorm, usageRecordId: "u1", id: "u1:user", scope: { kind: "user", userId: uid } }),
      entry({ ...denorm, usageRecordId: "u1", id: "u1:team", scope: { kind: "team", teamId: tid } }),
      entry({ ...denorm, usageRecordId: "u1", id: "u1:workitem", scope: { kind: "workitem", workitemId: wid } })
    ]
  });
  // 每个口径只记一次该用量：150 token（100+50）/ ¥0.6，而非 450 / ¥1.8。
  assert.equal(cost.by_user.length, 1);
  assert.equal(cost.by_user[0]?.tokens, 150);
  assert.equal(cost.by_user[0]?.cost_cny, "0.6");
  assert.equal(cost.by_team.length, 1);
  assert.equal(cost.by_team[0]?.tokens, 150);
  assert.equal(cost.by_workitem.length, 1);
  // by_workitem 口径用 turns（agent_step 次数）+ cost，不带 tokens 字段。
  assert.equal(cost.by_workitem[0]?.turns, 1);
  assert.equal(cost.by_workitem[0]?.cost_cny, "0.6");
});

test("findings[#81] malformed period_bucket row is skipped from trend, not 422-ing the whole dashboard", () => {
  // 一条好行 + 一条坏 periodBucket(非 ISO)。修复前坏行进 trend.date 触发 fail-closed VM 解析抛错→整张看板 422；
  // 修复后坏行被跳过，看板照常构建，trend 只剩好行。
  const cost = buildCostDashboardPage({
    settings,
    isAdmin: true,
    userId: "00000000-0000-4000-8000-000000000001",
    generatedAt: new Date("2026-06-16T02:00:00.000Z"),
    ledgerEntries: [
      entry({ usageRecordId: "u1", source: "agent_step", estimatedCostCny: "0.6", periodBucket: "2026-06-16" }),
      entry({ usageRecordId: "u2", source: "agent_step", estimatedCostCny: "0.4", periodBucket: "not-a-date" })
    ]
  });
  assert.equal(cost.trend.length, 1);
  assert.equal(cost.trend[0]?.date, "2026-06-16");
});
