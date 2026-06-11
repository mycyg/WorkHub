import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture, validateP05GoldPathFixture } from "@workhub/agent/fixtures";
import type { DrivePageVM, EvidenceBubble, GoldPathSurfaceVM, ProposalConflict, SessionVM, SettingsPageVM } from "@workhub/contracts";

import { renderAgentRunReplay } from "../replay/index.js";
import { renderWebRouteComponent, renderWebRouteComponents } from "./route-components.js";
import {
  createCostReactRouteComponent,
  createHomeReactRouteComponent,
  createProposalReactRouteComponent,
  createReplayReactRouteComponent,
  createSettingsReactRouteComponent
} from "./route-react-components.js";

function drivePageVm(): DrivePageVM {
  return {
    generated_at: "2026-06-11T09:00:00.000Z",
    project: {
      id: "94000000-0000-4000-8000-000000000001",
      name: "R5 Workspace",
      slug: "r5-workspace",
      owner_label: "owner",
      status: "active"
    },
    summary: {
      item_count: 2,
      file_count: 2,
      folder_count: 0,
      deleted_item_count: 1,
      version_count: 2,
      accepted_deliverable_count: 1,
      pending_comment_count: 0,
      operation_count: 1
    },
    can_manage: true,
    selected_item_id: "94000000-0000-4000-8000-000000000002",
    items: [
      {
        id: "94000000-0000-4000-8000-000000000002",
        project_id: "94000000-0000-4000-8000-000000000001",
        name: "client-review.md",
        kind: "file",
        path: "/deliverables/client-review.md",
        depth: 1,
        current_version_id: "94000000-0000-4000-8000-000000000003",
        children_count: 0,
        updated_at: "2026-06-11T09:00:00.000Z"
      },
      {
        id: "94000000-0000-4000-8000-000000000009",
        project_id: "94000000-0000-4000-8000-000000000001",
        name: "manual-note.md",
        kind: "file",
        path: "/manual-note.md",
        depth: 0,
        current_version_id: "94000000-0000-4000-8000-000000000010",
        children_count: 0,
        updated_at: "2026-06-11T09:00:00.000Z"
      }
    ],
    versions: [
      {
        id: "94000000-0000-4000-8000-000000000003",
        item_id: "94000000-0000-4000-8000-000000000002",
        version_no: 2,
        filename: "client-review.md",
        mime: "text/markdown",
        size_bytes: 2048,
        sha256: "a".repeat(64),
        created_at: "2026-06-11T09:00:00.000Z",
        current: true,
        source: "accepted_deliverable",
        accepted_deliverable_id: "94000000-0000-4000-8000-000000000004",
        work_item_id: "94000000-0000-4000-8000-000000000005",
        proposal_id: "94000000-0000-4000-8000-000000000006",
        preview_href: "/api/workitems/94000000-0000-4000-8000-000000000005/deliverables/94000000-0000-4000-8000-000000000004/preview",
        download_href: "/api/workitems/94000000-0000-4000-8000-000000000005/deliverables/94000000-0000-4000-8000-000000000004/download",
        restore_href: "/api/workitems/94000000-0000-4000-8000-000000000005/deliverables/94000000-0000-4000-8000-000000000004/restore"
      },
      {
        id: "94000000-0000-4000-8000-000000000010",
        item_id: "94000000-0000-4000-8000-000000000009",
        version_no: 1,
        filename: "manual-note.md",
        mime: "text/markdown",
        size_bytes: 128,
        created_at: "2026-06-11T09:00:00.000Z",
        current: true,
        source: "manual_upload"
      }
    ],
    accepted_deliverables: [
      {
        id: "94000000-0000-4000-8000-000000000004",
        work_item_id: "94000000-0000-4000-8000-000000000005",
        proposal_id: "94000000-0000-4000-8000-000000000006",
        change_id: "94000000-0000-4000-8000-000000000007",
        target_kind: "text_doc",
        target_key: "drive:/deliverables/client-review.md",
        change_type: "updated",
        accepted_version: 2,
        target_path: "/deliverables/client-review.md",
        drive_item_id: "94000000-0000-4000-8000-000000000002",
        drive_version_id: "94000000-0000-4000-8000-000000000003",
        filename: "client-review.md",
        mime: "text/markdown",
        size_bytes: 2048,
        preview_href: "/api/workitems/94000000-0000-4000-8000-000000000005/deliverables/94000000-0000-4000-8000-000000000004/preview",
        download_href: "/api/workitems/94000000-0000-4000-8000-000000000005/deliverables/94000000-0000-4000-8000-000000000004/download",
        restore_href: "/api/workitems/94000000-0000-4000-8000-000000000005/deliverables/94000000-0000-4000-8000-000000000004/restore",
        accepted_at: "2026-06-11T09:00:00.000Z"
      }
    ],
    deleted_items: [
      {
        id: "94000000-0000-4000-8000-000000000011",
        project_id: "94000000-0000-4000-8000-000000000001",
        name: "old-note.md",
        kind: "file",
        path: "/old-note.md",
        depth: 0,
        children_count: 0,
        deleted_at: "2026-06-11T08:00:00.000Z",
        updated_at: "2026-06-11T08:00:00.000Z"
      }
    ],
    comments: [
      {
        id: "94000000-0000-4000-8000-000000000008",
        project_id: "94000000-0000-4000-8000-000000000001",
        author_label: "PM",
        body: "Turn this into a follow-up draft.",
        status: "draft_created",
        created_at: "2026-06-11T09:00:00.000Z",
        draft_work_item_id: "94000000-0000-4000-8000-000000000005",
        draft_href: "/api/pages/workitems/94000000-0000-4000-8000-000000000005"
      }
    ],
    operations: [
      {
        id: "94000000-0000-4000-8000-000000000012",
        project_id: "94000000-0000-4000-8000-000000000001",
        actor_user_id: "94000000-0000-4000-8000-000000000013",
        op_type: "upload_file",
        target_item_id: "94000000-0000-4000-8000-000000000009",
        target_path: "/manual-note.md",
        summary_text: "Uploaded /manual-note.md",
        created_at: "2026-06-11T09:00:00.000Z"
      }
    ],
    actions: {
      upload_file: {
        id: "drive_upload_file",
        label: "Upload sample",
        method: "POST",
        href: "/api/drive/projects/94000000-0000-4000-8000-000000000001/files"
      },
      delete_item: {
        id: "drive_delete_item",
        label: "Move to recycle",
        method: "POST",
        href: "/api/drive/projects/94000000-0000-4000-8000-000000000001/items/94000000-0000-4000-8000-000000000009/delete"
      },
      restore_item: {
        id: "drive_restore_item",
        label: "Restore item",
        method: "POST",
        href: "/api/drive/projects/94000000-0000-4000-8000-000000000001/items/94000000-0000-4000-8000-000000000011/restore"
      }
    }
  };
}

