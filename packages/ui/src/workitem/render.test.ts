import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture } from "@workhub/agent/fixtures";

import { renderWorkItemDetail } from "./render.js";

test("work item renderer keeps the page focused on status, trace, evidence, and next actions", () => {
  const fixture = createP05GoldPathFixture();
  const rendered = renderWorkItemDetail(fixture.workItemDetail, "web");

  assert.equal(rendered.surface, "web");
  assert.equal(rendered.workItemId, fixture.workItem.id);
  assert.equal(rendered.cuuState, "carrying_document");
  assert.equal(rendered.traceCount >= 5, true);
  // findings[#low-F3]：trace 步骤 phase 本地化（思考/调用工具/...），不再把原始英文 token 渲染给 zh-CN 用户。
  assert.equal(rendered.html.includes("思考"), true);
  assert.equal(/<strong>(?:think|tool_call|tool_result|final)<\/strong>/u.test(rendered.html), false);
  assert.equal(rendered.evidenceCount, 3);
  assert.equal(rendered.html.includes("AI 实时执行"), true);
  assert.equal(rendered.html.includes("验收清单"), true);
  assert.equal(rendered.primaryHrefs.includes(`/proposals/${fixture.proposalDetail.proposal_id}`), true);
});

test("work item renderer supports the just-created AI-working state before a proposal exists", () => {
  const fixture = createP05GoldPathFixture();
  const { latest_proposal: _latestProposal, ...detailWithoutProposal } = fixture.workItemDetail;
  const justCreated = {
    ...detailWithoutProposal,
    workitem: {
      ...fixture.workItemDetail.workitem,
      status: "ai_working" as const
    },
    agent_trace_preview: [
      {
        ...fixture.replay.steps[0]!,
        phase: "think" as const,
        output_excerpt: "Now I understand the task and will analyze hidden reasoning."
      },
      {
        ...fixture.replay.steps[1]!,
        phase: "tool_result" as const,
        tool_name: "read_project_file",
        output_excerpt: "--- name: markdown-report description: raw tool payload"
      }
    ]
  };
  const rendered = renderWorkItemDetail(justCreated, "desktop");

  assert.equal(rendered.surface, "desktop");
  assert.equal(rendered.cuuState, "thinking");
  assert.equal(rendered.html.includes("我开始处理了"), true);
  assert.equal(rendered.primaryHrefs.includes(`/agent-runs/${fixture.replay.run.id}/replay`), true);
  assert.equal(rendered.html.includes("AI 正在整理材料，稍后给你下一步。"), true);
  assert.equal(rendered.html.includes("隐藏推理内容"), false);
  assert.equal(rendered.html.includes("工具已返回：read_project_file"), true);
  assert.equal(rendered.html.includes("Now I understand"), false);
  assert.equal(rendered.html.includes("markdown-report"), false);
});

test("work item renderer localizes fixed labels and hides raw status in English", () => {
  const fixture = createP05GoldPathFixture();
  const { latest_proposal: _latestProposal, ...detailWithoutProposal } = fixture.workItemDetail;
  const justCreated = {
    ...detailWithoutProposal,
    workitem: {
      ...fixture.workItemDetail.workitem,
      status: "ai_working" as const
    },
    agent_trace_preview: []
  };
  const rendered = renderWorkItemDetail(justCreated, "web", { locale: "en-US" });

  assert.equal(rendered.html.includes("Live AI work"), true);
  assert.equal(rendered.html.includes("Acceptance checklist"), true);
  assert.equal(rendered.html.includes("AI working"), true);
  assert.equal(rendered.html.includes("ai_working"), false);
  assert.equal(rendered.html.includes("AI has started"), true);
  assert.equal(rendered.html.includes("AI 会先读证据"), false);
});

test("R9.2 work item renderer shows the task-plan run tree in the AI working slot", () => {
  const fixture = createP05GoldPathFixture();
  const planId = "93000000-0000-4000-8000-000000000901";
  const detail = {
    ...fixture.workItemDetail,
    workitem: {
      ...fixture.workItemDetail.workitem,
      status: "ai_working" as const
    },
    agent_team: {
      plan_id: planId,
      status: "dispatching" as const,
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
          role: "research" as const,
          plan_status: "succeeded" as const,
          status: "succeeded" as const,
          budget_share_pct: 35,
          depends_on: [],
          waiting_for_seq: [],
          cost_estimate_cny: "0.450000",
          run_id: "93000000-0000-4000-8000-000000000911",
          run_status: "succeeded" as const,
          replay_href: "/agent-runs/93000000-0000-4000-8000-000000000911/replay",
          action: {
            kind: "view_output" as const,
            label: "看产出",
            href: "/agent-runs/93000000-0000-4000-8000-000000000911/replay"
          }
        },
        {
          task_plan_item_id: "93000000-0000-4000-8000-000000000903",
          seq: 2,
          title: "复核风险",
          role: "review" as const,
          plan_status: "failed" as const,
          status: "needs_human" as const,
          budget_share_pct: 25,
          depends_on: ["93000000-0000-4000-8000-000000000902"],
          waiting_for_seq: [],
          cost_estimate_cny: "0.800000",
          run_id: "93000000-0000-4000-8000-000000000912",
          run_status: "escalated" as const,
          replay_href: "/agent-runs/93000000-0000-4000-8000-000000000912/replay",
          decision_href: "/attention",
          action: {
            kind: "decide" as const,
            label: "去决策",
            href: "/attention"
          }
        }
      ]
    }
  };
  const rendered = renderWorkItemDetail(detail, "web");

  assert.equal(rendered.html.includes('data-r9-agent-team-panel="true"'), true);
  assert.equal(rendered.html.includes("军团推进中 1/2"), true);
  assert.equal(rendered.html.includes("整理竞品证据"), true);
  assert.equal(rendered.html.includes("去决策"), true);
  assert.equal(rendered.primaryHrefs.includes("/attention"), true);
  assert.equal(rendered.html.includes("¥1.25"), true);
  assert.equal(rendered.html.includes("¥0.45"), true);
  assert.equal(rendered.html.includes("¥1.250000"), false);
  assert.equal(rendered.html.includes("¥0.450000"), false);
});

test("R9.7 work item renderer avoids dispatch wording in visible task-plan states", () => {
  const fixture = createP05GoldPathFixture();
  const detail = {
    ...fixture.workItemDetail,
    workitem: {
      ...fixture.workItemDetail.workitem,
      status: "ai_working" as const
    },
    agent_team: {
      plan_id: "93000000-0000-4000-8000-000000000901",
      status: "dispatching" as const,
      completed_count: 0,
      total_count: 1,
      cost_used_cny: "0.250000",
      cost_budget_cny: "1.000000",
      cost_burn_pct: 25,
      runs_capped: false,
      items: [
        {
          task_plan_item_id: "93000000-0000-4000-8000-000000000904",
          seq: 1,
          title: "整理竞品证据",
          role: "research" as const,
          plan_status: "dispatched" as const,
          status: "dispatched" as const,
          budget_share_pct: 35,
          depends_on: [],
          waiting_for_seq: [],
          cost_estimate_cny: "0.450000",
          run_id: "93000000-0000-4000-8000-000000000914",
          run_status: "running" as const,
          replay_href: "/agent-runs/93000000-0000-4000-8000-000000000914/replay"
        }
      ]
    }
  };
  const zh = renderWorkItemDetail(detail, "web", { locale: "zh-CN" });
  const en = renderWorkItemDetail(detail, "web", { locale: "en-US" });

  assert.equal(zh.html.includes("派发"), false);
  assert.equal(en.html.includes("Dispatch"), false);
});
