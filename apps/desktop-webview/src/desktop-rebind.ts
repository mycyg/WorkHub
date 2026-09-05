// WorkHub 桌面 · 昵称模式登出后的「重新绑定这台设备」屏（DSK-01）。
// 背景：旧的 gold-path 全屏壳 boot() 自 R8 起被 bootSpotlight() 取代、没有任何调用方（死代码），
// 而登出后的「输入昵称重新绑定」屏只存在于死 boot() 内——真实链路是登出 → 写登出标记 → reload →
// bootSpotlight → ensureDesktopClientToken 见标记返回 logged-out → 继续挂载 Spotlight，
// 之后所有取数静默失败、全应用没有任何重新登录入口（登出 = 永久锁死）。
// 本模块把重绑屏抽成可单测的纯渲染 + 纯流程，由 bootSpotlight 的 logged-out 分支挂载
//（凭据登录门同款模式，见 desktop-login.ts；密码/hybrid 模式走那里的凭据门，不经本模块）：
//   1) renderDesktopRebindScreenHtml：昵称输入 + 登录按钮 + 错误行（aria-live，可见可重试）；
//   2) runDesktopRebind：昵称 → desktop-bootstrap 一步换 client_token，令牌落库 + 清登出标记；
//   3) bindDesktopRebindScreen：DOM 接线——空昵称就地提示不发请求，失败可见可重试，
//      成功后回 onSuccess（一般是 reload，走既有 token 流）。

import type { WorkHubApiClient } from "@workhub/api-client";
import type { WorkHubLocale } from "@workhub/ui/gold-path";

import { writeDesktopClientToken } from "./desktop-client-token.js";

// 与 browser.ts / desktop-login.ts 同一套登出标记键 + 令牌收口（DSK-06，desktop-client-token.ts）——
// 拿到新令牌后落键、清登出标记。
const DESKTOP_LOGGED_OUT_FLAG = "workhub_desktop_logged_out";

// 重绑只需要客户端的 bootstrapDesktop 一个能力——收窄依赖便于测试注入假客户端（同 DesktopLoginClient 取舍）。
export type DesktopRebindClient = Pick<WorkHubApiClient, "bootstrapDesktop">;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/gu, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char
  ));
}

// 重新绑定的纯逻辑（无 DOM，便于单测）：desktop-bootstrap 用输入的昵称 identify + 注册这台设备，
// 一步到位换回 client_token；令牌落 localStorage 并清掉登出标记，后续走既有 token 流
//（getClientToken 每请求实时读它走 header）。登出态绝不自动用固定昵称 rebind——必须由用户显式提交。
export async function runDesktopRebind(input: {
  client: DesktopRebindClient;
  nickname: string;
  deviceName?: string;
  platform?: string;
  storage: Pick<Storage, "setItem" | "removeItem">;
}): Promise<{ client_token: string }> {
  const nickname = input.nickname.trim();
  if (!nickname) {
    throw new Error("nickname is required to re-bind this device");
  }
  const result = await input.client.bootstrapDesktop({
    nickname,
    device_name: input.deviceName?.trim() || "WorkHub Desktop",
    platform: input.platform ?? "desktop"
  });
  if (!result?.client_token) {
    throw new Error("desktop re-bind did not return a client token");
  }
  writeDesktopClientToken(input.storage, result.client_token);
  input.storage.removeItem(DESKTOP_LOGGED_OUT_FLAG);
  return { client_token: result.client_token };
}

// 把服务端/网络错误翻成用户可读、可重试的一句话（同 describeDesktopLoginError 的取舍，不泄露内部细节）。
export function describeDesktopRebindError(error: unknown, locale: WorkHubLocale): string {
  void error;
  return locale === "zh-CN"
    ? "登录失败，请检查后端连接后重试。"
    : "Sign-in failed — check the backend connection and retry.";
}

