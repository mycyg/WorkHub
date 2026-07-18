import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { loadSettings } from "@workhub/config";
import {
  createConversationRepository,
  createDatabaseClient,
  createEventOutboxRepository,
  runMigrations,
  type ConversationAccessRecord,
  type ConversationMessageRow,
  type ConversationRepository,
  type ConversationRow,
  type EventOutboxRepository,
  type EventOutboxRow
} from "@workhub/db";

import type { AuthActor } from "./middleware/auth.js";
import { createConversationService } from "./services/conversations.js";
import { createEventOutboxDrain } from "./services/event-outbox.js";
import type { DrivePageService } from "./services/drive-pages.js";

// R20 P2-01（事务性 outbox）根因测试：修的裂缝是「会话消息 DB commit 与 publish 之间无 outbox/replay」——
// 消息先落库提交，再 best-effort bus.publish；两步之间进程崩溃或 publish 抛错，则 conversation.message.created
// 永久丢失（SSE resume_mode='fresh' 不重放）。下面既有纯内存的确定性复现（默认跑），也有真 PG 集成复现
// （WORKHUB_R20_OUTBOX_REAL_PG=1 才跑，跟本仓既有 real-PG 惯例）。

const now = new Date("2026-07-18T09:00:00.000Z");
const silentLogger = { warn: () => {} } as const;

// ── 纯内存 fake：模拟「消息行 + outbox 行同事务原子提交」 ─────────────────────────────────────

function makeRepository(
  outboxStore: EventOutboxRow[],
  fixtures: { conversationRow: ConversationRow; accessRecord: ConversationAccessRecord; messageId: string }
): ConversationRepository {
  const impl: Partial<ConversationRepository> = {
    async findVisibleAccessRecord() {
      return fixtures.accessRecord;
    },
    async createUserMessage(input, options) {
      const created: ConversationMessageRow = {
        id: fixtures.messageId,
        conversationId: input.conversationId,
        seq: 1,
        senderType: "user",
        senderUserId: input.senderUserId,
        kind: input.kind,
        contentJson: input.contentJson,
        threadRootId: input.threadRootId ?? null,
        editedAt: null,
        deletedAt: null,
        deletedByUserId: null,
        replyToMessageId: (input.kind === "text" ? input.replyToMessageId : undefined) ?? null,
        pinnedAt: null,
        pinnedByUserId: null,
        createdAt: now
      };
      // 模拟真事务：入队钩子在这里同步执行、把 outbox 行随消息行一起「原子提交」进共享内存仓库。
      // 崩溃点在这一步之后、publish 之前——本 fake 把 publish 交给外部 drain，故只要不 drain 就复现崩溃态。
      const enqueue = options?.enqueueOutbox;
      if (enqueue) {
        const row = enqueue(created);
        if (row) {
          outboxStore.push({
            id: randomUUID(),
            workspaceId: row.workspaceId,
            topic: row.topic,
            eventType: row.eventType,
            eventId: row.eventId,
            payload: row.payload,
            status: "pending",
            attempts: 0,
            lastError: null,
            createdAt: new Date(),
            publishedAt: null
          });
        }
      }
      return created;
    },
    async listReactionsForMessages() {
      return new Map();
    },
    async listReplyPreviews() {
      return new Map();
    }
  };
  // 未桩方法一律抛错（本套件只走 createMessage 路径）。
  return new Proxy(impl, {
    get(target, prop: string) {
      if (prop in target) {
        return (target as Record<string, unknown>)[prop];
      }
      return async () => {
        throw new Error(`repository.${String(prop)} not stubbed`);
      };
    }
  }) as ConversationRepository;
}

function makeOutboxRepository(store: EventOutboxRow[]): EventOutboxRepository {
  return {
    async listPending({ limit }) {
      return store.filter((row) => row.status === "pending").slice(0, Math.max(0, limit));
    },
    async markPublished({ id, at }) {
      const row = store.find((entry) => entry.id === id);
      if (row && row.status === "pending") {
        row.status = "published";
        row.publishedAt = at ?? new Date();
        row.lastError = null;
      }
    },
    async markFailed({ id, error }) {
      const row = store.find((entry) => entry.id === id);
      if (row && row.status === "pending") {
        row.attempts += 1;
        row.lastError = error;
      }
    }
  };
}

