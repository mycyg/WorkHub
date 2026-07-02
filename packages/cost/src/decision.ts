import { randomUUID } from "node:crypto";

import type { Settings } from "@workhub/config";

import { defaultBudgetPoliciesFromSettings, defaultRunBudgetFromSettings } from "./budget.js";
import { chooseModelRoute, type ModelRouteCandidate } from "./model-route.js";
import type { BudgetDecision, BudgetNotice, BudgetPolicy, BudgetScope, BudgetUsage, RunBudget } from "./types.js";

export type BudgetScopeIds = {
  workItemId?: string;
  taskPlanId?: string;
  objectiveId?: string;
  userId?: string;
  teamId?: string;
  evalSuite?: "nightly" | "release";
};

export type BudgetUsageSnapshot = {
  scope: BudgetScope;
  policyId?: string;
  period?: BudgetPolicy["period"];
  scopeLabel?: string;
  periodStart?: Date | string;
  periodEnd?: Date | string;
  tokenIn: number;
  tokenOut: number;
  estimatedCostCny: string;
};

export type DecideRunBudgetInput = {
  settings: Settings;
  scopeIds: BudgetScopeIds;
  policies?: BudgetPolicy[];
  usage?: BudgetUsageSnapshot[];
  modelRoute?: BudgetDecision["modelRoute"];
  routeCandidates?: readonly ModelRouteCandidate[];
  risk?: "low" | "medium" | "high";
  now?: Date;
  decisionId?: string;
};

export type BudgetDecisionTrace = BudgetDecision & {
  usages: BudgetUsage[];
  limitingUsage?: BudgetUsage;
};

type EvaluatedUsage = {
  usage: BudgetUsage;
  policy: BudgetPolicy;
  ratio: number;
};

export function decideRunBudget(input: DecideRunBudgetInput): BudgetDecisionTrace {
  const policies = (input.policies ?? defaultBudgetPoliciesFromSettings(input.settings)).filter(
    (policy) => policy.enabled
  );
  const now = input.now ?? new Date();
  const evaluated = policies
    .map((policy) => evaluatePolicyUsage(policy, input.scopeIds, input.usage ?? [], now))
    .filter((item): item is EvaluatedUsage => item !== undefined);
  const usages = evaluated.map((item) => item.usage);
  const limiting = evaluated.sort((left, right) => right.ratio - left.ratio)[0];
  const limitingUsage = limiting?.usage;
  const maxRatio = limiting?.ratio ?? 0;
  const runBudget = constrainRunBudget(defaultRunBudgetFromSettings(input.settings), usages);

  if (limiting && maxRatio >= 1) {
    const notice = budgetNotice({
      code: "budget_exhausted",
      severity: "critical",
      scope: limiting.usage.scope,
      usageRatio: maxRatio,
      policy: limiting.policy
    });
    return {
      decisionId: input.decisionId ?? randomUUID(),
      allowed: false,
      reason: "budget_exhausted",
      runBudget,
      limitingScope: limiting.usage.scope,
      modelRoute: routeForDecision(input, maxRatio),
      notice,
      usages,
      limitingUsage: limiting.usage
    };
  }

  if (limiting && limiting.usage.status === "critical") {
    return {
      decisionId: input.decisionId ?? randomUUID(),
      allowed: true,
      reason: "critical",
      runBudget,
      limitingScope: limiting.usage.scope,
      modelRoute: routeForDecision(input, maxRatio),
      notice: budgetNotice({
        code: "budget_warning",
        severity: "critical",
        scope: limiting.usage.scope,
        usageRatio: maxRatio,
        policy: limiting.policy
      }),
      usages,
      limitingUsage: limiting.usage
    };
  }

  if (limiting && limiting.usage.status === "warning") {
    return {
      decisionId: input.decisionId ?? randomUUID(),
      allowed: true,
      reason: "warning",
      runBudget,
      limitingScope: limiting.usage.scope,
      modelRoute: routeForDecision(input, maxRatio),
      notice: budgetNotice({
        code: "budget_warning",
        severity: "warning",
        scope: limiting.usage.scope,
        usageRatio: maxRatio,
        policy: limiting.policy
      }),
      usages,
      limitingUsage: limiting.usage
    };
  }

  return {
    decisionId: input.decisionId ?? randomUUID(),
    allowed: true,
    reason: "ok",
    runBudget,
    modelRoute: routeForDecision(input, maxRatio),
    usages,
    ...(limitingUsage ? { limitingUsage } : {})
  };
}

