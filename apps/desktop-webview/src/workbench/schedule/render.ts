// WorkHub 桌面 · 工作台「日程」标签的纯渲染层（照 timeline/render.ts 的分工：无 DOM/网络副作用，只把
// VM + 计划草案 + 本地 UI 态渲成 HTML 字符串，便于单测）。纯只读：左窄栏＝项目计划摘要（已批准草案的
// rationale + 里程碑，取不到则回落时间线里程碑列表）；右＝本周 7 列周历（周一起），工作项按 due_at 落卡、
// 里程碑 due_at 标在列头、今天高亮。周历口径全用 UTC（同 timeline，避开本地时区在测试里漂移）。
// 不做创建任务（工作项创建走 intake 现状，不造旁路）——控件只有上一周 / 下一周 / 今天。

import { escapeHtml } from "@workhub/web-runtime";
import type { ProjectTimelinePageVM, TimelineWorkItemVM } from "@workhub/contracts";

import { workbenchIcons } from "../icons.js";
import type { SchedulePlanDraft } from "./api.js";

type Locale = "zh-CN" | "en-US";

const DAY_MS = 86_400_000;

// 周历本地 UI 态——由 view.ts 持有，render 只读。weekOffset＝相对「今天所在周」的偏移（0＝本周，
// -1＝上一周，+1＝下一周）。
export type ScheduleUiState = {
  weekOffset: number;
};

export function emptyScheduleUiState(): ScheduleUiState {
  return { weekOffset: 0 };
}

function parseDate(value: string | undefined | null): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// 周起点（周一，UTC）。
function startOfWeekUtc(date: Date): Date {
  const x = utcMidnight(date);
  const weekday = (x.getUTCDay() + 6) % 7; // 0 = Monday
  x.setUTCDate(x.getUTCDate() - weekday);
  return x;
}

function dayKey(date: Date): string {
  return utcMidnight(date).toISOString().slice(0, 10);
}

export type ScheduleWeek = {
  days: Date[];
  rangeStart: Date;
  rangeEnd: Date;
  todayKey: string;
};

// 从参考「今天」（服务端 generated_at）+ weekOffset 算出这一周的 7 个 UTC 日、区间端点与今天键。
export function computeScheduleWeek(referenceIso: string, weekOffset: number): ScheduleWeek {
  const now = parseDate(referenceIso) ?? new Date();
  const base = startOfWeekUtc(now);
  const start = new Date(base.getTime() + weekOffset * 7 * DAY_MS);
  const days: Date[] = [];
  for (let i = 0; i < 7; i += 1) {
    days.push(new Date(start.getTime() + i * DAY_MS));
  }
  return {
    days,
    rangeStart: days[0]!,
    rangeEnd: days[6]!,
    todayKey: dayKey(now)
  };
}

function statusBorder(item: TimelineWorkItemVM): string {
  if (item.overdue) {
    return "var(--ds-danger)";
  }
  if (item.status === "in_review") {
    return "var(--ds-warn)";
  }
  if (item.status === "done" || item.status === "merged") {
    return "var(--ds-success)";
  }
  if (item.status === "cancelled") {
    return "var(--ds-ink-faint)";
  }
  return "var(--ds-accent)";
}

function statusLabelShort(status: TimelineWorkItemVM["status"], zh: boolean): string {
  const map: Record<TimelineWorkItemVM["status"], { zh: string; en: string }> = {
    intake: { zh: "待澄清", en: "Intake" },
    ai_clarifying: { zh: "澄清中", en: "Clarifying" },
    spec_ready: { zh: "待开工", en: "Ready" },
    ai_working: { zh: "进行中", en: "Working" },
    escalated: { zh: "已升级", en: "Escalated" },
    pm_mode: { zh: "人工接管", en: "PM" },
    in_review: { zh: "评审中", en: "In review" },
    merged: { zh: "已合并", en: "Merged" },
    done: { zh: "已完成", en: "Done" },
    cancelled: { zh: "已取消", en: "Cancelled" }
  };
  const entry = map[status];
  return entry ? (zh ? entry.zh : entry.en) : status;
}

