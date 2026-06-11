import { createApiClient, WorkHubApiError } from "@workhub/api-client/client";
import {
  eventTypes,
  type ApplyMergeProposalCandidateRequest,
  type CreateWorkItemRequest,
  type MergeProposalRequest,
  type NextQuestionRequest,
  type ProposalConflict,
  type UseEvidenceForTaskRequest
} from "@workhub/contracts";
import {
  classifyGoldPathHref,
  goldPathT,
  normalizeWorkHubLocale,
  resolveGoldPathPageKey,
  workHubLocaleStorageKey,
  type GoldPathAppShell,
  type WorkHubLocale
} from "@workhub/ui/gold-path";
import { renderProposalConflictCards } from "@workhub/ui/proposal";
import {
  createUnknownWebRouteMatch,
  loadWebRoute,
  renderWebRouteState,
  resolveWebRoute,
  webRouteHref,
  type WebRouteReadyResult
} from "./routes.js";

const root = document.getElementById("root");
type BrowserApiClient = ReturnType<typeof createApiClient>;
type RouteNoticeKind =
  | "action_success"
  | "action_error"
  | "selection"
  | "reason_required"
  | "action_pending"
  | "desktop_required"
  | "merge_conflict"
  | "sse_refresh"
  | "budget_warning"
  | "field_value_required"
  | "intake_option_required";
type RouteNoticeTone = "info" | "success" | "warning" | "danger";
type RouteNoticeSource = "client" | "rest" | "sse";
type RouteNoticeVM = {
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
type LiveStreamTarget = {
  key: string;
  url: string;
};
type IdentityLocaleCarrier = {
  locale?: unknown;
  preferences?: {
    locale?: unknown;
  };
} | null | undefined;
let noticeTimer: number | undefined;
let readyRouteBindings: AbortController | undefined;
let liveRefreshTimer: number | undefined;
let liveEventCount = 0;
let liveRefreshCount = 0;

const liveRefreshDebounceMs = 220;
const liveEventTypes = Object.values(eventTypes);

function browserLocale(): WorkHubLocale {
  return normalizeWorkHubLocale(window.localStorage.getItem(workHubLocaleStorageKey) ?? window.navigator.language);
}

function setDocumentLocale(locale: WorkHubLocale) {
  document.documentElement.lang = locale;
}

function isWorkHubLocale(value: unknown): value is WorkHubLocale {
  return value === "zh-CN" || value === "en-US";
}

function identityLocale(identity: IdentityLocaleCarrier): WorkHubLocale | undefined {
  const locale = identity?.preferences?.locale ?? identity?.locale;
  return isWorkHubLocale(locale) ? locale : undefined;
}

function persistBrowserLocale(locale: WorkHubLocale) {
  window.localStorage.setItem(workHubLocaleStorageKey, locale);
  setDocumentLocale(locale);
}

function eventListenerOptions(signal?: AbortSignal): AddEventListenerOptions | undefined {
  return signal ? { signal } : undefined;
}

function setLiveMetric(key: string, value: unknown) {
  document.documentElement.dataset[key] = String(value);
}

function noteLiveStreamTargets(targets: LiveStreamTarget[]) {
  setLiveMetric("r4LiveStreams", targets.map((target) => target.key).join(","));
  setLiveMetric("r4LiveStreamCount", targets.length);
}

function uniqueLiveStreamTargets(targets: LiveStreamTarget[]) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.url)) {
      return false;
    }
    seen.add(target.url);
    return true;
  });
}

function applyIdentityLocale(identity: IdentityLocaleCarrier, fallback: WorkHubLocale): WorkHubLocale {
  const locale = identityLocale(identity) ?? fallback;
  persistBrowserLocale(locale);
  return locale;
}

function liveStreamTargetsForRoute(result: WebRouteReadyResult, client: BrowserApiClient): LiveStreamTarget[] {
  const targets: LiveStreamTarget[] = [{ key: "me", url: client.streams.me() }];
  if (result.match.key === "intake") {
    const sessionId = result.match.params["sessionId"];
    if (sessionId) {
      targets.push({ key: "session", url: client.streams.session(sessionId) });
    }
  } else if (result.match.key === "workitem") {
    const workItemId = result.match.params["id"];
    if (workItemId) {
      targets.push({ key: "workitem", url: client.streams.workItem(workItemId) });
    }
  } else if (result.match.key === "proposal") {
    const proposalId = result.match.params["id"];
    const workItemId = result.surface.page_vms.proposal.work_item_id;
    if (proposalId) {
      targets.push({ key: "proposal", url: client.streams.proposal(proposalId) });
    }
    if (workItemId) {
      targets.push({ key: "workitem", url: client.streams.workItem(workItemId) });
    }
  } else if (result.match.key === "replay") {
    const runId = result.match.params["id"];
    const workItemId = result.surface.page_vms.replay.run.work_item_id;
    if (runId) {
      targets.push({ key: "run", url: client.streams.run(runId) });
    }
    if (workItemId) {
      targets.push({ key: "workitem", url: client.streams.workItem(workItemId) });
    }
  }
  return uniqueLiveStreamTargets(targets);
}

