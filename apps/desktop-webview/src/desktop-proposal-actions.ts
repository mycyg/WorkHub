import type { WorkHubApiClient } from "@workhub/api-client";
import type { WorkHubLocale } from "@workhub/ui/gold-path";
import {
  actionElementMergePayload,
  actionErrorNotice,
  actionSuccessNotice,
  actionSummary,
  reasonRequiredNotice,
  reviewReasonButtons,
  proposalActionFromHref,
  type ActionPayloadResult,
  type RouteNoticeVM
} from "@workhub/web-runtime";

import { reviewProposalWithoutMerge } from "./spotlight/views/proposals.js";

export type DesktopProposalActionClient = Pick<WorkHubApiClient, "reviewProposal" | "mergeProposal">;

export type DesktopProposalActionInput = {
  href: string;
  actionTarget: HTMLElement;
  actionId?: string | undefined;
  requiresReason: boolean;
  locale: WorkHubLocale;
  client: DesktopProposalActionClient;
  showRouteNotice: (notice: RouteNoticeVM, extraHtml?: string | undefined, timeoutMs?: number | undefined) => void;
  showPayloadFailureNotice: (payload: ActionPayloadResult<unknown>, actionId?: string | undefined) => void;
  showMergeConflictNotice: (error: unknown, actionId?: string | undefined) => boolean;
  setPendingReview?: ((href: string, actionId: string) => void) | undefined;
  onActionSettled?: (() => void) | undefined;
};

export async function handleDesktopProposalAction(input: DesktopProposalActionInput) {
  const proposalAction = proposalActionFromHref(input.href);
  if (!proposalAction) {
    return false;
  }

  if (proposalAction.action === "review") {
    if (input.requiresReason) {
      const pendingActionId = input.actionId ?? "request_changes";
      input.setPendingReview?.(input.href, pendingActionId);
      input.showRouteNotice(
        reasonRequiredNotice(input.locale, pendingActionId),
        reviewReasonButtons(input.locale)
      );
      return true;
    }

    try {
      const review = await reviewProposalWithoutMerge(input.client, proposalAction.proposalId);
      input.showRouteNotice(
        actionSuccessNotice(input.locale, actionSummary(review, input.locale), input.actionId)
      );
    } catch (error) {
      input.showRouteNotice(actionErrorNotice(input.locale, error, input.actionId));
    }
    input.onActionSettled?.();
    return true;
  }

  if (proposalAction.action === "merge") {
    const payload = actionElementMergePayload(input.actionTarget);
    if (!payload.ok) {
      input.showPayloadFailureNotice(payload, input.actionId);
      return true;
    }
    try {
      const merge = await input.client.mergeProposal(proposalAction.proposalId, payload.payload);
      input.showRouteNotice(
        actionSuccessNotice(input.locale, actionSummary(merge, input.locale), input.actionId)
      );
    } catch (error) {
      if (!input.showMergeConflictNotice(error, input.actionId)) {
        input.showRouteNotice(actionErrorNotice(input.locale, error, input.actionId));
      }
    }
    input.onActionSettled?.();
    return true;
  }

  return false;
}
