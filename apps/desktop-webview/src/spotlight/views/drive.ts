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

import { spotlightViewsT } from "./locales.js";

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

// R24 修正（走查遗留）：令牌失效时**不再**用硬编码昵称「WorkHub Desktop」悄悄重新报到——那会把已选自定义
// 昵称的用户绑到另一个身份（甚至合并成同一个账号）。正确做法与主窗/设置页登出同口径：清掉本地令牌、
// 通知壳层与其它窗口「已登出」，让用户走回登录门重新确认身份；本次请求按失败返回，由视图渲出错。
async function refreshDriveResourceToken(_apiBaseUrl: string): Promise<boolean> {
  clearDriveResourceToken();
  try {
    const scope = globalThis as { __TAURI__?: { event?: { emit?: (name: string) => Promise<void> | void } } };
    await Promise.resolve(scope.__TAURI__?.event?.emit?.("workhub-logged-out"));
  } catch {
    // 通知失败不影响主流程：令牌已清，下一次任何请求都会落回登录门。
  }
  return false;
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

// R24 S1 · C1（单 origin 钉死）：打包后的 CSP connect-src 已从「只放行本机回环」放开到 http:/https:
// （否则连不上自托管的远端服务器，见 tauri.conf.json 与 desktop-api-base.ts 顶部注释）。网盘资源的
// href 来自服务端响应（download_href / preview_href），而 fetchDriveResource 会给请求带上设备令牌头——
// 一条被污染的绝对 href 就能把令牌送到第三方主机。这里在发出前钉死：href 解析出的 origin 必须等于当前
// 配置的服务器地址 origin，不等就拒（抛错，绝不降级为「照发一次看看」）。同 api-client 的
// resolveWorkHubApiUrl 与桌面 run 流的 DSK-08 同源校验一个口径。
export function assertDriveResourceSameOrigin(href: string, apiBaseUrl: string): void {
  let expected: string;
  try {
    expected = new URL(apiBaseUrl).origin;
  } catch {
    // 基地址不是绝对地址（相对代理模式）：href 会解析到页面自身源，没有跨源可言。
    return;
  }
  let target: URL;
  try {
    target = new URL(href, apiBaseUrl);
  } catch {
    throw new Error(`Refused unparsable drive resource URL: ${href}`);
  }
  if (target.origin !== expected) {
    throw new Error(`Refused cross-origin drive resource URL: ${href}`);
  }
}

export async function fetchDriveResource(href: string, init: RequestInit = {}, apiBaseUrl = driveResourceApiBase()): Promise<Response> {
  assertDriveResourceSameOrigin(href, apiBaseUrl);
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
      <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-drive-preview-close="true">${spotlightViewsT(zh, "close")}</button>
    </div>
    <pre class="wh-spot-row-sub wh-spot-drive-preview-text">${escapeHtml(preview.text)}</pre>
    ${preview.truncated ? `<p class="wh-spot-row-sub">${spotlightViewsT(zh, "largeFileShowingTheFirstPart")}</p>` : ""}
    <div class="wh-spot-card-actions">
      <a class="wh-spot-act wh-spot-act--quiet ds-pressable" href="${escapeHtml(driveResourceHref(preview.download_href, apiBaseUrl))}" data-drive-resource="download" target="_blank" rel="noreferrer">${spotlightViewsT(zh, "downloadFullFile")}</a>
    </div>
  </section>`;
}

function itemRow(item: DriveItemVM, zh: boolean, canManage: boolean, selected: boolean, apiBaseUrl?: string): string {
  const icon = item.kind === "folder" ? FOLDER_ICON : FILE_ICON;
  const meta =
    item.kind === "folder"
      ? `${item.children_count} ${spotlightViewsT(zh, "items")}`
      : `${fmtSize(item.current_version?.size_bytes)}${item.accepted_deliverable ? ` · ${spotlightViewsT(zh, "aiDeliverable")}` : ""}`;
  // AI 交付物预览/下载是 API 链接：桌面 webview 用 target=_blank 外开(与知识检索证据链一致)，不替换聚焦盒。
  const deliverable = item.accepted_deliverable;
  const links: string[] = [];
  const previewHref = item.preview_href ?? deliverable?.preview_href;
  const downloadHref = item.download_href ?? deliverable?.download_href;
  if (previewHref) {
    links.push(`<a class="wh-spot-act wh-spot-act--quiet ds-pressable" href="${escapeHtml(driveResourceHref(previewHref, apiBaseUrl))}" data-drive-resource="preview" target="_blank" rel="noreferrer">${spotlightViewsT(zh, "preview")}</a>`);
  }
  if (downloadHref) {
    links.push(`<a class="wh-spot-act wh-spot-act--quiet ds-pressable" href="${escapeHtml(driveResourceHref(downloadHref, apiBaseUrl))}" data-drive-resource="download" target="_blank" rel="noreferrer">${spotlightViewsT(zh, "download")}</a>`);
  }
  // 删除走 client.deleteDriveItem(带 expected_current_version_id 乐观并发)。只在服务端真会受理时才显示：
  // 镜像 drive-pages 的候选判定(非 AI 交付物、文件或空文件夹)——否则点了必 409,徒留「删除失败」。
  const deletable = canManage && !item.accepted_deliverable && (item.kind === "file" || item.children_count === 0);
  const del = deletable
    ? `<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-drive-delete="${escapeHtml(item.id)}" data-drive-delete-version="${escapeHtml(item.current_version_id ?? "")}">${spotlightViewsT(zh, "delete")}</button>`
    : "";
  const actions = links.length || del ? `<div class="wh-spot-card-actions" style="margin-top:0">${links.join("")}${del}</div>` : "";
  const current = selected ? `<span class="wh-spot-row-current">${spotlightViewsT(zh, "current")}</span>` : "";
  return `<div class="wh-spot-row" data-drive-item="${escapeHtml(item.id)}" data-drive-item-selected="${selected ? "true" : "false"}"${selected ? ` aria-current="true"` : ""}>
    <span class="wh-spot-file-icon">${icon}</span>
    <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(item.name)}</div><div class="wh-spot-row-sub">${escapeHtml(meta)}</div></div>
    ${current}
    ${actions}
  </div>`;
}

function deletedRow(item: DriveItemVM, zh: boolean): string {
  const restore = item.restore_href
    ? `<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-drive-restore="${escapeHtml(item.id)}">${spotlightViewsT(zh, "restore")}</button>`
    : "";
  return `<div class="wh-spot-row">
    <span class="wh-spot-file-icon" style="color:var(--ds-ink-faint)">${item.kind === "folder" ? FOLDER_ICON : FILE_ICON}</span>
    <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(item.name)}</div><div class="wh-spot-row-sub">${spotlightViewsT(zh, "deleted")}</div></div>
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
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "files")}</span><span class="wh-spot-metric-v">${s.file_count}</span></div>
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "versions")}</span><span class="wh-spot-metric-v">${s.version_count}</span></div>
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "deliverables")}</span><span class="wh-spot-metric-v">${s.accepted_deliverable_count}</span></div>
  </div>`;
  const uploadBtn = vm.actions.upload_file
    ? `<div class="wh-spot-card-actions"><label class="wh-spot-act wh-spot-act--primary ds-pressable wh-spot-upload-label"><span data-drive-upload-label>${spotlightViewsT(zh, "uploadFile")}</span><input class="wh-spot-file-input" type="file" data-drive-upload-picker /></label></div>`
    : "";
  const list = items.length
    ? `<div class="wh-spot-list ds-stagger">${visibleDriveItems(items, vm.selected_item_id).map((i) => itemRow(i, zh, canManage, i.id === vm.selected_item_id, apiBaseUrl)).join("")}</div>${items.length > 40 ? `<p class="wh-spot-card-desc" data-drive-list-overflow="${items.length - 40}">${zh ? `只显示前 40 项（共 ${items.length} 项），全部文件去网页版网盘看。` : `Showing the first 40 of ${items.length} items — open the web drive for the full list.`}</p>` : ""}`
    : `<p class="wh-spot-bubble-note" style="color:var(--ds-ink-muted)">${spotlightViewsT(zh, "noFilesInThisProjectYet")}</p>`;
  const deletedBlock = deleted.length
    ? `<div class="wh-spot-drive-section"><p class="wh-spot-reasons-q">${spotlightViewsT(zh, "recentlyDeleted")}</p><div class="wh-spot-list">${deleted.slice(0, 12).map((i) => deletedRow(i, zh)).join("")}</div>${deleted.length > 12 ? `<p class="wh-spot-card-desc">${zh ? `还有 ${deleted.length - 12} 项，去网页版回收站细看。` : `${deleted.length - 12} more in the web recycle bin.`}</p>` : ""}</div>`
    : "";
  return `<div class="wh-spot-know">${projectChips}${summary}${uploadBtn}${list}${deletedBlock}</div>`;
}

export function driveNoProjectsEmptyHtml(zh: boolean): string {
  // L-01（R24 S3 走查）：曾是一个 emoji 文件夹——换成本文件已有的 FOLDER_ICON（同一套线性描边
  // 语汇，SVG stroke=currentColor 继承 .wh-spot-empty-face 的强调色），不是新造视觉语言。
  return `<div class="wh-spot-empty">
    <div class="wh-spot-empty-face">${FOLDER_ICON}</div>
    <h3 class="wh-spot-empty-title">${spotlightViewsT(zh, "noProjects")}</h3>
    <p class="wh-spot-empty-sub">${spotlightViewsT(zh, "createATaskAndCuuWill")}</p>
    <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-drive-open-intake="true">${spotlightViewsT(zh, "newTaskAskAi")}</button>
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
      ctx.setSubtitle(spotlightViewsT(ctx.locale, "filesDeliverables"));

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
        ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(ctx.locale, "loadingFiles")}</div>`;
        ctx.requestResize();
        try {
          const vm = await ctx.client.pages.drive({ project_id: reqProjectId, locale: ctx.locale, ...(targetItemId ? { itemId: targetItemId } : {}) });
          if (disposed || gen !== loadGen) return;
          const proj = projects.find((p) => p.id === reqProjectId);
          ctx.setSubtitle(proj ? proj.name : spotlightViewsT(ctx.locale, "drive"));
          ctx.body.innerHTML = driveHtml(vm, chips(), zh, driveResourceApiBase());
        } catch {
          if (disposed || gen !== loadGen) return;
          retry = () => void loadDrive();
          ctx.body.innerHTML = spotlightErrorHtml(zh, spotlightViewsT(ctx.locale, "couldnTLoadFiles"));
        }
        ctx.requestResize();
      };

      ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(ctx.locale, "preparing")}</div>`;
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
            resource.textContent = spotlightViewsT(ctx.locale, "opening");
            void fetchDrivePreview(resource.href)
              .then((preview) => {
                ctx.body.querySelector("[data-drive-preview-panel]")?.remove();
                ctx.body.insertAdjacentHTML("afterbegin", drivePreviewPanelHtml(preview, zh, driveResourceApiBase()));
                ctx.requestResize();
              })
              .catch((error) => ctx.toast(error instanceof Error ? error.message : spotlightViewsT(ctx.locale, "previewFailed"), "error"))
              .finally(() => {
                resource.textContent = label;
              });
            return;
          }
          const fallbackName = resource.closest(".wh-spot-row")?.querySelector(".wh-spot-row-title")?.textContent?.trim() || "download";
          const label = resource.textContent;
          resource.textContent = spotlightViewsT(ctx.locale, "downloading");
          void downloadDriveResource(resource.href, fallbackName)
            .then(() => ctx.toast(spotlightViewsT(ctx.locale, "downloadStarted"), "ok"))
            .catch((error) => ctx.toast(error instanceof Error ? error.message : spotlightViewsT(ctx.locale, "downloadFailed"), "error"))
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
          del.textContent = spotlightViewsT(ctx.locale, "deleting");
          void ctx.client
            .deleteDriveItem(projectId, itemId, { expected_current_version_id: versionId ?? null }, { locale: ctx.locale })
            .then(() => ctx.toast(spotlightViewsT(ctx.locale, "deletedRestorableInRecycleBin"), "ok"))
            .catch(() => ctx.toast(spotlightViewsT(ctx.locale, "deleteFailed"), "error"))
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
          restore.textContent = spotlightViewsT(ctx.locale, "restoring");
          void ctx.client
            .restoreDriveItem(projectId, itemId, { locale: ctx.locale })
            .then(() => {
              ctx.toast(spotlightViewsT(ctx.locale, "restored"), "ok");
            })
            .catch(() => ctx.toast(spotlightViewsT(ctx.locale, "restoreFailed"), "error"))
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
        if (labelText) labelText.textContent = spotlightViewsT(ctx.locale, "uploading");
        void ctx.client.uploadDriveFile(projectId, { file }, { locale: ctx.locale })
          .then(() => ctx.toast(spotlightViewsT(ctx.locale, "fileUploaded"), "ok"))
          .catch(() => ctx.toast(spotlightViewsT(ctx.locale, "uploadFailed"), "error"))
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
