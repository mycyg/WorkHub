// WorkHub 桌面 · 工作台「日程」标签的纯渲染层（照 timeline/render.ts 的分工：无 DOM/网络副作用，只把
// VM + 计划草案 + 本地 UI 态渲成 HTML 字符串，便于单测）。纯只读：左窄栏＝项目计划摘要（已批准草案的
// rationale + 里程碑，取不到则回落时间线里程碑列表）；右＝本周 7 列周历（周一起），工作项按 due_at 落卡、
// 里程碑 due_at 标在列头、今天高亮。周历口径全用 UTC（同 timeline，避开本地时区在测试里漂移）。
// 不做创建任务（工作项创建走 intake 现状，不造旁路）——控件只有上一周 / 下一周 / 今天。

import { escapeHtml } from "@workhub/web-runtime";
import type { ProjectTimelinePageVM, TimelineWorkItemVM } from "@workhub/contracts";

import { workbenchIcons } from "../icons.js";
import type { SchedulePlanDraft } from "./api.js";

import { scheduleT } from "./locales.js";

type Locale = "zh-CN" | "en-US";

const DAY_MS = 86_400_000;

// 周历本地 UI 态——由 view.ts 持有，render 只读。weekOffset＝相对「今天所在周」的偏移（0＝本周，
// -1＝上一周，+1＝下一周）。R17-G5 #28：viewMode 周/月切换；monthOffset＝相对「今天所在月」的月偏移。
export type ScheduleViewMode = "week" | "month";
export type ScheduleUiState = {
  weekOffset: number;
  monthOffset: number;
  viewMode: ScheduleViewMode;
};

export function emptyScheduleUiState(): ScheduleUiState {
  return { weekOffset: 0, monthOffset: 0, viewMode: "week" };
}

// G4 #9（E3 计划草案左栏）：左栏计划面板的本地 UI 态——由 view.ts 持有，render 只读。
//   mode: list=草案列表 / compose=起草表单 / detail=某草案详情
//   draftsState: ready=能管项目（可起草/审批）/ forbidden=无管理权（退回里程碑回落）/ loading
//   intentDraft/rejectDraft: 失败重渲时回填 textarea 用（不在每次击键都重渲，只在提交时快照）。
export type SchedulePlanMode = "list" | "compose" | "detail";
export type SchedulePlanDraftsState = "loading" | "ready" | "forbidden";
export type SchedulePlanUiState = {
  mode: SchedulePlanMode;
  selectedDraftId?: string | undefined;
  rejecting: boolean;
  busy: boolean;
  error?: string | undefined;
  notice?: string | undefined;
  intentDraft: string;
  rejectDraft: string;
};

export function emptySchedulePlanUiState(): SchedulePlanUiState {
  return { mode: "list", rejecting: false, busy: false, intentDraft: "", rejectDraft: "" };
}

function planDraftStatusLabel(status: string, zh: boolean): string {
  const map: Record<string, { zh: string; en: string }> = {
    draft: { zh: "草稿", en: "Draft" },
    pending_review: { zh: "待审阅", en: "Pending review" },
    approved: { zh: "已批准", en: "Approved" },
    rejected: { zh: "已驳回", en: "Rejected" },
    materialized: { zh: "已写入时间线", en: "Added to the timeline" }
  };
  const entry = map[status];
  return entry ? (zh ? entry.zh : entry.en) : status;
}

function planDraftStatusTone(status: string): string {
  switch (status) {
    case "pending_review":
      return "approval";
    case "approved":
      return "info";
    case "materialized":
      return "info";
    case "rejected":
      return "handoff";
    default:
      return "info";
  }
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

// #28：当月（含填满整周的溢出日）6×7 网格。周一起，UTC 口径同周历。
export type ScheduleMonth = {
  weeks: Date[][];
  year: number;
  monthIndex: number; // 0 = 一月
  todayKey: string;
};

export function computeScheduleMonth(referenceIso: string, monthOffset: number): ScheduleMonth {
  const now = parseDate(referenceIso) ?? new Date();
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1));
  const gridStart = startOfWeekUtc(firstOfMonth);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w += 1) {
    const days: Date[] = [];
    for (let d = 0; d < 7; d += 1) {
      days.push(new Date(gridStart.getTime() + (w * 7 + d) * DAY_MS));
    }
    weeks.push(days);
  }
  return {
    weeks,
    year: firstOfMonth.getUTCFullYear(),
    monthIndex: firstOfMonth.getUTCMonth(),
    todayKey: dayKey(now)
  };
}

