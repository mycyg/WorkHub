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

test("findings: an event dropped under backpressure emits a warn", async () => {
  const bus = new InProcessPushBus(2);
  const subscription = await bus.subscribe("run:r-drop"); // 订阅但不消费
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    await bus.publish("run:r-drop", "agent_run.step", { step: 1 });
    await bus.publish("run:r-drop", "agent_run.step", { step: 2 });
    await bus.publish("run:r-drop", "agent_run.step", { step: 3 }); // 满队列 → drop → warn
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.some((entry) => entry[0] === "push bus dropped event under backpressure"), true);

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

  createPubSubClient(): RedisPubSubClient {
    return new FakeRedisPubSubClient(this);
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
  private subscriptions = new Map<string, Set<RedisListener>>();

  constructor(private readonly hub: FakeRedisHub) {}

  duplicate() {
    return new FakeRedisPubSubClient(this.hub);
  }

  on() {
    return this;
  }

  async connect() {
    this.isOpen = true;
  }

  async quit() {
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
