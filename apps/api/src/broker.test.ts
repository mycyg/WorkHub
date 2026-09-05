import assert from "node:assert/strict";
import test from "node:test";

import { InProcessPushBus } from "./broker/memory.js";
import {
  InMemoryPresenceStore,
  ONLINE_TTL_SECONDS,
  RedisPresenceStore,
  type RedisPresenceClient,
  type RedisPresenceClientFactory,
  type RedisPresenceMulti,
  type RedisSetOptions
} from "./broker/presence.js";
import { RedisPushBus, type RedisPubSubClient, type RedisPubSubClientFactory } from "./broker/redis.js";
import type { PushEvent } from "@workhub/events";
import { captureStdoutLines } from "@workhub/tools/test-support";

test("in-process bus preserves per-subscriber queue delivery", async () => {
  const bus = new InProcessPushBus();
  const subscription = await bus.subscribe("workitem:w1");

  await bus.publish("workitem:w1", "agent_run.step", { step: 1 });

  const first = await subscription[Symbol.asyncIterator]().next();
  assert.equal(first.done, false);
  assert.deepEqual(first.value, {
    topic: "workitem:w1",
    type: "agent_run.step",
    data: { step: 1 }
  });

  await bus.unsubscribe("workitem:w1", subscription);
});

test("local queue keeps the old maxsize/drop-slow-subscriber backpressure rule", async () => {
  const bus = new InProcessPushBus(2);
  const subscription = await bus.subscribe("run:r1");
  const iterator = subscription[Symbol.asyncIterator]();

  await bus.publish("run:r1", "agent_run.step", { step: 1 });
  await bus.publish("run:r1", "agent_run.step", { step: 2 });
  await bus.publish("run:r1", "agent_run.step", { step: 3 });

  assert.equal(((await iterator.next()).value as PushEvent<{ step: number }>).data.step, 1);
  assert.equal(((await iterator.next()).value as PushEvent<{ step: number }>).data.step, 2);
  assert.equal(await nextOrTimeout(iterator, 20), "timeout");

  await bus.unsubscribe("run:r1", subscription);
});

test("INF-12: an event dropped under backpressure emits a structured warn and bumps the drop counter", async () => {
  const bus = new InProcessPushBus(2);
  const subscription = await bus.subscribe("run:r-drop"); // 订阅但不消费
  // 捕获且透传（见 @workhub/tools/test-support）：整段替换 process.stdout.write 会吞掉报告器的 TAP 行。
  const { lines } = await captureStdoutLines(async () => {
    await bus.publish("run:r-drop", "agent_run.step", { step: 1 });
    await bus.publish("run:r-drop", "agent_run.step", { step: 2 });
    await bus.publish("run:r-drop", "agent_run.step", { step: 3 }); // 满队列 → drop → 结构化 warn + 计数
  });
  const warnLines = lines
    .map((line) => {
      try {
        return JSON.parse(line) as { level?: string; event?: string; topic?: string; dropped_count?: number };
      } catch {
        return {};
      }
    })
    .filter((entry) => entry.event === "push_bus_event_dropped_backpressure");
  assert.equal(warnLines.length, 1, "dropped event surfaces exactly one structured warn");
  assert.equal(warnLines[0]?.level, "warn");
  assert.equal(warnLines[0]?.topic, "run:r-drop");
  assert.equal(warnLines[0]?.dropped_count, 1);
  assert.equal(bus.droppedEventCount, 1, "the bus exposes the cumulative drop count for metrics");

  await bus.unsubscribe("run:r-drop", subscription);
});

test("presence follows stream count or recent last-seen within the LAN TTL", async () => {
  let tick = 0;
  const presence = new InMemoryPresenceStore(() => new Date(1000 + tick));

  await presence.markStreamOpen("u1");
  assert.equal((await presence.getPresence("u1")).is_online, true);

  await presence.markStreamClosed("u1");
  assert.equal((await presence.getPresence("u1")).is_online, true);

  tick = (ONLINE_TTL_SECONDS + 1) * 1000;
  assert.equal((await presence.getPresence("u1")).is_online, false);
});