function settingsVm(locale: "zh-CN" | "en-US" = "zh-CN"): SettingsPageVM {
  return {
    generated_at: "2026-06-11T09:00:00.000Z",
    locale,
    runtime: {
      app_env: "test",
      runtime_status: "ready",
      worker_count: 2,
      broker_backend: "memory",
      broker_configured: true,
      database_configured: true,
      agent_run_lease_ms: 300000,
      agent_run_recovery_interval_ms: 30000
    },
    llm_runtime: {
      default_provider: "deepseek",
      default_model: "deepseek-v4-flash",
      provider_count: 1,
      api_key_configured: true,
      base_url_configured: true,
      secret_safe: true
    },
    budgets: {
      run_tokens: 120000,
      user_daily_tokens: 500000,
      team_daily_tokens: 5000000,
      team_monthly_tokens: 50000000,
      run_cost_cny: "5",
      user_daily_cost_cny: "20",
      team_daily_cost_cny: "200",
      team_monthly_cost_cny: "2000"
    },
    language: {
      active_locale: locale,
      preference_locale: locale,
      preference_source: "server",
      preference_synced: true,
      supported_locales: ["zh-CN", "en-US"],
      storage_key: "workhub.locale",
      update_href: "/api/auth/preferences"
    },
    device: {
      desktop_client: "tauri",
      local_execution_boundary: true,
      independent_pet_window: true,
      pet_model_settings_in_web: false,
      restore_href: "/settings?panel=desktop",
      restore_requires_desktop: true,
      web_local_actions_enabled: false
    }
  };
}

function surfaceVm(): GoldPathSurfaceVM {
  const fixture = validateP05GoldPathFixture(createP05GoldPathFixture());
  return {
    fixture_id: fixture.id,
    routes: {
      home: "/",
      intake: "/intake/r4-route-component-session",
      approvals: "/approvals",
      workitem: "/workitems/r4-route-component-workitem",
      proposal: "/proposals/r4-route-component-proposal",
      replay: "/agent-runs/r4-route-component-run/replay",
      cost: "/dashboard/cost",
      knowledge: "/knowledge/search"
    },
    page_vms: {
      attention: {
        ...fixture.attentionHome,
        primary: fixture.attentionHome.primary
          ? {
            ...fixture.attentionHome.primary,
            title: "R4.10 sentinel decision",
            summary_text: "R4.10 home Page VM summary",
            reason_text: "R4.10 home Page VM reason"
          }
          : undefined,
        background_runs: fixture.attentionHome.background_runs.map((run, index) =>
          index === 0 ? { ...run, title: "R4.10 background run", preview_text: "R4.10 background Page VM preview" } : run
        )
      },
      question: fixture.question,
      evidence: fixture.evidenceBubble,
      approvals: {
        ...fixture.approvalCenter,
        items: fixture.approvalCenter.items.map((item, index) =>
          index === 0 ? { ...item, title: "R4.10 approval sentinel", reason_text: "R4.10 approval Page VM reason" } : item
        )
      },
      workitem: fixture.workItemDetail,
      proposal: fixture.proposalDetail,
      replay: fixture.replay,
      cost: fixture.costDashboard,
      settings: settingsVm()
    },
    events: fixture.events,
    cuu_states: []
  };
}

function assertNoMainWindowBoundaryLeak(html: string) {
  assert.equal(html.includes("data-cuu"), false);
  assert.equal(html.includes("./assets/cuu/"), false);
  assert.equal(html.toLowerCase().includes("kanban"), false);
  assert.equal(html.includes('href="#/'), false);
  assert.equal(html.includes("weekly_report_manifest_doc"), false);
}

