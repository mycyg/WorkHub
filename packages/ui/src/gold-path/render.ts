import type {
  ActionSpec,
  ApprovalCenterVM,
  AttentionAction,
  AttentionItem,
  CuuState,
  DeliverableChangeManifest,
  DeliverableCheck,
  DeliverableChange,
  GoldPathSurfaceVM,
  QuestionCard,
  ReplayMergeCandidateVM,
  ReplayTraceVM
} from "@workhub/contracts";
import { agentStepPhaseLabel, agentStepPublicSummary, budgetStatusLabel, checkStatusLabel, deliverableTargetLabel, uiFormatCny, workItemStatusLabel } from "../i18n.js";
import { publicProposalDisplayTitle } from "../proposal/render.js";
import { approvalQueuePageInfoText, goldPathT, normalizeWorkHubLocale, type GoldPathCopyKey, type WorkHubLocale } from "./i18n.js";
import {
  renderStructuredFieldAuditDetails,
  renderStructuredFieldOperationDetails
} from "../structured-field-details.js";

export type GoldPathRenderSurface = "web" | "desktop";
export type GoldPathRenderOptions = {
  locale?: WorkHubLocale | undefined;
};

export type GoldPathRenderedPage = {
  key: "home" | "projects" | "project-home" | "project-timeline" | "intake" | "approvals" | "workitem" | "proposal" | "conversation" | "drive" | "meetings" | "notifications" | "calendar" | "health" | "replay" | "cost" | "agents" | "knowledge" | "search" | "skills" | "settings" | "memory";
  route: string;
  title: string;
  html: string;
  primaryHrefs: string[];
  cuuState: CuuState;
};

export type GoldPathRenderedSurface = {
  surface: GoldPathRenderSurface;
  fixtureId: string;
  vm: GoldPathSurfaceVM;
  css: string;
  pages: GoldPathRenderedPage[];
};

export const goldPathCss = [
  ":root{color-scheme:light;--ink:#1A1D26;--secondary:#5B616E;--muted:#667085;--line:#E6E7EB;--line-alt:#EEF0F3;--paper:#fff;--panel:#fff;--page:#F7F8FA;--soft:#F5F5FE;--blue:#4F46E5;--blue-light:#EEF0FE;--green:#15A05A;--green-light:#E7F0EA;--red:#E5484D;--red-light:#FCECEC;--coral:#ee6b5f;--amber:#E0892A;--amber-light:#FCF3E6;--violet:#7863e6}",
  ".wh-shell{font-family:\"Segoe UI\",system-ui,-apple-system,\"PingFang SC\",sans-serif;color:var(--ink);background:var(--page);padding:24px;min-height:100%;width:100%;max-width:100%;box-sizing:border-box;overflow-x:hidden}.wh-shell,.wh-shell *{box-sizing:border-box}",
  ".wh-stage{width:100%;max-width:1040px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr);gap:20px;align-items:start;min-width:0}",
  // R10-S1 液态玻璃：panel 是玻璃层(带 backdrop-filter)；card 只做半透明白(不叠 blur——每页几十张卡
  // 逐卡 blur 会拖垮渲染,卡本就坐在玻璃 panel 上,视觉一致)。圆角分级 18/16/12。
  ".wh-panel{background:rgba(255,255,255,.62);backdrop-filter:saturate(1.45) blur(18px);-webkit-backdrop-filter:saturate(1.45) blur(18px);border:1px solid rgba(255,255,255,.72);border-radius:18px;box-shadow:0 18px 50px rgba(37,51,79,.08);min-width:0;max-width:100%}",
  ".wh-main{padding:24px;min-width:0}.wh-side{padding:18px;position:sticky;top:16px;min-width:0}.wh-kicker{font-size:12px;color:var(--blue);font-weight:700;text-transform:uppercase;letter-spacing:0}",
  ".wh-title{font-size:30px;line-height:1.35;margin:8px 0 8px;overflow-wrap:anywhere}.wh-subtle{color:var(--muted);line-height:1.55;overflow-wrap:anywhere}.wh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:14px;margin-top:18px;min-width:0;max-width:100%}",
  ".wh-settings-grid{grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr))}",
  ".wh-card{border:1px solid rgba(255,255,255,.75);background:rgba(255,255,255,.66);border-radius:16px;padding:16px;min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word;box-shadow:0 8px 26px rgba(37,51,79,.05)}.wh-card[data-recommended=true]{border-color:var(--blue);box-shadow:0 0 0 1px rgba(53,92,255,.2)}",
  ".wh-row{display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding:12px 0;min-width:0}.wh-row:first-child{border-top:0}.wh-row>div{min-width:0}.wh-row-meta{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:flex-start;min-width:0}.wh-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--soft);padding:5px 9px;font-size:12px;color:var(--muted);max-width:100%;white-space:normal;text-align:left;overflow-wrap:anywhere;word-break:break-word}",
  ".wh-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:12px;border:1px solid var(--line);padding:9px 12px;color:var(--ink);text-decoration:none;background:rgba(255,255,255,.92);font-weight:650}.wh-btn-primary{background:var(--blue);color:#fff;border-color:var(--blue)}.wh-btn-danger{background:#fff4f3;color:#a94137;border-color:#f3c5c0}.wh-btn[hidden]{display:none}",
  ".wh-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.wh-list{display:grid;gap:10px;margin-top:14px}.wh-check{display:grid;gap:4px;border-left:3px solid var(--green);padding-left:10px}.wh-warning{border-left-color:var(--amber)}",
  ".wh-patch{border:1px solid var(--line);border-radius:12px;background:#fbfcff;overflow:hidden;margin-top:10px}.wh-patch-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);background:#f8fbff}.wh-patch-meta{display:flex;gap:6px;flex-wrap:wrap}.wh-diff{margin:0;font-family:\"Cascadia Mono\",\"SFMono-Regular\",Consolas,monospace;font-size:12px;line-height:1.45;overflow:auto}.wh-diff-line{display:block;white-space:pre;padding:2px 12px}.wh-diff-line[data-patch-line-kind=add]{background:#ecfdf3;color:#11663b}.wh-diff-line[data-patch-line-kind=remove]{background:#fff1f0;color:#9d2f24}.wh-diff-line[data-patch-line-kind=meta]{background:#f1f5fb;color:var(--muted)}",
  ".wh-diff3{border:1px solid #d8e1f2;border-radius:12px;background:#f8fbff;padding:10px 12px;display:grid;gap:8px;margin-top:10px}.wh-diff3-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.wh-diff3-meta{display:flex;gap:6px;flex-wrap:wrap}.wh-diff3-ranges{margin:0;color:var(--muted);font-size:13px}",
  ".wh-structured{border:1px solid #dfe6d8;border-radius:12px;background:#fbfff8;padding:10px 12px;display:grid;gap:8px;margin-top:10px}.wh-structured-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.wh-structured-meta{display:flex;gap:6px;flex-wrap:wrap}.wh-structured-fields{margin:0;color:var(--muted);font-size:13px}",
  ".wh-field-details{border:1px solid #dfe6d8;border-radius:12px;background:#fffefa;padding:10px 12px;display:grid;gap:8px;margin-top:10px}.wh-field-list{display:grid;gap:8px}.wh-field-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;border-top:1px solid #e6ecd9;padding-top:8px}.wh-field-row:first-child{border-top:0;padding-top:0}.wh-field-row-meta{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-content:start}",
  ".wh-progress{height:8px;border-radius:999px;background:#e7ecf6;overflow:hidden}.wh-progress>span{display:block;height:100%;background:var(--blue)}",
  ".wh-desktop .wh-stage{max-width:660px;margin:0;grid-template-columns:1fr}.wh-desktop .wh-shell{background:linear-gradient(135deg,#edf6ff,#f8fbff)}",
  "@media (max-width:860px){.wh-stage{grid-template-columns:1fr}.wh-side{position:static}.wh-title{font-size:24px}.wh-row{flex-direction:column;align-items:flex-start}.wh-row-meta{justify-content:flex-start}}",
  // R10-S1 玻璃降级门（与 product-shell 同口径）。
  "@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.wh-panel{background:rgba(255,255,255,.95)}.wh-card{background:rgba(255,255,255,.97)}}",
  "@media (prefers-reduced-transparency:reduce){.wh-panel,.wh-card{background:#fff;backdrop-filter:none;-webkit-backdrop-filter:none}}"
].join("");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

