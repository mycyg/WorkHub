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
import type { RenameConversationResultVM } from "@workhub/contracts";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import { ConversationServiceError, type ConversationService } from "../services/conversations.js";
import { createConversationRenameRoutes } from "./conversation-rename.js";

const now = new Date("2026-07-15T08:30:00.123Z");
const projectId = "20000000-0000-4000-8000-000000000002";
const conversationId = "30000000-0000-4000-8000-000000000003";
const userId = "60000000-0000-4000-8000-000000000006";
const workspaceId = "00000000-0000-4000-8000-000000000002";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r14fix-rename-route-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "r14fix-owner",
    cookieToken: "cookie-r14fix-owner",
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
    return token === "cookie-r14fix-owner" ? user() : null;
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
  return generateSignedCookie(COOKIE_NAME, "cookie-r14fix-owner", runtimeSettings.auth.cookieSecret);
}

function renameResultVm(title: string): RenameConversationResultVM {
  return {
    conversation: {
      id: conversationId,
      workspace_id: workspaceId,
      project_id: projectId,
      kind: "collab",
      title,
      parent_conversation_id: null,
      source_message_id: null,
      visibility: "private",
      next_seq: 3,
      created_by: userId,
      participant_role: "owner",
      cuu_enabled: true,
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
    renameConversation: reject("renameConversation"),
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
  app.route("/api", createConversationRenameRoutes({ auth: authDeps(runtimeSettings), conversations }));
  return app;
}

test("rename requires authentication before reaching the service", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async renameConversation() {
        throw new Error("anonymous request must not reach the service");
      }
    })
  );

  const response = await app.request(`/api/conversations/${conversationId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "改第三幕" })
  });

  assert.equal(response.status, 401);
});

test("an invalid conversation id 404s without entering the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(
    runtimeSettings,
    service({
      async renameConversation() {
        calls += 1;
        throw new Error("invalid UUID must not reach the service");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request("/api/conversations/not-a-uuid", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ title: "改名" })
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "conversation_not_found", message: "没有找到这个会话。" }
  });
  assert.equal(calls, 0);
});

test("a malformed body (missing/empty/too-long title or extra keys) 422s before the service runs", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(
    runtimeSettings,
    service({
      async renameConversation() {
        calls += 1;
        throw new Error("malformed body must not reach the service");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  for (const body of [
    {},
    { title: "" },
    { title: "x".repeat(257) },
    { title: "ok", extra: true }
  ]) {
    const response = await app.request(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 422);
  }
  assert.equal(calls, 0);
});

test("a well-formed rename forwards actor/conversationId/payload and returns the service VM verbatim", async () => {
  const runtimeSettings = settings();
  const seen: unknown[] = [];
  const app = routeApp(
    runtimeSettings,
    service({
      async renameConversation(input) {
        seen.push(input);
        return renameResultVm(input.payload.title);
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request(`/api/conversations/${conversationId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ title: "改第三幕" })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: renameResultVm("改第三幕") });
  assert.equal(seen.length, 1);
  const call = seen[0] as { conversationId: string; payload: { title: string } };
  assert.equal(call.conversationId, conversationId);
  assert.deepEqual(call.payload, { title: "改第三幕" });
});

test("the route preserves the service's typed 403 for a non-collab (main) conversation", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async renameConversation() {
        throw new ConversationServiceError(403, "conversation_rename_forbidden", "只有协同会话可以改名。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request(`/api/conversations/${conversationId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ title: "改名" })
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "conversation_rename_forbidden", message: "只有协同会话可以改名。" }
  });
});

test("the route preserves the service's typed 404 for an invisible conversation", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async renameConversation() {
        throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request(`/api/conversations/${conversationId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ title: "改名" })
  });

  assert.equal(response.status, 404);
});
