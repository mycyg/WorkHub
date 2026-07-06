-- R9.5 OKR foundation: objectives are planning context and dashboard lenses, never a hard gate.
CREATE TABLE IF NOT EXISTS "objectives" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "title" varchar(256) NOT NULL,
  "description_md" text,
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "progress_pct" integer NOT NULL DEFAULT 0,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "objectives_status_ck" CHECK ("status" IN ('active','paused','done','cancelled')),
  CONSTRAINT "objectives_progress_pct_ck" CHECK ("progress_pct" >= 0 AND "progress_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "key_results" (
  "id" uuid PRIMARY KEY NOT NULL,
  "objective_id" uuid NOT NULL REFERENCES "objectives"("id") ON DELETE cascade,
  "seq" integer NOT NULL,
  "title" varchar(256) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'on_track',
  "progress_pct" integer NOT NULL DEFAULT 0,
  "target_value" varchar(64),
  "current_value" varchar(64),
  "unit" varchar(64),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "key_results_status_ck" CHECK ("status" IN ('on_track','at_risk','done','cancelled')),
  CONSTRAINT "key_results_progress_pct_ck" CHECK ("progress_pct" >= 0 AND "progress_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "objective_work_item_links" (
  "objective_id" uuid NOT NULL REFERENCES "objectives"("id") ON DELETE cascade,
  "work_item_id" uuid NOT NULL REFERENCES "work_items"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "task_plans" DROP CONSTRAINT IF EXISTS "task_plans_objective_id_objectives_id_fk";
--> statement-breakpoint
ALTER TABLE "task_plans" ADD CONSTRAINT "task_plans_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "objectives"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "objectives_workspace_status_idx" ON "objectives" ("workspace_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "objectives_created_by_user_id_idx" ON "objectives" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "objectives_updated_at_idx" ON "objectives" ("updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "key_results_objective_seq_idx" ON "key_results" ("objective_id","seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "key_results_status_idx" ON "key_results" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "objective_work_item_links_objective_work_item_uq" ON "objective_work_item_links" ("objective_id","work_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "objective_work_item_links_workspace_idx" ON "objective_work_item_links" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "objective_work_item_links_work_item_idx" ON "objective_work_item_links" ("work_item_id");
