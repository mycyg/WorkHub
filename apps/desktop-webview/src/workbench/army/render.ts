// WorkHub 桌面 · 军团面板 / 军团总览的纯 HTML 渲染函数（照 chat/render.ts、drive/render.ts 的分工：
// 这里全部是无副作用的字符串拼装，可单测；imperative 的 DOM 挂载/事件绑定在 panel.ts / overview.ts）。
//
// 视觉基准是 r12-desktop-workbench/prototype/index.html 的右栏三区（.out-row / .runcard / .bg-row）与
// run 详情下钻（.run-detail / .tl），配色改用 design-system.ts 的浅色 --ds-* token（R13 批 V1 已把整个
// 工作台翻成浅色玻璃，这批新样式不再另起一套深色 token）。

import type {
  AgentRunLiveVM,
  ArmyBackgroundTasksVM,
  ArmyChangedFileVM,
  ArmyOutputsVM,
  ArmyOverviewPageVM,
  ArmyOverviewRunCardVM,
  ArmyRunCardVM,
  ConversationArmyPanelVM
} from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { agentRunStatusLabel, agentStepPhaseLabel, agentStepPublicSummary } from "../../spotlight/labels.js";
import type { ChatRenderMembers } from "../chat/render.js";
import { formatMessageTime } from "../chat/timeline.js";
import { workbenchIcons } from "../icons.js";

type Locale = "zh-CN" | "en-US";

type ArmyRunCardLike = ArmyRunCardVM | ArmyOverviewRunCardVM;

// 「加载更多」的合并逻辑——panel.ts（会话情境面板）与 overview.ts（军团总览）的 loadMore 都用得到，
// 抽成一个可单测的纯函数而不是各写一份。服务端的游标分页本身不应该返回重复行，但按 id 去重是廉价的
// 防御，不依赖这个假设也能正确工作（两页之间万一有一条 run 在游标推进期间被并发更新，也不会重复渲染）。
export function mergeArmyRunPages<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const seen = new Set(current.map((run) => run.id));
  return [...current, ...incoming.filter((run) => !seen.has(run.id))];
}

// —— 会话情境面板（panel.ts 消费）—— //

export type ArmyRunTraceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: AgentRunLiveVM }
  | { status: "error"; message: string };

export type ArmyPanelViewState =
  | { mode: "loading" }
  | { mode: "error"; message: string }
  | { mode: "list"; vm: ConversationArmyPanelVM; loadingMore: boolean; loadMoreError?: string }
  | { mode: "detail"; vm: ConversationArmyPanelVM; run: ArmyRunCardVM; trace: ArmyRunTraceState };

function executionHintLabel(hint: string, zh: boolean): string {
  if (hint === "server") {
    return zh ? "云端" : "Cloud";
  }
  if (hint === "local") {
    return zh ? "本机" : "Local";
  }
  return zh ? "云端或本机" : "Cloud or local";
}

// 00 §9/契约不变量：succeeded/cancelled 都是"已经不再动了"的终态，视觉上归一为中性(done)；
// failed 是唯一的危险态；queued/escalated 是"等待"态(escalated 等的是人拍板,不是系统故障)。
function armyRunStatusVariant(status: string): "run" | "wait" | "done" | "fail" {
  switch (status) {
    case "running":
      return "run";
    case "queued":
    case "escalated":
      return "wait";
    case "failed":
      return "fail";
    default:
      return "done";
  }
}

function armySourceLabelHtml(run: { source_conversation_id: string | null; source_action_card_item_id: string | null }, zh: boolean): string {
  const text = run.source_action_card_item_id
    ? zh
      ? "来自本会话行动卡"
      : "From an action card in this conversation"
    : run.source_conversation_id
      ? zh
        ? "来自本会话对话"
        : "From this conversation"
      : zh
        ? "系统派发"
        : "System-dispatched";
  return `<span class="wh-wb-army-rc-source">${escapeHtml(text)}</span>`;
}

