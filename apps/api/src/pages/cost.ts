import { costDashboardVmSchema, type BudgetNotice, type BudgetUsage, type CostDashboardVM, type CostSummaryVM, type WorkHubLocale } from "@workhub/contracts";
import type { Settings } from "@workhub/config";
import { isSelfImprovementSource, type BudgetUsage as InternalBudgetUsage, type CostLedgerEntry } from "@workhub/cost";
import { pageT } from "./i18n.js";

type CostPageInput = {
  settings: Settings;
  isAdmin: boolean;
  userId: string;
  generatedAt?: Date;
  budgetUsages?: InternalBudgetUsage[];
  ledgerEntries?: readonly CostLedgerEntry[];
  locale?: WorkHubLocale;
};

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
  const locale = input.locale ?? "zh-CN";
  const mappedUsages = input.budgetUsages?.map((usage) => toApiBudgetUsage(usage, locale)) ?? [];
  const fallbackMe = makeZeroUsage({
    scope: { kind: "user", user_id: input.userId },
    scopeLabel: pageT(locale, "cost.scope.me"),
    policyId: "pcost-user-day-v0",
    period: "day",
    maxTokens: input.settings.budgets.userDailyTokens,
    maxCostCny: input.settings.budgets.userDailyCostCny,
    generatedAt
  });
  const me = mappedUsages.find((usage) => usage.scope.kind === "user" && usage.scope.user_id === input.userId) ?? fallbackMe;
  const fallbackTeam = makeZeroUsage({
    scope: { kind: "team", team_id: input.settings.auth.defaultWorkspaceId },
    scopeLabel: pageT(locale, "cost.scope.team"),
    policyId: "pcost-team-day-v0",
    period: "day",
    maxTokens: input.settings.budgets.teamDailyTokens,
    maxCostCny: input.settings.budgets.teamDailyCostCny,
    generatedAt
  });
  const team = mappedUsages.find((usage) => usage.scope.kind === "team") ?? fallbackTeam;
  const scopes = mappedUsages.length > 0 ? mappedUsages : [me, team];

  return {
    me,
    team,
    scopes,
    active_notices: budgetNoticesFor(scopes, locale),
    generated_at: generatedAt.toISOString()
  };
}

export function buildCostDashboardPage(input: CostPageInput): CostDashboardVM {
  const generatedAt = input.generatedAt ?? new Date();
  const locale = input.locale ?? "zh-CN";
  const summary = buildCostSummary({ ...input, generatedAt });
  // 纵深防御（M8）：非管理员的总额/趋势/模型分布只能基于自己 user scope 的账目，
  // 即便上游误传了全量账目，也绝不把同组织他人的花费泄露给普通用户。
  const allEntries = input.ledgerEntries ?? [];
  const scopedEntries = input.isAdmin
    ? allEntries
    : allEntries.filter((entry) => entry.scope.kind === "user" && entry.scope.userId === input.userId);
  const uniqueEntries = uniqueUsageEntries(scopedEntries);
  const totalCost = sumCost(uniqueEntries);
  const tokenIn = uniqueEntries.reduce((sum, entry) => sum + entry.tokenIn, 0);
  const tokenOut = uniqueEntries.reduce((sum, entry) => sum + entry.tokenOut, 0);
  const byUser = aggregateByScope(scopedEntries, "user");
  const byTeam = aggregateByScope(scopedEntries, "team");
  const byWorkitem = aggregateByScope(scopedEntries, "workitem");
  const modelBreakdown = aggregateByModel(uniqueEntries);
  const laborSplit = buildLaborSplit(uniqueEntries);

  // L#51：返回前过一遍 zod schema，把契约漂移挡在服务端（与其他 page builder 一致）。
  return costDashboardVmSchema.parse({
    generated_at: summary.generated_at,
    currency: "CNY",
    total_cost_cny: formatCny(totalCost),
    token_in: tokenIn,
    token_out: tokenOut,
    unit_cost_cny: uniqueEntries.length > 0 ? formatCny(totalCost / Math.max(tokenIn + tokenOut, 1)) : "0",
    trend: aggregateTrend(uniqueEntries),
    by_user: input.isAdmin ? byUser.map((item) => ({
      user_id: item.id,
      label: item.id === input.userId ? pageT(locale, "cost.label.currentUser") : item.id,
      cost_cny: formatCny(item.cost),
      tokens: item.tokens
    })) : [],
    // findings[37]：by_team / by_workitem 与 by_user 一样是全组织口径，仅管理员可见。非管理员置空——
    // 否则非 admin 的 by_team 会把"自己的"花费聚到硬编码的"团队预算"标签下（单 teamId 标记），一旦被渲染就会误导。
    by_team: input.isAdmin ? byTeam.map((item) => ({
      team_id: item.id,
      label: pageT(locale, "cost.label.teamBudget"),
      cost_cny: formatCny(item.cost),
      tokens: item.tokens
    })) : [],
    by_workitem: input.isAdmin ? byWorkitem.map((item) => ({
      workitem_id: item.id,
      code: item.id,
      cost_cny: formatCny(item.cost),
      turns: item.turns
    })) : [],
    model_breakdown: modelBreakdown,
    ...(laborSplit ? { labor_split: laborSplit } : {}),
    budget: summary.scopes,
    notices: summary.active_notices,
    top_exhaustion_risks: summary.scopes
      .filter((usage) => usage.status !== "ok")
      .map((usage) => ({
        scope: usage.scope,
        label: usage.scope_label,
        remaining_cost_cny: usage.remaining_cost_cny,
        status: usage.status
      })),
    ...(uniqueEntries.length === 0 ? { empty_state: "no_agent_runs" as const } : {})
  });
}

