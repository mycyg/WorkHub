import type { WorkHubLocale } from "@workhub/contracts";

import { uiT } from "./i18n.js";

export const richPatchViewerCss = [
  ".wh-patch{border:1px solid var(--line);border-radius:8px;background:#fbfcff;overflow:hidden;max-width:100%;min-width:0}",
  ".wh-patch-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);background:#f8fbff}",
  ".wh-patch-meta{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}",
  ".wh-diff{margin:0;font-family:\"Cascadia Mono\",\"SFMono-Regular\",Consolas,monospace;font-size:12px;line-height:1.45;overflow:auto;max-width:100%;min-width:0}",
  ".wh-diff-hunk{border-top:1px solid #e8eef8}.wh-diff-hunk:first-child{border-top:0}",
  ".wh-diff-hunk-head{display:grid;grid-template-columns:54px 54px minmax(0,1fr);gap:0;background:#f1f5fb;color:var(--muted);font-weight:650}",
  ".wh-diff-line{display:grid;grid-template-columns:54px 54px minmax(0,auto);gap:0;min-width:0;white-space:pre;width:max-content;min-width:100%}",
  ".wh-diff-line-no{color:#7b87a2;text-align:right;padding:2px 10px;border-right:1px solid #e4ebf6;user-select:none}",
  // R12（富文本）：超宽代码行此前被静默硬裁切（overflow:hidden+clip，连省略号都没有）——
  // 改为真横向滚动：外层 .wh-diff 已 overflow:auto，第三列放开钳制让内容撑宽。
  ".wh-diff-code{min-width:max-content;padding:2px 12px}",
  ".wh-diff-line[data-patch-line-kind=add]{background:#ecfdf3;color:#11663b}",
  ".wh-diff-line[data-patch-line-kind=remove]{background:#fff1f0;color:#9d2f24}",
  ".wh-diff-line[data-patch-line-kind=meta]{background:#f1f5fb;color:var(--muted)}",
  ".wh-diff-line[data-patch-line-kind=context]{background:#fff;color:var(--ink)}",
  ".wh-patch-fold{border-top:1px solid var(--line);background:#fff;padding:8px 12px;color:var(--muted);font-size:12px}"
].join("");

export type RichPatchViewerOptions = {
  locale: WorkHubLocale;
  preview: unknown;
  title: string;
  rootAttributes?: Record<string, string | number | boolean | undefined>;
  maxVisibleLines?: number;
};

type PatchLineKind = "add" | "context" | "meta" | "remove";

type ParsedPatchLine = {
  line: string;
  kind: PatchLineKind;
  oldLine?: number;
  newLine?: number;
};

