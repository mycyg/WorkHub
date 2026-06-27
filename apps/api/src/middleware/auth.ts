import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import { authDefaults, settings as defaultSettings, type Settings } from "@workhub/config";
import { defaultWorkHubLocale, type ActorKind } from "@workhub/contracts";
import {
  createAuditLogRepository,
  createClientDeviceRepository,
  createCredentialRepository,
  createInviteRepository,
  createSessionRepository,
  createWorkItemRepository,
  createWorkspaceMembershipRepository,
  generateSessionToken,
  getSharedDatabaseClient,
  createUserRepository,
  hashSessionToken,
  nextIdleExpiry,
  type AuditLogRepository,
  type ClientDeviceAuthRow,
  type ClientDeviceRepository,
  type CredentialRepository,
  type InviteRepository,
  type SessionAuthMethod,
  type SessionRepository,
  type SessionRow,
  type UserAuthRow,
  type UserRepository,
  type WorkHubDatabaseClient,
  type WorkItemClaimHandoverRepository,
  type WorkspaceMembershipRepository
} from "@workhub/db";

import { getDefaultPresenceStore } from "../broker/presence.js";

export const COOKIE_NAME = authDefaults.cookieName;
export const LOCAL_CLIENT_HEADER = authDefaults.localClientHeader;

export type AuthActor = {
  kind: ActorKind;
  id: string;
  label: string;
  userId?: string;
  isAdmin: boolean;
  orgId: string;
  workspaceId: string;
};

export type StreamUser = {
  id: string;
  nickname: string;
  isAdmin: boolean;
  // findings[#tenancy]：流订阅要按真实工作区隔离全局 'all' 话题，故携带认证身份解析出的租户，
  // 不再硬编码 'stream'。单租户下解析结果 == default{Org,Workspace}Id，行为等价。
  orgId: string;
  workspaceId: string;
};

export type AuthVariables = {
  currentUser: UserAuthRow;
  currentClientDevice?: ClientDeviceAuthRow;
  actor: AuthActor;
};

export type AuthEnv = {
  Variables: AuthVariables;
};

// R2 audit 修复：注册/接受邀请要做跨表写（建 user → 建 credential[→ 建成员 → 标记邀请已用]）。
// createUser 之后任一步失败都会留下孤儿 user 行并永久烧掉那个唯一昵称。把这组写聚成一个原子单元：
// 生产注入 db.transaction 版（任一步抛即整笔回滚，不留孤儿、不烧昵称），测试注入假仓库则该 seam 缺席，
// 路由回退到原顺序写（假仓库无真事务，靠下方补偿/顺序语义保持单测绿）。与 cost-policy-store 同范式。
export type AuthAtomicWriteRepos = {
  users: Pick<UserRepository, "createUser">;
  credentials: Pick<CredentialRepository, "createCredential">;
  // OPTIONAL：注册不带成员/邀请写；接受邀请才两者皆有。显式写 | undefined 以兼容
  // exactOptionalPropertyTypes（调用方可直接传 deps.memberships 这一可能 undefined 的值）。
  memberships?: Pick<WorkspaceMembershipRepository, "create"> | undefined;
  invites?: Pick<InviteRepository, "accept"> | undefined;
};

export type AuthAtomicWrites = <T>(write: (repos: AuthAtomicWriteRepos) => Promise<T>) => Promise<T>;

