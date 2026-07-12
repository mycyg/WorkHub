import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
  type SQL
} from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  acceptedDeliverableChanges,
  projectDriveItems,
  projectDriveVersions,
  projects,
  taskPlans,
  users,
  workItemAssignments,
  workItems,
  workspaceMemberships,
  workspaces
} from "../schema/index.js";
import type { MembershipRole } from "./memberships.js";
import { DASHBOARD_PLAN_STATUSES } from "./task-plans.js";

const PRIVATE_WORK_ITEM_STATUSES = ["intake", "ai_clarifying", "spec_ready"] as const;

export type WorkbenchAccessInput = {
  workspaceId: string;
  viewerUserId: string;
  projectId: string;
};

export type ListWorkspaceMembersInput = {
  workspaceId: string;
  viewerUserId: string;
  projectOwnerUserId: string | null;
  limit?: number;
};

export type CountVisibleActivePlansInput = {
  workspaceId: string;
  projectId: string;
  viewerUserId: string;
  isAdmin: boolean;
};

export type ListRecentVisibleFilesInput = {
  workspaceId: string;
  projectId: string;
  viewerUserId: string;
  isAdmin: boolean;
  limit?: number;
};

export type WorkbenchAccess = {
  project: {
    id: string;
    workspaceId: string;
    name: string;
    slug: string;
    description: string | null;
    ownerNickname: string;
    ownerUserId: string | null;
  };
  membershipRole: MembershipRole;
};

export type WorkbenchMember = {
  userId: string;
  nickname: string;
  membershipRole: MembershipRole;
  isProjectOwner: boolean;
  isSelf: boolean;
};

export type WorkbenchMemberPage = {
  total: number;
  returned: number;
  capped: boolean;
  items: WorkbenchMember[];
};

export type WorkbenchRecentFile = {
  id: string;
  name: string;
  updatedAt: Date;
};

export class WorkbenchRepositoryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbenchRepositoryInputError";
  }
}

export class WorkbenchRepositoryInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbenchRepositoryInvariantError";
  }
}

function exactLimit(value: number | undefined, fallback: number, maximum: number, label: string) {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    throw new WorkbenchRepositoryInputError(`${label} must be a safe integer from 1 to ${maximum}.`);
  }
  return limit;
}

function exactNonnegativeCount(value: unknown, label: string): number {
  if (typeof value === "bigint") {
    if (value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value);
    }
    throw new WorkbenchRepositoryInvariantError(`${label} is outside the safe nonnegative integer range.`);
  }
  if (typeof value === "string") {
    if (!/^\d+$/u.test(value)) {
      throw new WorkbenchRepositoryInvariantError(`${label} is not an exact nonnegative integer.`);
    }
    const parsed = BigInt(value);
    if (parsed <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(parsed);
    }
    throw new WorkbenchRepositoryInvariantError(`${label} exceeds the safe integer range.`);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  throw new WorkbenchRepositoryInvariantError(`${label} is not an exact nonnegative integer.`);
}

function visibleWorkItemCondition(viewerUserId: string): SQL {
  return or(
    notInArray(workItems.status, [...PRIVATE_WORK_ITEM_STATUSES]),
    eq(workItems.submitterUserId, viewerUserId),
    eq(workItems.claimedByUserId, viewerUserId),
    sql`exists (
      select 1
      from ${workItemAssignments}
      where ${workItemAssignments.workItemId} = ${workItems.id}
        and ${workItemAssignments.userId} = ${viewerUserId}
    )`
  ) ?? sql`false`;
}

export type WorkbenchRepository = ReturnType<typeof createWorkbenchRepository>;

