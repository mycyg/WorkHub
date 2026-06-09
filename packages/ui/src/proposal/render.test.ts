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
  assert.equal(rendered.html.includes("这次改了什么"), true);
  assert.equal(rendered.html.includes("检查结果"), true);
  assert.equal(rendered.html.includes("回滚"), true);
  assert.equal(rendered.html.includes("data-requires-reason=\"true\""), true);
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
  assert.equal(rendered.html.includes("data-conflict-option-id=\"keep_current\""), true);
  assert.equal(rendered.html.includes("data-conflict-option-id=\"accept_incoming\""), true);
  assert.equal(rendered.html.includes("data-conflict-option-id=\"ai_fusion\""), true);
  assert.equal(rendered.html.includes("采用 AI 融合稿"), true);
  assert.equal(rendered.html.includes("data-proposal-text-patch-preview=\"true\""), true);
  assert.equal(rendered.html.includes("data-text-diff3=\"true\""), true);
  assert.equal(rendered.html.includes("data-text-diff3-option-id=\"ai_fusion\""), true);
  assert.equal(rendered.html.includes("data-text-diff3-auto-merge=\"false\""), true);
  assert.equal(rendered.html.includes("data-text-diff3-conflict-hunks=\"1\""), true);
  assert.equal(rendered.html.includes("data-text-diff3-conflict-ranges=\"2\""), true);
  assert.equal(rendered.html.includes("data-conflict-option-preview-for=\"ai_fusion\""), true);
  assert.equal(rendered.html.includes("data-overlap-risk=\"requires_review\""), true);
  assert.equal(rendered.html.includes("采用前预览"), true);
  assert.equal(rendered.html.includes("文本合并检查"), true);
  assert.equal(rendered.html.includes("需逐项确认"), true);
  assert.equal(rendered.html.includes("影响行: 第 2 行"), true);
  assert.equal(rendered.html.includes("data-structured-record-patch=\"true\""), true);
  assert.equal(rendered.html.includes("data-structured-patch-option-id=\"ai_fusion\""), true);
  assert.equal(rendered.html.includes("data-structured-patch-field-count=\"3\""), true);
  assert.equal(rendered.html.includes("data-structured-patch-dry-run-status=\"blocked\""), true);
  assert.equal(rendered.html.includes("data-structured-patch-dry-run-issues=\"3\""), true);
  assert.equal(rendered.html.includes("结构化字段检查"), true);
  assert.equal(rendered.html.includes("Dry-run: 已阻断"), true);
  assert.equal(rendered.html.includes("字段级落点"), true);
  assert.equal(rendered.html.includes("data-proposal-structured-field-operation=\"title\""), true);
  assert.equal(rendered.html.includes("data-proposal-structured-field-operation=\"task_items\""), true);
  assert.equal(rendered.html.includes("基线: 旧标题"), true);
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
  assert.equal(english.html.includes("Text merge check"), true);
  assert.equal(english.html.includes("Needs line review"), true);
  assert.equal(english.html.includes("Affected lines: line 2"), true);
  assert.equal(english.html.includes("Structured field check"), true);
  assert.equal(english.html.includes("Dry-run: Blocked"), true);
  assert.equal(english.html.includes("Field-level targets"), true);
  assert.equal(english.html.includes("Base: 旧标题"), true);
  assert.equal(english.html.includes("After: 新标题"), true);
  assert.equal(english.html.includes("After: 2 items: 原始任务项, 新增风险项"), true);
  assert.equal(english.html.includes("Fields to write: title, due_at, extra_field"), true);
  assert.equal(english.html.includes("Missing fields: acceptance_items"), true);
  assert.equal(english.html.includes("Extra fields: extra_field"), true);
  assert.equal(english.html.includes("Review required"), true);
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
            changed_fields: ["title", "priority"],
            merged_value_fields: ["title", "priority"],
            missing_fields: [],
            unknown_fields: [],
            field_count: 2,
            has_structured_result: true,
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
                  }
                ]
              },
              issues: [],
              audit_payload: {
                target_entity_type: "work_item",
                target_entity_id: vm.work_item_id,
                field_count: 2,
                operation_fields: ["title", "priority"],
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
  assert.equal(rendered.html.includes("data-proposal-structured-field-editor-count=\"2\""), true);
  assert.equal(rendered.html.includes("data-proposal-structured-field-editor-row=\"title\""), true);
  assert.equal(rendered.html.includes("data-proposal-structured-field-editor-row=\"priority\""), true);
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
  assert.equal(english.html.includes("Advanced field editor"), true);
  assert.equal(english.html.includes("Use this field only"), true);
  assert.equal(english.html.includes("Keep current field"), true);
  assert.equal(english.html.includes("Use custom value"), true);
});
