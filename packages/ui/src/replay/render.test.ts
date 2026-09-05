import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture } from "@workhub/agent/fixtures";
import type { ReplayTraceVM } from "@workhub/contracts";

import {
  bindReplayRevertActions,
  decideSnapshotRevertConfirmation,
  renderAgentRunReplay,
  type ReplayRevertButton,
  type ReplayRevertClickEvent,
  type ReplayRevertRoot
} from "./render.js";

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

test("replay renderer hides hidden reasoning and raw tool payloads", () => {
  const vm = replayWithStructuredFields();
  vm.steps = [
    {
      ...vm.steps[0]!,
      phase: "think",
      output_excerpt: "Now I understand the task and will analyze hidden reasoning."
    },
    {
      ...vm.steps[1]!,
      phase: "tool_result",
      tool_name: "read_project_file",
      output_excerpt: "--- name: markdown-report description: raw tool payload"
    }
  ];

  const rendered = renderAgentRunReplay(vm, "web");

  assert.equal(rendered.html.includes("AI 正在整理材料，稍后给你下一步。"), true);
  assert.equal(rendered.html.includes("隐藏推理内容"), false);
  // R9.7 review: the old assertion expected a raw tool id in visible copy; replay
  // should show a public tool-result summary and keep `tool_name` internal.
  assert.equal(rendered.html.includes("工具已返回：read_project_file"), false);
  assert.equal(rendered.html.includes("工具已返回，AI 正在整理下一步。"), true);
  assert.equal(rendered.html.includes("Now I understand"), false);
  assert.equal(rendered.html.includes("markdown-report"), false);
});

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
  assert.equal(zh.html.includes("改动处: 1"), true);
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
  assert.equal(zh.html.includes("处理方式: 直接写入"), true);
  assert.equal(zh.html.includes("fast_path"), false);
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
  assert.equal(en.html.includes("Changes: 1"), true);
  assert.equal(en.html.includes("Lines: 2"), true);
  assert.equal(en.html.includes("Text merge check"), true);
  assert.equal(en.html.includes("Overlapping section 1"), true);
  assert.equal(en.html.includes("Affected lines: line 3"), true);
  assert.equal(en.html.includes("Section-by-section choices"), true);
  // 可见文案里不再有 hunk；data-* 标记属性（data-overlap-hunk-*）是机器钩子，不受此约束。
  assert.equal(/>[^<]*hunk/iu.test(en.html), false);
  assert.equal(en.html.includes("Lines 8-11"), true);
  assert.equal(en.html.includes("Accepted this version"), true);
  assert.equal(en.html.includes("Bulk action replay"), true);
  assert.equal(en.html.includes("Clicked scope"), true);
  assert.equal(en.html.includes("Field writeback audit"), true);
  assert.equal(en.html.includes("Base: 旧标题"), true);
  assert.equal(en.html.includes("After: 新标题"), true);
  assert.equal(en.html.includes("After: 2 items: 原始任务项, 新增风险项"), true);
  assert.equal(en.html.includes("Choice: Written directly"), true);
  assert.equal(en.html.includes("fast_path"), false);

  // L23：web 回放给一条返回所属工作项的可见链接；桌面 Spotlight 用自己的面包屑返回，不渲染裸锚点。
  assert.equal(zh.html.includes(`data-replay-back-work-item="${workItemId}"`), true);
  assert.equal(zh.html.includes("返回任务"), true);
  assert.equal(zh.html.includes(`/workitems/${workItemId}`), true);
  assert.equal(en.html.includes("data-replay-back-work-item"), false);
  // L24：摘要卡用本地化的「Token 用量」而非裸 "Token"。
  assert.equal(zh.html.includes("Token 用量"), true);
  // A2-49：结果指纹不再有任何可见文案，只留 data 属性供取证。
  assert.equal(zh.html.includes("结果校验码"), false);
  assert.equal(en.html.includes("Result checksum"), false);
  assert.equal(zh.html.includes(`data-replay-text-hunk-output-sha256="${"c".repeat(64)}"`), true);
  assert.equal(zh.html.includes(`>${"c".repeat(64)}<`), false);
});

