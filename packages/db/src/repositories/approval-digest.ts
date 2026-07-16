import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  approvalRequests,
  conversationMessages,
  projectConversations,
  projects,
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

// §A3：每个「有待办审批」的项目一行——待审批数 + 最久一条的创建时刻 + main 会话 id。个人空间
// （is_personal=true）、已归档/已删除、无待办审批的项目天然不出现（不是巡检时跳过，是压根不产出候选）。
// 只统计挂在工作项上、进而挂在项目上的 pending 审批（work_item_id 为空的审批无法归到项目，不计）。
export async function listProjectsWithPendingApprovals(
  db: WorkHubDb,
  input: { limit: number }
): Promise<PendingApprovalDigestRow[]> {
  const rows = await db
    .select({
      projectId: projects.id,
      workspaceId: projects.workspaceId,
      mainConversationId: projectConversations.id,
      pendingCount: sql<number>`count(${approvalRequests.id})::int`,
      oldestPendingAt: sql<Date>`min(${approvalRequests.createdAt})`
    })
    .from(approvalRequests)
    .innerJoin(workItems, and(eq(workItems.id, approvalRequests.workItemId), isNull(workItems.deletedAt)))
    .innerJoin(
      projects,
      and(
        eq(projects.id, workItems.projectId),
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
    .where(eq(approvalRequests.status, "pending"))
    .groupBy(projects.id, projects.workspaceId, projectConversations.id)
    .orderBy(asc(projects.id))
    .limit(input.limit);
  // workspace_id 是 schema 上的历史可空列——活跃项目恒有值；null 分支结构上不可达，用类型收窄换掉断言。
  return rows.flatMap((row) =>
    row.workspaceId && row.oldestPendingAt
      ? [
          {
            projectId: row.projectId,
            workspaceId: row.workspaceId,
            mainConversationId: row.mainConversationId,
            pendingCount: row.pendingCount,
            oldestPendingAt: row.oldestPendingAt
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
