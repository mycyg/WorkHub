import type {
  CuuState,
  ReplayMergeCandidateVM,
  ReplayTraceVM,
  WorkHubLocale
} from "@workhub/contracts";

import { uiLocale, type UiRenderOptions } from "../i18n.js";
import { renderRichPatchViewer, richPatchViewerCss } from "../rich-patch-viewer.js";
import {
  renderStructuredFieldAuditDetails,
  renderStructuredFieldOperationDetails
} from "../structured-field-details.js";

export type ReplayRenderSurface = "web" | "desktop";

export type ReplayRenderedPage = {
  surface: ReplayRenderSurface;
  runId: string;
  workItemId?: string;
  title: string;
  css: string;
  html: string;
  primaryHrefs: string[];
  stepCount: number;
  acceptedDeliverableCount: number;
  mergeAttemptCount: number;
  structuredAuditCount: number;
  cuuState: CuuState;
};

export const replayCss = [
  ":root{color-scheme:light;--ink:#182033;--muted:#5e6a86;--line:#dfe5f1;--paper:#fff;--soft:#f5f8fc;--blue:#355cff;--green:#24a66a;--amber:#d98b16;--danger:#d94a3a}",
  ".wh-replay{font-family:\"Aptos\",\"Segoe UI\",sans-serif;color:var(--ink);background:linear-gradient(180deg,#f8fbff 0%,#eef4fb 100%);padding:24px;box-sizing:border-box}",
  ".wh-replay-frame{max-width:1120px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:20px;align-items:start}",
  ".wh-replay-main,.wh-replay-rail{background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:8px;box-shadow:0 18px 50px rgba(37,51,79,.08)}",
  ".wh-replay-main{padding:24px}.wh-replay-rail{padding:18px;position:sticky;top:16px}.wh-kicker{font-size:12px;color:var(--blue);font-weight:700;text-transform:uppercase;letter-spacing:0}",
  ".wh-title{font-size:30px;line-height:1.12;margin:8px 0}.wh-subtle{color:var(--muted);line-height:1.55}.wh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-top:18px}",
  ".wh-card{border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:16px}.wh-list{display:grid;gap:10px;margin-top:14px}.wh-row{display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding:12px 0}.wh-row:first-child{border-top:0}",
  ".wh-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--soft);padding:5px 9px;font-size:12px;color:var(--muted)}.wh-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}.wh-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:8px;border:1px solid var(--line);padding:9px 12px;color:var(--ink);text-decoration:none;background:#fff;font-weight:650}.wh-btn-primary{background:var(--blue);color:#fff;border-color:var(--blue)}.wh-btn-danger{background:#fff4f3;color:#a94137;border-color:#f3c5c0}",
  richPatchViewerCss,
  ".wh-row .wh-patch{margin-top:10px}",
  ".wh-diff3{border:1px solid #d8e1f2;border-radius:8px;background:#f8fbff;padding:10px 12px;display:grid;gap:8px;margin-top:10px}.wh-diff3-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.wh-diff3-meta{display:flex;gap:6px;flex-wrap:wrap}.wh-diff3-ranges{margin:0;color:var(--muted);font-size:13px}",
  ".wh-structured{border:1px solid #dfe6d8;border-radius:8px;background:#fbfff8;padding:10px 12px;display:grid;gap:8px;margin-top:10px}.wh-structured-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.wh-structured-meta{display:flex;gap:6px;flex-wrap:wrap}.wh-structured-fields{margin:0;color:var(--muted);font-size:13px}",
  ".wh-field-details{border:1px solid #dfe6d8;border-radius:8px;background:#fffefa;padding:10px 12px;display:grid;gap:8px;margin-top:10px}.wh-field-list{display:grid;gap:8px}.wh-field-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;border-top:1px solid #e6ecd9;padding-top:8px}.wh-field-row:first-child{border-top:0;padding-top:0}.wh-field-row-meta{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-content:start}",
  ".wh-desktop .wh-replay-frame{max-width:940px;grid-template-columns:1fr 240px}.wh-desktop .wh-replay{background:linear-gradient(135deg,#edf6ff,#f8fbff)}@media (max-width:860px){.wh-replay-frame{grid-template-columns:1fr}.wh-replay-rail{position:static}.wh-title{font-size:24px}.wh-field-row{grid-template-columns:1fr}}"
].join("");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function copy(locale: WorkHubLocale, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
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

function mergeOptionLabel(locale: WorkHubLocale, optionKey: string) {
  if (optionKey === "keep_current") {
    return copy(locale, "保留正式版", "Keep accepted version");
  }
  if (optionKey === "accept_incoming") {
    return copy(locale, "采纳这次版本", "Accept this version");
  }
  if (optionKey === "ai_fusion") {
    return copy(locale, "AI 融合建议", "AI fusion draft");
  }
  return optionKey;
}

function mergeAttemptLabel(locale: WorkHubLocale, result: string) {
  if (result === "conflict") {
    return copy(locale, "遇到撞车", "Conflict found");
  }
  if (result === "merged") {
    return copy(locale, "已采纳", "Accepted");
  }
  return copy(locale, "已记录", "Recorded");
}

function renderTextPatchPreview(candidate: ReplayMergeCandidateVM, locale: WorkHubLocale) {
  return renderRichPatchViewer({
    locale,
    preview: candidate.quality_gate?.["text_patch_preview"],
    title: copy(locale, "改动预览", "Change preview"),
    rootAttributes: {
      "data-replay-text-patch-preview": "true",
      "data-replay-text-patch-option-key": candidate.option_key
    }
  });
}

function textDiff3RangeValues(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = objectRecord(item);
    const start = numberField(record, "start_line");
    const end = numberField(record, "end_line");
    return start > 0 && end >= start ? [{ start, end }] : [];
  });
}

