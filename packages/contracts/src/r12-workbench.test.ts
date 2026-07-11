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
const runId = "70000000-0000-4000-8000-000000000007";

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
      source_message_id: messageId
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
      content: { drive_item_id: driveItemId, snapshot_name: "brief-v3.docx" }
    }),
    {
      kind: "file_card",
      content: { drive_item_id: driveItemId, snapshot_name: "brief-v3.docx" }
    }
  );
  assert.equal(
    createConversationMessageRequestSchema.safeParse({
      kind: "file_card",
      content: { drive_item_id: driveItemId, snapshot_name: "brief-v3.docx", body: "embedded" }
    }).success,
    false
  );
});

test("R12 message cursor query uses safe integers and a bounded default", () => {
  const schema = requiredSchema<{ after_seq: number; limit: number }>("conversationMessageListQuerySchema");

  assert.deepEqual(schema.parse({}), { after_seq: 0, limit: 50 });
  assert.deepEqual(schema.parse({ after_seq: "42", limit: "100" }), { after_seq: 42, limit: 100 });
  for (const afterSeq of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(schema.safeParse({ after_seq: afterSeq }).success, false);
  }
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
