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
  type CuuController,
  type CuuControllerDecision,
  type CuuLocaleOptions
} from "@workhub/cuu";
import { WorkHubApiError, type WorkHubApiClient } from "@workhub/api-client";
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
  type StartAgentRunRequest,
  type WorkHubEvent
} from "@workhub/contracts";

import { createDesktopShellEventBridge } from "./shell-events.js";
import type { DesktopShellSystemNotificationPlan } from "./shell-events.js";

export type DesktopShellEventEnvelope = {
  payload: unknown;
};

export type DesktopShellUnlisten = () => void;
export type DesktopShellEventName = "push-event" | "sse-status" | "system-notification" | "navigate" | "tray-action" | "pet-settings";

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
  | {
      kind: "approval-response";
      approvalId: string;
      decision: "allow" | "deny";
      requiresReason: boolean;
    }
  | {
      kind: "session-next-question";
      sessionId: string;
      selectedOptionIds?: string[];
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
    };

export type DesktopCuuActionResult = {
  message: string;
  card?: CuuCard;
  agentRun?: AgentRunLiveVM;
};

export type DesktopCuuStartAgentAction = Extract<DesktopCuuActionRequest, { kind: "cuu-start-agent" }>;

export type DesktopCuuAgentLaunchClient = {
  createSession?: (payload?: CreateSessionRequest) => Promise<Awaited<ReturnType<WorkHubApiClient["createSession"]>>>;
  createWorkItem?: (payload: CreateWorkItemRequest) => Promise<Awaited<ReturnType<WorkHubApiClient["createWorkItem"]>>>;
  startAgentRun?: (
    workItemId: string,
    payload?: StartAgentRunRequest
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

type TimerId = ReturnType<typeof globalThis.setTimeout>;
type GoldPathEvent = GoldPathSurfaceVM["events"][number];
type DesktopCuuActionClient = Pick<
  WorkHubApiClient,
  "respondApproval" | "nextQuestion" | "searchKnowledge" | "useEvidenceForWorkItem"
> & {
  createSession?: (payload?: CreateSessionRequest) => Promise<Awaited<ReturnType<WorkHubApiClient["createSession"]>>>;
  createWorkItem?: (payload: CreateWorkItemRequest) => Promise<Awaited<ReturnType<WorkHubApiClient["createWorkItem"]>>>;
  startAgentRun?: (
    workItemId: string,
    payload?: StartAgentRunRequest
  ) => Promise<Awaited<ReturnType<WorkHubApiClient["startAgentRun"]>>>;
  mergeProposal: (
    proposalId: string,
    payload?: MergeProposalRequest
  ) => Promise<{
    attention: {
      summary_text: string;
    };
  }>;
  applyMergeProposalCandidate?: (
    mergeProposalId: string,
    payload?: ApplyMergeProposalCandidateRequest
  ) => Promise<{
    attention: {
      summary_text: string;
    };
  }>;
};

export const desktopCuuNoticeCss = [
  ".wh-cuu-card{display:grid;gap:10px;margin-top:10px;min-width:0;max-width:100%;font-weight:650;overflow-wrap:anywhere;word-break:break-word}",
  ".wh-cuu-card-copy{display:grid;gap:8px;min-width:0;max-width:100%;width:100%}",
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

export function createDesktopCuuAgentLauncherCard(options: CuuLocaleOptions = {}): CuuCard {
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
    chips: [
      {
        id: "document-draft",
        label: cuuT(options.locale, "cuuStart.documentDraft"),
        description: cuuT(options.locale, "cuuStart.documentDraftDesc"),
        metadata: {
          delivery_kind: "document_draft",
          risk_hint: "low",
          default_acceptance: [
            cuuT(options.locale, "cuuStart.documentDraftAcceptancePrimary"),
            cuuT(options.locale, "cuuStart.documentDraftAcceptanceEvidence")
          ]
        },
        tone: "success",
        recommended: true
      },
      {
        id: "structured-data",
        label: cuuT(options.locale, "cuuStart.structuredData"),
        description: cuuT(options.locale, "cuuStart.structuredDataDesc"),
        metadata: {
          delivery_kind: "structured_data",
          risk_hint: "low",
          default_acceptance: [
            cuuT(options.locale, "cuuStart.structuredDataAcceptancePrimary"),
            cuuT(options.locale, "cuuStart.structuredDataAcceptanceEvidence")
          ]
        },
        tone: "success"
      },
      {
        id: "code-template",
        label: cuuT(options.locale, "cuuStart.codeTemplate"),
        description: cuuT(options.locale, "cuuStart.codeTemplateDesc"),
        metadata: {
          delivery_kind: "code_template",
          risk_hint: "medium",
          default_acceptance: [
            cuuT(options.locale, "cuuStart.codeTemplateAcceptancePrimary"),
            cuuT(options.locale, "cuuStart.codeTemplateAcceptanceSafety")
          ]
        },
        tone: "warning"
      }
    ],
    input: {
      mode: "single_choice",
      option_first: true,
      free_text_enabled: false,
      free_text_collapsed_by_default: true
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
          intent_text: cuuT(options.locale, "cuuStart.defaultIntent")
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

export async function startDesktopCuuAgentFromLauncher(input: {
  client: DesktopCuuAgentLaunchClient;
  action: DesktopCuuStartAgentAction;
  locale?: CuuLocaleOptions["locale"];
}): Promise<DesktopCuuAgentLaunchResult> {
  if (!input.action.selectedOptionIds?.length) {
    throw new Error(cuuT(input.locale, "pet.optionRequired"));
  }
  if (!input.client.createSession || !input.client.createWorkItem || !input.client.startAgentRun) {
    throw new Error(cuuT(input.locale, "cuuStart.unavailable"));
  }
  const sessionPayload: CreateSessionRequest = {
    title: input.action.title,
    intent_text: input.action.intentText,
    ...(input.action.projectId ? { project_id: input.action.projectId } : {})
  };
  const session = await input.client.createSession(sessionPayload);
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
    selected_option_ids: input.action.selectedOptionIds,
    ...(input.action.cuuLauncherSpec ? { cuu_launcher_spec: input.action.cuuLauncherSpec } : {}),
    kickoff_agent: true,
    ...(input.action.projectId ? { project_id: input.action.projectId } : {})
  });
  const workItemId = workItem.workitem.id;
  const runPayload: StartAgentRunRequest = {
    title: input.action.runTitle ?? input.action.title,
    ...(input.action.mode ? { mode: input.action.mode } : {})
  };
  const run = await input.client.startAgentRun(workItemId, runPayload);
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
}): DesktopCuuRunStreamSubscription {
  const runId = input.run.run_id;
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

  const streamUrl = desktopCuuRunStreamUrl(input.client, input.run.stream_href);
  const source = new EventSourceCtor(streamUrl, { withCredentials: true });
  let closed = false;
  let refreshing = false;
  let refreshAgain = false;
  let errorCardShown = false;
  let fallbackRefreshTimer: TimerId | undefined;

  const close = (reason = "closed") => {
    if (closed) {
      return;
    }
    closed = true;
    if (fallbackRefreshTimer !== undefined) {
      globalThis.clearInterval(fallbackRefreshTimer);
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
      input.onCard(cardFromAgentRunLive(live, input), cuuFormat(input.locale, "cuuStart.streamUpdated", { title: live.title }));
      input.onStatus?.({ state: "refreshed", runId, status: live.status });
      if (!desktopCuuAgentRunIsActive(live.status)) {
        close("terminal_status");
      }
    } catch (error) {
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
    void refresh();
  };

  for (const eventName of desktopCuuRunStreamEventNames) {
    source.addEventListener(eventName, (event) => handleRunEvent(eventName, event));
  }
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
  if (fallbackRefreshMs > 0) {
    fallbackRefreshTimer = globalThis.setInterval(() => {
      void refresh();
    }, fallbackRefreshMs);
  }

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
          : "cuuStart.errorGenericMessage";
  const run = options.run;
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
        message: "开发预览：daemon 连接不稳定，Cuu 正在重试。"
      }
    });
  }

  return script;
}

