import type { Context } from "hono";
import { stream } from "hono/streaming";

import { formatSseComment, formatSseEvent } from "@workhub/events";

import type { PresenceStore, PushBus, PushSubscription } from "../broker/index.js";
import type { StreamUser } from "../middleware/auth.js";

const encoder = new TextEncoder();

export type WriteEventStreamOptions = {
  heartbeatMs?: number;
};

export function writeEventStream(
  c: Context,
  bus: PushBus,
  presence: PresenceStore,
  topic: string,
  user: StreamUser,
  options: WriteEventStreamOptions = {}
) {
  const heartbeatMs = options.heartbeatMs ?? 30000;

  c.header("Content-Type", "text/event-stream; charset=utf-8");
  c.header("Cache-Control", "no-cache");
  c.header("X-Accel-Buffering", "no");

  return stream(c, async (output) => {
    let aborted = false;
    let subscription: PushSubscription | undefined;

    output.onAbort(() => {
      aborted = true;
    });

    try {
      await presence.markStreamOpen(user.id);
      await output.write(encoder.encode(formatSseEvent("connected", { topic })));
      subscription = await bus.subscribe(topic);
      const iterator = subscription[Symbol.asyncIterator]();

      while (!aborted) {
        const result = await nextWithHeartbeat(iterator, heartbeatMs);
        if (result === "heartbeat") {
          await output.write(encoder.encode(formatSseComment("ping")));
          continue;
        }
        if (result.done) {
          break;
        }
        await output.write(encoder.encode(formatSseEvent(result.value.type, result.value.data)));
      }
    } finally {
      if (subscription) {
        await bus.unsubscribe(topic, subscription);
      }
      await presence.markStreamClosed(user.id);
    }
  });
}

async function nextWithHeartbeat<T>(iterator: AsyncIterator<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<"heartbeat">((resolve) => {
        timer = setTimeout(() => resolve("heartbeat"), ms);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
