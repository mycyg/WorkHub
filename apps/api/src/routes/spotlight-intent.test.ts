import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type { ClientDeviceAuthRow, ClientDeviceRepository, UserAuthRow, UserRepository } from "@workhub/db";
import type { SpotlightIntentResult } from "@workhub/agent/spotlight-intent";

import { httpErrorCodeFor } from "../http-error-codes.js";
import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import { createSpotlightIntentRoutes } from "./spotlight-intent.js";
import { SpotlightIntentServiceError, type SpotlightIntentService } from "../services/spotlight-intent.js";

const now = new Date("2026-07-13T09:00:00.000Z");
const userId = "17000000-0000-4000-8000-000000000001";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r13-s1-spotlight-intent-route-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "r13-spotlight-intent-owner",
    cookieToken: "cookie-r13-spotlight-intent-owner",
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
    return token === "cookie-r13-spotlight-intent-owner" ? user() : null;
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
  return generateSignedCookie(COOKIE_NAME, "cookie-r13-spotlight-intent-owner", runtimeSettings.auth.cookieSecret);
}

function intentResult(): SpotlightIntentResult {
  return { intent: "open_page", confidence: "high", page: "cost" };
}

function requestBody() {
  return {
    query: "看看这个月花了多少钱",
    capabilities: [{ id: "cost", label: "成本" }]
  };
}

function service(overrides: Partial<SpotlightIntentService> = {}): SpotlightIntentService {
  return {
    async createIntent() {
      return intentResult();
    },
    ...overrides
  };
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof SpotlightIntentServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    return c.json({ ok: false, error: { code: "internal_error", message: "internal" } }, 500);
  });
  return app;
}

function routeApp(runtimeSettings: Settings, spotlightIntent: SpotlightIntentService) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createSpotlightIntentRoutes({ auth: authDeps(runtimeSettings), spotlightIntent }));
  return app;
}

test("spotlight intent route requires authentication before reaching the service", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async createIntent() {
        throw new Error("anonymous request must not reach the service");
      }
    })
  );

  const response = await app.request("/api/spotlight/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody())
  });

  assert.equal(response.status, 401);
});

test("a malformed body (empty query, empty capabilities, extra field) 422s before the service runs", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(
    runtimeSettings,
    service({
      async createIntent() {
        calls += 1;
        throw new Error("malformed body must not reach the service");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  for (const body of [
    {},
    { query: "", capabilities: [{ id: "cost", label: "成本" }] },
    { query: "hi", capabilities: [] },
    { query: "hi", capabilities: [{ id: "cost", label: "成本" }], extra: true }
  ]) {
    const response = await app.request("/api/spotlight/intent", {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 422);
  }
  assert.equal(calls, 0);
});

test("a well-formed request forwards the actor/payload and returns the service result verbatim", async () => {
  const runtimeSettings = settings();
  const seen: unknown[] = [];
  const app = routeApp(
    runtimeSettings,
    service({
      async createIntent(input) {
        seen.push(input);
        return intentResult();
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request("/api/spotlight/intent", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody())
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: intentResult() });
  assert.equal(seen.length, 1);
  const call = seen[0] as { payload: unknown };
  assert.deepEqual(call.payload, requestBody());
});

test("spotlight intent route preserves the service's typed 429 for an exhausted budget", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async createIntent() {
        throw new SpotlightIntentServiceError(429, "spotlight_intent_budget_exhausted", "这个工作区今天的 AI 预算已经用完了。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request("/api/spotlight/intent", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody())
  });

  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "spotlight_intent_budget_exhausted", message: "这个工作区今天的 AI 预算已经用完了。" }
  });
});

test("spotlight intent route preserves the service's typed 500 for a gentle LLM/parse failure", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async createIntent() {
        throw new SpotlightIntentServiceError(500, "spotlight_intent_failed", "Cuu 没能理解这句话，请再试一次或换个说法。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request("/api/spotlight/intent", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody())
  });

  assert.equal(response.status, 500);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "spotlight_intent_failed");
});
