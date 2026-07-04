ALTER TABLE "budget_reservations" ADD COLUMN IF NOT EXISTS "workspace_id" uuid;

UPDATE "budget_reservations" AS reservation
SET "workspace_id" = run."workspace_id"
FROM "agent_runs" AS run
WHERE reservation."run_id" = run."id"
  AND reservation."workspace_id" IS NULL;

ALTER TABLE "budget_reservations" ALTER COLUMN "workspace_id" SET NOT NULL;

DROP INDEX IF EXISTS "budget_reservations_scope_bucket_active_idx";

CREATE INDEX IF NOT EXISTS "budget_reservations_scope_bucket_active_idx"
  ON "budget_reservations" ("workspace_id", "scope_kind", "scope_id", "period_bucket")
  WHERE "status" = 'active';
