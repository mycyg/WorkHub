// WorkHub 桌面 · 军团面板 / 军团总览的纯 HTML 渲染函数（照 chat/render.ts、drive/render.ts 的分工：
// 这里全部是无副作用的字符串拼装，可单测；imperative 的 DOM 挂载/事件绑定在 panel.ts / overview.ts）。
//
// 视觉基准是 r12-desktop-workbench/prototype/index.html 的右栏三区（.out-row / .runcard / .bg-row）与
// run 详情下钻（.run-detail / .tl），配色改用 design-system.ts 的浅色 --ds-* token（R13 批 V1 已把整个
// 工作台翻成浅色玻璃，这批新样式不再另起一套深色 token）。

import type {
  AgentRunLiveVM,
  ArmyBackgroundPageVM,
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

import { armyT, type ArmyCopyKey } from "./locales.js";

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

// R17 G3(#19)：run 详情里「取消(abort)」的多步态——idle(还没点)→confirming(确认弹层)→aborting(忙态)→
// error(失败可重试)。成功后 run 直接落 cancelled 终态，abort 控件随之消失(见 renderArmyRunActionsHtml)。
export type ArmyRunAbortState =
  | { status: "idle" }
  | { status: "confirming" }
  | { status: "aborting" }
  | { status: "error"; message: string };

// R17 G3(#8)：后台任务区(定时任务 + 主动性动态)——独立于会话 run 列表的全局机器状态，懒加载一次并缓存
// （见 panel.ts backgroundState）。渲染在会话面板 list 模式的最底部。
export type ArmyBackgroundViewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; vm: ArmyBackgroundPageVM };

export type ArmyPanelViewState =
  | { mode: "loading" }
  | { mode: "error"; message: string }
  | { mode: "list"; vm: ConversationArmyPanelVM; loadingMore: boolean; loadMoreError?: string }
  | { mode: "detail"; vm: ConversationArmyPanelVM; run: ArmyRunCardVM; trace: ArmyRunTraceState; abort: ArmyRunAbortState };

function executionHintLabel(hint: string, zh: boolean): string {
  if (hint === "server") {
    return armyT(zh, "cloud");
  }
  if (hint === "local") {
    return armyT(zh, "local");
  }
  return armyT(zh, "cloudOrLocal");
}

// 00 §9/契约不变量：succeeded/cancelled 都是"已经不再动了"的终态，视觉上归一为中性(done)；
// failed 是唯一的系统危险态；queued 是正常排队(wait)。
// R17 G3(#20)：escalated 从 wait 桶拆出独立徽标——它等的是【人】拍板(不是系统故障也不是普通排队)，
// 视觉上要一眼看出「这条在等你」，故给它独立的危色变体，不再和 queued 同归 wait。
function armyRunStatusVariant(status: string): "run" | "wait" | "done" | "fail" | "escalated" {
  switch (status) {
    case "running":
      return "run";
    case "queued":
      return "wait";
    case "escalated":
      return "escalated";
    case "failed":
      return "fail";
    default:
      return "done";
  }
}

// R17 G3(#20)：状态徽标——escalated 单独渲成「等你拍板」(危色)，其余用通用状态标签。
function armyRunStatusBadgeHtml(status: string, zh: boolean): string {
  const variant = armyRunStatusVariant(status);
  const text = status === "escalated"
    ? (armyT(zh, "waitingOnYou"))
    : agentRunStatusLabel(status, zh);
  return `<span class="wh-wb-army-rc-status wh-wb-army-rc-status--${variant}">${escapeHtml(text)}</span>`;
}

