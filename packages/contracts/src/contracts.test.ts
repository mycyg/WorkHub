import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedWorkItemTransitions,
  sessionFinalizeFromStatuses,
  agentRunBudgetDecisionVmSchema,
  agentRunLiveBudgetSchema,
  agentRunLiveVmSchema,
  structuredFieldPatchSchema,
  agentRunTraceVmSchema,
  attentionItemSchema,
  authContextSchema,
  budgetDecisionSchema,
  budgetNoticeSchema,
  budgetPolicySchema,
  budgetPolicyUpdateSchema,
  budgetUsageSchema,
  meetingInsightVmSchema,
  applyMergeProposalCandidateRequestSchema,
  buildStructuredFieldPatchDryRun,
  chooseMergeProposalCandidateRequestSchema,
  createApprovalRequestSchema,
  createWorkItemRequestSchema,
  cuuLauncherSpecFromSelectedOptionIds,
  confidenceGrades,
  calendarPageVmSchema,
  drivePageVmSchema,
  identifyRequestSchema,
  inviteCreateRequestSchema,
  meetingPageVmSchema,
  notificationGroundingVmSchema,
  notificationItemVmSchema,
  notificationPageVmSchema,
  normalizeWorkHubLocale,
  pilotDay1MetricsSnapshotSchema,
  projectHealthPageVmSchema,
  projectHealthSignalBand,
  resolveProjectHealthBand,
  mergeProposalRequestSchema,
  mergeProposalCandidateChoiceResultSchema,
  nextQuestionRequestSchema,
  proposalConflictListResultSchema,
  replayTracePageVmSchema,
  respondApprovalRequestSchema,
  permissionPolicySchema,
  updateUserPreferencesRequestSchema,
  userPreferencesSchema,
  deliverableChangeManifestSchema,
  deliverableManifestFixtures,
  evidenceBubbleSchema,
  escalationTriggers,
  eventTypes,
  questionCardSchema,
  sessionVmSchema,
  structuredFieldPatchDryRunSchema,
  useEvidenceForTaskRequestSchema,
  workItemDetailVmSchema,
  workItemStatuses,
  approvalCenterVmSchema,
  approvalDetailVmSchema
} from "./index.js";

test("work item statuses expose the data-model transition truth", () => {
  assert.deepEqual(confidenceGrades, ["low", "medium", "high"]);
  assert.equal(Object.keys(allowedWorkItemTransitions).length, workItemStatuses.length);
  assert.deepEqual(allowedWorkItemTransitions.intake, ["ai_clarifying", "cancelled"]);
  assert.deepEqual(allowedWorkItemTransitions.done, []);
  assert.equal(escalationTriggers.includes("user_unsatisfied"), true);
  assert.equal(escalationTriggers.includes("user_rejected" as never), false);
});

test("findings[#19/H4] sessionFinalizeFromStatuses blocks resurrecting finalized items, allows clarify-phase + same-status", () => {
  // 公开 API 只会传 spec_ready / ai_working 作为 finalize 目标。
  const toSpecReady = sessionFinalizeFromStatuses("spec_ready");
  const toAiWorking = sessionFinalizeFromStatuses("ai_working");
  // 已交付/终态绝不能作为 finalize 的源（杜绝复活成品、覆盖内容、清空验收态）。
  for (const blocked of ["merged", "done", "cancelled", "in_review", "escalated", "pm_mode"] as const) {
    assert.equal(toSpecReady.includes(blocked), false, `spec_ready finalize must not allow source ${blocked}`);
    assert.equal(toAiWorking.includes(blocked), false, `ai_working finalize must not allow source ${blocked}`);
  }
  // 澄清阶段是合法的源；kickoff 是 ai_clarifying→ai_working。
  assert.equal(toSpecReady.includes("ai_clarifying"), true);
  assert.equal(toSpecReady.includes("spec_ready"), true); // 幂等再定稿
  assert.equal(toAiWorking.includes("ai_clarifying"), true); // kickoff
  assert.equal(toAiWorking.includes("spec_ready"), true);
  // `to` 自纳：任意同状态改写(含 r1-pg smoke 对 merged 自身重写)都放行，与当前状态无关。
  assert.equal(sessionFinalizeFromStatuses("merged").includes("merged"), true);
  // 无重复元素。
  const set = sessionFinalizeFromStatuses("spec_ready");
  assert.equal(set.length, new Set(set).size);
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
        text_hunk_decisions: [
          {
            hunk_index: 0,
            start_line: 8,
            end_line: 12,
            decision: "accept_incoming"
          }
        ],
        text_hunk_count: 1,
        text_hunk_output_sha256: "b".repeat(64),
        bulk_action: {
          action: "accept_incoming",
          target_keys: ["delivery:/outputs/result.md"],
          conflict_count: 1,
          result: "merged",
          accepted_incoming_target_keys: ["delivery:/outputs/result.md"],
          resolved_conflict_target_keys: ["delivery:/outputs/result.md"],
          blocked_target_keys: []
        },
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
  assert.equal(parsed.merge_timeline[0]?.text_hunk_decisions[0]?.decision, "accept_incoming");
  assert.equal(parsed.merge_timeline[0]?.bulk_action?.action, "accept_incoming");
  assert.deepEqual(parsed.merge_timeline[0]?.bulk_action?.accepted_incoming_target_keys, ["delivery:/outputs/result.md"]);
});

