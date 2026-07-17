import {
  acquireWorkspaceMemberLock,
  createAuditLogRepository,
  createClientDeviceRepository,
  createSessionRepository,
  createWorkspaceMembershipRepository,
  getSharedDatabaseClient,
  type AuditLogRepository,
  type ClientDeviceRepository,
  type MembershipRole,
  type SessionRepository,
  type WorkspaceMembershipRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";

import { getDefaultPresenceStore, type PresenceStore } from "../broker/index.js";
import type { AuthActor } from "../middleware/auth.js";

// ── R17 批 G1（群成员管理 · #15 工作区成员移出/角色变更） ─────────────────────────────────────
// workspaceMemberships.softDelete / updateRole 之前只有 QA 脚本调用、无路由暴露。这里把它们收进一个薄
// 服务层，落权限红线（取窄，见下）后暴露为 DELETE / PATCH /api/workspace/members/:userId。
//   * 权限：仅工作区 admin/owner（actor.isAdmin 或本人成员行 role∈{admin,owner}）；
//   * 不能移出/改自己（避免自锁或误删自己）；
//   * 不能移出/降级「最后一名特权成员」（admin∪owner 计数 ≤ 1 时拒，避免把工作区变成无人管理的孤儿）。
// ── SEC-1 加固（R20） ────────────────────────────────────────────────────────────────────
//   * P1-09（最后管理员 TOCTOU）：移出/改角色把「重查最后管理员不变量 → 写」收进 workspace 级
//     advisory 锁 + 单事务的同一临界区（见 withWorkspaceLock），杜绝两管理员并发互移致零管理员。
//   * P0-01（移出即撤访问）：移出在同事务内撤销该用户全部 session + 客户端设备 token（复用停用路径 helper），
//     并在提交后 best-effort 清 presence——配合 resolveHumanActor 的 fail-closed 双保险切断被移出者访问。

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

// 移出/改角色临界区所需的 tx-bound 仓库子集：加锁时由 withWorkspaceLock 提供事务版仓库；无锁 seam
// （单测 / 老运行时）时回退到服务默认（非事务）仓库，语义等价但不串行化并发。
export type WorkspaceMemberMutationRepos = {
  memberships: Pick<
    WorkspaceMembershipRepository,
    "findActiveForUserWorkspace" | "listActiveByWorkspace" | "softDelete" | "updateRole"
  >;
  sessions?: Pick<SessionRepository, "revokeAllForUser"> | undefined;
  devices?: Pick<ClientDeviceRepository, "listByUser" | "revokeByIdForUser"> | undefined;
};

// P1-09：在 workspace 级 advisory 锁 + 单事务内跑 run（重查不变量 → 软删/改角色 → 撤 token）。
export type WorkspaceMemberMutationTx = <T>(
  workspaceId: string,
  run: (repos: WorkspaceMemberMutationRepos) => Promise<T>
) => Promise<T>;

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
  // SEC-1（P0-01）：移出即撤访问所需的会话/设备/在线态 seam。OPTIONAL——生产由 getDefaultWorkspaceMemberService
  // 注入；单测不传则跳过撤销（与旧行为一致，只是不再撤 token——但生产恒注入）。
  sessions?: Pick<SessionRepository, "revokeAllForUser"> | undefined;
  devices?: Pick<ClientDeviceRepository, "listByUser" | "revokeByIdForUser"> | undefined;
  presence?: Pick<PresenceStore, "forgetUser"> | undefined;
  // P1-09：事务化撤销 seam。OPTIONAL——未注入时移出/改角色回退到无锁顺序写（单测/老运行时），
  // 生产必注入以获得 advisory 锁 + 单事务的并发保护。
  withWorkspaceLock?: WorkspaceMemberMutationTx | undefined;
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

  // 校验目标 userId（非空、非本人）——纯参数校验，不读库；目标的存在性/角色改到锁内重查，避免 TOCTOU。
  function normalizeTargetUserId(resolved: ResolvedActor, rawTargetUserId: string): string {
    const targetUserId = rawTargetUserId.trim().toLowerCase();
    if (!targetUserId) {
      throw new WorkspaceMemberServiceError(400, "member_target_required", "请选择要管理的成员。");
    }
    // 不能对自己动手（移出=自锁、降级=自我夺权）——取窄，两条路径共用同一条守卫。
    if (targetUserId === resolved.actorUserId.toLowerCase()) {
      throw new WorkspaceMemberServiceError(409, "member_manage_self", "不能对自己执行这个操作。");
    }
    return targetUserId;
  }

  // P1-09：把「重查不变量 → 写」跑进 workspace 级 advisory 锁 + 单事务的同一临界区。注入了 withWorkspaceLock
  // （生产）时用其提供的 tx-bound 仓库；未注入（单测/老运行时）时回退到服务默认（非事务）仓库直接跑——
  // 逻辑一致，只是缺并发串行化（真库才有并发窗口，那里恒注入锁）。
  function runMutation<T>(
    workspaceId: string,
    run: (repos: WorkspaceMemberMutationRepos) => Promise<T>
  ): Promise<T> {
    if (deps.withWorkspaceLock) {
      return deps.withWorkspaceLock(workspaceId, run);
    }
    return run({ memberships, sessions: deps.sessions, devices: deps.devices });
  }

  // 特权成员计数（admin∪owner），供「不能移出/降级最后一名特权成员」判定。锁内用 tx 仓库读，确保与随后的
  // 软删/改角色处于同一快照（这正是 TOCTOU 修复的关键：计数与写不可被并发事务插队）。
  async function countPrivileged(repos: WorkspaceMemberMutationRepos, workspaceId: string): Promise<number> {
    const rows = await repos.memberships.listActiveByWorkspace(workspaceId);
    return rows.filter((row) => PRIVILEGED_ROLES.has(row.role as MembershipRole)).length;
  }

  // P2-03：审计写不再静默吞（旧 .catch(() => {})）——结构化告警保留 actor/workspace/entity/action 供排障。
  // best-effort：审计写失败绝不破坏成员管理主流程（对齐 routes/auth.ts 的 auditSecurityEvent 语义）。
  async function writeAuditBestEffort(
    entry: Parameters<NonNullable<WorkspaceMemberServiceDependencies["auditLogs"]>["createAuditLog"]>[0]
  ): Promise<void> {
    if (!deps.auditLogs) {
      return;
    }
    try {
      await deps.auditLogs.createAuditLog(entry);
    } catch (error) {
      console.warn(
        `workspace member audit write failed (best-effort): action=${entry.action} actor=${entry.actorUserId ?? "?"} workspace=${entry.workspaceId ?? "?"} entity=${entry.entityType}:${entry.entityId}`,
        error
      );
    }
  }

  // 移出后清 presence——presence 是 Redis 态（非 PG 事务的一部分），提交后 best-effort 清（TTL 自愈，
  // 清失败不影响移出结果，仅告警）。
  async function clearPresenceBestEffort(userId: string): Promise<void> {
    if (!deps.presence) {
      return;
    }
    try {
      await deps.presence.forgetUser(userId);
    } catch (error) {
      console.warn(`workspace member presence clear failed (best-effort): user=${userId}`, error);
    }
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
      const resolved = await assertManager(input.actor);
      const targetUserId = normalizeTargetUserId(resolved, input.targetUserId);
      const at = now();
      // 锁 + 单事务内：重查目标 → 重查最后管理员不变量 → 软删 → 撤 session/device token（P1-09 + P0-01）。
      const outcome = await runMutation(resolved.workspaceId, async (repos) => {
        const target = await repos.memberships.findActiveForUserWorkspace(targetUserId, resolved.workspaceId);
        if (!target) {
          throw new WorkspaceMemberServiceError(404, "member_not_found", "没有找到这个工作区里的这个成员。");
        }
        const targetRole = target.role as MembershipRole;
        // 移出的目标若是特权成员，且它是最后一名特权成员 → 拒（否则工作区没人能再管理）。锁内重查计数，
        // 两管理员并发互移时第二笔会看到已被前一笔软删后的新计数（=1）而正确拒绝。
        if (PRIVILEGED_ROLES.has(targetRole)) {
          const privileged = await countPrivileged(repos, resolved.workspaceId);
          if (privileged <= 1) {
            throw new WorkspaceMemberServiceError(409, "member_last_admin", "不能移出最后一名管理员。");
          }
        }
        const removed = await repos.memberships.softDelete(target.id, at);
        if (!removed) {
          // 并发：被别处先软删了——幂等当作已移出，不 500。
          throw new WorkspaceMemberServiceError(404, "member_not_found", "没有找到这个工作区里的这个成员。");
        }
        // P0-01：移出即撤访问——撤销该用户全部 session + 未撤销的客户端设备 token（复用停用路径 helper）。
        // 当前产品单工作区，全撤 == workspace-scope；多工作区时须按 workspace 收窄（只撤该工作区绑定的会话/设备）。
        await repos.sessions?.revokeAllForUser(targetUserId, at);
        if (repos.devices) {
          const devices = await repos.devices.listByUser(targetUserId);
          for (const device of devices) {
            if (device.revokedAt === null) {
              await repos.devices.revokeByIdForUser(device.id, targetUserId, at);
            }
          }
        }
        return { role: targetRole, membershipId: target.id };
      });
      // presence 非事务态，提交后 best-effort 清。
      await clearPresenceBestEffort(targetUserId);
      await writeAuditBestEffort({
        actorKind: "human",
        actorUserId: resolved.actorUserId,
        workspaceId: resolved.workspaceId,
        entityType: "workspace_membership",
        entityId: outcome.membershipId,
        action: "workspace.member_removed",
        detailJson: { workspace_id: resolved.workspaceId, target_user_id: targetUserId, role: outcome.role }
      });
      return { removed_user_id: targetUserId };
    },

    async updateMemberRole(input) {
      const resolved = await assertManager(input.actor);
      const targetUserId = normalizeTargetUserId(resolved, input.targetUserId);
      const at = now();
      // 改角色同锁同不变量（P1-09）：重查目标 → 最后管理员不变量 → 改角色，同一临界区。改角色不撤 token
      // （不是移出，访问不变）。
      const outcome = await runMutation(resolved.workspaceId, async (repos) => {
        const target = await repos.memberships.findActiveForUserWorkspace(targetUserId, resolved.workspaceId);
        if (!target) {
          throw new WorkspaceMemberServiceError(404, "member_not_found", "没有找到这个工作区里的这个成员。");
        }
        const targetRole = target.role as MembershipRole;
        // 把最后一名特权成员降级为普通 member → 拒（同 removeMember 的孤儿工作区防线）。
        if (PRIVILEGED_ROLES.has(targetRole) && !PRIVILEGED_ROLES.has(input.role)) {
          const privileged = await countPrivileged(repos, resolved.workspaceId);
          if (privileged <= 1) {
            throw new WorkspaceMemberServiceError(409, "member_last_admin", "不能降级最后一名管理员。");
          }
        }
        const updated = await repos.memberships.updateRole(target.id, input.role, at);
        if (!updated) {
          throw new WorkspaceMemberServiceError(404, "member_not_found", "没有找到这个工作区里的这个成员。");
        }
        return { from: targetRole, membershipId: target.id, to: updated.role as MembershipRole };
      });
      await writeAuditBestEffort({
        actorKind: "human",
        actorUserId: resolved.actorUserId,
        workspaceId: resolved.workspaceId,
        entityType: "workspace_membership",
        entityId: outcome.membershipId,
        action: "workspace.member_role_changed",
        detailJson: {
          workspace_id: resolved.workspaceId,
          target_user_id: targetUserId,
          from_role: outcome.from,
          to_role: input.role
        }
      });
      return { user_id: targetUserId, role: outcome.to };
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultWorkspaceMemberService: WorkspaceMemberService | undefined;

export function getDefaultWorkspaceMemberService(): WorkspaceMemberService {
  if (!defaultWorkspaceMemberService) {
    defaultDbClient = getSharedDatabaseClient();
    const db = defaultDbClient.db;
    defaultWorkspaceMemberService = createWorkspaceMemberService({
      memberships: createWorkspaceMembershipRepository(db),
      sessions: createSessionRepository(db),
      devices: createClientDeviceRepository(db),
      auditLogs: createAuditLogRepository(db),
      presence: getDefaultPresenceStore(),
      // P1-09：移出/改角色在 workspace 级 advisory 锁 + 单事务内跑，重查不变量与写同临界区。tx 与 db 共享
      // 查询接口，故可现起 tx-bound 仓库（mirror middleware/auth.ts 的 atomicAuthWrites）。撤 session/device
      // token 也在同事务内，与软删原子同进退。
      withWorkspaceLock: (workspaceId, run) =>
        db.transaction(async (tx) => {
          await acquireWorkspaceMemberLock(tx, workspaceId);
          return run({
            memberships: createWorkspaceMembershipRepository(tx),
            sessions: createSessionRepository(tx),
            devices: createClientDeviceRepository(tx)
          });
        })
    });
  }
  return defaultWorkspaceMemberService;
}
