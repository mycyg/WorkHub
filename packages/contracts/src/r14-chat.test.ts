import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "./index.js";

type SchemaLike<T = unknown> = {
  parse(value: unknown): T;
  safeParse(value: unknown): { success: boolean };
};

const conversationId = "30000000-0000-4000-8000-000000000003";
const messageId = "40000000-0000-4000-8000-000000000004";
const otherMessageId = "40000000-0000-4000-8000-000000000014";
const userId = "60000000-0000-4000-8000-000000000006";
const otherUserId = "60000000-0000-4000-8000-000000000016";
const projectId = "90000000-0000-4000-8000-000000000009";
const eventId = "a0000000-0000-4000-8000-00000000000e";
const ts = "2026-07-14T08:31:00.123Z";

function requiredSchema<T = unknown>(name: string): SchemaLike<T> {
  const candidate = (contracts as Record<string, unknown>)[name] as Partial<SchemaLike<T>> | undefined;
  assert.equal(typeof candidate?.parse, "function", `missing contract schema export: ${name}`);
  assert.equal(typeof candidate?.safeParse, "function", `missing contract schema export: ${name}`);
  return candidate as SchemaLike<T>;
}

const baseMessage = {
  id: messageId,
  conversation_id: conversationId,
  seq: 3,
  sender_type: "user",
  sender_user_id: userId,
  thread_root_id: null,
  created_at: ts
};

test("R14 reaction key schema freezes the five ASCII slugs and rejects emoji or unknown keys", () => {
  const schema = requiredSchema("conversationReactionKeySchema");
  assert.deepEqual(
    ["approve", "disagree", "done", "question", "watch"].map((value) => schema.parse(value)),
    ["approve", "disagree", "done", "question", "watch"]
  );
  assert.equal(schema.safeParse("celebrate").success, false);
  assert.equal(schema.safeParse("thumbsup").success, false);
  // emoji 字形绝不是合法的契约层 reaction key（它们只活在桌面渲染层的映射表）。
  assert.equal(schema.safeParse("\u{1F44D}").success, false);
});

test("R14 message VM accepts the additive edited/pinned/reply/reactions fields", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationMessageVmSchema");
  const enriched = {
    ...baseMessage,
    kind: "text",
    content: { text: "改过的正文" },
    edited_at: ts,
    pinned: { at: ts, by_user_id: otherUserId },
    reply_to: {
      message_id: otherMessageId,
      sender_type: "cuu",
      sender_user_id: null,
      preview_text: "原消息预览",
      deleted: false
    },
    reactions: [
      { key: "approve", user_ids: [userId, otherUserId] },
      { key: "done", user_ids: [userId] }
    ]
  };
  assert.deepEqual(schema.parse(enriched), enriched);

  // 旧消息（不带任何新字段）依旧合法——additive、零回归。
  assert.equal(schema.safeParse({ ...baseMessage, kind: "text", content: { text: "hi" } }).success, true);
});

test("R14 message VM enforces the tombstone invariant: deleted_at iff empty text under kind text", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationMessageVmSchema");
  // 归一后的墓碑：kind='text'、content.text=''、deleted_at 置位。
  assert.equal(
    schema.safeParse({ ...baseMessage, kind: "text", content: { text: "" }, deleted_at: ts }).success,
    true
  );
  // 墓碑不许带非空正文。
  assert.equal(
    schema.safeParse({ ...baseMessage, kind: "text", content: { text: "还有字" }, deleted_at: ts }).success,
    false
  );
  // 墓碑必须归一成 text——deleted_at 配 file_card 非法。
  assert.equal(
    schema.safeParse({
      ...baseMessage,
      kind: "file_card",
      content: { drive_item_id: otherMessageId, snapshot_name: "x.docx" },
      deleted_at: ts
    }).success,
    false
  );
  // 活着的 text 消息仍然强制非空（创建侧 min(1) 的读侧对称）。
  assert.equal(schema.safeParse({ ...baseMessage, kind: "text", content: { text: "" } }).success, false);
});

