import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";

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
  listForUser: (userId: string, options?: { includeArchived?: boolean }) => Promise<NotificationRow[]>;
  markRead: (id: string, userId: string, at: Date) => Promise<NotificationRow | null>;
  markAllRead: (userId: string, at: Date) => Promise<number>;
};

function sameContent(row: NotificationRow, input: CreateNotificationInput) {
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
      if (input.dedupeKey) {
        const existingRows = await db
          .select()
          .from(notifications)
          .where(and(eq(notifications.userId, input.userId), eq(notifications.dedupeKey, input.dedupeKey)))
          .orderBy(desc(notifications.createdAt))
          .limit(1);
        const existing = existingRows[0];
        if (existing) {
          if (sameContent(existing, input)) {
            return { notification: existing, created: false, resurfaced: false };
          }
          const updatedRows = await db
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

      const rows = await db
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
          dedupeKey: input.dedupeKey
        })
        .returning();
      const notification = rows[0];
      if (!notification) {
        throw new Error("Failed to create notification");
      }
      return { notification, created: true, resurfaced: true };
    },

    async listForUser(userId, options = {}) {
      return db
        .select()
        .from(notifications)
        .where(
          options.includeArchived
            ? eq(notifications.userId, userId)
            : and(eq(notifications.userId, userId), isNull(notifications.archivedAt))
        )
        .orderBy(desc(notifications.createdAt));
    },

    async markRead(id, userId, at) {
      const rows = await db
        .update(notifications)
        .set({ readAt: at, updatedAt: at })
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
        .returning();
      return rows[0] ?? null;
    },

    async markAllRead(userId, at) {
      const rows = await db
        .update(notifications)
        .set({ readAt: at, updatedAt: at })
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
        .returning({ id: notifications.id });
      return rows.length;
    }
  };
}
