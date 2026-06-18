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
import type { ProposalService } from "./services/proposals.js";
import { WorkItemServiceError, type WorkItemService } from "./services/work-items.js";
import { resolveAuthorizedTopic } from "./sse/topic-access.js";
import { createInMemoryAgentRunQueue } from "./workers/agent-runner.js";

const now = new Date("2026-06-05T00:00:00.000Z");

test("topic authorization derives user streams from identity and rejects unregistered private topics", async () => {
  // findings[#tenancy]：全局流按工作区隔离后，admin 解析到 `all:<workspaceId>`（不再裸 'all'）——
  // 故 StreamUser 携带租户。两人在同一默认工作区，全局话题相同。
  const workspaceId = "00000000-0000-4000-8000-000000000002";
  const user = { id: "10000000-0000-4000-8000-000000000001", nickname: "alice", isAdmin: false, orgId: "00000000-0000-4000-8000-000000000001", workspaceId };
  const admin = { ...user, id: "10000000-0000-4000-8000-000000000002", nickname: "admin", isAdmin: true };

  await assert.rejects(() => resolveAuthorizedTopic(user, { kind: "all" }));
  assert.equal(await resolveAuthorizedTopic(admin, { kind: "all" }), `all:${workspaceId}`);
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
      workItems: false,
      proposals: false,
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

test("findings[#170] connected frame advertises fresh resume mode even with a cursor (no false reconcile)", async () => {
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
      access: { canViewWorkItem: async () => true },
      stream: { heartbeatMs: 20 }
    })
  );

  const controller = new AbortController();
  const response = await app.request(
    "/api/push/stream/workitem/50000000-0000-4000-8000-000000000001?last_event_id=evt_stale_123",
    {
      headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) },
      signal: controller.signal
    }
  );
  assert.equal(response.status, 200);
  // 客户端确实请求了 resume（header 如实记录），但后端不重放 → connected 帧诚实报 "fresh"，不谎称 "reconcile"。
  assert.equal(response.headers.get("x-workhub-sse-cursor"), "resume-requested");
  const reader = response.body!.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value ?? new Uint8Array());
  assert.match(text, /event: connected/u);
  assert.match(text, /"resume_mode":"fresh"/u);
  assert.doesNotMatch(text, /reconcile/u);
  await reader.cancel();
  controller.abort();
});

test("push route default resolvers authorize workitem session and proposal streams through work item ownership", async () => {
  const runtimeSettings = settings();
  const alice = user();
  const stranger = user({
    id: "10000000-0000-4000-8000-000000000004",
    nickname: "stranger",
    cookieToken: "cookie-stranger"
  });
  const resourceWorkItemId = "50000000-0000-4000-8000-000000000051";
  const proposalId = "60000000-0000-4000-8000-000000000051";
  const workItemReads: Array<{ workItemId: string; actorId: string }> = [];
  const workItems = {
    async detailPage(input: Parameters<WorkItemService["detailPage"]>[0]) {
      workItemReads.push({ workItemId: input.workItemId, actorId: input.actor.id });
      if (input.workItemId !== resourceWorkItemId) {
        throw new WorkItemServiceError(404, "not_found", "missing");
      }
      if (input.actor.id !== alice.id && !input.actor.isAdmin) {
        throw new WorkItemServiceError(403, "forbidden", "forbidden");
      }
      return {} as Awaited<ReturnType<WorkItemService["detailPage"]>>;
    }
  } as unknown as WorkItemService;
  const proposals = {
    async get(id: string) {
      if (id !== proposalId) {
        return null;
      }
      return {
        id: proposalId,
        work_item_id: resourceWorkItemId
      } as Awaited<ReturnType<ProposalService["get"]>>;
    },
    async getByMergeProposal() {
      return null;
    }
  } as unknown as ProposalService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api/push",
    createPushRoutes({
      auth: deps([alice, stranger], [], runtimeSettings),
      bus: new InProcessPushBus(),
      presence: new InMemoryPresenceStore(),
      workItems,
      proposals,
      stream: { heartbeatMs: 20 }
    })
  );

  for (const path of [
    `/api/push/stream/workitem/${resourceWorkItemId}`,
    `/api/push/stream/session/${resourceWorkItemId}`,
    `/api/push/stream/proposal/${proposalId}`
  ]) {
    const controller = new AbortController();
    const response = await app.request(path, {
      headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) },
      signal: controller.signal
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type")?.includes("text/event-stream"), true);
    controller.abort();
  }

  const forbidden = await app.request(`/api/push/stream/proposal/${proposalId}`, {
    headers: { Cookie: await signedCookie(stranger.cookieToken, runtimeSettings) }
  });
  assert.equal(forbidden.status, 403);
  assert.deepEqual(workItemReads.map((read) => read.workItemId), [
    resourceWorkItemId,
    resourceWorkItemId,
    resourceWorkItemId,
    resourceWorkItemId
  ]);
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
    mutedNotificationTypes: [],
    isAdmin: false,
    deletedAt: null,
    deletedByUserId: null,
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
