import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentArmyDashboardVM, CostDashboardVM, ProjectHomePageVM } from "@workhub/contracts";

import { agentArmyDashboardView, agentArmyPlanDetailHtml, costView, projectHomeDetailHtml } from "./dashboards.js";

function agentArmyVm(over: Partial<AgentArmyDashboardVM> = {}): AgentArmyDashboardVM {
  return {
    generated_at: "2026-07-03T00:00:00.000Z",
    kpis: {
      active_team_count: 1,
      waiting_decision_count: 1,
      today_cost_cny: "1.25",
      autonomy_rate_pct: 67
    },
    plans: [{
      plan_id: "93000000-0000-4000-8000-000000000901",
      work_item_id: "93000000-0000-4000-8000-000000000101",
      work_item_code: "WH-901",
      work_item_title: "竞品价格调研",
      work_item_href: "/workitems/93000000-0000-4000-8000-000000000101",
      status: "dispatching",
      progress: { completed: 2, total: 4, label: "2/4" },
      roles: [
        { role: "research", count: 2 },
        { role: "review", count: 1 }
      ],
      statuses: [
        { status: "dispatched", count: 2 },
        { status: "needs_human", count: 1 }
      ],
      cost: { used_cny: "0.80", budget_cny: "2.00", burn_pct: 40 },
      judge: { passed: 3, total: 4, pass_rate_pct: 75 },
      oldest_blocker: {
        kind: "needs_human",
        label: "卡在：来源可信度复核 · 2h",
        age_seconds: 7200,
        href: "/attention"
      },
      updated_at: "2026-07-03T00:05:00.000Z"
    }],
    recent_escalations: [{
      id: "93000000-0000-4000-8000-000000000777",
      plan_id: "93000000-0000-4000-8000-000000000901",
      work_item_id: "93000000-0000-4000-8000-000000000101",
      title: "竞品调研卡住了",
      reason_preview: "AI 对数据来源不确定",
      created_at: "2026-07-03T00:06:00.000Z",
      href: "/attention"
    }],
    page_info: {
      plan_limit: 20,
      returned: 1,
      plans_capped: false,
      items_capped: false,
      runs_capped: false,
      escalation_limit: 5,
      escalation_returned: 1,
      escalations_capped: false
    },
    ...over
  };
}

function vm(over: Partial<ProjectHomePageVM> = {}): ProjectHomePageVM {
  return {
    generated_at: "2026-06-23T00:00:00.000Z",
    project: {
      id: "93000000-0000-4000-8000-000000000001",
      name: "R8 Workspace",
      slug: "r8-workspace",
      description: "Pilot delivery",
      owner_label: "owner",
      status: "active"
    },
    summary: { open_work_item_count: 2 },
    drive: {
      file_count: 1,
      recent_files: [
        { id: "20000000-0000-4000-8000-000000000777", name: "客户复盘.md", updated_at: "2026-06-22T00:00:00.000Z", href: "/drive?project_id=93000000-0000-4000-8000-000000000001&item_id=20000000-0000-4000-8000-000000000777" }
      ]
    },
    open_work_items: [
      { id: "10000000-0000-4000-8000-000000000901", code: "WH-1", title: "Weekly report", status: "in_progress", priority: "urgent", href: "/workitems/10000000-0000-4000-8000-000000000901" }
    ],
    actions: {
      new_task: { id: "new_task", label: "新任务", method: "GET", href: "/intake" },
      open_drive: { id: "open_drive", label: "打开网盘", method: "GET", href: "/drive?project_id=93000000-0000-4000-8000-000000000001" }
    },
    ...over
  };
}

test("S3 desktop project-home detail renders meta, work-item buttons, CTAs and back link", () => {
  const html = projectHomeDetailHtml(vm(), true);
  // 项目元信息
  assert.ok(html.includes("R8 Workspace"), "project name");
  assert.ok(html.includes("Pilot delivery"), "description");
  assert.ok(html.includes("进行中 2"), "open count");
  // 返回项目列表（不死胡同）
  assert.ok(html.includes("data-back-to-projects"), "back-to-projects control");
  // 进行中工作项可点 → 开工作项
  assert.ok(html.includes('data-open-workitem="10000000-0000-4000-8000-000000000901"'), "work item button carries id");
  assert.ok(html.includes("Weekly report"), "work item title");
  // 入口动作：新任务 + 打开网盘（label 取自服务端 VM）
  // S4b: new-task carries the project id + name so intake binds to this project and shows its context
  assert.ok(html.includes('data-open-intake="93000000-0000-4000-8000-000000000001"'), "new-task CTA carries project id");
  assert.ok(html.includes('data-open-intake-name="R8 Workspace"'), "new-task CTA carries project name");
  assert.ok(html.includes('data-open-drive="93000000-0000-4000-8000-000000000001"'), "open-drive carries project id");
  assert.ok(html.includes("新任务") && html.includes("打开网盘"), "localized action labels from VM");
  // 网盘同步是核心：项目主页直呈最近文件
  assert.ok(html.includes("最近文件 1"), "recent files count");
  assert.ok(html.includes("客户复盘.md"), "recent file name");
});

test("S3 desktop project-home shows a +more hint when the true count exceeds the shown list", () => {
  const html = projectHomeDetailHtml(vm({ summary: { open_work_item_count: 50 } }), false);
  assert.ok(html.includes("+49 more open items not shown here — open the project to review all."), "truncation hint (50 total - 1 shown)");
  assert.ok(!html.includes("you cannot view"), "does not guess this is a permission problem");
});

