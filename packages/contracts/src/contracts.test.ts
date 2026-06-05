import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedWorkItemTransitions,
  authContextSchema,
  createApprovalRequestSchema,
  confidenceGrades,
  identifyRequestSchema,
  respondApprovalRequestSchema,
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

test("auth contracts expose F04 identity and device shapes", () => {
  const request = identifyRequestSchema.parse({ nickname: " 小云 " });
  assert.equal(request.nickname, " 小云 ");

  const parsed = authContextSchema.parse({
    user: {
      id: "10000000-0000-4000-8000-000000000001",
      nickname: "小云",
      display_name: "小云",
      created: false,
      is_admin: false,
      availability_status: "free"
    },
    identity: {
      actor_kind: "human",
      actor_id: "10000000-0000-4000-8000-000000000001",
      actor_label: "小云",
      user_id: "10000000-0000-4000-8000-000000000001",
      org_id: "00000000-0000-4000-8000-000000000001",
      workspace_id: "00000000-0000-4000-8000-000000000002",
      is_admin: false
    }
  });

  assert.equal(parsed.identity.actor_kind, "human");
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

test("approval contracts keep UI payloads human-readable and deny reasons explicit", () => {
  const request = createApprovalRequestSchema.parse({
    action_pattern: "tool.delete_file",
    routed_to_user_id: "10000000-0000-4000-8000-000000000001",
    payload_json: {
      ui: {
        summary_text: "AI 想修改交付包里的 3 个文件，需要你点头。",
        risk: { level: "medium", human_label: "影响面不小，稳一点" }
      },
      raw_args: { files: ["a.md"] }
    }
  });

  assert.equal(request.kind, "tool");
  assert.equal(request.payload_json.ui?.summary_text.includes("tool.delete_file"), false);
  assert.throws(() => respondApprovalRequestSchema.parse({ decision: "deny", reason_md: "" }));
});
