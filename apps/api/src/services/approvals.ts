import {
  approvalPayloadSchema,
  eventTypes,
  type ApprovalDecision,
  type ApprovalRequest,
  type AttentionItem,
  type PermissionPolicyWrite,
  type RespondApprovalRequest
} from "@workhub/contracts";
import {
  createApprovalRequestRepository,
  createAuditLogRepository,
  createDatabaseClient,
  createPermissionPolicyRepository,
  type AuditLogRepository,
  type ApprovalRequestRepository,
  type ApprovalRequestRow,
  type CreateApprovalRequestInput,
  type PermissionPolicyRepository,
  type UserAuthRow,
  type WorkHubDatabaseClient
} from "@workhub/db";
import { topics } from "@workhub/events";
import {
  approvalRiskLevel,
  resolvePermissionDecision,
  toApprovalAttentionItem,
  type ApprovalRequestRecord,
  type PermissionActor
} from "@workhub/permissions";

import { getDefaultPushBus } from "../broker/index.js";
import type { PushBus } from "../broker/types.js";
import type { AuthActor } from "../middleware/auth.js";

export class ApprovalServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type ApprovalCreationResult =
  | { outcome: "allowed"; decision: ReturnType<typeof resolvePermissionDecision> }
  | { outcome: "denied"; decision: ReturnType<typeof resolvePermissionDecision> }
  | { outcome: "escalated"; reason: "no_approver" }
  | { outcome: "pending"; approval: ApprovalRequest; attention: AttentionItem };

export type ApprovalExpirationAction = "escalate_pm" | "notify_reviewer";

export type ApprovalExpirationResult = {
  approval: ApprovalRequest;
  next_action: ApprovalExpirationAction;
  escalated: boolean;
};

export type CreateApprovalInput = {
  actor: AuthActor;
  kind: "tool" | "proposal" | "revision";
  workItemId?: string;
  agentRunId?: string;
  actionPattern: string;
  payloadJson?: Record<string, unknown>;
  routedToUserId?: string;
  slaDueAt?: Date;
};

export type ApprovalServiceDependencies = {
  approvals: ApprovalRequestRepository;
  policies: PermissionPolicyRepository;
  auditLogs: AuditLogRepository;
  bus?: Pick<PushBus, "publish">;
  now?: () => Date;
};

export type ApprovalService = ReturnType<typeof createApprovalService>;

type AuditApprovalActor = {
  kind: "human" | "ai" | "system";
  label: string;
  orgId?: string;
  workspaceId?: string;
  userId?: string;
};

let defaultDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultApprovalServiceDependencies(): ApprovalServiceDependencies {
  defaultDbClient ??= createDatabaseClient();
  return {
    approvals: createApprovalRequestRepository(defaultDbClient.db),
    auditLogs: createAuditLogRepository(defaultDbClient.db),
    policies: createPermissionPolicyRepository(defaultDbClient.db),
    bus: getDefaultPushBus()
  };
}

function actorToPermissionActor(actor: AuthActor, agentRunId?: string): PermissionActor {
  const converted: PermissionActor = {
    id: actor.id,
    kind: actor.kind,
    label: actor.label,
    isAdmin: actor.isAdmin,
    orgId: actor.orgId,
    workspaceId: actor.workspaceId,
    sessionId: agentRunId ?? actor.id
  };
  if (actor.userId) {
    converted.userId = actor.userId;
  }
  return converted;
}

