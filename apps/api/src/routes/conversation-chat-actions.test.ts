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
import { ConversationServiceError, type ConversationService } from "../services/conversations.js";
import { createConversationMessageActionRoutes } from "./conversation-message-actions.js";
import { createConversationReadRoutes } from "./conversation-read.js";

const now = new Date("2026-07-14T08:30:00.123Z");
const projectId = "20000000-0000-4000-8000-000000000002";
const conversationId = "30000000-0000-4000-8000-000000000003";
const messageId = "40000000-0000-4000-8000-000000000004";
const userId = "60000000-0000-4000-8000-000000000006";
const workspaceId = "00000000-0000-4000-8000-000000000002";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r14-chat-actions-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "r14-owner",
    cookieToken: "cookie-r14-owner",
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
    return token === "cookie-r14-owner" ? user() : null;
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
  return generateSignedCookie(COOKIE_NAME, "cookie-r14-owner", runtimeSettings.auth.cookieSecret);
}

function textVm(overrides: Record<string, unknown> = {}) {
  return {
    id: messageId,
    conversation_id: conversationId,
    seq: 1,
    sender_type: "user" as const,
    sender_user_id: userId,
    kind: "text" as const,
    content: { text: "hi" },
    thread_root_id: null,
    created_at: now.toISOString(),
    ...overrides
  };
}

function service(overrides: Partial<ConversationService> = {}): ConversationService {
  const reject = (name: string) => async () => {
    throw new Error(`${name} not expected`);
  };
  return {
    assertProjectAccess: reject("assertProjectAccess"),
    async assertConversationAccess() {
      return { projectId };
    },
    listConversations: reject("listConversations"),
    createConversation: reject("createConversation"),
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

function actionsApp(runtimeSettings: Settings, conversations: ConversationService) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createConversationMessageActionRoutes({ auth: authDeps(runtimeSettings), conversations }));
  return app;
}

function readApp(runtimeSettings: Settings, conversations: ConversationService) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createConversationReadRoutes({ auth: authDeps(runtimeSettings), conversations }));
  return app;
}