// R15 批 A（A5 在线抑制）：会话级「正在看」注册表——引用计数（多窗），close 计到 0 才停止「正在看」。
test("in-memory conversation-viewer registry is refcounted and per (conversation,user)", async () => {
  const presence = new InMemoryPresenceStore();
  assert.equal(await presence.isViewingConversation("u1", "c1"), false);

  await presence.markConversationViewer("u1", "c1");
  assert.equal(await presence.isViewingConversation("u1", "c1"), true);
  // 精确到 (conversation,user)：换会话 / 换人都不算「正在看」。
  assert.equal(await presence.isViewingConversation("u1", "c2"), false);
  assert.equal(await presence.isViewingConversation("u2", "c1"), false);

  // 同一用户两条流：close 一条仍在看，close 两条才停。
  await presence.markConversationViewer("u1", "c1");
  await presence.markConversationViewerClosed("u1", "c1");
  assert.equal(await presence.isViewingConversation("u1", "c1"), true);
  await presence.markConversationViewerClosed("u1", "c1");
  assert.equal(await presence.isViewingConversation("u1", "c1"), false);
});

test("redis bus delivers events across independent worker instances", async () => {
  const redis = new FakeRedisHub();
  const factory: RedisPubSubClientFactory = () => redis.createPubSubClient();
  const publisher = new RedisPushBus("redis://workhub-test", 256, factory);
  const subscriber = new RedisPushBus("redis://workhub-test", 256, factory);
  const subscription = await subscriber.subscribe("workitem:w2");

  await publisher.publish("workitem:w2", "agent_run.step", { step: 1 });

  const event = await subscription[Symbol.asyncIterator]().next();
  assert.equal(event.done, false);
  assert.deepEqual(event.value, {
    topic: "workitem:w2",
    type: "agent_run.step",
    data: { step: 1 }
  });

  await subscriber.unsubscribe("workitem:w2", subscription);
  await Promise.all([publisher.close(), subscriber.close()]);
});

test("redis bus normalizes malformed and cross-topic payloads before delivery", async () => {
  const redis = new FakeRedisHub();
  const factory: RedisPubSubClientFactory = () => redis.createPubSubClient();
  const subscriber = new RedisPushBus("redis://workhub-test", 256, factory);
  const subscription = await subscriber.subscribe("workitem:w-normalize");

  redis.publish("workitem:w-normalize", JSON.stringify({
    topic: "user:someone-else",
    type: "agent_run.step",
    data: { step: 7 }
  }));
  redis.publish("workitem:w-normalize", "123");

  const iterator = subscription[Symbol.asyncIterator]();
  const first = await iterator.next();
  const second = await iterator.next();

  assert.equal(first.done, false);
  assert.deepEqual(first.value, {
    topic: "workitem:w-normalize",
    type: "agent_run.step",
    data: { step: 7 }
  });
  assert.equal(second.done, false);
  assert.deepEqual(second.value, {
    topic: "workitem:w-normalize",
    type: "message",
    data: "123"
  });

  await subscriber.unsubscribe("workitem:w-normalize", subscription);
  await subscriber.close();
});

// INF-04：Redis 抖动（isOpen=false）后重建连接——旧客户端必须 quit（不泄漏），新 subscriber 必须
// 把断线前已注册的 topic 全部补订回来，否则所有在线 SSE 永久失聪。
test("INF-04: redis bus quits stale clients and re-subscribes existing topics after a reconnect", async () => {
  const redis = new FakeRedisHub();
  const factory: RedisPubSubClientFactory = () => redis.createPubSubClient();
  const bus = new RedisPushBus("redis://workhub-test", 256, factory);
  const subscription = await bus.subscribe("workitem:w-reconnect");
  const staleClients = [...redis.pubSubClients];
  assert.equal(staleClients.length, 2, "publisher + subscriber pair");

  // 模拟断线：连接已死（isOpen=false）、订阅随连接丢失，但 bus 仍持有旧客户端句柄。
  for (const client of staleClients) {
    client.simulateDrop();
  }

  // 下一次 publish 触发 ensureConnected 重建：旧客户端被 quit，新 subscriber 补订已有 topic，
  // 事件照常送达既有订阅。
  await bus.publish("workitem:w-reconnect", "agent_run.step", { step: 9 });

  const event = await subscription[Symbol.asyncIterator]().next();
  assert.equal(event.done, false);
  assert.deepEqual(event.value, {
    topic: "workitem:w-reconnect",
    type: "agent_run.step",
    data: { step: 9 }
  });
  assert.equal(
    staleClients.every((client) => client.quitCalls >= 1),
    true,
    "stale clients must be quit, not leaked"
  );

  await bus.unsubscribe("workitem:w-reconnect", subscription);
  await bus.close();
});

