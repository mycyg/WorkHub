import { randomUUID } from "node:crypto";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { users, workspaceMemberships, workspaces } from "../schema/index.js";

// R2 多租户 epic Phase 1：工作区成员仓库。纯数据访问层，Phase 1 不接线（actor 仍走常量）；
// Phase 2 的 TenantResolver 用 resolveDefaultWorkspace / listForUser 从成员关系派生 actor 租户。

export type WorkspaceMembershipRow = typeof workspaceMemberships.$inferSelect;
export type MembershipRole = "member" | "admin" | "owner";

// R18 批 H1（web 成员管理面板 · 成员清单）：一行含昵称与加入时间的成员——供 GET /api/workspace/members
// 渲染 roster（昵称在 users 表、角色/加入时间在 memberships 表，一趟 join 取全）。
export type WorkspaceMemberWithNickname = {
  userId: string;
  nickname: string;
  role: MembershipRole;
  joinedAt: Date;
};

// actor 租户 = 默认成员行的工作区 + 其 org（workspaces.org_id 派生，本 epic 无独立 org_memberships）。
export type ResolvedTenant = {
  workspaceId: string;
  orgId: string;
  role: MembershipRole;
};

export type CreateWorkspaceMembershipInput = {
  id?: string;
  workspaceId: string;
  userId: string;
  role?: MembershipRole;
  defaultWorkspace?: boolean;
};

export type WorkspaceMembershipRepository = {
  /** 某用户全部 active 成员行（多工作区用户的候选集）。 */
  listForUser: (userId: string) => Promise<WorkspaceMembershipRow[]>;
  /** 校验用户确属某工作区（override-header 解析时 fail-closed 用）。 */
  findActiveForUserWorkspace: (userId: string, workspaceId: string) => Promise<WorkspaceMembershipRow | null>;
  /** 解析用户的默认工作区成员行（actor 租户兜底锚点）。 */
  resolveDefaultWorkspace: (userId: string) => Promise<WorkspaceMembershipRow | null>;
  /** Phase 2：解析 actor 租户——默认成员行的工作区 + 其 org（join workspaces）。无默认成员→null（调用方回退常量）。 */
  resolveDefaultTenant: (userId: string) => Promise<ResolvedTenant | null>;
  create: (input: CreateWorkspaceMembershipInput) => Promise<WorkspaceMembershipRow>;
  /** 软删成员（退出工作区 / 停用）——释放 (ws,user) 与 default 的 partial unique，可重新加入。 */
  softDelete: (id: string, at: Date) => Promise<WorkspaceMembershipRow | null>;
  /** R17 批 G1（#15 成员移出）：某工作区全部 active 成员行——供移出/角色变更前统计特权成员数（防移出/
   *  降级最后一名 admin/owner），成员规模对内部团队远低于任何实际上限，无需分页。 */
  listActiveByWorkspace: (workspaceId: string) => Promise<WorkspaceMembershipRow[]>;
  /** R18 批 H1（成员清单）：某工作区全部 active 成员 + 昵称（join users），按昵称字典序——供 web 成员分区
   *  roster。成员规模对内部团队远低于任何上限，无需分页。 */
  listActiveWithNicknameByWorkspace: (workspaceId: string) => Promise<WorkspaceMemberWithNickname[]>;
  /** R17 批 G1（#15 角色变更）：更新一条 active 成员行的角色（幂等：改到同值也照常前进 updated_at）。 */
  updateRole: (id: string, role: MembershipRole, at: Date) => Promise<WorkspaceMembershipRow | null>;
};

export function createWorkspaceMembershipRepository(db: WorkHubDb): WorkspaceMembershipRepository {
  return {
    async listForUser(userId) {
      return db
        .select()
        .from(workspaceMemberships)
        .where(and(eq(workspaceMemberships.userId, userId), isNull(workspaceMemberships.deletedAt)));
    },

    async findActiveForUserWorkspace(userId, workspaceId) {
      const rows = await db
        .select()
        .from(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.userId, userId),
            eq(workspaceMemberships.workspaceId, workspaceId),
            isNull(workspaceMemberships.deletedAt)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async resolveDefaultWorkspace(userId) {
      const rows = await db
        .select()
        .from(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.userId, userId),
            eq(workspaceMemberships.defaultWorkspace, true),
            isNull(workspaceMemberships.deletedAt)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async resolveDefaultTenant(userId) {
      const rows = await db
        .select({ workspaceId: workspaceMemberships.workspaceId, orgId: workspaces.orgId, role: workspaceMemberships.role })
        .from(workspaceMemberships)
        .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
        .where(
          and(
            eq(workspaceMemberships.userId, userId),
            eq(workspaceMemberships.defaultWorkspace, true),
            isNull(workspaceMemberships.deletedAt)
          )
        )
        .limit(1);
      const row = rows[0];
      return row ? { ...row, role: row.role as MembershipRole } : null;
    },

    async create(input) {
      const rows = await db
        .insert(workspaceMemberships)
        .values({
          id: input.id ?? randomUUID(),
          workspaceId: input.workspaceId,
          userId: input.userId,
          role: input.role ?? "member",
          defaultWorkspace: input.defaultWorkspace ?? false
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error("Failed to create workspace membership");
      }
      return row;
    },

    async softDelete(id, at) {
      const rows = await db
        .update(workspaceMemberships)
        .set({ deletedAt: at, updatedAt: at })
        .where(and(eq(workspaceMemberships.id, id), isNull(workspaceMemberships.deletedAt)))
        .returning();
      return rows[0] ?? null;
    },

    async listActiveByWorkspace(workspaceId) {
      return db
        .select()
        .from(workspaceMemberships)
        .where(
          and(eq(workspaceMemberships.workspaceId, workspaceId), isNull(workspaceMemberships.deletedAt))
        );
    },

    async listActiveWithNicknameByWorkspace(workspaceId) {
      const rows = await db
        .select({
          userId: workspaceMemberships.userId,
          nickname: users.nickname,
          role: workspaceMemberships.role,
          joinedAt: workspaceMemberships.createdAt
        })
        .from(workspaceMemberships)
        .innerJoin(users, eq(users.id, workspaceMemberships.userId))
        .where(
          and(
            eq(workspaceMemberships.workspaceId, workspaceId),
            isNull(workspaceMemberships.deletedAt),
            isNull(users.deletedAt)
          )
        )
        .orderBy(asc(sql`lower(${users.nickname})`), asc(users.id));
      return rows.map((row) => ({
        userId: row.userId,
        nickname: row.nickname,
        role: row.role as MembershipRole,
        joinedAt: row.joinedAt
      }));
    },

    async updateRole(id, role, at) {
      const rows = await db
        .update(workspaceMemberships)
        .set({ role, updatedAt: at })
        .where(and(eq(workspaceMemberships.id, id), isNull(workspaceMemberships.deletedAt)))
        .returning();
      return rows[0] ?? null;
    }
  };
}
