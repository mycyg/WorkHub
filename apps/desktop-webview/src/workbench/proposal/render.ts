// WorkHub 桌面 · 工作台右栏「情境面板」的提议详情内容渲染（纯 HTML 拼装，可单测——照 army/render.ts、
// drive/render.ts 的分工：这里全部无副作用，imperative 的 DOM 挂载/事件绑定/网络在 panel.ts）。
//
// CSS 铁律（06 设计 §1.4）：工作台窗口只含 appleGlassDesignSystemCss + workbenchCss（wh-wb-*），没有
// spotlight 的 wh-spot-* 样式。所以这里绝不 import spotlight 的 detailHtml（那是 wh-spot 渲染），而是用
// 全新的 wh-wb-prop-* 类原生重写一份详情模板，复用的只有 ProposalDetailVM 数据形状 + @workhub/ui/proposal
// 的去黑话纯函数（publicProposalDisplayTitle / publicProposalSummaryText）。视觉语言对齐 drive/army 侧栏。

import { WorkHubApiError } from "@workhub/api-client";
import type { DeliverableChange, ProposalDetailVM } from "@workhub/contracts";
import { publicProposalDisplayTitle, publicProposalSummaryText } from "@workhub/ui/proposal";
import { conflictsFromMergeError, escapeHtml } from "@workhub/web-runtime";

import { proposalT } from "./locales.js";

type Locale = "zh-CN" | "en-US";

// 通过/打回/合入网络往返失败后的面板内联温和话术分类（06 §5.4）——纯数据，交给 render 拼成 notice 块。
export type ProposalActionNotice = {
  // permission = 403（不归你审）；conflict = 409（撞车，降级到审批工作台）；network = 其它/网络（可重试）。
  tone: "permission" | "conflict" | "network";
  text: string;
  // network 类才给「重试」——重发同一动作；permission/conflict 无重试（换人/换工作台，不是重试能解决的）。
  retry?: "approve" | "deny" | "merge";
};

// 右栏详情态的瞬态 UI 叠加（busy/理由器展开/内联温和话术）——与 vm 分开，好在动作往返/失败时只改这层。
export type ProposalDetailUiState = {
  busy?: "approve" | "deny" | "merge";
  // 「打回修改」点开后的理由器展开态。理由 textarea 的实时内容不进 state（进了就得每次击键重渲，光标会
  // 掉）——它是 DOM 瞬态，提交时由 panel.ts 从 DOM 直接读（照 spotlight createProposalsView 的既有取法）。
  reasonOpen?: boolean;
  notice?: ProposalActionNotice;
};

export type ProposalSidePanelState =
  | { mode: "loading" }
  | { mode: "error"; message: string; proposalId: string }
  | { mode: "detail"; vm: ProposalDetailVM; ui: ProposalDetailUiState };

const PROPOSAL_STATUS_LABEL: Record<string, [string, string]> = {
  opened: ["待审阅", "Open"],
  reviewed: ["已审阅", "Reviewed"],
  merged: ["已合并", "Merged"],
  rejected: ["已打回", "Rejected"]
};

export function proposalStatusLabel(status: string, zh: boolean): string {
  const entry = PROPOSAL_STATUS_LABEL[status];
  return entry ? (zh ? entry[0] : entry[1]) : status;
}

const CHANGE_TYPE_LABEL: Record<DeliverableChange["change_type"], [string, string]> = {
  created: ["新增", "Added"],
  updated: ["修改", "Updated"],
  deleted: ["删除", "Deleted"],
  renamed: ["重命名", "Renamed"],
  moved: ["移动", "Moved"],
  replaced: ["替换", "Replaced"],
  generated: ["生成", "Generated"]
};

function changeTypeLabel(changeType: DeliverableChange["change_type"], zh: boolean): string {
  const entry = CHANGE_TYPE_LABEL[changeType];
  return entry ? (zh ? entry[0] : entry[1]) : changeType;
}

// 一处变更的内联 diff 摘要（06 §4.1 diff 摘要）——before/after 摘录各一行（红删/绿增），复用产出物
// machine_summary 的既有摘录字段，没有摘录就不渲染空 diff 框（04 铁律 3）。
function changeRowHtml(change: DeliverableChange, zh: boolean): string {
  const path = change.target_ref.path ?? change.target_ref.entity_type;
  const before = change.machine_summary?.before_excerpt;
  const after = change.machine_summary?.after_excerpt;
  const diff =
    before || after
      ? `<div class="wh-wb-prop-diff">${
          before ? `<div class="wh-wb-prop-diff-line wh-wb-prop-diff-line--del">${escapeHtml(before)}</div>` : ""
        }${after ? `<div class="wh-wb-prop-diff-line wh-wb-prop-diff-line--add">${escapeHtml(after)}</div>` : ""}</div>`
      : "";
  return `<div class="wh-wb-prop-change">
    <div class="wh-wb-prop-change-head"><span class="wh-wb-prop-chip">${escapeHtml(changeTypeLabel(change.change_type, zh))}</span><span class="wh-wb-prop-change-path">${escapeHtml(path)}</span></div>
    <div class="wh-wb-prop-change-sum">${escapeHtml(change.human_summary)}</div>
    ${diff}
  </div>`;
}