// 外部/契约来源的 href 可能带 javascript:/data: → XSS。只放行相对路径与 http/https/mailto，其余拦成 "#"，再过 escapeHtml。
function href(value: string) {
  const v = String(value ?? "").trim();
  const safe = (v.startsWith("/") && !v.startsWith("//")) || /^(?:https?:|mailto:)/iu.test(v) ? v : "#";
  return escapeHtml(safe);
}

function approvalFactActionLabel(actionPattern: string, locale: WorkHubLocale) {
  const zh = locale === "zh-CN";
  const normalized = actionPattern.toLowerCase();
  if (normalized.startsWith("tool.")) {
    return zh ? "工具审批" : "Tool approval";
  }
  if (normalized.includes("permission") || normalized.includes("policy")) {
    return zh ? "权限审批" : "Permission approval";
  }
  if (normalized.includes("budget") || normalized.includes("cost")) {
    return zh ? "预算审批" : "Budget approval";
  }
  if (normalized.includes("proposal") || normalized.includes("deliverable") || normalized.includes("document")) {
    return zh ? "变更审批" : "Change approval";
  }
  return zh ? "审批请求" : "Approval request";
}

function approvalFactStatusLabel(status: string, locale: WorkHubLocale) {
  const zh = locale === "zh-CN";
  const labels: Record<string, [string, string]> = {
    approved: ["已通过", "Approved"],
    delegated: ["已转交", "Delegated"],
    denied: ["已打回", "Denied"],
    expired: ["已过期", "Expired"],
    pending: ["待处理", "Pending"]
  };
  const label = labels[status];
  return label ? (zh ? label[0] : label[1]) : (zh ? "状态待确认" : "Status pending review");
}

function approvalFactRouteLabel(routedToUserId: string | undefined, locale: WorkHubLocale) {
  if (!routedToUserId) {
    return t(locale, "approvals.unrouted");
  }
  return locale === "zh-CN" ? "已路由" : "Routed";
}

