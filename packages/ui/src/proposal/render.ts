import type {
  ActionSpec,
  CuuState,
  DeliverableChange,
  DeliverableCheck,
  EvidenceRef,
  ProposalConflict,
  ProposalConflictOption,
  ProposalDetailVM,
  WorkHubLocale
} from "@workhub/contracts";

import {
  changeTypeLabel,
  checkStatusLabel,
  deliverableTargetLabel,
  evidenceSourceLabel,
  previewKindLabel,
  uiCount,
  uiLocale,
  uiT,
  type UiRenderOptions
} from "../i18n.js";
import {
  overlapHunkReviewCss,
  renderOverlapHunkReview,
  type OverlapHunkChoiceAction
} from "../overlap-hunk-review.js";
import { renderRichPatchViewer, richPatchViewerCss } from "../rich-patch-viewer.js";
import { renderRouteLineEditor, routeLineEditorCss } from "../route-line-editor.js";
import { renderStructuredFieldOperationDetails } from "../structured-field-details.js";
import { renderSubrecordItemDiff, subrecordItemDiffCss } from "../subrecord-item-diff.js";

export type ProposalRenderSurface = "web" | "desktop";

export type ProposalRenderedPage = {
  surface: ProposalRenderSurface;
  proposalId: string;
  workItemId: string;
  title: string;
  css: string;
  html: string;
  actionHrefs: string[];
  changeCount: number;
  evidenceCount: number;
  conflictCount: number;
  cuuState: CuuState;
};

export type ProposalRenderOptions = UiRenderOptions & {
  conflicts?: ProposalConflict[];
};

export type ProposalConflictRenderedCards = {
  html: string;
  actionHrefs: string[];
  conflictCount: number;
};

type BulkConflictDecision = "keep_current" | "accept_incoming";

type BulkConflictAction = {
  id: BulkConflictDecision;
  href: string;
  method: "POST";
  requestJson: {
    confirm: true;
    conflict_resolution: {
      accept_incoming_target_keys: string[];
      bulk_action: {
        action: BulkConflictDecision;
        target_keys: string[];
        conflict_count: number;
      };
    };
  };
};