function structuredProposalConflict(vm: GoldPathSurfaceVM): ProposalConflict {
  const proposal = vm.page_vms.proposal;
  const applyHref = "/api/merge-proposals/10000000-0000-4000-8000-000000000813/apply";
  return {
    id: "r4-13-structured-conflict",
    work_item_id: proposal.work_item_id,
    proposal_id: proposal.proposal_id,
    merge_proposal_id: "10000000-0000-4000-8000-000000000813",
    change_id: proposal.manifest.changes[0]?.id ?? "change-1",
    target_key: `work_item:${proposal.work_item_id}`,
    target_kind: "structured_record",
    change_type: "updated",
    headline: "事项字段需要确认",
    summary_text: "AI 更新了标题和任务项，可以展开高级字段编辑。",
    existing: {
      proposal_id: "10000000-0000-4000-8000-000000000814",
      change_id: "10000000-0000-4000-8000-000000000815",
      ref: "main"
    },
    incoming: { ref: "proposal" },
    recommended_option_id: "ai_fusion",
    options: [
      {
        id: "ai_fusion",
        label: "采用 AI 融合稿",
        summary_text: "AI 已生成字段级补丁。",
        recommended: true,
        quality_gate: {
          structured_record_patch: {
            type: "structured_record_field_patch",
            changed_fields: ["title", "task_items"],
            merged_value_fields: ["title", "task_items"],
            missing_fields: [],
            unknown_fields: [],
            field_count: 2,
            has_structured_result: true,
            task_plan_scope: {
              selected_plan_id: "10000000-0000-4000-8000-000000000818",
              options: [
                {
                  id: "10000000-0000-4000-8000-000000000818",
                  label: "方案拆解计划",
                  stage: "dispatch",
                  status: "draft",
                  item_count: 1,
                  recommended: true
                }
              ]
            },
            structured_field_patch_dry_run: {
              type: "structured_field_patch_dry_run",
              status: "ready",
              executable: true,
              patch: {
                type: "structured_field_patch",
                target_entity_type: "work_item",
                target_entity_id: proposal.work_item_id,
                source: "ai_fusion",
                operations: [
                  {
                    op: "set",
                    target_entity_type: "work_item",
                    target_entity_id: proposal.work_item_id,
                    field: "title",
                    value_type: "string",
                    before_value: "旧标题",
                    current_value: "旧标题",
                    value: "新标题",
                    source: "ai_fusion"
                  },
                  {
                    op: "set",
                    target_entity_type: "work_item",
                    target_entity_id: proposal.work_item_id,
                    field: "task_items",
                    value_type: "json_array",
                    before_value: [
                      { id: "10000000-0000-4000-8000-000000000816", title: "原始任务项", item_type: "task", sort_order: 0 }
                    ],
                    current_value: [
                      { id: "10000000-0000-4000-8000-000000000816", title: "原始任务项", item_type: "task", sort_order: 0 }
                    ],
                    value: [
                      { id: "10000000-0000-4000-8000-000000000816", title: "原始任务项", item_type: "task", sort_order: 0 },
                      { id: "10000000-0000-4000-8000-000000000817", title: "新增风险项", item_type: "risk", sort_order: 1 }
                    ],
                    source: "ai_fusion"
                  }
                ]
              },
              issues: [],
              audit_payload: {
                target_entity_type: "work_item",
                target_entity_id: proposal.work_item_id,
                field_count: 2,
                operation_fields: ["title", "task_items"],
                source: "ai_fusion"
              }
            }
          }
        },
        action: {
          id: "apply_ai_fusion",
          label: "采用 AI 融合稿",
          method: "POST",
          href: applyHref,
          request_json: { confirm: true }
        }
      }
    ]
  };
}

function routeSession(inputMode: SessionVM["question"]["input_mode"] = "single_choice"): SessionVM {
  return {
    session_id: "10000000-0000-4000-8000-000000000901",
    work_item_id: "10000000-0000-4000-8000-000000000902",
    topic: "整理区域周报",
    stream_href: "/api/push/stream/session/10000000-0000-4000-8000-000000000901",
    next_question_href: "/api/sessions/10000000-0000-4000-8000-000000000901/next-question",
    question: {
      id: "10000000-0000-4000-8000-000000000903",
      title: "这次周报先按哪个方向推进？",
      body: "先选一个方向，必要时再补充一句。",
      input_mode: inputMode,
      options: [
        { id: "risk-first", label: "先看风险", description: "聚焦异常区域和阻塞项。" },
        { id: "metric-first", label: "先看指标", description: "聚焦达成率与趋势。" }
      ],
      recommended_option_ids: ["risk-first"],
      free_text: {
        enabled: true,
        collapsed_by_default: true,
        placeholder: "只有选项不够时再补充。",
        max_length: 120
      },
      progress: [
        { key: "goal", label: "目标", state: "done" },
        { key: "scope", label: "范围", state: "active" }
      ],
      evidence_refs: [],
      submit: { method: "POST", href: "/api/sessions/10000000-0000-4000-8000-000000000901/next-question" }
    }
  };
}

function routeEvidenceBubble(): EvidenceBubble {
  return {
    id: "10000000-0000-4000-8000-000000000911",
    query_text: "区域周报",
    summary_text: "找到两条可引用证据，优先使用会议纪要与 Drive 文档。",
    missing_evidence_note: "未找到 CRM 原始明细，不会补造。",
    evidence_refs: [
      {
        id: "10000000-0000-4000-8000-000000000912",
        source_type: "meeting",
        source_id: "weekly-sync",
        title: "区域周会纪要",
        excerpt: "华东区本周主要风险来自供应延迟。",
        href: "/knowledge/sources/weekly-sync"
      },
      {
        id: "10000000-0000-4000-8000-000000000913",
        source_type: "drive_file",
        source_id: "drive:regional-report",
        title: "区域周报草稿",
        excerpt: "指标页包含达成率与重点客户变动。",
        href: "/knowledge/sources/regional-report"
      }
    ],
    actions: [
      {
        id: "use_for_current_task",
        label: "Use in current task",
        method: "POST",
        href: "/api/workitems/10000000-0000-4000-8000-000000000902/evidence-bindings"
      },
      { id: "open_full_search", label: "Open full search", method: "GET", href: "/knowledge/search?q=regional" }
    ]
  };
}

test("R4.10 Home route component renders directly from Attention Page VM with bilingual fixed copy", () => {
  const zh = renderWebRouteComponents(surfaceVm(), { locale: "zh-CN" }).home;
  const en = renderWebRouteComponents(surfaceVm(), { locale: "en-US" }).home;

  assert.ok(zh);
  assert.ok(en);
  assert.equal(zh.html.includes('data-r4-route-component="home"'), true);
  assert.equal(zh.html.includes('data-r4-route-component-source="page-vm"'), true);
  assert.equal(zh.html.includes("R4.10 sentinel decision"), true);
  assert.equal(zh.html.includes("R4.10 background Page VM preview"), true);
  assert.equal(zh.html.includes("需要你决定"), true);
  assert.equal(en.html.includes("Needs your decision"), true);
  assert.equal(en.html.includes('data-r4-route-component-locale="en-US"'), true);
  assertNoMainWindowBoundaryLeak(zh.html);
  assertNoMainWindowBoundaryLeak(en.html);
});

