import assert from "node:assert/strict";
import test from "node:test";

import { judgeReply } from "./judge.js";

function boomingClassifier(): never {
  throw new Error("classifyWithLlm must not be called");
}

test("judgeReply: cuu_enabled=false wins over everything, even an explicit @mention", async () => {
  const verdict = await judgeReply({
    cuuEnabled: false,
    participantCount: 5,
    text: "@Cuu 帮我看看这个",
    classifyWithLlm: boomingClassifier
  });
  assert.deepEqual(verdict, { shouldReply: false, reason: "cuu_disabled", source: "gate" });
});

test("judgeReply: single participant (1:1) always replies, without consulting rules or the LLM", async () => {
  const verdict = await judgeReply({
    cuuEnabled: true,
    participantCount: 1,
    text: "哈哈哈",
    classifyWithLlm: boomingClassifier
  });
  assert.deepEqual(verdict, { shouldReply: true, reason: "single_participant", source: "gate" });
});

test("judgeReply: single participant with participantCount=0 also short-circuits to reply", async () => {
  const verdict = await judgeReply({ cuuEnabled: true, participantCount: 0, text: "嗯", classifyWithLlm: boomingClassifier });
  assert.equal(verdict.shouldReply, true);
  assert.equal(verdict.reason, "single_participant");
});

test("judgeReply: an @mention in a group resolves to reply via the rule tier, no LLM call", async () => {
  const verdict = await judgeReply({
    cuuEnabled: true,
    participantCount: 3,
    text: "@Cuu 麻烦看一下这个",
    classifyWithLlm: boomingClassifier
  });
  assert.deepEqual(verdict, { shouldReply: true, reason: "mentioned", source: "rule" });
});

test("judgeReply: an imperative request without a mention resolves to reply via the rule tier", async () => {
  const verdict = await judgeReply({
    cuuEnabled: true,
    participantCount: 4,
    text: "帮我找一下上次的合同",
    classifyWithLlm: boomingClassifier
  });
  assert.deepEqual(verdict, { shouldReply: true, reason: "rule_imperative", source: "rule" });
});

test("judgeReply: pure chitchat without a mention resolves to silent via the rule tier", async () => {
  const verdict = await judgeReply({
    cuuEnabled: true,
    participantCount: 4,
    text: "哈哈哈",
    classifyWithLlm: boomingClassifier
  });
  assert.deepEqual(verdict, { shouldReply: false, reason: "rule_chitchat", source: "rule" });
});

test("judgeReply: ambiguous prose falls to the LLM tier and honors a should_reply=true classification", async () => {
  const calls: unknown[] = [];
  const verdict = await judgeReply({
    cuuEnabled: true,
    participantCount: 4,
    text: "这个方案我觉得还需要再打磨一下细节部分的措辞",
    recentMessages: [{ senderLabel: "阿曼", text: "大家怎么看这版方案" }],
    async classifyWithLlm(classifyInput) {
      calls.push(classifyInput);
      return { shouldReply: true, reason: "有分歧要收敛" };
    }
  });
  assert.deepEqual(verdict, { shouldReply: true, reason: "llm_yes", source: "llm" });
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0] as { recentMessages: unknown[] }).recentMessages, [
    { senderLabel: "阿曼", text: "大家怎么看这版方案" }
  ]);
});

test("judgeReply: ambiguous prose honors a should_reply=false classification", async () => {
  const verdict = await judgeReply({
    cuuEnabled: true,
    participantCount: 4,
    text: "这个方案我觉得还需要再打磨一下细节部分的措辞",
    async classifyWithLlm() {
      return { shouldReply: false };
    }
  });
  assert.deepEqual(verdict, { shouldReply: false, reason: "llm_no", source: "llm" });
});

test("judgeReply: ambiguous prose with no classifier wired defaults to silent, not a crash", async () => {
  const verdict = await judgeReply({
    cuuEnabled: true,
    participantCount: 4,
    text: "这个方案我觉得还需要再打磨一下细节部分的措辞"
  });
  assert.deepEqual(verdict, { shouldReply: false, reason: "llm_unavailable_default_silent", source: "llm" });
});

test("judgeReply: ambiguous prose with a classifier that returns undefined (failed/unavailable) defaults to silent", async () => {
  const verdict = await judgeReply({
    cuuEnabled: true,
    participantCount: 4,
    text: "这个方案我觉得还需要再打磨一下细节部分的措辞",
    async classifyWithLlm() {
      return undefined;
    }
  });
  assert.deepEqual(verdict, { shouldReply: false, reason: "llm_unavailable_default_silent", source: "llm" });
});
