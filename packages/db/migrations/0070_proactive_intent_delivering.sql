-- R21 加固（ProactiveIntent 并发投递幂等）：status 枚举加 'delivering' 在途态。
-- 修的裂缝：撞 suppression_key 且既有行 status='created' 时直接复用投递（R20 REL-2 的崩溃恢复腿），
-- 恢复扫描 listRecoverable 也无并发防护——两个并发调用会各自跑完整投递副作用，conversation_message/
-- action_card 通道无幂等，同一条主动打扰被双投。修法：投递方必须先经 claimProactiveIntentForDelivery
-- 把行从 created 原子领取到 delivering（UPDATE ... WHERE status 前置条件），领取成功才执行投递副作用；
-- 投递完成再从 delivering 顶到 delivered/suppressed 终态。投递中途崩溃的行停在 delivering，由恢复扫描
-- 按停滞阈值领回重投。
-- 幂等写法：DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT 成对出现，migration-audit replay 整链重跑安全
-- （同 0047 的 CHECK 翻转约定；表量小，无需 NOT VALID 分步）。仅放宽枚举（超集），既有行全部满足新约束。
ALTER TABLE "proactive_intents" DROP CONSTRAINT IF EXISTS "proactive_intents_status_ck";
--> statement-breakpoint
ALTER TABLE "proactive_intents" ADD CONSTRAINT "proactive_intents_status_ck"
  CHECK ("status" IN ('created','delivering','delivered','suppressed'));
