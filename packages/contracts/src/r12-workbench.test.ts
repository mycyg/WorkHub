import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "./index.js";

type SchemaLike<T = unknown> = {
  parse(value: unknown): T;
  safeParse(value: unknown): { success: boolean };
};

const conversationId = "30000000-0000-4000-8000-000000000003";
const messageId = "40000000-0000-4000-8000-000000000004";
const driveItemId = "50000000-0000-4000-8000-000000000005";
const userId = "60000000-0000-4000-8000-000000000006";
const participantUserId = "60000000-0000-4000-8000-000000000007";
const caseParticipantUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const runId = "70000000-0000-4000-8000-000000000007";
const workspaceId = "80000000-0000-4000-8000-000000000008";
const projectId = "90000000-0000-4000-8000-000000000009";

function requiredSchema<T = unknown>(name: string): SchemaLike<T> {
  const candidate = (contracts as Record<string, unknown>)[name] as Partial<SchemaLike<T>> | undefined;
  assert.equal(typeof candidate?.parse, "function", `missing contract schema export: ${name}`);
  assert.equal(typeof candidate?.safeParse, "function", `missing contract schema export: ${name}`);
  return candidate as SchemaLike<T>;
}

test("R12 conversation enums accept only the frozen protocol values", () => {
  const conversationKindSchema = requiredSchema("conversationKindSchema");
  const conversationVisibilitySchema = requiredSchema("conversationVisibilitySchema");
  const conversationSenderTypeSchema = requiredSchema("conversationSenderTypeSchema");
  const conversationMessageKindSchema = requiredSchema("conversationMessageKindSchema");

  assert.deepEqual(["main", "collab"].map((value) => conversationKindSchema.parse(value)), ["main", "collab"]);
  assert.deepEqual(
    ["project", "private"].map((value) => conversationVisibilitySchema.parse(value)),
    ["project", "private"]
  );
  assert.deepEqual(
    ["user", "cuu", "system"].map((value) => conversationSenderTypeSchema.parse(value)),
    ["user", "cuu", "system"]
  );
  assert.deepEqual(
    ["text", "file_card", "action_card", "system_event", "tool_note"].map((value) =>
      conversationMessageKindSchema.parse(value)
    ),
    ["text", "file_card", "action_card", "system_event", "tool_note"]
  );

  assert.equal(conversationKindSchema.safeParse("channel").success, false);
  assert.equal(conversationVisibilitySchema.safeParse("workspace").success, false);
  assert.equal(conversationSenderTypeSchema.safeParse("assistant").success, false);
  assert.equal(conversationMessageKindSchema.safeParse("binary").success, false);
});

test("R12 file cards are metadata-only and reject embedded file content", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationFileCardContentSchema");
  const parsed = schema.parse({
    drive_item_id: driveItemId,
    snapshot_name: "brief-v3.docx"
  });

  assert.deepEqual(parsed, {
    drive_item_id: driveItemId,
    snapshot_name: "brief-v3.docx"
  });
  assert.equal(schema.safeParse({ ...parsed, content: "secret bytes" }).success, false);
  assert.equal(schema.safeParse({ ...parsed, body: "secret bytes" }).success, false);
});

test("R12 file-card POST input accepts only a Drive item id and keeps snapshot names server-owned", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationFileCardRequestContentSchema");

  assert.deepEqual(schema.parse({ drive_item_id: driveItemId }), { drive_item_id: driveItemId });
  assert.equal(
    schema.safeParse({ drive_item_id: driveItemId, snapshot_name: "client-controlled.docx" }).success,
    false
  );
  assert.equal(schema.safeParse({ drive_item_id: driveItemId, storage_path: "/secret" }).success, false);
});

test("R12 conversation creation and user message contracts expose bounded metadata shapes", () => {
  const createConversationRequestSchema = requiredSchema<Record<string, unknown>>("createConversationRequestSchema");
  const createConversationMessageRequestSchema = requiredSchema<Record<string, unknown>>(
    "createConversationMessageRequestSchema"
  );

  assert.deepEqual(
    createConversationRequestSchema.parse({
      kind: "collab",
      title: "重写第三节",
      visibility: "private",
      parent_conversation_id: conversationId,
      source_message_id: messageId
    }),
    {
      kind: "collab",
      title: "重写第三节",
      visibility: "private",
      parent_conversation_id: conversationId,
      source_message_id: messageId,
      participant_user_ids: [],
      cuu_enabled: true
    }
  );
  assert.equal(
    createConversationRequestSchema.safeParse({
      kind: "main",
      title: "主区",
      visibility: "project"
    }).success,
    false
  );
  assert.equal(
    createConversationRequestSchema.safeParse({
      kind: "collab",
      title: "缺少父会话",
      visibility: "private",
      source_message_id: messageId
    }).success,
    false
  );

  assert.deepEqual(
    createConversationMessageRequestSchema.parse({
      kind: "text",
      content: { text: "请先核对引用。" },
      thread_root_id: messageId
    }),
    {
      kind: "text",
      content: { text: "请先核对引用。" },
      thread_root_id: messageId
    }
  );
  assert.deepEqual(
    createConversationMessageRequestSchema.parse({
      kind: "file_card",
      content: { drive_item_id: driveItemId }
    }),
    {
      kind: "file_card",
      content: { drive_item_id: driveItemId }
    }
  );
  assert.equal(
    createConversationMessageRequestSchema.safeParse({
      kind: "file_card",
      content: { drive_item_id: driveItemId, snapshot_name: "client-controlled.docx" }
    }).success,
    false
  );
  assert.equal(
    createConversationMessageRequestSchema.safeParse({
      kind: "text",
      content: { text: "x".repeat(20_001) }
    }).success,
    false
  );
  assert.equal(
    createConversationMessageRequestSchema.safeParse({
      kind: "text",
      content: { text: "x".repeat(20_000) }
    }).success,
    true
  );
});

