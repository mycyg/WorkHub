import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import { deliverableManifestFixtures } from "@workhub/contracts";
import type {
  AuditLogRepository,
  AuditLogRow,
  ApprovalCommentRow,
  ApprovalRequestRepository,
  ApprovalRequestRow,
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  PermissionPolicyRecord,
  PermissionPolicyRepository,
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { COOKIE_NAME, hashClientToken, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import {
  ApprovalServiceError,
  createApprovalService,
  parseMentions,
  type ApprovalService
} from "./services/approvals.js";
import type { NotificationService } from "./services/notifications.js";
import type { StoredProposal } from "./services/proposals.js";
import { createApprovalRoutes } from "./routes/approvals.js";
import { createPermissionRoutes } from "./routes/permissions.js";
import { WorkItemServiceError, type WorkItemService } from "./services/work-items.js";

const now = new Date("2026-06-05T00:00:00.000Z");
const userId = "10000000-0000-4000-8000-000000000001";
const approverId = "10000000-0000-4000-8000-000000000002";
const orgId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";

function user(partial: Partial<UserAuthRow> = {}): UserAuthRow {
  return {
    id: userId,
    nickname: "alice",
    cookieToken: "cookie-alice",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    avatarWebp: null,
    avatarUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

function device(partial: Partial<ClientDeviceAuthRow> = {}): ClientDeviceAuthRow {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    userId,
    deviceName: "WorkHub Desktop",
    clientTokenHash: hashClientToken("client-token-alice"),
    platform: "desktop",
    lastSeenAt: now,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

function row(partial: Partial<ApprovalRequestRow> = {}): ApprovalRequestRow {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    workItemId: "50000000-0000-4000-8000-000000000001",
    agentRunId: "60000000-0000-4000-8000-000000000001",
    actionPattern: "tool.write_file",
    payloadJson: {},
    status: "pending",
    routedToUserId: approverId,
    decidedByUserId: null,
    decisionReasonMd: null,
    delegatedToUserId: null,
    slaDueAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

class MemoryApprovals implements ApprovalRequestRepository {
  public rows: ApprovalRequestRow[] = [];

  async createApprovalRequest(input: Parameters<ApprovalRequestRepository["createApprovalRequest"]>[0]) {
    const approval = row({
      id: input.id ?? `40000000-0000-4000-8000-${String(this.rows.length + 1).padStart(12, "0")}`,
      workItemId: input.workItemId ?? null,
      agentRunId: input.agentRunId ?? null,
      actionPattern: input.actionPattern,
      payloadJson: input.payloadJson ?? {},
      routedToUserId: input.routedToUserId ?? null,
      slaDueAt: input.slaDueAt ?? null
    });
    this.rows.push(approval);
    return approval;
  }

  async findById(id: string) {
    return this.rows.find((approval) => approval.id === id) ?? null;
  }

  async listPendingDue(at: Date, limit = 50) {
    return this.rows
      .filter((approval) => approval.status === "pending" && approval.slaDueAt != null && approval.slaDueAt <= at)
      .sort((a, b) => {
        const dueDelta = (a.slaDueAt?.getTime() ?? 0) - (b.slaDueAt?.getTime() ?? 0);
        return dueDelta === 0 ? a.createdAt.getTime() - b.createdAt.getTime() : dueDelta;
      })
      .slice(0, limit);
  }

  async listPendingForUser(id: string, options: { includeAll?: boolean; limit?: number; offset?: number } = {}) {
    const offset = options.offset ?? 0;
    return this.rows
      .filter((approval) => approval.status === "pending" && (options.includeAll || approval.routedToUserId === id))
      .slice(offset, offset + (options.limit ?? this.rows.length));
  }

  async listDecidedForUser(id: string, options: { limit?: number } = {}) {
    return this.rows
      .filter((approval) => approval.status !== "pending" && (approval.decidedByUserId === id || approval.routedToUserId === id))
      .slice(0, options.limit ?? 20);
  }

  async countPendingForUser(id: string, options: { includeAll?: boolean } = {}) {
    return this.rows.filter(
      (approval) => approval.status === "pending" && (options.includeAll || approval.routedToUserId === id)
    ).length;
  }

  async respondPending(
    id: string,
    decision: "allow" | "deny",
    decidedByUserId: string,
    reasonMd: string | null,
    at: Date,
    requireRoutedToUserId?: string
  ) {
    const approval = this.rows.find((candidate) =>
      candidate.id === id
      && candidate.status === "pending"
      // findings[#27]：与真实仓库一致，非 admin 决策须复核路由人仍是本人。
      && (requireRoutedToUserId === undefined || candidate.routedToUserId === requireRoutedToUserId)
    ) ?? null;
    if (!approval) {
      return null;
    }
    approval.status = decision === "allow" ? "approved" : "denied";
    approval.decidedByUserId = decidedByUserId;
    approval.decisionReasonMd = reasonMd;
    approval.updatedAt = at;
    return approval;
  }

  async delegatePending(id: string, toUserId: string, at: Date, requireRoutedToUserId?: string) {
    const approval = this.rows.find((candidate) =>
      candidate.id === id
      && candidate.status === "pending"
      && (requireRoutedToUserId === undefined || candidate.routedToUserId === requireRoutedToUserId)
    ) ?? null;
    if (!approval) {
      return null;
    }
    approval.routedToUserId = toUserId;
    approval.delegatedToUserId = toUserId;
    approval.updatedAt = at;
    return approval;
  }

  async expirePending(id: string, at: Date) {
    const approval = this.rows.find((candidate) => candidate.id === id && candidate.status === "pending") ?? null;
    if (!approval) {
      return null;
    }
    approval.status = "expired";
    approval.updatedAt = at;
    return approval;
  }
}

class RacingDelegateApprovals extends MemoryApprovals {
  private raced = false;

  constructor(private readonly routedToUserIdAfterRace: string) {
    super();
  }

  override async delegatePending(id: string, toUserId: string, at: Date, requireRoutedToUserId?: string) {
    const approval = await this.findById(id);
    if (approval && !this.raced) {
      this.raced = true;
      approval.routedToUserId = this.routedToUserIdAfterRace;
      approval.delegatedToUserId = this.routedToUserIdAfterRace;
    }
    return super.delegatePending(id, toUserId, at, requireRoutedToUserId);
  }
}

class MemoryPolicies implements PermissionPolicyRepository {
  public rows: PermissionPolicyRecord[];

  constructor(rows: PermissionPolicyRecord[] = []) {
    this.rows = rows;
  }

  async listActivePolicies() {
    return this.rows.filter((policy) => policy.deletedAt == null);
  }

  async createPermissionPolicy(input: Parameters<PermissionPolicyRepository["createPermissionPolicy"]>[0]) {
    const policy: PermissionPolicyRecord = {
      id: input.id ?? `70000000-0000-4000-8000-${String(this.rows.length + 1).padStart(12, "0")}`,
      scopeKind: input.scopeKind,
      scopeId: input.scopeId,
      actionPattern: input.actionPattern,
      effect: input.effect,
      priority: input.priority ?? 0,
      learnedFromSession: input.learnedFromSession ?? false,
      createdByUserId: input.createdByUserId ?? null,
      orgId: input.orgId ?? null,
      workspaceId: input.workspaceId ?? null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.rows.push(policy);
    return policy;
  }

  async softDeletePolicy(id: string, deletedByUserId: string, at: Date) {
    const policy = this.rows.find((candidate) => candidate.id === id) ?? null;
    if (!policy) {
      return null;
    }
    policy.deletedAt = at;
    policy.updatedAt = at;
    assert.equal(typeof deletedByUserId, "string");
    return policy;
  }
}

class RecordingBus {
  public events: { topic: string; type: string; data: unknown }[] = [];

  async publish<T>(topic: string, type: string, data: T) {
    this.events.push({ topic, type, data });
  }
}

class MemoryAuditLogs implements AuditLogRepository {
  public rows: AuditLogRow[] = [];

  async createAuditLog(input: Parameters<AuditLogRepository["createAuditLog"]>[0]) {
    const log: AuditLogRow = {
      id: input.id ?? `81000000-0000-4000-8000-${String(this.rows.length + 1).padStart(12, "0")}`,
      orgId: input.orgId ?? null,
      workspaceId: input.workspaceId ?? null,
      actorKind: input.actorKind,
      actorUserId: input.actorUserId ?? null,
      actorNickname: input.actorNickname ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      detailJson: input.detailJson ?? {},
      snapshotId: input.snapshotId ?? null,
      undoneAt: null,
      createdAt: now
    };
    this.rows.push(log);
    return log;
  }

  async listAuditLogsForEntity(entityType: string, entityId: string) {
    return this.rows.filter((row) => row.entityType === entityType && row.entityId === entityId);
  }

  async listAuditLogsForWorkItem(workItemId: string) {
    return this.listAuditLogsForEntity("work_item", workItemId);
  }

  async markAuditLogUndone(id: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === id) ?? null;
    if (!row) {
      return null;
    }
    row.undoneAt = at;
    return row;
  }
}

class ThrowingAuditLogs extends MemoryAuditLogs {
  override async createAuditLog(_input: Parameters<AuditLogRepository["createAuditLog"]>[0]): Promise<AuditLogRow> {
    throw new Error("audit sink unavailable");
  }
}

function eligibleDelegate(targetUserIds: readonly string[]) {
  const eligible = new Set(targetUserIds);
  return {
    users: {
      findActiveById: async (id: string) => eligible.has(id) ? user({ id }) : null
    },
    memberships: {
      findActiveForUserWorkspace: async (id: string, targetWorkspaceId: string) =>
        eligible.has(id) && targetWorkspaceId === workspaceId
          ? ({ id: `membership-${id}`, userId: id, workspaceId } as never)
          : null
    }
  };
}

function recordingDelegateNotifications(calls: unknown[]) {
  return {
    createMentionNotification: async () => undefined as never,
    createNotification: async (input: unknown) => {
      calls.push({ action: "create", input });
      return undefined as never;
    },
    archiveByDedupeKey: async (dedupeKey: string) => {
      calls.push({ action: "archive", dedupeKey });
      return 0;
    }
  };
}

function serviceDeps(
  policies: PermissionPolicyRecord[] = [],
  delegateTargetUserIds: readonly string[] = []
) {
  const approvals = new MemoryApprovals();
  const policyRepo = new MemoryPolicies(policies);
  const auditLogs = new MemoryAuditLogs();
  const bus = new RecordingBus();
  return {
    approvals,
    policyRepo,
    auditLogs,
    bus,
    service: createApprovalService({
      approvals,
      auditLogs,
      policies: policyRepo,
      bus,
      ...(delegateTargetUserIds.length > 0 ? eligibleDelegate(delegateTargetUserIds) : {}),
      now: () => now
    })
  };
}

const actor = {
  kind: "human" as const,
  id: approverId,
  label: "approver",
  userId: approverId,
  isAdmin: false,
  orgId,
  workspaceId
};

test("ask creates a pending approval and publishes only private user/session topics", async () => {
  const deps = serviceDeps();
  const result = await deps.service.createApproval({
    actor,
    kind: "tool",
    agentRunId: "60000000-0000-4000-8000-000000000001",
    workItemId: "50000000-0000-4000-8000-000000000001",
    actionPattern: "tool.write_file",
    routedToUserId: approverId,
    payloadJson: {
      ui: {
        summary_text: "AI 想修改交付包里的 3 个文件，需要你点头。",
        risk: { level: "medium", human_label: "影响面不小，稳一点" }
      },
      raw_args: { action: "tool.write_file" }
    }
  });

  assert.equal(result.outcome, "pending");
  // findings[#169]：会话流订阅 session:<workItemId>，权限 ask 必须发到 workItemId 的会话频道（不是 agentRunId）。
  assert.deepEqual(
    deps.bus.events.map((event) => event.topic).sort(),
    [`session:50000000-0000-4000-8000-000000000001`, `user:${approverId}`].sort()
  );
  assert.equal(deps.bus.events.some((event) => event.topic === "all"), false);
  if (result.outcome === "pending") {
    assert.equal(result.attention.summary_text.includes("tool.write_file"), false);
  }
});

test("L37 ask escalates instead of creating a phantom-inbox approval when the routed user does not exist", async () => {
  const approvals = new MemoryApprovals();
  const policyRepo = new MemoryPolicies([]);
  const auditLogs = new MemoryAuditLogs();
  const bus = new RecordingBus();
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies: policyRepo,
    bus,
    users: { findActiveById: async () => null },
    now: () => now
  });

  const result = await service.createApproval({
    actor,
    kind: "tool",
    actionPattern: "tool.write_file",
    routedToUserId: "99999999-0000-4000-8000-000000000099"
  });

  assert.equal(result.outcome, "escalated");
  if (result.outcome === "escalated") {
    assert.equal(result.reason, "no_approver");
  }
  assert.equal(approvals.rows.length, 0, "no approval row is written into a non-existent inbox");
});

test("L37 ask still creates a pending approval when the routed user exists", async () => {
  const approvals = new MemoryApprovals();
  const policyRepo = new MemoryPolicies([]);
  const auditLogs = new MemoryAuditLogs();
  const bus = new RecordingBus();
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies: policyRepo,
    bus,
    users: { findActiveById: async () => ({ id: approverId }) as never },
    now: () => now
  });

  const result = await service.createApproval({
    actor,
    kind: "tool",
    actionPattern: "tool.write_file",
    routedToUserId: approverId
  });

  assert.equal(result.outcome, "pending");
  assert.equal(approvals.rows.length, 1);
});

test("ask escalates when the routed user cannot view the approval work item", async () => {
  const approvals = new MemoryApprovals();
  const policyRepo = new MemoryPolicies([]);
  const auditLogs = new MemoryAuditLogs();
  const bus = new RecordingBus();
  const otherWorkspaceId = "99990000-0000-4000-8000-0000000000a5";
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies: policyRepo,
    bus,
    users: { findActiveById: async () => user({ id: approverId }) },
    workItems: {
      findWorkItemAccessRecord: async () => ({
        id: "50000000-0000-4000-8000-0000000000a5",
        status: "in_review",
        submitterUserId: "10000000-0000-4000-8000-0000000000ee",
        claimedByUserId: null,
        workspaceId: otherWorkspaceId,
        project: {
          id: "70000000-0000-4000-8000-0000000000a5",
          workspaceId: otherWorkspaceId,
          orgId,
          ownerUserId: "10000000-0000-4000-8000-0000000000ee",
          archived: false,
          deletedAt: null
        },
        assignments: []
      }) as never
    },
    now: () => now
  });

  const result = await service.createApproval({
    actor,
    kind: "tool",
    workItemId: "50000000-0000-4000-8000-0000000000a5",
    actionPattern: "tool.write_file",
    routedToUserId: approverId
  });

  assert.equal(result.outcome, "escalated");
  assert.equal(approvals.rows.length, 0);
});

