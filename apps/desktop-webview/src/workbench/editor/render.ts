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

import { editorT } from "./locales.js";

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

// #13（同提议多文件）：编辑器顶部文件切换条的一格。adds/dels 只在该文件的 diff 被加载过后才有值
// （view.ts 逐访问缓存，不预取全部 diff——避免一开编辑器就打 N 个 diff 请求）；未加载时退回 change_type
// 短标签当轻量 diffstat 代理，诚实不编造行数。
export type EditorFileTab = {
  path: string;
  filename: string;
  changeType: ProposalChangeDiffVM["change_type"];
  adds?: number;
  dels?: number;
};

// 同一份提议里所有可逐行对照的文本变动文件 + 当前激活的那个（view.ts 维护，render 只读）。
export type EditorFilesState = {
  tabs: EditorFileTab[];
  activePath: string;
};

export type EditorViewState =
  | { mode: "loading"; filename: string }
  | { mode: "error"; filename: string; message: string }
  | { mode: "unsupported"; filename: string }
  // #12（合并撞真实冲突）：merge_conflict 分支——复用 Spotlight 既有逐冲突解决面板的 HTML
  // （proposalMergeConflictHtml，view.ts 传入已构好的可信 HTML 串），不再一律渲「状态变了刷新看看」。
  | { mode: "conflict"; filename: string; conflictHtml: string }
  | { mode: "ready"; diff: ProposalChangeDiffVM; actions: EditorReadyActions; ui: EditorReadyUi; files?: EditorFilesState };

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

// #13：文件切换条的每格 diffstat。加载过 diff 的文件显真实 +adds/−dels；没加载过的退回 change_type 短标签。
const CHANGE_TYPE_SHORT: Record<ProposalChangeDiffVM["change_type"], [string, string]> = {
  created: ["新增", "New"],
  updated: ["修改", "Edit"],
  deleted: ["删除", "Del"],
  renamed: ["重命名", "Ren"],
  moved: ["移动", "Move"],
  replaced: ["替换", "Repl"],
  generated: ["生成", "Gen"]
};

function fileTabStatHtml(tab: EditorFileTab, zh: boolean): string {
  if (tab.adds !== undefined || tab.dels !== undefined) {
    const adds = tab.adds ?? 0;
    const dels = tab.dels ?? 0;
    return `<span class="wh-wb-ed-ftab-stat"><span class="wh-wb-ed-ftab-add">+${adds}</span> <span class="wh-wb-ed-ftab-del">−${dels}</span></span>`;
  }
  const entry = CHANGE_TYPE_SHORT[tab.changeType];
  return `<span class="wh-wb-ed-ftab-stat wh-wb-ed-ftab-stat--type">${escapeHtml(zh ? entry[0] : entry[1])}</span>`;
}

// #13：同提议含多个文本变动文件时的顶部切换条（文件名 chips + diffstat + 上一个/下一个）。单文件不渲。
function filesBarHtml(files: EditorFilesState | undefined, zh: boolean): string {
  if (!files || files.tabs.length <= 1) {
    return "";
  }
  const activeIdx = Math.max(0, files.tabs.findIndex((tab) => tab.path === files.activePath));
  const atFirst = activeIdx <= 0;
  const atLast = activeIdx >= files.tabs.length - 1;
  const chips = files.tabs
    .map((tab) => {
      const active = tab.path === files.activePath;
      return `<button type="button" class="wh-wb-ed-ftab${active ? " wh-wb-ed-ftab--active" : ""}" data-wb-ed-file="${escapeHtml(
        tab.path
      )}"${active ? ' aria-current="true"' : ""} title="${escapeHtml(tab.filename)}">
        <span class="wh-wb-ed-ftab-name">${escapeHtml(tab.filename)}</span>${fileTabStatHtml(tab, zh)}</button>`;
    })
    .join("");
  return `<div class="wh-wb-ed-files" data-wb-ed-files>
    <button type="button" class="wh-wb-ed-fnav" data-wb-ed-file-prev${atFirst ? " disabled" : ""} aria-label="${
      editorT(zh, "previousFile")
    }" title="${editorT(zh, "previousFile")}">${workbenchIcons.chevronLeft}</button>
    <div class="wh-wb-ed-ftabs">${chips}</div>
    <button type="button" class="wh-wb-ed-fnav" data-wb-ed-file-next${atLast ? " disabled" : ""} aria-label="${
      editorT(zh, "nextFile")
    }" title="${editorT(zh, "nextFile")}">${workbenchIcons.chevronRight}</button>
    <span class="wh-wb-ed-fcount">${activeIdx + 1}/${files.tabs.length}</span>
  </div>`;
}