// 重绑屏的 HTML（自带 <style>，不依赖外部 CSS 已加载——渲进 boot 首帧壳也成立，同凭据登录门）。
export function renderDesktopRebindScreenHtml(input: { locale: WorkHubLocale; error?: string }): string {
  const zh = input.locale === "zh-CN";
  const title = zh ? "已登出" : "Signed out";
  const subtitle = zh ? "输入昵称重新绑定这台设备。" : "Enter a nickname to re-bind this device.";
  const nicknameLabel = zh ? "昵称" : "Nickname";
  const submitLabel = zh ? "登录" : "Sign in";
  const errorHtml = input.error
    ? `<p data-desktop-rebind-error style="margin:0;font-size:12px;color:#E5484D" role="alert">${escapeHtml(input.error)}</p>`
    : `<p data-desktop-rebind-error hidden style="margin:0;font-size:12px;color:#E5484D" role="alert"></p>`;
  return `<style>
    .wh-desktop-rebind-shell{min-height:100vh;display:grid;place-items:center;font-family:'M PLUS Rounded 1c','Noto Sans SC',system-ui,sans-serif;background:transparent}
    .wh-desktop-rebind-card{box-sizing:border-box;min-width:300px;max-width:min(420px,calc(100vw - 36px));padding:28px 30px;border-radius:16px;background:rgba(255,255,255,.86);border:1px solid rgba(255,255,255,.5);box-shadow:0 26px 70px -40px rgba(20,24,45,.55);display:grid;gap:12px;backdrop-filter:blur(18px) saturate(160%);-webkit-backdrop-filter:blur(18px) saturate(160%)}
    .wh-desktop-rebind-card h1{margin:0;font-size:19px;font-weight:900;color:#141a2d}
    .wh-desktop-rebind-card p.wh-desktop-rebind-sub{margin:0;font-size:13px;line-height:1.5;color:#5B616E}
    .wh-desktop-rebind-card input{box-sizing:border-box;width:100%;padding:9px 11px;border:1px solid #E6E7EB;border-radius:9px;font-size:14px;background:#fff;color:#141a2d;outline:none}
    .wh-desktop-rebind-card input:focus{border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.16)}
    .wh-desktop-rebind-card button[data-desktop-rebind]{margin-top:2px;padding:10px;border:0;border-radius:9px;background:#4F46E5;color:#fff;font-weight:800;font-size:14px;cursor:pointer}
    .wh-desktop-rebind-card button[data-desktop-rebind]:disabled{opacity:.6;cursor:progress}
  </style>
  <div class="wh-ds wh-desktop-rebind-shell">
    <form data-desktop-rebind-form class="wh-desktop-rebind-card" novalidate>
      <h1>${escapeHtml(title)}</h1>
      <p class="wh-desktop-rebind-sub">${escapeHtml(subtitle)}</p>
      <input data-desktop-rebind-nickname name="nickname" type="text" maxlength="64" autocomplete="nickname" placeholder="${escapeHtml(nicknameLabel)}" aria-label="${escapeHtml(nicknameLabel)}" />
      <button data-desktop-rebind type="submit">${escapeHtml(submitLabel)}</button>
      ${errorHtml}
    </form>
  </div>`;
}

// 把重绑屏接到 DOM：提交 → runDesktopRebind；空昵称就地提示（不发请求）；失败把可读原因写进错误行并
// 重新启用按钮（可重试）；成功回 onSuccess（一般是 reload 走既有 token 流）。
export function bindDesktopRebindScreen(
  rootEl: HTMLElement,
  input: {
    client: DesktopRebindClient;
    locale: WorkHubLocale;
    storage: Pick<Storage, "setItem" | "removeItem">;
    onSuccess: () => void;
    deviceName?: string;
    platform?: string;
  }
): void {
  rootEl.innerHTML = renderDesktopRebindScreenHtml({ locale: input.locale });
  const zh = input.locale === "zh-CN";
  const form = rootEl.querySelector<HTMLFormElement>("[data-desktop-rebind-form]");
  const nicknameEl = rootEl.querySelector<HTMLInputElement>("[data-desktop-rebind-nickname]");
  const submitEl = rootEl.querySelector<HTMLButtonElement>("[data-desktop-rebind]");
  const errorEl = rootEl.querySelector<HTMLElement>("[data-desktop-rebind-error]");
  const showError = (message: string) => {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
  };
  nicknameEl?.focus({ preventScroll: true });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const nickname = nicknameEl?.value.trim() ?? "";
    if (!nickname) {
      showError(zh ? "请先填写昵称。" : "Please enter a nickname first.");
      return;
    }
    if (submitEl) {
      submitEl.disabled = true;
    }
    if (errorEl) {
      errorEl.hidden = true;
    }
    void runDesktopRebind({
      client: input.client,
      nickname,
      ...(input.deviceName ? { deviceName: input.deviceName } : {}),
      ...(input.platform ? { platform: input.platform } : {}),
      storage: input.storage
    })
      .then(() => input.onSuccess())
      .catch((error: unknown) => {
        if (submitEl) {
          submitEl.disabled = false;
        }
        showError(describeDesktopRebindError(error, input.locale));
      });
  });
}
