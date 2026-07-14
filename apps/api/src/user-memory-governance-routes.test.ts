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
import { createUserMemoryGovernanceRoutes } from "./routes/user-memory-governance.js";
import {
  UserMemoryGovernanceServiceError,
  type UserMemoryGovernanceService
} from "./services/user-memory-governance.js";

const now = new Date("2026-07-14T10:00:00.000Z");
const userId = "18000000-0000-4000-8000-000000000001";
const memoryId = "18000000-0000-4000-8000-000000000101";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r14-mem-user-memory-route-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "张三",
    cookieToken: "cookie-mem-owner",
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
    return token === "cookie-mem-owner" ? user() : null;
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
  return { users: new MemoryUsers(), devices: new MemoryDevices(), settings: runtimeSettings, now: () => now };
}

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-mem-owner", runtimeSettings.auth.cookieSecret);
}

function itemVm() {
  return {
    id: memoryId,
    category: "preference" as const,
    key: "style",
    value_md: "回复要简洁。",
    confidence: 0.8,
    workspace_scoped: true,
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };
}

function service(overrides: Partial<UserMemoryGovernanceService> = {}): UserMemoryGovernanceService {
  return {
    async listMemories() {
      return { generated_at: now.toISOString(), memories: [itemVm()], totals: { active: 1 } };
    },
    async getMemory() {
      return itemVm();
    },
    async patchMemory() {
      return itemVm();
    },
    async deleteMemory() {
      return { deleted: true };
    },
    ...overrides
  };
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof UserMemoryGovernanceServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    return c.json({ ok: false, error: { code: "internal_error", message: "internal" } }, 500);
  });
  return app;
}

async function routeApp(runtimeSettings: Settings, svc: UserMemoryGovernanceService) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createUserMemoryGovernanceRoutes({ auth: authDeps(runtimeSettings), service: svc }));
  return app;
}

test("all four endpoints require authentication before reaching the service", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(runtimeSettings, service({
    async listMemories() {
      throw new Error("anonymous must not reach the service");
    },
    async patchMemory() {
      throw new Error("anonymous must not reach the service");
    }
  }));

  assert.equal((await app.request("/api/me/memories")).status, 401);
  assert.equal((await app.request(`/api/me/memories/${memoryId}`)).status, 401);
  assert.equal((await app.request(`/api/me/memories/${memoryId}`, { method: "PATCH", body: "{}" })).status, 401);
  assert.equal((await app.request(`/api/me/memories/${memoryId}`, { method: "DELETE" })).status, 401);
});

test("non-uuid :id resolves to 404 before touching the service", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(runtimeSettings, service({
    async getMemory() {
      throw new Error("must not reach service for a malformed id");
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings) };
  const res = await app.request("/api/me/memories/not-a-uuid", { headers });
  assert.equal(res.status, 404);
});

test("GET list returns the page and forwards the category filter", async () => {
  const runtimeSettings = settings();
  const seen: unknown[] = [];
  const app = await routeApp(runtimeSettings, service({
    async listMemories(input) {
      seen.push(input.category);
      return { generated_at: now.toISOString(), memories: [itemVm()], totals: { active: 1 } };
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const res = await app.request("/api/me/memories?category=correction", { headers });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, data: { generated_at: now.toISOString(), memories: [itemVm()], totals: { active: 1 } } });
  assert.deepEqual(seen, ["correction"]);
});

test("an unknown category value is a 422 contract violation", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(runtimeSettings, service());
  const headers = { Cookie: await cookie(runtimeSettings) };
  const res = await app.request("/api/me/memories?category=nonsense", { headers });
  assert.equal(res.status, 422);
});

test("PATCH forwards value_md and a parsed expected_updated_at Date to the service", async () => {
  const runtimeSettings = settings();
  const calls: Array<{ valueMd: string; expected: Date }> = [];
  const app = await routeApp(runtimeSettings, service({
    async patchMemory(input) {
      calls.push({ valueMd: input.valueMd, expected: input.expectedUpdatedAt });
      return itemVm();
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const res = await app.request(`/api/me/memories/${memoryId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ value_md: "改一下", expected_updated_at: "2026-07-03T00:00:00.000Z" })
  });

  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.valueMd, "改一下");
  assert.ok(calls[0]?.expected instanceof Date);
  assert.equal(calls[0]?.expected.toISOString(), "2026-07-03T00:00:00.000Z");
});

test("PATCH structural violations (non-string value, missing timestamp, malformed json) stay distinct from service 400s", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(runtimeSettings, service());
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const nonString = await app.request(`/api/me/memories/${memoryId}`, { method: "PATCH", headers, body: JSON.stringify({ value_md: 42, expected_updated_at: "2026-07-03T00:00:00.000Z" }) });
  const missingTs = await app.request(`/api/me/memories/${memoryId}`, { method: "PATCH", headers, body: JSON.stringify({ value_md: "x" }) });
  const malformed = await app.request(`/api/me/memories/${memoryId}`, { method: "PATCH", headers, body: "{" });

  assert.equal(nonString.status, 422);
  assert.equal(missingTs.status, 422);
  assert.equal(malformed.status, 400);
});

test("typed service errors (400 injection, 404, 409 conflict) propagate their status and code", async () => {
  const runtimeSettings = settings();
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const injection = await routeApp(runtimeSettings, service({
    async patchMemory() {
      throw new UserMemoryGovernanceServiceError(400, "user_memory_value_injection", "含注入短语");
    }
  }));
  const injRes = await injection.request(`/api/me/memories/${memoryId}`, { method: "PATCH", headers, body: JSON.stringify({ value_md: "x", expected_updated_at: "2026-07-03T00:00:00.000Z" }) });
  assert.equal(injRes.status, 400);
  assert.deepEqual(await injRes.json(), { ok: false, error: { code: "user_memory_value_injection", message: "含注入短语" } });

  const conflict = await routeApp(runtimeSettings, service({
    async patchMemory() {
      throw new UserMemoryGovernanceServiceError(409, "user_memory_version_conflict", "已更新");
    }
  }));
  const confRes = await conflict.request(`/api/me/memories/${memoryId}`, { method: "PATCH", headers, body: JSON.stringify({ value_md: "x", expected_updated_at: "2026-07-03T00:00:00.000Z" }) });
  assert.equal(confRes.status, 409);

  const notFound = await routeApp(runtimeSettings, service({
    async getMemory() {
      throw new UserMemoryGovernanceServiceError(404, "user_memory_not_found", "没有找到");
    }
  }));
  assert.equal((await notFound.request(`/api/me/memories/${memoryId}`, { headers: { Cookie: await cookie(runtimeSettings) } })).status, 404);
});

test("DELETE returns the idempotent deletion receipt", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(runtimeSettings, service());
  const headers = { Cookie: await cookie(runtimeSettings) };
  const res = await app.request(`/api/me/memories/${memoryId}`, { method: "DELETE", headers });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, data: { deleted: true } });
});
