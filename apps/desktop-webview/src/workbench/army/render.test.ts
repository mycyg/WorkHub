import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  AgentRunLiveVM,
  ArmyChangedFileVM,
  ArmyOutputsVM,
  ArmyOverviewRunCardVM,
  ArmyRunCardVM,
  ConversationArmyPanelVM
} from "@workhub/contracts";

import type { ChatRenderMembers } from "../chat/render.js";
import {
  armyDataAgeLabel,
  collectArmyChangedFiles,
  groupArmyOverviewRunsByProject,
  mergeArmyRunPages,
  renderArmyOverviewEmptyHtml,
  renderArmyOverviewHtml,
  renderArmyPanelHtml,
  renderArmyRunCardHtml,
  renderArmySidePanelIdleHtml,
  type ArmyOverviewViewState,
  type ArmyPanelViewState
} from "./render.js";

function baseRun(over: Partial<ArmyRunCardVM> = {}): ArmyRunCardVM {
  return {
    id: "run-1",
    status: "running",
    goal_summary: "重写选题报告第三节",
    assignee_user_id: "user-1",
    cost_cny: "0.021",
    execution_hint: "server",
    work_item_id: "wi-1",
    source_conversation_id: "conv-1",
    source_action_card_item_id: "aci-1",
    cat_codename: "阿墨",
    recent_step: { phase: "tool_call", tool_name: "read_file", output_excerpt: null, step_no: 3 },
    created_at: "2026-07-13T00:00:00.000000Z",
    updated_at: "2026-07-13T00:00:00.000000Z",
    ...over
  };
}

function overviewRun(over: Partial<ArmyOverviewRunCardVM> = {}): ArmyOverviewRunCardVM {
  return { ...baseRun(), project_id: "proj-1", project_name: "星尘短剧", ...over };
}

function panelVm(over: Partial<ConversationArmyPanelVM> = {}): ConversationArmyPanelVM {
  return {
    generated_at: "2026-07-13T00:00:00.000000Z",
    conversation_id: "conv-1",
    project_id: "proj-1",
    runs: { runs: [baseRun()], capped: false, next_cursor: null },
    outputs: {
      items: [
        {
          proposal_id: "prop-1",
          work_item_id: "wi-1",
          run_id: "run-1",
          title: "选题报告 · 第三节(草稿)",
          status: "opened",
          proposal_href: "/proposals/prop-1",
          updated_at: "2026-07-13T00:00:00.000000Z"
        }
      ],
      capped: false
    },
    background_tasks: { items: [], empty_state: "not_yet_available" },
    ...over
  };
}

// R13 批 P1.5（右栏变动文件区）：一个带 changed_files 的输出条目，其余字段沿用 panelVm() 默认输出。
function outputWithFiles(
  files: ArmyChangedFileVM[],
  over: Partial<ArmyOutputsVM["items"][number]> = {}
): ArmyOutputsVM["items"][number] {
  return {
    proposal_id: "prop-1",
    work_item_id: "wi-1",
    run_id: "run-1",
    title: "选题报告 · 第三节(草稿)",
    status: "opened",
    proposal_href: "/proposals/prop-1",
    updated_at: "2026-07-13T00:00:00.000000Z",
    changed_files: files,
    ...over
  };
}

const noMembers: ChatRenderMembers = new Map();

test("renderArmyRunCardHtml renders an interactive button carrying the run id when interactive", () => {
  const html = renderArmyRunCardHtml(baseRun(), "zh-CN", { showProject: false, interaction: { mode: "open-run" } });
  assert.match(html, /<button[^>]*data-wb-army-open-run="run-1"[^>]*>/u);
  assert.match(html, /阿墨/u);
  assert.match(html, /云端/u);
  assert.match(html, /¥0\.021/u);
});

test("renderArmyRunCardHtml renders a non-interactive, non-clickable div when interactive is false (04 rule 3: no fake wiring)", () => {
  const html = renderArmyRunCardHtml(baseRun(), "zh-CN", { showProject: false, interaction: { mode: "none" } });
  assert.doesNotMatch(html, /data-wb-army-open-run/u);
  assert.match(html, /<div class="wh-wb-army-rc wh-wb-army-rc--run wh-wb-army-rc--static">/u);
});

