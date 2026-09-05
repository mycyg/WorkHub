// WorkHub 桌面 · 随窗口可见性暂停的周期刷新（DSK-10）。
// 背景：审批角标 30s 轮询此前裸 setInterval 起完就不管——窗口长期隐藏（聚焦盒常态）也照打后端，
// 且没有任何清理口。这里收敛成一个可注入（假时钟/假 document，便于单测）的小编排：
// 隐藏即停表、重新可见立刻补刷一次并恢复节拍；返回的 disposer 负责清表 + 摘监听。

export type VisibilityAwarePollingInput = {
  refresh: () => void;
  intervalMs: number;
  /** 当前是否隐藏（默认读 document.hidden；无 document 按可见处理）。 */
  isHidden?: () => boolean;
  /** 订阅可见性变化；可返回摘订阅函数。默认绑 document 的 visibilitychange。 */
  onVisibilityChange?: (handler: () => void) => (() => void) | void;
  setIntervalFn?: (handler: () => void, intervalMs: number) => unknown;
  clearIntervalFn?: (id: unknown) => void;
};

export function startVisibilityAwarePolling(input: VisibilityAwarePollingInput): () => void {
  const setIntervalFn =
    input.setIntervalFn ?? ((handler: () => void, intervalMs: number) => window.setInterval(handler, intervalMs));
  const clearIntervalFn =
    input.clearIntervalFn ?? ((id: unknown) => window.clearInterval(id as number));
  const isHidden = input.isHidden ?? (() => (typeof document === "undefined" ? false : document.hidden));
  const onVisibilityChange =
    input.onVisibilityChange ??
    ((handler: () => void) => {
      if (typeof document === "undefined") {
        return undefined;
      }
      document.addEventListener("visibilitychange", handler);
      return () => document.removeEventListener("visibilitychange", handler);
    });

  let timer: unknown;
  const stopTimer = () => {
    if (timer !== undefined) {
      clearIntervalFn(timer);
      timer = undefined;
    }
  };
  const startTimer = () => {
    if (timer === undefined && !isHidden()) {
      timer = setIntervalFn(() => input.refresh(), input.intervalMs);
    }
  };
  const handleVisibilityChange = () => {
    if (isHidden()) {
      stopTimer();
    } else {
      // 重新可见立刻补刷一次（隐藏期间角标可能已变），再恢复节拍。
      input.refresh();
      startTimer();
    }
  };
  const unsubscribe = onVisibilityChange(handleVisibilityChange);

  startTimer();
  return () => {
    stopTimer();
    unsubscribe?.();
  };
}
