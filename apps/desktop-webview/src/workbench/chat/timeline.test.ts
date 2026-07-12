import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationMessageVM } from "@workhub/contracts";

import {
  DEFAULT_MESSAGE_RENDER_WINDOW,
  applyActionCardUpdate,
  formatMessageTime,
  groupMessagesByDay,
  sortAndDedupeMessages,
  windowRecentMessages
} from "./timeline.js";

function textMessage(input: { id: string; seq: number; text: string; createdAt: Date; senderUserId?: string }): ConversationMessageVM {
  return {
    id: input.id,
    conversation_id: "conv-1",
    seq: input.seq,
    sender_type: "user",
    sender_user_id: input.senderUserId ?? "user-1",
    kind: "text",
    content: { text: input.text },
    thread_root_id: null,
    created_at: input.createdAt.toISOString()
  };
}

test("sortAndDedupeMessages orders strictly by seq, regardless of input order", () => {
  const now = new Date(2026, 6, 12, 10, 0);
  const messages = [
    textMessage({ id: "c", seq: 3, text: "third", createdAt: now }),
    textMessage({ id: "a", seq: 1, text: "first", createdAt: now }),
    textMessage({ id: "b", seq: 2, text: "second", createdAt: now })
  ];

  const result = sortAndDedupeMessages(messages);

  assert.deepEqual(result.map((m) => m.seq), [1, 2, 3]);
});

test("sortAndDedupeMessages collapses duplicate ids (pagination overlap with a live SSE event)", () => {
  const now = new Date(2026, 6, 12, 10, 0);
  const messages = [
    textMessage({ id: "a", seq: 1, text: "from page fetch", createdAt: now }),
    textMessage({ id: "a", seq: 1, text: "from live event", createdAt: now })
  ];

  const result = sortAndDedupeMessages(messages);

  assert.equal(result.length, 1);
  assert.equal((result[0]!.content as { text: string }).text, "from live event");
});

test("groupMessagesByDay keeps same-day messages in one group, in their existing order", () => {
  const now = new Date(2026, 6, 12, 20, 0);
  const messages = sortAndDedupeMessages([
    textMessage({ id: "a", seq: 1, text: "morning", createdAt: new Date(2026, 6, 12, 9, 0) }),
    textMessage({ id: "b", seq: 2, text: "evening", createdAt: new Date(2026, 6, 12, 19, 0) })
  ]);

  const groups = groupMessagesByDay(messages, { locale: "zh-CN", now });

  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.messages.length, 2);
  assert.equal(groups[0]!.messages[0]!.id, "a");
  assert.equal(groups[0]!.messages[1]!.id, "b");
});

test("groupMessagesByDay splits into separate groups across a day boundary", () => {
  const now = new Date(2026, 6, 12, 20, 0);
  const messages = sortAndDedupeMessages([
    textMessage({ id: "a", seq: 1, text: "yesterday", createdAt: new Date(2026, 6, 11, 23, 0) }),
    textMessage({ id: "b", seq: 2, text: "today", createdAt: new Date(2026, 6, 12, 9, 0) })
  ]);

  const groups = groupMessagesByDay(messages, { locale: "zh-CN", now });

  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.messages.length, 1);
  assert.equal(groups[1]!.messages.length, 1);
  assert.notEqual(groups[0]!.dateKey, groups[1]!.dateKey);
});

test("groupMessagesByDay labels today and yesterday distinctly in zh-CN", () => {
  const now = new Date(2026, 6, 12, 20, 0);
  const messages = sortAndDedupeMessages([
    textMessage({ id: "a", seq: 1, text: "yesterday", createdAt: new Date(2026, 6, 11, 23, 0) }),
    textMessage({ id: "b", seq: 2, text: "today", createdAt: new Date(2026, 6, 12, 9, 0) })
  ]);

  const groups = groupMessagesByDay(messages, { locale: "zh-CN", now });

  assert.match(groups[0]!.label, /^昨天 ·/u);
  assert.match(groups[1]!.label, /^今天 ·/u);
});

