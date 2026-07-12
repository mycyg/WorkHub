// WorkHub 桌面 · 工作台三栏外壳：左栏项目树 / 中栏内容 / 右栏情境面板（可收放）。
// 无边框透明窗——顶部拖拽区靠纯 CSS `-webkit-app-region:drag`（浏览器/webview 原生行为，不经 Tauri IPC，
// 参照 apps/desktop-webview/src/browser.ts 的 .wh-cmd-home 用法）；关闭/最小化走 window-bridge.ts 的真实
// Tauri Window API（真机验收前请先确认 capabilities/default.json 是否已把 "workbench" 加进 windows 列表，
// 见 window-bridge.ts 顶部注释——这是范围外的 Rust/配置缺口，本批不修）。

import type { WorkHubApiClient } from "@workhub/api-client";
import type { WorkbenchPageVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { appleGlassDesignSystemCss } from "../design-system.js";
import { mountChatView, type ChatViewApiClient, type ChatViewHandle } from "./chat/view.js";
import { workbenchCss } from "./css.js";
import { workbenchIcons } from "./icons.js";
import { mountWorkbenchRail, type WorkbenchRailApiClient } from "./rail.js";
import { createWorkbenchStore, type WorkbenchStore, type WorkbenchStoreState } from "./store.js";
import { resolveWorkbenchWindowBridge } from "./window-bridge.js";

type Locale = "zh-CN" | "en-US";

// R12 批 2：中栏在项目选中且 VM 就绪时渲染真实群聊（chat/view.ts），需要 request（消息/typing 走
// client.request，见 chat/api.ts 顶部注释——不为一个只有工作台窗口用的批次特性扩大 WorkHubApiClient
// 的具名方法面）+ streams（拼 SSE 订阅 URL）。
export type WorkbenchShellApiClient = WorkbenchRailApiClient &
  ChatViewApiClient &
  Pick<WorkHubApiClient, "listProjects" | "bootstrapProject" | "pages" | "request" | "streams">;

// 照 boot.ts 的 clientToken() 同款 helper——shell.ts 不 import boot.ts（避免 boot.ts → shell.ts →
// chat/view.ts → ... 的循环 import 风险），改由 mountWorkbenchShell 的调用方（boot.ts 本尊）注入
// 同一个函数引用；这里只是没传时的兜底默认值，独立实现一份和 desktop-cuu-runtime.ts 的
// desktopCuuBrowserClientToken 同款最小 helper（这个仓库里第三份，都是同样 6 行，没有值得抽共享
// 模块的复杂度）。
function defaultClientTokenReader(): string | undefined {
  try {
    return window.localStorage.getItem("workhub_client_token") ?? window.localStorage.getItem("yqgl_client_token") ?? undefined;
  } catch {
    return undefined;
  }
}

export function renderWorkbenchDocumentHead(): string {
  return `<style>${appleGlassDesignSystemCss}${workbenchCss}</style>`;
}

// 静态骨架：三栏容器 + 拖拽区 + 关闭/最小化控件。中栏/左栏/右栏内容由 mountWorkbenchShell 按状态填入。
export function renderWorkbenchShellHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-ds wh-wb">
    <div class="wh-wb-window" data-wb-window>
      <div class="wh-wb-titlebar" data-wb-titlebar>
        <span class="wh-wb-crumb" data-wb-crumb>${zh ? "WorkHub 工作台" : "WorkHub Workbench"}</span>
        <div class="wh-wb-titlebar-spacer"></div>
        <div class="wh-wb-titlebar-controls">
          <button type="button" class="wh-wb-winbtn" data-wb-minimize aria-label="${zh ? "最小化" : "Minimize"}">${workbenchIcons.minimize}</button>
          <button type="button" class="wh-wb-winbtn wh-wb-winbtn--close" data-wb-close aria-label="${zh ? "关闭" : "Close"}">${workbenchIcons.close}</button>
        </div>
      </div>
      <div class="wh-wb-body">
        <div class="wh-wb-rail" data-wb-rail></div>
        <div class="wh-wb-center" data-wb-center></div>
        <div class="wh-wb-side" data-wb-side data-open="true">
          <div class="wh-wb-side-head">
            ${workbenchIcons.army}
            <span class="wh-wb-side-title">${zh ? "情境面板" : "Context panel"}</span>
            <div class="wh-wb-titlebar-spacer"></div>
            <button type="button" class="wh-wb-winbtn" data-wb-toggle-side aria-label="${zh ? "收起情境面板" : "Collapse context panel"}">${workbenchIcons.chevronRight}</button>
          </div>
          <div class="wh-wb-side-body" data-wb-side-body></div>
        </div>
      </div>
    </div>
  </div>`;
}

export function renderEmptyStateHtml(locale: Locale, hasProjects: boolean): string {
  const zh = locale === "zh-CN";
  const title = hasProjects ? (zh ? "选一个项目开始" : "Pick a project to start") : zh ? "先建一个项目" : "Create your first project";
  const sub = zh
    ? "每个项目都有自己的群聊、网盘和 Cuu——挑左边一个项目，或建一个新的。"
    : "Every project gets its own team chat, drive, and Cuu — pick one on the left, or create a new one.";
  const cta = !hasProjects
    ? `<div class="wh-wb-empty-actions"><button type="button" class="wh-wb-btn wh-wb-btn--primary" data-wb-new-project>${zh ? "新建项目" : "New project"}</button></div>`
    : "";
  return `<div class="wh-wb-empty ds-anim-fade-in">
    <span class="wh-wb-empty-icon">${workbenchIcons.chat}</span>
    <h2 class="wh-wb-empty-title">${escapeHtml(title)}</h2>
    <p class="wh-wb-empty-sub">${escapeHtml(sub)}</p>
    ${cta}
  </div>`;
}

export function renderCenterLoadingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-loading"><span class="wh-wb-spinner"></span>${zh ? "正在打开工作台…" : "Opening the workbench…"}</div>`;
}

