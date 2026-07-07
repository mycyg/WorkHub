-- B-R9.3-3（branch-review 验收门未兑现）：0035 只改了唯一索引没做回填——存量全局行
-- （workspace_id IS NULL）照旧在每个工作区被读到并可能与工作区行同 key 并存。
-- 回填依据：source_run_id 指向的 agent_run 的 workspace_id（记忆产生地）。
-- 已存在同 user/category/key 工作区行的不动（避开 user_memories_workspace_key_uq，
-- 全局行成为 shadow，由读侧去重让工作区行优先）。
UPDATE "user_memories" um
SET "workspace_id" = ar."workspace_id"
FROM "agent_runs" ar
WHERE um."workspace_id" IS NULL
  AND um."deleted_at" IS NULL
  AND um."source_run_id" = ar."id"
  AND ar."workspace_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "user_memories" existing
    WHERE existing."user_id" = um."user_id"
      AND existing."workspace_id" = ar."workspace_id"
      AND existing."category" = um."category"
      AND existing."key" = um."key"
      AND existing."deleted_at" IS NULL
  );
