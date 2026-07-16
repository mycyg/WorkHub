// WorkHub 桌面 · 工作台右栏「情境面板 · 文件模式」的纯渲染层（无副作用、可单测——取数/事件在 panel.ts）。
// R16-W3。右栏顶部「提议 / 文件」chip 是外壳 chrome（shell.ts renderSideTabs）；本模块只渲「文件」模式
// 的内容：变动文件（该会话开着的 proposal manifest 变更集，行=文件名 + diffstat + 状态标签，点击→中栏
// 编辑器逐句对照）/ 所有文件（Drive 树只读，点击文件=现状 drive 预览）。两个子 tab 用 fp-tab 切换。

import type { ArmyOutputLinkVM, DeliverableChange, DriveItemVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { workbenchIcons } from "../icons.js";

type Locale = "zh-CN" | "en-US";

export type FilesSubTab = "changed" | "all";

// 一行变动文件——来自 conversation army panel 的 outputs.items[].changed_files（proposal 维度）。
export type FilesChangedRow = {
  proposalId: string;
  proposalTitle: string;
  status: string;
  path: string;
  filename: string;
  changeType: DeliverableChange["change_type"];
  adds?: number;
  dels?: number;
};

export type FilesChangedState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: FilesChangedRow[] };

export type FilesAllState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: DriveItemVM[] };

export type FilesSidePanelState = {
  sub: FilesSubTab;
  changed: FilesChangedState;
  all: FilesAllState;
};

// proposal 状态字符串 → 变动文件行的状态标签。未知状态原样显示，不编造。
const STATUS_LABEL: Record<string, [string, string]> = {
  opened: ["变更待审", "Open"],
  reviewed: ["待合并", "Ready to merge"],
  merged: ["已合并", "Merged"],
  rejected: ["已打回", "Sent back"]
};

function statusLabel(status: string, zh: boolean): string {
  const entry = STATUS_LABEL[status];
  return entry ? (zh ? entry[0] : entry[1]) : status;
}

function statusTone(status: string): string {
  return status === "merged" ? "merged" : status === "rejected" ? "rejected" : status === "reviewed" ? "reviewed" : "opened";
}

function diffstatHtml(row: FilesChangedRow): string {
  if (row.adds === undefined && row.dels === undefined) {
    return "";
  }
  const add = row.adds !== undefined ? `<span class="wh-wb-files-add">+${row.adds}</span>` : "";
  const del = row.dels !== undefined ? `<span class="wh-wb-files-del">−${row.dels}</span>` : "";
  return `<span class="wh-wb-files-diffstat">${add}${del}</span>`;
}

function changedRowHtml(row: FilesChangedRow, zh: boolean): string {
  return `<button type="button" class="wh-wb-files-row" data-wb-files-open-editor data-wb-files-proposal="${escapeHtml(row.proposalId)}" data-wb-files-path="${escapeHtml(row.path)}" data-wb-files-name="${escapeHtml(row.filename)}">
    <span class="wh-wb-files-icon">${workbenchIcons.file}</span>
    <span class="wh-wb-files-main">
      <span class="wh-wb-files-name">${escapeHtml(row.filename)}</span>
      <span class="wh-wb-files-meta">${diffstatHtml(row)}<span class="wh-wb-files-tag wh-wb-files-tag--${statusTone(row.status)}">${escapeHtml(statusLabel(row.status, zh))}</span></span>
    </span>
  </button>`;
}

function changedHtml(changed: FilesChangedState, zh: boolean): string {
  if (changed.status === "loading") {
    return `<div class="wh-wb-files-loading"><span class="wh-wb-spinner"></span>${zh ? "正在拉变动文件…" : "Loading changed files…"}</div>`;
  }
  if (changed.status === "error") {
    return `<div class="wh-wb-files-empty">${escapeHtml(changed.message)}<div style="margin-top:10px"><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-files-retry-changed>${zh ? "重试" : "Try again"}</button></div></div>`;
  }
  if (changed.rows.length === 0) {
    return `<div class="wh-wb-files-empty">${zh ? "这个会话还没有开着的变更提议。" : "No open change proposals in this conversation yet."}</div>`;
  }
  return `<div class="wh-wb-files-list">${changed.rows.map((row) => changedRowHtml(row, zh)).join("")}</div>
    <p class="wh-wb-files-note">${zh ? "变动 = 提议 manifest 的变更集（待审 / 已合），点文件看逐句对照。" : "Changed = proposal manifest change set; open a file for the line-by-line diff."}</p>`;
}

