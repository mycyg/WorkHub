import {
  eventTypes,
  notificationSeveritySchema,
  type Notification,
  type NotificationList
} from "@workhub/contracts";
import {
  createAuditLogRepository,
  getSharedDatabaseClient,
  createNotificationRepository,
  createWorkItemRepository,
  createUserRepository,
  type AuditLogRepository,
  type NotificationRepository,
  type NotificationRow,
  type UserRepository,
  type WorkItemDataRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import { canViewProjectDrive, canViewWorkItemRecord } from "@workhub/permissions";
import {
  createLifecycleNotificationDrafts,
  topics,
  type MilestoneNotificationContext,
  type NotificationDraft
} from "@workhub/events";

import { getDefaultPushBus } from "../broker/index.js";
import type { PushBus } from "../broker/types.js";
import type { AuthActor } from "../middleware/auth.js";

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
  workItems?: Pick<WorkItemDataRepository, "findWorkItemAccessRecord"> & Partial<Pick<WorkItemDataRepository, "findProjectById">>;
  now?: () => Date;
};

type NotificationMutationOptions = {
  actor?: AuthActor;
};

export type NotificationService = ReturnType<typeof createNotificationService>;

let defaultDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultNotificationServiceDependencies(): NotificationServiceDependencies {
  defaultDbClient ??= getSharedDatabaseClient();
  return {
    notifications: createNotificationRepository(defaultDbClient.db),
    audit: createAuditLogRepository(defaultDbClient.db),
    users: createUserRepository(defaultDbClient.db),
    workItems: createWorkItemRepository(defaultDbClient.db),
    bus: getDefaultPushBus()
  };
}

function coerceNotificationSeverity(value: string): Notification["severity"] {
  const parsed = notificationSeveritySchema.safeParse(value);
  return parsed.success ? parsed.data : "normal";
}

export function isNeedsDecisionNotification(row: Pick<NotificationRow, "archivedAt" | "severity" | "type">) {
  if (row.archivedAt) {
    return false;
  }
  return row.severity === "high" ||
    row.severity === "urgent" ||
    /approval|ask|pending|insight|escalated|in_review|review|decision/u.test(row.type);
}

export function normalizeMutedNotificationTypes(values: readonly unknown[]): string[] {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 64 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    cleaned.push(trimmed);
  }
  return cleaned;
}

