// WorkHub 桌面 · 群聊/协同会话共用视图——imperative 挂载/事件绑定层（照 shell.ts/rail.ts 的分工：纯渲染在
// render.ts，这里只负责拉数据、绑 DOM 事件、维护会话内的瞬态状态）。批 2 范围：文本+file_card 发送、
// @ 成员/文件 picker（真实）、# 会话与 / 技能 picker（外壳，「即将可用」灰态，见 render.ts 的
// renderComingSoonPickerHtml）、SSE 接线（断线指数退避重连+重连后 afterSeq 补缺口）、typing 节流。
// R12（final-turns-wiring）起：input.conversationKind === 'collab' 时，发一条文本消息之后会自动请求
// 一轮 Cuu 回应（POST /conversations/:id/turns），流式 delta 拼进临时气泡，落定后换成真消息——
// 逻辑全部下沉进 turn.ts 的纯函数（shouldRequestConversationTurn/appendTurnDelta/
// mapConversationTurnError），这里只接线。kind === 'main' 的主区群聊完全不触碰这条通道（主区归
// 静默观察者/批3处理），@Cuu 在主区里仍然只是把消息原样发出去，不会自动回应。
//
// mountChatView 本身没有直接单测（和 mountWorkbenchShell/mountWorkbenchRail 同样的取舍——这个 workspace
// 的测试运行器没有真实 DOM，见 shell.test.ts/rail.test.ts 只测 render*/纯函数这一既有事实）；真正的逻辑
// 已经拆进 render.ts/api.ts/stream.ts/events.ts/timeline.ts/trigger-parser.ts/typing-state.ts/turn.ts 的
// 纯函数里逐一单测过，这里只是把它们接起来。

import { WorkHubApiError } from "@workhub/api-client";
import type { AiMode, ConversationKind, ConversationMessageVM } from "@workhub/contracts";

import {
  fetchConversationMessagesPage,
  fetchLatestConversationMessagesPage,
  fetchMyAiProfile,
  fetchOlderConversationMessagesPage,
  patchMyAiMode,
  pingConversationTyping,
  requestConversationTurn,
  sendConversationFileCardMessage,
  sendConversationTextMessage,
  type ChatApiClient
} from "./api.js";
import {
  parseIncomingActionCardUpdated,
  parseIncomingMessageCreated,
  parseIncomingMessageDelta,
  parseIncomingTyping
} from "./events.js";
import {
  membersById,
  modePatchFailedText,
  renderChatEmptyStateHtml,
  renderComingSoonPickerHtml,
  renderComposerHtml,
  renderConnectionBannerHtml,
  renderConversationAccessDeniedHtml,
  renderCuuTurnErrorHtml,
  renderCuuTurnPendingHtml,
  renderDaySeparatorHtml,
  renderHistoryLoadErrorHtml,
  renderHistoryLoadingHtml,
  renderLoadEarlierHtml,
  renderMemberBarHtml,
  renderMentionPickerHtml,
  renderMessageHtml,
  renderModeChipHtml,
  renderModeErrorHintHtml,
  renderModeObserveOnlyHintHtml,
  renderModePopoverHtml,
  renderPendingOutgoingHtml,
  renderStreamingCuuBubbleHtml,
  renderTypingIndicatorHtml,
  type ChatRenderContext,
  type ComposerAttachmentChip,
  type ConnectionBannerState,
  type LoadEarlierState,
  type MentionPickerFile,
  type MentionPickerMember,
  type PendingOutgoingMessage,
  type WorkbenchMemberVM
} from "./render.js";
import { connectConversationStream, type ConversationStreamHandle } from "./stream.js";
import { applyComposerChipInsertion, detectComposerTrigger, type ComposerTriggerMatch } from "./trigger-parser.js";
import {
  DEFAULT_MESSAGE_RENDER_WINDOW,
  applyActionCardUpdate,
  groupMessagesByDay,
  sortAndDedupeMessages,
  windowRecentMessages
} from "./timeline.js";
import {
  appendTurnDelta,
  EMPTY_TURN_DELTA_STATE,
  mapConversationTurnError,
  renderTurnDeltaText,
  shouldRequestConversationTurn,
  type TurnDeltaState
} from "./turn.js";
import { pruneExpiredTypingUsers, upsertTypingUser, type TypingState } from "./typing-state.js";

type Locale = "zh-CN" | "en-US";

export type ChatDrivePageClient = {
  pages: {
    drive: (options: { projectId: string; q?: string }) => Promise<{ items: readonly { id: string; name: string; kind: string }[] }>;
  };
};

export type ChatViewApiClient = ChatApiClient & ChatDrivePageClient;

export type ChatViewHandle = {
  dispose: () => void;
  // rail.ts「主区」树叶点击时调用——把焦点交回 composer（会话点击路由，见批 2 汇报）。
  focusComposer: () => void;
};

type PendingSendRecord = {
  tempId: string;
  kind: "text" | "file_card";
  text?: string;
  driveItemId?: string;
  fileName?: string;
  status: "sending" | "error";
};

const TYPING_PING_MIN_INTERVAL_MS = 2000;
const FILE_SEARCH_DEBOUNCE_MS = 250;
const TYPING_PRUNE_INTERVAL_MS = 750;
const MAX_PICKER_RESULTS = 8;
// R12 批8：滚到顶（scrollTop 小于这个像素阈值）自动触发「加载更早」，同「贴底」判定
// （renderScroll 里 wasNearBottom 的 48px）同一档量级。
const SCROLL_TOP_LOAD_EARLIER_PX = 48;
// 本地 DOM 窗口每次展开的步长——不是一次性全展开（那样又变回批 2 的性能问题），小步渐进。
const RENDER_WINDOW_EXPAND_STEP = 150;

function toPendingRenderModel(record: PendingSendRecord): PendingOutgoingMessage {
  return {
    tempId: record.tempId,
    status: record.status,
    ...(record.text !== undefined ? { text: record.text } : {}),
    ...(record.fileName !== undefined ? { fileName: record.fileName } : {})
  };
}

