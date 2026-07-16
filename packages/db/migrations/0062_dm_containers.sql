-- R15 批 B（人对人私聊 · 02-batch-b-dm.md B1/B2）：DM 容器项目 + 会话查重键。全 additive。
-- B1：projects 加 is_dm_container 布尔列（系统惰性建的「直达消息」容器项目标记）+ 每工作区至多一个
--     容器的部分唯一索引（workspace 维度）。容器项目不进任何项目列表/树/工作台 VM，不可归档/建工单/
--     建普通会话——围栏在 repository/service 层强制，本迁移只落列与唯一性地基。
-- B2：project_conversations 加 dm_key 文本列 + (project_id, dm_key) 部分唯一索引（WHERE dm_key IS NOT NULL）。
--     必须带 project_id 限定：同一对用户在两个共享工作区各有一条 DM，dm_key 本身会撞，靠容器项目 id 隔离。
-- ADD COLUMN / CREATE INDEX IF NOT EXISTS 保证 migration-audit replay 整链重跑安全（同 0061 约定）。
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "is_dm_container" boolean NOT NULL DEFAULT false;--> statement-breakpoint

-- 每工作区至多一个 DM 容器项目（workspace 维度部分唯一）——惰性创建的并发双开靠这条索引兜底。
CREATE UNIQUE INDEX IF NOT EXISTS "projects_dm_container_uq"
  ON "projects" ("workspace_id")
  WHERE "is_dm_container";--> statement-breakpoint

ALTER TABLE "project_conversations"
  ADD COLUMN IF NOT EXISTS "dm_key" text;--> statement-breakpoint

-- 同一容器项目内，一对用户至多一条 DM 会话——并发双开撞这条唯一约束后回退查询既有会话。
CREATE UNIQUE INDEX IF NOT EXISTS "project_conversations_dm_key_uq"
  ON "project_conversations" ("project_id", "dm_key")
  WHERE "dm_key" IS NOT NULL;