function armyRunCostLabel(costCny: string | null, zh: boolean): string {
  // costCny === null 是"这次执行还没有任何计费记录"，和确认花了 0 元不是一回事（见契约顶部注释）——
  // 两种情况都老实标注，不拿 null 硬凑成 "¥0"。
  return costCny === null ? (zh ? "还没有花费" : "No cost yet") : `¥${escapeHtml(costCny)}`;
}

export function renderArmyRunCardHtml(
  run: ArmyRunCardLike,
  locale: Locale,
  opts: { assigneeNickname?: string | undefined; showProject: boolean; interactive: boolean }
): string {
  const zh = locale === "zh-CN";
  const variant = armyRunStatusVariant(run.status);
  const projectBadge =
    opts.showProject && "project_name" in run
      ? `<span class="wh-wb-army-rc-project">${escapeHtml(run.project_name)}</span>`
      : "";
  const assigneeLine = opts.assigneeNickname
    ? `<span class="wh-wb-army-rc-assignee">${zh ? "执行身份：" : "Acting as "}${escapeHtml(opts.assigneeNickname)}</span>`
    : "";
  const stepLine = run.recent_step
    ? `<div class="wh-wb-army-rc-step">${escapeHtml(
        agentStepPublicSummary(
          { phase: run.recent_step.phase, tool_name: run.recent_step.tool_name ?? undefined, output_excerpt: run.recent_step.output_excerpt ?? undefined },
          zh
        )
      )}</div>`
    : "";
  const body = `<div class="wh-wb-army-rc-top">
      <span class="wh-wb-army-rc-cat">${workbenchIcons.cat}</span>
      <b class="wh-wb-army-rc-name">${escapeHtml(run.cat_codename)}</b>
      ${projectBadge}
      <span class="wh-wb-army-rc-exec">${escapeHtml(executionHintLabel(run.execution_hint, zh))}</span>
      <span class="wh-wb-army-rc-status wh-wb-army-rc-status--${variant}">${escapeHtml(agentRunStatusLabel(run.status, zh))}</span>
    </div>
    <div class="wh-wb-army-rc-goal">${escapeHtml(run.goal_summary)}</div>
    <div class="wh-wb-army-rc-meta">${assigneeLine}${armySourceLabelHtml(run, zh)}</div>
    ${stepLine}
    <div class="wh-wb-army-rc-foot"><span>${armyRunCostLabel(run.cost_cny, zh)}</span></div>`;
  return opts.interactive
    ? `<button type="button" class="wh-wb-army-rc wh-wb-army-rc--${variant}" data-wb-army-open-run="${escapeHtml(run.id)}">${body}</button>`
    : `<div class="wh-wb-army-rc wh-wb-army-rc--${variant} wh-wb-army-rc--static">${body}</div>`;
}

const PROPOSAL_STATUS_LABEL: Record<string, [string, string]> = {
  opened: ["待审", "Pending review"],
  reviewed: ["已复核", "Reviewed"],
  merged: ["已合并", "Merged"],
  rejected: ["已退回", "Rejected"]
};

function armyOutputStatusLabel(status: string, zh: boolean): string {
  const entry = PROPOSAL_STATUS_LABEL[status];
  return entry ? (zh ? entry[0] : entry[1]) : status;
}

