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
import { getDefaultStructuredLogger } from "../logging.js";
import type { PushBus } from "../broker/types.js";
import type { AuthActor } from "../middleware/auth.js";
import { isUuidParam } from "../routes/uuid-param.js";

export class NotificationServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

// R15 批 A（提醒阶梯 · 01-batch-a-pipeline.md §A2）：硬编码策略。approval.routed 类通知创建即置
// next_remind_at = 创建时刻 + 24h；此后每次 notification-reminder tick 复活推送并把 next_remind_at 再 +24h，
// reminder_count 达上限 3 后置空停止续期（approval 类的进一步升级交给 expireDueApprovals 既有分流，
// 不在此重复造）。approvals.ts 创建 approval.routed 时复用同一个间隔常量。
export const APPROVAL_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const REMINDER_MAX_COUNT = 3;

// R15 批 F（主动关怀 · opt-out）：关怀消息走会话通道、不走通知，但「不想收关怀」这个偏好复用既有
// 「通知按类型静音」列（users.muted_notification_types）——保留一个专用伪类型承载它，无新列、无迁移，
// 复用既有 GET/PUT /notifications/preferences 端点。默认（清单里没有它）= 开启关怀。care-scan 与偏好
// 端点都引用这个常量作单一真相（放在 notifications 是因它本质是保留的通知类型名，且避免 import 环）。
export const CARE_MESSAGE_MUTE_TYPE = "care.message";

export type NotificationReminderRunResult = {
  // 本 tick 扫到的到期待提醒行数。
  scanned: number;
  // 成功落一次提醒（复活 + 推 SSE）的行数（扫描与更新之间被读/归档的会落空，不计入）。
  reminded: number;
  // 本 tick 里达阶梯上限、next_remind_at 被置空的行数（此后不再提醒）。
  stopped: number;
};

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

// R13 批 P2（拍板链路收尾）：conversation_id 深链——notifications 表没有专门的列，这批不加迁移
// （范围围栏禁碰 schema），改用「已有的 target_url 自由文本字段」承载它：conversation-observer.ts
// 的 dispatch_ask 分支把 `?conversation_id=<uuid>` 追加进 target_url 查询串（targetUrlBelongsToWorkItem
// 的正则本来就用 `[/?#]` 收尾，早就容许 target_url 带查询串，不是新引入的兼容性风险），这里再解出来
// 暴露成响应体上独立的 conversation_id 字段（additive，见 packages/contracts 的 notificationSchema）。
// 解析失败/没有这个参数/不是合法 uuid 时一律返回 undefined——不假装知道，静默退化成"没有深链目标"。
// R14 FIX（通知深链缺 conversation_id）：导出给 schedule-notify-pages.ts 的通知页 VM 复用同一份解析
// 逻辑（DRY——两处都是从同一个 target_url 字段解同一个查询参数，没有理由各写一份正则）。
export function extractConversationIdFromTargetUrl(targetUrl: string | null | undefined): string | undefined {
  if (!targetUrl) {
    return undefined;
  }
  let conversationId: string | null;
  try {
    conversationId = new URL(targetUrl, "http://internal.workhub.invalid").searchParams.get("conversation_id");
  } catch {
    return undefined;
  }
  return conversationId && isUuidParam(conversationId) ? conversationId : undefined;
}

