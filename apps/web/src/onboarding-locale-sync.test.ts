import assert from "node:assert/strict";
import test from "node:test";

import { runOnboardingLocaleSync, type OnboardingLocaleSyncDeps } from "./onboarding-locale-sync.js";

// R20 P2-09（根因）：引导页选好语言 → 报到成功后，同步语言偏好到服务端此前是
// `void client.updatePreferences({ locale }).catch(() => undefined)`——失败被整个吞掉，用户毫无察觉、
// 也没有重试的出路。这里直接单测被抽出来的编排单元：失败必须可见（showSyncFailedNotice 被调用）、
// 必须可重试（拿到的 retry 回调再调一次会重新尝试同步）、绝不能对失败沉默。
//
// R21（补丁）：firstAttempt 现在是调用方已经发起、正在飞的 Promise（不是一个函数）——runOnboardingLocaleSync
// 只 await 它，绝不会为了"首次尝试"而重复发起请求；只有走到重试分支才会调用 retryUpdatePreferences 发
// 一次新请求。下面专门加了一组用例验证这一点（原因见 onboarding-locale-sync.ts 顶部注释：调用方要把 PATCH
// 的发起时机和 notice 的渲染时机解耦，这里只保证"首次尝试不重复发请求"这条契约）。

function makeDeps(overrides: Partial<OnboardingLocaleSyncDeps> = {}) {
  const failedNotices: Array<() => void> = [];
  const succeededCalls: number[] = [];
  const deps: OnboardingLocaleSyncDeps = {
    firstAttempt: Promise.resolve(),
    retryUpdatePreferences: async () => undefined,
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

test("a successful first attempt never shows a failure notice and resolves true", async () => {
  const { deps, failedNotices, succeededCalls } = makeDeps();
  const result = await runOnboardingLocaleSync(deps);
  assert.equal(result, true);
  assert.equal(failedNotices.length, 0, "a successful first attempt must not surface any failure notice");
  assert.equal(succeededCalls.length, 0, "the success notice is reserved for a *retry* recovering — first-try success is silent (matches renderCurrentRouteOrOnboard landing normally)");
});

test("the first attempt reuses the already-in-flight promise instead of issuing a fresh request", async () => {
  let retryCallCount = 0;
  const { deps } = makeDeps({
    firstAttempt: Promise.resolve(),
    retryUpdatePreferences: async () => {
      retryCallCount += 1;
    }
  });
  await runOnboardingLocaleSync(deps);
  assert.equal(retryCallCount, 0, "the first attempt must only await the pre-existing in-flight promise — it must never call retryUpdatePreferences itself");
});

test("a failed first attempt (the in-flight PATCH rejecting) is never swallowed — it surfaces a visible failure notice with a working retry, and resolves false", async () => {
  let retryCallCount = 0;
  const { deps, failedNotices } = makeDeps({
    firstAttempt: Promise.reject(new Error("network_error")),
    retryUpdatePreferences: async () => {
      retryCallCount += 1;
    }
  });

  const result = await runOnboardingLocaleSync(deps);

  assert.equal(result, false, "the caller must be able to tell the sync did not succeed");
  assert.equal(retryCallCount, 0, "the first attempt failing must not trigger an extra retry request on its own");
  assert.equal(failedNotices.length, 1, "a failure must be visible — this is the exact swallow-bug regression: previously nothing observed the failure at all");

  // Clicking "retry" must actually retry the network call — not just re-show the same dead notice.
  failedNotices[0]!();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(retryCallCount, 1, "retry must invoke retryUpdatePreferences");
});

test("retry can keep failing — every failed attempt (including retries) re-surfaces a visible, still-retryable notice", async () => {
  let retryCallCount = 0;
  const { deps, failedNotices, succeededCalls } = makeDeps({
    firstAttempt: Promise.reject(new Error("still_down")),
    retryUpdatePreferences: async () => {
      retryCallCount += 1;
      throw new Error("still_down");
    }
  });

  await runOnboardingLocaleSync(deps);
  assert.equal(failedNotices.length, 1);

  failedNotices[0]!();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(retryCallCount, 1);
  assert.equal(failedNotices.length, 2, "a second failed attempt must surface its own failure notice too — retrying must never go silent");
  assert.equal(succeededCalls.length, 0);
});

test("a retry that succeeds shows the success notice instead of failing silently again", async () => {
  let retryCallCount = 0;
  const { deps, failedNotices, succeededCalls } = makeDeps({
    firstAttempt: Promise.reject(new Error("network_error")),
    retryUpdatePreferences: async () => {
      retryCallCount += 1;
    }
  });

  await runOnboardingLocaleSync(deps);
  assert.equal(failedNotices.length, 1);

  failedNotices[0]!();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(retryCallCount, 1);
  assert.equal(succeededCalls.length, 1, "a recovering retry must give positive visible confirmation");
  assert.equal(failedNotices.length, 1, "no further failure notice once the retry succeeded");
});
