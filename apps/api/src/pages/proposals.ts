import {
  proposalDetailVmSchema,
  type ProposalDetailVM
} from "@workhub/contracts";

import type { StoredProposal } from "../services/proposals.js";

export function buildProposalDetailPage(proposal: StoredProposal): ProposalDetailVM {
  const requestChangesAction: ProposalDetailVM["review_actions"]["request_changes"] = {
    id: "request_changes",
    label: "打回并说明原因",
    method: "POST",
    href: `/api/proposals/${proposal.id}/review`,
    requires_reason: true
  };
  const approveAction: ProposalDetailVM["review_actions"]["approve"] = {
    id: "approve",
    label: "确认",
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
      label: "采纳到正式版",
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
        author_label: review.reviewer_kind === "ai" ? "AI Reviewer" : "负责人",
        body: review.reason_md ?? "",
        created_at: review.created_at
      }))
  });
}
