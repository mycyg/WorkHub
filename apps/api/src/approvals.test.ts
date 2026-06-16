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

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import {
  ApprovalServiceError,
  createApprovalService
} from "./services/approvals.js";
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
    isAdmin: false,
    deletedAt: null,
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

  async listPendingForUser(id: string, options: { includeAll?: boolean } = {}) {
    return this.rows.filter(
      (approval) => approval.status === "pending" && (options.includeAll || approval.routedToUserId === id)
    );
  }

  async respondPending(
    id: string,
    decision: "allow" | "deny",
    decidedByUserId: string,
    reasonMd: string | null,
    at: Date
  ) {
    const approval = this.rows.find((candidate) => candidate.id === id && candidate.status === "pending") ?? null;
    if (!approval) {
      return null;
    }
    approval.status = decision === "allow" ? "approved" : "denied";
    approval.decidedByUserId = decidedByUserId;
    approval.decisionReasonMd = reasonMd;
    approval.updatedAt = at;
    return approval;
  }

  async delegatePending(id: string, toUserId: string, at: Date) {
    const approval = this.rows.find((candidate) => candidate.id === id && candidate.status === "pending") ?? null;
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
      deletedAt: null
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

function serviceDeps(policies: PermissionPolicyRecord[] = []) {
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
  assert.deepEqual(
    deps.bus.events.map((event) => event.topic).sort(),
    [`session:60000000-0000-4000-8000-000000000001`, `user:${approverId}`].sort()
  );
  assert.equal(deps.bus.events.some((event) => event.topic === "all"), false);
  if (result.outcome === "pending") {
    assert.equal(result.attention.summary_text.includes("tool.write_file"), false);
  }
});

test("allow policy skips approval creation while no policy defaults to ask", async () => {
  const deps = serviceDeps([
    {
      scopeKind: "session",
      scopeId: "60000000-0000-4000-8000-000000000001",
      actionPattern: "tool.write_file",
      effect: "allow"
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
  const deps = serviceDeps();
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
  await deps.service.delegate(delegated.id, actor, "10000000-0000-4000-8000-000000000003");

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
  assert.equal(deps.auditLogs.rows[1]?.detailJson["to_user_id"], "10000000-0000-4000-8000-000000000003");
  assert.equal(deps.auditLogs.rows[2]?.actorKind, "system");
  assert.equal(deps.auditLogs.rows[2]?.actorUserId, null);
  assert.equal(deps.auditLogs.rows[2]?.detailJson["approval_id"], due.id);
  assert.equal(deps.auditLogs.rows[2]?.detailJson["next_action"], "escalate_pm");
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
      [`session:${dueTool.agentRunId}`, "permission.expired"],
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
  async findActiveByTokenHash() {
    return null;
  }

  async findActiveByTokenHashForUser() {
    return null;
  }

  async createClientDevice(): Promise<ClientDeviceAuthRow> {
    throw new Error("not needed");
  }

  async listByUser() {
    return [];
  }

  async touchLastSeen() {
    return null;
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

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return {
    users: new MemoryUsers([user({ isAdmin: true })]),
    devices: new MemoryDevices(),
    settings: runtimeSettings,
    now: () => now
  };
}

function nonAdminAuthDeps(runtimeSettings: Settings): AuthDependencies {
  return {
    users: new MemoryUsers([user({ isAdmin: false })]),
    devices: new MemoryDevices(),
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
    if (error instanceof ApprovalServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    throw error;
  });
  return app;
}

function allowingWorkItems(): Pick<WorkItemService, "detailPage"> {
  return {
    async detailPage() {
      return {
        workitem: {},
        acceptance: [],
        agent_trace_preview: [],
        accepted_deliverables: [],
        evidence_refs: []
      } as unknown as Awaited<ReturnType<WorkItemService["detailPage"]>>;
    }
  };
}

function denyingWorkItems(): Pick<WorkItemService, "detailPage"> {
  return {
    async detailPage() {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限查看这个事项。");
    }
  };
}

test("approval routes filter and block requests whose work item is not visible", async () => {
  const runtimeSettings = settings();
  const deps = serviceDeps();
  const visibleWithoutWorkItem = await deps.approvals.createApprovalRequest({
    actionPattern: "tool.inspect",
    routedToUserId: approverId
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
  const listBody = await list.json() as { data: { requests: Array<{ id: string }>; counts: { pending: number } } };
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
    deletedAt: null
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
    routedToUserId: approverId,
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

test("W2 approval without a work item never leaks a payload proposal_id's manifest (IDOR guard)", async () => {
  const approvals = new MemoryApprovals();
  const manifest = deliverableManifestFixtures[0]!;
  const leakProposalId = "30000000-0000-4000-8000-0000000009a1";
  // 工具/权限类审批：无 workItemId，但 payload 里塞了一个属于别处 work item 的 proposal_id。
  const toolRow = await approvals.createApprovalRequest({
    actionPattern: "tool.publish_external",
    routedToUserId: approverId,
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
