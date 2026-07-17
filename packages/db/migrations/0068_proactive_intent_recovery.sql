-- R20 REL-2（#P1-11 ProactiveIntent 崩溃恢复）：修「落 intent 后、投递前进程崩溃」这条丢投 bug。
-- 0063 里行以 status='created' 落库、suppression_key 全局唯一。原实现在 insert commit 后、投递/
-- markStatus 前若崩溃，行永远停在 created；同 key 重试撞唯一约束又被当成 duplicate 永久去重——这条主动
-- 打扰就此人间蒸发，且没有任何扫描能把它救回来。本迁移给 proactive_intents 加两列，让 created 变成
-- 「可恢复态」：
--   * attempt_count：兜底恢复扫描（pulse 任务 proactive-intent-recovery）每重投一次就 +1；达上限仍投不
--     成则封顶判 suppressed（delivered_via='stalled'），不让它永远滞留 created。
--   * delivery_payload：重投所需的投递上下文（通道 / 会话文案 / 是否降级 / 通知草稿）。恢复扫描手里只有
--     DB 行、没有原调用方的 intent 对象，故 record 时把这份上下文一并落库，重投时据此重建 intent。可空——
--     迁移前的历史 created 行没有它，扫描重建不出则直接判 stalled。
-- 全 additive（ADD COLUMN IF NOT EXISTS，只加列、不改不删既有列、不用并发建索引），单事务 replay 幂等
-- 安全，与 0061/0062/0067 同约定。
ALTER TABLE "proactive_intents" ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "proactive_intents" ADD COLUMN IF NOT EXISTS "delivery_payload" jsonb;