function checkText(check: ProposalDetailVM["manifest"]["checks"][number], zh: boolean): string {
  const detail = check.status === "passed" ? "" : check.detail?.trim();
  return detail ? `${check.label}${zh ? "：" : ": "}${detail}` : check.label;
}

// 风险等级 → chip 语气修饰符（high=danger 打眼、medium=warn、low=中性），对齐 army 状态 chip 的语气分层。
function riskTone(level: "low" | "medium" | "high"): string {
  return level === "high" ? "high" : level === "medium" ? "medium" : "low";
}

function proposalSummaryText(markdown: string, zh: boolean): string {
  const locale = zh ? "zh-CN" : "en-US";
  return (
    publicProposalSummaryText(markdown, locale, 320) ||
    (proposalT(zh, "reviewTheSummaryAndChangesBefore"))
  );
}

// 打回理由器（06 §5.3）——预设 chip + textarea + 「发送打回说明」。语义与 spotlight reasonComposerHtml 同构，
// 但用 wh-wb-prop-* 类。理由拼装用复用的纯函数 proposalRequestChangesReason（panel.ts 里 import spotlight
// 的那一个），空理由拦截时把提示塞进 data-wb-prop-reason-error 容器（panel.ts 直接改它的 textContent，
// 不整体重渲——否则会把用户已经打的字冲掉）。
function reasonComposerHtml(zh: boolean): string {
  const presets = zh ? ["方向不对", "细节要调整", "缺少依据"] : ["Wrong direction", "Needs tweaks", "Insufficient evidence"];
  return `<div class="wh-wb-prop-reasons" data-wb-prop-reasons>
    <p class="wh-wb-prop-reasons-q">${proposalT(zh, "feedbackForChanges")}</p>
    <div class="wh-wb-prop-reasons-row">${presets
      .map(
        (preset) =>
          `<button type="button" class="wh-wb-prop-reason" data-wb-prop-reason="${escapeHtml(preset)}" aria-pressed="false">${escapeHtml(preset)}</button>`
      )
      .join("")}</div>
    <textarea class="wh-wb-prop-reason-text" data-wb-prop-reason-text rows="3" placeholder="${
      proposalT(zh, "describeWhatNeedsToChangeCuu")
    }"></textarea>
    <p class="wh-wb-prop-reason-error" data-wb-prop-reason-error></p>
    <div class="wh-wb-prop-reason-actions">
      <button type="button" class="wh-wb-prop-act wh-wb-prop-act--danger" data-wb-prop-submit-deny>${proposalT(zh, "sendFeedback")}</button>
    </div>
  </div>`;
}

function noticeHtml(notice: ProposalActionNotice, zh: boolean): string {
  const retry = notice.retry
    ? `<button type="button" class="wh-wb-prop-act wh-wb-prop-act--ghost" data-wb-prop-retry="${escapeHtml(notice.retry)}">${proposalT(zh, "tryAgain")}</button>`
    : "";
  return `<div class="wh-wb-prop-notice wh-wb-prop-notice--${notice.tone}" data-wb-prop-notice><span>${escapeHtml(notice.text)}</span>${retry}</div>`;
}

// 动作区渲染——状态门控（06 §5.1/§5.2）：opened 渲「确认通过 + 打回修改」；reviewed 且有 merge 动作渲
// 「合入交付物」；merged/rejected 是终态，只渲一枚状态 chip（天然只读，这就是 M1 的「只读视图」）。
function actionsHtml(vm: ProposalDetailVM, ui: ProposalDetailUiState, zh: boolean): string {
  const busy = ui.busy;
  if (vm.status === "opened") {
    const approveLabel = busy === "approve" ? (proposalT(zh, "approving")) : proposalT(zh, "markApproved");
    const denyLabel = busy === "deny" ? (proposalT(zh, "sendingBack")) : proposalT(zh, "requestChanges");
    return `<div class="wh-wb-prop-actions" data-wb-prop-actions>
      <p class="wh-wb-prop-note">${proposalT(zh, "approveFirstThenMergeTheSnapshot")}</p>
      <button type="button" class="wh-wb-prop-act wh-wb-prop-act--primary" data-wb-prop-approve${busy ? " disabled" : ""}>${escapeHtml(approveLabel)}</button>
      <button type="button" class="wh-wb-prop-act wh-wb-prop-act--danger" data-wb-prop-deny${busy ? " disabled" : ""}>${escapeHtml(denyLabel)}</button>
    </div>`;
  }
  if (vm.status === "reviewed" && vm.review_actions.merge) {
    const mergeLabel = busy === "merge"
      ? (proposalT(zh, "merging"))
      : vm.review_actions.merge.label || (proposalT(zh, "mergeDeliverable"));
    return `<div class="wh-wb-prop-actions" data-wb-prop-actions>
      <p class="wh-wb-prop-note">${proposalT(zh, "approvedOnlyTheDeliverableMergeRemains")}</p>
      <button type="button" class="wh-wb-prop-act wh-wb-prop-act--primary" data-wb-prop-merge${busy ? " disabled" : ""}>${escapeHtml(mergeLabel)}</button>
    </div>`;
  }
  return `<div class="wh-wb-prop-actions"><span class="wh-wb-prop-status wh-wb-prop-status--${escapeHtml(vm.status)}">${escapeHtml(proposalStatusLabel(vm.status, zh))}</span></div>`;
}