// R17 G3(#19/#20)：卡片底部内联动作——
//   * escalated → 「去处理」(打开决策收件箱，data-wb-army-handle-escalation)。
//   * queued/running → 「取消」(打开该 run 详情并进入取消确认，data-wb-army-abort-run)。取消是有状态的
//     多步动作(确认→忙态→回流)，实际确认流在 run 详情里做(见 renderArmyRunAbortControlHtml)——卡上这个
//     按钮是入口，点了就把详情打开到确认态，避免在紧凑的卡片里塞一整套确认 UI。
//   * 其它终态无内联动作。
function armyRunCardActionsHtml(run: ArmyRunCardLike, zh: boolean): string {
  if (run.status === "escalated") {
    return `<button type="button" class="wh-wb-army-rc-act wh-wb-army-rc-act--danger" data-wb-army-handle-escalation>${armyT(zh, "handle")}</button>`;
  }
  if (run.status === "queued" || run.status === "running") {
    return `<button type="button" class="wh-wb-army-rc-act" data-wb-army-abort-run="${escapeHtml(run.id)}">${armyT(zh, "cancel")}</button>`;
  }
  return "";
}

function armySourceLabelHtml(run: { source_conversation_id: string | null; source_action_card_item_id: string | null }, zh: boolean): string {
  const text = run.source_action_card_item_id
    ? armyT(zh, "fromAnActionCardInThis")
    : run.source_conversation_id
      ? armyT(zh, "fromThisConversation")
      : armyT(zh, "systemDispatched");
  return `<span class="wh-wb-army-rc-source">${escapeHtml(text)}</span>`;
}

function armyRunCostLabel(costCny: string | null, zh: boolean): string {
  // costCny === null 是"这次执行还没有任何计费记录"，和确认花了 0 元不是一回事（见契约顶部注释）——
  // 两种情况都老实标注，不拿 null 硬凑成 "¥0"。
  return costCny === null ? (armyT(zh, "noCostYet")) : `¥${escapeHtml(costCny)}`;
}

// R17 G3(#19/#20/#21)：卡片的三种交互形态——
//   * open-run  —— 会话情境面板：点主体打开右栏 run 详情；底部内联「取消/去处理」动作(见 armyRunCardActionsHtml)。
//     主体是内层 <button>、动作在外层同级的 foot 里，避免 button 套 button 的非法嵌套。
//   * drilldown —— 军团总览(#21)：整卡可点，跨项目下钻(selectProject + 右栏定位该 run 详情)，携 run/project/
//     conversation id。无内联动作(下钻到详情后再操作)。
//   * none      —— 静态展示(不可点)，04 铁律#3：没有真接线就不装可点。
export type ArmyRunCardInteraction =
  | { mode: "none" }
  | { mode: "open-run" }
  | { mode: "drilldown"; projectId: string };