test("renderArmyRunCardHtml shows a project badge only when showProject is true and the run carries a project_name", () => {
  const withBadge = renderArmyRunCardHtml(overviewRun(), "zh-CN", { showProject: true, interaction: { mode: "none" } });
  assert.match(withBadge, /星尘短剧/u);
  const withoutBadge = renderArmyRunCardHtml(baseRun(), "zh-CN", { showProject: true, interaction: { mode: "open-run" } });
  assert.doesNotMatch(withoutBadge, /wh-wb-army-rc-project/u);
});

test("renderArmyRunCardHtml distinguishes null cost (no billing yet) from a confirmed zero cost", () => {
  const noCost = renderArmyRunCardHtml(baseRun({ cost_cny: null }), "zh-CN", { showProject: false, interaction: { mode: "open-run" } });
  assert.match(noCost, /还没有花费/u);
  const zeroCost = renderArmyRunCardHtml(baseRun({ cost_cny: "0" }), "zh-CN", { showProject: false, interaction: { mode: "open-run" } });
  assert.match(zeroCost, /¥0(?!\.021)/u);
});

test("renderArmyRunCardHtml labels execution_hint as cloud vs local", () => {
  const serverHtml = renderArmyRunCardHtml(baseRun({ execution_hint: "server" }), "zh-CN", { showProject: false, interaction: { mode: "open-run" } });
  assert.match(serverHtml, /云端/u);
  const localHtml = renderArmyRunCardHtml(baseRun({ execution_hint: "local" }), "zh-CN", { showProject: false, interaction: { mode: "open-run" } });
  assert.match(localHtml, /本机/u);
});

test("renderArmyRunCardHtml surfaces the assignee nickname only when one was resolved", () => {
  const withAssignee = renderArmyRunCardHtml(baseRun(), "zh-CN", { showProject: false, interaction: { mode: "open-run" }, assigneeNickname: "阿曼" });
  assert.match(withAssignee, /执行身份/u);
  assert.match(withAssignee, /阿曼/u);
  const withoutAssignee = renderArmyRunCardHtml(baseRun(), "zh-CN", { showProject: false, interaction: { mode: "open-run" } });
  assert.doesNotMatch(withoutAssignee, /wh-wb-army-rc-assignee/u);
});

test("renderArmyRunCardHtml labels provenance honestly from the fields it actually has (no invented action-card titles)", () => {
  const fromActionCard = renderArmyRunCardHtml(baseRun(), "zh-CN", { showProject: false, interaction: { mode: "open-run" } });
  assert.match(fromActionCard, /来自本会话行动卡/u);
  const fromConversationOnly = renderArmyRunCardHtml(
    baseRun({ source_action_card_item_id: null }),
    "zh-CN",
    { showProject: false, interaction: { mode: "open-run" } }
  );
  assert.match(fromConversationOnly, /来自本会话对话/u);
  const systemDispatched = renderArmyRunCardHtml(
    baseRun({ source_action_card_item_id: null, source_conversation_id: null }),
    "zh-CN",
    { showProject: false, interaction: { mode: "open-run" } }
  );
  assert.match(systemDispatched, /系统派发/u);
});

test("renderArmyPanelHtml with no state at all falls back to the honest 'pick a conversation' idle note", () => {
  const html = renderArmyPanelHtml(undefined, "zh-CN", noMembers);
  assert.equal(html, renderArmySidePanelIdleHtml("zh-CN"));
  assert.match(html, /选一个会话/u);
});

test("renderArmyPanelHtml renders outputs and runs in list mode", () => {
  const state: ArmyPanelViewState = { mode: "list", vm: panelVm(), loadingMore: false };
  const html = renderArmyPanelHtml(state, "zh-CN", noMembers);
  assert.match(html, /选题报告 · 第三节\(草稿\)/u);
  assert.match(html, /阿墨/u);
});

// R17 G3(#8 拍板 B)：后台任务区接真数据源后恢复渲染。没传 background(还没拿到)时诚实显示加载态；
// ready 时渲两块（定时任务 + 主动性动态）。此前那条「永远不渲染」的止血断言随本批接活作废。
test("renderArmyPanelHtml shows a loading note for the background section when background data hasn't arrived yet", () => {
  const state: ArmyPanelViewState = { mode: "list", vm: panelVm(), loadingMore: false };
  const html = renderArmyPanelHtml(state, "zh-CN", noMembers);
  assert.match(html, /后台任务/u);
  assert.match(html, /正在加载定时任务/u);
});

