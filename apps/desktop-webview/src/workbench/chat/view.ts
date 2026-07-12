// WorkHub 桌面 · 主区群聊视图——imperative 挂载/事件绑定层（照 shell.ts/rail.ts 的分工：纯渲染在
// render.ts，这里只负责拉数据、绑 DOM 事件、维护会话内的瞬态状态）。批 2 范围：文本+file_card 发送、
// @ 成员/文件 picker（真实）、# 会话与 / 技能 picker（外壳，「即将可用」灰态，见 render.ts 的
// renderComingSoonPickerHtml）、SSE 接线（断线指数退避重连+重连后 afterSeq 补缺口）、typing 节流。
// 本批不接 LLM——@Cuu 不会真的回应，只是把消息原样发出去（人话已经写进空态文案）。
//
// mountChatView 本身没有直接单测（和 mountWorkbenchShell/mountWorkbenchRail 同样的取舍——这个 workspace
// 的测试运行器没有真实 DOM，见 shell.test.ts/rail.test.ts 只测 render*/纯函数这一既有事实）；真正的逻辑
// 已经拆进 render.ts/api.ts/stream.ts/events.ts/timeline.ts/trigger-parser.ts/typing-state.ts 的纯函数里
// 逐一单测过，这里只是把它们接起来。

import { WorkHubApiError } from "@workhub/api-client";
import type { ConversationMessageVM } from "@workhub/contracts";

import {
  fetchConversationMessagesPage,
  fetchLatestConversationMessagesPage,
  fetchOlderConversationMessagesPage,
  pingConversationTyping,
  sendConversationFileCardMessage,
  sendConversationTextMessage,
  type ChatApiClient
} from "./api.js";
import { parseIncomingActionCardUpdated, parseIncomingMessageCreated, parseIncomingTyping } from "./events.js";
import {
  membersById,
  renderChatEmptyStateHtml,
  renderComingSoonPickerHtml,
  renderComposerHtml,
  renderConnectionBannerHtml,
  renderConversationAccessDeniedHtml,
  renderDaySeparatorHtml,
  renderHistoryLoadErrorHtml,
  renderHistoryLoadingHtml,
  renderLoadEarlierHtml,
  renderMemberBarHtml,
  renderMentionPickerHtml,
  renderMessageHtml,
  renderPendingOutgoingHtml,
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
    <div data-wb-chat-composer-wrap></div>
  </div>`;
  const bannerEl = container.querySelector<HTMLElement>("[data-wb-chat-banner]");
  const headEl = container.querySelector<HTMLElement>("[data-wb-chat-head]");
  const scrollEl = container.querySelector<HTMLElement>("[data-wb-chat-scroll]");
  const typingEl = container.querySelector<HTMLElement>("[data-wb-chat-typing]");
  const composerWrapEl = container.querySelector<HTMLElement>("[data-wb-chat-composer-wrap]");
  if (!bannerEl || !headEl || !scrollEl || !typingEl || !composerWrapEl) {
    throw new Error("workbench chat view markup is missing an expected mount point");
  }

  headEl.innerHTML = renderMemberBarHtml({ members: input.members, locale: input.locale });

  function textareaEl(): HTMLTextAreaElement | null {
    return composerWrapEl!.querySelector<HTMLTextAreaElement>("[data-wb-chat-input]");
  }
  function pickerSlotEl(): HTMLElement | null {
    return composerWrapEl!.querySelector<HTMLElement>("[data-wb-chat-picker-slot]");
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
      sending: false
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

  void loadHistory();

  return {
    dispose() {
      disposed = true;
      streamHandle?.close();
      clearInterval(typingPruneTimer);
      if (fileSearchTimer !== undefined) {
        clearTimeout(fileSearchTimer);
      }
    },
    focusComposer() {
      textareaEl()?.focus();
    }
  };
}