function driveRowHtml(item: DriveItemVM, zh: boolean): string {
  const indent = Math.min(item.depth, 6) * 12;
  if (item.kind === "folder") {
    return `<div class="wh-wb-files-row wh-wb-files-row--folder" style="padding-left:${8 + indent}px">
      <span class="wh-wb-files-icon">${workbenchIcons.folder}</span>
      <span class="wh-wb-files-name">${escapeHtml(item.name)}</span>
    </div>`;
  }
  return `<button type="button" class="wh-wb-files-row" style="padding-left:${8 + indent}px" data-wb-files-open-drive data-wb-files-item="${escapeHtml(item.id)}" data-wb-files-name="${escapeHtml(item.name)}" title="${zh ? "预览" : "Preview"}">
    <span class="wh-wb-files-icon">${workbenchIcons.file}</span>
    <span class="wh-wb-files-name">${escapeHtml(item.name)}</span>
  </button>`;
}

function allHtml(all: FilesAllState, zh: boolean): string {
  if (all.status === "idle" || all.status === "loading") {
    return `<div class="wh-wb-files-loading"><span class="wh-wb-spinner"></span>${zh ? "正在拉网盘…" : "Loading drive…"}</div>`;
  }
  if (all.status === "error") {
    return `<div class="wh-wb-files-empty">${escapeHtml(all.message)}<div style="margin-top:10px"><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-files-retry-all>${zh ? "重试" : "Try again"}</button></div></div>`;
  }
  if (all.items.length === 0) {
    return `<div class="wh-wb-files-empty">${zh ? "这个项目的网盘还是空的。" : "This project's drive is empty."}</div>`;
  }
  return `<div class="wh-wb-files-list">${all.items.map((item) => driveRowHtml(item, zh)).join("")}</div>`;
}

export function renderFilesSidePanelHtml(state: FilesSidePanelState, locale: Locale): string {
  const zh = locale === "zh-CN";
  const changedCount = state.changed.status === "ready" ? state.changed.rows.length : undefined;
  const countBadge = changedCount !== undefined && changedCount > 0 ? `<span class="wh-wb-files-cnt">${changedCount}</span>` : "";
  const subTabs = `<div class="wh-wb-files-tabs" role="tablist">
    <button type="button" class="wh-wb-files-tab${state.sub === "changed" ? " is-active" : ""}" data-wb-files-sub="changed" aria-selected="${state.sub === "changed"}">${zh ? "变动文件" : "Changed"} ${countBadge}</button>
    <button type="button" class="wh-wb-files-tab${state.sub === "all" ? " is-active" : ""}" data-wb-files-sub="all" aria-selected="${state.sub === "all"}">${zh ? "所有文件" : "All files"}</button>
  </div>`;
  const body = state.sub === "changed" ? changedHtml(state.changed, zh) : allHtml(state.all, zh);
  return `<div class="wh-wb-files">${subTabs}<div class="wh-wb-files-body">${body}</div></div>`;
}

// conversation army panel VM 的 outputs → 变动文件行（proposal 维度扁平化）。纯函数、可单测。
export function changedRowsFromOutputs(items: ReadonlyArray<ArmyOutputLinkVM>): FilesChangedRow[] {
  const rows: FilesChangedRow[] = [];
  for (const item of items) {
    if (!item.changed_files) {
      continue;
    }
    for (const file of item.changed_files) {
      if (!file.path) {
        continue;
      }
      const filename = file.path.split("/").filter(Boolean).pop() ?? file.path;
      rows.push({
        proposalId: item.proposal_id,
        proposalTitle: item.title,
        status: item.status,
        path: file.path,
        filename,
        changeType: file.change_type,
        ...(file.adds !== undefined ? { adds: file.adds } : {}),
        ...(file.dels !== undefined ? { dels: file.dels } : {})
      });
    }
  }
  return rows;
}
