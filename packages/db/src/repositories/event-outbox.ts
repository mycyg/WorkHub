import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { eventOutbox } from "../schema/index.js";

// R20 P2-01（事务性 outbox · 见 0069 迁移）：领域事件与业务写共一事务落这张表，事务提交后由 drain 循环
// （apps/api workers/event-outbox-drain）把 pending 行 publish 到 SSE/事件总线，publish 成功才置
// status='published'。这层只做数据搬运：事务内入队原语 + drain 用的读/标记原语；抑制/触发时机/信封组装
// 全部留在应用层。

export type EventOutboxRow = typeof eventOutbox.$inferSelect;

export type EnqueueEventOutboxInput = {
  // 测试可注入确定性 id；生产默认 randomUUID（id 列无 DB 默认值，见 0069）。
  id?: string;
  workspaceId: string;
  topic: string;
  eventType: string;
  // 幂等键 = 事件信封里的 event_id（唯一约束兜「一行一事件」；消费端按 event_id 对账去重）。
  eventId: string;
  // 已序列化好的完整事件信封——drain 原样 publish 的不可变快照。
  payload: Record<string, unknown>;
};

// 事务内入队原语：与业务写共用同一个 tx（drizzle 事务对象结构上满足这里用到的 insert 构造器），
// 保证「业务行 + outbox 行」原子提交，杜绝 commit 与 publish 之间的丢投裂缝。调用方在业务写事务里调它。
export async function enqueueEventOutbox(
  tx: Pick<WorkHubDb, "insert">,
  input: EnqueueEventOutboxInput
): Promise<void> {
  await tx.insert(eventOutbox).values({
    id: input.id ?? randomUUID(),
    workspaceId: input.workspaceId,
    topic: input.topic,
    eventType: input.eventType,
    eventId: input.eventId,
    payload: input.payload,
    status: "pending",
    attempts: 0
  });
}

export type EventOutboxRepository = {
  // drain 一批：只挑 pending 行，按落库顺序（created_at, id）升序，cap limit（内部再夹一层硬上限防打爆）。
  listPending: (input: { limit: number }) => Promise<EventOutboxRow[]>;
  // publish 成功后置 published——带 status='pending' 前置条件，避免与并发 drain 竞态重复标记同一行。
  markPublished: (input: { id: string; at?: Date }) => Promise<void>;
  // publish 失败：attempts+1、记 last_error，保持 pending 等下一轮 drain 重放（禁空 catch 吞错）。
  markFailed: (input: { id: string; error: string }) => Promise<void>;
};

const LIST_PENDING_HARD_CAP = 500;
const LAST_ERROR_MAX_CHARS = 1000;

export function createEventOutboxRepository(db: WorkHubDb): EventOutboxRepository {
  return {
    async listPending(input) {
      const limit = Math.max(1, Math.min(Math.trunc(input.limit), LIST_PENDING_HARD_CAP));
      return db
        .select()
        .from(eventOutbox)
        .where(eq(eventOutbox.status, "pending"))
        .orderBy(asc(eventOutbox.createdAt), asc(eventOutbox.id))
        .limit(limit);
    },
    async markPublished(input) {
      await db
        .update(eventOutbox)
        .set({ status: "published", publishedAt: input.at ?? new Date(), lastError: null })
        .where(and(eq(eventOutbox.id, input.id), eq(eventOutbox.status, "pending")));
    },
    async markFailed(input) {
      await db
        .update(eventOutbox)
        .set({ attempts: sql`${eventOutbox.attempts} + 1`, lastError: input.error.slice(0, LAST_ERROR_MAX_CHARS) })
        .where(and(eq(eventOutbox.id, input.id), eq(eventOutbox.status, "pending")));
    }
  };
}
