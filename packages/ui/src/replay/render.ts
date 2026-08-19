import type {
  CuuState,
  ReplayMergeCandidateVM,
  ReplayMergeAttemptVM,
  ReplayTraceVM,
  WorkHubLocale
} from "@workhub/contracts";

import { agentRunStatusLabel, agentStepPhaseLabel, agentStepPublicSummary, formatLocalTimestamp, uiCount, uiLocale, uiT, type UiRenderOptions } from "../i18n.js";
import { overlapHunkReviewCss, renderOverlapHunkReview } from "../overlap-hunk-review.js";
import { renderRichPatchViewer, richPatchViewerCss } from "../rich-patch-viewer.js";
import {
  renderStructuredFieldAuditDetails,
  renderStructuredFieldOperationDetails
} from "../structured-field-details.js";
import { renderSubrecordItemDiff, subrecordItemDiffCss } from "../subrecord-item-diff.js";

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
  ":root{color-scheme:light;--ink:#1A1D26;--muted:#646E7E;--line:#E6E7EB;--paper:#fff;--soft:#F5F5FE;--blue:#4F46E5;--green:#15A05A;--amber:#E0892A;--danger:#E5484D}",
  ".wh-replay{font-family:\"Aptos\",\"Segoe UI\",sans-serif;color:var(--ink);background:transparent;padding:24px;box-sizing:border-box}",
  ".wh-replay-frame{max-width:1120px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:20px;align-items:start}",
  ".wh-replay-main,.wh-replay-rail{background:rgba(255,255,255,.62);backdrop-filter:saturate(1.45) blur(18px);-webkit-backdrop-filter:saturate(1.45) blur(18px);border:1px solid rgba(255,255,255,.72);border-radius:18px;box-shadow:0 18px 50px rgba(37,51,79,.08);min-width:0}",
  ".wh-replay-main{padding:24px}.wh-replay-rail{padding:18px;position:sticky;top:16px}.wh-kicker{font-size:12px;color:var(--blue);font-weight:700;text-transform:uppercase;letter-spacing:0}",
  ".wh-replay-back{display:inline-flex;align-items:center;gap:4px;margin-top:6px;color:var(--blue);text-decoration:none;font-size:13px;font-weight:600}.wh-replay-back:hover,.wh-replay-back:focus-visible{text-decoration:underline}",
  ".wh-title{font-size:30px;line-height:1.35;margin:8px 0}.wh-subtle{color:var(--muted);line-height:1.55}.wh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-top:18px}",
  ".wh-card{border:1px solid rgba(255,255,255,.75);background:rgba(255,255,255,.66);border-radius:16px;padding:16px;min-width:0;overflow-wrap:anywhere}.wh-list{display:grid;gap:10px;margin-top:14px}.wh-row{display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding:12px 0}.wh-row:first-child{border-top:0}.wh-row>div{min-width:0}",
  ".wh-title,.wh-subtle{overflow-wrap:anywhere}.wh-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--soft);padding:5px 9px;font-size:12px;color:var(--muted);max-width:100%;white-space:normal;text-align:left;overflow-wrap:anywhere}.wh-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}.wh-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:12px;border:1px solid var(--line);padding:9px 12px;color:var(--ink);text-decoration:none;background:rgba(255,255,255,.92);font-weight:650}.wh-btn-primary{background:var(--blue);color:#fff;border-color:var(--blue)}.wh-btn-danger{background:#fff4f3;color:#a94137;border-color:#f3c5c0}",
  // R20 DSK-UX（R19-3）：撤销按钮武装态（首点后）翻成更实的警示色；已回滚/执行中禁用态压暗，和网盘删除武装同款语言。
  ".wh-btn-danger[data-replay-revert-armed=\"true\"]{background:#ffe3df;color:#8f2f27;border-color:#e7a49c}.wh-btn-danger[aria-disabled=\"true\"]{opacity:.6;pointer-events:none}",
  richPatchViewerCss,
  ".wh-row .wh-patch{margin-top:10px}",
  overlapHunkReviewCss,
  ".wh-row .wh-diff3{margin-top:10px}",
  ".wh-replay-audit{border:1px solid #dbe5ff;border-radius:12px;background:#f7f9ff;padding:10px 12px;display:grid;gap:8px;margin-top:10px}.wh-replay-audit-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.wh-replay-audit-list{display:grid;gap:6px}.wh-replay-audit-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;border-top:1px solid #e5eaff;padding-top:6px}.wh-replay-audit-row:first-child{border-top:0;padding-top:0}.wh-replay-audit-code{font-family:\"Cascadia Mono\",\"SFMono-Regular\",monospace;font-size:12px;color:#45506b;overflow-wrap:anywhere}",
  ".wh-structured{border:1px solid #dfe6d8;border-radius:12px;background:#fbfff8;padding:10px 12px;display:grid;gap:8px;margin-top:10px}.wh-structured-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.wh-structured-meta{display:flex;gap:6px;flex-wrap:wrap}.wh-structured-fields{margin:0;color:var(--muted);font-size:13px}",
  ".wh-field-details{border:1px solid #dfe6d8;border-radius:12px;background:#fffefa;padding:10px 12px;display:grid;gap:8px;margin-top:10px}.wh-field-list{display:grid;gap:8px}.wh-field-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;border-top:1px solid #e6ecd9;padding-top:8px}.wh-field-row:first-child{border-top:0;padding-top:0}.wh-field-row-meta{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-content:start}",
  subrecordItemDiffCss,
  ".wh-desktop .wh-replay-frame{max-width:940px;grid-template-columns:1fr 240px}.wh-desktop .wh-replay{background:linear-gradient(135deg,#edf6ff,#f8fbff)}@media (max-width:860px){.wh-replay{padding:18px}.wh-replay-frame{grid-template-columns:1fr}.wh-replay-main{padding:18px}.wh-replay-rail{position:static}.wh-title{font-size:24px}.wh-title,.wh-subtle,.wh-card strong{word-break:break-all}.wh-grid{grid-template-columns:1fr}.wh-row{flex-direction:column;align-items:flex-start}.wh-field-row,.wh-subrecord-row,.wh-replay-audit-row{grid-template-columns:1fr}.wh-actions{align-items:flex-start}.wh-diff{font-size:11px}.wh-diff-line,.wh-diff-hunk-head{grid-template-columns:38px 38px minmax(0,1fr)}.wh-diff-line-no{padding:2px 6px}.wh-diff-code{padding:2px 8px}}"
].join("");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