async function resolveBootLocale(client: BrowserApiClient, fallback: WorkHubLocale) {
  const me = await client.me().catch(() => null);
  return applyIdentityLocale(me, fallback);
}

function bindLocaleSwitch(shellRoot: HTMLElement, locale: WorkHubLocale, client: BrowserApiClient, signal?: AbortSignal) {
  shellRoot.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-wh-locale]") : null;
    if (!button) {
      return;
    }
    const nextLocale = normalizeWorkHubLocale(button.dataset.whLocale);
    if (nextLocale === locale) {
      return;
    }
    persistBrowserLocale(nextLocale);
    void client.updatePreferences({ locale: nextLocale }).catch(() => undefined).finally(() => {
      window.location.reload();
    });
  }, eventListenerOptions(signal));
}

function resetNoticeDataset(notice: HTMLElement) {
  delete notice.dataset.r4NoticeActionId;
  delete notice.dataset.r4NoticeEventType;
  delete notice.dataset.r4NoticeStream;
}

function showRouteNotice(shellRoot: HTMLElement, vm: RouteNoticeVM, extraHtml?: string, timeoutMs = 4600) {
  const notice = shellRoot.querySelector<HTMLElement>("[data-wh-app-notice]");
  if (!notice) {
    return;
  }
  if (noticeTimer !== undefined) {
    window.clearTimeout(noticeTimer);
    noticeTimer = undefined;
  }
  resetNoticeDataset(notice);
  notice.dataset.r4RouteNotice = "true";
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
  if (timeoutMs > 0) {
    noticeTimer = window.setTimeout(() => {
      notice.hidden = true;
      noticeTimer = undefined;
    }, timeoutMs);
  }
}

