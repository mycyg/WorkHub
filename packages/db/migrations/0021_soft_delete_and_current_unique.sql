-- Custom SQL migration file, put your code below! --
-- M18: users 的 nickname / cookie_token 唯一索引改为 partial（WHERE deleted_at IS NULL），与其余
-- soft-delete 表一致。否则 soft-delete 一个用户后，其昵称/cookie 被墓碑行永久占用，重新注册同名会撞死
-- 完整唯一索引抛 500。先删完整唯一索引，再建 partial。
DROP INDEX IF EXISTS "users_nickname_uq";
DROP INDEX IF EXISTS "users_cookie_token_uq";
CREATE UNIQUE INDEX "users_nickname_uq" ON "users" ("nickname") WHERE "deleted_at" is null;
CREATE UNIQUE INDEX "users_cookie_token_uq" ON "users" ("cookie_token") WHERE "deleted_at" is null;

-- M19: accepted_deliverable_changes 加 partial unique，作为「每 (scope,target) 至多一个未被取代的
-- current 版本」这条 P-COLLAB 丢失更新不变量的纵深防护（此前只靠应用层 advisory lock + L3 重核）。
-- 项目态行按 (project_id,target_key)，遗留 null-project 行按 (work_item_id,target_key)，各管一段。
-- findings[#102]：建唯一索引前先塌缩历史遗留的重复 current 行（漏锁可能产生过两条未 superseded 的 current）。
-- 否则 CREATE UNIQUE INDEX 会因重复键失败、整个迁移中止，挡住升级（兄弟迁移 0016 同样先塌缩再建索引）。
-- 用 superseded（而非删除）塌缩：保留每 (scope,target) 最新一行，其余置 superseded_at，与本表「取代而非删」
-- 的语义一致、不丢台账历史。干净/全新库上这两条 UPDATE 命中 0 行，无害幂等。
UPDATE "accepted_deliverable_changes" AS a
SET "superseded_at" = now(), "updated_at" = now()
FROM "accepted_deliverable_changes" AS b
WHERE a."superseded_at" is null AND b."superseded_at" is null
  AND a."project_id" is not null AND b."project_id" is not null
  AND a."project_id" = b."project_id"
  AND a."target_key" = b."target_key"
  AND (a."created_at" < b."created_at" OR (a."created_at" = b."created_at" AND a."id" < b."id"));
UPDATE "accepted_deliverable_changes" AS a
SET "superseded_at" = now(), "updated_at" = now()
FROM "accepted_deliverable_changes" AS b
WHERE a."superseded_at" is null AND b."superseded_at" is null
  AND a."project_id" is null AND b."project_id" is null
  AND a."work_item_id" = b."work_item_id"
  AND a."target_key" = b."target_key"
  AND (a."created_at" < b."created_at" OR (a."created_at" = b."created_at" AND a."id" < b."id"));
CREATE UNIQUE INDEX IF NOT EXISTS "accepted_deliverable_changes_project_current_uq"
  ON "accepted_deliverable_changes" ("project_id", "target_key")
  WHERE "superseded_at" is null and "project_id" is not null;
CREATE UNIQUE INDEX IF NOT EXISTS "accepted_deliverable_changes_workitem_current_uq"
  ON "accepted_deliverable_changes" ("work_item_id", "target_key")
  WHERE "superseded_at" is null and "project_id" is null;