// 外部/契约来源的 href 可能带 javascript:/data: → XSS。只放行相对路径与 http(s)/mailto，其余拦成 "#"。
function safeHref(value: unknown): string {
  const v = String(value ?? "").trim();
  if ((v.startsWith("/") && !v.startsWith("//")) || /^(?:https?:|mailto:)/iu.test(v)) {
    return v;
  }
  return "#";
}

// 与 packages/ui/src/i18n.ts 的 `copy`/`uiT` 同形态的本地词典：把原来散落各处、每次调用都
// 内联中英文字面量的 copy(locale, zh, en) 换成「键 → 词典」查表，和 gold-path 组件体系
// （route-components.ts 经由 uiT/goldPathT）统一成同一种 i18n 函数形状。真正跨页共用的概念
// （状态、步骤计数、数量单复数）直接复用 ../i18n.js 导出的 uiT/uiCount，不在这里重复定义。
type ReplayCopy = Record<WorkHubLocale, string>;

const replayCopy = {
  "replay.kicker": { "zh-CN": "执行回放", "en-US": "Replay Work" },
  "replay.title": { "zh-CN": "查看 AI 怎么做的", "en-US": "See how AI did it" },
  "replay.emptySummary": {
    "zh-CN": "关键步骤、证据、快照和成本都在这里。",
    "en-US": "Key steps, evidence, snapshots, and cost are shown here."
  },
  "replay.keyStepsTitle": { "zh-CN": "关键步骤", "en-US": "Key steps" },
  "replay.acceptedDeliverablesTitle": { "zh-CN": "正式交付物", "en-US": "Accepted deliverables" },
  "replay.decisionRecordTitle": { "zh-CN": "决策记录", "en-US": "Decision record" },
  "replay.fieldAuditTitle": { "zh-CN": "字段审计", "en-US": "Field audit" },
  "replay.fieldWritebackAuditTitle": { "zh-CN": "字段写回审计", "en-US": "Field writeback audit" },
  "replay.backToWorkItem": { "zh-CN": "← 返回任务", "en-US": "← Back to work item" },
  "replay.railKicker": { "zh-CN": "回放摘要", "en-US": "Replay summary" },
  "replay.tokenTitle": { "zh-CN": "Token 用量", "en-US": "Tokens used" },
  "replay.costTitle": { "zh-CN": "估算成本", "en-US": "Estimated cost" },
  "replay.snapshotTitle": { "zh-CN": "快照", "en-US": "Snapshots" },
  "replay.deliverablePreview": { "zh-CN": "预览", "en-US": "Preview" },
  "replay.deliverableDownload": { "zh-CN": "下载", "en-US": "Download" },
  "replay.deliverableRestore": { "zh-CN": "还原", "en-US": "Restore" },
  "replay.optionKeepCurrent": { "zh-CN": "保留正式版", "en-US": "Keep accepted version" },
  "replay.optionAcceptIncoming": { "zh-CN": "采纳这次版本", "en-US": "Accept this version" },
  "replay.optionAiFusion": { "zh-CN": "AI 融合建议", "en-US": "AI fusion draft" },
  "replay.attemptConflict": { "zh-CN": "出现冲突", "en-US": "Conflict found" },
  "replay.attemptMerged": { "zh-CN": "已采纳", "en-US": "Accepted" },
  "replay.recordedFallback": { "zh-CN": "已记录", "en-US": "Recorded" },
  "replay.decisionKeepCurrent": { "zh-CN": "保留正式版", "en-US": "Kept accepted version" },
  "replay.decisionAcceptIncoming": { "zh-CN": "采纳这次版本", "en-US": "Accepted this version" },
  "replay.decisionAiFusion": { "zh-CN": "采用 AI 融合稿", "en-US": "Used AI fusion draft" },
  "replay.checksumLabel": { "zh-CN": "结果校验码", "en-US": "Result checksum" },
  "replay.hunkDecisionReplayTitle": { "zh-CN": "逐段选择回放", "en-US": "Hunk decision replay" },
  "replay.hunkAuditRowTitle": { "zh-CN": "重叠段", "en-US": "Overlap hunk" },
  "replay.bulkClickedScope": { "zh-CN": "点击范围", "en-US": "Clicked scope" },
  "replay.bulkAcceptedScope": { "zh-CN": "采纳范围", "en-US": "Accepted scope" },
  "replay.bulkResolved": { "zh-CN": "已处理", "en-US": "Resolved" },
  "replay.bulkBlocked": { "zh-CN": "被阻断", "en-US": "Blocked" },
  "replay.bulkActionReplayTitle": { "zh-CN": "批量动作回放", "en-US": "Bulk action replay" },
  "replay.patchPreviewTitle": { "zh-CN": "改动预览", "en-US": "Change preview" },
  "replay.structuredFieldCheckTitle": { "zh-CN": "结构化字段检查", "en-US": "Structured field check" },
  "replay.recommendedBadge": { "zh-CN": "推荐", "en-US": "Recommended" },
  "replay.chosenBadge": { "zh-CN": "已选择", "en-US": "Chosen" },
  "replay.noChoiceLabel": { "zh-CN": "未选择", "en-US": "Not chosen" },
  "replay.conflictAtPrefix": { "zh-CN": "冲突位置", "en-US": "Conflict at" },
  // R20 DSK-UX（R19-3）：改动快照的「撤销此次改动」动作——把文件还原到某个快照。二次确认（武装→再点执行）
  // 沿用仓库既有 5 秒先例（decideRollbackConfirmation/网盘删除），文案键在这里统一，binder 只读 data-* 取字。
  "replay.snapshotListTitle": { "zh-CN": "改动快照", "en-US": "Change snapshots" },
  "replay.snapshotListHint": {
    "zh-CN": "撤销会把文件还原到该快照、覆盖之后的改动；此操作需在桌面客户端执行。",
    "en-US": "Undoing restores files to that snapshot and overwrites later changes; do it in the desktop app."
  },
  "replay.snapshotRevert": { "zh-CN": "撤销此次改动", "en-US": "Undo these changes" },
  "replay.snapshotRevertArm": { "zh-CN": "确认撤销？再点一次", "en-US": "Undo? Click again" },
  "replay.snapshotReverting": { "zh-CN": "撤销中…", "en-US": "Undoing…" },
  "replay.snapshotReverted": { "zh-CN": "已回滚", "en-US": "Reverted" },
  "replay.snapshotRevertRetry": { "zh-CN": "撤销失败，点此重试", "en-US": "Undo failed — retry" },
  "replay.snapshotKindPreStep": { "zh-CN": "执行前快照", "en-US": "Pre-step snapshot" },
  "replay.snapshotKindMerge": { "zh-CN": "合并快照", "en-US": "Merge snapshot" },
  "replay.snapshotKindManual": { "zh-CN": "手动快照", "en-US": "Manual snapshot" },
  "replay.snapshotKindBase": { "zh-CN": "基线快照", "en-US": "Base snapshot" },
  // WIRE-07：进行中的 run 在回放页给「中止执行」入口（POST /api/agent-runs/:id/abort）。渲染层只吐
  // 带 data-* 的静态标记，两段式确认与调用都在 web 的 api-action 分发里（armConfirmButton 先例）。
  "replay.abortRun": { "zh-CN": "中止执行", "en-US": "Abort run" }
} satisfies Record<string, ReplayCopy>;

