CREATE TABLE IF NOT EXISTS "ai_feedback" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "subject_type" varchar(24) NOT NULL,
  "subject_id" uuid NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "verdict" varchar(16) NOT NULL,
  "note" varchar(200),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ai_feedback_subject_type_ck"
    CHECK ("subject_type" IN ('conversation_message','proposal','action_card_item')),
  CONSTRAINT "ai_feedback_verdict_ck"
    CHECK ("verdict" IN ('useful','not_useful'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_feedback_subject_user_uq"
  ON "ai_feedback" ("subject_type","subject_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_feedback_curation_idx"
  ON "ai_feedback" ("workspace_id","subject_type","verdict","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_feedback_subject_idx"
  ON "ai_feedback" ("subject_type","subject_id");
