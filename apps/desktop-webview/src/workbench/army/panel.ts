// WorkHub 桌面 · 工作台右栏「情境面板」的军团内容控制器——三区(输出/军团/后台任务) + run 卡下钻详情。
// 挂载一次、活到整个工作台窗口生命周期，和 drive/side-panel.ts 的 mountDriveSidePanel 同一种设计：
// 直接持有 sideBodyEl 这个真实 DOM 节点（不是只拿到渲染好的字符串），这样才能在"返回"时手动恢复
// 列表的滚动位置（见 backToList 的 savedListScrollTop）。
//
// 与网盘侧栏的互斥关系：两者都往 store.sidePanelContent 写（{ownerId, html}），谁的 ownerId 最后写进去
// 谁就是当前展示的内容——这就是"既有 store 机制"（shell.ts 头部注释、02 计划 P1 原话）。文件预览
// （drive/side-panel.ts 的 showPreview/showVersions）永远应该能盖过军团面板：那是用户主动点了一个文件，
// 意图很明确。但军团面板不应该反过来悄悄把一个用户正在看的文件预览挤掉——所以只有"用户主动切换会话"
// （showForConversation）才会强制发布；被动的后台刷新（收到 conversation.action_card.updated 事件）
// 会检查当前 ownerId，如果正被网盘预览占着就只更新内部缓存、不动 DOM（见 publish 的 background 参数）。

import type { WorkHubApiClient } from "@workhub/api-client";
import type { ArmyRunCardVM, ConversationArmyPanelVM } from "@workhub/contracts";

import { parseIncomingActionCardUpdated } from "../chat/events.js";
import { membersById } from "../chat/render.js";
import type { WorkbenchStore } from "../store.js";
import { abortAgentRun, fetchAgentRunTrace, fetchArmyBackground, fetchConversationArmyPanel } from "./api.js";
import { isIncomingAgentRunLifecycleEvent } from "./events.js";
import {
  mergeArmyRunPages,
  renderArmyPanelHtml,
  type ArmyBackgroundViewState,
  type ArmyPanelViewState
} from "./render.js";

import { armyT } from "./locales.js";
import { withErrorDetail } from "../../load-state-copy.js";

type Locale = "zh-CN" | "en-US";

export type ArmyContextPanelApiClient = Pick<WorkHubApiClient, "request" | "getAgentRun" | "abortAgentRun">;

export type ArmyContextPanelHandle = {
  // rail/chat 树叶点击、深链落地——用户主动把焦点定到某个会话上。总是强制刷新+发布。
  // R17 G3(#21)：openRunId 可选——从军团总览下钻进来时携带，会话面板加载完后自动打开该 run 的详情。
  showForConversation: (input: { projectId: string; conversationId: string; openRunId?: string }) => void;
  // chat/view.ts 的 onConversationEvent 转发口——只有匹配当前目标会话的 conversation.action_card.updated
  // 才会触发一次后台静默重拉（不打断用户正在看的文件预览，见顶部注释）。
  handleRawConversationEvent: (raw: unknown) => void;
  // R14 批 APPROVE-CHAT：提议在本机被审批后（onSettled）令军团面板后台重拉当前会话——输出行 status 走
  // ArmyOutputLinkVM.status 自然翻新。后台刷新：正被 proposal 详情占着右栏时只更内部缓存不动 DOM（见
  // publish background 守卫），等 reshow 交回时呈现新数据。
  refresh: () => void;
  // R14 批 APPROVE-CHAT：从提议详情「返回」时重新认领右栏——把当前会话的军团面板缓存态重新发布（不 refetch，
  // 只把内部 state 推回 store，盖过 proposal owner）。没有可展示的 state 时不动 DOM。
  reshow: () => void;
  // 没有会话情境时清空(如切到网盘标签/军团总览/还没选项目)——只在自己仍然是当前 owner 时才动 DOM。
  clear: () => void;
  dispose: () => void;
};

