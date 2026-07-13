import assert from "node:assert/strict";
import test from "node:test";

import { applyReplyJudgeRules, looksImperative, looksLikeChitchat, mentionsDisplayName } from "./rules.js";

test("mentionsDisplayName matches Cuu case-insensitively with a word boundary", () => {
  assert.equal(mentionsDisplayName("@Cuu 帮我看看这个"), true);
  assert.equal(mentionsDisplayName("叫cuu帮忙"), true);
  assert.equal(mentionsDisplayName("CUU在吗"), true);
});

test("mentionsDisplayName does not match a substring inside a longer token", () => {
  assert.equal(mentionsDisplayName("cuubot 也在群里"), false);
  assert.equal(mentionsDisplayName("这个 cuuuu 是谁"), false);
});

test("mentionsDisplayName respects a custom display name", () => {
  assert.equal(mentionsDisplayName("@小助手 在吗", "小助手"), true);
  assert.equal(mentionsDisplayName("@Cuu 在吗", "小助手"), false);
});

test("looksImperative recognizes common Chinese request phrasing", () => {
  assert.equal(looksImperative("帮我查一下上季度的报告"), true);
  assert.equal(looksImperative("麻烦同步一下进度"), true);
  assert.equal(looksImperative("谁能把那个文件发一下？"), true);
});

test("looksImperative does not flag plain statements with no request", () => {
  assert.equal(looksImperative("今天天气不错"), false);
  assert.equal(looksImperative("我刚才吃了个饭"), false);
});

test("looksLikeChitchat flags short acknowledgements and greetings", () => {
  assert.equal(looksLikeChitchat("哈哈哈"), true);
  assert.equal(looksLikeChitchat("收到"), true);
  assert.equal(looksLikeChitchat("+1"), true);
});

test("looksLikeChitchat does not flag a short message that is actually a question", () => {
  assert.equal(looksLikeChitchat("在吗？"), false);
});

test("looksLikeChitchat does not flag a long message even without request markers (falls to undetermined upstream)", () => {
  assert.equal(looksLikeChitchat("我们下周三下午三点在会议室碰一下这个方案的细节"), false);
});

test("applyReplyJudgeRules: mention wins over everything else, including chitchat wording", () => {
  assert.equal(applyReplyJudgeRules({ text: "谢谢 @Cuu", mentioned: true }), "reply");
});

test("applyReplyJudgeRules: imperative phrasing without a mention still resolves to reply", () => {
  assert.equal(applyReplyJudgeRules({ text: "帮我找一下上次的合同", mentioned: false }), "reply");
});

test("applyReplyJudgeRules: pure chitchat without a mention resolves to silent", () => {
  assert.equal(applyReplyJudgeRules({ text: "哈哈哈", mentioned: false }), "silent");
});

test("applyReplyJudgeRules: ambiguous prose falls through to undetermined for the LLM tier", () => {
  assert.equal(
    applyReplyJudgeRules({ text: "这个方案我觉得还需要再打磨一下细节部分的措辞", mentioned: false }),
    "undetermined"
  );
});
