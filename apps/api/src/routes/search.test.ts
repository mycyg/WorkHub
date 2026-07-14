import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type { ClientDeviceAuthRow, ClientDeviceRepository, UserAuthRow, UserRepository } from "@workhub/db";

import { httpErrorCodeFor } from "../http-error-codes.js";
import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import { createSearchRoutes, type SearchRoutesDependencies } from "./search.js";
import type { SearchInput, SearchService } from "../services/search.js";
import type { SearchResultsVm } from "@workhub/contracts";

// R14 批 SEARCH 路由层测试（无 DB）：鉴权先于服务调用（未登录 401）、非法 q/scopes 由服务层抛的
// HTTPException(400) 经 app.onError 映射、成功走 { ok:true, data } 信封、actor/query 原样透传给服务层。

const now = new Date("2026-07-14T09:00:00.000Z");
const workspaceId = "00000000-0000-4000-8000-000000000002"; // authDefaults.defaultWorkspaceId (no memberships repo injected)
const userId = "33000000-0000-4000-8000-000000000001";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r14-search-route-secret" });
}

function userRow(id: string, cookieToken: string): UserAuthRow {
  return {
    id,
    nickname: `r14-search-${id.slice(-1)}`,
    cookieToken,
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
    if (id === userId) return userRow(userId, "cookie-r14-search-owner");
    return null;
  }
  async findActiveByCookieToken(token: string) {
    if (token === "cookie-r14-search-owner") return userRow(userId, token);
    return null;
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

async function cookieFor(runtimeSettings: Settings, token: string) {
  return generateSignedCookie(COOKIE_NAME, token, runtimeSettings.auth.cookieSecret);
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    return c.json({ ok: false, error: { code: "internal_error", message: "internal" } }, 500);
  });
  return app;
}

const emptyVm: SearchResultsVm = { query: "预算", groups: [] };

function fakeSearch(impl?: (input: SearchInput) => Promise<SearchResultsVm> | SearchResultsVm): {
  service: SearchService;
  calls: SearchInput[];
} {
  const calls: SearchInput[] = [];
  const service: SearchService = {
    async search(input) {
      calls.push(input);
      return impl ? impl(input) : emptyVm;
    }
  };
  return { service, calls };
}

function routeApp(input: { runtimeSettings: Settings; search?: SearchRoutesDependencies["search"] }) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api",
    createSearchRoutes({
      auth: authDeps(input.runtimeSettings),
      ...(input.search ? { search: input.search } : {})
    })
  );
  return app;
}

test("search route requires authentication before reaching the search service", async () => {
  const runtimeSettings = settings();
  const { service, calls } = fakeSearch();
  const app = routeApp({ runtimeSettings, search: service });

  const response = await app.request("/api/search?q=预算");

  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("a valid search returns the { ok:true, data } envelope and forwards actor + raw query params", async () => {
  const runtimeSettings = settings();
  const { service, calls } = fakeSearch();
  const app = routeApp({ runtimeSettings, search: service });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r14-search-owner") };

  const response = await app.request("/api/search?q=预算&scopes=drive,meetings&limit=5", { headers });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: emptyVm });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.actor.id, userId);
  assert.equal(calls[0]!.q, "预算");
  assert.equal(calls[0]!.scopes, "drive,meetings");
  assert.equal(calls[0]!.limit, "5");
});

test("an invalid query surfaces the service's HTTPException(400) through app.onError", async () => {
  const runtimeSettings = settings();
  const { service } = fakeSearch(() => {
    throw new HTTPException(400, { message: "搜索词至少需要 2 个字符。" });
  });
  const app = routeApp({ runtimeSettings, search: service });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r14-search-owner") };

  const response = await app.request("/api/search?q=预", { headers });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "bad_request", message: "搜索词至少需要 2 个字符。" }
  });
});

test("an all-invalid scopes parameter 400s through the service", async () => {
  const runtimeSettings = settings();
  const { service } = fakeSearch(() => {
    throw new HTTPException(400, { message: "scopes 必须是 conversations,drive,work_items,meetings 的非空子集。" });
  });
  const app = routeApp({ runtimeSettings, search: service });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r14-search-owner") };

  const response = await app.request("/api/search?q=预算&scopes=bogus", { headers });

  assert.equal(response.status, 400);
});
