import { createApiClient, WorkHubApiError } from "@workhub/api-client/client";
import { createCuuController, type CuuControllerSnapshot } from "@workhub/cuu";
import {
  classifyGoldPathHref,
  goldPathT,
  normalizeWorkHubLocale,
  renderGoldPathAppShell,
  renderGoldPathBootDocument,
  renderGoldPathSurface,
  resolveGoldPathPageKey,
  type GoldPathAppShell,
  type WorkHubLocale
} from "@workhub/ui/gold-path";
import { renderProposalConflictCards } from "@workhub/ui/proposal";
import {
  actionElementApplyPayload,
  actionElementMergePayload,
  actionErrorNotice,
  actionHrefFromElement,
  actionPendingNotice,
  actionSuccessNotice,
  actionSummary,
  applyIdentityLocale,
  approvalRespondIdFromHref,
  bindRouteLineEditor,
  browserLocale,
  conflictsFromMergeError,
  desktopRequiredNotice,
  fieldValueRequiredNotice,
  intakeOptionRequiredNotice,
  localePersistenceFailedNotice,
  mergeConflictNotice,
  mergeProposalCandidateApplyIdFromHref,
  persistBrowserLocale,
  proposalActionFromHref,
  reasonRequiredNotice,
  reviewReasonButtons,
  selectionNotice,
  setDocumentLocale,
  showRouteNotice as showSharedRouteNotice,
  updateIntakeActionPayloads,
  type ActionPayloadResult,
  type RouteNoticeTimerState,
  type RouteNoticeVM
} from "@workhub/web-runtime";

import {
  resolveDesktopShellListen,
  type DesktopShellListen
} from "./desktop-cuu-runtime.js";
import {
  bindDesktopPetSettingsPanel,
  desktopPetSettingsCss,
  desktopPetSettingsPreferencesFromPayload,
  loadCuuPreferences,
  saveCuuPreferences
} from "./cuu-preferences.js";
import { bootDesktopPetSurface, resolveDesktopSurface } from "./pet-surface.js";
import { liquidGlassCss, liquidGlassHeadHtml } from "./liquid-glass.js";
import { renderDecisionDeckHtml, decisionDeckCss } from "./decision-deck.js";
import { renderTeamCalendarHtml, teamCalendarCss } from "./team-calendar.js";
import {
  desktopPetWindowSettingsFromPreferences,
  resolveDesktopPetWindowBridge
} from "./pet-window-bridge.js";
import { parseDesktopShellNavigatePayload } from "./shell-events.js";

const root = document.getElementById("root");
type BrowserApiClient = ReturnType<typeof createApiClient>;
const noticeTimerState: RouteNoticeTimerState = {};
let plainNoticeTimer: number | undefined;

function clientToken() {
  return window.localStorage.getItem("workhub_client_token") ?? window.localStorage.getItem("yqgl_client_token") ?? undefined;
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
    void client.updatePreferences({ locale: nextLocale })
      .then(() => {
        window.location.reload();
      })
      .catch(() => {
        persistBrowserLocale(locale);
        showRouteNotice(shellRoot, localePersistenceFailedNotice(locale, "locale_switch"));
      });
  });
}

