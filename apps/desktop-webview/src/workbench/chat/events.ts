// WorkHub 桌面 · 解析从 SSE 流收到的会话事件——纯函数，真正用契约的 zod schema 校验（不是 ad hoc
// 摸字段），未过校验/会话 id 不匹配的一律返回 undefined，调用方（view.ts）静默丢弃，不崩渲染。
// 这也是「不写伪测试」的具体体现之一：这里的单测跑的是真实 zod 校验路径，不是 mock 掉校验只测传参。

import {
  conversationActionCardUpdatedEventSchema,
  conversationCuuUpdatedEventSchema,
  conversationParticipantsUpdatedEventSchema,
  conversationMessageCreatedEventSchema,
  conversationMessageDeltaEventSchema,
  conversationMessageUpdatedEventSchema,
  conversationObserverAnalyzingEventSchema,
  conversationPresenceTypingEventSchema,
  conversationReactionUpdatedEventSchema,
  conversationReadUpdatedEventSchema,
  type ConversationActionCardUpdatedEvent,
  type ConversationMessageReactionVM,
  type ConversationMessageVM
} from "@workhub/contracts";

export function parseIncomingMessageCreated(raw: unknown, conversationId: string): ConversationMessageVM | undefined {
  const parsed = conversationMessageCreatedEventSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  if (parsed.data.data.conversation_id !== conversationId) {
    return undefined;
  }
  return parsed.data.data;
}

// R12（final-turns-wiring）：conversation.message.delta——协同会话 turn 的流式打字增量（见
// packages/contracts/src/events.ts 的 conversationMessageDeltaEventSchema 顶部注释：无 seq、不落库、
// 不参与 reconcile，纯瞬态）。同 parseIncomingMessageCreated/parseIncomingTyping 一样，未过 zod 校验
// 或会话 id 不匹配一律 undefined，调用方静默丢弃，不崩渲染。
export type IncomingMessageDelta = {
  turnId: string;
  deltaText: string;
  ordinal: number;
};

export function parseIncomingMessageDelta(raw: unknown, conversationId: string): IncomingMessageDelta | undefined {
  const parsed = conversationMessageDeltaEventSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  if (parsed.data.data.conversation_id !== conversationId) {
    return undefined;
  }
  return {
    turnId: parsed.data.data.turn_id,
    deltaText: parsed.data.data.delta_text,
    ordinal: parsed.data.data.ordinal
  };
}

export type IncomingTypingSignal = {
  userId: string;
  expiresAtMs: number;
};

// currentUserId 传入时会过滤掉"自己正在输入"的回声——服务端并不区分发送者/接收者广播同一个
// 会话主题，是否展示给自己是纯前端展示层的决定。
export function parseIncomingTyping(
  raw: unknown,
  conversationId: string,
  currentUserId: string | undefined
): IncomingTypingSignal | undefined {
  const parsed = conversationPresenceTypingEventSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  if (parsed.data.data.conversation_id !== conversationId) {
    return undefined;
  }
  if (currentUserId !== undefined && parsed.data.data.user_id === currentUserId) {
    return undefined;
  }
  const expiresAtMs = Date.parse(parsed.data.data.expires_at);
  if (!Number.isFinite(expiresAtMs)) {
    return undefined;
  }
  return { userId: parsed.data.data.user_id, expiresAtMs };
}

// R12 行动卡条目状态回流（00 §9：撤销后卡上该项置灰划线，不删卡）。事件 payload 只带条目摘要
// （id/kind/confidence/status），没有 title_md——契约注释写明它是「该刷新了」的信号，完整卡片以
// GET 为准；view.ts 拿这个信号就地改本地快照的 status，快照里没有的条目再按需补拉消息。
export type IncomingActionCardUpdate = {
  messageId: string;
  actionCardId: string;
  items: ConversationActionCardUpdatedEvent["data"]["items"];
};

export function parseIncomingActionCardUpdated(
  raw: unknown,
  conversationId: string
): IncomingActionCardUpdate | undefined {
  const parsed = conversationActionCardUpdatedEventSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  if (parsed.data.data.conversation_id !== conversationId) {
    return undefined;
  }
  return {
    messageId: parsed.data.data.message_id,
    actionCardId: parsed.data.data.action_card_id,
    items: parsed.data.data.items
  };
}