function actionSuccessNotice(locale: WorkHubLocale, body: string, actionId?: string): RouteNoticeVM {
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

function actionErrorNotice(locale: WorkHubLocale, error: unknown, actionId?: string): RouteNoticeVM {
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

function actionPendingNotice(locale: WorkHubLocale, actionId?: string): RouteNoticeVM {
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

function desktopRequiredNotice(locale: WorkHubLocale, actionId?: string): RouteNoticeVM {
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

function reasonRequiredNotice(locale: WorkHubLocale, actionId?: string): RouteNoticeVM {
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

function fieldValueRequiredNotice(locale: WorkHubLocale, actionId?: string): RouteNoticeVM {
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

function intakeOptionRequiredNotice(locale: WorkHubLocale, actionId?: string): RouteNoticeVM {
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

function selectionNotice(locale: WorkHubLocale, label: string): RouteNoticeVM {
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

function mergeConflictNotice(locale: WorkHubLocale, actionId?: string): RouteNoticeVM {
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

function sseRefreshNotice(locale: WorkHubLocale, eventType: string, stream: string): RouteNoticeVM {
  if (eventType === eventTypes.budgetWarning) {
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

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function setActivePage(shellRoot: HTMLElement, shell: GoldPathAppShell, pageKey: string) {
  for (const panel of shellRoot.querySelectorAll<HTMLElement>("[data-wh-panel]")) {
    panel.hidden = panel.dataset.whPanel !== pageKey;
  }
  for (const link of shellRoot.querySelectorAll<HTMLAnchorElement>("[data-wh-page-key]")) {
    link.setAttribute("aria-current", link.dataset.whPageKey === pageKey ? "page" : "false");
  }
  const route = Object.entries(shell.routeMap).find(([, key]) => key === pageKey)?.[0];
  if (route && window.location.hash !== `#${route}`) {
    window.history.replaceState(null, "", `#${route}`);
  }
}

function proposalActionFromHref(href: string) {
  const path = new URL(href, window.location.origin).pathname;
  const match = /^\/api\/proposals\/([^/]+)\/(review|merge)$/u.exec(path);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return { proposalId: decodeURIComponent(match[1]), action: match[2] as "review" | "merge" };
}

function approvalRespondIdFromHref(href: string) {
  const path = new URL(href, window.location.origin).pathname;
  const match = /^\/api\/approvals\/([^/]+)\/respond$/u.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function mergeProposalCandidateApplyIdFromHref(href: string) {
  const path = new URL(href, window.location.origin).pathname;
  const match = /^\/api\/merge-proposals\/([^/]+)\/apply$/u.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function sessionNextQuestionIdFromHref(href: string) {
  const path = new URL(href, window.location.origin).pathname;
  const match = /^\/api\/sessions\/([^/]+)\/next-question$/u.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function createWorkItemActionFromHref(href: string) {
  const path = new URL(href, window.location.origin).pathname;
  return path === "/api/workitems";
}

function evidenceBindingWorkItemIdFromHref(href: string) {
  const path = new URL(href, window.location.origin).pathname;
  const match = /^\/api\/workitems\/([^/]+)\/evidence-bindings$/u.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function actionHrefFromElement(element: HTMLElement) {
  if (element instanceof HTMLAnchorElement) {
    return element.getAttribute("href") ?? "";
  }
  return element.dataset.actionHref ?? element.dataset.href ?? "";
}

function replaceCustomFieldPlaceholder(value: unknown, customValue: string): unknown {
  if (value === "__WORKHUB_CUSTOM_FIELD_VALUE__") {
    return customValue;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceCustomFieldPlaceholder(item, customValue));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceCustomFieldPlaceholder(item, customValue)])
    );
  }
  return value;
}

function hasCustomFieldPlaceholder(value: unknown): boolean {
  if (value === "__WORKHUB_CUSTOM_FIELD_VALUE__") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasCustomFieldPlaceholder);
  }
  return Boolean(
    value &&
      typeof value === "object" &&
      Object.values(value).some(hasCustomFieldPlaceholder)
  );
}

function customFieldValueForElement(element: HTMLElement) {
  const field = element.dataset.structuredField;
  if (!field) {
    return "";
  }
  const row = element.closest<HTMLElement>("[data-proposal-structured-field-editor-row]");
  const input = row?.querySelector<HTMLTextAreaElement>(`[data-structured-field-custom-input="${CSS.escape(field)}"]`);
  return input?.value.trim() ?? "";
}

type ActionPayloadResult<T> =
  | { ok: true; payload?: T }
  | { ok: false; reason: "field_value_required" | "intake_option_required" | "invalid_json" };

function actionElementJsonPayload<T>(element: HTMLElement): ActionPayloadResult<T> {
  const raw = element.dataset.requestJson ?? element.dataset.requestJsonTemplate;
  if (!raw) {
    return { ok: true };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (hasCustomFieldPlaceholder(parsed)) {
      const customValue = customFieldValueForElement(element);
      if (!customValue) {
        return { ok: false, reason: "field_value_required" };
      }
      const materialized = replaceCustomFieldPlaceholder(parsed, customValue);
      element.dataset.requestJson = JSON.stringify(materialized);
      return { ok: true, payload: materialized as T };
    }
    return { ok: true, payload: parsed as T };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

function actionElementMergePayload(element: HTMLElement): ActionPayloadResult<MergeProposalRequest> {
  return actionElementJsonPayload<MergeProposalRequest>(element);
}

function actionElementApplyPayload(element: HTMLElement): ActionPayloadResult<ApplyMergeProposalCandidateRequest> {
  return actionElementJsonPayload<ApplyMergeProposalCandidateRequest>(element);
}

function selectedIntakeOptionIds(scope: ParentNode) {
  return Array.from(scope.querySelectorAll<HTMLElement>("[data-intake-option-selected=\"true\"]"))
    .map((option) => option.dataset.intakeOptionId ?? option.dataset.optionId ?? "")
    .filter((value) => value.length > 0);
}

function updateIntakeActionPayloads(route: HTMLElement) {
  const selected = selectedIntakeOptionIds(route);
  route.dataset.r4IntakeSelectedCount = String(selected.length);
  for (const action of route.querySelectorAll<HTMLElement>("[data-intake-submit],[data-intake-create-workitem]")) {
    const base = actionElementJsonPayload<Record<string, unknown>>(action);
    const payload = base.ok && base.payload && typeof base.payload === "object" ? { ...base.payload } : {};
    payload["selected_option_ids"] = selected;
    if (action.dataset.intakeCreateWorkitem === "true") {
      payload["session_id"] = action.dataset.sessionId;
    }
    const raw = JSON.stringify(payload);
    action.dataset.requestJson = raw;
    action.setAttribute("data-request-json", raw);
  }
}

function materializeIntakePayload<T>(element: HTMLElement): ActionPayloadResult<T> {
  const route = element.closest<HTMLElement>("[data-r4-route-component=\"intake\"]");
  if (!route) {
    return actionElementJsonPayload<T>(element);
  }
  updateIntakeActionPayloads(route);
  const selected = selectedIntakeOptionIds(route);
  const optionCount = Number.parseInt(route.dataset.r4IntakeOptionCount ?? "0", 10);
  if (optionCount > 0 && selected.length === 0) {
    return { ok: false, reason: "intake_option_required" };
  }
  return actionElementJsonPayload<T>(element);
}

function actionElementNextQuestionPayload(element: HTMLElement): ActionPayloadResult<NextQuestionRequest> {
  return materializeIntakePayload<NextQuestionRequest>(element);
}

function actionElementCreateWorkItemPayload(element: HTMLElement): ActionPayloadResult<CreateWorkItemRequest> {
  return materializeIntakePayload<CreateWorkItemRequest>(element);
}

function actionElementEvidenceBindingPayload(element: HTMLElement): ActionPayloadResult<UseEvidenceForTaskRequest> {
  return actionElementJsonPayload<UseEvidenceForTaskRequest>(element);
}

function showPayloadFailureNotice(
  shellRoot: HTMLElement,
  locale: WorkHubLocale,
  payload: ActionPayloadResult<unknown>,
  actionId?: string
) {
  if (payload.ok) {
    return false;
  }
  if (payload.reason === "field_value_required") {
    showRouteNotice(shellRoot, fieldValueRequiredNotice(locale, actionId));
  } else if (payload.reason === "intake_option_required") {
    showRouteNotice(shellRoot, intakeOptionRequiredNotice(locale, actionId));
  } else {
    showRouteNotice(shellRoot, actionErrorNotice(locale, new Error(goldPathT(locale, "runtime.actionFail")), actionId));
  }
  return true;
}

function conflictsFromMergeError(error: unknown): ProposalConflict[] {
  if (!(error instanceof WorkHubApiError) || error.code !== "merge_conflict") {
    return [];
  }
  const candidates = [error.details];
  if (error.details && typeof error.details === "object" && !Array.isArray(error.details)) {
    const record = error.details as Record<string, unknown>;
    candidates.push(record.details);
    const nested = record.error;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      candidates.push((nested as Record<string, unknown>).details);
    }
  }
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const conflicts = (candidate as Record<string, unknown>).conflicts;
      if (Array.isArray(conflicts)) {
        return conflicts as ProposalConflict[];
      }
    }
  }
  return [];
}

function showMergeConflictNotice(shellRoot: HTMLElement, error: unknown, locale: WorkHubLocale, actionId?: string) {
  const conflicts = conflictsFromMergeError(error);
  if (conflicts.length === 0) {
    return false;
  }
  const rendered = renderProposalConflictCards(conflicts, { locale });
  showRouteNotice(shellRoot, mergeConflictNotice(locale, actionId), rendered.html, 0);
  return true;
}

function reviewReasonButtons(locale: WorkHubLocale) {
  const reasons = [
    goldPathT(locale, "runtime.reason.evidence"),
    goldPathT(locale, "runtime.reason.tone"),
    goldPathT(locale, "runtime.reason.scope")
  ];
  return `<div class="wh-app-action-row">${reasons
    .map((reason) => `<button type="button" data-review-reason="${escapeHtml(reason)}">${escapeHtml(reason)}</button>`)
    .join("")}</div>`;
}

function actionMessage(error: unknown, locale: WorkHubLocale) {
  return error instanceof Error ? error.message : goldPathT(locale, "runtime.actionFail");
}

function actionSummary(result: unknown, locale: WorkHubLocale) {
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

function datasetInt(element: HTMLElement, key: string) {
  const value = element.dataset[key];
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function updateLineEditorPanelPayload(panel: HTMLElement) {
  const hunks = Array.from(panel.querySelectorAll<HTMLElement>("[data-line-editor-hunk]")).flatMap((hunk) => {
    const selected = hunk.querySelector<HTMLButtonElement>("[data-line-editor-decision-selected=\"true\"]")
      ?? hunk.querySelector<HTMLButtonElement>("[data-line-editor-decision]");
    const hunkIndex = datasetInt(hunk, "lineEditorHunkIndex");
    const startLine = datasetInt(hunk, "lineEditorStartLine");
    const endLine = datasetInt(hunk, "lineEditorEndLine");
    const decision = selected?.dataset.lineEditorDecision;
    return hunkIndex !== undefined && startLine !== undefined && endLine !== undefined && decision
      ? [{ hunk_index: hunkIndex, start_line: startLine, end_line: endLine, decision }]
      : [];
  });
  const apply = panel.querySelector<HTMLAnchorElement>("[data-line-editor-apply]");
  if (!apply || hunks.length === 0) {
    return;
  }
  const requestJson = JSON.stringify({ confirm: true, text_hunk_overrides: { hunks } });
  apply.dataset.requestJson = requestJson;
  apply.setAttribute("data-request-json", requestJson);
}

function activateLineEditorPanel(tab: HTMLButtonElement) {
  const editor = tab.closest<HTMLElement>("[data-route-line-editor]");
  const panelId = tab.dataset.lineEditorPanelId;
  if (!editor || !panelId) {
    return;
  }
  for (const item of editor.querySelectorAll<HTMLButtonElement>("[data-line-editor-tab]")) {
    const active = item === tab;
    item.setAttribute("aria-selected", String(active));
    item.tabIndex = active ? 0 : -1;
  }
  for (const panel of editor.querySelectorAll<HTMLElement>("[data-line-editor-panel]")) {
    panel.hidden = panel.id !== panelId;
  }
  editor.querySelector<HTMLElement>(`#${CSS.escape(panelId)}`)?.querySelector<HTMLInputElement>("[data-line-editor-search]")?.focus();
}

function applyLineEditorSearch(input: HTMLInputElement) {
  const panel = input.closest<HTMLElement>("[data-line-editor-panel]");
  if (!panel) {
    return;
  }
  const query = input.value.trim().toLowerCase();
  let visibleCount = 0;
  for (const row of panel.querySelectorAll<HTMLElement>("[data-line-editor-row]")) {
    const text = `${row.dataset.lineEditorRowText ?? ""} ${row.textContent ?? ""}`.toLowerCase();
    const visible = query.length === 0 || text.includes(query);
    row.hidden = !visible;
    if (visible) {
      visibleCount += 1;
    }
  }
  panel.dataset.lineEditorMatchCount = String(visibleCount);
  const badge = panel.querySelector<HTMLElement>("[data-line-editor-match-count]");
  if (badge) {
    badge.textContent = String(visibleCount);
  }
}

function bindRouteLineEditor(shellRoot: HTMLElement, signal?: AbortSignal) {
  shellRoot.addEventListener("click", (event) => {
    const tab = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-line-editor-tab]") : null;
    if (tab) {
      event.preventDefault();
      activateLineEditorPanel(tab);
      return;
    }
    const decision = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-line-editor-decision]") : null;
    if (!decision) {
      return;
    }
    const hunk = decision.closest<HTMLElement>("[data-line-editor-hunk]");
    const panel = decision.closest<HTMLElement>("[data-line-editor-panel]");
    if (!hunk || !panel) {
      return;
    }
    for (const sibling of hunk.querySelectorAll<HTMLButtonElement>("[data-line-editor-decision]")) {
      const selected = sibling === decision;
      sibling.dataset.lineEditorDecisionSelected = String(selected);
      sibling.setAttribute("aria-pressed", String(selected));
    }
    updateLineEditorPanelPayload(panel);
  }, eventListenerOptions(signal));

  shellRoot.addEventListener("input", (event) => {
    const input = event.target instanceof Element ? event.target.closest<HTMLInputElement>("[data-line-editor-search]") : null;
    if (input) {
      applyLineEditorSearch(input);
    }
  }, eventListenerOptions(signal));

  shellRoot.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    const hunk = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-line-editor-hunk]") : null;
    const panel = hunk?.closest<HTMLElement>("[data-line-editor-panel]");
    if (!hunk || !panel) {
      return;
    }
    const hunks = Array.from(panel.querySelectorAll<HTMLElement>("[data-line-editor-hunk]"));
    const index = hunks.indexOf(hunk);
    const nextIndex = event.key === "ArrowDown" ? index + 1 : index - 1;
    const next = hunks[nextIndex];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }, eventListenerOptions(signal));
}

function bindGoldPathNavigation(
  shellRoot: HTMLElement,
  shell: GoldPathAppShell,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  onNavigate?: (href: string, pageKey: string) => void | Promise<void>,
  signal?: AbortSignal
) {
  let pendingReviewHref: string | undefined;
  let pendingReviewActionId: string | undefined;
  let pendingApprovalId: string | undefined;
  let pendingApprovalActionId: string | undefined;

  const activateFromHash = () => {
    const hashRoute = window.location.hash.slice(1) || "/";
    const pageKey = resolveGoldPathPageKey(shell.routeMap, hashRoute);
    if (pageKey) {
      setActivePage(shellRoot, shell, pageKey);
    }
  };

  shellRoot.addEventListener("click", async (event) => {
    const reasonButton = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-review-reason]") : null;
    if (reasonButton && (pendingReviewHref || pendingApprovalId)) {
      event.preventDefault();
      const reasonMd = reasonButton.dataset.reviewReason ?? goldPathT(locale, "runtime.reason.format");
      const proposalAction = pendingReviewHref ? proposalActionFromHref(pendingReviewHref) : undefined;
      if (proposalAction?.action === "review") {
        try {
          const result = await client.reviewProposal(proposalAction.proposalId, {
            decision: "request_changes",
            reason_md: reasonMd,
            remember: "once"
          });
          showRouteNotice(shellRoot, actionSuccessNotice(locale, result.attention.summary_text, pendingReviewActionId ?? "request_changes"));
          pendingReviewHref = undefined;
          pendingReviewActionId = undefined;
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, pendingReviewActionId ?? "request_changes"));
        }
      }
      if (pendingApprovalId) {
        try {
          const result = await client.respondApproval(pendingApprovalId, {
            decision: "deny",
            reason_md: reasonMd,
            remember: "once"
          });
          showRouteNotice(shellRoot, actionSuccessNotice(locale, actionSummary(result, locale), pendingApprovalActionId ?? "deny"));
          pendingApprovalId = undefined;
          pendingApprovalActionId = undefined;
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, pendingApprovalActionId ?? "deny"));
        }
      }
      return;
    }

    const option = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-option-id]") : null;
    if (option) {
      event.preventDefault();
      const intakeRoute = option.closest<HTMLElement>("[data-r4-route-component=\"intake\"]");
      if (intakeRoute && option.dataset.intakeOptionId) {
        const allowMulti = option.dataset.intakeOptionMulti === "true";
        if (!allowMulti) {
          for (const sibling of intakeRoute.querySelectorAll<HTMLElement>("[data-intake-option-id]")) {
            const selected = sibling === option;
            sibling.dataset.intakeOptionSelected = String(selected);
            sibling.setAttribute("aria-pressed", String(selected));
          }
        } else {
          const selected = option.dataset.intakeOptionSelected !== "true";
          option.dataset.intakeOptionSelected = String(selected);
          option.setAttribute("aria-pressed", String(selected));
        }
        updateIntakeActionPayloads(intakeRoute);
      }
      showRouteNotice(shellRoot, selectionNotice(locale, option.querySelector("strong")?.textContent ?? option.dataset.optionId ?? ""));
      return;
    }

    const actionTarget = event.target instanceof Element
      ? event.target.closest<HTMLElement>("a[href],[data-action-href],[data-href]")
      : null;
    if (!actionTarget) {
      return;
    }
    const href = actionHrefFromElement(actionTarget);
    if (!href) {
      return;
    }
    const actionId = actionTarget.dataset.actionId;
    if (actionTarget.dataset.requiresDesktop === "true") {
      event.preventDefault();
      showRouteNotice(shellRoot, desktopRequiredNotice(locale, actionId));
      return;
    }
    const action = classifyGoldPathHref(shell.routeMap, href, {
      requiresReason: actionTarget.dataset.requiresReason === "true",
      method: actionTarget.dataset.method
    });
    if (action.kind === "navigate") {
      event.preventDefault();
      if (onNavigate) {
        void Promise.resolve(onNavigate(href, action.pageKey)).catch((error) => renderFatalRouteError(locale, error));
        return;
      }
      setActivePage(shellRoot, shell, action.pageKey);
      return;
    }
    if (action.kind === "api-action") {
      event.preventDefault();
      const sessionId = sessionNextQuestionIdFromHref(href);
      if (sessionId) {
        const payload = actionElementNextQuestionPayload(actionTarget);
        if (!payload.ok) {
          showPayloadFailureNotice(shellRoot, locale, payload, actionId);
          return;
        }
        try {
          await client.nextQuestion(sessionId, payload.payload);
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, goldPathT(locale, "runtime.notice.actionSuccessTitle"), actionId));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      if (createWorkItemActionFromHref(href) && actionTarget.dataset.intakeCreateWorkitem === "true") {
        const payload = actionElementCreateWorkItemPayload(actionTarget);
        if (!payload.ok || !payload.payload) {
          showPayloadFailureNotice(shellRoot, locale, payload.ok ? { ok: false, reason: "invalid_json" } : payload, actionId);
          return;
        }
        try {
          const created = await client.createWorkItem(payload.payload);
          await navigateWebRoute(`/workitems/${created.workitem.id}`, client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(created, locale), actionId));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      const evidenceWorkItemId = evidenceBindingWorkItemIdFromHref(href);
      if (evidenceWorkItemId) {
        const payload = actionElementEvidenceBindingPayload(actionTarget);
        if (!payload.ok || !payload.payload) {
          showPayloadFailureNotice(shellRoot, locale, payload.ok ? { ok: false, reason: "invalid_json" } : payload, actionId);
          return;
        }
        try {
          const result = await client.useEvidenceForWorkItem(evidenceWorkItemId, payload.payload);
          showRouteNotice(shellRoot, actionSuccessNotice(locale, actionSummary(result, locale), actionId));
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      const mergeProposalCandidateApplyId = mergeProposalCandidateApplyIdFromHref(href);
      if (mergeProposalCandidateApplyId) {
        const payload = actionElementApplyPayload(actionTarget);
        if (!payload.ok) {
          showPayloadFailureNotice(shellRoot, locale, payload, actionId);
          return;
        }
        try {
          const merge = await client.applyMergeProposalCandidate(mergeProposalCandidateApplyId, payload.payload);
          showRouteNotice(shellRoot, actionSuccessNotice(locale, merge.attention.summary_text, actionId));
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      const approvalRespondId = approvalRespondIdFromHref(href);
      if (approvalRespondId) {
        if (action.requiresReason || actionId === "deny") {
          pendingApprovalId = approvalRespondId;
          pendingApprovalActionId = actionId ?? "deny";
          showRouteNotice(shellRoot, reasonRequiredNotice(locale, pendingApprovalActionId), reviewReasonButtons(locale));
          return;
        }
        try {
          const result = await client.respondApproval(approvalRespondId, { decision: "allow", remember: "once" });
          showRouteNotice(shellRoot, actionSuccessNotice(locale, actionSummary(result, locale), actionId ?? "approve"));
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId ?? "approve"));
        }
        return;
      }
      const proposalAction = proposalActionFromHref(href);
      if (proposalAction?.action === "review") {
        if (action.requiresReason) {
          pendingReviewHref = href;
          pendingReviewActionId = actionId ?? "request_changes";
          showRouteNotice(shellRoot, reasonRequiredNotice(locale, pendingReviewActionId), reviewReasonButtons(locale));
          return;
        }
        try {
          const review = await client.reviewProposal(proposalAction.proposalId, { decision: "approve", remember: "once" });
          const merge = await client.mergeProposal(proposalAction.proposalId);
          showRouteNotice(shellRoot, actionSuccessNotice(locale, `${review.attention.summary_text} ${merge.attention.summary_text}`, actionId));
        } catch (error) {
          if (!showMergeConflictNotice(shellRoot, error, locale, actionId)) {
            showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
          }
        }
        return;
      }
      if (proposalAction?.action === "merge") {
        const payload = actionElementMergePayload(actionTarget);
        if (!payload.ok) {
          showPayloadFailureNotice(shellRoot, locale, payload, actionId);
          return;
        }
        try {
          const merge = await client.mergeProposal(proposalAction.proposalId, payload.payload);
          showRouteNotice(shellRoot, actionSuccessNotice(locale, merge.attention.summary_text, actionId));
        } catch (error) {
          if (!showMergeConflictNotice(shellRoot, error, locale, actionId)) {
            showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
          }
        }
        return;
      }
      showRouteNotice(shellRoot, actionPendingNotice(locale, actionId));
    }
  }, eventListenerOptions(signal));

  if (!onNavigate) {
    window.addEventListener("hashchange", activateFromHash, eventListenerOptions(signal));
    activateFromHash();
  }
}

let activeRouteRenderId = 0;

function currentRouteMatch() {
  const route = `${window.location.pathname}${window.location.search}`;
  return resolveWebRoute(route) ?? createUnknownWebRouteMatch(route);
}

function routeErrorTrace(error: unknown) {
  if (error instanceof WorkHubApiError) {
    return `status=${error.status} code=${error.code}`;
  }
  return error instanceof Error ? error.message.slice(0, 140) : "web_route_boot_error";
}

function renderFatalRouteError(locale: WorkHubLocale, error: unknown) {
  if (!root) {
    return;
  }
  clearReadyRouteBindings();
  root.innerHTML = renderWebRouteState(currentRouteMatch(), "error", locale, {
    traceId: routeErrorTrace(error)
  }).html;
}

function scheduleLiveRouteRefresh(client: BrowserApiClient, locale: WorkHubLocale, eventType: string, targetKey: string) {
  liveEventCount += 1;
  setLiveMetric("r4LiveEventCount", liveEventCount);
  setLiveMetric("r4LiveLastEvent", eventType);
  setLiveMetric("r4LiveLastStream", targetKey);
  if (liveRefreshTimer !== undefined) {
    return;
  }
  liveRefreshTimer = window.setTimeout(() => {
    liveRefreshTimer = undefined;
    liveRefreshCount += 1;
    setLiveMetric("r4LiveRefreshCount", liveRefreshCount);
    void renderCurrentRoute(client, locale)
      .then(() => {
        if (root) {
          showRouteNotice(root, sseRefreshNotice(locale, eventType, targetKey), undefined, 3600);
        }
      })
      .catch((error) => renderFatalRouteError(locale, error));
  }, liveRefreshDebounceMs);
}

function bindLiveEventSource(
  target: LiveStreamTarget,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal
) {
  if (typeof EventSource === "undefined") {
    setLiveMetric("r4LiveSseSupported", false);
    return;
  }
  setLiveMetric("r4LiveSseSupported", true);
  const source = new EventSource(target.url, { withCredentials: true });
  signal.addEventListener("abort", () => source.close(), { once: true });
  source.addEventListener("connected", () => {
    const connected = Number(document.documentElement.dataset.r4LiveConnectedCount ?? "0") + 1;
    setLiveMetric("r4LiveConnectedCount", connected);
    setLiveMetric("r4LiveLastConnectedStream", target.key);
  });
  source.addEventListener("error", () => {
    setLiveMetric("r4LiveLastErrorStream", target.key);
  });
  for (const eventType of liveEventTypes) {
    source.addEventListener(eventType, () => scheduleLiveRouteRefresh(client, locale, eventType, target.key));
  }
}

function bindLiveRouteStreams(result: WebRouteReadyResult, client: BrowserApiClient, locale: WorkHubLocale, signal: AbortSignal) {
  const targets = liveStreamTargetsForRoute(result, client);
  noteLiveStreamTargets(targets);
  for (const target of targets) {
    bindLiveEventSource(target, client, locale, signal);
  }
}

async function navigateWebRoute(href: string, client: BrowserApiClient, locale: WorkHubLocale) {
  const nextHref = webRouteHref(href);
  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextHref !== currentHref) {
    window.history.pushState(null, "", nextHref);
  }
  await renderCurrentRoute(client, locale);
}

function bindReadyRoute(result: WebRouteReadyResult, client: BrowserApiClient, locale: WorkHubLocale) {
  if (!root) {
    return;
  }
  clearReadyRouteBindings();
  readyRouteBindings = new AbortController();
  const { signal } = readyRouteBindings;
  bindLocaleSwitch(root, locale, client, signal);
  bindRouteLineEditor(root, signal);
  bindGoldPathNavigation(root, result.shell, client, locale, (href) => navigateWebRoute(href, client, locale), signal);
  bindLiveRouteStreams(result, client, locale, signal);
}

async function renderCurrentRoute(client: BrowserApiClient, locale: WorkHubLocale) {
  if (!root) {
    return;
  }
  const renderId = ++activeRouteRenderId;
  const match = currentRouteMatch();
  clearReadyRouteBindings();
  root.innerHTML = renderWebRouteState(match, "loading", locale).html;
  const result = await loadWebRoute(client, match, locale);
  if (renderId !== activeRouteRenderId) {
    return;
  }
  root.innerHTML = result.html;
  if (result.status === "ready") {
    bindReadyRoute(result, client, locale);
  }
}

function clearReadyRouteBindings() {
  readyRouteBindings?.abort();
  readyRouteBindings = undefined;
  if (liveRefreshTimer !== undefined) {
    window.clearTimeout(liveRefreshTimer);
    liveRefreshTimer = undefined;
  }
}

async function boot() {
  if (!root) {
    return;
  }
  let locale = browserLocale();
  setDocumentLocale(locale);
  root.innerHTML = renderWebRouteState(currentRouteMatch(), "idle", locale).html;

  try {
    const client = createApiClient({ baseUrl: "" });
    locale = await resolveBootLocale(client, locale);
    try {
      await renderCurrentRoute(client, locale);
    } catch (error) {
      if (!(error instanceof WorkHubApiError) || error.code !== "not_identified") {
        throw error;
      }
      locale = applyIdentityLocale(await client.identify({ nickname: "P0.5 Reviewer" }), locale);
      await renderCurrentRoute(client, locale);
    }
    window.addEventListener("popstate", () => {
      void renderCurrentRoute(client, locale).catch((error) => renderFatalRouteError(locale, error));
    });
  } catch (error) {
    renderFatalRouteError(locale, error);
  }
}

void boot();
