// WorkHub 桌面 · 昵称模式的「输入昵称」屏（DSK-01 / R24 S4）。
// 背景：旧的 gold-path 全屏壳 boot() 自 R8 起被 bootSpotlight() 取代、没有任何调用方（死代码），
// 而登出后的「输入昵称重新绑定」屏只存在于死 boot() 内——真实链路是登出 → 写登出标记 → reload →
// bootSpotlight → ensureDesktopClientToken 见标记返回 logged-out → 继续挂载 Spotlight，
// 之后所有取数静默失败、全应用没有任何重新登录入口（登出 = 永久锁死）。
// 本模块把这张屏抽成可单测的纯渲染 + 纯流程，由两处挂载：
//   - 真登出（原始用途）：bootSpotlight 的 logged-out 分支，context="logged-out"，标题「已登出」；
//   - 首启（R24 S4，E-03 根治）：desktop-login.ts 的 resolveDesktopFirstRunGate 判定为昵称模式且
//     从未登录过时，同一张屏用 context="first-run" 挂载——只换标题/说明文案，流程不变。删掉的是
//     browser.ts/workbench/boot.ts 里那段硬编码 nickname:"WorkHub Desktop" 的静默自动 bootstrap：
//     全团队装同一个包不会再塌成服务器上的同一个人（getOrCreateActiveByNickname 按昵称复用）。
// 密码/hybrid 模式走 desktop-login.ts 的凭据门，不经本模块；但如果首启误判成了昵称模式（探测失败时的
// 默认假设——见 desktop-login.ts 的 resolveDesktopFirstRunGate 顶注），提交时会从 desktop-bootstrap
// 收到 404，onPasswordModeDetected 让调用方就地切换到凭据门，不需要用户自己诊断“来错屏了”。
//   1) renderDesktopRebindScreenHtml：昵称输入 + 登录按钮 + 错误行（aria-live，可见可重试）；
//   2) runDesktopRebind：昵称 → desktop-bootstrap 一步换 client_token，令牌落库 + 清登出标记 +
//      把服务端如实返回的 identity.created 落首启标记（desktop-first-run.ts）；
//   3) bindDesktopRebindScreen：DOM 接线——空昵称就地提示不发请求，失败可见可重试（探到密码模式则
//      转交 onPasswordModeDetected），成功后回 onSuccess（一般是 reload，走既有 token 流）。

import type { WorkHubApiClient } from "@workhub/api-client";
import type { WorkHubLocale } from "@workhub/ui/gold-path";

import {
  desktopBootScreenFitAttribute,
  desktopBootScreenFitPaddingPx
} from "./desktop-boot-screen-fit.js";
import { markDesktopIdentityCreated } from "./desktop-first-run.js";
import { writeDesktopClientToken } from "./desktop-client-token.js";
import { isPasswordModeBootstrapError, rememberDesktopAuthModeHint } from "./desktop-login.js";

// 与 browser.ts / desktop-login.ts 同一套登出标记键 + 令牌收口（DSK-06，desktop-client-token.ts）——
// 拿到新令牌后落键、清登出标记。
const DESKTOP_LOGGED_OUT_FLAG = "workhub_desktop_logged_out";

// 重绑只需要客户端的 bootstrapDesktop 一个能力——收窄依赖便于测试注入假客户端（同 DesktopLoginClient 取舍）。
export type DesktopRebindClient = Pick<WorkHubApiClient, "bootstrapDesktop">;

// 首启（这台设备从未登录过）与真登出（曾经登录过、被显式登出）共用同一张屏，只有标题/说明不同——
// 流程（提交昵称 → desktop-bootstrap → 落 token）完全一样，不重复实现。
export type DesktopRebindScreenContext = "first-run" | "logged-out";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/gu, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char
  ));
}

