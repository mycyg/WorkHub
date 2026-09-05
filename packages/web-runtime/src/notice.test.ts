import assert from "node:assert/strict";
import test from "node:test";

import {
  actionErrorNotice,
  actionPendingNotice,
  actionSuccessNotice,
  desktopRequiredNotice,
  dirtyGuardRefreshAction,
  fieldValueRequiredNotice,
  intakeOptionRequiredNotice,
  localePersistenceFailedNotice,
  mergeConflictNotice,
  reasonRequiredNotice,
  selectionNotice,
  showRouteNotice,
  startAgentRunQueuedNoticeBody,
  sseDirtyGuardNotice,
  sseRefreshNotice,
  taskPlanDraftedNoticeBody
} from "./notice.js";

test("R4.21 notice factories produce structured bilingual QA hooks", () => {
  assert.equal(actionSuccessNotice("en-US", "Done", "approve").kind, "action_success");
  assert.equal(actionErrorNotice("zh-CN", new Error("失败"), "merge").tone, "danger");
  assert.equal(actionPendingNotice("en-US").source, "client");
  assert.equal(desktopRequiredNotice("zh-CN").kind, "desktop_required");
  assert.equal(reasonRequiredNotice("en-US").kind, "reason_required");
  assert.equal(fieldValueRequiredNotice("en-US").kind, "field_value_required");
  assert.equal(intakeOptionRequiredNotice("zh-CN").kind, "intake_option_required");
  assert.equal(localePersistenceFailedNotice("en-US").kind, "locale_persistence_failed");
  assert.equal(selectionNotice("en-US", "Risk first").actionId, "select_option");
  assert.equal(mergeConflictNotice("zh-CN", "merge").actionId, "merge");
  assert.equal(sseDirtyGuardNotice("en-US", "proposal.merged", "proposal").kind, "sse_dirty_guard");
});

test("R4.21 SSE notice classifies budget warning separately", () => {
  assert.equal(sseRefreshNotice("en-US", "budget.warning", "me").kind, "budget_warning");
  assert.equal(sseRefreshNotice("en-US", "proposal.merged", "proposal").kind, "sse_refresh");
});

test("R4.21 dirty guard refresh action escapes href and label", () => {
  const html = dirtyGuardRefreshAction("en-US", "/proposals/p-1?x=<bad>");
  assert.match(html, /data-r4-dirty-refresh="true"/u);
  assert.match(html, /\/proposals\/p-1\?x=&lt;bad&gt;/u);
});

test("R9.7 task-plan drafted notices avoid dispatch internals", () => {
  assert.equal(taskPlanDraftedNoticeBody("zh-CN").includes("派发"), false);
  assert.equal(taskPlanDraftedNoticeBody("en-US").includes("dispatch"), false);
  assert.equal(taskPlanDraftedNoticeBody("zh-CN"), "任务计划已生成，请先审阅再开始执行。");
  assert.equal(taskPlanDraftedNoticeBody("en-US"), "Task plan drafted. Review the plan before work starts.");
});

test("R9.7 start-run notices avoid raw run identifiers", () => {
  const rawRunId = "40000000-0000-4000-8000-000000000025";
  const zh = startAgentRunQueuedNoticeBody("zh-CN");
  const en = startAgentRunQueuedNoticeBody("en-US");

  assert.equal(zh, "AI 已开始处理。做出改动或有回放时会提醒你。");
  assert.equal(en, "AI started. You'll be notified when there's a change to review or a replay to watch.");
  // A2-84：不把 Proposal / Replay 这类内部实体名写进提示。
  assert.equal(zh.includes("Proposal"), false);
  assert.equal(zh.includes("Replay"), false);
  assert.equal(zh.includes(rawRunId), false);
  assert.equal(en.includes(rawRunId), false);
});

test("R9.7 route notices expose a monotonic sequence for live smoke freshness", () => {
  const originalWindow = globalThis.window;
  const fakeTimers = {
    clearTimeout: () => undefined,
    setTimeout: () => 1
  };
  (globalThis as unknown as { window: unknown }).window = fakeTimers;
  const notice = {
    dataset: {} as Record<string, string>,
    hidden: true,
    innerHTML: "",
    insertAdjacentHTML: (_position: InsertPosition, html: string) => {
      notice.innerHTML += html;
    }
  } as HTMLElement;
  const shellRoot = {
    querySelector: (selector: string) => selector === "[data-wh-app-notice]" ? notice : null
  } as HTMLElement;
  try {
    showRouteNotice(shellRoot, actionSuccessNotice("en-US", "first", "apply_ai_fusion"), undefined, 4600, {});
    assert.equal(notice.dataset.r4NoticeSeq, "1");

    showRouteNotice(shellRoot, actionSuccessNotice("en-US", "second", "apply_ai_fusion"), undefined, 4600, {});
    assert.equal(notice.dataset.r4NoticeSeq, "2");
  } finally {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  }
});

// E2E-09：确认屏「创建任务」未选方向被拦时给确认步专用文案（「先选一个方向再创建」级别），
// 澄清步保持通用口径。
test("E2E-09: intake option required notice names the direction pick on the confirm step", () => {
  assert.equal(intakeOptionRequiredNotice("zh-CN", "create_workitem").body, "先选一个方向再创建——没选时不会创建。");
  assert.equal(
    intakeOptionRequiredNotice("en-US", "create_workitem").body,
    "Pick a direction before creating — nothing is created until you do."
  );
  // 非确认步（澄清问题）仍走词典通用文案。
  assert.equal(intakeOptionRequiredNotice("zh-CN", "next_question").body, "请先选择一个选项，没选时不会提交。");
});

// UI-10：未知/未接线的服务端动作必须明确告知「暂未支持」，不再像「处理中」那样让用户干等。
test("UI-10: pending fallback states the action is unsupported, bilingually", () => {
  assert.equal(actionPendingNotice("zh-CN").body, "此动作暂未支持。");
  assert.equal(actionPendingNotice("en-US").body, "This action isn't supported yet.");
});
