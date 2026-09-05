import {
  cardFromAgentRunLive,
  cardFromSessionVm,
  createCuuController,
  cardFromEvidenceBubble,
  cardFromWorkItemDetail,
  cuuFormat,
  cuuMotionForState,
  cuuT,
  type CuuCard,
  type CuuCardAction,
  type CuuCardChip,
  type CuuCardSection,
  type CuuController,
  type CuuControllerDecision,
  type CuuLocaleOptions
} from "@workhub/cuu";
import { WorkHubApiError, type PageRequestOptions, type WorkHubApiClient } from "@workhub/api-client";
import {
  cuuLauncherSpecOptionSchema,
  eventTypes,
  type ApplyMergeProposalCandidateRequest,
  type AgentRunLiveVM,
  type CreateSessionRequest,
  type CreateWorkItemRequest,
  type CuuLauncherWorkItemSpec,
  type EvidenceRef,
  type GoldPathSurfaceVM,
  type MergeProposalRequest,
  type ReviewProposalRequest,
  type ResolveEscalationRequest,
  type StartAgentRunRequest,
  type WorkHubEvent
} from "@workhub/contracts";

import { createDesktopShellEventBridge, parseDesktopShellSseStatusPayload } from "./shell-events.js";
import { readDesktopClientToken } from "./desktop-client-token.js";
import type { DesktopShellSystemNotificationPlan } from "./shell-events.js";
import { buildDispatchAskBubbleCopy, buildWorkbenchDeepLinkHref } from "./workbench/cuu-bubble-deeplink.js";
import {
  classifyWorkbenchInterruptionCategory,
  createWorkbenchNotificationDeduper,
  extractWorkbenchDeepLinkTarget,
  type WorkbenchInterruptionCategory
} from "./workbench/interruption-policy.js";

export type DesktopShellEventEnvelope = {
  payload: unknown;
};

export type DesktopShellUnlisten = () => void;
export type DesktopShellEventName =
  | "push-event"
  | "sse-status"
  | "system-notification"
  | "navigate"
  | "tray-action"
  | "pet-settings"
  | "pet-locale-changed"
  | "attention-refresh"
  // R12 批7:工作台窗口(interrupt-broadcast.ts)广播"该弹气泡了"的结论用的事件名——桌宠/主窗自己的
  // SSE worker 目前只订阅 /api/push/stream/me，收不到 conversation:<id> 话题的事件（见批7汇报），
  // 所以这条广播只能由已经在看这些事件的工作台窗口发起，走同一套通用 Tauri 事件桥。
  | "workbench-interrupt"
  // G-desktop 止血批 3:登出动作（spotlight 设置视图/browser.ts）发起的跨窗口登出广播——登出只在
  // 发起动作的那个窗口清 token + reload，别的已经开着的窗口（工作台/桌宠）不会跟着 reload，之前完全
  // 没有信号告诉它们"手里的 client token 刚被清空了"，只会拿着废 token 静默连环 401。这个事件让
  // workbench（boot.ts/shell.ts）切到「已登出」全屏态并停止后续请求，桌宠（pet-surface.ts）换成一张
  // 诚实的「已登出」卡片——两边共用这同一条通用 Tauri 事件桥，不另起协议。
  | "workhub-logged-out"
  // R24 S2（换服务器）：webview 在「连接服务器」屏确认新地址后调壳层 set_server_url，壳层落盘 +
  // 换 SSE 订阅 base 之后广播这个事件（payload {url}）。其余窗口收到即自行 reload 走新地址重新 boot——
  // 与 workhub-logged-out 同一条通用 Tauri 事件桥，不另起协议（订阅入口 desktop-connect-screen.ts 的
  // bindDesktopServerChangedReload）。
  | "workhub-server-changed"
  // R24 S5（N-03 根治）：主窗登录/重新绑定成功（desktop-login.ts 凭据门三条路径 / desktop-rebind.ts
  // 昵称屏）此前只 reload 自己那一扇窗口——桌宠窗全程挂着「去主窗登录」卡装死，工作台窗（若也开着）
  // 同样收不到信号。登录成功后广播这个事件，桌宠（pet-surface.ts）与工作台（workbench/boot.ts）
  // 收到即自行 reload——与 workhub-logged-out 同一条通用 Tauri 事件桥，不另起协议（广播入口
  // browser.ts 的 broadcastDesktopLoggedIn / reloadAfterDesktopLogin）。
  // R25-Q：工作台自己的凭据门（密码/hybrid 模式）登录成功后也会广播这个事件（boot.ts 的
  // reloadAfterWorkbenchLogin），不再只有主窗能发起。payload 补了 `{ source: "main" | "workbench" }`——
  // 广播窗口自己已经在走 completeDesktopLoginSuccess 的直接 reload() 路径，主窗/工作台各自新增的
  // 订阅据 source 跳过"自己刚发起的这次广播"，避免双重 reload 空转（桌宠从不广播这个事件，它的既有
  // 订阅不需要看 source，收到就 reload）。
  | "workhub-logged-in"
  // R25-Q：壳层连接状态"单一真相"（client-tauri/src-tauri/src/sse.rs 的 ShellConnectionChangedPayload，
  // 解析见 shell-events.ts 的 parseDesktopShellConnectionChangedPayload）。三窗（工作台头部状态词/
  // 主窗聚焦盒顶部细条/桌宠离线卡）只从这一个事件取状态，不再各自从 "sse-status"（per-subscription
  // 原始信号）猜一遍——那正是 r24-S5-reverify.md 项 9 记录的"三窗各说各话"的根因。boot 时另有
  // get_connection_state 命令拉初值，不必等第一次真实迁移。
  | "workhub-connection-changed";

export type DesktopShellListen = (
  eventName: DesktopShellEventName,
  handler: (event: DesktopShellEventEnvelope) => void
) => DesktopShellUnlisten | Promise<DesktopShellUnlisten> | void | Promise<void>;

export type DesktopShellEmit = (eventName: DesktopShellEventName, payload?: unknown) => void | Promise<void>;
export type DesktopShellEmitTo = (target: string, eventName: DesktopShellEventName, payload?: unknown) => void | Promise<void>;

export type DesktopShellEmitter = {
  emit?: DesktopShellEmit | undefined;
  emitTo?: DesktopShellEmitTo | undefined;
};

export type DesktopCuuNotice = {
  card: CuuCard;
  message: string;
  html: string;
};

export type DesktopShellCuuRuntime = {
  subscribed: boolean;
  dispose: () => Promise<void>;
};

export type DesktopShellScriptedEvent = {
  eventName: DesktopShellEventName;
  payload: unknown;
  delayMs: number;
};

export type DesktopShellScriptedListener = {
  listen: DesktopShellListen;
  start: () => void;
  stop: () => void;
  dispatched: () => number;
};

export type DesktopCuuActionRequest =
  | {
      kind: "cuu-start-agent";
      title: string;
      intentText: string;
      selectedOptionIds?: string[];
      cuuLauncherSpec?: CuuLauncherWorkItemSpec;
      projectId?: string;
      runTitle?: string;
      mode?: StartAgentRunRequest["mode"];
    }
  // C1（桌宠死按钮修复）：工作项卡在 spec_ready 且无提议时产出的 start_agent 动作
  // （href /api/workitems/:id/agent-runs），与 cuu-start-agent 的会话式启动不是同一回事——
  // 这里工作项已经存在且已 spec_ready，直接开工，语义对齐 web 的 start_agent_run 分支
  // （apps/web/src/browser.ts 的 startAgentRunActionFromHref）与桌面看板 dispatchWorkItem。
  | {
      kind: "start-agent-run";
      workItemId: string;
    }
  | {
      kind: "approval-response";
      approvalId: string;
      decision: "allow" | "deny";
      requiresReason: boolean;
    }
  | {
      kind: "proposal-review";
      proposalId: string;
      decision: ReviewProposalRequest["decision"];
      requiresReason: boolean;
    }
  | {
      kind: "resolve-escalation";
      escalationId: string;
      payload: ResolveEscalationRequest;
    }
  | {
      kind: "session-next-question";
      sessionId: string;
      selectedOptionIds?: string[];
      freeText?: string;
    }
  | {
      kind: "knowledge-search";
      query?: string;
      run?: string;
    }
  | {
      kind: "use-evidence-for-task";
      workItemId: string;
      evidenceRefs: EvidenceRef[];
      evidenceBubbleId?: string;
    }
  | {
      kind: "proposal-merge";
      proposalId: string;
      payload?: MergeProposalRequest;
    }
  | {
      kind: "proposal-merge-candidate-apply";
      mergeProposalId: string;
      payload?: ApplyMergeProposalCandidateRequest;
    }
  // B-R9.6 UX 审计（桌宠死卡）：sync_conflict/budget/plan_review 卡端上来了却没人接——
  // 点击不发任何请求。补三类动作请求。
  | {
      kind: "memory-conflict-resolve";
      conflictId: string;
      resolution: "keep_current" | "accept_incoming" | "merge_both" | "edit_memory" | "discard_both";
      expectedUpdatedAt: string;
      valueMd?: string;
    }
  | {
      kind: "budget-decision";
      escalationId: string;
      budgetActionId: string;
    }
  | {
      kind: "skip-plan";
      proposalId: string;
    }
  // WIRE-07：进行中 run 卡上的「取消执行」（POST /api/agent-runs/:id/abort）——此前卡片已产
  // abort_agent_run 动作但分发无分支，点了石沉大海。
  | {
      kind: "abort-agent-run";
      runId: string;
    };

export const desktopCuuProjectContextStorageKey = "workhub_cuu_project_context";
export const desktopCuuProjectContextMaxAgeMs = 30 * 60 * 1000;

