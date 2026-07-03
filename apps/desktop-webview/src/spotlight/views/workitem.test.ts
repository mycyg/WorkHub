import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkItemDetailVM } from "@workhub/contracts";

import { detailHtml, workItemListHtml } from "./workitem.js";

const WI = "10000000-0000-4000-8000-000000000901";

// 只填 detailHtml 实际读取的字段(其余用 cast 省略),与 drive.test 同手法做纯渲染断言。
function vm(over: Partial<WorkItemDetailVM> = {}): WorkItemDetailVM {
  return {
    workitem: { id: WI, code: "WH-1", title: "Weekly report", status: "spec_ready", priority: "normal" },
    agent_trace_preview: [],
    acceptance: [],
    accepted_deliverables: [],
    evidence_refs: [],
    actions: {},
    ...over
  } as unknown as WorkItemDetailVM;
}

test("#22 desktop workitem drafts a task plan only when spec_ready with no proposal/trace", () => {
  // Old assertion expected a direct start-run button. That was wrong for R9.1:
  // one intent must become a task-plan proposal and wait for human review before dispatch.
  assert.ok(detailHtml(vm(), true).includes(`data-wi-task-plan="${WI}"`), "task-plan draft shown for clean spec_ready");
  assert.ok(!detailHtml(vm(), true).includes("data-wi-run"), "no direct run button before plan review");
  // a latest proposal already exists → no re-run button (matches web gate)
  assert.ok(
    !detailHtml(vm({ latest_proposal: { proposal_id: "p", title: "x" } as WorkItemDetailVM["latest_proposal"] }), true).includes("data-wi-task-plan"),
    "no task-plan draft once a proposal exists"
  );
  // already has trace → no dispatch
  assert.ok(
    !detailHtml(vm({ agent_trace_preview: [{ phase: "think" } as unknown as WorkItemDetailVM["agent_trace_preview"][number]] }), true).includes("data-wi-task-plan"),
    "no task-plan draft once a run has traced"
  );
  // not spec_ready → no dispatch
  assert.ok(!detailHtml(vm({ workitem: { id: WI, code: "WH-1", title: "t", status: "merged", priority: "normal" } as WorkItemDetailVM["workitem"] }), true).includes("data-wi-task-plan"), "no task-plan draft when not spec_ready");
});

test("#11 desktop workitem surfaces create-proposal-draft when the action is present", () => {
  const withAction = vm({
    workitem: { id: WI, code: "WH-1", title: "t", status: "intake", priority: "normal" } as WorkItemDetailVM["workitem"],
    actions: { create_proposal_draft: { id: "create_proposal_draft", label: "Draft", method: "POST", href: "/x" } } as WorkItemDetailVM["actions"]
  });
  assert.ok(detailHtml(withAction, true).includes(`data-wi-create-proposal="${WI}"`), "draft button shown when action present");
  assert.ok(!detailHtml(vm(), true).includes("data-wi-create-proposal"), "no draft button without the action");
});

test("desktop workitem renders a compact read-only task plan summary", () => {
  const html = detailHtml(vm({
    task_plan: {
      id: "93000000-0000-4000-8000-000000000901",
      work_item_id: WI,
      workspace_id: "93000000-0000-4000-8000-000000000001",
      status: "approved",
      objective_id: null,
      budget_json: { total_share_pct: 100 },
      decomposition_context_json: { source: "meta_planner" },
      created_by: "93000000-0000-4000-8000-000000000301",
      created_at: "2026-07-03T00:00:00.000Z",
      updated_at: "2026-07-03T00:01:00.000Z",
      items_capped: false,
      items: [
        {
          id: "93000000-0000-4000-8000-000000000902",
          plan_id: "93000000-0000-4000-8000-000000000901",
          parent_item_id: null,
          seq: 0,
          title: "整理竞品证据",
          role: "research",
          objective_md: "查清三类竞品的最新打法。",
          acceptance_md: "列出至少 3 条可核验来源。",
          budget_share_pct: 35,
          depends_on: [],
          status: "pending",
          created_at: "2026-07-03T00:00:00.000Z",
          updated_at: "2026-07-03T00:00:00.000Z"
        },
        {
          id: "93000000-0000-4000-8000-000000000903",
          plan_id: "93000000-0000-4000-8000-000000000901",
          parent_item_id: null,
          seq: 1,
          title: "产出短报告",
          role: "produce",
          objective_md: "把证据整理成短报告。",
          acceptance_md: "报告包含结论、证据和下一步建议。",
          budget_share_pct: 65,
          depends_on: ["93000000-0000-4000-8000-000000000902"],
          status: "pending",
          created_at: "2026-07-03T00:00:00.000Z",
          updated_at: "2026-07-03T00:00:00.000Z"
        }
      ]
    }
  }), true);

  assert.ok(html.includes('data-spot-task-plan="true"'));
  assert.ok(html.includes('data-spot-task-plan-status="approved"'));
  assert.ok(html.includes('data-spot-task-plan-item="93000000-0000-4000-8000-000000000902"'));
  assert.ok(html.includes("任务计划"));
  assert.ok(html.includes("1. 调研 · 35%"));
  assert.equal(html.includes("0. 调研 · 35%"), false);
  assert.ok(html.includes("调研"));
  assert.ok(html.includes("整理竞品证据"));
  assert.ok(html.includes("65%"));
});

