import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationMessageVM } from "@workhub/contracts";

import {
  applyBufferedActionCardUpdates,
  EMPTY_BUFFERED_ACTION_CARD_UPDATE_QUEUE,
  enqueueBufferedActionCardUpdate
} from "./turn-task-buffer.js";

function actionCardMessage(input: {
  id: string;
  seq: number;
  items: Array<{ id: string; status: string }>;
}): ConversationMessageVM {
  return {
    id: input.id,
    conversation_id: "conv-1",
    seq: input.seq,
    sender_type: "cuu",
    sender_user_id: null,
    kind: "action_card",
    content: {
      card_id: "card-1",
      items: input.items.map((item) => ({
        id: item.id,
        kind: "execute",
        title_md: `条目 ${item.id}`,
        confidence: "high",
        status: item.status,
        assignee_user_id: null,
        undo_deadline_at: null
      }))
    },
    thread_root_id: null,
    created_at: new Date(2026, 6, 13, 10, 0).toISOString()
  };
}

// —— enqueueBufferedActionCardUpdate —— //

test("enqueueBufferedActionCardUpdate appends to an empty queue without mutating the constant", () => {
  const next = enqueueBufferedActionCardUpdate(EMPTY_BUFFERED_ACTION_CARD_UPDATE_QUEUE, {
    messageId: "m1",
    actionCardId: "card-1",
    items: [{ id: "i1", kind: "execute", confidence: "high", status: "running" }]
  });

  assert.equal(next.length, 1);
  assert.equal(EMPTY_BUFFERED_ACTION_CARD_UPDATE_QUEUE.length, 0);
});

test("enqueueBufferedActionCardUpdate preserves arrival order across multiple calls", () => {
  let queue = EMPTY_BUFFERED_ACTION_CARD_UPDATE_QUEUE;
  queue = enqueueBufferedActionCardUpdate(queue, {
    messageId: "m1",
    actionCardId: "card-1",
    items: [{ id: "i1", kind: "execute", confidence: "high", status: "running" }]
  });
  queue = enqueueBufferedActionCardUpdate(queue, {
    messageId: "m2",
    actionCardId: "card-2",
    items: [{ id: "i2", kind: "decide", confidence: "low", status: "waiting_decision" }]
  });

  assert.deepEqual(
    queue.map((update) => update.messageId),
    ["m1", "m2"]
  );
});

// —— applyBufferedActionCardUpdates —— //

test("applyBufferedActionCardUpdates is a no-op for an empty queue", () => {
  const card = actionCardMessage({ id: "m-card", seq: 1, items: [{ id: "i1", status: "running" }] });

  const result = applyBufferedActionCardUpdates([card], EMPTY_BUFFERED_ACTION_CARD_UPDATE_QUEUE);

  assert.equal(result.changed, false);
  assert.deepEqual(result.staleMessageIds, []);
  assert.deepEqual(result.messages, [card]);
});

test("applyBufferedActionCardUpdates replays queued updates in order, converging to the same end state as applying them live", () => {
  const card = actionCardMessage({ id: "m-card", seq: 1, items: [{ id: "i1", status: "running" }] });
  let queue = EMPTY_BUFFERED_ACTION_CARD_UPDATE_QUEUE;
  // 同一个条目连续变化两次（比如认领后很快又被撤销）——重放必须按顺序叠加，最终落在最后一条上。
  queue = enqueueBufferedActionCardUpdate(queue, {
    messageId: "m-card",
    actionCardId: "card-1",
    items: [{ id: "i1", kind: "execute", confidence: "high", status: "done" }]
  });
  queue = enqueueBufferedActionCardUpdate(queue, {
    messageId: "m-card",
    actionCardId: "card-1",
    items: [{ id: "i1", kind: "execute", confidence: "high", status: "undone" }]
  });

  const result = applyBufferedActionCardUpdates([card], queue);

  assert.equal(result.changed, true);
  assert.deepEqual(result.staleMessageIds, []);
  const items = (result.messages[0]!.content as Record<string, unknown>)["items"] as Array<{ id: string; status: string }>;
  assert.equal(items.find((item) => item.id === "i1")!.status, "undone");
});

test("applyBufferedActionCardUpdates collects distinct stale message ids across the whole queue without duplicates", () => {
  let queue = EMPTY_BUFFERED_ACTION_CARD_UPDATE_QUEUE;
  // 两条都指向本地完全没有的消息——applyActionCardUpdate 对每条都会报 snapshotStale。
  queue = enqueueBufferedActionCardUpdate(queue, {
    messageId: "m-missing",
    actionCardId: "card-1",
    items: [{ id: "i1", kind: "execute", confidence: "high", status: "running" }]
  });
  queue = enqueueBufferedActionCardUpdate(queue, {
    messageId: "m-missing",
    actionCardId: "card-1",
    items: [{ id: "i1", kind: "execute", confidence: "high", status: "done" }]
  });

  const result = applyBufferedActionCardUpdates([], queue);

  assert.equal(result.changed, false);
  assert.deepEqual(result.staleMessageIds, ["m-missing"]);
});

test("applyBufferedActionCardUpdates applies updates addressed to different messages independently", () => {
  const cardA = actionCardMessage({ id: "m-a", seq: 1, items: [{ id: "ia", status: "running" }] });
  const cardB = actionCardMessage({ id: "m-b", seq: 2, items: [{ id: "ib", status: "waiting_decision" }] });
  let queue = EMPTY_BUFFERED_ACTION_CARD_UPDATE_QUEUE;
  queue = enqueueBufferedActionCardUpdate(queue, {
    messageId: "m-a",
    actionCardId: "card-a",
    items: [{ id: "ia", kind: "execute", confidence: "high", status: "done" }]
  });
  queue = enqueueBufferedActionCardUpdate(queue, {
    messageId: "m-b",
    actionCardId: "card-b",
    items: [{ id: "ib", kind: "decide", confidence: "low", status: "dismissed" }]
  });

  const result = applyBufferedActionCardUpdates([cardA, cardB], queue);

  assert.equal(result.changed, true);
  const itemsA = (result.messages.find((m) => m.id === "m-a")!.content as Record<string, unknown>)["items"] as Array<{
    id: string;
    status: string;
  }>;
  const itemsB = (result.messages.find((m) => m.id === "m-b")!.content as Record<string, unknown>)["items"] as Array<{
    id: string;
    status: string;
  }>;
  assert.equal(itemsA.find((item) => item.id === "ia")!.status, "done");
  assert.equal(itemsB.find((item) => item.id === "ib")!.status, "dismissed");
});
