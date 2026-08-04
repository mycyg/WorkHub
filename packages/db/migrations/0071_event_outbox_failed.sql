-- R21 加固（event_outbox 重试封顶 + 死信）：status 枚举加 'failed' 终态。
-- 修的裂缝：markFailed 只做 attempts+1、行永远留在 pending——坏 payload/永久性 publish 失败会被 drain
-- 无限重放（每轮都占批次名额、刷告警日志），既无上限也无死信可查。修法：markFailed 在 attempts+1 达
-- MAX_PUBLISH_ATTEMPTS（仓储层常量，当前 10）时置 status='failed'（终态，listPending 的 status='pending'
-- 谓词天然不再捞它），last_error 留存供排障/人工重放。
-- 幂等写法：DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT 成对出现，migration-audit replay 整链重跑安全
-- （同 0070 约定）。仅放宽枚举（超集），既有行全部满足新约束。
ALTER TABLE "event_outbox" DROP CONSTRAINT IF EXISTS "event_outbox_status_ck";
--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_status_ck"
  CHECK ("status" IN ('pending','published','failed'));
