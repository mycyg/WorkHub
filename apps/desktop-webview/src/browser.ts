import { createApiClient, WorkHubApiError } from "@workhub/api-client/client";
import {
  createCuuController,
  type CuuCard,
  type CuuController,
  type CuuControllerDecision,
  type CuuControllerSnapshot
} from "@workhub/cuu";
import {
  classifyGoldPathHref,
  goldPathT,
  normalizeWorkHubLocale,
  renderGoldPathAppShell,
  renderGoldPathBootDocument,
  renderGoldPathSurface,
  resolveGoldPathPageKey,
  workHubLocaleStorageKey,
  type GoldPathAppShell,
  type WorkHubLocale
} from "@workhub/ui/gold-path";

import {
  bindDesktopShellCuuRuntime,
  createDesktopCuuDemoScript,
  createDesktopShellScriptedListener,
  desktopCuuNoticeMessage,
  desktopCuuNoticeCss,
  renderDesktopCuuNotice,
  resolveDesktopCuuAction,
  resolveDesktopShellListen,
  submitDesktopCuuAction,
  type DesktopCuuActionRequest,
  type DesktopShellListen
} from "./desktop-cuu-runtime.js";
import {
  bindCuuPreferencePanel,
  desktopCuuPreferenceCss,
  loadCuuPreferences
} from "./cuu-preferences.js";
import { bootDesktopPetSurface, resolveDesktopSurface } from "./pet-surface.js";
import { parseDesktopShellNavigatePayload } from "./shell-events.js";

const root = document.getElementById("root");
type BrowserApiClient = ReturnType<typeof createApiClient>;
let noticeTimer: number | undefined;

function clientToken() {
  return window.localStorage.getItem("workhub_client_token") ?? window.localStorage.getItem("yqgl_client_token") ?? undefined;
}

function browserLocale(): WorkHubLocale {
  return normalizeWorkHubLocale(window.localStorage.getItem(workHubLocaleStorageKey) ?? window.navigator.language);
}

function setDocumentLocale(locale: WorkHubLocale) {
  document.documentElement.lang = locale;
}

function bindLocaleSwitch(shellRoot: HTMLElement, locale: WorkHubLocale) {
  shellRoot.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-wh-locale]") : null;
    if (!button) {
      return;
    }
    const nextLocale = normalizeWorkHubLocale(button.dataset.whLocale);
    if (nextLocale === locale) {
      return;
    }
    window.localStorage.setItem(workHubLocaleStorageKey, nextLocale);
    window.location.reload();
  });
}

function showNotice(
  shellRoot: HTMLElement,
  message: string,
  extraHtml?: string,
  timeoutMs = 4600,
  onTimeout?: () => void
) {
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
      onTimeout?.();
    }, timeoutMs);
  }
}

function ensureCuuQueueBadge(shellRoot: HTMLElement) {
  const existing = shellRoot.querySelector<HTMLButtonElement>("[data-cuu-queue-badge]");
  if (existing) {
    return existing;
  }
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "wh-cuu-queue-badge";
  badge.dataset.cuuQueueBadge = "true";
  badge.hidden = true;
  shellRoot.appendChild(badge);
  return badge;
}

function cuuQueueLabel(locale: WorkHubLocale, snapshot: CuuControllerSnapshot) {
  if (locale === "en-US") {
    return snapshot.queue.length > 0
      ? `${snapshot.queue.length} queued, ${snapshot.badge_count} tucked away`
      : `${snapshot.badge_count} tucked away`;
  }
  return snapshot.queue.length > 0
    ? `排队 ${snapshot.queue.length} 条，收起 ${snapshot.badge_count} 条`
    : `收起 ${snapshot.badge_count} 条`;
}

function updateCuuQueueBadge(shellRoot: HTMLElement, snapshot: CuuControllerSnapshot, locale: WorkHubLocale) {
  const badge = ensureCuuQueueBadge(shellRoot);
  const total = snapshot.queue.length + snapshot.badge_count;
  if (total <= 0) {
    badge.hidden = true;
    badge.innerHTML = "";
    return;
  }
  const label = cuuQueueLabel(locale, snapshot);
  badge.innerHTML = `<span class="wh-cuu-queue-count">${total}</span><span class="wh-cuu-queue-text">${escapeHtml(label)}</span>`;
  badge.title = `Cuu ${label}`;
  badge.hidden = false;
}

function bindCuuQueueBadge(shellRoot: HTMLElement, controller: CuuController, locale: WorkHubLocale) {
  const badge = ensureCuuQueueBadge(shellRoot);
  badge.addEventListener("click", () => {
    const activeCard = controller.snapshot().active_card;
    if (activeCard) {
      showCuuCard(shellRoot, controller, activeCard, locale);
      updateCuuQueueBadge(shellRoot, controller.snapshot(), locale);
      return;
    }
    const next = controller.dismiss();
    updateCuuQueueBadge(shellRoot, next.snapshot, locale);
    if (next.card && (next.outcome === "show" || next.outcome === "replace")) {
      showCuuCard(shellRoot, controller, next.card, locale, next);
    }
  });
}