test("DF-1 desktop project-home open count uses the全量 total + shows 你可处理 split (matches web M5)", () => {
  // total(8) > viewable(3): 5 items hidden by visibility. The head must read the full total
  // (matching the /projects list card) and disclose the viewable subset, not contradict the list.
  const html = projectHomeDetailHtml(vm({ summary: { open_work_item_count: 3, total_open_work_item_count: 8 } }), true);
  assert.ok(html.includes("进行中 8 · 你可处理 3"), "head uses total with viewable split");
  assert.ok(!html.includes("进行中 3 ·"), "head does not headline the viewable count");
  // hidden = total(8) - shown(1) = 7, but the route cannot know whether this is permissions or list truncation.
  assert.ok(html.includes("还有 7 条进行中工作未在此处显示，进入项目查看全部。"), "more-note computed off the total");
  assert.ok(!html.includes("暂无权限查看"), "does not guess this is a permission problem");
});

test("DF-3 desktop project-home notes when recent files are fewer than the project total", () => {
  const html = projectHomeDetailHtml(vm({ drive: { file_count: 12, recent_files: [
    { id: "20000000-0000-4000-8000-000000000777", name: "客户复盘.md", updated_at: "2026-06-22T00:00:00.000Z", href: "/drive?project_id=93000000-0000-4000-8000-000000000001" }
  ] } }), false);
  assert.ok(html.includes("+11 more files not shown — open the drive."), "files overflow note (12 total - 1 shown)");
});

test("desktop project-home recent files keep their file deep-link when opening drive", () => {
  const html = projectHomeDetailHtml(vm(), true);

  assert.ok(html.includes('data-open-drive="93000000-0000-4000-8000-000000000001"'), "recent file still opens the project drive");
  assert.ok(
    html.includes('data-open-drive-route="/drive?project_id=93000000-0000-4000-8000-000000000001&amp;item_id=20000000-0000-4000-8000-000000000777"'),
    "recent file preserves its item_id deep-link"
  );
});

test("S3 desktop project-home shows an empty state when there is no open work", () => {
  const html = projectHomeDetailHtml(vm({ summary: { open_work_item_count: 0 }, open_work_items: [] }), true);
  assert.ok(html.includes("暂无进行中的工作"), "empty state copy");
  // 空态仍保留入口动作（新任务）——不是死胡同
  assert.ok(html.includes("data-open-intake"), "new-task CTA stays in empty state");
});

test("L16: cost trend bars carry aria-labels + a visible date-range/peak caption (not tooltip-only)", () => {
  // costView reads only a subset of the VM; cast a minimal fixture for the trend render.
  const costVm = {
    total_cost_cny: "1.23",
    token_in: 100,
    token_out: 200,
    trend: [
      { date: "2026-06-20", cost_cny: "0.10", tokens: 10 },
      { date: "2026-06-21", cost_cny: "0.50", tokens: 40 },
      { date: "2026-06-22", cost_cny: "0.30", tokens: 25 }
    ],
    by_workitem: []
  } as unknown as CostDashboardVM;
  const html = costView(costVm, true);
  // each bar exposes its data to keyboard/screen-reader, not just the title tooltip
  assert.match(html, /<span class="wh-spot-bar" role="img" aria-label="2026-06-21 · ¥0\.50"/u);
  // visible caption: start–end range + peak value (peak day is 2026-06-21 @ ¥0.50)
  assert.ok(html.includes("2026-06-20 – 2026-06-22"), "date-range caption");
  assert.ok(html.includes("峰值 ¥0.50"), "peak caption");
  assert.match(html, /<div class="wh-spot-bars" role="group" aria-label="近 14 天花费趋势"/u);
});

test("R9.6 desktop agent army list renders compressed plan rows and KPI decisions link", () => {
  const html = agentArmyDashboardView(agentArmyVm(), true);

  assert.match(html, /data-spot-agent-dashboard="true"/u);
  assert.match(html, /data-spot-agent-kpi="waiting_decision"/u);
  assert.match(html, /data-open-capability="approvals"/u);
  assert.match(html, /data-open-agent-plan="93000000-0000-4000-8000-000000000901"/u);
  assert.ok(html.includes("竞品价格调研"), "plan title");
  assert.ok(html.includes("2/4"), "progress label");
  assert.ok(html.includes("调研 2"), "localized role badge");
  assert.ok(html.includes("等你决定 1"), "localized status badge");
  assert.ok(html.includes("卡在：来源可信度复核 · 2h"), "oldest blocker");
  assert.ok(html.includes("最近动态"), "recent escalation section");
  assert.doesNotMatch(html, /backdrop-filter|transparent/u);
});

test("R9.6 desktop agent army empty state has an intake CTA without fake plans", () => {
  const html = agentArmyDashboardView(agentArmyVm({ plans: [], recent_escalations: [], empty_state: "no_agent_armies" }), false);

  assert.match(html, /data-spot-agent-dashboard-empty="no_agent_armies"/u);
  assert.ok(html.includes("No Cuu squads are running yet."), "english empty copy");
  assert.match(html, /data-open-capability="intake"/u);
  assert.doesNotMatch(html, /data-open-agent-plan=/u);
});

test("R9.6 desktop agent army detail morph keeps decisions in the inbox", () => {
  const plan = agentArmyVm().plans[0];
  assert.ok(plan);
  const html = agentArmyPlanDetailHtml(plan, false);

  assert.match(html, /data-spot-agent-plan-detail="93000000-0000-4000-8000-000000000901"/u);
  assert.match(html, /data-back-to-agent-armies/u);
  assert.match(html, /data-open-workitem="93000000-0000-4000-8000-000000000101"/u);
  assert.match(html, /data-open-capability="approvals"/u);
  assert.ok(html.includes("Needs you"), "decision status label");
  assert.ok(html.includes("Judge pass 75%"), "judge metric");
  assert.ok(!html.includes("Approve"), "detail view does not embed decision actions");
});
