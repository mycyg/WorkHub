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
import type { OpenDmResultVM } from "@workhub/contracts";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import { ConversationServiceError, type ConversationService } from "../services/conversations.js";
import { createDmRoutes } from "./dm.js";

// R15 批 B（人对人私聊）：POST /api/dm/open 的路由层套件——鉴权门、body 校验、转发、错误直通。
// 会话查重/容器创建/同工作区校验的语义在 services/conversations.ts 的 openDm 里测（conversations.test.ts）
// 与仓库层测（conversation-repository.test.ts），这里只覆盖路由本身。

const now = new Date("2026-07-15T09:00:00.123Z");
const dmConversationId = "30000000-0000-4000-8000-000000000003";
const containerProjectId = "20000000-0000-4000-8000-000000000009";
const userId = "60000000-0000-4000-8000-000000000006";
const targetUserId = "60000000-0000-4000-8000-000000000007";
const workspaceId = "00000000-0000-4000-8000-000000000002";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r15-dm-route-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "r15-dm-owner",
    cookieToken: "cookie-r15-dm-owner",
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
    return token === "cookie-r15-dm-owner" ? user() : null;
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
  return generateSignedCookie(COOKIE_NAME, "cookie-r15-dm-owner", runtimeSettings.auth.cookieSecret);
}

function dmResultVm(): OpenDmResultVM {
  return {
    conversation: {
      id: dmConversationId,
      workspace_id: workspaceId,
      project_id: containerProjectId,
      kind: "collab",
      title: "私聊",
      parent_conversation_id: null,
      source_message_id: null,
      visibility: "private",
      next_seq: 0,
      created_by: userId,
      participant_role: "owner",
      cuu_enabled: false,
      is_dm: true,
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
  app.route("/api/dm", createDmRoutes({ auth: authDeps(runtimeSettings), conversations }));
  return app;
}

test("dm open requires authentication before reaching the service", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async openDm() {
        throw new Error("anonymous request must not reach the service");
      }
    })
  );

  const response = await app.request("/api/dm/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: targetUserId })
  });

  assert.equal(response.status, 401);
});

test("a malformed body (missing/non-uuid user_id or extra keys) 422s before the service runs", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(
    runtimeSettings,
    service({
      async openDm() {
        calls += 1;
        throw new Error("malformed body must not reach the service");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  for (const body of [{}, { user_id: "not-a-uuid" }, { user_id: targetUserId, extra: true }]) {
    const response = await app.request("/api/dm/open", {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 422);
  }
  assert.equal(calls, 0);
});

test("a well-formed open forwards actor/targetUserId and returns the service VM verbatim (201)", async () => {
  const runtimeSettings = settings();
  const seen: unknown[] = [];
  const app = routeApp(
    runtimeSettings,
    service({
      async openDm(input) {
        seen.push(input);
        return dmResultVm();
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request("/api/dm/open", {
    method: "POST",
    headers,
    body: JSON.stringify({ user_id: targetUserId })
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, data: dmResultVm() });
  assert.equal(seen.length, 1);
  const call = seen[0] as { actor: { userId?: string }; targetUserId: string };
  assert.equal(call.actor.userId, userId);
  assert.equal(call.targetUserId, targetUserId);
});

test("the route preserves the service's typed 400 for a self-DM", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async openDm() {
        throw new ConversationServiceError(400, "conversation_dm_self", "不能和自己开私聊。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request("/api/dm/open", {
    method: "POST",
    headers,
    body: JSON.stringify({ user_id: userId })
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "conversation_dm_self", message: "不能和自己开私聊。" }
  });
});

test("the route preserves the service's typed 404 for a target outside the workspace", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async openDm() {
        throw new ConversationServiceError(404, "conversation_dm_target_not_found", "没有找到这个工作区里的这个人。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request("/api/dm/open", {
    method: "POST",
    headers,
    body: JSON.stringify({ user_id: targetUserId })
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "conversation_dm_target_not_found", message: "没有找到这个工作区里的这个人。" }
  });
});
