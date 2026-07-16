import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectTimelinePageVM, TimelineWorkItemVM } from "@workhub/contracts";

import {
  emptyTimelineUiState,
  renderTimelineErrorHtml,
  renderTimelineHtml,
  renderTimelineLoadingHtml,
  type TimelineUiState
} from "./render.js";

const PROJECT = { id: "p1", name: "试点项目", slug: "pilot" };

function item(overrides: Partial<TimelineWorkItemVM> = {}): TimelineWorkItemVM {
  return {
    id: "wi-1",
    code: "WH-1",
    title: "打通登录",
    status: "ai_working",
    depends_on: [],
    blocks_count: 0,
    overdue: false,
    ...overrides
  };
}

function vm(overrides: Partial<ProjectTimelinePageVM> = {}): ProjectTimelinePageVM {
  return {
    generated_at: "2026-07-15T00:00:00.000Z",
    project: PROJECT,
    milestones: [],
    items: [],
    critical: { blocking: [], overdue_blocking: [] },
    ...overrides
  };
}

function ui(overrides: Partial<TimelineUiState> = {}): TimelineUiState {
  return { ...emptyTimelineUiState(), ...overrides };
}

test("empty timeline (no milestones, no items) shows guidance + the coming-soon Cuu note, not a fake button", () => {
  const html = renderTimelineHtml({ vm: vm({ empty_state: "no_work_items" }), locale: "zh-CN", ui: ui() });
  assert.equal(html.includes("还没有时间线"), true);
  // 真可用的入口（新建里程碑，端点现成）而不是无接线的假按钮。
  assert.equal(html.includes("data-wb-tl-new-milestone"), true);
  // Cuu 起草计划是预留说明（E3 未合），不是能点的按钮。
  assert.equal(html.includes("即将上线"), true);
  assert.equal(/data-wb-tl-cuu-draft/.test(html), false);
});

test("gantt bars: solid for start+due, red for overdue, gray for done, dashed ghost for due-only", () => {
  const html = renderTimelineHtml({
    locale: "zh-CN",
    ui: ui(),
    vm: vm({
      items: [
        item({ id: "a", code: "WH-A", start_at: "2026-07-06T00:00:00Z", due_at: "2026-07-13T00:00:00Z" }),
        item({ id: "b", code: "WH-B", due_at: "2026-07-20T00:00:00Z", overdue: true }),
        item({ id: "c", code: "WH-C", start_at: "2026-07-06T00:00:00Z", due_at: "2026-07-10T00:00:00Z", status: "done" }),
        item({ id: "d", code: "WH-D", due_at: "2026-07-27T00:00:00Z" })
      ]
    })
  });
  assert.equal(html.includes("wh-wb-tl-gbar--normal"), true);
  assert.equal(html.includes("wh-wb-tl-gbar--overdue"), true);
  assert.equal(html.includes("wh-wb-tl-gbar--done"), true);
  // due-only item → dashed ghost placeholder.
  assert.equal(html.includes("wh-wb-tl-gbar--ghost"), true);
  // axis with week ticks is drawn.
  assert.equal(html.includes("wh-wb-tl-axis"), true);
  assert.equal(html.includes("wh-wb-tl-tick"), true);
});

test("item with neither start nor due renders 未排期, not a bar", () => {
  const html = renderTimelineHtml({
    locale: "zh-CN",
    ui: ui(),
    vm: vm({
      items: [
        item({ id: "a", code: "WH-A", due_at: "2026-07-13T00:00:00Z" }),
        item({ id: "b", code: "WH-B" })
      ]
    })
  });
  assert.equal(html.includes("wh-wb-tl-unscheduled"), true);
});

test("blocks badge + critical overdue-blocking area surface the critical path", () => {
  const html = renderTimelineHtml({
    locale: "zh-CN",
    ui: ui(),
    vm: vm({
      items: [item({ id: "a", code: "WH-A", due_at: "2026-07-10T00:00:00Z", overdue: true, blocks_count: 3 })],
      critical: { blocking: [{ work_item_id: "a", blocks_count: 3 }], overdue_blocking: [{ work_item_id: "a", blocks_count: 3 }] }
    })
  });
  assert.equal(html.includes("阻塞 3 项"), true);
  assert.equal(html.includes("这些逾期项卡着别人"), true);
  // critical chip links back to the row by id.
  assert.equal(html.includes('data-wb-tl-focus-item="a"'), true);
});

test("dependency chips resolve to the depended-on item code and expose a remove control + add picker", () => {
  const html = renderTimelineHtml({
    locale: "zh-CN",
    ui: ui(),
    vm: vm({
      items: [
        item({ id: "a", code: "WH-A", due_at: "2026-07-13T00:00:00Z", depends_on: ["b"] }),
        item({ id: "b", code: "WH-B", due_at: "2026-07-10T00:00:00Z" })
      ]
    })
  });
  // chip shows the depended-on code, not the raw id.
  assert.equal(html.includes("依赖 WH-B"), true);
  assert.equal(html.includes('data-wb-tl-dep-remove="a"'), true);
  assert.equal(html.includes('data-wb-tl-dep-on="b"'), true);
  // add-dependency picker offers the other item.
  assert.equal(html.includes('data-wb-tl-dep-add="b"'), true);
});

