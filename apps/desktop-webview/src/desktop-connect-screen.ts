// WorkHub 桌面 · 「连接到你的服务器」屏（R24 S2）。
//
// 要解决的事：桌面端是产品核心，而团队的服务器几乎从来不在本机（局域网 IP 或公司域名）。此前
//   1) 打包后的 CSP 只放行本机回环，改了地址也连不出去（R24 S1 已放开，见 tauri.conf.json）；
//   2) 「连不上后端」这条路径根本不渲任何东西——ensureDesktopClientToken 把网络失败吞成 offline，
//      而 bootSpotlight/工作台 boot 都没有 offline 分支，用户看到的是一条正常的空搜索条，
//      输入什么都没结果、没有一句错误，也**没有任何入口**能走到唯一那个服务器地址输入框
//      （它藏在只在未捕获异常时才渲的离线卡里）。
// 这个模块就是补上的那一屏：地址输入 → 测试连接 → 看清这台服务器是什么 → 显式确认使用。
//
// 三道补偿控制（CSP 出口闸放开之后必须由应用层守住，见 desktop-api-base.ts 顶部注释）：
//   C1 单 origin 钉死：探测用的客户端**不带设备令牌**（/api/health 无需鉴权），令牌不会被送给一台
//      还没被用户确认的服务器；确认之后所有请求由 api-client 的 resolveWorkHubApiUrl 钉在这个 origin 上。
//   C2 地址只能来自**用户键盘输入**：本屏的输入框是唯一来源，绝不从深链、剪贴板、window.name 或任何
//      服务端响应体里自动采纳地址；改地址必须走「测试连接 → 看到这台服务器的信息 → 显式确认」三步，
//      「使用这台服务器」在探测成功前一直是禁用的。
//   C3 换服务器即清身份：确认时先清设备令牌（A 服务器的令牌绝不发给 B），再写地址，再通知壳层。
//
// 三窗共享：localStorage 的 workhub_api_base 仍是 webview 侧唯一真相（main/pet/workbench 同源天然
// 共享）。壳层（Rust）另有一份 server_url 供 SSE worker 用，靠 set_server_url 命令跟随；壳层随后广播
// workhub-server-changed，其余窗口收到即自行 reload（复用 workhub-logged-out 那条广播的既有模式）。

import type { HealthResponse } from "@workhub/api-client";
import type { WorkHubLocale } from "@workhub/ui/gold-path";

import {
  DESKTOP_API_BASE_STORAGE_KEY,
  defaultDesktopApiBase,
  normalizeDesktopApiBase
} from "./desktop-api-base.js";
import { desktopBootPanel, renderDesktopBootPanelHtml } from "./desktop-boot-panel.js";
import { clearDesktopClientToken } from "./desktop-client-token.js";
import { forgetDesktopAuthModeHint, rememberDesktopAuthModeHint } from "./desktop-login.js";

// 壳层换服务器后的跨窗广播事件名（Rust 侧 set_server_url 成功后 emit，payload {url}）。
// 与 workhub-logged-out 同一条通用 Tauri 事件桥，不另起协议。
export const DESKTOP_SERVER_CHANGED_EVENT = "workhub-server-changed";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/gu, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char
  ));
}

// ---------------------------------------------------------------------------
// 探测（纯逻辑，便于单测）
// ---------------------------------------------------------------------------

export type DesktopServerProbeOutcome =
  // 地址本身就不合法（normalizeDesktopApiBase 拒了）——不发任何请求。
  | { kind: "invalid-address" }
  // 打得出去但没应答/超时/CORS 被拒等。detail 是给「原始错误」折叠区看的原文。
  | { kind: "unreachable"; base: string; detail: string }
  // 有应答，但应答的不是 WorkHub 服务端（填错端口、打到别的服务上）。
  | { kind: "not-workhub"; base: string; detail: string }
  | { kind: "ready"; base: string; health: HealthResponse };

