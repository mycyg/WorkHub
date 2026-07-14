import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendTurnDelta,
  beginTurnPursuit,
  classifyTurnErrorOutcome,
  EMPTY_TURN_DELTA_STATE,
  EMPTY_TURN_QUEUE_STATE,
  mapConversationTurnError,
  queueTurnAnchor,
  renderTurnDeltaText,
  settleTurnPursuit,
  shouldRequestConversationTurn,
  turnQueueGiveUpText,
  TURN_QUEUE_MAX_CONSECUTIVE_BUSY_FAILURES,
  type TurnQueueState
} from "./turn.js";

// —— shouldRequestConversationTurn: 这条红线锁死"主区绝不调 turns" —— //

test("shouldRequestConversationTurn allows collab conversations", () => {
  assert.equal(shouldRequestConversationTurn("collab"), true);
});

test("shouldRequestConversationTurn refuses the main conversation (observer-owned, never a turns caller)", () => {
  assert.equal(shouldRequestConversationTurn("main"), false);
});

// —— R13 终验修复：个人空间单聊必回 —— //

test("shouldRequestConversationTurn allows the main conversation of a personal project (1:1 single chat)", () => {
  assert.equal(shouldRequestConversationTurn("main", { personalProject: true }), true);
});

test("shouldRequestConversationTurn keeps refusing team-project main even with an explicit false/undefined flag", () => {
  assert.equal(shouldRequestConversationTurn("main", { personalProject: false }), false);
  assert.equal(shouldRequestConversationTurn("main", { personalProject: undefined }), false);
  assert.equal(shouldRequestConversationTurn("main", {}), false);
});

// —— appendTurnDelta / renderTurnDeltaText —— //

test("renderTurnDeltaText on the empty state is an empty string", () => {
  assert.equal(renderTurnDeltaText(EMPTY_TURN_DELTA_STATE), "");
});

test("appendTurnDelta accumulates chunks in ordinal order regardless of arrival order", () => {
  let state = EMPTY_TURN_DELTA_STATE;
  state = appendTurnDelta(state, { turnId: "turn-1", deltaText: "world", ordinal: 1 });
  state = appendTurnDelta(state, { turnId: "turn-1", deltaText: "hello ", ordinal: 0 });
  assert.equal(renderTurnDeltaText(state), "hello world");
});

test("appendTurnDelta is idempotent for a repeated ordinal (SSE redelivery does not duplicate text)", () => {
  let state = EMPTY_TURN_DELTA_STATE;
  state = appendTurnDelta(state, { turnId: "turn-1", deltaText: "hi", ordinal: 0 });
  state = appendTurnDelta(state, { turnId: "turn-1", deltaText: "hi", ordinal: 0 });
  assert.equal(renderTurnDeltaText(state), "hi");
});

test("appendTurnDelta discards prior chunks when the turn id changes (defensive — server's lock should prevent this)", () => {
  let state = EMPTY_TURN_DELTA_STATE;
  state = appendTurnDelta(state, { turnId: "turn-1", deltaText: "stale", ordinal: 0 });
  state = appendTurnDelta(state, { turnId: "turn-2", deltaText: "fresh", ordinal: 0 });
  assert.equal(renderTurnDeltaText(state), "fresh");
});

test("appendTurnDelta does not mutate the previous state object (pure, safe to hold onto old references)", () => {
  const before = appendTurnDelta(EMPTY_TURN_DELTA_STATE, { turnId: "turn-1", deltaText: "a", ordinal: 0 });
  const after = appendTurnDelta(before, { turnId: "turn-1", deltaText: "b", ordinal: 1 });
  assert.equal(renderTurnDeltaText(before), "a");
  assert.equal(renderTurnDeltaText(after), "ab");
});

// —— mapConversationTurnError —— //

test("mapConversationTurnError maps the busy code to a gentle zh-CN notice", () => {
  assert.equal(
    mapConversationTurnError({ status: 409, code: "conversation_turn_busy" }, "zh-CN"),
    "Cuu 正忙着上一轮，等它说完再试。"
  );
});

test("mapConversationTurnError maps the observe-only mode code and points at the real mode control", () => {
  const text = mapConversationTurnError({ status: 409, code: "conversation_turn_mode_observe_only" }, "zh-CN");
  assert.match(text, /「模式」/u);
});

test("mapConversationTurnError maps the budget-exhausted code (429)", () => {
  assert.equal(
    mapConversationTurnError({ status: 429, code: "conversation_turn_budget_exhausted" }, "zh-CN"),
    "这段时间用得有点多，稍后再试。"
  );
});

test("mapConversationTurnError has an English table too", () => {
  const text = mapConversationTurnError({ status: 409, code: "conversation_turn_busy" }, "en-US");
  assert.match(text, /still finishing/u);
});

// R13 批 G1（小群）：cuu_enabled 硬闸 + 回话判定接缝的两个新错误码——温和提示，不暴露内部错误码。

