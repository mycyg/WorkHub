import type { WorkHubLocale } from "@workhub/contracts";

import { uiT } from "./i18n.js";

export const subrecordItemDiffCss = [
  ".wh-subrecord{border:1px solid #e1e8f5;border-radius:8px;background:#f8fbff;padding:10px 12px;display:grid;gap:8px}",
  ".wh-subrecord>summary{cursor:pointer;font-weight:800}",
  ".wh-subrecord-list{display:grid;gap:8px}",
  ".wh-subrecord-row{border:1px solid #e4ebf6;border-radius:8px;background:#fff;padding:10px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px}",
  ".wh-subrecord-values{display:grid;gap:3px;margin-top:5px}",
  ".wh-subrecord-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;align-content:start}",
  ".wh-subrecord-choice{border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:7px 10px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}",
  ".wh-subrecord-choice[data-subrecord-decision=accept_incoming]{background:#eef3ff;border-color:#b9c7ff;color:#2447c8}",
  ".wh-task-plan-scope{border:1px solid #cdd9f4;border-radius:8px;background:#f5f8ff;padding:10px;display:grid;gap:8px}",
  ".wh-task-plan-scope p{margin:4px 0 0;color:var(--muted);font-size:13px}",
  ".wh-task-plan-options{display:flex;gap:8px;flex-wrap:wrap}",
  ".wh-task-plan-choice{border:1px solid #b9c7ff;border-radius:8px;background:#fff;color:#1f2f57;padding:7px 10px;display:grid;gap:2px;text-align:left;font:inherit;font-size:12px;font-weight:800;cursor:pointer}",
  ".wh-task-plan-choice small{color:var(--muted);font-weight:600}",
  ".wh-task-plan-choice[data-task-plan-selected=true]{background:#eef3ff;color:#2447c8}",
  ".wh-subrecord-row[data-subrecord-diff-kind=added]{border-color:#bde7cd}",
  ".wh-subrecord-row[data-subrecord-diff-kind=removed]{border-color:#f1c4b8}",
  ".wh-subrecord-row[data-subrecord-diff-kind=modified]{border-color:#d8e1f2}"
].join("");

export type SubrecordItemDiffSurface = "proposal" | "replay";

export type SubrecordItemDiffAction = {
  href: string;
  method: string;
  actionId: string;
};

export type SubrecordItemDiffOptions = {
  operations: unknown;
  taskPlanScope?: unknown;
  locale: WorkHubLocale;
  surface: SubrecordItemDiffSurface;
  action?: SubrecordItemDiffAction;
};

