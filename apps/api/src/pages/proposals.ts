import {
  proposalDetailVmSchema,
  type AttentionItem,
  type DeliverableChange,
  type ProposalDetailVM,
  type WorkHubLocale
} from "@workhub/contracts";

import type { StoredProposal } from "../services/proposals.js";
import type { ReviewableProposalSummary } from "../services/proposals.js";
import { pageT } from "./i18n.js";
import { parseOutputContract } from "./output-contract.js";

function isTaskPlanProposal(proposal: Pick<StoredProposal, "diff_manifest">) {
  return proposal.diff_manifest.changes.some((change) => change.target_ref.entity_type === "task_plan");
}

// R10-P1-3：agent 侧 manifest 默认生成的 /api/agent/outputs/{preview,download} href 在生产 API 没有
// 对应路由（runner 不传 href 覆盖），点了就是死链。渲染前统一改写：有可预览文本
// （machine_summary.generated_content_md）的指到已注册的 GET /api/proposals/:id/changes/:changeId/preview，
// 没有的删掉 preview_ref——不把死链渲染成可点的 affordance。存量提议（死 href 已入库）也被这层兜住。
const deadAgentOutputHref = /^\/api\/agent\/outputs\//u;

export function presentableManifestChanges(proposalId: string, changes: DeliverableChange[]): DeliverableChange[] {
  return changes.map((change) => {
    if (!change.preview_ref || !deadAgentOutputHref.test(change.preview_ref.href)) {
      return change;
    }
    if (change.machine_summary?.generated_content_md) {
      return {
        ...change,
        preview_ref: { kind: "text" as const, href: `/api/proposals/${proposalId}/changes/${change.id}/preview` }
      };
    }
    const { preview_ref: _dead, ...rest } = change;
    return rest;
  });
}

// GAP-1：把一份待评审的 AI 提议(opened/reviewed)渲染成首页决策队列里的 proposal_review 卡。
// 动作 href 与 buildProposalDetailPage 完全一致(/api/proposals/:id/review·/merge),
// 复用前端既有的提议 review·merge 点击管线;opened→通过/打回/查看,reviewed→采纳/查看。
export function buildProposalReviewAttentionItem(
  summary: Omit<ReviewableProposalSummary, "review_kind"> & { review_kind?: ReviewableProposalSummary["review_kind"] },
  locale: WorkHubLocale = "zh-CN"
): AttentionItem {
  const reviewed = summary.status === "reviewed";
  const reviewKind = summary.review_kind ?? "proposal_review";
  const planReview = reviewKind === "plan_review";
  const viewAction: AttentionItem["actions"][number] = {
    id: "open_proposal",
    label: pageT(locale, planReview ? "proposal.action.viewPlan" : "proposal.action.view"),
    style: "secondary",
    method: "GET",
    href: `/proposals/${summary.id}`
  };
  const actions: AttentionItem["actions"] = reviewed
    ? (planReview
        ? [
            { id: "approve_and_dispatch", label: pageT(locale, "proposal.action.approvePlanAndStart"), style: "primary", method: "POST", href: `/api/proposals/${summary.id}/merge`, request_json: { dispatch: true } },
            { id: "approve_hold", label: pageT(locale, "proposal.action.approvePlanHold"), style: "secondary", method: "POST", href: `/api/proposals/${summary.id}/merge`, request_json: { dispatch: false } },
            viewAction
          ]
        : [
            { id: "merge", label: pageT(locale, "proposal.action.merge"), style: "primary", method: "POST", href: `/api/proposals/${summary.id}/merge` },
            viewAction
          ])
    : (planReview
        ? [
            { id: "approve", label: pageT(locale, "proposal.action.approvePlan"), style: "primary" as const, method: "POST" as const, href: `/api/proposals/${summary.id}/review` },
            { id: "request_replan", label: pageT(locale, "proposal.action.requestPlanChanges"), style: "danger" as const, method: "POST" as const, href: `/api/proposals/${summary.id}/review`, requires_reason: true },
            // ux-flow-spec §1.1 步3：「先不拆，单个 AI 跑」——跳过军团计划，回到单 run 现状。
            { id: "skip_plan_single_run", label: pageT(locale, "proposal.action.skipPlanSingleRun"), style: "secondary" as const, method: "POST" as const, href: `/api/proposals/${summary.id}/skip-plan` },
            viewAction
          ]
        : [
            { id: "approve", label: pageT(locale, "proposal.action.approve"), style: "primary" as const, method: "POST" as const, href: `/api/proposals/${summary.id}/review` },
            { id: "request_changes", label: pageT(locale, "proposal.action.requestChanges"), style: "danger" as const, method: "POST" as const, href: `/api/proposals/${summary.id}/review`, requires_reason: true },
            viewAction
          ]);
  return {
    id: summary.id,
    kind: reviewKind,
    priority: "normal",
    work_item_id: summary.work_item_id,
    source_ref: { entity_type: "proposal", entity_id: summary.id },
    title: summary.title,
    summary_text: pageT(locale, reviewed
      ? (planReview ? "attention.planReview.reviewed" : "attention.proposalReview.reviewed")
      : (planReview ? "attention.planReview.opened" : "attention.proposalReview.opened")),
    actions,
    cuu_state: reviewed ? "carrying_document" : "asking_approval",
    created_at: summary.created_at
  };
}

