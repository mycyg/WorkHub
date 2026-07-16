import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectTimelinePageVM, TimelineWorkItemVM } from "@workhub/contracts";

import {
  columnOfStatus,
  emptyKanbanUiState,
  renderKanbanErrorHtml,
  renderKanbanHtml,
  renderKanbanLoadingHtml,
  resolveKanbanDrop,
  type KanbanUiState
} from "./render.js";

const PROJECT = { id: "p1", name: "试点项目", slug: "pilot" };

function item(overrides: Partial<TimelineWorkItemVM> = {}): TimelineWorkItemVM {
  return {
    id: "wi-1",
    code: "WH-1",
    title: "打通登录",
    status: "spec_ready",
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

function ui(overrides: Partial<KanbanUiState> = {}): KanbanUiState {
  return { ...emptyKanbanUiState(), ...overrides };
}

test("columnOfStatus maps the ten real statuses onto the four columns", () => {
  assert.equal(columnOfStatus("intake"), "todo");
  assert.equal(columnOfStatus("ai_clarifying"), "todo");
  assert.equal(columnOfStatus("spec_ready"), "todo");
  assert.equal(columnOfStatus("ai_working"), "doing");
  assert.equal(columnOfStatus("pm_mode"), "doing");
  assert.equal(columnOfStatus("escalated"), "doing");
  assert.equal(columnOfStatus("in_review"), "review");
  assert.equal(columnOfStatus("merged"), "done");
  assert.equal(columnOfStatus("done"), "done");
  assert.equal(columnOfStatus("cancelled"), "done");
});

test("board groups items into their columns with per-column counts and a total", () => {
  const html = renderKanbanHtml({
    locale: "zh-CN",
    ui: ui(),
    vm: vm({
      items: [
        item({ id: "a", code: "WH-A", status: "spec_ready" }),
        item({ id: "b", code: "WH-B", status: "ai_working" }),
        item({ id: "c", code: "WH-C", status: "in_review" }),
        item({ id: "d", code: "WH-D", status: "merged" }),
        item({ id: "e", code: "WH-E", status: "cancelled" })
      ]
    })
  });
  assert.equal(html.includes("5 个任务"), true);
  // each card carries its id/status/from-column for the DnD resolver.
  assert.equal(html.includes('data-wb-kb-id="a"'), true);
  assert.equal(html.includes('data-wb-kb-status="spec_ready"'), true);
  assert.equal(html.includes('data-wb-kb-from="todo"'), true);
  assert.equal(html.includes('data-wb-kb-col="doing"'), true);
  // cancelled + merged both land in Done → its count is 2.
  const doneList = html.slice(html.indexOf('data-wb-kb-col="done"'));
  assert.equal(doneList.includes('data-wb-kb-id="d"'), true);
  assert.equal(doneList.includes('data-wb-kb-id="e"'), true);
});

test("card shows code, precise status chip, due with overdue dot, assignee initial and blocks badge", () => {
  const html = renderKanbanHtml({
    locale: "zh-CN",
    ui: ui(),
    vm: vm({
      items: [
        item({
          id: "a",
          code: "WH-A",
          title: "Hero 区块开发",
          status: "ai_working",
          due_at: "2026-07-14T00:00:00Z",
          overdue: true,
          blocks_count: 3,
          assignee: { user_id: "u1", label: "林工" }
        })
      ]
    })
  });
  assert.equal(html.includes("WH-A"), true);
  assert.equal(html.includes("Hero 区块开发"), true);
  // precise chip reflects real status even though the column is coarse.
  assert.equal(html.includes("wh-wb-kb-status--ai_working"), true);
  assert.equal(html.includes("进行中"), true);
  // overdue → red dot + 逾期 label.
  assert.equal(html.includes("wh-wb-kb-due--over"), true);
  assert.equal(html.includes("逾期"), true);
  // assignee avatar initial (first grapheme).
  assert.equal(html.includes(">林</span>"), true);
  assert.equal(html.includes("阻塞 3 项"), true);
});

test("unassigned + undated card degrades honestly (未指派 / 未定期), not a fake owner", () => {
  const html = renderKanbanHtml({
    locale: "zh-CN",
    ui: ui(),
    vm: vm({ items: [item({ id: "a", status: "spec_ready" })] })
  });
  assert.equal(html.includes("未指派"), true);
  assert.equal(html.includes("未定期"), true);
});

test("empty project shows guidance pointing at chat/intake, not a fake create-task button", () => {
  const html = renderKanbanHtml({ locale: "zh-CN", ui: ui(), vm: vm({ items: [] }) });
  assert.equal(html.includes("还没有任务"), true);
  assert.equal(html.includes("项目主区对话"), true);
  assert.equal(/data-wb-kb-create/.test(html), false);
});

test("busy state drops the draggable attribute so a dispatch in flight can't spawn another drag", () => {
  const html = renderKanbanHtml({
    locale: "zh-CN",
    ui: ui({ busy: true }),
    vm: vm({ items: [item({ id: "a", status: "spec_ready" })] })
  });
  assert.equal(html.includes('draggable="true"'), false);
});

test("notice banner surfaces a humanized drag message with its tone", () => {
  const html = renderKanbanHtml({
    locale: "zh-CN",
    ui: ui({ notice: "评审是 AI 跑完自动进入的", noticeTone: "info" }),
    vm: vm({ items: [item({ id: "a", status: "in_review" })] })
  });
  assert.equal(html.includes("wh-wb-kb-notice--info"), true);
  assert.equal(html.includes("评审是 AI 跑完自动进入的"), true);
});

// —— 状态机映射（resolveKanbanDrop）：唯一合法转移 = 待开工→进行中 = 派发；其余弹回 ——

test("Ready → In progress resolves to a real dispatch (the one legal drag)", () => {
  const res = resolveKanbanDrop({ status: "spec_ready", fromColumn: "todo", toColumn: "doing", locale: "zh-CN" });
  assert.deepEqual(res, { kind: "dispatch" });
});

test("clarifying item → In progress bounces (must be clarified in chat first)", () => {
  const res = resolveKanbanDrop({ status: "ai_clarifying", fromColumn: "todo", toColumn: "doing", locale: "zh-CN" });
  assert.equal(res.kind, "bounce");
  assert.equal(res.kind === "bounce" && res.message.includes("澄清"), true);
});

test("anything → In review bounces with the auto-review explanation", () => {
  const res = resolveKanbanDrop({ status: "ai_working", fromColumn: "doing", toColumn: "review", locale: "zh-CN" });
  assert.equal(res.kind, "bounce");
  assert.equal(res.kind === "bounce" && res.message.includes("自动"), true);
});

test("In review → Done bounces toward the proposal-approve path", () => {
  const res = resolveKanbanDrop({ status: "in_review", fromColumn: "review", toColumn: "done", locale: "zh-CN" });
  assert.equal(res.kind, "bounce");
  assert.equal(res.kind === "bounce" && res.message.includes("提议"), true);
});

test("In review → In progress bounces toward Request-changes, not a silent transition", () => {
  const res = resolveKanbanDrop({ status: "in_review", fromColumn: "review", toColumn: "doing", locale: "zh-CN" });
  assert.equal(res.kind, "bounce");
  assert.equal(res.kind === "bounce" && res.message.includes("要求修改"), true);
});

test("backward drag into To do bounces", () => {
  const res = resolveKanbanDrop({ status: "ai_working", fromColumn: "doing", toColumn: "todo", locale: "zh-CN" });
  assert.equal(res.kind, "bounce");
});

test("same-column drop is a silent no-op (no ordering semantics)", () => {
  const res = resolveKanbanDrop({ status: "ai_working", fromColumn: "doing", toColumn: "doing", locale: "zh-CN" });
  assert.deepEqual(res, { kind: "noop" });
});

test("en-US bounce messages are in English (no zh leaking into en UI)", () => {
  const res = resolveKanbanDrop({ status: "in_review", fromColumn: "review", toColumn: "done", locale: "en-US" });
  assert.equal(res.kind === "bounce" && /[A-Za-z]/.test(res.message) && !/[一-鿿]/.test(res.message), true);
});

test("loading and error state renderers", () => {
  assert.equal(renderKanbanLoadingHtml("zh-CN").includes("正在加载任务看板"), true);
  assert.equal(renderKanbanErrorHtml("en-US").includes("data-wb-kb-retry"), true);
});