test("renderArmyPanelHtml renders the scheduled-tasks and proactivity blocks from real background data", () => {
  const state: ArmyPanelViewState = { mode: "list", vm: panelVm(), loadingMore: false };
  const html = renderArmyPanelHtml(state, "zh-CN", noMembers, {
    status: "ready",
    vm: {
      generated_at: "2026-07-13T00:00:00.000000Z",
      scheduler: {
        enabled: true,
        tasks: [
          { name: "approval-sla", interval_ms: 60_000, running: false, tick_count: 7, skipped_count: 0, error_count: 0, last_tick_at: "2026-07-13T00:00:00.000000Z" },
          { name: "care-scan", interval_ms: 3_600_000, running: false, tick_count: 0, skipped_count: 0, error_count: 2, last_tick_at: null }
        ]
      },
      proactive: {
        items: [
          { id: "pi-1", kind: "care", stage: "high_load", status: "delivered", delivered_via: "conversation_message", created_at: "2026-07-13T00:00:00.000000Z" },
          { id: "pi-2", kind: "ddl_chase", stage: "overdue", status: "suppressed", delivered_via: null, created_at: "2026-07-12T23:00:00.000000Z" }
        ],
        capped: false
      }
    }
  });
  assert.match(html, /定时任务/u);
  assert.match(html, /审批超时提醒/u);
  assert.match(html, /主动关怀/u);
  assert.match(html, /还没跑过/u); // care-scan last_tick_at null
  assert.match(html, /Cuu 主动做的事/u);
  assert.match(html, /主动关怀/u);
  assert.match(html, /已发提醒/u);
  assert.match(html, /没发提醒/u); // suppressed
});

// M-10（R24 S3 走查）：pulse-scheduler.ts 后来注册的 clarification-chase/proactive-intent-recovery
// 两个任务没跟进 BACKGROUND_TASK_LABEL 表，情境面板里就混进了两条没翻译的内部调度器 id
// （用户读到"定时任务 7"下面夹着生僻的英文短横线字符串）。锁死两条都能翻成人话，不再漏译。
test("renderArmyPanelHtml translates every registered pulse task name, including the two that were missing", () => {
  const state: ArmyPanelViewState = { mode: "list", vm: panelVm(), loadingMore: false };
  const html = renderArmyPanelHtml(state, "zh-CN", noMembers, {
    status: "ready",
    vm: {
      generated_at: "2026-09-05T00:00:00.000Z",
      scheduler: {
        enabled: true,
        tasks: [
          { name: "clarification-chase", interval_ms: 60_000, running: false, tick_count: 3, skipped_count: 0, error_count: 0, last_tick_at: "2026-09-05T00:00:00.000000Z" },
          { name: "proactive-intent-recovery", interval_ms: 300_000, running: false, tick_count: 1, skipped_count: 0, error_count: 0, last_tick_at: null }
        ]
      },
      proactive: { items: [], capped: false }
    }
  });
  assert.match(html, /澄清待办提醒/u);
  assert.match(html, /主动提醒重发/u);
  assert.doesNotMatch(html, /clarification-chase/u, "the raw scheduler id must not leak through untranslated");
  assert.doesNotMatch(html, /proactive-intent-recovery/u, "the raw scheduler id must not leak through untranslated");
});

test("renderArmyPanelHtml background section honestly reports a disabled scheduler instead of faking activity", () => {
  const state: ArmyPanelViewState = { mode: "list", vm: panelVm(), loadingMore: false };
  const html = renderArmyPanelHtml(state, "zh-CN", noMembers, {
    status: "ready",
    vm: {
      generated_at: "2026-07-13T00:00:00.000000Z",
      scheduler: { enabled: false, tasks: [] },
      proactive: { items: [], capped: false }
    }
  });
  assert.match(html, /这台服务器上的定时提醒没有开启/u);
  assert.match(html, /Cuu 最近没有主动做什么/u);
});