function evaluatePolicyUsage(
  policy: BudgetPolicy,
  scopeIds: BudgetScopeIds,
  snapshots: BudgetUsageSnapshot[],
  now: Date
): EvaluatedUsage | undefined {
  const scope = scopeForPolicy(policy, scopeIds);
  if (!scope) {
    return undefined;
  }
  const snapshot = snapshots.find((candidate) => matchesUsage(policy, scope, candidate));
  const tokenIn = snapshot?.tokenIn ?? 0;
  const tokenOut = snapshot?.tokenOut ?? 0;
  const totalTokens = tokenIn + tokenOut;
  const usedCost = parseCny(snapshot?.estimatedCostCny ?? "0");
  const maxCost = parseCny(policy.maxCostCny);
  // 上限 <=0 视为"该维度不限"（ratio 0），而非满载。否则 maxCostCny='0' 的策略会把每次运行都判 exhausted、永久卡死。
  const tokenRatio = policy.maxTokens > 0 ? totalTokens / policy.maxTokens : 0;
  const costRatio = maxCost > 0 ? usedCost / maxCost : 0;
  const ratio = Math.max(tokenRatio, costRatio);
  const bounds = periodBounds(policy.period, now);
  const usage: BudgetUsage = {
    scope,
    scopeLabel: snapshot?.scopeLabel ?? defaultScopeLabel(scope),
    policyId: policy.id,
    period: policy.period,
    periodStart: toIso(snapshot?.periodStart ?? bounds.start),
    periodEnd: toIso(snapshot?.periodEnd ?? bounds.end),
    tokenIn,
    tokenOut,
    totalTokens,
    maxTokens: policy.maxTokens,
    remainingTokens: Math.max(policy.maxTokens - totalTokens, 0),
    estimatedCostCny: formatCny(usedCost),
    maxCostCny: policy.maxCostCny,
    remainingCostCny: formatCny(Math.max(maxCost - usedCost, 0)),
    warningRatio: ratio,
    status: ratio >= 1 ? "exhausted" : ratio >= policy.criticalRatio ? "critical" : ratio >= policy.warningRatio ? "warning" : "ok"
  };
  return { usage, policy, ratio };
}

function scopeForPolicy(policy: BudgetPolicy, scopeIds: BudgetScopeIds): BudgetScope | undefined {
  switch (policy.scopeKind) {
    case "workitem":
      return scopeIds.workItemId ? { kind: "workitem", workitemId: scopeIds.workItemId } : undefined;
    case "task":
      return scopeIds.taskPlanId ? { kind: "task", taskPlanId: scopeIds.taskPlanId } : undefined;
    case "objective":
      return scopeIds.objectiveId ? { kind: "objective", objectiveId: scopeIds.objectiveId } : undefined;
    case "user":
      return scopeIds.userId ? { kind: "user", userId: scopeIds.userId } : undefined;
    case "team":
      return scopeIds.teamId ? { kind: "team", teamId: scopeIds.teamId } : undefined;
    case "eval":
      return scopeIds.evalSuite ? { kind: "eval", suite: scopeIds.evalSuite } : undefined;
  }
}

function matchesUsage(policy: BudgetPolicy, scope: BudgetScope, usage: BudgetUsageSnapshot) {
  if (usage.policyId && usage.policyId === policy.id) {
    return true;
  }
  // 周期感知快照：同一 scope 会有 run/day/month 多个快照，必须挑 period 对得上的那个，
  // 否则日预算会错配到全量(run)快照、把历史用量算进来 → 误判超额。
  if (usage.period && usage.period !== policy.period) {
    return false;
  }
  return sameScope(scope, usage.scope);
}

function sameScope(left: BudgetScope, right: BudgetScope) {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "workitem":
      return right.kind === "workitem" && left.workitemId === right.workitemId;
    case "task":
      return right.kind === "task" && left.taskPlanId === right.taskPlanId;
    case "objective":
      return right.kind === "objective" && left.objectiveId === right.objectiveId;
    case "user":
      return right.kind === "user" && left.userId === right.userId;
    case "team":
      return right.kind === "team" && left.teamId === right.teamId;
    case "curation":
      return right.kind === "curation" && left.teamId === right.teamId;
    case "eval":
      return right.kind === "eval" && left.suite === right.suite;
  }
}

function constrainRunBudget(defaultBudget: RunBudget, usages: BudgetUsage[]): RunBudget {
  const remainingTokens = usages.map((usage) => usage.remainingTokens);
  const remainingCosts = usages.map((usage) => parseCny(usage.remainingCostCny));
  return {
    ...defaultBudget,
    maxTokens: Math.max(1, Math.min(defaultBudget.maxTokens, ...remainingTokens)),
    maxCostCny: formatCny(Math.max(0, Math.min(parseCny(defaultBudget.maxCostCny), ...remainingCosts)))
  };
}

