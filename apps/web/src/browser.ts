import { createApiClient, WorkHubApiError } from "@workhub/api-client/client";
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

const root = document.getElementById("root");
type BrowserApiClient = ReturnType<typeof createApiClient>;
type IdentityLocaleCarrier = {
  locale?: unknown;
  preferences?: {
    locale?: unknown;
  };
} | null | undefined;

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

function applyIdentityLocale(identity: IdentityLocaleCarrier, fallback: WorkHubLocale): WorkHubLocale {
  const locale = identityLocale(identity) ?? fallback;
  persistBrowserLocale(locale);
  return locale;
}

async function resolveBootLocale(client: BrowserApiClient, fallback: WorkHubLocale) {
  const me = await client.me().catch(() => null);
  return applyIdentityLocale(me, fallback);
}

function bindLocaleSwitch(shellRoot: HTMLElement, locale: WorkHubLocale, client: BrowserApiClient) {
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
  });
}

function showNotice(shellRoot: HTMLElement, message: string, extraHtml?: string) {
  const notice = shellRoot.querySelector<HTMLElement>("[data-wh-app-notice]");
  if (!notice) {
    return;
  }
  notice.textContent = message;
  if (extraHtml) {
    notice.insertAdjacentHTML("beforeend", extraHtml);
  }
  notice.hidden = false;
  window.setTimeout(() => {
    notice.hidden = true;
  }, 4600);
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
    goldPathT(locale, "runtime.reason.tone"),
    goldPathT(locale, "runtime.reason.scope")
  ];
  return `<div class="wh-app-action-row">${reasons
    .map((reason) => `<button type="button" data-review-reason="${reason}">${reason}</button>`)
    .join("")}</div>`;
}

function actionMessage(error: unknown, locale: WorkHubLocale) {
  return error instanceof Error ? error.message : goldPathT(locale, "runtime.actionFail");
}

function bindGoldPathNavigation(shellRoot: HTMLElement, shell: GoldPathAppShell, client: BrowserApiClient, locale: WorkHubLocale) {
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
      setActivePage(shellRoot, shell, action.pageKey);
      return;
    }
    if (action.kind === "api-action") {
      event.preventDefault();
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
  activateFromHash();
}

async function boot() {
  if (!root) {
    return;
  }
  let locale = browserLocale();
  setDocumentLocale(locale);
  root.innerHTML = renderGoldPathBootDocument({
    title: goldPathT(locale, "boot.web.title"),
    message: goldPathT(locale, "boot.web.message")
  });

  try {
    const client = createApiClient({ baseUrl: "" });
    locale = await resolveBootLocale(client, locale);
    let surfaceVm;
    try {
      surfaceVm = await client.pages.goldPath({ locale });
    } catch (error) {
      if (!(error instanceof WorkHubApiError) || error.code !== "not_identified") {
        throw error;
      }
      locale = applyIdentityLocale(await client.identify({ nickname: "P0.5 Reviewer" }), locale);
      surfaceVm = await client.pages.goldPath({ locale });
    }
    const rendered = renderGoldPathSurface(surfaceVm, "web", { locale });
    const shell = renderGoldPathAppShell(rendered, {
      appName: "WorkHub",
      surfaceLabel: "Web P0.5",
      apiBaseLabel: "/api/pages/gold-path",
      locale
    });
    root.innerHTML = `<style>${shell.css}</style>${shell.html}`;
    bindLocaleSwitch(root, locale, client);
    bindGoldPathNavigation(root, shell, client, locale);
  } catch (error) {
    root.innerHTML = renderGoldPathBootDocument({
      title: goldPathT(locale, "boot.web.errorTitle"),
      message: error instanceof Error ? error.message : goldPathT(locale, "boot.web.errorMessage"),
      tone: "error"
    });
  }
}

void boot();