function toApiBudgetUsage(usage: InternalBudgetUsage, locale: WorkHubLocale): BudgetUsage {
  return {
    scope: toApiScope(usage.scope),
    scope_label: localizedScopeLabel(usage, locale),
    policy_id: usage.policyId,
    period: usage.period,
    period_start: usage.periodStart,
    period_end: usage.periodEnd,
    token_in: usage.tokenIn,
    token_out: usage.tokenOut,
    total_tokens: usage.totalTokens,
    max_tokens: usage.maxTokens,
    remaining_tokens: usage.remainingTokens,
    estimated_cost_cny: usage.estimatedCostCny,
    max_cost_cny: usage.maxCostCny,
    remaining_cost_cny: usage.remainingCostCny,
    warning_ratio: usage.warningRatio,
    status: usage.status
  };
}

function localizedScopeLabel(usage: InternalBudgetUsage, locale: WorkHubLocale) {
  if (usage.scope.kind === "user" && usage.period === "day" && isDefaultUserDayScopeLabel(usage.scopeLabel)) {
    return pageT(locale, "cost.scope.me");
  }
  if (usage.scope.kind === "team" && usage.period === "day" && isDefaultTeamDayScopeLabel(usage.scopeLabel)) {
    return pageT(locale, "cost.scope.team");
  }
  if (usage.scope.kind === "team" && usage.period === "month" && isDefaultTeamMonthScopeLabel(usage.scopeLabel)) {
    return pageT(locale, "cost.scope.teamMonth");
  }
  return usage.scopeLabel;
}

function isDefaultUserDayScopeLabel(label: string) {
  return label === "我的 AI 日预算" || label === pageT("zh-CN", "cost.scope.me") || label === pageT("en-US", "cost.scope.me");
}

function isDefaultTeamDayScopeLabel(label: string) {
  return label === "团队 AI 预算" || label === pageT("zh-CN", "cost.scope.team") || label === pageT("en-US", "cost.scope.team");
}

function isDefaultTeamMonthScopeLabel(label: string) {
  return label === "团队 AI 预算" || label === pageT("zh-CN", "cost.scope.teamMonth") || label === pageT("en-US", "cost.scope.teamMonth");
}

function toApiScope(scope: InternalBudgetUsage["scope"]): BudgetUsage["scope"] {
  switch (scope.kind) {
    case "workitem":
      return { kind: "workitem", workitem_id: scope.workitemId };
    case "user":
      return { kind: "user", user_id: scope.userId };
    case "team":
      return { kind: "team", team_id: scope.teamId };
    case "curation":
      return { kind: "curation", team_id: scope.teamId };
    case "eval":
      return { kind: "eval", suite: scope.suite };
  }
}

function budgetNoticesFor(usages: BudgetUsage[], locale: WorkHubLocale): BudgetNotice[] {
  return usages
    .filter((usage) => usage.status === "warning" || usage.status === "critical" || usage.status === "exhausted")
    .map((usage) => {
      const exhausted = usage.status === "exhausted";
      return {
        code: exhausted ? "budget_exhausted" : "budget_warning",
        severity: exhausted ? "critical" : usage.status === "critical" ? "critical" : "warning",
        message: pageT(locale, exhausted ? "cost.notice.exhausted" : "cost.notice.warning"),
        scope: usage.scope,
        usage_ratio: usage.warning_ratio,
        recommended_action: exhausted ? "pause" : "downgrade_model",
        options: [
          { id: "downgrade_model", label: pageT(locale, "cost.action.downgrade"), action_href: "/dashboard/cost" },
          { id: "pause", label: pageT(locale, "cost.action.pause"), action_href: "/dashboard/cost" },
          { id: "ask_admin", label: pageT(locale, "cost.action.askAdmin"), action_href: "/dashboard/cost" }
        ],
        action_href: "/dashboard/cost"
      };
    });
}

