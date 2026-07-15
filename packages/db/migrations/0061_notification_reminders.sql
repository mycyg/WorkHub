-- R15 批 A（统一调度器 + 提醒阶梯 · 01-batch-a-pipeline.md §A2）：通知表加两列驱动 24h 提醒阶梯。
-- next_remind_at = 下次该复活提醒的时刻（NULL = 不再提醒：达阶梯上限、或被抑制/已读/已归档时置空）；
-- reminder_count = 已提醒次数（阶梯计数，达上限后 next_remind_at 置 NULL 停止续期）。
-- approval.routed 类通知创建时置 next_remind_at = 创建时刻 + 24h；notification-reminder pulse 任务扫
-- 「next_remind_at <= now 且未读未归档」的行，逐条 reminder_count++ 并复活推 SSE，达 3 次后停。
-- 只加列不改既有列（additive）；ADD COLUMN IF NOT EXISTS 保证 migration-audit replay 阶段整链重跑安全。
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "next_remind_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "reminder_count" integer NOT NULL DEFAULT 0;--> statement-breakpoint

-- 提醒扫描热路径：WHERE next_remind_at <= now AND read_at IS NULL AND archived_at IS NULL
-- ORDER BY next_remind_at。部分索引只覆盖待提醒的少数行（绝大多数通知 next_remind_at 为 NULL），
-- 避免每 tick 全表扫。CREATE INDEX IF NOT EXISTS 保证 replay 安全。
CREATE INDEX IF NOT EXISTS "notifications_next_remind_at_idx"
  ON "notifications" ("next_remind_at")
  WHERE "next_remind_at" IS NOT NULL;
