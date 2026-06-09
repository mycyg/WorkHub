import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentLoopClient } from "@workhub/agent/loop";
import { loadSettings } from "@workhub/config";
import {
  agentRuns,
  createAgentRunRepository,
  createClientDeviceRepository,
  createDatabaseClient,
  createUserRepository,
  createWorkItemRepository,
  defaultSeedFixture,
  defaultSeedIds,
  orgs,
  projects,
  runMigrations,
  users,
  workItems,
  workspaces
} from "@workhub/db";
import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { RedisPresenceStore, RedisPushBus } from "../broker/index.js";
import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import { createPushRoutes } from "../routes/push.js";
import { createDbAgentRunPersistence } from "../services/agent-run-persistence.js";
import { createDbWorkItemService } from "../services/work-items.js";
import { createInMemoryAgentRunQueue } from "../workers/agent-runner.js";

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

async function ensureDefaultSeed(db: ReturnType<typeof createDatabaseClient>["db"]) {
  await db.insert(orgs).values(defaultSeedFixture.orgs).onConflictDoNothing();
  await db.insert(workspaces).values(defaultSeedFixture.workspaces).onConflictDoNothing();
  await db.insert(users).values(defaultSeedFixture.users).onConflictDoNothing();
  await db.insert(projects).values(defaultSeedFixture.projects).onConflictDoNothing();
}

function delayedFinalClient(release: Promise<void>): AgentLoopClient {
  return {
    model: "deepseek-v4-flash",
    messages: {
      async create() {
        await release;
        return {
          id: "msg-r2-pg-redis-long-provider",
          stopReason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
          usageRecord: {
            provider: "deepseek",
            model: "deepseek-v4-flash",
            task: "worker",
            inputTokens: 1,
            outputTokens: 1,
            estimatedCostCny: "0.001",
            source: "agent_step",
            createdAt: new Date().toISOString()
          },
          content: [{ type: "text", text: "R2 PG Redis smoke done" }]
        };
      }
    }
  };
}

