CREATE TABLE IF NOT EXISTS "memory_conflicts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "source_run_id" uuid,
  "category" varchar(32) NOT NULL,
  "key" varchar(256) NOT NULL,
  "current_value_md" text NOT NULL,
  "incoming_value_md" text NOT NULL,
  "base_value_md" text,
  "candidate_memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" varchar(16) DEFAULT 'open' NOT NULL,
  "resolution" varchar(32),
  "resolved_value_md" text,
  "resolved_by_user_id" uuid,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_conflicts" ADD CONSTRAINT "memory_conflicts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_conflicts" ADD CONSTRAINT "memory_conflicts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_conflicts" ADD CONSTRAINT "memory_conflicts_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_conflicts" ADD CONSTRAINT "memory_conflicts_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_conflicts_workspace_user_status_idx" ON "memory_conflicts" ("workspace_id","user_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_conflicts_source_run_id_idx" ON "memory_conflicts" ("source_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_conflicts_resolved_by_user_id_idx" ON "memory_conflicts" ("resolved_by_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memory_conflicts_open_key_uq"
  ON "memory_conflicts" ("workspace_id","user_id","category","key")
  WHERE "status" = 'open';