test("R4.11 WorkItem route component keeps task context, trace, acceptance, and evidence from Page VM", () => {
  const vm = surfaceVm();
  const workitem = renderWebRouteComponents(vm, { locale: "en-US" }).workitem;

  assert.ok(workitem);
  assert.equal(workitem.html.includes('data-r4-route-component="workitem"'), true);
  assert.equal(workitem.html.includes('data-r4-route-component-source="page-vm"'), true);
  assert.equal(workitem.html.includes(`data-r4-workitem-id="${vm.page_vms.workitem.workitem.id}"`), true);
  assert.equal(workitem.html.includes(`data-r4-workitem-trace-count="${vm.page_vms.workitem.agent_trace_preview.length}"`), true);
  assert.equal(workitem.html.includes(`data-r4-workitem-acceptance-count="${vm.page_vms.workitem.acceptance.length}"`), true);
  assert.equal(workitem.html.includes("AI execution trace"), true);
  assert.equal(workitem.html.includes("Acceptance checklist"), true);
  assert.equal(workitem.html.includes("data-method=\"GET\""), true);
  assert.deepEqual(workitem.primaryHrefs.includes(`/proposals/${vm.page_vms.proposal.proposal_id}`), true);
  assertNoMainWindowBoundaryLeak(workitem.html);
});

test("R4.11 Proposal route component preserves review actions, rollback, changes, checks, evidence, and comments", () => {
  const vm = surfaceVm();
  const proposal = renderWebRouteComponents(vm, { locale: "en-US" }).proposal;

  assert.ok(proposal);
  assert.equal(proposal.html.includes('data-r4-route-component="proposal"'), true);
  assert.equal(proposal.html.includes(`data-r4-proposal-id="${vm.page_vms.proposal.proposal_id}"`), true);
  assert.equal(proposal.html.includes(`data-r4-proposal-change-count="${vm.page_vms.proposal.manifest.changes.length}"`), true);
  assert.equal(proposal.html.includes(`data-r4-proposal-check-count="${vm.page_vms.proposal.manifest.checks.length}"`), true);
  assert.equal(proposal.html.includes("Deliverable change request"), true);
  assert.equal(proposal.html.includes("Rollback available"), true);
  assert.equal(proposal.html.includes('data-action-id="request_changes"'), true);
  assert.equal(proposal.html.includes('data-method="POST"'), true);
  assert.equal(proposal.html.includes('data-requires-reason="true"'), true);
  assert.deepEqual(proposal.primaryHrefs, [
    vm.page_vms.proposal.review_actions.approve.href,
    vm.page_vms.proposal.review_actions.request_changes.href,
    vm.page_vms.proposal.review_actions.merge?.href
  ].filter(Boolean));
  assertNoMainWindowBoundaryLeak(proposal.html);
});

test("R4.13 Proposal route component exposes advanced structured conflict editors from route surface", () => {
  const vm = {
    ...surfaceVm(),
    proposal_conflicts: [] as ProposalConflict[]
  };
  vm.proposal_conflicts = [structuredProposalConflict(vm)];
  const proposal = renderWebRouteComponents(vm, { locale: "en-US" }).proposal;

  assert.ok(proposal);
  assert.equal(proposal.html.includes('data-r4-route-component="proposal"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-conflict-count="1"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-advanced-review="true"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-conflicts="1"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-field-editor="true"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-subrecord-editor="true"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-react-mutation-editor-host="structured-field-scalar"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-react-mutation-editor-mounted="false"'), true);
  assert.equal(proposal.html.includes('data-proposal-conflicts="1"'), true);
  assert.equal(proposal.html.includes('data-structured-record-patch="true"'), true);
  assert.equal(proposal.html.includes('data-proposal-structured-field-editor="true"'), true);
  assert.equal(proposal.html.includes('data-proposal-subrecord-item-diff="true"'), true);
  assert.equal(proposal.html.includes('data-task-plan-scope="required"'), true);
  assert.equal(proposal.html.includes('data-field-editor-action="custom"'), true);
  assert.equal(proposal.html.includes('data-action-href="/api/merge-proposals/10000000-0000-4000-8000-000000000813/apply"'), true);
  assert.equal(proposal.html.includes("Advanced field editor"), true);
  assert.equal(proposal.html.includes("Advanced item editor"), true);
  assert.equal(proposal.primaryHrefs.includes("/api/merge-proposals/10000000-0000-4000-8000-000000000813/apply"), true);
  assertNoMainWindowBoundaryLeak(proposal.html);
});

