-- R12 batch 0: conversation, action-card, AI preference, and local-execution routing foundation.
-- Message sequence allocation is owned by project_conversations.next_seq; writers must use
-- UPDATE ... SET next_seq = next_seq + 1 RETURNING next_seq. Never derive it from max(seq).
CREATE TABLE IF NOT EXISTS "project_conversations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "kind" varchar(16) NOT NULL,
  "title" varchar(256) NOT NULL,
  "parent_conversation_id" uuid REFERENCES "project_conversations"("id") ON DELETE set null,
  "source_message_id" uuid,
  "visibility" varchar(16) NOT NULL,
  "next_seq" bigint NOT NULL DEFAULT 0,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "deleted_at" timestamp with time zone,
  "deleted_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "project_conversations_kind_ck" CHECK ("kind" IN ('main','collab')),
  CONSTRAINT "project_conversations_visibility_ck" CHECK ("visibility" IN ('project','private')),
  CONSTRAINT "project_conversations_next_seq_ck" CHECK ("next_seq" BETWEEN 0 AND 9007199254740991),
  CONSTRAINT "project_conversations_source_parent_ck" CHECK ("source_message_id" IS NULL OR "parent_conversation_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_participants" (
  "id" uuid PRIMARY KEY NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "project_conversations"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "role" varchar(16) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "conversation_participants_role_ck" CHECK ("role" IN ('owner','member'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_messages" (
  "id" uuid PRIMARY KEY NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "project_conversations"("id") ON DELETE cascade,
  "seq" bigint NOT NULL,
  "sender_type" varchar(16) NOT NULL,
  "sender_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "kind" varchar(24) NOT NULL,
  "content_json" jsonb NOT NULL,
  "thread_root_id" uuid REFERENCES "conversation_messages"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "conversation_messages_seq_ck" CHECK ("seq" BETWEEN 0 AND 9007199254740991),
  CONSTRAINT "conversation_messages_sender_type_ck" CHECK ("sender_type" IN ('user','cuu','system')),
  CONSTRAINT "conversation_messages_kind_ck" CHECK ("kind" IN ('text','file_card','action_card','system_event','tool_note'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "action_cards" (
  "id" uuid PRIMARY KEY NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "project_conversations"("id") ON DELETE cascade,
  "message_id" uuid NOT NULL REFERENCES "conversation_messages"("id") ON DELETE cascade,
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "analyzed_to_seq" bigint NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "action_cards_status_ck" CHECK ("status" IN ('active','superseded')),
  CONSTRAINT "action_cards_analyzed_to_seq_ck" CHECK ("analyzed_to_seq" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "action_card_items" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "action_card_id" uuid NOT NULL REFERENCES "action_cards"("id") ON DELETE cascade,
  "ordinal" integer NOT NULL,
  "kind" varchar(16) NOT NULL,
  "title_md" text NOT NULL,
  "confidence" varchar(16) NOT NULL,
  "work_item_id" uuid REFERENCES "work_items"("id") ON DELETE set null,
  "run_id" uuid REFERENCES "agent_runs"("id") ON DELETE set null,
  "assignee_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "status" varchar(24) NOT NULL,
  "undo_deadline_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "action_card_items_ordinal_ck" CHECK ("ordinal" >= 0),
  CONSTRAINT "action_card_items_kind_ck" CHECK ("kind" IN ('execute','decide','observe')),
  CONSTRAINT "action_card_items_confidence_ck" CHECK ("confidence" IN ('high','mid','low')),
  CONSTRAINT "action_card_items_status_ck" CHECK ("status" IN ('running','done','undone','waiting_decision','dismissed','escalated')),
  CONSTRAINT "action_card_items_run_requires_work_item_ck" CHECK ("run_id" IS NULL OR "work_item_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_observer_state" (
  "conversation_id" uuid PRIMARY KEY NOT NULL REFERENCES "project_conversations"("id") ON DELETE cascade,
  "last_analyzed_seq" bigint NOT NULL DEFAULT 0,
  "active_card_id" uuid REFERENCES "action_cards"("id") ON DELETE set null,
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "conversation_observer_state_last_seq_ck" CHECK ("last_analyzed_seq" BETWEEN 0 AND 9007199254740991),
  CONSTRAINT "conversation_observer_state_failures_ck" CHECK ("consecutive_failures" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_ai_profiles" (
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "default_mode" smallint NOT NULL DEFAULT 3,
  "granular_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "dispatch_policy" varchar(16) NOT NULL DEFAULT 'auto',
  "cuu_proactivity" varchar(32) NOT NULL,
  "model_tier_pref" varchar(32),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_ai_profiles_default_mode_ck" CHECK ("default_mode" BETWEEN 1 AND 5),
  CONSTRAINT "user_ai_profiles_dispatch_policy_ck" CHECK ("dispatch_policy" IN ('auto','ask','manual'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_ai_governance" (
  "project_id" uuid PRIMARY KEY NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "observer_enabled" boolean NOT NULL DEFAULT true,
  "silence_window_secs" integer NOT NULL DEFAULT 60,
  "quiet_hours_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "granular_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "project_ai_governance_silence_window_ck" CHECK ("silence_window_secs" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "execution_hint" varchar(16) NOT NULL DEFAULT 'server';
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "source_conversation_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "source_action_card_item_id" uuid;
--> statement-breakpoint
ALTER TABLE "action_card_items" ADD COLUMN IF NOT EXISTS "workspace_id" uuid;
--> statement-breakpoint
ALTER TABLE "action_card_items" ADD COLUMN IF NOT EXISTS "project_id" uuid;
--> statement-breakpoint
ALTER TABLE "action_card_items" ADD COLUMN IF NOT EXISTS "conversation_id" uuid;
--> statement-breakpoint
UPDATE "action_card_items" AS aci
SET
  "workspace_id" = pc."workspace_id",
  "project_id" = pc."project_id",
  "conversation_id" = ac."conversation_id"
FROM "action_cards" AS ac
JOIN "project_conversations" AS pc ON pc."id" = ac."conversation_id"
WHERE aci."action_card_id" = ac."id"
  AND (
    aci."workspace_id" IS DISTINCT FROM pc."workspace_id"
    OR aci."project_id" IS DISTINCT FROM pc."project_id"
    OR aci."conversation_id" IS DISTINCT FROM ac."conversation_id"
  );
--> statement-breakpoint
ALTER TABLE "action_card_items" ALTER COLUMN "workspace_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "action_card_items" ALTER COLUMN "project_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "action_card_items" ALTER COLUMN "conversation_id" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_id_workspace_uq" ON "projects" ("id","workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_conversations_id_project_uq"
  ON "project_conversations" ("id","project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_conversations_id_project_workspace_uq"
  ON "project_conversations" ("id","project_id","workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_conversations_id_workspace_uq"
  ON "project_conversations" ("id","workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_items_id_project_workspace_uq"
  ON "work_items" ("id","project_id","workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_messages_conversation_id_uq"
  ON "conversation_messages" ("conversation_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "action_cards_conversation_id_uq"
  ON "action_cards" ("conversation_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "action_card_items_id_conversation_workspace_uq"
  ON "action_card_items" ("id","conversation_id","workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_runs_id_work_item_workspace_uq"
  ON "agent_runs" ("id","work_item_id","workspace_id");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_conversations_source_message_id_conversation_messages_id_fk'
      AND conrelid = 'project_conversations'::regclass
  ) THEN
    ALTER TABLE "project_conversations"
      ADD CONSTRAINT "project_conversations_source_message_id_conversation_messages_id_fk"
      FOREIGN KEY ("source_message_id") REFERENCES "conversation_messages"("id") ON DELETE set null;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'action_card_items_run_requires_work_item_ck'
      AND conrelid = 'action_card_items'::regclass
  ) THEN
    ALTER TABLE "action_card_items"
      ADD CONSTRAINT "action_card_items_run_requires_work_item_ck"
      CHECK ("run_id" IS NULL OR "work_item_id" IS NOT NULL);
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'action_card_items_conversation_scope_fk'
      AND conrelid = 'action_card_items'::regclass
  ) THEN
    ALTER TABLE "action_card_items"
      ADD CONSTRAINT "action_card_items_conversation_scope_fk"
      FOREIGN KEY ("conversation_id","project_id","workspace_id") REFERENCES "project_conversations"("id","project_id","workspace_id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'action_card_items_action_card_conversation_fk'
      AND conrelid = 'action_card_items'::regclass
  ) THEN
    ALTER TABLE "action_card_items"
      ADD CONSTRAINT "action_card_items_action_card_conversation_fk"
      FOREIGN KEY ("conversation_id","action_card_id") REFERENCES "action_cards"("conversation_id","id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'action_card_items_work_item_scope_fk'
      AND conrelid = 'action_card_items'::regclass
  ) THEN
    ALTER TABLE "action_card_items"
      ADD CONSTRAINT "action_card_items_work_item_scope_fk"
      FOREIGN KEY ("work_item_id","project_id","workspace_id") REFERENCES "work_items"("id","project_id","workspace_id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'action_card_items_run_scope_fk'
      AND conrelid = 'action_card_items'::regclass
  ) THEN
    ALTER TABLE "action_card_items"
      ADD CONSTRAINT "action_card_items_run_scope_fk"
      FOREIGN KEY ("run_id","work_item_id","workspace_id") REFERENCES "agent_runs"("id","work_item_id","workspace_id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_conversations_project_workspace_fk'
      AND conrelid = 'project_conversations'::regclass
  ) THEN
    ALTER TABLE "project_conversations"
      ADD CONSTRAINT "project_conversations_project_workspace_fk"
      FOREIGN KEY ("project_id","workspace_id") REFERENCES "projects"("id","workspace_id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_conversations_parent_project_fk'
      AND conrelid = 'project_conversations'::regclass
  ) THEN
    ALTER TABLE "project_conversations"
      ADD CONSTRAINT "project_conversations_parent_project_fk"
      FOREIGN KEY ("parent_conversation_id","project_id") REFERENCES "project_conversations"("id","project_id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_conversations_source_message_parent_fk'
      AND conrelid = 'project_conversations'::regclass
  ) THEN
    ALTER TABLE "project_conversations"
      ADD CONSTRAINT "project_conversations_source_message_parent_fk"
      FOREIGN KEY ("parent_conversation_id","source_message_id") REFERENCES "conversation_messages"("conversation_id","id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_messages_thread_root_conversation_fk'
      AND conrelid = 'conversation_messages'::regclass
  ) THEN
    ALTER TABLE "conversation_messages"
      ADD CONSTRAINT "conversation_messages_thread_root_conversation_fk"
      FOREIGN KEY ("conversation_id","thread_root_id") REFERENCES "conversation_messages"("conversation_id","id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'action_cards_conversation_message_fk'
      AND conrelid = 'action_cards'::regclass
  ) THEN
    ALTER TABLE "action_cards"
      ADD CONSTRAINT "action_cards_conversation_message_fk"
      FOREIGN KEY ("conversation_id","message_id") REFERENCES "conversation_messages"("conversation_id","id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_observer_state_active_card_conversation_fk'
      AND conrelid = 'conversation_observer_state'::regclass
  ) THEN
    ALTER TABLE "conversation_observer_state"
      ADD CONSTRAINT "conversation_observer_state_active_card_conversation_fk"
      FOREIGN KEY ("conversation_id","active_card_id") REFERENCES "action_cards"("conversation_id","id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_runs_execution_hint_ck'
      AND conrelid = 'agent_runs'::regclass
  ) THEN
    ALTER TABLE "agent_runs"
      ADD CONSTRAINT "agent_runs_execution_hint_ck"
      CHECK ("execution_hint" IN ('server','local','any'));
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_runs_source_conversation_workspace_ck'
      AND conrelid = 'agent_runs'::regclass
  ) THEN
    ALTER TABLE "agent_runs"
      ADD CONSTRAINT "agent_runs_source_conversation_workspace_ck"
      CHECK ("source_conversation_id" IS NULL OR "workspace_id" IS NOT NULL);
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_runs_source_action_item_conversation_ck'
      AND conrelid = 'agent_runs'::regclass
  ) THEN
    ALTER TABLE "agent_runs"
      ADD CONSTRAINT "agent_runs_source_action_item_conversation_ck"
      CHECK ("source_action_card_item_id" IS NULL OR "source_conversation_id" IS NOT NULL);
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_runs_source_conversation_workspace_fk'
      AND conrelid = 'agent_runs'::regclass
  ) THEN
    ALTER TABLE "agent_runs"
      ADD CONSTRAINT "agent_runs_source_conversation_workspace_fk"
      FOREIGN KEY ("source_conversation_id","workspace_id") REFERENCES "project_conversations"("id","workspace_id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_runs_source_action_item_conversation_fk'
      AND conrelid = 'agent_runs'::regclass
  ) THEN
    ALTER TABLE "agent_runs"
      ADD CONSTRAINT "agent_runs_source_action_item_conversation_fk"
      FOREIGN KEY ("source_action_card_item_id","source_conversation_id","workspace_id") REFERENCES "action_card_items"("id","conversation_id","workspace_id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_runs_source_conversation_id_project_conversations_id_fk'
      AND conrelid = 'agent_runs'::regclass
  ) THEN
    ALTER TABLE "agent_runs"
      ADD CONSTRAINT "agent_runs_source_conversation_id_project_conversations_id_fk"
      FOREIGN KEY ("source_conversation_id") REFERENCES "project_conversations"("id") ON DELETE set null;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_runs_source_action_card_item_id_action_card_items_id_fk'
      AND conrelid = 'agent_runs'::regclass
  ) THEN
    ALTER TABLE "agent_runs"
      ADD CONSTRAINT "agent_runs_source_action_card_item_id_action_card_items_id_fk"
      FOREIGN KEY ("source_action_card_item_id") REFERENCES "action_card_items"("id") ON DELETE set null;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_conversations_active_main_uq"
  ON "project_conversations" ("project_id") WHERE "kind" = 'main' AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_conversations_workspace_project_idx"
  ON "project_conversations" ("workspace_id","project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_conversations_project_created_idx"
  ON "project_conversations" ("project_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_conversations_parent_id_idx"
  ON "project_conversations" ("parent_conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_conversations_source_message_id_idx"
  ON "project_conversations" ("source_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_conversations_deleted_at_idx"
  ON "project_conversations" ("deleted_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_participants_conversation_user_uq"
  ON "conversation_participants" ("conversation_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_participants_user_id_idx"
  ON "conversation_participants" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_messages_conversation_seq_uq"
  ON "conversation_messages" ("conversation_id","seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_messages_cursor_idx"
  ON "conversation_messages" ("conversation_id","seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_messages_sender_user_id_idx"
  ON "conversation_messages" ("sender_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_messages_thread_root_id_idx"
  ON "conversation_messages" ("thread_root_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_cards_conversation_status_idx"
  ON "action_cards" ("conversation_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "action_cards_message_id_uq" ON "action_cards" ("message_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "action_card_items_card_ordinal_uq"
  ON "action_card_items" ("action_card_id","ordinal");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_card_items_scope_idx"
  ON "action_card_items" ("workspace_id","project_id","conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_card_items_work_item_id_idx" ON "action_card_items" ("work_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_card_items_run_id_idx" ON "action_card_items" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_card_items_assignee_status_idx"
  ON "action_card_items" ("assignee_user_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_observer_state_active_card_id_idx"
  ON "conversation_observer_state" ("active_card_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_ai_profiles_workspace_user_uq"
  ON "user_ai_profiles" ("workspace_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_ai_profiles_user_id_idx" ON "user_ai_profiles" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_execution_claim_idx"
  ON "agent_runs" ("execution_hint","status","lease_expires_at","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_source_conversation_id_idx"
  ON "agent_runs" ("source_conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_source_action_card_item_id_idx"
  ON "agent_runs" ("source_action_card_item_id");
