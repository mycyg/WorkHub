import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture } from "@workhub/agent/fixtures";
import type { AcceptedDeliverableVM, GoldPathSurfaceVM, ReplayMergeAttemptVM } from "@workhub/contracts";
import { toCuuState } from "@workhub/events";

import { renderGoldPathSurface } from "./render.js";

function surfaceVm() {
  const fixture = createP05GoldPathFixture();
  return {
    fixture_id: fixture.id,
    routes: {
      home: "/",
      intake: "/intake/demo",
      approvals: "/approvals",
      workitem: "/workitems/demo",
      proposal: "/proposals/demo",
      replay: "/agent-runs/demo/replay",
      cost: "/dashboard/cost",
      knowledge: "/knowledge/search"
    },
    page_vms: {
      attention: fixture.attentionHome,
      question: fixture.question,
      evidence: fixture.evidenceBubble,
      approvals: fixture.approvalCenter,
      workitem: fixture.workItemDetail,
      proposal: fixture.proposalDetail,
      replay: fixture.replay,
      cost: fixture.costDashboard
    },
    events: fixture.events,
    cuu_states: fixture.events.map((event) => toCuuState(event))
  } as const;
}

test("gold path renderer creates the P0.5 pages plus app settings from one shared VM", () => {
  const rendered = renderGoldPathSurface(surfaceVm(), "web");

  assert.equal(rendered.fixtureId, "weekly_report_manifest_doc");
  assert.deepEqual(rendered.pages.map((page) => page.key), [
    "home",
    "intake",
    "approvals",
    "workitem",
    "proposal",
    "replay",
    "cost",
    "knowledge",
    "settings"
  ]);
  assert.equal(rendered.pages.every((page) => page.html.includes("wh-shell")), true);
});

test("approval center keeps the blocking decision visible without turning into a kanban", () => {
  const approvals = renderGoldPathSurface(surfaceVm(), "web").pages.find((page) => page.key === "approvals");

  assert.equal(approvals?.html.includes("审批中心"), true);
  assert.equal(approvals?.html.includes("data-requires-reason=\"true\""), true);
  assert.equal(approvals?.html.includes("kanban"), false);
  assert.equal(approvals?.cuuState, "asking_approval");
});

test("approval center renderer surfaces page_info when the queue is truncated", () => {
  const vm = surfaceVm();
  vm.page_vms.approvals.page_info = { limit: 100, returned: 100, has_more: true };
  vm.page_vms.approvals.counts.pending = 100;
  vm.page_vms.approvals.counts.pending_total = 137;
  const approvals = renderGoldPathSurface(vm, "desktop", { locale: "zh-CN" }).pages.find((page) => page.key === "approvals");

  assert.ok(approvals);
  assert.equal(approvals.html.includes('data-r4-approval-page-has-more="true"'), true);
  assert.equal(approvals.html.includes("已显示 100/137 条审批，还有更多未展开。"), true);
});

test("approval center renderer does not leak raw approval facts", () => {
  const vm = surfaceVm();
  const request = vm.page_vms.approvals.requests[0];
  assert.ok(request);
  request.action_pattern = "tool.write_file";
  request.status = "pending";
  request.routed_to_user_id = "96000000-0000-4000-8000-000000000011";
  request.sla_due_at = "2026-07-05T00:00:00.000Z";

  const approvals = renderGoldPathSurface(vm, "web", { locale: "en-US" }).pages.find((page) => page.key === "approvals");

  assert.ok(approvals);
  assert.equal(approvals.html.includes("tool.write_file"), false);
  assert.equal(approvals.html.includes("96000000-0000-4000-8000-000000000011"), false);
  assert.equal(approvals.html.includes("2026-07-05T00:00:00.000Z"), false);
  assert.equal(approvals.html.includes("<strong>Tool approval</strong>"), true);
  assert.equal(approvals.html.includes("Pending · SLA 2026-07-05 00:00"), true);
  assert.equal(approvals.html.includes(">Routed</span>"), true);
});