// backend + publish 兼作 PushBus 桩；failsLeft>0 时前几次 publish 抛错（模拟 broker 抖动 / 崩溃窗口）。
function flakyBus(failsLeft: number) {
  const published: Array<{ topic: string; type: string; data: unknown }> = [];
  let remainingFailures = failsLeft;
  return {
    published,
    bus: {
      backend: "memory" as const,
      async publish(topic: string, type: string, data: unknown) {
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          throw new Error("broker unavailable during crash window");
        }
        published.push({ topic, type, data });
      }
    }
  };
}

function fixtures() {
  const workspaceId = "aa000000-0000-4000-8000-000000000001";
  const projectId = "aa000000-0000-4000-8000-000000000002";
  const conversationId = "aa000000-0000-4000-8000-000000000003";
  const userId = "aa000000-0000-4000-8000-000000000004";
  const messageId = "aa000000-0000-4000-8000-000000000005";
  const conversationRow: ConversationRow = {
    id: conversationId,
    workspaceId,
    projectId,
    kind: "main",
    title: "主区",
    parentConversationId: null,
    sourceMessageId: null,
    visibility: "project",
    nextSeq: 1,
    cuuEnabled: true,
    contextSummaryMd: null,
    contextSummaryThroughSeq: 0,
    dmKey: null,
    createdBy: userId,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now
  };
  const accessRecord: ConversationAccessRecord = {
    conversation: conversationRow,
    projectOwnerUserId: userId,
    projectIsPersonal: false,
    projectInstructionsMd: null,
    projectIsDmContainer: false,
    membershipRole: "member",
    participantRole: null,
    participantCount: 1
  };
  const actor: AuthActor = {
    kind: "human",
    id: userId,
    label: "R20 Sender",
    userId,
    isAdmin: false,
    orgId: "aa000000-0000-4000-8000-000000000000",
    workspaceId
  };
  return { workspaceId, projectId, conversationId, userId, messageId, conversationRow, accessRecord, actor };
}

const driveNotUsed: Pick<DrivePageService, "file"> = {
  file: async () => {
    throw new Error("drive must not be called for text messages");
  }
};

// ── 纯内存 drain 单元测试 ────────────────────────────────────────────────────────────────────

test("createEventOutboxDrain publishes pending rows and marks them published", async () => {
  const store: EventOutboxRow[] = [
    {
      id: randomUUID(),
      workspaceId: "w",
      topic: "conversation:c1",
      eventType: "conversation.message.created",
      eventId: randomUUID(),
      payload: { hello: "world" },
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: new Date(),
      publishedAt: null
    }
  ];
  const outbox = makeOutboxRepository(store);
  const { published, bus } = flakyBus(0);
  const drain = createEventOutboxDrain({ outbox, bus, logger: silentLogger });

  const result = await drain();

  assert.deepEqual(result, { scanned: 1, published: 1, failed: 0 });
  assert.equal(published.length, 1);
  assert.equal(published[0]?.topic, "conversation:c1");
  assert.equal(store[0]?.status, "published");
  assert.ok(store[0]?.publishedAt);
});

test("createEventOutboxDrain keeps a row pending when publish fails, then replays it on the next drain", async () => {
  const eventId = randomUUID();
  const store: EventOutboxRow[] = [
    {
      id: randomUUID(),
      workspaceId: "w",
      topic: "conversation:c2",
      eventType: "conversation.message.created",
      eventId,
      payload: { event_id: eventId },
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: new Date(),
      publishedAt: null
    }
  ];
  const outbox = makeOutboxRepository(store);
  const { published, bus } = flakyBus(1); // 第一次 publish 抛错，之后恢复
  const drain = createEventOutboxDrain({ outbox, bus, logger: silentLogger });

  const firstPass = await drain();
  assert.deepEqual(firstPass, { scanned: 1, published: 0, failed: 1 });
  assert.equal(published.length, 0, "publish 失败时事件不能被投递出去");
  assert.equal(store[0]?.status, "pending", "失败行必须留在 pending 等重放");
  assert.equal(store[0]?.attempts, 1, "失败行 attempts +1");
  assert.ok(store[0]?.lastError, "失败行须记 last_error（禁空 catch 吞错）");

  const secondPass = await drain();
  assert.deepEqual(secondPass, { scanned: 1, published: 1, failed: 0 });
  assert.equal(published.length, 1, "恢复后下一轮 drain 必须补发");
  assert.equal(store[0]?.status, "published");
});

// ── 根因复现（纯内存，走真 createConversationService）：崩溃窗口 → 下一轮 drain 补发 ──────────────

