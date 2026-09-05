// R20 P2-08：破坏性操作的两段式确认范式（web 端没有原生 confirm() 的 UI 语言里的替代）。第一次点击
// 把按钮翻成确认态（改标签 + 可选警示样式），限时窗口内再点一次才真正执行；超时自动复原。沿用
// apps/web 既有的 r9ConfirmArmed dataset 先例（bindMemoryPanel 的 armMemoryConfirmButton），抽成可被
// 单测（注入假按钮 + 假计时器）覆盖的纯编排单元，供成员移出/改角色、会话退出/移出等破坏性动作复用。

export type ConfirmButtonLike = {
  dataset: Record<string, string | undefined>;
  textContent: string | null;
  readonly isConnected: boolean;
};

export type ArmConfirmOptions = {
  /** 武装态下按钮显示的确认文案（如「确认移出？再点一次」）。 */
  confirmLabel: string;
  /** 第二次点击（已武装）时执行的真正动作。 */
  onConfirm: () => void;
  /** 第一次点击（进入武装态）后的副作用（如加警示类）。 */
  onArm?: () => void;
  /** 超时未确认、自动复原时的副作用（如去掉警示类）。 */
  onRevert?: () => void;
  /** 武装态存活时长，默认 5000ms（与既有 r9 范式一致）。 */
  timeoutMs?: number;
  /** 计时器注入点——默认 window.setTimeout；单测注入以手动驱动复原。 */
  schedule?: (fn: () => void, ms: number) => void;
};

const ARMED_FLAG = "r9ConfirmArmed";
const ORIGINAL_LABEL = "r20ConfirmOriginalLabel";

// 单击破坏性按钮的两段式守卫：未武装→武装（改标签 + onArm + 起复原计时）；已武装→执行 onConfirm 并解除武装。
export function armConfirmButton(button: ConfirmButtonLike, options: ArmConfirmOptions): void {
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => {
    if (typeof window !== "undefined") {
      window.setTimeout(fn, ms);
    } else {
      setTimeout(fn, ms);
    }
  });
  const timeoutMs = options.timeoutMs ?? 5000;
  if (button.dataset[ARMED_FLAG] !== "true") {
    const originalLabel = button.dataset[ORIGINAL_LABEL] ?? button.textContent ?? "";
    button.dataset[ORIGINAL_LABEL] = originalLabel;
    button.dataset[ARMED_FLAG] = "true";
    button.textContent = options.confirmLabel;
    options.onArm?.();
    schedule(() => {
      // 仍在页面上且仍处武装态才复原——已确认（flag 已清）或已移除的按钮不动它。
      if (button.isConnected && button.dataset[ARMED_FLAG] === "true") {
        delete button.dataset[ARMED_FLAG];
        button.textContent = originalLabel;
        options.onRevert?.();
      }
    }, timeoutMs);
    return;
  }
  delete button.dataset[ARMED_FLAG];
  // MRG-27：确认瞬间即复原原始文案并作废快照——onConfirm 多是异步动作，失败路径未必触发重渲，
  // 不复原的话按钮会永久卡在确认文案（「再点一次」）上。onConfirm 在复原之后执行，
  // 需要 busy/禁用文案的调用方仍可自行覆盖。
  const confirmedOriginal = button.dataset[ORIGINAL_LABEL];
  if (confirmedOriginal !== undefined) {
    delete button.dataset[ORIGINAL_LABEL];
    button.textContent = confirmedOriginal;
  }
  options.onConfirm();
}

// 手动解除武装（如整行进入禁用/提交态时，把同排其它已武装按钮复位），供调用方按需使用。
export function disarmConfirmButton(button: ConfirmButtonLike): void {
  if (button.dataset[ARMED_FLAG] === "true") {
    delete button.dataset[ARMED_FLAG];
    const original = button.dataset[ORIGINAL_LABEL];
    if (original !== undefined) {
      button.textContent = original;
    }
  }
}
