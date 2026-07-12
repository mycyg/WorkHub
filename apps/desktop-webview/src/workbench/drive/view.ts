// WorkHub 桌面 · 工作台网盘标签——imperative 挂载/事件绑定层（照 chat/view.ts 的分工：纯渲染在
// render.ts，这里只负责拉数据、绑 DOM 事件、维护标签内的瞬态状态：当前文件夹/上传中/操作出错）。
// 文件/文件夹列表严格复用既有 pages.drive 端点（不发明新查询参数——一次性拉整页 items，文件夹导航
// 在内存里按 parent_id 过滤 + 面包屑按 parent_id 链回溯，不追加 folder_id 之类的新参数）。

import type { WorkHubApiClient } from "@workhub/api-client";
import type { DriveItemVM, DrivePageVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { downloadDriveResource, driveResourceApiBase } from "../../spotlight/views/drive.js";
import {
  renderDriveBarHtml,
  renderDriveErrorHtml,
  renderDriveListHtml,
  renderDriveLoadingHtml,
  type DriveBreadcrumbCrumb
} from "./render.js";
import type { DriveSidePanelHandle } from "./side-panel.js";

type Locale = "zh-CN" | "en-US";

export type DriveTabApiClient = Pick<WorkHubApiClient, "pages" | "uploadDriveFile" | "deleteDriveItem" | "restoreDriveItem">;

export type DriveViewHandle = {
  dispose: () => void;
  // 侧栏回滚成功后调用——重新拉这个项目的网盘页(受影响文件的大小/更新时间变了),不重开整个视图。
  refresh: () => void;
};

function buildBreadcrumb(items: readonly DriveItemVM[], folderId: string | undefined, projectName: string): DriveBreadcrumbCrumb[] {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const chain: DriveBreadcrumbCrumb[] = [];
  let cursor = folderId ? itemsById.get(folderId) : undefined;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift({ id: cursor.id, name: cursor.name });
    cursor = cursor.parent_id ? itemsById.get(cursor.parent_id) : undefined;
  }
  return [{ id: undefined, name: projectName }, ...chain];
}

export function mountDriveView(
  container: HTMLElement,
  input: {
    client: DriveTabApiClient;
    locale: Locale;
    projectId: string;
    projectName: string;
    sidePanel: DriveSidePanelHandle;
  }
): DriveViewHandle {
  let disposed = false;
  let vm: DrivePageVM | undefined;
  let vmLoad: "loading" | "ready" | "error" = "loading";
  let currentFolderId: string | undefined;
  let uploading = false;
  let actionError: string | undefined;
  let loadGeneration = 0;

  function render(): void {
    if (disposed) {
      return;
    }
    if (vmLoad === "loading" || !vm) {
      container.innerHTML = renderDriveLoadingHtml(input.locale);
      return;
    }
    if (vmLoad === "error") {
      container.innerHTML = renderDriveErrorHtml(input.locale);
      return;
    }
    const zh = input.locale === "zh-CN";
    const breadcrumb = buildBreadcrumb(vm.items, currentFolderId, input.projectName);
    const visibleItems = vm.items.filter((item) => (item.parent_id ?? undefined) === currentFolderId);
    const errorBanner = actionError
      ? `<p class="wh-wb-drive-action-error">${escapeHtml(actionError)}</p>`
      : "";
    container.innerHTML = `<div class="wh-wb-drive">${renderDriveBarHtml({
      locale: input.locale,
      breadcrumb,
      canUpload: vm.can_manage && !uploading
    })}${errorBanner}${renderDriveListHtml({
      locale: input.locale,
      items: visibleItems,
      canManage: vm.can_manage,
      apiBaseUrl: driveResourceApiBase()
    })}</div>`;
    if (uploading) {
      const label = container.querySelector<HTMLElement>("[data-wb-drive-upload-label]");
      if (label) {
        label.textContent = zh ? "上传中…" : "Uploading…";
      }
    }
  }

  async function load(): Promise<void> {
    const generation = ++loadGeneration;
    vmLoad = "loading";
    render();
    try {
      const page = await input.client.pages.drive({ project_id: input.projectId, locale: input.locale });
      if (disposed || generation !== loadGeneration) {
        return;
      }
      vm = page;
      vmLoad = "ready";
      render();
    } catch {
      if (disposed || generation !== loadGeneration) {
        return;
      }
      vmLoad = "error";
      render();
    }
  }

  container.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const target = event.target;
    if (target.closest("[data-wb-drive-retry]")) {
      void load();
      return;
    }
    const folderBtn = target.closest<HTMLElement>("[data-wb-drive-open-folder]");
    if (folderBtn) {
      const id = folderBtn.dataset.wbDriveOpenFolder;
      currentFolderId = id ? id : undefined;
      render();
      return;
    }
    const downloadAnchor = target.closest<HTMLAnchorElement>("a[data-wb-drive-download]");
    if (downloadAnchor) {
      event.preventDefault();
      const name = downloadAnchor.dataset.wbDriveDownloadName ?? "download";
      void downloadDriveResource(downloadAnchor.href, name).catch(() => {
        actionError = input.locale === "zh-CN" ? "下载失败" : "Download failed";
        render();
      });
      return;
    }
    const versionsBtn = target.closest<HTMLElement>("[data-wb-drive-open-versions]");
    if (versionsBtn?.dataset.wbDriveOpenVersions) {
      input.sidePanel.showVersions({
        projectId: input.projectId,
        itemId: versionsBtn.dataset.wbDriveOpenVersions,
        itemName: versionsBtn.dataset.wbDriveOpenVersionsName ?? ""
      });
      return;
    }
    const deleteBtn = target.closest<HTMLElement>("[data-wb-drive-delete]");
    if (deleteBtn?.dataset.wbDriveDelete) {
      const itemId = deleteBtn.dataset.wbDriveDelete;
      const versionId = deleteBtn.dataset.wbDriveDeleteVersion || undefined;
      actionError = undefined;
      void input.client
        .deleteDriveItem(input.projectId, itemId, { expected_current_version_id: versionId ?? null }, { locale: input.locale })
        .then(() => {
          void load();
        })
        .catch(() => {
          actionError = input.locale === "zh-CN" ? "删除失败" : "Delete failed";
          render();
        });
      return;
    }
    // 行内其余点击（不是操作按钮/下载链接）都当作「打开预览」——文件行本身可点，照 prototype 的
    // fitem onclick=openPreview 行为。data-wb-drive-open-item 挂在整行容器上（见 render.ts）。
    const itemRow = target.closest<HTMLElement>("[data-wb-drive-open-item]");
    if (itemRow?.dataset.wbDriveOpenItem) {
      input.sidePanel.showPreview({
        projectId: input.projectId,
        itemId: itemRow.dataset.wbDriveOpenItem,
        itemName: itemRow.dataset.wbDriveOpenItemName ?? ""
      });
    }
  });

  container.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.matches("[data-wb-drive-upload-picker]") || uploading) {
      return;
    }
    const file = target.files?.[0];
    if (!file) {
      return;
    }
    uploading = true;
    actionError = undefined;
    render();
    void input.client
      .uploadDriveFile(input.projectId, { file }, { locale: input.locale })
      .then(() => {
        uploading = false;
        void load();
      })
      .catch(() => {
        uploading = false;
        actionError = input.locale === "zh-CN" ? "上传失败" : "Upload failed";
        render();
      });
  });

  void load();

  return {
    dispose: () => {
      disposed = true;
    },
    refresh: () => {
      void load();
    }
  };
}
