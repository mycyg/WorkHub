// WorkHub 桌面 · 主区群聊的纯 HTML 渲染函数（照 shell.ts/rail.ts 的 render*/mount* 分工：这里全部是
// 无副作用的字符串拼装，可单测；imperative 的 DOM 挂载/事件绑定在 view.ts）。

import type { ConversationMessageVM, WorkbenchPageVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { workbenchIcons } from "../icons.js";
import { formatMessageTime } from "./timeline.js";

type Locale = "zh-CN" | "en-US";
export type WorkbenchMemberVM = WorkbenchPageVM["workspace_members"]["items"][number];
export type ChatRenderMembers = ReadonlyMap<string, { nickname: string }>;
export type ConnectionBannerState = "connecting" | "open" | "reconnect_scheduled" | "closed" | "idle";

export function membersById(members: readonly WorkbenchMemberVM[]): ChatRenderMembers {
  return new Map(members.map((member) => [member.user_id, { nickname: member.nickname }]));
}

function hueForId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function avatarTileHtml(input: { label: string; id: string; variant?: "cuu" | undefined }): string {
  if (input.variant === "cuu") {
    return `<span class="wh-wb-chat-avatar wh-wb-chat-avatar--cuu">${workbenchIcons.cat}</span>`;
  }
  const trimmed = input.label.trim();
  const initial = trimmed ? trimmed[0]!.toUpperCase() : "?";
  const hue = hueForId(input.id);
  return `<span class="wh-wb-chat-avatar" style="background:hsl(${hue},55%,42%)">${escapeHtml(initial)}</span>`;
}

// —— 成员条 —— //

export function renderMemberBarHtml(input: { members: readonly WorkbenchMemberVM[]; locale: Locale }): string {
  const zh = input.locale === "zh-CN";
  const avatars = input.members
    .slice(0, 6)
    .map((member) => avatarTileHtml({ label: member.nickname, id: member.user_id }))
    .join("");
  const cuuAvatar = avatarTileHtml({ label: "Cuu", id: "cuu", variant: "cuu" });
  const count = input.members.length;
  const label = zh ? `${count} 位成员 + Cuu · 全员群聊` : `${count} member${count === 1 ? "" : "s"} + Cuu · everyone`;
  return `<div class="wh-wb-chat-head"><div class="wh-wb-chat-avs">${avatars}${cuuAvatar}</div><span class="wh-wb-chat-head-label">${escapeHtml(label)}</span></div>`;
}

// —— 日期分隔 —— //

export function renderDaySeparatorHtml(label: string): string {
  return `<div class="wh-wb-chat-daysep">${escapeHtml(label)}</div>`;
}

// —— 消息气泡 —— //

export type ChatRenderContext = {
  locale: Locale;
  members: ChatRenderMembers;
  currentUserId: string | undefined;
};

function senderLabel(message: ConversationMessageVM, ctx: ChatRenderContext): string {
  if (message.sender_type === "cuu") {
    return "Cuu";
  }
  if (message.sender_type === "system") {
    return ctx.locale === "zh-CN" ? "系统" : "System";
  }
  const member = message.sender_user_id ? ctx.members.get(message.sender_user_id) : undefined;
  return member?.nickname ?? (ctx.locale === "zh-CN" ? "未知成员" : "Unknown member");
}

// @成员昵称 高亮——纯展示层面的便利（不是结构化引用，wisp 安全红线只管"chip 只存 id 不存内容"这条
// 真正的引用通道；这里只是把已经发出去的纯文本里，恰好等于真实成员昵称的 @xxx 子串标个颜色）。
function highlightMentions(escapedText: string, members: ChatRenderMembers): string {
  let result = escapedText;
  for (const { nickname } of members.values()) {
    const escapedName = escapeHtml(nickname);
    if (!escapedName.trim()) {
      continue;
    }
    const pattern = new RegExp(`@${escapeRegExp(escapedName)}(?=\\s|$)`, "gu");
    result = result.replace(pattern, (match) => `<span class="wh-wb-chat-mention">${match}</span>`);
  }
  return result;
}

function bestEffortNoteText(content: Record<string, unknown>, fallback: string): string {
  const summary = content["summary"];
  if (typeof summary === "string" && summary.trim()) {
    return summary;
  }
  const text = content["text"];
  if (typeof text === "string" && text.trim()) {
    return text;
  }
  return fallback;
}

function renderActionCardSummaryHtml(content: Record<string, unknown>, locale: Locale): string {
  const zh = locale === "zh-CN";
  const rawItems = Array.isArray(content["items"]) ? (content["items"] as unknown[]) : [];
  const titles = rawItems
    .slice(0, 8)
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const titleMd = (item as Record<string, unknown>)["title_md"];
      return typeof titleMd === "string" ? titleMd : undefined;
    })
    .filter((title): title is string => Boolean(title));
  const header = zh
    ? `Cuu 从讨论里拎出 ${rawItems.length} 件事`
    : `Cuu pulled ${rawItems.length} item${rawItems.length === 1 ? "" : "s"} out of the discussion`;
  const list = titles.map((title) => `<li>${escapeHtml(title)}</li>`).join("");
  const note = zh
    ? "完整的行动卡交互（撤销/指派）由后续批次接入这个窗口。"
    : "The full action-card UI (undo / assign) lands in a later batch.";
  return `<div class="wh-wb-chat-actioncard"><div class="wh-wb-chat-actioncard-h">${escapeHtml(header)}</div>${
    list ? `<ul class="wh-wb-chat-actioncard-list">${list}</ul>` : ""
  }<div class="wh-wb-chat-actioncard-note">${escapeHtml(note)}</div></div>`;
}