test("gold path renderer localizes work item and proposal check statuses", () => {
  const vm = surfaceVm();
  vm.page_vms.workitem.workitem.status = "spec_ready";
  vm.page_vms.proposal.manifest.checks = [
    { id: "snapshot_exists", label: "Snapshot exists", status: "passed" },
    { id: "budget_warning", label: "Budget guard", status: "warning", detail: "Approaching the run cap." }
  ];

  const rendered = renderGoldPathSurface(vm, "web", { locale: "zh-CN" });
  const workitem = rendered.pages.find((page) => page.key === "workitem");
  const proposal = rendered.pages.find((page) => page.key === "proposal");

  assert.ok(workitem);
  assert.ok(proposal);
  assert.equal(workitem.html.includes("spec_ready"), false);
  assert.equal(workitem.html.includes("规格已就绪"), true);
  assert.equal(proposal.html.includes(">passed<"), false);
  assert.equal(proposal.html.includes(">warning"), false);
  assert.equal(proposal.html.includes("通过"), true);
  assert.equal(proposal.html.includes("有提醒"), true);
});

test("option intake stays option-first with collapsed free text instead of a chat wall", () => {
  const intake = renderGoldPathSurface(surfaceVm(), "desktop").pages.find((page) => page.key === "intake");

  assert.equal(intake?.html.includes("data-option-id"), true);
  assert.equal(intake?.html.includes("<textarea"), false);
  assert.equal(intake?.html.includes("message-list"), false);
});

test("gold path renderer localizes static page chrome while keeping VM content intact", () => {
  const rendered = renderGoldPathSurface(surfaceVm(), "web", { locale: "en-US" });
  const home = rendered.pages.find((page) => page.key === "home");
  const cost = rendered.pages.find((page) => page.key === "cost");
  const settings = rendered.pages.find((page) => page.key === "settings");

  assert.equal(home?.html.includes("Needs your decision"), true);
  // L1: home entry copy no longer promises an expandable board/kanban that doesn't exist.
  // xreview C: the entry card lists the REST of the queue, so its title/empty copy say so
  // (was the misleading singular "this one thing right now").
  assert.equal(home?.html.includes("More in your queue") || home?.html.includes("Nothing else queued"), true);
  assert.equal(home?.html.includes("The board is fallback only"), false);
  assert.equal(home?.html.includes("Cuu ·"), false);
  assert.equal(home?.html.includes("./assets/cuu/"), false);
  assert.equal(home?.html.includes("data-cuu-asset=\"bitmap\""), false);
  assert.equal(rendered.css.includes("wh-cuu-portrait"), false);
  assert.equal(cost?.html.includes("Budget and cost"), true);
  assert.equal(cost?.html.includes("Regular users see their own slice"), true);
  assert.equal(settings?.html.includes("App settings"), true);
  assert.equal(settings?.html.includes("AI runtime"), true);
  assert.equal(settings?.html.includes("independent pet window"), true);
  assert.equal(settings?.html.includes("data-cuu-settings-model-pack-selectable"), false);
  assert.equal(settings?.html.includes("Cuu settings"), false);
});

test("settings page stays serious and keeps pet model choice out of the main app", () => {
  const settings = renderGoldPathSurface(surfaceVm(), "desktop").pages.find((page) => page.key === "settings");

  assert.equal(settings?.route, "/settings");
  assert.equal(settings?.title, "设置");
  assert.equal(settings?.html.includes("应用设置"), true);
  assert.equal(settings?.html.includes("桌宠形象在独立的桌宠窗口里设置"), true);
  assert.equal(settings?.html.includes("wh-grid wh-settings-grid"), true);
  assert.equal(settings?.html.includes("legacy-cuu-pack"), false);
  assert.equal(settings?.html.includes("Live2D 实验形象"), false);
  assert.equal(settings?.html.includes("data-cuu-settings-model-pack-id"), false);
});

