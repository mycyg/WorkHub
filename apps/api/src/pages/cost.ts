import type { BudgetUsage, CostDashboardVM, CostSummaryVM } from "@workhub/contracts";
import type { Settings } from "@workhub/config";

type CostPageInput = {
  settings: Settings;
  isAdmin: boolean;
  userId: string;
  generatedAt?: Date;
};

const defaultTeamId = "00000000-0000-4000-8000-000000000101";

function isoAtDayBoundary(date: Date, offsetDays: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offsetDays)).toISOString();
}

function makeZeroUsage(input: {
  scope: BudgetUsage["scope"];
  scopeLabel: string;
  policyId: string;
  period: BudgetUsage["period"];
  maxTokens: number;
  maxCostCny: string;
  generatedAt: Date;
}): BudgetUsage {
  return {
    scope: input.scope,
    scope_label: input.scopeLabel,
    policy_id: input.policyId,
    period: input.period,
    period_start: isoAtDayBoundary(input.generatedAt, 0),
    period_end: isoAtDayBoundary(input.generatedAt, input.period === "month" ? 31 : 1),
    token_in: 0,
    token_out: 0,
    total_tokens: 0,
    max_tokens: input.maxTokens,
    remaining_tokens: input.maxTokens,
    estimated_cost_cny: "0",
    max_cost_cny: input.maxCostCny,
    remaining_cost_cny: input.maxCostCny,
    warning_ratio: 0,
    status: "ok"
  };
}

export function buildCostSummary(input: CostPageInput): CostSummaryVM {
  const generatedAt = input.generatedAt ?? new Date();
  const me = makeZeroUsage({
    scope: { kind: "user", user_id: input.userId },
    scopeLabel: "我的今日 AI 预算",
    policyId: "pcost-user-day-v0",
    period: "day",
    maxTokens: input.settings.budgets.userDailyTokens,
    maxCostCny: input.settings.budgets.userDailyCostCny,
    generatedAt
  });
  const team = makeZeroUsage({
    scope: { kind: "team", team_id: defaultTeamId },
    scopeLabel: "团队今日 AI 预算",
    policyId: "pcost-team-day-v0",
    period: "day",
    maxTokens: input.settings.budgets.teamDailyTokens,
    maxCostCny: input.settings.budgets.teamDailyCostCny,
    generatedAt
  });

  return {
    me,
    team,
    scopes: [me, team],
    active_notices: [],
    generated_at: generatedAt.toISOString()
  };
}

export function buildCostDashboardPage(input: CostPageInput): CostDashboardVM {
  const generatedAt = input.generatedAt ?? new Date();
  const summary = buildCostSummary({ ...input, generatedAt });

  return {
    generated_at: summary.generated_at,
    currency: "CNY",
    total_cost_cny: "0",
    token_in: 0,
    token_out: 0,
    unit_cost_cny: "0",
    trend: [],
    by_user: input.isAdmin
      ? [{ user_id: input.userId, label: "当前用户", cost_cny: "0", tokens: 0 }]
      : [],
    by_team: [],
    by_workitem: [],
    model_breakdown: [],
    budget: summary.scopes,
    notices: summary.active_notices,
    top_exhaustion_risks: [],
    empty_state: "no_agent_runs"
  };
}