function headerHtml(filename: string, statusChip: string, zh: boolean): string {
  return `<div class="wh-wb-ed-head">
    <span class="wh-wb-ed-file">${workbenchIcons.file}<span class="wh-wb-ed-file-name">${escapeHtml(filename)}</span></span>
    ${statusChip}
    <div class="wh-wb-titlebar-spacer"></div>
    <button type="button" class="wh-wb-winbtn" data-wb-ed-close aria-label="${editorT(zh, "closeEditor")}" title="${editorT(zh, "close")}">${workbenchIcons.close}</button>
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
        ? `<button type="button" class="wh-wb-ed-fold" data-wb-ed-collapse="${index}">${editorT(zh, "collapseUnchanged")}</button>`
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
        editorT(zh, "couldnTCompareAgainstThePrevious")
      }</div>`
    : diff.truncated
      ? `<div class="wh-wb-ed-banner">${
          editorT(zh, "thisChangeIsLargeTheLine")
        }</div>`
      : "";
  const rows = diff.segments.length
    ? diff.segments.map((segment, index) => segmentHtml(segment, index, ui.expanded, zh)).join("")
    : `<div class="wh-wb-ed-empty">${editorT(zh, "thisChangeHasNoBodyTo")}</div>`;
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
    const approveLabel = ui.busy === "approve" ? (editorT(zh, "approving")) : editorT(zh, "markApproved");
    return `<div class="wh-wb-ed-actionbar">${notice}
      <p class="wh-wb-ed-actionnote">${editorT(zh, "approveFirstThenMergeTheSnapshot")}</p>
      <div class="wh-wb-ed-actionrow">
        <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-ed-deny${ui.busy ? " disabled" : ""}>${editorT(zh, "requestChanges")}</button>
        <button type="button" class="wh-wb-btn wh-wb-btn--primary" data-wb-ed-approve${ui.busy ? " disabled" : ""}>${escapeHtml(approveLabel)}</button>
      </div>
    </div>`;
  }
  if (actions.status === "reviewed" && actions.mergeLabel) {
    const mergeLabel = ui.busy === "merge" ? (editorT(zh, "merging")) : actions.mergeLabel;
    return `<div class="wh-wb-ed-actionbar">${notice}
      <p class="wh-wb-ed-actionnote">${editorT(zh, "approvedOnlyTheDeliverableMergeRemains")}</p>
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
      <div class="wh-wb-ed-scroll"><div class="wh-wb-loading"><span class="wh-wb-spinner"></span>${editorT(locale, "openingTheChange")}</div></div>
    </div>`;
  }
  if (state.mode === "error") {
    return `<div class="wh-wb-ed">${headerHtml(state.filename, "", zh)}
      <div class="wh-wb-ed-scroll"><div class="wh-wb-ed-empty">${escapeHtml(state.message)}
        <div style="margin-top:12px"><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-ed-retry>${editorT(locale, "tryAgain")}</button></div>
      </div></div>
    </div>`;
  }
  if (state.mode === "unsupported") {
    return `<div class="wh-wb-ed">${headerHtml(state.filename, "", zh)}
      <div class="wh-wb-ed-scroll"><div class="wh-wb-ed-empty">${
        editorT(locale, "thisChangeHasNoLineComparable")
      }</div></div>
    </div>`;
  }
  // #12：合并撞真实冲突——渲复用的逐冲突解决面板（conflictHtml 是 proposalMergeConflictHtml 产出的可信 HTML，
  // 内含 data-prop-back 返回把手 + 各冲突选项动作，view.ts 接管点击）。没有动作条：处理走面板内的冲突动作。
  if (state.mode === "conflict") {
    const conflictChip = `<span class="wh-wb-ed-tag wh-wb-ed-tag--rejected">${escapeHtml(editorT(locale, "conflict"))}</span>`;
    return `<div class="wh-wb-ed">
      ${headerHtml(state.filename, conflictChip, zh)}
      <div class="wh-wb-ed-scroll"><div class="wh-wb-ed-conflict" data-wb-ed-conflict>${state.conflictHtml}</div></div>
    </div>`;
  }
  const statusChip = `<span class="wh-wb-ed-tag wh-wb-ed-tag--${statusTone(state.actions.status)}">${escapeHtml(statusLabel(state.actions.status, zh))}</span>`;
  return `<div class="wh-wb-ed">
    ${headerHtml(state.diff.filename, statusChip, zh)}
    ${filesBarHtml(state.files, zh)}
    <div class="wh-wb-ed-scroll">${bodyHtml(state.diff, state.ui, zh)}</div>
    ${actionsHtml(state.actions, state.ui, zh)}
  </div>`;
}
