// WorkHub 桌面 · Spotlight「网盘」能力内联视图（S6，网盘同步是核心）。
// 选项目 → pages.drive → 统一玻璃文件/文件夹浏览 + 摘要 + 已删除项一键恢复（restoreDriveItem）。
// API：pages.drive 需 project_id（与知识检索同理先选项目）；恢复走 client.restoreDriveItem。

import type { DriveItemVM, DrivePageVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";

const FOLDER_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const FILE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

function fmtSize(bytes?: number): string {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function itemRow(item: DriveItemVM, zh: boolean): string {
  const icon = item.kind === "folder" ? FOLDER_ICON : FILE_ICON;
  const meta =
    item.kind === "folder"
      ? `${item.children_count} ${zh ? "项" : "items"}`
      : `${fmtSize(item.current_version?.size_bytes)}${item.accepted_deliverable ? ` · ${zh ? "AI 交付" : "AI deliverable"}` : ""}`;
  return `<div class="wh-spot-row">
    <span class="wh-spot-file-icon">${icon}</span>
    <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(item.name)}</div><div class="wh-spot-row-sub">${escapeHtml(meta)}</div></div>
  </div>`;
}

function deletedRow(item: DriveItemVM, zh: boolean): string {
  return `<div class="wh-spot-row">
    <span class="wh-spot-file-icon" style="color:var(--ds-ink-faint)">${item.kind === "folder" ? FOLDER_ICON : FILE_ICON}</span>
    <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(item.name)}</div><div class="wh-spot-row-sub">${zh ? "已删除" : "deleted"}</div></div>
    <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-drive-restore="${escapeHtml(item.id)}">${zh ? "恢复" : "Restore"}</button>
  </div>`;
}

function driveHtml(vm: DrivePageVM, projectChips: string, zh: boolean): string {
  const s = vm.summary;
  const items = vm.items ?? [];
  const deleted = vm.deleted_items ?? [];
  const summary = `<div class="wh-spot-metrics">
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "文件" : "Files"}</span><span class="wh-spot-metric-v">${s.file_count}</span></div>
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "版本" : "Versions"}</span><span class="wh-spot-metric-v">${s.version_count}</span></div>
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "AI 交付" : "Deliverables"}</span><span class="wh-spot-metric-v">${s.accepted_deliverable_count}</span></div>
  </div>`;
  const list = items.length
    ? `<div class="wh-spot-list ds-stagger">${items.slice(0, 40).map((i) => itemRow(i, zh)).join("")}</div>`
    : `<p class="wh-spot-bubble-note" style="color:var(--ds-ink-muted)">${zh ? "这个项目还没有文件" : "No files in this project yet"}</p>`;
  const deletedBlock = deleted.length
    ? `<div class="wh-spot-drive-section"><p class="wh-spot-reasons-q">${zh ? "回收站" : "Recently deleted"}</p><div class="wh-spot-list">${deleted.slice(0, 12).map((i) => deletedRow(i, zh)).join("")}</div></div>`
    : "";
  return `<div class="wh-spot-know">${projectChips}${summary}${list}${deletedBlock}</div>`;
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
          const vm = await ctx.client.pages.drive({ project_id: reqProjectId, locale: ctx.locale });
          if (disposed || gen !== loadGen) return;
          const proj = projects.find((p) => p.id === reqProjectId);
          ctx.setSubtitle(proj ? proj.name : zh ? "网盘" : "Drive");
          ctx.body.innerHTML = driveHtml(vm, chips(), zh);
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
          projectId = projects[0]?.id;
        } catch {
          // 走空态
        }
        if (disposed) return;
        if (!projectId) {
          ctx.body.innerHTML = `<div class="wh-spot-empty"><div class="wh-spot-empty-face">📁</div><h3 class="wh-spot-empty-title">${zh ? "还没有项目" : "No projects"}</h3><p class="wh-spot-empty-sub">${zh ? "派个活就会自动建项目和网盘" : "Dispatch a task to create one"}</p></div>`;
          ctx.requestResize();
          return;
        }
        await loadDrive();
      })();

      ctx.body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest("[data-spot-retry]")) {
          retry?.();
          return;
        }
        const proj = target.closest<HTMLElement>("[data-drive-proj]");
        if (proj?.dataset.driveProj) {
          // rank26：恢复进行中不切项目，否则恢复完成的回执/重载会落到另一个项目。
          if (busy || proj.dataset.driveProj === projectId) return;
          projectId = proj.dataset.driveProj;
          void loadDrive();
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

      return () => {
        disposed = true;
      };
    }
  };
}