test("mapConversationTurnError maps the cuu_enabled-disabled code to a gentle, honest zh-CN notice", () => {
  const text = mapConversationTurnError({ status: 409, code: "conversation_turn_cuu_disabled" }, "zh-CN");
  assert.match(text, /关掉了 Cuu/u);
  assert.doesNotMatch(text, /conversation_turn/u);
});

test("mapConversationTurnError maps the cuu_enabled-disabled code in English too", () => {
  const text = mapConversationTurnError({ status: 409, code: "conversation_turn_cuu_disabled" }, "en-US");
  assert.match(text, /turned off/u);
});

test("mapConversationTurnError maps the not-warranted respond-decider code and suggests @Cuu", () => {
  const text = mapConversationTurnError({ status: 409, code: "conversation_turn_not_warranted" }, "zh-CN");
  assert.match(text, /@Cuu/u);
  assert.doesNotMatch(text, /conversation_turn/u);
});

test("mapConversationTurnError maps the not-warranted respond-decider code in English too", () => {
  const text = mapConversationTurnError({ status: 409, code: "conversation_turn_not_warranted" }, "en-US");
  assert.match(text, /@Cuu/u);
});

test("mapConversationTurnError falls back to a generic retry notice for an unrecognized code", () => {
  assert.equal(
    mapConversationTurnError({ status: 500, code: "internal_error" }, "zh-CN"),
    "Cuu 这次没接上，你可以再说一句试试。"
  );
});

test("mapConversationTurnError falls back gracefully when there is no error source at all (e.g. a network failure)", () => {
  assert.equal(mapConversationTurnError(undefined, "zh-CN"), "Cuu 这次没接上，你可以再说一句试试。");
});

test("mapConversationTurnError never leaks a raw error code into the user-facing text", () => {
  const text = mapConversationTurnError({ status: 500, code: "conversation_turn_failed" }, "zh-CN");
  assert.doesNotMatch(text, /conversation_turn/u);
});

// —— R14 P1-11：turn 进行中发第二条消息不能被晾住 —— //
//
// 病灶复述：view.ts 过去无条件对每条落库的文本消息调 beginTurn，turn 进行中收到的第二条消息会撞服务端
// 409 conversation_turn_busy 且没有任何重试——消息被静默晾住。下面这组测试钉死 turn.ts 里那组纯状态机
// （queueTurnAnchor/beginTurnPursuit/settleTurnPursuit）承担的四条验收要求。

test("queueTurnAnchor records a message id sent while a turn is already in flight", () => {
  const state = queueTurnAnchor(EMPTY_TURN_QUEUE_STATE, "msg-2");
  assert.equal(state.pendingAnchorMessageId, "msg-2");
});

test("queueTurnAnchor only remembers the latest message — it is not a queue/list", () => {
  let state = queueTurnAnchor(EMPTY_TURN_QUEUE_STATE, "msg-2");
  state = queueTurnAnchor(state, "msg-3");
  state = queueTurnAnchor(state, "msg-4");
  assert.equal(state.pendingAnchorMessageId, "msg-4");
});

test("queueTurnAnchor does not disturb the in-flight pursuit's own busy-failure streak", () => {
  const pursuing: TurnQueueState = { pendingAnchorMessageId: undefined, pursuitMessageId: "msg-1", consecutiveBusyFailures: 2 };
  const state = queueTurnAnchor(pursuing, "msg-2");
  assert.equal(state.pursuitMessageId, "msg-1");
  assert.equal(state.consecutiveBusyFailures, 2);
  assert.equal(state.pendingAnchorMessageId, "msg-2");
});

test("settleTurnPursuit auto-requests the queued anchor once the in-flight turn settles successfully", () => {
  const state = queueTurnAnchor({ pendingAnchorMessageId: undefined, pursuitMessageId: "msg-1", consecutiveBusyFailures: 0 }, "msg-2");
  const decision = settleTurnPursuit(state, "settled");
  assert.equal(decision.action, "retry_anchor");
  assert.equal(decision.action === "retry_anchor" ? decision.messageId : undefined, "msg-2");
  // 锚点用完就清空——不会被同一条消息重复触发。
  assert.equal(decision.state.pendingAnchorMessageId, undefined);
});

test("settleTurnPursuit does nothing when a turn settles and there is no queued anchor", () => {
  const state: TurnQueueState = { pendingAnchorMessageId: undefined, pursuitMessageId: "msg-1", consecutiveBusyFailures: 0 };
  const decision = settleTurnPursuit(state, "settled");
  assert.equal(decision.action, "idle");
});

test("beginTurnPursuit resets the busy streak when pursuing a different message id", () => {
  const state: TurnQueueState = { pendingAnchorMessageId: undefined, pursuitMessageId: "msg-1", consecutiveBusyFailures: 2 };
  const next = beginTurnPursuit(state, "msg-2");
  assert.equal(next.pursuitMessageId, "msg-2");
  assert.equal(next.consecutiveBusyFailures, 0);
});

