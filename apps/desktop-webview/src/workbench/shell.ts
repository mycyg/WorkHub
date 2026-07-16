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
import { connectConversationStream, type ConversationStreamHandle } from "./chat/stream.js";
import { mountChatView, type ChatViewApiClient, type ChatViewHandle } from "./chat/view.js";
import {
  closeConversationTab,
  openConversationTab,
  refreshTabs,
  type ConversationTabDescriptor,
  type OpenConversationTab
} from "./conversation-tabs/model.js";
import { renderConversationTabsHtml } from "./conversation-tabs/render.js";
import { loadOpenConversationTabs, saveOpenConversationTabs } from "./conversation-tabs/storage.js";
import { workbenchCss } from "./css.js";
import { dmMembersFromParticipants, dmPeerParticipant, fetchDmList, openDirectMessage, upsertDmListItem } from "./dm.js";
import { mountProfilePopover, type ProfilePopoverHandle } from "./profile-popover.js";
import { mountDriveSidePanel, type DriveSidePanelApiClient, type DriveSidePanelHandle } from "./drive/side-panel.js";
import { mountDriveView, type DriveTabApiClient, type DriveViewHandle } from "./drive/view.js";
import { workbenchIcons } from "./icons.js";
import { mountInboxView, type InboxViewHandle } from "./inbox/view.js";
import { mountTimelineView, type TimelineViewHandle } from "./timeline/view.js";
import { mountKanbanView, type KanbanViewHandle } from "./kanban/view.js";
import { mountScheduleView, type ScheduleViewHandle } from "./schedule/view.js";
import { mountProposalSidePanel, type ProposalSidePanelApiClient, type ProposalSidePanelHandle } from "./proposal/panel.js";
import { mountFilesSidePanel, type FilesSidePanelHandle } from "./files/panel.js";
import { mountEditorView, type EditorViewHandle } from "./editor/view.js";
import { reviewProposalWithoutMerge } from "../spotlight/views/proposals.js";
import { createWorkbenchInterruptBroadcaster } from "./interrupt-broadcast.js";
import {
  bumpConversationUnreadInVm,
  bumpDmUnread,
  mountWorkbenchRail,
  setConversationUnreadInVm,
  setDmUnread,
  type WorkbenchRailApiClient
} from "./rail.js";
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
  Pick<WorkHubApiClient, "listProjects" | "bootstrapProject" | "pages" | "request" | "streams" | "uploadDriveFile" | "deleteDriveItem" | "restoreDriveItem" | "getAgentRun" | "reviewProposal" | "mergeProposal"
    // R15 批 I1（决策收件箱进 workbench）：中栏收件箱复用 spotlight attention 的全类型决策动作，需要这一组
    // 写方法（respondApproval/resolveEscalation/resolveBudgetDecision/resolveMemoryConflict/skipTaskPlanProposal/
    // applyMergeProposalCandidate/postApprovalComment）——全是 WorkHubApiClient 早已具名存在的方法（spotlight
    // 审批视图一直在用），boot 传的就是全量 createApiClient()，这里只是把 shell 的 Pick 白名单补齐，零新增 api 面。
    | "respondApproval" | "resolveEscalation" | "resolveBudgetDecision" | "resolveMemoryConflict" | "skipTaskPlanProposal" | "applyMergeProposalCandidate" | "postApprovalComment">;

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
        <div class="wh-wb-center-col" data-wb-center-col>
          <div class="wh-wb-sess-strip" data-wb-sess-strip></div>
          <div class="wh-wb-center" data-wb-center></div>
        </div>
        <div class="wh-wb-side" data-wb-side data-open="true">
          <div class="wh-wb-side-head">
            ${workbenchIcons.army}
            <span class="wh-wb-side-title">${zh ? "情境面板" : "Context panel"}</span>
            <div class="wh-wb-titlebar-spacer"></div>
            <button type="button" class="wh-wb-winbtn" data-wb-toggle-side aria-label="${zh ? "收起情境面板" : "Collapse context panel"}">${workbenchIcons.chevronRight}</button>
          </div>
          <div class="wh-wb-side-tabs" data-wb-side-tabs hidden></div>
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
  // R15 批 B（人对人私聊）：按会话直开一条 DM（rail 私聊行 / 头像资料卡「发私聊」/ 未来 DM 深链共用）。
  openDmConversation: (conversationId: string) => void;
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
  // R15 批 E2（项目时间线 / 甘特）：中栏时间线标签——同 drive 的「key 没变就不重挂」纪律（timelineMountKey）。
  let timelineHandle: TimelineViewHandle | undefined;
  let timelineMountKey: string | undefined;
  // R16 批 W2：从看板/日程卡片点进来时预约的时间线定位行——切到 timeline 前写入，timeline 分支消费一次。
  let pendingTimelineFocus: string | undefined;
  // R16 批 W2：中栏任务看板标签——同 timeline 的「key 没变就不重挂」纪律（kanbanMountKey）。
  let kanbanHandle: KanbanViewHandle | undefined;
  let kanbanMountKey: string | undefined;
  // R16 批 W2：中栏日程标签——同上。
  let scheduleHandle: ScheduleViewHandle | undefined;
  let scheduleMountKey: string | undefined;
  let armyOverviewHandle: ArmyOverviewViewHandle | undefined;
  // R17 G3(#21)：从军团总览下钻带来的「加载完该会话军团面板后要打开的 run 详情 id」——drilldown 时写入，
  // 会话情境挂载时透传给 armyPanel.showForConversation 并即清（consumeArmyRunDetailId）。
  let pendingArmyRunDetailId: string | undefined;
  let projectSettingsHandle: ProjectSettingsViewHandle | undefined;
  let projectSettingsMountKey: string | undefined;
  // R15 批 I1（决策收件箱）：中栏收件箱视图（跨项目，不依赖 selectedProjectId，同 army-overview）。
  let inboxHandle: InboxViewHandle | undefined;
  // R16-W3：中栏变更编辑器（tracked-changes 审阅器）——同 drive/chat 的「key 没变就不重挂」纪律（editorMountKey）。
  let editorHandle: EditorViewHandle | undefined;
  let editorMountKey: string | undefined;
  // R16-W4b2（中栏会话 tab 条）：单调递增的激活序号——喂给 openConversationTab 当 lastActiveAt，保证被激活的
  // tab 唯一最大（LRU 淘汰/幂等判定都靠它）。tabsRestored：localStorage 恢复只做一次（首个 vm/dm 就绪时）。
  let tabActivationSeq = 0;
  let tabsRestored = false;
  const nextTabSeq = () => (tabActivationSeq += 1);

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

  const disposeTimeline = () => {
    timelineHandle?.dispose();
    timelineHandle = undefined;
    timelineMountKey = undefined;
  };

  const disposeKanban = () => {
    kanbanHandle?.dispose();
    kanbanHandle = undefined;
    kanbanMountKey = undefined;
  };

  const disposeSchedule = () => {
    scheduleHandle?.dispose();
    scheduleHandle = undefined;
    scheduleMountKey = undefined;
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

  const disposeInbox = () => {
    inboxHandle?.dispose();
    inboxHandle = undefined;
  };

  const disposeEditor = () => {
    editorHandle?.dispose();
    editorHandle = undefined;
    editorMountKey = undefined;
  };

  // R13 批 V2:macOS 上 Rust 侧把 workbench 窗切成原生红绿灯（decorations:true + titleBarStyle
  // Overlay），自绘的 min/close 按钮就不该再渲染——不然两套控件叠一起。非 macOS（decorations:false）
  // 走原来的全自绘路径，行为不变。
  const nativeWindowChrome = isMacOsWebview(doc.defaultView ?? globalThis);
  root.innerHTML = renderWorkbenchDocumentHead() + renderWorkbenchShellHtml(input.locale, { nativeWindowChrome });
  const railEl = root.querySelector<HTMLElement>("[data-wb-rail]");
  const centerEl = root.querySelector<HTMLElement>("[data-wb-center]");
  // R16-W4b2：中栏顶部「已打开会话」tab 条——是 centerEl 的兄弟（不放 centerEl 里，否则中栏视图重挂时
  // innerHTML 会把它冲掉），活过所有中栏视图切换。
  const sessStripEl = root.querySelector<HTMLElement>("[data-wb-sess-strip]");
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
    onOpenProposal: (proposalId) => proposalPanel.showForProposal({ proposalId }),
    // R17 G3(#20)：escalated run 卡/详情「去处理」→ 决策收件箱（openInbox 是下方 const，闭包内延迟引用不触 TDZ）。
    onHandleEscalation: () => openInbox()
  });

  // R17 G3(#21)：会话情境挂载时取一次下钻带来的 run 详情 id（用后即清，避免误用到下一次普通导航）。
  const consumeArmyRunDetailId = (): string | undefined => {
    const id = pendingArmyRunDetailId;
    pendingArmyRunDetailId = undefined;
    return id;
  };

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

  // R15 批 A6（产出卡内联批准）：聊天流产出卡「批准」内联提交——复用右栏同一套 reviewProposalWithoutMerge
  // 动作（approve 不合并，合并仍只在右栏），成功后军团面板后台重拉（输出行 status 翻新）。本地忙态/落定态
  // 回流由 chat view 自己管（它 await 这个 Promise）+ 服务端档③ 的 proposal_settled「落定行」广播。
  const approveProposalFromChat = async (proposalId: string): Promise<void> => {
    await reviewProposalWithoutMerge(input.client, proposalId, { locale: input.locale });
    if (disposed) {
      return;
    }
    armyPanel.refresh();
  };
  // 「打回」不内联（要写理由）：打开右栏提议详情并聚焦理由输入（proposal/panel.ts 的 focusReason）。
  const requestChangesProposalFromChat = (proposalId: string) => {
    proposalPanel.showForProposal({ proposalId, focusReason: true });
  };

  // R16-W3：右栏第五个 owner——「文件」模式（变动文件 / 所有文件）。变动文件行点击 → 打开中栏编辑器；
  // 所有文件的文件行点击 → 走既有 drive 预览（driveSidePanel.showPreview，与聊天 file_card 同一个 owner）。
  const filesSidePanel: FilesSidePanelHandle = mountFilesSidePanel(sideBodyEl, store, {
    client: input.client,
    locale: input.locale,
    onOpenEditor: (target) => openEditor(target),
    onOpenDriveFile: (target) => driveSidePanel.showPreview(target)
  });

  // R16-W3：右栏「提议 / 文件」chip 的当前会话情境（军团/文件两个 owner 共用同一个 projectId+conversationId）。
  // 在 renderCenter 的会话分支里随 armyPanel.showForConversation 一起写入；离开会话情境时 clearContextPanels 清空。
  let sideContextTarget: { projectId: string; conversationId: string } | undefined;
  // 文件面板当前已加载的是哪个会话——切会话要重拉，同会话内 chip 往返只 republish 缓存态（不 refetch）。
  let filesLoadedForConversationId: string | undefined;

  // 会话情境切换（切项目/标签/会话）时，drive/army/proposal/files 四个右栏 owner 都要一起放手——proposal
  // 详情/变动文件都是会话内的下钻，导航走开就不该残留在新视图旁边；顺带把 chip 模式复位成 proposals（默认）。
  const clearContextPanels = () => {
    armyPanel.clear();
    proposalPanel.clear();
    filesSidePanel.clear();
    sideContextTarget = undefined;
    filesLoadedForConversationId = undefined;
    if (store.getState().sideContextMode !== "proposals") {
      store.setState({ sideContextMode: "proposals" });
    }
  };

  // R16-W3：右栏进入会话情境——记下 target 供「提议 / 文件」chip 用，并按当前 chip 模式认领右栏。默认
  // proposals 模式由 armyPanel.showForConversation 认领（调用方已调）；若模式停在 files（同一会话内切了
  // tab 又回来）就改由文件面板认领。
  const enterSideContext = (target: { projectId: string; conversationId: string }) => {
    sideContextTarget = target;
    if (store.getState().sideContextMode === "files") {
      ensureFilesShown();
    }
  };

  // 「文件」chip：文件面板认领右栏。同会话内往返只 republish 缓存态，切了会话才重拉。
  function ensureFilesShown(): void {
    if (!sideContextTarget) {
      return;
    }
    if (filesLoadedForConversationId === sideContextTarget.conversationId) {
      filesSidePanel.reshow();
    } else {
      filesSidePanel.showForContext(sideContextTarget);
      filesLoadedForConversationId = sideContextTarget.conversationId;
    }
  }

  // R16-W3：右栏变动文件行 / 编辑器内切文件 → 打开中栏变更编辑器。returnTab = 打开前的中栏视图
  // （关闭编辑器时回去）；已经在编辑器里再开另一个文件时保留最初的 returnTab。
  function openEditor(target: { proposalId: string; path: string; filename: string }): void {
    const state = store.getState();
    const returnTab =
      state.centerTab === "editor" ? state.editorTarget?.returnTab ?? "chat" : state.centerTab;
    store.setState({ centerTab: "editor", editorTarget: { ...target, returnTab } });
  }

  // R16-W3：聊天产出卡「在编辑器中查看」——卡只带 proposal_id（无具体文件路径），这里拉一次提议详情，
  // 取第一个可逐行对照的文本变更（target_ref.path + machine_summary.generated_content_md）开编辑器；
  // 没有可对照的文本变更就诚实退回右栏提议详情，绝不开一个空编辑器。
  const openProposalInEditor = (proposalId: string) => {
    void input.client.pages
      .proposal(proposalId, { locale: input.locale })
      .then((detail) => {
        if (disposed) {
          return;
        }
        const change = detail.manifest.changes.find(
          (item) => item.target_ref.path && typeof item.machine_summary?.generated_content_md === "string"
        );
        const path = change?.target_ref.path;
        if (path) {
          openEditor({ proposalId, path, filename: path.split("/").filter(Boolean).pop() ?? path });
        } else {
          proposalPanel.showForProposal({ proposalId });
        }
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        proposalPanel.showForProposal({ proposalId });
      });
  };

  // ── R15 批 B（人对人私聊）：DM 的「按会话直开」路径 ─────────────────────────────────────
  // DM 容器项目对项目树/工作台 VM 全线围栏（findWorkbenchAccess fail-closed），DM 会话不经 selectProject
  // /workbench VM（那条路径会去拉容器 VM 拿到 404）。改走：store.dmList 里那条 DmListItemVM 本身就带了
  // 会话（含容器 project_id/cuu_enabled）+ 两名参与者（含对方昵称）——chat 视图挂载只用得到 conversationId
  // （消息/已读/presence/turns 全是会话级端点 /api/conversations/:id/*，与容器项目无关）+ 真实参与者集合
  // （已读 N/M 的分母因此收敛成 1/1，而不是拿全工作区成员）。
  let dmListRequestGen = 0;
  const ensureDmListLoaded = () => {
    const my = ++dmListRequestGen;
    return fetchDmList(input.client)
      .then((result) => {
        if (disposed || my !== dmListRequestGen) {
          return;
        }
        const selfFromDm = result.items
          .flatMap((item) => item.participants)
          .find((participant) => participant.is_self)?.user_id;
        store.setState({
          dmList: result.items,
          dmListLoad: "ready",
          ...(store.getState().currentUserId === undefined && selfFromDm ? { currentUserId: selfFromDm } : {})
        });
        // R16-W4b2：DM 列表就绪也能给出 workspace/user 作用域（dm-only 冷启动 vm 还没加载时的兜底恢复点）。
        maybeRestoreTabs();
      })
      .catch(() => {
        if (disposed || my !== dmListRequestGen) {
          return;
        }
        store.setState({ dmListLoad: "error" });
      });
  };

  // R15 批 A6（rail 未读红点）：当前中栏正打开的是哪条会话——me-stream 收到该会话新消息通知时不给它加
  // 未读（用户在看、它有自己的会话流、读游标在推进）。main 会话没有独立 id 字段，从 vm 里按 kind 找。
  const currentlyOpenConversationId = (): string | undefined => {
    const state = store.getState();
    if (state.centerTab === "dm") {
      return state.activeDmConversationId;
    }
    if (state.centerTab === "collab") {
      return state.activeConversationId;
    }
    if (state.centerTab === "chat") {
      return state.vm?.conversations.conversations.find((conversation) => conversation.kind === "main")?.id;
    }
    return undefined;
  };

  // R15 批 A6：打开会话即本地清零未读红点（读游标推进是 chat 视图 PUT /read 的事，这里只同步左栏徽标）。
  const clearConversationUnread = (conversationId: string) => {
    const state = store.getState();
    const patch: Partial<WorkbenchStoreState> = {};
    if (state.vm) {
      const nextVm = setConversationUnreadInVm(state.vm, conversationId, 0);
      if (nextVm !== state.vm) {
        patch.vm = nextVm;
      }
    }
    const nextDm = setDmUnread(state.dmList, conversationId, 0);
    if (nextDm !== state.dmList) {
      patch.dmList = nextDm;
    }
    if (Object.keys(patch).length > 0) {
      store.setState(patch);
    }
  };

  const openDmConversation = (conversationId: string) => {
    store.setState({ centerTab: "dm", activeDmConversationId: conversationId });
    // 打开即清零该 DM 的未读红点。
    clearConversationUnread(conversationId);
    // 列表里还没有这条（深链冷启动 / rail 还没拉完）——后台补一次列表，renderCenter 的 dm 分支此刻先渲
    // loading，列表回来后 store 通知会重挂上真视图。
    if (!store.getState().dmList.some((dm) => dm.conversation.id === conversationId)) {
      void ensureDmListLoaded();
    }
  };

  // R15 批 I1（决策收件箱）：维护 rail 顶部「待拍板」计数徽标——GET /api/pages/attention 的 queue 长度
  // （与主窗 refreshApprovalsBadge 同源）。首帧拉一次 + me-stream 决策类通知刷新 + 收件箱动作落定刷新 +
  // 30s 兜底轮询。best-effort：拉不到就不动徽标、不打断（单调代次守卫防晚到响应覆盖新值）。
  let inboxBadgeRequestGen = 0;
  const refreshInboxBadge = () => {
    const my = ++inboxBadgeRequestGen;
    void input.client.pages
      .attention({ locale: input.locale })
      .then((vm) => {
        if (disposed || my !== inboxBadgeRequestGen) {
          return;
        }
        store.setState({ inboxCount: vm.queue?.length ?? 0 });
      })
      .catch(() => {
        // 角标尽力而为——拉不到保持上一次的计数，不清零骚扰。
      });
  };

  // R15 批 I1/I2：切中栏到决策收件箱——rail 顶部「待拍板」入口与聊天流 digest 卡「打开收件箱」共用一处，
  // 打开即顺手刷一次计数（对齐权威）。
  const openInbox = () => {
    store.setState({ centerTab: "inbox" });
    refreshInboxBadge();
  };

  // R15 批 A6（rail 未读红点 · 实时性）：workbench 订一条 /api/push/stream/me，只消费会话消息类
  // notification.created（带 conversation_id）——收到就给对应会话的未读本地 +1（近似，不知道服务端精确
  // 聚合数，30s DM 兜底刷新 + 打开清零把它拉回权威），让左栏红点在 workbench 只开着、没打开那条会话时
  // 也能动。当前正打开的那条会话不加（见 currentlyOpenConversationId）。断线重连语义复用会话流同一套
  // connectConversationStream（指数退避 + 心跳看门狗）。浏览器 dev 无 fetch 时 connect 内部优雅降级。
  const meStream: ConversationStreamHandle = connectConversationStream({
    url: input.client.streams.me(),
    getClientToken,
    onEvent: (event) => {
      if (disposed || event.type !== "notification.created") {
        return;
      }
      const data = event.data as { type?: string; conversation_id?: string } | null | undefined;
      // R15 批 I1（决策收件箱）：会话消息/被@之外的通知（审批请求、提议开出、升级、里程碑等决策类）到达时
      // 刷新「待拍板」计数徽标——这些正是进决策队列的类型（增量刷新/标脏，权威数仍以下一次 GET attention 为准）。
      // 会话消息/被@两类是聊天未读、不进决策队列，跳过（否则忙聊天时会无谓地反复拉 attention）。
      if (data && data.type !== "conversation.message" && data.type !== "conversation.mention") {
        refreshInboxBadge();
      }
      const conversationId = data?.conversation_id;
      if (!conversationId) {
        return;
      }
      // 只有会话消息/被@类通知才动未读红点——审批/里程碑等其它类型即便挂了 conversation_id 也不计入
      // "会话里有新消息未读"这个语义（它们进决策队列/通知列表，不是聊天未读）。
      if (data.type !== "conversation.message" && data.type !== "conversation.mention") {
        return;
      }
      if (conversationId === currentlyOpenConversationId()) {
        return;
      }
      const state = store.getState();
      const patch: Partial<WorkbenchStoreState> = {};
      if (state.vm) {
        const nextVm = bumpConversationUnreadInVm(state.vm, conversationId);
        if (nextVm !== state.vm) {
          patch.vm = nextVm;
        }
      }
      const nextDm = bumpDmUnread(state.dmList, conversationId);
      if (nextDm !== state.dmList) {
        patch.dmList = nextDm;
      }
      if (Object.keys(patch).length > 0) {
        store.setState(patch);
      }
    }
  });

  // 深链兜底：某个 conversationId 是不是一条（本 actor 参与的）DM——是就直开，返回是否命中。
  const tryOpenDmByConversationId = async (conversationId: string): Promise<boolean> => {
    if (store.getState().dmList.some((dm) => dm.conversation.id === conversationId)) {
      openDmConversation(conversationId);
      return true;
    }
    await ensureDmListLoaded();
    if (disposed) {
      return false;
    }
    if (store.getState().dmList.some((dm) => dm.conversation.id === conversationId)) {
      openDmConversation(conversationId);
      return true;
    }
    return false;
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
    // R15 批 B（人对人私聊）：深链/调用方给的 conversationId 已知是一条 DM（容器项目被围栏，走不了 VM
    // 路径）——直开这条 DM，不去拉容器 VM（会 404）。列表还没加载时，交给下面 VM 404 的 .catch 兜底。
    if (conversationId && store.getState().dmList.some((dm) => dm.conversation.id === conversationId)) {
      openDmConversation(conversationId);
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
          // R15 批 B：VM 就绪时记住 viewer——头像资料卡判自己 / roster 排除自己 / presence 排除自己都用它。
          currentUserId: vm.viewer.user_id,
          ...(pendingCollab ? { centerTab: "collab" as const, activeConversationId: pendingCollab.id } : {})
        });
        // R15 批 A6：VM 就绪后中栏落在哪条会话上（默认主区 / 深链协同），用户此刻正看着它——清零它的未读
        // 红点（VM 里的 unread_count 是拉取那一刻的历史未读，进来就在读，不该继续挂着红点）。
        const openedConversationId =
          pendingCollab?.id ?? vm.conversations.conversations.find((conversation) => conversation.kind === "main")?.id;
        if (openedConversationId) {
          clearConversationUnread(openedConversationId);
        }
        // R16-W4b2：vm 就绪即拿到 workspace/user 作用域——首次到达时恢复一次 localStorage 里的已打开会话集合。
        maybeRestoreTabs();
      })
      .catch((error) => {
        if (disposed || my !== vmRequestGen) {
          return;
        }
        // R15 批 B（深链兜底）：容器项目被围栏，DM 深链会走到这里的 404——若 pending 会话其实是一条 DM，
        // 直开它而不是报「打不开工作台」。不是 DM 才落到真错误态。
        const pendingId = store.getState().pendingConversationId;
        if (pendingId) {
          void tryOpenDmByConversationId(pendingId).then((opened) => {
            if (disposed || my !== vmRequestGen) {
              return;
            }
            if (opened) {
              store.setState({ pendingConversationId: undefined });
              return;
            }
            store.setState({
              vmLoad: "error",
              vmError: error instanceof Error ? error.message : String(error)
            });
          });
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
    // R16-W3：变更编辑器（中栏全宽 tracked-changes 审阅器）——入口走右栏「文件」模式的变动文件行点击
    // （非 rail 叶），据 editorTarget 打开。必须在"没选项目"的空态判断之前拦下（editorTarget 自带
    // proposalId/path，不依赖 vm）。与其它中栏视图不同：打开编辑器不 clearContextPanels——右栏保留「文件」
    // 模式的变动文件列表，方便在多个变动文件之间跳。
    if (state.centerTab === "editor") {
      disposeChat();
      disposeDrive();
      disposeProjectSettings();
      disposeArmyOverview();
      disposeInbox();
      disposeTimeline();
      const target = state.editorTarget;
      if (!target) {
        // editorTarget 丢了（不该发生）——诚实回到群聊，而不是渲一个空编辑器。
        disposeEditor();
        store.setState({ centerTab: "chat", editorTarget: undefined });
        return;
      }
      const key = `${target.proposalId}:${target.path}`;
      if (editorHandle && editorMountKey === key) {
        return; // 已经是这个变动文件的编辑器——无需重挂。
      }
      disposeEditor();
      centerEl.className = "wh-wb-center wh-wb-center--editor";
      editorHandle = mountEditorView(centerEl, {
        client: input.client,
        locale: input.locale,
        target: { proposalId: target.proposalId, path: target.path, filename: target.filename },
        // 打回要写理由——切右栏回提议模式并打开既有提议详情的聚焦理由器（不在编辑器里另造一份理由器）。
        onRequestChanges: (proposalId) => {
          store.setState({ sideContextMode: "proposals" });
          proposalPanel.showForProposal({ proposalId, focusReason: true });
        },
        // 批准/合并落定回流——与右栏 proposalPanel.onSettled 同一条管线（聊天产出卡覆盖标 + 军团/变动文件重拉）。
        onSettled: (proposalId) => {
          chatHandle?.markProposalSettled(proposalId);
          armyPanel.refresh();
          filesSidePanel.refresh();
        },
        onClose: () => {
          const returnTab = store.getState().editorTarget?.returnTab ?? "chat";
          store.setState({ centerTab: returnTab, editorTarget: undefined });
        }
      });
      editorMountKey = key;
      return;
    }
    disposeEditor();
    // R13 批 P1：军团总览是一个不依赖 selectedProjectId 的跨项目视图——必须在"没选项目"的空态判断
    // 之前拦下来，否则用户还没选过任何项目时点「军团总览」会先撞见空态页。
    if (state.centerTab === "army-overview") {
      disposeChat();
      disposeDrive();
      disposeProjectSettings();
      disposeInbox();
      disposeTimeline();
      disposeKanban();
      disposeSchedule();
      clearContextPanels();
      centerEl.className = "wh-wb-center wh-wb-center--army-overview";
      if (!armyOverviewHandle) {
        armyOverviewHandle = mountArmyOverviewView(centerEl, {
          client: input.client,
          locale: input.locale,
          // R17 G3(#21)：卡片下钻——selectProject(该项目)；带血缘会话就顺带 stash run id，会话情境挂载时
          // armyPanel 加载完自动打开该 run 详情（consumeArmyRunDetailId）。无血缘会话的 run 只 selectProject。
          onOpenRun: ({ projectId, runId, conversationId }) => {
            if (conversationId) {
              pendingArmyRunDetailId = runId;
              selectProject(projectId, conversationId);
            } else {
              selectProject(projectId);
            }
          }
        });
      }
      return;
    }
    // R15 批 I1（决策收件箱）：跨项目决策总览——同 army-overview，必须在"没选项目"的空态判断之前拦下
    // （用户可能还没选过任何项目就点「待拍板」）。中栏复用 spotlight attention 的全类型决策渲染/动作
    // （mountInboxView 薄壳），proposal「看详情」抛给右栏 proposalPanel（与聊天产出卡「看提议」汇流），
    // 动作落定回流刷新徽标 + 军团面板。clearContextPanels 让右栏先回到 idle，用户点「看详情」时再填。
    if (state.centerTab === "inbox") {
      disposeChat();
      disposeDrive();
      disposeProjectSettings();
      disposeArmyOverview();
      disposeTimeline();
      disposeKanban();
      disposeSchedule();
      clearContextPanels();
      if (!inboxHandle) {
        inboxHandle = mountInboxView(centerEl, {
          client: input.client,
          locale: input.locale,
          onOpenProposal: (proposalId) => proposalPanel.showForProposal({ proposalId }),
          onActionSettled: () => {
            refreshInboxBadge();
            armyPanel.refresh();
          }
        });
      }
      return;
    }
    disposeArmyOverview();
    disposeInbox();
    // R15 批 B（人对人私聊）：DM 走「按会话直开」——不依赖 selectedProjectId/vm（容器项目被围栏），必须
    // 在下面的空态/VM 判断之前拦下。数据全在 store.dmList 里那条 DmListItemVM（会话 + 两名参与者）。
    if (state.centerTab === "dm") {
      disposeDrive();
      disposeProjectSettings();
      disposeTimeline();
      disposeKanban();
      disposeSchedule();
      clearContextPanels();
      const dm = state.dmList.find((item) => item.conversation.id === state.activeDmConversationId);
      if (!dm) {
        // 列表还没拉到这条（深链冷启动 / 刚发起）——诚实渲染 loading，列表回来后 store 通知会重挂真视图。
        disposeChat();
        centerEl.className = "wh-wb-center";
        centerEl.innerHTML = renderCenterLoadingHtml(input.locale);
        return;
      }
      const key = `dm:${dm.conversation.id}`;
      if (chatHandle && chatMountKey === key) {
        return; // 已经是这条 DM 的 chat 视图，无需重挂。
      }
      disposeChat();
      const zh = input.locale === "zh-CN";
      const currentUserId = state.currentUserId ?? dm.participants.find((p) => p.is_self)?.user_id ?? "";
      // DM 的成员集合 = 两名真实参与者——已读 N/M 的分母因此收敛成 1/1（见 dm.ts dmMembersFromParticipants）。
      const members = dmMembersFromParticipants(dm);
      const peer = dmPeerParticipant(dm, currentUserId);
      centerEl.className = "wh-wb-center wh-wb-center--chat";
      chatHandle = mountChatView(centerEl, {
        client: input.client,
        locale: input.locale,
        projectId: dm.conversation.project_id,
        projectName: peer?.nickname ?? (zh ? "私聊" : "Direct message"),
        conversationId: dm.conversation.id,
        conversationKind: "collab",
        // DM 头显示对方昵称 + 在线点（而非「N 位成员 + Cuu」的群聊条）。
        isDm: true,
        // DM 默认 cuu_enabled=false（B5 拍板）——chat 视图据此不自动请 Cuu 回话（不特判 DM，纯由
        // cuu_enabled 驱动，见 view.ts 的 isCollabConversation）。
        cuuEnabled: dm.conversation.cuu_enabled,
        currentUserId,
        members,
        getClientToken,
        streamUrl: input.client.streams.conversation(dm.conversation.id),
        onConversationEvent: (raw: unknown) => {
          void interruptBroadcaster?.handleRawConversationEvent(raw);
        },
        onOpenDriveFile: (fileInput) =>
          driveSidePanel.showPreview({
            projectId: dm.conversation.project_id,
            itemId: fileInput.itemId,
            itemName: fileInput.itemName
          }),
        onOpenProposal: (proposalId) => proposalPanel.showForProposal({ proposalId }),
        onApproveProposal: approveProposalFromChat,
        onRequestChangesProposal: requestChangesProposalFromChat,
        // R16-W3：产出卡「在编辑器中查看」→ 中栏变更编辑器。
        onOpenProposalInEditor: openProposalInEditor,
        // R15 批 I2（决策 digest 卡）：聊天流里的 pending_digest 卡「打开收件箱」→ 切中栏到 I1 收件箱视图。
        onOpenInbox: openInbox
      });
      chatMountKey = key;
      return;
    }
    if (!state.selectedProjectId) {
      disposeChat();
      disposeDrive();
      disposeProjectSettings();
      disposeTimeline();
      disposeKanban();
      disposeSchedule();
      clearContextPanels();
      centerEl.className = "wh-wb-center";
      centerEl.innerHTML = renderEmptyStateHtml(input.locale, state.projects.length > 0);
      return;
    }
    if (state.vmLoad === "error") {
      disposeChat();
      disposeDrive();
      disposeProjectSettings();
      disposeTimeline();
      disposeKanban();
      disposeSchedule();
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
        disposeTimeline();
        disposeKanban();
        disposeSchedule();
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
      // R15 批 E2（项目时间线 / 甘特）：时间线标签——同 drive 的「key 没变就不重挂」纪律。时间线不占右栏
      // （交互全在中栏内联表单/选择器里），进入时把右栏三个 owner 放手回 idle（clearContextPanels），不残留
      // 上一个会话的军团/提议面板。
      if (state.centerTab === "timeline") {
        disposeChat();
        disposeDrive();
        disposeProjectSettings();
        disposeKanban();
        disposeSchedule();
        const key = `${vm.project.id}:timeline`;
        if (timelineHandle && timelineMountKey === key) {
          // R16 批 W2：已挂着这个项目的时间线——若是从看板/日程带着定位行跳进来，消费一次焦点即可，不重挂。
          if (pendingTimelineFocus) {
            timelineHandle.focusRow(pendingTimelineFocus);
            pendingTimelineFocus = undefined;
          }
          return; // 已经是这个项目的时间线标签——它自己的瞬态状态在内部持续更新，无需重挂。
        }
        disposeTimeline();
        clearContextPanels();
        centerEl.className = "wh-wb-center wh-wb-center--timeline";
        timelineHandle = mountTimelineView(centerEl, {
          client: input.client,
          locale: input.locale,
          projectId: vm.project.id,
          projectName: vm.project.name,
          // R16 批 W2：带着预约的定位行冷挂——timeline 首次加载完成后自己消费一次。
          ...(pendingTimelineFocus ? { initialFocusWorkItemId: pendingTimelineFocus } : {})
        });
        pendingTimelineFocus = undefined;
        timelineMountKey = key;
        driveSidePanel.showIdle();
        return;
      }
      // R16 批 W2：任务看板标签——同 timeline 的「key 没变就不重挂」纪律。看板不占右栏（交互全在中栏拖拽/
      // 提示里），进入时把右栏三个 owner 放手回 idle（clearContextPanels）。卡片点击 → 跳时间线并定位该行。
      if (state.centerTab === "kanban") {
        disposeChat();
        disposeDrive();
        disposeProjectSettings();
        disposeTimeline();
        const key = `${vm.project.id}:kanban`;
        if (kanbanHandle && kanbanMountKey === key) {
          return; // 已经是这个项目的看板标签——瞬态状态在内部持续更新，无需重挂。
        }
        disposeKanban();
        disposeSchedule();
        clearContextPanels();
        centerEl.className = "wh-wb-center wh-wb-center--kanban";
        kanbanHandle = mountKanbanView(centerEl, {
          client: input.client,
          locale: input.locale,
          projectId: vm.project.id,
          projectName: vm.project.name,
          onOpenTimelineRow: (workItemId) => {
            pendingTimelineFocus = workItemId;
            store.setState({ centerTab: "timeline" });
          }
        });
        kanbanMountKey = key;
        driveSidePanel.showIdle();
        return;
      }
      // R16 批 W2：日程标签——同 timeline 的「key 没变就不重挂」纪律。日程纯只读、不占右栏（clearContextPanels
      // 放手三个 owner）；卡片点击 → 跳时间线并定位该行。
      if (state.centerTab === "schedule") {
        disposeChat();
        disposeDrive();
        disposeProjectSettings();
        disposeTimeline();
        disposeKanban();
        const key = `${vm.project.id}:schedule`;
        if (scheduleHandle && scheduleMountKey === key) {
          return; // 已经是这个项目的日程标签——瞬态状态（本周偏移）在内部持续更新，无需重挂。
        }
        disposeSchedule();
        clearContextPanels();
        centerEl.className = "wh-wb-center wh-wb-center--schedule";
        scheduleHandle = mountScheduleView(centerEl, {
          client: input.client,
          locale: input.locale,
          projectId: vm.project.id,
          projectName: vm.project.name,
          onOpenTimelineRow: (workItemId) => {
            pendingTimelineFocus = workItemId;
            store.setState({ centerTab: "timeline" });
          }
        });
        scheduleMountKey = key;
        driveSidePanel.showIdle();
        return;
      }
      // R13 批 P3：项目设置标签（AI 治理表单，settings/view.ts）——同 drive/chat 的"key 没变就不重挂"
      // 纪律。editable 由 vm.viewer.is_project_owner 决定（rail 只对负责人渲染入口，这里仍传真实值兜底：
      // 所有权在会话中途变更时表单老实降级成只读，见 settings/view.ts 顶部注释）。
      if (state.centerTab === "project-settings") {
        disposeChat();
        disposeDrive();
        disposeTimeline();
        disposeKanban();
        disposeSchedule();
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
      disposeTimeline();
      disposeKanban();
      disposeSchedule();
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
          // R15 批 B：透传会话级 Cuu 硬开关（cuu_enabled=false 的协同会话不自动请 Cuu 回话，见
          // view.ts 的 isCollabConversation）——additive，cuu_enabled=true 的既有会话行为不变。
          cuuEnabled: collabConversation.cuu_enabled,
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
          // R15 批 A6：产出卡内联「批准」/「打回」——批准复用 reviewProposalWithoutMerge，打回打开右栏聚焦理由。
          onOpenProposal: (proposalId) => proposalPanel.showForProposal({ proposalId }),
          onApproveProposal: approveProposalFromChat,
          onRequestChangesProposal: requestChangesProposalFromChat,
          // R16-W3：产出卡「在编辑器中查看」→ 中栏变更编辑器。
          onOpenProposalInEditor: openProposalInEditor
        });
        chatMountKey = key;
        // R13 批 P1：情境面板默认态挂军团三区——会话情境存在时（这里是刚挂上这个协同会话的 chat 视图）
        // 就该拉这个会话的军团面板，取代批 5 之前的通用占位文案。
        // R17 G3(#21)：若是从军团总览下钻进来的，透传 openRunId，面板加载完自动打开该 run 详情。
        const collabOpenRunId = consumeArmyRunDetailId();
        armyPanel.showForConversation({
          projectId: vm.project.id,
          conversationId: collabConversation.id,
          ...(collabOpenRunId ? { openRunId: collabOpenRunId } : {})
        });
        enterSideContext({ projectId: vm.project.id, conversationId: collabConversation.id });
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
        // R15 批 B：透传会话级 Cuu 硬开关——团队主区 conversationKind=main 本就不自动 turn，个人空间单聊
        // （下方 projectIsPersonal）随 cuu_enabled 决定，additive，既有默认 cuu_enabled=true 行为不变。
        cuuEnabled: mainConversation.cuu_enabled,
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
        // R15 批 A6：产出卡内联「批准」/「打回」——批准复用 reviewProposalWithoutMerge，打回打开右栏聚焦理由。
        onOpenProposal: (proposalId) => proposalPanel.showForProposal({ proposalId }),
        onApproveProposal: approveProposalFromChat,
        onRequestChangesProposal: requestChangesProposalFromChat,
        // R16-W3：产出卡「在编辑器中查看」→ 中栏变更编辑器（拉提议详情取第一个可对照文本变更）。
        onOpenProposalInEditor: openProposalInEditor,
        // R15 批 I2（决策 digest 卡）：聊天流里的 pending_digest 卡「打开收件箱」→ 切中栏到 I1 收件箱视图。
        onOpenInbox: openInbox
      });
      chatMountKey = key;
      // R13 批 P1：见上面协同会话分支同款注释——主区会话情境存在时，情境面板默认态挂军团三区。
      // R17 G3(#21)：主区会话也可能是下钻目标（run 血缘会话就是项目主区）——同样透传 openRunId。
      const mainOpenRunId = consumeArmyRunDetailId();
      armyPanel.showForConversation({
        projectId: vm.project.id,
        conversationId: mainConversation.id,
        ...(mainOpenRunId ? { openRunId: mainOpenRunId } : {})
      });
      enterSideContext({ projectId: vm.project.id, conversationId: mainConversation.id });
      return;
    }
    disposeChat();
    disposeDrive();
    disposeProjectSettings();
    disposeTimeline();
    disposeKanban();
    disposeSchedule();
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

  // R16-W3：右栏顶部「提议 / 文件」模式 chip（外壳 chrome，非任何 owner 的 body 内容）——只在会话情境
  // （chat/collab/editor 且已 enterSideContext）下出现；其它 tab（drive/timeline/设置/收件箱/军团总览/DM）
  // 隐藏，右栏交回各自管理。点击切 sideContextMode 并让对应 owner 认领右栏。
  const sideTabsEl = root.querySelector<HTMLElement>("[data-wb-side-tabs]");
  const renderSideTabs = (state: WorkbenchStoreState) => {
    if (!sideTabsEl) {
      return;
    }
    const inConversationContext =
      (state.centerTab === "chat" || state.centerTab === "collab" || state.centerTab === "editor") &&
      sideContextTarget !== undefined;
    sideTabsEl.hidden = !inConversationContext;
    if (!inConversationContext) {
      sideTabsEl.innerHTML = "";
      return;
    }
    const zh = input.locale === "zh-CN";
    const mode = state.sideContextMode;
    sideTabsEl.innerHTML = `
      <button type="button" class="wh-wb-smode${mode === "proposals" ? " is-active" : ""}" data-wb-side-mode="proposals" aria-pressed="${mode === "proposals"}">${zh ? "提议" : "Proposals"}</button>
      <button type="button" class="wh-wb-smode${mode === "files" ? " is-active" : ""}" data-wb-side-mode="files" aria-pressed="${mode === "files"}">${zh ? "文件" : "Files"}</button>`;
  };

  sideTabsEl?.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const btn = event.target.closest<HTMLElement>("[data-wb-side-mode]");
    const mode = btn?.dataset.wbSideMode;
    if (mode === "proposals") {
      store.setState({ sideContextMode: "proposals" });
      // 提议模式 = 军团面板认领右栏（盖过文件/提议详情 owner）。
      filesSidePanel.clear();
      armyPanel.reshow();
    } else if (mode === "files") {
      store.setState({ sideContextMode: "files" });
      ensureFilesShown();
    }
  });

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

  // ── R16-W4b2（中栏「已打开会话」tab 条） ───────────────────────────────────────────────
  const tabStorage = (): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined => {
    try {
      return doc.defaultView?.localStorage;
    } catch {
      return undefined;
    }
  };
  // 当前中栏正打开的那条会话（主区/协同/私聊）的完整描述——集合据此激活/加入。vm/dmList 还没就绪时返回
  // undefined（等它们回来 store 通知会再跑一次），绝不凭空造 tab。
  const describeActiveConversation = (state: WorkbenchStoreState): ConversationTabDescriptor | undefined => {
    const zh = input.locale === "zh-CN";
    if (state.centerTab === "dm") {
      const id = state.activeDmConversationId;
      if (!id) {
        return undefined;
      }
      const dm = state.dmList.find((item) => item.conversation.id === id);
      if (!dm) {
        return undefined;
      }
      const peer = dmPeerParticipant(dm, state.currentUserId);
      return {
        kind: "dm",
        conversationId: id,
        projectId: dm.conversation.project_id,
        title: peer?.nickname ?? (zh ? "私聊" : "Direct message")
      };
    }
    const vm = state.vm;
    if (!vm) {
      return undefined;
    }
    if (state.centerTab === "collab") {
      const id = state.activeConversationId;
      if (!id) {
        return undefined;
      }
      const conv = vm.conversations.conversations.find((item) => item.kind === "collab" && item.id === id);
      if (!conv) {
        return undefined;
      }
      return { kind: "collab", conversationId: id, projectId: vm.project.id, title: conv.title };
    }
    if (state.centerTab === "chat") {
      const main = vm.conversations.conversations.find((item) => item.kind === "main");
      if (!main) {
        return undefined;
      }
      return { kind: "main", conversationId: main.id, projectId: vm.project.id, title: vm.project.name };
    }
    return undefined;
  };
  // 持久化作用域（每用户 · 工作区维度）——工作区 id 优先取 vm，dm-only 冷启动兜底取任一 DM 的容器工作区。
  const tabScope = (state: WorkbenchStoreState): { workspaceId: string; userId: string } | undefined => {
    const userId = state.currentUserId ?? state.vm?.viewer.user_id;
    const workspaceId = state.vm?.project.workspace_id ?? state.dmList[0]?.conversation.workspace_id;
    if (!userId || !workspaceId) {
      return undefined;
    }
    return { workspaceId, userId };
  };
  const persistTabs = (state: WorkbenchStoreState): void => {
    const scope = tabScope(state);
    if (!scope) {
      return;
    }
    saveOpenConversationTabs({
      storage: tabStorage(),
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      tabs: state.openConversationTabs
    });
  };
  // 首个 vm/dm 就绪时从 localStorage 恢复一次已打开集合。与「渲染同步刚加进来的当前 tab」谁先谁后都收敛：
  // 恢复的历史 tab 铺底，再把已在集合里的（通常是刚打开的当前 tab）逐条叠上去激活到最前——去重 + 保上限。
  const maybeRestoreTabs = (): void => {
    if (tabsRestored) {
      return;
    }
    const scope = tabScope(store.getState());
    if (!scope) {
      return;
    }
    tabsRestored = true;
    const restored = loadOpenConversationTabs({
      storage: tabStorage(),
      workspaceId: scope.workspaceId,
      userId: scope.userId
    });
    if (restored.length === 0) {
      return;
    }
    // 让后续激活序号跑在恢复值之上，保证「新激活」永远比「历史」新。
    tabActivationSeq = Math.max(tabActivationSeq, ...restored.map((tab) => tab.lastActiveAt));
    let merged: OpenConversationTab[] = restored;
    for (const tab of store.getState().openConversationTabs) {
      merged = openConversationTab(
        merged,
        {
          kind: tab.kind,
          conversationId: tab.conversationId,
          ...(tab.projectId !== undefined ? { projectId: tab.projectId } : {}),
          title: tab.title
        },
        nextTabSeq()
      );
    }
    store.setState({ openConversationTabs: merged });
    persistTabs(store.getState());
  };
  // 会话 tab 条渲染（含集合同步）——只在 centerTab 为会话类且集合非空时挂出来。
  const renderSessStrip = (state: WorkbenchStoreState) => {
    if (!sessStripEl) {
      return;
    }
    let tabs = state.openConversationTabs;
    const descriptor = describeActiveConversation(state);
    if (descriptor) {
      tabs = openConversationTab(tabs, descriptor, nextTabSeq());
    }
    tabs = refreshTabs(tabs, {
      selectedProjectId: state.selectedProjectId,
      vm: state.vm,
      dmList: state.dmList,
      dmListReady: state.dmListLoad === "ready",
      currentUserId: state.currentUserId
    });
    if (tabs !== state.openConversationTabs) {
      // 幂等：openConversationTab/refreshTabs 无变化时都返回同引用——这轮 setState 触发的补发再跑一遍不会
      // 再改动集合，收敛不打转（见 store.ts 的 notifying/pendingRenotify）。
      store.setState({ openConversationTabs: tabs });
      persistTabs(store.getState());
    }
    const isConversationTab =
      state.centerTab === "chat" || state.centerTab === "collab" || state.centerTab === "dm";
    const show = isConversationTab && tabs.length > 0;
    sessStripEl.classList.toggle("is-visible", show);
    if (!show) {
      sessStripEl.innerHTML = "";
      return;
    }
    sessStripEl.innerHTML = renderConversationTabsHtml({
      tabs,
      activeConversationId: currentlyOpenConversationId(),
      dmList: state.dmList,
      currentUserId: state.currentUserId,
      onlineUserIds: new Set(state.onlineUserIds),
      locale: input.locale
    });
  };
  // 点某条 tab = 激活它（走现状 selectProject/openDm 重挂路径，不并存多实例）。
  const activateSessTab = (conversationId: string): void => {
    const state = store.getState();
    const tab = state.openConversationTabs.find((item) => item.conversationId === conversationId);
    if (!tab) {
      return;
    }
    if (tab.kind === "dm") {
      openDmConversation(conversationId);
      return;
    }
    if (!tab.projectId) {
      return;
    }
    // 同一个已加载项目内：只切中栏标签（复用已挂好的 chat 视图，不重拉 vm/不重连 SSE，同 rail 叶点击手感）。
    if (tab.projectId === state.selectedProjectId && state.vm) {
      if (tab.kind === "collab") {
        store.setState({ centerTab: "collab", activeConversationId: conversationId });
      } else {
        store.setState({ centerTab: "chat" });
      }
      clearConversationUnread(conversationId);
      chatHandle?.focusComposer();
      return;
    }
    // 跨项目：走 selectProject 重挂路径（collab 带上会话 id 精确落到那条，main 落到主区）。
    selectProject(tab.projectId, tab.kind === "collab" ? conversationId : undefined);
  };
  // 点 tab 的 x = 移出集合；若关的是当前活跃则激活相邻（无相邻则中栏原样留着，tab 条自动隐藏）。
  const closeSessTab = (conversationId: string): void => {
    const wasActive = currentlyOpenConversationId() === conversationId;
    const { tabs, neighborConversationId } = closeConversationTab(
      store.getState().openConversationTabs,
      conversationId
    );
    store.setState({ openConversationTabs: tabs });
    persistTabs(store.getState());
    if (wasActive && neighborConversationId) {
      activateSessTab(neighborConversationId);
    }
  };
  sessStripEl?.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const closeTarget = event.target.closest<HTMLElement>("[data-wb-tab-close]");
    if (closeTarget?.dataset.wbTabClose) {
      closeSessTab(closeTarget.dataset.wbTabClose);
      return;
    }
    const openTarget = event.target.closest<HTMLElement>("[data-wb-tab]");
    if (openTarget?.dataset.wbTab) {
      activateSessTab(openTarget.dataset.wbTab);
    }
  });

  const unsubscribe = store.subscribe((state) => {
    renderCenter(state);
    renderSideTabs(state);
    renderSide(state);
    renderCrumb(state);
    renderSessStrip(state);
  });
  renderCenter(store.getState());
  renderSideTabs(store.getState());
  renderSide(store.getState());
  renderCrumb(store.getState());
  renderSessStrip(store.getState());

  const railHandle = mountWorkbenchRail(railEl, {
    client: input.client,
    store,
    locale: input.locale,
    onSelectProject: selectProject,
    // 会话点击路由：点「主区」树叶把焦点交回已经挂载好的 chat composer（不重新拉数据/不重连
    // SSE——中栏此刻本来就是这个项目的 chat 视图，见 renderCenter 的 chatMountKey 复用逻辑）。
    onOpenMainConversation: () => {
      store.setState({ centerTab: "chat" });
      // R15 批 A6：打开主区即清零它的未读红点。
      const mainId = store.getState().vm?.conversations.conversations.find((conversation) => conversation.kind === "main")?.id;
      if (mainId) {
        clearConversationUnread(mainId);
      }
      chatHandle?.focusComposer();
    },
    // final-turns-wiring：某个协同会话树叶被点开——写入 activeConversationId + 切 centerTab，
    // renderCenter 的订阅回调负责按新状态挂真视图（同一个会话再点一次，key 没变，renderCenter 会
    // 直接跳过重挂，只是把焦点交回去，同 onOpenMainConversation 的既有手感一致）。
    onOpenCollabConversation: (conversationId) => {
      store.setState({ centerTab: "collab", activeConversationId: conversationId });
      // R15 批 A6：打开这条协同会话即清零它的未读红点。
      clearConversationUnread(conversationId);
      chatHandle?.focusComposer();
    },
    // R12 批 6：「网盘」树叶点击路由——切 store.centerTab，renderCenter 的订阅回调负责挂真视图。
    onOpenDrive: () => store.setState({ centerTab: "drive" }),
    // R15 批 E2（项目时间线 / 甘特）：「时间线」树叶点击路由——切 store.centerTab，renderCenter 挂 timeline/view.ts。
    onOpenTimeline: () => store.setState({ centerTab: "timeline" }),
    // R16 批 W2：「任务看板」树叶点击路由——切 store.centerTab，renderCenter 挂 kanban/view.ts。
    onOpenKanban: () => store.setState({ centerTab: "kanban" }),
    // R16 批 W2：「日程」树叶点击路由——切 store.centerTab，renderCenter 挂 schedule/view.ts。
    onOpenSchedule: () => store.setState({ centerTab: "schedule" }),
    // R13 批 P1：左栏一级入口「军团总览」点击路由——切 store.centerTab，renderCenter 的订阅回调
    // 负责挂 army/overview.ts 真视图。
    onOpenArmyOverview: () => store.setState({ centerTab: "army-overview" }),
    // R15 批 I1（决策收件箱）：rail 顶部「待拍板」一级入口点击路由——切 store.centerTab 到 "inbox"，
    // renderCenter 挂收件箱视图；顺手刷一次徽标（打开即对齐权威计数）。
    onOpenInbox: openInbox,
    // R13 批 P3：项目行「项目设置」齿轮点击路由——切 store.centerTab，renderCenter 的订阅回调
    // 负责挂 settings/view.ts 真视图（治理表单）。
    onOpenProjectSettings: () => store.setState({ centerTab: "project-settings" }),
    // R15 批 B（人对人私聊）：私聊分组某条 DM 被点开——直开这条 DM（renderCenter 的 "dm" 分支挂真视图）。
    onOpenDmConversation: (conversationId) => openDmConversation(conversationId)
  });

  // R15 批 B（人对人私聊 · B4 点头像开聊）：统一头像资料卡——挂在外壳根，事件委托覆盖 rail/中栏所有头像。
  // 「发私聊」→ POST /api/dm/open（openDirectMessage）→ 把返回的会话并进 store.dmList（对方昵称从资料卡
  // 已知的 roster 补齐，openDm 只回会话本体）→ 直开 + 让 rail 重拉列表对齐服务端权威。
  const profilePopoverHandle: ProfilePopoverHandle = mountProfilePopover(root, {
    store,
    locale: input.locale,
    onOpenDm: (userId) => {
      void openDirectMessage(input.client, userId)
        .then((result) => {
          if (disposed) {
            return;
          }
          const state = store.getState();
          const currentUserId = state.currentUserId ?? state.vm?.viewer.user_id;
          const selfMember = state.vm?.workspace_members.items.find((member) => member.is_self);
          const peerNickname =
            state.vm?.workspace_members.items.find((member) => member.user_id === userId)?.nickname
            ?? state.dmList.flatMap((dm) => dm.participants).find((p) => p.user_id === userId)?.nickname
            ?? (input.locale === "zh-CN" ? "私聊" : "Direct message");
          const selfUserId = currentUserId ?? selfMember?.user_id ?? result.conversation.created_by ?? "";
          const item = {
            conversation: result.conversation,
            participants: [
              {
                user_id: selfUserId,
                nickname: selfMember?.nickname ?? (input.locale === "zh-CN" ? "我" : "Me"),
                is_self: true
              },
              { user_id: userId, nickname: peerNickname, is_self: false }
            ]
          };
          store.setState({
            dmList: upsertDmListItem(state.dmList, item),
            ...(state.currentUserId === undefined && selfUserId ? { currentUserId: selfUserId } : {})
          });
          openDmConversation(result.conversation.id);
          // 后台重拉列表：把服务端权威的参与者/顺序对齐（本地拼的那条只是让中栏能立刻挂上）。
          railHandle.refreshDms();
        })
        .catch(() => {
          // best-effort：开聊失败（如目标已不在工作区）静默——资料卡已关闭，不弹阻断式错误。
        });
    }
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

  // R15 批 I1（决策收件箱）：首帧拉一次「待拍板」计数 + 30s 兜底轮询——me-stream 决策通知与收件箱动作
  // 落定是实时增量刷新，这条轮询兜底覆盖"没有 __TAURI__ / me-stream 掉线 / 其它入口处置了审批"时的最终
  // 一致（同主窗 refreshApprovalsBadge 的 30s 节奏）。登出/卸载在 disposeActiveSubviews 里清定时器。
  refreshInboxBadge();
  const inboxBadgePollTimer = setInterval(() => {
    if (!disposed && !loggedOut) {
      refreshInboxBadge();
    }
  }, 30_000);

  // 三栏子控制器的整批放手——真正的窗口卸载（dispose）和「已登出」整窗替换（showLoggedOut）都要做
  // 这同一件事：停掉 chat 的 SSE 连接、网盘/军团总览视图、rail 的后台活动、右栏三个 owner 控制器，
  // 不再是各写一份、两处容易悄悄漂移。
  const disposeActiveSubviews = () => {
    railHandle.dispose();
    // R15 批 A6：停掉 /api/push/stream/me 未读订阅（登出/卸载都要放手，否则登出后仍会拿废 token 重连）。
    meStream.close();
    // R15 批 I1：停掉「待拍板」计数轮询定时器。
    clearInterval(inboxBadgePollTimer);
    disposeChat();
    disposeDrive();
    disposeTimeline();
    disposeKanban();
    disposeSchedule();
    disposeArmyOverview();
    disposeProjectSettings();
    disposeInbox();
    disposeEditor();
    driveSidePanel.dispose();
    armyPanel.dispose();
    proposalPanel.dispose();
    filesSidePanel.dispose();
    profilePopoverHandle.dispose();
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
    openDmConversation,
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