test("redis bus serializes unsubscribe and resubscribe for the same topic", async () => {
  const redis = new FakeRedisHub();
  const factory: RedisPubSubClientFactory = () => redis.createPubSubClient();
  const bus = new RedisPushBus("redis://workhub-test", 256, factory);
  const first = await bus.subscribe("run:race");
  redis.delayNextUnsubscribe();

  const unsubscribeFirst = bus.unsubscribe("run:race", first);
  await redis.waitForUnsubscribeStart();
  const secondPromise = bus.subscribe("run:race");
  await assert.rejects(() => promiseWithTimeout(secondPromise, 20), /timeout/);

  redis.releaseUnsubscribe();
  const second = await secondPromise;
  await unsubscribeFirst;
  await bus.publish("run:race", "agent_run.step", { step: 2 });

  const event = await second[Symbol.asyncIterator]().next();
  assert.equal(event.done, false);
  assert.equal((event.value as PushEvent<{ step: number }>).data.step, 2);

  await bus.unsubscribe("run:race", second);
  await bus.close();
});

test("redis presence shares online state across worker instances", async () => {
  const redis = new FakeRedisHub();
  const factory: RedisPresenceClientFactory = () => redis.createPresenceClient();
  const writer = new RedisPresenceStore("redis://workhub-test", factory, () => new Date(1000));
  const reader = new RedisPresenceStore("redis://workhub-test", factory, () => new Date(1000));

  await writer.markStreamOpen("u2");
  assert.equal((await reader.getPresence("u2")).is_online, true);

  await reader.forgetUser("u2");
  assert.equal((await writer.getPresence("u2")).is_online, false);

  await Promise.all([writer.close(), reader.close()]);
});

// 审计 FIX#2(a)：持续活跃的流靠 refreshStream 同时续 lastSeen + streams 计数键的 TTL，
// 否则两键到 TTL 自然过期、用户正在线却被判离线。验证续期后跨越原 TTL 仍在线。
test("FIX#2 refreshStream keeps an active redis stream online past the original TTL", async () => {
  const redis = new FakeRedisHub();
  const factory: RedisPresenceClientFactory = () => redis.createPresenceClient();
  let clock = 1_000_000;
  const store = new RedisPresenceStore("redis://workhub-test", factory, () => new Date(clock));

  await store.markStreamOpen("u-active");
  assert.equal((await store.getPresence("u-active")).is_online, true);

  // 推进到接近 TTL 边界，活跃流续期（同 SSE 写真事件后的节流续期）。
  clock += (ONLINE_TTL_SECONDS - 1) * 1000;
  await store.refreshStream("u-active");

  // 再越过「原始」TTL（自 markStreamOpen 起已 > TTL），若不续期两键早过期；续期后仍在线。
  clock += 2 * 1000;
  const presence = await store.getPresence("u-active");
  assert.equal(presence.is_online, true);

  await store.close();
});

// 审计 FIX#2(b)：streams 键已过期时 decr 从 0 起算返回 -1（且把键重建成「-1」）。计数绝不能变负，
// 否则并发流下在线计数被早删/算成负数。验证 close 一条「键已过期」的流后计数归零、不残留负数。
test("FIX#2 markStreamClosed never yields a negative count when the streams key has expired", async () => {
  const redis = new FakeRedisHub();
  const factory: RedisPresenceClientFactory = () => redis.createPresenceClient();
  let clock = 2_000_000;
  const store = new RedisPresenceStore("redis://workhub-test", factory, () => new Date(clock));

  await store.markStreamOpen("u-expire");
  // 让 streams 键越过 TTL 自然过期（lastSeen 也一并过期）。
  clock += (ONLINE_TTL_SECONDS + 1) * 1000;

  // close 一条其计数键已过期的流：decr 不能把计数留成 -1。
  await store.markStreamClosed("u-expire");

  // 计数键应被删除归零（getPresence 读不到正计数）。lastSeen 在 markStreamClosed 末尾用「当前」时钟续过 →
  // is_online 仍可能因 recent 为 true；关键断言是计数永不为负。
  const streamCount = await redis.getValue(`presence:streams:u-expire`);
  // 键被删（null）或值非负——绝不为 -1/负数。
  if (streamCount !== null) {
    assert.ok(Number.parseInt(streamCount, 10) >= 0, `streams count must not be negative, got ${streamCount}`);
  }

  // 紧接着新开一条流，计数必须从 1 起（而不是从 -1+1=0 起，否则 is_online 看计数会误判）。
  await store.markStreamOpen("u-expire");
  assert.equal(await redis.getValue(`presence:streams:u-expire`), "1");

  await store.close();
});

