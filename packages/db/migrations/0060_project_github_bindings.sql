-- R14 批 GH（GitHub 集成 · 07-gh-design.md §2，迁移 0060 由集成者预分配，when=1783914000000）。
-- 两张表：项目级 GitHub 绑定（一对一，配置+AES-256-GCM 密文 PAT 三列+轮询水位同一行）与
-- 轮询活动落地表（独立小表，(project_id,kind,external_id) 唯一约束=增量同步的幂等写入原语）。
-- 安全红线：PAT 只以密文三列（ciphertext/iv/auth_tag，bytea）落库，主密钥在 env GITHUB_TOKEN_ENC_KEY
-- （见 packages/config），未配置时端点 503 fail-closed，绝不明文兜底。解绑=物理删行（密文一并销毁），
-- 活动表 ON DELETE CASCADE 随之清理。
-- CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS 保证 migration-audit replay 阶段整链重跑安全。
CREATE TABLE IF NOT EXISTS "project_github_bindings" (
  "project_id" uuid PRIMARY KEY REFERENCES "projects"("id") ON DELETE cascade,
  "repo_full_name" varchar(255) NOT NULL,
  "pat_ciphertext" bytea NOT NULL,
  "pat_iv" bytea NOT NULL,
  "pat_auth_tag" bytea NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "commits_since" timestamp with time zone,
  "issues_since" timestamp with time zone,
  "etag_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_synced_at" timestamp with time zone,
  "last_error" text,
  "last_error_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_github_activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "kind" varchar(16) NOT NULL,
  "external_id" varchar(128) NOT NULL,
  "title" text NOT NULL,
  "author_login" varchar(255),
  "html_url" text NOT NULL,
  "state" varchar(32),
  "occurred_at" timestamp with time zone NOT NULL,
  "related_work_item_id" uuid REFERENCES "work_items"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "project_github_activities_dedupe_uq" UNIQUE ("project_id", "kind", "external_id")
);--> statement-breakpoint

-- 项目主页「最近活动」查询形状：WHERE project_id = ? ORDER BY occurred_at DESC LIMIT n。
-- 照 0017 notifications 先例用普通升序复合索引（btree 反向扫描天然满足 DESC 排序），
-- 与 drizzle schema 声明逐字节一致，避免快照漂移。
CREATE INDEX IF NOT EXISTS "project_github_activities_project_occurred_idx"
  ON "project_github_activities" ("project_id", "occurred_at");
