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
      event = JSON.parse(raw) as PushEvent;
    } catch {
      event = { topic, type: "message", data: raw };
    }

    const topicSubscribers = this.subscribers.get(topic);
    if (!topicSubscribers) {
      return;
    }
    for (const subscriber of topicSubscribers) {
      subscriber.push(event);
    }
  }

  private async ensureConnected() {
    if (this.publisher?.isOpen && this.subscriber?.isOpen) {
      return;
    }

    this.connecting ??= this.connect().catch((error) => {
      this.connecting = undefined;
      throw error;
    });
    await this.connecting;
  }

  private async connect() {
    this.publisher = this.clientFactory(this.url);
    this.subscriber = this.publisher.duplicate();
    this.publisher.on("error", (error) => console.error("Redis publisher error", error));
    this.subscriber.on("error", (error) => console.error("Redis subscriber error", error));
    await this.publisher.connect();
    await this.subscriber.connect();
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
