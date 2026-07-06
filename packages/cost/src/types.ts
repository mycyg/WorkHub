export type BudgetScope =
  | { kind: "workitem"; workitemId: string }
  | { kind: "task"; taskPlanId: string }
  | { kind: "objective"; objectiveId: string }
  | { kind: "user"; userId: string }
  | { kind: "team"; teamId: string }
  // 技能蒸馏(自我提升)用量自成 scope，与 eval 一样和团队生产预算隔离：findings[#164] curation 花费
  // 曾被记到 team scope，于是夜间蒸馏会吃掉团队生产日/月预算、卡死次晨的生产 run。curation 另有独立
  // 日上限(curationBudgetOk，按原始 usage_records 过滤 source)。
  | { kind: "curation"; teamId: string }
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

// "curation" = 夜间技能自进化（蒸馏）的 LLM 花费——与「干活」分账，见成本面板 labor_split（K5）。
export type UsageSource = "agent_step" | "review" | "compact" | "retry" | "eval" | "curation";

// 自进化（self-improvement）花费来源：当前只有 curation；后续 K2/K6 若新增自进化调用点在此扩列。
export const SELF_IMPROVEMENT_USAGE_SOURCES = new Set<UsageSource>(["curation"]);
export function isSelfImprovementSource(source: UsageSource): boolean {
  return SELF_IMPROVEMENT_USAGE_SOURCES.has(source);
}

export type UsageRecord = {
  runId?: string;
  workItemId?: string;
  taskPlanId?: string;
  objectiveId?: string;
  userId?: string;
  workspaceId?: string;
  provider: string;
  model: string;
  task: string;
  actorId?: string;
  // findings[19]：每次调用的单调序号（agent 循环的步号）。两次真正不同的调用即便 token 数与毫秒
  // 时间戳完全相同，也因 seq 不同而产生不同的 usageRecordId，不再被去重误并、少记成本/token。
  // 同一次调用 seq 固定 → 重复落账仍幂等。可选：非 agent_step（如 review，每 run 一次）无需 seq。
  seq?: number;
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
  taskPlanId?: string;
  objectiveId?: string;
  userId?: string;
  teamId?: string;
  scope: BudgetScope;
  periodBucket: string;
  tokenIn: number;
  tokenOut: number;
  estimatedCostCny: string;
  unitPriceCny?: string;
  currency: "CNY";
  provider?: string;
  model: string;
  source: UsageSource;
  createdAt: string;
};

export type UsageSink = {
  recordUsage: (record: UsageRecord) => Promise<void> | void;
};