export type AuthDependencies = {
  users: UserRepository;
  devices: ClientDeviceRepository;
  // R2 audit 修复：把注册/接受邀请的跨表写包进单个 db.transaction（tx-bound 仓库）。OPTIONAL——
  // 生产由 getDefaultAuthDependencies 注入真事务；假仓库不提供时路由回退顺序写（见 routes/auth.ts）。
  atomicAuthWrites?: AuthAtomicWrites;
  // R2 auth epic：会话仓库为 OPTIONAL——仅 AUTH_MODE!='nickname' 时被查询；nickname 模式（默认）下整段跳过，
  // 单测不传则会话路径不参与（与原子预算 reservationRepo 同范式）。
  sessions?: SessionRepository;
  // R2 auth epic：口令凭据仓库为 OPTIONAL——仅密码注册/登录路由用；nickname 模式不触及。
  credentials?: CredentialRepository;
  // R2 多租户 epic：成员仓库为 OPTIONAL——提供时 actor 租户从默认成员行派生，否则回退 config 常量。
  // 单测不传则 actor 走常量（与今天一致）；生产注入后因 seed 让现有用户都指向默认工作区而零可观测变化。
  memberships?: WorkspaceMembershipRepository;
  // R2 auth epic：邀请仓库为 OPTIONAL——仅邀请路由用。
  invites?: InviteRepository;
  // 用户停用-工作交接：停用时把被停用用户认领中的非终态事项退回可领取池（claimedByUserId=null），
  // 避免在岗工作卡在已消失的人身上。OPTIONAL——仅停用路由用；未注入则跳过（与会话/凭据清理同为可选善后）。
  workItems?: WorkItemClaimHandoverRepository;
  // 交接审计：每条被退回的事项写一笔审计日志（actor=执行停用的管理员），让交接可追溯。OPTIONAL——
  // 与 workItems 配套；缺任一则跳过审计写（停用主流程不受影响）。
  auditLogs?: Pick<AuditLogRepository, "createAuditLog">;
  settings?: Settings;
  now?: () => Date;
  touchUser?: (userId: string) => void | Promise<void>;
  forgetUser?: (userId: string) => void | Promise<void>;
};

export type AuthDependencySource = AuthDependencies | (() => AuthDependencies);

let defaultDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultAuthDependencies(): AuthDependencies {
  defaultDbClient ??= getSharedDatabaseClient();
  const dbClient = defaultDbClient;
  const presence = getDefaultPresenceStore();
  return {
    users: createUserRepository(dbClient.db),
    devices: createClientDeviceRepository(dbClient.db),
    sessions: createSessionRepository(dbClient.db),
    credentials: createCredentialRepository(dbClient.db),
    memberships: createWorkspaceMembershipRepository(dbClient.db),
    invites: createInviteRepository(dbClient.db),
    // 用户停用-工作交接：退回被停用用户认领的非终态事项 + 逐项写审计日志。
    workItems: createWorkItemRepository(dbClient.db),
    auditLogs: createAuditLogRepository(dbClient.db),
    // R2 audit 修复：注册/接受邀请的跨表写在同一事务内（tx-bound 仓库，任一步抛即整笔回滚）。
    // tx 与 db 共享查询接口，故可现起 tx-bound 仓库——与 cost-policy-store 的原子审计写同范式。
    atomicAuthWrites: (write) =>
      dbClient.db.transaction((tx) =>
        write({
          users: createUserRepository(tx),
          credentials: createCredentialRepository(tx),
          memberships: createWorkspaceMembershipRepository(tx),
          invites: createInviteRepository(tx)
        })
      ),
    touchUser: (userId) => presence.touchUser(userId),
    forgetUser: (userId) => presence.forgetUser(userId)
  };
}

export function getAuthSettings(deps: AuthDependencies): Settings {
  return deps.settings ?? defaultSettings;
}

export function resolveAuthDependencies(source: AuthDependencySource = getDefaultAuthDependencies): AuthDependencies {
  return typeof source === "function" ? source() : source;
}

export function makeCookieToken() {
  return randomBytes(32).toString("base64url");
}

export function makeClientToken() {
  return randomBytes(48).toString("base64url");
}

export function hashClientToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function validateNickname(nickname: string) {
  const normalized = nickname.trim();
  if (normalized.length === 0) {
    throw new HTTPException(400, { message: "empty nickname" });
  }
  if (normalized.startsWith("_deleted_")) {
    throw new HTTPException(400, { message: "昵称不能以 _deleted_ 开头" });
  }
  if (/[\r\n\t\u0000]/u.test(normalized)) {
    throw new HTTPException(400, { message: "昵称不能包含控制字符" });
  }
  return normalized;
}

export function constantTimeEquals(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return left.length === right.length && timingSafeEqual(leftDigest, rightDigest);
}

export async function issueUserCookie(c: Context, user: UserAuthRow, runtimeSettings: Settings = defaultSettings) {
  await setSignedCookie(c, COOKIE_NAME, user.cookieToken, runtimeSettings.auth.cookieSecret, {
    httpOnly: true,
    maxAge: authDefaults.cookieMaxAgeSeconds,
    sameSite: "Lax",
    secure: runtimeSettings.auth.cookieSecure,
    path: "/"
  });
}

export function forgetUserCookie(c: Context, runtimeSettings: Settings = defaultSettings) {
  deleteCookie(c, COOKIE_NAME, {
    secure: runtimeSettings.auth.cookieSecure,
    path: "/"
  });
}

