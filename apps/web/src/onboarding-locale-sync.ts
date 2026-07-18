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
export type OnboardingLocaleSyncDeps = {
  /** 尝试把语言偏好同步到服务端；resolve=成功，reject=失败。 */
  updatePreferences: () => Promise<void>;
  /** 同步失败（首次或重试都一样）时调用：必须渲染可见告警，并把 retry 挂到某个可点的地方
   *（例如告警里的"重试"按钮）。retry 可以被调用任意次——每次都会再尝试一次 updatePreferences。 */
  showSyncFailedNotice: (retry: () => void) => void;
  /** 一次成功的同步（首次或某次重试）之后调用：渲染确认反馈。 */
  showSyncSucceededNotice: () => void;
};

// resolve 的布尔值＝首次尝试是否直接成功（false 时代表已经触发了 showSyncFailedNotice，调用方不需要
// 再额外处理——后续的重试/成功反馈完全由这里内部通过 deps 回调闭环，不需要调用方继续 await 任何东西）。
export async function runOnboardingLocaleSync(deps: OnboardingLocaleSyncDeps): Promise<boolean> {
  const attempt = (): void => {
    void deps.updatePreferences().then(
      () => deps.showSyncSucceededNotice(),
      () => deps.showSyncFailedNotice(attempt)
    );
  };
  try {
    await deps.updatePreferences();
    return true;
  } catch {
    deps.showSyncFailedNotice(attempt);
    return false;
  }
}