export function buildProposalDetailPage(proposal: StoredProposal, locale: WorkHubLocale = "zh-CN"): ProposalDetailVM {
  const planReview = isTaskPlanProposal(proposal);
  const requestChangesAction: ProposalDetailVM["review_actions"]["request_changes"] = {
    id: planReview ? "request_replan" : "request_changes",
    label: pageT(locale, planReview ? "proposal.action.requestPlanChanges" : "proposal.action.requestChanges"),
    method: "POST",
    href: `/api/proposals/${proposal.id}/review`,
    requires_reason: true
  };
  const approveAction: ProposalDetailVM["review_actions"]["approve"] = {
    id: "approve",
    label: pageT(locale, planReview ? "proposal.action.approvePlan" : "proposal.action.approve"),
    method: "POST",
    href: `/api/proposals/${proposal.id}/review`
  };
  const reviewActions: ProposalDetailVM["review_actions"] = {
    approve: approveAction,
    request_changes: requestChangesAction
  };
  if (proposal.status === "reviewed") {
    reviewActions.merge = {
      id: planReview ? "approve_and_dispatch" : "merge",
      label: pageT(locale, planReview ? "proposal.action.approvePlanAndStart" : "proposal.action.merge"),
      method: "POST",
      href: `/api/proposals/${proposal.id}/merge`,
      ...(planReview ? { request_json: { dispatch: true } } : {})
    };
    if (planReview) {
      reviewActions.approve_hold = {
        id: "approve_hold",
        label: pageT(locale, "proposal.action.approvePlanHold"),
        method: "POST",
        href: `/api/proposals/${proposal.id}/merge`,
        request_json: { dispatch: false }
      };
    }
  }

  return parseOutputContract(proposalDetailVmSchema, {
    proposal_id: proposal.id,
    work_item_id: proposal.work_item_id,
    title: proposal.title,
    status: proposal.status,
    manifest: {
      ...proposal.diff_manifest,
      changes: presentableManifestChanges(proposal.id, proposal.diff_manifest.changes)
    },
    evidence_refs: proposal.diff_manifest.evidence_refs,
    review_actions: reviewActions,
    comments: proposal.reviews
      .filter((review) => review.reason_md)
      .map((review) => ({
        id: review.id,
        author_label: pageT(locale, review.reviewer_kind === "ai" ? "proposal.author.ai" : "proposal.author.human"),
        body: review.reason_md ?? "",
        created_at: review.created_at
      }))
  }, "proposal.detail");
}