function textDiff3RangeLabel(locale: WorkHubLocale, start: number, end: number) {
  if (start === end) {
    return locale === "zh-CN" ? `第 ${start} 行` : `line ${start}`;
  }
  return locale === "zh-CN" ? `第 ${start}-${end} 行` : `lines ${start}-${end}`;
}

function renderTextDiff3QualityGate(candidate: ReplayMergeCandidateVM, locale: WorkHubLocale) {
  const diff3 = objectRecord(candidate.quality_gate?.["text_diff3"]);
  if (diff3?.["type"] !== "line_text_diff3") {
    return "";
  }
  const autoMerge = diff3["auto_merge"] === true;
  const conflictHunks = numberField(diff3, "conflict_hunks");
  const ranges = textDiff3RangeValues(diff3["conflict_ranges"]);
  const rangeData = ranges.map((range) => range.start === range.end ? String(range.start) : `${range.start}-${range.end}`).join(",");
  const rangeLabels = ranges.map((range) => textDiff3RangeLabel(locale, range.start, range.end)).join(", ");
  return `<section class="wh-diff3" data-replay-text-diff3="true" data-text-diff3-option-key="${escapeHtml(candidate.option_key)}" data-text-diff3-auto-merge="${escapeHtml(String(autoMerge))}" data-text-diff3-conflict-hunks="${escapeHtml(String(conflictHunks))}" data-text-diff3-conflict-ranges="${escapeHtml(rangeData)}">
    <div class="wh-diff3-head">
      <strong>${escapeHtml(copy(locale, "文本合并检查", "Text merge check"))}</strong>
      <span class="wh-pill">${escapeHtml(autoMerge ? copy(locale, "已自动合并", "Auto-merged") : copy(locale, "需逐项确认", "Needs line review"))}</span>
    </div>
    ${rangeLabels ? `<p class="wh-diff3-ranges">${escapeHtml(copy(locale, "影响行", "Affected lines"))}: ${escapeHtml(rangeLabels)}</p>` : ""}
  </section>`;
}

function renderStructuredRecordPatch(candidate: ReplayMergeCandidateVM, locale: WorkHubLocale) {
  const patch = objectRecord(candidate.quality_gate?.["structured_record_patch"]);
  if (patch?.["type"] !== "structured_record_field_patch") {
    return "";
  }
  const dryRun = objectRecord(patch["structured_field_patch_dry_run"]);
  const dryRunStatus = typeof dryRun?.["status"] === "string" ? dryRun["status"] : "";
  const operations = objectRecord(dryRun?.["patch"])?.["operations"];
  return `<section class="wh-structured" data-replay-structured-record-patch="true" data-structured-patch-option-key="${escapeHtml(candidate.option_key)}" data-structured-patch-dry-run-status="${escapeHtml(dryRunStatus)}">
    <div class="wh-structured-head">
      <strong>${escapeHtml(copy(locale, "结构化字段检查", "Structured field check"))}</strong>
      <span class="wh-pill">${escapeHtml(dryRunStatus || copy(locale, "已记录", "Recorded"))}</span>
    </div>
    ${renderStructuredFieldOperationDetails({ operations, locale, surface: "replay" })}
  </section>`;
}