type ParsedPatchHunk = {
  index: number;
  header: string;
  oldStart?: number;
  newStart?: number;
  lines: ParsedPatchLine[];
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

function patchRiskLabel(locale: WorkHubLocale, risk: string) {
  if (risk === "low") {
    return uiT(locale, "proposal.patchRiskLow");
  }
  if (risk === "requires_review") {
    return uiT(locale, "proposal.patchRiskReview");
  }
  return uiT(locale, "proposal.patchRiskUnknown");
}

function patchLineKind(line: string): PatchLineKind {
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  if (line.startsWith("@@")) return "meta";
  return "context";
}

function parseHunkHeader(header: string) {
  const match = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/u.exec(header);
  if (!match) {
    return {};
  }
  return {
    oldStart: Number.parseInt(match[1] ?? "0", 10),
    newStart: Number.parseInt(match[2] ?? "0", 10)
  };
}

function parsePatchHunks(hunks: unknown[]): ParsedPatchHunk[] {
  return hunks.flatMap((hunk, index) => {
    const record = objectRecord(hunk);
    const header = typeof record?.["header"] === "string" ? record["header"] : "";
    const rawLines = Array.isArray(record?.["lines"])
      ? record["lines"].filter((line): line is string => typeof line === "string")
      : [];
    if (!header && rawLines.length === 0) {
      return [];
    }
    const parsedHeader = parseHunkHeader(header);
    let oldCursor = parsedHeader.oldStart ?? 0;
    let newCursor = parsedHeader.newStart ?? 0;
    const lines = rawLines.map((line) => {
      const kind = patchLineKind(line);
      const parsed: ParsedPatchLine = { line, kind };
      if (kind === "remove" || kind === "context") {
        parsed.oldLine = oldCursor;
        oldCursor += 1;
      }
      if (kind === "add" || kind === "context") {
        parsed.newLine = newCursor;
        newCursor += 1;
      }
      return parsed;
    });
    return [{
      index,
      header,
      ...parsedHeader,
      lines
    }];
  });
}

function renderAttrs(attributes: Record<string, string | number | boolean | undefined>) {
  return Object.entries(attributes)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .map(([key, value]) => `${key}="${escapeHtml(String(value))}"`)
    .join(" ");
}

function lineNumber(value: number | undefined) {
  return value && value > 0 ? String(value) : "";
}

function renderPatchLine(line: ParsedPatchLine) {
  return `<span class="wh-diff-line" data-patch-line-kind="${escapeHtml(line.kind)}" data-patch-old-line="${escapeHtml(lineNumber(line.oldLine))}" data-patch-new-line="${escapeHtml(lineNumber(line.newLine))}"><span class="wh-diff-line-no" aria-hidden="true">${escapeHtml(lineNumber(line.oldLine))}</span><span class="wh-diff-line-no" aria-hidden="true">${escapeHtml(lineNumber(line.newLine))}</span><span class="wh-diff-code">${escapeHtml(line.line)}</span></span>`;
}

function renderPatchHunk(hunk: ParsedPatchHunk, visibleLineBudget: { remaining: number }) {
  if (visibleLineBudget.remaining <= 0) {
    return "";
  }
  const visibleLines = hunk.lines.slice(0, visibleLineBudget.remaining);
  visibleLineBudget.remaining -= visibleLines.length;
  const headerText = hunk.header || `@@ ${hunk.index + 1} @@`;
  return `<section class="wh-diff-hunk" data-rich-patch-hunk-index="${escapeHtml(String(hunk.index))}" data-rich-patch-hunk-line-count="${escapeHtml(String(hunk.lines.length))}" data-rich-patch-old-start="${escapeHtml(lineNumber(hunk.oldStart))}" data-rich-patch-new-start="${escapeHtml(lineNumber(hunk.newStart))}">
    <div class="wh-diff-hunk-head" data-patch-line-kind="meta"><span class="wh-diff-line-no" aria-hidden="true">${escapeHtml(lineNumber(hunk.oldStart))}</span><span class="wh-diff-line-no" aria-hidden="true">${escapeHtml(lineNumber(hunk.newStart))}</span><span class="wh-diff-code">${escapeHtml(headerText)}</span></div>
    ${visibleLines.map(renderPatchLine).join("")}
  </section>`;
}

export function renderRichPatchViewer(options: RichPatchViewerOptions) {
  const preview = objectRecord(options.preview);
  if (preview?.["type"] !== "unified_text_patch_preview") {
    return "";
  }
  const stats = objectRecord(preview["stats"]);
  const hunks = Array.isArray(preview["hunks"]) ? preview["hunks"] : [];
  const parsedHunks = parsePatchHunks(hunks);
  const totalLineCount = parsedHunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  if (totalLineCount === 0) {
    return "";
  }
  const maxVisibleLines = options.maxVisibleLines ?? 80;
  const visibleLineCount = Math.min(totalLineCount, maxVisibleLines);
  const foldedLineCount = Math.max(0, totalLineCount - visibleLineCount);
  // findings[#low]：行预算耗尽后整段 hunk 不再渲染，但 hunk-count pill 仍报总数。
  // 统计被整段折叠的 hunk 数（其起始行偏移已 >= 可见行数），单独暴露 + 提示。
  let foldedHunkCum = 0;
  let foldedHunkCount = 0;
  for (const hunk of parsedHunks) {
    if (foldedHunkCum >= visibleLineCount) {
      foldedHunkCount += 1;
    }
    foldedHunkCum += hunk.lines.length;
  }
  const visibleLineBudget = { remaining: visibleLineCount };
  const risk = typeof stats?.["overlap_risk"] === "string" ? stats["overlap_risk"] : "unknown";
  const added = numberField(stats, "added_lines");
  const removed = numberField(stats, "removed_lines");
  const changed = stats?.["changed"] === false ? uiT(options.locale, "proposal.patchUnchanged") : uiT(options.locale, "proposal.patchChanged");
  const base = preview["base_available"] === true
    ? uiT(options.locale, "proposal.patchBaseAvailable")
    : uiT(options.locale, "proposal.patchBaseMissing");
  const rootAttrs = renderAttrs({
    class: "wh-patch",
    "data-rich-patch-viewer": "true",
    "data-rich-patch-hunk-count": parsedHunks.length,
    "data-rich-patch-line-count": totalLineCount,
    "data-rich-patch-visible-line-count": visibleLineCount,
    "data-rich-patch-folded-line-count": foldedLineCount,
    "data-rich-patch-folded-hunk-count": foldedHunkCount,
    "data-rich-patch-truncated": foldedLineCount > 0,
    "data-overlap-risk": risk,
    ...options.rootAttributes
  });
  const foldedHunkNotice = foldedHunkCount > 0
    ? `; ${escapeHtml(uiT(options.locale, "proposal.patchFoldedHunks"))}: ${escapeHtml(String(foldedHunkCount))}`
    : "";
  const folded = foldedLineCount > 0
    ? `<div class="wh-patch-fold" data-rich-patch-overflow="true">${escapeHtml(uiT(options.locale, "proposal.patchFoldedLines"))}: ${escapeHtml(String(foldedLineCount))}${foldedHunkNotice}</div>`
    : "";
  return `<section ${rootAttrs}>
    <div class="wh-patch-head">
      <strong>${escapeHtml(options.title)}</strong>
      <div class="wh-patch-meta">
        <span class="wh-pill">${escapeHtml(changed)}</span>
        <span class="wh-pill">+${escapeHtml(String(added))} / -${escapeHtml(String(removed))}</span>
        <span class="wh-pill">${escapeHtml(patchRiskLabel(options.locale, risk))}</span>
        <span class="wh-pill">${escapeHtml(base)}</span>
        <span class="wh-pill">${escapeHtml(uiT(options.locale, "proposal.patchHunks"))}: ${escapeHtml(String(parsedHunks.length))}</span>
        <span class="wh-pill">${escapeHtml(uiT(options.locale, "proposal.patchLines"))}: ${escapeHtml(String(totalLineCount))}</span>
      </div>
    </div>
    <div class="wh-diff" role="table" aria-label="${escapeHtml(options.title)}">${parsedHunks.map((hunk) => renderPatchHunk(hunk, visibleLineBudget)).join("")}</div>
    ${folded}
  </section>`;
}