export type DesktopCuuProjectContext = {
  project_id: string;
  route?: string;
  updated_at_ms: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function validProjectId(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized && uuidPattern.test(normalized) ? normalized : undefined;
}

export function desktopCuuProjectContextFromRoute(route: string, now = Date.now()): DesktopCuuProjectContext | undefined {
  const url = new URL(route || "/", "https://workhub.local");
  const projectId = validProjectId(url.searchParams.get("project_id"))
    ?? validProjectId(/^\/projects\/([^/?#]+)/u.exec(url.pathname)?.[1]);
  return projectId
    ? {
        project_id: projectId,
        route,
        updated_at_ms: now
      }
    : undefined;
}

export function saveDesktopCuuProjectContextFromRoute(
  route: string,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
  now = Date.now()
) {
  const context = desktopCuuProjectContextFromRoute(route, now);
  if (!context || !storage) {
    return context;
  }
  try {
    storage.setItem(desktopCuuProjectContextStorageKey, JSON.stringify(context));
  } catch {
    // Best effort only; missing storage should never block navigation.
  }
  return context;
}

export function loadDesktopCuuProjectContext(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
  now = Date.now()
): DesktopCuuProjectContext | undefined {
  if (!storage) {
    return undefined;
  }
  try {
    const raw = storage.getItem(desktopCuuProjectContextStorageKey);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<DesktopCuuProjectContext>;
    const projectId = validProjectId(parsed.project_id);
    const updatedAt = typeof parsed.updated_at_ms === "number" ? parsed.updated_at_ms : 0;
    if (!projectId || now - updatedAt > desktopCuuProjectContextMaxAgeMs) {
      return undefined;
    }
    return {
      project_id: projectId,
      ...(typeof parsed.route === "string" ? { route: parsed.route } : {}),
      updated_at_ms: updatedAt
    };
  } catch {
    return undefined;
  }
}

export type DesktopCuuActionResult = {
  message: string;
  card?: CuuCard;
  agentRun?: AgentRunLiveVM;
};

export type DesktopCuuStartAgentAction = Extract<DesktopCuuActionRequest, { kind: "cuu-start-agent" }>;

export type DesktopCuuAgentLaunchClient = {
  createSession?: (payload?: CreateSessionRequest, options?: PageRequestOptions) => Promise<Awaited<ReturnType<WorkHubApiClient["createSession"]>>>;
  createWorkItem?: (payload: CreateWorkItemRequest, options?: PageRequestOptions) => Promise<Awaited<ReturnType<WorkHubApiClient["createWorkItem"]>>>;
  startAgentRun?: (
    workItemId: string,
    payload?: StartAgentRunRequest,
    options?: PageRequestOptions
  ) => Promise<Awaited<ReturnType<WorkHubApiClient["startAgentRun"]>>>;
};

export type DesktopCuuAgentLaunchResult = {
  session: Awaited<ReturnType<WorkHubApiClient["createSession"]>>;
  card: CuuCard;
  message: string;
} & (
  | {
      outcome: "clarification";
    }
  | {
      outcome: "started";
      workItem: Awaited<ReturnType<WorkHubApiClient["createWorkItem"]>>;
      run: AgentRunLiveVM;
    }
);

export type DesktopCuuEventSourceEvent = {
  data?: string;
};

export type DesktopCuuEventSourceLike = {
  addEventListener: (eventName: string, handler: (event: DesktopCuuEventSourceEvent) => void) => void;
  close: () => void;
};

export type DesktopCuuEventSourceConstructor = new (
  url: string,
  init?: { withCredentials?: boolean }
) => DesktopCuuEventSourceLike;

export type DesktopCuuRunStreamStatus =
  | { state: "subscribed"; runId: string; streamUrl: string }
  | { state: "event"; runId: string; eventType: string }
  | { state: "refreshed"; runId: string; status: AgentRunLiveVM["status"] }
  | { state: "unavailable"; runId: string; reason: string }
  | { state: "error"; runId: string; message: string }
  | { state: "closed"; runId: string; reason: string };

export type DesktopCuuRunStreamSubscription = {
  runId: string;
  streamUrl?: string;
  close: () => void;
};

type DesktopShellGlobal = {
  __TAURI__?: {
    event?: {
      listen?: DesktopShellListen;
      emit?: DesktopShellEmit;
      emitTo?: DesktopShellEmitTo;
    };
  };
  __YQGL_MOCK_LISTEN__?: DesktopShellListen;
  __YQGL_MOCK_EMIT__?: DesktopShellEmit;
  __YQGL_MOCK_EMIT_TO__?: DesktopShellEmitTo;
};

export type TimerId = ReturnType<typeof globalThis.setTimeout>;
type GoldPathEvent = GoldPathSurfaceVM["events"][number];
type DesktopCuuActionClient = Pick<
  WorkHubApiClient,
  "respondApproval" | "nextQuestion" | "searchKnowledge" | "useEvidenceForWorkItem"
> & {
  resolveEscalation?: (
    escalationId: string,
    payload: ResolveEscalationRequest,
    options?: PageRequestOptions
  ) => Promise<{
    attention: {
      summary_text: string;
    };
  }>;
  reviewProposal?: (
    proposalId: string,
    payload: ReviewProposalRequest,
    options?: PageRequestOptions
  ) => Promise<{
    attention: {
      summary_text: string;
    };
  }>;
  resolveMemoryConflict?: WorkHubApiClient["resolveMemoryConflict"];
  // WIRE-07：中止进行中的 run（POST /api/agent-runs/:id/abort）——可选注入，测试替身不带也不影响其它动作。
  abortAgentRun?: WorkHubApiClient["abortAgentRun"];
  resolveBudgetDecision?: (
    escalationId: string,
    budgetActionId: string,
    options?: PageRequestOptions
  ) => Promise<{ attention: { summary_text: string } }>;
  skipTaskPlanProposal?: (
    proposalId: string,
    options?: PageRequestOptions
  ) => Promise<{ attention: { summary_text: string } }>;
  createSession?: (payload?: CreateSessionRequest) => Promise<Awaited<ReturnType<WorkHubApiClient["createSession"]>>>;
  createWorkItem?: (payload: CreateWorkItemRequest) => Promise<Awaited<ReturnType<WorkHubApiClient["createWorkItem"]>>>;
  startAgentRun?: (
    workItemId: string,
    payload?: StartAgentRunRequest
  ) => Promise<Awaited<ReturnType<WorkHubApiClient["startAgentRun"]>>>;
  mergeProposal: (
    proposalId: string,
    payload?: MergeProposalRequest,
    options?: PageRequestOptions
  ) => Promise<{
    attention: {
      summary_text: string;
    };
  }>;
  applyMergeProposalCandidate?: (
    mergeProposalId: string,
    payload?: ApplyMergeProposalCandidateRequest,
    options?: PageRequestOptions
  ) => Promise<{
    attention: {
      summary_text: string;
    };
  }>;
};

export const desktopCuuNoticeCss = [
  ".wh-cuu-card{display:grid;gap:10px;margin-top:10px;min-width:0;max-width:100%;font-weight:650;overflow:hidden;overflow-wrap:anywhere;word-break:break-word}",
  ".wh-cuu-card-copy{display:grid;gap:8px;min-width:0;max-width:100%;width:100%;overflow:hidden}",
  ".wh-cuu-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;max-width:100%;flex-wrap:wrap}",
  ".wh-cuu-card-kicker{display:flex;align-items:center;gap:8px;min-width:0;max-width:100%;flex-wrap:wrap;color:var(--wh-app-muted);font-size:12px}",
  ".wh-cuu-card-mark{width:8px;height:8px;border-radius:999px;background:var(--wh-app-blue);box-shadow:0 0 0 3px rgba(53,92,255,.14)}",
  ".wh-cuu-card-state{min-width:0;max-width:100%;font-size:11px;color:var(--wh-app-muted);font-weight:800;white-space:normal;overflow-wrap:anywhere;word-break:break-word}",
  ".wh-cuu-card-title{min-width:0;max-width:100%;width:100%;font-size:15px;line-height:1.35;white-space:normal;overflow-wrap:anywhere;word-break:break-word}",
  ".wh-cuu-card-message{min-width:0;max-width:100%;width:100%;margin:0;color:var(--wh-app-muted);font-size:13px;line-height:1.45;font-weight:600;white-space:normal;overflow-wrap:anywhere;word-break:break-word}",
  ".wh-cuu-card-chips,.wh-cuu-card-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;min-width:0;max-width:100%;width:100%}",
  ".wh-cuu-chip{box-sizing:border-box;min-width:0;max-width:100%;border:1px solid var(--wh-app-line);border-radius:999px;background:#fff;padding:5px 8px;font-size:12px;color:var(--wh-app-ink);white-space:normal;overflow-wrap:anywhere;word-break:break-word}",
  ".wh-cuu-action{box-sizing:border-box;min-width:0;max-width:100%;border:1px solid var(--wh-app-line);border-radius:8px;background:#fff;padding:8px 10px;color:var(--wh-app-ink);font-size:13px;text-align:left;text-decoration:none;font-weight:800;white-space:normal;overflow-wrap:anywhere;word-break:break-word}",
  ".wh-cuu-action[data-tone=primary]{background:var(--wh-app-blue);border-color:var(--wh-app-blue);color:#fff}",
  ".wh-cuu-action[data-tone=danger]{background:#fff4f3;border-color:rgba(238,107,95,.34);color:#b42318}",
  ".wh-cuu-queue-badge{position:fixed;right:18px;bottom:124px;z-index:39;box-sizing:border-box;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 36px);min-width:0;border:1px solid rgba(53,92,255,.18);border-radius:8px;background:rgba(255,255,255,.92);box-shadow:0 12px 34px rgba(37,51,79,.12);padding:8px 10px;color:var(--wh-app-ink);font:750 12px/1.2 \"Aptos\",\"Segoe UI\",sans-serif}",
  ".wh-cuu-queue-badge[hidden]{display:none}.wh-cuu-queue-count{flex:0 0 auto;min-width:20px;height:20px;border-radius:999px;display:grid;place-items:center;background:var(--wh-app-blue);color:#fff;font-size:11px}.wh-cuu-queue-text{min-width:0;max-width:min(180px,calc(100vw - 96px));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--wh-app-muted)}"
].join("");

export function createDesktopCuuAgentLauncherCard(options: CuuLocaleOptions & { projectId?: string } = {}): CuuCard {
  const projectId = validProjectId(options.projectId);
  return {
    id: "cuu-agent-launcher",
    kind: "question",
    state: "asking_approval",
    motion: {
      state: "asking_approval",
      sprite_state: "asking_approval_bounce",
      emphasis: "busy",
      loop: true,
      reduced_motion_fallback: cuuT(options.locale, "cuuStart.reducedMotion")
    },
    title: cuuT(options.locale, "cuuStart.title"),
    message: cuuT(options.locale, "cuuStart.message"),
    priority: "normal",
    input: {
      mode: "long_text",
      option_first: false,
      free_text_enabled: true,
      free_text_collapsed_by_default: false,
      free_text_placeholder: cuuT(options.locale, "cuuStart.placeholder"),
      free_text_max_length: 1200
    },
    progress: [
      { key: "intent", label: cuuT(options.locale, "cuuStart.progressIntent"), state: "active", index: 0 },
      { key: "task", label: cuuT(options.locale, "cuuStart.progressTask"), state: "pending", index: 1 },
      { key: "run", label: cuuT(options.locale, "cuuStart.progressRun"), state: "pending", index: 2 }
    ],
    actions: [
      {
        id: "start_agent_from_cuu",
        label: cuuT(options.locale, "cuuStart.action"),
        tone: "primary",
        method: "POST",
        href: "/api/cuu/start-agent",
        payload: {
          title: cuuT(options.locale, "cuuStart.defaultTitle"),
          ...(projectId ? { project_id: projectId } : {})
        }
      }
    ],
    payload_ref: {
      entity_type: "event",
      entity_id: "cuu-agent-launcher",
      href: "/api/cuu/start-agent"
    }
  };
}

export function createDesktopCuuAnalysisCard(
  action: DesktopCuuStartAgentAction,
  options: CuuLocaleOptions = {}
): CuuCard {
  const sections: CuuCardSection[] = [
    {
      id: "tools",
      title: options.locale === "en-US" ? "Tool status" : "工具状态",
      lines: [
        cuuT(options.locale, "cuuStart.analysisToolIntent"),
        cuuT(options.locale, "cuuStart.analysisToolFiles"),
        cuuT(options.locale, "cuuStart.analysisToolModel")
      ]
    },
    {
      id: "privacy",
      title: options.locale === "en-US" ? "Visibility" : "可见内容",
      lines: [cuuT(options.locale, "cuuStart.analysisPrivacy")]
    }
  ];
  return {
    id: "cuu-agent-analysis",
    kind: "trace",
    state: "thinking",
    motion: cuuMotionForState("thinking"),
    title: cuuT(options.locale, "cuuStart.analysisTitle"),
    message: cuuT(options.locale, "cuuStart.analysisMessage"),
    priority: "normal",
    actions: [],
    sections,
    progress: [
      { key: "intent", label: cuuT(options.locale, "cuuStart.progressIntent"), state: "done", index: 0 },
      { key: "analysis", label: options.locale === "en-US" ? "Analyze" : "分析", state: "active", index: 1 },
      { key: "task", label: cuuT(options.locale, "cuuStart.progressTask"), state: "pending", index: 2 },
      { key: "run", label: cuuT(options.locale, "cuuStart.progressRun"), state: "pending", index: 3 }
    ],
    payload_ref: {
      entity_type: "event",
      entity_id: "cuu-agent-analysis",
      href: "/api/cuu/start-agent"
    },
    source: {
      entity_type: "event",
      entity_id: action.title
    }
  };
}

export async function startDesktopCuuAgentFromLauncher(input: {
  client: DesktopCuuAgentLaunchClient;
  action: DesktopCuuStartAgentAction;
  locale?: CuuLocaleOptions["locale"];
}): Promise<DesktopCuuAgentLaunchResult> {
  if (!input.client.createSession || !input.client.createWorkItem || !input.client.startAgentRun) {
    throw new Error(cuuT(input.locale, "cuuStart.unavailable"));
  }
  const sessionPayload: CreateSessionRequest = {
    title: input.action.title,
    intent_text: input.action.intentText,
    ...(input.action.projectId ? { project_id: input.action.projectId } : {})
  };
  const localeOptions = input.locale ? { locale: input.locale } : undefined;
  const session = await input.client.createSession(sessionPayload, localeOptions);
  if (desktopCuuSessionNeedsClarification(session)) {
    return {
      outcome: "clarification",
      session,
      message: cuuFormat(input.locale, "cuuStart.clarificationNeeded", { title: session.question.title }),
      card: cardFromSessionVm(session, input)
    };
  }
  const workItem = await input.client.createWorkItem({
    session_id: session.session_id,
    title: input.action.title,
    raw_description: input.action.intentText,
    free_text: input.action.intentText,
    ...(input.action.selectedOptionIds?.length ? { selected_option_ids: input.action.selectedOptionIds } : {}),
    ...(input.action.cuuLauncherSpec ? { cuu_launcher_spec: input.action.cuuLauncherSpec } : {}),
    kickoff_agent: true,
    ...(input.action.projectId ? { project_id: input.action.projectId } : {})
  }, localeOptions);
  const workItemId = workItem.workitem.id;
  const runPayload: StartAgentRunRequest = {
    title: input.action.runTitle ?? input.action.title,
    ...(input.action.mode ? { mode: input.action.mode } : {})
  };
  const run = await input.client.startAgentRun(workItemId, runPayload, localeOptions);
  return {
    outcome: "started",
    session,
    workItem,
    run,
    message: cuuFormat(input.locale, "cuuStart.started", { title: run.title }),
    card: cardFromAgentRunLive(run, input)
  };
}

export function subscribeDesktopCuuAgentRunStream(input: {
  client: Pick<WorkHubApiClient, "getAgentRun" | "streamUrl">;
  run: AgentRunLiveVM;
  EventSourceCtor?: DesktopCuuEventSourceConstructor | undefined;
  onCard: (card: CuuCard, statusMessage?: string | undefined) => void;
  onStatus?: (status: DesktopCuuRunStreamStatus) => void;
  locale?: CuuLocaleOptions["locale"];
  fallbackRefreshMs?: number;
  // 可注入时钟，便于用假时钟单测兜底轮询的退避/续跑，不依赖真定时器。
  timers?: {
    setTimeout?: (handler: () => void, delayMs: number) => TimerId;
    clearTimeout?: (id: TimerId) => void;
    // DSK-11：兜底轮询的「SSE 活跃让位」判定需要时钟；默认 Date.now。
    now?: () => number;
  };
}): DesktopCuuRunStreamSubscription {
  const runId = input.run.run_id;
  const setTimeoutFn = input.timers?.setTimeout ?? ((handler, delayMs) => globalThis.setTimeout(handler, delayMs));
  const clearTimeoutFn = input.timers?.clearTimeout ?? ((id: TimerId) => globalThis.clearTimeout(id));
  const nowFn = input.timers?.now ?? (() => Date.now());
  const EventSourceCtor = input.EventSourceCtor ?? resolveDesktopCuuEventSource();
  if (!EventSourceCtor) {
    input.onStatus?.({ state: "unavailable", runId, reason: "event_source_unavailable" });
    return {
      runId,
      close() {
        input.onStatus?.({ state: "closed", runId, reason: "event_source_unavailable" });
      }
    };
  }

  // DSK-08：跨源 run 流 URL 被拒绝时不抛穿调用方——给一张诚实的错误卡 + error 状态，
  // 语义同 EventSource 不可用分支（订阅建立失败，不致命）。
  let streamUrl: string;
  try {
    streamUrl = desktopCuuRunStreamUrl(input.client, input.run.stream_href);
  } catch (error) {
    input.onCard(cardFromDesktopCuuRuntimeError(error, { locale: input.locale, run: input.run }));
    input.onStatus?.({ state: "error", runId, message: desktopCuuErrorMessage(error, input.locale) });
    return {
      runId,
      close() {
        input.onStatus?.({ state: "closed", runId, reason: "cross_origin_stream_url" });
      }
    };
  }
  const source = new EventSourceCtor(streamUrl, { withCredentials: true });
  let closed = false;
  let refreshing = false;
  let refreshAgain = false;
  let errorCardShown = false;
  let fallbackRefreshTimer: TimerId | undefined;
  // L#84 / R20 P1-03：兜底轮询带退避，连续失败只退避到慢节拍（封顶 60s）继续轮询，**永不永久停摆**。
  let consecutiveRefreshFailures = 0;
  // DSK-11：最近一次 SSE 事件/（重）连成功的时间。兜底轮询与 SSE 是双通道——SSE 事件还在流动时
  // 兜底全量 getAgentRun 只是重复流量，判定活跃期（2 拍内）则跳过这一次、只续表。
  // 初始 -∞：订阅刚建立、还没确认流是活的之前，兜底必须照常跑（不能用 0，否则注入假时钟从 0 起算时
  // 第一拍就被误判「活跃」而跳过）。
  let lastStreamEventAt = Number.NEGATIVE_INFINITY;

  const close = (reason = "closed") => {
    if (closed) {
      return;
    }
    closed = true;
    if (fallbackRefreshTimer !== undefined) {
      clearTimeoutFn(fallbackRefreshTimer);
      fallbackRefreshTimer = undefined;
    }
    source.close();
    input.onStatus?.({ state: "closed", runId, reason });
  };

  const refresh = async () => {
    if (closed) {
      return;
    }
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    try {
      const live = await input.client.getAgentRun(runId);
      consecutiveRefreshFailures = 0;
      input.onCard(cardFromAgentRunLive(live, input), cuuFormat(input.locale, "cuuStart.streamUpdated", { title: live.title }));
      input.onStatus?.({ state: "refreshed", runId, status: live.status });
      if (!desktopCuuAgentRunIsActive(live.status)) {
        close("terminal_status");
      }
    } catch (error) {
      consecutiveRefreshFailures += 1;
      input.onCard(cardFromDesktopCuuRuntimeError(error, { locale: input.locale, run: input.run }));
      input.onStatus?.({ state: "error", runId, message: desktopCuuErrorMessage(error, input.locale) });
    } finally {
      refreshing = false;
      if (refreshAgain && !closed) {
        refreshAgain = false;
        void refresh();
      }
    }
  };

  const handleRunEvent = (eventName: string, event: DesktopCuuEventSourceEvent) => {
    const workHubEvent = desktopCuuWorkHubEventFromSource(event);
    if (workHubEvent && !desktopCuuEventBelongsToRun(workHubEvent, runId)) {
      return;
    }
    input.onStatus?.({ state: "event", runId, eventType: workHubEvent?.type ?? eventName });
    lastStreamEventAt = nowFn();
    // findings[#low]：收到有效 SSE 事件视为连接已恢复，重置错误卡闩，使后续真实断连可再次提示
    //（否则一次断连后 errorCardShown 永久为 true，重连后再断也不再弹卡）。
    errorCardShown = false;
    // SSE 事件到达即恢复兜底轮询（若此前因连续失败停摆）。
    void refresh().finally(() => scheduleFallbackRefresh());
  };

  for (const eventName of desktopCuuRunStreamEventNames) {
    source.addEventListener(eventName, (event) => handleRunEvent(eventName, event));
  }
  // R20 P1-03：（重）连成功即做一次终态对账。自制 fetch 源与原生 EventSource 都在连上时派发 open。
  // 断网期间 run 可能已在服务端推进/终结，而重连后的流不回放漏掉的事件——这里复用既有 refresh/getAgentRun
  // 路径把 run 卡收敛到服务端真实状态，并复位错误闩 + 失败计数、取消慢节拍定时器回到正常轮询节拍。
  source.addEventListener("open", () => {
    if (closed) {
      return;
    }
    errorCardShown = false;
    consecutiveRefreshFailures = 0;
    lastStreamEventAt = nowFn();
    if (fallbackRefreshTimer !== undefined) {
      clearTimeoutFn(fallbackRefreshTimer);
      fallbackRefreshTimer = undefined;
    }
    void refresh().finally(() => scheduleFallbackRefresh());
  });
  source.addEventListener("error", () => {
    if (closed) {
      return;
    }
    input.onStatus?.({ state: "error", runId, message: cuuT(input.locale, "cuuStart.errorOfflineMessage") });
    if (!errorCardShown) {
      errorCardShown = true;
      input.onCard(cardFromDesktopCuuRuntimeError(new Error("event_source_error"), { locale: input.locale, run: input.run }));
    }
  });
  input.onStatus?.({ state: "subscribed", runId, streamUrl });
  const fallbackRefreshMs = input.fallbackRefreshMs ?? 2000;
  const MAX_FALLBACK_DELAY_MS = 60_000;
  // R20 P1-03：自调度退避，连续失败时间隔翻倍（封顶 60s）**继续轮询**，成功刷新或 SSE（重）连即把失败
  // 计数复位回正常节拍。删除旧「连续失败 10 次后停摆」的死亡分支——它假定后续 SSE 事件会来唤醒轮询，但
  // 自制 SSE 源断流后（修复前）永不再来事件，于是 run 卡在约两分钟断网后永久停更、只能 reload。
  const scheduleFallbackRefresh = () => {
    if (fallbackRefreshMs <= 0 || closed || fallbackRefreshTimer !== undefined) {
      return;
    }
    const delay = Math.min(fallbackRefreshMs * 2 ** Math.min(consecutiveRefreshFailures, 6), MAX_FALLBACK_DELAY_MS);
    fallbackRefreshTimer = setTimeoutFn(() => {
      fallbackRefreshTimer = undefined;
      // DSK-11：SSE 事件/（重）连在最近 2 拍内仍活跃 → 跳过这次兜底全量拉取，只续下一拍。
      // 兜底轮询的职责只剩「流静默/断流时兜住」，双通道不再并行打重复流量。
      if (nowFn() - lastStreamEventAt < Math.max(fallbackRefreshMs * 2, 1)) {
        scheduleFallbackRefresh();
        return;
      }
      void refresh().finally(scheduleFallbackRefresh);
    }, delay);
  };
  scheduleFallbackRefresh();

  return {
    runId,
    streamUrl,
    close
  };
}

export function cardFromDesktopCuuRuntimeError(
  error: unknown,
  options: CuuLocaleOptions & { run?: AgentRunLiveVM | undefined } = {}
): CuuCard {
  const kind = desktopCuuErrorKind(error);
  const state = kind === "budget" ? "asking_approval" : kind === "offline" ? "offline" : "worried";
  const run = options.run;
  const titleKey =
    kind === "budget"
      ? "cuuStart.errorBudgetTitle"
      : kind === "permission"
        ? "cuuStart.errorPermissionTitle"
        : kind === "offline"
          ? "cuuStart.errorOfflineTitle"
          : "cuuStart.errorGenericTitle";
  const messageKey =
    kind === "budget"
      ? "cuuStart.errorBudgetMessage"
      : kind === "permission"
        ? "cuuStart.errorPermissionMessage"
        : kind === "offline"
          ? "cuuStart.errorOfflineMessage"
          : run
            ? "cuuStart.errorGenericMessage"
            : "cuuStart.errorRestartMessage";
  const actions: CuuCardAction[] = run
    ? [
        {
          id: "view_replay",
          label: cuuT(options.locale, "cuuStart.errorViewReplay"),
          tone: "secondary",
          method: "GET",
          href: `/agent-runs/${run.run_id}/replay`
        },
        {
          id: "open_workitem",
          label: cuuT(options.locale, "cuuStart.errorOpenWorkItem"),
          tone: "secondary",
          method: "GET",
          href: `/workitems/${run.work_item_id}`
        }
      ]
    : kind === "generic"
      ? [
          {
            id: "restart_cuu",
            label: cuuT(options.locale, "cuuStart.errorRestartAction"),
            tone: "primary",
            method: "GET",
            href: "/cuu/restart"
          }
        ]
      : [];

  return {
    id: run ? `cuu-run-error-${run.run_id}` : "cuu-runtime-error",
    kind: kind === "budget" ? "budget" : kind === "offline" ? "offline" : "bubble",
    state,
    motion: cuuMotionForState(state),
    title: cuuT(options.locale, titleKey),
    message: desktopCuuErrorMessage(error, options.locale, messageKey),
    priority: kind === "budget" || kind === "permission" ? "high" : "normal",
    chips: [
      {
        id: kind,
        label: cuuT(options.locale, desktopCuuErrorChipKey(kind)),
        tone: kind === "budget" || kind === "permission" ? "warning" : kind === "offline" ? "warning" : "neutral"
      }
    ],
    actions,
    ...(run
      ? {
          payload_ref: {
            entity_type: "agent_run" as const,
            entity_id: run.run_id,
            href: `/agent-runs/${run.run_id}/replay`
          }
        }
      : {})
  };
}

export function resolveDesktopShellListen(input: unknown = globalThis): DesktopShellListen | undefined {
  const target = input as DesktopShellGlobal;
  return target.__TAURI__?.event?.listen ?? target.__YQGL_MOCK_LISTEN__;
}

export function resolveDesktopShellEmitter(input: unknown = globalThis): DesktopShellEmitter | undefined {
  const target = input as DesktopShellGlobal;
  const emit = target.__TAURI__?.event?.emit ?? target.__YQGL_MOCK_EMIT__;
  const emitTo = target.__TAURI__?.event?.emitTo ?? target.__YQGL_MOCK_EMIT_TO__;
  if (!emit && !emitTo) {
    return undefined;
  }
  return { emit, emitTo };
}

export function createDesktopShellScriptedListener(
  script: DesktopShellScriptedEvent[],
  timers: {
    setTimeout?: (handler: () => void, timeout: number) => TimerId;
    clearTimeout?: (id: TimerId) => void;
  } = {}
): DesktopShellScriptedListener {
  const handlers = new Map<DesktopShellScriptedEvent["eventName"], Set<(event: DesktopShellEventEnvelope) => void>>();
  const timerIds: TimerId[] = [];
  const setTimer = timers.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const clearTimer = timers.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  let started = false;
  let stopped = false;
  let dispatched = 0;

  const listen: DesktopShellListen = (eventName, handler) => {
    if (stopped) {
      return () => {};
    }
    const bucket = handlers.get(eventName) ?? new Set<(event: DesktopShellEventEnvelope) => void>();
    bucket.add(handler);
    handlers.set(eventName, bucket);
    return () => {
      bucket.delete(handler);
    };
  };

  return {
    listen,
    start() {
      if (started || stopped) {
        return;
      }
      started = true;
      for (const item of script) {
        const timerId = setTimer(() => {
          if (stopped) {
            return;
          }
          const bucket = handlers.get(item.eventName);
          if (!bucket?.size) {
            return;
          }
          dispatched += 1;
          for (const handler of [...bucket]) {
            handler({ payload: item.payload });
          }
        }, Math.max(0, item.delayMs));
        timerIds.push(timerId);
      }
    },
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      for (const timerId of timerIds.splice(0)) {
        clearTimer(timerId);
      }
      handlers.clear();
    },
    dispatched() {
      return dispatched;
    }
  };
}

export function createDesktopCuuDemoScript(
  surface: Pick<GoldPathSurfaceVM, "events">,
  input: {
    initialDelayMs?: number;
    intervalMs?: number;
    includeOfflineStatus?: boolean;
  } = {}
): DesktopShellScriptedEvent[] {
  const initialDelayMs = input.initialDelayMs ?? 500;
  const intervalMs = input.intervalMs ?? 1100;
  const events = selectDemoEvents(surface.events);
  const script = events.map<DesktopShellScriptedEvent>((event, index) => ({
    eventName: "push-event",
    delayMs: initialDelayMs + index * intervalMs,
    payload: desktopShellPayloadFromWorkHubEvent(event)
  }));

  if (input.includeOfflineStatus) {
    script.push({
      eventName: "sse-status",
      delayMs: initialDelayMs + events.length * intervalMs,
      payload: {
        stream_kind: "global",
        stream_path: "/api/push/stream",
        state: "retrying",
        message: "连接不太稳，Cuu 正在重连。"
      }
    });
  }

  return script;
}

// ── R12 批7:被派活告知气泡(action_card_item.dispatch_ask) ────────────────────────────
// 真实来源:apps/api/src/workers/conversation-observer.ts 的 dispatchExecuteItem 在
// dispatchPolicy==="ask" 时创建的 notification，经既有 /me SSE 流(notifications.ts 的
// bus.publish(topics.user(...), eventTypes.notificationCreated, ...))推到桌面——这条通路已经真实
// 打通，不需要任何新的订阅。cardFromEvent(@workhub/cuu)对 notification.created 只会给出通用文案
// （标题/正文照搬通知行），这里在它之前拦截，换成 00 §8 要求的 Cuu 二次元人格话术 + 深链进工作台的动作。

type DesktopDispatchAskNotification = {
  id: string;
  taskTitle?: string | undefined;
  projectId?: string | undefined;
  // R13 批 P2（拍板链路收尾）：conversation_id 是 Notification 契约新增的 additive 字段（服务端从
  // dispatch_ask 通知的 target_url 查询参数里解出来，见 apps/api/src/services/notifications.ts 的
  // extractConversationIdFromTargetUrl）——有它就能让气泡的深链直接定位到发起这次派活讨论的会话，
  // 而不是只到工作台的项目首屏。老通知/契约还没升级到的部署没有这个字段时保持 undefined，
  // buildWorkbenchDeepLinkHref 照旧只带 projectId 退化，不是假接线。
  conversationId?: string | undefined;
  createdAt?: string | undefined;
};

function parseDesktopDispatchAskNotification(event: WorkHubEvent<unknown>): DesktopDispatchAskNotification | undefined {
  if (event.type !== "notification.created") {
    return undefined;
  }
  const data = event.data;
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  const notificationType = typeof record.type === "string" ? record.type : undefined;
  const category: WorkbenchInterruptionCategory | undefined = classifyWorkbenchInterruptionCategory({
    notificationType
  });
  if (category !== "dispatch_ask") {
    return undefined;
  }
  const id = typeof record.id === "string" ? record.id : undefined;
  if (!id) {
    return undefined;
  }
  return {
    id,
    taskTitle: stringFromUnknown(record.body) ?? stringFromUnknown(record.title),
    projectId: stringFromUnknown(record.project_id),
    conversationId: stringFromUnknown(record.conversation_id),
    createdAt: stringFromUnknown(record.created_at)
  };
}

function buildDesktopDispatchAskCuuCard(
  notification: DesktopDispatchAskNotification,
  options: { locale?: CuuLocaleOptions["locale"] } = {}
): CuuCard {
  const locale = options.locale ?? "zh-CN";
  const copy = buildDispatchAskBubbleCopy({
    locale,
    taskTitle: notification.taskTitle ?? ""
  });
  const actions: CuuCardAction[] = notification.projectId
    ? [
        {
          id: "open_workbench",
          label: locale === "en-US" ? "Open the workbench" : "去工作台看看",
          tone: "primary",
          method: "GET",
          href: buildWorkbenchDeepLinkHref({
            projectId: notification.projectId,
            ...(notification.conversationId ? { conversationId: notification.conversationId } : {})
          })
        }
      ]
    : [];
  return {
    id: `dispatch-ask:${notification.id}`,
    kind: "bubble",
    state: "asking_approval",
    motion: cuuMotionForState("asking_approval"),
    title: copy.title,
    message: copy.message,
    priority: "normal",
    actions,
    payload_ref: { entity_type: "event", entity_id: notification.id },
    source: {
      entity_type: "event",
      entity_id: notification.id,
      ...(notification.projectId ? { project_id: notification.projectId } : {})
    },
    created_at: notification.createdAt ?? new Date().toISOString()
  };
}

// ── R14 FIX(通知深链缺 conversation_id):任意携带会话上下文的通知 → 深链进工作台会话 ───────────
//
// dispatch_ask 上面已经有专属问询卡(带自己的二次元问句文案)。但 R14 FIX 批把 conversation_id 缝进了
// 更多通知类型的 target_url(如 workitem.escalated/workitem.in_review 里程碑通知——见
// apps/api/src/services/notifications.ts 的 notifyMilestone 与 apps/api/src/workers/agent-runner.ts 的
// source_conversation_id 透传):这些通知如果什么都不做，会落进 cardFromEvent(@workhub/cuu)的通用兜底
// ——href 直接用 target_url，点击后 desktopPetMainRouteFromHref 把它当成"主窗口路由"打开工作项页，
// 完全绕过了工作台/会话。既然通知本身已经携带 project_id + conversation_id，就该像 dispatch_ask 一样
// 走同一条 pendingConversationId 深链机制直达会话，而不是退化成打开工作项页。
// 文案不套 dispatch_ask 那句专属问句(那是"有个活想派给你"的特定语境)——这里覆盖的通知类型各不相同，
// 直接用通知自己的 title/body(服务端已经是人话文案)。

type DesktopConversationNotification = {
  id: string;
  title: string;
  body?: string | undefined;
  projectId: string;
  conversationId: string;
  createdAt?: string | undefined;
};

// 只在 dispatch_ask 没有识别出来的前提下调用(调用方顺序见 bindDesktopShellCuuRuntime 的 onEvent)——
// 需要同时具备 project_id 与 conversation_id 才能拼出合法的 buildWorkbenchDeepLinkHref 落点，
// 缺任一个就诚实放弃、交还给 cardFromEvent 的通用兜底(不伪造一个打不通的深链)。project_id/
// conversation_id 的抠取复用 workbench/interruption-policy.ts 的 extractWorkbenchDeepLinkTarget——
// 那是本仓库已有的同款提取器(此前只有 WorkHubEvent 信封会命中 conversation_id，Notification 行
// 恒缺；R14 FIX 批把 conversation_id 补进部分通知类型后，同一份提取逻辑现在对两种来源都生效，
// 不需要另写一份)。
function parseDesktopConversationNotification(event: WorkHubEvent<unknown>): DesktopConversationNotification | undefined {
  if (event.type !== "notification.created") {
    return undefined;
  }
  const data = event.data;
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : undefined;
  const title = typeof record.title === "string" && record.title ? record.title : undefined;
  const { projectId, conversationId } = extractWorkbenchDeepLinkTarget(record);
  if (!id || !title || !projectId || !conversationId) {
    return undefined;
  }
  return {
    id,
    title,
    body: stringFromUnknown(record.body),
    projectId,
    conversationId,
    createdAt: stringFromUnknown(record.created_at)
  };
}

function buildDesktopConversationNotificationCuuCard(
  notification: DesktopConversationNotification,
  options: { locale?: CuuLocaleOptions["locale"] } = {}
): CuuCard {
  const locale = options.locale ?? "zh-CN";
  return {
    id: `notification-conversation:${notification.id}`,
    kind: "bubble",
    state: "idle",
    motion: cuuMotionForState("idle"),
    title: notification.title,
    message: compactTitle(notification.body ?? notification.title),
    priority: "normal",
    actions: [
      {
        id: "open_workbench",
        label: locale === "en-US" ? "Open the workbench" : "去工作台看看",
        tone: "primary",
        method: "GET",
        href: buildWorkbenchDeepLinkHref({ projectId: notification.projectId, conversationId: notification.conversationId })
      }
    ],
    payload_ref: { entity_type: "event", entity_id: notification.id },
    source: { entity_type: "event", entity_id: notification.id, project_id: notification.projectId },
    created_at: notification.createdAt ?? new Date().toISOString()
  };
}

// ── R12 批7:跨窗口打扰广播的接收端(workbench-interrupt) ────────────────────────────────
// 发送端见 workbench/interrupt-broadcast.ts 顶部注释——工作台窗口自己看到会话事件、判断该弹气泡后，
// 把一份轻量摘要广播给桌宠/主窗。这里把它转成一张 CuuCard 接进同一条 controller 队列，和其它气泡
// 共享同一套排队/节流/dismiss 逻辑，不另起一套呈现通道。

type DesktopWorkbenchInterruptPayload = {
  id: string;
  category: WorkbenchInterruptionCategory;
  projectId: string;
  conversationId: string;
  title: string;
  message: string;
  createdAt?: string | undefined;
};

function isWorkbenchInterruptionCategory(value: string | undefined): value is WorkbenchInterruptionCategory {
  return value === "message" || value === "action_card" || value === "dispatch_ask" || value === "proposal";
}

function parseDesktopWorkbenchInterruptPayload(input: unknown): DesktopWorkbenchInterruptPayload | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const id = stringFromUnknown(record.id);
  const category = stringFromUnknown(record.category);
  const projectId = stringFromUnknown(record.projectId);
  const conversationId = stringFromUnknown(record.conversationId);
  const title = stringFromUnknown(record.title);
  const message = stringFromUnknown(record.message);
  if (!id || !isWorkbenchInterruptionCategory(category) || !projectId || !conversationId || !title || !message) {
    return undefined;
  }
  return {
    id,
    category,
    projectId,
    conversationId,
    title,
    message,
    createdAt: stringFromUnknown(record.createdAt)
  };
}

function buildDesktopWorkbenchInterruptCuuCard(
  payload: DesktopWorkbenchInterruptPayload,
  options: { locale?: CuuLocaleOptions["locale"] } = {}
): CuuCard {
  const locale = options.locale ?? "zh-CN";
  return {
    id: `workbench-interrupt:${payload.id}`,
    kind: "bubble",
    state: "idle",
    motion: cuuMotionForState("idle"),
    title: payload.title,
    message: payload.message,
    priority: "normal",
    actions: [
      {
        id: "open_workbench",
        label: locale === "en-US" ? "Open the workbench" : "去工作台看看",
        tone: "primary",
        method: "GET",
        href: buildWorkbenchDeepLinkHref({ projectId: payload.projectId, conversationId: payload.conversationId })
      }
    ],
    payload_ref: { entity_type: "event", entity_id: payload.id },
    source: { entity_type: "event", entity_id: payload.id, project_id: payload.projectId },
    created_at: payload.createdAt ?? new Date().toISOString()
  };
}

export async function bindDesktopShellCuuRuntime(input: {
  listen?: DesktopShellListen | undefined;
  notify: (notice: DesktopCuuNotice) => void;
  controller?: CuuController;
  onDecision?: (decision: CuuControllerDecision) => void;
  onSystemNotification?: (plan: DesktopShellSystemNotificationPlan) => void;
  // INF-08：SSE 断线重连成功（同一 stream_kind 第二次及以后的 open）时回调——后端不回放断线窗口，
  // 订阅方据此做一次全量重拉对账（桌宠侧接 refreshVisibleAttentionCard），不靠下一条增量事件兜底。
  onSseReconnected?: (() => void) | undefined;
  now?: () => Date;
  locale?: CuuLocaleOptions["locale"];
}): Promise<DesktopShellCuuRuntime> {
  const listen = input.listen ?? resolveDesktopShellListen();
  if (!listen) {
    return {
      subscribed: false,
      async dispose() {}
    };
  }

  const controller = input.controller ?? createCuuController();
  const emitCard = (card: CuuCard) => {
    const decision = controller.enqueue(card);
    input.onDecision?.(decision);
    if (decision.outcome !== "show" && decision.outcome !== "replace") {
      return;
    }
    const shownCard = decision.card ?? card;
    input.notify({
      card: shownCard,
      message: desktopCuuNoticeMessage(shownCard, input),
      html: renderDesktopCuuNotice(shownCard, input)
    });
  };
  // R12 批7:dispatch_ask 通知走自定义的二次元问询卡(见上方 buildDesktopDispatchAskCuuCard)，不用
  // cardFromEvent 的通用通知文案——同一条推送两边都会触发(onEvent 先、onCuuCard 随后)，用这个标志把
  // 已经在 onEvent 里手动 emitCard 过的那次挡掉，避免同一条通知冒出两张卡。
  // R14 FIX：其它携带 conversation_id 的通知(见下方 parseDesktopConversationNotification)走同一套
  // 拦截+去重+防双卡逻辑，只是换一张不带专属问句文案的卡。
  let suppressNextGenericCuuCard = false;
  const notificationBubbleDeduper = createWorkbenchNotificationDeduper();
  const bridge = createDesktopShellEventBridge({
    ...(input.now ? { now: input.now } : {}),
    get locale() {
      return input.locale;
    },
    onEvent(bridged) {
      const dispatchAsk = parseDesktopDispatchAskNotification(bridged.event);
      if (dispatchAsk) {
        suppressNextGenericCuuCard = true;
        if (!notificationBubbleDeduper.shouldDeliver(dispatchAsk.id)) {
          return;
        }
        emitCard(buildDesktopDispatchAskCuuCard(dispatchAsk, { locale: input.locale }));
        return;
      }
      const conversationNotification = parseDesktopConversationNotification(bridged.event);
      if (!conversationNotification) {
        return;
      }
      suppressNextGenericCuuCard = true;
      if (!notificationBubbleDeduper.shouldDeliver(conversationNotification.id)) {
        return;
      }
      emitCard(buildDesktopConversationNotificationCuuCard(conversationNotification, { locale: input.locale }));
    },
    onCuuCard(card) {
      if (suppressNextGenericCuuCard) {
        suppressNextGenericCuuCard = false;
        return;
      }
      emitCard(card);
    },
    onSystemNotification(plan) {
      input.onSystemNotification?.(plan);
    }
  });
  const unlisten: DesktopShellUnlisten[] = [];
  // INF-08：按 stream_kind 累计 open 次数。首次 open=首连（壳层刚拉过），>1 即断线重连——触发全量对账回调。
  const sseOpenCounts = new Map<string, number>();
  const pushUnlisten = await listen("push-event", (event) => {
    bridge.handlePushPayload(event.payload);
  });
  if (typeof pushUnlisten === "function") {
    unlisten.push(pushUnlisten);
  }
  // R25-Q：这里此前还会把 sse-status（per-subscription、协议粒度的原始信号）翻成一张"offline"卡片
  // 塞进 controller（bridge.handleSseStatusPayload），带 retryingDelayMs 防抖 + dismissCardIfPresent
  // 复原——那正是 L-06（`r24-S5-reverify.md`）记录的"桌宠离线时自作主张放大搬家"根因：这张卡的
  // CuuState 是"offline"，非 idle 态卡片一律走 windowModeForState 的"card"分支（520×720），会把
  // 260×340 的小窗撑大、原生窗口跟着挪位置。现在桌宠改从 workhub-connection-changed（壳层的连接
  // 状态"单一真相"，见 pet-surface.ts 的 connectionStatus/desktopPetConnectionStatusText）读一份
  // 独立于 controller 卡片队列之外的持续状态，走既有的"无卡片、只有 status_text"紧凑气泡（body_only
  // 尺寸不变），不再需要这个函数往 controller 里塞卡片——sse-status 这条订阅只保留下面的重连计数，
  // 用于 INF-08 的全量对账触发，不再驱动任何 UI。
  const statusUnlisten = await listen("sse-status", (event) => {
    const payload = parseDesktopShellSseStatusPayload(event.payload);
    if (payload?.state !== "open") {
      return;
    }
    // INF-08：断线重连成功 → 全量重拉对账。首连不触发（壳层启动已拉过），重连窗口里漏掉的
    // push 事件（后端无回放）靠这次补拉收敛到服务端真实状态。
    const openCount = (sseOpenCounts.get(payload.stream_kind) ?? 0) + 1;
    sseOpenCounts.set(payload.stream_kind, openCount);
    if (openCount > 1) {
      input.onSseReconnected?.();
    }
  });
  if (typeof statusUnlisten === "function") {
    unlisten.push(statusUnlisten);
  }
  const systemNotificationUnlisten = await listen("system-notification", (event) => {
    bridge.handleSystemNotificationPayload(event.payload);
  });
  if (typeof systemNotificationUnlisten === "function") {
    unlisten.push(systemNotificationUnlisten);
  }
  // R12 批7:接收工作台窗口广播的"该弹气泡了"结论(见 workbench/interrupt-broadcast.ts)。独立的
  // dedupe 实例——广播源自己也会 dedupe，但重连/多实例广播时这里再挡一道，双保险不双弹。
  const workbenchInterruptDeduper = createWorkbenchNotificationDeduper();
  const workbenchInterruptUnlisten = await listen("workbench-interrupt", (event) => {
    const payload = parseDesktopWorkbenchInterruptPayload(event.payload);
    if (!payload || !workbenchInterruptDeduper.shouldDeliver(payload.id)) {
      return;
    }
    emitCard(buildDesktopWorkbenchInterruptCuuCard(payload, { locale: input.locale }));
  });
  if (typeof workbenchInterruptUnlisten === "function") {
    unlisten.push(workbenchInterruptUnlisten);
  }

  return {
    subscribed: true,
    async dispose() {
      for (const stop of unlisten.splice(0)) {
        stop();
      }
    }
  };
}

export function desktopCuuNoticeMessage(card: CuuCard, options: CuuLocaleOptions = {}) {
  return cuuFormat(options.locale, "notice.prefix", { title: card.title });
}

export function renderDesktopCuuNotice(card: CuuCard, options: CuuLocaleOptions = {}) {
  const chips = (card.chips ?? []).slice(0, 3).map(renderChip).join("");
  const actions = card.actions.slice(0, 3).map(renderAction).join("");
  return `<section class="wh-cuu-card" data-cuu-card-id="${escapeHtml(card.id)}" data-cuu-state="${escapeHtml(card.state)}" role="status">
    <div class="wh-cuu-card-copy">
      <div class="wh-cuu-card-head">
        <div class="wh-cuu-card-kicker"><span class="wh-cuu-card-mark" aria-hidden="true"></span><span>Cuu</span></div>
        <span class="wh-cuu-card-state">${escapeHtml(labelForState(card.state, options))}</span>
      </div>
      <strong class="wh-cuu-card-title">${escapeHtml(card.title)}</strong>
      <p class="wh-cuu-card-message">${escapeHtml(card.message)}</p>
    </div>
    ${chips ? `<div class="wh-cuu-card-chips">${chips}</div>` : ""}
    ${actions ? `<div class="wh-cuu-card-actions">${actions}</div>` : ""}
  </section>`;
}

export function resolveDesktopCuuAction(
  href: string,
  input: {
    actionId?: string | undefined;
    requiresReason?: boolean | undefined;
    card?: CuuCard | undefined;
    freeText?: string | undefined;
  } = {}
): DesktopCuuActionRequest | undefined {
  const url = new URL(href, "https://workhub.local");
  const path = url.pathname;
  if (path === "/api/cuu/start-agent" || path === "/cuu/start-agent") {
    const payload = actionPayloadFromCard(input.card, input.actionId, href);
    const selectedChips = selectedChipsFromCard(input.card);
    const selectedOptionIds = selectedChips.map((chip) => chip.id);
    const cuuLauncherSpec = cuuLauncherSpecFromSelectedChips(selectedChips);
    const freeText = stringFromUnknown(input.freeText);
    const title = freeText ?? stringFromUnknown(payload?.title) ?? url.searchParams.get("title") ?? titleFromSelectedChips(selectedChips);
    const selectedIntent = intentFromSelectedChips(selectedChips);
    const payloadIntent = freeText ?? stringFromUnknown(payload?.intent_text) ?? url.searchParams.get("intent_text");
    const intentText = [payloadIntent, selectedIntent].filter((value): value is string => Boolean(value)).join("\n") || title;
    const projectId = stringFromUnknown(payload?.project_id) ?? url.searchParams.get("project_id") ?? undefined;
    const runTitle = stringFromUnknown(payload?.run_title) ?? url.searchParams.get("run_title") ?? undefined;
    const mode = startModeFromUnknown(payload?.mode ?? url.searchParams.get("mode"));
    return {
      kind: "cuu-start-agent",
      title: compactTitle(title ?? intentText),
      intentText: compactIntent(intentText ?? title),
      ...(selectedOptionIds.length ? { selectedOptionIds } : {}),
      ...(cuuLauncherSpec ? { cuuLauncherSpec } : {}),
      ...(projectId ? { projectId } : {}),
      ...(runTitle ? { runTitle } : {}),
      ...(mode ? { mode } : {})
    };
  }

  // C1（桌宠死按钮修复）：spec_ready 工作项卡的「启动」动作此前在这份穷举里没有分支，
  // 点了既不提交也不导航。href 只有 /api/workitems/:id/agent-runs 这一种用法（发起端见
  // packages/cuu/src/cards.ts 的 start_agent 动作），无需按 method 再区分。
  const startAgentRunMatch = /^\/api\/workitems\/([^/]+)\/agent-runs$/u.exec(path);
  if (startAgentRunMatch?.[1]) {
    return {
      kind: "start-agent-run",
      workItemId: decodeURIComponent(startAgentRunMatch[1])
    };
  }

  const approvalMatch = /^\/api\/approvals\/([^/]+)\/respond$/u.exec(path);
  if (approvalMatch?.[1]) {
    return {
      kind: "approval-response",
      approvalId: decodeURIComponent(approvalMatch[1]),
      decision: approvalDecisionFromAction(input.actionId, input.requiresReason === true),
      requiresReason: input.requiresReason === true
    };
  }

  // B-R9.6 UX 审计（桌宠死卡）：sync_conflict 卡四动作 / budget 卡预算动作 / plan_review「先不拆」。
  const memoryConflictMatch = /^\/api\/memory-conflicts\/([^/]+)\/resolve\/(keep_current|accept_incoming|merge_both|edit_memory|discard_both)$/u.exec(path);
  if (memoryConflictMatch?.[1] && memoryConflictMatch[2]) {
    const expectedUpdatedAt = url.searchParams.get("expected_updated_at");
    if (!expectedUpdatedAt) {
      return undefined;
    }
    return {
      kind: "memory-conflict-resolve",
      conflictId: decodeURIComponent(memoryConflictMatch[1]),
      resolution: memoryConflictMatch[2] as "keep_current" | "accept_incoming" | "merge_both" | "edit_memory" | "discard_both",
      expectedUpdatedAt
    };
  }

  const budgetActionMatch = /^\/api\/escalations\/([^/]+)\/budget-actions\/([^/]+)$/u.exec(path);
  if (budgetActionMatch?.[1] && budgetActionMatch[2]) {
    return {
      kind: "budget-decision",
      escalationId: decodeURIComponent(budgetActionMatch[1]),
      budgetActionId: decodeURIComponent(budgetActionMatch[2])
    };
  }

  const skipPlanMatch = /^\/api\/proposals\/([^/]+)\/skip-plan$/u.exec(path);
  if (skipPlanMatch?.[1]) {
    return {
      kind: "skip-plan",
      proposalId: decodeURIComponent(skipPlanMatch[1])
    };
  }

  const escalationResolveMatch = /^\/api\/escalations\/([^/]+)\/resolve$/u.exec(path);
  if (escalationResolveMatch?.[1]) {
    const payload = escalationResolvePayloadFromAction(input.actionId, input.card, href);
    if (!payload) {
      return undefined;
    }
    return {
      kind: "resolve-escalation",
      escalationId: decodeURIComponent(escalationResolveMatch[1]),
      payload
    };
  }

  const proposalReviewMatch = /^\/api\/proposals\/([^/]+)\/review$/u.exec(path);
  if (proposalReviewMatch?.[1]) {
    return {
      kind: "proposal-review",
      proposalId: decodeURIComponent(proposalReviewMatch[1]),
      decision: proposalReviewDecisionFromAction(input.actionId, input.requiresReason === true),
      requiresReason: input.requiresReason === true
    };
  }

  const sessionMatch = /^\/api\/sessions\/([^/]+)\/next-question$/u.exec(path);
  if (sessionMatch?.[1]) {
    const selectedOptionIds = selectedOptionIdsFromCard(input.card);
    const freeText = stringFromUnknown(input.freeText);
    return {
      kind: "session-next-question",
      sessionId: decodeURIComponent(sessionMatch[1]),
      ...(selectedOptionIds.length ? { selectedOptionIds } : {}),
      ...(freeText ? { freeText } : {})
    };
  }

  if (path === "/knowledge/search" || path === "/api/knowledge/search") {
    const query = url.searchParams.get("query") ?? url.searchParams.get("q");
    const run = url.searchParams.get("run");
    return {
      kind: "knowledge-search",
      ...(query ? { query } : {}),
      ...(run ? { run } : {})
    };
  }

  const evidenceBindingMatch = /^\/api\/workitems\/([^/]+)\/evidence-bindings$/u.exec(path);
  if (evidenceBindingMatch?.[1] && input.actionId === "use_for_current_task") {
    const evidenceBubbleId =
      input.card?.payload_ref?.entity_type === "evidence" ? input.card.payload_ref.entity_id : undefined;
    return {
      kind: "use-evidence-for-task",
      workItemId: decodeURIComponent(evidenceBindingMatch[1]),
      evidenceRefs: input.card?.evidence_refs ?? [],
      ...(evidenceBubbleId ? { evidenceBubbleId } : {})
    };
  }

  const proposalMergeMatch = /^\/api\/proposals\/([^/]+)\/merge$/u.exec(path);
  if (proposalMergeMatch?.[1]) {
    const payload = actionPayloadFromCard(input.card, input.actionId, href);
    return {
      kind: "proposal-merge",
      proposalId: decodeURIComponent(proposalMergeMatch[1]),
      ...(payload ? { payload: payload as MergeProposalRequest } : {})
    };
  }

  const mergeProposalApplyMatch = /^\/api\/merge-proposals\/([^/]+)\/apply$/u.exec(path);
  if (mergeProposalApplyMatch?.[1]) {
    const payload = actionPayloadFromCard(input.card, input.actionId, href);
    return {
      kind: "proposal-merge-candidate-apply",
      mergeProposalId: decodeURIComponent(mergeProposalApplyMatch[1]),
      ...(payload ? { payload: payload as ApplyMergeProposalCandidateRequest } : {})
    };
  }

  // WIRE-07：agent-run 进行中卡的「取消执行」。
  const agentRunAbortMatch = /^\/api\/agent-runs\/([^/]+)\/abort$/u.exec(path);
  if (agentRunAbortMatch?.[1]) {
    return {
      kind: "abort-agent-run",
      runId: decodeURIComponent(agentRunAbortMatch[1])
    };
  }

  return undefined;
}

export async function submitDesktopCuuAction(input: {
  client: DesktopCuuActionClient & DesktopCuuAgentLaunchClient;
  action: DesktopCuuActionRequest;
  reasonMd?: string | undefined;
  locale?: CuuLocaleOptions["locale"];
}): Promise<DesktopCuuActionResult> {
  const localeOptions: PageRequestOptions | undefined = input.locale ? { locale: input.locale } : undefined;
  if (input.action.kind === "cuu-start-agent") {
    const launch = await startDesktopCuuAgentFromLauncher({
      client: input.client,
      action: input.action,
      locale: input.locale
    });
    return {
      message: launch.message,
      card: launch.card,
      ...(launch.outcome === "started" ? { agentRun: launch.run } : {})
    };
  }

  // C1（桌宠死按钮修复）：工作项已 spec_ready，直接开工——不经过 Cuu 会话式启动器，
  // 与 web 的 client.startAgentRun(workItemId) 零 payload 调法保持一致（apps/web/src/browser.ts
  // 的 startAgentRunActionFromHref 分支、apps/desktop-webview/src/workbench/kanban/api.ts 的
  // dispatchWorkItem 同一份端点）。
  if (input.action.kind === "start-agent-run") {
    if (!input.client.startAgentRun) {
      throw new Error(cuuT(input.locale, "cuuStart.unavailable"));
    }
    const run = await input.client.startAgentRun(input.action.workItemId, undefined, localeOptions);
    return {
      message: cuuFormat(input.locale, "cuuStart.started", { title: run.title }),
      card: cardFromAgentRunLive(run, input),
      agentRun: run
    };
  }

  if (input.action.kind === "approval-response") {
    if (input.action.decision === "deny" && !input.reasonMd?.trim()) {
      throw new Error(cuuT(input.locale, "action.reasonRequired"));
    }
    await input.client.respondApproval(input.action.approvalId, {
      decision: input.action.decision,
      ...(input.reasonMd ? { reason_md: input.reasonMd } : {}),
      remember: "once"
    });
    return {
      message: input.action.decision === "allow" ? cuuT(input.locale, "action.approved") : cuuT(input.locale, "action.denied")
    };
  }

  if (input.action.kind === "resolve-escalation") {
    if (!input.client.resolveEscalation) {
      throw new Error("Escalation resolve action is unavailable.");
    }
    const result = await input.client.resolveEscalation(input.action.escalationId, input.action.payload, {
      locale: input.locale ?? "zh-CN"
    });
    return {
      message: result.attention.summary_text
    };
  }

  if (input.action.kind === "proposal-review") {
    if (!input.client.reviewProposal) {
      throw new Error("Proposal review action is unavailable.");
    }
    if (input.action.decision === "request_changes" && !input.reasonMd?.trim()) {
      throw new Error(cuuT(input.locale, "action.reasonRequired"));
    }
    const result = await input.client.reviewProposal(input.action.proposalId, {
      decision: input.action.decision,
      ...(input.reasonMd ? { reason_md: input.reasonMd } : {}),
      remember: "once"
    }, localeOptions);
    return {
      message: result.attention.summary_text
    };
  }

  if (input.action.kind === "knowledge-search") {
    const bubble = await input.client.searchKnowledge({
      ...(input.action.query ? { query: input.action.query } : {}),
      ...(input.action.run ? { run: input.action.run } : {})
    });
    const card = cardFromEvidenceBubble(bubble, input);
    return {
      message: cuuT(input.locale, "action.evidenceFound"),
      card
    };
  }

  if (input.action.kind === "use-evidence-for-task") {
    if (input.action.evidenceRefs.length === 0) {
      throw new Error(cuuT(input.locale, "action.noEvidence"));
    }
    const detail = await input.client.useEvidenceForWorkItem(input.action.workItemId, {
      ...(input.action.evidenceBubbleId ? { evidence_bubble_id: input.action.evidenceBubbleId } : {}),
      evidence_refs: input.action.evidenceRefs,
      note: "Cuu evidence card action: use_for_current_task"
    });
    return {
      message: cuuT(input.locale, "action.evidenceBound"),
      card: cardFromWorkItemDetail(detail, input)
    };
  }

  if (input.action.kind === "memory-conflict-resolve") {
    if (!input.client.resolveMemoryConflict) {
      throw new Error("Memory conflict action is unavailable.");
    }
    await input.client.resolveMemoryConflict(input.action.conflictId, {
      resolution: input.action.resolution,
      expected_updated_at: input.action.expectedUpdatedAt,
      ...(input.action.valueMd ? { value_md: input.action.valueMd } : {})
    });
    return {
      message: cuuT(input.locale, "action.memoryConflictResolved")
    };
  }

  if (input.action.kind === "budget-decision") {
    if (!input.client.resolveBudgetDecision) {
      throw new Error("Budget decision action is unavailable.");
    }
    const result = await input.client.resolveBudgetDecision(input.action.escalationId, input.action.budgetActionId, localeOptions);
    return {
      message: result.attention.summary_text
    };
  }

  if (input.action.kind === "skip-plan") {
    if (!input.client.skipTaskPlanProposal) {
      throw new Error("Skip-plan action is unavailable.");
    }
    const result = await input.client.skipTaskPlanProposal(input.action.proposalId, localeOptions);
    return {
      message: result.attention.summary_text
    };
  }

  // WIRE-07：中止执行——两段式确认已在 pet-surface 点击层完成，到这里就是确认后的真提交。
  if (input.action.kind === "abort-agent-run") {
    if (!input.client.abortAgentRun) {
      throw new Error("Abort run action is unavailable.");
    }
    await input.client.abortAgentRun(input.action.runId);
    return {
      message: cuuT(input.locale, "action.runAborted")
    };
  }

  if (input.action.kind === "proposal-merge") {
    const result = await input.client.mergeProposal(input.action.proposalId, input.action.payload ?? {}, localeOptions);
    return {
      message: result.attention.summary_text
    };
  }

  if (input.action.kind === "proposal-merge-candidate-apply") {
    if (!input.client.applyMergeProposalCandidate) {
      throw new Error("AI fusion apply action is unavailable.");
    }
    const result = await input.client.applyMergeProposalCandidate(input.action.mergeProposalId, input.action.payload ?? {}, localeOptions);
    return {
      message: result.attention.summary_text
    };
  }

  const shouldStartRun = desktopCuuSessionSelectionStartsRun(input.action);
  if (shouldStartRun && (!input.client.createWorkItem || !input.client.startAgentRun)) {
    throw new Error(cuuT(input.locale, "cuuStart.unavailable"));
  }
  const session = await input.client.nextQuestion(input.action.sessionId, {
    ...(input.action.selectedOptionIds?.length ? { selected_option_ids: input.action.selectedOptionIds } : {}),
    ...(input.action.freeText ? { free_text: input.action.freeText } : {})
  }, localeOptions);
  if (shouldStartRun) {
    const workItem = await input.client.createWorkItem!({
      session_id: input.action.sessionId,
      ...(input.action.selectedOptionIds?.length ? { selected_option_ids: input.action.selectedOptionIds } : {}),
      ...(input.action.freeText ? { free_text: input.action.freeText } : {}),
      kickoff_agent: true
    }, localeOptions);
    const run = await input.client.startAgentRun!(workItem.workitem.id, {
      title: workItem.workitem.title
    }, localeOptions);
    return {
      message: cuuFormat(input.locale, "cuuStart.started", { title: run.title }),
      card: cardFromAgentRunLive(run, input),
      agentRun: run
    };
  }
  return {
    message: cuuFormat(input.locale, "action.nextQuestion", { title: session.question.title }),
    card: cardFromSessionVm(session, input)
  };
}

function desktopCuuSessionSelectionStartsRun(action: Extract<DesktopCuuActionRequest, { kind: "session-next-question" }>) {
  return action.selectedOptionIds?.includes("create-workitem") === true;
}

// WIRE-07：中止执行的两段式确认纯判定——照 workbench/drive/side-panel.ts 的 decideRollbackConfirmation
// 先例（同一个 run 在武装态下再点=执行；未武装或点了另一个 run=（重新）武装）。不碰 DOM，单测直接钉死。
export function decideDesktopCuuAbortConfirmation(
  armedRunId: string | undefined,
  clickedRunId: string
): { kind: "arm" | "execute"; runId: string } {
  return armedRunId === clickedRunId
    ? { kind: "execute", runId: clickedRunId }
    : { kind: "arm", runId: clickedRunId };
}

function desktopCuuSessionNeedsClarification(session: Awaited<ReturnType<WorkHubApiClient["createSession"]>>) {
  return session.question.options.length > 0 || session.question.input_mode === "long_text" || session.question.free_text.enabled;
}

function selectedOptionIdsFromCard(card: CuuCard | undefined) {
  return (card?.chips ?? []).filter((chip) => chip.selected).map((chip) => chip.id);
}

function selectedChipsFromCard(card: CuuCard | undefined) {
  return (card?.chips ?? []).filter((chip) => chip.selected);
}

function cuuLauncherSpecFromSelectedChips(chips: CuuCardChip[]): CuuLauncherWorkItemSpec | undefined {
  const selectedOptions = chips.flatMap((chip) => {
    const metadata = chip.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return [];
    }
    const parsed = cuuLauncherSpecOptionSchema.safeParse({
      id: chip.id,
      label: chip.label,
      ...(chip.description ? { description: chip.description } : {}),
      ...metadata
    });
    return parsed.success ? [parsed.data] : [];
  });
  return selectedOptions.length
    ? {
        source: "cuu_desktop_launcher",
        selected_options: selectedOptions
      }
    : undefined;
}

function actionPayloadFromCard(card: CuuCard | undefined, actionId: string | undefined, href: string) {
  return card?.actions.find((action) => (actionId ? action.id === actionId : false) || action.href === href)?.payload;
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactTitle(value: string | undefined) {
  const compact = (value ?? "").replace(/\s+/gu, " ").trim();
  return compact.length > 96 ? `${compact.slice(0, 95)}...` : compact;
}

function compactIntent(value: string | undefined) {
  return (value ?? "")
    .split(/\r?\n/gu)
    .map((line) => line.replace(/[ \t]+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function titleFromSelectedChips(chips: CuuCardChip[]) {
  return chips.length ? compactTitle(chips.map((chip) => chip.label).join(" + ")) : undefined;
}

function intentFromSelectedChips(chips: CuuCardChip[]) {
  if (!chips.length) {
    return undefined;
  }
  return chips.map((chip) => chip.description ? `${chip.label}: ${chip.description}` : chip.label).join("\n");
}

function startModeFromUnknown(value: unknown): StartAgentRunRequest["mode"] | undefined {
  return value === "worker" || value === "pm" ? value : undefined;
}

// 每个 run 的 SSE 流（/api/push/stream/run/:id）只承载 topics.run(runId) 上发布的事件——即 agent-runner
// 的 emitRunEvent 发到 run 话题的生命周期类。R17 #25（桌面 per-run 死订阅清理）：budget.* / proposal.* 曾
// 在此订阅，但它们只发到 topics.workitem / topics.user（emitBudgetNotice / proposalOpenedTopics / 提议合并），
// **从不发到 topics.run**——在这条 per-run 流上是永不触发的死订阅，删除。桌面仍从 /me 通道（经
// bindDesktopShellCuuRuntime 的 push-event 桥）收到这些预算/提议卡，不受影响。
const desktopCuuRunStreamEventNames = [
  "message",
  eventTypes.agentRunStarted,
  eventTypes.agentRunStep,
  eventTypes.stepToolResult,
  eventTypes.agentRunCompacting,
  eventTypes.agentRunFailed,
  eventTypes.agentRunEscalated
] as const;

function resolveDesktopCuuEventSource(): DesktopCuuEventSourceConstructor | undefined {
  if (desktopCuuBrowserClientToken() && desktopCuuFetchEventSourceAvailable()) {
    return DesktopCuuFetchEventSource;
  }
  return (globalThis as typeof globalThis & { EventSource?: DesktopCuuEventSourceConstructor }).EventSource;
}

// R20 P1-03：桌面自制 SSE 源改为「可恢复状态机」。旧实现只 open() 一次：EOF（服务端/网络关流）
// 直接静默返回、不派发任何事件也不重连，fetch 异常也只派发一次 error 就永久死掉——流一断就再也不回来，
// 约两分钟断网后网络恢复了 run 卡也不再更新，只能 reload。现在 EOF 与 fetch 异常都派发 error 事件并按
// 退避调度重连；成功建流（拿到响应体）即把退避复位回基准，并派发 open（对齐原生 EventSource 语义，
// 供订阅层做终态对账）。参照 client-tauri sse_worker：连上=基准、逐次翻倍、封顶 60s。
export type DesktopCuuFetchEventSourceHooks = {
  // 可注入 fetch / 时钟 / 随机源，便于用假时钟+假 fetch 单测重连状态机，不依赖真网络。
  fetch?: typeof fetch;
  setTimeout?: (handler: () => void, delayMs: number) => TimerId;
  clearTimeout?: (id: TimerId) => void;
  random?: () => number;
  baseReconnectMs?: number;
  maxReconnectMs?: number;
};

const DESKTOP_CUU_FETCH_BASE_RECONNECT_MS = 1_000;
const DESKTOP_CUU_FETCH_MAX_RECONNECT_MS = 60_000;

export class DesktopCuuFetchEventSource implements DesktopCuuEventSourceLike {
  private readonly listeners = new Map<string, Set<(event: DesktopCuuEventSourceEvent) => void>>();
  // 每次（重）连都换一个新的 AbortController：上一轮 EOF/异常后旧控制器可能已 abort。
  private controller = new AbortController();
  private closed = false;
  private reconnectTimer: TimerId | undefined;
  // 连续（重）连失败计数：成功建流即复位为 0，作为指数退避的指数。
  private consecutiveFailures = 0;
  private readonly fetchFn: typeof fetch | undefined;
  private readonly setTimeoutFn: (handler: () => void, delayMs: number) => TimerId;
  private readonly clearTimeoutFn: (id: TimerId) => void;
  private readonly randomFn: () => number;
  private readonly baseReconnectMs: number;
  private readonly maxReconnectMs: number;

  constructor(
    private readonly url: string,
    private readonly init: { withCredentials?: boolean } = {},
    hooks: DesktopCuuFetchEventSourceHooks = {}
  ) {
    this.fetchFn = hooks.fetch;
    this.setTimeoutFn = hooks.setTimeout ?? ((handler, delayMs) => globalThis.setTimeout(handler, delayMs));
    this.clearTimeoutFn = hooks.clearTimeout ?? ((id) => globalThis.clearTimeout(id));
    this.randomFn = hooks.random ?? (() => Math.random());
    this.baseReconnectMs = hooks.baseReconnectMs ?? DESKTOP_CUU_FETCH_BASE_RECONNECT_MS;
    this.maxReconnectMs = hooks.maxReconnectMs ?? DESKTOP_CUU_FETCH_MAX_RECONNECT_MS;
    void this.open();
  }

  addEventListener(eventName: string, handler: (event: DesktopCuuEventSourceEvent) => void) {
    const bucket = this.listeners.get(eventName) ?? new Set<(event: DesktopCuuEventSourceEvent) => void>();
    bucket.add(handler);
    this.listeners.set(eventName, bucket);
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    // 视图卸载：清掉待触发的重连定时器 + 中断在途连接，绝不泄漏定时器/连接。
    if (this.reconnectTimer !== undefined) {
      this.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.controller.abort();
  }

  private async open() {
    if (this.closed) {
      return;
    }
    this.controller = new AbortController();
    try {
      const token = desktopCuuBrowserClientToken();
      const headers = new Headers({ Accept: "text/event-stream" });
      if (token) {
        headers.set("X-WorkHub-Client-Token", token);
        headers.set("X-YQGL-Client-Token", token);
      }
      const doFetch = this.fetchFn ?? fetch;
      const response = await doFetch(this.url, {
        credentials: this.init.withCredentials ? "include" : "same-origin",
        headers,
        signal: this.controller.signal
      });
      if (!response.ok || !response.body) {
        throw new Error(`event_source_http_${response.status}`);
      }
      // 派发 open 供终态对账（响应 OK 即派发，不等数据——终态对账不依赖是否真收到过事件）。
      this.dispatch("open", {});
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const result = await reader.read();
        if (result.done) {
          break;
        }
        // C4（R21 审查）：退避复位推迟到这里——真正收到过数据块才算连接活着。若放在响应 OK 处
        // 立即清零，服务端「accept 即断」（HTTP 200 后立刻 EOF、从未有数据帧）的循环会让退避
        // 永远停在基准值，且每次 open 都触发一次全量 refresh，等于对一个死连接高频重试。
        this.consecutiveFailures = 0;
        buffer += decoder.decode(result.value, { stream: true });
        buffer = this.flushFrames(buffer);
      }
      buffer += decoder.decode();
      this.flushFrames(`${buffer}\n\n`);
      // EOF：服务端/网络关闭了流 → 与 fetch 异常同等对待，派发 error 并按退避重连（不再静默死掉）。
      this.handleDisconnect(new Error("event_source_eof"));
    } catch (error) {
      this.handleDisconnect(error);
    }
  }

  private handleDisconnect(error: unknown) {
    if (this.closed) {
      return;
    }
    this.dispatch("error", { data: error instanceof Error ? error.message : String(error) });
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer !== undefined) {
      return;
    }
    const delay = this.reconnectDelayMs();
    this.consecutiveFailures += 1;
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = undefined;
      void this.open();
    }, delay);
  }

  // 指数退避 + 抖动：0 次连续失败=基准；每多一次翻倍（移位封顶 4 = ×16）；总时长封顶 60s；
  // 再叠加最多 +25% 抖动，避免多流同时重连造成惊群。纯计算，便于注入随机源做确定性单测。
  private reconnectDelayMs() {
    const factor = 2 ** Math.min(this.consecutiveFailures, 4);
    const capped = Math.min(this.baseReconnectMs * factor, this.maxReconnectMs);
    const jitter = capped * 0.25 * this.randomFn();
    return capped + jitter;
  }

  private flushFrames(input: string) {
    let buffer = input.replace(/\r\n|\r/gu, "\n");
    for (;;) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary < 0) {
        return buffer;
      }
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseDesktopCuuFetchSseFrame(frame);
      if (event) {
        this.dispatch(event.event, { data: event.data });
      }
    }
  }

  private dispatch(eventName: string, event: DesktopCuuEventSourceEvent) {
    for (const handler of this.listeners.get(eventName) ?? []) {
      handler(event);
    }
  }
}

