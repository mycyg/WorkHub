import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  approvalRequests,
  conversationMessages,
  escalationEvents,
  projectConversations,
  projects,
  proposals,
  workItems
} from "../schema/index.js";

// R15 批 A（A3 会话 digest 卡，见 r15-proactive-upgrade/01-batch-a-pipeline.md §A3）：三条只读/单写查询，
// 服务层（apps/api/src/services/approval-digest.ts）据此在每个项目 main 会话里维护一张「待你拍板 N 件」
// 的 digest 卡——数字变化时墓碑旧卡 + 发新卡（保留痕迹、天然重新置底），归零时墓碑，无变化不动。
// 阈值/对账逻辑全部留在应用层，这层只把数据老实搬出/落。

export type PendingApprovalDigestRow = {
  projectId: string;
  workspaceId: string;
  // main 会话恒存在（建项目时必建）——inner join 已保证有值。
  mainConversationId: string;
  pendingCount: number;
  oldestPendingAt: Date;
};

// §A3 + R17 #18：每个「有待拍板决策」的项目一行——待决总数 + 最久一条的创建时刻 + main 会话 id。
//
// ── 计数口径（务必读懂再改）──────────────────────────────────────────────────────────────
// digest 卡是项目 main 会话里的一张项目级卡片（该项目所有成员都看得到），数的是「这个项目里还有几件事
// 在等人拍板」。此前只数 approval_requests，系统性小于决策收件箱（GET /attention）真实条数——收件箱聚合
// 四源：升级(含预算) + 偏好冲突 + 审批 + 待评审提议。这里把 digest 扩到与收件箱**同源**，但按「能否归到本
// 项目」取窄：
//   * 审批 approval_requests(status='pending')      —— 经 work_item 挂到项目。（work_item_id 为空的个人
//     审批无法归属项目，天然不计——正是"跨项目个人审批不塞进项目 digest"。）
//   * 升级 escalation_events(resolved_at is null)    —— 经 work_item 挂到项目；含预算类升级(trigger/handoff)。
//   * 待评审提议 proposals(status in opened/reviewed) —— 经 work_item 挂到项目。
//   * 偏好冲突 memory conflicts 不计——它是 per-user（agent 记忆冲突）、无 work_item/project 归属，塞进项目
//     卡会张冠李戴。这与收件箱按 actor 可见性过滤的差异是**有意的**：digest 是项目级计数（全员一张卡），
//     不做 per-actor 收窄，故它数的是"本项目待决总数"而非"某个人能看到的条数"。
// 个人空间(is_personal)、已归档/已删除、无任何待决的项目天然不出现（压根不产出候选）。
export async function listProjectsWithPendingApprovals(
  db: WorkHubDb,
  input: { limit: number }
): Promise<PendingApprovalDigestRow[]> {
  // 三源统一成 (projectId, createdAt) 的行流后再按项目聚合——每一行是一件待决。work_items.project_id
  // NOT NULL，故 count(projectId)=count(*)=真实待决条数；min(createdAt) 取全部三源里最久的一条。
  const pendingDecisions = db
    .select({ projectId: workItems.projectId, createdAt: approvalRequests.createdAt })
    .from(approvalRequests)
    .innerJoin(workItems, and(eq(workItems.id, approvalRequests.workItemId), isNull(workItems.deletedAt)))
    .where(eq(approvalRequests.status, "pending"))
    .unionAll(
      db
        .select({ projectId: workItems.projectId, createdAt: escalationEvents.createdAt })
        .from(escalationEvents)
        .innerJoin(workItems, and(eq(workItems.id, escalationEvents.workItemId), isNull(workItems.deletedAt)))
        .where(isNull(escalationEvents.resolvedAt))
    )
    .unionAll(
      db
        .select({ projectId: workItems.projectId, createdAt: proposals.createdAt })
        .from(proposals)
        .innerJoin(workItems, and(eq(workItems.id, proposals.workItemId), isNull(workItems.deletedAt)))
        // 待评审 = opened/reviewed（与 GET /attention 的 proposals 源、listReviewable 同口径）。
        .where(inArray(proposals.status, ["opened", "reviewed"]))
    )
    .as("pending_decisions");

  const rows = await db
    .select({
      projectId: projects.id,
      workspaceId: projects.workspaceId,
      mainConversationId: projectConversations.id,
      pendingCount: sql<number>`count(${pendingDecisions.projectId})::int`,
      oldestPendingAt: sql<Date>`min(${pendingDecisions.createdAt})`
    })
    .from(pendingDecisions)
    .innerJoin(
      projects,
      and(
        eq(projects.id, pendingDecisions.projectId),
        isNull(projects.deletedAt),
        eq(projects.archived, false),
        eq(projects.isPersonal, false)
      )
    )
    .innerJoin(
      projectConversations,
      and(
        eq(projectConversations.projectId, projects.id),
        eq(projectConversations.kind, "main"),
        isNull(projectConversations.deletedAt)
      )
    )
    .groupBy(projects.id, projects.workspaceId, projectConversations.id)
    .orderBy(asc(projects.id))
    .limit(input.limit);
  // workspace_id 是 schema 上的历史可空列——活跃项目恒有值；null 分支结构上不可达，用类型收窄换掉断言。
  // E2E-15：min(created_at) 经 pg 驱动回来是 string 而非 Date（sql<Date> 只是编译期标注），
  // 直接调 .getTime() 会在运行期炸（pulse 日志实证）。这里防御性水合成 Date。
  return rows.flatMap((row) =>
    row.workspaceId && row.oldestPendingAt
      ? [
          {
            projectId: row.projectId,
            workspaceId: row.workspaceId,
            mainConversationId: row.mainConversationId,
            pendingCount: row.pendingCount,
            oldestPendingAt: new Date(row.oldestPendingAt)
          }
        ]
      : []
  );
}

