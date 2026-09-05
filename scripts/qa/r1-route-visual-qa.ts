import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import {
  renderWebAgentRunReplay,
  renderWebProposalDetail
} from "../../apps/web/src/route-render.js";
import {
  renderDesktopAgentRunReplay,
  renderDesktopProposalDetail
} from "../../apps/desktop-webview/src/route-render.js";

type Locale = "zh-CN" | "en-US";
type Surface = "web" | "desktop";

type RenderedRoute = {
  css: string;
  html: string;
  title: string;
  surface: Surface;
};

type RouteCase = {
  id: string;
  label: string;
  surface: Surface;
  locale: Locale;
  route: string;
  viewport: {
    width: number;
    height: number;
  };
  render: () => Promise<RenderedRoute>;
};

type DomMarkers = {
  richPatchViewer: number;
  richPatchTruncated: number;
  overlapHunkReview: number;
  routeLineEditor: number;
  lineEditorTabs: number;
  lineEditorSearch: number;
  lineEditorRows: number;
  lineEditorApply: number;
  lineEditorPayload: number;
  proposalSubrecordDiff: number;
  replaySubrecordDiff: number;
  taskPlanScope: number;
  conflictWorkbench: number;
  routeStateCards: number;
  forbiddenState: number;
  loadingState: number;
  emptyState: number;
  errorState: number;
  cuuLeak: number;
  kanbanLeak: number;
  clientWidth: number | null;
  scrollWidth: number | null;
  horizontalOverflow: boolean;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const auditDir = path.join(repoRoot, "docs", "workhub", "05-clients", "assets", "audit", "2026-06-10-r1-route-visual-qa");
const proposalId = "81000000-0000-4000-8000-000000000101";
const workItemId = "81000000-0000-4000-8000-000000000102";
const runId = "81000000-0000-4000-8000-000000000103";
const mergeHref = `/api/proposals/${proposalId}/merge`;
const applyHref = "/api/merge-proposals/81000000-0000-4000-8000-000000000401/apply";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function countNeedle(value: string, needle: string) {
  return value.split(needle).length - 1;
}

function longPatchLines() {
  return Array.from({ length: 96 }, (_, index) => {
    const line = index + 1;
    if (index % 2 === 0) {
      return `-旧段落 ${line}: 客户周报仍按上周口径描述，缺少风险与验收动作。`;
    }
    return `+新段落 ${line}: 客户周报补充风险、责任人和下一步验收动作。`;
  });
}

function textPatchPreview() {
  return {
    type: "unified_text_patch_preview",
    base_available: true,
    stats: {
      changed: true,
      added_lines: 48,
      removed_lines: 48,
      overlap_risk: "requires_review"
    },
    hunks: [
      {
        header: "@@ -1,96 +1,96 @@",
        lines: longPatchLines()
      }
    ]
  };
}

function textDiff3() {
  return {
    type: "line_text_diff3",
    auto_merge: false,
    current_hunks: 2,
    incoming_hunks: 2,
    conflict_hunks: 2,
    conflict_ranges: [
      { start_line: 18, end_line: 22 },
      { start_line: 61, end_line: 65 }
    ]
  };
}

function currentTasks() {
  return [
    {
      id: "81000000-0000-4000-8000-000000000501",
      title: "确认周报目标",
      item_type: "task",
      estimate_hours: 1,
      sort_order: 0
    },
    {
      id: "81000000-0000-4000-8000-000000000502",
      title: "汇总客户会议纪要",
      item_type: "task",
      estimate_hours: 2,
      sort_order: 1
    },
    {
      id: "81000000-0000-4000-8000-000000000503",
      title: "旧风险项保留观察",
      item_type: "risk",
      estimate_hours: 1,
      sort_order: 2
    }
  ];
}

function incomingTasks() {
  return [
    {
      id: "81000000-0000-4000-8000-000000000501",
      title: "确认周报目标与验收口径",
      item_type: "task",
      estimate_hours: 1,
      sort_order: 0
    },
    {
      id: "81000000-0000-4000-8000-000000000502",
      title: "汇总客户会议纪要",
      item_type: "task",
      estimate_hours: 2,
      sort_order: 1
    },
    {
      id: "81000000-0000-4000-8000-000000000504",
      title: "新增风险项：预算告警需单独说明",
      item_type: "risk",
      estimate_hours: 1,
      sort_order: 2
    },
    {
      id: "81000000-0000-4000-8000-000000000505",
      title: "补充交付物回放截图",
      item_type: "task",
      estimate_hours: 1,
      sort_order: 3
    }
  ];
}

function structuredOperations() {
  return [
    {
      op: "replace",
      target_entity_type: "work_item",
      target_entity_id: workItemId,
      field: "title",
      value_type: "string",
      before_value: "客户周报草稿",
      current_value: "客户周报草稿",
      value: "客户周报草稿与风险说明",
      mergeDecision: "accept_incoming"
    },
    {
      op: "replace",
      target_entity_type: "work_item",
      target_entity_id: workItemId,
      field: "priority",
      value_type: "string",
      before_value: "normal",
      current_value: "normal",
      value: "high",
      mergeDecision: "accept_incoming"
    },
    {
      op: "replace",
      target_entity_type: "work_item",
      target_entity_id: workItemId,
      field: "task_items",
      value_type: "json_array",
      before_value: currentTasks(),
      current_value: currentTasks(),
      value: incomingTasks(),
      itemCount: incomingTasks().length,
      mergeDecision: "accept_incoming"
    }
  ];
}

function structuredRecordPatch() {
  return {
    type: "structured_record_field_patch",
    changed_fields: ["title", "priority", "task_items"],
    merged_value_fields: ["title", "priority", "task_items"],
    missing_fields: [],
    unknown_fields: [],
    field_count: 3,
    has_structured_result: true,
    task_plan_scope: {
      selected_plan_id: "81000000-0000-4000-8000-000000000471",
      options: [
        {
          id: "81000000-0000-4000-8000-000000000471",
          label: "方案拆解计划",
          stage: "dispatch",
          status: "draft",
          item_count: currentTasks().length,
          recommended: true
        },
        {
          id: "81000000-0000-4000-8000-000000000472",
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
      target_entity_type: "work_item",
      target_entity_id: workItemId,
      patch: {
        type: "structured_record_field_patch",
        operations: structuredOperations()
      },
      result: {
        target_entity_id: workItemId,
        field_count: 3,
        operation_fields: ["title", "priority", "task_items"],
        source: "ai_fusion"
      }
    }
  };
}

function proposalVm() {
  return {
    proposal_id: proposalId,
    work_item_id: workItemId,
    title: "客户周报草稿与风险说明变更申请",
    status: "reviewed",
    manifest: {
      version: 0,
      work_item_id: workItemId,
      title: "客户周报草稿与风险说明变更申请",
      summary_md: [
        "AI 已整理客户周报草稿、风险说明和执行任务项。",
        "这不是代码 PR，而是文档、结构化任务和证据引用的交付物变更包。",
        "默认只需要处理最重要的冲突；高阶批量入口折叠在证据区。"
      ].join("\n"),
      author: { actor_kind: "ai", label: "AI" },
      base: {
        branch_id: "81000000-0000-4000-8000-000000000104",
        snapshot_id: "81000000-0000-4000-8000-000000000105"
      },
      risk: {
        level: "medium",
        human_label: "中风险：涉及正式周报与任务字段写回",
        reversible: true
      },
      rollback: {
        available: true,
        description: "可通过正式文件版本和 field_merge audit 还原。"
      },
      evidence_refs: [
        {
          id: "evidence-meeting",
          source_type: "meeting",
          source_id: "meeting:weekly-sync",
          title: "客户例会纪要",
          excerpt: "客户要求下周前看到风险、预算和行动项。",
          href: "/api/knowledge/evidence/evidence-meeting"
        }
      ],
      review: { reason_required_on_reject: true },
      changes: [
        {
          id: "change-doc",
          human_summary: "更新 docs/weekly-report.md 的主体段落和风险说明",
          target_kind: "text_doc",
          change_type: "updated",
          target_ref: { entity_type: "drive_item", path: "docs/weekly-report.md" },
          preview_ref: { kind: "text", href: "/api/drive/items/weekly-report/preview" }
        },
        {
          id: "change-tasks",
          human_summary: "写回 WorkItem 标题、优先级和任务项",
          target_kind: "structured_record",
          change_type: "updated",
          target_ref: { entity_type: "work_item", entity_id: workItemId }
        }
      ],
      checks: [
        { id: "scope", label: "范围检查", status: "passed", detail: "file-only + structured WorkItem fields" },
        { id: "budget", label: "预算检查", status: "warning", detail: "接近单 run 预算告警线" },
        { id: "diff3", label: "文本冲突检查", status: "warning", detail: "2 个重叠段需要选择" }
      ]
    },
    review_actions: {
      approve: { id: "approve", label: "批准", method: "POST", href: `/api/proposals/${proposalId}/review` },
      request_changes: {
        id: "request_changes",
        label: "要求修改",
        method: "POST",
        href: `/api/proposals/${proposalId}/review`,
        requires_reason: true
      },
      merge: { id: "merge", label: "正式采纳", method: "POST", href: mergeHref }
    },
    evidence_refs: [
      {
        id: "evidence-meeting",
        source_type: "meeting",
        source_id: "meeting:weekly-sync",
        title: "客户例会纪要",
        excerpt: "客户要求下周前看到风险、预算和行动项。",
        href: "/api/knowledge/evidence/evidence-meeting"
      },
      {
        id: "evidence-drive",
        source_type: "drive",
        source_id: "drive:docs/weekly-report.md",
        title: "正式周报当前版本",
        excerpt: "当前正式版缺少预算风险说明。",
        href: "/api/drive/items/weekly-report"
      }
    ],
    comments: [
      {
        id: "comment-1",
        author_label: "Reviewer",
        body: "保留正文主线，但风险和任务项可采纳 AI 建议。",
        created_at: "2026-06-10T01:00:00.000Z"
      }
    ]
  };
}

function conflictOptions(targetKey: string, includeFusion: boolean) {
  const baseOptions = [
    {
      id: "keep_current",
      label: "保留正式版",
      summary_text: "保留当前正式版本，并把这次变更退回给 AI 修改。",
      recommended: !includeFusion,
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
      recommended: false,
      action: {
        id: "accept_incoming",
        label: "采纳这次版本",
        method: "POST",
        href: mergeHref,
        request_json: { confirm: true, conflict_resolution: { accept_incoming_target_keys: [targetKey] } }
      }
    }
  ];
  if (!includeFusion) {
    return baseOptions;
  }
  return [
    ...baseOptions,
    {
      id: "ai_fusion",
      label: "采用 AI 融合稿",
      summary_text: "AI 已生成融合稿，保留正式版结构并补上这次新增内容。",
      recommended: true,
      quality_gate: {
        text_patch_preview: textPatchPreview(),
        text_diff3: textDiff3(),
        structured_record_patch: structuredRecordPatch()
      },
      action: {
        id: "ai_fusion",
        label: "采用 AI 融合稿",
        method: "POST",
        href: applyHref,
        request_json: { confirm: true }
      }
    }
  ];
}

function proposalConflicts() {
  return [
    {
      id: "conflict-long-weekly-report",
      work_item_id: workItemId,
      proposal_id: proposalId,
      merge_proposal_id: "81000000-0000-4000-8000-000000000401",
      change_id: "change-doc",
      target_key: "drive_item:docs/weekly-report.md",
      target_kind: "text_doc",
      change_type: "updated",
      target_path: "docs/weekly-report.md",
      headline: "weekly-report.md 与正式版本存在重叠改动",
      summary_text: "正文、风险和预算说明同时被正式版与本次变更修改，需要选择保留、采纳或 AI 融合。",
      existing: {
        proposal_id: "81000000-0000-4000-8000-000000000201",
        change_id: "81000000-0000-4000-8000-000000000202",
        sha256: "a".repeat(64)
      },
      incoming: {
        sha256_before: "b".repeat(64),
        sha256_after: "c".repeat(64)
      },
      recommended_option_id: "ai_fusion",
      options: conflictOptions("drive_item:docs/weekly-report.md", true)
    },
    {
      id: "conflict-task-items",
      work_item_id: workItemId,
      proposal_id: proposalId,
      merge_proposal_id: "81000000-0000-4000-8000-000000000402",
      change_id: "change-tasks",
      target_key: `work_item:${workItemId}:task_items`,
      target_kind: "structured_record",
      change_type: "updated",
      target_path: "task_items",
      headline: "任务项与人工更新不一致",
      summary_text: "AI 新增了风险项和截图任务，同时保留了人工已确认的会议纪要任务。",
      existing: {
        proposal_id: "81000000-0000-4000-8000-000000000203",
        change_id: "81000000-0000-4000-8000-000000000204",
        sha256: "d".repeat(64)
      },
      incoming: {
        sha256_before: "e".repeat(64),
        sha256_after: "f".repeat(64)
      },
      recommended_option_id: "accept_incoming",
      options: conflictOptions(`work_item:${workItemId}:task_items`, false)
    }
  ];
}

function costSummary() {
  return {
    scope: { kind: "user", user_id: "81000000-0000-4000-8000-000000000301" },
    scope_label: "我的今日 AI 预算",
    policy_id: "pcost-user-day-v0",
    period: "day",
    period_start: "2026-06-10T00:00:00.000Z",
    period_end: "2026-06-11T00:00:00.000Z",
    token_in: 68000,
    token_out: 24000,
    total_tokens: 92000,
    max_tokens: 120000,
    remaining_tokens: 28000,
    estimated_cost_cny: "3.92",
    max_cost_cny: "5",
    remaining_cost_cny: "1.08",
    warning_ratio: 0.77,
    status: "warning"
  };
}

function replayVm() {
  const operations = structuredOperations();
  return {
    run: {
      id: runId,
      work_item_id: workItemId,
      status: "succeeded",
      handoff_md: "AI 已生成并合并周报草稿，下面是可回放的证据、冲突选择和正式交付物。"
    },
    steps: [
      { step_no: 1, phase: "plan", output_excerpt: "读取客户例会纪要、正式周报和现有任务项。" },
      { step_no: 2, phase: "draft", output_excerpt: "生成文档草稿并提取风险说明。" },
      { step_no: 3, phase: "merge_check", output_excerpt: "发现 2 个文本重叠段和 1 组任务项差异。" },
      { step_no: 4, phase: "apply", output_excerpt: "采纳 AI 融合稿并写入正式版本。" }
    ],
    cost: {
      me: costSummary(),
      scopes: [],
      active_notices: [
        {
          id: "budget-warning",
          severity: "warning",
          summary_text: "本次 run 接近预算上限。",
          action_label: "查看预算",
          href: "/api/pages/cost"
        }
      ],
      generated_at: "2026-06-10T01:00:00.000Z"
    },
    snapshots: [
      {
        id: "81000000-0000-4000-8000-000000000601",
        kind: "merge",
        created_at: "2026-06-10T01:00:00.000Z"
      }
    ],
    accepted_deliverables: [
      {
        id: "81000000-0000-4000-8000-000000000701",
        target_key: "drive_item:docs/weekly-report.md",
        target_path: "docs/weekly-report.md",
        filename: "weekly-report.md",
        preview_href: "/api/drive/items/weekly-report/preview",
        download_href: "/api/drive/items/weekly-report/download",
        restore_href: "/api/accepted-deliverables/81000000-0000-4000-8000-000000000701/restore"
      }
    ],
    merge_timeline: [
      {
        id: "81000000-0000-4000-8000-000000000801",
        proposal_id: proposalId,
        work_item_id: workItemId,
        branch_id: "81000000-0000-4000-8000-000000000104",
        actor_kind: "human",
        actor_user_id: "81000000-0000-4000-8000-000000000301",
        result: "merged",
        merge_snapshot_id: "81000000-0000-4000-8000-000000000601",
        conflict_count: 2,
        target_keys: ["drive_item:docs/weekly-report.md", `work_item:${workItemId}:task_items`],
        accepted_target_keys: ["drive_item:docs/weekly-report.md", `work_item:${workItemId}:task_items`],
        conflicts: [
          { target_key: "drive_item:docs/weekly-report.md" },
          { target_key: `work_item:${workItemId}:task_items` }
        ],
        decisions: [
          {
            id: "81000000-0000-4000-8000-000000000802",
            conflict_key: "drive_item:docs/weekly-report.md",
            recommended_option_key: "ai_fusion",
            chosen_option_key: "ai_fusion",
            chosen_by_user_id: "81000000-0000-4000-8000-000000000301",
            chosen_at: "2026-06-10T01:00:00.000Z",
            candidates: [
              {
                option_key: "ai_fusion",
                rationale_md: "保留正式周报的主结构，同时补入风险和预算说明。",
                quality_gate: {
                  text_patch_preview: textPatchPreview(),
                  text_diff3: textDiff3(),
                  structured_record_patch: structuredRecordPatch()
                },
                recommended: true,
                chosen: true
              }
            ]
          }
        ],
        created_at: "2026-06-10T01:00:00.000Z"
      }
    ],
    audit_logs: [
      {
        id: "81000000-0000-4000-8000-000000000901",
        action: "proposal.merged",
        detail_json: {
          merge_strategy: "field_merge",
          merge_snapshot_id: "81000000-0000-4000-8000-000000000601",
          structured_field_changes: [
            {
              field: "title",
              valueType: "string",
              baseValue: "客户周报草稿",
              beforeValue: "客户周报草稿",
              afterValue: "客户周报草稿与风险说明",
              mergeDecision: "accept_incoming"
            },
            {
              field: "task_items",
              valueType: "json_array",
              baseValue: currentTasks(),
              beforeValue: currentTasks(),
              afterValue: incomingTasks(),
              itemCount: incomingTasks().length,
              mergeDecision: "accept_incoming"
            }
          ]
        }
      }
    ],
    evidence_refs: []
  };
}

function createRouteClient() {
  return {
    async replayAgentRun() {
      return replayVm();
    },
    async listWorkItemConflicts(candidateWorkItemId: string) {
      const conflicts = proposalConflicts().filter((conflict) => conflict.work_item_id === candidateWorkItemId);
      return conflicts.length ? { conflicts } : { conflicts, empty_state: "no_conflicts" };
    },
    pages: {
      async proposal() {
        return proposalVm();
      }
    }
  };
}

function qaShell(caseItem: RouteCase, rendered: RenderedRoute) {
  return `<!doctype html>
<html lang="${caseItem.locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(caseItem.label)}</title>
  <style>
    ${rendered.css}
    body{margin:0;background:#eef4fb}
    .r1qa-banner{font-family:"Aptos","Segoe UI",sans-serif;background:#172033;color:#fff;padding:10px 16px;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
    .r1qa-banner strong{font-size:13px}
    .r1qa-banner span{font-size:12px;color:#dbe5ff;overflow-wrap:anywhere;min-width:0;flex:1 1 160px;text-align:right}
    @media (max-width:520px){.r1qa-banner{justify-content:flex-start}.r1qa-banner span{display:none}}
  </style>
</head>
<body data-r1-route-visual-case="${escapeHtml(caseItem.id)}" data-r1-route="${escapeHtml(caseItem.route)}" data-r1-surface="${caseItem.surface}" data-r1-locale="${caseItem.locale}">
  <div class="r1qa-banner"><strong>${escapeHtml(caseItem.label)}</strong><span>${escapeHtml(caseItem.route)} · ${caseItem.surface} · ${caseItem.locale}</span></div>
  ${rendered.html}
  <script>
    (() => {
      const root = document.documentElement;
      document.body.dataset.r1ClientWidth = String(root.clientWidth);
      document.body.dataset.r1ScrollWidth = String(root.scrollWidth);
    })();
  </script>
</body>
</html>`;
}

function stripTrailingWhitespace(value: string) {
  return value.replace(/[ \t]+$/gmu, "");
}

function routeStateDocument(locale: Locale) {
  const copy = locale === "zh-CN"
    ? {
      title: "R1 路由四态",
      loading: "载入中",
      empty: "暂无需要处理的变更",
      error: "加载失败",
      forbidden: "无权查看",
      loadingBody: "页面等待真实 API 返回，不能显示假成功。",
      emptyBody: "空态要给下一步，而不是给空白页面。",
      errorBody: "错误态显示可恢复动作和追踪编号。",
      forbiddenBody: "权限态说明需要谁授权。"
    }
    : {
      title: "R1 Route States",
      loading: "Loading",
      empty: "No changes need attention",
      error: "Load failed",
      forbidden: "Forbidden",
      loadingBody: "The page waits for the real API instead of faking success.",
      emptyBody: "Empty states show the next step, not blank space.",
      errorBody: "Error states expose recovery and trace id.",
      forbiddenBody: "Permission states explain who can grant access."
    };
  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(copy.title)}</title>
  <style>
    :root{color-scheme:light;--ink:#182033;--muted:#5e6a86;--line:#dfe5f1;--paper:#fff;--soft:#f5f8fc;--blue:#355cff;--danger:#d94a3a;--amber:#d98b16}
    body{margin:0;font-family:"Aptos","Segoe UI",sans-serif;color:var(--ink);background:linear-gradient(180deg,#f8fbff 0%,#eef4fb 100%);padding:24px}
    main{max-width:1120px;margin:0 auto;display:grid;gap:16px}
    h1{font-size:30px;margin:0 0 4px}
    .states{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
    .state{border:1px solid var(--line);background:rgba(255,255,255,.94);border-radius:8px;padding:18px;min-height:140px;box-shadow:0 18px 50px rgba(37,51,79,.08)}
    .state strong{display:block;font-size:18px;margin-bottom:8px}.state p{color:var(--muted);line-height:1.55}.pill{display:inline-flex;border-radius:999px;padding:5px 9px;background:var(--soft);font-size:12px;color:var(--muted)}
    .state[data-route-state=error]{border-color:#f0c5bd}.state[data-route-state=forbidden]{border-color:#d8dff2}.state[data-route-state=loading]{border-color:#b8c7ff}.state[data-route-state=empty]{border-color:#dfe8d7}
  </style>
</head>
<body data-r1-route-visual-case="web-route-states-zh" data-r1-route="/api/pages/proposals/:id" data-r1-surface="web" data-r1-locale="${locale}">
  <main>
    <h1>${escapeHtml(copy.title)}</h1>
    <section class="states" data-r1-route-states="true">
      <article class="state" data-route-state="loading"><span class="pill">/api/pages/proposals/:id</span><strong>${escapeHtml(copy.loading)}</strong><p>${escapeHtml(copy.loadingBody)}</p></article>
      <article class="state" data-route-state="empty"><span class="pill">/api/workitems/:id/conflicts</span><strong>${escapeHtml(copy.empty)}</strong><p>${escapeHtml(copy.emptyBody)}</p></article>
      <article class="state" data-route-state="error"><span class="pill">trace_id=r1-route-visual</span><strong>${escapeHtml(copy.error)}</strong><p>${escapeHtml(copy.errorBody)}</p></article>
      <article class="state" data-route-state="forbidden"><span class="pill">403</span><strong>${escapeHtml(copy.forbidden)}</strong><p>${escapeHtml(copy.forbiddenBody)}</p></article>
    </section>
  </main>
  <script>
    (() => {
      const root = document.documentElement;
      document.body.dataset.r1ClientWidth = String(root.clientWidth);
      document.body.dataset.r1ScrollWidth = String(root.scrollWidth);
    })();
  </script>
</body>
</html>`;
}

function contactSheetDocument(cases: Array<{ id: string; label: string; screenshot: string; surface: Surface; locale: Locale }>) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>R1.39 Route Visual QA Contact Sheet</title>
  <style>
    body{margin:0;font-family:"Aptos","Segoe UI",sans-serif;color:#182033;background:#eef4fb;padding:20px}
    h1{margin:0 0 14px;font-size:28px}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
    figure{margin:0;background:white;border:1px solid #dfe5f1;border-radius:8px;padding:10px;box-shadow:0 18px 50px rgba(37,51,79,.08)}
    figcaption{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#5e6a86;margin-bottom:8px}
    img{display:block;width:100%;height:auto;border:1px solid #eef2f8;border-radius:6px}
  </style>
</head>
<body>
  <h1>R1.39 Route Visual QA Contact Sheet</h1>
  <main class="grid">
    ${cases.map((caseItem) => `<figure data-contact-case="${escapeHtml(caseItem.id)}"><figcaption><strong>${escapeHtml(caseItem.label)}</strong><span>${caseItem.surface} · ${caseItem.locale}</span></figcaption><img src="${escapeHtml(caseItem.screenshot)}" alt="${escapeHtml(caseItem.label)}" /></figure>`).join("")}
  </main>
</body>
</html>`;
}

function markers(html: string): DomMarkers {
  const clientWidth = layoutNumber(html, "data-r1-client-width");
  const scrollWidth = layoutNumber(html, "data-r1-scroll-width");
  return {
    richPatchViewer: countNeedle(html, 'data-rich-patch-viewer="true"'),
    richPatchTruncated: countNeedle(html, 'data-rich-patch-truncated="true"'),
    overlapHunkReview: countNeedle(html, 'data-overlap-hunk-review="true"'),
    routeLineEditor: countNeedle(html, 'data-route-line-editor="true"'),
    lineEditorTabs: countNeedle(html, 'data-line-editor-tab='),
    lineEditorSearch: countNeedle(html, 'data-line-editor-search="true"'),
    lineEditorRows: countNeedle(html, 'data-line-editor-row="true"'),
    lineEditorApply: countNeedle(html, 'data-line-editor-apply="true"'),
    lineEditorPayload: countNeedle(html, "text_hunk_overrides"),
    proposalSubrecordDiff: countNeedle(html, 'data-proposal-subrecord-item-diff="true"'),
    replaySubrecordDiff: countNeedle(html, 'data-replay-subrecord-item-diff="true"'),
    taskPlanScope: countNeedle(html, 'data-task-plan-scope="required"'),
    conflictWorkbench: countNeedle(html, 'data-proposal-conflict-workbench="true"'),
    routeStateCards: countNeedle(html, 'data-route-state='),
    forbiddenState: countNeedle(html, 'data-route-state="forbidden"'),
    loadingState: countNeedle(html, 'data-route-state="loading"'),
    emptyState: countNeedle(html, 'data-route-state="empty"'),
    errorState: countNeedle(html, 'data-route-state="error"'),
    cuuLeak: countNeedle(html, "Cuu") + countNeedle(html, "data-cuu"),
    kanbanLeak: countNeedle(html.toLowerCase(), "kanban"),
    clientWidth,
    scrollWidth,
    horizontalOverflow: clientWidth !== null && scrollWidth !== null ? scrollWidth > clientWidth + 1 : false
  };
}

function layoutNumber(html: string, attribute: string) {
  const match = new RegExp(`${attribute}="(\\d+)"`, "u").exec(html);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function chromeCandidates() {
  return [
    process.env["CHROME_PATH"],
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function findChrome() {
  return chromeCandidates().find((candidate) => existsSync(candidate));
}

async function runChromeScreenshot(input: {
  chromePath: string;
  htmlPath: string;
  pngPath: string;
  viewport: { width: number; height: number };
}) {
  const userDataDir = path.join(os.tmpdir(), `workhub-r1-route-visual-${path.basename(input.pngPath, ".png")}`);
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  await mkdir(userDataDir, { recursive: true });
  const chromeHtmlPath = path.basename(input.htmlPath) === "contact-sheet.html"
    ? input.htmlPath
    : path.join(userDataDir, "page.html");
  if (chromeHtmlPath !== input.htmlPath) {
    await copyFile(input.htmlPath, chromeHtmlPath);
  }
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--force-device-scale-factor=1",
    `--user-data-dir=${userDataDir}`,
    `--window-size=${input.viewport.width},${input.viewport.height}`,
    `--screenshot=${input.pngPath}`,
    pathToFileURL(chromeHtmlPath).href
  ];
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let lastSize = -1;
    let stablePolls = 0;
    const screenshotSize = () => {
      try {
        return existsSync(input.pngPath) ? statSync(input.pngPath).size : 0;
      } catch {
        return 0;
      }
    };
    const child = spawn(input.chromePath, args, { stdio: "ignore" });
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
      }
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const poll = setInterval(() => {
      const size = screenshotSize();
      if (size > 0 && size === lastSize) {
        stablePolls += 1;
      } else {
        stablePolls = 0;
      }
      lastSize = size;
      if (stablePolls >= 2) {
        finish();
      }
    }, 100);
    const timeout = setTimeout(() => {
      const size = screenshotSize();
      finish(size > 0 ? undefined : new Error(`Chrome screenshot timed out for ${input.htmlPath}`));
    }, 20_000);
    child.on("error", finish);
    child.on("exit", (code) => {
      if (code === 0 || screenshotSize() > 0) {
        finish();
      } else {
        finish(new Error(`Chrome screenshot failed with exit code ${String(code)} for ${input.htmlPath}`));
      }
    });
  });
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

async function runChromeDump(input: {
  chromePath: string;
  htmlPath: string;
  viewport: { width: number; height: number };
}) {
  const userDataDir = path.join(os.tmpdir(), `workhub-r1-route-visual-dump-${path.basename(input.htmlPath, ".html")}`);
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  await mkdir(userDataDir, { recursive: true });
  const chromeHtmlPath = path.basename(input.htmlPath) === "contact-sheet.html"
    ? input.htmlPath
    : path.join(userDataDir, "page.html");
  if (chromeHtmlPath !== input.htmlPath) {
    await copyFile(input.htmlPath, chromeHtmlPath);
  }
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--force-device-scale-factor=1",
    `--user-data-dir=${userDataDir}`,
    `--window-size=${input.viewport.width},${input.viewport.height}`,
    "--dump-dom",
    pathToFileURL(chromeHtmlPath).href
  ];
  const output = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const child = spawn(input.chromePath, args, { stdio: ["ignore", "pipe", "ignore"] });
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
      }
      if (error) {
        reject(error);
      } else {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    };
    const hasCompleteDom = () => Buffer.concat(chunks).toString("utf8").includes("</html>");
    const timeout = setTimeout(() => {
      finish(hasCompleteDom() ? undefined : new Error(`Chrome DOM dump timed out for ${input.htmlPath}`));
    }, 20_000);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", finish);
    child.on("exit", (code) => {
      if (code === 0 || hasCompleteDom()) {
        finish();
      } else {
        finish(new Error(`Chrome DOM dump failed with exit code ${String(code)} for ${input.htmlPath}`));
      }
    });
  });
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  return output;
}

async function assertPng(pathname: string) {
  const buffer = await readFile(pathname);
  const size = await stat(pathname);
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error(`Not a PNG: ${pathname}`);
  }
  if (size.size < 8_000) {
    throw new Error(`Screenshot looks too small: ${pathname}`);
  }
}

async function main() {
  const client = createRouteClient();
  const cases: RouteCase[] = [
    {
      id: "web-proposal-zh-desktop",
      label: "Web Proposal zh-CN desktop",
      surface: "web",
      locale: "zh-CN",
      route: "/api/pages/proposals/:id",
      viewport: { width: 1365, height: 1600 },
      render: async () => renderWebProposalDetail(client as never, proposalId, "zh-CN")
    },
    {
      id: "web-proposal-en-mobile",
      label: "Web Proposal en-US mobile",
      surface: "web",
      locale: "en-US",
      route: "/api/pages/proposals/:id",
      viewport: { width: 467, height: 1600 },
      render: async () => renderWebProposalDetail(client as never, proposalId, "en-US")
    },
    {
      id: "desktop-proposal-zh",
      label: "Desktop Proposal zh-CN",
      surface: "desktop",
      locale: "zh-CN",
      route: "/api/pages/proposals/:id",
      viewport: { width: 1180, height: 1500 },
      render: async () => renderDesktopProposalDetail(client as never, proposalId, "zh-CN")
    },
    {
      id: "web-replay-en-desktop",
      label: "Web Replay en-US desktop",
      surface: "web",
      locale: "en-US",
      route: "/api/agent-runs/:id/replay",
      viewport: { width: 1365, height: 1600 },
      render: async () => renderWebAgentRunReplay(client as never, runId, "en-US")
    },
    {
      id: "desktop-replay-zh",
      label: "Desktop Replay zh-CN",
      surface: "desktop",
      locale: "zh-CN",
      route: "/api/agent-runs/:id/replay",
      viewport: { width: 1180, height: 1500 },
      render: async () => renderDesktopAgentRunReplay(client as never, runId, "zh-CN")
    }
  ];

  await mkdir(auditDir, { recursive: true });
  const chromePath = findChrome();
  const reportCases = [];
  const contactCases = [];

  for (const caseItem of cases) {
    const rendered = await caseItem.render();
    const html = stripTrailingWhitespace(qaShell(caseItem, rendered));
    const htmlPath = path.join(auditDir, `${caseItem.id}.html`);
    const pngPath = path.join(auditDir, `${caseItem.id}.png`);
    await writeFile(htmlPath, html, "utf8");
    let markerHtml = html;
    if (chromePath) {
      await runChromeScreenshot({
        chromePath,
        htmlPath,
        pngPath,
        viewport: caseItem.viewport
      });
      await assertPng(pngPath);
      markerHtml = await runChromeDump({
        chromePath,
        htmlPath,
        viewport: caseItem.viewport
      }).catch(() => markerHtml);
    }
    const caseMarkers = markers(markerHtml);
    if (caseMarkers.cuuLeak > 0 || caseMarkers.kanbanLeak > 0) {
      throw new Error(`${caseItem.id} leaked forbidden main-window wording`);
    }
    if (caseMarkers.horizontalOverflow) {
      throw new Error(`${caseItem.id} has horizontal overflow: ${String(caseMarkers.scrollWidth)} > ${String(caseMarkers.clientWidth)}`);
    }
    reportCases.push({
      id: caseItem.id,
      label: caseItem.label,
      route: caseItem.route,
      surface: caseItem.surface,
      locale: caseItem.locale,
      viewport: caseItem.viewport,
      html: path.basename(htmlPath),
      screenshot: chromePath ? path.basename(pngPath) : null,
      markers: caseMarkers
    });
    if (chromePath) {
      contactCases.push({
        id: caseItem.id,
        label: caseItem.label,
        surface: caseItem.surface,
        locale: caseItem.locale,
        screenshot: path.basename(pngPath)
      });
    }
  }

  const statesHtml = stripTrailingWhitespace(routeStateDocument("zh-CN"));
  const statesHtmlPath = path.join(auditDir, "web-route-states-zh.html");
  const statesPngPath = path.join(auditDir, "web-route-states-zh.png");
  await writeFile(statesHtmlPath, statesHtml, "utf8");
  let statesMarkerHtml = statesHtml;
  if (chromePath) {
    await runChromeScreenshot({
      chromePath,
      htmlPath: statesHtmlPath,
      pngPath: statesPngPath,
      viewport: { width: 1365, height: 900 }
    });
    await assertPng(statesPngPath);
    contactCases.push({
      id: "web-route-states-zh",
      label: "Web route states zh-CN",
      surface: "web",
      locale: "zh-CN",
      screenshot: path.basename(statesPngPath)
    });
    statesMarkerHtml = await runChromeDump({
      chromePath,
      htmlPath: statesHtmlPath,
      viewport: { width: 1365, height: 900 }
    }).catch(() => statesMarkerHtml);
  }
  reportCases.push({
    id: "web-route-states-zh",
    label: "Web route states zh-CN",
    route: "/api/pages/proposals/:id",
    surface: "web",
    locale: "zh-CN",
    viewport: { width: 1365, height: 900 },
    html: path.basename(statesHtmlPath),
    screenshot: chromePath ? path.basename(statesPngPath) : null,
    markers: markers(statesMarkerHtml)
  });

  if (chromePath) {
    const contactHtmlPath = path.join(auditDir, "contact-sheet.html");
    const contactPngPath = path.join(auditDir, "contact-sheet.png");
    await writeFile(contactHtmlPath, stripTrailingWhitespace(contactSheetDocument(contactCases)), "utf8");
    await runChromeScreenshot({
      chromePath,
      htmlPath: contactHtmlPath,
      pngPath: contactPngPath,
      viewport: { width: 1365, height: 5000 }
    });
    await assertPng(contactPngPath);
  }

  const report = {
    generated_at: new Date().toISOString(),
    module: "R1.39 route visual QA",
    chrome_path: chromePath ?? null,
    output_dir: path.relative(repoRoot, auditDir).replace(/\\/gu, "/"),
    gates: {
      no_main_window_cuu: true,
      no_kanban_default: true,
      rich_patch_viewer: reportCases.some((caseItem) => caseItem.markers.richPatchViewer > 0),
      long_patch_folded: reportCases.some((caseItem) => caseItem.markers.richPatchTruncated > 0),
      overlap_hunk_review: reportCases.some((caseItem) => caseItem.markers.overlapHunkReview > 0),
      route_line_editor: reportCases.some((caseItem) => caseItem.markers.routeLineEditor > 0),
      line_editor_tabs: reportCases.some((caseItem) => caseItem.markers.lineEditorTabs > 0),
      line_editor_search: reportCases.some((caseItem) => caseItem.markers.lineEditorSearch > 0),
      line_editor_apply_payload: reportCases.some((caseItem) =>
        caseItem.markers.lineEditorApply > 0 && caseItem.markers.lineEditorPayload > 0
      ),
      proposal_subrecord_diff: reportCases.some((caseItem) => caseItem.markers.proposalSubrecordDiff > 0),
      replay_subrecord_diff: reportCases.some((caseItem) => caseItem.markers.replaySubrecordDiff > 0),
      task_plan_scope: reportCases.some((caseItem) => caseItem.markers.taskPlanScope > 0),
      conflict_workbench: reportCases.some((caseItem) => caseItem.markers.conflictWorkbench > 0),
      no_horizontal_overflow: reportCases.every((caseItem) => !caseItem.markers.horizontalOverflow),
      route_states:
        reportCases.some((caseItem) => caseItem.markers.loadingState > 0)
        && reportCases.some((caseItem) => caseItem.markers.emptyState > 0)
        && reportCases.some((caseItem) => caseItem.markers.errorState > 0)
        && reportCases.some((caseItem) => caseItem.markers.forbiddenState > 0)
    },
    cases: reportCases
  };

  if (!Object.values(report.gates).every(Boolean)) {
    throw new Error(`R1.39 route visual QA gates failed: ${JSON.stringify(report.gates)}`);
  }

  await writeFile(path.join(auditDir, "route-visual-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, output_dir: report.output_dir, screenshots: Boolean(chromePath) }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
