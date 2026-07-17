// R20 P2A（R19-18 指派/认领 · 纯后端）：POST /api/workitems/:id/assign 与 /claim 的服务层。
// 生产此前 work_item_assignments 零 INSERT、claimedByUserId 唯一写口只在找人交互卡里——这里把两件事
// 开放成人可发起的端点：
//   * assign：把工作项显式指派给某成员（写 work_item_assignments）。门＝canManageWorkItemAssignees
//     （管理员 / 提交人 / 现任 lead），且被指派人必须是本工作区 active 成员（防越租户指派）。
//   * claim：当前登录用户认领一个无主工作项（复用既有 claimOwnerlessWorkItem 的 CAS 语义）。门＝
//     canClaimWorkItem（spec_ready、未被他人独占指派 / 管理员）。
// 复用 WorkItemServiceError（app.onError 已映射），不新起错误类型。
import {
  ASSIGNMENT_ROLES,
  canClaimWorkItem,
  canManageWorkItemAssignees
} from "@workhub/permissions";
import type { Assignment, AssignWorkItemResult, ClaimWorkItemResult } from "@workhub/contracts";
import {
  createWorkItemAssignmentRepository,
  createWorkItemRepository,
  createWorkspaceMembershipRepository,
  getSharedDatabaseClient,
  type WorkItemAccessRow,
  type WorkItemAssignmentRepository,
  type WorkItemAssignmentRow,
  type WorkItemDataRepository,
  type WorkspaceMembershipRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import { WorkItemServiceError } from "./work-items.js";

export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];

export type WorkItemAssignmentService = {
  assign: (input: {
    workItemId: string;
    assigneeUserId: string;
    role?: AssignmentRole;
    actor: AuthActor;
  }) => Promise<AssignWorkItemResult>;
  claim: (input: { workItemId: string; actor: AuthActor }) => Promise<ClaimWorkItemResult>;
};

export type WorkItemAssignmentServiceDependencies = {
  workItems: Pick<WorkItemDataRepository, "findWorkItemAccessRecord" | "claimOwnerlessWorkItem">;
  assignments: WorkItemAssignmentRepository;
  memberships: Pick<WorkspaceMembershipRepository, "findActiveForUserWorkspace">;
  now?: () => Date;
};

function actorUserId(actor: AuthActor): string {
  return actor.userId ?? actor.id;
}

// WorkItemAccessRow 与 @workhub/permissions 的 WorkItemAccessRecord 结构同源，直接喂进权限判定。
function permissionUser(actor: AuthActor) {
  return { id: actorUserId(actor), isAdmin: actor.isAdmin };
}

function permissionScope(actor: AuthActor) {
  // 仅按 workspace 作用域（硬租户边界）；不传 orgId——work_items/projects 无 orgId 列，
  // 传了会把合法读误判成越界（与 work-items.ts canReadWorkItemAccessRow 的注释同因）。
  return actor.workspaceId ? { workspaceId: actor.workspaceId } : undefined;
}

function assignmentVm(row: WorkItemAssignmentRow): Assignment {
  return {
    id: row.id,
    work_item_id: row.workItemId,
    user_id: row.userId,
    role: row.role as AssignmentRole,
    assigned_by_user_id: row.assignedByUserId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

export function createWorkItemAssignmentService(
  deps: WorkItemAssignmentServiceDependencies
): WorkItemAssignmentService {
  const now = deps.now ?? (() => new Date());

  async function requireAccessRow(workItemId: string): Promise<WorkItemAccessRow> {
    const row = await deps.workItems.findWorkItemAccessRecord(workItemId);
    if (!row) {
      throw new WorkItemServiceError(404, "not_found", "没有找到这个事项。(Work item not found.)");
    }
    return row;
  }

  return {
    async assign({ workItemId, assigneeUserId, role, actor }) {
      const accessRow = await requireAccessRow(workItemId);
      const allowed = canManageWorkItemAssignees(accessRow, permissionUser(actor), permissionScope(actor));
      if (!allowed) {
        throw new WorkItemServiceError(403, "forbidden", "你没有权限指派这个事项。");
      }
      // 被指派人必须是这个工作项所属工作区的 active 成员——否则会把工作指派给不在本租户的人。
      const workspaceId = accessRow.workspaceId ?? accessRow.project?.workspaceId ?? null;
      if (!workspaceId) {
        throw new WorkItemServiceError(409, "work_item_workspace_missing", "这个事项还没有归属工作区，暂时无法指派。");
      }
      const membership = await deps.memberships.findActiveForUserWorkspace(assigneeUserId, workspaceId);
      if (!membership) {
        throw new WorkItemServiceError(422, "assignee_not_member", "被指派人不是这个工作区的成员。");
      }
      const row = await deps.assignments.assignWorkItem({
        workItemId,
        userId: assigneeUserId,
        role: role ?? "collaborator",
        assignedByUserId: actorUserId(actor),
        at: now()
      });
      return { assignment: assignmentVm(row) };
    },

    async claim({ workItemId, actor }) {
      const accessRow = await requireAccessRow(workItemId);
      const allowed = canClaimWorkItem(accessRow, permissionUser(actor), permissionScope(actor));
      if (!allowed) {
        throw new WorkItemServiceError(403, "forbidden", "你现在还不能认领这个事项。");
      }
      const workspaceId = accessRow.workspaceId ?? actor.workspaceId;
      const claimed = await deps.workItems.claimOwnerlessWorkItem({
        workItemId,
        workspaceId,
        userId: actorUserId(actor),
        at: now()
      });
      if (!claimed) {
        // CAS 落空：已被别人认领 / 已离开可认领状态（并发或过期点击）——不覆盖既有认领人。
        throw new WorkItemServiceError(409, "work_item_not_claimable", "这个事项已被认领或已不在可认领状态。");
      }
      return {
        work_item_id: claimed.id,
        claimed_by_user_id: claimed.claimedByUserId ?? actorUserId(actor)
      };
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultService: WorkItemAssignmentService | undefined;

export function getDefaultWorkItemAssignmentService(): WorkItemAssignmentService {
  if (!defaultService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultService = createWorkItemAssignmentService({
      workItems: createWorkItemRepository(defaultDbClient.db),
      assignments: createWorkItemAssignmentRepository(defaultDbClient.db),
      memberships: createWorkspaceMembershipRepository(defaultDbClient.db)
    });
  }
  return defaultService;
}
