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

// B-R9.6 UX-H4：军团行合入元数据（名称/状态/预算→燃烧百分比），按花费降序；无 meta 时行退化不塌。
test("B-R9.6 buildCostDashboardPage enriches by_task_plan rows with meta and sorts by cost", () => {
  const planA = "00000000-0000-4000-8000-00000000p0a1".replace("p0", "0f");
  const planB = "00000000-0000-4000-8000-00000000p0b1".replace("p0", "1a");
  const cost = buildCostDashboardPage({
    settings,
    isAdmin: true,
    userId: "00000000-0000-4000-8000-000000000001",
    generatedAt: new Date("2026-06-16T02:00:00.000Z"),
    ledgerEntries: [
      entry({ usageRecordId: "u1", source: "agent_step", estimatedCostCny: "0.30", taskPlanId: planA, runId: "r1" }),
      entry({ usageRecordId: "u2", source: "agent_step", estimatedCostCny: "1.20", taskPlanId: planB, runId: "r2" })
    ],
    taskPlanMeta: new Map([
      [planB, { label: "上市材料军团", status: "dispatching", maxCostCny: 1 }]
    ])
  });
  assert.equal(cost.by_task_plan.length, 2);
  // 花费降序：planB（1.20）在前。
  assert.equal(cost.by_task_plan[0]?.task_plan_id, planB);
  assert.equal(cost.by_task_plan[0]?.label, "上市材料军团");
  assert.equal(cost.by_task_plan[0]?.status, "dispatching");
  assert.equal(cost.by_task_plan[0]?.budget_cny, "1");
  assert.equal(cost.by_task_plan[0]?.burn_pct, 120);
  // 无 meta 的行退化为纯账目行。
  assert.equal(cost.by_task_plan[1]?.task_plan_id, planA);
  assert.equal(cost.by_task_plan[1]?.label, undefined);
  assert.equal(cost.by_task_plan[1]?.burn_pct, undefined);
});

// R13 批 P4（labor-split 按 assignee 记账）：与 K5 的 labor_split（生产/自进化维度）正交——
// 这是「这笔钱是哪个执行者干活花的」维度，行数据由路由层一次 SQL GROUP BY 查出后传入，
// page builder 只做展示装配（谁是「我」/谁归「系统」/降序）。
test("R13 P4 buildCostDashboardPage assembles by_assignee with current-user and system labels, sorted by cost", () => {
  const me = "00000000-0000-4000-8000-000000000001";
  const other = "00000000-0000-4000-8000-000000000002";
  const cost = buildCostDashboardPage({
    settings,
    isAdmin: true,
    userId: me,
    generatedAt: new Date("2026-07-13T02:00:00.000Z"),
    ledgerEntries: [entry({ usageRecordId: "u1", source: "agent_step", estimatedCostCny: "0.6" })],
    assigneeCostRows: [
      { actorUserId: other, nickname: "李四", costCny: "0.5", tokens: 200, runCount: 1 },
      { actorUserId: me, nickname: "本人昵称", costCny: "3", tokens: 900, runCount: 4 },
      { actorUserId: null, nickname: null, costCny: "1.2", tokens: 300, runCount: 0 }
    ]
  });
  assert.equal(cost.by_assignee.length, 3);
  // 降序：我(3) > 系统(1.2) > 李四(0.5)。
  assert.equal(cost.by_assignee[0]?.user_id, me);
  assert.equal(cost.by_assignee[0]?.label, "当前用户");
  assert.equal(cost.by_assignee[0]?.cost_cny, "3");
  assert.equal(cost.by_assignee[0]?.run_count, 4);
  assert.equal(cost.by_assignee[1]?.user_id, undefined);
  assert.equal(cost.by_assignee[1]?.label, "系统（无执行者）");
  assert.equal(cost.by_assignee[2]?.user_id, other);
  assert.equal(cost.by_assignee[2]?.label, "李四");
});

test("R13 P4 buildCostDashboardPage keeps by_assignee empty for non-admins even when rows are passed", () => {
  const cost = buildCostDashboardPage({
    settings,
    isAdmin: false,
    userId: "00000000-0000-4000-8000-000000000001",
    generatedAt: new Date("2026-07-13T02:00:00.000Z"),
    ledgerEntries: [],
    assigneeCostRows: [{ actorUserId: "00000000-0000-4000-8000-000000000002", nickname: "李四", costCny: "0.5", tokens: 200, runCount: 1 }]
  });
  assert.deepEqual(cost.by_assignee, []);
});

test("R13 P4 buildCostDashboardPage omits by_assignee when no rows were supplied (取数失败/无数据)", () => {
  const cost = buildCostDashboardPage({
    settings,
    isAdmin: true,
    userId: "00000000-0000-4000-8000-000000000001",
    generatedAt: new Date("2026-07-13T02:00:00.000Z"),
    ledgerEntries: []
  });
  assert.deepEqual(cost.by_assignee, []);
});

// R13 批 P4（KPI：AI 自动合并数/占比）：count/total 由路由层传入，page builder 只算比例。
test("R13 P4 buildCostDashboardPage computes ai_auto_merge ratio from raw counts", () => {
  const cost = buildCostDashboardPage({
    settings,
    isAdmin: true,
    userId: "00000000-0000-4000-8000-000000000001",
    generatedAt: new Date("2026-07-13T02:00:00.000Z"),
    ledgerEntries: [],
    aiAutoMergeCounts: { total: 4, aiApproved: 3 }
  });
  assert.deepEqual(cost.ai_auto_merge, { count: 3, ratio_pct: 75 });
});

test("R13 P4 buildCostDashboardPage keeps ai_auto_merge undefined when no counts were supplied", () => {
  const cost = buildCostDashboardPage({
    settings,
    isAdmin: true,
    userId: "00000000-0000-4000-8000-000000000001",
    generatedAt: new Date("2026-07-13T02:00:00.000Z"),
    ledgerEntries: []
  });
  assert.equal(cost.ai_auto_merge, undefined);
});

test("R13 P4 buildCostDashboardPage hides ai_auto_merge from non-admins even when counts are passed", () => {
  const cost = buildCostDashboardPage({
    settings,
    isAdmin: false,
    userId: "00000000-0000-4000-8000-000000000001",
    generatedAt: new Date("2026-07-13T02:00:00.000Z"),
    ledgerEntries: [],
    aiAutoMergeCounts: { total: 4, aiApproved: 3 }
  });
  assert.equal(cost.ai_auto_merge, undefined);
});
