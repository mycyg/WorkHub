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
  listPolicies: (settings: Settings) => BudgetPolicy[] | Promise<BudgetPolicy[]>;
  updatePolicy: (
    settings: Settings,
    scopeKind: BudgetPolicy["scopeKind"],
    id: string,
    patch: BudgetPolicyPatch
  ) => BudgetPolicy | undefined | Promise<BudgetPolicy | undefined>;
};

export type SyncBudgetPolicyStore = {
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
      id: "pcost-task-day-v0",
      scopeKind: "task",
      period: "day",
      maxTokens: settings.budgets.runTokens,
      maxCostCny: settings.budgets.runCostCny,
      warningRatio: 0.8,
      criticalRatio: 0.95,
      onWarning: "notify",
      onExhausted: "block_new_run",
      modelRouteHint: "balanced",
      enabled: true,
      version: 1
    },
    {
      id: "pcost-objective-day-v0",
      scopeKind: "objective",
      period: "day",
      maxTokens: settings.budgets.teamDailyTokens,
      maxCostCny: settings.budgets.teamDailyCostCny,
      warningRatio: 0.8,
      criticalRatio: 0.95,
      onWarning: "notify",
      onExhausted: "block_new_run",
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
    },
    {
      // eval（夜间/发布评测套件）日预算：此前 eval 在决策层完全无策略=无上限，跑飞的套件可无限烧钱。
      // 评测 harness 在 decideRunBudget 的 scopeIds 里传 evalSuite，scopeForPolicy 即按此 eval scope 计量。
      id: "pcost-eval-day-v0",
      scopeKind: "eval",
      period: "day",
      maxTokens: settings.budgets.evalDailyTokens,
      maxCostCny: settings.budgets.evalDailyCostCny,
      warningRatio: 0.8,
      criticalRatio: 0.95,
      onWarning: "notify",
      onExhausted: "block_new_run",
      modelRouteHint: "cheapest_safe",
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

export function createMemoryBudgetPolicyStore(seed: BudgetPolicy[] = []): SyncBudgetPolicyStore {
  const overrides = new Map<string, BudgetPolicy>();
  for (const policy of seed) {
    overrides.set(policyKey(policy.scopeKind, policy.id), policy);
  }

  const listPolicies = (settings: Settings) =>
    defaultBudgetPoliciesFromSettings(settings).map(
      (policy) => overrides.get(policyKey(policy.scopeKind, policy.id)) ?? policy
    );

  return {
    listPolicies,
    updatePolicy(settings, scopeKind, id, patch) {
      const current = listPolicies(settings).find((policy) => policy.scopeKind === scopeKind && policy.id === id);
      if (!current) {
        return undefined;
      }
      const next = applyBudgetPolicyPatch(current, patch);
      overrides.set(policyKey(scopeKind, id), next);
      return next;
    }
  };
}

// L#73：删除 budgetExhaustedNotice——无任何生产/测试调用方，且它是唯一不带 options/actionHref 的
// notice 工厂（会产生无动作按钮的卡片）。真实预算路径走 decision.ts 的 budgetNotice()（必带 options+actionHref）。

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