test("drive page VM carries project files, versions, accepted deliverables, and comment draft links", () => {
  const parsed = drivePageVmSchema.parse({
    generated_at: "2026-06-11T01:00:00.000Z",
    project: {
      id: "92000000-0000-4000-8000-000000000001",
      name: "R5 Workspace",
      slug: "r5-workspace",
      owner_label: "owner",
      status: "active"
    },
    summary: {
      item_count: 1,
      file_count: 1,
      folder_count: 0,
      deleted_item_count: 1,
      version_count: 1,
      accepted_deliverable_count: 1,
      pending_comment_count: 0,
      operation_count: 1
    },
    can_manage: true,
    selected_item_id: "92000000-0000-4000-8000-000000000002",
    items: [
      {
        id: "92000000-0000-4000-8000-000000000002",
        project_id: "92000000-0000-4000-8000-000000000001",
        name: "客户复盘.md",
        kind: "file",
        path: "/客户复盘.md",
        depth: 0,
        current_version_id: "92000000-0000-4000-8000-000000000003",
        preview_href: "/api/drive/projects/92000000-0000-4000-8000-000000000001/items/92000000-0000-4000-8000-000000000002/preview",
        download_href: "/api/drive/projects/92000000-0000-4000-8000-000000000001/items/92000000-0000-4000-8000-000000000002/download",
        children_count: 0,
        updated_at: "2026-06-11T01:00:00.000Z"
      }
    ],
    deleted_items: [
      {
        id: "92000000-0000-4000-8000-000000000009",
        project_id: "92000000-0000-4000-8000-000000000001",
        name: "旧草稿.md",
        kind: "file",
        path: "/旧草稿.md",
        depth: 0,
        children_count: 0,
        deleted_at: "2026-06-11T01:00:00.000Z",
        updated_at: "2026-06-11T01:00:00.000Z"
      }
    ],
    versions: [
      {
        id: "92000000-0000-4000-8000-000000000003",
        item_id: "92000000-0000-4000-8000-000000000002",
        version_no: 2,
        filename: "客户复盘.md",
        mime: "text/markdown",
        size_bytes: 2048,
        sha256: "a".repeat(64),
        created_at: "2026-06-11T01:00:00.000Z",
        current: true,
        source: "accepted_deliverable",
        accepted_deliverable_id: "92000000-0000-4000-8000-000000000004",
        work_item_id: "92000000-0000-4000-8000-000000000005",
        proposal_id: "92000000-0000-4000-8000-000000000006",
        download_href: "/api/workitems/92000000-0000-4000-8000-000000000005/deliverables/92000000-0000-4000-8000-000000000004/download",
        preview_href: "/api/workitems/92000000-0000-4000-8000-000000000005/deliverables/92000000-0000-4000-8000-000000000004/preview",
        restore_href: "/api/workitems/92000000-0000-4000-8000-000000000005/deliverables/92000000-0000-4000-8000-000000000004/restore"
      }
    ],
    accepted_deliverables: [
      {
        id: "92000000-0000-4000-8000-000000000004",
        work_item_id: "92000000-0000-4000-8000-000000000005",
        proposal_id: "92000000-0000-4000-8000-000000000006",
        change_id: "92000000-0000-4000-8000-000000000007",
        target_kind: "text_doc",
        target_key: "drive:/客户复盘.md",
        change_type: "updated",
        accepted_version: 2,
        drive_item_id: "92000000-0000-4000-8000-000000000002",
        drive_version_id: "92000000-0000-4000-8000-000000000003",
        filename: "客户复盘.md",
        mime: "text/markdown",
        size_bytes: 2048,
        accepted_at: "2026-06-11T01:00:00.000Z"
      }
    ],
    comments: [
      {
        id: "92000000-0000-4000-8000-000000000008",
        project_id: "92000000-0000-4000-8000-000000000001",
        author_label: "PM",
        body: "转成下一步任务",
        status: "proposal_created",
        created_at: "2026-06-11T01:00:00.000Z",
        draft_work_item_id: "92000000-0000-4000-8000-000000000005",
        draft_href: "/workitems/92000000-0000-4000-8000-000000000005",
        proposal_id: "92000000-0000-4000-8000-000000000006",
        proposal_href: "/proposals/92000000-0000-4000-8000-000000000006",
        proposal_status: "opened"
      },
      {
        id: "92000000-0000-4000-8000-000000000012",
        project_id: "92000000-0000-4000-8000-000000000001",
        author_label: "PM",
        body: "请生成下一步草稿",
        status: "pending_llm",
        created_at: "2026-06-11T01:01:00.000Z",
        draft_action: {
          id: "drive_comment_to_draft",
          label: "生成草稿",
          method: "POST",
          href: "/api/drive/projects/92000000-0000-4000-8000-000000000001/comments/92000000-0000-4000-8000-000000000012/draft"
        }
      }
    ],
    operations: [
      {
        id: "92000000-0000-4000-8000-000000000010",
        project_id: "92000000-0000-4000-8000-000000000001",
        actor_user_id: "92000000-0000-4000-8000-000000000011",
        op_type: "draft_to_proposal",
        target_item_id: "92000000-0000-4000-8000-000000000002",
        target_path: "/客户复盘.md",
        summary_text: "Created proposal from Drive draft",
        created_at: "2026-06-11T01:00:00.000Z"
      }
    ],
    actions: {
      upload_file: {
        id: "drive_upload_file",
        label: "Upload sample",
        method: "POST",
        href: "/api/drive/projects/92000000-0000-4000-8000-000000000001/files"
      }
    }
  });

  assert.equal(parsed.versions[0]?.source, "accepted_deliverable");
  assert.equal(parsed.items[0]?.preview_href?.endsWith("/preview"), true);
  assert.equal(parsed.items[0]?.download_href?.endsWith("/download"), true);
  assert.equal(parsed.comments[0]?.status, "proposal_created");
  assert.equal(parsed.comments[0]?.proposal_href, "/proposals/92000000-0000-4000-8000-000000000006");
  assert.equal(parsed.comments[1]?.draft_action?.method, "POST");
  assert.equal(parsed.deleted_items[0]?.deleted_at, "2026-06-11T01:00:00.000Z");
  assert.equal(parsed.operations[0]?.op_type, "draft_to_proposal");
  assert.equal(parsed.actions.upload_file?.method, "POST");
});

