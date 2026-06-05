export type BudgetScope =
  | { kind: "workitem"; workitemId: string }
  | { kind: "user"; userId: string }
  | { kind: "team"; teamId: string }
  | { kind: "eval"; suite: "nightly" | "release" };

export type RunBudget = {
  maxSteps: number;
  totalTimeoutSeconds: number;
  maxTokens: number;
  maxCostCny: string;
};

export type BudgetPolicy = {
  id: string;
  scopeKind: BudgetScope["kind"];
  period: "run" | "day" | "month";
  maxTokens: number;
  maxCostCny: string;
  warningRatio: number;
  criticalRatio: number;
  onWarning: "notify" | "downgrade_model";
  onExhausted: "block_new_run" | "handoff_current_run";
  modelRouteHint?: "cheapest_safe" | "balanced" | "premium";
  enabled: boolean;
  version: number;
};

export type BudgetUsage = {
  scope: BudgetScope;
  scopeLabel: string;
  policyId: string;
  period: "run" | "day" | "month";
  periodStart: string;
  periodEnd: string;
  tokenIn: number;
  tokenOut: number;
  totalTokens: number;
  maxTokens: number;
  remainingTokens: number;
  estimatedCostCny: string;
  maxCostCny: string;
  remainingCostCny: string;
  warningRatio: number;
  status: "ok" | "warning" | "critical" | "exhausted";
};

export type BudgetNotice = {
  code: "budget_warning" | "budget_exhausted";
  severity: "info" | "warning" | "critical";
  message: string;
  scope: BudgetScope;
  usageRatio: number;
  recommendedAction: "continue" | "downgrade_model" | "pause" | "ask_admin";
  options?: { id: string; label: string; actionHref: string }[];
  actionHref?: string;
};

export type BudgetDecision = {
  decisionId: string;
  allowed: boolean;
  reason?: "ok" | "warning" | "critical" | "budget_exhausted";
  runBudget: RunBudget;
  limitingScope?: BudgetScope;
  modelRoute: {
    provider: string;
    model: string;
    reason: "default" | "low_risk_cheaper" | "near_budget_downgrade";
  };
  notice?: BudgetNotice;
};

export type UsageSource = "agent_step" | "review" | "compact" | "retry" | "eval";

export type UsageRecord = {
  runId?: string;
  workItemId?: string;
  userId?: string;
  provider: string;
  model: string;
  task: string;
  actorId?: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostCny: string;
  source: UsageSource;
  createdAt: string;
};

export type CostLedgerEntry = {
  id: string;
  usageRecordId: string;
  policyId?: string;
  runId?: string;
  workItemId?: string;
  userId?: string;
  teamId?: string;
  scope: BudgetScope;
  periodBucket: string;
  tokenIn: number;
  tokenOut: number;
  estimatedCostCny: string;
  unitPriceCny?: string;
  currency: "CNY";
  model: string;
  source: UsageSource;
  createdAt: string;
};

export type UsageSink = {
  recordUsage: (record: UsageRecord) => Promise<void> | void;
};
