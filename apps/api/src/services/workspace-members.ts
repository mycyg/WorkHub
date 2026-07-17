import {
  createAuditLogRepository,
  createWorkspaceMembershipRepository,
  getSharedDatabaseClient,
  type AuditLogRepository,
  type MembershipRole,
  type WorkspaceMembershipRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";

// ── R17 批 G1（群成员管理 · #15 工作区成员移出/角色变更） ─────────────────────────────────────
// workspaceMemberships.softDelete / updateRole 之前只有 QA 脚本调用、无路由暴露。这里把它们收进一个薄
// 服务层，落权限红线（取窄，见下）后暴露为 DELETE / PATCH /api/workspace/members/:userId。
//   * 权限：仅工作区 admin/owner（actor.isAdmin 或本人成员行 role∈{admin,owner}）；
//   * 不能移出/改自己（避免自锁或误删自己）；
//   * 不能移出/降级「最后一名特权成员」（admin∪owner 计数 ≤ 1 时拒，避免把工作区变成无人管理的孤儿）。
// 被移出者的会话参与/消息/游标不在本服务处理范围（会话层各自留痕）——这里只软删工作区成员行。

export class WorkspaceMemberServiceError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "WorkspaceMemberServiceError";
  }
}

const PRIVILEGED_ROLES: ReadonlySet<MembershipRole> = new Set<MembershipRole>(["admin", "owner"]);

export type WorkspaceMemberSummary = {
  user_id: string;
  nickname: string;
  role: MembershipRole;
  joined_at: string;
  is_self: boolean;
};

export type WorkspaceMemberService = {
  // R18 批 H1（成员清单）：某工作区 roster（昵称/角色/加入时间/是否本人）——管理员门控（同增删/改角色）。
  listMembers(input: { actor: AuthActor }): Promise<{ members: WorkspaceMemberSummary[] }>;
  removeMember(input: { actor: AuthActor; targetUserId: string }): Promise<{ removed_user_id: string }>;
  updateMemberRole(input: {
    actor: AuthActor;
    targetUserId: string;
    role: MembershipRole;
  }): Promise<{ user_id: string; role: MembershipRole }>;
};

export type WorkspaceMemberServiceDependencies = {
  memberships: Pick<
    WorkspaceMembershipRepository,
    | "findActiveForUserWorkspace"
    | "listActiveByWorkspace"
    | "listActiveWithNicknameByWorkspace"
    | "softDelete"
    | "updateRole"
  >;
  auditLogs?: Pick<AuditLogRepository, "createAuditLog"> | undefined;
  now?: () => Date;
};

type ResolvedActor = { actorUserId: string; workspaceId: string; isAdmin: boolean };

function requireHumanActor(actor: AuthActor): ResolvedActor {
  const workspaceId = actor.workspaceId.trim();
  const actorUserId = actor.userId?.trim();
  if (actor.kind !== "human" || !actorUserId || !workspaceId) {
    throw new WorkspaceMemberServiceError(403, "human_required", "需要已加入工作区的真人用户才能管理成员。");
  }
  return { actorUserId, workspaceId, isAdmin: actor.isAdmin };
}

