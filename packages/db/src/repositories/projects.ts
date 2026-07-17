import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { DEFAULT_PROJECT_AI_GOVERNANCE } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import {
  orgs,
  projectAiGovernance,
  projectConversations,
  projects,
  workItems,
  workspaces
} from "../schema/index.js";

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
  isPersonal: boolean;
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

// R13 批 S3（个人空间）：不复用 bootstrapPilotProject 的 org/workspace upsert（个人空间总是建在
// 一个已经存在、发起人已经是成员的工作区里，不需要也不该再造一个 org/workspace）。
export type BootstrapPersonalProjectInput = {
  workspaceId: string;
  projectId?: string;
  name: string;
  slug: string;
  ownerNickname: string;
  ownerUserId: string;
  at?: Date;
};

export type ListPersonalProjectsInput = {
  workspaceId: string;
  ownerUserId: string;
};

// R16 批 W4a（项目级自定义指令）：单列条件更新——只改 instructions_md（+updatedAt）,按 id 定位并且
// 只对活跃项目（未归档、未软删）生效,呼应 apps/api/src/services/project-instructions.ts 的
// requireManageableProject 活跃性判定（canManageProjectDrive 内部同一条 projectIsActive）。
// instructionsMd 传 null 即清空（留空不注入,由调用方把 trim 后的空串折成 null）。
export type UpdateProjectInstructionsInput = {
  projectId: string;
  instructionsMd: string | null;
  now?: Date;
};

// R20 P2A（R19-19 项目归档/删除）：软置 archived=true——仅命中「当前活跃」（未归档、未软删）的项目行，
// 已归档/已删返回 null（幂等且不复活墓碑）。列表读路径的 WHERE 已过滤 archived=true，故无需改读。
export type ArchiveProjectInput = {
  projectId: string;
  now?: Date;
};

// R20 P2A：软删——软置 deletedAt（墓碑），可选记录删除者昵称。仅命中未软删的行，已删返回 null。
export type SoftDeleteProjectInput = {
  projectId: string;
  deletedByNickname?: string | null;
  now?: Date;
};

export class ProjectSlugOccupiedError extends Error {
  constructor(public readonly slug: string) {
    super("Project slug is occupied by an archived or deleted project in this workspace");
  }
}

export type ProjectRepository = {
  bootstrapPilotProject: (input: BootstrapProjectInput) => Promise<BootstrapProjectResultRow>;
  listForWorkspace: (workspaceId: string) => Promise<ProjectListRow[]>;
  // R13 批 S3：个人空间——建（总是新建一条，没有 bootstrapPilotProject 那套 find-or-reuse 幂等语义，
  // 用户点一次「+新建个人空间」就该多一个空间）与列（仅 owner 本人名下、is_personal=true 的项目）。
  bootstrapPersonalProject: (input: BootstrapPersonalProjectInput) => Promise<BootstrapProjectResultRow>;
  listPersonalForUser: (input: ListPersonalProjectsInput) => Promise<ProjectListRow[]>;
  // R16 批 W4a：写路径——返回更新后的完整行（含 instructionsMd），未命中活跃项目返回 null。
  updateInstructions: (input: UpdateProjectInstructionsInput) => Promise<ProjectRow | null>;
  // R20 P2A（R19-19）：软归档/软删——CAS 只命中活跃/未删行，未命中返回 null（不复活墓碑）。
  archiveProject: (input: ArchiveProjectInput) => Promise<ProjectRow | null>;
  softDeleteProject: (input: SoftDeleteProjectInput) => Promise<ProjectRow | null>;
};

async function ensureActiveMain(
  tx: WorkHubDb,
  project: ProjectRow,
  input: Pick<BootstrapProjectInput, "workspaceId" | "ownerUserId">,
  at: Date
) {
  const inserted = await tx
    .insert(projectConversations)
    .values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      projectId: project.id,
      kind: "main",
      title: "主区",
      visibility: "project",
      nextSeq: 0,
      createdBy: project.ownerUserId ?? input.ownerUserId,
      createdAt: at,
      updatedAt: at
    })
    .onConflictDoNothing({
      target: projectConversations.projectId,
      where: and(
        eq(projectConversations.kind, "main"),
        isNull(projectConversations.deletedAt)
      )!
    })
    .returning({ id: projectConversations.id });
  if (inserted[0]) {
    return;
  }

  const existing = await tx
    .select({ id: projectConversations.id })
    .from(projectConversations)
    .where(
      and(
        eq(projectConversations.workspaceId, input.workspaceId),
        eq(projectConversations.projectId, project.id),
        eq(projectConversations.kind, "main"),
        isNull(projectConversations.deletedAt)
      )
    )
    .limit(1);
  if (!existing[0]) {
    throw new Error("Project active main conversation conflict could not be resolved");
  }
}