test("milestone grouping: items sit under their milestone; ungrouped fall into 未挂里程碑", () => {
  const html = renderTimelineHtml({
    locale: "zh-CN",
    ui: ui(),
    vm: vm({
      milestones: [{ id: "m1", project_id: "p1", title: "M1 里程碑", due_at: "2026-07-20T00:00:00Z", sort: 0, status: "open" }],
      items: [
        item({ id: "a", code: "WH-A", due_at: "2026-07-13T00:00:00Z", milestone_id: "m1" }),
        item({ id: "b", code: "WH-B", due_at: "2026-07-15T00:00:00Z" })
      ]
    })
  });
  assert.equal(html.includes("M1 里程碑"), true);
  assert.equal(html.includes("未挂里程碑"), true);
  // per-row milestone attach select carries the current selection.
  assert.equal(html.includes('data-wb-tl-attach="a"'), true);
  assert.equal(html.includes('<option value="m1" selected>'), true);
});

test("milestone head exposes done-toggle / edit / delete controls", () => {
  const html = renderTimelineHtml({
    locale: "en-US",
    ui: ui(),
    vm: vm({
      milestones: [{ id: "m1", project_id: "p1", title: "Beta", due_at: null, sort: 0, status: "open" }],
      items: [item({ due_at: "2026-07-13T00:00:00Z", milestone_id: "m1" })]
    })
  });
  assert.equal(html.includes('data-wb-tl-mtoggle="m1"'), true);
  assert.equal(html.includes('data-wb-tl-medit="m1"'), true);
  assert.equal(html.includes('data-wb-tl-mdelete="m1"'), true);
});

test("milestone create form renders when the create form is open", () => {
  const html = renderTimelineHtml({
    locale: "zh-CN",
    ui: ui({ milestoneForm: { mode: "create" }, draftTitle: "草稿名" }),
    vm: vm({ items: [item({ due_at: "2026-07-13T00:00:00Z" })] })
  });
  assert.equal(html.includes("data-wb-tl-mform"), true);
  assert.equal(html.includes('value="草稿名"'), true);
  assert.equal(html.includes("data-wb-tl-mform-save"), true);
});

test("busy state disables interactive controls", () => {
  const html = renderTimelineHtml({
    locale: "zh-CN",
    ui: ui({ busy: true }),
    vm: vm({
      milestones: [{ id: "m1", project_id: "p1", title: "M1", due_at: null, sort: 0, status: "open" }],
      items: [item({ due_at: "2026-07-13T00:00:00Z", milestone_id: "m1" })]
    })
  });
  // attach select + new-milestone button are disabled while a write is in flight.
  assert.equal(/data-wb-tl-attach="wi-1"[^>]*disabled/.test(html), true);
  assert.equal(/data-wb-tl-new-milestone disabled/.test(html), true);
});

test("error banner surfaces a humanized write error", () => {
  const html = renderTimelineHtml({
    locale: "zh-CN",
    ui: ui({ error: "这条依赖会绕成一个环" }),
    vm: vm({ items: [item({ due_at: "2026-07-13T00:00:00Z" })] })
  });
  assert.equal(html.includes("wh-wb-tl-errbar"), true);
  assert.equal(html.includes("这条依赖会绕成一个环"), true);
});

test("milestones present but no dated work items → no-dates hint, controls still render", () => {
  const html = renderTimelineHtml({
    locale: "zh-CN",
    ui: ui(),
    vm: vm({
      milestones: [{ id: "m1", project_id: "p1", title: "M1", due_at: null, sort: 0, status: "open" }],
      items: [item({ id: "a", milestone_id: "m1" })]
    })
  });
  assert.equal(html.includes("wh-wb-tl-nodates"), true);
  assert.equal(html.includes('data-wb-tl-attach="a"'), true);
});

test("OKR tile appears only when a work item has objective_ids; hover carries the ids (no name endpoint yet)", () => {
  const withOkr = renderTimelineHtml({
    locale: "zh-CN",
    ui: ui(),
    vm: vm({
      items: [
        item({ id: "a", code: "WH-A", due_at: "2026-07-13T00:00:00Z", objective_ids: ["obj-1"] }),
        item({ id: "b", code: "WH-B", due_at: "2026-07-15T00:00:00Z", objective_ids: ["obj-1", "obj-2"] }),
        item({ id: "c", code: "WH-C", due_at: "2026-07-16T00:00:00Z" })
      ]
    })
  });
  assert.equal(withOkr.includes("wh-wb-tl-okr"), true);
  // single objective → plain "OKR"; multiple → count.
  assert.equal(withOkr.includes(">OKR</span>"), true);
  assert.equal(withOkr.includes(">OKR ×2</span>"), true);
  // hover title carries the id (name not available from the VM).
  assert.equal(withOkr.includes("obj-1"), true);
  // an item without objectives gets no tile.
  assert.equal((withOkr.match(/wh-wb-tl-okr/gu) ?? []).length, 2);
});

test("loading and error state renderers", () => {
  assert.equal(renderTimelineLoadingHtml("zh-CN").includes("正在加载时间线"), true);
  assert.equal(renderTimelineErrorHtml("en-US").includes("data-wb-tl-retry"), true);
});