// 重新绑定的纯逻辑（无 DOM，便于单测）：desktop-bootstrap 用输入的昵称 identify + 注册这台设备，
// 一步到位换回 client_token；令牌落 localStorage 并清掉登出标记，后续走既有 token 流
//（getClientToken 每请求实时读它走 header）。登出态绝不自动用固定昵称 rebind——必须由用户显式提交。
// 服务端如实返回的 identity.created（这个昵称是刚建的新用户，还是复用了已有账号）原样落首启标记：
// 复用已有账号（created=false）不该继续渲「建你的第一个项目」——那个账号在服务器上可能早就有项目了。
// R24 S4（桌面端接线）：locale 由调用方（bindDesktopRebindScreen）原样转发它挂屏时已经解出的应用
// 语言——desktop-bootstrap 在昵称模式下真正新建用户时会读它（见 apps/api/src/routes/auth.ts 的
// resolveNewUserLocale），不带就退回 Accept-Language、都没有才落旧默认 zh-CN（走查复现的原始 bug：
// 英文用户首启被整壳翻译成中文）。已存在用户不受影响——服务端只在插入分支使用这个值。
export async function runDesktopRebind(input: {
  client: DesktopRebindClient;
  nickname: string;
  locale: WorkHubLocale;
  deviceName?: string;
  platform?: string;
  storage: Pick<Storage, "setItem" | "removeItem">;
}): Promise<{ client_token: string; created: boolean }> {
  const nickname = input.nickname.trim();
  if (!nickname) {
    throw new Error("nickname is required to re-bind this device");
  }
  const result = await input.client.bootstrapDesktop({
    nickname,
    device_name: input.deviceName?.trim() || "WorkHub Desktop",
    platform: input.platform ?? "desktop",
    locale: input.locale
  });
  if (!result?.client_token) {
    throw new Error("desktop re-bind did not return a client token");
  }
  writeDesktopClientToken(input.storage, result.client_token);
  input.storage.removeItem(DESKTOP_LOGGED_OUT_FLAG);
  const created = result.identity?.created === true;
  markDesktopIdentityCreated(input.storage, created);
  return { client_token: result.client_token, created };
}

// 把服务端/网络错误翻成用户可读、可重试的一句话（同 describeDesktopLoginError 的取舍，不泄露内部细节）。
export function describeDesktopRebindError(error: unknown, locale: WorkHubLocale): string {
  void error;
  return locale === "zh-CN"
    ? "登录失败，请检查后端连接后重试。"
    : "Sign-in failed — check the backend connection and retry.";
}

