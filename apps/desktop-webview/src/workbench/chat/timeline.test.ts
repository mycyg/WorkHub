import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationMessageVM } from "@workhub/contracts";

import {
  DEFAULT_MESSAGE_RENDER_WINDOW,
  MAX_MESSAGE_RENDER_WINDOW,
  applyActionCardItemFeedbackUpdate,
  applyActionCardUpdate,
  applyMessageFeedbackUpdate,
  applyMessageReplacement,
  applyReactionUpdate,
  capRenderWindowSize,
  computeUndoRemainingMinutes,
  findActionCardItemFeedbackVerdict,
  findActionCardMessageIdByTitle,
  findActionCardMessageIdForItem,
  formatMessageTime,
  groupMessagesByDay,
  maybeShrinkRenderWindowSize,
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

// —— R14 批 PERF（切片②）：渲染窗封顶 + 回缩（capRenderWindowSize / maybeShrinkRenderWindowSize） —— //

test("capRenderWindowSize leaves a size at or under the cap untouched", () => {
  assert.equal(capRenderWindowSize(300), 300);
  assert.equal(capRenderWindowSize(MAX_MESSAGE_RENDER_WINDOW), MAX_MESSAGE_RENDER_WINDOW);
  assert.equal(MAX_MESSAGE_RENDER_WINDOW, 900);
});

test("capRenderWindowSize truncates any growth beyond the 900 cap", () => {
  assert.equal(capRenderWindowSize(MAX_MESSAGE_RENDER_WINDOW + 150), 900);
  assert.equal(capRenderWindowSize(5000), 900);
});

test("capRenderWindowSize honours a custom cap (jumpToMessage keeps its own uncapped path in view.ts)", () => {
  assert.equal(capRenderWindowSize(500, 400), 400);
  assert.equal(capRenderWindowSize(300, 400), 300);
});

test("maybeShrinkRenderWindowSize reclaims an expanded window back to the default when the user is at the bottom", () => {
  assert.equal(maybeShrinkRenderWindowSize(900, true), DEFAULT_MESSAGE_RENDER_WINDOW);
  assert.equal(maybeShrinkRenderWindowSize(450, true), 300);
});

test("maybeShrinkRenderWindowSize does not shrink while the user is reading history (not near bottom)", () => {
  assert.equal(maybeShrinkRenderWindowSize(900, false), 900);
});

test("maybeShrinkRenderWindowSize is a no-op when the window is already at (or under) the default", () => {
  assert.equal(maybeShrinkRenderWindowSize(300, true), 300);
  assert.equal(maybeShrinkRenderWindowSize(150, true), 150);
});

test("maybeShrinkRenderWindowSize honours a custom fallback", () => {
  assert.equal(maybeShrinkRenderWindowSize(900, true, 500), 500);
  assert.equal(maybeShrinkRenderWindowSize(400, true, 500), 400);
});

// —— applyActionCardUpdate（R12 行动卡状态回流：SSE 事件条目状态合并进本地快照） —— //

function actionCardMessage(input: {
  id: string;
  seq: number;
  items: Array<{
    id: string;
    status: string;
    title?: string;
    assigneeUserId?: string | null;
    undoDeadlineAt?: string | null;
  }>;
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
        status: item.status,
        assignee_user_id: item.assigneeUserId ?? null,
        undo_deadline_at: item.undoDeadlineAt ?? null
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

// R12 P0-A1：decide/undo 的 HTTP 响应（ActionCardItemVM）落地到本地快照——assigneeUserId/undoDeadlineAt
// 是可选字段，SSE 那条既有路径完全不传，行为必须保持原样（上面几条已覆盖）；这里覆盖新增的合并分支。

test("applyActionCardUpdate merges assigneeUserId and undoDeadlineAt when the caller provides them (decide/undo HTTP response path)", () => {
  const card = actionCardMessage({
    id: "m-card",
    seq: 1,
    items: [{ id: "i1", status: "waiting_decision", assigneeUserId: "user-1", undoDeadlineAt: null }]
  });

  const result = applyActionCardUpdate([card], {
    messageId: "m-card",
    items: [{ id: "i1", status: "running", assigneeUserId: "user-2", undoDeadlineAt: "2026-07-12T09:10:00.000Z" }]
  });

  assert.equal(result.changed, true);
  const items = (result.messages[0]!.content as Record<string, unknown>)["items"] as Array<Record<string, unknown>>;
  assert.equal(items[0]!["status"], "running");
  assert.equal(items[0]!["assignee_user_id"], "user-2");
  assert.equal(items[0]!["undo_deadline_at"], "2026-07-12T09:10:00.000Z");
});

test("applyActionCardUpdate treats a status-only patch (SSE shape) as a no-op for assignee/undo-deadline fields", () => {
  const card = actionCardMessage({
    id: "m-card",
    seq: 1,
    items: [{ id: "i1", status: "running", assigneeUserId: "user-1", undoDeadlineAt: "2026-07-12T09:10:00.000Z" }]
  });

  const result = applyActionCardUpdate([card], { messageId: "m-card", items: [{ id: "i1", status: "done" }] });

  assert.equal(result.changed, true);
  const items = (result.messages[0]!.content as Record<string, unknown>)["items"] as Array<Record<string, unknown>>;
  assert.equal(items[0]!["status"], "done");
  // assigneeUserId/undoDeadlineAt 没在 patch 里出现（undefined）——保持原值，不被清空成 null。
  assert.equal(items[0]!["assignee_user_id"], "user-1");
  assert.equal(items[0]!["undo_deadline_at"], "2026-07-12T09:10:00.000Z");
});

test("applyActionCardUpdate reports changed=true when only assigneeUserId changes and status stays the same", () => {
  const card = actionCardMessage({
    id: "m-card",
    seq: 1,
    items: [{ id: "i1", status: "waiting_decision", assigneeUserId: "user-1" }]
  });

  const result = applyActionCardUpdate([card], {
    messageId: "m-card",
    items: [{ id: "i1", status: "waiting_decision", assigneeUserId: "user-2" }]
  });

  assert.equal(result.changed, true);
  const items = (result.messages[0]!.content as Record<string, unknown>)["items"] as Array<Record<string, unknown>>;
  assert.equal(items[0]!["assignee_user_id"], "user-2");
});

// —— findActionCardMessageIdForItem —— //

test("findActionCardMessageIdForItem locates the action_card message that holds a given item id", () => {
  const cardA = actionCardMessage({ id: "m-card-a", seq: 1, items: [{ id: "i1", status: "running" }] });
  const cardB = actionCardMessage({ id: "m-card-b", seq: 2, items: [{ id: "i2", status: "waiting_decision" }] });

  assert.equal(findActionCardMessageIdForItem([cardA, cardB], "i2"), "m-card-b");
  assert.equal(findActionCardMessageIdForItem([cardA, cardB], "i1"), "m-card-a");
});

test("findActionCardMessageIdForItem returns undefined when no local message holds the item (not yet loaded/paged in)", () => {
  const cardA = actionCardMessage({ id: "m-card-a", seq: 1, items: [{ id: "i1", status: "running" }] });
  const other = textMessage({ id: "m-text", seq: 2, text: "hi", createdAt: new Date(2026, 6, 12, 9, 0) });

  assert.equal(findActionCardMessageIdForItem([cardA, other], "missing-item"), undefined);
});

// —— findActionCardMessageIdByTitle (R13 批 P2：dispatch_ask 追赶提醒的"跳到对应行动卡"最佳努力匹配) —— //

test("findActionCardMessageIdByTitle locates the action_card message holding an item with the exact title", () => {
  const cardA = actionCardMessage({ id: "m-card-a", seq: 1, items: [{ id: "i1", status: "running", title: "重写第三节" }] });
  const cardB = actionCardMessage({ id: "m-card-b", seq: 2, items: [{ id: "i2", status: "waiting_decision", title: "预算是否砍半" }] });

  assert.equal(findActionCardMessageIdByTitle([cardA, cardB], "预算是否砍半"), "m-card-b");
  assert.equal(findActionCardMessageIdByTitle([cardA, cardB], "重写第三节"), "m-card-a");
});

test("findActionCardMessageIdByTitle returns undefined when no local action_card item has that exact title", () => {
  const cardA = actionCardMessage({ id: "m-card-a", seq: 1, items: [{ id: "i1", status: "running", title: "重写第三节" }] });
  const other = textMessage({ id: "m-text", seq: 2, text: "hi", createdAt: new Date(2026, 6, 12, 9, 0) });

  assert.equal(findActionCardMessageIdByTitle([cardA, other], "从没建过的标题"), undefined);
});

test("findActionCardMessageIdByTitle does not partial-match — a substring of the real title is not enough", () => {
  const cardA = actionCardMessage({ id: "m-card-a", seq: 1, items: [{ id: "i1", status: "running", title: "重写选题报告第三节" }] });
  assert.equal(findActionCardMessageIdByTitle([cardA], "重写选题报告"), undefined);
});

test("findActionCardMessageIdByTitle ignores a blank title instead of matching the first card by accident", () => {
  const cardA = actionCardMessage({ id: "m-card-a", seq: 1, items: [{ id: "i1", status: "running", title: "" }] });
  assert.equal(findActionCardMessageIdByTitle([cardA], "   "), undefined);
});

// —— computeUndoRemainingMinutes —— //

test("computeUndoRemainingMinutes rounds up to the nearest minute so a near-expiry deadline doesn't read as 0", () => {
  const now = Date.parse("2026-07-12T09:00:00.000Z");
  const deadline = "2026-07-12T09:00:05.000Z"; // 5 seconds out
  assert.equal(computeUndoRemainingMinutes(deadline, now), 1);
});

test("computeUndoRemainingMinutes returns the exact minute count for a round interval", () => {
  const now = Date.parse("2026-07-12T09:00:00.000Z");
  const deadline = "2026-07-12T09:09:00.000Z";
  assert.equal(computeUndoRemainingMinutes(deadline, now), 9);
});

test("computeUndoRemainingMinutes returns undefined once the deadline has passed", () => {
  const now = Date.parse("2026-07-12T09:10:00.000Z");
  const deadline = "2026-07-12T09:09:59.000Z";
  assert.equal(computeUndoRemainingMinutes(deadline, now), undefined);
});

test("computeUndoRemainingMinutes returns undefined exactly at the deadline (not still-undoable)", () => {
  const now = Date.parse("2026-07-12T09:09:00.000Z");
  const deadline = "2026-07-12T09:09:00.000Z";
  assert.equal(computeUndoRemainingMinutes(deadline, now), undefined);
});

test("computeUndoRemainingMinutes returns undefined for an unparseable timestamp", () => {
  assert.equal(computeUndoRemainingMinutes("not-a-date", Date.now()), undefined);
});

// —— R14 批 CHAT：applyMessageReplacement（编辑/删除/置顶回流） —— //

const now = new Date("2026-07-12T09:00:00.000Z");

test("applyMessageReplacement swaps a message in place by id and reports changed", () => {
  const messages = [
    textMessage({ id: "m1", seq: 1, text: "one", createdAt: now }),
    textMessage({ id: "m2", seq: 2, text: "two", createdAt: now })
  ];
  const edited = { ...textMessage({ id: "m2", seq: 2, text: "two-edited", createdAt: now }), edited_at: now.toISOString() };
  const result = applyMessageReplacement(messages, edited);
  assert.equal(result.changed, true);
  assert.equal(result.unknownId, false);
  assert.equal((result.messages[1] as { content: { text: string } }).content.text, "two-edited");
  assert.equal(result.messages[0]!.id, "m1", "other messages are untouched");
});

test("applyMessageReplacement reports unknownId when the message is not local (needs a refetch)", () => {
  const messages = [textMessage({ id: "m1", seq: 1, text: "one", createdAt: now })];
  const stranger = textMessage({ id: "m99", seq: 5, text: "later", createdAt: now });
  const result = applyMessageReplacement(messages, stranger);
  assert.equal(result.changed, false);
  assert.equal(result.unknownId, true);
});

test("applyMessageReplacement reports changed=false for a byte-identical replacement", () => {
  const messages = [textMessage({ id: "m1", seq: 1, text: "one", createdAt: now })];
  const same = textMessage({ id: "m1", seq: 1, text: "one", createdAt: now });
  const result = applyMessageReplacement(messages, same);
  assert.equal(result.changed, false);
  assert.equal(result.unknownId, false);
});

// —— R14 批 CHAT：applyReactionUpdate（全量聚合幂等替换） —— //

test("applyReactionUpdate overwrites the target message's reactions with the aggregate", () => {
  const messages = [textMessage({ id: "m1", seq: 1, text: "one", createdAt: now })];
  const result = applyReactionUpdate(messages, { messageId: "m1", reactions: [{ key: "approve", user_ids: ["u1", "u2"] }] });
  assert.equal(result.changed, true);
  assert.deepEqual(result.messages[0]!.reactions, [{ key: "approve", user_ids: ["u1", "u2"] }]);
});

test("applyReactionUpdate writes an empty array (all reactions cleared), not a stale one", () => {
  const messages = [{ ...textMessage({ id: "m1", seq: 1, text: "one", createdAt: now }), reactions: [{ key: "approve" as const, user_ids: ["u1"] }] }];
  const result = applyReactionUpdate(messages, { messageId: "m1", reactions: [] });
  assert.equal(result.changed, true);
  assert.deepEqual(result.messages[0]!.reactions, []);
});

test("applyReactionUpdate reports unknownId for a message not in the local window", () => {
  const messages = [textMessage({ id: "m1", seq: 1, text: "one", createdAt: now })];
  const result = applyReactionUpdate(messages, { messageId: "m99", reactions: [{ key: "watch", user_ids: ["u1"] }] });
  assert.equal(result.changed, false);
  assert.equal(result.unknownId, true);
});

test("applyReactionUpdate reports changed=false when the aggregate is identical", () => {
  const messages = [{ ...textMessage({ id: "m1", seq: 1, text: "one", createdAt: now }), reactions: [{ key: "done" as const, user_ids: ["u1"] }] }];
  const result = applyReactionUpdate(messages, { messageId: "m1", reactions: [{ key: "done", user_ids: ["u1"] }] });
  assert.equal(result.changed, false);
  assert.equal(result.unknownId, false);
});

// —— R14 批 FEEDBACK：applyMessageFeedbackUpdate（本人对 Cuu 文字消息的反馈，乐观落地） —— //

function cuuTextMessage(input: { id: string; seq: number; text: string; createdAt: Date }): ConversationMessageVM {
  return {
    id: input.id,
    conversation_id: "conv-1",
    seq: input.seq,
    sender_type: "cuu",
    sender_user_id: null,
    kind: "text",
    content: { text: input.text },
    thread_root_id: null,
    created_at: input.createdAt.toISOString()
  };
}

test("applyMessageFeedbackUpdate sets my_feedback on a message that had none", () => {
  const messages = [cuuTextMessage({ id: "m1", seq: 1, text: "看过了", createdAt: now })];
  const result = applyMessageFeedbackUpdate(messages, {
    messageId: "m1",
    feedback: { verdict: "useful", updated_at: now.toISOString() }
  });
  assert.equal(result.changed, true);
  assert.equal(result.unknownId, false);
  assert.deepEqual(result.messages[0]!.my_feedback, { verdict: "useful", updated_at: now.toISOString() });
});

test("applyMessageFeedbackUpdate clears my_feedback entirely (key gone, not set to undefined) on delete", () => {
  const withFeedback = { ...cuuTextMessage({ id: "m1", seq: 1, text: "看过了", createdAt: now }), my_feedback: { verdict: "useful" as const, updated_at: now.toISOString() } };
  const result = applyMessageFeedbackUpdate([withFeedback], { messageId: "m1", feedback: undefined });
  assert.equal(result.changed, true);
  assert.equal("my_feedback" in result.messages[0]!, false);
});

test("applyMessageFeedbackUpdate overwrites useful with not_useful in one step", () => {
  const withFeedback = { ...cuuTextMessage({ id: "m1", seq: 1, text: "看过了", createdAt: now }), my_feedback: { verdict: "useful" as const, updated_at: now.toISOString() } };
  const result = applyMessageFeedbackUpdate([withFeedback], {
    messageId: "m1",
    feedback: { verdict: "not_useful", updated_at: "2026-07-14T00:00:00.000000Z" }
  });
  assert.equal(result.changed, true);
  assert.equal(result.messages[0]!.my_feedback?.verdict, "not_useful");
});

test("applyMessageFeedbackUpdate reports unknownId for a message not in the local window", () => {
  const messages = [cuuTextMessage({ id: "m1", seq: 1, text: "看过了", createdAt: now })];
  const result = applyMessageFeedbackUpdate(messages, { messageId: "m99", feedback: { verdict: "useful", updated_at: now.toISOString() } });
  assert.equal(result.changed, false);
  assert.equal(result.unknownId, true);
});

test("applyMessageFeedbackUpdate reports changed=false when the feedback is identical", () => {
  const withFeedback = { ...cuuTextMessage({ id: "m1", seq: 1, text: "看过了", createdAt: now }), my_feedback: { verdict: "useful" as const, updated_at: "2026-07-14T00:00:00.000000Z" } };
  const result = applyMessageFeedbackUpdate([withFeedback], {
    messageId: "m1",
    feedback: { verdict: "useful", updated_at: "2026-07-14T00:00:00.000000Z" }
  });
  assert.equal(result.changed, false);
  assert.equal(result.unknownId, false);
});

// —— R14 批 FEEDBACK：applyActionCardItemFeedbackUpdate / findActionCardItemFeedbackVerdict —— //

test("applyActionCardItemFeedbackUpdate sets a matching item's feedback in place, leaving siblings untouched", () => {
  const card = actionCardMessage({ id: "m-card", seq: 2, items: [{ id: "i1", status: "done" }, { id: "i2", status: "done" }] });
  const result = applyActionCardItemFeedbackUpdate([card], { itemId: "i1", feedback: { verdict: "useful" } });
  assert.equal(result.changed, true);
  const items = (result.messages[0]!.content as { items: Array<Record<string, unknown>> }).items;
  assert.deepEqual(items[0]!["feedback"], { verdict: "useful" });
  assert.equal("feedback" in items[1]!, false);
});

test("applyActionCardItemFeedbackUpdate clears feedback (key removed) on delete", () => {
  const card = actionCardMessage({ id: "m-card", seq: 2, items: [{ id: "i1", status: "done" }] });
  const withFeedback = {
    ...card,
    content: { ...card.content, items: [{ ...(card.content as { items: Array<Record<string, unknown>> }).items[0]!, feedback: { verdict: "useful" } }] }
  } as ConversationMessageVM;
  const result = applyActionCardItemFeedbackUpdate([withFeedback], { itemId: "i1", feedback: undefined });
  assert.equal(result.changed, true);
  const items = (result.messages[0]!.content as { items: Array<Record<string, unknown>> }).items;
  assert.equal("feedback" in items[0]!, false);
});

test("applyActionCardItemFeedbackUpdate reports unknownId when no local action_card message holds the item", () => {
  const other = textMessage({ id: "m-text", seq: 1, text: "hello", createdAt: now });
  const result = applyActionCardItemFeedbackUpdate([other], { itemId: "i-missing", feedback: { verdict: "useful" } });
  assert.equal(result.changed, false);
  assert.equal(result.unknownId, true);
});

test("findActionCardItemFeedbackVerdict reads back the verdict of a specific item, ignoring others", () => {
  const card = actionCardMessage({ id: "m-card", seq: 2, items: [{ id: "i1", status: "done" }, { id: "i2", status: "done" }] });
  const withFeedback = applyActionCardItemFeedbackUpdate([card], { itemId: "i1", feedback: { verdict: "not_useful" } }).messages[0]!;
  assert.equal(findActionCardItemFeedbackVerdict([withFeedback], "i1"), "not_useful");
  assert.equal(findActionCardItemFeedbackVerdict([withFeedback], "i2"), undefined);
});

test("findActionCardItemFeedbackVerdict returns undefined for an item that isn't held locally", () => {
  const card = actionCardMessage({ id: "m-card", seq: 2, items: [{ id: "i1", status: "done" }] });
  assert.equal(findActionCardItemFeedbackVerdict([card], "i-missing"), undefined);
});
