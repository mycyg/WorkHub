-- Custom SQL migration file, put your code below! --
-- R2 多租户 epic Phase 1：用户↔工作区成员表。纯加表、不接线（actor 仍走 config 常量），零运行时行为变化——
-- 为「从成员关系派生 actor 租户」铺真实地基。手写 SQL（snapshot 链止于 0015，不跑 drizzle-kit generate）。
CREATE TABLE IF NOT EXISTS "workspace_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "role" varchar(16) NOT NULL DEFAULT 'member',
  "default_workspace" boolean NOT NULL DEFAULT false,
  "deleted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- 每 (workspace,user) 至多一条 active 成员行（soft-delete 后可重新加入，墓碑不永久占位）。
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_memberships_ws_user_uq"
  ON "workspace_memberships" ("workspace_id", "user_id") WHERE "deleted_at" IS NULL;
-- 每用户至多一个 default workspace（actor 租户解析的兜底锚点）。
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_memberships_user_default_uq"
  ON "workspace_memberships" ("user_id") WHERE "default_workspace" AND "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "workspace_memberships_user_id_idx" ON "workspace_memberships" ("user_id");
CREATE INDEX IF NOT EXISTS "workspace_memberships_workspace_id_idx" ON "workspace_memberships" ("workspace_id");
CREATE INDEX IF NOT EXISTS "workspace_memberships_deleted_at_idx" ON "workspace_memberships" ("deleted_at");
