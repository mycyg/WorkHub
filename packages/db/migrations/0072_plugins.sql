-- R24-P 阶段 1（装得进来、管得住）：插件清单表。
-- 阶段 0 的「装了哪些插件」只存在于一个 env 变量 WORKHUB_PLUGIN_PATHS 里——没有清单、没有启停、
-- 没有安装前体检、没有安装动作的审计。这张表把它变成可查询、可治理的记录：
--   source_kind 只允许 'local_path'——npm 包名 / git url / tarball 会在安装期跑包自己的
--   prepare/postinstall，那是任何沙箱之外的任意代码执行，所以这一版结构性不允许（CHECK 而不是
--   「应用层记得校验」）。放开时必须走新迁移，改动点显式可查。
--   compat_report 存安装前**不执行任何插件代码**的静态体检结论（读 package.json 得出）；
--   load_report 存宿主试加载的结果，加载失败时 status='load_failed' 并把原因留在这里，
--   而不是只在日志里一闪而过。
-- workspace_id 上围栏：插件是工作区级治理对象，跨租户不可见（与 permission_policies 同口径）。
-- 全 additive；CREATE TABLE / CREATE INDEX IF NOT EXISTS 保证 migration-audit replay 整链重跑安全
-- （同 0061/0062/0063/0069 约定）。
CREATE TABLE IF NOT EXISTS "plugins" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  -- 插件自报的包名（package.json 的 name）；读不出时退化成目录名。
  "name" text NOT NULL,
  -- package.json 的 version；缺省允许为空（不编一个 0.0.0 出来）。
  "version" text,
  "source_kind" varchar(32) NOT NULL DEFAULT 'local_path',
  -- 本机绝对路径。只对管理员可见（列表端点整体是管理员门）。
  "source_path" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  -- installed=登记且试加载成功 / load_failed=登记了但宿主加载失败 / disabled=管理员停用。
  "status" varchar(24) NOT NULL DEFAULT 'installed',
  -- 静态体检结论（安装前，读 package.json，不执行代码）。
  "compat_report" jsonb NOT NULL,
  -- 宿主试加载结果（可空：只有真的试过才有）。
  "load_report" jsonb,
  -- 已上线的工具数（试加载成功时由宿主报告）。
  "tool_count" integer NOT NULL DEFAULT 0,
  -- 装它的管理员。用户被删时留记录不留指向（SET NULL），审计里另有不可变的一份。
  "installed_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "plugins_source_kind_ck" CHECK ("source_kind" IN ('local_path')),
  CONSTRAINT "plugins_status_ck" CHECK ("status" IN ('installed','load_failed','disabled')),
  CONSTRAINT "plugins_tool_count_ck" CHECK ("tool_count" >= 0)
);
--> statement-breakpoint

-- 同一个工作区里同一个目录只能装一次——重复安装应当是「已经装过了」的 409，而不是两条记录
-- 各自启停、各自被宿主加载一遍。
CREATE UNIQUE INDEX IF NOT EXISTS "plugins_workspace_source_path_uq"
  ON "plugins" ("workspace_id","source_path");
--> statement-breakpoint

-- 列表页热路径：按工作区取，最近安装的在前。
CREATE INDEX IF NOT EXISTS "plugins_workspace_created_idx"
  ON "plugins" ("workspace_id","created_at");
--> statement-breakpoint

-- 宿主装配热路径：只挑该工作区里启用且不是加载失败的行。部分索引不给停用/失败行付索引成本。
CREATE INDEX IF NOT EXISTS "plugins_workspace_enabled_idx"
  ON "plugins" ("workspace_id")
  WHERE "enabled" = true AND "status" <> 'disabled';
