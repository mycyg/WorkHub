// WorkHub 桌面 · 密码/hybrid 模式凭据登录门（REL-5 / P1-02）。
// 背景：昵称模式桌面走 desktop-bootstrap 一步换 client_token；但密码/hybrid 模式没有可用登录链路——
// desktop-bootstrap 在这两种模式下会 404（见 apps/api/src/routes/auth.ts）。本模块补上：
//   1) isPasswordModeBootstrapError：据 desktop-bootstrap 的 404 判定「当前是密码模式，要凭据登录」；
//   2) renderDesktopCredentialGateHtml：凭据表单（邮箱+密码），密码只走 <input type=password>，绝不进 URL；
//   3) runDesktopCredentialLogin：凭据登录 → 设备令牌 exchange（复用后端既有能力，前端不造鉴权）；
//   4) bindDesktopCredentialGate：把表单接到上面的流程，错误可见、按钮可重试（参照 SEC-2 登出状态机风格）。
// 昵称模式不经本模块——调用方按模式分支，昵称模式保持原样自动 bootstrap。

import { WorkHubApiError } from "@workhub/api-client/client";
import type { PasswordLoginRequest, WorkHubApiClient } from "@workhub/api-client";
import type { WorkHubLocale } from "@workhub/ui/gold-path";

import { writeDesktopClientToken } from "./desktop-client-token.js";

// 与 browser.ts / workbench/boot.ts 同一套登出标记键 + 令牌收口（DSK-06，desktop-client-token.ts）——
// 写令牌前清登出标记，落新键。
const DESKTOP_LOGGED_OUT_FLAG = "workhub_desktop_logged_out";
// 探得的认证模式提示：首启 bootstrap 成功=nickname、404=password（见 isPasswordModeBootstrapError）。
// 仅用于登出后选对再登录门（密码模式渲凭据表单）——登出态绝不自动昵称 rebind，故不能靠再探一次
// bootstrap（昵称模式会有建设备副作用）。只是提示：真正鉴权仍以服务端为准，模式若变登录会报错让用户重试。
const AUTH_MODE_HINT_KEY = "workhub_auth_mode";
export type DesktopAuthModeHint = "password" | "nickname";

export function readDesktopAuthModeHint(storage: Pick<Storage, "getItem">): DesktopAuthModeHint | null {
  try {
    const value = storage.getItem(AUTH_MODE_HINT_KEY);
    return value === "password" || value === "nickname" ? value : null;
  } catch {
    return null;
  }
}

export function rememberDesktopAuthModeHint(storage: Pick<Storage, "setItem">, mode: DesktopAuthModeHint): void {
  try {
    storage.setItem(AUTH_MODE_HINT_KEY, mode);
  } catch {
    // storage 不可用：模式提示只是优化，丢失不影响 fresh-launch 的 404 探测路径。
  }
}

// DSK-07：跨窗启动锁（localStorage lease）。首启时主窗/桌宠/工作台几乎同时 boot，都见「无 token」会
// 并发打 /api/auth/desktop-bootstrap——重复注册设备、双 token 互覆。同一 Tauri 应用各窗口共享同一
// localStorage（同 pending-deep-link.ts 顶部注释的既有事实），且 get/set 同步，用它做粗粒度 lease：
// 抢到锁的窗口执行 bootstrap 并落 token；没抢到的短轮询重读 token——胜者落盘后败者直接拿到现成
// token，不再重复 bootstrap。锁带 TTL + 属主标记 + 写后回读确认（同时写时后写覆盖先写，只有回读到
// 自己的属主标记才算真抢到）；胜者崩了/忘释放由 TTL 兜底，释放只删自己的锁。
export type DesktopBootstrapLockResult<T> =
  | { kind: "ran"; result: T }
  | { kind: "token-ready"; token: string }
  | { kind: "busy" };

const DESKTOP_BOOTSTRAP_LOCK_KEY = "workhub_desktop_bootstrap_lock";
const DESKTOP_BOOTSTRAP_LOCK_TTL_MS = 10_000;

