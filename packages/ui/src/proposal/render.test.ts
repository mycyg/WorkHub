import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture } from "@workhub/agent/fixtures";
import type { ProposalConflict } from "@workhub/contracts";

import { renderProposalDetail } from "./render.js";

test("proposal renderer keeps the change package shape visible", () => {
  const vm = createP05GoldPathFixture().proposalDetail;
  const rendered = renderProposalDetail(vm, "web");

  assert.equal(rendered.proposalId, vm.proposal_id);
  assert.equal(rendered.workItemId, vm.work_item_id);
  assert.equal(rendered.changeCount, vm.manifest.changes.length);
  assert.equal(rendered.evidenceCount, vm.evidence_refs.length);
  assert.equal(rendered.conflictCount, 0);
  assert.equal(rendered.cuuState, "carrying_document");
  assert.equal(rendered.html.includes("交付物变更申请"), true);
  assert.equal(rendered.css.includes(".wh-proposal"), true);
  assert.equal(rendered.css.includes("overflow-wrap:anywhere"), true);
  assert.equal(rendered.css.includes(".wh-row{flex-direction:column"), true);
  assert.equal(rendered.html.includes("这次改了什么"), true);
  assert.equal(rendered.html.includes("检查结果"), true);
  assert.equal(rendered.html.includes("回滚"), true);
  assert.equal(rendered.html.includes("data-requires-reason=\"true\""), true);
});

test("proposal renderer replaces model self-narration titles and shows the summary first", () => {
  const vm = structuredClone(createP05GoldPathFixture().proposalDetail);
  vm.title = "完成了。让我做一个人话总结。";
  vm.manifest.title = vm.title;
  const rendered = renderProposalDetail(vm, "desktop");

  assert.equal(rendered.title, "交付物变更申请");
  assert.equal(rendered.html.includes("<h1 class=\"wh-title\">交付物变更申请</h1>"), true);
  assert.equal(rendered.html.includes("data-proposal-summary=\"true\""), true);
  assert.equal(rendered.html.includes("<strong>总结</strong>"), true);
  assert.equal(rendered.html.includes("让我做一个人话总结"), false);
});

test("proposal renderer stays non-kanban and non-git while exposing deliverable kinds", () => {
  const vm = createP05GoldPathFixture().proposalDetail;
  const rendered = renderProposalDetail(vm, "desktop");

  assert.equal(rendered.surface, "desktop");
  assert.equal(rendered.html.includes("kanban"), false);
  assert.equal(rendered.html.includes("git"), false);
  assert.equal(rendered.html.includes("data-change-kind=\"text_doc\""), true);
  assert.equal(rendered.html.includes("data-action-id=\"approve\""), true);
  assert.equal(rendered.html.includes("data-action-id=\"request_changes\""), true);
});

test("proposal renderer hides review actions after a proposal is merged", () => {
  const vm = structuredClone(createP05GoldPathFixture().proposalDetail);
  vm.status = "merged";
  const rendered = renderProposalDetail(vm, "web", { locale: "en-US" });

  assert.equal(rendered.html.includes("data-action-id=\"approve\""), false);
  assert.equal(rendered.html.includes("data-action-id=\"request_changes\""), false);
  assert.equal(rendered.html.includes("data-action-id=\"merge\""), false);
});

test("proposal renderer localizes fixed labels and visible enum labels in English", () => {
  const vm = createP05GoldPathFixture().proposalDetail;
  const rendered = renderProposalDetail(vm, "web", { locale: "en-US" });

  assert.equal(rendered.html.includes("Deliverable change request"), true);
  assert.equal(rendered.html.includes("What changed"), true);
  assert.equal(rendered.html.includes("Check results"), true);
  assert.equal(rendered.html.includes("Text document"), true);
  assert.equal(rendered.html.includes("Generated"), true);
  assert.equal(rendered.html.includes("交付物变更申请"), false);
  assert.equal(rendered.html.includes("data-change-kind=\"text_doc\""), true);
});