function desktopCuuFetchEventSourceAvailable() {
  return typeof fetch === "function" &&
    typeof Headers === "function" &&
    typeof TextDecoder === "function" &&
    typeof ReadableStream !== "undefined";
}

// DSK-06：令牌读取走 desktop-client-token.ts 单一收口（明文 localStorage 的已知风险见该文件头部注释）。
function desktopCuuBrowserClientToken() {
  try {
    const storage = globalThis.localStorage;
    return storage ? readDesktopClientToken(storage) : undefined;
  } catch {
    return undefined;
  }
}

function parseDesktopCuuFetchSseFrame(frame: string): { event: string; data: string } | undefined {
  const trimmed = frame.trim();
  if (!trimmed || trimmed.startsWith(":")) {
    return undefined;
  }
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }
  return { event, data: data.join("\n") };
}

// DSK-08：stream_href 若是绝对 URL，必须与 API base 同源——自制 fetch 源会给请求带上 client token
// 鉴权头（见 DesktopCuuFetchEventSource.open），一张脏数据 run 卡就能把 SSE 指到第三方源、令牌随连接外泄。
// 解析不出预期源或源不一致一律拒绝（调用方按错误卡处理），相对路径照旧走 client.streamUrl 解析。
function desktopCuuRunStreamUrl(client: Pick<WorkHubApiClient, "streamUrl">, streamHref: string) {
  if (!/^https?:\/\//iu.test(streamHref)) {
    return client.streamUrl(streamHref);
  }
  try {
    const expectedOrigin = new URL(client.streamUrl("/")).origin;
    if (new URL(streamHref).origin === expectedOrigin) {
      return streamHref;
    }
  } catch {
    // 落到下面的拒绝分支。
  }
  throw new Error(`Refused cross-origin agent run stream URL: ${streamHref}`);
}