export async function runDesktopBootstrapWithLock<T>(input: {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  readToken: () => string | undefined;
  run: () => Promise<T>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  lockTtlMs?: number;
  waitMs?: number;
  pollMs?: number;
}): Promise<DesktopBootstrapLockResult<T>> {
  const now = input.now ?? (() => Date.now());
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const lockTtlMs = input.lockTtlMs ?? DESKTOP_BOOTSTRAP_LOCK_TTL_MS;
  const waitMs = input.waitMs ?? 5_000;
  const pollMs = input.pollMs ?? 200;
  const owner = `${now()}:${Math.random()}`;

  const readLock = (): { owner: string; expiresAt: number } | undefined => {
    try {
      const raw = input.storage.getItem(DESKTOP_BOOTSTRAP_LOCK_KEY);
      const [ownerId, expiresAtRaw] = raw?.split("@") ?? [];
      const expiresAt = Number(expiresAtRaw);
      if (!ownerId || !Number.isFinite(expiresAt)) {
        return undefined;
      }
      return { owner: ownerId, expiresAt };
    } catch {
      return undefined;
    }
  };
  const tryAcquire = (): boolean => {
    try {
      const lock = readLock();
      if (lock && lock.expiresAt > now()) {
        return false;
      }
      input.storage.setItem(DESKTOP_BOOTSTRAP_LOCK_KEY, `${owner}@${now() + lockTtlMs}`);
      return readLock()?.owner === owner;
    } catch {
      return false;
    }
  };
  const release = (): void => {
    try {
      if (readLock()?.owner === owner) {
        input.storage.removeItem(DESKTOP_BOOTSTRAP_LOCK_KEY);
      }
    } catch {
      // 释放失败无碍——TTL 兜底，别的窗口到期可接管。
    }
  };
  const runLocked = async (): Promise<DesktopBootstrapLockResult<T>> => {
    try {
      return { kind: "ran", result: await input.run() };
    } finally {
      release();
    }
  };

  if (tryAcquire()) {
    return runLocked();
  }
  // 没抢到：胜者正在 bootstrap——短轮询重读 token，胜者落盘即返回；胜者崩了锁到期则接管。
  const deadline = now() + waitMs;
  while (now() < deadline) {
    await sleep(pollMs);
    const token = input.readToken();
    if (token) {
      return { kind: "token-ready", token };
    }
    if (tryAcquire()) {
      return runLocked();
    }
  }
  // 等到超时仍无 token 也抢不到锁：放弃（交给上层离线兜底），最后再读一次兜底。
  const token = input.readToken();
  return token ? { kind: "token-ready", token } : { kind: "busy" };
}

// 桌面 exchange 只需要客户端的 login + bootstrapDesktop 两个能力——收窄依赖便于测试注入假客户端。
export type DesktopLoginClient = Pick<WorkHubApiClient, "login" | "bootstrapDesktop">;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/gu, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char
  ));
}

// 首启探测：desktop-bootstrap 在密码/hybrid 模式回 404（会话未建立时）。据此判定要渲凭据登录表单，
// 而不是把 404 当「后端离线」静默吞掉。网络错误/5xx 不是本判定（那是离线，另有兜底）。
export function isPasswordModeBootstrapError(error: unknown): boolean {
  return error instanceof WorkHubApiError && error.status === 404;
}