test("R14 message VM reactions/reply bounds are strict and fail-closed", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationMessageVmSchema");
  const withReactions = (reactions: unknown) => ({
    ...baseMessage,
    kind: "text",
    content: { text: "hi" },
    reactions
  });
  // 未知 key 的反应聚合被拒。
  assert.equal(schema.safeParse(withReactions([{ key: "celebrate", user_ids: [userId] }])).success, false);
  // 零反应者的键不该出现（min 1）。
  assert.equal(schema.safeParse(withReactions([{ key: "approve", user_ids: [] }])).success, false);
  // 引用预览文本超 80 被拒。
  assert.equal(
    schema.safeParse({
      ...baseMessage,
      kind: "text",
      content: { text: "hi" },
      reply_to: {
        message_id: otherMessageId,
        sender_type: "user",
        sender_user_id: userId,
        preview_text: "x".repeat(81),
        deleted: false
      }
    }).success,
    false
  );
  // pinned 多余键被 strict 拒。
  assert.equal(
    schema.safeParse({ ...baseMessage, kind: "text", content: { text: "hi" }, pinned: { at: ts, by_user_id: userId, extra: 1 } })
      .success,
    false
  );
});

test("R14 conversation.message.updated decouples the human actor from the message sender", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationMessageUpdatedEventSchema");
  // 置顶一条 Cuu 消息：actor 是置顶者（human），data.sender_type 是 'cuu'——合法。
  const event = {
    event_id: eventId,
    type: "conversation.message.updated",
    topic: `conversation:${conversationId}`,
    ts,
    actor: { actor_kind: "human", actor_user_id: userId, label: "member" },
    project_id: projectId,
    data: {
      ...baseMessage,
      sender_type: "cuu",
      sender_user_id: null,
      kind: "text",
      content: { text: "Cuu 的话被置顶" },
      pinned: { at: ts, by_user_id: userId }
    }
  };
  assert.equal(schema.safeParse(event).success, true);
  // topic 必须与 data.conversation_id 一致。
  assert.equal(schema.safeParse({ ...event, topic: `conversation:${otherMessageId}` }).success, false);
  // ai actor 不合法——编辑/删除/置顶都是人类操作。
  assert.equal(schema.safeParse({ ...event, actor: { actor_kind: "ai", label: "Cuu" } }).success, false);
});

test("R14 conversation.reaction.updated carries a full aggregate with a matching topic", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationReactionUpdatedEventSchema");
  const event = {
    event_id: eventId,
    type: "conversation.reaction.updated",
    topic: `conversation:${conversationId}`,
    ts,
    data: {
      conversation_id: conversationId,
      message_id: messageId,
      reactions: [{ key: "approve", user_ids: [userId, otherUserId] }]
    }
  };
  assert.equal(schema.safeParse(event).success, true);
  assert.equal(schema.safeParse({ ...event, topic: `conversation:${otherMessageId}` }).success, false);
  // strict：payload 不接受计划外的 actor 字段。
  assert.equal(
    schema.safeParse({ ...event, actor: { actor_kind: "human", actor_user_id: userId } }).success,
    false
  );
  // 未知 reaction key 被拒。
  assert.equal(
    schema.safeParse({
      ...event,
      data: { ...event.data, reactions: [{ key: "nope", user_ids: [userId] }] }
    }).success,
    false
  );
});

test("R14 conversation.read.updated pins a non-negative safe last_read_seq to its topic", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationReadUpdatedEventSchema");
  const event = {
    event_id: eventId,
    type: "conversation.read.updated",
    topic: `conversation:${conversationId}`,
    ts,
    data: { conversation_id: conversationId, user_id: userId, last_read_seq: 7 }
  };
  assert.equal(schema.safeParse(event).success, true);
  assert.equal(schema.safeParse({ ...event, topic: `conversation:${otherMessageId}` }).success, false);
  assert.equal(
    schema.safeParse({ ...event, data: { ...event.data, last_read_seq: -1 } }).success,
    false
  );
  assert.equal(
    schema.safeParse({ ...event, data: { ...event.data, last_read_seq: 1.5 } }).success,
    false
  );
});

