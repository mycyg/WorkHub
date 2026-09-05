// WorkHub 桌面 · 密码/hybrid 模式凭据登录门（REL-5 / P1-02 / R24 S4）。
// 背景：昵称模式桌面走 desktop-bootstrap 一步换 client_token；但密码/hybrid 模式没有可用登录链路——
// desktop-bootstrap 在这两种模式下会 404（见 apps/api/src/routes/auth.ts）。本模块补上：
//   1) isPasswordModeBootstrapError：据 desktop-bootstrap 的 404 判定「当前是密码模式，要凭据登录」；
//   2) resolveDesktopFirstRunGate(WithLock)：首启无 token 时判定该渲哪张登录门——不再靠盲打
//      desktop-bootstrap 探测（那在昵称模式会有真实副作用：建一个用固定昵称的设备/账号，见 E-03）；
//   3) renderDesktopCredentialGateHtml：凭据门，三个页签——登录 / 注册 / 我有邀请令牌，密码只走
//      <input type=password>，绝不进 URL；
//   4) runDesktopCredentialLogin / runDesktopCredentialRegister / runDesktopInviteAccept：凭据 →
//      设备令牌 exchange（复用后端既有能力，前端不造鉴权）；
//   5) bindDesktopCredentialGate：把三个表单接到上面的流程，错误可见、按钮可重试（参照 SEC-2 登出
//      状态机风格）。
// 昵称模式的首启/重绑屏在 desktop-rebind.ts（复用同一套 isPasswordModeBootstrapError/hint 判定）。

import { WorkHubApiError } from "@workhub/api-client/client";
import type { IdentityResponse, PasswordLoginRequest, PasswordRegisterRequest, WorkHubApiClient } from "@workhub/api-client";
import type { InviteAcceptRequest } from "@workhub/contracts";
import type { WorkHubLocale } from "@workhub/ui/gold-path";

import { markDesktopIdentityCreated } from "./desktop-first-run.js";
import { writeDesktopClientToken } from "./desktop-client-token.js";

// 与 browser.ts / workbench/boot.ts 同一套登出标记键 + 令牌收口（DSK-06，desktop-client-token.ts）——
// 写令牌前清登出标记，落新键。
const DESKTOP_LOGGED_OUT_FLAG = "workhub_desktop_logged_out";
// 探得的认证模式提示：来源两条——resolveDesktopFirstRunGate 探 health.auth_mode（首启，无副作用）、
// isPasswordModeBootstrapError 探 desktop-bootstrap 的 404（提交后才会命中，见该函数顶注）。
// 用于登出后/下次首启选对登录门——登出态绝不自动昵称 rebind，故不能靠再探一次 bootstrap（那在昵称
// 模式会有建设备副作用）。只是提示：真正鉴权仍以服务端为准，模式若变登录会报错让用户重试。
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

// R24 S2：鉴权门状态 → 该渲哪一屏。此前这个判断在主窗（browser.ts bootSpotlight）与工作台窗
// （workbench/boot.ts boot）各写了一遍 if 链，两边已经实际漂移过——主窗有 logged-out 分支、工作台没有，
// 两边都没有 offline 分支（连不上后端时主窗继续挂一个取不到数的空聚焦盒、工作台直接挂外壳，
// 用户看不到一句错误，也走不到服务器地址输入框，见 desktop-connect-screen.ts 顶部注释）。
// 收敛成一个纯函数：两个 surface 共用同一张表，差异只有一处（登出态工作台交给外壳的「已登出」整窗态，
// 主窗渲重新绑定屏），而且可以单测。
export type DesktopAuthGate = "ready" | "needs-credentials" | "logged-out" | "offline";
export type DesktopBootScreen = "mount" | "credential-gate" | "rebind" | "connect-server";

export function desktopBootScreenForGate(
  gate: DesktopAuthGate,
  surface: "spotlight" | "workbench"
): DesktopBootScreen {
  if (gate === "needs-credentials") {
    return "credential-gate";
  }
  if (gate === "offline") {
    return "connect-server";
  }
  if (gate === "logged-out") {
    // 工作台没有独立的重新绑定屏：外壳自己有「已登出」整窗态（shell.showLoggedOut），boot 继续挂载它。
    return surface === "spotlight" ? "rebind" : "mount";
  }
  return "mount";
}

