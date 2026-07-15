// WorkHub 桌面 · 工作台三栏外壳：左栏项目树 / 中栏内容 / 右栏情境面板（可收放）。
// 透明窗——顶部拖拽区靠纯 CSS `-webkit-app-region:drag`（浏览器/webview 原生行为，不经 Tauri IPC，
// 参照 apps/desktop-webview/src/browser.ts 的 .wh-cmd-home 用法）；关闭/最小化走 window-bridge.ts 的真实
// Tauri Window API（capabilities/workbench.json 已授权 hide/minimize/start-dragging）。
// R13 批 V2：macOS 原生红绿灯接管标题栏控制（Rust 侧 create_workbench_window_if_missing 的平台分支：
// decorations:true + titleBarStyle Overlay + hiddenTitle + trafficLightPosition）——自绘的 min/close
// 按钮此时整个不渲染（renderWorkbenchShellHtml 的 nativeWindowChrome 分支，见 isMacOsWebview 判定），
// 不是 CSS 藏起来，两套控件叠一起是 bug 不是冗余保险。非 macOS 维持 decorations:false 全套自绘。

import type { WorkHubApiClient } from "@workhub/api-client";
import { escapeHtml } from "@workhub/web-runtime";

import { appleGlassDesignSystemCss } from "../design-system.js";
import { resolveDesktopShellEmitter } from "../desktop-cuu-runtime.js";
import { resolveDesktopTauriInvoke } from "../desktop-window-controls.js";
import { mountArmyOverviewView, type ArmyOverviewApiClient, type ArmyOverviewViewHandle } from "./army/overview.js";
import { mountArmyContextPanel, type ArmyContextPanelApiClient, type ArmyContextPanelHandle } from "./army/panel.js";
import { renderArmySidePanelIdleHtml } from "./army/render.js";
import { mountChatView, type ChatViewApiClient, type ChatViewHandle } from "./chat/view.js";
import { workbenchCss } from "./css.js";
import { mountDriveSidePanel, type DriveSidePanelApiClient, type DriveSidePanelHandle } from "./drive/side-panel.js";
import { mountDriveView, type DriveTabApiClient, type DriveViewHandle } from "./drive/view.js";
import { workbenchIcons } from "./icons.js";
import { mountProposalSidePanel, type ProposalSidePanelApiClient, type ProposalSidePanelHandle } from "./proposal/panel.js";
import { createWorkbenchInterruptBroadcaster } from "./interrupt-broadcast.js";
import { mountWorkbenchRail, type WorkbenchRailApiClient } from "./rail.js";
import type { ProjectSettingsApiClient } from "./settings/api.js";
import { mountProjectSettingsView, type ProjectSettingsViewHandle } from "./settings/view.js";
import { createWorkbenchStore, type WorkbenchStore, type WorkbenchStoreState } from "./store.js";
import { isMacOsWebview, resolveWorkbenchWindowBridge } from "./window-bridge.js";

type Locale = "zh-CN" | "en-US";

// R12 批 2：中栏在项目选中且 VM 就绪时渲染真实群聊（chat/view.ts），需要 request（消息/typing 走
// client.request，见 chat/api.ts 顶部注释——不为一个只有工作台窗口用的批次特性扩大 WorkHubApiClient
// 的具名方法面）+ streams（拼 SSE 订阅 URL）。批 6 加网盘标签（drive/view.ts）需要的
// uploadDriveFile/deleteDriveItem/restoreDriveItem 是既有具名方法，直接 Pick 进来，不新增。R13 批 P1
// 加军团面板/军团总览（army/panel.ts、army/overview.ts）需要的 request/getAgentRun——getAgentRun 也是
// 既有具名方法（Spotlight 回放视图已经在用），同样不新增 api-client 面。
// R13 批 P3 加项目设置标签（settings/view.ts）需要的 request 同样已在 Pick 里，零新增 api-client 面。
// R14 批 APPROVE-CHAT：右栏第四个 owner（提议详情）需要 reviewProposal/mergeProposal——这两个方法 api-client
// 早已具名存在（packages/api-client），此前只是 shell 的 Pick 白名单没列（pages 已在，M1 只读用的 pages.proposal
// 已可用；M2 通过/合入才需补这两个写方法）。零新增 api-client 面。
export type WorkbenchShellApiClient = WorkbenchRailApiClient &
  ChatViewApiClient &
  DriveTabApiClient &
  DriveSidePanelApiClient &
  ArmyContextPanelApiClient &
  ArmyOverviewApiClient &
  ProjectSettingsApiClient &
  ProposalSidePanelApiClient &
  Pick<WorkHubApiClient, "listProjects" | "bootstrapProject" | "pages" | "request" | "streams" | "uploadDriveFile" | "deleteDriveItem" | "restoreDriveItem" | "getAgentRun" | "reviewProposal" | "mergeProposal">;

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