export async function bindDesktopShellCuuRuntime(input: {
  listen?: DesktopShellListen | undefined;
  notify: (notice: DesktopCuuNotice) => void;
  controller?: CuuController;
  onDecision?: (decision: CuuControllerDecision) => void;
  onSystemNotification?: (plan: DesktopShellSystemNotificationPlan) => void;
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
  const bridge = createDesktopShellEventBridge({
    ...(input.now ? { now: input.now } : {}),
    ...(input.locale ? { locale: input.locale } : {}),
    onCuuCard(card) {
      emitCard(card);
    },
    onSystemNotification(plan) {
      input.onSystemNotification?.(plan);
    }
  });
  const unlisten: DesktopShellUnlisten[] = [];
  const pushUnlisten = await listen("push-event", (event) => {
    bridge.handlePushPayload(event.payload);
  });
  if (typeof pushUnlisten === "function") {
    unlisten.push(pushUnlisten);
  }
  const statusUnlisten = await listen("sse-status", (event) => {
    bridge.handleSseStatusPayload(event.payload);
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
  input: { actionId?: string | undefined; requiresReason?: boolean | undefined; card?: CuuCard | undefined } = {}
): DesktopCuuActionRequest | undefined {
  const url = new URL(href, "https://workhub.local");
  const path = url.pathname;
  if (path === "/api/cuu/start-agent" || path === "/cuu/start-agent") {
    const payload = actionPayloadFromCard(input.card, input.actionId, href);
    const selectedChips = selectedChipsFromCard(input.card);
    const selectedOptionIds = selectedChips.map((chip) => chip.id);
    const cuuLauncherSpec = cuuLauncherSpecFromSelectedChips(selectedChips);
    const title = stringFromUnknown(payload?.title) ?? url.searchParams.get("title") ?? titleFromSelectedChips(selectedChips);
    const selectedIntent = intentFromSelectedChips(selectedChips);
    const payloadIntent = stringFromUnknown(payload?.intent_text) ?? url.searchParams.get("intent_text");
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

  const approvalMatch = /^\/api\/approvals\/([^/]+)\/respond$/u.exec(path);
  if (approvalMatch?.[1]) {
    return {
      kind: "approval-response",
      approvalId: decodeURIComponent(approvalMatch[1]),
      decision: approvalDecisionFromAction(input.actionId, input.requiresReason === true),
      requiresReason: input.requiresReason === true
    };
  }

  const sessionMatch = /^\/api\/sessions\/([^/]+)\/next-question$/u.exec(path);
  if (sessionMatch?.[1]) {
    const selectedOptionIds = selectedOptionIdsFromCard(input.card);
    return {
      kind: "session-next-question",
      sessionId: decodeURIComponent(sessionMatch[1]),
      ...(selectedOptionIds.length ? { selectedOptionIds } : {})
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

  return undefined;
}

export async function submitDesktopCuuAction(input: {
  client: DesktopCuuActionClient;
  action: DesktopCuuActionRequest;
  reasonMd?: string | undefined;
  locale?: CuuLocaleOptions["locale"];
}): Promise<DesktopCuuActionResult> {
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

  if (input.action.kind === "proposal-merge") {
    const result = await input.client.mergeProposal(input.action.proposalId, input.action.payload ?? {});
    return {
      message: result.attention.summary_text
    };
  }

  if (input.action.kind === "proposal-merge-candidate-apply") {
    if (!input.client.applyMergeProposalCandidate) {
      throw new Error("AI fusion apply action is unavailable.");
    }
    const result = await input.client.applyMergeProposalCandidate(input.action.mergeProposalId, input.action.payload ?? {});
    return {
      message: result.attention.summary_text
    };
  }

  const shouldStartRun = desktopCuuSessionSelectionStartsRun(input.action);
  if (shouldStartRun && (!input.client.createWorkItem || !input.client.startAgentRun)) {
    throw new Error(cuuT(input.locale, "cuuStart.unavailable"));
  }
  const session = await input.client.nextQuestion(input.action.sessionId, {
    ...(input.action.selectedOptionIds?.length ? { selected_option_ids: input.action.selectedOptionIds } : {})
  });
  if (shouldStartRun) {
    const workItem = await input.client.createWorkItem!({
      session_id: input.action.sessionId,
      ...(input.action.selectedOptionIds?.length ? { selected_option_ids: input.action.selectedOptionIds } : {}),
      kickoff_agent: true
    });
    const run = await input.client.startAgentRun!(workItem.workitem.id, {
      title: workItem.workitem.title
    });
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

function desktopCuuSessionNeedsClarification(session: Awaited<ReturnType<WorkHubApiClient["createSession"]>>) {
  return session.question.options.length > 0;
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

const desktopCuuRunStreamEventNames = [
  "message",
  eventTypes.agentRunStarted,
  eventTypes.agentRunStep,
  eventTypes.stepToolResult,
  eventTypes.agentRunCompacting,
  eventTypes.agentRunFailed,
  eventTypes.agentRunEscalated,
  eventTypes.budgetWarning,
  eventTypes.budgetExhausted,
  eventTypes.proposalOpened,
  eventTypes.proposalMerged
] as const;

function resolveDesktopCuuEventSource(): DesktopCuuEventSourceConstructor | undefined {
  if (desktopCuuBrowserClientToken() && desktopCuuFetchEventSourceAvailable()) {
    return DesktopCuuFetchEventSource;
  }
  return (globalThis as typeof globalThis & { EventSource?: DesktopCuuEventSourceConstructor }).EventSource;
}

class DesktopCuuFetchEventSource implements DesktopCuuEventSourceLike {
  private readonly listeners = new Map<string, Set<(event: DesktopCuuEventSourceEvent) => void>>();
  private readonly controller = new AbortController();
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly init: { withCredentials?: boolean } = {}
  ) {
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
    this.controller.abort();
  }

  private async open() {
    try {
      const token = desktopCuuBrowserClientToken();
      const headers = new Headers({ Accept: "text/event-stream" });
      if (token) {
        headers.set("X-WorkHub-Client-Token", token);
        headers.set("X-YQGL-Client-Token", token);
      }
      const response = await fetch(this.url, {
        credentials: this.init.withCredentials ? "include" : "same-origin",
        headers,
        signal: this.controller.signal
      });
      if (!response.ok || !response.body) {
        throw new Error(`event_source_http_${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const result = await reader.read();
        if (result.done) {
          break;
        }
        buffer += decoder.decode(result.value, { stream: true });
        buffer = this.flushFrames(buffer);
      }
      buffer += decoder.decode();
      this.flushFrames(`${buffer}\n\n`);
    } catch (error) {
      if (!this.closed) {
        this.dispatch("error", { data: error instanceof Error ? error.message : String(error) });
      }
    }
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

function desktopCuuBrowserClientToken() {
  try {
    return globalThis.localStorage?.getItem("workhub_client_token") ??
      globalThis.localStorage?.getItem("yqgl_client_token") ??
      undefined;
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

function desktopCuuRunStreamUrl(client: Pick<WorkHubApiClient, "streamUrl">, streamHref: string) {
  return /^https?:\/\//iu.test(streamHref) ? streamHref : client.streamUrl(streamHref);
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
  return `<a class="wh-cuu-action" href="${escapeHtml(action.href)}" data-cuu-action-id="${escapeHtml(action.id)}" data-tone="${escapeHtml(action.tone)}" data-method="${escapeHtml(action.method ?? "GET")}" data-requires-reason="${action.requires_reason ? "true" : "false"}">${escapeHtml(action.label)}</a>`;
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
