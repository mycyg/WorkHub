import type { PushEvent } from "@workhub/events";

import { getDefaultStructuredLogger } from "../logging.js";
import { LocalEventQueue } from "./local-queue.js";
import type { PushBus, PushSubscription } from "./types.js";

export class InProcessPushBus implements PushBus {
  public readonly backend = "memory" as const;
  private subscribers = new Map<string, Set<LocalEventQueue>>();
  // INF-12：背压丢事件计数——丢事件此前只有一条 console.warn，无量纲可查。计数随每条结构化
  // warn 带上（累计值），也可经 droppedEventCount 读走做指标。
  private droppedEvents = 0;

  constructor(private readonly maxQueueSize = 256) {}

  // INF-12：该 bus 因背压丢弃的事件累计数（进程内指标，测试/运维可读）。
  get droppedEventCount() {
    return this.droppedEvents;
  }

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
      // INF-12：背压满队列时 push 返回 false 丢事件——走结构化 logger（进 JSON 日志管道，可按 event
      // 聚合告警）并累计计数，替换此前的裸 console.warn。
      const delivered = subscriber.push(event);
      if (!delivered) {
        this.droppedEvents += 1;
        getDefaultStructuredLogger().warn("push_bus_event_dropped_backpressure", {
          topic,
          type,
          dropped_count: this.droppedEvents
        });
      }
    }
  }
}
