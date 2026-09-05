import assert from "node:assert/strict";
import test from "node:test";

import {
  armApprovalSendBack,
  armProposalSendBack,
  clearPendingSendBack,
  createApprovalReasonDrafts,
  createPendingSendBackState,
  pendingSendBackActive,
  resolvePendingSendBack,
  resolveSendBackReasonMd,
  settleApprovalReasonDrafts
} from "./review-reason-pending.js";

// UI-01：两个打回挂起入口互清——同一时刻只允许一条打回流程，理由卡按钮一次点击绝不双发。
test("arming one send-back entry clears the other", () => {
  const state = createPendingSendBackState();
  armProposalSendBack(state, "/api/proposals/p1/review", "request_changes");
  assert.deepEqual(resolvePendingSendBack(state), { kind: "proposal", href: "/api/proposals/p1/review", actionId: "request_changes" });

  armApprovalSendBack(state, "appr-1", "deny");
  assert.equal(state.reviewHref, undefined);
  assert.equal(state.reviewActionId, undefined);
  assert.deepEqual(resolvePendingSendBack(state), { kind: "approval", approvalId: "appr-1", actionId: "deny" });

  armProposalSendBack(state, "/api/proposals/p2/review", "request_changes");
  assert.equal(state.approvalId, undefined);
  assert.equal(state.approvalActionId, undefined);
  assert.deepEqual(resolvePendingSendBack(state), { kind: "proposal", href: "/api/proposals/p2/review", actionId: "request_changes" });
});

test("resolve is mutually exclusive even if the state is corrupted into double-pending", () => {
  const state = createPendingSendBackState();
  state.reviewHref = "/api/proposals/p1/review";
  state.approvalId = "appr-1";
  const target = resolvePendingSendBack(state);
  assert.equal(target?.kind, "proposal");
});

test("clear / active flags follow the pending lifecycle", () => {
  const state = createPendingSendBackState();
  assert.equal(pendingSendBackActive(state), false);
  assert.equal(resolvePendingSendBack(state), undefined);

  armApprovalSendBack(state, "appr-1", "deny");
  assert.equal(pendingSendBackActive(state), true);

  clearPendingSendBack(state);
  assert.equal(pendingSendBackActive(state), false);
  assert.equal(resolvePendingSendBack(state), undefined);
});

// UI-11：预设理由按钮 vs 文本框残留草稿——草稿非空且未经二次确认时拦下，确认后以手写理由提交，
// 空草稿直接用预设。
test("UI-11: preset reason is blocked by a leftover draft unless confirmed, then the draft wins", () => {
  assert.deepEqual(resolveSendBackReasonMd("证据不足", ""), { ok: true, reasonMd: "证据不足" });
  assert.deepEqual(resolveSendBackReasonMd("证据不足", "   "), { ok: true, reasonMd: "证据不足" });
  assert.deepEqual(resolveSendBackReasonMd("证据不足", undefined), { ok: true, reasonMd: "证据不足" });
  // 残留草稿未确认：拦下，绝不静默用草稿盖过用户刚点的预设。
  assert.deepEqual(resolveSendBackReasonMd("证据不足", "上一条写了一半的理由"), {
    ok: false,
    reason: "custom_draft_blocks_preset"
  });
  // 二次确认后：显式以手写理由提交（trim 后）。
  assert.deepEqual(resolveSendBackReasonMd("证据不足", " 手写理由 ", true), { ok: true, reasonMd: "手写理由" });
});

// UI-12：审批处理成功后清草稿——Map 不再只增不减。
test("UI-12: settled approvals drop their reason drafts, others stay", () => {
  const drafts = createApprovalReasonDrafts();
  drafts.set("appr-1", "理由一");
  drafts.set("appr-2", "理由二");
  drafts.set("appr-3", "理由三");

  settleApprovalReasonDrafts(drafts, "appr-1", "appr-3", undefined);
  assert.equal(drafts.has("appr-1"), false);
  assert.equal(drafts.has("appr-3"), false);
  assert.equal(drafts.get("appr-2"), "理由二");
});