// 输出区(00 §4/批 5 契约)：R14 批 APPROVE-CHAT 起真接线——每行是一个可点按钮，点击 → 右栏打开提议详情
// （data-wb-army-open-proposal 抛给 panel.ts → shell → proposalPanel.showForProposal）。此前那条「深链：…
// （跳转后续批次开放）」死文本已随本批接线删除（04 §4 铁律 3 反过来：现在有真接线了，就该是能点的行）。
function renderArmyOutputsSectionHtml(outputs: ArmyOutputsVM, zh: boolean): string {
  const header = `<div class="wh-wb-army-sec-h">${zh ? "输出" : "Outputs"}<span class="wh-wb-army-sec-n">${outputs.items.length}</span></div>`;
  if (outputs.items.length === 0) {
    return `${header}<p class="wh-wb-army-empty-note">${zh ? "这个会话还没有输出。" : "No outputs from this conversation yet."}</p>`;
  }
  const rows = outputs.items
    .map(
      (item) => `<button type="button" class="wh-wb-army-out-row wh-wb-army-out-row--link" data-wb-army-open-proposal="${escapeHtml(item.proposal_id)}">
        <span class="wh-wb-army-out-icon">${workbenchIcons.file}</span>
        <span class="wh-wb-army-out-main">
          <span class="wh-wb-army-out-title">${escapeHtml(item.title)}</span>
          <span class="wh-wb-army-out-meta">${escapeHtml(armyOutputStatusLabel(item.status, zh))}</span>
        </span>
        <span class="wh-wb-army-out-chev">${workbenchIcons.chevronRight}</span>
      </button>`
    )
    .join("");
  const cappedNote = outputs.capped
    ? `<p class="wh-wb-army-capped-note">${zh ? "还有更多输出没有在这里显示。" : "There are more outputs than shown here."}</p>`
    : "";
  return `${header}${rows}${cappedNote}`;
}

// R13 批 P1.5（右栏变动文件区）：聚合当前会话所有 outputs[].changed_files，按 path 去重——同一文件
// 被多个提议改过时取最新一条。outputs.items 本就按 updated_at desc 排列（见
// listOutputLinksForConversation 的 orderBy），所以第一次遇到某个 path 时就是最新的那条，直接
// "先到者赢"即可，不需要额外比较时间戳。没有 path 的改动（理论上限——非文件类改动，如
// structured_record）各自当独立条目处理，不强行按缺省 key 归并到一起。
export function collectArmyChangedFiles(outputs: ArmyOutputsVM): ArmyChangedFileVM[] {
  const seen = new Map<string, ArmyChangedFileVM>();
  outputs.items.forEach((item, itemIndex) => {
    (item.changed_files ?? []).forEach((file, fileIndex) => {
      const key = file.path ?? `__no-path__:${item.proposal_id}:${itemIndex}:${fileIndex}`;
      if (!seen.has(key)) {
        seen.set(key, file);
      }
    });
  });
  return [...seen.values()];
}

const ARMY_CHANGE_TYPE_LABEL: Record<string, [string, string]> = {
  created: ["新建", "Created"],
  updated: ["更新", "Updated"],
  deleted: ["删除", "Deleted"],
  renamed: ["重命名", "Renamed"],
  moved: ["移动", "Moved"],
  replaced: ["替换", "Replaced"],
  generated: ["生成", "Generated"]
};

function armyChangeTypeLabel(changeType: string, zh: boolean): string {
  const entry = ARMY_CHANGE_TYPE_LABEL[changeType];
  return entry ? (zh ? entry[0] : entry[1]) : changeType;
}

function armyChangedFileNameLabel(file: ArmyChangedFileVM, zh: boolean): string {
  if (!file.path) {
    return zh ? "（未知文件）" : "(unknown file)";
  }
  const segments = file.path.split("/");
  return segments[segments.length - 1] || file.path;
}

// adds/dels 缺省即"这条改动没能计入统计"(见 armyChangedFileVmSchema 的契约注释)，绝不能显示成
// "+0 -0"——那会被读成"这条改动没有实质内容"，是一句谎言。
function armyChangedFileDiffLabel(file: ArmyChangedFileVM, zh: boolean): string {
  if (file.adds === undefined && file.dels === undefined) {
    return zh ? "改动详情不可用" : "Change details unavailable";
  }
  return `+${file.adds ?? 0} -${file.dels ?? 0}`;
}