test("R12 conversation HTTP VMs are strict, nullable-explicit, and safe-integer bounded", () => {
  const conversationSchema = requiredSchema<Record<string, unknown>>("conversationVmSchema");
  const participantSchema = requiredSchema<Record<string, unknown>>("conversationParticipantVmSchema");
  const createResultSchema = requiredSchema<Record<string, unknown>>("createConversationResultVmSchema");
  const baseConversation = {
    id: conversationId,
    workspace_id: "10000000-0000-4000-8000-000000000001",
    project_id: "20000000-0000-4000-8000-000000000002",
    kind: "collab",
    title: "重写第三节",
    parent_conversation_id: null,
    source_message_id: null,
    visibility: "private",
    next_seq: 42,
    created_by: userId,
    participant_role: "owner",
    cuu_enabled: true,
    created_at: "2026-07-12T08:30:00.123Z",
    updated_at: "2026-07-12T08:31:00.123Z"
  };
  const participant = {
    id: "61000000-0000-4000-8000-000000000001",
    conversation_id: conversationId,
    user_id: userId,
    role: "owner",
    created_at: "2026-07-12T08:30:00.123Z",
    updated_at: "2026-07-12T08:30:00.123Z"
  };

  assert.deepEqual(conversationSchema.parse(baseConversation), baseConversation);
  assert.deepEqual(participantSchema.parse(participant), participant);
  assert.deepEqual(createResultSchema.parse({ conversation: baseConversation, participants: [participant] }), {
    conversation: baseConversation,
    participants: [participant]
  });
  assert.equal(conversationSchema.safeParse({ ...baseConversation, parent_conversation_id: undefined }).success, false);
  assert.equal(conversationSchema.safeParse({ ...baseConversation, participant_role: undefined }).success, false);
  assert.equal(conversationSchema.safeParse({ ...baseConversation, cuu_enabled: undefined }).success, false);
  assert.equal(conversationSchema.safeParse({ ...baseConversation, next_seq: Number.MAX_SAFE_INTEGER + 1 }).success, false);
  assert.equal(conversationSchema.safeParse({ ...baseConversation, storage_path: "/secret" }).success, false);
});

test("R12 message VMs validate text/file cards fail-closed and bound future content records", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationMessageVmSchema");
  const base = {
    id: messageId,
    conversation_id: conversationId,
    seq: 1,
    sender_type: "user",
    sender_user_id: userId,
    thread_root_id: null,
    created_at: "2026-07-12T08:31:00.123Z"
  };

  assert.equal(schema.safeParse({ ...base, kind: "text", content: { text: "hello" } }).success, true);
  assert.equal(
    schema.safeParse({ ...base, kind: "file_card", content: { drive_item_id: driveItemId, snapshot_name: "brief.docx" } })
      .success,
    true
  );
  assert.equal(
    schema.safeParse({ ...base, kind: "text", content: { text: "hello", hidden: "leak" } }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      ...base,
      kind: "file_card",
      content: { drive_item_id: driveItemId, snapshot_name: "brief.docx", parsed_text: "secret" }
    }).success,
    false
  );
  assert.equal(schema.safeParse({ ...base, kind: "system_event", content: [] }).success, false);
  assert.equal(
    schema.safeParse({ ...base, kind: "system_event", content: { body: "x".repeat(65_537) } }).success,
    false
  );
  assert.equal(schema.safeParse({ ...base, kind: "tool_note", content: { state: "done" } }).success, true);
  assert.equal(schema.safeParse({ ...base, seq: Number.MAX_SAFE_INTEGER + 1, kind: "text", content: { text: "x" } }).success, false);

  // R12 批4a：Cuu 协同回应携带的 memory_citations 是 additive optional 字段——正常文本消息（无该字段）
  // 仍然照旧通过；这里补 kind="text" 的引用清单正反例。
  const cuuBase = { ...base, sender_type: "cuu" as const, sender_user_id: null };
  assert.equal(
    schema.safeParse({
      ...cuuBase,
      kind: "text",
      content: {
        text: "已经帮你查过之前的偏好了",
        memory_citations: [
          { kind: "user_memory", title: "偏好中文回复" },
          { kind: "team_skill", title: "PPT 交付自检" }
        ]
      }
    }).success,
    true
  );
  assert.equal(
    schema.safeParse({
      ...cuuBase,
      kind: "text",
      content: { text: "x", memory_citations: [{ kind: "unknown_kind", title: "x" }] }
    }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      ...cuuBase,
      kind: "text",
      content: { text: "x", memory_citations: [{ kind: "user_memory", title: "" }] }
    }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      ...cuuBase,
      kind: "text",
      content: {
        text: "x",
        memory_citations: new Array(21).fill({ kind: "user_memory", title: "x" })
      }
    }).success,
    false
  );
});

test("R12 message-created events are strict complete envelopes bound to one conversation topic", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationMessageCreatedEventSchema");
  const message = {
    id: messageId,
    conversation_id: conversationId,
    seq: 7,
    sender_type: "user",
    sender_user_id: userId,
    kind: "text",
    content: { text: "请先核对引用。" },
    thread_root_id: null,
    created_at: "2026-07-12T08:31:00.123Z"
  };
  const event = {
    event_id: "41000000-0000-4000-8000-000000000041",
    type: "conversation.message.created",
    topic: `conversation:${conversationId}`,
    ts: "2026-07-12T08:31:00.123Z",
    actor: { actor_kind: "human", actor_user_id: userId, label: "R12 owner" },
    project_id: projectId,
    preview_text: "请先核对引用。",
    data: message
  };

  assert.deepEqual(schema.parse(event), event);
  for (const invalid of [
    { ...event, type: "conversation.message.delta" },
    { ...event, topic: "conversation:30000000-0000-4000-8000-000000000099" },
    { ...event, project_id: undefined },
    { ...event, hidden: "leak" },
    { ...event, data: { ...message, sender_type: "cuu" } },
    {
      ...event,
      data: { ...message, sender_user_id: "60000000-0000-4000-8000-000000000099" }
    },
    { ...event, data: { ...message, seq: undefined } },
    {
      ...event,
      data: {
        ...message,
        kind: "file_card",
        content: { drive_item_id: driveItemId, snapshot_name: "brief.docx", parsed_text: "secret" }
      }
    }
  ]) {
    assert.equal(schema.safeParse(invalid).success, false);
  }
});

test("R12 typing events reserve a strict server-owned 3000ms transient contract only", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationPresenceTypingEventSchema");
  const event = {
    event_id: "42000000-0000-4000-8000-000000000042",
    type: "conversation.presence.typing",
    topic: `conversation:${conversationId}`,
    ts: "2026-07-12T08:31:00.000Z",
    actor: { actor_kind: "human", actor_user_id: userId, label: "R12 owner" },
    data: {
      conversation_id: conversationId,
      user_id: userId,
      ttl_ms: 3000,
      expires_at: "2026-07-12T08:31:03.000Z"
    }
  };

  assert.deepEqual(schema.parse(event), event);
  for (const invalid of [
    { ...event, type: "conversation.message.created" },
    { ...event, topic: "conversation:30000000-0000-4000-8000-000000000099" },
    { ...event, extra: true },
    { ...event, data: { ...event.data, user_id: "browser-user" } },
    {
      ...event,
      actor: { ...event.actor, actor_user_id: "60000000-0000-4000-8000-000000000099" }
    },
    { ...event, data: { ...event.data, ttl_ms: 2999 } },
    { ...event, data: { ...event.data, expires_at: "2026-07-12T08:31:02.999Z" } }
  ]) {
    assert.equal(schema.safeParse(invalid).success, false);
  }

  for (const reservedName of [
    "conversationToolBeginEventSchema",
    "conversationToolOutputDeltaEventSchema",
    "conversationToolEndEventSchema",
    "conversationItemStartedEventSchema",
    "conversationItemCompletedEventSchema"
  ]) {
    assert.equal((contracts as Record<string, unknown>)[reservedName], undefined, reservedName);
  }
});

