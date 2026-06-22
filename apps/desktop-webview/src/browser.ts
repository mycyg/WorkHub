import { createApiClient, WorkHubApiError } from "@workhub/api-client/client";
import { defaultPorts } from "@workhub/config";
import { createCuuController, type CuuControllerSnapshot } from "@workhub/cuu";
import {
  classifyGoldPathHref,
  goldPathT,
  normalizeWorkHubLocale,
  renderGoldPathAppShell,
  renderGoldPathBootDocument,
  renderGoldPathSurface,
  renderWebRouteComponent,
  resolveGoldPathPageKey,
  type GoldPathAppShell,
  type WorkHubLocale
} from "@workhub/ui/gold-path";
import { renderProposalConflictCards, renderProposalDetail, proposalCss } from "@workhub/ui/proposal";
import {
  actionElementApplyPayload,
  actionElementCreateWorkItemPayload,
  actionElementMergePayload,
  actionElementNextQuestionPayload,
  actionErrorNotice,
  actionHrefFromElement,
  actionPendingNotice,
  actionSuccessNotice,
  actionSummary,
  applyIdentityLocale,
  approvalRespondIdFromHref,
  bindRouteLineEditor,
  bootstrapProjectActionFromHref,
  browserLocale,
  conflictsFromMergeError,
  createWorkItemActionFromHref,
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
  sessionNextQuestionIdFromHref,
  setDocumentLocale,
  showRouteNotice as showSharedRouteNotice,
  startAgentRunActionFromHref,
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
import { renderProjectsListHtml, projectsPageCss } from "./projects-page.js";
import { renderProjectDriveHtml, projectDriveCss } from "./project-drive.js";
import {
  desktopPetWindowSettingsFromPreferences,
  resolveDesktopPetWindowBridge
} from "./pet-window-bridge.js";
import { parseDesktopShellNavigatePayload } from "./shell-events.js";

const root = document.getElementById("root");
type BrowserApiClient = ReturnType<typeof createApiClient>;
type DesktopSessionVM = Awaited<ReturnType<BrowserApiClient["createSession"]>>;
const noticeTimerState: RouteNoticeTimerState = {};
let plainNoticeTimer: number | undefined;

function clientToken() {
  return window.localStorage.getItem("workhub_client_token") ?? window.localStorage.getItem("yqgl_client_token") ?? undefined;
}

// 测试反馈修复（窗口空白）：打包后 webview 的同源是 tauri://（没有 /api），baseUrl="" 会让所有 API 调用落空、
// 首页加载不出→整窗空白。桌面客户端改为默认连本机后端（API 默认端口），并可用 localStorage.workhub_api_base
// 覆盖（指向远端/不同端口的 WorkHub 后端）。后端 CORS 已反射桌面 tauri 源 + 本机回环（apps/api app.ts），故跨源带
// cookie 可达。注意：仍需后端在跑；连不上时显示的是连接错误而非空白。
function resolveDesktopApiBase(): string {
  const override = window.localStorage.getItem("workhub_api_base");
  if (override && override.trim().length > 0) {
    return override.trim().replace(/\/+$/u, "");
  }
  return `http://127.0.0.1:${defaultPorts.api}`;
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
    // M31：懒加载面板的路由→数据加载器表。激活路由(navigate/hashchange)时触发对应 loader。
    lazyPanelLoaders?: Map<string, () => void> | undefined;
  } = {}
) {
  let pendingReviewHref: string | undefined;
  let pendingReviewActionId: string | undefined;
  let pendingApprovalId: string | undefined;
  let pendingApprovalActionId: string | undefined;

  // 测试反馈修复：桌面主窗口此前只渲染 P0.5 fixture intake 预览、澄清动作全落「暂不可用」桩。
  // 这里把 web 已验证的「提需求→澄清→创建工作项」真闭环接进桌面主窗口的 intake 面板：进入「选项接入」
  // 渲交互式起点屏 → 起真实会话 → 选项+继续(next-question)逐题推进 → 确认后创建工作项(spec_ready,不自动派活)。
  // 用共享 renderWebRouteComponent（与 web 同一交互式组件：选项卡带 data-intake-option-id、提交带 next-question
  // 载荷），桌面既有的选项勾选委托(下方 [data-option-id] 分支)与之天然咬合。
  const intakePanel = () => shellRoot.querySelector<HTMLElement>("[data-wh-panel=\"intake\"]");
  let activeIntakeSessionId: string | undefined;
  // route-component 的 .wh-r4-route* 样式不在壳层 goldPathCss 里，需随面板内联注入（与 skills 懒加载面板
  // 的 `<style>${component.css}</style>${component.html}` 同款），否则交互式 intake 面板会丢样式。
  const swapIntakePanel = (component: { css: string; html: string }) => {
    const panel = intakePanel();
    if (!panel) {
      return;
    }
    panel.innerHTML = `<style>${component.css}</style>${component.html}`;
  };
  const renderIntakeSessionPanel = (session: DesktopSessionVM) => {
    activeIntakeSessionId = session.session_id;
    swapIntakePanel(renderWebRouteComponent({ key: "intake", session }, { locale }));
  };
  const renderIntakeStartPanel = () => {
    swapIntakePanel(renderWebRouteComponent({ key: "intake", start: true }, { locale }));
  };
  const startIntakeFromPanel = async (intentText?: string) => {
    // bootstrapProject 幂等：拿到/建好试点项目，再起一个真实澄清会话（替换静态 demo 预览）。
    const project = await client.bootstrapProject({});
    const session = await client.createSession({
      project_id: project.project.id,
      ...(intentText && intentText.length > 0 ? { intent_text: intentText } : {})
    });
    renderIntakeSessionPanel(session);
    return session;
  };
  const intakeStartIntentText = (actionTarget: HTMLElement) => {
    const route = actionTarget.closest<HTMLElement>("[data-r4-route-component=\"intake\"]");
    return route?.querySelector<HTMLTextAreaElement>("[data-s1-day1-intent-input]")?.value.trim() ?? "";
  };

  const activateRoute = (route: string) => {
    const pageKey = resolveGoldPathPageKey(shell.routeMap, route);
    if (pageKey) {
      setActivePage(shellRoot, shell, pageKey);
      // M31：直接导航/壳 navigate 事件进入懒加载页时也拉数据(此前只 click 触发,导致面板空着)。
      input.lazyPanelLoaders?.get(route)?.();
      // 进入「选项接入」且还没有进行中的真实会话：用交互式起点屏替换 P0.5 fixture 预览（与 web 的
      // /intake 无 sessionId 起点屏一致）。已有会话则保留当前澄清进度，不打断。
      if (pageKey === "intake" && !activeIntakeSessionId) {
        renderIntakeStartPanel();
      }
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
    // 注意：不拦 requires_desktop。这是桌面 app 自身——「需要本地权限/独立窗口」的动作正应在此处执行，
    // 而非弹「请到桌面端继续」。该守卫只属于 web 客户端。
    const action = classifyGoldPathHref(shell.routeMap, href, {
      requiresReason: actionTarget.dataset.requiresReason === "true",
      method: actionTarget.dataset.method
    });
    if (action.kind === "navigate") {
      event.preventDefault();
      setActivePage(shellRoot, shell, action.pageKey);
      // 点「选项接入」导航且无进行中会话：用交互式起点屏替换 fixture 预览（同 activateRoute 的 hash 路径）。
      if (action.pageKey === "intake" && !activeIntakeSessionId) {
        renderIntakeStartPanel();
      }
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
      // 提需求起点：bootstrap 项目 + 起真实澄清会话，渲交互式 scope 题（替换 fixture 预览）。
      if (bootstrapProjectActionFromHref(href) && actionTarget.dataset.s1Day0StartIntake === "true") {
        try {
          await startIntakeFromPanel(intakeStartIntentText(actionTarget));
          showRouteNotice(shellRoot, actionSuccessNotice(locale, goldPathT(locale, "runtime.notice.actionSuccessTitle"), actionId ?? "start_intake"));
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId ?? "start_intake"));
        }
        return;
      }
      // 澄清「继续」→ next-question → 拉最新会话重渲澄清面板（scope→confirm 逐题推进）。
      const intakeSessionId = sessionNextQuestionIdFromHref(href);
      if (intakeSessionId) {
        const payload = actionElementNextQuestionPayload(actionTarget);
        if (!payload.ok) {
          showPayloadFailureNotice(shellRoot, locale, payload, actionId);
          return;
        }
        try {
          await client.nextQuestion(intakeSessionId, payload.payload);
          const session = await client.getSession(intakeSessionId, { locale });
          renderIntakeSessionPanel(session);
          showRouteNotice(shellRoot, actionSuccessNotice(locale, goldPathT(locale, "runtime.notice.actionSuccessTitle"), actionId ?? "intake_continue"));
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId ?? "intake_continue"));
        }
        return;
      }
      // 创建工作项（spec_ready，不自动派活——与 web 同口径：先给人过目再派活）→ 跳工作项详情。
      if (createWorkItemActionFromHref(href) && actionTarget.dataset.intakeCreateWorkitem === "true") {
        const payload = actionElementCreateWorkItemPayload(actionTarget);
        if (!payload.ok || !payload.payload) {
          showPayloadFailureNotice(shellRoot, locale, payload.ok ? { ok: false, reason: "invalid_json" } : payload, actionId);
          return;
        }
        try {
          const created = await client.createWorkItem(payload.payload);
          // 会话已定稿：清掉进行中会话，下次进入「选项接入」起新需求。
          activeIntakeSessionId = undefined;
          showRouteNotice(shellRoot, actionSuccessNotice(locale, actionSummary(created, locale), actionId ?? "create_workitem"));
          // 经 hash 导航：壳上既有 hashchange 监听会激活工作项页并懒拉 LIVE 详情面板。
          window.location.hash = `/workitems/${created.workitem.id}`;
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId ?? "create_workitem"));
        }
        input.onActionSettled?.();
        return;
      }
      // 派活：起 AI 执行 → 跳工作项详情（LIVE 面板会刷出 run / 之后的 Proposal·Replay）。
      const startAgentRun = startAgentRunActionFromHref(href);
      if (startAgentRun) {
        try {
          const run = await client.startAgentRun(startAgentRun.workItemId);
          const body = locale === "en-US"
            ? `AI run queued: ${run.run_id}.`
            : `AI 执行已排队：${run.run_id}。`;
          showRouteNotice(shellRoot, actionSuccessNotice(locale, body, actionId ?? "start_agent_run"));
          window.location.hash = `/workitems/${startAgentRun.workItemId}`;
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId ?? "start_agent_run"));
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

