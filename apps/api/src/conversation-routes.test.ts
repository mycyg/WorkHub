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
import { InternalContractError } from "./pages/output-contract.js";
import { createConversationRoutes } from "./routes/conversations.js";
import { jsonObjectMessage, malformedJsonMessage } from "./routes/json-body.js";
import {
  ConversationServiceError,
  type ConversationService
} from "./services/conversations.js";

const now = new Date("2026-07-12T08:30:00.123Z");
const projectId = "20000000-0000-4000-8000-000000000002";
const conversationId = "30000000-0000-4000-8000-000000000003";
const messageId = "40000000-0000-4000-8000-000000000004";
const driveItemId = "50000000-0000-4000-8000-000000000005";
const userId = "60000000-0000-4000-8000-000000000006";
const workspaceId = "00000000-0000-4000-8000-000000000002";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r12-conversation-route-secret" });
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

function conversationVm() {
  return {
    id: conversationId,
    workspace_id: workspaceId,
    project_id: projectId,
    kind: "collab" as const,
    title: "重写第三节",
    parent_conversation_id: null,
    source_message_id: null,
    visibility: "private" as const,
    next_seq: 1,
    created_by: userId,
    participant_role: "owner" as const,
    cuu_enabled: true,
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };
}

function messageVm() {
  return {
    id: messageId,
    conversation_id: conversationId,
    seq: 1,
    sender_type: "user" as const,
    sender_user_id: userId,
    kind: "text" as const,
    content: { text: "请先核对引用。" },
    thread_root_id: null,
    created_at: now.toISOString()
  };
}

function service(overrides: Partial<ConversationService> = {}): ConversationService {
  return {
    async assertProjectAccess() {},
    async assertConversationAccess() {
      return { projectId };
    },
    async listConversations() {
      return { conversations: [], capped: false, next_cursor: null };
    },
    async createConversation() {
      return { conversation: conversationVm(), participants: [] };
    },
    async listMessages() {
      return { messages: [], has_more: false, next_after_seq: 0 };
    },
    async createMessage() {
      return messageVm();
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

function routeApp(runtimeSettings: Settings, conversations: ConversationService) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createConversationRoutes({ auth: authDeps(runtimeSettings), conversations }));
  return app;
}

test("conversation POST routes authenticate before reading malformed bodies", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service({
    async assertProjectAccess() {
      throw new Error("anonymous request must not reach access preflight");
    },
    async assertConversationAccess() {
      throw new Error("anonymous request must not reach access preflight");
    }
  }));

  for (const path of [
    `/api/projects/${projectId}/conversations`,
    `/api/conversations/${conversationId}/messages`
  ]) {
    const response = await app.request(path, { method: "POST", body: "{" });
    assert.equal(response.status, 401);
  }
});

test("invalid UUIDs return the same domain 404 shape without entering the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(runtimeSettings, service({
    async listConversations() {
      calls += 1;
      throw new Error("invalid UUID must not reach service");
    },
    async listMessages() {
      calls += 1;
      throw new Error("invalid UUID must not reach service");
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const invalidProject = await app.request("/api/projects/not-a-uuid/conversations", { headers });
  const invalidConversation = await app.request("/api/conversations/not-a-uuid/messages", { headers });

  assert.equal(invalidProject.status, 404);
  assert.deepEqual(await invalidProject.json(), {
    ok: false,
    error: { code: "conversation_project_not_found", message: "没有找到这个项目会话区。" }
  });
  assert.equal(invalidConversation.status, 404);
  assert.deepEqual(await invalidConversation.json(), {
    ok: false,
    error: { code: "conversation_not_found", message: "没有找到这个会话。" }
  });
  assert.equal(calls, 0);
});

test("conversation POST access preflight runs before body parsing", async () => {
  const runtimeSettings = settings();
  const seen: string[] = [];
  const app = routeApp(runtimeSettings, service({
    async assertProjectAccess() {
      seen.push("project-access");
      throw new ConversationServiceError(404, "conversation_project_not_found", "没有找到这个项目会话区。");
    },
    async assertConversationAccess() {
      seen.push("conversation-access");
      throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
    },
    async createConversation() {
      seen.push("project-create");
      throw new Error("must not create");
    },
    async createMessage() {
      seen.push("message-create");
      throw new Error("must not create");
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const project = await app.request(`/api/projects/${projectId}/conversations`, {
    method: "POST",
    headers,
    body: "{"
  });
  const conversation = await app.request(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers,
    body: "{"
  });

  assert.equal(project.status, 404);
  assert.equal(conversation.status, 404);
  assert.deepEqual(seen, ["project-access", "conversation-access"]);
});

test("conversation POST routes preserve malformed/non-object 400 and contract 422 boundaries", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service());
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const malformed = await app.request(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers,
    body: "{"
  });
  const nonObject = await app.request(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers,
    body: "[]"
  });
  const invalidContract = await app.request(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      kind: "file_card",
      content: { drive_item_id: driveItemId, snapshot_name: "client-name.docx" }
    })
  });

  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    ok: false,
    error: { code: "malformed_json", message: malformedJsonMessage }
  });
  assert.equal(nonObject.status, 400);
  assert.deepEqual(await nonObject.json(), {
    ok: false,
    error: { code: "json_object_required", message: jsonObjectMessage }
  });
  assert.equal(invalidContract.status, 422);
});