// 变动文件区(P1.5 契约)：紧跟输出区之后——文件正是输出区里各个提议产出的具体物。与网盘侧栏
// "最近文件"的边界：这里只展示已经进入提议的 AI 产出改动，不是网盘全量最近文件列表。点击展开
// 复用输出区同款 <details> 折叠(04 铁律#3：没有深链接线就不装作能跳转)，样式复用既有
// .wh-wb-army-out-* 类(没有为这批新增 CSS，见批次汇报)。
function renderArmyChangedFilesSectionHtml(outputs: ArmyOutputsVM, zh: boolean): string {
  const files = collectArmyChangedFiles(outputs);
  const header = `<div class="wh-wb-army-sec-h">${zh ? "变动文件" : "Changed files"}<span class="wh-wb-army-sec-n">${files.length}</span></div>`;
  if (files.length === 0) {
    return `${header}<p class="wh-wb-army-empty-note">${zh ? "这个会话的产出还没有可展示的变动文件。" : "No changed files from this conversation's outputs yet."}</p>`;
  }
  const rows = files
    .map(
      (file) => `<details class="wh-wb-army-out-row">
        <summary>
          <span class="wh-wb-army-out-icon">${workbenchIcons.file}</span>
          <span class="wh-wb-army-out-main">
            <span class="wh-wb-army-out-title">${escapeHtml(armyChangedFileNameLabel(file, zh))}</span>
            <span class="wh-wb-army-out-meta">${escapeHtml(armyChangeTypeLabel(file.change_type, zh))} · ${escapeHtml(armyChangedFileDiffLabel(file, zh))}</span>
          </span>
          <span class="wh-wb-army-out-chev">${workbenchIcons.chevronRight}</span>
        </summary>
        <p class="wh-wb-army-out-href">${escapeHtml(file.path ?? (zh ? "这条改动没有具体文件路径。" : "This change has no specific file path."))}</p>
      </details>`
    )
    .join("");
  // 20 条上限就是既有的 MAX_CHANGES_DIFFED 统计上限(deliverable-diff-stats.ts)。恰好命中这个数字时
  // 提示"可能还有更多"——这是一个诚实但不精确的启发式(changes 数恰好等于 20 的边界会被误判成
  // "截断"),比对用户完全隐藏这件事更负责任。
  const possiblyTruncated = outputs.items.some((item) => (item.changed_files?.length ?? 0) >= 20);
  const truncationNote = possiblyTruncated
    ? `<p class="wh-wb-army-capped-note">${zh ? "部分提议的改动较多，可能还有更多改动没有逐条统计。" : "Some proposals have many changes — there may be more not individually counted here."}</p>`
    : "";
  return `${header}${rows}${truncationNote}`;
}

function renderArmyRunsSectionHtml(
  runsPage: ConversationArmyPanelVM["runs"],
  locale: Locale,
  members: ChatRenderMembers,
  opts: { loadingMore: boolean; loadMoreError?: string | undefined; showProject: boolean; scopeLabel: string; loadMoreDataAttr: string }
): string {
  const zh = locale === "zh-CN";
  const header = `<div class="wh-wb-army-sec-h">${zh ? "军团" : "Army"}<span class="wh-wb-army-sec-n">${opts.scopeLabel}</span></div>`;
  if (runsPage.runs.length === 0) {
    return `${header}<p class="wh-wb-army-empty-note">${zh ? "这里还没有军团在跑。" : "No army runs here yet."}</p>`;
  }
  const cards = runsPage.runs
    .map((run) =>
      renderArmyRunCardHtml(run, locale, {
        assigneeNickname: run.assignee_user_id ? members.get(run.assignee_user_id)?.nickname : undefined,
        showProject: opts.showProject,
        interactive: true
      })
    )
    .join("");
  const loadMore = runsPage.next_cursor
    ? `<button type="button" class="wh-wb-army-loadmore" ${opts.loadMoreDataAttr} ${opts.loadingMore ? "disabled" : ""}>${
        opts.loadingMore ? (zh ? "加载中…" : "Loading…") : zh ? "加载更多" : "Load more"
      }</button>`
    : "";
  const loadMoreErr = opts.loadMoreError
    ? `<p class="wh-wb-army-loadmore-error">${escapeHtml(opts.loadMoreError)}</p>`
    : "";
  return `${header}<div class="wh-wb-army-runs">${cards}</div>${loadMore}${loadMoreErr}`;
}

