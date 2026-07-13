import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REPLY_JUDGE_MERGE_WINDOW_MS,
  isAlreadyJudgedMessage,
  shouldEvaluateReplyJudgeNow
} from "./throttle.js";

test("shouldEvaluateReplyJudgeNow withholds evaluation while inside the merge window", () => {
  const lastMessageCreatedAtMs = 1_000_000;
  assert.equal(
    shouldEvaluateReplyJudgeNow({ lastMessageCreatedAtMs, nowMs: lastMessageCreatedAtMs + 5_000 }),
    false
  );
});

test("shouldEvaluateReplyJudgeNow allows evaluation once the merge window has fully elapsed", () => {
  const lastMessageCreatedAtMs = 1_000_000;
  assert.equal(
    shouldEvaluateReplyJudgeNow({
      lastMessageCreatedAtMs,
      nowMs: lastMessageCreatedAtMs + DEFAULT_REPLY_JUDGE_MERGE_WINDOW_MS
    }),
    true
  );
});

test("shouldEvaluateReplyJudgeNow honors a custom merge window", () => {
  const lastMessageCreatedAtMs = 1_000_000;
  assert.equal(
    shouldEvaluateReplyJudgeNow({ lastMessageCreatedAtMs, nowMs: lastMessageCreatedAtMs + 10_000, mergeWindowMs: 5_000 }),
    true
  );
});

test("isAlreadyJudgedMessage recognizes a repeat of the last judged message id", () => {
  assert.equal(isAlreadyJudgedMessage({ lastJudgedMessageId: "m1", candidateMessageId: "m1" }), true);
});

test("isAlreadyJudgedMessage allows a new message id through, including the first-ever evaluation", () => {
  assert.equal(isAlreadyJudgedMessage({ lastJudgedMessageId: "m1", candidateMessageId: "m2" }), false);
  assert.equal(isAlreadyJudgedMessage({ lastJudgedMessageId: undefined, candidateMessageId: "m1" }), false);
});
