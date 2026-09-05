import assert from "node:assert/strict";
import test from "node:test";

import { armConfirmButton, disarmConfirmButton, type ConfirmButtonLike } from "./confirm-button.js";

// R20 P2-08：两段式确认守卫的根因单测——破坏性动作绝不「单击即提交」。用假按钮 + 手动计时器驱动，
// 覆盖：首点武装（不执行）、二点执行、超时自动复原、已确认后计时器不再复原、离场按钮不复原。

function fakeButton(label: string): ConfirmButtonLike & { isConnected: boolean } {
  return { dataset: {}, textContent: label, isConnected: true };
}

test("first click arms (relabels, does NOT execute); second click executes and disarms", () => {
  const btn = fakeButton("移出");
  let confirmed = 0;
  let armed = 0;
  const scheduled: Array<() => void> = [];
  const opts = {
    confirmLabel: "确认移出？再点一次",
    onConfirm: () => { confirmed += 1; },
    onArm: () => { armed += 1; },
    schedule: (fn: () => void) => { scheduled.push(fn); }
  };

  armConfirmButton(btn, opts);
  assert.equal(confirmed, 0, "single click must not execute the destructive action");
  assert.equal(armed, 1);
  assert.equal(btn.textContent, "确认移出？再点一次");
  assert.equal(btn.dataset["r9ConfirmArmed"], "true");

  armConfirmButton(btn, opts);
  assert.equal(confirmed, 1, "second click within the window executes");
  assert.equal(btn.dataset["r9ConfirmArmed"], undefined, "armed flag cleared after confirm");
  // MRG-27：确认后立即复原原始文案——异步动作失败（不重渲）也不该永久停在确认文案上。
  assert.equal(btn.textContent, "移出", "label restored to the original right after confirm");
  assert.equal(btn.dataset["r20ConfirmOriginalLabel"], undefined, "label snapshot invalidated after confirm");
});

test("timeout reverts the label and clears the armed state when never confirmed", () => {
  const btn = fakeButton("退出");
  let reverted = 0;
  const scheduled: Array<() => void> = [];
  armConfirmButton(btn, {
    confirmLabel: "确认退出？再点一次",
    onConfirm: () => assert.fail("should not confirm on timeout"),
    onRevert: () => { reverted += 1; },
    schedule: (fn: () => void) => { scheduled.push(fn); }
  });
  assert.equal(btn.textContent, "确认退出？再点一次");
  // 触发复原计时器。
  scheduled[0]!();
  assert.equal(reverted, 1);
  assert.equal(btn.textContent, "退出", "label restored to original");
  assert.equal(btn.dataset["r9ConfirmArmed"], undefined);
});

test("a fired timer does NOT revert after the action was already confirmed", () => {
  const btn = fakeButton("移出");
  let reverted = 0;
  const scheduled: Array<() => void> = [];
  const opts = {
    confirmLabel: "确认移出？再点一次",
    onConfirm: () => {},
    onRevert: () => { reverted += 1; },
    schedule: (fn: () => void) => { scheduled.push(fn); }
  };
  armConfirmButton(btn, opts); // arm
  armConfirmButton(btn, opts); // confirm (clears armed flag)
  scheduled[0]!(); // stale timer fires
  assert.equal(reverted, 0, "no revert once confirmed (guarded by the armed flag)");
});

test("a removed (disconnected) button is not reverted by its timer", () => {
  const btn = fakeButton("移出");
  btn.isConnected = false;
  let reverted = 0;
  const scheduled: Array<() => void> = [];
  armConfirmButton(btn, {
    confirmLabel: "确认？",
    onConfirm: () => {},
    onRevert: () => { reverted += 1; },
    schedule: (fn: () => void) => { scheduled.push(fn); }
  });
  scheduled[0]!();
  assert.equal(reverted, 0, "disconnected button (row re-rendered) is left alone");
});

test("disarmConfirmButton resets an armed button back to its original label", () => {
  const btn = fakeButton("移出");
  armConfirmButton(btn, { confirmLabel: "确认移出？再点一次", onConfirm: () => {}, schedule: () => {} });
  assert.equal(btn.dataset["r9ConfirmArmed"], "true");
  disarmConfirmButton(btn);
  assert.equal(btn.dataset["r9ConfirmArmed"], undefined);
  assert.equal(btn.textContent, "移出");
});
