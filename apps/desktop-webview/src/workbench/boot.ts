// WorkHub 桌面 · 工作台窗口入口（workbench.html 的 <script type="module"> 直接指到这个文件）。
// 故意不 import ./browser.ts——那是 1371 行的主窗/桌宠共用壳层，工作台是独立窗口、独立生命周期，
// 复用它只会把主窗特有的命令盒/gold-path 路由一起拖进来。这里只拿三样通用、非 browser.ts 私有的积木：
// @workhub/api-client 的 createApiClient、@workhub/web-runtime 的 locale 工具、auth-recovery 的
// stale-token 判定 + desktop-window-controls 的 Tauri invoke 解析——都是跨 surface 共享的小模块。

import { createApiClient } from "@workhub/api-client/client";
import type { IdentityResponse, WorkHubApiClient } from "@workhub/api-client";
import { defaultPorts } from "@workhub/config/ports";
import type { WorkHubLocale } from "@workhub/ui/gold-path";
import { applyIdentityLocale, browserLocale, setDocumentLocale } from "@workhub/web-runtime";

import { isStaleDesktopClientTokenError } from "../auth-recovery.js";
import { resolveDesktopTauriInvoke } from "../desktop-window-controls.js";
import { consumePendingWorkbenchDeepLink } from "./pending-deep-link.js";
import { mountWorkbenchShell, renderWorkbenchDocumentHead, type WorkbenchShellHandle } from "./shell.js";
import { isWorkbenchWindowControlPlan, parseWorkbenchDeepLinkPlan, parseWorkbenchRoute } from "./route.js";

const CLIENT_TOKEN_KEYS = ["workhub_client_token", "yqgl_client_token"] as const;
const DESKTOP_LOGGED_OUT_FLAG = "workhub_desktop_logged_out";

// 照 browser.ts:128 的 clientToken()——先读新键，兼容期回退旧的 yqgl_* 键。
export function clientToken(storage: Pick<Storage, "getItem"> = window.localStorage): string | undefined {
  for (const key of CLIENT_TOKEN_KEYS) {
    const value = storage.getItem(key);
    if (value) {
      return value;
    }
  }
  return undefined;
}

// 照 browser.ts:136 的 resolveDesktopApiBase()——本机复制一份小 helper，不 import browser.ts。
export function resolveWorkbenchApiBase(storage: Pick<Storage, "getItem"> = window.localStorage): string {
  const override = storage.getItem("workhub_api_base");
  if (override && override.trim().length > 0) {
    return override.trim().replace(/\/+$/u, "");
  }
  return `http://127.0.0.1:${defaultPorts.api}`;
}

export function isWorkbenchDesktopLoggedOut(storage: Pick<Storage, "getItem"> = window.localStorage): boolean {
  try {
    return storage.getItem(DESKTOP_LOGGED_OUT_FLAG) === "1";
  } catch {
    return false;
  }
}

function pushClientTokenToShell(token: string): void {
  const invoke = resolveDesktopTauriInvoke();
  if (invoke) {
    void Promise.resolve(invoke("set_client_token", { token })).catch(() => undefined);
  }
}

// 和 browser.ts 的 ensureDesktopClientToken 同语义：登出态不重新自动绑定；有 token 就探活一次，
// 陈旧/吊销(not_identified/invalid_client_token)才清掉重铸；网络/后端问题不动 token。
// 顺带把探活拿到的 identity 返回，给 boot() 复用去解析 locale，省一次重复往返（R12 首帧同款优化）。
export async function ensureWorkbenchClientToken(client: WorkHubApiClient): Promise<IdentityResponse | null> {
  if (isWorkbenchDesktopLoggedOut()) {
    return null;
  }
  let identity: IdentityResponse | null = null;
  if (!clientToken()) {
    await bootstrapWorkbenchClientToken(client);
  } else {
    try {
      identity = await client.me();
    } catch (error) {
      if (isStaleDesktopClientTokenError(error)) {
        window.localStorage.removeItem("workhub_client_token");
        await bootstrapWorkbenchClientToken(client);
      }
    }
  }
  const token = clientToken();
  if (token) {
    pushClientTokenToShell(token);
  }
  return identity;
}

async function bootstrapWorkbenchClientToken(client: WorkHubApiClient): Promise<void> {
  try {
    const result = await client.bootstrapDesktop({
      nickname: "WorkHub Desktop",
      device_name: "WorkHub Desktop",
      platform: "desktop"
    });
    if (result?.client_token) {
      window.localStorage.setItem("workhub_client_token", result.client_token);
    }
  } catch (error) {
    console.warn("WorkHub workbench desktop bootstrap failed; continuing without client token", error);
  }
}