test("work item detail VM carries Drive source context and proposal draft action", () => {
  const parsed = workItemDetailVmSchema.parse({
    workitem: {
      id: "92000000-0000-4000-8000-000000000005",
      code: "R5-7",
      project_id: "92000000-0000-4000-8000-000000000001",
      submitter_user_id: "92000000-0000-4000-8000-000000000011",
      status: "ai_clarifying",
      priority: "normal",
      sync_state: "synced",
      version: 1,
      mode: "worker",
      human_reserved: false,
      created_at: "2026-06-11T01:00:00.000Z",
      updated_at: "2026-06-11T01:00:00.000Z"
    },
    acceptance: [],
    agent_trace_preview: [],
    evidence_refs: [],
    source_context: {
      source_type: "drive_comment",
      project_id: "92000000-0000-4000-8000-000000000001",
      comment_id: "92000000-0000-4000-8000-000000000008",
      folder_path: "/客户复盘",
      author_label: "PM",
      body: "转成下一步任务",
      status: "draft_created",
      created_at: "2026-06-11T01:00:00.000Z"
    },
    actions: {
      create_proposal_draft: {
        id: "drive_draft_to_proposal",
        label: "生成变更提议",
        method: "POST",
        href: "/api/drive/workitems/92000000-0000-4000-8000-000000000005/proposal-draft"
      }
    }
  });

  assert.equal(parsed.source_context?.source_type, "drive_comment");
  assert.equal(parsed.actions.create_proposal_draft?.method, "POST");
});

test("meeting page VM carries insight actions, evidence, and proposal links", () => {
  const parsed = meetingPageVmSchema.parse({
    generated_at: "2026-06-11T01:10:00.000Z",
    project: {
      id: "93000000-0000-4000-8000-000000000001",
      name: "R5 Workspace",
      slug: "r5-workspace",
      owner_label: "owner",
      status: "active"
    },
    summary: {
      meeting_count: 1,
      ready_count: 1,
      pending_insight_count: 1,
      confirmed_insight_count: 0,
      dismissed_insight_count: 0
    },
    can_manage: true,
    selected_meeting_id: "93000000-0000-4000-8000-000000000002",
    meetings: [
      {
        id: "93000000-0000-4000-8000-000000000002",
        project_id: "93000000-0000-4000-8000-000000000001",
        uploaded_by_user_id: "93000000-0000-4000-8000-000000000003",
        uploaded_by_label: "PM",
        title: "客户方案评审",
        audio_filename: "review.txt",
        audio_size_bytes: 512,
        transcript_text: "需要更新报价模型。",
        minutes_md: "## 纪要\n\n报价模型需要更新。",
        status: "ready",
        created_at: "2026-06-11T01:00:00.000Z",
        updated_at: "2026-06-11T01:05:00.000Z",
        insights: [
          {
            id: "93000000-0000-4000-8000-000000000004",
            meeting_id: "93000000-0000-4000-8000-000000000002",
            kind: "requirement_change",
            title: "更新报价模型",
            description: "把阶梯报价模型写入方案草稿。",
            confidence_reason: "会上明确要求财务更新模型。",
            status: "pending",
            created_at: "2026-06-11T01:05:00.000Z",
            evidence_refs: [
              {
                id: "93000000-0000-4000-8000-000000000005",
                source_type: "meeting",
                source_id: "93000000-0000-4000-8000-000000000002",
                title: "客户方案评审"
              }
            ],
            actions: {
              create_draft: {
                id: "meeting_insight_to_draft",
                label: "生成草稿",
                method: "POST",
                href: "/api/meetings/projects/93000000-0000-4000-8000-000000000001/insights/93000000-0000-4000-8000-000000000004/draft"
              },
              dismiss: {
                id: "meeting_insight_dismiss",
                label: "忽略",
                method: "POST",
                href: "/api/meetings/projects/93000000-0000-4000-8000-000000000001/insights/93000000-0000-4000-8000-000000000004/dismiss"
              }
            }
          }
        ]
      }
    ]
  });

  assert.equal(parsed.meetings[0]?.insights[0]?.actions.create_draft?.method, "POST");
  assert.equal(parsed.meetings[0]?.insights[0]?.evidence_refs[0]?.source_type, "meeting");
});