test("R4.19 Proposal split adapter keeps readonly props separate from advanced editor fallback", () => {
  const vm = {
    ...surfaceVm(),
    proposal_conflicts: [] as ProposalConflict[]
  };
  vm.proposal_conflicts = [structuredProposalConflict(vm)];
  const proposal = renderWebRouteComponents(vm, { locale: "en-US" }).proposal;

  assert.ok(proposal);
  assert.equal(proposal.reactComponent?.routeKey, "proposal");
  if (proposal.reactComponent?.routeKey !== "proposal") {
    throw new Error("R4.19 Proposal split adapter is missing");
  }
  const expected = createProposalReactRouteComponent(vm.page_vms.proposal, vm.proposal_conflicts, "en-US", {
    actionHrefs: ["/api/merge-proposals/10000000-0000-4000-8000-000000000813/apply"],
    lineEditor: false,
    fieldEditor: true,
    subrecordEditor: true
  });

  assert.equal(proposal.reactComponent.componentName, "ProposalRouteComponent");
  assert.equal(proposal.reactComponent.adapter, "react-compatible-route-component-v1");
  assert.equal(proposal.reactComponent.mode, "html-fallback");
  assert.equal(proposal.reactComponent.htmlFallback, true);
  assert.equal(proposal.reactComponent.propsSource, "typed-page-vm");
  assert.equal(proposal.reactComponent.propsFingerprint, expected.propsFingerprint);
  assert.deepEqual(proposal.reactComponent.primaryHrefs, proposal.primaryHrefs);
  assert.equal(proposal.reactComponent.props.proposalId, vm.page_vms.proposal.proposal_id);
  assert.equal(proposal.reactComponent.props.workItemId, vm.page_vms.proposal.work_item_id);
  assert.equal(proposal.reactComponent.props.changeCount, vm.page_vms.proposal.manifest.changes.length);
  assert.equal(proposal.reactComponent.props.checkCount, vm.page_vms.proposal.manifest.checks.length);
  assert.equal(proposal.reactComponent.props.evidenceRefCount, vm.page_vms.proposal.evidence_refs.length);
  assert.equal(proposal.reactComponent.props.commentCount, vm.page_vms.proposal.comments.length);
  assert.equal(proposal.reactComponent.props.conflictCount, 1);
  assert.equal(proposal.reactComponent.props.reviewActionCount, 3);
  assert.equal(proposal.reactComponent.props.advancedFallbackPreserved, true);
  assert.equal(proposal.reactComponent.props.advancedFallbackSource, "proposal-advanced-editors-html-fallback");
  assert.equal(proposal.reactComponent.props.advancedFallbackActionCount, 1);
  assert.equal(proposal.reactComponent.props.fieldEditorFallback, true);
  assert.equal(proposal.reactComponent.props.subrecordEditorFallback, true);
  assert.equal(proposal.html.includes('data-r4-react-component="ProposalRouteComponent"'), true);
  assert.equal(proposal.html.includes('data-r4-hydration-react-component="ProposalRouteComponent"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-split-adapter="true"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-advanced-fallback-preserved="true"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-advanced-fallback="true"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-react-mutation-editor-host="structured-field-scalar"'), true);
  assert.equal(proposal.html.includes('data-proposal-structured-field-editor="true"'), true);
  assert.equal(proposal.html.includes('data-proposal-subrecord-item-diff="true"'), true);
  assertNoMainWindowBoundaryLeak(proposal.html);
});

test("R4.14 Intake route component renders a typed option-first session without chat-wall fallback", () => {
  const vm = {
    ...surfaceVm(),
    intake_session: routeSession()
  };
  const intake = renderWebRouteComponents(vm, { locale: "en-US" }).intake;

  assert.ok(intake);
  assert.equal(intake.html.includes('data-r4-route-component="intake"'), true);
  assert.equal(intake.html.includes('data-r4-route-component-source="session-vm"'), true);
  assert.equal(intake.html.includes('data-r4-intake-option-count="2"'), true);
  assert.equal(intake.html.includes('data-r4-intake-progress-count="2"'), true);
  assert.equal(intake.html.includes('data-r4-intake-free-text-collapsed="true"'), true);
  assert.equal(intake.html.includes('data-r4-intake-option-first="true"'), true);
  assert.equal(intake.html.includes('data-intake-submit="next-question"'), true);
  assert.equal(intake.html.includes('data-action-id="intake_continue"'), true);
  assert.equal(intake.html.includes('data-request-json="{&quot;selected_option_ids&quot;:[]}"'), true);
  assert.equal(intake.html.includes("<textarea"), false);
  assert.equal(intake.html.includes("message-list"), false);
  assert.deepEqual(intake.primaryHrefs, ["/api/sessions/10000000-0000-4000-8000-000000000901/next-question"]);
  assertNoMainWindowBoundaryLeak(intake.html);
});

test("R4.14 Intake confirm component exposes create work item action with selected option payload", () => {
  const vm = {
    ...surfaceVm(),
    intake_session: routeSession("confirm")
  };
  const intake = renderWebRouteComponents(vm, { locale: "zh-CN" }).intake;

  assert.ok(intake);
  assert.equal(intake.html.includes('data-r4-intake-input-mode="confirm"'), true);
  assert.equal(intake.html.includes('data-intake-create-workitem="true"'), true);
  assert.equal(intake.html.includes('data-action-id="create_workitem"'), true);
  assert.equal(intake.html.includes("创建工作项"), true);
  assert.equal(intake.primaryHrefs.includes("/api/workitems"), true);
  assertNoMainWindowBoundaryLeak(intake.html);
});

test("R4.14 Knowledge route component renders cited fallback evidence and binding payloads", () => {
  const vm = {
    ...surfaceVm(),
    knowledge_evidence: routeEvidenceBubble()
  };
  const knowledge = renderWebRouteComponents(vm, { locale: "en-US" }).knowledge;

  assert.ok(knowledge);
  assert.equal(knowledge.html.includes('data-r4-route-component="knowledge"'), true);
  assert.equal(knowledge.html.includes('data-r4-route-component-source="evidence-bubble"'), true);
  assert.equal(knowledge.html.includes('data-r4-knowledge-query="区域周报"'), true);
  assert.equal(knowledge.html.includes('data-r4-knowledge-evidence-count="2"'), true);
  assert.equal(knowledge.html.includes('data-r4-knowledge-action-count="2"'), true);
  assert.equal(knowledge.html.includes('data-r4-knowledge-missing="false"'), true);
  assert.equal(knowledge.html.includes('data-r4-knowledge-evidence-ref="10000000-0000-4000-8000-000000000912"'), true);
  assert.equal(knowledge.html.includes('data-r4-knowledge-source-type="meeting"'), true);
  assert.equal(knowledge.html.includes('data-action-id="use_for_current_task"'), true);
  assert.equal(knowledge.html.includes("&quot;evidence_bubble_id&quot;:&quot;10000000-0000-4000-8000-000000000911&quot;"), true);
  assert.equal(knowledge.html.includes("&quot;evidence_refs&quot;"), true);
  assert.equal(knowledge.primaryHrefs.includes("/api/workitems/10000000-0000-4000-8000-000000000902/evidence-bindings"), true);
  assertNoMainWindowBoundaryLeak(knowledge.html);
});

