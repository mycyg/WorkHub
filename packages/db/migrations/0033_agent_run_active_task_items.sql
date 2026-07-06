-- R9.2 dispatcher child runs need parallel active rows on one work item.
-- Ordinary runs keep the original work-item mutex; task-plan child runs are deduped by item.
ALTER TABLE "task_plan_items" ADD COLUMN IF NOT EXISTS "active_run_id" uuid REFERENCES "agent_runs"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_plan_items_active_run_id_idx" ON "task_plan_items" ("active_run_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "agent_runs_work_item_active_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_runs_work_item_active_uq"
  ON "agent_runs" ("work_item_id")
  WHERE "status" in ('queued', 'running') AND "task_plan_item_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_runs_task_plan_item_active_uq"
  ON "agent_runs" ("task_plan_item_id")
  WHERE "status" in ('queued', 'running') AND "task_plan_item_id" IS NOT NULL;