test("work item detail VM carries Meeting source context and proposal draft action", () => {
  const parsed = workItemDetailVmSchema.parse({
    workitem: {
      id: "93000000-0000-4000-8000-000000000006",
      code: "R5-8",
      project_id: "93000000-0000-4000-8000-000000000001",
      submitter_user_id: "93000000-0000-4000-8000-000000000003",
      status: "ai_clarifying",
      priority: "normal",
      sync_state: "synced",
      version: 1,
      mode: "worker",
      human_reserved: false,
      created_at: "2026-06-11T01:10:00.000Z",
      updated_at: "2026-06-11T01:10:00.000Z"
    },
    acceptance: [],
    agent_trace_preview: [],
    evidence_refs: [],
    source_context: {
      source_type: "meeting_insight",
      project_id: "93000000-0000-4000-8000-000000000001",
      meeting_id: "93000000-0000-4000-8000-000000000002",
      insight_id: "93000000-0000-4000-8000-000000000004",
      meeting_title: "客户方案评审",
      insight_kind: "requirement_change",
      title: "更新报价模型",
      description: "把阶梯报价模型写入方案草稿。",
      confidence_reason: "会上明确要求财务更新模型。",
      status: "confirmed",
      transcript_excerpt: "需要更新报价模型。",
      evidence_refs: [
        {
          id: "93000000-0000-4000-8000-000000000005",
          source_type: "meeting",
          source_id: "93000000-0000-4000-8000-000000000002",
          title: "客户方案评审"
        }
      ],
      created_at: "2026-06-11T01:05:00.000Z"
    },
    actions: {
      create_proposal_draft: {
        id: "meeting_draft_to_proposal",
        label: "生成变更提议",
        method: "POST",
        href: "/api/meetings/workitems/93000000-0000-4000-8000-000000000006/proposal-draft"
      }
    }
  });

  assert.equal(parsed.source_context?.source_type, "meeting_insight");
  assert.equal(parsed.actions.create_proposal_draft?.href.includes("/api/meetings/"), true);
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

test("invite create contract only exposes fields that the server honors", () => {
  const parsed = inviteCreateRequestSchema.parse({
    email: "new-user@example.com",
    role: "owner",
    workspace_id: "00000000-0000-4000-8000-000000000002"
  });

  assert.deepEqual(Object.keys(parsed).sort(), ["email"]);
});

test("formal event names are the only exported implementation names", () => {
  const exportedEventTypes = Object.values(eventTypes) as string[];

  assert.equal(eventTypes.agentRunStarted, "agent_run.started");
  assert.equal(eventTypes.sessionQuestion, "session.question");
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

test("findings[#7] deliverable manifest rejects over-length target_ref strings (clean 400, not a PG 22001 500 at INSERT)", () => {
  const base = deliverableManifestFixtures[0]!;
  const change = base.changes[0]!;
  const withRef = (ref: Record<string, unknown>) => ({
    ...base,
    changes: [{ ...change, target_ref: { ...change.target_ref, ...ref } }]
  });
  // path > target_path(512) 列宽。
  assert.throws(() => deliverableChangeManifestSchema.parse(withRef({ path: "a".repeat(600) })));
  // version_before > base_version_ref(128) 列宽。
  assert.throws(() => deliverableChangeManifestSchema.parse(withRef({ version_before: "v".repeat(200) })));
  // version_after > accepted_ref(512) 列宽。
  assert.throws(() => deliverableChangeManifestSchema.parse(withRef({ version_after: "x".repeat(600) })));
  // 合法长度照常通过。
  assert.doesNotThrow(() => deliverableChangeManifestSchema.parse(withRef({ path: `/a/${"b".repeat(100)}` })));
});

test("deliverable manifest preserves explicit generated markdown content for text materialization", () => {
  const base = deliverableManifestFixtures[0]!;
  const change = base.changes[0]!;
  const generatedContent = "# Drive comment\n\n请生成三条验收要点。";
  const parsed = deliverableChangeManifestSchema.parse({
    ...base,
    changes: [{
      ...change,
      target_kind: "text_doc",
      target_ref: {
        entity_type: "delivery",
        path: "/outputs/drive-comment.md"
      },
      change_type: "generated",
      machine_summary: {
        ...(change.machine_summary ?? {}),
        generated_content_md: generatedContent
      }
    }]
  });

  assert.equal(parsed.changes[0]?.machine_summary?.generated_content_md, generatedContent);
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
              id: "keep_current",
              label: "保留正式版",
              method: "POST",
              href: "/api/proposals/72000000-0000-4000-8000-000000000002/merge",
              request_json: {
                conflict_resolution: {
                  accept_incoming_target_keys: [],
                  bulk_action: {
                    action: "keep_current",
                    target_keys: ["delivery:/outputs/result.md"],
                    conflict_count: 1
                  }
                }
              }
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

  const bulkRequest = mergeProposalRequestSchema.parse({
    confirm: true,
    conflict_resolution: {
      accept_incoming_target_keys: ["delivery:/outputs/result.md", "drive_item:docs/brief.md"],
      bulk_action: {
        action: "accept_incoming",
        target_keys: ["delivery:/outputs/result.md", "drive_item:docs/brief.md"],
        conflict_count: 2
      }
    }
  });
  assert.equal(bulkRequest.conflict_resolution?.bulk_action?.action, "accept_incoming");
  assert.deepEqual(bulkRequest.conflict_resolution?.bulk_action?.target_keys, [
    "delivery:/outputs/result.md",
    "drive_item:docs/brief.md"
  ]);
});

test("merge proposal candidate choices are explicit and replayable", () => {
  const request = chooseMergeProposalCandidateRequestSchema.parse({
    option_key: "ai_fusion"
  });
  const applyRequest = applyMergeProposalCandidateRequestSchema.parse({});
  const fieldOverrideRequest = applyMergeProposalCandidateRequestSchema.parse({
    confirm: true,
    structured_field_overrides: {
      operations: [
        { field: "title", decision: "custom", value: "更稳妥的标题" },
        { field: "priority", decision: "keep_current" },
        { field: "due_at", decision: "accept_incoming" }
      ]
    }
  });
  const invalidFieldOverrideRequest = applyMergeProposalCandidateRequestSchema.safeParse({
    structured_field_overrides: {
      operations: [{ field: "title", decision: "custom" }]
    }
  });
  const itemOverrideRequest = applyMergeProposalCandidateRequestSchema.parse({
    confirm: true,
    structured_item_overrides: {
      items: [
        {
          field: "acceptance_items",
          item_id: "72000000-0000-4000-8000-000000000901",
          decision: "keep_current"
        },
        {
          field: "task_items",
          item_id: "72000000-0000-4000-8000-000000000902",
          decision: "accept_incoming"
        }
      ]
    }
  });
  const taskPlanScopedRequest = applyMergeProposalCandidateRequestSchema.parse({
    confirm: true,
    task_plan_scope: {
      target_plan_id: "72000000-0000-4000-8000-000000000904"
    }
  });
  const textHunkOverrideRequest = applyMergeProposalCandidateRequestSchema.parse({
    confirm: true,
    text_hunk_overrides: {
      hunks: [
        {
          hunk_index: 0,
          start_line: 8,
          end_line: 11,
          decision: "accept_incoming"
        },
        {
          hunk_index: 1,
          start_line: 20,
          end_line: 20,
          decision: "ai_fusion"
        }
      ]
    }
  });
  const invalidTextHunkOverrideRequest = applyMergeProposalCandidateRequestSchema.safeParse({
    text_hunk_overrides: {
      hunks: [
        {
          hunk_index: 0,
          start_line: 8,
          end_line: 7,
          decision: "keep_current"
        }
      ]
    }
  });
  const invalidItemOverrideRequest = applyMergeProposalCandidateRequestSchema.safeParse({
    structured_item_overrides: {
      items: [
        {
          field: "title",
          item_id: "72000000-0000-4000-8000-000000000903",
          decision: "keep_current"
        }
      ]
    }
  });
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
  assert.equal(fieldOverrideRequest.structured_field_overrides?.operations[0]?.decision, "custom");
  assert.equal(fieldOverrideRequest.structured_field_overrides?.operations[1]?.decision, "keep_current");
  assert.equal(itemOverrideRequest.structured_item_overrides?.items[0]?.decision, "keep_current");
  assert.equal(itemOverrideRequest.structured_item_overrides?.items[1]?.field, "task_items");
  assert.equal(taskPlanScopedRequest.task_plan_scope?.target_plan_id, "72000000-0000-4000-8000-000000000904");
  assert.equal(textHunkOverrideRequest.text_hunk_overrides?.hunks[0]?.decision, "accept_incoming");
  assert.equal(textHunkOverrideRequest.text_hunk_overrides?.hunks[1]?.start_line, 20);
  assert.equal(invalidFieldOverrideRequest.success, false);
  assert.equal(invalidItemOverrideRequest.success, false);
  assert.equal(invalidTextHunkOverrideRequest.success, false);
});

test("structured field patch dry-run validates executable work item fields", () => {
  const dryRun = buildStructuredFieldPatchDryRun({
    target_entity_type: "work_item",
    target_entity_id: "72000000-0000-4000-8000-000000000101",
    changed_fields: ["title", "priority", "due_at", "acceptance_items", "task_items"],
    merged_fields: {
      title: "客户周报草稿",
      priority: "high",
      due_at: "2026-06-30T00:00:00.000Z",
      acceptance_items: [
        {
          id: "72000000-0000-4000-8000-000000000301",
          title: "输出可追溯证据清单",
          description: "每条结论都有来源。",
          status: "open",
          sort_order: 0
        }
      ],
      task_items: [
        {
          id: "72000000-0000-4000-8000-000000000302",
          title: "整理证据表",
          description: "生成可复核的证据表格。",
          item_type: "task",
          estimate_hours: 2,
          sort_order: 0
        }
      ]
    },
    base_fields: {
      title: "旧标题",
      priority: "normal",
      due_at: null,
      acceptance_items: [],
      task_items: []
    },
    source: "ai_fusion"
  });
  const parsed = structuredFieldPatchDryRunSchema.parse(dryRun);

  assert.equal(parsed.status, "ready");
  assert.equal(parsed.executable, true);
  assert.deepEqual(parsed.audit_payload.operation_fields, ["title", "priority", "due_at", "acceptance_items", "task_items"]);
  assert.equal(parsed.patch.operations[0]?.value_type, "string");
  assert.equal(parsed.patch.operations[1]?.value_type, "enum");
  assert.equal(parsed.patch.operations[2]?.value_type, "datetime");
  assert.equal(parsed.patch.operations[3]?.value_type, "json_array");
  assert.equal(parsed.patch.operations[4]?.value_type, "json_array");
  assert.equal(parsed.patch.operations[0]?.before_value, "旧标题");
  assert.equal(parsed.patch.operations[1]?.before_value, "normal");
  assert.equal(parsed.patch.operations[2]?.before_value, null);
  assert.deepEqual(parsed.patch.operations[3]?.before_value, []);
  assert.deepEqual(parsed.patch.operations[4]?.before_value, []);
});

test("structured field patch dry-run with no resolvable fields is blocked, not thrown (empty-patch carrier)", () => {
  // 回归守卫：AI 给出「仅说明、无字段」结构化解析时 merged_fields 无有效字段 → operations 为空。
  // buildStructuredFieldPatchDryRun 内部会构造空补丁承载 blocked + empty_patch 并 re-parse；若 dry-run 载体
  // 的 operations 被 .min(1) 卡住就会 throw，进而被 safelyGenerateMergeFusionCandidates 吞掉、静默清零整批融合候选。
  const dryRun = buildStructuredFieldPatchDryRun({
    target_entity_type: "work_item",
    target_entity_id: "72000000-0000-4000-8000-000000000101",
    changed_fields: [],
    merged_fields: {},
    source: "ai_fusion"
  });

  assert.equal(dryRun.status, "blocked");
  assert.equal(dryRun.executable, false);
  assert.equal(dryRun.issues.some((issue) => issue.code === "empty_patch"), true);
  assert.deepEqual(dryRun.patch.operations, []);
  // 载体 schema 必须接受空 operations（不 throw）；入站 structuredFieldPatchSchema 仍 .min(1) 拒空（见上一个测试）。
  const parsed = structuredFieldPatchDryRunSchema.parse(dryRun);
  assert.deepEqual(parsed.patch.operations, []);
});

test("structured field patch dry-run blocks unknown, missing, and mistyped fields", () => {
  const dryRun = buildStructuredFieldPatchDryRun({
    target_entity_type: "work_item",
    target_entity_id: "72000000-0000-4000-8000-000000000101",
    changed_fields: ["title", "due_at", "acceptance_items"],
    merged_fields: {
      title: "客户周报草稿",
      due_at: "2026-06-30",
      extra_field: "should be rejected"
    }
  });

  assert.equal(dryRun.status, "blocked");
  assert.equal(dryRun.executable, false);
  assert.deepEqual(
    dryRun.issues.map((issue) => issue.code).sort(),
    ["invalid_value_type", "missing_declared_field", "unknown_field"].sort()
  );
  assert.deepEqual(dryRun.audit_payload.operation_fields, ["title"]);
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

test("create work item requests preserve Cuu launcher spec metadata", () => {
  const spec = cuuLauncherSpecFromSelectedOptionIds(["document-draft", "create-workitem"]);
  const parsed = createWorkItemRequestSchema.parse({
    session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    selected_option_ids: ["document-draft", "create-workitem"],
    free_text: "  最终补充一句  ",
    cuu_launcher_spec: spec,
    kickoff_agent: true
  });

  assert.equal(parsed.free_text, "最终补充一句");
  assert.equal(parsed.cuu_launcher_spec?.source, "cuu_desktop_launcher");
  assert.deepEqual(parsed.cuu_launcher_spec?.selected_options.map((option) => option.id), ["document-draft"]);
  assert.equal(parsed.cuu_launcher_spec?.selected_options[0]?.delivery_kind, "document_draft");
  assert.equal(parsed.cuu_launcher_spec?.selected_options[0]?.risk_hint, "low");
  assert.match(parsed.cuu_launcher_spec?.selected_options[0]?.default_acceptance[0] ?? "", /文档或方案草稿/u);
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
  const runDecision = agentRunBudgetDecisionVmSchema.parse({
    decision_id: decision.decision_id,
    allowed: decision.allowed,
    reason: decision.reason,
    model_route: decision.model_route,
    notice
  });
  assert.equal(runDecision.notice?.recommended_action, "downgrade_model");
  assert.throws(() =>
    agentRunBudgetDecisionVmSchema.parse({
      decision_id: "decision-bad-notice",
      allowed: false,
      model_route: decision.model_route,
      notice: { code: "budget_warning", recommended_action: "teleport" }
    })
  );
  assert.throws(() => budgetPolicySchema.parse({ ...policy, warning_ratio: 0.96 }));
  assert.throws(() => budgetPolicyUpdateSchema.parse({}));
  // findings[#low]：update schema 也带 warning_ratio < critical_ratio 跨字段不变量（二者同时出现时）。
  assert.throws(() => budgetPolicyUpdateSchema.parse({ warning_ratio: 0.96, critical_ratio: 0.9 }));
  assert.doesNotThrow(() => budgetPolicyUpdateSchema.parse({ warning_ratio: 0.8, critical_ratio: 0.95 }));
  // 单字段更新仍放行（合并不变量由服务端守卫兜底）。
  assert.doesNotThrow(() => budgetPolicyUpdateSchema.parse({ warning_ratio: 0.99 }));
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
  // L16：deny 省略 reason_md 也必须被拒（superRefine），而 allow 无需理由仍通过。
  assert.throws(() => respondApprovalRequestSchema.parse({ decision: "deny" }));
  assert.equal(respondApprovalRequestSchema.parse({ decision: "deny", reason_md: "理由" }).decision, "deny");
  assert.equal(respondApprovalRequestSchema.parse({ decision: "allow" }).decision, "allow");
});

test("permission policy contract accepts nullable API response metadata", () => {
  const policy = permissionPolicySchema.parse({
    id: "70000000-0000-4000-8000-000000000001",
    scope_kind: "workspace",
    scope_id: "00000000-0000-4000-8000-000000000002",
    action_pattern: "tool.write_file",
    effect: "allow",
    priority: 0,
    learned_from_session: false,
    created_by_user_id: null,
    org_id: null,
    workspace_id: null,
    deleted_at: null,
    created_at: "2026-06-05T00:00:00.000Z",
    updated_at: "2026-06-05T00:00:00.000Z"
  });

  assert.equal(policy.created_by_user_id, null);
  assert.equal(policy.org_id, null);
  assert.equal(policy.workspace_id, null);
  assert.equal(policy.deleted_at, null);
});

test("B6a contract tightening: live budget max_tokens positive + structured-field patch non-empty", () => {
  // L18：max_tokens 必须 >0（0 上限的预算花不出去）。
  assert.throws(() => agentRunLiveBudgetSchema.parse({ max_steps: 5, total_timeout_s: 60, max_tokens: 0, max_cost_cny: "1" }));
  assert.equal(
    agentRunLiveBudgetSchema.parse({ max_steps: 5, total_timeout_s: 60, max_tokens: 1000, max_cost_cny: "1" }).max_tokens,
    1000
  );
  // L17：空 operations 的 structured-field patch 被拒。
  assert.throws(() => structuredFieldPatchSchema.parse({
    type: "structured_field_patch",
    target_entity_type: "work_item",
    target_entity_id: "70000000-0000-4000-8000-000000000001",
    operations: []
  }));
});

test("R5.6 notification and calendar page VMs keep source context typed", () => {
  const notification = notificationPageVmSchema.parse({
    generated_at: "2026-06-11T00:00:00.000Z",
    actor_user_id: "81000000-0000-4000-8000-000000000001",
    summary: {
      total_count: 1,
      unread_count: 1,
      needs_decision_count: 1,
      fyi_count: 0,
      done_count: 0,
      urgent_count: 1
    },
    buckets: {
      needs_decision: [
        {
          id: "81000000-0000-4000-8000-000000000002",
          type: "meeting.insight.pending",
          severity: "high",
          status: "unread",
          inbox_bucket: "needs_decision",
          title: "会议建议等待确认",
          target_href: "/meetings?project_id=81000000-0000-4000-8000-000000000003",
          created_at: "2026-06-11T00:00:00.000Z",
          updated_at: "2026-06-11T00:00:00.000Z",
          source_context: {
            source_type: "meeting_insight",
            meeting_id: "81000000-0000-4000-8000-000000000004",
            insight_id: "81000000-0000-4000-8000-000000000005",
            title: "Update pricing",
            meeting_title: "Q2 review",
            insight_status: "pending"
          },
          actions: {
            mark_read: {
              id: "notification_mark_read",
              label: "标为已读",
              method: "POST",
              href: "/api/notifications/81000000-0000-4000-8000-000000000002/read"
            }
          }
        }
      ],
      fyi: [],
      done: []
    },
    items: [],
    actions: {
      mark_all_read: {
        id: "notification_mark_all_read",
        label: "全部已读",
        method: "POST",
        href: "/api/notifications/read-all"
      }
    }
  });
  const calendar = calendarPageVmSchema.parse({
    generated_at: "2026-06-11T00:00:00.000Z",
    actor_user_id: "81000000-0000-4000-8000-000000000001",
    scope: {
      date: "2026-06-11",
      view: "week",
      range_start: "2026-06-08T00:00:00.000Z",
      range_end: "2026-06-15T00:00:00.000Z"
    },
    summary: {
      block_count: 1,
      overdue_count: 0,
      today_count: 1,
      week_count: 1
    },
    days: [
      {
        date: "2026-06-11",
        blocks: [
          {
            id: "81000000-0000-4000-8000-000000000006",
            kind: "work_item_due",
            title: "Review pricing",
            ends_at: "2026-06-11T10:00:00.000Z",
            all_day: true,
            status: "today",
            severity: "urgent",
            target_href: "/workitems/81000000-0000-4000-8000-000000000007",
            source_context: {
              source_type: "work_item",
              work_item_id: "81000000-0000-4000-8000-000000000007",
              title: "Review pricing",
              status: "in_review"
            }
          }
        ]
      }
    ],
    blocks: []
  });

  assert.equal(notification.buckets.needs_decision[0]?.source_context?.source_type, "meeting_insight");
  assert.equal(calendar.days[0]?.blocks[0]?.kind, "work_item_due");
  assert.throws(() => notificationPageVmSchema.parse({
    ...notification,
    buckets: { needs_decision: [{ ...notification.buckets.needs_decision[0], inbox_bucket: "later" }], fyi: [], done: [] }
  }));
});

test("R5.7 project health page VM bands are deterministic and shared", () => {
  assert.equal(projectHealthSignalBand("overdue_work_items", 0), "healthy");
  assert.equal(projectHealthSignalBand("overdue_work_items", 1), "attention");
  assert.equal(projectHealthSignalBand("overdue_work_items", 3), "critical");
  assert.equal(projectHealthSignalBand("failed_runs", 2), "critical");
  assert.equal(projectHealthSignalBand("pending_approvals", 4), "attention");
  assert.equal(resolveProjectHealthBand([{ band: "healthy" }, { band: "attention" }]), "attention");
  assert.equal(resolveProjectHealthBand([{ band: "critical" }, { band: "healthy" }]), "critical");
  assert.equal(resolveProjectHealthBand([]), "healthy");

  const page = projectHealthPageVmSchema.parse({
    generated_at: "2026-06-11T00:00:00.000Z",
    actor_user_id: "81000000-0000-4000-8000-000000000001",
    viewer_scope: "member",
    summary: { project_count: 1, healthy_count: 0, attention_count: 1, critical_count: 0 },
    cards: [{
      project_id: "82000000-0000-4000-8000-000000000001",
      project_name: "西南区发布",
      band: "attention",
      numbers_visible: false,
      target_href: "/drive?project_id=82000000-0000-4000-8000-000000000001",
      signals: [{
        key: "overdue_work_items",
        count: 1,
        band: projectHealthSignalBand("overdue_work_items", 1),
        target_href: "/calendar"
      }]
    }]
  });
  assert.equal(page.cards[0]?.band, "attention");
  assert.throws(() => projectHealthPageVmSchema.parse({
    ...page,
    cards: [{ ...page.cards[0], band: "broken" }]
  }));
});

test("R5.7 notification grounding carries reason and product-route evidence refs", () => {
  const grounded = notificationItemVmSchema.parse({
    id: "83000000-0000-4000-8000-000000000001",
    type: "meeting.insight.pending",
    severity: "high",
    status: "unread",
    inbox_bucket: "needs_decision",
    title: "会议建议等待确认",
    created_at: "2026-06-11T00:00:00.000Z",
    updated_at: "2026-06-11T00:00:00.000Z",
    actions: {},
    grounding: {
      reason_text: "会议里出现了一个还没人确认的建议。",
      evidence_refs: [
        { kind: "knowledge_search", label: "查相关证据", href: "/knowledge/search?q=发布&source_ref=notification:83000000-0000-4000-8000-000000000001" },
        { kind: "agent_run_replay", label: "看执行回放", href: "/agent-runs/84000000-0000-4000-8000-000000000001/replay" }
      ]
    }
  });
  assert.equal(grounded.grounding?.evidence_refs.length, 2);
  assert.throws(() => notificationGroundingVmSchema.parse({ reason_text: "", evidence_refs: [] }));
});

test("S1 Day1 pilot metrics snapshot carries six ops metrics and gates", () => {
  const snapshot = pilotDay1MetricsSnapshotSchema.parse({
    generated_at: "2026-06-13T12:00:00.000Z",
    range: {
      from: "2026-06-13T00:00:00.000Z",
      to: "2026-06-14T00:00:00.000Z"
    },
    metrics: [
      {
        id: "closed_loop_count",
        label_zh: "闭环完成件数",
        label_en: "Closed loops",
        value: "1",
        unit: "work_items",
        numerator: 1,
        denominator: null,
        status: "pass",
        source_tables: ["proposals", "work_items"]
      },
      {
        id: "proposal_adoption_rate",
        label_zh: "AI 直出采纳率",
        label_en: "Proposal adoption",
        value: "100%",
        unit: "percent",
        numerator: 1,
        denominator: 1,
        status: "pass",
        source_tables: ["proposals", "reviews"]
      },
      {
        id: "escalation_count",
        label_zh: "升级次数",
        label_en: "Escalations",
        value: "0",
        unit: "events",
        numerator: 0,
        denominator: null,
        status: "pass",
        source_tables: ["escalation_events", "approval_requests"]
      },
      {
        id: "cost_per_merged_item_cny",
        label_zh: "每件成本",
        label_en: "Cost per merged item",
        value: "0.018",
        unit: "CNY",
        numerator: 0.018,
        denominator: 1,
        status: "pass",
        source_tables: ["cost_ledger_entries", "usage_records", "proposals"]
      },
      {
        id: "conflict_count",
        label_zh: "冲突数",
        label_en: "Conflicts",
        value: "0",
        unit: "conflicts",
        numerator: 0,
        denominator: null,
        status: "pass",
        source_tables: ["merge_attempts"]
      },
      {
        id: "notification_density",
        label_zh: "打扰密度",
        label_en: "Notification density",
        value: "1",
        unit: "notifications/user",
        numerator: 2,
        denominator: 2,
        status: "pass",
        source_tables: ["notifications", "users"]
      }
    ],
    raw_counts: {
      work_items_created: 1,
      closed_loop_work_items: 1,
      proposals_opened: 1,
      proposals_reviewed: 1,
      proposals_merged: 1,
      proposals_rejected: 0,
      escalation_events: 0,
      approval_requests: 0,
      merge_conflict_attempts: 0,
      merge_conflict_instances: 0,
      notifications_created: 2,
      active_user_count: 2,
      submitter_count: 1
    },
    cost: {
      total_cost_cny: "0.018",
      token_in: 1000,
      token_out: 2000,
      unique_usage_records: 1
    },
    gates: {
      feedback_log_ready: true,
      metrics_ready: true,
      second_user_path_observed: true,
      cost_nonzero: true,
      conflict_counter_ready: true,
      notification_density_ready: true
    },
    notes: ["Proposal direct review/merge is counted through proposals."]
  });
  assert.equal(snapshot.metrics.length, 6);
  assert.throws(() => pilotDay1MetricsSnapshotSchema.parse({
    ...snapshot,
    metrics: [{ ...snapshot.metrics[0], id: "unknown_metric" }]
  }));
});

test("W2 approvalCenterVm items_detail is additive: parses with and without it", () => {
  const base = {
    items: [],
    requests: [],
    filters: { pending: true },
    counts: { pending: 0 }
  };
  // 旧调用方（无 items_detail）仍解析通过，默认补空对象。
  const legacy = approvalCenterVmSchema.parse(base);
  assert.deepEqual(legacy.items_detail, {});

  // 新逐项详情：deliverable kind 携带 diff/checks/timeline/comments，缺省数组自动补全。
  const detail = approvalDetailVmSchema.parse({
    kind: "deliverable",
    proposal_id: "30000000-0000-4000-8000-0000000000d1",
    ai_reason: "预算从 ¥320k 提到 ¥460k 以追加投放",
    risk_label: "中等风险",
    timeline: [{ id: "t1", kind: "created", label: "发起申请", status: "done" }],
    comments: [{
      id: "30000000-0000-4000-8000-0000000000c1",
      author_label: "刘梅",
      body: "建议错峰执行",
      created_at: "2026-06-14T10:24:00.000Z"
    }],
    comments_page_info: { limit: 20, returned: 20, has_more: true }
  });
  assert.equal(detail.manifest_changes.length, 0);
  assert.equal(detail.checks.length, 0);
  assert.equal(detail.affected_targets.length, 0);
  assert.equal(detail.timeline[0]?.kind, "created");
  assert.equal(detail.comments_page_info?.has_more, true);

  const enriched = approvalCenterVmSchema.parse({
    ...base,
    page_info: { limit: 100, returned: 1, has_more: false },
    items_detail: { "20000000-0000-4000-8000-0000000000a1": detail }
  });
  assert.equal(enriched.page_info?.limit, 100);
  assert.equal(enriched.page_info?.has_more, false);
  assert.equal(enriched.items_detail["20000000-0000-4000-8000-0000000000a1"]?.kind, "deliverable");
});

test("findings: meeting insight status enum no longer accepts the dead 'creating_requirement' value", () => {
  const base = {
    id: "10000000-0000-4000-8000-000000000001",
    meeting_id: "10000000-0000-4000-8000-000000000002",
    kind: "new_requirement" as const,
    title: "更新报价",
    description: "把季度报价更新到最新口径。",
    confidence_reason: "会议里项目负责人确认。",
    created_at: "2026-06-05T00:00:00.000Z"
  };
  // 活枚举仍放行。
  for (const status of ["pending", "confirmed", "dismissed"] as const) {
    assert.equal(meetingInsightVmSchema.safeParse({ ...base, status }).success, true);
  }
  // 死值已移除。
  assert.equal(meetingInsightVmSchema.safeParse({ ...base, status: "creating_requirement" }).success, false);
});