// #28：点月历某天 → 切回周视图并定位到那周。算出该天相对今天所在周的整周偏移。
export function weekOffsetForDay(referenceIso: string, dayKeyStr: string): number {
  const now = parseDate(referenceIso) ?? new Date();
  const target = parseDate(dayKeyStr);
  if (!target) {
    return 0;
  }
  const base = startOfWeekUtc(now).getTime();
  const targetWeek = startOfWeekUtc(target).getTime();
  return Math.round((targetWeek - base) / (7 * DAY_MS));
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
    pm_mode: { zh: "人工接管", en: "Handled by a person" },
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
    : scheduleT(zh, "unassigned");
  const overdue = item.overdue ? `<span class="wh-wb-sc-overdot" title="${scheduleT(zh, "overdue")}"></span>` : "";
  return `<div class="wh-wb-sc-task" style="border-left-color:${statusBorder(item)}" data-wb-sc-card data-wb-sc-id="${escapeHtml(
    item.id
  )}" role="button" tabindex="0" title="${scheduleT(zh, "openThisItemOnTheTimeline")}">
    <div class="wh-wb-sc-task-title">${overdue}${escapeHtml(item.title)}</div>
    <div class="wh-wb-sc-task-meta">${escapeHtml(item.code)} · ${escapeHtml(statusLabelShort(item.status, zh))} · ${assignee}</div>
  </div>`;
}

function planDueLabel(value: string | null, zh: boolean): string {
  const due = parseDate(value);
  return due
    ? `<span class="wh-wb-sc-plan-due">${due.getUTCMonth() + 1}/${due.getUTCDate()}</span>`
    : `<span class="wh-wb-sc-plan-due wh-wb-sc-plan-due--none">${scheduleT(zh, "tbd")}</span>`;
}

