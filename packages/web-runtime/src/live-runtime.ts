import type { LiveMetricWriter } from "./dirty.js";

export type WebLiveStreamTarget = {
  key: string;
  url: string;
  // R20 P2-06：可选的逐流订阅面覆写。缺省沿用全局 options.eventTypes；会话专属窄流用它订阅
  // conversation.* 事件，而不必把这些事件塞进全局订阅面（否则 me 流会在每个页面收到会话推送——
  // 正是 G-web 窄化纪律要避免的）。
  eventTypes?: string[] | undefined;
};

export type WebLiveEventSourceEvent = {
  data?: unknown;
  lastEventId?: string;
};

export type WebLiveEventSourceLike = {
  addEventListener: (eventName: string, handler: (event: WebLiveEventSourceEvent) => void) => void;
  close: () => void;
};

export type WebLiveEventSourceConstructor = new (
  url: string,
  init?: EventSourceInit
) => WebLiveEventSourceLike;

// MRG-24：新增 "skipped"——刷新决策方主动放弃本次重渲（如会话镜像正在翻历史分页 ?before=，
// 整页重渲会把滚动锚回最新页），由 onRefreshNotice 决定给不给手动刷新提示。
export type WebLiveRefreshOutcome = "refreshed" | "dirty-deferred" | "skipped";

export type WebLiveRuntimeOptions = {
  eventTypes: string[];
  setMetric: LiveMetricWriter;
  onRefresh: (eventType: string, targetKey: string) => Promise<WebLiveRefreshOutcome>;
  onRefreshNotice: (outcome: WebLiveRefreshOutcome, eventType: string, targetKey: string) => void;
  onFatal: (error: unknown) => void;
  // R5（慢网感知）：SSE 连错达阈值主动放弃重连时通知外壳——此前只写 metric，用户对「实时更新已断」零感知。
  onGiveUp?: ((streamKey: string) => void) | undefined;
  EventSourceCtor?: WebLiveEventSourceConstructor | undefined;
  debounceMs?: number | undefined;
  readCursor?: (() => string) | undefined;
  persistCursor?: ((eventId: string) => boolean) | undefined;
  locationHref?: string | undefined;
  setTimeoutFn?: ((handler: () => void, timeout: number) => number) | undefined;
  clearTimeoutFn?: ((handle: number) => void) | undefined;
};

type LiveEventSourceEntry = {
  source: WebLiveEventSourceLike;
  target: WebLiveStreamTarget;
  openedUrl: string;
  // rank10：连续错误计数(连上/收到事件即清零)。超阈值=会话很可能已失效——停止让浏览器对死流无限重连。
  errorStreak: number;
  // R20 P2-06：这条流累计触发 connected 的次数。首连=1（不补拉，刚拉过），>1 即重连——
  // INF-08 起所有流重连都触发全量对账（不再按 target 开关），补回断线窗口漏掉的增量事件。
  connectedCount: number;
};

// rank10：连续错误到此阈值(中间无任何成功连接/事件)即判定流已死、放弃自动重连。浏览器 EventSource
// 约每 3s 重试，8 次≈持续 ~24s+ 失败，足以区分瞬时抖动与会话失效，又不至于过早放弃。
const LIVE_STREAM_GIVE_UP_STREAK = 8;

export function eventIdFromPayload(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record["event_id"] === "string" && record["event_id"].length > 0) {
    return record["event_id"];
  }
  const nested = record["event"];
  if (nested && typeof nested === "object") {
    const nestedRecord = nested as Record<string, unknown>;
    if (typeof nestedRecord["event_id"] === "string" && nestedRecord["event_id"].length > 0) {
      return nestedRecord["event_id"];
    }
  }
  return undefined;
}

export function uniqueLiveStreamTargets(targets: WebLiveStreamTarget[]) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.url)) {
      return false;
    }
    seen.add(target.url);
    return true;
  });
}

