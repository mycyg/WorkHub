import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull, lt, or, sql, like, ne } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { notifications } from "../schema/index.js";

export type NotificationRow = typeof notifications.$inferSelect;

export type CreateNotificationInput = {
  id?: string;
  userId: string;
  type: string;
  severity: string;
  title: string;
  body?: string;
  targetUrl?: string;
  projectId?: string;
  workItemId?: string;
  dedupeKey?: string;
};

export type NotificationWriteResult = {
  notification: NotificationRow;
  created: boolean;
  resurfaced: boolean;
};

export type NotificationRepository = {
  createOrUpdateNotification: (input: CreateNotificationInput, at: Date) => Promise<NotificationWriteResult>;
  findByIdForUser: (id: string, userId: string) => Promise<NotificationRow | null>;
  listForUser: (userId: string, options?: {
    includeArchived?: boolean;
    limit?: number;
    unreadOnly?: boolean;
    before?: { createdAt: Date; id: string };
  }) => Promise<NotificationRow[]>;
  markRead: (id: string, userId: string, at: Date) => Promise<NotificationRow | null>;
  markReadMany: (ids: string[], userId: string, at: Date) => Promise<number>;
  markAllRead: (userId: string, at: Date, options?: { excludeNeedsDecision?: boolean }) => Promise<number>;
  archive: (id: string, userId: string, at: Date) => Promise<NotificationRow | null>;
  archiveByDedupeKey: (dedupeKey: string, at: Date) => Promise<number>;
  archiveStaleLifecycleForWorkItem: (workItemId: string, keepType: string, at: Date) => Promise<number>;
};

// M10：导出供读路径（schedule-notify-pages.ensureMeetingInsightNotifications）做"内容未变则跳过 upsert"的门，
// 与本仓库内部的去重判定共用同一份逻辑，避免漂移。
export function notificationContentMatches(row: NotificationRow, input: CreateNotificationInput) {
  return (
    row.type === input.type &&
    row.severity === input.severity &&
    row.title === input.title &&
    row.body === (input.body ?? null) &&
    row.targetUrl === (input.targetUrl ?? null) &&
    row.projectId === (input.projectId ?? null) &&
    row.workItemId === (input.workItemId ?? null)
  );
}

