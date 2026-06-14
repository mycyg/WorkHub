import {
  eventTypes,
  type Notification,
  type NotificationList
} from "@workhub/contracts";
import {
  createAuditLogRepository,
  getSharedDatabaseClient,
  createNotificationRepository,
  type AuditLogRepository,
  type NotificationRepository,
  type NotificationRow,
  type WorkHubDatabaseClient
} from "@workhub/db";
import {
  createLifecycleNotificationDrafts,
  topics,
  type MilestoneNotificationContext,
  type NotificationDraft
} from "@workhub/events";

import { getDefaultPushBus } from "../broker/index.js";
import type { PushBus } from "../broker/types.js";

export class NotificationServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type NotificationServiceDependencies = {
  notifications: NotificationRepository;
  audit?: AuditLogRepository;
  bus?: Pick<PushBus, "publish">;
  now?: () => Date;
};

export type NotificationService = ReturnType<typeof createNotificationService>;

let defaultDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultNotificationServiceDependencies(): NotificationServiceDependencies {
  defaultDbClient ??= getSharedDatabaseClient();
  return {
    notifications: createNotificationRepository(defaultDbClient.db),
    audit: createAuditLogRepository(defaultDbClient.db),
    bus: getDefaultPushBus()
  };
}

export function toNotificationResponse(row: NotificationRow): Notification {
  const notification: Notification = {
    id: row.id,
    user_id: row.userId,
    type: row.type,
    severity: row.severity as Notification["severity"],
    title: row.title,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
  if (row.body) {
    notification.body = row.body;
  }
  if (row.targetUrl) {
    notification.target_url = row.targetUrl;
  }
  if (row.projectId) {
    notification.project_id = row.projectId;
  }
  if (row.workItemId) {
    notification.work_item_id = row.workItemId;
  }
  if (row.dedupeKey) {
    notification.dedupe_key = row.dedupeKey;
  }
  if (row.readAt) {
    notification.read_at = row.readAt.toISOString();
  }
  if (row.archivedAt) {
    notification.archived_at = row.archivedAt.toISOString();
  }
  return notification;
}

async function publishNotification(
  bus: Pick<PushBus, "publish"> | undefined,
  row: NotificationRow
) {
  if (!bus) {
    return;
  }
  await bus.publish(topics.user(row.userId).topic, eventTypes.notificationCreated, toNotificationResponse(row));
}

export function createNotificationService(
  deps: NotificationServiceDependencies = getDefaultNotificationServiceDependencies()
) {
  const now = deps.now ?? (() => new Date());

  async function auditNotificationAction(input: {
    userId: string;
    entityId: string;
    action: string;
    detailJson?: Record<string, unknown>;
  }) {
    if (!deps.audit) {
      return;
    }
    await deps.audit.createAuditLog({
      actorKind: "human",
      actorUserId: input.userId,
      entityType: "notification",
      entityId: input.entityId,
      action: input.action,
      detailJson: input.detailJson ?? {}
    });
  }

  async function flushDraft(draft: NotificationDraft) {
    const result = await deps.notifications.createOrUpdateNotification(
      {
        userId: draft.userId,
        type: draft.type,
        severity: draft.severity,
        title: draft.title,
        body: draft.body,
        targetUrl: draft.targetUrl,
        workItemId: draft.workItemId,
        dedupeKey: draft.dedupeKey,
        ...(draft.projectId ? { projectId: draft.projectId } : {})
      },
      now()
    );
    if (result.resurfaced) {
      await publishNotification(deps.bus, result.notification);
    }
    return result.notification;
  }

  return {
    queueMilestoneNotifications(context: MilestoneNotificationContext) {
      return createLifecycleNotificationDrafts(context);
    },

    async flushNotificationDrafts(drafts: NotificationDraft[]) {
      const rows = [];
      for (const draft of drafts) {
        rows.push(await flushDraft(draft));
      }
      return rows.map(toNotificationResponse);
    },

    async notifyMilestone(context: MilestoneNotificationContext) {
      return this.flushNotificationDrafts(this.queueMilestoneNotifications(context));
    },

    async createNotification(draft: NotificationDraft) {
      return toNotificationResponse(await flushDraft(draft));
    },

    async listForUser(userId: string): Promise<NotificationList> {
      const rows = await deps.notifications.listForUser(userId);
      const items = rows.map(toNotificationResponse);
      return {
        items,
        counts: {
          unread: rows.filter((row) => !row.readAt).length,
          total: rows.length
        }
      };
    },

    async markRead(id: string, userId: string) {
      const row = await deps.notifications.markRead(id, userId, now());
      if (!row) {
        throw new NotificationServiceError(404, "not_found", "没有找到这条通知。");
      }
      await auditNotificationAction({
        userId,
        entityId: id,
        action: "notification.mark_read"
      });
      return toNotificationResponse(row);
    },

    async markAllRead(userId: string) {
      const updated = await deps.notifications.markAllRead(userId, now());
      if (deps.audit) {
        await deps.audit.createAuditLog({
          actorKind: "human",
          actorUserId: userId,
          entityType: "notification_bulk",
          entityId: userId,
          action: "notification.mark_all_read",
          detailJson: { updated }
        });
      }
      return { updated };
    },

    async dismiss(id: string, userId: string) {
      const row = await deps.notifications.archive(id, userId, now());
      if (!row) {
        throw new NotificationServiceError(404, "not_found", "没有找到这条通知。");
      }
      await auditNotificationAction({
        userId,
        entityId: id,
        action: "notification.dismiss"
      });
      return toNotificationResponse(row);
    },

    async complete(id: string, userId: string) {
      const row = await deps.notifications.archive(id, userId, now());
      if (!row) {
        throw new NotificationServiceError(404, "not_found", "没有找到这条通知。");
      }
      await auditNotificationAction({
        userId,
        entityId: id,
        action: "notification.complete"
      });
      return toNotificationResponse(row);
    }
  };
}
