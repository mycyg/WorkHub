import { randomUUID } from "node:crypto";

import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  applyMergeProposalCandidateRequestSchema,
  chooseMergeProposalCandidateRequestSchema,
  conversationActionCardUpdatedEventSchema,
  createProposalFromManifestRequestSchema,
  eventTypes,
  mergeProposalCandidateChoiceResultSchema,
  mergeProposalRequestSchema,
  normalizeWorkHubLocale,
  proposalConflictListResultSchema,
  proposalMergeResultSchema,
  proposalReviewResultSchema,
  reviewProposalRequestSchema,
  type AuditLogFact,
  type AttentionItem,
  type ProposalReviewResult,
  type WorkHubLocale
} from "@workhub/contracts";
import { makeWorkHubEvent, topics } from "@workhub/events";
import { getDefaultPushBus, type PushBus } from "../broker/index.js";
import {
  createActionCardRepository,
  createAgentRunRepository,
  createProposalRepository,
  createWorkItemRepository,
  getSharedDatabaseClient
} from "@workhub/db";
import { createNotificationService, getDefaultNotificationServiceDependencies } from "../services/notifications.js";
import { getDefaultStructuredLogger } from "../logging.js";

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
import { getDefaultAgentRunQueue, type AgentRunQueue } from "../workers/agent-runner.js";
import { getDefaultWorkItemStatusKickoff, type WorkItemStatusKickoff } from "./agent-runs.js";
import { pageT } from "../pages/i18n.js";
import { parseOutputContract } from "../pages/output-contract.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

type TaskPlanRouteDispatcher = {
  dispatch: (input: {
    planId: string;
    workspaceId: string;
    orgId?: string;
    actorId?: string;
  }) => Promise<TaskPlanRouteDispatchResult | undefined>;
};

type TaskPlanRouteDispatchResult = {
  planId: string;
  enqueuedItemIds?: string[];
  skippedItemIds?: string[];
  casMissItemIds?: string[];
  completed?: boolean;
};

type TaskPlanApprovalTarget = NonNullable<ReturnType<typeof taskPlanApprovalTarget>>;

export type ProposalRoutesDependencies = {
  auth?: AuthDependencySource;
  proposals?: ProposalService;
  workItems?: Pick<WorkItemService, "detailPage" | "assertCanMutateArtifacts"> | false;
  taskPlanDispatcher?: TaskPlanRouteDispatcher | false;
  // findings[#168/H12]：合并/评审/打回事件原本只塞进 HTTP 响应、从不 publish 到总线，其它客户端的 SSE 实时
  // 刷新因此失效。注入 PushBus 后在各操作成功后 best-effort 发布。
  bus?: Pick<PushBus, "publish">;
  // ux-flow-spec §1.1 步3「先不拆，单个 AI 跑」：打回计划后直接起单 run。false 仅供纯提议测试。
  runQueue?: Pick<AgentRunQueue, "enqueue" | "abort"> | false;
  kickoffWorkItemStatus?: WorkItemStatusKickoff | false;
  logger?: Pick<typeof console, "warn">;
  // R14 批 APPROVE-CHAT 档③：review/merge 落定后的来源会话回流器（见 notifyProposalSettled 顶部注释）。
  // 缺省用共享 DB 的真实现；false 显式关闭；测试可注入记录桩。失败仅 warn，绝不影响 review/merge 2xx。
  settledNotifier?: ProposalSettledNotifier | false;
};

