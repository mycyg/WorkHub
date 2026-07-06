import { randomUUID } from "node:crypto";

import {
  approvalCenterVmSchema,
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
  createWorkItemRepository,
  type ApprovalCommentRepository,
  type ApprovalCommentRow,
  type AuditLogRepository,
  type ApprovalRequestRepository,
  type ApprovalRequestRow,
  type CreateApprovalRequestInput,
  type PermissionPolicyRecord,
  type PermissionPolicyRepository,
  type UserAuthRow,
  type UserRepository,
  type WorkItemAccessRow,
  type WorkItemDataRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import { topics } from "@workhub/events";
import {
  approvalRiskLevel,
  canViewWorkItemRecord,
  resolvePermissionDecision,
  toApprovalAttentionItem,
  type ApprovalRequestRecord,
  type PermissionActor
} from "@workhub/permissions";

import { getDefaultPushBus } from "../broker/index.js";
import type { PushBus } from "../broker/types.js";
import type { AuthActor } from "../middleware/auth.js";
import { getDefaultStructuredLogger } from "../logging.js";
import { parseOutputContract } from "../pages/output-contract.js";
import {
  createNotificationService,
  type NotificationService
} from "./notifications.js";
import { getDefaultProposalService, type ProposalService, type StoredProposal } from "./proposals.js";

// @mentions：从评论正文里抽出 @<昵称> token。昵称字符集与 users.nickname 一致（Unicode 字母/数字/下划线，
// 含 CJK——`\p{L}` 覆盖中文），以空白或标点收尾。要求 @ 前不是字母/数字/下划线，避免把邮箱 a@b.com 误当
// mention。去重后返回（保持出现顺序）；未知昵称由调用方在解析阶段丢弃。
export function parseMentions(text: string): string[] {
  const matches = text.matchAll(/(?<![\p{L}\p{N}_])@([\p{L}\p{N}_]+)/gu);
  const seen = new Set<string>();
  for (const match of matches) {
    const nickname = match[1];
    if (nickname) {
      seen.add(nickname);
    }
  }
  return [...seen];
}

const approvalCenterCommentsPerApproval = 20;
const approvalCenterPageLimit = 100;
// routes-a-2/routes-b-1/services-a-2/xlink-authz-4/ux-web-govern-6：可见性扫描必须封顶——旧实现是
// `while(true)+offset` 无界翻页，admin/大收件箱用户每次打开审批中心 = 全表 pending 扫描 + 逐行 detailPage。
// 封顶到「几页」量级（5 倍页大小），超出如实通过 pending_total_capped 告知前端总数是下限估计，不假装数完了。
const approvalCenterScanCap = approvalCenterPageLimit * 5;

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

export type PermissionPolicyResponse = {
  id?: string;
  scope_kind: PermissionPolicyRecord["scopeKind"];
  scope_id: string;
  action_pattern: string;
  effect: PermissionPolicyRecord["effect"];
  priority: number;
  learned_from_session: boolean;
  created_by_user_id: string | null;
  org_id: string | null;
  workspace_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

function isoTimestamp(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalIsoTimestamp(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }
  return isoTimestamp(value);
}

export function toPermissionPolicyResponse(policy: PermissionPolicyRecord): PermissionPolicyResponse {
  return {
    ...(policy.id ? { id: policy.id } : {}),
    scope_kind: policy.scopeKind,
    scope_id: policy.scopeId,
    action_pattern: policy.actionPattern,
    effect: policy.effect,
    priority: policy.priority ?? 0,
    learned_from_session: policy.learnedFromSession ?? false,
    created_by_user_id: policy.createdByUserId ?? null,
    org_id: policy.orgId ?? null,
    workspace_id: policy.workspaceId ?? null,
    deleted_at: optionalIsoTimestamp(policy.deletedAt),
    created_at: isoTimestamp(policy.createdAt),
    updated_at: isoTimestamp(policy.updatedAt)
  };
}

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
  // findActiveByNickname 供 @mentions 解析被点名用户，本身也是可选——旧夹具只给 findActiveById 时不解析 mention。
  users?: Pick<UserRepository, "findActiveById"> & Partial<Pick<UserRepository, "findActiveByNickname">>;
  // 可选：委派守卫用——把审批挂的工作项摊平成可见性记录，校验转交目标确实能看到该事项（与 routeApprover 一致）。
  // 缺省时退化为不校验工作项可见性（旧测试夹具不提供）。
  workItems?: Pick<WorkItemDataRepository, "findWorkItemAccessRecord">;
  // W2：可选——审批工作台逐项详情用。缺省时 items_detail 退化为空（旧夹具不崩）。
  proposals?: Pick<ProposalService, "get" | "listByWorkItem">;
  approvalComments?: Pick<ApprovalCommentRepository, "listByApproval" | "listByApprovals" | "create">;
  // @mentions：评论里 @某人时发通知。缺省时退化为不发 mention 通知（旧测试夹具）。
  notifications?: Pick<NotificationService, "createMentionNotification">;
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

type CreatePermissionPolicyInput = Parameters<PermissionPolicyRepository["createPermissionPolicy"]>[0];
type CreateAuditLogInput = Parameters<AuditLogRepository["createAuditLog"]>[0];

let defaultDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultApprovalServiceDependencies(): ApprovalServiceDependencies {
  defaultDbClient ??= getSharedDatabaseClient();
  return {
    approvals: createApprovalRequestRepository(defaultDbClient.db),
    auditLogs: createAuditLogRepository(defaultDbClient.db),
    policies: createPermissionPolicyRepository(defaultDbClient.db),
    users: createUserRepository(defaultDbClient.db),
    workItems: createWorkItemRepository(defaultDbClient.db),
    proposals: getDefaultProposalService(),
    approvalComments: createApprovalCommentRepository(defaultDbClient.db),
    notifications: createNotificationService(),
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

// 把 db 的 WorkItemAccessRow 摊平成 @workhub/permissions 的可见性记录（结构已对齐，仅收口字段）。
function toWorkItemAccessRecord(row: WorkItemAccessRow) {
  return {
    id: row.id,
    status: row.status,
    submitterUserId: row.submitterUserId,
    claimedByUserId: row.claimedByUserId,
    workspaceId: row.workspaceId,
    ...(row.project ? { project: row.project } : {}),
    assignments: row.assignments
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

function permissionPolicyMatchesActorTenant(policy: PermissionPolicyRecord, actor: AuthActor) {
  return (!policy.orgId || policy.orgId === actor.orgId) && (!policy.workspaceId || policy.workspaceId === actor.workspaceId);
}

type PermissionPolicyIdentity = {
  scopeKind: PermissionPolicyRecord["scopeKind"];
  scopeId: string;
  actionPattern: string;
  effect: PermissionPolicyRecord["effect"];
  priority?: number;
};

function samePermissionPolicyIdentity(policy: PermissionPolicyRecord, identity: PermissionPolicyIdentity) {
  return policy.scopeKind === identity.scopeKind
    && policy.scopeId === identity.scopeId
    && policy.actionPattern === identity.actionPattern
    && policy.effect === identity.effect
    && (policy.priority ?? 0) === (identity.priority ?? 0);
}

function findEquivalentActivePolicy(
  policies: readonly PermissionPolicyRecord[],
  actor: AuthActor,
  identity: PermissionPolicyIdentity
) {
  return policies.find((policy) =>
    policy.deletedAt == null
    && permissionPolicyMatchesActorTenant(policy, actor)
    && samePermissionPolicyIdentity(policy, identity)
  );
}

function assertPolicyScopeWithinActorTenant(actor: AuthActor, input: PermissionPolicyWrite) {
  if (input.scope_kind === "org" && input.scope_id !== actor.orgId) {
    throw new ApprovalServiceError(403, "forbidden", "不能为其它组织创建权限策略。");
  }
  if (input.scope_kind === "workspace" && input.scope_id !== actor.workspaceId) {
    throw new ApprovalServiceError(403, "forbidden", "不能为其它工作区创建权限策略。");
  }
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
      status: decided || row.delegatedToUserId ? "done" : "current",
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

type ApprovalCommentPageInfo = NonNullable<ApprovalDetailVM["comments_page_info"]>;

async function buildApprovalItemDetail(
  row: ApprovalRequestRow,
  deps: ApprovalServiceDependencies,
  viewerId: string,
  locale: WorkHubLocale,
  prefetchedComments?: ApprovalCommentVM[],
  prefetchedCommentsPageInfo?: ApprovalCommentPageInfo
): Promise<ApprovalDetailVM> {
  // L#W2-4：safeParse——一条畸形 payload 不能 500 掉整页（与 toApprovalAttentionItem 一致地降级）。
  const parsedPayload = approvalPayloadSchema.safeParse(row.payloadJson ?? { raw_args: {} });
  const payload = parsedPayload.success ? parsedPayload.data : { raw_args: {} as Record<string, unknown> };
  const timeline = synthesizeApprovalTimeline(row, viewerId, locale);
  // L#W2-12：评论优先用上层批量预取的结果（一次 IN 查询），仅在未预取时回落到单审批查询。
  let comments: ApprovalCommentVM[] = prefetchedComments ?? [];
  try {
    if (!prefetchedComments) {
      comments = (await deps.approvalComments?.listByApproval(row.id) ?? []).map(toApprovalCommentVm);
    }
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
        // L#W2-3/6 + 审计 M6（IDOR 防护）：直传 proposal_id 必须属于本审批的 work item，否则丢弃。
        // 关键：审批没有 workItemId（工具/权限类审批）时绝不放行——此前 `!row.workItemId` 短路会让
        // 任意 proposal_id 借审批页泄露其完整 diff_manifest（跨资源越权）。无 workItemId 即不渲染提议详情。
        proposal = candidate && row.workItemId && candidate.work_item_id === row.workItemId ? candidate : null;
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
      comments,
      ...(prefetchedCommentsPageInfo ? { comments_page_info: prefetchedCommentsPageInfo } : {})
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
    comments,
    ...(prefetchedCommentsPageInfo ? { comments_page_info: prefetchedCommentsPageInfo } : {})
  };
}

function ensureCanActOnApproval(approval: ApprovalRequestRow, actor: AuthActor) {
  if (actor.isAdmin && approval.workItemId) {
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

// 审计 FIX#3：所有 publishIfAvailable 调用点都在 CAS / createApprovalRequest 提交「之后」（决策已落库）。
// 生产默认总线是 Redis，其 publish 在连接抖动时会抛——若让它冒泡，整个 respond/delegate 方法在决策已提交后
// 仍返回 HTTP 500；客户端重试又撞上「状态已非 pending」的 CAS → 409，决策永远拿不回来。故把发布做成 best-effort：
// 吞掉异常并 warn（与 proposals 路由的 publishProposalEvents 同口径）。绝不能在 CAS 提交「之前」用本函数。
async function publishIfAvailable<T>(
  bus: Pick<PushBus, "publish"> | undefined,
  topic: string | undefined,
  type: string,
  data: T
) {
  if (!bus || !topic) {
    return;
  }
  try {
    await bus.publish(topic, type, data);
  } catch (error) {
    // best-effort：丢一次实时刷新可接受，绝不让总线故障翻掉已提交的审批决策（客户端靠下一条事件/全量重拉补齐）。
    getDefaultStructuredLogger().warn("approvals_publish_post_commit_failed", { topic, type, error });
  }
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

  async function auditPermissionPolicyAction(input: CreateAuditLogInput) {
    await deps.auditLogs.createAuditLog(input);
  }

  async function auditPermissionPolicyActionBestEffort(input: CreateAuditLogInput) {
    try {
      await auditPermissionPolicyAction(input);
    } catch (error) {
      getDefaultStructuredLogger().warn("permission_policy_audit_write_failed", {
        action: input.action,
        entityId: input.entityId,
        error
      });
    }
  }

  function permissionPolicyCreatedAuditInput(
    actor: AuthActor,
    policyId: string,
    input: CreatePermissionPolicyInput
  ): CreateAuditLogInput {
    return {
      actorKind: actor.kind,
      actorNickname: actor.label,
      entityType: "permission_policy",
      entityId: policyId,
      action: "permission_policy.created",
      ...(actor.orgId ? { orgId: actor.orgId } : {}),
      ...(actor.workspaceId ? { workspaceId: actor.workspaceId } : {}),
      ...(actor.userId ? { actorUserId: actor.userId } : {}),
      detailJson: {
        scope_kind: input.scopeKind,
        scope_id: input.scopeId,
        action_pattern: input.actionPattern,
        effect: input.effect,
        learned_from_session: input.learnedFromSession ?? false
      }
    };
  }

  async function createAuditedPermissionPolicy(actor: AuthActor, input: CreatePermissionPolicyInput) {
    const policyId = input.id ?? randomUUID();
    await auditPermissionPolicyAction(permissionPolicyCreatedAuditInput(actor, policyId, input));
    return deps.policies.createPermissionPolicy({ ...input, id: policyId });
  }

  // @mentions：解析评论正文里的 @昵称 → 活跃用户，给被点名者（排除作者本人、去重）发通知。
  // 整体 best-effort：任何一步失败都吞掉并 warn，绝不让评论写入连带失败（与其它 notify 路径一致）。
  async function notifyCommentMentions(input: {
    approval: ApprovalRequestRow;
    actor: AuthActor;
    body: string;
    authorUserId: string;
    authorLabel: string;
    commentId: string;
  }) {
    if (!deps.notifications || !deps.users?.findActiveByNickname) {
      return;
    }
    try {
      const nicknames = parseMentions(input.body);
      if (nicknames.length === 0) {
        return;
      }
      const findByNickname = deps.users.findActiveByNickname.bind(deps.users);
      const resolved = await Promise.all(nicknames.map((nickname) => findByNickname(nickname)));
      const notifiedUserIds = new Set<string>();
      const workItemId = input.approval.workItemId ?? undefined;
      const workItem = workItemId && deps.workItems
        ? await deps.workItems.findWorkItemAccessRecord(workItemId)
        : null;
      const targetUrl = workItemId ? `/workitems/${workItemId}` : `/approvals/${input.approval.id}`;
      for (const target of resolved) {
        // 只通知能解析到的活跃用户（findActiveByNickname 已过滤 deletedAt）；
        // 排除作者本人，并按 userId 去重（同名两次或多个未知昵称只发一条）。
        if (!target || target.id === input.authorUserId || notifiedUserIds.has(target.id)) {
          continue;
        }
        if (!workItemId && target.id !== input.approval.routedToUserId) {
          continue;
        }
        if (workItemId && workItem && !canViewWorkItemRecord(toWorkItemAccessRecord(workItem), target, {
          orgId: input.actor.orgId,
          workspaceId: input.actor.workspaceId
        })) {
          continue;
        }
        notifiedUserIds.add(target.id);
        await deps.notifications.createMentionNotification({
          userId: target.id,
          severity: "normal",
          title: `${input.authorLabel} 在评论里提到了你`,
          body: input.body.trim().slice(0, 160),
          targetUrl,
          ...(workItemId ? { workItemId } : {}),
          // 同一条评论对同一个人只产生一条通知（重复提交/重试幂等）。
          dedupeKey: `comment-mention:${input.commentId}:${target.id}`
        });
      }
    } catch (error) {
      getDefaultStructuredLogger().warn("approvals_comment_mentions_notify_failed", { error });
    }
  }

  async function publishAsk(row: ApprovalRequestRow, attention: AttentionItem) {
    await publishIfAvailable(deps.bus, row.routedToUserId ? topics.user(row.routedToUserId).topic : undefined, eventTypes.permissionAsk, {
      approval_id: row.id,
      summary_text: attention.summary_text,
      attention
    });

    // findings[#169]：会话流订阅的是 session:<workItemId>（sessionVmFor 设 session_id=workItem.id、
    // stream_href=/api/push/stream/session/<workItemId>）。原来发到 session:<agentRunId> 没有任何订阅者，
    // 是死扇出——权限提示永远不会实时到达会话流。改发到 workItemId。
    if (row.workItemId) {
      await publishIfAvailable(deps.bus, topics.session(row.workItemId).topic, eventTypes.permissionAsk, {
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

      // L37：路由目标必须是真实存在的活跃用户，否则审批会落进无人能看见的黑洞收件箱。
      // 既挡管理员经 /ask 路由到伪造 id，也挡 agent-runner 升级到已被删除的工作项负责人——
      // 两种情况都按「无有效审批人」降级为升级，而非创建一条永远不会被处理的 pending。
      let target: UserAuthRow | null = null;
      if (deps.users) {
        target = await deps.users.findActiveById(input.routedToUserId);
        if (!target) {
          return { outcome: "escalated", reason: "no_approver" };
        }
      }
      if (input.workItemId && deps.workItems) {
        const workItem = await deps.workItems.findWorkItemAccessRecord(input.workItemId);
        if (!workItem) {
          return { outcome: "escalated", reason: "no_approver" };
        }
        const candidate = target ?? ({ id: input.routedToUserId } as Pick<UserAuthRow, "id">);
        if (!canViewWorkItemRecord(toWorkItemAccessRecord(workItem), candidate, {
          orgId: input.actor.orgId,
          workspaceId: input.actor.workspaceId
        })) {
          return { outcome: "escalated", reason: "no_approver" };
        }
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

    async listPendingForUser(
      user: UserAuthRow,
      options: {
        locale?: WorkHubLocale;
        canReadWorkItem?: (workItemId: string | undefined) => Promise<boolean>;
      } = {}
    ) {
      const includeAll = user.isAdmin;
      // routes-a-2/services-a-2/xlink-authz-4/ux-web-govern-6：按 workItemId 去重的可见性缓存——多条审批
      // 常指向同一工作项，之前每一行都重新调用一次（重量级）canReadWorkItem，这里改成只判一次并复用结果。
      const workItemVisibility = new Map<string, Promise<boolean>>();
      const canReadApprovalRow = (row: ApprovalRequestRow) => {
        // approval_requests has no org/workspace columns. A work-item-less approval cannot be
        // tenant-scoped safely, so keep it in the routed user's personal inbox even for admins.
        if (!row.workItemId) {
          return Promise.resolve(row.routedToUserId === user.id);
        }
        if (!options.canReadWorkItem) {
          return Promise.resolve(true);
        }
        const cached = workItemVisibility.get(row.workItemId);
        if (cached) {
          return cached;
        }
        const pending = options.canReadWorkItem(row.workItemId);
        workItemVisibility.set(row.workItemId, pending);
        return pending;
      };
      let rows: ApprovalRequestRow[];
      let hasMore: boolean;
      let totalPending: number;
      let totalPendingCapped = false;
      if (includeAll || options.canReadWorkItem) {
        const visibleRows: ApprovalRequestRow[] = [];
        let visibleTotal = 0;
        let offset = 0;
        let scanned = 0;
        const chunkLimit = approvalCenterPageLimit;
        // routes-a-2/services-a-2/ux-web-govern-6：旧实现 `while(true)+offset` 无界翻页全组织 pending——
        // repo 层 L#W2-2 的 limit≤200 封顶被这个循环绕过。改成硬上限 approvalCenterScanCap：扫到这么多原始
        // pending 行就停，不管翻完没有；若真被封顶截断，totalPendingCapped=true，pending_total 如实标记为
        // 「扫描范围内的可见数」（下限估计），而不是假装数完了组织的真实总数。
        while (scanned < approvalCenterScanCap) {
          const chunk = await deps.approvals.listPendingForUser(user.id, {
            includeAll,
            limit: chunkLimit,
            offset
          });
          if (chunk.length === 0) {
            break;
          }
          offset += chunk.length;
          scanned += chunk.length;
          for (const row of chunk) {
            if (await canReadApprovalRow(row)) {
              visibleTotal += 1;
              if (visibleRows.length < approvalCenterPageLimit + 1) {
                visibleRows.push(row);
              }
            }
          }
          if (chunk.length < chunkLimit) {
            break;
          }
          if (scanned >= approvalCenterScanCap) {
            totalPendingCapped = true;
          }
        }
        rows = visibleRows.slice(0, approvalCenterPageLimit);
        hasMore = visibleRows.length > approvalCenterPageLimit || totalPendingCapped;
        totalPending = visibleTotal;
      } else {
        const loadedRows = await deps.approvals.listPendingForUser(user.id, {
          includeAll,
          limit: approvalCenterPageLimit + 1
        });
        rows = loadedRows.slice(0, approvalCenterPageLimit);
        hasMore = loadedRows.length > approvalCenterPageLimit;
        totalPending = await deps.approvals.countPendingForUser(user.id, { includeAll });
      }
      const itemOptions = options.locale ? { locale: options.locale } : {};
      const locale: WorkHubLocale = options.locale ?? "zh-CN";
      // L#W2-12：一次 IN 查询批量取所有审批的评论，再按 approvalId 分组，避免逐审批 N+1。
      const commentsByApproval = new Map<string, ApprovalCommentVM[]>();
      const commentsPageInfoByApproval = new Map<string, ApprovalCommentPageInfo>();
      if (deps.approvalComments?.listByApprovals) {
        try {
          for (const commentRow of await deps.approvalComments.listByApprovals(rows.map((row) => row.id), approvalCenterCommentsPerApproval + 1)) {
            const list = commentsByApproval.get(commentRow.approvalId) ?? [];
            list.push(toApprovalCommentVm(commentRow));
            commentsByApproval.set(commentRow.approvalId, list);
          }
          for (const row of rows) {
            const prefetched = commentsByApproval.get(row.id) ?? [];
            const hasMoreComments = prefetched.length > approvalCenterCommentsPerApproval;
            const visibleComments = hasMoreComments ? prefetched.slice(-approvalCenterCommentsPerApproval) : prefetched;
            commentsByApproval.set(row.id, visibleComments);
            commentsPageInfoByApproval.set(row.id, {
              limit: approvalCenterCommentsPerApproval,
              returned: visibleComments.length,
              has_more: hasMoreComments
            });
          }
        } catch {
          commentsByApproval.clear();
          commentsPageInfoByApproval.clear();
        }
      }
      // W2 inc3：逐项构建详情（join proposal.diff_manifest + 合成路由时间线 + 预取评论）。
      const detailEntries = await Promise.all(
        rows.map(async (row) =>
          [row.id, await buildApprovalItemDetail(row, deps, user.id, locale, commentsByApproval.get(row.id) ?? [], commentsPageInfoByApproval.get(row.id))] as const)
      );
      // findings[#79 同类]：返回前过 fail-closed 输出契约校验（装配走样 → 500，不甩 422）。
      // routes-a-2 修法：pending_total_capped 是 0/1 布尔标记（counts schema 只收数字，见 packages/contracts
      // approvalCenterVmSchema.counts = record<string, number>），=1 时前端应把 pending_total 理解为「扫描范围
      // 内的可见下限」而非组织真实总数——不新增 page_info 字段是因为该 schema 已固定 {limit,returned,has_more}，
      // 本次改动范围不含 packages/contracts。
      return parseOutputContract(approvalCenterVmSchema, {
        items: rows.map((row) => toApprovalAttentionItem(toRecord(row), itemOptions)),
        requests: rows.map(toApprovalRequestResponse),
        filters: { pending: true },
        counts: { pending: rows.length, pending_total: totalPending, pending_total_capped: totalPendingCapped ? 1 : 0 },
        page_info: { limit: approvalCenterPageLimit, returned: rows.length, has_more: hasMore },
        items_detail: Object.fromEntries(detailEntries) as ApprovalCenterVM["items_detail"]
      }, "approval-center.page") satisfies ApprovalCenterVM;
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
        now(),
        // findings[#27]：非 admin 必须在原子更新里复核单据仍路由给本人（堵 delegate 交错的 TOCTOU）；
        // admin override 跳过（ensureCanActOnApproval 已允许 admin 处理任意路由的单据）。
        actor.isAdmin ? undefined : approverId(actor)
      );
      if (!updated) {
        throw new ApprovalServiceError(409, "approval_race", "这条审批已经被处理过了。");
      }

      let learnedPolicy: Awaited<ReturnType<typeof deps.policies.createPermissionPolicy>> | undefined;
      let learnFailed = false;
      // 决策 CAS 已提交(updated)。普通 approval.decided 审计和 publish 仍是 post-commit best-effort；
      // remember:'always' 新建 allow 策略会扩大 AI 后续权限，必须先写 permission_policy.created 审计。
      // 若学习失败，只跳过 standing permission 并在 approval.decided 上标记，不能翻掉已提交决策。
      if (shouldLearn) {
        try {
          const policyInput = {
            scopeKind: "session",
            scopeId: updated.agentRunId ?? actor.id,
            actionPattern: updated.actionPattern,
            effect: "allow",
            priority: 0,
            learnedFromSession: true,
            ...(actor.userId ? { createdByUserId: actor.userId } : {}),
            orgId: actor.orgId,
            workspaceId: actor.workspaceId
          } as const;
          const existingPolicy = findEquivalentActivePolicy(await deps.policies.listActivePolicies(), actor, policyInput);
          learnedPolicy = existingPolicy ?? await createAuditedPermissionPolicy(actor, policyInput);
        } catch (error) {
          learnFailed = true;
          getDefaultStructuredLogger().warn("approvals_remember_always_learning_failed", { id, error });
        }
      }
      try {
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
            ...(learnedPolicy ? { learned_policy_id: learnedPolicy.id } : {}),
            ...(learnFailed ? { learn_failed: true } : {})
          }
        });
      } catch (error) {
        getDefaultStructuredLogger().warn("approvals_post_commit_policy_audit_failed", { id, error });
      }

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
      let target: UserAuthRow | null = null;
      if (deps.users) {
        target = await deps.users.findActiveById(toUserId);
        if (!target) {
          throw new ApprovalServiceError(404, "delegate_target_not_found", "找不到要转交的成员。");
        }
      }

      // 与 routeApprover/usableCandidate 一致的转交守卫：审批挂在某个工作项上时，转交目标必须
      // (a) 不是发起请求的本人（工作项提交人——否则把单据踢回原申请人，等于无效转交），且
      // (b) 真的能看到该工作项（否则审批落进一个看不到上下文的人的收件箱，与 routeApprover 漏检对称）。
      if (approval.workItemId && deps.workItems) {
        const workItem = await deps.workItems.findWorkItemAccessRecord(approval.workItemId);
        if (workItem) {
          if (toUserId === workItem.submitterUserId) {
            throw new ApprovalServiceError(422, "delegate_to_requester", "不能把审批转交回发起人。");
          }
          // target 可能未取（无 deps.users 的旧夹具）——此时回退到仅凭 id 构造可见性主体。
          const candidate = target ?? ({ id: toUserId } as Pick<UserAuthRow, "id">);
          if (!canViewWorkItemRecord(toWorkItemAccessRecord(workItem), candidate, {
            orgId: actor.orgId,
            workspaceId: actor.workspaceId
          })) {
            throw new ApprovalServiceError(422, "delegate_target_cannot_view", "这位成员看不到这个事项，没法转交。");
          }
        }
      }

      const previousUserId = approval.routedToUserId;
      const requiredRoutedToUserId = actor.isAdmin ? undefined : approverId(actor);
      const updated = await deps.approvals.delegatePending(id, toUserId, now(), requiredRoutedToUserId);
      if (!updated) {
        throw new ApprovalServiceError(409, "approval_race", "这条审批已经被处理过了。");
      }

      try {
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
      } catch (error) {
        getDefaultStructuredLogger().warn("approvals_post_commit_delegate_audit_failed", { id, error });
      }

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
      try {
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
      } catch (error) {
        getDefaultStructuredLogger().warn("approvals_comment_audit_failed", { approval_id: id, comment_id: created.id, error });
      }
      // @mentions：best-effort 给被点名的活跃用户发通知（失败不影响评论写入）。
      await notifyCommentMentions({
        approval,
        actor,
        body,
        authorUserId: approverId(actor),
        authorLabel: actorNickname(actor),
        commentId: created.id
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
        try {
          await auditApprovalAction(updated, {
            action: "approval.expired",
            actor: { kind: "system", label: "WorkHub" },
            detail: {
              next_action: nextAction,
              escalated: nextAction === "escalate_pm",
              routed_to_user_id: updated.routedToUserId
            }
          });
        } catch (error) {
          getDefaultStructuredLogger().warn("approvals_post_expire_audit_failed", { id: updated.id, error });
        }
        await publishIfAvailable(
          deps.bus,
          updated.routedToUserId ? topics.user(updated.routedToUserId).topic : undefined,
          eventTypes.permissionExpired,
          eventData
        );
        if (updated.workItemId) {
          await publishIfAvailable(deps.bus, topics.workitem(updated.workItemId).topic, eventTypes.permissionExpired, eventData);
          // findings[#169]：会话流订阅 session:<workItemId>，原来发到 session:<agentRunId> 是死扇出。
          await publishIfAvailable(deps.bus, topics.session(updated.workItemId).topic, eventTypes.permissionExpired, eventData);
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
      assertPolicyScopeWithinActorTenant(actor, input);
      const existing = findEquivalentActivePolicy(await deps.policies.listActivePolicies(), actor, {
        scopeKind: input.scope_kind,
        scopeId: input.scope_id,
        actionPattern: input.action_pattern,
        effect: input.effect,
        priority: input.priority
      });
      if (existing) {
        return existing;
      }
      const policyInput = {
        scopeKind: input.scope_kind,
        scopeId: input.scope_id,
        actionPattern: input.action_pattern,
        effect: input.effect,
        priority: input.priority,
        learnedFromSession: input.learned_from_session,
        ...(actor.userId ? { createdByUserId: actor.userId } : {}),
        // 租户隔离：策略始终写进 actor 自己的 org/workspace，绝不信任 client 传入的 org_id/workspace_id
        // （否则管理员可越权往别的租户写策略）。
        orgId: actor.orgId,
        workspaceId: actor.workspaceId
      } satisfies CreatePermissionPolicyInput;
      // L23/Batch 2-3：策略创建（含 allow 授权扩权）必须先留审计，审计写失败不得插入新策略。
      return createAuditedPermissionPolicy(actor, policyInput);
    },

    async listPolicies(actor?: AuthActor) {
      const active = await deps.policies.listActivePolicies();
      return actor ? active.filter((policy) => permissionPolicyMatchesActorTenant(policy, actor)) : active;
    },

    // M24：权限策略撤销。此前 softDeletePolicy 存在但无任何路由/服务调用它——学到的 allow 授权
    // （respond remember:'always'）或管理员手写策略一旦建立就永远撤不掉（RBAC 降权缺口）。
    async revokePolicy(actor: AuthActor, id: string) {
      if (!actor.isAdmin) {
        throw new ApprovalServiceError(403, "forbidden", "只有管理员可以撤销权限策略。");
      }
      const active = await deps.policies.listActivePolicies();
      const target = active.find((policy) => policy.id === id);
      // 找不到，或不属于本租户：一律当「未找到」（防跨租户撤销 + 避免存在性泄露）。
      if (!target || !permissionPolicyMatchesActorTenant(target, actor)) {
        throw new ApprovalServiceError(404, "permission_policy_not_found", "找不到这条权限策略。");
      }
      const equivalentPolicies = active.filter((policy) =>
        policy.id
        && permissionPolicyMatchesActorTenant(policy, actor)
        && samePermissionPolicyIdentity(policy, target)
      );
      const revokedPolicyIds: string[] = [];
      let revoked: PermissionPolicyRecord | null = null;
      for (const policy of equivalentPolicies) {
        const deleted = await deps.policies.softDeletePolicy(policy.id as string, actor.userId ?? actor.id, now());
        if (!deleted) {
          continue;
        }
        revokedPolicyIds.push(policy.id as string);
        if (policy.id === id) {
          revoked = deleted;
        }
      }
      if (!revoked) {
        throw new ApprovalServiceError(404, "permission_policy_not_found", "找不到这条权限策略。");
      }
      await auditPermissionPolicyActionBestEffort({
        actorKind: actor.kind,
        actorNickname: actor.label,
        entityType: "permission_policy",
        entityId: id,
        action: "permission_policy.revoked",
        ...(actor.orgId ? { orgId: actor.orgId } : {}),
        ...(actor.workspaceId ? { workspaceId: actor.workspaceId } : {}),
        ...(actor.userId ? { actorUserId: actor.userId } : {}),
        detailJson: {
          scope_kind: target.scopeKind,
          scope_id: target.scopeId,
          action_pattern: target.actionPattern,
          effect: target.effect,
          learned_from_session: target.learnedFromSession ?? false,
          ...(revokedPolicyIds.length > 1 ? { revoked_policy_ids: revokedPolicyIds } : {})
        }
      });
      return revoked;
    }
  };
}
