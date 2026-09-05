// WorkHub 桌面 · 工作台「时间线」标签的纯渲染层（照 chat/drive 的分工：无 DOM/网络副作用，只把
// VM + 本地 UI 态渲成 HTML 字符串，便于单测）。
//
// 甘特渲染方案（拍板 · 见批 E2 报告）：纯 CSS 定位的水平排期条 + 顶部周刻度轴，不引第三方库。
// 依赖关系采用「标注式」而非跨行 SVG 连线——中栏按里程碑分组、可垂直滚动，且依赖可跨组跨里程碑，
// 在这种布局里画稳定的跨行连线复杂且脆弱（滚动/换行都会错位），标注式「依赖 #CODE」芯片同样把
// 「谁等谁」讲清楚且鲁棒。关键路径高亮（阻塞 N 项徽标 + 逾期阻塞置顶警示）仍保留，信息不丢。

import { escapeHtml } from "@workhub/web-runtime";
import type {
  ProjectMilestoneVM,
  ProjectTimelinePageVM,
  TimelineWorkItemVM
} from "@workhub/contracts";

import { workbenchIcons } from "../icons.js";

type Locale = "zh-CN" | "en-US";

// 时间线内联表单/忙态的本地 UI 状态——由 view.ts 持有，render 只读。
export type TimelineMilestoneForm =
  | { mode: "create" }
  | { mode: "edit"; milestoneId: string };

export type TimelineUiState = {
  // 当前打开的里程碑内联表单（新建 / 编辑某条）；关闭时 undefined。
  milestoneForm?: TimelineMilestoneForm | undefined;
  // 里程碑表单草稿（标题 + 截止日 yyyy-mm-dd）。
  draftTitle: string;
  draftDue: string;
  // 全局忙态（正在提交某个写动作）——置真时禁用交互控件、给出手感。
  busy: boolean;
  // 上一次写动作的人话化错误（422 环/跨项目等）——非空时在顶部渲一条可读横幅。
  error?: string | undefined;
};

export function emptyTimelineUiState(): TimelineUiState {
  return { draftTitle: "", draftDue: "", busy: false };
}

const DAY_MS = 86_400_000;

function parseDate(value: string | undefined | null): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// 周起点（周一，UTC，避开本地时区在测试里漂移）。
function startOfWeekUtc(date: Date): Date {
  const x = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = (x.getUTCDay() + 6) % 7; // 0 = Monday
  x.setUTCDate(x.getUTCDate() - weekday);
  return x;
}

