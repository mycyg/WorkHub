import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  UserAuthRow,
  UserRepository
} from "@workhub/db";
import type { WorkHubLocale } from "@workhub/contracts";

import {
  COOKIE_NAME,
  LOCAL_CLIENT_HEADER,
  createAiActor,
  createCurrentUserMiddleware,
  createOptionalLocalClientMiddleware,
  createRequireLocalClientMiddleware,
  hashClientToken,
  resolveStreamUser,
  validateNickname,
  type AuthDependencies,
  type AuthEnv
} from "./middleware/auth.js";
import { createAuthRoutes } from "./routes/auth.js";

const now = new Date("2026-06-05T00:00:00.000Z");

function user(partial: Partial<UserAuthRow> = {}): UserAuthRow {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    nickname: "alice",
    cookieToken: "cookie-alice",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

function device(partial: Partial<ClientDeviceAuthRow> = {}): ClientDeviceAuthRow {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    userId: "10000000-0000-4000-8000-000000000001",
    deviceName: "Tauri Client",
    clientTokenHash: hashClientToken("client-token-alice"),
    platform: "windows",
    lastSeenAt: now,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

class MemoryUsers implements UserRepository {
  constructor(private rows: UserAuthRow[]) {}

  async findActiveById(id: string) {
    return this.rows.find((row) => row.id === id && row.deletedAt === null) ?? null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return this.rows.find((row) => row.cookieToken === cookieToken && row.deletedAt === null) ?? null;
  }

  async findActiveByNickname(nickname: string) {
    return this.rows.find((row) => row.nickname === nickname && row.deletedAt === null) ?? null;
  }

  async createUser(input: Parameters<UserRepository["createUser"]>[0]) {
    const row = user({
      id: input.id ?? `10000000-0000-4000-8000-${String(this.rows.length + 10).padStart(12, "0")}`,
      nickname: input.nickname,
      cookieToken: input.cookieToken,
      isAdmin: input.isAdmin ?? false
    });
    this.rows.push(row);
    return row;
  }

  async getOrCreateActiveByNickname(nickname: string, newCookieToken: string) {
    const existing = await this.findActiveByNickname(nickname);
    if (existing) {
      return { user: existing, created: false };
    }
    return { user: await this.createUser({ nickname, cookieToken: newCookieToken }), created: true };
  }

  async rotateCookieToken(userId: string, cookieToken: string) {
    const row = this.rows.find((candidate) => candidate.id === userId && candidate.deletedAt === null);
    if (!row) {
      return null;
    }
    row.cookieToken = cookieToken;
    row.updatedAt = now;
    return row;
  }

  async updatePreferredLocale(userId: string, locale: WorkHubLocale) {
    const row = this.rows.find((candidate) => candidate.id === userId && candidate.deletedAt === null);
    if (!row) {
      return null;
    }
    row.preferredLocale = locale;
    row.updatedAt = now;
    return row;
  }
}

class MemoryDevices implements ClientDeviceRepository {
  public touched: string[] = [];

  constructor(private rows: ClientDeviceAuthRow[]) {}

  async findActiveByTokenHash(tokenHash: string) {
    return this.rows.find((row) => row.clientTokenHash === tokenHash && row.revokedAt === null) ?? null;
  }

  async findActiveByTokenHashForUser(tokenHash: string, userId: string) {
    return (
      this.rows.find(
        (row) => row.clientTokenHash === tokenHash && row.userId === userId && row.revokedAt === null
      ) ?? null
    );
  }

  async createClientDevice(input: Parameters<ClientDeviceRepository["createClientDevice"]>[0]) {
    const row = device({
      id: input.id ?? `20000000-0000-4000-8000-${String(this.rows.length + 10).padStart(12, "0")}`,
      userId: input.userId,
      deviceName: input.deviceName,
      platform: input.platform,
      clientTokenHash: input.clientTokenHash,
      lastSeenAt: input.lastSeenAt
    });
    this.rows.push(row);
    return row;
  }

  async listByUser(userId: string) {
    return this.rows.filter((row) => row.userId === userId);
  }

  async touchLastSeen(deviceId: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === deviceId) ?? null;
    if (row) {
      row.lastSeenAt = at;
      row.updatedAt = at;
      this.touched.push(deviceId);
    }
    return row;
  }

  async revokeByIdForUser(deviceId: string, userId: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === deviceId && candidate.userId === userId) ?? null;
    if (row && row.revokedAt === null) {
      row.revokedAt = at;
      row.updatedAt = at;
    }
    return row;
  }

  async revokeByTokenHash(tokenHash: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.clientTokenHash === tokenHash && candidate.revokedAt === null);
    if (row) {
      row.revokedAt = at;
      row.updatedAt = at;
    }
    return row ?? null;
  }
}

function settings(env: Record<string, string | undefined> = {}): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret",
    ...env
  });
}

function deps(users: UserAuthRow[], devices: ClientDeviceAuthRow[], runtimeSettings = settings()): AuthDependencies {
  return {
    users: new MemoryUsers(users),
    devices: new MemoryDevices(devices),
    settings: runtimeSettings,
    now: () => now
  };
}

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "auth_error", message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

async function signedCookie(cookieToken: string, runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, cookieToken, runtimeSettings.auth.cookieSecret);
}

