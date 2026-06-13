import type { WorkHubLocale } from "@workhub/contracts";

type StructuredDetailSurface = "proposal" | "replay";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(locale: WorkHubLocale, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function fieldLabel(locale: WorkHubLocale, field: string) {
  const labels: Record<string, { zh: string; en: string }> = {
    title: { zh: "标题", en: "Title" },
    summary_md: { zh: "说明", en: "Summary" },
    priority: { zh: "优先级", en: "Priority" },
    due_at: { zh: "截止时间", en: "Due date" },
    acceptance_items: { zh: "验收项", en: "Acceptance items" },
    task_items: { zh: "任务项", en: "Task items" }
  };
  const label = labels[field];
  return label ? text(locale, label.zh, label.en) : field;
}

function shortString(value: string) {
  const collapsed = value.replace(/\s+/gu, " ").trim();
  return collapsed.length > 72 ? `${collapsed.slice(0, 69)}...` : collapsed;
}

function summarizeArray(value: unknown[], locale: WorkHubLocale) {
  const names = value
    .map((item) => objectRecord(item)?.["title"])
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map(shortString);
  const unit = text(locale, "项", "items");
  if (names.length === 0) {
    return `${value.length} ${unit}`;
  }
  return `${value.length} ${unit}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? "..." : ""}`;
}

function summarizeValue(value: unknown, locale: WorkHubLocale): string {
  if (value === undefined) {
    return text(locale, "未记录", "Not recorded");
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return summarizeArray(value, locale);
  }
  if (typeof value === "string") {
    return shortString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const record = objectRecord(value);
  if (record) {
    const title = record["title"];
    if (typeof title === "string" && title.trim().length > 0) {
      return shortString(title);
    }
    const keyCount = Object.keys(record).length;
    return text(locale, `${keyCount} 个字段`, `${keyCount} fields`);
  }
  return String(value);
}

function operationRows(input: {
  records: unknown[];
  locale: WorkHubLocale;
  surface: StructuredDetailSurface;
  mode: "operation" | "audit";
}) {
  return input.records
    .map((item) => {
      const record = objectRecord(item);
      const field = typeof record?.["field"] === "string" ? record["field"] : undefined;
      if (!field) {
        return "";
      }
      const beforeValue = input.mode === "audit" ? record?.["baseValue"] : record?.["before_value"];
      const currentValue = input.mode === "audit" ? record?.["beforeValue"] : record?.["current_value"];
      const afterValue = input.mode === "audit" ? record?.["afterValue"] : record?.["value"];
      const valueType = input.mode === "audit" ? record?.["valueType"] : record?.["value_type"];
      const itemCount = typeof record?.["itemCount"] === "number"
        ? record["itemCount"]
        : Array.isArray(afterValue)
          ? afterValue.length
          : undefined;
      const decision = typeof record?.["mergeDecision"] === "string" ? record["mergeDecision"] : undefined;
      const dataPrefix = input.surface === "proposal" ? "proposal" : "replay";
      const countPill = itemCount === undefined
        ? ""
        : `<span class="wh-pill">${escapeHtml(text(input.locale, "数量", "Items"))}: ${escapeHtml(String(itemCount))}</span>`;
      const decisionPill = decision
        ? `<span class="wh-pill">${escapeHtml(text(input.locale, "策略", "Decision"))}: ${escapeHtml(decision)}</span>`
        : "";
      const typePill = typeof valueType === "string"
        ? `<span class="wh-pill">${escapeHtml(text(input.locale, "类型", "Type"))}: ${escapeHtml(valueType)}</span>`
        : "";
      return `<div class="wh-field-row" data-${dataPrefix}-structured-field-${input.mode}="${escapeHtml(field)}" data-structured-field-value-type="${escapeHtml(typeof valueType === "string" ? valueType : "")}" data-structured-field-item-count="${escapeHtml(itemCount === undefined ? "" : String(itemCount))}">
        <div>
          <strong>${escapeHtml(fieldLabel(input.locale, field))}</strong>
          <p class="wh-structured-fields">${escapeHtml(text(input.locale, "原始值", "Base"))}: ${escapeHtml(summarizeValue(beforeValue, input.locale))}</p>
          <p class="wh-structured-fields">${escapeHtml(text(input.locale, "当前", "Current"))}: ${escapeHtml(summarizeValue(currentValue, input.locale))}</p>
          <p class="wh-structured-fields">${escapeHtml(text(input.locale, "写入", "After"))}: ${escapeHtml(summarizeValue(afterValue, input.locale))}</p>
        </div>
        <div class="wh-field-row-meta">${typePill}${countPill}${decisionPill}</div>
      </div>`;
    })
    .filter(Boolean)
    .join("");
}

export function renderStructuredFieldOperationDetails(input: {
  operations: unknown;
  locale: WorkHubLocale;
  surface: StructuredDetailSurface;
}) {
  const operations = Array.isArray(input.operations) ? input.operations : [];
  const rows = operationRows({
    records: operations,
    locale: input.locale,
    surface: input.surface,
    mode: "operation"
  });
  if (!rows) {
    return "";
  }
  const dataPrefix = input.surface === "proposal" ? "proposal" : "replay";
  return `<section class="wh-field-details" data-${dataPrefix}-structured-field-details="true">
    <div class="wh-structured-head">
      <strong>${escapeHtml(text(input.locale, "字段改动详情", "Field-level targets"))}</strong>
      <span class="wh-pill">${escapeHtml(String(operations.length))}</span>
    </div>
    <div class="wh-field-list">${rows}</div>
  </section>`;
}

function auditDetail(record: unknown) {
  const row = objectRecord(record);
  return objectRecord(row?.["detail_json"]) ?? objectRecord(row?.["detailJson"]);
}

export function renderStructuredFieldAuditDetails(input: {
  auditLogs: unknown;
  locale: WorkHubLocale;
  surface: StructuredDetailSurface;
}) {
  const logs = Array.isArray(input.auditLogs) ? input.auditLogs : [];
  const sections = logs
    .map((log) => {
      const detail = auditDetail(log);
      const changes = Array.isArray(detail?.["structured_field_changes"]) ? detail["structured_field_changes"] : [];
      if (detail?.["merge_strategy"] !== "field_merge" || changes.length === 0) {
        return "";
      }
      const rows = operationRows({
        records: changes,
        locale: input.locale,
        surface: input.surface,
        mode: "audit"
      });
      if (!rows) {
        return "";
      }
      const snapshot = typeof detail["merge_snapshot_id"] === "string"
        ? `<span class="wh-pill">${escapeHtml(text(input.locale, "快照", "Snapshot"))}: ${escapeHtml(detail["merge_snapshot_id"].slice(0, 8))}</span>`
        : "";
      return `<article class="wh-field-details" data-replay-structured-field-audit="true">
        <div class="wh-structured-head">
          <strong>${escapeHtml(text(input.locale, "字段保存记录", "Field writeback audit"))}</strong>
          <span class="wh-pill">${escapeHtml(String(changes.length))}</span>
        </div>
        <div class="wh-structured-meta">
          <span class="wh-pill">${escapeHtml(text(input.locale, "策略", "Strategy"))}: field_merge</span>
          ${snapshot}
        </div>
        <div class="wh-field-list">${rows}</div>
      </article>`;
    })
    .filter(Boolean)
    .join("");
  return sections ? `<section class="wh-list" data-replay-structured-field-audits="true">${sections}</section>` : "";
}