async function waitFor<T>(read: () => Promise<T | null | undefined>, label: string, timeoutMs = 5000) {
  const started = Date.now();
  let latest: T | null | undefined;
  while (Date.now() - started < timeoutMs) {
    latest = await read();
    if (latest) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}; latest=${JSON.stringify(latest)}`);
}

async function main() {
  const settings = loadSettings(process.env);
  if (settings.appEnv === "production") {
    throw new Error("Refusing to run R2 PG Redis smoke in production.");
  }
  if (settings.broker.backend !== "redis") {
    throw new Error("R2 PG Redis smoke requires BROKER_BACKEND=redis.");
  }

  await runMigrations(settings);
  const client = createDatabaseClient(settings);
  const redisBusA = new RedisPushBus(settings.broker.url);
  const redisBusB = new RedisPushBus(settings.broker.url);
  const redisPresenceA = new RedisPresenceStore(settings.broker.url);
  const redisPresenceB = new RedisPresenceStore(settings.broker.url);
  const routeBus = new RedisPushBus(settings.broker.url);
  const routePresence = new RedisPresenceStore(settings.broker.url);

  try {
    const db = client.db;
    await ensureDefaultSeed(db);

    const ownerId = randomUUID();
    const strangerId = randomUUID();
    const ownerCookieToken = `r2-owner-${randomUUID()}`;
    const strangerCookieToken = `r2-stranger-${randomUUID()}`;
    await db.insert(users).values([
      {
        id: ownerId,
        nickname: `r2-owner-${ownerId.slice(0, 8)}`,
        cookieToken: ownerCookieToken,
        availabilityStatus: "free",
        isAdmin: false
      },
      {
        id: strangerId,
        nickname: `r2-stranger-${strangerId.slice(0, 8)}`,
        cookieToken: strangerCookieToken,
        availabilityStatus: "free",
        isAdmin: false
      }
    ]).onConflictDoNothing();

    const workItemId = randomUUID();
    await db.insert(workItems).values({
      id: workItemId,
      code: `R2R-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      projectId: defaultSeedIds.projectId,
      workspaceId: settings.auth.defaultWorkspaceId,
      submitterUserId: ownerId,
      title: "R2 PG Redis smoke work item",
      rawDescription: "Validates Redis broker, resource topic resolver, and long provider heartbeat.",
      summaryMd: "R2 PG Redis smoke.",
      status: "spec_ready",
      mode: "worker"
    });

    const redisTopic = `r2-smoke:${randomUUID()}`;
    const redisSubscription = await redisBusB.subscribe(redisTopic);
    let redisEvent: { topic: string; type: string; data: unknown };
    try {
      const redisIterator = redisSubscription[Symbol.asyncIterator]();
      await redisBusA.publish(redisTopic, "r2.smoke", { ok: true });
      const result = await Promise.race([
        redisIterator.next(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Timed out waiting for Redis event on ${redisTopic}`)), 3000);
        })
      ]);
      if (result.done) {
        throw new Error(`Redis subscription closed before event on ${redisTopic}`);
      }
      redisEvent = result.value;
      assert.equal(redisEvent.topic, redisTopic);
      assert.equal(redisEvent.type, "r2.smoke");
    } finally {
      await redisBusB.unsubscribe(redisTopic, redisSubscription);
    }

    await redisPresenceA.markStreamOpen(ownerId);
    const presence = await redisPresenceB.getPresence(ownerId);
    assert.equal(presence.is_online, true);

    const auth: AuthDependencies = {
      users: createUserRepository(db),
      devices: createClientDeviceRepository(db),
      settings
    };
    const workItemService = createDbWorkItemService(createWorkItemRepository(db));
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api/push", createPushRoutes({
      auth,
      bus: routeBus,
      presence: routePresence,
      workItems: workItemService,
      proposals: false,
      stream: { heartbeatMs: 20 }
    }));

    const ownerCookie = await generateSignedCookie(COOKIE_NAME, ownerCookieToken, settings.auth.cookieSecret);
    const ownerController = new AbortController();
    const ownerStream = await app.request(`/api/push/stream/workitem/${workItemId}`, {
      headers: { Cookie: ownerCookie },
      signal: ownerController.signal
    });
    assert.equal(ownerStream.status, 200);
    assert.equal(ownerStream.headers.get("content-type")?.includes("text/event-stream"), true);
    ownerController.abort();

    const strangerCookie = await generateSignedCookie(COOKIE_NAME, strangerCookieToken, settings.auth.cookieSecret);
    const strangerStream = await app.request(`/api/push/stream/workitem/${workItemId}`, {
      headers: { Cookie: strangerCookie }
    });
    assert.equal(strangerStream.status, 403);

    let releaseProvider!: () => void;
    const releasePromise = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const agentRunRepo = createAgentRunRepository(db);
    const queue = createInMemoryAgentRunQueue({
      settings,
      workerId: "r2-pg-redis-worker",
      leaseMs: 500,
      heartbeatIntervalMs: 50,
      workdir: () => mkdtemp(path.join(os.tmpdir(), "workhub-r2-pg-redis-agent-")),
      client: () => delayedFinalClient(releasePromise),
      persistence: createDbAgentRunPersistence(agentRunRepo),
      confidence: false,
      humanReserved: false,
      proposals: false,
      notifications: false,
      eventBus: false,
      requireDeliverable: false
    });
    const queued = await queue.enqueue({
      workItemId,
      actorId: ownerId,
      title: "R2 long provider heartbeat smoke"
    });
    const running = queue.runNext();
    const heartbeatRow = await waitFor(async () => {
      const row = (await db.select().from(agentRuns)).find((candidate) => candidate.id === queued.run_id);
      if (!row?.claimedAt || !row.heartbeatAt || row.heartbeatAt.getTime() <= row.claimedAt.getTime()) {
        return null;
      }
      return row;
    }, "long provider heartbeat");
    releaseProvider();
    const executed = await running;
    assert.equal(executed?.status, "succeeded");

    const summary = {
      ok: true,
      database_url: settings.databaseUrl.replace(/:\/\/([^:]+):([^@]+)@/u, "://$1:***@"),
      broker_backend: settings.broker.backend,
      redis_event_type: redisEvent.type,
      presence_online: presence.is_online,
      work_item_stream_owner_status: ownerStream.status,
      work_item_stream_stranger_status: strangerStream.status,
      long_provider_heartbeat_at: heartbeatRow.heartbeatAt?.toISOString(),
      long_provider_claimed_at: heartbeatRow.claimedAt?.toISOString(),
      run_status: executed?.status
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await Promise.allSettled([
      redisBusA.close(),
      redisBusB.close(),
      redisPresenceA.close(),
      redisPresenceB.close(),
      routeBus.close(),
      routePresence.close()
    ]);
    await client.close();
  }
}

await main();