export function addAttachment(list: readonly ComposerAttachmentChip[], next: ComposerAttachmentChip): ComposerAttachmentChip[] {
  if (list.some((attachment) => attachment.driveItemId === next.driveItemId)) {
    return [...list];
  }
  return [...list, next];
}

export function removeAttachment(list: readonly ComposerAttachmentChip[], driveItemId: string): ComposerAttachmentChip[] {
  return list.filter((attachment) => attachment.driveItemId !== driveItemId);
}

export function mountChatView(
  container: HTMLElement,
  input: {
    client: ChatViewApiClient;
    locale: Locale;
    projectId: string;
    projectName: string;
    conversationId: string;
    // R12（final-turns-wiring）：main（主区群聊，归静默观察者/批3处理）还是 collab（协同会话/单聊）——
    // 只有 collab 才会在文本消息发出去之后自动请求一轮 Cuu 回应（见 turn.ts 的
    // shouldRequestConversationTurn，这条判断本身就是"主区绝不调 turns"这条红线的唯一权威位置）。
    // 由挂载方（shell.ts）传入：主区挂载传 "main"，rail.ts 新增的协同会话树叶点开时传 "collab"。
    conversationKind: ConversationKind;
    currentUserId: string;
    members: readonly WorkbenchMemberVM[];
    getClientToken: () => string | undefined;
    streamUrl: string;
    // R12 批7:打扰矩阵的触发源——每条会话 SSE 帧的原始 event.data 都转发给它一份(不只是本视图消费
    // 得了的 message/typing),由调用方(shell.ts)接进 interrupt-broadcast.ts 判断要不要往其它窗口广播
    // 一条"该弹气泡了"。可选:不传就是纯本地渲染,不做任何打扰路由(colocated 测试/未来非工作台宿主场景)。
    onConversationEvent?: (raw: unknown) => void;
    // R12 批 6：file_card 点击 → 右栏预览，和网盘标签共用同一个情境面板控制器（在 shell.ts 挂载一次，
    // 活过项目/标签切换——见 workbench/drive/side-panel.ts 顶部注释）。可选，测试/未来消费者不必补桩。
    onOpenDriveFile?: (input: { itemId: string; itemName: string }) => void;
  }
): ChatViewHandle {
  const doc = container.ownerDocument ?? document;
  let disposed = false;
  let messages: ConversationMessageVM[] = [];
  let pending: PendingSendRecord[] = [];
  let typing: TypingState = [];
  let connection: ConnectionBannerState = "idle";
  // R12 批8："denied" 是 00 §9「无权限项目/深链到无权会话」的空态——后端非预言式 404，见
  // renderConversationAccessDeniedHtml 顶部注释。
  let historyLoad: "loading" | "ready" | "error" | "denied" = "loading";
  // R12 批8：向上翻页状态——beforeSeq 反向游标（服务端 next_before_seq，见 api.ts 顶部注释）+
  // DOM 渲染窗口（见 timeline.ts 的 windowRecentMessages）。取代批 2 的 historyTruncated 单一标记。
  let hasOlderHistory = false;
  let oldestKnownBeforeSeq: number | undefined;
  let olderLoad: "idle" | "loading" | "error" = "idle";
  let renderWindowSize = DEFAULT_MESSAGE_RENDER_WINDOW;
  let expandedMessageIds = new Set<string>();
  let attachments: ComposerAttachmentChip[] = [];
  let activeTrigger: ComposerTriggerMatch | undefined;
  let mentionMembers: MentionPickerMember[] = [];
  let mentionFiles: MentionPickerFile[] = [];
  let mentionFilesLoading = false;
  let draftFallback = "";
  let pendingCounter = 0;
  let lastTypingPingAt = 0;
  let fileSearchTimer: ReturnType<typeof setTimeout> | undefined;
  let fileSearchGeneration = 0;
  let streamHandle: ConversationStreamHandle | undefined;
  // R12（final-turns-wiring）：协同会话 turn 的瞬态 UI 状态——只在 input.conversationKind === "collab"
  // 时才会被置为非初始值（beginTurn 是唯一的写入点，而 beginTurn 只在 shouldRequestConversationTurn
  // 通过之后才被调用，见下 issueSend）。turnActive 覆盖"等第一个 delta"和"delta 正在流"两个阶段
  // （用 turnDeltaState.chunks 是否为空区分要渲染哪一种）；turnErrorText 只在这一轮失败时短暂出现，
  // 下一次发送开始新一轮时清空（不是"点掉"的 dismiss 交互，够温和，见 render.ts 的两个 renderCuuTurn*
  // 函数顶部注释）。
  let turnActive = false;
  let turnDeltaState: TurnDeltaState = EMPTY_TURN_DELTA_STATE;
  let turnErrorText: string | undefined;
  // R12（模式五档弹层，2026-07-12 纠偏后归位到单聊）：见 render.ts"模式五档"一节顶部注释——
  // isCollabConversation 是这整块功能唯一的读取点，主区（'main'）永远拿到 false，composer 不会渲染
  // 模式 chip，点击/数字键处理函数也都以这个布尔值把关（04 §4 铁律 3 的双重保险：不但不渲染入口，
  // 连事件处理都不会被触发）。myMode undefined = 还没拉到 GET /api/me/ai-profile 或者拉失败——诚实
  // 显示「模式」，不假装知道当前档（见 loadMyAiProfile）。modePopoverOpen/modeErrorText 都是这个
  // 功能自己的瞬态 UI 状态，不落库。
  const isCollabConversation = input.conversationKind === "collab";
  let myMode: AiMode | undefined;
  let modePopoverOpen = false;
  let modeErrorText: string | undefined;

  const membersMap = membersById(input.members);
  const renderCtx = (): ChatRenderContext => ({
    locale: input.locale,
    members: membersMap,
    currentUserId: input.currentUserId,
    expandedMessageIds
  });

  container.innerHTML = `<div class="wh-wb-chat">
    <div data-wb-chat-banner></div>
    <div data-wb-chat-head></div>
    <div class="wh-wb-chat-scroll" data-wb-chat-scroll></div>
    <div data-wb-chat-typing></div>
    <div data-wb-chat-turn-status></div>
    <div data-wb-chat-mode-hint></div>
    <div data-wb-chat-composer-wrap></div>
  </div>`;
  const bannerEl = container.querySelector<HTMLElement>("[data-wb-chat-banner]");
  const headEl = container.querySelector<HTMLElement>("[data-wb-chat-head]");
  const scrollEl = container.querySelector<HTMLElement>("[data-wb-chat-scroll]");
  const typingEl = container.querySelector<HTMLElement>("[data-wb-chat-typing]");
  const turnStatusEl = container.querySelector<HTMLElement>("[data-wb-chat-turn-status]");
  const modeHintEl = container.querySelector<HTMLElement>("[data-wb-chat-mode-hint]");
  const composerWrapEl = container.querySelector<HTMLElement>("[data-wb-chat-composer-wrap]");
  if (!bannerEl || !headEl || !scrollEl || !typingEl || !turnStatusEl || !modeHintEl || !composerWrapEl) {
    throw new Error("workbench chat view markup is missing an expected mount point");
  }

  headEl.innerHTML = renderMemberBarHtml({ members: input.members, locale: input.locale });

  function textareaEl(): HTMLTextAreaElement | null {
    return composerWrapEl!.querySelector<HTMLTextAreaElement>("[data-wb-chat-input]");
  }
  function pickerSlotEl(): HTMLElement | null {
    return composerWrapEl!.querySelector<HTMLElement>("[data-wb-chat-picker-slot]");
  }
  function modePopSlotEl(): HTMLElement | null {
    return composerWrapEl!.querySelector<HTMLElement>("[data-wb-chat-mode-pop-slot]");
  }

  function renderBanner(): void {
    bannerEl!.innerHTML = renderConnectionBannerHtml(connection, input.locale);
  }

  function renderTyping(): void {
    const labels = typing
      .map((entry) => membersMap.get(entry.userId)?.nickname)
      .filter((label): label is string => Boolean(label));
    typingEl!.innerHTML = renderTypingIndicatorHtml(labels, input.locale);
  }

  // R12（final-turns-wiring）：三态——turnErrorText 优先（最新的、需要被看到的信号）；否则只在还没有
  // 任何 delta 文字时显示"Cuu 正在回复…"（一旦 turnDeltaState 有内容，正在生成的气泡本身已经在
  // 消息流里做了"还在继续"的视觉提示，这里不需要重复一份，见 buildScrollBodyHtml）；都不是就清空。
  function renderTurnStatus(): void {
    if (turnErrorText) {
      turnStatusEl!.innerHTML = renderCuuTurnErrorHtml(turnErrorText);
      return;
    }
    if (turnActive && turnDeltaState.chunks.size === 0) {
      turnStatusEl!.innerHTML = renderCuuTurnPendingHtml(input.locale);
      return;
    }
    turnStatusEl!.innerHTML = "";
  }

  // R12（模式五档）：只在协同会话出现——modeErrorText（PATCH 失败的温和提示）优先，其次是「只观察档，
  // Cuu 不会回话」的预告（myMode === 1 时），都不是就清空。main 会话（isCollabConversation 为 false）
  // 永远清空这个挂载点，composer 旁不会出现任何模式相关文字。
  function renderModeHint(): void {
    if (!isCollabConversation) {
      modeHintEl!.innerHTML = "";
      return;
    }
    if (modeErrorText) {
      modeHintEl!.innerHTML = renderModeErrorHintHtml(modeErrorText);
      return;
    }
    if (myMode === 1) {
      modeHintEl!.innerHTML = renderModeObserveOnlyHintHtml(input.locale);
      return;
    }
    modeHintEl!.innerHTML = "";
  }

  // R12 批8：DOM 只挂载最近 renderWindowSize 条（windowRecentMessages，见 timeline.ts）——更早的
  // 留在 messages 数组里（翻页/去重/SSE 合并的权威数据源不变），只是不进 DOM。窗口之外还分两层：
  // 本地已经拉到内存但没展开（"local"，点了立即展开，不发请求）、和内存里也没有、要问服务端要
  // （"server-*"，beforeSeq 反向翻页，见 loadOlderHistory）。
  function currentLoadEarlierState(): LoadEarlierState {
    const { hiddenLocalCount } = windowRecentMessages(messages, renderWindowSize);
    if (hiddenLocalCount > 0) {
      return { kind: "local", hiddenCount: hiddenLocalCount };
    }
    if (olderLoad === "loading") {
      return { kind: "server-loading" };
    }
    if (olderLoad === "error") {
      return { kind: "server-error" };
    }
    if (hasOlderHistory) {
      return { kind: "server-idle" };
    }
    return { kind: "none" };
  }

  function buildScrollBodyHtml(): string {
    const ctx = renderCtx();
    const { visible } = windowRecentMessages(messages, renderWindowSize);
    const groups = groupMessagesByDay(visible, { locale: input.locale });
    let html = renderLoadEarlierHtml(currentLoadEarlierState(), input.locale);
    for (const group of groups) {
      html += renderDaySeparatorHtml(group.label);
      for (const message of group.messages) {
        html += renderMessageHtml(message, ctx);
      }
    }
    for (const record of pending) {
      html += renderPendingOutgoingHtml(toPendingRenderModel(record), ctx);
    }
    // R12（final-turns-wiring）：正在生成的 Cuu 回复——只在真的收到过至少一个 delta 时才占一个气泡位置
    // （比 turnActive 更窄；"已经发起 turn 但还没收到第一个字"由 renderTurnStatus 的"Cuu 正在回复…"
    // 状态条覆盖，不需要在消息流里先摆一个空气泡）。
    if (turnActive && turnDeltaState.chunks.size > 0) {
      html += renderStreamingCuuBubbleHtml(renderTurnDeltaText(turnDeltaState), ctx);
    }
    return html;
  }

  function renderScroll(): void {
    const el = scrollEl!;
    const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (historyLoad === "loading") {
      el.innerHTML = renderHistoryLoadingHtml(input.locale);
      return;
    }
    if (historyLoad === "error") {
      el.innerHTML = renderHistoryLoadErrorHtml(input.locale);
      return;
    }
    if (historyLoad === "denied") {
      el.innerHTML = renderConversationAccessDeniedHtml(input.locale);
      return;
    }
    if (messages.length === 0 && pending.length === 0) {
      el.innerHTML = renderChatEmptyStateHtml({ locale: input.locale, projectName: input.projectName });
      return;
    }
    el.innerHTML = buildScrollBodyHtml();
    if (wasNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }

  // 加载更早历史后重渲染：不能用 renderScroll 的 wasNearBottom/贴底逻辑（那是为"新消息到达时如果
  // 用户本来就在看最新消息，跟着滚到底"设计的）——这里是往顶部插入更早的内容，要保持用户当前正在看
  // 的那条消息在视口里的相对位置不跳动（同 Slack/Discord 的"向上无限滚动"手感），靠 scrollHeight
  // 差值补偿 scrollTop。
  function renderScrollPreservingTopAnchor(): void {
    const el = scrollEl!;
    const beforeHeight = el.scrollHeight;
    const beforeTop = el.scrollTop;
    el.innerHTML = buildScrollBodyHtml();
    el.scrollTop = beforeTop + (el.scrollHeight - beforeHeight);
  }

  function renderPicker(): void {
    const slot = pickerSlotEl();
    if (!slot) {
      return;
    }
    if (!activeTrigger) {
      slot.innerHTML = "";
      return;
    }
    if (activeTrigger.kind === "mention") {
      slot.innerHTML = renderMentionPickerHtml({
        locale: input.locale,
        members: mentionMembers,
        files: mentionFiles,
        filesLoading: mentionFilesLoading
      });
      return;
    }
    slot.innerHTML = renderComingSoonPickerHtml({ locale: input.locale, trigger: activeTrigger.trigger as "#" | "/" });
  }

  // 重建整个 composer chrome（attachments 行/send 禁用态变化时才需要）——重建前后原样保留 textarea
  // 的当前值/光标/焦点，innerHTML 重建本身会把它们清空（rail.ts 的新建项目输入框踩过同一个坑）。
  function renderComposerChrome(): void {
    const previousTa = textareaEl();
    const savedValue = previousTa?.value ?? draftFallback;
    const savedStart = previousTa?.selectionStart ?? savedValue.length;
    const savedEnd = previousTa?.selectionEnd ?? savedValue.length;
    const hadFocus = doc.activeElement === previousTa;
    composerWrapEl!.innerHTML = renderComposerHtml({
      locale: input.locale,
      draftText: savedValue,
      attachments,
      sending: false,
      // R12（模式五档）：只有协同会话才算出这个 HTML 传进去——main 会话永远是 undefined，
      // renderComposerHtml 就完全不渲染模式相关标记（见其顶部注释与 colocated 测试）。
      modeChipHtml: isCollabConversation ? renderModeChipHtml(myMode, input.locale) : undefined
    });
    const nextTa = textareaEl();
    if (nextTa && hadFocus) {
      nextTa.focus();
      try {
        nextTa.setSelectionRange(savedStart, savedEnd);
      } catch {
        // 部分渲染模式拒绝 setSelectionRange——不是致命错误，焦点已经还回去了。
      }
    }
    renderPicker();
    renderModePopover();
  }

  // R12（模式五档）：独立于 renderPicker 的同款"只重刷这一个子节点"取舍——modePopoverOpen 只在
  // 用户点击模式 chip / 选档 / Escape / 点外时变化，跟 @/#// picker 的开关走的是两条互不相干的状态线，
  // 分开维护更不容易互相踩。
  function renderModePopover(): void {
    const slot = modePopSlotEl();
    if (!slot) {
      return;
    }
    slot.innerHTML = isCollabConversation && modePopoverOpen
      ? renderModePopoverHtml({ mode: myMode, locale: input.locale })
      : "";
  }

  function syncSendButtonDisabled(): void {
    const button = composerWrapEl!.querySelector<HTMLButtonElement>("[data-wb-chat-send]");
    if (!button) {
      return;
    }
    const ta = textareaEl();
    const text = ta?.value ?? draftFallback;
    button.disabled = text.trim().length === 0 && attachments.length === 0;
  }

  // —— 历史加载（R12 批8：首屏直接要「最新一页」，不再从 afterSeq=0 正向走全量——见 api.ts 顶部
  // 注释与 batch-2-chat.md 记录的缺口） —— //
  async function loadHistory(): Promise<void> {
    historyLoad = "loading";
    renderScroll();
    try {
      const page = await fetchLatestConversationMessagesPage(input.client, input.conversationId);
      if (disposed) {
        return;
      }
      messages = sortAndDedupeMessages(page.messages);
      hasOlderHistory = page.has_more;
      oldestKnownBeforeSeq = page.next_before_seq;
      olderLoad = "idle";
      historyLoad = "ready";
      renderScroll();
      connectStream();
    } catch (error) {
      if (disposed) {
        return;
      }
      // R12 批8：00 §9「无权限项目」——深链到一个 404（不可见/不存在，后端故意同形，见
      // renderConversationAccessDeniedHtml 注释）的会话，给温和的专属空态，不是"网络抖动重试"。
      historyLoad = error instanceof WorkHubApiError && error.status === 404 ? "denied" : "error";
      renderScroll();
    }
  }

  function mergeMessages(incoming: readonly ConversationMessageVM[]): void {
    if (incoming.length === 0) {
      return;
    }
    messages = sortAndDedupeMessages([...messages, ...incoming]);
    renderScroll();
  }

  // —— R12 批8：「滚到顶加载更早」 —— //

  // 本地 DOM 窗口里还有未展开的已加载消息，就地展开，不发网络请求（见 currentLoadEarlierState 的
  // "local" 分支）；本地已经展开到头、服务端还有更早的，才真的发一次 beforeSeq 请求。
  function handleReachedTop(): void {
    if (disposed) {
      return;
    }
    const { hiddenLocalCount } = windowRecentMessages(messages, renderWindowSize);
    if (hiddenLocalCount > 0) {
      renderWindowSize += RENDER_WINDOW_EXPAND_STEP;
      renderScrollPreservingTopAnchor();
      return;
    }
    if (hasOlderHistory && olderLoad !== "loading") {
      void loadOlderHistory();
    }
  }

  async function loadOlderHistory(): Promise<void> {
    if (olderLoad === "loading" || !hasOlderHistory || oldestKnownBeforeSeq === undefined) {
      return;
    }
    olderLoad = "loading";
    renderScroll();
    let page;
    try {
      page = await fetchOlderConversationMessagesPage(input.client, input.conversationId, {
        beforeSeq: oldestKnownBeforeSeq
      });
    } catch {
      if (disposed) {
        return;
      }
      olderLoad = "error";
      renderScroll();
      return;
    }
    if (disposed) {
      return;
    }
    // 防御性熔断：服务端契约保证空页外 next_before_seq 严格倒退（同 listMessagesAfter 的
    // next_after_seq 前进保证是一对镜像约束），万一没推进（回归 bug）就当作"没有更多了"，
    // 不要在 scroll 事件驱动下反复自动重试出死循环。
    const madeProgress = page.messages.length > 0
      && page.next_before_seq !== undefined
      && page.next_before_seq < oldestKnownBeforeSeq;
    messages = sortAndDedupeMessages([...page.messages, ...messages]);
    // 展开窗口以纳入刚拉到的这批，否则它们会立刻又被本地窗口折叠掉。
    renderWindowSize += page.messages.length;
    hasOlderHistory = madeProgress && page.has_more;
    oldestKnownBeforeSeq = madeProgress ? page.next_before_seq : oldestKnownBeforeSeq;
    olderLoad = "idle";
    renderScrollPreservingTopAnchor();
  }

  // 重连成功后补缺口：断线期间的消息只能靠 afterSeq=本地已知最高 seq 重新拉一遍（broker 不存回放日志，
  // 04 §0 与 apps/api/src/sse/stream.ts 顶部注释已经写死这条约束）。
  async function reconcileGap(): Promise<void> {
    let afterSeq = messages.reduce((max, message) => Math.max(max, message.seq), 0);
    for (;;) {
      if (disposed) {
        return;
      }
      let page;
      try {
        page = await fetchConversationMessagesPage(input.client, input.conversationId, { afterSeq });
      } catch {
        return; // best-effort：下一次重连/下一条实时事件会再补一次。
      }
      if (disposed) {
        return;
      }
      mergeMessages(page.messages);
      if (!page.has_more || page.next_after_seq <= afterSeq) {
        return;
      }
      afterSeq = page.next_after_seq;
    }
  }

  // 行动卡快照过期时的按需补拉（契约注释的原话：事件只负责「该刷新了」，完整卡片以 GET 为准）：
  //  - 本地根本没有这条消息（观察者建卡只发 action_card.updated，不重发 message.created）——
  //    新卡消息 seq 必然大于本地最高 seq，走既有 reconcileGap 补进来。批8 之后首屏只拉最新一页，
  //    「本地没有」也可能是这张卡老到还没被向上翻页加载——此时 reconcileGap 无缺口可补=无害 no-op，
  //    等 beforeSeq 翻页真加载到它时再渲（渲的是当时的服务端快照）；
  //  - 本地有但事件里出现快照没有的条目（观察者追加，服务端已重写这条消息的 content 但 seq 不变）——
  //    用 afterSeq=seq-1 定点重拉这一条，mergeMessages 的按 id 去重「后到覆盖先到」把旧快照换掉。
  // best-effort：拉失败就保持现状，下一条事件或断线重连的 reconcile 再补。
  async function refreshActionCardMessage(messageId: string): Promise<void> {
    const local = messages.find((message) => message.id === messageId);
    if (!local) {
      await reconcileGap();
      return;
    }
    try {
      const page = await fetchConversationMessagesPage(input.client, input.conversationId, {
        afterSeq: local.seq - 1,
        limit: 1
      });
      if (disposed) {
        return;
      }
      const fresh = page.messages.find((message) => message.id === messageId);
      if (fresh) {
        mergeMessages([fresh]);
      }
    } catch {
      // best-effort，见上。
    }
  }

  function connectStream(): void {
    streamHandle = connectConversationStream({
      url: input.streamUrl,
      getClientToken: input.getClientToken,
      onEvent: (event) => {
        if (disposed) {
          return;
        }
        input.onConversationEvent?.(event.data);
        const message = parseIncomingMessageCreated(event.data, input.conversationId);
        if (message) {
          mergeMessages([message]);
          return;
        }
        // R12 行动卡状态回流（00 §9 撤销后置灰划线）：条目状态就地合并进本地快照，快照缺条目/缺消息
        // 时按需补拉——事件不带 title_md，光靠它渲不出新条目。
        const cardUpdate = parseIncomingActionCardUpdated(event.data, input.conversationId);
        if (cardUpdate) {
          const result = applyActionCardUpdate(messages, cardUpdate);
          if (result.changed) {
            messages = result.messages;
            renderScroll();
          }
          if (result.snapshotStale) {
            void refreshActionCardMessage(cardUpdate.messageId);
          }
          return;
        }
        const typingSignal = parseIncomingTyping(event.data, input.conversationId, input.currentUserId);
        if (typingSignal) {
          typing = upsertTypingUser(typing, typingSignal, Date.now());
          renderTyping();
        }
        // R12（final-turns-wiring）：只在这条会话真的是本地已经发起了一轮 turn（turnActive）时才拼接
        // delta——不靠 conversationKind 二次把关（parseIncomingMessageDelta 已经按 conversation_id 过滤，
        // 主区的 SSE 连接订阅的是主区自己的 topic，物理上收不到协同会话的 delta），turnActive 这层只是
        // 避免把一个跟当前"这次发送"无关的旧/重复 delta 拼进一个已经结束的气泡。
        if (turnActive) {
          const delta = parseIncomingMessageDelta(event.data, input.conversationId);
          if (delta) {
            turnDeltaState = appendTurnDelta(turnDeltaState, delta);
            renderScroll();
            renderTurnStatus();
            return;
          }
        }
        // 其它事件名（"connected" 控制帧、批4 的 tool 事件）本批不处理，静默忽略。
      },
      onStatus: (status) => {
        if (disposed) {
          return;
        }
        connection = status.state;
        renderBanner();
      },
      onReconnected: () => {
        void reconcileGap();
      }
    });
  }

  const typingPruneTimer = setInterval(() => {
    const next = pruneExpiredTypingUsers(typing, Date.now());
    if (next !== typing) {
      typing = next;
      renderTyping();
    }
  }, TYPING_PRUNE_INTERVAL_MS);

  function maybePingTyping(): void {
    const now = Date.now();
    if (now - lastTypingPingAt < TYPING_PING_MIN_INTERVAL_MS) {
      return;
    }
    lastTypingPingAt = now;
    void pingConversationTyping(input.client, input.conversationId).catch(() => undefined);
  }

  function filterMembers(query: string): MentionPickerMember[] {
    const normalized = query.trim().toLowerCase();
    const all = input.members.map((member) => ({ userId: member.user_id, nickname: member.nickname }));
    const matches = normalized ? all.filter((member) => member.nickname.toLowerCase().includes(normalized)) : all;
    return matches.slice(0, MAX_PICKER_RESULTS);
  }

  function scheduleFileSearch(query: string): void {
    if (fileSearchTimer !== undefined) {
      clearTimeout(fileSearchTimer);
    }
    const generation = ++fileSearchGeneration;
    mentionFilesLoading = true;
    renderPicker();
    fileSearchTimer = setTimeout(() => {
      void input.client.pages
        .drive({ projectId: input.projectId, q: query })
        .then((vm) => {
          if (disposed || generation !== fileSearchGeneration) {
            return;
          }
          mentionFiles = vm.items
            .filter((item) => item.kind === "file")
            .slice(0, MAX_PICKER_RESULTS)
            .map((item) => ({ itemId: item.id, name: item.name }));
          mentionFilesLoading = false;
          renderPicker();
        })
        .catch(() => {
          if (disposed || generation !== fileSearchGeneration) {
            return;
          }
          mentionFiles = [];
          mentionFilesLoading = false;
          renderPicker();
        });
    }, FILE_SEARCH_DEBOUNCE_MS);
  }

  function applyTriggerState(text: string, cursor: number): void {
    const trigger = detectComposerTrigger(text, cursor);
    activeTrigger = trigger ?? undefined;
    if (trigger?.kind === "mention") {
      mentionMembers = filterMembers(trigger.query);
      scheduleFileSearch(trigger.query);
      return;
    }
    mentionFiles = [];
    mentionFilesLoading = false;
    renderPicker();
  }

  function pickMember(userId: string | undefined): void {
    if (!userId || !activeTrigger) {
      return;
    }
    const nickname = membersMap.get(userId)?.nickname;
    const ta = textareaEl();
    if (!nickname || !ta) {
      return;
    }
    const result = applyComposerChipInsertion(ta.value, activeTrigger, `@${nickname} `);
    ta.value = result.text;
    draftFallback = result.text;
    activeTrigger = undefined;
    mentionFiles = [];
    try {
      ta.setSelectionRange(result.cursor, result.cursor);
    } catch {
      // ignore — value is already correct even if the cursor can't be restored.
    }
    ta.focus();
    renderPicker();
    syncSendButtonDisabled();
  }

  function pickFile(itemId: string | undefined): void {
    if (!itemId || !activeTrigger) {
      return;
    }
    const file = mentionFiles.find((candidate) => candidate.itemId === itemId);
    const ta = textareaEl();
    if (!file || !ta) {
      return;
    }
    const result = applyComposerChipInsertion(ta.value, activeTrigger, "");
    ta.value = result.text;
    draftFallback = result.text;
    activeTrigger = undefined;
    try {
      ta.setSelectionRange(result.cursor, result.cursor);
    } catch {
      // ignore.
    }
    attachments = addAttachment(attachments, { driveItemId: file.itemId, name: file.name });
    renderComposerChrome();
  }

  function insertMentionShortcut(): void {
    const ta = textareaEl();
    if (!ta) {
      return;
    }
    ta.focus();
    const cursor = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, cursor);
    const needsSpace = before.length > 0 && !/\s$/u.test(before);
    const insertion = `${needsSpace ? " " : ""}@`;
    const nextValue = `${before}${insertion}${ta.value.slice(cursor)}`;
    const nextCursor = cursor + insertion.length;
    ta.value = nextValue;
    draftFallback = nextValue;
    try {
      ta.setSelectionRange(nextCursor, nextCursor);
    } catch {
      // ignore.
    }
    applyTriggerState(nextValue, nextCursor);
  }

  function issueSend(record: PendingSendRecord): void {
    const promise =
      record.kind === "text"
        ? sendConversationTextMessage(input.client, input.conversationId, record.text ?? "")
        : sendConversationFileCardMessage(input.client, input.conversationId, record.driveItemId ?? "");
    promise
      .then((created) => {
        if (disposed) {
          return;
        }
        pending = pending.filter((entry) => entry.tempId !== record.tempId);
        mergeMessages([created]);
        // R12（final-turns-wiring）：一条文本消息真的落库之后，协同会话（kind='collab'）自动请 Cuu
        // 接一句——shouldRequestConversationTurn 是唯一的判定点（见 turn.ts 顶部注释），主区
        // （kind='main'）在这里永远拿到 false，不会走到 beginTurn 半步。file_card 消息不触发——服务端
        // 契约本来就只认"最近一条 user_message_id 指向的文本消息"当锚点，丢一个文件不构成"该 Cuu 说话了"
        // 的信号。
        if (record.kind === "text" && shouldRequestConversationTurn(input.conversationKind)) {
          beginTurn(created.id);
        }
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        const found = pending.find((entry) => entry.tempId === record.tempId);
        if (found) {
          found.status = "error";
          renderScroll();
        }
      });
  }

  // R12（final-turns-wiring）：POST /conversations/:id/turns 的等待/流式/落定三段。同一会话同时只有
  // 一轮进行中（服务端并发闸，见 conversation-turns.ts），所以不需要在这里做本地互斥——下一次
  // enqueueSend 只会在这一轮的 promise 还没结束时也发起（用户可以边等边接着打字/发下一条），那种情况下
  // 服务端会用 409 conversation_turn_busy 拒第二个 turn 请求，mapConversationTurnError 会把它翻成
  // 「Cuu 正忙着上一轮」——不是本地要去拦的错误，是要如实展示的服务端状态。
  function beginTurn(userMessageId: string): void {
    if (disposed) {
      return;
    }
    turnActive = true;
    turnDeltaState = EMPTY_TURN_DELTA_STATE;
    turnErrorText = undefined;
    renderTurnStatus();
    requestConversationTurn(input.client, input.conversationId, { userMessageId })
      .then((result) => {
        if (disposed) {
          return;
        }
        turnActive = false;
        turnDeltaState = EMPTY_TURN_DELTA_STATE;
        // 服务端设计决策：Cuu 落库的回复不会触发任何 message.created 广播（见 turn.ts 顶部注释）——
        // 这次 HTTP 响应本身就是唯一的权威"这一轮说完了"信号。mergeMessages 按 id 去重，真把它排进
        // 消息流该在的位置，同时（内部调用 renderScroll）把上面的临时气泡换成这条真消息。
        mergeMessages([result.message]);
        renderTurnStatus();
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        turnActive = false;
        turnDeltaState = EMPTY_TURN_DELTA_STATE;
        turnErrorText = mapConversationTurnError(
          error instanceof WorkHubApiError ? { status: error.status, code: error.code } : undefined,
          input.locale
        );
        // mergeMessages 在成功路径里已经会 renderScroll；失败路径没有新消息可合并，这里手动补一次
        // 好让临时气泡从消息流里消失（turnActive 已经是 false，buildScrollBodyHtml 不会再画它）。
        renderScroll();
        renderTurnStatus();
      });
  }

  // R12（模式五档）：挂载时拉一次「我的模式」——只有协同会话才拉（主区 composer 根本不渲染这个控件，
  // 拉了也没地方展示）。失败就让 myMode 保持 undefined，chip 诚实显示「模式」，不瞎猜一个默认档；
  // 04 §4 铁律 3 的"不假接线"延伸到"不假装知道状态"。
  async function loadMyAiProfile(): Promise<void> {
    if (!isCollabConversation) {
      return;
    }
    try {
      const profile = await fetchMyAiProfile(input.client);
      if (disposed) {
        return;
      }
      myMode = profile.default_mode;
    } catch {
      if (disposed) {
        return;
      }
      myMode = undefined;
    }
    renderComposerChrome();
    renderModeHint();
  }

  function closeModePopover(): void {
    if (!modePopoverOpen) {
      return;
    }
    modePopoverOpen = false;
    renderComposerChrome();
  }

  function toggleModePopover(): void {
    if (!isCollabConversation) {
      return;
    }
    modePopoverOpen = !modePopoverOpen;
    renderComposerChrome();
  }

  // 乐观更新 + 失败回滚：chip/弹层立刻切到 nextMode，PATCH 在背后跑；失败就把 myMode 换回去、弹一句
  // 温和的行内提示（renderModeHint 里的 modeErrorText 分支），不是阻断式对话框（同 turn.ts 的
  // "不弹阻断"取舍）。选中当前已经生效的档位也会关掉弹层，但不会发一次没意义的 PATCH。
  function selectMode(nextMode: number): void {
    if (!isCollabConversation) {
      return;
    }
    modePopoverOpen = false;
    modeErrorText = undefined;
    if (nextMode === myMode) {
      renderComposerChrome();
      renderModeHint();
      return;
    }
    const previousMode = myMode;
    myMode = nextMode;
    renderComposerChrome();
    renderModeHint();
    patchMyAiMode(input.client, nextMode)
      .then((profile) => {
        if (disposed) {
          return;
        }
        myMode = profile.default_mode;
        renderComposerChrome();
        renderModeHint();
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        myMode = previousMode;
        modeErrorText = modePatchFailedText(input.locale);
        renderComposerChrome();
        renderModeHint();
      });
  }

  function enqueueSend(kind: "text" | "file_card", payload: { text?: string; driveItemId?: string; fileName?: string }): void {
    pendingCounter += 1;
    const record: PendingSendRecord = {
      tempId: `pending-${input.conversationId}-${pendingCounter}`,
      kind,
      status: "sending",
      ...(payload.text !== undefined ? { text: payload.text } : {}),
      ...(payload.driveItemId !== undefined ? { driveItemId: payload.driveItemId } : {}),
      ...(payload.fileName !== undefined ? { fileName: payload.fileName } : {})
    };
    pending = [...pending, record];
    renderScroll();
    issueSend(record);
  }

  function retryPending(tempId: string | undefined): void {
    if (!tempId) {
      return;
    }
    const record = pending.find((entry) => entry.tempId === tempId);
    if (!record) {
      return;
    }
    record.status = "sending";
    renderScroll();
    issueSend(record);
  }

  function handleSend(): void {
    const ta = textareaEl();
    const text = (ta?.value ?? draftFallback).trim();
    const toAttach = attachments;
    if (!text && toAttach.length === 0) {
      return;
    }
    if (ta) {
      ta.value = "";
    }
    draftFallback = "";
    attachments = [];
    activeTrigger = undefined;
    renderComposerChrome();
    for (const attachment of toAttach) {
      enqueueSend("file_card", { driveItemId: attachment.driveItemId, fileName: attachment.name });
    }
    if (text) {
      enqueueSend("text", { text });
    }
  }

  renderComposerChrome();

  composerWrapEl.addEventListener("input", (event) => {
    if (!(event.target instanceof HTMLTextAreaElement) || !event.target.matches("[data-wb-chat-input]")) {
      return;
    }
    const ta = event.target;
    draftFallback = ta.value;
    maybePingTyping();
    const cursor = ta.selectionStart ?? ta.value.length;
    applyTriggerState(ta.value, cursor);
    syncSendButtonDisabled();
  });

  composerWrapEl.addEventListener("keydown", (event) => {
    if (!(event.target instanceof HTMLTextAreaElement) || !event.target.matches("[data-wb-chat-input]")) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  });

  composerWrapEl.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const target = event.target;
    if (target.closest("[data-wb-chat-send]")) {
      handleSend();
      return;
    }
    if (target.closest('[data-wb-chat-tool-trigger="@"]')) {
      insertMentionShortcut();
      return;
    }
    if (target.closest("[data-wb-chat-mode-toggle]")) {
      toggleModePopover();
      return;
    }
    const modeOption = target.closest<HTMLElement>("[data-wb-chat-mode-option]");
    if (modeOption?.dataset.wbChatModeOption) {
      const level = Number(modeOption.dataset.wbChatModeOption);
      if (Number.isInteger(level) && level >= 1 && level <= 5) {
        selectMode(level);
      }
      return;
    }
    const removeBtn = target.closest<HTMLElement>("[data-wb-chat-remove-attachment]");
    if (removeBtn?.dataset.wbChatRemoveAttachment) {
      attachments = removeAttachment(attachments, removeBtn.dataset.wbChatRemoveAttachment);
      renderComposerChrome();
      return;
    }
    const memberRow = target.closest<HTMLElement>("[data-wb-chat-pick-member]");
    if (memberRow) {
      pickMember(memberRow.dataset.wbChatPickMember);
      return;
    }
    const fileRow = target.closest<HTMLElement>("[data-wb-chat-pick-file]");
    if (fileRow) {
      pickFile(fileRow.dataset.wbChatPickFile);
    }
  });

  scrollEl.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const target = event.target;
    if (target.closest("[data-wb-chat-retry-history]")) {
      void loadHistory();
      return;
    }
    if (target.closest("[data-wb-chat-load-earlier]")) {
      handleReachedTop();
      return;
    }
    const expandBtn = target.closest<HTMLElement>("[data-wb-chat-expand-message]");
    if (expandBtn?.dataset.wbChatExpandMessage) {
      expandedMessageIds = new Set(expandedMessageIds).add(expandBtn.dataset.wbChatExpandMessage);
      renderScroll();
      return;
    }
    const collapseBtn = target.closest<HTMLElement>("[data-wb-chat-collapse-message]");
    if (collapseBtn?.dataset.wbChatCollapseMessage) {
      const next = new Set(expandedMessageIds);
      next.delete(collapseBtn.dataset.wbChatCollapseMessage);
      expandedMessageIds = next;
      renderScroll();
      return;
    }
    const retryBtn = target.closest<HTMLElement>("[data-wb-chat-retry-pending]");
    if (retryBtn) {
      retryPending(retryBtn.dataset.wbChatRetryPending);
      return;
    }
    const fileCardBtn = target.closest<HTMLElement>("[data-wb-chat-open-file]");
    if (fileCardBtn?.dataset.wbChatOpenFile) {
      input.onOpenDriveFile?.({
        itemId: fileCardBtn.dataset.wbChatOpenFile,
        itemName: fileCardBtn.dataset.wbChatOpenFileName ?? ""
      });
    }
  });

  // R12 批8：滚到顶自动触发「加载更早」（00 §9 交互约定），和上面的手动按钮走同一个 handleReachedTop——
  // 按钮是为了可发现性/无障碍（不是每个人都知道滚动到顶有效），滚动是为了老用户的肌肉记忆（同类聊天
  // 应用的既有习惯）。
  scrollEl.addEventListener("scroll", () => {
    if (scrollEl!.scrollTop <= SCROLL_TOP_LOAD_EARLIER_PX) {
      handleReachedTop();
    }
  });

  // R12（模式五档）：点外关闭 + Escape 关闭 + 弹层开着时数字键 1-5 快切——都是弹层开着才生效
  // （modePopoverOpen 把关），不会抢主区/其它会话种类里任何一次点击或按键。这两个监听器挂在
  // ownerDocument 上而不是 composerWrapEl 上，因为"点外"本来就要能听到 composer 之外的点击。
  function handleDocumentModeClick(event: MouseEvent): void {
    if (!modePopoverOpen || !(event.target instanceof Node)) {
      return;
    }
    const chip = composerWrapEl!.querySelector("[data-wb-chat-mode-toggle]");
    const pop = composerWrapEl!.querySelector("[data-wb-chat-mode-pop]");
    if (chip?.contains(event.target) || pop?.contains(event.target)) {
      return; // 这条点击本身就是触发弹层开合的那次点击，composerWrapEl 自己的监听器已经处理过。
    }
    closeModePopover();
  }

  function handleDocumentModeKeydown(event: KeyboardEvent): void {
    if (!modePopoverOpen) {
      return;
    }
    if (event.key === "Escape") {
      closeModePopover();
      return;
    }
    if (event.key >= "1" && event.key <= "5") {
      event.preventDefault();
      selectMode(Number(event.key));
    }
  }

  doc.addEventListener("click", handleDocumentModeClick);
  doc.addEventListener("keydown", handleDocumentModeKeydown);

  void loadHistory();
  void loadMyAiProfile();

  return {
    dispose() {
      disposed = true;
      streamHandle?.close();
      clearInterval(typingPruneTimer);
      doc.removeEventListener("click", handleDocumentModeClick);
      doc.removeEventListener("keydown", handleDocumentModeKeydown);
      if (fileSearchTimer !== undefined) {
        clearTimeout(fileSearchTimer);
      }
    },
    focusComposer() {
      textareaEl()?.focus();
    }
  };
}