// R14 FIX（通知深链缺 conversation_id）：里程碑通知（workitem.escalated/workitem.in_review，见
// packages/events/src/lifecycle.ts 的 createLifecycleNotificationDrafts）原本 targetUrl 只指向工作项页，
// 没有任何会话上下文——但触发这些里程碑的 agent run 如果是从工作台会话里派发出去的
// （agent_runs.source_conversation_id，见 apps/api/src/workers/conversation-observer.ts 的
// dispatchExecuteItem auto 分支/agent-runner.ts 的 notifyRunMilestone），那次"升级"或"待审查"本质上
//就是那段会话讨论的后续。和 dispatch_ask 同一套约定：把 conversation_id 追加进 targetUrl 查询串，
// 不新增 notifications 表列、不改 packages/events 的契约类型（range fence：只碰 apps/api 侧）。
// 没有 source_conversation_id 的 run（不是从会话派发的）targetUrl 原样不变——不硬造。
function appendConversationIdToTargetUrl(targetUrl: string, conversationId: string | undefined): string {
  if (!conversationId || !isUuidParam(conversationId)) {
    return targetUrl;
  }
  const separator = targetUrl.includes("?") ? "&" : "?";
  return `${targetUrl}${separator}conversation_id=${encodeURIComponent(conversationId)}`;
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
    // R13 批 P2：只在 target_url 本身没被剥离（可见）时才附带 conversation_id——两者共享同一条
    // 可见性判定,不单独放宽。
    const conversationId = extractConversationIdFromTargetUrl(row.targetUrl);
    if (conversationId) {
      notification.conversation_id = conversationId;
    }
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
  // R15 批 A（A2 提醒阶梯）：提醒态——next_remind_at 非空说明这条通知还挂在 24h 叮嘱阶梯上，前端据此渲
  // 「暂停提醒」按钮；reminder_count 已提醒次数，只有 >0 才带（0 是默认、无信息量）。不进阶梯的通知
  // （next_remind_at=NULL）这两个字段就不出现，additive 零回归。
  if (row.nextRemindAt) {
    notification.next_remind_at = row.nextRemindAt.toISOString();
  }
  if (typeof row.reminderCount === "number" && row.reminderCount > 0) {
    notification.reminder_count = row.reminderCount;
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

  async function flushDraft(
    // R15 批 F：workItemId 放宽为可选——主动性 intent（如关怀）不一定挂工作项。底层
    // createOrUpdateNotification 本就接受可选 workItemId（见 createMentionNotification 先例）。
    draft: Omit<NotificationDraft, "workItemId"> & { workItemId?: string; nextRemindAt?: Date }
  ): Promise<NotificationRow | null> {
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
        ...(draft.workItemId ? { workItemId: draft.workItemId } : {}),
        dedupeKey: draft.dedupeKey,
        ...(draft.projectId ? { projectId: draft.projectId } : {}),
        // R15 批 A：进 24h 提醒阶梯的通知（approval.routed）带上首个 next_remind_at；其余不带。
        ...(draft.nextRemindAt ? { nextRemindAt: draft.nextRemindAt } : {})
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

    async notifyMilestone(context: MilestoneNotificationContext & { conversationId?: string }) {
      // R7（通知闭环）：新里程碑落地时，同一工作项上更早的 workitem.* 通知描述的状态已不成立——
      // 一并归档，不再让「已升级」「审阅中」在事项推进后仍卡在待决策桶。归档失败不翻通知创建。
      // R14 FIX：context.conversationId 是本批新增的可选透传参数（不进 packages/events 的契约类型，
      // 见上方 appendConversationIdToTargetUrl 注释）——有值时把它缝进每条 draft 的 targetUrl。
      const milestone = this.queueMilestoneNotifications(context).map((draft) => (
        context.conversationId
          ? { ...draft, targetUrl: appendConversationIdToTargetUrl(draft.targetUrl, context.conversationId) }
          : draft
      ));
      const keepType = milestone[0]?.type;
      if (keepType && context.workItem.id) {
        try {
          await deps.notifications.archiveStaleLifecycleForWorkItem(context.workItem.id, keepType, now());
        } catch (error) {
          getDefaultStructuredLogger().warn("lifecycle_notification_archive_failed", { workItemId: context.workItem.id, error });
        }
      }
      return this.flushNotificationDrafts(milestone);
    },

    // R7（通知闭环）：审批被处理/转交后归档对应 approval_routed 通知（跨用户）。
    async archiveByDedupeKey(dedupeKey: string) {
      return deps.notifications.archiveByDedupeKey(dedupeKey, now());
    },

    async createNotification(
      draft: Omit<NotificationDraft, "workItemId"> & { workItemId?: string; nextRemindAt?: Date }
    ): Promise<Notification | null> {
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

    // R15 批 A（A5 消息通知）：给会话里一个「其他参与者」落一条新消息通知。dedupe_key 按会话+收件人
    // 聚合——同会话多条未读复活成同一条（body 更新为最新预览 + 累计未读条数，复用 createOrUpdateNotification
    // 的 resurfaced 推送语义）。**不设 next_remind_at**（聊天不进 24h 叮嘱阶梯，见设计 A5）。在线抑制
    // （收件人是否正打开该会话）由调用方（conversation-message-notify.ts）在此之前判定，这里只负责静音
    // 检查 + 落库 + 复活推送。@mention 升格（conversation.mention，severity 高一档、独立 dedupe_key）预留
    // isMention 开关——本批消息 schema 无结构化 mention 数据，调用方不会传 true（见交付报告）。
    async createConversationMessageNotification(input: {
      userId: string;
      conversationId: string;
      projectId: string;
      conversationTitle: string;
      senderLabel: string;
      previewText: string;
      unreadCount: number;
      isMention?: boolean;
    }): Promise<Notification | null> {
      const type = input.isMention ? "conversation.mention" : "conversation.message";
      if (await isMutedForRecipient(input.userId, type)) {
        return null;
      }
      const dedupeKey = `${input.isMention ? "conversation_mention" : "conversation_msg"}:${input.conversationId}:${input.userId}`;
      const preview = input.previewText.trim().slice(0, 140);
      const count = Number.isFinite(input.unreadCount) && input.unreadCount > 0 ? Math.floor(input.unreadCount) : 1;
      const senderPrefix = input.senderLabel ? `${input.senderLabel}：` : "";
      const body = count > 1 ? `${senderPrefix}${preview}（${count} 条未读）` : `${senderPrefix}${preview}`;
      // 桌面既有深链格式：/workbench/<projectId>/<conversationId>（见 client-tauri window_controls
      // safe_route + desktop-webview buildWorkbenchDeepLinkHref）——notify.rs 的 OS 桥直接拿 target_url 当
      // 路由聚焦主窗到这条会话。额外附 ?conversation_id= 让 extractConversationIdFromTargetUrl 解出结构化
      // conversation_id（桌面 Cuu 气泡按 project_id+conversation_id 拼深链、web 通知页据此标注「在桌面
      // 工作台打开」）。web 端没有 /workbench 路由，退化为在 /notifications 列表里看到这条（web fallback）。
      const targetUrl =
        `/workbench/${encodeURIComponent(input.projectId)}/${encodeURIComponent(input.conversationId)}` +
        `?conversation_id=${encodeURIComponent(input.conversationId)}`;
      const result = await deps.notifications.createOrUpdateNotification(
        {
          userId: input.userId,
          type,
          severity: input.isMention ? "high" : "normal",
          title: input.conversationTitle,
          body,
          targetUrl,
          dedupeKey,
          projectId: input.projectId
          // 刻意不带 nextRemindAt：聊天消息不进 24h 提醒阶梯。
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
        },
        // R4（规模化）：真实通知数可能超过 outputCap——capped=true 让前端明说「列表被封顶」。
        capped: visibleEntries.length > outputCap || scanned >= scanCap
      };
    },

    // 团队就绪 must-have（通知偏好-按类型静音）：读该用户被静音的类型清单（DEFAULT-OFF：缺仓库/无行回 []）。
    // R15 批 F：额外派生 care_messages_enabled（关怀开关，默认 true）。关怀伪类型（CARE_MESSAGE_MUTE_TYPE）
    // 从用户可见的静音清单里剥离——它不是真正的通知类型，只用布尔字段表达，避免既有通知偏好 UI 把它当
    // 一条「静音类型」误显示/误清。
    async getPreferences(userId: string): Promise<{ muted_notification_types: string[]; care_messages_enabled: boolean }> {
      const muted = deps.users?.getMutedNotificationTypes
        ? await deps.users.getMutedNotificationTypes(userId)
        : [];
      const normalized = Array.isArray(muted) ? normalizeMutedNotificationTypes(muted) : [];
      return {
        muted_notification_types: normalized.filter((type) => type !== CARE_MESSAGE_MUTE_TYPE),
        care_messages_enabled: !normalized.includes(CARE_MESSAGE_MUTE_TYPE)
      };
    },

    // 写静音类型清单。入参 mutedNotificationTypes 是【用户可见清单】（不含关怀伪类型），须先经路由校验为
    // 去重的非空字符串数组。仓库未实现则回 501。R15 批 F：关怀开关单独承载——options.careMessagesEnabled
    // 显式给了就按它，没给则沿用当前存量（避免用户只想改通知静音时把关怀开关误重置）。最终把关怀伪类型
    // 按开关合并进持久化清单。
    async setPreferences(
      userId: string,
      mutedNotificationTypes: string[],
      options: { careMessagesEnabled?: boolean } = {}
    ): Promise<{ muted_notification_types: string[]; care_messages_enabled: boolean }> {
      if (!deps.users?.setMutedNotificationTypes) {
        throw new NotificationServiceError(501, "not_implemented", "当前部署不支持通知偏好设置。");
      }
      let careEnabled: boolean;
      if (options.careMessagesEnabled !== undefined) {
        careEnabled = options.careMessagesEnabled;
      } else {
        const current = deps.users.getMutedNotificationTypes
          ? await deps.users.getMutedNotificationTypes(userId)
          : [];
        careEnabled = !(Array.isArray(current) && current.includes(CARE_MESSAGE_MUTE_TYPE));
      }
      // 可见静音清单（剔除任何混入的关怀伪类型）+ 关怀开关决定是否加回伪类型。
      const visible = normalizeMutedNotificationTypes(mutedNotificationTypes).filter((type) => type !== CARE_MESSAGE_MUTE_TYPE);
      const persisted = careEnabled ? visible : [...visible, CARE_MESSAGE_MUTE_TYPE];
      const updated = await deps.users.setMutedNotificationTypes(userId, persisted);
      if (!updated) {
        throw new NotificationServiceError(404, "not_found", "没有找到这个用户。");
      }
      await auditNotificationAction({
        userId,
        entityId: userId,
        action: "notification.set_preferences",
        detailJson: { muted_notification_types: visible, care_messages_enabled: careEnabled }
      });
      const persistedNormalized = normalizeMutedNotificationTypes(updated.mutedNotificationTypes);
      return {
        muted_notification_types: persistedNormalized.filter((type) => type !== CARE_MESSAGE_MUTE_TYPE),
        care_messages_enabled: !persistedNormalized.includes(CARE_MESSAGE_MUTE_TYPE)
      };
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
          // R12（批量效率）：「全部已读」不吞待决策——needs_decision 保持未读，
          // 「已读但未处理」比未读更容易被视觉埋没。
          const informationalRows = visibleRows.filter((row) => !isNeedsDecisionNotification(row));
          updated += await deps.notifications.markReadMany(informationalRows.map((row) => row.id), userId, at);
          const last = rows[rows.length - 1]!;
          cursor = { createdAt: last.createdAt, id: last.id };
        }
      } else {
        updated = await deps.notifications.markAllRead(userId, at, { excludeNeedsDecision: true });
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
    },

    // R15 批 A（提醒阶梯）：被提醒人「暂停提醒」——置 next_remind_at=NULL，不动读/归档态。
    // 已读/归档本就会停提醒（扫描条件排除），此动作专门服务「知道了、先别催、但也别把它移出待决策队列」。
    async snooze(id: string, userId: string, options: NotificationMutationOptions = {}) {
      const existing = await deps.notifications.findByIdForUser(id, userId);
      if (!existing) {
        throw new NotificationServiceError(404, "not_found", "没有找到这条通知。");
      }
      const visibility = await requireVisibleNotification(existing, options.actor);
      const row = await deps.notifications.snoozeReminder(id, userId, now());
      if (!row) {
        throw new NotificationServiceError(404, "not_found", "没有找到这条通知。");
      }
      await auditNotificationAction({
        userId,
        entityId: id,
        action: "notification.snooze"
      });
      return toNotificationResponse(
        row,
        visibility.stripUnreadableWorkItemTarget ? { stripUnreadableWorkItemTarget: true } : {}
      );
    },

    // R15 批 A（提醒阶梯）：notification-reminder pulse 任务的一次 tick 主体。扫到期该提醒的通知，逐条
    // reminder_count++、next_remind_at +24h（达上限 3 则置空停止续期），并用 createOrUpdateNotification 之外
    // 的直更 + 同一条 publishNotification 复活推 SSE（updated_at 顶到 now 使其回到列表最前）。
    // 已读/已归档的通知在 listDueReminders 就被排除，天然退出阶梯，无需单独抑制状态。
    async runNotificationReminders(options: { limit?: number } = {}): Promise<NotificationReminderRunResult> {
      const at = now();
      const limit = Math.max(1, Math.min(options.limit ?? 200, 500));
      const due = await deps.notifications.listDueReminders(at, limit);
      let reminded = 0;
      let stopped = 0;
      for (const row of due) {
        const nextCount = row.reminderCount + 1;
        // 达上限：本次是最后一提，next_remind_at 置空——此后不再进扫描（approval 类的进一步升级
        // 由 expireDueApprovals 既有 escalate_pm/notify_reviewer 分流负责，不在这里重复造）。
        const nextRemindAt = nextCount >= REMINDER_MAX_COUNT
          ? null
          : new Date(at.getTime() + APPROVAL_REMINDER_INTERVAL_MS);
        const updated = await deps.notifications.applyReminderTick(row.id, { nextRemindAt, at });
        // listDueReminders 与本更新之间通知被读/归档 → applyReminderTick 落空返回 null，跳过（不复活已处理项）。
        if (!updated) {
          continue;
        }
        reminded += 1;
        if (nextRemindAt === null) {
          stopped += 1;
        }
        await publishNotification(deps.bus, updated);
      }
      return { scanned: due.length, reminded, stopped };
    }
  };
}