test("R9.2 desktop workitem renders a compressed read-only army run tree", () => {
  const html = detailHtml(vm({
    agent_team: {
      plan_id: "93000000-0000-4000-8000-000000000901",
      status: "dispatching",
      completed_count: 1,
      total_count: 2,
      cost_used_cny: "1.250000",
      cost_budget_cny: "3.000000",
      cost_burn_pct: 42,
      runs_capped: false,
      items: [
        {
          task_plan_item_id: "93000000-0000-4000-8000-000000000902",
          seq: 1,
          title: "整理竞品证据",
          role: "research",
          plan_status: "succeeded",
          status: "succeeded",
          budget_share_pct: 35,
          depends_on: [],
          waiting_for_seq: [],
          cost_estimate_cny: "0.450000",
          run_id: "93000000-0000-4000-8000-000000000911",
          run_status: "succeeded",
          replay_href: "/agent-runs/93000000-0000-4000-8000-000000000911/replay",
          action: {
            kind: "view_output",
            label: "看产出",
            href: "/agent-runs/93000000-0000-4000-8000-000000000911/replay"
          }
        },
        {
          task_plan_item_id: "93000000-0000-4000-8000-000000000903",
          seq: 2,
          title: "复核风险",
          role: "review",
          plan_status: "failed",
          status: "needs_human",
          budget_share_pct: 25,
          depends_on: ["93000000-0000-4000-8000-000000000902"],
          waiting_for_seq: [],
          cost_estimate_cny: "0.800000",
          run_id: "93000000-0000-4000-8000-000000000912",
          run_status: "escalated",
          replay_href: "/agent-runs/93000000-0000-4000-8000-000000000912/replay",
          decision_href: "/attention",
          action: {
            kind: "decide",
            label: "去决策",
            href: "/attention"
          }
        }
      ]
    }
  }), true);

  assert.ok(html.includes('data-spot-agent-team="true"'));
  assert.ok(html.includes('data-spot-agent-team-status="dispatching"'));
  assert.ok(html.includes("军团推进中 1/2"));
  assert.ok(html.includes('data-spot-agent-team-item="93000000-0000-4000-8000-000000000903"'));
  assert.ok(html.includes("复核"));
  assert.ok(html.includes("去决策"));
});

test("R9.7 desktop workitem agent team avoids dispatch internals", () => {
  const runTree = {
    agent_team: {
      plan_id: "93000000-0000-4000-8000-000000000901",
      status: "dispatching",
      completed_count: 0,
      total_count: 2,
      cost_used_cny: "0.250000",
      cost_budget_cny: "1.000000",
      cost_burn_pct: 25,
      runs_capped: false,
      items: [
        {
          task_plan_item_id: "93000000-0000-4000-8000-000000000902",
          seq: 1,
          title: "整理竞品证据",
          role: "research",
          plan_status: "pending",
          status: "pending",
          budget_share_pct: 40,
          depends_on: [],
          waiting_for_seq: [],
          cost_estimate_cny: "0.250000"
        },
        {
          task_plan_item_id: "93000000-0000-4000-8000-000000000903",
          seq: 2,
          title: "产出短报告",
          role: "produce",
          plan_status: "dispatched",
          status: "dispatched",
          budget_share_pct: 60,
          depends_on: ["93000000-0000-4000-8000-000000000902"],
          waiting_for_seq: [],
          cost_estimate_cny: "0.500000",
          run_id: "93000000-0000-4000-8000-000000000912",
          run_status: "running",
          replay_href: "/agent-runs/93000000-0000-4000-8000-000000000912/replay"
        }
      ]
    }
  } satisfies Pick<WorkItemDetailVM, "agent_team">;
  const zh = detailHtml(vm(runTree), true);
  const en = detailHtml(vm(runTree), false);

  assert.doesNotMatch(zh, /派发/u);
  assert.doesNotMatch(en, /Dispatch/u);
  assert.match(zh, /待开始/u);
  assert.match(zh, /进行中/u);
  assert.match(en, /Waiting/u);
  assert.match(en, /In progress/u);
});

test("desktop workitem latest proposal hides model self narration titles", () => {
  const html = detailHtml(vm({
    latest_proposal: {
      proposal_id: "proposal-1",
      title: "完成了。让我做一个人话总结。"
    } as WorkItemDetailVM["latest_proposal"]
  }), true);

  assert.equal(html.includes("完成了。让我做一个人话总结。"), false);
  assert.match(html, /交付物变更申请/u);
});

test("desktop workitem trace hides hidden reasoning and raw tool payloads", () => {
  const html = detailHtml(vm({
    agent_trace_preview: [
      {
        id: "trace-1",
        agent_run_id: "run-1",
        step_no: 1,
        phase: "think",
        input_json: {},
        output_excerpt: "Now I understand the task and will analyze hidden reasoning.",
        created_at: "2026-06-26T00:00:00.000Z"
      },
      {
        id: "trace-2",
        agent_run_id: "run-1",
        step_no: 2,
        phase: "tool_result",
        tool_name: "read_project_file",
        input_json: {},
        output_excerpt: "--- name: markdown-report description: raw tool payload",
        created_at: "2026-06-26T00:00:01.000Z"
      }
    ] as WorkItemDetailVM["agent_trace_preview"]
  }), true);

  assert.ok(html.includes("AI 正在整理材料，稍后给你下一步。"));
  assert.equal(html.includes("隐藏推理内容"), false);
  assert.ok(html.includes("工具已返回：read_project_file"));
  assert.equal(html.includes("Now I understand"), false);
  assert.equal(html.includes("markdown-report"), false);
});

test("R9.7 desktop workitem empty list avoids dispatch copy", () => {
  const zh = workItemListHtml([], true);
  const en = workItemListHtml([], false);

  assert.doesNotMatch(zh, /派活/u);
  assert.doesNotMatch(en, /Dispatch|dispatch/u);
  assert.match(zh, /新建一个任务/u);
  assert.match(en, /Create a task/u);
});