// R12 批4a：conversation.message.delta 从批0遗留的「仅保留名称」升级为真实 payload/校验——
// 与上面的「仅保留名称」断言分离到自己的正例测试，同 message-created/action-card-updated 同等对待。
test("R12 message-delta events are a minimal strict transient contract with no seq or actor", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationMessageDeltaEventSchema");
  const turnId = "47000000-0000-4000-8000-000000000047";
  const event = {
    event_id: "48000000-0000-4000-8000-000000000048",
    type: "conversation.message.delta",
    topic: `conversation:${conversationId}`,
    ts: "2026-07-12T08:31:00.000Z",
    data: {
      conversation_id: conversationId,
      turn_id: turnId,
      delta_text: "先看一下这段草稿",
      ordinal: 0
    }
  };

  assert.deepEqual(schema.parse(event), event);
  for (const invalid of [
    { ...event, type: "conversation.message.created" },
    { ...event, topic: "conversation:30000000-0000-4000-8000-000000000099" },
    { ...event, actor: { actor_kind: "human", actor_user_id: userId } },
    { ...event, project_id: projectId },
    { ...event, hidden: "leak" },
    { ...event, data: { ...event.data, delta_text: "" } },
    { ...event, data: { ...event.data, delta_text: "x".repeat(4001) } },
    { ...event, data: { ...event.data, ordinal: -1 } },
    { ...event, data: { ...event.data, ordinal: 1.5 } },
    { ...event, data: { ...event.data, seq: 1 } },
    { ...event, data: { ...event.data, turn_id: undefined } }
  ]) {
    assert.equal(schema.safeParse(invalid).success, false);
  }
});

// R12 批3：conversation.action_card.updated 从批0的「仅保留名称」升级为真实 payload/校验——
// 与上面的「仅保留名称」断言分离到自己的正例测试，同 message-created/typing 事件同等对待。
test("R12 action-card-updated events carry a minimal renderable summary bound to one conversation topic", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationActionCardUpdatedEventSchema");
  const actionCardId = "43000000-0000-4000-8000-000000000043";
  const event = {
    event_id: "44000000-0000-4000-8000-000000000044",
    type: "conversation.action_card.updated",
    topic: `conversation:${conversationId}`,
    ts: "2026-07-12T08:31:00.000Z",
    actor: { actor_kind: "ai", label: "Cuu" },
    project_id: projectId,
    preview_text: "Cuu 从刚才的讨论里拎出 2 件事",
    data: {
      conversation_id: conversationId,
      action_card_id: actionCardId,
      message_id: messageId,
      status: "active",
      appended: false,
      items: [
        { id: "45000000-0000-4000-8000-000000000045", kind: "execute", confidence: "high", status: "running" },
        { id: "46000000-0000-4000-8000-000000000046", kind: "decide", confidence: "low", status: "waiting_decision" }
      ]
    }
  };

  assert.deepEqual(schema.parse(event), event);
  for (const invalid of [
    { ...event, type: "conversation.message.created" },
    { ...event, topic: "conversation:30000000-0000-4000-8000-000000000099" },
    { ...event, hidden: "leak" },
    { ...event, actor: { actor_kind: "human" } },
    { ...event, data: { ...event.data, status: "archived" } },
    { ...event, data: { ...event.data, items: [{ ...event.data.items[0], kind: "unknown" }] } },
    { ...event, data: { ...event.data, items: new Array(9).fill(event.data.items[0]) } }
  ]) {
    assert.equal(schema.safeParse(invalid).success, false);
  }

  assert.deepEqual(
    schema.parse({
      ...event,
      actor: { actor_kind: "human", actor_user_id: userId, label: "阿曼" }
    }).actor,
    { actor_kind: "human", actor_user_id: userId, label: "阿曼" }
  );
});

test("R12 conversation pages expose canonical round-trip cursors and explicit message pagination", () => {
  const conversationPageSchema = requiredSchema<Record<string, unknown>>("conversationListPageVmSchema");
  const messagePageSchema = requiredSchema<Record<string, unknown>>("conversationMessagePageVmSchema");
  const afterCreatedAt = "2026-07-12T08:30:00.123456Z";
  const nextCursor = { afterCreatedAt, afterId: conversationId };

  assert.deepEqual(
    conversationPageSchema.parse({ conversations: [], capped: true, next_cursor: nextCursor }),
    { conversations: [], capped: true, next_cursor: nextCursor }
  );
  assert.deepEqual(
    messagePageSchema.parse({ messages: [], has_more: false, next_after_seq: 42 }),
    { messages: [], has_more: false, next_after_seq: 42 }
  );
  // R12 批8：next_before_seq 只在响应 beforeSeq 请求时出现——可选字段，forward 分页的既有形状零改动。
  assert.deepEqual(
    messagePageSchema.parse({ messages: [], has_more: true, next_after_seq: 12, next_before_seq: 3 }),
    { messages: [], has_more: true, next_after_seq: 12, next_before_seq: 3 }
  );
  assert.equal(
    messagePageSchema.safeParse({
      messages: [],
      has_more: false,
      next_after_seq: 12,
      next_before_seq: Number.MAX_SAFE_INTEGER + 1
    }).success,
    false
  );
  assert.equal(
    conversationPageSchema.safeParse({
      conversations: [],
      capped: true,
      next_cursor: { afterCreatedAt: "2026-07-12T08:30:00.123Z", afterId: conversationId }
    }).success,
    false
  );
  assert.equal(
    conversationPageSchema.safeParse({ conversations: [], capped: false, next_cursor: nextCursor }).success,
    false
  );
  assert.equal(
    messagePageSchema.safeParse({ messages: [], has_more: false, next_after_seq: Number.MAX_SAFE_INTEGER + 1 }).success,
    false
  );
});

