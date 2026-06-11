import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture, validateP05GoldPathFixture } from "@workhub/agent/fixtures";
import type { GoldPathSurfaceVM, ProposalConflict, SettingsPageVM } from "@workhub/contracts";

import { renderWebRouteComponents } from "./route-components.js";

function settingsVm(locale: "zh-CN" | "en-US" = "zh-CN"): SettingsPageVM {
  return {
    generated_at: "2026-06-11T09:00:00.000Z",
    locale,
    runtime: {
      app_env: "test",
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
      base_url_configured: true
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
      supported_locales: ["zh-CN", "en-US"],
      storage_key: "workhub.locale"
    },
    device: {
      desktop_client: "tauri",
      local_execution_boundary: true,
      independent_pet_window: true,
      pet_model_settings_in_web: false,
      restore_href: "/settings?panel=desktop"
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
      cost: "/dashboard/cost"
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
  assert.equal(settings.html.includes('data-r4-settings-pet-model-in-web="false"'), true);
  assert.equal(settings.html.includes("deepseek-v4-flash"), true);
  assert.equal(settings.html.includes("workhub.locale"), true);
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