// 重绑/首启屏的 HTML（自带 <style>，不依赖外部 CSS 已加载——渲进 boot 首帧壳也成立，同凭据登录门）。
// context 默认 "logged-out"（向后兼容既有调用方/既有测试对「已登出」文案的断言）。
// R24 H（首启窗口裁切）：这张屏渲进主窗时，原生窗口还是聚焦盒 idle 的细搜索条尺寸（720×64）——
// 卡片会被裁得只剩标题。卡片上的 desktopBootScreenFitAttribute 是量高锚点，主窗挂载后由
// desktop-boot-screen-fit.ts 量它 + 外壳 padding 把窗口撑到内容大小；外壳 padding 与那边的加法共用
// desktopBootScreenFitPaddingPx，两边漂移就会重新裁边。自带的 html/body 归零是因为这张屏会整个替换掉
// boot 首帧壳（连同 spotlightCss 一起），不补就会吃到 UA 默认的 8px body margin（卡片偏移 + 出滚动条）。
export function renderDesktopRebindScreenHtml(input: {
  locale: WorkHubLocale;
  error?: string;
  context?: DesktopRebindScreenContext;
}): string {
  const zh = input.locale === "zh-CN";
  const context = input.context ?? "logged-out";
  const title =
    context === "first-run" ? (zh ? "欢迎使用 WorkHub" : "Welcome to WorkHub") : zh ? "已登出" : "Signed out";
  const subtitle =
    context === "first-run"
      ? zh
        ? "这台设备第一次连接这台服务器，输入昵称就能开始。"
        : "This device hasn't connected to this server before — enter a nickname to get started."
      : zh
        ? "输入昵称重新绑定这台设备。"
        : "Enter a nickname to re-bind this device.";
  const nicknameLabel = zh ? "昵称" : "Nickname";
  const submitLabel = zh ? "登录" : "Sign in";
  const errorHtml = input.error
    ? `<p data-desktop-rebind-error style="margin:0;font-size:12px;color:#E5484D" role="alert">${escapeHtml(input.error)}</p>`
    : `<p data-desktop-rebind-error hidden style="margin:0;font-size:12px;color:#E5484D" role="alert"></p>`;
  return `<style>
    html,body,#root{margin:0;padding:0;background:rgba(0,0,0,0)!important}
    .wh-desktop-rebind-shell{box-sizing:border-box;min-height:100vh;padding:${desktopBootScreenFitPaddingPx}px;display:grid;place-items:center;font-family:'M PLUS Rounded 1c','Noto Sans SC',system-ui,sans-serif;background:transparent}
    .wh-desktop-rebind-card{box-sizing:border-box;min-width:300px;max-width:min(420px,calc(100vw - ${desktopBootScreenFitPaddingPx * 2}px));padding:28px 30px;border-radius:22px;background:rgba(255,255,255,.86);border:1px solid rgba(255,255,255,.5);box-shadow:0 26px 70px -40px rgba(20,24,45,.55);display:grid;gap:12px;backdrop-filter:blur(18px) saturate(160%);-webkit-backdrop-filter:blur(18px) saturate(160%)}
    .wh-desktop-rebind-card h1{margin:0;font-size:19px;font-weight:900;color:#141a2d}
    .wh-desktop-rebind-card p.wh-desktop-rebind-sub{margin:0;font-size:13px;line-height:1.5;color:#5B616E}
    .wh-desktop-rebind-card input{box-sizing:border-box;width:100%;padding:9px 11px;border:1px solid #E6E7EB;border-radius:9px;font-size:14px;background:#fff;color:#141a2d;outline:none}
    .wh-desktop-rebind-card input:focus{border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.16)}
    .wh-desktop-rebind-card button[data-desktop-rebind]{margin-top:2px;padding:10px;border:0;border-radius:9px;background:#4F46E5;color:#fff;font-weight:800;font-size:14px;cursor:pointer}
    .wh-desktop-rebind-card button[data-desktop-rebind]:disabled{opacity:.6;cursor:progress}
  </style>
  <div class="wh-ds wh-desktop-rebind-shell">
    <form ${desktopBootScreenFitAttribute} data-desktop-rebind-form class="wh-desktop-rebind-card" novalidate>
      <h1>${escapeHtml(title)}</h1>
      <p class="wh-desktop-rebind-sub">${escapeHtml(subtitle)}</p>
      <input data-desktop-rebind-nickname name="nickname" type="text" maxlength="64" autocomplete="nickname" placeholder="${escapeHtml(nicknameLabel)}" aria-label="${escapeHtml(nicknameLabel)}" />
      <button data-desktop-rebind type="submit">${escapeHtml(submitLabel)}</button>
      ${errorHtml}
    </form>
  </div>`;
}

// 把重绑/首启屏接到 DOM：提交 → runDesktopRebind；空昵称就地提示（不发请求）；成功后回 onSuccess
// （一般是 reload 走既有 token 流）。失败分两种：
//   - 探明其实是密码/hybrid 模式（isPasswordModeBootstrapError）：说明首启的默认假设猜错了——记下
//     提示供下次直接判对，并把控制权转交 onPasswordModeDetected（调用方就地切换到凭据门），不在这张
//     屏上展示一句不知所云的错误；
//   - 其它失败：把可读原因写进错误行并重新启用按钮（可重试）。
export function bindDesktopRebindScreen(
  rootEl: HTMLElement,
  input: {
    client: DesktopRebindClient;
    locale: WorkHubLocale;
    storage: Pick<Storage, "setItem" | "removeItem">;
    onSuccess: () => void;
    deviceName?: string;
    platform?: string;
    context?: DesktopRebindScreenContext;
    onPasswordModeDetected?: () => void;
  }
): void {
  rootEl.innerHTML = renderDesktopRebindScreenHtml({
    locale: input.locale,
    ...(input.context ? { context: input.context } : {})
  });
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
      locale: input.locale,
      ...(input.deviceName ? { deviceName: input.deviceName } : {}),
      ...(input.platform ? { platform: input.platform } : {}),
      storage: input.storage
    })
      .then(() => input.onSuccess())
      .catch((error: unknown) => {
        if (isPasswordModeBootstrapError(error) && input.onPasswordModeDetected) {
          rememberDesktopAuthModeHint(input.storage, "password");
          input.onPasswordModeDetected();
          return;
        }
        if (submitEl) {
          submitEl.disabled = false;
        }
        showError(describeDesktopRebindError(error, input.locale));
      });
  });
}