function targetUrlBelongsToWorkItem(targetUrl: string | null, workItemId: string) {
  if (!targetUrl) {
    return false;
  }
  const escapedId = workItemId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^/(?:api/pages/)?workitems/${escapedId}(?:$|[/?#])`, "u").test(targetUrl);
}

export function toNotificationResponse(row: NotificationRow, options: {
  stripUnreadableWorkItemTarget?: boolean;
} = {}): Notification {
  const notification: Notification = {
    id: row.id,
    user_id: row.userId,
    type: row.type,
    severity: coerceNotificationSeverity(row.severity),
    title: row.title,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
  if (row.body) {
    notification.body = row.body;
  }
  const stripWorkItemTarget = options.stripUnreadableWorkItemTarget === true && Boolean(row.workItemId);
  if (row.targetUrl && !(stripWorkItemTarget && targetUrlBelongsToWorkItem(row.targetUrl, row.workItemId!))) {
    notification.target_url = row.targetUrl;
  }
  if (row.projectId) {
    notification.project_id = row.projectId;
  }
  if (row.workItemId && !stripWorkItemTarget) {
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
  try {
    await bus.publish(topics.user(row.userId).topic, eventTypes.notificationCreated, toNotificationResponse(row));
  } catch (error) {
    console.warn("notification_publish_failed", { notificationId: row.id, userId: row.userId, error });
  }
}

export function createNotificationService(
  deps: NotificationServiceDependencies = getDefaultNotificationServiceDependencies()
) {
  const now = deps.now ?? (() => new Date());

  async function readableWorkItemIdsForRows(rows: NotificationRow[], actor: AuthActor | undefined) {
    if (!actor || !deps.workItems) {
      return undefined;
    }
    const ids = [...new Set(rows.map((row) => row.workItemId).filter((id): id is string => Boolean(id)))];
    const readable = new Set<string>();
    // 批量化：去重后的 workItemId 集合并发查一次（而非逐条串行 await），避免 N+1 读放大；
    // findWorkItemAccessRecord 本身仍是单行查询（不动 work-items 仓库），但并发发出。
    const records = await Promise.all(ids.map((id) => deps.workItems!.findWorkItemAccessRecord(id)));
    ids.forEach((id, index) => {
      const record = records[index];
      if (!record) {
        return;
      }
      if (canViewWorkItemRecord(
        record,
        { id: actor.userId ?? actor.id, isAdmin: actor.isAdmin },
        { workspaceId: actor.workspaceId }
      )) {
        readable.add(id);
      }
    });
    return readable;
  }

  async function readableProjectIdsForRows(rows: NotificationRow[], actor: AuthActor | undefined) {
    if (!actor || !deps.workItems?.findProjectById) {
      return undefined;
    }
    const ids = [...new Set(rows
      .map((row) => row.projectId)
      .filter((id): id is string => Boolean(id))
    )];
    const readable = new Set<string>();
    // 批量化：同上，去重后的 projectId 集合并发查一次。
    const findProjectById = deps.workItems.findProjectById;
    const projects = await Promise.all(ids.map((id) => findProjectById(id)));
    ids.forEach((id, index) => {
      const project = projects[index];
      if (!project) {
        return;
      }
      if (canViewProjectDrive(project, {
        id: actor.userId ?? actor.id,
        ...(actor.userId ? { userId: actor.userId } : {}),
        isAdmin: actor.isAdmin,
        orgId: actor.orgId,
        workspaceId: actor.workspaceId
      })) {
        readable.add(id);
      }
    });
    return readable;
  }

  async function visibleRowsForActorWithMetadata(rows: NotificationRow[], actor: AuthActor | undefined) {
    const [readableWorkItemIds, readableProjectIds] = await Promise.all([
      readableWorkItemIdsForRows(rows, actor),
      readableProjectIdsForRows(rows, actor)
    ]);
    return rows.flatMap((row) => {
      const workItemReadable = !readableWorkItemIds || !row.workItemId || readableWorkItemIds.has(row.workItemId);
      const projectReadable = Boolean(row.projectId && readableProjectIds?.has(row.projectId));
      const projectUnreadable = Boolean(readableProjectIds && row.projectId && !readableProjectIds.has(row.projectId));
      if (!workItemReadable && !projectReadable) {
        return [];
      }
      if (!row.workItemId && projectUnreadable) {
        return [];
      }
      return [{
        row,
        stripUnreadableWorkItemTarget: !workItemReadable && projectReadable
      }];
    });
  }

  async function visibleRowsForActor(rows: NotificationRow[], actor: AuthActor | undefined) {
    return (await visibleRowsForActorWithMetadata(rows, actor)).map((entry) => entry.row);
  }

  async function requireVisibleNotification(row: NotificationRow, actor: AuthActor | undefined) {
    const visibleRows = await visibleRowsForActorWithMetadata([row], actor);
    const visible = visibleRows[0];
    if (!visible) {
      throw new NotificationServiceError(404, "not_found", "没有找到这条通知。");
    }
    return visible;
  }

  // 团队就绪 must-have（通知偏好-按类型静音）：收件人是否把该 TYPE 静音了。
  // CRITICAL DEFAULT-OFF：偏好查询不可用 / 抛错 / 返回空 → 一律不静音（按今天创建）。
  // 全程防御式包裹——保证「无静音偏好」时既有行为 + PG smoke 字节不变。
  async function isMutedForRecipient(userId: string, type: string): Promise<boolean> {
    if (!deps.users?.getMutedNotificationTypes) {
      return false;
    }
    try {
      const muted = await deps.users.getMutedNotificationTypes(userId);
      return Array.isArray(muted) && normalizeMutedNotificationTypes(muted).includes(type);
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
    try {
      await deps.audit.createAuditLog({
        actorKind: "human",
        actorUserId: input.userId,
        entityType: "notification",
        entityId: input.entityId,
        action: input.action,
        detailJson: input.detailJson ?? {}
      });
    } catch (error) {
      console.warn("notification_audit_write_failed", { action: input.action, entityId: input.entityId, error });
    }
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
      return rows.map((row) => toNotificationResponse(row));
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

    async listForUser(input: string | { userId: string; actor?: AuthActor }): Promise<NotificationList> {
      const userId = typeof input === "string" ? input : input.userId;
      const actor = typeof input === "string" ? undefined : input.actor;
      // R9 批次1-2 性能收口：恢复输出硬上限(与旧 repo 默认一致=200)。actor 存在时通知需要按可见性
      // 过滤才知道"哪些真正可见"，所以仍要翻页扫描——但扫描本身也要有界，否则老账号几千条历史通知
      // 会被整页翻穿。上限=3×输出上限，足够越过一批不可见的通知去找更早的可见通知（回归测试：
      // 500 条不可见 + 1 条可见时仍能找到），但不会真的翻完全量历史。
      const outputCap = 200;
      const scanCap = outputCap * 3;
      const visibleEntries: Array<{ row: NotificationRow; stripUnreadableWorkItemTarget: boolean }> = [];
      let before: { createdAt: Date; id: string } | undefined;
      let scanned = 0;
      const pageLimit = 200;
      for (;;) {
        const rows = await deps.notifications.listForUser(userId, before ? { limit: pageLimit, before } : { limit: pageLimit });
        scanned += rows.length;
        visibleEntries.push(...await visibleRowsForActorWithMetadata(rows, actor));
        if (rows.length < pageLimit) {
          break;
        }
        if (visibleEntries.length >= outputCap || scanned >= scanCap) {
          break;
        }
        const last = rows.at(-1);
        if (!last) {
          break;
        }
        before = { createdAt: last.createdAt, id: last.id };
      }
      const capped = visibleEntries.slice(0, outputCap);
      const items = capped.map((entry) => toNotificationResponse(
        entry.row,
        entry.stripUnreadableWorkItemTarget ? { stripUnreadableWorkItemTarget: true } : {}
      ));
      return {
        items,
        counts: {
          // 计数口径与实际返回的 items 一致（如实反映"这次返回了多少"，不虚报未扫描到的历史总量）。
          unread: capped.filter((entry) => !entry.row.readAt).length,
          total: capped.length
        }
      };
    },

    // 团队就绪 must-have（通知偏好-按类型静音）：读该用户被静音的类型清单（DEFAULT-OFF：缺仓库/无行回 []）。
    async getPreferences(userId: string): Promise<{ muted_notification_types: string[] }> {
      const muted = deps.users?.getMutedNotificationTypes
        ? await deps.users.getMutedNotificationTypes(userId)
        : [];
      return { muted_notification_types: Array.isArray(muted) ? normalizeMutedNotificationTypes(muted) : [] };
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
      return { muted_notification_types: normalizeMutedNotificationTypes(updated.mutedNotificationTypes) };
    },

    async markRead(id: string, userId: string, options: NotificationMutationOptions = {}) {
      const existing = await deps.notifications.findByIdForUser(id, userId);
      if (!existing) {
        throw new NotificationServiceError(404, "not_found", "没有找到这条通知。");
      }
      const visibility = await requireVisibleNotification(existing, options.actor);
      const row = await deps.notifications.markRead(id, userId, now());
      if (!row) {
        throw new NotificationServiceError(404, "not_found", "没有找到这条通知。");
      }
      await auditNotificationAction({
        userId,
        entityId: id,
        action: "notification.mark_read"
      });
      return toNotificationResponse(
        row,
        visibility.stripUnreadableWorkItemTarget ? { stripUnreadableWorkItemTarget: true } : {}
      );
    },

    async markAllRead(userId: string, options: NotificationMutationOptions = {}) {
      const at = now();
      let updated: number;
      if (options.actor) {
        updated = 0;
        let cursor: { createdAt: Date; id: string } | undefined;
        while (true) {
          const rows = await deps.notifications.listForUser(userId, {
            limit: 500,
            unreadOnly: true,
            ...(cursor ? { before: cursor } : {})
          });
          if (rows.length === 0) {
            break;
          }
          const visibleRows = await visibleRowsForActor(rows, options.actor);
          updated += await deps.notifications.markReadMany(visibleRows.map((row) => row.id), userId, at);
          const last = rows[rows.length - 1]!;
          cursor = { createdAt: last.createdAt, id: last.id };
        }
      } else {
        updated = await deps.notifications.markAllRead(userId, at);
      }
      await auditNotificationAction({
        userId,
        entityId: userId,
        action: "notification.mark_all_read",
        detailJson: { updated }
      });
      return { updated };
    },

    async dismiss(id: string, userId: string, options: NotificationMutationOptions = {}) {
      const existing = await deps.notifications.findByIdForUser(id, userId);
      if (!existing) {
        throw new NotificationServiceError(404, "not_found", "没有找到这条通知。");
      }
      const visibility = await requireVisibleNotification(existing, options.actor);
      const row = await deps.notifications.archive(id, userId, now());
      if (!row) {
        throw new NotificationServiceError(404, "not_found", "没有找到这条通知。");
      }
      await auditNotificationAction({
        userId,
        entityId: id,
        action: "notification.dismiss"
      });
      return toNotificationResponse(
        row,
        visibility.stripUnreadableWorkItemTarget ? { stripUnreadableWorkItemTarget: true } : {}
      );
    },

    async complete(id: string, userId: string, options: NotificationMutationOptions = {}) {
      const existing = await deps.notifications.findByIdForUser(id, userId);
      if (!existing) {
        throw new NotificationServiceError(404, "not_found", "没有找到这条通知。");
      }
      const visibility = await requireVisibleNotification(existing, options.actor);
      if (isNeedsDecisionNotification(existing)) {
        throw new NotificationServiceError(409, "notification_needs_decision", "这条通知需要先打开来源处理，不能直接标为完成。");
      }
      const row = await deps.notifications.archive(id, userId, now());
      if (!row) {
        throw new NotificationServiceError(404, "not_found", "没有找到这条通知。");
      }
      await auditNotificationAction({
        userId,
        entityId: id,
        action: "notification.complete"
      });
      return toNotificationResponse(
        row,
        visibility.stripUnreadableWorkItemTarget ? { stripUnreadableWorkItemTarget: true } : {}
      );
    }
  };
}
