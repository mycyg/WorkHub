ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "objective_id" uuid REFERENCES "objectives"("id") ON DELETE SET NULL;
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "task_plan_id" uuid REFERENCES "task_plans"("id") ON DELETE SET NULL;
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "objective_id" uuid REFERENCES "objectives"("id") ON DELETE SET NULL;
ALTER TABLE "cost_ledger_entries" ADD COLUMN IF NOT EXISTS "task_plan_id" uuid REFERENCES "task_plans"("id") ON DELETE SET NULL;
ALTER TABLE "cost_ledger_entries" ADD COLUMN IF NOT EXISTS "objective_id" uuid REFERENCES "objectives"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "agent_runs_objective_id_idx" ON "agent_runs" ("objective_id");
CREATE INDEX IF NOT EXISTS "usage_records_task_plan_id_idx" ON "usage_records" ("task_plan_id");
CREATE INDEX IF NOT EXISTS "usage_records_objective_id_idx" ON "usage_records" ("objective_id");
CREATE INDEX IF NOT EXISTS "cost_ledger_entries_task_plan_id_idx" ON "cost_ledger_entries" ("task_plan_id");
CREATE INDEX IF NOT EXISTS "cost_ledger_entries_objective_id_idx" ON "cost_ledger_entries" ("objective_id");
