import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";
import type { ProposalConflict } from "@workhub/contracts";

import {
  acceptedDeliverableRestoreFromHref,
  approvalRespondIdFromHref,
  bootstrapProjectActionFromHref,
  conflictsFromMergeError,
  createWorkItemActionFromHref,
  driveCommentDraftFromHref,
  driveDraftProposalFromHref,
  driveItemMutationFromHref,
  driveUploadFromHref,
  evidenceBindingWorkItemIdFromHref,
  hasCustomFieldPlaceholder,
  intakeFreeTextValue,
  materializeIntakePayload,
  mergeProposalCandidateApplyIdFromHref,
  meetingDraftProposalFromHref,
  meetingInsightActionFromHref,
  notificationActionFromHref,
  proposalActionFromHref,
  replaceCustomFieldPlaceholder,
  startAgentRunActionFromHref,
  sessionNextQuestionIdFromHref
} from "./action-payload.js";
import { inspectPostRunWorkItemClarity } from "./post-run-clarity.js";

test("R4.21 shared runtime parses route action hrefs without app-specific code", () => {
  assert.deepEqual(proposalActionFromHref("/api/proposals/p-1/review"), { proposalId: "p-1", action: "review" });
  assert.deepEqual(proposalActionFromHref("https://workhub.local/api/proposals/p%202/merge"), { proposalId: "p 2", action: "merge" });
  assert.equal(approvalRespondIdFromHref("/api/approvals/a-1/respond"), "a-1");
  assert.equal(mergeProposalCandidateApplyIdFromHref("/api/merge-proposals/mp-1/apply"), "mp-1");
  assert.equal(sessionNextQuestionIdFromHref("/api/sessions/s-1/next-question"), "s-1");
  assert.equal(createWorkItemActionFromHref("/api/workitems"), true);
  assert.equal(bootstrapProjectActionFromHref("/api/projects/bootstrap"), true);
  assert.deepEqual(startAgentRunActionFromHref("/api/workitems/w%201/agent-runs"), { workItemId: "w 1" });
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
  assert.deepEqual(notificationActionFromHref("/api/notifications/n%201/read"), {
    notificationId: "n 1",
    action: "read"
  });
  assert.deepEqual(notificationActionFromHref("/api/notifications/read-all"), {
    action: "mark_all_read"
  });
  assert.deepEqual(notificationActionFromHref("/api/notifications/n-1/dismiss"), {
    notificationId: "n-1",
    action: "dismiss"
  });
  assert.deepEqual(notificationActionFromHref("/api/notifications/n-1/complete"), {
    notificationId: "n-1",
    action: "complete"
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

test("S1 Day1 shared runtime materializes intake free text into action payload", () => {
  const option = { dataset: { intakeOptionId: "document-draft", intakeOptionSelected: "true" } };
  const input = { value: "  add screenshot evidence  " };
  const action = {
    dataset: { requestJson: "{\"selected_option_ids\":[]}" },
    setAttribute(name: string, value: string) {
      if (name === "data-request-json") {
        this.dataset.requestJson = value;
      }
    },
    closest() {
      return route;
    }
  };
  const route = {
    dataset: { r4IntakeOptionCount: "2" },
    querySelectorAll(selector: string) {
      return selector === "[data-intake-option-selected=\"true\"]" ? [option] : [action];
    },
    querySelector(selector: string) {
      return selector === "[data-intake-free-text-input]" ? input : null;
    }
  };

  assert.equal(intakeFreeTextValue(route as unknown as ParentNode), "add screenshot evidence");
  const payload = materializeIntakePayload<{ selected_option_ids: string[]; free_text?: string }>(
    action as unknown as HTMLElement
  );

  assert.equal(payload.ok, true);
  if (!payload.ok || !payload.payload) {
    assert.fail("expected intake payload to materialize");
  }
  assert.deepEqual(payload.payload.selected_option_ids, ["document-draft"]);
  assert.equal(payload.payload.free_text, "add screenshot evidence");
});

test("S1 Day2 shared runtime detects post-run WorkItem proposal and replay next actions", () => {
  const proposal = {
    dataset: { actionId: "open_proposal", s1Day2PostRunNextAction: "proposal" },
    getAttribute(name: string) {
      return name === "href" ? "/proposals/p-1" : null;
    }
  };
  const replay = {
    dataset: { actionId: "open_replay", s1Day2PostRunNextAction: "replay" },
    getAttribute(name: string) {
      return name === "href" ? "/agent-runs/r-1/replay" : null;
    }
  };
  const route = {
    dataset: { r4WorkitemId: "w-1" },
    querySelectorAll(selector: string) {
      return selector.includes("post-run") ? [proposal, replay] : [];
    }
  };
  const scope = {
    querySelector(selector: string) {
      return selector.includes("w-1") ? route : null;
    }
  };

  assert.deepEqual(inspectPostRunWorkItemClarity(scope as unknown as ParentNode, "w-1"), {
    routeVisible: true,
    workItemId: "w-1",
    actionKind: "proposal",
    actionHref: "/proposals/p-1",
    actionCount: 2
  });
  assert.deepEqual(inspectPostRunWorkItemClarity(scope as unknown as ParentNode, "missing"), {
    routeVisible: false,
    workItemId: "missing",
    actionCount: 0
  });
});