export function renderArmyRunCardHtml(
  run: ArmyRunCardLike,
  locale: Locale,
  opts: { assigneeNickname?: string | undefined; showProject: boolean; interaction: ArmyRunCardInteraction }
): string {
  const zh = locale === "zh-CN";
  const variant = armyRunStatusVariant(run.status);
  const projectBadge =
    opts.showProject && "project_name" in run
      ? `<span class="wh-wb-army-rc-project">${escapeHtml(run.project_name)}</span>`
      : "";
  const assigneeLine = opts.assigneeNickname
    ? `<span class="wh-wb-army-rc-assignee">${armyT(locale, "actingAs")}${escapeHtml(opts.assigneeNickname)}</span>`
    : "";
  const stepLine = run.recent_step
    ? `<div class="wh-wb-army-rc-step">${escapeHtml(
        agentStepPublicSummary(
          { phase: run.recent_step.phase, tool_name: run.recent_step.tool_name ?? undefined, output_excerpt: run.recent_step.output_excerpt ?? undefined },
          zh
        )
      )}</div>`
    : "";
  const bodyInner = `<div class="wh-wb-army-rc-top">
      <span class="wh-wb-army-rc-cat">${workbenchIcons.cat}</span>
      <b class="wh-wb-army-rc-name">${escapeHtml(run.cat_codename)}</b>
      ${projectBadge}
      <span class="wh-wb-army-rc-exec">${escapeHtml(executionHintLabel(run.execution_hint, zh))}</span>
      ${armyRunStatusBadgeHtml(run.status, zh)}
    </div>
    <div class="wh-wb-army-rc-goal">${escapeHtml(run.goal_summary)}</div>
    <div class="wh-wb-army-rc-meta">${assigneeLine}${armySourceLabelHtml(run, zh)}</div>
    ${stepLine}`;
  const costHtml = `<span>${armyRunCostLabel(run.cost_cny, zh)}</span>`;

  if (opts.interaction.mode === "open-run") {
    const actions = armyRunCardActionsHtml(run, zh);
    return `<div class="wh-wb-army-rc wh-wb-army-rc--${variant}">
      <button type="button" class="wh-wb-army-rc-hit" data-wb-army-open-run="${escapeHtml(run.id)}">${bodyInner}</button>
      <div class="wh-wb-army-rc-foot">${costHtml}${actions}</div>
    </div>`;
  }
  if (opts.interaction.mode === "drilldown") {
    const conversationAttr = run.source_conversation_id
      ? ` data-wb-army-conversation-id="${escapeHtml(run.source_conversation_id)}"`
      : "";
    return `<button type="button" class="wh-wb-army-rc wh-wb-army-rc--${variant}" data-wb-army-ov-drilldown data-wb-army-run-id="${escapeHtml(run.id)}" data-wb-army-project-id="${escapeHtml(opts.interaction.projectId)}"${conversationAttr}>${bodyInner}
      <div class="wh-wb-army-rc-foot">${costHtml}</div>
    </button>`;
  }
  return `<div class="wh-wb-army-rc wh-wb-army-rc--${variant} wh-wb-army-rc--static">${bodyInner}
    <div class="wh-wb-army-rc-foot">${costHtml}</div>
  </div>`;
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
  const header = `<div class="wh-wb-army-sec-h">${armyT(zh, "outputs")}<span class="wh-wb-army-sec-n">${outputs.items.length}</span></div>`;
  if (outputs.items.length === 0) {
    return `${header}<p class="wh-wb-army-empty-note">${armyT(zh, "noOutputsFromThisConversationYet")}</p>`;
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
    ? `<p class="wh-wb-army-capped-note">${armyT(zh, "thereAreMoreOutputsThanShown")}</p>`
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
    return armyT(zh, "unknownFile");
  }
  const segments = file.path.split("/");
  return segments[segments.length - 1] || file.path;
}

// adds/dels 缺省即"这条改动没能计入统计"(见 armyChangedFileVmSchema 的契约注释)，绝不能显示成
// "+0 -0"——那会被读成"这条改动没有实质内容"，是一句谎言。
function armyChangedFileDiffLabel(file: ArmyChangedFileVM, zh: boolean): string {
  if (file.adds === undefined && file.dels === undefined) {
    return armyT(zh, "changeDetailsUnavailable");
  }
  return `+${file.adds ?? 0} -${file.dels ?? 0}`;
}

