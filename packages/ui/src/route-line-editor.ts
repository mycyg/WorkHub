import type {
  ProposalConflict,
  ProposalConflictOption,
  WorkHubLocale
} from "@workhub/contracts";

import { uiCount, uiT } from "./i18n.js";
import { safeHref } from "./safe-href.js";

export const routeLineEditorCss = [
  ".wh-line-editor{border:1px solid #d8e1f2;border-radius:8px;background:#f8fbff;padding:12px;display:grid;gap:10px;margin:12px 0}",
  ".wh-line-editor-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}",
  ".wh-line-editor-tabs{display:flex;gap:8px;flex-wrap:wrap}",
  ".wh-line-editor-tab{border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:7px 10px;font:inherit;font-size:12px;font-weight:800;cursor:pointer;max-width:100%;overflow-wrap:anywhere}",
  ".wh-line-editor-tab[aria-selected=true]{background:#eef3ff;border-color:#b9c7ff;color:#2447c8}",
  ".wh-line-editor-panel{display:grid;gap:10px}",
  ".wh-line-editor-panel[hidden]{display:none}",
  ".wh-line-editor-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}",
  ".wh-line-editor-search{min-width:210px;flex:1;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:8px 10px;font:inherit;font-size:13px}",
  ".wh-line-editor-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.62fr);gap:10px;align-items:start}",
  ".wh-line-editor-lines{border:1px solid #e1e8f5;border-radius:8px;background:#fff;max-height:320px;overflow:auto}",
  ".wh-line-editor-row{display:grid;grid-template-columns:52px 24px minmax(0,1fr);gap:6px;align-items:start;border-top:1px solid #edf2fa;padding:4px 8px;font-family:\"Cascadia Mono\",\"SFMono-Regular\",monospace;font-size:12px;line-height:1.45}",
  ".wh-line-editor-row:first-child{border-top:0}",
  ".wh-line-editor-row[hidden]{display:none}",
  ".wh-line-editor-row-no{color:#7a849d;text-align:right}",
  ".wh-line-editor-row-kind{font-weight:900;text-align:center}",
  ".wh-line-editor-row[data-line-editor-row-kind=add]{background:#f3fff6}.wh-line-editor-row[data-line-editor-row-kind=add] .wh-line-editor-row-kind{color:#16894e}",
  ".wh-line-editor-row[data-line-editor-row-kind=remove]{background:#fff5f3}.wh-line-editor-row[data-line-editor-row-kind=remove] .wh-line-editor-row-kind{color:#b94733}",
  ".wh-line-editor-row-text{white-space:pre-wrap;overflow-wrap:anywhere}",
  ".wh-line-editor-hunks{display:grid;gap:8px}",
  ".wh-line-editor-hunk{border:1px solid #e1e8f5;border-radius:8px;background:#fff;padding:10px;display:grid;gap:8px}",
  ".wh-line-editor-hunk:focus-within,.wh-line-editor-hunk:focus{outline:2px solid rgba(53,92,255,.28);outline-offset:2px}",
  ".wh-line-editor-hunk-head{display:flex;align-items:center;justify-content:space-between;gap:10px}",
  ".wh-line-editor-decisions{display:flex;gap:8px;flex-wrap:wrap}",
  ".wh-line-editor-decision{border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:7px 10px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}",
  ".wh-line-editor-decision[data-line-editor-decision-selected=true]{background:#eef3ff;border-color:#b9c7ff;color:#2447c8}",
  ".wh-line-editor-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}",
  "@media (max-width:860px){.wh-line-editor-body{grid-template-columns:1fr}.wh-line-editor-search{min-width:0}.wh-line-editor-row{grid-template-columns:42px 20px minmax(0,1fr)}}"
].join("");

type LineEditorDecision = "keep_current" | "accept_incoming" | "ai_fusion";

type ConflictRange = {
  index: number;
  startLine: number;
  endLine: number;
};

type LineRow = {
  index: number;
  kind: "add" | "remove" | "context";
  marker: string;
  text: string;
};

type LineEditorFile = {
  conflict: ProposalConflict;
  option: ProposalConflictOption;
  ranges: ConflictRange[];
  rows: LineRow[];
  panelId: string;
  targetLabel: string;
  defaultDecision: LineEditorDecision;
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

function numberField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function renderAttrs(attributes: Record<string, string | number | boolean | undefined>) {
  return Object.entries(attributes)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .map(([key, value]) => `${key}="${escapeHtml(String(value))}"`)
    .join(" ");
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/gu, "-");
}

function conflictRanges(value: unknown): ConflictRange[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item, index) => {
    const record = objectRecord(item);
    const startLine = numberField(record, "start_line");
    const endLine = numberField(record, "end_line");
    return startLine > 0 && endLine >= startLine ? [{ index, startLine, endLine }] : [];
  });
}

