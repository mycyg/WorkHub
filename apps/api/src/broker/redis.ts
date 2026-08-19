import { createClient } from "redis";

import type { PushEvent } from "@workhub/events";

import { LocalEventQueue } from "./local-queue.js";
import type { PushBus, PushSubscription } from "./types.js";

type RedisMessageHandler = (message: string) => void;

export type RedisPubSubClient = {
  readonly isOpen: boolean;
  duplicate: () => RedisPubSubClient;
  on: (event: "error", listener: (error: unknown) => void) => RedisPubSubClient;
  connect: () => Promise<void>;
  quit: () => Promise<void>;
  subscribe: (channel: string, listener: RedisMessageHandler) => Promise<void>;
  unsubscribe: (channel: string) => Promise<void>;
  publish: (channel: string, message: string) => Promise<number>;
};

export type RedisPubSubClientFactory = (url: string) => RedisPubSubClient;

const createDefaultRedisClient: RedisPubSubClientFactory = (url) =>
  createClient({ url }) as unknown as RedisPubSubClient;

export class RedisPushBus implements PushBus {
  public readonly backend = "redis" as const;
  private publisher: RedisPubSubClient | undefined;
  private subscriber: RedisPubSubClient | undefined;
  private subscribers = new Map<string, Set<LocalEventQueue>>();
  private handlers = new Map<string, (message: string) => void>();
  private connecting: Promise<void> | undefined;
  private topicLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly url: string,
    private readonly maxQueueSize = 256,
    private readonly clientFactory: RedisPubSubClientFactory = createDefaultRedisClient
  ) {
    if (!url) {
      throw new Error("BROKER_URL is required for Redis broker");
    }
  }

  async subscribe(topic: string): Promise<PushSubscription> {
    return this.withTopicLock(topic, async () => {
      await this.ensureConnected();
      const subscription = new LocalEventQueue(topic, this.maxQueueSize);
      const topicSubscribers = this.subscribers.get(topic) ?? new Set<LocalEventQueue>();
      topicSubscribers.add(subscription);
      this.subscribers.set(topic, topicSubscribers);

      if (!this.handlers.has(topic)) {
        const handler = (message: string) => this.dispatch(topic, message);
        this.handlers.set(topic, handler);
        try {
          await this.subscriber?.subscribe(topic, handler);
        } catch (error) {
          topicSubscribers.delete(subscription);
          if (topicSubscribers.size === 0) {
            this.subscribers.delete(topic);
          }
          this.handlers.delete(topic);
          await subscription.close();
          throw error;
        }
      }

      return subscription;
    });
  }

  async unsubscribe(topic: string, subscription: PushSubscription) {
    await this.withTopicLock(topic, async () => {
      const topicSubscribers = this.subscribers.get(topic);
      if (topicSubscribers) {
        topicSubscribers.delete(subscription as LocalEventQueue);
        if (topicSubscribers.size === 0) {
          this.subscribers.delete(topic);
          this.handlers.delete(topic);
          if (this.subscriber?.isOpen) {
            await this.subscriber.unsubscribe(topic);
          }
        }
      }
      await subscription.close();
    });
  }

  async publish<T = unknown>(topic: string, type: string, data: T) {
    await this.ensureConnected();
    const event: PushEvent<T> = { topic, type, data };
    await this.publisher?.publish(topic, JSON.stringify(event));
  }

  async close() {
    const subscriptions = Array.from(this.subscribers.values()).flatMap((items) => Array.from(items));
    this.subscribers.clear();
    this.handlers.clear();
    this.topicLocks.clear();
    await Promise.all(subscriptions.map((subscription) => subscription.close()));
    await this.subscriber?.quit();
    await this.publisher?.quit();
    this.subscriber = undefined;
    this.publisher = undefined;
    this.connecting = undefined;
  }

  private dispatch(topic: string, raw: string) {
    let event: PushEvent;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as { type?: unknown }).type === "string") {
        event = {
          topic,
          type: (parsed as { type: string }).type,
          data: (parsed as { data?: unknown }).data
        };
      } else {
        event = { topic, type: "message", data: raw };
      }
    } catch {
      event = { topic, type: "message", data: raw };
    }

    const topicSubscribers = this.subscribers.get(topic);
    if (!topicSubscribers) {
      return;
    }
    for (const subscriber of topicSubscribers) {
      // findings[#low]：背压满队列时 push 返回 false 静默丢事件——至少留一条 warn 供排查。
      const delivered = subscriber.push(event);
      if (!delivered) {
        console.warn("push bus dropped event under backpressure", { topic, type: event.type });
      }
    }
  }

  private async ensureConnected() {
    if (this.publisher?.isOpen && this.subscriber?.isOpen) {
      return;
    }

    // connecting 必须在【成功】后也清空——否则首次建连留下的已解决 Promise 会让后续所有
    // 「isOpen=false → 重连」路径空等旧 Promise，重建永远不发生（断线即永久失聪）。
    this.connecting ??= this.connect().then(
      () => {
        this.connecting = undefined;
      },
      (error) => {
        this.connecting = undefined;
        throw error;
      }
    );
    await this.connecting;
  }

  private async connect() {
    // INF-04：这里是「isOpen=false 后的重建」路径（Redis 抖动/断线）。两个坑必须一起堵：
    // 1) 旧客户端不 quit 会泄漏连接——先退出再重建；
    // 2) subscribe() 只在「新 topic」时下发订阅（handlers 命中即跳过），所以新 subscriber 必须在
    //    这里按 handlers 注册表把断线前的 topic 全部补订，否则所有在线 SSE 永久失聪。
    const stalePublisher = this.publisher;
    const staleSubscriber = this.subscriber;
    this.publisher = undefined;
    this.subscriber = undefined;
    await staleSubscriber?.quit().catch((error) => console.error("Redis subscriber quit failed", error));
    await stalePublisher?.quit().catch((error) => console.error("Redis publisher quit failed", error));

    const publisher = this.clientFactory(this.url);
    const subscriber = publisher.duplicate();
    publisher.on("error", (error) => console.error("Redis publisher error", error));
    subscriber.on("error", (error) => console.error("Redis subscriber error", error));
    try {
      await publisher.connect();
      await subscriber.connect();
      for (const [topic, handler] of this.handlers) {
        await subscriber.subscribe(topic, handler);
      }
    } catch (error) {
      // 连接/补订失败：退出半成品客户端并保持字段为空——下次 ensureConnected 会重走完整重建。
      await subscriber.quit().catch(() => undefined);
      await publisher.quit().catch(() => undefined);
      throw error;
    }
    this.publisher = publisher;
    this.subscriber = subscriber;
  }

  private async withTopicLock<T>(topic: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.topicLocks.get(topic) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.topicLocks.set(topic, tail);

    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.topicLocks.get(topic) === tail) {
        this.topicLocks.delete(topic);
      }
    }
  }
}
