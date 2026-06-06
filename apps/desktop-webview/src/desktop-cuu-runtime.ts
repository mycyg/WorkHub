import {
  createCuuController,
  cardFromEvidenceBubble,
  cardFromWorkItemDetail,
  type CuuCard,
  type CuuCardAction,
  type CuuCardChip,
  type CuuController,
  type CuuControllerDecision
} from "@workhub/cuu";
import type { WorkHubApiClient } from "@workhub/api-client";
import { eventTypes, type EvidenceRef, type GoldPathSurfaceVM } from "@workhub/contracts";

import { desktopCuuSpriteCss, renderDesktopCuuSprite } from "./cuu-sprite-runtime.js";
import { createDesktopShellEventBridge } from "./shell-events.js";

export type DesktopShellEventEnvelope = {
  payload: unknown;
};

export type DesktopShellUnlisten = () => void;

export type DesktopShellListen = (
  eventName: "push-event" | "sse-status",
  handler: (event: DesktopShellEventEnvelope) => void
) => DesktopShellUnlisten | Promise<DesktopShellUnlisten> | void | Promise<void>;

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
  eventName: "push-event" | "sse-status";
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
      kind: "approval-response";
      approvalId: string;
      decision: "allow" | "deny";
      requiresReason: boolean;
    }
  | {
      kind: "session-next-question";
      sessionId: string;
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
    };

export type DesktopCuuActionResult = {
  message: string;
  card?: CuuCard;
};

type DesktopShellGlobal = {
  __TAURI__?: {
    event?: {
      listen?: DesktopShellListen;
    };
  };
  __YQGL_MOCK_LISTEN__?: DesktopShellListen;
};

type TimerId = ReturnType<typeof globalThis.setTimeout>;
type GoldPathEvent = GoldPathSurfaceVM["events"][number];

export const desktopCuuNoticeCss = [
  desktopCuuSpriteCss,
  ".wh-cuu-card{display:grid;gap:10px;margin-top:10px;font-weight:650}",
  ".wh-cuu-card-hero{display:flex;align-items:center;gap:12px}",
  ".wh-cuu-card-copy{display:grid;gap:8px;min-width:0}",
  ".wh-cuu-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px}",
  ".wh-cuu-card-kicker{display:flex;align-items:center;gap:8px;color:var(--wh-app-muted);font-size:12px}",
  ".wh-cuu-card-paw{width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,#ffb169,#355cff);box-shadow:0 6px 16px rgba(53,92,255,.18)}",
  ".wh-cuu-card-state{font-size:11px;color:var(--wh-app-muted);font-weight:800}",
  ".wh-cuu-card-title{font-size:15px;line-height:1.35}",
  ".wh-cuu-card-message{margin:0;color:var(--wh-app-muted);font-size:13px;line-height:1.45;font-weight:600}",
  ".wh-cuu-card-chips,.wh-cuu-card-actions{display:flex;gap:8px;flex-wrap:wrap}",
  ".wh-cuu-chip{border:1px solid var(--wh-app-line);border-radius:999px;background:#fff;padding:5px 8px;font-size:12px;color:var(--wh-app-ink)}",
  ".wh-cuu-action{border:1px solid var(--wh-app-line);border-radius:8px;background:#fff;padding:8px 10px;color:var(--wh-app-ink);font-size:13px;text-decoration:none;font-weight:800}",
  ".wh-cuu-action[data-tone=primary]{background:var(--wh-app-blue);border-color:var(--wh-app-blue);color:#fff}",
  ".wh-cuu-action[data-tone=danger]{background:#fff4f3;border-color:rgba(238,107,95,.34);color:#b42318}",
  ".wh-cuu-queue-badge{position:fixed;right:18px;bottom:124px;z-index:39;display:flex;align-items:center;gap:8px;border:1px solid rgba(53,92,255,.18);border-radius:8px;background:rgba(255,255,255,.92);box-shadow:0 12px 34px rgba(37,51,79,.12);padding:8px 10px;color:var(--wh-app-ink);font:750 12px/1.2 \"Aptos\",\"Segoe UI\",sans-serif}",
  ".wh-cuu-queue-badge[hidden]{display:none}.wh-cuu-queue-count{min-width:20px;height:20px;border-radius:999px;display:grid;place-items:center;background:var(--wh-app-blue);color:#fff;font-size:11px}.wh-cuu-queue-text{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--wh-app-muted)}"
].join("");