// R7 P4:通用玻璃加载占位卡(桌面懒加载页首屏/出错态)。title 为受控字面量,无需转义。
function desktopLazyLoadingHtml(title: string): string {
  return `<div style="max-width:560px;margin:24px auto 0;border-radius:24px;padding:46px 30px;text-align:center;background:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.75);box-shadow:0 26px 60px -28px rgba(70,54,140,.5),inset 0 1px 0 rgba(255,255,255,.7);backdrop-filter:blur(30px) saturate(170%);-webkit-backdrop-filter:blur(30px) saturate(170%);font-family:'M PLUS Rounded 1c','Noto Sans SC',sans-serif"><div style="font-size:32px">(=^･ω･^=)</div><h3 style="margin:14px 0 0;font-size:18px;font-weight:900;color:#2c2746">${title}</h3></div>`;
}

// R7 P4:在已渲染的 gold-path 壳里注入一个「桌面专属」懒加载页——共享 surface 无对应 page_vm,
// 故桌面侧补导航项 + 面板,并把 "/<key>" 挂进 shell.routeMap 让既有导航管线
// (classifyGoldPathHref→setActivePage,按字符串比 data-wh-panel,与 PageKey 联合无关)认得它。
// load(host) 首次进入该页时调用一次拉数据+渲染;失败渲染 errorHtml 并允许下次重试。
// 幂等:面板已存在则跳过(boot 理论只跑一次,仍防御)。fail-open:取不到 nav/content 容器就什么都不做。
function mountLazyDesktopPanel(
  shellRoot: HTMLElement,
  shell: GoldPathAppShell,
  input: {
    key: string;
    navLabel: string;
    loadingHtml: string;
    errorHtml: string;
    load: (host: HTMLElement) => Promise<void>;
    // M31：把本面板的懒加载触发器注册到共享路由表，让 shell `navigate` 事件 / hashchange 也能拉数据
    //（此前只有 nav 链接 click + boot hash 会触发，直接导航/壳事件进页则面板空着）。
    registerLoader?: (route: string, load: () => void) => void;
  }
): void {
  const navList = shellRoot.querySelector<HTMLElement>(".wh-app-nav-list");
  const appContent = shellRoot.querySelector<HTMLElement>(".wh-app-content");
  const panelSelector = `[data-wh-panel="${input.key}"]`;
  if (!navList || !appContent || appContent.querySelector(panelSelector)) {
    return;
  }
  navList.insertAdjacentHTML(
    "beforeend",
    `<a href="/${input.key}" data-wh-route="/${input.key}" data-wh-page-key="${input.key}" aria-current="false"><span>${input.navLabel}</span></a>`
  );
  appContent.insertAdjacentHTML(
    "beforeend",
    `<section class="wh-route-panel" data-wh-panel="${input.key}" hidden><div data-wh-lazy-host>${input.loadingHtml}</div></section>`
  );
  // key 不在 PageKey 联合类型里(桌面 only 扩展),就地放宽类型让既有管线认它。
  (shell.routeMap as Record<string, string>)[`/${input.key}`] = input.key;
  const host = appContent.querySelector<HTMLElement>(`${panelSelector} [data-wh-lazy-host]`);
  let loaded = false;
  const runLoad = async () => {
    if (loaded || !host) {
      return;
    }
    loaded = true;
    try {
      await input.load(host);
    } catch {
      loaded = false; // 允许下次再进该页时重试
      host.innerHTML = input.errorHtml;
    }
  };
  shellRoot.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest(`[data-wh-page-key="${input.key}"]`) : null;
    if (link) {
      void runLoad();
    }
  });
  // M31：注册到共享路由表，由 activateRoute（navigate 事件 + hashchange 都经它）激活本路由时触发。
  // runLoad 幂等（loaded 标志），与上面的 click / 下面的 boot-hash 多路触发互不冲突。
  input.registerLoader?.(`/${input.key}`, () => {
    void runLoad();
  });
  // 深链/刷新时 hash 已是 #/<key>:activateFromHash 会显示面板,这里同步把数据拉起来。
  if (window.location.hash.slice(1) === `/${input.key}`) {
    void runLoad();
  }
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
      baseUrl: resolveDesktopApiBase(),
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
    // proposalCss 放最前:它含一个 :root 重定义(--ink/--blue… 与 goldPathCss 同名不同值),放 shell.css
    // 之前 → goldPath :root 后覆盖、不全局串色;其 wh-proposal-* 布局类(独有)生效;玻璃覆盖在 liquidGlassCss 里(更后)赢。
    root.innerHTML = `${liquidGlassHeadHtml}<style>${proposalCss}${shell.css}${desktopPetSettingsCss}${liquidGlassCss}${decisionDeckCss}${teamCalendarCss}${projectsPageCss}${projectDriveCss}</style>${shell.html}`;
    // R7 P3:首页面板换成液态玻璃「决策卡牌」(数据来自 attention.queue)。卡片按钮带 href+data-action-id,
    // 由下面 bindGoldPathNavigation 的既有点击管线处理(审批 respond / 提议 review·merge),无需新交互代码。
    // fail-open:取不到面板/数据就保留 gold-path 原首页,绝不让首页空掉。
    const homePanel = root.querySelector<HTMLElement>("[data-wh-panel=\"home\"]");
    // 首屏即时用壳里的(P0.5 fixture)队列渲一帧,避免空白;随后 refreshDecisionDeck 换成 live。
    if (homePanel) {
      homePanel.innerHTML = renderDecisionDeckHtml({
        items: surfaceVm.page_vms.attention.queue,
        locale,
        backgroundRuns: surfaceVm.page_vms.attention.background_runs
      });
    }
    // R7:决策卡牌取 LIVE /api/pages/attention——真实待办(本人待决审批 + GAP-1 的 AI 提议)+ 真实后台在跑,
    // 不再用 P0.5 gold-path fixture(那是 demo 数据、卡片 ID 是假的、动作点了打不通)。动作落库后也调它回拉:
    // 已处理的卡从服务端 queue 消失;失败则卡仍在(规避「乐观前进其实失败」)。取数失败保留当前帧,绝不空首页。
    const refreshDecisionDeck = async () => {
      if (!homePanel) {
        return;
      }
      try {
        const attention = await client.pages.attention({ locale });
        homePanel.innerHTML = renderDecisionDeckHtml({
          items: attention.queue,
          locale,
          backgroundRuns: attention.background_runs,
          // R8 对齐:把今日战绩(含自进化「技能 +X · 精修 Y」)带进桌面决策卡牌首屏。
          ...(attention.worklog ? { worklog: attention.worklog } : {})
        });
      } catch {
        // 保留当前帧(fixture 或上一帧 live),不打断用户。
      }
    };
    void refreshDecisionDeck();
    // R7:proposal 详情页改用 LIVE 数据(桌面壳详情页本是 P0.5 fixture 假 diff)。导航到 /proposals/:id
    // 时懒拉 client.pages.proposal(id) 用共享 renderProposalDetail 重渲该面板;proposalCss 已注入壳、
    // wh-proposal-* 玻璃覆盖在 liquidGlass 里 → live 数据 + 玻璃质感。面板内动作(通过/打回/采纳)仍走既有
    // bindGoldPathNavigation 管线(根上委托,重渲不脱钩)。失败保留 fixture 面板,绝不空。
    const proposalPanel = root.querySelector<HTMLElement>("[data-wh-panel=\"proposal\"]");
    // findings[#low]：连点不同详情时多个 load 并发，last-resolved 会覆盖 last-clicked。
    // 用单调代次：await 回来后若已不是最新一发，就放弃写面板。
    let proposalLoadGen = 0;
    const loadLiveProposal = async (proposalId: string) => {
      if (!proposalPanel || !proposalId) {
        return;
      }
      const gen = ++proposalLoadGen;
      try {
        const vm = await client.pages.proposal(proposalId, { locale });
        if (gen !== proposalLoadGen) {
          return;
        }
        proposalPanel.innerHTML = renderProposalDetail(vm, "desktop", { locale }).html;
      } catch {
        // 保留 fixture 面板,不打断用户。
      }
    };
    root.addEventListener("click", (event) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const href = link?.getAttribute("href");
      const matched = href ? /^\/proposals\/([^/?#]+)/u.exec(href) : null;
      if (matched && matched[1]) {
        void loadLiveProposal(matched[1]);
      }
    });
    const proposalHashMatch = /^\/proposals\/([^/?#]+)/u.exec(window.location.hash.slice(1));
    if (proposalHashMatch && proposalHashMatch[1]) {
      void loadLiveProposal(proposalHashMatch[1]);
    }
    // R7:gold-path 详情页(approvals/workitem/replay/cost)改用 LIVE 数据(桌面壳本是 P0.5 fixture)。
    // 它们都由 renderGoldPathSurface 内部渲染、用 gold-path 类(壳已玻璃化),无独立 css/无 :root 冲突——
    // 故统一范式:导航到对应路由时,拿 live page_vm 重建 surface→renderGoldPathSurface('desktop')→抽该面板
    // html→swap(天然玻璃)。失败保留 fixture。(proposal 详情走更丰富的 renderProposalDetail,见上,不在此列。)
    const liveGoldPathPages = [
      { key: "approvals", match: /^\/approvals(?:[/?#]|$)/u, load: async () => ({ approvals: await client.pages.approvals({ locale }) }) },
      { key: "workitem", match: /^\/workitems\/([^/?#]+)/u, load: async (id?: string) => (id ? { workitem: await client.pages.workItem(id, { locale }) } : {}) },
      { key: "replay", match: /^\/agent-runs\/([^/?#]+)\/replay/u, load: async (id?: string) => (id ? { replay: await client.replayAgentRun(id, { locale }) } : {}) },
      { key: "cost", match: /^\/dashboard\/cost(?:[/?#]|$)/u, load: async () => ({ cost: await client.pages.cost({ locale }) }) }
    ];
    // findings[#low]：同款代次守卫——并发 gold-path load 只让最新一发写面板。
    let goldPathLoadGen = 0;
    const renderLiveGoldPathPanel = async (entry: typeof liveGoldPathPages[number], id?: string) => {
      const panel = root.querySelector<HTMLElement>(`[data-wh-panel="${entry.key}"]`);
      if (!panel) {
        return;
      }
      const gen = ++goldPathLoadGen;
      try {
        const patch = await entry.load(id);
        if (gen !== goldPathLoadGen) {
          return;
        }
        const liveSurface = { ...surfaceVm, page_vms: { ...surfaceVm.page_vms, ...patch } };
        const page = renderGoldPathSurface(liveSurface, "desktop", { locale }).pages.find((p) => p.key === entry.key);
        if (page) {
          panel.innerHTML = page.html;
        }
      } catch {
        // 保留 fixture 面板,不打断用户。
      }
    };
    const triggerLiveGoldPathForRoute = (route: string) => {
      for (const entry of liveGoldPathPages) {
        const matched = entry.match.exec(route);
        if (matched) {
          void renderLiveGoldPathPanel(entry, matched[1]);
          return;
        }
      }
    };
    root.addEventListener("click", (event) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const href = link?.getAttribute("href");
      if (href) {
        triggerLiveGoldPathForRoute(href);
      }
    });
    triggerLiveGoldPathForRoute(window.location.hash.slice(1));
    // findings[29]：浏览器后退/前进(hashchange)也要刷新 live 详情面板。懒加载面板已经过 activateRoute
    // 接上 hashchange(M31)，但 proposal / gold-path live 详情此前只在 click + 初始 boot 触发——back/forward
    // 会停在陈旧或从未加载的面板上。这里补一个 hashchange 监听，按当前 hash 复跑两个 live 详情加载器
    // (二者对空/不匹配路由都是 no-op，重渲是幂等纯 swap，失败保留 fixture)。
    window.addEventListener("hashchange", () => {
      const hashRoute = window.location.hash.slice(1);
      const proposalMatch = /^\/proposals\/([^/?#]+)/u.exec(hashRoute);
      if (proposalMatch?.[1]) {
        void loadLiveProposal(proposalMatch[1]);
      }
      triggerLiveGoldPathForRoute(hashRoute);
    });
    // R7 P4:桌面专属「团队」「项目」页。共享 gold-path surface 无 team/projects page_vm,
    // 故经 mountLazyDesktopPanel 在壳里注入桌面 only 导航项+面板,数据懒加载(首次进入才拉)。
    // 后端零改动:团队日历走 GET /api/pages/calendar、项目清单走 GET /api/projects(均已实现)。
    const zh = locale === "zh-CN";
    // M31：懒加载面板的路由→数据加载器共享表；mountLazyDesktopPanel 注册，bindGoldPathNavigation 激活时触发。
    const lazyPanelLoaders = new Map<string, () => void>();
    const registerLazyLoader = (route: string, load: () => void) => lazyPanelLoaders.set(route, load);
    mountLazyDesktopPanel(root, shell, {
      key: "team",
      registerLoader: registerLazyLoader,
      navLabel: zh ? "团队" : "Team",
      loadingHtml: desktopLazyLoadingHtml(zh ? "正在拉团队日历…" : "Loading team calendar…"),
      errorHtml: desktopLazyLoadingHtml(zh ? "日历没拉到，再点一次「团队」重试～" : "Couldn't load — tap Team again to retry"),
      load: async (host) => {
        const calendar = await client.pages.calendar({ locale });
        host.innerHTML = renderTeamCalendarHtml({ page: calendar, locale });
      }
    });
    mountLazyDesktopPanel(root, shell, {
      key: "projects",
      registerLoader: registerLazyLoader,
      navLabel: zh ? "项目" : "Projects",
      loadingHtml: desktopLazyLoadingHtml(zh ? "正在拉项目…" : "Loading projects…"),
      errorHtml: desktopLazyLoadingHtml(zh ? "项目没拉到，再点一次「项目」重试～" : "Couldn't load — tap Projects again to retry"),
      load: async (host) => {
        const list = await client.listProjects();
        host.innerHTML = renderProjectsListHtml({ page: list, locale });
      }
    });
    // 桌面端「团队技能」页与 web /dashboard/skills 对齐:懒拉 GET /api/pages/skills,
    // 复用共享 renderWebRouteComponent({key:"skills"})——卡片/版本/置信/「精修自 vN」provenance 徽章全一致。
    // 组件 css(wh-r4-route*)随面板内联;wh-card/wh-pill/wh-subtle 来自壳的 goldPathCss(天然玻璃)。
    mountLazyDesktopPanel(root, shell, {
      key: "skills",
      registerLoader: registerLazyLoader,
      navLabel: zh ? "团队技能" : "Team skills",
      loadingHtml: desktopLazyLoadingHtml(zh ? "正在拉团队技能…" : "Loading team skills…"),
      errorHtml: desktopLazyLoadingHtml(zh ? "技能没拉到，再点一次「团队技能」重试～" : "Couldn't load — tap Team skills again to retry"),
      load: async (host) => {
        const skills = await client.pages.skills({ locale });
        const component = renderWebRouteComponent({ key: "skills", skills }, { locale });
        host.innerHTML = `<style>${component.css}</style>${component.html}`;
      }
    });
    // R7 P4:项目卡下钻——点项目卡(无 href 的 <a>,nav 管线不劫持)快照当前列表 HTML,懒拉该项目
    // 文件(client.pages.drive)渲染只读玻璃文件浏览;「返回项目」(纯 button)还原列表快照。
    // 失败:还原列表 + 轻提示,绝不卡死面板。下钻态会停留在子视图(再进 projects 不重置),可接受。
    let projectsListSnapshot = "";
    root.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) {
        return;
      }
      const host = root.querySelector<HTMLElement>("[data-wh-panel=\"projects\"] [data-wh-lazy-host]");
      if (!host) {
        return;
      }
      const back = target.closest("[data-proj-back]");
      if (back && host.contains(back)) {
        if (projectsListSnapshot) {
          host.innerHTML = projectsListSnapshot;
        }
        return;
      }
      const card = target.closest<HTMLElement>("[data-project-id]");
      if (!card || !host.contains(card)) {
        return;
      }
      const projectId = card.dataset.projectId;
      if (!projectId) {
        return;
      }
      const projectName = card.dataset.projectName ?? "";
      projectsListSnapshot = host.innerHTML;
      host.innerHTML = desktopLazyLoadingHtml(zh ? "正在打开项目…" : "Opening project…");
      void (async () => {
        try {
          const drive = await client.pages.drive({ project_id: projectId, locale });
          host.innerHTML = renderProjectDriveHtml({ drive, projectName, locale });
        } catch {
          if (projectsListSnapshot) {
            host.innerHTML = projectsListSnapshot;
          }
          showNotice(root, zh ? "项目文件没打开，请重试～" : "Couldn't open the project files — please retry");
        }
      })();
    });
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
      lazyPanelLoaders,
      onActionSettled: () => {
        void refreshDecisionDeck();
        // 动作落库后也回拉当前打开的 live gold-path 详情页(approvals/workitem/replay/cost),让它前进/更新。
        triggerLiveGoldPathForRoute(window.location.hash.slice(1));
      }
    });
  } catch (error) {
    // 测试反馈修复（窗口空白）：连不上后端时不再留空白/晦涩报错，渲一张清晰的玻璃「离线卡」——
    // 说明需要后端、当前连接地址、怎么改地址、重试按钮。否则用户只看到一片透明玻璃，不知所措。
    const zh = locale === "zh-CN";
    const apiBase = resolveDesktopApiBase();
    const detail = error instanceof Error ? error.message : String(error);
    const esc = (s: string) =>
      s.replace(/[&<>"]/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c] ?? c));
    const title = zh ? "暂时连不上后端" : "Can't reach the backend";
    const body = zh
      ? `WorkHub 桌面端要后端在运行才会有内容。当前连接：${apiBase}`
      : `The WorkHub desktop client needs the backend running to show content. Trying: ${apiBase}`;
    const hint = zh
      ? "请先启动后端（默认端口 8787，见 DEPLOY.md 的 docker compose），或在开发者控制台执行 localStorage.setItem('workhub_api_base','http://你的后端:端口') 后点重试。"
      : "Start the backend (default port 8787, see DEPLOY.md), or run localStorage.setItem('workhub_api_base','http://host:port') in the console, then Retry.";
    root.innerHTML =
      `<style>html,body{margin:0;background:rgba(240,242,252,.20)}</style>` +
      `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;box-sizing:border-box;font-family:'M PLUS Rounded 1c','Noto Sans SC','Segoe UI',sans-serif">` +
      `<div style="max-width:520px;width:100%;border-radius:22px;padding:30px 30px 26px;background:rgba(255,255,255,.92);border:1px solid rgba(255,255,255,.85);box-shadow:0 26px 60px -28px rgba(70,54,140,.5);backdrop-filter:blur(30px) saturate(170%);-webkit-backdrop-filter:blur(30px) saturate(170%)">` +
      `<div style="width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#5a45d8,#b57bff);margin-bottom:16px;box-shadow:0 10px 22px -6px rgba(124,131,255,.7)"></div>` +
      `<h2 style="margin:0 0 10px;font-size:20px;font-weight:900;color:#2c2746">${esc(title)}</h2>` +
      `<p style="margin:0 0 12px;color:#5b5680;line-height:1.55">${esc(body)}</p>` +
      `<p style="margin:0 0 18px;color:#8b84ad;font-size:13px;line-height:1.5">${esc(hint)}</p>` +
      `<button id="wh-retry" type="button" style="border:0;border-radius:12px;padding:10px 18px;font:inherit;font-weight:800;color:#fff;background:linear-gradient(135deg,#7c83ff,#b57bff);cursor:pointer">${zh ? "重试" : "Retry"}</button>` +
      `<p style="margin:14px 0 0;color:#aaa4c4;font-size:11px;word-break:break-all">${esc(detail)}</p>` +
      `</div></div>`;
    root.querySelector<HTMLButtonElement>("#wh-retry")?.addEventListener("click", () => window.location.reload());
  }
}

if (root && resolveDesktopSurface() === "pet") {
  void bootDesktopPetSurface(root);
} else {
  void boot();
}
