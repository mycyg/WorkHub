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
  periodStart: string;
  periodEnd: string;
  tokenIn: number;
  tokenOut: number;
  totalTokens: number;
  estimatedCostCny: string;
  warningRatio: number;
};

export type BudgetNotice = {
  severity: "info" | "warning" | "critical";
  message: string;
  scope: BudgetScope;
  actionHref?: string;
};

export type BudgetDecision = {
  allowed: boolean;
  reason?: "ok" | "warning" | "critical" | "budget_exhausted";
  runBudget: RunBudget;
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
  runId?: string;
  workItemId?: string;
  userId?: string;
  teamId?: string;
  scope: BudgetScope;
  tokenIn: number;
  tokenOut: number;
  estimatedCostCny: string;
  model: string;
  source: UsageSource;
  createdAt: string;
};

export type UsageSink = {
  recordUsage: (record: UsageRecord) => Promise<void> | void;
};