function uniqueUsageEntries(entries: readonly CostLedgerEntry[]) {
  const seen = new Set<string>();
  const unique: CostLedgerEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.usageRecordId)) {
      continue;
    }
    seen.add(entry.usageRecordId);
    unique.push(entry);
  }
  return unique;
}

function aggregateTrend(entries: readonly CostLedgerEntry[]): CostDashboardVM["trend"] {
  const buckets = new Map<string, { cost: number; tokens: number }>();
  for (const entry of entries) {
    const current = buckets.get(entry.periodBucket) ?? { cost: 0, tokens: 0 };
    current.cost += parseCny(entry.estimatedCostCny);
    current.tokens += entry.tokenIn + entry.tokenOut;
    buckets.set(entry.periodBucket, current);
  }
  return [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, value]) => ({
    date,
    cost_cny: formatCny(value.cost),
    tokens: value.tokens
  }));
}

function aggregateByScope(entries: readonly CostLedgerEntry[], kind: "user" | "team" | "workitem") {
  // findings[H10/H13]：每次用量被 usageToLedgerEntries 扇成 user+team+workitem 三条 entry，且每条都复制了
  // 同一份 userId/workItemId 反规范化列——直接按这些列聚合会把一次花费数 2-3 次。改为：只认 scope.kind 匹配的
  // entry（每次用量在该 scope 恰好一条），按 usageRecordId 去重（防重试/双写），并从 entry.scope 取本 scope 的 id。
  const buckets = new Map<string, { cost: number; tokens: number; turns: number }>();
  const seenUsage = new Set<string>();
  for (const entry of entries) {
    if (entry.scope.kind !== kind) {
      continue;
    }
    const id = entry.scope.kind === "user"
      ? entry.scope.userId
      : entry.scope.kind === "team"
        ? entry.scope.teamId
        : entry.scope.workitemId;
    if (!id) {
      continue;
    }
    const usageKey = `${entry.usageRecordId}:${id}`;
    if (seenUsage.has(usageKey)) {
      continue;
    }
    seenUsage.add(usageKey);
    const current = buckets.get(id) ?? { cost: 0, tokens: 0, turns: 0 };
    current.cost += parseCny(entry.estimatedCostCny);
    current.tokens += entry.tokenIn + entry.tokenOut;
    current.turns += entry.source === "agent_step" ? 1 : 0;
    buckets.set(id, current);
  }
  return [...buckets.entries()].map(([id, value]) => ({ id, ...value }));
}

// K5：按花费来源拆「干活（production）vs 自进化（self-improvement = 夜间技能蒸馏）」。
// 无账目时返回 undefined（面板此时走 empty_state，不显分账）。
function buildLaborSplit(entries: readonly CostLedgerEntry[]): CostDashboardVM["labor_split"] {
  if (entries.length === 0) {
    return undefined;
  }
  let selfImprovement = 0;
  let production = 0;
  for (const entry of entries) {
    const cost = parseCny(entry.estimatedCostCny);
    if (isSelfImprovementSource(entry.source)) {
      selfImprovement += cost;
    } else {
      production += cost;
    }
  }
  const total = selfImprovement + production;
  return {
    production_cost_cny: formatCny(production),
    self_improvement_cost_cny: formatCny(selfImprovement),
    // 两位小数的比值，避免把吵的浮点尾巴塞进契约。
    self_improvement_ratio: total > 0 ? Math.round((selfImprovement / total) * 100) / 100 : 0
  };
}

function aggregateByModel(entries: readonly CostLedgerEntry[]): CostDashboardVM["model_breakdown"] {
  const buckets = new Map<string, { provider: string; model: string; count: number; cost: number }>();
  for (const entry of entries) {
    const key = `${entry.provider ?? "unknown"}:${entry.model}`;
    const current = buckets.get(key) ?? { provider: entry.provider ?? "unknown", model: entry.model, count: 0, cost: 0 };
    current.count += 1;
    current.cost += parseCny(entry.estimatedCostCny);
    buckets.set(key, current);
  }
  return [...buckets.values()].map((item) => ({
    provider: item.provider,
    model: item.model,
    count: item.count,
    cost_cny: formatCny(item.cost)
  }));
}

function sumCost(entries: readonly CostLedgerEntry[]) {
  return entries.reduce((sum, entry) => sum + parseCny(entry.estimatedCostCny), 0);
}

function parseCny(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCny(value: number) {
  return value.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "") || "0";
}