// R14 批 CHAT：conversation.message.updated——编辑/删除/置顶/取消置顶后发布，data=变更后全量消息 VM。
// 同 parseIncomingMessageCreated：未过 zod 校验/会话 id 不匹配一律 undefined，调用方按 id 整条替换本地
// 快照（本地无此 id → 视 snapshotStale 定点补拉，见 view.ts）。
export function parseIncomingMessageUpdated(raw: unknown, conversationId: string): ConversationMessageVM | undefined {
  const parsed = conversationMessageUpdatedEventSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  if (parsed.data.data.conversation_id !== conversationId) {
    return undefined;
  }
  return parsed.data.data;
}

// R14 批 CHAT：conversation.reaction.updated——某条消息的全量 reaction 聚合（幂等替换，不发增量）。
export type IncomingReactionUpdate = {
  messageId: string;
  reactions: ConversationMessageReactionVM[];
};

export function parseIncomingReactionUpdated(raw: unknown, conversationId: string): IncomingReactionUpdate | undefined {
  const parsed = conversationReactionUpdatedEventSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  if (parsed.data.data.conversation_id !== conversationId) {
    return undefined;
  }
  return {
    messageId: parsed.data.data.message_id,
    reactions: [...parsed.data.data.reactions]
  };
}

// R14 批 CHAT：conversation.read.updated——某人已读游标推进（聚合式「已读 N/M」+ 未读分割线增量）。
export type IncomingReadUpdate = {
  userId: string;
  lastReadSeq: number;
};

export function parseIncomingReadUpdated(raw: unknown, conversationId: string): IncomingReadUpdate | undefined {
  const parsed = conversationReadUpdatedEventSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  if (parsed.data.data.conversation_id !== conversationId) {
    return undefined;
  }
  return {
    userId: parsed.data.data.user_id,
    lastReadSeq: parsed.data.data.last_read_seq
  };
}

// R15 批 cuu-toggle：conversation.cuu.updated——会话级 Cuu 参与开关翻转后广播，data 只带翻转后的布尔值。
// 同 parseIncomingReadUpdated：未过 zod 校验/会话 id 不匹配一律 undefined，调用方本地更新头部开关状态 +
// 重算 isCollabConversation（composer 模式 chip/流式气泡随之显隐），接不上就等下次挂载时用会话 VM 里的
// cuu_enabled 兜底。
export function parseIncomingConversationCuuUpdated(raw: unknown, conversationId: string): boolean | undefined {
  const parsed = conversationCuuUpdatedEventSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  if (parsed.data.data.conversation_id !== conversationId) {
    return undefined;
  }
  return parsed.data.data.cuu_enabled;
}

// R17 批 G1（群成员管理）：conversation.participants.updated——参与者集合变化（加人/退群/移出）后广播。
// data 只带 change + 受影响 user_id（不带全量参与者列表），调用方（view.ts）据此按需重拉 GET /participants
// （同 parseIncomingConversationCuuUpdated 只带布尔值、不带全量会话 VM 的既有取舍：接不上就等下次重挂兜底）。
// 未过 zod 校验/会话 id 不匹配一律 undefined，静默丢弃。
export type IncomingParticipantsUpdate = { change: "added" | "removed"; userId: string };

export function parseIncomingConversationParticipantsUpdated(
  raw: unknown,
  conversationId: string
): IncomingParticipantsUpdate | undefined {
  const parsed = conversationParticipantsUpdatedEventSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  if (parsed.data.data.conversation_id !== conversationId) {
    return undefined;
  }
  return { change: parsed.data.data.change, userId: parsed.data.data.user_id };
}

// R14 批 CHAT：conversation.observer.analyzing——瞬态（照 typing 模式，ttl 30s），观察者开始整理讨论时
// 发布。同 parseIncomingTyping：只回过期时刻毫秒，调用方在指示灯行区域渲「Cuu 正在整理刚才的讨论…」，
// TTL 过期或收到行动卡事件即消。
export type IncomingObserverAnalyzing = {
  expiresAtMs: number;
};

export function parseIncomingObserverAnalyzing(raw: unknown, conversationId: string): IncomingObserverAnalyzing | undefined {
  const parsed = conversationObserverAnalyzingEventSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  if (parsed.data.data.conversation_id !== conversationId) {
    return undefined;
  }
  const expiresAtMs = Date.parse(parsed.data.data.expires_at);
  if (!Number.isFinite(expiresAtMs)) {
    return undefined;
  }
  return { expiresAtMs };
}
