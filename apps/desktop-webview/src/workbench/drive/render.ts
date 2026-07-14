// WorkHub 桌面 · 工作台网盘标签 + 情境面板（预览/版本历史）的纯 HTML 渲染函数。
// 照 shell.ts/rail.ts/chat/render.ts 的既有分工：这里全部是无副作用的字符串拼装（可单测），
// 挂载/事件绑定在 view.ts 与 side-panel.ts。视觉是工作台的深色玻璃系统（.wh-wb-* 类名 + --ds-* token，
// 见 css.ts 顶部注释）——和 spotlight/views/drive.ts 的浅色玻璃（.wh-spot-*）不是同一套皮肤，
// 那边只复用其中的纯 fetch/鉴权逻辑（fmtSize/driveResourceHref 等），不复用其 HTML。

import type { DriveItemVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { driveResourceHref, fmtSize } from "../../spotlight/views/drive.js";
import { workbenchIcons } from "../icons.js";
import type { DriveVersionEntry, DriveVersionHistory } from "./api.js";

type Locale = "zh-CN" | "en-US";

function formatVersionTimestamp(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(iso));
}

// —— 中栏:网盘文件/文件夹列表 —— //

export type DriveBreadcrumbCrumb = { id: string | undefined; name: string };

export function renderDriveBarHtml(input: {
  locale: Locale;
  breadcrumb: readonly DriveBreadcrumbCrumb[];
  canUpload: boolean;
}): string {
  const zh = input.locale === "zh-CN";
  const crumbs = input.breadcrumb
    .map((crumb, index) => {
      const isLast = index === input.breadcrumb.length - 1;
      const label = escapeHtml(crumb.name);
      if (isLast) {
        return `<b>${label}</b>`;
      }
      return `<button type="button" class="wh-wb-drive-crumb-link" data-wb-drive-open-folder="${escapeHtml(crumb.id ?? "")}">${label}</button>`;
    })
    .join('<span class="wh-wb-drive-crumb-sep">/</span>');
  const uploadBtn = input.canUpload
    ? `<label class="wh-wb-btn wh-wb-btn--primary wh-wb-drive-upload-label"><span data-wb-drive-upload-label>${zh ? "上传文件" : "Upload"}</span><input class="wh-wb-drive-upload-input" type="file" data-wb-drive-upload-picker /></label>`
    : "";
  return `<div class="wh-wb-drive-bar">
    <div class="wh-wb-drive-path">${crumbs}<span class="wh-wb-drive-note">${
      zh ? "全部文件自动留版本 · 可回滚" : "Every file keeps versions automatically — always recoverable"
    }</span></div>
    <div class="wh-wb-drive-bar-spacer"></div>
    ${uploadBtn}
  </div>`;
}

function driveRowMeta(item: DriveItemVM, zh: boolean): string {
  if (item.kind === "folder") {
    return `${item.children_count} ${zh ? "项" : "items"}`;
  }
  const size = fmtSize(item.current_version?.size_bytes);
  const updated = new Date(item.updated_at);
  const when = Number.isNaN(updated.getTime()) ? "" : formatVersionTimestamp(item.updated_at, zh ? "zh-CN" : "en-US");
  const tag = item.accepted_deliverable ? ` · ${zh ? "AI 交付" : "AI deliverable"}` : "";
  return [size, when].filter(Boolean).join(" · ") + tag;
}

function driveRowHtml(item: DriveItemVM, zh: boolean, canManage: boolean, apiBaseUrl: string | undefined): string {
  const icon = item.kind === "folder" ? workbenchIcons.folder : workbenchIcons.file;
  const openAttr = item.kind === "folder"
    ? `data-wb-drive-open-folder="${escapeHtml(item.id)}"`
    : `data-wb-drive-open-item="${escapeHtml(item.id)}" data-wb-drive-open-item-name="${escapeHtml(item.name)}"`;
  const actions: string[] = [];
  if (item.kind === "file") {
    // 「版本」入口——只要这个文件有版本(current_version_id 存在)就给,不看 preview_href/download_href
    // (受限交付物可能没有那两个链接,但版本历史本身是元信息,读权限同网盘本身,见服务层 listVersions)。
    if (item.current_version_id) {
      actions.push(
        `<button type="button" class="wh-wb-act" data-wb-drive-open-versions="${escapeHtml(item.id)}" data-wb-drive-open-versions-name="${escapeHtml(item.name)}">${workbenchIcons.history}${zh ? "版本" : "History"}</button>`
      );
    }
    if (item.download_href) {
      // 桌面 webview 不与 API 同源——相对路径必须先重写到 api base（driveResourceHref，
      // 与 spotlight/views/drive.ts 同一套鉴权 fetch 走同一份改写逻辑，不重复实现）。
      const href = driveResourceHref(item.download_href, apiBaseUrl);
      actions.push(`<a class="wh-wb-act" href="${escapeHtml(href)}" data-wb-drive-download="${escapeHtml(item.id)}" data-wb-drive-download-name="${escapeHtml(item.name)}">${zh ? "下载" : "Download"}</a>`);
    }
  }
  if (canManage && item.delete_href) {
    actions.push(
      `<button type="button" class="wh-wb-act wh-wb-act--danger" data-wb-drive-delete="${escapeHtml(item.id)}" data-wb-drive-delete-version="${escapeHtml(item.current_version_id ?? "")}">${zh ? "删除" : "Delete"}</button>`
    );
  }
  return `<div class="wh-wb-drive-row" ${openAttr}>
    <span class="wh-wb-drive-row-icon">${icon}</span>
    <div class="wh-wb-drive-row-main"><div class="wh-wb-drive-row-name">${escapeHtml(item.name)}</div><div class="wh-wb-drive-row-meta">${driveRowMeta(item, zh)}</div></div>
    <div class="wh-wb-drive-row-actions">${actions.join("")}</div>
  </div>`;
}