// —— R14 批 APPROVE-CHAT 档③：审批落定往来源会话回流（跨客户端状态闭环） —— //
//
// 缺口（06 设计 §1.5 侦察证实）：review/merge 端点此前不往来源会话回灌任何东西——审批后群聊里那张产出卡
// 永远停在「等待人工确认」，军团输出行 status 也不自动翻新，别的成员看不到「这份提议已被处理」。
//
// 血缘：proposal → branches.agent_run_id → agent_runs.source_conversation_id（与军团输出行
// listOutputLinksForConversation 的既有 join 同一条链），全部走既有仓库方法（findMergeContext /
// agentRuns.findById），零迁移零新列。找不到血缘（老数据/人工创建的提议没有 run）时诚实跳过并 warn，
// 不瞎猜会话。
//
// 回流两件事（都 best-effort）：
// ① 若提议源自行动卡条目（agent_runs.source_action_card_item_id）：publish 既有
//    conversation.action_card.updated（照 services/action-cards.ts emitUpdated 的事件形状）——桌面军团
//    面板已监听这个事件做后台重拉，输出行 status 即跨客户端翻新，零客户端改动。
// ② 往来源会话 post 一条 system_event 消息，content = {event:'proposal_settled', proposal_id, outcome,
//    title}——**新 event 取值而非新 kind，无迁移**（照 agent-runner.ts postDeliverableSystemMessage 的
//    proposal_opened 同款写入口）；桌面聊天流渲染层认这个分支渲「落定行」。
export type ProposalSettledOutcome = "approved" | "rejected" | "merged";

export type ProposalSettledNotifier = (input: {
  proposalId: string;
  workItemId: string;
  title: string;
  outcome: ProposalSettledOutcome;
  // 事件 actor（约减到 action_card.updated 事件 schema 认识的形状）；非 human/ai 的调用方在实现里回落为 ai。
  actor: { actor_kind: string; actor_user_id?: string; label?: string };
}) => Promise<void>;

function settledPreviewText(outcome: ProposalSettledOutcome, title: string): string {
  const label = outcome === "approved" ? "已通过" : outcome === "merged" ? "已合并" : "已打回";
  // preview_text 上限 200（事件 schema），标题过长时截断。
  return `${title.slice(0, 160)} ${label}`;
}

export function createDefaultProposalSettledNotifier(deps: {
  bus: Pick<PushBus, "publish">;
  // 跳过/失败的 warn 走结构化日志（照 proposal_revision_notify_failed 的既有口径）——不打进路由注入的
  // eventLogger：那个 logger 被 task-plan 等既有测试按「warn 内容精确断言」使用，回流的常态跳过（无血缘的
  // 人工提议/计划提议）会污染它们的断言口径。
  logger: { warn: (message: string, context?: Record<string, unknown>) => void };
}): ProposalSettledNotifier {
  return async (input) => {
    const db = getSharedDatabaseClient().db;
    const context = await createProposalRepository(db).findMergeContext(input.proposalId);
    if (!context?.agentRunId) {
      // 无血缘（提议不来自 agent run）——诚实跳过，不猜会话。
      deps.logger.warn("proposal_settled_no_run_lineage", { proposalId: input.proposalId });
      return;
    }
    const stored = await createAgentRunRepository(db).findById(context.agentRunId);
    const run = stored?.run;
    if (!run?.sourceConversationId || !run.workspaceId) {
      // run 没有来源会话（系统派发/直接对工单起跑）——没有可回灌的聊天现场，跳过。
      deps.logger.warn("proposal_settled_no_source_conversation", {
        proposalId: input.proposalId,
        agentRunId: context.agentRunId
      });
      return;
    }
    const actionCards = createActionCardRepository(db);
    const at = new Date();
    // ② 落定行（system_event 新 content 变体，照 proposal_opened 同款写入口）。
    await actionCards.postSystemMessage({
      workspaceId: run.workspaceId,
      conversationId: run.sourceConversationId,
      senderType: "system",
      content: {
        event: "proposal_settled",
        proposal_id: input.proposalId,
        outcome: input.outcome,
        title: input.title
      },
      at
    });
    // ① 源自行动卡条目 → publish 既有 conversation.action_card.updated（军团面板自动后台刷新）。
    if (run.sourceActionCardItemId) {
      const record = await actionCards.findItemForActor({
        itemId: run.sourceActionCardItemId,
        workspaceId: run.workspaceId
      });
      if (record) {
        const topic = topics.conversation(record.item.conversationId).topic;
        const actor =
          input.actor.actor_kind === "human" && input.actor.actor_user_id
            ? { actor_kind: "human" as const, actor_user_id: input.actor.actor_user_id, ...(input.actor.label ? { label: input.actor.label } : {}) }
            : { actor_kind: "ai" as const, label: input.actor.label ?? "WorkHub AI" };
        const event = parseOutputContract(
          conversationActionCardUpdatedEventSchema,
          makeWorkHubEvent({
            type: eventTypes.conversationActionCardUpdated,
            topic,
            ts: at,
            actor,
            project_id: record.item.projectId,
            preview_text: settledPreviewText(input.outcome, input.title),
            data: {
              conversation_id: record.item.conversationId,
              action_card_id: record.item.actionCardId,
              message_id: record.card.messageId,
              // 事件是「该刷新了」的信号（照 action-cards.ts emitUpdated 的语义注释）：单条目视角不重判
              // 整卡 superseded，条目状态照实带当前值。
              status: "active",
              appended: true,
              items: [{ id: record.item.id, kind: record.item.kind, confidence: record.item.confidence, status: record.item.status }]
            }
          }),
          "proposals.settled.action-card-event"
        );
        await deps.bus.publish(topic, eventTypes.conversationActionCardUpdated, event);
      }
    }
  };
}

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

