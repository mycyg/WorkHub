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
import type { UpdateConversationCuuResultVM } from "@workhub/contracts";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import { ConversationServiceError, type ConversationService } from "../services/conversations.js";
import { createConversationCuuRoutes } from "./conversation-cuu.js";

const now = new Date("2026-07-15T08:30:00.123Z");
const projectId = "20000000-0000-4000-8000-000000000002";
const conversationId = "30000000-0000-4000-8000-000000000003";
const userId = "60000000-0000-4000-8000-000000000006";
const workspaceId = "00000000-0000-4000-8000-000000000002";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r15-cuu-toggle-route-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "r15-cuu-owner",
    cookieToken: "cookie-r15-cuu-owner",
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
    return token === "cookie-r15-cuu-owner" ? user() : null;
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
  return generateSignedCookie(COOKIE_NAME, "cookie-r15-cuu-owner", runtimeSettings.auth.cookieSecret);
}

function cuuResultVm(enabled: boolean): UpdateConversationCuuResultVM {
  return {
    conversation: {
      id: conversationId,
      workspace_id: workspaceId,
      project_id: projectId,
      kind: "collab",
      title: "协作区",
      parent_conversation_id: null,
      source_message_id: null,
      visibility: "private",
      next_seq: 3,
      created_by: userId,
      participant_role: "owner",
      cuu_enabled: enabled,
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    }
  };
}

function service(overrides: Partial<ConversationService> = {}): ConversationService {
  const reject = (name: string) => async () => {
    throw new Error(`${name} not expected`);
  };
  return {
    assertProjectAccess: reject("assertProjectAccess"),
    assertConversationAccess: reject("assertConversationAccess"),
    listConversations: reject("listConversations"),
    createConversation: reject("createConversation"),
    openDm: reject("openDm"),
    listDms: reject("listDms"),
    renameConversation: reject("renameConversation"),
    updateCuuEnabled: reject("updateCuuEnabled"),
    listParticipants: reject("listParticipants"),
    listMessages: reject("listMessages"),
    createMessage: reject("createMessage"),
    editMessage: reject("editMessage"),
    deleteMessage: reject("deleteMessage"),
    pinMessage: reject("pinMessage"),
    unpinMessage: reject("unpinMessage"),
    addReaction: reject("addReaction"),
    removeReaction: reject("removeReaction"),
    advanceReadCursor: reject("advanceReadCursor"),
    listReceipts: reject("listReceipts"),
    listPins: reject("listPins"),
    ...overrides
  } as ConversationService;
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof ConversationServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "unauthorized", message: error.message } }, error.status);
    }
    return c.json({ ok: false, error: { code: "internal_error", message: "internal" } }, 500);
  });
  return app;
}

function routeApp(runtimeSettings: Settings, conversations: ConversationService) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createConversationCuuRoutes({ auth: authDeps(runtimeSettings), conversations }));
  return app;
}

test("cuu toggle requires authentication before reaching the service", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async updateCuuEnabled() {
        throw new Error("anonymous request must not reach the service");
      }
    })
  );

  const response = await app.request(`/api/conversations/${conversationId}/cuu`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true })
  });

  assert.equal(response.status, 401);
});

test("an invalid conversation id 404s without entering the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(
    runtimeSettings,
    service({
      async updateCuuEnabled() {
        calls += 1;
        throw new Error("invalid UUID must not reach the service");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request("/api/conversations/not-a-uuid/cuu", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ enabled: true })
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "conversation_not_found", message: "没有找到这个会话。" }
  });
  assert.equal(calls, 0);
});

test("a malformed body (missing/non-boolean enabled or extra keys) 422s before the service runs", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(
    runtimeSettings,
    service({
      async updateCuuEnabled() {
        calls += 1;
        throw new Error("malformed body must not reach the service");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  for (const body of [{}, { enabled: "true" }, { enabled: true, extra: true }]) {
    const response = await app.request(`/api/conversations/${conversationId}/cuu`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 422);
  }
  assert.equal(calls, 0);
});

test("a well-formed toggle forwards actor/conversationId/payload and returns the service VM verbatim", async () => {
  const runtimeSettings = settings();
  const seen: unknown[] = [];
  const app = routeApp(
    runtimeSettings,
    service({
      async updateCuuEnabled(input) {
        seen.push(input);
        return cuuResultVm(input.payload.enabled);
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request(`/api/conversations/${conversationId}/cuu`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ enabled: false })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: cuuResultVm(false) });
  assert.equal(seen.length, 1);
  const call = seen[0] as { conversationId: string; payload: { enabled: boolean } };
  assert.equal(call.conversationId, conversationId);
  assert.deepEqual(call.payload, { enabled: false });
});

test("the route preserves the service's typed 409 for a non-collab (main) conversation", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async updateCuuEnabled() {
        throw new ConversationServiceError(
          409,
          "conversation_cuu_not_collab",
          "主区不支持切换 Cuu 是否参与，只有协同会话（含私聊）可以。"
        );
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request(`/api/conversations/${conversationId}/cuu`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ enabled: true })
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "conversation_cuu_not_collab", message: "主区不支持切换 Cuu 是否参与，只有协同会话（含私聊）可以。" }
  });
});

test("the route preserves the service's typed 403 for a non-participant viewer", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async updateCuuEnabled() {
        throw new ConversationServiceError(403, "conversation_cuu_forbidden", "只有会话的参与者才能切换 Cuu 是否参与。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request(`/api/conversations/${conversationId}/cuu`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ enabled: true })
  });

  assert.equal(response.status, 403);
});

test("the route preserves the service's typed 404 for an invisible conversation", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async updateCuuEnabled() {
        throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request(`/api/conversations/${conversationId}/cuu`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ enabled: true })
  });

  assert.equal(response.status, 404);
});
