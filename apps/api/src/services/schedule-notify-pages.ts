import {
  type ActionSpec,
  type CalendarPageVM,
  type NotificationEvidenceRefVM,
  type NotificationGroundingVM,
  type NotificationInboxBucket,
  type NotificationItemVM,
  type NotificationPageVM,
  type NotificationSourceContextVM,
  type ScheduleBlockVM,
  type WorkHubLocale
} from "@workhub/contracts";
import {
  createAuditLogRepository,
  getSharedDatabaseClient,
  createNotificationRepository,
  createScheduleNotifyRepository,
  type AuditLogRepository,
  type MeetingInsightScheduleSourceRow,
  type NotificationRepository,
  type NotificationRow,
  type ScheduleEventSourceRow,
  type ScheduleNotifyRepository,
  type WorkHubDatabaseClient,
  type WorkItemScheduleSourceRow
} from "@workhub/db";
import {
  canViewProjectDrive,
  canViewProjectMeetings,
  canViewWorkItemRecord
} from "@workhub/permissions";

import type { AuthActor } from "../middleware/auth.js";

type MeetingInsightSourceContextVM = Extract<NotificationSourceContextVM, { source_type: "meeting_insight" }>;

export class ScheduleNotifyPageServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type ScheduleNotifyPageServiceDependencies = {
  notifications: NotificationRepository;
  scheduleNotify: ScheduleNotifyRepository;
  audit: AuditLogRepository;
  now?: () => Date;
};

export type ScheduleNotifyPageService = ReturnType<typeof createScheduleNotifyPageService>;

let defaultDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultScheduleNotifyPageServiceDependencies(): ScheduleNotifyPageServiceDependencies {
  defaultDbClient ??= getSharedDatabaseClient();
  return {
    notifications: createNotificationRepository(defaultDbClient.db),
    scheduleNotify: createScheduleNotifyRepository(defaultDbClient.db),
    audit: createAuditLogRepository(defaultDbClient.db)
  };
}

const notificationCopy = {
  "zh-CN": {
    open: "打开",
    markRead: "标为已读",
    markAllRead: "全部已读",
    dismiss: "忽略",
    complete: "完成",
    meetingPendingTitle: "会议建议等待确认",
    meetingPendingBody: (title: string, meeting: string) => `${meeting} 里提到「${title}」，需要你决定是否生成工作草稿。`,
    meetingConfirmedTitle: "会议建议已生成草稿",
    meetingConfirmedBody: (title: string, meeting: string) => `${meeting} 里的「${title}」已经进入草稿/审阅链路。`,
    groundingNeedsDecision: "这件事在等你拍板，处理前可以先看相关证据。",
    groundingFyi: "这是给你的进展同步，不需要立即操作。",
    groundingDone: "这件事已经处理完，仅供回溯。",
    groundingSearch: "查相关证据",
    groundingReplay: "看执行回放"
  },
  "en-US": {
    open: "Open",
    markRead: "Mark as read",
    markAllRead: "Mark all as read",
    dismiss: "Dismiss",
    complete: "Complete",
    meetingPendingTitle: "Meeting insight needs review",
    meetingPendingBody: (title: string, meeting: string) => `${meeting} mentions "${title}". Decide whether to create a work draft.`,
    meetingConfirmedTitle: "Meeting insight draft created",
    meetingConfirmedBody: (title: string, meeting: string) => `${meeting}'s "${title}" is now in the draft/review flow.`,
    groundingNeedsDecision: "This item is waiting for your decision. Check the evidence first if needed.",
    groundingFyi: "This is a progress update. No action needed right now.",
    groundingDone: "This item is finished and kept for reference.",
    groundingSearch: "Find related evidence",
    groundingReplay: "Open execution replay"
  }
} satisfies Record<WorkHubLocale, Record<string, string | ((title: string, meeting: string) => string)>>;

function copy(locale: WorkHubLocale) {
  return notificationCopy[locale];
}

function action(id: string, label: string, method: ActionSpec["method"], href: string): ActionSpec {
  return { id, label, method, href };
}

