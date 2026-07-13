import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReplyJudgeSystemPrompt,
  buildReplyJudgeUserPrompt,
  parseReplyJudgeLlmResponse
} from "./prompt.js";

test("buildReplyJudgeSystemPrompt carries the PM judgment standard and the data-isolation fence", () => {
  const prompt = buildReplyJudgeSystemPrompt();
  assert.match(prompt, /项目经理/u);
  assert.match(prompt, /数据隔离/u);
  assert.match(prompt, /should_reply/u);
});

test("buildReplyJudgeUserPrompt includes recent context and the candidate message", () => {
  const prompt = buildReplyJudgeUserPrompt({
    recentMessages: [{ senderLabel: "阿曼", text: "我们下周三对齐一下进度" }],
    candidateText: "好的，那就周三见"
  });
  assert.match(prompt, /阿曼/u);
  assert.match(prompt, /下周三对齐一下进度/u);
  assert.match(prompt, /周三见/u);
});

test("buildReplyJudgeUserPrompt handles an empty context gracefully", () => {
  const prompt = buildReplyJudgeUserPrompt({ recentMessages: [], candidateText: "在吗" });
  assert.match(prompt, /没有更早的聊天记录/u);
});

test("parseReplyJudgeLlmResponse accepts a clean strict JSON object", () => {
  const result = parseReplyJudgeLlmResponse('{"should_reply": true, "reason": "有人在问进度"}');
  assert.deepEqual(result, { should_reply: true, reason: "有人在问进度" });
});

test("parseReplyJudgeLlmResponse tolerates prose wrapped around the JSON object", () => {
  const result = parseReplyJudgeLlmResponse('这是我的判断：\n{"should_reply": false}\n以上。');
  assert.deepEqual(result, { should_reply: false });
});

test("parseReplyJudgeLlmResponse returns undefined for unparseable or empty text", () => {
  assert.equal(parseReplyJudgeLlmResponse(""), undefined);
  assert.equal(parseReplyJudgeLlmResponse("not json at all"), undefined);
});

test("parseReplyJudgeLlmResponse rejects a payload missing the required field", () => {
  assert.equal(parseReplyJudgeLlmResponse('{"reason": "缺了 should_reply"}'), undefined);
});
