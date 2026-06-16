import {
  proposalDetailVmSchema,
  type AttentionItem,
  type ProposalDetailVM,
  type WorkHubLocale
} from "@workhub/contracts";

import type { StoredProposal } from "../services/proposals.js";
import { pageT } from "./i18n.js";

// GAP-1：把一份待评审的 AI 提议(opened/reviewed)渲染成首页决策队列里的 proposal_review 卡。
// 动作 href 与 buildProposalDetailPage 完全一致(/api/proposals/:id/review·/merge),
// 复用前端既有的提议 review·merge 点击管线;opened→通过/打回/查看,reviewed→采纳/查看。
export function buildProposalReviewAttentionItem(
  summary: { id: string; work_item_id: string; title: string; status: "opened" | "reviewed"; created_at: string },
  locale: WorkHubLocale = "zh-CN"
): AttentionItem {
  const reviewed = summary.status === "reviewed";
  const viewAction: AttentionItem["actions"][number] = {
    id: "open_proposal",
    label: pageT(locale, "proposal.action.view"),
    style: "secondary",
    method: "GET",
    href: `/proposals/${summary.id}`
  };
  const actions: AttentionItem["actions"] = reviewed
    ? [
        { id: "merge", label: pageT(locale, "proposal.action.merge"), style: "primary", method: "POST", href: `/api/proposals/${summary.id}/merge` },
        viewAction
      ]
    : [
        { id: "approve", label: pageT(locale, "proposal.action.approve"), style: "primary", method: "POST", href: `/api/proposals/${summary.id}/review` },
        { id: "request_changes", label: pageT(locale, "proposal.action.requestChanges"), style: "danger", method: "POST", href: `/api/proposals/${summary.id}/review`, requires_reason: true },
        viewAction
      ];
  return {
    id: summary.id,
    kind: "proposal_review",
    priority: "normal",
    work_item_id: summary.work_item_id,
    source_ref: { entity_type: "proposal", entity_id: summary.id },
    title: summary.title,
    summary_text: pageT(locale, reviewed ? "attention.proposalReview.reviewed" : "attention.proposalReview.opened"),
    actions,
    cuu_state: reviewed ? "carrying_document" : "asking_approval",
    created_at: summary.created_at
  };
}

export function buildProposalDetailPage(proposal: StoredProposal, locale: WorkHubLocale = "zh-CN"): ProposalDetailVM {
  const requestChangesAction: ProposalDetailVM["review_actions"]["request_changes"] = {
    id: "request_changes",
    label: pageT(locale, "proposal.action.requestChanges"),
    method: "POST",
    href: `/api/proposals/${proposal.id}/review`,
    requires_reason: true
  };
  const approveAction: ProposalDetailVM["review_actions"]["approve"] = {
    id: "approve",
    label: pageT(locale, "proposal.action.approve"),
    method: "POST",
    href: `/api/proposals/${proposal.id}/review`
  };
  const reviewActions: ProposalDetailVM["review_actions"] = {
    approve: approveAction,
    request_changes: requestChangesAction
  };
  if (proposal.status === "reviewed") {
    reviewActions.merge = {
      id: "merge",
      label: pageT(locale, "proposal.action.merge"),
      method: "POST",
      href: `/api/proposals/${proposal.id}/merge`
    };
  }

  return proposalDetailVmSchema.parse({
    proposal_id: proposal.id,
    work_item_id: proposal.work_item_id,
    title: proposal.title,
    status: proposal.status,
    manifest: proposal.diff_manifest,
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
  });
}