export function renderDriveListHtml(input: {
  locale: Locale;
  items: readonly DriveItemVM[];
  canManage: boolean;
  apiBaseUrl?: string;
}): string {
  const zh = input.locale === "zh-CN";
  if (input.items.length === 0) {
    return `<p class="wh-wb-drive-empty">${zh ? "这里还没有文件" : "No files here yet"}</p>`;
  }
  const folders = input.items.filter((item) => item.kind === "folder");
  const files = input.items.filter((item) => item.kind === "file");
  const rows = [...folders, ...files].map((item) => driveRowHtml(item, zh, input.canManage, input.apiBaseUrl)).join("");
  return `<div class="wh-wb-drive-list">${rows}</div>`;
}

export function renderDriveLoadingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-loading"><span class="wh-wb-spinner"></span>${zh ? "正在拉网盘…" : "Loading the drive…"}</div>`;
}

export function renderDriveErrorHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-error">${zh ? "网盘没拉到，稍后重试" : "Couldn't load the drive — retry"}
    <div style="margin-top:13px"><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-drive-retry>${zh ? "重试" : "Retry"}</button></div>
  </div>`;
}

// —— 右栏:预览/版本历史(供 drive 标签与聊天 file_card 共用同一份渲染) —— //

export type DriveSidePanelState =
  | { mode: "idle" }
  | { mode: "preview_loading"; itemName: string }
  | { mode: "preview_error"; itemName: string; error: string }
  | {
      mode: "preview_text";
      itemName: string;
      text: string;
      truncated: boolean;
      downloadHref?: string;
    }
  | { mode: "preview_unsupported"; itemName: string; downloadHref?: string }
  | { mode: "versions_loading"; itemName: string }
  | { mode: "versions_error"; itemName: string; error: string }
  | {
      mode: "versions_ready";
      itemName: string;
      history: DriveVersionHistory;
      rollback?: { versionId: string; busy: boolean; error?: string };
      justRolledBackVersionNo?: number;
      // R14（网盘回滚两端对齐）：哪个版本的「找回」按钮正处在两段式确认的第一下——第一次点只武装、
      // 5 秒内对同一版本再点一次才真正发请求（照 apps/web/src/browser.ts 里 r9ConfirmArmed 的既有
      // 两段式确认先例）。这之前是一点就直接回滚，回滚这种覆盖性动作不该无确认。
      armedVersionId?: string;
    };

function sidePanelHeaderHtml(icon: string, title: string, itemName: string): string {
  return `<div class="wh-wb-drive-side-head">${icon}<span class="wh-wb-drive-side-title">${title}</span></div>
    <div class="wh-wb-drive-side-item">${escapeHtml(itemName)}</div>`;
}

function versionRowHtml(
  version: DriveVersionEntry,
  zh: boolean,
  rollback: { versionId: string; busy: boolean; error?: string } | undefined,
  armedVersionId: string | undefined
): string {
  const when = formatVersionTimestamp(version.created_at, zh ? "zh-CN" : "en-US");
  const meta = `${when} · ${escapeHtml(version.created_by_label)} · ${fmtSize(version.size_bytes)}`;
  const badge = version.current
    ? `<span class="wh-wb-drive-version-current">${zh ? "当前版本" : "Current"}</span>`
    : "";
  const isBusy = rollback?.versionId === version.id && rollback.busy;
  const isArmed = !isBusy && armedVersionId === version.id;
  const restoreBtn = version.restore_href
    ? `<button type="button" class="wh-wb-btn wh-wb-btn--ghost wh-wb-drive-restore-btn${isArmed ? " wh-wb-drive-restore-btn--armed" : ""}" data-wb-drive-restore-version="${escapeHtml(version.id)}" ${isBusy ? "disabled" : ""}>${
        isBusy
          ? (zh ? "找回中…" : "Recovering…")
          : isArmed
            ? (zh ? "确定？再点一次找回" : "Sure? Click again to recover")
            : (zh ? "找回这个版本" : "Recover this version")
      }</button>`
    : "";
  // 回滚是覆盖性动作——武装态下把真实服务端语义摆出来再让用户点第二下：会新建一个当前版本
  // （内容复制自这一版），不会抹掉现有的版本历史（照 side-panel.ts rollbackDriveItemVersion 的
  // 真实实现：project_drive_versions 追加新行，旧行原样保留）。
  const armedHint = isArmed
    ? `<p class="wh-wb-drive-version-confirm-pending">${zh
        ? "会把这一版的内容存成一个新的当前版本，原来的版本历史都还在。5 秒内再点一次确认，否则自动取消。"
        : "This creates a new current version from this content — the rest of the history stays. Click again within 5 seconds to confirm, or it cancels automatically."
      }</p>`
    : "";
  const rowError = rollback?.versionId === version.id && rollback.error
    ? `<p class="wh-wb-drive-version-error">${escapeHtml(rollback.error)}</p>`
    : "";
  return `<div class="wh-wb-drive-version-row">
    <div class="wh-wb-drive-version-top"><span class="wh-wb-drive-version-no">v${version.version_no}</span>${badge}</div>
    <div class="wh-wb-drive-version-meta">${meta}</div>
    ${restoreBtn}
    ${armedHint}
    ${rowError}
  </div>`;
}

export function renderDriveSidePanelHtml(state: DriveSidePanelState, locale: Locale): string {
  const zh = locale === "zh-CN";
  switch (state.mode) {
    case "idle":
      return `<p class="wh-wb-drive-side-idle">${zh ? "点文件查看预览，或打开版本历史。" : "Click a file to preview it, or open its version history."}</p>`;
    case "preview_loading":
      return `${sidePanelHeaderHtml(workbenchIcons.file, zh ? "预览" : "Preview", state.itemName)}<div class="wh-wb-loading"><span class="wh-wb-spinner"></span>${zh ? "正在预览…" : "Loading preview…"}</div>`;
    case "preview_error":
      return `${sidePanelHeaderHtml(workbenchIcons.file, zh ? "预览" : "Preview", state.itemName)}<p class="wh-wb-drive-side-error">${escapeHtml(state.error)}</p>`;
    case "preview_text":
      return `${sidePanelHeaderHtml(workbenchIcons.file, zh ? "预览" : "Preview", state.itemName)}
        <pre class="wh-wb-drive-preview-text">${escapeHtml(state.text)}</pre>
        ${state.truncated ? `<p class="wh-wb-drive-side-note">${zh ? "内容较长，仅显示前一部分。" : "Large file — showing the first part."}</p>` : ""}
        ${state.downloadHref ? `<a class="wh-wb-btn wh-wb-btn--ghost" href="${escapeHtml(state.downloadHref)}" data-wb-drive-side-download="true">${zh ? "下载完整文件" : "Download full file"}</a>` : ""}`;
    case "preview_unsupported":
      return `${sidePanelHeaderHtml(workbenchIcons.file, zh ? "预览" : "Preview", state.itemName)}
        <p class="wh-wb-drive-side-note">${zh ? "这类文件暂不支持在线预览，请下载查看。" : "This file type can't be previewed here — download it instead."}</p>
        ${state.downloadHref ? `<a class="wh-wb-btn wh-wb-btn--ghost" href="${escapeHtml(state.downloadHref)}" data-wb-drive-side-download="true">${zh ? "下载" : "Download"}</a>` : ""}`;
    case "versions_loading":
      return `${sidePanelHeaderHtml(workbenchIcons.history, zh ? "版本历史" : "Version history", state.itemName)}<div class="wh-wb-loading"><span class="wh-wb-spinner"></span>${zh ? "正在拉版本…" : "Loading versions…"}</div>`;
    case "versions_error":
      return `${sidePanelHeaderHtml(workbenchIcons.history, zh ? "版本历史" : "Version history", state.itemName)}<p class="wh-wb-drive-side-error">${escapeHtml(state.error)}</p>`;
    case "versions_ready": {
      const confirmation = state.justRolledBackVersionNo !== undefined
        ? `<p class="wh-wb-drive-version-confirm">${workbenchIcons.check}${
            zh
              ? `已找回 v${state.justRolledBackVersionNo} 的内容，追加成了新版本——原历史都还在。`
              : `Recovered the content from v${state.justRolledBackVersionNo} as a new version — nothing was erased.`
          }</p>`
        : "";
      const rows = state.history.versions.map((version) => versionRowHtml(version, zh, state.rollback, state.armedVersionId)).join("");
      return `${sidePanelHeaderHtml(workbenchIcons.history, zh ? "版本历史" : "Version history", state.itemName)}${confirmation}<div class="wh-wb-drive-version-list">${rows}</div>`;
    }
    default:
      return "";
  }
}
