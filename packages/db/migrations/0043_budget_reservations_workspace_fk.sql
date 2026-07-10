DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "pg_constraint"
    WHERE "conname" = 'budget_reservations_workspace_id_workspaces_id_fk'
      AND "conrelid" = 'budget_reservations'::regclass
  ) THEN
    ALTER TABLE "budget_reservations"
      ADD CONSTRAINT "budget_reservations_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("workspace_id")
      REFERENCES "workspaces" ("id")
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

ALTER TABLE "budget_reservations"
  VALIDATE CONSTRAINT "budget_reservations_workspace_id_workspaces_id_fk";
