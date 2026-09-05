// WorkHub 桌面 · 工作台窗口入口（workbench.html 的 <script type="module"> 直接指到这个文件）。
// 故意不 import ./browser.ts——那是 1371 行的主窗/桌宠共用壳层，工作台是独立窗口、独立生命周期，
// 复用它只会把主窗特有的命令盒/gold-path 路由一起拖进来。这里只拿三样通用、非 browser.ts 私有的积木：
// @workhub/api-client 的 createApiClient、@workhub/web-runtime 的 locale 工具、auth-recovery 的
// stale-token 判定 + desktop-window-controls 的 Tauri invoke 解析——都是跨 surface 共享的小模块。

import { createApiClient } from "@workhub/api-client/client";
import type { IdentityResponse, WorkHubApiClient } from "@workhub/api-client";
import type { WorkHubLocale } from "@workhub/ui/gold-path";
import { applyIdentityLocale, browserLocale, setDocumentLocale } from "@workhub/web-runtime";

import { isStaleDesktopClientTokenError } from "../auth-recovery.js";
import {
  clearDesktopClientToken,
  readDesktopClientToken
} from "../desktop-client-token.js";
import { resolveDesktopApiBaseFromStorage } from "../desktop-api-base.js";
import {
  bindDesktopCredentialGate,
  desktopBootScreenForGate,
  isPasswordModeBootstrapError,
  readDesktopAuthModeHint,
  resolveDesktopFirstRunGateWithLock,
  type DesktopCredentialGateContext
} from "../desktop-login.js";
import {
  bindDesktopConnectScreen,
  bindDesktopServerChangedReload,
  createDesktopServerChoiceEffects
} from "../desktop-connect-screen.js";
import { resolveDesktopTauriInvoke, takeDesktopPendingDeepLink } from "../desktop-window-controls.js";
import { scheduleWorkHubLiquidGlassFilterRebuild } from "../liquid-glass-filter.js";
import { consumePendingWorkbenchDeepLink } from "./pending-deep-link.js";
import { mountWorkbenchShell, renderWorkbenchDocumentHead, type WorkbenchShellHandle } from "./shell.js";
import { isWorkbenchWindowControlPlan, parseWorkbenchDeepLinkPlan, parseWorkbenchRoute } from "./route.js";

const DESKTOP_LOGGED_OUT_FLAG = "workhub_desktop_logged_out";

// DSK-06：令牌读写统一走 ../desktop-client-token.ts（明文 localStorage 的已知风险见该文件头部注释）。
export function clientToken(storage: Pick<Storage, "getItem"> = window.localStorage): string | undefined {
  return readDesktopClientToken(storage);
}

// 照 browser.ts 的 resolveDesktopApiBase()——同一个收口 helper（DSK-05），不 import browser.ts。
export function resolveWorkbenchApiBase(storage: Pick<Storage, "getItem"> = window.localStorage): string {
  return resolveDesktopApiBaseFromStorage(storage);
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

// 和 browser.ts 的 ensureDesktopClientToken 同语义（含 P1-02 凭据登录门状态）：登出态不重新自动绑定；
// 有 token 就探活一次，陈旧/吊销(not_identified/invalid_client_token)才清掉重铸；网络/后端问题不动 token。
// 顺带把探活拿到的 identity 返回，给 boot() 复用去解析 locale，省一次重复往返（R12 首帧同款优化）。
// gate 语义同 browser.ts：ready/needs-credentials/logged-out/offline——密码/hybrid 模式 desktop-bootstrap
// 会 404 → needs-credentials，boot() 据此渲凭据登录门而非静默无 token。
export type WorkbenchAuthGateState = "ready" | "needs-credentials" | "logged-out" | "offline";

export async function ensureWorkbenchClientToken(
  client: WorkHubApiClient
): Promise<{ identity: IdentityResponse | null; gate: WorkbenchAuthGateState }> {
  if (isWorkbenchDesktopLoggedOut()) {
    // 登出态绝不自动昵称 rebind。密码模式按上次探得的模式提示渲凭据登录门；昵称/未知保持既有行为。
    const gate = readDesktopAuthModeHint(window.localStorage) === "password" ? "needs-credentials" : "logged-out";
    return { identity: null, gate };
  }
  let identity: IdentityResponse | null = null;
  if (!clientToken()) {
    // R24 S4（E-03 根治）：首启不再盲打 desktop-bootstrap 传固定昵称——同 browser.ts 的
    // ensureDesktopClientToken 同款改法，见 desktop-login.ts 的 resolveDesktopFirstRunGateWithLock 顶注。
    const gate = await resolveDesktopFirstRunGateWithLock({
      client,
      storage: window.localStorage,
      readToken: clientToken
    });
    if (gate === "needs-credentials" || gate === "logged-out") {
      return { identity: null, gate };
    }
  } else {
    try {
      identity = await client.me();
    } catch (error) {
      if (isStaleDesktopClientTokenError(error)) {
        clearDesktopClientToken(window.localStorage);
        const gate = await resolveDesktopFirstRunGateWithLock({
          client,
          storage: window.localStorage,
          readToken: clientToken
        });
        if (gate === "needs-credentials" || gate === "logged-out") {
          return { identity: null, gate };
        }
      }
    }
  }
  const token = clientToken();
  if (token) {
    pushClientTokenToShell(token);
    return { identity, gate: "ready" };
  }
  return { identity, gate: "offline" };
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
function applyWorkbenchDeepLinkPayload(
  shell: Pick<WorkbenchShellHandle, "selectProject">,
  payload: unknown
): void {
  const plan = parseWorkbenchDeepLinkPlan(payload);
  if (!plan || !isWorkbenchWindowControlPlan(plan)) {
    return;
  }
  const context = parseWorkbenchRoute(plan.route);
  if (context?.projectId) {
    shell.selectProject(context.projectId, context.conversationId);
  }
}

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
      applyWorkbenchDeepLinkPayload(shell, event.payload);
    })
  ).catch((error) => {
    console.warn("WorkHub workbench: could not subscribe to the deep-link event", error);
  });
}

