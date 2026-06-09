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
  type ProposalActor,
  type ProposalService,
  type StoredProposal
} from "../services/proposals.js";

export type ProposalRoutesDependencies = {
  auth?: AuthDependencySource;
  proposals?: ProposalService;
};

async function readJsonBody(c: Context) {
  return c.req.json().catch(() => ({}));
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
  return {
    id: randomUUID(),
    kind: "proposal_review",
    priority: approve ? "normal" : "high",
    work_item_id: input.proposal.work_item_id,
    source_ref: { entity_type: "proposal", entity_id: input.proposal.id },
    title: approve ? `${input.proposal.title} 已通过确认` : `${input.proposal.title} 需要修改`,
    summary_text: approve
      ? "接下来可以把这份交付物变更采纳到正式版本。"
      : input.reason ?? "这份变更申请已被打回，原因会回灌给下一轮 AI。",
    reason_text: approve ? "这是一份可审计的交付物变更申请。" : "打回原因已进入下一轮上下文。",
    actions: approve
      ? [
          {
            id: "merge",
            label: "采纳到正式版",
            style: "primary",
            method: "POST",
            href: `/api/proposals/${input.proposal.id}/merge`
          }
        ]
      : [
          {
            id: "open_proposal",
            label: "查看变更申请",
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

function mergeResultFor(input: {
  proposal: StoredProposal;
  actor: ReturnType<typeof actorFor>;
  userId: string;
  createdAt: string;
}) {
  const attention = genericMergeAttention(input.proposal, input.createdAt);
  const mergeSnapshotId = input.proposal.merge_snapshot_id;
  if (!mergeSnapshotId) {
    throw new HTTPException(500, { message: "变更申请缺少合并快照。" });
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

  return proposalMergeResultSchema.parse({
    proposal_id: input.proposal.id,
    work_item_id: input.proposal.work_item_id,
    status: "merged",
    merge_snapshot_id: mergeSnapshotId,
    rollback_available: input.proposal.diff_manifest.rollback.available,
    rollback: input.proposal.diff_manifest.rollback,
    attention,
    events: [proposalMerged, notification],
    audit_logs: auditLogs
  });
}

function handleProposalServiceError(error: unknown): never {
  if (error instanceof ProposalServiceError) {
    throw new HTTPException(error.status as 400, { message: error.message });
  }
  throw error;
}

export function createProposalRoutes(deps: ProposalRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const authMiddleware = createCurrentUserMiddleware(authSource);
  const proposals = deps.proposals ?? getDefaultProposalService();

  routes.get("/:id", authMiddleware, async (c) => {
    const proposal = await proposals.get(c.req.param("id"));
    if (!proposal) {
      throw new HTTPException(404, { message: "没有找到这个变更申请。" });
    }
    const { reviews: _reviews, ...data } = proposal;
    return c.json({ ok: true, data });
  });

  routes.post("/:id/review", authMiddleware, async (c) => {
    const payload = reviewProposalRequestSchema.parse(await readJsonBody(c));
    let proposal: StoredProposal;
    try {
      proposal = await proposals.review({
        proposalId: c.req.param("id"),
        actor: proposalActorFor(c.var.actor),
        decision: payload.decision,
        ...(payload.reason_md ? { reasonMd: payload.reason_md } : {})
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
      resultBase.next_action = {
        id: "merge",
        label: "采纳到正式版",
        method: "POST",
        href: `/api/proposals/${proposal.id}/merge`
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

    return c.json({ ok: true, data: proposalReviewResultSchema.parse(resultBase) });
  });

  routes.post("/:id/merge", authMiddleware, async (c) => {
    const payload = mergeProposalRequestSchema.parse(await readJsonBody(c));
    let proposal: StoredProposal;
    try {
      proposal = await proposals.merge({
        proposalId: c.req.param("id"),
        actor: proposalActorFor(c.var.actor),
        ...(payload.conflict_resolution
          ? {
              conflictResolution: {
                acceptIncomingTargetKeys: payload.conflict_resolution.accept_incoming_target_keys
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
      handleProposalServiceError(error);
    }
    return c.json({
      ok: true,
      data: mergeResultFor({
        proposal,
        actor: actorFor(c.var.actor),
        userId: c.var.currentUser.id,
        createdAt: nowIso()
      })
    });
  });

  return routes;
}

export function createWorkItemProposalRoutes(deps: ProposalRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const proposals = deps.proposals ?? getDefaultProposalService();

  routes.post("/workitems/:id/proposals", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = createProposalFromManifestRequestSchema.parse(await readJsonBody(c));
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
    const rows = await proposals.listByWorkItem(c.req.param("id"));
    return c.json({
      ok: true,
      data: rows.map(({ reviews: _reviews, ...proposal }) => proposal)
    });
  });

  routes.get("/workitems/:id/conflicts", createCurrentUserMiddleware(authSource), async (c) => {
    const result = await proposals.listConflicts(c.req.param("id"));
    return c.json({
      ok: true,
      data: proposalConflictListResultSchema.parse(result)
    });
  });

  routes.post("/merge-proposals/:id/choose", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = chooseMergeProposalCandidateRequestSchema.parse(await readJsonBody(c));
    try {
      const result = await proposals.chooseMergeCandidate({
        mergeProposalId: c.req.param("id"),
        optionKey: payload.option_key,
        actor: proposalActorFor(c.var.actor)
      });
      return c.json({
        ok: true,
        data: mergeProposalCandidateChoiceResultSchema.parse(result)
      });
    } catch (error) {
      handleProposalServiceError(error);
    }
  });

  routes.post("/merge-proposals/:id/apply", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = applyMergeProposalCandidateRequestSchema.parse(await readJsonBody(c));
    try {
      const proposal = await proposals.applyMergeCandidate({
        mergeProposalId: c.req.param("id"),
        actor: proposalActorFor(c.var.actor),
        ...(payload.structured_field_overrides
          ? { structuredFieldOverrides: payload.structured_field_overrides }
          : {})
      });
      return c.json({
        ok: true,
        data: mergeResultFor({
          proposal,
          actor: actorFor(c.var.actor),
          userId: c.var.currentUser.id,
          createdAt: nowIso()
        })
      });
    } catch (error) {
      handleProposalServiceError(error);
    }
  });

  return routes;
}