// ── R14FIX 批 workbench：协同会话改名契约（additive） ──────────────────────────────────

test("R14FIX rename request accepts a 1..256 char title and rejects empty/too-long/extra keys", () => {
  const schema = requiredSchema<Record<string, unknown>>("renameConversationRequestSchema");
  assert.deepEqual(schema.parse({ title: "改第三幕" }), { title: "改第三幕" });
  assert.equal(schema.safeParse({ title: "" }).success, false);
  assert.equal(schema.safeParse({ title: "x".repeat(256) }).success, true);
  assert.equal(schema.safeParse({ title: "x".repeat(257) }).success, false);
  assert.equal(schema.safeParse({}).success, false);
  assert.equal(schema.safeParse({ title: "ok", extra: true }).success, false);
});

test("R14FIX rename result carries a full conversation VM", () => {
  const schema = requiredSchema<Record<string, unknown>>("renameConversationResultVmSchema");
  const conversation = {
    id: conversationId,
    workspace_id: "10000000-0000-4000-8000-000000000001",
    project_id: projectId,
    kind: "collab",
    title: "改第三幕",
    parent_conversation_id: null,
    source_message_id: null,
    visibility: "private",
    next_seq: 3,
    created_by: userId,
    participant_role: "owner",
    cuu_enabled: true,
    created_at: ts,
    updated_at: ts
  };
  assert.equal(schema.safeParse({ conversation }).success, true);
  assert.equal(schema.safeParse({ conversation: { ...conversation, title: "" } }).success, false);
  assert.equal(schema.safeParse({ conversation, extra: true }).success, false);
});

// ── R15 批 cuu-toggle：会话级 Cuu 开关 PATCH 契约（additive） ────────────────────────────

test("R15 cuu-toggle request accepts only a boolean enabled and rejects extra keys", () => {
  const schema = requiredSchema<Record<string, unknown>>("updateConversationCuuRequestSchema");
  assert.deepEqual(schema.parse({ enabled: true }), { enabled: true });
  assert.deepEqual(schema.parse({ enabled: false }), { enabled: false });
  assert.equal(schema.safeParse({}).success, false);
  assert.equal(schema.safeParse({ enabled: "true" }).success, false);
  assert.equal(schema.safeParse({ enabled: true, extra: true }).success, false);
});

test("R15 cuu-toggle result carries a full conversation VM", () => {
  const schema = requiredSchema<Record<string, unknown>>("updateConversationCuuResultVmSchema");
  const conversation = {
    id: conversationId,
    workspace_id: "10000000-0000-4000-8000-000000000001",
    project_id: projectId,
    kind: "collab",
    title: "协作区",
    parent_conversation_id: null,
    source_message_id: null,
    visibility: "private",
    next_seq: 3,
    created_by: userId,
    participant_role: "owner",
    cuu_enabled: false,
    created_at: ts,
    updated_at: ts
  };
  assert.equal(schema.safeParse({ conversation }).success, true);
  assert.equal(schema.safeParse({ conversation, extra: true }).success, false);
});

test("R15 conversation.cuu.updated pins the flipped boolean to its topic", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationCuuUpdatedEventSchema");
  const event = {
    event_id: eventId,
    type: "conversation.cuu.updated",
    topic: `conversation:${conversationId}`,
    ts,
    data: { conversation_id: conversationId, cuu_enabled: true }
  };
  assert.equal(schema.safeParse(event).success, true);
  assert.equal(schema.safeParse({ ...event, topic: `conversation:${otherMessageId}` }).success, false);
  assert.equal(schema.safeParse({ ...event, data: { ...event.data, cuu_enabled: "true" } }).success, false);
});
