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
      participant_user_ids: []
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

test("R12 collab creation defaults and bounds unique active participant IDs", () => {
  const schema = requiredSchema<Record<string, unknown>>("createConversationRequestSchema");
  const base = {
    kind: "collab",
    title: "协作区",
    visibility: "private"
  };

  assert.deepEqual(schema.parse(base), { ...base, participant_user_ids: [] });
  assert.deepEqual(schema.parse({ ...base, participant_user_ids: [participantUserId] }), {
    ...base,
    participant_user_ids: [participantUserId]
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

test("R12 conversation topics and all nine event names are formal protocol values", () => {
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
      conversationPresenceTyping: eventTypes.conversationPresenceTyping
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
      conversationPresenceTyping: "conversation.presence.typing"
    }
  );
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
