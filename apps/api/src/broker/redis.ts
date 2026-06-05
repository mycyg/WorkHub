import { createClient, type RedisClientType } from "redis";

import type { PushEvent } from "@workhub/events";

import { LocalEventQueue } from "./local-queue.js";
import type { PushBus, PushSubscription } from "./types.js";

export class RedisPushBus implements PushBus {
  public readonly backend = "redis" as const;
  private publisher: RedisClientType | undefined;
  private subscriber: RedisClientType | undefined;
  private subscribers = new Map<string, Set<LocalEventQueue>>();
  private handlers = new Map<string, (message: string) => void>();
  private connecting: Promise<void> | undefined;

  constructor(
    private readonly url: string,
    private readonly maxQueueSize = 256
  ) {
    if (!url) {
      throw new Error("BROKER_URL is required for Redis broker");
    }
  }

  async subscribe(topic: string): Promise<PushSubscription> {
    await this.ensureConnected();
    const subscription = new LocalEventQueue(topic, this.maxQueueSize);
    const topicSubscribers = this.subscribers.get(topic) ?? new Set<LocalEventQueue>();
    topicSubscribers.add(subscription);
    this.subscribers.set(topic, topicSubscribers);

    if (!this.handlers.has(topic)) {
      const handler = (message: string) => this.dispatch(topic, message);
      this.handlers.set(topic, handler);
      await this.subscriber?.subscribe(topic, handler);
    }

    return subscription;
  }

  async unsubscribe(topic: string, subscription: PushSubscription) {
    const topicSubscribers = this.subscribers.get(topic);
    if (topicSubscribers) {
      topicSubscribers.delete(subscription as LocalEventQueue);
      if (topicSubscribers.size === 0) {
        this.subscribers.delete(topic);
        this.handlers.delete(topic);
        await this.subscriber?.unsubscribe(topic);
      }
    }
    await subscription.close();
  }

  async publish<T = unknown>(topic: string, type: string, data: T) {
    await this.ensureConnected();
    const event: PushEvent<T> = { topic, type, data };
    await this.publisher?.publish(topic, JSON.stringify(event));
  }

  async close() {
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

    this.connecting ??= this.connect();
    await this.connecting;
  }

  private async connect() {
    this.publisher = createClient({ url: this.url });
    this.subscriber = this.publisher.duplicate();
    this.publisher.on("error", (error) => console.error("Redis publisher error", error));
    this.subscriber.on("error", (error) => console.error("Redis subscriber error", error));
    await this.publisher.connect();
    await this.subscriber.connect();
  }
}