export function renderCenterErrorHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-error">${zh ? "没打开这个项目的工作台，稍后重试" : "Couldn't open this project's workbench — retry"}
    <div style="margin-top:13px"><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-retry-vm>${zh ? "重试" : "Retry"}</button></div>
  </div>`;
}

// 批 1 只展示这个项目的真实 bootstrap 数据（消息数/成员数/军团 run 数/网盘文件数）——群聊/网盘/军团面板
// 的完整视图分别在批 2/6/5 接进这个窗口，接进来之前老实说明「下一批会开」，不假装已经能用。
export function renderProjectSummaryHtml(vm: WorkbenchPageVM, locale: Locale): string {
  const zh = locale === "zh-CN";
  const main = vm.conversations.conversations.find((conversation) => conversation.kind === "main");
  const subtitle = vm.project.description
    ? vm.project.description
    : zh
      ? `负责人 ${vm.project.owner_label}`
      : `Owner ${vm.project.owner_label}`;
  return `<div class="wh-wb-summary ds-anim-fade-in">
    <h2 class="wh-wb-summary-title">${escapeHtml(vm.project.name)}</h2>
    <p class="wh-wb-summary-sub">${escapeHtml(subtitle)}</p>
    <div class="wh-wb-summary-grid">
      <div class="wh-wb-summary-metric"><div class="wh-wb-summary-metric-k">${zh ? "主区消息" : "Main chat"}</div><div class="wh-wb-summary-metric-v">${main?.next_seq ?? 0}</div></div>
      <div class="wh-wb-summary-metric"><div class="wh-wb-summary-metric-k">${zh ? "工作区成员" : "Members"}</div><div class="wh-wb-summary-metric-v">${vm.workspace_members.total}</div></div>
      <div class="wh-wb-summary-metric"><div class="wh-wb-summary-metric-k">${zh ? "军团在跑" : "Active runs"}</div><div class="wh-wb-summary-metric-v">${vm.army_summary.active_plan_count}</div></div>
      <div class="wh-wb-summary-metric"><div class="wh-wb-summary-metric-k">${zh ? "网盘文件" : "Drive files"}</div><div class="wh-wb-summary-metric-v">${vm.recent_project_files.items.length}</div></div>
    </div>
    <p class="wh-wb-summary-note">${
      zh
        ? "群聊、网盘和军团面板下一批陆续开放——你现在看到的已经是这个项目的真实数据，不是占位。"
        : "Team chat, drive, and the army panel open up in the next batches — what you see here is already real data, not a placeholder."
    }</p>
  </div>`;
}

export function renderSidePanelPlaceholderHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<p>${
    zh
      ? "输出、军团任务卡、后台任务会显示在这里——这一部分接在批 5（军团面板）。"
      : "Outputs, army task cards, and background tasks will show up here — wired in batch 5 (the army panel)."
  }</p>`;
}

export type WorkbenchShellHandle = {
  store: WorkbenchStore;
  // 选中项目（rail 点击 / Spotlight「打开工作台」/ 深链三路共用）。conversationId 目前只落库，批 2 起消费。
  selectProject: (projectId: string, conversationId?: string) => void;
  dispose: () => void;
};