// ── R20 DSK-UX（R19-3）：撤销改动按钮 ──────────────────────────────────────────────────────

function snapshot(overrides: Partial<ReplayTraceVM["snapshots"][number]> = {}): ReplayTraceVM["snapshots"][number] {
  return {
    id: "77000000-0000-4000-8000-000000000001",
    work_item_id: workItemId,
    kind: "pre_step",
    ref: "snapshots/csw-1/pre",
    created_by_kind: "ai",
    created_at: "2026-06-05T00:00:00.000Z",
    ...overrides
  };
}

test("replay renderer offers an undo-changes action on each un-reverted snapshot, desktop-gated", () => {
  const vm = replayWithStructuredFields();
  const runId = (vm.run as { id?: string }).id!;
  const firstSnapshotId = vm.snapshots[0]!.id;
  const rendered = renderAgentRunReplay(vm, "web");

  // 快照列表本身 + 本地化标题/桌面提示。
  assert.equal(rendered.html.includes('data-replay-snapshot-list="true"'), true);
  assert.equal(rendered.html.includes("改动还原点"), true);
  assert.equal(rendered.html.includes("要在桌面客户端做"), true);
  // 每颗按钮 = revert 动作 + 本地客户端门控（data-requires-desktop，对齐 R19-5 撤销策略）。
  assert.equal(rendered.html.includes('data-action-id="revert_agent_run"'), true);
  assert.equal(rendered.html.includes('data-requires-desktop="true"'), true);
  assert.equal(rendered.html.includes('data-method="POST"'), true);
  assert.equal(rendered.html.includes(`data-replay-revert-snapshot="${firstSnapshotId}"`), true);
  assert.equal(rendered.html.includes(`data-replay-revert-run="${runId}"`), true);
  assert.equal(rendered.html.includes(`href="/api/agent-runs/${runId}/revert"`), true);
  assert.equal(rendered.html.includes("撤销此次改动"), true);
  // 武装文案随按钮下发（binder 读 data-* 保持 locale 无关）。
  assert.equal(rendered.html.includes('data-revert-label-arm="确认撤销？再点一次"'), true);

  const en = renderAgentRunReplay(vm, "desktop", { locale: "en-US" });
  assert.equal(en.html.includes("Restore points"), true);
  assert.equal(en.html.includes("Undo these changes"), true);
  assert.equal(en.html.includes('data-requires-desktop="true"'), true);
});

test("replay renderer shows a reverted state (no button) for already-reverted snapshots", () => {
  const base = replayWithStructuredFields();
  const revertedId = "77000000-0000-4000-8000-0000000000aa";
  const liveId = "77000000-0000-4000-8000-0000000000bb";
  const vm: ReplayTraceVM = {
    ...base,
    snapshots: [
      snapshot({ id: revertedId, ref: "snapshots/csw-1/reverted", reverted_at: "2026-06-06T00:00:00.000Z" }),
      snapshot({ id: liveId, ref: "snapshots/csw-1/live" })
    ]
  };
  const rendered = renderAgentRunReplay(vm, "web");

  // 已回滚：显示「已回滚」态、不给按钮。
  assert.equal(rendered.html.includes('data-replay-snapshot-reverted="true"'), true);
  assert.equal(rendered.html.includes("已回滚"), true);
  assert.equal(rendered.html.includes(`data-replay-revert-snapshot="${revertedId}"`), false);
  // 未回滚：给按钮。
  assert.equal(rendered.html.includes(`data-replay-revert-snapshot="${liveId}"`), true);
});

