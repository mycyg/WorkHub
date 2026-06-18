import {
  eventTypes,
  type Notification,
  type NotificationList
} from "@workhub/contracts";
import {
  createAuditLogRepository,
  getSharedDatabaseClient,
  createNotificationRepository,
  createUserRepository,
  type AuditLogRepository,
  type NotificationRepository,
  type NotificationRow,
  type UserRepository,
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
  // 团队就绪 must-have（通知偏好-按类型静音）：查收件人是否静音了该通知类型。
  // OPTIONAL（缺失/不实现则不静音，按今天创建）——保 DEFAULT-OFF。
  users?: Pick<UserRepository, "getMutedNotificationTypes" | "setMutedNotificationTypes">;
  now?: () => Date;
};

export type NotificationService = ReturnType<typeof createNotificationService>;

let defaultDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultNotificationServiceDependencies(): NotificationServiceDependencies {
  defaultDbClient ??= getSharedDatabaseClient();
  return {
    notifications: createNotificationRepository(defaultDbClient.db),
    audit: createAuditLogRepository(defaultDbClient.db),
    users: createUserRepository(defaultDbClient.db),
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

  // 团队就绪 must-have（通知偏好-按类型静音）：收件人是否把该 TYPE 静音了。
  // CRITICAL DEFAULT-OFF：偏好查询不可用 / 抛错 / 返回空 → 一律不静音（按今天创建）。
  // 全程防御式包裹——保证「无静音偏好」时既有行为 + PG smoke 字节不变。
  async function isMutedForRecipient(userId: string, type: string): Promise<boolean> {
    if (!deps.users?.getMutedNotificationTypes) {
      return false;
    }
    try {
      const muted = await deps.users.getMutedNotificationTypes(userId);
      return Array.isArray(muted) && muted.includes(type);
    } catch {
      // fail-open：任何查询异常都不静音。
      return false;
    }
  }

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

  async function flushDraft(draft: NotificationDraft): Promise<NotificationRow | null> {
    // 团队就绪 must-have：收件人静音了该类型则跳过、不建（DEFAULT-OFF：查询不可用/空则照建）。
    if (await isMutedForRecipient(draft.userId, draft.type)) {
      return null;
    }
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
        const row = await flushDraft(draft);
        // 团队就绪 must-have：被静音的收件人草稿返回 null（未建），从结果里剔除。
        if (row) {
          rows.push(row);
        }
      }
      return rows.map(toNotificationResponse);
    },

    async notifyMilestone(context: MilestoneNotificationContext) {
      return this.flushNotificationDrafts(this.queueMilestoneNotifications(context));
    },

    async createNotification(draft: NotificationDraft): Promise<Notification | null> {
      // 团队就绪 must-have：收件人静音了该类型则返回 null（未建）。
      const row = await flushDraft(draft);
      return row ? toNotificationResponse(row) : null;
    },

    // @mentions：评论里 @某人时给被点名的活跃用户发一条通知。与 flushDraft 同一条写入路径
    // （createOrUpdateNotification + bus 复活推送），但 workItemId/targetUrl 是可选的——审批/网盘
    // 评论不一定挂在工作项上，而 NotificationDraft 的 workItemId 是必填，故走仓库的可选字段。
    async createMentionNotification(input: {
      userId: string;
      title: string;
      body: string;
      severity?: NotificationDraft["severity"];
      targetUrl?: string;
      workItemId?: string;
      projectId?: string;
      dedupeKey: string;
    }): Promise<Notification | null> {
      // 团队就绪 must-have：收件人静音了 comment.mention 则跳过、不建（DEFAULT-OFF：查询不可用/空则照建）。
      if (await isMutedForRecipient(input.userId, "comment.mention")) {
        return null;
      }
      const result = await deps.notifications.createOrUpdateNotification(
        {
          userId: input.userId,
          type: "comment.mention",
          severity: input.severity ?? "normal",
          title: input.title,
          body: input.body,
          dedupeKey: input.dedupeKey,
          ...(input.targetUrl ? { targetUrl: input.targetUrl } : {}),
          ...(input.workItemId ? { workItemId: input.workItemId } : {}),
          ...(input.projectId ? { projectId: input.projectId } : {})
        },
        now()
      );
      if (result.resurfaced) {
        await publishNotification(deps.bus, result.notification);
      }
      return toNotificationResponse(result.notification);
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

    // 团队就绪 must-have（通知偏好-按类型静音）：读该用户被静音的类型清单（DEFAULT-OFF：缺仓库/无行回 []）。
    async getPreferences(userId: string): Promise<{ muted_notification_types: string[] }> {
      const muted = deps.users?.getMutedNotificationTypes
        ? await deps.users.getMutedNotificationTypes(userId)
        : [];
      return { muted_notification_types: Array.isArray(muted) ? muted : [] };
    },

    // 写静音类型清单。入参须先经路由校验为去重的非空字符串数组。仓库未实现则回 501。
    async setPreferences(
      userId: string,
      mutedNotificationTypes: string[]
    ): Promise<{ muted_notification_types: string[] }> {
      if (!deps.users?.setMutedNotificationTypes) {
        throw new NotificationServiceError(501, "not_implemented", "当前部署不支持通知偏好设置。");
      }
      const updated = await deps.users.setMutedNotificationTypes(userId, mutedNotificationTypes);
      if (!updated) {
        throw new NotificationServiceError(404, "not_found", "没有找到这个用户。");
      }
      await auditNotificationAction({
        userId,
        entityId: userId,
        action: "notification.set_preferences",
        detailJson: { muted_notification_types: mutedNotificationTypes }
      });
      return { muted_notification_types: updated.mutedNotificationTypes };
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