// R15 批 A（A5 在线抑制）：redis 会话级「正在看」注册表跨实例共享，close（含并发多流引用计数）后停止。
test("redis conversation-viewer registry shares across instances and clears on close", async () => {
  const redis = new FakeRedisHub();
  const factory: RedisPresenceClientFactory = () => redis.createPresenceClient();
  const writer = new RedisPresenceStore("redis://workhub-test", factory, () => new Date(1000));
  const reader = new RedisPresenceStore("redis://workhub-test", factory, () => new Date(1000));

  // 两条流（多窗）：close 一条仍在看，close 两条才停——引用计数跨实例。
  await writer.markConversationViewer("u9", "conv-9");
  await reader.markConversationViewer("u9", "conv-9");
  assert.equal(await reader.isViewingConversation("u9", "conv-9"), true);

  await reader.markConversationViewerClosed("u9", "conv-9");
  assert.equal(await writer.isViewingConversation("u9", "conv-9"), true);
  await writer.markConversationViewerClosed("u9", "conv-9");
  assert.equal(await reader.isViewingConversation("u9", "conv-9"), false);

  await Promise.all([writer.close(), reader.close()]);
});

async function nextOrTimeout(iterator: AsyncIterator<PushEvent>, ms: number) {
  return Promise.race([
    iterator.next(),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms))
  ]);
}

async function promiseWithTimeout<T>(promise: Promise<T>, ms: number) {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("timeout")), ms);
    })
  ]);
}

type RedisListener = (message: string) => void;

class FakeRedisHub {
  private channels = new Map<string, Set<RedisListener>>();
  private values = new Map<string, { value: string; expiresAt?: number }>();
  private delayUnsubscribe = false;
  private unsubscribeStartPromise: Promise<void> | undefined;
  private unsubscribeStarted: (() => void) | undefined;
  private unsubscribeRelease: (() => void) | undefined;
  // 工厂与 duplicate() 创建的全部 pub/sub 客户端（含 subscriber），供测试模拟断线/断言退出。
  public pubSubClients: FakeRedisPubSubClient[] = [];

  createPubSubClient(): RedisPubSubClient {
    const client = new FakeRedisPubSubClient(this);
    this.pubSubClients.push(client);
    return client;
  }

  createPresenceClient(): RedisPresenceClient {
    return new FakeRedisPresenceClient(this);
  }

  addListener(channel: string, listener: RedisListener) {
    const listeners = this.channels.get(channel) ?? new Set<RedisListener>();
    listeners.add(listener);
    this.channels.set(channel, listeners);
  }

  removeListener(channel: string, listener: RedisListener) {
    const listeners = this.channels.get(channel);
    if (!listeners) {
      return;
    }
    listeners.delete(listener);
    if (listeners.size === 0) {
      this.channels.delete(channel);
    }
  }

  publish(channel: string, message: string) {
    const listeners = Array.from(this.channels.get(channel) ?? []);
    for (const listener of listeners) {
      listener(message);
    }
    return listeners.length;
  }

  delayNextUnsubscribe() {
    this.delayUnsubscribe = true;
    this.unsubscribeStartPromise = new Promise<void>((resolve) => {
      this.unsubscribeStarted = resolve;
    });
  }

  async maybeDelayUnsubscribe() {
    if (!this.delayUnsubscribe) {
      return;
    }
    this.delayUnsubscribe = false;
    this.unsubscribeStarted?.();
    await new Promise<void>((resolve) => {
      this.unsubscribeRelease = resolve;
    });
    this.unsubscribeRelease = undefined;
  }

  waitForUnsubscribeStart() {
    return this.unsubscribeStartPromise ?? Promise.resolve();
  }

  releaseUnsubscribe() {
    this.unsubscribeRelease?.();
  }

