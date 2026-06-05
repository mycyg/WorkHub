import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedWorkItemTransitions,
  confidenceGrades,
  deliverableChangeManifestSchema,
  deliverableManifestFixtures,
  escalationTriggers,
  eventTypes,
  questionCardSchema,
  workItemStatuses
} from "./index.js";

test("work item statuses expose the data-model transition truth", () => {
  assert.deepEqual(confidenceGrades, ["low", "medium", "high"]);
  assert.equal(Object.keys(allowedWorkItemTransitions).length, workItemStatuses.length);
  assert.deepEqual(allowedWorkItemTransitions.intake, ["ai_clarifying", "cancelled"]);
  assert.deepEqual(allowedWorkItemTransitions.done, []);
  assert.equal(escalationTriggers.includes("user_unsatisfied"), true);
  assert.equal(escalationTriggers.includes("user_rejected" as never), false);
});

test("formal event names are the only exported implementation names", () => {
  const exportedEventTypes = Object.values(eventTypes) as string[];

  assert.equal(eventTypes.agentRunStarted, "agent_run.started");
  assert.equal(eventTypes.proposalOpened, "proposal.opened");
  assert.equal(exportedEventTypes.includes("agent.run.started"), false);
  assert.equal(exportedEventTypes.includes("proposal.ready"), false);
});

test("deliverable manifest fixtures cover non-code payload families", () => {
  const targetKinds = new Set<string>();

  for (const fixture of deliverableManifestFixtures) {
    const parsed = deliverableChangeManifestSchema.parse(fixture);
    for (const change of parsed.changes) {
      targetKinds.add(change.target_kind);
    }
  }

  assert.deepEqual(
    [...targetKinds].sort(),
    ["binary_doc", "folder", "image", "slide_deck", "spreadsheet", "structured_record"].sort()
  );
});

test("question cards prefer clickable choices but retain a collapsed fallback", () => {
  const parsed = questionCardSchema.parse({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    title: "这次主要要做什么？",
    input_mode: "single_choice",
    options: [
      { id: "plan", label: "先写方案" },
      { id: "draft", label: "直接起草" }
    ],
    recommended_option_ids: ["plan"],
    free_text: {
      enabled: true,
      collapsed_by_default: true
    },
    progress: [{ key: "clarify", label: "澄清", state: "active" }],
    submit: { method: "POST", href: "/api/sessions/demo/answers" }
  });

  assert.equal(parsed.options.length, 2);
  assert.equal(parsed.free_text.collapsed_by_default, true);
});
