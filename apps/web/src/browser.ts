import { createApiClient, WorkHubApiError } from "@workhub/api-client/client";
import { eventTypes, type ActionSpec, type AiFeedbackVerdict, type PutAiFeedbackRequest, type SearchResultsVm, type SkillEditOp } from "@workhub/contracts";
import {
  classifyGoldPathHref,
  goldPathT,
  normalizeWorkHubLocale,
  type GoldPathAppShell,
  type WorkHubLocale
} from "@workhub/ui/gold-path";
import { renderProposalConflictCards } from "@workhub/ui/proposal";
import { renderOnboardingScreen, renderInviteAcceptScreen } from "@workhub/ui";
import { openAvatarCropModal } from "./avatar-crop-modal.js";
import { armConfirmButton } from "./confirm-button.js";
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
  actionInProgressNotice,
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
  createTaskPlanActionFromHref,
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
  escalationActionFromHref,
  skipPlanProposalIdFromHref,
  taskPlanDispatchActionFromHref,
  escapeHtml,
  fieldValueRequiredNotice,
  inspectPostRunWorkItemClarity,
  intakeOptionRequiredNotice,
  isNativeResourceLink,
  localePersistenceFailedNotice,
  logoutFailedNotice,
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
  safeHref,
  showRouteNotice as showSharedRouteNotice,
  startAgentRunQueuedNoticeBody,
  sseDirtyGuardNotice,
  sseRefreshNotice,
  startAgentRunActionFromHref,
  taskPlanDraftedNoticeBody,
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
  acceptedDeliverableRestoreFollowUp,
  driveUploadPayloadFromPicker
} from "./drive-actions.js";
import {
  drivePreviewPanelHtml,
  drivePreviewTitle,
  renderDrivePreviewPanel,
  type DrivePreviewPayload
} from "./drive-preview.js";
import {
  mountReactRouteIsland,
  setReactRouteDirtyHandler,
  unmountReactRouteIsland
} from "./react-route-mount.js";
import { resolveWebMemoryConflictAction } from "./attention-actions.js";
import { fetchWorkspaceRosterMembers, type WorkspaceRosterVM } from "./workspace-roster.js";

const root = document.getElementById("root");
const liveLastEventIdStorageKey = "workhub.live.lastEventId";
type BrowserApiClient = ReturnType<typeof createApiClient>;

function escalationResolvePayloadFromActionId(actionId: string | undefined) {
  if (actionId === "escalation_retry") {
    return { action: "retry" as const };
  }
  if (actionId === "escalation_pm_mode") {
    return { action: "pm_mode" as const };
  }
  if (actionId === "escalation_cancel") {
    return { action: "cancel" as const };
  }
  return undefined;
}

// R14 批 FEEDBACK（web-feedback-ui）：提议详情页「有用/没用」反馈 PUT/DELETE 的 href 识别。
// 照 proposalActionFromHref（packages/web-runtime/src/action-payload.ts）的写法，但**不**加进那个
// 多端共享文件——本工包围栏只含 route-components.ts/client.ts/browser.ts 三个文件（04-feedback-
// design.md §10 施工切片表），一个新增子路径不值得为它改一个 desktop 也在用的共享 href 匹配文件。
function proposalFeedbackActionFromHref(href: string) {
  const path = new URL(href, globalThis.location?.origin ?? "http://workhub.local").pathname;
  const match = /^\/api\/proposals\/([^/]+)\/feedback$/u.exec(path);
  return match?.[1] ? { proposalId: decodeURIComponent(match[1]) } : undefined;
}

