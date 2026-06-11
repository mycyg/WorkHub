import {
  proposalDetailVmSchema,
  type ProposalDetailVM,
  type WorkHubLocale
} from "@workhub/contracts";

import type { StoredProposal } from "../services/proposals.js";
import { pageT } from "./i18n.js";

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
