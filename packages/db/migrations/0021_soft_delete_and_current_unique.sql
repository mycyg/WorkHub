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
CREATE UNIQUE INDEX "accepted_deliverable_changes_project_current_uq"
  ON "accepted_deliverable_changes" ("project_id", "target_key")
  WHERE "superseded_at" is null and "project_id" is not null;
CREATE UNIQUE INDEX "accepted_deliverable_changes_workitem_current_uq"
  ON "accepted_deliverable_changes" ("work_item_id", "target_key")
  WHERE "superseded_at" is null and "project_id" is null;