test("PATCH edit returns the edited message VM and forwards the parsed text payload", async () => {
  const runtimeSettings = settings();
  const calls: unknown[] = [];
  const app = actionsApp(
    runtimeSettings,
    service({
      async editMessage(input) {
        calls.push(input);
        return textVm({ content: { text: "改好了" }, edited_at: now.toISOString() }) as never;
      }
    })
  );
  const response = await app.request(`/api/conversations/${conversationId}/messages/${messageId}`, {
    method: "PATCH",
    headers: { Cookie: await cookie(runtimeSettings), "content-type": "application/json" },
    body: JSON.stringify({ text: "改好了" })
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; data: { edited_at: string } };
  assert.equal(body.ok, true);
  assert.equal(body.data.edited_at, now.toISOString());
  const call = calls[0] as { conversationId: string; messageId: string; payload: unknown; actor: { userId: string } };
  assert.equal(call.conversationId, conversationId);
  assert.equal(call.messageId, messageId);
  assert.deepEqual(call.payload, { text: "改好了" });
  // actor 由认证中间件注入，路由只是原样透传。
  assert.equal(call.actor.userId, userId);
});

test("PATCH edit rejects an empty text body with a 422 before the service", async () => {
  const runtimeSettings = settings();
  const app = actionsApp(
    runtimeSettings,
    service({
      async editMessage() {
        throw new Error("empty text must not reach the service");
      }
    })
  );
  const response = await app.request(`/api/conversations/${conversationId}/messages/${messageId}`, {
    method: "PATCH",
    headers: { Cookie: await cookie(runtimeSettings), "content-type": "application/json" },
    body: JSON.stringify({ text: "" })
  });
  assert.equal(response.status, 422);
});

test("DELETE message returns the tombstone VM", async () => {
  const runtimeSettings = settings();
  const app = actionsApp(
    runtimeSettings,
    service({
      async deleteMessage() {
        return textVm({ content: { text: "" }, deleted_at: now.toISOString() }) as never;
      }
    })
  );
  const response = await app.request(`/api/conversations/${conversationId}/messages/${messageId}`, {
    method: "DELETE",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: { deleted_at: string; content: { text: string } } };
  assert.equal(body.data.deleted_at, now.toISOString());
  assert.deepEqual(body.data.content, { text: "" });
});

test("reaction and pin routes return 204 and forward the reaction key", async () => {
  const runtimeSettings = settings();
  const reactionCalls: unknown[] = [];
  const app = actionsApp(
    runtimeSettings,
    service({
      async addReaction(input) {
        reactionCalls.push(input.reactionKey);
      },
      async removeReaction(input) {
        reactionCalls.push(`-${input.reactionKey}`);
      },
      async pinMessage() {},
      async unpinMessage() {}
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const put = await app.request(`/api/conversations/${conversationId}/messages/${messageId}/reactions/approve`, {
    method: "PUT",
    headers
  });
  const del = await app.request(`/api/conversations/${conversationId}/messages/${messageId}/reactions/approve`, {
    method: "DELETE",
    headers
  });
  const pin = await app.request(`/api/conversations/${conversationId}/messages/${messageId}/pin`, {
    method: "PUT",
    headers
  });
  const unpin = await app.request(`/api/conversations/${conversationId}/messages/${messageId}/pin`, {
    method: "DELETE",
    headers
  });

  assert.equal(put.status, 204);
  assert.equal(del.status, 204);
  assert.equal(pin.status, 204);
  assert.equal(unpin.status, 204);
  assert.deepEqual(reactionCalls, ["approve", "-approve"]);
});

test("GET pins returns the pins VM", async () => {
  const runtimeSettings = settings();
  const app = actionsApp(
    runtimeSettings,
    service({
      async listPins() {
        return { messages: [textVm({ pinned: { at: now.toISOString(), by_user_id: userId } })] } as never;
      }
    })
  );
  const response = await app.request(`/api/conversations/${conversationId}/pins`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: { messages: unknown[] } };
  assert.equal(body.data.messages.length, 1);
});

test("action routes reject invalid message UUIDs with a 404 before the service", async () => {
  const runtimeSettings = settings();
  const app = actionsApp(runtimeSettings, service());
  const response = await app.request(`/api/conversations/${conversationId}/messages/not-a-uuid`, {
    method: "DELETE",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 404);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, "conversation_message_not_found");
});

test("action routes authenticate before touching the service", async () => {
  const runtimeSettings = settings();
  const app = actionsApp(runtimeSettings, service());
  const response = await app.request(`/api/conversations/${conversationId}/messages/${messageId}`, {
    method: "DELETE"
  });
  assert.equal(response.status, 401);
});

test("PUT read forwards the last_read_seq and returns the clamped cursor", async () => {
  const runtimeSettings = settings();
  const calls: unknown[] = [];
  const app = readApp(
    runtimeSettings,
    service({
      async advanceReadCursor(input) {
        calls.push(input.payload);
        return { last_read_seq: 3 };
      }
    })
  );
  const response = await app.request(`/api/conversations/${conversationId}/read`, {
    method: "PUT",
    headers: { Cookie: await cookie(runtimeSettings), "content-type": "application/json" },
    body: JSON.stringify({ last_read_seq: 999 })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: { last_read_seq: 3 } });
  assert.deepEqual(calls, [{ last_read_seq: 999 }]);
});

test("PUT read rejects a negative last_read_seq with a 422", async () => {
  const runtimeSettings = settings();
  const app = readApp(
    runtimeSettings,
    service({
      async advanceReadCursor() {
        throw new Error("negative seq must not reach the service");
      }
    })
  );
  const response = await app.request(`/api/conversations/${conversationId}/read`, {
    method: "PUT",
    headers: { Cookie: await cookie(runtimeSettings), "content-type": "application/json" },
    body: JSON.stringify({ last_read_seq: -1 })
  });
  assert.equal(response.status, 422);
});

test("GET receipts returns the receipts VM", async () => {
  const runtimeSettings = settings();
  const app = readApp(
    runtimeSettings,
    service({
      async listReceipts() {
        return { receipts: [{ user_id: userId, last_read_seq: 5 }] };
      }
    })
  );
  const response = await app.request(`/api/conversations/${conversationId}/receipts`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: { receipts: [{ user_id: userId, last_read_seq: 5 }] } });
});