function workbenchVm(overrides: Record<string, unknown> = {}) {
  const mainConversation = {
    id: conversationId,
    workspace_id: workspaceId,
    project_id: projectId,
    kind: "main",
    title: "主区",
    parent_conversation_id: null,
    source_message_id: null,
    visibility: "project",
    next_seq: 0,
    created_by: userId,
    participant_role: null,
    cuu_enabled: true,
    created_at: "2026-07-12T08:30:00.123Z",
    updated_at: "2026-07-12T08:30:00.123Z"
  };
  return {
    generated_at: "2026-07-12T09:00:00.000Z",
    project: {
      id: projectId,
      workspace_id: workspaceId,
      name: "星尘短剧",
      slug: "stardust",
      description: null,
      owner_label: "阿曼"
    },
    viewer: {
      user_id: userId,
      membership_role: "member",
      is_project_owner: false
    },
    conversations: {
      conversations: [mainConversation],
      capped: false,
      next_cursor: null
    },
    workspace_members: {
      scope: "workspace",
      total: 2,
      returned: 2,
      capped: false,
      items: [
        {
          user_id: userId,
          nickname: "张三",
          membership_role: "member",
          is_project_owner: false,
          is_self: true
        },
        {
          user_id: participantUserId,
          nickname: "阿曼",
          membership_role: "owner",
          is_project_owner: true,
          is_self: false
        }
      ]
    },
    army_summary: {
      active_plan_count: 0,
      empty_state: "no_active_armies"
    },
    recent_project_files: {
      items: [],
      empty_state: "no_recent_files"
    },
    ...overrides
  };
}

test("R12 workbench bootstrap VM is strict, bounded, and secret-free", () => {
  const schema = requiredSchema<Record<string, unknown>>("workbenchPageVmSchema");
  const value = workbenchVm();

  assert.deepEqual(schema.parse(value), value);
  for (const invalid of [
    { ...value, background_tasks: [] },
    { ...value, conversation_outputs: [] },
    { ...value, runs: [] },
    { ...value, steps: [] },
    {
      ...value,
      project: { ...(value.project as Record<string, unknown>), secret: true }
    },
    {
      ...value,
      viewer: { ...(value.viewer as Record<string, unknown>), role_ids: ["admin"] }
    },
    {
      ...value,
      conversations: { ...(value.conversations as Record<string, unknown>), hidden: true }
    },
    {
      ...value,
      workspace_members: { ...(value.workspace_members as Record<string, unknown>), workspace_name: "secret" }
    },
    {
      ...value,
      army_summary: { ...(value.army_summary as Record<string, unknown>), runs: [] }
    },
    {
      ...value,
      recent_project_files: { ...(value.recent_project_files as Record<string, unknown>), storage_root: "/private" }
    },
    {
      ...value,
      workspace_members: {
        ...(value.workspace_members as Record<string, unknown>),
        items: [{
          ...((value.workspace_members as { items: Record<string, unknown>[] }).items[0]),
          cookie_token: "secret"
        }]
      }
    },
    {
      ...value,
      recent_project_files: {
        items: [{
          id: driveItemId,
          name: "brief.docx",
          updated_at: "2026-07-12T08:30:00.123Z",
          href: `/drive?project_id=${projectId}&item_id=${driveItemId}`,
          storage_path: "/private/brief.docx"
        }]
      }
    }
  ]) {
    assert.equal(schema.safeParse(invalid).success, false, `accepted unsafe workbench VM: ${JSON.stringify(invalid)}`);
  }
});

test("R12 workbench VM rejects broken conversation and viewer/member identity invariants", () => {
  const schema = requiredSchema<Record<string, unknown>>("workbenchPageVmSchema");
  const value = workbenchVm() as ReturnType<typeof workbenchVm> & {
    conversations: { conversations: Record<string, unknown>[] };
    workspace_members: { items: Record<string, unknown>[] };
    viewer: Record<string, unknown>;
  };
  const main = value.conversations.conversations[0] as Record<string, unknown>;
  const self = value.workspace_members.items[0] as Record<string, unknown>;

  for (const invalid of [
    { ...value, conversations: { conversations: [], capped: false, next_cursor: null } },
    { ...value, conversations: { conversations: [main, { ...main, id: messageId }], capped: false, next_cursor: null } },
    { ...value, conversations: { conversations: [{ ...main, project_id: driveItemId }], capped: false, next_cursor: null } },
    { ...value, conversations: { conversations: [{ ...main, workspace_id: driveItemId }], capped: false, next_cursor: null } },
    { ...value, workspace_members: { ...value.workspace_members, returned: 1 } },
    { ...value, workspace_members: { ...value.workspace_members, total: 1 } },
    { ...value, workspace_members: { ...value.workspace_members, capped: true } },
    { ...value, workspace_members: { ...value.workspace_members, total: 3, capped: false } },
    {
      ...value,
      workspace_members: {
        ...value.workspace_members,
        items: [{ ...self, is_self: false }, value.workspace_members.items[1]]
      }
    },
    {
      ...value,
      workspace_members: {
        ...value.workspace_members,
        items: [value.workspace_members.items[1], self]
      }
    },
    {
      ...value,
      workspace_members: {
        ...value.workspace_members,
        items: [{ ...self, user_id: participantUserId }, value.workspace_members.items[1]]
      }
    },
    {
      ...value,
      workspace_members: {
        ...value.workspace_members,
        items: [{ ...self, membership_role: "admin" }, value.workspace_members.items[1]]
      }
    },
    {
      ...value,
      workspace_members: {
        ...value.workspace_members,
        items: [{ ...self, membership_role: "superadmin" }, value.workspace_members.items[1]]
      }
    },
    {
      ...value,
      viewer: { ...value.viewer, is_project_owner: true }
    },
    {
      ...value,
      workspace_members: {
        ...value.workspace_members,
        items: [
          { ...self, is_project_owner: true },
          { ...value.workspace_members.items[1], is_project_owner: true }
        ]
      }
    }
  ]) {
    assert.equal(schema.safeParse(invalid).success, false, `accepted inconsistent workbench VM: ${JSON.stringify(invalid)}`);
  }
});

