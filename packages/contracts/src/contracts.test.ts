import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedWorkItemTransitions,
  agentRunTraceVmSchema,
  attentionItemSchema,
  authContextSchema,
  budgetDecisionSchema,
  budgetNoticeSchema,
  budgetPolicySchema,
  budgetPolicyUpdateSchema,
  budgetUsageSchema,
  createApprovalRequestSchema,
  confidenceGrades,
  identifyRequestSchema,
  replayTracePageVmSchema,
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

test("agent trace VM carries F08 replay and structured handoff fields", () => {
  const parsed = agentRunTraceVmSchema.parse({
    run: {
      id: "70000000-0000-4000-8000-000000000001",
      work_item_id: "70000000-0000-4000-8000-000000000002",
      mode: "worker",
      actor: "ai-worker",
      status: "escalated",
      model: "deepseek-v4-flash",
      turns_used: 3,
      max_turns: 15,
      token_in: 12,
      token_out: 8,
      created_at: "2026-06-05T00:00:00.000Z",
      updated_at: "2026-06-05T00:00:00.000Z"
    },
    steps: [],
    budget: { max_steps: 15 },
    snapshot_refs: [],
    handoff: {
      done: ["read the draft"],
      remaining: ["confirm"],
      next_steps: ["open replay"],
      blockers: ["budget"],
      artifacts: [],
      budget_hit: "doom_loop"
    },
    replay_href: "/api/agent-runs/70000000-0000-4000-8000-000000000001/replay"
  });

  assert.equal(parsed.handoff?.budget_hit, "doom_loop");
});

test("replay pages carry F10 audit facts and rollback state", () => {
  const parsed = replayTracePageVmSchema.parse({
    run: {
      id: "71000000-0000-4000-8000-000000000001",
      work_item_id: "71000000-0000-4000-8000-000000000002",
      mode: "worker",
      actor: "ai-worker",
      status: "succeeded",
      model: "deepseek-v4-flash",
      turns_used: 2,
      max_turns: 15,
      token_in: 20,
      token_out: 30,
      created_at: "2026-06-05T00:00:00.000Z",
      updated_at: "2026-06-05T00:00:00.000Z"
    },
    steps: [],
    evidence_refs: [],
    snapshots: [
      {
        id: "71000000-0000-4000-8000-000000000003",
        work_item_id: "71000000-0000-4000-8000-000000000002",
        kind: "pre_step",
        ref: "snapshots/71000000-0000-4000-8000-000000000003",
        created_by_kind: "ai",
        created_at: "2026-06-05T00:00:00.000Z"
      }
    ],
    audit_logs: [
      {
        id: "71000000-0000-4000-8000-000000000004",
        actor: { actor_kind: "ai" },
        entity: { entity_type: "work_item", entity_id: "71000000-0000-4000-8000-000000000002" },
        action: "tool.write_file",
        detail_json: {},
        snapshot_id: "71000000-0000-4000-8000-000000000003",
        created_at: "2026-06-05T00:00:00.000Z"
      }
    ],
    manifest_facts: {
      checks: { snapshot_exists: "passed", revert_available: "passed" },
      rollback: {
        available: true,
        snapshot_id: "71000000-0000-4000-8000-000000000003",
        description: "可以还原到本次改动前。"
      },
      risk: { reversible: true, irreversible_reasons: [] },
      evidence_refs: [{ source_type: "audit_log", source_id: "71000000-0000-4000-8000-000000000004", title: "tool.write_file audit" }]
    }
  });

  assert.equal(parsed.manifest_facts?.rollback.available, true);
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

test("cost governance contracts expose clickable budget notices and scoped usage", () => {
  const policy = budgetPolicySchema.parse({
    id: "pcost-workitem-run-v0",
    scope_kind: "workitem",
    period: "run",
    max_tokens: 120000,
    max_cost_cny: "5",
    warning_ratio: 0.8,
    critical_ratio: 0.95,
    on_warning: "downgrade_model",
    on_exhausted: "handoff_current_run",
    model_route_hint: "balanced",
    enabled: true,
    version: 1
  });
  const usage = budgetUsageSchema.parse({
    scope: { kind: "workitem", workitem_id: "74000000-0000-4000-8000-000000000001" },
    scope_label: "生成周报模板",
    policy_id: "pcost-workitem-run-v0",
    period: "run",
    period_start: "2026-06-05T00:00:00.000Z",
    period_end: "2026-06-05T00:05:00.000Z",
    token_in: 80000,
    token_out: 24000,
    total_tokens: 104000,
    max_tokens: 120000,
    remaining_tokens: 16000,
    estimated_cost_cny: "4.2",
    max_cost_cny: "5",
    remaining_cost_cny: "0.8",
    warning_ratio: 0.84,
    status: "warning"
  });
  const notice = budgetNoticeSchema.parse({
    code: "budget_warning",
    severity: "warning",
    message: "预算快用完了。",
    scope: usage.scope,
    usage_ratio: usage.warning_ratio,
    recommended_action: "downgrade_model",
    options: [
      { id: "continue_low_cost", label: "继续但降级模型", action_href: "/api/workitems/demo/agent-runs" },
      { id: "open_cost", label: "查看预算", action_href: "/dashboard/cost" }
    ]
  });
  const decision = budgetDecisionSchema.parse({
    decision_id: "decision-budget",
    allowed: false,
    reason: "budget_exhausted",
    run_budget: {
      max_steps: 15,
      total_timeout_s: 300,
      max_tokens: policy.max_tokens,
      max_cost_cny: policy.max_cost_cny
    },
    limiting_scope: usage.scope,
    model_route: {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      reason: "near_budget_downgrade"
    },
    notice: {
      code: "budget_exhausted",
      severity: "critical",
      message: "AI 预算已经用完，先暂停新的自动执行。",
      scope: usage.scope,
      usage_ratio: 1,
      recommended_action: "pause"
    }
  });

  assert.equal(policy.scope_kind, "workitem");
  assert.equal(usage.status, "warning");
  assert.equal(notice.options?.length, 2);
  const attention = attentionItemSchema.parse({
    id: "75000000-0000-4000-8000-000000000001",
    kind: "budget",
    priority: "normal",
    source_ref: { entity_type: "budget_notice", entity_id: "75000000-0000-4000-8000-000000000001" },
    title: "预算快到线了",
    summary_text: notice.message,
    actions: [
      {
        id: "continue_low_cost",
        label: "继续但降级模型",
        style: "primary",
        method: "POST",
        href: "/api/workitems/demo/agent-runs"
      }
    ],
    cuu_state: "worried",
    created_at: "2026-06-05T00:00:00.000Z"
  });
  assert.equal(attention.kind, "budget");
  assert.equal(decision.reason, "budget_exhausted");
  assert.throws(() => budgetPolicySchema.parse({ ...policy, warning_ratio: 0.96 }));
  assert.throws(() => budgetPolicyUpdateSchema.parse({}));
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
