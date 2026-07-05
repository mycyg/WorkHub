import { randomUUID } from "node:crypto";

import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  applyMergeProposalCandidateRequestSchema,
  chooseMergeProposalCandidateRequestSchema,
  createProposalFromManifestRequestSchema,
  eventTypes,
  mergeProposalCandidateChoiceResultSchema,
  mergeProposalRequestSchema,
  proposalConflictListResultSchema,
  proposalMergeResultSchema,
  proposalReviewResultSchema,
  reviewProposalRequestSchema,
  type AuditLogFact,
  type AttentionItem,
  type ProposalReviewResult
} from "@workhub/contracts";
import { makeWorkHubEvent, topics } from "@workhub/events";
import { getDefaultPushBus, type PushBus } from "../broker/index.js";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthActor,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultProposalService,
  ProposalServiceError,
  ProposalServiceMergeConflictError,
  ProposalServiceRebaseRequiredError,
  type ProposalActor,
  type ProposalService,
  type StoredProposal
} from "../services/proposals.js";
import {
  getDefaultWorkItemService,
  type WorkItemService
} from "../services/work-items.js";
import { taskPlanApprovalTarget } from "../services/task-plan-approval.js";
import { parseOutputContract } from "../pages/output-contract.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

type TaskPlanRouteDispatcher = {
  dispatch: (input: {
    planId: string;
    workspaceId: string;
    orgId?: string;
    actorId?: string;
  }) => Promise<unknown>;
};

export type ProposalRoutesDependencies = {
  auth?: AuthDependencySource;
  proposals?: ProposalService;
  workItems?: Pick<WorkItemService, "detailPage" | "assertCanMutateArtifacts"> | false;
  taskPlanDispatcher?: TaskPlanRouteDispatcher | false;
  // findings[#168/H12]：合并/评审/打回事件原本只塞进 HTTP 响应、从不 publish 到总线，其它客户端的 SSE 实时
  // 刷新因此失效。注入 PushBus 后在各操作成功后 best-effort 发布。
  bus?: Pick<PushBus, "publish">;
  logger?: Pick<typeof console, "warn">;
};

function actorFor(actor?: AuthActor) {
  if (!actor) {
    return {
      actor_kind: "system" as const,
      label: "WorkHub API"
    };
  }
  if (actor.kind === "human") {
    return {
      actor_kind: "human" as const,
      actor_user_id: actor.userId ?? actor.id,
      label: actor.label
    };
  }
  return {
    actor_kind: actor.kind,
    label: actor.label
  };
}

function nowIso() {
  return new Date().toISOString();
}

function proposalActorFor(actor?: AuthActor): ProposalActor {
  const resolved = actorFor(actor);
  return {
    actor_kind: resolved.actor_kind,
    ...(resolved.actor_user_id ? { actor_user_id: resolved.actor_user_id } : {}),
    ...(actor?.workspaceId ? { workspaceId: actor.workspaceId } : {}),
    ...(resolved.label ? { label: resolved.label } : {})
  };
}

function auditActorFor(actor: ReturnType<typeof actorFor>): AuditLogFact["actor"] {
  return {
    actor_kind: actor.actor_kind,
    ...(actor.actor_user_id ? { actor_user_id: actor.actor_user_id } : {}),
    ...(actor.label ? { actor_nickname: actor.label } : {})
  };
}

function latestReview(proposal: StoredProposal) {
  return proposal.reviews.at(-1);
}

function isTaskPlanProposal(proposal: StoredProposal) {
  return proposal.diff_manifest.changes.some((item) =>
    item.target_kind === "structured_record"
    && item.target_ref.entity_type === "task_plan"
  );
}

function confirmationRequiredResponse(c: Context<AuthEnv>) {
  return c.json({
    ok: false,
    error: {
      code: "confirmation_required",
      message: "请确认后再执行这个变更操作。",
      recoverable: true
    }
  }, 409);
}

