import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";
import type { ProposalConflict } from "@workhub/contracts";

import {
  acceptedDeliverableRestoreFromHref,
  approvalRespondIdFromHref,
  conflictsFromMergeError,
  createWorkItemActionFromHref,
  driveCommentDraftFromHref,
  driveDraftProposalFromHref,
  driveItemMutationFromHref,
  driveUploadFromHref,
  evidenceBindingWorkItemIdFromHref,
  hasCustomFieldPlaceholder,
  mergeProposalCandidateApplyIdFromHref,
  meetingDraftProposalFromHref,
  meetingInsightActionFromHref,
  proposalActionFromHref,
  replaceCustomFieldPlaceholder,
  sessionNextQuestionIdFromHref
} from "./action-payload.js";

test("R4.21 shared runtime parses route action hrefs without app-specific code", () => {
  assert.deepEqual(proposalActionFromHref("/api/proposals/p-1/review"), { proposalId: "p-1", action: "review" });
  assert.deepEqual(proposalActionFromHref("https://workhub.local/api/proposals/p%202/merge"), { proposalId: "p 2", action: "merge" });
  assert.equal(approvalRespondIdFromHref("/api/approvals/a-1/respond"), "a-1");
  assert.equal(mergeProposalCandidateApplyIdFromHref("/api/merge-proposals/mp-1/apply"), "mp-1");
  assert.equal(sessionNextQuestionIdFromHref("/api/sessions/s-1/next-question"), "s-1");
  assert.equal(createWorkItemActionFromHref("/api/workitems"), true);
  assert.equal(evidenceBindingWorkItemIdFromHref("/api/workitems/w-1/evidence-bindings"), "w-1");
  assert.deepEqual(acceptedDeliverableRestoreFromHref("/api/workitems/w-1/deliverables/ac-1/restore"), {
    workItemId: "w-1",
    acceptedChangeId: "ac-1"
  });
  assert.deepEqual(driveUploadFromHref("/api/drive/projects/p-1/files"), { projectId: "p-1" });
  assert.deepEqual(driveCommentDraftFromHref("/api/drive/projects/p-1/comments/c-1/draft"), {
    projectId: "p-1",
    commentId: "c-1"
  });
  assert.deepEqual(driveDraftProposalFromHref("/api/drive/workitems/w%201/proposal-draft"), {
    workItemId: "w 1"
  });
  assert.deepEqual(meetingInsightActionFromHref("/api/meetings/projects/p-1/insights/i%201/draft"), {
    projectId: "p-1",
    insightId: "i 1",
    action: "draft"
  });
  assert.deepEqual(meetingInsightActionFromHref("/api/meetings/projects/p-1/insights/i-1/dismiss"), {
    projectId: "p-1",
    insightId: "i-1",
    action: "dismiss"
  });
  assert.deepEqual(meetingDraftProposalFromHref("/api/meetings/workitems/w%201/proposal-draft"), {
    workItemId: "w 1"
  });
  assert.deepEqual(driveItemMutationFromHref("/api/drive/projects/p-1/items/i-1/delete"), {
    projectId: "p-1",
    itemId: "i-1",
    action: "delete"
  });
  assert.deepEqual(driveItemMutationFromHref("/api/drive/projects/p-1/items/i-1/restore"), {
    projectId: "p-1",
    itemId: "i-1",
    action: "restore"
  });
});

test("R4.21 shared runtime materializes custom field placeholders recursively", () => {
  const payload = {
    confirm: true,
    nested: ["keep", "__WORKHUB_CUSTOM_FIELD_VALUE__", { title: "__WORKHUB_CUSTOM_FIELD_VALUE__" }]
  };
  assert.equal(hasCustomFieldPlaceholder(payload), true);
  assert.deepEqual(replaceCustomFieldPlaceholder(payload, "Release note"), {
    confirm: true,
    nested: ["keep", "Release note", { title: "Release note" }]
  });
});

test("R4.21 shared runtime extracts merge conflicts from API error details", () => {
  const conflict = {
    id: "conflict-1",
    work_item_id: "work-1",
    proposal_id: "proposal-1",
    change_id: "change-1",
    target_key: "drive_item:doc.md",
    target_kind: "text_doc",
    change_type: "updated",
    headline: "Conflict",
    summary_text: "Conflict summary",
    existing: {
      proposal_id: "proposal-old",
      change_id: "change-old",
      sha256: "a".repeat(64)
    },
    incoming: {
      sha256_before: "b".repeat(64),
      sha256_after: "c".repeat(64)
    },
    recommended_option_id: "keep_current",
    options: []
  } satisfies ProposalConflict;
  const error = new WorkHubApiError(409, "merge_conflict", "conflict", {
    details: {
      conflicts: [conflict]
    }
  });
  assert.deepEqual(conflictsFromMergeError(error), [conflict]);
  assert.deepEqual(conflictsFromMergeError(new Error("plain")), []);
});
