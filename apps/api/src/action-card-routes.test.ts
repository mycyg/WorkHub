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
import { createActionCardRoutes } from "./routes/action-cards.js";
import { jsonObjectMessage, malformedJsonMessage } from "./routes/json-body.js";
import {
  ActionCardServiceError,
  type ActionCardItemVM,
  type ActionCardService
} from "./services/action-cards.js";

const now = new Date("2026-07-12T08:30:00.123Z");
const itemId = "40000000-0000-4000-8000-000000000004";
const conversationId = "30000000-0000-4000-8000-000000000003";
const actionCardId = "70000000-0000-4000-8000-000000000007";
const userId = "60000000-0000-4000-8000-000000000006";
const otherUserId = "60000000-0000-4000-8000-000000000009";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r12-action-card-route-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "r12-owner",
    cookieToken: "cookie-r12-owner",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
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
    return token === "cookie-r12-owner" ? user() : null;
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
  return generateSignedCookie(COOKIE_NAME, "cookie-r12-owner", runtimeSettings.auth.cookieSecret);
}

function itemVm(overrides: Partial<ActionCardItemVM> = {}): ActionCardItemVM {
  return {
    id: itemId,
    conversation_id: conversationId,
    action_card_id: actionCardId,
    kind: "decide",
    title_md: "预算是否砍半",
    confidence: "low",
    status: "running",
    assignee_user_id: userId,
    work_item_id: "80000000-0000-4000-8000-000000000008",
    run_id: null,
    undo_deadline_at: null,
    ...overrides
  };
}

function service(overrides: Partial<ActionCardService> = {}): ActionCardService {
  return {
    async decide() {
      return itemVm();
    },
    async undo() {
      return itemVm({ status: "undone" });
    },
    ...overrides
  };
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof ActionCardServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    return c.json({ ok: false, error: { code: "internal_error", message: "internal" } }, 500);
  });
  return app;
}

function routeApp(runtimeSettings: Settings, actionCards: ActionCardService) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createActionCardRoutes({ auth: authDeps(runtimeSettings), actionCards }));
  return app;
}

test("action-card routes authenticate before reading a malformed decide body", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service({
    async decide() {
      throw new Error("anonymous request must not reach the service");
    }
  }));

  const response = await app.request(`/api/action-card-items/${itemId}/decide`, { method: "POST", body: "{" });
  assert.equal(response.status, 401);
});

test("action-card routes authenticate before undo, which needs no body", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service({
    async undo() {
      throw new Error("anonymous request must not reach the service");
    }
  }));

  const response = await app.request(`/api/action-card-items/${itemId}/undo`, { method: "POST" });
  assert.equal(response.status, 401);
});

test("an invalid item id uuid returns the domain 404 shape without entering the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(runtimeSettings, service({
    async decide() {
      calls += 1;
      throw new Error("invalid uuid must not reach service");
    },
    async undo() {
      calls += 1;
      throw new Error("invalid uuid must not reach service");
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const decide = await app.request("/api/action-card-items/not-a-uuid/decide", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "defer" })
  });
  const undo = await app.request("/api/action-card-items/not-a-uuid/undo", { method: "POST", headers });

  assert.equal(decide.status, 404);
  assert.deepEqual(await decide.json(), {
    ok: false,
    error: { code: "action_card_item_not_found", message: "没有找到这个行动卡条目。" }
  });
  assert.equal(undo.status, 404);
  assert.equal(calls, 0);
});

test("decide validates the request body: malformed json, non-object, and reassign without an assignee", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service());
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const malformed = await app.request(`/api/action-card-items/${itemId}/decide`, { method: "POST", headers, body: "{" });
  const nonObject = await app.request(`/api/action-card-items/${itemId}/decide`, { method: "POST", headers, body: "[]" });
  const missingAssignee = await app.request(`/api/action-card-items/${itemId}/decide`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "reassign" })
  });
  const strayAssignee = await app.request(`/api/action-card-items/${itemId}/decide`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "claim", assignee_user_id: otherUserId })
  });
  const unknownAction = await app.request(`/api/action-card-items/${itemId}/decide`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "delete_everything" })
  });

  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { ok: false, error: { code: "malformed_json", message: malformedJsonMessage } });
  assert.equal(nonObject.status, 400);
  assert.deepEqual(await nonObject.json(), { ok: false, error: { code: "json_object_required", message: jsonObjectMessage } });
  assert.equal(missingAssignee.status, 422);
  assert.equal(strayAssignee.status, 422);
  assert.equal(unknownAction.status, 422);
});

test("decide parses the payload, calls the service with the actor, and returns 200", async () => {
  const runtimeSettings = settings();
  const calls: unknown[] = [];
  const app = routeApp(runtimeSettings, service({
    async decide(input) {
      calls.push(input);
      return itemVm({ status: "waiting_decision", assignee_user_id: otherUserId });
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request(`/api/action-card-items/${itemId}/decide`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "reassign", assignee_user_id: otherUserId })
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; data: ActionCardItemVM };
  assert.equal(body.ok, true);
  assert.equal(body.data.assignee_user_id, otherUserId);
  assert.equal(calls.length, 1);
  const call = calls[0] as { itemId: string; action: string; assigneeUserId?: string; actor: { id: string } };
  assert.equal(call.itemId, itemId);
  assert.equal(call.action, "reassign");
  assert.equal(call.assigneeUserId, otherUserId);
  assert.equal(call.actor.id, userId);
});

test("undo needs no body, calls the service with the actor, and returns 200", async () => {
  const runtimeSettings = settings();
  const calls: unknown[] = [];
  const app = routeApp(runtimeSettings, service({
    async undo(input) {
      calls.push(input);
      return itemVm({ status: "undone" });
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request(`/api/action-card-items/${itemId}/undo`, { method: "POST", headers });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; data: ActionCardItemVM };
  assert.equal(body.data.status, "undone");
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { itemId: string }).itemId, itemId);
});

test("action-card routes preserve typed service errors (403/404/409/422)", async () => {
  const runtimeSettings = settings();
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };
  for (const [status, code] of [
    [403, "forbidden"],
    [404, "action_card_item_not_found"],
    [409, "action_card_item_already_decided"],
    [422, "action_card_item_not_decidable"]
  ] as const) {
    const app = routeApp(runtimeSettings, service({
      async decide() {
        throw new ActionCardServiceError(status, code, `typed ${status}`);
      }
    }));
    const response = await app.request(`/api/action-card-items/${itemId}/decide`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "defer" })
    });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { ok: false, error: { code, message: `typed ${status}` } });
  }
});

test("action-card route factory exposes exactly the decide and undo endpoints", () => {
  const routes = createActionCardRoutes({ auth: authDeps(settings()), actionCards: service() });
  const inventory = [...new Set(
    (routes as typeof routes & { routes: Array<{ method: string; path: string }> }).routes
      .filter((route) => route.method !== "ALL")
      .map((route) => `${route.method} ${route.path}`)
  )].sort();

  assert.deepEqual(inventory, [
    "POST /action-card-items/:id/decide",
    "POST /action-card-items/:id/undo"
  ]);
});