export function createWorkspaceMemberService(deps: WorkspaceMemberServiceDependencies): WorkspaceMemberService {
  const now = deps.now ?? (() => new Date());
  const memberships = deps.memberships;

  // 权限闸：解析发起人在这个工作区的活跃成员行，判定其为 admin/owner（或 user 级 isAdmin）。非成员 → 403。
  // 读（列成员）与写（移出/改角色）共用这一道门——成员分区连同 roster 都只对管理员开放。
  async function assertManager(actor: AuthActor): Promise<ResolvedActor> {
    const resolved = requireHumanActor(actor);
    const actingMembership = await memberships.findActiveForUserWorkspace(resolved.actorUserId, resolved.workspaceId);
    if (!actingMembership) {
      throw new WorkspaceMemberServiceError(403, "member_manage_forbidden", "只有工作区管理员可以管理成员。");
    }
    const isManager = resolved.isAdmin || PRIVILEGED_ROLES.has(actingMembership.role as MembershipRole);
    if (!isManager) {
      throw new WorkspaceMemberServiceError(403, "member_manage_forbidden", "只有工作区管理员可以管理成员。");
    }
    return resolved;
  }

  async function assertManagerAndResolveTarget(input: {
    actor: AuthActor;
    targetUserId: string;
  }): Promise<{ resolved: ResolvedActor; targetUserId: string; targetRole: MembershipRole; targetMembershipId: string }> {
    const resolved = await assertManager(input.actor);
    const targetUserId = input.targetUserId.trim().toLowerCase();
    if (!targetUserId) {
      throw new WorkspaceMemberServiceError(400, "member_target_required", "请选择要管理的成员。");
    }
    // 不能对自己动手（移出=自锁、降级=自我夺权）——取窄，两条路径共用同一条守卫。
    if (targetUserId === resolved.actorUserId.toLowerCase()) {
      throw new WorkspaceMemberServiceError(409, "member_manage_self", "不能对自己执行这个操作。");
    }
    const targetMembership = await memberships.findActiveForUserWorkspace(targetUserId, resolved.workspaceId);
    if (!targetMembership) {
      throw new WorkspaceMemberServiceError(404, "member_not_found", "没有找到这个工作区里的这个成员。");
    }
    return {
      resolved,
      targetUserId,
      targetRole: targetMembership.role as MembershipRole,
      targetMembershipId: targetMembership.id
    };
  }

  // 特权成员计数（admin∪owner），供「不能移出/降级最后一名特权成员」判定。
  async function countPrivileged(workspaceId: string): Promise<number> {
    const rows = await memberships.listActiveByWorkspace(workspaceId);
    return rows.filter((row) => PRIVILEGED_ROLES.has(row.role as MembershipRole)).length;
  }

  return {
    async listMembers(input) {
      const resolved = await assertManager(input.actor);
      const rows = await memberships.listActiveWithNicknameByWorkspace(resolved.workspaceId);
      const selfId = resolved.actorUserId.toLowerCase();
      return {
        members: rows.map((row) => ({
          user_id: row.userId,
          nickname: row.nickname,
          role: row.role,
          joined_at: row.joinedAt.toISOString(),
          is_self: row.userId.toLowerCase() === selfId
        }))
      };
    },

    async removeMember(input) {
      const { resolved, targetUserId, targetRole, targetMembershipId } = await assertManagerAndResolveTarget(input);
      // 移出的目标若是特权成员，且它是最后一名特权成员 → 拒（否则工作区没人能再管理）。
      if (PRIVILEGED_ROLES.has(targetRole)) {
        const privileged = await countPrivileged(resolved.workspaceId);
        if (privileged <= 1) {
          throw new WorkspaceMemberServiceError(
            409,
            "member_last_admin",
            "不能移出最后一名管理员。"
          );
        }
      }
      const removed = await memberships.softDelete(targetMembershipId, now());
      if (!removed) {
        // 并发：被别处先软删了——幂等当作已移出，不 500。
        throw new WorkspaceMemberServiceError(404, "member_not_found", "没有找到这个工作区里的这个成员。");
      }
      await deps.auditLogs
        ?.createAuditLog({
          actorKind: "human",
          actorUserId: resolved.actorUserId,
          workspaceId: resolved.workspaceId,
          entityType: "workspace_membership",
          entityId: targetMembershipId,
          action: "workspace.member_removed",
          detailJson: { workspace_id: resolved.workspaceId, target_user_id: targetUserId, role: targetRole }
        })
        .catch(() => {});
      return { removed_user_id: targetUserId };
    },

    async updateMemberRole(input) {
      const { resolved, targetUserId, targetRole, targetMembershipId } = await assertManagerAndResolveTarget(input);
      // 把最后一名特权成员降级为普通 member → 拒（同 removeMember 的孤儿工作区防线）。
      if (PRIVILEGED_ROLES.has(targetRole) && !PRIVILEGED_ROLES.has(input.role)) {
        const privileged = await countPrivileged(resolved.workspaceId);
        if (privileged <= 1) {
          throw new WorkspaceMemberServiceError(
            409,
            "member_last_admin",
            "不能降级最后一名管理员。"
          );
        }
      }
      const updated = await memberships.updateRole(targetMembershipId, input.role, now());
      if (!updated) {
        throw new WorkspaceMemberServiceError(404, "member_not_found", "没有找到这个工作区里的这个成员。");
      }
      await deps.auditLogs
        ?.createAuditLog({
          actorKind: "human",
          actorUserId: resolved.actorUserId,
          workspaceId: resolved.workspaceId,
          entityType: "workspace_membership",
          entityId: targetMembershipId,
          action: "workspace.member_role_changed",
          detailJson: {
            workspace_id: resolved.workspaceId,
            target_user_id: targetUserId,
            from_role: targetRole,
            to_role: input.role
          }
        })
        .catch(() => {});
      return { user_id: targetUserId, role: updated.role as MembershipRole };
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultWorkspaceMemberService: WorkspaceMemberService | undefined;

export function getDefaultWorkspaceMemberService(): WorkspaceMemberService {
  if (!defaultWorkspaceMemberService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultWorkspaceMemberService = createWorkspaceMemberService({
      memberships: createWorkspaceMembershipRepository(defaultDbClient.db),
      auditLogs: createAuditLogRepository(defaultDbClient.db)
    });
  }
  return defaultWorkspaceMemberService;
}