function projectAccess(project: WorkItemScheduleSourceRow["project"] | MeetingInsightScheduleSourceRow["project"]) {
  return project
    ? {
      archived: project.archived,
      deletedAt: project.deletedAt,
      ownerUserId: project.ownerUserId,
      workspaceId: project.workspaceId
    }
    : null;
}

function actorUser(actor: AuthActor) {
  return {
    id: actor.userId ?? actor.id,
    isAdmin: actor.isAdmin
  };
}

function canViewProject(project: WorkItemScheduleSourceRow["project"] | MeetingInsightScheduleSourceRow["project"], actor: AuthActor) {
  const access = projectAccess(project);
  if (!access || access.archived || access.deletedAt) {
    return false;
  }
  return Boolean(access && canViewProjectDrive(access, actor));
}

function canViewWorkItem(row: WorkItemScheduleSourceRow, actor: AuthActor) {
  return canViewWorkItemRecord({
    id: row.workItem.id,
    status: row.workItem.status,
    submitterUserId: row.workItem.submitterUserId,
    claimedByUserId: row.workItem.claimedByUserId,
    workspaceId: row.workItem.workspaceId,
    project: projectAccess(row.project)
  }, actorUser(actor), {
    workspaceId: actor.workspaceId
  });
}

function canViewMeetingInsight(row: MeetingInsightScheduleSourceRow, actor: AuthActor) {
  const access = projectAccess(row.project);
  return Boolean(access && canViewProjectMeetings(access, actor));
}

function safeTargetHref(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("/api/")) {
    return undefined;
  }
  return value;
}

function statusFor(row: NotificationRow): NotificationItemVM["status"] {
  if (row.archivedAt) {
    return "done";
  }
  return row.readAt ? "read" : "unread";
}

function bucketFor(row: NotificationRow): NotificationInboxBucket {
  if (row.archivedAt) {
    return "done";
  }
  if (
    row.severity === "high" ||
    row.severity === "urgent" ||
    /approval|ask|pending|insight|escalated|in_review|review|decision/u.test(row.type)
  ) {
    return "needs_decision";
  }
  return "fyi";
}

function meetingInsightIdFromNotification(row: NotificationRow) {
  const dedupe = /^meeting_insight:([0-9a-f-]{36})$/iu.exec(row.dedupeKey ?? "");
  if (dedupe?.[1]) {
    return dedupe[1];
  }
  try {
    const parsed = new URL(row.targetUrl ?? "/", "https://workhub.local");
    return parsed.searchParams.get("insight_id") ?? undefined;
  } catch {
    return undefined;
  }
}

function sourceContextForNotification(
  row: NotificationRow,
  context: {
    workItems: Map<string, WorkItemScheduleSourceRow>;
    meetingInsights: Map<string, MeetingInsightScheduleSourceRow>;
  }
): NotificationSourceContextVM | undefined {
  if (row.workItemId) {
    const source = context.workItems.get(row.workItemId);
    if (source) {
      return {
        source_type: "work_item",
        work_item_id: source.workItem.id,
        code: source.workItem.code,
        title: source.workItem.title ?? source.workItem.code,
        status: source.workItem.status,
        project_id: source.project?.id,
        project_name: source.project?.name,
        ...(source.workItem.dueAt ? { due_at: source.workItem.dueAt.toISOString() } : {})
      };
    }
  }
  const insightId = meetingInsightIdFromNotification(row);
  if (insightId) {
    const source = context.meetingInsights.get(insightId);
    if (source) {
      return {
        source_type: "meeting_insight",
        meeting_id: source.meeting.id,
        insight_id: source.insight.id,
        title: source.insight.title,
        meeting_title: source.meeting.title,
        insight_status: source.insight.status as MeetingInsightSourceContextVM["insight_status"],
        project_id: source.project?.id,
        project_name: source.project?.name
      };
    }
  }
  return { source_type: "system", label: row.type };
}

