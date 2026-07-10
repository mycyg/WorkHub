CREATE TABLE IF NOT EXISTS "agent_memory" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "agent_context_id" uuid NOT NULL,
  "category" varchar(32) NOT NULL,
  "key" varchar(256) NOT NULL,
  "value_md" text NOT NULL,
  "confidence" double precision DEFAULT 0.5 NOT NULL,
  "source_run_id" uuid,
  "base_version" integer DEFAULT 0 NOT NULL,
  "current_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_memory_versions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "memory_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "base_version" integer DEFAULT 0 NOT NULL,
  "value_md" text NOT NULL,
  "source_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_memory" ADD CONSTRAINT "agent_memory_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_memory" ADD CONSTRAINT "agent_memory_agent_context_id_task_plan_items_id_fk" FOREIGN KEY ("agent_context_id") REFERENCES "public"."task_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_memory" ADD CONSTRAINT "agent_memory_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_memory_versions" ADD CONSTRAINT "agent_memory_versions_memory_id_agent_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."agent_memory"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_memory_versions" ADD CONSTRAINT "agent_memory_versions_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_memory_context_key_uq" ON "agent_memory" ("workspace_id","agent_context_id","category","key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_memory_workspace_context_idx" ON "agent_memory" ("workspace_id","agent_context_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_memory_source_run_id_idx" ON "agent_memory" ("source_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_memory_confidence_idx" ON "agent_memory" ("confidence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_memory_updated_at_idx" ON "agent_memory" ("updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_memory_versions_memory_version_uq" ON "agent_memory_versions" ("memory_id","version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_memory_versions_memory_id_idx" ON "agent_memory_versions" ("memory_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_memory_versions_source_run_id_idx" ON "agent_memory_versions" ("source_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_memory_versions_created_at_idx" ON "agent_memory_versions" ("created_at");
