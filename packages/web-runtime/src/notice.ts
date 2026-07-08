import { goldPathT, type WorkHubLocale } from "@workhub/ui/gold-path";

import { escapeHtml } from "./html.js";

export type RouteNoticeKind =
  | "action_success"
  | "action_error"
  | "selection"
  | "reason_required"
  | "action_pending"
  | "desktop_required"
  | "merge_conflict"
  | "sse_refresh"
  | "sse_dirty_guard"
  | "budget_warning"
  | "field_value_required"
  | "intake_option_required"
  | "locale_persistence_failed";

export type RouteNoticeTone = "info" | "success" | "warning" | "danger";
export type RouteNoticeSource = "client" | "rest" | "sse";

export type RouteNoticeVM = {
  kind: RouteNoticeKind;
  tone: RouteNoticeTone;
  source: RouteNoticeSource;
  locale: WorkHubLocale;
  title: string;
  body: string;
  actionId?: string | undefined;
  eventType?: string | undefined;
  stream?: string | undefined;
};

export type RouteNoticeTimerState = {
  timer?: number | undefined;
};

let routeNoticeSequence = 0;

export function resetRouteNoticeDataset(notice: HTMLElement) {
  delete notice.dataset.r4NoticeActionId;
  delete notice.dataset.r4NoticeEventType;
  delete notice.dataset.r4NoticeStream;
}

export function showRouteNotice(
  shellRoot: HTMLElement,
  vm: RouteNoticeVM,
  extraHtml?: string,
  timeoutMs = 4600,
  timerState?: RouteNoticeTimerState
) {
  const notice = shellRoot.querySelector<HTMLElement>("[data-wh-app-notice]");
  if (!notice) {
    return;
  }
  if (timerState?.timer !== undefined) {
    window.clearTimeout(timerState.timer);
    timerState.timer = undefined;
  }
  resetRouteNoticeDataset(notice);
  notice.dataset.r4RouteNotice = "true";
  routeNoticeSequence += 1;
  notice.dataset.r4NoticeSeq = String(routeNoticeSequence);
  notice.dataset.r4NoticeKind = vm.kind;
  notice.dataset.r4NoticeTone = vm.tone;
  notice.dataset.r4NoticeSource = vm.source;
  notice.dataset.r4NoticeLocale = vm.locale;
  if (vm.actionId) {
    notice.dataset.r4NoticeActionId = vm.actionId;
  }
  if (vm.eventType) {
    notice.dataset.r4NoticeEventType = vm.eventType;
  }
  if (vm.stream) {
    notice.dataset.r4NoticeStream = vm.stream;
  }
  notice.innerHTML = `<strong class="wh-app-notice-title">${escapeHtml(vm.title)}</strong><span class="wh-app-notice-body">${escapeHtml(vm.body)}</span>`;
  if (extraHtml) {
    notice.insertAdjacentHTML("beforeend", extraHtml);
  }
  notice.hidden = false;
  if (timeoutMs > 0 && timerState) {
    timerState.timer = window.setTimeout(() => {
      notice.hidden = true;
      timerState.timer = undefined;
    }, timeoutMs);
  }
}

export function actionMessage(error: unknown, locale: WorkHubLocale) {
  if (error instanceof Error) {
    // 普通用户审查：断网时浏览器原文「Failed to fetch」直接端给中文用户——换成可操作的人话。
    if (/failed to fetch|networkerror|load failed/iu.test(error.message)) {
      return locale === "en-US"
        ? "Could not reach the server — check your connection and try again."
        : "连不上服务器——请检查网络后重试。";
    }
    return error.message;
  }
  return goldPathT(locale, "runtime.actionFail");
}

export function actionSummary(result: unknown, locale: WorkHubLocale) {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const attention = (result as Record<string, unknown>)["attention"];
    if (attention && typeof attention === "object" && !Array.isArray(attention)) {
      const summaryText = (attention as Record<string, unknown>)["summary_text"];
      if (typeof summaryText === "string" && summaryText.trim().length > 0) {
        return summaryText;
      }
    }
  }
  return goldPathT(locale, "runtime.notice.actionSuccessTitle");
}

export function actionSuccessNotice(locale: WorkHubLocale, body: string, actionId?: string): RouteNoticeVM {
  return {
    kind: "action_success",
    tone: "success",
    source: "rest",
    locale,
    title: goldPathT(locale, "runtime.notice.actionSuccessTitle"),
    body,
    actionId
  };
}

export function taskPlanDraftedNoticeBody(locale: WorkHubLocale): string {
  return locale === "en-US"
    ? "Task plan drafted. Review the plan before work starts."
    : "任务计划已生成，请先审阅再开始执行。";
}

export function startAgentRunQueuedNoticeBody(locale: WorkHubLocale): string {
  return locale === "en-US"
    ? "AI started. WorkHub will refresh this task and surface Proposal or Replay when available."
    : "AI 已开始处理，WorkHub 会刷新任务，并在有 Proposal 或 Replay 时提醒你。";
}

export function actionErrorNotice(locale: WorkHubLocale, error: unknown, actionId?: string): RouteNoticeVM {
  return {
    kind: "action_error",
    tone: "danger",
    source: "rest",
    locale,
    title: goldPathT(locale, "runtime.notice.actionErrorTitle"),
    body: actionMessage(error, locale),
    actionId
  };
}

