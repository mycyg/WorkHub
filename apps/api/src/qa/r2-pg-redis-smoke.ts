import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentLoopClient } from "@workhub/agent/loop";
import { loadSettings } from "@workhub/config";
import {
  agentRuns,
  approvalComments,
  approvalRequests,
  createAgentRunRepository,
  createApprovalCommentRepository,
  createClientDeviceRepository,
  createCredentialRepository,
  createDatabaseClient,
  createConversationRepository,
  createDriveRepository,
  createInviteRepository,
  createProjectRepository,
  createSessionRepository,
  createUserRepository,
  createWorkItemRepository,
  createWorkspaceMembershipRepository,
  defaultSeedFixture,
  defaultSeedIds,
  generateSessionToken,
  hashSessionToken,
  orgs,
  projectDriveComments,
  projectDriveItems,
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

    // 项目主页(/projects/:id)后端 S1：listOpenByProject 返回该项目的进行中工作项(spec_ready 非终态)，
    // 且严格按项目隔离(别的项目 id 拿不到本项目的事项)。
    {
      const workItemRepo = createWorkItemRepository(db);
      const openItems = await workItemRepo.listOpenByProject(defaultSeedIds.projectId);
      assert.ok(openItems.some((item) => item.id === workItemId), "listOpenByProject returns the project's open work item");
      assert.ok(openItems.every((item) => typeof item.code === "string"), "listOpenByProject rows carry code/title/status");
      const otherProjectItems = await workItemRepo.listOpenByProject(randomUUID());
      assert.equal(otherProjectItems.length, 0, "listOpenByProject is scoped to the requested project");
      // countOpenByProject 与清单同口径(非终态/未删除)、同项目隔离：主页头部计数即便清单被 limit 截断也准确。
      const openCount = await workItemRepo.countOpenByProject(defaultSeedIds.projectId);
      assert.ok(openCount >= 1, "countOpenByProject counts the project's open work items");
      assert.ok(openCount >= openItems.length, "countOpenByProject is the uncapped total (>= shown list)");
      assert.equal(await workItemRepo.countOpenByProject(randomUUID()), 0, "countOpenByProject is project-scoped");
      // 项目主页文件卡(S4a)：最近文件清单 + 真实文件总数，同项目隔离、同口径(只数文件非文件夹/未删)。
      const driveRepoForHub = createDriveRepository(db);
      const recentFiles = await driveRepoForHub.listRecentFilesByProject(defaultSeedIds.projectId, 5);
      assert.ok(Array.isArray(recentFiles), "listRecentFilesByProject returns an array");
      assert.ok(recentFiles.every((f) => typeof f.name === "string" && f.id), "recent file rows carry id/name/updatedAt");
      const fileCount = await driveRepoForHub.countFilesByProject(defaultSeedIds.projectId);
      assert.ok(fileCount >= recentFiles.length, "countFilesByProject is the uncapped total (>= shown)");
      assert.equal(await driveRepoForHub.countFilesByProject(randomUUID()), 0, "countFilesByProject is project-scoped");
      console.log("[r2-pg-redis-smoke] listOpenByProject + countOpenByProject + drive files (project hub S1/S4a) ok");
    }

    {
      const approvalId = randomUUID();
      await db.insert(approvalRequests).values({
        id: approvalId,
        actionPattern: "tool.publish_external",
        payloadJson: { raw_args: { smoke: "approval-comment-latest-window" } },
        status: "pending",
        routedToUserId: ownerId
      });
      const comments = Array.from({ length: 25 }, (_, index) => ({
        id: randomUUID(),
        approvalId,
        authorUserId: ownerId,
        authorNickname: "R2 Owner",
        body: `approval comment ${String(index + 1).padStart(2, "0")}`,
        createdAt: new Date(Date.UTC(2026, 6, 2, 0, index, 0)),
        updatedAt: new Date(Date.UTC(2026, 6, 2, 0, index, 0))
      }));
      await db.insert(approvalComments).values(comments);
      const commentRepo = createApprovalCommentRepository(db);
      const bulkLatest = await commentRepo.listByApprovals([approvalId], 20);
      const singleLatest = await commentRepo.listByApproval(approvalId, 20);

      assert.equal(bulkLatest.length, 20, "approval comment bulk prefetch returns the capped latest window");
      assert.equal(bulkLatest[0]?.body, "approval comment 06", "bulk prefetch displays the latest window in chronological order");
      assert.equal(bulkLatest.at(-1)?.body, "approval comment 25", "bulk prefetch keeps newest approval comments visible");
      assert.equal(singleLatest.length, 20, "single approval comment list returns the capped latest window");
      assert.equal(singleLatest[0]?.body, "approval comment 06", "single comment list displays the latest window in chronological order");
      assert.equal(singleLatest.at(-1)?.body, "approval comment 25", "single comment list keeps newest approval comments visible");
      console.log("[r2-pg-redis-smoke] approval comment latest-window repository reads ok");
    }

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

    // R2 audit#5：findRefsByIds 必须含已软删者（带 deletedAt），区分「活跃 / 已停用 / 不存在」——
    // 这是把已停用收件人从里程碑通知里剔除的真库依据（lifecycle userIsActive 据 deletedAt 判定）。
    {
      const activeId = raceA.user.id;
      const deactivated = await auth.users.getOrCreateActiveByNickname(
        `Deactivated Recipient ${randomUUID().slice(0, 8)}`,
        `deactivated-cookie-${randomUUID()}`
      );
      const softDeleted = await auth.users.softDelete?.(deactivated.user.id, activeId, new Date());
      assert.ok(softDeleted, "softDelete must return the retired row");
      assert.ok(softDeleted.deletedAt, "soft-deleted user carries a deletedAt");

      const missingId = randomUUID();
      const refs = await auth.users.findRefsByIds?.([activeId, deactivated.user.id, missingId]);
      assert.ok(refs, "findRefsByIds must be implemented on the real repo");
      const byId = new Map(refs.map((ref) => [ref.id, ref.deletedAt]));
      assert.equal(byId.get(activeId), null, "active recipient has null deletedAt (kept)");
      assert.ok(byId.get(deactivated.user.id), "deactivated recipient carries deletedAt (dropped)");
      assert.equal(byId.has(missingId), false, "absent ids are omitted → fail-open as active");
    }

    // R2 audit#21：父文件夹删除 vs 并发子项上传——uploadFile/softDeleteItem 都对父行 FOR UPDATE 串行化,
    // 绝不留「活跃子项挂在已删父下」的孤儿。无锁时两事务可同时提交(=孤儿,fulfilled=2);加锁后恰好一胜一负。
    {
      const drive = createDriveRepository(db);
      const folderId = randomUUID();
      const nowAt = new Date();
      await db.insert(projectDriveItems).values({
        id: folderId,
        projectId: defaultSeedIds.projectId,
        parentId: null,
        name: `race-folder-${folderId.slice(0, 8)}`,
        kind: "folder",
        createdByUserId: raceA.user.id,
        updatedByUserId: raceA.user.id,
        createdAt: nowAt,
        updatedAt: nowAt
      });
      const [uploadOutcome, deleteOutcome] = await Promise.allSettled([
        drive.uploadFile({
          actorKind: "human",
          actorUserId: raceA.user.id,
          projectId: defaultSeedIds.projectId,
          parentId: folderId,
          filename: `race-child-${randomUUID().slice(0, 8)}.md`,
          sizeBytes: 12
        }),
        drive.softDeleteItem({
          actorKind: "human",
          actorUserId: raceA.user.id,
          projectId: defaultSeedIds.projectId,
          itemId: folderId
        })
      ]);
      const fulfilled = [uploadOutcome, deleteOutcome].filter((outcome) => outcome.status === "fulfilled").length;
      // 恰好一个赢得父行锁:不可能既上传成功又删父成功(那即孤儿)。无 FOR UPDATE 时此处会是 2。
      assert.equal(fulfilled, 1, "exactly one of {child upload, parent soft-delete} may win the parent-row lock (no orphan)");
      const loser = uploadOutcome.status === "rejected"
        ? uploadOutcome.reason
        : deleteOutcome.status === "rejected"
          ? deleteOutcome.reason
          : undefined;
      const loserCode = (loser as { code?: string } | undefined)?.code;
      // 输者必须从被锁路径以预期冲突码回退:删父先赢→上传报 parent_deleted;上传先赢→删父报 folder_not_empty。
      assert.ok(
        loserCode === "drive_parent_deleted" || loserCode === "drive_folder_not_empty",
        `parent-folder race loser must reject through the locked path, got code=${String(loserCode)}`
      );
    }

    // findings[#22/#24 后继]：draft→proposal 跨服务写入幂等——并发/重试不得写重复 operation/audit。
    // 真库验证 recordDraftProposal 的幂等闸：种一条已建草稿的评论，用同一 proposalId 调两次，
    // 断言恰好留一条 draft_to_proposal operation + 一套 proposal/comment audit（而非两套）。
    {
      const drive = createDriveRepository(db);
      const draftWorkItemId = randomUUID();
      const draftCommentId = randomUUID();
      const draftProposalId = randomUUID();
      const nowAt = new Date();
      await db.insert(workItems).values({
        id: draftWorkItemId,
        code: `R2R-DP-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
        projectId: defaultSeedIds.projectId,
        workspaceId: settings.auth.defaultWorkspaceId,
        submitterUserId: raceA.user.id,
        title: "Drive draft→proposal idempotency smoke",
        rawDescription: "Seed a drive-comment draft to exercise recordDraftProposal idempotency.",
        summaryMd: "Drive draft→proposal idempotency smoke.",
        status: "ai_clarifying",
        mode: "worker"
      });
      await db.insert(projectDriveComments).values({
        id: draftCommentId,
        projectId: defaultSeedIds.projectId,
        folderId: null,
        authorUserId: raceA.user.id,
        authorNickname: "smoke",
        body: "Turn this drive comment into a proposal draft.",
        status: "draft_created",
        draftWorkItemId,
        createdAt: nowAt,
        updatedAt: nowAt
      });

      const recordInput = {
        actorKind: "human" as const,
        actorUserId: raceA.user.id,
        workItemId: draftWorkItemId,
        proposalId: draftProposalId
      };
      const firstRecord = await drive.recordDraftProposal(recordInput);
      assert.equal(firstRecord?.comment.status, "proposal_created", "first recordDraftProposal flips the comment to proposal_created");
      // 第二次（模拟并发/重试或 service self-heal 再调）必须是安全 no-op。
      const secondRecord = await drive.recordDraftProposal(recordInput);
      assert.equal(secondRecord?.comment.status, "proposal_created", "idempotent re-run still returns the proposal_created comment");

      // readPage 暴露真库 operations——据此断言 draft_to_proposal 只落了一条（而非每次调用各一条）。
      // operation 与两条 audit 同处幂等闸之后的同一代码块顺序执行：operation 不重复 ⇒ audit 也不重复。
      const driveAfter = await drive.readPage({
        projectId: defaultSeedIds.projectId,
        operationLimit: 100
      });
      const matchingOps = driveAfter.operations.filter((op) => {
        const payload = op.payloadJson as Record<string, unknown>;
        return op.opType === "draft_to_proposal"
          && payload.work_item_id === draftWorkItemId
          && payload.proposal_id === draftProposalId;
      });
      assert.equal(matchingOps.length, 1, "recordDraftProposal must write exactly ONE draft_to_proposal operation, not duplicate on re-run");
      const reloadedComment = driveAfter.comments.find((comment) => comment.id === draftCommentId);
      assert.equal(reloadedComment?.status, "proposal_created", "the seeded comment is left at proposal_created (residual draft_created healed)");
    }

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

    // R11 Batch 0：委派成员目录必须由真 PG 的 workspace_memberships join 隔离，并同时过滤
    // membership/user 软删墓碑；不能把全局活跃用户当作当前工作区候选人。
    {
      const userRepo = createUserRepository(db);
      const memberships = createWorkspaceMembershipRepository(db);
      const actorWorkspaceId = settings.auth.defaultWorkspaceId;
      const otherWorkspaceId = randomUUID();
      await db
        .insert(workspaces)
        .values({
          id: otherWorkspaceId,
          orgId: settings.auth.defaultOrgId,
          name: "R11 member directory isolation workspace",
          slug: `r11-directory-${otherWorkspaceId.slice(0, 8)}`
        })
        .onConflictDoNothing();

      const included = await userRepo.createUser({
        nickname: `r11-directory-in-${randomUUID().slice(0, 8)}`,
        cookieToken: `r11-directory-in-${randomUUID()}`
      });
      const otherWorkspaceUser = await userRepo.createUser({
        nickname: `r11-directory-other-${randomUUID().slice(0, 8)}`,
        cookieToken: `r11-directory-other-${randomUUID()}`
      });
      const deletedMembershipUser = await userRepo.createUser({
        nickname: `r11-directory-deleted-membership-${randomUUID().slice(0, 8)}`,
        cookieToken: `r11-directory-deleted-membership-${randomUUID()}`
      });
      const deletedUser = await userRepo.createUser({
        nickname: `r11-directory-deleted-user-${randomUUID().slice(0, 8)}`,
        cookieToken: `r11-directory-deleted-user-${randomUUID()}`
      });

      await memberships.create({ workspaceId: actorWorkspaceId, userId: included.id });
      await memberships.create({ workspaceId: otherWorkspaceId, userId: otherWorkspaceUser.id });
      const deletedMembership = await memberships.create({
        workspaceId: actorWorkspaceId,
        userId: deletedMembershipUser.id
      });
      await memberships.softDelete(deletedMembership.id, new Date());
      await memberships.create({ workspaceId: actorWorkspaceId, userId: deletedUser.id });
      const softDeleteUser = userRepo.softDelete;
      assert.ok(softDeleteUser, "user repository exposes softDelete for the real-PG fixture");
      assert.ok(
        await softDeleteUser.call(userRepo, deletedUser.id, ownerId, new Date()),
        "soft-deleted user fixture was updated"
      );

      const listActiveRefsForWorkspace = userRepo.listActiveRefsForWorkspace;
      assert.ok(listActiveRefsForWorkspace, "user repository exposes the workspace-scoped directory query");
      const refs = await listActiveRefsForWorkspace.call(userRepo, actorWorkspaceId);
      const visibleIds = new Set(refs.map((ref) => ref.id));
      assert.equal(visibleIds.has(included.id), true, "active member in the actor workspace is included");
      assert.equal(
        visibleIds.has(otherWorkspaceUser.id),
        false,
        "active user who is only a member of another workspace is excluded"
      );
      assert.equal(
        visibleIds.has(deletedMembershipUser.id),
        false,
        "user whose actor-workspace membership is soft-deleted is excluded"
      );
      assert.equal(visibleIds.has(deletedUser.id), false, "soft-deleted user with an active membership is excluded");

      console.log("[r2-pg-redis-smoke] workspace-scoped active member directory isolation ok");
    }

    // rank1（R8 深复审）：项目 create-or-reuse 必须按工作区隔离——同 slug 在不同工作区是不同项目，
    // 不能把 B 工作区的请求命中并返回 A 工作区的项目（跨租户串号/泄漏）；同工作区同 slug 才复用。
    // 该断言依赖迁移 0028 把 projects_slug_uq 改成 (workspace_id, slug)；旧全局唯一索引下 inB 的插入会撞唯一抛错。
    {
      const projectRepo = createProjectRepository(db);
      const wsA = settings.auth.defaultWorkspaceId;
      const wsB = randomUUID();
      await db
        .insert(workspaces)
        .values({
          id: wsB,
          orgId: settings.auth.defaultOrgId,
          name: "R2 project-isolation workspace",
          slug: `r2-pj-${wsB.slice(0, 8)}`
        })
        .onConflictDoNothing();
      const sharedSlug = `shared-${randomUUID().slice(0, 8)}`;
      const bootstrapArgs = (workspaceId: string) => ({
        orgId: settings.auth.defaultOrgId,
        workspaceId,
        name: "Shared name",
        slug: sharedSlug,
        ownerNickname: "r2",
        ownerUserId: ownerId
      });
      const inA = await projectRepo.bootstrapPilotProject(bootstrapArgs(wsA));
      const inB = await projectRepo.bootstrapPilotProject(bootstrapArgs(wsB));
      assert.equal(inA.created, true, "first create in workspace A is a real create");
      assert.equal(inB.created, true, "same slug in a different workspace creates a separate project (no cross-workspace reuse)");
      assert.notEqual(inA.project.id, inB.project.id, "cross-workspace same-slug projects are distinct rows");
      assert.equal(inB.project.workspaceId, wsB, "the workspace-B project belongs to workspace B");
      const reuseA = await projectRepo.bootstrapPilotProject(bootstrapArgs(wsA));
      assert.equal(reuseA.created, false, "same slug in the same workspace reuses");
      assert.equal(reuseA.project.id, inA.project.id, "reuse returns the same project row");
      console.log("[r2-pg-redis-smoke] project create-or-reuse is workspace-scoped (rank1) ok");
    }

    // R12 批0(工作台群聊数据闭环):建项目→main 会话自动存在→双成员发消息→afterSeq 有序拉取;
    // 复用路径不复制 main 会话;外人(无工作区成员身份)读同一会话 fail-closed 返回 null。
    // 并发撞号的最终防线是 0046 的 UNIQUE(conversation_id, seq),这里验证串行分配严格递增。
    {
      const projectRepo = createProjectRepository(db);
      const conversationRepo = createConversationRepository(db);
      const memberships = createWorkspaceMembershipRepository(db);
      const wsId = settings.auth.defaultWorkspaceId;

      const memberAId = randomUUID();
      const memberBId = randomUUID();
      const outsiderId = randomUUID();
      await db.insert(users).values([
        {
          id: memberAId,
          nickname: `r12-a-${memberAId.slice(0, 8)}`,
          cookieToken: `r12-a-cookie-${randomUUID()}`,
          availabilityStatus: "free",
          isAdmin: false
        },
        {
          id: memberBId,
          nickname: `r12-b-${memberBId.slice(0, 8)}`,
          cookieToken: `r12-b-cookie-${randomUUID()}`,
          availabilityStatus: "free",
          isAdmin: false
        },
        {
          id: outsiderId,
          nickname: `r12-out-${outsiderId.slice(0, 8)}`,
          cookieToken: `r12-out-cookie-${randomUUID()}`,
          availabilityStatus: "free",
          isAdmin: false
        }
      ]).onConflictDoNothing();
      await memberships.create({ workspaceId: wsId, userId: memberAId, role: "member" });
      await memberships.create({ workspaceId: wsId, userId: memberBId, role: "member" });
      // outsiderId 故意不给成员身份。

      const slug = `r12-wb-${randomUUID().slice(0, 8)}`;
      const bootstrapArgs = {
        orgId: settings.auth.defaultOrgId,
        workspaceId: wsId,
        name: "R12 workbench smoke project",
        slug,
        ownerNickname: "r12-a",
        ownerUserId: memberAId
      };
      const boot = await projectRepo.bootstrapPilotProject(bootstrapArgs);
      assert.equal(boot.created, true, "R12 smoke project bootstrap is a real create");

      const tree = await conversationRepo.listVisibleForProject({
        workspaceId: wsId,
        viewerUserId: memberAId,
        projectId: boot.project.id,
        limit: 10
      });
      assert.ok(tree, "member A can list conversations for the new project");
      const mains = tree.rows.filter((row) => row.kind === "main");
      assert.equal(mains.length, 1, "creating a project atomically creates exactly one active main conversation");
      const mainConversation = mains[0];
      assert.ok(mainConversation, "main conversation row is present");

      const reuse = await projectRepo.bootstrapPilotProject(bootstrapArgs);
      assert.equal(reuse.created, false, "same slug reuses the project");
      const treeAfterReuse = await conversationRepo.listVisibleForProject({
        workspaceId: wsId,
        viewerUserId: memberAId,
        projectId: boot.project.id,
        limit: 10
      });
      assert.equal(
        treeAfterReuse?.rows.filter((row) => row.kind === "main").length,
        1,
        "create-or-reuse does not duplicate the main conversation"
      );

      const first = await conversationRepo.createUserMessage({
        workspaceId: wsId,
        conversationId: mainConversation.id,
        senderUserId: memberAId,
        kind: "text",
        contentJson: { text: "先把口径对齐再动笔" }
      });
      const second = await conversationRepo.createUserMessage({
        workspaceId: wsId,
        conversationId: mainConversation.id,
        senderUserId: memberBId,
        kind: "text",
        contentJson: { text: "收到,数据我来补" }
      });
      assert.equal(second.seq, first.seq + 1, "message seq allocation is strictly increasing per conversation");

      const page = await conversationRepo.listMessagesAfter({
        workspaceId: wsId,
        viewerUserId: memberBId,
        conversationId: mainConversation.id,
        afterSeq: 0,
        limit: 10
      });
      assert.ok(page, "member B can read the main conversation");
      assert.deepEqual(
        page.rows.map((row) => row.seq),
        [first.seq, second.seq],
        "afterSeq=0 returns both messages in seq order"
      );
      assert.deepEqual(
        page.rows.map((row) => row.senderUserId),
        [memberAId, memberBId],
        "message senders round-trip in send order"
      );
      const tail = await conversationRepo.listMessagesAfter({
        workspaceId: wsId,
        viewerUserId: memberBId,
        conversationId: mainConversation.id,
        afterSeq: first.seq,
        limit: 10
      });
      assert.deepEqual(
        tail?.rows.map((row) => row.seq),
        [second.seq],
        "afterSeq cursor skips already-seen messages"
      );

      const outsiderPage = await conversationRepo.listMessagesAfter({
        workspaceId: wsId,
        viewerUserId: outsiderId,
        conversationId: mainConversation.id,
        afterSeq: 0,
        limit: 10
      });
      assert.equal(outsiderPage, null, "non-member cannot read the project main conversation (fail-closed)");

      console.log("[r2-pg-redis-smoke] R12 conversation foundation (project→main→messages→afterSeq) ok");
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