// R13 批 S3：个人空间默认关闭 60s 主区观察者——不插这行，读侧 `coalesce(observer_enabled, true)`
// 的既有 fallback（见 packages/db/src/repositories/action-cards.ts）会把它当成开着。其余列照
// DEFAULT_PROJECT_AI_GOVERNANCE 的既定默认值，治理页仍可手动开（走既有 upsertProjectGovernance）。
async function ensurePersonalGovernanceOff(tx: WorkHubDb, projectId: string, at: Date) {
  await tx
    .insert(projectAiGovernance)
    .values({
      projectId,
      observerEnabled: false,
      silenceWindowSecs: DEFAULT_PROJECT_AI_GOVERNANCE.silence_window_seconds,
      quietHoursJson: { ...DEFAULT_PROJECT_AI_GOVERNANCE.quiet_hours },
      granularJson: { ...DEFAULT_PROJECT_AI_GOVERNANCE.granular_settings },
      createdAt: at,
      updatedAt: at
    })
    .onConflictDoNothing({ target: projectAiGovernance.projectId });
}

function projectListRowsQuery(db: WorkHubDb, conditions: ReturnType<typeof and>) {
  // 左连接 work_items,用条件求和数「进行中」工作项(非 merged/done/cancelled 且未删除)。
  // 用 sum(case) 而非 PG 专有 FILTER 语法,兼容性更稳;leftJoin 的 NULL 行计 0。
  return db
    .select({
      id: projects.id,
      workspaceId: projects.workspaceId,
      name: projects.name,
      slug: projects.slug,
      description: projects.description,
      ownerNickname: projects.ownerNickname,
      ownerUserId: projects.ownerUserId,
      archived: projects.archived,
      isPersonal: projects.isPersonal,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      // R12（多项目）：projects.updatedAt 建库后从不被写路径更新≈创建时间——「按更新时间排序」
      // 与「更新于」展示都在撒谎。真活跃时间 = max(项目行, 项目内工作项最新 updatedAt)。
      lastActivityAt: sql<Date>`greatest(${projects.updatedAt}, coalesce(max(case when ${workItems.deletedAt} is null then ${workItems.updatedAt} end), ${projects.updatedAt}))`,
      openWorkItemCount: sql<number>`coalesce(sum(case when ${workItems.id} is not null and ${workItems.status} not in ('merged','done','cancelled') and ${workItems.deletedAt} is null then 1 else 0 end), 0)`
    })
    .from(projects)
    .leftJoin(workItems, eq(workItems.projectId, projects.id))
    .where(conditions)
    .groupBy(projects.id);
}

type ProjectListQueryRow = Awaited<ReturnType<typeof projectListRowsQuery>>[number];

function toProjectListRow(row: ProjectListQueryRow): ProjectListRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    ownerNickname: row.ownerNickname,
    ownerUserId: row.ownerUserId,
    archived: row.archived,
    isPersonal: row.isPersonal,
    createdAt: row.createdAt,
    // 展示与排序同源：updatedAt 用真活跃时间（VM 的 updated_at 即由它而来）。
    updatedAt: row.lastActivityAt instanceof Date ? row.lastActivityAt : new Date(String(row.lastActivityAt)),
    openWorkItemCount: Number(row.openWorkItemCount)
  };
}

