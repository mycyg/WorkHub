import type { WorkHubLocale } from "@workhub/contracts";

type BudgetPeriod = "run" | "day" | "month";

const budgetActionLabels: Record<WorkHubLocale, Record<string, string>> = {
  "zh-CN": {
    add_budget: "追加预算继续",
    finish_current_output: "就用现有产出收尾",
    close_scope: "整体收工",
    downgrade_model: "降级模型继续",
    pause: "先暂停",
    ask_admin: "找管理员"
  },
  "en-US": {
    add_budget: "Add budget and continue",
    finish_current_output: "Finish with current output",
    close_scope: "Close scope",
    downgrade_model: "Switch to cheaper model",
    pause: "Pause for now",
    ask_admin: "Ask admin"
  }
};

const englishScopeLabelsByChinese = new Map<string, { label: string; periodIncluded?: true }>([
  ["当前事项 AI 执行预算", { label: "Current item AI run budget" }],
  ["军团计划预算", { label: "Task plan budget" }],
  ["目标预算", { label: "Objective budget" }],
  ["我的 AI 日预算", { label: "My AI budget today", periodIncluded: true }],
  ["我的今日 AI 预算", { label: "My AI budget today", periodIncluded: true }],
  ["团队 AI 预算", { label: "Team AI budget" }],
  ["团队今日 AI 预算", { label: "Team AI budget today", periodIncluded: true }],
  ["团队本月 AI 预算", { label: "Team AI budget this month", periodIncluded: true }],
  ["技能蒸馏(自我提升)预算", { label: "Curation budget" }],
  ["蒸馏预算", { label: "Curation budget" }],
  ["评测预算", { label: "Evaluation budget" }]
]);

export function localizedBudgetActionLabel(id: string, fallback: string, locale: WorkHubLocale) {
  return budgetActionLabels[locale][id] ?? fallback;
}

export function localizedBudgetUsageScopeLabel(
  scopeLabel: string | undefined,
  period: BudgetPeriod | undefined,
  locale: WorkHubLocale
) {
  const normalized = scopeLabel?.trim();
  if (!normalized) {
    return { label: undefined, periodIncluded: false };
  }
  if (locale === "zh-CN") {
    return { label: normalized, periodIncluded: false };
  }
  const mapped = englishScopeLabelsByChinese.get(normalized);
  if (!mapped) {
    return { label: normalized, periodIncluded: false };
  }
  if (normalized === "团队 AI 预算" && period === "day") {
    return { label: "Team AI budget today", periodIncluded: true };
  }
  if (normalized === "团队 AI 预算" && period === "month") {
    return { label: "Team AI budget this month", periodIncluded: true };
  }
  return { label: mapped.label, periodIncluded: mapped.periodIncluded === true };
}
