import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { workspaceMemberships } from "../schema/index.js";

// R2 多租户 epic Phase 1：工作区成员仓库。纯数据访问层，Phase 1 不接线（actor 仍走常量）；
// Phase 2 的 TenantResolver 用 resolveDefaultWorkspace / listForUser 从成员关系派生 actor 租户。

export type WorkspaceMembershipRow = typeof workspaceMemberships.$inferSelect;
export type MembershipRole = "member" | "admin" | "owner";

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
  create: (input: CreateWorkspaceMembershipInput) => Promise<WorkspaceMembershipRow>;
  /** 软删成员（退出工作区 / 停用）——释放 (ws,user) 与 default 的 partial unique，可重新加入。 */
  softDelete: (id: string, at: Date) => Promise<WorkspaceMembershipRow | null>;
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
    }
  };
}
