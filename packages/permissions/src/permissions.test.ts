import assert from "node:assert/strict";
import test from "node:test";

import {
  canAddWorkItemAttachment,
  canClaimWorkItem,
  canManageWorkItemAssignees,
  canViewWorkItemRecord,
  canWorkWorkItem,
  resolvePermissionDecision,
  routeApprover,
  toApprovalAttentionItem,
  visibleTools,
  type PermissionActor,
  type PermissionPolicyRecord,
  type UserAccessRecord,
  type WorkItemAccessRecord
} from "./index.js";

const now = new Date("2026-06-05T00:00:00.000Z");

function user(partial: Partial<UserAccessRecord> = {}): UserAccessRecord {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    isAdmin: false,
    deletedAt: null,
    ...partial
  };
}

function workItem(partial: Partial<WorkItemAccessRecord> = {}): WorkItemAccessRecord {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    status: "intake",
    submitterUserId: "10000000-0000-4000-8000-000000000001",
    claimedByUserId: null,
    assignments: [],
    project: {
      archived: false,
      deletedAt: null,
      ownerUserId: "10000000-0000-4000-8000-000000000003"
    },
    ...partial
  };
}

test("resource gate preserves admin read/write asymmetry on archived projects", () => {
  const admin = user({ id: "10000000-0000-4000-8000-000000000099", isAdmin: true });
  const archived = workItem({
    status: "spec_ready",
    project: { archived: true, deletedAt: null }
  });

  assert.equal(canViewWorkItemRecord(archived, admin), true);
  assert.equal(canAddWorkItemAttachment(archived, admin), false);
  assert.equal(canManageWorkItemAssignees(archived, admin), false);
  assert.equal(canClaimWorkItem(archived, admin), false);
  assert.equal(canWorkWorkItem(archived, admin), false);
});

test("resource gate hides private work items from strangers but keeps public board open", () => {
  const stranger = user({ id: "10000000-0000-4000-8000-000000000050" });

  assert.equal(canViewWorkItemRecord(workItem({ status: "intake" }), stranger), false);
  assert.equal(canViewWorkItemRecord(workItem({ status: "in_review" }), stranger), true);
});

test("action gate resolves by scope, priority, specificity, and fail-safe effect strength", () => {
  const actor: PermissionActor = {
    id: "run-1",
    isAdmin: false,
    orgId: "org-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    roleIds: ["lead"]
  };
  const policies: PermissionPolicyRecord[] = [
    { scopeKind: "org", scopeId: "org-1", actionPattern: "tool.delete_file", effect: "deny" },
    { scopeKind: "session", scopeId: "session-1", actionPattern: "tool.delete_file", effect: "allow" },
    { scopeKind: "role", scopeId: "lead", actionPattern: "tool.*", effect: "ask", priority: 3 },
    { scopeKind: "role", scopeId: "lead", actionPattern: "tool.*", effect: "deny", priority: 3 }
  ];

  assert.equal(resolvePermissionDecision(actor, "tool.delete_file", policies, { now }).effect, "allow");
  assert.equal(resolvePermissionDecision(actor, "tool.write_file", policies, { now }).effect, "deny");
  assert.equal(resolvePermissionDecision(actor, "tool.unknown", [], { now }).effect, "ask");
});

test("admin action fallback does not change resource write gates", () => {
  const adminActor: PermissionActor = { id: "admin", isAdmin: true, orgId: "org-1" };
  const adminUser = user({ id: "admin", isAdmin: true });
  const archived = workItem({
    status: "spec_ready",
    project: { archived: true, deletedAt: null }
  });

  assert.equal(resolvePermissionDecision(adminActor, "tool.anything", [], { now }).effect, "allow");
  assert.equal(canClaimWorkItem(archived, adminUser), false);
});

test("visible tools hides deny but keeps ask tools visible for runtime approval", () => {
  const actor: PermissionActor = { id: "run-1", roleIds: ["worker"] };
  const policies: PermissionPolicyRecord[] = [
    { scopeKind: "role", scopeId: "worker", actionPattern: "tool.delete_file", effect: "deny" }
  ];

  assert.deepEqual(
    visibleTools(actor, [{ id: "tool.delete_file" }, { id: "tool.write_file" }], policies).map((tool) => tool.id),
    ["tool.write_file"]
  );
});

test("approval attention item uses UI payload instead of internal action names", () => {
  const item = toApprovalAttentionItem({
    id: "40000000-0000-4000-8000-000000000001",
    workItemId: "50000000-0000-4000-8000-000000000001",
    actionPattern: "tool.delete_file",
    status: "pending",
    routedToUserId: "10000000-0000-4000-8000-000000000001",
    payloadJson: {
      ui: {
        summary_text: "AI 想修改交付包里的 3 个文件，需要你点头。",
        requires_desktop: true,
        risk: { level: "medium", human_label: "影响面不小，稳一点" }
      },
      raw_args: { action: "tool.delete_file" }
    },
    createdAt: now
  });

  assert.equal(item.kind, "approval");
  assert.equal(item.summary_text.includes("tool.delete_file"), false);
  assert.equal(item.actions.find((action) => action.id === "deny")?.requires_reason, true);
});

test("route approver uses proposal submitter and tool lead before admin while excluding requester", () => {
  const requester = "10000000-0000-4000-8000-000000000001";
  const lead = "10000000-0000-4000-8000-000000000002";
  const admin = "10000000-0000-4000-8000-000000000099";
  const item = workItem({
    submitterUserId: requester,
    status: "in_review",
    assignments: [{ userId: lead, role: "lead" }]
  });
  const users = [user({ id: requester }), user({ id: lead }), user({ id: admin, isAdmin: true })];

  assert.equal(routeApprover({ kind: "proposal", workItem: item, requesterUserId: lead, users }), requester);
  assert.equal(routeApprover({ kind: "tool", workItem: item, requesterUserId: requester, users }), lead);
});