// R24 S2（换服务器）：模式提示是「上一台服务器」的事实，换服务器时必须作废——留着它会让登出后
// 的再登录门渲错那一张（A 是密码模式、B 是昵称模式时尤其明显）。键名只在本模块定义一次，
// 连接服务器屏经这个函数清，不另抄一遍键名。
export function forgetDesktopAuthModeHint(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(AUTH_MODE_HINT_KEY);
  } catch {
    // 同上。
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

// —— R24 S4（E-03 根治）：首启无 token 时判定该渲哪张登录门 —— //
//
// 旧行为：无论什么模式，首启一律盲打 desktop-bootstrap 传一个硬编码昵称——密码模式下这只是白打一次
// （服务端 404，判定成 needs-credentials）；但昵称模式下这**真的会**按该昵称建/复用一个设备与用户
// （getOrCreateActiveByNickname），全团队装同一个包 = 服务器上同一个人（E-03）。判定模式不能再靠
// 「先斩后奏」的探测式调用，必须在用户submit 一个真实身份之前就知道该给他看哪张门。
//
// GET /api/health 的 auth_mode 字段（并行的 S3 补充）是首选信号——存在就直接读，读不到（老服务端 /
// 探测失败）时按本仓库默认的 nickname 模式渲首启昵称屏（复用 desktop-rebind.ts 的重绑屏，context
// 传 "first-run"）；猜错的兜底见 desktop-rebind.ts 的 onPasswordModeDetected：用户提交昵称后如果
// desktop-bootstrap 仍然 404，就地切到凭据门，不需要用户自己诊断。
export type DesktopAuthModeProbeClient = Pick<WorkHubApiClient, "request">;

export async function probeDesktopAuthMode(
  client: DesktopAuthModeProbeClient
): Promise<"nickname" | "password" | "hybrid" | null> {
  try {
    // client.health() 的 HealthResponse 类型暂未收纳 auth_mode（并行 S3 施工中）——按可选字段防御性读取，
    // 不等它落地也能工作；一旦类型补上，这行不用改（结构上仍然兼容）。
    const response = await client.request<{ auth_mode?: unknown }>("/api/health");
    const mode = response?.auth_mode;
    return mode === "nickname" || mode === "password" || mode === "hybrid" ? mode : null;
  } catch {
    // 网络错误/后端不可达：探测失败，不确定——调用方按「不确定」处理，不当成任何一种确定模式。
    return null;
  }
}

export type DesktopFirstRunGate = "needs-credentials" | "logged-out";

export async function resolveDesktopFirstRunGate(input: {
  client: DesktopAuthModeProbeClient;
  storage: Pick<Storage, "getItem" | "setItem">;
}): Promise<DesktopFirstRunGate> {
  const hint = readDesktopAuthModeHint(input.storage);
  if (hint === "password") {
    return "needs-credentials";
  }
  if (hint === "nickname") {
    return "logged-out";
  }
  const probed = await probeDesktopAuthMode(input.client);
  if (probed === "password" || probed === "hybrid") {
    rememberDesktopAuthModeHint(input.storage, "password");
    return "needs-credentials";
  }
  if (probed === "nickname") {
    rememberDesktopAuthModeHint(input.storage, "nickname");
  }
  // probed === null（探测失败/服务端太旧没有这个字段）：按 nickname 处理——本仓库默认模式，猜错时
  // 提交环节的 404 兜底（见上方模块顶注）比预先假定密码模式、把 LAN 信任模式的用户扔进陌生的邮箱
  // 密码表单更安全（同 apps/web/src/auth-screen-mode.ts 的 detectAuthScreenMode 同一取舍）。
  return "logged-out";
}

// 包一层跨窗启动锁（DSK-07 同款机制，run() 换成纯判定而非会创建设备的 bootstrap 调用）：首启时
// 主窗/桌宠/工作台几乎同时 boot，都见「无 token」会并发探测——这次探测本身没有副作用，锁的价值变成
// 「另一扇窗口这段时间已经完成登录」时可以直接沿用它落的 token，而不是三扇窗各自单独渲一次登录门。
export async function resolveDesktopFirstRunGateWithLock(input: {
  client: DesktopAuthModeProbeClient;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  readToken: () => string | undefined;
  // 透传给 runDesktopBootstrapWithLock 的可选覆盖（同名同义）——只用于单测注入假时钟/假 sleep，
  // 生产调用方一律不传，走真实 Date.now()/setTimeout。
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  lockTtlMs?: number;
  waitMs?: number;
  pollMs?: number;
}): Promise<DesktopFirstRunGate | "ready" | "offline"> {
  const locked = await runDesktopBootstrapWithLock({
    storage: input.storage,
    readToken: input.readToken,
    run: () => resolveDesktopFirstRunGate({ client: input.client, storage: input.storage }),
    ...(input.now ? { now: input.now } : {}),
    ...(input.sleep ? { sleep: input.sleep } : {}),
    ...(input.lockTtlMs !== undefined ? { lockTtlMs: input.lockTtlMs } : {}),
    ...(input.waitMs !== undefined ? { waitMs: input.waitMs } : {}),
    ...(input.pollMs !== undefined ? { pollMs: input.pollMs } : {})
  });
  if (locked.kind === "ran") {
    return locked.result;
  }
  return locked.kind === "token-ready" ? "ready" : "offline";
}

// 桌面 exchange 需要客户端的 login / register / bootstrapDesktop 三个能力 + 裸 request（邀请接受目前
// 没有具名方法，同 apps/web/src/browser.ts 的既有取舍——不为单个批次特性扩大 WorkHubApiClient 的具名
// 方法面，见 workbench/rail.ts submitNewPersonalSpace 顶部注释同款先例）。收窄依赖便于测试注入假客户端。
export type DesktopLoginClient = Pick<WorkHubApiClient, "login" | "bootstrapDesktop" | "register" | "request">;

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
  // 登录是「回到一个已有账号」——不摸首启标记：如果这台设备之前注册过还没建第一个项目就被登出/换设备
  // 令牌，登录回来应该还看到那张卡；如果标记本就没有，登录也不该凭空生出一个。
  return { client_token: exchange.client_token };
}

