-- R9.2 Agent Army dispatch lineage.
-- Child runs remain ordinary agent_runs rows; claim, heartbeat, recovery, and budget code paths are reused.
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "parent_run_id" uuid REFERENCES "agent_runs"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "task_plan_id" uuid REFERENCES "task_plans"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "task_plan_item_id" uuid REFERENCES "task_plan_items"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "agent_role" varchar(16);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "objective_md" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_role_ck"
    CHECK ("agent_role" IS NULL OR "agent_role" IN ('research','produce','review','integrate'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_parent_run_id_idx" ON "agent_runs" ("parent_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_task_plan_id_idx" ON "agent_runs" ("task_plan_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_task_plan_item_id_idx" ON "agent_runs" ("task_plan_item_id");
