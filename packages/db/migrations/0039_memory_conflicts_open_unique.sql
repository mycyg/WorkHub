WITH duplicate_open_conflicts AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "workspace_id","user_id","category","key"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS row_no
  FROM "memory_conflicts"
  WHERE "status" = 'open'
)
UPDATE "memory_conflicts" AS conflict
SET
  "status" = 'resolved',
  "resolution" = 'keep_current',
  "resolved_value_md" = conflict."current_value_md",
  "resolved_at" = COALESCE(conflict."resolved_at", now()),
  "updated_at" = now()
FROM duplicate_open_conflicts AS duplicate
WHERE conflict."id" = duplicate."id"
  AND duplicate.row_no > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "memory_conflicts_open_user_key_uq"
  ON "memory_conflicts" ("workspace_id","user_id","category","key")
  WHERE "status" = 'open';
