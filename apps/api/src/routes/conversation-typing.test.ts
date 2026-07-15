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
import type {
  ConversationListPageVM,
  ConversationMessagePageVM,
  ConversationMessageVM,
  CreateConversationResultVM
} from "@workhub/contracts";

import { httpErrorCodeFor } from "../http-error-codes.js";
import {
  COOKIE_NAME,
  type AuthDependencies,
  type AuthEnv
} from "../middleware/auth.js";
import { InternalContractError } from "../pages/output-contract.js";
import { createConversationTypingRoutes, TypingDedupeGate } from "./conversation-typing.js";
import {
  ConversationServiceError,
  type ConversationService
} from "../services/conversations.js";

const now = new Date("2026-07-12T09:00:00.000Z");
const conversationId = "32000000-0000-4000-8000-000000000001";
const projectId = "32000000-0000-4000-8000-000000000002";
const userId = "32000000-0000-4000-8000-000000000003";
const otherUserId = "32000000-0000-4000-8000-000000000004";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r12-batch2-typing-route-secret" });
}

function userRow(id: string, cookieToken: string): UserAuthRow {
  return {
    id,
    nickname: `r12-typing-${id.slice(-1)}`,
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
    if (id === userId) return userRow(userId, "cookie-r12-typing-owner");
    if (id === otherUserId) return userRow(otherUserId, "cookie-r12-typing-other");
    return null;
  }
  async findActiveByCookieToken(token: string) {
    if (token === "cookie-r12-typing-owner") return userRow(userId, token);
    if (token === "cookie-r12-typing-other") return userRow(otherUserId, token);
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

function conversationsService(overrides: Partial<ConversationService> = {}): ConversationService {
  return {
    async assertProjectAccess() {
      return undefined;
    },
    async assertConversationAccess() {
      return { projectId };
    },
    async listConversations(): Promise<ConversationListPageVM> {
      throw new Error("not needed");
    },
    async createConversation(): Promise<CreateConversationResultVM> {
      throw new Error("not needed");
    },
    // R15 批 B：新增 openDm 服务方法（人对人私聊）——本套件不测它，给拒绝桩即可。
    async openDm() {
      throw new Error("not needed");
    },
    // R14FIX 批 workbench：新增 renameConversation 服务方法——本套件不测它，给拒绝桩即可。
    async renameConversation() {
      throw new Error("not needed");
    },
    async listMessages(): Promise<ConversationMessagePageVM> {
      throw new Error("not needed");
    },
    async createMessage(): Promise<ConversationMessageVM> {
      throw new Error("not needed");
    },
    // R14 批 CHAT：typing 路由套件不触碰消息动作/已读/置顶端点，给拒绝桩满足 ConversationService 接口。
    async editMessage(): Promise<ConversationMessageVM> {
      throw new Error("not needed");
    },
    async deleteMessage(): Promise<ConversationMessageVM> {
      throw new Error("not needed");
    },
    async pinMessage(): Promise<void> {
      throw new Error("not needed");
    },
    async unpinMessage(): Promise<void> {
      throw new Error("not needed");
    },
    async addReaction(): Promise<void> {
      throw new Error("not needed");
    },
    async removeReaction(): Promise<void> {
      throw new Error("not needed");
    },
    async advanceReadCursor() {
      throw new Error("not needed");
    },
    async listReceipts() {
      throw new Error("not needed");
    },
    async listPins() {
      throw new Error("not needed");
    },
    ...overrides
  };
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
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    if (error instanceof InternalContractError) {
      return c.json({ ok: false, error: { code: "internal_contract_error", message: "internal" } }, 500);
    }
    return c.json({ ok: false, error: { code: "internal_error", message: "internal" } }, 500);
  });
  return app;
}

function fakeBus() {
  const published: Array<{ topic: string; type: string; data: unknown }> = [];
  return {
    published,
    backend: "memory" as const,
    async publish<T>(topic: string, type: string, data: T) {
      published.push({ topic, type, data });
    }
  };
}