function renderDeliverables(vm: ReplayTraceVM, locale: WorkHubLocale) {
  const accepted = vm.accepted_deliverables ?? [];
  return accepted
    .map((item) => {
      const actions = [
        item.preview_href ? `<a class="wh-btn" href="${escapeHtml(item.preview_href)}">${escapeHtml(copy(locale, "预览", "Preview"))}</a>` : "",
        item.download_href ? `<a class="wh-btn wh-btn-primary" href="${escapeHtml(item.download_href)}">${escapeHtml(copy(locale, "下载", "Download"))}</a>` : "",
        item.restore_href ? `<a class="wh-btn wh-btn-danger" href="${escapeHtml(item.restore_href)}" data-method="POST">${escapeHtml(copy(locale, "还原", "Restore"))}</a>` : ""
      ].filter(Boolean).join("");
      return `<article class="wh-card" data-replay-deliverable="${escapeHtml(item.id)}"><strong>${escapeHtml(item.filename ?? item.target_key)}</strong><p class="wh-subtle">${escapeHtml(item.target_path ?? item.target_key)}</p>${actions ? `<div class="wh-actions">${actions}</div>` : ""}</article>`;
    })
    .join("");
}

function renderMergeTimeline(vm: ReplayTraceVM, locale: WorkHubLocale) {
  const timeline = vm.merge_timeline ?? [];
  return timeline
    .map((attempt) => {
      const decisions = attempt.decisions.length
        ? attempt.decisions.map((decision) => {
          const candidates = decision.candidates.length
            ? decision.candidates.map((candidate) => {
              const badges = [
                candidate.recommended ? copy(locale, "推荐", "Recommended") : "",
                candidate.chosen ? copy(locale, "已选择", "Chosen") : ""
              ].filter(Boolean).join(" · ");
              return `<div class="wh-row"><div><strong>${escapeHtml(mergeOptionLabel(locale, candidate.option_key))}</strong><p class="wh-subtle">${escapeHtml(candidate.rationale_md ?? candidate.option_key)}</p>${renderTextPatchPreview(candidate, locale)}${renderTextDiff3QualityGate(candidate, locale)}${renderStructuredRecordPatch(candidate, locale)}</div>${badges ? `<span class="wh-pill">${escapeHtml(badges)}</span>` : ""}</div>`;
            }).join("")
            : `<p class="wh-subtle">${escapeHtml(copy(locale, "未选择", "Not chosen"))}</p>`;
          const chosen = decision.chosen_option_key
            ? mergeOptionLabel(locale, decision.chosen_option_key)
            : copy(locale, "未选择", "Not chosen");
          return `<div class="wh-list" data-replay-merge-decision="${escapeHtml(decision.id)}"><div class="wh-row"><div><strong>${escapeHtml(decision.conflict_key)}</strong><p class="wh-subtle">${escapeHtml(chosen)}</p></div></div>${candidates}</div>`;
        }).join("")
        : `<p class="wh-subtle">${escapeHtml(copy(locale, "未选择", "Not chosen"))}</p>`;
      const targetSummary = attempt.target_keys.length > 0 ? attempt.target_keys.join(", ") : attempt.id;
      return `<article class="wh-card" data-replay-merge-attempt="${escapeHtml(attempt.id)}" data-replay-merge-result="${escapeHtml(attempt.result)}"><strong>${escapeHtml(mergeAttemptLabel(locale, attempt.result))}</strong><p class="wh-subtle">${escapeHtml(targetSummary)}</p><div class="wh-actions"><span class="wh-pill">${escapeHtml(String(attempt.conflict_count))}</span><span class="wh-pill">${escapeHtml(attempt.created_at)}</span></div>${decisions}</article>`;
    })
    .join("");
}

function renderRail(vm: ReplayTraceVM, locale: WorkHubLocale) {
  return `<aside class="wh-replay-rail">
    <span class="wh-kicker">${escapeHtml(copy(locale, "回放摘要", "Replay summary"))}</span>
    <article class="wh-card"><strong>Token</strong><p class="wh-subtle">${escapeHtml(String(vm.cost?.me.total_tokens ?? 0))}</p></article>
    <article class="wh-card"><strong>${escapeHtml(copy(locale, "估算成本", "Estimated cost"))}</strong><p class="wh-subtle">¥${escapeHtml(vm.cost?.me.estimated_cost_cny ?? "0")}</p></article>
    <article class="wh-card"><strong>${escapeHtml(copy(locale, "快照", "Snapshots"))}</strong><p class="wh-subtle">${escapeHtml(String(vm.snapshots.length))}</p></article>
  </aside>`;
}