test("R4.11 Cost route component renders dashboard values directly from Cost Page VM", () => {
  const vm = surfaceVm();
  const cost = renderWebRouteComponents(vm, { locale: "en-US" }).cost;
  const costVm = vm.page_vms.cost;

  assert.ok(cost);
  assert.equal(cost.html.includes('data-r4-route-component="cost"'), true);
  assert.equal(cost.html.includes(`data-r4-cost-total-tokens="${costVm.token_in + costVm.token_out}"`), true);
  assert.equal(cost.html.includes(`data-r4-cost-total-cny="${costVm.total_cost_cny}"`), true);
  assert.equal(cost.html.includes(`data-r4-cost-budget-count="${costVm.budget.length}"`), true);
  assert.equal(cost.html.includes(`data-r4-cost-model-count="${costVm.model_breakdown.length}"`), true);
  assert.equal(cost.html.includes("Budget and cost"), true);
  assert.equal(cost.html.includes("Budget scopes"), true);
  assertNoMainWindowBoundaryLeak(cost.html);
});

test("R4.11 Settings route component uses a typed Settings Page VM without leaking secrets or pet settings", () => {
  const vm = surfaceVm();
  const settings = renderWebRouteComponents(vm, { locale: "en-US" }).settings;

  assert.ok(settings);
  assert.equal(settings.html.includes('data-r4-route-component="settings"'), true);
  assert.equal(settings.html.includes('data-r4-route-component-source="page-vm"'), true);
  assert.equal(settings.html.includes('data-r4-settings-runtime-status="ready"'), true);
  assert.equal(settings.html.includes('data-r4-settings-active-locale="zh-CN"'), true);
  assert.equal(settings.html.includes('data-r4-settings-preference-locale="zh-CN"'), true);
  assert.equal(settings.html.includes('data-r4-settings-preference-source="server"'), true);
  assert.equal(settings.html.includes('data-r4-settings-preference-synced="true"'), true);
  assert.equal(settings.html.includes('data-r4-settings-secret-safe="true"'), true);
  assert.equal(settings.html.includes('data-r4-settings-pet-model-in-web="false"'), true);
  assert.equal(settings.html.includes('data-r4-settings-restore-requires-desktop="true"'), true);
  assert.equal(settings.html.includes('data-r4-settings-web-local-actions="false"'), true);
  assert.equal(settings.html.includes("deepseek-v4-flash"), true);
  assert.equal(settings.html.includes("workhub.locale"), true);
  assert.equal(settings.html.includes("/api/auth/preferences"), true);
  assert.equal(settings.html.includes("Server preference"), true);
  assert.equal(settings.html.includes("Synced"), true);
  assert.equal(settings.html.includes("Pet look is not configured in the Web main window"), true);
  assert.equal(settings.html.includes('data-action-id="open_desktop_settings"'), true);
  assert.equal(settings.html.includes('data-requires-desktop="true"'), true);
  const blockedBaseUrl = "https://api." + "deepseek.com";
  assert.equal(settings.html.includes(blockedBaseUrl), false);
  assert.equal(settings.html.includes("sk-"), false);
  assert.equal(settings.html.includes("data-cuu-settings-model-pack"), false);
  assert.equal(settings.html.includes("legacy-cuu-pack"), false);
  assert.deepEqual(settings.primaryHrefs, [vm.page_vms.settings?.device.restore_href]);
  assertNoMainWindowBoundaryLeak(settings.html);
});

test("R4.16 route components expose hydration boundary metadata without weakening markers", () => {
  const vm = {
    ...surfaceVm(),
    intake_session: routeSession(),
    knowledge_evidence: routeEvidenceBubble()
  };
  const components = renderWebRouteComponents(vm, { locale: "en-US" });
  const expected = {
    home: { source: "page-vm", pageVm: "attention" },
    intake: { source: "session-vm", pageVm: "session" },
    approvals: { source: "page-vm", pageVm: "approvals" },
    workitem: { source: "page-vm", pageVm: "workitem" },
    proposal: { source: "page-vm", pageVm: "proposal" },
    replay: { source: "page-vm", pageVm: "replay" },
    cost: { source: "page-vm", pageVm: "cost" },
    knowledge: { source: "evidence-bubble", pageVm: "evidence" },
    settings: { source: "page-vm", pageVm: "settings" }
  } as const;

  for (const [key, expectation] of Object.entries(expected)) {
    const component = components[key as keyof typeof expected];
    assert.ok(component, `${key} component should exist`);
    assert.equal(component.hydration.routeKey, key);
    assert.equal(component.hydration.mode, "html-fallback");
    assert.equal(component.hydration.adapter, "route-component-v1");
    assert.equal(component.hydration.locale, "en-US");
    assert.equal(component.hydration.source, expectation.source);
    assert.equal(component.hydration.pageVm, expectation.pageVm);
    assert.equal(component.hydration.actionHrefCount, component.primaryHrefs.length);
    assert.equal(component.html.includes('data-r4-hydration-boundary="true"'), true);
    assert.equal(component.html.includes(`data-r4-hydration-route="${key}"`), true);
    assert.equal(component.html.includes(`data-r4-hydration-page-vm="${expectation.pageVm}"`), true);
    assert.equal(component.html.includes(`data-r4-hydration-action-count="${component.primaryHrefs.length}"`), true);
    assert.equal(component.html.includes(`data-r4-route-component="${key}"`), true);
    assertNoMainWindowBoundaryLeak(component.html);
  }
});

