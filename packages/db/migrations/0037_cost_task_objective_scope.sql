ALTER TABLE "agent_runs" ADD COLUMN "objective_id" uuid REFERENCES "objectives"("id") ON DELETE SET NULL;
ALTER TABLE "usage_records" ADD COLUMN "task_plan_id" uuid REFERENCES "task_plans"("id") ON DELETE SET NULL;
ALTER TABLE "usage_records" ADD COLUMN "objective_id" uuid REFERENCES "objectives"("id") ON DELETE SET NULL;
ALTER TABLE "cost_ledger_entries" ADD COLUMN "task_plan_id" uuid REFERENCES "task_plans"("id") ON DELETE SET NULL;
ALTER TABLE "cost_ledger_entries" ADD COLUMN "objective_id" uuid REFERENCES "objectives"("id") ON DELETE SET NULL;

CREATE INDEX "agent_runs_objective_id_idx" ON "agent_runs" ("objective_id");
CREATE INDEX "usage_records_task_plan_id_idx" ON "usage_records" ("task_plan_id");
CREATE INDEX "usage_records_objective_id_idx" ON "usage_records" ("objective_id");
CREATE INDEX "cost_ledger_entries_task_plan_id_idx" ON "cost_ledger_entries" ("task_plan_id");
CREATE INDEX "cost_ledger_entries_objective_id_idx" ON "cost_ledger_entries" ("objective_id");