test("gold path page css keeps settings cards and long copy inside the frame", () => {
  const rendered = renderGoldPathSurface(surfaceVm(), "desktop");

  assert.match(rendered.css, /\.wh-shell\{[^}]*width:100%;max-width:100%;box-sizing:border-box;overflow-x:hidden/u);
  assert.match(rendered.css, /\.wh-shell,\.wh-shell \*\{box-sizing:border-box\}/u);
  assert.match(rendered.css, /\.wh-stage\{[^}]*width:100%;[^}]*min-width:0/u);
  assert.match(rendered.css, /\.wh-desktop \.wh-stage\{max-width:660px;margin:0;grid-template-columns:1fr\}/u);
  assert.match(rendered.css, /\.wh-main\{[^}]*min-width:0/u);
  assert.match(rendered.css, /\.wh-grid\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(min\(220px,100%\),1fr\)\);[^}]*min-width:0;max-width:100%/u);
  assert.match(rendered.css, /\.wh-settings-grid\{grid-template-columns:repeat\(auto-fit,minmax\(min\(360px,100%\),1fr\)\)\}/u);
  assert.match(rendered.css, /\.wh-card\{[^}]*min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word/u);
  assert.match(rendered.css, /\.wh-subtle\{[^}]*overflow-wrap:anywhere/u);
  assert.match(rendered.css, /\.wh-row\{[^}]*min-width:0/u);
  assert.match(rendered.css, /\.wh-row-meta\{[^}]*flex-wrap:wrap/u);
  assert.match(rendered.css, /\.wh-pill\{[^}]*max-width:100%;white-space:normal;text-align:left;overflow-wrap:anywhere;word-break:break-word/u);
  assert.match(rendered.css, /\.wh-row\{flex-direction:column;align-items:flex-start\}/u);
});

test("proposal and replay pages expose review actions, rollback, cost, and at least five replay steps", () => {
  const rendered = renderGoldPathSurface(surfaceVm(), "web");
  const proposal = rendered.pages.find((page) => page.key === "proposal");
  const englishProposal = renderGoldPathSurface(surfaceVm(), "web", { locale: "en-US" }).pages.find((page) => page.key === "proposal");
  const replay = rendered.pages.find((page) => page.key === "replay");

  assert.equal(proposal?.html.includes("回滚"), true);
  assert.equal(proposal?.html.includes("data-requires-reason=\"true\""), true);
  assert.equal(proposal?.html.includes("data-action-id=\"approve\""), true);
  assert.equal(proposal?.html.includes("data-action-id=\"merge\""), false);
  assert.equal(proposal?.html.includes("<span class=\"wh-pill\">文档</span>"), true);
  assert.equal(proposal?.html.includes("<span class=\"wh-pill\">text_doc</span>"), false);
  assert.equal(englishProposal?.html.includes("<span class=\"wh-pill\">Text document</span>"), true);
  assert.equal(replay?.html.includes("估算成本"), true);
  assert.equal((replay?.html.match(/wh-row/gu)?.length ?? 0) >= 5, true);
});

test("gold path replay hides raw tool ids from visible step summaries", () => {
  const vm = surfaceVm();
  const firstStep = vm.page_vms.replay.steps[0]!;
  vm.page_vms.replay.steps = [
    {
      ...firstStep,
      phase: "tool_result",
      tool_name: "read_project_file",
      output_excerpt: undefined
    }
  ];

  const replay = renderGoldPathSurface(vm, "web").pages.find((page) => page.key === "replay");

  assert.equal(replay?.html.includes("工具结果"), true);
  // R9.7 review: falling back to raw `tool_name` made machine ids visible in the old
  // replay surface; the fallback must be localized user copy instead.
  assert.equal(replay?.html.includes("read_project_file"), false);
  assert.equal(replay?.html.includes("工具已返回，AI 正在整理下一步。"), true);
});

test("gold path proposal page hides model self narration titles", () => {
  const vm = surfaceVm();
  const dirty = {
    ...vm,
    page_vms: {
      ...vm.page_vms,
      proposal: {
        ...vm.page_vms.proposal,
        title: "完成了。让我做一个人话总结。"
      }
    }
  } as unknown as GoldPathSurfaceVM;
  const proposal = renderGoldPathSurface(dirty, "web").pages.find((page) => page.key === "proposal");

  assert.equal(proposal?.html.includes("完成了。让我做一个人话总结。"), false);
  assert.equal(proposal?.html.includes("交付物变更申请"), true);
});

