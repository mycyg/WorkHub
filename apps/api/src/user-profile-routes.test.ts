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

import { httpErrorCodeFor } from "./http-error-codes.js";
import {
  COOKIE_NAME,
  type AuthDependencies,
  type AuthEnv
} from "./middleware/auth.js";
import { InternalContractError } from "./pages/output-contract.js";
import {
  jsonObjectMessage,
  malformedJsonMessage
} from "./routes/json-body.js";
import { UserProfileServiceError, type UserProfileService } from "./services/user-profile.js";

const now = new Date("2026-07-13T10:00:00.000Z");
const userId = "16000000-0000-4000-8000-000000000001";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r13-a2-user-profile-route-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "张三",
    cookieToken: "cookie-user-profile-owner",
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
    return token === "cookie-user-profile-owner" ? user() : null;
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
  return generateSignedCookie(COOKIE_NAME, "cookie-user-profile-owner", runtimeSettings.auth.cookieSecret);
}

function profileVm() {
  return {
    user_id: userId,
    nickname: "张三",
    title: "前端负责人",
    bio_md: "做过三个交付项目",
    skill_tags: ["react", "typescript"],
    onboarded_at: null
  };
}

function service(overrides: Partial<UserProfileService> = {}): UserProfileService {
  return {
    async getMyProfile() {
      return profileVm();
    },
    async patchMyProfile() {
      return profileVm();
    },
    ...overrides
  };
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof UserProfileServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    if (error instanceof InternalContractError) {
      return c.json({ ok: false, error: { code: "internal_contract_error", message: "internal" } }, 500);
    }
    return c.json({ ok: false, error: { code: "internal_error", message: "internal" } }, 500);
  });
  return app;
}

async function routeModule() {
  const module = await import("./routes/user-profile.js").catch(() => null);
  assert.ok(module, "missing user-profile route module");
  assert.equal(typeof module.createUserProfileRoutes, "function", "missing createUserProfileRoutes export");
  return module;
}

async function routeApp(runtimeSettings: Settings, userProfile: UserProfileService) {
  const module = await routeModule();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", module.createUserProfileRoutes({ auth: authDeps(runtimeSettings), userProfile }));
  return app;
}

test("GET/PATCH /me/profile require authentication before touching the service", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(runtimeSettings, service({
    async getMyProfile() {
      throw new Error("anonymous GET must not reach the service");
    },
    async patchMyProfile() {
      throw new Error("anonymous PATCH must not reach the service");
    }
  }));

  const get = await app.request("/api/me/profile");
  const patch = await app.request("/api/me/profile", { method: "PATCH", body: "{" });

  assert.equal(get.status, 401);
  assert.equal(patch.status, 401);
});

test("GET /me/profile returns the service's profile view", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(runtimeSettings, service());
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request("/api/me/profile", { headers });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: profileVm() });
});

test("PATCH /me/profile keeps malformed, non-object, and semantic errors distinct", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(runtimeSettings, service());
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const malformed = await app.request("/api/me/profile", { method: "PATCH", headers, body: "{" });
  const nonObject = await app.request("/api/me/profile", { method: "PATCH", headers, body: "[]" });
  const emptyPatch = await app.request("/api/me/profile", { method: "PATCH", headers, body: "{}" });
  const unknownField = await app.request("/api/me/profile", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ arbitrary: true })
  });

  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    ok: false,
    error: { code: "malformed_json", message: malformedJsonMessage }
  });
  assert.equal(nonObject.status, 400);
  assert.deepEqual(await nonObject.json(), {
    ok: false,
    error: { code: "json_object_required", message: jsonObjectMessage }
  });
  assert.equal(emptyPatch.status, 422);
  assert.equal(unknownField.status, 422);
});

test("PATCH /me/profile forwards the parsed payload to the service and returns its view", async () => {
  const runtimeSettings = settings();
  const calls: unknown[] = [];
  const app = await routeApp(runtimeSettings, service({
    async patchMyProfile(input) {
      calls.push(input.payload);
      return profileVm();
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request("/api/me/profile", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ title: "后端负责人" })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: profileVm() });
  assert.deepEqual(calls, [{ title: "后端负责人" }]);
});

test("typed service errors and output-contract drift map to their own distinct HTTP statuses", async () => {
  const runtimeSettings = settings();
  const deniedApp = await routeApp(runtimeSettings, service({
    async getMyProfile() {
      throw new UserProfileServiceError(403, "user_profile_access_denied", "profile denied");
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const denied = await deniedApp.request("/api/me/profile", { headers });

  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), {
    ok: false,
    error: { code: "user_profile_access_denied", message: "profile denied" }
  });
});
