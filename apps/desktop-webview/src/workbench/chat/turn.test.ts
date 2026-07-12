import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendTurnDelta,
  EMPTY_TURN_DELTA_STATE,
  mapConversationTurnError,
  renderTurnDeltaText,
  shouldRequestConversationTurn
} from "./turn.js";

// —— shouldRequestConversationTurn: 这条红线锁死"主区绝不调 turns" —— //

test("shouldRequestConversationTurn allows collab conversations", () => {
  assert.equal(shouldRequestConversationTurn("collab"), true);
});

test("shouldRequestConversationTurn refuses the main conversation (observer-owned, never a turns caller)", () => {
  assert.equal(shouldRequestConversationTurn("main"), false);
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

test("mapConversationTurnError maps the observe-only mode code and points at the settings page", () => {
  const text = mapConversationTurnError({ status: 409, code: "conversation_turn_mode_observe_only" }, "zh-CN");
  assert.match(text, /设置 · AI/u);
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
