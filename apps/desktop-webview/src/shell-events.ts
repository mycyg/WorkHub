import { cuuStates, type AttentionItem, type CuuState, type WorkHubEvent } from "@workhub/contracts";
import { cardFromEvent, cuuMotionForState, cuuT, type CuuCard, type CuuLocaleOptions } from "@workhub/cuu";

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

// R25-Q：壳层"连接状态单一真相"（client-tauri/src-tauri/src/sse.rs 的 ShellConnectionState /
// ShellConnectionChangedPayload，事件名 "workhub-connection-changed"）——三窗（工作台头部状态词/
// 主窗聚焦盒顶部细条/桌宠离线卡）只从这一个事件取状态，不再各自从 DesktopShellSseStatusPayload
// （per-subscription 的协议粒度原始信号）猜一遍。字段形状必须与 Rust 侧的 serde 输出逐字对齐——
// 改任一边都要同步看另一边（Rust 单测 sse.rs 的 connection_payload_shape_* 钉死了序列化形状）。
export type DesktopShellConnectionState = "connected" | "reconnecting" | "offline";

export type DesktopShellConnectionChangedPayload = {
  state: DesktopShellConnectionState;
  server_url: string;
  since_ms: number;
  attempt: number;
};

export type DesktopShellWindowControlPlan = {
  label: string;
  action: "show" | "hide" | "toggle" | "focus" | "show_and_focus";
  source: "tray" | "deep_link" | "cuu_bubble" | "setting" | "system_notification" | "startup";
  focus: boolean;
  reason: string;
  route?: string;
};

export type DesktopShellSystemNotificationPlan = {
  id: string;
  event: string;
  title: string;
  body: string;
  urgency: "high" | "urgent";
  route: string;
  windowControl: DesktopShellWindowControlPlan;
  streamKind: string;
  streamPath: string;
};

export type DesktopShellNavigatePayload = {
  route: string;
  // 壳层（window_controls.rs ShellNavigatePayload）自 S3-#6 起随导航一起发的来源与原因：
  // 谁发起了这次导航（tray / deep_link / system_notification / …）、对应哪条窗口控制计划
  // （focus-main-route / show-main / …）。老壳层只发裸 route 字符串，故两者都是可选的。
  source?: string;
  reason?: string;
};

export type DesktopShellBridgeEvent = {
  shell: DesktopShellPushPayload;
  event: WorkHubEvent<unknown>;
  card?: CuuCard;
};

export type DesktopShellEventBridge = {
  handlePushPayload: (input: unknown) => DesktopShellBridgeEvent | undefined;
  handleSseStatusPayload: (input: unknown) => CuuCard | undefined;
  handleSystemNotificationPayload: (input: unknown) => DesktopShellSystemNotificationPlan | undefined;
};

