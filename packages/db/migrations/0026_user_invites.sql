-- Custom SQL migration file, put your code below! --
-- R2 auth epic（账号生命周期-邀请，out-of-band 链接，无 SMTP）：管理员建邀请→拿一次性链接手动分发；
-- 收件人凭 token 接受→建账号+凭据+默认成员。token_hash=sha256(明文)，明文只回管理员一次。
-- 纯加表、不接线（无路由），零运行时行为变化。手写 SQL（snapshot 链止于 0015）。email 用 citext（0023 已建扩展）。
CREATE TABLE IF NOT EXISTS "user_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" citext NOT NULL,
  "token_hash" varchar(128) NOT NULL,
  "invited_by_user_id" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  "role" varchar(16) NOT NULL DEFAULT 'member',
  "workspace_id" uuid REFERENCES "workspaces" ("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "accepted_user_id" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  "deleted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_invites_token_hash_uq" ON "user_invites" ("token_hash");
CREATE INDEX IF NOT EXISTS "user_invites_email_idx" ON "user_invites" ("email");
-- 待接受邀请清单：未接受 ∧ 未撤销（partial index）。
CREATE INDEX IF NOT EXISTS "user_invites_pending_idx"
  ON "user_invites" ("email", "expires_at")
  WHERE "accepted_at" IS NULL AND "deleted_at" IS NULL;
