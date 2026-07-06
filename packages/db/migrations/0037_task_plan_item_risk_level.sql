ALTER TABLE "task_plan_items" ADD COLUMN IF NOT EXISTS "risk_level" varchar(8) DEFAULT 'medium' NOT NULL;
--> statement-breakpoint
ALTER TABLE "task_plan_items" DROP CONSTRAINT IF EXISTS "task_plan_items_risk_level_ck";
--> statement-breakpoint
ALTER TABLE "task_plan_items" ADD CONSTRAINT "task_plan_items_risk_level_ck" CHECK ("risk_level" IN ('low','medium','high'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_plan_items_risk_level_idx" ON "task_plan_items" ("risk_level");