function reasonFeedbackAudit(input: {
  actor: ReturnType<typeof actorFor>;
  proposal: StoredProposal;
  reasonMd: string;
  createdAt: string;
}): AuditLogFact {
  const review = latestReview(input.proposal);
  return {
    id: randomUUID(),
    actor: auditActorFor(input.actor),
    entity: { entity_type: "proposal", entity_id: input.proposal.id },
    action: "reason_fed_back",
    detail_json: {
      proposal_id: input.proposal.id,
      work_item_id: input.proposal.work_item_id,
      ...(review?.id ? { review_id: review.id } : {}),
      reason_fed_back: true,
      reason_preview: input.reasonMd.slice(0, 160)
    },
    created_at: input.createdAt
  };
}

function reasonFeedbackEvent(input: {
  actor: ReturnType<typeof actorFor>;
  proposalId: string;
  workItemId: string;
  reasonMd: string;
  createdAt: string;
  attention: AttentionItem;
  reviewId?: string;
  runId?: string;
  projectId?: string;
}) {
  return makeWorkHubEvent({
    event_id: randomUUID(),
    type: eventTypes.revisionFedback,
    topic: topics.workitem(input.workItemId).topic,
    ts: new Date(input.createdAt),
    actor: input.actor,
    work_item_id: input.workItemId,
    ...(input.projectId ? { project_id: input.projectId } : {}),
    ...(input.runId ? { run_id: input.runId } : {}),
    proposal_id: input.proposalId,
    preview_text: "打回原因已回灌给下一轮 AI。",
    attention: input.attention,
    cuu_state: "revision_requested",
    data: {
      proposal_id: input.proposalId,
      work_item_id: input.workItemId,
      correction: input.reasonMd,
      reason_fed_back: true,
      ...(input.reviewId ? { review_id: input.reviewId } : {})
    }
  });
}

function genericReviewAttention(input: {
  proposal: StoredProposal;
  decision: "approve" | "request_changes";
  reason?: string;
  createdAt: string;
}): AttentionItem {
  const approve = input.decision === "approve";
  const planReview = isTaskPlanProposal(input.proposal);
  return {
    id: randomUUID(),
    kind: planReview ? "plan_review" : "proposal_review",
    priority: approve ? "normal" : "high",
    work_item_id: input.proposal.work_item_id,
    source_ref: { entity_type: "proposal", entity_id: input.proposal.id },
    title: approve ? `${input.proposal.title} 已通过确认` : `${input.proposal.title} 需要修改`,
    summary_text: approve
      ? (planReview ? "计划已确认，可以选择立即开始执行或先暂缓。" : "接下来可以把这份交付物变更采纳到正式版本。")
      : input.reason ?? (planReview ? "这份任务计划已被打回，原因会回灌给下一轮 AI。" : "这份变更申请已被打回，原因会回灌给下一轮 AI。"),
    reason_text: approve
      ? (planReview ? "这是一份可审计的任务计划提议。" : "这是一份可审计的交付物变更申请。")
      : "打回原因已进入下一轮上下文。",
    actions: approve
      ? (planReview
          ? [
              {
                id: "approve_and_dispatch",
                label: "批准并开始执行",
                style: "primary",
                method: "POST",
                href: `/api/proposals/${input.proposal.id}/merge`,
                request_json: { dispatch: true }
              },
              {
                id: "approve_hold",
                label: "批准但先不跑",
                style: "secondary",
                method: "POST",
                href: `/api/proposals/${input.proposal.id}/merge`,
                request_json: { dispatch: false }
              },
              {
                id: "open_proposal",
                label: "查看计划提议",
                style: "secondary",
                method: "GET",
                href: `/proposals/${input.proposal.id}`
              }
            ]
          : [
              {
                id: "merge",
                label: "采纳到正式版",
                style: "primary",
                method: "POST",
                href: `/api/proposals/${input.proposal.id}/merge`
              }
            ])
      : [
          {
            id: "open_proposal",
            label: planReview ? "查看计划提议" : "查看变更申请",
            style: "primary",
            method: "GET",
            href: `/proposals/${input.proposal.id}`
          }
        ],
    cuu_state: approve ? "carrying_document" : "revision_requested",
    created_at: input.createdAt
  };
}

