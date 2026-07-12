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

import type { ConversationMessageVM } from "@workhub/contracts";

import {
  fetchAllConversationMessagesFromStart,
  fetchConversationMessagesPage,
  pingConversationTyping,
  sendConversationFileCardMessage,
  sendConversationTextMessage,
  type ChatApiClient
} from "./api.js";
import { parseIncomingMessageCreated, parseIncomingTyping } from "./events.js";
import {
  membersById,
  renderChatEmptyStateHtml,
  renderComingSoonPickerHtml,
  renderComposerHtml,
  renderConnectionBannerHtml,
  renderDaySeparatorHtml,
  renderHistoryLoadErrorHtml,
  renderHistoryLoadingHtml,
  renderHistoryTruncatedNoticeHtml,
  renderMemberBarHtml,
  renderMentionPickerHtml,
  renderMessageHtml,
  renderPendingOutgoingHtml,
  renderTypingIndicatorHtml,
  type ChatRenderContext,
  type ComposerAttachmentChip,
  type ConnectionBannerState,
  type MentionPickerFile,
  type MentionPickerMember,
  type PendingOutgoingMessage,
  type WorkbenchMemberVM
} from "./render.js";
import { connectConversationStream, type ConversationStreamHandle } from "./stream.js";
import { applyComposerChipInsertion, detectComposerTrigger, type ComposerTriggerMatch } from "./trigger-parser.js";
import { groupMessagesByDay, sortAndDedupeMessages } from "./timeline.js";
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
  }
): ChatViewHandle {
  const doc = container.ownerDocument ?? document;
  let disposed = false;
  let messages: ConversationMessageVM[] = [];
  let pending: PendingSendRecord[] = [];
  let typing: TypingState = [];
  let connection: ConnectionBannerState = "idle";
  let historyLoad: "loading" | "ready" | "error" = "loading";
  let historyTruncated = false;
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
  const renderCtx = (): ChatRenderContext => ({ locale: input.locale, members: membersMap, currentUserId: input.currentUserId });

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
    if (messages.length === 0 && pending.length === 0) {
      el.innerHTML = renderChatEmptyStateHtml({ locale: input.locale, projectName: input.projectName });
      return;
    }
    const ctx = renderCtx();
    const groups = groupMessagesByDay(messages, { locale: input.locale });
    let html = historyTruncated ? renderHistoryTruncatedNoticeHtml(input.locale) : "";
    for (const group of groups) {
      html += renderDaySeparatorHtml(group.label);
      for (const message of group.messages) {
        html += renderMessageHtml(message, ctx);
      }
    }
    for (const record of pending) {
      html += renderPendingOutgoingHtml(toPendingRenderModel(record), ctx);
    }
    el.innerHTML = html;
    if (wasNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
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

  // —— 历史加载（批 0 只给正向 afterSeq，首屏一次性正向拉到当前，见 api.ts 顶部注释） —— //
  async function loadHistory(): Promise<void> {
    historyLoad = "loading";
    renderScroll();
    try {
      const result = await fetchAllConversationMessagesFromStart(input.client, input.conversationId);
      if (disposed) {
        return;
      }
      messages = sortAndDedupeMessages(result.messages);
      historyTruncated = result.truncated;
      historyLoad = "ready";
      renderScroll();
      connectStream();
    } catch {
      if (disposed) {
        return;
      }
      historyLoad = "error";
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

  function connectStream(): void {
    streamHandle = connectConversationStream({
      url: input.streamUrl,
      getClientToken: input.getClientToken,
      onEvent: (event) => {
        if (disposed) {
          return;
        }
        const message = parseIncomingMessageCreated(event.data, input.conversationId);
        if (message) {
          mergeMessages([message]);
          return;
        }
        const typingSignal = parseIncomingTyping(event.data, input.conversationId, input.currentUserId);
        if (typingSignal) {
          typing = upsertTypingUser(typing, typingSignal, Date.now());
          renderTyping();
        }
        // 其它事件名（"connected" 控制帧、批3/4 的 action_card/tool 事件）本批不处理，静默忽略。
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
    const retryBtn = target.closest<HTMLElement>("[data-wb-chat-retry-pending]");
    if (retryBtn) {
      retryPending(retryBtn.dataset.wbChatRetryPending);
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