function patchRows(preview: unknown): LineRow[] {
  const patch = objectRecord(preview);
  if (patch?.["type"] !== "unified_text_patch_preview" || !Array.isArray(patch["hunks"])) {
    return [];
  }
  let index = 0;
  return patch["hunks"].flatMap((hunk) => {
    const record = objectRecord(hunk);
    const lines = Array.isArray(record?.["lines"]) ? record["lines"] : [];
    return lines.flatMap((line) => {
      if (typeof line !== "string") {
        return [];
      }
      index += 1;
      const marker = line.startsWith("+") ? "+" : line.startsWith("-") ? "-" : " ";
      return [{
        index,
        kind: marker === "+" ? "add" : marker === "-" ? "remove" : "context",
        marker,
        text: line.replace(/^[-+ ]/u, "")
      }];
    });
  });
}

function textDiff3(option: ProposalConflictOption) {
  return objectRecord(option.quality_gate?.["text_diff3"]);
}

function routeLineEditorOption(conflict: ProposalConflict) {
  return conflict.options.find((option) => {
    const diff3 = textDiff3(option);
    return diff3?.["type"] === "line_text_diff3"
      && conflictRanges(diff3["conflict_ranges"]).length > 0
      && Boolean(option.action?.href);
  });
}

function decisionLabel(locale: WorkHubLocale, decision: LineEditorDecision) {
  if (decision === "keep_current") {
    return uiT(locale, "proposal.overlapReviewKeepCurrent");
  }
  if (decision === "accept_incoming") {
    return uiT(locale, "proposal.overlapReviewAcceptIncoming");
  }
  return uiT(locale, "proposal.overlapReviewAiFusion");
}

function lineRangeLabel(locale: WorkHubLocale, startLine: number, endLine: number) {
  if (startLine === endLine) {
    return locale === "zh-CN" ? `第 ${startLine} 行` : `Line ${startLine}`;
  }
  return locale === "zh-CN" ? `第 ${startLine}-${endLine} 行` : `Lines ${startLine}-${endLine}`;
}

function defaultDecision(conflict: ProposalConflict): LineEditorDecision {
  return conflict.options.some((option) => option.id === conflict.recommended_option_id)
    ? conflict.recommended_option_id
    : "ai_fusion";
}

function filesFromConflicts(conflicts: ProposalConflict[]) {
  return conflicts.flatMap((conflict, conflictIndex) => {
    const option = routeLineEditorOption(conflict);
    const diff3 = option ? textDiff3(option) : undefined;
    const ranges = conflictRanges(diff3?.["conflict_ranges"]);
    if (!option || ranges.length === 0 || !option.action?.href) {
      return [];
    }
    const targetLabel = conflict.target_path ?? conflict.target_key;
    return [{
      conflict,
      option,
      ranges,
      rows: patchRows(option.quality_gate?.["text_patch_preview"]),
      // findings[#low]：safeId 会把不同 conflict.id（如 docs/a.md vs docs-a.md）压成同一串，
      // 导致 panel/tab DOM id 撞车、aria-controls 失联。前缀加 render-local 序号保证唯一。
      panelId: `line-editor-${conflictIndex}-${safeId(conflict.id)}`,
      targetLabel,
      defaultDecision: defaultDecision(conflict)
    }];
  });
}

function applyPayload(file: LineEditorFile) {
  // L#77：无 JS（或点击任何逐 hunk 决策之前）的提交：所有 hunk 统一用 file.defaultDecision，
  // 它等于每个 hunk 卡片上展示的推荐选项，因此 no-JS 提交与推荐一致。逐 hunk 混合选择需要 JS。
  return {
    confirm: true,
    text_hunk_overrides: {
      hunks: file.ranges.map((range) => ({
        hunk_index: range.index,
        start_line: range.startLine,
        end_line: range.endLine,
        decision: file.defaultDecision
      }))
    }
  };
}

function renderTabs(files: LineEditorFile[], locale: WorkHubLocale) {
  return `<div class="wh-line-editor-tabs" role="tablist" aria-label="${escapeHtml(uiT(locale, "proposal.lineEditorTitle"))}">
    ${files.map((file, index) => `<button type="button" class="wh-line-editor-tab" role="tab" id="${escapeHtml(`${file.panelId}-tab`)}" aria-controls="${escapeHtml(file.panelId)}" aria-selected="${escapeHtml(String(index === 0))}" tabindex="${index === 0 ? "0" : "-1"}" data-line-editor-tab="${escapeHtml(file.conflict.target_key)}" data-line-editor-panel-id="${escapeHtml(file.panelId)}">${escapeHtml(file.targetLabel)}</button>`).join("")}
  </div>`;
}