test("ask escalates when the approval work item no longer exists", async () => {
  const approvals = new MemoryApprovals();
  const policyRepo = new MemoryPolicies([]);
  const auditLogs = new MemoryAuditLogs();
  const bus = new RecordingBus();
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies: policyRepo,
    bus,
    users: { findActiveById: async () => user({ id: approverId }) },
    workItems: {
      findWorkItemAccessRecord: async () => null
    },
    now: () => now
  });

  const result = await service.createApproval({
    actor,
    kind: "tool",
    workItemId: "50000000-0000-4000-8000-0000000000a6",
    actionPattern: "tool.write_file",
    routedToUserId: approverId
  });

  assert.equal(result.outcome, "escalated");
  assert.equal(approvals.rows.length, 0);
});

test("allow policy skips approval creation while no policy defaults to ask", async () => {
  const deps = serviceDeps([
    {
      scopeKind: "session",
      scopeId: "60000000-0000-4000-8000-000000000001",
      actionPattern: "tool.write_file",
      effect: "allow",
      createdAt: now,
      updatedAt: now
    }
  ]);

  const result = await deps.service.createApproval({
    actor,
    kind: "tool",
    agentRunId: "60000000-0000-4000-8000-000000000001",
    actionPattern: "tool.write_file",
    routedToUserId: approverId
  });

  assert.equal(result.outcome, "allowed");
  assert.equal(deps.approvals.rows.length, 0);
});

test("deny requires a reason and remember always refuses to learn high-risk approvals", async () => {
  const deps = serviceDeps();
  const highRisk = await deps.approvals.createApprovalRequest({
    actionPattern: "tool.publish_external",
    routedToUserId: approverId,
    payloadJson: {
      ui: {
        summary_text: "AI 想发布对外内容，需要你确认。",
        risk: { level: "high", human_label: "对外动作" }
      },
      raw_args: {}
    }
  });

  await assert.rejects(
    () => deps.service.respond(highRisk.id, actor, { decision: "deny", remember: "once" }),
    (error) => error instanceof ApprovalServiceError && error.status === 422
  );

  await deps.service.respond(highRisk.id, actor, { decision: "allow", remember: "always" });
  assert.equal(deps.policyRepo.rows.length, 0);

  const mediumRisk = await deps.approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    routedToUserId: approverId,
    payloadJson: {
      ui: {
        summary_text: "AI 想更新文件，需要你确认。",
        risk: { level: "medium", human_label: "可回滚" }
      },
      raw_args: {}
    }
  });
  await deps.service.respond(mediumRisk.id, actor, { decision: "allow", remember: "always" });

  assert.equal(deps.policyRepo.rows.length, 1);
  assert.equal(deps.policyRepo.rows[0]?.learnedFromSession, true);
});

test("remember always skips learning but returns the committed decision when policy audit logging fails", async () => {
  const deps = serviceDeps();
  const approval = await deps.approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    routedToUserId: approverId,
    payloadJson: {
      ui: {
        summary_text: "AI 想更新文件，需要你确认。",
        risk: { level: "medium", human_label: "可回滚" }
      },
      raw_args: {}
    }
  });
  const originalCreateAuditLog = deps.auditLogs.createAuditLog.bind(deps.auditLogs);
  deps.auditLogs.createAuditLog = async (input) => {
    if (input.action === "permission_policy.created") {
      throw new Error("audit sink unavailable");
    }
    return originalCreateAuditLog(input);
  };

  // R9 branch-review fix-batch2-1: the old assertion made the whole response
  // fail after respondPending() had already committed the decision, causing
  // client retry to hit 409 and dropping approval.decided audit/publish.
  const result = await deps.service.respond(approval.id, actor, { decision: "allow", remember: "always" });

  assert.equal(result.approval.status, "approved");
  assert.equal(result.learned_policy, undefined);
  assert.equal(deps.policyRepo.rows.length, 0);
  const decidedAudit = deps.auditLogs.rows.find((entry) => entry.action === "approval.decided");
  assert.equal((decidedAudit?.detailJson as Record<string, unknown> | undefined)?.learn_failed, true);
  assert.equal(deps.bus.events.some((event) => event.type === "permission.decided"), true);
});

test("remember always reuses an equivalent active policy instead of duplicating learned policies", async () => {
  const existingId = "70000000-0000-4000-8000-0000000000b1";
  const deps = serviceDeps([{
    id: existingId,
    scopeKind: "session",
    scopeId: actor.id,
    actionPattern: "tool.write_file",
    effect: "allow",
    priority: 0,
    learnedFromSession: true,
    createdByUserId: approverId,
    orgId,
    workspaceId,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  }]);
  const approval = await deps.approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    routedToUserId: approverId,
    payloadJson: {
      ui: {
        summary_text: "AI 想更新文件，需要你确认。",
        risk: { level: "medium", human_label: "可回滚" }
      },
      raw_args: {}
    }
  });

  const result = await deps.service.respond(approval.id, actor, { decision: "allow", remember: "always" });

  assert.equal(result.learned_policy?.id, existingId);
  assert.equal(deps.policyRepo.rows.length, 1);
  const decidedAudit = deps.auditLogs.rows.find((entry) => entry.action === "approval.decided");
  assert.equal((decidedAudit?.detailJson as Record<string, unknown> | undefined)?.learned_policy_id, existingId);
});

test("remember always does not create a learned policy after an approval race", async () => {
  const deps = serviceDeps();
  const approval = await deps.approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    routedToUserId: approverId,
    payloadJson: {
      ui: {
        summary_text: "AI 想更新文件，需要你确认。",
        risk: { level: "medium", human_label: "可回滚" }
      },
      raw_args: {}
    }
  });

  await deps.approvals.respondPending(approval.id, "allow", approverId, null, now);

  await assert.rejects(
    () => deps.service.respond(approval.id, actor, { decision: "allow", remember: "always" }),
    (error) => error instanceof ApprovalServiceError && error.status === 409
  );

  assert.equal(deps.policyRepo.rows.length, 0);
  assert.equal(deps.auditLogs.rows.length, 0);
  assert.equal(deps.bus.events.length, 0);
});

test("approval decisions, delegation, and expiry are audited with identity anchors", async () => {
  const delegatedToUserId = "10000000-0000-4000-8000-000000000003";
  const deps = serviceDeps([], [delegatedToUserId]);
  const denied = await deps.approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-000000000001",
    routedToUserId: approverId
  });
  await deps.service.respond(denied.id, actor, {
    decision: "deny",
    remember: "once",
    reason_md: "请先确认预算附件。"
  });

  const delegated = await deps.approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-000000000001",
    routedToUserId: approverId
  });
  await deps.service.delegate(delegated.id, actor, delegatedToUserId);

  const due = await deps.approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-000000000001",
    routedToUserId: approverId,
    slaDueAt: new Date("2026-06-04T23:59:00.000Z")
  });
  await deps.service.expireDueApprovals();

  const actions = deps.auditLogs.rows.map((log) => log.action);
  assert.deepEqual(actions, ["approval.decided", "approval.delegated", "approval.expired"]);
  assert.equal(deps.auditLogs.rows[0]?.actorUserId, approverId);
  assert.equal(deps.auditLogs.rows[0]?.entityType, "work_item");
  assert.equal(deps.auditLogs.rows[0]?.entityId, denied.workItemId);
  assert.equal(deps.auditLogs.rows[0]?.detailJson["approval_id"], denied.id);
  assert.equal(deps.auditLogs.rows[0]?.detailJson["decision"], "deny");
  assert.equal(deps.auditLogs.rows[0]?.detailJson["decided_by_user_id"], approverId);
  assert.match(String(deps.auditLogs.rows[0]?.detailJson["reason_preview"]), /预算附件/);
  assert.equal(deps.auditLogs.rows[1]?.actorUserId, approverId);
  assert.equal(deps.auditLogs.rows[1]?.detailJson["to_user_id"], delegatedToUserId);
  assert.equal(deps.auditLogs.rows[2]?.actorKind, "system");
  assert.equal(deps.auditLogs.rows[2]?.actorUserId, null);
  assert.equal(deps.auditLogs.rows[2]?.detailJson["approval_id"], due.id);
  assert.equal(deps.auditLogs.rows[2]?.detailJson["next_action"], "escalate_pm");
});

test("expireDueApprovals returns committed expirations when post-expire audit fails", async () => {
  const deps = serviceDeps();
  deps.auditLogs.createAuditLog = async () => {
    throw new Error("audit sink unavailable");
  };
  const due = await deps.approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-000000000001",
    routedToUserId: approverId,
    slaDueAt: new Date("2026-06-04T23:59:00.000Z")
  });

  const results = await deps.service.expireDueApprovals();
  const stored = await deps.approvals.findById(due.id);

  assert.equal(results.length, 1);
  assert.equal(results[0]?.approval.status, "expired");
  assert.equal(results[0]?.next_action, "escalate_pm");
  assert.equal(stored?.status, "expired");
});

// 审计 FIX#3：respond/delegate 在 CAS 提交「之后」才发总线事件。生产默认 Redis 总线 publish 会在抖动时抛——
// 决策已落库后若让它冒泡，HTTP 500 + 重试撞 409，决策永远拿不回。验证 publish 抛错时方法仍返回已提交结果（不 500）。
test("FIX#3 respond returns the committed decision even when the bus publish throws", async () => {
  const approvals = new MemoryApprovals();
  const auditLogs = new MemoryAuditLogs();
  const policyRepo = new MemoryPolicies();
  let publishCalls = 0;
  const throwingBus = {
    async publish() {
      publishCalls += 1;
      throw new Error("redis connection blip");
    }
  };
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies: policyRepo,
    bus: throwingBus,
    now: () => now
  });
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-000000000001",
    routedToUserId: approverId
  });

  // best-effort 发布吞掉抛错 → 方法照常返回已提交决策，不冒泡成 500。
  const result = await service.respond(seeded.id, actor, { decision: "allow", remember: "once" });
  assert.equal(result.approval.status, "approved");
  // 决策确实落库（CAS 提交在发布之前，发布失败不回滚）。
  assert.equal((await approvals.findById(seeded.id))?.status, "approved");
  // 审计也照常落盘（在发布之前）。
  assert.equal(auditLogs.rows.some((row) => row.action === "approval.decided"), true);
  // 确实尝试发布过（≥1 次，每次都抛但被吞）。
  assert.ok(publishCalls >= 1);
});

