import { createApiClient, WorkHubApiError } from "@workhub/api-client/client";
import { eventTypes, type ActionSpec } from "@workhub/contracts";
import {
  classifyGoldPathHref,
  goldPathT,
  normalizeWorkHubLocale,
  type GoldPathAppShell,
  type WorkHubLocale
} from "@workhub/ui/gold-path";
import { renderProposalConflictCards } from "@workhub/ui/proposal";
import { renderOnboardingScreen } from "@workhub/ui";
import {
  acceptedDeliverableRestoreFromHref,
  actionElementApplyPayload,
  actionElementCreateProjectPayload,
  actionElementCreateWorkItemPayload,
  actionElementEvidenceBindingPayload,
  actionElementJsonPayload,
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
  bootstrapProjectActionFromHref,
  createNamedProjectActionFromHref,
  clearActiveRouteDirty as sharedClearActiveRouteDirty,
  clearLiveDirtyMetrics as sharedClearLiveDirtyMetrics,
  conflictsFromMergeError,
  createWebLiveRuntime,
  createWorkItemActionFromHref,
  desktopRequiredNotice,
  dirtyGuardRefreshAction,
  driveCommentDraftFromHref,
  driveDraftProposalFromHref,
  driveItemMutationFromHref,
  driveUploadFromHref,
  eventListenerOptions,
  evidenceBindingWorkItemIdFromHref,
  escapeHtml,
  fieldValueRequiredNotice,
  inspectPostRunWorkItemClarity,
  intakeOptionRequiredNotice,
  localePersistenceFailedNotice,
  markActiveRouteDirty as sharedMarkActiveRouteDirty,
  mergeConflictNotice,
  mergeProposalCandidateApplyIdFromHref,
  meetingDraftProposalFromHref,
  meetingInsightActionFromHref,
  notificationActionFromHref,
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
  startAgentRunActionFromHref,
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
  mountReactRouteIsland,
  setReactRouteDirtyHandler,
  unmountReactRouteIsland
} from "./react-route-mount.js";

const root = document.getElementById("root");
const liveLastEventIdStorageKey = "workhub.live.lastEventId";
type BrowserApiClient = ReturnType<typeof createApiClient>;
const noticeTimerState: RouteNoticeTimerState = {};
let readyRouteBindings: AbortController | undefined;
let liveDirtyGuardCount = 0;
let liveRuntime: ReturnType<typeof createWebLiveRuntime> | undefined;
type ShellIdentityUser = { nickname: string; isAdmin: boolean };
let currentIdentity: ShellIdentityUser | undefined;
let activeLocale: WorkHubLocale = "zh-CN";
const liveEventTypes = Object.values(eventTypes);
const postRunTerminalStatuses = new Set(["succeeded", "failed", "cancelled"]);
const postRunTerminalPollIntervalMs = 1000;
const postRunTerminalMaxWaitMs = 60000;
const postRunClarityPollDelaysMs = [0, 1000, 2000, 3000, 4000];
let postRunClarityMonitorToken = 0;

