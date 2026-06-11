import { createApiClient, WorkHubApiError } from "@workhub/api-client/client";
import { eventTypes } from "@workhub/contracts";
import {
  classifyGoldPathHref,
  goldPathT,
  normalizeWorkHubLocale,
  resolveGoldPathPageKey,
  type GoldPathAppShell,
  type WorkHubLocale
} from "@workhub/ui/gold-path";
import { renderProposalConflictCards } from "@workhub/ui/proposal";
import {
  acceptedDeliverableRestoreFromHref,
  actionElementApplyPayload,
  actionElementCreateWorkItemPayload,
  actionElementEvidenceBindingPayload,
  actionElementMergePayload,
  actionElementNextQuestionPayload,
  actionErrorNotice,
  actionHrefFromElement,
  actionPendingNotice,
  actionSuccessNotice,
  actionSummary,
  activeRouteHasDirtyEdits as sharedActiveRouteHasDirtyEdits,
  applyIdentityLocale,
  approvalRespondIdFromHref,
  bindRouteLineEditor,
  browserLocale,
  clearActiveRouteDirty as sharedClearActiveRouteDirty,
  clearLiveDirtyMetrics as sharedClearLiveDirtyMetrics,
  conflictsFromMergeError,
  createWebLiveRuntime,
  createWorkItemActionFromHref,
  desktopRequiredNotice,
  dirtyGuardRefreshAction,
  eventListenerOptions,
  evidenceBindingWorkItemIdFromHref,
  fieldValueRequiredNotice,
  intakeOptionRequiredNotice,
  localePersistenceFailedNotice,
  markActiveRouteDirty as sharedMarkActiveRouteDirty,
  mergeConflictNotice,
  mergeProposalCandidateApplyIdFromHref,
  persistBrowserLocale,
  proposalActionFromHref,
  reasonRequiredNotice,
  reviewReasonButtons,
  selectionNotice,
  sessionNextQuestionIdFromHref,
  setDocumentLocale,
  showRouteNotice as showSharedRouteNotice,
  sseDirtyGuardNotice,
  sseRefreshNotice,
  updateIntakeActionPayloads,
  type ActionPayloadResult,
  type RouteNoticeTimerState,
  type RouteNoticeVM,
  type WebLiveStreamTarget
} from "@workhub/web-runtime";
import {
  createUnknownWebRouteMatch,
  loadWebRoute,
  renderWebRouteState,
  resolveWebRoute,
  webRouteHref,
  type WebRouteReadyResult
} from "./routes.js";
import {
  hasMountedReactRoute,
  mountReactRouteIsland,
  unmountReactRouteIsland
} from "./react-route-mount.js";

const root = document.getElementById("root");
const liveLastEventIdStorageKey = "workhub.live.lastEventId";
type BrowserApiClient = ReturnType<typeof createApiClient>;
const noticeTimerState: RouteNoticeTimerState = {};
let readyRouteBindings: AbortController | undefined;
let liveDirtyGuardCount = 0;
let liveRuntime: ReturnType<typeof createWebLiveRuntime> | undefined;
const liveEventTypes = Object.values(eventTypes);

function setLiveMetric(key: string, value: unknown) {
  document.documentElement.dataset[key] = String(value);
}

function readStoredLiveLastEventId() {
  try {
    return window.sessionStorage.getItem(liveLastEventIdStorageKey) ?? "";
  } catch {
    return "";
  }
}

function persistLiveLastEventId(eventId: string) {
  try {
    window.sessionStorage.setItem(liveLastEventIdStorageKey, eventId);
  } catch {
    setLiveMetric("r4LiveLastEventIdPersisted", false);
    return false;
  }
  setLiveMetric("r4LiveLastEventIdPersisted", true);
  return true;
}

function clearLiveDirtyMetrics() {
  sharedClearLiveDirtyMetrics(setLiveMetric);
}