test("replay page surfaces accepted deliverables with preview and download actions", () => {
  const vm = surfaceVm();
  const deliverable: AcceptedDeliverableVM = {
    id: "76000000-0000-4000-8000-000000000001",
    work_item_id: vm.page_vms.replay.run.work_item_id,
    proposal_id: "76000000-0000-4000-8000-000000000002",
    change_id: "76000000-0000-4000-8000-000000000003",
    target_kind: "delivery",
    target_key: "delivery:/outputs/result.md",
    change_type: "created",
    accepted_version: 2,
    target_path: "/outputs/result.md",
    filename: "result.md",
    mime: "text/markdown",
    size_bytes: 42,
    download_href: "/api/workitems/demo/deliverables/accepted-1/download",
    preview_href: "/api/workitems/demo/deliverables/accepted-1/preview",
    restore_href: "/api/workitems/demo/deliverables/accepted-1/restore",
    accepted_at: "2026-06-05T00:00:00.000Z"
  };
  const custom: GoldPathSurfaceVM = {
    ...vm,
    page_vms: {
      ...vm.page_vms,
      replay: {
        ...vm.page_vms.replay,
        accepted_deliverables: [deliverable]
      }
    }
  };

  const replay = renderGoldPathSurface(custom, "web").pages.find((page) => page.key === "replay");

  assert.equal(replay?.html.includes("正式交付物"), true);
  assert.equal(replay?.html.includes("result.md"), true);
  assert.equal(replay?.html.includes("/api/workitems/demo/deliverables/accepted-1/preview"), true);
  assert.equal(replay?.html.includes("/api/workitems/demo/deliverables/accepted-1/download"), true);
  assert.equal(replay?.html.includes("/api/workitems/demo/deliverables/accepted-1/restore"), true);
  assert.equal(replay?.html.includes("data-action-id=\"restore_deliverable\""), true);
  assert.equal(replay?.html.includes("data-method=\"POST\""), true);
  assert.deepEqual(replay?.primaryHrefs, [
    "/api/workitems/demo/deliverables/accepted-1/preview",
    "/api/workitems/demo/deliverables/accepted-1/download",
    "/api/workitems/demo/deliverables/accepted-1/restore"
  ]);
});

