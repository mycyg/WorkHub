// WorkHub 桌面 · 工作台「任务看板」标签的纯渲染层（照 timeline/render.ts 的分工：无 DOM/网络副作用，
// 只把 VM + 本地 UI 态渲成 HTML 字符串，便于单测）。
//
// 四列 = 按真实 work_item 状态枚举归组（packages/contracts enums.ts）：
//   待认领  ← intake / ai_clarifying / spec_ready   （还没开工：待澄清 / 澄清中 / 待开工）
//   进行中  ← ai_working / pm_mode / escalated       （AI 在跑 / 人工接管 / 已升级待决）
//   评审中  ← in_review                               （成果已提交、等提议评审）
//   已完成  ← merged / done / cancelled               （已合并 / 已完成 / 已取消——终态）
// 列是粗桶，卡片自身仍渲精确状态芯片（statusLabel），列名粗 + 芯片细 = 诚实（拖到哪列不改写真实状态名）。
//
// 拖拽的状态机映射见 resolveKanbanDrop（纯函数，view.ts 消费）：唯一有真实端点的列间转移是
// 待开工(spec_ready) → 进行中 = 派发 AI；其余移动一律弹回并给人话说明（不假接线）。

import { escapeHtml } from "@workhub/web-runtime";
import type { ProjectTimelinePageVM, TimelineWorkItemVM, WorkItemStatus } from "@workhub/contracts";

import { workbenchIcons } from "../icons.js";

type Locale = "zh-CN" | "en-US";

export type KanbanColumn = "todo" | "doing" | "review" | "done";

// 看板本地 UI 态——由 view.ts 持有，render 只读。busy = 正在派发；notice = 上一次拖拽的人话提示
// （合法转移的错误，或不合法转移的「该去哪儿办」说明），非空时在看板顶部渲一条可读横幅。
// R17-G5 #27：assigneeUserId/keyword = 纯前端过滤态（不重新取数）——assigneeUserId 空＝全部，
// UNASSIGNED_FILTER＝只看未指派；keyword 匹配标题/编号（大小写不敏感）。列计数随过滤更新。
export type KanbanUiState = {
  busy: boolean;
  notice?: string | undefined;
  noticeTone?: "info" | "error" | undefined;
  assigneeUserId?: string | undefined;
  keyword?: string | undefined;
};

export function emptyKanbanUiState(): KanbanUiState {
  return { busy: false };
}

// #27：负责人下拉里「只看未指派」的哨兵值（真实 user_id 不会是这个串）。
export const KANBAN_UNASSIGNED_FILTER = "__unassigned__";

