import { createApiClient } from "@workhub/api-client/client";
import { workHubLocaleStorageKey } from "@workhub/contracts";
import { defaultPorts } from "@workhub/config/ports";
import { createCuuController } from "@workhub/cuu";
import type { WorkHubLocale } from "@workhub/ui/gold-path";
import {
  applyIdentityLocale,
  browserLocale,
  setDocumentLocale
} from "@workhub/web-runtime";

import {
  resolveDesktopShellEmitter,
  resolveDesktopShellListen,
  saveDesktopCuuProjectContextFromRoute
} from "./desktop-cuu-runtime.js";
import { loadCuuPreferences } from "./cuu-preferences.js";
import { bindDesktopOfflineCard } from "./desktop-offline-card.js";
import { renderDesktopSpotlightBootShell } from "./desktop-spotlight-boot.js";
import { bootDesktopPetSurface, resolveDesktopSurface } from "./pet-surface.js";
import { scheduleWorkHubLiquidGlassFilterRebuild } from "./liquid-glass-filter.js";
import {
  desktopPetWindowSettingsFromPreferences,
  resolveDesktopPetWindowBridge
} from "./pet-window-bridge.js";
import { handleDesktopSpotlightShellNavigate } from "./spotlight-shell-navigation.js";
import { bindDesktopRebindScreen } from "./desktop-rebind.js";
import {
  dismissDesktopMainWindow,
  dragDesktopMainWindow,
  moveDesktopMainWindowBy as moveDesktopMainWindowByCommand,
  resizeDesktopMainWindow
} from "./desktop-window-controls.js";
import {
  mountSpotlight,
  type SpotlightManualDragFn,
  type SpotlightResizeFn
} from "./spotlight/controller.js";
import { isStaleDesktopClientTokenError } from "./auth-recovery.js";
import {
  bindDesktopCredentialGate,
  isPasswordModeBootstrapError,
  readDesktopAuthModeHint,
  rememberDesktopAuthModeHint,
  runDesktopBootstrapWithLock
} from "./desktop-login.js";

const root = document.getElementById("root");
type BrowserApiClient = ReturnType<typeof createApiClient>;

function clientToken() {
  return window.localStorage.getItem("workhub_client_token") ?? window.localStorage.getItem("yqgl_client_token") ?? undefined;
}

// 测试反馈修复（窗口空白）：打包后 webview 的同源是 tauri://（没有 /api），baseUrl="" 会让所有 API 调用落空、
// 首页加载不出→整窗空白。桌面客户端改为默认连本机后端（API 默认端口），并可用 localStorage.workhub_api_base
// 覆盖（指向远端/不同端口的 WorkHub 后端）。后端 CORS 已反射桌面 tauri 源 + 本机回环（apps/api app.ts），故跨源带
// cookie 可达。注意：仍需后端在跑；连不上时显示的是连接错误而非空白。
function resolveDesktopApiBase(): string {
  const override = window.localStorage.getItem("workhub_api_base");
  if (override && override.trim().length > 0) {
    return override.trim().replace(/\/+$/u, "");
  }
  return `http://127.0.0.1:${defaultPorts.api}`;
}