export type PendingDigestCardRow = {
  conversationId: string;
  workspaceId: string;
  projectId: string;
  messageId: string;
  seq: number;
  storedCount: number;
};

// §A3：现存的活 digest 卡（system_event 且 content_json.kind='pending_digest'，未墓碑）。按会话 + seq 降序
// 返回，服务层每会话取最新一张为「当前卡」、其余当重复卡一并墓碑。用于比对数字有没有变、以及归零收尾。
export async function listActivePendingDigestCards(
  db: WorkHubDb,
  input: { limit: number }
): Promise<PendingDigestCardRow[]> {
  return db
    .select({
      conversationId: conversationMessages.conversationId,
      workspaceId: projectConversations.workspaceId,
      projectId: projectConversations.projectId,
      messageId: conversationMessages.id,
      seq: conversationMessages.seq,
      storedCount: sql<number>`coalesce((${conversationMessages.contentJson}->>'pending_count')::int, 0)`
    })
    .from(conversationMessages)
    .innerJoin(
      projectConversations,
      and(
        eq(projectConversations.id, conversationMessages.conversationId),
        eq(projectConversations.kind, "main"),
        isNull(projectConversations.deletedAt)
      )
    )
    .where(
      and(
        eq(conversationMessages.kind, "system_event"),
        isNull(conversationMessages.deletedAt),
        sql`${conversationMessages.contentJson}->>'kind' = 'pending_digest'`
      )
    )
    .orderBy(asc(conversationMessages.conversationId), desc(conversationMessages.seq))
    .limit(input.limit);
}

// §A3：墓碑一张 digest 卡（软删——只置 deleted_at，seq 不回收、内容留痕）。系统作者（sender_user_id
// 为 null），不走 deleteMessage 那套 actor 校验。幂等：已墓碑/已不在则返回 false。
export async function tombstonePendingDigestCard(
  db: WorkHubDb,
  input: { conversationId: string; messageId: string; at: Date }
): Promise<boolean> {
  const updated = await db
    .update(conversationMessages)
    .set({ deletedAt: input.at })
    .where(
      and(
        eq(conversationMessages.id, input.messageId),
        eq(conversationMessages.conversationId, input.conversationId),
        eq(conversationMessages.kind, "system_event"),
        isNull(conversationMessages.deletedAt)
      )
    )
    .returning({ id: conversationMessages.id });
  return updated.length > 0;
}