type ReplayCopyKey = keyof typeof replayCopy;

function t(locale: WorkHubLocale, key: ReplayCopyKey): string {
  return replayCopy[key][locale];
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function mergeOptionLabel(locale: WorkHubLocale, optionKey: string) {
  if (optionKey === "keep_current") {
    return t(locale, "replay.optionKeepCurrent");
  }
  if (optionKey === "accept_incoming") {
    return t(locale, "replay.optionAcceptIncoming");
  }
  if (optionKey === "ai_fusion") {
    return t(locale, "replay.optionAiFusion");
  }
  return optionKey;
}

function mergeAttemptLabel(locale: WorkHubLocale, result: string) {
  if (result === "conflict") {
    return t(locale, "replay.attemptConflict");
  }
  if (result === "merged") {
    return t(locale, "replay.attemptMerged");
  }
  return t(locale, "replay.recordedFallback");
}

function decisionLabel(locale: WorkHubLocale, decision: string) {
  if (decision === "keep_current") {
    return t(locale, "replay.decisionKeepCurrent");
  }
  if (decision === "accept_incoming") {
    return t(locale, "replay.decisionAcceptIncoming");
  }
  if (decision === "ai_fusion") {
    return t(locale, "replay.decisionAiFusion");
  }
  return decision;
}

function lineRangeLabel(locale: WorkHubLocale, startLine: number, endLine: number) {
  return startLine === endLine
    ? (locale === "zh-CN" ? `第 ${startLine} 行` : `Line ${startLine}`)
    : (locale === "zh-CN" ? `第 ${startLine}-${endLine} 行` : `Lines ${startLine}-${endLine}`);
}

function bulkResultLine(locale: WorkHubLocale, result: string) {
  return locale === "zh-CN" ? `结果：${result}` : `Result: ${result}`;
}

function renderTextHunkDecisionAudit(attempt: ReplayMergeAttemptVM, locale: WorkHubLocale) {
  const decisions = attempt.text_hunk_decisions ?? [];
  if (decisions.length === 0) {
    return "";
  }
  const rows = decisions
    .map((decision) => `<div class="wh-replay-audit-row" data-replay-text-hunk-decision="${escapeHtml(String(decision.hunk_index))}" data-replay-text-hunk-source="${escapeHtml(decision.decision)}">
      <div>
        <strong>${escapeHtml(`${t(locale, "replay.hunkAuditRowTitle")} ${decision.hunk_index + 1}`)}</strong>
        <p class="wh-subtle">${escapeHtml(lineRangeLabel(locale, decision.start_line, decision.end_line))}</p>
      </div>
      <span class="wh-pill">${escapeHtml(decisionLabel(locale, decision.decision))}</span>
    </div>`)
    .join("");
  // L24：原始 64 位十六进制摘要对普通用户是开发者黑话。改为带标签 + 截断展示（完整值留在 title 供核对），
  // 既保留「这次结果有指纹可校验」的可信度，又不再把一长串乱码糊在用户脸上。
  const sha = attempt.text_hunk_output_sha256
    ? `<p class="wh-replay-audit-code" title="${escapeHtml(attempt.text_hunk_output_sha256)}">${escapeHtml(t(locale, "replay.checksumLabel"))} · ${escapeHtml(attempt.text_hunk_output_sha256.slice(0, 12))}…</p>`
    : "";
  return `<section class="wh-replay-audit" data-replay-text-hunk-decision-audit="true" data-replay-text-hunk-decision-count="${escapeHtml(String(decisions.length))}">
    <div class="wh-replay-audit-head">
      <strong>${escapeHtml(t(locale, "replay.hunkDecisionReplayTitle"))}</strong>
      <span class="wh-pill">${escapeHtml(uiCount(locale, attempt.text_hunk_count ?? decisions.length, "段", "hunk"))}</span>
    </div>
    <div class="wh-replay-audit-list">${rows}</div>
    ${sha}
  </section>`;
}

function renderBulkActionAudit(attempt: ReplayMergeAttemptVM, locale: WorkHubLocale) {
  const bulk = attempt.bulk_action;
  if (!bulk) {
    return "";
  }
  const blocked = bulk.blocked_target_keys ?? [];
  const resolved = bulk.resolved_conflict_target_keys ?? [];
  const accepted = bulk.accepted_incoming_target_keys ?? [];
  const rows = [
    bulk.target_keys.length
      ? `<div class="wh-replay-audit-row"><span>${escapeHtml(t(locale, "replay.bulkClickedScope"))}</span><span class="wh-replay-audit-code">${escapeHtml(bulk.target_keys.join(", "))}</span></div>`
      : "",
    accepted.length
      ? `<div class="wh-replay-audit-row"><span>${escapeHtml(t(locale, "replay.bulkAcceptedScope"))}</span><span class="wh-replay-audit-code">${escapeHtml(accepted.join(", "))}</span></div>`
      : "",
    resolved.length
      ? `<div class="wh-replay-audit-row"><span>${escapeHtml(t(locale, "replay.bulkResolved"))}</span><span class="wh-replay-audit-code">${escapeHtml(resolved.join(", "))}</span></div>`
      : "",
    blocked.length
      ? `<div class="wh-replay-audit-row"><span>${escapeHtml(t(locale, "replay.bulkBlocked"))}</span><span class="wh-replay-audit-code">${escapeHtml(blocked.join(", "))}</span></div>`
      : ""
  ].filter(Boolean).join("");
  return `<section class="wh-replay-audit" data-replay-bulk-action-audit="true" data-replay-bulk-action="${escapeHtml(bulk.action)}" data-replay-bulk-result="${escapeHtml(bulk.result ?? attempt.result)}">
    <div class="wh-replay-audit-head">
      <strong>${escapeHtml(t(locale, "replay.bulkActionReplayTitle"))}</strong>
      <span class="wh-pill">${escapeHtml(decisionLabel(locale, bulk.action))}</span>
    </div>
    <p class="wh-subtle">${escapeHtml(bulkResultLine(locale, bulk.result ?? attempt.result))}</p>
    ${rows ? `<div class="wh-replay-audit-list">${rows}</div>` : ""}
  </section>`;
}

function stripMarkdown(value: string) {
  return value.replace(/[#*_`>-]/gu, " ").replace(/\s+/gu, " ").trim();
}
function renderTextPatchPreview(candidate: ReplayMergeCandidateVM, locale: WorkHubLocale) {
  return renderRichPatchViewer({
    locale,
    preview: candidate.quality_gate?.["text_patch_preview"],
    title: t(locale, "replay.patchPreviewTitle"),
    rootAttributes: {
      "data-replay-text-patch-preview": "true",
      "data-replay-text-patch-option-key": candidate.option_key
    }
  });
}

function renderTextDiff3QualityGate(candidate: ReplayMergeCandidateVM, locale: WorkHubLocale) {
  const diff3 = objectRecord(candidate.quality_gate?.["text_diff3"]);
  return renderOverlapHunkReview({
    locale,
    diff3,
    optionKey: candidate.option_key,
    rootAttributes: {
      "data-replay-text-diff3": "true",
      "data-text-diff3-option-key": candidate.option_key
    }
  });
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
      <strong>${escapeHtml(t(locale, "replay.structuredFieldCheckTitle"))}</strong>
      <span class="wh-pill">${escapeHtml(dryRunStatus || t(locale, "replay.recordedFallback"))}</span>
    </div>
    ${renderStructuredFieldOperationDetails({ operations, locale, surface: "replay" })}${renderSubrecordItemDiff({ operations, locale, surface: "replay" })}
  </section>`;
}

function renderDeliverables(vm: ReplayTraceVM, locale: WorkHubLocale) {
  const accepted = vm.accepted_deliverables ?? [];
  return accepted
    .map((item) => {
      // WIRE-08：预览/下载此前是裸 <a href=/api/...>——web 的 api-action 分发拦下后无人认领，落「处理中」
      // 兜底。对齐 workitem 页做法：预览接 drive_preview 预览面板管线，下载走原生资源链接标记直接放行。
      const actions = [
        item.preview_href ? `<a class="wh-btn" href="${escapeHtml(safeHref(item.preview_href))}" data-action-id="drive_preview" data-r4-proposal-change-preview="true">${escapeHtml(t(locale, "replay.deliverablePreview"))}</a>` : "",
        item.download_href ? `<a class="wh-btn wh-btn-primary" href="${escapeHtml(safeHref(item.download_href))}" data-action-id="drive_download" data-native-resource-link="true" target="_blank" rel="noreferrer">${escapeHtml(t(locale, "replay.deliverableDownload"))}</a>` : "",
        item.restore_href ? `<a class="wh-btn wh-btn-danger" href="${escapeHtml(safeHref(item.restore_href))}" data-action-id="restore_deliverable" data-method="POST">${escapeHtml(t(locale, "replay.deliverableRestore"))}</a>` : ""
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
                candidate.recommended ? t(locale, "replay.recommendedBadge") : "",
                candidate.chosen ? t(locale, "replay.chosenBadge") : ""
              ].filter(Boolean).join(" · ");
              return `<div class="wh-row"><div><strong>${escapeHtml(mergeOptionLabel(locale, candidate.option_key))}</strong><p class="wh-subtle">${escapeHtml(stripMarkdown(candidate.rationale_md ?? candidate.option_key))}</p>${renderTextPatchPreview(candidate, locale)}${renderTextDiff3QualityGate(candidate, locale)}${renderStructuredRecordPatch(candidate, locale)}</div>${badges ? `<span class="wh-pill">${escapeHtml(badges)}</span>` : ""}</div>`;
            }).join("")
            : `<p class="wh-subtle">${escapeHtml(t(locale, "replay.noChoiceLabel"))}</p>`;
          const chosen = decision.chosen_option_key
            ? mergeOptionLabel(locale, decision.chosen_option_key)
            : t(locale, "replay.noChoiceLabel");
          return `<div class="wh-list" data-replay-merge-decision="${escapeHtml(decision.id)}"><div class="wh-row"><div><strong>${escapeHtml(`${t(locale, "replay.conflictAtPrefix")}: ${decision.conflict_key}`)}</strong><p class="wh-subtle">${escapeHtml(chosen)}</p></div></div>${candidates}</div>`;
        }).join("")
        : `<p class="wh-subtle">${escapeHtml(t(locale, "replay.noChoiceLabel"))}</p>`;
      const targetSummary = attempt.target_keys.length > 0 ? attempt.target_keys.join(", ") : attempt.id;
      const conflictPill = uiCount(locale, attempt.conflict_count, "处冲突", "conflict");
      // UI-02：本地时区渲染（不再 slice(0,16) 直切 ISO 串 UTC 直出）。
      const createdAtPill = formatLocalTimestamp(attempt.created_at);
      return `<article class="wh-card" data-replay-merge-attempt="${escapeHtml(attempt.id)}" data-replay-merge-result="${escapeHtml(attempt.result)}"><strong>${escapeHtml(mergeAttemptLabel(locale, attempt.result))}</strong><p class="wh-subtle">${escapeHtml(targetSummary)}</p><div class="wh-actions"><span class="wh-pill" data-replay-merge-conflict-count="${escapeHtml(String(attempt.conflict_count))}">${escapeHtml(conflictPill)}</span><span class="wh-pill">${escapeHtml(createdAtPill)}</span></div>${renderBulkActionAudit(attempt, locale)}${renderTextHunkDecisionAudit(attempt, locale)}${decisions}</article>`;
    })
    .join("");
}

function snapshotKindLabel(locale: WorkHubLocale, kind: string) {
  if (kind === "pre_step") {
    return t(locale, "replay.snapshotKindPreStep");
  }
  if (kind === "merge") {
    return t(locale, "replay.snapshotKindMerge");
  }
  if (kind === "manual") {
    return t(locale, "replay.snapshotKindManual");
  }
  if (kind === "base") {
    return t(locale, "replay.snapshotKindBase");
  }
  return kind;
}

// R20 DSK-UX（R19-3）：改动快照列表——每个「未回滚」快照给一颗「撤销此次改动」按钮（POST /api/agent-runs/:id/revert，
// snapshot_id 走 body），已回滚的只显示「已回滚」态不给按钮。按钮标 data-requires-desktop=true：web 端点它由既有
// 拦截渲成「需在桌面端操作」提示（对齐 R19-5 撤销策略、restore/revoke 同款），桌面端才由 bindReplayRevertActions
// 接真回调执行。二次确认（武装→再点执行）与刷新都在 binder 里，纯渲染层只吐带 data-* 的静态标记。
function renderSnapshots(vm: ReplayTraceVM, locale: WorkHubLocale, runId: string) {
  const snapshots = vm.snapshots ?? [];
  if (!runId || snapshots.length === 0) {
    return "";
  }
  const revertHref = safeHref(`/api/agent-runs/${encodeURIComponent(runId)}/revert`);
  const rows = snapshots
    .map((snap) => {
      const reverted = Boolean(snap.reverted_at);
      const createdAt = snap.created_at ? formatLocalTimestamp(snap.created_at) : "";
      const meta = [snapshotKindLabel(locale, snap.kind), createdAt].filter(Boolean).join(" · ");
      const action = reverted
        ? `<span class="wh-pill" data-replay-snapshot-reverted="true">${escapeHtml(t(locale, "replay.snapshotReverted"))}</span>`
        : `<a class="wh-btn wh-btn-danger" href="${escapeHtml(revertHref)}" data-action-id="revert_agent_run" data-method="POST" data-requires-desktop="true" data-replay-revert-snapshot="${escapeHtml(snap.id)}" data-replay-revert-run="${escapeHtml(runId)}" data-revert-label-idle="${escapeHtml(t(locale, "replay.snapshotRevert"))}" data-revert-label-arm="${escapeHtml(t(locale, "replay.snapshotRevertArm"))}" data-revert-label-reverting="${escapeHtml(t(locale, "replay.snapshotReverting"))}" data-revert-label-reverted="${escapeHtml(t(locale, "replay.snapshotReverted"))}" data-revert-label-retry="${escapeHtml(t(locale, "replay.snapshotRevertRetry"))}">${escapeHtml(t(locale, "replay.snapshotRevert"))}</a>`;
      return `<div class="wh-row" data-replay-snapshot="${escapeHtml(snap.id)}" data-replay-snapshot-kind="${escapeHtml(snap.kind)}"><div><strong>${escapeHtml(snap.ref)}</strong><p class="wh-subtle">${escapeHtml(meta)}</p></div>${action}</div>`;
    })
    .join("");
  return `<h2>${escapeHtml(t(locale, "replay.snapshotListTitle"))}</h2><p class="wh-subtle">${escapeHtml(t(locale, "replay.snapshotListHint"))}</p><div class="wh-card wh-replay-snapshots" data-replay-snapshot-list="true">${rows}</div>`;
}

function renderRail(vm: ReplayTraceVM, locale: WorkHubLocale) {
  return `<aside class="wh-replay-rail">
    <span class="wh-kicker">${escapeHtml(t(locale, "replay.railKicker"))}</span>
    <article class="wh-card"><strong>${escapeHtml(t(locale, "replay.tokenTitle"))}</strong><p class="wh-subtle">${escapeHtml(String(vm.cost?.me.total_tokens ?? 0))}</p></article>
    <article class="wh-card"><strong>${escapeHtml(t(locale, "replay.costTitle"))}</strong><p class="wh-subtle">¥${escapeHtml(vm.cost?.me.estimated_cost_cny ?? "0")}</p></article>
    <article class="wh-card"><strong>${escapeHtml(t(locale, "replay.snapshotTitle"))}</strong><p class="wh-subtle">${escapeHtml(String(vm.snapshots.length))}</p></article>
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
  const runId = run.id ?? "";
  const steps = vm.steps
    .map((step) => `<div class="wh-row"><div><strong>${escapeHtml(agentStepPhaseLabel(locale, step.phase))}</strong><p class="wh-subtle">${escapeHtml(agentStepPublicSummary(locale, step))}</p></div><span class="wh-pill">#${escapeHtml(String(step.step_no))}</span></div>`)
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
  // L23：回放页知道它属于哪个工作项（run.work_item_id），却从不给一条回去的路，用户看完只能靠浏览器后退。
  // 仅 web 面渲染可见的「返回任务」链接——桌面 Spotlight 有自己的面包屑返回，且普通锚点导航会打断 Tauri webview。
  const backToWorkItem = surface === "web" && run.work_item_id
    ? `<a class="wh-replay-back" href="/workitems/${encodeURIComponent(run.work_item_id)}" data-replay-back-work-item="${escapeHtml(run.work_item_id)}">${escapeHtml(t(locale, "replay.backToWorkItem"))}</a>`
    : "";
  // WIRE-07：进行中（queued/running，与 cardFromAgentRunLive 的 active 口径一致）的 run 给「中止执行」
  // 入口；终态（succeeded/failed/escalated/cancelled）不出按钮。二次确认在 web 分发层（r9ConfirmArmed）。
  const abortRunAction = runId && (run.status === "queued" || run.status === "running")
    ? `<div class="wh-actions"><a class="wh-btn wh-btn-danger" href="${escapeHtml(safeHref(`/api/agent-runs/${encodeURIComponent(runId)}/abort`))}" data-action-id="abort_agent_run" data-method="POST" data-replay-abort-run="${escapeHtml(runId)}">${escapeHtml(t(locale, "replay.abortRun"))}</a></div>`
    : "";
  const main = `<section class="wh-replay-main">
    <span class="wh-kicker">${escapeHtml(t(locale, "replay.kicker"))}</span>
    ${backToWorkItem}
    <h1 class="wh-title">${escapeHtml(t(locale, "replay.title"))}</h1>
    <p class="wh-subtle">${escapeHtml(run.handoff_md ?? run.outcome_reason ?? t(locale, "replay.emptySummary"))}</p>
    ${abortRunAction}
    <div class="wh-grid">
      ${run.status ? `<article class="wh-card" data-replay-run-status="${escapeHtml(run.status)}"><strong>${escapeHtml(uiT(locale, "generic.status"))}</strong><p class="wh-subtle">${escapeHtml(agentRunStatusLabel(locale, run.status))}</p></article>` : ""}
      <article class="wh-card"><strong>${escapeHtml(uiT(locale, "generic.steps"))}</strong><p class="wh-subtle">${escapeHtml(String(vm.steps.length))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "replay.acceptedDeliverablesTitle"))}</strong><p class="wh-subtle">${escapeHtml(String((vm.accepted_deliverables ?? []).length))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "replay.decisionRecordTitle"))}</strong><p class="wh-subtle">${escapeHtml(String((vm.merge_timeline ?? []).length))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "replay.fieldAuditTitle"))}</strong><p class="wh-subtle">${escapeHtml(String(structuredAuditCount))}</p></article>
    </div>
    <h2>${escapeHtml(t(locale, "replay.keyStepsTitle"))}</h2><div class="wh-card">${steps}</div>
    ${deliverables ? `<h2>${escapeHtml(t(locale, "replay.acceptedDeliverablesTitle"))}</h2><div class="wh-list">${deliverables}</div>` : ""}
    ${mergeTimeline ? `<h2>${escapeHtml(t(locale, "replay.decisionRecordTitle"))}</h2><div class="wh-list">${mergeTimeline}</div>` : ""}
    ${renderSnapshots(vm, locale, runId)}
    ${auditDetails ? `<h2>${escapeHtml(t(locale, "replay.fieldWritebackAuditTitle"))}</h2>${auditDetails}` : ""}
  </section>`;
  return {
    surface,
    runId,
    ...(run.work_item_id ? { workItemId: run.work_item_id } : {}),
    title: t(locale, "replay.title"),
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

// ── R20 DSK-UX（R19-3）：撤销改动的运行期接线 ──────────────────────────────────────────────
// 纯渲染层（renderSnapshots）只吐带 data-* 的静态按钮；真正的二次确认状态机 + 调 revert + 刷新在这里。
// 设计沿用仓库既有分工（apps 各视图：纯判定抽成不碰 DOM 的 decideXxxConfirmation + 一个薄 DOM binder）：
// - decideSnapshotRevertConfirmation：武装/执行的纯判定，单测直接钉死。
// - bindReplayRevertActions：薄 binder，revert 用注入回调（不让 @workhub/ui 直依赖 SDK），成功走 onReverted
//   让宿主重拉。用自定义最小元素接口（真实 HTMLElement 结构上满足，宿主侧 as 一下即可），
//   这样无 jsdom 也能用假 DOM 单测这条编排逻辑。

// 同一快照在武装态下再点=执行；未武装或点了另一颗按钮=（重新）武装那一颗。
export function decideSnapshotRevertConfirmation(
  armedSnapshotId: string | undefined,
  clickedSnapshotId: string
): { kind: "arm" | "execute"; snapshotId: string } {
  return armedSnapshotId === clickedSnapshotId
    ? { kind: "execute", snapshotId: clickedSnapshotId }
    : { kind: "arm", snapshotId: clickedSnapshotId };
}

export interface ReplayRevertClickEvent {
  preventDefault(): void;
  stopPropagation(): void;
}

// binder 用到的最小按钮接口——真实 DOM 的 HTMLAnchorElement/HTMLElement 结构上都满足。
export interface ReplayRevertButton {
  readonly dataset: { [key: string]: string | undefined };
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, handler: (event: ReplayRevertClickEvent) => void): void;
}

export interface ReplayRevertRoot {
  querySelectorAll(selector: string): Iterable<ReplayRevertButton>;
}

export interface ReplayRevertDeps {
  // 注入的撤销回调——宿主把 client.revertAgentRun 传进来（不在纯渲染包里直依赖 SDK）。
  revert: (runId: string, payload: { snapshot_id: string }) => Promise<unknown>;
  // 撤销成功后回调——宿主据此重拉/重渲 replay（纯 binder 不知道怎么重渲整页）。
  onReverted?: (info: { runId: string; snapshotId: string }) => void;
  // 可注入计时器（测试里用替身，免真实 5 秒等待）；默认走全局 setTimeout/clearTimeout。
  setArmTimer?: (fn: () => void, ms: number) => unknown;
  clearArmTimer?: (handle: unknown) => void;
}

// 武装态 5 秒后自动解除——与网盘删除/版本回滚同一先例。
const REVERT_ARM_TIMEOUT_MS = 5000;

// data-* 缺失时的兜底文案（正常路径由 renderSnapshots 注入本地化文案，binder 保持 locale 无关）。
const REVERT_LABEL_FALLBACK = {
  idle: "撤销此次改动",
  arm: "确认撤销？再点一次",
  reverting: "撤销中…",
  reverted: "已回滚",
  retry: "撤销失败，点此重试"
} as const;

export function bindReplayRevertActions(root: ReplayRevertRoot, deps: ReplayRevertDeps): () => void {
  const setArmTimer = deps.setArmTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearArmTimer = deps.clearArmTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let armedSnapshotId: string | undefined;
  let armTimer: unknown;
  let disposed = false;

  const clearTimer = () => {
    if (armTimer !== undefined) {
      clearArmTimer(armTimer);
      armTimer = undefined;
    }
  };

  for (const button of Array.from(root.querySelectorAll("[data-replay-revert-snapshot]"))) {
    const snapshotId = button.dataset["replayRevertSnapshot"];
    const runId = button.dataset["replayRevertRun"];
    if (!snapshotId || !runId) {
      continue;
    }
    const labels = {
      idle: button.dataset["revertLabelIdle"] ?? REVERT_LABEL_FALLBACK.idle,
      arm: button.dataset["revertLabelArm"] ?? REVERT_LABEL_FALLBACK.arm,
      reverting: button.dataset["revertLabelReverting"] ?? REVERT_LABEL_FALLBACK.reverting,
      reverted: button.dataset["revertLabelReverted"] ?? REVERT_LABEL_FALLBACK.reverted,
      retry: button.dataset["revertLabelRetry"] ?? REVERT_LABEL_FALLBACK.retry
    };
    // C2（R21 审查）：武装超时的收尾逻辑——武装/失败重试两条路径共用同一套「超时未点则回落 idle 文案」。
    const scheduleArmTimeout = (snapshotId: string) => {
      armTimer = setArmTimer(() => {
        armTimer = undefined;
        if (!disposed && armedSnapshotId === snapshotId) {
          armedSnapshotId = undefined;
          delete button.dataset["replayRevertArmed"];
          button.textContent = labels.idle;
        }
      }, REVERT_ARM_TIMEOUT_MS);
    };
    button.addEventListener("click", (event: ReplayRevertClickEvent) => {
      event.preventDefault();
      // 桌面壳的 gold-path 点击管线也在根上委托——武装/执行都自己处理，别让它再兜底走一遍。
      event.stopPropagation();
      if (disposed || button.dataset["replayRevertBusy"] === "true" || button.dataset["replayRevertDone"] === "true") {
        return;
      }
      const decision = decideSnapshotRevertConfirmation(armedSnapshotId, snapshotId);
      if (decision.kind === "arm") {
        clearTimer();
        armedSnapshotId = snapshotId;
        button.dataset["replayRevertArmed"] = "true";
        button.textContent = labels.arm;
        scheduleArmTimeout(snapshotId);
        return;
      }
      clearTimer();
      armedSnapshotId = undefined;
      delete button.dataset["replayRevertArmed"];
      button.dataset["replayRevertBusy"] = "true";
      button.textContent = labels.reverting;
      button.setAttribute("aria-disabled", "true");
      void Promise.resolve(deps.revert(runId, { snapshot_id: snapshotId }))
        .then(() => {
          if (disposed) {
            return;
          }
          delete button.dataset["replayRevertBusy"];
          button.dataset["replayRevertDone"] = "true";
          button.textContent = labels.reverted;
          button.setAttribute("data-replay-snapshot-reverted", "true");
          button.setAttribute("aria-disabled", "true");
          deps.onReverted?.({ runId, snapshotId });
        })
        .catch(() => {
          if (disposed) {
            return;
          }
          // C2（R21 审查）：失败后不清空武装态——保持 armedSnapshotId = snapshotId，
          // 下一次单击 decideSnapshotRevertConfirmation 直接命中 execute（真的重试），
          // 而不是先重新武装一次白点一下。超时未点击则复用 arm 分支同款定时器回落到 idle 文案。
          delete button.dataset["replayRevertBusy"];
          button.removeAttribute("aria-disabled");
          armedSnapshotId = snapshotId;
          button.dataset["replayRevertArmed"] = "true";
          button.textContent = labels.retry;
          clearTimer();
          scheduleArmTimeout(snapshotId);
        });
    });
  }

  return () => {
    disposed = true;
    clearTimer();
  };
}
