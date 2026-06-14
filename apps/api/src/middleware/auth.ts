import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import { authDefaults, settings as defaultSettings, type Settings } from "@workhub/config";
import { defaultWorkHubLocale, type ActorKind } from "@workhub/contracts";
import {
  createClientDeviceRepository,
  getSharedDatabaseClient,
  createUserRepository,
  type ClientDeviceAuthRow,
  type ClientDeviceRepository,
  type UserAuthRow,
  type UserRepository,
  type WorkHubDatabaseClient
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
};

export type AuthVariables = {
  currentUser: UserAuthRow;
  currentClientDevice?: ClientDeviceAuthRow;
  actor: AuthActor;
};

export type AuthEnv = {
  Variables: AuthVariables;
};

export type AuthDependencies = {
  users: UserRepository;
  devices: ClientDeviceRepository;
  settings?: Settings;
  now?: () => Date;
  touchUser?: (userId: string) => void | Promise<void>;
  forgetUser?: (userId: string) => void | Promise<void>;
};

export type AuthDependencySource = AuthDependencies | (() => AuthDependencies);

let defaultDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultAuthDependencies(): AuthDependencies {
  defaultDbClient ??= getSharedDatabaseClient();
  const presence = getDefaultPresenceStore();
  return {
    users: createUserRepository(defaultDbClient.db),
    devices: createClientDeviceRepository(defaultDbClient.db),
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

export async function resolveCurrentUser(c: Context, deps: AuthDependencies) {
  const byToken = await resolveUserFromClientToken(deps, c.req.header(LOCAL_CLIENT_HEADER));
  if (byToken) {
    await deps.touchUser?.(byToken.user.id);
    return byToken.user;
  }

  const cookieToken = await readCookieToken(c, getAuthSettings(deps));
  if (cookieToken) {
    const user = await deps.users.findActiveByCookieToken(cookieToken);
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

  await deps.devices.touchLastSeen(device.id, (deps.now ?? (() => new Date()))());
  return device;
}

export async function resolveOptionalLocalClient(c: Context, deps: AuthDependencies, user: UserAuthRow) {
  if (!c.req.header(LOCAL_CLIENT_HEADER)?.trim()) {
    return null;
  }
  return resolveCurrentClientDevice(c, deps, user);
}

export async function resolveStreamUser(c: Context, deps: AuthDependencies): Promise<StreamUser> {
  const byToken = await resolveUserFromClientToken(deps, c.req.header(LOCAL_CLIENT_HEADER));
  if (byToken) {
    await deps.touchUser?.(byToken.user.id);
    return { id: byToken.user.id, nickname: byToken.user.nickname, isAdmin: byToken.user.isAdmin };
  }

  const cookieToken = await readCookieToken(c, getAuthSettings(deps));
  if (cookieToken) {
    const user = await deps.users.findActiveByCookieToken(cookieToken);
    if (user) {
      await deps.touchUser?.(user.id);
      return { id: user.id, nickname: user.nickname, isAdmin: user.isAdmin };
    }
  }

  throw new HTTPException(401, { message: "not identified" });
}

export function createCurrentUserMiddleware(source: AuthDependencySource = getDefaultAuthDependencies) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const deps = resolveAuthDependencies(source);
    const user = await resolveCurrentUser(c, deps);
    c.set("currentUser", user);
    c.set("actor", createHumanActor(user, getAuthSettings(deps)));
    await next();
  });
}

export function createOptionalCurrentUserMiddleware(source: AuthDependencySource = getDefaultAuthDependencies) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const deps = resolveAuthDependencies(source);
    const user = await resolveOptionalCurrentUser(c, deps);
    if (user) {
      c.set("currentUser", user);
      c.set("actor", createHumanActor(user, getAuthSettings(deps)));
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
    c.set("actor", createHumanActor(user, getAuthSettings(deps)));
    await next();
  });
}

export function createOptionalLocalClientMiddleware(source: AuthDependencySource = getDefaultAuthDependencies) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const deps = resolveAuthDependencies(source);
    const user = await resolveCurrentUser(c, deps);
    const device = await resolveOptionalLocalClient(c, deps, user);
    c.set("currentUser", user);
    c.set("actor", createHumanActor(user, getAuthSettings(deps)));
    if (device) {
      c.set("currentClientDevice", device);
    }
    await next();
  });
}

export const requireActor = (source: AuthDependencySource = getDefaultAuthDependencies): MiddlewareHandler<AuthEnv> =>
  createCurrentUserMiddleware(source);