const ZH_DOW = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const EN_DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatRange(week: ScheduleWeek, zh: boolean): string {
  const s = week.rangeStart;
  const e = week.rangeEnd;
  if (zh) {
    const sameMonth = s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth();
    return sameMonth
      ? `${s.getUTCFullYear()} 年 ${s.getUTCMonth() + 1} 月 ${s.getUTCDate()} 日 – ${e.getUTCDate()} 日`
      : `${s.getUTCFullYear()} 年 ${s.getUTCMonth() + 1} 月 ${s.getUTCDate()} 日 – ${e.getUTCMonth() + 1} 月 ${e.getUTCDate()} 日`;
  }
  const sameMonth = s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth();
  return sameMonth
    ? `${EN_MONTHS[s.getUTCMonth()]} ${s.getUTCDate()} – ${e.getUTCDate()}, ${s.getUTCFullYear()}`
    : `${EN_MONTHS[s.getUTCMonth()]} ${s.getUTCDate()} – ${EN_MONTHS[e.getUTCMonth()]} ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
}

function renderTaskCardHtml(item: TimelineWorkItemVM, zh: boolean): string {
  const assignee = item.assignee
    ? escapeHtml(item.assignee.label)
    : zh
      ? "未指派"
      : "Unassigned";
  const overdue = item.overdue ? `<span class="wh-wb-sc-overdot" title="${zh ? "逾期" : "Overdue"}"></span>` : "";
  return `<div class="wh-wb-sc-task" style="border-left-color:${statusBorder(item)}" data-wb-sc-card data-wb-sc-id="${escapeHtml(
    item.id
  )}" role="button" tabindex="0" title="${zh ? "点击查看这件在时间线上的位置" : "Open this item on the timeline"}">
    <div class="wh-wb-sc-task-title">${overdue}${escapeHtml(item.title)}</div>
    <div class="wh-wb-sc-task-meta">${escapeHtml(item.code)} · ${escapeHtml(statusLabelShort(item.status, zh))} · ${assignee}</div>
  </div>`;
}

function renderPlanDocHtml(
  vm: ProjectTimelinePageVM,
  planDraft: SchedulePlanDraft | undefined,
  zh: boolean
): string {
  const head = `<div class="wh-wb-sc-plan-head"><span class="wh-wb-sc-plan-t">${
    zh ? "项目计划" : "Project plan"
  }</span>${
    planDraft
      ? `<span class="wh-wb-sc-plan-tag">${zh ? "已批准" : "Approved"}</span>`
      : ""
  }</div>`;

  if (planDraft) {
    const milestones = [...planDraft.milestones].sort((a, b) => a.sort - b.sort);
    const milestoneList = milestones.length
      ? `<h2 class="wh-wb-sc-plan-h2">${zh ? "里程碑" : "Milestones"}</h2><ul class="wh-wb-sc-plan-ms">${milestones
          .map((m) => {
            const due = parseDate(m.due_at);
            const dueLabel = due
              ? `<span class="wh-wb-sc-plan-due">${due.getUTCMonth() + 1}/${due.getUTCDate()}</span>`
              : `<span class="wh-wb-sc-plan-due wh-wb-sc-plan-due--none">${zh ? "未定期" : "TBD"}</span>`;
            return `<li>${workbenchIcons.pin}<span class="wh-wb-sc-plan-ms-t">${escapeHtml(m.title)}</span>${dueLabel}</li>`;
          })
          .join("")}</ul>`
      : "";
    const rationale = planDraft.rationale_md
      ? `<h2 class="wh-wb-sc-plan-h2">${zh ? "计划说明" : "Rationale"}</h2>${planDraft.rationale_md
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line) => `<p class="wh-wb-sc-plan-p">${escapeHtml(line)}</p>`)
          .join("")}`
      : "";
    const body = milestoneList + rationale || `<p class="wh-wb-sc-plan-p">${zh ? "这份计划暂无内容。" : "This plan has no content yet."}</p>`;
    return `<div class="wh-wb-sc-plan">${head}<div class="wh-wb-sc-plan-body">${body}</div></div>`;
  }

  // 回落：没有已批准的计划草案（E3）——直接列时间线里程碑，并诚实说明这是回落。
  const milestones = [...vm.milestones].sort((a, b) => a.sort - b.sort);
  if (milestones.length === 0) {
    return `<div class="wh-wb-sc-plan">${head}<div class="wh-wb-sc-plan-body"><p class="wh-wb-sc-plan-empty">${
      zh
        ? "还没有已批准的项目计划，也还没有里程碑。让 Cuu 起草计划（时间线里的入口）后，这里会显示计划摘要。"
        : "No approved plan and no milestones yet. Once a plan is drafted (from the timeline), its summary shows here."
    }</p></div></div>`;
  }
  const list = milestones
    .map((m) => {
      const due = parseDate(m.due_at);
      const dueLabel = due
        ? `<span class="wh-wb-sc-plan-due">${due.getUTCMonth() + 1}/${due.getUTCDate()}</span>`
        : `<span class="wh-wb-sc-plan-due wh-wb-sc-plan-due--none">${zh ? "未定期" : "TBD"}</span>`;
      const doneTag = m.status === "done" ? `<span class="wh-wb-sc-plan-done">${zh ? "已达成" : "Reached"}</span>` : "";
      return `<li>${workbenchIcons.pin}<span class="wh-wb-sc-plan-ms-t">${escapeHtml(m.title)}</span>${dueLabel}${doneTag}</li>`;
    })
    .join("");
  return `<div class="wh-wb-sc-plan">${head}<div class="wh-wb-sc-plan-body">
    <p class="wh-wb-sc-plan-note">${zh ? "还没有已批准的项目计划，先列出里程碑：" : "No approved plan yet — showing milestones:"}</p>
    <ul class="wh-wb-sc-plan-ms">${list}</ul>
  </div></div>`;
}

export function renderScheduleLoadingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-sc-state"><span class="wh-wb-spinner"></span>${zh ? "正在加载日程…" : "Loading schedule…"}</div>`;
}