function showRouteNotice(shellRoot: HTMLElement, vm: RouteNoticeVM, extraHtml?: string, timeoutMs = 4600) {
  showSharedRouteNotice(shellRoot, vm, extraHtml, timeoutMs, noticeTimerState);
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
  if (plainNoticeTimer !== undefined) {
    window.clearTimeout(plainNoticeTimer);
    plainNoticeTimer = undefined;
  }
  notice.textContent = message;
  if (extraHtml) {
    notice.insertAdjacentHTML("beforeend", extraHtml);
  }
  notice.hidden = false;
  if (timeoutMs > 0) {
    plainNoticeTimer = window.setTimeout(() => {
      notice.hidden = true;
      plainNoticeTimer = undefined;
      onTimeout?.();
    }, timeoutMs);
  }
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

function showMergeConflictNotice(shellRoot: HTMLElement, error: unknown, locale: WorkHubLocale, actionId?: string) {
  const conflicts = conflictsFromMergeError(error);
  if (conflicts.length === 0) {
    return false;
  }
  const rendered = renderProposalConflictCards(conflicts, { locale });
  showRouteNotice(shellRoot, mergeConflictNotice(locale, actionId), rendered.html, 0);
  return true;
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

function bindGoldPathNavigation(
  shellRoot: HTMLElement,
  shell: GoldPathAppShell,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  input: {
    listen?: DesktopShellListen | undefined;
    // R7 P3:任一动作落库后(成功或失败)回调,用于刷新决策卡牌(回拉服务端真相)。
    onActionSettled?: (() => void) | undefined;
  } = {}
) {
  let pendingReviewHref: string | undefined;
  let pendingReviewActionId: string | undefined;
  let pendingApprovalId: string | undefined;
  let pendingApprovalActionId: string | undefined;

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
      // R7 P3:打回/改改在理由确认后落库,刷新决策卡牌让已处理的卡从牌叠消失。
      input.onActionSettled?.();
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
      setActivePage(shellRoot, shell, action.pageKey);
      return;
    }
    if (action.kind === "api-action") {
      event.preventDefault();
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
        input.onActionSettled?.();
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
        input.onActionSettled?.();
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
        input.onActionSettled?.();
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
        input.onActionSettled?.();
        return;
      }
      showRouteNotice(shellRoot, actionPendingNotice(locale, actionId));
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
  let locale = browserLocale();
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
    locale = await resolveBootLocale(client, locale);
    let surfaceVm;
    try {
      surfaceVm = await client.pages.goldPath({ locale });
    } catch (error) {
      if (!(error instanceof WorkHubApiError) || error.code !== "not_identified") {
        throw error;
      }
      locale = applyIdentityLocale(await client.identify({ nickname: "WorkHub Desktop Preview" }), locale);
      surfaceVm = await client.pages.goldPath({ locale });
    }
    const rendered = renderGoldPathSurface(surfaceVm, "desktop", { locale });
    const shell = renderGoldPathAppShell(rendered, {
      appName: "WorkHub Desktop",
      // R7：顶栏去开发黑话——把 "Tauri Webview P0.5 / device-token aware client"
      // 换成用户真正关心的运行状态「● 已连接 · 本地同步正常」。
      surfaceLabel: goldPathT(locale, "shell.typedApi"),
      apiBaseLabel: goldPathT(locale, "shell.desktopSync"),
      locale
    });
    // R7 液态玻璃地基(桌面专属):字体 <link> 在前,玻璃覆盖 CSS 紧跟壳层 CSS 之后(同特异性靠顺序取胜)。
    root.innerHTML = `${liquidGlassHeadHtml}<style>${shell.css}${desktopPetSettingsCss}${liquidGlassCss}${decisionDeckCss}${teamCalendarCss}</style>${shell.html}`;
    // R7 P3:首页面板换成液态玻璃「决策卡牌」(数据来自 attention.queue)。卡片按钮带 href+data-action-id,
    // 由下面 bindGoldPathNavigation 的既有点击管线处理(审批 respond / 提议 review·merge),无需新交互代码。
    // fail-open:取不到面板/数据就保留 gold-path 原首页,绝不让首页空掉。
    const homePanel = root.querySelector<HTMLElement>("[data-wh-panel=\"home\"]");
    if (homePanel) {
      homePanel.innerHTML = renderDecisionDeckHtml({ items: surfaceVm.page_vms.attention.queue, locale });
    }
    // R7 P3:动作落库后回拉服务端真相、重渲染决策卡牌——已处理的卡从牌叠消失,失败则卡片留存
    // (服务端仍 pending → 回拉的 queue 仍含此卡),天然规避「乐观前进但其实失败」的错位。
    // 走 goldPath 全量聚合,与 boot 同源;桌面低频,成本可接受。失败静默保留现状,绝不空首页。
    const refreshDecisionDeck = async () => {
      if (!homePanel) {
        return;
      }
      try {
        const fresh = await client.pages.goldPath({ locale });
        homePanel.innerHTML = renderDecisionDeckHtml({ items: fresh.page_vms.attention.queue, locale });
      } catch {
        // 保留当前卡牌,不打断用户。
      }
    };
    // R7 P4:桌面专属「团队」页(先上日历段)。共享 gold-path surface 没有 team page_vm,
    // 所以在已渲染的壳里注入桌面 only 的导航项 + 面板,并把 "/team" 挂进 shell.routeMap——
    // 既有导航管线(classifyGoldPathHref→setActivePage)即认得它(setActivePage 用字符串比较
    // data-wh-panel,与 PageKey 联合类型无关)。日历懒加载:首次进 team 才拉 client.pages.calendar()。
    // 后端零改动:GET /api/pages/calendar 早已存在,仅未接桌面。失败可重试,绝不阻塞其它页。
    const teamZh = locale === "zh-CN";
    const teamLoadingHtml = (title: string) =>
      `<div class="wh-tcal"><div class="wh-tcal-empty"><div class="wh-tcal-empty-face gl-avatar">(=^･ω･^=)</div><h3 class="wh-tcal-empty-title">${title}</h3></div></div>`;
    const navList = root.querySelector<HTMLElement>(".wh-app-nav-list");
    const appContent = root.querySelector<HTMLElement>(".wh-app-content");
    if (navList && appContent && !appContent.querySelector("[data-wh-panel=\"team\"]")) {
      navList.insertAdjacentHTML(
        "beforeend",
        `<a href="/team" data-wh-route="/team" data-wh-page-key="team" aria-current="false"><span>${teamZh ? "团队" : "Team"}</span></a>`
      );
      appContent.insertAdjacentHTML(
        "beforeend",
        `<section class="wh-route-panel" data-wh-panel="team" hidden><div data-wh-team-calendar>${teamLoadingHtml(teamZh ? "正在拉团队日历…" : "Loading team calendar…")}</div></section>`
      );
      // "team" 不在 PageKey 联合类型里,这是桌面 only 扩展,故就地放宽类型让既有管线认它。
      (shell.routeMap as Record<string, string>)["/team"] = "team";
      const calendarHost = appContent.querySelector<HTMLElement>("[data-wh-panel=\"team\"] [data-wh-team-calendar]");
      let teamCalendarLoaded = false;
      const loadTeamCalendar = async () => {
        if (teamCalendarLoaded || !calendarHost) {
          return;
        }
        teamCalendarLoaded = true;
        try {
          const calendar = await client.pages.calendar({ locale });
          calendarHost.innerHTML = renderTeamCalendarHtml({ page: calendar, locale });
        } catch {
          teamCalendarLoaded = false; // 允许下次再进 team 时重试
          calendarHost.innerHTML = teamLoadingHtml(teamZh ? "日历没拉到，再点一次「团队」重试～" : "Couldn't load — tap Team again to retry");
        }
      };
      root.addEventListener("click", (event) => {
        const teamLink = event.target instanceof Element ? event.target.closest("[data-wh-page-key=\"team\"]") : null;
        if (teamLink) {
          void loadTeamCalendar();
        }
      });
      // 深链/刷新时 hash 已是 #/team:activateFromHash 会显示面板,这里同步把日历拉起来。
      if (window.location.hash.slice(1) === "/team") {
        void loadTeamCalendar();
      }
    }
    const realShellListen = resolveDesktopShellListen();
    const petWindowBridge = resolveDesktopPetWindowBridge();
    const cuuController = createCuuController({ preferences: loadCuuPreferences() });
    const syncPetSettings = async (snapshot: CuuControllerSnapshot) => {
      await petWindowBridge?.setSettings?.(desktopPetWindowSettingsFromPreferences(snapshot.preferences));
    };
    void syncPetSettings(cuuController.snapshot()).catch(() => undefined);
    const settingsBinding = bindDesktopPetSettingsPanel(root, cuuController, {
      locale,
      bridge: petWindowBridge,
      onChange: syncPetSettings,
      onStatus: (message) => showNotice(root, message)
    });
    void realShellListen?.("pet-settings", (event) => {
      const preferences = desktopPetSettingsPreferencesFromPayload(event.payload);
      if (!preferences) {
        return;
      }
      const snapshot = cuuController.setPreferences(preferences);
      saveCuuPreferences(snapshot.preferences);
      settingsBinding.refresh();
    });
    bindLocaleSwitch(root, locale, client);
    bindRouteLineEditor(root);
    bindGoldPathNavigation(root, shell, client, locale, {
      listen: realShellListen,
      onActionSettled: () => {
        void refreshDecisionDeck();
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
