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

// S5-N-04 诊断出口：把 webview 侧看到的壳层事件写进 Rust 的统一日志（~/Library/Logs/<bundle>/）。
// 打包后的 release webview 既没有检查器也没人读 stderr，缺了这条就没法区分「事件没送到前端」与
// 「送到了但前端没认出路由」。best-effort：浏览器 dev 态没有 __TAURI__ 时直接 no-op，绝不抛。
export function logDesktopShellDiagnostic(
  event: string,
  message: string,
  scope: DesktopWindowControlsScope = globalThis as DesktopWindowControlsScope
): boolean {
  return invokeDesktopWindowCommand("record_shell_diagnostic", { event, message }, scope);
}

// S5-M-07：这台机器报到时该用的设备名（壳层解析：兜底常量 < 机器名 < 配置文件 < WORKHUB_DEVICE_NAME）。
// 设备列表此前每台都叫「WorkHub Desktop」，同一账号装两台就只能靠时间戳猜该撤销哪一台。
// 浏览器 dev 态没有 __TAURI__、老壳层没有这个命令、壳层也可能一个来源都问不到 —— 全都回 undefined，
// 由调用方保留自己的兜底名。
export async function resolveDesktopDeviceName(
  scope: DesktopWindowControlsScope = globalThis as DesktopWindowControlsScope
): Promise<string | undefined> {
  const invoke = resolveDesktopTauriInvoke(scope);
  if (typeof invoke !== "function") {
    return undefined;
  }
  try {
    const name = await Promise.resolve(invoke("get_device_name", undefined));
    return typeof name === "string" && name.trim() ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}