// 凭据登录 → 设备令牌 exchange 的纯逻辑（无 DOM，便于单测往返）：
//   1) client.login：POST /api/auth/login 建会话 cookie（credentials: include）——复用后端既有密码登录，不重造鉴权；
//   2) client.bootstrapDesktop：密码模式下据会话换 client_token（服务端忽略 nickname 字段，用会话身份签发设备令牌）；
//   3) 令牌落 localStorage，并清掉登出标记，后续同昵称流（getClientToken 每请求实时读它走 header）。
// 明文密码只作为请求体传给 login，绝不进 URL/query。
export async function runDesktopCredentialLogin(input: {
  client: DesktopLoginClient;
  credentials: PasswordLoginRequest;
  deviceName?: string;
  platform?: string;
  storage: Pick<Storage, "setItem" | "removeItem">;
}): Promise<{ client_token: string }> {
  const email = input.credentials.email.trim();
  await input.client.login({ email, password: input.credentials.password });
  const exchange = await input.client.bootstrapDesktop({
    // 密码模式服务端据会话身份签发令牌、忽略 nickname；仍按 schema 传一个占位值（nickname 必填）。
    nickname: "WorkHub Desktop",
    device_name: input.deviceName?.trim() || "WorkHub Desktop",
    platform: input.platform ?? "desktop"
  });
  if (!exchange?.client_token) {
    throw new Error("desktop exchange did not return a client token");
  }
  input.storage.removeItem(DESKTOP_LOGGED_OUT_FLAG);
  writeDesktopClientToken(input.storage, exchange.client_token);
  return { client_token: exchange.client_token };
}

// 把服务端/网络错误翻成用户可读、可重试的一句话（不泄露账号是否存在——沿用后端 401 的统一口径）。
export function describeDesktopLoginError(error: unknown, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  if (error instanceof WorkHubApiError) {
    if (error.status === 401) {
      return zh ? "邮箱或密码不正确，请重试。" : "Email or password is incorrect. Please try again.";
    }
    if (error.status === 429) {
      return zh ? "登录尝试过于频繁，请稍后再试。" : "Too many attempts. Please wait a moment and retry.";
    }
    if (error.status === 400 || error.status === 422) {
      return zh ? "请填写有效的邮箱和密码。" : "Enter a valid email and password.";
    }
    if (error.status === 404) {
      return zh ? "当前后端未启用密码登录。" : "Password login isn't enabled on this backend.";
    }
  }
  return zh
    ? "登录失败，请检查后端连接后重试。"
    : "Sign-in failed — check the backend connection and retry.";
}

// 密码/hybrid 模式凭据登录门的 HTML（自带 <style>，不依赖外部 CSS 已加载——渲进 boot 首帧壳也成立）。
// 结构：邮箱 + 密码（type=password）+ 登录按钮 + 错误行（aria-live，可见可重试）。
export function renderDesktopCredentialGateHtml(input: { locale: WorkHubLocale; error?: string }): string {
  const zh = input.locale === "zh-CN";
  const title = zh ? "登录 WorkHub" : "Sign in to WorkHub";
  const subtitle = zh
    ? "这台设备使用邮箱 + 密码登录。登录后会绑定为受信任设备。"
    : "This device signs in with email and password, then binds as a trusted device.";
  const emailLabel = zh ? "邮箱" : "Email";
  const passwordLabel = zh ? "密码" : "Password";
  const submitLabel = zh ? "登录" : "Sign in";
  const errorHtml = input.error
    ? `<p data-desktop-login-error style="margin:0;font-size:12px;color:#E5484D" role="alert">${escapeHtml(input.error)}</p>`
    : `<p data-desktop-login-error hidden style="margin:0;font-size:12px;color:#E5484D" role="alert"></p>`;
  return `<style>
    .wh-desktop-login-shell{min-height:100vh;display:grid;place-items:center;font-family:'M PLUS Rounded 1c','Noto Sans SC',system-ui,sans-serif;background:transparent}
    .wh-desktop-login-card{box-sizing:border-box;min-width:320px;max-width:min(420px,calc(100vw - 36px));padding:28px 30px;border-radius:16px;background:rgba(255,255,255,.86);border:1px solid rgba(255,255,255,.5);box-shadow:0 26px 70px -40px rgba(20,24,45,.55);display:grid;gap:12px;backdrop-filter:blur(18px) saturate(160%);-webkit-backdrop-filter:blur(18px) saturate(160%)}
    .wh-desktop-login-card h1{margin:0;font-size:19px;font-weight:900;color:#141a2d}
    .wh-desktop-login-card p.wh-desktop-login-sub{margin:0;font-size:13px;line-height:1.5;color:#5B616E}
    .wh-desktop-login-card label{display:grid;gap:5px;font-size:12px;font-weight:800;color:#3a4256}
    .wh-desktop-login-card input{box-sizing:border-box;width:100%;padding:9px 11px;border:1px solid #E6E7EB;border-radius:9px;font-size:14px;background:#fff;color:#141a2d;outline:none}
    .wh-desktop-login-card input:focus{border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.16)}
    .wh-desktop-login-card button[data-desktop-login-submit]{margin-top:2px;padding:10px;border:0;border-radius:9px;background:#4F46E5;color:#fff;font-weight:800;font-size:14px;cursor:pointer}
    .wh-desktop-login-card button[data-desktop-login-submit]:disabled{opacity:.6;cursor:progress}
  </style>
  <div class="wh-ds wh-desktop-login-shell">
    <form data-desktop-login-form class="wh-desktop-login-card" novalidate>
      <h1>${escapeHtml(title)}</h1>
      <p class="wh-desktop-login-sub">${escapeHtml(subtitle)}</p>
      <label>${escapeHtml(emailLabel)}
        <input data-desktop-login-email name="email" type="email" autocomplete="username" inputmode="email" maxlength="320" placeholder="you@example.com" />
      </label>
      <label>${escapeHtml(passwordLabel)}
        <input data-desktop-login-password name="password" type="password" autocomplete="current-password" maxlength="1024" placeholder="••••••••" />
      </label>
      <button data-desktop-login-submit type="submit" class="ds-pressable">${escapeHtml(submitLabel)}</button>
      ${errorHtml}
    </form>
  </div>`;
}

