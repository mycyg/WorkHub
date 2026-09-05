import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectTimelinePageVM, TimelineWorkItemVM } from "@workhub/contracts";

import type { SchedulePlanDraft } from "./api.js";
import {
  computeScheduleMonth,
  computeScheduleWeek,
  emptyScheduleUiState,
  emptySchedulePlanUiState,
  renderScheduleErrorHtml,
  renderScheduleHtml,
  renderScheduleLoadingHtml,
  weekOffsetForDay,
  type SchedulePlanDraftsState,
  type SchedulePlanUiState,
  type ScheduleUiState
} from "./render.js";

const PROJECT = { id: "p1", name: "官网改版", slug: "site" };

function item(overrides: Partial<TimelineWorkItemVM> = {}): TimelineWorkItemVM {
  return {
    id: "wi-1",
    code: "WH-1",
    title: "隐私区文案",
    status: "ai_working",
    depends_on: [],
    blocks_count: 0,
    overdue: false,
    ...overrides
  };
}

function vm(overrides: Partial<ProjectTimelinePageVM> = {}): ProjectTimelinePageVM {
  return {
    // 2026-07-15 是周三。
    generated_at: "2026-07-15T00:00:00.000Z",
    project: PROJECT,
    milestones: [],
    items: [],
    critical: { blocking: [], overdue_blocking: [] },
    ...overrides
  };
}

function ui(overrides: Partial<ScheduleUiState> = {}): ScheduleUiState {
  return { ...emptyScheduleUiState(), ...overrides };
}

function draft(overrides: Partial<SchedulePlanDraft> = {}): SchedulePlanDraft {
  return {
    id: "d1",
    status: "pending_review",
    intent_md: "两周内完成首页改版",
    rationale_md: null,
    review_reason_md: null,
    milestones: [],
    items: [],
    result: null,
    created_at: "2026-07-14T00:00:00Z",
    updated_at: "2026-07-14T00:00:00Z",
    ...overrides
  };
}

function planUi(overrides: Partial<SchedulePlanUiState> = {}): SchedulePlanUiState {
  return { ...emptySchedulePlanUiState(), ...overrides };
}

function render(input: {
  vm?: ProjectTimelinePageVM;
  drafts?: SchedulePlanDraft[];
  draftsState?: SchedulePlanDraftsState;
  plan?: SchedulePlanUiState;
  locale?: "zh-CN" | "en-US";
  ui?: ScheduleUiState;
}) {
  return renderScheduleHtml({
    vm: input.vm ?? vm(),
    drafts: input.drafts ?? [],
    draftsState: input.draftsState ?? "forbidden",
    plan: input.plan ?? planUi(),
    locale: input.locale ?? "zh-CN",
    ui: input.ui ?? ui()
  });
}

test("computeScheduleWeek: Monday-start 7-day week around the reference date, with todayKey", () => {
  const week = computeScheduleWeek("2026-07-15T09:00:00.000Z", 0);
  assert.equal(week.days.length, 7);
  // 2026-07-15 周三 → 本周一 = 07-13, 周日 = 07-19。
  assert.equal(week.rangeStart.toISOString().slice(0, 10), "2026-07-13");
  assert.equal(week.rangeEnd.toISOString().slice(0, 10), "2026-07-19");
  assert.equal(week.todayKey, "2026-07-15");
});

test("computeScheduleWeek: weekOffset shifts by whole weeks", () => {
  const prev = computeScheduleWeek("2026-07-15T00:00:00.000Z", -1);
  const next = computeScheduleWeek("2026-07-15T00:00:00.000Z", 1);
  assert.equal(prev.rangeStart.toISOString().slice(0, 10), "2026-07-06");
  assert.equal(next.rangeStart.toISOString().slice(0, 10), "2026-07-20");
});

test("weekly grid: 7 day columns, today highlighted, weekend columns marked", () => {
  const html = render({});
  assert.equal((html.match(/wh-wb-sc-col/gu) ?? []).length >= 7, true);
  assert.equal(html.includes("wh-wb-sc-dh--today"), true);
  assert.equal(html.includes("wh-wb-sc-col--weekend"), true);
  // week range label present.
  assert.equal(html.includes("7 月 13 日"), true);
});

// R17-G5 #28：月视图 + 周/月切换。
test("computeScheduleMonth: 6x7 Monday-start grid covering the focused month", () => {
  const month = computeScheduleMonth("2026-07-15T00:00:00.000Z", 0);
  assert.equal(month.year, 2026);
  assert.equal(month.monthIndex, 6); // July
  assert.equal(month.weeks.length, 6);
  assert.equal(month.weeks[0]!.length, 7);
  // 2026-07-01 是周三 → 网格起于该周周一 2026-06-29。
  assert.equal(month.weeks[0]![0]!.toISOString().slice(0, 10), "2026-06-29");
  assert.equal(month.todayKey, "2026-07-15");
});

test("computeScheduleMonth: monthOffset shifts whole months", () => {
  const next = computeScheduleMonth("2026-07-15T00:00:00.000Z", 1);
  assert.equal(next.monthIndex, 7); // August
});

