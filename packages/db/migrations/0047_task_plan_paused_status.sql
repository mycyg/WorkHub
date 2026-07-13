ALTER TABLE "task_plans"
  DROP CONSTRAINT IF EXISTS "task_plans_status_with_paused_ck";
--> statement-breakpoint
ALTER TABLE "task_plans"
  ADD CONSTRAINT "task_plans_status_with_paused_ck"
  CHECK ("status" IN ('draft','proposed','approved','dispatching','paused','done','cancelled'))
  NOT VALID;
--> statement-breakpoint
ALTER TABLE "task_plans"
  VALIDATE CONSTRAINT "task_plans_status_with_paused_ck";
--> statement-breakpoint
ALTER TABLE "task_plans"
  DROP CONSTRAINT IF EXISTS "task_plans_status_ck";
--> statement-breakpoint
ALTER TABLE "task_plans"
  RENAME CONSTRAINT "task_plans_status_with_paused_ck" TO "task_plans_status_ck";
