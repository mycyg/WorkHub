ALTER TABLE "budget_reservations" ADD COLUMN IF NOT EXISTS "workspace_id" uuid;

UPDATE "budget_reservations" AS reservation
SET "workspace_id" = COALESCE(run."workspace_id", work_item."workspace_id")
FROM "agent_runs" AS run
LEFT JOIN "work_items" AS work_item ON work_item."id" = run."work_item_id"
WHERE reservation."run_id" = run."id"
  AND reservation."workspace_id" IS NULL
  AND COALESCE(run."workspace_id", work_item."workspace_id") IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "budget_reservations" AS reservation
    WHERE reservation."workspace_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'budget_reservations workspace_id backfill left unresolved rows';
  END IF;
END $$;

ALTER TABLE "budget_reservations" ALTER COLUMN "workspace_id" SET NOT NULL;

DROP INDEX IF EXISTS "budget_reservations_scope_bucket_active_idx";

CREATE INDEX IF NOT EXISTS "budget_reservations_scope_bucket_active_idx"
  ON "budget_reservations" ("workspace_id", "scope_kind", "scope_id", "period_bucket")
  WHERE "status" = 'active';
