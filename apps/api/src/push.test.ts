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
import { ConversationServiceError, type ConversationService } from "./services/conversations.js";
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

test("conversation topic authorization never grants admin bypass and resolves one exact private topic", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000002";
  const conversationId = "30000000-0000-4000-8000-000000000003";
  const member = { id: "10000000-0000-4000-8000-000000000001", nickname: "alice", isAdmin: false, orgId: "00000000-0000-4000-8000-000000000001", workspaceId };
  const admin = { ...member, id: "10000000-0000-4000-8000-000000000002", nickname: "admin", isAdmin: true };
  const calls: Array<{ userId: string; id: string }> = [];
  const access = {
    async canViewConversation(candidate: typeof member, id: string) {
      calls.push({ userId: candidate.id, id });
      return candidate.id === member.id;
    }
  };

  assert.equal(
    await resolveAuthorizedTopic(member, { kind: "conversation", id: conversationId }, access),
    `conversation:${conversationId}`
  );
  await assert.rejects(
    () => resolveAuthorizedTopic(admin, { kind: "conversation", id: conversationId }, access),
    (error) => error instanceof HTTPException && error.status === 403
  );
  assert.deepEqual(calls, [
    { userId: member.id, id: conversationId },
    { userId: admin.id, id: conversationId }
  ]);
});