export function createWorkbenchRepository(db: WorkHubDb) {
  return {
    async findWorkbenchAccess(input: WorkbenchAccessInput): Promise<WorkbenchAccess | null> {
      const rows = await db
        .select({
          project: {
            id: projects.id,
            workspaceId: projects.workspaceId,
            name: projects.name,
            slug: projects.slug,
            description: projects.description,
            ownerNickname: projects.ownerNickname,
            ownerUserId: projects.ownerUserId
          },
          membershipRole: workspaceMemberships.role
        })
        .from(projects)
        .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
        .innerJoin(workspaceMemberships, and(
          eq(workspaceMemberships.workspaceId, workspaces.id),
          eq(workspaceMemberships.userId, input.viewerUserId)
        ))
        .innerJoin(users, eq(users.id, workspaceMemberships.userId))
        .where(and(
          eq(projects.id, input.projectId),
          eq(projects.workspaceId, input.workspaceId),
          eq(projects.archived, false),
          isNull(projects.deletedAt),
          eq(workspaces.id, input.workspaceId),
          isNull(workspaces.deletedAt),
          eq(workspaceMemberships.workspaceId, input.workspaceId),
          eq(workspaceMemberships.userId, input.viewerUserId),
          isNull(workspaceMemberships.deletedAt),
          eq(users.id, input.viewerUserId),
          isNull(users.deletedAt)
        ))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }
      return {
        project: {
          ...row.project,
          workspaceId: row.project.workspaceId as string
        },
        membershipRole: row.membershipRole as MembershipRole
      };
    },

    async listWorkspaceMembers(input: ListWorkspaceMembersInput): Promise<WorkbenchMemberPage> {
      const limit = exactLimit(input.limit, 100, 100, "workspace member limit");
      const isProjectOwner = input.projectOwnerUserId
        ? sql<boolean>`${users.id} = ${input.projectOwnerUserId}`
        : sql<boolean>`false`;
      const rows = await db
        .select({
          userId: users.id,
          nickname: users.nickname,
          membershipRole: workspaceMemberships.role,
          isProjectOwner,
          isSelf: sql<boolean>`${users.id} = ${input.viewerUserId}`,
          total: sql<number | string>`count(*) over()`
        })
        .from(workspaceMemberships)
        .innerJoin(users, eq(users.id, workspaceMemberships.userId))
        .where(and(
          eq(workspaceMemberships.workspaceId, input.workspaceId),
          isNull(workspaceMemberships.deletedAt),
          isNull(users.deletedAt),
          sql`exists (
            select 1
            from ${workspaceMemberships}
            inner join ${users} on ${users.id} = ${workspaceMemberships.userId}
            where ${workspaceMemberships.workspaceId} = ${input.workspaceId}
              and ${workspaceMemberships.userId} = ${input.viewerUserId}
              and ${workspaceMemberships.deletedAt} is null
              and ${users.deletedAt} is null
          )`
        ))
        .orderBy(
          desc(sql<boolean>`${users.id} = ${input.viewerUserId}`),
          desc(isProjectOwner),
          asc(sql`lower(${users.nickname})`),
          asc(users.id)
        )
        .limit(limit);
      const total = rows[0] ? exactNonnegativeCount(rows[0].total, "workspace member total") : 0;
      const items = rows.map((row) => ({
        userId: row.userId,
        nickname: row.nickname,
        membershipRole: row.membershipRole as MembershipRole,
        isProjectOwner: Boolean(row.isProjectOwner),
        isSelf: Boolean(row.isSelf)
      }));
      return {
        total,
        returned: items.length,
        capped: total > items.length,
        items
      };
    },

    async countVisibleActivePlans(input: CountVisibleActivePlansInput): Promise<number> {
      const conditions: SQL[] = [
        eq(taskPlans.workspaceId, input.workspaceId),
        inArray(taskPlans.status, DASHBOARD_PLAN_STATUSES),
        eq(workItems.workspaceId, input.workspaceId),
        eq(workItems.projectId, input.projectId),
        isNull(workItems.deletedAt),
        eq(projects.id, input.projectId),
        eq(projects.workspaceId, input.workspaceId),
        eq(projects.archived, false),
        isNull(projects.deletedAt),
        eq(workspaces.id, input.workspaceId),
        isNull(workspaces.deletedAt)
      ];
      if (!input.isAdmin) {
        conditions.push(visibleWorkItemCondition(input.viewerUserId));
      }
      const rows = await db
        .select({ value: sql<number | string>`count(*)` })
        .from(taskPlans)
        .innerJoin(workItems, eq(workItems.id, taskPlans.workItemId))
        .innerJoin(projects, eq(projects.id, workItems.projectId))
        .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
        .where(and(...conditions));
      return exactNonnegativeCount(rows[0]?.value, "active plan count");
    },

    async listRecentVisibleFiles(input: ListRecentVisibleFilesInput): Promise<WorkbenchRecentFile[]> {
      const limit = exactLimit(input.limit, 5, 5, "recent file limit");
      const linkedWorkItemVisibility = input.isAdmin
        ? sql`true`
        : visibleWorkItemCondition(input.viewerUserId);
      return db
        .select({
          id: projectDriveItems.id,
          name: projectDriveItems.name,
          updatedAt: projectDriveItems.updatedAt
        })
        .from(projectDriveItems)
        .innerJoin(projectDriveVersions, and(
          eq(projectDriveVersions.id, projectDriveItems.currentVersionId),
          eq(projectDriveVersions.itemId, projectDriveItems.id)
        ))
        .innerJoin(projects, eq(projects.id, projectDriveItems.projectId))
        .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
        .where(and(
          eq(projectDriveItems.projectId, input.projectId),
          eq(projectDriveItems.kind, "file"),
          isNull(projectDriveItems.deletedAt),
          eq(projects.id, input.projectId),
          eq(projects.workspaceId, input.workspaceId),
          eq(projects.archived, false),
          isNull(projects.deletedAt),
          eq(workspaces.id, input.workspaceId),
          isNull(workspaces.deletedAt),
          or(
            sql`not exists (
              select 1
              from ${acceptedDeliverableChanges}
              where ${acceptedDeliverableChanges.driveItemId} = ${projectDriveItems.id}
                and ${acceptedDeliverableChanges.driveVersionId} = ${projectDriveItems.currentVersionId}
                and ${acceptedDeliverableChanges.supersededAt} is null
            )`,
            sql`exists (
              select 1
              from ${acceptedDeliverableChanges}
              inner join ${workItems} on ${workItems.id} = ${acceptedDeliverableChanges.workItemId}
              where ${acceptedDeliverableChanges.driveItemId} = ${projectDriveItems.id}
                and ${acceptedDeliverableChanges.driveVersionId} = ${projectDriveItems.currentVersionId}
                and ${acceptedDeliverableChanges.supersededAt} is null
                and ${workItems.workspaceId} = ${input.workspaceId}
                and ${workItems.projectId} = ${input.projectId}
                and ${workItems.deletedAt} is null
                and ${linkedWorkItemVisibility}
            )`
          ) ?? sql`false`
        ))
        .orderBy(desc(projectDriveItems.updatedAt), desc(projectDriveItems.id))
        .limit(limit);
    }
  };
}