export function resolveDesktopShellListen(input: unknown = globalThis): DesktopShellListen | undefined {
  const target = input as DesktopShellGlobal;
  return target.__TAURI__?.event?.listen ?? target.__YQGL_MOCK_LISTEN__;
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
  now?: () => Date;
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
      message: desktopCuuNoticeMessage(shownCard),
      html: renderDesktopCuuNotice(shownCard)
    });
  };
  const bridge = createDesktopShellEventBridge({
    ...(input.now ? { now: input.now } : {}),
    onCuuCard(card) {
      emitCard(card);
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

  return {
    subscribed: true,
    async dispose() {
      for (const stop of unlisten.splice(0)) {
        stop();
      }
    }
  };
}

export function desktopCuuNoticeMessage(card: CuuCard) {
  return `Cuu：${card.title}`;
}

export function renderDesktopCuuNotice(card: CuuCard) {
  const chips = (card.chips ?? []).slice(0, 3).map(renderChip).join("");
  const actions = card.actions.slice(0, 3).map(renderAction).join("");
  const sprite = renderDesktopCuuSprite(card.motion);
  return `<section class="wh-cuu-card" data-cuu-card-id="${escapeHtml(card.id)}" data-cuu-state="${escapeHtml(card.state)}" role="status">
    <div class="wh-cuu-card-hero">
      ${sprite.html}
      <div class="wh-cuu-card-copy">
        <div class="wh-cuu-card-head">
          <div class="wh-cuu-card-kicker"><span class="wh-cuu-card-paw" aria-hidden="true"></span><span>Cuu</span></div>
          <span class="wh-cuu-card-state">${escapeHtml(labelForState(card.state))}</span>
        </div>
        <strong class="wh-cuu-card-title">${escapeHtml(card.title)}</strong>
        <p class="wh-cuu-card-message">${escapeHtml(card.message)}</p>
      </div>
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
    return {
      kind: "session-next-question",
      sessionId: decodeURIComponent(sessionMatch[1])
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

  return undefined;
}

export async function submitDesktopCuuAction(input: {
  client: Pick<WorkHubApiClient, "respondApproval" | "nextQuestion" | "searchKnowledge" | "useEvidenceForWorkItem">;
  action: DesktopCuuActionRequest;
  reasonMd?: string | undefined;
}): Promise<DesktopCuuActionResult> {
  if (input.action.kind === "approval-response") {
    if (input.action.decision === "deny" && !input.reasonMd?.trim()) {
      throw new Error("打回需要先选择一个原因。");
    }
    await input.client.respondApproval(input.action.approvalId, {
      decision: input.action.decision,
      ...(input.reasonMd ? { reason_md: input.reasonMd } : {}),
      remember: "once"
    });
    return {
      message: input.action.decision === "allow" ? "Cuu 已收到：这步已批准。" : "Cuu 已带着原因打回，会继续改。"
    };
  }

  if (input.action.kind === "knowledge-search") {
    const bubble = await input.client.searchKnowledge({
      ...(input.action.query ? { query: input.action.query } : {}),
      ...(input.action.run ? { run: input.action.run } : {})
    });
    const card = cardFromEvidenceBubble(bubble);
    return {
      message: "Cuu 找到了一组项目证据。",
      card
    };
  }

  if (input.action.kind === "use-evidence-for-task") {
    if (input.action.evidenceRefs.length === 0) {
      throw new Error("这张证据卡里没有可绑定的证据。");
    }
    const detail = await input.client.useEvidenceForWorkItem(input.action.workItemId, {
      ...(input.action.evidenceBubbleId ? { evidence_bubble_id: input.action.evidenceBubbleId } : {}),
      evidence_refs: input.action.evidenceRefs,
      note: "Cuu evidence card action: use_for_current_task"
    });
    return {
      message: "Cuu 已把这些证据放进当前任务。",
      card: cardFromWorkItemDetail(detail)
    };
  }

  const question = await input.client.nextQuestion(input.action.sessionId);
  return {
    message: `下一题：${question.title}`
  };
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

function labelForState(state: CuuCard["state"]) {
  switch (state) {
    case "idle":
      return "待命";
    case "thinking":
      return "思考中";
    case "asking_approval":
      return "等你点选";
    case "carrying_document":
      return "拿来变更";
    case "searching_evidence":
      return "找到证据";
    case "syncing_files":
      return "同步中";
    case "worried":
      return "需要留意";
    case "revision_requested":
      return "继续修改";
    case "celebrating":
      return "完成了";
    case "offline":
      return "离线";
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
