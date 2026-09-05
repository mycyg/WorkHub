// WorkHub 桌面 · 工作台右栏「情境面板 · 文件模式」的 imperative 控制器（取数 / 事件；纯渲染在 render.ts）。
// R16-W3。右栏第五个 owner（ownerId="files"），与 drive/army/proposal 共用同一块 store.sidePanelContent
// 插槽，靠 ownerId 互斥（照 army/panel.ts、drive/side-panel.ts 的同一种设计——直接持有 sideBodyEl 真实
// DOM 节点、每次状态变化把渲染好的 html 推进 store）。
//
// 数据来源全是既有端点，零新增取数面：变动文件 = conversation army panel 的 outputs（proposal 维度的
// changed_files，复用 fetchConversationArmyPanel）；所有文件 = Drive 页 VM（复用 client.pages.drive）。
// 点变动文件行 → 抛给 shell 打开中栏编辑器（onOpenEditor）；点所有文件的文件行 → 抛给 shell 走既有
// drive 预览（onOpenDriveFile → driveSidePanel.showPreview）。

import type { WorkHubApiClient } from "@workhub/api-client";

import { fetchConversationArmyPanel } from "../army/api.js";
import type { WorkbenchStore } from "../store.js";
import {
  changedRowsFromOutputs,
  renderFilesSidePanelHtml,
  type FilesSidePanelState,
  type FilesSubTab
} from "./render.js";

import { filesT } from "./locales.js";

type Locale = "zh-CN" | "en-US";

const FILES_OWNER_ID = "files";

export type FilesSidePanelApiClient = Pick<WorkHubApiClient, "request" | "pages">;

export type FilesSidePanelHandle = {
  // 用户把右栏切到「文件」模式（chip）——按当前会话情境加载变动文件（并懒加载所有文件）。
  showForContext: (input: { projectId: string; conversationId: string }) => void;
  // 从别的 owner（drive 预览/提议详情）回到文件模式时重新认领右栏（republish 缓存态，不 refetch）。
  reshow: () => void;
  // 批准/合并在别处落定后刷新变动文件区（status 翻新/合并后消失）——只在自己仍是当前 owner 时才动 DOM。
  refresh: () => void;
  clear: () => void;
  dispose: () => void;
};

function errorMessage(error: unknown, locale: Locale): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return filesT(locale, "couldnTLoadTryAgain");
}

export function mountFilesSidePanel(
  sideBodyEl: HTMLElement,
  store: WorkbenchStore,
  input: {
    client: FilesSidePanelApiClient;
    locale: Locale;
    onOpenEditor: (target: { proposalId: string; path: string; filename: string }) => void;
    onOpenDriveFile: (target: { projectId: string; itemId: string; itemName: string }) => void;
  }
): FilesSidePanelHandle {
  let disposed = false;
  let target: { projectId: string; conversationId: string } | undefined;
  let state: FilesSidePanelState = { sub: "changed", changed: { status: "loading" }, all: { status: "idle" } };
  // 变动/所有各自独立的单调代次，防往返竞态（晚到的 await 不覆盖更新的一帧）。
  let changedGen = 0;
  let allGen = 0;

  function isOwner(): boolean {
    return store.getState().sidePanelContent?.ownerId === FILES_OWNER_ID;
  }

  function publish(): void {
    if (disposed) {
      return;
    }
    store.setState({ sidePanelContent: { ownerId: FILES_OWNER_ID, html: renderFilesSidePanelHtml(state, input.locale) } });
  }

  function loadChanged(): void {
    if (!target) {
      return;
    }
    const generation = ++changedGen;
    const conversationId = target.conversationId;
    state = { ...state, changed: { status: "loading" } };
    publish();
    void fetchConversationArmyPanel(input.client, conversationId)
      .then((vm) => {
        if (disposed || generation !== changedGen) {
          return;
        }
        state = { ...state, changed: { status: "ready", rows: changedRowsFromOutputs(vm.outputs.items) } };
        publish();
      })
      .catch((error: unknown) => {
        if (disposed || generation !== changedGen) {
          return;
        }
        state = { ...state, changed: { status: "error", message: errorMessage(error, input.locale) } };
        publish();
      });
  }

  function loadAll(): void {
    if (!target) {
      return;
    }
    const generation = ++allGen;
    const projectId = target.projectId;
    state = { ...state, all: { status: "loading" } };
    publish();
    void input.client.pages
      .drive({ project_id: projectId, locale: input.locale })
      .then((vm) => {
        if (disposed || generation !== allGen) {
          return;
        }
        state = { ...state, all: { status: "ready", items: vm.items } };
        publish();
      })
      .catch((error: unknown) => {
        if (disposed || generation !== allGen) {
          return;
        }
        state = { ...state, all: { status: "error", message: errorMessage(error, input.locale) } };
        publish();
      });
  }

  function showForContext(next: { projectId: string; conversationId: string }): void {
    target = next;
    // 切会话/首次进入文件模式：变动文件重拉，所有文件回到懒加载（下次点「所有文件」子 tab 才拉）。
    state = { sub: "changed", changed: { status: "loading" }, all: { status: "idle" } };
    loadChanged();
  }

  function switchSub(sub: FilesSubTab): void {
    if (state.sub === sub) {
      return;
    }
    state = { ...state, sub };
    publish();
    if (sub === "all" && state.all.status === "idle") {
      loadAll();
    }
  }

  sideBodyEl.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const el = event.target;
    const subBtn = el.closest<HTMLElement>("[data-wb-files-sub]");
    if (subBtn?.dataset.wbFilesSub) {
      switchSub(subBtn.dataset.wbFilesSub as FilesSubTab);
      return;
    }
    if (el.closest("[data-wb-files-retry-changed]")) {
      loadChanged();
      return;
    }
    if (el.closest("[data-wb-files-retry-all]")) {
      loadAll();
      return;
    }
    const editorBtn = el.closest<HTMLElement>("[data-wb-files-open-editor]");
    if (editorBtn?.dataset.wbFilesProposal && editorBtn.dataset.wbFilesPath) {
      input.onOpenEditor({
        proposalId: editorBtn.dataset.wbFilesProposal,
        path: editorBtn.dataset.wbFilesPath,
        filename: editorBtn.dataset.wbFilesName ?? editorBtn.dataset.wbFilesPath
      });
      return;
    }
    const driveBtn = el.closest<HTMLElement>("[data-wb-files-open-drive]");
    if (driveBtn?.dataset.wbFilesItem && target) {
      input.onOpenDriveFile({
        projectId: target.projectId,
        itemId: driveBtn.dataset.wbFilesItem,
        itemName: driveBtn.dataset.wbFilesName ?? driveBtn.dataset.wbFilesItem
      });
    }
  });

  return {
    showForContext,
    reshow: () => {
      if (disposed || !target) {
        return;
      }
      publish();
    },
    refresh: () => {
      if (disposed || !target || !isOwner()) {
        return;
      }
      loadChanged();
    },
    clear: () => {
      target = undefined;
      ++changedGen;
      ++allGen;
      if (isOwner()) {
        store.setState({ sidePanelContent: undefined });
      }
    },
    dispose: () => {
      disposed = true;
      if (isOwner()) {
        store.setState({ sidePanelContent: undefined });
      }
    }
  };
}
