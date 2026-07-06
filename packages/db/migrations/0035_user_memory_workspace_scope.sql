-- R9.3.3：L2 user memory must not overwrite the same key across workspaces.
-- Existing global memories stay global (workspace_id IS NULL); workspace-specific memories get their own key space.
UPDATE "user_memories" AS memory
SET "workspace_id" = run."workspace_id"
FROM "agent_runs" AS run
WHERE memory."workspace_id" IS NULL
  AND memory."source_run_id" = run."id"
  AND run."workspace_id" IS NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "user_memories_key_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_memories_workspace_key_uq"
  ON "user_memories" ("user_id","workspace_id","category","key")
  WHERE "deleted_at" IS NULL AND "workspace_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_memories_global_key_uq"
  ON "user_memories" ("user_id","category","key")
  WHERE "deleted_at" IS NULL AND "workspace_id" IS NULL;