function desktopCuuAgentRunIsActive(status: AgentRunLiveVM["status"]) {
  return status === "queued" || status === "running";
}

function desktopCuuWorkHubEventFromSource(event: DesktopCuuEventSourceEvent): WorkHubEvent<unknown> | undefined {
  if (!event.data) {
    return undefined;
  }
  try {
    const value = JSON.parse(event.data) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.event_id === "string" &&
      typeof record.type === "string" &&
      typeof record.topic === "string" &&
      typeof record.ts === "string" &&
      "data" in record
    ) {
      return value as WorkHubEvent<unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function desktopCuuEventBelongsToRun(event: WorkHubEvent<unknown>, runId: string) {
  if (event.topic === `run:${runId}` || event.run_id === runId) {
    return true;
  }
  if (event.data && typeof event.data === "object" && !Array.isArray(event.data)) {
    return (event.data as Record<string, unknown>).run_id === runId;
  }
  return false;
}

function desktopCuuErrorKind(error: unknown): "budget" | "permission" | "offline" | "generic" {
  if (error instanceof WorkHubApiError) {
    if (error.code === "budget_exhausted") {
      return "budget";
    }
    if ([401, 403].includes(error.status) || ["forbidden", "unauthorized", "permission_denied"].includes(error.code)) {
      return "permission";
    }
    if (["network_unavailable", "stream_unavailable", "offline", "disconnected"].includes(error.code)) {
      return "offline";
    }
  }
  if (error instanceof TypeError) {
    return "offline";
  }
  if (error instanceof Error && /event_source_error|failed to fetch|network|offline|disconnected/iu.test(error.message)) {
    return "offline";
  }
  return "generic";
}

function desktopCuuErrorChipKey(kind: ReturnType<typeof desktopCuuErrorKind>) {
  switch (kind) {
    case "budget":
      return "cuuStart.errorChip.budget";
    case "permission":
      return "cuuStart.errorChip.permission";
    case "offline":
      return "cuuStart.errorChip.offline";
    case "generic":
      return "cuuStart.errorChip.generic";
  }
}

function desktopCuuErrorMessage(error: unknown, locale: CuuLocaleOptions["locale"], fallbackKey?: Parameters<typeof cuuT>[1]) {
  if (fallbackKey) {
    return cuuT(locale, fallbackKey);
  }
  if (error instanceof WorkHubApiError && error.message.trim()) {
    return error.message.trim();
  }
  return cuuT(locale, fallbackKey ?? "cuuStart.errorGenericMessage");
}

function renderChip(chip: CuuCardChip) {
  const text = chip.description ? `${chip.label} · ${chip.description}` : chip.label;
  return `<span class="wh-cuu-chip" data-chip-id="${escapeHtml(chip.id)}">${escapeHtml(text)}</span>`;
}

function renderAction(action: CuuCardAction) {
  if (!action.href) {
    return `<span class="wh-cuu-action" data-tone="${escapeHtml(action.tone)}">${escapeHtml(action.label)}</span>`;
  }
  return `<a class="wh-cuu-action" href="${escapeHtml(safeHref(action.href))}" data-cuu-action-id="${escapeHtml(action.id)}" data-tone="${escapeHtml(action.tone)}" data-method="${escapeHtml(action.method ?? "GET")}" data-requires-reason="${action.requires_reason ? "true" : "false"}">${escapeHtml(action.label)}</a>`;
}

function selectDemoEvents(events: GoldPathEvent[]) {
  const selected = [
    events.find((event) => event.type === eventTypes.permissionAsk && Boolean(event.session_id)),
    events.find((event) => event.type === eventTypes.agentRunStarted),
    events.find((event) => event.type === eventTypes.knowledgeEvidenceReady),
    events.find((event) => event.type === eventTypes.budgetWarning || event.type === eventTypes.budgetExhausted),
    events.find((event) => event.type === eventTypes.proposalOpened),
    events.find((event) => event.type === eventTypes.permissionAsk && (event.attention?.kind === "approval" || Boolean(event.proposal_id))),
    events.find((event) => event.type === eventTypes.proposalMerged)
  ].filter((event): event is GoldPathEvent => Boolean(event));

  const seen = new Set<string>();
  const unique = selected.filter((event) => {
    if (seen.has(event.event_id)) {
      return false;
    }
    seen.add(event.event_id);
    return true;
  });
  return unique.length > 0 ? unique : events.slice(0, 6);
}

function desktopShellPayloadFromWorkHubEvent(event: GoldPathEvent) {
  const stream = streamFromTopic(event.topic);
  return {
    event: event.type,
    data: JSON.stringify(event),
    stream_kind: stream.kind,
    stream_path: stream.path
  };
}

function streamFromTopic(topic: string) {
  const [kind, id] = topic.split(":", 2);
  if (kind === "user") {
    return { kind: "me", path: "/api/push/stream/me" };
  }
  if (kind === "workitem" && id) {
    return { kind, path: `/api/push/stream/workitem/${encodeURIComponent(id)}` };
  }
  if (kind === "run" && id) {
    return { kind, path: `/api/push/stream/run/${encodeURIComponent(id)}` };
  }
  if (kind === "session" && id) {
    return { kind, path: `/api/push/stream/session/${encodeURIComponent(id)}` };
  }
  if (kind === "proposal" && id) {
    return { kind, path: `/api/push/stream/proposal/${encodeURIComponent(id)}` };
  }
  return { kind: "global", path: "/api/push/stream" };
}

function approvalDecisionFromAction(actionId: string | undefined, requiresReason: boolean): "allow" | "deny" {
  const normalized = actionId?.toLowerCase() ?? "";
  if (requiresReason || ["deny", "reject", "request_changes", "changes", "revise"].includes(normalized)) {
    return "deny";
  }
  return "allow";
}

function proposalReviewDecisionFromAction(actionId: string | undefined, requiresReason: boolean): ReviewProposalRequest["decision"] {
  return approvalDecisionFromAction(actionId, requiresReason) === "deny" ? "request_changes" : "approve";
}

function escalationResolvePayloadFromAction(
  actionId: string | undefined,
  card: CuuCard | undefined,
  href: string
): ResolveEscalationRequest | undefined {
  const payload = actionPayloadFromCard(card, actionId, href);
  if (payload && typeof payload === "object" && !Array.isArray(payload) && "action" in payload) {
    return payload as ResolveEscalationRequest;
  }
  switch (actionId) {
    case "escalation_retry":
      return { action: "retry" };
    case "escalation_pm_mode":
      return { action: "pm_mode" };
    case "escalation_cancel":
      return { action: "cancel" };
    default:
      return undefined;
  }
}

function labelForState(state: CuuCard["state"], options: CuuLocaleOptions = {}) {
  switch (state) {
    case "idle":
      return cuuT(options.locale, "state.idle");
    case "thinking":
      return cuuT(options.locale, "state.thinking");
    case "asking_approval":
      return cuuT(options.locale, "state.asking_approval");
    case "carrying_document":
      return cuuT(options.locale, "state.carrying_document");
    case "searching_evidence":
      return cuuT(options.locale, "state.searching_evidence");
    case "syncing_files":
      return cuuT(options.locale, "state.syncing_files");
    case "worried":
      return cuuT(options.locale, "state.worried");
    case "revision_requested":
      return cuuT(options.locale, "state.revision_requested");
    case "celebrating":
      return cuuT(options.locale, "state.celebrating");
    case "offline":
      return cuuT(options.locale, "state.offline");
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

// 外部/契约来源的 href 可能带 javascript:/data: → 点击即 XSS。只放行相对路径与 http(s)/mailto，其余拦成 "#"。
function safeHref(value: unknown): string {
  const v = String(value ?? "").trim();
  if ((v.startsWith("/") && !v.startsWith("//")) || /^(?:https?:|mailto:)/iu.test(v)) {
    return v;
  }
  return "#";
}
