-- R9.5 OKR foundation.
-- Objectives are soft planning/observation lenses: work_items do not need an objective link to run.
CREATE TABLE IF NOT EXISTS "objectives" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "title" varchar(256) NOT NULL,
  "description_md" text,
  "owner_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "progress_percent" integer NOT NULL DEFAULT 0,
  "progress_updated_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "objectives_status_ck" CHECK ("status" IN ('active','paused','done','archived')),
  CONSTRAINT "objectives_progress_percent_ck" CHECK ("progress_percent" >= 0 AND "progress_percent" <= 100)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "key_results" (
  "id" uuid PRIMARY KEY NOT NULL,
  "objective_id" uuid NOT NULL REFERENCES "objectives"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "seq" integer NOT NULL,
  "title" varchar(256) NOT NULL,
  "target_value" numeric(14,4),
  "current_value" numeric(14,4),
  "unit" varchar(32),
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "progress_percent" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "key_results_status_ck" CHECK ("status" IN ('active','done','at_risk','cancelled')),
  CONSTRAINT "key_results_progress_percent_ck" CHECK ("progress_percent" >= 0 AND "progress_percent" <= 100)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "objective_work_item_links" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "objective_id" uuid NOT NULL REFERENCES "objectives"("id") ON DELETE cascade,
  "work_item_id" uuid NOT NULL REFERENCES "work_items"("id") ON DELETE cascade,
  "linked_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "objectives_workspace_status_idx" ON "objectives" ("workspace_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "objectives_workspace_updated_idx" ON "objectives" ("workspace_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "objectives_owner_user_id_idx" ON "objectives" ("owner_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "key_results_objective_seq_uq" ON "key_results" ("objective_id","seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "key_results_workspace_objective_idx" ON "key_results" ("workspace_id","objective_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "key_results_workspace_status_idx" ON "key_results" ("workspace_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "objective_work_item_links_objective_work_item_uq" ON "objective_work_item_links" ("objective_id","work_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "objective_work_item_links_workspace_objective_idx" ON "objective_work_item_links" ("workspace_id","objective_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "objective_work_item_links_workspace_work_item_idx" ON "objective_work_item_links" ("workspace_id","work_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "objective_work_item_links_linked_by_user_id_idx" ON "objective_work_item_links" ("linked_by_user_id");