test("replay page explains merge decisions with bilingual candidate labels", () => {
  const vm = surfaceVm();
  const mergeTimeline: ReplayMergeAttemptVM[] = [
    {
      id: "76000000-0000-4000-8000-000000000011",
      proposal_id: "76000000-0000-4000-8000-000000000012",
      work_item_id: vm.page_vms.replay.run.work_item_id,
      branch_id: "76000000-0000-4000-8000-000000000013",
      actor_kind: "human",
      actor_user_id: "76000000-0000-4000-8000-000000000014",
      result: "merged",
      merge_snapshot_id: "76000000-0000-4000-8000-000000000015",
      conflict_count: 1,
      target_keys: ["delivery:/outputs/result.md"],
      accepted_target_keys: ["delivery:/outputs/result.md"],
      conflicts: [{ target_key: "delivery:/outputs/result.md" }],
      text_hunk_decisions: [],
      decisions: [
        {
          id: "76000000-0000-4000-8000-000000000016",
          conflict_key: "delivery:/outputs/result.md",
          recommended_option_key: "keep_current",
          chosen_option_key: "accept_incoming",
          chosen_by_user_id: "76000000-0000-4000-8000-000000000014",
          chosen_at: "2026-06-05T00:00:00.000Z",
          candidates: [
            {
              option_key: "keep_current",
              target_kind: "delivery",
              rationale_md: "保留当前正式版，不覆盖已经采纳的交付物。",
              recommended: true,
              chosen: false
            },
            {
              option_key: "accept_incoming",
              target_kind: "delivery",
              rationale_md: "明确采纳这次版本，覆盖当前正式版。",
              recommended: false,
              chosen: true
            },
            {
              option_key: "ai_fusion",
              target_kind: "text_doc",
              rationale_md: "AI 建议吸收双方说明，但不替用户裁决。",
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
                      header: "@@ -1,1 +1,1 @@",
                      lines: ["-正式版已有结论。", "+融合后的正文"]
                    }
                  ]
                },
                text_diff3: {
                  type: "line_text_diff3",
                  auto_merge: false,
                  current_hunks: 1,
                  incoming_hunks: 1,
                  conflict_hunks: 1,
                  conflict_ranges: [{ start_line: 2, end_line: 2 }]
                },
                structured_record_patch: {
                  type: "structured_record_field_patch",
                  changed_fields: ["title", "due_at", "acceptance_items"],
                  merged_value_fields: ["title", "due_at", "extra_field"],
                  missing_fields: ["acceptance_items"],
                  unknown_fields: ["extra_field"],
                  field_count: 3,
                  has_structured_result: true,
                  structured_field_patch_dry_run: {
                    type: "structured_field_patch_dry_run",
                    status: "blocked",
                    executable: false,
                    patch: {
                      type: "structured_field_patch",
                      target_entity_type: "work_item",
                      target_entity_id: vm.page_vms.replay.run.work_item_id,
                      source: "ai_fusion",
                      operations: [
                        {
                          op: "set",
                          target_entity_type: "work_item",
                          target_entity_id: vm.page_vms.replay.run.work_item_id,
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
                          target_entity_id: vm.page_vms.replay.run.work_item_id,
                          field: "task_items",
                          value_type: "json_array",
                          before_value: [
                            { id: "76000000-0000-4000-8000-000000000201", title: "原始任务项", item_type: "task" }
                          ],
                          current_value: [
                            { id: "76000000-0000-4000-8000-000000000201", title: "原始任务项", item_type: "task" }
                          ],
                          value: [
                            { id: "76000000-0000-4000-8000-000000000201", title: "原始任务项", item_type: "task" },
                            { id: "76000000-0000-4000-8000-000000000202", title: "新增风险项", item_type: "risk" }
                          ],
                          source: "ai_fusion"
                        }
                      ]
                    },
                    issues: [
                      { severity: "error", code: "missing_declared_field", field: "acceptance_items", message: "missing" },
                      { severity: "error", code: "unknown_field", field: "extra_field", message: "unknown" },
                      { severity: "error", code: "invalid_value_type", field: "due_at", message: "bad date" }
                    ],
                    audit_payload: {
                      target_entity_type: "work_item",
                      target_entity_id: vm.page_vms.replay.run.work_item_id,
                      field_count: 2,
                      operation_fields: ["title", "task_items"],
                      source: "ai_fusion"
                    }
                  }
                }
              },
              recommended: false,
              chosen: false
            }
          ]
        }
      ],
      created_at: "2026-06-05T00:00:00.000Z"
    }
  ];
  const custom: GoldPathSurfaceVM = {
    ...vm,
    page_vms: {
      ...vm.page_vms,
      replay: {
        ...vm.page_vms.replay,
        merge_timeline: mergeTimeline,
        audit_logs: [
          ...(vm.page_vms.replay.audit_logs ?? []),
          {
            id: "76000000-0000-4000-8000-000000000231",
            actor: { actor_kind: "human", actor_user_id: "76000000-0000-4000-8000-000000000014" },
            entity: { entity_type: "proposal", entity_id: "76000000-0000-4000-8000-000000000012" },
            action: "proposal.merged",
            detail_json: {
              merge_strategy: "field_merge",
              merge_snapshot_id: "76000000-0000-4000-8000-000000000015",
              structured_field_count: 2,
              structured_field_changes: [
                {
                  field: "title",
                  valueType: "string",
                  baseValue: "旧标题",
                  beforeValue: "旧标题",
                  afterValue: "新标题",
                  mergeDecision: "fast_path"
                },
                {
                  field: "task_items",
                  valueType: "json_array",
                  baseValue: [{ id: "76000000-0000-4000-8000-000000000201", title: "原始任务项", item_type: "task" }],
                  beforeValue: [{ id: "76000000-0000-4000-8000-000000000201", title: "原始任务项", item_type: "task" }],
                  afterValue: [
                    { id: "76000000-0000-4000-8000-000000000201", title: "原始任务项", item_type: "task" },
                    { id: "76000000-0000-4000-8000-000000000202", title: "新增风险项", item_type: "risk" }
                  ],
                  mergeDecision: "fast_path",
                  itemCount: 2
                }
              ]
            },
            created_at: "2026-06-05T00:00:00.000Z"
          }
        ]
      }
    }
  };

  const zhReplay = renderGoldPathSurface(custom, "web").pages.find((page) => page.key === "replay");
  const enReplay = renderGoldPathSurface(custom, "web", { locale: "en-US" }).pages.find((page) => page.key === "replay");

  assert.equal(zhReplay?.html.includes("决策记录"), true);
  assert.equal(zhReplay?.html.includes("delivery:/outputs/result.md"), true);
  assert.equal(zhReplay?.html.includes("采纳这次版本"), true);
  assert.equal(zhReplay?.html.includes("AI 综合建议"), true);
  assert.equal(zhReplay?.html.includes("已选择"), true);
  assert.equal(zhReplay?.html.includes("data-replay-text-patch-preview=\"true\""), true);
  assert.equal(zhReplay?.html.includes("data-replay-text-diff3=\"true\""), true);
  assert.equal(zhReplay?.html.includes("data-text-diff3-option-key=\"ai_fusion\""), true);
  assert.equal(zhReplay?.html.includes("data-text-diff3-auto-merge=\"false\""), true);
  assert.equal(zhReplay?.html.includes("data-text-diff3-conflict-hunks=\"1\""), true);
  assert.equal(zhReplay?.html.includes("data-text-diff3-conflict-ranges=\"2\""), true);
  assert.equal(zhReplay?.html.includes("data-overlap-risk=\"requires_review\""), true);
  assert.equal(zhReplay?.html.includes("改动预览"), true);
  assert.equal(zhReplay?.html.includes("文本合并检查"), true);
  assert.equal(zhReplay?.html.includes("需逐项确认"), true);
  assert.equal(zhReplay?.html.includes("影响行: 第 2 行"), true);
  assert.equal(zhReplay?.html.includes("data-replay-structured-record-patch=\"true\""), true);
  assert.equal(zhReplay?.html.includes("data-structured-patch-option-key=\"ai_fusion\""), true);
  assert.equal(zhReplay?.html.includes("data-structured-patch-field-count=\"3\""), true);
  assert.equal(zhReplay?.html.includes("data-structured-patch-dry-run-status=\"blocked\""), true);
  assert.equal(zhReplay?.html.includes("data-structured-patch-dry-run-issues=\"3\""), true);
  assert.equal(zhReplay?.html.includes("结构化字段检查"), true);
  assert.equal(zhReplay?.html.includes("试运行检查: 已阻断"), true);
  assert.equal(zhReplay?.html.includes("字段改动详情"), true);
  assert.equal(zhReplay?.html.includes("字段保存记录"), true);
  assert.equal(zhReplay?.html.includes("data-replay-structured-field-operation=\"title\""), true);
  assert.equal(zhReplay?.html.includes("data-replay-structured-field-operation=\"task_items\""), true);
  assert.equal(zhReplay?.html.includes("data-replay-structured-field-audit=\"true\""), true);
  assert.equal(zhReplay?.html.includes("data-replay-structured-field-audit=\"task_items\""), true);
  assert.equal(zhReplay?.html.includes("写入: 新标题"), true);
  assert.equal(zhReplay?.html.includes("写入: 2 项: 原始任务项, 新增风险项"), true);
  assert.equal(zhReplay?.html.includes("将写入字段: title, due_at, extra_field"), true);
  assert.equal(zhReplay?.html.includes("缺少字段: acceptance_items"), true);
  assert.equal(zhReplay?.html.includes("额外字段: extra_field"), true);
  assert.equal(zhReplay?.html.includes("需要复核"), true);
  assert.equal(zhReplay?.html.includes("-正式版已有结论。"), true);
  assert.equal(zhReplay?.html.includes("+融合后的正文"), true);
  assert.equal(zhReplay?.html.includes("data-patch-line-kind=\"remove\""), true);
  assert.equal(zhReplay?.html.includes("data-patch-line-kind=\"add\""), true);
  assert.equal(enReplay?.html.includes("Decision record"), true);
  assert.equal(enReplay?.html.includes("Accept this version"), true);
  assert.equal(enReplay?.html.includes("AI fusion draft"), true);
  assert.equal(enReplay?.html.includes("Chosen"), true);
  assert.equal(enReplay?.html.includes("Change preview"), true);
  assert.equal(enReplay?.html.includes("Text merge check"), true);
  assert.equal(enReplay?.html.includes("Needs line review"), true);
  assert.equal(enReplay?.html.includes("Affected lines: line 2"), true);
  assert.equal(enReplay?.html.includes("Structured field check"), true);
  assert.equal(enReplay?.html.includes("Pre-check: Blocked"), true);
  assert.equal(enReplay?.html.includes("Field-level targets"), true);
  assert.equal(enReplay?.html.includes("Field writeback audit"), true);
  assert.equal(enReplay?.html.includes("After: 新标题"), true);
  assert.equal(enReplay?.html.includes("After: 2 items: 原始任务项, 新增风险项"), true);
  assert.equal(enReplay?.html.includes("Fields to write: title, due_at, extra_field"), true);
  assert.equal(enReplay?.html.includes("Missing fields: acceptance_items"), true);
  assert.equal(enReplay?.html.includes("Extra fields: extra_field"), true);
  assert.equal(enReplay?.html.includes("Review required"), true);
});

