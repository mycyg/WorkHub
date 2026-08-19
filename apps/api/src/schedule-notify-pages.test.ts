import assert from "node:assert/strict";
import test from "node:test";

import type {
  AuditLogRepository,
  AuditLogRow,
  CreateAuditLogInput,
  CreateNotificationInput,
  MeetingInsightScheduleSourceRow,
  NotificationRepository,
  NotificationRow,
  NotificationWriteResult,
  ScheduleEventSourceRow,
  ScheduleNotifyRepository,
  WorkItemScheduleSourceRow
} from "@workhub/db";

import { createScheduleNotifyPageService, ScheduleNotifyPageServiceError } from "./services/schedule-notify-pages.js";
import type { AuthActor } from "./middleware/auth.js";
import { InternalContractError } from "./pages/output-contract.js";

const now = new Date("2026-06-11T10:00:00.000Z");
const userId = "82000000-0000-4000-8000-000000000001";
const workspaceId = "82000000-0000-4000-8000-000000000002";
const projectId = "82000000-0000-4000-8000-000000000003";
const meetingId = "82000000-0000-4000-8000-000000000004";
const insightId = "82000000-0000-4000-8000-000000000005";
const workItemId = "82000000-0000-4000-8000-000000000006";

function actor(): AuthActor {
  return {
    kind: "human",
    id: userId,
    userId,
    label: "alex",
    isAdmin: false,
    orgId: "82000000-0000-4000-8000-000000000007",
    workspaceId
  };
}

function driftedActor(): AuthActor {
  return {
    ...actor(),
    id: "not-a-uuid",
    userId: "not-a-uuid"
  };
}

