import type { Settings } from "@workhub/config";

import type { BudgetDecision, BudgetNotice, BudgetPolicy, RunBudget } from "./types.js";

export type BudgetPolicyPatch = Partial<
  Pick<
    BudgetPolicy,
    | "maxTokens"
    | "maxCostCny"
    | "warningRatio"
    | "criticalRatio"
    | "onWarning"
    | "onExhausted"
    | "modelRouteHint"
    | "enabled"
  >
>;

export type BudgetPolicyStore = {
  listPolicies: (settings: Settings) => BudgetPolicy[];
  updatePolicy: (
    settings: Settings,
    scopeKind: BudgetPolicy["scopeKind"],
    id: string,
    patch: BudgetPolicyPatch
  ) => BudgetPolicy | undefined;
};

export function defaultRunBudgetFromSettings(settings: Settings): RunBudget {
  return {
    maxSteps: 15,
    totalTimeoutSeconds: 300,
    maxTokens: settings.budgets.runTokens,
    maxCostCny: settings.budgets.runCostCny
  };
}

export function defaultBudgetPoliciesFromSettings(settings: Settings): BudgetPolicy[] {
  return [
    {
      id: "pcost-workitem-run-v0",
      scopeKind: "workitem",
      period: "run",
      maxTokens: settings.budgets.runTokens,
      maxCostCny: settings.budgets.runCostCny,
      warningRatio: 0.8,
      criticalRatio: 0.95,
      onWarning: "downgrade_model",
      onExhausted: "handoff_current_run",
      modelRouteHint: "balanced",
      enabled: true,
      version: 1
    },
    {
      id: "pcost-user-day-v0",
      scopeKind: "user",
      period: "day",
      maxTokens: settings.budgets.userDailyTokens,
      maxCostCny: settings.budgets.userDailyCostCny,
      warningRatio: 0.8,
      criticalRatio: 0.95,
      onWarning: "notify",
      onExhausted: "block_new_run",
      modelRouteHint: "balanced",
      enabled: true,
      version: 1
    },
    {
      id: "pcost-team-day-v0",
      scopeKind: "team",
      period: "day",
      maxTokens: settings.budgets.teamDailyTokens,
      maxCostCny: settings.budgets.teamDailyCostCny,
      warningRatio: 0.8,
      criticalRatio: 0.95,
      onWarning: "downgrade_model",
      onExhausted: "block_new_run",
      modelRouteHint: "cheapest_safe",
      enabled: true,
      version: 1
    },
    {
      id: "pcost-team-month-v0",
      scopeKind: "team",
      period: "month",
      maxTokens: settings.budgets.teamMonthlyTokens,
      maxCostCny: settings.budgets.teamMonthlyCostCny,
      warningRatio: 0.8,
      criticalRatio: 0.95,
      onWarning: "notify",
      onExhausted: "block_new_run",
      modelRouteHint: "balanced",
      enabled: true,
      version: 1
    }
  ];
}

export function applyBudgetPolicyPatch(policy: BudgetPolicy, patch: BudgetPolicyPatch): BudgetPolicy {
  const next: BudgetPolicy = {
    ...policy,
    ...withoutUndefined(patch),
    version: policy.version + 1
  };
  if (next.warningRatio >= next.criticalRatio) {
    throw new Error("warningRatio must be lower than criticalRatio");
  }
  return next;
}

export function createMemoryBudgetPolicyStore(seed: BudgetPolicy[] = []): BudgetPolicyStore {
  const overrides = new Map<string, BudgetPolicy>();
  for (const policy of seed) {
    overrides.set(policyKey(policy.scopeKind, policy.id), policy);
  }

  return {
    listPolicies(settings) {
      return defaultBudgetPoliciesFromSettings(settings).map(
        (policy) => overrides.get(policyKey(policy.scopeKind, policy.id)) ?? policy
      );
    },
    updatePolicy(settings, scopeKind, id, patch) {
      const current = this.listPolicies(settings).find((policy) => policy.scopeKind === scopeKind && policy.id === id);
      if (!current) {
        return undefined;
      }
      const next = applyBudgetPolicyPatch(current, patch);
      overrides.set(policyKey(scopeKind, id), next);
      return next;
    }
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

function policyKey(scopeKind: BudgetPolicy["scopeKind"], id: string) {
  return `${scopeKind}:${id}`;
}

function withoutUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}