test("gold path cost page renders the K5 work-vs-self-improvement labor split when present (desktop parity)", () => {
  const base = surfaceVm();
  const vm = {
    ...base,
    page_vms: {
      ...base.page_vms,
      cost: { ...base.page_vms.cost, labor_split: { production_cost_cny: "0.8", self_improvement_cost_cny: "0.2", self_improvement_ratio: 0.2 } }
    }
  } as unknown as GoldPathSurfaceVM;
  const cost = renderGoldPathSurface(vm, "desktop").pages.find((page) => page.key === "cost");
  assert.ok(cost);
  assert.equal(cost.html.includes('data-r8-cost-labor-split="true"'), true);
  assert.equal(cost.html.includes('data-r8-cost-self-improvement-ratio="0.2"'), true);
  assert.equal(cost.html.includes("干活 vs 自进化"), true);
  assert.equal(cost.html.includes("自进化 ¥0.2（20%）"), true);

  // 无 labor_split 时不渲染该卡。
  const plain = renderGoldPathSurface(base as unknown as GoldPathSurfaceVM, "desktop").pages.find((page) => page.key === "cost");
  assert.equal(plain?.html.includes('data-r8-cost-labor-split="true"'), false);
});

test("gold path cost page formats CNY values and hides raw budget status", () => {
  const base = surfaceVm();
  const risk = base.page_vms.cost.top_exhaustion_risks[0];
  assert.ok(risk);
  const vm = {
    ...base,
    page_vms: {
      ...base.page_vms,
      cost: {
        ...base.page_vms.cost,
        total_cost_cny: "1.250000",
        labor_split: {
          production_cost_cny: "0.800000",
          self_improvement_cost_cny: "0.006",
          self_improvement_ratio: 0.2
        },
        notices: [{ ...base.page_vms.cost.notices[0]!, severity: "warning" }],
        top_exhaustion_risks: [{ ...risk, status: "warning" }]
      }
    }
  } as unknown as GoldPathSurfaceVM;

  const cost = renderGoldPathSurface(vm, "desktop", { locale: "zh-CN" }).pages.find((page) => page.key === "cost");

  assert.ok(cost);
  assert.equal(cost.html.includes("¥1.250000"), false);
  assert.equal(cost.html.includes("¥0.800000"), false);
  assert.equal(cost.html.includes("¥0.006"), false);
  assert.equal(cost.html.includes("<strong>warning</strong>"), false);
  assert.equal(cost.html.includes("<p class=\"wh-subtle\">warning</p>"), false);
  assert.equal(cost.html.includes("¥1.25"), true);
  assert.equal(cost.html.includes("干活 ¥0.8 · 自进化 ¥0.01"), true);
  assert.equal(cost.html.includes("<strong>接近上限</strong>"), true);
  assert.equal(cost.html.includes("<p class=\"wh-subtle\">接近上限</p>"), true);
});