function notification(partial: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "82000000-0000-4000-8000-000000000010",
    userId,
    type: "meeting.insight.pending",
    severity: "high",
    title: "会议建议等待确认",
    body: "Q2 review 里提到更新报价。",
    targetUrl: `/meetings?project_id=${projectId}&m=${meetingId}&insight_id=${insightId}`,
    projectId,
    workItemId: null,
    dedupeKey: `meeting_insight:${insightId}`,
    readAt: null,
    archivedAt: null,
    nextRemindAt: null,
    reminderCount: 0,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

function meetingInsightSource(): MeetingInsightScheduleSourceRow {
  return {
    insight: {
      id: insightId,
      meetingId,
      kind: "requirement_change",
      title: "Update pricing",
      description: "Draft a pricing update.",
      targetWorkItemId: null,
      confidenceReason: "The meeting explicitly asks for this update.",
      status: "pending",
      createdWorkItemId: null,
      confirmedByUserId: null,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now
    },
    meeting: {
      id: meetingId,
      projectId,
      workItemId: null,
      uploadedByUserId: userId,
      title: "Q2 review",
      audioFilename: "q2.txt",
      audioMime: "text/plain",
      audioSizeBytes: 100,
      audioPath: "q2.txt",
      transcriptText: "Update pricing",
      minutesMd: "Update pricing",
      status: "ready",
      jobId: null,
      createdAt: now,
      updatedAt: now
    },
    project: {
      id: projectId,
      workspaceId,
      name: "Q2 project",
      slug: "q2",
      description: null,
      ownerNickname: "alex",
      ownerUserId: userId,
      archived: false,
      deletedAt: null,
      deletedByNickname: null,
      nextSeq: 1,
      // R13 批 S3：projects 加了 is_personal 列——机械补齐，不是本文件测的功能改动。
      isPersonal: false,
      // R15 批 B：projects 加了 is_dm_container 列——机械补齐（普通项目固定 false）。
      isDmContainer: false,
      // R16 批 W4a：projects 加了 instructions_md 列——机械补齐（这份 fixture 不关心它，默认空）。
      instructionsMd: null,
      createdAt: now,
      updatedAt: now
    },
    uploadedBy: null
  };
}

function workItemSource(): WorkItemScheduleSourceRow {
  return {
    workItem: {
      id: workItemId,
      code: "WH-1",
      projectId,
      workspaceId,
      submitterUserId: userId,
      claimedByUserId: userId,
      claimedByNickname: "alex",
      title: "Review pricing",
      rawDescription: "Review pricing",
      summaryMd: "Review pricing",
      status: "in_review",
      priority: "normal",
      estimateHours: null,
      estimateConfidence: null,
      planningNote: null,
      startAt: null,
      dueAt: new Date("2026-06-11T14:00:00.000Z"),
      sourceMeetingId: null,
      sourceWorkItemId: null,
      milestoneId: null,
      claimedAt: null,
      doneAt: null,
      deliveredAt: null,
      deliveryDocReadyAt: null,
      acceptedAt: null,
      syncState: "pending",
      version: 0,
      mode: "worker",
      humanReserved: false,
      currentSpecId: null,
      mainBranchId: null,
      latestConfidenceId: null,
      deletedAt: null,
      deletedByUserId: null,
      createdAt: now,
      updatedAt: now
    },
    project: meetingInsightSource().project
  };
}

class MemoryNotifications implements NotificationRepository {
  rows = [notification()];
  upsertCalls = 0;

  async createOrUpdateNotification(input: CreateNotificationInput, at: Date): Promise<NotificationWriteResult> {
    // 每次调用 = 真实仓库里的一笔事务；M10 计这个数来衡量读路径放大。
    this.upsertCalls += 1;
    const existing = this.rows.find((row) => row.dedupeKey === input.dedupeKey && row.userId === input.userId);
    if (existing) {
      // 镜像真实仓库：存在则把内容更新到 input（这样重复读时内容一致，门才能跳过）。
      existing.type = input.type;
      existing.severity = input.severity;
      existing.title = input.title;
      existing.body = input.body ?? null;
      existing.targetUrl = input.targetUrl ?? null;
      existing.projectId = input.projectId ?? null;
      existing.workItemId = input.workItemId ?? null;
      existing.updatedAt = at;
      return { notification: existing, created: false, resurfaced: false };
    }
    const row = notification({
      id: "82000000-0000-4000-8000-000000000011",
      userId: input.userId,
      type: input.type,
      severity: input.severity,
      title: input.title,
      body: input.body ?? null,
      targetUrl: input.targetUrl ?? null,
      projectId: input.projectId ?? null,
      workItemId: input.workItemId ?? null,
      dedupeKey: input.dedupeKey ?? null,
      createdAt: at,
      updatedAt: at
    });
    this.rows.unshift(row);
    return { notification: row, created: true, resurfaced: true };
  }

  async listForUser(
    _userId?: string,
    _options: { includeArchived?: boolean; limit?: number; before?: { createdAt: Date; id: string } } = {}
  ) {
    return this.rows;
  }

  async findByIdForUser(id: string, userId: string) {
    return this.rows.find((item) => item.id === id && item.userId === userId) ?? null;
  }

  async markRead(id: string) {
    const row = this.rows.find((item) => item.id === id);
    return row ? { ...row, readAt: now, updatedAt: now } : null;
  }

  async markReadMany(ids: string[]) {
    return ids.length;
  }

  async markAllRead() {
    return this.rows.length;
  }

  async archive(id: string) {
    const index = this.rows.findIndex((item) => item.id === id);
    if (index < 0) {
      return null;
    }
    this.rows[index] = { ...this.rows[index]!, readAt: now, archivedAt: now, updatedAt: now };
    return this.rows[index]!;
  }

  async archiveByDedupeKey(dedupeKey: string) {
    let count = 0;
    this.rows = this.rows.map((row) => {
      if (row.dedupeKey === dedupeKey && !row.archivedAt) {
        count += 1;
        return { ...row, readAt: now, archivedAt: now, updatedAt: now };
      }
      return row;
    });
    return count;
  }

  async archiveStaleLifecycleForWorkItem(workItemId: string, keepType: string) {
    let count = 0;
    this.rows = this.rows.map((row) => {
      if (row.workItemId === workItemId && !row.archivedAt && row.type.startsWith("workitem.") && row.type !== keepType) {
        count += 1;
        return { ...row, readAt: now, archivedAt: now, updatedAt: now };
      }
      return row;
    });
    return count;
  }

  async listDueReminders() {
    return [];
  }

  async applyReminderTick() {
    return null;
  }

  async snoozeReminder() {
    return null;
  }
}

class EmptyNotifications extends MemoryNotifications {
  rows: NotificationRow[] = [];
}

class LimitRespectingNotifications extends MemoryNotifications {
  override async listForUser(
    userId: string,
    options: { includeArchived?: boolean; limit?: number; before?: { createdAt: Date; id: string } } = {}
  ) {
    return this.rows
      .filter((item) => item.userId === userId)
      .filter((item) => options.includeArchived || !item.archivedAt)
      .filter((item) => !options.before ||
        item.createdAt.getTime() < options.before.createdAt.getTime() ||
        (item.createdAt.getTime() === options.before.createdAt.getTime() && item.id < options.before.id)
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))
      .slice(0, options.limit ?? this.rows.length);
  }
}