export async function readCookieToken(c: Context, runtimeSettings: Settings = defaultSettings) {
  const token = await getSignedCookie(c, runtimeSettings.auth.cookieSecret, COOKIE_NAME);
  return typeof token === "string" ? token : undefined;
}

// R2 auth epic：会话签发（session/hybrid 模式）。明文 secret 只回客户端一次（写进 signed cookie），
// 落库的是 sha256(secret)。绝对过期=now+absoluteTtl 硬上限；idle=滑动初值（≤绝对上限）。
export type MintSessionOptions = {
  authMethod?: SessionAuthMethod;
  oidcProvider?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
};

export async function mintSession(
  deps: AuthDependencies,
  user: UserAuthRow,
  options: MintSessionOptions = {}
): Promise<{ token: string; session: SessionRow }> {
  if (!deps.sessions) {
    throw new Error("session repository not configured");
  }
  const now = (deps.now ?? (() => new Date()))();
  const runtimeSettings = getAuthSettings(deps);
  const token = generateSessionToken();
  const absoluteExpiresAt = new Date(now.getTime() + runtimeSettings.auth.sessionAbsoluteTtlMs);
  const idleExpiresAt = nextIdleExpiry(now, runtimeSettings.auth.sessionIdleTtlMs, absoluteExpiresAt);
  const session = await deps.sessions.create({
    userId: user.id,
    tokenHash: hashSessionToken(token),
    authMethod: options.authMethod ?? "password",
    oidcProvider: options.oidcProvider ?? null,
    ipHash: options.ipHash ?? null,
    userAgent: options.userAgent ?? null,
    absoluteExpiresAt,
    idleExpiresAt
  });
  return { token, session };
}

export async function issueSessionCookie(c: Context, token: string, runtimeSettings: Settings = defaultSettings) {
  await setSignedCookie(c, COOKIE_NAME, token, runtimeSettings.auth.cookieSecret, {
    httpOnly: true,
    maxAge: Math.floor(runtimeSettings.auth.sessionAbsoluteTtlMs / 1000),
    sameSite: "Lax",
    secure: runtimeSettings.auth.cookieSecure,
    path: "/"
  });
}

export function toIdentityResponse(user: UserAuthRow, created: boolean) {
  const locale = user.preferredLocale ?? defaultWorkHubLocale;
  const response = {
    id: user.id,
    nickname: user.nickname,
    display_name: user.nickname,
    created,
    locale,
    preferences: {
      locale
    },
    is_admin: user.isAdmin,
    availability_status: user.availabilityStatus
  };

  if (user.availabilityText) {
    return { ...response, availability_text: user.availabilityText };
  }

  return response;
}

export function toClientDeviceResponse(device: ClientDeviceAuthRow) {
  const response = {
    id: device.id,
    user_id: device.userId,
    device_name: device.deviceName,
    platform: device.platform,
    created_at: device.createdAt.toISOString(),
    updated_at: device.updatedAt.toISOString()
  };

  return {
    ...response,
    ...(device.lastSeenAt ? { last_seen_at: device.lastSeenAt.toISOString() } : {}),
    ...(device.revokedAt ? { revoked_at: device.revokedAt.toISOString() } : {})
  };
}

export function createHumanActor(user: UserAuthRow, runtimeSettings: Settings = defaultSettings): AuthActor {
  return {
    kind: "human",
    id: user.id,
    label: user.nickname,
    userId: user.id,
    isAdmin: user.isAdmin,
    orgId: runtimeSettings.auth.defaultOrgId,
    workspaceId: runtimeSettings.auth.defaultWorkspaceId
  };
}

// R2 多租户 epic Phase 2：从成员关系派生 human actor 租户。提供 memberships 仓库时用默认成员行的
// 工作区+org；无默认成员（或未提供仓库）回退单租户常量。因 seed 让现有用户都有指向默认工作区的默认成员，
// 解析结果 == 今天常量产出 → 零可观测变化；只有真实第二工作区+成员出现时才开始区分。
export async function resolveHumanActor(deps: AuthDependencies, user: UserAuthRow): Promise<AuthActor> {
  const runtimeSettings = getAuthSettings(deps);
  if (deps.memberships) {
    const tenant = await deps.memberships.resolveDefaultTenant(user.id);
    if (tenant) {
      return {
        kind: "human",
        id: user.id,
        label: user.nickname,
        userId: user.id,
        isAdmin: user.isAdmin,
        orgId: tenant.orgId,
        workspaceId: tenant.workspaceId
      };
    }
  }
  // 无成员行 → 单租户常量兜底（滚动迁移期 / 密码注册尚未建成员的用户 / 单测不传仓库）。
  return createHumanActor(user, runtimeSettings);
}