test("conversation reads parse canonical cursors, call the service, and return 200", async () => {
  const runtimeSettings = settings();
  const calls: unknown[] = [];
  const app = routeApp(runtimeSettings, service({
    async listConversations(input) {
      calls.push(input);
      return { conversations: [conversationVm()], capped: false, next_cursor: null };
    },
    async listMessages(input) {
      calls.push(input);
      return { messages: [messageVm()], has_more: false, next_after_seq: 1 };
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings) };
  const afterCreatedAt = "2026-07-12T08:30:00.123456Z";

  const conversations = await app.request(
    `/api/projects/${projectId}/conversations?afterCreatedAt=${afterCreatedAt}&afterId=${conversationId}&limit=25`,
    { headers }
  );
  const messages = await app.request(
    `/api/conversations/${conversationId}/messages?afterSeq=7&limit=20`,
    { headers }
  );

  assert.equal(conversations.status, 200);
  assert.equal(messages.status, 200);
  assert.deepEqual(calls.map((call) => {
    const input = call as { actor: unknown; [key: string]: unknown };
    const { actor: _actor, ...rest } = input;
    return rest;
  }), [
    { projectId, query: { afterCreatedAt, afterId: conversationId, limit: 25 } },
    { conversationId, query: { afterSeq: 7, limit: 20 } }
  ]);
});

// R12 批8：beforeSeq（反向翻页）——与 afterSeq 互斥，路由层原样转发解析好的 query 给服务，不做任何
// 额外分叉（分叉在服务层，见 services/conversations.ts 的 listMessages）。
test("conversation message reads forward a beforeSeq cursor and reject afterSeq+beforeSeq together", async () => {
  const runtimeSettings = settings();
  const calls: unknown[] = [];
  const app = routeApp(runtimeSettings, service({
    async listMessages(input) {
      calls.push(input);
      return { messages: [messageVm()], has_more: true, next_after_seq: 6, next_before_seq: 5 };
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const before = await app.request(
    `/api/conversations/${conversationId}/messages?beforeSeq=7&limit=20`,
    { headers }
  );
  const both = await app.request(
    `/api/conversations/${conversationId}/messages?afterSeq=1&beforeSeq=7`,
    { headers }
  );

  assert.equal(before.status, 200);
  assert.deepEqual(await before.json(), {
    ok: true,
    data: { messages: [messageVm()], has_more: true, next_after_seq: 6, next_before_seq: 5 }
  });
  assert.equal(both.status, 422);
  assert.deepEqual(calls.map((call) => {
    const input = call as { actor: unknown; [key: string]: unknown };
    const { actor: _actor, ...rest } = input;
    return rest;
  }), [
    { conversationId, query: { beforeSeq: 7, limit: 20 } }
  ]);
});

test("conversation writes run access preflight, parse payloads, and return 201", async () => {
  const runtimeSettings = settings();
  const seen: string[] = [];
  const app = routeApp(runtimeSettings, service({
    async assertProjectAccess() {
      seen.push("project-access");
    },
    async createConversation(input) {
      seen.push(`project-create:${input.payload.title}`);
      return {
        conversation: conversationVm(),
        participants: [{
          id: "61000000-0000-4000-8000-000000000001",
          conversation_id: conversationId,
          user_id: userId,
          role: "owner",
          created_at: now.toISOString(),
          updated_at: now.toISOString()
        }]
      };
    },
    async assertConversationAccess() {
      seen.push("conversation-access");
      return { projectId };
    },
    async createMessage(input) {
      seen.push(`message-create:${input.payload.kind}`);
      return messageVm();
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const conversation = await app.request(`/api/projects/${projectId}/conversations`, {
    method: "POST",
    headers,
    body: JSON.stringify({ kind: "collab", title: "重写第三节", visibility: "private" })
  });
  const message = await app.request(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ kind: "text", content: { text: "请先核对引用。" } })
  });

  assert.equal(conversation.status, 201);
  assert.equal(message.status, 201);
  assert.deepEqual(seen, [
    "project-access",
    "project-create:重写第三节",
    "conversation-access",
    "message-create:text"
  ]);
});

test("conversation routes preserve typed service 400, 404, and 409 errors", async () => {
  const runtimeSettings = settings();
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };
  for (const [status, code] of [
    [400, "conversation_thread_invalid"],
    [404, "conversation_not_found"],
    [409, "conversation_sequence_exhausted"]
  ] as const) {
    const app = routeApp(runtimeSettings, service({
      async createMessage() {
        throw new ConversationServiceError(status, code, `typed ${status}`);
      }
    }));
    const response = await app.request(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "text", content: { text: "hello" } })
    });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: { code, message: `typed ${status}` }
    });
  }
});

test("conversation routes return an internal 500 envelope for output-contract drift", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service({
    async listConversations() {
      throw new InternalContractError("conversations.list", new ZodError([]));
    }
  }));

  const response = await app.request(`/api/projects/${projectId}/conversations`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "internal_contract_error", message: "internal" }
  });
});

test("conversation route factory exposes exactly four endpoints and no action-card or SSE placeholders", () => {
  const routes = createConversationRoutes({ auth: authDeps(settings()), conversations: service() });
  const inventory = [...new Set(
    (routes as typeof routes & { routes: Array<{ method: string; path: string }> }).routes
      .filter((route) => route.method !== "ALL")
      .map((route) => `${route.method} ${route.path}`)
  )].sort();

  assert.deepEqual(inventory, [
    "GET /conversations/:id/messages",
    "GET /projects/:id/conversations",
    "POST /conversations/:id/messages",
    "POST /projects/:id/conversations"
  ]);
});
