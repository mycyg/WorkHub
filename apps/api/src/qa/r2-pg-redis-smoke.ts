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
  createCredentialRepository,
  createDatabaseClient,
  createInviteRepository,
  createSessionRepository,
  createUserRepository,
  createWorkItemRepository,
  createWorkspaceMembershipRepository,
  defaultSeedFixture,
  defaultSeedIds,
  generateSessionToken,
  hashSessionToken,
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

import { currentPasswordAlgo, hashPassword, verifyPassword } from "../auth/password.js";
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

    // findings[#low]：并发首登同 nickname 不应 500——onConflictDoNothing 让输者复用赢者的行。
    const raceNickname = "Concurrent Race User";
    const [raceA, raceB] = await Promise.all([
      auth.users.getOrCreateActiveByNickname(raceNickname, "race-cookie-token-a"),
      auth.users.getOrCreateActiveByNickname(raceNickname, "race-cookie-token-b")
    ]);
    assert.equal(raceA.user.id, raceB.user.id, "concurrent first-login resolves to one user row");
    assert.equal(raceA.created !== raceB.created, true, "exactly one concurrent caller is the creator");

    // R2 auth epic：凭据 + 会话 DB 层真 PG 往返（2a/3a 仓库此前仅假数据单测，这里首次过真 Postgres + citext）。
    {
      const credentials = createCredentialRepository(db);
      const sessionRepo = createSessionRepository(db);
      const authUserId = randomUUID();
      // 故意大写 email → 验 citext 列大小写不敏感唯一 + 等值查找。
      const email = `R2.Auth+${authUserId.slice(0, 8)}@Example.com`;
      await db
        .insert(users)
        .values({
          id: authUserId,
          nickname: `r2-auth-${authUserId.slice(0, 8)}`,
          cookieToken: `r2-auth-cookie-${randomUUID()}`,
          availabilityStatus: "free",
          isAdmin: false
        })
        .onConflictDoNothing();

      const passwordHash = await hashPassword("r2-smoke-passphrase");
      const created = await credentials.createCredential({
        userId: authUserId,
        email,
        passwordHash,
        passwordAlgo: currentPasswordAlgo()
      });
      assert.equal(created.userId, authUserId);

      const byLower = await credentials.findByEmail(email.toLowerCase());
      assert.ok(byLower, "citext email lookup must be case-insensitive");
      assert.equal(byLower.id, created.id);
      assert.equal(await verifyPassword("r2-smoke-passphrase", byLower.passwordHash ?? ""), true);
      assert.equal(await verifyPassword("wrong-passphrase", byLower.passwordHash ?? ""), false);

      await credentials.recordFailedAttempt(authUserId);
      const afterFail = await credentials.findByUserId(authUserId);
      assert.equal(afterFail?.failedAttempts, 1, "recordFailedAttempt should increment");
      await credentials.resetFailedAttempts(authUserId);
      const afterReset = await credentials.findByUserId(authUserId);
      assert.equal(afterReset?.failedAttempts, 0, "resetFailedAttempts should clear");

      const nowAt = new Date();
      const secret = generateSessionToken();
      const absoluteExpiresAt = new Date(nowAt.getTime() + 3_600_000);
      const idleExpiresAt = new Date(nowAt.getTime() + 1_800_000);
      const session = await sessionRepo.create({
        userId: authUserId,
        tokenHash: hashSessionToken(secret),
        authMethod: "password",
        absoluteExpiresAt,
        idleExpiresAt
      });
      const resolved = await sessionRepo.findActiveByTokenHash(hashSessionToken(secret), nowAt);
      assert.ok(resolved, "active session should resolve by token hash");
      assert.equal(resolved.id, session.id);

      const slid = await sessionRepo.touch(session.id, new Date(nowAt.getTime() + 2_400_000), nowAt);
      assert.ok(slid && slid.idleExpiresAt.getTime() > idleExpiresAt.getTime(), "touch should slide idle expiry forward");

      await sessionRepo.revoke(session.id, new Date());
      const afterRevoke = await sessionRepo.findActiveByTokenHash(hashSessionToken(secret), new Date());
      assert.equal(afterRevoke, null, "revoked session must not resolve");

      // 绝对过期的死会话 → deleteExpired 清掉。
      await sessionRepo.create({
        userId: authUserId,
        tokenHash: hashSessionToken(generateSessionToken()),
        authMethod: "password",
        absoluteExpiresAt: new Date(nowAt.getTime() - 3_600_000),
        idleExpiresAt: new Date(nowAt.getTime() - 1_800_000)
      });
      const swept = await sessionRepo.deleteExpired(new Date());
      assert.ok(swept >= 1, "deleteExpired should remove absolutely-expired sessions");

      // 再建一个 active 会话 → revokeAllForUser 全撤（停用/全设备登出）。
      await sessionRepo.create({
        userId: authUserId,
        tokenHash: hashSessionToken(generateSessionToken()),
        authMethod: "password",
        absoluteExpiresAt,
        idleExpiresAt
      });
      const revokedCount = await sessionRepo.revokeAllForUser(authUserId, new Date());
      assert.ok(revokedCount >= 1, "revokeAllForUser should revoke remaining active sessions");

      console.log("[r2-pg-redis-smoke] credential + session DB layer round-trip ok");
    }

    // R2 多租户 epic Phase 1：工作区成员 partial-unique 真 PG 往返（一用户一默认 + 一(ws,user)一 active + 软删释放）。
    {
      const memberships = createWorkspaceMembershipRepository(db);
      const memberUserId = randomUUID();
      await db
        .insert(users)
        .values({
          id: memberUserId,
          nickname: `r2-member-${memberUserId.slice(0, 8)}`,
          cookieToken: `r2-member-cookie-${randomUUID()}`,
          availabilityStatus: "free",
          isAdmin: false
        })
        .onConflictDoNothing();
      const ws = settings.auth.defaultWorkspaceId;

      const m1 = await memberships.create({ workspaceId: ws, userId: memberUserId, role: "owner", defaultWorkspace: true });
      assert.equal(m1.defaultWorkspace, true);
      const resolvedDefault = await memberships.resolveDefaultWorkspace(memberUserId);
      assert.ok(resolvedDefault && resolvedDefault.id === m1.id, "default membership resolves");

      let secondDefaultRejected = false;
      try {
        await memberships.create({ workspaceId: ws, userId: memberUserId, role: "member", defaultWorkspace: true });
      } catch {
        secondDefaultRejected = true;
      }
      assert.equal(secondDefaultRejected, true, "one default workspace per user is enforced");

      // soft-delete 释放 (ws,user) + default 的 partial unique → 可重新加入。
      await memberships.softDelete(m1.id, new Date());
      const rejoin = await memberships.create({ workspaceId: ws, userId: memberUserId, role: "member", defaultWorkspace: true });
      assert.ok(rejoin.id !== m1.id, "soft-delete frees the unique so the member can rejoin");
      assert.equal((await memberships.listForUser(memberUserId)).length, 1, "only the active membership is listed");

      // Phase 2：resolveDefaultTenant 读成员行的工作区(+其 org)，而非写死常量——用一个非默认工作区证明区分。
      const otherWorkspaceId = randomUUID();
      await db
        .insert(workspaces)
        .values({
          id: otherWorkspaceId,
          orgId: settings.auth.defaultOrgId,
          name: "R2 tenancy second workspace",
          slug: `r2-ws-${otherWorkspaceId.slice(0, 8)}`
        })
        .onConflictDoNothing();
      const tenantUserId = randomUUID();
      await db
        .insert(users)
        .values({
          id: tenantUserId,
          nickname: `r2-tenant-${tenantUserId.slice(0, 8)}`,
          cookieToken: `r2-tenant-cookie-${randomUUID()}`,
          availabilityStatus: "free",
          isAdmin: false
        })
        .onConflictDoNothing();
      await memberships.create({ workspaceId: otherWorkspaceId, userId: tenantUserId, role: "owner", defaultWorkspace: true });
      const resolvedTenant = await memberships.resolveDefaultTenant(tenantUserId);
      assert.ok(resolvedTenant, "default tenant resolves for a member");
      assert.equal(resolvedTenant.workspaceId, otherWorkspaceId, "tenant comes from the membership's workspace, not the constant");
      assert.equal(resolvedTenant.orgId, settings.auth.defaultOrgId, "org is derived via the workspaces join");
      assert.equal(await memberships.resolveDefaultTenant(randomUUID()), null, "no membership → null (caller falls back to constant)");

      console.log("[r2-pg-redis-smoke] workspace membership partial-unique + tenant resolution round-trip ok");
    }

    // R2 auth epic（邀请）：邀请 DB 层真 PG 往返（create→token 解析→接受墓碑→已用/过期均解析不到）。
    {
      const invites = createInviteRepository(db);
      const inviteToken = hashSessionToken(generateSessionToken()); // 复用 sha256 哈希作为 token_hash
      const inviteNow = new Date();
      const created = await invites.create({
        email: "Invitee@Example.com", // 大写验 citext
        tokenHash: inviteToken,
        role: "member",
        expiresAt: new Date(inviteNow.getTime() + 86_400_000)
      });
      assert.equal(created.acceptedAt, null);

      const active = await invites.findActiveByTokenHash(inviteToken, inviteNow);
      assert.ok(active && active.id === created.id, "active invite resolves by token hash");
      assert.equal((await invites.listPendingForEmail("invitee@example.com")).length, 1, "citext pending lookup");

      // 接受 → 记墓碑 → 不能再解析（防重复使用）。
      const acceptUserId = randomUUID();
      await db
        .insert(users)
        .values({
          id: acceptUserId,
          nickname: `r2-invitee-${acceptUserId.slice(0, 8)}`,
          cookieToken: `r2-invitee-cookie-${randomUUID()}`,
          availabilityStatus: "free",
          isAdmin: false
        })
        .onConflictDoNothing();
      const accepted = await invites.accept(created.id, acceptUserId, new Date());
      assert.ok(accepted && accepted.acceptedUserId === acceptUserId, "invite accepted records the new user");
      assert.equal(await invites.findActiveByTokenHash(inviteToken, new Date()), null, "used invite no longer resolves");

      // 过期邀请解析不到。
      const expiredToken = hashSessionToken(generateSessionToken());
      await invites.create({
        email: "expired@example.com",
        tokenHash: expiredToken,
        role: "member",
        expiresAt: new Date(inviteNow.getTime() - 1000)
      });
      assert.equal(await invites.findActiveByTokenHash(expiredToken, new Date()), null, "expired invite does not resolve");

      console.log("[r2-pg-redis-smoke] user invite round-trip ok");
    }

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