export function actionPendingNotice(locale: WorkHubLocale, actionId?: string): RouteNoticeVM {
  return {
    kind: "action_pending",
    tone: "warning",
    source: "client",
    locale,
    title: goldPathT(locale, "runtime.notice.pendingTitle"),
    body: goldPathT(locale, "runtime.actionPending"),
    actionId
  };
}

export function desktopRequiredNotice(locale: WorkHubLocale, actionId?: string): RouteNoticeVM {
  return {
    kind: "desktop_required",
    tone: "warning",
    source: "client",
    locale,
    title: goldPathT(locale, "runtime.notice.desktopRequiredTitle"),
    body: goldPathT(locale, "runtime.notice.desktopRequiredBody"),
    actionId
  };
}

export function reasonRequiredNotice(locale: WorkHubLocale, actionId?: string): RouteNoticeVM {
  return {
    kind: "reason_required",
    tone: "warning",
    source: "client",
    locale,
    title: goldPathT(locale, "runtime.notice.reasonRequiredTitle"),
    body: goldPathT(locale, "runtime.rejectNeedsReason"),
    actionId
  };
}

export function fieldValueRequiredNotice(locale: WorkHubLocale, actionId?: string): RouteNoticeVM {
  return {
    kind: "field_value_required",
    tone: "warning",
    source: "client",
    locale,
    title: goldPathT(locale, "runtime.notice.fieldValueRequiredTitle"),
    body: goldPathT(locale, "runtime.notice.fieldValueRequiredBody"),
    actionId
  };
}

export function intakeOptionRequiredNotice(locale: WorkHubLocale, actionId?: string): RouteNoticeVM {
  return {
    kind: "intake_option_required",
    tone: "warning",
    source: "client",
    locale,
    title: goldPathT(locale, "runtime.notice.intakeOptionRequiredTitle"),
    body: goldPathT(locale, "runtime.notice.intakeOptionRequiredBody"),
    actionId
  };
}

export function localePersistenceFailedNotice(locale: WorkHubLocale, actionId?: string): RouteNoticeVM {
  return {
    kind: "locale_persistence_failed",
    tone: "warning",
    source: "rest",
    locale,
    title: goldPathT(locale, "runtime.notice.localePersistenceFailedTitle"),
    body: goldPathT(locale, "runtime.notice.localePersistenceFailedBody"),
    actionId
  };
}

export function selectionNotice(locale: WorkHubLocale, label: string): RouteNoticeVM {
  return {
    kind: "selection",
    tone: "info",
    source: "client",
    locale,
    title: goldPathT(locale, "runtime.notice.selectionTitle"),
    body: `${goldPathT(locale, "runtime.optionSelectedPrefix")}${label}${goldPathT(locale, "runtime.optionSelectedSuffix")}`,
    actionId: "select_option"
  };
}

export function mergeConflictNotice(locale: WorkHubLocale, actionId?: string): RouteNoticeVM {
  return {
    kind: "merge_conflict",
    tone: "warning",
    source: "rest",
    locale,
    title: goldPathT(locale, "runtime.notice.mergeConflictTitle"),
    body: goldPathT(locale, "runtime.notice.mergeConflictBody"),
    actionId
  };
}

export function sseRefreshNotice(locale: WorkHubLocale, eventType: string, stream: string): RouteNoticeVM {
  if (eventType === "budget.warning") {
    return {
      kind: "budget_warning",
      tone: "warning",
      source: "sse",
      locale,
      title: goldPathT(locale, "runtime.notice.budgetWarningTitle"),
      body: goldPathT(locale, "runtime.notice.budgetWarningBody"),
      eventType,
      stream
    };
  }
  return {
    kind: "sse_refresh",
    tone: "info",
    source: "sse",
    locale,
    title: goldPathT(locale, "runtime.notice.sseRefreshTitle"),
    body: goldPathT(locale, "runtime.notice.sseRefreshBody"),
    eventType,
    stream
  };
}

export function sseDirtyGuardNotice(locale: WorkHubLocale, eventType: string, stream: string): RouteNoticeVM {
  return {
    kind: "sse_dirty_guard",
    tone: "warning",
    source: "sse",
    locale,
    title: goldPathT(locale, "runtime.notice.sseDirtyGuardTitle"),
    body: goldPathT(locale, "runtime.notice.sseDirtyGuardBody"),
    eventType,
    stream
  };
}

export function dirtyGuardRefreshAction(locale: WorkHubLocale, href: string) {
  return `<div class="wh-app-action-row"><button type="button" data-action-href="${escapeHtml(href)}" data-href="${escapeHtml(href)}" data-r4-dirty-refresh="true">${escapeHtml(goldPathT(locale, "runtime.notice.sseDirtyGuardAction"))}</button></div>`;
}

export function reviewReasonButtons(locale: WorkHubLocale) {
  const reasons = [
    goldPathT(locale, "runtime.reason.evidence"),
    goldPathT(locale, "runtime.reason.tone"),
    goldPathT(locale, "runtime.reason.scope")
  ];
  return `<div class="wh-app-action-row">${reasons
    .map((reason) => `<button type="button" data-review-reason="${escapeHtml(reason)}">${escapeHtml(reason)}</button>`)
    .join("")}</div>`;
}