const ARMY_OWNER_ID = "army";
const DRIVE_OWNER_ID = "drive";
// R14 批 APPROVE-CHAT：右栏第四个 owner（提议详情）——军团的被动后台刷新不能悄悄把用户正在看/审批的提议
// 详情挤掉，与 drive 文件预览同一优先级（见 publish background 守卫、proposal/panel.ts 顶部互斥注释）。
const PROPOSAL_OWNER_ID = "proposal";
// R16-W3：右栏第五个 owner（文件模式：变动文件 / 所有文件）——用户切到「文件」chip 后军团的被动后台刷新
// 同样不能把它挤掉（与 drive/proposal 同一优先级，见下 publish background 守卫）。
const FILES_OWNER_ID = "files";

// S-4：产品文案在前，原始报错只作次级信息（旧写法真出错时把服务端裸串顶替了产品句子）。
function errorMessage(error: unknown, locale: Locale): string {
  return withErrorDetail(locale, armyT(locale, "couldnTLoadTheArmyPanel"), error);
}

export function mountArmyContextPanel(
  sideBodyEl: HTMLElement,
  store: WorkbenchStore,
  input: {
    client: ArmyContextPanelApiClient;
    locale: Locale;
    // R14 批 APPROVE-CHAT：军团输出行点击 → 把 proposal_id 往外抛给 shell（军团面板不认识提议详情，
    // 由 shell 转交给 proposalPanel.showForProposal）。可选：测试/未来消费者不接就是纯本地渲染。
    onOpenProposal?: (proposalId: string) => void;
    // R17 G3(#20)：escalated run 卡/详情「去处理」→ 打开决策收件箱（I1 的 openInbox 通道）。可选。
    onHandleEscalation?: () => void;
  }
): ArmyContextPanelHandle {
  let disposed = false;
  let target: { projectId: string; conversationId: string } | undefined;
  let state: ArmyPanelViewState | undefined;
  let loadGeneration = 0;
  let savedListScrollTop: number | undefined;
  // R17 G3(#8)：后台任务区（定时任务 + 主动性动态）——全局机器状态，与具体会话无关，懒加载一次并缓存，
  // 跨会话切换复用；只有手动/被动刷新时重拉。undefined = 还没拉过。
  let backgroundState: ArmyBackgroundViewState | undefined;
  let backgroundGeneration = 0;
  // R17 G3(#21)：从总览下钻带来的「加载完成后要打开的 run 详情 id」——用后即清（consumeOpenRunId）。
  let pendingOpenRunId: string | undefined;

  function resolveMembers(): ReadonlyMap<string, { nickname: string }> {
    const vm = store.getState().vm;
    if (!target || !vm || vm.project.id !== target.projectId) {
      return new Map();
    }
    return membersById(vm.workspace_members.items);
  }

  function publish(opts: { background?: boolean } = {}): void {
    if (disposed || !target) {
      return;
    }
    const owner = store.getState().sidePanelContent?.ownerId;
    if (opts.background && (owner === DRIVE_OWNER_ID || owner === PROPOSAL_OWNER_ID || owner === FILES_OWNER_ID)) {
      // 后台静默刷新：内部 state 已经在调用方更新过了，但不要把一个正在看的文件预览 / 正在审批的提议详情
      // / 正在看的变动文件列表挤掉（drive/proposal/files 都是用户主动点开的，优先级高于军团的被动后台刷新）。
      return;
    }
    const html = renderArmyPanelHtml(state, input.locale, resolveMembers(), backgroundState);
    store.setState({ sidePanelContent: { ownerId: ARMY_OWNER_ID, html } });
  }

  function backgroundErrorMessage(): string {
    return armyT(input.locale, "couldnTLoadBackgroundTasks");
  }

  // R17 G3(#8)：拉后台任务区数据（懒加载 + 手动/被动刷新重拉）。best-effort：失败落 error 态（诚实标注），
  // 不影响会话面板其它区。已经在拉时（loading）不叠拉；force=false 时若已有 ready 快照则跳过（懒加载语义）。
  function loadBackground(opts: { force?: boolean } = {}): void {
    if (disposed) {
      return;
    }
    if (!opts.force && (backgroundState?.status === "ready" || backgroundState?.status === "loading")) {
      return;
    }
    const generation = ++backgroundGeneration;
    backgroundState = { status: "loading" };
    publish({ background: true });
    void fetchArmyBackground(input.client)
      .then((vm) => {
        if (disposed || generation !== backgroundGeneration) {
          return;
        }
        backgroundState = { status: "ready", vm };
        publish({ background: true });
      })
      .catch((error: unknown) => {
        if (disposed || generation !== backgroundGeneration) {
          return;
        }
        backgroundState = { status: "error", message: errorMessage(error, input.locale) || backgroundErrorMessage() };
        publish({ background: true });
      });
  }

  // R17 G3(#21)：会话面板加载完（list 就绪）后，若还挂着一个从总览下钻带来的 openRunId 且能在当前
  // 列表里找到这条 run，就自动打开它的详情。找不到（run 在更后的分页/已消失）就诚实停在列表，不假装。
  function maybeOpenPendingRunDetail(): void {
    if (!pendingOpenRunId || state?.mode !== "list") {
      return;
    }
    const runId = pendingOpenRunId;
    pendingOpenRunId = undefined;
    const run = state.vm.runs.runs.find((candidate) => candidate.id === runId);
    if (run) {
      state = { mode: "detail", vm: state.vm, run, trace: { status: "idle" }, abort: { status: "idle" } };
    }
  }

  function loadPanel(next: { projectId: string; conversationId: string }, opts: { background?: boolean } = {}): void {
    const generation = ++loadGeneration;
    if (!opts.background) {
      state = { mode: "loading" };
      publish(opts);
    }
    void fetchConversationArmyPanel(input.client, next.conversationId)
      .then((vm) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        state = { mode: "list", vm, loadingMore: false };
        maybeOpenPendingRunDetail();
        publish(opts);
      })
      .catch((error: unknown) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        if (opts.background) {
          // 背景刷新失败静默——用户已经有一份能用的快照，不要用一次被动重拉的失败去替换掉它。
          return;
        }
        state = { mode: "error", message: errorMessage(error, input.locale) };
        publish(opts);
      });
  }

  function showForConversation(next: { projectId: string; conversationId: string; openRunId?: string }): void {
    target = { projectId: next.projectId, conversationId: next.conversationId };
    pendingOpenRunId = next.openRunId;
    loadPanel(target);
    // R17 G3(#8)：切到某个会话情境时顺带懒加载一次后台任务区（全局数据，只在没拉过时拉）。
    loadBackground();
  }

  function refreshInBackground(): void {
    if (!target) {
      return;
    }
    loadPanel(target, { background: true });
  }

  function handleRawConversationEvent(raw: unknown): void {
    if (!target) {
      return;
    }
    // 既有触发器：人工决策落定（action_card.updated）时后台重拉。
    const update = parseIncomingActionCardUpdated(raw, target.conversationId);
    if (update) {
      refreshInBackground();
      return;
    }
    // R17 G3(#7)：run 状态级生命周期事件（started/failed/escalated/成功终态）双发到了本会话流——纯执行
    // 推进也能触发一次后台重拉，run 卡状态不再停在旧快照。会话流只会送到本会话的事件，无需再比 id。
    if (isIncomingAgentRunLifecycleEvent(raw)) {
      refreshInBackground();
    }
  }

  function loadMore(): void {
    if (!target || state?.mode !== "list" || state.loadingMore || !state.vm.runs.next_cursor) {
      return;
    }
    const cursor = state.vm.runs.next_cursor;
    const generation = ++loadGeneration;
    // exactOptionalPropertyTypes：loadMoreError 是 string?，不接受显式 undefined——构造一个全新对象
    // 而不是 {...state, loadMoreError: undefined} 来清掉上一次的错误。
    state = { mode: "list", vm: state.vm, loadingMore: true };
    publish();
    void fetchConversationArmyPanel(input.client, target.conversationId, {
      afterCreatedAt: cursor.after_created_at,
      afterId: cursor.after_id
    })
      .then((vm: ConversationArmyPanelVM) => {
        if (disposed || generation !== loadGeneration || state?.mode !== "list") {
          return;
        }
        const mergedRuns = mergeArmyRunPages(state.vm.runs.runs, vm.runs.runs);
        state = {
          mode: "list",
          vm: { ...vm, runs: { ...vm.runs, runs: mergedRuns } },
          loadingMore: false
        };
        publish();
      })
      .catch((error: unknown) => {
        if (disposed || generation !== loadGeneration || state?.mode !== "list") {
          return;
        }
        state = { ...state, loadingMore: false, loadMoreError: errorMessage(error, input.locale) };
        publish();
      });
  }

  function openRunDetail(run: ArmyRunCardVM, opts: { confirmAbort?: boolean } = {}): void {
    if (state?.mode !== "list") {
      return;
    }
    savedListScrollTop = sideBodyEl.scrollTop;
    // R17 G3(#19)：从卡片「取消」按钮进来时直接落在取消确认态；从卡主体点进来是普通 idle。
    const abort = opts.confirmAbort ? { status: "confirming" as const } : { status: "idle" as const };
    state = { mode: "detail", vm: state.vm, run, trace: { status: "idle" }, abort };
    publish();
  }

  function backToList(): void {
    if (state?.mode !== "detail") {
      return;
    }
    state = { mode: "list", vm: state.vm, loadingMore: false };
    publish();
    if (savedListScrollTop !== undefined) {
      sideBodyEl.scrollTop = savedListScrollTop;
      savedListScrollTop = undefined;
    }
    // R17 G3(#33)：从详情返回列表时后台重拉——停留在详情期间（可能几十秒看回放）run 状态/新 run 都可能
    // 变过，缓存的列表快照会过期。取窄：回列表即触发一次后台刷新（失败静默保留旧快照，见 loadPanel）。
    refreshInBackground();
  }

  // R17 G3(#19)：取消确认层的状态切换（只在 detail 模式、run 处于可取消态时有意义）。
  function enterAbortConfirm(): void {
    if (state?.mode !== "detail") {
      return;
    }
    state = { ...state, abort: { status: "confirming" } };
    publish();
  }

  function dismissAbort(): void {
    if (state?.mode !== "detail") {
      return;
    }
    state = { ...state, abort: { status: "idle" } };
    publish();
  }

  function confirmAbort(): void {
    if (state?.mode !== "detail" || state.abort.status === "aborting") {
      return;
    }
    const run = state.run;
    const generation = ++loadGeneration;
    state = { ...state, abort: { status: "aborting" } };
    publish();
    void abortAgentRun(input.client, run.id)
      .then((live) => {
        if (disposed || generation !== loadGeneration || state?.mode !== "detail") {
          return;
        }
        // 状态回流：把落定后的 run 状态并回详情卡（通常翻成 cancelled），取消控件随之消失。用户仍停在
        // 详情看结果，不主动跳走；列表卡的翻新交给 #33（返回列表时重拉），避免后台重拉把用户从详情弹回列表。
        state = {
          ...state,
          run: { ...state.run, status: live.status },
          abort: { status: "idle" }
        };
        publish();
      })
      .catch((error: unknown) => {
        if (disposed || generation !== loadGeneration || state?.mode !== "detail") {
          return;
        }
        state = { ...state, abort: { status: "error", message: errorMessage(error, input.locale) } };
        publish();
      });
  }

  function openReplay(): void {
    if (state?.mode !== "detail" || state.trace.status === "loading") {
      return;
    }
    const runId = state.run.id;
    const generation = ++loadGeneration;
    state = { ...state, trace: { status: "loading" } };
    publish();
    void fetchAgentRunTrace(input.client, runId)
      .then((data) => {
        if (disposed || generation !== loadGeneration || state?.mode !== "detail") {
          return;
        }
        state = { ...state, trace: { status: "ready", data } };
        publish();
      })
      .catch((error: unknown) => {
        if (disposed || generation !== loadGeneration || state?.mode !== "detail") {
          return;
        }
        state = { ...state, trace: { status: "error", message: errorMessage(error, input.locale) } };
        publish();
      });
  }

  sideBodyEl.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const el = event.target;
    if (el.closest("[data-wb-army-load-more]")) {
      loadMore();
      return;
    }
    if (el.closest("[data-wb-army-back]")) {
      backToList();
      return;
    }
    if (el.closest("[data-wb-army-open-replay]")) {
      openReplay();
      return;
    }
    const proposalBtn = el.closest<HTMLElement>("[data-wb-army-open-proposal]");
    if (proposalBtn?.dataset.wbArmyOpenProposal) {
      // 军团面板不认识提议详情，只把点击往外抛给 shell（→ proposalPanel.showForProposal）。
      input.onOpenProposal?.(proposalBtn.dataset.wbArmyOpenProposal);
      return;
    }
    // R17 G3(#20)：escalated run 卡/详情「去处理」→ 打开决策收件箱（往外抛给 shell 的 openInbox）。
    if (el.closest("[data-wb-army-handle-escalation]")) {
      input.onHandleEscalation?.();
      return;
    }
    // R17 G3(#19)：取消（abort）——卡片按钮打开详情并进确认态；详情里的确认层三个动作各自切态/执行。
    const abortCardBtn = el.closest<HTMLElement>("[data-wb-army-abort-run]");
    if (abortCardBtn?.dataset.wbArmyAbortRun && state?.mode === "list") {
      const run = state.vm.runs.runs.find((r) => r.id === abortCardBtn.dataset.wbArmyAbortRun);
      if (run) {
        openRunDetail(run, { confirmAbort: true });
      }
      return;
    }
    if (el.closest("[data-wb-army-abort-open]")) {
      enterAbortConfirm();
      return;
    }
    if (el.closest("[data-wb-army-abort-confirm]")) {
      confirmAbort();
      return;
    }
    if (el.closest("[data-wb-army-abort-dismiss]")) {
      dismissAbort();
      return;
    }
    const runBtn = el.closest<HTMLElement>("[data-wb-army-open-run]");
    if (runBtn?.dataset.wbArmyOpenRun && state?.mode === "list") {
      const run = state.vm.runs.runs.find((r) => r.id === runBtn.dataset.wbArmyOpenRun);
      if (run) {
        openRunDetail(run);
      }
    }
  });

  function clear(): void {
    target = undefined;
    state = undefined;
    ++loadGeneration;
    if (store.getState().sidePanelContent?.ownerId === ARMY_OWNER_ID) {
      store.setState({ sidePanelContent: undefined });
    }
  }

  // R14 批 APPROVE-CHAT：从提议详情返回时把当前会话的军团面板缓存态重新发布（不 refetch，只把内部 state
  // 推回 store 盖过 proposal owner）。没有 state（还没选会话/已 clear）时不动 DOM——由 shell 兜底 idle。
  function reshow(): void {
    if (disposed || !state) {
      return;
    }
    publish();
  }

  // 显式刷新（shell 在提议落定/审批动作后调）——会话面板 + 后台任务区一并翻新（后台强制重拉，取到最新
  // pulse tick / 主动性动态）。SSE 被动触发（handleRawConversationEvent）只刷会话面板、不重拉后台，避免
  // 高频事件把后台端点打爆。
  function refreshAll(): void {
    refreshInBackground();
    loadBackground({ force: true });
  }

  return {
    showForConversation,
    handleRawConversationEvent,
    refresh: refreshAll,
    reshow,
    clear,
    dispose: () => {
      disposed = true;
      if (store.getState().sidePanelContent?.ownerId === ARMY_OWNER_ID) {
        store.setState({ sidePanelContent: undefined });
      }
    }
  };
}
