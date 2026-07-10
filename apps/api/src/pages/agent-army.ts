import {
  agentArmyDashboardVmSchema,
  type AgentArmyDashboardVM,
  type WorkHubLocale,
  type WorkItemAgentTeamItemStatus
} from "@workhub/contracts";
import type {
  TaskPlanDashboardEscalationRow,
  TaskPlanDashboardPlanRow,
  TaskPlanItemRow,
  TaskPlanRunRow
} from "@workhub/db";
import type { CostLedgerEntry } from "@workhub/cost";

import { parseOutputContract } from "./output-contract.js";

type AgentArmyDashboardPageInput = {
  generatedAt?: Date;
  locale?: WorkHubLocale;
  attentionCount: number;
  isAdmin?: boolean;
  sourceWarnings?: NonNullable<AgentArmyDashboardVM["source_warnings"]>;
  autonomyRatePct?: number;
  plans: TaskPlanDashboardPlanRow[];
  items: TaskPlanItemRow[];
  runs: TaskPlanRunRow[];
  escalations: TaskPlanDashboardEscalationRow[];
  ledgerEntries: readonly CostLedgerEntry[];
  pageInfo: {
    planLimit: number;
    plansCapped: boolean;
    itemsCapped: boolean;
    runsCapped: boolean;
    escalationLimit: number;
    escalationsCapped: boolean;
  };
};

type PlanCost = {
  cost: number;
  usageRecordIds: Set<string>;
};

function formatCny(value: number) {
  return value.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "") || "0";
}

function numericCny(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : undefined;
}

function budgetFromPlan(plan: TaskPlanDashboardPlanRow["plan"]) {
  const raw = plan.budgetJson?.max_cost_cny;
  return typeof raw === "string" && Number.isFinite(Number.parseFloat(raw)) ? formatCny(Number.parseFloat(raw)) : undefined;
}

function groupByPlan<T extends { planId?: string | null }>(rows: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.planId) {
      continue;
    }
    const list = groups.get(row.planId) ?? [];
    list.push(row);
    groups.set(row.planId, list);
  }
  return groups;
}

function groupRunsByItem(runs: readonly TaskPlanRunRow[]) {
  const groups = new Map<string, TaskPlanRunRow[]>();
  for (const run of runs) {
    if (!run.taskPlanItemId) {
      continue;
    }
    const list = groups.get(run.taskPlanItemId) ?? [];
    list.push(run);
    groups.set(run.taskPlanItemId, list);
  }
  return groups;
}

function groupRunsByPlan(runs: readonly TaskPlanRunRow[]) {
  const groups = new Map<string, TaskPlanRunRow[]>();
  for (const run of runs) {
    if (!run.taskPlanId) {
      continue;
    }
    const list = groups.get(run.taskPlanId) ?? [];
    list.push(run);
    groups.set(run.taskPlanId, list);
  }
  return groups;
}

function latestRun(runs: readonly TaskPlanRunRow[]) {
  return [...runs].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];
}

function dashboardStatus(item: TaskPlanItemRow, run: TaskPlanRunRow | undefined): WorkItemAgentTeamItemStatus {
  if (run?.status === "escalated") {
    return "needs_human";
  }
  if (run?.status === "succeeded") {
    return "succeeded";
  }
  if (run?.status === "failed" || run?.status === "cancelled") {
    return "failed";
  }
  if (run?.status === "queued" || run?.status === "running") {
    return "dispatched";
  }
  if (item.status === "succeeded" || item.status === "failed" || item.status === "skipped" || item.status === "pending") {
    return item.status;
  }
  return "dispatched";
}

function increment<T extends string>(map: Map<T, number>, key: T) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedCounts<T extends string>(map: Map<T, number>) {
  return [...map.entries()].map(([key, count]) => ({ key, count }));
}

function costBuckets(entries: readonly CostLedgerEntry[]) {
  const buckets = new Map<string, PlanCost>();
  for (const entry of entries) {
    const planId = entry.taskPlanId ?? (entry.scope.kind === "task" ? entry.scope.taskPlanId : undefined);
    if (!planId) {
      continue;
    }
    const usageKey = `${planId}:${entry.usageRecordId}`;
    const current = buckets.get(planId) ?? { cost: 0, usageRecordIds: new Set<string>() };
    if (!current.usageRecordIds.has(usageKey)) {
      current.usageRecordIds.add(usageKey);
      current.cost += numericCny(entry.estimatedCostCny) ?? 0;
    }
    buckets.set(planId, current);
  }
  return { buckets };
}

