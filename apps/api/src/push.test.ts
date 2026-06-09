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

import { InProcessPushBus } from "./broker/memory.js";
import { InMemoryPresenceStore } from "./broker/presence.js";
import type { AuthDependencies, AuthEnv } from "./middleware/auth.js";
import { COOKIE_NAME } from "./middleware/auth.js";
import { createPushRoutes } from "./routes/push.js";
import { resolveAuthorizedTopic } from "./sse/topic-access.js";
import { createInMemoryAgentRunQueue } from "./workers/agent-runner.js";

const now = new Date("2026-06-05T00:00:00.000Z");

test("topic authorization derives user streams from identity and rejects unregistered private topics", async () => {
  const user = { id: "10000000-0000-4000-8000-000000000001", nickname: "alice", isAdmin: false };
  const admin = { ...user, id: "10000000-0000-4000-8000-000000000002", nickname: "admin", isAdmin: true };

  await assert.rejects(() => resolveAuthorizedTopic(user, { kind: "all" }));
  assert.equal(await resolveAuthorizedTopic(admin, { kind: "all" }), "all");
  assert.equal(await resolveAuthorizedTopic(user, { kind: "me" }), `user:${user.id}`);
  await assert.rejects(() => resolveAuthorizedTopic(user, { kind: "run", id: "r1" }));
  await assert.rejects(() => resolveAuthorizedTopic(user, { kind: "session", id: "s1" }));
  await assert.rejects(() => resolveAuthorizedTopic(user, { kind: "proposal", id: "p1" }));
});

test("push route limits the global all stream to admins", async () => {
  const runtimeSettings = settings();
  const alice = user();
  const admin = user({
    id: "10000000-0000-4000-8000-000000000003",
    nickname: "admin",
    cookieToken: "cookie-admin",
    isAdmin: true
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api/push",
    createPushRoutes({
      auth: deps([alice, admin], [], runtimeSettings),
      bus: new InProcessPushBus(),
      presence: new InMemoryPresenceStore(),
      stream: { heartbeatMs: 20 }
    })
  );

  const regularResponse = await app.request("/api/push/stream", {
    headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) }
  });
  assert.equal(regularResponse.status, 403);

  const adminController = new AbortController();
  const adminResponse = await app.request("/api/push/stream", {
    headers: { Cookie: await signedCookie(admin.cookieToken, runtimeSettings) },
    signal: adminController.signal
  });
  assert.equal(adminResponse.status, 200);
  assert.equal(adminResponse.headers.get("content-type")?.includes("text/event-stream"), true);
  adminController.abort();
});

test("push route authorizes run streams through the AgentRun owner/admin gate", async () => {
  const runtimeSettings = settings();
  const alice = user();
  const stranger = user({
    id: "10000000-0000-4000-8000-000000000002",
    nickname: "bob",
    cookieToken: "cookie-bob"
  });
  const admin = user({
    id: "10000000-0000-4000-8000-000000000003",
    nickname: "admin",
    cookieToken: "cookie-admin",
    isAdmin: true
  });
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000041"
  });
  const run = await queue.enqueue({
    workItemId: "50000000-0000-4000-8000-000000000041",
    actorId: alice.id,
    title: "Private stream run"
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api/push",
    createPushRoutes({
      auth: deps([alice, stranger, admin], [], runtimeSettings),
      bus: new InProcessPushBus(),
      presence: new InMemoryPresenceStore(),
      agentRuns: queue,
      stream: { heartbeatMs: 20 }
    })
  );

  const strangerResponse = await app.request(`/api/push/stream/run/${run.run_id}`, {
    headers: { Cookie: await signedCookie(stranger.cookieToken, runtimeSettings) }
  });
  assert.equal(strangerResponse.status, 403);

  const ownerController = new AbortController();
  const ownerResponse = await app.request(`/api/push/stream/run/${run.run_id}`, {
    headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) },
    signal: ownerController.signal
  });
  assert.equal(ownerResponse.status, 200);
  assert.equal(ownerResponse.headers.get("content-type")?.includes("text/event-stream"), true);
  ownerController.abort();

  const adminController = new AbortController();
  const adminResponse = await app.request(`/api/push/stream/run/${run.run_id}`, {
    headers: { Cookie: await signedCookie(admin.cookieToken, runtimeSettings) },
    signal: adminController.signal
  });
  assert.equal(adminResponse.status, 200);
  assert.equal(adminResponse.headers.get("content-type")?.includes("text/event-stream"), true);
  adminController.abort();
});

test("push route fails closed on workitem stream when can_view is not registered", async () => {
  const runtimeSettings = settings();
  const alice = user();
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api/push",
    createPushRoutes({
      auth: deps([alice], [], runtimeSettings),
      bus: new InProcessPushBus(),
      presence: new InMemoryPresenceStore(),
      stream: { heartbeatMs: 20 }
    })
  );

  const response = await app.request("/api/push/stream/workitem/50000000-0000-4000-8000-000000000001", {
    headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) }
  });

  assert.equal(response.status, 403);
});

test("push route allows authorized workitem topic before handing off to the SSE stream", async () => {
  const runtimeSettings = settings();
  const alice = user();
  const bus = new InProcessPushBus();
  const presence = new InMemoryPresenceStore();
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api/push",
    createPushRoutes({
      auth: deps([alice], [], runtimeSettings),
      bus,
      presence,
      access: {
        canViewWorkItem: async () => true
      },
      stream: { heartbeatMs: 20 }
    })
  );

  const controller = new AbortController();
  const response = await app.request(
    "/api/push/stream/workitem/50000000-0000-4000-8000-000000000001",
    {
      headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) },
      signal: controller.signal
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type")?.includes("text/event-stream"), true);
  controller.abort();
});

class MemoryUsers implements UserRepository {
  constructor(private rows: UserAuthRow[]) {}

  async findActiveById(id: string) {
    return this.rows.find((row) => row.id === id && row.deletedAt === null) ?? null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return this.rows.find((row) => row.cookieToken === cookieToken && row.deletedAt === null) ?? null;
  }

  async findActiveByNickname(nickname: string) {
    return this.rows.find((row) => row.nickname === nickname && row.deletedAt === null) ?? null;
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
  constructor(private rows: ClientDeviceAuthRow[]) {}

  async findActiveByTokenHash() {
    return null;
  }

  async findActiveByTokenHashForUser() {
    return null;
  }

  async createClientDevice(): Promise<ClientDeviceAuthRow> {
    throw new Error("not needed");
  }

  async listByUser(userId: string) {
    return this.rows.filter((row) => row.userId === userId);
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

function user(partial: Partial<UserAuthRow> = {}): UserAuthRow {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    nickname: "alice",
    cookieToken: "cookie-alice",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

function settings(env: Record<string, string | undefined> = {}): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret",
    ...env
  });
}

function deps(users: UserAuthRow[], devices: ClientDeviceAuthRow[], runtimeSettings = settings()): AuthDependencies {
  return {
    users: new MemoryUsers(users),
    devices: new MemoryDevices(devices),
    settings: runtimeSettings,
    now: () => now
  };
}

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

async function signedCookie(cookieToken: string, runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, cookieToken, runtimeSettings.auth.cookieSecret);
}
