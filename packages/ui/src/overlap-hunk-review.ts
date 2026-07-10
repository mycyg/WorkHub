import type { WorkHubLocale } from "@workhub/contracts";
import { safeHref } from "./safe-href.js";

import { uiT } from "./i18n.js";

export const overlapHunkReviewCss = [
  ".wh-diff3{border:1px solid #d8e1f2;border-radius:8px;background:#f8fbff;padding:10px 12px;display:grid;gap:8px}",
  ".wh-diff3-head{display:flex;align-items:center;justify-content:space-between;gap:10px}",
  ".wh-diff3-meta{display:flex;gap:6px;flex-wrap:wrap}",
  ".wh-diff3-ranges{margin:0;color:var(--muted);font-size:13px}",
  ".wh-overlap-list{display:grid;gap:8px}",
  ".wh-overlap-hunk{border:1px solid #e1e8f5;border-radius:8px;background:#fff;padding:10px;display:grid;gap:8px}",
  ".wh-overlap-hunk-head{display:flex;align-items:center;justify-content:space-between;gap:10px}",
  ".wh-overlap-choices{display:flex;gap:8px;flex-wrap:wrap}",
  ".wh-overlap-choice{border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:7px 10px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}",
  ".wh-overlap-choice[data-overlap-hunk-decision=ai_fusion]{background:#eef3ff;border-color:#b9c7ff;color:#2447c8}",
  ".wh-overlap-choice[data-overlap-hunk-decision=accept_incoming]{background:#fff5f1;border-color:#f1c4b8;color:#a94137}",
  ".wh-overlap-choice[data-overlap-hunk-recommended=true]{box-shadow:0 0 0 2px rgba(53,92,255,.10)}"
].join("");

export type OverlapHunkDecision = "keep_current" | "accept_incoming" | "ai_fusion";

export type OverlapHunkChoiceAction = {
  decision: OverlapHunkDecision;
  actionId?: string;
  href?: string;
  method?: string;
  recommended?: boolean;
};

export type OverlapHunkReviewOptions = {
  locale: WorkHubLocale;
  diff3: unknown;
  optionKey: string;
  actions?: OverlapHunkChoiceAction[];
  rootAttributes?: Record<string, string | number | boolean | undefined>;
};

