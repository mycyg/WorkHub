CREATE TABLE IF NOT EXISTS "memory_conflicts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "source_run_id" uuid REFERENCES "agent_runs"("id") ON DELETE set null,
  "category" varchar(32) NOT NULL,
  "key" varchar(256) NOT NULL,
  "current_value_md" text NOT NULL,
  "incoming_value_md" text NOT NULL,
  "base_value_md" text,
  "candidate_memory_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" varchar(16) NOT NULL DEFAULT 'open',
  "resolution" varchar(32),
  "resolved_value_md" text,
  "resolved_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "memory_conflicts_status_ck" CHECK ("status" IN ('open','resolved')),
  CONSTRAINT "memory_conflicts_resolution_ck" CHECK ("resolution" IS NULL OR "resolution" IN ('keep_current','accept_incoming','merge_both','edit_memory'))
);

CREATE INDEX IF NOT EXISTS "memory_conflicts_workspace_user_status_idx" ON "memory_conflicts" ("workspace_id","user_id","status");
CREATE INDEX IF NOT EXISTS "memory_conflicts_source_run_id_idx" ON "memory_conflicts" ("source_run_id");
CREATE INDEX IF NOT EXISTS "memory_conflicts_created_at_idx" ON "memory_conflicts" ("created_at");