// 桌面跨源(tauri://localhost→127.0.0.1)无法用 SameSite=Lax cookie 鉴权，必须持 client token 走 header。
// 首启若本地无 token，调 /api/auth/desktop-bootstrap（昵称 identify + 设备注册一步到位、CSRF 豁免）拿到 token
// 落 localStorage；之后 createApiClient 的 getClientToken 每请求实时读它发 X-YQGL-Client-Token → 鉴权 + 同源
// 守卫双通过，goldPath 返回 LIVE 数据（不再静默回退 fixture）、所有 mutation 不再被跨站拒绝。
// 失败(密码模式 404 / 后端离线)静默：上层取数失败会显示连接错误，不阻断渲染。
// R8：把设备令牌推给 Rust 壳层（managed ShellClientToken），供其 SSE worker 每次重连注入鉴权头 →
// 全局 /api/push/stream 不再 401、Cuu 上线（Rust 用 reqwest 开全局流，拿不到 webview 的 localStorage 令牌）。
function pushClientTokenToShell(token: string): void {
  const tauri = (globalThis as {
    __TAURI__?: {
      core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
      invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  }).__TAURI__;
  const invoke = tauri?.core?.invoke ?? tauri?.invoke;
  if (typeof invoke === "function") {
    void invoke("set_client_token", { token }).catch(() => undefined);
  }
}

// R15 批 A6（托盘/Dock 角标）：把「有几件待办/未读」推到 Rust 壳层的 set_shell_badge（macOS Dock 角标 +
// 托盘 tooltip）。浏览器 dev 态无 __TAURI__ → 优雅降级为 no-op（同 pushClientTokenToShell 的既有取舍）。
function pushShellBadgeToShell(count: number, locale: WorkHubLocale): void {
  const tauri = (globalThis as {
    __TAURI__?: {
      core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
      invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  }).__TAURI__;
  const invoke = tauri?.core?.invoke ?? tauri?.invoke;
  if (typeof invoke === "function") {
    void invoke("set_shell_badge", { count: Math.max(0, Math.floor(count)), locale }).catch(() => undefined);
  }
}

// P1-02（REL-5）：昵称模式成功=拿到 token(ready)；密码/hybrid 模式 desktop-bootstrap 会 404 →
// 需要凭据登录(needs-credentials)，不再当「离线」静默吞；后端不可达等=unavailable。
type DesktopBootstrapOutcome = "ready" | "needs-credentials" | "unavailable";

async function bootstrapDesktopClientToken(client: BrowserApiClient): Promise<DesktopBootstrapOutcome> {
  try {
    const result = await client.bootstrapDesktop({
      nickname: "WorkHub Desktop",
      device_name: "WorkHub Desktop",
      platform: "desktop"
    });
    if (result?.client_token) {
      window.localStorage.setItem("workhub_client_token", result.client_token);
      rememberDesktopAuthModeHint(window.localStorage, "nickname");
      return "ready";
    }
    return "unavailable";
  } catch (error) {
    if (isPasswordModeBootstrapError(error)) {
      // 密码/hybrid 模式：桌面要凭据登录换令牌（见 desktop-login.ts）。记下模式，供登出后选对登录门。
      rememberDesktopAuthModeHint(window.localStorage, "password");
      return "needs-credentials";
    }
    // 后端不可达等：保持无 token；上层取数失败会显示连接错误。记一行便于诊断（不含敏感信息）。
    console.warn("WorkHub desktop bootstrap failed; continuing without client token", error);
    return "unavailable";
  }
}

// DSK-07：包一层跨窗启动锁——主窗/桌宠/工作台首启并发 bootstrap 会重复注册设备、双 token 互覆。
// 没抢到锁的窗口短轮询重读 token，胜者落盘即拿到现成令牌（见 desktop-login.ts 顶部注释）。
async function bootstrapDesktopClientTokenWithLock(client: BrowserApiClient): Promise<DesktopBootstrapOutcome> {
  const locked = await runDesktopBootstrapWithLock({
    storage: window.localStorage,
    readToken: clientToken,
    run: () => bootstrapDesktopClientToken(client)
  });
  if (locked.kind === "ran") {
    return locked.result;
  }
  // token-ready（胜者已落盘，下面 clientToken() 会读到）/ busy（放弃，落离线兜底）。
  return locked.kind === "token-ready" ? "ready" : "unavailable";
}

// R10（真登出）：登出后 boot 不许再用固定昵称自动 bootstrap 绑回同一账户——否则登出形同虚设。
const DESKTOP_LOGGED_OUT_FLAG = "workhub_desktop_logged_out";

export function desktopLoggedOut(): boolean {
  try {
    return window.localStorage.getItem(DESKTOP_LOGGED_OUT_FLAG) === "1";
  } catch {
    return false;
  }
}

// P1-02（REL-5）：返回鉴权门状态，让 boot 决定渲主窗还是凭据登录门。
// - ready：已有可用 token；
// - needs-credentials：密码/hybrid 模式要凭据登录（fresh/stale 探到 404，或登出后按模式提示）；
// - logged-out：昵称模式的显式登出态（保持既有「不自动 rebind」，渲重新绑定屏——见 bootSpotlight）；
// - offline：拿不到 token 也非上述（后端不可达等），交给上层离线兜底。
type DesktopAuthGateState = "ready" | "needs-credentials" | "logged-out" | "offline";

async function ensureDesktopClientToken(client: BrowserApiClient): Promise<DesktopAuthGateState> {
  if (desktopLoggedOut()) {
    // 登出态绝不自动昵称 rebind（否则登出形同虚设）。密码模式没有「自动」可言——按上次探得的模式提示：
    // 密码模式渲凭据登录门；昵称/未知模式渲重新绑定屏（bootSpotlight 的 logged-out 分支，见 DSK-01）。
    return readDesktopAuthModeHint(window.localStorage) === "password" ? "needs-credentials" : "logged-out";
  }
  if (!clientToken()) {
    if ((await bootstrapDesktopClientTokenWithLock(client)) === "needs-credentials") {
      return "needs-credentials";
    }
  } else {
    // rank16：已有 token 也要探活一次——若被吊销/陈旧(not_identified)，清掉重铸，
    // 否则主窗/桌宠会拿着死 token 永远静默拉不到数据（旧的只在「无 token」时引导，覆盖不到这种情况）。
    // 非身份类错误（网络/后端不可达）不动 token：交给上层离线兜底。
    try {
      await client.me();
    } catch (error) {
      if (isStaleDesktopClientTokenError(error)) {
        window.localStorage.removeItem("workhub_client_token");
        if ((await bootstrapDesktopClientTokenWithLock(client)) === "needs-credentials") {
          return "needs-credentials";
        }
      }
    }
  }
  const token = clientToken();
  if (token) {
    pushClientTokenToShell(token);
    return "ready";
  }
  return "offline";
}

// 密码/hybrid 模式凭据登录门：接到既有 login → device-token exchange 流程，成功后 reload 走既有 token 流。
function mountDesktopCredentialGate(rootEl: HTMLElement, client: BrowserApiClient, locale: WorkHubLocale): void {
  bindDesktopCredentialGate(rootEl, {
    client,
    locale,
    storage: window.localStorage,
    onSuccess: () => window.location.reload()
  });
}

// DSK-01：昵称模式显式登出态的重新绑定屏（原死 boot() 里的内联实现，抽到 desktop-rebind.ts 便于单测）。
// 输入昵称 → desktop-bootstrap 重新绑定这台设备 → 清登出标记 → reload 走既有 token 流。
function mountDesktopRebindScreen(rootEl: HTMLElement, client: BrowserApiClient, locale: WorkHubLocale): void {
  bindDesktopRebindScreen(rootEl, {
    client,
    locale,
    storage: window.localStorage,
    onSuccess: () => window.location.reload()
  });
}

// R8 真·Spotlight：把内容高度同步给原生壳，缩放主窗（盒子随内容生长/收缩）。浏览器开发态无 __TAURI__ → no-op。
const resizeMainWindow: SpotlightResizeFn = (width, height) => {
  resizeDesktopMainWindow(width, height);
};

// 搜索条像系统 Spotlight 一样可拖动；浏览器开发态无 __TAURI__ → no-op。
const dragMainWindow = (): void => {
  dragDesktopMainWindow();
};

const moveMainWindowBy: SpotlightManualDragFn = (deltaX, deltaY): void => {
  moveDesktopMainWindowByCommand(deltaX, deltaY);
};

// M2：launcher 顶层 Esc → 隐藏主窗（关闭盒子），兑现 hello 卡「Esc 关闭」承诺。浏览器开发态无 __TAURI__ → no-op。
const dismissMainWindow = (): void => {
  dismissDesktopMainWindow();
};

// 连不上后端时渲一张清晰的玻璃「离线卡」：说明需要后端、当前地址、怎么改、重试。
function renderDesktopOfflineCard(rootEl: HTMLElement, locale: WorkHubLocale, error: unknown): void {
  const apiBase = resolveDesktopApiBase();
  const detail = error instanceof Error ? error.message : String(error);
  bindDesktopOfflineCard(rootEl, {
    apiBase,
    detail,
    locale,
    storage: window.localStorage,
    reload: () => window.location.reload(),
    scheduleRebuild: () => scheduleWorkHubLiquidGlassFilterRebuild(document)
  });
}

// R8 彻底重构主窗：苹果聚焦搜索式「会生长的玻璃盒」就是整个 app（旧的 gold-path 全屏壳 boot() 已随 DSK-01 删除——
// 它自 R8 起就没有任何调用方，是死代码）。复用跨域鉴权地基（client token bootstrap）+ locale；
// 挂 Spotlight 控制器；把桌宠偏好同步给桌宠窗（Cuu 为核心）。
async function bootSpotlight() {
  if (!root) {
    return;
  }
  let locale = browserLocale();
  setDocumentLocale(locale);
  // R12（首帧）：此前两次网络往返（token 探活 + locale me）完成前 #root 是空 div、整窗白屏——
  // 先同步渲一帧占位盒，让窗口一出现就有画面。
  root.innerHTML = renderDesktopSpotlightBootShell();
  try {
    const client = createApiClient({
      baseUrl: resolveDesktopApiBase(),
      getClientToken: clientToken
    });
    // 跨源鉴权地基：先确保有 client token（goldPath/pages 才返回 LIVE 数据），并把令牌推给 Rust 壳（SSE /me 鉴权）。
    const gate = await ensureDesktopClientToken(client);
    // P1-02（REL-5）：密码/hybrid 模式没有昵称自助引导——渲凭据登录门（login → device-token exchange），
    // 登录成功后 reload 走既有 token 流。昵称模式不进这一分支（gate 只在 desktop-bootstrap 404 时才是它）。
    if (gate === "needs-credentials") {
      mountDesktopCredentialGate(root, client, locale);
      return;
    }
    // DSK-01（真登出）：昵称模式的显式登出态——渲「输入昵称重新绑定这台设备」屏，不再继续挂载 Spotlight。
    // 此前这张屏只存在于死 boot() 里，登出后这里会继续往下挂载、所有取数静默失败，全应用无重新登录入口。
    if (gate === "logged-out") {
      mountDesktopRebindScreen(root, client, locale);
      return;
    }
    // R12（首帧）：resolveBootLocale 内部的 me() 与 ensureDesktopClientToken 的探活是同一请求的重复——
    // 直接拿一次 me 结果解析 locale，省一拍串行往返。
    const bootMe = await client.me().catch(() => null);
    locale = applyIdentityLocale(bootMe, locale);
    root.innerHTML = renderDesktopSpotlightBootShell();
    const hostEl = root.querySelector<HTMLElement>("[data-spot-host]");
    if (!hostEl) {
      return;
    }
    // Cuu 为核心：主窗启动把桌宠偏好同步给桌宠窗（保持桌宠行为不回归）。
    const petWindowBridge = resolveDesktopPetWindowBridge();
    const shellEmitter = resolveDesktopShellEmitter();
    const notifyPetAttentionRefresh = () => {
      const payload = { reason: "spotlight-action-settled" };
      const sent = shellEmitter?.emitTo?.("pet", "attention-refresh", payload);
      if (!shellEmitter?.emitTo && shellEmitter?.emit) {
        void Promise.resolve(shellEmitter.emit("attention-refresh", payload)).catch(() => undefined);
        return;
      }
      void Promise.resolve(sent).catch(() => undefined);
    };
    const cuuController = createCuuController({ preferences: loadCuuPreferences() });
    void (async () => {
      try {
        await petWindowBridge?.setSettings?.(
          desktopPetWindowSettingsFromPreferences(cuuController.snapshot().preferences)
        );
      } catch {
        // 桥不可用/桌宠窗未就绪：忽略，主窗照常。
      }
    })();
    const spotlight = mountSpotlight({
      host: hostEl,
      client,
      locale,
      resize: resizeMainWindow,
      drag: dragMainWindow,
      dragMove: moveMainWindowBy,
      dismiss: dismissMainWindow,
      onActionSettled: () => {
        void refreshApprovalsBadge();
        notifyPetAttentionRefresh();
      }
    });
    scheduleWorkHubLiquidGlassFilterRebuild(document);
    // 以 Cuu 为核心：托盘「打开收件箱/设置」、深链、桌宠点击都会让主窗 emit "navigate"（main.rs execute_window_control）。
    // 监听它 → 把盒子直接开到对应能力（回 "/" 则回 launcher）。这是 Cuu/外部入口与盒子联动的地基。
    const shellListen = resolveDesktopShellListen();
    // R10（偏好同步）：桌宠窗切语言→主窗跟随写本地偏好并 reload（与自身 bindLocaleSwitch 同款生效路径），
    // 两窗语言态不再长期漂移到下次重启。
    void shellListen?.("pet-locale-changed", (event) => {
      const nextLocale = (event.payload as { locale?: string } | undefined)?.locale;
      if (nextLocale === "zh-CN" || nextLocale === "en-US") {
        try {
          // R11 回归修复：此前手写 "workhub_locale"（下划线）——browserLocale() 读的是
          // workHubLocaleStorageKey="workhub.locale"（点分），写入是死代码。
          window.localStorage.setItem(workHubLocaleStorageKey, nextLocale);
        } catch {
          // ignore
        }
        window.location.reload();
      }
    });
    void shellListen?.("navigate", (event) => {
      handleDesktopSpotlightShellNavigate(event.payload, {
        spotlight,
        saveProjectContextFromRoute: saveDesktopCuuProjectContextFromRoute
      });
    });
    // rank12：把「待你拍板」实时条数喂给 launcher 审批角标——盒子的核心承诺是一眼看到有几条待决策。
    // 启动拉一次 + 每 30s + 窗口重新聚焦时刷新；best-effort，失败不更新角标、不影响盒子。
    const refreshApprovalsBadge = async () => {
      try {
        const att = await client.pages.attention({ locale });
        const approvals = att.queue?.length ?? 0;
        spotlight.setBadges({ approvals });
        // R15 批 A6（托盘/Dock 角标）：把「待你拍板 + 未读通知」推到系统托盘/Dock 层（workbench 关着、
        // 聚焦盒收着也能看到有事要处理）。未读走既有 GET /api/notifications 的 counts.unread（不新造端点），
        // 拉不到就只用 attention 数，不阻塞 Dock 角标（best-effort，与 spotlight 角标同一节奏刷/聚焦归零）。
        let unread = 0;
        try {
          unread = (await client.notifications()).counts?.unread ?? 0;
        } catch {
          // 未读拉不到就当 0（只用待拍板数），不因此让 Dock 角标失败。
        }
        pushShellBadgeToShell(approvals + unread, locale);
      } catch {
        // 角标尽力而为。
      }
    };
    void refreshApprovalsBadge();
    window.setInterval(() => void refreshApprovalsBadge(), 30_000);
    window.addEventListener("focus", () => void refreshApprovalsBadge());
  } catch (error) {
    renderDesktopOfflineCard(root, locale, error);
  }
}

if (root && resolveDesktopSurface() === "pet") {
  // C2 修复：桌宠窗口此前用 baseUrl:"" 建客户端 → 所有 API/SSE 落到死的 tauri:// 源 → 永远「离线」。
  // 改为传入与主窗一致的客户端（真实 API base + client token），桌宠才能真正连后端、SSE 才能鉴权。
  void (async () => {
    const petClient = createApiClient({
      baseUrl: resolveDesktopApiBase(),
      getClientToken: clientToken
    });
    await ensureDesktopClientToken(petClient);
    await bootDesktopPetSurface(root, { client: petClient });
  })();
} else {
  void bootSpotlight();
}