// R13 批 V2:macOS 用原生红绿灯接管标题栏控制（titleBarStyle Overlay，见 main.rs
// create_workbench_window_if_missing 的平台分支）——nativeWindowChrome 为真时不渲染自绘的
// 最小化/关闭按钮（不是 CSS 藏起来，直接不生成这段 DOM，04 §4 铁律 3：没有真接线的控件不能看起来能点，
// 这里反过来——有原生控件接管时，自绘控件本身就是多余且会重叠的假控件）。默认 false 保持既有非 macOS
// 全自绘行为不变（shell.test.ts 既有断言按单参数调用，行为不受影响）。
export type WorkbenchShellChromeOptions = {
  nativeWindowChrome?: boolean;
};

// 静态骨架：三栏容器 + 拖拽区 + 关闭/最小化控件。中栏/左栏/右栏内容由 mountWorkbenchShell 按状态填入。
export function renderWorkbenchShellHtml(locale: Locale, chrome: WorkbenchShellChromeOptions = {}): string {
  const zh = locale === "zh-CN";
  const nativeWindowChrome = chrome.nativeWindowChrome === true;
  const titlebarClass = nativeWindowChrome ? "wh-wb-titlebar wh-wb-titlebar--native" : "wh-wb-titlebar";
  const titlebarControlsHtml = nativeWindowChrome
    ? ""
    : `<div class="wh-wb-titlebar-controls">
          <button type="button" class="wh-wb-winbtn" data-wb-minimize aria-label="${zh ? "最小化" : "Minimize"}">${workbenchIcons.minimize}</button>
          <button type="button" class="wh-wb-winbtn wh-wb-winbtn--close" data-wb-close aria-label="${zh ? "关闭" : "Close"}">${workbenchIcons.close}</button>
        </div>`;
  // G-desktop 止血批 5：顶栏「打开聚焦盒」入口——不是窗口帧控件（不像 min/close 那样在原生红绿灯
  // 接管时该消失），所以放在 titlebarControlsHtml 判断之外、始终渲染。真实接线见 mountWorkbenchShell
  // 的点击处理：invoke("show_main_window")，main.rs 已注册的既有 command（托盘/深链/单实例冷启动都在
  // 用同一个），不是新造的协议。
  const openSpotlightBtnHtml = `<button type="button" class="wh-wb-winbtn" data-wb-open-spotlight aria-label="${zh ? "打开聚焦盒" : "Open Spotlight"}" title="${zh ? "打开聚焦盒" : "Open Spotlight"}">${workbenchIcons.search}</button>`;
  return `<div class="wh-ds wh-wb">
    <div class="wh-wb-window" data-wb-window>
      <div class="${titlebarClass}" data-wb-titlebar>
        <span class="wh-wb-crumb" data-wb-crumb>${zh ? "WorkHub 工作台" : "WorkHub Workbench"}</span>
        <div class="wh-wb-titlebar-spacer"></div>
        ${openSpotlightBtnHtml}
        ${titlebarControlsHtml}
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

// G-desktop 止血批 3（跨窗口登出广播）：整窗替换态——不是三栏壳里的一个子区块错误，是"这整个窗口手里
// 的身份已经失效了"，所以不复用 renderCenterErrorHtml/renderEmptyStateHtml（那两个都假设三栏壳还在、
// 只是某一列没内容）。照 boot.ts 的 renderFatalBootError 同一种取舍——用内联样式而不是新增 css.ts
// 类名，这类"整窗只在极少数分支出现一次"的状态不值得为它扩 workbenchCss 的常驻体积。工作台不拥有
// 重新登录的 UI（那是主窗 spotlight 设置视图的地盘，见 boot.ts bindWorkbenchLoggedOutListener 顶部
// 注释），这里只诚实地说明现状，不摆一个只会转发到别处、看起来能操作的按钮。
export function renderWorkbenchLoggedOutHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-ds wh-wb" data-wb-loggedout>
    <div style="min-height:100vh;display:grid;place-items:center;box-sizing:border-box;padding:24px">
      <div class="ds-glass" style="padding:28px 30px;border-radius:16px;display:grid;gap:10px;max-width:340px;text-align:center">
        <strong style="font:700 16px/1.3 var(--ds-font,system-ui);color:var(--ds-ink,#1c2333)">${zh ? "已登出" : "Signed out"}</strong>
        <p style="margin:0;font:500 13px/1.6 var(--ds-font,system-ui);color:var(--ds-ink-muted,#5a6478)">${
          zh
            ? "这台设备已经登出。去主窗口重新登录后，回来打开这个工作台就能继续用。"
            : "This device signed out. Sign back in from the main window, then reopen this workbench to continue."
        }</p>
      </div>
    </div>
  </div>`;
}