test("replay renderer omits the snapshot list when there is no run id or no snapshots", () => {
  const base = replayWithStructuredFields();
  const noSnapshots: ReplayTraceVM = { ...base, snapshots: [] };
  assert.equal(renderAgentRunReplay(noSnapshots, "web").html.includes('data-replay-snapshot-list'), false);

  const noRunId: ReplayTraceVM = {
    ...base,
    run: { ...base.run, id: "" } as ReplayTraceVM["run"],
    snapshots: [snapshot()]
  };
  assert.equal(renderAgentRunReplay(noRunId, "web").html.includes('data-action-id="revert_agent_run"'), false);
});

// WIRE-07：中止执行入口只出现在进行中（queued/running）的 run 上；终态 run 一律不出按钮。
test("replay renderer offers an abort action only while the run is active", () => {
  const base = replayWithStructuredFields();
  const runId = (base.run as { id?: string }).id!;
  assert.ok(runId, "fixture run must carry an id");
  const withStatus = (status: string): ReplayTraceVM => ({
    ...base,
    run: { ...base.run, status } as ReplayTraceVM["run"]
  });

  for (const status of ["queued", "running"]) {
    const rendered = renderAgentRunReplay(withStatus(status), "web");
    assert.equal(rendered.html.includes('data-action-id="abort_agent_run"'), true, `${status} must offer abort`);
    assert.equal(rendered.html.includes(`href="/api/agent-runs/${runId}/abort"`), true);
    assert.equal(rendered.html.includes('data-method="POST"'), true);
    assert.equal(rendered.html.includes(`data-replay-abort-run="${runId}"`), true);
    assert.equal(rendered.html.includes("中止执行"), true);
  }
  for (const status of ["succeeded", "failed", "escalated", "cancelled"]) {
    const rendered = renderAgentRunReplay(withStatus(status), "web");
    assert.equal(rendered.html.includes('data-action-id="abort_agent_run"'), false, `${status} must not offer abort`);
  }
  // 桌面面同样渲染（按钮标记一致，由桌面壳的分发接）。
  const desktop = renderAgentRunReplay(withStatus("running"), "desktop", { locale: "en-US" });
  assert.equal(desktop.html.includes('data-action-id="abort_agent_run"'), true);
  assert.equal(desktop.html.includes("Abort run"), true);
});

test("decideSnapshotRevertConfirmation arms first, executes on the second click of the same snapshot", () => {
  assert.deepEqual(decideSnapshotRevertConfirmation(undefined, "snap-1"), { kind: "arm", snapshotId: "snap-1" });
  assert.deepEqual(decideSnapshotRevertConfirmation("snap-1", "snap-1"), { kind: "execute", snapshotId: "snap-1" });
  // 点了另一颗 → 重新武装那一颗（不执行上一颗）。
  assert.deepEqual(decideSnapshotRevertConfirmation("snap-1", "snap-2"), { kind: "arm", snapshotId: "snap-2" });
});