// 点了 mark_useful/mark_not_useful/clear 任一个之后的乐观本地 DOM 更新（不整页 renderCurrentRoute——
// 同 swapProposalActionRow 已建立的「详情页原地更新，不重跑 loader」纪律，M12 备注）。clearNote 只在
// DELETE 成功后传 true——反馈整行被撤销，备注框也该清空，避免显示一条已经不存在的历史备注。
function applyProposalFeedbackVerdictState(
  container: HTMLElement,
  verdict: AiFeedbackVerdict | null,
  options: { clearNote?: boolean } = {}
) {
  const panel = container.querySelector<HTMLElement>("[data-r14-proposal-feedback]");
  if (!panel) {
    return;
  }
  panel.dataset.r14ProposalFeedbackVerdict = verdict ?? "";
  panel.querySelectorAll<HTMLElement>("[data-r14-proposal-feedback-tile]").forEach((tile) => {
    const on = tile.dataset.r14ProposalFeedbackTile === verdict;
    tile.classList.toggle("wh-r14-proposal-feedback-tile--on", on);
    tile.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const clearLink = panel.querySelector<HTMLElement>("[data-r14-proposal-feedback-clear]");
  if (clearLink) {
    clearLink.hidden = verdict === null;
  }
  const noteSaveButton = panel.querySelector<HTMLButtonElement>("[data-r14-proposal-feedback-note-save]");
  if (noteSaveButton) {
    noteSaveButton.disabled = verdict === null;
  }
  if (options.clearNote) {
    const noteInput = panel.querySelector<HTMLTextAreaElement>("[data-r14-proposal-feedback-note-input]");
    if (noteInput) {
      noteInput.value = "";
    }
  }
}
const noticeTimerState: RouteNoticeTimerState = {};
// 普通用户审查 R2：开始新任务/生成任务计划是十几秒的 LLM 动作——点击后要 pending 提示+
// in-flight 锁，否则连点会造出重复工作项/计划。
// R10-P1-5b：锁从「全局一个布尔」改为按动作 key 分区——一个慢请求（上传大文件/LLM 追问）
// 不再把整页所有无关动作锁死；同一动作的双击防抖语义不变。key 见各调用点。
const busyActionKeys = new Set<string>();
function beginBusyAction(key: string): boolean {
  // 同 key（双击同一动作）必拦；不同 key 放行并发。
  if (busyActionKeys.has(key)) {
    return false;
  }
  busyActionKeys.add(key);
  return true;
}
function endBusyAction(key: string) {
  busyActionKeys.delete(key);
}
// R10-P1-2：审批打回理由草稿按事项隔离——key=approval id。跨重渲保留（respond 后重渲不丢在写的草稿）。
const approvalReasonDrafts = new Map<string, string>();
let readyRouteBindings: AbortController | undefined;
let liveDirtyGuardCount = 0;
let liveRuntime: ReturnType<typeof createWebLiveRuntime> | undefined;
type ShellIdentityUser = { nickname: string; isAdmin: boolean };
let currentIdentity: ShellIdentityUser | undefined;
let activeLocale: WorkHubLocale = "zh-CN";
// G-web 止血批：web 端没有会话 UI（会话消息/reaction/已读游标/工具流只在桌面工作台渲染），
// 全量订阅 conversation.* 系列事件白白让 web 的 SSE 连接收一堆用不上的推送。窄化订阅面，
// 只排除 conversation.* 命名空间——其余事件类型不变。
const liveEventTypes = Object.values(eventTypes).filter((type) => !type.startsWith("conversation."));
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
type ProposalRowAction = Pick<ActionSpec, "id" | "label" | "method" | "href" | "request_json">;

// 返回是否真的换到了行——首页决策卡没有 [data-r4-proposal-summary]，换不上时调用方要整页重渲，
// 否则通过后的「开工/采纳」按钮永远不出现（普通用户审查 high：卡片原地不动）。
function swapProposalActionRow(shellRoot: HTMLElement, actions: ProposalRowAction | ProposalRowAction[]): boolean {
  const row = shellRoot.querySelector<HTMLElement>(
    '[data-r4-proposal-summary="true"] .wh-r4-route-actions'
  );
  if (!row) {
    return false;
  }
  const nextActions = Array.isArray(actions) ? actions : [actions];
  const links = nextActions.map((action, index) => {
    const link = document.createElement("a");
    link.className = index === 0 ? "wh-btn wh-btn-primary" : "wh-btn";
    link.setAttribute("href", action.href);
    link.dataset.actionId = action.id;
    link.dataset.method = action.method;
    if (action.request_json) {
      link.dataset.requestJson = JSON.stringify(action.request_json);
    }
    link.textContent = action.label;
    return link;
  });
  if (links.length === 0) {
    return false;
  }
  row.replaceChildren(...links);
  return true;
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
    // R10-P1-6：语言切换走整页 reload，会丢掉所有未提交草稿。此前它绕过了站内武装式 dirty 守卫
    // （只剩原生 beforeunload 兜底）——切换前接入同一套守卫，第一次点击先警告，5 秒内再点才放行。
    if (!confirmLeaveDirtyRoute(locale)) {
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

  // R12（批量效率）：审批页快捷键——非输入态下 A=通过当前选中项、X=打回（弹理由卡）。
  shellRoot.addEventListener("keydown", (event) => {
    if (event.isComposing || (event.key !== "a" && event.key !== "A" && event.key !== "x" && event.key !== "X")) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const activeTag = document.activeElement?.tagName ?? "";
    // R10-P2b：contenteditable 里打字同样不能触发单字符快捷键。
    if (/^(input|textarea|select)$/iu.test(activeTag) || (document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable)) {
      return;
    }
    if (!shellRoot.querySelector('[data-r4-route-component="approvals"]')) {
      return;
    }
    const panel = shellRoot.querySelector<HTMLElement>("[data-r4-approval-action-panel]");
    if (!panel) {
      return;
    }
    const wantApprove = event.key === "a" || event.key === "A";
    const actionLink = [...panel.querySelectorAll<HTMLAnchorElement>("a[data-action-id]")].find((link) => {
      const id = link.getAttribute("data-action-id") ?? "";
      return wantApprove ? id === "approve" : id === "deny";
    });
    if (actionLink) {
      event.preventDefault();
      actionLink.click();
    }
  }, eventListenerOptions(signal));

  // R13（读屏）：role=button 的锚只有原生 Enter——Space 也要激活（原生 button 语义对齐）。
  shellRoot.addEventListener("keydown", (event) => {
    if (event.key !== " " || !(event.target instanceof HTMLAnchorElement) || event.target.getAttribute("role") !== "button") {
      return;
    }
    event.preventDefault();
    event.target.click();
  }, eventListenerOptions(signal));

  // R4 a11y high：审批队列行纯键盘不可达——Enter/Space 等同点击（行已带 tabindex/role=button）。
  shellRoot.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-r4-approval-item]") : null;
    if (!row || (event.target instanceof HTMLElement && /^(input|textarea|button|a|select)$/iu.test(event.target.tagName))) {
      return;
    }
    event.preventDefault();
    row.click();
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

// 普通用户审查（CONFLICT-TOAST）：整套冲突解决卡塞 420px 常驻 toast 无关闭无上限——
// 提议页有冲突区就内联渲进页面（可滚动、随页面存亡），toast 只留一句提示；
// 不在提议页（收件箱采纳撞冲突）才退回 toast 卡。
function mountConflictCardsInline(shellRoot: HTMLElement, html: string): boolean {
  const host = shellRoot.querySelector<HTMLElement>("[data-r4-proposal-conflicts]");
  if (!host) {
    return false;
  }
  const mount = document.createElement("div");
  mount.setAttribute("data-r9-inline-conflicts", "true");
  // 冲突卡原设计给 420px toast——内联进页面时钉住宽度约束，防窄屏横向溢出。
  mount.style.maxWidth = "100%";
  mount.style.minWidth = "0";
  mount.style.overflowX = "auto";
  mount.innerHTML = html;
  shellRoot.querySelector("[data-r9-inline-conflicts]")?.remove();
  host.insertAdjacentElement("afterend", mount);
  mount.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return true;
}

function showMergeConflictNotice(shellRoot: HTMLElement, error: unknown, locale: WorkHubLocale, actionId?: string) {
  const conflicts = conflictsFromMergeError(error);
  if (conflicts.length === 0) {
    return false;
  }
  const rendered = renderProposalConflictCards(conflicts, { locale });
  if (mountConflictCardsInline(shellRoot, rendered.html)) {
    showRouteNotice(shellRoot, mergeConflictNotice(locale, actionId));
    return true;
  }
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
  if (mountConflictCardsInline(shellRoot, rendered.html)) {
    showRouteNotice(shellRoot, mergeConflictNotice(locale, actionId));
    return true;
  }
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

  // R5（键盘可达）：理由提示卡响应 Esc——等同点「取消」，键盘用户不再被迫三选一才能脱身。
  shellRoot.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || (!pendingReviewHref && !pendingApprovalId)) {
      return;
    }
    event.preventDefault();
    pendingReviewHref = undefined;
    pendingReviewActionId = undefined;
    pendingApprovalId = undefined;
    pendingApprovalActionId = undefined;
    clearActiveRouteDirty();
    const notice = shellRoot.querySelector<HTMLElement>("[data-wh-app-notice]");
    if (notice) {
      notice.hidden = true;
    }
  }, eventListenerOptions(signal));


  // M2：项目名输入框按 Enter 即触发「新建项目」——该表单的动作是锚点，原生 Enter 不会提交。
  shellRoot.addEventListener("keydown", (event) => {
    // R6（表单 high）：中文输入法用 Enter 上屏组词时 isComposing=true——不拦截，否则打项目名打到一半被当提交。
    if (event.isComposing || event.key !== "Enter" || !(event.target instanceof HTMLElement) || !event.target.matches("[data-r8-project-name-input]")) {
      return;
    }
    event.preventDefault();
    event.target.closest("[data-r8-project-create-form]")?.querySelector<HTMLElement>("[data-r8-project-create]")?.click();
  }, eventListenerOptions(signal));

  // rank5：网盘项目切换器用 CSP 合规的委托 change 监听 + SPA 导航，取代被 CSP 禁的内联 onchange/整页刷新。
  // option 的 value 已是完整 href（/drive?project_id=…）；空 value（M3 占位「当前项目」）不导航。
  shellRoot.addEventListener("change", (event) => {
    const target = event.target;
    // R12（批量效率）：勾选审批行 checkbox → 显示「批量通过所选」按钮（有勾选才显示）。
    if (target instanceof HTMLInputElement && target.matches("[data-r12-approval-check]")) {
      const anyChecked = shellRoot.querySelector("[data-r12-approval-check]:checked") !== null;
      const batchButton = shellRoot.querySelector<HTMLElement>("[data-r12-approval-batch-approve]");
      if (batchButton) {
        batchButton.hidden = !anyChecked;
      }
      return;
    }
    if (target instanceof HTMLInputElement && target.matches("[data-drive-upload-picker]")) {
      const href = actionHrefFromElement(target);
      const driveUpload = driveUploadFromHref(href);
      const file = target.files?.[0];
      const actionId = target.dataset.actionId ?? "drive_upload_file";
      if (!driveUpload || !file) {
        return;
      }
      // R5（慢网感知）：大文件慢网下只有一条静态「处理中」——补文件名+体积的诚实等待文案（>2MB 预告可能要等），
      // 等待期禁用 picker + in-flight 锁防同一个选择器被再次触发。
      if (!beginBusyAction("drive_upload")) {
        target.value = "";
        return;
      }
      target.disabled = true;
      const sizeMb = file.size / (1024 * 1024);
      const sizeText = sizeMb >= 0.1 ? `${sizeMb.toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;
      const pendingVm = actionInProgressNotice(locale, actionId);
      pendingVm.body = locale === "en-US"
        ? `Uploading “${file.name}” (${sizeText})…${sizeMb > 2 ? " Large file — this may take a while on a slow connection." : ""}`
        : `正在上传「${file.name}」（${sizeText}）…${sizeMb > 2 ? "文件较大，慢网络下可能需要等一会儿。" : ""}`;
      showRouteNotice(shellRoot, pendingVm, undefined, 0);
      void (async () => {
        try {
          const result = await client.uploadDriveFile(driveUpload.projectId, driveUploadPayloadFromPicker(target, file), { locale });
          target.value = "";
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId));
          }
        } catch (error) {
          target.value = "";
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        } finally {
          endBusyAction("drive_upload");
          if (target.isConnected) {
            target.disabled = false;
          }
        }
      })();
      return;
    }
    if (!(target instanceof HTMLSelectElement) || !target.matches("[data-r8-drive-project-switcher]")) {
      return;
    }
    const href = target.value;
    if (href) {
      void navigateWebRoute(href, client, locale);
    }
  }, eventListenerOptions(signal));

  shellRoot.addEventListener("click", async (event) => {
    const logoutButton = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-wh-logout]") : null;
    if (logoutButton) {
      event.preventDefault();
      try {
        await client.logout();
      } catch (error) {
        // R10-P1-8：只有「会话本就无效」(401/not_identified) 才可视为已登出。网络中断或服务端 5xx 时
        // httpOnly 会话 cookie 可能仍然有效——此时渲 Onboarding 就是在共享设备上撒谎，必须显式报错停下。
        const sessionAlreadyGone = error instanceof WorkHubApiError
          && (error.status === 401 || error.code === "not_identified");
        if (!sessionAlreadyGone) {
          showRouteNotice(shellRoot, logoutFailedNotice(locale));
          return;
        }
      }
      showOnboardingScreen(client, locale);
      return;
    }

    // W2：左栏选择——点选一行，高亮它、显示对应中栏详情面板、把右栏决策按钮重绑到选中事项。
    // R10-P1-2：页面上凡是「当前审批事项」的表达都必须从这一次选中派生——此前只换了选中样式/详情/按钮
    // href，h1 标题、顶部原因、aria-current、打回理由框全部停留在初始 primary：可能出现 A 的标题配 B 的
    // 按钮，A 的打回理由以 B 的名义提交进审计。现在标题/原因随行内嵌数据同步、aria-current 写回（修 R13
    // 只改了 SSR 端的退化）、理由草稿按事项隔离（切换时保存/回填，绝不跨事项提交）。
    const approvalRow = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-r4-approval-item]") : null;
    if (approvalRow && !(event.target instanceof Element && event.target.closest("a,button,textarea,input,form"))) {
      const itemId = approvalRow.dataset["r4ApprovalItem"];
      if (itemId) {
        const reasonBox = shellRoot.querySelector<HTMLTextAreaElement>("[data-r4-approval-reason]");
        let previousId: string | undefined;
        shellRoot.querySelectorAll<HTMLElement>("[data-r4-approval-item]").forEach((rowEl) => {
          if (rowEl.getAttribute("data-r4-approval-selected") === "true") {
            previousId = rowEl.dataset["r4ApprovalItem"];
          }
          rowEl.setAttribute("data-r4-approval-selected", String(rowEl === approvalRow));
          rowEl.setAttribute("aria-current", String(rowEl === approvalRow));
        });
        // 理由草稿按事项隔离：离开的事项存草稿，进入的事项回填自己的草稿（没有就空）。
        if (reasonBox && previousId !== itemId) {
          if (previousId !== undefined) {
            approvalReasonDrafts.set(previousId, reasonBox.value);
          }
          reasonBox.value = approvalReasonDrafts.get(itemId) ?? "";
        }
        const headline = shellRoot.querySelector<HTMLElement>("[data-r10-approval-headline]");
        const headlineReason = shellRoot.querySelector<HTMLElement>("[data-r10-approval-headline-reason]");
        if (headline && approvalRow.dataset["r10ApprovalTitle"]) {
          headline.textContent = approvalRow.dataset["r10ApprovalTitle"];
        }
        if (headlineReason && approvalRow.dataset["r10ApprovalReason"] !== undefined) {
          headlineReason.textContent = approvalRow.dataset["r10ApprovalReason"];
        }
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

    // R10-P2-2：会议转写导入——标题+文本进项目，成功后整页重渲（新会议出现在列表）。
    const meetingImportSubmit = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-r10-meeting-import-submit]") : null;
    if (meetingImportSubmit) {
      event.preventDefault();
      const projectId = meetingImportSubmit.dataset["r10MeetingImportSubmit"] ?? "";
      const title = shellRoot.querySelector<HTMLInputElement>("[data-r10-meeting-import-title]")?.value.trim() ?? "";
      const transcript = shellRoot.querySelector<HTMLTextAreaElement>("[data-r10-meeting-import-text]")?.value.trim() ?? "";
      if (!projectId || !title || !transcript) {
        showRouteNotice(shellRoot, fieldValueRequiredNotice(locale, "meeting_import"));
        return;
      }
      if (!beginBusyAction("meeting_import")) {
        return;
      }
      showRouteNotice(shellRoot, actionInProgressNotice(locale, "meeting_import"), undefined, 0);
      void (async () => {
        try {
          await client.importMeetingTranscript(projectId, { title, transcript_text: transcript }, { locale });
          clearActiveRouteDirty();
          await renderCurrentRoute(client, locale);
          showRouteNotice(root ?? shellRoot, actionSuccessNotice(locale, locale === "en-US"
            ? `Imported "${title}" — the transcript now lives with this project's meetings.`
            : `已导入「${title}」，转写已归入这个项目的会议。`, "meeting_import"));
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, "meeting_import"));
        } finally {
          endBusyAction("meeting_import");
        }
      })();
      return;
    }
    // R10-P2-5（R20 P1-08 收尾）：审批转交——打开「转交给同事」时懒加载成员清单（不进 loader，不动 smoke
    // 计数）。数据源＝本工作区花名册（GET /api/workspace/roster，分页翻到底），取代此前误用的全局
    // /api/users（跨租户泄露 + 硬 200 截断）；管理员标签改读 roster 行的 is_admin，展示行为与此前等价。
    // 确认转交走既有 delegateApproval 全链（服务端重路由+通知），成功后重渲。
    const delegateSummary = event.target instanceof Element ? event.target.closest("[data-r10-approval-delegate] summary") : null;
    if (delegateSummary) {
      const details = delegateSummary.closest<HTMLElement>("[data-r10-approval-delegate]");
      const select = details?.querySelector<HTMLSelectElement>("[data-r10-approval-delegate-select]");
      if (details && select && details.dataset["r10DelegateLoaded"] !== "true") {
        details.dataset["r10DelegateLoaded"] = "true";
        void fetchWorkspaceRosterMembers(client)
          .then((members) => {
            select.innerHTML = members
              .map((member) => `<option value="${escapeHtml(member.user_id)}">${escapeHtml(member.nickname)}${member.is_admin ? (locale === "en-US" ? " (admin)" : "（管理员）") : ""}</option>`)
              .join("");
          })
          .catch(() => {
            details.dataset["r10DelegateLoaded"] = "false";
            select.innerHTML = `<option value="">${locale === "en-US" ? "Couldn't load members — reopen to retry" : "成员没加载出来，收起再展开重试"}</option>`;
          });
      }
      return;
    }
    const delegateSubmit = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-r10-approval-delegate-submit]") : null;
    if (delegateSubmit) {
      event.preventDefault();
      const select = shellRoot.querySelector<HTMLSelectElement>("[data-r10-approval-delegate-select]");
      const toUserId = select?.value || "";
      const selectedRow = [...shellRoot.querySelectorAll<HTMLElement>("[data-r4-approval-item]")]
        .find((row) => row.getAttribute("data-r4-approval-selected") === "true");
      const respondHref = selectedRow?.dataset["r4ApprovalRespondHref"] ?? "";
      const approvalId = approvalRespondIdFromHref(respondHref);
      if (!toUserId || !approvalId) {
        showRouteNotice(shellRoot, fieldValueRequiredNotice(locale, "delegate_approval"));
        return;
      }
      if (!beginBusyAction("approval_delegate")) {
        return;
      }
      showRouteNotice(shellRoot, actionInProgressNotice(locale, "delegate_approval"), undefined, 0);
      void (async () => {
        try {
          await client.delegateApproval(approvalId, { to_user_id: toUserId });
          await renderCurrentRoute(client, locale);
          showRouteNotice(root ?? shellRoot, actionSuccessNotice(locale, locale === "en-US"
            ? "Approval handed off — it now routes to them."
            : "已转交，这条审批会路由给对方处理。", "delegate_approval"));
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, "delegate_approval"));
        } finally {
          endBusyAction("approval_delegate");
        }
      })();
      return;
    }
    // Nav-v2：次级分组（项目资产/团队/管理）点组名展开收起——SSR 默认收起（当前页所在组展开）。
    const navGroupToggle = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-nav-group-toggle]") : null;
    if (navGroupToggle) {
      event.preventDefault();
      const groupHost = navGroupToggle.closest<HTMLElement>(".wh-product-nav-group");
      const collapsed = groupHost?.getAttribute("data-nav-collapsed") === "true";
      groupHost?.setAttribute("data-nav-collapsed", collapsed ? "false" : "true");
      navGroupToggle.setAttribute("aria-expanded", collapsed ? "true" : "false");
      return;
    }
    // W2：相关讨论——发表评论（乐观追加，再回填服务端结果）。
    // R3 移动导航折叠：窄屏默认只显前 7 项 +「更多」，点击展开/收起（display:none 方案不触发溢出门）。
    const navMore = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-nav-more]") : null;
    if (navMore) {
      event.preventDefault();
      const navHost = navMore.closest<HTMLElement>(".wh-product-nav");
      const expanded = navHost?.getAttribute("data-nav-expanded") === "true";
      navHost?.setAttribute("data-nav-expanded", expanded ? "false" : "true");
      navMore.setAttribute("aria-expanded", expanded ? "false" : "true");
      navMore.textContent = expanded
        ? (locale === "en-US" ? "More" : "更多")
        : (locale === "en-US" ? "Less" : "收起");
      return;
    }
    // UX-U3：网盘评论 composer 提交——发评论后整页重渲（评论出现在列表并带「生成草稿」入口）。
    const driveCommentSubmit = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-r9-drive-comment-submit]") : null;
    if (driveCommentSubmit) {
      event.preventDefault();
      const form = driveCommentSubmit.closest<HTMLFormElement>("[data-r9-drive-comment-form]");
      const projectId = form?.getAttribute("data-r9-drive-comment-form") ?? "";
      const input = form?.querySelector<HTMLTextAreaElement>("[data-r9-drive-comment-input]");
      const body = input?.value.trim();
      if (!projectId) {
        return;
      }
      if (!body) {
        showRouteNotice(shellRoot, fieldValueRequiredNotice(locale, "drive_comment"));
        input?.focus();
        return;
      }
      // R3：慢请求下零反馈+可双击重复提交——pending 提示+in-flight 锁。
      if (!beginBusyAction("drive_comment")) {
        return;
      }
      showRouteNotice(shellRoot, actionInProgressNotice(locale, "drive_comment"), undefined, 0);
      try {
        await client.createDriveComment(projectId, { body }, { locale });
        await renderCurrentRoute(client, locale);
        showRouteNotice(root ?? shellRoot, actionSuccessNotice(locale, locale === "en-US"
          ? "Comment posted. Use \u201cCreate draft\u201d on it to hand it to AI."
          : "评论已发出。点评论上的「生成草稿」就能交给 AI 处理。", "drive_comment"));
      } catch (error) {
        showRouteNotice(shellRoot, actionErrorNotice(locale, error, "drive_comment"));
      } finally {
        endBusyAction("drive_comment");
      }
      return;
    }
    const commentSubmit = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-r4-approval-comment-submit]") : null;
    if (commentSubmit) {
      event.preventDefault();
      const approvalId = commentSubmit.dataset["r4ApprovalCommentSubmit"];
      const form = commentSubmit.closest<HTMLFormElement>("[data-r4-approval-comment-form]");
      const input = form?.querySelector<HTMLTextAreaElement>("[data-r4-approval-comment-input]");
      const body = input?.value.trim();
      if (approvalId && !body) {
        // INT-5：空(或纯空白)评论点提交此前静默无反馈——用户不知道为什么没发出去。给出「需要填写内容」提示并聚焦输入框。
        showRouteNotice(shellRoot, fieldValueRequiredNotice(locale, "approval_comment"));
        input?.focus();
        return;
      }
      if (approvalId && body) {
        if (!beginBusyAction("approval_comment")) {
          return;
        }
        commentSubmit.disabled = true;
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
        } finally {
          endBusyAction("approval_comment");
          commentSubmit.disabled = false;
          // R4 回归：提交成功已清空输入框，dirty 标记也要清——否则该路由永远收不到 SSE 刷新。
          if (!input?.value.trim()) {
            clearActiveRouteDirty();
          }
        }
      }
      return;
    }

    // R12（批量效率）：批量通过所选——收集勾选 id → respond-batch，成功后重渲并回执成功/跳过数。
    const batchApprove = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-r12-approval-batch-approve]") : null;
    if (batchApprove) {
      event.preventDefault();
      const ids = [...shellRoot.querySelectorAll<HTMLInputElement>("[data-r12-approval-check]:checked")]
        .map((input) => input.dataset.r12ApprovalCheck)
        .filter((value): value is string => Boolean(value));
      if (ids.length === 0 || !beginBusyAction("respond_batch")) {
        return;
      }
      batchApprove.disabled = true;
      showRouteNotice(shellRoot, actionInProgressNotice(locale, "respond_batch"), undefined, 0);
      void (async () => {
        try {
          const result = await client.respondApprovalsBatch(ids);
          await renderCurrentRoute(client, locale);
          showRouteNotice(root ?? shellRoot, actionSuccessNotice(locale, locale === "en-US"
            ? `Approved ${result.approved} item${result.approved === 1 ? "" : "s"}${result.skipped ? `, ${result.skipped} skipped (already handled)` : ""}.`
            : `已批量通过 ${result.approved} 条${result.skipped ? `，${result.skipped} 条跳过（已被处理）` : ""}。`, "respond_batch"));
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, "respond_batch"));
        } finally {
          endBusyAction("respond_batch");
          if (batchApprove.isConnected) {
            batchApprove.disabled = false;
          }
        }
      })();
      return;
    }
    // R5（键盘可达）：理由卡「取消」——清空挂起状态、收起持久提示卡、解除 dirty 标记。Esc 同效（见下方 keydown）。
    const reasonCancel = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-review-reason-cancel]") : null;
    if (reasonCancel) {
      event.preventDefault();
      pendingReviewHref = undefined;
      pendingReviewActionId = undefined;
      pendingApprovalId = undefined;
      pendingApprovalActionId = undefined;
      clearActiveRouteDirty();
      const notice = shellRoot.querySelector<HTMLElement>("[data-wh-app-notice]");
      if (notice) {
        notice.hidden = true;
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
          }, { locale });
          showRouteNotice(shellRoot, actionSuccessNotice(locale, result.attention.summary_text, pendingReviewActionId ?? "request_changes"));
          pendingReviewHref = undefined;
          pendingReviewActionId = undefined;
          clearActiveRouteDirty();
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, pendingReviewActionId ?? "request_changes"));
        }
      }
      if (pendingApprovalId) {
        if (!beginBusyAction("approval_deny")) {
          return;
        }
        showRouteNotice(shellRoot, actionInProgressNotice(locale, pendingApprovalActionId ?? "deny"), undefined, 0);
        try {
          const remember = shellRoot.querySelector<HTMLInputElement>("[data-r4-approval-remember]")?.checked ? "always" : "once";
          // L#W2-17：优先用决策面板里手写的「意见说明」，没写才回落到预设理由按钮。
          const customReason = shellRoot.querySelector<HTMLTextAreaElement>("[data-r4-approval-reason]")?.value.trim();
          const result = await client.respondApproval(pendingApprovalId, {
            decision: "deny",
            reason_md: customReason || reasonMd,
            remember
          });
          const settledApprovalActionId = pendingApprovalActionId ?? "deny";
          approvalReasonDrafts.delete(pendingApprovalId);
          pendingApprovalId = undefined;
          pendingApprovalActionId = undefined;
          clearActiveRouteDirty();
          // R8（引导承接 high）：打回后同样重渲——已处理项移出队列，回执在重渲后弹。
          await renderCurrentRoute(client, locale);
          showRouteNotice(root ?? shellRoot, actionSuccessNotice(locale, actionSummary(result, locale), settledApprovalActionId));
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, pendingApprovalActionId ?? "deny"));
        } finally {
          endBusyAction("approval_deny");
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
    if (actionTarget instanceof HTMLInputElement && actionTarget.matches("[data-drive-upload-picker]")) {
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
    if (actionId === "drive_preview") {
      event.preventDefault();
      try {
        const preview = await client.request<DrivePreviewPayload>(href);
        if (!renderDrivePreviewPanel(actionTarget, preview, locale)) {
          showRouteNotice(
            shellRoot,
            actionSuccessNotice(locale, drivePreviewTitle(preview, locale), actionId),
            `<div data-r5-drive-preview-panel="true">${drivePreviewPanelHtml(preview, locale)}</div>`,
            0
          );
        }
      } catch (error) {
        showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
      }
      return;
    }
    if (isNativeResourceLink(actionTarget)) {
      return;
    }
    const action = classifyGoldPathHref(shell.routeMap, href, {
      requiresReason: actionTarget.dataset.requiresReason === "true",
      method: actionTarget.dataset.method
    });
    if (action.kind === "navigate") {
      event.preventDefault();
      // R7（中断恢复 high）：用户点导航离开时若有未提交输入——武装式拦一次，5 秒内再点才放行。
      if (!confirmLeaveDirtyRoute(locale)) {
        return;
      }
      if (onNavigate) {
        void Promise.resolve(onNavigate(href, action.pageKey)).catch((error) => renderFatalRouteError(locale, error));
        return;
      }
      setActivePage(shellRoot, shell, action.pageKey);
      return;
    }
    if (action.kind === "api-action") {
      event.preventDefault();
      // R5（慢网感知 medium→系统性）：此前只有零星分支各自接锁，approve/merge/删除/通知/升级等
      // 大多数动作点击后既无锁也无按钮态——慢网下连点两下=重复请求。把锁上提到 api-action 分发入口统一管：
      // 进入置位+按钮 aria-disabled，finally 复位。分支内部原有的局部锁已被此门取代（见下方各分支）。
      // R10-P1-5b：按 href 分区——同一动作双击必拦，一个慢动作不再锁死整页其余动作。
      const busyKey = `api:${href}`;
      if (!beginBusyAction(busyKey)) {
        return;
      }
      actionTarget.setAttribute("aria-disabled", "true");
      try {
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
        // R10-0c：通用入口渲了项目选择器时，以用户选中的项目为准（空值=「新建试点项目」走 bootstrap 兜底）。
        const pickedProjectId = shellRoot.querySelector<HTMLSelectElement>("[data-s4c-intake-project-select]")?.value || undefined;
        const existingProjectId = actionTarget.dataset.s4bProjectId ?? pickedProjectId;
        const intentText = startIntentText(actionTarget);
        if (!intentText) {
          // L13：意图为空就 fail-closed，提示用户先写要做什么，绝不替换成预设任务。
          showRouteNotice(shellRoot, fieldValueRequiredNotice(locale, actionId));
          return;
        }
        // R5：in-flight 锁已上提到 api-action 分发入口统一管（外层已置位，此处只留 pending 提示）。
        showRouteNotice(shellRoot, actionInProgressNotice(locale, actionId), undefined, 0);
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
      const createTaskPlan = createTaskPlanActionFromHref(href);
      if (createTaskPlan) {
        // R5：in-flight 锁已上提到 api-action 分发入口统一管。
        showRouteNotice(shellRoot, actionInProgressNotice(locale, actionId), undefined, 0);
        try {
          const result = await client.createTaskPlan(createTaskPlan.workItemId, {}, { locale });
          await navigateWebRoute(result.proposal_href || `/workitems/${createTaskPlan.workItemId}`, client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, taskPlanDraftedNoticeBody(locale), actionId ?? "create_task_plan"));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId ?? "create_task_plan"));
        }
        return;
      }
      const startAgentRun = startAgentRunActionFromHref(href);
      if (startAgentRun) {
        // R5（慢网感知 high）：启动 AI 运行是最重的动作之一，此前按下后零反馈——补持久 pending 提示（成功/失败提示会顶掉它）。
        showRouteNotice(shellRoot, actionInProgressNotice(locale, actionId ?? "start_agent_run"), undefined, 0);
        try {
          const run = await client.startAgentRun(startAgentRun.workItemId);
          await navigateWebRoute(`/workitems/${startAgentRun.workItemId}`, client, locale);
          const monitorToken = ++postRunClarityMonitorToken;
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, startAgentRunQueuedNoticeBody(locale), actionId ?? "start_agent_run"));
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
          const followUp = acceptedDeliverableRestoreFollowUp(result, locale, actionSummary(result, locale));
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, followUp.noticeBody, actionId));
          }
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
        // M8: name the recycled target and point to recovery, so a reversible delete is
        // never an anonymous surprise (the button already names the target pre-click).
        const deleteTargetName = actionTarget.dataset.r5DriveDeleteName?.trim();
        try {
          const result = await client.deleteDriveItem(driveItemMutation.projectId, driveItemMutation.itemId, payload.payload ?? {}, { locale });
          await renderCurrentRoute(client, locale);
          if (root) {
            const body = deleteTargetName
              ? (locale === "zh-CN"
                ? `已把「${deleteTargetName}」移到回收站，可在回收站中恢复。`
                : `Moved “${deleteTargetName}” to the recycle bin — restore it from the recycle bin.`)
              : actionSummary(result, locale);
            showRouteNotice(root, actionSuccessNotice(locale, body, actionId));
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
      // R15 批 A（A2 提醒阶梯）：暂停提醒——POST /snooze 置空 next_remind_at，重渲后这条通知不再挂「暂停提醒」
      // 按钮（next_remind_at 已空）。读/归档态不动，通知仍留在待决策/FYI 桶里，只是不再 24h 催。
      if (notificationAction?.action === "snooze") {
        try {
          const result = await client.snoozeNotification(notificationAction.notificationId);
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId ?? "notification_snooze"));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      const escalationAction = escalationActionFromHref(href);
      if (escalationAction?.action === "budget") {
        try {
          const result = await client.resolveBudgetDecision(
            escalationAction.escalationId,
            escalationAction.budgetActionId,
            { locale }
          );
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      if (escalationAction?.action === "resolve") {
        const payload = escalationResolvePayloadFromActionId(actionId);
        if (!payload) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, new Error(locale === "en-US" ? "This escalation action is not available." : "这个升级动作暂不可用。"), actionId));
          return;
        }
        // 普通用户审查：「取消这个子任务」紧挨「转成我来做」，一键即取消无反悔——
        // danger 动作加两段式确认：第一次点把按钮翻成确认态（5 秒后自动复原），再点才执行。
        if (payload.action === "cancel" && actionTarget.dataset.r9ConfirmArmed !== "true") {
          const originalLabel = actionTarget.textContent ?? "";
          actionTarget.dataset.r9ConfirmArmed = "true";
          actionTarget.textContent = locale === "en-US" ? "Really cancel? Click again" : "确认取消？再点一次";
          window.setTimeout(() => {
            if (actionTarget.isConnected && actionTarget.dataset.r9ConfirmArmed === "true") {
              delete actionTarget.dataset.r9ConfirmArmed;
              actionTarget.textContent = originalLabel;
            }
          }, 5000);
          return;
        }
        try {
          const result = await client.resolveEscalation(escalationAction.escalationId, payload, { locale });
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(result, locale), actionId));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      try {
        const mergeDraft = actionTarget
          .closest("section, article")
          ?.querySelector<HTMLTextAreaElement>("[data-r9-sync-merge-value]")?.value;
        const memoryConflictResult = await resolveWebMemoryConflictAction(client, href, mergeDraft);
        if (memoryConflictResult) {
          await renderCurrentRoute(client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, actionSummary(memoryConflictResult, locale), actionId));
          }
          return;
        }
      } catch (error) {
        showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
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
          const merge = await client.applyMergeProposalCandidate(mergeProposalCandidateApplyId, payload.payload, { locale });
          showRouteNotice(shellRoot, actionSuccessNotice(locale, merge.attention.summary_text, actionId));
        } catch (error) {
          // R7（双标签页）：候选合并与相邻 merge/review 路径同一套错误分类——rebase/冲突给可操作提示，
          // 409（他人已合入）重渲刷新卡片状态，不再留一个永远可点的死按钮。
          const candidateProposalId = /\/api\/proposals\/([^/]+)\//u.exec(href)?.[1];
          if (candidateProposalId && await showRebaseRequiredNotice(shellRoot, error, candidateProposalId, client, locale, actionId)) {
            return;
          }
          if (!showMergeConflictNotice(shellRoot, error, locale, actionId)) {
            showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
          }
          if (error instanceof WorkHubApiError && error.status === 409) {
            await renderCurrentRoute(client, locale);
          }
        }
        return;
      }
      const approvalRespondId = approvalRespondIdFromHref(href);
      if (approvalRespondId) {
        if (action.requiresReason || actionId === "deny") {
          pendingApprovalId = approvalRespondId;
          pendingApprovalActionId = actionId ?? "deny";
          markActiveRouteDirty("review_reason_pending");
          showRouteNotice(shellRoot, reasonRequiredNotice(locale, pendingApprovalActionId), reviewReasonButtons(locale), 0);
          return;
        }
        // R13（决策完整性）：打回理由卡挂起时不许静默改批准——先让用户对已开的打回流程表态
        // （选理由或 Esc/取消），否则 X 后按 A/误点会把正在走打回的同一条直接放行。
        if (pendingApprovalId || pendingReviewHref) {
          showRouteNotice(shellRoot, {
            kind: "reason_required",
            tone: "warning",
            source: "client",
            locale,
            title: locale === "en-US" ? "Finish the send-back first" : "先处理打回理由卡",
            body: locale === "en-US"
              ? "A send-back is in progress — pick a reason, or press Esc / Cancel to drop it before approving."
              : "有一条打回流程正在进行——先选理由，或按 Esc/取消放弃打回，再执行通过。"
          });
          return;
        }
        try {
          const remember = shellRoot.querySelector<HTMLInputElement>("[data-r4-approval-remember]")?.checked ? "always" : "once";
          const result = await client.respondApproval(approvalRespondId, { decision: "allow", remember });
          // R8（引导承接 high）：批准后列表原地不动——已处理项还在、处理完最后一条也见不到空态。
          // 与 reviewProposal 同口径：成功即重渲（下一条自动成为 primary），回执在重渲后弹。
          await renderCurrentRoute(client, locale);
          showRouteNotice(root ?? shellRoot, actionSuccessNotice(locale, actionSummary(result, locale), actionId ?? "approve"));
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId ?? "approve"));
          // R3（协作）：撞上别人已决策的 409 时按钮不该原地装死——重渲反映最新状态。
          if (error instanceof WorkHubApiError && error.status === 409) {
            await renderCurrentRoute(client, locale);
          }
        }
        return;
      }
      const proposalAction = proposalActionFromHref(href);
      if (proposalAction?.action === "review") {
        if (action.requiresReason) {
          pendingReviewHref = href;
          pendingReviewActionId = actionId ?? "request_changes";
          markActiveRouteDirty("review_reason_pending");
          showRouteNotice(shellRoot, reasonRequiredNotice(locale, pendingReviewActionId), reviewReasonButtons(locale), 0);
          return;
        }
        try {
          const review = await client.reviewProposal(proposalAction.proposalId, { decision: "approve", remember: "once" }, { locale });
          // M11/L17: approve is a first-class review step (status → reviewed). The
          // irreversible publish to the official version is now a SEPARATE deliberate
          // click — a GitHub-like approve-then-merge flow, not a silent one-click merge.
          // Swap the action row in place to the server-provided next action ("采纳到正式版")
          // via a lightweight DOM update — NOT a full route refetch, which would re-run the
          // loader and break the SSE/dirty-edit/loader smoke gates (see M12).
          const planMergeActions = review.attention.kind === "plan_review"
            ? review.attention.actions.filter((item) => proposalActionFromHref(item.href)?.action === "merge")
            : [];
          const swapped = planMergeActions.length > 0
            ? swapProposalActionRow(shellRoot, planMergeActions)
            : review.next_action
              ? swapProposalActionRow(shellRoot, review.next_action)
              : false;
          clearActiveRouteDirty();
          if (!swapped) {
            // 首页/收件箱里点的通过：原地换行落空，与升级/预算/冲突卡同口径整页重渲，
            // 卡片状态跟上、下一步按钮出现。回执在重渲后再弹，避免被刷新提示覆盖。
            await renderCurrentRoute(client, locale);
          }
          showRouteNotice(root ?? shellRoot, actionSuccessNotice(locale, review.attention.summary_text, actionId));
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
          const merge = await client.mergeProposal(proposalAction.proposalId, payload.payload, { locale });
          clearActiveRouteDirty();
          // 只有不在提议详情页（收件箱里点的采纳）才整页重渲让卡消失——详情页上重跑 loader
          // 会破 dirty-edit/SSE 守卫与重复 loader 门（M12），保持原地回执。
          if (!shellRoot.querySelector('[data-r4-proposal-summary="true"]')) {
            await renderCurrentRoute(client, locale);
          } else {
            // 普通用户审查 R2：采纳后按钮还亮着（再点报错 409）且无去看进展的入口——
            // 原地把动作行换成「去看进展」链接。
            const mergedWorkItemId = shellRoot
              .querySelector<HTMLElement>("[data-r4-proposal-workitem-id]")
              ?.getAttribute("data-r4-proposal-workitem-id");
            if (mergedWorkItemId) {
              swapProposalActionRow(shellRoot, {
                id: "open_workitem",
                label: locale === "en-US" ? "See progress" : "去看进展",
                method: "GET",
                href: `/workitems/${encodeURIComponent(mergedWorkItemId)}`
              });
            }
          }
          showRouteNotice(root ?? shellRoot, actionSuccessNotice(locale, merge.attention.summary_text, actionId));
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
      // R14 批 FEEDBACK（web-feedback-ui）：提议详情页「有用/没用」轻反馈——低仪式感的频繁小动作，
      // 照 04-feedback-design.md §7.2 走乐观本地 DOM 切换，不整页 renderCurrentRoute、成功不弹 toast
      // （只在失败时提示，同 §9「乐观 UI + 下次自然拉取兜底」的产品定位；对照 reviewProposal/
      // mergeProposal 这类一次性、有后果的动作才配得上一条成功回执）。
      const proposalFeedback = proposalFeedbackActionFromHref(href);
      if (proposalFeedback) {
        if (action.method === "DELETE") {
          const deleteProposalFeedback = client.deleteProposalFeedback;
          if (!deleteProposalFeedback) {
            return;
          }
          try {
            await deleteProposalFeedback(proposalFeedback.proposalId);
            applyProposalFeedbackVerdictState(shellRoot, null, { clearNote: true });
          } catch (error) {
            showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
          }
          return;
        }
        const payload = actionElementJsonPayload<PutAiFeedbackRequest>(actionTarget);
        if (!payload.ok || !payload.payload?.verdict) {
          showPayloadFailureNotice(shellRoot, locale, payload.ok ? { ok: false, reason: "invalid_json" } : payload, actionId);
          return;
        }
        const putProposalFeedback = client.putProposalFeedback;
        if (!putProposalFeedback) {
          return;
        }
        // 保护未保存的备注：切换判定的固定 request_json 里没有 note 字段（服务端 PUT 是整行覆盖，见
        // 04-feedback-design.md §2「改判…只更新这一行」）——如果备注框里已经有文字（不管是刚打的字
        // 还是上次保存过的），原样带上去，避免「先写备注、又点了另一个 tile」把备注静默清空。
        const noteInput = shellRoot.querySelector<HTMLTextAreaElement>("[data-r14-proposal-feedback-note-input]");
        const currentNote = noteInput?.value.trim();
        const body: PutAiFeedbackRequest = currentNote
          ? { verdict: payload.payload.verdict, note: currentNote }
          : { verdict: payload.payload.verdict };
        try {
          await putProposalFeedback(proposalFeedback.proposalId, body);
          applyProposalFeedbackVerdictState(shellRoot, payload.payload.verdict);
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      // B-R9.6 UX 审计（skip-plan 假接线）：plan_review 卡「先不拆，单个 AI 跑」——
      // 打回计划草稿并直接入队单个 run，成功后跳回工作项详情看进展。
      const skipPlanProposalId = skipPlanProposalIdFromHref(href);
      if (skipPlanProposalId) {
        try {
          const skipped = await client.skipTaskPlanProposal(skipPlanProposalId, { locale });
          await navigateWebRoute(`/workitems/${encodeURIComponent(skipped.work_item_id)}`, client, locale);
          if (root) {
            showRouteNotice(root, actionSuccessNotice(locale, skipped.attention.summary_text, actionId));
          }
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      // B-R9.6 §3.1：军团面板「暂停派发/恢复派发」。成功后原地翻转按钮（暂停↔恢复）+
      // 同步面板状态标记，不整页重取（M12：全量 refetch 会破 loader/SSE smoke 门）。
      const planDispatchAction = taskPlanDispatchActionFromHref(href);
      if (planDispatchAction) {
        try {
          const result = planDispatchAction.action === "pause"
            ? await client.pauseTaskPlan(planDispatchAction.planId)
            : await client.resumeTaskPlan(planDispatchAction.planId);
          const nextKind = planDispatchAction.action === "pause" ? "resume" : "pause";
          // R8（竞态）：await 期间 SSE silent 重渲会把 actionTarget 换成分离节点——原地改写全部落空、
          // 按钮态与服务端脱节。检测到分离就整页重渲兜底（服务端已成功，重渲自然带出新状态）。
          if (!actionTarget.isConnected) {
            await renderCurrentRoute(client, locale);
            showRouteNotice(root ?? shellRoot, actionSuccessNotice(locale, planDispatchAction.action === "pause"
              ? (locale === "en-US" ? "Dispatch paused." : "已暂停派发。")
              : (locale === "en-US" ? "Dispatch resumed." : "已恢复派发。"), actionId));
            return;
          }
          actionTarget.setAttribute("href", `/api/task-plans/${encodeURIComponent(planDispatchAction.planId)}/${nextKind}`);
          actionTarget.dataset.actionId = `${nextKind}_dispatch`;
          actionTarget.dataset.r9AgentTeamDispatchControl = nextKind;
          actionTarget.textContent = nextKind === "resume"
            ? (locale === "en-US" ? "Resume dispatch" : "恢复派发")
            : (locale === "en-US" ? "Pause dispatch" : "暂停派发");
          const panel = actionTarget.closest<HTMLElement>("[data-r9-agent-team-panel]");
          panel?.setAttribute("data-r9-agent-team-status", result.status);
          // UX 审计（M3）：按钮翻了、标题还喊「推进中」在撒谎——头行随状态一起改写。
          const heading = panel?.querySelector<HTMLElement>("h3");
          if (heading) {
            const ratioMatch = /(\d+\/\d+)/u.exec(heading.textContent ?? "");
            const ratio = ratioMatch?.[1] ?? "";
            heading.textContent = result.status === "paused"
              ? (locale === "en-US" ? `Team paused ${ratio}` : `军团已暂停 ${ratio}`).trim()
              : (locale === "en-US" ? `Team in progress ${ratio}` : `军团进行中 ${ratio}`).trim();
          }
          const body = planDispatchAction.action === "pause"
            ? (locale === "en-US" ? "Dispatch paused — running subtasks will finish, no new ones start." : "已暂停派发——在跑的子任务会跑完，不再派新的。")
            : (locale === "en-US" ? "Dispatch resumed — ready subtasks are being sent out." : "已恢复派发——就绪的子任务正在派出。");
          showRouteNotice(shellRoot, actionSuccessNotice(locale, body, actionId));
        } catch (error) {
          showRouteNotice(shellRoot, actionErrorNotice(locale, error, actionId));
        }
        return;
      }
      showRouteNotice(shellRoot, actionPendingNotice(locale, actionId));
      } finally {
        endBusyAction(busyKey);
        if (actionTarget.isConnected) {
          actionTarget.removeAttribute("aria-disabled");
        }
      }
    }
  }, eventListenerOptions(signal));

  shellRoot.addEventListener("input", (event) => {
    // R6（表单）：意图框 280 上限只有一次性静态提示——实时回填「已用 N / 280 字」，260+ 提醒接近上限。
    if (event.target instanceof HTMLTextAreaElement && event.target.matches("[data-s1-day1-intent-input]")) {
      const limitEl = event.target.closest("section, form, div")?.parentElement?.querySelector<HTMLElement>("[data-r9-intake-intent-limit]")
        ?? shellRoot.querySelector<HTMLElement>("[data-r9-intake-intent-limit]");
      if (limitEl) {
        const used = event.target.value.length;
        limitEl.textContent = locale === "en-US"
          ? `${used} / 280 characters${used >= 260 ? " — almost at the limit" : ""}`
          : `已用 ${used} / 280 字${used >= 260 ? "——快到上限了" : ""}`;
      }
    }
    // R12（多项目）：/projects 列表按名称即时过滤（客户端隐藏不匹配行，零请求）。
    if (event.target instanceof HTMLInputElement && event.target.matches("[data-r12-project-filter]")) {
      const filterQuery = event.target.value.trim().toLowerCase();
      const listRoot = event.target.closest("[data-r8-projects-list]");
      for (const row of listRoot?.querySelectorAll<HTMLElement>("[role=listitem]") ?? []) {
        const name = row.querySelector("strong")?.textContent?.toLowerCase() ?? "";
        row.hidden = Boolean(filterQuery) && !name.includes(filterQuery);
      }
      return;
    }
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
    // 普通用户审查 R3 high：审批讨论/意见说明/网盘评论三个输入框此前不在 dirty-guard 里——
    // SSE 事件整页重渲会静默清空写了一半的文字。
    const draftBox = event.target instanceof Element
      ? event.target.closest<HTMLTextAreaElement>("[data-r4-approval-comment-input], [data-r4-approval-reason], [data-r9-drive-comment-input], [data-r9-sync-merge-value]")
      : null;
    if (draftBox && draftBox.value.trim().length > 0) {
      markActiveRouteDirty("comment_draft_pending");
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
  // R10（竞态）：注册屏也要推进渲染代际——否则在途的 renderCurrentRoute（如 SSE silent 刷新）
  // resolve 时代际未变、守卫恒过，会把已失效会话的鉴权态内容静默盖回注册屏之上。
  activeRouteRenderId += 1;
  clearReadyRouteBindings();
  liveRuntime?.closeAllLiveEventSources();
  unmountReactRouteIsland();
  clearLiveDirtyMetrics();
  root.innerHTML = renderWebRouteState(currentRouteMatch(), "error", locale, {
    traceId: routeErrorTrace(error),
    // R10-S3：已登录时错误态保留产品壳（顶栏+导航），不再整屏裸卡。
    ...(currentIdentity ? { shellUser: currentIdentity } : {})
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
  // R8（竞态）：「正在展示回执就跳过刷新提示」的判断必须在重渲【前】快照——
  // innerHTML 替换后 notice 节点是不带 data-r4-notice-kind 的新节点，事后读恒为空。
  {
    const noticeEl = root?.querySelector<HTMLElement>('[data-wh-app-notice]');
    // 只认「可见」的回执——超时隐藏后节点仍残留 dataset，不该继续压制刷新提示。
    lastNoticeKindBeforeSseRefresh = noticeEl && !noticeEl.hidden
      ? noticeEl.getAttribute("data-r4-notice-kind") ?? undefined
      : undefined;
  }
  // L#79：SSE 刷新也要 fail-closed——会话过期(not_identified)时回到注册屏，
  // 而不是让错误冒泡、让用户停在一个已失效的已登录视图上。
  // R7 回归修复：R4 给 renderCurrentRoute 加的 silent 开关此前没接到这里（三处调用点全没传），
  // 「SSE 不闪 loading 不抢焦点」从未真正生效——这才是唯一该走 silent 的路径。
  await renderCurrentRouteOrOnboard(client, locale, { silent: true });
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
      // 普通用户审查 R2：动作回执与「页面已刷新」共用一个 toast 槽——回执刚弹出就被刷新提示盖掉。
      // 正在展示操作回执时跳过 info 级刷新提示（刷新本体已完成，不损失功能）。
      if (outcome !== "dirty-deferred" && lastNoticeKindBeforeSseRefresh === "action_success") {
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
    onFatal: (error) => renderFatalRouteError(locale, error),
    // R5（慢网感知）：SSE 放弃重连后用户此前零感知——页面看着正常但不再实时更新。
    // 弹持久提示（timeoutMs=0 不自动消失）+ 手动刷新按钮（复用 dirty-guard 的刷新动作，带全 query）。
    onGiveUp: () => {
      if (!root) {
        return;
      }
      showRouteNotice(
        root,
        {
          kind: "sse_gave_up",
          tone: "warning",
          source: "sse",
          locale,
          title: locale === "en-US" ? "Live updates disconnected" : "实时更新已断开",
          body: locale === "en-US"
            ? "The live connection was lost and automatic retries stopped. Refresh to reconnect."
            : "实时连接已中断且自动重试已停止，页面内容可能不再自动更新。点下方按钮刷新重连。"
        },
        dirtyGuardRefreshAction(locale, webRouteHref(`${window.location.pathname}${window.location.search}`)),
        0
      );
    }
  });
}

function bindLiveRouteStreams(result: WebRouteReadyResult, client: BrowserApiClient, locale: WorkHubLocale) {
  liveRuntime ??= createBrowserLiveRuntime(client, locale);
  liveRuntime.syncTargets(liveStreamTargetsForRoute(result, client));
}

// R7（中断恢复 high）：dirty-guard 此前只护 SSE 刷新——用户自己按后退/点导航反而把没提交的输入
// 静默清空。改武装式守卫（与桌面 Esc 同模式）：脏时第一次离开被拦下并提示，5 秒内再次操作才放行。
// 不用 window.confirm——原生对话框会卡死 headless smoke 且不可样式化。
let dirtyLeaveArmedUntil = 0;
// R8（竞态）：SSE 重渲前 notice 的 kind 快照——onRefreshNotice 用它而非读已被替换的节点。
let lastNoticeKindBeforeSseRefresh: string | undefined;
// 最近一次真正渲染到屏上的路由 href——popstate 被 dirty 守卫拦下时用它把地址栏顶回去。
let lastRenderedHref: string | undefined;

function confirmLeaveDirtyRoute(locale: WorkHubLocale): boolean {
  if (!activeRouteHasDirtyEdits()) {
    return true;
  }
  if (dirtyLeaveArmedUntil > Date.now()) {
    dirtyLeaveArmedUntil = 0;
    clearActiveRouteDirty();
    return true;
  }
  dirtyLeaveArmedUntil = Date.now() + 5000;
  if (root) {
    showRouteNotice(root, {
      kind: "sse_dirty_guard",
      tone: "warning",
      source: "client",
      locale,
      title: locale === "en-US" ? "You have unsaved input" : "有未提交的输入",
      body: locale === "en-US"
        ? "Leaving now will discard it. Navigate again within 5 seconds to leave anyway."
        : "现在离开会丢掉这些内容。5 秒内再次离开即确认放弃。"
    });
  }
  return false;
}

// 注意：navigateWebRoute 本身不做 dirty 守卫——动作成功后的程序化跳转（如创建工作项→详情页）
// 意味着输入已提交；守卫只挂在用户主动导航入口（导航链接点击 + popstate）。
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
  bindHomeProjectsRetry(root, client, locale, signal);
  bindProjectHomePlansPanel(root, result, client, locale, signal);
  bindProjectHomeInstructionsPanel(root, result, client, locale, signal);
  bindProjectHomeMembersPanel(root, result, client, locale, signal);
  bindConversationParticipantsPanel(root, result, client, locale, signal);
  bindSearchRoutePanel(root, result, client, locale, signal);
  bindSettingsAiProfilePanel(root, result, client, locale, signal);
  bindSettingsMembersPanel(root, result, client, locale, signal);
  bindSettingsMyProfilePanel(root, result, client, locale, signal);
  bindSettingsAvatarPanel(root, result, client, locale, signal);
  bindAvatarTiles(root, signal);
  bindMemoryPanel(root, result, client, locale, signal);
  bindProposalFeedbackNotePanel(root, result, client, locale, signal);
  bindLiveRouteStreams(result, client, locale);
}

// R14 批 CHAT（web-avatars，2026-07-14 用户点名新增）：把 route-components.ts 里用
// personAvatarTileHtml（packages/ui/src/avatar/avatar-tile.ts）打了 data-r14-avatar-tile-user-id
// 标记的首字母色块 tile（审批路由/委派、成本按人/按执行者分账、项目负责人、会议上传者、工单负责人——
// 凡是 VM 里已经带 user_id 的人物出现点）换成真实头像图（若该用户设了头像）。web 走 cookie 鉴权，
// /api/users/:id/avatar 可以直连——不需要像桌面 apps/desktop-webview 的 hydrateAvatarPhotos 那样走
// 鉴权 fetch+blob，直接把 img.src 指过去、onload 显示/onerror 保持隐藏（色块本就在底下天然回退）
// 即可；逻辑上是 bindSettingsAvatarPanel 里 showAvatarUrl 那套的泛化版本，只是这里覆盖任意路由、
// 任意个数的只读 tile，不绑定上传/删除交互。挂在每次路由渲染后、不按 route key 过滤——头像 tile
// 可能出现在任意路由。
function bindAvatarTiles(container: HTMLElement, signal: AbortSignal) {
  const tiles = container.querySelectorAll<HTMLElement>("[data-r14-avatar-tile-user-id]");
  tiles.forEach((tile) => {
    const userId = tile.dataset.r14AvatarTileUserId;
    const img = tile.querySelector<HTMLImageElement>(".wh-avatar-img");
    if (!userId || !img) {
      return;
    }
    img.onload = () => {
      if (signal.aborted) {
        return;
      }
      img.hidden = false;
    };
    img.onerror = () => {
      img.hidden = true;
    };
    img.src = `/api/users/${encodeURIComponent(userId)}/avatar`;
  });
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

  // R10-P1-7：水合竞态收口——SSR 开关是禁用的，只有 GET 成功回填后才解禁；GET 失败保持锁定+
  // 显式错误+重试按钮（此前失败被静默吞掉，用户在「假的全不勾」上点一下就把已有静音整组覆盖丢了）。
  const retryButton = panel.querySelector<HTMLButtonElement>("[data-r10-notification-mute-retry]");
  // G4 #10（关怀 opt-out）：Cuu 关怀私聊开关——与 mute 复选框共用同一份偏好 GET/PUT，故一起水合/一起锁禁用。
  const careToggle = panel.querySelector<HTMLInputElement>("[data-r17-notification-care-toggle]");
  const setEnabled = (enabled: boolean) => {
    for (const checkbox of checkboxes) {
      checkbox.disabled = !enabled;
    }
    if (careToggle) {
      careToggle.disabled = !enabled;
    }
  };
  const hydrate = async () => {
    setEnabled(false);
    if (retryButton) {
      retryButton.hidden = true;
    }
    setStatus(zh ? "正在读取当前设置…" : "Loading current settings…", "saving");
    try {
      const prefs = await client.getNotificationPreferences();
      if (signal.aborted) {
        return;
      }
      const muted = new Set(prefs.muted_notification_types ?? []);
      for (const checkbox of checkboxes) {
        checkbox.checked = muted.has(checkbox.getAttribute("data-r5-notification-mute-type") ?? "");
      }
      if (careToggle) {
        // 勾选＝开启关怀（默认 true）；旧后端不带该字段时回落成开启，与服务端默认一致。
        careToggle.checked = prefs.care_messages_enabled !== false;
      }
      setEnabled(true);
      if (status) {
        status.hidden = true;
      }
    } catch {
      if (signal.aborted) {
        return;
      }
      setStatus(zh ? "没能读取当前设置。为避免覆盖你已有的静音，开关已暂时锁定。" : "Couldn't load current settings — toggles stay locked so we don't overwrite what you saved.", "error");
      if (retryButton) {
        retryButton.hidden = false;
      }
    }
  };
  void hydrate();
  retryButton?.addEventListener("click", () => void hydrate(), { signal });

  // 保存按到达顺序串行（PUT 是整体替换，乱序完成会用旧勾选覆盖新勾选）；每次执行时现读 DOM，最后写赢。
  // includeCare=true 时把关怀开关也一并提交（care 行变更）；否则省略该字段＝不动关怀（mute 行变更）。
  let saveChain: Promise<void> = Promise.resolve();
  const doSave = async (includeCare: boolean) => {
    const muted = checkboxes
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.getAttribute("data-r5-notification-mute-type") ?? "")
      .filter((type) => type.length > 0);
    setStatus(zh ? "保存中…" : "Saving…", "saving");
    try {
      await client.setNotificationPreferences(
        muted,
        includeCare && careToggle ? { careMessagesEnabled: careToggle.checked } : undefined
      );
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
  const save = (includeCare: boolean) => {
    saveChain = saveChain.then(() => doSave(includeCare));
    return saveChain;
  };

  for (const checkbox of checkboxes) {
    checkbox.addEventListener("change", () => void save(false), { signal });
  }
  careToggle?.addEventListener("change", () => void save(true), { signal });
}

// P1-07：首页「项目清单加载失败」警示条的重试按钮——项目清单与 attention 是并行独立拉取，前者失败
// 时首页仍渲出（决策/运行照常），这里给失败区一个真的重试出路：整路由重渲（renderCurrentRoute 会重新
// 并行拉 attention + 项目清单），而不是把用户困在一个静默降级、看不出是失败的软空态里。
function bindHomeProjectsRetry(
  container: HTMLElement,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal
) {
  const retry = container.querySelector<HTMLButtonElement>("[data-r20-home-projects-retry]");
  if (!retry) {
    return;
  }
  retry.addEventListener(
    "click",
    () => {
      retry.disabled = true;
      void renderCurrentRoute(client, locale).catch(() => {
        // 重试本身失败（如整页取数错）交由 renderCurrentRoute 内既有错误态处理；这里只兜底解禁按钮。
        retry.disabled = false;
      });
    },
    { signal }
  );
}

// G4 #9（E3 web 只读入口）：项目主页「规划草案」小区块——拉 GET /api/projects/:id/plan-drafts，
// 只读展示 pending_review 计数 + 最新草案状态；起草/审批/物化都在桌面客户端（web 是管理者控制台定位，
// 不给假点击）。无权/取数失败 → 静默降级成一句「暂无规划草案」，不拖垮整个项目主页（同 army pill 手法）。
function bindProjectHomePlansPanel(
  container: HTMLElement,
  result: WebRouteReadyResult,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal
) {
  if (result.match.key !== "project-home") {
    return;
  }
  const section = container.querySelector<HTMLElement>("[data-r17-project-home-plans]");
  const body = section?.querySelector<HTMLElement>("[data-r17-project-home-plans-body]");
  const projectId = section?.getAttribute("data-r17-project-home-plans-project") ?? "";
  if (!section || !body || !projectId) {
    return;
  }
  const zh = locale === "zh-CN";
  type PlanDraftSlice = { id: string; status: string; updated_at: string };
  const statusLabel = (status: string): string => {
    const map: Record<string, [string, string]> = {
      draft: ["草稿", "Draft"],
      pending_review: ["待审阅", "Pending review"],
      approved: ["已批准", "Approved"],
      rejected: ["已驳回", "Rejected"],
      materialized: ["已物化", "Materialized"]
    };
    const hit = map[status];
    return hit ? (zh ? hit[0] : hit[1]) : status;
  };
  const load = async () => {
    try {
      const data = await client.request<{ drafts?: PlanDraftSlice[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/plan-drafts?locale=${encodeURIComponent(locale)}`
      );
      if (signal.aborted) {
        return;
      }
      const drafts = Array.isArray(data.drafts) ? data.drafts : [];
      if (drafts.length === 0) {
        body.innerHTML = `<p class="wh-subtle" data-r17-project-home-plans-empty="true">${escapeHtml(
          zh
            ? "暂无规划草案。让 AI 起草项目计划在桌面客户端进行。"
            : "No plan drafts yet. Drafting a project plan with AI happens in the desktop app."
        )}</p>`;
        return;
      }
      const pending = drafts.filter((draft) => draft.status === "pending_review").length;
      const latest = [...drafts].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]!;
      const pendingLine = pending > 0
        ? `<p data-r17-project-home-plans-pending="${escapeHtml(String(pending))}"><strong>${escapeHtml(
            zh ? `${pending} 份待审阅` : `${pending} pending review`
          )}</strong></p>`
        : "";
      body.innerHTML = `${pendingLine}
        <div class="wh-r4-route-meta">
          <span class="wh-pill">${escapeHtml(zh ? `共 ${drafts.length} 份` : `${drafts.length} total`)}</span>
          <span class="wh-pill" data-r17-project-home-plans-latest="${escapeHtml(latest.status)}">${escapeHtml(
            zh ? `最新：${statusLabel(latest.status)}` : `Latest: ${statusLabel(latest.status)}`
          )}</span>
        </div>
        <p class="wh-subtle">${escapeHtml(
          zh
            ? "查看详情、审批与物化在桌面客户端的日程标签进行。"
            : "View details, approve and materialize from the Schedule tab in the desktop app."
        )}</p>`;
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      // P1-07：把「无权」和「取数失败」分开——此前两者都静默降级成「暂无规划草案」，把加载失败谎报成空。
      //   * 403（无权）：如实说明「你没有查看权限」，与「加载成功但 0 份草案」的空态区分（不暴露是否真有草案）。
      //   * 其它（5xx/网络）：渲警示条 + 重试，不当空态糊弄。
      if (error instanceof WorkHubApiError && error.status === 403) {
        body.innerHTML = `<p class="wh-subtle" data-r17-project-home-plans-forbidden="true">${escapeHtml(
          zh ? "你没有查看规划草案的权限。" : "You don't have permission to view plan drafts."
        )}</p>`;
        return;
      }
      body.innerHTML = `<p class="wh-subtle" data-r17-project-home-plans-error="true">${escapeHtml(
        zh ? "规划草案加载失败，稍后重试。" : "Couldn't load plan drafts — retry later."
      )}</p><button type="button" class="wh-btn" data-r17-project-home-plans-retry="true">${escapeHtml(zh ? "重试" : "Retry")}</button>`;
      body.querySelector<HTMLButtonElement>("[data-r17-project-home-plans-retry]")
        ?.addEventListener("click", () => void load(), { signal });
    }
  };
  void load();
}

// G4 #24（项目自定义指令 web 入口）：项目主页「自定义指令」卡——GET /api/projects/:id/instructions
// 展示；能管项目（GET 成功）→ 可编辑 textarea + 失焦 PATCH 保存；无权（403）→ 只读说明。错误矩阵对齐
// 桌面 W4b1（403 forbidden / 422 validation / 其它 network，保存失败绝不回滚用户刚敲的内容）。
const PROJECT_INSTRUCTIONS_MAX_CHARS = 4000;
function bindProjectHomeInstructionsPanel(
  container: HTMLElement,
  result: WebRouteReadyResult,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal
) {
  if (result.match.key !== "project-home") {
    return;
  }
  const section = container.querySelector<HTMLElement>("[data-r17-project-home-instructions]");
  const body = section?.querySelector<HTMLElement>("[data-r17-project-home-instructions-body]");
  const projectId = section?.getAttribute("data-r17-project-home-instructions-project") ?? "";
  if (!section || !body || !projectId) {
    return;
  }
  const zh = locale === "zh-CN";
  type InstructionsSlice = { project_id: string; instructions_md: string; updated_at: string };
  const path = `/api/projects/${encodeURIComponent(projectId)}/instructions`;
  // confirmed = 上一次服务端确认过的值（幂等判定基线）；保存失败不回滚 textarea（用户刚敲的还在）。
  let confirmed = "";

  const renderForbidden = () => {
    body.innerHTML = `<p class="wh-subtle" data-r17-project-home-instructions-forbidden="true">${escapeHtml(
      zh ? "需要项目管理权限才能查看和修改自定义指令。" : "You need project management permission to view or change custom instructions."
    )}</p>`;
  };
  const renderError = () => {
    body.innerHTML = `<p class="wh-subtle" data-r17-project-home-instructions-error="true">${escapeHtml(
      zh ? "自定义指令没拉到，稍后重试。" : "Couldn't load custom instructions — retry later."
    )}</p><button type="button" class="wh-btn" data-r17-project-home-instructions-retry="true">${escapeHtml(zh ? "重试" : "Retry")}</button>`;
    body.querySelector<HTMLButtonElement>("[data-r17-project-home-instructions-retry]")
      ?.addEventListener("click", () => void hydrate(), { signal });
  };

  const renderEditor = () => {
    body.innerHTML = `<textarea class="wh-r17-instructions-area" style="width:100%;box-sizing:border-box;resize:vertical" data-r17-project-home-instructions-textarea rows="6" maxlength="${PROJECT_INSTRUCTIONS_MAX_CHARS + 200}" placeholder="${escapeHtml(
      zh ? "例如：所有输出用简体中文，避免技术黑话。" : "e.g. Reply in plain English, no jargon."
    )}"></textarea>
      <div class="wh-r4-route-meta">
        <span class="wh-subtle" data-r17-project-home-instructions-status hidden></span>
        <span class="wh-subtle">${escapeHtml(zh ? "失焦自动保存，留空则不注入项目级指令。" : "Saves on blur; leave blank to skip project-level instructions.")}</span>
      </div>`;
    const textarea = body.querySelector<HTMLTextAreaElement>("[data-r17-project-home-instructions-textarea]");
    const status = body.querySelector<HTMLElement>("[data-r17-project-home-instructions-status]");
    if (!textarea) {
      return;
    }
    textarea.value = confirmed;
    const setStatus = (text: string, tone: "saving" | "saved" | "error") => {
      if (!status) {
        return;
      }
      status.hidden = false;
      status.textContent = text;
      status.setAttribute("data-r17-project-home-instructions-status", tone);
    };
    let saveChain: Promise<void> = Promise.resolve();
    const doSave = async (trimmed: string) => {
      setStatus(zh ? "保存中…" : "Saving…", "saving");
      try {
        const next = await client.request<InstructionsSlice>(path, {
          method: "PATCH",
          body: JSON.stringify({ instructions_md: trimmed })
        });
        if (signal.aborted) {
          return;
        }
        confirmed = next.instructions_md;
        setStatus(zh ? "已保存" : "Saved", "saved");
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        if (error instanceof WorkHubApiError && error.status === 403) {
          // 权限中途没了——整卡收成只读说明（不留「看起来能编辑」的假象）。
          renderForbidden();
          return;
        }
        if (error instanceof WorkHubApiError && error.status === 422) {
          setStatus(
            zh ? `超出 ${PROJECT_INSTRUCTIONS_MAX_CHARS} 字上限，删短一点再试。` : `Over the ${PROJECT_INSTRUCTIONS_MAX_CHARS}-character limit — trim it and try again.`,
            "error"
          );
          return;
        }
        // 网络等：保留用户输入，只给错误提示（不回滚 textarea）。
        setStatus(zh ? "没保存成功，你写的内容还在——改一下、失焦即可重试。" : "Couldn't save — what you typed is still here. Edit and blur to retry.", "error");
      }
    };
    textarea.addEventListener(
      "blur",
      () => {
        const trimmed = textarea.value.trim();
        if (trimmed === confirmed) {
          return; // 幂等：与上次确认值相同，不发请求。
        }
        if (trimmed.length > PROJECT_INSTRUCTIONS_MAX_CHARS) {
          setStatus(
            zh ? `超出 ${PROJECT_INSTRUCTIONS_MAX_CHARS} 字上限，删短一点再试。` : `Over the ${PROJECT_INSTRUCTIONS_MAX_CHARS}-character limit — trim it and try again.`,
            "error"
          );
          return;
        }
        saveChain = saveChain.then(() => doSave(trimmed));
      },
      { signal }
    );
  };

  const hydrate = async () => {
    body.innerHTML = `<p class="wh-subtle">${escapeHtml(zh ? "正在加载自定义指令…" : "Loading custom instructions…")}</p>`;
    try {
      const vm = await client.request<InstructionsSlice>(path);
      if (signal.aborted) {
        return;
      }
      confirmed = vm.instructions_md;
      renderEditor();
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      // GET 与 PATCH 同一道 canManageProjectDrive 门：403＝无权（读写都不行）→ 只读说明；其它＝取数错。
      if (error instanceof WorkHubApiError && error.status === 403) {
        renderForbidden();
        return;
      }
      renderError();
    }
  };
  void hydrate();
}

// R18 批 H1（项目设置成员分区镜像）：项目主页「成员」摘要小块的客户端水合。SSR 只出加载态骨架；这里拉
// /api/users（主区全员计数，任何成员可读）与 /api/projects/:id/conversations（协同会话数 + 主区会话 id）
// 后填数并链到主区会话镜像 /conversations/:id。轻量镜像——不复制桌面工作台的成员全功能。取数失败静默降级。
type ProjectHomeConversationLite = { id: string; kind: "main" | "collab"; is_dm?: boolean };
type ProjectHomeConversationsVM = { conversations: ProjectHomeConversationLite[]; capped: boolean };

function bindProjectHomeMembersPanel(
  container: HTMLElement,
  result: WebRouteReadyResult,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal
) {
  if (result.match.key !== "project-home") {
    return;
  }
  const section = container.querySelector<HTMLElement>("[data-r18-project-home-members]");
  const body = section?.querySelector<HTMLElement>("[data-r18-project-home-members-body]");
  const projectId = section?.getAttribute("data-r18-project-home-members-project") ?? "";
  if (!section || !body || !projectId) {
    return;
  }
  const zh = locale === "zh-CN";

  const hydrate = async () => {
    try {
      const [memberCount, convos] = await Promise.all([
        // 成员数取工作区花名册的 total（本工作区活跃成员真实总数），而非全局用户目录长度。limit=1 只为拿 total。
        client.request<WorkspaceRosterVM>("/api/workspace/roster?limit=1").then(
          (value) => value.total,
          (): number | null => null
        ),
        client.request<ProjectHomeConversationsVM>(`/api/projects/${encodeURIComponent(projectId)}/conversations`).then(
          (value) => value,
          (): ProjectHomeConversationsVM | null => null
        )
      ]);
      if (signal.aborted) {
        return;
      }
      // 协同会话数 = collab 且非 DM（DM 是 is_dm=true 的 collab，不算团队协同会话）。
      const collabCount = convos ? convos.conversations.filter((c) => c.kind === "collab" && c.is_dm !== true).length : null;
      const capped = convos?.capped ?? false;
      const mainId = convos?.conversations.find((c) => c.kind === "main")?.id ?? "";

      const pills: string[] = [];
      if (memberCount !== null) {
        pills.push(`<span class="wh-pill" data-r18-project-home-members-count="${escapeHtml(String(memberCount))}">${escapeHtml(zh ? `主区 ${memberCount} 名成员` : `${memberCount} in main channel`)}</span>`);
      }
      if (collabCount !== null) {
        const label = zh ? `${collabCount}${capped ? "+" : ""} 个协同会话` : `${collabCount}${capped ? "+" : ""} collab conversation${collabCount === 1 && !capped ? "" : "s"}`;
        pills.push(`<span class="wh-pill" data-r18-project-home-collab-count="${escapeHtml(String(collabCount))}">${escapeHtml(label)}</span>`);
      }
      if (!pills.length) {
        body.innerHTML = `<p class="wh-subtle" data-r18-project-home-members-error="true">${escapeHtml(
          zh ? "成员摘要没拉到，稍后重试。" : "Couldn't load the member summary — retry later."
        )}</p><button type="button" class="wh-btn" data-r18-project-home-members-retry="true">${escapeHtml(zh ? "重试" : "Retry")}</button>`;
        body.querySelector<HTMLButtonElement>("[data-r18-project-home-members-retry]")
          ?.addEventListener("click", () => void hydrate(), { signal });
        return;
      }
      const link = mainId
        ? `<a class="wh-r4-route-kicker" href="/conversations/${encodeURIComponent(mainId)}" data-r18-project-home-members-mirror="true">${escapeHtml(zh ? "查看主区会话镜像 →" : "Open the main-channel conversation mirror →")}</a>`
        : "";
      body.innerHTML = `<div class="wh-r4-route-meta">${pills.join("")}</div>
        <p class="wh-subtle">${escapeHtml(zh ? "主区会话对工作区全员可见；协同会话与成员的完整管理在桌面工作台。" : "The main channel is visible to the whole workspace; full member and collab management lives in the desktop workbench.")}</p>
        ${link}`;
    } catch {
      if (signal.aborted) {
        return;
      }
      body.innerHTML = `<p class="wh-subtle" data-r18-project-home-members-error="true">${escapeHtml(
        zh ? "成员摘要没拉到，稍后重试。" : "Couldn't load the member summary — retry later."
      )}</p>`;
    }
  };
  void hydrate();
}

// R18 批 H1（web 会话镜像成员管理）：只读会话镜像的「参与者」侧区水合。SSR（route-components
// renderConversationRouteComponent）只出加载态骨架；这里拉 GET /participants 后按 scope/is_dm 渲：
//   * main（scope:"workspace"）→ 全员会话说明，无动作；
//   * DM（scope:"participants" + is_dm）→ 双人说明，无动作；
//   * 普通群（scope:"participants" 非 DM）→ 成员条 + 群管理动作：任何参与者可加人（工作区成员选择器，
//     排除已在群者）与退出（自删）；群主额外可移出他人。调 G1 端点，403/409 按错误码人话化。
// web 镜像页刻意不订会话 SSE（G-web 窄化纪律，见 liveEventTypes 排除 conversation.*）——参与者变化
// 靠「动作后重拉 + 手动刷新按钮」感知，不把 conversation.* 事件引回 web。
type MirrorParticipantItem = { user_id: string; nickname: string; role: "owner" | "member" };
type MirrorParticipantsVM = { scope: "workspace" | "participants"; is_dm?: boolean; participants: MirrorParticipantItem[] };
type MirrorRemoveResult = { removed_user_id: string; self_left: boolean; new_owner_user_id: string | null };
type MirrorAddResult = { added: boolean; participants: MirrorParticipantsVM };

function bindConversationParticipantsPanel(
  container: HTMLElement,
  result: WebRouteReadyResult,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal
) {
  if (result.match.key !== "conversation") {
    return;
  }
  const section = container.querySelector<HTMLElement>("[data-r18-conversation-participants]");
  const body = section?.querySelector<HTMLElement>("[data-r18-conversation-participants-body]");
  const conversationId = section?.getAttribute("data-r18-conversation-id") ?? "";
  if (!section || !body || !conversationId) {
    return;
  }
  const zh = locale === "zh-CN";
  const participantsPath = `/api/conversations/${encodeURIComponent(conversationId)}/participants`;
  let selfUserId = "";
  let roster: Array<{ id: string; nickname: string }> = [];

  // 端点错误码 → 双语人话（服务端消息只有中文，en 直接回退它会串语言，所以已知码全给双语；未知码回落通用）。
  const ACTION_ERROR_COPY: Record<string, [string, string]> = {
    conversation_add_target_required: ["请先选择要加入的成员。", "Pick a member to add first."],
    conversation_participant_invalid: ["这个人不在工作区里，无法加入。", "That person isn't in the workspace and can't be added."],
    conversation_dm_target_not_found: ["没有找到工作区里的这个人。", "That person wasn't found in the workspace."],
    conversation_participant_cap: ["这个群的成员已经满了。", "This group is already full."],
    conversation_not_group: ["主区是全员会话，不能单独增删成员。", "The main channel includes everyone — members can't be added or removed."],
    conversation_dm_no_add: ["私聊只能是两个人，不能再加人。", "A DM is limited to two people."],
    conversation_dm_no_remove: ["私聊不能移出或退出。", "You can't leave or remove members from a DM."],
    conversation_remove_forbidden: ["只有群主可以移出其他成员。", "Only the group owner can remove other members."],
    conversation_last_participant: ["你是最后一名成员，不能退出。", "You're the last member — you can't leave."],
    conversation_participant_not_found: ["这个人已经不在群里了。", "That person is no longer in the group."],
    conversation_not_found: ["没有找到这个会话。", "Conversation not found."]
  };
  const humanize = (error: unknown): string => {
    if (error instanceof WorkHubApiError) {
      const pair = ACTION_ERROR_COPY[error.code];
      if (pair) {
        return zh ? pair[0] : pair[1];
      }
    }
    return zh ? "操作失败，请稍后重试。" : "Action failed, please try again.";
  };

  const renderLoading = () => {
    body.innerHTML = `<p class="wh-subtle">${escapeHtml(zh ? "正在加载参与者…" : "Loading participants…")}</p>`;
  };
  const renderError = () => {
    body.innerHTML = `<p class="wh-subtle" data-r18-conversation-participants-error="true">${escapeHtml(
      zh ? "参与者没拉到，稍后重试。" : "Couldn't load participants — retry later."
    )}</p><button type="button" class="wh-btn" data-r18-conversation-participants-retry="true">${escapeHtml(zh ? "重试" : "Retry")}</button>`;
    body.querySelector<HTMLButtonElement>("[data-r18-conversation-participants-retry]")
      ?.addEventListener("click", () => void hydrate(), { signal });
  };

  const applyVm = (vm: MirrorParticipantsVM) => {
    if (vm.scope === "workspace") {
      body.innerHTML = `<p class="wh-subtle" data-r18-conversation-participants-scope="workspace">${escapeHtml(
        zh
          ? "这是主区会话，工作区全体成员都能看到，没有单独的参与者名单可管理。"
          : "This is the main channel — visible to the whole workspace; there is no per-conversation roster to manage."
      )}</p>`;
      return;
    }
    if (vm.is_dm) {
      const names = vm.participants.map((p) => p.nickname).join(zh ? "、" : ", ");
      body.innerHTML = `<p data-r18-conversation-participants-scope="dm"><strong>${escapeHtml(zh ? "私聊（双人）" : "Direct message (2 people)")}</strong></p>
        <p class="wh-subtle">${escapeHtml(names)}</p>
        <p class="wh-subtle">${escapeHtml(zh ? "私聊固定两个人，不能加人或移出。" : "A DM is fixed at two people — members can't be added or removed.")}</p>`;
      return;
    }
    renderGroup(vm);
  };

  const renderGroup = (vm: MirrorParticipantsVM) => {
    const selfRole = vm.participants.find((p) => p.user_id === selfUserId)?.role;
    const isOwner = selfRole === "owner";
    const rowsHtml = vm.participants
      .map((p) => {
        const isSelf = p.user_id === selfUserId;
        const roleLabel = p.role === "owner" ? (zh ? "群主" : "Owner") : (zh ? "成员" : "Member");
        let actionHtml = "";
        if (isSelf) {
          actionHtml = `<button type="button" class="wh-btn" data-r18-participant-leave="true">${escapeHtml(zh ? "退出" : "Leave")}</button>`;
        } else if (isOwner) {
          actionHtml = `<button type="button" class="wh-btn" data-r18-participant-remove="${escapeHtml(p.user_id)}">${escapeHtml(zh ? "移出" : "Remove")}</button>`;
        }
        return `<div class="wh-r4-route-row" data-r18-participant="${escapeHtml(p.user_id)}" data-r18-participant-role="${escapeHtml(p.role)}">
          <div><strong>${escapeHtml(p.nickname)}</strong> <span class="wh-pill">${escapeHtml(roleLabel)}</span>${isSelf ? ` <span class="wh-pill">${escapeHtml(zh ? "你" : "You")}</span>` : ""}</div>
          ${actionHtml}
        </div>`;
      })
      .join("");
    const currentIds = new Set(vm.participants.map((p) => p.user_id));
    const addable = roster.filter((u) => !currentIds.has(u.id));
    const addHtml = addable.length
      ? `<form class="wh-r4-route-row" data-r18-participant-add-form="true">
          <select data-r18-participant-add-select="true" aria-label="${escapeHtml(zh ? "选择要加入的成员" : "Choose a member to add")}">
            ${addable.map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.nickname)}</option>`).join("")}
          </select>
          <button type="submit" class="wh-btn wh-btn-primary" data-r18-participant-add-submit="true">${escapeHtml(zh ? "加入" : "Add")}</button>
        </form>`
      : `<p class="wh-subtle" data-r18-participant-add-empty="true">${escapeHtml(
          zh ? "工作区里其余成员都已在群内。" : "Everyone else in the workspace is already in this group."
        )}</p>`;
    body.innerHTML = `<div class="wh-r4-route-table" data-r18-conversation-participants-scope="group" data-r18-participant-count="${escapeHtml(String(vm.participants.length))}">${rowsHtml}</div>
      <p class="wh-subtle" data-r18-participant-status hidden></p>
      <div class="wh-r18-participant-add">${addHtml}</div>
      <button type="button" class="wh-btn" data-r18-participant-refresh="true">${escapeHtml(zh ? "刷新参与者" : "Refresh participants")}</button>`;

    const status = body.querySelector<HTMLElement>("[data-r18-participant-status]");
    const setStatus = (text: string, tone: "saving" | "error") => {
      if (!status) {
        return;
      }
      status.hidden = false;
      status.textContent = text;
      status.setAttribute("data-r18-participant-status", tone);
    };

    // P2-08：退出/移出是破坏性动作——请求期间禁用触发按钮（防重复提交），失败复位。
    const doRemove = async (targetId: string, button: HTMLButtonElement) => {
      button.disabled = true;
      setStatus(zh ? "处理中…" : "Working…", "saving");
      try {
        const res = await client.request<MirrorRemoveResult>(`${participantsPath}/${encodeURIComponent(targetId)}`, {
          method: "DELETE"
        });
        if (signal.aborted) {
          return;
        }
        if (res.self_left) {
          // 自己退群后就不再是参与者，重拉会 404——不重拉，直接给「已退出」收尾说明。
          body.innerHTML = `<p data-r18-conversation-participants-left="true"><strong>${escapeHtml(zh ? "你已退出该会话。" : "You've left this conversation.")}</strong></p>
            <p class="wh-subtle">${escapeHtml(zh ? "刷新页面后你将无法再看到它。" : "You won't be able to see it after refreshing.")}</p>`;
          return;
        }
        void reload();
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        button.disabled = false;
        setStatus(humanize(error), "error");
      }
    };

    // P2-08：退出/移出加两段式确认——单击只武装（改标签，5 秒回退），再点一次才真正 DELETE。
    const leaveBtn = body.querySelector<HTMLButtonElement>("[data-r18-participant-leave]");
    leaveBtn?.addEventListener(
      "click",
      () => armConfirmButton(leaveBtn, {
        confirmLabel: zh ? "确认退出？再点一次" : "Leave — click again",
        onConfirm: () => void doRemove(selfUserId, leaveBtn)
      }),
      { signal }
    );
    body.querySelectorAll<HTMLButtonElement>("[data-r18-participant-remove]").forEach((btn) => {
      const targetId = btn.getAttribute("data-r18-participant-remove") ?? "";
      btn.addEventListener(
        "click",
        () => armConfirmButton(btn, {
          confirmLabel: zh ? "确认移出？再点一次" : "Remove — click again",
          onConfirm: () => void doRemove(targetId, btn)
        }),
        { signal }
      );
    });
    body.querySelector<HTMLButtonElement>("[data-r18-participant-refresh]")
      ?.addEventListener("click", () => void reload(), { signal });
    body.querySelector<HTMLFormElement>("[data-r18-participant-add-form]")?.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        const select = body.querySelector<HTMLSelectElement>("[data-r18-participant-add-select]");
        const userId = select?.value ?? "";
        if (!userId) {
          setStatus(zh ? "请先选择要加入的成员。" : "Pick a member to add first.", "error");
          return;
        }
        void (async () => {
          setStatus(zh ? "处理中…" : "Working…", "saving");
          try {
            const res = await client.request<MirrorAddResult>(participantsPath, {
              method: "POST",
              body: JSON.stringify({ user_id: userId })
            });
            if (signal.aborted) {
              return;
            }
            applyVm(res.participants); // 加人端点回刷新后的完整列表，直接采用（无需再 GET）。
          } catch (error) {
            if (signal.aborted) {
              return;
            }
            setStatus(humanize(error), "error");
          }
        })();
      },
      { signal }
    );
  };

  const reload = async () => {
    try {
      const vm = await client.request<MirrorParticipantsVM>(participantsPath);
      if (signal.aborted) {
        return;
      }
      applyVm(vm);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      renderError();
    }
  };

  const hydrate = async () => {
    renderLoading();
    try {
      const [me, vm, users] = await Promise.all([
        client.me().catch(() => null),
        client.request<MirrorParticipantsVM>(participantsPath),
        // 加人选择器数据源取工作区花名册（本工作区成员，非全局用户目录）。limit=100 取首页（roster 上限）。
        client.request<WorkspaceRosterVM>("/api/workspace/roster?limit=100").then(
          (value) => value.members.map((m) => ({ id: m.user_id, nickname: m.nickname })),
          () => [] as Array<{ id: string; nickname: string }>
        )
      ]);
      if (signal.aborted) {
        return;
      }
      selfUserId = me?.id ?? "";
      roster = users;
      applyVm(vm);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      renderError();
    }
  };
  void hydrate();
}

// R18 批 H1（web 工作区成员管理）：/settings 「成员」分区的客户端水合（仅管理员——SSR 已门控，非管理员
// 无此骨架，这里 querySelector 落空即静默返回）。拉 GET /api/workspace/members 渲 roster（昵称/角色/加入
// 时间）+ 移出/改角色（DELETE/PATCH /api/workspace/members/:userId），并拉 GET/POST /api/auth/invites 做
// 邀请（令牌一次性展示 + 复制）与未过期邀请清单。调 G1 端点，403/409/last-admin 按错误码人话化。
type SettingsMemberSummary = {
  user_id: string;
  nickname: string;
  role: "member" | "admin" | "owner";
  joined_at: string;
  is_self: boolean;
};
type SettingsMembersVM = { members: SettingsMemberSummary[] };
type SettingsPendingInvite = { invite_id: string; email: string; expires_at: string; created_at: string };
type SettingsPendingInvitesVM = { invites: SettingsPendingInvite[] };
type SettingsInviteCreateResult = { invite_id: string; token: string; email: string; expires_at: string };

function formatDayStamp(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/u.test(iso) ? iso.slice(0, 10) : iso;
}

function bindSettingsMembersPanel(
  container: HTMLElement,
  result: WebRouteReadyResult,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal
) {
  if (result.match.key !== "settings") {
    return;
  }
  const zh = locale === "zh-CN";
  const ROLE_LABELS: Record<SettingsMemberSummary["role"], [string, string]> = {
    member: ["成员", "Member"],
    admin: ["管理员", "Admin"],
    owner: ["拥有者", "Owner"]
  };
  const MEMBER_ERROR_COPY: Record<string, [string, string]> = {
    member_manage_self: ["不能对自己执行这个操作。", "You can't do that to yourself."],
    member_manage_forbidden: ["只有工作区管理员可以管理成员。", "Only workspace admins can manage members."],
    member_last_admin: ["不能移出或降级最后一名管理员。", "You can't remove or demote the last admin."],
    member_not_found: ["没有找到这个成员。", "That member wasn't found."],
    member_target_required: ["请选择要管理的成员。", "Pick a member to manage."]
  };
  const humanizeMember = (error: unknown): string => {
    if (error instanceof WorkHubApiError) {
      const pair = MEMBER_ERROR_COPY[error.code];
      if (pair) {
        return zh ? pair[0] : pair[1];
      }
    }
    return zh ? "操作失败，请稍后重试。" : "Action failed, please try again.";
  };

  bindSettingsMembersRoster(container, client, zh, signal, ROLE_LABELS, humanizeMember);
  bindSettingsInvites(container, client, zh, signal);
}

function bindSettingsMembersRoster(
  container: HTMLElement,
  client: BrowserApiClient,
  zh: boolean,
  signal: AbortSignal,
  roleLabels: Record<SettingsMemberSummary["role"], [string, string]>,
  humanize: (error: unknown) => string
) {
  const section = container.querySelector<HTMLElement>("[data-r18-settings-members]");
  const body = section?.querySelector<HTMLElement>("[data-r18-settings-members-body]");
  if (!section || !body) {
    return;
  }
  const roles: Array<SettingsMemberSummary["role"]> = ["member", "admin", "owner"];

  const renderError = () => {
    body.innerHTML = `<p class="wh-subtle" data-r18-settings-members-error="true">${escapeHtml(
      zh ? "成员没拉到，稍后重试。" : "Couldn't load members — retry later."
    )}</p><button type="button" class="wh-btn" data-r18-settings-members-retry="true">${escapeHtml(zh ? "重试" : "Retry")}</button>`;
    body.querySelector<HTMLButtonElement>("[data-r18-settings-members-retry]")
      ?.addEventListener("click", () => void hydrate(), { signal });
  };

  const render = (vm: SettingsMembersVM) => {
    const rowsHtml = vm.members
      .map((member) => {
        const roleLabel = roleLabels[member.role][zh ? 0 : 1];
        const joined = formatDayStamp(member.joined_at);
        if (member.is_self) {
          return `<div class="wh-r4-route-row" data-r18-settings-member="${escapeHtml(member.user_id)}" data-r18-settings-member-self="true">
            <div><strong>${escapeHtml(member.nickname)}</strong> <span class="wh-pill">${escapeHtml(zh ? "你" : "You")}</span></div>
            <div class="wh-r4-route-meta"><span class="wh-pill">${escapeHtml(roleLabel)}</span><span class="wh-pill">${escapeHtml(zh ? `加入于 ${joined}` : `Joined ${joined}`)}</span></div>
          </div>`;
        }
        const options = roles
          .map((role) => `<option value="${escapeHtml(role)}"${role === member.role ? " selected" : ""}>${escapeHtml(roleLabels[role][zh ? 0 : 1])}</option>`)
          .join("");
        return `<div class="wh-r4-route-row" data-r18-settings-member="${escapeHtml(member.user_id)}" data-r18-settings-member-role="${escapeHtml(member.role)}">
          <div><strong>${escapeHtml(member.nickname)}</strong><div class="wh-r4-route-meta"><span class="wh-pill">${escapeHtml(zh ? `加入于 ${joined}` : `Joined ${joined}`)}</span></div></div>
          <div class="wh-r4-route-meta">
            <select data-r18-settings-member-role-select="${escapeHtml(member.user_id)}" data-r18-settings-member-role-current="${escapeHtml(member.role)}" aria-label="${escapeHtml(zh ? "角色" : "Role")}">${options}</select>
            <button type="button" class="wh-btn" data-r18-settings-member-role-confirm="${escapeHtml(member.user_id)}" hidden>${escapeHtml(zh ? "确认改角色" : "Confirm role")}</button>
            <button type="button" class="wh-btn" data-r18-settings-member-remove="${escapeHtml(member.user_id)}">${escapeHtml(zh ? "移出" : "Remove")}</button>
          </div>
        </div>`;
      })
      .join("");
    body.innerHTML = `<div class="wh-r4-route-table" data-r18-settings-members-count="${escapeHtml(String(vm.members.length))}">${rowsHtml}</div>
      <p class="wh-subtle" data-r18-settings-members-status hidden></p>`;

    const status = body.querySelector<HTMLElement>("[data-r18-settings-members-status]");
    const setStatus = (text: string, tone: "saving" | "error") => {
      if (!status) {
        return;
      }
      status.hidden = false;
      status.textContent = text;
      status.setAttribute("data-r18-settings-members-status", tone);
    };

    // P2-08：破坏性成员动作加二次确认 + 请求期间锁整行控件（防误触、防重复提交）。移出走两段式确认按钮；
    // 改角色走「选新角色（第一步）→ 点确认改角色（第二步）」——select 不再一改即提交。
    // 按成员 id 定位同排的 select / 确认改角色 / 移出三个控件，请求期间一并禁用。
    const rowControls = (targetId: string) => ({
      select: body.querySelector<HTMLSelectElement>(`[data-r18-settings-member-role-select="${CSS.escape(targetId)}"]`),
      roleConfirm: body.querySelector<HTMLButtonElement>(`[data-r18-settings-member-role-confirm="${CSS.escape(targetId)}"]`),
      remove: body.querySelector<HTMLButtonElement>(`[data-r18-settings-member-remove="${CSS.escape(targetId)}"]`)
    });
    const setRowDisabled = (targetId: string, disabled: boolean) => {
      const ctrls = rowControls(targetId);
      if (ctrls.select) {
        ctrls.select.disabled = disabled;
      }
      if (ctrls.roleConfirm) {
        ctrls.roleConfirm.disabled = disabled;
      }
      if (ctrls.remove) {
        ctrls.remove.disabled = disabled;
      }
    };

    body.querySelectorAll<HTMLButtonElement>("[data-r18-settings-member-remove]").forEach((btn) => {
      const targetId = btn.getAttribute("data-r18-settings-member-remove") ?? "";
      btn.addEventListener(
        "click",
        () => {
          armConfirmButton(btn, {
            confirmLabel: zh ? "确认移出？再点一次" : "Remove — click again",
            onConfirm: () => {
              void (async () => {
                setRowDisabled(targetId, true);
                setStatus(zh ? "处理中…" : "Working…", "saving");
                try {
                  await client.request(`/api/workspace/members/${encodeURIComponent(targetId)}`, { method: "DELETE" });
                  if (signal.aborted) {
                    return;
                  }
                  void hydrate();
                } catch (error) {
                  if (signal.aborted) {
                    return;
                  }
                  setRowDisabled(targetId, false);
                  setStatus(humanize(error), "error");
                }
              })();
            }
          });
        },
        { signal }
      );
    });

    // 改角色第一步：选新值即揭示「确认改角色」按钮（标出目标角色）；选回原值则收起——不 PATCH。
    body.querySelectorAll<HTMLSelectElement>("[data-r18-settings-member-role-select]").forEach((select) => {
      const targetId = select.getAttribute("data-r18-settings-member-role-select") ?? "";
      const originalRole = select.getAttribute("data-r18-settings-member-role-current") ?? select.value;
      const confirmBtn = rowControls(targetId).roleConfirm;
      select.addEventListener(
        "change",
        () => {
          if (!confirmBtn) {
            return;
          }
          if (select.value === originalRole) {
            confirmBtn.hidden = true;
            return;
          }
          const nextLabel = roleLabels[select.value as SettingsMemberSummary["role"]]?.[zh ? 0 : 1] ?? select.value;
          confirmBtn.textContent = zh ? `确认改为${nextLabel}` : `Confirm: ${nextLabel}`;
          confirmBtn.hidden = false;
        },
        { signal }
      );
    });

    // 改角色第二步：点确认才真正 PATCH，请求期间锁整行；失败回滚下拉、收起确认，不留「看起来改成功了」的假象。
    body.querySelectorAll<HTMLButtonElement>("[data-r18-settings-member-role-confirm]").forEach((confirmBtn) => {
      const targetId = confirmBtn.getAttribute("data-r18-settings-member-role-confirm") ?? "";
      confirmBtn.addEventListener(
        "click",
        () => {
          const ctrls = rowControls(targetId);
          const select = ctrls.select;
          if (!select) {
            return;
          }
          const originalRole = select.getAttribute("data-r18-settings-member-role-current") ?? "";
          const nextRole = select.value;
          if (nextRole === originalRole) {
            confirmBtn.hidden = true;
            return;
          }
          void (async () => {
            setRowDisabled(targetId, true);
            setStatus(zh ? "处理中…" : "Working…", "saving");
            try {
              await client.request(`/api/workspace/members/${encodeURIComponent(targetId)}`, {
                method: "PATCH",
                body: JSON.stringify({ role: nextRole })
              });
              if (signal.aborted) {
                return;
              }
              void hydrate();
            } catch (error) {
              if (signal.aborted) {
                return;
              }
              select.value = originalRole; // 回滚下拉
              confirmBtn.hidden = true;
              setRowDisabled(targetId, false);
              setStatus(humanize(error), "error");
            }
          })();
        },
        { signal }
      );
    });
  };

  const hydrate = async () => {
    try {
      const vm = await client.request<SettingsMembersVM>("/api/workspace/members");
      if (signal.aborted) {
        return;
      }
      render(vm);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      renderError();
    }
  };
  void hydrate();
}

function bindSettingsInvites(container: HTMLElement, client: BrowserApiClient, zh: boolean, signal: AbortSignal) {
  const section = container.querySelector<HTMLElement>("[data-r18-settings-invites]");
  const body = section?.querySelector<HTMLElement>("[data-r18-settings-invites-body]");
  // R20 P1-05：令牌展示区是 body 的持久兄弟节点（SSR 骨架里 [data-r18-settings-invite-token]），不在
  // render() 重建 body.innerHTML 的域内——生成邀请后 showToken 写它、随即 hydrate() 重拉清单重建 body，
  // 令牌盒毫发无损，始终可见可复制（修复此前 render 重建把令牌盒销毁的断链）。
  const tokenBox = section?.querySelector<HTMLElement>("[data-r18-settings-invite-token]");
  if (!section || !body) {
    return;
  }

  const clearToken = () => {
    if (tokenBox) {
      tokenBox.hidden = true;
      tokenBox.innerHTML = "";
    }
  };
  const showToken = (invite: SettingsInviteCreateResult) => {
    if (!tokenBox) {
      return;
    }
    tokenBox.hidden = false;
    // 令牌盒自带状态行——复制反馈不依赖 body 内那条随 render 重建的状态行（否则重拉清单后引用即失效）。
    tokenBox.innerHTML = `<p><strong>${escapeHtml(zh ? "邀请令牌（只显示这一次，请立即复制转交）：" : "Invite token (shown once — copy and hand it off now):")}</strong></p>
      <code class="wh-r18-invite-token" data-r18-settings-invite-token-value style="word-break:break-all">${escapeHtml(invite.token)}</code>
      <div class="wh-r4-route-meta"><button type="button" class="wh-btn" data-r18-settings-invite-copy="true">${escapeHtml(zh ? "复制令牌" : "Copy token")}</button></div>
      <p class="wh-subtle">${escapeHtml(zh ? `发给 ${invite.email}，${formatDayStamp(invite.expires_at)} 前有效。` : `Send to ${invite.email}; valid until ${formatDayStamp(invite.expires_at)}.`)}</p>
      <p class="wh-subtle" data-r18-settings-invite-token-status hidden></p>`;
    const tokenStatus = tokenBox.querySelector<HTMLElement>("[data-r18-settings-invite-token-status]");
    const setTokenStatus = (text: string) => {
      if (tokenStatus) {
        tokenStatus.hidden = false;
        tokenStatus.textContent = text;
      }
    };
    tokenBox.querySelector<HTMLButtonElement>("[data-r18-settings-invite-copy]")?.addEventListener(
      "click",
      () => {
        void navigator.clipboard?.writeText(invite.token).then(
          () => setTokenStatus(zh ? "已复制令牌。" : "Token copied."),
          () => setTokenStatus(zh ? "复制失败，请手动选中复制。" : "Copy failed — select and copy manually.")
        );
      },
      { signal }
    );
  };

  const renderDisabled = () => {
    clearToken();
    body.innerHTML = `<p class="wh-subtle" data-r18-settings-invites-disabled="true">${escapeHtml(
      zh
        ? "邀请功能需要密码登录模式（当前工作区为昵称模式，无需邀请即可加入）。"
        : "Invites require password login mode (this workspace uses nickname mode, where anyone can join without an invite)."
    )}</p>`;
  };
  const renderError = () => {
    body.innerHTML = `<p class="wh-subtle" data-r18-settings-invites-error="true">${escapeHtml(
      zh ? "邀请没拉到，稍后重试。" : "Couldn't load invites — retry later."
    )}</p><button type="button" class="wh-btn" data-r18-settings-invites-retry="true">${escapeHtml(zh ? "重试" : "Retry")}</button>`;
    body.querySelector<HTMLButtonElement>("[data-r18-settings-invites-retry]")
      ?.addEventListener("click", () => void hydrate(), { signal });
  };

  const render = (invites: SettingsPendingInvite[]) => {
    const listHtml = invites.length
      ? `<div class="wh-r4-route-table" data-r18-settings-invites-count="${escapeHtml(String(invites.length))}">${invites
          .map(
            (invite) => `<div class="wh-r4-route-row" data-r18-settings-invite="${escapeHtml(invite.invite_id)}">
              <div><strong>${escapeHtml(invite.email)}</strong></div>
              <div class="wh-r4-route-meta"><span class="wh-pill">${escapeHtml(zh ? `${formatDayStamp(invite.expires_at)} 过期` : `expires ${formatDayStamp(invite.expires_at)}`)}</span><button type="button" class="wh-btn" data-r18-settings-invite-revoke="${escapeHtml(invite.invite_id)}">${escapeHtml(zh ? "撤销" : "Revoke")}</button></div>
            </div>`
          )
          .join("")}</div>`
      : `<p class="wh-subtle" data-r18-settings-invites-empty="true">${escapeHtml(zh ? "还没有未过期的邀请。" : "No pending invites yet.")}</p>`;
    body.innerHTML = `<form class="wh-r4-route-row" data-r18-settings-invite-form="true">
        <input type="email" name="email" required maxlength="320" placeholder="${escapeHtml(zh ? "对方邮箱" : "Invitee email")}" aria-label="${escapeHtml(zh ? "邀请邮箱" : "Invite email")}" autocomplete="off" data-r18-settings-invite-email="true" />
        <button type="submit" class="wh-btn wh-btn-primary" data-r18-settings-invite-submit="true">${escapeHtml(zh ? "邀请" : "Invite")}</button>
      </form>
      <p class="wh-subtle" data-r18-settings-invite-status hidden></p>
      <h4 role="heading" aria-level="3">${escapeHtml(zh ? "未过期邀请" : "Pending invites")}</h4>
      ${listHtml}`;

    const status = body.querySelector<HTMLElement>("[data-r18-settings-invite-status]");
    const setStatus = (text: string, tone: "saving" | "error") => {
      if (!status) {
        return;
      }
      status.hidden = false;
      status.textContent = text;
      status.setAttribute("data-r18-settings-invite-status", tone);
    };

    body.querySelector<HTMLFormElement>("[data-r18-settings-invite-form]")?.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        const input = body.querySelector<HTMLInputElement>("[data-r18-settings-invite-email]");
        const email = input?.value.trim() ?? "";
        if (!email) {
          setStatus(zh ? "请填写对方邮箱。" : "Enter an email first.", "error");
          return;
        }
        void (async () => {
          setStatus(zh ? "生成中…" : "Creating…", "saving");
          try {
            const created = await client.request<SettingsInviteCreateResult>("/api/auth/invites", {
              method: "POST",
              body: JSON.stringify({ email })
            });
            if (signal.aborted) {
              return;
            }
            showToken(created); // 写持久令牌盒（body 兄弟节点）
            if (input) {
              input.value = "";
            }
            void hydrate(); // 重拉未过期清单，纳入刚建的这条——重建 body，但令牌盒安然无恙。
          } catch (error) {
            if (signal.aborted) {
              return;
            }
            if (error instanceof WorkHubApiError && error.status === 422) {
              setStatus(zh ? "邮箱格式不对，检查后重试。" : "That email looks invalid — check and retry.", "error");
              return;
            }
            if (error instanceof WorkHubApiError && error.status === 404) {
              setStatus(zh ? "邀请功能未启用（需密码登录模式）。" : "Invites aren't enabled (password mode required).", "error");
              return;
            }
            setStatus(zh ? "邀请没生成，请稍后重试。" : "Couldn't create the invite — try again later.", "error");
          }
        })();
      },
      { signal }
    );

    // R20 P1-05：撤销未过期邀请——单击即软删（管理员操作，非用户可见破坏性动作，无需二段式），
    // 请求期间禁用本行撤销按钮防重复提交，成功后重拉清单。
    body.querySelectorAll<HTMLButtonElement>("[data-r18-settings-invite-revoke]").forEach((btn) => {
      const inviteId = btn.getAttribute("data-r18-settings-invite-revoke") ?? "";
      btn.addEventListener(
        "click",
        () => {
          void (async () => {
            btn.disabled = true;
            setStatus(zh ? "撤销中…" : "Revoking…", "saving");
            try {
              await client.request(`/api/auth/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
              if (signal.aborted) {
                return;
              }
              void hydrate();
            } catch (error) {
              if (signal.aborted) {
                return;
              }
              btn.disabled = false;
              if (error instanceof WorkHubApiError && error.status === 404) {
                // 已被别处撤销/接受——直接刷新清单，不当错误吓人。
                void hydrate();
                return;
              }
              setStatus(zh ? "撤销失败，请稍后重试。" : "Couldn't revoke — try again later.", "error");
            }
          })();
        },
        { signal }
      );
    });
  };

  const hydrate = async () => {
    try {
      const vm = await client.request<SettingsPendingInvitesVM>("/api/auth/invites?status=pending");
      if (signal.aborted) {
        return;
      }
      render(vm.invites);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      // 404 = 昵称模式下邀请功能未启用（诚实说明，不渲邀请表单）；其它 = 取数错，给重试。
      if (error instanceof WorkHubApiError && error.status === 404) {
        renderDisabled();
        return;
      }
      renderError();
    }
  };
  void hydrate();
}

// R14 批 SEARCH（web-search-page，02-search-design.md §7）：顶栏搜索页的客户端水合。SSR
// （route-components renderSearchRouteComponent）只渲搜索框外壳 + 诚实的空/短词提示，四个结果分组卡
// 先隐藏、无数据。这里在 q ≥ 2 字符时拉 GET /api/search（默认四 scope、limit=10）后按固定 scope 顺序
// 填充分组、揭示 has_more、揭示"此范围无匹配"。会话结果 web 端没有聊天页可跳（R13 定调"聊天归桌面"）——
// 不渲染成链接，只保留 SSR 已给的说明行；命中行只显示项目/会话上下文 + 片段 + 发送者/时间，诚实降级。
// 拉取失败保留错误提示 + 重试，不吞错、不假装成功。
function formatSearchTimestamp(iso: string | undefined) {
  if (!iso) {
    return "";
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u.exec(iso);
  return match ? `${match[1]} ${match[2]}` : iso;
}

function searchMatchedInLabel(matchedIn: string, locale: WorkHubLocale) {
  const zh = locale === "zh-CN";
  const labels: Record<string, [string, string]> = {
    name: ["文件名", "filename"],
    body: ["正文", "content"],
    title: ["标题", "title"],
    description: ["描述", "description"],
    text: ["消息内容", "message"],
    minutes: ["会议纪要", "minutes"]
  };
  const label = labels[matchedIn];
  return label ? (zh ? label[0] : label[1]) : matchedIn;
}

function bindSearchRoutePanel(
  container: HTMLElement,
  result: WebRouteReadyResult,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal
) {
  if (result.match.key !== "search") {
    return;
  }
  const panel = container.querySelector<HTMLElement>("[data-r14-search-route]");
  if (!panel) {
    return;
  }
  const q = (result.surface.key === "search" ? result.surface.q : undefined)?.trim() ?? "";
  if (q.length < 2) {
    // SSR 已经渲了诚实的空/短词提示（renderSearchRouteComponent 的 search.promptEmpty/promptShort），
    // 没有可拉的数据——不发请求。
    return;
  }
  const status = panel.querySelector<HTMLElement>("[data-r14-search-status]");
  const resultsRoot = panel.querySelector<HTMLElement>("[data-r14-search-results]");
  const retryButton = panel.querySelector<HTMLButtonElement>("[data-r14-search-retry]");
  const zh = locale === "zh-CN";
  const groupSections = new Map<string, HTMLElement>();
  panel.querySelectorAll<HTMLElement>("[data-r14-search-group]").forEach((section) => {
    const scope = section.getAttribute("data-r14-search-group");
    if (scope) {
      groupSections.set(scope, section);
    }
  });

  const setStatus = (text: string, hidden: boolean) => {
    if (!status) {
      return;
    }
    status.textContent = text;
    status.hidden = hidden;
  };

  const appendEmptyGroupNote = (list: HTMLElement) => {
    const empty = document.createElement("p");
    empty.className = "wh-subtle";
    empty.textContent = zh ? "此范围没有匹配。" : "No matches in this scope.";
    list.append(empty);
  };

  const appendConversationRow = (list: HTMLElement, item: SearchResultsVm["groups"][number]["results"][number]) => {
    if (!("conversation_title" in item)) {
      return;
    }
    // R15 批 web-mirror：会话命中改真链接到只读会话镜像 /conversations/:id?seq=N（deep_link 现成，
    // 带 conversation_id + seq 定位到命中那条）。此前是不可点的死文字——R13 定「聊天归桌面」时 web 还
    // 没有会话页，现在有只读镜像了。
    const link = document.createElement("a");
    link.className = "wh-r4-route-row wh-r14-search-result-link";
    link.href = `/conversations/${encodeURIComponent(item.deep_link.conversation_id)}?seq=${encodeURIComponent(String(item.deep_link.seq))}`;
    link.setAttribute("data-r14-search-result-scope", "conversations");
    const main = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${item.project_name} · ${item.conversation_title}`;
    const snippet = document.createElement("p");
    snippet.textContent = item.snippet;
    const meta = document.createElement("p");
    meta.className = "wh-subtle";
    const senderLabel = item.sender_label ?? (zh ? "AI 助手" : "AI assistant");
    meta.textContent = `${senderLabel} · ${formatSearchTimestamp(item.created_at)}`;
    main.append(title, snippet, meta);
    link.append(main);
    list.append(link);
  };

  const appendLinkRow = (list: HTMLElement, href: string, titleText: string, snippetText: string, metaText: string) => {
    const link = document.createElement("a");
    link.className = "wh-r4-route-row wh-r14-search-result-link";
    link.href = href;
    const main = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = titleText;
    const snippet = document.createElement("p");
    snippet.textContent = snippetText;
    const meta = document.createElement("p");
    meta.className = "wh-subtle";
    meta.textContent = metaText;
    main.append(title, snippet, meta);
    link.append(main);
    list.append(link);
  };

  const renderGroups = (data: SearchResultsVm) => {
    let anyResults = false;
    for (const group of data.groups) {
      const section = groupSections.get(group.scope);
      if (!section) {
        continue;
      }
      section.hidden = false;
      const list = section.querySelector<HTMLElement>("[data-r14-search-group-list]");
      const more = section.querySelector<HTMLElement>("[data-r14-search-group-more]");
      if (list) {
        list.replaceChildren();
      }
      if (group.results.length === 0) {
        if (list) {
          appendEmptyGroupNote(list);
        }
      } else if (list) {
        anyResults = true;
        // findings：narrowing group.scope 内层再取 group.results 才生效——先在 for...of 外层拿到
        // item 会把它的类型定死成四种结果形状的并集,分支里访问 item_id/work_item_id 等专属字段会报错。
        if (group.scope === "conversations") {
          for (const item of group.results) {
            appendConversationRow(list, item);
          }
        } else if (group.scope === "drive") {
          for (const item of group.results) {
            const href = `/drive?project_id=${encodeURIComponent(item.project_id)}&item_id=${encodeURIComponent(item.item_id)}`;
            appendLinkRow(list, href, item.name, item.snippet, `${item.project_name} · ${searchMatchedInLabel(item.matched_in, locale)} · ${formatSearchTimestamp(item.updated_at)}`);
          }
        } else if (group.scope === "work_items") {
          for (const item of group.results) {
            const href = `/workitems/${encodeURIComponent(item.work_item_id)}`;
            appendLinkRow(list, href, item.title ? `${item.code} · ${item.title}` : item.code, item.snippet, `${item.project_name} · ${formatSearchTimestamp(item.updated_at)}`);
          }
        } else if (group.scope === "meetings") {
          for (const item of group.results) {
            const href = `/meetings?project_id=${encodeURIComponent(item.project_id)}&m=${encodeURIComponent(item.meeting_id)}`;
            appendLinkRow(list, href, item.title, item.snippet, `${item.project_name} · ${formatSearchTimestamp(item.created_at)}`);
          }
        }
      }
      if (more) {
        more.hidden = !group.has_more;
        if (group.has_more) {
          more.textContent = zh ? "还有更多结果——换更精确的关键词缩小范围。" : "More results available — try a more specific keyword.";
        }
      }
    }
    if (anyResults) {
      setStatus("", true);
    } else {
      setStatus(zh ? `没有找到包含"${q}"的结果。换个关键词试试。` : `No results for "${q}". Try a different keyword.`, false);
    }
  };

  const run = async () => {
    if (resultsRoot) {
      resultsRoot.hidden = false;
    }
    setStatus(zh ? "正在搜索…" : "Searching…", false);
    if (retryButton) {
      retryButton.hidden = true;
    }
    try {
      const data = await client.search({ q, limit: 10 });
      if (signal.aborted) {
        return;
      }
      renderGroups(data);
    } catch {
      if (signal.aborted) {
        return;
      }
      setStatus(zh ? "搜索失败，请重试。" : "Search failed. Please retry.", false);
      if (retryButton) {
        retryButton.hidden = false;
      }
    }
  };

  retryButton?.addEventListener("click", () => void run(), { signal });
  void run();
}

// R13 批 P3（功能审查 B4）：设置页「AI 助手」区块的客户端水合 + 写接线。SSR 渲染的两个 <select>
// （route-components renderSettingsAiAssistantCard）是禁用的——设置页 VM 不带用户 AI 档案（扩 VM 要动
// contracts/routes，超出批次围栏），当前档位由这里 GET /api/me/ai-profile 回填后才解禁；GET 失败保持
// 锁定 + 显式错误 + 重试（照上面通知静音面板 R10-P1-7 的同一竞态收口：不给用户一个「假的当前值」去保存）。
// change 即 PATCH（每次只发被改的那一个字段）；失败回滚 select 到上次已保存值 + 状态行报错。
function bindSettingsAiProfilePanel(
  container: HTMLElement,
  result: WebRouteReadyResult,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal
) {
  if (result.match.key !== "settings") {
    return;
  }
  const panel = container.querySelector<HTMLElement>("[data-r13-settings-ai-panel]");
  if (!panel) {
    return;
  }
  const modeSelect = panel.querySelector<HTMLSelectElement>("[data-r13-settings-ai-mode-select]");
  const dispatchSelect = panel.querySelector<HTMLSelectElement>("[data-r13-settings-ai-dispatch-select]");
  if (!modeSelect || !dispatchSelect) {
    return;
  }
  const status = panel.querySelector<HTMLElement>("[data-r13-settings-ai-status]");
  const retryButton = panel.querySelector<HTMLButtonElement>("[data-r13-settings-ai-retry]");
  const zh = locale === "zh-CN";
  // GET/PATCH 都走 client.request 的类型安全转发口（drive_preview 同款先例），只声明用得到的字段。
  type AiProfileSlice = { default_mode: number; dispatch_policy: string };
  const profilePath = "/api/me/ai-profile";
  let lastSaved: AiProfileSlice | undefined;

  const setStatus = (text: string, tone: "saving" | "saved" | "error") => {
    if (!status) {
      return;
    }
    status.hidden = false;
    status.textContent = text;
    status.setAttribute("data-r13-settings-ai-status", tone);
  };
  const setEnabled = (enabled: boolean) => {
    modeSelect.disabled = !enabled;
    dispatchSelect.disabled = !enabled;
  };

  const hydrate = async () => {
    setEnabled(false);
    if (retryButton) {
      retryButton.hidden = true;
    }
    setStatus(zh ? "正在读取当前设置…" : "Loading current settings…", "saving");
    try {
      const profile = await client.request<AiProfileSlice>(profilePath);
      if (signal.aborted) {
        return;
      }
      lastSaved = { default_mode: profile.default_mode, dispatch_policy: profile.dispatch_policy };
      modeSelect.value = String(profile.default_mode);
      dispatchSelect.value = profile.dispatch_policy;
      setEnabled(true);
      if (status) {
        status.hidden = true;
      }
    } catch {
      if (signal.aborted) {
        return;
      }
      setStatus(
        zh
          ? "没能读取当前 AI 设置。为避免误存，下拉框已暂时锁定。"
          : "Couldn't load your current AI settings — the selectors stay locked so nothing is saved by mistake.",
        "error"
      );
      if (retryButton) {
        retryButton.hidden = false;
      }
    }
  };
  void hydrate();
  retryButton?.addEventListener("click", () => void hydrate(), { signal });

  // 保存按到达顺序串行（同静音面板的 saveChain 取舍——乱序完成会用旧值盖新值）。
  let saveChain: Promise<void> = Promise.resolve();
  const doSave = async (patch: Record<string, unknown>, rollback: () => void) => {
    setStatus(zh ? "保存中…" : "Saving…", "saving");
    try {
      const profile = await client.request<AiProfileSlice>(profilePath, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      if (signal.aborted) {
        return;
      }
      lastSaved = { default_mode: profile.default_mode, dispatch_policy: profile.dispatch_policy };
      modeSelect.value = String(profile.default_mode);
      dispatchSelect.value = profile.dispatch_policy;
      setStatus(zh ? "已保存" : "Saved", "saved");
    } catch {
      if (signal.aborted) {
        return;
      }
      rollback();
      setStatus(zh ? "保存失败，请重试" : "Save failed, please retry", "error");
    }
  };
  const enqueueSave = (patch: Record<string, unknown>, rollback: () => void) => {
    saveChain = saveChain.then(() => doSave(patch, rollback));
    return saveChain;
  };

  modeSelect.addEventListener(
    "change",
    () => {
      const nextMode = Number(modeSelect.value);
      if (!Number.isInteger(nextMode) || nextMode < 1 || nextMode > 5 || nextMode === lastSaved?.default_mode) {
        return;
      }
      void enqueueSave({ default_mode: nextMode }, () => {
        if (lastSaved) {
          modeSelect.value = String(lastSaved.default_mode);
        }
      });
    },
    { signal }
  );
  dispatchSelect.addEventListener(
    "change",
    () => {
      const nextPolicy = dispatchSelect.value;
      if (!["auto", "ask", "manual"].includes(nextPolicy) || nextPolicy === lastSaved?.dispatch_policy) {
        return;
      }
      void enqueueSave({ dispatch_policy: nextPolicy }, () => {
        if (lastSaved) {
          dispatchSelect.value = lastSaved.dispatch_policy;
        }
      });
    },
    { signal }
  );
}

// R13 批 A2（派人推荐 v2）：设置页「我的资料」区块的客户端水合 + 写接线。SSR 渲染的三个输入
// （route-components renderSettingsMyProfileCard）是禁用的——当前值由这里 GET /api/me/profile
// 回填后才解禁；GET 失败保持锁定 + 显式错误 + 重试（同上面 AI 助手面板 R10-P1-7 的竞态收口纪律）。
// change 事件（失焦/回车才触发，不是 input）即 PATCH（每次只发被改的那一个字段）；失败回滚到上次
// 已保存值 + 状态行报错。
function bindSettingsMyProfilePanel(
  container: HTMLElement,
  result: WebRouteReadyResult,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal
) {
  if (result.match.key !== "settings") {
    return;
  }
  const panel = container.querySelector<HTMLElement>("[data-r13-settings-profile-panel]");
  if (!panel) {
    return;
  }
  const titleInput = panel.querySelector<HTMLInputElement>("[data-r13-settings-profile-title-input]");
  const bioInput = panel.querySelector<HTMLTextAreaElement>("[data-r13-settings-profile-bio-input]");
  const skillsInput = panel.querySelector<HTMLInputElement>("[data-r13-settings-profile-skills-input]");
  if (!titleInput || !bioInput || !skillsInput) {
    return;
  }
  const status = panel.querySelector<HTMLElement>("[data-r13-settings-profile-status]");
  const retryButton = panel.querySelector<HTMLButtonElement>("[data-r13-settings-profile-retry]");
  const zh = locale === "zh-CN";
  type ProfileSlice = { title: string | null; bio_md: string | null; skill_tags: string[] };
  const profilePath = "/api/me/profile";
  let lastSaved: ProfileSlice | undefined;

  const setStatus = (text: string, tone: "saving" | "saved" | "error") => {
    if (!status) {
      return;
    }
    status.hidden = false;
    status.textContent = text;
    status.setAttribute("data-r13-settings-profile-status", tone);
  };
  const setEnabled = (enabled: boolean) => {
    titleInput.disabled = !enabled;
    bioInput.disabled = !enabled;
    skillsInput.disabled = !enabled;
  };
  const applySlice = (slice: ProfileSlice) => {
    titleInput.value = slice.title ?? "";
    bioInput.value = slice.bio_md ?? "";
    skillsInput.value = slice.skill_tags.join(", ");
  };

  const hydrate = async () => {
    setEnabled(false);
    if (retryButton) {
      retryButton.hidden = true;
    }
    setStatus(zh ? "正在读取当前资料…" : "Loading current profile…", "saving");
    try {
      const profile = await client.request<ProfileSlice>(profilePath);
      if (signal.aborted) {
        return;
      }
      lastSaved = { title: profile.title, bio_md: profile.bio_md, skill_tags: [...profile.skill_tags] };
      applySlice(lastSaved);
      setEnabled(true);
      if (status) {
        status.hidden = true;
      }
    } catch {
      if (signal.aborted) {
        return;
      }
      setStatus(
        zh
          ? "没能读取当前资料。为避免误存，输入框已暂时锁定。"
          : "Couldn't load your profile — the inputs stay locked so nothing is saved by mistake.",
        "error"
      );
      if (retryButton) {
        retryButton.hidden = false;
      }
    }
  };
  void hydrate();
  retryButton?.addEventListener("click", () => void hydrate(), { signal });

  let saveChain: Promise<void> = Promise.resolve();
  const doSave = async (patch: Record<string, unknown>, rollback: () => void) => {
    setStatus(zh ? "保存中…" : "Saving…", "saving");
    try {
      const profile = await client.request<ProfileSlice>(profilePath, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      if (signal.aborted) {
        return;
      }
      lastSaved = { title: profile.title, bio_md: profile.bio_md, skill_tags: [...profile.skill_tags] };
      applySlice(lastSaved);
      setStatus(zh ? "已保存" : "Saved", "saved");
    } catch {
      if (signal.aborted) {
        return;
      }
      rollback();
      setStatus(zh ? "保存失败，请重试" : "Save failed, please retry", "error");
    }
  };
  const enqueueSave = (patch: Record<string, unknown>, rollback: () => void) => {
    saveChain = saveChain.then(() => doSave(patch, rollback));
    return saveChain;
  };

  // 用 change（失焦/回车才触发）而不是 input——避免用户每敲一个字符就打一次 PATCH。
  titleInput.addEventListener(
    "change",
    () => {
      const next = titleInput.value.trim();
      const nextValue = next.length > 0 ? next : null;
      if (nextValue === (lastSaved?.title ?? null)) {
        return;
      }
      void enqueueSave({ title: nextValue }, () => {
        if (lastSaved) {
          titleInput.value = lastSaved.title ?? "";
        }
      });
    },
    { signal }
  );
  bioInput.addEventListener(
    "change",
    () => {
      const next = bioInput.value.trim();
      const nextValue = next.length > 0 ? next : null;
      if (nextValue === (lastSaved?.bio_md ?? null)) {
        return;
      }
      void enqueueSave({ bio_md: nextValue }, () => {
        if (lastSaved) {
          bioInput.value = lastSaved.bio_md ?? "";
        }
      });
    },
    { signal }
  );
  skillsInput.addEventListener(
    "change",
    () => {
      const next = skillsInput.value.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
      const previous = lastSaved?.skill_tags ?? [];
      if (JSON.stringify(next) === JSON.stringify(previous)) {
        return;
      }
      void enqueueSave({ skill_tags: next }, () => {
        if (lastSaved) {
          skillsInput.value = lastSaved.skill_tags.join(", ");
        }
      });
    },
    { signal }
  );
}

// R14 批 AVATAR：设置页「我的资料」卡的头像位。GET /api/me/profile 已经在 bindSettingsMyProfilePanel
// 里拉过一次（user_id/nickname）——这里独立再拉一次同一个只读端点（各自水合、互不依赖对方的水合
// 时序，与 AI 面板/资料面板两个独立绑定函数同一套分工，避免一处失败连累另一处）。无头像回退：<img>
// 一律尝试加载 /api/users/{id}/avatar，onerror 隐藏、露出下层首字母色块 tile（不改 Cuu 猫头像）。
function bindSettingsAvatarPanel(
  container: HTMLElement,
  result: WebRouteReadyResult,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal
) {
  if (result.match.key !== "settings") {
    return;
  }
  const panel = container.querySelector<HTMLElement>("[data-r13-settings-profile-panel]");
  if (!panel) {
    return;
  }
  const fallback = panel.querySelector<HTMLElement>("[data-r14-avatar-fallback]");
  const img = panel.querySelector<HTMLImageElement>("[data-r14-avatar-img]");
  const fileInput = panel.querySelector<HTMLInputElement>("[data-r14-avatar-file-input]");
  const removeBtn = panel.querySelector<HTMLButtonElement>("[data-r14-avatar-remove-btn]");
  const status = panel.querySelector<HTMLElement>("[data-r14-avatar-status]");
  if (!fallback || !img || !fileInput || !removeBtn) {
    return;
  }
  const zh = locale === "zh-CN";
  let userId: string | undefined;

  const setStatus = (text: string, tone: "saving" | "saved" | "error") => {
    if (!status) {
      return;
    }
    status.hidden = false;
    status.textContent = text;
    status.setAttribute("data-r14-avatar-status", tone);
  };

  const showAvatarUrl = (url: string) => {
    img.onerror = () => {
      img.hidden = true;
    };
    img.onload = () => {
      img.hidden = false;
      removeBtn.hidden = false;
      removeBtn.disabled = false;
    };
    img.src = url;
  };

  const hydrate = async () => {
    try {
      const profile = await client.request<{ user_id: string; nickname: string }>("/api/me/profile");
      if (signal.aborted) {
        return;
      }
      userId = profile.user_id;
      const initial = profile.nickname.trim();
      fallback.textContent = initial ? initial[0]!.toUpperCase() : "?";
      fileInput.disabled = false;
      showAvatarUrl(`/api/users/${encodeURIComponent(userId)}/avatar`);
    } catch {
      // best-effort：拉不到 user_id 就没法上传/删除头像，保持文件输入禁用、头像位安静显示回退 tile。
    }
  };
  void hydrate();

  fileInput.addEventListener(
    "change",
    () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file || !userId) {
        return;
      }
      const activeUserId = userId;
      void openAvatarCropModal(file, zh, async (blob) => {
        setStatus(zh ? "正在上传…" : "Uploading…", "saving");
        try {
          await client.request(`/api/me/avatar`, {
            method: "PUT",
            headers: { "Content-Type": blob.type || "application/octet-stream" },
            body: blob
          });
          if (signal.aborted) {
            return;
          }
          setStatus(zh ? "头像已更新" : "Avatar updated", "saved");
          showAvatarUrl(`/api/users/${encodeURIComponent(activeUserId)}/avatar?v=${Date.now()}`);
        } catch {
          if (signal.aborted) {
            return;
          }
          setStatus(zh ? "上传失败，请重试" : "Upload failed — please try again", "error");
        }
      });
    },
    { signal }
  );

  removeBtn.addEventListener(
    "click",
    () => {
      if (!userId) {
        return;
      }
      setStatus(zh ? "正在移除…" : "Removing…", "saving");
      void client
        .request(`/api/me/avatar`, { method: "DELETE" })
        .then(() => {
          if (signal.aborted) {
            return;
          }
          img.hidden = true;
          removeBtn.hidden = true;
          removeBtn.disabled = true;
          setStatus(zh ? "已移除头像" : "Avatar removed", "saved");
        })
        .catch(() => {
          if (signal.aborted) {
            return;
          }
          setStatus(zh ? "移除失败，请重试" : "Failed to remove — please try again", "error");
        });
    },
    { signal }
  );
}

// R14 批 MEM（记忆可见可治理）：/settings/memory 两 tab 的客户端接线——「关于我」整段替换 textarea
// 编辑 + 两段式确认删除；「团队技能」K2 段落级 op 表单编辑（管理员）+ 两段式确认停用。SSR 已经渲了
// 真实列表数据（同 skills 页既有口径，不走 disabled-skeleton 水合——数据本就在页面 VM 里，没有额外
// GET 要等），这里只接交互：编辑态切换 + PATCH/DELETE/POST 提交；成功后整路由重渲取最新列表（同其余
// 动作既有口径，如 approvals/proposal 的写动作），失败只在本地状态行报错，不清空用户已输入的内容。
// 两段式确认沿用 apps/web 既有的 r9ConfirmArmed 先例（第一次点按钮变警示态 + 提示行，5 秒自动回退，
// 限时窗口内再点一次才真正发请求）——web 端这套 UI 语言里没有原生 confirm()。
function bindMemoryPanel(
  container: HTMLElement,
  result: WebRouteReadyResult,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal
) {
  if (result.match.key !== "memory") {
    return;
  }
  const zh = locale === "zh-CN";
  bindMemoryProfileItems(container, client, locale, signal, zh);
  bindMemorySkillItems(container, client, locale, signal, zh);
}

// R14 批 FEEDBACK（web-feedback-ui）：提议详情页反馈块的备注面板——照 bindNotificationMutePanel 的
// 模板（面板级 querySelector + 自己的 addEventListener + 自己的状态文案），因为备注是自由文本输入，
// 不适合塞进 ActionSpec.request_json 的固定 JSON 模型，不走 bindGoldPathNavigation 的 api-action
// 分发器（04-feedback-design.md §7.2）。保存按钮本身没有 href，delegated click 监听器的
// `a[href],[data-action-href],[data-href]` 选择器天然不会拦到它，两条绑定路径互不打架。
function bindProposalFeedbackNotePanel(
  container: HTMLElement,
  result: WebRouteReadyResult,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal
) {
  if (result.match.key !== "proposal" || result.surface.key !== "proposal" || !result.surface.proposal.feedback) {
    return;
  }
  const proposalId = result.surface.proposal.proposal_id;
  const panel = container.querySelector<HTMLElement>("[data-r14-proposal-feedback]");
  const saveButton = panel?.querySelector<HTMLButtonElement>("[data-r14-proposal-feedback-note-save]");
  const textarea = panel?.querySelector<HTMLTextAreaElement>("[data-r14-proposal-feedback-note-input]");
  const status = panel?.querySelector<HTMLElement>("[data-r14-proposal-feedback-note-status]");
  const putProposalFeedback = client.putProposalFeedback;
  if (!panel || !saveButton || !textarea || !putProposalFeedback) {
    return;
  }
  const zh = locale === "zh-CN";
  const setStatus = (text: string, tone: "saving" | "saved" | "error") => {
    if (!status) {
      return;
    }
    status.hidden = false;
    status.textContent = text;
    status.setAttribute("data-r14-proposal-feedback-note-status", tone);
  };
  saveButton.addEventListener(
    "click",
    () => {
      const verdictAttr = panel.dataset.r14ProposalFeedbackVerdict;
      const verdict: AiFeedbackVerdict | undefined =
        verdictAttr === "useful" || verdictAttr === "not_useful" ? verdictAttr : undefined;
      if (!verdict) {
        // 主路径已经用原生 disabled 属性挡住这次点击（未判定时按钮不可点）——这里是防御性兜底，
        // 覆盖 disabled 状态被绕过（比如测试直接调用 click()）的情况。
        setStatus(zh ? "请先选择「有用」或「没用」" : "Pick Useful or Not useful first", "error");
        return;
      }
      const note = textarea.value.trim();
      saveButton.disabled = true;
      setStatus(zh ? "保存中…" : "Saving…", "saving");
      void putProposalFeedback(proposalId, note ? { verdict, note } : { verdict })
        .then(() => {
          if (signal.aborted) {
            return;
          }
          saveButton.disabled = false;
          setStatus(zh ? "已保存" : "Saved", "saved");
        })
        .catch((error: unknown) => {
          if (signal.aborted) {
            return;
          }
          saveButton.disabled = false;
          setStatus(
            error instanceof WorkHubApiError ? error.message : (zh ? "保存失败，请重试" : "Save failed, please retry"),
            "error"
          );
        });
    },
    { signal }
  );
}

function armMemoryConfirmButton(
  button: HTMLButtonElement,
  confirmLabel: string,
  onConfirm: () => void,
  onArm?: () => void,
  onRevert?: () => void
) {
  if (button.dataset.r9ConfirmArmed !== "true") {
    const originalLabel = button.dataset.r14MemOriginalLabel ?? button.textContent ?? "";
    button.dataset.r14MemOriginalLabel = originalLabel;
    button.dataset.r9ConfirmArmed = "true";
    button.textContent = confirmLabel;
    onArm?.();
    window.setTimeout(() => {
      if (button.isConnected && button.dataset.r9ConfirmArmed === "true") {
        delete button.dataset.r9ConfirmArmed;
        button.textContent = originalLabel;
        onRevert?.();
      }
    }, 5000);
    return;
  }
  delete button.dataset.r9ConfirmArmed;
  onConfirm();
}

function bindMemoryProfileItems(
  container: HTMLElement,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal,
  zh: boolean
) {
  const items = Array.from(container.querySelectorAll<HTMLElement>("[data-r14-mem-item]"));
  for (const item of items) {
    const id = item.getAttribute("data-r14-mem-item");
    const valueView = item.querySelector<HTMLElement>("[data-r14-mem-value-view]");
    const valueInput = item.querySelector<HTMLTextAreaElement>("[data-r14-mem-value-input]");
    const editBtn = item.querySelector<HTMLButtonElement>("[data-r14-mem-edit-btn]");
    const saveBtn = item.querySelector<HTMLButtonElement>("[data-r14-mem-save-btn]");
    const cancelBtn = item.querySelector<HTMLButtonElement>("[data-r14-mem-cancel-btn]");
    const deleteBtn = item.querySelector<HTMLButtonElement>("[data-r14-mem-delete-btn]");
    const deleteHint = item.querySelector<HTMLElement>("[data-r14-mem-delete-hint]");
    const status = item.querySelector<HTMLElement>("[data-r14-mem-status]");
    if (!id || !valueView || !valueInput || !editBtn || !saveBtn || !cancelBtn || !deleteBtn) {
      continue;
    }

    const setStatus = (text: string, tone: "saving" | "saved" | "error") => {
      if (!status) {
        return;
      }
      status.hidden = false;
      status.textContent = text;
      status.setAttribute("data-r14-mem-status", tone);
    };

    const enterEdit = () => {
      valueInput.value = valueView.textContent ?? "";
      valueView.hidden = true;
      valueInput.hidden = false;
      editBtn.hidden = true;
      saveBtn.hidden = false;
      cancelBtn.hidden = false;
      valueInput.focus();
    };
    const exitEdit = () => {
      valueView.hidden = false;
      valueInput.hidden = true;
      editBtn.hidden = false;
      saveBtn.hidden = true;
      cancelBtn.hidden = true;
    };

    editBtn.addEventListener("click", () => enterEdit(), { signal });
    cancelBtn.addEventListener("click", () => exitEdit(), { signal });

    saveBtn.addEventListener(
      "click",
      () => {
        const valueMd = valueInput.value.trim();
        if (!valueMd) {
          setStatus(zh ? "内容不能为空" : "Content can't be empty", "error");
          return;
        }
        const patchUserMemory = client.patchUserMemory;
        if (!patchUserMemory) {
          return;
        }
        const expectedUpdatedAt = item.getAttribute("data-r14-mem-updated-at") ?? "";
        setStatus(zh ? "保存中…" : "Saving…", "saving");
        saveBtn.disabled = true;
        void patchUserMemory(id, { value_md: valueMd, expected_updated_at: expectedUpdatedAt })
          .then(async () => {
            if (signal.aborted) {
              return;
            }
            await renderCurrentRoute(client, locale);
          })
          .catch((error: unknown) => {
            if (signal.aborted) {
              return;
            }
            saveBtn.disabled = false;
            if (error instanceof WorkHubApiError && error.status === 409) {
              setStatus(
                zh ? "这条记忆已被更新，请刷新后重试" : "This memory changed elsewhere — reload and try again",
                "error"
              );
              return;
            }
            setStatus(
              error instanceof WorkHubApiError ? error.message : (zh ? "保存失败，请重试" : "Save failed, please retry"),
              "error"
            );
          });
      },
      { signal }
    );

    deleteBtn.addEventListener(
      "click",
      () => {
        armMemoryConfirmButton(
          deleteBtn,
          zh ? "确定删除？再点一次" : "Really delete? Click again",
          () => {
            const deleteUserMemory = client.deleteUserMemory;
            if (!deleteUserMemory) {
              return;
            }
            deleteBtn.disabled = true;
            void deleteUserMemory(id)
              .then(async () => {
                if (signal.aborted) {
                  return;
                }
                await renderCurrentRoute(client, locale);
              })
              .catch((error: unknown) => {
                if (signal.aborted) {
                  return;
                }
                deleteBtn.disabled = false;
                setStatus(
                  error instanceof WorkHubApiError ? error.message : (zh ? "删除失败，请重试" : "Delete failed, please retry"),
                  "error"
                );
              });
          },
          () => {
            if (deleteHint) {
              deleteHint.hidden = false;
            }
          },
          () => {
            if (deleteHint) {
              deleteHint.hidden = true;
            }
          }
        );
      },
      { signal }
    );
  }
}

const memorySkillOpTypes = ["add_section", "modify_section", "remove_section"] as const;
type MemorySkillOpType = (typeof memorySkillOpTypes)[number];

function bindMemorySkillItems(
  container: HTMLElement,
  client: BrowserApiClient,
  locale: WorkHubLocale,
  signal: AbortSignal,
  zh: boolean
) {
  const items = Array.from(container.querySelectorAll<HTMLElement>("[data-r14-skill-item]"));
  for (const item of items) {
    const editBtn = item.querySelector<HTMLButtonElement>("[data-r14-skill-edit-btn]");
    const deactivateBtn = item.querySelector<HTMLButtonElement>("[data-r14-skill-deactivate-btn]");
    const editForm = item.querySelector<HTMLElement>("[data-r14-skill-edit-form]");
    const deactivateForm = item.querySelector<HTMLElement>("[data-r14-skill-deactivate-form]");
    const statusLine = item.querySelector<HTMLElement>("[data-r14-skill-status-line]");

    if (editBtn && editForm) {
      editBtn.addEventListener(
        "click",
        () => {
          editForm.hidden = !editForm.hidden;
          if (deactivateForm) {
            deactivateForm.hidden = true;
          }
        },
        { signal }
      );

      const opRows = Array.from(editForm.querySelectorAll<HTMLElement>("[data-r14-skill-op-row]"));
      const addOpBtn = editForm.querySelector<HTMLButtonElement>("[data-r14-skill-add-op-btn]");
      let revealedOps = opRows.filter((row) => !row.hidden).length || 1;
      addOpBtn?.addEventListener(
        "click",
        () => {
          if (revealedOps < opRows.length) {
            opRows[revealedOps]!.hidden = false;
            revealedOps += 1;
          }
          if (revealedOps >= opRows.length) {
            addOpBtn.hidden = true;
          }
        },
        { signal }
      );

      const cancelEditBtn = editForm.querySelector<HTMLButtonElement>("[data-r14-skill-edit-cancel-btn]");
      cancelEditBtn?.addEventListener(
        "click",
        () => {
          editForm.hidden = true;
        },
        { signal }
      );

      const submitBtn = editForm.querySelector<HTMLButtonElement>("[data-r14-skill-submit-btn]");
      const editStatus = editForm.querySelector<HTMLElement>("[data-r14-skill-edit-status]");
      const setEditStatus = (text: string, tone: "saving" | "saved" | "error") => {
        if (!editStatus) {
          return;
        }
        editStatus.hidden = false;
        editStatus.textContent = text;
        editStatus.setAttribute("data-r14-skill-edit-status", tone);
      };

      submitBtn?.addEventListener(
        "click",
        () => {
          const skillId = editForm.getAttribute("data-r14-skill-id") ?? "";
          const baseVersion = Number(editForm.getAttribute("data-r14-skill-base-version") ?? "");
          const ops: SkillEditOp[] = [];
          for (const row of opRows) {
            if (row.hidden) {
              continue;
            }
            const opValue = row.querySelector<HTMLSelectElement>("[data-r14-skill-op-type]")?.value ?? "";
            const section = row.querySelector<HTMLInputElement>("[data-r14-skill-op-section]")?.value.trim() ?? "";
            const content = row.querySelector<HTMLTextAreaElement>("[data-r14-skill-op-content]")?.value ?? "";
            if (!section || !memorySkillOpTypes.includes(opValue as MemorySkillOpType)) {
              continue;
            }
            const op = opValue as MemorySkillOpType;
            ops.push({ op, section, ...(op === "remove_section" ? {} : { content_md: content }) });
          }
          if (ops.length === 0 || !skillId || !Number.isInteger(baseVersion) || baseVersion <= 0) {
            setEditStatus(zh ? "至少填一处修改（段落标题必填）" : "Fill in at least one edit (section title required)", "error");
            return;
          }
          const patchTeamSkillManage = client.patchTeamSkillManage;
          if (!patchTeamSkillManage) {
            return;
          }
          const rationale = editForm.querySelector<HTMLTextAreaElement>("[data-r14-skill-rationale]")?.value.trim();
          setEditStatus(zh ? "保存中…" : "Saving…", "saving");
          submitBtn.disabled = true;
          void patchTeamSkillManage(skillId, {
            ops,
            base_version: baseVersion,
            ...(rationale ? { rationale_md: rationale } : {})
          })
            .then(async () => {
              if (signal.aborted) {
                return;
              }
              await renderCurrentRoute(client, locale);
            })
            .catch((error: unknown) => {
              if (signal.aborted) {
                return;
              }
              submitBtn.disabled = false;
              if (error instanceof WorkHubApiError && error.status === 409) {
                setEditStatus(
                  zh ? "这个技能已被更新，请刷新后重试" : "This skill changed elsewhere — reload and try again",
                  "error"
                );
                return;
              }
              setEditStatus(
                error instanceof WorkHubApiError ? error.message : (zh ? "保存失败，请重试" : "Save failed, please retry"),
                "error"
              );
            });
        },
        { signal }
      );
    }

    if (deactivateBtn) {
      deactivateBtn.addEventListener(
        "click",
        () => {
          armMemoryConfirmButton(
            deactivateBtn,
            zh ? "确定停用？再点一次" : "Really deactivate? Click again",
            () => {
              const skillId = deactivateBtn.getAttribute("data-r14-skill-id") ?? "";
              const reason = deactivateForm?.querySelector<HTMLInputElement>("[data-r14-skill-deactivate-reason]")?.value.trim();
              const deactivateTeamSkillManage = client.deactivateTeamSkillManage;
              if (!deactivateTeamSkillManage) {
                return;
              }
              deactivateBtn.disabled = true;
              void deactivateTeamSkillManage(skillId, reason ? { reason } : {})
                .then(async () => {
                  if (signal.aborted) {
                    return;
                  }
                  await renderCurrentRoute(client, locale);
                })
                .catch((error: unknown) => {
                  if (signal.aborted) {
                    return;
                  }
                  deactivateBtn.disabled = false;
                  if (statusLine) {
                    statusLine.hidden = false;
                    statusLine.textContent = error instanceof WorkHubApiError
                      ? error.message
                      : (zh ? "停用失败，请重试" : "Deactivate failed, please retry");
                  }
                });
            },
            () => {
              if (deactivateForm) {
                deactivateForm.hidden = false;
              }
              if (editForm) {
                editForm.hidden = true;
              }
            }
          );
        },
        { signal }
      );
    }
  }
}

async function renderCurrentRoute(client: BrowserApiClient, locale: WorkHubLocale, options: { silent?: boolean } = {}) {
  if (!root) {
    return;
  }
  activeLocale = locale;
  const renderId = ++activeRouteRenderId;
  const match = currentRouteMatch();
  clearReadyRouteBindings();
  unmountReactRouteIsland();
  clearLiveDirtyMetrics();
  // R4 high（性能感知）：SSE 刷新用 silent——保留旧内容直到新数据就绪。
  // R7（布局稳定）：主动导航也不再整屏换成「无壳居中卡」——外壳已在屏时保留旧内容，
  // 只注入顶部细进度条示意加载中；只有 boot（屏上还没有外壳）才渲全屏 loading 骨架。
  if (!options.silent) {
    const hasShellOnScreen = Boolean(root.querySelector(".wh-product-root, .wh-app-shell, [data-r4-web-route-status]"));
    if (!hasShellOnScreen) {
      root.innerHTML = renderWebRouteState(match, "loading", locale).html;
    } else {
      // R9 竞态修复：旧内容保留在屏时，路由状态标记必须立刻翻成 loading——
      // 否则等待「pathname 已变 && status=ready」的消费者（smoke/任何轮询）会在
      // 新内容渲染前拿着上一页的 ready 误判（CI 慢机器必现，本机偶发）。
      root.querySelector("[data-r4-web-route-status]")?.setAttribute("data-r4-web-route-status", "loading");
      if (!root.querySelector("[data-r7-nav-progress]")) {
        root.insertAdjacentHTML("afterbegin", `<div data-r7-nav-progress="true" style="position:fixed;top:0;left:0;right:0;height:2px;z-index:80;background:linear-gradient(90deg,#355cff,#7aa2ff);animation:whNavProgress 1.1s ease-in-out infinite alternate;transform-origin:left"></div><style>@keyframes whNavProgress{from{transform:scaleX(.15)}to{transform:scaleX(.9)}}</style>`);
      }
    }
  }
  const result = await loadWebRoute(client, match, locale, currentIdentity);
  if (renderId !== activeRouteRenderId) {
    return;
  }
  // R12（首帧/SSE 开销）：路由 HTML 自带整段 shell CSS（~36KB 源码）——若屏上首个 <style> 与新内容
  // 的 style 段完全一致（绝大多数导航/所有 SSE 刷新），保留该节点只替换其后内容，免去每次重解析样式。
  {
    const styleMatch = /^<style>([\s\S]*?)<\/style>/u.exec(result.html);
    const existingStyle = root.firstElementChild;
    if (styleMatch && existingStyle instanceof HTMLStyleElement && existingStyle.textContent === styleMatch[1]) {
      while (existingStyle.nextSibling) {
        existingStyle.nextSibling.remove();
      }
      existingStyle.insertAdjacentHTML("afterend", result.html.slice(styleMatch[0].length));
    } else {
      root.innerHTML = result.html;
    }
  }
  lastRenderedHref = `${window.location.pathname}${window.location.search}`;
  if (result.status === "ready") {
    mountReactRouteIsland(result, locale, "initial");
    bindReadyRoute(result, client, locale);
  }
  // R5（键盘可达 high）：innerHTML 整体替换后焦点掉回 body，键盘用户每次导航都得从页面最顶重新 Tab。
  // 主动把焦点移交给新页面的主标题（SSE silent 刷新不抢焦点——用户可能正停在输入框/按钮上）。
  if (!options.silent) {
    const heading = root.querySelector<HTMLElement>(".wh-product-main h1, .wh-app-content h1, h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: false });
    }
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
  // R11 回归修复：R10 想修的「探活切注册屏后在途 renderCurrentRoute 盖回失效内容」竞态，
  // 递增被错落在 renderFatalRouteError（anchor 撞名）——真正的 not_identified 分流全走这里。
  activeRouteRenderId += 1;
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
    // R6（表单）：留空提交此前只 focus 零反馈（表单带 novalidate，原生气泡也不弹）——渲染可见错误条。
    showOnboardingScreen(client, locale, {
      errorText: locale === "en-US" ? "Please enter a nickname first." : "请先填写昵称。",
      presetNickname: ""
    });
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

// R20 P1-05：邀请接受落地页（/invite，未登录可达）。boot() 在识别流之前特判此路径，渲染独立接受屏，
// 不进 SPA 路由注册表（避免动 routeMatchers/routeTree 计数）。成功后服务端已 mint 会话 cookie，
// location.assign("/") 触发一次全新 boot()，以新账号身份进入工作台。
function inviteTokenFromLocation(): string {
  try {
    return new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
  } catch {
    return "";
  }
}

function showInviteAcceptScreen(
  client: BrowserApiClient,
  locale: WorkHubLocale,
  input: { errorText?: string; presetToken?: string } = {}
) {
  if (!root) {
    return;
  }
  activeRouteRenderId += 1;
  clearReadyRouteBindings();
  liveRuntime?.closeAllLiveEventSources();
  liveRuntime = undefined;
  unmountReactRouteIsland();
  clearLiveDirtyMetrics();
  currentIdentity = undefined;
  activeLocale = locale;
  setDocumentLocale(locale);
  const token = input.presetToken ?? inviteTokenFromLocation();
  root.innerHTML = renderInviteAcceptScreen({
    locale,
    ...(token ? { token } : {}),
    ...(input.errorText ? { errorText: input.errorText } : {})
  }).html;
  bindInviteAcceptScreen(client, locale);
}

function bindInviteAcceptScreen(client: BrowserApiClient, locale: WorkHubLocale) {
  if (!root) {
    return;
  }
  const tokenInput = root.querySelector<HTMLInputElement>("[data-r20-invite-accept-token]");
  (tokenInput?.value.trim()
    ? root.querySelector<HTMLInputElement>("[data-r20-invite-accept-nickname]")
    : tokenInput)?.focus();
  for (const option of root.querySelectorAll<HTMLButtonElement>("[data-r20-invite-accept-locale-option]")) {
    option.addEventListener("click", (event) => {
      event.preventDefault();
      const nextLocale = normalizeWorkHubLocale(option.getAttribute("data-r20-invite-accept-locale-option"));
      if (nextLocale === locale) {
        return;
      }
      persistBrowserLocale(nextLocale);
      // 切语言重渲染时保留已填的令牌（昵称/密码敏感字段不跨渲染搬运）。
      showInviteAcceptScreen(client, nextLocale, {
        ...(tokenInput?.value.trim() ? { presetToken: tokenInput.value.trim() } : {})
      });
    });
  }
  root.querySelector<HTMLFormElement>("[data-r20-invite-accept-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitInviteAccept(client, locale);
  });
}

async function submitInviteAccept(client: BrowserApiClient, locale: WorkHubLocale) {
  if (!root) {
    return;
  }
  const tokenInput = root.querySelector<HTMLInputElement>("[data-r20-invite-accept-token]");
  const nicknameInput = root.querySelector<HTMLInputElement>("[data-r20-invite-accept-nickname]");
  const passwordInput = root.querySelector<HTMLInputElement>("[data-r20-invite-accept-password]");
  const token = tokenInput?.value.trim() ?? "";
  const nickname = nicknameInput?.value.trim() ?? "";
  const password = passwordInput?.value ?? "";
  const missing = !token
    ? (locale === "en-US" ? "Paste your invite token first." : "请先粘贴邀请令牌。")
    : !nickname
      ? (locale === "en-US" ? "Please enter a nickname." : "请填写昵称。")
      : password.length < 8
        ? (locale === "en-US" ? "Password must be at least 8 characters." : "密码至少 8 位。")
        : "";
  if (missing) {
    showInviteAcceptScreen(client, locale, { errorText: missing, presetToken: token });
    return;
  }
  const submit = root.querySelector<HTMLButtonElement>("[data-r20-invite-accept-submit]");
  if (submit) {
    submit.disabled = true;
  }
  try {
    await client.request("/api/auth/invites/accept", {
      method: "POST",
      body: JSON.stringify({ token, nickname, password })
    });
    persistBrowserLocale(locale);
    // 接受成功 = 服务端已建号 + mint 会话 cookie。整页跳回工作台，全新 boot() 以新身份进入。
    window.location.assign("/");
  } catch (error) {
    if (submit) {
      submit.disabled = false;
    }
    const errorText = inviteAcceptErrorText(error, locale);
    showInviteAcceptScreen(client, locale, { errorText, presetToken: token });
  }
}

function inviteAcceptErrorText(error: unknown, locale: WorkHubLocale): string {
  const zh = locale !== "en-US";
  if (error instanceof WorkHubApiError) {
    if (error.status === 404) {
      return zh ? "邀请无效或已过期，请向管理员索取新的邀请。" : "This invite is invalid or expired — ask your admin for a new one.";
    }
    if (error.status === 409) {
      return zh ? "该邮箱已注册，请直接登录。" : "That email is already registered — sign in instead.";
    }
    if (error.status === 400) {
      return error.message || (zh ? "密码太弱或信息有误，请检查后重试。" : "The password is too weak or a field is invalid — check and retry.");
    }
    if (error.message) {
      return error.message;
    }
  }
  return zh ? "接受邀请失败，请稍后重试。" : "Couldn't accept the invite — try again later.";
}

async function renderCurrentRouteOrOnboard(client: BrowserApiClient, locale: WorkHubLocale, options: { silent?: boolean } = {}) {
  try {
    await renderCurrentRoute(client, locale, options);
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
    // R10-P1-5：不设超时 = 一个挂死的请求把全局动作锁焊死到刷新。60s 上限盖住最慢的 LLM 动作
    // （intake 追问/建计划），超时抛错走各分支既有的 error notice + finally 复位锁。
    const client = createApiClient({ baseUrl: "", requestTimeoutMs: 60_000 });
    // R20 P1-05：/invite 是公开的邀请接受落地页——在识别流之前特判，未登录也可达。渲染独立接受屏后
    // 直接返回，不进 me() 识别 / SPA 路由渲染（成功接受后由 location.assign("/") 触发全新 boot 进工作台）。
    if (window.location.pathname === "/invite") {
      showInviteAcceptScreen(client, locale);
      return;
    }
    // 先挂导航监听，再渲染：否则首次渲染抛错时这两个监听永远注册不上，
    // 整个会话的前进/后退会静默失效（即便用户已从首屏错误中恢复）。
    window.addEventListener("popstate", () => {
      // R7（中断恢复 high）：后退/前进也过 dirty 武装守卫。被拦下时地址栏已经变了——
      // 用 pushState 把当前路由顶回去，保持地址栏与画面一致。
      if (!confirmLeaveDirtyRoute(activeLocale)) {
        // popstate 时 location 已经变成目标页——把地址栏顶回「画面上还停着的」上一次渲染路由。
        if (lastRenderedHref) {
          window.history.pushState(null, "", lastRenderedHref);
        }
        return;
      }
      void renderCurrentRouteOrOnboard(client, activeLocale).catch((error) => renderFatalRouteError(activeLocale, error));
    });
    // R9（身份边缘）：tab 切回可见时轻量 me() 探活——另一个 tab 登出/会话过期后，这个 tab
    // 此前要等 SSE 连错 ~24s 或下一次动作报错才知道掉线。探活失败即回注册屏。
    let identityProbeBusy = false;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || identityProbeBusy || !currentIdentity) {
        return;
      }
      identityProbeBusy = true;
      void client.me()
        .then((me) => {
          if (!me) {
            currentIdentity = undefined;
            showOnboardingScreen(client, activeLocale);
          }
        })
        .catch((error) => {
          if (error instanceof WorkHubApiError && (error.status === 401 || error.code === "not_identified")) {
            currentIdentity = undefined;
            showOnboardingScreen(client, activeLocale);
          }
        })
        .finally(() => {
          identityProbeBusy = false;
        });
    });
    window.addEventListener("beforeunload", (event) => {
      liveRuntime?.closeAllLiveEventSources();
      // R7（中断恢复）：刷新/关标签页时若有未提交输入，触发浏览器原生「离开此页？」确认。
      if (activeRouteHasDirtyEdits()) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
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