function taskPlanDispatchAdvanced(result: TaskPlanRouteDispatchResult | undefined) {
  return Boolean(
    result
    && (
      result.completed === true
      || (result.enqueuedItemIds?.length ?? 0) > 0
      || (result.skippedItemIds?.length ?? 0) > 0
      || (result.casMissItemIds?.length ?? 0) > 0
    )
  );
}

function requestLocale(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }): WorkHubLocale {
  return normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"));
}

type ProposalActionCopyKey =
  | "review.proposal.approved.summary"
  | "review.plan.approved.summary"
  | "review.proposal.requestChanges.summary"
  | "review.plan.requestChanges.summary"
  | "review.proposal.approved.reason"
  | "review.plan.approved.reason"
  | "review.requestChanges.reason"
  | "merge.proposal.summary"
  | "merge.proposal.reason.rollback"
  | "merge.proposal.reason.noRollback"
  | "merge.plan.dispatch.summary"
  | "merge.plan.hold.summary"
  | "merge.plan.dispatch.reason"
  | "merge.plan.hold.reason"
  | "merge.plan.start";

const proposalActionCopy: Record<WorkHubLocale, Record<ProposalActionCopyKey, string>> = {
  "zh-CN": {
    "review.proposal.approved.summary": "接下来可以把这份交付物变更采纳到正式版本。",
    "review.plan.approved.summary": "计划已确认，可以选择立即开始执行或先暂缓。",
    "review.proposal.requestChanges.summary": "这份变更申请已被打回，原因会回灌给下一轮 AI。",
    "review.plan.requestChanges.summary": "这份任务计划已被打回，原因会回灌给下一轮 AI。",
    "review.proposal.approved.reason": "这是一份可审计的交付物变更申请。",
    "review.plan.approved.reason": "这是一份可审计的任务计划提议。",
    "review.requestChanges.reason": "打回原因已进入下一轮上下文。",
    "merge.proposal.summary": "交付物变更已进入正式版本，全程留档可追溯。",
    "merge.proposal.reason.rollback": "这次变更留有回滚快照，需要恢复时可人工处理。",
    "merge.proposal.reason.noRollback": "这次变更缺少可用回滚快照。",
    "merge.plan.dispatch.summary": "任务计划已批准，子任务会开始执行。",
    "merge.plan.hold.summary": "任务计划已批准，暂不开始执行。",
    "merge.plan.dispatch.reason": "后续执行会继续进入可审计的事项流。",
    "merge.plan.hold.reason": "计划保持已批准状态，需要时可以再手动开始。",
    "merge.plan.start": "开始执行计划"
  },
  "en-US": {
    "review.proposal.approved.summary": "Approved — ready to accept into the official version.",
    "review.plan.approved.summary": "Plan approved — start it now or hold it for later.",
    "review.proposal.requestChanges.summary": "This change request was sent back. The reason will feed the next AI pass.",
    "review.plan.requestChanges.summary": "This task plan was sent back. The reason will feed the next AI pass.",
    "review.proposal.approved.reason": "This is an auditable deliverable change proposal.",
    "review.plan.approved.reason": "This is an auditable task plan proposal.",
    "review.requestChanges.reason": "The change reason is now in the next pass context.",
    "merge.proposal.summary": "The deliverable change is now in the official version, with a full audit trail.",
    "merge.proposal.reason.rollback": "A rollback snapshot is kept for this change — restoring is a manual step.",
    "merge.proposal.reason.noRollback": "This change does not have an available rollback snapshot.",
    "merge.plan.dispatch.summary": "The task plan is approved. Subtasks will start.",
    "merge.plan.hold.summary": "The task plan is approved and held for later.",
    "merge.plan.dispatch.reason": "Execution will continue in the auditable work-item flow.",
    "merge.plan.hold.reason": "The plan remains approved. Start it manually when ready.",
    "merge.plan.start": "Start task plan"
  }
};

