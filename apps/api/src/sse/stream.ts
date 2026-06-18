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
  const lastEventId = c.req.header("Last-Event-ID") ?? c.req.query("last_event_id") ?? "";

  c.header("Content-Type", "text/event-stream; charset=utf-8");
  c.header("Cache-Control", "no-cache");
  c.header("X-Accel-Buffering", "no");
  c.header("X-WorkHub-SSE-Cursor", lastEventId ? "resume-requested" : "fresh");

  return stream(c, async (output) => {
    let aborted = false;
    let opened = false;
    let subscription: PushSubscription | undefined;

    output.onAbort(() => {
      aborted = true;
      // findings[#perf]：断线时只翻 aborted 旗标不够——循环此刻正 `await raceHeartbeat(pending, ...)`
      // 阻塞在订阅的 next() 上，要等到下一次心跳（最长 heartbeatMs）才醒来跑 finally，期间订阅+presence 槽位泄漏。
      // 主动 close() 订阅：它把停泊的 waiter 立即以 {done:true} 兑现 → race 即刻返回 → while 退出 → finally
      // （取消订阅 + 释放 presence）在断线当下就跑。close 幂等，finally 里的 unsubscribe 再 close 是 no-op。
      void subscription?.close();
    });

    try {
      await presence.markStreamOpen(user.id);
      // findings[#low]：只有 markStreamOpen 真正成功后才允许 finally 里 markStreamClosed，
      // 否则 open 抛错时会跑一次没有配对 open 的 close，把 Redis 在线计数减成负数。
      opened = true;
      await output.write(encoder.encode(formatSseEvent("connected", {
        topic,
        last_event_id: lastEventId || undefined,
        // findings[#170]：诚实声明。后端不按 Last-Event-ID 重放（memory/redis bus 都不存 per-topic 回放日志），
        // 此前 cursor 在场就报 "reconcile" 是假承诺。客户端本就不读 resume_mode，且每条实时事件都整路由重拉
        // (live-runtime onRefresh)，断线期间的事件靠下一条事件后的全量重拉补齐——故恒报 "fresh"，不谎称重放。
        resume_mode: "fresh"
      })));
      subscription = await bus.subscribe(topic);
      const iterator = subscription[Symbol.asyncIterator]();

      // 单条在飞 next() 跨心跳复用：每轮都新建 iterator.next() 会在心跳胜出时把上一轮的 resolver
      // 留成孤儿 waiter，导致心跳后丢掉队列里的第一条事件。缓存 pending，只在真正消费后清空。
      let pending: ReturnType<typeof iterator.next> | undefined;
      while (!aborted) {
        pending = pending ?? iterator.next();
        const result = await raceHeartbeat(pending, heartbeatMs);
        if (result === "heartbeat") {
          // findings[#low]：长时间空闲流靠心跳刷新 presence lastSeen，否则在线键自然过期、
          // is_online 误转 false（heartbeatMs 30s < TTL 120s，刷 lastSeen 即可保持 recent）。
          await presence.touchUser(user.id);
          await output.write(encoder.encode(formatSseComment("ping")));
          continue;
        }
        pending = undefined;
        if (result.done) {
          break;
        }
        await output.write(encoder.encode(formatSseEvent(result.value.type, result.value.data, {
          id: eventIdFromData(result.value.data)
        })));
      }
    } finally {
      if (subscription) {
        await bus.unsubscribe(topic, subscription);
      }
      if (opened) {
        await presence.markStreamClosed(user.id);
      }
    }
  });
}

function eventIdFromData(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  if (typeof record["event_id"] === "string" && record["event_id"].length > 0) {
    return record["event_id"];
  }
  const nested = record["event"];
  if (nested && typeof nested === "object") {
    const nestedRecord = nested as Record<string, unknown>;
    if (typeof nestedRecord["event_id"] === "string" && nestedRecord["event_id"].length > 0) {
      return nestedRecord["event_id"];
    }
  }
  return undefined;
}

// Race an ALREADY-PENDING next() against a heartbeat timer. The caller owns `pending` and only
// discards it after it actually resolves, so a heartbeat win never abandons a registered waiter.
async function raceHeartbeat<T>(pending: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
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
