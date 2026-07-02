import { and, desc, eq, gte, inArray, isNotNull, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  agentRuns,
  approvalRequests,
  meetingInsights,
  meetingRecords,
  projects,
  workItemAssignments,
  workItems,
  workspaces
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
  workItemAssignments?: Array<{ userId: string; role: string }>;
};

export type AgentRunHealthSourceRow = {
  run: Pick<typeof agentRuns.$inferSelect, "id" | "workItemId" | "status" | "createdAt">;
  workItem: ScheduleNotifyWorkItemRow | null;
  project: ScheduleNotifyProjectRow | null;
  workItemAssignments?: Array<{ userId: string; role: string }>;
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
type ProjectHealthActorScope = {
  isAdmin?: boolean;
  orgId?: string;
  userId?: string;
  workspaceId?: string;
};

// 与 WorkItemStatus 终态同口径：merged/done/cancelled 之外都算 open。
const doneWorkItemStatuses: WorkItemStatusColumn[] = ["merged", "done", "cancelled"];
const privateWorkItemStatuses: WorkItemStatusColumn[] = ["intake", "ai_clarifying", "spec_ready"];
const failedRunStatuses = ["failed", "escalated"];

function clampLimit(limit: number | undefined, fallback: number, max: number) {
  return Math.max(1, Math.min(limit ?? fallback, max));
}

export type ProjectHealthRepository = {
  readProjectHealthSources: (input: {
    actor?: ProjectHealthActorScope;
    failedRunsSince: Date;
    limit?: number;
  }) => Promise<ProjectHealthSourceRows>;
};

function projectScopeConditions(actor: ProjectHealthActorScope | undefined): SQL[] {
  const conditions: SQL[] = [
    eq(projects.archived, false),
    isNull(projects.deletedAt)
  ];
  if (!actor) {
    return conditions;
  }
  if (actor.isAdmin) {
    if (actor.orgId) {
      conditions.push(sql`exists (
        select 1
        from ${workspaces}
        where ${workspaces.id} = ${projects.workspaceId}
          and ${workspaces.orgId} = ${actor.orgId}
      )`);
    }
    return conditions;
  }
  if (actor.workspaceId) {
    conditions.push(eq(projects.workspaceId, actor.workspaceId));
  } else if (actor.userId) {
    conditions.push(eq(projects.ownerUserId, actor.userId));
  } else {
    conditions.push(sql`false`);
  }
  return conditions;
}

function workItemScopeConditions(actor: ProjectHealthActorScope | undefined): SQL[] {
  if (!actor || actor.isAdmin) {
    return [];
  }
  const conditions: SQL[] = [];
  if (actor.workspaceId) {
    conditions.push(or(
      eq(workItems.workspaceId, actor.workspaceId),
      eq(projects.workspaceId, actor.workspaceId)
    ) ?? sql`false`);
  } else {
    conditions.push(sql`false`);
  }
  if (actor.userId) {
    conditions.push(or(
      notInArray(workItems.status, privateWorkItemStatuses),
      eq(workItems.submitterUserId, actor.userId),
      eq(workItems.claimedByUserId, actor.userId),
      sql`exists (
        select 1
        from ${workItemAssignments}
        where ${workItemAssignments.workItemId} = ${workItems.id}
          and ${workItemAssignments.userId} = ${actor.userId}
      )`
    ) ?? sql`false`);
  } else {
    conditions.push(notInArray(workItems.status, privateWorkItemStatuses));
  }
  return conditions;
}

export function createProjectHealthRepository(db: WorkHubDb): ProjectHealthRepository {
  function withProjectOrg<T extends { project: ScheduleNotifyProjectRow | null; projectOrgId?: string | null }>(
    rows: T[]
  ): Array<Omit<T, "projectOrgId">> {
    return rows.map(({ projectOrgId, ...row }) => ({
      ...row,
      project: row.project ? { ...row.project, orgId: projectOrgId } : null
    }));
  }

  async function loadAssignmentsByWorkItemId(ids: string[]) {
    const uniqueWorkItemIds = [...new Set(ids.filter(Boolean))];
    if (uniqueWorkItemIds.length === 0) {
      return new Map<string, Array<{ userId: string; role: string }>>();
    }
    const assignments = await db
      .select({
        workItemId: workItemAssignments.workItemId,
        userId: workItemAssignments.userId,
        role: workItemAssignments.role
      })
      .from(workItemAssignments)
      .where(inArray(workItemAssignments.workItemId, uniqueWorkItemIds));
    const assignmentsByWorkItemId = new Map<string, Array<{ userId: string; role: string }>>();
    for (const assignment of assignments) {
      const bucket = assignmentsByWorkItemId.get(assignment.workItemId) ?? [];
      bucket.push({ userId: assignment.userId, role: assignment.role });
      assignmentsByWorkItemId.set(assignment.workItemId, bucket);
    }
    return assignmentsByWorkItemId;
  }

  async function withWorkItemAssignments<T extends { workItem: ScheduleNotifyWorkItemRow | null }>(rows: T[]) {
    const assignmentsByWorkItemId = await loadAssignmentsByWorkItemId(
      rows.map((row) => row.workItem?.id).filter((id): id is string => Boolean(id))
    );
    return rows.map((row) => ({
      ...row,
      ...(row.workItem ? {
        assignments: assignmentsByWorkItemId.get(row.workItem.id) ?? [],
        workItemAssignments: assignmentsByWorkItemId.get(row.workItem.id) ?? []
      } : {})
    }));
  }

  return {
    async readProjectHealthSources(input) {
      const limit = clampLimit(input.limit, 300, 600);
      const projectRows = await db
        .select({
          project: projects,
          orgId: workspaces.orgId
        })
        .from(projects)
        .leftJoin(workspaces, eq(projects.workspaceId, workspaces.id))
        .where(and(...projectScopeConditions(input.actor)))
        .orderBy(desc(projects.updatedAt))
        .limit(clampLimit(input.limit, 100, 200));
      const openWorkItems = await db
        .select({ workItem: workItems, project: projects, projectOrgId: workspaces.orgId })
        .from(workItems)
        .leftJoin(projects, eq(workItems.projectId, projects.id))
        .leftJoin(workspaces, eq(projects.workspaceId, workspaces.id))
        .where(and(
          isNull(workItems.deletedAt),
          notInArray(workItems.status, doneWorkItemStatuses),
          ...projectScopeConditions(input.actor),
          ...workItemScopeConditions(input.actor)
        ))
        .orderBy(desc(workItems.updatedAt))
        .limit(limit);
      const pendingApprovalConditions: SQL[] = [
        eq(approvalRequests.status, "pending"),
        isNotNull(workItems.id),
        isNull(workItems.deletedAt),
        ...projectScopeConditions(input.actor),
        ...workItemScopeConditions(input.actor)
      ];
      if (input.actor && !input.actor.isAdmin) {
        pendingApprovalConditions.push(input.actor.userId
          ? eq(approvalRequests.routedToUserId, input.actor.userId)
          : sql`false`);
      }
      const pendingApprovals = await db
        .select({ approval: approvalRequests, workItem: workItems, project: projects, projectOrgId: workspaces.orgId })
        .from(approvalRequests)
        .leftJoin(workItems, eq(approvalRequests.workItemId, workItems.id))
        .leftJoin(projects, eq(workItems.projectId, projects.id))
        .leftJoin(workspaces, eq(projects.workspaceId, workspaces.id))
        .where(and(...pendingApprovalConditions))
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
          project: projects,
          projectOrgId: workspaces.orgId
        })
        .from(agentRuns)
        .leftJoin(workItems, eq(agentRuns.workItemId, workItems.id))
        .leftJoin(projects, eq(workItems.projectId, projects.id))
        .leftJoin(workspaces, eq(projects.workspaceId, workspaces.id))
        .where(and(
          inArray(agentRuns.status, failedRunStatuses),
          gte(agentRuns.createdAt, input.failedRunsSince),
          isNotNull(workItems.id),
          isNull(workItems.deletedAt),
          notInArray(workItems.status, doneWorkItemStatuses),
          ...projectScopeConditions(input.actor),
          ...workItemScopeConditions(input.actor)
        ))
        .orderBy(desc(agentRuns.createdAt))
        .limit(limit);
      const pendingInsights = await db
        .select({
          insight: { id: meetingInsights.id, status: meetingInsights.status },
          meeting: { id: meetingRecords.id, projectId: meetingRecords.projectId },
          project: projects,
          projectOrgId: workspaces.orgId
        })
        .from(meetingInsights)
        .innerJoin(meetingRecords, eq(meetingInsights.meetingId, meetingRecords.id))
        .leftJoin(projects, eq(meetingRecords.projectId, projects.id))
        .leftJoin(workspaces, eq(projects.workspaceId, workspaces.id))
        .where(and(
          eq(meetingInsights.status, "pending"),
          ...projectScopeConditions(input.actor)
        ))
        .orderBy(desc(meetingInsights.createdAt))
        .limit(limit);
      return {
        projects: projectRows.map((row) => ({ ...row.project, orgId: row.orgId })),
        openWorkItems: await withWorkItemAssignments(withProjectOrg(openWorkItems)),
        pendingApprovals: await withWorkItemAssignments(withProjectOrg(pendingApprovals)),
        failedRuns: await withWorkItemAssignments(withProjectOrg(failedRuns)),
        pendingInsights: withProjectOrg(pendingInsights)
      };
    }
  };
}