// 密码/hybrid 模式的账号注册 → 设备令牌 exchange（R24 S4，「注册」页签）：
//   1) client.register：POST /api/auth/register 建号（零管理员实例首个注册者自举为 admin）+ 会话 cookie；
//   2) client.bootstrapDesktop：同 runDesktopCredentialLogin，据会话签发桌面设备令牌；
//   3) register 响应的 created 恒为 true（这是一次真实的新建账号）——照实落首启标记，落地页据此渲
//      「建你的第一个项目」引导卡（见 desktop-first-run.ts）。exchange 响应里的 created 不能用：密码模式
//      分支服务端写死 toIdentityResponse(user, false)（这个字段在那个分支的语义是「这次 bootstrap 调用
//      有没有新建用户」，不是「这个用户是不是新的」，两者在密码模式下永远是后者）。
export async function runDesktopCredentialRegister(input: {
  client: DesktopLoginClient;
  registration: PasswordRegisterRequest;
  deviceName?: string;
  platform?: string;
  storage: Pick<Storage, "setItem" | "removeItem">;
}): Promise<{ client_token: string; created: boolean }> {
  const email = input.registration.email.trim();
  const nickname = input.registration.nickname.trim();
  const registered = await input.client.register({ email, nickname, password: input.registration.password });
  const exchange = await input.client.bootstrapDesktop({
    nickname: "WorkHub Desktop",
    device_name: input.deviceName?.trim() || "WorkHub Desktop",
    platform: input.platform ?? "desktop"
  });
  if (!exchange?.client_token) {
    throw new Error("desktop exchange did not return a client token");
  }
  input.storage.removeItem(DESKTOP_LOGGED_OUT_FLAG);
  writeDesktopClientToken(input.storage, exchange.client_token);
  const created = registered.created === true;
  markDesktopIdentityCreated(input.storage, created);
  return { client_token: exchange.client_token, created };
}