// #27：卡片集合去重出负责人下拉选项（按 label 排序，稳定）。
export function kanbanAssigneeOptions(items: readonly TimelineWorkItemVM[]): { userId: string; label: string }[] {
  const map = new Map<string, string>();
  for (const item of items) {
    if (item.assignee) {
      map.set(item.assignee.user_id, item.assignee.label);
    }
  }
  return [...map.entries()]
    .map(([userId, label]) => ({ userId, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// #27：纯前端过滤——负责人（含「未指派」）+ 关键词（标题/编号）。纯函数，便于单测。
export function filterKanbanItems(
  items: readonly TimelineWorkItemVM[],
  filter: { assigneeUserId?: string | undefined; keyword?: string | undefined }
): TimelineWorkItemVM[] {
  const keyword = (filter.keyword ?? "").trim().toLowerCase();
  return items.filter((item) => {
    if (filter.assigneeUserId) {
      if (filter.assigneeUserId === KANBAN_UNASSIGNED_FILTER) {
        if (item.assignee) {
          return false;
        }
      } else if (item.assignee?.user_id !== filter.assigneeUserId) {
        return false;
      }
    }
    if (keyword && !`${item.title} ${item.code}`.toLowerCase().includes(keyword)) {
      return false;
    }
    return true;
  });
}

export function isKanbanFilterActive(ui: KanbanUiState): boolean {
  return Boolean(ui.assigneeUserId) || Boolean(ui.keyword && ui.keyword.trim());
}

const COLUMN_OF_STATUS: Record<WorkItemStatus, KanbanColumn> = {
  intake: "todo",
  ai_clarifying: "todo",
  spec_ready: "todo",
  ai_working: "doing",
  pm_mode: "doing",
  escalated: "doing",
  in_review: "review",
  merged: "done",
  done: "done",
  cancelled: "done"
};

export function columnOfStatus(status: WorkItemStatus): KanbanColumn {
  return COLUMN_OF_STATUS[status] ?? "todo";
}

type ColumnSpec = { key: KanbanColumn; zh: string; en: string; dot: string };

const COLUMNS: ColumnSpec[] = [
  { key: "todo", zh: "待认领", en: "To do", dot: "var(--ds-ink-faint)" },
  { key: "doing", zh: "进行中", en: "In progress", dot: "var(--ds-accent)" },
  { key: "review", zh: "评审中", en: "In review", dot: "var(--ds-warn)" },
  { key: "done", zh: "已完成", en: "Done", dot: "var(--ds-success)" }
];

// 精确状态芯片文案（与时间线一致）。
function statusLabel(status: WorkItemStatus, zh: boolean): string {
  const map: Record<WorkItemStatus, { zh: string; en: string }> = {
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

function parseDate(value: string | undefined | null): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatMonthDay(date: Date): string {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

// 卡片显示排序（不是用户可拖的排序——状态机无排序语义）：有截止日的按截止日升序在前，无日期沉底，
// 同键按 code 稳定。逾期项自然靠前（截止日更早）。
function displayKey(item: TimelineWorkItemVM): number {
  return parseDate(item.due_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function assigneeInitial(label: string): string {
  const trimmed = label.trim();
  return trimmed ? (Array.from(trimmed)[0] ?? "?") : "?";
}

// —— 看板拖拽的状态机映射（纯函数，view.ts 消费）——
// 唯一有真实、工作项级、人可直接触发端点的列间转移：待开工(spec_ready) → 进行中 = POST agent-runs 派发 AI。
// 其余移动一律弹回，并按真实规则给人话说明——评审是 AI 跑完自动进入、完成要在提议面板合并、退回要在
// 提议里「要求修改」、澄清阶段要在对话里推进。同列内拖动是无操作（无排序语义）。
export type KanbanDropResolution =
  | { kind: "dispatch" }
  | { kind: "bounce"; message: string }
  | { kind: "noop" };

export function resolveKanbanDrop(input: {
  status: WorkItemStatus;
  fromColumn: KanbanColumn;
  toColumn: KanbanColumn;
  locale: Locale;
}): KanbanDropResolution {
  const { status, fromColumn, toColumn } = input;
  const zh = input.locale === "zh-CN";
  if (fromColumn === toColumn) {
    return { kind: "noop" };
  }
  const bounce = (message: string): KanbanDropResolution => ({ kind: "bounce", message });

  if (toColumn === "doing") {
    // 待认领 → 进行中：只有「待开工」(spec_ready) 有真实派发端点；还在澄清阶段的项不行。
    if (fromColumn === "todo") {
      if (status === "spec_ready") {
        return { kind: "dispatch" };
      }
      return bounce(
        zh
          ? "这件还在澄清阶段（需求还没聊清楚）。先在项目主区对话里把它澄清成「待开工」，才能派给 AI 开工。"
          : "This item is still being clarified. Finish clarifying it in the project chat until it's Ready, then start the AI on it."
      );
    }
    // 评审中 → 进行中 = 退回重做，走提议「要求修改」，不是拖拽。
    if (fromColumn === "review") {
      return bounce(
        zh
          ? "评审中的项要退回重做，请在右栏「提议」面板点「要求修改」并写明原因，不能直接拖回进行中。"
          : "To send a reviewing item back for rework, use “Request changes” on its proposal — dragging won't do it."
      );
    }
    // 已完成 → 进行中。
    return bounce(zh ? "已完成的项不能拖回进行中。" : "Completed items can't be dragged back to In progress.");
  }

  if (toColumn === "review") {
    return bounce(
      zh
        ? "评审是 AI 跑完自动进入的——AI 完成后会把成果提交评审并开出提议，不用手动拖到这里。"
        : "Review is entered automatically when the AI finishes and opens a proposal — you can't drag an item into review."
    );
  }

  if (toColumn === "done") {
    if (fromColumn === "review") {
      return bounce(
        zh
          ? "评审中的项要在右栏「提议」面板批准合并，通过后才算完成——不能直接拖到已完成。"
          : "Items in review are completed by approving their proposal in the side panel — you can't drag them straight to Done."
      );
    }
    return bounce(
      zh
        ? "工作项要先开工、提交评审、评审通过合并后才算完成，不能直接标记完成。"
        : "Work items reach Done only after being worked, reviewed, and merged — not by dragging."
    );
  }

  // toColumn === "todo"（往回拖到待认领）。
  return bounce(
    zh
      ? "已经开工/评审/完成的项不能拖回待认领。要退回重做，请在右栏「提议」面板点「要求修改」。"
      : "Items already in progress/review/done can't be dragged back. To send work back, use “Request changes” on its proposal."
  );
}

function renderCardHtml(item: TimelineWorkItemVM, column: KanbanColumn, zh: boolean, busy: boolean): string {
  const due = parseDate(item.due_at);
  const dueHtml = due
    ? item.overdue
      ? `<span class="wh-wb-kb-due wh-wb-kb-due--over"><span class="wh-wb-kb-overdot"></span>${escapeHtml(
          formatMonthDay(due)
        )} ${zh ? "逾期" : "overdue"}</span>`
      : `<span class="wh-wb-kb-due">${escapeHtml(formatMonthDay(due))}</span>`
    : `<span class="wh-wb-kb-due wh-wb-kb-due--none">${zh ? "未定期" : "No date"}</span>`;
  const assignee = item.assignee
    ? `<span class="wh-wb-kb-owner" title="${escapeHtml(item.assignee.label)}"><span class="wh-wb-kb-av">${escapeHtml(
        assigneeInitial(item.assignee.label)
      )}</span></span>`
    : `<span class="wh-wb-kb-owner wh-wb-kb-owner--none">${zh ? "未指派" : "Unassigned"}</span>`;
  const blocks =
    item.blocks_count > 0
      ? `<span class="wh-wb-kb-blocks" title="${zh ? "阻塞后续工作项" : "Blocks downstream work"}">${
          zh ? `阻塞 ${item.blocks_count} 项` : `blocks ${item.blocks_count}`
        }</span>`
      : "";
  // 卡片可拖：id/status/from-column 落在 dataset 上，view.ts 的委托监听据此解析拖拽的状态机动作。
  // busy 期间去掉 draggable，避免派发在途时又拖出一次动作。
  return `<div class="wh-wb-kb-card${item.overdue ? " wh-wb-kb-card--over" : ""}" data-wb-kb-card data-wb-kb-id="${escapeHtml(
    item.id
  )}" data-wb-kb-status="${escapeHtml(item.status)}" data-wb-kb-from="${column}"${busy ? "" : ' draggable="true"'} role="button" tabindex="0" title="${
    zh ? "点击查看这件在时间线上的位置" : "Open this item on the timeline"
  }">
    <div class="wh-wb-kb-card-top">
      <span class="wh-wb-kb-card-title">${escapeHtml(item.title)}</span>
    </div>
    <div class="wh-wb-kb-card-meta">
      <span class="wh-wb-kb-code">${escapeHtml(item.code)}</span>
      <span class="wh-wb-kb-status wh-wb-kb-status--${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status, zh))}</span>
    </div>
    <div class="wh-wb-kb-card-foot">
      ${dueHtml}${blocks}${assignee}
    </div>
  </div>`;
}

function renderColumnHtml(spec: ColumnSpec, items: TimelineWorkItemVM[], zh: boolean, busy: boolean): string {
  const sorted = [...items].sort((a, b) => displayKey(a) - displayKey(b) || a.code.localeCompare(b.code));
  const cards = sorted.map((item) => renderCardHtml(item, spec.key, zh, busy)).join("");
  const body =
    cards ||
    `<div class="wh-wb-kb-col-empty">${zh ? "这一列还没有工作项" : "No items in this column"}</div>`;
  return `<section class="wh-wb-kb-col">
    <div class="wh-wb-kb-col-head">
      <span class="wh-wb-kb-dot" style="background:${spec.dot}"></span>
      <span class="wh-wb-kb-col-name">${zh ? spec.zh : spec.en}</span>
      <span class="wh-wb-kb-col-count">${items.length}</span>
    </div>
    <div class="wh-wb-kb-col-list" data-wb-kb-col="${spec.key}">${body}</div>
  </section>`;
}

export function renderKanbanLoadingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-kb-state"><span class="wh-wb-spinner"></span>${zh ? "正在加载任务看板…" : "Loading board…"}</div>`;
}

export function renderKanbanErrorHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-kb-state wh-wb-kb-state--error">${
    zh ? "没能加载任务看板，稍后重试" : "Couldn't load the board — retry"
  }<div style="margin-top:12px"><button type="button" class="wh-wb-tl-btn" data-wb-kb-retry>${
    zh ? "重试" : "Retry"
  }</button></div></div>`;
}

// #27：负责人下拉 + 关键词输入 + 清除按钮（纯前端过滤条）。整个项目没工作项时不渲（无可筛内容）。
function renderFilterBarHtml(vm: ProjectTimelinePageVM, ui: KanbanUiState, zh: boolean): string {
  const options = kanbanAssigneeOptions(vm.items);
  const hasUnassigned = vm.items.some((item) => !item.assignee);
  const optionHtml = [
    `<option value=""${!ui.assigneeUserId ? " selected" : ""}>${zh ? "全部负责人" : "All assignees"}</option>`,
    hasUnassigned
      ? `<option value="${KANBAN_UNASSIGNED_FILTER}"${ui.assigneeUserId === KANBAN_UNASSIGNED_FILTER ? " selected" : ""}>${zh ? "未指派" : "Unassigned"}</option>`
      : "",
    ...options.map(
      (opt) =>
        `<option value="${escapeHtml(opt.userId)}"${ui.assigneeUserId === opt.userId ? " selected" : ""}>${escapeHtml(opt.label)}</option>`
    )
  ].join("");
  const clear = isKanbanFilterActive(ui)
    ? `<button type="button" class="wh-wb-kb-filter-clear" data-wb-kb-filter-clear>${zh ? "清除筛选" : "Clear"}</button>`
    : "";
  return `<div class="wh-wb-kb-filters" data-wb-kb-filters>
    <select class="wh-wb-kb-select" data-wb-kb-filter-assignee aria-label="${zh ? "按负责人筛选" : "Filter by assignee"}">${optionHtml}</select>
    <input type="search" class="wh-wb-kb-search" data-wb-kb-filter-keyword value="${escapeHtml(ui.keyword ?? "")}" placeholder="${
      zh ? "搜索标题 / 编号" : "Search title / code"
    }" aria-label="${zh ? "按关键词筛选" : "Filter by keyword"}" />
    ${clear}
  </div>`;
}

export function renderKanbanHtml(input: {
  vm: ProjectTimelinePageVM;
  locale: Locale;
  ui: KanbanUiState;
}): string {
  const { vm, ui } = input;
  const zh = input.locale === "zh-CN";

  const filterActive = isKanbanFilterActive(ui);
  const filtered = filterActive ? filterKanbanItems(vm.items, ui) : [...vm.items];

  const byColumn = new Map<KanbanColumn, TimelineWorkItemVM[]>();
  for (const spec of COLUMNS) {
    byColumn.set(spec.key, []);
  }
  for (const item of filtered) {
    byColumn.get(columnOfStatus(item.status))?.push(item);
  }

  const notice = ui.notice
    ? `<div class="wh-wb-kb-notice wh-wb-kb-notice--${ui.noticeTone ?? "info"}">${escapeHtml(ui.notice)}</div>`
    : "";

  // 计数：无过滤照旧「N 个任务」；过滤时显「命中 / 总数」，诚实标已筛选。
  const total = vm.items.length;
  const totalHtml = filterActive
    ? zh
      ? `${filtered.length} / ${total} 个任务（已筛选）`
      : `${filtered.length} / ${total} tasks (filtered)`
    : zh
      ? `${total} 个任务`
      : `${total} tasks`;
  const header = `<div class="wh-wb-kb-top">
    <span class="wh-wb-kb-total">${totalHtml}</span>
    <span class="wh-wb-kb-hint">${
      zh
        ? "拖「待开工」卡到「进行中」即派 AI 开工；其它移动会说明该去哪儿办"
        : "Drag a Ready card into In progress to start the AI; other moves explain where to go"
    }</span>
  </div>`;

  // 空态：整个项目没有任何工作项——给诚实引导（工作项从对话/待办里生成，看板不造旁路创建入口）。
  if (vm.items.length === 0) {
    return `<div class="wh-wb-kb">${header}${notice}<div class="wh-wb-kb-empty">
      <span class="wh-wb-kb-empty-icon">${workbenchIcons.kanban}</span>
      <h3 class="wh-wb-kb-empty-title">${zh ? "还没有任务" : "No tasks yet"}</h3>
      <p class="wh-wb-kb-empty-sub">${
        zh
          ? "在项目主区对话里把要做的事讲清楚，澄清完成后就会作为工作项出现在这里的「待认领」列。"
          : "Describe the work in the project chat — once it's clarified it shows up here as a work item in To do."
      }</p>
    </div></div>`;
  }

  const filterBar = renderFilterBarHtml(vm, ui, zh);

  // 过滤后一条不剩（但项目本身有任务）——给「无匹配 / 清除筛选」提示，而不是四个空列让人以为没数据。
  if (filterActive && filtered.length === 0) {
    return `<div class="wh-wb-kb">${header}${filterBar}${notice}<div class="wh-wb-kb-empty">
      <h3 class="wh-wb-kb-empty-title">${zh ? "没有匹配的任务" : "No matching tasks"}</h3>
      <p class="wh-wb-kb-empty-sub">${zh ? "换个负责人或关键词，或清除筛选。" : "Try another assignee or keyword, or clear the filter."}</p>
    </div></div>`;
  }

  const columns = COLUMNS.map((spec) => renderColumnHtml(spec, byColumn.get(spec.key) ?? [], zh, ui.busy)).join("");
  return `<div class="wh-wb-kb">${header}${filterBar}${notice}<div class="wh-wb-kb-board">${columns}</div></div>`;
}
