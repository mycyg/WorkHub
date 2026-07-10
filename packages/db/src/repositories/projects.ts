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

export class ProjectSlugOccupiedError extends Error {
  constructor(public readonly slug: string) {
    super("Project slug is occupied by an archived or deleted project in this workspace");
  }
}

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
          // R12（多项目）：projects.updatedAt 建库后从不被写路径更新≈创建时间——「按更新时间排序」
          // 与「更新于」展示都在撒谎。真活跃时间 = max(项目行, 项目内工作项最新 updatedAt)。
          lastActivityAt: sql<Date>`greatest(${projects.updatedAt}, coalesce(max(case when ${workItems.deletedAt} is null then ${workItems.updatedAt} end), ${projects.updatedAt}))`,
          openWorkItemCount: sql<number>`coalesce(sum(case when ${workItems.id} is not null and ${workItems.status} not in ('merged','done','cancelled') and ${workItems.deletedAt} is null then 1 else 0 end), 0)`
        })
        .from(projects)
        .leftJoin(workItems, eq(workItems.projectId, projects.id))
        .where(and(eq(projects.workspaceId, workspaceId), eq(projects.archived, false), isNull(projects.deletedAt)))
        .groupBy(projects.id)
        .orderBy(sql`greatest(${projects.updatedAt}, coalesce(max(case when ${workItems.deletedAt} is null then ${workItems.updatedAt} end), ${projects.updatedAt})) desc`);
      return rows.map((row) => ({
        ...row,
        // 展示与排序同源：updatedAt 用真活跃时间（VM 的 updated_at 即由它而来）。
        updatedAt: row.lastActivityAt instanceof Date ? row.lastActivityAt : new Date(String(row.lastActivityAt)),
        openWorkItemCount: Number(row.openWorkItemCount)
      }));
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

      // rank1：复用查询必须按工作区过滤——否则 slug 全局命中会把别的工作区的项目串给本工作区（跨租户泄漏）。
      const findActive = async (): Promise<ProjectRow | undefined> => {
        const rows = await db
          .select()
          .from(projects)
          .where(
            and(
              eq(projects.workspaceId, input.workspaceId),
              eq(projects.slug, input.slug),
              eq(projects.archived, false),
              isNull(projects.deletedAt)
            )
          )
          .limit(1);
        return rows[0];
      };

      const existing = await findActive();
      if (existing) {
        return { project: existing, created: false };
      }

      // 原子创建：ON CONFLICT (workspace_id, slug) DO NOTHING（与迁移 0028 的工作区级唯一索引对齐）。
      // 并发同 (workspace, slug) 时第二发不再撞唯一抛 500，而是落空→回查已存在的那条按复用返回。
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
        .onConflictDoNothing({ target: [projects.workspaceId, projects.slug] })
        .returning();
      const project = rows[0];
      if (project) {
        return { project, created: true };
      }
      // onConflict 落空：要么并发抢先建了同一条（回查复用），要么 slug 被同工作区的归档/软删行占用（无可复用→报错）。
      const raced = await findActive();
      if (!raced) {
        throw new ProjectSlugOccupiedError(input.slug);
      }
      return { project: raced, created: false };
    }
  };
}