function markActiveRouteDirty(reason: string) {
  sharedMarkActiveRouteDirty(root, setLiveMetric, reason);
}

function clearActiveRouteDirty() {
  sharedClearActiveRouteDirty(root, setLiveMetric);
}

function activeRouteHasDirtyEdits() {
  return sharedActiveRouteHasDirtyEdits(root);
}

function liveStreamTargetsForRoute(result: WebRouteReadyResult, client: BrowserApiClient): WebLiveStreamTarget[] {
  const targets: WebLiveStreamTarget[] = [{ key: "me", url: client.streams.me() }];
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
    const workItemId = result.surface.key === "proposal" ? result.surface.proposal.work_item_id : undefined;
    if (proposalId) {
      targets.push({ key: "proposal", url: client.streams.proposal(proposalId) });
    }
    if (workItemId) {
      targets.push({ key: "workitem", url: client.streams.workItem(workItemId) });
    }
  } else if (result.match.key === "replay") {
    const runId = result.match.params["id"];
    const workItemId = result.surface.key === "replay" ? result.surface.replay.run.work_item_id : undefined;
    if (runId) {
      targets.push({ key: "run", url: client.streams.run(runId) });
    }
    if (workItemId) {
      targets.push({ key: "workitem", url: client.streams.workItem(workItemId) });
    }
  }
  return targets;
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
    void client.updatePreferences({ locale: nextLocale })
      .then(() => {
        window.location.reload();
      })
      .catch(() => {
        persistBrowserLocale(locale);
        showRouteNotice(shellRoot, localePersistenceFailedNotice(locale, "locale_switch"));
      });
  }, eventListenerOptions(signal));
}

