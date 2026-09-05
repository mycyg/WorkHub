import type { Context } from "hono";
import { stream } from "hono/streaming";

import { formatSseComment, formatSseEvent } from "@workhub/events";

import type { PresenceStore, PushBus, PushSubscription } from "../broker/index.js";
import type { StreamUser } from "../middleware/auth.js";
import { getDefaultStructuredLogger } from "../logging.js";

const encoder = new TextEncoder();

export type WriteEventStreamOptions = {
  heartbeatMs?: number;
  // 审计 FIX#2(a)：活跃流 presence 续期的节流窗口（ms）。默认对齐心跳间隔，确保活跃流的续期频率
  // 与空闲心跳一致（都 ~30s 一次），始终 < 在线 TTL(120s)。测试里可调小以验证续期触发。
  presenceRefreshMs?: number;
  // SEC P0（退出/撤销设备后已建立的 SSE 从不复检、继续灌旧账号事件）：本流的凭据授权重验钩子。开流时已过
  // 完整鉴权，但长连接建立后从不重验 session/device grant——登出/吊销设备后旧连接仍活着。这里按节拍
  // （≤heartbeatMs，见 revalidateMs）重验：返回 false=授权已撤销→写一条 `stream.revoked` 终止事件并正常收流。
  // 依赖注入（push.ts 按本请求的凭据构造），便于单测。best-effort：重验查询抛错不拆健康流（视为暂不可判定，
  // 保守继续，下一拍再验）。
  revalidateGrant?: () => Promise<boolean> | boolean;
  // 凭据重验的节拍（ms）。默认对齐心跳，确保空闲流每心跳、活跃流每 ≤heartbeatMs 也各重验一次。测试里可调小。
  revalidateMs?: number;
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
  const presenceRefreshMs = options.presenceRefreshMs ?? heartbeatMs;
  const revalidateGrant = options.revalidateGrant;
  const revalidateMs = options.revalidateMs ?? heartbeatMs;
  const lastEventId = c.req.header("Last-Event-ID") ?? c.req.query("last_event_id") ?? "";
  // R15 批 A（A5 在线抑制）：会话流（topic=`conversation:<id>`）额外登记「此刻正在看这条会话」——
  // A5 通知生成时据此精确抑制（正在看的人不落 OS 通知，只靠已广播的 conversation.message.created 动红点）。
  // 其它 topic（all/user/workitem/…）不登记。全部 best-effort：presence 抖动绝不拆掉一条健康的 SSE。
  const CONVERSATION_TOPIC_PREFIX = "conversation:";
  const viewerConversationId = topic.startsWith(CONVERSATION_TOPIC_PREFIX)
    ? topic.slice(CONVERSATION_TOPIC_PREFIX.length)
    : undefined;
  async function refreshConversationViewer() {
    if (!viewerConversationId) {
      return;
    }
    try {
      await presence.refreshConversationViewer(user.id, viewerConversationId);
    } catch (error) {
      getDefaultStructuredLogger().warn("sse_conversation_viewer_refresh_failed", { error });
    }
  }

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
      if (viewerConversationId) {
        // best-effort：登记失败只是这次「正在看」抑制不生效（顶多多发一条已 dedupe 的通知），不拆流。
        try {
          await presence.markConversationViewer(user.id, viewerConversationId);
        } catch (error) {
          getDefaultStructuredLogger().warn("sse_conversation_viewer_open_failed", { error });
        }
      }
      subscription = await bus.subscribe(topic);
      const iterator = subscription[Symbol.asyncIterator]();
      await output.write(encoder.encode(formatSseEvent("connected", {
        topic,
        last_event_id: lastEventId || undefined,
        // findings[#170]：诚实声明。后端不按 Last-Event-ID 重放（memory/redis bus 都不存 per-topic 回放日志），
        // 此前 cursor 在场就报 "reconcile" 是假承诺。客户端本就不读 resume_mode；断线窗口漏掉的事件由
        // 客户端在重连成功（connected）时做一次全量重拉补齐（INF-08，web live-runtime 与桌面端同口径），
        // 逐事件到来时也会整路由重拉（live-runtime onRefresh）——故恒报 "fresh"，不谎称重放。
        resume_mode: "fresh"
      })));

      // 单条在飞 next() 跨心跳复用：每轮都新建 iterator.next() 会在心跳胜出时把上一轮的 resolver
      // 留成孤儿 waiter，导致心跳后丢掉队列里的第一条事件。缓存 pending，只在真正消费后清空。
      let pending: ReturnType<typeof iterator.next> | undefined;
      // 审计 FIX#2(a)：节流活跃流的 presence 续期——不能每条事件都打一次 Redis。markStreamOpen 刚续过 TTL，
      // 故从「现在」起算，只在距上次续期 >presenceRefreshMs 时再续。
      let lastPresenceRefreshAt = Date.now();
      // SEC P0：本流凭据授权的上次重验时刻。开流刚过完整鉴权，故从「现在」起算，只在距上次重验 >revalidateMs
      // 时再验（空闲流每心跳、活跃流每 ≤heartbeatMs 各命中一次），避免每条事件都打一次授权查询。
      let lastRevalidateAt = Date.now();
      while (!aborted) {
        // SEC P0：每拍（≤heartbeatMs）重验本流凭据授权仍有效。登出/撤销设备后即便流仍活跃，也在下一拍收尾——
        // 写一条 stream.revoked 终止事件后正常结束响应（客户端据此重新鉴权/停留在重新绑定屏）。
        if (revalidateGrant && Date.now() - lastRevalidateAt >= revalidateMs) {
          lastRevalidateAt = Date.now();
          let stillAuthorized = true;
          try {
            stillAuthorized = await revalidateGrant();
          } catch (error) {
            // 重验查询抖动：视为暂不可判定，保守继续（绝不因一次授权查询故障拆掉一条健康流）。下一拍再验。
            getDefaultStructuredLogger().warn("sse_grant_revalidate_failed", { error });
            stillAuthorized = true;
          }
          if (!stillAuthorized) {
            await output.write(
              encoder.encode(formatSseEvent("stream.revoked", { reason: "credential_revoked" }))
            );
            break;
          }
        }
        pending = pending ?? iterator.next();
        const result = await raceHeartbeat(pending, heartbeatMs);
        if (result === "heartbeat") {
          // findings[#low]：长时间空闲流靠心跳刷新 presence lastSeen，否则在线键自然过期、
          // is_online 误转 false（heartbeatMs 30s < TTL 120s，刷 lastSeen 即可保持 recent）。
          // 审计 FIX#24：presence 是软状态，绝不能让一次 Redis 抖动从这里冒泡出 while → finally 拆掉一条
          // 健康的 SSE 流（且空闲连接每 ~30s 都心跳，一次 presence 短暂故障会群体掉线空闲客户端）。心跳尽力而为。
          try {
            await presence.touchUser(user.id);
            lastPresenceRefreshAt = Date.now();
          } catch (error) {
            getDefaultStructuredLogger().warn("sse_heartbeat_presence_touch_failed", { error });
          }
          // 空闲会话流也要续「正在看」TTL，否则盯着一个没新消息的会话看久了 TTL 到期、抑制失效。
          await refreshConversationViewer();
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
        // 审计 FIX#2(a)：持续活跃（事件 <heartbeatMs 一条 → 永不走心跳分支）的流，靠这里节流续期 presence，
        // 否则 lastSeen + streams 两键都到 TTL 自然过期、用户正在线却被判离线。best-effort（同 FIX#24）。
        const elapsed = Date.now() - lastPresenceRefreshAt;
        if (elapsed >= presenceRefreshMs) {
          lastPresenceRefreshAt = Date.now();
          try {
            await presence.refreshStream(user.id);
          } catch (error) {
            getDefaultStructuredLogger().warn("sse_active_stream_presence_refresh_failed", { error });
          }
          await refreshConversationViewer();
        }
      }
    } finally {
      if (subscription) {
        try {
          await bus.unsubscribe(topic, subscription);
        } catch (error) {
          getDefaultStructuredLogger().warn("sse_unsubscribe_failed", { topic, error });
        }
      }
      if (opened) {
        try {
          await presence.markStreamClosed(user.id);
        } catch (error) {
          getDefaultStructuredLogger().warn("sse_stream_close_presence_failed", { userId: user.id, error });
        }
        if (viewerConversationId) {
          try {
            await presence.markConversationViewerClosed(user.id, viewerConversationId);
          } catch (error) {
            getDefaultStructuredLogger().warn("sse_conversation_viewer_close_failed", { userId: user.id, error });
          }
        }
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