// —— 深链事件订阅 —— //
// Tauri v2 的 event.listen 不受 desktop-cuu-runtime.ts 那个窄事件名联合类型约束（"deep-link" 不在其中，
// 那个联合是主/桌宠壳层自己的私有契约），这里直接解析全局 __TAURI__.event.listen，事件名用字符串。
export type WorkbenchTauriEventEnvelope = { payload: unknown };
export type WorkbenchTauriListen = (
  eventName: string,
  handler: (event: WorkbenchTauriEventEnvelope) => void
) => Promise<() => void> | (() => void) | void;

export function resolveWorkbenchTauriListen(scope: unknown = globalThis): WorkbenchTauriListen | undefined {
  const target = scope as { __TAURI__?: { event?: { listen?: WorkbenchTauriListen } } };
  return target.__TAURI__?.event?.listen;
}

// 只处理 windowControl.label === "workbench" 的深链 plan：解析 route 里的 projectId/conversationId，
// 切当前工作台窗口的项目上下文。非工作台目标（主窗深链）忽略——那条广播其它窗口也会收到。
export function bindWorkbenchDeepLinkListener(
  shell: Pick<WorkbenchShellHandle, "selectProject">,
  scope: unknown = globalThis
): void {
  const listen = resolveWorkbenchTauriListen(scope);
  if (!listen) {
    // 浏览器 dev 预览 / 完全没有 Tauri：no-op，不崩溃。capabilities/workbench.json 早已把
    // "workbench" 加进 windows 列表并授权（见 window-bridge.ts 顶部注释）——这不再是缺口，这条
    // 分支只覆盖"这个环境压根没有 __TAURI__"的真实场景。
    return;
  }
  void Promise.resolve(
    listen("deep-link", (event) => {
      const plan = parseWorkbenchDeepLinkPlan(event.payload);
      if (!plan || !isWorkbenchWindowControlPlan(plan)) {
        return;
      }
      const context = parseWorkbenchRoute(plan.route);
      if (context?.projectId) {
        shell.selectProject(context.projectId, context.conversationId);
      }
    })
  ).catch((error) => {
    console.warn("WorkHub workbench: could not subscribe to the deep-link event", error);
  });
}

// G-desktop 止血批 3（跨窗口登出广播）：登出动作发生在别的窗口（browser.ts 主窗 / spotlight 设置
// 视图，见那两处的登出处理器）时，那个窗口自己清 token + reload 就够了，但已经开着的工作台窗口不会
// 跟着走——它原来完全没有信号知道"手里的 client token 刚被清空了"，只会拿着废 token 继续发请求、
// 连环 401（这就是本批要修的症状）。登出动作发起方通过既有 Tauri 事件通路广播这个事件名（同
// bindWorkbenchDeepLinkListener 用的 __TAURI__.event.listen 通用桥，事件名注册在
// desktop-cuu-runtime.ts 的 DesktopShellEventName——桌宠窗口 pet-surface.ts 也订阅同一个事件名，
// 两边共用同一条广播，不另起协议），这里订阅后把结果交给调用方（boot() 接的是 shell.showLoggedOut()，
// 让 workbench 切到明确的「已登出」整窗态并停止后续请求）。
export function bindWorkbenchLoggedOutListener(onLoggedOut: () => void, scope: unknown = globalThis): void {
  const listen = resolveWorkbenchTauriListen(scope);
  if (!listen) {
    // 浏览器 dev 预览 / 无 Tauri：no-op，不崩溃——同 bindWorkbenchDeepLinkListener 的既有降级路径。
    return;
  }
  void Promise.resolve(
    listen("workhub-logged-out", () => onLoggedOut())
  ).catch((error) => {
    console.warn("WorkHub workbench: could not subscribe to the workhub-logged-out event", error);
  });
}

