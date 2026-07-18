-- R20 P2-01（事务性 outbox）：修「会话消息 DB commit 与 publish 之间无 outbox/replay」这条丢投裂缝。
-- 现状：会话消息（conversation_messages）先落库提交事务，再向 SSE/事件总线 best-effort publish；两步之间
-- 进程崩溃或 publish 抛错，则 conversation.message.created 永久丢失——在线客户端不会收到该消息的推送
-- （SSE 是 resume_mode='fresh' 不重放，只有重连才全量补拉对账）。
-- 修法：领域事件与业务写落在同一事务里写这张 event_outbox 表，事务提交后由 drain 循环
-- （apps/api workers/event-outbox-drain）把 pending 行 publish，publish 成功才置 status='published'。
-- 崩溃/重启后 drain 重放未完成行；event_id 是幂等键，消费端本就按全量重拉对账，重复投递无害。
-- 当前仅承载 conversation.message.created（人到人 DM/协同/主区人类消息），其它 publish 点留作后续。
-- 全 additive；CREATE TABLE / CREATE INDEX IF NOT EXISTS 保证 migration-audit replay 整链重跑安全
-- （同 0061/0062/0063 约定）。
CREATE TABLE IF NOT EXISTS "event_outbox" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "topic" text NOT NULL,
  "event_type" text NOT NULL,
  "event_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "published_at" timestamp with time zone,
  CONSTRAINT "event_outbox_status_ck" CHECK ("status" IN ('pending','published')),
  CONSTRAINT "event_outbox_attempts_ck" CHECK ("attempts" >= 0)
);
--> statement-breakpoint

-- event_id 幂等键：一行一事件，唯一约束兜住重复入队。
CREATE UNIQUE INDEX IF NOT EXISTS "event_outbox_event_id_uq"
  ON "event_outbox" ("event_id");
--> statement-breakpoint

-- drain 热路径：只扫 pending 行、按落库顺序（created_at, id）发。部分索引不给已发行付索引成本。
CREATE INDEX IF NOT EXISTS "event_outbox_pending_idx"
  ON "event_outbox" ("created_at","id")
  WHERE "status" = 'pending';