// L13：以前意图框留空点「开始派活」会被悄悄塞进一段固定的「试点反馈」任务——用户从没写过、也看不出
// 自己的空输入被替换了，结果凭空创建了一条看不懂的澄清会话。改为返回真实输入(可能为空)，由调用方
// fail-closed(和「新建项目」一样弹 field_value_required)，绝不替换用户没写的内容。占位符已给出示例引导。
function startIntentText(actionTarget: HTMLElement) {
  const route = actionTarget.closest<HTMLElement>("[data-r4-route-component=\"intake\"]");
  const input = route?.querySelector<HTMLTextAreaElement>("[data-s1-day1-intent-input]");
  return input?.value.trim() ?? "";
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function currentRouteIsWorkItem(workItemId: string) {
  const match = currentRouteMatch();
  return match.key === "workitem" && match.params["id"] === workItemId;
}

function setPostRunClarityMetric(key: string, value: unknown) {
  setLiveMetric(`s1Day2PostRun${key}`, value);
}

function postRunClarityActionHtml(workItemId: string, runId: string, locale: WorkHubLocale) {
  const refreshLabel = locale === "en-US" ? "Refresh task" : "刷新任务";
  const replayLabel = locale === "en-US" ? "Open replay" : "打开回放";
  return `<a class="wh-btn" href="/workitems/${escapeHtml(encodeURIComponent(workItemId))}" data-s1-day2-post-run-refresh-action="true">${escapeHtml(refreshLabel)}</a><a class="wh-btn" href="/agent-runs/${escapeHtml(encodeURIComponent(runId))}/replay" data-s1-day2-post-run-replay-action="true">${escapeHtml(replayLabel)}</a>`;
}

function postRunClarityReadyBody(locale: WorkHubLocale, actionKind: string | undefined) {
  if (locale === "en-US") {
    return actionKind === "proposal"
      ? "The proposal is ready on this task. Review it from the visible next action."
      : "The run replay is ready on this task. Open it from the visible next action.";
  }
  return actionKind === "proposal"
    ? "变更申请已生成，点任务上的“下一步”即可进入审阅。"
    : "执行回放已生成，点任务上的“下一步”即可查看过程。";
}

function postRunClarityFallbackNotice(locale: WorkHubLocale, actionId?: string): RouteNoticeVM {
  return {
    kind: "action_pending",
    tone: "warning",
    source: "client",
    locale,
    title: locale === "en-US" ? "Next step needs a refresh" : "下一步需要刷新",
    body: locale === "en-US"
      ? "The AI run finished, but this task has not exposed Proposal or Replay yet. Refresh the task or open replay."
      : "AI 执行已结束，但任务页还没显示结果。请刷新任务，或打开回放查看。",
    actionId
  };
}

async function waitForRunTerminal(
  client: BrowserApiClient,
  runId: string,
  workItemId: string,
  monitorToken: number
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= postRunTerminalMaxWaitMs) {
    if (monitorToken !== postRunClarityMonitorToken || !currentRouteIsWorkItem(workItemId)) {
      return "stopped" as const;
    }
    try {
      const run = await client.getAgentRun(runId);
      setPostRunClarityMetric("RunStatus", run.status);
      if (postRunTerminalStatuses.has(run.status)) {
        return run.status;
      }
    } catch (error) {
      // findings[#30]：轮询期间的瞬态错误(网络抖动/偶发 5xx)不该让 run 监控冒泡成致命错误屏。明确的会话失效/
      // 资源不存在(not_identified/401/403/404)→ 停止监控(stopped，上层走手动刷新)；其余按瞬态处理，sleep 后继续
      // 轮询，最终只会以 timeout 收尾(同样是手动刷新)，绝不抛致命错误。
      if (error instanceof WorkHubApiError
        && (error.code === "not_identified" || error.status === 401 || error.status === 403 || error.status === 404)) {
        return "stopped" as const;
      }
    }
    await sleep(postRunTerminalPollIntervalMs);
  }
  return "timeout" as const;
}

async function monitorPostRunWorkItemClarity(input: {
  client: BrowserApiClient;
  locale: WorkHubLocale;
  workItemId: string;
  runId: string;
  actionId?: string | undefined;
  monitorToken: number;
}) {
  const { client, locale, workItemId, runId, actionId, monitorToken } = input;
  setPostRunClarityMetric("Monitor", "waiting-terminal");
  setPostRunClarityMetric("RunId", runId);
  const terminal = await waitForRunTerminal(client, runId, workItemId, monitorToken);
  if (terminal === "stopped") {
    setPostRunClarityMetric("Monitor", "stopped");
    return;
  }
  if (terminal === "timeout") {
    setPostRunClarityMetric("Monitor", "terminal-timeout");
    if (root && currentRouteIsWorkItem(workItemId)) {
      showRouteNotice(root, postRunClarityFallbackNotice(locale, actionId), postRunClarityActionHtml(workItemId, runId, locale), 0);
    }
    return;
  }

  setPostRunClarityMetric("Monitor", "terminal");
  for (const delayMs of postRunClarityPollDelaysMs) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    if (monitorToken !== postRunClarityMonitorToken || !currentRouteIsWorkItem(workItemId)) {
      setPostRunClarityMetric("Monitor", "stopped");
      return;
    }
    await renderCurrentRoute(client, locale);
    if (!root || !currentRouteIsWorkItem(workItemId)) {
      setPostRunClarityMetric("Monitor", "stopped");
      return;
    }
    const clarity = inspectPostRunWorkItemClarity(root, workItemId);
    setPostRunClarityMetric("ActionCount", clarity.actionCount);
    if (clarity.actionKind) {
      setPostRunClarityMetric("Monitor", "ready");
      setPostRunClarityMetric("NextAction", clarity.actionKind);
      showRouteNotice(root, actionSuccessNotice(locale, postRunClarityReadyBody(locale, clarity.actionKind), actionId), undefined, 5200);
      return;
    }
  }
  setPostRunClarityMetric("Monitor", "manual-refresh");
  if (root && currentRouteIsWorkItem(workItemId)) {
    showRouteNotice(root, postRunClarityFallbackNotice(locale, actionId), postRunClarityActionHtml(workItemId, runId, locale), 0);
  }
}

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