export const proposalCss = [
  ":root{color-scheme:light;--ink:#182033;--muted:#5e6a86;--line:#dfe5f1;--paper:#fff;--soft:#f5f8fc;--blue:#355cff;--green:#24a66a;--coral:#ee6b5f;--amber:#d98b16;--danger:#d94a3a}",
  ".wh-proposal{font-family:\"Aptos\",\"Segoe UI\",sans-serif;color:var(--ink);background:linear-gradient(180deg,#f8fbff 0%,#eef4fb 100%);padding:24px;box-sizing:border-box}",
  ".wh-proposal-frame{max-width:1120px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:20px;align-items:start}",
  ".wh-proposal-main,.wh-proposal-rail{background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:8px;box-shadow:0 18px 50px rgba(37,51,79,.08);min-width:0}",
  ".wh-proposal-main{padding:24px}.wh-proposal-rail{padding:18px;position:sticky;top:16px}.wh-kicker{font-size:12px;color:var(--blue);font-weight:700;text-transform:uppercase;letter-spacing:0}",
  ".wh-title{font-size:30px;line-height:1.35;margin:8px 0}.wh-subtle{color:var(--muted);line-height:1.55}.wh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-top:18px}",
  ".wh-card{border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:16px;min-width:0;overflow-wrap:anywhere}.wh-row{display:flex;justify-content:space-between;gap:14px;border-top:1px solid var(--line);padding:12px 0}.wh-row:first-child{border-top:0}.wh-row>div{min-width:0}",
  ".wh-title,.wh-subtle{overflow-wrap:anywhere}.wh-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--soft);padding:5px 9px;font-size:12px;color:var(--muted);max-width:100%;white-space:normal;text-align:left;overflow-wrap:anywhere}.wh-pill-danger{background:#fff1ef;color:var(--danger)}",
  ".wh-check{display:grid;gap:4px;border-left:3px solid var(--green);padding-left:10px}.wh-check[data-status=warning],.wh-check[data-status=skipped]{border-left-color:var(--amber)}.wh-check[data-status=failed]{border-left-color:var(--danger)}",
  ".wh-conflict-list{display:grid;gap:12px;margin:20px 0}.wh-conflict-head{display:grid;gap:4px;border:1px solid #ffd6c8;background:#fff7f3;border-radius:8px;padding:14px}.wh-conflict-head .wh-kicker{color:#b94733}",
  ".wh-conflict-card{border:1px solid #f1d2c8;background:#fffdfb;border-radius:8px;padding:14px;display:grid;gap:10px}.wh-conflict-meta{display:flex;gap:8px;flex-wrap:wrap}.wh-conflict-summary{margin:0;color:var(--muted);line-height:1.5}.wh-conflict-options{display:flex;gap:10px;flex-wrap:wrap}.wh-recommended{font-size:11px;font-weight:800;border-radius:999px;padding:3px 7px;background:#eaf0ff;color:var(--blue)}",
  ".wh-conflict-workbench{border:1px solid #d9e2f3;background:#f8fbff;border-radius:8px;padding:12px}.wh-conflict-workbench>summary{cursor:pointer;font-weight:800;display:flex;align-items:center;justify-content:space-between;gap:10px}.wh-conflict-workbench-body{margin:8px 0;color:var(--muted);font-size:13px;line-height:1.5}.wh-conflict-workbench-list{display:grid;gap:6px}.wh-conflict-workbench-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;border-top:1px solid #e2e8f5;padding-top:8px}.wh-conflict-workbench-row:first-child{border-top:0;padding-top:0}.wh-conflict-workbench-target{font-weight:700;overflow-wrap:anywhere}.wh-conflict-workbench-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}",
  richPatchViewerCss,
  overlapHunkReviewCss,
  routeLineEditorCss,
  ".wh-structured{border:1px solid #dfe6d8;border-radius:8px;background:#fbfff8;padding:10px 12px;display:grid;gap:8px}.wh-structured-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.wh-structured-meta{display:flex;gap:6px;flex-wrap:wrap}.wh-structured-fields{margin:0;color:var(--muted);font-size:13px}",
  ".wh-field-details{border:1px solid #dfe6d8;border-radius:8px;background:#fffefa;padding:10px 12px;display:grid;gap:8px}.wh-field-list{display:grid;gap:8px}.wh-field-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;border-top:1px solid #e6ecd9;padding-top:8px}.wh-field-row:first-child{border-top:0;padding-top:0}.wh-field-row-meta{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-content:start}",
  ".wh-field-editor{border:1px solid #d8e1f2;border-radius:8px;background:#f8fbff;padding:10px 12px}.wh-field-editor>summary{cursor:pointer;font-weight:800}.wh-field-editor-body{margin:8px 0;color:var(--muted);font-size:13px}.wh-field-editor-list{display:grid;gap:8px}.wh-field-editor-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;border-top:1px solid #e1e8f5;padding-top:8px}.wh-field-editor-row:first-child{border-top:0}.wh-field-editor-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.wh-field-editor-custom{display:flex;gap:8px;flex-wrap:wrap;grid-column:1/-1}.wh-field-editor-custom textarea{min-height:42px;min-width:220px;flex:1;border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit;color:var(--ink);background:#fff}",
  subrecordItemDiffCss,
  ".wh-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.wh-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:8px;border:1px solid var(--line);padding:9px 12px;color:var(--ink);text-decoration:none;background:#fff;font-weight:650}.wh-btn-primary{background:var(--blue);color:#fff;border-color:var(--blue)}.wh-btn-danger{background:#fff4f3;color:#a94137;border-color:#f3c5c0}",
  ".wh-desktop .wh-proposal-frame{max-width:940px;grid-template-columns:1fr 240px}.wh-desktop .wh-proposal{background:linear-gradient(135deg,#edf6ff,#f8fbff)}@media (max-width:860px){.wh-proposal{padding:18px}.wh-proposal-frame{grid-template-columns:1fr}.wh-proposal-main{padding:18px}.wh-proposal-rail{position:static}.wh-title{font-size:24px}.wh-title,.wh-subtle,.wh-card strong{word-break:break-all}.wh-grid{grid-template-columns:1fr}.wh-row{flex-direction:column;align-items:flex-start}.wh-conflict-workbench-row,.wh-field-row,.wh-field-editor-row,.wh-subrecord-row{grid-template-columns:1fr}.wh-conflict-options,.wh-actions{align-items:flex-start}.wh-diff{font-size:11px}.wh-diff-line,.wh-diff-hunk-head{grid-template-columns:38px 38px minmax(0,1fr)}.wh-diff-line-no{padding:2px 6px}.wh-diff-code{padding:2px 8px}}"
].join("");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

// 契约/外部来源的 href（evidence.source_url、preview_ref.href 等）可能带 javascript:/data: 协议 → XSS。
// 只放行相对路径与 http/https/mailto，其余拦成 "#"。仍需再过 escapeHtml。
function safeHref(value: unknown): string {
  const v = String(value ?? "").trim();
  if (v.startsWith("/") || /^(?:https?:|mailto:)/iu.test(v)) {
    return v;
  }
  return "#";
}

