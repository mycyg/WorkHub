import { normalizeWorkHubLocale, workHubLocaleStorageKey, type WorkHubLocale } from "@workhub/ui/gold-path";
import { isWorkHubLocale } from "@workhub/web-runtime";

import type { DesktopShellEmitter } from "./desktop-cuu-runtime.js";
import { resolveDesktopTauriInvoke, type DesktopWindowControlsScope } from "./desktop-window-controls.js";

type DesktopShellInvoke = (command: string, args?: Record<string, unknown> | undefined) => Promise<unknown> | unknown;

/** 广播语言变化时带的来源窗口——收到自己发的那一条要跳过（同 workhub-logged-in 的既有约定）。 */
export type DesktopLocaleSource = "main" | "workbench";

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

/**
 * 语言在这扇窗口里落定之后，把它推给壳层与别的窗口。
 *
 * R27（真机走查）：昵称登录成功后主窗立刻切中文，桌宠卡片却仍是英文夹中文，重启客户端才对齐。
 * 根因是身份语言只在**解析它的那扇窗口**里生效（applyIdentityLocale 写自己的 localStorage），
 * 桌宠窗的 locale 是 boot 时算一次就不动的常量：它收到 workhub-logged-in 后确实 reload 了，但那次
 * reload 跑在主窗拿到 /me、写下 zh-CN 之前，于是读到的还是旧值。这里两件事一起做：
 *   ① set_shell_locale——壳层那份单一事实源跟着走，后续任何一扇窗口 boot 都能问到对的语言；
 *   ② 广播 workhub-locale-changed——已经开着的窗口就地重读并重渲，不必等下次重启。
 * 语言没变就只同步壳层、不广播（避免收到广播的窗口无谓 reload，也断掉互相唤醒的回环）。
 */
export function publishDesktopLocale(input: {
  locale: WorkHubLocale;
  previous: WorkHubLocale;
  source: DesktopLocaleSource;
  invoke?: DesktopShellInvoke | undefined;
  emitter?: DesktopShellEmitter | undefined;
  scope?: DesktopWindowControlsScope;
}): boolean {
  const invoke = input.invoke ?? resolveDesktopTauriInvoke(input.scope ?? (globalThis as DesktopWindowControlsScope));
  const changed = input.locale !== input.previous;
  const broadcast = () => {
    if (!changed) {
      return;
    }
    void Promise.resolve(
      input.emitter?.emit?.("workhub-locale-changed", { locale: input.locale, source: input.source })
    ).catch(() => undefined);
  };
  if (typeof invoke === "function") {
    // 先让壳层落定，再告诉别人——广播的接收方 boot 时会去问壳层，顺序反了会读到旧值。
    void Promise.resolve(invoke("set_shell_locale", { locale: input.locale }))
      .catch(() => undefined)
      .then(broadcast);
  } else {
    broadcast();
  }
  return changed;
}

/** 解析 workhub-locale-changed 的 payload；不是我们认得的形状就回 undefined（不猜）。 */
export function parseDesktopLocaleChangedPayload(
  payload: unknown
): { locale: WorkHubLocale; source: string | undefined } | undefined {
  const record = payload as { locale?: unknown; source?: unknown } | null | undefined;
  const locale = record?.locale;
  if (!isWorkHubLocale(locale)) {
    return undefined;
  }
  return { locale, source: typeof record?.source === "string" ? record.source : undefined };
}
