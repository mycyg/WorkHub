// R14 批 SEARCH 真库冒烟（一次性可复跑验证脚本，照 r14-chat-smoke.ts / r12-real-key-smoke.ts 的定位与防呆惯例）：
// 在专用 scratch 库上跑完整迁移链（含 0057 pg_trgm + 5 GIN 索引）后，直接种四数据源 + 一个「他人的个人空间
// 项目」作围栏反例，再用 search 服务把四 scope 全过一遍——断言命中、墓碑滤除、个人空间围栏、assignee EXISTS、
// CJK 2 字/≥3 字、has_more、LIKE 元字符转义、空结果诚实。不需要 LLM key。
// 需要环境：DATABASE_URL（专用 scratch 库！命名必须匹配 workhub_r14_*smoke）。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { loadSettings } from "@workhub/config";
import {
  conversationMessages,
  createDatabaseClient,
  createSearchRepository,
  createWorkspaceMembershipRepository,
  defaultSeedFixture,
  meetingRecords,
  orgs,
  projectConversations,
  projectDriveItems,
  projectDriveVersions,
  projects,
  runMigrations,
  users,
  workItemAssignments,
  workItems,
  workspaces
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import { createSearchService } from "../services/search.js";

async function main() {
  const settings = loadSettings(process.env);
  if (settings.appEnv === "production") {
    throw new Error("Refusing to run the R14 search smoke in production.");
  }
  if (!/workhub_r14_[a-z0-9_]*smoke/u.test(settings.databaseUrl)) {
    throw new Error("R14 search smoke requires a dedicated workhub_r14_*smoke scratch database.");
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

  const aId = randomUUID(); // 搜索者
  const bId = randomUUID(); // 另一个人（拥有个人空间项目 = 围栏反例）
  await db
    .insert(users)
    .values([
      { id: aId, nickname: `r14search-a-${aId.slice(0, 8)}`, cookieToken: `r14search-a-${randomUUID()}`, availabilityStatus: "free", isAdmin: false },
      { id: bId, nickname: `r14search-b-${bId.slice(0, 8)}`, cookieToken: `r14search-b-${randomUUID()}`, availabilityStatus: "free", isAdmin: false }
    ])
    .onConflictDoNothing();
  await memberships.create({ workspaceId: wsId, userId: aId, role: "member" });
  await memberships.create({ workspaceId: wsId, userId: bId, role: "member" });

  const suffix = randomUUID().slice(0, 8);
  const teamProjectId = randomUUID();
  const personalProjectId = randomUUID();
  await db.insert(projects).values([
    {
      id: teamProjectId,
      workspaceId: wsId,
      name: "增长团队项目",
      slug: `r14-search-team-${suffix}`,
      ownerNickname: "r14search-a",
      ownerUserId: aId,
      archived: false,
      isPersonal: false
    },
    {
      // 围栏反例：B 的个人空间项目（同工作区，isPersonal=true，owner=B）——A 是工作区成员但非 owner，
      // 网盘/会议/会话都必须对 A 不可见。
      id: personalProjectId,
      workspaceId: wsId,
      name: "B的个人空间",
      slug: `r14-search-personal-${suffix}`,
      ownerNickname: "r14search-b",
      ownerUserId: bId,
      archived: false,
      isPersonal: true
    }
  ]);

  // ── 会话 ──────────────────────────────────────────────────────────────────
  const teamConvId = randomUUID();
  const personalConvId = randomUUID();
  await db.insert(projectConversations).values([
    { id: teamConvId, workspaceId: wsId, projectId: teamProjectId, kind: "main", title: "主群聊", visibility: "project", nextSeq: 10 },
    { id: personalConvId, workspaceId: wsId, projectId: personalProjectId, kind: "main", title: "私密主群", visibility: "project", nextSeq: 10 }
  ]);
  const now = new Date();
  await db.insert(conversationMessages).values([
    // 命中（可见）：team 主群、text、未删除。
    { id: randomUUID(), conversationId: teamConvId, seq: 1, senderType: "user", senderUserId: bId, kind: "text", contentJson: { text: "这季度的预算和完播率都要复盘" }, createdAt: now },
    // 墓碑：deleted_at 置位——必须滤除。
    { id: randomUUID(), conversationId: teamConvId, seq: 2, senderType: "user", senderUserId: bId, kind: "text", contentJson: {}, deletedAt: now, createdAt: now },
    // 非 text kind：部分索引不覆盖 + WHERE kind='text' 排除——必须滤除。
    { id: randomUUID(), conversationId: teamConvId, seq: 3, senderType: "system", kind: "system_event", contentJson: { text: "预算系统事件不应命中" }, createdAt: now },
    // 个人空间会话消息：A 非 owner——必须被围栏挡掉。
    { id: randomUUID(), conversationId: personalConvId, seq: 1, senderType: "user", senderUserId: bId, kind: "text", contentJson: { text: "私密预算只有B能看" }, createdAt: now }
  ]);

  // ── 网盘 ──────────────────────────────────────────────────────────────────
  const nameHitVersion = randomUUID();
  const bodyHitVersion = randomUUID();
  const nameHitItem = randomUUID();
  const bodyHitItem = randomUUID();
  const pctItem = randomUUID();
  const offItem = randomUUID();
  const personalDriveItem = randomUUID();
  const tombstoneDriveItem = randomUUID();
  await db.insert(projectDriveItems).values([
    { id: nameHitItem, projectId: teamProjectId, name: "Q3预算.xlsx", kind: "file", currentVersionId: nameHitVersion, createdByUserId: aId },
    // 文件名不含「预算」、正文含——测 matched_in=body。
    { id: bodyHitItem, projectId: teamProjectId, name: "运营周报.txt", kind: "file", currentVersionId: bodyHitVersion, createdByUserId: aId },
    // LIKE 元字符：名字含字面量 50%。
    { id: pctItem, projectId: teamProjectId, name: "毛利率50%明细.xlsx", kind: "file", createdByUserId: aId },
    // 反例：搜 50% 不应命中（% 被转义成字面量，不当通配符）。
    { id: offItem, projectId: teamProjectId, name: "折扣50off说明.txt", kind: "file", createdByUserId: aId },
    // 围栏反例：B 个人空间的网盘文件——A 不可见。
    { id: personalDriveItem, projectId: personalProjectId, name: "私密预算表.xlsx", kind: "file", createdByUserId: bId },
    // 墓碑：deleted_at 置位——必须滤除。
    { id: tombstoneDriveItem, projectId: teamProjectId, name: "预算废弃稿.xlsx", kind: "file", deletedAt: now, createdByUserId: aId }
  ]);
  await db.insert(projectDriveVersions).values([
    { id: nameHitVersion, itemId: nameHitItem, versionNo: 1, filename: "Q3预算.xlsx", sizeBytes: 2048, storagePath: `/scratch/${nameHitVersion}`, parsedText: "表头：Q3 各口径预算汇总", createdByUserId: aId },
    { id: bodyHitVersion, itemId: bodyHitItem, versionNo: 1, filename: "运营周报.txt", sizeBytes: 1024, storagePath: `/scratch/${bodyHitVersion}`, parsedText: "本周运营复盘：预算口径统一为一致，完播率提升", createdByUserId: aId }
  ]);

  // ── 工单 ──────────────────────────────────────────────────────────────────
  const visibleWi = randomUUID();
  const privateWi = randomUUID();
  const assigneeWi = randomUUID();
  await db.insert(workItems).values([
    // 公开状态（非 private）——A 非 submitter/assignee 也可见。
    { id: visibleWi, code: `WI-VIS-${suffix}`, projectId: teamProjectId, workspaceId: wsId, submitterUserId: bId, title: "编制预算表", rawDescription: "把三个口径合到一张预算表", status: "ai_working" },
    // private 状态（intake）+ A 非 submitter/assignee——必须滤除。
    { id: privateWi, code: `WI-PRV-${suffix}`, projectId: teamProjectId, workspaceId: wsId, submitterUserId: bId, title: "预算私密草稿", rawDescription: "还没定的预算草稿", status: "intake" },
    // private 状态（spec_ready）但 A 是 assignee——assignee EXISTS 使其可见。
    { id: assigneeWi, code: `WI-ASG-${suffix}`, projectId: teamProjectId, workspaceId: wsId, submitterUserId: bId, title: "预算评审待认领", rawDescription: "指派给A的预算评审", status: "spec_ready" }
  ]);
  await db.insert(workItemAssignments).values({ id: randomUUID(), workItemId: assigneeWi, userId: aId, role: "member", assignedByUserId: bId });

  // ── 会议 ──────────────────────────────────────────────────────────────────
  const teamMeeting = randomUUID();
  const personalMeeting = randomUUID();
  await db.insert(meetingRecords).values([
    { id: teamMeeting, projectId: teamProjectId, uploadedByUserId: aId, title: "季度评审", audioFilename: "a.m4a", audioSizeBytes: 4096, audioPath: `/scratch/${teamMeeting}`, minutesMd: "## 结论\n预算口径统一为一致", status: "ready" },
    // 围栏反例：B 个人空间的会议——A 不可见。
    { id: personalMeeting, projectId: personalProjectId, uploadedByUserId: bId, title: "私密会议", audioFilename: "b.m4a", audioSizeBytes: 4096, audioPath: `/scratch/${personalMeeting}`, minutesMd: "预算私密纪要", status: "ready" }
  ]);

  // ── 执行搜索（actor = A）───────────────────────────────────────────────────
  const service = createSearchService(createSearchRepository(db));
  const actorA: AuthActor = { kind: "human", id: aId, label: "r14search-a", userId: aId, isAdmin: false, orgId, workspaceId: wsId };

  const all = await service.search({ actor: actorA, q: "预算" });
  const groupOf = (scope: string) => {
    const group = all.groups.find((g) => g.scope === scope);
    assert.ok(group, `group ${scope} present`);
    return group;
  };

  // 分组顺序固定。
  assert.deepEqual(all.groups.map((g) => g.scope), ["conversations", "drive", "work_items", "meetings"]);

  // 会话：命中可见 team 消息；墓碑 / 非 text / 个人空间全不在。
  const conv = groupOf("conversations");
  const convMsgIds = conv.results.map((r) => (r as { message_id: string }).message_id);
  assert.equal(conv.results.length, 1, "conversations: exactly the one visible text hit");
  assert.equal((conv.results[0] as { conversation_id: string }).conversation_id, teamConvId);
  assert.ok((conv.results[0] as { snippet: string }).snippet.includes("预算"));
  assert.equal((conv.results[0] as { deep_link: { seq: number } }).deep_link.seq, 1, "deep_link carries seq");
  assert.ok(!convMsgIds.some((id) => id === undefined), "no phantom rows");

  // 网盘：team 命中含 name 与 body 命中；个人空间 / 墓碑 / 50off 不在。
  const drive = groupOf("drive");
  const driveNames = drive.results.map((r) => (r as { name: string }).name).sort();
  assert.deepEqual(driveNames, ["Q3预算.xlsx", "运营周报.txt"], "drive: team name+body hits only, no personal/tombstone");
  const bodyHit = drive.results.find((r) => (r as { name: string }).name === "运营周报.txt") as { matched_in: string; snippet: string };
  assert.equal(bodyHit.matched_in, "body");
  assert.ok(bodyHit.snippet.includes("预算"));
  const nameHit = drive.results.find((r) => (r as { name: string }).name === "Q3预算.xlsx") as { matched_in: string };
  assert.equal(nameHit.matched_in, "name");

  // 工单：可见 + assignee EXISTS 命中；private 非本人不在。
  const work = groupOf("work_items");
  const workCodes = work.results.map((r) => (r as { code: string }).code).sort();
  assert.deepEqual(workCodes, [`WI-ASG-${suffix}`, `WI-VIS-${suffix}`], "work_items: public + assignee-EXISTS only, not the private non-mine one");

  // 会议：team 命中；个人空间不在。
  const meeting = groupOf("meetings");
  assert.equal(meeting.results.length, 1, "meetings: team only, personal fenced out");
  assert.equal((meeting.results[0] as { meeting_id: string }).meeting_id, teamMeeting);
  assert.equal((meeting.results[0] as { matched_in: string }).matched_in, "minutes");

  // ≥3 字 CJK：完播率——只 team 可见消息含它。
  const three = await service.search({ actor: actorA, q: "完播率", scopes: "conversations" });
  assert.equal(three.groups[0]!.results.length, 1, "3-char CJK query finds the message");

  // has_more：drive 有 2 条命中，limit=1 → has_more。
  const paged = await service.search({ actor: actorA, q: "预算", scopes: "drive", limit: 1 });
  assert.equal(paged.groups[0]!.results.length, 1);
  assert.equal(paged.groups[0]!.has_more, true, "limit+1 probe sets has_more");

  // LIKE 元字符转义：搜 50% 命中字面量 50%，不命中 50off（% 未被当通配符）。
  const pct = await service.search({ actor: actorA, q: "50%", scopes: "drive" });
  const pctNames = pct.groups[0]!.results.map((r) => (r as { name: string }).name);
  assert.deepEqual(pctNames, ["毛利率50%明细.xlsx"], "escaped % matches literal only, not 50off");

  // 空结果诚实：查无此词 → 每组 results:[] has_more:false，不脚手架。
  const empty = await service.search({ actor: actorA, q: "绝无此词xyz9" });
  assert.equal(empty.groups.length, 4);
  for (const group of empty.groups) {
    assert.deepEqual(group.results, []);
    assert.equal(group.has_more, false);
  }

  console.log(
    JSON.stringify({
      ok: true,
      conversations: conv.results.length,
      drive: drive.results.length,
      work_items: work.results.length,
      meetings: meeting.results.length,
      three_char_cjk: three.groups[0]!.results.length,
      drive_has_more_at_limit1: paged.groups[0]!.has_more,
      like_escape_hits: pctNames,
      empty_groups: empty.groups.map((g) => g.results.length)
    })
  );
  await client.close?.();
  process.exit(0);
}

main().catch((error) => {
  console.error("[r14-search-smoke] failed:", error);
  process.exit(1);
});
