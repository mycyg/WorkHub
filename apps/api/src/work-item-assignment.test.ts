import assert from "node:assert/strict";
import test from "node:test";

import type { WorkItemAccessRow, WorkItemAssignmentRow } from "@workhub/db";

import type { AuthActor } from "./middleware/auth.js";
import { WorkItemServiceError } from "./services/work-items.js";
import {
  createWorkItemAssignmentService,
  type WorkItemAssignmentServiceDependencies
} from "./services/work-item-assignment.js";

const now = new Date("2026-07-15T00:00:00.000Z");
const workspaceId = "00000000-0000-4000-8000-000000000002";
const submitterId = "62000000-0000-4000-8000-000000000001";
const assigneeId = "62000000-0000-4000-8000-000000000002";
const workItemId = "62000000-0000-4000-8000-0000000000bb";

function actor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: submitterId,
    label: "submitter",
    userId: submitterId,
    isAdmin: false,
    orgId: "00000000-0000-4000-8000-000000000001",
    workspaceId,
    ...overrides
  };
}

function accessRow(overrides: Partial<WorkItemAccessRow> = {}): WorkItemAccessRow {
  return {
    id: workItemId,
    code: "WI-1",
    title: "任务",
    status: "spec_ready",
    submitterUserId: submitterId,
    claimedByUserId: null,
    workspaceId,
    project: {
      archived: false,
      deletedAt: null,
      ownerUserId: submitterId,
      workspaceId,
      orgId: null,
      name: "项目"
    },
    assignments: [],
    ...overrides
  };
}