// R14 批 APPROVE-CHAT：输出行从「<details> 折叠 + 深链死文本（跳转后续批次开放）」翻成真接线的可点按钮——
// 点击 → 右栏打开提议详情。这是本批的接活，断言相应更新（是正当行为变更，不是迁就实现）。
test("renderArmyPanelHtml output rows are clickable proposal buttons carrying the proposal id, not a fake navigating link or dead deep-link text", () => {
  const state: ArmyPanelViewState = { mode: "list", vm: panelVm(), loadingMore: false };
  const html = renderArmyPanelHtml(state, "zh-CN", noMembers);
  assert.match(html, /<button[^>]*class="wh-wb-army-out-row wh-wb-army-out-row--link"[^>]*data-wb-army-open-proposal="prop-1"/u);
  assert.doesNotMatch(html, /<a[^>]*href="\/proposals\/prop-1"/u);
  // 深链死文本已删除（不再展示 proposal_href 文本，也不再有「跳转后续批次开放」）。
  assert.doesNotMatch(html, /深链/u);
  assert.doesNotMatch(html, /跳转后续批次开放/u);
});

// R13 批 P1.5（右栏变动文件区）：下面几条覆盖设计稿验收门列的三种边界——整体缺失（老 proposal）/
// 部分文件缺 adds-dels / 超过 20 条截断，外加去重语义。

test("collectArmyChangedFiles dedupes by path across multiple outputs, keeping the newest (first-listed) occurrence", () => {
  const newer: ArmyChangedFileVM = { path: "/outputs/result.md", change_type: "updated", adds: 5, dels: 2 };
  const older: ArmyChangedFileVM = { path: "/outputs/result.md", change_type: "updated", adds: 1, dels: 1 };
  // outputs.items 本就按 updated_at desc 排列（服务端 orderBy）——较新的输出排在数组前面。
  const outputs: ArmyOutputsVM = {
    items: [outputWithFiles([newer], { proposal_id: "prop-new" }), outputWithFiles([older], { proposal_id: "prop-old" })],
    capped: false
  };

  const files = collectArmyChangedFiles(outputs);

  assert.equal(files.length, 1);
  assert.deepEqual(files[0], newer);
});

test("collectArmyChangedFiles keeps entries without a path as separate rows instead of incorrectly merging them", () => {
  const first: ArmyChangedFileVM = { change_type: "generated" };
  const second: ArmyChangedFileVM = { change_type: "deleted" };
  const outputs: ArmyOutputsVM = { items: [outputWithFiles([first, second])], capped: false };

  const files = collectArmyChangedFiles(outputs);

  assert.equal(files.length, 2);
});

test("renderArmyPanelHtml changed-files section lists one row per file with a human change-type badge and +N -M", () => {
  const vm = panelVm({
    outputs: {
      items: [outputWithFiles([
        { path: "/outputs/result.md", change_type: "updated", adds: 3, dels: 1 },
        { path: "/outputs/new.md", change_type: "created", adds: 5 }
      ])],
      capped: false
    }
  });
  const html = renderArmyPanelHtml({ mode: "list", vm, loadingMore: false }, "zh-CN", noMembers);

  assert.match(html, /变动文件/u);
  assert.match(html, /result\.md/u);
  assert.match(html, /更新/u);
  assert.match(html, /\+3 -1/u);
  assert.match(html, /new\.md/u);
  assert.match(html, /新建/u);
});

test("renderArmyPanelHtml shows 'change details unavailable' instead of faking +0 -0 when a file has no adds/dels", () => {
  const vm = panelVm({
    outputs: { items: [outputWithFiles([{ path: "/outputs/result.md", change_type: "generated" }])], capped: false }
  });
  const html = renderArmyPanelHtml({ mode: "list", vm, loadingMore: false }, "zh-CN", noMembers);

  assert.match(html, /改动详情不可用/u);
  assert.doesNotMatch(html, /\+0 -0/u);
});

test("renderArmyPanelHtml changed-files section shows an honest empty note when no output carries changed_files (e.g. every proposal predates the P1.5 stats column)", () => {
  const html = renderArmyPanelHtml({ mode: "list", vm: panelVm(), loadingMore: false }, "zh-CN", noMembers);

  assert.match(html, /这个会话的产出还没有可展示的变动文件/u);
});