function formatMonthDay(date: Date): string {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

// 表单里 <input type="date"> 用 yyyy-mm-dd；把 ISO 截止日转成它。
function toDateInputValue(iso: string | undefined | null): string {
  const date = parseDate(iso);
  if (!date) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

type WindowModel = { start: number; end: number; weeks: Date[] };

// 时间窗 = 最早 start/due 到最晚 due/start，向外扩一周（周对齐），并列出每周刻度。
function computeWindow(vm: ProjectTimelinePageVM): WindowModel | undefined {
  const stamps: number[] = [];
  for (const item of vm.items) {
    const start = parseDate(item.start_at);
    const due = parseDate(item.due_at);
    if (start) {
      stamps.push(start.getTime());
    }
    if (due) {
      stamps.push(due.getTime());
    }
  }
  for (const milestone of vm.milestones) {
    const due = parseDate(milestone.due_at);
    if (due) {
      stamps.push(due.getTime());
    }
  }
  if (stamps.length === 0) {
    return undefined;
  }
  const min = Math.min(...stamps);
  const max = Math.max(...stamps);
  const start = startOfWeekUtc(new Date(min)).getTime();
  // 末端外扩一周，再对齐到周起点之后一整周。
  const end = startOfWeekUtc(new Date(max + 7 * DAY_MS)).getTime() + 7 * DAY_MS;
  const weeks: Date[] = [];
  for (let cursor = start; cursor < end; cursor += 7 * DAY_MS) {
    weeks.push(new Date(cursor));
  }
  return { start, end, weeks };
}

function pct(value: number, window: WindowModel): number {
  const span = window.end - window.start;
  if (span <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, ((value - window.start) / span) * 100));
}

const DONE_STATUSES = new Set(["done", "merged", "cancelled"]);

type PlacedBar = {
  leftPct: number;
  widthPct: number;
  placeholder: boolean;
  tone: "normal" | "overdue" | "done";
};

// 把一个工作项的 start/due 放到时间窗上。无 start 用 due 前 3 天虚线占位；无 due 用 start 后 3 天虚线；
// 两者都无 → 无法排期（返回 undefined，行里改渲「未排期」）。
function placeItem(item: TimelineWorkItemVM, window: WindowModel): PlacedBar | undefined {
  const start = parseDate(item.start_at);
  const due = parseDate(item.due_at);
  let from: number;
  let to: number;
  let placeholder = false;
  if (start && due) {
    from = start.getTime();
    to = due.getTime();
  } else if (due) {
    to = due.getTime();
    from = to - 3 * DAY_MS;
    placeholder = true;
  } else if (start) {
    from = start.getTime();
    to = from + 3 * DAY_MS;
    placeholder = true;
  } else {
    return undefined;
  }
  if (to < from) {
    to = from;
  }
  const leftPct = pct(from, window);
  const rightPct = pct(to, window);
  const tone: PlacedBar["tone"] = item.overdue
    ? "overdue"
    : DONE_STATUSES.has(item.status)
      ? "done"
      : "normal";
  return { leftPct, widthPct: Math.max(0, rightPct - leftPct), placeholder, tone };
}

function statusLabel(status: string, zh: boolean): string {
  const map: Record<string, { zh: string; en: string }> = {
    intake: { zh: "待澄清", en: "Intake" },
    ai_clarifying: { zh: "澄清中", en: "Clarifying" },
    spec_ready: { zh: "待开工", en: "Ready" },
    ai_working: { zh: "进行中", en: "In progress" },
    escalated: { zh: "已升级", en: "Escalated" },
    pm_mode: { zh: "人工接管", en: "PM mode" },
    in_review: { zh: "评审中", en: "In review" },
    merged: { zh: "已合并", en: "Merged" },
    done: { zh: "已完成", en: "Done" },
    cancelled: { zh: "已取消", en: "Cancelled" }
  };
  const entry = map[status];
  return entry ? (zh ? entry.zh : entry.en) : status;
}

// 顶部周刻度轴：刻度密时稀疏标注（>14 周每 2 格、>28 周每 4 格），网格线始终画。
function renderAxisHtml(window: WindowModel): string {
  const total = window.weeks.length;
  const step = total > 28 ? 4 : total > 14 ? 2 : 1;
  const ticks = window.weeks
    .map((weekStart, index) => {
      const left = pct(weekStart.getTime(), window);
      const showLabel = index % step === 0;
      return `<span class="wh-wb-tl-tick" style="left:${left.toFixed(3)}%">${
        showLabel ? `<span class="wh-wb-tl-tick-label">${escapeHtml(formatMonthDay(weekStart))}</span>` : ""
      }</span>`;
    })
    .join("");
  return `<div class="wh-wb-tl-axis" aria-hidden="true">${ticks}</div>`;
}

function renderTodayMarkerHtml(vm: ProjectTimelinePageVM, window: WindowModel, zh: boolean): string {
  const now = parseDate(vm.generated_at);
  if (!now) {
    return "";
  }
  const stamp = now.getTime();
  if (stamp < window.start || stamp > window.end) {
    return "";
  }
  const left = pct(stamp, window);
  return `<span class="wh-wb-tl-today" style="left:${left.toFixed(3)}%" title="${zh ? "今天" : "Today"}"></span>`;
}

// 依赖芯片 + 加依赖选择器。code 从全图 items 解析（跨里程碑/跨组也能拿到）。
function renderRowDepsHtml(
  item: TimelineWorkItemVM,
  codeById: Map<string, string>,
  otherItems: TimelineWorkItemVM[],
  ui: TimelineUiState,
  zh: boolean
): string {
  const chips = item.depends_on
    .map((depId) => {
      const code = codeById.get(depId) ?? depId.slice(0, 8);
      return `<span class="wh-wb-tl-dep">${zh ? "依赖" : "needs"} ${escapeHtml(code)}<button type="button" class="wh-wb-tl-dep-x" data-wb-tl-dep-remove="${escapeHtml(
        item.id
      )}" data-wb-tl-dep-on="${escapeHtml(depId)}" title="${zh ? "解除依赖" : "Remove dependency"}"${ui.busy ? " disabled" : ""}>${workbenchIcons.close}</button></span>`;
    })
    .join("");
  const already = new Set(item.depends_on);
  const options = otherItems
    .filter((other) => other.id !== item.id && !already.has(other.id))
    .map((other) => `<option value="${escapeHtml(other.id)}">${escapeHtml(other.code)} · ${escapeHtml(other.title)}</option>`)
    .join("");
  const picker = options
    ? `<select class="wh-wb-tl-dep-add" data-wb-tl-dep-add="${escapeHtml(item.id)}"${ui.busy ? " disabled" : ""} aria-label="${
        zh ? "加依赖" : "Add dependency"
      }"><option value="">${zh ? "+ 依赖" : "+ needs"}</option>${options}</select>`
    : "";
  if (!chips && !picker) {
    return "";
  }
  return `<div class="wh-wb-tl-deps">${chips}${picker}</div>`;
}

function renderMilestoneSelectHtml(
  item: TimelineWorkItemVM,
  milestones: ProjectMilestoneVM[],
  ui: TimelineUiState,
  zh: boolean
): string {
  const options = [
    `<option value="">${zh ? "未挂里程碑" : "No milestone"}</option>`,
    ...milestones.map(
      (milestone) =>
        `<option value="${escapeHtml(milestone.id)}"${milestone.id === item.milestone_id ? " selected" : ""}>${escapeHtml(
          milestone.title
        )}</option>`
    )
  ].join("");
  return `<select class="wh-wb-tl-attach" data-wb-tl-attach="${escapeHtml(item.id)}"${ui.busy ? " disabled" : ""} aria-label="${
    zh ? "挂到里程碑" : "Attach to milestone"
  }">${options}</select>`;
}

function renderRowHtml(
  item: TimelineWorkItemVM,
  window: WindowModel,
  vm: ProjectTimelinePageVM,
  codeById: Map<string, string>,
  ui: TimelineUiState,
  zh: boolean,
  okrTile: string
): string {
  const placed = placeItem(item, window);
  const blocks =
    item.blocks_count > 0
      ? `<span class="wh-wb-tl-blocks" title="${zh ? "阻塞后续工作项" : "Blocks downstream work"}">${
          zh ? `阻塞 ${item.blocks_count} 项` : `blocks ${item.blocks_count}`
        }</span>`
      : "";
  const bar = placed
    ? `<span class="wh-wb-tl-gbar wh-wb-tl-gbar--${placed.tone}${placed.placeholder ? " wh-wb-tl-gbar--ghost" : ""}" style="left:${placed.leftPct.toFixed(
        3
      )}%;width:${placed.widthPct.toFixed(3)}%"></span>`
    : `<span class="wh-wb-tl-unscheduled">${zh ? "未排期" : "Unscheduled"}</span>`;
  const assignee = item.assignee
    ? `<span class="wh-wb-tl-assignee">${escapeHtml(item.assignee.label)}</span>`
    : `<span class="wh-wb-tl-assignee wh-wb-tl-assignee--none">${zh ? "未指派" : "Unassigned"}</span>`;
  return `<div class="wh-wb-tl-row" data-wb-tl-row="${escapeHtml(item.id)}">
    <div class="wh-wb-tl-rowmeta">
      <div class="wh-wb-tl-rowtitle"><span class="wh-wb-tl-code">${escapeHtml(
        item.code
      )}</span><span class="wh-wb-tl-name">${escapeHtml(item.title)}</span>${okrTile}</div>
      <div class="wh-wb-tl-rowtags"><span class="wh-wb-tl-status wh-wb-tl-status--${escapeHtml(
        item.status
      )}">${escapeHtml(statusLabel(item.status, zh))}</span>${assignee}${blocks}</div>
      <div class="wh-wb-tl-rowctl">${renderMilestoneSelectHtml(item, vm.milestones, ui, zh)}</div>
      ${renderRowDepsHtml(item, codeById, vm.items, ui, zh)}
    </div>
    <div class="wh-wb-tl-track">${bar}${renderTodayMarkerHtml(vm, window, zh)}</div>
  </div>`;
}

// E2b OKR 挂钩：工作项挂了目标（objective_ids 非空）时，就近在行标题右侧渲一枚 OKR tile。
// G4 #36：VM 现带 objective_titles（服务端 join listObjectiveTitlesByIds），悬停（title/aria-label）显目标名；
// 缺省或取名失败时回落成裸 id（与旧行为一致，不编造名字）。
function renderOkrTile(item: TimelineWorkItemVM, zh: boolean): string {
  const ids = item.objective_ids;
  if (!ids || ids.length === 0) {
    return "";
  }
  const names = item.objective_titles && item.objective_titles.length === ids.length ? item.objective_titles : ids;
  const label = ids.length > 1 ? `OKR ×${ids.length}` : "OKR";
  const hover = zh ? `目标 ${names.join("、")}` : `Objectives ${names.join(", ")}`;
  return `<span class="wh-wb-tl-okr" title="${escapeHtml(hover)}" aria-label="${escapeHtml(hover)}">${label}</span>`;
}

function renderMilestoneFormHtml(ui: TimelineUiState, zh: boolean): string {
  const isEdit = ui.milestoneForm?.mode === "edit";
  return `<form class="wh-wb-tl-mform" data-wb-tl-mform>
    <input class="wh-wb-tl-mform-title" data-wb-tl-mform-title type="text" value="${escapeHtml(
      ui.draftTitle
    )}" placeholder="${zh ? "里程碑名称" : "Milestone name"}" maxlength="256"${ui.busy ? " disabled" : ""} />
    <input class="wh-wb-tl-mform-due" data-wb-tl-mform-due type="date" value="${escapeHtml(ui.draftDue)}"${
      ui.busy ? " disabled" : ""
    } aria-label="${zh ? "截止日期" : "Due date"}" />
    <button type="submit" class="wh-wb-tl-btn wh-wb-tl-btn--primary" data-wb-tl-mform-save${ui.busy ? " disabled" : ""}>${
      isEdit ? (zh ? "保存" : "Save") : zh ? "新建" : "Create"
    }</button>
    <button type="button" class="wh-wb-tl-btn" data-wb-tl-mform-cancel${ui.busy ? " disabled" : ""}>${
      zh ? "取消" : "Cancel"
    }</button>
  </form>`;
}

function renderMilestoneHeadHtml(
  milestone: ProjectMilestoneVM,
  ui: TimelineUiState,
  zh: boolean
): string {
  if (ui.milestoneForm?.mode === "edit" && ui.milestoneForm.milestoneId === milestone.id) {
    return renderMilestoneFormHtml(ui, zh);
  }
  const due = parseDate(milestone.due_at);
  const dueLabel = due
    ? `<span class="wh-wb-tl-mdue">${escapeHtml(formatMonthDay(due))}</span>`
    : `<span class="wh-wb-tl-mdue wh-wb-tl-mdue--none">${zh ? "未定期" : "No date"}</span>`;
  const doneTag =
    milestone.status === "done"
      ? `<span class="wh-wb-tl-mdone">${zh ? "已达成" : "Reached"}</span>`
      : "";
  return `<div class="wh-wb-tl-mhead${milestone.status === "done" ? " is-done" : ""}">
    <span class="wh-wb-tl-mflag">${workbenchIcons.pin}</span>
    <span class="wh-wb-tl-mtitle">${escapeHtml(milestone.title)}</span>
    ${dueLabel}${doneTag}
    <span class="wh-wb-tl-mspacer"></span>
    <button type="button" class="wh-wb-tl-icbtn" data-wb-tl-mtoggle="${escapeHtml(milestone.id)}" data-wb-tl-mstatus="${
      milestone.status
    }" title="${milestone.status === "done" ? (zh ? "重开里程碑" : "Reopen") : zh ? "标记达成" : "Mark reached"}"${
    ui.busy ? " disabled" : ""
  }>${workbenchIcons.check}</button>
    <button type="button" class="wh-wb-tl-icbtn" data-wb-tl-medit="${escapeHtml(milestone.id)}" title="${
    zh ? "编辑里程碑" : "Edit milestone"
  }"${ui.busy ? " disabled" : ""}>${workbenchIcons.edit}</button>
    <button type="button" class="wh-wb-tl-icbtn wh-wb-tl-icbtn--danger" data-wb-tl-mdelete="${escapeHtml(
      milestone.id
    )}" title="${zh ? "删除里程碑" : "Delete milestone"}"${ui.busy ? " disabled" : ""}>${workbenchIcons.trash}</button>
  </div>`;
}

// 关键路径警示区：critical.overdue_blocking = 逾期且卡着后续的项——「这些卡着别人」置顶。
function renderCriticalHtml(vm: ProjectTimelinePageVM, codeById: Map<string, string>, zh: boolean): string {
  if (vm.critical.overdue_blocking.length === 0) {
    return "";
  }
  const chips = vm.critical.overdue_blocking
    .map((ref) => {
      const code = codeById.get(ref.work_item_id) ?? ref.work_item_id.slice(0, 8);
      return `<button type="button" class="wh-wb-tl-crit-chip" data-wb-tl-focus-item="${escapeHtml(
        ref.work_item_id
      )}" title="${zh ? "定位到这一行" : "Jump to this row"}">${escapeHtml(code)} · ${
        zh ? `卡着 ${ref.blocks_count} 项` : `blocks ${ref.blocks_count}`
      }</button>`;
    })
    .join("");
  return `<div class="wh-wb-tl-crit">
    <div class="wh-wb-tl-crit-head">${zh ? "这些逾期项卡着别人" : "These overdue items block others"}</div>
    <div class="wh-wb-tl-crit-body">${chips}</div>
  </div>`;
}

function renderGroupHtml(
  head: string,
  items: TimelineWorkItemVM[],
  window: WindowModel,
  vm: ProjectTimelinePageVM,
  codeById: Map<string, string>,
  ui: TimelineUiState,
  zh: boolean
): string {
  const rows = items
    .map((item) => renderRowHtml(item, window, vm, codeById, ui, zh, renderOkrTile(item, zh)))
    .join("");
  const body = rows || `<div class="wh-wb-tl-group-empty">${zh ? "这个里程碑下还没有工作项" : "No work items under this milestone"}</div>`;
  return `<section class="wh-wb-tl-group">${head}<div class="wh-wb-tl-group-body">${body}</div></section>`;
}

// 排期比较：有 start 的按 start，否则按 due，都无的沉到底。
function scheduleKey(item: TimelineWorkItemVM): number {
  const start = parseDate(item.start_at);
  const due = parseDate(item.due_at);
  return start?.getTime() ?? due?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

export function renderTimelineLoadingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-tl-state"><span class="wh-wb-spinner"></span>${zh ? "正在加载时间线…" : "Loading timeline…"}</div>`;
}

export function renderTimelineErrorHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-tl-state wh-wb-tl-state--error">${
    zh ? "没能加载时间线，稍后重试" : "Couldn't load the timeline — retry"
  }<div style="margin-top:12px"><button type="button" class="wh-wb-tl-btn" data-wb-tl-retry>${
    zh ? "重试" : "Retry"
  }</button></div></div>`;
}

export function renderTimelineHtml(input: {
  vm: ProjectTimelinePageVM;
  locale: Locale;
  ui: TimelineUiState;
}): string {
  const { vm, ui } = input;
  const zh = input.locale === "zh-CN";
  const codeById = new Map(vm.items.map((item) => [item.id, item.code]));
  const errorBanner = ui.error ? `<div class="wh-wb-tl-errbar">${escapeHtml(ui.error)}</div>` : "";
  const createFormOpen = ui.milestoneForm?.mode === "create";
  const barActions = createFormOpen
    ? renderMilestoneFormHtml(ui, zh)
    : `<button type="button" class="wh-wb-tl-btn wh-wb-tl-btn--primary" data-wb-tl-new-milestone${
        ui.busy ? " disabled" : ""
      }>${workbenchIcons.plus}<span>${zh ? "新建里程碑" : "New milestone"}</span></button>`;
  const header = `<div class="wh-wb-tl-bar">
    <div class="wh-wb-tl-bar-title">${zh ? "时间线" : "Timeline"}</div>
    <span class="wh-wb-tl-bar-spacer"></span>
    ${barActions}
  </div>`;

  const window = computeWindow(vm);

  // 空态：无里程碑、且没有任何可排期/工作项时——给引导（真可用的「新建里程碑」入口 + 指向「日程」
  // 标签「用 Cuu 起草计划」真入口的一句话；E3 已落地，这里不再是预留说明）。
  if (vm.milestones.length === 0 && (vm.empty_state === "no_work_items" || vm.items.length === 0)) {
    return `<div class="wh-wb-tl">${header}${errorBanner}<div class="wh-wb-tl-empty">
      <span class="wh-wb-tl-empty-icon">${workbenchIcons.timeline}</span>
      <h3 class="wh-wb-tl-empty-title">${zh ? "还没有时间线" : "No timeline yet"}</h3>
      <p class="wh-wb-tl-empty-sub">${
        zh
          ? "先建几个里程碑，再把工作项挂上去、连出依赖，就能看到排期条和关键路径。"
          : "Create a few milestones, then attach work items and link dependencies to see the schedule and critical path."
      }</p>
      <p class="wh-wb-tl-empty-note">${
        zh
          ? "想让 Cuu 起草整份计划？切到左侧「日程」标签，点「用 Cuu 起草计划」。"
          : "Want Cuu to draft the whole plan? Switch to the \u201cSchedule\u201d tab and use \u201cDraft a plan with Cuu\u201d."
      }</p>
    </div></div>`;
  }

  // 有里程碑/工作项但全无日期 → 没有时间窗可画：仍渲分组 + 行（控件可用），只是没有排期条，给一条提示。
  const groupsHtml = renderGroups(vm, window, codeById, ui, zh);
  const axisHtml = window ? renderAxisHtml(window) : "";
  const noDatesHint = !window
    ? `<div class="wh-wb-tl-nodates">${
        zh
          ? "还没有工作项带开始/截止日期——填上日期后这里会画出排期条。"
          : "No work items have start/due dates yet — add dates to draw the schedule bars."
      }</div>`
    : "";

  return `<div class="wh-wb-tl">${header}${errorBanner}${renderCriticalHtml(vm, codeById, zh)}${noDatesHint}
    <div class="wh-wb-tl-scroll">${axisHtml}${groupsHtml}</div>
  </div>`;
}

function renderGroups(
  vm: ProjectTimelinePageVM,
  window: WindowModel | undefined,
  codeById: Map<string, string>,
  ui: TimelineUiState,
  zh: boolean
): string {
  const milestones = [...vm.milestones].sort((a, b) => a.sort - b.sort);
  const win: WindowModel = window ?? { start: 0, end: 1, weeks: [] };
  const byMilestone = new Map<string, TimelineWorkItemVM[]>();
  const unassigned: TimelineWorkItemVM[] = [];
  const knownMilestoneIds = new Set(milestones.map((m) => m.id));
  for (const item of vm.items) {
    if (item.milestone_id && knownMilestoneIds.has(item.milestone_id)) {
      const bucket = byMilestone.get(item.milestone_id) ?? [];
      bucket.push(item);
      byMilestone.set(item.milestone_id, bucket);
    } else {
      unassigned.push(item);
    }
  }
  const sortRows = (rows: TimelineWorkItemVM[]) => rows.sort((a, b) => scheduleKey(a) - scheduleKey(b));
  const milestoneGroups = milestones
    .map((milestone) =>
      renderGroupHtml(
        renderMilestoneHeadHtml(milestone, ui, zh),
        sortRows(byMilestone.get(milestone.id) ?? []),
        win,
        vm,
        codeById,
        ui,
        zh
      )
    )
    .join("");
  const unassignedGroup =
    unassigned.length > 0
      ? renderGroupHtml(
          `<div class="wh-wb-tl-mhead wh-wb-tl-mhead--loose"><span class="wh-wb-tl-mtitle">${
            zh ? "未挂里程碑" : "No milestone"
          }</span></div>`,
          sortRows(unassigned),
          win,
          vm,
          codeById,
          ui,
          zh
        )
      : "";
  return milestoneGroups + unassignedGroup;
}