function groundingFor(row: NotificationRow, bucket: NotificationInboxBucket, locale: WorkHubLocale): NotificationGroundingVM {
  const labels = copy(locale);
  const reason = bucket === "needs_decision"
    ? labels.groundingNeedsDecision as string
    : bucket === "done"
      ? labels.groundingDone as string
      : labels.groundingFyi as string;
  const searchParams = new URLSearchParams({ q: row.title, source_ref: `notification:${row.id}` });
  if (row.workItemId) {
    searchParams.set("work_item_id", row.workItemId);
  }
  if (row.projectId) {
    searchParams.set("project_id", row.projectId);
  }
  const refs: NotificationEvidenceRefVM[] = [{
    kind: "knowledge_search",
    label: labels.groundingSearch as string,
    href: `/knowledge/search?${searchParams.toString()}`
  }];
  const replayHref = safeTargetHref(row.targetUrl);
  if (replayHref && /^\/agent-runs\/[^/]+\/replay/u.test(replayHref)) {
    refs.push({
      kind: "agent_run_replay",
      label: labels.groundingReplay as string,
      href: replayHref
    });
  }
  return { reason_text: reason, evidence_refs: refs };
}

function notificationItem(
  row: NotificationRow,
  locale: WorkHubLocale,
  context: Parameters<typeof sourceContextForNotification>[1]
): NotificationItemVM {
  const targetHref = safeTargetHref(row.targetUrl);
  const labels = copy(locale);
  const actions: NotificationItemVM["actions"] = {};
  if (targetHref) {
    actions.open = action("open", labels.open as string, "GET", targetHref);
  }
  if (!row.readAt && !row.archivedAt) {
    actions.mark_read = action("notification_mark_read", labels.markRead as string, "POST", `/api/notifications/${row.id}/read`);
  }
  if (!row.archivedAt) {
    actions.dismiss = action("notification_dismiss", labels.dismiss as string, "POST", `/api/notifications/${row.id}/dismiss`);
    actions.complete = action("notification_complete", labels.complete as string, "POST", `/api/notifications/${row.id}/complete`);
  }
  const bucket = bucketFor(row);
  return {
    id: row.id,
    type: row.type,
    severity: row.severity as NotificationItemVM["severity"],
    status: statusFor(row),
    inbox_bucket: bucket,
    title: row.title,
    grounding: groundingFor(row, bucket, locale),
    target_href: targetHref,
    project_id: row.projectId ?? undefined,
    work_item_id: row.workItemId ?? undefined,
    dedupe_key: row.dedupeKey ?? undefined,
    source_context: sourceContextForNotification(row, context),
    read_at: row.readAt?.toISOString(),
    archived_at: row.archivedAt?.toISOString(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    actions,
    ...(row.body ? { body: row.body } : {})
  };
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDateParam(value: string | undefined, fallback: Date) {
  if (value && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return startOfUtcDay(new Date(`${value}T00:00:00.000Z`));
  }
  return startOfUtcDay(fallback);
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfWeek(date: Date) {
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(date, offset);
}

function rangeFor(input: { date?: string; view?: string }, now: Date): {
  date: string;
  view: "day" | "week";
  rangeStart: Date;
  rangeEnd: Date;
} {
  const selected = parseDateParam(input.date, now);
  const view: "day" | "week" = input.view === "day" ? "day" : "week";
  const rangeStart = view === "day" ? selected : startOfWeek(selected);
  const rangeEnd = addDays(rangeStart, view === "day" ? 1 : 7);
  return { date: dateKey(selected), view, rangeStart, rangeEnd };
}

function scheduleStatus(endAt: Date, now: Date, done = false): ScheduleBlockVM["status"] {
  if (done) {
    return "done";
  }
  if (endAt.getTime() < now.getTime()) {
    return "overdue";
  }
  return dateKey(endAt) === dateKey(now) ? "today" : "upcoming";
}

function severityForSchedule(status: ScheduleBlockVM["status"]): ScheduleBlockVM["severity"] {
  if (status === "overdue") {
    return "high";
  }
  if (status === "today") {
    return "urgent";
  }
  return "normal";
}

function isDoneWorkItem(status: string) {
  return status === "merged" || status === "done" || status === "cancelled";
}

function blockFromEvent(row: ScheduleEventSourceRow, now: Date): ScheduleBlockVM {
  const endAt = row.event.endAt;
  const status = scheduleStatus(endAt, now);
  return {
    id: row.event.id,
    kind: "schedule_event",
    title: row.event.title,
    description: row.event.description ?? undefined,
    starts_at: row.event.startAt?.toISOString(),
    ends_at: endAt.toISOString(),
    all_day: !row.event.startAt,
    status,
    severity: severityForSchedule(status),
    target_href: row.event.workItemId ? `/workitems/${row.event.workItemId}` : undefined,
    project_id: row.event.projectId ?? undefined,
    work_item_id: row.event.workItemId ?? undefined,
    source_context: {
      source_type: "schedule_event",
      schedule_event_id: row.event.id,
      title: row.event.title,
      event_type: row.event.eventType,
      project_id: row.event.projectId ?? undefined,
      work_item_id: row.event.workItemId ?? undefined
    }
  };
}

function blockFromWorkItem(row: WorkItemScheduleSourceRow, now: Date): ScheduleBlockVM | undefined {
  if (!row.workItem.dueAt) {
    return undefined;
  }
  const status = scheduleStatus(row.workItem.dueAt, now, isDoneWorkItem(row.workItem.status));
  return {
    id: row.workItem.id,
    kind: "work_item_due",
    title: row.workItem.title ?? row.workItem.code,
    description: row.workItem.summaryMd ?? row.workItem.rawDescription ?? undefined,
    ends_at: row.workItem.dueAt.toISOString(),
    all_day: true,
    status,
    severity: severityForSchedule(status),
    target_href: `/workitems/${row.workItem.id}`,
    project_id: row.project?.id,
    work_item_id: row.workItem.id,
    source_context: {
      source_type: "work_item",
      work_item_id: row.workItem.id,
      code: row.workItem.code,
      title: row.workItem.title ?? row.workItem.code,
      status: row.workItem.status,
      project_id: row.project?.id,
      project_name: row.project?.name,
      due_at: row.workItem.dueAt.toISOString()
    }
  };
}

function blockFromMeetingInsight(row: MeetingInsightScheduleSourceRow, now: Date): ScheduleBlockVM {
  const endAt = addDays(row.insight.createdAt, row.insight.status === "pending" ? 1 : 3);
  const status = scheduleStatus(endAt, now, row.insight.status === "confirmed");
  return {
    id: row.insight.id,
    kind: "meeting_followup",
    title: row.insight.title,
    description: row.meeting.title,
    ends_at: endAt.toISOString(),
    all_day: true,
    status,
    severity: row.insight.status === "pending" ? "high" : severityForSchedule(status),
    target_href: `/meetings?project_id=${row.meeting.projectId}&m=${row.meeting.id}&insight_id=${row.insight.id}`,
    project_id: row.meeting.projectId,
    work_item_id: row.insight.createdWorkItemId ?? row.insight.targetWorkItemId ?? undefined,
    source_context: {
      source_type: "meeting_insight",
      meeting_id: row.meeting.id,
      insight_id: row.insight.id,
      title: row.insight.title,
      meeting_title: row.meeting.title,
      insight_status: row.insight.status as MeetingInsightSourceContextVM["insight_status"],
      project_id: row.project?.id,
      project_name: row.project?.name
    }
  };
}

async function auditAction(
  deps: ScheduleNotifyPageServiceDependencies,
  actor: AuthActor,
  actionName: string,
  entityId: string,
  detailJson: Record<string, unknown> = {}
) {
  await deps.audit.createAuditLog({
    actorKind: actor.kind,
    actorUserId: actor.userId ?? actor.id,
    actorNickname: actor.label,
    entityType: "notification",
    entityId,
    action: actionName,
    detailJson
  });
}

export function createScheduleNotifyPageService(
  deps: ScheduleNotifyPageServiceDependencies = getDefaultScheduleNotifyPageServiceDependencies()
) {
  const now = deps.now ?? (() => new Date());

  async function ensureMeetingInsightNotifications(actor: AuthActor, locale: WorkHubLocale) {
    const labels = copy(locale);
    const sources = await deps.scheduleNotify.listMeetingInsightSources({ limit: 80 });
    for (const source of sources) {
      if (!canViewMeetingInsight(source, actor)) {
        continue;
      }
      const pending = source.insight.status === "pending";
      const title = pending ? labels.meetingPendingTitle as string : labels.meetingConfirmedTitle as string;
      const body = pending
        ? (labels.meetingPendingBody as (title: string, meeting: string) => string)(source.insight.title, source.meeting.title)
        : (labels.meetingConfirmedBody as (title: string, meeting: string) => string)(source.insight.title, source.meeting.title);
      await deps.notifications.createOrUpdateNotification({
        userId: actor.userId ?? actor.id,
        type: pending ? "meeting.insight.pending" : "meeting.insight.confirmed",
        severity: pending ? "high" : "normal",
        title,
        body,
        targetUrl: `/meetings?project_id=${source.meeting.projectId}&m=${source.meeting.id}&insight_id=${source.insight.id}`,
        projectId: source.meeting.projectId,
        dedupeKey: `meeting_insight:${source.insight.id}`,
        ...((source.insight.createdWorkItemId ?? source.insight.targetWorkItemId)
          ? { workItemId: (source.insight.createdWorkItemId ?? source.insight.targetWorkItemId) as string }
          : {})
      }, now());
    }
  }

  return {
    async notificationsPage(input: { actor: AuthActor; locale: WorkHubLocale }): Promise<NotificationPageVM> {
      await ensureMeetingInsightNotifications(input.actor, input.locale);
      const rows = await deps.notifications.listForUser(input.actor.userId ?? input.actor.id, {
        includeArchived: true,
        limit: 200
      });
      const workItemIds = rows.map((row) => row.workItemId).filter((id): id is string => Boolean(id));
      const meetingInsightIds = rows.map(meetingInsightIdFromNotification).filter((id): id is string => Boolean(id));
      const contexts = await deps.scheduleNotify.readNotificationContexts({ workItemIds, meetingInsightIds });
      const visibleWorkItems = new Map(
        contexts.workItems
          .filter((row) => canViewWorkItem(row, input.actor))
          .map((row) => [row.workItem.id, row])
      );
      const visibleMeetingInsights = new Map(
        contexts.meetingInsights
          .filter((row) => canViewMeetingInsight(row, input.actor))
          .map((row) => [row.insight.id, row])
      );
      const visibleRows = rows.filter((row) => {
        if (row.workItemId && !visibleWorkItems.has(row.workItemId)) {
          return false;
        }
        const insightId = meetingInsightIdFromNotification(row);
        if (insightId && !visibleMeetingInsights.has(insightId)) {
          return false;
        }
        return true;
      });
      const context = {
        workItems: visibleWorkItems,
        meetingInsights: visibleMeetingInsights
      };
      const items = visibleRows.map((row) => notificationItem(row, input.locale, context));
      const buckets = {
        needs_decision: items.filter((item) => item.inbox_bucket === "needs_decision"),
        fyi: items.filter((item) => item.inbox_bucket === "fyi"),
        done: items.filter((item) => item.inbox_bucket === "done")
      };
      return {
        generated_at: now().toISOString(),
        actor_user_id: input.actor.userId ?? input.actor.id,
        summary: {
          total_count: items.length,
          unread_count: items.filter((item) => item.status === "unread").length,
          needs_decision_count: buckets.needs_decision.length,
          fyi_count: buckets.fyi.length,
          done_count: buckets.done.length,
          urgent_count: items.filter((item) => item.severity === "urgent" || item.severity === "high").length
        },
        buckets,
        items,
        actions: {
          mark_all_read: action("notification_mark_all_read", copy(input.locale).markAllRead as string, "POST", "/api/notifications/read-all")
        },
        ...(items.length === 0 ? { empty_state: "no_notifications" as const } : {})
      };
    },

    async calendarPage(input: { actor: AuthActor; locale: WorkHubLocale; date?: string; view?: string }): Promise<CalendarPageVM> {
      const clock = now();
      const scope = rangeFor({
        ...(input.date ? { date: input.date } : {}),
        ...(input.view ? { view: input.view } : {})
      }, clock);
      const rows = await deps.scheduleNotify.readSchedulePageRows({
        actorUserId: input.actor.userId ?? input.actor.id,
        rangeStart: scope.rangeStart,
        rangeEnd: scope.rangeEnd,
        limit: 160
      });
      const eventBlocks = rows.events
        .filter((row) => {
          const participantIds = row.event.participantUserIdsJson ?? [];
          return row.event.createdByUserId === (input.actor.userId ?? input.actor.id) ||
            participantIds.includes(input.actor.userId ?? input.actor.id) ||
            (row.project ? canViewProject(row.project, input.actor) : input.actor.isAdmin);
        })
        .map((row) => blockFromEvent(row, clock));
      const workItemBlocks = rows.dueWorkItems
        .filter((row) => canViewWorkItem(row, input.actor))
        .map((row) => blockFromWorkItem(row, clock))
        .filter((block): block is ScheduleBlockVM => Boolean(block));
      const meetingBlocks = rows.meetingInsights
        .filter((row) => canViewMeetingInsight(row, input.actor))
        .map((row) => blockFromMeetingInsight(row, clock))
        .filter((block) => {
          // 上界独占（与生成的 7 天 day key 对齐）：rangeEnd 是下一周期 00:00，end===rangeEnd 的块
          // 其 dateKey=rangeStart+7 不在 days 里，会让 summary 总数对不上且块在网格里隐身。
          const end = new Date(block.ends_at);
          return end >= scope.rangeStart && end < scope.rangeEnd;
        });
      const blocks = [...eventBlocks, ...workItemBlocks, ...meetingBlocks]
        .sort((left, right) => left.ends_at.localeCompare(right.ends_at));
      const days = Array.from({ length: scope.view === "day" ? 1 : 7 }, (_, index) => {
        const key = dateKey(addDays(scope.rangeStart, index));
        return {
          date: key,
          blocks: blocks.filter((block) => dateKey(new Date(block.ends_at)) === key)
        };
      });
      return {
        generated_at: clock.toISOString(),
        actor_user_id: input.actor.userId ?? input.actor.id,
        scope: {
          date: scope.date,
          view: scope.view,
          range_start: scope.rangeStart.toISOString(),
          range_end: scope.rangeEnd.toISOString()
        },
        summary: {
          block_count: blocks.length,
          overdue_count: blocks.filter((block) => block.status === "overdue").length,
          today_count: blocks.filter((block) => block.status === "today").length,
          week_count: blocks.length
        },
        days,
        blocks,
        ...(blocks.length === 0 ? { empty_state: "no_schedule_blocks" as const } : {})
      };
    },

    async markRead(id: string, actor: AuthActor) {
      const row = await deps.notifications.markRead(id, actor.userId ?? actor.id, now());
      if (!row) {
        throw new ScheduleNotifyPageServiceError(404, "not_found", "没有找到这条通知。");
      }
      await auditAction(deps, actor, "notification.mark_read", id);
      return row;
    },

    async markAllRead(actor: AuthActor) {
      const updated = await deps.notifications.markAllRead(actor.userId ?? actor.id, now());
      await deps.audit.createAuditLog({
        actorKind: actor.kind,
        actorUserId: actor.userId ?? actor.id,
        actorNickname: actor.label,
        entityType: "notification_bulk",
        entityId: actor.userId ?? actor.id,
        action: "notification.mark_all_read",
        detailJson: { updated }
      });
      return { updated };
    },

    async dismiss(id: string, actor: AuthActor) {
      const row = await deps.notifications.archive(id, actor.userId ?? actor.id, now());
      if (!row) {
        throw new ScheduleNotifyPageServiceError(404, "not_found", "没有找到这条通知。");
      }
      await auditAction(deps, actor, "notification.dismiss", id);
      return row;
    },

    async complete(id: string, actor: AuthActor) {
      const row = await deps.notifications.archive(id, actor.userId ?? actor.id, now());
      if (!row) {
        throw new ScheduleNotifyPageServiceError(404, "not_found", "没有找到这条通知。");
      }
      await auditAction(deps, actor, "notification.complete", id);
      return row;
    }
  };
}