// 后台任务区：契约锁死 not_yet_available(00 §9/批5)——items 恒为空数组，永远没有真内容可看。之前这里
// 照实渲染一条「即将上线」空态，但 G-desktop 止血批 2 发现这在实践里是一块永远存在、永远空的固定区块
// （不是偶尔为空的正常态，是契约保证的恒空），跟composer 的死 chip 是同一类问题——不留一个只会说
// 「即将上线」的区块占位置。renderArmyPanelListHtml 现在不再调用这个函数，整块区不渲染；函数本身连同
// ArmyBackgroundTasksVM 类型都保留，等真的接上后台任务数据源（定时任务/后台巡检等）那天，把
// renderArmyPanelListHtml 里的调用加回来即可，不用重新设计这块 UI。
function renderArmyBackgroundTasksSectionHtml(_tasks: ArmyBackgroundTasksVM, zh: boolean): string {
  const header = `<div class="wh-wb-army-sec-h">${zh ? "后台任务" : "Background tasks"}</div>`;
  return `${header}<p class="wh-wb-army-empty-note">${zh ? "后台任务还没有接入真实数据源，即将上线。" : "Background tasks aren't wired to a real data source yet — coming soon."}</p>`;
}

export function renderArmyPanelLoadingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-army-loading"><span class="wh-wb-spinner"></span>${zh ? "正在拉军团面板…" : "Loading the army panel…"}</div>`;
}

export function renderArmyPanelErrorHtml(message: string, locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-army-error">${escapeHtml(message || (zh ? "军团面板没拉到" : "Couldn't load the army panel"))}</div>`;
}

function renderArmyPanelListHtml(
  state: Extract<ArmyPanelViewState, { mode: "list" }>,
  locale: Locale,
  members: ChatRenderMembers
): string {
  const zh = locale === "zh-CN";
  const outputsHtml = renderArmyOutputsSectionHtml(state.vm.outputs, zh);
  const changedFilesHtml = renderArmyChangedFilesSectionHtml(state.vm.outputs, zh);
  const runsHtml = renderArmyRunsSectionHtml(state.vm.runs, locale, members, {
    loadingMore: state.loadingMore,
    loadMoreError: state.loadMoreError,
    showProject: false,
    scopeLabel: zh ? `本会话 ${state.vm.runs.runs.length}` : `${state.vm.runs.runs.length} here`,
    loadMoreDataAttr: "data-wb-army-load-more"
  });
  // G-desktop 止血批 2：后台任务区永远空（契约锁死 not_yet_available），不再渲染这块永远说「即将上线」
  // 的固定区块——见 renderArmyBackgroundTasksSectionHtml 顶部注释，函数留着，真数据源接上再放开。
  return `<div class="wh-wb-army">${outputsHtml}${changedFilesHtml}${runsHtml}</div>`;
}