// ── binder 的假 DOM（无 jsdom；照 apps/web/avatar-crop-modal.test.ts 的最小替身先例）───────────
class FakeButton implements ReplayRevertButton {
  dataset: { [key: string]: string | undefined };
  textContent: string | null;
  attrs: Record<string, string> = {};
  private handlers: Array<(event: ReplayRevertClickEvent) => void> = [];
  constructor(dataset: Record<string, string>) {
    this.dataset = { ...dataset };
    this.textContent = dataset["revertLabelIdle"] ?? "撤销此次改动";
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  removeAttribute(name: string): void {
    delete this.attrs[name];
  }
  addEventListener(_type: string, handler: (event: ReplayRevertClickEvent) => void): void {
    this.handlers.push(handler);
  }
  click(): void {
    const event: ReplayRevertClickEvent = { preventDefault() {}, stopPropagation() {} };
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}

class FakeRoot implements ReplayRevertRoot {
  constructor(private readonly buttons: FakeButton[]) {}
  querySelectorAll(): Iterable<ReplayRevertButton> {
    return this.buttons;
  }
}

function revertButton(snapshotId: string, runId = "run-1"): FakeButton {
  return new FakeButton({
    replayRevertSnapshot: snapshotId,
    replayRevertRun: runId,
    revertLabelIdle: "撤销此次改动",
    revertLabelArm: "确认撤销？再点一次",
    revertLabelReverting: "撤销中…",
    revertLabelReverted: "已回滚",
    revertLabelRetry: "撤销失败，点此重试"
  });
}

test("bindReplayRevertActions arms on first click without calling revert, executes on the second", async () => {
  const button = revertButton("snap-1", "run-9");
  const calls: Array<{ runId: string; payload: { snapshot_id: string } }> = [];
  const reverted: Array<{ runId: string; snapshotId: string }> = [];
  let resolveRevert: () => void = () => {};
  bindReplayRevertActions(new FakeRoot([button]), {
    revert: (runId, payload) => {
      calls.push({ runId, payload });
      return new Promise<void>((resolve) => {
        resolveRevert = resolve;
      });
    },
    onReverted: (info) => reverted.push(info),
    setArmTimer: () => 0,
    clearArmTimer: () => {}
  });

  // 首点：只武装，不发请求。
  button.click();
  assert.equal(calls.length, 0);
  assert.equal(button.dataset["replayRevertArmed"], "true");
  assert.equal(button.textContent, "确认撤销？再点一次");

  // 再点：真调 revert（snapshot_id 走 body，run 走参数）。
  button.click();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { runId: "run-9", payload: { snapshot_id: "snap-1" } });
  assert.equal(button.textContent, "撤销中…");
  assert.equal(button.attrs["aria-disabled"], "true");

  // 成功：翻「已回滚」+ 触发刷新回调。
  resolveRevert();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(button.textContent, "已回滚");
  assert.deepEqual(reverted, [{ runId: "run-9", snapshotId: "snap-1" }]);
  assert.equal(button.dataset["replayRevertDone"], "true");
});

test("bindReplayRevertActions surfaces a retryable error when revert fails", async () => {
  const button = revertButton("snap-1");
  let attempts = 0;
  const reverted: Array<unknown> = [];
  bindReplayRevertActions(new FakeRoot([button]), {
    revert: () => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("boom")) : Promise.resolve();
    },
    onReverted: (info) => reverted.push(info),
    setArmTimer: () => 0,
    clearArmTimer: () => {}
  });

  button.click(); // arm
  button.click(); // execute → rejects
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(attempts, 1);
  assert.equal(reverted.length, 0);
  // 失败后可见错误文案 + 恢复可点（去掉禁用/忙态），且保持「武装」态——data-replay-revert-armed 仍在。
  assert.equal(button.textContent, "撤销失败，点此重试");
  assert.equal(button.attrs["aria-disabled"], undefined);
  assert.equal(button.dataset["replayRevertBusy"], undefined);
  assert.equal(button.dataset["replayRevertArmed"], "true");

  // C2（R21 审查）：重试只需单击——武装态没被清空，这一下直接命中 execute 真的重试，
  // 不必先重新武装一次白点一下。
  button.click(); // execute（复用失败前的武装）→ resolves
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(attempts, 2);
  assert.equal(button.textContent, "已回滚");
});

test("bindReplayRevertActions retries with a single click after failure, without re-arming first", async () => {
  const button = revertButton("snap-1");
  let attempts = 0;
  bindReplayRevertActions(new FakeRoot([button]), {
    revert: () => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("boom")) : Promise.resolve();
    },
    setArmTimer: () => 0,
    clearArmTimer: () => {}
  });

  button.click(); // arm
  button.click(); // execute → rejects
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(attempts, 1);
  assert.equal(button.textContent, "撤销失败，点此重试");

  // 单击一次即真重试（不是重新武装）。
  button.click();
  assert.equal(attempts, 2);
  assert.equal(button.textContent, "撤销中…");
});