function formatApprovalFactTimestamp(iso: string | undefined) {
  if (!iso) {
    return "";
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u.exec(iso);
  return match ? `${match[1]} ${match[2]}` : iso;
}

function t(locale: WorkHubLocale, key: GoldPathCopyKey) {
  return goldPathT(locale, key);
}

const pageTitles: Record<WorkHubLocale, Record<GoldPathRenderedPage["key"], string>> = {
  "zh-CN": {
    home: "AI 优先首页",
    projects: "项目",
    "project-home": "项目主页",
    "project-timeline": "时间线",
    intake: "选项接入",
    approvals: "审批中心",
    workitem: "任务详情",
    proposal: "变更申请",
    conversation: "会话镜像",
    drive: "项目网盘",
    meetings: "会议洞察",
    notifications: "通知中心",
    calendar: "日程",
    health: "项目健康",
    replay: "执行回放",
    cost: "成本看板",
    agents: "智能代理军团",
    knowledge: "证据检索",
    search: "搜索",
    skills: "团队技能",
    settings: "设置",
    memory: "记忆管理"
  },
  "en-US": {
    home: "AI-first Home",
    projects: "Projects",
    "project-home": "Project Home",
    "project-timeline": "Timeline",
    intake: "Option Intake",
    approvals: "Approval Center",
    workitem: "WorkItem Detail",
    proposal: "Proposal Detail",
    conversation: "Conversation Mirror",
    drive: "Project Drive",
    meetings: "Meeting Insights",
    notifications: "Notifications",
    calendar: "Calendar",
    health: "Project Health",
    replay: "Replay Work",
    cost: "Cost Dashboard",
    agents: "Agent Army",
    knowledge: "Evidence Search",
    search: "Search",
    skills: "Team Skills",
    settings: "Settings",
    memory: "Memory"
  }
};

function pageTitle(locale: WorkHubLocale, key: GoldPathRenderedPage["key"]) {
  return pageTitles[locale][key];
}

function actionHref(action: AttentionAction | ActionSpec) {
  return action.href;
}

function actions(actions: (AttentionAction | ActionSpec)[]) {
  return `<div class="wh-actions">${actions
    .map((action, index) => {
      const style =
        "style" in action && action.style === "danger"
          ? "wh-btn wh-btn-danger"
          : index === 0
            ? "wh-btn wh-btn-primary"
            : "wh-btn";
      const reason = action.requires_reason ? " data-requires-reason=\"true\"" : "";
      const method = "method" in action ? ` data-method="${escapeHtml(action.method)}"` : "";
      return `<a class="${style}" href="${href(actionHref(action))}" data-action-id="${escapeHtml(action.id)}"${reason}${method}>${escapeHtml(action.label)}</a>`;
    })
    .join("")}</div>`;
}

function mergeOptionLabel(locale: WorkHubLocale, optionKey: string) {
  if (optionKey === "keep_current") {
    return t(locale, "replay.keepCurrent");
  }
  if (optionKey === "accept_incoming") {
    return t(locale, "replay.acceptIncoming");
  }
  if (optionKey === "ai_fusion") {
    return t(locale, "replay.aiFusion");
  }
  return optionKey;
}

function mergeAttemptLabel(locale: WorkHubLocale, result: string) {
  if (result === "conflict") {
    return t(locale, "replay.decisionConflict");
  }
  if (result === "merged") {
    return t(locale, "replay.decisionMerged");
  }
  return t(locale, "replay.decisionFallback");
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

function renderStructuredRecordPatch(candidate: ReplayMergeCandidateVM, locale: WorkHubLocale) {
  const patch = objectRecord(candidate.quality_gate?.["structured_record_patch"]);
  if (patch?.["type"] !== "structured_record_field_patch") {
    return "";
  }
  const changedFields = stringArrayField(patch, "changed_fields");
  const mergedFields = stringArrayField(patch, "merged_value_fields");
  const missingFields = stringArrayField(patch, "missing_fields");
  const unknownFields = stringArrayField(patch, "unknown_fields");
  const fieldCount = numberField(patch, "field_count");
  const dryRun = objectRecord(patch["structured_field_patch_dry_run"]);
  const dryRunStatus = typeof dryRun?.["status"] === "string" ? dryRun["status"] : "";
  const dryRunIssueCount = Array.isArray(dryRun?.["issues"]) ? dryRun["issues"].length : 0;
  const mergedLine = mergedFields.length > 0
    ? `<p class="wh-structured-fields">${escapeHtml(t(locale, "replay.structuredPatchFields"))}: ${escapeHtml(compactFieldList(mergedFields))}</p>`
    : "";
  const missingLine = missingFields.length > 0
    ? `<p class="wh-structured-fields">${escapeHtml(t(locale, "replay.structuredPatchMissing"))}: ${escapeHtml(compactFieldList(missingFields))}</p>`
    : "";
  const unknownLine = unknownFields.length > 0
    ? `<p class="wh-structured-fields">${escapeHtml(t(locale, "replay.structuredPatchUnknown"))}: ${escapeHtml(compactFieldList(unknownFields))}</p>`
    : "";
  const dryRunLine = dryRunStatus
    ? `<p class="wh-structured-fields">${escapeHtml(t(locale, "replay.structuredPatchDryRun"))}: ${escapeHtml(dryRunStatusLabel(locale, dryRunStatus))} · ${escapeHtml(t(locale, "replay.structuredPatchIssues"))}: ${escapeHtml(String(dryRunIssueCount))}</p>`
    : "";
  const operationDetails = renderStructuredFieldOperationDetails({
    operations: objectRecord(dryRun?.["patch"])?.["operations"],
    locale,
    surface: "replay"
  });
  return `<section class="wh-structured" data-replay-structured-record-patch="true" data-structured-patch-option-key="${escapeHtml(candidate.option_key)}" data-structured-patch-field-count="${escapeHtml(String(fieldCount))}" data-structured-patch-has-result="${escapeHtml(String(patch["has_structured_result"] === true))}" data-structured-patch-dry-run-status="${escapeHtml(dryRunStatus)}" data-structured-patch-dry-run-issues="${escapeHtml(String(dryRunIssueCount))}">
    <div class="wh-structured-head">
      <strong>${escapeHtml(t(locale, "replay.structuredPatchTitle"))}</strong>
      <span class="wh-pill">${escapeHtml(String(fieldCount))}</span>
    </div>
    <div class="wh-structured-meta">
      <span class="wh-pill">${escapeHtml(t(locale, "replay.structuredPatchChanged"))}: ${escapeHtml(String(changedFields.length))}</span>
      <span class="wh-pill">${escapeHtml(t(locale, "replay.structuredPatchMissing"))}: ${escapeHtml(String(missingFields.length))}</span>
      <span class="wh-pill">${escapeHtml(t(locale, "replay.structuredPatchUnknown"))}: ${escapeHtml(String(unknownFields.length))}</span>
    </div>
    ${dryRunLine}${mergedLine}${missingLine}${unknownLine}${operationDetails}
  </section>`;
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
  const currentHunks = numberField(diff3, "current_hunks");
  const incomingHunks = numberField(diff3, "incoming_hunks");
  const conflictHunks = numberField(diff3, "conflict_hunks");
  const ranges = textDiff3RangeValues(diff3["conflict_ranges"]);
  const rangeData = ranges.map((range) => range.start === range.end ? String(range.start) : `${range.start}-${range.end}`).join(",");
  const rangeLabels = ranges.map((range) => textDiff3RangeLabel(locale, range.start, range.end)).join(", ");
  const modeLabel = autoMerge ? t(locale, "replay.diff3Auto") : t(locale, "replay.diff3Review");
  const rangeLine = rangeLabels
    ? `<p class="wh-diff3-ranges">${escapeHtml(t(locale, "replay.diff3Ranges"))}: ${escapeHtml(rangeLabels)}</p>`
    : "";
  return `<section class="wh-diff3" data-replay-text-diff3="true" data-text-diff3-option-key="${escapeHtml(candidate.option_key)}" data-text-diff3-auto-merge="${escapeHtml(String(autoMerge))}" data-text-diff3-conflict-hunks="${escapeHtml(String(conflictHunks))}" data-text-diff3-conflict-ranges="${escapeHtml(rangeData)}">
    <div class="wh-diff3-head">
      <strong>${escapeHtml(t(locale, "replay.diff3Title"))}</strong>
      <span class="wh-pill">${escapeHtml(modeLabel)}</span>
    </div>
    <div class="wh-diff3-meta">
      <span class="wh-pill">${escapeHtml(t(locale, "replay.diff3Current"))}: ${escapeHtml(String(currentHunks))}</span>
      <span class="wh-pill">${escapeHtml(t(locale, "replay.diff3Incoming"))}: ${escapeHtml(String(incomingHunks))}</span>
      <span class="wh-pill">${escapeHtml(t(locale, "replay.diff3Conflict"))}: ${escapeHtml(String(conflictHunks))}</span>
    </div>
    ${rangeLine}
  </section>`;
}

function patchRiskLabel(locale: WorkHubLocale, risk: string) {
  if (risk === "low") {
    return t(locale, "replay.patchRiskLow");
  }
  if (risk === "requires_review") {
    return t(locale, "replay.patchRiskReview");
  }
  return t(locale, "replay.patchRiskUnknown");
}

function patchLineKind(line: string) {
  if (line.startsWith("+")) {
    return "add";
  }
  if (line.startsWith("-")) {
    return "remove";
  }
  if (line.startsWith("@@")) {
    return "meta";
  }
  return "context";
}

function renderTextPatchPreview(candidate: ReplayMergeCandidateVM, locale: WorkHubLocale) {
  const preview = objectRecord(candidate.quality_gate?.["text_patch_preview"]);
  if (preview?.["type"] !== "unified_text_patch_preview") {
    return "";
  }
  const stats = objectRecord(preview["stats"]);
  const hunks = Array.isArray(preview["hunks"]) ? preview["hunks"] : [];
  const risk = typeof stats?.["overlap_risk"] === "string" ? stats["overlap_risk"] : "unknown";
  const changed = stats?.["changed"] === false ? t(locale, "replay.patchUnchanged") : t(locale, "replay.patchChanged");
  const added = typeof stats?.["added_lines"] === "number" ? stats["added_lines"] : 0;
  const removed = typeof stats?.["removed_lines"] === "number" ? stats["removed_lines"] : 0;
  const base = preview["base_available"] === true
    ? t(locale, "replay.patchBaseAvailable")
    : t(locale, "replay.patchBaseMissing");
  const hunkLines = hunks.flatMap((hunk) => {
    const record = objectRecord(hunk);
    const header = typeof record?.["header"] === "string" ? [record["header"]] : [];
    const lines = Array.isArray(record?.["lines"])
      ? record["lines"].filter((line): line is string => typeof line === "string")
      : [];
    return [...header, ...lines];
  });
  if (hunkLines.length === 0) {
    return "";
  }
  const diffLines = hunkLines
    .map((line) => `<span class="wh-diff-line" data-patch-line-kind="${escapeHtml(patchLineKind(line))}">${escapeHtml(line)}</span>`)
    .join("");
  return `<section class="wh-patch" data-replay-text-patch-preview="true" data-overlap-risk="${escapeHtml(risk)}">
    <div class="wh-patch-head">
      <strong>${escapeHtml(t(locale, "replay.patchTitle"))}</strong>
      <div class="wh-patch-meta">
        <span class="wh-pill">${escapeHtml(changed)}</span>
        <span class="wh-pill">+${escapeHtml(String(added))} / -${escapeHtml(String(removed))}</span>
        <span class="wh-pill">${escapeHtml(patchRiskLabel(locale, risk))}</span>
        <span class="wh-pill">${escapeHtml(base)}</span>
      </div>
    </div>
    <pre class="wh-diff">${diffLines}</pre>
  </section>`;
}

function pageShell(surface: GoldPathRenderSurface, title: string, main: string) {
  const surfaceClass = surface === "desktop" ? "wh-desktop" : "wh-web";
  return `<div class="${surfaceClass}"><main class="wh-shell"><div class="wh-stage"><section class="wh-panel wh-main">${main}</section></div></main></div>`;
}

function renderHome(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM, locale: WorkHubLocale): GoldPathRenderedPage {
  const page = vm.page_vms.attention;
  const primary = page.primary;
  const runs = page.background_runs;
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "home.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(primary?.title ?? t(locale, "home.emptyTitle"))}</h1>
    <p class="wh-subtle">${escapeHtml(primary?.summary_text ?? t(locale, "home.emptySummary"))}</p>
    ${primary ? actions(primary.actions) : ""}
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(t(locale, "home.decisionTitle"))}</strong><p class="wh-subtle">${escapeHtml(primary ? primary.reason_text ?? primary.summary_text : t(locale, "home.decisionEmpty"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "home.aiWorkingTitle"))}</strong><p class="wh-subtle">${escapeHtml(runs[0]?.preview_text ?? t(locale, "home.aiWorkingEmpty"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "home.entryTitle"))}</strong><p class="wh-subtle">${escapeHtml(t(locale, "home.entryText"))}</p></article>
    </div>`;
  return {
    key: "home",
    route: vm.routes.home,
    title: pageTitle(locale, "home"),
    html: pageShell(surface, pageTitle(locale, "home"), main),
    primaryHrefs: primary?.actions.map((action) => action.href) ?? [],
    cuuState: page.cuu_state
  };
}

function renderIntake(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM, locale: WorkHubLocale): GoldPathRenderedPage {
  const question: QuestionCard = vm.page_vms.question;
  const optionCards = question.options
    .map((option) => {
      const recommended = question.recommended_option_ids?.includes(option.id) ?? false;
      return `<button class="wh-card" data-option-id="${escapeHtml(option.id)}" data-recommended="${recommended}" type="button">
        <strong>${escapeHtml(option.label)}</strong>
        <p class="wh-subtle">${escapeHtml(option.description ?? option.impact ?? "")}</p>
        ${recommended ? `<span class="wh-pill">${escapeHtml(t(locale, "intake.recommended"))}</span>` : ""}
      </button>`;
    })
    .join("");
  const done = question.progress.filter((item) => item.state === "done").length;
  const progress = Math.round((done / Math.max(question.progress.length, 1)) * 100);
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "intake.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(question.title)}</h1>
    <p class="wh-subtle">${escapeHtml(question.body ?? t(locale, "intake.bodyFallback"))}</p>
    <div class="wh-progress" aria-label="${escapeHtml(t(locale, "intake.progressLabel"))}"><span style="width:${progress}%"></span></div>
    <div class="wh-grid">${optionCards}</div>
    <details class="wh-card" ${question.free_text.collapsed_by_default ? "" : "open"}>
      <summary>${escapeHtml(t(locale, "intake.otherSummary"))}</summary>
      <p class="wh-subtle">${escapeHtml(question.free_text.placeholder ?? t(locale, "intake.freeTextFallback"))}</p>
    </details>
    <div class="wh-actions"><a class="wh-btn wh-btn-primary" href="${href(question.submit.href)}">${escapeHtml(t(locale, "intake.continue"))}</a></div>`;
  return {
    key: "intake",
    route: vm.routes.intake,
    title: pageTitle(locale, "intake"),
    html: pageShell(surface, pageTitle(locale, "intake"), main),
    primaryHrefs: [question.submit.href],
    cuuState: "asking_approval"
  };
}

function renderApprovals(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM, locale: WorkHubLocale): GoldPathRenderedPage {
  const approvals: ApprovalCenterVM = vm.page_vms.approvals;
  const primary = approvals.items[0];
  const request = approvals.requests[0];
  const pageInfoNote = approvalQueuePageInfoText(locale, approvals.page_info, approvals.counts);
  const pageInfoAttrs = approvals.page_info
    ? ` data-r4-approval-page-info="true" data-r4-approval-page-limit="${escapeHtml(String(approvals.page_info.limit))}" data-r4-approval-page-returned="${escapeHtml(String(approvals.page_info.returned))}" data-r4-approval-page-has-more="${escapeHtml(String(approvals.page_info.has_more))}"`
    : "";
  const requestRows = approvals.requests
    .map(
      (item) =>
        `<div class="wh-row"><div><strong>${escapeHtml(approvalFactActionLabel(item.action_pattern, locale))}</strong><p class="wh-subtle">${escapeHtml(approvalFactStatusLabel(item.status, locale))}${item.sla_due_at ? ` · SLA ${escapeHtml(formatApprovalFactTimestamp(item.sla_due_at))}` : ""}</p></div><span class="wh-pill">${escapeHtml(approvalFactRouteLabel(item.routed_to_user_id, locale))}</span></div>`
    )
    .join("");
  const queueCards = approvals.items
    .map(
      (item) =>
        `<article class="wh-card"><span class="wh-pill">${escapeHtml(item.priority)}</span><h3>${escapeHtml(item.title)}</h3><p class="wh-subtle">${escapeHtml(item.summary_text)}</p>${actions(item.actions)}</article>`
    )
    .join("");
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "approvals.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(primary?.title ?? t(locale, "approvals.emptyTitle"))}</h1>
    <p class="wh-subtle">${escapeHtml(primary?.reason_text ?? t(locale, "approvals.reasonFallback"))}</p>
    ${pageInfoNote ? `<p class="wh-subtle"${pageInfoAttrs}>${escapeHtml(pageInfoNote)}</p>` : ""}
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(t(locale, "approvals.pendingTitle"))}</strong><p class="wh-subtle">${approvals.counts.pending ?? approvals.items.length}${escapeHtml(t(locale, "approvals.pendingUnit"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "approvals.slaTitle"))}</strong><p class="wh-subtle">${escapeHtml(formatApprovalFactTimestamp(request?.sla_due_at) || t(locale, "approvals.slaEmpty"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "approvals.ruleTitle"))}</strong><p class="wh-subtle">${escapeHtml(t(locale, "approvals.ruleText"))}</p></article>
    </div>
    <div class="wh-list">${queueCards}</div>
    <h2>${escapeHtml(t(locale, "approvals.factsTitle"))}</h2><div class="wh-card">${requestRows}</div>`;
  return {
    key: "approvals",
    route: vm.routes.approvals,
    title: pageTitle(locale, "approvals"),
    html: pageShell(surface, pageTitle(locale, "approvals"), main),
    primaryHrefs: primary?.actions.map((action) => action.href) ?? [],
    cuuState: "asking_approval"
  };
}

function renderWorkItem(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM, locale: WorkHubLocale): GoldPathRenderedPage {
  const detail = vm.page_vms.workitem;
  const steps = detail.agent_trace_preview
    .map((step) => `<div class="wh-row"><div><strong>${escapeHtml(agentStepPhaseLabel(locale, step.phase))}</strong><p class="wh-subtle">${escapeHtml(agentStepPublicSummary(locale, step))}</p></div><span class="wh-pill">#${step.step_no}</span></div>`)
    .join("");
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "workitem.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(detail.workitem.title ?? detail.workitem.code)}</h1>
    <p class="wh-subtle">${escapeHtml(detail.workitem.summary_md ?? detail.workitem.raw_description ?? "")}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(t(locale, "workitem.statusTitle"))}</strong><p class="wh-subtle">${escapeHtml(workItemStatusLabel(locale, detail.workitem.status))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "workitem.deliverableTitle"))}</strong><p class="wh-subtle">${escapeHtml(detail.latest_proposal?.title ?? t(locale, "workitem.emptyDeliverable"))}</p></article>
    </div>
    <h2>${escapeHtml(t(locale, "workitem.traceTitle"))}</h2><div class="wh-card">${steps}</div>
    <div class="wh-actions"><a class="wh-btn wh-btn-primary" href="${href(vm.routes.proposal)}">${escapeHtml(t(locale, "workitem.openProposal"))}</a><a class="wh-btn" href="${href(vm.routes.replay)}">${escapeHtml(t(locale, "workitem.openReplay"))}</a></div>`;
  return {
    key: "workitem",
    route: vm.routes.workitem,
    title: pageTitle(locale, "workitem"),
    html: pageShell(surface, pageTitle(locale, "workitem"), main),
    primaryHrefs: [vm.routes.proposal, vm.routes.replay],
    cuuState: "thinking"
  };
}

function changeRow(change: DeliverableChange, locale: WorkHubLocale) {
  return `<div class="wh-row"><div><strong>${escapeHtml(change.human_summary)}</strong><p class="wh-subtle">${escapeHtml(change.target_ref.path ?? change.target_kind)}</p></div><div class="wh-row-meta"><span class="wh-pill">${escapeHtml(deliverableTargetLabel(locale, change.target_kind))}</span></div></div>`;
}

function checkRow(check: DeliverableCheck, locale: WorkHubLocale) {
  const className = check.status === "warning" ? "wh-check wh-warning" : "wh-check";
  return `<div class="${className}"><strong>${escapeHtml(check.label)}</strong><span class="wh-subtle">${escapeHtml(checkStatusLabel(locale, check.status))}${check.detail ? ` · ${escapeHtml(check.detail)}` : ""}</span></div>`;
}

function renderProposal(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM, locale: WorkHubLocale): GoldPathRenderedPage {
  const proposal = vm.page_vms.proposal;
  const manifest: DeliverableChangeManifest = proposal.manifest;
  const proposalActions = proposal.status === "opened"
    ? [
      proposal.review_actions.approve,
      proposal.review_actions.request_changes
    ]
    : proposal.status === "reviewed" && proposal.review_actions.merge
      ? [proposal.review_actions.merge]
      : [];
  const displayTitle = publicProposalDisplayTitle(proposal.title, locale);
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "proposal.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(displayTitle)}</h1>
    <p class="wh-subtle">${escapeHtml(manifest.summary_md.replace(/[#*_`-]/gu, " ").slice(0, 220))}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(t(locale, "proposal.riskTitle"))}</strong><p class="wh-subtle">${escapeHtml(manifest.risk.human_label)}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "proposal.rollbackTitle"))}</strong><p class="wh-subtle">${escapeHtml(manifest.rollback.description)}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "proposal.evidenceTitle"))}</strong><p class="wh-subtle">${manifest.evidence_refs.length}${escapeHtml(t(locale, "proposal.evidenceUnit"))}</p></article>
    </div>
    <h2>${escapeHtml(t(locale, "proposal.changedTitle"))}</h2><div class="wh-card">${manifest.changes.map((change) => changeRow(change, locale)).join("")}</div>
    <h2>${escapeHtml(t(locale, "proposal.checksTitle"))}</h2><div class="wh-list">${manifest.checks.map((check) => checkRow(check, locale)).join("")}</div>
    ${actions(proposalActions)}`;
  return {
    key: "proposal",
    route: vm.routes.proposal,
    title: pageTitle(locale, "proposal"),
    html: pageShell(surface, pageTitle(locale, "proposal"), main),
    primaryHrefs: proposalActions.map((action) => action.href),
    cuuState: "carrying_document"
  };
}

function renderReplay(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM, locale: WorkHubLocale): GoldPathRenderedPage {
  const replay: ReplayTraceVM = vm.page_vms.replay;
  const steps = replay.steps
    .map((step) => `<div class="wh-row"><div><strong>${escapeHtml(agentStepPhaseLabel(locale, step.phase))}</strong><p class="wh-subtle">${escapeHtml(agentStepPublicSummary(locale, step))}</p></div><span class="wh-pill">#${escapeHtml(String(step.step_no))}</span></div>`)
    .join("");
  const acceptedDeliverables = replay.accepted_deliverables ?? [];
  const deliverableHrefs = acceptedDeliverables
    .flatMap((item) => [item.preview_href, item.download_href, item.restore_href])
    .filter((item): item is string => Boolean(item));
  const deliverableCards = acceptedDeliverables
    .map((item) => {
      const actionsHtml = [
        item.preview_href
          ? `<a class="wh-btn" href="${href(item.preview_href)}">${escapeHtml(t(locale, "replay.previewDeliverable"))}</a>`
          : "",
        item.download_href
          ? `<a class="wh-btn wh-btn-primary" href="${href(item.download_href)}">${escapeHtml(t(locale, "replay.openDeliverable"))}</a>`
          : "",
        item.restore_href
          ? `<a class="wh-btn wh-btn-danger" href="${href(item.restore_href)}" data-action-id="restore_deliverable" data-method="POST">${escapeHtml(t(locale, "replay.restoreDeliverable"))}</a>`
          : ""
      ].filter(Boolean).join("");
      return `<article class="wh-card"><strong>${escapeHtml(item.filename ?? item.target_key)}</strong><p class="wh-subtle">${escapeHtml(item.target_path ?? item.target_key)}</p>${actionsHtml ? `<div class="wh-actions">${actionsHtml}</div>` : ""}</article>`;
    })
    .join("");
  const mergeTimeline = replay.merge_timeline ?? [];
  const mergeDecisionCards = mergeTimeline
    .map((attempt) => {
      const decisions = attempt.decisions.length
        ? attempt.decisions
          .map((decision) => {
            const candidateRows = decision.candidates.length
              ? decision.candidates
                .map((candidate) => {
                  const badges = [
                    candidate.recommended ? t(locale, "replay.recommended") : "",
                    candidate.chosen ? t(locale, "replay.chosen") : ""
                  ].filter(Boolean).join(" · ");
                  return `<div class="wh-row"><div><strong>${escapeHtml(mergeOptionLabel(locale, candidate.option_key))}</strong><p class="wh-subtle">${escapeHtml(candidate.rationale_md ?? candidate.option_key)}</p>${renderTextPatchPreview(candidate, locale)}${renderTextDiff3QualityGate(candidate, locale)}${renderStructuredRecordPatch(candidate, locale)}</div>${badges ? `<span class="wh-pill">${escapeHtml(badges)}</span>` : ""}</div>`;
                })
                .join("")
              : `<p class="wh-subtle">${escapeHtml(t(locale, "replay.noChoice"))}</p>`;
            const chosenLabel = decision.chosen_option_key
              ? mergeOptionLabel(locale, decision.chosen_option_key)
              : t(locale, "replay.noChoice");
            const chosenBadge = decision.chosen_option_key ? t(locale, "replay.chosen") : t(locale, "replay.noChoice");
            return `<div class="wh-list" data-replay-merge-decision="${escapeHtml(decision.id)}"><div class="wh-row"><div><strong>${escapeHtml(decision.conflict_key)}</strong><p class="wh-subtle">${escapeHtml(chosenLabel)}</p></div><span class="wh-pill">${escapeHtml(chosenBadge)}</span></div>${candidateRows}</div>`;
          })
          .join("")
        : `<p class="wh-subtle">${escapeHtml(t(locale, "replay.noChoice"))}</p>`;
      const targetSummary = attempt.target_keys.length > 0 ? attempt.target_keys.join(", ") : attempt.id;
      const createdLabel = formatApprovalFactTimestamp(attempt.created_at);
      return `<article class="wh-card" data-replay-merge-attempt="${escapeHtml(attempt.id)}" data-replay-merge-result="${escapeHtml(attempt.result)}"><strong>${escapeHtml(mergeAttemptLabel(locale, attempt.result))}</strong><p class="wh-subtle">${escapeHtml(targetSummary)}</p><div class="wh-actions"><span class="wh-pill">${escapeHtml(String(attempt.conflict_count))}</span><span class="wh-pill">${escapeHtml(createdLabel)}</span></div>${decisions}</article>`;
    })
    .join("");
  const structuredAuditCards = renderStructuredFieldAuditDetails({
    auditLogs: replay.audit_logs ?? [],
    locale,
    surface: "replay"
  });
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "replay.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(t(locale, "replay.title"))}</h1>
    <p class="wh-subtle">${escapeHtml(replay.run.handoff_md ?? replay.run.outcome_reason ?? t(locale, "replay.empty"))}</p>
    <div class="wh-card">${steps}</div>
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(t(locale, "replay.tokenTitle"))}</strong><p class="wh-subtle">${replay.cost?.me.total_tokens ?? 0}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "replay.costTitle"))}</strong><p class="wh-subtle">${escapeHtml(uiFormatCny(replay.cost?.me.estimated_cost_cny ?? "0", locale))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "replay.snapshotTitle"))}</strong><p class="wh-subtle">${replay.snapshots.length}${escapeHtml(t(locale, "replay.snapshotUnit"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "replay.deliverableTitle"))}</strong><p class="wh-subtle">${acceptedDeliverables.length}${escapeHtml(t(locale, "replay.deliverableUnit"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "replay.decisionTitle"))}</strong><p class="wh-subtle">${mergeTimeline.length}${escapeHtml(t(locale, "replay.decisionUnit"))}</p></article>
    </div>
    ${deliverableCards ? `<h2>${escapeHtml(t(locale, "replay.deliverableTitle"))}</h2><div class="wh-list">${deliverableCards}</div>` : ""}
    ${mergeDecisionCards ? `<h2>${escapeHtml(t(locale, "replay.decisionTitle"))}</h2><div class="wh-list">${mergeDecisionCards}</div>` : ""}
    ${structuredAuditCards ? `<h2>${escapeHtml(t(locale, "replay.structuredPatchTitle"))}</h2>${structuredAuditCards}` : ""}`;
  return {
    key: "replay",
    route: vm.routes.replay,
    title: pageTitle(locale, "replay"),
    html: pageShell(surface, pageTitle(locale, "replay"), main),
    primaryHrefs: deliverableHrefs,
    cuuState: "thinking"
  };
}

function renderCost(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM, locale: WorkHubLocale): GoldPathRenderedPage {
  const cost = vm.page_vms.cost;
  const noticeCards = cost.notices.map((notice) => `<article class="wh-card"><strong>${escapeHtml(budgetStatusLabel(locale, notice.severity))}</strong><p class="wh-subtle">${escapeHtml(notice.message)}</p></article>`).join("");
  const nearestRisk = cost.top_exhaustion_risks[0];
  const zh = locale === "zh-CN";
  // K5 对齐:把「干活 vs 自进化（夜间技能蒸馏）」分账显性化（与 web cost labor_split 一致）。仅有账目时显示。
  const laborSplit = cost.labor_split;
  const laborCard = laborSplit
    ? `<article class="wh-card" data-r8-cost-labor-split="true" data-r8-cost-self-improvement-ratio="${escapeHtml(String(laborSplit.self_improvement_ratio))}"><strong>${escapeHtml(zh ? "干活 vs 自进化" : "Work vs self-improvement")}</strong><p class="wh-subtle">${escapeHtml(`${zh ? "干活" : "Production"} ${uiFormatCny(laborSplit.production_cost_cny, locale)} · ${zh ? "自进化" : "Self-improvement"} ${uiFormatCny(laborSplit.self_improvement_cost_cny, locale)}（${Math.round(laborSplit.self_improvement_ratio * 100)}%）`)}</p></article>`
    : "";
  const statusText = nearestRisk
    ? budgetStatusLabel(locale, nearestRisk.status)
    : cost.empty_state ?? t(locale, "cost.statusFallback");
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "cost.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(t(locale, "cost.title"))}</h1>
    <p class="wh-subtle">${escapeHtml(t(locale, "cost.summary"))}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(t(locale, "cost.tokenTitle"))}</strong><p class="wh-subtle">${cost.token_in + cost.token_out}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "cost.estimatedTitle"))}</strong><p class="wh-subtle">${escapeHtml(uiFormatCny(cost.total_cost_cny, locale))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "cost.statusTitle"))}</strong><p class="wh-subtle">${escapeHtml(statusText)}</p></article>
    </div>
    ${laborCard ? `<div class="wh-list">${laborCard}</div>` : ""}
    <div class="wh-list">${noticeCards}</div>`;
  return {
    key: "cost",
    route: vm.routes.cost,
    title: pageTitle(locale, "cost"),
    html: pageShell(surface, pageTitle(locale, "cost"), main),
    primaryHrefs: [],
    cuuState: "worried"
  };
}