test("FIX#3 delegate returns the committed reassignment even when the bus publish throws", async () => {
  const approvals = new MemoryApprovals();
  const auditLogs = new MemoryAuditLogs();
  const policyRepo = new MemoryPolicies();
  const throwingBus = {
    async publish() {
      throw new Error("redis connection blip");
    }
  };
  const toUserId = "10000000-0000-4000-8000-000000000003";
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies: policyRepo,
    bus: throwingBus,
    ...eligibleDelegate([toUserId]),
    now: () => now
  });
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-000000000001",
    routedToUserId: approverId
  });
  const result = await service.delegate(seeded.id, actor, toUserId);
  assert.equal(result.approval.routed_to_user_id, toUserId);
  assert.equal((await approvals.findById(seeded.id))?.routedToUserId, toUserId);
  assert.equal(auditLogs.rows.some((row) => row.action === "approval.delegated"), true);
});

test("delegate returns the committed reassignment even when post-commit audit write throws", async () => {
  const approvals = new MemoryApprovals();
  const auditLogs = new ThrowingAuditLogs();
  const policyRepo = new MemoryPolicies();
  const bus = new RecordingBus();
  const toUserId = "10000000-0000-4000-8000-000000000003";
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies: policyRepo,
    bus,
    ...eligibleDelegate([toUserId]),
    now: () => now
  });
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-000000000001",
    routedToUserId: approverId
  });
  const result = await service.delegate(seeded.id, actor, toUserId);

  assert.equal(result.approval.routed_to_user_id, toUserId);
  assert.equal((await approvals.findById(seeded.id))?.routedToUserId, toUserId);
  assert.equal(bus.events.some((event) => event.type === "permission.reassigned"), true);
});

test("delegate fails closed before membership or side effects when the active-user directory capability is absent", async () => {
  const approvals = new MemoryApprovals();
  const auditLogs = new MemoryAuditLogs();
  const policies = new MemoryPolicies();
  const bus = new RecordingBus();
  const notificationCalls: unknown[] = [];
  const targetUserId = "10000000-0000-4000-8000-0000000000d5";
  let membershipCalls = 0;
  let workItemCalls = 0;
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-0000000000d5",
    routedToUserId: approverId
  });
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies,
    bus,
    memberships: {
      findActiveForUserWorkspace: async (id, targetWorkspaceId) => {
        membershipCalls += 1;
        return id === targetUserId && targetWorkspaceId === workspaceId
          ? ({ id: `membership-${id}`, userId: id, workspaceId } as never)
          : null;
      }
    },
    workItems: {
      findWorkItemAccessRecord: async () => {
        workItemCalls += 1;
        return {
          id: seeded.workItemId!,
          status: "in_review",
          submitterUserId: userId,
          claimedByUserId: null,
          workspaceId,
          project: {
            id: "70000000-0000-4000-8000-0000000000d5",
            workspaceId,
            orgId,
            ownerUserId: targetUserId,
            archived: false,
            deletedAt: null
          },
          assignments: []
        } as never;
      }
    },
    notifications: recordingDelegateNotifications(notificationCalls),
    now: () => now
  });

  await assert.rejects(
    () => service.delegate(seeded.id, actor, targetUserId),
    (error) => error instanceof ApprovalServiceError
      && error.status === 503
      && error.code === "delegate_user_directory_unavailable"
  );

  assert.equal(membershipCalls, 0);
  assert.equal(workItemCalls, 0);
  assert.equal((await approvals.findById(seeded.id))?.routedToUserId, approverId);
  assert.equal(auditLogs.rows.some((entry) => entry.action === "approval.delegated"), false);
  assert.deepEqual(notificationCalls, []);
  assert.deepEqual(bus.events, []);
});

test("delegate rejects a soft-deleted target before membership even when an active membership remains", async () => {
  const approvals = new MemoryApprovals();
  const auditLogs = new MemoryAuditLogs();
  const policies = new MemoryPolicies();
  const bus = new RecordingBus();
  const notificationCalls: unknown[] = [];
  const targetUserId = "10000000-0000-4000-8000-0000000000d6";
  let membershipCalls = 0;
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-0000000000d6",
    routedToUserId: approverId
  });
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies,
    bus,
    users: {
      // findActiveById excludes soft-deleted rows, so this target is absent from the active-user view.
      findActiveById: async () => null
    },
    memberships: {
      findActiveForUserWorkspace: async (id, targetWorkspaceId) => {
        membershipCalls += 1;
        return id === targetUserId && targetWorkspaceId === workspaceId
          ? ({ id: `membership-${id}`, userId: id, workspaceId } as never)
          : null;
      }
    },
    notifications: recordingDelegateNotifications(notificationCalls),
    now: () => now
  });

  await assert.rejects(
    () => service.delegate(seeded.id, actor, targetUserId),
    (error) => error instanceof ApprovalServiceError
      && error.status === 404
      && error.code === "delegate_target_not_found"
  );

  assert.equal(membershipCalls, 0);
  assert.equal((await approvals.findById(seeded.id))?.routedToUserId, approverId);
  assert.equal(auditLogs.rows.some((entry) => entry.action === "approval.delegated"), false);
  assert.deepEqual(notificationCalls, []);
  assert.deepEqual(bus.events, []);
});

test("delegate propagates an active-user lookup failure before mutation or side effects", async () => {
  const approvals = new MemoryApprovals();
  const auditLogs = new MemoryAuditLogs();
  const policies = new MemoryPolicies();
  const bus = new RecordingBus();
  const notificationCalls: unknown[] = [];
  const targetUserId = "10000000-0000-4000-8000-0000000000d7";
  const lookupError = new Error("active-user repository unavailable");
  let membershipCalls = 0;
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-0000000000d7",
    routedToUserId: approverId
  });
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies,
    bus,
    users: {
      findActiveById: async () => {
        throw lookupError;
      }
    },
    memberships: {
      findActiveForUserWorkspace: async (id, targetWorkspaceId) => {
        membershipCalls += 1;
        return id === targetUserId && targetWorkspaceId === workspaceId
          ? ({ id: `membership-${id}`, userId: id, workspaceId } as never)
          : null;
      }
    },
    notifications: recordingDelegateNotifications(notificationCalls),
    now: () => now
  });

  await assert.rejects(
    () => service.delegate(seeded.id, actor, targetUserId),
    (error) => error === lookupError
  );

  assert.equal(membershipCalls, 0);
  assert.equal((await approvals.findById(seeded.id))?.routedToUserId, approverId);
  assert.equal(auditLogs.rows.some((entry) => entry.action === "approval.delegated"), false);
  assert.deepEqual(notificationCalls, []);
  assert.deepEqual(bus.events, []);
});

test("delegate rejects an active user without an actor-workspace membership before mutation or side effects", async () => {
  const approvals = new MemoryApprovals();
  const auditLogs = new MemoryAuditLogs();
  const policies = new MemoryPolicies();
  const bus = new RecordingBus();
  const notificationCalls: unknown[] = [];
  const targetUserId = "10000000-0000-4000-8000-0000000000d3";
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-0000000000d3",
    routedToUserId: approverId
  });
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies,
    bus,
    users: {
      findActiveById: async (id) => id === targetUserId ? user({ id }) : null
    },
    memberships: {
      findActiveForUserWorkspace: async () => null
    },
    workItems: {
      findWorkItemAccessRecord: async () => ({
        id: seeded.workItemId!,
        status: "in_review",
        submitterUserId: userId,
        claimedByUserId: null,
        workspaceId,
        project: {
          id: "70000000-0000-4000-8000-0000000000d3",
          workspaceId,
          orgId,
          ownerUserId: userId,
          archived: false,
          deletedAt: null
        },
        assignments: []
      }) as never
    },
    notifications: {
      createMentionNotification: async () => undefined as never,
      createNotification: async (input) => {
        notificationCalls.push(input);
        return undefined as never;
      },
      archiveByDedupeKey: async () => 0
    },
    now: () => now
  });

  await assert.rejects(
    () => service.delegate(seeded.id, actor, targetUserId),
    (error) => error instanceof ApprovalServiceError
      && error.status === 404
      && error.code === "delegate_target_not_found"
  );

  assert.equal((await approvals.findById(seeded.id))?.routedToUserId, approverId);
  assert.equal(auditLogs.rows.some((entry) => entry.action === "approval.delegated"), false);
  assert.deepEqual(bus.events, []);
  assert.deepEqual(notificationCalls, []);
});

test("delegate returns membership unavailable before mutation or side effects when the capability is absent", async () => {
  const approvals = new MemoryApprovals();
  const auditLogs = new MemoryAuditLogs();
  const policies = new MemoryPolicies();
  const bus = new RecordingBus();
  const targetUserId = "10000000-0000-4000-8000-0000000000d4";
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-0000000000d4",
    routedToUserId: approverId
  });
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies,
    bus,
    users: {
      findActiveById: async (id) => id === targetUserId ? user({ id }) : null
    },
    memberships: false,
    now: () => now
  });

  await assert.rejects(
    () => service.delegate(seeded.id, actor, targetUserId),
    (error) => error instanceof ApprovalServiceError
      && error.status === 503
      && error.code === "delegate_membership_unavailable"
  );

  assert.equal((await approvals.findById(seeded.id))?.routedToUserId, approverId);
  assert.equal(auditLogs.rows.some((entry) => entry.action === "approval.delegated"), false);
  assert.deepEqual(bus.events, []);
});

test("delegate rejects a target without actor-workspace membership even when the work item is otherwise visible", async () => {
  const approvals = new MemoryApprovals();
  const auditLogs = new MemoryAuditLogs();
  const policyRepo = new MemoryPolicies();
  const bus = new RecordingBus();
  const targetUserId = "10000000-0000-4000-8000-0000000000d3";
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies: policyRepo,
    bus,
    users: {
      findActiveById: async (id) => id === targetUserId ? user({ id }) : null
    },
    memberships: {
      findActiveForUserWorkspace: async () => null
    },
    workItems: {
      findWorkItemAccessRecord: async () => ({
        id: "50000000-0000-4000-8000-0000000000d3",
        status: "in_review",
        submitterUserId: "10000000-0000-4000-8000-0000000000ee",
        claimedByUserId: null,
        workspaceId,
        project: {
          id: "70000000-0000-4000-8000-0000000000d3",
          workspaceId,
          orgId,
          ownerUserId: targetUserId,
          archived: false,
          deletedAt: null
        },
        assignments: []
      }) as never
    },
    now: () => now
  });
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-0000000000d3",
    routedToUserId: approverId
  });

  await assert.rejects(
    () => service.delegate(seeded.id, actor, targetUserId),
    (error) => error instanceof ApprovalServiceError &&
      error.status === 404 &&
      error.code === "delegate_target_not_found"
  );
  assert.equal((await approvals.findById(seeded.id))?.routedToUserId, approverId);
});

test("findings[#27] respondPending CAS rejects a stale decision after the request was delegated away (TOCTOU)", async () => {
  const approvals = new MemoryApprovals();
  const userA = approverId;
  const userB = "10000000-0000-4000-8000-000000000003";
  const req = await approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-000000000001",
    routedToUserId: userA
  });
  // 交错：respond() 读快照(路由给 A)、按快照鉴权后，与原子更新之间单据被 delegatePending 改派给 B（仍 pending）。
  await approvals.delegatePending(req.id, userB, now);
  // 非 admin 决策须复核路由人仍是本人：A 已不是路由人 → 原子匹配 0 行 → null → 服务层抛 409 approval_race。
  const blocked = await approvals.respondPending(req.id, "allow", userA, null, now, userA);
  assert.equal(blocked, null);
  const still = await approvals.findById(req.id);
  assert.equal(still?.status, "pending");
  assert.equal(still?.routedToUserId, userB);
  // 现路由人 B（或 admin override 传 undefined）可正常决策。
  const ok = await approvals.respondPending(req.id, "allow", userB, null, now, userB);
  assert.equal(ok?.status, "approved");
});