export function createAiActor(
  agentRunId: string,
  label = "AI worker",
  runtimeSettings: Settings = defaultSettings
): AuthActor {
  return {
    kind: "ai",
    id: agentRunId,
    label,
    isAdmin: false,
    orgId: runtimeSettings.auth.defaultOrgId,
    workspaceId: runtimeSettings.auth.defaultWorkspaceId
  };
}

export function createSystemActor(
  id = "system",
  label = "WorkHub system",
  runtimeSettings: Settings = defaultSettings
): AuthActor {
  return {
    kind: "system",
    id,
    label,
    isAdmin: false,
    orgId: runtimeSettings.auth.defaultOrgId,
    workspaceId: runtimeSettings.auth.defaultWorkspaceId
  };
}

async function resolveUserFromClientToken(deps: AuthDependencies, rawToken: string | undefined) {
  const token = rawToken?.trim();
  if (!token) {
    return null;
  }

  const device = await deps.devices.findActiveByTokenHash(hashClientToken(token));
  if (!device) {
    return null;
  }

  const user = await deps.users.findActiveById(device.userId);
  if (!user) {
    return null;
  }

  const runtimeSettings = getAuthSettings(deps);
  if (runtimeSettings.auth.touchDeviceOnAuth) {
    await deps.devices.touchLastSeen(device.id, (deps.now ?? (() => new Date()))());
  }

  return { user, device };
}

// R2 auth epic：把 cookie 解析成用户。nickname 模式（默认）下与历史逐字节一致——直接走 cookieToken；
// session/hybrid 模式下 cookie 载会话 secret，经 sessions.token_hash 解析并滑动续期。
async function resolveUserFromCookie(
  deps: AuthDependencies,
  cookieToken: string,
  now: Date
): Promise<UserAuthRow | null> {
  const mode = getAuthSettings(deps).auth.authMode;
  if (mode !== "nickname" && deps.sessions) {
    const session = await deps.sessions.findActiveByTokenHash(hashSessionToken(cookieToken), now);
    if (session) {
      const user = await deps.users.findActiveById(session.userId);
      if (!user) {
        return null;
      }
      // 滑动续期：每次活动把 idle 过期推后（永不越过绝对硬上限）。
      const idleExpiresAt = nextIdleExpiry(now, getAuthSettings(deps).auth.sessionIdleTtlMs, session.absoluteExpiresAt);
      await deps.sessions.touch(session.id, idleExpiresAt, now);
      return user;
    }
    if (mode === "password") {
      // 纯 session 模式：会话解析不到就是未鉴权，绝不回退 cookieToken。
      return null;
    }
    // hybrid：迁移期允许回退 nickname cookieToken（尚未签发会话的老用户）。
  }
  return deps.users.findActiveByCookieToken(cookieToken);
}

export async function resolveCurrentUser(c: Context, deps: AuthDependencies) {
  const clientTokenHeader = c.req.header(LOCAL_CLIENT_HEADER);
  const byToken = await resolveUserFromClientToken(deps, clientTokenHeader);
  if (byToken) {
    await deps.touchUser?.(byToken.user.id);
    return byToken.user;
  }

  // findings：呈递了 client-token header 但解析不到有效设备 → fail-closed，不回退 cookie。否则 CSRF 同源守卫
  // 「存在即豁免」(csrf.ts) + 此处 cookie 回退，会让带垃圾 token 的跨站请求既跳过同源检查又靠 cookie 鉴权过关。
  // 用 403（与 soft local-client gate 对 bad token 的既有语义一致），而非 401。
  if (clientTokenHeader && clientTokenHeader.trim().length > 0) {
    throw new HTTPException(403, { message: "invalid client token" });
  }

  const cookieToken = await readCookieToken(c, getAuthSettings(deps));
  if (cookieToken) {
    const now = (deps.now ?? (() => new Date()))();
    const user = await resolveUserFromCookie(deps, cookieToken, now);
    if (user) {
      await deps.touchUser?.(user.id);
      return user;
    }
  }

  throw new HTTPException(401, { message: "not identified" });
}