test("groupMessagesByDay labels today and yesterday distinctly in en-US", () => {
  const now = new Date(2026, 6, 12, 20, 0);
  const messages = sortAndDedupeMessages([
    textMessage({ id: "a", seq: 1, text: "yesterday", createdAt: new Date(2026, 6, 11, 23, 0) }),
    textMessage({ id: "b", seq: 2, text: "today", createdAt: new Date(2026, 6, 12, 9, 0) })
  ]);

  const groups = groupMessagesByDay(messages, { locale: "en-US", now });

  assert.match(groups[0]!.label, /^Yesterday ·/u);
  assert.match(groups[1]!.label, /^Today ·/u);
});

test("groupMessagesByDay falls back to a full date label for older days", () => {
  const now = new Date(2026, 6, 12, 20, 0);
  const messages = sortAndDedupeMessages([
    textMessage({ id: "a", seq: 1, text: "a week ago", createdAt: new Date(2026, 6, 5, 9, 0) })
  ]);

  const groups = groupMessagesByDay(messages, { locale: "zh-CN", now });

  assert.equal(groups[0]!.label, "7月5日 · 周日");
});

test("groupMessagesByDay returns an empty list for an empty message list", () => {
  assert.deepEqual(groupMessagesByDay([], { locale: "zh-CN", now: new Date(2026, 6, 12) }), []);
});

test("formatMessageTime renders a plain 24h HH:mm, no AM/PM marker, for either locale", () => {
  const iso = new Date(2026, 6, 12, 14, 2).toISOString();
  assert.match(formatMessageTime(iso, "zh-CN"), /^\d{2}:\d{2}$/u);
  assert.match(formatMessageTime(iso, "en-US"), /^\d{2}:\d{2}$/u);
  assert.doesNotMatch(formatMessageTime(iso, "en-US"), /[AaPp][Mm]/u);
});

// —— R12 批8：消息列表窗口化（DOM 只挂载最近 N 条，不引第三方库） —— //

test("windowRecentMessages keeps every item and reports zero hidden when under the window size", () => {
  const items = [1, 2, 3];
  const result = windowRecentMessages(items, 300);
  assert.deepEqual(result, { visible: [1, 2, 3], hiddenLocalCount: 0 });
});

test("windowRecentMessages keeps only the most recent windowSize items, hiding the older ones", () => {
  const items = Array.from({ length: 320 }, (_, i) => i + 1);
  const result = windowRecentMessages(items, 300);
  assert.equal(result.hiddenLocalCount, 20);
  assert.equal(result.visible.length, 300);
  assert.equal(result.visible[0], 21);
  assert.equal(result.visible.at(-1), 320);
});

test("windowRecentMessages defaults to DEFAULT_MESSAGE_RENDER_WINDOW (300) when no size is given", () => {
  const items = Array.from({ length: 305 }, (_, i) => i);
  const result = windowRecentMessages(items);
  assert.equal(DEFAULT_MESSAGE_RENDER_WINDOW, 300);
  assert.equal(result.hiddenLocalCount, 5);
  assert.equal(result.visible.length, 300);
});

test("windowRecentMessages treats a non-positive or fractional window size defensively (floors, never negative)", () => {
  const items = [1, 2, 3];
  assert.deepEqual(windowRecentMessages(items, -5), { visible: [], hiddenLocalCount: 3 });
  assert.deepEqual(windowRecentMessages(items, 0), { visible: [], hiddenLocalCount: 3 });
  assert.deepEqual(windowRecentMessages(items, 2.9), { visible: [2, 3], hiddenLocalCount: 1 });
});

test("windowRecentMessages on an empty list is a no-op", () => {
  assert.deepEqual(windowRecentMessages([], 300), { visible: [], hiddenLocalCount: 0 });
});

// —— applyActionCardUpdate（R12 行动卡状态回流：SSE 事件条目状态合并进本地快照） —— //

function actionCardMessage(input: {
  id: string;
  seq: number;
  items: Array<{ id: string; status: string; title?: string }>;
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
        title_md: item.title ?? `条目 ${item.id}`,
        confidence: "high",
        status: item.status
      }))
    },
    thread_root_id: null,
    created_at: new Date(2026, 6, 12, 10, 0).toISOString()
  };
}

