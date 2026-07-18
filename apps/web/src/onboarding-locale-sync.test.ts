import assert from "node:assert/strict";
import test from "node:test";

import { runOnboardingLocaleSync, type OnboardingLocaleSyncDeps } from "./onboarding-locale-sync.js";

// R20 P2-09（根因）：引导页选好语言 → 报到成功后，同步语言偏好到服务端此前是
// `void client.updatePreferences({ locale }).catch(() => undefined)`——失败被整个吞掉，用户毫无察觉、
// 也没有重试的出路。这里直接单测被抽出来的编排单元：失败必须可见（showSyncFailedNotice 被调用）、
// 必须可重试（拿到的 retry 回调再调一次会重新尝试 updatePreferences），绝不能对失败沉默。

function makeDeps(overrides: Partial<OnboardingLocaleSyncDeps> = {}) {
  const failedNotices: Array<() => void> = [];
  const succeededCalls: number[] = [];
  const deps: OnboardingLocaleSyncDeps = {
    updatePreferences: async () => undefined,
    showSyncFailedNotice: (retry) => {
      failedNotices.push(retry);
    },
    showSyncSucceededNotice: () => {
      succeededCalls.push(1);
    },
    ...overrides
  };
  return { deps, failedNotices, succeededCalls };
}

test("a successful sync never shows a failure notice and resolves true", async () => {
  const { deps, failedNotices, succeededCalls } = makeDeps();
  const result = await runOnboardingLocaleSync(deps);
  assert.equal(result, true);
  assert.equal(failedNotices.length, 0, "a successful first attempt must not surface any failure notice");
  assert.equal(succeededCalls.length, 0, "the success notice is reserved for a *retry* recovering — first-try success is silent (matches renderCurrentRouteOrOnboard landing normally)");
});

test("a failed sync is never swallowed — it surfaces a visible failure notice with a working retry, and resolves false", async () => {
  let callCount = 0;
  const { deps, failedNotices } = makeDeps({
    updatePreferences: async () => {
      callCount += 1;
      throw new Error("network_error");
    }
  });

  const result = await runOnboardingLocaleSync(deps);

  assert.equal(result, false, "the caller must be able to tell the sync did not succeed");
  assert.equal(callCount, 1, "exactly one attempt so far");
  assert.equal(failedNotices.length, 1, "a failure must be visible — this is the exact swallow-bug regression: previously nothing observed the failure at all");

  // Clicking "retry" must actually retry the network call — not just re-show the same dead notice.
  failedNotices[0]!();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(callCount, 2, "retry must invoke updatePreferences again");
});

test("retry can keep failing — every failed attempt (including retries) re-surfaces a visible, still-retryable notice", async () => {
  let callCount = 0;
  const { deps, failedNotices, succeededCalls } = makeDeps({
    updatePreferences: async () => {
      callCount += 1;
      throw new Error("still_down");
    }
  });

  await runOnboardingLocaleSync(deps);
  assert.equal(failedNotices.length, 1);

  failedNotices[0]!();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(callCount, 2);
  assert.equal(failedNotices.length, 2, "a second failed attempt must surface its own failure notice too — retrying must never go silent");
  assert.equal(succeededCalls.length, 0);
});

test("a retry that succeeds shows the success notice instead of failing silently again", async () => {
  let callCount = 0;
  const { deps, failedNotices, succeededCalls } = makeDeps({
    updatePreferences: async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error("network_error");
      }
    }
  });

  await runOnboardingLocaleSync(deps);
  assert.equal(failedNotices.length, 1);

  failedNotices[0]!();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(callCount, 2);
  assert.equal(succeededCalls.length, 1, "a recovering retry must give positive visible confirmation");
  assert.equal(failedNotices.length, 1, "no further failure notice once the retry succeeded");
});