test("R20 root cause: a committed message whose publish crashed is replayed by the next outbox drain", async () => {
  const f = fixtures();
  const store: EventOutboxRow[] = [];
  const repository = makeRepository(store, {
    conversationRow: f.conversationRow,
    accessRecord: f.accessRecord,
    messageId: f.messageId
  });
  const outbox = makeOutboxRepository(store);
  const { published, bus } = flakyBus(1); // 即席 drain 的第一次 publish 抛错 = commit 后、publish 前崩溃
  const drain = createEventOutboxDrain({ outbox, bus, logger: silentLogger });
  const service = createConversationService(repository, {
    driveFiles: driveNotUsed,
    bus,
    logger: silentLogger,
    outboxDrain: drain,
    now: () => now
  });

  const message = await service.createMessage({
    actor: f.actor,
    conversationId: f.conversationId,
    payload: { kind: "text", content: { text: "hello outbox" } }
  });

  // 崩溃中间态：消息行已「提交」并返回给调用方，但事件还没 publish 出去，outbox 行停在 pending。
  assert.equal(message.id, f.messageId);
  assert.equal(published.length, 0, "崩溃窗口：事件尚未 publish");
  assert.equal(store.length, 1, "消息落库必须在同事务里留下恰好一条 outbox 行");
  assert.equal(store[0]?.status, "pending");
  assert.equal(store[0]?.eventType, "conversation.message.created");
  assert.equal(store[0]?.topic, `conversation:${f.conversationId}`);

  // 恢复：下一轮 drain（模拟定时调度器 / 重启后补扫）——broker 已恢复。
  const recovery = await drain();
  assert.equal(recovery.published, 1);
  assert.equal(published.length, 1, "崩溃后事件被下一轮 drain 补发，绝不丢");
  assert.equal(published[0]?.type, "conversation.message.created");
  assert.equal(published[0]?.topic, `conversation:${f.conversationId}`);
  const envelope = published[0]?.data as { event_id: string; type: string; data: { id: string } };
  assert.equal(envelope.event_id, store[0]?.eventId, "补发事件的 event_id = outbox 幂等键");
  assert.equal(envelope.data.id, f.messageId, "补发事件承载的正是这条消息");
  assert.equal(store[0]?.status, "published");
});

test("R20 contrast: without the outbox (legacy direct publish), a publish failure loses the event unrecoverably", async () => {
  const f = fixtures();
  const store: EventOutboxRow[] = [];
  const repository = makeRepository(store, {
    conversationRow: f.conversationRow,
    accessRecord: f.accessRecord,
    messageId: f.messageId
  });
  const outbox = makeOutboxRepository(store);
  const { published, bus } = flakyBus(1);
  const legacyDrain = createEventOutboxDrain({ outbox, bus, logger: silentLogger });
  // 关键：不注入 outboxDrain → 走既有 best-effort「提交后直发」路径（修复前行为）。
  const service = createConversationService(repository, {
    driveFiles: driveNotUsed,
    bus,
    logger: silentLogger,
    now: () => now
  });

  const message = await service.createMessage({
    actor: f.actor,
    conversationId: f.conversationId,
    payload: { kind: "text", content: { text: "hello legacy" } }
  });

  assert.equal(message.id, f.messageId);
  // 直发在崩溃窗口 publish 抛错被 best-effort 吞掉；没有 outbox 行 → 任何后续 drain 都补不回来 = 永久丢失。
  assert.equal(published.length, 0, "直发路径：publish 失败，事件没发出去");
  assert.equal(store.length, 0, "直发路径不留 outbox 行——这正是被修复的丢投裂缝");
  const recovery = await legacyDrain();
  assert.deepEqual(recovery, { scanned: 0, published: 0, failed: 0 });
  assert.equal(published.length, 0, "没有 outbox，事件永久丢失，无从补发");
});

// ── 真 PG 集成复现（opt-in）：端到端跑通「commit 已发生、publish 未发生 → drain 补发」 ─────────────