test("R12 workbench VM accepts a full bounded page and rejects member/file overflow", () => {
  const schema = requiredSchema<Record<string, unknown>>("workbenchPageVmSchema");
  const base = workbenchVm() as ReturnType<typeof workbenchVm> & {
    conversations: { conversations: Record<string, unknown>[] };
    workspace_members: { items: Record<string, unknown>[] };
  };
  const main = base.conversations.conversations[0] as Record<string, unknown>;
  const fullMembers = Array.from({ length: 100 }, (_, index) => ({
    user_id: `83000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    nickname: `成员 ${index + 1}`,
    membership_role: index === 1 ? "owner" : "member",
    is_project_owner: index === 1,
    is_self: index === 0
  }));
  fullMembers[0] = {
    user_id: userId,
    nickname: "张三",
    membership_role: "member",
    is_project_owner: false,
    is_self: true
  };
  const collabId = "30000000-0000-4000-8000-000000000099";
  const file = {
    id: driveItemId,
    name: "brief.docx",
    updated_at: "2026-07-12T08:30:00.123Z",
    href: `/drive?project_id=${projectId}&item_id=${driveItemId}`
  };
  const full = {
    ...base,
    conversations: {
      conversations: [
        main,
        {
          ...main,
          id: collabId,
          kind: "collab",
          title: "改第三幕",
          parent_conversation_id: conversationId,
          visibility: "private",
          participant_role: "member"
        }
      ],
      capped: false,
      next_cursor: null
    },
    workspace_members: {
      scope: "workspace",
      total: 137,
      returned: 100,
      capped: true,
      items: fullMembers
    },
    army_summary: { active_plan_count: 4 },
    recent_project_files: { items: [file] }
  };

  assert.deepEqual(schema.parse(full), full);
  assert.equal(schema.safeParse({
    ...full,
    conversations: {
      conversations: [
        main,
        ...Array.from({ length: 50 }, (_, index) => ({
          ...main,
          id: `85000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          kind: "collab",
          title: `协作区 ${index + 1}`,
          parent_conversation_id: conversationId,
          visibility: "private",
          participant_role: "member"
        }))
      ],
      capped: false,
      next_cursor: null
    }
  }).success, false);
  assert.equal(schema.safeParse({
    ...full,
    workspace_members: {
      scope: "workspace",
      total: 138,
      returned: 101,
      capped: true,
      items: [...fullMembers, {
        user_id: "83000000-0000-4000-8000-000000000101",
        nickname: "成员 101",
        membership_role: "member",
        is_project_owner: false,
        is_self: false
      }]
    }
  }).success, false);
  assert.equal(schema.safeParse({
    ...full,
    recent_project_files: {
      items: Array.from({ length: 6 }, (_, index) => ({
        ...file,
        id: `84000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
      }))
    }
  }).success, false);
});

test("R12 workbench VM makes army and recent-file empty states exact", () => {
  const schema = requiredSchema<Record<string, unknown>>("workbenchPageVmSchema");
  const value = workbenchVm();
  const file = {
    id: driveItemId,
    name: "brief.docx",
    updated_at: "2026-07-12T08:30:00.123Z",
    href: `/drive?project_id=${projectId}&item_id=${driveItemId}`
  };

  assert.equal(schema.safeParse({
    ...value,
    army_summary: { active_plan_count: 1, empty_state: "no_active_armies" }
  }).success, false);
  assert.equal(schema.safeParse({ ...value, army_summary: { active_plan_count: 0 } }).success, false);
  assert.equal(schema.safeParse({
    ...value,
    recent_project_files: { items: [file], empty_state: "no_recent_files" }
  }).success, false);
  assert.equal(schema.safeParse({ ...value, recent_project_files: { items: [] } }).success, false);
  assert.equal(schema.safeParse({
    ...value,
    army_summary: { active_plan_count: 1 },
    recent_project_files: { items: [file] }
  }).success, true);
});

test("R12 collab creation defaults and bounds unique active participant IDs", () => {
  const schema = requiredSchema<Record<string, unknown>>("createConversationRequestSchema");
  const base = {
    kind: "collab",
    title: "协作区",
    visibility: "private"
  };

  assert.deepEqual(schema.parse(base), { ...base, participant_user_ids: [], cuu_enabled: true });
  assert.deepEqual(schema.parse({ ...base, participant_user_ids: [participantUserId] }), {
    ...base,
    participant_user_ids: [participantUserId],
    cuu_enabled: true
  });
  assert.deepEqual(schema.parse({ ...base, cuu_enabled: false }), {
    ...base,
    participant_user_ids: [],
    cuu_enabled: false
  });

  const maximumParticipants = Array.from({ length: 99 }, (_, index) =>
    `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
  );
  assert.equal(schema.safeParse({ ...base, participant_user_ids: maximumParticipants }).success, true);
  assert.equal(
    schema.safeParse({
      ...base,
      participant_user_ids: [participantUserId, participantUserId]
    }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      ...base,
      participant_user_ids: [caseParticipantUserId, caseParticipantUserId.toUpperCase()]
    }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      ...base,
      participant_user_ids: [...maximumParticipants, "60000000-0000-4000-8000-000000000100"]
    }).success,
    false
  );
  assert.equal(schema.safeParse({ ...base, participant_user_ids: ["not-a-uuid"] }).success, false);
});

test("R12 message cursor query uses safe integers and a bounded default", () => {
  const schema = requiredSchema<{ afterSeq: number; limit: number }>("conversationMessageListQuerySchema");

  assert.deepEqual(schema.parse({}), { afterSeq: 0, limit: 50 });
  assert.deepEqual(schema.parse({ afterSeq: "42", limit: "100" }), { afterSeq: 42, limit: 100 });
  for (const afterSeq of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(schema.safeParse({ afterSeq }).success, false);
  }
  for (const limit of [0, 101, 1.5]) {
    assert.equal(schema.safeParse({ limit }).success, false);
  }
  assert.equal(schema.safeParse({ after_seq: 42 }).success, false);
});

// R12 批8：反向翻页游标——两个 union 分支都是 .strict()，同时给 afterSeq 和 beforeSeq 时任一分支都会
// 因为收到对方的「未识别字段」整体失败，天然互斥，不需要额外的 superRefine。
test("R12 message cursor query accepts a mutually exclusive beforeSeq cursor for backward paging", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationMessageListQuerySchema");

  assert.deepEqual(schema.parse({ beforeSeq: "42", limit: "20" }), { beforeSeq: 42, limit: 20 });
  assert.deepEqual(schema.parse({ beforeSeq: 0 }), { beforeSeq: 0, limit: 50 });
  for (const beforeSeq of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(schema.safeParse({ beforeSeq }).success, false);
  }
  for (const limit of [0, 101, 1.5]) {
    assert.equal(schema.safeParse({ beforeSeq: 5, limit }).success, false);
  }
  assert.equal(schema.safeParse({ before_seq: 42 }).success, false);
  // 互斥：afterSeq 和 beforeSeq 不能同时出现，即便两个值本身都合法。
  assert.equal(schema.safeParse({ afterSeq: 1, beforeSeq: 5 }).success, false);
  assert.equal(schema.safeParse({ afterSeq: 0, beforeSeq: 0 }).success, false);
});

test("R12 conversation list query exposes one paired created-at and UUID keyset", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationListQuerySchema");
  const afterCreatedAt = "2026-07-12T08:30:00.123456Z";
  const afterId = conversationId;

  assert.deepEqual(schema.parse({}), { limit: 50 });
  assert.deepEqual(schema.parse({ afterCreatedAt, afterId, limit: "100" }), {
    afterCreatedAt,
    afterId,
    limit: 100
  });
  assert.equal(schema.safeParse({ afterCreatedAt }).success, false);
  assert.equal(schema.safeParse({ afterId }).success, false);
  assert.equal(schema.safeParse({ afterCreatedAt: "not-a-date", afterId }).success, false);
  assert.equal(
    schema.safeParse({ afterCreatedAt: "2026-07-12T08:30:00.123Z", afterId }).success,
    false
  );
  assert.equal(
    schema.safeParse({ afterCreatedAt: "2026-07-12T16:30:00.123456+08:00", afterId }).success,
    false
  );
  assert.equal(schema.safeParse({ afterCreatedAt, afterId: "not-a-uuid" }).success, false);
  assert.equal(schema.safeParse({ after_created_at: afterCreatedAt, after_id: afterId }).success, false);
  for (const limit of [0, 101, 1.5]) {
    assert.equal(schema.safeParse({ limit }).success, false);
  }
});