function judgeStats(plan: TaskPlanDashboardPlanRow["plan"]) {
  const context = plan.decompositionContextJson;
  const judge = context && typeof context === "object" && "judge" in context
    ? (context as { judge?: unknown }).judge
    : undefined;
  if (!judge || typeof judge !== "object") {
    return { passed: 0, total: 0, pass_rate_pct: 0 };
  }
  const decision = (judge as { decision?: unknown }).decision;
  const passed = decision === "approve" ? 1 : 0;
  return {
    passed,
    total: 1,
    pass_rate_pct: passed === 1 ? 100 : 0
  };
}

function ageLabel(seconds: number, locale: WorkHubLocale) {
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) {
    return locale === "en-US" ? `${hours}h` : `${hours}h`;
  }
  const minutes = Math.max(1, Math.floor(seconds / 60));
  return locale === "en-US" ? `${minutes}m` : `${minutes}m`;
}

function blockerLabel(title: string, ageSeconds: number, locale: WorkHubLocale) {
  const age = ageLabel(ageSeconds, locale);
  return locale === "en-US"
    ? `Blocked: ${title} · ${age}`
    : `卡在: ${title} · ${age}`;
}

function reasonPreview(reasonMd: string, locale: WorkHubLocale = "zh-CN") {
  return reasonMd.replace(/\s+/gu, " ").trim().slice(0, 160) || (locale === "en-US" ? "Needs your decision." : "等你决定。");
}