type DesktopShellBridgeOptions = CuuLocaleOptions & {
  now?: () => Date;
  onEvent?: (event: DesktopShellBridgeEvent) => void;
  onCuuCard?: (card: CuuCard) => void;
  onSystemNotification?: (plan: DesktopShellSystemNotificationPlan) => void;
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

export function parseDesktopShellSystemNotificationPlan(input: unknown): DesktopShellSystemNotificationPlan | undefined {
  const record = asRecord(input);
  if (!record) {
    return undefined;
  }

  const id = stringField(record, "id");
  const event = stringField(record, "event");
  const title = stringField(record, "title");
  const body = stringField(record, "body");
  const urgency = stringField(record, "urgency");
  const route = stringField(record, "route");
  const streamKind = stringFieldAny(record, ["streamKind", "stream_kind"]);
  const streamPath = stringFieldAny(record, ["streamPath", "stream_path"]);
  const windowControl = parseDesktopShellWindowControlPlan(recordFieldAny(record, ["windowControl", "window_control"]));
  if (
    !id ||
    !event ||
    !title ||
    !body ||
    !isDesktopShellSystemNotificationUrgency(urgency) ||
    !route ||
    !streamKind ||
    !streamPath ||
    !windowControl
  ) {
    return undefined;
  }

  return {
    id,
    event,
    title,
    body,
    urgency,
    route,
    windowControl,
    streamKind,
    streamPath
  };
}

export function parseDesktopShellNavigatePayload(input: unknown): DesktopShellNavigatePayload | undefined {
  const record = typeof input === "string" ? undefined : asRecord(input);
  const route = typeof input === "string" ? input : stringFieldAny(record, ["route", "path"]);
  const safeRoute = safeDesktopShellRoute(route);
  if (!safeRoute) {
    return undefined;
  }
  const source = stringField(record, "source");
  const reason = stringField(record, "reason");
  return {
    route: safeRoute,
    ...(source ? { source } : {}),
    ...(reason ? { reason } : {})
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
  options: { now?: () => Date } & CuuLocaleOptions = {}
): CuuCard | undefined {
  if (passivePushEvents.has(payload.event)) {
    return undefined;
  }
  return cardFromEvent(workHubEventFromDesktopShellPush(payload, options), options);
}

export function desktopCuuCardFromShellSseStatus(
  payload: DesktopShellSseStatusPayload,
  options: { now?: () => Date } & CuuLocaleOptions = {}
): CuuCard | undefined {
  if (payload.state === "connecting" || payload.state === "open") {
    return undefined;
  }

  const retrying = payload.state === "retrying";
  const id = `sse-status:${payload.stream_kind}:${payload.state}`;
  return {
    id,
    kind: "offline",
    state: "offline",
    motion: cuuMotionForState("offline"),
    title: retrying ? cuuT(options.locale, "offline.retryingTitle") : cuuT(options.locale, "offline.closedTitle"),
    message: retrying ? cuuT(options.locale, "offline.retryingMessage") : cuuT(options.locale, "offline.closedMessage"),
    priority: "normal",
    chips: [
      {
        id: payload.state,
        label: retrying ? cuuT(options.locale, "offline.retryingChip") : cuuT(options.locale, "offline.closedChip"),
        // 离线/重连只是状态提示，用中性 chip（细灰描边），不上黄色 warning 调，和聚焦盒玻璃统一。
        tone: "neutral"
      }
    ],
    actions: [],
    payload_ref: {
      entity_type: "event",
      entity_id: id
    },
    source: {
      entity_type: "event",
      entity_id: payload.stream_path
    },
    created_at: (options.now ?? (() => new Date()))().toISOString()
  };
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
    },
    handleSystemNotificationPayload(input) {
      const plan = parseDesktopShellSystemNotificationPlan(input);
      if (!plan) {
        return undefined;
      }
      options.onSystemNotification?.(plan);
      return plan;
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

function safeDesktopShellRoute(route: string | undefined) {
  const trimmed = route?.trim();
  if (
    !trimmed ||
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    trimmed.includes("\n") ||
    trimmed.includes("\r")
  ) {
    return undefined;
  }
  return trimmed;
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;
}

function recordField(record: Record<string, unknown> | undefined, key: string) {
  return asRecord(record?.[key]);
}

function recordFieldAny(record: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = recordField(record, key);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function stringFieldAny(record: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = stringField(record, key);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function booleanField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isDesktopShellSseStatus(value: string | undefined): value is DesktopShellSseStatus {
  return value === "connecting" || value === "open" || value === "retrying" || value === "closed";
}

function isDesktopShellConnectionState(value: string | undefined): value is DesktopShellConnectionState {
  return value === "connected" || value === "reconnecting" || value === "offline";
}

// R25-Q：三窗（browser.ts/workbench/boot.ts/pet-surface.ts）boot 时的 get_connection_state 拉取与
// 运行期的 workhub-connection-changed 广播共用同一个契约，都经这个函数解析——防守式：任一字段缺失/
// 类型不对就整体判 undefined，调用方保持当前状态不动（不拿半份数据渲一个断言错误的连接横幅）。
export function parseDesktopShellConnectionChangedPayload(input: unknown): DesktopShellConnectionChangedPayload | undefined {
  const record = asRecord(input);
  if (!record) {
    return undefined;
  }
  const state = stringField(record, "state");
  const serverUrl = stringField(record, "server_url");
  const sinceMs = numberField(record, "since_ms");
  const attempt = numberField(record, "attempt");
  if (!isDesktopShellConnectionState(state) || serverUrl === undefined || sinceMs === undefined || attempt === undefined) {
    return undefined;
  }
  return {
    state,
    server_url: serverUrl,
    since_ms: sinceMs,
    attempt
  };
}

function parseDesktopShellWindowControlPlan(input: unknown): DesktopShellWindowControlPlan | undefined {
  const record = asRecord(input);
  if (!record) {
    return undefined;
  }

  const label = stringField(record, "label");
  const action = stringField(record, "action");
  const source = stringField(record, "source");
  const focus = booleanField(record, "focus");
  const reason = stringField(record, "reason");
  if (
    !label ||
    !isDesktopShellWindowControlAction(action) ||
    !isDesktopShellWindowControlSource(source) ||
    focus === undefined ||
    !reason
  ) {
    return undefined;
  }

  const route = stringField(record, "route");
  return {
    label,
    action,
    source,
    focus,
    reason,
    ...(route ? { route } : {})
  };
}

function isDesktopShellWindowControlAction(value: string | undefined): value is DesktopShellWindowControlPlan["action"] {
  return value === "show" || value === "hide" || value === "toggle" || value === "focus" || value === "show_and_focus";
}

function isDesktopShellWindowControlSource(value: string | undefined): value is DesktopShellWindowControlPlan["source"] {
  return value === "tray" || value === "deep_link" || value === "cuu_bubble" || value === "setting" || value === "system_notification" || value === "startup";
}

function isDesktopShellSystemNotificationUrgency(
  value: string | undefined
): value is DesktopShellSystemNotificationPlan["urgency"] {
  return value === "high" || value === "urgent";
}