function genericMergeAttention(proposal: StoredProposal, createdAt: string): AttentionItem {
  return {
    id: randomUUID(),
    kind: "delivery_ready",
    priority: "normal",
    work_item_id: proposal.work_item_id,
    source_ref: { entity_type: "proposal", entity_id: proposal.id },
    title: `${proposal.title} 已采纳`,
    summary_text: "交付物变更已进入正式版本，审计和回滚信息已保留。",
    reason_text: proposal.diff_manifest.rollback.available ? "这次变更保留了回滚入口。" : "这次变更缺少可用回滚快照。",
    actions: [
      {
        id: "open_proposal",
        label: "查看变更申请",
        style: "primary",
        method: "GET",
        href: `/proposals/${proposal.id}`
      }
    ],
    cuu_state: "celebrating",
    created_at: createdAt
  };
}

function taskPlanMergeAttention(proposal: StoredProposal, createdAt: string, dispatch: boolean): AttentionItem {
  return {
    id: randomUUID(),
    kind: "delivery_ready",
    priority: "normal",
    work_item_id: proposal.work_item_id,
    source_ref: { entity_type: "proposal", entity_id: proposal.id },
    title: `${proposal.title} 已批准`,
    summary_text: dispatch ? "任务计划已批准，子任务会开始执行。" : "任务计划已批准，暂不开始执行。",
    reason_text: dispatch ? "后续执行会继续进入可审计的事项流。" : "计划保持已批准状态，需要时可以再手动开始。",
    actions: [
      {
        id: "open_proposal",
        label: "查看计划提议",
        style: "primary",
        method: "GET",
        href: `/proposals/${proposal.id}`
      }
    ],
    cuu_state: dispatch ? "carrying_document" : "asking_approval",
    created_at: createdAt
  };
}

function mergeResultFor(input: {
  proposal: StoredProposal;
  actor: ReturnType<typeof actorFor>;
  userId: string;
  createdAt: string;
  attention?: AttentionItem;
}) {
  const attention = input.attention ?? genericMergeAttention(input.proposal, input.createdAt);
  const mergeSnapshotId = input.proposal.merge_snapshot_id;
  if (!mergeSnapshotId) {
    throw new ProposalServiceError(409, "merge_snapshot_missing", "这份变更申请缺少合并快照，请刷新后重新生成或联系管理员处理。");
  }
  const proposalMerged = makeWorkHubEvent({
    event_id: randomUUID(),
    type: eventTypes.proposalMerged,
    topic: topics.workitem(input.proposal.work_item_id).topic,
    ts: new Date(input.createdAt),
    actor: input.actor,
    work_item_id: input.proposal.work_item_id,
    proposal_id: input.proposal.id,
    preview_text: `${input.proposal.title} 已采纳。`,
    attention,
    data: {
      proposal_id: input.proposal.id,
      merge_snapshot_id: mergeSnapshotId,
      rollback_available: input.proposal.diff_manifest.rollback.available
    }
  });
  const notification = makeWorkHubEvent({
    event_id: randomUUID(),
    type: eventTypes.notificationCreated,
    topic: topics.user(input.userId).topic,
    ts: new Date(input.createdAt),
    actor: { actor_kind: "system", label: "notification-service" },
    work_item_id: input.proposal.work_item_id,
    proposal_id: input.proposal.id,
    preview_text: `${input.proposal.title} 已采纳。`,
    attention,
    data: attention
  });
  const auditLogs = [
    {
      id: randomUUID(),
      actor: auditActorFor(input.actor),
      entity: { entity_type: "proposal", entity_id: input.proposal.id },
      action: "proposal.merged",
      detail_json: {
        rollback_available: input.proposal.diff_manifest.rollback.available,
        changes: input.proposal.diff_manifest.changes.length
      },
      snapshot_id: mergeSnapshotId,
      created_at: input.createdAt
    }
  ];

  return parseOutputContract(proposalMergeResultSchema, {
    proposal_id: input.proposal.id,
    work_item_id: input.proposal.work_item_id,
    status: "merged",
    merge_snapshot_id: mergeSnapshotId,
    rollback_available: input.proposal.diff_manifest.rollback.available,
    rollback: input.proposal.diff_manifest.rollback,
    attention,
    events: [proposalMerged, notification],
    audit_logs: auditLogs
  }, "proposal.merge-result");
}

