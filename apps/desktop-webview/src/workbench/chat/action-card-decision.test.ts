import assert from "node:assert/strict";
import { test } from "node:test";

import { mapActionCardDecisionError, shouldReconcileActionCardOnError } from "./action-card-decision.js";

test("mapActionCardDecisionError translates a recognized code to the zh-CN gentle copy", () => {
  assert.equal(
    mapActionCardDecisionError({ status: 409, code: "action_card_item_already_decided" }, "zh-CN"),
    "这条已经被处理过了。"
  );
});

test("mapActionCardDecisionError translates the same code to the en-US gentle copy", () => {
  assert.equal(
    mapActionCardDecisionError({ status: 409, code: "action_card_item_already_decided" }, "en-US"),
    "This one's already been handled."
  );
});

test("mapActionCardDecisionError gives the same 已经被处理过了 text for both already_decided and already_resolved", () => {
  const decided = mapActionCardDecisionError({ status: 409, code: "action_card_item_already_decided" }, "zh-CN");
  const resolved = mapActionCardDecisionError({ status: 409, code: "action_card_decision_already_resolved" }, "zh-CN");
  assert.equal(decided, resolved);
});

test("mapActionCardDecisionError covers the 403/422 authorization and validation codes", () => {
  assert.equal(
    mapActionCardDecisionError({ status: 403, code: "forbidden" }, "zh-CN"),
    "只有被指派的负责人或管理员能处理这张卡。"
  );
  assert.equal(
    mapActionCardDecisionError({ status: 422, code: "action_card_assignee_not_a_member" }, "zh-CN"),
    "这个人不是当前工作区的活跃成员。"
  );
});

test("mapActionCardDecisionError falls back to a generic retry message for an unrecognized code", () => {
  assert.equal(mapActionCardDecisionError({ status: 500, code: "internal_error" }, "zh-CN"), "没弄成，稍后再试一次。");
});

test("mapActionCardDecisionError falls back gracefully when the error source is undefined (e.g. a non-API-client error)", () => {
  assert.equal(mapActionCardDecisionError(undefined, "zh-CN"), "没弄成，稍后再试一次。");
  assert.equal(mapActionCardDecisionError(undefined, "en-US"), "That didn't go through — try again in a moment.");
});

test("mapActionCardDecisionError never leaks the raw error code into the displayed text", () => {
  const text = mapActionCardDecisionError({ status: 500, code: "some_unmapped_internal_code" }, "zh-CN");
  assert.doesNotMatch(text, /some_unmapped_internal_code/u);
});

test("shouldReconcileActionCardOnError is true only for the two stale-snapshot codes", () => {
  assert.equal(shouldReconcileActionCardOnError("action_card_item_already_decided"), true);
  assert.equal(shouldReconcileActionCardOnError("action_card_decision_already_resolved"), true);
});

test("shouldReconcileActionCardOnError is false for unrelated codes, including the undo-window-expired one", () => {
  assert.equal(shouldReconcileActionCardOnError("action_card_item_not_undoable"), false);
  assert.equal(shouldReconcileActionCardOnError("forbidden"), false);
  assert.equal(shouldReconcileActionCardOnError(undefined), false);
});
