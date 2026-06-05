import type { PushEvent } from "@workhub/events";

import type { PushSubscription } from "./types.js";

type Waiter = (value: IteratorResult<PushEvent>) => void;

export class LocalEventQueue implements PushSubscription {
  private queue: PushEvent[] = [];
  private waiters: Waiter[] = [];
  private closed = false;

  constructor(
    public readonly topic: string,
    private readonly maxSize = 256
  ) {}

  push(event: PushEvent) {
    if (this.closed) {
      return false;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
      return true;
    }

    if (this.queue.length >= this.maxSize) {
      return false;
    }

    this.queue.push(event);
    return true;
  }

  async next(): Promise<IteratorResult<PushEvent>> {
    const event = this.queue.shift();
    if (event) {
      return { value: event, done: false };
    }

    if (this.closed) {
      return { value: undefined, done: true };
    }

    return new Promise<IteratorResult<PushEvent>>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<PushEvent> {
    return {
      next: () => this.next()
    };
  }
}
