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

test("R20 P2-06 live runtime honors a per-target eventTypes override (conversation stream subscribes to conversation.* without polluting the me stream)", async () => {
  FakeEventSource.instances = [];
  const metrics: Record<string, unknown> = {};
  const refreshes: Array<{ eventType: string; targetKey: string }> = [];
  // 延迟型定时器队列——比「立即执行」的假 setTimeout 更贴近生产：先拿到 handle，稍后 flush 时才跑
  // handler，去抖窗口的 set/clear 顺序才正确（立即执行版会把 liveRefreshTimer 残留成非 undefined）。
  let pendingTimer: (() => void) | undefined;
  const flushTimer = async () => {
    const handler = pendingTimer;
    pendingTimer = undefined;
    handler?.();
    await Promise.resolve();
  };
  const runtime = createWebLiveRuntime({
    // 全局订阅面刻意排除 conversation.*（G-web 窄化纪律）——me 流不该收会话推送。
    eventTypes: ["proposal.merged"],
    EventSourceCtor: FakeEventSource,
    locationHref: "http://workhub.local/conversations/c-1",
    readCursor: () => "",
    persistCursor: () => true,
    setMetric: (key, value) => {
      metrics[key] = value;
    },
    setTimeoutFn: (handler) => {
      pendingTimer = handler;
      return 1;
    },
    clearTimeoutFn: () => {
      pendingTimer = undefined;
    },
    onRefresh: async (eventType, targetKey) => {
      refreshes.push({ eventType, targetKey });
      return "refreshed";
    },
    onRefreshNotice: () => undefined,
    onFatal: (error) => {
      throw error instanceof Error ? error : new Error(String(error));
    }
  });

  runtime.syncTargets([
    { key: "me", url: "/api/push/stream/me" },
    {
      key: "conversation",
      url: "/api/push/stream/conversation/c-1",
      eventTypes: ["conversation.message.created"],
      refreshOnReconnect: true
    }
  ]);

  const meSource = FakeEventSource.instances.find((s) => s.url.startsWith("/api/push/stream/me"));
  const convSource = FakeEventSource.instances.find((s) => s.url.startsWith("/api/push/stream/conversation/"));
  assert.ok(meSource, "me stream opened");
  assert.ok(convSource, "conversation stream opened");

  // me 流没有注册 conversation.* 监听（只有全局 eventTypes）——会话事件到 me 流不触发刷新。
  assert.equal(meSource.listeners.has("conversation.message.created"), false, "me stream must not listen for conversation events");
  // 会话专属流按 per-target eventTypes 注册了 conversation.message.created 监听。
  assert.equal(convSource.listeners.has("conversation.message.created"), true, "conversation stream must subscribe to conversation.message.created");

  // 重复/乱序的同一批增量事件被去抖窗口合并成一次全量拉取——幂等（全量拉取本身即服务端权威、按 seq 排序）。
  convSource.emit("conversation.message.created", { data: JSON.stringify({ event_id: "evt-conv-1" }) });
  convSource.emit("conversation.message.created", { data: JSON.stringify({ event_id: "evt-conv-1" }) });
  await flushTimer();
  assert.deepEqual(refreshes, [{ eventType: "conversation.message.created", targetKey: "conversation" }], "a new conversation message triggers a single (deduped) full route refetch");

  // 重连补拉：第一次 connected 不刷（首连即刚拉过），断线后第二次 connected → 补拉全量对账。
  convSource.emit("connected", { data: JSON.stringify({ event_id: "evt-conv-1" }) });
  await flushTimer();
  assert.equal(refreshes.length, 1, "first connect does not trigger a redundant refetch");
  convSource.emit("connected", { data: JSON.stringify({ event_id: "evt-conv-1" }) });
  await flushTimer();
  assert.deepEqual(
    refreshes[1],
    { eventType: "reconnect", targetKey: "conversation" },
    "a reconnect re-pulls the full page so events lost during the disconnect window are recovered"
  );

  // 切到另一个会话：旧会话流关闭（不泄漏），新会话流打开。
  runtime.syncTargets([
    { key: "me", url: "/api/push/stream/me" },
    {
      key: "conversation",
      url: "/api/push/stream/conversation/c-2",
      eventTypes: ["conversation.message.created"],
      refreshOnReconnect: true
    }
  ]);
  assert.equal(convSource.closed, true, "leaving conversation c-1 closes its stream (no leak)");
});