test("R4.17 Home and Settings route components expose React-compatible props with HTML fallback parity", () => {
  const vm = surfaceVm();
  const components = renderWebRouteComponents(vm, { locale: "en-US" });
  const expectedHome = createHomeReactRouteComponent(vm.page_vms.attention, "en-US");
  const expectedSettings = createSettingsReactRouteComponent(vm.page_vms.settings!, "en-US");
  const home = components.home;
  const settings = components.settings;

  assert.ok(home);
  assert.ok(settings);
  assert.equal(home.reactComponent?.routeKey, "home");
  assert.equal(settings.reactComponent?.routeKey, "settings");
  if (home.reactComponent?.routeKey !== "home" || settings.reactComponent?.routeKey !== "settings") {
    throw new Error("R4.17 migrated route components are missing typed adapters");
  }

  assert.equal(home.reactComponent.componentName, "HomeRouteComponent");
  assert.equal(home.reactComponent.adapter, "react-compatible-route-component-v1");
  assert.equal(home.reactComponent.mode, "html-fallback");
  assert.equal(home.reactComponent.htmlFallback, true);
  assert.equal(home.reactComponent.propsSource, "typed-page-vm");
  assert.equal(home.reactComponent.propsFingerprint, expectedHome.propsFingerprint);
  assert.deepEqual(home.reactComponent.primaryHrefs, home.primaryHrefs);
  assert.equal(home.reactComponent.props.primaryActions.length, home.primaryHrefs.length);
  assert.equal(home.reactComponent.props.queueCount, vm.page_vms.attention.queue.length);
  assert.equal(home.html.includes('data-r4-react-component="HomeRouteComponent"'), true);
  assert.equal(home.html.includes('data-r4-react-component-html-fallback="true"'), true);
  assert.equal(home.html.includes(`data-r4-react-component-action-count="${home.primaryHrefs.length}"`), true);
  assert.equal(home.html.includes('data-r4-hydration-react-component="HomeRouteComponent"'), true);
  assert.equal(home.html.includes('data-r4-hydration-react-component-fallback="true"'), true);

  assert.equal(settings.reactComponent.componentName, "SettingsRouteComponent");
  assert.equal(settings.reactComponent.adapter, "react-compatible-route-component-v1");
  assert.equal(settings.reactComponent.mode, "html-fallback");
  assert.equal(settings.reactComponent.htmlFallback, true);
  assert.equal(settings.reactComponent.propsSource, "typed-page-vm");
  assert.equal(settings.reactComponent.propsFingerprint, expectedSettings.propsFingerprint);
  assert.deepEqual(settings.reactComponent.primaryHrefs, settings.primaryHrefs);
  assert.equal(settings.reactComponent.props.secretSafe, true);
  assert.equal(settings.reactComponent.props.petModelSettingsInWeb, false);
  assert.equal(settings.reactComponent.props.restoreRequiresDesktop, true);
  assert.equal(settings.reactComponent.props.webLocalActionsEnabled, false);
  assert.equal(settings.html.includes('data-r4-react-component="SettingsRouteComponent"'), true);
  assert.equal(settings.html.includes('data-r4-react-component-html-fallback="true"'), true);
  assert.equal(settings.html.includes(`data-r4-react-component-action-count="${settings.primaryHrefs.length}"`), true);
  assert.equal(settings.html.includes('data-r4-hydration-react-component="SettingsRouteComponent"'), true);
  assert.equal(settings.html.includes('data-r4-hydration-react-component-props-source="typed-page-vm"'), true);
  assert.equal(/api\.deepseek\.com|sk-[0-9A-Za-z]{20,}/u.test(settings.html), false);
  assertNoMainWindowBoundaryLeak(home.html);
  assertNoMainWindowBoundaryLeak(settings.html);
});

test("R4.18 Cost and Replay route components expose React-compatible props without changing fallback renderers", () => {
  const vm = surfaceVm();
  const components = renderWebRouteComponents(vm, { locale: "en-US" });
  const expectedCost = createCostReactRouteComponent(vm.page_vms.cost, "en-US");
  const expectedReplay = createReplayReactRouteComponent(renderAgentRunReplay(vm.page_vms.replay, "web", { locale: "en-US" }), "en-US");
  const cost = components.cost;
  const replay = components.replay;

  assert.ok(cost);
  assert.ok(replay);
  assert.equal(cost.reactComponent?.routeKey, "cost");
  assert.equal(replay.reactComponent?.routeKey, "replay");
  if (cost.reactComponent?.routeKey !== "cost" || replay.reactComponent?.routeKey !== "replay") {
    throw new Error("R4.18 migrated route components are missing typed adapters");
  }

  assert.equal(cost.reactComponent.componentName, "CostRouteComponent");
  assert.equal(cost.reactComponent.adapter, "react-compatible-route-component-v1");
  assert.equal(cost.reactComponent.mode, "html-fallback");
  assert.equal(cost.reactComponent.htmlFallback, true);
  assert.equal(cost.reactComponent.propsSource, "typed-page-vm");
  assert.equal(cost.reactComponent.propsFingerprint, expectedCost.propsFingerprint);
  assert.deepEqual(cost.reactComponent.primaryHrefs, cost.primaryHrefs);
  assert.deepEqual(cost.reactComponent.props.primaryActionHrefs, cost.primaryHrefs);
  assert.equal(cost.reactComponent.props.totalTokens, vm.page_vms.cost.token_in + vm.page_vms.cost.token_out);
  assert.equal(cost.reactComponent.props.totalCostCny, vm.page_vms.cost.total_cost_cny);
  assert.equal(cost.reactComponent.props.budgetCount, vm.page_vms.cost.budget.length);
  assert.equal(cost.reactComponent.props.riskCount, vm.page_vms.cost.top_exhaustion_risks.length);
  assert.equal(cost.reactComponent.props.modelCount, vm.page_vms.cost.model_breakdown.length);
  assert.equal(cost.reactComponent.props.trendCount, vm.page_vms.cost.trend.length);
  assert.equal(cost.html.includes('data-r4-react-component="CostRouteComponent"'), true);
  assert.equal(cost.html.includes('data-r4-hydration-react-component="CostRouteComponent"'), true);
  assert.equal(cost.html.includes(`data-r4-react-component-action-count="${cost.primaryHrefs.length}"`), true);
  assert.equal(cost.html.includes(`data-r4-cost-total-tokens="${vm.page_vms.cost.token_in + vm.page_vms.cost.token_out}"`), true);

  assert.equal(replay.reactComponent.componentName, "ReplayRouteComponent");
  assert.equal(replay.reactComponent.adapter, "react-compatible-route-component-v1");
  assert.equal(replay.reactComponent.mode, "html-fallback");
  assert.equal(replay.reactComponent.htmlFallback, true);
  assert.equal(replay.reactComponent.propsSource, "typed-page-vm");
  assert.equal(replay.reactComponent.propsFingerprint, expectedReplay.propsFingerprint);
  assert.deepEqual(replay.reactComponent.primaryHrefs, replay.primaryHrefs);
  assert.deepEqual(replay.reactComponent.props.primaryActionHrefs, replay.primaryHrefs);
  assert.equal(replay.reactComponent.props.runId, vm.page_vms.replay.run.id);
  assert.equal(replay.reactComponent.props.stepCount, vm.page_vms.replay.steps.length);
  assert.equal(replay.reactComponent.props.acceptedDeliverableCount, vm.page_vms.replay.accepted_deliverables?.length ?? 0);
  assert.equal(replay.html.includes("Accepted deliverables"), true);
  assert.equal(replay.html.includes('data-r4-react-component="ReplayRouteComponent"'), true);
  assert.equal(replay.html.includes('data-r4-hydration-react-component="ReplayRouteComponent"'), true);
  assert.equal(replay.html.includes(`data-r4-react-component-action-count="${replay.primaryHrefs.length}"`), true);
  assertNoMainWindowBoundaryLeak(cost.html);
  assertNoMainWindowBoundaryLeak(replay.html);
  assert.equal(/api\.deepseek\.com|sk-[0-9A-Za-z]{20,}/u.test(`${cost.html}${replay.html}`), false);
});

