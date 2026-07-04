import type { WorkHubLocale } from "@workhub/contracts";

function text(locale: WorkHubLocale, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function titleCase(value: string) {
  return value
    .replace(/[_./:-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\p{L}/gu, (char) => char.toUpperCase());
}

export function structuredFieldLabel(locale: WorkHubLocale, field: string) {
  const labels: Record<string, { zh: string; en: string }> = {
    title: { zh: "标题", en: "Title" },
    summary_md: { zh: "说明", en: "Summary" },
    priority: { zh: "优先级", en: "Priority" },
    due_at: { zh: "截止时间", en: "Due date" },
    acceptance_items: { zh: "验收项", en: "Acceptance items" },
    task_items: { zh: "任务项", en: "Task items" }
  };
  const label = labels[field];
  if (label) {
    return text(locale, label.zh, label.en);
  }
  const readable = titleCase(field);
  return readable || text(locale, "未知字段", "Unknown field");
}

export function compactStructuredFieldLabels(locale: WorkHubLocale, fields: string[]) {
  const labels = fields.map((field) => structuredFieldLabel(locale, field));
  if (labels.length <= 8) {
    return labels.join(", ");
  }
  return `${labels.slice(0, 8).join(", ")} +${labels.length - 8}`;
}
