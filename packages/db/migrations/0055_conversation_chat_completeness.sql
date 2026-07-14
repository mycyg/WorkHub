-- R14 批 CHAT（聊天基础完整度）：给 conversation_messages 补齐「编辑 / 墓碑删除 / 引用回复 / 置顶」的
-- 持久化列，并新增 message_reactions（精选五键 emoji 反应，存 ASCII slug）与 conversation_read_cursors
-- （已读游标，聚合式「已读 N/M」+ 未读分割线的地基）。全部 additive：
--   * conversation_messages 的六列都可空——历史消息行不受影响（append 语义不变，seq 不回收）。
--   * 两张新表 CREATE TABLE IF NOT EXISTS，重放安全（migration-audit 的 replay 阶段整链重跑）。
-- 语义（服务端强制，见 apps/api/src/services/conversations.ts）：
--   * 编辑=改 content_json.text + 置 edited_at（仅本人、仅 text、15 分钟窗、目标未删除）。
--   * 删除=墓碑：deleted_at + deleted_by_user_id 置位、content_json 清为 {}（不物理删、seq 不回收）。
--   * 引用=reply_to_message_id 指向同会话的一条已存在消息；目标事后被删只是变墓碑，引用列不置空
--     （所以只挂 (conversation_id, reply_to_message_id) 复合外键保「同会话」，不挂 users 那种 set null
--     的单列外键——墓碑要保住这条引用边，读时 join 判定目标是否已删）。
--   * 置顶=pinned_at + pinned_by_user_id 置位；读取端点按 seq 降序 cap 50，故建 pinned 部分索引。
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "deleted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "reply_to_message_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "pinned_by_user_id" uuid;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_messages_deleted_by_user_id_users_id_fk'
      AND conrelid = 'conversation_messages'::regclass
  ) THEN
    ALTER TABLE "conversation_messages"
      ADD CONSTRAINT "conversation_messages_deleted_by_user_id_users_id_fk"
      FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE set null;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_messages_pinned_by_user_id_users_id_fk'
      AND conrelid = 'conversation_messages'::regclass
  ) THEN
    ALTER TABLE "conversation_messages"
      ADD CONSTRAINT "conversation_messages_pinned_by_user_id_users_id_fk"
      FOREIGN KEY ("pinned_by_user_id") REFERENCES "users"("id") ON DELETE set null;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_messages_reply_to_conversation_fk'
      AND conrelid = 'conversation_messages'::regclass
  ) THEN
    ALTER TABLE "conversation_messages"
      ADD CONSTRAINT "conversation_messages_reply_to_conversation_fk"
      FOREIGN KEY ("conversation_id","reply_to_message_id") REFERENCES "conversation_messages"("conversation_id","id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_messages_pinned_idx"
  ON "conversation_messages" ("conversation_id","seq") WHERE "pinned_at" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_reactions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "message_id" uuid NOT NULL REFERENCES "conversation_messages"("id") ON DELETE cascade,
  "conversation_id" uuid NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "reaction_key" varchar(24) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "message_reactions_reaction_key_ck"
    CHECK ("reaction_key" IN ('approve','disagree','done','question','watch'))
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'message_reactions_conversation_message_fk'
      AND conrelid = 'message_reactions'::regclass
  ) THEN
    ALTER TABLE "message_reactions"
      ADD CONSTRAINT "message_reactions_conversation_message_fk"
      FOREIGN KEY ("conversation_id","message_id") REFERENCES "conversation_messages"("conversation_id","id") ON DELETE cascade;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_reactions_message_user_key_uq"
  ON "message_reactions" ("message_id","user_id","reaction_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_reactions_message_id_idx" ON "message_reactions" ("message_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_read_cursors" (
  "id" uuid PRIMARY KEY NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "project_conversations"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "last_read_seq" bigint NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "conversation_read_cursors_last_read_seq_ck" CHECK ("last_read_seq" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_read_cursors_conversation_user_uq"
  ON "conversation_read_cursors" ("conversation_id","user_id");