// 深链冷启动竞态兜底（批 1 遗留，见 pending-deep-link.ts 顶部注释）：本 App 自己发起的「打开工作台」
// （Spotlight → workbench-open.ts）在 invoke 之前已经把目标同步写进 localStorage；这里在挂载 shell
// 之后立即消费一次——命中就 selectProject，不命中（没有 stash / 已过期）就是正常的「从空态开始」冷启动，
// 什么都不做。和 bindWorkbenchDeepLinkListener 是两条互补的路：这条兜底"窗口创建前已经错过的事件"，
// 那条订阅"窗口活着之后到来的事件"（例如窗口已存在、这次只是复用/切换项目）。
export function applyPendingWorkbenchDeepLink(
  shell: Pick<WorkbenchShellHandle, "selectProject">,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = window.localStorage,
  now?: () => number
): void {
  const target = consumePendingWorkbenchDeepLink({ storage, ...(now ? { now } : {}) });
  if (target) {
    // #30：会话命中带 seq 时透传——工作台打开会话后定位到该消息并短暂高亮。
    shell.selectProject(target.projectId, target.conversationId, target.seq);
  }
}

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }
  let locale: WorkHubLocale = browserLocale();
  setDocumentLocale(locale);
  root.innerHTML = `${renderWorkbenchDocumentHead()}<div class="wh-ds wh-wb"><div class="wh-wb-loading"><span class="wh-wb-spinner"></span>${
    locale === "zh-CN" ? "正在打开工作台…" : "Opening the workbench…"
  }</div></div>`;

  const client = createApiClient({
    baseUrl: resolveWorkbenchApiBase(),
    getClientToken: clientToken
  });

  const identity = await ensureWorkbenchClientToken(client).catch(() => null);
  locale = applyIdentityLocale(identity, locale);
  setDocumentLocale(locale);

  // chat/stream.ts 的手写 SSE 客户端要用同一个 clientToken() 读法设 X-YQGL-Client-Token 头——
  // 显式传引用，而不是让 shell.ts 用它自己的兜底默认值（两边逻辑目前碰巧一样，但显式传递才是
  // 真正的"复用 boot.ts 已有 helper"，不是"恰好重复实现了一遍"）。
  const shell = mountWorkbenchShell(root, { client, locale, getClientToken: clientToken });
  // G-desktop 止血批 3：这次 boot 本身可能就已经处在登出态（比如上一次收到跨窗口登出广播后这个窗口
  // 自己 reload 了一轮，见 shell.ts selectProject 的恢复路径注释）——必须先于下面两行深链消费判断，
  // 否则一次带着真实深链目标的冷启动会在还没展示「已登出」之前就先把请求发出去。
  if (isWorkbenchDesktopLoggedOut()) {
    shell.showLoggedOut();
  }
  bindWorkbenchDeepLinkListener(shell);
  applyPendingWorkbenchDeepLink(shell);
  // 运行期广播：这个窗口一直开着、之后才收到别的窗口发起的登出——见 bindWorkbenchLoggedOutListener
  // 顶部注释。showLoggedOut() 本身幂等，两条路径（这里的运行期监听 + 上面的 boot 时快照检查）都指向
  // 同一个方法，不会重复触发副作用。
  bindWorkbenchLoggedOutListener(() => shell.showLoggedOut());
}

// node:test 环境没有 document——colocated boot.test.ts 只测上面导出的纯函数，不需要真跑 boot()。
// 这个 guard 只在真实 webview/浏览器里触发自动启动，测试 import 这个模块不会因为顶层副作用而崩。
// R13 真机加固:boot 任何一步未捕获异常/rejection 都不许留一块空白灰屏（验收暴露的最差 UX——
// 窗框在、内容空、日志无声）。渲染一块可读的致命错误面板,把真实错误原文亮出来,截图即可分诊。
function renderFatalBootError(error: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
  document.body.innerHTML = `<div style="font:500 13px/1.7 -apple-system,sans-serif;color:#1c2333;background:rgba(248,250,253,.92);height:100vh;box-sizing:border-box;padding:48px 56px;overflow:auto">
    <div style="font-size:17px;font-weight:700;margin-bottom:10px">工作台没能启动</div>
    <div style="color:#5a6478;margin-bottom:18px">把下面这段原样发给开发,或直接截图。</div>
    <pre style="white-space:pre-wrap;background:rgba(20,30,50,.06);border-radius:10px;padding:14px 16px;font-size:11.5px">${detail.replace(/&/gu, "&amp;").replace(/</gu, "&lt;")}</pre>
  </div>`;
}

if (typeof document !== "undefined") {
  window.addEventListener("error", (event) => {
    if (!document.querySelector("[data-wb-window]")) {
      renderFatalBootError(event.error ?? event.message);
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (!document.querySelector("[data-wb-window]")) {
      renderFatalBootError(event.reason);
    }
  });
  boot().catch(renderFatalBootError);
}
