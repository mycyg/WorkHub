import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationMessageVM } from "@workhub/contracts";

import {
  applyReadReceipt,
  highestMessageSeq,
  IDLE_READ_CURSOR_SEND_STATE,
  markReadCursorAcked,
  markReadCursorFailed,
  markReadCursorSent,
  readCursorSendStateFromAcked,
  readReceiptSummary,
  receiptsToCursorMap,
  shouldSendReadCursor,
  unreadDividerBeforeMessageId
} from "./read-state.js";

const me = "user-me";
const a = "user-a";
const b = "user-b";

function msg(overrides: Partial<ConversationMessageVM> & { id: string; seq: number }): ConversationMessageVM {
  return {
    conversation_id: "conv-1",
    sender_type: "user",
    sender_user_id: a,
    kind: "text",
    content: { text: `m${overrides.seq}` },
    thread_root_id: null,
    created_at: "2026-07-12T09:00:00.000000Z",
    ...overrides
  } as ConversationMessageVM;
}

test("receiptsToCursorMap builds a per-user map from raw receipts", () => {
  const map = receiptsToCursorMap([
    { user_id: a, last_read_seq: 5 },
    { user_id: b, last_read_seq: 9 }
  ]);
  assert.equal(map.get(a), 5);
  assert.equal(map.get(b), 9);
});

test("applyReadReceipt advances monotonically and returns the same ref when it would regress", () => {
  const map = receiptsToCursorMap([{ user_id: a, last_read_seq: 5 }]);
  const advanced = applyReadReceipt(map, a, 8);
  assert.equal(advanced.get(a), 8);
  const regressed = applyReadReceipt(advanced, a, 3);
  assert.equal(regressed, advanced, "a smaller value must not create a new map");
  const equal = applyReadReceipt(advanced, a, 8);
  assert.equal(equal, advanced, "an equal value must not create a new map");
});

test("applyReadReceipt inserts a brand-new user's cursor", () => {
  const map = receiptsToCursorMap([]);
  const next = applyReadReceipt(map, b, 4);
  assert.equal(next.get(b), 4);
});

test("highestMessageSeq returns the max seq, 0 for empty", () => {
  assert.equal(highestMessageSeq([]), 0);
  assert.equal(highestMessageSeq([msg({ id: "m1", seq: 3 }), msg({ id: "m2", seq: 11 }), msg({ id: "m3", seq: 7 })]), 11);
});

test("unreadDividerBeforeMessageId points at the first message from others past my cursor", () => {
  const messages = [
    msg({ id: "m1", seq: 1, sender_user_id: me }),
    msg({ id: "m2", seq: 2, sender_user_id: a }),
    msg({ id: "m3", seq: 3, sender_user_id: b })
  ];
  // I've read through seq 1; first later message from someone else is m2.
  assert.equal(unreadDividerBeforeMessageId(messages, 1, me), "m2");
});

test("unreadDividerBeforeMessageId skips my own later messages (my own message is never 'new')", () => {
  const messages = [
    msg({ id: "m1", seq: 5, sender_user_id: me }),
    msg({ id: "m2", seq: 6, sender_user_id: me }),
    msg({ id: "m3", seq: 7, sender_user_id: a })
  ];
  assert.equal(unreadDividerBeforeMessageId(messages, 5, me), "m3");
});

test("unreadDividerBeforeMessageId returns undefined when everything is read", () => {
  const messages = [msg({ id: "m1", seq: 1, sender_user_id: a }), msg({ id: "m2", seq: 2, sender_user_id: b })];
  assert.equal(unreadDividerBeforeMessageId(messages, 2, me), undefined);
});

test("readReceiptSummary counts other members whose cursor reached my last message", () => {
  const messages = [
    msg({ id: "m1", seq: 4, sender_user_id: me }),
    msg({ id: "m2", seq: 6, sender_user_id: me }),
    msg({ id: "m3", seq: 7, sender_user_id: a })
  ];
  const cursors = receiptsToCursorMap([
    { user_id: a, last_read_seq: 6 },
    { user_id: b, last_read_seq: 5 }
  ]);
  // My last message is m2 (seq 6). a read >= 6, b only reached 5 → 1/2.
  const summary = readReceiptSummary(messages, cursors, me, [a, b]);
  assert.deepEqual(summary, { messageId: "m2", readCount: 1, total: 2 });
});

test("readReceiptSummary returns undefined when there are no other members (M<1)", () => {
  const messages = [msg({ id: "m1", seq: 4, sender_user_id: me })];
  assert.equal(readReceiptSummary(messages, new Map(), me, []), undefined);
});

test("readReceiptSummary skips a deleted own message and returns undefined if that was the only one", () => {
  const messages = [msg({ id: "m1", seq: 4, sender_user_id: me, deleted_at: "2026-07-12T10:00:00.000000Z", content: { text: "" } })];
  assert.equal(readReceiptSummary(messages, new Map(), me, [a]), undefined);
});

test("readReceiptSummary returns undefined when I have not sent anything", () => {
  const messages = [msg({ id: "m1", seq: 4, sender_user_id: a })];
  assert.equal(readReceiptSummary(messages, new Map(), me, [a, b]), undefined);
});

// —— R14FIX 批 workbench BUG-05：读游标 attempted/acked 状态机 ——

test("shouldSendReadCursor only fires when highest > acked and nothing is in flight", () => {
  const idle = readCursorSendStateFromAcked(3);
  assert.equal(shouldSendReadCursor(idle, 3), false); // 已确认到 3，没有更高的可报
  assert.equal(shouldSendReadCursor(idle, 5), true);
  const inFlight = markReadCursorSent(idle, 5);
  // 在途时即便又来了更高的 seq 也先按兵不动（单一在途，落定后再自查）。
  assert.equal(shouldSendReadCursor(inFlight, 9), false);
});

test("a server ack advances acked monotonically and clears in-flight (server clamp wins)", () => {
  let state = markReadCursorSent(readCursorSendStateFromAcked(0), 9);
  // 服务端把游标夹到会话最大 seq=7（比我报的 9 小）——以它为准。
  state = markReadCursorAcked(state, 7);
  assert.deepEqual(state, { ackedSeq: 7, inFlightSeq: undefined });
  // 一个迟到的、更小的确认不回退 acked。
  state = markReadCursorAcked(markReadCursorSent(state, 8), 4);
  assert.equal(state.ackedSeq, 7);
});

test("BUG-05: a failed attempt clears in-flight WITHOUT advancing acked, so the same seq is retried", () => {
  const idle = readCursorSendStateFromAcked(2);
  assert.equal(shouldSendReadCursor(idle, 6), true);
  // 发出请求（attempted=6），随后失败。
  const inFlight = markReadCursorSent(idle, 6);
  const afterFail = markReadCursorFailed(inFlight);
  // 关键回归断言：acked 没有被推进（旧实现的病根就是这里把 6 当成"已发"永久挡住）。
  assert.equal(afterFail.ackedSeq, 2);
  assert.equal(afterFail.inFlightSeq, undefined);
  // 因此下一次触发（重获焦点/恢复网络/新消息）仍然认为 seq 6 需要重报——不再永久丢失。
  assert.equal(shouldSendReadCursor(afterFail, 6), true);
});

test("IDLE_READ_CURSOR_SEND_STATE starts at acked 0 with no in-flight request", () => {
  assert.deepEqual(IDLE_READ_CURSOR_SEND_STATE, { ackedSeq: 0, inFlightSeq: undefined });
});