export function createNotificationRepository(db: WorkHubDb): NotificationRepository {
  return {
    async createOrUpdateNotification(input, at) {
      // 整笔放进事务，且插入用 onConflictDoUpdate 兜底并发：read→insert 之间若另一笔已插入同
      // (user_id, dedupeKey)，靠分部唯一索引把"重复插入"收敛成"复活更新"，不再产生重复通知（M13/M15）。
      return db.transaction(async (tx) => {
        if (input.dedupeKey) {
          const existingRows = await tx
            .select()
            .from(notifications)
            .where(and(eq(notifications.userId, input.userId), eq(notifications.dedupeKey, input.dedupeKey)))
            .orderBy(desc(notifications.createdAt))
            .limit(1);
          const existing = existingRows[0];
          if (existing) {
            if (notificationContentMatches(existing, input)) {
              return { notification: existing, created: false, resurfaced: false };
            }
            const updatedRows = await tx
              .update(notifications)
              .set({
                type: input.type,
                severity: input.severity,
                title: input.title,
                body: input.body,
                targetUrl: input.targetUrl,
                projectId: input.projectId,
                workItemId: input.workItemId,
                readAt: null,
                archivedAt: null,
                updatedAt: at
              })
              .where(eq(notifications.id, existing.id))
              .returning();
            const updated = updatedRows[0];
            if (!updated) {
              throw new Error("Failed to update notification");
            }
            return { notification: updated, created: false, resurfaced: true };
          }
        }

        const insert = tx
          .insert(notifications)
          .values({
            id: input.id ?? randomUUID(),
            userId: input.userId,
            type: input.type,
            severity: input.severity,
            title: input.title,
            body: input.body,
            targetUrl: input.targetUrl,
            projectId: input.projectId,
            workItemId: input.workItemId,
            dedupeKey: input.dedupeKey,
            // findings[14]：显式把两个时间戳钉成同一个 `at`，让「真插入 ⇒ created_at === updated_at」成为确定不变式；
            // 冲突更新分支只改 updated_at（见下），据此精确区分真插入与并发收敛的更新。
            createdAt: at,
            updatedAt: at
          });
        // 仅当带 dedupeKey 时才可能撞分部唯一索引；用 upsert 复活，避免并发下抛唯一冲突。
        const rows = input.dedupeKey
          ? await insert
            .onConflictDoUpdate({
              target: [notifications.userId, notifications.dedupeKey],
              targetWhere: sql`${notifications.dedupeKey} is not null`,
              set: {
                type: input.type,
                severity: input.severity,
                title: input.title,
                body: input.body,
                targetUrl: input.targetUrl,
                projectId: input.projectId,
                workItemId: input.workItemId,
                readAt: null,
                archivedAt: null,
                updatedAt: at
              }
            })
            .returning()
          : await insert.returning();
        const notification = rows[0];
        if (!notification) {
          throw new Error("Failed to create notification");
        }
        // findings[14]：onConflictDoUpdate 既可能是真插入，也可能是把「读到无→插入」期间另一笔并发插入
        // 收敛成更新。不能恒报 created:true，否则下游用 created 做「新通知」计数/推送会把更新双计。
        // 真插入时 created_at/updated_at 同为本次 at（相等）；冲突更新只动 updated_at → 二者不等。
        // resurfaced 仍恒 true：它在 service 层表示「值得推送」（新建或有变更都要发），与 created 语义不同。
        const created = notification.createdAt.getTime() === notification.updatedAt.getTime();
        return { notification, created, resurfaced: true };
      });
    },

    async findByIdForUser(id, userId) {
      const rows = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async listForUser(userId, options = {}) {
      const conditions = [
        eq(notifications.userId, userId),
        ...(options.includeArchived ? [] : [isNull(notifications.archivedAt)]),
        ...(options.unreadOnly ? [isNull(notifications.readAt)] : []),
        ...(options.before
          ? [or(
              lt(notifications.createdAt, options.before.createdAt),
              and(eq(notifications.createdAt, options.before.createdAt), lt(notifications.id, options.before.id))
            )!]
          : [])
      ];
      return db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(Math.max(1, Math.min(options.limit ?? 200, 500)));
    },

    async markRead(id, userId, at) {
      const rows = await db
        .update(notifications)
        .set({ readAt: at, updatedAt: at })
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
        .returning();
      return rows[0] ?? null;
    },

    async markReadMany(ids, userId, at) {
      if (ids.length === 0) {
        return 0;
      }
      const rows = await db
        .update(notifications)
        .set({ readAt: at, updatedAt: at })
        .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids), isNull(notifications.readAt)))
        .returning({ id: notifications.id });
      return rows.length;
    },

    async markAllRead(userId, at, options = {}) {
      // R12（批量效率）：「全部已读」默认不吞掉待决策——needs_decision（severity high/urgent 或
      // 决策类 type，与 isNeedsDecisionNotification 同口径）保持未读，避免「已读但未处理」被视觉埋没。
      const needsDecision = or(
        inArray(notifications.severity, ["high", "urgent"]),
        sql`${notifications.type} ~ 'approval|ask|pending|insight|escalated|in_review|review|decision'`
      );
      const rows = await db
        .update(notifications)
        .set({ readAt: at, updatedAt: at })
        .where(and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          ...(options.excludeNeedsDecision ? [sql`NOT (${needsDecision})`] : [])
        ))
        .returning({ id: notifications.id });
      return rows.length;
    },

    async archive(id, userId, at) {
      const rows = await db
        .update(notifications)
        .set({ readAt: at, archivedAt: at, updatedAt: at })
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
        .returning();
      return rows[0] ?? null;
    },

    // R7（通知闭环）：事项被处理后按 dedupeKey 归档对应通知（跨用户——处理人未必是被通知人），
    // 不再留「点开找不到事」的孤儿通知永久卡在待决策桶。
    async archiveByDedupeKey(dedupeKey: string, at: Date) {
      // 前缀匹配：转交产生的通知 dedupeKey 带 `:delegated:<userId>` 后缀，respond 归档时要一并清。
      const rows = await db
        .update(notifications)
        .set({ readAt: at, archivedAt: at, updatedAt: at })
        .where(and(
          or(eq(notifications.dedupeKey, dedupeKey), like(notifications.dedupeKey, `${dedupeKey}:%`)),
          isNull(notifications.archivedAt)
        ))
        .returning();
      return rows.length;
    },

    // R7（通知闭环）：工作项推进到新里程碑时，归档同一工作项上更早的 lifecycle 通知
    // （workitem.* 且非本次类型）——旧通知描述的状态已经不成立了。
    async archiveStaleLifecycleForWorkItem(workItemId: string, keepType: string, at: Date) {
      const rows = await db
        .update(notifications)
        .set({ readAt: at, archivedAt: at, updatedAt: at })
        .where(and(
          eq(notifications.workItemId, workItemId),
          isNull(notifications.archivedAt),
          like(notifications.type, "workitem.%"),
          ne(notifications.type, keepType)
        ))
        .returning();
      return rows.length;
    }
  };
}
