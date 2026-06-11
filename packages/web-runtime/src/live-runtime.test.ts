import assert from "node:assert/strict";
import test from "node:test";

import { createWebLiveRuntime, eventIdFromPayload, uniqueLiveStreamTargets, type WebLiveEventSourceEvent } from "./live-runtime.js";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Array<(event: WebLiveEventSourceEvent) => void>>();
  closed = false;

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit
  ) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(eventName: string, handler: (event: WebLiveEventSourceEvent) => void) {
    const bucket = this.listeners.get(eventName) ?? [];
    bucket.push(handler);
    this.listeners.set(eventName, bucket);
  }

  emit(eventName: string, event: WebLiveEventSourceEvent) {
    for (const handler of this.listeners.get(eventName) ?? []) {
      handler(event);
    }
  }

  close() {
    this.closed = true;
  }
}

test("R4.21 live runtime extracts event ids from payload shapes", () => {
  assert.equal(eventIdFromPayload({ event_id: "evt-1" }), "evt-1");
  assert.equal(eventIdFromPayload({ event: { event_id: "evt-2" } }), "evt-2");
  assert.equal(eventIdFromPayload({ event: {} }), undefined);
});

test("R4.21 live runtime de-duplicates stream targets by URL", () => {
  assert.deepEqual(uniqueLiveStreamTargets([
    { key: "me", url: "/api/push/stream/me" },
    { key: "me-again", url: "/api/push/stream/me" },
    { key: "proposal", url: "/api/push/stream/proposal/p-1" }
  ]), [
    { key: "me", url: "/api/push/stream/me" },
    { key: "proposal", url: "/api/push/stream/proposal/p-1" }
  ]);
});

test("R4.21 live runtime reuses EventSource and persists cursor", async () => {
  FakeEventSource.instances = [];
  const metrics: Record<string, unknown> = {};
  let persistedCursor = "";
  const refreshes: Array<{ eventType: string; targetKey: string }> = [];
  const notices: Array<{ outcome: string; eventType: string; targetKey: string }> = [];
  const runtime = createWebLiveRuntime({
    eventTypes: ["proposal.merged"],
    EventSourceCtor: FakeEventSource,
    locationHref: "http://workhub.local/proposals/p-1",
    readCursor: () => persistedCursor,
    persistCursor: (eventId) => {
      persistedCursor = eventId;
      return true;
    },
    setMetric: (key, value) => {
      metrics[key] = value;
    },
    setTimeoutFn: (handler) => {
      handler();
      return 1;
    },
    clearTimeoutFn: () => undefined,
    onRefresh: async (eventType, targetKey) => {
      refreshes.push({ eventType, targetKey });
      return "refreshed";
    },
    onRefreshNotice: (outcome, eventType, targetKey) => {
      notices.push({ outcome, eventType, targetKey });
    },
    onFatal: (error) => {
      throw error instanceof Error ? error : new Error(String(error));
    }
  });

  runtime.syncTargets([{ key: "proposal", url: "/api/push/stream/proposal/p-1" }]);
  assert.equal(FakeEventSource.instances.length, 1);
  assert.equal(FakeEventSource.instances[0]?.url, "/api/push/stream/proposal/p-1");
  assert.equal(FakeEventSource.instances[0]?.init?.withCredentials, true);

  FakeEventSource.instances[0]?.emit("proposal.merged", { data: JSON.stringify({ event_id: "evt-r4-21" }) });
  await Promise.resolve();
  assert.equal(persistedCursor, "evt-r4-21");
  assert.equal(metrics.r4LiveLastEventId, "evt-r4-21");
  assert.deepEqual(refreshes, [{ eventType: "proposal.merged", targetKey: "proposal" }]);
  assert.deepEqual(notices, [{ outcome: "refreshed", eventType: "proposal.merged", targetKey: "proposal" }]);

  runtime.syncTargets([{ key: "proposal", url: "/api/push/stream/proposal/p-1" }]);
  assert.equal(FakeEventSource.instances.length, 1);
  assert.equal(metrics.r4LiveSseReuseCount, 1);

  runtime.syncTargets([{ key: "me", url: "/api/push/stream/me" }]);
  assert.equal(FakeEventSource.instances[0]?.closed, true);
  assert.equal(FakeEventSource.instances[1]?.url, "/api/push/stream/me?last_event_id=evt-r4-21");
  assert.equal(metrics.r4LiveLastOpenHadCursor, true);
});