// 接受邀请 → 设备令牌 exchange（R24 S4，「我有邀请令牌」页签）：POST /api/auth/invites/accept 没有
// 具名 client 方法（同 apps/web/src/browser.ts submitInviteAccept 的既有取舍，走裸 client.request——
// 不为单个批次特性扩大 WorkHubApiClient 的具名方法面），响应形状与 register/login 一致（IdentityResponse，
// 已登记进 api-client 的 RAW_JSON_RESPONSE_PATHS）。created 同样恒为 true，同 register 分支的理由。
export async function runDesktopInviteAccept(input: {
  client: DesktopLoginClient;
  invite: InviteAcceptRequest;
  deviceName?: string;
  platform?: string;
  storage: Pick<Storage, "setItem" | "removeItem">;
}): Promise<{ client_token: string; created: boolean }> {
  const accepted = await input.client.request<IdentityResponse>("/api/auth/invites/accept", {
    method: "POST",
    body: JSON.stringify({
      token: input.invite.token.trim(),
      nickname: input.invite.nickname.trim(),
      password: input.invite.password
    })
  });
  const exchange = await input.client.bootstrapDesktop({
    nickname: "WorkHub Desktop",
    device_name: input.deviceName?.trim() || "WorkHub Desktop",
    platform: input.platform ?? "desktop"
  });
  if (!exchange?.client_token) {
    throw new Error("desktop exchange did not return a client token");
  }
  input.storage.removeItem(DESKTOP_LOGGED_OUT_FLAG);
  writeDesktopClientToken(input.storage, exchange.client_token);
  const created = accepted.created === true;
  markDesktopIdentityCreated(input.storage, created);
  return { client_token: exchange.client_token, created };
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

// 注册页签的错误文案（照 apps/web/src/auth-screen-mode.ts 的 describeAuthScreenError 同一口径——
// 桌面和 web 的密码注册走同一个后端端点，用户看到的措辞不该因为客户端不同而两样）。
export function describeDesktopRegisterError(error: unknown, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  if (error instanceof WorkHubApiError) {
    if (error.status === 429) {
      return zh ? "尝试过于频繁，请稍后再试。" : "Too many attempts. Please wait a moment and retry.";
    }
    if (error.status === 409) {
      return zh ? "该邮箱已注册，请改用登录。" : "That email is already registered — sign in instead.";
    }
    if (error.status === 400 || error.status === 422) {
      return zh
        ? "请检查邮箱、昵称和密码是否有效（密码至少 8 位）。"
        : "Check that email, nickname, and password are valid (password needs at least 8 characters).";
    }
    if (error.status === 404) {
      return zh ? "当前后端未启用密码注册。" : "Password registration isn't enabled on this backend.";
    }
  }
  return zh ? "注册失败，请检查后端连接后重试。" : "Registration failed — check the backend connection and retry.";
}

// 邀请页签的错误文案（照 apps/web/src/browser.ts inviteAcceptErrorText 同一口径）。
export function describeDesktopInviteError(error: unknown, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  if (error instanceof WorkHubApiError) {
    if (error.status === 404) {
      return zh
        ? "邀请无效或已过期，请向管理员索取新的邀请。"
        : "This invite is invalid or expired — ask your admin for a new one.";
    }
    if (error.status === 409) {
      return zh ? "该邮箱已注册，请改用登录。" : "That email is already registered — sign in instead.";
    }
    if (error.status === 400 || error.status === 422) {
      return zh
        ? "请检查邀请令牌、昵称和密码是否有效（密码至少 8 位）。"
        : "Check that the invite token, nickname, and password are valid (password needs at least 8 characters).";
    }
  }
  return zh ? "接受邀请失败，请检查后端连接后重试。" : "Couldn't accept the invite — check the backend connection and retry.";
}

// 首启（first-run）与真登出（logged-out）共用同一张凭据门，只有标题/说明不同——同 desktop-rebind.ts
// 的 context 取舍：首启是「这台设备第一次连接，随便挑一种方式开始」，登出是「回到你刚才那个账号」。
export type DesktopCredentialGateContext = "first-run" | "logged-out";

// 密码/hybrid 模式凭据门的 HTML（自带 <style>，不依赖外部 CSS 已加载——渲进 boot 首帧壳也成立）。
// 结构：三个页签共享一张卡——登录（邮箱+密码，既有）/ 注册（邮箱+昵称+密码）/ 我有邀请令牌
// （令牌+昵称+密码）；密码全部只走 <input type=password>，绝不进 URL。默认页签固定是「登录」，
// 不随 context 变——不给「首启该默认哪个页签」加判断分支，交给用户自己点。
export function renderDesktopCredentialGateHtml(input: {
  locale: WorkHubLocale;
  error?: string;
  context?: DesktopCredentialGateContext;
}): string {
  const zh = input.locale === "zh-CN";
  const context = input.context ?? "logged-out";
  const title =
    context === "first-run"
      ? zh
        ? "欢迎使用 WorkHub"
        : "Welcome to WorkHub"
      : zh
        ? "登录 WorkHub"
        : "Sign in to WorkHub";
  const subtitle =
    context === "first-run"
      ? zh
        ? "这台设备第一次连接这台服务器：登录已有账号、注册新账号，或用邀请令牌加入。"
        : "This device hasn't connected to this server before — sign in, register, or join with an invite token."
      : zh
        ? "这台设备使用邮箱 + 密码登录。登录后会绑定为受信任设备。"
        : "This device signs in with email and password, then binds as a trusted device.";
  const emailLabel = zh ? "邮箱" : "Email";
  const passwordLabel = zh ? "密码" : "Password";
  const nicknameLabel = zh ? "昵称" : "Nickname";
  const nicknamePlaceholder = zh ? "你的昵称" : "Your nickname";
  const inviteTokenLabel = zh ? "邀请令牌" : "Invite token";
  const signinTabLabel = zh ? "登录" : "Sign in";
  const registerTabLabel = zh ? "注册" : "Register";
  const inviteTabLabel = zh ? "我有邀请令牌" : "Have an invite token";
  const signinSubmitLabel = zh ? "登录" : "Sign in";
  const registerSubmitLabel = zh ? "注册" : "Register";
  const inviteSubmitLabel = zh ? "接受邀请" : "Accept invite";
  const signinErrorHtml = input.error
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
    .wh-desktop-login-card .wh-desktop-login-submit{margin-top:2px;padding:10px;border:0;border-radius:9px;background:#4F46E5;color:#fff;font-weight:800;font-size:14px;cursor:pointer}
    .wh-desktop-login-card .wh-desktop-login-submit:disabled{opacity:.6;cursor:progress}
    .wh-desktop-login-tabs{display:flex;gap:4px;border-bottom:1px solid #E6E7EB;margin-bottom:2px}
    .wh-desktop-login-tabs button{flex:1;padding:8px 6px;border:0;background:transparent;font-size:12.5px;font-weight:800;color:#8A90A0;cursor:pointer;border-bottom:2px solid transparent}
    .wh-desktop-login-tabs button[aria-selected="true"]{color:#4F46E5;border-bottom-color:#4F46E5}
    .wh-desktop-login-panel[hidden]{display:none}
  </style>
  <div class="wh-ds wh-desktop-login-shell">
    <div class="wh-desktop-login-card">
      <h1>${escapeHtml(title)}</h1>
      <p class="wh-desktop-login-sub">${escapeHtml(subtitle)}</p>
      <div class="wh-desktop-login-tabs" role="tablist" aria-label="${escapeHtml(zh ? "登录方式" : "Sign-in method")}">
        <button type="button" role="tab" aria-selected="true" data-desktop-login-tab="signin">${escapeHtml(signinTabLabel)}</button>
        <button type="button" role="tab" aria-selected="false" data-desktop-login-tab="register">${escapeHtml(registerTabLabel)}</button>
        <button type="button" role="tab" aria-selected="false" data-desktop-login-tab="invite">${escapeHtml(inviteTabLabel)}</button>
      </div>
      <form data-desktop-login-form class="wh-desktop-login-panel" data-desktop-login-panel="signin" novalidate>
        <label>${escapeHtml(emailLabel)}
          <input data-desktop-login-email name="email" type="email" autocomplete="username" inputmode="email" maxlength="320" placeholder="you@example.com" />
        </label>
        <label>${escapeHtml(passwordLabel)}
          <input data-desktop-login-password name="password" type="password" autocomplete="current-password" maxlength="1024" placeholder="••••••••" />
        </label>
        <button data-desktop-login-submit type="submit" class="wh-desktop-login-submit ds-pressable">${escapeHtml(signinSubmitLabel)}</button>
        ${signinErrorHtml}
      </form>
      <form data-desktop-register-form class="wh-desktop-login-panel" data-desktop-login-panel="register" hidden novalidate>
        <label>${escapeHtml(emailLabel)}
          <input data-desktop-register-email name="email" type="email" autocomplete="email" inputmode="email" maxlength="320" placeholder="you@example.com" />
        </label>
        <label>${escapeHtml(nicknameLabel)}
          <input data-desktop-register-nickname name="nickname" type="text" maxlength="64" autocomplete="nickname" placeholder="${escapeHtml(nicknamePlaceholder)}" />
        </label>
        <label>${escapeHtml(passwordLabel)}
          <input data-desktop-register-password name="password" type="password" autocomplete="new-password" maxlength="1024" placeholder="••••••••" />
        </label>
        <button data-desktop-register-submit type="submit" class="wh-desktop-login-submit ds-pressable">${escapeHtml(registerSubmitLabel)}</button>
        <p data-desktop-register-error hidden style="margin:0;font-size:12px;color:#E5484D" role="alert"></p>
      </form>
      <form data-desktop-invite-form class="wh-desktop-login-panel" data-desktop-login-panel="invite" hidden novalidate>
        <label>${escapeHtml(inviteTokenLabel)}
          <input data-desktop-invite-token name="token" type="text" maxlength="512" placeholder="${escapeHtml(zh ? "粘贴管理员发给你的邀请令牌" : "Paste the invite token your admin sent you")}" />
        </label>
        <label>${escapeHtml(nicknameLabel)}
          <input data-desktop-invite-nickname name="nickname" type="text" maxlength="64" autocomplete="nickname" placeholder="${escapeHtml(nicknamePlaceholder)}" />
        </label>
        <label>${escapeHtml(passwordLabel)}
          <input data-desktop-invite-password name="password" type="password" autocomplete="new-password" maxlength="1024" placeholder="••••••••" />
        </label>
        <button data-desktop-invite-submit type="submit" class="wh-desktop-login-submit ds-pressable">${escapeHtml(inviteSubmitLabel)}</button>
        <p data-desktop-invite-error hidden style="margin:0;font-size:12px;color:#E5484D" role="alert"></p>
      </form>
    </div>
  </div>`;
}

// 把凭据门接到 DOM：三个页签各自提交各自的流程，成功统一回 onSuccess（一般是 reload 走既有 token 流），
// 失败把可读原因写进对应页签的错误行并重新启用按钮（可重试）。空字段就地提示，不发请求（也就不会把
// 空密码送上网）。页签切换只是显隐 + aria-selected，不清空另外两个表单已填的内容。
export function bindDesktopCredentialGate(
  rootEl: HTMLElement,
  input: {
    client: DesktopLoginClient;
    locale: WorkHubLocale;
    storage: Pick<Storage, "setItem" | "removeItem">;
    onSuccess: () => void;
    deviceName?: string;
    platform?: string;
    context?: DesktopCredentialGateContext;
  }
): void {
  rootEl.innerHTML = renderDesktopCredentialGateHtml({
    locale: input.locale,
    ...(input.context ? { context: input.context } : {})
  });
  const zh = input.locale === "zh-CN";
  const showError = (el: HTMLElement | null, message: string) => {
    if (el) {
      el.textContent = message;
      el.hidden = false;
    }
  };

  // —— 页签切换：显隐面板 + aria-selected，切到哪个页签就把焦点交给它的第一个输入框 —— //
  const tabButtons = Array.from(rootEl.querySelectorAll<HTMLButtonElement>("[data-desktop-login-tab]"));
  const panels = Array.from(rootEl.querySelectorAll<HTMLElement>("[data-desktop-login-panel]"));
  const activatePanel = (name: string) => {
    for (const button of tabButtons) {
      button.setAttribute("aria-selected", String(button.dataset.desktopLoginTab === name));
    }
    for (const panel of panels) {
      const active = panel.dataset.desktopLoginPanel === name;
      panel.hidden = !active;
      if (active) {
        panel.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
      }
    }
  };
  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      const name = button.dataset.desktopLoginTab;
      if (name) {
        activatePanel(name);
      }
    });
  }

  // —— 登录页签 —— //
  const form = rootEl.querySelector<HTMLFormElement>("[data-desktop-login-form]");
  const emailEl = rootEl.querySelector<HTMLInputElement>("[data-desktop-login-email]");
  const passwordEl = rootEl.querySelector<HTMLInputElement>("[data-desktop-login-password]");
  const submitEl = rootEl.querySelector<HTMLButtonElement>("[data-desktop-login-submit]");
  const errorEl = rootEl.querySelector<HTMLElement>("[data-desktop-login-error]");
  emailEl?.focus({ preventScroll: true });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = emailEl?.value.trim() ?? "";
    const password = passwordEl?.value ?? "";
    if (!email || !password) {
      showError(errorEl, zh ? "请填写邮箱和密码。" : "Enter your email and password.");
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
        showError(errorEl, describeDesktopLoginError(error, input.locale));
      });
  });

  // —— 注册页签 —— //
  const registerForm = rootEl.querySelector<HTMLFormElement>("[data-desktop-register-form]");
  const registerEmailEl = rootEl.querySelector<HTMLInputElement>("[data-desktop-register-email]");
  const registerNicknameEl = rootEl.querySelector<HTMLInputElement>("[data-desktop-register-nickname]");
  const registerPasswordEl = rootEl.querySelector<HTMLInputElement>("[data-desktop-register-password]");
  const registerSubmitEl = rootEl.querySelector<HTMLButtonElement>("[data-desktop-register-submit]");
  const registerErrorEl = rootEl.querySelector<HTMLElement>("[data-desktop-register-error]");
  registerForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = registerEmailEl?.value.trim() ?? "";
    const nickname = registerNicknameEl?.value.trim() ?? "";
    const password = registerPasswordEl?.value ?? "";
    if (!email || !nickname || !password) {
      showError(registerErrorEl, zh ? "请填写邮箱、昵称和密码。" : "Enter your email, nickname, and password.");
      return;
    }
    if (registerSubmitEl) {
      registerSubmitEl.disabled = true;
    }
    if (registerErrorEl) {
      registerErrorEl.hidden = true;
    }
    void runDesktopCredentialRegister({
      client: input.client,
      registration: { email, nickname, password },
      ...(input.deviceName ? { deviceName: input.deviceName } : {}),
      ...(input.platform ? { platform: input.platform } : {}),
      storage: input.storage
    })
      .then(() => input.onSuccess())
      .catch((error: unknown) => {
        if (registerSubmitEl) {
          registerSubmitEl.disabled = false;
        }
        showError(registerErrorEl, describeDesktopRegisterError(error, input.locale));
      });
  });

  // —— 我有邀请令牌页签 —— //
  const inviteForm = rootEl.querySelector<HTMLFormElement>("[data-desktop-invite-form]");
  const inviteTokenEl = rootEl.querySelector<HTMLInputElement>("[data-desktop-invite-token]");
  const inviteNicknameEl = rootEl.querySelector<HTMLInputElement>("[data-desktop-invite-nickname]");
  const invitePasswordEl = rootEl.querySelector<HTMLInputElement>("[data-desktop-invite-password]");
  const inviteSubmitEl = rootEl.querySelector<HTMLButtonElement>("[data-desktop-invite-submit]");
  const inviteErrorEl = rootEl.querySelector<HTMLElement>("[data-desktop-invite-error]");
  inviteForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const token = inviteTokenEl?.value.trim() ?? "";
    const nickname = inviteNicknameEl?.value.trim() ?? "";
    const password = invitePasswordEl?.value ?? "";
    if (!token || !nickname || !password) {
      showError(inviteErrorEl, zh ? "请填写邀请令牌、昵称和密码。" : "Enter the invite token, nickname, and password.");
      return;
    }
    if (inviteSubmitEl) {
      inviteSubmitEl.disabled = true;
    }
    if (inviteErrorEl) {
      inviteErrorEl.hidden = true;
    }
    void runDesktopInviteAccept({
      client: input.client,
      invite: { token, nickname, password },
      ...(input.deviceName ? { deviceName: input.deviceName } : {}),
      ...(input.platform ? { platform: input.platform } : {}),
      storage: input.storage
    })
      .then(() => input.onSuccess())
      .catch((error: unknown) => {
        if (inviteSubmitEl) {
          inviteSubmitEl.disabled = false;
        }
        showError(inviteErrorEl, describeDesktopInviteError(error, input.locale));
      });
  });
}
