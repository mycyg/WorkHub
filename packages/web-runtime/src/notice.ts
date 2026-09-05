import { goldPathT, type WorkHubLocale } from "@workhub/ui/gold-path";

import { escapeHtml } from "./html.js";
import { noticeT, noticeTf } from "./notice-copy.js";

export type RouteNoticeKind =
  | "action_success"
  | "action_error"
  | "selection"
  | "reason_required"
  | "action_pending"
  | "action_in_progress"
  | "logout_failed"
  | "desktop_required"
  | "merge_conflict"
  | "sse_refresh"
  | "sse_dirty_guard"
  | "sse_gave_up"
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
      return noticeT(locale, "offline");
    }
    // 普通用户审查 R3 high：会话过期的服务端原串 "not identified" 是天书——换成可操作的人话。
    const errorCode = (error as { code?: unknown }).code;
    if (errorCode === "not_identified" || error.message === "not identified") {
      return noticeT(locale, "sessionExpired");
    }
    // R3：客户端超时错误串是中文硬编码（api-client 无 locale）——按错误码在这里双语化。
    if (errorCode === "request_timeout") {
      return noticeT(locale, "requestTimeout");
    }
    // 普通用户审查 R3 high：服务端错误串大量只有中文——en 界面读到整句中文。系统性兜底：
    // en 会话下 message 含 CJK 时给通用英文+错误码（服务端逐串双语化是长尾，客户端先保体验）。
    if (locale === "en-US" && /[\u4e00-\u9fff]/u.test(error.message)) {
      // R9 回归修复：服务端「中文正文(English gloss)」双语串——先提取末尾英文括注，
      // 否则专门写的英文说明会被整句通用兜底吞掉。
      const gloss = /\(([^()\u4e00-\u9fff]{8,})\)\s*$/u.exec(error.message)?.[1];
      if (gloss) {
        return gloss;
      }
      const code = (error as { code?: unknown }).code;
      return typeof code === "string" && code
        ? noticeTf(locale, "requestRejectedWithCode", { code: code.replace(/_/gu, " ") })
        : noticeT(locale, "requestRejected");
    }
    // R8（错误面 high）：镜像分支——全局兜底（422 契约不符/500/404/JSON 解析失败）的 message 只有英文，
    // 中文界面用户读到整句英文原文。zh 会话下 message 为纯 ASCII 时同样走通用中文兜底+错误码。
    if (locale !== "en-US" && !/[\u4e00-\u9fff]/u.test(error.message) && /[A-Za-z]/u.test(error.message)) {
      const code = (error as { code?: unknown }).code;
      return typeof code === "string" && code
        ? noticeTf(locale, "requestRejectedWithCode", { code: code.replace(/_/gu, " ") })
        : noticeT(locale, "requestRejected");
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
  return noticeT(locale, "taskPlanDrafted");
}

export function startAgentRunQueuedNoticeBody(locale: WorkHubLocale): string {
  return noticeT(locale, "agentRunQueued");
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

// R10-P1-5：真实 in-flight（请求已发出、等服务端回来）和「功能没接线」是两种状态——
// 前者用这个「处理中」notice；actionPendingNotice 只留给真正没有处理器的动作兜底。
export function actionInProgressNotice(locale: WorkHubLocale, actionId?: string): RouteNoticeVM {
  return {
    kind: "action_in_progress",
    tone: "info",
    source: "client",
    locale,
    title: goldPathT(locale, "runtime.notice.inProgressTitle"),
    body: goldPathT(locale, "runtime.actionInProgress"),
    actionId
  };
}

// R10-P1-8：登出失败不许伪装成已登出——服务端会话可能仍有效，必须显式告知。
export function logoutFailedNotice(locale: WorkHubLocale): RouteNoticeVM {
  return {
    kind: "logout_failed",
    tone: "danger",
    source: "client",
    locale,
    title: goldPathT(locale, "runtime.notice.logoutFailedTitle"),
    body: goldPathT(locale, "runtime.logoutFailedBody"),
    actionId: "logout"
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
  // E2E-09：确认屏「创建任务」未选方向被拦时，通用「请先选择一个选项」对不上用户心智（他要做的是
  // 选方向）。create_workitem 动作用确认步专用文案，其余（澄清步）保持通用口径。
  const confirmStep = actionId === "create_workitem";
  return {
    kind: "intake_option_required",
    tone: "warning",
    source: "client",
    locale,
    title: goldPathT(locale, "runtime.notice.intakeOptionRequiredTitle"),
    body: confirmStep
      ? noticeT(locale, "pickDirectionFirst")
      : goldPathT(locale, "runtime.notice.intakeOptionRequiredBody"),
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
  // R5（键盘可达）：理由卡此前没有脱身出口——键盘用户被迫三选一。补「取消」钮（Esc 同效，见 browser 键盘处理）。
  const cancelLabel = noticeT(locale, "cancel");
  return `<div class="wh-app-action-row">${reasons
    .map((reason) => `<button type="button" data-review-reason="${escapeHtml(reason)}">${escapeHtml(reason)}</button>`)
    .join("")}<button type="button" data-review-reason-cancel="true">${escapeHtml(cancelLabel)}</button></div>`;
}
