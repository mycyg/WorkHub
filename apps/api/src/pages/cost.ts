import type { CostDashboardVM } from "@workhub/contracts";
import type { Settings } from "@workhub/config";

export function buildCostDashboardPage(input: {
  settings: Settings;
  isAdmin: boolean;
  userId: string;
}): CostDashboardVM {
  const budget = {
    run_tokens: input.settings.budgets.runTokens,
    user_daily_tokens: input.settings.budgets.userDailyTokens,
    team_daily_tokens: input.settings.budgets.teamDailyTokens,
    team_monthly_tokens: input.settings.budgets.teamMonthlyTokens,
    run_cost_cny: input.settings.budgets.runCostCny,
    user_daily_cost_cny: input.settings.budgets.userDailyCostCny,
    team_daily_cost_cny: input.settings.budgets.teamDailyCostCny,
    team_monthly_cost_cny: input.settings.budgets.teamMonthlyCostCny
  };
  return {
    total_cost: {
      me: {
        total_tokens: 0,
        estimated_cost_cny: "0",
        warning_ratio: 0
      },
      active_notices: []
    },
    trend: [],
    budget,
    model_breakdown: [],
    notices: [],
    ...(input.isAdmin ? { by_user: [{ user_id: input.userId, total_tokens: 0, estimated_cost_cny: "0" }] } : {})
  };
}