export function createProjectRepository(db: WorkHubDb): ProjectRepository {
  return {
    async listForWorkspace(workspaceId) {
      const rows = await projectListRowsQuery(
        db,
        and(
          eq(projects.workspaceId, workspaceId),
          eq(projects.archived, false),
          isNull(projects.deletedAt),
          // R13 批 S3：团队项目列表绝不能混进个人空间——个人空间只出现在「我的空间」分组
          // （listPersonalForUser），两处是互斥的两份数据源。
          eq(projects.isPersonal, false),
          // R15 批 B：DM 容器项目绝不进任何项目列表/树——它只挂 DM 会话，对用户完全不可见。
          eq(projects.isDmContainer, false)
        )
      ).orderBy(sql`greatest(${projects.updatedAt}, coalesce(max(case when ${workItems.deletedAt} is null then ${workItems.updatedAt} end), ${projects.updatedAt})) desc`);
      return rows.map(toProjectListRow);
    },

    async listPersonalForUser(input) {
      const rows = await projectListRowsQuery(
        db,
        and(
          eq(projects.workspaceId, input.workspaceId),
          eq(projects.ownerUserId, input.ownerUserId),
          eq(projects.isPersonal, true),
          eq(projects.archived, false),
          isNull(projects.deletedAt)
        )
      ).orderBy(asc(projects.createdAt));
      return rows.map(toProjectListRow);
    },

    async bootstrapPersonalProject(input) {
      const at = input.at ?? new Date();
      return db.transaction(async (tx) => {
        // 个人空间总是新建一条（没有 bootstrapPilotProject 那套 find-or-reuse 幂等语义）——
        // slug 撞车（理论上只会发生在极端并发下）按既有约定报「标识被占用」，不静默复用别的项目。
        const rows = await tx
          .insert(projects)
          .values({
            id: input.projectId ?? randomUUID(),
            workspaceId: input.workspaceId,
            name: input.name,
            slug: input.slug,
            ownerNickname: input.ownerNickname,
            ownerUserId: input.ownerUserId,
            isPersonal: true,
            archived: false,
            nextSeq: 0,
            createdAt: at,
            updatedAt: at
          })
          .onConflictDoNothing({ target: [projects.workspaceId, projects.slug] })
          .returning();
        const project = rows[0];
        if (!project) {
          throw new ProjectSlugOccupiedError(input.slug);
        }
        await ensureActiveMain(tx, project, input, at);
        // 用户拍板：个人空间的 60s 主区观察者默认关（治理页里可手动开）。
        await ensurePersonalGovernanceOff(tx, project.id, at);
        return { project, created: true };
      });
    },

    async bootstrapPilotProject(input) {
      const at = input.at ?? new Date();
      return db.transaction(async (tx) => {
        await tx
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

        await tx
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
          const rows = await tx
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
          await ensureActiveMain(tx, existing, input, at);
          return { project: existing, created: false };
        }

        // 原子创建：ON CONFLICT (workspace_id, slug) DO NOTHING（与迁移 0028 的工作区级唯一索引对齐）。
        // 并发同 (workspace, slug) 时第二发不再撞唯一抛 500，而是落空→回查已存在的那条按复用返回。
        const rows = await tx
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
          await ensureActiveMain(tx, project, input, at);
          return { project, created: true };
        }
        // onConflict 落空：要么并发抢先建了同一条（回查复用），要么 slug 被同工作区的归档/软删行占用（无可复用→报错）。
        const raced = await findActive();
        if (!raced) {
          throw new ProjectSlugOccupiedError(input.slug);
        }
        await ensureActiveMain(tx, raced, input, at);
        return { project: raced, created: false };
      });
    },

    async updateInstructions(input) {
      const at = input.now ?? new Date();
      const [row] = await db
        .update(projects)
        .set({ instructionsMd: input.instructionsMd, updatedAt: at })
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.archived, false),
            isNull(projects.deletedAt)
          )
        )
        .returning();
      return row ?? null;
    },

    async archiveProject(input) {
      const at = input.now ?? new Date();
      const [row] = await db
        .update(projects)
        .set({ archived: true, updatedAt: at })
        // CAS：只归档「当前活跃」的项目——已归档/已软删不再命中（幂等，返回 null）。
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.archived, false),
            isNull(projects.deletedAt)
          )
        )
        .returning();
      return row ?? null;
    },

    async softDeleteProject(input) {
      const at = input.now ?? new Date();
      const [row] = await db
        .update(projects)
        .set({
          deletedAt: at,
          ...(input.deletedByNickname !== undefined ? { deletedByNickname: input.deletedByNickname } : {}),
          updatedAt: at
        })
        // CAS：只软删未删的行——已软删不再命中（幂等，返回 null）。可对已归档项目再软删。
        .where(
          and(
            eq(projects.id, input.projectId),
            isNull(projects.deletedAt)
          )
        )
        .returning();
      return row ?? null;
    }
  };
}