// 直接重抛领域错误：app.onError 有 ProposalServiceError/WorkItemServiceError 专门分支，会保留真实
// error.code（及冲突/rebase 子类的 details）。此前包成 HTTPException 会把 409/422/415 等状态的 code
// 统统抹成 "http_error"，客户端据 code 分支（如 stale_base→rebase 流、proposal_already_merged）就失灵了。
// findings[#168/H12]：把已构造的 WorkHubEvent 信封 best-effort 发布到各自 topic（envelope.topic/.type 已设好）。
// 与 agent-runner/approvals 同口径：发布失败绝不能拖垮已成功的合并/评审操作，故逐条 try/catch 吞错。
async function publishProposalEvents(
  bus: Pick<PushBus, "publish"> | undefined,
  events: ReadonlyArray<{ topic: string; type: string } & Record<string, unknown>>,
  logger: Pick<typeof console, "warn"> = console
) {
  if (!bus) {
    return;
  }
  for (const event of events) {
    try {
      await bus.publish(event.topic, event.type, event);
    } catch (error) {
      // best-effort：丢一次实时刷新可接受，绝不让总线故障使 HTTP 操作失败；但不能无声吞掉。
      logger.warn("WorkHub proposal event publish failed", {
        topic: event.topic,
        type: event.type,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

function handleProposalServiceError(error: unknown): never {
  throw error;
}

function handleWorkItemAccessError(error: unknown): never {
  throw error;
}

async function dispatchWithDefaultTaskDispatcher(input: Parameters<TaskPlanRouteDispatcher["dispatch"]>[0]) {
  const [{ getDefaultAgentRunQueue }, { getDefaultTaskDispatcher }] = await Promise.all([
    import("../workers/agent-runner.js"),
    import("../services/task-dispatcher.js")
  ]);
  return getDefaultTaskDispatcher(getDefaultAgentRunQueue()).dispatch(input);
}

export function createProposalRoutes(deps: ProposalRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const authMiddleware = createCurrentUserMiddleware(authSource);
  const proposals = deps.proposals ?? getDefaultProposalService();
  const workItems = deps.workItems === false ? undefined : deps.workItems ?? getDefaultWorkItemService();
  const taskPlanDispatcher = deps.taskPlanDispatcher === false
    ? undefined
    : deps.taskPlanDispatcher ?? { dispatch: dispatchWithDefaultTaskDispatcher };
  const bus = deps.bus ?? getDefaultPushBus();
  const eventLogger = deps.logger ?? console;

  async function assertCanReadWorkItem(workItemId: string, actor: AuthActor) {
    if (!workItems) {
      throw new HTTPException(403, { message: "没有权限查看这个事项。" });
    }
    try {
      await workItems.detailPage({ workItemId, actor });
    } catch (error) {
      handleWorkItemAccessError(error);
    }
  }

  async function assertCanMutateWorkItem(workItemId: string, actor: AuthActor) {
    if (!workItems) {
      throw new HTTPException(403, { message: "没有权限修改这个事项。" });
    }
    try {
      await workItems.assertCanMutateArtifacts({ workItemId, actor });
    } catch (error) {
      handleWorkItemAccessError(error);
    }
  }

  async function readProposalForActor(proposalId: string, actor: AuthActor) {
    // R4-1：畸形（非 UUID）proposalId 直接落 404（与不存在同形，不泄露存在性），
    // 避免冒泡到 PG uuid 列触发 22P02→未捕获 500。覆盖 /:id 及 /:id/{review,merge,rebase}。
    if (!isUuidParam(proposalId)) {
      throw new HTTPException(404, { message: "没有找到这个变更申请。" });
    }
    const proposal = await proposals.get(proposalId);
    if (!proposal) {
      throw new HTTPException(404, { message: "没有找到这个变更申请。" });
    }
    await assertCanReadWorkItem(proposal.work_item_id, actor);
    return proposal;
  }

  routes.get("/:id", authMiddleware, async (c) => {
    const proposal = await readProposalForActor(c.req.param("id"), c.var.actor);
    const { reviews: _reviews, ...data } = proposal;
    return c.json({ ok: true, data });
  });

  routes.post("/:id/review", authMiddleware, async (c) => {
    // L3：先鉴权再解析请求体——否则未授权者会先收到 schema 校验 400（泄露请求体形状/字段要求），
    // 拿不到本应优先返回的 404/403。授权检查（readProposalForActor → assertCanReadWorkItem）置于解析之前。
    const proposalForAccess = await readProposalForActor(c.req.param("id"), c.var.actor);
    await assertCanMutateWorkItem(proposalForAccess.work_item_id, c.var.actor);
    const payload = reviewProposalRequestSchema.parse(await readJsonObject(c));
    let proposal: StoredProposal;
    try {
      proposal = await proposals.review({
        proposalId: c.req.param("id"),
        actor: proposalActorFor(c.var.actor),
        decision: payload.decision,
        ...(payload.reason_md ? { reasonMd: payload.reason_md } : {}),
        ...(payload.remember ? { remember: payload.remember } : {})
      });
    } catch (error) {
      handleProposalServiceError(error);
    }
    const createdAt = nowIso();
    const attention = genericReviewAttention({
      proposal,
      decision: payload.decision,
      ...(payload.reason_md ? { reason: payload.reason_md } : {}),
      createdAt
    });
    const actor = actorFor(c.var.actor);
    const event = makeWorkHubEvent({
      event_id: randomUUID(),
      type: eventTypes.proposalReviewed,
      topic: topics.workitem(proposal.work_item_id).topic,
      ts: new Date(createdAt),
      actor,
      work_item_id: proposal.work_item_id,
      proposal_id: proposal.id,
      preview_text: payload.decision === "approve" ? `${proposal.title} 已通过确认。` : `打回原因：${payload.reason_md}`,
      attention,
      data: {
        proposal_id: proposal.id,
        decision: payload.decision,
        ...(payload.reason_md ? { reason_md: payload.reason_md } : {})
      }
    });
    const resultBase: ProposalReviewResult = {
      proposal_id: proposal.id,
      work_item_id: proposal.work_item_id,
      status: payload.decision === "approve" ? "reviewed" : "revision_requested",
      decision: payload.decision,
      attention,
      event
    };
    if (payload.reason_md) {
      resultBase.reason_md = payload.reason_md;
    }
    if (payload.decision === "approve") {
      const planReview = isTaskPlanProposal(proposal);
      resultBase.next_action = {
        id: planReview ? "approve_and_dispatch" : "merge",
        label: planReview ? "批准并开始执行" : "采纳到正式版",
        method: "POST",
        href: `/api/proposals/${proposal.id}/merge`,
        ...(planReview ? { request_json: { dispatch: true } } : {})
      };
    } else if (payload.reason_md) {
      const review = latestReview(proposal);
      const auditLog = reasonFeedbackAudit({
        actor,
        proposal,
        reasonMd: payload.reason_md,
        createdAt
      });
      resultBase.next_agent_context = {
        work_item_id: proposal.work_item_id,
        correction: payload.reason_md,
        reason_fed_back: true
      };
      resultBase.feedback_event = reasonFeedbackEvent({
          actor,
          proposalId: proposal.id,
          workItemId: proposal.work_item_id,
          reasonMd: payload.reason_md,
          createdAt,
          attention,
          ...(review?.id ? { reviewId: review.id } : {})
      });
      resultBase.audit_logs = [auditLog];
    }

    // findings[#168/H12]：发布 proposal.reviewed（及打回时的 revision.fedback），让其它客户端实时刷新。
    await publishProposalEvents(bus, [event, ...(resultBase.feedback_event ? [resultBase.feedback_event] : [])], eventLogger);
    return c.json({ ok: true, data: parseOutputContract(proposalReviewResultSchema, resultBase, "proposal.review-result") });
  });

  routes.post("/:id/merge", authMiddleware, async (c) => {
    // findings：鉴权先于请求体解析（与 /review 一致，L3 修过 review 但 merge 漏了）——未授权者发畸形 body
    // 应拿 403/404 而非泄露 schema 的 400。
    const proposalForAccess = await readProposalForActor(c.req.param("id"), c.var.actor);
    await assertCanMutateWorkItem(proposalForAccess.work_item_id, c.var.actor);
    if (proposalForAccess.status === "merged") {
      throw new ProposalServiceError(409, "proposal_already_merged", "这份变更申请已经被采纳。");
    }
    const payload = mergeProposalRequestSchema.parse(await readJsonObject(c));
    if (payload.confirm === false) {
      return confirmationRequiredResponse(c);
    }
    let proposal: StoredProposal;
    try {
      proposal = await proposals.merge({
        proposalId: c.req.param("id"),
        actor: proposalActorFor(c.var.actor),
        ...(payload.conflict_resolution
          ? {
              conflictResolution: {
                acceptIncomingTargetKeys: payload.conflict_resolution.accept_incoming_target_keys,
                ...(payload.conflict_resolution.bulk_action
                  ? {
                      bulkAction: {
                        action: payload.conflict_resolution.bulk_action.action,
                        targetKeys: payload.conflict_resolution.bulk_action.target_keys,
                        ...(payload.conflict_resolution.bulk_action.conflict_count !== undefined
                          ? { conflictCount: payload.conflict_resolution.bulk_action.conflict_count }
                          : {})
                      }
                    }
                  : {})
              }
            }
          : {})
      });
    } catch (error) {
      if (error instanceof ProposalServiceMergeConflictError) {
        return c.json({
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            details: {
              conflicts: error.conflicts
            },
            recoverable: true
          }
        }, 409);
      }
      // P-COLLAB「对一下底稿再采纳」：撞上最后防线但有 base 快照时,回去黑话卡片 + 重算的冲突,前端走 /rebase。
      if (error instanceof ProposalServiceRebaseRequiredError) {
        return c.json({
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            details: {
              conflicts: error.conflicts,
              card: error.card
            },
            recoverable: true
          }
        }, 409);
      }
      handleProposalServiceError(error);
    }
    const taskPlanTarget = taskPlanApprovalTarget(proposal);
    const shouldDispatchTaskPlan = Boolean(taskPlanTarget && payload.dispatch !== false);
    if (shouldDispatchTaskPlan && taskPlanTarget && taskPlanDispatcher) {
      try {
        await taskPlanDispatcher.dispatch({
          planId: taskPlanTarget.planId,
          workspaceId: taskPlanTarget.workspaceId,
          orgId: c.var.actor.orgId,
          actorId: c.var.actor.userId ?? c.var.actor.id
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        eventLogger.warn("WorkHub task-plan dispatch after proposal merge failed", {
          proposalId: proposal.id,
          workItemId: proposal.work_item_id,
          planId: taskPlanTarget.planId,
          error: message
        });
        throw new ProposalServiceError(
          503,
          "task_plan_dispatch_failed",
          "任务计划已经批准，但子任务启动失败，请稍后刷新后重试。"
        );
      }
    }
    const createdAt = nowIso();
    const mergeResult = mergeResultFor({
      proposal,
      actor: actorFor(c.var.actor),
      userId: c.var.currentUser.id,
      createdAt,
      ...(taskPlanTarget ? { attention: taskPlanMergeAttention(proposal, createdAt, payload.dispatch !== false) } : {})
    });
    // findings[#168/H12]：发布 proposal.merged（→ workitem topic）+ notification.created（→ user topic）。
    await publishProposalEvents(bus, mergeResult.events, eventLogger);
    return c.json({ ok: true, data: mergeResult });
  });

  // P-COLLAB：对最新正式版重算冲突/候选,交回前端用既有三选项解决,然后重新采纳。不动账本。
  routes.post("/:id/rebase", authMiddleware, async (c) => {
    const proposalForAccess = await readProposalForActor(c.req.param("id"), c.var.actor);
    await assertCanMutateWorkItem(proposalForAccess.work_item_id, c.var.actor);
    try {
      const result = await proposals.rebase({
        proposalId: c.req.param("id"),
        actor: proposalActorFor(c.var.actor)
      });
      return c.json({ ok: true, data: result });
    } catch (error) {
      handleProposalServiceError(error);
    }
  });

  return routes;
}

export function createWorkItemProposalRoutes(deps: ProposalRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const proposals = deps.proposals ?? getDefaultProposalService();
  const workItems = deps.workItems === false ? undefined : deps.workItems ?? getDefaultWorkItemService();
  const bus = deps.bus ?? getDefaultPushBus();
  const eventLogger = deps.logger ?? console;

  async function assertCanReadWorkItem(workItemId: string, actor: AuthActor) {
    if (!workItems) {
      throw new HTTPException(403, { message: "没有权限查看这个事项。" });
    }
    // 路由 uuid 形参先校验：非 uuid 串原本直达 detailPage 的 uuid 列 → PG 22P02 → 误报 500；
    // 与「合法但不存在」同样回 404，不泄露事项存在性。
    if (!isUuidParam(workItemId)) {
      throw new HTTPException(404, { message: "没有找到这个事项。" });
    }
    try {
      await workItems.detailPage({ workItemId, actor });
    } catch (error) {
      handleWorkItemAccessError(error);
    }
  }

  async function assertCanMutateWorkItem(workItemId: string, actor: AuthActor) {
    if (!workItems) {
      throw new HTTPException(403, { message: "没有权限修改这个事项。" });
    }
    if (!isUuidParam(workItemId)) {
      throw new HTTPException(404, { message: "没有找到这个事项。" });
    }
    try {
      await workItems.assertCanMutateArtifacts({ workItemId, actor });
    } catch (error) {
      handleWorkItemAccessError(error);
    }
  }

  async function readProposalByMergeProposalForActor(mergeProposalId: string, actor: AuthActor) {
    // 路由 uuid 形参先校验：非 uuid 串原本直达 getByMergeProposal 的 uuid 列 → PG 22P02 → 误报 500；
    // 与「合法但不存在」同样回 404，不泄露合并建议存在性。
    if (!isUuidParam(mergeProposalId)) {
      throw new HTTPException(404, { message: "没有找到这个合并建议。" });
    }
    const proposal = await proposals.getByMergeProposal(mergeProposalId);
    if (!proposal) {
      throw new HTTPException(404, { message: "没有找到这个合并建议。" });
    }
    await assertCanReadWorkItem(proposal.work_item_id, actor);
    return proposal;
  }

  routes.post("/workitems/:id/proposals", createCurrentUserMiddleware(authSource), async (c) => {
    // findings[#15]：先鉴权再解析请求体（与 /review、/merge 一致）——未授权者发畸形 body 应拿 403/404 而非
    // 泄露 schema 的校验 422。assertCanReadWorkItem 同时承担 uuid 形参校验，置于解析之前。
    await assertCanMutateWorkItem(c.req.param("id"), c.var.actor);
    const payload = createProposalFromManifestRequestSchema.parse(await readJsonObject(c));
    try {
      const proposal = await proposals.createFromManifest({
        workItemId: c.req.param("id"),
        manifest: payload.manifest,
        actor: proposalActorFor(c.var.actor),
        ...(payload.title ? { title: payload.title } : {}),
        ...(payload.branch_id ? { branchId: payload.branch_id } : {})
      });
      const { reviews: _reviews, ...data } = proposal;
      return c.json({ ok: true, data }, 201);
    } catch (error) {
      handleProposalServiceError(error);
    }
  });

  routes.get("/workitems/:id/proposals", createCurrentUserMiddleware(authSource), async (c) => {
    await assertCanReadWorkItem(c.req.param("id"), c.var.actor);
    const rows = await proposals.listByWorkItem(c.req.param("id"));
    return c.json({
      ok: true,
      data: rows.map(({ reviews: _reviews, ...proposal }) => proposal)
    });
  });

  routes.get("/workitems/:id/conflicts", createCurrentUserMiddleware(authSource), async (c) => {
    await assertCanReadWorkItem(c.req.param("id"), c.var.actor);
    const result = await proposals.listConflicts(c.req.param("id"));
    return c.json({
      ok: true,
      data: parseOutputContract(proposalConflictListResultSchema, result, "proposal.conflict-list")
    });
  });

  routes.post("/merge-proposals/:id/choose", createCurrentUserMiddleware(authSource), async (c) => {
    // findings[#15]：先鉴权再解析请求体（与 /review、/merge 一致）——未授权者发畸形 body 应拿 403/404 而非
    // 泄露 schema 的校验 422。readProposalByMergeProposalForActor 同时承担 uuid 形参校验，置于解析之前。
    const proposalForAccess = await readProposalByMergeProposalForActor(c.req.param("id"), c.var.actor);
    await assertCanMutateWorkItem(proposalForAccess.work_item_id, c.var.actor);
    const payload = chooseMergeProposalCandidateRequestSchema.parse(await readJsonObject(c));
    // L5：keep_current / accept_incoming 不经候选「选择 + 应用」路由——apply 只认 ai_fusion，选了它们会
    // 把变更申请永久卡在 reviewed 且冲突反复出现（死状态）。这两种解析在合并接口里内联完成：采纳来方填
    // conflict_resolution.accept_incoming_target_keys；保留现状则省略该冲突，merge 即可收口。此处 fail-closed，
    // 让候选选择路由专司 AI 融合稿。
    if (payload.option_key === "keep_current" || payload.option_key === "accept_incoming") {
      throw new HTTPException(422, {
        message: "“保留现状”和“采纳来方”请在合并冲突处直接处理，这里仅用于选择 AI 融合稿。"
      });
    }
    try {
      const result = await proposals.chooseMergeCandidate({
        mergeProposalId: c.req.param("id"),
        optionKey: payload.option_key,
        actor: proposalActorFor(c.var.actor)
      });
      return c.json({
        ok: true,
        data: parseOutputContract(mergeProposalCandidateChoiceResultSchema, result, "proposal.merge-candidate-choice")
      });
    } catch (error) {
      handleProposalServiceError(error);
    }
  });

  routes.post("/merge-proposals/:id/apply", createCurrentUserMiddleware(authSource), async (c) => {
    // findings[#15]：先鉴权再解析请求体（与 /review、/merge 一致）——未授权者发畸形 body 应拿 403/404 而非
    // 泄露 schema 的校验 422。readProposalByMergeProposalForActor 同时承担 uuid 形参校验，置于解析之前。
    const proposalForAccess = await readProposalByMergeProposalForActor(c.req.param("id"), c.var.actor);
    await assertCanMutateWorkItem(proposalForAccess.work_item_id, c.var.actor);
    const payload = applyMergeProposalCandidateRequestSchema.parse(await readJsonObject(c));
    if (payload.confirm === false) {
      return confirmationRequiredResponse(c);
    }
    try {
      const proposal = await proposals.applyMergeCandidate({
        mergeProposalId: c.req.param("id"),
        actor: proposalActorFor(c.var.actor),
        ...(payload.structured_field_overrides
          ? { structuredFieldOverrides: payload.structured_field_overrides }
          : {}),
        ...(payload.structured_item_overrides
          ? { structuredItemOverrides: payload.structured_item_overrides }
          : {}),
        ...(payload.text_hunk_overrides
          ? { textHunkOverrides: payload.text_hunk_overrides }
          : {}),
        ...(payload.task_plan_scope
          ? { taskPlanScope: payload.task_plan_scope }
          : {})
      });
      const applyResult = mergeResultFor({
        proposal,
        actor: actorFor(c.var.actor),
        userId: c.var.currentUser.id,
        createdAt: nowIso()
      });
      // findings[#168/H12]：AI 融合候选采纳也是一次合并，同样发布 proposal.merged + notification。
      await publishProposalEvents(bus, applyResult.events, eventLogger);
      return c.json({ ok: true, data: applyResult });
    } catch (error) {
      handleProposalServiceError(error);
    }
  });

  return routes;
}
