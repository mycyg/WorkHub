-- B-R9.2-3（branch-review 竞态）：人工重派后，旧终态子 run 仍匹配「item dispatched」
-- 条件，恢复 tick 会把旧结果 settle 到新一轮 item 上。给派发加代际：
-- item 每次被派发 dispatch_epoch+1，run 记住自己所属的代，结算/恢复只认同代。
ALTER TABLE "task_plan_items" ADD COLUMN IF NOT EXISTS "dispatch_epoch" integer NOT NULL DEFAULT 0;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "task_plan_item_epoch" integer;
-- 回填：存量军团 run 归入第 0 代（与存量 item 的默认代一致），避免恢复 tick 漏掉在飞的旧数据。
UPDATE "agent_runs" SET "task_plan_item_epoch" = 0
  WHERE "task_plan_item_id" IS NOT NULL AND "task_plan_item_epoch" IS NULL;
