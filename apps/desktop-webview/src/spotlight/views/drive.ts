// WorkHub 桌面 · Spotlight「网盘」能力内联视图（S6，网盘同步是核心）。
// 选项目 → pages.drive → 统一玻璃文件/文件夹浏览 + 摘要 + 已删除项一键恢复（restoreDriveItem）。
// API：pages.drive 需 project_id（与知识检索同理先选项目）；恢复走 client.restoreDriveItem。

import type { DriveItemVM, DrivePageVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import {
  resolveDesktopApiBaseFromStorage
} from "../../desktop-api-base.js";
import {
  clearDesktopClientToken,
  readDesktopClientToken,
  writeDesktopClientToken
} from "../../desktop-client-token.js";
import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";

const FOLDER_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const FILE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

// 批 6（工作台网盘标签）：导出这几个纯函数/fetch helper 供 workbench/drive/* 复用——同一套下载/预览鉴权+
// token 自愈逻辑不该有第二份实现（03 铁律「先通读，能复用的组件抽公共不复制粘贴」）。工作台的呈现层
// （HTML/CSS 类名）是深色玻璃设计系统，和这里的 Spotlight 浅色玻璃不是同一套 class 前缀，那部分不复用。
export function fmtSize(bytes?: number): string {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function driveResourceHref(href: string, apiBaseUrl?: string): string {
  if (/^https?:\/\//iu.test(href) || !href.startsWith("/api/")) {
    return href;
  }
  const base = apiBaseUrl?.trim().replace(/\/+$/u, "");
  return base ? `${base}${href}` : href;
}

// DSK-05/06：API 基地址与设备令牌都走单一收口 helper（../../desktop-api-base.ts、
// ../../desktop-client-token.ts）——非法基地址按未配置回落本机默认；令牌明文 localStorage 的
// 已知风险见 desktop-client-token.ts 头部注释。
export function driveResourceApiBase(): string {
  return resolveDesktopApiBaseFromStorage(driveResourceStorage());
}

function driveResourceStorage(): Storage | undefined {
  return globalThis.window?.localStorage;
}

function driveResourceToken(): string | undefined {
  const storage = driveResourceStorage();
  return storage ? readDesktopClientToken(storage) : undefined;
}

function storeDriveResourceToken(token: string): void {
  const storage = driveResourceStorage();
  if (storage) {
    writeDesktopClientToken(storage, token);
  }
}

function clearDriveResourceToken(): void {
  const storage = driveResourceStorage();
  if (storage) {
    clearDesktopClientToken(storage);
  }
}

export function driveResourceHeaders(): Headers {
  const headers = new Headers();
  const token = driveResourceToken();
  if (token) {
    headers.set("X-WorkHub-Client-Token", token);
    headers.set("X-YQGL-Client-Token", token);
  }
  return headers;
}

async function refreshDriveResourceToken(apiBaseUrl: string): Promise<boolean> {
  clearDriveResourceToken();
  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/desktop-bootstrap`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "WorkHub Desktop",
        device_name: "WorkHub Desktop",
        platform: "desktop"
      })
    });
    const body = await response.json() as { client_token?: unknown };
    if (!response.ok || typeof body.client_token !== "string" || body.client_token.length === 0) {
      return false;
    }
    storeDriveResourceToken(body.client_token);
    return true;
  } catch {
    return false;
  }
}

async function shouldRefreshDriveResourceToken(response: Response): Promise<boolean> {
  if (response.status !== 401 && response.status !== 403) {
    return false;
  }
  try {
    const body = await response.clone().json() as { error?: { code?: unknown } };
    const code = body.error?.code;
    return code === "not_identified" || code === "invalid_client_token";
  } catch {
    return response.status === 401;
  }
}

export async function fetchDriveResource(href: string, init: RequestInit = {}, apiBaseUrl = driveResourceApiBase()): Promise<Response> {
  const withAuth = (): RequestInit => {
    const headers = new Headers(init.headers);
    driveResourceHeaders().forEach((value, key) => headers.set(key, value));
    return { ...init, credentials: "include", headers };
  };
  let response = await fetch(href, withAuth());
  if (await shouldRefreshDriveResourceToken(response)) {
    const refreshed = await refreshDriveResourceToken(apiBaseUrl);
    if (refreshed) {
      response = await fetch(href, withAuth());
    }
  }
  return response;
}

function filenameFromContentDisposition(value: string | null, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const utf8 = /filename\*=UTF-8''([^;]+)/iu.exec(value)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      return utf8;
    }
  }
  return /filename="([^"]+)"/iu.exec(value)?.[1] ?? fallback;
}

type DrivePreviewData = {
  filename: string;
  mime?: string;
  size_bytes: number;
  preview_type: "text";
  text: string;
  truncated?: boolean;
  download_href: string;
};

export async function fetchDrivePreview(href: string, apiBaseUrl?: string): Promise<DrivePreviewData> {
  const response = await fetchDriveResource(href, {}, apiBaseUrl);
  const body = await response.json() as { ok?: boolean; data?: DrivePreviewData; error?: { message?: string } };
  if (!response.ok || body.ok !== true || !body.data) {
    throw new Error(body.error?.message ?? "preview failed");
  }
  return body.data;
}

export function driveTargetItemIdFromRoute(route: string | undefined): string | undefined {
  if (!route) return undefined;
  try {
    const url = new URL(route.replaceAll("&amp;", "&"), "http://workhub.local");
    return url.searchParams.get("item_id") ?? url.searchParams.get("itemId") ?? undefined;
  } catch {
    const query = route.replaceAll("&amp;", "&").split("?")[1];
    if (!query) return undefined;
    const params = new URLSearchParams(query);
    return params.get("item_id") ?? params.get("itemId") ?? undefined;
  }
}

export async function downloadDriveResource(href: string, fallbackName: string): Promise<void> {
  const response = await fetchDriveResource(href);
  if (!response.ok) {
    let message = "download failed";
    try {
      const body = await response.clone().json() as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      // Non-JSON error bodies fall back to the generic action copy.
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filenameFromContentDisposition(response.headers.get("Content-Disposition"), fallbackName);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function drivePreviewPanelHtml(preview: DrivePreviewData, zh: boolean, apiBaseUrl?: string): string {
  return `<section class="wh-spot-drive-section" data-drive-preview-panel="true">
    <div class="wh-spot-card-actions" style="justify-content:space-between;margin-top:0">
      <p class="wh-spot-reasons-q" style="margin:0">${escapeHtml(zh ? `预览：${preview.filename}` : `Preview: ${preview.filename}`)}</p>
      <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-drive-preview-close="true">${zh ? "收起" : "Close"}</button>
    </div>
    <pre class="wh-spot-row-sub wh-spot-drive-preview-text">${escapeHtml(preview.text)}</pre>
    ${preview.truncated ? `<p class="wh-spot-row-sub">${zh ? "内容较长，仅显示前一部分。" : "Large file; showing the first part."}</p>` : ""}
    <div class="wh-spot-card-actions">
      <a class="wh-spot-act wh-spot-act--quiet ds-pressable" href="${escapeHtml(driveResourceHref(preview.download_href, apiBaseUrl))}" data-drive-resource="download" target="_blank" rel="noreferrer">${zh ? "下载完整文件" : "Download full file"}</a>
    </div>
  </section>`;
}

function itemRow(item: DriveItemVM, zh: boolean, canManage: boolean, selected: boolean, apiBaseUrl?: string): string {
  const icon = item.kind === "folder" ? FOLDER_ICON : FILE_ICON;
  const meta =
    item.kind === "folder"
      ? `${item.children_count} ${zh ? "项" : "items"}`
      : `${fmtSize(item.current_version?.size_bytes)}${item.accepted_deliverable ? ` · ${zh ? "AI 交付" : "AI deliverable"}` : ""}`;
  // AI 交付物预览/下载是 API 链接：桌面 webview 用 target=_blank 外开(与知识检索证据链一致)，不替换聚焦盒。
  const deliverable = item.accepted_deliverable;
  const links: string[] = [];
  const previewHref = item.preview_href ?? deliverable?.preview_href;
  const downloadHref = item.download_href ?? deliverable?.download_href;
  if (previewHref) {
    links.push(`<a class="wh-spot-act wh-spot-act--quiet ds-pressable" href="${escapeHtml(driveResourceHref(previewHref, apiBaseUrl))}" data-drive-resource="preview" target="_blank" rel="noreferrer">${zh ? "预览" : "Preview"}</a>`);
  }
  if (downloadHref) {
    links.push(`<a class="wh-spot-act wh-spot-act--quiet ds-pressable" href="${escapeHtml(driveResourceHref(downloadHref, apiBaseUrl))}" data-drive-resource="download" target="_blank" rel="noreferrer">${zh ? "下载" : "Download"}</a>`);
  }
  // 删除走 client.deleteDriveItem(带 expected_current_version_id 乐观并发)。只在服务端真会受理时才显示：
  // 镜像 drive-pages 的候选判定(非 AI 交付物、文件或空文件夹)——否则点了必 409,徒留「删除失败」。
  const deletable = canManage && !item.accepted_deliverable && (item.kind === "file" || item.children_count === 0);
  const del = deletable
    ? `<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-drive-delete="${escapeHtml(item.id)}" data-drive-delete-version="${escapeHtml(item.current_version_id ?? "")}">${zh ? "删除" : "Delete"}</button>`
    : "";
  const actions = links.length || del ? `<div class="wh-spot-card-actions" style="margin-top:0">${links.join("")}${del}</div>` : "";
  const current = selected ? `<span class="wh-spot-row-current">${zh ? "当前" : "Current"}</span>` : "";
  return `<div class="wh-spot-row" data-drive-item="${escapeHtml(item.id)}" data-drive-item-selected="${selected ? "true" : "false"}"${selected ? ` aria-current="true"` : ""}>
    <span class="wh-spot-file-icon">${icon}</span>
    <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(item.name)}</div><div class="wh-spot-row-sub">${escapeHtml(meta)}</div></div>
    ${current}
    ${actions}
  </div>`;
}

function deletedRow(item: DriveItemVM, zh: boolean): string {
  const restore = item.restore_href
    ? `<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-drive-restore="${escapeHtml(item.id)}">${zh ? "恢复" : "Restore"}</button>`
    : "";
  return `<div class="wh-spot-row">
    <span class="wh-spot-file-icon" style="color:var(--ds-ink-faint)">${item.kind === "folder" ? FOLDER_ICON : FILE_ICON}</span>
    <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(item.name)}</div><div class="wh-spot-row-sub">${zh ? "已删除" : "deleted"}</div></div>
    ${restore}
  </div>`;
}

function visibleDriveItems(items: readonly DriveItemVM[], selectedItemId: string | undefined): DriveItemVM[] {
  const selected = selectedItemId ? items.find((item) => item.id === selectedItemId) : undefined;
  if (!selected) {
    return items.slice(0, 40);
  }
  const firstPage = items.slice(0, 40);
  if (firstPage.some((item) => item.id === selected.id)) {
    return firstPage;
  }
  return [selected, ...items.filter((item) => item.id !== selected.id).slice(0, 39)];
}

export function driveHtml(vm: DrivePageVM, projectChips: string, zh: boolean, apiBaseUrl?: string): string {
  const s = vm.summary;
  const items = vm.items ?? [];
  const deleted = vm.deleted_items ?? [];
  const canManage = vm.can_manage;
  const summary = `<div class="wh-spot-metrics">
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "文件" : "Files"}</span><span class="wh-spot-metric-v">${s.file_count}</span></div>
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "版本" : "Versions"}</span><span class="wh-spot-metric-v">${s.version_count}</span></div>
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "AI 交付" : "Deliverables"}</span><span class="wh-spot-metric-v">${s.accepted_deliverable_count}</span></div>
  </div>`;
  const uploadBtn = vm.actions.upload_file
    ? `<div class="wh-spot-card-actions"><label class="wh-spot-act wh-spot-act--primary ds-pressable wh-spot-upload-label"><span data-drive-upload-label>${zh ? "＋ 上传文件" : "＋ Upload file"}</span><input class="wh-spot-file-input" type="file" data-drive-upload-picker /></label></div>`
    : "";
  const list = items.length
    ? `<div class="wh-spot-list ds-stagger">${visibleDriveItems(items, vm.selected_item_id).map((i) => itemRow(i, zh, canManage, i.id === vm.selected_item_id, apiBaseUrl)).join("")}</div>${items.length > 40 ? `<p class="wh-spot-card-desc" data-drive-list-overflow="${items.length - 40}">${zh ? `只显示前 40 项（共 ${items.length} 项），全部文件去网页版网盘看。` : `Showing the first 40 of ${items.length} items — open the web drive for the full list.`}</p>` : ""}`
    : `<p class="wh-spot-bubble-note" style="color:var(--ds-ink-muted)">${zh ? "这个项目还没有文件" : "No files in this project yet"}</p>`;
  const deletedBlock = deleted.length
    ? `<div class="wh-spot-drive-section"><p class="wh-spot-reasons-q">${zh ? "回收站" : "Recently deleted"}</p><div class="wh-spot-list">${deleted.slice(0, 12).map((i) => deletedRow(i, zh)).join("")}</div>${deleted.length > 12 ? `<p class="wh-spot-card-desc">${zh ? `还有 ${deleted.length - 12} 项，去网页版回收站细看。` : `${deleted.length - 12} more in the web recycle bin.`}</p>` : ""}</div>`
    : "";
  return `<div class="wh-spot-know">${projectChips}${summary}${uploadBtn}${list}${deletedBlock}</div>`;
}

export function driveNoProjectsEmptyHtml(zh: boolean): string {
  // L-01（R24 S3 走查）：曾是一个 emoji 文件夹——换成本文件已有的 FOLDER_ICON（同一套线性描边
  // 语汇，SVG stroke=currentColor 继承 .wh-spot-empty-face 的强调色），不是新造视觉语言。
  return `<div class="wh-spot-empty">
    <div class="wh-spot-empty-face">${FOLDER_ICON}</div>
    <h3 class="wh-spot-empty-title">${zh ? "还没有项目" : "No projects"}</h3>
    <p class="wh-spot-empty-sub">${zh ? "先交给 Cuu 一个任务，它会自动建立项目和网盘。" : "Create a task and Cuu will create the project and drive."}</p>
    <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-drive-open-intake="true">${zh ? "＋ 新任务 / 交给 AI" : "＋ New task / Ask AI"}</button>
  </div>`;
}

export function createDriveView(): SpotlightCapabilityView {
  return {
    id: "drive",
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      let disposed = false;
      let busy = false;
      // rank9：单调代次——切项目时旧项目的晚到 await 不得覆盖新项目的文件列表。
      let loadGen = 0;
      // rank7：上次失败的加载器，点「重试」即重跑。
      let retry: (() => void) | undefined;
      let projects: { id: string; name: string }[] = [];
      let projectId: string | undefined;
      let targetItemId = driveTargetItemIdFromRoute(ctx.target?.route);
      ctx.setSubtitle(zh ? "文件与 AI 交付物" : "Files & deliverables");

      const chips = (): string => {
        if (projects.length <= 1) return "";
        return `<div class="wh-spot-know-projects">${projects
          .map((p) => `<button type="button" class="wh-spot-reason" data-drive-proj="${escapeHtml(p.id)}" data-sel="${p.id === projectId}">${escapeHtml(p.name)}</button>`)
          .join("")}</div>`;
      };

      const loadDrive = async () => {
        if (!projectId) return;
        const gen = ++loadGen;
        const reqProjectId = projectId;
        ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉文件…" : "Loading files…"}</div>`;
        ctx.requestResize();
        try {
          const vm = await ctx.client.pages.drive({ project_id: reqProjectId, locale: ctx.locale, ...(targetItemId ? { itemId: targetItemId } : {}) });
          if (disposed || gen !== loadGen) return;
          const proj = projects.find((p) => p.id === reqProjectId);
          ctx.setSubtitle(proj ? proj.name : zh ? "网盘" : "Drive");
          ctx.body.innerHTML = driveHtml(vm, chips(), zh, driveResourceApiBase());
        } catch {
          if (disposed || gen !== loadGen) return;
          retry = () => void loadDrive();
          ctx.body.innerHTML = spotlightErrorHtml(zh, zh ? "文件没拉到" : "Couldn't load files");
        }
        ctx.requestResize();
      };

      ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在准备…" : "Preparing…"}</div>`;
      ctx.requestResize();
      void (async () => {
        try {
          const list = await ctx.client.listProjects();
          projects = list.projects.map((p) => ({ id: p.id, name: p.name }));
          // rank14/13：若带了目标项目 id（从「项目」能力点入/深链）且存在，则直接打开它；否则默认第一个。
          const wanted = ctx.target?.id;
          projectId = wanted && projects.some((p) => p.id === wanted) ? wanted : projects[0]?.id;
        } catch {
          // 走空态
        }
        if (disposed) return;
        if (!projectId) {
          ctx.body.innerHTML = driveNoProjectsEmptyHtml(zh);
          ctx.requestResize();
          return;
        }
        await loadDrive();
      })();

      ctx.body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const resource = target.closest<HTMLAnchorElement>("a[data-drive-resource]");
        if (resource?.href) {
          event.preventDefault();
          if (resource.dataset.driveResource === "preview") {
            const label = resource.textContent;
            resource.textContent = zh ? "预览中…" : "Opening…";
            void fetchDrivePreview(resource.href)
              .then((preview) => {
                ctx.body.querySelector("[data-drive-preview-panel]")?.remove();
                ctx.body.insertAdjacentHTML("afterbegin", drivePreviewPanelHtml(preview, zh, driveResourceApiBase()));
                ctx.requestResize();
              })
              .catch((error) => ctx.toast(error instanceof Error ? error.message : zh ? "预览失败" : "Preview failed", "error"))
              .finally(() => {
                resource.textContent = label;
              });
            return;
          }
          const fallbackName = resource.closest(".wh-spot-row")?.querySelector(".wh-spot-row-title")?.textContent?.trim() || "download";
          const label = resource.textContent;
          resource.textContent = zh ? "下载中…" : "Downloading…";
          void downloadDriveResource(resource.href, fallbackName)
            .then(() => ctx.toast(zh ? "已开始下载" : "Download started", "ok"))
            .catch((error) => ctx.toast(error instanceof Error ? error.message : zh ? "下载失败" : "Download failed", "error"))
            .finally(() => {
              resource.textContent = label;
            });
          return;
        }
        if (target.closest("[data-drive-preview-close]")) {
          ctx.body.querySelector("[data-drive-preview-panel]")?.remove();
          ctx.requestResize();
          return;
        }
        if (target.closest("[data-spot-retry]")) {
          retry?.();
          return;
        }
        if (target.closest("[data-drive-open-intake]")) {
          ctx.open("intake");
          return;
        }
        const proj = target.closest<HTMLElement>("[data-drive-proj]");
        if (proj?.dataset.driveProj) {
          // rank26：恢复进行中不切项目，否则恢复完成的回执/重载会落到另一个项目。
          if (busy || proj.dataset.driveProj === projectId) return;
          projectId = proj.dataset.driveProj;
          targetItemId = undefined;
          void loadDrive();
          return;
        }
        const del = target.closest<HTMLElement>("[data-drive-delete]");
        if (del?.dataset.driveDelete && projectId && !busy) {
          busy = true;
          const itemId = del.dataset.driveDelete;
          const versionId = del.dataset.driveDeleteVersion || undefined;
          del.textContent = zh ? "删除中…" : "Deleting…";
          void ctx.client
            .deleteDriveItem(projectId, itemId, { expected_current_version_id: versionId ?? null }, { locale: ctx.locale })
            .then(() => ctx.toast(zh ? "已删除（在回收站可恢复）" : "Deleted (restorable in recycle bin)", "ok"))
            .catch(() => ctx.toast(zh ? "删除失败" : "Delete failed", "error"))
            .finally(() => {
              busy = false;
              void loadDrive();
            });
          return;
        }
        const restore = target.closest<HTMLElement>("[data-drive-restore]");
        if (restore?.dataset.driveRestore && projectId && !busy) {
          busy = true;
          const itemId = restore.dataset.driveRestore;
          restore.textContent = zh ? "恢复中…" : "Restoring…";
          void ctx.client
            .restoreDriveItem(projectId, itemId, { locale: ctx.locale })
            .then(() => {
              ctx.toast(zh ? "已恢复" : "Restored", "ok");
            })
            .catch(() => ctx.toast(zh ? "恢复失败" : "Restore failed", "error"))
            .finally(() => {
              busy = false;
              void loadDrive();
            });
        }
      });

      ctx.body.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || !target.matches("[data-drive-upload-picker]") || !projectId || busy) {
          return;
        }
        const file = target.files?.[0];
        if (!file) return;
        busy = true;
        const label = target.closest<HTMLElement>(".wh-spot-upload-label");
        const labelText = label?.querySelector<HTMLElement>("[data-drive-upload-label]");
        if (labelText) labelText.textContent = zh ? "上传中…" : "Uploading…";
        void ctx.client.uploadDriveFile(projectId, { file }, { locale: ctx.locale })
          .then(() => ctx.toast(zh ? "已上传文件" : "File uploaded", "ok"))
          .catch(() => ctx.toast(zh ? "上传失败" : "Upload failed", "error"))
          .finally(() => {
            target.value = "";
            busy = false;
            void loadDrive();
          });
      });

      return () => {
        disposed = true;
      };
    }
  };
}
