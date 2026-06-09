import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedWorkItemTransitions,
  agentRunLiveVmSchema,
  agentRunTraceVmSchema,
  attentionItemSchema,
  authContextSchema,
  budgetDecisionSchema,
  budgetNoticeSchema,
  budgetPolicySchema,
  budgetPolicyUpdateSchema,
  budgetUsageSchema,
  applyMergeProposalCandidateRequestSchema,
  chooseMergeProposalCandidateRequestSchema,
  createApprovalRequestSchema,
  confidenceGrades,
  identifyRequestSchema,
  normalizeWorkHubLocale,
  mergeProposalRequestSchema,
  mergeProposalCandidateChoiceResultSchema,
  nextQuestionRequestSchema,
  proposalConflictListResultSchema,
  replayTracePageVmSchema,
  respondApprovalRequestSchema,
  updateUserPreferencesRequestSchema,
  userPreferencesSchema,
  deliverableChangeManifestSchema,
  deliverableManifestFixtures,
  evidenceBubbleSchema,
  escalationTriggers,
  eventTypes,
  questionCardSchema,
  sessionVmSchema,
  useEvidenceForTaskRequestSchema,
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

test("shared locale contract normalizes the bilingual product surface", () => {
  assert.equal(normalizeWorkHubLocale("en"), "en-US");
  assert.equal(normalizeWorkHubLocale("en_US"), "en-US");
  assert.equal(normalizeWorkHubLocale("zh-Hans-CN"), "zh-CN");
  assert.equal(normalizeWorkHubLocale("fr-FR"), "zh-CN");
  assert.deepEqual(userPreferencesSchema.parse({ locale: "zh-CN" }), { locale: "zh-CN" });
  assert.deepEqual(updateUserPreferencesRequestSchema.parse({ locale: "en" }), { locale: "en-US" });
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

test("agent run live VMs expose start status, trace, stream, replay, and budget fields", () => {
  const parsed = agentRunLiveVmSchema.parse({
    run: {
      id: "70000000-0000-4000-8000-000000000011",
      work_item_id: "70000000-0000-4000-8000-000000000012",
      mode: "worker",
      actor: "human",
      status: "running",
      model: "deepseek-v4-flash",
      turns_used: 1,
      max_turns: 15,
      token_in: 10,
      token_out: 20,
      created_at: "2026-06-05T00:00:00.000Z",
      updated_at: "2026-06-05T00:00:01.000Z"
    },
    run_id: "70000000-0000-4000-8000-000000000011",
    work_item_id: "70000000-0000-4000-8000-000000000012",
    title: "生成客户周报模板",
    status: "running",
    budget: { max_steps: 15, total_timeout_s: 300, max_tokens: 120000, max_cost_cny: "5" },
    budget_decision: {
      decision_id: "decision-run",
      allowed: true,
      model_route: { provider: "deepseek", model: "deepseek-v4-flash", reason: "default" }
    },
    usage: { steps_used: 1, token_in: 10, token_out: 20, estimated_cost_cny: "0.003" },
    trace: [
      {
        id: "70000000-0000-4000-8000-000000000013",
        agent_run_id: "70000000-0000-4000-8000-000000000011",
        step_no: 1,
        phase: "think",
        input_json: {},
        output_excerpt: "Cuu 正在读取项目文档。",
        created_at: "2026-06-05T00:00:01.000Z"
      }
    ],
    stream_href: "/api/push/stream/run/70000000-0000-4000-8000-000000000011",
    replay_href: "/api/agent-runs/70000000-0000-4000-8000-000000000011/replay"
  });

  assert.equal(parsed.run_id, parsed.run.id);
  assert.equal(parsed.trace[0]?.phase, "think");
  assert.equal(parsed.replay_href.endsWith("/replay"), true);
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
    accepted_deliverables: [
      {
        id: "71000000-0000-4000-8000-000000000005",
        work_item_id: "71000000-0000-4000-8000-000000000002",
        proposal_id: "71000000-0000-4000-8000-000000000006",
        change_id: "71000000-0000-4000-8000-000000000009",
        target_kind: "delivery",
        target_key: "delivery:/outputs/result.md",
        change_type: "created",
        accepted_version: 2,
        target_path: "/outputs/result.md",
        sha256: "a".repeat(64),
        drive_item_id: "71000000-0000-4000-8000-000000000007",
        drive_version_id: "71000000-0000-4000-8000-000000000008",
        filename: "result.md",
        mime: "text/markdown",
        size_bytes: 120,
        download_href: "/api/workitems/71000000-0000-4000-8000-000000000002/deliverables/71000000-0000-4000-8000-000000000005/download",
        preview_href: "/api/workitems/71000000-0000-4000-8000-000000000002/deliverables/71000000-0000-4000-8000-000000000005/preview",
        restore_href: "/api/workitems/71000000-0000-4000-8000-000000000002/deliverables/71000000-0000-4000-8000-000000000005/restore",
        accepted_at: "2026-06-05T00:00:00.000Z"
      }
    ],
    merge_timeline: [
      {
        id: "71000000-0000-4000-8000-000000000010",
        proposal_id: "71000000-0000-4000-8000-000000000006",
        work_item_id: "71000000-0000-4000-8000-000000000002",
        branch_id: "71000000-0000-4000-8000-000000000011",
        actor_kind: "human",
        actor_user_id: "71000000-0000-4000-8000-000000000012",
        result: "merged",
        merge_snapshot_id: "71000000-0000-4000-8000-000000000003",
        conflict_count: 1,
        target_keys: ["delivery:/outputs/result.md"],
        accepted_target_keys: ["delivery:/outputs/result.md"],
        conflicts: [{ target_key: "delivery:/outputs/result.md" }],
        decisions: [
          {
            id: "71000000-0000-4000-8000-000000000013",
            conflict_key: "delivery:/outputs/result.md",
            recommended_option_key: "keep_current",
            chosen_option_key: "accept_incoming",
            chosen_by_user_id: "71000000-0000-4000-8000-000000000012",
            chosen_at: "2026-06-05T00:00:00.000Z",
            candidates: [
              {
                option_key: "keep_current",
                target_kind: "delivery",
                rationale_md: "保留当前正式版，不覆盖已经采纳的交付物。",
                recommended: true
              },
              {
                option_key: "accept_incoming",
                target_kind: "delivery",
                rationale_md: "明确采纳这次版本，覆盖当前正式版，并保留还原入口。",
                chosen: true
              },
              {
                option_key: "ai_fusion",
                target_kind: "text_doc",
                rationale_md: "AI 生成了一个融合建议，等待用户选择。",
                merged_value: { proposed_resolution_md: "保留正式版结论，吸收这次版本新增说明。" }
              }
            ]
          }
        ],
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
  assert.equal(parsed.accepted_deliverables[0]?.download_href?.includes("/download"), true);
  assert.equal(parsed.accepted_deliverables[0]?.restore_href?.includes("/restore"), true);
  assert.equal(parsed.merge_timeline[0]?.decisions[0]?.chosen_option_key, "accept_incoming");
  assert.equal(parsed.merge_timeline[0]?.decisions[0]?.candidates[0]?.recommended, true);
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
      locale: "zh-CN",
      preferences: { locale: "zh-CN" },
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
  assert.equal(eventTypes.confidenceScored, "confidence.scored");
  assert.equal(eventTypes.escalationOpened, "escalation.opened");
  assert.equal(eventTypes.proposalOpened, "proposal.opened");
  assert.equal(eventTypes.revisionFedback, "revision.fedback");
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

test("proposal conflict cards carry option-first merge resolution payloads", () => {
  const parsed = proposalConflictListResultSchema.parse({
    conflicts: [
      {
        id: "proposal-1:change-1:delivery:/outputs/result.md",
        work_item_id: "72000000-0000-4000-8000-000000000001",
        proposal_id: "72000000-0000-4000-8000-000000000002",
        merge_proposal_id: "72000000-0000-4000-8000-000000000009",
        change_id: "72000000-0000-4000-8000-000000000003",
        target_key: "delivery:/outputs/result.md",
        target_kind: "delivery",
        change_type: "generated",
        target_path: "/outputs/result.md",
        headline: "「/outputs/result.md」和正式版撞车了",
        summary_text: "Cuu 先给两个安全选项。",
        existing: {
          proposal_id: "72000000-0000-4000-8000-000000000004",
          change_id: "72000000-0000-4000-8000-000000000005",
          sha256: "a".repeat(64)
        },
        incoming: {
          sha256_after: "b".repeat(64)
        },
        recommended_option_id: "keep_current",
        options: [
          {
            id: "keep_current",
            label: "保留正式版",
            summary_text: "不覆盖当前正式交付物。",
            recommended: true,
            action: {
              id: "open_proposal",
              label: "查看变更申请",
              method: "GET",
              href: "/proposals/72000000-0000-4000-8000-000000000002"
            }
          },
            {
              id: "accept_incoming",
              label: "采纳这次版本",
              summary_text: "明确覆盖当前正式版。",
            action: {
              id: "accept_incoming",
              label: "采纳这次版本",
              method: "POST",
              href: "/api/proposals/72000000-0000-4000-8000-000000000002/merge",
              request_json: {
                conflict_resolution: {
                  accept_incoming_target_keys: ["delivery:/outputs/result.md"]
                }
                }
              }
            },
            {
              id: "ai_fusion",
              label: "采用 AI 融合稿",
              summary_text: "采用 AI 生成的融合稿。",
              quality_gate: {
                text_patch_preview: {
                  type: "unified_text_patch_preview",
                  base_available: true,
                  stats: {
                    changed: true,
                    added_lines: 1,
                    removed_lines: 1,
                    overlap_risk: "requires_review"
                  },
                  hunks: [
                    {
                      header: "@@ -1 +1 @@",
                      lines: ["-正式版已有结论。", "+融合后的正文"]
                    }
                  ]
                }
              },
              action: {
                id: "apply_ai_fusion",
                label: "采用 AI 融合稿",
                method: "POST",
                href: "/api/merge-proposals/72000000-0000-4000-8000-000000000009/apply",
                request_json: { confirm: true }
              }
            }
          ]
        }
    ]
  });
  const request = mergeProposalRequestSchema.parse(
    parsed.conflicts[0]?.options.find((option) => option.id === "accept_incoming")?.action?.request_json
  );
  const aiFusionRequest = applyMergeProposalCandidateRequestSchema.parse(
    parsed.conflicts[0]?.options.find((option) => option.id === "ai_fusion")?.action?.request_json
  );

  assert.equal(parsed.conflicts[0]?.recommended_option_id, "keep_current");
  assert.equal(parsed.conflicts[0]?.merge_proposal_id, "72000000-0000-4000-8000-000000000009");
  assert.equal(parsed.conflicts[0]?.options.some((option) => option.id === "ai_fusion"), true);
  const preview = parsed.conflicts[0]?.options.find((option) => option.id === "ai_fusion")?.quality_gate?.["text_patch_preview"] as
    | { type?: string; stats?: { overlap_risk?: string } }
    | undefined;
  assert.equal(preview?.type, "unified_text_patch_preview");
  assert.equal(preview?.stats?.overlap_risk, "requires_review");
  assert.deepEqual(request.conflict_resolution?.accept_incoming_target_keys, ["delivery:/outputs/result.md"]);
  assert.equal(aiFusionRequest.confirm, true);
});

test("merge proposal candidate choices are explicit and replayable", () => {
  const request = chooseMergeProposalCandidateRequestSchema.parse({
    option_key: "ai_fusion"
  });
  const applyRequest = applyMergeProposalCandidateRequestSchema.parse({});
  const result = mergeProposalCandidateChoiceResultSchema.parse({
    merge_proposal_id: "72000000-0000-4000-8000-000000000009",
    conflict_key: "delivery:/outputs/result.md",
    chosen_option_key: request.option_key,
    chosen_by_user_id: "72000000-0000-4000-8000-000000000010",
    chosen_at: "2026-06-09T00:00:00.000Z",
    candidate: {
      option_key: "ai_fusion",
      target_kind: "text_doc",
      rationale_md: "融合正式版结论和新增证据。",
      source: "llm",
      quality_gate: { status: "passed" },
      merged_value: { proposed_resolution_md: "融合稿" }
    }
  });

  assert.equal(result.chosen_option_key, "ai_fusion");
  assert.equal(result.candidate.source, "llm");
  assert.equal(result.candidate.quality_gate?.status, "passed");
  assert.equal(applyRequest.confirm, true);
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

test("next question requests carry clicked option ids before text fallback", () => {
  const parsed = nextQuestionRequestSchema.parse({
    selected_option_ids: ["risk-first", "summary-only"],
    free_text: "  只补一句  "
  });

  assert.deepEqual(parsed.selected_option_ids, ["risk-first", "summary-only"]);
  assert.equal(parsed.free_text, "只补一句");
});

test("session VMs carry option-first intake and stream metadata", () => {
  const parsed = sessionVmSchema.parse({
    session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    work_item_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    topic: "session:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    stream_href: "/api/push/stream/session/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    next_question_href: "/api/sessions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/next-question",
    question: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "这次主要要做什么？",
      input_mode: "single_choice",
      options: [
        { id: "plan", label: "先写方案" },
        { id: "draft", label: "直接起草" }
      ],
      free_text: {
        enabled: true,
        collapsed_by_default: true
      },
      progress: [{ key: "clarify", label: "澄清", state: "active" }],
      submit: { method: "POST", href: "/api/sessions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/next-question" }
    }
  });

  assert.equal(parsed.topic, `session:${parsed.session_id}`);
  assert.equal(parsed.question.input_mode, "single_choice");
  assert.equal(parsed.question.free_text.collapsed_by_default, true);
});

test("evidence bubbles expose POST binding actions for Cuu-first task continuation", () => {
  const evidenceRef = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    source_type: "meeting",
    source_id: "meeting-weekly-sync",
    title: "上次周会纪要",
    confidence_hint: "found"
  };
  const bubble = evidenceBubbleSchema.parse({
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    query_text: "客户成功周报",
    summary_text: "找到了会议和网盘证据。",
    evidence_refs: [evidenceRef],
    actions: [
      {
        id: "use_for_current_task",
        label: "用这些证据继续",
        method: "POST",
        href: "/api/workitems/cccccccc-cccc-4ccc-8ccc-cccccccccccc/evidence-bindings"
      },
      { id: "open_full_search", label: "打开完整检索", href: "/knowledge/search?q=weekly" }
    ]
  });
  const request = useEvidenceForTaskRequestSchema.parse({
    evidence_bubble_id: bubble.id,
    evidence_refs: bubble.evidence_refs,
    note: "Cuu 从证据气泡带回当前任务。"
  });

  assert.equal(bubble.actions[0]?.method, "POST");
  assert.equal(request.evidence_refs[0]?.title, "上次周会纪要");
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