test("R20 event outbox real-PG replays a committed-but-unpublished conversation message", {
  skip: process.env.WORKHUB_R20_OUTBOX_REAL_PG !== "1",
  timeout: 120_000
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "real-PG outbox 复现需要 DATABASE_URL");
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  assert.match(
    databaseName,
    /^workhub_r20_outbox_[a-z0-9_]+$/u,
    "real-PG 复现只允许指向专用 workhub_r20_outbox_* 草稿库"
  );

  const orgId = randomUUID();
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const conversationId = randomUUID();
  const membershipId = randomUUID();
  const runTag = randomUUID().slice(0, 8);

  const settings = loadSettings({
    APP_ENV: "test",
    DATABASE_URL: databaseUrl,
    COOKIE_SECRET: "r20-outbox-real-pg-secret",
    DEFAULT_ORG_ID: orgId,
    DEFAULT_WORKSPACE_ID: workspaceId
  });
  await runMigrations(settings);
  const client = createDatabaseClient(settings);
  try {
    await client.pool.query(`insert into orgs (id, name, slug, plan) values ($1, $2, $3, 'lan')`, [
      orgId,
      "R20 Outbox Org",
      `r20-outbox-org-${runTag}`
    ]);
    await client.pool.query(`insert into workspaces (id, org_id, name, slug) values ($1, $2, $3, $4)`, [
      workspaceId,
      orgId,
      "R20 Outbox Workspace",
      `r20-outbox-ws-${runTag}`
    ]);
    await client.pool.query(`insert into users (id, nickname, cookie_token, is_admin) values ($1, $2, $3, false)`, [
      userId,
      `R20 Outbox Sender ${runTag}`,
      `r20-outbox-cookie-${runTag}`
    ]);
    await client.pool.query(
      `insert into workspace_memberships (id, workspace_id, user_id, role, default_workspace)
       values ($1, $2, $3, 'owner', true)`,
      [membershipId, workspaceId, userId]
    );
    await client.pool.query(
      `insert into projects (id, workspace_id, name, slug, owner_nickname, owner_user_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [projectId, workspaceId, "R20 Outbox Project", `r20-outbox-project-${runTag}`, `R20 Outbox Sender ${runTag}`, userId]
    );
    await client.pool.query(
      `insert into project_conversations (id, workspace_id, project_id, kind, title, visibility, next_seq, created_by)
       values ($1, $2, $3, 'main', $4, 'project', 0, $5)`,
      [conversationId, workspaceId, projectId, "主区", userId]
    );

    const repository = createConversationRepository(client.db);
    const outbox = createEventOutboxRepository(client.db);
    const { published, bus } = flakyBus(1); // 即席 drain 第一次 publish 抛错 = commit 后、publish 前崩溃
    const drain = createEventOutboxDrain({ outbox, bus, logger: silentLogger });
    const service = createConversationService(repository, {
      driveFiles: driveNotUsed,
      bus,
      logger: silentLogger,
      outboxDrain: drain,
      now: () => new Date()
    });
    const actor: AuthActor = {
      kind: "human",
      id: userId,
      label: "R20 Outbox Sender",
      userId,
      isAdmin: false,
      orgId,
      workspaceId
    };

    const message = await service.createMessage({
      actor,
      conversationId,
      payload: { kind: "text", content: { text: "hello real-pg outbox" } }
    });

    // 崩溃中间态（真 PG）：conversation_messages 行已提交，事件未 publish，event_outbox 行 pending。
    assert.equal(published.length, 0, "崩溃窗口：事件尚未 publish");
    const committedMessage = await client.pool.query(`select id from conversation_messages where id = $1`, [message.id]);
    assert.equal(committedMessage.rowCount, 1, "消息行必须真的已提交");
    const pending = await client.pool.query(
      `select id, status, event_type, topic, event_id, payload from event_outbox where status = 'pending'`
    );
    assert.equal(pending.rowCount, 1, "已提交消息必须在同事务里留下恰好一条 pending outbox 行");
    assert.equal(pending.rows[0].event_type, "conversation.message.created");
    assert.equal(pending.rows[0].topic, `conversation:${conversationId}`);

    // 恢复：下一轮 drain（broker 已恢复）补发。
    const recovery = await drain();
    assert.equal(recovery.published, 1);
    assert.equal(published.length, 1, "崩溃后事件被下一轮 drain 补发");
    assert.equal(published[0]?.topic, `conversation:${conversationId}`);
    const envelope = published[0]?.data as { event_id: string; data: { id: string } };
    assert.equal(envelope.event_id, pending.rows[0].event_id);
    assert.equal(envelope.data.id, message.id);

    const settled = await client.pool.query(`select status, published_at from event_outbox where event_id = $1`, [
      pending.rows[0].event_id
    ]);
    assert.equal(settled.rows[0].status, "published");
    assert.ok(settled.rows[0].published_at, "published_at 必须落值");
  } finally {
    await client.close();
  }
});
