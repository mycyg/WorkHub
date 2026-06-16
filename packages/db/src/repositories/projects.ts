import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { orgs, projects, workItems, workspaces } from "../schema/index.js";

export type ProjectRow = typeof projects.$inferSelect;

export type ProjectListRow = {
  id: string;
  workspaceId: string | null;
  name: string;
  slug: string;
  description: string | null;
  ownerNickname: string;
  ownerUserId: string | null;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
  openWorkItemCount: number;
};

export type BootstrapProjectInput = {
  orgId: string;
  workspaceId: string;
  projectId?: string;
  name: string;
  slug: string;
  description?: string | null;
  ownerNickname: string;
  ownerUserId: string;
  at?: Date;
};

export type BootstrapProjectResultRow = {
  project: ProjectRow;
  created: boolean;
};

export type ProjectRepository = {
  bootstrapPilotProject: (input: BootstrapProjectInput) => Promise<BootstrapProjectResultRow>;
  listForWorkspace: (workspaceId: string) => Promise<ProjectListRow[]>;
};

export function createProjectRepository(db: WorkHubDb): ProjectRepository {
  return {
    async listForWorkspace(workspaceId) {
      // 左连接 work_items,用条件求和数「进行中」工作项(非 merged/done/cancelled 且未删除)。
      // 用 sum(case) 而非 PG 专有 FILTER 语法,兼容性更稳;leftJoin 的 NULL 行计 0。
      const rows = await db
        .select({
          id: projects.id,
          workspaceId: projects.workspaceId,
          name: projects.name,
          slug: projects.slug,
          description: projects.description,
          ownerNickname: projects.ownerNickname,
          ownerUserId: projects.ownerUserId,
          archived: projects.archived,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          openWorkItemCount: sql<number>`coalesce(sum(case when ${workItems.id} is not null and ${workItems.status} not in ('merged','done','cancelled') and ${workItems.deletedAt} is null then 1 else 0 end), 0)`
        })
        .from(projects)
        .leftJoin(workItems, eq(workItems.projectId, projects.id))
        .where(and(eq(projects.workspaceId, workspaceId), eq(projects.archived, false), isNull(projects.deletedAt)))
        .groupBy(projects.id)
        .orderBy(desc(projects.updatedAt));
      return rows.map((row) => ({ ...row, openWorkItemCount: Number(row.openWorkItemCount) }));
    },

    async bootstrapPilotProject(input) {
      const at = input.at ?? new Date();
      await db
        .insert(orgs)
        .values({
          id: input.orgId,
          name: "WorkHub Local",
          slug: "workhub-local",
          plan: "lan",
          createdAt: at,
          updatedAt: at
        })
        .onConflictDoNothing();

      await db
        .insert(workspaces)
        .values({
          id: input.workspaceId,
          orgId: input.orgId,
          name: "Pilot Workspace",
          slug: "pilot",
          createdAt: at,
          updatedAt: at
        })
        .onConflictDoNothing();

      const existingRows = await db
        .select()
        .from(projects)
        .where(and(eq(projects.slug, input.slug), eq(projects.archived, false), isNull(projects.deletedAt)))
        .limit(1);
      const existing = existingRows[0];
      if (existing) {
        return { project: existing, created: false };
      }

      const rows = await db
        .insert(projects)
        .values({
          id: input.projectId ?? randomUUID(),
          workspaceId: input.workspaceId,
          name: input.name,
          slug: input.slug,
          ...(input.description ? { description: input.description } : {}),
          ownerNickname: input.ownerNickname,
          ownerUserId: input.ownerUserId,
          archived: false,
          nextSeq: 0,
          createdAt: at,
          updatedAt: at
        })
        .returning();
      const project = rows[0];
      if (!project) {
        throw new Error("Failed to create pilot project");
      }
      return { project, created: true };
    }
  };
}
