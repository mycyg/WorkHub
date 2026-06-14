import {
  approvalPayloadSchema,
  eventTypes,
  type ApprovalCenterVM,
  type ApprovalCommentVM,
  type ApprovalDecision,
  type ApprovalDetailVM,
  type ApprovalRequest,
  type ApprovalRoutingStep,
  type AttentionItem,
  type PermissionPolicyWrite,
  type RespondApprovalRequest,
  type WorkHubLocale
} from "@workhub/contracts";
import {
  createApprovalRequestRepository,
  createApprovalCommentRepository,
  createAuditLogRepository,
  getSharedDatabaseClient,
  createPermissionPolicyRepository,
  createUserRepository,
  type ApprovalCommentRepository,
  type ApprovalCommentRow,
  type AuditLogRepository,
  type ApprovalRequestRepository,
  type ApprovalRequestRow,
  type CreateApprovalRequestInput,
  type PermissionPolicyRepository,
  type UserAuthRow,
  type UserRepository,
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
import { getDefaultProposalService, type ProposalService, type StoredProposal } from "./proposals.js";

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
  // 可选：用于校验委派目标用户存在（L#48）。缺省时退化为不校验（旧测试夹具）。
  users?: Pick<UserRepository, "findActiveById">;
  // W2：可选——审批工作台逐项详情用。缺省时 items_detail 退化为空（旧夹具不崩）。
  proposals?: Pick<ProposalService, "get" | "listByWorkItem">;
  approvalComments?: Pick<ApprovalCommentRepository, "listByApproval" | "create">;
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
  defaultDbClient ??= getSharedDatabaseClient();
  return {
    approvals: createApprovalRequestRepository(defaultDbClient.db),
    auditLogs: createAuditLogRepository(defaultDbClient.db),
    policies: createPermissionPolicyRepository(defaultDbClient.db),
    users: createUserRepository(defaultDbClient.db),
    proposals: getDefaultProposalService(),
    approvalComments: createApprovalCommentRepository(defaultDbClient.db),
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

// W2：审批工作台逐项详情构建（join 提议 manifest + 合成路由时间线 + 读评论）。
const APPROVAL_DECIDED_STATUSES = new Set(["approved", "rejected", "allowed", "denied", "expired", "decided"]);

function timelineLabel(kind: ApprovalRoutingStep["kind"], zh: boolean): string {
  const map: Record<ApprovalRoutingStep["kind"], [string, string]> = {
    created: ["发起申请", "Submitted"],
    routed: ["路由审批", "Routed"],
    delegated: ["已转交", "Delegated"],
    decided: ["已决策", "Decided"],
    expired: ["已超时", "Expired"]
  };
  const [zhLabel, enLabel] = map[kind];
  return zh ? zhLabel : enLabel;
}

function synthesizeApprovalTimeline(row: ApprovalRequestRow, viewerId: string, locale: WorkHubLocale): ApprovalRoutingStep[] {
  const zh = locale !== "en-US";
  const youLabel = zh ? "你" : "You";
  const decided = Boolean(row.decidedByUserId) || APPROVAL_DECIDED_STATUSES.has(row.status);
  const steps: ApprovalRoutingStep[] = [
    { id: `${row.id}:created`, kind: "created", label: timelineLabel("created", zh), status: "done", at: row.createdAt.toISOString() }
  ];
  if (row.routedToUserId) {
    steps.push({
      id: `${row.id}:routed`,
      kind: "routed",
      label: timelineLabel("routed", zh),
      status: decided ? "done" : "current",
      ...(row.routedToUserId === viewerId ? { actor_label: youLabel } : {}),
      ...(row.slaDueAt ? { sla_due_at: row.slaDueAt.toISOString() } : {})
    });
  }
  if (row.delegatedToUserId) {
    steps.push({
      id: `${row.id}:delegated`,
      kind: "delegated",
      label: timelineLabel("delegated", zh),
      status: decided ? "done" : "current",
      ...(row.delegatedToUserId === viewerId ? { actor_label: youLabel } : {})
    });
  }
  if (row.status === "expired") {
    steps.push({ id: `${row.id}:expired`, kind: "expired", label: timelineLabel("expired", zh), status: "done", at: row.updatedAt.toISOString() });
  } else if (decided) {
    steps.push({
      id: `${row.id}:decided`,
      kind: "decided",
      label: timelineLabel("decided", zh),
      status: "done",
      at: row.updatedAt.toISOString(),
      ...(row.decidedByUserId === viewerId ? { actor_label: youLabel } : {})
    });
  } else {
    steps.push({ id: `${row.id}:decided`, kind: "decided", label: timelineLabel("decided", zh), status: "pending" });
  }
  return steps;
}

function toApprovalCommentVm(row: ApprovalCommentRow): ApprovalCommentVM {
  return { id: row.id, author_label: row.authorNickname, body: row.body, created_at: row.createdAt.toISOString() };
}

async function buildApprovalItemDetail(
  row: ApprovalRequestRow,
  deps: ApprovalServiceDependencies,
  viewerId: string,
  locale: WorkHubLocale
): Promise<ApprovalDetailVM> {
  // L#W2-4：safeParse——一条畸形 payload 不能 500 掉整页（与 toApprovalAttentionItem 一致地降级）。
  const parsedPayload = approvalPayloadSchema.safeParse(row.payloadJson ?? { raw_args: {} });
  const payload = parsedPayload.success ? parsedPayload.data : { raw_args: {} as Record<string, unknown> };
  const timeline = synthesizeApprovalTimeline(row, viewerId, locale);
  let comments: ApprovalCommentVM[] = [];
  try {
    comments = (await deps.approvalComments?.listByApproval(row.id) ?? []).map(toApprovalCommentVm);
  } catch {
    comments = [];
  }

  // 仅交付物类审批有提议可 join 出 diff/checks；权限/工具类没有提议。失败一律降级为空 detail。
  let proposal: StoredProposal | null = null;
  if (deps.proposals) {
    try {
      const proposalId = typeof payload.raw_args.proposal_id === "string" ? payload.raw_args.proposal_id : undefined;
      if (proposalId) {
        const candidate = await deps.proposals.get(proposalId);
        // L#W2-3/6（IDOR 防护）：直传 proposal_id 必须属于本审批的 work item，否则丢弃——
        // 否则任意 proposal_id 都能借审批页泄露其完整 diff_manifest（跨资源越权）。
        proposal = candidate && (!row.workItemId || candidate.work_item_id === row.workItemId) ? candidate : null;
      } else if (row.workItemId) {
        const list = await deps.proposals.listByWorkItem(row.workItemId);
        proposal = list.find((candidate) => candidate.status === "opened" || candidate.status === "reviewed") ?? list[0] ?? null;
      }
    } catch {
      proposal = null;
    }
  }

  if (proposal) {
    const manifest = proposal.diff_manifest;
    const conflicts = manifest.checks
      .filter((check) => check.status === "failed" || check.status === "warning")
      .map((check) => ({ description: check.label, ...(check.detail ? { impact: check.detail } : {}) }));
    return {
      kind: "deliverable",
      proposal_id: proposal.id,
      proposal_href: `/proposals/${proposal.id}`,
      ai_reason: manifest.summary_md,
      risk_label: manifest.risk.human_label,
      manifest_changes: manifest.changes,
      checks: manifest.checks,
      conflicts,
      affected_targets: [],
      timeline,
      comments
    };
  }

  const kind: ApprovalDetailVM["kind"] = row.actionPattern.startsWith("tool") ? "tool" : "permission";
  return {
    kind,
    ...(payload.ui?.reason_text ? { ai_reason: payload.ui.reason_text } : {}),
    ...(payload.ui?.risk?.human_label ? { risk_label: payload.ui.risk.human_label } : {}),
    manifest_changes: [],
    checks: [],
    conflicts: [],
    affected_targets: payload.ui?.affected_targets ?? [],
    timeline,
    comments
  };
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
    async get(id: string) {
      const approval = await deps.approvals.findById(id);
      return approval ? toApprovalRequestResponse(approval) : null;
    },

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

    async listPendingForUser(user: UserAuthRow, options: { locale?: WorkHubLocale } = {}) {
      const rows = await deps.approvals.listPendingForUser(user.id, { includeAll: user.isAdmin });
      const itemOptions = options.locale ? { locale: options.locale } : {};
      const locale: WorkHubLocale = options.locale ?? "zh-CN";
      // W2 inc3：逐项构建详情（join proposal.diff_manifest + 合成路由时间线 + 读评论）。
      const detailEntries = await Promise.all(
        rows.map(async (row) => [row.id, await buildApprovalItemDetail(row, deps, user.id, locale)] as const)
      );
      return {
        items: rows.map((row) => toApprovalAttentionItem(toRecord(row), itemOptions)),
        requests: rows.map(toApprovalRequestResponse),
        filters: { pending: true },
        counts: { pending: rows.length },
        items_detail: Object.fromEntries(detailEntries) as ApprovalCenterVM["items_detail"]
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

      // L#48：委派目标必须是真实存在的活跃用户，否则审批会被路由进黑洞或转给非法 id。
      if (deps.users) {
        const target = await deps.users.findActiveById(toUserId);
        if (!target) {
          throw new ApprovalServiceError(404, "delegate_target_not_found", "找不到要转交的成员。");
        }
      }

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

    async listComments(id: string): Promise<ApprovalCommentVM[]> {
      if (!deps.approvalComments) {
        return [];
      }
      return (await deps.approvalComments.listByApproval(id)).map(toApprovalCommentVm);
    },

    async addComment(id: string, actor: AuthActor, body: string): Promise<ApprovalCommentVM> {
      const approval = await deps.approvals.findById(id);
      if (!approval) {
        throw new ApprovalServiceError(404, "not_found", "没有找到这条审批。");
      }
      if (!deps.approvalComments) {
        throw new ApprovalServiceError(503, "comments_unavailable", "评论功能暂不可用。");
      }
      const created = await deps.approvalComments.create({
        approvalId: id,
        authorUserId: approverId(actor),
        authorNickname: actorNickname(actor),
        body
      });
      await auditApprovalAction(approval, {
        action: "approval.commented",
        actor: {
          kind: "human",
          label: actorNickname(actor),
          orgId: actor.orgId,
          workspaceId: actor.workspaceId,
          ...(actor.userId ? { userId: actor.userId } : {})
        },
        detail: { approval_id: id, comment_id: created.id }
      });
      return toApprovalCommentVm(created);
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