test("R12 AI profile and execution selectors keep their frozen value ranges", () => {
  const aiModeSchema = requiredSchema("aiModeSchema");
  const dispatchPolicySchema = requiredSchema("dispatchPolicySchema");
  const executionHintSchema = requiredSchema("executionHintSchema");

  assert.deepEqual([1, 2, 3, 4, 5].map((value) => aiModeSchema.parse(value)), [1, 2, 3, 4, 5]);
  assert.equal(aiModeSchema.safeParse(0).success, false);
  assert.equal(aiModeSchema.safeParse(6).success, false);
  assert.equal(aiModeSchema.safeParse(2.5).success, false);
  assert.deepEqual(
    ["auto", "ask", "manual"].map((value) => dispatchPolicySchema.parse(value)),
    ["auto", "ask", "manual"]
  );
  assert.deepEqual(
    ["server", "local", "any"].map((value) => executionHintSchema.parse(value)),
    ["server", "local", "any"]
  );
  assert.equal(dispatchPolicySchema.safeParse("silent").success, false);
  assert.equal(executionHintSchema.safeParse("desktop").success, false);
});

test("R12 Cuu proactivity and granular AI settings expose only frozen choices", () => {
  const cuuProactivitySchema = requiredSchema("cuuProactivitySchema");
  const aiGranularSettingsSchema = requiredSchema<Record<string, boolean>>("aiGranularSettingsSchema");
  const defaultCuuProactivity = (contracts as Record<string, unknown>)["DEFAULT_CUU_PROACTIVITY"];
  const values = (contracts as Record<string, unknown>)["CUU_PROACTIVITY_VALUES"];

  assert.deepEqual(values, ["quiet", "balanced", "proactive"]);
  assert.equal(defaultCuuProactivity, "balanced");
  assert.deepEqual(
    ["quiet", "balanced", "proactive"].map((value) => cuuProactivitySchema.parse(value)),
    ["quiet", "balanced", "proactive"]
  );
  assert.equal(cuuProactivitySchema.safeParse("silent").success, false);

  assert.deepEqual(aiGranularSettingsSchema.parse({}), {});
  assert.deepEqual(
    aiGranularSettingsSchema.parse({
      create_work_item: true,
      dispatch_run: false,
      mutate_drive: true,
      send_notification: false
    }),
    {
      create_work_item: true,
      dispatch_run: false,
      mutate_drive: true,
      send_notification: false
    }
  );
  assert.equal(aiGranularSettingsSchema.safeParse({ browse_web: true }).success, false);
  assert.equal(aiGranularSettingsSchema.safeParse({ dispatch_run: "yes" }).success, false);
});

test("R12 quiet hours are an explicit strict union with bounded unique weekdays", () => {
  const schema = requiredSchema<Record<string, unknown>>("aiQuietHoursSchema");
  const disabled = { enabled: false };
  const enabled = {
    enabled: true,
    timezone: "Asia/Singapore",
    start_minute: 1320,
    end_minute: 480,
    weekdays: [1, 2, 3, 4, 5]
  };

  assert.deepEqual(schema.parse(disabled), disabled);
  assert.deepEqual(schema.parse(enabled), enabled);
  for (const invalid of [
    {},
    { enabled: false, timezone: "UTC" },
    { ...enabled, timezone: "" },
    { ...enabled, timezone: "x".repeat(65) },
    { ...enabled, timezone: "not/a-zone" },
    { ...enabled, start_minute: -1 },
    { ...enabled, end_minute: 1440 },
    { ...enabled, start_minute: 1.5 },
    { ...enabled, start_minute: 480, end_minute: 480 },
    { ...enabled, weekdays: [] },
    { ...enabled, weekdays: [0, 1, 2, 3, 4, 5, 6, 0] },
    { ...enabled, weekdays: [1, 1] },
    { ...enabled, weekdays: [7] },
    { ...enabled, extra: true }
  ]) {
    assert.equal(schema.safeParse(invalid).success, false, `accepted malformed quiet hours: ${JSON.stringify(invalid)}`);
  }
});

test("R12 user AI profile PATCH is strict, snake-case, and nonempty", () => {
  const schema = requiredSchema<Record<string, unknown>>("patchUserAiProfileRequestSchema");
  const patch = {
    default_mode: 4,
    granular_settings: { dispatch_run: false },
    dispatch_policy: "ask",
    cuu_proactivity: "proactive",
    model_tier_preference: "premium-v2"
  };

  assert.deepEqual(schema.parse(patch), patch);
  assert.deepEqual(schema.parse({ model_tier_preference: null }), { model_tier_preference: null });
  for (const field of [
    "default_mode",
    "granular_settings",
    "dispatch_policy",
    "cuu_proactivity",
    "model_tier_preference"
  ]) {
    assert.equal(
      schema.safeParse({ [field]: undefined }).success,
      false,
      `accepted undefined-only user patch field: ${field}`
    );
  }
  for (const invalid of [
    {},
    { defaultMode: 4 },
    { dispatch_policy: "silent" },
    { granular_settings: { arbitrary: true } },
    { model_tier_preference: "" },
    { model_tier_preference: "contains spaces" },
    { model_tier_preference: "x".repeat(33) },
    { cuu_proactivity: "chatty" },
    { unknown_key: true }
  ]) {
    assert.equal(schema.safeParse(invalid).success, false, `accepted malformed user patch: ${JSON.stringify(invalid)}`);
  }
});