// 变动文件区(P1.5 契约)：紧跟输出区之后——文件正是输出区里各个提议产出的具体物。与网盘侧栏
// "最近文件"的边界：这里只展示已经进入提议的 AI 产出改动，不是网盘全量最近文件列表。点击展开
// 复用输出区同款 <details> 折叠(04 铁律#3：没有深链接线就不装作能跳转)，样式复用既有
// .wh-wb-army-out-* 类(没有为这批新增 CSS，见批次汇报)。
function renderArmyChangedFilesSectionHtml(outputs: ArmyOutputsVM, zh: boolean): string {
  const files = collectArmyChangedFiles(outputs);
  const header = `<div class="wh-wb-army-sec-h">${armyT(zh, "changedFiles")}<span class="wh-wb-army-sec-n">${files.length}</span></div>`;
  if (files.length === 0) {
    return `${header}<p class="wh-wb-army-empty-note">${armyT(zh, "noChangedFilesFromThisConversation")}</p>`;
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
        <p class="wh-wb-army-out-href">${escapeHtml(file.path ?? (armyT(zh, "thisChangeHasNoSpecificFile")))}</p>
      </details>`
    )
    .join("");
  // 20 条上限就是既有的 MAX_CHANGES_DIFFED 统计上限(deliverable-diff-stats.ts)。恰好命中这个数字时
  // 提示"可能还有更多"——这是一个诚实但不精确的启发式(changes 数恰好等于 20 的边界会被误判成
  // "截断"),比对用户完全隐藏这件事更负责任。
  const possiblyTruncated = outputs.items.some((item) => (item.changed_files?.length ?? 0) >= 20);
  const truncationNote = possiblyTruncated
    ? `<p class="wh-wb-army-capped-note">${armyT(zh, "someProposalsHaveManyChangesThere")}</p>`
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
  const header = `<div class="wh-wb-army-sec-h">${armyT(locale, "army")}<span class="wh-wb-army-sec-n">${opts.scopeLabel}</span></div>`;
  if (runsPage.runs.length === 0) {
    return `${header}<p class="wh-wb-army-empty-note">${armyT(locale, "noArmyRunsHereYet")}</p>`;
  }
  const cards = runsPage.runs
    .map((run) =>
      renderArmyRunCardHtml(run, locale, {
        assigneeNickname: run.assignee_user_id ? members.get(run.assignee_user_id)?.nickname : undefined,
        showProject: opts.showProject,
        interaction: { mode: "open-run" }
      })
    )
    .join("");
  const loadMore = runsPage.next_cursor
    ? `<button type="button" class="wh-wb-army-loadmore" ${opts.loadMoreDataAttr} ${opts.loadingMore ? "disabled" : ""}>${
        opts.loadingMore ? (armyT(locale, "loading")) : armyT(locale, "loadMore")
      }</button>`
    : "";
  const loadMoreErr = opts.loadMoreError
    ? `<p class="wh-wb-army-loadmore-error">${escapeHtml(opts.loadMoreError)}</p>`
    : "";
  return `${header}<div class="wh-wb-army-runs">${cards}</div>${loadMore}${loadMoreErr}`;
}

// R17 G3(#8 拍板 B)：后台任务区接真——两块真实数据(定时任务 pulse 统计 + 最近主动性动态)。此前这块
// 契约锁死 not_yet_available 永远空、已停止渲染；现在 GET /api/army/background 提供真数据源，恢复渲染。
// 定时任务：每条一行(名称 + 间隔 + 上次 tick + tick/错误计数)，pulse 总开关未开时诚实标注「未启用」。
// 主动性动态：Cuu 最近为「你」做的主动性(追 DDL/关怀/找人)，delivered/suppressed 都展示，空态诚实。

function backgroundIntervalLabel(intervalMs: number, zh: boolean): string {
  if (intervalMs <= 0) {
    return armyT(zh, "manual");
  }
  const seconds = Math.round(intervalMs / 1000);
  if (seconds < 60) {
    return zh ? `每 ${seconds} 秒` : `every ${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return zh ? `每 ${minutes} 分钟` : `every ${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  return zh ? `每 ${hours} 小时` : `every ${hours}h`;
}

// 定时任务名 → 人话(与 pulse-scheduler.ts 注册的 name 一一对应)。未映射的名字诚实回退原串，不编造。
// M-10（R24 S3 走查）：pulse-scheduler.ts 后来又注册了 clarification-chase/proactive-intent-recovery
// 两个任务，这张表没跟上——情境面板里就混进了两条没翻译的内部调度器 id，终端用户看不懂。补齐。
// 定时任务的内部注册名 → 词典键。后端注册名是实现标识（approval-sla / care-scan …），
// 用户看到的必须是人话，未登记的一律落到「其它定时任务」——绝不把生 id 渲染出去。
export const BACKGROUND_TASK_LABEL_KEY: Record<string, ArmyCopyKey> = {
  "approval-sla": "taskApprovalSla",
  "notification-reminder": "taskNotificationReminder",
  "approval-digest": "taskApprovalDigest",
  "ddl-chase": "taskDdlChase",
  "care-scan": "taskCareScan",
  // CHAT-8：扫描长期无人回答的澄清会话，给提交人推一条提醒。
  "clarification-chase": "taskClarificationChase",
  // R20 REL-2：主动提醒投递前若进程崩溃，扫描并补投那些卡住的记录（纯内部容错，无新用户价值主张，
  // 但仍要给个人话名字，不能漏译成生 id）。
  "proactive-intent-recovery": "taskProactiveIntentRecovery"
};

function backgroundTaskLabel(name: string, zh: boolean): string {
  return armyT(zh, BACKGROUND_TASK_LABEL_KEY[name] ?? "taskOther");
}

// 主动提醒 kind → 词典键（与 proactive-intents.ts 的 ProactiveIntentKind 对应）。
export const PROACTIVE_KIND_LABEL_KEY: Record<string, ArmyCopyKey> = {
  ddl_chase: "nudgeDdlChase",
  find_owner: "nudgeFindOwner",
  care: "nudgeCare"
};

function proactiveKindLabel(kind: string, zh: boolean): string {
  return armyT(zh, PROACTIVE_KIND_LABEL_KEY[kind] ?? "nudgeOther");
}

// 主动提醒的 stage → 词典键。stage 是后端的分级标识（t3d / high_load …），
// 未登记的不渲染——宁可少一段限定语，也不给用户看裸 id。
export const PROACTIVE_STAGE_LABEL_KEY: Record<string, ArmyCopyKey> = {
  t3d: "stageT3d",
  t1d: "stageT1d",
  overdue: "stageOverdue",
  escalate: "stageEscalate",
  needs_owner: "stageNeedsOwner",
  high_load: "stageHighLoad",
  late_night: "stageLateNight",
  frustration: "stageFrustration"
};

function proactiveStageLabel(stage: string | null, zh: boolean): string {
  const key = stage ? PROACTIVE_STAGE_LABEL_KEY[stage] : undefined;
  return key ? armyT(zh, key) : "";
}

function proactiveStatusLabel(status: "delivered" | "suppressed", zh: boolean): string {
  return status === "delivered" ? (armyT(zh, "delivered")) : armyT(zh, "heldBack");
}

function renderArmyBackgroundSchedulerHtml(scheduler: ArmyBackgroundPageVM["scheduler"], locale: Locale): string {
  const zh = locale === "zh-CN";
  const header = `<div class="wh-wb-army-sec-h">${armyT(locale, "scheduledTasks")}<span class="wh-wb-army-sec-n">${scheduler.tasks.length}</span></div>`;
  if (!scheduler.enabled) {
    return `${header}<p class="wh-wb-army-empty-note">${armyT(locale, "theBackgroundSchedulerIsCurrentlyDisabled")}</p>`;
  }
  if (scheduler.tasks.length === 0) {
    return `${header}<p class="wh-wb-army-empty-note">${armyT(locale, "noScheduledTasksRegisteredYet")}</p>`;
  }
  const rows = scheduler.tasks
    .map((task) => {
      const lastTick = task.last_tick_at
        ? (zh ? `上次 ${formatMessageTime(task.last_tick_at, locale)}` : `last ${formatMessageTime(task.last_tick_at, locale)}`)
        : (armyT(locale, "neverRun"));
      const counts = zh
        ? `跑了 ${task.tick_count} 次${task.error_count > 0 ? ` · ${task.error_count} 次出错` : ""}`
        : `${task.tick_count} ticks${task.error_count > 0 ? ` · ${task.error_count} errors` : ""}`;
      return `<div class="wh-wb-army-bg-row${task.error_count > 0 ? " wh-wb-army-bg-row--warn" : ""}">
        <div class="wh-wb-army-bg-main">
          <span class="wh-wb-army-bg-name">${escapeHtml(backgroundTaskLabel(task.name, zh))}</span>
          <span class="wh-wb-army-bg-int">${escapeHtml(backgroundIntervalLabel(task.interval_ms, zh))}</span>
        </div>
        <div class="wh-wb-army-bg-meta">${escapeHtml(lastTick)} · ${escapeHtml(counts)}</div>
      </div>`;
    })
    .join("");
  return `${header}<div class="wh-wb-army-bg-list">${rows}</div>`;
}

function renderArmyBackgroundProactiveHtml(proactive: ArmyBackgroundPageVM["proactive"], locale: Locale): string {
  const zh = locale === "zh-CN";
  const header = `<div class="wh-wb-army-sec-h">${armyT(locale, "proactivity")}<span class="wh-wb-army-sec-n">${proactive.items.length}</span></div>`;
  if (proactive.items.length === 0) {
    return `${header}<p class="wh-wb-army-empty-note">${armyT(locale, "noRecentProactivity")}</p>`;
  }
  const rows = proactive.items
    .map((item) => {
      const statusClass = item.status === "suppressed" ? " wh-wb-army-bg-status--muted" : "";
      const stageLabel = proactiveStageLabel(item.stage, zh);
      const stage = stageLabel ? ` · ${escapeHtml(stageLabel)}` : "";
      return `<div class="wh-wb-army-bg-row">
        <div class="wh-wb-army-bg-main">
          <span class="wh-wb-army-bg-name">${escapeHtml(proactiveKindLabel(item.kind, zh))}${stage}</span>
          <span class="wh-wb-army-bg-status${statusClass}">${escapeHtml(proactiveStatusLabel(item.status, zh))}</span>
        </div>
        <div class="wh-wb-army-bg-meta">${escapeHtml(formatMessageTime(item.created_at, locale))}</div>
      </div>`;
    })
    .join("");
  const cappedNote = proactive.capped
    ? `<p class="wh-wb-army-capped-note">${armyT(locale, "thereIsMoreProactivityThanShown")}</p>`
    : "";
  return `${header}<div class="wh-wb-army-bg-list">${rows}</div>${cappedNote}`;
}

// 后台任务区外壳——懒加载态。loading/error 诚实标注(不拿空态冒充)；ready 时渲染两块。
export function renderArmyBackgroundSectionHtml(background: ArmyBackgroundViewState | undefined, locale: Locale): string {
  const zh = locale === "zh-CN";
  const header = `<div class="wh-wb-army-sec-h">${armyT(locale, "backgroundTasks")}</div>`;
  if (!background || background.status === "loading") {
    return `${header}<p class="wh-wb-army-empty-note">${armyT(locale, "loadingBackgroundTasks")}</p>`;
  }
  if (background.status === "error") {
    return `${header}<p class="wh-wb-army-loadmore-error">${escapeHtml(background.message)}</p>`;
  }
  return `${renderArmyBackgroundSchedulerHtml(background.vm.scheduler, locale)}${renderArmyBackgroundProactiveHtml(background.vm.proactive, locale)}`;
}

export function renderArmyPanelLoadingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-army-loading"><span class="wh-wb-spinner"></span>${armyT(locale, "loadingTheArmyPanel")}</div>`;
}

export function renderArmyPanelErrorHtml(message: string, locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-army-error">${escapeHtml(message || (armyT(locale, "couldnTLoadTheArmyPanel")))}</div>`;
}

function renderArmyPanelListHtml(
  state: Extract<ArmyPanelViewState, { mode: "list" }>,
  locale: Locale,
  members: ChatRenderMembers,
  background: ArmyBackgroundViewState | undefined
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
  // R17 G3(#8)：后台任务区接真数据源——恢复渲染（定时任务 + 主动性动态），懒加载态由 panel.ts 传入。
  const backgroundHtml = renderArmyBackgroundSectionHtml(background, locale);
  return `<div class="wh-wb-army">${outputsHtml}${changedFilesHtml}${runsHtml}${backgroundHtml}</div>`;
}

function renderArmyReplaySectionHtml(trace: ArmyRunTraceState, locale: Locale): string {
  const zh = locale === "zh-CN";
  if (trace.status === "idle") {
    return `<button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-army-open-replay>${armyT(locale, "viewReplay")}</button>`;
  }
  if (trace.status === "loading") {
    return `<div class="wh-wb-army-replay-loading"><span class="wh-wb-spinner"></span>${armyT(locale, "loadingTheTimeline")}</div>`;
  }
  if (trace.status === "error") {
    return `<p class="wh-wb-army-replay-error">${escapeHtml(trace.message)}</p><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-army-open-replay>${armyT(locale, "retry")}</button>`;
  }
  const steps = trace.data.trace;
  if (!steps.length) {
    return `<p class="wh-wb-army-empty-note">${armyT(locale, "noStepsRecordedYet")}</p>`;
  }
  const items = steps
    .map(
      (step) => `<div class="wh-wb-army-tl-item">
        <div class="wh-wb-army-tl-phase">${escapeHtml(agentStepPhaseLabel(step.phase, zh))}</div>
        <div class="wh-wb-army-tl-out">${escapeHtml(agentStepPublicSummary(step, zh))}<span class="wh-wb-army-tl-tm">${escapeHtml(formatMessageTime(step.created_at, locale))}</span></div>
      </div>`
    )
    .join("");
  return `<div class="wh-wb-army-sec-h" style="padding-left:0">${armyT(locale, "timeline")}</div><div class="wh-wb-army-timeline">${items}</div>`;
}

// R17 G3(#19/#20)：run 详情的动作区——escalated 给「去处理」(→ 决策收件箱)；queued/running 给带确认的
// 「取消」(→ /agent-runs/:id/abort)。其它终态无动作。
function renderArmyRunActionsHtml(run: ArmyRunCardVM, abort: ArmyRunAbortState, zh: boolean): string {
  if (run.status === "escalated") {
    return `<div class="wh-wb-army-rd-actions">
      <button type="button" class="wh-wb-btn wh-wb-btn--danger" data-wb-army-handle-escalation>${armyT(zh, "handle")}</button>
    </div>`;
  }
  if (run.status !== "queued" && run.status !== "running") {
    return "";
  }
  if (abort.status === "confirming") {
    return `<div class="wh-wb-army-rd-actions wh-wb-army-abort-confirm">
      <p class="wh-wb-army-abort-note">${armyT(zh, "cancelThisRunItWillStop")}</p>
      <div class="wh-wb-army-abort-btns">
        <button type="button" class="wh-wb-btn wh-wb-btn--danger" data-wb-army-abort-confirm>${armyT(zh, "cancelRun")}</button>
        <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-army-abort-dismiss>${armyT(zh, "back")}</button>
      </div>
    </div>`;
  }
  if (abort.status === "aborting") {
    return `<div class="wh-wb-army-rd-actions"><div class="wh-wb-army-replay-loading"><span class="wh-wb-spinner"></span>${armyT(zh, "cancelling")}</div></div>`;
  }
  if (abort.status === "error") {
    return `<div class="wh-wb-army-rd-actions">
      <p class="wh-wb-army-abort-error">${escapeHtml(abort.message)}</p>
      <div class="wh-wb-army-abort-btns">
        <button type="button" class="wh-wb-btn wh-wb-btn--danger" data-wb-army-abort-confirm>${armyT(zh, "retry2")}</button>
        <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-army-abort-dismiss>${armyT(zh, "back")}</button>
      </div>
    </div>`;
  }
  return `<div class="wh-wb-army-rd-actions">
    <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-army-abort-open>${armyT(zh, "cancelThisRun")}</button>
  </div>`;
}

function renderArmyRunDetailHtml(state: Extract<ArmyPanelViewState, { mode: "detail" }>, locale: Locale): string {
  const zh = locale === "zh-CN";
  const { run, trace, abort } = state;
  const chips = [
    // R17 G3(#20)：escalated 详情头也用「等你拍板」口径，与卡片徽标一致，不再裸显「已升级」。
    run.status === "escalated" ? (armyT(locale, "waitingOnYou")) : agentRunStatusLabel(run.status, zh),
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
    : `<p class="wh-wb-army-empty-note">${armyT(locale, "noStepRecordedYet")}</p>`;
  return `<div class="wh-wb-army-detail">
    <button type="button" class="wh-wb-army-back" data-wb-army-back>${armyT(locale, "back2")}</button>
    <div class="wh-wb-army-rd-name">${escapeHtml(run.cat_codename)}</div>
    <div class="wh-wb-army-rd-goal">${escapeHtml(run.goal_summary)}</div>
    <div class="wh-wb-army-rd-meta">${chipsHtml}</div>
    ${stepHtml}
    ${renderArmyRunActionsHtml(run, abort, zh)}
    ${renderArmyReplaySectionHtml(trace, locale)}
  </div>`;
}

// 情境面板还没有任何会话情境可展示时的兜底文案（还没选项目、切到网盘标签/军团总览等）——
// shell.ts 的 renderSide 在 store.sidePanelContent 为空时也用这同一句话，避免两处各写一份文案。
export function renderArmySidePanelIdleHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<p class="wh-wb-army-empty-note">${armyT(locale, "pickAConversationToSeeIts")}</p>`;
}

export function renderArmyPanelHtml(
  state: ArmyPanelViewState | undefined,
  locale: Locale,
  members: ChatRenderMembers,
  background?: ArmyBackgroundViewState | undefined
): string {
  if (!state) {
    return renderArmySidePanelIdleHtml(locale);
  }
  switch (state.mode) {
    case "loading":
      return renderArmyPanelLoadingHtml(locale);
    case "error":
      return renderArmyPanelErrorHtml(state.message, locale);
    case "list":
      return renderArmyPanelListHtml(state, locale, members, background);
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

// R17 G3(#32)：总览是跨项目聚合、无天然 SSE 刷新——头部标注「数据加载于 N 分钟前」，让用户知道手里
// 这份是多久前的快照(配合既有的手动刷新按钮)。纯函数，now 注入便于单测。
export function armyDataAgeLabel(generatedAtIso: string, nowMs: number, zh: boolean): string {
  const genMs = Date.parse(generatedAtIso);
  if (!Number.isFinite(genMs)) {
    return "";
  }
  const diffMin = Math.max(0, Math.floor((nowMs - genMs) / 60000));
  if (diffMin < 1) {
    return armyT(zh, "loadedJustNow");
  }
  if (diffMin < 60) {
    return zh ? `数据加载于 ${diffMin} 分钟前` : `Loaded ${diffMin}m ago`;
  }
  const diffHr = Math.floor(diffMin / 60);
  return zh ? `数据加载于 ${diffHr} 小时前` : `Loaded ${diffHr}h ago`;
}

export function renderArmyOverviewLoadingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-army-loading"><span class="wh-wb-spinner"></span>${armyT(locale, "loadingTheArmyOverview")}</div>`;
}

export function renderArmyOverviewErrorHtml(message: string, locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-army-error">${escapeHtml(message || (armyT(locale, "couldnTLoadTheArmyOverview")))}<div style="margin-top:13px"><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-army-ov-retry>${armyT(locale, "retry")}</button></div></div>`;
}

export function renderArmyOverviewEmptyHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-army-ov-empty">${armyT(locale, "noArmyRunsAcrossAnyOf")}</div>`;
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
          .map((run) => renderArmyRunCardHtml(run, locale, { showProject: false, interaction: { mode: "drilldown", projectId: group.projectId } }))
          .join("")}</div>
      </div>`
    )
    .join("");
  const loadMore = vm.runs.next_cursor
    ? `<button type="button" class="wh-wb-army-loadmore" data-wb-army-ov-load-more ${state.loadingMore ? "disabled" : ""}>${
        state.loadingMore ? (armyT(locale, "loading")) : armyT(locale, "loadMore")
      }</button>`
    : "";
  const loadMoreErr = state.loadMoreError
    ? `<p class="wh-wb-army-loadmore-error">${escapeHtml(state.loadMoreError)}</p>`
    : "";
  return `<div class="wh-wb-army-ov">${groupsHtml}${loadMore}${loadMoreErr}</div>`;
}
