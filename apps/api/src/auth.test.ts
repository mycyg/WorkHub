import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import { isSessionActive } from "@workhub/db";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  CreateSessionInput,
  SessionRepository,
  SessionRow,
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
  issueSessionCookie,
  mintSession,
  resolveStreamUser,
  validateNickname,
  type AuthDependencies,
  type AuthEnv
} from "./middleware/auth.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createAdminClaimThrottle } from "./middleware/admin-claim-throttle.js";

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
    deletedByUserId: null,
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

  async promoteToAdmin(userId: string) {
    const row = this.rows.find((candidate) => candidate.id === userId && candidate.deletedAt === null);
    if (!row) {
      return null;
    }
    row.isAdmin = true;
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

function sessionRow(input: CreateSessionInput, seq = 1): SessionRow {
  return {
    id: input.id ?? `30000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    userId: input.userId,
    tokenHash: input.tokenHash,
    authMethod: input.authMethod ?? "password",
    oidcProvider: input.oidcProvider ?? null,
    ipHash: input.ipHash ?? null,
    userAgent: input.userAgent ?? null,
    absoluteExpiresAt: input.absoluteExpiresAt,
    idleExpiresAt: input.idleExpiresAt,
    lastSeenAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemorySessions implements SessionRepository {
  public rows: SessionRow[] = [];
  public touched: string[] = [];

  async create(input: CreateSessionInput) {
    const row = sessionRow(input, this.rows.length + 1);
    this.rows.push(row);
    return row;
  }

  async findActiveByTokenHash(tokenHash: string, at: Date) {
    return this.rows.find((row) => row.tokenHash === tokenHash && isSessionActive(row, at)) ?? null;
  }

  async touch(sessionId: string, idleExpiresAt: Date, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === sessionId && candidate.revokedAt === null);
    if (!row) {
      return null;
    }
    row.idleExpiresAt = idleExpiresAt;
    row.lastSeenAt = at;
    row.updatedAt = at;
    this.touched.push(sessionId);
    return row;
  }

  async revoke(sessionId: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === sessionId && candidate.revokedAt === null);
    if (!row) {
      return null;
    }
    row.revokedAt = at;
    row.updatedAt = at;
    return row;
  }

  async revokeAllForUser(userId: string, at: Date) {
    let count = 0;
    for (const row of this.rows) {
      if (row.userId === userId && row.revokedAt === null) {
        row.revokedAt = at;
        row.updatedAt = at;
        count += 1;
      }
    }
    return count;
  }

  async deleteExpired(at: Date) {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => row.absoluteExpiresAt >= at);
    return before - this.rows.length;
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

test("findings: require-local-client honors TOUCH_DEVICE_ON_AUTH=false (no write amplification)", async () => {
  const alice = user();
  const off = deps([alice], [device()], settings({ TOUCH_DEVICE_ON_AUTH: "false" }));
  const offRepo = off.devices as MemoryDevices;
  const offApp = withErrors(new Hono<AuthEnv>());
  offApp.get("/hard", createRequireLocalClientMiddleware(off), (c) => c.json({ ok: true }));
  const cookieOff = await signedCookie(alice.cookieToken, settings({ TOUCH_DEVICE_ON_AUTH: "false" }));
  const offRes = await offApp.request("/hard", {
    headers: { Cookie: cookieOff, [LOCAL_CLIENT_HEADER]: "client-token-alice" }
  });
  assert.equal(offRes.status, 200);
  assert.deepEqual(offRepo.touched, []);

  // 默认（开）仍每次刷新 lastSeen。
  const on = deps([alice], [device()], settings());
  const onRepo = on.devices as MemoryDevices;
  const onApp = withErrors(new Hono<AuthEnv>());
  onApp.get("/hard", createRequireLocalClientMiddleware(on), (c) => c.json({ ok: true }));
  const cookieOn = await signedCookie(alice.cookieToken, settings());
  await onApp.request("/hard", { headers: { Cookie: cookieOn, [LOCAL_CLIENT_HEADER]: "client-token-alice" } });
  assert.equal(onRepo.touched.length >= 1, true);
});

test("findings: current-user gate fails closed on a present-but-invalid client token (no cookie fallback)", async () => {
  const alice = user();
  const runtimeSettings = settings();
  const authDeps = deps([alice], [], runtimeSettings);
  const app = withErrors(new Hono<AuthEnv>());
  app.get("/me", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));
  const cookie = await signedCookie(alice.cookieToken, runtimeSettings);

  // cookie 单独 → 正常鉴权。
  assert.equal((await app.request("/me", { headers: { Cookie: cookie } })).status, 200);

  // 带垃圾 client-token header + 合法 cookie → fail-closed 403，不回退 cookie（堵 CSRF 同源守卫 header-存在即豁免 + cookie 回退的组合）。
  const badToken = await app.request("/me", {
    headers: { Cookie: cookie, [LOCAL_CLIENT_HEADER]: "bad-token" }
  });
  assert.equal(badToken.status, 403);
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

test("admin claim attempts are rate-limited and locked out after repeated wrong secrets", async () => {
  const app = withErrors(new Hono<AuthEnv>());
  // 低阈值 + 固定时钟，确定性验证锁定。
  const throttle = createAdminClaimThrottle({ maxFailures: 2, windowMs: 60_000, lockoutMs: 600_000, now: () => 1_000_000 });
  app.route(
    "/api/auth",
    createAuthRoutes(deps([], [], settings({ ADMIN_CLAIM_SECRET: "let-me-in" })), { adminClaimThrottle: throttle })
  );
  const attempt = (secret: string) =>
    app.request("/api/auth/identify", {
      method: "POST",
      body: JSON.stringify({ nickname: "Sneaky", admin_secret: secret }),
      headers: { "Content-Type": "application/json" }
    });

  // 前两次错误口令 → 403。
  assert.equal((await attempt("wrong-1")).status, 403);
  assert.equal((await attempt("wrong-2")).status, 403);
  // 达到阈值后锁定：第三次（即便口令正确也）被 429 拦在校验之前。
  assert.equal((await attempt("wrong-3")).status, 429);
  assert.equal((await attempt("let-me-in")).status, 429);
});

test("admin claim throttle does not block ordinary nickname logins", async () => {
  const app = withErrors(new Hono<AuthEnv>());
  const throttle = createAdminClaimThrottle({ maxFailures: 1, windowMs: 60_000, lockoutMs: 600_000, now: () => 2_000_000 });
  app.route(
    "/api/auth",
    createAuthRoutes(deps([], [], settings({ ADMIN_CLAIM_SECRET: "let-me-in" })), { adminClaimThrottle: throttle })
  );
  // 普通昵称登录（不带口令）不计入限流，连续多次都正常。
  for (let i = 0; i < 3; i += 1) {
    const response = await app.request("/api/auth/identify", {
      method: "POST",
      body: JSON.stringify({ nickname: `Member ${i}` }),
      headers: { "Content-Type": "application/json" }
    });
    assert.equal(response.status, 201);
  }
});

test("a fresh user claims admin with the configured secret (pilot bootstrap)", async () => {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([], [], settings({ ADMIN_CLAIM_SECRET: "let-me-in" }))));

  const response = await app.request("/api/auth/identify", {
    method: "POST",
    body: JSON.stringify({ nickname: "Pilot Admin", admin_secret: "let-me-in" }),
    headers: { "Content-Type": "application/json" }
  });

  assert.equal(response.status, 201);
  const body = await response.json() as { is_admin: boolean };
  assert.equal(body.is_admin, true);
});

test("a wrong claim secret fails closed instead of silently downgrading", async () => {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([], [], settings({ ADMIN_CLAIM_SECRET: "let-me-in" }))));

  const response = await app.request("/api/auth/identify", {
    method: "POST",
    body: JSON.stringify({ nickname: "Sneaky", admin_secret: "wrong" }),
    headers: { "Content-Type": "application/json" }
  });

  assert.equal(response.status, 403);
});

test("registering without a secret stays a regular user", async () => {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([], [], settings({ ADMIN_CLAIM_SECRET: "let-me-in" }))));

  const response = await app.request("/api/auth/identify", {
    method: "POST",
    body: JSON.stringify({ nickname: "Member One" }),
    headers: { "Content-Type": "application/json" }
  });

  assert.equal(response.status, 201);
  const body = await response.json() as { is_admin: boolean };
  assert.equal(body.is_admin, false);
});

test("findings: malformed JSON body to /identify is a 400, not a 500", async () => {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([], [], settings())));

  const response = await app.request("/api/auth/identify", {
    method: "POST",
    body: "{not valid json",
    headers: { "Content-Type": "application/json" }
  });

  assert.equal(response.status, 400);
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

// ——— R2 auth epic Phase 2b：AUTH_MODE 会话 cookie 解析 ———

test("AUTH_MODE=password resolves a session-secret cookie and slides idle expiry", async () => {
  const runtimeSettings = settings({ AUTH_MODE: "password" });
  const alice = user({ nickname: "alice" });
  const sessions = new MemorySessions();
  const authDeps: AuthDependencies = { ...deps([alice], [], runtimeSettings), sessions };
  const { token, session } = await mintSession(authDeps, alice, { authMethod: "password" });

  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));
  const res = await app.request("/who", { headers: { Cookie: await signedCookie(token, runtimeSettings) } });

  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { id: string }).id, alice.id);
  assert.ok(sessions.touched.includes(session.id), "每次鉴权应滑动续期会话");
});

test("AUTH_MODE=password rejects revoked and idle-expired sessions", async () => {
  const runtimeSettings = settings({ AUTH_MODE: "password" });
  const alice = user({ nickname: "alice" });
  const sessions = new MemorySessions();
  const authDeps: AuthDependencies = { ...deps([alice], [], runtimeSettings), sessions };

  const revoked = await mintSession(authDeps, alice);
  await sessions.revoke(revoked.session.id, now);

  const expired = await mintSession(authDeps, alice);
  const expiredRow = sessions.rows.find((row) => row.id === expired.session.id);
  assert.ok(expiredRow);
  expiredRow.idleExpiresAt = new Date(now.getTime() - 1000); // 滑动已过期

  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));

  const revokedRes = await app.request("/who", { headers: { Cookie: await signedCookie(revoked.token, runtimeSettings) } });
  assert.equal(revokedRes.status, 401);
  const expiredRes = await app.request("/who", { headers: { Cookie: await signedCookie(expired.token, runtimeSettings) } });
  assert.equal(expiredRes.status, 401);
});

test("AUTH_MODE=password is session-only and ignores the legacy cookieToken", async () => {
  const runtimeSettings = settings({ AUTH_MODE: "password" });
  const alice = user({ nickname: "alice" });
  const sessions = new MemorySessions();
  const authDeps: AuthDependencies = { ...deps([alice], [], runtimeSettings), sessions };

  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));
  // 老的 cookieToken 不再是会话凭据 → 纯 session 模式拒绝。
  const res = await app.request("/who", { headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) } });
  assert.equal(res.status, 401);
});

test("AUTH_MODE=nickname (default) ignores session cookies — gate is off", async () => {
  const runtimeSettings = settings(); // 默认 nickname
  const alice = user({ nickname: "alice" });
  const sessions = new MemorySessions();
  const authDeps: AuthDependencies = { ...deps([alice], [], runtimeSettings), sessions };
  const { token } = await mintSession(authDeps, alice);

  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));
  // 即便存在会话且 cookie 载会话 secret，nickname 模式只认 cookieToken → 会话被忽略。
  const sessionRes = await app.request("/who", { headers: { Cookie: await signedCookie(token, runtimeSettings) } });
  assert.equal(sessionRes.status, 401);
  // 老路径 cookieToken 仍照常工作（逐字节不变）。
  const cookieRes = await app.request("/who", { headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) } });
  assert.equal(cookieRes.status, 200);
});

test("AUTH_MODE=hybrid resolves sessions and falls back to the legacy cookieToken", async () => {
  const runtimeSettings = settings({ AUTH_MODE: "hybrid" });
  const alice = user({ nickname: "alice" });
  const sessions = new MemorySessions();
  const authDeps: AuthDependencies = { ...deps([alice], [], runtimeSettings), sessions };
  const { token } = await mintSession(authDeps, alice);

  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));
  const sessionRes = await app.request("/who", { headers: { Cookie: await signedCookie(token, runtimeSettings) } });
  assert.equal(sessionRes.status, 200);
  // 迁移期：尚未签发会话的老用户继续靠 cookieToken 进。
  const cookieRes = await app.request("/who", { headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) } });
  assert.equal(cookieRes.status, 200);
});

test("issueSessionCookie round-trips through resolveCurrentUser in password mode", async () => {
  const runtimeSettings = settings({ AUTH_MODE: "password" });
  const alice = user({ nickname: "alice" });
  const sessions = new MemorySessions();
  const authDeps: AuthDependencies = { ...deps([alice], [], runtimeSettings), sessions };

  const app = withErrors(new Hono<AuthEnv>());
  app.post("/login", async (c) => {
    const { token } = await mintSession(authDeps, alice, { authMethod: "password" });
    await issueSessionCookie(c, token, runtimeSettings);
    return c.json({ ok: true });
  });
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));

  const loginRes = await app.request("/login", { method: "POST" });
  const setCookie = loginRes.headers.get("set-cookie");
  assert.ok(setCookie, "login should set the session cookie");
  const cookiePair = setCookie.split(";")[0] ?? "";
  const whoRes = await app.request("/who", { headers: { Cookie: cookiePair } });
  assert.equal(whoRes.status, 200);
  assert.equal(((await whoRes.json()) as { id: string }).id, alice.id);
});

test("resolveStreamUser resolves a session cookie in password mode", async () => {
  const runtimeSettings = settings({ AUTH_MODE: "password" });
  const alice = user({ nickname: "alice" });
  const sessions = new MemorySessions();
  const authDeps: AuthDependencies = { ...deps([alice], [], runtimeSettings), sessions };
  const { token } = await mintSession(authDeps, alice);

  const app = withErrors(new Hono<AuthEnv>());
  app.get("/stream", async (c) => c.json(await resolveStreamUser(c, authDeps)));
  const res = await app.request("/stream", { headers: { Cookie: await signedCookie(token, runtimeSettings) } });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { nickname: string }).nickname, "alice");
});
