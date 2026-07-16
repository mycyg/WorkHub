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

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import {
  WorkspaceMemberServiceError,
  type WorkspaceMemberService
} from "../services/workspace-members.js";
import { createWorkspaceMemberRoutes } from "./workspace-members.js";

const now = new Date("2026-07-16T09:00:00.000Z");
const adminUserId = "70000000-0000-4000-8000-0000000000a1";
const targetUserId = "70000000-0000-4000-8000-0000000000b1";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r17-workspace-members-secret" });
}

function user(): UserAuthRow {
  return {
    id: adminUserId,
    nickname: "r17-admin",
    cookieToken: "cookie-r17-admin",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    avatarWebp: null,
    avatarUpdatedAt: null,
    isAdmin: true,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemoryUsers implements UserRepository {
  async findActiveById(id: string) {
    return id === adminUserId ? user() : null;
  }
  async findActiveByCookieToken(token: string) {
    return token === "cookie-r17-admin" ? user() : null;
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
  return generateSignedCookie(COOKIE_NAME, "cookie-r17-admin", runtimeSettings.auth.cookieSecret);
}

function memberService(overrides: Partial<WorkspaceMemberService> = {}): WorkspaceMemberService {
  const reject = (name: string) => async () => {
    throw new Error(`${name} not expected`);
  };
  return {
    removeMember: reject("removeMember"),
    updateMemberRole: reject("updateMemberRole"),
    ...overrides
  } as WorkspaceMemberService;
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof WorkspaceMemberServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "unauthorized", message: error.message } }, error.status);
    }
    return c.json({ ok: false, error: { code: "internal_error", message: "internal" } }, 500);
  });
  return app;
}

function routeApp(runtimeSettings: Settings, members: WorkspaceMemberService) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkspaceMemberRoutes({ auth: authDeps(runtimeSettings), members }));
  return app;
}

test("DELETE member requires authentication before reaching the service", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    memberService({
      async removeMember() {
        throw new Error("anonymous request must not reach the service");
      }
    })
  );

  const response = await app.request(`/api/workspace/members/${targetUserId}`, { method: "DELETE" });

  assert.equal(response.status, 401);
});

test("DELETE member 404s a malformed user id without entering the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(
    runtimeSettings,
    memberService({
      async removeMember() {
        calls += 1;
        throw new Error("invalid id must not reach the service");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request("/api/workspace/members/not-a-uuid", { method: "DELETE", headers });

  assert.equal(response.status, 404);
  assert.equal(calls, 0);
});

test("DELETE member forwards the target and returns the removed id", async () => {
  const runtimeSettings = settings();
  let seen: unknown;
  const app = routeApp(
    runtimeSettings,
    memberService({
      async removeMember(input) {
        seen = input;
        return { removed_user_id: targetUserId };
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request(`/api/workspace/members/${targetUserId}`, { method: "DELETE", headers });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: { removed_user_id: targetUserId } });
  assert.equal((seen as { targetUserId: string }).targetUserId, targetUserId);
});

test("DELETE member preserves the service's typed 409 for the last admin", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    memberService({
      async removeMember() {
        throw new WorkspaceMemberServiceError(409, "member_last_admin", "不能移出最后一名管理员。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request(`/api/workspace/members/${targetUserId}`, { method: "DELETE", headers });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "member_last_admin", message: "不能移出最后一名管理员。" }
  });
});

test("PATCH member role forwards the role and returns the updated pair", async () => {
  const runtimeSettings = settings();
  let seen: unknown;
  const app = routeApp(
    runtimeSettings,
    memberService({
      async updateMemberRole(input) {
        seen = input;
        return { user_id: targetUserId, role: "admin" };
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "content-type": "application/json" };

  const response = await app.request(`/api/workspace/members/${targetUserId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ role: "admin" })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: { user_id: targetUserId, role: "admin" } });
  assert.equal((seen as { role: string }).role, "admin");
});

test("PATCH member role rejects an unknown role with 422 before the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(
    runtimeSettings,
    memberService({
      async updateMemberRole() {
        calls += 1;
        throw new Error("invalid role must not reach the service");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "content-type": "application/json" };

  const response = await app.request(`/api/workspace/members/${targetUserId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ role: "superuser" })
  });

  assert.equal(response.status, 422);
  assert.equal(calls, 0);
});