export async function resolveOptionalCurrentUser(c: Context, deps: AuthDependencies) {
  try {
    return await resolveCurrentUser(c, deps);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export async function resolveCurrentClientDevice(c: Context, deps: AuthDependencies, user: UserAuthRow) {
  const token = c.req.header(LOCAL_CLIENT_HEADER)?.trim();
  if (!token) {
    throw new HTTPException(403, { message: "local client required" });
  }

  const device = await deps.devices.findActiveByTokenHashForUser(hashClientToken(token), user.id);
  if (!device) {
    throw new HTTPException(403, { message: "local client required" });
  }

  // findings[#low]：与 resolveUserFromClientToken 一致——TOUCH_DEVICE_ON_AUTH=false 时
  // 不该每个 require-local-client 请求都写一笔 lastSeen（写放大）。
  if (getAuthSettings(deps).auth.touchDeviceOnAuth) {
    await deps.devices.touchLastSeen(device.id, (deps.now ?? (() => new Date()))());
  }
  return device;
}

export async function resolveOptionalLocalClient(c: Context, deps: AuthDependencies, user: UserAuthRow) {
  if (!c.req.header(LOCAL_CLIENT_HEADER)?.trim()) {
    return null;
  }
  return resolveCurrentClientDevice(c, deps, user);
}

async function toStreamUser(deps: AuthDependencies, user: UserAuthRow): Promise<StreamUser> {
  // 从成员关系派生真实工作区（无成员行则回退单租户常量 defaultWorkspaceId）——与 human actor 同源，
  // 全局流话题据此隔离 (`all:<workspaceId>`)。
  const actor = await resolveHumanActor(deps, user);
  return {
    id: user.id,
    nickname: user.nickname,
    isAdmin: user.isAdmin,
    orgId: actor.orgId,
    workspaceId: actor.workspaceId
  };
}

export async function resolveStreamUser(c: Context, deps: AuthDependencies): Promise<StreamUser> {
  const clientTokenHeader = c.req.header(LOCAL_CLIENT_HEADER);
  const byToken = await resolveUserFromClientToken(deps, clientTokenHeader);
  if (byToken) {
    await deps.touchUser?.(byToken.user.id);
    return toStreamUser(deps, byToken.user);
  }
  if (clientTokenHeader && clientTokenHeader.trim().length > 0) {
    throw new HTTPException(403, { message: "invalid client token" });
  }

  const cookieToken = await readCookieToken(c, getAuthSettings(deps));
  if (cookieToken) {
    const now = (deps.now ?? (() => new Date()))();
    const user = await resolveUserFromCookie(deps, cookieToken, now);
    if (user) {
      await deps.touchUser?.(user.id);
      return toStreamUser(deps, user);
    }
  }

  throw new HTTPException(401, { message: "not identified" });
}

export function createCurrentUserMiddleware(source: AuthDependencySource = getDefaultAuthDependencies) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const deps = resolveAuthDependencies(source);
    const user = await resolveCurrentUser(c, deps);
    c.set("currentUser", user);
    c.set("actor", await resolveHumanActor(deps, user));
    await next();
  });
}

export function createOptionalCurrentUserMiddleware(source: AuthDependencySource = getDefaultAuthDependencies) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const deps = resolveAuthDependencies(source);
    const user = await resolveOptionalCurrentUser(c, deps);
    if (user) {
      c.set("currentUser", user);
      c.set("actor", await resolveHumanActor(deps, user));
    }
    await next();
  });
}

export function createRequireLocalClientMiddleware(source: AuthDependencySource = getDefaultAuthDependencies) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const deps = resolveAuthDependencies(source);
    const user = await resolveCurrentUser(c, deps);
    const device = await resolveCurrentClientDevice(c, deps, user);
    c.set("currentUser", user);
    c.set("currentClientDevice", device);
    c.set("actor", await resolveHumanActor(deps, user));
    await next();
  });
}

export function createOptionalLocalClientMiddleware(source: AuthDependencySource = getDefaultAuthDependencies) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const deps = resolveAuthDependencies(source);
    const user = await resolveCurrentUser(c, deps);
    const device = await resolveOptionalLocalClient(c, deps, user);
    c.set("currentUser", user);
    c.set("actor", await resolveHumanActor(deps, user));
    if (device) {
      c.set("currentClientDevice", device);
    }
    await next();
  });
}

export const requireActor = (source: AuthDependencySource = getDefaultAuthDependencies): MiddlewareHandler<AuthEnv> =>
  createCurrentUserMiddleware(source);