export function mountWorkbenchShell(
  root: HTMLElement,
  input: {
    client: WorkbenchShellApiClient;
    locale: Locale;
    store?: WorkbenchStore;
    // 照 boot.ts 已有的 clientToken() helper 传入——SSE 手写客户端（chat/stream.ts）要用它设
    // X-YQGL-Client-Token 头（EventSource 加不了自定义头）。没传时兜底用本文件顶部的同款小 helper，
    // 保证 shell.test.ts 等不必每次都喂这个参数。
    getClientToken?: () => string | undefined;
  }
): WorkbenchShellHandle {
  const doc = root.ownerDocument ?? document;
  const store = input.store ?? createWorkbenchStore();
  const getClientToken = input.getClientToken ?? defaultClientTokenReader;
  let disposed = false;
  let vmRequestGen = 0;
  let chatHandle: ChatViewHandle | undefined;
  let chatMountKey: string | undefined;

  const disposeChat = () => {
    chatHandle?.dispose();
    chatHandle = undefined;
    chatMountKey = undefined;
  };

  root.innerHTML = renderWorkbenchDocumentHead() + renderWorkbenchShellHtml(input.locale);
  const railEl = root.querySelector<HTMLElement>("[data-wb-rail]");
  const centerEl = root.querySelector<HTMLElement>("[data-wb-center]");
  const sideEl = root.querySelector<HTMLElement>("[data-wb-side]");
  const sideBodyEl = root.querySelector<HTMLElement>("[data-wb-side-body]");
  const sideToggleBtn = root.querySelector<HTMLElement>("[data-wb-toggle-side]");
  const minimizeBtn = root.querySelector<HTMLElement>("[data-wb-minimize]");
  const closeBtn = root.querySelector<HTMLElement>("[data-wb-close]");
  if (!railEl || !centerEl || !sideEl || !sideBodyEl) {
    throw new Error("workbench shell markup is missing an expected mount point");
  }

  const selectProject = (projectId: string, conversationId?: string) => {
    const my = ++vmRequestGen;
    store.setState({
      selectedProjectId: projectId,
      pendingConversationId: conversationId,
      vm: undefined,
      vmLoad: "loading",
      vmError: undefined
    });
    // pages.workbench 在 PageClient 上是可选字段（不强迫其它 workspace 的完整 PageClient mock 跟着补桩，
    // 见 packages/api-client/src/types.ts 的注释）；真实 createApiClient() 一定实现它，但这里仍老实处理
    // 「万一没有」——报真错误，不假装能拿到数据。
    const fetchWorkbench = input.client.pages.workbench;
    if (!fetchWorkbench) {
      store.setState({
        vmLoad: "error",
        vmError: input.locale === "zh-CN" ? "这个客户端不支持工作台数据" : "This client does not support workbench data"
      });
      return;
    }
    void fetchWorkbench(projectId, { locale: input.locale })
      .then((vm) => {
        if (disposed || my !== vmRequestGen) {
          return;
        }
        store.setState({ vm, vmLoad: "ready" });
      })
      .catch((error) => {
        if (disposed || my !== vmRequestGen) {
          return;
        }
        store.setState({
          vmLoad: "error",
          vmError: error instanceof Error ? error.message : String(error)
        });
      });
  };

  // R12 批 2：项目选中且 VM 就绪时，中栏渲染真实主区群聊（chat/view.ts），取代批 1 的数字摘要占位
  // （renderProjectSummaryHtml 仍留着 + 仍有单测——批 1 报告已经预告"批 2 把对应视图接进来"，这个函数
  // 本身没错，只是不再是 renderCenter 的调用路径；不删是为了不必连带改 shell.test.ts，范围外发现见
  // 批 2 汇报）。chat 视图是有状态的 imperative 组件（SSE 订阅/composer 草稿/翻页），只在
  // "项目+主会话" 真的变化时才重新挂载——store 的其它字段变化（如侧栏收放）不该把它拆了重建，
  // 否则每次都会打断用户正在打的字、重新连一次 SSE。
  const renderCenter = (state: WorkbenchStoreState) => {
    if (!state.selectedProjectId) {
      disposeChat();
      centerEl.className = "wh-wb-center";
      centerEl.innerHTML = renderEmptyStateHtml(input.locale, state.projects.length > 0);
      return;
    }
    if (state.vmLoad === "error") {
      disposeChat();
      centerEl.className = "wh-wb-center";
      centerEl.innerHTML = renderCenterErrorHtml(input.locale);
      return;
    }
    if (state.vm) {
      const mainConversation = state.vm.conversations.conversations.find((conversation) => conversation.kind === "main");
      if (!mainConversation) {
        // 批 0 的 workbenchPageVmSchema 已经用 superRefine 保证"恰好一个 main 会话"存在；真到这里说明
        // 服务端契约被破坏，老实报错而不是假装能渲染群聊。
        disposeChat();
        centerEl.className = "wh-wb-center";
        centerEl.innerHTML = renderCenterErrorHtml(input.locale);
        return;
      }
      const key = `${state.vm.project.id}:${mainConversation.id}`;
      if (chatHandle && chatMountKey === key) {
        return; // 已经是这个会话的 chat 视图——它自己的 store/SSE 订阅在内部持续更新，无需重挂。
      }
      disposeChat();
      centerEl.className = "wh-wb-center wh-wb-center--chat";
      chatHandle = mountChatView(centerEl, {
        client: input.client,
        locale: input.locale,
        projectId: state.vm.project.id,
        projectName: state.vm.project.name,
        conversationId: mainConversation.id,
        currentUserId: state.vm.viewer.user_id,
        members: state.vm.workspace_members.items,
        getClientToken,
        streamUrl: input.client.streams.conversation(mainConversation.id)
      });
      chatMountKey = key;
      return;
    }
    disposeChat();
    centerEl.className = "wh-wb-center";
    centerEl.innerHTML = renderCenterLoadingHtml(input.locale);
  };

  const renderSide = (state: WorkbenchStoreState) => {
    sideEl.dataset.open = state.sidePanelOpen ? "true" : "false";
    if (sideToggleBtn) {
      sideToggleBtn.innerHTML = state.sidePanelOpen ? workbenchIcons.chevronRight : workbenchIcons.chevronLeft;
    }
    sideBodyEl.innerHTML = renderSidePanelPlaceholderHtml(input.locale);
  };

  const crumbEl = root.querySelector<HTMLElement>("[data-wb-crumb]");
  const renderCrumb = (state: WorkbenchStoreState) => {
    if (!crumbEl) {
      return;
    }
    const zh = input.locale === "zh-CN";
    if (!state.vm) {
      crumbEl.textContent = zh ? "WorkHub 工作台" : "WorkHub Workbench";
      return;
    }
    crumbEl.innerHTML = `WorkHub ${zh ? "工作台" : "Workbench"} · <b>${escapeHtml(state.vm.project.name)}</b>`;
  };

  const unsubscribe = store.subscribe((state) => {
    renderCenter(state);
    renderSide(state);
    renderCrumb(state);
  });
  renderCenter(store.getState());
  renderSide(store.getState());
  renderCrumb(store.getState());

  const railHandle = mountWorkbenchRail(railEl, {
    client: input.client,
    store,
    locale: input.locale,
    onSelectProject: selectProject,
    // 会话点击路由：点「主区」树叶把焦点交回已经挂载好的 chat composer（不重新拉数据/不重连
    // SSE——中栏此刻本来就是这个项目的 chat 视图，见 renderCenter 的 chatMountKey 复用逻辑）。
    onOpenMainConversation: () => chatHandle?.focusComposer()
  });

  centerEl.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    if (event.target.closest("[data-wb-new-project]")) {
      // 中栏空态的「新建项目」CTA 复用 rail 的开模态逻辑（重置上次残留的输入/错误态），不重复拼一份。
      railHandle.openNewProjectModal();
      return;
    }
    if (event.target.closest("[data-wb-retry-vm]")) {
      const projectId = store.getState().selectedProjectId;
      if (projectId) {
        selectProject(projectId, store.getState().pendingConversationId);
      }
    }
  });

  sideToggleBtn?.addEventListener("click", () => {
    store.setState({ sidePanelOpen: !store.getState().sidePanelOpen });
  });

  const windowBridge = resolveWorkbenchWindowBridge(doc.defaultView ?? globalThis);
  minimizeBtn?.addEventListener("click", () => {
    void windowBridge?.minimize?.();
  });
  closeBtn?.addEventListener("click", () => {
    // 工作台窗是常驻可复用的（Rust 侧 create:false 复用同一个窗口实例），关闭按钮语义是「藏起来」而不是
    // 销毁窗口——和主窗/桌宠窗一致，避免下次 open_workbench 还要重新起窗口。
    void windowBridge?.hide?.();
  });

  return {
    store,
    selectProject,
    dispose: () => {
      disposed = true;
      unsubscribe();
      railHandle.dispose();
      disposeChat();
    }
  };
}
