// WorkHub 桌面 · 工作台三栏外壳：左栏项目树 / 中栏内容 / 右栏情境面板（可收放）。
// 无边框透明窗——顶部拖拽区靠纯 CSS `-webkit-app-region:drag`（浏览器/webview 原生行为，不经 Tauri IPC，
// 参照 apps/desktop-webview/src/browser.ts 的 .wh-cmd-home 用法）；关闭/最小化走 window-bridge.ts 的真实
// Tauri Window API（真机验收前请先确认 capabilities/default.json 是否已把 "workbench" 加进 windows 列表，
// 见 window-bridge.ts 顶部注释——这是范围外的 Rust/配置缺口，本批不修）。

import type { WorkHubApiClient } from "@workhub/api-client";
import type { WorkbenchPageVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { appleGlassDesignSystemCss } from "../design-system.js";
import { workbenchCss } from "./css.js";
import { workbenchIcons } from "./icons.js";
import { mountWorkbenchRail, type WorkbenchRailApiClient } from "./rail.js";
import { createWorkbenchStore, type WorkbenchStore, type WorkbenchStoreState } from "./store.js";
import { resolveWorkbenchWindowBridge } from "./window-bridge.js";

type Locale = "zh-CN" | "en-US";

export type WorkbenchShellApiClient = WorkbenchRailApiClient & Pick<WorkHubApiClient, "listProjects" | "bootstrapProject" | "pages">;

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
  }
): WorkbenchShellHandle {
  const doc = root.ownerDocument ?? document;
  const store = input.store ?? createWorkbenchStore();
  let disposed = false;
  let vmRequestGen = 0;

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

  const renderCenter = (state: WorkbenchStoreState) => {
    if (!state.selectedProjectId) {
      centerEl.innerHTML = renderEmptyStateHtml(input.locale, state.projects.length > 0);
      return;
    }
    if (state.vmLoad === "error") {
      centerEl.innerHTML = renderCenterErrorHtml(input.locale);
      return;
    }
    if (state.vm) {
      centerEl.innerHTML = renderProjectSummaryHtml(state.vm, input.locale);
      return;
    }
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
    onSelectProject: selectProject
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
    }
  };
}
