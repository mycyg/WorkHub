-- Custom SQL migration file, put your code below! --
-- M13/M15: notification dedupe was a check-then-insert (read existing by (user_id, dedupe_key),
-- else insert). Two concurrent callers both miss the read and both insert → duplicate notifications.
-- Fix: a partial unique index on (user_id, dedupe_key) so the DB enforces one-per-key, plus a
-- race-safe upsert in the repo. Before creating the index we must collapse any pre-existing
-- duplicates (keep the newest row per key), otherwise the unique index creation fails.
DELETE FROM "notifications" AS a
USING "notifications" AS b
WHERE a."dedupe_key" IS NOT NULL
  AND a."dedupe_key" = b."dedupe_key"
  AND a."user_id" = b."user_id"
  AND (a."created_at" < b."created_at" OR (a."created_at" = b."created_at" AND a."id" < b."id"));

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_user_dedupe_uq"
  ON "notifications" ("user_id", "dedupe_key")
  WHERE "dedupe_key" IS NOT NULL;
