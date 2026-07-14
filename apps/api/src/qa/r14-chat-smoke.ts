// R14 批 CHAT 真库冒烟（一次性可复跑验证脚本，照 r12-real-key-smoke.ts 的定位与防呆惯例）：
// 在专用 scratch 库上跑完整迁移链后，走服务层把聊天完整度的全链路过一遍——
// 引用回复→编辑（含他人编辑 403）→reaction 幂等加减→置顶/取消→已读游标单调夹紧+receipts→
// 墓碑删除（含引用侧墓碑联动）→SSE 事件（recording bus 断言三个新事件都真的发布了）。
// 不需要 LLM key。需要环境：DATABASE_URL（专用 scratch 库！命名必须匹配 workhub_r14_*smoke）。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { loadSettings } from "@workhub/config";
import {
  createConversationRepository,
  createDatabaseClient,
  createProjectRepository,
  createWorkspaceMembershipRepository,
  defaultSeedFixture,
  orgs,
  projects,
  runMigrations,
  users,
  workspaces
} from "@workhub/db";

import { createConversationService } from "../services/conversations.js";

async function main() {
  const settings = loadSettings(process.env);
  if (settings.appEnv === "production") {
    throw new Error("Refusing to run the R14 chat smoke in production.");
  }
  if (!/workhub_r14_[a-z0-9_]*smoke/u.test(settings.databaseUrl)) {
    throw new Error("R14 chat smoke requires a dedicated workhub_r14_*smoke scratch database.");
  }

  await runMigrations(settings);
  const client = createDatabaseClient(settings);
  const db = client.db;
  await db.insert(orgs).values(defaultSeedFixture.orgs).onConflictDoNothing();
  await db.insert(workspaces).values(defaultSeedFixture.workspaces).onConflictDoNothing();
  await db.insert(users).values(defaultSeedFixture.users).onConflictDoNothing();
  await db.insert(projects).values(defaultSeedFixture.projects).onConflictDoNothing();

  const wsId = settings.auth.defaultWorkspaceId;
  const orgId = settings.auth.defaultOrgId;
  const memberships = createWorkspaceMembershipRepository(db);
  const projectRepo = createProjectRepository(db);
  const conversations = createConversationRepository(db);

  const aId = randomUUID();
  const bId = randomUUID();
  await db
    .insert(users)
    .values([
      {
        id: aId,
        nickname: `r14smoke-a-${aId.slice(0, 8)}`,
        cookieToken: `r14smoke-a-${randomUUID()}`,
        availabilityStatus: "free",
        isAdmin: false
      },
      {
        id: bId,
        nickname: `r14smoke-b-${bId.slice(0, 8)}`,
        cookieToken: `r14smoke-b-${randomUUID()}`,
        availabilityStatus: "free",
        isAdmin: false
      }
    ])
    .onConflictDoNothing();
  await memberships.create({ workspaceId: wsId, userId: aId, role: "member" });
  await memberships.create({ workspaceId: wsId, userId: bId, role: "member" });

  const boot = await projectRepo.bootstrapPilotProject({
    orgId,
    workspaceId: wsId,
    name: "R14 聊天完整度冒烟项目",
    slug: `r14-chat-smoke-${randomUUID().slice(0, 8)}`,
    ownerNickname: "r14smoke-a",
    ownerUserId: aId
  });
  const tree = await conversations.listVisibleForProject({
    workspaceId: wsId,
    viewerUserId: aId,
    projectId: boot.project.id,
    limit: 10
  });
  const mainConversation = tree?.rows.find((row) => row.kind === "main");
  assert.ok(mainConversation, "main conversation exists");
  const conversationId = mainConversation.id;

  // recording bus：断言三个新 SSE 事件（message.updated/reaction.updated/read.updated）都真的发布。
  const published: Array<{ topic: string; type: string }> = [];
  const service = createConversationService(conversations, {
    driveFiles: {
      file: async () => {
        throw new Error("drive file lookup is not part of this smoke");
      }
    },
    bus: {
      backend: "memory",
      publish: async (topic: string, type: string) => {
        published.push({ topic, type });
      }
    }
  });
  const actorA = { kind: "human" as const, id: aId, userId: aId, label: "r14smoke-a", isAdmin: false, orgId, workspaceId: wsId };
  const actorB = { kind: "human" as const, id: bId, userId: bId, label: "r14smoke-b", isAdmin: false, orgId, workspaceId: wsId };

  // ① A 发原消息，B 引用回复。
  const m1 = await service.createMessage({
    actor: actorA,
    conversationId,
    payload: { kind: "text", content: { text: "初版口径文档已放网盘，大家看下第三节。" } }
  });
  const m2 = await service.createMessage({
    actor: actorB,
    conversationId,
    payload: {
      kind: "text",
      content: { text: "第三节的完播率窗口应该用 15s，不是 30s。" },
      reply_to_message_id: m1.id
    }
  });
  assert.equal(m2.reply_to?.message_id, m1.id, "reply carries the target id");
  assert.equal(m2.reply_to?.deleted, false, "reply target is alive");
  assert.ok((m2.reply_to?.preview_text ?? "").includes("初版口径"), "reply preview quotes the target");

  // 引用不存在的消息 → 400。
  await assert.rejects(
    service.createMessage({
      actor: actorA,
      conversationId,
      payload: { kind: "text", content: { text: "x" }, reply_to_message_id: randomUUID() }
    }),
    (error: { code?: string }) => error.code === "conversation_reply_target_invalid"
  );

  // ② 编辑：本人可编辑；他人 403。
  const edited = await service.editMessage({
    actor: actorA,
    conversationId,
    messageId: m1.id,
    payload: { text: "初版口径文档已放网盘（v2 已更新），大家看第三节。" }
  });
  assert.ok(edited.edited_at, "edit stamps edited_at");
  assert.ok((edited.content as { text: string }).text.includes("v2"), "edit replaces the text");
  await assert.rejects(
    service.editMessage({ actor: actorB, conversationId, messageId: m1.id, payload: { text: "hijack" } }),
    (error: { code?: string }) => error.code === "conversation_message_forbidden"
  );

  // ③ reaction：加两键、幂等重放、他人同键、坏键 400、减一键。
  await service.addReaction({ actor: actorB, conversationId, messageId: m1.id, reactionKey: "approve" });
  await service.addReaction({ actor: actorB, conversationId, messageId: m1.id, reactionKey: "approve" });
  await service.addReaction({ actor: actorA, conversationId, messageId: m1.id, reactionKey: "question" });
  await assert.rejects(
    service.addReaction({ actor: actorA, conversationId, messageId: m1.id, reactionKey: "sparkle" }),
    (error: { code?: string }) => error.code === "conversation_reaction_invalid_key"
  );
  let page = await service.listMessages({ actor: actorA, conversationId, query: { afterSeq: 0, limit: 50 } });
  let m1Vm = page.messages.find((message) => message.id === m1.id);
  assert.deepEqual(
    (m1Vm?.reactions ?? []).map((entry) => [entry.key, entry.user_ids.length]),
    [
      ["approve", 1],
      ["question", 1]
    ],
    "reactions aggregate with idempotent add"
  );
  await service.removeReaction({ actor: actorA, conversationId, messageId: m1.id, reactionKey: "question" });

  // ④ 置顶：置顶→pins 列表命中→取消→列表空。
  await service.pinMessage({ actor: actorB, conversationId, messageId: m1.id });
  let pins = await service.listPins({ actor: actorA, conversationId });
  assert.equal(pins.messages.length, 1, "pin shows up for every viewer");
  assert.equal(pins.messages[0]?.id, m1.id);
  await service.unpinMessage({ actor: actorB, conversationId, messageId: m1.id });
  pins = await service.listPins({ actor: actorA, conversationId });
  assert.equal(pins.messages.length, 0, "unpin clears the list");

  // ⑤ 已读游标：超量夹紧到会话水位；倒退保持单调；receipts 双人可见。
  const clamped = await service.advanceReadCursor({
    actor: actorA,
    conversationId,
    payload: { last_read_seq: 999_999 }
  });
  assert.ok(clamped.last_read_seq >= m2.seq, "cursor reaches the newest message");
  assert.ok(clamped.last_read_seq < 999_999, "cursor is clamped to the conversation watermark");
  const monotonic = await service.advanceReadCursor({ actor: actorA, conversationId, payload: { last_read_seq: 1 } });
  assert.equal(monotonic.last_read_seq, clamped.last_read_seq, "cursor never regresses");
  await service.advanceReadCursor({ actor: actorB, conversationId, payload: { last_read_seq: m1.seq } });
  const receipts = await service.listReceipts({ actor: actorB, conversationId });
  assert.equal(receipts.receipts.length, 2, "both cursors are visible");

  // ⑥ 墓碑删除：删 m1 → VM 归一空文本；m2 的引用侧联动 deleted=true；重复删幂等。
  const tombstone = await service.deleteMessage({ actor: actorA, conversationId, messageId: m1.id });
  assert.ok(tombstone.deleted_at, "delete stamps deleted_at");
  assert.equal((tombstone.content as { text: string }).text, "", "tombstone clears the text");
  const again = await service.deleteMessage({ actor: actorA, conversationId, messageId: m1.id });
  assert.ok(again.deleted_at, "repeat delete is idempotent");
  page = await service.listMessages({ actor: actorB, conversationId, query: { afterSeq: 0, limit: 50 } });
  m1Vm = page.messages.find((message) => message.id === m1.id);
  const m2Vm = page.messages.find((message) => message.id === m2.id);
  assert.ok(m1Vm?.deleted_at, "tombstone survives the list read");
  assert.equal(m2Vm?.reply_to?.deleted, true, "quote side shows the tombstone");

  // ⑦ SSE：三个新事件都发布过。
  const types = new Set(published.map((event) => event.type));
  for (const expected of [
    "conversation.message.updated",
    "conversation.reaction.updated",
    "conversation.read.updated"
  ]) {
    assert.ok(types.has(expected), `bus published ${expected}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      published: [...types].sort(),
      receipts: receipts.receipts.length,
      clamped_cursor: clamped.last_read_seq
    })
  );
  await client.close?.();
  process.exit(0);
}

main().catch((error) => {
  console.error("[r14-chat-smoke] failed:", error);
  process.exit(1);
});
