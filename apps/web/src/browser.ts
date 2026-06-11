import { createApiClient, WorkHubApiError } from "@workhub/api-client/client";
import type { ApplyMergeProposalCandidateRequest, MergeProposalRequest, ProposalConflict } from "@workhub/contracts";
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
type IdentityLocaleCarrier = {
  locale?: unknown;
  preferences?: {
    locale?: unknown;
  };
} | null | undefined;
let noticeTimer: number | undefined;
let readyRouteBindings: AbortController | undefined;

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

function applyIdentityLocale(identity: IdentityLocaleCarrier, fallback: WorkHubLocale): WorkHubLocale {
  const locale = identityLocale(identity) ?? fallback;
  persistBrowserLocale(locale);
  return locale;
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

function showNotice(shellRoot: HTMLElement, message: string, extraHtml?: string, timeoutMs = 4600) {
  const notice = shellRoot.querySelector<HTMLElement>("[data-wh-app-notice]");
  if (!notice) {
    return;
  }
  if (noticeTimer !== undefined) {
    window.clearTimeout(noticeTimer);
    noticeTimer = undefined;
  }
  notice.textContent = message;
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

function mergeProposalCandidateApplyIdFromHref(href: string) {
  const path = new URL(href, window.location.origin).pathname;
  const match = /^\/api\/merge-proposals\/([^/]+)\/apply$/u.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function anchorJsonPayload<T>(anchor: HTMLAnchorElement): T | undefined {
  const raw = anchor.dataset.requestJson;
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function anchorMergePayload(anchor: HTMLAnchorElement): MergeProposalRequest | undefined {
  return anchorJsonPayload<MergeProposalRequest>(anchor);
}

function anchorApplyPayload(anchor: HTMLAnchorElement): ApplyMergeProposalCandidateRequest | undefined {
  return anchorJsonPayload<ApplyMergeProposalCandidateRequest>(anchor);
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

function mergeConflictMessage(locale: WorkHubLocale) {
  return locale === "zh-CN"
    ? "这次变更和正式版本撞车了，先选一个处理方式。"
    : "This change conflicts with the current version. Choose how to continue.";
}

function showMergeConflictNotice(shellRoot: HTMLElement, error: unknown, locale: WorkHubLocale) {
  const conflicts = conflictsFromMergeError(error);
  if (conflicts.length === 0) {
    return false;
  }
  const rendered = renderProposalConflictCards(conflicts, { locale });
  showNotice(shellRoot, mergeConflictMessage(locale), rendered.html, 0);
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

  const activateFromHash = () => {
    const hashRoute = window.location.hash.slice(1) || "/";
    const pageKey = resolveGoldPathPageKey(shell.routeMap, hashRoute);
    if (pageKey) {
      setActivePage(shellRoot, shell, pageKey);
    }
  };

  shellRoot.addEventListener("click", async (event) => {
    const reasonButton = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-review-reason]") : null;
    if (reasonButton && pendingReviewHref) {
      const proposalAction = proposalActionFromHref(pendingReviewHref);
      if (proposalAction?.action === "review") {
        try {
          const result = await client.reviewProposal(proposalAction.proposalId, {
            decision: "request_changes",
            reason_md: reasonButton.dataset.reviewReason ?? "需要调整",
            remember: "once"
          });
          showNotice(shellRoot, result.attention.summary_text);
        } catch (error) {
          showNotice(shellRoot, actionMessage(error, locale));
        }
      }
      return;
    }

    const option = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-option-id]") : null;
    if (option) {
      showNotice(shellRoot, `${goldPathT(locale, "runtime.optionSelectedPrefix")}${option.querySelector("strong")?.textContent ?? option.dataset.optionId}${goldPathT(locale, "runtime.optionSelectedSuffix")}`);
      return;
    }

    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor) {
      return;
    }
    const href = anchor.getAttribute("href") ?? "";
    const action = classifyGoldPathHref(shell.routeMap, href, {
      requiresReason: anchor.dataset.requiresReason === "true",
      method: anchor.dataset.method
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
      const mergeProposalCandidateApplyId = mergeProposalCandidateApplyIdFromHref(href);
      if (mergeProposalCandidateApplyId) {
        try {
          const merge = await client.applyMergeProposalCandidate(mergeProposalCandidateApplyId, anchorApplyPayload(anchor));
          showNotice(shellRoot, merge.attention.summary_text);
        } catch (error) {
          showNotice(shellRoot, actionMessage(error, locale));
        }
        return;
      }
      const proposalAction = proposalActionFromHref(href);
      if (proposalAction?.action === "review") {
        if (action.requiresReason) {
          pendingReviewHref = href;
          showNotice(shellRoot, goldPathT(locale, "runtime.rejectNeedsReason"), reviewReasonButtons(locale));
          return;
        }
        try {
          const review = await client.reviewProposal(proposalAction.proposalId, { decision: "approve", remember: "once" });
          const merge = await client.mergeProposal(proposalAction.proposalId);
          showNotice(shellRoot, `${review.attention.summary_text} ${merge.attention.summary_text}`);
        } catch (error) {
          if (!showMergeConflictNotice(shellRoot, error, locale)) {
            showNotice(shellRoot, actionMessage(error, locale));
          }
        }
        return;
      }
      if (proposalAction?.action === "merge") {
        try {
          const merge = await client.mergeProposal(proposalAction.proposalId, anchorMergePayload(anchor));
          showNotice(shellRoot, merge.attention.summary_text);
        } catch (error) {
          if (!showMergeConflictNotice(shellRoot, error, locale)) {
            showNotice(shellRoot, actionMessage(error, locale));
          }
        }
        return;
      }
      showNotice(shellRoot, goldPathT(locale, "runtime.actionPending"));
    }
  }, eventListenerOptions(signal));

  if (!onNavigate) {
    window.addEventListener("hashchange", activateFromHash, eventListenerOptions(signal));
    activateFromHash();
  }
}

let activeRouteRenderId = 0;

function currentRouteMatch() {
  return resolveWebRoute(window.location.pathname) ?? createUnknownWebRouteMatch(window.location.pathname);
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