test("beginTurnPursuit keeps the busy streak when retrying the same message id", () => {
  const state: TurnQueueState = { pendingAnchorMessageId: undefined, pursuitMessageId: "msg-1", consecutiveBusyFailures: 2 };
  const next = beginTurnPursuit(state, "msg-1");
  assert.equal(next.consecutiveBusyFailures, 2);
});

test("settleTurnPursuit retries the same message on a busy failure below the retry cap", () => {
  let state = beginTurnPursuit(EMPTY_TURN_QUEUE_STATE, "msg-2");
  const decision = settleTurnPursuit(state, "busy");
  assert.equal(decision.action, "retry_same");
  assert.equal(decision.action === "retry_same" ? decision.messageId : undefined, "msg-2");
  assert.equal(decision.state.consecutiveBusyFailures, 1);
});

test("settleTurnPursuit gives up after three consecutive busy failures for the same message", () => {
  let state = beginTurnPursuit(EMPTY_TURN_QUEUE_STATE, "msg-2");
  let lastAction: string | undefined;
  for (let i = 0; i < TURN_QUEUE_MAX_CONSECUTIVE_BUSY_FAILURES; i += 1) {
    const decision = settleTurnPursuit(state, "busy");
    lastAction = decision.action;
    state = decision.state;
    if (decision.action === "retry_same") {
      // 原地重试——追的还是同一条消息，beginTurnPursuit 是 no-op（同一个 id 不重置连败计数）。
      state = beginTurnPursuit(state, decision.messageId);
    }
  }
  assert.equal(TURN_QUEUE_MAX_CONSECUTIVE_BUSY_FAILURES, 3);
  assert.equal(lastAction, "give_up");
  assert.equal(state.pursuitMessageId, undefined);
  assert.equal(state.consecutiveBusyFailures, 0);
});

test("giving up after a busy streak also drops any queued anchor rather than silently retrying a different message", () => {
  let state = beginTurnPursuit(EMPTY_TURN_QUEUE_STATE, "msg-2");
  state = queueTurnAnchor(state, "msg-3");
  for (let i = 0; i < TURN_QUEUE_MAX_CONSECUTIVE_BUSY_FAILURES; i += 1) {
    const decision = settleTurnPursuit(state, "busy");
    state = decision.state;
    if (decision.action === "retry_same") {
      state = beginTurnPursuit(state, decision.messageId);
    }
  }
  assert.equal(state.pendingAnchorMessageId, undefined);
});

test("settleTurnPursuit resets the busy streak once a retried message finally settles (non-busy)", () => {
  let state = beginTurnPursuit(EMPTY_TURN_QUEUE_STATE, "msg-2");
  state = settleTurnPursuit(state, "busy").state; // 1st busy failure
  const decision = settleTurnPursuit(state, "settled");
  assert.equal(decision.action, "idle");
  assert.equal(decision.state.consecutiveBusyFailures, 0);
});

// —— classifyTurnErrorOutcome：busy 转自动重试、not_warranted 静默、其它一律照旧展示错误文案 —— //

test("classifyTurnErrorOutcome routes conversation_turn_busy into the silent auto-retry path", () => {
  assert.equal(classifyTurnErrorOutcome("conversation_turn_busy"), "busy");
});

test("classifyTurnErrorOutcome routes conversation_turn_not_warranted to silent (not an error)", () => {
  assert.equal(classifyTurnErrorOutcome("conversation_turn_not_warranted"), "silent");
});

test("classifyTurnErrorOutcome treats every other known code as a real, displayable error", () => {
  assert.equal(classifyTurnErrorOutcome("conversation_turn_mode_observe_only"), "error");
  assert.equal(classifyTurnErrorOutcome("conversation_turn_budget_exhausted"), "error");
  assert.equal(classifyTurnErrorOutcome("conversation_turn_not_collab"), "error");
  assert.equal(classifyTurnErrorOutcome("conversation_turn_cuu_disabled"), "error");
  assert.equal(classifyTurnErrorOutcome("conversation_turn_failed"), "error");
});

test("classifyTurnErrorOutcome falls back to error for an unrecognized code or a network failure (undefined)", () => {
  assert.equal(classifyTurnErrorOutcome("internal_error"), "error");
  assert.equal(classifyTurnErrorOutcome(undefined), "error");
});

// —— turnQueueGiveUpText：连败放弃后的提示，跟"忙碌中请稍候"的文案是两句不同的话 —— //

test("turnQueueGiveUpText gives a gentle zh-CN notice distinct from the plain busy-retry text", () => {
  const text = turnQueueGiveUpText("zh-CN");
  assert.match(text, /手动|再问/u);
  assert.notEqual(text, mapConversationTurnError({ status: 409, code: "conversation_turn_busy" }, "zh-CN"));
});

test("turnQueueGiveUpText has an English table too", () => {
  const text = turnQueueGiveUpText("en-US");
  assert.match(text, /ask again/iu);
});