test("valid device token wins over a different signed cookie identity", async () => {
  const alice = user();
  const bob = user({
    id: "10000000-0000-4000-8000-000000000002",
    nickname: "bob",
    cookieToken: "cookie-bob"
  });
  const authDeps = deps([alice, bob], [device()]);
  const deviceRepo = authDeps.devices as MemoryDevices;
  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));

  const response = await app.request("/who", {
    headers: {
      [LOCAL_CLIENT_HEADER]: "client-token-alice",
      Cookie: await signedCookie(bob.cookieToken, authDeps.settings as Settings)
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: alice.id });
  assert.deepEqual(deviceRepo.touched, ["20000000-0000-4000-8000-000000000001"]);
});

test("soft-deleted cookie user is treated as not identified", async () => {
  const runtimeSettings = settings();
  const deleted = user({ deletedAt: now });
  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(deps([deleted], [], runtimeSettings)), (c) =>
    c.json({ id: c.var.currentUser.id })
  );

  const response = await app.request("/who", {
    headers: { Cookie: await signedCookie(deleted.cookieToken, runtimeSettings) }
  });

  assert.equal(response.status, 401);
});

test("hard and soft local-client gates keep their old distinction", async () => {
  const alice = user();
  const runtimeSettings = settings();
  const authDeps = deps([alice], [], runtimeSettings);
  const app = withErrors(new Hono<AuthEnv>());
  app.get("/hard", createRequireLocalClientMiddleware(authDeps), (c) => c.json({ local: true }));
  app.get("/soft", createOptionalLocalClientMiddleware(authDeps), (c) =>
    c.json({ local: Boolean(c.var.currentClientDevice) })
  );
  const cookie = await signedCookie(alice.cookieToken, runtimeSettings);

  assert.equal((await app.request("/hard", { headers: { Cookie: cookie } })).status, 403);

  const softNoToken = await app.request("/soft", { headers: { Cookie: cookie } });
  assert.equal(softNoToken.status, 200);
  assert.deepEqual(await softNoToken.json(), { local: false });

  const softBadToken = await app.request("/soft", {
    headers: { Cookie: cookie, [LOCAL_CLIENT_HEADER]: "bad-token" }
  });
  assert.equal(softBadToken.status, 403);
});

test("admin nickname claim fails closed when admin secret is empty", async () => {
  const admin = user({ nickname: "owner", isAdmin: true });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([admin], [], settings({ ADMIN_CLAIM_SECRET: "" }))));

  const response = await app.request("/api/auth/identify", {
    method: "POST",
    body: JSON.stringify({ nickname: "owner" }),
    headers: { "Content-Type": "application/json" }
  });

  assert.equal(response.status, 403);
});

test("admin nickname claim accepts the configured secret", async () => {
  const admin = user({ nickname: "owner", isAdmin: true });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([admin], [], settings({ ADMIN_CLAIM_SECRET: "let-me-in" }))));

  const response = await app.request("/api/auth/identify", {
    method: "POST",
    body: JSON.stringify({ nickname: "owner", admin_secret: "let-me-in" }),
    headers: { "Content-Type": "application/json" }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Set-Cookie")?.includes(COOKIE_NAME), true);
});

test("identity exposes and updates the bilingual locale preference", async () => {
  const alice = user();
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([alice], [], runtimeSettings)));
  const cookie = await signedCookie(alice.cookieToken, runtimeSettings);

  const before = await app.request("/api/auth/me", {
    headers: { Cookie: cookie }
  });
  assert.equal(before.status, 200);
  const beforeBody = await before.json() as { preferences: { locale: string } };
  assert.equal(beforeBody.preferences.locale, "zh-CN");

  const updated = await app.request("/api/auth/preferences", {
    method: "PATCH",
    body: JSON.stringify({ locale: "en" }),
    headers: { Cookie: cookie, "Content-Type": "application/json" }
  });
  assert.equal(updated.status, 200);
  const updatedBody = await updated.json() as { locale: string };
  assert.equal(updatedBody.locale, "en-US");

  const after = await app.request("/api/auth/me", {
    headers: { Cookie: cookie }
  });
  const body = await after.json() as { locale: string; preferences: { locale: string } };
  assert.equal(body.locale, "en-US");
  assert.equal(body.preferences.locale, "en-US");
});

test("nickname validation rejects tombstones and controls but allows non-ASCII names", () => {
  assert.throws(() => validateNickname("_deleted_alice"));
  assert.throws(() => validateNickname("alice\nbob"));
  assert.equal(validateNickname(" 小云✨ "), "小云✨");
});

test("logout rotates the cookie token and revokes only the presented client token", async () => {
  const alice = user();
  const currentDevice = device();
  const authDeps = deps([alice], [currentDevice]);
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));

  const response = await app.request("/api/auth/logout", {
    method: "POST",
    headers: { [LOCAL_CLIENT_HEADER]: "client-token-alice" }
  });

  assert.equal(response.status, 200);
  assert.notEqual(alice.cookieToken, "cookie-alice");
  assert.equal(currentDevice.revokedAt?.toISOString(), now.toISOString());
});

test("stream identity resolves without a request-scoped DB session concept", async () => {
  const alice = user();
  const authDeps = deps([alice], [device()]);
  const app = new Hono<AuthEnv>();
  app.get("/stream-user", async (c) => c.json(await resolveStreamUser(c, authDeps)));

  const response = await app.request("/stream-user", {
    headers: { [LOCAL_CLIENT_HEADER]: "client-token-alice" }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: alice.id, nickname: alice.nickname, isAdmin: false });
});

test("AI actor construction is first-class and never touches cookie auth", () => {
  const actor = createAiActor("run-123", "AI worker", settings());

  assert.deepEqual(actor, {
    kind: "ai",
    id: "run-123",
    label: "AI worker",
    isAdmin: false,
    orgId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002"
  });
});