test("proposal renderer exposes option-first conflict cards with merge payloads", () => {
  const vm = createP05GoldPathFixture().proposalDetail;
  const conflict: ProposalConflict = {
    id: "conflict-weekly-report",
    work_item_id: vm.work_item_id,
    proposal_id: vm.proposal_id,
    merge_proposal_id: "10000000-0000-4000-8000-000000000309",
    change_id: vm.manifest.changes[0]?.id ?? "change-1",
    target_key: "drive_item:docs/weekly-report.md",
    target_kind: "text_doc",
    change_type: "updated",
    target_path: "docs/weekly-report.md",
    headline: "weekly-report.md 已经被另一份变更更新",
    summary_text: "正式版和这次版本都改了同一个文档，先选保留正式版还是采纳这次版本。",
    existing: {
      proposal_id: "10000000-0000-4000-8000-000000000111",
      change_id: "10000000-0000-4000-8000-000000000112",
      sha256: "a".repeat(64)
    },
    incoming: {
      sha256_before: "b".repeat(64),
      sha256_after: "c".repeat(64)
    },
    recommended_option_id: "keep_current",
    options: [
      {
        id: "keep_current",
        label: "保留正式版",
        summary_text: "保留已正式采纳的版本。",
        recommended: true,
        action: {
          id: "keep_current",
          label: "保留正式版",
          method: "POST",
          href: `/api/proposals/${vm.proposal_id}/merge`,
          request_json: { conflict_resolution: { accept_incoming_target_keys: [] } }
        }
      },
      {
        id: "accept_incoming",
        label: "采纳这次版本",
        summary_text: "用这次版本覆盖正式版。",
        action: {
          id: "accept_incoming",
          label: "采纳这次版本",
          method: "POST",
          href: `/api/proposals/${vm.proposal_id}/merge`,
          request_json: {
            conflict_resolution: { accept_incoming_target_keys: ["drive_item:docs/weekly-report.md"] }
          }
        }
      },
      {
        id: "ai_fusion",
        label: "采用 AI 融合稿",
        summary_text: "AI 已生成融合稿，点击后写入正式交付物。",
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
                target_entity_id: vm.work_item_id,
                source: "ai_fusion",
                operations: [
                  {
                    op: "set",
                    target_entity_type: "work_item",
                    target_entity_id: vm.work_item_id,
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
                    target_entity_id: vm.work_item_id,
                    field: "task_items",
                    value_type: "json_array",
                    before_value: [
                      { id: "10000000-0000-4000-8000-000000000901", title: "原始任务项", item_type: "task" }
                    ],
                    current_value: [
                      { id: "10000000-0000-4000-8000-000000000901", title: "原始任务项", item_type: "task" }
                    ],
                    value: [
                      { id: "10000000-0000-4000-8000-000000000901", title: "原始任务项", item_type: "task" },
                      { id: "10000000-0000-4000-8000-000000000902", title: "新增风险项", item_type: "risk" }
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
                target_entity_id: vm.work_item_id,
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
          href: "/api/merge-proposals/10000000-0000-4000-8000-000000000309/apply",
          request_json: { confirm: true }
        }
      }
    ]
  };

  const rendered = renderProposalDetail(vm, "web", { conflicts: [conflict] });
  const english = renderProposalDetail(vm, "web", { locale: "en-US", conflicts: [conflict] });

  assert.equal(rendered.conflictCount, 1);
  assert.equal(rendered.html.includes("data-proposal-conflicts=\"1\""), true);
  assert.equal(rendered.html.includes("data-proposal-conflict-workbench=\"true\""), false);
  assert.equal(rendered.html.includes("data-conflict-option-id=\"keep_current\""), true);
  assert.equal(rendered.html.includes("data-conflict-option-id=\"accept_incoming\""), true);
  assert.equal(rendered.html.includes("data-conflict-option-id=\"ai_fusion\""), true);
  assert.equal(rendered.html.includes("采用 AI 融合稿"), true);
  assert.equal(rendered.html.includes("data-proposal-text-patch-preview=\"true\""), true);
  assert.equal(rendered.html.includes("data-rich-patch-viewer=\"true\""), true);
  assert.equal(rendered.html.includes("data-rich-patch-hunk-count=\"1\""), true);
  assert.equal(rendered.html.includes("data-rich-patch-line-count=\"2\""), true);
  assert.equal(rendered.html.includes("data-rich-patch-visible-line-count=\"2\""), true);
  assert.equal(rendered.html.includes("data-rich-patch-folded-line-count=\"0\""), true);
  assert.equal(rendered.html.includes("data-rich-patch-hunk-index=\"0\""), true);
  assert.equal(rendered.html.includes("data-patch-old-line=\"1\""), true);
  assert.equal(rendered.html.includes("data-patch-new-line=\"1\""), true);
  assert.equal(rendered.html.includes("data-text-diff3=\"true\""), true);
  assert.equal(rendered.html.includes("data-text-diff3-option-id=\"ai_fusion\""), true);
  assert.equal(rendered.html.includes("data-text-diff3-auto-merge=\"false\""), true);
  assert.equal(rendered.html.includes("data-text-diff3-conflict-hunks=\"1\""), true);
  assert.equal(rendered.html.includes("data-text-diff3-conflict-ranges=\"2\""), true);
  assert.equal(rendered.html.includes("data-overlap-hunk-review=\"true\""), true);
  assert.equal(rendered.html.includes("data-overlap-hunk-option-key=\"ai_fusion\""), true);
  assert.equal(rendered.html.includes("data-overlap-hunk-count=\"1\""), true);
  assert.equal(rendered.html.includes("data-overlap-hunk-index=\"0\""), true);
  assert.equal(rendered.html.includes("data-overlap-hunk-start-line=\"2\""), true);
  assert.equal(rendered.html.includes("data-overlap-hunk-end-line=\"2\""), true);
  assert.equal(rendered.html.includes("data-overlap-hunk-choice=\"true\""), true);
  assert.equal(rendered.html.includes("data-overlap-hunk-decision=\"keep_current\""), true);
  assert.equal(rendered.html.includes("data-overlap-hunk-decision=\"accept_incoming\""), true);
  assert.equal(rendered.html.includes("data-overlap-hunk-decision=\"ai_fusion\""), true);
  assert.equal(rendered.html.includes("data-route-line-editor=\"true\""), true);
  assert.equal(rendered.html.includes("data-route-line-editor-file-count=\"1\""), true);
  assert.equal(rendered.html.includes("data-route-line-editor-hunk-count=\"1\""), true);
  assert.equal(rendered.html.includes("data-route-line-editor-row-count=\"2\""), true);
  assert.equal(rendered.html.includes("data-line-editor-tab=\"drive_item:docs/weekly-report.md\""), true);
  assert.equal(rendered.html.includes("data-line-editor-search=\"true\""), true);
  assert.equal(rendered.html.includes("data-line-editor-row-kind=\"remove\""), true);
  assert.equal(rendered.html.includes("data-line-editor-row-kind=\"add\""), true);
  assert.equal(rendered.html.includes("data-line-editor-hunk-index=\"0\""), true);
  assert.equal(rendered.html.includes("data-line-editor-decision=\"ai_fusion\""), true);
  assert.equal(rendered.html.includes("data-line-editor-decision-selected=\"true\""), true);
  assert.equal(rendered.html.includes("data-line-editor-apply=\"true\""), true);
  assert.equal(rendered.html.includes("data-action-href=\"/api/merge-proposals/10000000-0000-4000-8000-000000000309/apply\""), true);
  assert.equal(rendered.html.includes("text_hunk_overrides"), true);
  assert.equal(rendered.html.includes("data-conflict-option-preview-for=\"ai_fusion\""), true);
  assert.equal(rendered.html.includes("data-overlap-risk=\"requires_review\""), true);
  assert.equal(rendered.html.includes("采用前预览"), true);
  assert.equal(rendered.html.includes("文本合并检查"), true);
  assert.equal(rendered.html.includes("需逐项确认"), true);
  assert.equal(rendered.html.includes("重叠段 1"), true);
  assert.equal(rendered.html.includes("逐行选择器"), true);
  assert.equal(rendered.html.includes("应用逐段选择"), true);
  assert.equal(rendered.html.includes("影响行: 第 2 行"), true);
  assert.equal(rendered.html.includes("data-structured-record-patch=\"true\""), true);
  assert.equal(rendered.html.includes("data-structured-patch-option-id=\"ai_fusion\""), true);
  assert.equal(rendered.html.includes("data-structured-patch-field-count=\"3\""), true);
  assert.equal(rendered.html.includes("data-structured-patch-dry-run-status=\"blocked\""), true);
  assert.equal(rendered.html.includes("data-structured-patch-dry-run-issues=\"3\""), true);
  assert.equal(rendered.html.includes("结构化字段检查"), true);
  assert.equal(rendered.html.includes("试运行检查: 已阻断"), true);
  assert.equal(rendered.html.includes("字段改动详情"), true);
  assert.equal(rendered.html.includes("data-proposal-structured-field-operation=\"title\""), true);
  assert.equal(rendered.html.includes("data-proposal-structured-field-operation=\"task_items\""), true);
  assert.equal(rendered.html.includes("原始值: 旧标题"), true);
  assert.equal(rendered.html.includes("写入: 新标题"), true);
  assert.equal(rendered.html.includes("写入: 2 项: 原始任务项, 新增风险项"), true);
  assert.equal(rendered.html.includes("将写入字段: title, due_at, extra_field"), true);
  assert.equal(rendered.html.includes("缺少字段: acceptance_items"), true);
  assert.equal(rendered.html.includes("额外字段: extra_field"), true);
  assert.equal(rendered.html.includes("需要复核"), true);
  assert.equal(rendered.html.includes("-正式版已有结论。"), true);
  assert.equal(rendered.html.includes("+融合后的正文"), true);
  assert.equal(rendered.html.includes("data-patch-line-kind=\"remove\""), true);
  assert.equal(rendered.html.includes("data-patch-line-kind=\"add\""), true);
  assert.equal(rendered.html.includes("/api/merge-proposals/10000000-0000-4000-8000-000000000309/apply"), true);
  assert.equal(rendered.html.includes("accept_incoming_target_keys"), true);
  assert.equal(rendered.actionHrefs.includes(`/api/proposals/${vm.proposal_id}/merge`), true);
  assert.equal(rendered.actionHrefs.includes("/api/merge-proposals/10000000-0000-4000-8000-000000000309/apply"), true);
  assert.equal(english.html.includes("Conflicting change detected"), true);
  assert.equal(english.html.includes("Keep current"), true);
  assert.equal(english.html.includes("Use this version"), true);
  assert.equal(english.html.includes("Use AI fusion draft"), true);
  assert.equal(english.html.includes("Preview before apply"), true);
  assert.equal(english.html.includes("Hunks: 1"), true);
  assert.equal(english.html.includes("Lines: 2"), true);
  assert.equal(english.html.includes("Text merge check"), true);
  assert.equal(english.html.includes("Needs line review"), true);
  assert.equal(english.html.includes("Overlap hunk 1"), true);
  assert.equal(english.html.includes("Line editor"), true);
  assert.equal(english.html.includes("Search lines"), true);
  assert.equal(english.html.includes("Apply line choices"), true);
  assert.equal(english.html.includes("Affected lines: line 2"), true);
  assert.equal(english.html.includes("Structured field check"), true);
  assert.equal(english.html.includes("Pre-check: Blocked"), true);
  assert.equal(english.html.includes("Field-level targets"), true);
  assert.equal(english.html.includes("Base: 旧标题"), true);
  assert.equal(english.html.includes("After: 新标题"), true);
  assert.equal(english.html.includes("After: 2 items: 原始任务项, 新增风险项"), true);
  assert.equal(english.html.includes("Fields to write: title, due_at, extra_field"), true);
  assert.equal(english.html.includes("Missing fields: acceptance_items"), true);
  assert.equal(english.html.includes("Extra fields: extra_field"), true);
  assert.equal(english.html.includes("Review required"), true);
});

test("proposal renderer exposes a folded bulk conflict review only for multiple conflicts", () => {
  const vm = createP05GoldPathFixture().proposalDetail;
  const mergeHref = `/api/proposals/${vm.proposal_id}/merge`;
  const createConflict = (input: {
    id: string;
    targetKey: string;
    targetPath: string;
    targetKind: string;
    recommended: "keep_current" | "accept_incoming";
  }): ProposalConflict => ({
    id: input.id,
    work_item_id: vm.work_item_id,
    proposal_id: vm.proposal_id,
    merge_proposal_id: "10000000-0000-4000-8000-000000000609",
    change_id: vm.manifest.changes[0]?.id ?? "change-1",
    target_key: input.targetKey,
    target_kind: input.targetKind,
    change_type: "updated",
    target_path: input.targetPath,
    headline: `${input.targetPath} 需要确认`,
    summary_text: "这项和正式版发生冲突，默认仍先处理最重要的一项。",
    existing: {
      proposal_id: "10000000-0000-4000-8000-000000000610",
      change_id: "10000000-0000-4000-8000-000000000611",
      ref: "main"
    },
    incoming: { ref: "proposal" },
    recommended_option_id: input.recommended,
    options: [
      {
        id: "keep_current",
        label: "保留正式版",
        summary_text: "不覆盖当前正式版本。",
        recommended: input.recommended === "keep_current",
        action: {
          id: "keep_current",
          label: "保留正式版",
          method: "POST",
          href: mergeHref,
          request_json: { confirm: true, conflict_resolution: { accept_incoming_target_keys: [] } }
        }
      },
      {
        id: "accept_incoming",
        label: "采纳这次版本",
        summary_text: "使用这次版本覆盖正式版本。",
        recommended: input.recommended === "accept_incoming",
        action: {
          id: "accept_incoming",
          label: "采纳这次版本",
          method: "POST",
          href: mergeHref,
          request_json: {
            confirm: true,
            conflict_resolution: { accept_incoming_target_keys: [input.targetKey] }
          }
        }
      }
    ]
  });
  const conflicts = [
    createConflict({
      id: "conflict-summary",
      targetKey: "drive_item:docs/summary.md",
      targetPath: "docs/summary.md",
      targetKind: "text_doc",
      recommended: "keep_current"
    }),
    createConflict({
      id: "conflict-plan",
      targetKey: `work_item:${vm.work_item_id}:task_items`,
      targetPath: "task_items",
      targetKind: "structured_record",
      recommended: "accept_incoming"
    })
  ];

  const rendered = renderProposalDetail(vm, "web", { conflicts });
  const english = renderProposalDetail(vm, "web", { locale: "en-US", conflicts });

  assert.equal(rendered.conflictCount, 2);
  assert.equal(rendered.html.includes("data-proposal-conflicts=\"2\""), true);
  assert.equal(rendered.html.includes("data-proposal-conflict-workbench=\"true\""), true);
  assert.equal(rendered.html.includes("data-proposal-conflict-workbench-count=\"2\""), true);
  assert.equal(rendered.html.includes("data-proposal-conflict-workbench-default=\"one_thing_first\""), true);
  assert.equal(rendered.html.includes("data-proposal-conflict-workbench-high-signal=\"true\""), true);
  assert.equal(rendered.html.includes("data-workbench-conflict-id=\"conflict-summary\""), true);
  assert.equal(rendered.html.includes("data-workbench-target-key=\"drive_item:docs/summary.md\""), true);
  assert.equal(rendered.html.includes(`data-workbench-target-key=\"work_item:${vm.work_item_id}:task_items\"`), true);
  assert.equal(rendered.html.includes("data-workbench-target-kind=\"structured_record\""), true);
  assert.equal(rendered.html.includes("data-workbench-recommended-option=\"keep_current\""), true);
  assert.equal(rendered.html.includes("data-workbench-recommended-option=\"accept_incoming\""), true);
  assert.equal(rendered.html.includes("批量冲突检查"), true);
  assert.equal(rendered.html.includes("默认仍是一件事优先"), true);
  assert.equal(rendered.html.includes("全部保留正式版"), true);
  assert.equal(rendered.html.includes("全部采纳这次版本"), true);
  assert.equal(rendered.html.includes("data-proposal-conflict-bulk-action=\"keep_current\""), true);
  assert.equal(rendered.html.includes("data-proposal-conflict-bulk-action=\"accept_incoming\""), true);
  assert.equal(rendered.html.includes("data-action-id=\"bulk_keep_current\""), true);
  assert.equal(rendered.html.includes("data-action-id=\"bulk_accept_incoming\""), true);
  assert.equal(rendered.html.includes("drive_item:docs/summary.md"), true);
  assert.equal(rendered.html.includes(`work_item:${vm.work_item_id}:task_items`), true);
  assert.equal(rendered.html.includes("accept_incoming_target_keys"), true);
  assert.equal(rendered.html.includes("bulk_action"), true);
  assert.equal(rendered.html.includes("&quot;action&quot;:&quot;keep_current&quot;"), true);
  assert.equal(rendered.html.includes("&quot;action&quot;:&quot;accept_incoming&quot;"), true);
  assert.equal(rendered.html.includes("&quot;conflict_count&quot;:2"), true);
  assert.equal(rendered.actionHrefs.includes(mergeHref), true);
  assert.equal(rendered.html.includes("kanban"), false);
  assert.equal(rendered.html.includes("git"), false);
  assert.equal(english.html.includes("Bulk conflict review"), true);
  assert.equal(english.html.includes("One thing first by default"), true);
  assert.equal(english.html.includes("Keep all current"), true);
  assert.equal(english.html.includes("Use all incoming"), true);
});

test("findings: conflicts whose ids collapse to the same safeId still get distinct line-editor panel ids", () => {
  const vm = createP05GoldPathFixture().proposalDetail;
  const mergeHref = `/api/proposals/${vm.proposal_id}/merge`;
  const lineEditorConflict = (id: string, targetKey: string, targetPath: string): ProposalConflict => ({
    id,
    work_item_id: vm.work_item_id,
    proposal_id: vm.proposal_id,
    merge_proposal_id: "10000000-0000-4000-8000-000000000709",
    change_id: vm.manifest.changes[0]?.id ?? "change-1",
    target_key: targetKey,
    target_kind: "text_doc",
    change_type: "updated",
    target_path: targetPath,
    headline: `${targetPath} 冲突`,
    summary_text: "正式版和这次版本都改了同一个文档。",
    existing: {
      proposal_id: "10000000-0000-4000-8000-000000000711",
      change_id: "10000000-0000-4000-8000-000000000712",
      sha256: "a".repeat(64)
    },
    incoming: { sha256_before: "b".repeat(64), sha256_after: "c".repeat(64) },
    recommended_option_id: "ai_fusion",
    options: [
      {
        id: "ai_fusion",
        label: "采用 AI 融合稿",
        summary_text: "AI 融合稿。",
        recommended: true,
        quality_gate: {
          text_diff3: {
            type: "line_text_diff3",
            auto_merge: false,
            current_hunks: 1,
            incoming_hunks: 1,
            conflict_hunks: 1,
            conflict_ranges: [{ start_line: 1, end_line: 1 }]
          }
        },
        action: {
          id: "ai_fusion",
          label: "采用 AI 融合稿",
          method: "POST",
          href: mergeHref,
          request_json: { conflict_resolution: { accept_incoming_target_keys: [targetKey] } }
        }
      }
    ]
  });
  // 两个 id 经 safeId（非字母数字 → '-'）都压成 "c-docs-a-md"——撞车。
  const conflicts = [
    lineEditorConflict("c:docs/a.md", "drive_item:docs/a.md", "docs/a.md"),
    lineEditorConflict("c:docs.a.md", "drive_item:docs/b.md", "docs/b.md")
  ];

  const rendered = renderProposalDetail(vm, "web", { conflicts });
  // 只取独立的 id="..." 属性（前导空白），避开 data-line-editor-panel-id="..." 这类引用属性。
  const panelIds = [...rendered.html.matchAll(/\sid="(line-editor-[^"]*)"/gu)].map((match) => match[1]);
  assert.equal(panelIds.length >= 2, true);
  // 修复前两个 panel/tab id 完全相同；修复后 render-local 序号前缀保证唯一。
  assert.equal(new Set(panelIds).size, panelIds.length);
});

test("proposal renderer folds large rich patch previews instead of turning conflict cards into a workbench", () => {
  const vm = createP05GoldPathFixture().proposalDetail;
  const lines = Array.from({ length: 90 }, (_, index) => index % 2 === 0 ? `-旧段落 ${index}` : `+新段落 ${index}`);
  const conflict: ProposalConflict = {
    id: "conflict-large-doc",
    work_item_id: vm.work_item_id,
    proposal_id: vm.proposal_id,
    merge_proposal_id: "10000000-0000-4000-8000-000000000509",
    change_id: vm.manifest.changes[0]?.id ?? "change-1",
    target_key: "drive_item:docs/large.md",
    target_kind: "text_doc",
    change_type: "updated",
    target_path: "docs/large.md",
    headline: "large.md 改动较多",
    summary_text: "只展示前 80 行，其余折叠，避免默认界面过重。",
    existing: {
      proposal_id: "10000000-0000-4000-8000-000000000510",
      change_id: "10000000-0000-4000-8000-000000000511",
      ref: "main"
    },
    incoming: { ref: "proposal" },
    recommended_option_id: "ai_fusion",
    options: [
      {
        id: "ai_fusion",
        label: "采用 AI 融合稿",
        summary_text: "AI 已生成融合稿。",
        quality_gate: {
          text_patch_preview: {
            type: "unified_text_patch_preview",
            base_available: true,
            stats: {
              changed: true,
              added_lines: 45,
              removed_lines: 45,
              overlap_risk: "low"
            },
            hunks: [{ header: "@@ -1,90 +1,90 @@", lines }]
          }
        }
      }
    ]
  };

  const rendered = renderProposalDetail(vm, "web", { conflicts: [conflict] });

  assert.equal(rendered.html.includes("data-rich-patch-line-count=\"90\""), true);
  assert.equal(rendered.html.includes("data-rich-patch-visible-line-count=\"80\""), true);
  assert.equal(rendered.html.includes("data-rich-patch-folded-line-count=\"10\""), true);
  assert.equal(rendered.html.includes("data-rich-patch-truncated=\"true\""), true);
  assert.equal(rendered.html.includes("data-rich-patch-overflow=\"true\""), true);
  assert.equal(rendered.html.includes("已折叠行: 10"), true);
  assert.equal(rendered.html.includes("新段落 89"), false);
});

test("findings: a whole hunk dropped past the line budget is counted as a folded hunk", () => {
  const vm = createP05GoldPathFixture().proposalDetail;
  const hunk1 = Array.from({ length: 80 }, (_, i) => i % 2 === 0 ? `-旧 ${i}` : `+新 ${i}`); // 正好吃满 80 行预算
  const hunk2 = Array.from({ length: 10 }, (_, i) => i % 2 === 0 ? `-尾旧 ${i}` : `+尾新 ${i}`); // 整段被折叠
  const conflict: ProposalConflict = {
    id: "conflict-two-hunks",
    work_item_id: vm.work_item_id,
    proposal_id: vm.proposal_id,
    merge_proposal_id: "10000000-0000-4000-8000-000000000609",
    change_id: vm.manifest.changes[0]?.id ?? "change-1",
    target_key: "drive_item:docs/two-hunks.md",
    target_kind: "text_doc",
    change_type: "updated",
    target_path: "docs/two-hunks.md",
    headline: "two-hunks.md 改动较多",
    summary_text: "第一段吃满预算，第二段整段折叠。",
    existing: {
      proposal_id: "10000000-0000-4000-8000-000000000610",
      change_id: "10000000-0000-4000-8000-000000000611",
      ref: "main"
    },
    incoming: { ref: "proposal" },
    recommended_option_id: "ai_fusion",
    options: [
      {
        id: "ai_fusion",
        label: "采用 AI 融合稿",
        summary_text: "AI 已生成融合稿。",
        quality_gate: {
          text_patch_preview: {
            type: "unified_text_patch_preview",
            base_available: true,
            stats: { changed: true, added_lines: 45, removed_lines: 45, overlap_risk: "low" },
            hunks: [
              { header: "@@ -1,80 +1,80 @@", lines: hunk1 },
              { header: "@@ -200,10 +200,10 @@", lines: hunk2 }
            ]
          }
        }
      }
    ]
  };

  const rendered = renderProposalDetail(vm, "web", { conflicts: [conflict] });
  assert.equal(rendered.html.includes("data-rich-patch-hunk-count=\"2\""), true);
  assert.equal(rendered.html.includes("data-rich-patch-folded-hunk-count=\"1\""), true);
  // 第一段渲染、第二段整段被丢（无 hunk-index="1"）。
  assert.equal(rendered.html.includes("data-rich-patch-hunk-index=\"0\""), true);
  assert.equal(rendered.html.includes("data-rich-patch-hunk-index=\"1\""), false);
  assert.equal(rendered.html.includes("已折叠段落: 1"), true);
});

test("proposal renderer exposes a folded field editor for ready structured patches", () => {
  const vm = createP05GoldPathFixture().proposalDetail;
  const applyHref = "/api/merge-proposals/10000000-0000-4000-8000-000000000409/apply";
  const conflict: ProposalConflict = {
    id: "conflict-work-item-fields",
    work_item_id: vm.work_item_id,
    proposal_id: vm.proposal_id,
    merge_proposal_id: "10000000-0000-4000-8000-000000000409",
    change_id: vm.manifest.changes[0]?.id ?? "change-1",
    target_key: `work_item:${vm.work_item_id}`,
    target_kind: "structured_record",
    change_type: "updated",
    headline: "事项字段需要确认",
    summary_text: "AI 更新了标题和优先级，可以直接采用或展开高级字段编辑。",
    existing: {
      proposal_id: "10000000-0000-4000-8000-000000000410",
      change_id: "10000000-0000-4000-8000-000000000411",
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
            changed_fields: ["title", "priority", "task_items"],
            merged_value_fields: ["title", "priority", "task_items"],
            missing_fields: [],
            unknown_fields: [],
            field_count: 3,
            has_structured_result: true,
            task_plan_scope: {
              selected_plan_id: "10000000-0000-4000-8000-000000000418",
              options: [
                {
                  id: "10000000-0000-4000-8000-000000000418",
                  label: "方案拆解计划",
                  stage: "dispatch",
                  status: "draft",
                  item_count: 1,
                  recommended: true
                },
                {
                  id: "10000000-0000-4000-8000-000000000419",
                  label: "执行计划",
                  stage: "worker",
                  status: "draft",
                  item_count: 3
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
                target_entity_id: vm.work_item_id,
                source: "ai_fusion",
                operations: [
                  {
                    op: "set",
                    target_entity_type: "work_item",
                    target_entity_id: vm.work_item_id,
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
                    target_entity_id: vm.work_item_id,
                    field: "priority",
                    value_type: "enum",
                    before_value: "normal",
                    current_value: "normal",
                    value: "high",
                    source: "ai_fusion"
                  },
                  {
                    op: "set",
                    target_entity_type: "work_item",
                    target_entity_id: vm.work_item_id,
                    field: "task_items",
                    value_type: "json_array",
                    before_value: [
                      { id: "10000000-0000-4000-8000-000000000412", title: "原始任务项", item_type: "task", sort_order: 0 }
                    ],
                    current_value: [
                      { id: "10000000-0000-4000-8000-000000000412", title: "原始任务项", item_type: "task", sort_order: 0 }
                    ],
                    value: [
                      { id: "10000000-0000-4000-8000-000000000412", title: "原始任务项", item_type: "task", sort_order: 0 },
                      { id: "10000000-0000-4000-8000-000000000413", title: "新增风险项", item_type: "risk", sort_order: 1 }
                    ],
                    source: "ai_fusion"
                  }
                ]
              },
              issues: [],
              audit_payload: {
                target_entity_type: "work_item",
                target_entity_id: vm.work_item_id,
                field_count: 3,
                operation_fields: ["title", "priority", "task_items"],
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

  const rendered = renderProposalDetail(vm, "web", { conflicts: [conflict] });
  const english = renderProposalDetail(vm, "web", { locale: "en-US", conflicts: [conflict] });

  assert.equal(rendered.html.includes("data-proposal-structured-field-editor=\"true\""), true);
  assert.equal(rendered.html.includes("data-proposal-structured-field-editor-count=\"3\""), true);
  assert.equal(rendered.html.includes("data-proposal-structured-field-editor-row=\"title\""), true);
  assert.equal(rendered.html.includes("data-proposal-structured-field-editor-row=\"priority\""), true);
  assert.equal(rendered.html.includes("data-proposal-subrecord-item-diff=\"true\""), true);
  assert.equal(rendered.html.includes("data-proposal-subrecord-field=\"task_items\""), true);
  assert.equal(rendered.html.includes("data-proposal-subrecord-item=\"10000000-0000-4000-8000-000000000413\""), true);
  assert.equal(rendered.html.includes("data-task-plan-scope=\"required\""), true);
  assert.equal(rendered.html.includes("data-task-plan-option-count=\"2\""), true);
  assert.equal(rendered.html.includes("先选目标计划"), true);
  assert.equal(rendered.html.includes("data-task-plan-id=\"10000000-0000-4000-8000-000000000418\""), true);
  assert.equal(rendered.html.includes("data-task-plan-id=\"10000000-0000-4000-8000-000000000419\""), true);
  assert.equal(rendered.html.includes("task_plan_scope"), true);
  assert.equal(rendered.html.includes("target_plan_id"), true);
  assert.equal(rendered.html.includes("data-subrecord-diff-kind=\"added\""), true);
  assert.equal(rendered.html.includes("data-subrecord-item-choice=\"true\""), true);
  assert.equal(rendered.html.includes("data-subrecord-decision=\"accept_incoming\""), true);
  assert.equal(rendered.html.includes("data-subrecord-decision=\"keep_current\""), true);
  assert.equal(rendered.html.includes("structured_item_overrides"), true);
  assert.equal(rendered.html.includes("高级子记录编辑"), true);
  assert.equal(rendered.html.includes("新增"), true);
  assert.equal(rendered.html.includes("采纳此项"), true);
  assert.equal(rendered.html.includes("保留当前项"), true);
  assert.equal(rendered.html.includes("高级字段编辑"), true);
  assert.equal(rendered.html.includes("只采用此字段"), true);
  assert.equal(rendered.html.includes("保留当前字段"), true);
  assert.equal(rendered.html.includes("使用自定义值"), true);
  assert.equal(rendered.html.includes("data-field-editor-action=\"accept_only\""), true);
  assert.equal(rendered.html.includes("data-field-editor-action=\"keep_current\""), true);
  assert.equal(rendered.html.includes("data-field-editor-action=\"custom\""), true);
  assert.equal(rendered.html.includes("structured_field_overrides"), true);
  assert.equal(rendered.html.includes("keep_current"), true);
  assert.equal(rendered.html.includes("__WORKHUB_CUSTOM_FIELD_VALUE__"), true);
  assert.equal(rendered.html.includes(applyHref), true);
  assert.equal(english.html.includes("Advanced item editor"), true);
  assert.equal(english.html.includes("Choose target plan first"), true);
  assert.equal(english.html.includes("Added"), true);
  assert.equal(english.html.includes("Use this item"), true);
  assert.equal(english.html.includes("Keep current item"), true);
  assert.equal(english.html.includes("Advanced field editor"), true);
  assert.equal(english.html.includes("Use this field only"), true);
  assert.equal(english.html.includes("Keep current field"), true);
  assert.equal(english.html.includes("Use custom value"), true);
});
