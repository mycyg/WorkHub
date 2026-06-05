import type { PushEvent } from "@workhub/events";

import { LocalEventQueue } from "./local-queue.js";
import type { PushBus, PushSubscription } from "./types.js";

export class InProcessPushBus implements PushBus {
  public readonly backend = "memory" as const;
  private subscribers = new Map<string, Set<LocalEventQueue>>();

  constructor(private readonly maxQueueSize = 256) {}

  async subscribe(topic: string): Promise<PushSubscription> {
    const subscription = new LocalEventQueue(topic, this.maxQueueSize);
    const subscribers = this.subscribers.get(topic) ?? new Set<LocalEventQueue>();
    subscribers.add(subscription);
    this.subscribers.set(topic, subscribers);
    return subscription;
  }

  async unsubscribe(topic: string, subscription: PushSubscription) {
    const subscribers = this.subscribers.get(topic);
    if (subscribers) {
      subscribers.delete(subscription as LocalEventQueue);
      if (subscribers.size === 0) {
        this.subscribers.delete(topic);
      }
    }
    await subscription.close();
  }

  async publish<T = unknown>(topic: string, type: string, data: T) {
    const event: PushEvent<T> = { topic, type, data };
    const subscribers = this.subscribers.get(topic);
    if (!subscribers) {
      return;
    }

    for (const subscriber of subscribers) {
      subscriber.push(event);
    }
  }
}
