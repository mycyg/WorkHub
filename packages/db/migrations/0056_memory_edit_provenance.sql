-- R14 批 MEM（记忆可见可治理，2026-07-14 用户拍板范围）：user_memories 补「人工编辑留痕」两列。
-- 侦察结论（见 r14-release-readiness/03-mem-design.md §1）：出处字段大半已有（source_run_id/created_at/
-- deleted_at），真正缺的只有「PATCH 人工编辑正文时是谁在什么时候改的」——这是唯一需要新迁移的地方。
-- 两列均可空：AI/夜间晋升写入的记忆此列恒为 NULL，诚实区分「AI 学到的」与「人改过的」；历史行不受影响，
-- 既有查询（listForUser 等）不投影这两列也零回归。
-- ADD COLUMN IF NOT EXISTS + 条件化 ADD CONSTRAINT 保证重放安全（migration-audit 的 replay 阶段整链重跑）。
ALTER TABLE "user_memories" ADD COLUMN IF NOT EXISTS "edited_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "user_memories" ADD COLUMN IF NOT EXISTS "edited_at" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_memories_edited_by_user_id_users_id_fk'
      AND conrelid = 'user_memories'::regclass
  ) THEN
    ALTER TABLE "user_memories"
      ADD CONSTRAINT "user_memories_edited_by_user_id_users_id_fk"
      FOREIGN KEY ("edited_by_user_id") REFERENCES "users"("id") ON DELETE set null;
  END IF;
END $$;
