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
import type { ConversationTurnResultVM } from "../services/conversation-turns.js";

import { httpErrorCodeFor } from "../http-error-codes.js";
import {
  COOKIE_NAME,
  type AuthDependencies,
  type AuthEnv
} from "../middleware/auth.js";
import { InternalContractError } from "../pages/output-contract.js";
import { createConversationTurnRoutes } from "./conversation-turns.js";
import {
  ConversationTurnServiceError,
  type ConversationTurnService
} from "../services/conversation-turns.js";

const now = new Date("2026-07-12T09:00:00.000Z");
const conversationId = "32000000-0000-4000-8000-000000000001";
const userMessageId = "32000000-0000-4000-8000-000000000002";
const cuuMessageId = "32000000-0000-4000-8000-000000000003";
const turnId = "32000000-0000-4000-8000-000000000004";
const userId = "32000000-0000-4000-8000-000000000005";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r12-batch4a-turns-route-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "r12-turns-owner",
    cookieToken: "cookie-r12-turns-owner",
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
    return token === "cookie-r12-turns-owner" ? user() : null;
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
  return generateSignedCookie(COOKIE_NAME, "cookie-r12-turns-owner", runtimeSettings.auth.cookieSecret);
}

function turnResultVm(): ConversationTurnResultVM {
  return {
    turn_id: turnId,
    message: {
      id: cuuMessageId,
      conversation_id: conversationId,
      seq: 2,
      sender_type: "cuu",
      sender_user_id: null,
      kind: "text",
      content: { text: "看过了，整体不错" },
      thread_root_id: null,
      created_at: now.toISOString()
    }
  };
}

function service(overrides: Partial<ConversationTurnService> = {}): ConversationTurnService {
  return {
    async createTurn() {
      return turnResultVm();
    },
    ...overrides
  };
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof ConversationTurnServiceError) {
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

function routeApp(runtimeSettings: Settings, turns: ConversationTurnService) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createConversationTurnRoutes({ auth: authDeps(runtimeSettings), turns }));
  return app;
}

test("conversation turn route requires authentication before reaching the service", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async createTurn() {
        throw new Error("anonymous request must not reach the service");
      }
    })
  );

  const response = await app.request(`/api/conversations/${conversationId}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_message_id: userMessageId })
  });

  assert.equal(response.status, 401);
});

test("an invalid conversation id 404s in the same uniform shape without entering the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(
    runtimeSettings,
    service({
      async createTurn() {
        calls += 1;
        throw new Error("invalid UUID must not reach the service");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request("/api/conversations/not-a-uuid/turns", {
    method: "POST",
    headers,
    body: JSON.stringify({ user_message_id: userMessageId })
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "conversation_not_found", message: "没有找到这个会话。" }
  });
  assert.equal(calls, 0);
});

test("a malformed body (missing or non-uuid user_message_id) 422s before the service runs", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(
    runtimeSettings,
    service({
      async createTurn() {
        calls += 1;
        throw new Error("malformed body must not reach the service");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  for (const body of [{}, { user_message_id: "not-a-uuid" }, { user_message_id: userMessageId, extra: true }]) {
    const response = await app.request(`/api/conversations/${conversationId}/turns`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 422);
  }
  assert.equal(calls, 0);
});

test("a well-formed turn request forwards the actor/conversationId/payload and returns the service VM verbatim", async () => {
  const runtimeSettings = settings();
  const seen: unknown[] = [];
  const app = routeApp(
    runtimeSettings,
    service({
      async createTurn(input) {
        seen.push(input);
        return turnResultVm();
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request(`/api/conversations/${conversationId}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify({ user_message_id: userMessageId })
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, data: turnResultVm() });
  assert.equal(seen.length, 1);
  const call = seen[0] as { conversationId: string; payload: { user_message_id: string } };
  assert.equal(call.conversationId, conversationId);
  assert.deepEqual(call.payload, { user_message_id: userMessageId });
});

test("conversation turn route preserves the service's typed 409 for a busy conversation", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async createTurn() {
        throw new ConversationTurnServiceError(409, "conversation_turn_busy", "这个会话已经有一轮 Cuu 回应正在进行，请稍候。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request(`/api/conversations/${conversationId}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify({ user_message_id: userMessageId })
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "conversation_turn_busy", message: "这个会话已经有一轮 Cuu 回应正在进行，请稍候。" }
  });
});

test("conversation turn route preserves the service's typed 409 for a main (non-collab) conversation", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async createTurn() {
        throw new ConversationTurnServiceError(409, "conversation_turn_not_collab", "主区群聊由静默观察者处理，不支持单独发起协同回应。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request(`/api/conversations/${conversationId}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify({ user_message_id: userMessageId })
  });

  assert.equal(response.status, 409);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "conversation_turn_not_collab");
});

test("conversation turn route returns an internal 500 envelope for output-contract drift", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async createTurn() {
        throw new InternalContractError("conversation-turns.result", new ZodError([]));
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request(`/api/conversations/${conversationId}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify({ user_message_id: userMessageId })
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "internal_contract_error", message: "internal" }
  });
});
