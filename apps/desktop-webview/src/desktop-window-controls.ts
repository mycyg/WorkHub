type DesktopTauriInvoke = (command: string, args?: Record<string, unknown> | undefined) => Promise<unknown> | unknown;

export type DesktopWindowControlsScope = {
  __TAURI__?: {
    core?: {
      invoke?: DesktopTauriInvoke;
    };
    invoke?: DesktopTauriInvoke;
  };
};

export function resolveDesktopTauriInvoke(
  scope: DesktopWindowControlsScope = globalThis as DesktopWindowControlsScope
): DesktopTauriInvoke | undefined {
  return scope.__TAURI__?.core?.invoke ?? scope.__TAURI__?.invoke;
}

function invokeDesktopWindowCommand(
  command: string,
  args: Record<string, unknown> | undefined,
  scope: DesktopWindowControlsScope = globalThis as DesktopWindowControlsScope
): boolean {
  const invoke = resolveDesktopTauriInvoke(scope);
  if (typeof invoke !== "function") {
    return false;
  }
  void Promise.resolve(invoke(command, args)).catch(() => undefined);
  return true;
}

export function resizeDesktopMainWindow(
  width: number,
  height: number,
  scope: DesktopWindowControlsScope = globalThis as DesktopWindowControlsScope
): boolean {
  return invokeDesktopWindowCommand("set_spotlight_size", { width, height }, scope);
}

export function dragDesktopMainWindow(
  scope: DesktopWindowControlsScope = globalThis as DesktopWindowControlsScope
): boolean {
  return invokeDesktopWindowCommand("start_main_window_drag", undefined, scope);
}

export function moveDesktopMainWindowBy(
  deltaX: number,
  deltaY: number,
  scope: DesktopWindowControlsScope = globalThis as DesktopWindowControlsScope
): boolean {
  return invokeDesktopWindowCommand("move_main_window_by", { deltaX, deltaY }, scope);
}

export function dismissDesktopMainWindow(
  scope: DesktopWindowControlsScope = globalThis as DesktopWindowControlsScope
): boolean {
  return invokeDesktopWindowCommand("hide_main_window", undefined, scope);
}

// MRG-23：目标窗 webview boot 完成后向壳层取回「窗口创建期间错过的深链计划」（Rust 侧
// take_pending_deep_link：TTL 15s、按窗口 label 认领、一次性）。浏览器 dev 态/无暂存 → undefined。
export async function takeDesktopPendingDeepLink(
  scope: DesktopWindowControlsScope = globalThis as DesktopWindowControlsScope
): Promise<unknown> {
  const invoke = resolveDesktopTauriInvoke(scope);
  if (typeof invoke !== "function") {
    return undefined;
  }
  try {
    return await Promise.resolve(invoke("take_pending_deep_link", undefined));
  } catch {
    return undefined;
  }
}