test("bindReplayRevertActions falls back to the idle label if the post-failure arm window times out unclicked", async () => {
  const button = revertButton("snap-1");
  let attempts = 0;
  let armCallback: (() => void) | undefined;
  bindReplayRevertActions(new FakeRoot([button]), {
    revert: () => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("boom")) : Promise.resolve();
    },
    setArmTimer: (fn) => {
      armCallback = fn;
      return 1;
    },
    clearArmTimer: () => {}
  });

  button.click(); // arm
  button.click(); // execute → rejects
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(button.textContent, "撤销失败，点此重试");
  assert.equal(button.dataset["replayRevertArmed"], "true");

  // 超时未点：回落到 idle 文案，武装态解除——下一击重新走武装→执行两步。
  armCallback?.();
  assert.equal(button.textContent, "撤销此次改动");
  assert.equal(button.dataset["replayRevertArmed"], undefined);

  button.click(); // arm again（武装已解除）
  assert.equal(attempts, 1);
  assert.equal(button.textContent, "确认撤销？再点一次");
});

test("bindReplayRevertActions ignores buttons missing the snapshot or run id", () => {
  const orphan = new FakeButton({ replayRevertSnapshot: "snap-1" }); // 无 run
  const calls: number[] = [];
  bindReplayRevertActions(new FakeRoot([orphan]), {
    revert: () => {
      calls.push(1);
      return Promise.resolve();
    }
  });
  orphan.click();
  orphan.click();
  assert.equal(calls.length, 0);
});

// R26 批 B6 观测面：回放页也要看得见「重复动作被劝过几次、劝的是什么」。
test("B6: 回放时间线在被劝的那一步之后补一条人话提醒行（中英各一句）", () => {
  const base = replayWithStructuredFields();
  const stepNo = base.steps[0]?.step_no ?? 1;
  const vm: ReplayTraceVM = {
    ...base,
    reminders: [{ step_no: stepNo, tier: 2, repeats: 5, shape: "identical", tool_id: "read_project_file" }]
  };

  const zh = renderAgentRunReplay(vm, "web");
  assert.equal(zh.html.includes("第二次提醒：Cuu 连续 5 步做了同一件事"), true);
  assert.equal(zh.html.includes("「read project file」"), true);
  assert.equal(zh.html.includes("read_project_file"), false, "原始工具 id 不该渲给用户");
  assert.equal(zh.html.includes('data-replay-reminder-tier="2"'), true);
  // 步数统计只数模型的步，提醒行不冒充一步。
  assert.equal(zh.stepCount, vm.steps.length);

  const en = renderAgentRunReplay(vm, "desktop", { locale: "en-US" });
  assert.equal(en.html.includes("Second reminder: Cuu repeated the same action for 5 steps"), true);
});

test("B6: 回放页脏提醒整行不渲，对不上步骤的提醒补在末尾", () => {
  const base = replayWithStructuredFields();
  const vm: ReplayTraceVM = {
    ...base,
    reminders: [
      { step_no: 4242, tier: 1, repeats: 3, shape: "alternating", tool_id: "echo", tool_ids: ["echo", "run_command"] },
      { step_no: 1, repeats: 3, shape: "identical" },
      null
    ] as ReplayTraceVM["reminders"]
  };

  const rendered = renderAgentRunReplay(vm, "web");
  assert.equal(rendered.html.includes("第一次提醒：Cuu 连续 3 步在两个动作之间来回切换"), true);
  assert.equal(rendered.html.includes("「echo」、「run command」"), true);
  assert.equal(rendered.html.match(/data-replay-reminder-tier=/gu)?.length, 1, "只有合法的那一条被渲出来");
});

test("B6: 没有提醒的回放渲染完全不变（additive optional，存量响应零回归）", () => {
  const vm = replayWithStructuredFields();
  assert.equal(renderAgentRunReplay(vm, "web").html, renderAgentRunReplay({ ...vm, reminders: [] }, "web").html);
  assert.equal(renderAgentRunReplay(vm, "web").html.includes("data-replay-reminder-tier"), false);
});