test("default conversation stream access delegates every identity to ConversationService without admin bypass", async () => {
  const runtimeSettings = settings();
  const conversationId = "30000000-0000-4000-8000-000000000003";
  const mainMember = user();
  const collabParticipant = user({
    id: "10000000-0000-4000-8000-000000000002",
    nickname: "collaborator",
    cookieToken: "cookie-collaborator"
  });
  const deniedUsers = [
    ["collab non-participant", false],
    ["admin non-participant", true],
    ["cross-workspace viewer", false],
    ["revoked membership", false],
    ["deleted or inactive resource", false]
  ].map(([label, isAdmin], index) => user({
    id: `10000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    nickname: String(label),
    cookieToken: `cookie-denied-${index}`,
    isAdmin: Boolean(isAdmin)
  }));
  const allowedIds = new Set([mainMember.id, collabParticipant.id]);
  const accessCalls: Array<{ actorId: string; userId: string | undefined; isAdmin: boolean; conversationId: string }> = [];
  const conversations = {
    async assertConversationAccess(input: Parameters<ConversationService["assertConversationAccess"]>[0]) {
      accessCalls.push({
        actorId: input.actor.id,
        userId: input.actor.userId,
        isAdmin: input.actor.isAdmin,
        conversationId: input.conversationId
      });
      if (!allowedIds.has(input.actor.id)) {
        throw new ConversationServiceError(404, "conversation_not_found", "missing");
      }
      return { projectId: "20000000-0000-4000-8000-000000000002" };
    }
  } as ConversationService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/push", createPushRoutes({
    auth: deps([mainMember, collabParticipant, ...deniedUsers], [], runtimeSettings),
    bus: new InProcessPushBus(),
    presence: new InMemoryPresenceStore(),
    conversations,
    stream: { heartbeatMs: 20 }
  }));

  for (const allowed of [mainMember, collabParticipant]) {
    const controller = new AbortController();
    const response = await app.request(`/api/push/stream/conversation/${conversationId}`, {
      headers: { Cookie: await signedCookie(allowed.cookieToken, runtimeSettings) },
      signal: controller.signal
    });
    assert.equal(response.status, 200, allowed.nickname);
    controller.abort();
  }
  for (const denied of deniedUsers) {
    const response = await app.request(`/api/push/stream/conversation/${conversationId}`, {
      headers: { Cookie: await signedCookie(denied.cookieToken, runtimeSettings) }
    });
    assert.equal(response.status, 403, denied.nickname);
  }
  assert.equal(accessCalls.length, 7);
  assert.deepEqual(accessCalls.at(-4), {
    actorId: deniedUsers[1]?.id,
    userId: deniedUsers[1]?.id,
    isAdmin: true,
    conversationId
  });
});

test("conversation stream rejects malformed UUIDs before access and propagates unknown access outages", async () => {
  const runtimeSettings = settings();
  const alice = user();
  const unexpected = new Error("conversation database unavailable");
  let accessCalls = 0;
  const conversations = {
    async assertConversationAccess(input: Parameters<ConversationService["assertConversationAccess"]>[0]) {
      accessCalls += 1;
      if (input.conversationId === "30000000-0000-4000-8000-000000000003") {
        throw unexpected;
      }
      return { projectId: "20000000-0000-4000-8000-000000000002" };
    }
  } as ConversationService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/push", createPushRoutes({
    auth: deps([alice], [], runtimeSettings),
    bus: new InProcessPushBus(),
    presence: new InMemoryPresenceStore(),
    conversations
  }));

  const malformed = await app.request("/api/push/stream/conversation/not-a-uuid", {
    headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) }
  });
  assert.equal(malformed.status, 403);
  assert.equal(accessCalls, 0);
  const cookie = await signedCookie(alice.cookieToken, runtimeSettings);
  await assert.rejects(
    async () => app.request("/api/push/stream/conversation/30000000-0000-4000-8000-000000000003", {
      headers: { Cookie: cookie }
    }),
    (error: unknown) => error === unexpected
  );
  assert.equal(accessCalls, 1);
});

test("conversation SSE is live-only, keeps fresh resume semantics, forwards event ids, and aborts its one topic", async () => {
  const runtimeSettings = settings();
  const alice = user();
  const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const routeConversationId = conversationId.toUpperCase();
  const topic = `conversation:${conversationId}`;
  class TrackingBus extends InProcessPushBus {
    public readonly subscriptions: string[] = [];
    public readonly unsubscriptions: string[] = [];
    override async subscribe(value: string) {
      this.subscriptions.push(value);
      return super.subscribe(value);
    }
    override async unsubscribe(value: string, subscription: Parameters<InProcessPushBus["unsubscribe"]>[1]) {
      this.unsubscriptions.push(value);
      await super.unsubscribe(value, subscription);
    }
  }
  const bus = new TrackingBus();
  await bus.publish(topic, "conversation.message.created", {
    event_id: "41000000-0000-4000-8000-000000000040",
    type: "conversation.message.created",
    topic,
    ts: "2026-07-12T08:30:00.000Z",
    data: { seq: 1 }
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/push", createPushRoutes({
    auth: deps([alice], [], runtimeSettings),
    bus,
    presence: new InMemoryPresenceStore(),
    access: { canViewConversation: async () => true },
    stream: { heartbeatMs: 1_000 }
  }));
  const controller = new AbortController();
  const response = await app.request(`/api/push/stream/conversation/${routeConversationId}`, {
    headers: {
      Cookie: await signedCookie(alice.cookieToken, runtimeSettings),
      "Last-Event-ID": "41000000-0000-4000-8000-000000000039"
    },
    signal: controller.signal
  });

  assert.equal(response.status, 200);
  assert.deepEqual(bus.subscriptions, [topic]);
  assert.equal(response.headers.get("x-workhub-sse-cursor"), "resume-requested");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const connected = decoder.decode((await reader.read()).value ?? new Uint8Array());
  assert.match(connected, /event: connected/u);
  assert.match(connected, /"resume_mode":"fresh"/u);
  assert.doesNotMatch(connected, /41000000-0000-4000-8000-000000000040/u);

  const eventId = "41000000-0000-4000-8000-000000000041";
  await bus.publish(topic, "conversation.message.created", {
    event_id: eventId,
    type: "conversation.message.created",
    topic,
    ts: "2026-07-12T08:31:00.000Z",
    data: { seq: 2 }
  });
  const live = decoder.decode((await reader.read()).value ?? new Uint8Array());
  assert.match(live, new RegExp(`id: ${eventId}`, "u"));
  assert.match(live, /event: conversation\.message\.created/u);
  assert.match(live, /"seq":2/u);

  controller.abort();
  await reader.cancel().catch(() => undefined);
  for (let attempt = 0; attempt < 20 && bus.unsubscriptions.length === 0; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(bus.unsubscriptions, [topic]);
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

test("push route falls back to the AgentRun owner/admin gate when work item access is unavailable", async () => {
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
      workItems: false,
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

test("push route run streams stay scoped to the actor workspace", async () => {
  const runWorkspaceId = "00000000-0000-4000-8000-00000000b0a1";
  const actorWorkspaceId = "00000000-0000-4000-8000-00000000b0a2";
  const runtimeSettings = settings({ DEFAULT_WORKSPACE_ID: actorWorkspaceId });
  const alice = user();
  const admin = user({
    id: "10000000-0000-4000-8000-000000000003",
    nickname: "admin",
    cookieToken: "cookie-admin",
    isAdmin: true
  });
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000043"
  });
  const run = await queue.enqueue({
    workItemId: "50000000-0000-4000-8000-000000000043",
    actorId: alice.id,
    workspaceId: runWorkspaceId,
    title: "Workspace A stream run"
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api/push",
    createPushRoutes({
      auth: deps([alice, admin], [], runtimeSettings),
      bus: new InProcessPushBus(),
      presence: new InMemoryPresenceStore(),
      agentRuns: queue,
      workItems: false,
      stream: { heartbeatMs: 20 }
    })
  );

  for (const token of [alice.cookieToken, admin.cookieToken]) {
    const response = await app.request(`/api/push/stream/run/${run.run_id}`, {
      headers: { Cookie: await signedCookie(token, runtimeSettings) }
    });
    assert.equal(response.status, 403, token);
  }
});

test("push route allows run streams for users who can open the backing work item", async () => {
  const runtimeSettings = settings();
  const alice = user();
  const collaborator = user({
    id: "10000000-0000-4000-8000-000000000004",
    nickname: "run-collaborator",
    cookieToken: "cookie-run-collaborator"
  });
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000042"
  });
  const runWorkItemId = "50000000-0000-4000-8000-000000000042";
  const run = await queue.enqueue({
    workItemId: runWorkItemId,
    actorId: alice.id,
    title: "Collaborative stream run"
  });
  const workItems = {
    async detailPage(input: Parameters<WorkItemService["detailPage"]>[0]) {
      if (input.workItemId !== runWorkItemId) {
        throw new WorkItemServiceError(404, "not_found", "missing");
      }
      if (input.actor.id !== collaborator.id && input.actor.id !== alice.id && !input.actor.isAdmin) {
        throw new WorkItemServiceError(403, "forbidden", "forbidden");
      }
      return {} as Awaited<ReturnType<WorkItemService["detailPage"]>>;
    }
  } as unknown as WorkItemService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api/push",
    createPushRoutes({
      auth: deps([alice, collaborator], [], runtimeSettings),
      bus: new InProcessPushBus(),
      presence: new InMemoryPresenceStore(),
      agentRuns: queue,
      workItems,
      stream: { heartbeatMs: 20 }
    })
  );

  const controller = new AbortController();
  const response = await app.request(`/api/push/stream/run/${run.run_id}`, {
    headers: { Cookie: await signedCookie(collaborator.cookieToken, runtimeSettings) },
    signal: controller.signal
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type")?.includes("text/event-stream"), true);
  controller.abort();
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

test("SSE connected frame is emitted only after the topic subscription is ready", async () => {
  const runtimeSettings = settings();
  const alice = user();
  class GatedSubscribeBus extends InProcessPushBus {
    public subscribeStarted = false;
    private releaseGate: (() => void) | undefined;
    private readonly gate = new Promise<void>((resolve) => {
      this.releaseGate = resolve;
    });

    override async subscribe(topic: string) {
      this.subscribeStarted = true;
      await this.gate;
      return super.subscribe(topic);
    }

    releaseSubscribe() {
      this.releaseGate?.();
    }
  }
  const bus = new GatedSubscribeBus();
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api/push",
    createPushRoutes({
      auth: deps([alice], [], runtimeSettings),
      bus,
      presence: new InMemoryPresenceStore(),
      access: { canViewWorkItem: async () => true },
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
  const reader = response.body!.getReader();
  const firstRead = reader.read();
  const early = await Promise.race([
    firstRead.then(() => "frame"),
    new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 20))
  ]);
  if (early !== "waiting") {
    await reader.cancel();
    controller.abort();
    assert.equal(early, "waiting");
  }
  assert.equal(bus.subscribeStarted, true);
  bus.releaseSubscribe();

  const first = new TextDecoder().decode((await firstRead).value ?? new Uint8Array());
  assert.match(first, /event: connected/u);
  await reader.cancel();
  controller.abort();
});

// 审计 FIX#24：心跳里的 presence.touchUser 是软状态续期，一次 Redis 抖动绝不能从心跳分支冒泡出 while
// → finally 拆掉一条健康 SSE 流（空闲连接每 ~30s 心跳一次，一次 presence 短暂故障会群体掉线）。
// 验证：touchUser 恒抛错时，流仍写出 connected 帧并继续心跳（: ping），不被终止。
test("FIX#24 a throwing presence.touchUser in the heartbeat does not terminate the SSE stream", async () => {
  const runtimeSettings = settings();
  const alice = user();
  class ThrowingTouchPresence extends InMemoryPresenceStore {
    override async touchUser() {
      throw new Error("redis presence blip");
    }
  }
  const presence = new ThrowingTouchPresence();
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api/push",
    createPushRoutes({
      auth: deps([alice], [], runtimeSettings),
      bus: new InProcessPushBus(),
      presence,
      access: { canViewWorkItem: async () => true },
      // 极小心跳 → 快速进入心跳分支（touchUser 在那里抛错）。
      stream: { heartbeatMs: 5 }
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

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  // 第一帧：connected（markStreamOpen 成功）。
  const first = decoder.decode((await reader.read()).value ?? new Uint8Array());
  assert.match(first, /event: connected/u);
  // 后续帧：心跳里的 touchUser 抛错被吞 → 流没被拆 → 仍写出 ping 注释。
  let sawPing = false;
  for (let i = 0; i < 5 && !sawPing; i += 1) {
    const chunk = decoder.decode((await reader.read()).value ?? new Uint8Array());
    if (chunk.includes(": ping")) {
      sawPing = true;
    }
  }
  assert.equal(sawPing, true);
  await reader.cancel();
  controller.abort();
});

test("SSE cleanup closes presence even when bus unsubscribe fails", async () => {
  const runtimeSettings = settings();
  const alice = user();
  class ThrowingUnsubscribeBus extends InProcessPushBus {
    override async unsubscribe(topic: string, subscription: Parameters<InProcessPushBus["unsubscribe"]>[1]) {
      await super.unsubscribe(topic, subscription);
      throw new Error("redis unsubscribe failed");
    }
  }
  class CountingPresence extends InMemoryPresenceStore {
    public closeCalls = 0;
    override async markStreamClosed(userId: string) {
      this.closeCalls += 1;
      await super.markStreamClosed(userId);
    }
  }
  const presence = new CountingPresence();
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api/push",
    createPushRoutes({
      auth: deps([alice], [], runtimeSettings),
      bus: new ThrowingUnsubscribeBus(),
      presence,
      access: { canViewWorkItem: async () => true },
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
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value ?? new Uint8Array());
  assert.match(first, /event: connected/u);

  await reader.cancel();
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(presence.closeCalls, 1);
});

// 审计 FIX#2：presence 续期 + 计数不变量。FIX#2(a) 的「活跃流 TTL 续期」bug 是 Redis 实现专属
// （InMemory 用内存计数、无 TTL，天然不掉线；真 Redis 续期行为由 r2-pg-redis-smoke 真库覆盖）。
// SSE 写循环按节流调用 presence.refreshStream 的接线见 sse/stream.ts（产线代码已审；其 HTTP 流式集成
// 在 app.request 测试夹具下读第二帧不可靠，故不在此用流式断言）。这里确定性验证两实现都暴露的不变量：
// refreshStream 续期使在线保持；FIX#2(b) markStreamClosed 多关一次绝不把计数打负、最终如期离线。
test("FIX#2 presence.refreshStream keeps an active user online and markStreamClosed never underflows", async () => {
  let clock = new Date("2026-06-19T00:00:00.000Z");
  const presence = new InMemoryPresenceStore(() => clock);
  const alice = user();

  await presence.markStreamOpen(alice.id);
  assert.equal((await presence.getPresence(alice.id)).is_online, true);
  // 时间推进到超过在线窗口后，refreshStream 续期使活跃用户仍判在线（不被误判离线）。
  clock = new Date(clock.getTime() + 5 * 60_000);
  await presence.refreshStream(alice.id);
  assert.equal((await presence.getPresence(alice.id)).is_online, true);

  // FIX#2(b) 计数不变量：开 1 次、关 2 次（模拟并发/重复关闭）不抛错、计数不为负。
  const bob = user({ id: "10000000-0000-4000-8000-0000000000b0", nickname: "Bob" });
  await presence.markStreamOpen(bob.id);
  await presence.markStreamClosed(bob.id);
  await presence.markStreamClosed(bob.id);
  // 时间推进过窗口：计数若被打负会让 is_online 永久卡 true；归零才会如期离线。
  clock = new Date(clock.getTime() + 5 * 60_000);
  assert.equal((await presence.getPresence(bob.id)).is_online, false);
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

// SEC P0（退出/撤销设备后已建立的 SSE 从不复检、继续灌旧账号事件）：开流时凭据有效，随后被撤销
// （这里模拟会话/cookie 撤销：重验时 findActiveByCookieToken 返回 null）——下一心跳节拍上重验发现授权已撤销，
// 流写一条 stream.revoked 终止事件并自行收尾。撤销前不复检就是缺陷；这条钉死"下一拍收尾"。
test("SEC P0 a revoked credential ends an established SSE on the next heartbeat with a stream.revoked event", async () => {
  const runtimeSettings = settings();
  const alice = user();
  class RevokingUsers extends MemoryUsers {
    public cookieLookups = 0;
    override async findActiveByCookieToken(cookieToken: string) {
      this.cookieLookups += 1;
      // 首次（开流鉴权）有效；之后（心跳重验）视为已登出/会话撤销 → 返回 null（resolveStreamUser 抛 401）。
      return this.cookieLookups <= 1 ? super.findActiveByCookieToken(cookieToken) : null;
    }
  }
  const revokingUsers = new RevokingUsers([alice]);
  const authDeps: AuthDependencies = {
    users: revokingUsers,
    devices: new MemoryDevices([]),
    settings: runtimeSettings,
    now: () => now
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api/push",
    createPushRoutes({
      auth: authDeps,
      bus: new InProcessPushBus(),
      presence: new InMemoryPresenceStore(),
      access: { canViewWorkItem: async () => true },
      // 心跳/重验都对齐到 20ms：开流后下一拍即重验，测试无需真的等 30s。
      stream: { heartbeatMs: 20 }
    })
  );

  const controller = new AbortController();
  const response = await app.request("/api/push/stream/me", {
    headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) },
    signal: controller.signal
  });
  assert.equal(response.status, 200);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  let ended = false;
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) {
      ended = true;
      break;
    }
    acc += decoder.decode(value ?? new Uint8Array());
    if (acc.includes("event: stream.revoked")) {
      // 收到终止事件后应自行收流：继续读到 done（服务端 break → finally 清理 → 流关闭）。
      while (Date.now() < deadline) {
        const tail = await reader.read();
        if (tail.done) {
          ended = true;
          break;
        }
      }
      break;
    }
  }

  assert.match(acc, /event: connected/u, "the stream opens normally while the credential is valid");
  assert.match(acc, /event: stream\.revoked/u, "a revoked credential must emit a stream.revoked terminator");
  assert.match(acc, /"reason":"credential_revoked"/u);
  assert.equal(ended, true, "the stream must close itself after emitting stream.revoked");
  // 至少重验过一次（开流 1 次 + 心跳重验 ≥1 次）。
  assert.ok(revokingUsers.cookieLookups >= 2, `expected a revalidation lookup, saw ${revokingUsers.cookieLookups}`);
  controller.abort();
});

// SEC P0 兜底：授权重验查询抖动（抛错）绝不能拆掉一条健康流——视为暂不可判定，保守继续。
test("SEC P0 a throwing grant revalidation does not tear down a healthy SSE stream", async () => {
  const runtimeSettings = settings();
  const alice = user();
  class BlippingUsers extends MemoryUsers {
    public cookieLookups = 0;
    override async findActiveByCookieToken(cookieToken: string) {
      this.cookieLookups += 1;
      // 首次开流成功；重验时抛非授权错误（DB 抖动）——stream.ts 应吞掉并继续，不写 stream.revoked。
      if (this.cookieLookups <= 1) {
        return super.findActiveByCookieToken(cookieToken);
      }
      throw new Error("cookie lookup database blip");
    }
  }
  const blippingUsers = new BlippingUsers([alice]);
  const authDeps: AuthDependencies = {
    users: blippingUsers,
    devices: new MemoryDevices([]),
    settings: runtimeSettings,
    now: () => now
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api/push",
    createPushRoutes({
      auth: authDeps,
      bus: new InProcessPushBus(),
      presence: new InMemoryPresenceStore(),
      access: { canViewWorkItem: async () => true },
      stream: { heartbeatMs: 20 }
    })
  );

  const controller = new AbortController();
  const response = await app.request("/api/push/stream/me", {
    headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) },
    signal: controller.signal
  });
  assert.equal(response.status, 200);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  // 读若干拍：应看到 connected + 心跳 ping，不该出现 stream.revoked（抖动被吞、流继续）。
  for (let i = 0; i < 4; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    acc += decoder.decode(value ?? new Uint8Array());
  }
  assert.match(acc, /event: connected/u);
  assert.doesNotMatch(acc, /stream\.revoked/u, "a transient revalidation error must not terminate the stream");
  assert.ok(blippingUsers.cookieLookups >= 2, "revalidation must have actually run");
  await reader.cancel();
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
    mutedNotificationTypes: [],
    avatarWebp: null,
    avatarUpdatedAt: null,
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
