import { normalizeWorkHubLocale, workHubLocaleStorageKey, type WorkHubLocale } from "@workhub/ui/gold-path";
import { isWorkHubLocale } from "@workhub/web-runtime";

import { resolveDesktopTauriInvoke, type DesktopWindowControlsScope } from "./desktop-window-controls.js";

/**
 * 问壳层当下用的是哪种语言（Rust 的 get_shell_locale 读那个 Mutex<WorkHubLocale>——托盘菜单、
 * 通知兜底文案、窗口标题用的就是它）。浏览器 dev 态没有 __TAURI__、老壳层没有这条命令 → undefined。
 */
export async function readDesktopShellLocale(
  scope: DesktopWindowControlsScope = globalThis as DesktopWindowControlsScope
): Promise<WorkHubLocale | undefined> {
  const invoke = resolveDesktopTauriInvoke(scope);
  if (typeof invoke !== "function") {
    return undefined;
  }
  try {
    const value = await Promise.resolve(invoke("get_shell_locale", undefined));
    return isWorkHubLocale(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * boot 时该用哪种语言。
 *
 * R27（真机走查）：英文系统上首启，连接服务器屏与登录屏全是英文，`WORKHUB_LOCALE=zh-CN` 也救不了
 * ——那个变量只喂给壳层（托盘/标题/通知），webview 这边压根没有途径问到它，只能退回
 * `navigator.language`。现在中间插一层壳层语言：
 *
 *   显式偏好（localStorage，用户自己选过 / 身份带回来的）> 壳层语言 > navigator.language
 *
 * 显式偏好仍然排第一：它是这台设备上真正表过态的那个值；壳层语言排第二是因为它已经汇总了
 * 「WORKHUB_LOCALE 配置 → 系统语言」两级来源，比 webview 自己看到的 navigator 更接近人的意图。
 */
export async function resolveDesktopBootLocale(
  input: {
    /** QA/夹具覆盖（桌宠窗的 __WORKHUB_CUU_QA_LOCALE__ 走这里），优先于一切。 */
    override?: unknown;
    storage?: Storage | undefined;
    navigatorLanguage?: string | undefined;
    scope?: DesktopWindowControlsScope;
  } = {}
): Promise<WorkHubLocale> {
  if (isWorkHubLocale(input.override)) {
    return input.override;
  }
  const storage = input.storage ?? globalThis.localStorage;
  let stored: string | null = null;
  try {
    stored = storage?.getItem(workHubLocaleStorageKey) ?? null;
  } catch {
    // 隐私模式/存储被禁用：当作没有显式偏好，继续问下一个来源（同 web-runtime 的 browserLocale）。
    stored = null;
  }
  if (isWorkHubLocale(stored)) {
    return stored;
  }
  const shellLocale = await readDesktopShellLocale(input.scope ?? (globalThis as DesktopWindowControlsScope));
  if (shellLocale) {
    return shellLocale;
  }
  return normalizeWorkHubLocale(input.navigatorLanguage ?? globalThis.navigator?.language);
}
