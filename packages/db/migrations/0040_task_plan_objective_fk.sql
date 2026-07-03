-- R9.7 hardening: task_plans.objective_id is nullable, but non-null values
-- must still point at the OKR objective they budget against.
UPDATE "task_plans"
SET "objective_id" = NULL
WHERE "objective_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "objectives"
    WHERE "objectives"."id" = "task_plans"."objective_id"
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "pg_constraint"
    WHERE "conname" = 'task_plans_objective_id_objectives_id_fk'
      AND "conrelid" = 'task_plans'::regclass
  ) THEN
    ALTER TABLE "task_plans"
      ADD CONSTRAINT "task_plans_objective_id_objectives_id_fk"
      FOREIGN KEY ("objective_id") REFERENCES "objectives"("id") ON DELETE set null;
  END IF;
END $$;
