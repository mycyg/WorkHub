import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationMessageRow, CreateCuuMessageInput } from "@workhub/db";

import { createProactiveCuuDelivery } from "./proactive-cuu-delivery.js";

const workspaceId = "b0000000-0000-4000-8000-000000000001";
const targetUserId = "b0000000-0000-4000-8000-000000000002";
const projectId = "b0000000-0000-4000-8000-000000000003";
// 会话 id 用小写 uuid：模块用 topics.conversation(id.toLowerCase()) 建 topic，事件 schema 会校验
// topic === `conversation:${data.conversation_id}`，故 VM 的 conversation_id 也必须是这个小写值。
const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const intentId = "b0000000-0000-4000-8000-00000000000f";
const at = new Date("2026-07-15T14:00:00.000Z");

function cuuRow(input: Extract<CreateCuuMessageInput, { kind: "text" }>): ConversationMessageRow {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    conversationId: input.conversationId,
    seq: 7,
    senderType: "cuu",
    senderUserId: null,
    kind: "text",
    contentJson: input.contentJson as unknown as ConversationMessageRow["contentJson"],
    threadRootId: null,
    editedAt: null,
    deletedAt: null,
    deletedByUserId: null,
    replyToMessageId: null,
    pinnedAt: null,
    pinnedByUserId: null,
    createdAt: input.at ?? at
  };
}

function harness(personalMain: { conversationId: string; projectId: string; title: string } | null) {
  const createCalls: CreateCuuMessageInput[] = [];
  const published: Array<{ topic: string; type: string; data: unknown }> = [];
  const delivery = createProactiveCuuDelivery({
    conversations: {
      async findPersonalMainConversation() {
        return personalMain;
      },
      async createCuuMessage(input) {
        createCalls.push(input);
        if (input.kind !== "text") {
          throw new Error("test only exercises text messages");
        }
        return cuuRow(input);
      }
    },
    bus: {
      async publish(topic, type, data) {
        published.push({ topic, type, data });
      }
    },
    logger: { warn() {} },
    now: () => at
  });
  return { delivery, createCalls, published };
}

test("deliverCuuMessage: persists a Cuu text message carrying the intent id and broadcasts it", async () => {
  const { delivery, createCalls, published } = harness({ conversationId, projectId, title: "我的空间" });
  const result = await delivery.deliverCuuMessage({
    workspaceId,
    targetUserId,
    text: "提醒一下：「上线报价单」明天就到期了。",
    proactiveIntentId: intentId
  });

  assert.deepEqual(result, { delivered: true, conversationId });
  assert.equal(createCalls.length, 1);
  const created = createCalls[0]!;
  assert.equal(created.conversationId, conversationId);
  assert.equal(created.kind, "text");
  assert.equal((created.contentJson as { text: string }).text, "提醒一下：「上线报价单」明天就到期了。");
  assert.equal((created.contentJson as { proactive_intent_id?: string }).proactive_intent_id, intentId);

  // SSE 广播：一条 conversation.message.created，data 是 Cuu 文本消息 VM 且 content 带 intent id。
  assert.equal(published.length, 1);
  assert.equal(published[0]!.type, "conversation.message.created");
  assert.equal(published[0]!.topic, `conversation:${conversationId}`);
  // 第三个 publish 参数是整条 WorkHubEvent，消息 VM 在其 .data 字段上。
  const event = published[0]!.data as {
    actor: { actor_kind: string };
    data: { sender_type: string; content: { proactive_intent_id?: string } };
  };
  assert.equal(event.actor.actor_kind, "ai");
  assert.equal(event.data.sender_type, "cuu");
  assert.equal(event.data.content.proactive_intent_id, intentId);
});

test("deliverCuuMessage: degrades (no persist, no broadcast) when the target has no personal space", async () => {
  const { delivery, createCalls, published } = harness(null);
  const result = await delivery.deliverCuuMessage({
    workspaceId,
    targetUserId,
    text: "提醒一下：「上线报价单」明天就到期了。",
    proactiveIntentId: intentId
  });

  assert.deepEqual(result, { delivered: false, reason: "no_personal_space" });
  assert.equal(createCalls.length, 0, "no personal space → nothing is written");
  assert.equal(published.length, 0, "no personal space → nothing is broadcast");
});

test("deliverCuuMessage: a broadcast failure still counts as delivered (message is already persisted)", async () => {
  const createCalls: CreateCuuMessageInput[] = [];
  const delivery = createProactiveCuuDelivery({
    conversations: {
      async findPersonalMainConversation() {
        return { conversationId, projectId, title: "我的空间" };
      },
      async createCuuMessage(input) {
        createCalls.push(input);
        if (input.kind !== "text") {
          throw new Error("test only exercises text messages");
        }
        return cuuRow(input);
      }
    },
    bus: {
      async publish() {
        throw new Error("broker down");
      }
    },
    logger: { warn() {} },
    now: () => at
  });
  const result = await delivery.deliverCuuMessage({
    workspaceId,
    targetUserId,
    text: "提醒一下：「上线报价单」已经逾期了。",
    proactiveIntentId: intentId
  });
  assert.deepEqual(result, { delivered: true, conversationId }, "persist success is the source of truth; broadcast is best-effort");
  assert.equal(createCalls.length, 1);
});
