import type { LiveMetricWriter } from "./dirty.js";

export type WebLiveStreamTarget = {
  key: string;
  url: string;
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

export type WebLiveRefreshOutcome = "refreshed" | "dirty-deferred";

export type WebLiveRuntimeOptions = {
  eventTypes: string[];
  setMetric: LiveMetricWriter;
  onRefresh: (eventType: string, targetKey: string) => Promise<WebLiveRefreshOutcome>;
  onRefreshNotice: (outcome: WebLiveRefreshOutcome, eventType: string, targetKey: string) => void;
  onFatal: (error: unknown) => void;
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
};

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
  let liveEventCount = 0;
  let liveRefreshCount = 0;
  let liveEventSourceOpenCount = 0;
  let liveEventSourceCloseCount = 0;
  let liveEventSourceReuseCount = 0;
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
    if (liveRefreshTimer !== undefined) {
      return;
    }
    liveRefreshTimer = setTimeoutFn(() => {
      liveRefreshTimer = undefined;
      liveRefreshCount += 1;
      setMetric("r4LiveRefreshCount", liveRefreshCount);
      void options.onRefresh(eventType, targetKey)
        .then((outcome) => options.onRefreshNotice(outcome, eventType, targetKey))
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
      existing.target = target;
      liveEventSourceReuseCount += 1;
      setMetric("r4LiveLastReusedStream", target.key);
      updateLiveRuntimeMetrics();
      return;
    }
    const openedUrl = streamUrlWithCursor(target.url);
    const source = new EventSourceCtor(openedUrl, { withCredentials: true });
    liveEventSources.set(target.url, { source, target, openedUrl });
    liveEventSourceOpenCount += 1;
    setMetric("r4LiveLastOpenedStream", target.key);
    setMetric("r4LiveLastOpenedUrl", openedUrl);
    updateLiveRuntimeMetrics();
    source.addEventListener("connected", (event) => {
      noteLiveEventCursor(event, "connected");
      const connected = Number(String((globalThis.document?.documentElement.dataset.r4LiveConnectedCount ?? "0"))) + 1;
      setMetric("r4LiveConnectedCount", connected);
      setMetric("r4LiveLastConnectedStream", target.key);
    });
    source.addEventListener("error", () => {
      setMetric("r4LiveLastErrorStream", target.key);
    });
    for (const eventType of options.eventTypes) {
      source.addEventListener(eventType, (event) => {
        noteLiveEventCursor(event, "payload");
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
