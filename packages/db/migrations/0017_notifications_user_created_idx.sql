-- Custom SQL migration file, put your code below! --
-- L#56: the hot notification feed query is WHERE user_id = ? ORDER BY created_at DESC LIMIT n.
-- A (user_id) single-column index forces a sort of all of that user's rows; a composite
-- (user_id, created_at) index lets Postgres satisfy both the filter and the ordering from the index.
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx"
  ON "notifications" ("user_id", "created_at");
