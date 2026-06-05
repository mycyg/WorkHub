import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { p05GoldPathIds } from "@workhub/agent/fixtures";
import {
  eventTypes,
  mergeProposalRequestSchema,
  proposalMergeResultSchema,
  proposalReviewResultSchema,
  reviewProposalRequestSchema,
  type AttentionItem
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

export type ProposalRoutesDependencies = {
  auth?: AuthDependencySource;
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

export function createProposalRoutes(deps: ProposalRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const authSettings = getAuthSettings(resolveAuthDependencies(authSource));
  const allowUnauthenticatedGoldPath = deps.allowUnauthenticatedGoldPath ?? authSettings.appEnv !== "production";
  const authMiddleware = allowUnauthenticatedGoldPath
    ? createOptionalCurrentUserMiddleware(authSource)
    : createCurrentUserMiddleware(authSource);

  routes.post("/:id/review", authMiddleware, async (c) => {
    if (!isP05ProposalId(c.req.param("id"))) {
      throw new HTTPException(404, { message: "没有找到这个变更申请。" });
    }

    const payload = reviewProposalRequestSchema.parse(await readJsonBody(c));
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
      event
    });

    return c.json({ ok: true, data });
  });

  routes.post("/:id/merge", authMiddleware, async (c) => {
    if (!isP05ProposalId(c.req.param("id"))) {
      throw new HTTPException(404, { message: "没有找到这个变更申请。" });
    }

    mergeProposalRequestSchema.parse(await readJsonBody(c));
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