function renderDetailHtml(vm: ProposalDetailVM, ui: ProposalDetailUiState, locale: Locale): string {
  const zh = locale === "zh-CN";
  const m = vm.manifest;
  const displayTitle = publicProposalDisplayTitle(vm.title, zh ? "zh-CN" : "en-US");
  const summary = proposalSummaryText(m.summary_md, zh);
  const checks = m.checks.length
    ? `<div class="wh-wb-prop-checks">${m.checks
        .map((check) => `<span class="wh-wb-prop-check wh-wb-prop-check--${escapeHtml(check.status)}">${escapeHtml(checkText(check, zh))}</span>`)
        .join("")}</div>`
    : "";
  const notice = ui.notice ? noticeHtml(ui.notice, zh) : "";
  // 理由器只在 opened 态才有意义（打回一个已终结的提议无从谈起）——reasonOpen 命中时把两键换成理由器。
  const showReason = ui.reasonOpen && vm.status === "opened";
  const tail = showReason ? reasonComposerHtml(zh) : actionsHtml(vm, ui, zh);
  return `<div class="wh-wb-prop">
    <button type="button" class="wh-wb-prop-back" data-wb-prop-back>${proposalT(locale, "backToArmyPanel")}</button>
    <div class="wh-wb-prop-head">
      <span class="wh-wb-prop-risk wh-wb-prop-risk--${riskTone(m.risk.level)}">${escapeHtml(m.risk.human_label)}</span>
      <span class="wh-wb-prop-change-path">${m.changes.length} ${proposalT(locale, "changes")}</span>
    </div>
    <h3 class="wh-wb-prop-title">${escapeHtml(displayTitle)}</h3>
    <div class="wh-wb-prop-summary">
      <div class="wh-wb-prop-change-head"><span class="wh-wb-prop-chip">${proposalT(locale, "summary")}</span></div>
      <div class="wh-wb-prop-change-sum">${escapeHtml(summary)}</div>
    </div>
    ${checks}
    <div class="wh-wb-prop-changes">${m.changes.map((change) => changeRowHtml(change, zh)).join("")}</div>
    ${notice}
    ${tail}
  </div>`;
}

export function renderProposalLoadingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-prop-loading"><span class="wh-wb-spinner"></span>${proposalT(locale, "loadingTheProposal")}</div>`;
}

export function renderProposalErrorHtml(message: string, locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-prop-error">
    <button type="button" class="wh-wb-prop-back" data-wb-prop-back>${proposalT(locale, "backToArmyPanel")}</button>
    <p class="wh-wb-prop-error-msg">${escapeHtml(message || (proposalT(locale, "couldnTLoadTheProposal")))}</p>
    <button type="button" class="wh-wb-prop-act wh-wb-prop-act--ghost" data-wb-prop-reload>${proposalT(locale, "tryAgain")}</button>
  </div>`;
}

export function renderProposalSidePanelHtml(state: ProposalSidePanelState, locale: Locale): string {
  switch (state.mode) {
    case "loading":
      return renderProposalLoadingHtml(locale);
    case "error":
      return renderProposalErrorHtml(state.message, locale);
    case "detail":
      return renderDetailHtml(state.vm, state.ui, locale);
    default:
      return "";
  }
}

// 通过/打回/合入的失败分类（06 §5.4，纯函数、可单测）——照 turn.ts 分类精神把 403/409/网络分成三档温和
// 话术，绝不把裸 error message 甩给用户。conflict 优先按 conflictsFromMergeError 判（merge 撞车的权威
// 信号），再退到 HTTP 状态码；403 归 permission；其余（含离线/未知）归 network 可重试。
export function classifyProposalActionError(
  error: unknown,
  action: "approve" | "deny" | "merge",
  locale: Locale
): ProposalActionNotice {
  const zh = locale === "zh-CN";
  if (action === "merge" && conflictsFromMergeError(error).length > 0) {
    return {
      tone: "conflict",
      text: proposalT(locale, "thisChangeConflictsWithSomeoneElse")
    };
  }
  if (error instanceof WorkHubApiError) {
    if (error.status === 403) {
      return {
        tone: "permission",
        text: proposalT(locale, "thisProposalIsnTYoursTo")
      };
    }
    if (error.status === 409) {
      return {
        tone: "conflict",
        text: proposalT(locale, "thisProposalSStatusAlreadyChanged")
      };
    }
  }
  return {
    tone: "network",
    text: proposalT(locale, "thatDidnTGoThroughTry"),
    retry: action
  };
}
