-- R13 批 C1（会话上下文压缩）：project_conversations 加滚动摘要的两列——context_summary_md 是当前累积
-- 摘要正文（null=从未压缩过），context_summary_through_seq 是摘要已经覆盖到的消息 seq（含），default 0
-- 表示"还没压缩过任何东西"。apps/api/src/services/conversation-turns.ts 的 createTurn 用这两列判断何时
-- 该刷新摘要、往 system prompt 里注入什么内容——纯 additive，存量会话零改动直接沿用 null/0 的初始值。
ALTER TABLE "project_conversations" ADD COLUMN IF NOT EXISTS "context_summary_md" text;
--> statement-breakpoint
ALTER TABLE "project_conversations" ADD COLUMN IF NOT EXISTS "context_summary_through_seq" bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
-- migration-audit 的 replay 阶段会把整链再跑一遍——ADD CONSTRAINT 没有 IF NOT EXISTS，
-- 必须走 pg_constraint 守卫的 DO 块（同 0040/0043/0046 的既有先例），否则二次应用直接炸。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_conversations_context_summary_through_seq_ck'
      AND conrelid = 'project_conversations'::regclass
  ) THEN
    ALTER TABLE "project_conversations"
      ADD CONSTRAINT "project_conversations_context_summary_through_seq_ck"
      CHECK ("context_summary_through_seq" BETWEEN 0 AND 9007199254740991);
  END IF;
END $$;