function assignmentRow(overrides: Partial<WorkItemAssignmentRow> = {}): WorkItemAssignmentRow {
  return {
    id: "assign-1",
    workItemId,
    userId: assigneeId,
    role: "collaborator",
    assignedByUserId: submitterId,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as WorkItemAssignmentRow;
}

type Recorder = {
  assigned: Array<{ workItemId: string; userId: string; role: string; assignedByUserId: string }>;
  claimed: Array<{ workItemId: string; workspaceId: string; userId: string }>;
  audits: Array<{ action: string; entityType: string; entityId: string; workspaceId?: string; detailJson?: Record<string, unknown> }>;
};

function service(config: {
  row?: WorkItemAccessRow | null;
  member?: boolean;
  userActive?: boolean;
  withUsers?: boolean;
  withAuditLogs?: boolean;
  claimReturns?: { id: string; claimedByUserId: string | null } | null;
} = {}): { svc: ReturnType<typeof createWorkItemAssignmentService>; rec: Recorder } {
  const rec: Recorder = { assigned: [], claimed: [], audits: [] };
  const deps: WorkItemAssignmentServiceDependencies = {
    workItems: {
      async findWorkItemAccessRecord() {
        return config.row === undefined ? accessRow() : config.row;
      },
      async claimOwnerlessWorkItem(input) {
        rec.claimed.push({ workItemId: input.workItemId, workspaceId: input.workspaceId, userId: input.userId });
        return config.claimReturns === undefined
          ? { id: input.workItemId, claimedByUserId: input.userId }
          : config.claimReturns;
      }
    },
    assignments: {
      async assignWorkItem(input) {
        rec.assigned.push({
          workItemId: input.workItemId,
          userId: input.userId,
          role: input.role,
          assignedByUserId: input.assignedByUserId
        });
        return assignmentRow({ userId: input.userId, role: input.role, assignedByUserId: input.assignedByUserId });
      },
      async listAssignmentsForWorkItem() {
        return [];
      }
    },
    memberships: {
      async findActiveForUserWorkspace() {
        return (config.member ?? true) ? ({ id: "m-1" } as never) : null;
      }
    },
    // MRG-13：默认注入活跃成员目录；userActive:false 模拟被指派人是已停用/不存在账号。
    ...(config.withUsers === false
      ? {}
      : {
          users: {
            async findActiveById(id: string) {
              return (config.userActive ?? true) ? ({ id } as never) : null;
            }
          }
        }),
    ...(config.withAuditLogs
      ? {
          auditLogs: {
            async createAuditLog(input: { action: string; entityType: string; entityId: string; workspaceId?: string; detailJson?: Record<string, unknown> }) {
              rec.audits.push(input);
              return input as never;
            }
          }
        }
      : {}),
    now: () => now
  };
  return { svc: createWorkItemAssignmentService(deps), rec };
}

// ---- assign ----

test("assign: submitter can assign a member; defaults to collaborator and lands the row", async () => {
  const { svc, rec } = service();
  const result = await svc.assign({ workItemId, assigneeUserId: assigneeId, actor: actor() });
  assert.equal(result.assignment.user_id, assigneeId);
  assert.equal(result.assignment.role, "collaborator");
  assert.deepEqual(rec.assigned, [
    { workItemId, userId: assigneeId, role: "collaborator", assignedByUserId: submitterId }
  ]);
});

test("assign: explicit lead role is honored", async () => {
  const { svc, rec } = service();
  const result = await svc.assign({ workItemId, assigneeUserId: assigneeId, role: "lead", actor: actor() });
  assert.equal(result.assignment.role, "lead");
  assert.equal(rec.assigned[0]?.role, "lead");
});

test("assign: unrelated non-admin is forbidden and nothing is written", async () => {
  const { svc, rec } = service();
  await assert.rejects(
    () => svc.assign({ workItemId, assigneeUserId: assigneeId, actor: actor({ id: "outsider", userId: "outsider" }) }),
    (error: unknown) => error instanceof WorkItemServiceError && error.status === 403
  );
  assert.deepEqual(rec.assigned, []);
});

test("assign: assignee who is not a workspace member is rejected 422", async () => {
  const { svc, rec } = service({ member: false });
  await assert.rejects(
    () => svc.assign({ workItemId, assigneeUserId: assigneeId, actor: actor() }),
    (error: unknown) => error instanceof WorkItemServiceError && error.status === 422 && error.code === "assignee_not_member"
  );
  assert.deepEqual(rec.assigned, []);
});

// MRG-13：membership 只证明「是成员」不证明「账号还活着」——已停用账号仍可能留着 active 成员行。
test("assign: a deactivated (or missing) assignee account is rejected 422 before the membership check", async () => {
  const { svc, rec } = service({ userActive: false });
  await assert.rejects(
    () => svc.assign({ workItemId, assigneeUserId: assigneeId, actor: actor() }),
    (error: unknown) => error instanceof WorkItemServiceError && error.status === 422 && error.code === "assignee_not_active"
  );
  assert.deepEqual(rec.assigned, []);
});

test("assign: without the user directory seam the service fails closed with 503", async () => {
  const { svc, rec } = service({ withUsers: false });
  await assert.rejects(
    () => svc.assign({ workItemId, assigneeUserId: assigneeId, actor: actor() }),
    (error: unknown) =>
      error instanceof WorkItemServiceError && error.status === 503 && error.code === "assign_user_directory_unavailable"
  );
  assert.deepEqual(rec.assigned, []);
});

// MRG-10：指派/认领必须留工作区级审计（审计页按 workspaceId 硬过滤）。
test("assign: writes a work_item.assigned audit row with the workspace id", async () => {
  const { svc, rec } = service({ withAuditLogs: true });
  await svc.assign({ workItemId, assigneeUserId: assigneeId, actor: actor() });
  assert.equal(rec.audits.length, 1);
  assert.equal(rec.audits[0]?.action, "work_item.assigned");
  assert.equal(rec.audits[0]?.entityType, "work_item");
  assert.equal(rec.audits[0]?.entityId, workItemId);
  assert.equal(rec.audits[0]?.workspaceId, workspaceId);
  assert.equal(rec.audits[0]?.detailJson?.["assignee_user_id"], assigneeId);
});

test("assign: missing work item maps to 404", async () => {
  const { svc } = service({ row: null });
  await assert.rejects(
    () => svc.assign({ workItemId, assigneeUserId: assigneeId, actor: actor() }),
    (error: unknown) => error instanceof WorkItemServiceError && error.status === 404
  );
});

test("assign: admin can assign even when not the submitter", async () => {
  const { svc, rec } = service({ row: accessRow({ submitterUserId: "someone-else" }) });
  await svc.assign({
    workItemId,
    assigneeUserId: assigneeId,
    actor: actor({ id: "admin", userId: "admin", isAdmin: true })
  });
  assert.equal(rec.assigned.length, 1);
});

// ---- claim ----

test("claim: eligible user claims an ownerless spec_ready item; claimedByUserId lands", async () => {
  const claimer = actor({ id: assigneeId, userId: assigneeId, label: "claimer" });
  const { svc, rec } = service({ row: accessRow({ submitterUserId: "someone-else" }) });
  const result = await svc.claim({ workItemId, actor: claimer });
  assert.equal(result.work_item_id, workItemId);
  assert.equal(result.claimed_by_user_id, assigneeId);
  assert.deepEqual(rec.claimed, [{ workItemId, workspaceId, userId: assigneeId }]);
});

// MRG-10：认领同样留工作区级审计。
test("claim: writes a work_item.claimed audit row with the workspace id", async () => {
  const claimer = actor({ id: assigneeId, userId: assigneeId, label: "claimer" });
  const { svc, rec } = service({ row: accessRow({ submitterUserId: "someone-else" }), withAuditLogs: true });
  await svc.claim({ workItemId, actor: claimer });
  assert.equal(rec.audits.length, 1);
  assert.equal(rec.audits[0]?.action, "work_item.claimed");
  assert.equal(rec.audits[0]?.entityType, "work_item");
  assert.equal(rec.audits[0]?.entityId, workItemId);
  assert.equal(rec.audits[0]?.workspaceId, workspaceId);
  assert.equal(rec.audits[0]?.detailJson?.["claimed_by_user_id"], assigneeId);
});

test("claim: non-spec_ready item is not claimable (403)", async () => {
  const { svc, rec } = service({ row: accessRow({ status: "ai_working" }) });
  await assert.rejects(
    () => svc.claim({ workItemId, actor: actor({ id: assigneeId, userId: assigneeId }) }),
    (error: unknown) => error instanceof WorkItemServiceError && error.status === 403
  );
  assert.deepEqual(rec.claimed, []);
});

test("claim: CAS miss (already claimed) maps to 409 work_item_not_claimable", async () => {
  const { svc } = service({ claimReturns: null });
  await assert.rejects(
    () => svc.claim({ workItemId, actor: actor({ id: assigneeId, userId: assigneeId }) }),
    (error: unknown) => error instanceof WorkItemServiceError && error.status === 409 && error.code === "work_item_not_claimable"
  );
});

test("claim: missing work item maps to 404", async () => {
  const { svc } = service({ row: null });
  await assert.rejects(
    () => svc.claim({ workItemId, actor: actor({ id: assigneeId, userId: assigneeId }) }),
    (error: unknown) => error instanceof WorkItemServiceError && error.status === 404
  );
});

// R21 加固（A9 兜底口径统一）：claim 与 assign 用同一个 workspaceId 兜底——工作项列缺失时兜项目侧，
// 绝不兜 actor 侧（否则无归属行会被写进 actor 的工作区）。
test("claim: a work item whose own workspaceId is missing falls back to the PROJECT workspace, not the actor's", async () => {
  const projectWorkspaceId = "00000000-0000-4000-8000-000000000077";
  const row = accessRow({ submitterUserId: "someone-else", workspaceId: null } as Partial<WorkItemAccessRow>);
  row.project = { ...row.project!, workspaceId: projectWorkspaceId };
  const claimer = actor({ id: assigneeId, userId: assigneeId, workspaceId: projectWorkspaceId });
  const { svc, rec } = service({ row });
  await svc.claim({ workItemId, actor: claimer });
  assert.deepEqual(rec.claimed, [{ workItemId, workspaceId: projectWorkspaceId, userId: assigneeId }]);
});

test("claim: no workspace on either the work item or its project maps to 409 work_item_workspace_missing", async () => {
  const row = accessRow({ submitterUserId: "someone-else", workspaceId: null } as Partial<WorkItemAccessRow>);
  row.project = { ...row.project!, workspaceId: null };
  // workspaceId 置空串让 permissionScope 回落 undefined（无作用域收窄）——聚焦断言 workspace 兜底本身，
  // 而非 scope 门（两侧全 NULL 的行在带 scope 的门里本就进不来）。
  const claimer = actor({ id: assigneeId, userId: assigneeId, workspaceId: "" });
  const { svc, rec } = service({ row });
  await assert.rejects(
    () => svc.claim({ workItemId, actor: claimer }),
    (error: unknown) =>
      error instanceof WorkItemServiceError && error.status === 409 && error.code === "work_item_workspace_missing"
  );
  assert.deepEqual(rec.claimed, [], "must not write into the actor's workspace as a fallback");
});