function messageBodyHtml(message: ConversationMessageVM, ctx: ChatRenderContext): string {
  switch (message.kind) {
    case "text":
      return `<div class="wh-wb-chat-txt">${highlightMentions(escapeHtml(message.content.text), ctx.members).replace(/\n/gu, "<br>")}</div>`;
    case "file_card":
      return `<div class="wh-wb-chat-filecard">${workbenchIcons.folder}<span class="wh-wb-chat-filecard-name">${escapeHtml(message.content.snapshot_name)}</span></div>`;
    case "action_card":
      return renderActionCardSummaryHtml(message.content, ctx.locale);
    case "tool_note":
      return `<div class="wh-wb-chat-note">${escapeHtml(bestEffortNoteText(message.content, ctx.locale === "zh-CN" ? "（一次工具调用）" : "(a tool call)"))}</div>`;
    case "system_event":
      // system_event 走 renderSystemEventLineHtml 的独立折叠行布局，renderMessageHtml 在调用
      // messageBodyHtml 之前已经把它分流出去了，这个分支运行时不可达——留着只是为了穷举 switch。
      return "";
    default:
      // 契约新增 kind 时的安全网：不崩，渲染空内容而不是让整条消息流炸掉。
      return "";
  }
}

function renderSystemEventLineHtml(
  message: Extract<ConversationMessageVM, { kind: "system_event" }>,
  ctx: ChatRenderContext
): string {
  const fallback = ctx.locale === "zh-CN" ? "系统事件" : "System update";
  const text = bestEffortNoteText(message.content, fallback);
  return `<div class="wh-wb-chat-sysline"><span>${escapeHtml(text)}</span><span class="wh-wb-chat-sysline-tm">${formatMessageTime(message.created_at, ctx.locale)}</span></div>`;
}

