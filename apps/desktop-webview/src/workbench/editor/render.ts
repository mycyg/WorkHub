// WorkHub 桌面 · 工作台变更编辑器的纯渲染层（无副作用、可单测——照 chat/render.ts、proposal/render.ts
// 的分工：imperative 挂载/取数/事件在 view.ts）。R16-W3。
//
// 这是「变更审阅器」不是自由编辑器：中栏全宽纸卡里逐行渲 base 与 proposed 的 tracked changes
// （删除=红底删除线 / 新增=绿底 / 未变=中性；未变段落超阈值折叠成「…未变更 N 行」可展开），
// 顶部=文件名 + 状态标签 + 关闭，底部=批准/打回/合并动作条（动作全走既有提议端点，见 view.ts）。
// 工具栏的 B/I/U 等富文本按钮不渲（本批只读审阅，假的不摆，见设计铁律）。

import type { ProposalChangeDiffSegment, ProposalChangeDiffVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { workbenchIcons } from "../icons.js";

type Locale = "zh-CN" | "en-US";

// 未变段落超过这么多行才折叠；折叠时保留上下各若干行做锚点，别把用户读上下文的能力也一起收走。
const CONTEXT_COLLAPSE_THRESHOLD = 8;
const CONTEXT_COLLAPSE_KEEP = 2;

export type EditorProposalStatus = "opened" | "reviewed" | "merged" | "rejected";

export type EditorReadyActions = {
  status: EditorProposalStatus;
  // reviewed 且请求者能合入（review_actions.merge 存在）时才给合并按钮的文案；否则只渲状态标签。
  mergeLabel?: string;
};

export type EditorReadyUi = {
  busy?: "approve" | "merge";
  notice?: string;
  // 已展开的 context 段索引集合（view.ts 维护）。
  expanded: ReadonlySet<number>;
};

export type EditorViewState =
  | { mode: "loading"; filename: string }
  | { mode: "error"; filename: string; message: string }
  | { mode: "unsupported"; filename: string }
  | { mode: "ready"; diff: ProposalChangeDiffVM; actions: EditorReadyActions; ui: EditorReadyUi };

const STATUS_LABEL: Record<EditorProposalStatus, [string, string]> = {
  opened: ["变更待审", "Open"],
  reviewed: ["待合并", "Ready to merge"],
  merged: ["已合并", "Merged"],
  rejected: ["已打回", "Sent back"]
};

function statusLabel(status: EditorProposalStatus, zh: boolean): string {
  const entry = STATUS_LABEL[status];
  return zh ? entry[0] : entry[1];
}

// status → 状态标签的语气修饰符（对齐右栏提议 chip 的语气分层）。
function statusTone(status: EditorProposalStatus): string {
  return status === "merged" ? "merged" : status === "rejected" ? "rejected" : status === "reviewed" ? "reviewed" : "opened";
}

function headerHtml(filename: string, statusChip: string, zh: boolean): string {
  return `<div class="wh-wb-ed-head">
    <span class="wh-wb-ed-file">${workbenchIcons.file}<span class="wh-wb-ed-file-name">${escapeHtml(filename)}</span></span>
    ${statusChip}
    <div class="wh-wb-titlebar-spacer"></div>
    <button type="button" class="wh-wb-winbtn" data-wb-ed-close aria-label="${zh ? "关闭编辑器" : "Close editor"}" title="${zh ? "关闭" : "Close"}">${workbenchIcons.close}</button>
  </div>`;
}

function lineHtml(kind: "context" | "add" | "del", text: string): string {
  // 空行也要占一行高度（保留段落节奏），用 &nbsp; 兜底。
  const body = text.length > 0 ? escapeHtml(text) : "&nbsp;";
  const mark = kind === "add" ? "+" : kind === "del" ? "−" : "";
  return `<div class="wh-wb-ed-line wh-wb-ed-line--${kind}"><span class="wh-wb-ed-gutter">${mark}</span><span class="wh-wb-ed-code">${body}</span></div>`;
}

function contextSegmentHtml(lines: string[], index: number, expanded: boolean, zh: boolean): string {
  if (lines.length <= CONTEXT_COLLAPSE_THRESHOLD || expanded) {
    const rows = lines.map((line) => lineHtml("context", line)).join("");
    // 展开态给一个「收起」把手（只在原本会被折叠的长段落上出现）。
    const collapse =
      lines.length > CONTEXT_COLLAPSE_THRESHOLD && expanded
        ? `<button type="button" class="wh-wb-ed-fold" data-wb-ed-collapse="${index}">${zh ? "收起未变更段落" : "Collapse unchanged"}</button>`
        : "";
    return `${collapse}${rows}`;
  }
  const head = lines.slice(0, CONTEXT_COLLAPSE_KEEP).map((line) => lineHtml("context", line)).join("");
  const tail = lines.slice(lines.length - CONTEXT_COLLAPSE_KEEP).map((line) => lineHtml("context", line)).join("");
  const hidden = lines.length - CONTEXT_COLLAPSE_KEEP * 2;
  const toggle = `<button type="button" class="wh-wb-ed-fold" data-wb-ed-expand="${index}">${
    zh ? `… 展开未变更的 ${hidden} 行` : `… show ${hidden} unchanged lines`
  }</button>`;
  return `${head}${toggle}${tail}`;
}

function segmentHtml(segment: ProposalChangeDiffSegment, index: number, expanded: ReadonlySet<number>, zh: boolean): string {
  if (segment.type === "context") {
    return contextSegmentHtml(segment.lines, index, expanded.has(index), zh);
  }
  return segment.lines.map((line) => lineHtml(segment.type, line)).join("");
}

function bodyHtml(diff: ProposalChangeDiffVM, ui: EditorReadyUi, zh: boolean): string {
  const banner = !diff.base_available
    ? `<div class="wh-wb-ed-banner">${
        zh
          ? "无法比对改动前的版本（快照已不可读），下面只展示提议后的内容。"
          : "Couldn't compare against the previous version (snapshot unreadable) — showing the proposed content only."
      }</div>`
    : diff.truncated
      ? `<div class="wh-wb-ed-banner">${
          zh ? "这份变更较大，逐行对照已被截断，仅供参考。" : "This change is large; the line-by-line diff is truncated."
        }</div>`
      : "";
  const rows = diff.segments.length
    ? diff.segments.map((segment, index) => segmentHtml(segment, index, ui.expanded, zh)).join("")
    : `<div class="wh-wb-ed-empty">${zh ? "这条变更没有可展示的正文。" : "This change has no body to show."}</div>`;
  return `<div class="wh-wb-ed-paper">
    <div class="wh-wb-ed-paper-head">
      <span class="wh-wb-ed-lede">${escapeHtml(diff.title)}</span>
    </div>
    ${banner}
    <div class="wh-wb-ed-diff" data-wb-ed-diff>${rows}</div>
  </div>`;
}

function actionsHtml(actions: EditorReadyActions, ui: EditorReadyUi, zh: boolean): string {
  const notice = ui.notice ? `<div class="wh-wb-ed-notice">${escapeHtml(ui.notice)}</div>` : "";
  if (actions.status === "opened") {
    const approveLabel = ui.busy === "approve" ? (zh ? "确认中…" : "Approving…") : zh ? "确认通过" : "Mark approved";
    return `<div class="wh-wb-ed-actionbar">${notice}
      <p class="wh-wb-ed-actionnote">${zh ? "确认通过后再合入交付物，可用快照回滚。" : "Approve first, then merge; the snapshot can roll back."}</p>
      <div class="wh-wb-ed-actionrow">
        <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-ed-deny${ui.busy ? " disabled" : ""}>${zh ? "打回修改" : "Request changes"}</button>
        <button type="button" class="wh-wb-btn wh-wb-btn--primary" data-wb-ed-approve${ui.busy ? " disabled" : ""}>${escapeHtml(approveLabel)}</button>
      </div>
    </div>`;
  }
  if (actions.status === "reviewed" && actions.mergeLabel) {
    const mergeLabel = ui.busy === "merge" ? (zh ? "合入中…" : "Merging…") : actions.mergeLabel;
    return `<div class="wh-wb-ed-actionbar">${notice}
      <p class="wh-wb-ed-actionnote">${zh ? "已确认通过，只差合入交付物。" : "Approved; only the deliverable merge remains."}</p>
      <div class="wh-wb-ed-actionrow">
        <button type="button" class="wh-wb-btn wh-wb-btn--primary" data-wb-ed-merge${ui.busy ? " disabled" : ""}>${escapeHtml(mergeLabel)}</button>
      </div>
    </div>`;
  }
  return `<div class="wh-wb-ed-actionbar">${notice}
    <div class="wh-wb-ed-actionrow">
      <span class="wh-wb-ed-status wh-wb-ed-status--${statusTone(actions.status)}">${escapeHtml(statusLabel(actions.status, zh))}</span>
    </div>
  </div>`;
}

export function renderEditorHtml(state: EditorViewState, locale: Locale): string {
  const zh = locale === "zh-CN";
  if (state.mode === "loading") {
    return `<div class="wh-wb-ed">${headerHtml(state.filename, "", zh)}
      <div class="wh-wb-ed-scroll"><div class="wh-wb-loading"><span class="wh-wb-spinner"></span>${zh ? "正在打开变更…" : "Opening the change…"}</div></div>
    </div>`;
  }
  if (state.mode === "error") {
    return `<div class="wh-wb-ed">${headerHtml(state.filename, "", zh)}
      <div class="wh-wb-ed-scroll"><div class="wh-wb-ed-empty">${escapeHtml(state.message)}
        <div style="margin-top:12px"><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-ed-retry>${zh ? "重试" : "Try again"}</button></div>
      </div></div>
    </div>`;
  }
  if (state.mode === "unsupported") {
    return `<div class="wh-wb-ed">${headerHtml(state.filename, "", zh)}
      <div class="wh-wb-ed-scroll"><div class="wh-wb-ed-empty">${
        zh
          ? "这条变更没有可逐行对照的文本内容。采纳后可到工作项或网盘查看正式版。"
          : "This change has no line-comparable text. After it's merged, view the final version in the work item or drive."
      }</div></div>
    </div>`;
  }
  const statusChip = `<span class="wh-wb-ed-tag wh-wb-ed-tag--${statusTone(state.actions.status)}">${escapeHtml(statusLabel(state.actions.status, zh))}</span>`;
  return `<div class="wh-wb-ed">
    ${headerHtml(state.diff.filename, statusChip, zh)}
    <div class="wh-wb-ed-scroll">${bodyHtml(state.diff, state.ui, zh)}</div>
    ${actionsHtml(state.actions, state.ui, zh)}
  </div>`;
}
