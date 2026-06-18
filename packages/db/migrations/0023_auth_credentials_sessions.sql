-- Custom SQL migration file, put your code below! --
-- R2 epic(真认证 password-first)：认证安全基础 schema。首版不接线（中间件仍走 nickname cookieToken），
-- 仅引入口令存储与服务端会话，为后续 AUTH_MODE 切换铺路——纯加表 + users 加列，零运行时行为变化。
-- 决策：out-of-band 邀请/重置链接（无 SMTP，email trust-on-first-use）、OIDC 抽象先接 0 provider、单 API 进程。
-- 手写 SQL（snapshot 链止于 0015，不跑 drizzle-kit generate 以免污染 journal）。

-- email 用 citext：大小写不敏感唯一与等值匹配，免应用层 LOWER() 处处加谓词。官方 postgres 镜像含此 contrib。
CREATE EXTENSION IF NOT EXISTS citext;

-- offboard 审计：记录是谁停用/离职了该账号（与其余 soft-delete 表的 deleted_by_user_id 约定一致）。自引用 set null。
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_by_user_id" uuid REFERENCES "users" ("id") ON DELETE SET NULL;

-- 口令凭据：每用户至多一份。password_hash 为 argon2id PHC 串（可空=仅 OIDC/未设密码）；
-- password_algo 记录算法便于将来无停机轮换；email 验证走 out-of-band（trust-on-first-use，email_verified_at 可空）。
CREATE TABLE IF NOT EXISTS "user_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "email" citext NOT NULL,
  "password_hash" varchar(256),
  "password_algo" varchar(32),
  "email_verified_at" timestamptz,
  "failed_attempts" integer NOT NULL DEFAULT 0,
  "locked_until" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_credentials_user_id_uq" ON "user_credentials" ("user_id");
-- citext 列上的唯一索引 = 大小写不敏感唯一（Foo@x.com 与 foo@x.com 视为同一账号）。
CREATE UNIQUE INDEX IF NOT EXISTS "user_credentials_email_uq" ON "user_credentials" ("email");

-- 服务端会话：token_hash = sha256(session secret)，绝不存明文；绝对过期（硬上限）+ 滑动过期（活动续期）双控；
-- revoked_at 置墓碑用于登出/停用批量撤销。auth_method/oidc_provider 记录登录方式（OIDC 首版接 0 个 provider）。
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "token_hash" varchar(128) NOT NULL,
  "auth_method" varchar(16) NOT NULL DEFAULT 'password',
  "oidc_provider" varchar(64),
  "ip_hash" varchar(128),
  "user_agent" varchar(256),
  "absolute_expires_at" timestamptz NOT NULL,
  "idle_expires_at" timestamptz NOT NULL,
  "last_seen_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_hash_uq" ON "sessions" ("token_hash");
CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions" ("user_id");
-- 过期清扫：partial index，仅未撤销行进索引（墓碑行不占）。
CREATE INDEX IF NOT EXISTS "sessions_idle_expires_idx" ON "sessions" ("idle_expires_at") WHERE "revoked_at" IS NULL;
