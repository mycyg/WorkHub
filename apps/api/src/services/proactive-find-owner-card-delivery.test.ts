import assert from "node:assert/strict";
import test from "node:test";

import type { InsertSystemCardInput } from "@workhub/db";

import { createProactiveFindOwnerCardDelivery } from "./proactive-find-owner-card-delivery.js";

const now = new Date("2026-07-15T09:00:00.000Z");
const workspaceId = "d0000000-0000-4000-8000-000000000001";
const projectId = "d0000000-0000-4000-8000-000000000002";
const workItemId = "d0000000-0000-4000-8000-000000000003";
const targetUserId = "d0000000-0000-4000-8000-000000000004";
const conversationId = "d0000000-0000-4000-8000-000000000005";
const cardId = "d0000000-0000-4000-8000-000000000006";
const cardMessageId = "d0000000-0000-4000-8000-000000000007";
const cardItemId = "d0000000-0000-4000-8000-000000000008";

function insertedResult() {
  return {
    card: {
      id: cardId,
      conversationId,
      messageId: cardMessageId,
      status: "active" as const,
      origin: "system" as const,
      analyzedToSeq: null,
      createdAt: now,
      updatedAt: now
    },
    message: {
      id: cardMessageId,
      conversationId,
      seq: 7,
      senderType: "cuu",
      senderUserId: null,
      kind: "action_card",
      contentJson: {},
      threadRootId: null,
      createdAt: now
    },
    items: [
      {
        id: cardItemId,
        workspaceId,
        projectId,
        conversationId,
        actionCardId: cardId,
        ordinal: 0,
        kind: "decide" as const,
        titleMd: "「上线报价单」已逾期且无人认领",
        confidence: "high" as const,
        workItemId,
        runId: null,
        assigneeUserId: targetUserId,
        status: "waiting_decision" as const,
        undoDeadlineAt: null,
        createdAt: now,
        updatedAt: now
      }
    ]
  };
}

test("deliverFindOwnerCard inserts a single system decide card and publishes an update event", async () => {
  const insertCalls: unknown[] = [];
  const published: unknown[] = [];
  const delivery = createProactiveFindOwnerCardDelivery({
    conversations: {
      async findProjectMainConversation(input) {
        assert.equal(input.projectId, projectId);
        assert.equal(input.workspaceId, workspaceId);
        return { conversationId, projectId, title: "主区" };
      }
    },
    actionCards: {
      async insertSystemCard(input: InsertSystemCardInput) {
        insertCalls.push(input);
        return insertedResult() as never;
      }
    } as never,
    bus: { publish: async (topic, type, event) => { published.push({ topic, type, event }); } },
    logger: { warn() {} },
    now: () => now
  });

  const result = await delivery.deliverFindOwnerCard({
    workspaceId,
    projectId,
    workItemId,
    targetUserId,
    titleMd: "「上线报价单」已逾期且无人认领",
    proactiveIntentId: "intent-42"
  });

  assert.deepEqual(result, { delivered: true, conversationId });
  assert.equal(insertCalls.length, 1);
  const inserted = insertCalls[0] as {
    workspaceId: string;
    projectId: string;
    conversationId: string;
    items: Array<Record<string, unknown>>;
    messageContentExtra?: Record<string, unknown>;
  };
  assert.equal(inserted.conversationId, conversationId);
  assert.equal(inserted.items.length, 1, "find-owner card carries exactly one decide item");
  assert.equal(inserted.items[0]?.["kind"], "decide");
  assert.equal(inserted.items[0]?.["status"], "waiting_decision");
  assert.equal(inserted.items[0]?.["confidence"], "high");
  assert.equal(inserted.items[0]?.["workItemId"], workItemId);
  assert.equal(inserted.items[0]?.["assigneeUserId"], targetUserId);
  assert.equal(inserted.messageContentExtra?.["proactive_intent_id"], "intent-42");
  assert.equal(published.length, 1, "a card-updated event is broadcast");
});

test("deliverFindOwnerCard degrades (delivered:false) when the project has no main conversation", async () => {
  let insertCalled = false;
  const delivery = createProactiveFindOwnerCardDelivery({
    conversations: {
      async findProjectMainConversation() {
        return null;
      }
    },
    actionCards: {
      async insertSystemCard() {
        insertCalled = true;
        throw new Error("must not insert when there is no main conversation");
      }
    } as never,
    bus: { publish: async () => {} },
    logger: { warn() {} },
    now: () => now
  });

  const result = await delivery.deliverFindOwnerCard({
    workspaceId,
    projectId,
    workItemId,
    targetUserId,
    titleMd: "「上线报价单」已逾期且无人认领",
    proactiveIntentId: "intent-42"
  });

  assert.deepEqual(result, { delivered: false, reason: "no_main_conversation" });
  assert.equal(insertCalled, false);
});

test("deliverFindOwnerCard still reports delivered when only the broadcast fails (card is persisted)", async () => {
  const delivery = createProactiveFindOwnerCardDelivery({
    conversations: {
      async findProjectMainConversation() {
        return { conversationId, projectId, title: "主区" };
      }
    },
    actionCards: {
      async insertSystemCard() {
        return insertedResult() as never;
      }
    } as never,
    bus: { publish: async () => { throw new Error("broker down"); } },
    logger: { warn() {} },
    now: () => now
  });

  const result = await delivery.deliverFindOwnerCard({
    workspaceId,
    projectId,
    workItemId,
    targetUserId,
    titleMd: "「上线报价单」已逾期且无人认领",
    proactiveIntentId: "intent-42"
  });

  assert.deepEqual(result, { delivered: true, conversationId });
});
