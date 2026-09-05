-- R26 M0（MCP 客户端接入·阶段 0）：MCP 服务器清单表。
-- MCP（Model Context Protocol）服务器是一台把一组工具通过 JSON-RPC 暴露出来的独立进程。这张表把
-- 「装了哪些 MCP 服务器」变成可查询、可治理的记录——形状照抄 0072 plugins（workspace 围栏 /
-- enabled / status / 报告 jsonb / tool_count / installed_by / 时间戳），但不复用那张表：
--   1. 唯一键不同：插件是「同一目录不许装两次」，MCP 是「server_name 在工作区内必须唯一且稳定」
--      ——它直接构成模型可见工具名，撞名会让两台服务器的工具坍缩。
--   2. 配置形状是判别联合：stdio 有 command/args/env/cwd，HTTP 有 url/headers（后者半边带密钥）。
--   3. 体检项枚举不相交：MCP 的体检项（command_resolvable/remote_exec_launcher 等）与插件的
--      （client_surface/install_scripts 等）完全是两套概念。
-- 阶段 0 结构性只允许 transport='stdio'——HTTP 引入出网目的地治理（SSRF、数据外传）与密钥落库两件
-- 全新的事，值得单独一批评审。放开时必须走新迁移，改动点显式可查（同 0072 的 plugins_source_kind_ck）。
-- url / auth_header_ct / auth_header_iv / auth_header_tag 四列现在就建（全部 nullable），
-- 避免阶段 1 再来一次 ALTER TABLE ADD COLUMN——但结构性的 CHECK 现在就把它们锁死成「建了不能用」。
-- 密钥不落库明文：env_json 只允许非密键（应用层过凭据形状黑名单）；真正的凭据走 secret_refs_json
-- 存指针（{子进程 env 名: 服务端 env 名}），API 进程在 spawn 时从自己的 process.env 取值注入子进程，
-- 本表结构性存不进任何一份明文凭据。
-- 全 additive；CREATE TABLE / CREATE INDEX IF NOT EXISTS 保证 migration-audit replay 整链重跑安全
-- （同 0061/0062/0063/0069/0072 约定）。
CREATE TABLE IF NOT EXISTS "mcp_servers" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  -- 模型可见工具名的命名空间；本地配置，绝不取远端自报的 serverInfo.name。
  "server_name" varchar(32) NOT NULL,
  "display_name" text,
  "transport" varchar(24) NOT NULL DEFAULT 'stdio',
  "command" text,                                   -- stdio
  "args_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "env_json" jsonb NOT NULL DEFAULT '{}'::jsonb,    -- 只允许非密键（应用层黑名单 + 本表不存密文）
  "secret_refs_json" jsonb NOT NULL DEFAULT '{}'::jsonb, -- {子进程env名: 服务端env名}——指针不是值
  "cwd" text,
  "url" text,                                       -- 阶段 1
  "auth_header_ct" bytea,
  "auth_header_iv" bytea,
  "auth_header_tag" bytea,                          -- 阶段 1（AES-256-GCM 三列，同 secret-box.ts 形态）
  "tool_call_timeout_ms" integer NOT NULL DEFAULT 60000,
  "enabled" boolean NOT NULL DEFAULT true,
  "status" varchar(24) NOT NULL DEFAULT 'connected',
  -- 管理员断言的读写分级上限：工具最终风险 = 管理员断言 AND 服务器自述，服务器只能在这个上限内
  -- 降风险,不能自己抬。映射规则本身是 M1 的实现,这张表先把字段与默认值钉死。
  "trust_level" varchar(24) NOT NULL DEFAULT 'external_effect',
  -- 启动前静态体检，不执行任何东西（字符串判定 + 一次 access()）。
  "precheck_report" jsonb NOT NULL,
  "last_error" text,
  "tool_count" integer NOT NULL DEFAULT 0,
  "tools_json" jsonb,                               -- 最近一次发现的工具名清单，给设置页预览
  "installed_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  -- 阶段 0 结构性只允许 stdio；放开 http 必须走新迁移，改动点显式可查（同 plugins_source_kind_ck）。
  CONSTRAINT "mcp_servers_transport_ck" CHECK ("transport" IN ('stdio')),
  CONSTRAINT "mcp_servers_status_ck" CHECK ("status" IN ('connected','connect_failed','disabled')),
  CONSTRAINT "mcp_servers_trust_level_ck" CHECK ("trust_level" IN ('read_only','external_effect')),
  CONSTRAINT "mcp_servers_timeout_ck" CHECK ("tool_call_timeout_ms" BETWEEN 1000 AND 300000),
  CONSTRAINT "mcp_servers_tool_count_ck" CHECK ("tool_count" >= 0)
);
--> statement-breakpoint

-- server_name 在工作区内必须唯一且稳定——它直接构成模型可见工具名（mcp__<server_name>__<tool>），
-- 撞名会让两台服务器的工具坍缩。这条约束不能伪装成 source_path 那样的目录唯一索引。
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_servers_workspace_name_uq"
  ON "mcp_servers" ("workspace_id","server_name");
--> statement-breakpoint

-- 列表页热路径：按工作区取，最近登记的在前。
CREATE INDEX IF NOT EXISTS "mcp_servers_workspace_created_idx"
  ON "mcp_servers" ("workspace_id","created_at");
--> statement-breakpoint

-- 工具装配热路径：只挑该工作区里启用且未被停用的行。部分索引不给停用行付索引成本。
CREATE INDEX IF NOT EXISTS "mcp_servers_workspace_enabled_idx"
  ON "mcp_servers" ("workspace_id")
  WHERE "enabled" = true AND "status" <> 'disabled';
