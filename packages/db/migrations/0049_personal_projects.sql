-- R13 批 S3（个人空间）：projects.is_personal —— 个人空间 = owner_user_id 名下 is_personal=true 的
-- 一条普通 projects 行（主区/网盘/工单全链路零改动直接复用，见 packages/db/src/repositories/projects.ts
-- 的 bootstrapPersonalProject）。默认 false，存量团队项目行为完全不变。
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "is_personal" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- 「我的空间」列表查询用：按 owner 找他名下的个人空间。部分索引只覆盖 is_personal=true 的行。
CREATE INDEX IF NOT EXISTS "projects_personal_owner_idx"
  ON "projects" ("owner_user_id")
  WHERE "is_personal";