test("R4.10 Approvals route component keeps action reasons and Page VM counts visible", () => {
  const vm = surfaceVm();
  const approvals = renderWebRouteComponents(vm, { locale: "en-US" }).approvals;

  assert.ok(approvals);
  assert.equal(approvals.html.includes('data-r4-route-component="approvals"'), true);
  assert.equal(approvals.html.includes("R4.10 approval sentinel"), true);
  assert.equal(approvals.html.includes("Rejected work must include a reason so AI can revise it."), true);
  assert.equal(approvals.html.includes(`data-r4-approval-pending="${vm.page_vms.approvals.counts.pending ?? vm.page_vms.approvals.items.length}"`), true);
  assert.equal(approvals.html.includes('data-r4-approval-routed="true"'), true);
  assert.equal(approvals.html.includes(">Routed</span>"), true);
  assert.equal(approvals.html.includes('data-requires-reason="true"'), true);
  assert.deepEqual(approvals.primaryHrefs, vm.page_vms.approvals.items[0]?.actions.map((action) => action.href) ?? []);
  assertNoMainWindowBoundaryLeak(approvals.html);
});

test("R5.1 Drive route component exposes files, versions, deliverable actions, and comment draft links", () => {
  const drive = renderWebRouteComponent({ key: "drive", drive: drivePageVm() }, { locale: "en-US" });

  assert.equal(drive.key, "drive");
  assert.equal(drive.html.includes('data-r4-route-component="drive"'), true);
  assert.equal(drive.html.includes('data-r4-route-component-source="page-vm"'), true);
  assert.equal(drive.html.includes('data-r4-drive-item-count="2"'), true);
  assert.equal(drive.html.includes('data-r4-drive-version-count="2"'), true);
  assert.equal(drive.html.includes('data-r4-drive-accepted-count="1"'), true);
  assert.equal(drive.html.includes('data-r5-drive-deleted-count="1"'), true);
  assert.equal(drive.html.includes('data-r5-drive-operation-count="1"'), true);
  assert.equal(drive.html.includes("client-review.md"), true);
  assert.equal(drive.html.includes('data-r4-drive-version-current="true"'), true);
  assert.equal(drive.html.includes('data-action-id="drive_upload_file" data-method="POST"'), true);
  assert.equal(drive.html.includes('data-action-id="drive_delete_item" data-method="POST"'), true);
  assert.equal(drive.html.includes('data-r5-drive-delete-target="94000000-0000-4000-8000-000000000009"'), true);
  assert.equal(drive.html.includes("expected_current_version_id"), true);
  assert.equal(drive.html.includes("94000000-0000-4000-8000-000000000010"), true);
  assert.equal(drive.html.includes('data-action-id="drive_restore_item" data-method="POST"'), true);
  assert.equal(drive.html.includes('data-r5-drive-recycle="true"'), true);
  assert.equal(drive.html.includes('data-r5-drive-operations="true"'), true);
  assert.equal(drive.html.includes('data-action-id="drive_preview"'), true);
  assert.equal(drive.html.includes('data-action-id="drive_download"'), true);
  assert.equal(drive.html.includes('data-action-id="drive_restore" data-method="POST"'), true);
  assert.equal(drive.html.includes("/api/pages/workitems/94000000-0000-4000-8000-000000000005"), true);
  assert.equal(drive.hydration.pageVm, "drive");
  assert.equal(drive.primaryHrefs.length, 7);
  assertNoMainWindowBoundaryLeak(drive.html);
});

test("R4.10 Replay route component uses replay renderer while preserving route component markers", () => {
  const vm = surfaceVm();
  const replay = renderWebRouteComponents(vm, { locale: "en-US" }).replay;

  assert.ok(replay);
  assert.equal(replay.html.includes('data-r4-route-component="replay"'), true);
  assert.equal(replay.html.includes(`data-r4-replay-step-count="${vm.page_vms.replay.steps.length}"`), true);
  assert.equal(replay.html.includes("See how AI did it"), true);
  assert.equal(replay.html.includes("Accepted deliverables"), true);
  assert.equal(replay.html.includes("Decision record"), true);
  assert.equal(replay.primaryHrefs.length, (vm.page_vms.replay.accepted_deliverables ?? []).flatMap((item) => [item.preview_href, item.download_href, item.restore_href]).filter(Boolean).length);
  assertNoMainWindowBoundaryLeak(replay.html);
  assert.match(replay.css, /@media \(max-width:860px\)/u);
});