function showRouteNotice(shellRoot: HTMLElement, vm: RouteNoticeVM, extraHtml?: string, timeoutMs = 4600) {
  showSharedRouteNotice(shellRoot, vm, extraHtml, timeoutMs, noticeTimerState);
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

function showMergeConflictNotice(shellRoot: HTMLElement, error: unknown, locale: WorkHubLocale, actionId?: string) {
  const conflicts = conflictsFromMergeError(error);
  if (conflicts.length === 0) {
    return false;
  }
  const rendered = renderProposalConflictCards(conflicts, { locale });
  showRouteNotice(shellRoot, mergeConflictNotice(locale, actionId), rendered.html, 0);
  return true;
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
        markActiveRouteDirty("intake_option");
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
      const acceptedDeliverableRestore = acceptedDeliverableRestoreFromHref(href);
      if (acceptedDeliverableRestore) {
        try {
          const result = await client.restoreAcceptedDeliverable(
            acceptedDeliverableRestore.workItemId,
            acceptedDeliverableRestore.acceptedChangeId
          );
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
          clearActiveRouteDirty();
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
          clearActiveRouteDirty();
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

  shellRoot.addEventListener("input", (event) => {
    const customField = event.target instanceof Element
      ? event.target.closest<HTMLTextAreaElement>("[data-structured-field-custom-input]")
      : null;
    if (customField && customField.value.trim().length > 0) {
      markActiveRouteDirty("proposal_custom_field");
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
  liveRuntime?.closeAllLiveEventSources();
  unmountReactRouteIsland();
  clearLiveDirtyMetrics();
  root.innerHTML = renderWebRouteState(currentRouteMatch(), "error", locale, {
    traceId: routeErrorTrace(error)
  }).html;
}

async function refreshCurrentRouteFromLiveEvent(
  client: BrowserApiClient,
  locale: WorkHubLocale,
  eventType: string,
  targetKey: string
): Promise<"refreshed" | "dirty-deferred"> {
  const match = currentRouteMatch();
  if (match.key === "home" && hasMountedReactRoute("home")) {
    const result = await loadWebRoute(client, match, locale);
    if (result.status === "ready" && result.match.key === "home") {
      const mounted = mountReactRouteIsland(result, locale, "sse-props");
      if (mounted.mounted) {
        setLiveMetric("r4LiveRefreshMode", "react-props");
        setLiveMetric("r4LiveReactPropsEvent", eventType);
        setLiveMetric("r4LiveReactPropsStream", targetKey);
        setLiveMetric("r4LiveReactPropsUpdateCount", mounted.propsUpdateCount);
        return "refreshed";
      }
    }
  }
  if (activeRouteHasDirtyEdits()) {
    liveDirtyGuardCount += 1;
    setLiveMetric("r4LiveRefreshMode", "dirty-deferred");
    setLiveMetric("r4LiveDirtyGuardCount", liveDirtyGuardCount);
    setLiveMetric("r4LiveDirtyPendingEvent", eventType);
    setLiveMetric("r4LiveDirtyPendingStream", targetKey);
    return "dirty-deferred";
  }
  setLiveMetric("r4LiveRefreshMode", "page-vm-render");
  await renderCurrentRoute(client, locale);
  return "refreshed";
}

function createBrowserLiveRuntime(client: BrowserApiClient, locale: WorkHubLocale) {
  setLiveMetric("r4SharedWebRuntime", "@workhub/web-runtime");
  setLiveMetric("r4SharedLiveRuntime", true);
  return createWebLiveRuntime({
    eventTypes: liveEventTypes,
    setMetric: setLiveMetric,
    readCursor: readStoredLiveLastEventId,
    persistCursor: persistLiveLastEventId,
    locationHref: window.location.href,
    onRefresh: (eventType, targetKey) => refreshCurrentRouteFromLiveEvent(client, locale, eventType, targetKey),
    onRefreshNotice: (outcome, eventType, targetKey) => {
      if (!root) {
        return;
      }
      showRouteNotice(
        root,
        outcome === "dirty-deferred"
          ? sseDirtyGuardNotice(locale, eventType, targetKey)
          : sseRefreshNotice(locale, eventType, targetKey),
        outcome === "dirty-deferred" ? dirtyGuardRefreshAction(locale, webRouteHref(window.location.pathname)) : undefined,
        outcome === "dirty-deferred" ? 0 : 3600
      );
    },
    onFatal: (error) => renderFatalRouteError(locale, error)
  });
}

function bindLiveRouteStreams(result: WebRouteReadyResult, client: BrowserApiClient, locale: WorkHubLocale) {
  liveRuntime ??= createBrowserLiveRuntime(client, locale);
  liveRuntime.syncTargets(liveStreamTargetsForRoute(result, client));
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
  setLiveMetric("r4SharedActionRuntime", "notice-payload-line-editor");
  bindLocaleSwitch(root, locale, client, signal);
  bindRouteLineEditor(root, { signal, markDirty: markActiveRouteDirty });
  bindGoldPathNavigation(root, result.shell, client, locale, (href) => navigateWebRoute(href, client, locale), signal);
  bindLiveRouteStreams(result, client, locale);
}

async function renderCurrentRoute(client: BrowserApiClient, locale: WorkHubLocale) {
  if (!root) {
    return;
  }
  const renderId = ++activeRouteRenderId;
  const match = currentRouteMatch();
  clearReadyRouteBindings();
  unmountReactRouteIsland();
  clearLiveDirtyMetrics();
  root.innerHTML = renderWebRouteState(match, "loading", locale).html;
  const result = await loadWebRoute(client, match, locale);
  if (renderId !== activeRouteRenderId) {
    return;
  }
  root.innerHTML = result.html;
  if (result.status === "ready") {
    mountReactRouteIsland(result, locale, "initial");
    bindReadyRoute(result, client, locale);
  }
}

function clearReadyRouteBindings() {
  readyRouteBindings?.abort();
  readyRouteBindings = undefined;
  liveRuntime?.clearRefreshTimer();
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
    window.addEventListener("beforeunload", () => liveRuntime?.closeAllLiveEventSources());
  } catch (error) {
    renderFatalRouteError(locale, error);
  }
}

void boot();
