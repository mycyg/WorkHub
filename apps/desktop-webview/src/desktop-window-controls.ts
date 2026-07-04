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
