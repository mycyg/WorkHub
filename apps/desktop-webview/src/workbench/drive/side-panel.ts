// WorkHub 桌面 · 工作台右栏「情境面板」的网盘内容控制器——文件预览 + 版本历史 + 回滚（找回版本）。
// 挂载一次、活到整个工作台窗口生命周期（不像 chat/drive 中栏视图那样随项目/标签切换重挂），
// 这样聊天视图的 file_card 点击和网盘标签的文件点击才能共用同一份右栏内容与状态（04 §4 铁律：
// 批 6 任务原话「chat 视图里 file_card 点击 → 右栏预览同一组件(和 drive 标签共用)」）。
//
// 与 store 的关系：store.sidePanelContent 只是个不透明的 {ownerId, html} 容器（见 store.ts 顶部
// 注释），本模块是唯一认识 DriveSidePanelState 形状的地方——每次内部状态变化都把渲染好的 html 推进
// store，shell.ts 的 renderSide 只管展示，不需要认识这个联合类型。

import { downloadDriveResource, driveResourceApiBase, driveResourceHref } from "../../spotlight/views/drive.js";
import type { WorkbenchStore } from "../store.js";
import {
  fetchDriveItemTextPreview,
  fetchDriveItemVersions,
  rollbackDriveItemVersion,
  type DriveVersionsApiClient
} from "./api.js";
import { renderDriveSidePanelHtml, type DriveSidePanelState } from "./render.js";

import { driveT } from "./locales.js";

type Locale = "zh-CN" | "en-US";

export type DriveSidePanelApiClient = DriveVersionsApiClient;

export type DriveSidePanelHandle = {
  showPreview: (input: { projectId: string; itemId: string; itemName: string }) => void;
  showVersions: (input: { projectId: string; itemId: string; itemName: string }) => void;
  showIdle: () => void;
  dispose: () => void;
};

const DRIVE_SIDE_PANEL_OWNER_ID = "drive";

// R14（网盘回滚两端对齐）：回滚是覆盖性动作（会把当前版本换成这一版的内容），此前一点「找回这个
// 版本」就立刻发请求，没有任何确认。这个纯判定函数是两段式确认的核心逻辑——刻意不碰任何 DOM/网络，
// 好在这个 workspace 没有真实 DOM 的测试运行器（node --import tsx --test，见 chat/view.test.ts 顶部
// 注释）下也能直接单测。照 apps/web/src/browser.ts 里 r9ConfirmArmed 的既有两段式确认先例：第一次点
// 某个版本只「武装」它，对同一版本再点一次才真正执行；点了别的版本则重新开始武装那一个。
export type RollbackConfirmDecision =
  | { kind: "arm"; versionId: string }
  | { kind: "execute"; versionId: string };

export function decideRollbackConfirmation(
  armedVersionId: string | undefined,
  versionId: string
): RollbackConfirmDecision {
  return armedVersionId === versionId
    ? { kind: "execute", versionId }
    : { kind: "arm", versionId };
}