// 探测一次候选服务器。校验一字不改地复用 normalizeDesktopApiBase（desktop-api-base.ts）——
// 全仓只此一份地址合法性口径。probe 由调用方注入（生产上是一个**不带令牌**的 api-client 的 health()）。
export async function probeDesktopServer(input: {
  raw: string;
  probe: (base: string) => Promise<HealthResponse>;
}): Promise<DesktopServerProbeOutcome> {
  const base = normalizeDesktopApiBase(input.raw);
  if (!base) {
    return { kind: "invalid-address" };
  }
  let health: HealthResponse;
  try {
    health = await input.probe(base);
  } catch (error) {
    return { kind: "unreachable", base, detail: describeError(error) };
  }
  if (!health || health.ok !== true || health.service !== "workhub-api") {
    return {
      kind: "not-workhub",
      base,
      detail: `unexpected health payload: ${safeJson(health)}`
    };
  }
  return { kind: "ready", base, health };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// 确认使用这台服务器（顺序即安全属性，单测直接断言调用顺序）
// ---------------------------------------------------------------------------

export type DesktopServerChoiceEffects = {
  // C3：先清身份。A 服务器的设备令牌绝不能发给 B——不清就会先打出一串带着旧令牌的请求，
  // 落到 not_identified 的重铸路径上才自愈，中间是一段没有任何解释的失败。
  clearIdentity: (health: HealthResponse | undefined) => void;
  // webview 侧唯一真相：localStorage 的 workhub_api_base（三窗同源共享）。
  rememberServer: (base: string) => void;
  // 壳层（Rust）那份 server_url：SSE worker / 托盘角标 / 系统通知全靠它，不跟随就永远指着旧地址。
  // 契约：invoke("set_server_url", { url }) → { url }（归一化后的地址）；失败抛字符串错误。
  notifyShell: (base: string) => Promise<unknown>;
};

export type DesktopServerChoiceResult = {
  base: string;
  // 壳层是否接住了这次切换。false = 命令不存在（浏览器 dev 态/旧壳层）或调用失败——
  // 本屏照常继续（webview 侧已经切好了），只把事实记下来，绝不因此阻断用户。
  shellAccepted: boolean;
};

export async function applyDesktopServerChoice(
  base: string,
  effects: DesktopServerChoiceEffects,
  health?: HealthResponse
): Promise<DesktopServerChoiceResult> {
  effects.clearIdentity(health);
  effects.rememberServer(base);
  try {
    await effects.notifyShell(base);
    return { base, shellAccepted: true };
  } catch (error) {
    console.warn("WorkHub desktop: the shell did not accept the new server address", error);
    return { base, shellAccepted: false };
  }
}

// 生产环境的副作用实现。storage/invoke 都可注入，方便在没有 Tauri 的浏览器 dev 态里退化成 no-op。
export function createDesktopServerChoiceEffects(input: {
  storage: Pick<Storage, "setItem" | "removeItem">;
  invoke?: ((command: string, args?: Record<string, unknown>) => Promise<unknown> | unknown) | undefined;
}): DesktopServerChoiceEffects {
  return {
    clearIdentity: (health) => {
      try {
        clearDesktopClientToken(input.storage);
        // 认证模式提示是「上一台服务器」的事实，换服务器必须重写：探测已经拿到新服务器的 auth_mode
        // 就直接落准确值（省掉登出后靠 404 反推那一步）；旧服务端没这个字段就把提示删掉，回到未知。
        if (health?.auth_mode === "password" || health?.auth_mode === "hybrid") {
          rememberDesktopAuthModeHint(input.storage, "password");
        } else if (health?.auth_mode === "nickname") {
          rememberDesktopAuthModeHint(input.storage, "nickname");
        } else {
          forgetDesktopAuthModeHint(input.storage);
        }
      } catch {
        // localStorage 不可用：不阻断切换。
      }
    },
    rememberServer: (base) => {
      try {
        input.storage.setItem(DESKTOP_API_BASE_STORAGE_KEY, base);
      } catch {
        // 同上。
      }
    },
    notifyShell: async (base) => {
      if (typeof input.invoke !== "function") {
        throw new Error("no Tauri shell in this context");
      }
      return await Promise.resolve(input.invoke("set_server_url", { url: base }));
    }
  };
}

// ---------------------------------------------------------------------------
// 文案
// ---------------------------------------------------------------------------

type ConnectCopy = {
  title: string;
  subtitle: string;
  manualOnly: string;
  addressLabel: string;
  testLabel: string;
  testingLabel: string;
  confirmLabel: string;
  detailSummary: string;
  invalidAddress: string;
  unreachableTitle: string;
  unreachableHint: string;
  notWorkHubTitle: string;
  notWorkHubHint: string;
  readyTitle: (name: string) => string;
  versionLabel: string;
  authLabel: string;
  aiLabel: string;
  aiConfigured: string;
  aiMissing: string;
  unknownValue: string;
  authNickname: string;
  authPassword: string;
  authHybrid: string;
};

function connectCopy(locale: WorkHubLocale): ConnectCopy {
  return locale === "zh-CN"
    ? {
        title: "连接到你的服务器",
        subtitle: "输入团队 WorkHub 服务器的地址，先测一下能不能连上。",
        manualOnly: "地址只能在这里手动输入。WorkHub 不会从链接、剪贴板或服务器返回的内容里自动改地址。",
        addressLabel: "服务器地址",
        testLabel: "测试连接",
        testingLabel: "正在测试…",
        confirmLabel: "使用这台服务器",
        detailSummary: "原始错误",
        invalidAddress: "地址格式不对——要一个完整的 http:// 或 https:// 地址，不要带用户名、问号或井号。",
        unreachableTitle: "连不上这个地址。",
        unreachableHint: "看看服务器有没有在跑、地址和端口对不对，以及这台电脑和它在不在同一个网络里。",
        notWorkHubTitle: "这个地址有回应，但它不是 WorkHub 服务器。",
        notWorkHubHint: "多半是端口填错了，或者打到了别的服务上。",
        readyTitle: (name) => `连上了：${name}`,
        versionLabel: "版本",
        authLabel: "登录方式",
        aiLabel: "AI 服务",
        aiConfigured: "已配置",
        aiMissing: "未配置，Cuu 不会回应",
        unknownValue: "这台服务器没说（版本较旧）",
        authNickname: "昵称登录",
        authPassword: "邮箱和密码",
        authHybrid: "邮箱和密码（也认昵称）"
      }
    : {
        title: "Connect to your server",
        subtitle: "Enter the address of your team's WorkHub server and test the connection first.",
        manualOnly:
          "The address can only be typed here. WorkHub never picks one up from a link, the clipboard, or anything a server sends back.",
        addressLabel: "Server address",
        testLabel: "Test connection",
        testingLabel: "Testing…",
        confirmLabel: "Use this server",
        detailSummary: "Raw error",
        invalidAddress:
          "That address is not valid — use a full http:// or https:// URL with no username, query, or fragment.",
        unreachableTitle: "Can't reach that address.",
        unreachableHint:
          "Check that the server is running, that the address and port are right, and that this machine is on the same network.",
        notWorkHubTitle: "Something answered at that address, but it is not a WorkHub server.",
        notWorkHubHint: "Usually a wrong port, or another service running there.",
        readyTitle: (name) => `Connected to ${name}`,
        versionLabel: "Version",
        authLabel: "Sign-in",
        aiLabel: "AI service",
        aiConfigured: "Configured",
        aiMissing: "Not configured — Cuu will not reply",
        unknownValue: "Not reported (older server)",
        authNickname: "Nickname",
        authPassword: "Email and password",
        authHybrid: "Email and password (nickname also accepted)"
      };
}

function authModeLabel(mode: HealthResponse["auth_mode"], copy: ConnectCopy): string {
  if (mode === "nickname") return copy.authNickname;
  if (mode === "password") return copy.authPassword;
  if (mode === "hybrid") return copy.authHybrid;
  return copy.unknownValue;
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

// 探测结果卡（成功=服务器名/版本/登录方式/AI 是否配置；失败=一句人话 + 一句怎么办 + 原始错误折叠）。
export function desktopConnectResultHtml(
  outcome: DesktopServerProbeOutcome | undefined,
  locale: WorkHubLocale
): string {
  if (!outcome) {
    return "";
  }
  const copy = connectCopy(locale);
  if (outcome.kind === "invalid-address") {
    return `<p class="${desktopBootPanel.error}" role="alert">${escapeHtml(copy.invalidAddress)}</p>`;
  }
  if (outcome.kind === "unreachable" || outcome.kind === "not-workhub") {
    const title = outcome.kind === "unreachable" ? copy.unreachableTitle : copy.notWorkHubTitle;
    const hint = outcome.kind === "unreachable" ? copy.unreachableHint : copy.notWorkHubHint;
    return `<div class="wh-connect-card wh-connect-card--bad" role="alert"><p class="${desktopBootPanel.error}">${escapeHtml(title)}</p><p class="wh-connect-hint">${escapeHtml(hint)}</p><details class="wh-connect-detail"><summary>${escapeHtml(copy.detailSummary)}</summary>${escapeHtml(outcome.detail)}</details></div>`;
  }
  const health = outcome.health;
  const rows = [
    [copy.versionLabel, health.version?.trim() || copy.unknownValue],
    [copy.authLabel, authModeLabel(health.auth_mode, copy)],
    [copy.aiLabel, health.ai_provider_configured ? copy.aiConfigured : copy.aiMissing]
  ];
  const rowsHtml = rows
    .map(
      ([label, value]) =>
        `<div class="wh-connect-row"><span>${escapeHtml(label ?? "")}</span><strong>${escapeHtml(value ?? "")}</strong></div>`
    )
    .join("");
  const name = health.instance_name?.trim() || "WorkHub";
  return `<div class="wh-connect-card wh-connect-card--good" role="status"><p class="wh-connect-ok">${escapeHtml(copy.readyTitle(name))}</p><p class="wh-connect-hint">${escapeHtml(outcome.base)}</p>${rowsHtml}</div>`;
}

// 这张屏独有的补充样式：探测结果卡（成功/失败）与原始错误折叠区。面板外框、表单、按钮、标题层级
// 全部来自 desktop-boot-panel.ts 的共享样式，三张 boot 屏一份。
// 全部带面板前缀：结果卡里的 <p> 会被共享样式的「面板 p」（0,1,1）盖过单个类（0,1,0），
// 不加前缀的话「连上了 / 地址 / 原始错误」三层就会全退回同一个灰、同一个字号。
const connectExtraCss = [
  `.${desktopBootPanel.panel} .wh-connect-card{display:grid;gap:6px;border-radius:14px;padding:12px 14px;border:1px solid rgba(255,255,255,.26)}`,
  `.${desktopBootPanel.panel} .wh-connect-card--good{background:rgba(10,132,255,.08)}`,
  `.${desktopBootPanel.panel} .wh-connect-card--bad{background:rgba(196,61,43,.08)}`,
  `.${desktopBootPanel.panel} .wh-connect-row{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;color:color-mix(in srgb, CanvasText 72%, transparent)}`,
  `.${desktopBootPanel.panel} .wh-connect-row strong{font-weight:850;color:CanvasText;text-align:right}`,
  `.${desktopBootPanel.panel} .wh-connect-ok{font-weight:900;color:CanvasText}`,
  `.${desktopBootPanel.panel} .wh-connect-hint{font-size:12px;color:color-mix(in srgb, CanvasText 62%, transparent);word-break:break-all}`,
  `.${desktopBootPanel.panel} .wh-connect-detail{font-size:11px;color:color-mix(in srgb, CanvasText 52%, transparent);word-break:break-all}`,
  `.${desktopBootPanel.panel} .wh-connect-detail summary{cursor:pointer;font-weight:850}`,
  // 结果卡里的次级层次同样在深色外观下整体提一档（同共享面板里的那段说明）。
  "@media (prefers-color-scheme: dark){" +
    `.${desktopBootPanel.panel} .wh-connect-row{color:color-mix(in srgb, CanvasText 84%, transparent)}` +
    `.${desktopBootPanel.panel} .wh-connect-hint{color:color-mix(in srgb, CanvasText 76%, transparent)}` +
    `.${desktopBootPanel.panel} .wh-connect-detail{color:color-mix(in srgb, CanvasText 66%, transparent)}` +
  "}"
].join("\n");

// R24 H（首启窗口裁切）：这一屏渲进主窗时，原生窗口还是聚焦盒 idle 的细搜索条尺寸（720×64）——面板
// 会被裁得只剩一行标题。面板上的 desktopBootScreenFitAttribute 是量高锚点（由共享面板打上），主窗挂载
// 后由 desktop-boot-screen-fit.ts 量它 + 外壳 padding 把窗口撑到内容大小（「测试连接」的结果卡让面板
// 变高时也会重量）。外壳 padding 与那边的加法共用 desktopBootScreenFitPaddingPx——CSS 的 padding 一旦
// 大过那个值，窗口就会重新开始裁面板边缘。工作台窗（1280×800）不做贴合，这些样式在那边只是居中留白。
// R24 I：面板外框改由 desktop-boot-panel.ts 统一提供，本屏与昵称首启屏/凭据门共用同一套玻璃语言。
export function renderDesktopConnectScreenHtml(input: {
  locale: WorkHubLocale;
  apiBase?: string;
  // boot 失败时把原始错误一并折叠展示（此前这块信息只在离线卡里，而离线卡实际上到不了）。
  detail?: string;
}): string {
  const copy = connectCopy(input.locale);
  const prefill = input.apiBase?.trim() || defaultDesktopApiBase();
  const bootDetail = input.detail?.trim()
    ? `<details class="wh-connect-detail" data-desktop-connect-boot-detail><summary>${escapeHtml(copy.detailSummary)}</summary>${escapeHtml(input.detail)}</details>`
    : "";
  return renderDesktopBootPanelHtml({
    shellClass: "wh-connect-shell",
    panelAttrs: 'aria-live="polite"',
    extraCss: connectExtraCss,
    inner:
      `<h2>${escapeHtml(copy.title)}</h2>` +
      `<p class="${desktopBootPanel.sub}">${escapeHtml(copy.subtitle)}</p>` +
      `<p class="${desktopBootPanel.fineprint}">${escapeHtml(copy.manualOnly)}</p>` +
      `<form class="${desktopBootPanel.form}" data-desktop-connect-form novalidate>` +
      `<label>${escapeHtml(copy.addressLabel)}<input data-desktop-connect-address name="apiBase" type="url" autocomplete="off" spellcheck="false" value="${escapeHtml(prefill)}" placeholder="http://192.168.1.10:8787" aria-label="${escapeHtml(copy.addressLabel)}" /></label>` +
      `<div class="${desktopBootPanel.actions}">` +
      `<button data-desktop-connect-test type="submit" class="${desktopBootPanel.secondary} ds-pressable">${escapeHtml(copy.testLabel)}</button>` +
      `<button data-desktop-connect-confirm type="button" class="${desktopBootPanel.primary} ds-pressable" disabled>${escapeHtml(copy.confirmLabel)}</button>` +
      `</div></form>` +
      `<div data-desktop-connect-status></div>${bootDetail}`
  });
}

// ---------------------------------------------------------------------------
// DOM 接线
// ---------------------------------------------------------------------------

export type DesktopConnectScreenInput = {
  locale: WorkHubLocale;
  apiBase?: string;
  detail?: string;
  // 探测：生产上是「用候选地址新建一个**不带令牌**的 api-client，调 health()」。
  probe: (base: string) => Promise<HealthResponse>;
  effects: DesktopServerChoiceEffects;
  // 确认之后本窗自己 reload（其余窗口靠壳层广播 workhub-server-changed 跟随）。
  reload: () => void;
  scheduleRebuild?: () => void;
};

export function bindDesktopConnectScreen(rootEl: HTMLElement, input: DesktopConnectScreenInput): void {
  rootEl.innerHTML = renderDesktopConnectScreenHtml({
    locale: input.locale,
    ...(input.apiBase ? { apiBase: input.apiBase } : {}),
    ...(input.detail ? { detail: input.detail } : {})
  });
  const copy = connectCopy(input.locale);
  const form = rootEl.querySelector<HTMLFormElement>("[data-desktop-connect-form]");
  const addressEl = rootEl.querySelector<HTMLInputElement>("[data-desktop-connect-address]");
  const testEl = rootEl.querySelector<HTMLButtonElement>("[data-desktop-connect-test]");
  const confirmEl = rootEl.querySelector<HTMLButtonElement>("[data-desktop-connect-confirm]");
  const statusEl = rootEl.querySelector<HTMLElement>("[data-desktop-connect-status]");

  // C2：只有「刚刚亲手测通的那个地址」才可确认。地址一被改动就作废，必须重测——
  // 杜绝「测了 A、把输入框改成 B、点确认就用了 B」这条绕过显式确认的路。
  let confirmed: { base: string; health: HealthResponse } | undefined;
  const setConfirmEnabled = (enabled: boolean) => {
    if (confirmEl) {
      confirmEl.disabled = !enabled;
    }
  };
  const showOutcome = (outcome: DesktopServerProbeOutcome | undefined) => {
    if (statusEl) {
      statusEl.innerHTML = desktopConnectResultHtml(outcome, input.locale);
    }
    input.scheduleRebuild?.();
  };

  addressEl?.focus?.({ preventScroll: true });
  addressEl?.addEventListener("input", () => {
    confirmed = undefined;
    setConfirmEnabled(false);
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = addressEl?.value ?? "";
    confirmed = undefined;
    setConfirmEnabled(false);
    if (testEl) {
      testEl.disabled = true;
      testEl.textContent = copy.testingLabel;
    }
    void probeDesktopServer({ raw, probe: input.probe })
      .then((outcome) => {
        showOutcome(outcome);
        if (outcome.kind === "ready") {
          confirmed = { base: outcome.base, health: outcome.health };
          setConfirmEnabled(true);
        }
      })
      .finally(() => {
        if (testEl) {
          testEl.disabled = false;
          testEl.textContent = copy.testLabel;
        }
      });
  });

  confirmEl?.addEventListener("click", () => {
    if (!confirmed) {
      return;
    }
    setConfirmEnabled(false);
    // 顺序即安全属性：清身份 → 写地址 → 通知壳层 → 本窗 reload（见 applyDesktopServerChoice）。
    void applyDesktopServerChoice(confirmed.base, input.effects, confirmed.health).then(() => input.reload());
  });

  input.scheduleRebuild?.();
}

// ---------------------------------------------------------------------------
// 跨窗跟随
// ---------------------------------------------------------------------------

// 主窗/桌宠用 DesktopShellListen（事件名收窄到 DesktopShellEventName），工作台用 WorkbenchTauriListen
// （事件名是 string）——这里只声明「能订阅这一个事件名」这个最小契约，两种 listen 都能传进来。
type ServerChangedListen = (
  eventName: typeof DESKTOP_SERVER_CHANGED_EVENT,
  handler: (event: { payload?: unknown }) => void
) => unknown;

// 别的窗口切了服务器 → 壳层广播 workhub-server-changed → 本窗 reload 走新地址重新 boot。
// 与 workhub-logged-out 的订阅同款：无 Tauri（浏览器 dev 预览）时 listen 不存在，静默 no-op。
export function bindDesktopServerChangedReload(
  listen: ServerChangedListen | undefined,
  reload: () => void
): void {
  if (typeof listen !== "function") {
    return;
  }
  try {
    void Promise.resolve(listen(DESKTOP_SERVER_CHANGED_EVENT, () => reload())).catch(() => undefined);
  } catch (error) {
    console.warn("WorkHub desktop: could not subscribe to the server-changed event", error);
  }
}