function renderArmyReplaySectionHtml(trace: ArmyRunTraceState, locale: Locale): string {
  const zh = locale === "zh-CN";
  if (trace.status === "idle") {
    return `<button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-army-open-replay>${zh ? "看回放" : "View replay"}</button>`;
  }
  if (trace.status === "loading") {
    return `<div class="wh-wb-army-replay-loading"><span class="wh-wb-spinner"></span>${zh ? "正在拉时间线…" : "Loading the timeline…"}</div>`;
  }
  if (trace.status === "error") {
    return `<p class="wh-wb-army-replay-error">${escapeHtml(trace.message)}</p><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-army-open-replay>${zh ? "重试" : "Retry"}</button>`;
  }
  const steps = trace.data.trace;
  if (!steps.length) {
    return `<p class="wh-wb-army-empty-note">${zh ? "还没有步骤记录。" : "No steps recorded yet."}</p>`;
  }
  const items = steps
    .map(
      (step) => `<div class="wh-wb-army-tl-item">
        <div class="wh-wb-army-tl-phase">${escapeHtml(agentStepPhaseLabel(step.phase, zh))}</div>
        <div class="wh-wb-army-tl-out">${escapeHtml(agentStepPublicSummary(step, zh))}<span class="wh-wb-army-tl-tm">${escapeHtml(formatMessageTime(step.created_at, locale))}</span></div>
      </div>`
    )
    .join("");
  return `<div class="wh-wb-army-sec-h" style="padding-left:0">${zh ? "时间线" : "Timeline"}</div><div class="wh-wb-army-timeline">${items}</div>`;
}

function renderArmyRunDetailHtml(state: Extract<ArmyPanelViewState, { mode: "detail" }>, locale: Locale): string {
  const zh = locale === "zh-CN";
  const { run, trace } = state;
  const chips = [
    agentRunStatusLabel(run.status, zh),
    executionHintLabel(run.execution_hint, zh),
    armyRunCostLabel(run.cost_cny, zh)
  ];
  const chipsHtml = chips.map((chip) => `<span class="wh-wb-army-chip">${escapeHtml(chip)}</span>`).join("");
  const stepHtml = run.recent_step
    ? `<div class="wh-wb-army-rd-step">
        <div class="wh-wb-army-rd-step-phase">${escapeHtml(agentStepPhaseLabel(run.recent_step.phase, zh))}</div>
        <div class="wh-wb-army-rd-step-out">${escapeHtml(
          agentStepPublicSummary(
            { phase: run.recent_step.phase, tool_name: run.recent_step.tool_name ?? undefined, output_excerpt: run.recent_step.output_excerpt ?? undefined },
            zh
          )
        )}</div>
      </div>`
    : `<p class="wh-wb-army-empty-note">${zh ? "还没有步骤记录。" : "No step recorded yet."}</p>`;
  return `<div class="wh-wb-army-detail">
    <button type="button" class="wh-wb-army-back" data-wb-army-back>${zh ? "‹ 返回" : "‹ Back"}</button>
    <div class="wh-wb-army-rd-name">${escapeHtml(run.cat_codename)}</div>
    <div class="wh-wb-army-rd-goal">${escapeHtml(run.goal_summary)}</div>
    <div class="wh-wb-army-rd-meta">${chipsHtml}</div>
    ${stepHtml}
    ${renderArmyReplaySectionHtml(trace, locale)}
  </div>`;
}