export function createWebLiveRuntime(options: WebLiveRuntimeOptions) {
  const EventSourceCtor = options.EventSourceCtor
    ?? (globalThis as typeof globalThis & { EventSource?: WebLiveEventSourceConstructor }).EventSource;
  const setTimeoutFn = options.setTimeoutFn ?? ((handler, timeout) => window.setTimeout(handler, timeout));
  const clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => window.clearTimeout(handle));
  const liveEventSources = new Map<string, LiveEventSourceEntry>();
  const liveRefreshDebounceMs = options.debounceMs ?? 220;
  let liveRefreshTimer: number | undefined;
  // L#80/#87：去抖窗口内记住"最新"触发事件，定时器到点时用最新而非窗口里的第一条。
  let pendingRefreshEvent: { eventType: string; targetKey: string } | undefined;
  let liveEventCount = 0;
  let liveRefreshCount = 0;
  let liveEventSourceOpenCount = 0;
  let liveEventSourceCloseCount = 0;
  let liveEventSourceReuseCount = 0;
  // L#81：当前 last_event_id 是单一全局游标（跨 me/session/workitem/proposal/run 各流共享）。
  // resume 目前是尽力而为：后端尚未按 last_event_id 真正重放，所以即便游标精度不足也不会漏发——
  // 一旦后端支持按流重放，应改成 Map<streamKey, cursor> 的逐流游标。
  let liveLastEventId = options.readCursor?.() ?? "";

  const setMetric = options.setMetric;

  function updateLiveRuntimeMetrics() {
    setMetric("r4LiveRuntime", "app-level");
    setMetric("r4LiveActiveSourceCount", liveEventSources.size);
    setMetric("r4LiveSseOpenCount", liveEventSourceOpenCount);
    setMetric("r4LiveSseCloseCount", liveEventSourceCloseCount);
    setMetric("r4LiveSseReuseCount", liveEventSourceReuseCount);
    setMetric("r4LiveCursorStrategy", "sse-id-and-query-last_event_id");
    setMetric("r4LiveLastEventId", liveLastEventId);
  }

  function persistLiveLastEventId(eventId: string) {
    const persisted = options.persistCursor?.(eventId) ?? true;
    setMetric("r4LiveLastEventIdPersisted", persisted);
  }

  function streamUrlWithCursor(url: string) {
    if (!liveLastEventId) {
      setMetric("r4LiveLastOpenHadCursor", false);
      return url;
    }
    const parsed = new URL(url, options.locationHref ?? globalThis.location?.href ?? "http://workhub.local/");
    parsed.searchParams.set("last_event_id", liveLastEventId);
    setMetric("r4LiveLastOpenHadCursor", true);
    return /^https?:\/\//u.test(url) ? parsed.href : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  function noteLiveEventCursor(event: WebLiveEventSourceEvent, source: "sse-id" | "payload" | "connected") {
    const sseId = event.lastEventId;
    if (sseId) {
      liveLastEventId = sseId;
      persistLiveLastEventId(liveLastEventId);
      setMetric("r4LiveLastEventIdSource", "sse-id");
      updateLiveRuntimeMetrics();
      return;
    }
    try {
      const payload = typeof event.data === "string" ? JSON.parse(event.data) as unknown : event.data;
      const payloadEventId = eventIdFromPayload(payload);
      if (payloadEventId) {
        liveLastEventId = payloadEventId;
        persistLiveLastEventId(liveLastEventId);
        setMetric("r4LiveLastEventIdSource", source === "connected" ? "connected-payload" : "payload");
        updateLiveRuntimeMetrics();
      }
    } catch {
      setMetric("r4LiveLastEventIdSource", "unparseable");
    }
  }

  function closeLiveEventSource(url: string) {
    const entry = liveEventSources.get(url);
    if (!entry) {
      return;
    }
    entry.source.close();
    liveEventSources.delete(url);
    liveEventSourceCloseCount += 1;
    setMetric("r4LiveLastClosedStream", entry.target.key);
    updateLiveRuntimeMetrics();
  }

  function closeAllLiveEventSources() {
    for (const url of Array.from(liveEventSources.keys())) {
      closeLiveEventSource(url);
    }
  }

  function clearRefreshTimer() {
    if (liveRefreshTimer !== undefined) {
      clearTimeoutFn(liveRefreshTimer);
      liveRefreshTimer = undefined;
    }
  }

  function scheduleLiveRouteRefresh(eventType: string, targetKey: string) {
    liveEventCount += 1;
    setMetric("r4LiveEventCount", liveEventCount);
    setMetric("r4LiveLastEvent", eventType);
    setMetric("r4LiveLastStream", targetKey);
    pendingRefreshEvent = { eventType, targetKey };
    if (liveRefreshTimer !== undefined) {
      return;
    }
    liveRefreshTimer = setTimeoutFn(() => {
      liveRefreshTimer = undefined;
      liveRefreshCount += 1;
      setMetric("r4LiveRefreshCount", liveRefreshCount);
      const pending = pendingRefreshEvent ?? { eventType, targetKey };
      pendingRefreshEvent = undefined;
      void options.onRefresh(pending.eventType, pending.targetKey)
        .then((outcome) => options.onRefreshNotice(outcome, pending.eventType, pending.targetKey))
        .catch((error) => options.onFatal(error));
    }, liveRefreshDebounceMs);
  }

  function bindLiveEventSource(target: WebLiveStreamTarget) {
    if (!EventSourceCtor) {
      setMetric("r4LiveSseSupported", false);
      return;
    }
    setMetric("r4LiveSseSupported", true);
    const existing = liveEventSources.get(target.url);
    if (existing) {
      // C3（R21 审查）：同 URL 复用不能只换 entry.target 引用——下面 source.addEventListener 的每个
      // 回调闭包着创建时的 target（eventTypes/key），原地换引用不会让已挂的监听器跟着变。
      // 只有 key 与 eventTypes（内容）都没变时才真正安全复用；否则关旧流按新 target 重新订阅，
      // 避免"看起来复用了，实际还在用旧事件面/旧 key 记账"这种以后很难查的坑。
      const existingEventTypes = existing.target.eventTypes ?? options.eventTypes;
      const nextEventTypes = target.eventTypes ?? options.eventTypes;
      const sameEventTypes = existingEventTypes.length === nextEventTypes.length
        && existingEventTypes.every((type, index) => type === nextEventTypes[index]);
      if (existing.target.key === target.key && sameEventTypes) {
        existing.target = target;
        liveEventSourceReuseCount += 1;
        setMetric("r4LiveLastReusedStream", target.key);
        updateLiveRuntimeMetrics();
        return;
      }
      closeLiveEventSource(target.url);
    }
    const openedUrl = streamUrlWithCursor(target.url);
    const source = new EventSourceCtor(openedUrl, { withCredentials: true });
    const entry: LiveEventSourceEntry = { source, target, openedUrl, errorStreak: 0, connectedCount: 0 };
    liveEventSources.set(target.url, entry);
    liveEventSourceOpenCount += 1;
    setMetric("r4LiveLastOpenedStream", target.key);
    setMetric("r4LiveLastOpenedUrl", openedUrl);
    updateLiveRuntimeMetrics();
    source.addEventListener("connected", (event) => {
      noteLiveEventCursor(event, "connected");
      entry.errorStreak = 0; // 连上即清零错误计数。
      entry.connectedCount += 1;
      const connected = Number(String((globalThis.document?.documentElement.dataset.r4LiveConnectedCount ?? "0"))) + 1;
      setMetric("r4LiveConnectedCount", connected);
      setMetric("r4LiveLastConnectedStream", target.key);
      // INF-08：重连补拉无条件化（R20 P2-06 时只给会话镜像流开了 refreshOnReconnect 开关）。
      // 首连（connectedCount===1）刚由外壳全量拉过，不重复；第二次及以后的 connected 是断线重连——
      // 后端不回放断线窗口（sse/stream.ts 恒报 resume_mode:"fresh"），漏掉的增量事件由这次全量
      // 重渲对账补回。去抖窗口把多条流同时重连合并成一次拉取。
      if (entry.connectedCount > 1) {
        setMetric("r4LiveReconnectRefetchStream", entry.target.key);
        scheduleLiveRouteRefresh("reconnect", entry.target.key);
      }
    });
    source.addEventListener("error", () => {
      setMetric("r4LiveLastErrorStream", target.key);
      // rank10：浏览器原生 EventSource 会用同一个(可能已失效的)会话 cookie 无限自动重连——会话被吊销时
      // 静默死锤。连续错误累计到阈值(中间无任何 connected/事件)判定会话失效，主动关闭止损。
      entry.errorStreak += 1;
      setMetric("r4LiveErrorStreak", entry.errorStreak);
      if (entry.errorStreak >= LIVE_STREAM_GIVE_UP_STREAK) {
        // 主动关闭(停止浏览器对死流的无限自动重连)，并记一个可观测标志供外壳渲染「实时更新已断·刷新重连」。
        setMetric("r4LiveStreamGaveUp", target.key);
        closeLiveEventSource(target.url);
        options.onGiveUp?.(target.key);
      }
    });
    // R20 P2-06：逐流订阅面——会话专属窄流用 target.eventTypes 订阅 conversation.*，其余流沿用全局面。
    const listenEventTypes = target.eventTypes ?? options.eventTypes;
    for (const eventType of listenEventTypes) {
      source.addEventListener(eventType, (event) => {
        noteLiveEventCursor(event, "payload");
        entry.errorStreak = 0; // 收到任意事件即清零错误计数。
        scheduleLiveRouteRefresh(eventType, target.key);
      });
    }
  }

  function noteLiveStreamTargets(targets: WebLiveStreamTarget[]) {
    setMetric("r4LiveStreams", targets.map((target) => target.key).join(","));
    setMetric("r4LiveStreamCount", targets.length);
    updateLiveRuntimeMetrics();
  }

  function syncTargets(rawTargets: WebLiveStreamTarget[]) {
    const targets = uniqueLiveStreamTargets(rawTargets);
    noteLiveStreamTargets(targets);
    const nextUrls = new Set(targets.map((target) => target.url));
    for (const url of Array.from(liveEventSources.keys())) {
      if (!nextUrls.has(url)) {
        closeLiveEventSource(url);
      }
    }
    for (const target of targets) {
      bindLiveEventSource(target);
    }
    updateLiveRuntimeMetrics();
  }

  function snapshot() {
    return {
      activeSourceCount: liveEventSources.size,
      openCount: liveEventSourceOpenCount,
      closeCount: liveEventSourceCloseCount,
      reuseCount: liveEventSourceReuseCount,
      lastEventId: liveLastEventId
    };
  }

  updateLiveRuntimeMetrics();

  return {
    syncTargets,
    closeAllLiveEventSources,
    clearRefreshTimer,
    noteLiveEventCursor,
    streamUrlWithCursor,
    snapshot
  };
}
