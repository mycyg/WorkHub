-- R9.5 task/objective budget scopes: keep run lineage after persistence so cost ledger can aggregate child runs by plan and OKR.
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "objective_id" uuid REFERENCES "objectives"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "task_plan_id" uuid REFERENCES "task_plans"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "objective_id" uuid REFERENCES "objectives"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_objective_id_idx" ON "agent_runs" ("objective_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_task_plan_id_idx" ON "usage_records" ("task_plan_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_objective_id_idx" ON "usage_records" ("objective_id");