type ConflictRange = {
  index: number;
  startLine: number;
  endLine: number;
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

function rangeLabel(locale: WorkHubLocale, start: number, end: number) {
  if (start === end) {
    return locale === "zh-CN" ? `第 ${start} 行` : `line ${start}`;
  }
  return locale === "zh-CN" ? `第 ${start}-${end} 行` : `lines ${start}-${end}`;
}

function decisionLabel(locale: WorkHubLocale, decision: OverlapHunkDecision) {
  if (decision === "keep_current") {
    return uiT(locale, "proposal.overlapReviewKeepCurrent");
  }
  if (decision === "accept_incoming") {
    return uiT(locale, "proposal.overlapReviewAcceptIncoming");
  }
  return uiT(locale, "proposal.overlapReviewAiFusion");
}

function choicePayload(hunk: ConflictRange, decision: OverlapHunkDecision) {
  return {
    confirm: true,
    text_hunk_overrides: {
      hunks: [
        {
          hunk_index: hunk.index,
          start_line: hunk.startLine,
          end_line: hunk.endLine,
          decision
        }
      ]
    }
  };
}

function defaultActions(optionKey: string): OverlapHunkChoiceAction[] {
  return [
    { decision: "keep_current", recommended: optionKey === "keep_current" },
    { decision: "accept_incoming", recommended: optionKey === "accept_incoming" },
    { decision: "ai_fusion", recommended: optionKey === "ai_fusion" }
  ];
}

function renderChoice(input: {
  locale: WorkHubLocale;
  hunk: ConflictRange;
  action: OverlapHunkChoiceAction;
}) {
  const payload = choicePayload(input.hunk, input.action.decision);
  const attrs = renderAttrs({
    type: "button",
    "data-overlap-hunk-choice": "true",
    "data-overlap-hunk-index": input.hunk.index,
    "data-overlap-hunk-decision": input.action.decision,
    "data-overlap-hunk-recommended": input.action.recommended === true,
    "data-action-id": input.action.actionId,
    "data-action-href": safeHref(input.action.href),
    "data-method": input.action.method,
    "data-request-json-template": JSON.stringify(payload)
  });
  return `<button class="wh-overlap-choice" ${attrs}>${escapeHtml(decisionLabel(input.locale, input.action.decision))}</button>`;
}

function renderHunk(input: {
  locale: WorkHubLocale;
  hunk: ConflictRange;
  actions: OverlapHunkChoiceAction[];
}) {
  return `<article class="wh-overlap-hunk" data-overlap-hunk-index="${escapeHtml(String(input.hunk.index))}" data-overlap-hunk-start-line="${escapeHtml(String(input.hunk.startLine))}" data-overlap-hunk-end-line="${escapeHtml(String(input.hunk.endLine))}">
    <div class="wh-overlap-hunk-head">
      <strong>${escapeHtml(uiT(input.locale, "proposal.overlapReviewHunk"))} ${escapeHtml(String(input.hunk.index + 1))}</strong>
      <span class="wh-pill">${escapeHtml(rangeLabel(input.locale, input.hunk.startLine, input.hunk.endLine))}</span>
    </div>
    <div class="wh-overlap-choices">${input.actions.map((action) => renderChoice({ locale: input.locale, hunk: input.hunk, action })).join("")}</div>
  </article>`;
}

export function renderOverlapHunkReview(options: OverlapHunkReviewOptions) {
  const diff3 = objectRecord(options.diff3);
  if (diff3?.["type"] !== "line_text_diff3") {
    return "";
  }
  const autoMerge = diff3["auto_merge"] === true;
  const currentHunks = numberField(diff3, "current_hunks");
  const incomingHunks = numberField(diff3, "incoming_hunks");
  const conflictHunks = numberField(diff3, "conflict_hunks");
  const ranges = conflictRanges(diff3["conflict_ranges"]);
  const rangeData = ranges.map((range) =>
    range.startLine === range.endLine ? String(range.startLine) : `${range.startLine}-${range.endLine}`
  ).join(",");
  const rangeLabels = ranges.map((range) => rangeLabel(options.locale, range.startLine, range.endLine)).join(", ");
  const modeLabel = autoMerge ? uiT(options.locale, "proposal.diff3Auto") : uiT(options.locale, "proposal.diff3Review");
  const actions = options.actions?.length ? options.actions : defaultActions(options.optionKey);
  const rootAttrs = renderAttrs({
    class: "wh-diff3 wh-overlap-review",
    "data-overlap-hunk-review": !autoMerge && ranges.length > 0,
    "data-overlap-hunk-option-key": options.optionKey,
    "data-overlap-hunk-count": ranges.length,
    "data-overlap-hunk-total-conflicts": conflictHunks,
    "data-text-diff3-auto-merge": String(autoMerge),
    "data-text-diff3-conflict-hunks": String(conflictHunks),
    "data-text-diff3-conflict-ranges": rangeData,
    ...options.rootAttributes
  });
  const rangeLine = rangeLabels
    ? `<p class="wh-diff3-ranges">${escapeHtml(uiT(options.locale, "proposal.diff3Ranges"))}: ${escapeHtml(rangeLabels)}</p>`
    : "";
  const review = !autoMerge && ranges.length > 0
    ? `<div class="wh-overlap-list">${ranges.map((hunk) => renderHunk({ locale: options.locale, hunk, actions })).join("")}</div>`
    : "";
  return `<section ${rootAttrs}>
    <div class="wh-diff3-head">
      <strong>${escapeHtml(uiT(options.locale, "proposal.diff3Title"))}</strong>
      <span class="wh-pill">${escapeHtml(modeLabel)}</span>
    </div>
    <div class="wh-diff3-meta">
      <span class="wh-pill">${escapeHtml(uiT(options.locale, "proposal.diff3Current"))}: ${escapeHtml(String(currentHunks))}</span>
      <span class="wh-pill">${escapeHtml(uiT(options.locale, "proposal.diff3Incoming"))}: ${escapeHtml(String(incomingHunks))}</span>
      <span class="wh-pill">${escapeHtml(uiT(options.locale, "proposal.diff3Conflict"))}: ${escapeHtml(String(conflictHunks))}</span>
    </div>
    ${rangeLine}${review}
  </section>`;
}
