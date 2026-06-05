import { cuuStates, type AttentionItem, type CuuState, type WorkHubEvent } from "@workhub/contracts";
import { cardFromEvent, type CuuCard } from "@workhub/cuu";

export type DesktopShellPushPayload = {
  event: string;
  data: string;
  stream_kind: string;
  stream_path: string;
};

export type DesktopShellSseStatus = "connecting" | "open" | "retrying" | "closed";

export type DesktopShellSseStatusPayload = {
  stream_kind: string;
  stream_path: string;
  state: DesktopShellSseStatus;
  message?: string;
};

export type DesktopShellBridgeEvent = {
  shell: DesktopShellPushPayload;
  event: WorkHubEvent<unknown>;
  card?: CuuCard;
};

export type DesktopShellEventBridge = {
  handlePushPayload: (input: unknown) => DesktopShellBridgeEvent | undefined;
  handleSseStatusPayload: (input: unknown) => CuuCard | undefined;
};

type DesktopShellBridgeOptions = {
  now?: () => Date;
  onEvent?: (event: DesktopShellBridgeEvent) => void;
  onCuuCard?: (card: CuuCard) => void;
};

const passivePushEvents = new Set(["connected", "message"]);
const cuuStateSet = new Set<string>(cuuStates);

export function parseDesktopShellPushPayload(input: unknown): DesktopShellPushPayload | undefined {
  const record = asRecord(input);
  if (!record) {
    return undefined;
  }

  const event = stringField(record, "event");
  const data = stringField(record, "data");
  const streamKind = stringField(record, "stream_kind");
  const streamPath = stringField(record, "stream_path");
  if (!event || data === undefined || !streamKind || !streamPath) {
    return undefined;
  }

  return {
    event,
    data,
    stream_kind: streamKind,
    stream_path: streamPath
  };
}

export function parseDesktopShellSseStatusPayload(input: unknown): DesktopShellSseStatusPayload | undefined {
  const record = asRecord(input);
  if (!record) {
    return undefined;
  }

  const streamKind = stringField(record, "stream_kind");
  const streamPath = stringField(record, "stream_path");
  const state = stringField(record, "state");
  if (!streamKind || !streamPath || !isDesktopShellSseStatus(state)) {
    return undefined;
  }

  const message = stringField(record, "message");
  return {
    stream_kind: streamKind,
    stream_path: streamPath,
    state,
    ...(message ? { message } : {})
  };
}

export function workHubEventFromDesktopShellPush(
  payload: DesktopShellPushPayload,
  options: { now?: () => Date } = {}
): WorkHubEvent<unknown> {
  const data = parseJsonOrRaw(payload.data);
  const embedded = asWorkHubEvent(data);
  if (embedded) {
    return embedded;
  }

  const dataRecord = asRecord(data);
  const topic = stringField(dataRecord, "topic") ?? topicFromStreamPath(payload.stream_path, payload.stream_kind);
  const event: WorkHubEvent<unknown> = {
    event_id: stringField(dataRecord, "event_id") ?? eventIdFromShellPayload(payload, topic),
    type: payload.event,
    topic,
    ts: stringField(dataRecord, "ts") ?? (options.now ?? (() => new Date()))().toISOString(),
    data
  };

  copyOptionalString(event, dataRecord, "work_item_id");
  copyOptionalString(event, dataRecord, "project_id");
  copyOptionalString(event, dataRecord, "session_id");
  copyOptionalString(event, dataRecord, "run_id");
  copyOptionalString(event, dataRecord, "proposal_id");

  const previewText =
    stringField(dataRecord, "preview_text") ??
    stringField(dataRecord, "summary_text") ??
    stringField(dataRecord, "message") ??
    stringField(dataRecord, "title");
  if (previewText) {
    event.preview_text = previewText.slice(0, 200);
  }

  const cuuState = stringField(dataRecord, "cuu_state");
  if (cuuStateSet.has(cuuState ?? "")) {
    event.cuu_state = cuuState as CuuState;
  }

  const attention = recordField(dataRecord, "attention");
  if (attention) {
    event.attention = attention as AttentionItem;
  }

  return event;
}

export function desktopCuuCardFromShellPush(
  payload: DesktopShellPushPayload,
  options: { now?: () => Date } = {}
): CuuCard | undefined {
  if (passivePushEvents.has(payload.event)) {
    return undefined;
  }
  return cardFromEvent(workHubEventFromDesktopShellPush(payload, options));
}

