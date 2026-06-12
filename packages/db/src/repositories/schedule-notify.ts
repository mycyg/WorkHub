import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  meetingInsights,
  meetingRecords,
  projects,
  scheduleEvents,
  users,
  workItems
} from "../schema/index.js";

export type ScheduleNotifyProjectRow = typeof projects.$inferSelect;
export type ScheduleNotifyUserRow = typeof users.$inferSelect;
export type ScheduleNotifyWorkItemRow = typeof workItems.$inferSelect;
export type ScheduleNotifyMeetingRecordRow = typeof meetingRecords.$inferSelect;
export type ScheduleNotifyMeetingInsightRow = typeof meetingInsights.$inferSelect;
export type ScheduleEventRow = typeof scheduleEvents.$inferSelect;

export type WorkItemScheduleSourceRow = {
  workItem: ScheduleNotifyWorkItemRow;
  project: ScheduleNotifyProjectRow | null;
};

export type MeetingInsightScheduleSourceRow = {
  insight: ScheduleNotifyMeetingInsightRow;
  meeting: ScheduleNotifyMeetingRecordRow;
  project: ScheduleNotifyProjectRow | null;
  uploadedBy: ScheduleNotifyUserRow | null;
};

export type ScheduleEventSourceRow = {
  event: ScheduleEventRow;
  project: ScheduleNotifyProjectRow | null;
  workItem: ScheduleNotifyWorkItemRow | null;
};

export type NotificationContextRows = {
  workItems: WorkItemScheduleSourceRow[];
  meetingInsights: MeetingInsightScheduleSourceRow[];
};

export type SchedulePageRows = {
  events: ScheduleEventSourceRow[];
  dueWorkItems: WorkItemScheduleSourceRow[];
  meetingInsights: MeetingInsightScheduleSourceRow[];
};

export type ScheduleNotifyRepository = {
  readNotificationContexts: (input: {
    workItemIds?: string[];
    meetingInsightIds?: string[];
  }) => Promise<NotificationContextRows>;
  listMeetingInsightSources: (input?: { limit?: number }) => Promise<MeetingInsightScheduleSourceRow[]>;
  readSchedulePageRows: (input: {
    actorUserId: string;
    rangeStart: Date;
    rangeEnd: Date;
    limit?: number;
  }) => Promise<SchedulePageRows>;
};

function clampLimit(limit: number | undefined, fallback = 120) {
  return Math.max(1, Math.min(limit ?? fallback, 300));
}

function activeProjectCondition() {
  return and(eq(projects.archived, false), isNull(projects.deletedAt));
}

function uniqueIds(ids: string[] | undefined) {
  return [...new Set((ids ?? []).filter(Boolean))];
}

export function createScheduleNotifyRepository(db: WorkHubDb): ScheduleNotifyRepository {
  return {
    async readNotificationContexts(input) {
      const workItemIds = uniqueIds(input.workItemIds);
      const meetingInsightIds = uniqueIds(input.meetingInsightIds);
      const workItemRows = workItemIds.length
        ? await db
          .select({
            workItem: workItems,
            project: projects
          })
          .from(workItems)
          .leftJoin(projects, eq(workItems.projectId, projects.id))
          .where(and(inArray(workItems.id, workItemIds), isNull(workItems.deletedAt)))
          .limit(workItemIds.length)
        : [];
      const meetingInsightRows = meetingInsightIds.length
        ? await db
          .select({
            insight: meetingInsights,
            meeting: meetingRecords,
            project: projects,
            uploadedBy: users
          })
          .from(meetingInsights)
          .innerJoin(meetingRecords, eq(meetingInsights.meetingId, meetingRecords.id))
          .leftJoin(projects, eq(meetingRecords.projectId, projects.id))
          .leftJoin(users, eq(meetingRecords.uploadedByUserId, users.id))
          .where(inArray(meetingInsights.id, meetingInsightIds))
          .limit(meetingInsightIds.length)
        : [];
      return {
        workItems: workItemRows,
        meetingInsights: meetingInsightRows
      };
    },

    async listMeetingInsightSources(input = {}) {
      return db
        .select({
          insight: meetingInsights,
          meeting: meetingRecords,
          project: projects,
          uploadedBy: users
        })
        .from(meetingInsights)
        .innerJoin(meetingRecords, eq(meetingInsights.meetingId, meetingRecords.id))
        .leftJoin(projects, eq(meetingRecords.projectId, projects.id))
        .leftJoin(users, eq(meetingRecords.uploadedByUserId, users.id))
        .where(and(
          activeProjectCondition(),
          inArray(meetingInsights.status, ["pending", "confirmed"])
        ))
        .orderBy(desc(meetingInsights.createdAt))
        .limit(clampLimit(input.limit, 80));
    },

    async readSchedulePageRows(input) {
      const limit = clampLimit(input.limit);
      const eventRows = await db
        .select({
          event: scheduleEvents,
          project: projects,
          workItem: workItems
        })
        .from(scheduleEvents)
        .leftJoin(projects, eq(scheduleEvents.projectId, projects.id))
        .leftJoin(workItems, eq(scheduleEvents.workItemId, workItems.id))
        .where(and(
          gte(scheduleEvents.endAt, input.rangeStart),
          lte(scheduleEvents.endAt, input.rangeEnd)
        ))
        .orderBy(asc(scheduleEvents.endAt))
        .limit(limit);
      const dueWorkItems = await db
        .select({
          workItem: workItems,
          project: projects
        })
        .from(workItems)
        .leftJoin(projects, eq(workItems.projectId, projects.id))
        .where(and(
          isNull(workItems.deletedAt),
          lte(workItems.dueAt, input.rangeEnd),
          or(
            eq(workItems.submitterUserId, input.actorUserId),
            eq(workItems.claimedByUserId, input.actorUserId)
          )
        ))
        .orderBy(asc(workItems.dueAt))
        .limit(limit);
      const meetingInsightRows = await this.listMeetingInsightSources({ limit: Math.min(limit, 80) });
      return {
        events: eventRows,
        dueWorkItems,
        meetingInsights: meetingInsightRows
      };
    }
  };
}
