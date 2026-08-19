import assert from "node:assert/strict";
import test from "node:test";

import {
  armApprovalSendBack,
  armProposalSendBack,
  clearPendingSendBack,
  createPendingSendBackState,
  pendingSendBackActive,
  resolvePendingSendBack
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