type SubrecordField = "acceptance_items" | "task_items";
type SubrecordDiffKind = "added" | "modified" | "removed" | "unchanged";
type SubrecordItem = Record<string, unknown> & { id: string };
type TaskPlanScopeOption = {
  id: string;
  label: string;
  stage?: string;
  status?: string;
  itemCount?: number;
  recommended?: boolean;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(locale: WorkHubLocale, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function shortString(value: unknown) {
  const collapsed = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (!collapsed) {
    return "";
  }
  return collapsed.length > 72 ? `${collapsed.slice(0, 69)}...` : collapsed;
}

function itemRecord(value: unknown): SubrecordItem | undefined {
  const record = objectRecord(value);
  const id = typeof record?.["id"] === "string" ? record["id"] : undefined;
  return id ? { ...record, id } : undefined;
}

function itemRecords(value: unknown): SubrecordItem[] {
  return Array.isArray(value)
    ? value.map(itemRecord).filter((item): item is SubrecordItem => Boolean(item))
    : [];
}

function byId(items: SubrecordItem[]) {
  return new Map(items.map((item) => [item.id, item] as const));
}

function itemTitle(item: SubrecordItem | undefined, fallback: string) {
  const title = shortString(item?.["title"]);
  return title || fallback;
}

function itemMeta(field: SubrecordField, item: SubrecordItem | undefined, locale: WorkHubLocale) {
  if (!item) {
    return "";
  }
  const parts = [
    field === "acceptance_items" ? item["status"] : item["item_type"],
    field === "task_items" ? item["estimate_hours"] : undefined,
    item["sort_order"]
  ]
    .map(shortString)
    .filter(Boolean);
  return parts.length > 0 ? ` · ${parts.join(" / ")}` : text(locale, " · 无额外信息", " · no extra detail");
}

function itemSummary(field: SubrecordField, item: SubrecordItem | undefined, locale: WorkHubLocale) {
  if (!item) {
    return text(locale, "不存在", "Not present");
  }
  return `${itemTitle(item, item.id)}${itemMeta(field, item, locale)}`;
}

// 稳定序列化：递归按 key 排序，避免不同 key 顺序的等价对象被误判为 "modified"（幻象 diff 行）。
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function itemKind(current: SubrecordItem | undefined, incoming: SubrecordItem | undefined): SubrecordDiffKind {
  if (!current && incoming) return "added";
  if (current && !incoming) return "removed";
  if (current && incoming && stableStringify(current) !== stableStringify(incoming)) return "modified";
  return "unchanged";
}

function diffKindLabel(locale: WorkHubLocale, kind: SubrecordDiffKind) {
  if (kind === "added") return uiT(locale, "proposal.subrecordAdded");
  if (kind === "removed") return uiT(locale, "proposal.subrecordRemoved");
  if (kind === "modified") return uiT(locale, "proposal.subrecordModified");
  return uiT(locale, "proposal.subrecordUnchanged");
}

function fieldLabel(locale: WorkHubLocale, field: SubrecordField) {
  return field === "acceptance_items"
    ? uiT(locale, "proposal.subrecordAcceptance")
    : uiT(locale, "proposal.subrecordTask");
}

function itemOverridePayload(field: SubrecordField, itemId: string, decision: "accept_incoming" | "keep_current") {
  return {
    confirm: true,
    structured_item_overrides: {
      items: [
        {
          field,
          item_id: itemId,
          decision
        }
      ]
    }
  };
}

function taskPlanScopePayload(targetPlanId: string) {
  return {
    confirm: true,
    task_plan_scope: {
      target_plan_id: targetPlanId
    }
  };
}

function itemOverrideWithTaskPlanPayload(
  field: SubrecordField,
  itemId: string,
  decision: "accept_incoming" | "keep_current",
  targetPlanId?: string
) {
  return {
    ...itemOverridePayload(field, itemId, decision),
    ...(targetPlanId ? { task_plan_scope: { target_plan_id: targetPlanId } } : {})
  };
}

function parseTaskPlanScopeOption(value: unknown, index: number): TaskPlanScopeOption | undefined {
  const record = objectRecord(value);
  const id = typeof record?.["id"] === "string"
    ? record["id"]
    : typeof record?.["plan_id"] === "string"
      ? record["plan_id"]
      : undefined;
  if (!id) {
    return undefined;
  }
  const label = shortString(record?.["label"])
    || shortString(record?.["summary"])
    || shortString(record?.["name"])
    || `Plan ${index + 1}`;
  return {
    id,
    label,
    ...(typeof record?.["stage"] === "string" ? { stage: record["stage"] } : {}),
    ...(typeof record?.["status"] === "string" ? { status: record["status"] } : {}),
    ...(typeof record?.["item_count"] === "number" && Number.isFinite(record["item_count"])
      ? { itemCount: record["item_count"] }
      : {}),
    ...(record?.["recommended"] === true ? { recommended: true } : {})
  };
}

function parseTaskPlanScope(value: unknown): { options: TaskPlanScopeOption[]; selectedPlanId?: string } | undefined {
  const record = objectRecord(value);
  if (!record) {
    return undefined;
  }
  const rawOptions = Array.isArray(record["options"])
    ? record["options"]
    : Array.isArray(record["plans"])
      ? record["plans"]
      : [];
  const options = rawOptions
    .map(parseTaskPlanScopeOption)
    .filter((option): option is TaskPlanScopeOption => Boolean(option));
  const selectedPlanId = typeof record["selected_plan_id"] === "string"
    ? record["selected_plan_id"]
    : typeof record["target_plan_id"] === "string"
      ? record["target_plan_id"]
      : undefined;
  if (options.length === 0 && !selectedPlanId) {
    return undefined;
  }
  return {
    options,
    ...(selectedPlanId ? { selectedPlanId } : {})
  };
}

function renderTaskPlanScope(input: {
  action: SubrecordItemDiffAction | undefined;
  locale: WorkHubLocale;
  scope?: { options: TaskPlanScopeOption[]; selectedPlanId?: string };
}) {
  if (!input.scope || input.scope.options.length === 0) {
    return "";
  }
  const buttons = input.scope.options.map((option) => {
    const selected = option.id === input.scope?.selectedPlanId;
    const meta = [
      option.stage,
      option.status,
      typeof option.itemCount === "number"
        ? text(input.locale, `${option.itemCount} 项`, `${option.itemCount} items`)
        : undefined,
      option.recommended ? uiT(input.locale, "proposal.taskPlanScopeRecommended") : undefined
    ].filter(Boolean).join(" / ");
    const payload = taskPlanScopePayload(option.id);
    const actionAttrs = input.action
      ? ` data-action-id="${escapeHtml(input.action.actionId)}" data-action-href="${escapeHtml(input.action.href)}" data-method="${escapeHtml(input.action.method)}" data-request-json-template="${escapeHtml(JSON.stringify(payload))}"`
      : "";
    return `<button type="button" class="wh-task-plan-choice" data-task-plan-choice="true" data-task-plan-id="${escapeHtml(option.id)}" data-task-plan-selected="${escapeHtml(String(selected))}"${actionAttrs}>
      <span>${escapeHtml(option.label)}</span>
      ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
    </button>`;
  }).join("");
  return `<div class="wh-task-plan-scope" data-task-plan-scope="required" data-task-plan-option-count="${escapeHtml(String(input.scope.options.length))}">
    <div>
      <strong>${escapeHtml(uiT(input.locale, "proposal.taskPlanScopeTitle"))}</strong>
      <p>${escapeHtml(uiT(input.locale, "proposal.taskPlanScopeBody"))}</p>
    </div>
    <div class="wh-task-plan-options">${buttons}</div>
  </div>`;
}

function renderChoice(input: {
  action: SubrecordItemDiffAction;
  field: SubrecordField;
  itemId: string;
  locale: WorkHubLocale;
  decision: "accept_incoming" | "keep_current";
  targetPlanId?: string;
}) {
  const label = input.decision === "accept_incoming"
    ? uiT(input.locale, "proposal.subrecordAcceptIncoming")
    : uiT(input.locale, "proposal.subrecordKeepCurrent");
  return `<button type="button" class="wh-subrecord-choice" data-action-id="${escapeHtml(input.action.actionId)}" data-action-href="${escapeHtml(input.action.href)}" data-method="${escapeHtml(input.action.method)}" data-subrecord-item-choice="true" data-subrecord-field="${escapeHtml(input.field)}" data-subrecord-item-id="${escapeHtml(input.itemId)}" data-subrecord-decision="${escapeHtml(input.decision)}" data-request-json-template="${escapeHtml(JSON.stringify(itemOverrideWithTaskPlanPayload(input.field, input.itemId, input.decision, input.targetPlanId)))}">${escapeHtml(label)}</button>`;
}

function renderRow(input: {
  field: SubrecordField;
  itemId: string;
  kind: SubrecordDiffKind;
  current: SubrecordItem | undefined;
  incoming: SubrecordItem | undefined;
  locale: WorkHubLocale;
  surface: SubrecordItemDiffSurface;
  action?: SubrecordItemDiffAction;
  targetPlanId?: string;
}) {
  const item = input.incoming ?? input.current;
  const actions = input.action
    ? `<div class="wh-subrecord-actions">${renderChoice({
      action: input.action,
      field: input.field,
      itemId: input.itemId,
      locale: input.locale,
      decision: "accept_incoming",
      ...(input.targetPlanId ? { targetPlanId: input.targetPlanId } : {})
    })}${renderChoice({
      action: input.action,
      field: input.field,
      itemId: input.itemId,
      locale: input.locale,
      decision: "keep_current",
      ...(input.targetPlanId ? { targetPlanId: input.targetPlanId } : {})
    })}</div>`
    : `<div class="wh-subrecord-actions"><span class="wh-pill">${escapeHtml(diffKindLabel(input.locale, input.kind))}</span></div>`;
  const dataPrefix = input.surface === "proposal" ? "proposal" : "replay";
  return `<article class="wh-subrecord-row" data-${dataPrefix}-subrecord-item="${escapeHtml(input.itemId)}" data-subrecord-field="${escapeHtml(input.field)}" data-subrecord-item-id="${escapeHtml(input.itemId)}" data-subrecord-diff-kind="${escapeHtml(input.kind)}">
    <div>
      <strong>${escapeHtml(itemTitle(item, input.itemId))}</strong>
      <span class="wh-pill">${escapeHtml(diffKindLabel(input.locale, input.kind))}</span>
      <div class="wh-subrecord-values">
        <p class="wh-structured-fields">${escapeHtml(uiT(input.locale, "proposal.subrecordCurrent"))}: ${escapeHtml(itemSummary(input.field, input.current, input.locale))}</p>
        <p class="wh-structured-fields">${escapeHtml(uiT(input.locale, "proposal.subrecordIncoming"))}: ${escapeHtml(itemSummary(input.field, input.incoming, input.locale))}</p>
      </div>
    </div>
    ${actions}
  </article>`;
}

function renderField(input: {
  field: SubrecordField;
  current: SubrecordItem[];
  incoming: SubrecordItem[];
  locale: WorkHubLocale;
  surface: SubrecordItemDiffSurface;
  action?: SubrecordItemDiffAction;
  taskPlanScope?: { options: TaskPlanScopeOption[]; selectedPlanId?: string };
}) {
  const currentById = byId(input.current);
  const incomingById = byId(input.incoming);
  const ids = [...input.current.map((item) => item.id), ...input.incoming.map((item) => item.id)]
    .filter((item, index, all) => all.indexOf(item) === index);
  const changedRows = ids
    .map((id) => {
      const current = currentById.get(id);
      const incoming = incomingById.get(id);
      const kind = itemKind(current, incoming);
      return kind === "unchanged"
        ? ""
        : renderRow({
          field: input.field,
          itemId: id,
          kind,
          current,
          incoming,
          locale: input.locale,
          surface: input.surface,
          ...(input.action ? { action: input.action } : {}),
          ...(input.taskPlanScope?.selectedPlanId ? { targetPlanId: input.taskPlanScope.selectedPlanId } : {})
        });
    })
    .filter(Boolean);
  const rows = changedRows.join("");
  if (!rows) {
    return "";
  }
  const dataPrefix = input.surface === "proposal" ? "proposal" : "replay";
  const changedCount = changedRows.length;
  const scope = input.field === "task_items" && input.taskPlanScope
    ? renderTaskPlanScope({
      action: input.action,
      locale: input.locale,
      scope: input.taskPlanScope
    })
    : "";
  return `<section class="wh-subrecord-list" data-${dataPrefix}-subrecord-field="${escapeHtml(input.field)}" data-subrecord-field="${escapeHtml(input.field)}" data-subrecord-item-count="${escapeHtml(String(changedCount))}">
    <div class="wh-structured-head">
      <strong>${escapeHtml(fieldLabel(input.locale, input.field))}</strong>
      <span class="wh-pill">${escapeHtml(String(changedCount))}</span>
    </div>
    ${scope}
    ${rows}
  </section>`;
}

export function renderSubrecordItemDiff(options: SubrecordItemDiffOptions) {
  const operations = Array.isArray(options.operations) ? options.operations : [];
  const taskPlanScope = parseTaskPlanScope(options.taskPlanScope);
  const sections = operations
    .map((operation) => {
      const record = objectRecord(operation);
      if (!record) {
        return "";
      }
      const field = record?.["field"];
      if (field !== "acceptance_items" && field !== "task_items") {
        return "";
      }
      const current = itemRecords(
        Object.prototype.hasOwnProperty.call(record, "current_value")
          ? record["current_value"]
          : record["before_value"]
      );
      const incoming = itemRecords(record["value"]);
      return renderField({
        field,
        current,
        incoming,
        locale: options.locale,
        surface: options.surface,
        ...(taskPlanScope ? { taskPlanScope } : {}),
        ...(options.action ? { action: options.action } : {})
      });
    })
    .filter(Boolean)
    .join("");
  if (!sections) {
    return "";
  }
  const dataPrefix = options.surface === "proposal" ? "proposal" : "replay";
  const tag = options.action ? "details" : "section";
  const summary = options.action
    ? `<summary>${escapeHtml(uiT(options.locale, "proposal.subrecordEditorTitle"))}</summary><p class="wh-field-editor-body">${escapeHtml(uiT(options.locale, "proposal.subrecordEditorBody"))}</p>`
    : `<div class="wh-structured-head"><strong>${escapeHtml(uiT(options.locale, "proposal.subrecordReplayTitle"))}</strong></div>`;
  return `<${tag} class="wh-subrecord" data-${dataPrefix}-subrecord-item-diff="true">
    ${summary}
    ${sections}
  </${tag}>`;
}