function planShortDate(value: string, zh: boolean): string {
  const d = parseDate(value);
  if (!d) {
    return "";
  }
  return zh ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日` : `${EN_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// 里程碑回落（无管理权 / 无草案时）：直接列时间线里程碑，诚实说明这是回落。
function renderMilestoneFallbackBody(vm: ProjectTimelinePageVM, zh: boolean, canDraft: boolean): string {
  const milestones = [...vm.milestones].sort((a, b) => a.sort - b.sort);
  if (milestones.length === 0) {
    return `<p class="wh-wb-sc-plan-empty">${
      canDraft
        ? (scheduleT(zh, "noPlanAndNoMilestonesYet"))
        : (scheduleT(zh, "noApprovedPlanAndNoMilestones"))
    }</p>`;
  }
  const list = milestones
    .map((m) => {
      const doneTag = m.status === "done" ? `<span class="wh-wb-sc-plan-done">${scheduleT(zh, "reached")}</span>` : "";
      return `<li>${workbenchIcons.pin}<span class="wh-wb-sc-plan-ms-t">${escapeHtml(m.title)}</span>${planDueLabel(m.due_at, zh)}${doneTag}</li>`;
    })
    .join("");
  return `<p class="wh-wb-sc-plan-note">${scheduleT(zh, "currentMilestones")}</p>
    <ul class="wh-wb-sc-plan-ms">${list}</ul>`;
}

// 起草表单（mode=compose）。intentDraft 只在提交时快照回填，不逐字重渲——textarea 的 DOM 值自然保留。
function renderPlanComposeBody(plan: SchedulePlanUiState, zh: boolean): string {
  return `<form class="wh-wb-sc-plan-compose" data-wb-sc-plan-compose>
    <label class="wh-wb-sc-plan-compose-label">${scheduleT(zh, "planningIntentGoalDeadlineConstraints")}</label>
    <textarea class="wh-wb-sc-plan-compose-intent" data-wb-sc-plan-compose-intent rows="5" maxlength="4000" placeholder="${escapeHtml(
      scheduleT(zh, "eGShipADemoableInvite")
    )}"${plan.busy ? " disabled" : ""}>${escapeHtml(plan.intentDraft)}</textarea>
    <div class="wh-wb-sc-plan-actions">
      <button type="submit" class="wh-wb-tl-btn wh-wb-tl-btn--primary" data-wb-sc-plan-compose-submit${plan.busy ? " disabled" : ""}>${
        plan.busy ? (scheduleT(zh, "drafting")) : (scheduleT(zh, "draftWithCuu"))
      }</button>
      <button type="button" class="wh-wb-tl-btn" data-wb-sc-plan-compose-cancel${plan.busy ? " disabled" : ""}>${scheduleT(zh, "cancel")}</button>
    </div>
    <p class="wh-wb-sc-plan-hint">${scheduleT(zh, "cuuDraftsMilestonesAndWorkItems")}</p>
  </form>`;
}

// 草案列表（mode=list）。每条可点进详情；状态 chip 直观区分 pending_review/approved/…。
function renderPlanListBody(drafts: SchedulePlanDraft[], zh: boolean): string {
  if (drafts.length === 0) {
    return `<p class="wh-wb-sc-plan-empty" data-wb-sc-plan-list-empty>${
      scheduleT(zh, "noPlanDraftsYetUseDraft")
    }</p>`;
  }
  const rows = [...drafts]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((draft) => {
      const firstLine = (draft.intent_md.split("\n").find((line) => line.trim().length > 0) ?? "").trim();
      const title = firstLine || (scheduleT(zh, "noIntent"));
      return `<div class="wh-wb-sc-plan-draft-row" data-wb-sc-plan-draft="${escapeHtml(draft.id)}" data-wb-sc-plan-draft-status="${escapeHtml(
        draft.status
      )}" role="button" tabindex="0" title="${scheduleT(zh, "openThisDraft")}">
        <div class="wh-wb-sc-plan-draft-main">
          <div class="wh-wb-sc-plan-draft-title">${escapeHtml(title)}</div>
          <div class="wh-wb-sc-plan-draft-meta">${escapeHtml(planShortDate(draft.updated_at, zh))} · ${escapeHtml(
            zh ? `${draft.milestones.length} 里程碑 · ${draft.items.length} 工作项` : `${draft.milestones.length} milestones · ${draft.items.length} items`
          )}</div>
        </div>
        <span class="wh-wb-sc-plan-chip wh-wb-sc-plan-chip--${planDraftStatusTone(draft.status)}">${escapeHtml(planDraftStatusLabel(draft.status, zh))}</span>
      </div>`;
    })
    .join("");
  return `<div class="wh-wb-sc-plan-list" data-wb-sc-plan-list>${rows}</div>`;
}

// 草案详情（mode=detail）：里程碑 / 工作项 / 理由 / 审阅意见 + 按状态给动作按钮。
function renderPlanDetailBody(draft: SchedulePlanDraft, plan: SchedulePlanUiState, zh: boolean): string {
  const back = `<button type="button" class="wh-wb-sc-plan-back" data-wb-sc-plan-back>${workbenchIcons.chevronLeft}<span>${
    scheduleT(zh, "backToDrafts")
  }</span></button>`;
  const statusChip = `<span class="wh-wb-sc-plan-chip wh-wb-sc-plan-chip--${planDraftStatusTone(draft.status)}">${escapeHtml(
    planDraftStatusLabel(draft.status, zh)
  )}</span>`;

  const milestones = [...draft.milestones].sort((a, b) => a.sort - b.sort);
  const milestoneList = milestones.length
    ? `<h2 class="wh-wb-sc-plan-h2">${scheduleT(zh, "milestones")}</h2><ul class="wh-wb-sc-plan-ms">${milestones
        .map((m) => `<li>${workbenchIcons.pin}<span class="wh-wb-sc-plan-ms-t">${escapeHtml(m.title)}</span>${planDueLabel(m.due_at, zh)}</li>`)
        .join("")}</ul>`
    : "";
  const itemList = draft.items.length
    ? `<h2 class="wh-wb-sc-plan-h2">${scheduleT(zh, "workItems")}</h2><ul class="wh-wb-sc-plan-items">${draft.items
        .map((it) => {
          const deps = it.depends_on_refs.length
            ? `<span class="wh-wb-sc-plan-item-dep">${escapeHtml(zh ? `依赖 ${it.depends_on_refs.join("、")}` : `needs ${it.depends_on_refs.join(", ")}`)}</span>`
            : "";
          const assignee = it.assignee_suggestion
            ? `<span class="wh-wb-sc-plan-item-owner">${escapeHtml(zh ? `建议：${it.assignee_suggestion}` : `suggest: ${it.assignee_suggestion}`)}</span>`
            : "";
          return `<li class="wh-wb-sc-plan-item" data-wb-sc-plan-item-ref="${escapeHtml(it.ref)}">
            <div class="wh-wb-sc-plan-item-title">${escapeHtml(it.title)}${planDueLabel(it.due_at, zh)}</div>
            <div class="wh-wb-sc-plan-item-obj">${escapeHtml(it.objective_md)}</div>
            <div class="wh-wb-sc-plan-item-meta">${deps}${assignee}</div>
          </li>`;
        })
        .join("")}</ul>`
    : "";
  const rationale = draft.rationale_md
    ? `<h2 class="wh-wb-sc-plan-h2">${scheduleT(zh, "rationale")}</h2>${draft.rationale_md
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => `<p class="wh-wb-sc-plan-p">${escapeHtml(line)}</p>`)
        .join("")}`
    : "";
  const reviewReason = draft.review_reason_md
    ? `<h2 class="wh-wb-sc-plan-h2">${scheduleT(zh, "reviewNote")}</h2><p class="wh-wb-sc-plan-p wh-wb-sc-plan-review">${escapeHtml(
        draft.review_reason_md
      )}</p>`
    : "";
  const resultSummary = draft.status === "materialized" && draft.result
    ? `<p class="wh-wb-sc-plan-note" data-wb-sc-plan-result>${escapeHtml(
        zh
          ? `已写入时间线：${draft.result.milestone_ids.length} 个里程碑 · ${draft.result.work_item_ids.length} 个任务 · ${draft.result.dependency_count} 条依赖。`
          : `Added to the timeline: ${draft.result.milestone_ids.length} milestones · ${draft.result.work_item_ids.length} tasks · ${draft.result.dependency_count} dependencies.`
      )}</p>`
    : "";

  // 动作按钮（按状态；忙态全禁用）。驳回展开时露理由输入。
  const busyAttr = plan.busy ? " disabled" : "";
  let actions = "";
  if (plan.rejecting) {
    actions = `<div class="wh-wb-sc-plan-reject" data-wb-sc-plan-reject-panel>
      <textarea class="wh-wb-sc-plan-reject-reason" data-wb-sc-plan-reject-reason rows="3" maxlength="2000" placeholder="${escapeHtml(
        scheduleT(zh, "reasonForRejectionFedIntoThe")
      )}"${busyAttr}>${escapeHtml(plan.rejectDraft)}</textarea>
      <div class="wh-wb-sc-plan-actions">
        <button type="button" class="wh-wb-tl-btn wh-wb-tl-btn--danger" data-wb-sc-plan-reject-confirm${busyAttr}>${
          plan.busy ? (scheduleT(zh, "rejecting")) : (scheduleT(zh, "confirmReject"))
        }</button>
        <button type="button" class="wh-wb-tl-btn" data-wb-sc-plan-reject-cancel${busyAttr}>${scheduleT(zh, "cancel")}</button>
      </div>
    </div>`;
  } else if (draft.status === "pending_review") {
    actions = `<div class="wh-wb-sc-plan-actions">
      <button type="button" class="wh-wb-tl-btn wh-wb-tl-btn--primary" data-wb-sc-plan-approve${busyAttr}>${
        plan.busy ? (scheduleT(zh, "working")) : (scheduleT(zh, "approve"))
      }</button>
      <button type="button" class="wh-wb-tl-btn" data-wb-sc-plan-reject${busyAttr}>${scheduleT(zh, "reject")}</button>
    </div>`;
  } else if (draft.status === "approved") {
    actions = `<div class="wh-wb-sc-plan-actions">
      <button type="button" class="wh-wb-tl-btn wh-wb-tl-btn--primary" data-wb-sc-plan-materialize${busyAttr}>${
        plan.busy ? (scheduleT(zh, "materializing")) : (scheduleT(zh, "materializeToTimeline"))
      }</button>
    </div>`;
  }

  return `${back}
    <div class="wh-wb-sc-plan-detail-head">${statusChip}</div>
    <h2 class="wh-wb-sc-plan-h2">${scheduleT(zh, "intent")}</h2>
    <p class="wh-wb-sc-plan-p wh-wb-sc-plan-intent">${escapeHtml(draft.intent_md)}</p>
    ${milestoneList}${itemList}${rationale}${reviewReason}${resultSummary}${actions}`;
}

function renderPlanPanelHtml(input: {
  vm: ProjectTimelinePageVM;
  drafts: SchedulePlanDraft[];
  draftsState: SchedulePlanDraftsState;
  plan: SchedulePlanUiState;
  zh: boolean;
}): string {
  const { vm, drafts, draftsState, plan, zh } = input;
  const canDraft = draftsState === "ready";
  const newBtn = canDraft && plan.mode === "list"
    ? `<button type="button" class="wh-wb-tl-btn wh-wb-tl-btn--primary wh-wb-sc-plan-new" data-wb-sc-plan-new>${zh ? "用 Cuu 起草计划" : "Draft a plan with Cuu"}</button>`
    : "";
  const head = `<div class="wh-wb-sc-plan-head"><span class="wh-wb-sc-plan-t">${zh ? "项目计划" : "Project plan"}</span>${newBtn}</div>`;
  const notice = plan.notice
    ? `<p class="wh-wb-sc-plan-notice" data-wb-sc-plan-notice>${escapeHtml(plan.notice)}</p>`
    : "";
  const error = plan.error
    ? `<p class="wh-wb-sc-plan-err" data-wb-sc-plan-error>${escapeHtml(plan.error)}</p>`
    : "";

  let body: string;
  if (draftsState !== "ready") {
    // 无管理权（forbidden）或还在加载草案——退回里程碑回落，不给「起草」假入口。
    body = renderMilestoneFallbackBody(vm, zh, false);
  } else if (plan.mode === "compose") {
    body = renderPlanComposeBody(plan, zh);
  } else if (plan.mode === "detail") {
    const selected = drafts.find((d) => d.id === plan.selectedDraftId);
    body = selected
      ? renderPlanDetailBody(selected, plan, zh)
      : renderPlanListBody(drafts, zh); // 选中项没了（被物化后重拉等）——退回列表
  } else {
    body = renderPlanListBody(drafts, zh);
  }

  return `<div class="wh-wb-sc-plan" data-wb-sc-plan-mode="${escapeHtml(plan.mode)}" data-wb-sc-plan-drafts-state="${escapeHtml(
    draftsState
  )}">${head}${notice}${error}<div class="wh-wb-sc-plan-body">${body}</div></div>`;
}

export function renderScheduleLoadingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-sc-state"><span class="wh-wb-spinner"></span>${scheduleT(locale, "loadingSchedule")}</div>`;
}

export function renderScheduleErrorHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-sc-state wh-wb-sc-state--error">${
    scheduleT(locale, "couldnTLoadTheScheduleRetry")
  }<div style="margin-top:12px"><button type="button" class="wh-wb-tl-btn" data-wb-sc-retry>${
    scheduleT(locale, "retry")
  }</button></div></div>`;
}

// due_at 按 UTC 日归组（周历/月历共用）。
function bucketByDay(vm: ProjectTimelinePageVM): {
  itemsByDay: Map<string, TimelineWorkItemVM[]>;
  milestonesByDay: Map<string, string[]>;
} {
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
  return { itemsByDay, milestonesByDay };
}

// #28：周/月切换 chip。
function viewToggleHtml(mode: ScheduleViewMode, zh: boolean): string {
  const chip = (m: ScheduleViewMode, label: string) =>
    `<button type="button" class="wh-wb-sc-modechip${mode === m ? " wh-wb-sc-modechip--active" : ""}" data-wb-sc-mode="${m}"${
      mode === m ? ' aria-current="true"' : ""
    }>${label}</button>`;
  return `<div class="wh-wb-sc-modes" role="group" aria-label="${scheduleT(zh, "viewMode")}">${chip(
    "week",
    scheduleT(zh, "week")
  )}${chip("month", scheduleT(zh, "month"))}</div>`;
}

function calHeadHtml(title: string, mode: ScheduleViewMode, zh: boolean): string {
  const prevLabel = mode === "month" ? (scheduleT(zh, "previousMonth")) : scheduleT(zh, "previousWeek");
  const nextLabel = mode === "month" ? (scheduleT(zh, "nextMonth")) : scheduleT(zh, "nextWeek");
  return `<div class="wh-wb-sc-cal-head">
    <span class="wh-wb-sc-range">${escapeHtml(title)}</span>
    ${viewToggleHtml(mode, zh)}
    <div class="wh-wb-sc-nav">
      <button type="button" class="wh-wb-sc-navbtn" data-wb-sc-prev title="${prevLabel}" aria-label="${prevLabel}">${workbenchIcons.chevronLeft}</button>
      <button type="button" class="wh-wb-tl-btn" data-wb-sc-today>${scheduleT(zh, "today")}</button>
      <button type="button" class="wh-wb-sc-navbtn" data-wb-sc-next title="${nextLabel}" aria-label="${nextLabel}">${workbenchIcons.chevronRight}</button>
    </div>
  </div>`;
}

function renderWeekGridHtml(
  week: ScheduleWeek,
  itemsByDay: Map<string, TimelineWorkItemVM[]>,
  milestonesByDay: Map<string, string[]>,
  zh: boolean
): string {
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
  return `<div class="wh-wb-sc-grid">${columns}</div>`;
}

// #28：月视图单元格——日期 + 任务压缩成小点（按状态着色，超 4 个折成「+K」）+ 里程碑标记。
const MONTH_DOT_CAP = 4;
function monthCellHtml(
  day: Date,
  month: ScheduleMonth,
  itemsByDay: Map<string, TimelineWorkItemVM[]>,
  milestonesByDay: Map<string, string[]>,
  zh: boolean
): string {
  const key = dayKey(day);
  const inMonth = day.getUTCMonth() === month.monthIndex;
  const isToday = key === month.todayKey;
  const dayItems = itemsByDay.get(key) ?? [];
  const ms = milestonesByDay.get(key) ?? [];
  const dots = dayItems
    .slice(0, MONTH_DOT_CAP)
    .map((item) => `<span class="wh-wb-sc-mdot" style="background:${statusBorder(item)}"></span>`)
    .join("");
  const overflow = dayItems.length > MONTH_DOT_CAP ? `<span class="wh-wb-sc-mmore">+${dayItems.length - MONTH_DOT_CAP}</span>` : "";
  const msDot = ms.length
    ? `<span class="wh-wb-sc-mms" title="${escapeHtml(zh ? `里程碑：${ms.join("、")}` : `Milestone: ${ms.join(", ")}`)}">${workbenchIcons.pin}</span>`
    : "";
  const title = dayItems.length
    ? zh
      ? `${day.getUTCMonth() + 1}/${day.getUTCDate()}：${dayItems.length} 项，点击查看这周`
      : `${day.getUTCMonth() + 1}/${day.getUTCDate()}: ${dayItems.length} item(s) — open this week`
    : scheduleT(zh, "openThisWeek");
  return `<div class="wh-wb-sc-mcell${inMonth ? "" : " wh-wb-sc-mcell--out"}${isToday ? " wh-wb-sc-mcell--today" : ""}" data-wb-sc-day="${key}" role="button" tabindex="0" title="${title}">
    <div class="wh-wb-sc-mcell-top"><span class="wh-wb-sc-mdate">${day.getUTCDate()}</span>${msDot}</div>
    ${dayItems.length ? `<div class="wh-wb-sc-mdots">${dots}${overflow}</div>` : ""}
  </div>`;
}

function renderMonthGridHtml(
  month: ScheduleMonth,
  itemsByDay: Map<string, TimelineWorkItemVM[]>,
  milestonesByDay: Map<string, string[]>,
  zh: boolean
): string {
  const dowRow = (zh ? ZH_DOW : EN_DOW).map((label) => `<div class="wh-wb-sc-mdow">${label}</div>`).join("");
  const rows = month.weeks
    .map(
      (week) =>
        `<div class="wh-wb-sc-mrow">${week
          .map((day) => monthCellHtml(day, month, itemsByDay, milestonesByDay, zh))
          .join("")}</div>`
    )
    .join("");
  return `<div class="wh-wb-sc-month"><div class="wh-wb-sc-mhead">${dowRow}</div><div class="wh-wb-sc-mbody">${rows}</div></div>`;
}

function monthTitle(month: ScheduleMonth, zh: boolean): string {
  return zh ? `${month.year} 年 ${month.monthIndex + 1} 月` : `${EN_MONTHS[month.monthIndex]} ${month.year}`;
}

// #26：无 due_at 的工作项此前在日程里被静默丢弃（看板/时间线都诚实标「未定期」）。这里在周历/月历底部加
// 一条「未定期」小列（计数 + 列表），扫描口径与看板「未排期」一致（parseDate(due_at) 为空）；点击复用
// 日程卡的 data-wb-sc-card 通道跳到时间线该行（view.ts 无需另接）。全部有 due_at 时不渲，不占空间。
function renderUndatedStripHtml(vm: ProjectTimelinePageVM, zh: boolean): string {
  const undated = vm.items.filter((item) => !parseDate(item.due_at));
  if (undated.length === 0) {
    return "";
  }
  const rows = [...undated]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(
      (item) =>
        `<div class="wh-wb-sc-undated-item" data-wb-sc-card data-wb-sc-id="${escapeHtml(item.id)}" role="button" tabindex="0" title="${
          scheduleT(zh, "openThisItemOnTheTimeline")
        }">
          <span class="wh-wb-sc-undated-code">${escapeHtml(item.code)}</span>
          <span class="wh-wb-sc-undated-title">${escapeHtml(item.title)}</span>
          <span class="wh-wb-sc-undated-status">${escapeHtml(statusLabelShort(item.status, zh))}</span>
        </div>`
    )
    .join("");
  return `<div class="wh-wb-sc-undated" data-wb-sc-undated>
    <div class="wh-wb-sc-undated-head">
      <span class="wh-wb-sc-undated-t">${scheduleT(zh, "undated")}</span>
      <span class="wh-wb-sc-undated-count">${undated.length}</span>
    </div>
    <div class="wh-wb-sc-undated-list">${rows}</div>
  </div>`;
}

export function renderScheduleHtml(input: {
  vm: ProjectTimelinePageVM;
  drafts: SchedulePlanDraft[];
  draftsState: SchedulePlanDraftsState;
  plan: SchedulePlanUiState;
  locale: Locale;
  ui: ScheduleUiState;
}): string {
  const { vm, drafts, draftsState, plan, ui } = input;
  const zh = input.locale === "zh-CN";
  const { itemsByDay, milestonesByDay } = bucketByDay(vm);

  let head: string;
  let grid: string;
  if (ui.viewMode === "month") {
    const month = computeScheduleMonth(vm.generated_at, ui.monthOffset);
    head = calHeadHtml(monthTitle(month, zh), "month", zh);
    grid = renderMonthGridHtml(month, itemsByDay, milestonesByDay, zh);
  } else {
    const week = computeScheduleWeek(vm.generated_at, ui.weekOffset);
    head = calHeadHtml(formatRange(week, zh), "week", zh);
    grid = renderWeekGridHtml(week, itemsByDay, milestonesByDay, zh);
  }

  const cal = `<div class="wh-wb-sc-cal">${head}${grid}${renderUndatedStripHtml(vm, zh)}</div>`;
  return `<div class="wh-wb-sc">${renderPlanPanelHtml({ vm, drafts, draftsState, plan, zh })}${cal}</div>`;
}