export function buildAgentArmyDashboardPage(input: AgentArmyDashboardPageInput): AgentArmyDashboardVM {
  const generatedAt = input.generatedAt ?? new Date();
  const locale = input.locale ?? "zh-CN";
  const itemsByPlan = groupByPlan(input.items);
  const runsByPlan = groupRunsByPlan(input.runs);
  const runsByItem = groupRunsByItem(input.runs);
  const escalationsByPlan = groupByPlan(input.escalations);
  const costs = costBuckets(input.ledgerEntries);
  const visiblePlanIds = new Set(input.plans.map((row) => row.plan.id));
  const todayBucket = generatedAt.toISOString().slice(0, 10);
  // B-R9.6（branch-review O(n²)）：去重原先在 reduce 里对全量账目 findIndex——90 天
  // 全量账目下是平方扫描。改 Set 单遍：同 (plan, usageRecord) 只记一次。
  const seenTodayCostKeys = new Set<string>();
  let todayCost = 0;
  for (const entry of input.ledgerEntries) {
    if (entry.periodBucket !== todayBucket) {
      continue;
    }
    const planId = entry.taskPlanId ?? (entry.scope.kind === "task" ? entry.scope.taskPlanId : undefined);
    if (!planId || !visiblePlanIds.has(planId)) {
      continue;
    }
    const key = `${planId}:${entry.usageRecordId}`;
    if (seenTodayCostKeys.has(key)) {
      continue;
    }
    seenTodayCostKeys.add(key);
    todayCost += numericCny(entry.estimatedCostCny) ?? 0;
  }

  const plans = input.plans.map((row) => {
    const planItems = itemsByPlan.get(row.plan.id) ?? [];
    const planRuns = runsByPlan.get(row.plan.id) ?? [];
    const planEscalations = escalationsByPlan.get(row.plan.id) ?? [];
    const roleCounts = new Map<TaskPlanItemRow["role"], number>();
    const statusCounts = new Map<WorkItemAgentTeamItemStatus, number>();
    let completed = 0;
    let oldestBlocker: { title: string; at: Date } | undefined;

    for (const item of planItems) {
      increment(roleCounts, item.role);
      const run = latestRun(runsByItem.get(item.id) ?? []);
      const status = dashboardStatus(item, run);
      increment(statusCounts, status);
      if (status === "succeeded") {
        completed += 1;
      }
      if (status === "needs_human") {
        const blockerAt = run?.updatedAt ?? item.updatedAt;
        if (!oldestBlocker || blockerAt.getTime() < oldestBlocker.at.getTime()) {
          oldestBlocker = { title: run?.title ?? item.title, at: blockerAt };
        }
      }
    }

    for (const escalation of planEscalations) {
      if (!oldestBlocker || escalation.createdAt.getTime() < oldestBlocker.at.getTime()) {
        const run = planRuns.find((candidate) => candidate.id === escalation.runId);
        oldestBlocker = { title: run?.title ?? row.workItem.title ?? row.workItem.code, at: escalation.createdAt };
      }
    }

    const planCost = costs.buckets.get(row.plan.id)?.cost ?? 0;
    const budgetCny = budgetFromPlan(row.plan);
    const budget = numericCny(budgetCny);
    const burnPct = budget && budget > 0 ? Math.round((planCost / budget) * 100) : undefined;
    const ageSeconds = oldestBlocker
      ? Math.max(0, Math.floor((generatedAt.getTime() - oldestBlocker.at.getTime()) / 1000))
      : undefined;

    return {
      plan_id: row.plan.id,
      work_item_id: row.workItem.id,
      work_item_code: row.workItem.code,
      work_item_title: row.workItem.title ?? row.workItem.code,
      work_item_href: `/workitems/${row.workItem.id}`,
      ...(row.objective?.id ? { objective_id: row.objective.id } : {}),
      ...(row.objective?.title ? { objective_title: row.objective.title } : {}),
      ...(row.objective?.progressPercent !== null && row.objective?.progressPercent !== undefined
        ? { objective_progress_pct: Math.max(0, Math.min(100, row.objective.progressPercent)) }
        : {}),
      // 普通用户审查 R2 high：成本页军团卡仅管理员可见——非 admin 点「查看成本」是死链，不给链接
      // （卡上本就有 已花/预算 数字）。
      ...(input.isAdmin ? { budget_href: "/dashboard/cost" } : {}),
      status: row.plan.status,
      last_activity_at: row.plan.updatedAt.toISOString(),
      progress: {
        completed,
        total: planItems.length,
        label: `${completed}/${planItems.length}`
      },
      roles: sortedCounts(roleCounts).map(({ key, count }) => ({ role: key, count })),
      statuses: sortedCounts(statusCounts).map(({ key, count }) => ({ status: key, count })),
      cost: {
        used_cny: formatCny(planCost),
        ...(budgetCny ? { budget_cny: budgetCny } : {}),
        ...(burnPct !== undefined ? { burn_pct: Math.max(0, burnPct) } : {})
      },
      judge: judgeStats(row.plan),
      ...(oldestBlocker && ageSeconds !== undefined ? {
        oldest_blocker: {
          kind: "needs_human" as const,
          label: blockerLabel(oldestBlocker.title, ageSeconds, locale),
          age_seconds: ageSeconds,
          href: "/attention"
        }
      } : {}),
      updated_at: row.plan.updatedAt.toISOString()
    };
  });

  const recentEscalations = input.escalations.map((escalation) => {
    const row = input.plans.find((candidate) => candidate.plan.id === escalation.planId);
    const run = input.runs.find((candidate) => candidate.id === escalation.runId);
    const titleBase = run?.title ?? row?.workItem.title ?? row?.workItem.code ?? (locale === "en-US" ? "Agent task" : "子任务");
    return {
      id: escalation.id,
      ...(escalation.planId ? { plan_id: escalation.planId } : {}),
      work_item_id: escalation.workItemId,
      title: locale === "en-US" ? `${titleBase} needs review` : `${titleBase}需要人判断`,
      reason_preview: reasonPreview(escalation.reasonMd, locale),
      created_at: escalation.createdAt.toISOString(),
      href: "/attention"
    };
  });

  return parseOutputContract(agentArmyDashboardVmSchema, {
    generated_at: generatedAt.toISOString(),
    kpis: {
      active_team_count: input.plans.length,
      // B-R9.6（跨页一致性）：「等你决策数」与收件箱同口径——不许用 max() 拿 dashboard
      // 自己捞的升级数抬高（收件箱按可见性/分页收口后就是用户看到的数）。
      waiting_decision_count: input.attentionCount,
      today_cost_cny: formatCny(todayCost),
      autonomy_rate_pct: input.autonomyRatePct ?? 0
    },
    plans,
    recent_escalations: recentEscalations,
    source_warnings: input.sourceWarnings ?? [],
    page_info: {
      plan_limit: input.pageInfo.planLimit,
      returned: input.plans.length,
      plans_capped: input.pageInfo.plansCapped,
      items_capped: input.pageInfo.itemsCapped,
      runs_capped: input.pageInfo.runsCapped,
      escalation_limit: input.pageInfo.escalationLimit,
      escalation_returned: input.escalations.length,
      escalations_capped: input.pageInfo.escalationsCapped
    },
    ...(input.plans.length === 0 ? { empty_state: "no_agent_armies" as const } : {})
  }, "agent-army-dashboard");
}
