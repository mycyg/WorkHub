import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseIncomingActionCardUpdated,
  parseIncomingMessageCreated,
  parseIncomingMessageDelta,
  parseIncomingTyping
} from "./events.js";

const conversationId = "40000000-0000-4000-8000-000000000001";
const userId = "40000000-0000-4000-8000-000000000002";
const projectId = "40000000-0000-4000-8000-000000000003";
const messageId = "40000000-0000-4000-8000-000000000004";
const eventId = "40000000-0000-4000-8000-000000000005";
const ts = "2026-07-12T09:00:00.000Z";

function validMessageCreatedEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: eventId,
    type: "conversation.message.created",
    topic: `conversation:${conversationId}`,
    ts,
    actor: { actor_kind: "human", actor_user_id: userId, label: "张三" },
    project_id: projectId,
    data: {
      id: messageId,
      conversation_id: conversationId,
      seq: 7,
      sender_type: "user",
      sender_user_id: userId,
      kind: "text",
      content: { text: "hello team" },
      thread_root_id: null,
      created_at: ts
    },
    ...overrides
  };
}

test("parseIncomingMessageCreated accepts a real, well-formed event and returns the message VM", () => {
  const result = parseIncomingMessageCreated(validMessageCreatedEvent(), conversationId);
  assert.ok(result);
  assert.equal(result!.id, messageId);
  assert.equal(result!.seq, 7);
  assert.equal(result!.kind, "text");
});

test("parseIncomingMessageCreated rejects garbage payloads instead of throwing", () => {
  assert.equal(parseIncomingMessageCreated({ nonsense: true }, conversationId), undefined);
  assert.equal(parseIncomingMessageCreated(null, conversationId), undefined);
  assert.equal(parseIncomingMessageCreated("a string", conversationId), undefined);
  assert.equal(parseIncomingMessageCreated(undefined, conversationId), undefined);
});

test("parseIncomingMessageCreated rejects an event for a different conversation (topic isolation, no cross-talk)", () => {
  const otherConversationId = "40000000-0000-4000-8000-000000000099";
  const result = parseIncomingMessageCreated(validMessageCreatedEvent(), otherConversationId);
  assert.equal(result, undefined);
});

test("parseIncomingMessageCreated rejects a payload that violates the contract's own invariants (sender mismatch)", () => {
  const tampered = validMessageCreatedEvent({
    data: {
      id: messageId,
      conversation_id: conversationId,
      seq: 7,
      sender_type: "user",
      // sender_user_id no longer matches actor.actor_user_id — the schema's superRefine forbids this.
      sender_user_id: "40000000-0000-4000-8000-000000000077",
      kind: "text",
      content: { text: "hello" },
      thread_root_id: null,
      created_at: ts
    }
  });
  assert.equal(parseIncomingMessageCreated(tampered, conversationId), undefined);
});

test("parseIncomingMessageCreated handles a file_card message", () => {
  const event = validMessageCreatedEvent({
    data: {
      id: messageId,
      conversation_id: conversationId,
      seq: 8,
      sender_type: "user",
      sender_user_id: userId,
      kind: "file_card",
      content: { drive_item_id: "40000000-0000-4000-8000-000000000006", snapshot_name: "report.xlsx" },
      thread_root_id: null,
      created_at: ts
    }
  });
  const result = parseIncomingMessageCreated(event, conversationId);
  assert.ok(result);
  assert.equal(result!.kind, "file_card");
});

function validTypingEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: eventId,
    type: "conversation.presence.typing",
    topic: `conversation:${conversationId}`,
    ts,
    actor: { actor_kind: "human", actor_user_id: userId, label: "张三" },
    data: {
      conversation_id: conversationId,
      user_id: userId,
      ttl_ms: 3000,
      expires_at: "2026-07-12T09:00:03.000Z"
    },
    ...overrides
  };
}

test("parseIncomingTyping accepts a real, well-formed event and returns userId + expiry", () => {
  const result = parseIncomingTyping(validTypingEvent(), conversationId, "someone-else");
  assert.deepEqual(result, { userId, expiresAtMs: Date.parse("2026-07-12T09:00:03.000Z") });
});

test("parseIncomingTyping filters out the current user's own typing echo", () => {
  const result = parseIncomingTyping(validTypingEvent(), conversationId, userId);
  assert.equal(result, undefined);
});

test("parseIncomingTyping without a currentUserId to compare against still returns the signal", () => {
  const result = parseIncomingTyping(validTypingEvent(), conversationId, undefined);
  assert.ok(result);
});

test("parseIncomingTyping rejects an event for a different conversation", () => {
  assert.equal(parseIncomingTyping(validTypingEvent(), "40000000-0000-4000-8000-000000000099", userId), undefined);
});

test("parseIncomingTyping rejects a malformed payload instead of throwing", () => {
  assert.equal(parseIncomingTyping({ nope: true }, conversationId, userId), undefined);
  assert.equal(parseIncomingTyping(null, conversationId, userId), undefined);
});