// 情境面板还没有任何会话情境可展示时的兜底文案（还没选项目、切到网盘标签/军团总览等）——
// shell.ts 的 renderSide 在 store.sidePanelContent 为空时也用这同一句话，避免两处各写一份文案。
export function renderArmySidePanelIdleHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<p class="wh-wb-army-empty-note">${zh ? "选一个会话查看输出与军团。" : "Pick a conversation to see its outputs and army."}</p>`;
}

export function renderArmyPanelHtml(state: ArmyPanelViewState | undefined, locale: Locale, members: ChatRenderMembers): string {
  if (!state) {
    return renderArmySidePanelIdleHtml(locale);
  }
  switch (state.mode) {
    case "loading":
      return renderArmyPanelLoadingHtml(locale);
    case "error":
      return renderArmyPanelErrorHtml(state.message, locale);
    case "list":
      return renderArmyPanelListHtml(state, locale, members);
    case "detail":
      return renderArmyRunDetailHtml(state, locale);
    default:
      return "";
  }
}

// —— 军团总览（overview.ts 消费）—— //

export type ArmyOverviewViewState =
  | { mode: "loading" }
  | { mode: "error"; message: string }
  | { mode: "ready"; vm: ArmyOverviewPageVM; loadingMore: boolean; loadMoreError?: string };

export type ArmyOverviewProjectGroup = {
  projectId: string;
  projectName: string;
  runs: ArmyOverviewRunCardVM[];
};

// 按 project_name 分组、保留服务端返回的原始（created_at desc）顺序——第一次见到某个 project_id 时
// 记下它的出场顺序,组内顺序不重排。
export function groupArmyOverviewRunsByProject(runs: readonly ArmyOverviewRunCardVM[]): ArmyOverviewProjectGroup[] {
  const order: string[] = [];
  const byProject = new Map<string, ArmyOverviewProjectGroup>();
  for (const run of runs) {
    let group = byProject.get(run.project_id);
    if (!group) {
      group = { projectId: run.project_id, projectName: run.project_name, runs: [] };
      byProject.set(run.project_id, group);
      order.push(run.project_id);
    }
    group.runs.push(run);
  }
  return order.map((id) => byProject.get(id)!);
}

export function renderArmyOverviewLoadingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-army-loading"><span class="wh-wb-spinner"></span>${zh ? "正在拉军团总览…" : "Loading the army overview…"}</div>`;
}

export function renderArmyOverviewErrorHtml(message: string, locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-army-error">${escapeHtml(message || (zh ? "军团总览没拉到" : "Couldn't load the army overview"))}<div style="margin-top:13px"><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-army-ov-retry>${zh ? "重试" : "Retry"}</button></div></div>`;
}

export function renderArmyOverviewEmptyHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-army-ov-empty">${zh ? "你名下所有项目现在都没有军团在跑。" : "No army runs across any of your projects right now."}</div>`;
}

export function renderArmyOverviewHtml(state: ArmyOverviewViewState, locale: Locale): string {
  if (state.mode === "loading") {
    return renderArmyOverviewLoadingHtml(locale);
  }
  if (state.mode === "error") {
    return renderArmyOverviewErrorHtml(state.message, locale);
  }
  const zh = locale === "zh-CN";
  const { vm } = state;
  if (vm.runs.runs.length === 0) {
    return renderArmyOverviewEmptyHtml(locale);
  }
  // 军团总览是跨项目视图，没有单一项目的成员名册可用来把 assignee_user_id 解成昵称（见 panel.ts
  // 顶部注释）——renderArmyRunCardHtml 不传 assigneeNickname，诚实地不显示"执行身份"行，而不是显示
  // 裸 uuid。
  const groups = groupArmyOverviewRunsByProject(vm.runs.runs);
  const groupsHtml = groups
    .map(
      (group) => `<div class="wh-wb-army-ov-group">
        <div class="wh-wb-army-ov-group-h">${escapeHtml(group.projectName)}<span class="wh-wb-army-sec-n">${group.runs.length}</span></div>
        <div class="wh-wb-army-runs">${group.runs
          .map((run) => renderArmyRunCardHtml(run, locale, { showProject: false, interactive: false }))
          .join("")}</div>
      </div>`
    )
    .join("");
  const loadMore = vm.runs.next_cursor
    ? `<button type="button" class="wh-wb-army-loadmore" data-wb-army-ov-load-more ${state.loadingMore ? "disabled" : ""}>${
        state.loadingMore ? (zh ? "加载中…" : "Loading…") : zh ? "加载更多" : "Load more"
      }</button>`
    : "";
  const loadMoreErr = state.loadMoreError
    ? `<p class="wh-wb-army-loadmore-error">${escapeHtml(state.loadMoreError)}</p>`
    : "";
  return `<div class="wh-wb-army-ov">${groupsHtml}${loadMore}${loadMoreErr}</div>`;
}