export function renderMessageHtml(message: ConversationMessageVM, ctx: ChatRenderContext): string {
  if (message.kind === "system_event") {
    return renderSystemEventLineHtml(message, ctx);
  }
  const isCuu = message.sender_type === "cuu";
  const isSelf = ctx.currentUserId !== undefined && message.sender_user_id === ctx.currentUserId;
  const avatar = isCuu
    ? avatarTileHtml({ label: "Cuu", id: "cuu", variant: "cuu" })
    : avatarTileHtml({ label: senderLabel(message, ctx), id: message.sender_user_id ?? message.id });
  const rowClass = ["wh-wb-chat-msg", isCuu ? "wh-wb-chat-msg--cuu" : "", isSelf ? "wh-wb-chat-msg--self" : ""]
    .filter(Boolean)
    .join(" ");
  return `<div class="${rowClass}">${avatar}<div class="wh-wb-chat-bub"><div class="wh-wb-chat-who">${escapeHtml(senderLabel(message, ctx))}<span class="wh-wb-chat-tm">${formatMessageTime(message.created_at, ctx.locale)}</span></div>${messageBodyHtml(message, ctx)}</div></div>`;
}

// —— 发送中乐观渲染（以服务端 message.created 回执为准去重，见 view.ts）—— //

export type PendingOutgoingMessage = {
  tempId: string;
  text?: string;
  fileName?: string;
  status: "sending" | "error";
};

export function renderPendingOutgoingHtml(pending: PendingOutgoingMessage, ctx: ChatRenderContext): string {
  const zh = ctx.locale === "zh-CN";
  const avatar = ctx.currentUserId
    ? avatarTileHtml({ label: ctx.members.get(ctx.currentUserId)?.nickname ?? "?", id: ctx.currentUserId })
    : avatarTileHtml({ label: "?", id: "self" });
  const body = pending.fileName
    ? `<div class="wh-wb-chat-filecard">${workbenchIcons.folder}<span class="wh-wb-chat-filecard-name">${escapeHtml(pending.fileName)}</span></div>`
    : `<div class="wh-wb-chat-txt">${escapeHtml(pending.text ?? "").replace(/\n/gu, "<br>")}</div>`;
  const status =
    pending.status === "sending"
      ? `<span class="wh-wb-chat-pending-status">${zh ? "发送中…" : "Sending…"}</span>`
      : `<span class="wh-wb-chat-pending-status wh-wb-chat-pending-status--error">${zh ? "没发出去" : "Couldn't send"} <button type="button" class="wh-wb-chat-pending-retry" data-wb-chat-retry-pending="${escapeHtml(pending.tempId)}">${zh ? "重试" : "Retry"}</button></span>`;
  return `<div class="wh-wb-chat-msg wh-wb-chat-msg--self wh-wb-chat-msg--pending" data-wb-chat-pending-id="${escapeHtml(pending.tempId)}">${avatar}<div class="wh-wb-chat-bub">${body}${status}</div></div>`;
}

// —— 正在输入 —— //

export function renderTypingIndicatorHtml(labels: readonly string[], locale: Locale): string {
  if (labels.length === 0) {
    return "";
  }
  const zh = locale === "zh-CN";
  const names = labels.join(zh ? "、" : ", ");
  const text = zh
    ? `${names} 正在输入`
    : labels.length === 1
      ? `${names} is typing`
      : `${names} are typing`;
  return `<div class="wh-wb-chat-typing">${escapeHtml(text)}<span class="wh-wb-chat-typing-dots"><i></i><i></i><i></i></span></div>`;
}

// —— 连接状态横幅（00 §9：SSE 断线→顶部细横幅「连接中断，正在重连」） —— //

export function renderConnectionBannerHtml(state: ConnectionBannerState, locale: Locale): string {
  const zh = locale === "zh-CN";
  if (state === "reconnect_scheduled") {
    return `<div class="wh-wb-chat-banner">${zh ? "连接中断，正在重连…" : "Connection lost — reconnecting…"}</div>`;
  }
  if (state === "connecting") {
    return `<div class="wh-wb-chat-banner">${zh ? "正在连接…" : "Connecting…"}</div>`;
  }
  return "";
}

// —— 空态（照 00 §9：新项目空群聊 → Cuu 开场白，引导第一条消息） —— //

