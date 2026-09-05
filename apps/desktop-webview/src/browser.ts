import { createApiClient } from "@workhub/api-client/client";
import { workHubLocaleStorageKey } from "@workhub/contracts";
import { createCuuController } from "@workhub/cuu";
import type { WorkHubLocale } from "@workhub/ui/gold-path";
import {
  applyIdentityLocale,
  browserLocale,
  setDocumentLocale
} from "@workhub/web-runtime";

import {
  clearDesktopClientToken,
  readDesktopClientToken
} from "./desktop-client-token.js";
import { resolveDesktopApiBaseFromStorage } from "./desktop-api-base.js";
import { startVisibilityAwarePolling } from "./desktop-visibility-polling.js";
import {
  resolveDesktopShellEmitter,
  resolveDesktopShellListen,
  saveDesktopCuuProjectContextFromRoute
} from "./desktop-cuu-runtime.js";
import { loadCuuPreferences } from "./cuu-preferences.js";
import {
  bindDesktopConnectScreen,
  bindDesktopServerChangedReload,
  createDesktopServerChoiceEffects
} from "./desktop-connect-screen.js";
import { fitDesktopMainWindowToBootScreen } from "./desktop-boot-screen-fit.js";
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
  resizeDesktopMainWindow,
  resolveDesktopTauriInvoke,
  takeDesktopPendingDeepLink
} from "./desktop-window-controls.js";
import {
  mountSpotlight,
  type SpotlightManualDragFn,
  type SpotlightResizeFn
} from "./spotlight/controller.js";
import { isStaleDesktopClientTokenError } from "./auth-recovery.js";
import {
  bindDesktopCredentialGate,
  desktopBootScreenForGate,
  isPasswordModeBootstrapError,
  readDesktopAuthModeHint,
  resolveDesktopFirstRunGateWithLock,
  type DesktopCredentialGateContext
} from "./desktop-login.js";
import { isDesktopFirstRun, markDesktopOnboarded } from "./desktop-first-run.js";

const root = document.getElementById("root");
type BrowserApiClient = ReturnType<typeof createApiClient>;

// DSK-06：令牌读写统一走 desktop-client-token.ts（明文 localStorage 的已知风险见该文件头部注释）。
function clientToken() {
  return readDesktopClientToken(window.localStorage);
}