test("parseIncomingTyping rejects a ttl_ms other than the contract's fixed 3000", () => {
  const tampered = validTypingEvent({
    data: { conversation_id: conversationId, user_id: userId, ttl_ms: 9999, expires_at: "2026-07-12T09:00:09.999Z" }
  });
  assert.equal(parseIncomingTyping(tampered, conversationId, "someone-else"), undefined);
});

const turnId = "40000000-0000-4000-8000-000000000007";

function validMessageDeltaEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: eventId,
    type: "conversation.message.delta",
    topic: `conversation:${conversationId}`,
    ts,
    data: {
      conversation_id: conversationId,
      turn_id: turnId,
      delta_text: "hello",
      ordinal: 0
    },
    ...overrides
  };
}

// —— conversation.action_card.updated（R12 行动卡状态回流，00 §9 撤销置灰划线的实时通道） —— //

const actionCardId = "40000000-0000-4000-8000-000000000010";
const cardItemId = "40000000-0000-4000-8000-000000000011";

function validActionCardUpdatedEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: eventId,
    type: "conversation.action_card.updated",
    topic: `conversation:${conversationId}`,
    ts,
    actor: { actor_kind: "ai", label: "Cuu" },
    project_id: projectId,
    preview_text: "一条执行被撤销了",
    data: {
      conversation_id: conversationId,
      action_card_id: actionCardId,
      message_id: messageId,
      status: "active",
      appended: true,
      items: [{ id: cardItemId, kind: "execute", confidence: "high", status: "undone" }]
    },
    ...overrides
  };
}

test("parseIncomingMessageDelta accepts a real, well-formed event and returns the delta fields", () => {
  const result = parseIncomingMessageDelta(validMessageDeltaEvent(), conversationId);
  assert.deepEqual(result, { turnId, deltaText: "hello", ordinal: 0 });
});

test("parseIncomingMessageDelta rejects garbage payloads instead of throwing", () => {
  assert.equal(parseIncomingMessageDelta({ nonsense: true }, conversationId), undefined);
  assert.equal(parseIncomingMessageDelta(null, conversationId), undefined);
  assert.equal(parseIncomingMessageDelta("a string", conversationId), undefined);
  assert.equal(parseIncomingMessageDelta(undefined, conversationId), undefined);
});

test("parseIncomingMessageDelta rejects an event for a different conversation (topic isolation, no cross-talk)", () => {
  const otherConversationId = "40000000-0000-4000-8000-000000000099";
  assert.equal(parseIncomingMessageDelta(validMessageDeltaEvent(), otherConversationId), undefined);
});

test("parseIncomingMessageDelta rejects a payload that violates the contract's own invariant (topic must mirror data.conversation_id)", () => {
  const tampered = validMessageDeltaEvent({ topic: "conversation:40000000-0000-4000-8000-000000000099" });
  assert.equal(parseIncomingMessageDelta(tampered, conversationId), undefined);
});

test("parseIncomingActionCardUpdated accepts a real, well-formed event and returns the update signal", () => {
  const result = parseIncomingActionCardUpdated(validActionCardUpdatedEvent(), conversationId);
  assert.ok(result);
  assert.equal(result!.messageId, messageId);
  assert.equal(result!.actionCardId, actionCardId);
  assert.deepEqual(result!.items, [{ id: cardItemId, kind: "execute", confidence: "high", status: "undone" }]);
});

test("parseIncomingActionCardUpdated rejects garbage payloads instead of throwing", () => {
  assert.equal(parseIncomingActionCardUpdated({ nonsense: true }, conversationId), undefined);
  assert.equal(parseIncomingActionCardUpdated(null, conversationId), undefined);
  assert.equal(parseIncomingActionCardUpdated("a string", conversationId), undefined);
  assert.equal(parseIncomingActionCardUpdated(undefined, conversationId), undefined);
});

test("parseIncomingActionCardUpdated rejects an event for a different conversation (topic isolation)", () => {
  const otherConversationId = "40000000-0000-4000-8000-000000000099";
  assert.equal(parseIncomingActionCardUpdated(validActionCardUpdatedEvent(), otherConversationId), undefined);
});

test("parseIncomingActionCardUpdated rejects a payload violating the contract's own invariants (human actor without actor_user_id)", () => {
  const tampered = validActionCardUpdatedEvent({ actor: { actor_kind: "human", label: "张三" } });
  assert.equal(parseIncomingActionCardUpdated(tampered, conversationId), undefined);
});

test("parseIncomingActionCardUpdated rejects an out-of-enum item status instead of passing it through to the renderer", () => {
  const tampered = validActionCardUpdatedEvent({
    data: {
      conversation_id: conversationId,
      action_card_id: actionCardId,
      message_id: messageId,
      status: "active",
      appended: true,
      items: [{ id: cardItemId, kind: "execute", confidence: "high", status: "obliterated" }]
    }
  });
  assert.equal(parseIncomingActionCardUpdated(tampered, conversationId), undefined);
});
