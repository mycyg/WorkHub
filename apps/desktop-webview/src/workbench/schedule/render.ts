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
    materialized: { zh: "已物化", en: "Materialized" }
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

function planDueLabel(value: string | null, zh: boolean): string {
  const due = parseDate(value);
  return due
    ? `<span class="wh-wb-sc-plan-due">${due.getUTCMonth() + 1}/${due.getUTCDate()}</span>`
    : `<span class="wh-wb-sc-plan-due wh-wb-sc-plan-due--none">${zh ? "未定期" : "TBD"}</span>`;
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
        ? (zh
          ? "还没有项目计划，也还没有里程碑。点上方「用 Cuu 起草计划」让 Cuu 拟一份。"
          : "No plan and no milestones yet. Use “Draft a plan with Cuu” above to have Cuu propose one.")
        : (zh
          ? "还没有已批准的项目计划，也还没有里程碑。"
          : "No approved plan and no milestones yet.")
    }</p>`;
  }
  const list = milestones
    .map((m) => {
      const doneTag = m.status === "done" ? `<span class="wh-wb-sc-plan-done">${zh ? "已达成" : "Reached"}</span>` : "";
      return `<li>${workbenchIcons.pin}<span class="wh-wb-sc-plan-ms-t">${escapeHtml(m.title)}</span>${planDueLabel(m.due_at, zh)}${doneTag}</li>`;
    })
    .join("");
  return `<p class="wh-wb-sc-plan-note">${zh ? "当前里程碑：" : "Current milestones:"}</p>
    <ul class="wh-wb-sc-plan-ms">${list}</ul>`;
}

// 起草表单（mode=compose）。intentDraft 只在提交时快照回填，不逐字重渲——textarea 的 DOM 值自然保留。
function renderPlanComposeBody(plan: SchedulePlanUiState, zh: boolean): string {
  return `<form class="wh-wb-sc-plan-compose" data-wb-sc-plan-compose>
    <label class="wh-wb-sc-plan-compose-label">${zh ? "规划意图（目标 / 期限 / 约束）" : "Planning intent (goal / deadline / constraints)"}</label>
    <textarea class="wh-wb-sc-plan-compose-intent" data-wb-sc-plan-compose-intent rows="5" maxlength="4000" placeholder="${escapeHtml(
      zh
        ? "例如：两周内做出可演示的邀请码注册流程，覆盖埋点与基础测试。"
        : "e.g. Ship a demoable invite-code signup flow within two weeks, with analytics and basic tests."
    )}"${plan.busy ? " disabled" : ""}>${escapeHtml(plan.intentDraft)}</textarea>
    <div class="wh-wb-sc-plan-actions">
      <button type="submit" class="wh-wb-tl-btn wh-wb-tl-btn--primary" data-wb-sc-plan-compose-submit${plan.busy ? " disabled" : ""}>${
        plan.busy ? (zh ? "生成中…" : "Drafting…") : (zh ? "用 Cuu 起草" : "Draft with Cuu")
      }</button>
      <button type="button" class="wh-wb-tl-btn" data-wb-sc-plan-compose-cancel${plan.busy ? " disabled" : ""}>${zh ? "取消" : "Cancel"}</button>
    </div>
    <p class="wh-wb-sc-plan-hint">${zh ? "Cuu 会据此拟里程碑与工作项草案，落库后交你审批。" : "Cuu drafts milestones and work items from this, saved for your review."}</p>
  </form>`;
}

// 草案列表（mode=list）。每条可点进详情；状态 chip 直观区分 pending_review/approved/…。
function renderPlanListBody(drafts: SchedulePlanDraft[], zh: boolean): string {
  if (drafts.length === 0) {
    return `<p class="wh-wb-sc-plan-empty" data-wb-sc-plan-list-empty>${
      zh
        ? "还没有计划草案。点上方「用 Cuu 起草计划」让 Cuu 拟一份。"
        : "No plan drafts yet. Use “Draft a plan with Cuu” above to have Cuu propose one."
    }</p>`;
  }
  const rows = [...drafts]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((draft) => {
      const firstLine = (draft.intent_md.split("\n").find((line) => line.trim().length > 0) ?? "").trim();
      const title = firstLine || (zh ? "（无意图描述）" : "(no intent)");
      return `<div class="wh-wb-sc-plan-draft-row" data-wb-sc-plan-draft="${escapeHtml(draft.id)}" data-wb-sc-plan-draft-status="${escapeHtml(
        draft.status
      )}" role="button" tabindex="0" title="${zh ? "查看这份草案的详情" : "Open this draft"}">
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
    zh ? "返回草案列表" : "Back to drafts"
  }</span></button>`;
  const statusChip = `<span class="wh-wb-sc-plan-chip wh-wb-sc-plan-chip--${planDraftStatusTone(draft.status)}">${escapeHtml(
    planDraftStatusLabel(draft.status, zh)
  )}</span>`;

  const milestones = [...draft.milestones].sort((a, b) => a.sort - b.sort);
  const milestoneList = milestones.length
    ? `<h2 class="wh-wb-sc-plan-h2">${zh ? "里程碑" : "Milestones"}</h2><ul class="wh-wb-sc-plan-ms">${milestones
        .map((m) => `<li>${workbenchIcons.pin}<span class="wh-wb-sc-plan-ms-t">${escapeHtml(m.title)}</span>${planDueLabel(m.due_at, zh)}</li>`)
        .join("")}</ul>`
    : "";
  const itemList = draft.items.length
    ? `<h2 class="wh-wb-sc-plan-h2">${zh ? "工作项" : "Work items"}</h2><ul class="wh-wb-sc-plan-items">${draft.items
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
    ? `<h2 class="wh-wb-sc-plan-h2">${zh ? "计划说明" : "Rationale"}</h2>${draft.rationale_md
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => `<p class="wh-wb-sc-plan-p">${escapeHtml(line)}</p>`)
        .join("")}`
    : "";
  const reviewReason = draft.review_reason_md
    ? `<h2 class="wh-wb-sc-plan-h2">${zh ? "审阅意见" : "Review note"}</h2><p class="wh-wb-sc-plan-p wh-wb-sc-plan-review">${escapeHtml(
        draft.review_reason_md
      )}</p>`
    : "";
  const resultSummary = draft.status === "materialized" && draft.result
    ? `<p class="wh-wb-sc-plan-note" data-wb-sc-plan-result>${escapeHtml(
        zh
          ? `已物化到时间线：${draft.result.milestone_ids.length} 里程碑 · ${draft.result.work_item_ids.length} 工作项 · ${draft.result.dependency_count} 依赖。`
          : `Materialized: ${draft.result.milestone_ids.length} milestones · ${draft.result.work_item_ids.length} items · ${draft.result.dependency_count} dependencies.`
      )}</p>`
    : "";

  // 动作按钮（按状态；忙态全禁用）。驳回展开时露理由输入。
  const busyAttr = plan.busy ? " disabled" : "";
  let actions = "";
  if (plan.rejecting) {
    actions = `<div class="wh-wb-sc-plan-reject" data-wb-sc-plan-reject-panel>
      <textarea class="wh-wb-sc-plan-reject-reason" data-wb-sc-plan-reject-reason rows="3" maxlength="2000" placeholder="${escapeHtml(
        zh ? "写明驳回理由（会带给下一次重拟）" : "Reason for rejection (fed into the next redraft)"
      )}"${busyAttr}>${escapeHtml(plan.rejectDraft)}</textarea>
      <div class="wh-wb-sc-plan-actions">
        <button type="button" class="wh-wb-tl-btn wh-wb-tl-btn--danger" data-wb-sc-plan-reject-confirm${busyAttr}>${
          plan.busy ? (zh ? "驳回中…" : "Rejecting…") : (zh ? "确认驳回" : "Confirm reject")
        }</button>
        <button type="button" class="wh-wb-tl-btn" data-wb-sc-plan-reject-cancel${busyAttr}>${zh ? "取消" : "Cancel"}</button>
      </div>
    </div>`;
  } else if (draft.status === "pending_review") {
    actions = `<div class="wh-wb-sc-plan-actions">
      <button type="button" class="wh-wb-tl-btn wh-wb-tl-btn--primary" data-wb-sc-plan-approve${busyAttr}>${
        plan.busy ? (zh ? "处理中…" : "Working…") : (zh ? "批准" : "Approve")
      }</button>
      <button type="button" class="wh-wb-tl-btn" data-wb-sc-plan-reject${busyAttr}>${zh ? "驳回" : "Reject"}</button>
    </div>`;
  } else if (draft.status === "approved") {
    actions = `<div class="wh-wb-sc-plan-actions">
      <button type="button" class="wh-wb-tl-btn wh-wb-tl-btn--primary" data-wb-sc-plan-materialize${busyAttr}>${
        plan.busy ? (zh ? "物化中…" : "Materializing…") : (zh ? "物化到时间线" : "Materialize to timeline")
      }</button>
    </div>`;
  }

  return `${back}
    <div class="wh-wb-sc-plan-detail-head">${statusChip}</div>
    <h2 class="wh-wb-sc-plan-h2">${zh ? "规划意图" : "Intent"}</h2>
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
  drafts: SchedulePlanDraft[];
  draftsState: SchedulePlanDraftsState;
  plan: SchedulePlanUiState;
  locale: Locale;
  ui: ScheduleUiState;
}): string {
  const { vm, drafts, draftsState, plan, ui } = input;
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

  return `<div class="wh-wb-sc">${renderPlanPanelHtml({ vm, drafts, draftsState, plan, zh })}${cal}</div>`;
}