class MemoryScheduleNotify implements ScheduleNotifyRepository {
  async readNotificationContexts(): ReturnType<ScheduleNotifyRepository["readNotificationContexts"]> {
    return {
      workItems: [],
      meetingInsights: [meetingInsightSource()]
    };
  }

  async listMeetingInsightSources(): ReturnType<ScheduleNotifyRepository["listMeetingInsightSources"]> {
    return [meetingInsightSource()];
  }

  async readSchedulePageRows(): ReturnType<ScheduleNotifyRepository["readSchedulePageRows"]> {
    return {
      events: [],
      dueWorkItems: [workItemSource()],
      meetingInsights: [meetingInsightSource()]
    };
  }
}

class NoMeetingInsightScheduleNotify extends MemoryScheduleNotify {
  async listMeetingInsightSources(): ReturnType<ScheduleNotifyRepository["listMeetingInsightSources"]> {
    return [];
  }
}

class HiddenFirstMeetingInsightScheduleNotify extends MemoryScheduleNotify {
  private hiddenSource(index: number): MeetingInsightScheduleSourceRow {
    const source = meetingInsightSource();
    if (!source.project) {
      throw new Error("meeting insight fixture must have a project");
    }
    return {
      ...source,
      insight: {
        ...source.insight,
        id: `82000000-0000-4000-8000-1000000000${index.toString(16).padStart(2, "0")}`
      },
      project: {
        ...source.project,
        workspaceId: "82000000-0000-4000-8000-000000000099",
        ownerUserId: "82000000-0000-4000-8000-000000000098"
      }
    };
  }

  async listMeetingInsightSources(input?: { limit?: number }): ReturnType<ScheduleNotifyRepository["listMeetingInsightSources"]> {
    const sources = [
      ...Array.from({ length: 80 }, (_, index) => this.hiddenSource(index)),
      meetingInsightSource()
    ];
    return sources.slice(0, input?.limit ?? sources.length);
  }
}

class MeetingInsightWithPrivateWorkItemScheduleNotify extends MemoryScheduleNotify {
  async readNotificationContexts(): ReturnType<ScheduleNotifyRepository["readNotificationContexts"]> {
    const source = workItemSource();
    const privateWorkItemSource: WorkItemScheduleSourceRow = {
      ...source,
      workItem: {
        ...source.workItem,
        status: "intake",
        submitterUserId: "82000000-0000-4000-8000-000000000099",
        claimedByUserId: null,
        claimedByNickname: null
      }
    };
    return {
      workItems: [privateWorkItemSource],
      meetingInsights: [meetingInsightSource()]
    };
  }

  async listMeetingInsightSources(): ReturnType<ScheduleNotifyRepository["listMeetingInsightSources"]> {
    return [];
  }
}

class AssignedPrivateWorkItemScheduleNotify extends MemoryScheduleNotify {
  private assignedPrivateSource(): WorkItemScheduleSourceRow {
    const source = workItemSource();
    return {
      ...source,
      assignments: [{ userId, role: "lead" }],
      workItem: {
        ...source.workItem,
        status: "spec_ready",
        submitterUserId: "82000000-0000-4000-8000-000000000099",
        claimedByUserId: null,
        claimedByNickname: null
      }
    } as WorkItemScheduleSourceRow;
  }

  async readNotificationContexts(): ReturnType<ScheduleNotifyRepository["readNotificationContexts"]> {
    return {
      workItems: [this.assignedPrivateSource()],
      meetingInsights: []
    };
  }

  async listMeetingInsightSources(): ReturnType<ScheduleNotifyRepository["listMeetingInsightSources"]> {
    return [];
  }

  async readSchedulePageRows(): ReturnType<ScheduleNotifyRepository["readSchedulePageRows"]> {
    return {
      events: [],
      dueWorkItems: [this.assignedPrivateSource()],
      meetingInsights: []
    };
  }
}

class ScheduleEventWithPrivateWorkItemScheduleNotify extends MemoryScheduleNotify {
  async listMeetingInsightSources(): ReturnType<ScheduleNotifyRepository["listMeetingInsightSources"]> {
    return [];
  }

