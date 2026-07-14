import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_FEEDBACK_NOTE_MAX_CHARS,
  aiFeedbackSubjectTypeSchema,
  aiFeedbackVerdictSchema,
  myAiFeedbackVmSchema,
  putAiFeedbackRequestSchema,
  conversationMessageVmSchema,
  proposalDetailVmSchema
} from "./index.js";

const timestamp = "2026-07-14T10:30:00.000Z";
const messageId = "8f000000-0000-4000-8000-000000000001";
const conversationId = "8f000000-0000-4000-8000-000000000002";
const proposalId = "8f000000-0000-4000-8000-000000000003";

test("R14 FEEDBACK verdict + subject_type enums are exactly the binary/triple sets", () => {
  assert.deepEqual(aiFeedbackVerdictSchema.options, ["useful", "not_useful"]);
  assert.deepEqual(aiFeedbackSubjectTypeSchema.options, [
    "conversation_message",
    "proposal",
    "action_card_item"
  ]);
});

test("R14 FEEDBACK request schema rejects an over-long note (>200) and a bad verdict", () => {
  assert.equal(putAiFeedbackRequestSchema.safeParse({ verdict: "useful" }).success, true);
  assert.equal(
    putAiFeedbackRequestSchema.safeParse({ verdict: "useful", note: "有用" }).success,
    true
  );
  assert.equal(
    putAiFeedbackRequestSchema.safeParse({ verdict: "useful", note: "x".repeat(AI_FEEDBACK_NOTE_MAX_CHARS + 1) }).success,
    false
  );
  assert.equal(putAiFeedbackRequestSchema.safeParse({ verdict: "meh" }).success, false);
  // strict：多余键被拒（不给客户端塞 user_id 之类越权字段）。
  assert.equal(
    putAiFeedbackRequestSchema.safeParse({ verdict: "useful", user_id: "x" }).success,
    false
  );
});

test("R14 FEEDBACK my_feedback VM is a single self object (no user_ids aggregation)", () => {
  const parsed = myAiFeedbackVmSchema.parse({ verdict: "not_useful", note: "跑偏了", updated_at: timestamp });
  assert.equal(parsed.verdict, "not_useful");
  // note 可省略。
  assert.equal(myAiFeedbackVmSchema.safeParse({ verdict: "useful", updated_at: timestamp }).success, true);
});

test("R14 FEEDBACK my_feedback rides on a Cuu text message VM as additive optional", () => {
  const withFeedback = conversationMessageVmSchema.parse({
    id: messageId,
    conversation_id: conversationId,
    seq: 7,
    sender_type: "cuu",
    sender_user_id: null,
    thread_root_id: null,
    kind: "text",
    content: { text: "我建议先合并这个分支。" },
    my_feedback: { verdict: "useful", updated_at: timestamp },
    created_at: timestamp
  });
  assert.equal(withFeedback.my_feedback?.verdict, "useful");
  // 不带 my_feedback 的旧消息照常通过（additive 零回归）。
  const withoutFeedback = conversationMessageVmSchema.parse({
    id: messageId,
    conversation_id: conversationId,
    seq: 7,
    sender_type: "cuu",
    sender_user_id: null,
    thread_root_id: null,
    kind: "text",
    content: { text: "我建议先合并这个分支。" },
    created_at: timestamp
  });
  assert.equal("my_feedback" in withoutFeedback, false);
});

test("R14 FEEDBACK proposal detail VM feedback block is additive optional with server-computed actions", () => {
  // feedback 是 proposalDetailVmSchema 上的 additive optional 字段——直接验证其子 schema 形状（不必
  // 拼一整份合法 manifest，那与本批无关）。
  const feedbackSchema = proposalDetailVmSchema.shape.feedback;
  // 省略（undefined）——存量客户端零回归。
  assert.equal(feedbackSchema.safeParse(undefined).success, true);
  // 有判定 + clear 撤销动作。
  const parsed = feedbackSchema.parse({
    my_verdict: "not_useful",
    my_note: "跑偏了",
    mark_useful: { id: "mark_useful", label: "有用", method: "PUT", href: `/api/proposals/${proposalId}/feedback`, request_json: { verdict: "useful" } },
    mark_not_useful: { id: "mark_not_useful", label: "没用", method: "PUT", href: `/api/proposals/${proposalId}/feedback`, request_json: { verdict: "not_useful" } },
    clear: { id: "clear_feedback", label: "撤销", method: "DELETE", href: `/api/proposals/${proposalId}/feedback` }
  });
  assert.equal(parsed?.my_verdict, "not_useful");
  assert.equal(parsed?.mark_useful.method, "PUT");
  assert.equal(parsed?.clear?.method, "DELETE");
  // 无判定：my_verdict/my_note 为 null，clear 省略。
  const empty = feedbackSchema.parse({
    my_verdict: null,
    my_note: null,
    mark_useful: { id: "mark_useful", label: "有用", method: "PUT", href: `/api/proposals/${proposalId}/feedback`, request_json: { verdict: "useful" } },
    mark_not_useful: { id: "mark_not_useful", label: "没用", method: "PUT", href: `/api/proposals/${proposalId}/feedback`, request_json: { verdict: "not_useful" } }
  });
  assert.equal(empty?.my_verdict, null);
  assert.equal(empty?.clear, undefined);
});
