import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import { createMemoryBudgetPolicyStore } from "@workhub/cost";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { createCostRoutes } from "./routes/cost.js";

const now = new Date("2026-06-05T00:00:00.000Z");
const adminId = "10000000-0000-4000-8000-0000000000a1";
const userId = "10000000-0000-4000-8000-0000000000b1";

function user(partial: Partial<UserAuthRow> = {}): UserAuthRow {
  return {
    id: userId,
    nickname: "cost-user",
    cookieToken: "cookie-cost-user",
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

class MemoryUsers implements UserRepository {
  constructor(private readonly rows: UserAuthRow[]) {}

  async findActiveById(id: string) {
    return this.rows.find((candidate) => candidate.id === id && candidate.deletedAt === null) ?? null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return this.rows.find((candidate) => candidate.cookieToken === cookieToken && candidate.deletedAt === null) ?? null;
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

function settings(): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret"
  });
}

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return {
    users: new MemoryUsers([
      user({
        id: adminId,
        nickname: "cost-admin",
        cookieToken: "cookie-cost-admin",
        isAdmin: true
      }),
      user()
    ]),
    devices: new MemoryDevices(),
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
      return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

async function cookie(runtimeSettings: Settings, cookieToken: string) {
  return generateSignedCookie(COOKIE_NAME, cookieToken, runtimeSettings.auth.cookieSecret);
}

test("cost policy routes expose configurable P-COST defaults to admins", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const policyStore = createMemoryBudgetPolicyStore();
  app.route("/api/cost", createCostRoutes({ auth: authDeps(runtimeSettings), policyStore }));
  const headers = { Cookie: await cookie(runtimeSettings, "cookie-cost-admin") };

  const list = await app.request("/api/cost/policies", { headers });
  assert.equal(list.status, 200);
  const listBody = await list.json() as {
    ok: true;
    data: { id: string; scope_kind: string; max_tokens: number; max_cost_cny: string; version: number }[];
  };
  assert.equal(listBody.data.length, 4);
  assert.equal(listBody.data.find((policy) => policy.id === "pcost-workitem-run-v0")?.max_tokens, 120000);

  const update = await app.request("/api/cost/policies/user/pcost-user-day-v0", {
    method: "PUT",
    headers,
    body: JSON.stringify({ max_tokens: 250000, max_cost_cny: "12.5", on_warning: "notify" })
  });
  assert.equal(update.status, 200);
  const updateBody = await update.json() as { ok: true; data: { max_tokens: number; max_cost_cny: string; version: number } };
  assert.equal(updateBody.data.max_tokens, 250000);
  assert.equal(updateBody.data.max_cost_cny, "12.5");
  assert.equal(updateBody.data.version, 2);

  const readBack = await app.request("/api/cost/policies", { headers });
  const readBackBody = await readBack.json() as { ok: true; data: { id: string; max_cost_cny: string }[] };
  assert.equal(readBackBody.data.find((policy) => policy.id === "pcost-user-day-v0")?.max_cost_cny, "12.5");
});

test("cost policy routes fail closed for non-admins and invalid policy updates", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/cost", createCostRoutes({ auth: authDeps(runtimeSettings), policyStore: createMemoryBudgetPolicyStore() }));

  const userHeaders = { Cookie: await cookie(runtimeSettings, "cookie-cost-user") };
  const adminHeaders = { Cookie: await cookie(runtimeSettings, "cookie-cost-admin") };

  const blocked = await app.request("/api/cost/policies", { headers: userHeaders });
  assert.equal(blocked.status, 403);

  const usage = await app.request("/api/cost/usage", { headers: userHeaders });
  assert.equal(usage.status, 200);

  const invalid = await app.request("/api/cost/policies/user/pcost-user-day-v0", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ warning_ratio: 0.98 })
  });
  assert.equal(invalid.status, 422);

  const empty = await app.request("/api/cost/policies/user/pcost-user-day-v0", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({})
  });
  assert.equal(empty.status, 422);

  const missing = await app.request("/api/cost/policies/user/missing", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ enabled: false })
  });
  assert.equal(missing.status, 404);
});