export function renderChatEmptyStateHtml(input: { locale: Locale; projectName: string }): string {
  const zh = input.locale === "zh-CN";
  const title = zh ? `欢迎来到「${input.projectName}」` : `Welcome to "${input.projectName}"`;
  const body = zh
    ? "这里是项目的主区——进展、决定、文件都在这聊。丢个文件或说句话，我是 Cuu，会盯着帮你们拎重点。"
    : "This is the project's main chat — progress, decisions, and files all live here. Drop a file or say something to get started. I'm Cuu, and I'll keep an eye on things for you.";
  return `<div class="wh-wb-chat-empty ds-anim-fade-in"><span class="wh-wb-chat-empty-icon">${workbenchIcons.cat}</span><h3 class="wh-wb-chat-empty-title">${escapeHtml(title)}</h3><p class="wh-wb-chat-empty-body">${escapeHtml(body)}</p></div>`;
}

export function renderHistoryLoadErrorHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-chat-error">${zh ? "没加载出聊天记录，稍后重试" : "Couldn't load the chat history — retry"}<div style="margin-top:13px"><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-chat-retry-history>${zh ? "重试" : "Retry"}</button></div></div>`;
}

export function renderHistoryLoadingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-wb-loading wh-wb-loading"><span class="wh-wb-spinner"></span>${zh ? "正在加载聊天记录…" : "Loading chat history…"}</div>`;
}

// 反向翻页需要 beforeSeq（批 0 只给了正向 afterSeq）——批 2 诚实降级为「首屏一次性正向拉到当前」，
// 命中防御性上限时提示用户，而不是假装"往上翻页"能补出更早的历史。
export function renderHistoryTruncatedNoticeHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-chat-truncated">${
    zh
      ? "这个会话历史很长，只加载了最早的一部分——完整的向上翻页要等后续批次支持。"
      : "This conversation's history is long — only an early slice loaded. Full backward paging needs a later batch."
  }</div>`;
}

// —— composer —— //

export type ComposerAttachmentChip = { driveItemId: string; name: string };

export function renderComposerHtml(input: {
  locale: Locale;
  draftText: string;
  attachments: readonly ComposerAttachmentChip[];
  sending: boolean;
  sendError?: string | undefined;
}): string {
  const zh = input.locale === "zh-CN";
  const attachmentsHtml = input.attachments.length
    ? `<div class="wh-wb-chat-attachments">${input.attachments
        .map(
          (attachment) =>
            `<span class="wh-wb-chat-attachment-chip">${workbenchIcons.folder}<span>${escapeHtml(attachment.name)}</span><button type="button" data-wb-chat-remove-attachment="${escapeHtml(attachment.driveItemId)}" aria-label="${zh ? "移除" : "Remove"}">${workbenchIcons.close}</button></span>`
        )
        .join("")}</div>`
    : "";
  const errorHtml = input.sendError
    ? `<div class="wh-wb-chat-send-error">${escapeHtml(input.sendError)}<button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-chat-retry-send>${zh ? "重试" : "Retry"}</button></div>`
    : "";
  const canSend = !input.sending && (input.draftText.trim().length > 0 || input.attachments.length > 0);
  const placeholder = zh
    ? "发消息给项目组和 Cuu…(@ 引用网盘文件/成员 · # 会话 · / 技能)"
    : "Message the team and Cuu… (@ file/member · # conversation · / skill)";
  // data-wb-chat-picker-slot：@/#// picker 的挂载点，特意留空——view.ts 单独更新这一个子节点的
  // innerHTML（每次按键都可能要开关/刷新 picker），绝不重建整个 composer（那会打断 textarea 的
  // 焦点/光标位置，rail.ts 的「新建项目」输入框已经踩过这个坑，见其 input 事件里的注释）。
  return `<div class="wh-wb-chat-composer">${errorHtml}${attachmentsHtml}<div class="wh-wb-chat-cbox"><textarea class="wh-wb-chat-input" rows="1" placeholder="${escapeHtml(placeholder)}" data-wb-chat-input${input.sending ? " disabled" : ""}>${escapeHtml(input.draftText)}</textarea><div class="wh-wb-chat-ctools"><button type="button" class="wh-wb-chat-ctag" data-wb-chat-tool-trigger="@"><b>@</b> ${zh ? "文件·成员" : "file · member"}</button><span class="wh-wb-chat-ctag wh-wb-chat-ctag--soon" title="${zh ? "即将可用 · 批 4 起接入" : "Coming soon · lands in batch 4"}"><b>#</b> ${zh ? "会话" : "conversation"}</span><span class="wh-wb-chat-ctag wh-wb-chat-ctag--soon" title="${zh ? "即将可用 · 批 4 起接入" : "Coming soon · lands in batch 4"}"><b>/</b> ${zh ? "技能" : "skill"}</span><button type="button" class="wh-wb-chat-send" data-wb-chat-send${canSend ? "" : " disabled"} aria-label="${zh ? "发送" : "Send"}">${workbenchIcons.send}</button></div><div data-wb-chat-picker-slot></div></div></div>`;
}

