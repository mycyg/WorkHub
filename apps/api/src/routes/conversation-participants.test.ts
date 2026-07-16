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
import type { ConversationParticipantsVM } from "@workhub/contracts";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import { ConversationServiceError, type ConversationService } from "../services/conversations.js";
import { createConversationParticipantsRoutes } from "./conversation-participants.js";

const now = new Date("2026-07-15T08:30:00.123Z");
const conversationId = "30000000-0000-4000-8000-000000000003";
const userId = "60000000-0000-4000-8000-000000000006";
const otherUserId = "60000000-0000-4000-8000-000000000007";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r15-participants-route-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "r15-participants-owner",
    cookieToken: "cookie-r15-participants-owner",
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
    return token === "cookie-r15-participants-owner" ? user() : null;
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
  return generateSignedCookie(COOKIE_NAME, "cookie-r15-participants-owner", runtimeSettings.auth.cookieSecret);
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
  app.route("/api", createConversationParticipantsRoutes({ auth: authDeps(runtimeSettings), conversations }));
  return app;
}

test("participants list requires authentication before reaching the service", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async listParticipants() {
        throw new Error("anonymous request must not reach the service");
      }
    })
  );

  const response = await app.request(`/api/conversations/${conversationId}/participants`);

  assert.equal(response.status, 401);
});

test("an invalid conversation id 404s without entering the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(
    runtimeSettings,
    service({
      async listParticipants() {
        calls += 1;
        throw new Error("invalid UUID must not reach the service");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request("/api/conversations/not-a-uuid/participants", { headers });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "conversation_not_found", message: "没有找到这个会话。" }
  });
  assert.equal(calls, 0);
});

test("main conversations return scope=workspace with an empty list, forwarded verbatim", async () => {
  const runtimeSettings = settings();
  const seen: unknown[] = [];
  const vm: ConversationParticipantsVM = { scope: "workspace", participants: [] };
  const app = routeApp(
    runtimeSettings,
    service({
      async listParticipants(input) {
        seen.push(input);
        return vm;
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request(`/api/conversations/${conversationId}/participants`, { headers });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: vm });
  assert.equal(seen.length, 1);
  assert.equal((seen[0] as { conversationId: string }).conversationId, conversationId);
});

test("collab / DM conversations return scope=participants with real rows", async () => {
  const runtimeSettings = settings();
  const vm: ConversationParticipantsVM = {
    scope: "participants",
    participants: [
      { user_id: userId, nickname: "阿曼", role: "owner" },
      { user_id: otherUserId, nickname: "小赵", role: "member" }
    ]
  };
  const app = routeApp(
    runtimeSettings,
    service({
      async listParticipants() {
        return vm;
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request(`/api/conversations/${conversationId}/participants`, { headers });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: vm });
});

test("the route preserves the service's typed 404 for an invisible (or non-participant) conversation", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    service({
      async listParticipants() {
        throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request(`/api/conversations/${conversationId}/participants`, { headers });

  assert.equal(response.status, 404);
});