// MRG-23：订阅解决的是「窗口活着之后到来的事件」；但 workbench 窗是 create:false 按需建，Rust 侧建窗后
// 立刻 emit 的 "deep-link" 几乎总是赶在 webview 订阅之前（冷启动 URL / single-instance argv /
// focus_system_notification 三条入口都没有发起窗可以预写 localStorage stash，见 pending-deep-link.ts
// 顶部「覆盖不到的场景」）。壳层现在把最后一条深链计划按目标窗 label 暂存（TTL 15s），这里 boot 完
// 取回一次补上。与 applyPendingWorkbenchDeepLink 互补：那条管「本 App 自己发起」的路径，这条管外部唤起。
export async function applyReplayedShellDeepLink(
  shell: Pick<WorkbenchShellHandle, "selectProject">,
  options: { enabled?: boolean; takePendingDeepLink?: () => Promise<unknown> } = {}
): Promise<void> {
  // 与 applyPendingWorkbenchDeepLink 同口径（MRG-22）：登出态不消费——selectProject 会被 loggedOut
  // 守卫拦下。壳侧 stash 是一次性的，取了就被清；登出时宁可不取（留在壳侧等 TTL 过期），
  // 也不在这里消费掉一个没法落地的目标。
  if (options.enabled === false) {
    return;
  }
  const take = options.takePendingDeepLink ?? (() => takeDesktopPendingDeepLink());
  const plan = await take().catch(() => undefined);
  if (plan) {
    applyWorkbenchDeepLinkPayload(shell, plan);
  }
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

// R24 S5（N-03 根治）：主窗登录/重新绑定成功（browser.ts 的 broadcastDesktopLoggedIn /
// reloadAfterDesktopLogin）广播这个事件——工作台窗口如果这次会话里也开着（比如登录之前就已打开、
// 静默拉数据失败），此前完全没有信号知道"手里现在有一个可用 token 了"，要么一直卡在旧状态，要么
// 得等用户自己手动刷新才能捡到新 token。同 bindWorkbenchLoggedOutListener 一模一样的桥（事件名同样
// 注册在 desktop-cuu-runtime.ts 的 DesktopShellEventName，桌宠窗口 pet-surface.ts 也订阅这同一个
// 事件名），这里订阅后简单 reload 一次——boot() 会重新走一遍鉴权门判定，自然捡到新 token。
export function bindWorkbenchLoggedInListener(onLoggedIn: () => void, scope: unknown = globalThis): void {
  const listen = resolveWorkbenchTauriListen(scope);
  if (!listen) {
    // 浏览器 dev 预览 / 无 Tauri：no-op，不崩溃——同 bindWorkbenchLoggedOutListener 的既有降级路径。
    return;
  }
  void Promise.resolve(
    listen("workhub-logged-in", () => onLoggedIn())
  ).catch((error) => {
    console.warn("WorkHub workbench: could not subscribe to the workhub-logged-in event", error);
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
  now?: () => number,
  options: { enabled?: boolean } = {}
): void {
  // MRG-22：登出态/凭据门等「现在没法真正落地深链」的场合不许消费 stash——consume 是一次性删除，
  // 而 selectProject 会被 shell 的 loggedOut 守卫拦下，照删就把深链目标吞了（用户从主窗重新登录后，
  // 恢复路径 reload → 干净 boot 时 stash 还在，才能原样接回目标）。enabled === false 时连读都不读。
  if (options.enabled === false) {
    return;
  }
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

  // R24 S2（跨窗跟随）：别的窗口换了服务器 → 壳层广播 workhub-server-changed → 本窗 reload 走新地址。
  // 与 workhub-logged-out 的订阅同一条通用事件桥（bindWorkbenchLoggedOutListener 就在下面）。
  // 订阅早于鉴权门分支，否则停在连接屏/登录门的工作台窗收不到广播、一直卡在旧地址。
  bindDesktopServerChangedReload(resolveWorkbenchTauriListen(), () => window.location.reload());

  const auth = await ensureWorkbenchClientToken(client).catch(
    () => ({ identity: null, gate: "offline" as const })
  );
  // 鉴权门 → 该渲哪一屏，与主窗共用同一张表（desktop-login.ts 的 desktopBootScreenForGate）——
  // 两边此前各写一遍 if 链，已经实际漂移过（工作台既没有登出屏也没有连不上后端的分支）。
  const screen = desktopBootScreenForGate(auth.gate, "workbench");
  // P1-02（REL-5）：密码/hybrid 模式渲凭据登录门（login/register/邀请接受 → device-token exchange），
  // 成功后 reload 走既有 token 流。R24 S4：context 区分首启欢迎文案与登出后的登录文案（这台设备
  // 是从没连接过，还是曾经连接、被显式登出——isWorkbenchDesktopLoggedOut() 判定）。
  if (screen === "credential-gate") {
    bindDesktopCredentialGate(root, {
      client,
      locale,
      storage: window.localStorage,
      onSuccess: () => window.location.reload(),
      context: isWorkbenchDesktopLoggedOut() ? "logged-out" : "first-run"
    });
    return;
  }
  // R24 S2（E-02）：连不上后端时此前直接挂载工作台外壳——所有取数静默失败，整窗看着像"正常但空"，
  // 而工作台窗连离线卡都没有。补上与主窗同一屏：地址输入 → 测试连接 → 显式确认使用这台服务器。
  if (screen === "connect-server") {
    bindDesktopConnectScreen(root, {
      locale,
      apiBase: resolveWorkbenchApiBase(),
      // C1：探测客户端不带令牌——/api/health 无需鉴权，令牌绝不发给一台还没被确认的服务器。
      probe: (base) => createApiClient({ baseUrl: base }).health(),
      effects: createDesktopServerChoiceEffects({
        storage: window.localStorage,
        invoke: resolveDesktopTauriInvoke()
      }),
      reload: () => window.location.reload(),
      // 连接屏用的是主窗那套液态玻璃层，滤镜要在挂载后重建一次，否则工作台窗里这一屏渲不出玻璃。
      scheduleRebuild: () => scheduleWorkHubLiquidGlassFilterRebuild(document)
    });
    return;
  }
  const identity = auth.identity;
  locale = applyIdentityLocale(identity, locale);
  setDocumentLocale(locale);

  // chat/stream.ts 的手写 SSE 客户端要用同一个 clientToken() 读法设 X-YQGL-Client-Token 头——
  // 显式传引用，而不是让 shell.ts 用它自己的兜底默认值（两边逻辑目前碰巧一样，但显式传递才是
  // 真正的"复用 boot.ts 已有 helper"，不是"恰好重复实现了一遍"）。
  const shell = mountWorkbenchShell(root, { client, locale, getClientToken: clientToken });
  // G-desktop 止血批 3：这次 boot 本身可能就已经处在登出态（比如上一次收到跨窗口登出广播后这个窗口
  // 自己 reload 了一轮，见 shell.ts selectProject 的恢复路径注释）——必须先于下面两行深链消费判断，
  // 否则一次带着真实深链目标的冷启动会在还没展示「已登出」之前就先把请求发出去。
  // R24 S4：昵称模式的首启（这台设备从没连接过，auth.gate 判定为 "logged-out" 但并没有真的登出过）
  // 复用同一套"整窗替换"处理——workbench 不拥有登录 UI（那是主窗地盘，见 shell.ts
  // renderWorkbenchLoggedOutHtml 顶注），首启同样只能提示去主窗口，不能在这个窗口里继续静默取数。
  const loggedOutAtBoot = isWorkbenchDesktopLoggedOut();
  const signedOutAtBoot = auth.gate === "logged-out";
  if (signedOutAtBoot) {
    shell.showLoggedOut(loggedOutAtBoot ? "logged-out" : "first-run");
  }
  bindWorkbenchDeepLinkListener(shell);
  // MRG-22：登出态不消费深链 stash（consume 是一次性删除，而 selectProject 会被 loggedOut 守卫拦下，
  // 照删就把目标吞了）。留着它——重新登录后恢复路径 reload → 干净 boot 会在这里原样接回（TTL 15s 兜底）。
  applyPendingWorkbenchDeepLink(shell, window.localStorage, undefined, { enabled: !signedOutAtBoot });
  // MRG-23：壳层暂存的深链重放（窗口创建期间错过的 emit），同口径登出态不消费。
  void applyReplayedShellDeepLink(shell, { enabled: !signedOutAtBoot });
  // 运行期广播：这个窗口一直开着、之后才收到别的窗口发起的登出——见 bindWorkbenchLoggedOutListener
  // 顶部注释。showLoggedOut() 本身幂等，两条路径（这里的运行期监听 + 上面的 boot 时快照检查）都指向
  // 同一个方法，不会重复触发副作用。
  bindWorkbenchLoggedOutListener(() => shell.showLoggedOut());
  // R24 S5（N-03 根治）：同上，但反方向——主窗登录/重新绑定成功后广播，这里 reload 一次重新走鉴权门
  // 判定，捡到新落的 token（见 bindWorkbenchLoggedInListener 顶部注释）。
  bindWorkbenchLoggedInListener(() => window.location.reload());
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