export function desktopCuuCardFromShellSseStatus(
  payload: DesktopShellSseStatusPayload,
  options: { now?: () => Date } = {}
): CuuCard | undefined {
  if (payload.state === "connecting" || payload.state === "open") {
    return undefined;
  }

  const retrying = payload.state === "retrying";
  return cardFromEvent({
    event_id: `sse-status:${payload.stream_kind}:${payload.state}`,
    type: "sse.status",
    topic: topicFromStreamPath(payload.stream_path, payload.stream_kind),
    ts: (options.now ?? (() => new Date()))().toISOString(),
    preview_text: payload.message ?? (retrying ? "daemon 连接不稳定，Cuu 正在重试。" : "daemon 连接已断开，Cuu 正在等它回来。"),
    cuu_state: "offline",
    data: payload
  });
}

export function createDesktopShellEventBridge(options: DesktopShellBridgeOptions = {}): DesktopShellEventBridge {
  return {
    handlePushPayload(input) {
      const shell = parseDesktopShellPushPayload(input);
      if (!shell) {
        return undefined;
      }
      const event = workHubEventFromDesktopShellPush(shell, options);
      const card = desktopCuuCardFromShellPush(shell, options);
      const bridged: DesktopShellBridgeEvent = {
        shell,
        event,
        ...(card ? { card } : {})
      };
      options.onEvent?.(bridged);
      if (card) {
        options.onCuuCard?.(card);
      }
      return bridged;
    },
    handleSseStatusPayload(input) {
      const payload = parseDesktopShellSseStatusPayload(input);
      if (!payload) {
        return undefined;
      }
      const card = desktopCuuCardFromShellSseStatus(payload, options);
      if (card) {
        options.onCuuCard?.(card);
      }
      return card;
    }
  };
}

function parseJsonOrRaw(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return input;
  }
}

function asWorkHubEvent(input: unknown): WorkHubEvent<unknown> | undefined {
  const record = asRecord(input);
  if (!record) {
    return undefined;
  }
  const eventId = stringField(record, "event_id");
  const type = stringField(record, "type");
  const topic = stringField(record, "topic");
  const ts = stringField(record, "ts");
  if (!eventId || !type || !topic || !ts || !("data" in record)) {
    return undefined;
  }

  const event: WorkHubEvent<unknown> = {
    event_id: eventId,
    type,
    topic,
    ts,
    data: record.data
  };
  copyOptionalString(event, record, "work_item_id");
  copyOptionalString(event, record, "project_id");
  copyOptionalString(event, record, "session_id");
  copyOptionalString(event, record, "run_id");
  copyOptionalString(event, record, "proposal_id");

  const previewText = stringField(record, "preview_text");
  if (previewText) {
    event.preview_text = previewText;
  }
  const cuuState = stringField(record, "cuu_state");
  if (cuuStateSet.has(cuuState ?? "")) {
    event.cuu_state = cuuState as CuuState;
  }
  const attention = recordField(record, "attention");
  if (attention) {
    event.attention = attention as AttentionItem;
  }
  return event;
}

function copyOptionalString(event: WorkHubEvent<unknown>, record: Record<string, unknown> | undefined, key: keyof WorkHubEvent<unknown>) {
  const value = stringField(record, key);
  if (!value) {
    return;
  }
  Object.assign(event, { [key]: value });
}

function eventIdFromShellPayload(payload: DesktopShellPushPayload, topic: string) {
  return `shell:${payload.stream_kind}:${payload.event}:${topic}`;
}

function topicFromStreamPath(streamPath: string, streamKind: string) {
  const trimmed = streamPath.replace(/\/$/u, "");
  const match = /\/api\/push\/stream\/(workitem|req|run|session|proposal)\/([^/]+)$/u.exec(trimmed);
  if (match?.[1] && match[2]) {
    const kind = match[1] === "req" ? "workitem" : match[1];
    return `${kind}:${decodeURIComponent(match[2])}`;
  }
  if (trimmed.endsWith("/api/push/stream/me")) {
    return "user:me";
  }
  if (trimmed.endsWith("/api/push/stream")) {
    return "all";
  }
  return `stream:${streamKind}`;
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;
}

function recordField(record: Record<string, unknown> | undefined, key: string) {
  return asRecord(record?.[key]);
}

function stringField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function isDesktopShellSseStatus(value: string | undefined): value is DesktopShellSseStatus {
  return value === "connecting" || value === "open" || value === "retrying" || value === "closed";
}