  async setValue(key: string, value: string, options?: RedisSetOptions) {
    this.values.set(key, {
      value,
      ...(options?.EX ? { expiresAt: Date.now() + options.EX * 1000 } : {})
    });
  }

  getValue(key: string) {
    const record = this.values.get(key);
    if (!record) {
      return null;
    }
    if (record.expiresAt && record.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return record.value;
  }

  async deleteValue(keys: string | string[]) {
    const list = Array.isArray(keys) ? keys : [keys];
    let deleted = 0;
    for (const key of list) {
      if (this.values.delete(key)) {
        deleted += 1;
      }
    }
    return deleted;
  }

  async increment(key: string) {
    const value = Number.parseInt(this.getValue(key) ?? "0", 10) + 1;
    await this.setValue(key, String(value));
    return value;
  }

  async decrement(key: string) {
    const value = Number.parseInt(this.getValue(key) ?? "0", 10) - 1;
    await this.setValue(key, String(value));
    return value;
  }

  async expire(key: string, seconds: number) {
    const value = this.getValue(key);
    if (value === null) {
      return false;
    }
    await this.setValue(key, value, { EX: seconds });
    return true;
  }
}

class FakeRedisPubSubClient implements RedisPubSubClient {
  isOpen = false;
  quitCalls = 0;
  private subscriptions = new Map<string, Set<RedisListener>>();

  constructor(private readonly hub: FakeRedisHub) {}

  duplicate() {
    const client = new FakeRedisPubSubClient(this.hub);
    this.hub.pubSubClients.push(client);
    return client;
  }

  on() {
    return this;
  }

  async connect() {
    this.isOpen = true;
  }

  async quit() {
    this.quitCalls += 1;
    for (const [channel, listeners] of this.subscriptions) {
      for (const listener of listeners) {
        this.hub.removeListener(channel, listener);
      }
    }
    this.subscriptions.clear();
    this.isOpen = false;
  }

  // 模拟 Redis 抖动断线：监听关系随连接一起丢失，但不经过 quit（不计 quitCalls）——
  // 用于区分「断线丢订阅」与「重建时主动退出旧客户端」。
  simulateDrop() {
    for (const [channel, listeners] of this.subscriptions) {
      for (const listener of listeners) {
        this.hub.removeListener(channel, listener);
      }
    }
    this.subscriptions.clear();
    this.isOpen = false;
  }

  async subscribe(channel: string, listener: RedisListener) {
    const listeners = this.subscriptions.get(channel) ?? new Set<RedisListener>();
    listeners.add(listener);
    this.subscriptions.set(channel, listeners);
    this.hub.addListener(channel, listener);
  }

  async unsubscribe(channel: string) {
    await this.hub.maybeDelayUnsubscribe();
    const listeners = this.subscriptions.get(channel) ?? new Set<RedisListener>();
    for (const listener of listeners) {
      this.hub.removeListener(channel, listener);
    }
    this.subscriptions.delete(channel);
  }

  async publish(channel: string, message: string) {
    return this.hub.publish(channel, message);
  }
}

class FakeRedisPresenceClient implements RedisPresenceClient {
  isOpen = false;

  constructor(private readonly hub: FakeRedisHub) {}

  on() {
    return this;
  }

  async connect() {
    this.isOpen = true;
  }

  async quit() {
    this.isOpen = false;
  }

  async set(key: string, value: string, options?: RedisSetOptions) {
    await this.hub.setValue(key, value, options);
    return "OK";
  }

  multi(): RedisPresenceMulti {
    const operations: Array<() => Promise<unknown>> = [];
    const multi: RedisPresenceMulti = {
      set: (key, value, options) => {
        operations.push(() => this.hub.setValue(key, value, options));
        return multi;
      },
      incr: (key) => {
        operations.push(() => this.hub.increment(key));
        return multi;
      },
      expire: (key, seconds) => {
        operations.push(() => this.hub.expire(key, seconds));
        return multi;
      },
      exec: async () => Promise.all(operations.map((operation) => operation()))
    };
    return multi;
  }

  async get(key: string) {
    return this.hub.getValue(key);
  }

  async decr(key: string) {
    return this.hub.decrement(key);
  }

  async del(keys: string | string[]) {
    return this.hub.deleteValue(keys);
  }

  async expire(key: string, seconds: number) {
    return this.hub.expire(key, seconds);
  }
}
