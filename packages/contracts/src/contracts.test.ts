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
  buildStructuredFieldPatchDryRun,
  chooseMergeProposalCandidateRequestSchema,
  createApprovalRequestSchema,
  createWorkItemRequestSchema,
  cuuLauncherSpecFromSelectedOptionIds,
  confidenceGrades,
  drivePageVmSchema,
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
  structuredFieldPatchDryRunSchema,
  useEvidenceForTaskRequestSchema,
  workItemDetailVmSchema,
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
    cuu_launcher_spec: spec,
    kickoff_agent: true
  });

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