  async readSchedulePageRows(): ReturnType<ScheduleNotifyRepository["readSchedulePageRows"]> {
    const source = workItemSource();
    const privateSource: WorkItemScheduleSourceRow = {
      ...source,
      workItem: {
        ...source.workItem,
        status: "spec_ready",
        submitterUserId: "82000000-0000-4000-8000-000000000099",
        claimedByUserId: null,
        claimedByNickname: null
      }
    };
    const event: ScheduleEventSourceRow = {
      event: {
        id: "82000000-0000-4000-8000-000000000017",
        projectId,
        workItemId,
        createdByUserId: "82000000-0000-4000-8000-000000000099",
        title: "Private work review",
        description: "Review the private work item.",
        eventType: "review",
        startAt: null,
        endAt: new Date("2026-06-11T15:00:00.000Z"),
        participantUserIdsJson: [],
        createdAt: now,
        updatedAt: now
      },
      project: privateSource.project,
      workItem: privateSource.workItem
    };
    return {
      events: [event],
      dueWorkItems: [],
      meetingInsights: []
    };
  }
}

class ScheduleEventWithDeletedWorkItemScheduleNotify extends MemoryScheduleNotify {
  async listMeetingInsightSources(): ReturnType<ScheduleNotifyRepository["listMeetingInsightSources"]> {
    return [];
  }

  async readSchedulePageRows(): ReturnType<ScheduleNotifyRepository["readSchedulePageRows"]> {
    const source = workItemSource();
    const event: ScheduleEventSourceRow = {
      event: {
        id: "82000000-0000-4000-8000-000000000018",
        projectId,
        workItemId,
        createdByUserId: userId,
        title: "Deleted work review",
        description: "This event used to point to a deleted work item.",
        eventType: "review",
        startAt: null,
        endAt: new Date("2026-06-11T16:00:00.000Z"),
        participantUserIdsJson: [],
        createdAt: now,
        updatedAt: now
      },
      project: source.project,
      workItem: {
        ...source.workItem,
        deletedAt: new Date("2026-06-11T09:00:00.000Z"),
        deletedByUserId: userId
      }
    };
    return {
      events: [event],
      dueWorkItems: [],
      meetingInsights: []
    };
  }
}

class MeetingInsightCalendarWithPrivateWorkItemScheduleNotify extends MemoryScheduleNotify {
  async listMeetingInsightSources(): ReturnType<ScheduleNotifyRepository["listMeetingInsightSources"]> {
    return [];
  }

  async readSchedulePageRows(): ReturnType<ScheduleNotifyRepository["readSchedulePageRows"]> {
    return {
      events: [],
      dueWorkItems: [],
      meetingInsights: [{
        ...meetingInsightSource(),
        insight: {
          ...meetingInsightSource().insight,
          targetWorkItemId: workItemId
        }
      }]
    };
  }
}

class MergedWorkItemScheduleNotify extends MemoryScheduleNotify {
  async listMeetingInsightSources(): ReturnType<ScheduleNotifyRepository["listMeetingInsightSources"]> {
    return [];
  }

  async readSchedulePageRows(): ReturnType<ScheduleNotifyRepository["readSchedulePageRows"]> {
    const source = workItemSource();
    return {
      events: [],
      dueWorkItems: [{
        ...source,
        workItem: {
          ...source.workItem,
          status: "merged"
        }
      }],
      meetingInsights: []
    };
  }
}

class MemoryAudit implements AuditLogRepository {
  inputs: CreateAuditLogInput[] = [];

  async createAuditLog(input: CreateAuditLogInput) {
    this.inputs.push(input);
    return {
      id: "82000000-0000-4000-8000-000000000090",
      orgId: input.orgId ?? null,
      workspaceId: input.workspaceId ?? null,
      actorKind: input.actorKind,
      actorUserId: input.actorUserId ?? null,
      actorNickname: input.actorNickname ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      detailJson: input.detailJson ?? {},
      snapshotId: input.snapshotId ?? null,
      undoneAt: null,
      createdAt: now,
      updatedAt: now
    };
  }

  async listAuditLogsForEntity() {
    return [];
  }

  async listAuditLogsForWorkItem() {
    return [];
  }

  async markAuditLogUndone() {
    return null;
  }
}

class ThrowingAudit implements AuditLogRepository {
  async createAuditLog(_input: CreateAuditLogInput): Promise<AuditLogRow> {
    throw new Error("audit sink unavailable");
  }

  async listAuditLogsForEntity() {
    return [];
  }

  async listAuditLogsForWorkItem() {
    return [];
  }

  async markAuditLogUndone() {
    return null;
  }
}

