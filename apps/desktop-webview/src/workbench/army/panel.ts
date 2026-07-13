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
import { fetchAgentRunTrace, fetchConversationArmyPanel } from "./api.js";
import { mergeArmyRunPages, renderArmyPanelHtml, type ArmyPanelViewState } from "./render.js";

type Locale = "zh-CN" | "en-US";

export type ArmyContextPanelApiClient = Pick<WorkHubApiClient, "request" | "getAgentRun">;

export type ArmyContextPanelHandle = {
  // rail/chat 树叶点击、深链落地——用户主动把焦点定到某个会话上。总是强制刷新+发布。
  showForConversation: (input: { projectId: string; conversationId: string }) => void;
  // chat/view.ts 的 onConversationEvent 转发口——只有匹配当前目标会话的 conversation.action_card.updated
  // 才会触发一次后台静默重拉（不打断用户正在看的文件预览，见顶部注释）。
  handleRawConversationEvent: (raw: unknown) => void;
  // 没有会话情境时清空(如切到网盘标签/军团总览/还没选项目)——只在自己仍然是当前 owner 时才动 DOM。
  clear: () => void;
  dispose: () => void;
};

const ARMY_OWNER_ID = "army";
const DRIVE_OWNER_ID = "drive";

function errorMessage(error: unknown, locale: Locale): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return locale === "zh-CN" ? "没拉到，请重试" : "Couldn't load — try again";
}

export function mountArmyContextPanel(
  sideBodyEl: HTMLElement,
  store: WorkbenchStore,
  input: { client: ArmyContextPanelApiClient; locale: Locale }
): ArmyContextPanelHandle {
  let disposed = false;
  let target: { projectId: string; conversationId: string } | undefined;
  let state: ArmyPanelViewState | undefined;
  let loadGeneration = 0;
  let savedListScrollTop: number | undefined;

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
    if (opts.background && store.getState().sidePanelContent?.ownerId === DRIVE_OWNER_ID) {
      // 后台静默刷新：内部 state 已经在调用方更新过了，但不要把一个正在看的文件预览挤掉。
      return;
    }
    const html = renderArmyPanelHtml(state, input.locale, resolveMembers());
    store.setState({ sidePanelContent: { ownerId: ARMY_OWNER_ID, html } });
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

  function showForConversation(next: { projectId: string; conversationId: string }): void {
    target = next;
    loadPanel(next);
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
    const update = parseIncomingActionCardUpdated(raw, target.conversationId);
    if (update) {
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

  function openRunDetail(run: ArmyRunCardVM): void {
    if (state?.mode !== "list") {
      return;
    }
    savedListScrollTop = sideBodyEl.scrollTop;
    state = { mode: "detail", vm: state.vm, run, trace: { status: "idle" } };
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

  return {
    showForConversation,
    handleRawConversationEvent,
    clear,
    dispose: () => {
      disposed = true;
      if (store.getState().sidePanelContent?.ownerId === ARMY_OWNER_ID) {
        store.setState({ sidePanelContent: undefined });
      }
    }
  };
}