// —— @ picker（真实：成员本地过滤 + 网盘文件复用既有搜索端点） —— //

export type MentionPickerMember = { userId: string; nickname: string };
export type MentionPickerFile = { itemId: string; name: string };

export function renderMentionPickerHtml(input: {
  locale: Locale;
  members: readonly MentionPickerMember[];
  files: readonly MentionPickerFile[];
  filesLoading: boolean;
}): string {
  const zh = input.locale === "zh-CN";
  const memberRows = input.members
    .slice(0, 8)
    .map(
      (member) =>
        `<button type="button" class="wh-wb-chat-picker-row" data-wb-chat-pick-member="${escapeHtml(member.userId)}">${avatarTileHtml({ label: member.nickname, id: member.userId })}<span>${escapeHtml(member.nickname)}</span></button>`
    )
    .join("");
  const fileRows = input.files
    .slice(0, 8)
    .map(
      (file) =>
        `<button type="button" class="wh-wb-chat-picker-row" data-wb-chat-pick-file="${escapeHtml(file.itemId)}">${workbenchIcons.folder}<span>${escapeHtml(file.name)}</span></button>`
    )
    .join("");
  const memberSection = memberRows
    ? `<div class="wh-wb-chat-picker-section-title">${zh ? "成员" : "Members"}</div>${memberRows}`
    : "";
  const fileSection = input.filesLoading
    ? `<div class="wh-wb-chat-picker-section-title">${zh ? "网盘文件" : "Drive files"}</div><div class="wh-wb-chat-picker-loading">${zh ? "搜索中…" : "Searching…"}</div>`
    : fileRows
      ? `<div class="wh-wb-chat-picker-section-title">${zh ? "网盘文件" : "Drive files"}</div>${fileRows}`
      : "";
  const empty = !memberSection && !fileSection ? `<div class="wh-wb-chat-picker-empty">${zh ? "没有匹配结果" : "No matches"}</div>` : "";
  return `<div class="wh-wb-chat-picker" data-wb-chat-picker="mention">${memberSection}${fileSection}${empty}</div>`;
}

// —— # / picker：本批只做外壳，「即将可用」灰态，不发真实搜索请求（见批 2 汇报的范围说明）。 —— //

export function renderComingSoonPickerHtml(input: { locale: Locale; trigger: "#" | "/" }): string {
  const zh = input.locale === "zh-CN";
  const title = input.trigger === "#" ? (zh ? "会话引用" : "Conversation reference") : zh ? "技能唤起" : "Skill invocation";
  const note = zh ? "即将可用 · 批 4 起接入" : "Coming soon · lands in batch 4";
  return `<div class="wh-wb-chat-picker wh-wb-chat-picker--soon" data-wb-chat-picker="soon"><div class="wh-wb-chat-picker-title">${escapeHtml(title)}</div><div class="wh-wb-chat-picker-soon-note">${escapeHtml(note)}</div></div>`;
}