test("R12 project AI governance PATCH is strict, bounded, and nonempty", () => {
  const schema = requiredSchema<Record<string, unknown>>("patchProjectAiGovernanceRequestSchema");
  const patch = {
    observer_enabled: false,
    silence_window_seconds: 86400,
    quiet_hours: {
      enabled: true,
      timezone: "UTC",
      start_minute: 0,
      end_minute: 480,
      weekdays: [0, 6]
    },
    granular_settings: { create_work_item: false }
  };

  assert.deepEqual(schema.parse(patch), patch);
  for (const field of [
    "observer_enabled",
    "silence_window_seconds",
    "quiet_hours",
    "granular_settings"
  ]) {
    assert.equal(
      schema.safeParse({ [field]: undefined }).success,
      false,
      `accepted undefined-only governance patch field: ${field}`
    );
  }
  for (const invalid of [
    {},
    { observerEnabled: false },
    { silence_window_seconds: -1 },
    { silence_window_seconds: 86401 },
    { silence_window_seconds: 1.5 },
    { quiet_hours: {} },
    { quiet_hours: { enabled: true, timezone: "UTC", start_minute: 0, end_minute: 1, weekdays: [1, 1] } },
    { granular_settings: { send_email: true } },
    { unknown_key: true }
  ]) {
    assert.equal(schema.safeParse(invalid).success, false, `accepted malformed governance patch: ${JSON.stringify(invalid)}`);
  }
});

test("R12 AI settings defaults are complete shared domain values", () => {
  assert.deepEqual((contracts as Record<string, unknown>)["DEFAULT_USER_AI_PROFILE"], {
    default_mode: 3,
    granular_settings: {},
    dispatch_policy: "auto",
    cuu_proactivity: "balanced",
    model_tier_preference: null
  });
  assert.deepEqual((contracts as Record<string, unknown>)["DEFAULT_PROJECT_AI_GOVERNANCE"], {
    observer_enabled: true,
    silence_window_seconds: 60,
    quiet_hours: { enabled: false },
    granular_settings: {}
  });
});

test("R12 user AI profile VM is strict, secret-free, and separates monthly usage from the daily quota", () => {
  const schema = requiredSchema<Record<string, unknown>>("userAiProfileVmSchema");
  const value = {
    workspace_id: workspaceId,
    user_id: userId,
    default_mode: 4,
    granular_settings: { dispatch_run: false },
    dispatch_policy: "ask",
    cuu_proactivity: "proactive",
    model_tier_preference: "default",
    providers: [
      {
        name: "deepseek",
        configured: true,
        default_model_id: "default",
        models: [
          {
            id: "default",
            model: "deepseek-v4-pro",
            display_name: "DeepSeek V4 Pro",
            context_window_tokens: 128000,
            supports_streaming: true,
            supports_tools: true,
            cost_input_cny_per_mtok: 2,
            cost_output_cny_per_mtok: 8
          }
        ]
      }
    ],
    budget_summary: {
      daily_quota: {
        policy_id: "pcost-user-day-v0",
        period: "day",
        max_tokens: 500000,
        max_cost_cny: "20",
        enabled: false
      },
      usage: {
        day: {
          period: "day",
          token_in: 10,
          token_out: 2,
          total_tokens: 12,
          estimated_cost_cny: "0.1"
        },
        month: {
          period: "month",
          token_in: 100,
          token_out: 20,
          total_tokens: 120,
          estimated_cost_cny: "1.25"
        }
      }
    },
    generated_at: "2026-07-12T10:00:00.000Z",
    updated_at: null
  };
  const provider = value.providers[0]!;
  const model = provider.models[0]!;

  assert.deepEqual(schema.parse(value), value);
  assert.equal(schema.safeParse({ ...value, api_key: "secret" }).success, false);
  assert.equal(
    schema.safeParse({
      ...value,
      providers: [{ ...provider, base_url: "https://provider.invalid" }]
    }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      ...value,
      providers: [{ ...provider, models: [] }]
    }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      ...value,
      providers: [{
        ...provider,
        default_model_id: "missing",
        models: [model]
      }]
    }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      ...value,
      providers: [{
        ...provider,
        models: [model, { ...model, model: "duplicate-upstream-name" }]
      }]
    }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      ...value,
      providers: [{
        ...provider,
        models: [{ ...model, api_key: "secret" }]
      }]
    }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      ...value,
      budget_summary: {
        ...value.budget_summary,
        usage: {
          ...value.budget_summary.usage,
          month: { ...value.budget_summary.usage.month, max_tokens: 500000 }
        }
      }
    }).success,
    false
  );
});

test("R12 project AI governance VM is strict and nullable-explicit for synthesized defaults", () => {
  const schema = requiredSchema<Record<string, unknown>>("projectAiGovernanceVmSchema");
  const value = {
    project_id: projectId,
    observer_enabled: true,
    silence_window_seconds: 60,
    quiet_hours: { enabled: false },
    granular_settings: {},
    updated_at: null
  };

  assert.deepEqual(schema.parse(value), value);
  assert.equal(schema.safeParse({ ...value, owner_user_id: userId }).success, false);
  assert.equal(schema.safeParse({ ...value, quiet_hours: {} }).success, false);
});

