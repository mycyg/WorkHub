-- Custom SQL migration file, put your code below! --
-- pilot-stack-smoke 病根修复（main 自 68a77a02 起连红）：昵称 identify 现在会为用户补默认工作区
-- membership（ENV-01 修复，auth.ts ensureDefaultWorkspaceMembership），但「默认 org + 默认工作区」
-- 两行此前只有 `pnpm db:seed` 会建——只跑 `pnpm db:migrate` 的部署（docker-compose.pilot.yml 即是）
-- workspaces 表是空的，membership 插入撞 FK → identify 500。这里把两行下沉为幂等种子迁移，让
-- migrate-only 部署自足。UUID/名称与 packages/config/src/auth.ts defaultWorkspaceId、
-- packages/db/src/seed.ts defaultSeedIds 逐字节一致；ON CONFLICT DO NOTHING 兼容已 seed 过的库。
-- 边界：slug 撞行（同 slug 不同 id）时本迁移空操作，identify 侧另有 FK 降级兜底（不 500）；
-- DEFAULT_WORKSPACE_ID 被 env 覆写的部署不在本迁移照顾范围，需自管工作区行。
INSERT INTO "orgs" ("id", "name", "slug", "plan")
VALUES ('00000000-0000-4000-8000-000000000001', 'WorkHub Local', 'workhub-local', 'lan')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "workspaces" ("id", "org_id", "name", "slug")
SELECT '00000000-0000-4000-8000-000000000002', o."id", 'Default Workspace', 'default'
FROM "orgs" o
WHERE o."id" = '00000000-0000-4000-8000-000000000001'
ON CONFLICT DO NOTHING;