function showCuuCard(
  shellRoot: HTMLElement,
  controller: CuuController,
  card: CuuCard,
  locale: WorkHubLocale,
  decision?: CuuControllerDecision
) {
  showNotice(
    shellRoot,
    desktopCuuNoticeMessage(card),
    renderDesktopCuuNotice(card),
    decision?.presentation.timeout_ms ?? cuuNoticeTimeoutMs(card),
    () => {
      const next = controller.dismiss(card.id);
      updateCuuQueueBadge(shellRoot, next.snapshot, locale);
      if (next.card && (next.outcome === "show" || next.outcome === "replace")) {
        showCuuCard(shellRoot, controller, next.card, locale, next);
      }
    }
  );
}

function cuuNoticeTimeoutMs(card: CuuCard) {
  return card.priority === "urgent" || card.state === "asking_approval" ? 12000 : 7200;
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

function reviewReasonButtons(locale: WorkHubLocale) {
  const reasons = [
    goldPathT(locale, "runtime.reason.evidence"),
    goldPathT(locale, "runtime.reason.scope"),
    goldPathT(locale, "runtime.reason.format")
  ];
  return `<div class="wh-app-action-row">${reasons
    .map((reason) => `<button type="button" data-review-reason="${escapeHtml(reason)}">${escapeHtml(reason)}</button>`)
    .join("")}</div>`;
}

function actionMessage(error: unknown, locale: WorkHubLocale) {
  return error instanceof Error ? error.message : goldPathT(locale, "runtime.actionFail");
}

function cuuDemoMode() {
  const value = new URLSearchParams(window.location.search).get("cuuDemo");
  if (value === "1" || value === "true") {
    return "on";
  }
  if (value === "offline") {
    return "offline";
  }
  return "off";
}

function handleCuuActionResult(
  shellRoot: HTMLElement,
  controller: CuuController,
  locale: WorkHubLocale,
  result: { message: string; card?: CuuCard }
) {
  if (!result.card) {
    showNotice(shellRoot, result.message);
    return;
  }
  const decision = controller.enqueue(result.card);
  updateCuuQueueBadge(shellRoot, decision.snapshot, locale);
  if (decision.card && (decision.outcome === "show" || decision.outcome === "replace")) {
    showCuuCard(shellRoot, controller, decision.card, locale, decision);
    return;
  }
  showNotice(shellRoot, result.message);
}

function findCuuCardForAction(controller: CuuController, anchor: HTMLAnchorElement) {
  const cardId = anchor.closest<HTMLElement>("[data-cuu-card-id]")?.dataset.cuuCardId;
  if (!cardId) {
    return undefined;
  }
  const snapshot = controller.snapshot();
  const cards = [
    snapshot.active_card,
    ...snapshot.queue
  ].filter((card): card is CuuCard => Boolean(card));
  return cards.find((card) => card.id === cardId);
}

function bindGoldPathNavigation(
  shellRoot: HTMLElement,
  shell: GoldPathAppShell,
  client: BrowserApiClient,
  cuuController: CuuController,
  locale: WorkHubLocale,
  input: { listen?: DesktopShellListen | undefined } = {}
) {
  let pendingReviewHref: string | undefined;
  let pendingCuuAction: DesktopCuuActionRequest | undefined;

  const activateRoute = (route: string) => {
    const pageKey = resolveGoldPathPageKey(shell.routeMap, route);
    if (pageKey) {
      setActivePage(shellRoot, shell, pageKey);
      return true;
    }
    return false;
  };

  const activateFromHash = () => {
    activateRoute(window.location.hash.slice(1) || "/");
  };

  shellRoot.addEventListener("click", async (event) => {
    const reasonButton = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-review-reason]") : null;
    if (reasonButton && pendingCuuAction) {
      try {
        const result = await submitDesktopCuuAction({
          client,
          action: pendingCuuAction,
          reasonMd: reasonButton.dataset.reviewReason ?? "需要调整"
        });
        pendingCuuAction = undefined;
        handleCuuActionResult(shellRoot, cuuController, locale, result);
      } catch (error) {
        showNotice(shellRoot, actionMessage(error, locale));
      }
      return;
    }
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
    const cuuAction = resolveDesktopCuuAction(href, {
      actionId: anchor.dataset.cuuActionId,
      requiresReason: anchor.dataset.requiresReason === "true",
      card: findCuuCardForAction(cuuController, anchor)
    });
    if (cuuAction) {
      event.preventDefault();
      if (cuuAction.kind === "approval-response" && cuuAction.requiresReason && cuuAction.decision === "deny") {
        pendingCuuAction = cuuAction;
        showNotice(shellRoot, goldPathT(locale, "runtime.rejectNeedsReason"), reviewReasonButtons(locale));
        return;
      }
      try {
        const result = await submitDesktopCuuAction({ client, action: cuuAction });
        handleCuuActionResult(shellRoot, cuuController, locale, result);
      } catch (error) {
        showNotice(shellRoot, actionMessage(error, locale));
      }
      return;
    }
    const action = classifyGoldPathHref(shell.routeMap, href, {
      requiresReason: anchor.dataset.requiresReason === "true",
      method: anchor.dataset.method
    });
    if (action.kind === "navigate") {
      event.preventDefault();
      setActivePage(shellRoot, shell, action.pageKey);
      return;
    }
    if (action.kind === "api-action") {
      event.preventDefault();
      const proposalAction = proposalActionFromHref(href);
      if (proposalAction?.action === "review") {
        if (action.requiresReason) {
          pendingReviewHref = href;
          showNotice(shellRoot, goldPathT(locale, "runtime.rejectReasonFirst"), reviewReasonButtons(locale));
          return;
        }
        try {
          const review = await client.reviewProposal(proposalAction.proposalId, { decision: "approve", remember: "once" });
          const merge = await client.mergeProposal(proposalAction.proposalId);
          showNotice(shellRoot, `${review.attention.summary_text} ${merge.attention.summary_text}`);
        } catch (error) {
          showNotice(shellRoot, actionMessage(error, locale));
        }
        return;
      }
      if (proposalAction?.action === "merge") {
        try {
          const merge = await client.mergeProposal(proposalAction.proposalId);
          showNotice(shellRoot, merge.attention.summary_text);
        } catch (error) {
          showNotice(shellRoot, actionMessage(error, locale));
        }
        return;
      }
      showNotice(shellRoot, goldPathT(locale, "runtime.actionPending"));
    }
  });

  window.addEventListener("hashchange", activateFromHash);
  void input.listen?.("navigate", (event) => {
    const payload = parseDesktopShellNavigatePayload(event.payload);
    if (payload) {
      activateRoute(payload.route);
    }
  });
  activateFromHash();
}