// M11/L17: after an approve, replace the proposal page's action row in place with the
// server-provided next action (the explicit "采纳到正式版" merge button). Lightweight DOM
// surgery — deliberately NOT a route refetch (which re-runs the loader and trips the
// SSE/dirty-edit/loader smoke gates; see M12). The injected <a> carries the same
// data-action-id/data-method/href contract the delegated click handler expects, so the
// merge click flows through the existing proposalAction "merge" branch.
function swapProposalActionRow(shellRoot: HTMLElement, action: ActionSpec) {
  const row = shellRoot.querySelector<HTMLElement>(
    '[data-r4-proposal-summary="true"] .wh-r4-route-actions'
  );
  if (!row) {
    return;
  }
  const link = document.createElement("a");
  link.className = "wh-btn wh-btn-primary";
  link.setAttribute("href", action.href);
  link.dataset.actionId = action.id;
  link.dataset.method = action.method;
  link.textContent = action.label;
  row.replaceChildren(link);
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

function identityUserFrom(identity: unknown): ShellIdentityUser | undefined {
  if (!identity || typeof identity !== "object") {
    return undefined;
  }
  const record = identity as Record<string, unknown>;
  const nickname = typeof record["nickname"] === "string" ? record["nickname"].trim() : "";
  if (!nickname) {
    return undefined;
  }
  return { nickname, isAdmin: record["is_admin"] === true };
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
  void shell;
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

// P-COLLAB「对一下底稿再采纳」：采纳撞上最后防线(rebase_required)时,先对最新正式版重算冲突,
// 再用既有三选项冲突卡片让用户解决,然后重新采纳。
async function showRebaseRequiredNotice(
  shellRoot: HTMLElement,
  error: unknown,
  proposalId: string,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  actionId?: string
): Promise<boolean> {
  if (!(error instanceof WorkHubApiError) || error.code !== "rebase_required") {
    return false;
  }
  const result = await client.rebaseProposal(proposalId);
  const rendered = renderProposalConflictCards(result.conflicts, { locale });
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

  // M2：项目名输入框按 Enter 即触发「新建项目」——该表单的动作是锚点，原生 Enter 不会提交。
  shellRoot.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !(event.target instanceof HTMLElement) || !event.target.matches("[data-r8-project-name-input]")) {
      return;
    }
    event.preventDefault();
    event.target.closest("[data-r8-project-create-form]")?.querySelector<HTMLElement>("[data-r8-project-create]")?.click();
  });

  // rank5：网盘项目切换器用 CSP 合规的委托 change 监听 + SPA 导航，取代被 CSP 禁的内联 onchange/整页刷新。
  // option 的 value 已是完整 href（/drive?project_id=…）；空 value（M3 占位「当前项目」）不导航。
  shellRoot.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || !target.matches("[data-r8-drive-project-switcher]")) {
      return;
    }
    const href = target.value;
    if (href) {
      void navigateWebRoute(href, client, locale);
    }
  });

  shellRoot.addEventListener("click", async (event) => {
    const logoutButton = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-wh-logout]") : null;
    if (logoutButton) {
      event.preventDefault();
      try {
        await client.logout();
      } catch {
        // cookie 已失效也视为登出成功，fail-closed 回注册屏。
      }
      showOnboardingScreen(client, locale);
      return;
    }

    // W2：左栏选择——点选一行，高亮它、显示对应中栏详情面板、把右栏决策按钮重绑到选中事项。
    const approvalRow = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-r4-approval-item]") : null;
    if (approvalRow && !(event.target instanceof Element && event.target.closest("a,button,textarea,input,form"))) {
      const itemId = approvalRow.dataset["r4ApprovalItem"];
      if (itemId) {
        shellRoot.querySelectorAll<HTMLElement>("[data-r4-approval-item]").forEach((rowEl) => {
          rowEl.setAttribute("data-r4-approval-selected", String(rowEl === approvalRow));
        });
        shellRoot.querySelectorAll<HTMLElement>("[data-r4-approval-detail-for]").forEach((panel) => {
          if (panel.dataset["r4ApprovalDetailFor"] === itemId) {
            panel.removeAttribute("hidden");
          } else {
            panel.setAttribute("hidden", "");
          }
        });
        const respondHref = approvalRow.dataset["r4ApprovalRespondHref"];
        if (respondHref) {
          shellRoot.querySelectorAll<HTMLAnchorElement>("[data-r4-approval-action-panel] a[data-action-id]").forEach((link) => {
            const id = link.getAttribute("data-action-id");
            if (id === "approve" || id === "deny") {
              link.setAttribute("href", respondHref);
            }
          });
        }
      }
      return;
    }

    // W2：相关讨论——发表评论（乐观追加，再回填服务端结果）。
    const commentSubmit = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-r4-approval-comment-submit]") : null;
    if (commentSubmit) {
      event.preventDefault();
      const approvalId = commentSubmit.dataset["r4ApprovalCommentSubmit"];
      const form = commentSubmit.closest<HTMLFormElement>("[data-r4-approval-comment-form]");
      const input = form?.querySelector<HTMLTextAreaElement>("[data-r4-approval-comment-input]");
      const body = input?.value.trim();
      if (approvalId && body) {
        try {
          const comment = await client.postApprovalComment(approvalId, { body });
          // R4 #27：await 期间路由可能被 SSE 重渲/导航重建，form 会脱离 DOM——此时 insertBefore 静默落到
          // 已分离的节点、乐观追加丢失。仅当 form 仍挂在文档上才乐观插入；否则跳过（评论已落库，下次渲染自然带出）。
          if (form && input && form.isConnected) {
            // L#W2-16：首条评论先移除「还没有讨论」空态占位，避免占位与新评论并存。
            commentSubmit.closest("[data-r4-approval-discussion]")?.querySelector("p.wh-subtle")?.remove();
            const row = document.createElement("div");
            row.className = "wh-r4-route-row wh-r4-route-row--stacked";
            row.setAttribute("data-r4-approval-comment", comment.id);
            const author = document.createElement("strong");
            author.textContent = comment.author_label;
            const text = document.createElement("p");
            text.textContent = comment.body;
            row.append(author, text);
            form.parentElement?.insertBefore(row, form);
            input.value = "";
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, "approval_comment"));
        }
      }
      return;
    }

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
          clearActiveRouteDirty();
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, pendingReviewActionId ?? "request_changes"));
        }
      }
      if (pendingApprovalId) {
        try {
          const remember = shellRoot.querySelector<HTMLInputElement>("[data-r4-approval-remember]")?.checked ? "always" : "once";
          // L#W2-17：优先用决策面板里手写的「意见说明」，没写才回落到预设理由按钮。
          const customReason = shellRoot.querySelector<HTMLTextAreaElement>("[data-r4-approval-reason]")?.value.trim();
          const result = await client.respondApproval(pendingApprovalId, {
            decision: "deny",
            reason_md: customReason || reasonMd,
            remember
          });
          showRouteNotice(shellRoot, actionSuccessNotice(locale, actionSummary(result, locale), pendingApprovalActionId ?? "deny"));
          pendingApprovalId = undefined;
          pendingApprovalActionId = undefined;
          clearActiveRouteDirty();
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
      if (createNamedProjectActionFromHref(href) && actionTarget.dataset.r8ProjectCreate === "true") {
        const payload = actionElementCreateProjectPayload(actionTarget);
        if (!payload.ok || !payload.payload) {
          showPayloadFailureNotice(shellRoot, locale, payload.ok ? { ok: false, reason: "field_value_required" } : payload, actionId);
          return;
        }
        try {
          const created = await client.bootstrapProject(payload.payload);
          // GitHub 式落点：新建/复用项目后进它的项目主页（hub），而非直接跳网盘——主页再分流到网盘/派活。
          await navigateWebRoute(`/projects/${encodeURIComponent(created.project.id)}`, client, locale);
          if (root) {
            // H2：区分「真新建」与「同 slug 复用已有」，别把落进现有项目误报成已创建。
            const body = created.created
              ? (locale === "en-US" ? `Created project: ${created.project.name}.` : `已创建项目：${created.project.name}。`)
              : (locale === "en-US" ? `Opened existing project: ${created.project.name}.` : `已打开同名的现有项目：${created.project.name}。`);
            showRouteNotice(root, actionSuccessNotice(locale, body, actionId));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      if (bootstrapProjectActionFromHref(href) && actionTarget.dataset.s1Day0StartIntake === "true") {
        // S4b：从项目主页「新任务」进来时动作带 data-s4b-project-id → 直接在该项目建会话，跳过「试点项目」bootstrap。
        const existingProjectId = actionTarget.dataset.s4bProjectId;
        const intentText = startIntentText(actionTarget);
        if (!intentText) {
          // L13：意图为空就 fail-closed，提示用户先写要做什么，绝不替换成预设任务。
          showRouteNotice(shellRoot, fieldValueRequiredNotice(locale, actionId));
          return;
        }
        if (existingProjectId) {
          try {
            const session = await client.createSession({
              project_id: existingProjectId,
              intent_text: intentText
            });
            await navigateWebRoute(`/intake/${session.session_id}`, client, locale);
            if (root) {
              const body = locale === "en-US" ? "Intake is open for this project." : "已在该项目里打开接入会话。";
              showRouteNotice(root, actionSuccessNotice(locale, body, actionId));
            }
          } catch (error) {
            showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
          }
          return;
        }
        const payload = actionElementJsonPayload<Parameters<BrowserApiClient["bootstrapProject"]>[0]>(actionTarget);
        if (!payload.ok) {
          showPayloadFailureNotice(shellRoot, locale, payload, actionId);
          return;
        }
        try {
          const project = await client.bootstrapProject(payload.payload ?? {});
          const session = await client.createSession({
            project_id: project.project.id,
            intent_text: intentText
          });
          await navigateWebRoute(`/intake/${session.session_id}`, client, locale);
          if (root) {
            const body = locale === "en-US"
              ? `Project ready: ${project.project.name}. Intake is open.`
              : `项目已就绪：${project.project.name}。接入会话已打开。`;
            showRouteNotice(root, actionSuccessNotice(locale, body, actionId));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
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
      const startAgentRun = startAgentRunActionFromHref(href);
      if (startAgentRun) {
        try {
          const run = await client.startAgentRun(startAgentRun.workItemId);
          await navigateWebRoute(`/workitems/${startAgentRun.workItemId}`, client, locale);
          const monitorToken = ++postRunClarityMonitorToken;
          if (root) {
            const body = locale === "en-US"
              ? `AI run queued: ${run.run_id}. WorkHub will refresh this task, then surface Proposal or Replay.`
              : `AI 执行已排队：${run.run_id}。WorkHub 会刷新任务，并把 Proposal 或 Replay 露出来。`;
            showRouteNotice(root, actionSuccessNotice(locale, body, actionId ?? "start_agent_run"));
          }
          void monitorPostRunWorkItemClarity({
            client,
            locale,
            workItemId: startAgentRun.workItemId,
            runId: run.run_id,
            actionId: actionId ?? "start_agent_run",
            monitorToken
          }).catch((error) => {
            setPostRunClarityMetric("Monitor", "error");
            if (root && currentRouteIsWorkItem(startAgentRun.workItemId)) {
              showRouteNotice(root, actionErrorNotice(locale, error, actionId ?? "start_agent_run"));
            }
          });
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId ?? "start_agent_run"));
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
      const driveUpload = driveUploadFromHref(href);
      if (driveUpload) {
        const payload = actionElementJsonPayload<Parameters<BrowserApiClient["uploadDriveFile"]>[1]>(actionTarget);
        if (!payload.ok || !payload.payload) {
          showPayloadFailureNotice(shellRoot, locale, payload.ok ? { ok: false, reason: "invalid_json" } : payload, actionId);
          return;
        }
        try {
          const result = await client.uploadDriveFile(driveUpload.projectId, payload.payload, { locale });
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      const driveItemMutation = driveItemMutationFromHref(href);
      if (driveItemMutation?.action === "delete") {
        const payload = actionElementJsonPayload<Parameters<BrowserApiClient["deleteDriveItem"]>[2]>(actionTarget);
        if (!payload.ok) {
          showPayloadFailureNotice(shellRoot, locale, payload, actionId);
          return;
        }
        try {
          const result = await client.deleteDriveItem(driveItemMutation.projectId, driveItemMutation.itemId, payload.payload ?? {}, { locale });
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      if (driveItemMutation?.action === "restore") {
        try {
          const result = await client.restoreDriveItem(driveItemMutation.projectId, driveItemMutation.itemId, { locale });
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      const driveCommentDraft = driveCommentDraftFromHref(href);
      if (driveCommentDraft) {
        try {
          const result = await client.createDriveCommentDraft(driveCommentDraft.projectId, driveCommentDraft.commentId, { locale });
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      const driveDraftProposal = driveDraftProposalFromHref(href);
      if (driveDraftProposal) {
        try {
          const result = await client.createDriveDraftProposal(driveDraftProposal.workItemId, { locale });
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      const meetingInsightAction = meetingInsightActionFromHref(href);
      if (meetingInsightAction?.action === "draft") {
        try {
          const result = await client.createMeetingInsightDraft(meetingInsightAction.projectId, meetingInsightAction.insightId, { locale });
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      if (meetingInsightAction?.action === "dismiss") {
        try {
          const result = await client.dismissMeetingInsight(meetingInsightAction.projectId, meetingInsightAction.insightId, { locale });
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      const meetingDraftProposal = meetingDraftProposalFromHref(href);
      if (meetingDraftProposal) {
        try {
          const result = await client.createMeetingDraftProposal(meetingDraftProposal.workItemId, { locale });
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      const notificationAction = notificationActionFromHref(href);
      if (notificationAction?.action === "mark_all_read") {
        try {
          const result = await client.markAllNotificationsRead();
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId ?? "notification_mark_all_read"));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      if (notificationAction?.action === "read") {
        try {
          const result = await client.markNotificationRead(notificationAction.notificationId);
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId ?? "notification_mark_read"));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      if (notificationAction?.action === "dismiss") {
        try {
          const result = await client.dismissNotification(notificationAction.notificationId);
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId ?? "notification_dismiss"));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      if (notificationAction?.action === "complete") {
        try {
          const result = await client.completeNotification(notificationAction.notificationId);
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId ?? "notification_complete"));
          }
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
          markActiveRouteDirty("review_reason_pending");
          showRouteNotice(shellRoot, reasonRequiredNotice(locale, pendingApprovalActionId), reviewReasonButtons(locale));
          return;
        }
        try {
          const remember = shellRoot.querySelector<HTMLInputElement>("[data-r4-approval-remember]")?.checked ? "always" : "once";
          const result = await client.respondApproval(approvalRespondId, { decision: "allow", remember });
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
          markActiveRouteDirty("review_reason_pending");
          showRouteNotice(shellRoot, reasonRequiredNotice(locale, pendingReviewActionId), reviewReasonButtons(locale));
          return;
        }
        try {
          const review = await client.reviewProposal(proposalAction.proposalId, { decision: "approve", remember: "once" });
          // M11/L17: approve is a first-class review step (status → reviewed). The
          // irreversible publish to the official version is now a SEPARATE deliberate
          // click — a GitHub-like approve-then-merge flow, not a silent one-click merge.
          // Swap the action row in place to the server-provided next action ("采纳到正式版")
          // via a lightweight DOM update — NOT a full route refetch, which would re-run the
          // loader and break the SSE/dirty-edit/loader smoke gates (see M12).
          if (review.next_action) {
            swapProposalActionRow(shellRoot, review.next_action);
          }
          clearActiveRouteDirty();
          showRouteNotice(shellRoot, actionSuccessNotice(locale, review.attention.summary_text, actionId));
        } catch (error) {
          if (await showRebaseRequiredNotice(shellRoot, error, proposalAction.proposalId, client, locale, actionId)) {
            return;
          }
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
          if (await showRebaseRequiredNotice(shellRoot, error, proposalAction.proposalId, client, locale, actionId)) {
            return;
          }
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
    const intakeFreeText = event.target instanceof Element
      ? event.target.closest<HTMLTextAreaElement>("[data-intake-free-text-input]")
      : null;
    if (intakeFreeText) {
      const intakeRoute = intakeFreeText.closest<HTMLElement>("[data-r4-route-component=\"intake\"]");
      if (intakeRoute) {
        updateIntakeActionPayloads(intakeRoute);
        if (intakeFreeText.value.trim().length > 0) {
          markActiveRouteDirty("intake_free_text");
        }
      }
    }
    const intakeStartText = event.target instanceof Element
      ? event.target.closest<HTMLTextAreaElement>("[data-s1-day1-intent-input]")
      : null;
    if (intakeStartText && intakeStartText.value.trim().length > 0) {
      markActiveRouteDirty("intake_start_intent");
    }
    const customField = event.target instanceof Element
      ? event.target.closest<HTMLTextAreaElement>("[data-structured-field-custom-input]")
      : null;
    if (customField && customField.value.trim().length > 0) {
      markActiveRouteDirty("proposal_custom_field");
    }
  }, eventListenerOptions(signal));

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
  // findings[#118]：home 此前在这里短路——只对 HIDDEN 的 React 探针岛做 sse-props 更新、设 refreshMode="react-props"
  // 后 return，从不把新 result.html 写回 root.innerHTML。但首页可见的决策卡/战绩条/后台 run 行是 renderHomeRouteComponent
  // 产出的服务端静态 HTML，只由 renderCurrentRoute 写入；React 探针是隐藏的、不管理这些可见节点。于是 SSE 事件（新决策、
  // proposal.merged、budget.warning）永远刷不新可见的决策收件箱。删掉 home 专属短路，让 home 与其它路由一样走下面的
  // dirty-check + renderCurrentRouteOrOnboard 全量重渲染（后者同样 fail-closed：not_identified 回注册屏）。
  if (activeRouteHasDirtyEdits()) {
    liveDirtyGuardCount += 1;
    setLiveMetric("r4LiveRefreshMode", "dirty-deferred");
    setLiveMetric("r4LiveDirtyGuardCount", liveDirtyGuardCount);
    setLiveMetric("r4LiveDirtyPendingEvent", eventType);
    setLiveMetric("r4LiveDirtyPendingStream", targetKey);
    return "dirty-deferred";
  }
  setLiveMetric("r4LiveRefreshMode", "page-vm-render");
  // L#79：SSE 刷新也要 fail-closed——会话过期(not_identified)时回到注册屏，
  // 而不是让错误冒泡、让用户停在一个已失效的已登录视图上。
  await renderCurrentRouteOrOnboard(client, locale);
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
        outcome === "dirty-deferred"
          // 带上 search：calendar(?date/view)、drive/meetings(?project_id)、knowledge 等路由的状态全在 query 里，
          // 只传 pathname 会让手动「刷新」丢掉当前视图参数（与 navigateWebRoute 用全 location 对齐）。
          ? dirtyGuardRefreshAction(locale, webRouteHref(`${window.location.pathname}${window.location.search}`))
          : undefined,
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
  const currentHref = `${window.location.pathname}${window.location.search}`;
  if (nextHref !== currentHref) {
    window.history.pushState(null, "", nextHref);
  }
  await renderCurrentRoute(client, locale);
}

function canonicalizeLegacyHashRoute() {
  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (!window.location.hash.startsWith("#/")) {
    document.documentElement.dataset.r4WebLegacyHashCanonicalized = "false";
    return;
  }
  const nextHref = webRouteHref(window.location.href);
  if (nextHref !== currentHref) {
    window.history.replaceState(null, "", nextHref);
  }
  document.documentElement.dataset.r4WebLegacyHashCanonicalized = "true";
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
  bindNotificationMutePanel(root, result, client, locale, signal);
  bindLiveRouteStreams(result, client, locale);
}

// 团队就绪 must-have（缺口②）：通知页静音偏好面板的客户端水合。SSR 已出折叠的 <details> + 全不勾的开关
// （route-components renderNotificationMutePanel）；这里拉当前偏好回填勾选态、change 调 PUT。纯客户端、
// best-effort——读/写失败都不挡通知页（诚实 default-off）。绑定挂在路由 AbortSignal 上，离开路由自动清。
function bindNotificationMutePanel(
  container: HTMLElement,
  result: WebRouteReadyResult,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal
) {
  if (result.match.key !== "notifications") {
    return;
  }
  const panel = container.querySelector<HTMLElement>("[data-r5-notification-mute-panel]");
  if (!panel) {
    return;
  }
  const checkboxes = Array.from(
    panel.querySelectorAll<HTMLInputElement>("input[data-r5-notification-mute-type]")
  );
  if (checkboxes.length === 0) {
    return;
  }
  const status = panel.querySelector<HTMLElement>("[data-r5-notification-mute-status]");
  const zh = locale === "zh-CN";
  const setStatus = (text: string, tone: "saving" | "saved" | "error") => {
    if (!status) {
      return;
    }
    status.hidden = false;
    status.textContent = text;
    status.setAttribute("data-r5-notification-mute-status", tone);
  };

  // 回填当前静音态（best-effort：读不出来就保持全不勾的诚实 default-off）。
  void (async () => {
    try {
      const prefs = await client.getNotificationPreferences();
      if (signal.aborted) {
        return;
      }
      const muted = new Set(prefs.muted_notification_types ?? []);
      for (const checkbox of checkboxes) {
        checkbox.checked = muted.has(checkbox.getAttribute("data-r5-notification-mute-type") ?? "");
      }
    } catch {
      // 偏好读不出来不挡用户用通知页。
    }
  })();

  const save = async () => {
    const muted = checkboxes
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.getAttribute("data-r5-notification-mute-type") ?? "")
      .filter((type) => type.length > 0);
    setStatus(zh ? "保存中…" : "Saving…", "saving");
    try {
      await client.setNotificationPreferences(muted);
      if (signal.aborted) {
        return;
      }
      setStatus(zh ? "已保存" : "Saved", "saved");
    } catch {
      if (signal.aborted) {
        return;
      }
      setStatus(zh ? "保存失败，请重试" : "Save failed, please retry", "error");
    }
  };

  for (const checkbox of checkboxes) {
    checkbox.addEventListener("change", () => void save(), { signal });
  }
}

async function renderCurrentRoute(client: BrowserApiClient, locale: WorkHubLocale) {
  if (!root) {
    return;
  }
  activeLocale = locale;
  const renderId = ++activeRouteRenderId;
  const match = currentRouteMatch();
  clearReadyRouteBindings();
  unmountReactRouteIsland();
  clearLiveDirtyMetrics();
  root.innerHTML = renderWebRouteState(match, "loading", locale).html;
  const result = await loadWebRoute(client, match, locale, currentIdentity);
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

function showOnboardingScreen(
  client: BrowserApiClient,
  locale: WorkHubLocale,
  input: { errorText?: string; presetNickname?: string } = {}
) {
  if (!root) {
    return;
  }
  clearReadyRouteBindings();
  liveRuntime?.closeAllLiveEventSources();
  // findings[#low]：live runtime 单例创建时一次性捕获 locale。登出→切语言→重登后，
  // 旧 runtime 的 onRefresh/onFatal 闭包仍绑旧 locale。登出回 onboarding 时丢弃它，
  // 让下次 bindLiveRouteStreams 用当前 locale 重建（liveRuntime ??= ...）。
  liveRuntime = undefined;
  unmountReactRouteIsland();
  clearLiveDirtyMetrics();
  currentIdentity = undefined;
  activeLocale = locale;
  setDocumentLocale(locale);
  const targetRoute = `${window.location.pathname}${window.location.search}`;
  root.innerHTML = renderOnboardingScreen({
    locale,
    targetRoute,
    ...(input.errorText ? { errorText: input.errorText } : {})
  }).html;
  bindOnboardingScreen(client, locale, input.presetNickname);
}

function bindOnboardingScreen(client: BrowserApiClient, locale: WorkHubLocale, presetNickname?: string) {
  if (!root) {
    return;
  }
  const nicknameInput = root.querySelector<HTMLInputElement>("[data-r5-9-onboarding-nickname]");
  if (nicknameInput && presetNickname) {
    nicknameInput.value = presetNickname;
  }
  nicknameInput?.focus();
  for (const option of root.querySelectorAll<HTMLButtonElement>("[data-r5-9-onboarding-locale-option]")) {
    option.addEventListener("click", (event) => {
      event.preventDefault();
      const nextLocale = normalizeWorkHubLocale(option.getAttribute("data-r5-9-onboarding-locale-option"));
      if (nextLocale === locale) {
        return;
      }
      persistBrowserLocale(nextLocale);
      showOnboardingScreen(client, nextLocale, {
        ...(nicknameInput?.value.trim() ? { presetNickname: nicknameInput.value.trim() } : {})
      });
    });
  }
  root.querySelector<HTMLFormElement>("[data-r5-9-onboarding-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitOnboarding(client, locale);
  });
}

async function submitOnboarding(client: BrowserApiClient, locale: WorkHubLocale) {
  if (!root) {
    return;
  }
  const nicknameInput = root.querySelector<HTMLInputElement>("[data-r5-9-onboarding-nickname]");
  const nickname = nicknameInput?.value.trim() ?? "";
  if (!nickname) {
    nicknameInput?.focus();
    return;
  }
  const adminSecret = root.querySelector<HTMLInputElement>("[data-r5-9-onboarding-admin-secret]")?.value.trim() ?? "";
  try {
    const identity = await client.identify({
      nickname,
      ...(adminSecret ? { admin_secret: adminSecret } : {})
    });
    currentIdentity = identityUserFrom(identity) ?? { nickname, isAdmin: false };
    persistBrowserLocale(locale);
    void client.updatePreferences({ locale }).catch(() => undefined);
    await renderCurrentRouteOrOnboard(client, locale);
  } catch (error) {
    const errorText = error instanceof Error && error.message
      ? error.message
      : goldPathT(locale, "runtime.actionFail");
    showOnboardingScreen(client, locale, { errorText, presetNickname: nickname });
  }
}

async function renderCurrentRouteOrOnboard(client: BrowserApiClient, locale: WorkHubLocale) {
  try {
    await renderCurrentRoute(client, locale);
  } catch (error) {
    if (error instanceof WorkHubApiError && error.code === "not_identified") {
      showOnboardingScreen(client, locale);
      return;
    }
    throw error;
  }
}

async function boot() {
  if (!root) {
    return;
  }
  let locale = browserLocale();
  setDocumentLocale(locale);
  canonicalizeLegacyHashRoute();
  // R4 #28：把 React island 的"进行中编辑"接进路由 dirty-guard——编辑器有未保存决策/输入时标脏，
  // SSE 刷新会延迟并提示而非静默 unmount 丢弃。只需在 boot 注册一次（markActiveRouteDirty 是稳定引用）。
  setReactRouteDirtyHandler(markActiveRouteDirty);
  root.innerHTML = renderWebRouteState(currentRouteMatch(), "idle", locale).html;

  try {
    const client = createApiClient({ baseUrl: "" });
    // 先挂导航监听，再渲染：否则首次渲染抛错时这两个监听永远注册不上，
    // 整个会话的前进/后退会静默失效（即便用户已从首屏错误中恢复）。
    window.addEventListener("popstate", () => {
      void renderCurrentRouteOrOnboard(client, activeLocale).catch((error) => renderFatalRouteError(activeLocale, error));
    });
    window.addEventListener("beforeunload", () => liveRuntime?.closeAllLiveEventSources());
    // 只有「未登录」才落注册屏：me() 在 200 空 body 时返回 null（真·未识别），或抛 401/not_identified。
    // 5xx/网络/403 等不应把已登录用户强行踢回注册——交给外层 catch 渲染可重试错误态（renderFatalRouteError）。
    let me: Awaited<ReturnType<typeof client.me>> | null;
    try {
      me = await client.me();
    } catch (error) {
      if (error instanceof WorkHubApiError && (error.status === 401 || error.code === "not_identified")) {
        showOnboardingScreen(client, locale);
        return;
      }
      throw error;
    }
    if (me) {
      locale = applyIdentityLocale(me, locale);
      currentIdentity = identityUserFrom(me);
      activeLocale = locale;
      await renderCurrentRouteOrOnboard(client, locale);
    } else {
      showOnboardingScreen(client, locale);
    }
  } catch (error) {
    renderFatalRouteError(locale, error);
  }
}

void boot();