function routeApp(input: {
  runtimeSettings: Settings;
  conversations?: ConversationService;
  bus?: ReturnType<typeof fakeBus>;
  now?: () => Date;
}) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api",
    createConversationTypingRoutes({
      auth: authDeps(input.runtimeSettings),
      conversations: input.conversations ?? conversationsService(),
      bus: input.bus ?? fakeBus(),
      now: input.now ?? (() => now)
    })
  );
  return app;
}

test("typing route requires authentication before reaching the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp({
    runtimeSettings,
    conversations: conversationsService({
      async assertConversationAccess() {
        calls += 1;
        throw new Error("anonymous request must not reach the service");
      }
    })
  });

  const response = await app.request(`/api/conversations/${conversationId}/typing`, { method: "POST" });

  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("an invalid conversation id 404s in the same uniform shape without entering the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp({
    runtimeSettings,
    conversations: conversationsService({
      async assertConversationAccess() {
        calls += 1;
        throw new Error("invalid UUID must not reach the service");
      }
    })
  });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r12-typing-owner") };

  const response = await app.request("/api/conversations/not-a-uuid/typing", { method: "POST", headers });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "conversation_not_found", message: "没有找到这个会话。" }
  });
  assert.equal(calls, 0);
});

test("a non-participant is rejected by the same access check conversations.ts uses (404, no leak)", async () => {
  const runtimeSettings = settings();
  const app = routeApp({
    runtimeSettings,
    conversations: conversationsService({
      async assertConversationAccess() {
        throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
      }
    })
  });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r12-typing-owner") };

  const response = await app.request(`/api/conversations/${conversationId}/typing`, { method: "POST", headers });

  assert.equal(response.status, 404);
});

test("a valid ping publishes a conversation.presence.typing event shaped exactly per contract", async () => {
  const runtimeSettings = settings();
  const bus = fakeBus();
  const app = routeApp({ runtimeSettings, bus, now: () => now });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r12-typing-owner") };

  const response = await app.request(`/api/conversations/${conversationId}/typing`, { method: "POST", headers });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, data: { published: true } });
  assert.equal(bus.published.length, 1);
  const [published] = bus.published;
  assert.equal(published!.topic, `conversation:${conversationId}`);
  assert.equal(published!.type, "conversation.presence.typing");
  const data = published!.data as {
    type: string;
    topic: string;
    ts: string;
    actor: { actor_kind: string; actor_user_id: string };
    data: { conversation_id: string; user_id: string; ttl_ms: number; expires_at: string };
  };
  assert.equal(data.type, "conversation.presence.typing");
  assert.equal(data.topic, `conversation:${conversationId}`);
  assert.equal(data.actor.actor_kind, "human");
  assert.equal(data.actor.actor_user_id, userId);
  assert.equal(data.data.conversation_id, conversationId);
  assert.equal(data.data.user_id, userId);
  assert.equal(data.data.ttl_ms, 3000);
  assert.equal(data.ts, now.toISOString());
  assert.equal(Date.parse(data.data.expires_at) - Date.parse(data.ts), 3000);
});

test("typing never writes to the database — it is purely an SSE side effect", async () => {
  // 没有专门的"落库"依赖可注入去证明这一点——路由层面能证明的是：除了 bus.publish，
  // 没有调用任何持久化方法（conversationsService 里除了 assertConversationAccess 全部会抛错）。
  const runtimeSettings = settings();
  const bus = fakeBus();
  const app = routeApp({
    runtimeSettings,
    bus,
    conversations: conversationsService({
      async assertConversationAccess() {
        return { projectId };
      },
      async createMessage(): Promise<ConversationMessageVM> {
        throw new Error("typing must never write a conversation message");
      }
    })
  });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r12-typing-owner") };

  const response = await app.request(`/api/conversations/${conversationId}/typing`, { method: "POST", headers });

  assert.equal(response.status, 202);
  assert.equal(bus.published.length, 1);
});