test("renderArmyPanelHtml notes there may be more changes when a proposal hits the 20-change diff cap", () => {
  const manyFiles: ArmyChangedFileVM[] = Array.from({ length: 20 }, (_unused, index) => ({
    path: `/outputs/f${index}.md`,
    change_type: "generated",
    adds: 1,
    dels: 0
  }));
  const vm = panelVm({ outputs: { items: [outputWithFiles(manyFiles)], capped: false } });

  const html = renderArmyPanelHtml({ mode: "list", vm, loadingMore: false }, "zh-CN", noMembers);

  assert.match(html, /可能还有更多改动没有逐条统计/u);
});

test("renderArmyPanelHtml does not warn about truncation when a proposal has fewer than 20 changed files", () => {
  const fewFiles: ArmyChangedFileVM[] = [{ path: "/outputs/result.md", change_type: "updated", adds: 1, dels: 1 }];
  const vm = panelVm({ outputs: { items: [outputWithFiles(fewFiles)], capped: false } });

  const html = renderArmyPanelHtml({ mode: "list", vm, loadingMore: false }, "zh-CN", noMembers);

  assert.doesNotMatch(html, /可能还有更多改动没有逐条统计/u);
});

test("renderArmyPanelHtml shows an empty note when there are no runs or outputs, without inventing data", () => {
  const state: ArmyPanelViewState = {
    mode: "list",
    vm: panelVm({ runs: { runs: [], capped: false, next_cursor: null, empty_state: "no_army_runs" }, outputs: { items: [], capped: false } }),
    loadingMore: false
  };
  const html = renderArmyPanelHtml(state, "zh-CN", noMembers);
  assert.match(html, /这个会话还没有输出/u);
  assert.match(html, /这里还没有小队干过活/u);
});

test("renderArmyPanelHtml renders a load-more control exactly when the runs page is capped (contract invariant)", () => {
  const cappedVm = panelVm({
    runs: {
      runs: [baseRun()],
      capped: true,
      next_cursor: { after_created_at: "2026-07-13T00:00:00.000000Z", after_id: "run-1" }
    }
  });
  const html = renderArmyPanelHtml({ mode: "list", vm: cappedVm, loadingMore: false }, "zh-CN", noMembers);
  assert.match(html, /data-wb-army-load-more/u);

  const uncappedHtml = renderArmyPanelHtml({ mode: "list", vm: panelVm(), loadingMore: false }, "zh-CN", noMembers);
  assert.doesNotMatch(uncappedHtml, /data-wb-army-load-more/u);
});

test("renderArmyPanelHtml detail mode enlarges the recent step and offers a real 'view replay' action wired to a real endpoint", () => {
  const state: ArmyPanelViewState = {
    mode: "detail",
    vm: panelVm(),
    run: baseRun(),
    trace: { status: "idle" },
    abort: { status: "idle" }
  };
  const html = renderArmyPanelHtml(state, "zh-CN", noMembers);
  assert.match(html, /data-wb-army-back/u);
  assert.match(html, /wh-wb-army-rd-step/u);
  assert.match(html, /data-wb-army-open-replay/u);
  assert.match(html, /看回放/u);
});

test("renderArmyPanelHtml detail mode renders the full trace timeline once the replay data is ready", () => {
  const trace: AgentRunLiveVM = {
    run_id: "run-1",
    trace: [
      { id: "step-1", agent_run_id: "run-1", step_no: 1, phase: "tool_call", tool_name: "read_file", created_at: "2026-07-13T00:00:00.000000Z" } as never
    ]
  } as unknown as AgentRunLiveVM;
  const state: ArmyPanelViewState = {
    mode: "detail",
    vm: panelVm(),
    run: baseRun(),
    trace: { status: "ready", data: trace },
    abort: { status: "idle" }
  };
  const html = renderArmyPanelHtml(state, "zh-CN", noMembers);
  assert.match(html, /时间线/u);
  assert.match(html, /wh-wb-army-tl-item/u);
});

test("renderArmyPanelHtml surfaces a loading state and an error state distinctly", () => {
  const loading = renderArmyPanelHtml({ mode: "loading" }, "zh-CN", noMembers);
  assert.match(loading, /正在加载小队面板/u);
  const errored = renderArmyPanelHtml({ mode: "error", message: "网络断了" }, "zh-CN", noMembers);
  assert.match(errored, /网络断了/u);
});

