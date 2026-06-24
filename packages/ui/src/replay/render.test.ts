import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture } from "@workhub/agent/fixtures";
import type { ReplayTraceVM } from "@workhub/contracts";

import { renderAgentRunReplay } from "./render.js";

const workItemId = "76000000-0000-4000-8000-000000000101";
const proposalId = "76000000-0000-4000-8000-000000000102";
const baseTaskId = "76000000-0000-4000-8000-000000000103";
const newTaskId = "76000000-0000-4000-8000-000000000104";

function replayWithStructuredFields(): ReplayTraceVM {
  const fixture = createP05GoldPathFixture();
  return {
    ...fixture.replay,
    run: { ...fixture.replay.run, work_item_id: workItemId } as ReplayTraceVM["run"],
    merge_timeline: [
      {
        id: "76000000-0000-4000-8000-000000000111",
        proposal_id: proposalId,
        work_item_id: workItemId,
        branch_id: "76000000-0000-4000-8000-000000000112",
        actor_kind: "human",
        actor_user_id: "76000000-0000-4000-8000-000000000113",
        result: "merged",
        merge_snapshot_id: "76000000-0000-4000-8000-000000000114",
        conflict_count: 1,
        target_keys: ["work_item:task_items"],
        accepted_target_keys: ["work_item:task_items"],
        conflicts: [{ target_key: "work_item:task_items" }],
        text_hunk_decisions: [
          {
            hunk_index: 0,
            start_line: 3,
            end_line: 3,
            decision: "ai_fusion"
          },
          {
            hunk_index: 1,
            start_line: 8,
            end_line: 11,
            decision: "accept_incoming"
          }
        ],
        text_hunk_count: 2,
        text_hunk_output_sha256: "c".repeat(64),
        bulk_action: {
          action: "accept_incoming",
          target_keys: ["work_item:task_items", "delivery:/outputs/brief.md"],
          conflict_count: 2,
          result: "merged",
          accepted_incoming_target_keys: ["work_item:task_items"],
          resolved_conflict_target_keys: ["work_item:task_items"],
          blocked_target_keys: []
        },
        decisions: [
          {
            id: "76000000-0000-4000-8000-000000000115",
            conflict_key: "work_item:task_items",
            recommended_option_key: "ai_fusion",
            chosen_option_key: "ai_fusion",
            chosen_by_user_id: "76000000-0000-4000-8000-000000000113",
            chosen_at: "2026-06-05T00:00:00.000Z",
            candidates: [
              {
                option_key: "ai_fusion",
                target_kind: "structured_record",
                rationale_md: "把 AI 拆解的任务项写回最新 dispatch plan。",
                quality_gate: {
                  text_patch_preview: {
                    type: "unified_text_patch_preview",
                    base_available: true,
                    stats: {
                      changed: true,
                      added_lines: 1,
                      removed_lines: 1,
                      overlap_risk: "low"
                    },
                    hunks: [
                      {
                        header: "@@ -3 +3 @@",
                        lines: ["-旧标题", "+新标题"]
                      }
                    ]
                  },
                  text_diff3: {
                    type: "line_text_diff3",
                    auto_merge: false,
                    current_hunks: 1,
                    incoming_hunks: 1,
                    conflict_hunks: 1,
                    conflict_ranges: [{ start_line: 3, end_line: 3 }]
                  },
                  structured_record_patch: {
                    type: "structured_record_field_patch",
                    changed_fields: ["title", "task_items"],
                    merged_value_fields: ["title", "task_items"],
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
                        target_entity_id: workItemId,
                        source: "ai_fusion",
                        operations: [
                          {
                            op: "set",
                            target_entity_type: "work_item",
                            target_entity_id: workItemId,
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
                            target_entity_id: workItemId,
                            field: "task_items",
                            value_type: "json_array",
                            before_value: [
                              { id: baseTaskId, title: "原始任务项", item_type: "task", sort_order: 0 }
                            ],
                            current_value: [
                              { id: baseTaskId, title: "原始任务项", item_type: "task", sort_order: 0 }
                            ],
                            value: [
                              { id: baseTaskId, title: "原始任务项", item_type: "task", sort_order: 0 },
                              { id: newTaskId, title: "新增风险项", item_type: "risk", sort_order: 1 }
                            ],
                            source: "ai_fusion"
                          }
                        ]
                      },
                      issues: [],
                      audit_payload: {
                        target_entity_type: "work_item",
                        target_entity_id: workItemId,
                        field_count: 2,
                        operation_fields: ["title", "task_items"],
                        source: "ai_fusion"
                      }
                    }
                  }
                },
                recommended: true,
                chosen: true
              }
            ]
          }
        ],
        created_at: "2026-06-05T00:00:00.000Z"
      }
    ],
    audit_logs: [
      ...(fixture.replay.audit_logs ?? []),
      {
        id: "76000000-0000-4000-8000-000000000121",
        actor: { actor_kind: "human", actor_user_id: "76000000-0000-4000-8000-000000000113" },
        entity: { entity_type: "proposal", entity_id: proposalId },
        action: "proposal.merged",
        detail_json: {
          merge_strategy: "field_merge",
          merge_snapshot_id: "76000000-0000-4000-8000-000000000114",
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
              baseValue: [{ id: baseTaskId, title: "原始任务项", item_type: "task", sort_order: 0 }],
              beforeValue: [{ id: baseTaskId, title: "原始任务项", item_type: "task", sort_order: 0 }],
              afterValue: [
                { id: baseTaskId, title: "原始任务项", item_type: "task", sort_order: 0 },
                { id: newTaskId, title: "新增风险项", item_type: "risk", sort_order: 1 }
              ],
              mergeDecision: "fast_path",
              itemCount: 2
            }
          ]
        },
        created_at: "2026-06-05T00:00:00.000Z"
      }
    ]
  };
}

