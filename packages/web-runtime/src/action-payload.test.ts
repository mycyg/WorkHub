import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";
import type { ProposalConflict } from "@workhub/contracts";

import {
  acceptedDeliverableRestoreFromHref,
  actionElementCreateProjectPayload,
  actionElementJsonPayload,
  approvalRespondIdFromHref,
  bootstrapProjectActionFromHref,
  conflictsFromMergeError,
  createTaskPlanActionFromHref,
  createNamedProjectActionFromHref,
  createWorkItemActionFromHref,
  driveCommentDraftFromHref,
  driveDraftProposalFromHref,
  driveItemMutationFromHref,
  driveUploadFromHref,
  evidenceBindingWorkItemIdFromHref,
  escalationActionFromHref,
  hasCustomFieldPlaceholder,
  intakeFreeTextValue,
  materializeIntakePayload,
  mergeProposalCandidateApplyIdFromHref,
  meetingDraftProposalFromHref,
  meetingInsightActionFromHref,
  memoryConflictActionFromHref,
  skipPlanProposalIdFromHref,
  taskPlanDispatchActionFromHref,
  isNativeResourceLink,
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
  assert.equal(createNamedProjectActionFromHref("/api/projects/bootstrap"), true);
  assert.equal(createNamedProjectActionFromHref("/api/projects"), false);
  assert.deepEqual(createTaskPlanActionFromHref("/api/workitems/w%201/task-plan"), { workItemId: "w 1" });
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
  // R15 批 A（A2 提醒阶梯）：暂停提醒。
  assert.deepEqual(notificationActionFromHref("/api/notifications/n-1/snooze"), {
    notificationId: "n-1",
    action: "snooze"
  });
  assert.deepEqual(escalationActionFromHref("/api/escalations/e%201/resolve"), {
    escalationId: "e 1",
    action: "resolve"
  });
  assert.deepEqual(escalationActionFromHref("/api/escalations/e-1/delegate"), {
    escalationId: "e-1",
    action: "delegate"
  });
  assert.deepEqual(escalationActionFromHref("/api/escalations/e%201/budget-actions/finish_current_output"), {
    escalationId: "e 1",
    action: "budget",
    budgetActionId: "finish_current_output"
  });
  assert.deepEqual(memoryConflictActionFromHref("/api/memory-conflicts/m%201/resolve/keep_current?expected_updated_at=2026-07-03T10%3A40%3A00.000Z"), {
    conflictId: "m 1",
    resolution: "keep_current",
    expectedUpdatedAt: "2026-07-03T10:40:00.000Z"
  });
  assert.deepEqual(memoryConflictActionFromHref("https://workhub.local/api/memory-conflicts/m-2/resolve/merge_both?expected_updated_at=2026-07-03T10%3A41%3A00.000Z"), {
    conflictId: "m-2",
    resolution: "merge_both",
    expectedUpdatedAt: "2026-07-03T10:41:00.000Z"
  });
  // R9.7 review: the old assertion accepted memory-conflict POST hrefs with no version.
  // That was wrong because stale cards need an updated_at token before the client can resolve.
  assert.equal(memoryConflictActionFromHref("https://workhub.local/api/memory-conflicts/m-2/resolve/merge_both"), undefined);
  assert.equal(memoryConflictActionFromHref("/api/memory-conflicts/m-1/resolve/delete_everything"), undefined);
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

test("drive download resource links can bypass the delegated API action proxy", () => {
  const nativeLink = {
    dataset: {
      nativeResourceLink: "true",
      actionId: "drive_download"
    }
  } as unknown as HTMLElement;
  const mutationLink = {
    dataset: {
      actionId: "drive_restore",
      method: "POST"
    }
  } as unknown as HTMLElement;

  assert.equal(isNativeResourceLink(nativeLink), true);
  assert.equal(isNativeResourceLink(mutationLink), false);
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

test("M28 custom-field action re-substitutes the latest textarea value on every click", () => {
  let textareaValue = "first value";
  // 模拟 type=button 的 custom 按钮：只有 requestJsonTemplate（含占位符），textarea 值可变。
  const button = {
    dataset: { requestJsonTemplate: "{\"value\":\"__WORKHUB_CUSTOM_FIELD_VALUE__\"}", structuredField: "title" } as Record<string, string>,
    closest: () => ({ querySelector: () => ({ value: textareaValue }) })
  } as unknown as HTMLElement;

  const first = actionElementJsonPayload<{ value: string }>(button);
  assert.equal(first.ok, true);
  assert.deepEqual(first.payload, { value: "first value" });

  // 用户改了输入再点一次：必须用新值，而不是上次物化的旧值。
  textareaValue = "second value";
  const second = actionElementJsonPayload<{ value: string }>(button);
  assert.equal(second.ok, true);
  assert.deepEqual(second.payload, { value: "second value" });
  // 物化结果不得写回 requestJson 污染下一次点击。
  assert.equal(button.dataset.requestJson, undefined);
});

test("R8 /projects create reads the typed name and fails closed on empty", () => {
  let nameValue = "  Aurora Launch  ";
  const form = { querySelector: () => ({ value: nameValue }) };
  const button = { closest: () => form } as unknown as HTMLElement;

  const filled = actionElementCreateProjectPayload(button);
  assert.equal(filled.ok, true);
  assert.deepEqual(filled.payload, { name: "Aurora Launch" });

  nameValue = "   ";
  const empty = actionElementCreateProjectPayload(button);
  assert.deepEqual(empty, { ok: false, reason: "field_value_required" });
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


// B-R9.6 UX 审计：skip-plan 与暂停/恢复派发的 href 识别（假接线修复的最小锚点）。
test("skipPlanProposalIdFromHref and taskPlanDispatchActionFromHref parse their endpoints", () => {
  assert.equal(skipPlanProposalIdFromHref("/api/proposals/p%201/skip-plan"), "p 1");
  assert.equal(skipPlanProposalIdFromHref("/api/proposals/p1/review"), undefined);
  assert.deepEqual(taskPlanDispatchActionFromHref("/api/task-plans/t1/pause"), { planId: "t1", action: "pause" });
  assert.deepEqual(taskPlanDispatchActionFromHref("/api/task-plans/t1/resume"), { planId: "t1", action: "resume" });
  assert.equal(taskPlanDispatchActionFromHref("/api/task-plans/t1/cancel"), undefined);
});
