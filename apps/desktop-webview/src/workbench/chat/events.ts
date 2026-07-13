// WorkHub 桌面 · 解析从 SSE 流收到的会话事件——纯函数，真正用契约的 zod schema 校验（不是 ad hoc
// 摸字段），未过校验/会话 id 不匹配的一律返回 undefined，调用方（view.ts）静默丢弃，不崩渲染。
// 这也是「不写伪测试」的具体体现之一：这里的单测跑的是真实 zod 校验路径，不是 mock 掉校验只测传参。

import {
  conversationActionCardUpdatedEventSchema,
  conversationMessageCreatedEventSchema,
  conversationMessageDeltaEventSchema,
  conversationPresenceTypingEventSchema,
  type ConversationActionCardUpdatedEvent,
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
