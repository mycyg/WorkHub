-- Custom SQL migration file, put your code below! --
-- R2 多租户 epic Phase 1：为每个现存(未软删)用户回填一条 default 成员行 → 默认工作区，role 由 is_admin 派生。
-- 这样 Phase 2 的 TenantResolver 对现有用户解析出的租户 == 今天常量产出的租户，actor 身份逐字节不变。
-- 幂等：ON CONFLICT DO NOTHING（重跑命中 user_default_uq / ws_user_uq 即跳过）。
-- 守卫：EXISTS 默认工作区存在才插，避免 FK 失败——全新库迁移时尚无用户/工作区，此处空操作（数据由 seed 后建）。
-- 默认工作区 UUID = packages/config/src/auth.ts defaultWorkspaceId 常量。
INSERT INTO "workspace_memberships" ("id", "workspace_id", "user_id", "role", "default_workspace")
SELECT gen_random_uuid(),
       '00000000-0000-4000-8000-000000000002',
       u."id",
       CASE WHEN u."is_admin" THEN 'owner' ELSE 'member' END,
       true
FROM "users" u
WHERE u."deleted_at" IS NULL
  AND EXISTS (SELECT 1 FROM "workspaces" w WHERE w."id" = '00000000-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;
