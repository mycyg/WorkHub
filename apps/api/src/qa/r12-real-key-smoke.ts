// R12 真 LLM key 端到端冒烟(一次性验证脚本,照 r5-10-real-key-evaluation.ts 的定位):
// ① 主区静默观察者:造一段"过了静默窗"的真实讨论 → 跑一次 scheduler.tick() → 断言行动卡真的建出来;
// ② 协同会话 turn:成员发问 → createTurn 真调 LLM → 断言 Cuu 回复以真 seq 落库。
// 需要环境:DATABASE_URL(专用 scratch 库!)、LLM_API_KEY/LLM_BASE_URL/LLM_MODEL 真值。
// 本脚本只在开发环境运行,并拒绝非 scratch 命名的库,防呆误打开发库。
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

import { getDefaultConversationTurnService } from "../services/conversation-turns.js";
import { getDefaultConversationObserverScheduler } from "../workers/conversation-observer.js";

async function main() {
  const settings = loadSettings(process.env);
  if (settings.appEnv === "production") {
    throw new Error("Refusing to run the R12 real-key smoke in production.");
  }
  if (!/workhub_r12_[a-z0-9_]*smoke/u.test(settings.databaseUrl)) {
    throw new Error("R12 real-key smoke requires a dedicated workhub_r12_*smoke scratch database.");
  }
  if (!process.env.LLM_API_KEY) {
    throw new Error("LLM_API_KEY is required (real-key smoke).");
  }

  await runMigrations(settings);
  const client = createDatabaseClient(settings);
  const db = client.db;
  await db.insert(orgs).values(defaultSeedFixture.orgs).onConflictDoNothing();
  await db.insert(workspaces).values(defaultSeedFixture.workspaces).onConflictDoNothing();
  await db.insert(users).values(defaultSeedFixture.users).onConflictDoNothing();
  await db.insert(projects).values(defaultSeedFixture.projects).onConflictDoNothing();

  const wsId = settings.auth.defaultWorkspaceId;
  const memberships = createWorkspaceMembershipRepository(db);
  const projectRepo = createProjectRepository(db);
  const conversations = createConversationRepository(db);

  const aId = randomUUID();
  const bId = randomUUID();
  await db.insert(users).values([
    { id: aId, nickname: `r12smoke-a-${aId.slice(0, 8)}`, cookieToken: `r12smoke-a-${randomUUID()}`, availabilityStatus: "free", isAdmin: false },
    { id: bId, nickname: `r12smoke-b-${bId.slice(0, 8)}`, cookieToken: `r12smoke-b-${randomUUID()}`, availabilityStatus: "free", isAdmin: false }
  ]).onConflictDoNothing();
  await memberships.create({ workspaceId: wsId, userId: aId, role: "member" });
  await memberships.create({ workspaceId: wsId, userId: bId, role: "member" });

  const boot = await projectRepo.bootstrapPilotProject({
    orgId: settings.auth.defaultOrgId,
    workspaceId: wsId,
    name: "R12 真 key 冒烟项目",
    slug: `r12-smoke-${randomUUID().slice(0, 8)}`,
    ownerNickname: "r12smoke-a",
    ownerUserId: aId
  });
  const tree = await conversations.listVisibleForProject({ workspaceId: wsId, viewerUserId: aId, projectId: boot.project.id, limit: 10 });
  const main = tree?.rows.find((row) => row.kind === "main");
  assert.ok(main, "main conversation exists");

  // ① 观察者:三条"过了静默窗"的讨论(at 提前 3 分钟,超过默认 60s 静默)。
  const past = new Date(Date.now() - 3 * 60 * 1000);
  await conversations.createUserMessage({ workspaceId: wsId, conversationId: main.id, senderUserId: aId, kind: "text", contentJson: { text: "选题报告第三节的完播率口径不对,应该按新的 15s 口径重算,不是旧的 30s。数据用网盘里的投放周报。" }, at: past });
  await conversations.createUserMessage({ workspaceId: wsId, conversationId: main.id, senderUserId: bId, kind: "text", contentJson: { text: "同意,第三节要重写。另外下周投放预算是否砍半,我拿不准,需要有人拍板。" }, at: new Date(past.getTime() + 30_000) });

  const scheduler = getDefaultConversationObserverScheduler();
  const tick = await scheduler.tick();
  console.log("[r12-real-key-smoke] observer tick:", JSON.stringify(tick));
  const cards = await db.execute(
    `select ac.id, count(item.id)::int as items from action_cards ac left join action_card_items item on item.action_card_id = ac.id where ac.conversation_id = '${main.id}' group by ac.id`
  );
  const cardRows = (cards as unknown as { rows?: Array<{ id: string; items: number }> }).rows ?? (cards as unknown as Array<{ id: string; items: number }>);
  assert.ok(cardRows.length >= 1, "observer created at least one action card");
  console.log("[r12-real-key-smoke] action cards:", JSON.stringify(cardRows));

  // ② 协同 turn:A 和 Cuu 单聊,真调 LLM,断言回复落库。
  const collab = await conversations.createCollab({
    workspaceId: wsId,
    projectId: boot.project.id,
    creatorUserId: aId,
    title: "口径梳理",
    visibility: "private",
    participantUserIds: []
  });
  const ask = await conversations.createUserMessage({
    workspaceId: wsId,
    conversationId: collab.conversation.id,
    senderUserId: aId,
    kind: "text",
    contentJson: { text: "帮我把 15s 完播率口径要点总结成三条,发给团队用。" }
  });
  const turnService = getDefaultConversationTurnService();
  const result = await turnService.createTurn({
    actor: { kind: "human", id: aId, userId: aId, label: "r12smoke-a", isAdmin: false, orgId: settings.auth.defaultOrgId, workspaceId: wsId },
    conversationId: collab.conversation.id,
    payload: { user_message_id: ask.id }
  });
  assert.equal(result.message.sender_type, "cuu", "turn persisted a cuu reply");
  assert.ok(result.message.seq > ask.seq, "cuu reply carries a later seq");
  const replyText = (result.message.content as { text?: string }).text ?? "";
  assert.ok(replyText.length > 10, "cuu reply is non-trivial");
  console.log("[r12-real-key-smoke] turn reply seq:", result.message.seq);
  console.log("[r12-real-key-smoke] turn reply text:", replyText.slice(0, 200));
  console.log(JSON.stringify({ ok: true, observer_cards: cardRows.length, turn_seq: result.message.seq }));
  await client.close?.();
  process.exit(0);
}

main().catch((error) => {
  console.error("[r12-real-key-smoke] FAILED:", error);
  process.exit(1);
});