function toRecord(row: ApprovalRequestRow): ApprovalRequestRecord {
  return {
    id: row.id,
    workItemId: row.workItemId,
    agentRunId: row.agentRunId,
    actionPattern: row.actionPattern,
    payloadJson: row.payloadJson,
    status: row.status,
    routedToUserId: row.routedToUserId,
    decidedByUserId: row.decidedByUserId,
    decisionReasonMd: row.decisionReasonMd,
    delegatedToUserId: row.delegatedToUserId,
    slaDueAt: row.slaDueAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function toApprovalRequestResponse(row: ApprovalRequestRow): ApprovalRequest {
  const response: ApprovalRequest = {
    id: row.id,
    action_pattern: row.actionPattern,
    payload_json: row.payloadJson,
    status: row.status as ApprovalRequest["status"],
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    ...(row.workItemId ? { work_item_id: row.workItemId } : {}),
    ...(row.agentRunId ? { agent_run_id: row.agentRunId } : {}),
    ...(row.routedToUserId ? { routed_to_user_id: row.routedToUserId } : {}),
    ...(row.decidedByUserId ? { decided_by_user_id: row.decidedByUserId } : {}),
    ...(row.decisionReasonMd ? { decision_reason_md: row.decisionReasonMd } : {}),
    ...(row.delegatedToUserId ? { delegated_to_user_id: row.delegatedToUserId } : {}),
    ...(row.slaDueAt ? { sla_due_at: row.slaDueAt.toISOString() } : {})
  };
  return response;
}

function approverId(actor: AuthActor) {
  return actor.userId ?? actor.id;
}

function ensureCanActOnApproval(approval: ApprovalRequestRow, actor: AuthActor) {
  if (actor.isAdmin) {
    return;
  }
  if (approval.routedToUserId !== approverId(actor)) {
    throw new ApprovalServiceError(403, "forbidden", "这条审批不在你的待处理列表里。");
  }
}

function ensureDenyReason(decision: ApprovalDecision, reasonMd: string | undefined) {
  if (decision === "deny" && !reasonMd?.trim()) {
    throw new ApprovalServiceError(422, "reason_required", "打回时需要填写理由，AI 才知道怎么改。");
  }
}

function shouldLearnAlways(approval: ApprovalRequestRow, payload: RespondApprovalRequest) {
  if (payload.decision !== "allow" || payload.remember !== "always") {
    return false;
  }
  return approvalRiskLevel(toRecord(approval)) !== "high";
}

async function publishIfAvailable<T>(
  bus: Pick<PushBus, "publish"> | undefined,
  topic: string | undefined,
  type: string,
  data: T
) {
  if (!bus || !topic) {
    return;
  }
  await bus.publish(topic, type, data);
}

function expirationAction(row: ApprovalRequestRow): ApprovalExpirationAction {
  if (row.agentRunId || row.actionPattern.startsWith("tool.")) {
    return "escalate_pm";
  }
  return "notify_reviewer";
}

function expirationEventData(row: ApprovalRequestRow, nextAction: ApprovalExpirationAction) {
  return {
    approval_id: row.id,
    action_pattern: row.actionPattern,
    next_action: nextAction,
    escalated: nextAction === "escalate_pm",
    ...(row.workItemId ? { work_item_id: row.workItemId } : {}),
    ...(row.agentRunId ? { agent_run_id: row.agentRunId } : {}),
    ...(row.routedToUserId ? { routed_to_user_id: row.routedToUserId } : {})
  };
}

function actorNickname(actor: AuthActor) {
  return actor.label;
}

function auditEntity(row: ApprovalRequestRow) {
  if (row.workItemId) {
    return { entityType: "work_item", entityId: row.workItemId };
  }
  return { entityType: "approval_request", entityId: row.id };
}

export function createApprovalService(deps: ApprovalServiceDependencies = getDefaultApprovalServiceDependencies()) {
  const now = deps.now ?? (() => new Date());

  async function auditApprovalAction(
    row: ApprovalRequestRow,
    input: {
      action: string;
      actor: AuditApprovalActor;
      detail: Record<string, unknown>;
    }
  ) {
    const entity = auditEntity(row);
    await deps.auditLogs.createAuditLog({
      actorKind: input.actor.kind,
      actorNickname: input.actor.label,
      entityType: entity.entityType,
      entityId: entity.entityId,
      action: input.action,
      ...(input.actor.orgId ? { orgId: input.actor.orgId } : {}),
      ...(input.actor.workspaceId ? { workspaceId: input.actor.workspaceId } : {}),
      ...(input.actor.userId ? { actorUserId: input.actor.userId } : {}),
      detailJson: {
        approval_id: row.id,
        action_pattern: row.actionPattern,
        status: row.status,
        ...(row.agentRunId ? { agent_run_id: row.agentRunId } : {}),
        ...(row.workItemId ? { work_item_id: row.workItemId } : {}),
        ...input.detail
      }
    });
  }

  async function publishAsk(row: ApprovalRequestRow, attention: AttentionItem) {
    await publishIfAvailable(deps.bus, row.routedToUserId ? topics.user(row.routedToUserId).topic : undefined, eventTypes.permissionAsk, {
      approval_id: row.id,
      summary_text: attention.summary_text,
      attention
    });

    if (row.agentRunId) {
      await publishIfAvailable(deps.bus, topics.session(row.agentRunId).topic, eventTypes.permissionAsk, {
        approval_id: row.id,
        summary_text: attention.summary_text
      });
    }
  }

  return {
    async createApproval(input: CreateApprovalInput): Promise<ApprovalCreationResult> {
      const policies = await deps.policies.listActivePolicies();
      const decision = resolvePermissionDecision(
        actorToPermissionActor(input.actor, input.agentRunId),
        input.actionPattern,
        policies,
        { now: now() }
      );

      if (decision.effect === "allow") {
        return { outcome: "allowed", decision };
      }
      if (decision.effect === "deny") {
        return { outcome: "denied", decision };
      }
      if (!input.routedToUserId) {
        return { outcome: "escalated", reason: "no_approver" };
      }

      const createInput: CreateApprovalRequestInput = {
        actionPattern: input.actionPattern,
        payloadJson: approvalPayloadSchema.parse(input.payloadJson ?? { raw_args: {} })
      };
      if (input.routedToUserId) {
        createInput.routedToUserId = input.routedToUserId;
      }
      if (input.workItemId) {
        Object.assign(createInput, { workItemId: input.workItemId });
      }
      if (input.agentRunId) {
        Object.assign(createInput, { agentRunId: input.agentRunId });
      }
      if (input.slaDueAt) {
        Object.assign(createInput, { slaDueAt: input.slaDueAt });
      }
      const approval = await deps.approvals.createApprovalRequest(createInput);
      const attention = toApprovalAttentionItem(toRecord(approval), { kind: input.kind });
      await publishAsk(approval, attention);
      return { outcome: "pending", approval: toApprovalRequestResponse(approval), attention };
    },

    async listPendingForUser(user: UserAuthRow) {
      const rows = await deps.approvals.listPendingForUser(user.id, { includeAll: user.isAdmin });
      return {
        items: rows.map((row) => toApprovalAttentionItem(toRecord(row))),
        requests: rows.map(toApprovalRequestResponse),
        filters: { pending: true },
        counts: { pending: rows.length }
      };
    },

    async respond(id: string, actor: AuthActor, payload: RespondApprovalRequest) {
      const approval = await deps.approvals.findById(id);
      if (!approval) {
        throw new ApprovalServiceError(404, "not_found", "没有找到这条审批。");
      }
      ensureCanActOnApproval(approval, actor);
      ensureDenyReason(payload.decision, payload.reason_md);

      const shouldLearn = shouldLearnAlways(approval, payload);

      const updated = await deps.approvals.respondPending(
        id,
        payload.decision,
        approverId(actor),
        payload.reason_md?.trim() ?? null,
        now()
      );
      if (!updated) {
        throw new ApprovalServiceError(409, "approval_race", "这条审批已经被处理过了。");
      }

      const learnedPolicy = shouldLearn
        ? await deps.policies.createPermissionPolicy({
            scopeKind: "session",
            scopeId: updated.agentRunId ?? actor.id,
            actionPattern: updated.actionPattern,
            effect: "allow",
            priority: 0,
            learnedFromSession: true,
            ...(actor.userId ? { createdByUserId: actor.userId } : {}),
            orgId: actor.orgId,
            workspaceId: actor.workspaceId
          })
        : undefined;

      await auditApprovalAction(updated, {
        action: "approval.decided",
        actor: {
          kind: "human",
          label: actorNickname(actor),
          orgId: actor.orgId,
          workspaceId: actor.workspaceId,
          ...(actor.userId ? { userId: actor.userId } : {})
        },
        detail: {
          decision: payload.decision,
          decided_by_user_id: approverId(actor),
          ...(payload.reason_md ? { reason_preview: payload.reason_md.trim().slice(0, 160) } : {}),
          ...(learnedPolicy ? { learned_policy_id: learnedPolicy.id } : {})
        }
      });

      const eventData = {
        approval_id: updated.id,
        decision: payload.decision,
        learned_policy_id: learnedPolicy?.id
      };
      await publishIfAvailable(deps.bus, topics.user(approverId(actor)).topic, eventTypes.permissionDecided, eventData);
      if (updated.workItemId) {
        await publishIfAvailable(deps.bus, topics.workitem(updated.workItemId).topic, eventTypes.permissionDecided, eventData);
      }

      return {
        approval: toApprovalRequestResponse(updated),
        ...(learnedPolicy ? { learned_policy: learnedPolicy } : {})
      };
    },

    async delegate(id: string, actor: AuthActor, toUserId: string) {
      const approval = await deps.approvals.findById(id);
      if (!approval) {
        throw new ApprovalServiceError(404, "not_found", "没有找到这条审批。");
      }
      ensureCanActOnApproval(approval, actor);

      const previousUserId = approval.routedToUserId;
      const updated = await deps.approvals.delegatePending(id, toUserId, now());
      if (!updated) {
        throw new ApprovalServiceError(409, "approval_race", "这条审批已经被处理过了。");
      }

      await auditApprovalAction(updated, {
        action: "approval.delegated",
        actor: {
          kind: "human",
          label: actorNickname(actor),
          orgId: actor.orgId,
          workspaceId: actor.workspaceId,
          ...(actor.userId ? { userId: actor.userId } : {})
        },
        detail: {
          from_user_id: previousUserId,
          to_user_id: toUserId,
          delegated_by_user_id: approverId(actor)
        }
      });

      const attention = toApprovalAttentionItem(toRecord(updated));
      const eventData = {
        approval_id: updated.id,
        from_user_id: previousUserId,
        to_user_id: toUserId
      };
      await publishIfAvailable(deps.bus, previousUserId ? topics.user(previousUserId).topic : undefined, eventTypes.permissionReassigned, eventData);
      await publishIfAvailable(deps.bus, topics.user(toUserId).topic, eventTypes.permissionReassigned, eventData);
      await publishAsk(updated, attention);

      return {
        approval: toApprovalRequestResponse(updated),
        attention
      };
    },

    async expireDueApprovals(options: { limit?: number } = {}): Promise<ApprovalExpirationResult[]> {
      const at = now();
      const dueRows = await deps.approvals.listPendingDue(at, options.limit);
      const results: ApprovalExpirationResult[] = [];

      for (const due of dueRows) {
        const updated = await deps.approvals.expirePending(due.id, at);
        if (!updated) {
          continue;
        }
        const nextAction = expirationAction(updated);
        const eventData = expirationEventData(updated, nextAction);
        await auditApprovalAction(updated, {
          action: "approval.expired",
          actor: { kind: "system", label: "WorkHub" },
          detail: {
            next_action: nextAction,
            escalated: nextAction === "escalate_pm",
            routed_to_user_id: updated.routedToUserId
          }
        });
        await publishIfAvailable(
          deps.bus,
          updated.routedToUserId ? topics.user(updated.routedToUserId).topic : undefined,
          eventTypes.permissionExpired,
          eventData
        );
        if (updated.workItemId) {
          await publishIfAvailable(deps.bus, topics.workitem(updated.workItemId).topic, eventTypes.permissionExpired, eventData);
        }
        if (updated.agentRunId) {
          await publishIfAvailable(deps.bus, topics.session(updated.agentRunId).topic, eventTypes.permissionExpired, eventData);
        }
        results.push({
          approval: toApprovalRequestResponse(updated),
          next_action: nextAction,
          escalated: nextAction === "escalate_pm"
        });
      }

      return results;
    },

    async createPolicy(actor: AuthActor, input: PermissionPolicyWrite) {
      if (!actor.isAdmin) {
        throw new ApprovalServiceError(403, "forbidden", "只有管理员可以调整权限策略。");
      }
      return deps.policies.createPermissionPolicy({
        scopeKind: input.scope_kind,
        scopeId: input.scope_id,
        actionPattern: input.action_pattern,
        effect: input.effect,
        priority: input.priority,
        learnedFromSession: input.learned_from_session,
        ...(actor.userId ? { createdByUserId: actor.userId } : {}),
        orgId: input.org_id ?? actor.orgId,
        workspaceId: input.workspace_id ?? actor.workspaceId
      });
    },

    async listPolicies() {
      return deps.policies.listActivePolicies();
    }
  };
}