function renderRows(rows: LineRow[]) {
  return `<div class="wh-line-editor-lines" data-line-editor-row-count="${escapeHtml(String(rows.length))}">
    ${rows.map((row) => `<div class="wh-line-editor-row" data-line-editor-row="true" data-line-editor-row-kind="${escapeHtml(row.kind)}" data-line-editor-row-text="${escapeHtml(row.text.toLowerCase())}">
      <span class="wh-line-editor-row-no">${escapeHtml(String(row.index))}</span>
      <span class="wh-line-editor-row-kind">${escapeHtml(row.marker)}</span>
      <span class="wh-line-editor-row-text">${escapeHtml(row.text)}</span>
    </div>`).join("")}
  </div>`;
}

function renderHunk(file: LineEditorFile, range: ConflictRange, locale: WorkHubLocale) {
  const actions = file.conflict.options
    .filter((option): option is ProposalConflictOption & { id: LineEditorDecision } =>
      option.id === "keep_current" || option.id === "accept_incoming" || option.id === "ai_fusion"
    );
  return `<article class="wh-line-editor-hunk" tabindex="0" data-line-editor-hunk="true" data-line-editor-hunk-index="${escapeHtml(String(range.index))}" data-line-editor-start-line="${escapeHtml(String(range.startLine))}" data-line-editor-end-line="${escapeHtml(String(range.endLine))}">
    <div class="wh-line-editor-hunk-head">
      <strong>${escapeHtml(uiT(locale, "proposal.overlapReviewHunk"))} ${escapeHtml(String(range.index + 1))}</strong>
      <span class="wh-pill">${escapeHtml(lineRangeLabel(locale, range.startLine, range.endLine))}</span>
    </div>
    <div class="wh-line-editor-decisions">
      ${actions.map((action) => {
        const selected = action.id === file.defaultDecision;
        return `<button type="button" class="wh-line-editor-decision" aria-pressed="${escapeHtml(String(selected))}" data-line-editor-decision="${escapeHtml(action.id)}" data-line-editor-decision-selected="${escapeHtml(String(selected))}" data-line-editor-hunk-index="${escapeHtml(String(range.index))}">${escapeHtml(decisionLabel(locale, action.id))}</button>`;
      }).join("")}
    </div>
  </article>`;
}

function renderPanel(file: LineEditorFile, locale: WorkHubLocale, active: boolean) {
  const payload = JSON.stringify(applyPayload(file));
  const method = file.option.action?.method ?? "POST";
  return `<section class="wh-line-editor-panel" id="${escapeHtml(file.panelId)}" role="tabpanel" aria-labelledby="${escapeHtml(`${file.panelId}-tab`)}" data-line-editor-panel="${escapeHtml(file.conflict.target_key)}" data-line-editor-match-count="${escapeHtml(String(file.rows.length))}"${active ? "" : " hidden"}>
    <div class="wh-line-editor-toolbar">
      <input class="wh-line-editor-search" type="search" data-line-editor-search="true" aria-label="${escapeHtml(uiT(locale, "proposal.lineEditorSearch"))}" placeholder="${escapeHtml(uiT(locale, "proposal.lineEditorSearch"))}" />
      <span class="wh-pill" data-line-editor-match-count="${escapeHtml(String(file.rows.length))}">${escapeHtml(uiCount(locale, file.rows.length, "行", "line"))}</span>
    </div>
    <div class="wh-line-editor-body">
      ${renderRows(file.rows)}
      <div class="wh-line-editor-hunks">${file.ranges.map((range) => renderHunk(file, range, locale)).join("")}</div>
    </div>
    <div class="wh-line-editor-actions">
      <a class="wh-btn wh-btn-primary" href="${escapeHtml(safeHref(file.option.action?.href))}" data-line-editor-apply="true" data-action-id="${escapeHtml(file.option.action?.id ?? "apply_ai_fusion")}" data-action-href="${escapeHtml(safeHref(file.option.action?.href))}" data-method="${escapeHtml(method)}" data-request-json="${escapeHtml(payload)}">${escapeHtml(uiT(locale, "proposal.lineEditorApply"))}</a>
    </div>
  </section>`;
}

export function renderRouteLineEditor(
  conflicts: ProposalConflict[] = [],
  options: { locale: WorkHubLocale }
) {
  const files = filesFromConflicts(conflicts);
  if (files.length === 0) {
    return "";
  }
  const hunkCount = files.reduce((sum, file) => sum + file.ranges.length, 0);
  const rowCount = files.reduce((sum, file) => sum + file.rows.length, 0);
  return `<section class="wh-line-editor" data-route-line-editor="true" data-route-line-editor-file-count="${escapeHtml(String(files.length))}" data-route-line-editor-hunk-count="${escapeHtml(String(hunkCount))}" data-route-line-editor-row-count="${escapeHtml(String(rowCount))}">
    <div class="wh-line-editor-head">
      <strong>${escapeHtml(uiT(options.locale, "proposal.lineEditorTitle"))}</strong>
      <span class="wh-pill">${escapeHtml(uiCount(options.locale, files.length, "文件", "file"))}</span>
    </div>
    ${renderTabs(files, options.locale)}
    ${files.map((file, index) => renderPanel(file, options.locale, index === 0)).join("")}
  </section>`;
}