// 跟 boot.ts 的 DESKTOP_LOGGED_OUT_FLAG 是同一个 localStorage 键——照这个文件已有的取舍（顶部注释、
// defaultClientTokenReader 等）不 import boot.ts（避免 boot.ts → shell.ts → boot.ts 的循环 import），
// 本机复制这一个字符串常量的读法，比拆一个新模块只为共享一个字面量划算。
const WORKBENCH_LOGGED_OUT_STORAGE_KEY = "workhub_desktop_logged_out";

// storage 允许 undefined（没有 doc.defaultView 的合成/测试环境）——照这个文件里 windowBridge 那行
// `doc.defaultView ?? globalThis` 的既有防御纪律，绝不直接摸裸的全局 `window`。
function isDesktopLoggedOutFlagSet(storage: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return storage?.getItem(WORKBENCH_LOGGED_OUT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export type WorkbenchShellHandle = {
  store: WorkbenchStore;
  // 选中项目（rail 点击 / Spotlight「打开工作台」/ 深链三路共用）。conversationId 目前只落库，批 2 起消费。
  selectProject: (projectId: string, conversationId?: string) => void;
  // G-desktop 止血批 3：跨窗口登出广播——boot.ts 在两处调用它：①mount 那一刻标记本来就已登出
  // （isWorkbenchDesktopLoggedOut() 为真）；②运行中收到其它窗口发起的 workhub-logged-out 广播。
  // 幂等：已经在登出态再调一次是安全的空操作。
  showLoggedOut: () => void;
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
  // G-desktop 止血批 3：本窗当前是否正显示「已登出」整窗态——showLoggedOut() 置真，selectProject()
  // 据此决定是继续无视后续调用（还在登出态）还是干脆整窗重载（标记已经被别处清掉，说明用户从主窗
  // 重新登录过了——见 selectProject 顶部这段判断的注释）。
  let loggedOut = false;
  let vmRequestGen = 0;
  let chatHandle: ChatViewHandle | undefined;
  let chatMountKey: string | undefined;
  let driveHandle: DriveViewHandle | undefined;
  let driveMountKey: string | undefined;
  let armyOverviewHandle: ArmyOverviewViewHandle | undefined;
  let projectSettingsHandle: ProjectSettingsViewHandle | undefined;
  let projectSettingsMountKey: string | undefined;

  // R12 批7:打扰矩阵——windowBridge.isFocused() 告诉我们"用户是否正看着这个工作台窗口"；
  // resolveDesktopShellEmitter 是桌宠/主窗共用的通用 Tauri 事件桥(__TAURI__.event.emit),这里复用它
  // 把"该弹气泡了"的结论广播出去，接收端在 desktop-cuu-runtime.ts 的 bindDesktopShellCuuRuntime 里监听
  // 同一个新事件名("workbench-interrupt")。两者任一在当前环境不可用(浏览器 dev 预览 / 完全没有
  // Tauri)时优雅降级为 undefined——mountChatView 不会收到 onConversationEvent，纯本地渲染不受影响。
  const windowBridge = resolveWorkbenchWindowBridge(doc.defaultView ?? globalThis);
  const shellEmitter = resolveDesktopShellEmitter(doc.defaultView ?? globalThis);
  const interruptBroadcaster =
    shellEmitter?.emit
      ? createWorkbenchInterruptBroadcaster({
          emit: (eventName, payload) => shellEmitter.emit!(eventName, payload),
          // 拿不到 isFocused()(无 Tauri)时默认当作"前台"：宁可少弹一次气泡，也不要背景乱弹。
          // capabilities/workbench.json 已经授了 core:window:allow-is-focused（G-desktop 止血批 4 补的），
          // 真机上这条通常能拿到真实值，这里的兜底只覆盖"没有 __TAURI__"这一种真实场景。
          isForeground: async () => (await windowBridge?.isFocused?.()) ?? true,
          locale: input.locale
        })
      : undefined;

  const disposeChat = () => {
    chatHandle?.dispose();
    chatHandle = undefined;
    chatMountKey = undefined;
  };

  const disposeDrive = () => {
    driveHandle?.dispose();
    driveHandle = undefined;
    driveMountKey = undefined;
  };

  const disposeArmyOverview = () => {
    armyOverviewHandle?.dispose();
    armyOverviewHandle = undefined;
  };

  const disposeProjectSettings = () => {
    projectSettingsHandle?.dispose();
    projectSettingsHandle = undefined;
    projectSettingsMountKey = undefined;
  };

  // R13 批 V2:macOS 上 Rust 侧把 workbench 窗切成原生红绿灯（decorations:true + titleBarStyle
  // Overlay），自绘的 min/close 按钮就不该再渲染——不然两套控件叠一起。非 macOS（decorations:false）
  // 走原来的全自绘路径，行为不变。
  const nativeWindowChrome = isMacOsWebview(doc.defaultView ?? globalThis);
  root.innerHTML = renderWorkbenchDocumentHead() + renderWorkbenchShellHtml(input.locale, { nativeWindowChrome });
  const railEl = root.querySelector<HTMLElement>("[data-wb-rail]");
  const centerEl = root.querySelector<HTMLElement>("[data-wb-center]");
  const sideEl = root.querySelector<HTMLElement>("[data-wb-side]");
  const sideBodyEl = root.querySelector<HTMLElement>("[data-wb-side-body]");
  const sideToggleBtn = root.querySelector<HTMLElement>("[data-wb-toggle-side]");
  const minimizeBtn = root.querySelector<HTMLElement>("[data-wb-minimize]");
  const closeBtn = root.querySelector<HTMLElement>("[data-wb-close]");
  const openSpotlightBtn = root.querySelector<HTMLElement>("[data-wb-open-spotlight]");
  if (!railEl || !centerEl || !sideEl || !sideBodyEl) {
    throw new Error("workbench shell markup is missing an expected mount point");
  }

  // R12 批 6：情境面板的网盘内容控制器——挂载一次，活过项目/标签切换，这样聊天视图的 file_card
  // 点击和网盘标签的文件点击才能共用同一份右栏状态（见 drive/side-panel.ts 顶部注释）。
  const driveSidePanel: DriveSidePanelHandle = mountDriveSidePanel(sideBodyEl, store, {
    client: input.client,
    locale: input.locale,
    onRolledBack: ({ projectId }) => {
      if (driveHandle && driveMountKey === `${projectId}:drive`) {
        driveHandle.refresh();
      }
    }
  });

  // R13 批 P1：情境面板的军团内容控制器——同样挂载一次、活过项目/会话切换（见 army/panel.ts 顶部
  // 注释）。它和 driveSidePanel 共用同一个 store.sidePanelContent 插槽，靠 ownerId 决定谁的内容显示——
  // 这就是 02 计划 P1 原话「drive 预览态互斥切换的既有 store 机制沿用」。
  const armyPanel: ArmyContextPanelHandle = mountArmyContextPanel(sideBodyEl, store, {
    client: input.client,
    locale: input.locale,
    // R14 批 APPROVE-CHAT：军团输出行点击 → 右栏打开提议详情（军团面板不认识提议详情，把 id 抛给这里）。
    onOpenProposal: (proposalId) => proposalPanel.showForProposal({ proposalId })
  });

  // R14 批 APPROVE-CHAT：情境面板的第四个 owner——提议详情控制器（M1 只读 + M2 通过/打回/合并）。同样挂载
  // 一次、活过项目/会话切换，与 drive/army 共用同一个 store.sidePanelContent 插槽，靠 ownerId 互斥（见
  // proposal/panel.ts 顶部注释）。onBack 交回军团面板；onSettled 把本机审批结果回流给当前 chat view（产出卡
  // 覆盖标）+ 令军团面板后台重拉（输出行 status 翻新）。
  const proposalPanel: ProposalSidePanelHandle = mountProposalSidePanel(sideBodyEl, store, {
    client: input.client,
    locale: input.locale,
    onBack: () => armyPanel.reshow(),
    onSettled: (proposalId) => {
      chatHandle?.markProposalSettled(proposalId);
      armyPanel.refresh();
    }
  });

  // 会话情境切换（切项目/标签/会话）时，drive/army/proposal 三个右栏 owner 都要一起放手——proposal 详情是
  // 会话内的下钻，导航走开就不该残留在新视图旁边（army 面板已有这套「切走就 clear」纪律，proposal 跟上）。
  const clearContextPanels = () => {
    armyPanel.clear();
    proposalPanel.clear();
  };

  const selectProject = (projectId: string, conversationId?: string) => {
    // G-desktop 止血批 3：本窗正显示「已登出」整窗态时，任何想让它去拉数据的调用（rail 点击/深链/
    // 冷启动兜底,见 boot.ts 的三路调用方）都先在这里截住——不能顺着往下发一个带废 token 的请求。
    // 如果登出标记这时候已经被清掉（用户从主窗重新登录过了），最简单可靠的恢复路径是整窗重载：
    // 这个 shell 实例的三栏子控制器已经在 showLoggedOut() 里整批 dispose 过，原地"复活"等于把
    // mountWorkbenchShell 的挂载逻辑重写一遍，不如直接 reload 让 boot() 走一次干净的正常挂载——
    // 如果这次调用本身就带着一个真实的深链目标，pending-deep-link.ts 的 stash 机制会在 reload 后
    // 原样把它接回来，不丢上下文。仍处于登出态就什么都不做，继续晾着那张「已登出」卡片。
    if (loggedOut) {
      if (!isDesktopLoggedOutFlagSet(doc.defaultView?.localStorage)) {
        doc.defaultView?.location.reload();
      }
      return;
    }
    const my = ++vmRequestGen;
    // 换项目时回到默认的主区群聊标签——上一个项目的中栏标签对新项目没有意义。
    store.setState({
      selectedProjectId: projectId,
      pendingConversationId: conversationId,
      vm: undefined,
      vmLoad: "loading",
      vmError: undefined,
      centerTab: "chat"
    });
    // 右栏跟着清空：上一个项目挑的文件预览/版本历史对新项目没有意义，留着会显示错误项目的内容。
    // 必须走 showIdle()（而不是直接 store.setState({sidePanelContent: undefined})）——showIdle()
    // 会让还没回来的预览/版本历史请求失效，否则旧项目一个晚到的响应会把这次清空又盖回去（见
    // side-panel.ts 的 loadGeneration 注释）。armyPanel.clear() 同理让上一个会话的军团面板请求失效
    // （renderCenter 拿到新 VM 后会调 showForConversation 重新指向新项目的会话）。
    driveSidePanel.showIdle();
    clearContextPanels();
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
        // R12 功能审查 F3 修复：深链带来的 pendingConversationId 此前全链路打通却在这里被忽略——
        // Rust open_workbench(conversation_id) 精确到会话的深链永远只落到主区。现在 VM 就绪时消费一次：
        // 匹配到协同会话就直接打开它，匹配不到（含就是主区 id）诚实回退主区；用后即清，不影响后续手动切换。
        const pendingId = store.getState().pendingConversationId;
        const pendingCollab = pendingId
          ? vm.conversations.conversations.find(
              (conversation) => conversation.id === pendingId && conversation.kind === "collab"
            )
          : undefined;
        store.setState({
          vm,
          vmLoad: "ready",
          pendingConversationId: undefined,
          ...(pendingCollab ? { centerTab: "collab" as const, activeConversationId: pendingCollab.id } : {})
        });
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
  // （批 1 的 renderProjectSummaryHtml 连同它的单测已在 R13 H1 删除——批 2 起就不再是 renderCenter
  // 的调用路径，自审确认全仓库无其它调用方）。chat 视图是有状态的 imperative 组件（SSE 订阅/
  // composer 草稿/翻页），只在"项目+主会话"真的变化时才重新挂载——store 的其它字段变化（如侧栏
  // 收放）不该把它拆了重建，否则每次都会打断用户正在打的字、重新连一次 SSE。
  // R12 批 6：中栏现在按 state.centerTab 在群聊/网盘两个视图之间切——同一时刻只有一个挂在 centerEl
  // 上（和 chat 视图同款"只在 key 真变化时才重挂"纪律，见下 driveMountKey/chatMountKey）。切标签时
  // 非活动那个视图会被销毁（chat 的 SSE 订阅/composer 草稿、drive 的当前文件夹都会丢），这是已知的
  // 简化取舍（两个标签共用同一个中栏挂载位，不常驻）——留给后续批次决定要不要改成隐藏而不是销毁。
  const renderCenter = (state: WorkbenchStoreState) => {
    // R13 批 P1：军团总览是一个不依赖 selectedProjectId 的跨项目视图——必须在"没选项目"的空态判断
    // 之前拦下来，否则用户还没选过任何项目时点「军团总览」会先撞见空态页。
    if (state.centerTab === "army-overview") {
      disposeChat();
      disposeDrive();
      disposeProjectSettings();
      clearContextPanels();
      centerEl.className = "wh-wb-center wh-wb-center--army-overview";
      if (!armyOverviewHandle) {
        armyOverviewHandle = mountArmyOverviewView(centerEl, { client: input.client, locale: input.locale });
      }
      return;
    }
    disposeArmyOverview();
    if (!state.selectedProjectId) {
      disposeChat();
      disposeDrive();
      disposeProjectSettings();
      clearContextPanels();
      centerEl.className = "wh-wb-center";
      centerEl.innerHTML = renderEmptyStateHtml(input.locale, state.projects.length > 0);
      return;
    }
    if (state.vmLoad === "error") {
      disposeChat();
      disposeDrive();
      disposeProjectSettings();
      clearContextPanels();
      centerEl.className = "wh-wb-center";
      centerEl.innerHTML = renderCenterErrorHtml(input.locale);
      return;
    }
    if (state.vm) {
      const vm = state.vm;
      if (state.centerTab === "drive") {
        disposeChat();
        disposeProjectSettings();
        const key = `${vm.project.id}:drive`;
        if (driveHandle && driveMountKey === key) {
          return; // 已经是这个项目的网盘标签——它自己的 store 在内部持续更新，无需重挂。
        }
        disposeDrive();
        clearContextPanels();
        centerEl.className = "wh-wb-center wh-wb-center--drive";
        driveHandle = mountDriveView(centerEl, {
          client: input.client,
          locale: input.locale,
          projectId: vm.project.id,
          projectName: vm.project.name,
          sidePanel: driveSidePanel
        });
        driveMountKey = key;
        // 刚打开网盘标签——右栏给个「点文件查看」的诚实占位，取代批 5 那条通用预告文案
        // （这里已经有真内容了）。
        driveSidePanel.showIdle();
        return;
      }
      // R13 批 P3：项目设置标签（AI 治理表单，settings/view.ts）——同 drive/chat 的"key 没变就不重挂"
      // 纪律。editable 由 vm.viewer.is_project_owner 决定（rail 只对负责人渲染入口，这里仍传真实值兜底：
      // 所有权在会话中途变更时表单老实降级成只读，见 settings/view.ts 顶部注释）。
      if (state.centerTab === "project-settings") {
        disposeChat();
        disposeDrive();
        const key = `${vm.project.id}:project-settings`;
        if (projectSettingsHandle && projectSettingsMountKey === key) {
          return;
        }
        disposeProjectSettings();
        clearContextPanels();
        centerEl.className = "wh-wb-center wh-wb-center--project-settings";
        projectSettingsHandle = mountProjectSettingsView(centerEl, {
          client: input.client,
          locale: input.locale,
          projectId: vm.project.id,
          projectName: vm.project.name,
          editable: vm.viewer.is_project_owner
        });
        projectSettingsMountKey = key;
        return;
      }
      disposeDrive();
      disposeProjectSettings();
      // final-turns-wiring：centerTab === "collab" 时中栏挂的是某个具体的协同会话（单聊），不是主区。
      // 在 vm 里找 activeConversationId 对应的那个 kind='collab' 会话——找不到（树叶指向的会话已经不在
      // 这次 VM 快照里，比如权限变化/深链过期）就不假装能渲染它，静默落回下面的主区分支，而不是渲染一个
      // "会话不存在"的死胡同页：主区在契约上保证总是存在，落回去是诚实的可用降级，不是掩盖问题
      // （真正的"这个会话你看不到"场景在 chat/view.ts 的 renderConversationAccessDeniedHtml 里已经有
      // 处理——那是"选中了一个会话再去请求历史时才发现拿不到"，这里是"rail 压根没能提供这个会话"，
      // 两种情况不同，见批 8 report 对 denied 状态的既有边界说明）。
      const collabConversation =
        state.centerTab === "collab" && state.activeConversationId
          ? vm.conversations.conversations.find(
              (conversation) => conversation.kind === "collab" && conversation.id === state.activeConversationId
            )
          : undefined;
      if (collabConversation) {
        const key = `${vm.project.id}:${collabConversation.id}`;
        if (chatHandle && chatMountKey === key) {
          return; // 已经是这个协同会话的 chat 视图——同主区分支的"key 没变就不重挂"纪律。
        }
        disposeChat();
        centerEl.className = "wh-wb-center wh-wb-center--chat";
        chatHandle = mountChatView(centerEl, {
          client: input.client,
          locale: input.locale,
          projectId: vm.project.id,
          projectName: vm.project.name,
          conversationId: collabConversation.id,
          conversationKind: "collab",
          currentUserId: vm.viewer.user_id,
          members: vm.workspace_members.items,
          getClientToken,
          streamUrl: input.client.streams.conversation(collabConversation.id),
          onConversationEvent: (raw: unknown) => {
            void interruptBroadcaster?.handleRawConversationEvent(raw);
            armyPanel.handleRawConversationEvent(raw);
          },
          onOpenDriveFile: (fileInput) => driveSidePanel.showPreview({ projectId: vm.project.id, itemId: fileInput.itemId, itemName: fileInput.itemName }),
          // R14 批 APPROVE-CHAT：产出卡「看提议」→ 右栏提议详情（与军团输出行汇流到同一个控制器）。
          onOpenProposal: (proposalId) => proposalPanel.showForProposal({ proposalId })
        });
        chatMountKey = key;
        // R13 批 P1：情境面板默认态挂军团三区——会话情境存在时（这里是刚挂上这个协同会话的 chat 视图）
        // 就该拉这个会话的军团面板，取代批 5 之前的通用占位文案。
        armyPanel.showForConversation({ projectId: vm.project.id, conversationId: collabConversation.id });
        return;
      }
      const mainConversation = vm.conversations.conversations.find((conversation) => conversation.kind === "main");
      if (!mainConversation) {
        // 批 0 的 workbenchPageVmSchema 已经用 superRefine 保证"恰好一个 main 会话"存在；真到这里说明
        // 服务端契约被破坏，老实报错而不是假装能渲染群聊。
        disposeChat();
        clearContextPanels();
        centerEl.className = "wh-wb-center";
        centerEl.innerHTML = renderCenterErrorHtml(input.locale);
        return;
      }
      const key = `${vm.project.id}:${mainConversation.id}`;
      if (chatHandle && chatMountKey === key) {
        return; // 已经是这个会话的 chat 视图——它自己的 store/SSE 订阅在内部持续更新，无需重挂。
      }
      disposeChat();
      centerEl.className = "wh-wb-center wh-wb-center--chat";
      chatHandle = mountChatView(centerEl, {
        client: input.client,
        locale: input.locale,
        projectId: vm.project.id,
        projectName: vm.project.name,
        conversationId: mainConversation.id,
        conversationKind: "main",
        // R13 终验修复（个人空间单聊必回）：个人空间的 main 会话是 1:1 单聊，chat 视图放行 turn
        // 通道；数据源=左栏「我的空间」列表（GET /me/personal-projects），与团队项目列表互斥。
        projectIsPersonal: store.getState().personalProjects.some((project) => project.id === vm.project.id),
        currentUserId: vm.viewer.user_id,
        members: vm.workspace_members.items,
        getClientToken,
        streamUrl: input.client.streams.conversation(mainConversation.id),
        onConversationEvent: (raw: unknown) => {
          void interruptBroadcaster?.handleRawConversationEvent(raw);
          armyPanel.handleRawConversationEvent(raw);
        },
        // R12 批 6：file_card 点击 → 右栏预览，和网盘标签共用同一个 driveSidePanel 控制器。
        onOpenDriveFile: (fileInput) => driveSidePanel.showPreview({ projectId: vm.project.id, itemId: fileInput.itemId, itemName: fileInput.itemName }),
        // R14 批 APPROVE-CHAT：产出卡「看提议」→ 右栏提议详情（与军团输出行汇流到同一个控制器）。
        onOpenProposal: (proposalId) => proposalPanel.showForProposal({ proposalId })
      });
      chatMountKey = key;
      // R13 批 P1：见上面协同会话分支同款注释——主区会话情境存在时，情境面板默认态挂军团三区。
      armyPanel.showForConversation({ projectId: vm.project.id, conversationId: mainConversation.id });
      return;
    }
    disposeChat();
    disposeDrive();
    disposeProjectSettings();
    clearContextPanels();
    centerEl.className = "wh-wb-center";
    centerEl.innerHTML = renderCenterLoadingHtml(input.locale);
  };

  // R12 批 6：右栏内容现在有真正的所有者概念（state.sidePanelContent，见 store.ts 顶部注释）——
  // driveSidePanel/armyPanel 在有内容时把渲染好的 html 推进 store，这里只管展示；没有任何视图认领时
  // （还没选项目/切到网盘或军团总览标签）落回一句诚实的「选一个会话」提示，不再是批 5 之前那条
  // "即将上线" 的占位文案（renderArmySidePanelIdleHtml 与军团面板自身的空状态共用同一句文案）。
  const renderSide = (state: WorkbenchStoreState) => {
    sideEl.dataset.open = state.sidePanelOpen ? "true" : "false";
    if (sideToggleBtn) {
      sideToggleBtn.innerHTML = state.sidePanelOpen ? workbenchIcons.chevronRight : workbenchIcons.chevronLeft;
    }
    sideBodyEl.innerHTML = state.sidePanelContent?.html ?? renderArmySidePanelIdleHtml(input.locale);
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
    onOpenMainConversation: () => {
      store.setState({ centerTab: "chat" });
      chatHandle?.focusComposer();
    },
    // final-turns-wiring：某个协同会话树叶被点开——写入 activeConversationId + 切 centerTab，
    // renderCenter 的订阅回调负责按新状态挂真视图（同一个会话再点一次，key 没变，renderCenter 会
    // 直接跳过重挂，只是把焦点交回去，同 onOpenMainConversation 的既有手感一致）。
    onOpenCollabConversation: (conversationId) => {
      store.setState({ centerTab: "collab", activeConversationId: conversationId });
      chatHandle?.focusComposer();
    },
    // R12 批 6：「网盘」树叶点击路由——切 store.centerTab，renderCenter 的订阅回调负责挂真视图。
    onOpenDrive: () => store.setState({ centerTab: "drive" }),
    // R13 批 P1：左栏一级入口「军团总览」点击路由——切 store.centerTab，renderCenter 的订阅回调
    // 负责挂 army/overview.ts 真视图。
    onOpenArmyOverview: () => store.setState({ centerTab: "army-overview" }),
    // R13 批 P3：项目行「项目设置」齿轮点击路由——切 store.centerTab，renderCenter 的订阅回调
    // 负责挂 settings/view.ts 真视图（治理表单）。
    onOpenProjectSettings: () => store.setState({ centerTab: "project-settings" })
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

  minimizeBtn?.addEventListener("click", () => {
    void windowBridge?.minimize?.();
  });
  closeBtn?.addEventListener("click", () => {
    // 工作台窗是常驻可复用的（Rust 侧 create:false 复用同一个窗口实例），关闭按钮语义是「藏起来」而不是
    // 销毁窗口——和主窗/桌宠窗一致，避免下次 open_workbench 还要重新起窗口。
    void windowBridge?.hide?.();
  });
  // G-desktop 止血批 5：顶栏「打开聚焦盒」——唤起 main 窗口（苹果聚焦盒 UI 就长在那个窗口上，工作台
  // 自己不重造一份）。show_main_window 是 main.rs 已注册的既有 command（托盘菜单/单实例冷启动/深链都
  // 复用同一个 ShellWindowControlAction::ShowAndFocus 计划——show + focus 主窗），这里直接 invoke，
  // 不新增 Rust 侧 command。resolveDesktopTauriInvoke 无 Tauri 时返回 undefined，按钮点了静默无效果
  // （同这个文件其它窗口控制按钮一致的降级手感，不弹错误——这就是个便捷入口，不是关键路径）。
  openSpotlightBtn?.addEventListener("click", () => {
    // resolveDesktopTauriInvoke() 不传 scope——跟 boot.ts/spotlight/views/workbench-open.ts 等既有
    // 调用点一致，用它自己的默认 globalThis 兜底（它的 scope 类型是具名的 DesktopWindowControlsScope
    // 形状，不是 unknown，传 doc.defaultView 会撞 TS 的弱类型结构检查，不值得为这一个按钮改公共签名）。
    const invoke = resolveDesktopTauriInvoke();
    void Promise.resolve(invoke?.("show_main_window")).catch(() => undefined);
  });
  // R12 验收 F-02 修复：`-webkit-app-region:drag` 是 Electron 的私有属性，WKWebView/Tauri 根本不认——
  // 真机上标题栏四次拖动窗口坐标纹丝不动（验收证据 F-02-window-bounds.txt）。真正的拖动要在 mousedown
  // 时调 Tauri Window API 的 startDragging（window-bridge.ts 批 1 起就有这个方法，一直没接线）。
  // 按钮/可交互元素上按下不拖（否则点最小化会先把窗口拖起来）；CSS 里的 app-region 声明保留无害。
  const titlebarEl = root.querySelector<HTMLElement>("[data-wb-titlebar]");
  titlebarEl?.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest("button")) {
      return;
    }
    void windowBridge?.startDragging?.();
  });

  // 三栏子控制器的整批放手——真正的窗口卸载（dispose）和「已登出」整窗替换（showLoggedOut）都要做
  // 这同一件事：停掉 chat 的 SSE 连接、网盘/军团总览视图、rail 的后台活动、右栏三个 owner 控制器，
  // 不再是各写一份、两处容易悄悄漂移。
  const disposeActiveSubviews = () => {
    railHandle.dispose();
    disposeChat();
    disposeDrive();
    disposeArmyOverview();
    disposeProjectSettings();
    driveSidePanel.dispose();
    armyPanel.dispose();
    proposalPanel.dispose();
  };

  // G-desktop 止血批 3：跨窗口登出广播落地处——见 WorkbenchShellHandle.showLoggedOut 顶部注释、
  // boot.ts 的 bindWorkbenchLoggedOutListener。幂等（已经在登出态/真正卸载后再调都是空操作），
  // 不复用主 dispose() 的 disposed 标记——工作台窗是常驻可复用的窗口实例，登出只是"这个窗口手里的
  // 身份失效了"，不是"这个窗口要被销毁了"，两件事分开判断，真正的 dispose() 仍然只在窗口真卸载时调。
  const showLoggedOut = () => {
    if (disposed || loggedOut) {
      return;
    }
    loggedOut = true;
    disposeActiveSubviews();
    unsubscribe();
    root.innerHTML = renderWorkbenchDocumentHead() + renderWorkbenchLoggedOutHtml(input.locale);
  };

  return {
    store,
    selectProject,
    showLoggedOut,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      // loggedOut 态下 disposeActiveSubviews()/unsubscribe() 在 showLoggedOut() 里已经跑过一次——
      // 不确定三栏子控制器各自的 dispose() 对重复调用是否都幂等，干脆不重复调，比假设"应该是幂等的"
      // 更诚实（04 §4 铁律 3 的延伸：没把握的地方不装懂）。
      if (!loggedOut) {
        disposeActiveSubviews();
        unsubscribe();
      }
    }
  };
}