test("applyActionCardUpdate patches a matching item's status in place and reports changed", () => {
  const card = actionCardMessage({ id: "m-card", seq: 2, items: [{ id: "i1", status: "running" }, { id: "i2", status: "waiting_decision" }] });
  const other = textMessage({ id: "m-text", seq: 1, text: "hello", createdAt: new Date(2026, 6, 12, 9, 0) });

  const result = applyActionCardUpdate([other, card], { messageId: "m-card", items: [{ id: "i1", status: "undone" }] });

  assert.equal(result.changed, true);
  assert.equal(result.snapshotStale, false);
  const patched = result.messages.find((m) => m.id === "m-card")!;
  const items = (patched.content as Record<string, unknown>)["items"] as Array<{ id: string; status: string; title_md: string }>;
  assert.equal(items.length, 2); // 不删卡：条目只改状态，不增不删。
  assert.equal(items.find((i) => i.id === "i1")!.status, "undone");
  assert.equal(items.find((i) => i.id === "i1")!.title_md, "条目 i1"); // 快照的标题原样保留（事件不带 title_md）。
  assert.equal(items.find((i) => i.id === "i2")!.status, "waiting_decision");
  // 不碰别的消息。
  assert.equal(result.messages.find((m) => m.id === "m-text"), other);
});

test("applyActionCardUpdate does not mutate the input messages or the original snapshot", () => {
  const card = actionCardMessage({ id: "m-card", seq: 1, items: [{ id: "i1", status: "running" }] });
  const input = [card];

  applyActionCardUpdate(input, { messageId: "m-card", items: [{ id: "i1", status: "undone" }] });

  const originalItems = (card.content as Record<string, unknown>)["items"] as Array<{ status: string }>;
  assert.equal(originalItems[0]!.status, "running");
});

test("applyActionCardUpdate reports changed=false when statuses already match", () => {
  const card = actionCardMessage({ id: "m-card", seq: 1, items: [{ id: "i1", status: "undone" }] });

  const result = applyActionCardUpdate([card], { messageId: "m-card", items: [{ id: "i1", status: "undone" }] });

  assert.equal(result.changed, false);
  assert.equal(result.snapshotStale, false);
});

test("applyActionCardUpdate flags a stale snapshot when the event carries an item the snapshot doesn't have (observer append)", () => {
  const card = actionCardMessage({ id: "m-card", seq: 1, items: [{ id: "i1", status: "running" }] });

  const result = applyActionCardUpdate([card], {
    messageId: "m-card",
    items: [
      { id: "i1", status: "done" },
      { id: "i-new", status: "running" }
    ]
  });

  // 已知条目照改，同时报告快照过期（新条目没有 title_md，渲不出来，得补拉消息）。
  assert.equal(result.changed, true);
  assert.equal(result.snapshotStale, true);
  const items = ((result.messages[0]!.content as Record<string, unknown>)["items"] as Array<{ id: string; status: string }>);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.status, "done");
});

test("applyActionCardUpdate flags a stale snapshot when the message isn't held locally (new card, no message.created broadcast)", () => {
  const other = textMessage({ id: "m-text", seq: 1, text: "hello", createdAt: new Date(2026, 6, 12, 9, 0) });

  const result = applyActionCardUpdate([other], { messageId: "m-missing", items: [{ id: "i1", status: "running" }] });

  assert.equal(result.changed, false);
  assert.equal(result.snapshotStale, true);
  assert.equal(result.messages.length, 1);
});

test("applyActionCardUpdate ignores an action_card update aimed at a non-action_card message id", () => {
  const other = textMessage({ id: "m-text", seq: 1, text: "hello", createdAt: new Date(2026, 6, 12, 9, 0) });

  const result = applyActionCardUpdate([other], { messageId: "m-text", items: [{ id: "i1", status: "running" }] });

  // kind 不是 action_card → 视同本地没有这条卡消息：不改内容，报 stale 交给补拉。
  assert.equal(result.changed, false);
  assert.equal(result.snapshotStale, true);
});
