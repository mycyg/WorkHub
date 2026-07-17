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
  renderDriveRecycleHtml,
  type DriveBreadcrumbCrumb
} from "./render.js";
import type { DriveSidePanelHandle } from "./side-panel.js";

type Locale = "zh-CN" | "en-US";

// R20 DSK-UX（R19-23）：删除两段式确认——第一下只武装、5 秒内对同一项再点一次才真发请求（照 GitHub 解绑 /
// 版本回滚两端对齐的既有 5 秒先例）。超时自动解除武装。
const DRIVE_DELETE_ARM_TIMEOUT_MS = 5000;

export type DriveTabApiClient = Pick<WorkHubApiClient, "pages" | "uploadDriveFile" | "deleteDriveItem" | "restoreDriveItem">;

// R20 DSK-UX（R19-23）：删除两段式确认的纯判定（照 side-panel.ts 的 decideRollbackConfirmation：这个
// workspace 的测试运行器无真实 DOM，把点击处理器里的分支逻辑抽成不碰 DOM 的纯函数单独钉死）。
// 同一项在武装态下再点=真删；未武装或点了另一项=（重新）武装那一项。
export function decideDriveDeleteConfirmation(
  armedItemId: string | undefined,
  clickedItemId: string
): { kind: "arm" | "execute"; itemId: string } {
  if (armedItemId === clickedItemId) {
    return { kind: "execute", itemId: clickedItemId };
  }
  return { kind: "arm", itemId: clickedItemId };
}

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
  // R20 DSK-UX（R19-23）：删除成功后的「已移到回收站，可恢复」回执（诚实告知软删可恢复，同 web/Spotlight）。
  let actionNotice: string | undefined;
  let loadGeneration = 0;
  // R20 DSK-UX（R19-23）：回收站视图开关 + 删除两段式确认武装态 + 还原进行中/失败态。
  let recycleView = false;
  let deleteArmedItemId: string | undefined;
  let deleteArmTimer: ReturnType<typeof setTimeout> | undefined;
  let restoreBusyId: string | undefined;
  let restoreErrorId: string | undefined;
  let restoreErrorText: string | undefined;

  function clearDeleteArm(): void {
    deleteArmedItemId = undefined;
    if (deleteArmTimer !== undefined) {
      clearTimeout(deleteArmTimer);
      deleteArmTimer = undefined;
    }
  }

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
    const deletedItems = vm.deleted_items;
    const errorBanner = actionError
      ? `<p class="wh-wb-drive-action-error">${escapeHtml(actionError)}</p>`
      : "";
    const noticeBanner = actionNotice
      ? `<p class="wh-wb-drive-action-notice">${escapeHtml(actionNotice)}</p>`
      : "";
    if (recycleView) {
      container.innerHTML = `<div class="wh-wb-drive">${renderDriveBarHtml({
        locale: input.locale,
        breadcrumb: [],
        canUpload: false,
        recycleActive: true
      })}${errorBanner}${noticeBanner}${renderDriveRecycleHtml({
        locale: input.locale,
        items: deletedItems,
        ...(restoreBusyId ? { restoreBusyId } : {}),
        ...(restoreErrorId ? { restoreErrorId } : {}),
        ...(restoreErrorText ? { restoreErrorText } : {})
      })}</div>`;
      return;
    }
    const breadcrumb = buildBreadcrumb(vm.items, currentFolderId, input.projectName);
    const visibleItems = vm.items.filter((item) => (item.parent_id ?? undefined) === currentFolderId);
    container.innerHTML = `<div class="wh-wb-drive">${renderDriveBarHtml({
      locale: input.locale,
      breadcrumb,
      canUpload: vm.can_manage && !uploading,
      deletedCount: deletedItems.length
    })}${errorBanner}${noticeBanner}${renderDriveListHtml({
      locale: input.locale,
      items: visibleItems,
      canManage: vm.can_manage,
      apiBaseUrl: driveResourceApiBase(),
      ...(deleteArmedItemId ? { deleteArmedItemId } : {})
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

  function executeDelete(itemId: string, versionId: string | undefined): void {
    const zh = input.locale === "zh-CN";
    const name = vm?.items.find((item) => item.id === itemId)?.name;
    clearDeleteArm();
    actionError = undefined;
    actionNotice = undefined;
    render();
    void input.client
      .deleteDriveItem(input.projectId, itemId, { expected_current_version_id: versionId ?? null }, { locale: input.locale })
      .then(() => {
        if (disposed) {
          return;
        }
        // 诚实回执：软删可恢复，告诉用户回收站能找回（同 web/Spotlight 两端）。
        actionNotice = name
          ? (zh ? `已把「${name}」移到回收站，可在回收站找回。` : `Moved "${name}" to the recycle bin — recover it there anytime.`)
          : (zh ? "已移到回收站，可在回收站找回。" : "Moved to the recycle bin — recoverable there.");
        void load();
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        actionError = zh ? "删除失败" : "Delete failed";
        render();
      });
  }

  function restoreItem(itemId: string): void {
    const zh = input.locale === "zh-CN";
    restoreBusyId = itemId;
    restoreErrorId = undefined;
    restoreErrorText = undefined;
    render();
    void input.client
      .restoreDriveItem(input.projectId, itemId, { locale: input.locale })
      .then(() => {
        if (disposed) {
          return;
        }
        restoreBusyId = undefined;
        actionNotice = zh ? "已找回。" : "Recovered.";
        void load();
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        restoreBusyId = undefined;
        restoreErrorId = itemId;
        restoreErrorText = zh ? "找回失败，请重试。" : "Couldn't recover — try again.";
        render();
      });
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
    // R20 DSK-UX（R19-23）：回收站入口 / 返回文件。
    if (target.closest("[data-wb-drive-recycle-open]")) {
      clearDeleteArm();
      recycleView = true;
      actionError = undefined;
      actionNotice = undefined;
      restoreErrorId = undefined;
      render();
      return;
    }
    if (target.closest("[data-wb-drive-recycle-back]")) {
      recycleView = false;
      actionError = undefined;
      actionNotice = undefined;
      render();
      return;
    }
    const restoreBtn = target.closest<HTMLElement>("[data-wb-drive-restore]");
    if (restoreBtn?.dataset.wbDriveRestore) {
      if (restoreBusyId) {
        return;
      }
      restoreItem(restoreBtn.dataset.wbDriveRestore);
      return;
    }
    const folderBtn = target.closest<HTMLElement>("[data-wb-drive-open-folder]");
    if (folderBtn) {
      clearDeleteArm();
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
      // R20 DSK-UX（R19-23）：两段式确认——第一下武装，5 秒内对同一项再点一次才真发请求（decideDriveDeleteConfirmation）。
      const itemId = deleteBtn.dataset.wbDriveDelete;
      const versionId = deleteBtn.dataset.wbDriveDeleteVersion || undefined;
      const decision = decideDriveDeleteConfirmation(deleteArmedItemId, itemId);
      if (decision.kind === "execute") {
        executeDelete(itemId, versionId);
        return;
      }
      clearDeleteArm();
      deleteArmedItemId = itemId;
      actionError = undefined;
      actionNotice = undefined;
      deleteArmTimer = setTimeout(() => {
        deleteArmTimer = undefined;
        if (disposed) {
          return;
        }
        deleteArmedItemId = undefined;
        render();
      }, DRIVE_DELETE_ARM_TIMEOUT_MS);
      render();
      return;
    }
    // 行内其余点击（不是操作按钮/下载链接）都当作「打开预览」——文件行本身可点，照 prototype 的
    // fitem onclick=openPreview 行为。data-wb-drive-open-item 挂在整行容器上（见 render.ts）。
    const itemRow = target.closest<HTMLElement>("[data-wb-drive-open-item]");
    if (itemRow?.dataset.wbDriveOpenItem) {
      clearDeleteArm();
      input.sidePanel.showPreview({
        projectId: input.projectId,
        itemId: itemRow.dataset.wbDriveOpenItem,
        itemName: itemRow.dataset.wbDriveOpenItemName ?? ""
      });
    }
  });

  // R20 DSK-UX（R19-25）：键盘可达——焦点落在行本身（role=button tabindex=0，见 render.ts）时，回车/空格
  // 等同点击打开/进目录。行内的版本/下载/删除是真 button/a，有原生键盘激活，所以这里只在焦点正是行本身
  // （event.target === row）时才接管，避免和它们双触发。照 kanban/view.ts:288 的既有先例。
  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const row = event.target.closest<HTMLElement>(".wh-wb-drive-row");
    if (!row || event.target !== row) {
      return;
    }
    event.preventDefault();
    clearDeleteArm();
    const folderId = row.dataset.wbDriveOpenFolder;
    if (folderId !== undefined) {
      currentFolderId = folderId ? folderId : undefined;
      render();
      return;
    }
    const itemId = row.dataset.wbDriveOpenItem;
    if (itemId) {
      input.sidePanel.showPreview({
        projectId: input.projectId,
        itemId,
        itemName: row.dataset.wbDriveOpenItemName ?? ""
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
      clearDeleteArm();
    },
    refresh: () => {
      void load();
    }
  };
}