test("a second ping from the same user within the 1s dedupe window is skipped (published:false), no second SSE event", async () => {
  const runtimeSettings = settings();
  const bus = fakeBus();
  let clock = now.getTime();
  const app = routeApp({ runtimeSettings, bus, now: () => new Date(clock) });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r12-typing-owner") };

  const first = await app.request(`/api/conversations/${conversationId}/typing`, { method: "POST", headers });
  clock += 500; // still inside the 1s window
  const second = await app.request(`/api/conversations/${conversationId}/typing`, { method: "POST", headers });

  assert.equal(first.status, 202);
  assert.deepEqual(await first.json(), { ok: true, data: { published: true } });
  assert.equal(second.status, 202);
  assert.deepEqual(await second.json(), { ok: true, data: { published: false } });
  assert.equal(bus.published.length, 1);
});

test("a ping after the dedupe window elapses publishes again", async () => {
  const runtimeSettings = settings();
  const bus = fakeBus();
  let clock = now.getTime();
  const app = routeApp({ runtimeSettings, bus, now: () => new Date(clock) });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r12-typing-owner") };

  await app.request(`/api/conversations/${conversationId}/typing`, { method: "POST", headers });
  clock += 1001; // just past the 1s window
  const second = await app.request(`/api/conversations/${conversationId}/typing`, { method: "POST", headers });

  assert.deepEqual(await second.json(), { ok: true, data: { published: true } });
  assert.equal(bus.published.length, 2);
});

test("the dedupe window is per (conversation, user) — a different user in the same conversation is never throttled by another user's ping", async () => {
  const runtimeSettings = settings();
  const bus = fakeBus();
  const app = routeApp({ runtimeSettings, bus, now: () => now });

  const ownerResponse = await app.request(`/api/conversations/${conversationId}/typing`, {
    method: "POST",
    headers: { Cookie: await cookieFor(runtimeSettings, "cookie-r12-typing-owner") }
  });
  const otherResponse = await app.request(`/api/conversations/${conversationId}/typing`, {
    method: "POST",
    headers: { Cookie: await cookieFor(runtimeSettings, "cookie-r12-typing-other") }
  });

  assert.deepEqual(await ownerResponse.json(), { ok: true, data: { published: true } });
  assert.deepEqual(await otherResponse.json(), { ok: true, data: { published: true } });
  assert.equal(bus.published.length, 2);
});

test("a broker publish failure is swallowed (best-effort) — the endpoint still reports success", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const warnings: unknown[] = [];
  app.route(
    "/api",
    createConversationTypingRoutes({
      auth: authDeps(runtimeSettings),
      conversations: conversationsService(),
      now: () => now,
      bus: {
        backend: "memory",
        async publish() {
          throw new Error("broker unavailable");
        }
      },
      logger: {
        warn: (...args: unknown[]) => {
          warnings.push(args);
        }
      }
    })
  );
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r12-typing-owner") };

  const response = await app.request(`/api/conversations/${conversationId}/typing`, { method: "POST", headers });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, data: { published: true } });
  assert.equal(warnings.length, 1);
});

test("TypingDedupeGate: within the window returns false, after it returns true again", () => {
  const gate = new TypingDedupeGate(1000, 10);
  assert.equal(gate.shouldPublish("k", 0), true);
  assert.equal(gate.shouldPublish("k", 500), false);
  assert.equal(gate.shouldPublish("k", 999), false);
  assert.equal(gate.shouldPublish("k", 1000), true);
});

test("TypingDedupeGate: distinct keys never throttle each other", () => {
  const gate = new TypingDedupeGate(1000, 10);
  assert.equal(gate.shouldPublish("a", 0), true);
  assert.equal(gate.shouldPublish("b", 0), true);
});

test("TypingDedupeGate: evicts the oldest entry once the bound is hit instead of growing unbounded", () => {
  const gate = new TypingDedupeGate(1000, 2);
  assert.equal(gate.shouldPublish("a", 0), true);
  assert.equal(gate.shouldPublish("b", 1), true);
  // Bound is 2; a third distinct key evicts "a" (the oldest) to make room.
  assert.equal(gate.shouldPublish("c", 2), true);
  // "a" was evicted, so this reads as a brand-new key even though it's within 1000ms of its original ping.
  assert.equal(gate.shouldPublish("a", 3), true);
});