test("mergeArmyRunPages appends a 'load more' page onto the current list", () => {
  const merged = mergeArmyRunPages([baseRun({ id: "r1" })], [baseRun({ id: "r2" })]);
  assert.deepEqual(merged.map((r) => r.id), ["r1", "r2"]);
});

test("mergeArmyRunPages drops any row from the incoming page whose id is already present (defensive de-dupe)", () => {
  const merged = mergeArmyRunPages([baseRun({ id: "r1" })], [baseRun({ id: "r1" }), baseRun({ id: "r2" })]);
  assert.deepEqual(merged.map((r) => r.id), ["r1", "r2"]);
});

// —— 军团总览 —— //

test("groupArmyOverviewRunsByProject groups by project_id, preserving first-seen order and each project's own run order", () => {
  const groups = groupArmyOverviewRunsByProject([
    overviewRun({ id: "r1", project_id: "p1", project_name: "星尘短剧" }),
    overviewRun({ id: "r2", project_id: "p2", project_name: "知识库改版" }),
    overviewRun({ id: "r3", project_id: "p1", project_name: "星尘短剧" })
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.projectId, "p1");
  assert.deepEqual(groups[0]!.runs.map((r) => r.id), ["r1", "r3"]);
  assert.equal(groups[1]!.projectId, "p2");
  assert.deepEqual(groups[1]!.runs.map((r) => r.id), ["r2"]);
});

// R17 G3(#21)：总览卡片现在可下钻——每张卡携 project/run/conversation id 的 drilldown 数据属性
// （不是会话面板的 open-run，是跨项目下钻）。
test("renderArmyOverviewHtml renders a group heading per project and drilldown cards carrying project/run/conversation ids", () => {
  const state: ArmyOverviewViewState = {
    mode: "ready",
    vm: {
      generated_at: "2026-07-13T00:00:00.000000Z",
      viewer_user_id: "user-1",
      runs: { runs: [overviewRun({ id: "run-9", project_id: "proj-9", source_conversation_id: "conv-9" })], capped: false, next_cursor: null }
    },
    loadingMore: false
  };
  const html = renderArmyOverviewHtml(state, "zh-CN");
  assert.match(html, /星尘短剧/u);
  assert.match(html, /data-wb-army-ov-drilldown/u);
  assert.match(html, /data-wb-army-run-id="run-9"/u);
  assert.match(html, /data-wb-army-project-id="proj-9"/u);
  assert.match(html, /data-wb-army-conversation-id="conv-9"/u);
  // 下钻不是会话面板的 open-run。
  assert.doesNotMatch(html, /data-wb-army-open-run/u);
});

test("renderArmyOverviewHtml omits the conversation-id attribute for a system-dispatched run with no source conversation", () => {
  const state: ArmyOverviewViewState = {
    mode: "ready",
    vm: {
      generated_at: "2026-07-13T00:00:00.000000Z",
      viewer_user_id: "user-1",
      runs: { runs: [overviewRun({ source_conversation_id: null, source_action_card_item_id: null })], capped: false, next_cursor: null }
    },
    loadingMore: false
  };
  const html = renderArmyOverviewHtml(state, "zh-CN");
  assert.match(html, /data-wb-army-ov-drilldown/u);
  assert.doesNotMatch(html, /data-wb-army-conversation-id/u);
});

test("renderArmyOverviewHtml shows the honest empty state when the viewer has no army runs across any project", () => {
  const state: ArmyOverviewViewState = {
    mode: "ready",
    vm: { generated_at: "2026-07-13T00:00:00.000000Z", viewer_user_id: "user-1", runs: { runs: [], capped: false, next_cursor: null, empty_state: "no_army_runs" } },
    loadingMore: false
  };
  const html = renderArmyOverviewHtml(state, "zh-CN");
  assert.equal(html, renderArmyOverviewEmptyHtml("zh-CN"));
});

test("renderArmyOverviewHtml renders a load-more control exactly when capped", () => {
  const cappedState: ArmyOverviewViewState = {
    mode: "ready",
    vm: {
      generated_at: "2026-07-13T00:00:00.000000Z",
      viewer_user_id: "user-1",
      runs: { runs: [overviewRun()], capped: true, next_cursor: { after_created_at: "2026-07-13T00:00:00.000000Z", after_id: "run-1" } }
    },
    loadingMore: false
  };
  assert.match(renderArmyOverviewHtml(cappedState, "zh-CN"), /data-wb-army-ov-load-more/u);
});

// —— R17 G3 新增覆盖 —— //

test("renderArmyRunCardHtml gives an escalated run its own danger 'waiting on you' badge, not the generic wait bucket", () => {
  const html = renderArmyRunCardHtml(baseRun({ status: "escalated" }), "zh-CN", { showProject: false, interaction: { mode: "open-run" } });
  assert.match(html, /wh-wb-army-rc-status--escalated/u);
  assert.match(html, /等你拍板/u);
  // 不再和 queued 同归 wait 桶。
  assert.doesNotMatch(html, /wh-wb-army-rc-status--wait/u);
});

test("renderArmyRunCardHtml open-run card offers a cancel entry for a running run and a 'handle' entry for an escalated one (no button nesting)", () => {
  const running = renderArmyRunCardHtml(baseRun({ status: "running" }), "zh-CN", { showProject: false, interaction: { mode: "open-run" } });
  assert.match(running, /data-wb-army-abort-run="run-1"/u);
  // 主体是内层按钮、动作在外层同级 foot——open-run 卡外层是 div 不是 button。
  assert.match(running, /^<div class="wh-wb-army-rc/u);
  const escalated = renderArmyRunCardHtml(baseRun({ status: "escalated" }), "zh-CN", { showProject: false, interaction: { mode: "open-run" } });
  assert.match(escalated, /data-wb-army-handle-escalation/u);
  assert.doesNotMatch(escalated, /data-wb-army-abort-run/u);
});

test("renderArmyRunCardHtml does not offer a cancel entry for a terminal run", () => {
  const done = renderArmyRunCardHtml(baseRun({ status: "succeeded" }), "zh-CN", { showProject: false, interaction: { mode: "open-run" } });
  assert.doesNotMatch(done, /data-wb-army-abort-run/u);
  assert.doesNotMatch(done, /data-wb-army-handle-escalation/u);
});

test("renderArmyPanelHtml detail mode offers a cancel control for a running run and steps through the confirm/aborting states", () => {
  const idle = renderArmyPanelHtml({ mode: "detail", vm: panelVm(), run: baseRun({ status: "running" }), trace: { status: "idle" }, abort: { status: "idle" } }, "zh-CN", noMembers);
  assert.match(idle, /data-wb-army-abort-open/u);
  const confirming = renderArmyPanelHtml({ mode: "detail", vm: panelVm(), run: baseRun({ status: "running" }), trace: { status: "idle" }, abort: { status: "confirming" } }, "zh-CN", noMembers);
  assert.match(confirming, /确定取消这次执行/u);
  assert.match(confirming, /data-wb-army-abort-confirm/u);
  assert.match(confirming, /data-wb-army-abort-dismiss/u);
  const aborting = renderArmyPanelHtml({ mode: "detail", vm: panelVm(), run: baseRun({ status: "running" }), trace: { status: "idle" }, abort: { status: "aborting" } }, "zh-CN", noMembers);
  assert.match(aborting, /正在取消/u);
});

test("renderArmyPanelHtml detail mode offers 'handle' (not cancel) for an escalated run", () => {
  const html = renderArmyPanelHtml({ mode: "detail", vm: panelVm(), run: baseRun({ status: "escalated" }), trace: { status: "idle" }, abort: { status: "idle" } }, "zh-CN", noMembers);
  assert.match(html, /data-wb-army-handle-escalation/u);
  assert.match(html, /等你拍板/u);
  assert.doesNotMatch(html, /data-wb-army-abort-open/u);
});

test("armyDataAgeLabel renders honest minute/hour ages and a 'just now' floor", () => {
  const base = Date.parse("2026-07-13T00:00:00.000000Z");
  assert.match(armyDataAgeLabel("2026-07-13T00:00:00.000000Z", base + 30 * 1000, true), /刚刚/u);
  assert.match(armyDataAgeLabel("2026-07-13T00:00:00.000000Z", base + 3 * 60 * 1000, true), /3 分钟前/u);
  assert.match(armyDataAgeLabel("2026-07-13T00:00:00.000000Z", base + 2 * 60 * 60 * 1000, true), /2 小时前/u);
  assert.equal(armyDataAgeLabel("not-a-date", base, true), "");
});
