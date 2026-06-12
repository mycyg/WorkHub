import { and, desc, eq, gte, inArray, isNull, notInArray } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  agentRuns,
  approvalRequests,
  meetingInsights,
  meetingRecords,
  projects,
  workItems
} from "../schema/index.js";
import type {
  ScheduleNotifyProjectRow,
  ScheduleNotifyWorkItemRow,
  WorkItemScheduleSourceRow
} from "./schedule-notify.js";

export type ApprovalHealthSourceRow = {
  approval: typeof approvalRequests.$inferSelect;
  workItem: ScheduleNotifyWorkItemRow | null;
  project: ScheduleNotifyProjectRow | null;
};

export type AgentRunHealthSourceRow = {
  run: Pick<typeof agentRuns.$inferSelect, "id" | "workItemId" | "status" | "createdAt">;
  workItem: ScheduleNotifyWorkItemRow | null;
  project: ScheduleNotifyProjectRow | null;
};

export type MeetingInsightHealthSourceRow = {
  insight: Pick<typeof meetingInsights.$inferSelect, "id" | "status">;
  meeting: Pick<typeof meetingRecords.$inferSelect, "id" | "projectId">;
  project: ScheduleNotifyProjectRow | null;
};

export type ProjectHealthSourceRows = {
  projects: ScheduleNotifyProjectRow[];
  openWorkItems: WorkItemScheduleSourceRow[];
  pendingApprovals: ApprovalHealthSourceRow[];
  failedRuns: AgentRunHealthSourceRow[];
  pendingInsights: MeetingInsightHealthSourceRow[];
};

type WorkItemStatusColumn = typeof workItems.$inferSelect.status;

// 与 WorkItemStatus 终态同口径：merged/done/cancelled 之外都算 open。
const doneWorkItemStatuses: WorkItemStatusColumn[] = ["merged", "done", "cancelled"];
const failedRunStatuses = ["failed", "escalated"];

function clampLimit(limit: number | undefined, fallback: number, max: number) {
  return Math.max(1, Math.min(limit ?? fallback, max));
}

export type ProjectHealthRepository = {
  readProjectHealthSources: (input: {
    failedRunsSince: Date;
    limit?: number;
  }) => Promise<ProjectHealthSourceRows>;
};

export function createProjectHealthRepository(db: WorkHubDb): ProjectHealthRepository {
  return {
    async readProjectHealthSources(input) {
      const limit = clampLimit(input.limit, 300, 600);
      const projectRows = await db
        .select()
        .from(projects)
        .where(and(eq(projects.archived, false), isNull(projects.deletedAt)))
        .orderBy(desc(projects.updatedAt))
        .limit(clampLimit(input.limit, 100, 200));
      const openWorkItems = await db
        .select({ workItem: workItems, project: projects })
        .from(workItems)
        .leftJoin(projects, eq(workItems.projectId, projects.id))
        .where(and(
          isNull(workItems.deletedAt),
          notInArray(workItems.status, doneWorkItemStatuses)
        ))
        .orderBy(desc(workItems.updatedAt))
        .limit(limit);
      const pendingApprovals = await db
        .select({ approval: approvalRequests, workItem: workItems, project: projects })
        .from(approvalRequests)
        .leftJoin(workItems, eq(approvalRequests.workItemId, workItems.id))
        .leftJoin(projects, eq(workItems.projectId, projects.id))
        .where(eq(approvalRequests.status, "pending"))
        .orderBy(desc(approvalRequests.updatedAt))
        .limit(limit);
      const failedRuns = await db
        .select({
          run: {
            id: agentRuns.id,
            workItemId: agentRuns.workItemId,
            status: agentRuns.status,
            createdAt: agentRuns.createdAt
          },
          workItem: workItems,
          project: projects
        })
        .from(agentRuns)
        .leftJoin(workItems, eq(agentRuns.workItemId, workItems.id))
        .leftJoin(projects, eq(workItems.projectId, projects.id))
        .where(and(
          inArray(agentRuns.status, failedRunStatuses),
          gte(agentRuns.createdAt, input.failedRunsSince)
        ))
        .orderBy(desc(agentRuns.createdAt))
        .limit(limit);
      const pendingInsights = await db
        .select({
          insight: { id: meetingInsights.id, status: meetingInsights.status },
          meeting: { id: meetingRecords.id, projectId: meetingRecords.projectId },
          project: projects
        })
        .from(meetingInsights)
        .innerJoin(meetingRecords, eq(meetingInsights.meetingId, meetingRecords.id))
        .leftJoin(projects, eq(meetingRecords.projectId, projects.id))
        .where(eq(meetingInsights.status, "pending"))
        .orderBy(desc(meetingInsights.createdAt))
        .limit(limit);
      return {
        projects: projectRows,
        openWorkItems,
        pendingApprovals,
        failedRuns,
        pendingInsights
      };
    }
  };
}