function proposalT(locale: WorkHubLocale, key: ProposalActionCopyKey) {
  return proposalActionCopy[locale][key];
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
  locale: WorkHubLocale;
}): AttentionItem {
  const approve = input.decision === "approve";
  const planReview = isTaskPlanProposal(input.proposal);
  return {
    id: randomUUID(),
    kind: planReview ? "plan_review" : "proposal_review",
    priority: approve ? "normal" : "high",
    work_item_id: input.proposal.work_item_id,
    source_ref: { entity_type: "proposal", entity_id: input.proposal.id },
    title: input.locale === "zh-CN"
      ? (approve ? `${input.proposal.title} 已通过确认` : `${input.proposal.title} 需要修改`)
      : (approve ? `${input.proposal.title} approved` : `${input.proposal.title} needs changes`),
    summary_text: approve
      ? (planReview
          ? proposalT(input.locale, "review.plan.approved.summary")
          : proposalT(input.locale, "review.proposal.approved.summary"))
      : input.reason ?? (planReview
        ? proposalT(input.locale, "review.plan.requestChanges.summary")
        : proposalT(input.locale, "review.proposal.requestChanges.summary")),
    reason_text: approve
      ? (planReview
          ? proposalT(input.locale, "review.plan.approved.reason")
          : proposalT(input.locale, "review.proposal.approved.reason"))
      : proposalT(input.locale, "review.requestChanges.reason"),
    actions: approve
      ? (planReview
          ? [
              {
                id: "approve_and_dispatch",
                label: pageT(input.locale, "proposal.action.approvePlanAndStart"),
                style: "primary",
                method: "POST",
                href: `/api/proposals/${input.proposal.id}/merge`,
                request_json: { dispatch: true }
              },
              {
                id: "approve_hold",
                label: pageT(input.locale, "proposal.action.approvePlanHold"),
                style: "secondary",
                method: "POST",
                href: `/api/proposals/${input.proposal.id}/merge`,
                request_json: { dispatch: false }
              },
              {
                id: "open_proposal",
                label: pageT(input.locale, "proposal.action.viewPlan"),
                style: "secondary",
                method: "GET",
                href: `/proposals/${input.proposal.id}`
              }
            ]
          : [
              {
                id: "merge",
                label: pageT(input.locale, "proposal.action.merge"),
                style: "primary",
                method: "POST",
                href: `/api/proposals/${input.proposal.id}/merge`
              }
            ])
      : [
          {
            id: "open_proposal",
            label: pageT(input.locale, planReview ? "proposal.action.viewPlan" : "proposal.action.view"),
            style: "primary",
            method: "GET",
            href: `/proposals/${input.proposal.id}`
          }
        ],
    cuu_state: approve ? "carrying_document" : "revision_requested",
    created_at: input.createdAt
  };
}

