import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

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

// R20 P2A（P1-08 修复 · workspace-scoped roster）：分页花名册的一行。较 WorkspaceMemberWithNickname 多带
// 头像时间戳占位（avatarUpdatedAt 非空=有头像，兼作头像端点缓存键；只取时间戳、不带 bytea 二进制）+
// isAdmin（R20 P1-08 收尾：users.is_admin 全局管理员标签，不是本工作区角色——供消费端摆脱全局 /api/users
// 后仍能标「管理员」，additive，不动既有字段/隔离/分页语义）。
export type WorkspaceRosterMember = {
  userId: string;
  nickname: string;
  role: MembershipRole;
  joinedAt: Date;
  avatarUpdatedAt: Date | null;
  isAdmin: boolean;
};

// R20 P2A：一页花名册 + 工作区 active 成员总数（total 供客户端翻页与「成员数」显示，修 /api/users 全局
// 计数封顶 200 的「计数错」）。
export type WorkspaceRosterPage = {
  members: WorkspaceRosterMember[];
  total: number;
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
  /** SEC-1（P0-01）：查某用户在某工作区的软删墓碑（deletedAt 非空），无则 null。identify/bootstrap 据此
   *  区分「被移出的墓碑（拒绝复活，fail-closed 403）」与「从未有过行的新用户（建行）」。多条墓碑取最近一条。 */
  findSoftDeletedForUserWorkspace: (userId: string, workspaceId: string) => Promise<WorkspaceMembershipRow | null>;
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
  /** R20 P2A（P1-08 修复 · workspace-scoped roster）：按 workspaceId join membership+users 分页列本工作区
   *  active 成员（limit/offset），并回工作区 active 成员总数。取代消费端误用的全局 /api/users：
   *    - 工作区隔离：WHERE 绑定 workspaceId + 排除 membership/user 双软删，杜绝跨租户泄露；
   *    - 无硬上限：不再像 users.listActiveRefs 那样硬 .limit(200) 截断，任意 offset 可翻至全量成员；
   *    - 稳定序：按 lower(nickname), user id 排序，翻页无重复/漏项。
   *  只取头像时间戳（非 bytea），避免把二进制带进列表查询。
   *  OPTIONAL：与 UserRepository 的 listActiveRefs 等同范式——标可选以免逼各处内存假仓库都实现（生产
   *  createWorkspaceMembershipRepository 恒实现；roster 端点的默认读者会做存在性兜底）。 */
  listActiveRosterPageByWorkspace?: (
    workspaceId: string,
    page: { limit: number; offset: number }
  ) => Promise<WorkspaceRosterPage>;
  /** R17 批 G1（#15 角色变更）：更新一条 active 成员行的角色（幂等：改到同值也照常前进 updated_at）。 */
  updateRole: (id: string, role: MembershipRole, at: Date) => Promise<WorkspaceMembershipRow | null>;
};

// SEC-1（P1-09 · 最后管理员 TOCTOU）：在 workspace 级 pg advisory 锁下串行化成员移出/改角色的
// 「重查不变量→写」临界区。必须在一个事务内调用（pg_advisory_xact_lock 随事务提交/回滚自动释放，
// 不会像会话级 advisory_lock 那样因 worker 崩溃而漏放）。锁键取 workspace 维度并加命名空间前缀，
// 与预算预留等其它 advisory 锁隔离（mirror budget-reservations 的 hashtext(::bigint) 手法）。
export async function acquireWorkspaceMemberLock(tx: WorkHubDb, workspaceId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`workspace-members:${workspaceId}`})::bigint)`);
}

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

    async findSoftDeletedForUserWorkspace(userId, workspaceId) {
      const rows = await db
        .select()
        .from(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.userId, userId),
            eq(workspaceMemberships.workspaceId, workspaceId),
            isNotNull(workspaceMemberships.deletedAt)
          )
        )
        .orderBy(desc(workspaceMemberships.deletedAt))
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

    async listActiveRosterPageByWorkspace(workspaceId, page) {
      // 防御性夹取：真实上下限由调用方（契约 limit 1..100）保证，这里只兜非法值。刻意不设 200 上限——
      // offset 可翻至任意深度，全量成员皆可达，这正是对 users.listActiveRefs 硬 .limit(200) 截断的修复。
      const limit = Math.max(1, Math.floor(page.limit));
      const offset = Math.max(0, Math.floor(page.offset));
      // 工作区隔离 + 双软删排除：一条 WHERE 复用于计数与取页，确保两者同一口径（total 与 members 不打架）。
      const scope = and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        isNull(workspaceMemberships.deletedAt),
        isNull(users.deletedAt)
      );
      const countRows = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(workspaceMemberships)
        .innerJoin(users, eq(users.id, workspaceMemberships.userId))
        .where(scope);
      const rows = await db
        .select({
          userId: workspaceMemberships.userId,
          nickname: users.nickname,
          role: workspaceMemberships.role,
          joinedAt: workspaceMemberships.createdAt,
          avatarUpdatedAt: users.avatarUpdatedAt,
          isAdmin: users.isAdmin
        })
        .from(workspaceMemberships)
        .innerJoin(users, eq(users.id, workspaceMemberships.userId))
        .where(scope)
        .orderBy(asc(sql`lower(${users.nickname})`), asc(users.id))
        .limit(limit)
        .offset(offset);
      return {
        total: countRows[0]?.total ?? 0,
        members: rows.map((row) => ({
          userId: row.userId,
          nickname: row.nickname,
          role: row.role as MembershipRole,
          joinedAt: row.joinedAt,
          avatarUpdatedAt: row.avatarUpdatedAt,
          isAdmin: row.isAdmin
        }))
      };
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