// 测试反馈修复（窗口空白）：打包后 webview 的同源是 tauri://（没有 /api），baseUrl="" 会让所有 API 调用落空、
// 首页加载不出→整窗空白。桌面客户端改为默认连本机后端（API 默认端口），并可用 localStorage.workhub_api_base
// 覆盖（指向远端/不同端口的 WorkHub 后端）。后端 CORS 已反射桌面 tauri 源 + 本机回环（apps/api app.ts），故跨源带
// cookie 可达。注意：仍需后端在跑；连不上时显示的是连接错误而非空白。
// DSK-05：覆盖值的读取/校验收口到 desktop-api-base.ts——非法值（非 http/https、带凭据/查询串）按未配置处理。
function resolveDesktopApiBase(): string {
  return resolveDesktopApiBaseFromStorage(window.localStorage);
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

// R24 S4（E-03 根治）：首启无 token 时不再盲打 desktop-bootstrap 传固定昵称——那条路在昵称模式下有
// 真实副作用（会建/复用一个昵称为 "WorkHub Desktop" 的账号，全团队装同一个包=服务器上同一个人）。
// 判定该渲哪张登录门改用 resolveDesktopFirstRunGateWithLock（desktop-login.ts）：先看 /api/health 的
// auth_mode（或已记的提示），跨窗锁只在"另一扇窗口这段时间已经完成登录"时省一次判定，不再保护任何
// 会创建账号的调用——真正换 token 的调用现在只发生在用户在登录门/首启屏里显式提交之后。

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
    // R24 S4（E-03 根治）：首启不再盲打 desktop-bootstrap——先判定该渲哪张登录门（昵称首启屏 or
    // 密码/hybrid 凭据门），真正换 token 的调用只在用户显式提交之后发生（desktop-rebind.ts /
    // desktop-login.ts）。"ready" 只在另一扇窗口这段时间已经落了 token 时出现，直接落到下面统一的
    // token 检查收尾；"offline" 同样落到下面（会发现仍然没有 token，如实回退离线）。
    const gate = await resolveDesktopFirstRunGateWithLock({
      client,
      storage: window.localStorage,
      readToken: clientToken
    });
    if (gate === "needs-credentials" || gate === "logged-out") {
      return gate;
    }
  } else {
    // rank16：已有 token 也要探活一次——若被吊销/陈旧(not_identified)，清掉重铸，
    // 否则主窗/桌宠会拿着死 token 永远静默拉不到数据（旧的只在「无 token」时引导，覆盖不到这种情况）。
    // 非身份类错误（网络/后端不可达）不动 token：交给上层离线兜底。
    try {
      await client.me();
    } catch (error) {
      if (isStaleDesktopClientTokenError(error)) {
        clearDesktopClientToken(window.localStorage);
        const gate = await resolveDesktopFirstRunGateWithLock({
          client,
          storage: window.localStorage,
          readToken: clientToken
        });
        if (gate === "needs-credentials" || gate === "logged-out") {
          return gate;
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

// 首启（这台设备第一次连接，从未有过 token）与真登出用同一张凭据门/重绑屏，只是标题/说明不同——
// desktopLoggedOut() 为真才是真登出，否则就是首启（gate 复用同一个 "logged-out"/"needs-credentials"
// 值只是为了不用在 bootSpotlight 里再加一条分支，见该函数调用处的注释）。
function desktopCredentialGateContext(): DesktopCredentialGateContext {
  return desktopLoggedOut() ? "logged-out" : "first-run";
}

// R24 H（首启窗口裁切）：三张 boot 屏（首启/重绑昵称屏、凭据门、连接服务器屏）都是直接渲进主窗根节点
// 的，从不经过聚焦盒控制器——而 set_spotlight_size 只有那个控制器的 applyResize 会调，于是首启时窗口
// 一直停在出厂的细搜索条尺寸（720×64，client-tauri windows.rs），卡片被原生窗裁得只剩标题（用户截图）。
// 这里给三张屏共用一条「量内容 → 缩放主窗」的通道（desktop-boot-screen-fit.ts，与 applyResize 同口径）。
// 换屏前先 dispose 上一次：屏与屏之间共用同一个 #root，不摘掉旧观察者会有两套各自下发同一个尺寸。
let disposeBootScreenFit: (() => void) | undefined;
function fitBootScreenToMainWindow(rootEl: HTMLElement): void {
  disposeBootScreenFit?.();
  disposeBootScreenFit = fitDesktopMainWindowToBootScreen(rootEl, {
    // 与聚焦盒同一条壳层命令（set_spotlight_size）；浏览器开发态无 __TAURI__ → no-op。
    resize: (width, height) => resizeDesktopMainWindow(width, height)
  });
}

// 密码/hybrid 模式凭据门：接到既有 login/register/邀请接受 → device-token exchange 流程，成功后 reload
// 走既有 token 流。
function mountDesktopCredentialGate(rootEl: HTMLElement, client: BrowserApiClient, locale: WorkHubLocale): void {
  bindDesktopCredentialGate(rootEl, {
    client,
    locale,
    storage: window.localStorage,
    onSuccess: () => window.location.reload(),
    context: desktopCredentialGateContext()
  });
  fitBootScreenToMainWindow(rootEl);
}

// DSK-01：昵称模式显式登出态的重新绑定屏（原死 boot() 里的内联实现，抽到 desktop-rebind.ts 便于单测）；
// R24 S4：同一张屏也服务首启（这台设备从未连接过、resolveDesktopFirstRunGate 判定/默认为昵称模式）。
// 输入昵称 → desktop-bootstrap → 落 token → reload 走既有 token 流；如果首启的默认假设猜错了（提交后
// 探到 404，说明其实是密码/hybrid 模式），就地切到凭据门，不需要用户自己诊断。
function mountDesktopRebindScreen(rootEl: HTMLElement, client: BrowserApiClient, locale: WorkHubLocale): void {
  bindDesktopRebindScreen(rootEl, {
    client,
    locale,
    storage: window.localStorage,
    onSuccess: () => window.location.reload(),
    context: desktopCredentialGateContext(),
    // 就地换成凭据门：mountDesktopCredentialGate 自己会重新贴合窗口（凭据门比昵称屏高一截，
    // 不重量的话新卡片会被裁掉下半张）。
    onPasswordModeDetected: () => mountDesktopCredentialGate(rootEl, client, locale)
  });
  fitBootScreenToMainWindow(rootEl);
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

// R24 S2：连不上后端 → 渲「连接到你的服务器」屏（地址输入 + 测试连接 + 结果卡 + 显式确认）。
// 此前这里是一张「离线卡」，而它只在未捕获异常时才渲；真实的「连不上」（gate === "offline"）
// 根本不抛异常，用户看到的是一条什么都不说的空搜索条，也没有任何入口能改服务器地址（E-02）。
// 现在两条路径（gate offline / boot 抛错）都落到同一屏，全仓只此一处服务器地址入口。
// 探测客户端刻意**不带令牌**（C1）：/api/health 无需鉴权，令牌绝不发给一台还没被确认的服务器。
function mountDesktopConnectScreen(rootEl: HTMLElement, locale: WorkHubLocale, error?: unknown): void {
  const detail = error === undefined ? undefined : error instanceof Error ? error.message : String(error);
  bindDesktopConnectScreen(rootEl, {
    locale,
    apiBase: resolveDesktopApiBase(),
    ...(detail ? { detail } : {}),
    probe: (base) => createApiClient({ baseUrl: base }).health(),
    effects: createDesktopServerChoiceEffects({
      storage: window.localStorage,
      invoke: resolveDesktopTauriInvoke()
    }),
    reload: () => window.location.reload(),
    scheduleRebuild: () => scheduleWorkHubLiquidGlassFilterRebuild(document)
  });
  fitBootScreenToMainWindow(rootEl);
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
  // R24 S2（跨窗跟随）：别的窗口换了服务器 → 壳层广播 workhub-server-changed → 本窗 reload 走新地址。
  // 订阅要早于下面的鉴权门分支，否则停在连接屏/登录门的窗口收不到这条广播，会一直卡在旧地址那一屏。
  bindDesktopServerChangedReload(resolveDesktopShellListen(), () => window.location.reload());
  try {
    const client = createApiClient({
      baseUrl: resolveDesktopApiBase(),
      getClientToken: clientToken
    });
    // 跨源鉴权地基：先确保有 client token（goldPath/pages 才返回 LIVE 数据），并把令牌推给 Rust 壳（SSE /me 鉴权）。
    const gate = await ensureDesktopClientToken(client);
    // 鉴权门 → 该渲哪一屏，走与工作台窗共用的那张表（desktop-login.ts 的 desktopBootScreenForGate）：
    // - credential-gate：P1-02（REL-5）密码/hybrid 模式没有昵称自助引导，渲凭据登录门
    //   （login → device-token exchange），登录成功后 reload 走既有 token 流；
    // - rebind：DSK-01 昵称模式的显式登出态，渲「输入昵称重新绑定这台设备」屏；
    // - connect-server：R24 S2（E-02）连不上后端。此前这条路径**没有任何分支**，会继续挂载一个
    //   取不到数的空聚焦盒——用户既看不到一句错误，也走不到唯一的服务器地址输入框。
    const screen = desktopBootScreenForGate(gate, "spotlight");
    if (screen === "credential-gate") {
      mountDesktopCredentialGate(root, client, locale);
      return;
    }
    if (screen === "rebind") {
      mountDesktopRebindScreen(root, client, locale);
      return;
    }
    if (screen === "connect-server") {
      mountDesktopConnectScreen(root, locale);
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
    // R24 S6：落地页首次登录渲「建你的第一个项目」引导卡，而不是空网格（E-10）；顺带把 AI
    // 是否配置的事实亮在聚焦盒顶部（E-11，只用聚焦盒的人此前完全看不到工作台聊天区才有的那条提示）。
    // 两者都是 best-effort：health 探测失败就不渲横幅（同 workbench 聊天区 loadAiProviderHealth 的
    // 既有取舍——探测失败≠没配置，不能吓用户）。
    const health = await client.health().catch(() => undefined);
    const firstRun = isDesktopFirstRun(window.localStorage);
    const spotlight = mountSpotlight({
      host: hostEl,
      client,
      locale,
      resize: resizeMainWindow,
      drag: dragMainWindow,
      dragMove: moveMainWindowBy,
      dismiss: dismissMainWindow,
      firstRun,
      onFirstRunComplete: () => markDesktopOnboarded(window.localStorage),
      ...(typeof health?.ai_provider_configured === "boolean"
        ? { aiProviderConfigured: health.ai_provider_configured }
        : {}),
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
    // MRG-23：冷启动深链（应用未运行时 OS 直接唤起 workhub://…）在主窗 webview 订阅前就 emit 了——
    // 挂载完成后向壳层取回暂存的最后一条（按窗口 label 认领，这里只会拿到发给 main 的），不再丢。
    void takeDesktopPendingDeepLink().then((plan) => {
      if (plan) {
        handleDesktopSpotlightShellNavigate(plan, {
          spotlight,
          saveProjectContextFromRoute: saveDesktopCuuProjectContextFromRoute
        });
      }
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
    // DSK-10：轮询随窗口可见性暂停——聚焦盒长期隐藏（常态）时不再空打后端；重新可见立刻补刷一次。
    // 返回的 disposer 会清表 + 摘监听（当前 Spotlight 壳不卸载，disposer 主要为对称/可测性留着）。
    startVisibilityAwarePolling({
      refresh: () => void refreshApprovalsBadge(),
      intervalMs: 30_000
    });
    window.addEventListener("focus", () => void refreshApprovalsBadge());
  } catch (error) {
    mountDesktopConnectScreen(root, locale, error);
  }
}

if (root && resolveDesktopSurface() === "pet") {
  // C2 修复：桌宠窗口此前用 baseUrl:"" 建客户端 → 所有 API/SSE 落到死的 tauri:// 源 → 永远「离线」。
  // 改为传入与主窗一致的客户端（真实 API base + client token），桌宠才能真正连后端、SSE 才能鉴权。
  void (async () => {
    // R24 S2：桌宠窗不渲连接服务器屏（那是主窗/工作台的事），但必须跟着换服务器——否则它会拿着
    // 旧地址永远「重连中」。同 workhub-logged-out 的跨窗广播模式。
    bindDesktopServerChangedReload(resolveDesktopShellListen(), () => window.location.reload());
    const petClient = createApiClient({
      baseUrl: resolveDesktopApiBase(),
      getClientToken: clientToken
    });
    const gate = await ensureDesktopClientToken(petClient);
    // R24 S4：桌宠窗没有表单空间渲登录门（260×340）——沿用桌宠既有「工作台不拥有重新登录 UI，
    // 那是主窗的地盘」同款取舍（见 workbench/shell.ts renderWorkbenchLoggedOutHtml 顶注），把用户
    // 导向主窗；first-run 与真登出共用同一张提示卡，只是文案不同（desktopLoggedOut() 判定上下文）。
    const signInNeededContext: DesktopCredentialGateContext | undefined =
      gate === "needs-credentials" || gate === "logged-out" ? desktopCredentialGateContext() : undefined;
    await bootDesktopPetSurface(root, {
      client: petClient,
      ...(signInNeededContext ? { signInNeededContext } : {})
    });
  })();
} else {
  void bootSpotlight();
}
