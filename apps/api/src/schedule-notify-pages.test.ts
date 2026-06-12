import assert from "node:assert/strict";
import test from "node:test";

import type {
  AuditLogRepository,
  CreateAuditLogInput,
  CreateNotificationInput,
  MeetingInsightScheduleSourceRow,
  NotificationRepository,
  NotificationRow,
  NotificationWriteResult,
  ScheduleNotifyRepository,
  WorkItemScheduleSourceRow
} from "@workhub/db";

import { createScheduleNotifyPageService } from "./services/schedule-notify-pages.js";
import type { AuthActor } from "./middleware/auth.js";

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

  async createOrUpdateNotification(input: CreateNotificationInput, at: Date): Promise<NotificationWriteResult> {
    const existing = this.rows.find((row) => row.dedupeKey === input.dedupeKey && row.userId === input.userId);
    if (existing) {
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

  async listForUser() {
    return this.rows;
  }

  async markRead(id: string) {
    const row = this.rows.find((item) => item.id === id);
    return row ? { ...row, readAt: now, updatedAt: now } : null;
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
}

class MemoryScheduleNotify implements ScheduleNotifyRepository {
  async readNotificationContexts() {
    return {
      workItems: [],
      meetingInsights: [meetingInsightSource()]
    };
  }

  async listMeetingInsightSources() {
    return [meetingInsightSource()];
  }

  async readSchedulePageRows() {
    return {
      events: [],
      dueWorkItems: [workItemSource()],
      meetingInsights: [meetingInsightSource()]
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

  await service.dismiss(page.buckets.needs_decision[0]!.id, actor());
  assert.equal(audit.inputs.at(-1)?.action, "notification.dismiss");
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
});