test("C3（R21 审查）same-URL syncTargets with a changed eventTypes override rebinds instead of reusing the stale closure", async () => {
  FakeEventSource.instances = [];
  const metrics: Record<string, unknown> = {};
  const refreshes: Array<{ eventType: string; targetKey: string }> = [];
  let pendingTimer: (() => void) | undefined;
  const flushTimer = async () => {
    const handler = pendingTimer;
    pendingTimer = undefined;
    handler?.();
    await Promise.resolve();
  };
  const runtime = createWebLiveRuntime({
    eventTypes: ["proposal.merged"],
    EventSourceCtor: FakeEventSource,
    locationHref: "http://workhub.local/conversations/c-1",
    readCursor: () => "",
    persistCursor: () => true,
    setMetric: (key, value) => {
      metrics[key] = value;
    },
    setTimeoutFn: (handler) => {
      pendingTimer = handler;
      return 1;
    },
    clearTimeoutFn: () => {
      pendingTimer = undefined;
    },
    onRefresh: async (eventType, targetKey) => {
      refreshes.push({ eventType, targetKey });
      return "refreshed";
    },
    onRefreshNotice: () => undefined,
    onFatal: (error) => {
      throw error instanceof Error ? error : new Error(String(error));
    }
  });

  // 首次订阅：同一个 URL，只订 conversation.message.created。
  runtime.syncTargets([
    { key: "conversation", url: "/api/push/stream/conversation/shared", eventTypes: ["conversation.message.created"] }
  ]);
  const firstSource = FakeEventSource.instances[0];
  assert.ok(firstSource, "first stream opened");
  assert.equal(firstSource.listeners.has("conversation.message.created"), true);

  // 第二次 syncTargets：同一个 URL，但 eventTypes 换了（比如切到了别的会话订阅面）。
  // 复用分支若只换 entry.target 引用，firstSource 上已挂的监听器仍是旧闭包——新事件类型永远收不到。
  runtime.syncTargets([
    { key: "conversation", url: "/api/push/stream/conversation/shared", eventTypes: ["conversation.message.updated"] }
  ]);

  assert.equal(firstSource.closed, true, "the stale stream must be closed rather than silently reused");
  assert.equal(FakeEventSource.instances.length, 2, "a fresh EventSource is opened for the new eventTypes");
  const secondSource = FakeEventSource.instances[1];
  assert.ok(secondSource);
  assert.equal(secondSource.listeners.has("conversation.message.updated"), true, "the new stream subscribes to the new eventTypes");
  assert.equal(secondSource.listeners.has("conversation.message.created"), false, "the new stream must not carry over the stale eventTypes");

  // 新流按新事件面正确触发刷新（证明监听器不是旧闭包）。
  secondSource.emit("conversation.message.updated", { data: JSON.stringify({ event_id: "evt-c3-1" }) });
  await flushTimer();
  assert.deepEqual(refreshes, [{ eventType: "conversation.message.updated", targetKey: "conversation" }]);

  // 再来一次 syncTargets，key 与 eventTypes 都没变——这次才是真复用，不应再开新流。
  runtime.syncTargets([
    { key: "conversation", url: "/api/push/stream/conversation/shared", eventTypes: ["conversation.message.updated"] }
  ]);
  assert.equal(FakeEventSource.instances.length, 2, "an unchanged target is still safely reused");
  assert.equal(secondSource.closed, false);
  assert.equal(metrics.r4LiveSseReuseCount, 1);
});

test("rank10 live runtime gives up on a dead stream after a consecutive-error streak (and a real event resets it)", () => {
  FakeEventSource.instances = [];
  const metrics: Record<string, unknown> = {};
  const runtime = createWebLiveRuntime({
    eventTypes: ["proposal.merged"],
    EventSourceCtor: FakeEventSource,
    locationHref: "http://workhub.local/proposals/p-1",
    readCursor: () => "",
    persistCursor: () => true,
    setMetric: (key, value) => {
      metrics[key] = value;
    },
    setTimeoutFn: (handler) => {
      handler();
      return 1;
    },
    clearTimeoutFn: () => undefined,
    onRefresh: async () => "refreshed",
    onRefreshNotice: () => undefined,
    onFatal: (error) => {
      throw error instanceof Error ? error : new Error(String(error));
    }
  });

  runtime.syncTargets([{ key: "me", url: "/api/push/stream/me" }]);
  const src = FakeEventSource.instances[0];
  assert.ok(src);

  // 7 次连续错误：还没到阈值，不放弃（浏览器继续自动重连）。
  for (let i = 0; i < 7; i += 1) {
    src.emit("error", { data: "" });
  }
  assert.equal(src.closed, false, "below the streak threshold the stream stays open");

  // 来了一个真实事件 → 错误连击清零。
  src.emit("proposal.merged", { data: JSON.stringify({ event_id: "evt-reset" }) });
  for (let i = 0; i < 7; i += 1) {
    src.emit("error", { data: "" });
  }
  assert.equal(src.closed, false, "a real event resets the streak so 7 more errors still don't give up");

  // 第 8 次连续错误 → 判定流已死，主动关闭并记可观测标志。
  src.emit("error", { data: "" });
  assert.equal(src.closed, true, "8 consecutive errors closes the dead stream (no infinite silent retry)");
  assert.equal(metrics.r4LiveStreamGaveUp, "me");
});