function renderKnowledge(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM, locale: WorkHubLocale): GoldPathRenderedPage {
  const evidence = vm.page_vms.evidence;
  const refs = evidence.evidence_refs ?? [];
  const actions = evidence.actions ?? [];
  const title = locale === "zh-CN" ? "证据检索" : "Evidence search";
  const summary = evidence.summary_text;
  const rows = refs.length
    ? refs.slice(0, 5).map((ref) => `<div class="wh-row">
      <div>
        <strong>${escapeHtml(ref.title)}</strong>
        <p class="wh-subtle">${escapeHtml(ref.excerpt ?? ref.source_id)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(ref.source_type)}</span>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(evidence.missing_evidence_note ?? (locale === "zh-CN" ? "没有找到可靠证据。" : "No reliable evidence found."))}</p>`;
  const actionButtons = actions
    .map((action) => action.href ? `<a class="wh-btn" href="${href(action.href)}">${escapeHtml(action.label)}</a>` : "")
    .join("");
  const main = `<span class="wh-kicker">${escapeHtml(locale === "zh-CN" ? "知识库" : "Knowledge")}</span>
    <h1 class="wh-title">${escapeHtml(title)}</h1>
    <p class="wh-subtle">${escapeHtml(summary)}</p>
    <div class="wh-list">${rows}</div>
    <div class="wh-actions">${actionButtons}</div>`;
  return {
    key: "knowledge",
    route: vm.routes.knowledge,
    title: pageTitle(locale, "knowledge"),
    html: pageShell(surface, pageTitle(locale, "knowledge"), main),
    primaryHrefs: actions.map((action) => action.href).filter((value): value is string => Boolean(value)),
    cuuState: "searching_evidence"
  };
}

function renderSettings(surface: GoldPathRenderSurface, locale: WorkHubLocale): GoldPathRenderedPage {
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "settings.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(t(locale, "settings.title"))}</h1>
    <p class="wh-subtle">${escapeHtml(t(locale, "settings.summary"))}</p>
    <div class="wh-grid wh-settings-grid">
      <article class="wh-card"><strong>${escapeHtml(t(locale, "settings.runtimeTitle"))}</strong><p class="wh-subtle">${escapeHtml(t(locale, "settings.runtimeBody"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "settings.desktopTitle"))}</strong><p class="wh-subtle">${escapeHtml(t(locale, "settings.desktopBody"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "settings.costTitle"))}</strong><p class="wh-subtle">${escapeHtml(t(locale, "settings.costBody"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "settings.languageTitle"))}</strong><p class="wh-subtle">${escapeHtml(t(locale, "settings.languageBody"))}</p></article>
    </div>`;
  return {
    key: "settings",
    route: "/settings",
    title: pageTitle(locale, "settings"),
    html: pageShell(surface, pageTitle(locale, "settings"), main),
    primaryHrefs: [],
    cuuState: "idle"
  };
}

export function renderGoldPathSurface(
  vm: GoldPathSurfaceVM,
  surface: GoldPathRenderSurface,
  options: GoldPathRenderOptions = {}
): GoldPathRenderedSurface {
  const locale = normalizeWorkHubLocale(options.locale);
  return {
    surface,
    fixtureId: vm.fixture_id,
    vm,
    css: goldPathCss,
    pages: [
      renderHome(surface, vm, locale),
      renderIntake(surface, vm, locale),
      renderApprovals(surface, vm, locale),
      renderWorkItem(surface, vm, locale),
      renderProposal(surface, vm, locale),
      renderReplay(surface, vm, locale),
      renderCost(surface, vm, locale),
      renderKnowledge(surface, vm, locale),
      renderSettings(surface, locale)
    ]
  };
}