test("replay renderer exposes structured field operation targets and writeback audit", () => {
  const vm = replayWithStructuredFields();
  const zh = renderAgentRunReplay(vm, "web");
  const en = renderAgentRunReplay(vm, "desktop", { locale: "en-US" });

  assert.equal(zh.surface, "web");
  assert.equal(zh.stepCount, vm.steps.length);
  assert.equal(zh.mergeAttemptCount, 1);
  assert.equal(zh.structuredAuditCount, 1);
  assert.equal(zh.html.includes("字段改动详情"), true);
  assert.equal(zh.html.includes("data-replay-text-patch-preview=\"true\""), true);
  assert.equal(zh.html.includes("data-replay-text-patch-option-key=\"ai_fusion\""), true);
  assert.equal(zh.css.includes("overflow-wrap:anywhere"), true);
  assert.equal(zh.css.includes(".wh-row{flex-direction:column"), true);
  assert.equal(zh.html.includes("data-rich-patch-viewer=\"true\""), true);
  assert.equal(zh.html.includes("data-rich-patch-hunk-count=\"1\""), true);
  assert.equal(zh.html.includes("data-rich-patch-line-count=\"2\""), true);
  assert.equal(zh.html.includes("data-rich-patch-visible-line-count=\"2\""), true);
  assert.equal(zh.html.includes("data-rich-patch-folded-line-count=\"0\""), true);
  assert.equal(zh.html.includes("data-rich-patch-hunk-index=\"0\""), true);
  assert.equal(zh.html.includes("data-patch-old-line=\"3\""), true);
  assert.equal(zh.html.includes("data-patch-new-line=\"3\""), true);
  assert.equal(zh.html.includes("data-patch-line-kind=\"remove\""), true);
  assert.equal(zh.html.includes("data-patch-line-kind=\"add\""), true);
  assert.equal(zh.html.includes("改动预览"), true);
  assert.equal(zh.html.includes("段落: 1"), true);
  assert.equal(zh.html.includes("行数: 2"), true);
  assert.equal(zh.html.includes("data-replay-text-diff3=\"true\""), true);
  assert.equal(zh.html.includes("data-text-diff3-option-key=\"ai_fusion\""), true);
  assert.equal(zh.html.includes("data-overlap-hunk-review=\"true\""), true);
  assert.equal(zh.html.includes("data-overlap-hunk-index=\"0\""), true);
  assert.equal(zh.html.includes("data-overlap-hunk-start-line=\"3\""), true);
  assert.equal(zh.html.includes("data-overlap-hunk-end-line=\"3\""), true);
  assert.equal(zh.html.includes("data-overlap-hunk-decision=\"ai_fusion\""), true);
  assert.equal(zh.html.includes("text_hunk_overrides"), true);
  assert.equal(zh.html.includes("重叠段 1"), true);
  assert.equal(zh.html.includes("data-replay-text-hunk-decision-audit=\"true\""), true);
  assert.equal(zh.html.includes("data-replay-text-hunk-decision-count=\"2\""), true);
  assert.equal(zh.html.includes("data-replay-text-hunk-decision=\"1\""), true);
  assert.equal(zh.html.includes("data-replay-text-hunk-source=\"accept_incoming\""), true);
  assert.equal(zh.html.includes("逐段选择回放"), true);
  assert.equal(zh.html.includes("第 8-11 行"), true);
  assert.equal(zh.html.includes("采纳这次版本"), true);
  assert.equal(zh.html.includes("data-replay-bulk-action-audit=\"true\""), true);
  assert.equal(zh.html.includes("data-replay-bulk-action=\"accept_incoming\""), true);
  assert.equal(zh.html.includes("data-replay-bulk-result=\"merged\""), true);
  assert.equal(zh.html.includes("批量动作回放"), true);
  assert.equal(zh.html.includes("点击范围"), true);
  assert.equal(zh.html.includes("字段保存记录"), true);
  assert.equal(zh.html.includes("data-replay-structured-field-operation=\"title\""), true);
  assert.equal(zh.html.includes("data-replay-structured-field-operation=\"task_items\""), true);
  assert.equal(zh.html.includes("data-replay-subrecord-item-diff=\"true\""), true);
  assert.equal(zh.html.includes("data-replay-subrecord-field=\"task_items\""), true);
  assert.equal(zh.html.includes(`data-replay-subrecord-item="${newTaskId}"`), true);
  assert.equal(zh.html.includes("data-subrecord-diff-kind=\"added\""), true);
  assert.equal(zh.html.includes("子记录逐项变化"), true);
  assert.equal(zh.html.includes("新增风险项"), true);
  assert.equal(zh.html.includes("data-replay-structured-field-audit=\"true\""), true);
  assert.equal(zh.html.includes("data-replay-structured-field-audit=\"task_items\""), true);
  assert.equal(zh.html.includes("原始值: 旧标题"), true);
  assert.equal(zh.html.includes("写入: 新标题"), true);
  assert.equal(zh.html.includes("写入: 2 项: 原始任务项, 新增风险项"), true);
  assert.equal(zh.html.includes("策略: fast_path"), true);
  // 合并时间线：冲突定位读成「冲突位置: <key>」而非把内部 key 当标题裸渲；冲突数药丸带单位(单复数正确)。
  assert.equal(zh.html.includes("冲突位置: work_item:task_items"), true);
  assert.equal(zh.html.includes("1 处冲突"), true);
  assert.equal(zh.html.includes('data-replay-merge-conflict-count="1"'), true);
  assert.equal(en.html.includes("Conflict at: work_item:task_items"), true);
  assert.equal(en.html.includes("1 conflict<"), true);
  assert.equal(en.html.includes("1 conflicts"), false);
  assert.equal(en.html.includes("Field-level targets"), true);
  assert.equal(en.html.includes("Subrecord item changes"), true);
  assert.equal(en.html.includes("Added"), true);
  assert.equal(en.html.includes("Change preview"), true);
  assert.equal(en.html.includes("Hunks: 1"), true);
  assert.equal(en.html.includes("Lines: 2"), true);
  assert.equal(en.html.includes("Text merge check"), true);
  assert.equal(en.html.includes("Overlap hunk 1"), true);
  assert.equal(en.html.includes("Affected lines: line 3"), true);
  assert.equal(en.html.includes("Hunk decision replay"), true);
  assert.equal(en.html.includes("Lines 8-11"), true);
  assert.equal(en.html.includes("Accepted this version"), true);
  assert.equal(en.html.includes("Bulk action replay"), true);
  assert.equal(en.html.includes("Clicked scope"), true);
  assert.equal(en.html.includes("Field writeback audit"), true);
  assert.equal(en.html.includes("Base: 旧标题"), true);
  assert.equal(en.html.includes("After: 新标题"), true);
  assert.equal(en.html.includes("After: 2 items: 原始任务项, 新增风险项"), true);
  assert.equal(en.html.includes("Decision: fast_path"), true);

  // L23：web 回放给一条返回所属工作项的可见链接；桌面 Spotlight 用自己的面包屑返回，不渲染裸锚点。
  assert.equal(zh.html.includes(`data-replay-back-work-item="${workItemId}"`), true);
  assert.equal(zh.html.includes("返回任务"), true);
  assert.equal(zh.html.includes(`/workitems/${workItemId}`), true);
  assert.equal(en.html.includes("data-replay-back-work-item"), false);
  // L24：摘要卡用本地化的「Token 用量」而非裸 "Token"；校验码带人类标签 + 截断，不再糊整串 64 位哈希。
  assert.equal(zh.html.includes("Token 用量"), true);
  assert.equal(zh.html.includes("结果校验码"), true);
  assert.equal(zh.html.includes(`<p class="wh-replay-audit-code">${"c".repeat(64)}</p>`), false);
});