export function mountDriveSidePanel(
  sideBodyEl: HTMLElement,
  store: WorkbenchStore,
  input: {
    client: DriveSidePanelApiClient;
    locale: Locale;
    // 回滚成功后需要让网盘标签的文件列表也刷新一遍(大小/更新时间变了)——不直接持有 drive 视图引用
    // (标签可能没挂载,比如从聊天 file_card 触发预览时),用一个可选回调,由 shell.ts 按当前挂载的
    // drive 视图 handle 转发。
    onRolledBack?: (input: { projectId: string; itemId: string }) => void;
  }
): DriveSidePanelHandle {
  let disposed = false;
  let state: DriveSidePanelState = { mode: "idle" };
  let loadGeneration = 0;
  let currentTarget: { projectId: string; itemId: string; itemName: string } | undefined;
  // R14：武装态 5 秒后自动复原的计时器——切目标/重新拉版本/卸载时都要清掉，否则一个晚到的自动复原
  // 会在用户已经看别的文件之后突然把（可能早已不存在的）另一份 state 改了一下再 publish 一次。
  let armedRollbackTimer: ReturnType<typeof setTimeout> | undefined;

  function clearArmedRollbackTimer(): void {
    if (armedRollbackTimer !== undefined) {
      clearTimeout(armedRollbackTimer);
      armedRollbackTimer = undefined;
    }
  }

  function publish(): void {
    if (disposed) {
      return;
    }
    store.setState({
      sidePanelContent: { ownerId: DRIVE_SIDE_PANEL_OWNER_ID, html: renderDriveSidePanelHtml(state, input.locale) }
    });
  }

  function showIdle(): void {
    // 也要让当前代次失效——否则一个还没回来的预览/版本历史请求（比如切项目前点开的那个）晚到时会
    // 把这个新推上去的空闲态覆盖回旧内容（loadGeneration 是 showPreview/loadVersions 检查"我还是
    // 不是最新那次请求"的唯一依据）。
    ++loadGeneration;
    clearArmedRollbackTimer();
    currentTarget = undefined;
    state = { mode: "idle" };
    publish();
  }

  function showPreview(target: { projectId: string; itemId: string; itemName: string }): void {
    currentTarget = target;
    const generation = ++loadGeneration;
    state = { mode: "preview_loading", itemName: target.itemName };
    publish();
    void fetchDriveItemTextPreview(target.projectId, target.itemId, driveResourceApiBase())
      .then((result) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        if (!result.ok) {
          state = result.unsupported
            ? {
                mode: "preview_unsupported",
                itemName: target.itemName,
                downloadHref: driveResourceHref(
                  `/api/drive/projects/${encodeURIComponent(target.projectId)}/items/${encodeURIComponent(target.itemId)}/download`,
                  driveResourceApiBase()
                )
              }
            : { mode: "preview_error", itemName: target.itemName, error: result.message };
          publish();
          return;
        }
        state = {
          mode: "preview_text",
          itemName: target.itemName,
          text: result.text,
          truncated: result.truncated,
          downloadHref: driveResourceHref(result.downloadHref, driveResourceApiBase())
        };
        publish();
      })
      .catch((error: unknown) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        state = {
          mode: "preview_error",
          itemName: target.itemName,
          error: error instanceof Error ? error.message : driveT(input.locale, "previewFailed")
        };
        publish();
      });
  }

  function loadVersions(target: { projectId: string; itemId: string; itemName: string }, justRolledBackVersionNo?: number): void {
    const generation = ++loadGeneration;
    clearArmedRollbackTimer();
    state = { mode: "versions_loading", itemName: target.itemName };
    publish();
    void fetchDriveItemVersions(input.client, target.projectId, target.itemId)
      .then((history) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        state = { mode: "versions_ready", itemName: target.itemName, history, ...(justRolledBackVersionNo !== undefined ? { justRolledBackVersionNo } : {}) };
        publish();
      })
      .catch((error: unknown) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        state = {
          mode: "versions_error",
          itemName: target.itemName,
          error: error instanceof Error ? error.message : driveT(input.locale, "couldnTLoadVersionHistory")
        };
        publish();
      });
  }

  function showVersions(target: { projectId: string; itemId: string; itemName: string }): void {
    currentTarget = target;
    loadVersions(target);
  }

  function requestRollback(versionId: string): void {
    if (!currentTarget || state.mode !== "versions_ready") {
      return;
    }
    // R14（网盘回滚两端对齐）：回滚是覆盖性动作，不能一点就发请求——decideRollbackConfirmation 是
    // 纯判定（见文件顶部），这里只负责把判定结果落到 state/计时器/网络调用上。
    const decision = decideRollbackConfirmation(state.armedVersionId, versionId);
    if (decision.kind === "arm") {
      clearArmedRollbackTimer();
      // exactOptionalPropertyTypes 不允许显式赋 undefined 给可选字段——武装态要清掉旧的 rollback
      // 提示（比如上一次失败留下的错误），只能靠解构丢掉那个 key，不能写 rollback: undefined。
      const { rollback: _clearedRollback, ...armedRest } = state;
      state = { ...armedRest, armedVersionId: versionId };
      publish();
      armedRollbackTimer = setTimeout(() => {
        armedRollbackTimer = undefined;
        if (disposed || state.mode !== "versions_ready" || state.armedVersionId !== versionId) {
          return;
        }
        const { armedVersionId: _expiredArmed, ...disarmedRest } = state;
        state = { ...disarmedRest };
        publish();
      }, 5000);
      return;
    }
    clearArmedRollbackTimer();
    const target = currentTarget;
    const versionRow = state.history.versions.find((version) => version.id === versionId);
    const versionNo = versionRow?.version_no;
    const { armedVersionId: _confirmedArmed, ...executingRest } = state;
    state = { ...executingRest, rollback: { versionId, busy: true } };
    publish();
    void rollbackDriveItemVersion(input.client, target.projectId, target.itemId, versionId)
      .then(() => {
        if (disposed || !currentTarget || currentTarget.itemId !== target.itemId) {
          return;
        }
        input.onRolledBack?.({ projectId: target.projectId, itemId: target.itemId });
        loadVersions(target, versionNo);
      })
      .catch((error: unknown) => {
        if (disposed || !currentTarget || currentTarget.itemId !== target.itemId || state.mode !== "versions_ready") {
          return;
        }
        const { armedVersionId: _failedArmed, ...failedRest } = state;
        state = {
          ...failedRest,
          rollback: {
            versionId,
            busy: false,
            error: error instanceof Error ? error.message : driveT(input.locale, "recoveryFailedRetry")
          }
        };
        publish();
      });
  }

  function handleDownloadClick(anchor: HTMLAnchorElement): void {
    const fallbackName = currentTarget?.itemName ?? "download";
    void downloadDriveResource(anchor.href, fallbackName).catch(() => undefined);
  }

  sideBodyEl.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const target = event.target;
    const downloadAnchor = target.closest<HTMLAnchorElement>("a[data-wb-drive-side-download]");
    if (downloadAnchor) {
      event.preventDefault();
      handleDownloadClick(downloadAnchor);
      return;
    }
    const restoreBtn = target.closest<HTMLElement>("[data-wb-drive-restore-version]");
    if (restoreBtn?.dataset.wbDriveRestoreVersion) {
      requestRollback(restoreBtn.dataset.wbDriveRestoreVersion);
    }
  });

  return {
    showPreview,
    showVersions,
    showIdle,
    dispose: () => {
      disposed = true;
      clearArmedRollbackTimer();
      if (store.getState().sidePanelContent?.ownerId === DRIVE_SIDE_PANEL_OWNER_ID) {
        store.setState({ sidePanelContent: undefined });
      }
    }
  };
}