// 把凭据登录门接到 DOM：提交 → runDesktopCredentialLogin；成功回 onSuccess（一般是 reload 走既有 token 流），
// 失败把可读原因写进错误行并重新启用按钮（可重试）。空字段就地提示，不发请求（也就不会把空密码送上网）。
export function bindDesktopCredentialGate(
  rootEl: HTMLElement,
  input: {
    client: DesktopLoginClient;
    locale: WorkHubLocale;
    storage: Pick<Storage, "setItem" | "removeItem">;
    onSuccess: () => void;
    deviceName?: string;
    platform?: string;
  }
): void {
  rootEl.innerHTML = renderDesktopCredentialGateHtml({ locale: input.locale });
  const zh = input.locale === "zh-CN";
  const form = rootEl.querySelector<HTMLFormElement>("[data-desktop-login-form]");
  const emailEl = rootEl.querySelector<HTMLInputElement>("[data-desktop-login-email]");
  const passwordEl = rootEl.querySelector<HTMLInputElement>("[data-desktop-login-password]");
  const submitEl = rootEl.querySelector<HTMLButtonElement>("[data-desktop-login-submit]");
  const errorEl = rootEl.querySelector<HTMLElement>("[data-desktop-login-error]");
  const showError = (message: string) => {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
  };
  emailEl?.focus({ preventScroll: true });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = emailEl?.value.trim() ?? "";
    const password = passwordEl?.value ?? "";
    if (!email || !password) {
      showError(zh ? "请填写邮箱和密码。" : "Enter your email and password.");
      return;
    }
    if (submitEl) {
      submitEl.disabled = true;
    }
    if (errorEl) {
      errorEl.hidden = true;
    }
    void runDesktopCredentialLogin({
      client: input.client,
      credentials: { email, password },
      ...(input.deviceName ? { deviceName: input.deviceName } : {}),
      ...(input.platform ? { platform: input.platform } : {}),
      storage: input.storage
    })
      .then(() => input.onSuccess())
      .catch((error: unknown) => {
        if (submitEl) {
          submitEl.disabled = false;
        }
        showError(describeDesktopLoginError(error, input.locale));
      });
  });
}