export function renderAgentRunReplay(
  vm: ReplayTraceVM,
  surface: ReplayRenderSurface,
  options?: UiRenderOptions
): ReplayRenderedPage {
  const locale = uiLocale(options);
  const rootClass = surface === "desktop" ? "wh-desktop" : "wh-web";
  const run = vm.run as ReplayTraceVM["run"] & { id?: string; work_item_id?: string };
  const steps = vm.steps
    .map((step) => `<div class="wh-row"><div><strong>${escapeHtml(step.phase)}</strong><p class="wh-subtle">${escapeHtml(step.output_excerpt ?? step.tool_name ?? copy(locale, "记录了一步。", "Recorded one step."))}</p></div><span class="wh-pill">#${escapeHtml(String(step.step_no))}</span></div>`)
    .join("");
  const deliverables = renderDeliverables(vm, locale);
  const mergeTimeline = renderMergeTimeline(vm, locale);
  const auditDetails = renderStructuredFieldAuditDetails({
    auditLogs: vm.audit_logs ?? [],
    locale,
    surface: "replay"
  });
  const deliverableHrefs = (vm.accepted_deliverables ?? [])
    .flatMap((item) => [item.preview_href, item.download_href, item.restore_href])
    .filter((item): item is string => Boolean(item));
  const structuredAuditCount = (vm.audit_logs ?? []).filter((log) => {
    const detail = objectRecord((log as { detail_json?: unknown; detailJson?: unknown }).detail_json)
      ?? objectRecord((log as { detail_json?: unknown; detailJson?: unknown }).detailJson);
    return detail?.["merge_strategy"] === "field_merge" && Array.isArray(detail["structured_field_changes"]);
  }).length;
  const main = `<section class="wh-replay-main">
    <span class="wh-kicker">${escapeHtml(copy(locale, "Replay Work", "Replay Work"))}</span>
    <h1 class="wh-title">${escapeHtml(copy(locale, "查看 AI 怎么做的", "See how AI did it"))}</h1>
    <p class="wh-subtle">${escapeHtml(run.handoff_md ?? run.outcome_reason ?? copy(locale, "关键步骤、证据、快照和成本都在这里。", "Key steps, evidence, snapshots, and cost are shown here."))}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(copy(locale, "步骤", "Steps"))}</strong><p class="wh-subtle">${escapeHtml(String(vm.steps.length))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(copy(locale, "正式交付物", "Accepted deliverables"))}</strong><p class="wh-subtle">${escapeHtml(String((vm.accepted_deliverables ?? []).length))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(copy(locale, "决策记录", "Decision record"))}</strong><p class="wh-subtle">${escapeHtml(String((vm.merge_timeline ?? []).length))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(copy(locale, "字段审计", "Field audit"))}</strong><p class="wh-subtle">${escapeHtml(String(structuredAuditCount))}</p></article>
    </div>
    <h2>${escapeHtml(copy(locale, "关键步骤", "Key steps"))}</h2><div class="wh-card">${steps}</div>
    ${deliverables ? `<h2>${escapeHtml(copy(locale, "正式交付物", "Accepted deliverables"))}</h2><div class="wh-list">${deliverables}</div>` : ""}
    ${mergeTimeline ? `<h2>${escapeHtml(copy(locale, "决策记录", "Decision record"))}</h2><div class="wh-list">${mergeTimeline}</div>` : ""}
    ${auditDetails ? `<h2>${escapeHtml(copy(locale, "字段写回审计", "Field writeback audit"))}</h2>${auditDetails}` : ""}
  </section>`;
  return {
    surface,
    runId: run.id ?? "",
    ...(run.work_item_id ? { workItemId: run.work_item_id } : {}),
    title: copy(locale, "查看 AI 怎么做的", "See how AI did it"),
    css: replayCss,
    html: `<div class="${rootClass}"><main class="wh-replay"><div class="wh-replay-frame">${main}${renderRail(vm, locale)}</div></main></div>`,
    primaryHrefs: deliverableHrefs,
    stepCount: vm.steps.length,
    acceptedDeliverableCount: (vm.accepted_deliverables ?? []).length,
    mergeAttemptCount: (vm.merge_timeline ?? []).length,
    structuredAuditCount,
    cuuState: run.status === "succeeded" ? "celebrating" : "thinking"
  };
}
