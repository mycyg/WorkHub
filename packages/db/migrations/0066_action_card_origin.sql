-- R15 批 D4（找人升级为交互卡 · 系统行动卡插入路径解耦）：给 action_cards 加 origin 标记，把
-- 「LLM 观察者产的卡」与「服务端规则直接插的卡（如 ddl-chase 找人）」区分开，让后者能绕过观察者的
-- activeCardId/analyzed_to_seq 水位线状态机安全插卡。additive-only，replay 幂等安全：
--   1) ADD COLUMN IF NOT EXISTS origin，NOT NULL DEFAULT 'observer'——既有卡全部是观察者产的，默认值
--      语义正确，无需回填 UPDATE。
--   2) 加 CHECK origin IN ('observer','system')，用 pg_constraint 查重的 DO 块保证重放不重复添加。
--   3) DROP NOT NULL on analyzed_to_seq——系统卡不挂水位线（analyzed_to_seq 是观察者「分析到第几条
--      消息」的语义，系统卡与之无关），置 NULL。DROP NOT NULL 幂等（列已可空时为 no-op）。既有
--      action_cards_analyzed_to_seq_ck（BETWEEN 0 AND ...）对 NULL 天然放行（CHECK 对 NULL 求值即通过），
--      无需改动那条 CHECK。
--
-- 观察者的读写路径（createOrAppendCard 认领 active card）在 repository 层显式限定 origin='observer'，
-- 系统卡永不被观察者追加/接管；行为零变化由 schema.test + repository 测试钉死。
ALTER TABLE "action_cards" ADD COLUMN IF NOT EXISTS "origin" varchar(16) NOT NULL DEFAULT 'observer';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'action_cards_origin_ck'
      AND conrelid = 'action_cards'::regclass
  ) THEN
    ALTER TABLE "action_cards"
      ADD CONSTRAINT "action_cards_origin_ck"
      CHECK ("origin" IN ('observer','system'));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "action_cards" ALTER COLUMN "analyzed_to_seq" DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_cards_conversation_origin_idx"
  ON "action_cards" ("conversation_id","origin");
