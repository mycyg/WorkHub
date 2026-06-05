import type { Settings } from "@workhub/config";

import type { BudgetDecision, BudgetNotice, RunBudget } from "./types.js";

export function defaultRunBudgetFromSettings(settings: Settings): RunBudget {
  return {
    maxSteps: 15,
    totalTimeoutSeconds: 300,
    maxTokens: settings.budgets.runTokens,
    maxCostCny: settings.budgets.runCostCny
  };
}

export function budgetExhaustedNotice(scope: BudgetNotice["scope"]): BudgetNotice {
  return {
    code: "budget_exhausted",
    severity: "critical",
    message: "AI 预算已经用完，先暂停新的自动执行。",
    scope,
    usageRatio: 1,
    recommendedAction: "pause"
  };
}

export function allowWithDefaultBudget(settings: Settings, route: BudgetDecision["modelRoute"]): BudgetDecision {
  return {
    decisionId: "default-budget",
    allowed: true,
    reason: "ok",
    runBudget: defaultRunBudgetFromSettings(settings),
    modelRoute: route
  };
}