async function boot() {
  if (!root) {
    return;
  }
  const locale = browserLocale();
  setDocumentLocale(locale);
  root.innerHTML = renderGoldPathBootDocument({
    title: goldPathT(locale, "boot.desktop.title"),
    message: goldPathT(locale, "boot.desktop.message")
  });

  try {
    const client = createApiClient({
      baseUrl: "",
      getClientToken: clientToken
    });
    let surfaceVm;
    try {
      surfaceVm = await client.pages.goldPath();
    } catch (error) {
      if (!(error instanceof WorkHubApiError) || error.code !== "not_identified") {
        throw error;
      }
      await client.identify({ nickname: "Cuu Desktop Preview" });
      surfaceVm = await client.pages.goldPath();
    }
    const rendered = renderGoldPathSurface(surfaceVm, "desktop", { locale });
    const shell = renderGoldPathAppShell(rendered, {
      appName: "WorkHub Desktop",
      surfaceLabel: "Tauri Webview P0.5",
      apiBaseLabel: "device-token aware client",
      locale
    });
    root.innerHTML = `<style>${shell.css}${desktopCuuNoticeCss}${desktopCuuPreferenceCss}</style>${shell.html}`;
    const cuuController = createCuuController({ preferences: loadCuuPreferences() });
    const realShellListen = resolveDesktopShellListen();
    bindLocaleSwitch(root, locale);
    bindGoldPathNavigation(root, shell, client, cuuController, locale, { listen: realShellListen });
    const cuuDecisions = new Map<string, CuuControllerDecision>();
    bindCuuQueueBadge(root, cuuController, locale);
    bindCuuPreferencePanel(root, cuuController, {
      onChange(snapshot) {
        updateCuuQueueBadge(root, snapshot, locale);
      }
    });
    const demoMode = cuuDemoMode();
    const demoListener =
      !realShellListen && demoMode !== "off"
        ? createDesktopShellScriptedListener(createDesktopCuuDemoScript(surfaceVm, {
            includeOfflineStatus: demoMode === "offline"
          }))
        : undefined;
    void bindDesktopShellCuuRuntime({
      listen: realShellListen ?? demoListener?.listen,
      controller: cuuController,
      onDecision(decision) {
        if (decision.card) {
          cuuDecisions.set(decision.card.id, decision);
        }
        updateCuuQueueBadge(root, decision.snapshot, locale);
      },
      notify(notice) {
        showCuuCard(root, cuuController, notice.card, locale, cuuDecisions.get(notice.card.id));
      }
    }).then((runtime) => {
      if (runtime.subscribed && demoListener) {
        showNotice(root, goldPathT(locale, "runtime.cuuPreviewOn"), undefined, 2400);
        demoListener.start();
      }
    });
  } catch (error) {
    root.innerHTML = renderGoldPathBootDocument({
      title: goldPathT(locale, "boot.desktop.errorTitle"),
      message: error instanceof Error ? error.message : goldPathT(locale, "boot.desktop.errorMessage"),
      tone: "error"
    });
  }
}

if (root && resolveDesktopSurface() === "pet") {
  void bootDesktopPetSurface(root);
} else {
  void boot();
}
