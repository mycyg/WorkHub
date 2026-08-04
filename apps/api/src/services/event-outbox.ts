import type { EventOutboxRepository, EventOutboxRow } from "@workhub/db";

import type { PushBus } from "../broker/index.js";
import type { StructuredLogger } from "../logging.js";

// R20 P2-01（事务性 outbox · drain）：把 event_outbox 里的 pending 行 publish 到 SSE/事件总线，publish
// 成功才置 published；失败则 attempts+1、记 last_error、保持 pending 等下一轮重放（至少一次投递）。
// event_id 是幂等键——消费端本就按全量重拉对账，drain 重启/重叠导致的重复投递无害。这修的裂缝：会话
// 消息此前是「消息行提交 → 事后 best-effort bus.publish」，两步之间进程崩溃或 publish 抛错则推送永久蒸发。

export type EventOutboxDrainDeps = {
  outbox: Pick<EventOutboxRepository, "listPending" | "markPublished" | "markFailed" | "purgePublishedBefore">;
  bus: Pick<PushBus, "publish">;
  logger: Pick<StructuredLogger, "warn">;
  now?: () => Date;
};

export type EventOutboxDrainResult = {
  scanned: number;
  published: number;
  failed: number;
  // R21 加固（防无界增长）：本轮顺带清掉的过期已发布行数（保留窗口外的 published 行）。
  purged: number;
};

export type EventOutboxDrain = (options?: { limit?: number }) => Promise<EventOutboxDrainResult>;

const DEFAULT_DRAIN_BATCH = 100;
// R21 加固：已发布行的保留窗口（消费端本就按全量重拉对账，published 行只剩排障价值）与每轮清理上限
// （id IN (LIMIT n) 防长事务，积压靠后续轮次逐步追平）。
export const PUBLISHED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const PURGE_BATCH_LIMIT = 500;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// 单实例 drain：闭包持一把进程内互斥，把并发调用（即席 drain + 定时 drain）串行化——同进程不重复扫、
// 不重复发同一行；跨进程的重复投递由消费端幂等兜底。默认服务共享同一个实例（请求路径与调度器都用它）。
export function createEventOutboxDrain(deps: EventOutboxDrainDeps): EventOutboxDrain {
  const now = deps.now ?? (() => new Date());
  let inFlight: Promise<EventOutboxDrainResult> | undefined;

  async function runOnce(limit: number): Promise<EventOutboxDrainResult> {
    const rows: EventOutboxRow[] = await deps.outbox.listPending({ limit });
    let published = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await deps.bus.publish(row.topic, row.eventType, row.payload);
      } catch (error) {
        failed += 1;
        deps.logger.warn("event_outbox_publish_failed", {
          outbox_id: row.id,
          event_id: row.eventId,
          event_type: row.eventType,
          topic: row.topic,
          attempts: row.attempts,
          error
        });
        try {
          await deps.outbox.markFailed({ id: row.id, error: errorMessage(error) });
        } catch (markError) {
          deps.logger.warn("event_outbox_mark_failed_error", { outbox_id: row.id, error: markError });
        }
        continue;
      }
      try {
        // R21 加固（A4 发布统计不虚增）：markPublished 带 status='pending' CAS，返回是否真的更新了行——
        // 并发 drain 抢先标记过的行这里拿 false，published 不重复计数。
        const marked = await deps.outbox.markPublished({ id: row.id, at: now() });
        if (marked) {
          published += 1;
        }
      } catch (markError) {
        // publish 已成功但标记失败——下一轮 drain 会重发（重复投递，消费端幂等兜底）。留 warn 供排查。
        deps.logger.warn("event_outbox_mark_published_error", {
          outbox_id: row.id,
          event_id: row.eventId,
          error: markError
        });
      }
    }
    // R21 加固（A3 防无界增长）：顺带清掉保留窗口外的已发布行。best-effort——清理失败只 warn，绝不影响
    // drain 主流程（下一轮再清）。
    let purged = 0;
    try {
      purged = await deps.outbox.purgePublishedBefore({
        cutoff: new Date(now().getTime() - PUBLISHED_RETENTION_MS),
        limit: PURGE_BATCH_LIMIT
      });
    } catch (purgeError) {
      deps.logger.warn("event_outbox_purge_failed", { error: purgeError });
    }
    return { scanned: rows.length, published, failed, purged };
  }

  return (options = {}) => {
    // 进行中的 drain 未结束则复用它——避免并发重复发。复用方拿到的可能不含自己刚入队的行，但该行仍是
    // pending，下一次即席/定时 drain 会补发，绝不丢（消费端另按全量重拉对账）。
    if (inFlight) {
      return inFlight;
    }
    const limit = options.limit ?? DEFAULT_DRAIN_BATCH;
    inFlight = runOnce(limit).finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}