// R14 CHAT 批（presence-observer 工包）：加了第十个事件名 conversationObserverAnalyzing——批准变更，
// 见 r14-release-readiness/01-chat-design.md §4「eventTypes 新增 4 名...r12-workbench.test.ts:1287
// 钉死清单同步扩充，属批准变更」（W1-B 只负责这四名里的 observer.analyzing 这一个）。
test("R12 conversation topics and all ten event names are formal protocol values", () => {
  const eventTopicSchema = requiredSchema<{ kind: string; topic: string; id?: string }>("eventTopicSchema");
  const eventTypes = (contracts as Record<string, unknown>)["eventTypes"] as Record<string, string> | undefined;
  assert.ok(eventTypes, "missing eventTypes export");

  assert.deepEqual(
    eventTopicSchema.parse({
      kind: "conversation",
      topic: `conversation:${conversationId}`,
      id: conversationId
    }),
    {
      kind: "conversation",
      topic: `conversation:${conversationId}`,
      id: conversationId
    }
  );
  for (const invalidTopic of [
    { kind: "conversation", topic: `conversation:${conversationId}` },
    { kind: "conversation", topic: "conversation:not-a-uuid", id: "not-a-uuid" },
    { kind: "conversation", topic: `user:${conversationId}`, id: conversationId },
    {
      kind: "conversation",
      topic: "conversation:AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"
    },
    {
      kind: "conversation",
      topic: `conversation:${conversationId}`,
      id: "30000000-0000-4000-8000-000000000099"
    }
  ]) {
    assert.equal(eventTopicSchema.safeParse(invalidTopic).success, false);
  }
  assert.deepEqual(
    {
      conversationMessageCreated: eventTypes.conversationMessageCreated,
      conversationMessageDelta: eventTypes.conversationMessageDelta,
      conversationToolBegin: eventTypes.conversationToolBegin,
      conversationToolOutputDelta: eventTypes.conversationToolOutputDelta,
      conversationToolEnd: eventTypes.conversationToolEnd,
      conversationActionCardUpdated: eventTypes.conversationActionCardUpdated,
      conversationItemStarted: eventTypes.conversationItemStarted,
      conversationItemCompleted: eventTypes.conversationItemCompleted,
      conversationPresenceTyping: eventTypes.conversationPresenceTyping,
      conversationObserverAnalyzing: eventTypes.conversationObserverAnalyzing
    },
    {
      conversationMessageCreated: "conversation.message.created",
      conversationMessageDelta: "conversation.message.delta",
      conversationToolBegin: "conversation.tool.begin",
      conversationToolOutputDelta: "conversation.tool.output_delta",
      conversationToolEnd: "conversation.tool.end",
      conversationActionCardUpdated: "conversation.action_card.updated",
      conversationItemStarted: "conversation.item.started",
      conversationItemCompleted: "conversation.item.completed",
      conversationPresenceTyping: "conversation.presence.typing",
      conversationObserverAnalyzing: "conversation.observer.analyzing"
    }
  );
});

// R14 CHAT 批（presence-observer 工包）：conversation.observer.analyzing 从「仅保留名称」升级为
// 真实 payload/校验——同 typing/message-delta/action-card-updated 同等对待，正反例分离到自己的测试。
test("R14 observer-analyzing events reserve a strict server-owned 30000ms transient contract only", () => {
  const schema = requiredSchema<Record<string, unknown>>("conversationObserverAnalyzingEventSchema");
  const event = {
    event_id: "49000000-0000-4000-8000-000000000049",
    type: "conversation.observer.analyzing",
    topic: `conversation:${conversationId}`,
    ts: "2026-07-12T08:31:00.000Z",
    actor: { actor_kind: "ai", label: "Cuu" },
    data: {
      conversation_id: conversationId,
      ttl_ms: 30000,
      expires_at: "2026-07-12T08:31:30.000Z"
    }
  };

  assert.deepEqual(schema.parse(event), event);
  for (const invalid of [
    { ...event, type: "conversation.presence.typing" },
    { ...event, topic: "conversation:30000000-0000-4000-8000-000000000099" },
    { ...event, extra: true },
    { ...event, actor: { actor_kind: "human", actor_user_id: userId } },
    { ...event, data: { ...event.data, user_id: userId } },
    { ...event, data: { ...event.data, ttl_ms: 3000 } },
    { ...event, data: { ...event.data, ttl_ms: 29999 } },
    { ...event, data: { ...event.data, expires_at: "2026-07-12T08:31:29.999Z" } }
  ]) {
    assert.equal(schema.safeParse(invalid).success, false);
  }
});

test("R12 batch 9 desktop claim requires the assignee and never accepts server work", () => {
  const schema = requiredSchema<Record<string, unknown>>("localExecutionClaimRequestSchema");

  assert.deepEqual(
    schema.parse({
      assignee_user_id: userId,
      accepted_execution_hints: ["local", "any"]
    }),
    {
      assignee_user_id: userId,
      accepted_execution_hints: ["local", "any"]
    }
  );
  assert.equal(schema.safeParse({ accepted_execution_hints: ["local"] }).success, false);
  assert.equal(
    schema.safeParse({ assignee_user_id: userId, accepted_execution_hints: ["server"] }).success,
    false
  );
  assert.equal(schema.safeParse({ assignee_user_id: userId, accepted_execution_hints: [] }).success, false);
});

test("R12 batch 9 lease carries stale-worker rejection coordinates", () => {
  const schema = requiredSchema<Record<string, unknown>>("localExecutionLeaseSchema");
  const lease = {
    run_id: runId,
    lease_token: "opaque-lease-token-01",
    lease_expires_at: "2026-07-12T05:00:00.000Z",
    recovery_generation: 4,
    recovery_attempt: 2
  };

  assert.deepEqual(schema.parse(lease), lease);
  assert.equal(schema.safeParse({ ...lease, lease_token: "" }).success, false);
  assert.equal(schema.safeParse({ ...lease, lease_expires_at: "tomorrow" }).success, false);
  assert.equal(schema.safeParse({ ...lease, recovery_generation: -1 }).success, false);
  assert.equal(schema.safeParse({ ...lease, recovery_attempt: -1 }).success, false);
});

test("R12 batch 9 artifact signature binds run, lease, hash, size, algorithm, and version", () => {
  const schema = requiredSchema<Record<string, unknown>>("localArtifactUploadSignatureSchema");
  const signedArtifact = {
    run_id: runId,
    lease_token: "opaque-lease-token-01",
    sha256: "a".repeat(64),
    size_bytes: 12_345,
    algorithm: "hmac-sha256",
    version: 1,
    signature: "b".repeat(64)
  };

  assert.deepEqual(schema.parse(signedArtifact), signedArtifact);
  const { signature: _signature, ...missingSignature } = signedArtifact;
  assert.equal(schema.safeParse(missingSignature).success, false);
  assert.equal(schema.safeParse({ ...signedArtifact, signature: "not-a-signature" }).success, false);
  assert.equal(schema.safeParse({ ...signedArtifact, sha256: "bad-hash" }).success, false);
  assert.equal(schema.safeParse({ ...signedArtifact, algorithm: "sha256" }).success, false);
  assert.equal(schema.safeParse({ ...signedArtifact, version: 2 }).success, false);
  assert.equal(schema.safeParse({ ...signedArtifact, size_bytes: Number.MAX_SAFE_INTEGER + 1 }).success, false);
});
