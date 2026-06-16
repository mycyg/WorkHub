import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarPageVM, ScheduleBlockVM } from "@workhub/contracts";

import { renderTeamCalendarHtml, teamCalendarCss } from "./team-calendar.js";

function block(partial: Partial<ScheduleBlockVM> = {}): ScheduleBlockVM {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    kind: "work_item_due",
    title: "渠道周报 Q2 截稿",
    starts_at: "2026-06-15T09:30:00.000Z",
    ends_at: "2026-06-15T10:00:00.000Z",
    all_day: false,
    status: "today",
    severity: "high",
    ...partial
  };
}

function page(partial: Partial<CalendarPageVM> = {}): CalendarPageVM {
  const blocks = partial.blocks ?? [block()];
  return {
    generated_at: "2026-06-15T00:00:00.000Z",
    actor_user_id: "40000000-0000-4000-8000-000000000001",
    scope: { date: "2026-06-15", view: "day", range_start: "2026-06-15T00:00:00.000Z", range_end: "2026-06-15T23:59:59.000Z" },
    summary: { block_count: blocks.length, overdue_count: 0, today_count: blocks.length, week_count: blocks.length },
    days: [{ date: "2026-06-15", blocks }],
    blocks,
    ...partial
  };
}

test("team calendar renders the empty state when there is nothing scheduled", () => {
  const html = renderTeamCalendarHtml({ page: page({ days: [], blocks: [], empty_state: "no_schedule_blocks" }), locale: "zh-CN" });
  assert.match(html, /data-tcal-empty="true"/u);
  assert.match(html, /没有排期/u);
  assert.doesNotMatch(html, /wh-tcal-day"/u);
});

test("team calendar renders day card, HH:MM clock, kind tag + status, and today badge", () => {
  const html = renderTeamCalendarHtml({ page: page(), locale: "zh-CN" });
  assert.match(html, /渠道周报 Q2 截稿/u);
  // HH:MM 抠自 ISO,确定性不受时区影响
  assert.match(html, /class="wh-tcal-time">09:30</u);
  assert.match(html, /wh-tcal-tag--due">截止</u);
  assert.match(html, /wh-tcal-status--today">今天</u);
  // scope.date 当天 → 今天徽标
  assert.match(html, /wh-tcal-today">今天</u);
});

test("team calendar makes blocks with target_href clickable via the existing nav pipeline", () => {
  const html = renderTeamCalendarHtml({
    page: page({ blocks: [block({ target_href: "/workitem/abc", description: "等你拍板" })] }),
    locale: "zh-CN"
  });
  assert.match(html, /class="wh-tcal-block wh-tcal-block--link gl-press"[^>]*data-action-href="\/workitem\/abc"[^>]*data-href="\/workitem\/abc"/u);
  assert.match(html, /wh-tcal-block-desc">等你拍板</u);
});

test("team calendar localizes labels and shows all-day + overdue chip (en)", () => {
  const html = renderTeamCalendarHtml({
    page: page({
      blocks: [block({ kind: "meeting_followup", all_day: true, status: "overdue" })],
      summary: { block_count: 1, overdue_count: 1, today_count: 0, week_count: 1 }
    }),
    locale: "en-US"
  });
  assert.match(html, /class="wh-tcal-time">All day</u);
  assert.match(html, /wh-tcal-tag--meeting">Follow-up</u);
  assert.match(html, /wh-tcal-status--overdue">Overdue</u);
  assert.match(html, /wh-tcal-chip--alert"><b>1<\/b>overdue/u);
  assert.ok(teamCalendarCss.includes(".wh-tcal-day{"));
});