function routeForDecision(input: DecideRunBudgetInput, budgetRatio: number): BudgetDecision["modelRoute"] {
  if (input.routeCandidates?.length) {
    const options: { risk?: "low" | "medium" | "high"; budgetRatio: number } = { budgetRatio };
    if (input.risk) {
      options.risk = input.risk;
    }
    return chooseModelRoute(input.routeCandidates, options);
  }

  const route = input.modelRoute ?? {
    provider: input.settings.llm.defaultProvider,
    model: input.settings.llm.model,
    reason: "default" as const
  };
  if (budgetRatio >= 0.95) {
    return { ...route, reason: "near_budget_downgrade" };
  }
  return route;
}

function budgetNotice(input: {
  code: BudgetNotice["code"];
  severity: BudgetNotice["severity"];
  scope: BudgetScope;
  usageRatio: number;
  policy: BudgetPolicy;
}): BudgetNotice {
  const exhausted = input.code === "budget_exhausted";
  const armyScopeExhausted = exhausted && (input.scope.kind === "task" || input.scope.kind === "objective");
  const recommendedAction = armyScopeExhausted
    ? "add_budget"
    : exhausted
    ? input.policy.onExhausted === "block_new_run"
      ? "ask_admin"
      : "pause"
    : input.severity === "critical" || input.policy.onWarning === "downgrade_model"
      ? "downgrade_model"
      : "continue";
  const actionHref = actionHrefForScope(input.scope);
  const options = armyScopeExhausted
    ? [
        { id: "add_budget", label: "追加预算继续", actionHref },
        { id: "finish_current_output", label: "就用现有产出收尾", actionHref },
        { id: "close_scope", label: "整体收工", actionHref }
      ]
    : [
        { id: "downgrade_model", label: "降级模型继续", actionHref },
        { id: "pause", label: "先暂停", actionHref },
        { id: "ask_admin", label: "找管理员", actionHref: "/dashboard/cost" }
      ];
  return {
    code: input.code,
    severity: input.severity,
    message: exhausted ? "AI 预算已经用完，先暂停新的自动执行。" : "AI 预算快用完了，建议先选择更省的执行方式。",
    scope: input.scope,
    usageRatio: input.usageRatio,
    recommendedAction,
    options,
    actionHref
  };
}

function actionHrefForScope(scope: BudgetScope) {
  if (scope.kind === "workitem") {
    return `/workitems/${scope.workitemId}`;
  }
  if (scope.kind === "task") {
    return `/dashboard/cost?taskPlanId=${encodeURIComponent(scope.taskPlanId)}`;
  }
  if (scope.kind === "objective") {
    return `/dashboard/cost?objectiveId=${encodeURIComponent(scope.objectiveId)}`;
  }
  return "/dashboard/cost";
}

function defaultScopeLabel(scope: BudgetScope) {
  switch (scope.kind) {
    case "workitem":
      return "当前事项 AI 执行预算";
    case "task":
      return "军团计划预算";
    case "objective":
      return "目标预算";
    case "user":
      return "我的 AI 日预算";
    case "team":
      return "团队 AI 预算";
    case "curation":
      return "技能蒸馏(自我提升)预算";
    case "eval":
      return "评测预算";
  }
}

// findings[20]：预算 day/month 桶按 UTC 日界刻意为之，不是 bug——写入侧 ledger periodBucket
// (createdAt.slice(0,10)) 与读取侧（这里 + ledgerUsageSnapshots）同用 UTC，单一真相、绝无双计。
// 与 ai-worklog 的 UTC 日界（L7）一致；CI/生产均为 UTC。代价仅是 UTC+8 下"今日"额度按北京时间 08:00
// 重置（纯 UX 取舍）。若将来要按业务时区切日，必须写入侧与读取侧同时改、保持两端时区一致，否则会双计。
function periodBounds(period: BudgetPolicy["period"], now: Date) {
  const start = new Date(now);
  if (period === "month") {
    start.setUTCDate(1);
  }
  if (period === "day" || period === "month") {
    start.setUTCHours(0, 0, 0, 0);
  }
  const end = new Date(start);
  if (period === "run") {
    end.setTime(now.getTime());
  } else if (period === "day") {
    end.setUTCDate(end.getUTCDate() + 1);
  } else {
    end.setUTCMonth(end.getUTCMonth() + 1);
  }
  return { start, end };
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function parseCny(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCny(value: number) {
  return value.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "") || "0";
}