test("weekOffsetForDay: day in a later week resolves to that week's offset", () => {
  // 今天 2026-07-15（本周一 07-13）；目标 2026-07-27（那周一 07-27）→ 偏移 +2 周。
  assert.equal(weekOffsetForDay("2026-07-15T00:00:00.000Z", "2026-07-27"), 2);
  assert.equal(weekOffsetForDay("2026-07-15T00:00:00.000Z", "2026-07-15"), 0);
});

test("month view renders the 6x7 grid, mode chips, and compressed task dots", () => {
  const html = render({
    ui: ui({ viewMode: "month" }),
    vm: vm({ items: [item({ id: "a", due_at: "2026-07-16T02:00:00Z" })] })
  });
  assert.equal(html.includes("wh-wb-sc-month"), true);
  assert.equal((html.match(/data-wb-sc-day="/gu) ?? []).length, 42);
  assert.equal(html.includes('data-wb-sc-mode="week"'), true);
  assert.equal(html.includes('data-wb-sc-mode="month"'), true);
  // 有任务的那天渲一个小点 + 该单元格带 data-wb-sc-day 供点击回周视图。
  assert.equal(html.includes("wh-wb-sc-mdot"), true);
  assert.equal(html.includes('data-wb-sc-day="2026-07-16"'), true);
  // 月标题 + 不渲周网格。
  assert.equal(html.includes("2026 年 7 月"), true);
  assert.equal(html.includes("wh-wb-sc-grid"), false);
});

test("work items land on their due day; the card carries the id and status meta", () => {
  const html = render({
    vm: vm({
      items: [
        item({ id: "a", code: "WH-A", title: "Hero 联调", due_at: "2026-07-16T02:00:00Z", assignee: { user_id: "u", label: "小林" } }),
        // out-of-week item (next week) must not appear in this week's grid.
        item({ id: "b", code: "WH-B", due_at: "2026-07-25T00:00:00Z" })
      ]
    })
  });
  assert.equal(html.includes('data-wb-sc-id="a"'), true);
  assert.equal(html.includes("Hero 联调"), true);
  assert.equal(html.includes("小林"), true);
  assert.equal(html.includes('data-wb-sc-id="b"'), false);
});

// R17-G5 #26：无 due_at 的工作项不再静默丢弃（也不放到假的某一天）——落到底部「未定期」小列。
test("undated items surface in the 未定期 strip (not silently dropped, not on a fake day)", () => {
  const html = render({ vm: vm({ items: [item({ id: "a", code: "WH-A", title: "待排期项" })] }) });
  assert.equal(html.includes("wh-wb-sc-undated"), true);
  assert.equal(html.includes("未定期"), true);
  assert.equal(html.includes('data-wb-sc-id="a"'), true);
  assert.equal(html.includes("待排期项"), true);
  // 网格列里没有它（不放到假的某一天）——周历单元格是空的。
  assert.equal(/<div class="wh-wb-sc-cells">\s*<\/div>/u.test(html), true);
});

test("schedule with no undated items renders no 未定期 strip", () => {
  const html = render({ vm: vm({ items: [item({ id: "a", due_at: "2026-07-16T02:00:00Z" })] }) });
  assert.equal(html.includes("wh-wb-sc-undated"), false);
});

test("overdue task shows an overdue dot", () => {
  const html = render({
    vm: vm({ items: [item({ id: "a", due_at: "2026-07-14T00:00:00Z", overdue: true })] })
  });
  assert.equal(html.includes("wh-wb-sc-overdot"), true);
});

test("milestone due in the visible week is flagged in the day column head", () => {
  const html = render({
    vm: vm({
      milestones: [{ id: "m1", project_id: "p1", title: "Beta 里程碑", due_at: "2026-07-17T00:00:00Z", sort: 0, status: "open" }]
    })
  });
  assert.equal(html.includes("wh-wb-sc-ms-flag"), true);
  assert.equal(html.includes("Beta 里程碑"), true);
});

test("plan (forbidden): no manage permission → milestone fallback, no draft/compose affordance", () => {
  const html = render({
    draftsState: "forbidden",
    vm: vm({
      milestones: [{ id: "m1", project_id: "p1", title: "M1 里程碑", due_at: "2026-07-20T00:00:00Z", sort: 0, status: "open" }]
    })
  });
  assert.equal(html.includes("M1 里程碑"), true);
  // 无管理权：不给「起草」按钮，也不列草案。
  assert.equal(html.includes("data-wb-sc-plan-new"), false);
  assert.equal(html.includes("data-wb-sc-plan-list"), false);
});

test("plan (ready, empty list): shows the draft-with-Cuu entry button and an empty hint", () => {
  const html = render({ draftsState: "ready", drafts: [], plan: planUi({ mode: "list" }) });
  assert.equal(html.includes("data-wb-sc-plan-new"), true);
  assert.equal(html.includes("用 Cuu 起草计划"), true);
  assert.equal(html.includes("data-wb-sc-plan-list-empty"), true);
});

test("plan (ready, list): drafts render with status chips incl. pending_review, clickable", () => {
  const html = render({
    draftsState: "ready",
    drafts: [draft({ id: "d1", status: "pending_review", intent_md: "两周内完成首页改版", milestones: [{ ref: "m1", title: "首页上线", due_at: null, sort: 0 }] })],
    plan: planUi({ mode: "list" })
  });
  assert.equal(html.includes('data-wb-sc-plan-draft="d1"'), true);
  assert.equal(html.includes('data-wb-sc-plan-draft-status="pending_review"'), true);
  assert.equal(html.includes("待审阅"), true);
  assert.equal(html.includes("两周内完成首页改版"), true);
});

test("plan (ready, compose): compose form has the intent textarea + submit/cancel", () => {
  const html = render({ draftsState: "ready", plan: planUi({ mode: "compose", intentDraft: "做个注册流程" }) });
  assert.equal(html.includes("data-wb-sc-plan-compose"), true);
  assert.equal(html.includes("data-wb-sc-plan-compose-intent"), true);
  assert.equal(html.includes("data-wb-sc-plan-compose-submit"), true);
  assert.equal(html.includes("做个注册流程"), true);
});

test("plan (ready, detail pending_review): shows milestones/items/rationale + approve & reject actions", () => {
  const html = render({
    draftsState: "ready",
    drafts: [draft({
      id: "d1",
      status: "pending_review",
      rationale_md: "先做 Hero，再做隐私区。",
      milestones: [{ ref: "m1", title: "首页上线", due_at: "2026-07-20T00:00:00Z", sort: 0 }],
      items: [{ ref: "i1", title: "Hero 联调", objective_md: "把首页 Hero 联调好", due_at: null, milestone_ref: "m1", depends_on_refs: [], assignee_suggestion: null }]
    })],
    plan: planUi({ mode: "detail", selectedDraftId: "d1" })
  });
  assert.equal(html.includes("首页上线"), true);
  assert.equal(html.includes("Hero 联调"), true);
  assert.equal(html.includes("先做 Hero"), true);
  assert.equal(html.includes("data-wb-sc-plan-approve"), true);
  assert.equal(html.includes("data-wb-sc-plan-reject"), true);
  assert.equal(html.includes("data-wb-sc-plan-back"), true);
});

test("plan (ready, detail approved): shows the materialize action", () => {
  const html = render({
    draftsState: "ready",
    drafts: [draft({ id: "d1", status: "approved" })],
    plan: planUi({ mode: "detail", selectedDraftId: "d1" })
  });
  assert.equal(html.includes("data-wb-sc-plan-materialize"), true);
  assert.equal(html.includes("写入时间线"), true);
});

test("plan (ready, detail rejecting): reject reason box + confirm/cancel", () => {
  const html = render({
    draftsState: "ready",
    drafts: [draft({ id: "d1", status: "pending_review" })],
    plan: planUi({ mode: "detail", selectedDraftId: "d1", rejecting: true })
  });
  assert.equal(html.includes("data-wb-sc-plan-reject-reason"), true);
  assert.equal(html.includes("data-wb-sc-plan-reject-confirm"), true);
  assert.equal(html.includes("data-wb-sc-plan-reject-cancel"), true);
});

test("plan (ready, detail materialized): shows the result summary, no actions", () => {
  const html = render({
    draftsState: "ready",
    drafts: [draft({ id: "d1", status: "materialized", result: { milestone_ids: ["m1", "m2"], work_item_ids: ["w1"], dependency_count: 1 } })],
    plan: planUi({ mode: "detail", selectedDraftId: "d1" })
  });
  assert.equal(html.includes("data-wb-sc-plan-result"), true);
  assert.equal(html.includes("已写入时间线"), true);
  assert.equal(html.includes("data-wb-sc-plan-approve"), false);
});

test("plan: notice and error banners render when present", () => {
  const html = render({ draftsState: "ready", plan: planUi({ notice: "草案已生成，待你审批。", error: "AI 项目规划尚未配置。" }) });
  assert.equal(html.includes("data-wb-sc-plan-notice"), true);
  assert.equal(html.includes("草案已生成"), true);
  assert.equal(html.includes("data-wb-sc-plan-error"), true);
  assert.equal(html.includes("AI 项目规划尚未配置"), true);
});

test("week navigation controls (prev / today / next) are present", () => {
  const html = render({});
  assert.equal(html.includes("data-wb-sc-prev"), true);
  assert.equal(html.includes("data-wb-sc-today"), true);
  assert.equal(html.includes("data-wb-sc-next"), true);
});

test("en-US locale renders English day-of-week headers and range", () => {
  const html = render({ locale: "en-US" });
  assert.equal(html.includes("Mon"), true);
  assert.equal(html.includes("Jul 13"), true);
});

test("loading and error state renderers", () => {
  assert.equal(renderScheduleLoadingHtml("zh-CN").includes("正在加载日程"), true);
  assert.equal(renderScheduleErrorHtml("en-US").includes("data-wb-sc-retry"), true);
});