test("findings[#172] delegatePending CAS rejects stale delegation after the request was rerouted (TOCTOU)", async () => {
  const userB = "10000000-0000-4000-8000-000000000003";
  const userC = "10000000-0000-4000-8000-000000000004";
  const approvals = new RacingDelegateApprovals(userB);
  const policyRepo = new MemoryPolicies();
  const auditLogs = new MemoryAuditLogs();
  const bus = new RecordingBus();
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies: policyRepo,
    bus,
    ...eligibleDelegate([userB, userC]),
    now: () => now
  });
  const req = await approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-000000000001",
    routedToUserId: approverId
  });

  await assert.rejects(
    service.delegate(req.id, actor, userC),
    (error: unknown) =>
      error instanceof ApprovalServiceError
      && error.status === 409
      && error.code === "approval_race"
  );
  const still = await approvals.findById(req.id);
  assert.equal(still?.status, "pending");
  assert.equal(still?.routedToUserId, userB);
  assert.equal(still?.delegatedToUserId, userB);
  assert.equal(auditLogs.rows.some((entry) => entry.action === "approval.delegated"), false);
  assert.equal(bus.events.some((event) => event.type === "permission.reassigned"), false);
});

test("SLA expiry never auto-allows approvals and emits private expiration events", async () => {
  const deps = serviceDeps();
  const dueTool = await deps.approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    agentRunId: "60000000-0000-4000-8000-000000000001",
    workItemId: "50000000-0000-4000-8000-000000000001",
    routedToUserId: approverId,
    slaDueAt: new Date("2026-06-04T23:59:00.000Z"),
    payloadJson: {
      ui: {
        summary_text: "AI 想修改交付包，需要你确认。",
        risk: { level: "medium", human_label: "可回滚" }
      },
      raw_args: {}
    }
  });
  const futureTool = await deps.approvals.createApprovalRequest({
    actionPattern: "tool.delete_file",
    agentRunId: "60000000-0000-4000-8000-000000000002",
    workItemId: "50000000-0000-4000-8000-000000000001",
    routedToUserId: approverId,
    slaDueAt: new Date("2026-06-05T00:10:00.000Z")
  });

  const expired = await deps.service.expireDueApprovals();

  assert.equal(expired.length, 1);
  assert.equal(expired[0]?.approval.id, dueTool.id);
  assert.equal(expired[0]?.approval.status, "expired");
  assert.equal(expired[0]?.next_action, "escalate_pm");
  assert.equal(expired[0]?.escalated, true);
  assert.equal(dueTool.status, "expired");
  assert.equal(dueTool.decidedByUserId, null);
  assert.equal(futureTool.status, "pending");
  assert.equal(deps.bus.events.some((event) => event.topic === "all"), false);
  assert.deepEqual(
    deps.bus.events.map((event) => [event.topic, event.type]).sort(),
    [
      [`session:${dueTool.workItemId}`, "permission.expired"],
      [`user:${approverId}`, "permission.expired"],
      [`workitem:${dueTool.workItemId}`, "permission.expired"]
    ].sort()
  );
  assert.equal((deps.bus.events[0]?.data as { escalated?: boolean }).escalated, true);
});

test("proposal expiry asks for reviewer follow-up instead of merging", async () => {
  const deps = serviceDeps();
  const proposal = await deps.approvals.createApprovalRequest({
    actionPattern: "proposal.review",
    workItemId: "50000000-0000-4000-8000-000000000001",
    routedToUserId: approverId,
    slaDueAt: new Date("2026-06-04T23:59:00.000Z")
  });

  const expired = await deps.service.expireDueApprovals();

  assert.equal(expired.length, 1);
  assert.equal(expired[0]?.approval.id, proposal.id);
  assert.equal(expired[0]?.approval.status, "expired");
  assert.equal(expired[0]?.next_action, "notify_reviewer");
  assert.equal(expired[0]?.escalated, false);
  assert.equal(proposal.decidedByUserId, null);
  assert.deepEqual(
    deps.bus.events.map((event) => [event.topic, event.type]).sort(),
    [
      // findings[#169]：有 workItemId 的审批过期也发到会话频道 session:<workItemId>（会话流订阅处）。
      [`session:${proposal.workItemId}`, "permission.expired"],
      [`user:${approverId}`, "permission.expired"],
      [`workitem:${proposal.workItemId}`, "permission.expired"]
    ].sort()
  );
});

class MemoryUsers implements UserRepository {
  constructor(private rows: UserAuthRow[]) {}

  async findActiveById(id: string) {
    return this.rows.find((candidate) => candidate.id === id && candidate.deletedAt === null) ?? null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return this.rows.find((candidate) => candidate.cookieToken === cookieToken && candidate.deletedAt === null) ?? null;
  }

  async findActiveByNickname() {
    return null;
  }

  async createUser(): Promise<UserAuthRow> {
    throw new Error("not needed");
  }

  async getOrCreateActiveByNickname(): Promise<{ user: UserAuthRow; created: boolean }> {
    throw new Error("not needed");
  }

  async rotateCookieToken() {
    return null;
  }
}

class MemoryDevices implements ClientDeviceRepository {
  constructor(private rows: ClientDeviceAuthRow[] = []) {}

  async findActiveByTokenHash(tokenHash: string) {
    return this.rows.find((row) => row.clientTokenHash === tokenHash && row.revokedAt === null) ?? null;
  }

  async findActiveByTokenHashForUser(tokenHash: string, targetUserId: string) {
    return this.rows.find(
      (row) => row.clientTokenHash === tokenHash && row.userId === targetUserId && row.revokedAt === null
    ) ?? null;
  }

  async createClientDevice(): Promise<ClientDeviceAuthRow> {
    throw new Error("not needed");
  }

  async listByUser() {
    return [];
  }

  async touchLastSeen(deviceId: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === deviceId) ?? null;
    if (!row) {
      return null;
    }
    row.lastSeenAt = at;
    return row;
  }

  async revokeByIdForUser() {
    return null;
  }

  async revokeByTokenHash() {
    return null;
  }
}

function settings(): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret"
  });
}

function authDeps(runtimeSettings: Settings, devices: ClientDeviceAuthRow[] = []): AuthDependencies {
  return {
    users: new MemoryUsers([user({ isAdmin: true })]),
    devices: new MemoryDevices(devices),
    settings: runtimeSettings,
    now: () => now
  };
}

function nonAdminAuthDeps(runtimeSettings: Settings, devices: ClientDeviceAuthRow[] = []): AuthDependencies {
  return {
    users: new MemoryUsers([user({ isAdmin: false })]),
    devices: new MemoryDevices(devices),
    settings: runtimeSettings,
    now: () => now
  };
}

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
    }
    if (error instanceof WorkItemServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof ApprovalServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    throw error;
  });
  return app;
}

// routes-a-2/routes-b-1/services-a-2/xlink-authz-4/ux-web-govern-6：可见性判定改用轻量批量接口
// canReadWorkItems（一次 IN 查询 access record）取代逐次 detailPage 整页装配——这两个夹具原先靠
// detailPage 成功/抛 403 来模拟可见/不可见，现在直接控制批量返回的 Set 即可，语义不变。
function allowingWorkItems(): Pick<WorkItemService, "canReadWorkItems"> {
  return {
    async canReadWorkItems(input) {
      return new Set(input.workItemIds);
    }
  };
}

function denyingWorkItems(): Pick<WorkItemService, "canReadWorkItems"> {
  return {
    async canReadWorkItems() {
      return new Set();
    }
  };
}