function stripMarkdown(value: string) {
  return value.replace(/[#*_`>-]/gu, " ").replace(/\s+/gu, " ").trim();
}

function actionClass(action: ActionSpec, index: number) {
  if (action.id === "request_changes") {
    return "wh-btn wh-btn-danger";
  }
  return index === 0 ? "wh-btn wh-btn-primary" : "wh-btn";
}

function renderActions(actions: ActionSpec[]) {
  return `<div class="wh-actions">${actions
    .map((action, index) => {
      const reason = action.requires_reason ? ' data-requires-reason="true"' : "";
      const desktop = action.requires_desktop ? ' data-requires-desktop="true"' : "";
      return `<a class="${actionClass(action, index)}" href="${escapeHtml(action.href)}" data-action-id="${escapeHtml(action.id)}" data-method="${escapeHtml(action.method)}"${reason}${desktop}>${escapeHtml(action.label)}</a>`;
    })
    .join("")}</div>`;
}

function shortFingerprint(value: string | undefined) {
  return value ? value.slice(0, 10) : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringArrayField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function compactFieldList(fields: string[]) {
  if (fields.length <= 8) {
    return fields.join(", ");
  }
  return `${fields.slice(0, 8).join(", ")} +${fields.length - 8}`;
}

function dryRunStatusLabel(locale: WorkHubLocale, status: string) {
  const labels: Record<WorkHubLocale, Record<string, string>> = {
    "zh-CN": {
      ready: "可执行",
      needs_review: "需复核",
      blocked: "已阻断"
    },
    "en-US": {
      ready: "Ready",
      needs_review: "Needs review",
      blocked: "Blocked"
    }
  };
  return labels[locale][status] ?? status;
}

function structuredOperationRecords(operations: unknown) {
  return Array.isArray(operations)
    ? operations
        .map(objectRecord)
        .filter((operation): operation is Record<string, unknown> =>
          typeof operation?.["field"] === "string" && operation["field"].trim().length > 0
        )
    : [];
}

function structuredFieldOverridePayload(input: {
  operations: Array<Record<string, unknown>>;
  field: string;
  mode: "accept_only" | "keep_current" | "custom";
  customValue?: unknown;
}) {
  const overrides = input.mode === "accept_only"
    ? input.operations.map((operation) => ({
      field: String(operation["field"]),
      decision: operation["field"] === input.field ? "accept_incoming" : "keep_current"
    }))
    : [{
      field: input.field,
      decision: input.mode === "keep_current" ? "keep_current" : "custom",
      ...(input.mode === "custom" ? { value: input.customValue } : {})
    }];
  return {
    confirm: true,
    structured_field_overrides: {
      operations: overrides
    }
  };
}

function renderStructuredFieldEditor(input: {
  option: ProposalConflictOption;
  operations: unknown;
  locale: WorkHubLocale;
}) {
  if (input.option.id !== "ai_fusion" || !input.option.action?.href) {
    return "";
  }
  const operations = structuredOperationRecords(input.operations);
  if (operations.length === 0) {
    return "";
  }
  const method = input.option.action.method;
  const href = input.option.action.href;
  const rows = operations.map((operation) => {
    const field = String(operation["field"]);
    const acceptOnly = structuredFieldOverridePayload({ operations, field, mode: "accept_only" });
    const keepCurrent = structuredFieldOverridePayload({ operations, field, mode: "keep_current" });
    const customTemplate = structuredFieldOverridePayload({
      operations,
      field,
      mode: "custom",
      customValue: "__WORKHUB_CUSTOM_FIELD_VALUE__"
    });
    return `<div class="wh-field-editor-row" data-proposal-structured-field-editor-row="${escapeHtml(field)}">
      <strong>${escapeHtml(uiT(input.locale, "proposal.fieldEditorField"))}: ${escapeHtml(field)}</strong>
      <div class="wh-field-editor-actions">
        <a class="wh-btn" href="${escapeHtml(href)}" data-action-id="${escapeHtml(input.option.action?.id ?? "apply_ai_fusion")}" data-field-editor-action="accept_only" data-structured-field="${escapeHtml(field)}" data-method="${escapeHtml(method)}" data-request-json="${escapeHtml(JSON.stringify(acceptOnly))}">${escapeHtml(uiT(input.locale, "proposal.fieldEditorAcceptOnly"))}</a>
        <a class="wh-btn" href="${escapeHtml(href)}" data-action-id="${escapeHtml(input.option.action?.id ?? "apply_ai_fusion")}" data-field-editor-action="keep_current" data-structured-field="${escapeHtml(field)}" data-method="${escapeHtml(method)}" data-request-json="${escapeHtml(JSON.stringify(keepCurrent))}">${escapeHtml(uiT(input.locale, "proposal.fieldEditorKeep"))}</a>
      </div>
      <div class="wh-field-editor-custom">
        <textarea data-structured-field-custom-input="${escapeHtml(field)}" aria-label="${escapeHtml(uiT(input.locale, "proposal.fieldEditorCustomPlaceholder"))}"></textarea>
        <button type="button" class="wh-btn" data-action-id="${escapeHtml(input.option.action?.id ?? "apply_ai_fusion")}" data-field-editor-action="custom" data-structured-field="${escapeHtml(field)}" data-method="${escapeHtml(method)}" data-action-href="${escapeHtml(href)}" data-href="${escapeHtml(href)}" data-request-json-template="${escapeHtml(JSON.stringify(customTemplate))}">${escapeHtml(uiT(input.locale, "proposal.fieldEditorCustom"))}</button>
      </div>
    </div>`;
  }).join("");
  return `<details class="wh-field-editor" data-proposal-structured-field-editor="true" data-proposal-structured-field-editor-count="${escapeHtml(String(operations.length))}">
    <summary>${escapeHtml(uiT(input.locale, "proposal.fieldEditorTitle"))}</summary>
    <p class="wh-field-editor-body">${escapeHtml(uiT(input.locale, "proposal.fieldEditorBody"))}</p>
    <div class="wh-field-editor-list">${rows}</div>
  </details>`;
}

function renderStructuredRecordPatch(option: ProposalConflictOption, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  const patch = objectRecord(option.quality_gate?.["structured_record_patch"]);
  if (patch?.["type"] !== "structured_record_field_patch") {
    return "";
  }
  const changedFields = stringArrayField(patch, "changed_fields");
  const mergedFields = stringArrayField(patch, "merged_value_fields");
  const missingFields = stringArrayField(patch, "missing_fields");
  const unknownFields = stringArrayField(patch, "unknown_fields");
  const fieldCount = numberField(patch, "field_count");
  const dryRun = objectRecord(patch["structured_field_patch_dry_run"]);
  const dryRunAuditPayload = objectRecord(dryRun?.["audit_payload"]);
  const taskPlanScope = patch["task_plan_scope"] ?? dryRun?.["task_plan_scope"] ?? dryRunAuditPayload?.["task_plan_scope"];
  const dryRunStatus = typeof dryRun?.["status"] === "string" ? dryRun["status"] : "";
  const dryRunIssueCount = Array.isArray(dryRun?.["issues"]) ? dryRun["issues"].length : 0;
  const mergedLine = mergedFields.length > 0
    ? `<p class="wh-structured-fields">${escapeHtml(uiT(locale, "proposal.structuredPatchFields"))}: ${escapeHtml(compactFieldList(mergedFields))}</p>`
    : "";
  const missingLine = missingFields.length > 0
    ? `<p class="wh-structured-fields">${escapeHtml(uiT(locale, "proposal.structuredPatchMissing"))}: ${escapeHtml(compactFieldList(missingFields))}</p>`
    : "";
  const unknownLine = unknownFields.length > 0
    ? `<p class="wh-structured-fields">${escapeHtml(uiT(locale, "proposal.structuredPatchUnknown"))}: ${escapeHtml(compactFieldList(unknownFields))}</p>`
    : "";
  const dryRunLine = dryRunStatus
    ? `<p class="wh-structured-fields">${escapeHtml(uiT(locale, "proposal.structuredPatchDryRun"))}: ${escapeHtml(dryRunStatusLabel(locale, dryRunStatus))} · ${escapeHtml(uiT(locale, "proposal.structuredPatchIssues"))}: ${escapeHtml(String(dryRunIssueCount))}</p>`
    : "";
  const operations = objectRecord(dryRun?.["patch"])?.["operations"];
  const operationDetails = renderStructuredFieldOperationDetails({
    operations,
    locale,
    surface: "proposal"
  });
  const subrecordDiff = renderSubrecordItemDiff({
    operations,
    taskPlanScope,
    locale,
    surface: "proposal",
    ...(dryRunStatus === "ready" && dryRun?.["executable"] === true && option.action?.href
      ? {
        action: {
          href: option.action.href,
          method: option.action.method,
          actionId: option.action.id
        }
      }
      : {})
  });
  const fieldEditor = dryRunStatus === "ready" && dryRun?.["executable"] === true
    ? renderStructuredFieldEditor({
      option,
      operations,
      locale
    })
    : "";
  return `<section class="wh-structured" data-structured-record-patch="true" data-structured-patch-option-id="${escapeHtml(option.id)}" data-structured-patch-field-count="${escapeHtml(String(fieldCount))}" data-structured-patch-has-result="${escapeHtml(String(patch["has_structured_result"] === true))}" data-structured-patch-dry-run-status="${escapeHtml(dryRunStatus)}" data-structured-patch-dry-run-issues="${escapeHtml(String(dryRunIssueCount))}">
    <div class="wh-structured-head">
      <strong>${escapeHtml(uiT(locale, "proposal.structuredPatchTitle"))}</strong>
      <span class="wh-pill">${escapeHtml(String(fieldCount))}</span>
    </div>
    <div class="wh-structured-meta">
      <span class="wh-pill">${escapeHtml(uiT(locale, "proposal.structuredPatchChanged"))}: ${escapeHtml(String(changedFields.length))}</span>
      <span class="wh-pill">${escapeHtml(uiT(locale, "proposal.structuredPatchMissing"))}: ${escapeHtml(String(missingFields.length))}</span>
      <span class="wh-pill">${escapeHtml(uiT(locale, "proposal.structuredPatchUnknown"))}: ${escapeHtml(String(unknownFields.length))}</span>
    </div>
    ${dryRunLine}${mergedLine}${missingLine}${unknownLine}${operationDetails}${subrecordDiff}${fieldEditor}
  </section>`;
}

function overlapActionForOption(option: ProposalConflictOption): OverlapHunkChoiceAction {
  return {
    decision: option.id,
    ...(option.action?.id ? { actionId: option.action.id } : {}),
    ...(option.action?.href ? { href: option.action.href } : {}),
    ...(option.action?.method ? { method: option.action.method } : {}),
    ...(option.recommended !== undefined ? { recommended: option.recommended } : {})
  };
}

function renderTextDiff3QualityGate(
  option: ProposalConflictOption,
  conflictOptions: ProposalConflictOption[],
  options?: UiRenderOptions
) {
  const locale = uiLocale(options);
  const diff3 = objectRecord(option.quality_gate?.["text_diff3"]);
  return renderOverlapHunkReview({
    locale,
    diff3,
    optionKey: option.id,
    actions: conflictOptions.map(overlapActionForOption),
    rootAttributes: {
      "data-text-diff3": "true",
      "data-text-diff3-option-id": option.id
    }
  });
}

function renderTextPatchPreview(option: ProposalConflictOption, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  return renderRichPatchViewer({
    locale,
    preview: option.quality_gate?.["text_patch_preview"],
    title: uiT(locale, "proposal.patchTitle"),
    rootAttributes: {
      "data-proposal-text-patch-preview": "true",
      "data-conflict-option-preview-for": option.id
    }
  });
}

function conflictOptionLabel(option: ProposalConflictOption, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  if (option.id === "keep_current") {
    return uiT(locale, "proposal.conflictKeepCurrent");
  }
  if (option.id === "accept_incoming") {
    return uiT(locale, "proposal.conflictAcceptIncoming");
  }
  if (option.id === "ai_fusion") {
    if (option.action?.id === "apply_ai_fusion") {
      return uiT(locale, "proposal.conflictApplyAiFusion");
    }
    return uiT(locale, "proposal.conflictAiFusion");
  }
  return option.label;
}

function conflictOptionClass(option: ProposalConflictOption) {
  if (option.id === "accept_incoming") {
    return "wh-btn wh-btn-danger";
  }
  return option.recommended ? "wh-btn wh-btn-primary" : "wh-btn";
}

function renderConflictOption(option: ProposalConflictOption, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  const recommended = option.recommended
    ? `<span class="wh-recommended">${escapeHtml(uiT(locale, "proposal.conflictRecommended"))}</span>`
    : "";
  if (!option.action?.href) {
    return `<span class="${conflictOptionClass(option)}" data-conflict-option-id="${escapeHtml(option.id)}">${escapeHtml(conflictOptionLabel(option, { locale }))}${recommended}</span>`;
  }
  const requestJson = option.action.request_json
    ? ` data-request-json="${escapeHtml(JSON.stringify(option.action.request_json))}"`
    : "";
  return `<a class="${conflictOptionClass(option)}" href="${escapeHtml(option.action.href)}" data-action-id="${escapeHtml(option.action.id)}" data-conflict-option-id="${escapeHtml(option.id)}" data-method="${escapeHtml(option.action.method)}"${requestJson}>${escapeHtml(conflictOptionLabel(option, { locale }))}${recommended}</a>`;
}

function actionForConflictDecision(conflict: ProposalConflict, decision: BulkConflictDecision) {
  return conflict.options.find((option) => option.id === decision)?.action;
}

function buildBulkConflictAction(
  conflicts: ProposalConflict[],
  decision: BulkConflictDecision
): BulkConflictAction | undefined {
  if (conflicts.length <= 1) {
    return undefined;
  }
  const actions = conflicts.map((conflict) => actionForConflictDecision(conflict, decision));
  if (actions.some((action) => !action || action.method !== "POST" || !action.href)) {
    return undefined;
  }
  const href = actions[0]?.href;
  if (!href || actions.some((action) => action?.href !== href)) {
    return undefined;
  }
  const targetKeys = decision === "accept_incoming"
    ? Array.from(new Set(conflicts.map((conflict) => conflict.target_key)))
    : [];
  const bulkTargetKeys = Array.from(new Set(conflicts.map((conflict) => conflict.target_key)));
  return {
    id: decision,
    href,
    method: "POST",
    requestJson: {
      confirm: true,
      conflict_resolution: {
        accept_incoming_target_keys: targetKeys,
        bulk_action: {
          action: decision,
          target_keys: bulkTargetKeys,
          conflict_count: conflicts.length
        }
      }
    }
  };
}

function renderBulkConflictAction(action: BulkConflictAction, locale: WorkHubLocale) {
  const labelKey = action.id === "keep_current"
    ? "proposal.conflictWorkbenchBulkKeep"
    : "proposal.conflictWorkbenchBulkIncoming";
  const className = action.id === "accept_incoming" ? "wh-btn wh-btn-danger" : "wh-btn";
  return `<a class="${className}" href="${escapeHtml(action.href)}" data-action-id="bulk_${escapeHtml(action.id)}" data-proposal-conflict-bulk-action="${escapeHtml(action.id)}" data-action-href="${escapeHtml(action.href)}" data-method="${escapeHtml(action.method)}" data-request-json="${escapeHtml(JSON.stringify(action.requestJson))}">${escapeHtml(uiT(locale, labelKey))}</a>`;
}

function renderConflictWorkbench(conflicts: ProposalConflict[], options?: UiRenderOptions) {
  if (conflicts.length <= 1) {
    return { html: "", actionHrefs: [] };
  }
  const locale = uiLocale(options);
  const bulkActions = [
    buildBulkConflictAction(conflicts, "keep_current"),
    buildBulkConflictAction(conflicts, "accept_incoming")
  ].filter((action): action is BulkConflictAction => Boolean(action));
  const rows = conflicts.map((conflict) => {
    const target = conflict.target_path ?? conflict.target_key;
    const recommendedOption = conflict.options.find((option) => option.id === conflict.recommended_option_id);
    const recommended = recommendedOption
      ? conflictOptionLabel(recommendedOption, { locale })
      : conflict.recommended_option_id;
    return `<div class="wh-conflict-workbench-row" data-workbench-conflict-id="${escapeHtml(conflict.id)}" data-workbench-target-key="${escapeHtml(conflict.target_key)}" data-workbench-target-kind="${escapeHtml(conflict.target_kind)}" data-workbench-recommended-option="${escapeHtml(conflict.recommended_option_id)}">
      <span class="wh-conflict-workbench-target">${escapeHtml(target)}</span>
      <span class="wh-pill">${escapeHtml(conflict.target_kind)}</span>
      <span class="wh-pill">${escapeHtml(uiT(locale, "proposal.conflictWorkbenchRecommended"))}: ${escapeHtml(recommended)}</span>
    </div>`;
  }).join("");
  const actions = bulkActions.length > 0
    ? `<div class="wh-conflict-workbench-actions">${bulkActions.map((action) => renderBulkConflictAction(action, locale)).join("")}</div>`
    : "";
  return {
    actionHrefs: bulkActions.map((action) => action.href),
    html: `<details class="wh-conflict-workbench" data-proposal-conflict-workbench="true" data-proposal-conflict-workbench-count="${escapeHtml(String(conflicts.length))}" data-proposal-conflict-workbench-default="one_thing_first" data-proposal-conflict-workbench-high-signal="true">
      <summary><span>${escapeHtml(uiT(locale, "proposal.conflictWorkbenchTitle"))}</span><span class="wh-recommended">${escapeHtml(uiT(locale, "proposal.conflictWorkbenchDefault"))}</span></summary>
      <p class="wh-conflict-workbench-body">${escapeHtml(uiT(locale, "proposal.conflictWorkbenchBody"))}</p>
      <div class="wh-conflict-workbench-list">${rows}</div>
      ${actions}
    </details>`
  };
}

function renderConflict(conflict: ProposalConflict, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  const target = conflict.target_path ?? conflict.target_key;
  const existing = shortFingerprint(conflict.existing.sha256 ?? conflict.existing.ref);
  const incoming = shortFingerprint(conflict.incoming.sha256_after ?? conflict.incoming.ref);
  const meta = [
    `<span class="wh-pill">${escapeHtml(uiT(locale, "proposal.conflictTarget"))}: ${escapeHtml(target)}</span>`,
    existing ? `<span class="wh-pill">${escapeHtml(uiT(locale, "proposal.conflictExisting"))}: ${escapeHtml(existing)}</span>` : "",
    incoming ? `<span class="wh-pill">${escapeHtml(uiT(locale, "proposal.conflictIncoming"))}: ${escapeHtml(incoming)}</span>` : ""
  ].filter(Boolean).join("");
  const previews = conflict.options
    .flatMap((option) => [
      renderTextPatchPreview(option, { locale }),
      renderTextDiff3QualityGate(option, conflict.options, { locale }),
      renderStructuredRecordPatch(option, { locale })
    ])
    .filter(Boolean)
    .join("");

  return `<article class="wh-conflict-card" data-conflict-id="${escapeHtml(conflict.id)}" data-target-key="${escapeHtml(conflict.target_key)}">
    <strong>${escapeHtml(conflict.headline)}</strong>
    <p class="wh-conflict-summary">${escapeHtml(conflict.summary_text)}</p>
    <div class="wh-conflict-meta">${meta}</div>
    <div class="wh-conflict-options">${conflict.options.map((option) => renderConflictOption(option, { locale })).join("")}</div>
    ${previews}
  </article>`;
}

export function renderProposalConflictCards(
  conflicts: ProposalConflict[] = [],
  options?: UiRenderOptions
): ProposalConflictRenderedCards {
  const locale = uiLocale(options);
  const workbench = renderConflictWorkbench(conflicts, { locale });
  const lineEditor = renderRouteLineEditor(conflicts, { locale });
  const actionHrefs = conflicts.flatMap((conflict) =>
    conflict.options.map((option) => option.action?.href).filter((href): href is string => Boolean(href))
  );
  if (conflicts.length === 0) {
    return { html: "", actionHrefs, conflictCount: 0 };
  }
  return {
    conflictCount: conflicts.length,
    actionHrefs: [...actionHrefs, ...workbench.actionHrefs],
    html: `<section class="wh-conflict-list" data-proposal-conflicts="${conflicts.length}">
      <div class="wh-conflict-head">
        <span class="wh-kicker">${escapeHtml(uiT(locale, "proposal.conflictTitle"))}</span>
        <p class="wh-subtle">${escapeHtml(uiT(locale, "proposal.conflictBody"))}</p>
      </div>
      ${lineEditor}${workbench.html}
      ${conflicts.map((conflict) => renderConflict(conflict, { locale })).join("")}
    </section>`
  };
}

function renderChange(change: DeliverableChange, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  const path = change.target_ref.path ?? change.target_ref.entity_id ?? change.target_ref.entity_type;
  const preview = change.preview_ref
    ? `<a class="wh-pill" href="${escapeHtml(safeHref(change.preview_ref.href))}">${escapeHtml(previewKindLabel(locale, change.preview_ref.kind))}</a>`
    : "";
  return `<div class="wh-row" data-change-kind="${escapeHtml(change.target_kind)}" data-change-type="${escapeHtml(change.change_type)}">
    <div>
      <strong>${escapeHtml(change.human_summary)}</strong>
      <p class="wh-subtle">${escapeHtml(path)}</p>
    </div>
    <div>
      <span class="wh-pill">${escapeHtml(deliverableTargetLabel(locale, change.target_kind))}</span>
      <span class="wh-pill">${escapeHtml(changeTypeLabel(locale, change.change_type))}</span>
      ${preview}
    </div>
  </div>`;
}

function renderCheck(check: DeliverableCheck, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  return `<div class="wh-check" data-status="${escapeHtml(check.status)}">
    <strong>${escapeHtml(check.label)}</strong>
    <span class="wh-subtle">${escapeHtml(checkStatusLabel(locale, check.status))}${check.detail ? ` · ${escapeHtml(check.detail)}` : ""}</span>
  </div>`;
}

function renderEvidence(evidenceRefs: EvidenceRef[], options?: UiRenderOptions) {
  const locale = uiLocale(options);
  if (evidenceRefs.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(uiT(locale, "generic.noEvidence"))}</p>`;
  }
  return evidenceRefs
    .map(
      (ref) =>
        `<article class="wh-card" data-evidence-source="${escapeHtml(ref.source_type)}"><strong>${escapeHtml(ref.title)}</strong><p class="wh-subtle">${escapeHtml(ref.excerpt ?? ref.source_id)}</p>${ref.href ? `<a class="wh-pill" href="${escapeHtml(safeHref(ref.href))}">${escapeHtml(uiT(locale, "generic.openSource"))}</a>` : `<span class="wh-pill">${escapeHtml(evidenceSourceLabel(locale, ref.source_type))}</span>`}</article>`
    )
    .join("");
}

function renderRail(vm: ProposalDetailVM, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  const manifest = vm.manifest;
  return `<aside class="wh-proposal-rail">
    <span class="wh-kicker">${escapeHtml(uiT(locale, "generic.aiStatus"))}</span>
    <h2>${escapeHtml(vm.status === "merged" ? uiT(locale, "proposal.railComplete") : uiT(locale, "proposal.railCarrying"))}</h2>
    <p class="wh-subtle">${escapeHtml(manifest.risk.human_label)}</p>
    <article class="wh-card">
      <strong>${escapeHtml(uiT(locale, "generic.rollback"))}</strong>
      <p class="wh-subtle">${escapeHtml(manifest.rollback.description)}</p>
      <span class="${manifest.rollback.available ? "wh-pill" : "wh-pill wh-pill-danger"}">${escapeHtml(manifest.rollback.available ? uiT(locale, "proposal.rollbackAvailable") : uiT(locale, "proposal.rollbackUnavailable"))}</span>
    </article>
    <article class="wh-card">
      <strong>${escapeHtml(uiT(locale, "generic.evidence"))}</strong>
      <p class="wh-subtle">${escapeHtml(uiCount(locale, vm.evidence_refs.length, "条来源", "source"))}</p>
    </article>
  </aside>`;
}

export function renderProposalDetail(
  vm: ProposalDetailVM,
  surface: ProposalRenderSurface,
  options?: ProposalRenderOptions
): ProposalRenderedPage {
  const locale = uiLocale(options);
  const conflictCards = renderProposalConflictCards(options?.conflicts ?? [], { locale });
  const actionList = vm.status === "opened"
    ? [
      vm.review_actions.approve,
      vm.review_actions.request_changes
    ]
    : vm.status === "reviewed" && vm.review_actions.merge
      ? [vm.review_actions.merge]
      : [];
  const rootClass = surface === "desktop" ? "wh-desktop" : "wh-web";
  const summary = stripMarkdown(vm.manifest.summary_md).slice(0, 260);
  const main = `<section class="wh-proposal-main">
    <span class="wh-kicker">${escapeHtml(uiT(locale, "proposal.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(vm.title)}</h1>
    <p class="wh-subtle">${escapeHtml(summary)}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(uiT(locale, "generic.changes"))}</strong><p class="wh-subtle">${escapeHtml(uiCount(locale, vm.manifest.changes.length, "项文件或对象", "change"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(uiT(locale, "generic.checks"))}</strong><p class="wh-subtle">${escapeHtml(uiCount(locale, vm.manifest.checks.length, "项检查已记录", "recorded check"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(uiT(locale, "generic.risk"))}</strong><p class="wh-subtle">${escapeHtml(vm.manifest.risk.human_label)}</p></article>
    </div>
    <h2>${escapeHtml(uiT(locale, "proposal.changeSummary"))}</h2>
    <div class="wh-card">${vm.manifest.changes.map((change) => renderChange(change, { locale })).join("")}</div>
    <h2>${escapeHtml(uiT(locale, "proposal.checkResults"))}</h2>
    <div class="wh-grid">${vm.manifest.checks.map((check) => renderCheck(check, { locale })).join("")}</div>
    <h2>${escapeHtml(uiT(locale, "generic.evidence"))}</h2>
    <div class="wh-grid">${renderEvidence(vm.evidence_refs, { locale })}</div>
    ${vm.comments.length > 0 ? `<h2>${escapeHtml(uiT(locale, "proposal.comments"))}</h2><div class="wh-card">${vm.comments.map((comment) => `<div class="wh-row"><strong>${escapeHtml(comment.author_label)}</strong><p class="wh-subtle">${escapeHtml(comment.body)}</p></div>`).join("")}</div>` : ""}
    ${conflictCards.html}
    ${renderActions(actionList)}
  </section>`;

  return {
    surface,
    proposalId: vm.proposal_id,
    workItemId: vm.work_item_id,
    title: vm.title,
    css: proposalCss,
    html: `<div class="${rootClass}"><main class="wh-proposal"><div class="wh-proposal-frame">${main}${renderRail(vm, { locale })}</div></main></div>`,
    actionHrefs: [...actionList.map((action) => action.href), ...conflictCards.actionHrefs],
    changeCount: vm.manifest.changes.length,
    evidenceCount: vm.evidence_refs.length,
    conflictCount: conflictCards.conflictCount,
    cuuState: vm.status === "merged" ? "celebrating" : "carrying_document"
  };
}
