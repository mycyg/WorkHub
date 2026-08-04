// R20 P2-09：引导页选好语言 → 报到成功后，把语言偏好同步到服务端这一步此前是
// `void client.updatePreferences({ locale }).catch(() => undefined)`——失败被整个吞掉，用户以为
// 界面语言已经存下，实际上服务端偏好没变；下次换设备/清本地缓存，界面又会掉回默认语言，且用户全程
// 毫无察觉、无法重试。
//
// 抽成独立、可注入依赖的纯编排单元（同 confirm-button.ts / avatar-crop-modal.ts 的先例）：browser.ts
// 顶层引用了 `document`，这个 workspace 的测试运行器（node --import tsx --test，无 jsdom）一 import
// browser.ts 就会在模块顶层炸——重试编排逻辑本身不能和那一行顶层 DOM 访问共享同一个模块，否则永远
// 没法被单测覆盖到。生产侧 browser.ts 只负责把 updatePreferences 调用 + 两条 notice 渲染接成
// OnboardingLocaleSyncDeps 喂给这里。
//
// R21（补丁）：notice 依赖壳层 DOM 上的 [data-wh-app-notice]（packages/web-runtime 的 showRouteNotice
// 找不到这个节点就静默 no-op）——引导页模板没有这个节点，只有 renderCurrentRouteOrOnboard 把整页换成
// 工作台壳层之后才有。此前 PATCH 请求和 notice 回调是同一次 deps.updatePreferences() 里绑在一起发起
// 的，PATCH 先于渲染 settle 时（典型场景：断网，几乎立即 reject），失败告警会在壳层还没渲出来的那一刻
// 就被无声吞掉，且不会再补渲——用户永远看不到。
//
// 修法：请求本身仍然立刻发起、与渲染并发（不阻塞进入工作台），但把"渲染 notice"这一步推迟到调用方确认
// 壳层已经渲染完成之后才做——调用方把首次尝试的、已经在飞的 Promise 作为 firstAttempt 传进来（不是一个
// 会重新发起请求的函数），这里只 await 它、绝不重复发请求；只有走到重试分支才会真正调用
// retryUpdatePreferences 发一次新请求。
export type OnboardingLocaleSyncDeps = {
  /** 首次尝试同步语言偏好、已经在飞的 Promise——在壳层渲染完成之前就已发起，此处只 await 它，绝不因为
   *  等待渲染而重复发起请求。resolve=成功，reject=失败。 */
  firstAttempt: Promise<void>;
  /** 重试时发起一次新的同步请求；resolve=成功，reject=失败。 */
  retryUpdatePreferences: () => Promise<void>;
  /** 同步失败（首次或重试都一样）时调用：必须渲染可见告警，并把 retry 挂到某个可点的地方
   *（例如告警里的"重试"按钮）。retry 可以被调用任意次——每次都会再尝试一次 retryUpdatePreferences。 */
  showSyncFailedNotice: (retry: () => void) => void;
  /** 一次成功的同步（某次重试恢复）之后调用：渲染确认反馈。 */
  showSyncSucceededNotice: () => void;
};

// resolve 的布尔值＝首次尝试是否直接成功（false 时代表已经触发了 showSyncFailedNotice，调用方不需要
// 再额外处理——后续的重试/成功反馈完全由这里内部通过 deps 回调闭环，不需要调用方继续 await 任何东西）。
export async function runOnboardingLocaleSync(deps: OnboardingLocaleSyncDeps): Promise<boolean> {
  const attempt = (): void => {
    void deps.retryUpdatePreferences().then(
      () => deps.showSyncSucceededNotice(),
      () => deps.showSyncFailedNotice(attempt)
    );
  };
  try {
    await deps.firstAttempt;
    return true;
  } catch {
    deps.showSyncFailedNotice(attempt);
    return false;
  }
}