test("approval routes filter and block requests whose work item is not visible", async () => {
  const runtimeSettings = settings();
  const deps = serviceDeps();
  const visibleWithoutWorkItem = await deps.approvals.createApprovalRequest({
    actionPattern: "tool.inspect",
    routedToUserId: userId
  });
  const hiddenWorkItemApproval = await deps.approvals.createApprovalRequest({
    id: "40000000-0000-4000-8000-000000000777",
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-000000000777",
    routedToUserId: approverId
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/approvals", createApprovalRoutes({
    auth: authDeps(runtimeSettings),
    service: deps.service,
    workItems: denyingWorkItems()
  }));
  const headers = {
    "Content-Type": "application/json",
    Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
  };

  const list = await app.request("/api/approvals", { headers });
  const listBody = await list.json() as {
    data: {
      requests: Array<{ id: string }>;
      counts: { pending: number; pending_total: number };
      page_info?: { has_more: boolean };
    };
  };
  const respond = await app.request(`/api/approvals/${hiddenWorkItemApproval.id}/respond`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "allow", remember: "once" })
  });
  const delegate = await app.request(`/api/approvals/${hiddenWorkItemApproval.id}/delegate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ to_user_id: "10000000-0000-4000-8000-000000000003" })
  });

  assert.equal(list.status, 200);
  assert.deepEqual(listBody.data.requests.map((request) => request.id), [visibleWithoutWorkItem.id]);
  assert.equal(listBody.data.counts.pending, 1);
  assert.equal(listBody.data.counts.pending_total, 1);
  assert.equal(listBody.data.page_info?.has_more, false);
  assert.equal(respond.status, 403);
  assert.equal(delegate.status, 403);

  const allowedApp = withErrors(new Hono<AuthEnv>());
  allowedApp.route("/api/approvals", createApprovalRoutes({
    auth: authDeps(runtimeSettings),
    service: deps.service,
    workItems: allowingWorkItems()
  }));
  const allowed = await allowedApp.request(`/api/approvals/${hiddenWorkItemApproval.id}/respond`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "allow", remember: "once" })
  });

  assert.equal(allowed.status, 200);
});

test("approval routes keep work-item-less approvals in the routed user's inbox even for admins", async () => {
  const runtimeSettings = settings();
  const deps = serviceDeps();
  const adminOwnApproval = await deps.approvals.createApprovalRequest({
    id: "40000000-0000-4000-8000-000000000781",
    actionPattern: "tool.inspect",
    routedToUserId: userId
  });
  const otherUserApproval = await deps.approvals.createApprovalRequest({
    id: "40000000-0000-4000-8000-000000000782",
    actionPattern: "tool.shell.approve",
    routedToUserId: approverId
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/approvals", createApprovalRoutes({
    auth: authDeps(runtimeSettings),
    service: deps.service,
    workItems: allowingWorkItems()
  }));
  const headers = {
    "Content-Type": "application/json",
    Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
  };

  const list = await app.request("/api/approvals", { headers });
  const listBody = await list.json() as {
    data: {
      requests: Array<{ id: string }>;
      counts: { pending: number; pending_total: number };
    };
  };
  const respond = await app.request(`/api/approvals/${otherUserApproval.id}/respond`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "allow", remember: "once" })
  });

  assert.equal(list.status, 200);
  assert.deepEqual(listBody.data.requests.map((request) => request.id), [adminOwnApproval.id]);
  assert.equal(listBody.data.counts.pending, 1);
  assert.equal(listBody.data.counts.pending_total, 1);
  assert.equal(respond.status, 403);
  assert.equal((await deps.approvals.findById(otherUserApproval.id))?.status, "pending");
});

test("API-08 respond-batch returns the global error envelope when no approvals are selected", async () => {
  const runtimeSettings = settings();
  const deps = serviceDeps();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/approvals", createApprovalRoutes({
    auth: authDeps(runtimeSettings),
    service: deps.service,
    workItems: allowingWorkItems()
  }));
  const headers = {
    "Content-Type": "application/json",
    Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
  };

  const response = await app.request("/api/approvals/respond-batch", {
    method: "POST",
    headers,
    body: JSON.stringify({ ids: [] })
  });

  assert.equal(response.status, 422);
  const body = await response.json() as {
    ok: false;
    code?: string;
    error?: { code: string; message: string };
  };
  // 全局信封：{ ok:false, error:{ code, message } }，不是顶层 code/message。
  assert.equal(body.code, undefined);
  assert.equal(body.error?.code, "field_value_required");
  assert.match(body.error?.message ?? "", /至少勾选一条/u);
});

test("approval routes paginate after filtering hidden work item approvals", async () => {
  const runtimeSettings = settings();
  const deps = serviceDeps();
  for (let index = 0; index < 101; index += 1) {
    await deps.approvals.createApprovalRequest({
      id: `40000000-0000-4000-8000-${String(800 + index).padStart(12, "0")}`,
      actionPattern: "tool.write_file",
      workItemId: `50000000-0000-4000-8000-${String(800 + index).padStart(12, "0")}`,
      routedToUserId: approverId
    });
  }
  const visibleWithoutWorkItem = await deps.approvals.createApprovalRequest({
    id: "40000000-0000-4000-8000-000000000999",
    actionPattern: "tool.inspect",
    routedToUserId: userId
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/approvals", createApprovalRoutes({
    auth: authDeps(runtimeSettings),
    service: deps.service,
    workItems: denyingWorkItems()
  }));

  const list = await app.request("/api/approvals", {
    headers: {
      "Content-Type": "application/json",
      Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
    }
  });
  const listBody = await list.json() as {
    data: {
      requests: Array<{ id: string }>;
      counts: { pending: number; pending_total: number };
      page_info?: { returned: number; has_more: boolean };
    };
  };

  assert.equal(list.status, 200);
  assert.deepEqual(listBody.data.requests.map((request) => request.id), [visibleWithoutWorkItem.id]);
  assert.equal(listBody.data.counts.pending, 1);
  assert.equal(listBody.data.counts.pending_total, 1);
  assert.equal(listBody.data.page_info?.returned, 1);
  assert.equal(listBody.data.page_info?.has_more, false);
});

test("routes-b-1/xlink-authz-4: GET /api/approvals judges each work item once and does not re-check rows the service already filtered", async () => {
  const runtimeSettings = settings();
  const deps = serviceDeps();
  const sharedWorkItemId = "50000000-0000-4000-8000-000000000bb1";
  for (let index = 0; index < 4; index += 1) {
    await deps.approvals.createApprovalRequest({
      id: `40000000-0000-4000-8000-${String(900 + index).padStart(12, "0")}`,
      actionPattern: "tool.write_file",
      workItemId: sharedWorkItemId,
      routedToUserId: userId
    });
  }
  let canReadWorkItemsCalls = 0;
  const seenIds: string[][] = [];
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/approvals", createApprovalRoutes({
    auth: authDeps(runtimeSettings),
    service: deps.service,
    workItems: {
      async canReadWorkItems(input) {
        canReadWorkItemsCalls += 1;
        seenIds.push(input.workItemIds);
        return new Set(input.workItemIds);
      }
    }
  }));

  const list = await app.request("/api/approvals", {
    headers: {
      "Content-Type": "application/json",
      Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
    }
  });
  const listBody = await list.json() as { data: { requests: Array<{ id: string }> } };

  assert.equal(list.status, 200);
  assert.equal(listBody.data.requests.length, 4);
  // 服务层扫描时按 workItemId 去重，只应该调用一次 canReadWorkItems（batch 里只含这一个 workItemId）——
  // 而不是每条审批各调一次（旧行为 4 次），也不该在路由层 visibleApprovalCenter 里再重复一遍（旧行为共 8 次）。
  assert.equal(canReadWorkItemsCalls, 1);
  assert.deepEqual(seenIds[0], [sharedWorkItemId]);
});

test("approval respond and delegate check action ownership before body schema", async () => {
  const runtimeSettings = settings();
  const deps = serviceDeps();
  const routedElsewhere = await deps.approvals.createApprovalRequest({
    id: "40000000-0000-4000-8000-000000000778",
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-000000000778",
    routedToUserId: approverId
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/approvals", createApprovalRoutes({
    auth: nonAdminAuthDeps(runtimeSettings),
    service: deps.service,
    workItems: allowingWorkItems()
  }));
  const headers = {
    "Content-Type": "application/json",
    Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
  };

  const respond = await app.request(`/api/approvals/${routedElsewhere.id}/respond`, {
    method: "POST",
    headers,
    body: JSON.stringify({ remember: "once" })
  });
  const delegate = await app.request(`/api/approvals/${routedElsewhere.id}/delegate`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });

  assert.equal(respond.status, 403);
  assert.equal(delegate.status, 403);
});

test("permission policy writes keep the local-client device gate", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/permissions", createPermissionRoutes({ auth: authDeps(runtimeSettings), service: serviceDeps().service }));

  const response = await app.request("/api/permissions", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
    },
    body: JSON.stringify({
      scope_kind: "org",
      scope_id: orgId,
      action_pattern: "tool.*",
      effect: "ask"
    })
  });

  assert.equal(response.status, 403);
});

test("permission policy reads are admin-only (non-admin gets 403)", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/permissions", createPermissionRoutes({ auth: nonAdminAuthDeps(runtimeSettings), service: serviceDeps().service }));

  const response = await app.request("/api/permissions", {
    headers: { Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret) }
  });

  assert.equal(response.status, 403);
});

test("permission policy reads succeed for an admin", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/permissions", createPermissionRoutes({ auth: authDeps(runtimeSettings), service: serviceDeps().service }));

  const response = await app.request("/api/permissions", {
    headers: { Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret) }
  });

  assert.equal(response.status, 200);
});

test("permission policy reads return snake_case API records", async () => {
  const runtimeSettings = settings();
  const policyId = "70000000-0000-4000-8000-0000000000e1";
  const deps = serviceDeps([{
    id: policyId,
    scopeKind: "workspace",
    scopeId: workspaceId,
    actionPattern: "tool.write_file",
    effect: "ask",
    priority: 4,
    learnedFromSession: true,
    createdByUserId: approverId,
    orgId,
    workspaceId,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  }]);
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/permissions", createPermissionRoutes({ auth: authDeps(runtimeSettings), service: deps.service }));

  const response = await app.request("/api/permissions", {
    headers: { Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret) }
  });
  const body = await response.json() as { data: Array<Record<string, unknown>> };
  const policy = body.data[0]!;

  assert.equal(response.status, 200);
  assert.equal(policy.id, policyId);
  assert.equal(policy.scope_kind, "workspace");
  assert.equal(policy.scope_id, workspaceId);
  assert.equal(policy.action_pattern, "tool.write_file");
  assert.equal(policy.effect, "ask");
  assert.equal(policy.priority, 4);
  assert.equal(policy.learned_from_session, true);
  assert.equal(policy.created_by_user_id, approverId);
  assert.equal(policy.org_id, orgId);
  assert.equal(policy.workspace_id, workspaceId);
  assert.equal(policy.deleted_at, null);
  assert.equal(policy.created_at, now.toISOString());
  assert.equal(policy.updated_at, now.toISOString());
  assert.equal(policy.scopeKind, undefined);
  assert.equal(policy.scopeId, undefined);
  assert.equal(policy.actionPattern, undefined);
  assert.equal(policy.learnedFromSession, undefined);
});

test("approval respond learned_policy returns snake_case API records", async () => {
  const runtimeSettings = settings();
  const deps = serviceDeps();
  const approval = await deps.approvals.createApprovalRequest({
    id: "40000000-0000-4000-8000-0000000000e2",
    actionPattern: "tool.write_file",
    routedToUserId: userId
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/approvals", createApprovalRoutes({ auth: authDeps(runtimeSettings), service: deps.service }));

  const response = await app.request(`/api/approvals/${approval.id}/respond`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
    },
    body: JSON.stringify({ decision: "allow", remember: "always" })
  });
  const body = await response.json() as { data: { learned_policy?: Record<string, unknown> } };
  const policy = body.data.learned_policy!;

  assert.equal(response.status, 200);
  assert.equal(policy.scope_kind, "session");
  assert.equal(policy.scope_id, userId);
  assert.equal(policy.action_pattern, "tool.write_file");
  assert.equal(policy.effect, "allow");
  assert.equal(policy.priority, 0);
  assert.equal(policy.learned_from_session, true);
  assert.equal(policy.created_by_user_id, userId);
  assert.equal(policy.org_id, orgId);
  assert.equal(policy.workspace_id, workspaceId);
  assert.equal(policy.deleted_at, null);
  assert.equal(policy.created_at, now.toISOString());
  assert.equal(policy.updated_at, now.toISOString());
  assert.equal(policy.scopeKind, undefined);
  assert.equal(policy.scopeId, undefined);
  assert.equal(policy.actionPattern, undefined);
  assert.equal(policy.learnedFromSession, undefined);
});

test("permission policy delete rejects malformed ids before calling the service", async () => {
  const runtimeSettings = settings();
  const calls: string[] = [];
  const service = {
    async listPolicies() {
      return [];
    },
    async createPolicy() {
      throw new Error("not needed");
    },
    async revokePolicy(_actor: unknown, id: string) {
      calls.push(id);
      return {
        id: "70000000-0000-4000-8000-0000000000d1",
        scope_kind: "org",
        scope_id: orgId,
        action_pattern: "tool.*",
        effect: "ask",
        priority: 0,
        learned_from_session: false,
        created_at: now.toISOString(),
        updated_at: now.toISOString()
      };
    }
  } as unknown as ApprovalService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/permissions", createPermissionRoutes({
    auth: authDeps(runtimeSettings, [device()]),
    service
  }));

  const response = await app.request("/api/permissions/not-a-policy", {
    method: "DELETE",
    headers: {
      "X-WorkHub-Client-Token": "client-token-alice",
      Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
    }
  });

  assert.equal(response.status, 404);
  assert.deepEqual(calls, []);
});

test("permission policy delete returns service 404s as client-visible 404 responses", async () => {
  const runtimeSettings = settings();
  const service = {
    async listPolicies() {
      return [];
    },
    async createPolicy() {
      throw new Error("not needed");
    },
    async revokePolicy() {
      throw new ApprovalServiceError(404, "permission_policy_not_found", "找不到这条权限策略。");
    }
  } as unknown as ApprovalService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/permissions", createPermissionRoutes({
    auth: authDeps(runtimeSettings, [device()]),
    service
  }));

  const response = await app.request("/api/permissions/70000000-0000-4000-8000-0000000000ff", {
    method: "DELETE",
    headers: {
      "X-WorkHub-Client-Token": "client-token-alice",
      Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
    }
  });
  const body = await response.json() as { ok: boolean; error?: { code?: string } };

  assert.equal(response.status, 404);
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, "permission_policy_not_found");
});

test("permission ask route rejects approvals for work items the caller cannot read", async () => {
  const runtimeSettings = settings();
  let createApprovalCalled = false;
  const service = {
    async listPolicies() {
      return [];
    },
    async createPolicy() {
      throw new Error("not needed");
    },
    async revokePolicy() {
      throw new Error("not needed");
    },
    async createApproval() {
      createApprovalCalled = true;
      throw new Error("createApproval must not be reached for an unreadable work item");
    }
  } as unknown as ApprovalService;
  const workItems = {
    detailPage: async () => {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限查看这个事项。");
    }
  } as unknown as WorkItemService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/permissions", createPermissionRoutes({
    auth: nonAdminAuthDeps(runtimeSettings),
    service,
    workItems
  }));

  const response = await app.request("/api/permissions/ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
    },
    body: JSON.stringify({
      kind: "tool",
      action_pattern: "tool.write_file",
      work_item_id: "50000000-0000-4000-8000-0000000000c5",
      routed_to_user_id: userId,
      payload_json: { raw_args: {} }
    })
  });

  assert.equal(response.status, 403);
  assert.equal(createApprovalCalled, false);
});

test("permission ask route preserves work item service error codes", async () => {
  const runtimeSettings = settings();
  let createApprovalCalled = false;
  const service = {
    async listPolicies() {
      return [];
    },
    async createPolicy() {
      throw new Error("not needed");
    },
    async revokePolicy() {
      throw new Error("not needed");
    },
    async createApproval() {
      createApprovalCalled = true;
      throw new Error("createApproval must not be reached when work item validation fails");
    }
  } as unknown as ApprovalService;
  const workItems = {
    detailPage: async () => {
      throw new WorkItemServiceError(409, "workitem_state_conflict", "这个事项当前状态不能申请审批。");
    }
  } as unknown as WorkItemService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/permissions", createPermissionRoutes({
    auth: nonAdminAuthDeps(runtimeSettings),
    service,
    workItems
  }));

  const response = await app.request("/api/permissions/ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
    },
    body: JSON.stringify({
      kind: "tool",
      action_pattern: "tool.write_file",
      work_item_id: "50000000-0000-4000-8000-0000000000c5",
      routed_to_user_id: userId,
      payload_json: { raw_args: {} }
    })
  });
  const body = await response.json() as { ok: false; error: { code: string; message: string } };

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "workitem_state_conflict");
  assert.equal(body.error.message, "这个事项当前状态不能申请审批。");
  assert.equal(createApprovalCalled, false);
});

test("permission ask route checks readable work item before unrelated body schema errors", async () => {
  const runtimeSettings = settings();
  let createApprovalCalled = false;
  const service = {
    async listPolicies() {
      return [];
    },
    async createPolicy() {
      throw new Error("not needed");
    },
    async revokePolicy() {
      throw new Error("not needed");
    },
    async createApproval() {
      createApprovalCalled = true;
      throw new Error("createApproval must not be reached for an unreadable work item");
    }
  } as unknown as ApprovalService;
  const workItems = {
    detailPage: async () => {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限查看这个事项。");
    }
  } as unknown as WorkItemService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/permissions", createPermissionRoutes({
    auth: nonAdminAuthDeps(runtimeSettings),
    service,
    workItems
  }));

  const response = await app.request("/api/permissions/ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
    },
    body: JSON.stringify({
      kind: "tool",
      work_item_id: "50000000-0000-4000-8000-0000000000c5",
      payload_json: { raw_args: {} }
    })
  });

  assert.equal(response.status, 403);
  assert.equal(createApprovalCalled, false);
});

test("permission ask route requires self-routing when no work item can prove recipient visibility", async () => {
  const runtimeSettings = settings();
  let createApprovalCalled = false;
  const service = {
    async listPolicies() {
      return [];
    },
    async createPolicy() {
      throw new Error("not needed");
    },
    async revokePolicy() {
      throw new Error("not needed");
    },
    async createApproval() {
      createApprovalCalled = true;
      throw new Error("createApproval must not be reached for cross-user work-item-less approvals");
    }
  } as unknown as ApprovalService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/permissions", createPermissionRoutes({
    auth: authDeps(runtimeSettings),
    service
  }));

  const response = await app.request("/api/permissions/ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
    },
    body: JSON.stringify({
      kind: "tool",
      action_pattern: "tool.shell.approve",
      routed_to_user_id: approverId,
      payload_json: { raw_args: { command: "cat private.txt" } }
    })
  });

  assert.equal(response.status, 403);
  assert.equal(createApprovalCalled, false);
});

test("permission ask route redacts matched policy internals from public allow decisions", async () => {
  const runtimeSettings = settings();
  const deps = serviceDeps([
    {
      id: "70000000-0000-4000-8000-0000000000a1",
      scopeKind: "workspace",
      scopeId: workspaceId,
      actionPattern: "tool.write_file",
      effect: "allow",
      priority: 7,
      learnedFromSession: true,
      createdAt: now,
      updatedAt: now,
      orgId,
      workspaceId
    }
  ]);
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/permissions", createPermissionRoutes({
    auth: nonAdminAuthDeps(runtimeSettings),
    service: deps.service
  }));

  const response = await app.request("/api/permissions/ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
    },
    body: JSON.stringify({
      kind: "tool",
      action_pattern: "tool.write_file",
      routed_to_user_id: userId,
      payload_json: { raw_args: {} }
    })
  });
  const body = await response.json() as {
    ok: true;
    data: {
      outcome: string;
      decision?: Record<string, unknown>;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(body.data.outcome, "allowed");
  assert.deepEqual(body.data.decision, {
    effect: "allow",
    action_pattern: "tool.write_file"
  });
});

test("L23 createPolicy emits a permission_policy.created audit", async () => {
  const deps = serviceDeps();
  const adminActor = { ...actor, isAdmin: true };
  const policy = await deps.service.createPolicy(adminActor, {
    scope_kind: "org",
    scope_id: orgId,
    action_pattern: "tool.delete_file",
    effect: "deny",
    priority: 0,
    learned_from_session: false
  });
  assert.equal(policy.effect, "deny");
  const audit = deps.auditLogs.rows.find((row) => row.action === "permission_policy.created");
  assert.ok(audit);
  assert.equal(audit?.entityType, "permission_policy");
  assert.equal((audit?.detailJson as Record<string, unknown> | undefined)?.action_pattern, "tool.delete_file");
});

test("permission policy allow creation fails closed when audit logging fails", async () => {
  const deps = serviceDeps();
  deps.auditLogs.createAuditLog = async () => {
    throw new Error("audit sink unavailable");
  };
  const adminActor = { ...actor, isAdmin: true };

  // Old assertion expected a committed allow policy even when the audit sink failed.
  // That was wrong: allow policies expand what AI may do, so missing audit evidence must
  // block the expansion instead of leaving an unaudited standing permission behind.
  await assert.rejects(
    () => deps.service.createPolicy(adminActor, {
      scope_kind: "workspace",
      scope_id: workspaceId,
      action_pattern: "tool.write_file",
      effect: "allow",
      priority: 0,
      learned_from_session: false
    }),
    /audit sink unavailable/u
  );
  assert.equal(deps.policyRepo.rows.length, 0);
});

test("permission policy list is scoped to the admin actor tenant", async () => {
  const currentPolicyId = "70000000-0000-4000-8000-0000000000c1";
  const legacyPolicyId = "70000000-0000-4000-8000-0000000000c2";
  const foreignPolicyId = "70000000-0000-4000-8000-0000000000c3";
  const deps = serviceDeps([
    {
      id: currentPolicyId,
      scopeKind: "workspace",
      scopeId: workspaceId,
      actionPattern: "tool.write_file",
      effect: "ask",
      priority: 0,
      learnedFromSession: false,
      orgId,
      workspaceId,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    },
    {
      id: legacyPolicyId,
      scopeKind: "org",
      scopeId: orgId,
      actionPattern: "tool.read_file",
      effect: "allow",
      priority: 0,
      learnedFromSession: false,
      orgId: null,
      workspaceId: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    },
    {
      id: foreignPolicyId,
      scopeKind: "workspace",
      scopeId: "99990000-0000-4000-8000-000000000001",
      actionPattern: "tool.delete_file",
      effect: "deny",
      priority: 0,
      learnedFromSession: false,
      orgId,
      workspaceId: "99990000-0000-4000-8000-000000000001",
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    }
  ]);

  const visible = await deps.service.listPolicies({ ...actor, isAdmin: true });

  assert.deepEqual(visible.map((policy) => policy.id), [currentPolicyId, legacyPolicyId]);
});

test("permission policy creation rejects org or workspace scopes outside the admin tenant", async () => {
  const deps = serviceDeps();
  const adminActor = { ...actor, isAdmin: true };

  await assert.rejects(
    () => deps.service.createPolicy(adminActor, {
      scope_kind: "workspace",
      scope_id: "99990000-0000-4000-8000-000000000001",
      action_pattern: "tool.write_file",
      effect: "allow",
      priority: 0,
      learned_from_session: false
    }),
    (error: unknown) => error instanceof ApprovalServiceError && error.status === 403
  );

  await assert.rejects(
    () => deps.service.createPolicy(adminActor, {
      scope_kind: "org",
      scope_id: "99990000-0000-4000-8000-000000000002",
      action_pattern: "tool.write_file",
      effect: "allow",
      priority: 0,
      learned_from_session: false
    }),
    (error: unknown) => error instanceof ApprovalServiceError && error.status === 403
  );

  assert.deepEqual(deps.policyRepo.rows, []);
  assert.deepEqual(deps.auditLogs.rows, []);
});

test("permission policy creation reuses an equivalent active policy instead of duplicating it", async () => {
  const existingId = "70000000-0000-4000-8000-0000000000d0";
  const deps = serviceDeps([{
    id: existingId,
    scopeKind: "workspace",
    scopeId: workspaceId,
    actionPattern: "tool.write_file",
    effect: "allow",
    priority: 0,
    learnedFromSession: false,
    createdByUserId: approverId,
    orgId,
    workspaceId,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  }]);
  const adminActor = { ...actor, isAdmin: true };

  const created = await deps.service.createPolicy(adminActor, {
    scope_kind: "workspace",
    scope_id: workspaceId,
    action_pattern: "tool.write_file",
    effect: "allow",
    priority: 0,
    learned_from_session: true
  });

  assert.equal(created.id, existingId);
  assert.equal(deps.policyRepo.rows.length, 1);
});

test("M24 revokePolicy soft-deletes a policy and audits it; admin-only; 404 on unknown", async () => {
  const policyId = "70000000-0000-4000-8000-0000000000d1";
  const seeded: PermissionPolicyRecord[] = [{
    id: policyId,
    scopeKind: "session",
    scopeId: "session-xyz",
    actionPattern: "tool.delete_file",
    effect: "allow",
    priority: 0,
    learnedFromSession: true,
    createdByUserId: approverId,
    orgId,
    workspaceId,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  }];
  const deps = serviceDeps(seeded);
  const adminActor = { ...actor, isAdmin: true };

  // 非 admin 撤销被拒。
  await assert.rejects(
    () => deps.service.revokePolicy(actor, policyId),
    (error: unknown) => error instanceof ApprovalServiceError && error.status === 403
  );

  // admin 撤销成功：软删 + 从 active 列表消失 + 写审计。
  const revoked = await deps.service.revokePolicy(adminActor, policyId);
  assert.ok(revoked.deletedAt);
  assert.equal((await deps.service.listPolicies()).length, 0);
  const audit = deps.auditLogs.rows.find((row) => row.action === "permission_policy.revoked");
  assert.equal(audit?.entityId, policyId);
  assert.equal(audit?.entityType, "permission_policy");

  // 未知 id → 404。
  await assert.rejects(
    () => deps.service.revokePolicy(adminActor, "70000000-0000-4000-8000-0000000000ff"),
    (error: unknown) => error instanceof ApprovalServiceError && error.status === 404
  );
});

test("revokePolicy removes equivalent duplicate active policies left by older remember-always retries", async () => {
  const policyId = "70000000-0000-4000-8000-0000000000d2";
  const duplicateId = "70000000-0000-4000-8000-0000000000d3";
  const deps = serviceDeps([
    {
      id: policyId,
      scopeKind: "session",
      scopeId: actor.id,
      actionPattern: "tool.write_file",
      effect: "allow",
      priority: 0,
      learnedFromSession: true,
      createdByUserId: approverId,
      orgId,
      workspaceId,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    },
    {
      id: duplicateId,
      scopeKind: "session",
      scopeId: actor.id,
      actionPattern: "tool.write_file",
      effect: "allow",
      priority: 0,
      learnedFromSession: true,
      createdByUserId: approverId,
      orgId,
      workspaceId,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    }
  ]);
  const adminActor = { ...actor, isAdmin: true };

  const revoked = await deps.service.revokePolicy(adminActor, policyId);

  assert.equal(revoked.id, policyId);
  assert.deepEqual((await deps.service.listPolicies(adminActor)).map((policy) => policy.id), []);
  assert.deepEqual(
    deps.policyRepo.rows.map((policy) => [policy.id, Boolean(policy.deletedAt)]),
    [[policyId, true], [duplicateId, true]]
  );
});

test("W2 listPendingForUser builds items_detail: deliverable joins manifest, tool degrades, comments+timeline", async () => {
  const approvals = new MemoryApprovals();
  const manifest = deliverableManifestFixtures[0]!;
  const proposalId = "30000000-0000-4000-8000-000000000777";
  const deliverableRow = await approvals.createApprovalRequest({
    workItemId: "50000000-0000-4000-8000-000000000777",
    actionPattern: "proposal.review.weekly",
    routedToUserId: approverId,
    payloadJson: { raw_args: { proposal_id: proposalId } }
  });
  const toolRow = await approvals.createApprovalRequest({
    actionPattern: "tool.publish_external",
    routedToUserId: userId,
    payloadJson: { ui: { summary_text: "对外发布", affected_targets: ["公众号", "官网"] }, raw_args: {} }
  });

  const fakeProposal = {
    id: proposalId,
    work_item_id: "50000000-0000-4000-8000-000000000777",
    status: "opened",
    diff_manifest: manifest
  } as unknown as StoredProposal;
  const commentRow: ApprovalCommentRow = {
    id: "20000000-0000-4000-8000-0000000000c7",
    approvalId: deliverableRow.id,
    authorUserId: approverId,
    authorNickname: "李梅",
    body: "建议错峰执行。",
    createdAt: now,
    updatedAt: now
  };

  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    proposals: {
      get: async (id) => (id === proposalId ? fakeProposal : null),
      listByWorkItem: async () => []
    },
    approvalComments: {
      listByApproval: async (id) => (id === deliverableRow.id ? [commentRow] : []),
      listByApprovals: async (ids) => (ids.includes(deliverableRow.id) ? [commentRow] : []),
      create: async () => commentRow
    },
    now: () => now
  });

  const vm = await service.listPendingForUser(user({ isAdmin: true }));

  const deliverable = vm.items_detail[deliverableRow.id];
  assert.equal(deliverable?.kind, "deliverable");
  assert.equal(deliverable?.risk_label, manifest.risk.human_label);
  assert.equal(deliverable?.ai_reason, manifest.summary_md);
  assert.ok((deliverable?.manifest_changes.length ?? 0) > 0);
  assert.equal(deliverable?.proposal_href, `/proposals/${proposalId}`);
  assert.equal(deliverable?.timeline[0]?.kind, "created");
  assert.equal(deliverable?.timeline.some((step) => step.kind === "routed"), true);
  assert.equal(deliverable?.comments[0]?.author_label, "李梅");

  const tool = vm.items_detail[toolRow.id];
  assert.equal(tool?.kind, "tool");
  assert.deepEqual(tool?.affected_targets, ["公众号", "官网"]);
  assert.equal(tool?.manifest_changes.length, 0);
});

test("delegated pending approval timeline marks only delegated as current", async () => {
  const approvals = new MemoryApprovals();
  const delegated = await approvals.createApprovalRequest({
    actionPattern: "tool.publish_external",
    routedToUserId: userId,
    payloadJson: { raw_args: {} }
  });
  delegated.delegatedToUserId = userId;
  delegated.updatedAt = now;
  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    now: () => now
  });

  const vm = await service.listPendingForUser(user());
  const detail = vm.items_detail[delegated.id];
  const currentSteps = detail?.timeline.filter((step) => step.status === "current") ?? [];

  assert.deepEqual(currentSteps.map((step) => step.kind), ["delegated"]);
  assert.equal(detail?.timeline.find((step) => step.kind === "routed")?.status, "done");
});

test("W2 listPendingForUser shows the latest prefetched comments and exposes overflow", async () => {
  const approvals = new MemoryApprovals();
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "proposal.review.weekly",
    workItemId: "50000000-0000-4000-8000-000000000c20",
    routedToUserId: approverId
  });
  const comments: ApprovalCommentRow[] = Array.from({ length: 25 }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    approvalId: seeded.id,
    authorUserId: approverId,
    authorNickname: "审批人",
    body: `comment ${index + 1}`,
    createdAt: new Date(now.getTime() + index),
    updatedAt: new Date(now.getTime() + index)
  }));
  let seenLimit: number | undefined;
  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    approvalComments: {
      listByApproval: async () => comments,
      listByApprovals: async (_ids, limit) => {
        seenLimit = limit;
        return comments.slice(-(limit ?? comments.length));
      },
      create: async () => {
        throw new Error("not needed");
      }
    },
    now: () => now
  });

  const vm = await service.listPendingForUser(user({ isAdmin: true }));
  const detail = vm.items_detail[seeded.id];
  const pageInfo = detail?.comments_page_info;

  // Old assertion expected `comment 20` as the last visible row because prefetch kept the
  // oldest 20 comments. That was wrong: comment 21+ could be written successfully and then
  // disappear from the approval center. The center now asks for one extra latest row so it
  // can display a capped latest window and honestly report overflow.
  assert.equal(seenLimit, 21);
  assert.equal(detail?.comments.length, 20);
  assert.equal(detail?.comments[0]?.body, "comment 6");
  assert.equal(detail?.comments.at(-1)?.body, "comment 25");
  assert.deepEqual(pageInfo, { limit: 20, returned: 20, has_more: true });
});

test("W2 listPendingForUser exposes when the approval queue has more than the first page", async () => {
  const approvals = new MemoryApprovals();
  for (let index = 0; index < 101; index += 1) {
    await approvals.createApprovalRequest({
      actionPattern: "tool.publish_external",
      routedToUserId: userId,
      payloadJson: { raw_args: { index } }
    });
  }
  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    now: () => now
  });

  const vm = await service.listPendingForUser(user({ isAdmin: true }));
  const pageInfo = (vm as { page_info?: { has_more?: boolean; limit?: number; returned?: number } }).page_info;

  assert.equal(vm.requests.length, 100);
  assert.equal(vm.items.length, 100);
  assert.equal(vm.counts.pending, 100);
  assert.equal(vm.counts.pending_total, 101);
  assert.equal(pageInfo?.limit, 100);
  assert.equal(pageInfo?.returned, 100);
  assert.equal(pageInfo?.has_more, true);
});

test("W2 listPendingForUser returns a requested approval queue page with the honest total", async () => {
  const approvals = new MemoryApprovals();
  for (let index = 0; index < 103; index += 1) {
    await approvals.createApprovalRequest({
      actionPattern: "tool.publish_external",
      routedToUserId: userId,
      payloadJson: { raw_args: { index } }
    });
  }
  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    now: () => now
  });

  const vm = await service.listPendingForUser(user({ isAdmin: true }), { offset: 100 });
  const pageInfo = (vm as { page_info?: { limit?: number; offset?: number; returned?: number; has_more?: boolean } }).page_info;

  assert.equal(vm.requests.length, 3);
  assert.equal(vm.items.length, 3);
  assert.equal(vm.counts.pending, 3);
  assert.equal(vm.counts.pending_total, 103);
  assert.equal(pageInfo?.limit, 100);
  assert.equal(pageInfo?.offset, 100);
  assert.equal(pageInfo?.returned, 3);
  assert.equal(pageInfo?.has_more, false);
});

test("routes-a-2/services-a-2/ux-web-govern-6: listPendingForUser caps the visibility scan instead of translating the whole pending table", async () => {
  const approvals = new MemoryApprovals();
  // 造 3 倍于 approvalCenterScanCap(=500) 的 pending 行，全部指向不同 work item、全部可见——
  // 旧实现会 while(true) 翻完全部 1500 行；新实现必须在扫到 500 行左右就停，不管还剩多少。
  const totalRows = 1500;
  for (let index = 0; index < totalRows; index += 1) {
    await approvals.createApprovalRequest({
      actionPattern: "tool.write_file",
      workItemId: `50000000-0000-4000-8000-${String(100000 + index).padStart(12, "0")}`,
      routedToUserId: userId,
      payloadJson: { raw_args: { index } }
    });
  }
  let canReadCalls = 0;
  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    now: () => now
  });

  const vm = await service.listPendingForUser(user({ isAdmin: true }), {
    canReadWorkItem: async () => {
      canReadCalls += 1;
      return true;
    }
  });
  const pageInfo = (vm as { page_info?: { has_more?: boolean } }).page_info;
  const counts = vm.counts as { pending_total: number; pending_total_capped?: number };

  // 扫描必须封顶：不能对全部 1500 行都跑一次 canReadWorkItem（否则就是旧的无界翻页）。
  assert.ok(canReadCalls < totalRows, `expected scan to stop before exhausting all ${totalRows} rows, got ${canReadCalls} canReadWorkItem calls`);
  // 如实标记为估计值：被封顶截断时 pending_total_capped=1，不能假装数完了组织的真实总数（1500）。
  assert.equal(counts.pending_total_capped, 1);
  assert.notEqual(counts.pending_total, totalRows);
  assert.equal(pageInfo?.has_more, true);
});

test("routes-a-2/routes-b-1/services-a-2/xlink-authz-4: listPendingForUser judges each work item's visibility once even with multiple pending approvals on it", async () => {
  const approvals = new MemoryApprovals();
  const sharedWorkItemId = "50000000-0000-4000-8000-000000000aa1";
  // 5 条审批都挂在同一个工作项上——去重后 canReadWorkItem 应该只被调用 1 次，而不是 5 次。
  for (let index = 0; index < 5; index += 1) {
    await approvals.createApprovalRequest({
      actionPattern: "tool.write_file",
      workItemId: sharedWorkItemId,
      routedToUserId: userId,
      payloadJson: { raw_args: { index } }
    });
  }
  const seenWorkItemIds: string[] = [];
  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    now: () => now
  });

  const vm = await service.listPendingForUser(user({ isAdmin: true }), {
    canReadWorkItem: async (workItemId) => {
      seenWorkItemIds.push(workItemId ?? "");
      return true;
    }
  });

  assert.equal(vm.requests.length, 5);
  // 同一 workItemId 只应该被判定一次（去重缓存生效），而不是每条审批都重新调用。
  assert.deepEqual(seenWorkItemIds, [sharedWorkItemId]);
});

test("W2 approval without a work item never leaks a payload proposal_id's manifest (IDOR guard)", async () => {
  const approvals = new MemoryApprovals();
  const manifest = deliverableManifestFixtures[0]!;
  const leakProposalId = "30000000-0000-4000-8000-0000000009a1";
  // 工具/权限类审批：无 workItemId，但 payload 里塞了一个属于别处 work item 的 proposal_id。
  const toolRow = await approvals.createApprovalRequest({
    actionPattern: "tool.publish_external",
    routedToUserId: userId,
    payloadJson: { raw_args: { proposal_id: leakProposalId } }
  });
  const foreignProposal = {
    id: leakProposalId,
    work_item_id: "50000000-0000-4000-8000-0000000009ff",
    status: "opened",
    diff_manifest: manifest
  } as unknown as StoredProposal;
  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    proposals: {
      get: async (id) => (id === leakProposalId ? foreignProposal : null),
      listByWorkItem: async () => []
    },
    now: () => now
  });

  const vm = await service.listPendingForUser(user({ isAdmin: true }));
  const detail = vm.items_detail[toolRow.id];
  // 关键：不渲染成 deliverable，也不暴露 foreignProposal 的 manifest。
  assert.notEqual(detail?.kind, "deliverable");
  assert.equal(detail?.manifest_changes.length, 0);
  assert.equal(detail?.proposal_id, undefined);
});

test("tool approval with a work item does not fall back to an unrelated proposal detail", async () => {
  const approvals = new MemoryApprovals();
  const manifest = deliverableManifestFixtures[0]!;
  const workItemId = "50000000-0000-4000-8000-0000000009b1";
  const proposalId = "30000000-0000-4000-8000-0000000009b2";
  const toolRow = await approvals.createApprovalRequest({
    workItemId,
    actionPattern: "tool.write_file",
    routedToUserId: approverId,
    payloadJson: {
      ui: { summary_text: "写入交付文件", affected_targets: ["workhub-app-upload.txt"] },
      raw_args: {}
    }
  });
  const sameWorkItemProposal = {
    id: proposalId,
    work_item_id: workItemId,
    status: "opened",
    diff_manifest: manifest
  } as unknown as StoredProposal;
  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    proposals: {
      get: async () => null,
      listByWorkItem: async () => [sameWorkItemProposal]
    },
    now: () => now
  });

  const vm = await service.listPendingForUser(user({ isAdmin: true }));
  const detail = vm.items_detail[toolRow.id];

  assert.equal(detail?.kind, "tool");
  assert.deepEqual(detail?.affected_targets, ["workhub-app-upload.txt"]);
  assert.equal(detail?.manifest_changes.length, 0);
  assert.equal(detail?.proposal_id, undefined);
});

test("W2 listPendingForUser degrades to empty detail when no proposals dep is wired", async () => {
  const approvals = new MemoryApprovals();
  const row = await approvals.createApprovalRequest({
    workItemId: "50000000-0000-4000-8000-000000000888",
    actionPattern: "proposal.review.weekly",
    routedToUserId: approverId,
    payloadJson: { raw_args: { proposal_id: "30000000-0000-4000-8000-000000000888" } }
  });
  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    now: () => now
  });
  const vm = await service.listPendingForUser(user({ isAdmin: true }));
  // 无 proposals/approvalComments 依赖：不崩，详情降级为 permission kind + 空 manifest/comments。
  const detail = vm.items_detail[row.id];
  assert.ok(detail);
  assert.equal(detail?.manifest_changes.length, 0);
  assert.equal(detail?.comments.length, 0);
  assert.equal(detail?.timeline[0]?.kind, "created");
});

test("W2 approval comment routes: GET/POST behind read gate, 422 on empty body, 403 without access", async () => {
  const runtimeSettings = settings();
  const approvals = new MemoryApprovals();
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "tool.inspect",
    workItemId: "50000000-0000-4000-8000-0000000000c4",
    routedToUserId: approverId
  });
  const commentRows: ApprovalCommentRow[] = [];
  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    approvalComments: {
      listByApproval: async (id) => commentRows.filter((commentRow) => commentRow.approvalId === id),
      listByApprovals: async (ids) => commentRows.filter((commentRow) => ids.includes(commentRow.approvalId)),
      create: async (input) => {
        const created: ApprovalCommentRow = {
          id: `20000000-0000-4000-8000-${String(commentRows.length + 1).padStart(12, "0")}`,
          approvalId: input.approvalId,
          authorUserId: input.authorUserId,
          authorNickname: input.authorNickname,
          body: input.body,
          createdAt: now,
          updatedAt: now
        };
        commentRows.push(created);
        return created;
      }
    },
    now: () => now
  });
  const headers = {
    "Content-Type": "application/json",
    Cookie: await generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret)
  };

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/approvals", createApprovalRoutes({
    auth: authDeps(runtimeSettings),
    service,
    workItems: allowingWorkItems()
  }));

  const initial = await app.request(`/api/approvals/${seeded.id}/comments`, { headers });
  assert.equal(initial.status, 200);
  assert.deepEqual((await initial.json() as { data: unknown[] }).data, []);

  const posted = await app.request(`/api/approvals/${seeded.id}/comments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ body: "建议错峰执行。" })
  });
  assert.equal(posted.status, 200);
  assert.equal(typeof (await posted.json() as { data: { author_label: string } }).data.author_label, "string");

  const after = await app.request(`/api/approvals/${seeded.id}/comments`, { headers });
  assert.equal((await after.json() as { data: unknown[] }).data.length, 1);

  const empty = await app.request(`/api/approvals/${seeded.id}/comments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ body: "   " })
  });
  assert.equal(empty.status, 422);

  const deniedApp = withErrors(new Hono<AuthEnv>());
  deniedApp.route("/api/approvals", createApprovalRoutes({
    auth: authDeps(runtimeSettings),
    service,
    workItems: denyingWorkItems()
  }));
  const forbidden = await deniedApp.request(`/api/approvals/${seeded.id}/comments`, { headers });
  assert.equal(forbidden.status, 403);
});

test("parseMentions extracts @nicknames, dedupes, and ignores bare @", () => {
  assert.deepEqual(parseMentions("hi @alice and @bob"), ["alice", "bob"]);
  assert.deepEqual(parseMentions("@alice @alice @李梅"), ["alice", "李梅"]);
  // 裸 @ 和邮箱里的 @ 都不算 mention（@ 前是字母）。
  assert.deepEqual(parseMentions("no mentions here, just an @ and email a@b.com"), []);
});

test("W2 approval comment @mentions notify active mentioned users, not the author, not unknown, deduped", async () => {
  const approvals = new MemoryApprovals();
  const aliceId = "10000000-0000-4000-8000-00000000a11c3";
  const bobId = "10000000-0000-4000-8000-00000000b0b00";
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "proposal.review.weekly",
    workItemId: "50000000-0000-4000-8000-0000000000c4",
    routedToUserId: approverId
  });

  const usersByNickname: Record<string, UserAuthRow | null> = {
    alice: user({ id: aliceId, nickname: "alice", cookieToken: "cookie-a" }),
    bob: user({ id: bobId, nickname: "bob", cookieToken: "cookie-b" }),
    // 作者本人——被点名也不该收到自己的通知。
    approver: user({ id: approverId, nickname: "approver", cookieToken: "cookie-approver" })
  };

  const mentionNotifications: { userId: string; type: string; dedupeKey: string; targetUrl?: string }[] = [];

  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    users: {
      findActiveById: async (id) => Object.values(usersByNickname).find((candidate) => candidate?.id === id) ?? null,
      findActiveByNickname: async (nickname) => usersByNickname[nickname] ?? null
    },
    approvalComments: {
      listByApproval: async () => [],
      listByApprovals: async () => [],
      create: async (input) => ({
        id: "20000000-0000-4000-8000-0000000000c7",
        approvalId: input.approvalId,
        authorUserId: input.authorUserId,
        authorNickname: input.authorNickname,
        body: input.body,
        createdAt: now,
        updatedAt: now
      })
    },
    notifications: {
      createMentionNotification: async (input) => {
        mentionNotifications.push({ userId: input.userId, type: "comment.mention", dedupeKey: input.dedupeKey, ...(input.targetUrl ? { targetUrl: input.targetUrl } : {}) });
        return {} as Awaited<ReturnType<NotificationService["createMentionNotification"]>>;
      }
    },
    now: () => now
  });

  // 作者是 approver；点名 alice（两次，应去重）、bob、自己（approver）、未知 nobody。
  await service.addComment(seeded.id, actor, "辛苦 @alice @alice 和 @bob 看一下，@approver @nobody");

  const notifiedIds = mentionNotifications.map((entry) => entry.userId).sort();
  assert.deepEqual(notifiedIds, [aliceId, bobId].sort());
  // 去重：alice 只收到一条。
  assert.equal(mentionNotifications.filter((entry) => entry.userId === aliceId).length, 1);
  // 作者本人不在收件人里。
  assert.equal(mentionNotifications.some((entry) => entry.userId === approverId), false);
  // 类型 + 指向工作项的 targetUrl + 每收件人唯一 dedupeKey。
  assert.ok(mentionNotifications.every((entry) => entry.type === "comment.mention"));
  assert.ok(mentionNotifications.every((entry) => entry.targetUrl === `/workitems/${seeded.workItemId}`));
  assert.equal(new Set(mentionNotifications.map((entry) => entry.dedupeKey)).size, mentionNotifications.length);
});

test("approval comment mention skips users who cannot open the approval work item", async () => {
  const approvals = new MemoryApprovals();
  const aliceId = "10000000-0000-4000-8000-00000000a11c3";
  const bobId = "10000000-0000-4000-8000-00000000b0b00";
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "proposal.review.weekly",
    workItemId: "50000000-0000-4000-8000-0000000000c4",
    routedToUserId: approverId
  });
  const mentionNotifications: { userId: string; body?: string; targetUrl?: string }[] = [];
  const usersByNickname: Record<string, UserAuthRow | null> = {
    alice: user({ id: aliceId, nickname: "alice", cookieToken: "cookie-a" }),
    bob: user({ id: bobId, nickname: "bob", cookieToken: "cookie-b" })
  };

  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    users: {
      findActiveById: async (id) => Object.values(usersByNickname).find((candidate) => candidate?.id === id) ?? null,
      findActiveByNickname: async (nickname) => usersByNickname[nickname] ?? null
    },
    workItems: {
      findWorkItemAccessRecord: async () => ({
        id: seeded.workItemId,
        status: "spec_ready",
        submitterUserId: "10000000-0000-4000-8000-0000000000ee",
        claimedByUserId: null,
        workspaceId,
        project: {
          id: "70000000-0000-4000-8000-0000000000c4",
          workspaceId,
          orgId,
          ownerUserId: "10000000-0000-4000-8000-0000000000ee",
          archived: false,
          deletedAt: null
        },
        assignments: [{ userId: bobId, role: "member" }]
      }) as never
    },
    approvalComments: {
      listByApproval: async () => [],
      listByApprovals: async () => [],
      create: async (input) => ({
        id: "20000000-0000-4000-8000-0000000000c8",
        approvalId: input.approvalId,
        authorUserId: input.authorUserId,
        authorNickname: input.authorNickname,
        body: input.body,
        createdAt: now,
        updatedAt: now
      })
    },
    notifications: {
      createMentionNotification: async (input) => {
        mentionNotifications.push({
          userId: input.userId,
          body: input.body,
          ...(input.targetUrl ? { targetUrl: input.targetUrl } : {})
        });
        return {} as Awaited<ReturnType<NotificationService["createMentionNotification"]>>;
      }
    },
    now: () => now
  });

  await service.addComment(seeded.id, actor, "私有事项细节：请 @alice 和 @bob 看一下");

  assert.deepEqual(mentionNotifications.map((entry) => entry.userId), [bobId]);
  assert.equal(mentionNotifications[0]?.targetUrl, `/workitems/${seeded.workItemId}`);
  assert.match(mentionNotifications[0]?.body ?? "", /私有事项细节/u);
});

test("approval comment mention skips users who cannot open a work-item-less approval", async () => {
  const approvals = new MemoryApprovals();
  const unreachableUserId = "10000000-0000-4000-8000-00000000a11c3";
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "tool.shell.approve",
    routedToUserId: approverId
  });
  const mentionNotifications: { userId: string; targetUrl?: string }[] = [];

  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    users: {
      findActiveById: async () => null,
      findActiveByNickname: async (nickname) =>
        nickname === "alice"
          ? user({ id: unreachableUserId, nickname: "alice", cookieToken: "cookie-a" })
          : null
    },
    approvalComments: {
      listByApproval: async () => [],
      listByApprovals: async () => [],
      create: async (input) => ({
        id: "20000000-0000-4000-8000-0000000000d1",
        approvalId: input.approvalId,
        authorUserId: input.authorUserId,
        authorNickname: input.authorNickname,
        body: input.body,
        createdAt: now,
        updatedAt: now
      })
    },
    notifications: {
      createMentionNotification: async (input) => {
        mentionNotifications.push({ userId: input.userId, ...(input.targetUrl ? { targetUrl: input.targetUrl } : {}) });
        return {} as Awaited<ReturnType<NotificationService["createMentionNotification"]>>;
      }
    },
    now: () => now
  });

  await service.addComment(seeded.id, actor, "这个无事项审批请 @alice 看一下");

  assert.deepEqual(mentionNotifications, []);
});

test("approval comment mention skips admins who cannot open a work-item-less approval", async () => {
  const approvals = new MemoryApprovals();
  const adminId = "10000000-0000-4000-8000-00000000ad01";
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "tool.shell.approve",
    routedToUserId: approverId
  });
  const mentionNotifications: { userId: string; targetUrl?: string }[] = [];

  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    users: {
      findActiveById: async () => null,
      findActiveByNickname: async (nickname) =>
        nickname === "admin"
          ? user({ id: adminId, nickname: "admin", cookieToken: "cookie-admin", isAdmin: true })
          : null
    },
    approvalComments: {
      listByApproval: async () => [],
      listByApprovals: async () => [],
      create: async (input) => ({
        id: "20000000-0000-4000-8000-0000000000d2",
        approvalId: input.approvalId,
        authorUserId: input.authorUserId,
        authorNickname: input.authorNickname,
        body: input.body,
        createdAt: now,
        updatedAt: now
      })
    },
    notifications: {
      createMentionNotification: async (input) => {
        mentionNotifications.push({ userId: input.userId, ...(input.targetUrl ? { targetUrl: input.targetUrl } : {}) });
        return {} as Awaited<ReturnType<NotificationService["createMentionNotification"]>>;
      }
    },
    now: () => now
  });

  await service.addComment(seeded.id, actor, "这个无事项审批请 @admin 看一下");

  assert.deepEqual(mentionNotifications, []);
});

test("W2 approval comment mention notify failure does not fail the comment write", async () => {
  const approvals = new MemoryApprovals();
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "proposal.review.weekly",
    workItemId: "50000000-0000-4000-8000-0000000000c5",
    routedToUserId: approverId
  });
  const service = createApprovalService({
    approvals,
    auditLogs: new MemoryAuditLogs(),
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    users: {
      findActiveById: async () => null,
      findActiveByNickname: async () => user({ id: "10000000-0000-4000-8000-00000000a11c3", nickname: "alice" })
    },
    approvalComments: {
      listByApproval: async () => [],
      listByApprovals: async () => [],
      create: async (input) => ({
        id: "20000000-0000-4000-8000-0000000000c8",
        approvalId: input.approvalId,
        authorUserId: input.authorUserId,
        authorNickname: input.authorNickname,
        body: input.body,
        createdAt: now,
        updatedAt: now
      })
    },
    notifications: {
      createMentionNotification: async () => {
        throw new Error("notification backend down");
      }
    },
    now: () => now
  });

  const created = await service.addComment(seeded.id, actor, "看一下 @alice");
  assert.equal(created.body, "看一下 @alice");
});

test("approval comment audit failure does not fail the already-written comment", async () => {
  const approvals = new MemoryApprovals();
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "proposal.review.weekly",
    workItemId: "50000000-0000-4000-8000-0000000000c6",
    routedToUserId: approverId
  });
  const auditLogs = new MemoryAuditLogs();
  auditLogs.createAuditLog = async () => {
    throw new Error("audit backend down after comment commit");
  };
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies: new MemoryPolicies(),
    bus: new RecordingBus(),
    approvalComments: {
      listByApproval: async () => [],
      listByApprovals: async () => [],
      create: async (input) => ({
        id: "20000000-0000-4000-8000-0000000000c9",
        approvalId: input.approvalId,
        authorUserId: input.authorUserId,
        authorNickname: input.authorNickname,
        body: input.body,
        createdAt: now,
        updatedAt: now
      })
    },
    now: () => now
  });

  const created = await service.addComment(seeded.id, actor, "评论已经写入");

  assert.equal(created.id, "20000000-0000-4000-8000-0000000000c9");
  assert.equal(created.body, "评论已经写入");
});