test("schedule notify page service groups meeting insight notifications and archives actions", async () => {
  const notifications = new MemoryNotifications();
  const audit = new MemoryAudit();
  const service = createScheduleNotifyPageService({
    notifications,
    scheduleNotify: new MemoryScheduleNotify(),
    audit,
    now: () => now
  });

  const page = await service.notificationsPage({ actor: actor(), locale: "zh-CN" });
  assert.equal(page.summary.needs_decision_count, 1);
  assert.equal(page.buckets.needs_decision[0]?.source_context?.source_type, "meeting_insight");
  assert.equal(page.buckets.needs_decision[0]?.target_href?.startsWith("/api/"), false);
  // xreview: a needs-decision item must NOT offer 「完成」(it only archives, falsely implying the decision was made);
  // it keeps dismiss + open. The decision itself is made at the source via open.
  assert.equal(page.buckets.needs_decision[0]?.actions.complete, undefined);
  assert.ok(page.buckets.needs_decision[0]?.actions.dismiss, "needs-decision keeps a dismiss action");

  await service.dismiss(page.buckets.needs_decision[0]!.id, actor());
  assert.equal(audit.inputs.at(-1)?.action, "notification.dismiss");
});

test("notifications page summary caps at the repository page limit instead of scanning full history", async () => {
  // R9 批次1-2 性能收口回归：通知页读路径必须是单次有界查询(旧行为=limit 200)，不能翻页扫穿
  // 用户全部历史。201 条历史通知 → 页面只应看到前 200 条(按 createdAt desc)，计数口径与
  // 实际返回的 items 一致，不虚报第 201 条的存在。
  const notifications = new LimitRespectingNotifications();
  notifications.rows = Array.from({ length: 201 }, (_value, index) => notification({
    id: `82000000-0000-4000-8000-${(index + 100).toString(16).padStart(12, "0")}`,
    type: "system.notice",
    severity: "normal",
    title: `系统通知 ${index + 1}`,
    body: "普通通知",
    targetUrl: null,
    projectId: null,
    workItemId: null,
    dedupeKey: `system:${index + 1}`,
    createdAt: new Date(now.getTime() - index),
    updatedAt: new Date(now.getTime() - index)
  }));
  const service = createScheduleNotifyPageService({
    notifications,
    scheduleNotify: new NoMeetingInsightScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  const page = await service.notificationsPage({ actor: actor(), locale: "zh-CN" });

  assert.equal(page.summary.total_count, 200);
  assert.equal(page.summary.unread_count, 200);
  assert.equal(page.items.length, 200);
  // 保留的是最新的 200 条(index 0..199)，第 201 条(最旧, index 200)被截断在外。
  assert.equal(page.items.some((item) => item.dedupe_key === "system:201"), false);
});

test("meeting insight notification refresh overfetches before visibility filtering", async () => {
  const notifications = new EmptyNotifications();
  const service = createScheduleNotifyPageService({
    notifications,
    scheduleNotify: new HiddenFirstMeetingInsightScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  const page = await service.notificationsPage({ actor: actor(), locale: "zh-CN" });

  assert.equal(page.summary.total_count, 1);
  assert.equal(page.items[0]?.dedupe_key, `meeting_insight:${insightId}`);
  assert.equal(notifications.upsertCalls, 1);
});

test("schedule notify page actions return committed results even when post-write audit fails", async () => {
  const service = createScheduleNotifyPageService({
    notifications: new MemoryNotifications(),
    scheduleNotify: new MemoryScheduleNotify(),
    audit: new ThrowingAudit(),
    now: () => now
  });

  const read = await service.markRead("82000000-0000-4000-8000-000000000010", actor());
  assert.equal(read.readAt?.toISOString(), now.toISOString());

  const allRead = await service.markAllRead(actor());
  assert.equal(allRead.updated, 1);

  const dismissed = await service.dismiss("82000000-0000-4000-8000-000000000010", actor());
  assert.equal(dismissed.archivedAt?.toISOString(), now.toISOString());

  const completed = await service.complete("82000000-0000-4000-8000-000000000010", actor());
  assert.equal(completed.archivedAt?.toISOString(), now.toISOString());
});

test("M10 repeat notifications read does not re-upsert unchanged meeting-insight notifications", async () => {
  const notifications = new MemoryNotifications();
  const service = createScheduleNotifyPageService({
    notifications,
    scheduleNotify: new MemoryScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  await service.notificationsPage({ actor: actor(), locale: "zh-CN" });
  const afterFirst = notifications.upsertCalls;
  assert.ok(afterFirst >= 1, "first read materializes at least one meeting-insight notification");

  await service.notificationsPage({ actor: actor(), locale: "zh-CN" });
  // 第二次读：内容未变 → 0 笔额外 upsert 事务（读路径写放大被门挡住）。
  assert.equal(notifications.upsertCalls, afterFirst);
});

test("findings: a drifted severity value clamps to normal instead of 500ing the whole inbox", async () => {
  const notifications = new MemoryNotifications();
  // 模拟 DB 里历史/漂移的 severity（varchar，不在 normal|high|urgent 枚举内）。
  notifications.rows.push(
    notification({
      id: "82000000-0000-4000-8000-000000000015",
      type: "system.notice",
      severity: "critical",
      title: "legacy severity row",
      body: null,
      targetUrl: null,
      dedupeKey: "drifted-severity-row"
    })
  );
  const service = createScheduleNotifyPageService({
    notifications,
    scheduleNotify: new MemoryScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  const page = await service.notificationsPage({ actor: actor(), locale: "zh-CN" });
  const allItems = [...page.buckets.needs_decision, ...page.buckets.fyi, ...page.buckets.done];
  const drifted = allItems.find((item) => item.id === "82000000-0000-4000-8000-000000000015");
  assert.ok(drifted, "drifted-severity row still renders");
  assert.equal(drifted!.severity, "normal");
});

test("schedule notify pages wrap VM assembly drift as internal contract errors", async () => {
  const service = createScheduleNotifyPageService({
    notifications: new EmptyNotifications(),
    scheduleNotify: new MemoryScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  await assert.rejects(
    () => service.notificationsPage({ actor: driftedActor(), locale: "zh-CN" }),
    (error: unknown) => error instanceof InternalContractError && error.context === "notifications.page"
  );
  await assert.rejects(
    () => service.calendarPage({ actor: driftedActor(), locale: "zh-CN", date: "2026-06-11", view: "day" }),
    (error: unknown) => error instanceof InternalContractError && error.context === "calendar.page"
  );
});

test("meeting insight notification stays visible when its attached work item is private", async () => {
  const notifications = new MemoryNotifications();
  notifications.rows = [notification({ workItemId })];
  const service = createScheduleNotifyPageService({
    notifications,
    scheduleNotify: new MeetingInsightWithPrivateWorkItemScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  const page = await service.notificationsPage({ actor: actor(), locale: "zh-CN" });
  const item = page.items.find((candidate) => candidate.id === "82000000-0000-4000-8000-000000000010");
  assert.ok(item, "visible meeting insight notification is not hidden by an unreadable linked work item");
  assert.equal(item.source_context?.source_type, "meeting_insight");
  assert.equal(item.work_item_id, undefined);
  assert.ok(item.grounding);
  assert.equal(item.grounding.evidence_refs[0]?.href.includes("work_item_id="), false);
});

test("assigned private work item notifications and calendar blocks stay visible to the assignee", async () => {
  const notifications = new MemoryNotifications();
  notifications.rows = [
    notification({
      id: "82000000-0000-4000-8000-000000000016",
      type: "workitem.due",
      severity: "normal",
      title: "Assigned private due",
      body: null,
      targetUrl: `/workitems/${workItemId}`,
      workItemId,
      dedupeKey: "assigned-private-due"
    })
  ];
  const service = createScheduleNotifyPageService({
    notifications,
    scheduleNotify: new AssignedPrivateWorkItemScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  const inbox = await service.notificationsPage({ actor: actor(), locale: "zh-CN" });
  const item = inbox.items.find((candidate) => candidate.id === "82000000-0000-4000-8000-000000000016");
  assert.ok(item, "assigned private work item notification should not disappear from the inbox");
  assert.equal(item!.work_item_id, workItemId);
  assert.equal(item!.source_context?.source_type, "work_item");
  assert.equal(item!.actions.open?.href, `/workitems/${workItemId}`);
  assert.equal(item!.grounding?.evidence_refs[0]?.href.includes(`work_item_id=${workItemId}`) ?? false, true);

  const calendar = await service.calendarPage({ actor: actor(), locale: "zh-CN", date: "2026-06-11", view: "day" });
  const block = calendar.blocks.find((candidate) => candidate.work_item_id === workItemId);
  assert.ok(block, "assigned private work item due date should show on the assignee calendar");
  assert.equal(block!.target_href, `/workitems/${workItemId}`);
});

// R14 FIX（通知深链缺 conversation_id）：apps/api/src/services/notifications.ts 的
// notifyMilestone 会把工作台会话来源的 conversation_id 缝进 targetUrl 查询串（见
// apps/api/src/notifications.test.ts 的对应产生点测试）。这条测试锁死消费端——通知页 VM
// 的 notificationItem() 要把它解出来暴露成结构化的 conversation_id 字段，而不是只让调用方自己
// 解析 href 查询串；target_href 本身要保留完整查询串（web 无聊天 UI，跳到工作项页时带上这个参数）。
test("notifications page exposes conversation_id parsed from the target_href query string", async () => {
  const conversationId = "82000000-0000-4000-8000-00000000c001";
  const notifications = new MemoryNotifications();
  notifications.rows = [
    notification({
      id: "82000000-0000-4000-8000-000000000017",
      type: "workitem.escalated",
      severity: "high",
      title: "需要你来定一下",
      body: "这个活我先卡住了。",
      targetUrl: `/workitems/${workItemId}?conversation_id=${conversationId}`,
      workItemId,
      dedupeKey: "escalated-with-conversation"
    })
  ];
  const service = createScheduleNotifyPageService({
    notifications,
    scheduleNotify: new AssignedPrivateWorkItemScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  const inbox = await service.notificationsPage({ actor: actor(), locale: "zh-CN" });
  const item = inbox.items.find((candidate) => candidate.id === "82000000-0000-4000-8000-000000000017");
  assert.ok(item, "escalated notification with a conversation source should stay in the inbox");
  assert.equal(item!.conversation_id, conversationId);
  // target_href 保留完整查询串——web 没有聊天 UI，跳转仍是工作项页，只是带上会话标注。
  assert.equal(item!.actions.open?.href, `/workitems/${workItemId}?conversation_id=${conversationId}`);
});

// 没有会话上下文的通知（target_url 没有 ?conversation_id= 查询参数）不该出现这个字段——不硬造，
// 且不能因为解析失败/字段缺席就让整页通知崩掉。
test("notifications page omits conversation_id when the notification has no conversation source", async () => {
  const notifications = new MemoryNotifications();
  notifications.rows = [
    notification({
      id: "82000000-0000-4000-8000-000000000018",
      type: "workitem.due",
      severity: "normal",
      title: "普通到期提醒",
      body: null,
      targetUrl: `/workitems/${workItemId}`,
      workItemId,
      dedupeKey: "due-without-conversation"
    })
  ];
  const service = createScheduleNotifyPageService({
    notifications,
    scheduleNotify: new AssignedPrivateWorkItemScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  const inbox = await service.notificationsPage({ actor: actor(), locale: "zh-CN" });
  const item = inbox.items.find((candidate) => candidate.id === "82000000-0000-4000-8000-000000000018");
  assert.ok(item);
  assert.equal(item!.conversation_id, undefined);
  assert.equal(item!.actions.open?.href, `/workitems/${workItemId}`);
});

test("calendar schedule events do not expose dead work-item links for unreadable private work", async () => {
  const service = createScheduleNotifyPageService({
    notifications: new MemoryNotifications(),
    scheduleNotify: new ScheduleEventWithPrivateWorkItemScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  const calendar = await service.calendarPage({ actor: actor(), locale: "zh-CN", date: "2026-06-11", view: "day" });
  const block = calendar.blocks.find((candidate) => candidate.id === "82000000-0000-4000-8000-000000000017");
  if (!block) {
    throw new Error("project-visible schedule event still appears");
  }
  assert.equal(block.target_href, undefined);
  assert.equal(block.work_item_id, undefined);
  const sourceContext = block.source_context;
  if (!sourceContext) {
    throw new Error("schedule event block should carry source context");
  }
  assert.equal(sourceContext.source_type, "schedule_event");
  assert.equal("work_item_id" in sourceContext ? sourceContext.work_item_id : undefined, undefined);
});

test("calendar schedule events do not expose dead work-item links for soft-deleted work", async () => {
  const service = createScheduleNotifyPageService({
    notifications: new MemoryNotifications(),
    scheduleNotify: new ScheduleEventWithDeletedWorkItemScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  const calendar = await service.calendarPage({ actor: actor(), locale: "zh-CN", date: "2026-06-11", view: "day" });
  const block = calendar.blocks.find((candidate) => candidate.id === "82000000-0000-4000-8000-000000000018");
  if (!block) {
    throw new Error("project-visible schedule event still appears");
  }
  assert.equal(block.target_href, undefined);
  assert.equal(block.work_item_id, undefined);
  const sourceContext = block.source_context;
  if (!sourceContext) {
    throw new Error("schedule event block should carry source context");
  }
  assert.equal("work_item_id" in sourceContext ? sourceContext.work_item_id : undefined, undefined);
});

test("calendar page rejects malformed date and view queries instead of silently changing scope", async () => {
  const service = createScheduleNotifyPageService({
    notifications: new MemoryNotifications(),
    scheduleNotify: new MemoryScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  for (const input of [
    { date: "2026-02-30", view: "day" },
    { date: "not-a-date", view: "day" },
    { date: "2026-06-11", view: "agenda" }
  ]) {
    await assert.rejects(
      () => service.calendarPage({ actor: actor(), locale: "zh-CN", ...input }),
      (error: unknown) =>
        error instanceof ScheduleNotifyPageServiceError &&
        error.status === 422 &&
        error.code === "invalid_calendar_query"
    );
  }
});

test("calendar meeting followups do not expose unreadable private work item ids", async () => {
  const service = createScheduleNotifyPageService({
    notifications: new MemoryNotifications(),
    scheduleNotify: new MeetingInsightCalendarWithPrivateWorkItemScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  const calendar = await service.calendarPage({ actor: actor(), locale: "zh-CN", date: "2026-06-12", view: "day" });
  const block = calendar.blocks.find((candidate) => candidate.id === insightId);
  if (!block) {
    throw new Error("meeting followup still appears on the calendar");
  }
  assert.equal(block.kind, "meeting_followup");
  assert.equal(block.target_href, `/meetings?project_id=${projectId}&m=${meetingId}&insight_id=${insightId}`);
  assert.equal(block.work_item_id, undefined);
});

test("calendar page does not show merged work items as active due blocks", async () => {
  const service = createScheduleNotifyPageService({
    notifications: new MemoryNotifications(),
    scheduleNotify: new MergedWorkItemScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  const page = await service.calendarPage({ actor: actor(), locale: "zh-CN", date: "2026-06-11", view: "day" });

  assert.equal(page.summary.block_count, 0);
  assert.equal(page.empty_state, "no_schedule_blocks");
});

// A4：日历日卡带 is_today，供 UI 高亮「今天」。now = 2026-06-11T10:00Z → dateKey = 2026-06-11。
test("calendar days flag today using the same clock as the summary", async () => {
  const service = createScheduleNotifyPageService({
    notifications: new MemoryNotifications(),
    scheduleNotify: new MemoryScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  // day 视图：唯一一天即今天。
  const day = await service.calendarPage({ actor: actor(), locale: "zh-CN", date: "2026-06-11", view: "day" });
  assert.equal(day.days.length, 1);
  assert.equal(day.days[0]?.date, "2026-06-11");
  assert.equal(day.days[0]?.is_today, true);

  // week 视图：恰好一天标记为今天，且其 date === 今天；其余日期不误标。
  const week = await service.calendarPage({ actor: actor(), locale: "zh-CN", date: "2026-06-11", view: "week" });
  const flagged = week.days.filter((d) => d.is_today);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0]?.date, "2026-06-11");
  assert.equal(week.days.filter((d) => d.date !== "2026-06-11").every((d) => d.is_today === false), true);
});

test("schedule notify page service builds calendar blocks from due work and meeting followups", async () => {
  const service = createScheduleNotifyPageService({
    notifications: new MemoryNotifications(),
    scheduleNotify: new MemoryScheduleNotify(),
    audit: new MemoryAudit(),
    now: () => now
  });

  const page = await service.calendarPage({ actor: actor(), locale: "en-US", date: "2026-06-11", view: "week" });
  assert.equal(page.scope.view, "week");
  assert.equal(page.blocks.some((block) => block.kind === "work_item_due"), true);
  assert.equal(page.blocks.some((block) => block.kind === "meeting_followup"), true);

  // R2 audit#3：week_count 现为「块跨越的不同 ISO 周数」（周一锚点去重），不再恒等于 block_count。
  const expectedWeeks = new Set(
    page.blocks.map((block) => {
      const d = new Date(block.ends_at);
      const day = d.getUTCDay();
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
      return monday.toISOString().slice(0, 10);
    })
  );
  assert.equal(page.summary.week_count, expectedWeeks.size, "week_count counts distinct ISO weeks, not blocks");
});