export function renderScheduleErrorHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-sc-state wh-wb-sc-state--error">${
    zh ? "没能加载日程，稍后重试" : "Couldn't load the schedule — retry"
  }<div style="margin-top:12px"><button type="button" class="wh-wb-tl-btn" data-wb-sc-retry>${
    zh ? "重试" : "Retry"
  }</button></div></div>`;
}

export function renderScheduleHtml(input: {
  vm: ProjectTimelinePageVM;
  planDraft: SchedulePlanDraft | undefined;
  locale: Locale;
  ui: ScheduleUiState;
}): string {
  const { vm, planDraft, ui } = input;
  const zh = input.locale === "zh-CN";
  const week = computeScheduleWeek(vm.generated_at, ui.weekOffset);

  // 工作项按 due_at 的 UTC 日归组。
  const itemsByDay = new Map<string, TimelineWorkItemVM[]>();
  for (const item of vm.items) {
    const due = parseDate(item.due_at);
    if (!due) {
      continue;
    }
    const key = dayKey(due);
    const bucket = itemsByDay.get(key) ?? [];
    bucket.push(item);
    itemsByDay.set(key, bucket);
  }
  // 里程碑按 due_at 的 UTC 日归组（标在列头）。
  const milestonesByDay = new Map<string, string[]>();
  for (const milestone of vm.milestones) {
    const due = parseDate(milestone.due_at);
    if (!due) {
      continue;
    }
    const key = dayKey(due);
    const bucket = milestonesByDay.get(key) ?? [];
    bucket.push(milestone.title);
    milestonesByDay.set(key, bucket);
  }

  const columns = week.days
    .map((day, index) => {
      const key = dayKey(day);
      const isToday = key === week.todayKey;
      const isWeekend = index >= 5;
      const dayItems = (itemsByDay.get(key) ?? []).sort((a, b) => a.code.localeCompare(b.code));
      const milestoneFlags = (milestonesByDay.get(key) ?? [])
        .map(
          (title) =>
            `<span class="wh-wb-sc-ms-flag" title="${escapeHtml(
              zh ? `里程碑：${title}` : `Milestone: ${title}`
            )}">${workbenchIcons.pin}<span>${escapeHtml(title)}</span></span>`
        )
        .join("");
      const cells = dayItems.map((item) => renderTaskCardHtml(item, zh)).join("");
      return `<div class="wh-wb-sc-col${isWeekend ? " wh-wb-sc-col--weekend" : ""}">
        <div class="wh-wb-sc-dh${isToday ? " wh-wb-sc-dh--today" : ""}">
          <div class="wh-wb-sc-dow">${zh ? ZH_DOW[index] : EN_DOW[index]}</div>
          <div class="wh-wb-sc-dnum">${day.getUTCDate()}</div>
          ${milestoneFlags ? `<div class="wh-wb-sc-ms-flags">${milestoneFlags}</div>` : ""}
        </div>
        <div class="wh-wb-sc-cells">${cells}</div>
      </div>`;
    })
    .join("");

  const cal = `<div class="wh-wb-sc-cal">
    <div class="wh-wb-sc-cal-head">
      <span class="wh-wb-sc-range">${escapeHtml(formatRange(week, zh))}</span>
      <div class="wh-wb-sc-nav">
        <button type="button" class="wh-wb-sc-navbtn" data-wb-sc-prev title="${zh ? "上一周" : "Previous week"}" aria-label="${
          zh ? "上一周" : "Previous week"
        }">${workbenchIcons.chevronLeft}</button>
        <button type="button" class="wh-wb-tl-btn" data-wb-sc-today>${zh ? "今天" : "Today"}</button>
        <button type="button" class="wh-wb-sc-navbtn" data-wb-sc-next title="${zh ? "下一周" : "Next week"}" aria-label="${
          zh ? "下一周" : "Next week"
        }">${workbenchIcons.chevronRight}</button>
      </div>
    </div>
    <div class="wh-wb-sc-grid">${columns}</div>
  </div>`;

  return `<div class="wh-wb-sc">${renderPlanDocHtml(vm, planDraft, zh)}${cal}</div>`;
}