function genericMergeAttention(proposal: StoredProposal, createdAt: string, locale: WorkHubLocale): AttentionItem {
  return {
    id: randomUUID(),
    kind: "delivery_ready",
    priority: "normal",
    work_item_id: proposal.work_item_id,
    source_ref: { entity_type: "proposal", entity_id: proposal.id },
    title: locale === "zh-CN" ? `${proposal.title} 已采纳` : `${proposal.title} merged`,
    summary_text: proposalT(locale, "merge.proposal.summary"),
    reason_text: proposal.diff_manifest.rollback.available
      ? proposalT(locale, "merge.proposal.reason.rollback")
      : proposalT(locale, "merge.proposal.reason.noRollback"),
    actions: [
      {
        id: "open_proposal",
        label: pageT(locale, "proposal.action.view"),
        style: "primary",
        method: "GET",
        href: `/proposals/${proposal.id}`
      }
    ],
    cuu_state: "celebrating",
    created_at: createdAt
  };
}

function taskPlanMergeAttention(proposal: StoredProposal, createdAt: string, dispatch: boolean, locale: WorkHubLocale): AttentionItem {
  return {
    id: randomUUID(),
    kind: "delivery_ready",
    priority: "normal",
    work_item_id: proposal.work_item_id,
    source_ref: { entity_type: "proposal", entity_id: proposal.id },
    title: locale === "zh-CN" ? `${proposal.title} 已批准` : `${proposal.title} approved`,
    summary_text: dispatch ? proposalT(locale, "merge.plan.dispatch.summary") : proposalT(locale, "merge.plan.hold.summary"),
    reason_text: dispatch ? proposalT(locale, "merge.plan.dispatch.reason") : proposalT(locale, "merge.plan.hold.reason"),
    actions: [
      ...(!dispatch
        ? [{
            id: "start_task_plan",
            label: proposalT(locale, "merge.plan.start"),
            style: "primary" as const,
            method: "POST" as const,
            href: `/api/proposals/${proposal.id}/merge`,
            request_json: { dispatch: true }
          }]
        : []),
      {
        id: "open_proposal",
        label: pageT(locale, "proposal.action.viewPlan"),
        style: dispatch ? "primary" : "secondary",
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
  locale: WorkHubLocale;
  attention?: AttentionItem;
}) {
  const attention = input.attention ?? genericMergeAttention(input.proposal, input.createdAt, input.locale);
  const mergeSnapshotId = input.proposal.merge_snapshot_id;
  if (!mergeSnapshotId) {
    throw new ProposalServiceError(409, "merge_snapshot_missing", input.locale === "en-US"
        ? "This change request is missing its merge snapshot — refresh and regenerate, or contact an admin."
        : "这份变更申请缺少合并快照，请刷新后重新生成或联系管理员处理。");
  }
  const proposalMerged = makeWorkHubEvent({
    event_id: randomUUID(),
    type: eventTypes.proposalMerged,
    topic: topics.workitem(input.proposal.work_item_id).topic,
    ts: new Date(input.createdAt),
    actor: input.actor,
    work_item_id: input.proposal.work_item_id,
    proposal_id: input.proposal.id,
    preview_text: input.locale === "zh-CN" ? `${input.proposal.title} 已采纳。` : `${input.proposal.title} merged.`,
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
    preview_text: input.locale === "zh-CN" ? `${input.proposal.title} 已采纳。` : `${input.proposal.title} merged.`,
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
  // R14 批 APPROVE-CHAT 档③：审批落定回流器（见 createDefaultProposalSettledNotifier 顶部注释）。
  const notifySettled = deps.settledNotifier === false
    ? undefined
    : deps.settledNotifier ?? createDefaultProposalSettledNotifier({ bus, logger: getDefaultStructuredLogger() });
  // best-effort 包装：血缘查询/写消息/发事件任何一步失败都只 warn（结构化日志，同 revision-notify 口径），
  // 绝不影响 review/merge 已经成功的 2xx。
  async function settleNotifyBestEffort(input: Parameters<ProposalSettledNotifier>[0]): Promise<void> {
    if (!notifySettled) {
      return;
    }
    try {
      await notifySettled(input);
    } catch (error) {
      getDefaultStructuredLogger().warn("proposal_settled_notify_failed", { proposalId: input.proposalId, error });
    }
  }
  function resolveSkipPlanRuntime() {
    if (deps.runQueue === false || deps.kickoffWorkItemStatus === false) {
      return undefined;
    }
    return {
      queue: deps.runQueue ?? getDefaultAgentRunQueue(),
      kickoff: deps.kickoffWorkItemStatus ?? getDefaultWorkItemStatusKickoff()
    };
  }

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

  async function dispatchMergedTaskPlan(input: {
    proposal: StoredProposal;
    target: TaskPlanApprovalTarget;
    actor: AuthActor;
  }) {
    if (!taskPlanDispatcher) {
      return undefined;
    }
    try {
      return await taskPlanDispatcher.dispatch({
        planId: input.target.planId,
        workspaceId: input.target.workspaceId,
        orgId: input.actor.orgId,
        actorId: input.actor.userId ?? input.actor.id
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      eventLogger.warn("WorkHub task-plan dispatch after proposal merge failed", {
        proposalId: input.proposal.id,
        workItemId: input.proposal.work_item_id,
        planId: input.target.planId,
        error: message
      });
      throw new ProposalServiceError(
        503,
        "task_plan_dispatch_failed",
        "任务计划已经批准，但子任务启动失败，请稍后刷新后重试。"
      );
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

  // R10-P1-3：提议变更的在线预览。生产 runner 不提供 /api/agent/outputs/* 静态服务（manifest 里的
  // 默认 href 是死链），可预览的文本其实一直在 manifest change 的 machine_summary.generated_content_md
  // 里——从这里按已鉴权的提议读出来，返回与 drive/workitem preview 相同的 JSON 形状，前端复用同一预览面板。
  routes.get("/:id/changes/:changeId/preview", authMiddleware, async (c) => {
    const proposal = await readProposalForActor(c.req.param("id"), c.var.actor);
    const changeId = c.req.param("changeId");
    const change = proposal.diff_manifest.changes.find((item) => item.id === changeId);
    if (!change) {
      throw new ProposalServiceError(404, "proposal_change_not_found", "没有找到这条变更记录。");
    }
    const text = change.machine_summary?.generated_content_md;
    if (!text) {
      throw new ProposalServiceError(415, "proposal_change_preview_unsupported", "这条变更没有可在线预览的文本。采纳后可到工作项或网盘查看正式版。");
    }
    const filename = change.target_ref.path?.split("/").filter(Boolean).pop() ?? change.target_ref.entity_type;
    const maxPreviewChars = 200000;
    return c.json({
      ok: true,
      data: {
        id: change.id,
        filename,
        size_bytes: Buffer.byteLength(text, "utf8"),
        preview_type: "text",
        text: text.slice(0, maxPreviewChars),
        truncated: text.length > maxPreviewChars
      }
    });
  });

  routes.post("/:id/review", authMiddleware, async (c) => {
    // L3：先鉴权再解析请求体——否则未授权者会先收到 schema 校验 400（泄露请求体形状/字段要求），
    // 拿不到本应优先返回的 404/403。授权检查（readProposalForActor → assertCanReadWorkItem）置于解析之前。
    const proposalForAccess = await readProposalForActor(c.req.param("id"), c.var.actor);
    await assertCanMutateWorkItem(proposalForAccess.work_item_id, c.var.actor);
    const locale = requestLocale(c);
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
      createdAt,
      locale
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
      preview_text: payload.decision === "approve"
        ? (locale === "zh-CN" ? `${proposal.title} 已通过确认。` : `${proposal.title} approved.`)
        : (locale === "zh-CN" ? `打回原因：${payload.reason_md}` : `Changes requested: ${payload.reason_md}`),
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
        label: pageT(locale, planReview ? "proposal.action.approvePlanAndStart" : "proposal.action.merge"),
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
    // 普通用户审查 R3 high（协作）：打回只有 SSE——发起人 A 不在线就永远不知道被打回、理由在哪。
    // 落一条持久化通知给提交人（审阅人自己打回自己的除外）；通知失败只告警不翻审阅。
    if (payload.decision === "request_changes") {
      try {
        const access = await createWorkItemRepository(getSharedDatabaseClient().db)
          .findWorkItemAccessRecord(proposal.work_item_id);
        const submitterId = access?.submitterUserId ?? undefined;
        const reviewerId = c.var.actor.userId ?? c.var.actor.id;
        if (submitterId && submitterId !== reviewerId) {
          await createNotificationService(getDefaultNotificationServiceDependencies()).createNotification({
            userId: submitterId,
            type: "proposal.revision_requested",
            severity: "normal",
            // R11（通知信息量）：点名被打回的是哪份变更申请——不点开也能判断轻重缓急。
            title: locale === "en-US"
              ? `Sent back: ${proposal.title.slice(0, 60)}`
              : `被打回：${proposal.title.slice(0, 60)}`,
            body: payload.reason_md ?? (locale === "en-US" ? "See the review comments." : "查看打回理由。"),
            targetUrl: `/proposals/${proposal.id}`,
            workItemId: proposal.work_item_id,
            dedupeKey: `proposal_revision:${proposal.id}:${createdAt}`
          });
        }
      } catch (error) {
        getDefaultStructuredLogger().warn("proposal_revision_notify_failed", { proposalId: proposal.id, error });
      }
    }
    // R14 批 APPROVE-CHAT 档③：审批落定回流——通过=approved（还没合并，终态是 merge 那一下）、
    // 打回=rejected（服务层 review 已把 status 翻成 rejected 终态）。
    await settleNotifyBestEffort({
      proposalId: proposal.id,
      workItemId: proposal.work_item_id,
      title: proposal.title,
      outcome: payload.decision === "approve" ? "approved" : "rejected",
      actor: actorFor(c.var.actor)
    });
    return c.json({ ok: true, data: parseOutputContract(proposalReviewResultSchema, resultBase, "proposal.review-result") });
  });

  // ux-flow-spec §1.1 步3「先不拆，单个 AI 跑」：打回军团计划（onRejected 会取消草稿计划），
  // 然后直接以现状单 run 开工。先打回后入队——反着做会留下「run 已在跑 + 计划仍可批准」的双跑窗口。
  routes.post("/:id/skip-plan", authMiddleware, async (c) => {
    const proposalForAccess = await readProposalForActor(c.req.param("id"), c.var.actor);
    await assertCanMutateWorkItem(proposalForAccess.work_item_id, c.var.actor);
    const locale = requestLocale(c);
    const zh = locale === "zh-CN";
    if (!taskPlanApprovalTarget(proposalForAccess)) {
      return c.json({ ok: false, error: { code: "not_task_plan_proposal", message: zh ? "这不是任务计划提议。" : "This proposal is not a task plan." } }, 409);
    }
    if (proposalForAccess.status !== "opened" && proposalForAccess.status !== "reviewed") {
      return c.json({ ok: false, error: { code: "plan_skip_not_available", message: zh ? "这份计划已经处理过了，请刷新后再看。" : "This plan has already been settled — refresh to see the latest state." } }, 409);
    }
    const runtime = resolveSkipPlanRuntime();
    if (!runtime) {
      return c.json({ ok: false, error: { code: "plan_skip_not_available", message: zh ? "单个 AI 执行暂时不可用。" : "Single-run execution is unavailable right now." } }, 503);
    }
    try {
      await proposals.review({
        proposalId: proposalForAccess.id,
        actor: proposalActorFor(c.var.actor),
        decision: "request_changes",
        reasonMd: zh ? "用户选择先不拆，直接单个 AI 执行。" : "The user chose to skip the plan and run a single AI."
      });
    } catch (error) {
      handleProposalServiceError(error);
    }
    const run = await runtime.queue.enqueue({
      workItemId: proposalForAccess.work_item_id,
      actorId: c.var.actor.id,
      ...(c.var.actor.orgId ? { orgId: c.var.actor.orgId } : {}),
      ...(c.var.actor.workspaceId ? { workspaceId: c.var.actor.workspaceId } : {}),
      mode: "worker"
    });
    try {
      // 与 /workitems/:id/agent-runs 同款 kickoff：非法前驱幂等 no-op；kickoff 失败取消刚入队的 run。
      await runtime.kickoff({ workItemId: proposalForAccess.work_item_id, to: "ai_working", at: new Date() });
    } catch (error) {
      try {
        await runtime.queue.abort(run.run_id, { id: c.var.actor.id, isAdmin: c.var.actor.isAdmin, canManageRun: true });
      } catch {
        // 已由 releaseExpired 租约回收兜底。
      }
      throw error;
    }
    return c.json({
      ok: true,
      data: {
        run_id: run.run_id,
        work_item_id: proposalForAccess.work_item_id,
        attention: {
          summary_text: zh ? "已改为单个 AI 直接执行，计划草稿已取消。" : "Switched to a single AI run; the plan draft was cancelled."
        }
      }
    });
  });

  routes.post("/:id/merge", authMiddleware, async (c) => {
    // findings：鉴权先于请求体解析（与 /review 一致，L3 修过 review 但 merge 漏了）——未授权者发畸形 body
    // 应拿 403/404 而非泄露 schema 的 400。
    const proposalForAccess = await readProposalForActor(c.req.param("id"), c.var.actor);
    await assertCanMutateWorkItem(proposalForAccess.work_item_id, c.var.actor);
    const locale = requestLocale(c);
    const payload = mergeProposalRequestSchema.parse(await readJsonObject(c));
    if (proposalForAccess.status === "merged") {
      const taskPlanTarget = taskPlanApprovalTarget(proposalForAccess);
      if (taskPlanTarget && payload.confirm !== false && payload.dispatch !== false) {
        const dispatchResult = await dispatchMergedTaskPlan({
          proposal: proposalForAccess,
          target: taskPlanTarget,
          actor: c.var.actor
        });
        if (taskPlanDispatchAdvanced(dispatchResult)) {
          const createdAt = nowIso();
          const mergeResult = mergeResultFor({
            proposal: proposalForAccess,
            actor: actorFor(c.var.actor),
            userId: c.var.currentUser.id,
            createdAt,
            locale,
            attention: taskPlanMergeAttention(proposalForAccess, createdAt, true, locale)
          });
          await publishProposalEvents(bus, mergeResult.events, eventLogger);
          return c.json({ ok: true, data: mergeResult });
        }
      }
      throw new ProposalServiceError(409, "proposal_already_merged", "这份变更申请已经被采纳。");
    }
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
    if (shouldDispatchTaskPlan && taskPlanTarget) {
      await dispatchMergedTaskPlan({
        proposal,
        target: taskPlanTarget,
        actor: c.var.actor
      });
    }
    const createdAt = nowIso();
    const mergeResult = mergeResultFor({
      proposal,
      actor: actorFor(c.var.actor),
      userId: c.var.currentUser.id,
      createdAt,
      locale,
      ...(taskPlanTarget ? { attention: taskPlanMergeAttention(proposal, createdAt, payload.dispatch !== false, locale) } : {})
    });
    // findings[#168/H12]：发布 proposal.merged（→ workitem topic）+ notification.created（→ user topic）。
    await publishProposalEvents(bus, mergeResult.events, eventLogger);
    // R14 批 APPROVE-CHAT 档③：合入落定回流。已合并提议的重派发早路径（上面 proposal_already_merged 分支）
    // 不发——第一次合并已经回流过，重派发不是新的落定。
    await settleNotifyBestEffort({
      proposalId: proposal.id,
      workItemId: proposal.work_item_id,
      title: proposal.title,
      outcome: "merged",
      actor: actorFor(c.var.actor)
    });
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
    const locale = requestLocale(c);
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
        createdAt: nowIso(),
        locale
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
