import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectTimelinePageVM, TimelineWorkItemVM } from "@workhub/contracts";

import type { SchedulePlanDraft } from "./api.js";
import {
  computeScheduleWeek,
  emptyScheduleUiState,
  renderScheduleErrorHtml,
  renderScheduleHtml,
  renderScheduleLoadingHtml,
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

function render(input: {
  vm?: ProjectTimelinePageVM;
  planDraft?: SchedulePlanDraft;
  locale?: "zh-CN" | "en-US";
  ui?: ScheduleUiState;
}) {
  return renderScheduleHtml({
    vm: input.vm ?? vm(),
    planDraft: input.planDraft,
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

test("undated items are simply not placed (no fake day)", () => {
  const html = render({ vm: vm({ items: [item({ id: "a", code: "WH-A" })] }) });
  assert.equal(html.includes('data-wb-sc-id="a"'), false);
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

test("plan doc: an approved draft shows its milestones + rationale and an Approved tag", () => {
  const planDraft: SchedulePlanDraft = {
    id: "d1",
    status: "approved",
    rationale_md: "两周内完成首页改版。\n先做 Hero，再做隐私区。",
    updated_at: "2026-07-14T00:00:00Z",
    milestones: [{ ref: "m1", title: "首页上线", due_at: "2026-07-20T00:00:00Z", sort: 0 }]
  };
  const html = render({ planDraft });
  assert.equal(html.includes("已批准"), true);
  assert.equal(html.includes("首页上线"), true);
  assert.equal(html.includes("两周内完成首页改版"), true);
  assert.equal(html.includes("先做 Hero"), true);
});

test("plan doc: no approved draft → falls back to timeline milestones with an honest note", () => {
  const html = render({
    vm: vm({
      milestones: [{ id: "m1", project_id: "p1", title: "M1 里程碑", due_at: "2026-07-20T00:00:00Z", sort: 0, status: "open" }]
    })
  });
  assert.equal(html.includes("还没有已批准的项目计划"), true);
  assert.equal(html.includes("M1 里程碑"), true);
});

test("plan doc: neither approved plan nor milestones → guidance, not a blank pane", () => {
  const html = render({ vm: vm({ milestones: [], items: [] }) });
  assert.equal(html.includes("也还没有里程碑") || html.includes("还没有已批准的项目计划"), true);
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
