import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type { ClientDeviceAuthRow, ClientDeviceRepository, UserAuthRow, UserRepository } from "@workhub/db";

import { httpErrorCodeFor } from "./http-error-codes.js";
import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import {
  UserAvatarServiceError,
  type GetUserAvatarResult,
  type UserAvatarService
} from "./services/user-avatar.js";

const now = new Date("2026-07-14T10:00:00.000Z");
const userId = "18000000-0000-4000-8000-000000000001";
const otherUserId = "18000000-0000-4000-8000-000000000002";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r14-avatar-route-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "张三",
    cookieToken: "cookie-avatar-owner",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    avatarWebp: null,
    avatarUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemoryUsers implements UserRepository {
  async findActiveById(id: string) {
    return id === userId ? user() : null;
  }
  async findActiveByCookieToken(token: string) {
    return token === "cookie-avatar-owner" ? user() : null;
  }
  async findActiveByNickname() {
    return null;
  }
  async createUser(): Promise<UserAuthRow> {
    throw new Error("not needed");
  }
  async getOrCreateActiveByNickname(): Promise<{ user: UserAuthRow; created: boolean }> {
    throw new Error("not needed");
  }
  async rotateCookieToken() {
    return null;
  }
}

class MemoryDevices implements ClientDeviceRepository {
  async findActiveByTokenHash() {
    return null;
  }
  async findActiveByTokenHashForUser() {
    return null;
  }
  async createClientDevice(): Promise<ClientDeviceAuthRow> {
    throw new Error("not needed");
  }
  async listByUser() {
    return [];
  }
  async touchLastSeen() {
    return null;
  }
  async revokeByIdForUser() {
    return null;
  }
  async revokeByTokenHash() {
    return null;
  }
}

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return {
    users: new MemoryUsers(),
    devices: new MemoryDevices(),
    settings: runtimeSettings,
    now: () => now
  };
}

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-avatar-owner", runtimeSettings.auth.cookieSecret);
}

function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
}

function service(overrides: Partial<UserAvatarService> = {}): UserAvatarService {
  return {
    async putMyAvatar() {
      return { avatar_updated_at: now.toISOString() };
    },
    async deleteMyAvatar() {
      return { avatar_updated_at: null };
    },
    async getUserAvatar() {
      return { kind: "found", bytes: pngBytes(), contentType: "image/png", etag: `"${now.getTime()}"` };
    },
    ...overrides
  };
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof UserAvatarServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    return c.json({ ok: false, error: { code: "internal_error", message: "internal" } }, 500);
  });
  return app;
}

async function routeModule() {
  const module = await import("./routes/user-avatar.js").catch(() => null);
  assert.ok(module, "missing user-avatar route module");
  assert.equal(typeof module.createUserAvatarRoutes, "function", "missing createUserAvatarRoutes export");
  return module;
}

async function routeApp(runtimeSettings: Settings, userAvatar: UserAvatarService) {
  const module = await routeModule();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", module.createUserAvatarRoutes({ auth: authDeps(runtimeSettings), userAvatar }));
  return app;
}

// ── auth gate ─────────────────────────────────────────────────────────────────────

test("PUT/DELETE /me/avatar and GET /users/:id/avatar all require authentication before touching the service", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(
    runtimeSettings,
    service({
      async putMyAvatar() {
        throw new Error("anonymous PUT must not reach the service");
      },
      async deleteMyAvatar() {
        throw new Error("anonymous DELETE must not reach the service");
      },
      async getUserAvatar() {
        throw new Error("anonymous GET must not reach the service");
      }
    })
  );

  const put = await app.request("/api/me/avatar", { method: "PUT", body: pngBytes() });
  const del = await app.request("/api/me/avatar", { method: "DELETE" });
  const get = await app.request(`/api/users/${otherUserId}/avatar`);

  assert.equal(put.status, 401);
  assert.equal(del.status, 401);
  assert.equal(get.status, 401);
});

// ── PUT /me/avatar ────────────────────────────────────────────────────────────────

test("PUT /me/avatar forwards the raw binary body to the service and returns its avatar_updated_at", async () => {
  const runtimeSettings = settings();
  const calls: Buffer[] = [];
  const bytes = pngBytes();
  const app = await routeApp(
    runtimeSettings,
    service({
      async putMyAvatar(input) {
        calls.push(input.bytes);
        return { avatar_updated_at: now.toISOString() };
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "image/png" };

  const response = await app.request("/api/me/avatar", { method: "PUT", headers, body: bytes });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: { avatar_updated_at: now.toISOString() } });
  assert.equal(calls.length, 1);
  assert.ok(calls[0]?.equals(bytes), "the exact uploaded bytes must reach the service unmodified");
});

test("PUT /me/avatar surfaces typed service errors (e.g. too-large, invalid format) with their own status/code", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(
    runtimeSettings,
    service({
      async putMyAvatar() {
        throw new UserAvatarServiceError(413, "avatar_too_large", "头像文件不能超过 256KB，请压缩后重新上传。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request("/api/me/avatar", { method: "PUT", headers, body: pngBytes() });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "avatar_too_large", message: "头像文件不能超过 256KB，请压缩后重新上传。" }
  });
});

// ── DELETE /me/avatar ───────────────────────────────────────────────────────────────

test("DELETE /me/avatar returns avatar_updated_at: null on success", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(runtimeSettings, service());
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request("/api/me/avatar", { method: "DELETE", headers });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: { avatar_updated_at: null } });
});

// ── GET /users/:id/avatar ────────────────────────────────────────────────────────────

test("GET /users/:id/avatar rejects a non-uuid id with 404, not 500 (no PG 22P02 leak)", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(
    runtimeSettings,
    service({
      async getUserAvatar() {
        throw new Error("must not reach the service for a non-uuid id");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request("/api/users/not-a-uuid/avatar", { headers });

  assert.equal(response.status, 404);
});

test("GET /users/:id/avatar returns raw image bytes with the right Content-Type/ETag headers", async () => {
  const runtimeSettings = settings();
  const bytes = pngBytes();
  const app = await routeApp(
    runtimeSettings,
    service({
      async getUserAvatar(): Promise<GetUserAvatarResult> {
        return { kind: "found", bytes, contentType: "image/png", etag: `"${now.getTime()}"` };
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request(`/api/users/${otherUserId}/avatar`, { headers });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("ETag"), `"${now.getTime()}"`);
  const body = Buffer.from(await response.arrayBuffer());
  assert.ok(body.equals(bytes));
});

test("GET /users/:id/avatar with a matching If-None-Match returns an empty 304 with the ETag echoed back", async () => {
  const runtimeSettings = settings();
  const etag = `"${now.getTime()}"`;
  const app = await routeApp(
    runtimeSettings,
    service({
      async getUserAvatar(input) {
        assert.equal(input.ifNoneMatch, etag);
        return { kind: "not_modified", etag };
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "If-None-Match": etag };

  const response = await app.request(`/api/users/${otherUserId}/avatar`, { headers });

  assert.equal(response.status, 304);
  assert.equal(response.headers.get("ETag"), etag);
  const body = await response.arrayBuffer();
  assert.equal(body.byteLength, 0);
});

test("GET /users/:id/avatar for a user with no avatar / not in the same workspace surfaces 404 from the service", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(
    runtimeSettings,
    service({
      async getUserAvatar() {
        throw new UserAvatarServiceError(404, "user_avatar_not_found", "找不到这位用户的头像。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request(`/api/users/${otherUserId}/avatar`, { headers });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "user_avatar_not_found", message: "找不到这位用户的头像。" }
  });
});
