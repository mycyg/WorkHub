import { randomUUID } from "node:crypto";

import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { p05GoldPathIds } from "@workhub/agent/fixtures";
import {
  createProposalFromManifestRequestSchema,
  eventTypes,
  mergeProposalRequestSchema,
  proposalSchema,
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
  createOptionalCurrentUserMiddleware,
  getAuthSettings,
  getDefaultAuthDependencies,
  resolveAuthDependencies,
  type AuthActor,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getP05GoldPathFixture,
  isP05ProposalId
} from "../pages/gold-path.js";
import {
  getDefaultProposalService,
  ProposalServiceError,
  type ProposalActor,
  type ProposalService,
  type StoredProposal
} from "../services/proposals.js";

export type ProposalRoutesDependencies = {
  auth?: AuthDependencySource;
  proposals?: ProposalService;
  allowUnauthenticatedGoldPath?: boolean;
};

async function readJsonBody(c: Context) {
  return c.req.json().catch(() => ({}));
}

function actorFor(actor?: AuthActor) {
  if (!actor) {
    return {
      actor_kind: "human" as const,
      actor_user_id: p05GoldPathIds.user,
      label: "P0.5 Reviewer"
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

function reviewAttention(input: {
  decision: "approve" | "request_changes";
  reason?: string;
  createdAt: string;
}): AttentionItem {
  if (input.decision === "approve") {
    return {
      id: p05GoldPathIds.eventProposalReviewed,
      kind: "proposal_review",
      priority: "normal",
      work_item_id: p05GoldPathIds.workItem,
      project_id: p05GoldPathIds.project,
      source_ref: { entity_type: "proposal", entity_id: p05GoldPathIds.proposal },
      title: "客户周报模板已通过审批",
      summary_text: "接下来会把交付物合并到正式版本，并保留回滚入口。",
      reason_text: "这是一次 file-only 交付物变更，可审计、可回滚。",
      actions: [
        {
          id: "merge",
          label: "合并交付物",
          style: "primary",
          method: "POST",
          href: `/api/proposals/${p05GoldPathIds.proposal}/merge`
        }
      ],
      cuu_state: "carrying_document",
      created_at: input.createdAt
    };
  }

  return {
    id: p05GoldPathIds.eventProposalReviewed,
    kind: "proposal_review",
    priority: "high",
    work_item_id: p05GoldPathIds.workItem,
    project_id: p05GoldPathIds.project,
    source_ref: { entity_type: "proposal", entity_id: p05GoldPathIds.proposal },
    title: "客户周报模板需要修改",
    summary_text: input.reason ?? "你已经打回这份变更申请，Cuu 会带着原因继续改。",
    reason_text: "打回原因已回灌给下一轮 AgentRun。",
    actions: [
      {
        id: "open_workitem",
        label: "查看事项",
        style: "primary",
        method: "GET",
        href: `/workitems/${p05GoldPathIds.workItem}`
      },
      {
        id: "open_replay",
        label: "看回放",
        style: "secondary",
        method: "GET",
        href: `/agent-runs/${p05GoldPathIds.run}/replay`
      }
    ],
    cuu_state: "revision_requested",
    created_at: input.createdAt
  };
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

function mergeAttention(createdAt: string): AttentionItem {
  return {
    id: p05GoldPathIds.eventProposalMerged,
    kind: "delivery_ready",
    priority: "normal",
    work_item_id: p05GoldPathIds.workItem,
    project_id: p05GoldPathIds.project,
    source_ref: { entity_type: "proposal", entity_id: p05GoldPathIds.proposal },
    title: "客户周报模板已采纳",
    summary_text: "交付物已合并到正式版本，审计和回滚入口都已就绪。",
    reason_text: "这次变更保留了 merge snapshot，可一键回滚。",
    actions: [
      {
        id: "open_delivery",
        label: "查看交付物",
        style: "primary",
        method: "GET",
        href: `/workitems/${p05GoldPathIds.workItem}`
      },
      {
        id: "open_replay",
        label: "查看回放",
        style: "secondary",
        method: "GET",
        href: `/agent-runs/${p05GoldPathIds.run}/replay`
      }
    ],
    cuu_state: "celebrating",
    created_at: createdAt
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

function handleProposalServiceError(error: unknown): never {
  if (error instanceof ProposalServiceError) {
    throw new HTTPException(error.status as 400, { message: error.message });
  }
  throw error;
}

export function createProposalRoutes(deps: ProposalRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const authSettings = getAuthSettings(resolveAuthDependencies(authSource));
  const allowUnauthenticatedGoldPath = deps.allowUnauthenticatedGoldPath ?? authSettings.appEnv !== "production";
  const authMiddleware = allowUnauthenticatedGoldPath
    ? createOptionalCurrentUserMiddleware(authSource)
    : createCurrentUserMiddleware(authSource);
  const proposals = deps.proposals ?? getDefaultProposalService();

  routes.get("/:id", authMiddleware, async (c) => {
    if (isP05ProposalId(c.req.param("id"))) {
      const fixture = getP05GoldPathFixture();
      return c.json({
        ok: true,
        data: proposalSchema.parse({
          id: fixture.proposalDetail.proposal_id,
          work_item_id: fixture.proposalDetail.work_item_id,
          branch_id: p05GoldPathIds.branch,
          round: 1,
          title: fixture.proposalDetail.title,
          status: fixture.proposalDetail.status,
          diff_manifest: fixture.proposalDetail.manifest,
          opened_by_kind: "ai",
          created_at: fixture.proposalDetail.manifest.base.created_at ?? "2026-06-05T00:00:00.000Z",
          updated_at: fixture.proposalDetail.manifest.base.created_at ?? "2026-06-05T00:00:00.000Z"
        })
      });
    }

    const proposal = await proposals.get(c.req.param("id"));
    if (!proposal) {
      throw new HTTPException(404, { message: "没有找到这个变更申请。" });
    }
    const { reviews: _reviews, ...data } = proposal;
    return c.json({ ok: true, data });
  });

  routes.post("/:id/review", authMiddleware, async (c) => {
    const payload = reviewProposalRequestSchema.parse(await readJsonBody(c));
    if (!isP05ProposalId(c.req.param("id"))) {
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
    }

    const createdAt = nowIso();
    const attention = reviewAttention({
      decision: payload.decision,
      ...(payload.reason_md ? { reason: payload.reason_md } : {}),
      createdAt
    });
    const actor = actorFor(c.var.actor);
    const event = makeWorkHubEvent({
      event_id: p05GoldPathIds.eventProposalReviewed,
      type: eventTypes.proposalReviewed,
      topic: topics.workitem(p05GoldPathIds.workItem).topic,
      ts: new Date(createdAt),
      actor,
      work_item_id: p05GoldPathIds.workItem,
      project_id: p05GoldPathIds.project,
      run_id: p05GoldPathIds.run,
      proposal_id: p05GoldPathIds.proposal,
      preview_text: payload.decision === "approve" ? "客户周报模板已通过审批。" : `打回原因：${payload.reason_md}`,
      attention,
      data: {
        proposal_id: p05GoldPathIds.proposal,
        decision: payload.decision,
        ...(payload.reason_md ? { reason_md: payload.reason_md } : {})
      }
    });
    const feedbackEvent = payload.decision === "request_changes" && payload.reason_md
      ? reasonFeedbackEvent({
          actor,
          proposalId: p05GoldPathIds.proposal,
          workItemId: p05GoldPathIds.workItem,
          runId: p05GoldPathIds.run,
          projectId: p05GoldPathIds.project,
          reasonMd: payload.reason_md,
          createdAt,
          attention
        })
      : undefined;
    const feedbackAuditLogs: AuditLogFact[] = payload.decision === "request_changes" && payload.reason_md
      ? [
          {
            id: randomUUID(),
            workspace_id: p05GoldPathIds.workspace,
            actor: auditActorFor(actor),
            entity: { entity_type: "proposal", entity_id: p05GoldPathIds.proposal },
            action: "reason_fed_back",
            detail_json: {
              proposal_id: p05GoldPathIds.proposal,
              work_item_id: p05GoldPathIds.workItem,
              run_id: p05GoldPathIds.run,
              reason_fed_back: true,
              reason_preview: payload.reason_md.slice(0, 160)
            },
            created_at: createdAt
          }
        ]
      : [];

    const data = proposalReviewResultSchema.parse({
      proposal_id: p05GoldPathIds.proposal,
      work_item_id: p05GoldPathIds.workItem,
      status: payload.decision === "approve" ? "reviewed" : "revision_requested",
      decision: payload.decision,
      ...(payload.reason_md ? { reason_md: payload.reason_md } : {}),
      ...(payload.decision === "approve"
        ? {
            next_action: {
              id: "merge",
              label: "合并交付物",
              method: "POST",
              href: `/api/proposals/${p05GoldPathIds.proposal}/merge`
            }
          }
        : {
            next_agent_context: {
              work_item_id: p05GoldPathIds.workItem,
              run_id: p05GoldPathIds.run,
              correction: payload.reason_md,
              reason_fed_back: true
            }
          }),
      attention,
      event,
      ...(feedbackEvent ? { feedback_event: feedbackEvent } : {}),
      ...(feedbackAuditLogs.length > 0 ? { audit_logs: feedbackAuditLogs } : {})
    });

    return c.json({ ok: true, data });
  });

  routes.post("/:id/merge", authMiddleware, async (c) => {
    mergeProposalRequestSchema.parse(await readJsonBody(c));
    if (!isP05ProposalId(c.req.param("id"))) {
      let proposal: StoredProposal;
      try {
        proposal = await proposals.merge({
          proposalId: c.req.param("id"),
          actor: proposalActorFor(c.var.actor)
        });
      } catch (error) {
        handleProposalServiceError(error);
      }
      const createdAt = nowIso();
      const actor = actorFor(c.var.actor);
      const attention = genericMergeAttention(proposal, createdAt);
      const mergeSnapshotId = proposal.merge_snapshot_id;
      if (!mergeSnapshotId) {
        throw new HTTPException(500, { message: "变更申请缺少合并快照。" });
      }
      const proposalMerged = makeWorkHubEvent({
        event_id: randomUUID(),
        type: eventTypes.proposalMerged,
        topic: topics.workitem(proposal.work_item_id).topic,
        ts: new Date(createdAt),
        actor,
        work_item_id: proposal.work_item_id,
        proposal_id: proposal.id,
        preview_text: `${proposal.title} 已采纳。`,
        attention,
        data: {
          proposal_id: proposal.id,
          merge_snapshot_id: mergeSnapshotId,
          rollback_available: proposal.diff_manifest.rollback.available
        }
      });
      const notification = makeWorkHubEvent({
        event_id: randomUUID(),
        type: eventTypes.notificationCreated,
        topic: topics.user(c.var.currentUser?.id ?? p05GoldPathIds.user).topic,
        ts: new Date(createdAt),
        actor: { actor_kind: "system", label: "notification-service" },
        work_item_id: proposal.work_item_id,
        proposal_id: proposal.id,
        preview_text: `${proposal.title} 已采纳。`,
        attention,
        data: attention
      });
      const auditLogs = [
        {
          id: randomUUID(),
          actor: {
            actor_kind: actor.actor_kind,
            ...(actor.actor_user_id ? { actor_user_id: actor.actor_user_id } : {}),
            ...(actor.label ? { actor_nickname: actor.label } : {})
          },
          entity: { entity_type: "proposal", entity_id: proposal.id },
          action: "proposal.merged",
          detail_json: {
            rollback_available: proposal.diff_manifest.rollback.available,
            changes: proposal.diff_manifest.changes.length
          },
          snapshot_id: mergeSnapshotId,
          created_at: createdAt
        }
      ];
      const data = proposalMergeResultSchema.parse({
        proposal_id: proposal.id,
        work_item_id: proposal.work_item_id,
        status: "merged",
        merge_snapshot_id: mergeSnapshotId,
        rollback_available: proposal.diff_manifest.rollback.available,
        rollback: proposal.diff_manifest.rollback,
        attention,
        events: [proposalMerged, notification],
        audit_logs: auditLogs
      });
      return c.json({ ok: true, data });
    }

    const fixture = getP05GoldPathFixture();
    const createdAt = nowIso();
    const actor = actorFor(c.var.actor);
    const attention = mergeAttention(createdAt);
    const proposalMerged = makeWorkHubEvent({
      event_id: p05GoldPathIds.eventProposalMerged,
      type: eventTypes.proposalMerged,
      topic: topics.workitem(p05GoldPathIds.workItem).topic,
      ts: new Date(createdAt),
      actor,
      work_item_id: p05GoldPathIds.workItem,
      project_id: p05GoldPathIds.project,
      proposal_id: p05GoldPathIds.proposal,
      preview_text: "客户周报模板已采纳。",
      attention,
      data: {
        proposal_id: p05GoldPathIds.proposal,
        merge_snapshot_id: p05GoldPathIds.mergeSnapshot,
        rollback_available: true
      }
    });
    const notification = makeWorkHubEvent({
      event_id: p05GoldPathIds.eventNotification,
      type: eventTypes.notificationCreated,
      topic: topics.user(p05GoldPathIds.user).topic,
      ts: new Date(createdAt),
      actor: { actor_kind: "system", label: "notification-service" },
      work_item_id: p05GoldPathIds.workItem,
      project_id: p05GoldPathIds.project,
      proposal_id: p05GoldPathIds.proposal,
      preview_text: "客户周报模板已合并，审计和回滚入口可用。",
      attention,
      data: attention
    });
    const auditLogs = [
      {
        id: p05GoldPathIds.auditReview,
        workspace_id: p05GoldPathIds.workspace,
        actor: {
          actor_kind: actor.actor_kind,
          ...(actor.actor_user_id ? { actor_user_id: actor.actor_user_id } : {}),
          ...(actor.label ? { actor_nickname: actor.label } : {})
        },
        entity: { entity_type: "proposal", entity_id: p05GoldPathIds.proposal },
        action: "proposal.reviewed",
        detail_json: { decision: "approve" },
        created_at: createdAt
      },
      {
        id: p05GoldPathIds.auditMerge,
        workspace_id: p05GoldPathIds.workspace,
        actor: {
          actor_kind: actor.actor_kind,
          ...(actor.actor_user_id ? { actor_user_id: actor.actor_user_id } : {}),
          ...(actor.label ? { actor_nickname: actor.label } : {})
        },
        entity: { entity_type: "proposal", entity_id: p05GoldPathIds.proposal },
        action: "proposal.merged",
        detail_json: {
          merge_snapshot_id: p05GoldPathIds.mergeSnapshot,
          rollback_available: true,
          changes: fixture.manifest.changes.length
        },
        snapshot_id: p05GoldPathIds.mergeSnapshot,
        created_at: createdAt
      }
    ];

    const data = proposalMergeResultSchema.parse({
      proposal_id: p05GoldPathIds.proposal,
      work_item_id: p05GoldPathIds.workItem,
      status: "merged",
      merge_snapshot_id: p05GoldPathIds.mergeSnapshot,
      rollback_available: true,
      rollback: fixture.manifest.rollback,
      attention,
      events: [proposalMerged, notification],
      audit_logs: auditLogs
    });

    return c.json({ ok: true, data });
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

  return routes;
}
