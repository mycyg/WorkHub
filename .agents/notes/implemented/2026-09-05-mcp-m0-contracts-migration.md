# MCP 客户端接入·阶段 0：契约与数据库迁移（M0）

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code

## Problem

MCP（Model Context Protocol，模型上下文协议）客户端接入是一条多工包串行/并行施工的整体工程
（设计稿：scratchpad 报告 r25-侦察-2026-09-05/M-MCP客户端设计.md）。M0 是第一个工包：把「装了哪些
MCP 服务器」从无变成一张可查询、可治理的表，并把治理契约（枚举、VM）钉死，供后续 M1（纯翻译包）、
M2（连接监督）、M3（治理服务与端点）直接引用。

不能复用 0072 `plugins` 表加一列判别：

1. 唯一键不同——插件是「同一目录不许装两次」，MCP 是「`server_name` 在工作区内必须唯一且稳定」，
   它直接构成模型可见工具名（`mcp__<server_name>__<tool>`），撞名会让两台服务器的工具坍缩。
2. 配置形状是判别联合——stdio 有 `command/args/env/cwd`，HTTP 有 `url/headers`（后者半边带密钥）。
3. 体检项枚举不相交——插件的体检项（`client_surface`/`install_scripts`）与 MCP 的
   （`command_resolvable`/`remote_exec_launcher`）是两套完全不同的判断。
4. 治理动作不同——MCP 多一个「测试连接」「重新发现工具」。

另外指挥者拍板两条必须在这一批就落进契约与表（不是留到后续阶段）：

1. **读写分级与阶段 0 合并交付**：表带管理员断言列 `trust_level`（`read_only` / `external_effect`，
   默认 `external_effect`），把设计稿 5.3 那道开放问题（「阶段 1 的读写分级什么时候做」）提前决定为
   「合并」。M0 只钉字段与词表；「工具最终风险 = 管理员断言 AND 服务器自述」这条映射规则的**实现**
   是 M1 的工作。
2. **阶段 0 只支持 stdio**：`transport` 结构性只允许 `'stdio'`，HTTP 相关列（`url`/`auth_header_*`）
   现在就建但被 CHECK 锁死成「建了不能用」。

## Decision

- **新契约文件 `packages/contracts/src/domain/mcp.ts`**（barrel 挂在
  `packages/contracts/src/index.ts`）：
  - `mcpTransportSchema = z.literal("stdio")`——同 `pluginSourceKindSchema` 的先例，单值 literal
    而非裸字符串，放开时有明确的迁移点。
  - `mcpServerStatusSchema = z.enum(["connected","connect_failed","disabled"])`——没有 plugins 的
    `'installed'`：MCP 是有状态长连接，登记后立刻按新清单连接一次，不需要一个中性的「已装未连」态。
  - `mcpServerTrustLevelSchema = z.enum(["read_only","external_effect"])`——管理员断言的读写分级
    上限，默认 `external_effect`。
  - `mcpPrecheckCheckLevelSchema`/`mcpPrecheckCheckIdSchema`（7 个 id，逐条对齐设计稿 4.3 的体检表）/
    `mcpPrecheckCheckSchema`/`mcpPrecheckReportSchema`——形状照抄 `pluginCompat*` 一套。
  - `mcpServerVmSchema`——管理员/桌面端完整 VM（含 `command`/`args`/`env`/`secret_refs`/`cwd`）。
  - `mcpServerSummaryVmSchema`——web 只读投影，**结构性不含** `command`/`args`/`env`/`secret_refs`/
    `cwd`（宿主机事实与潜在凭据指针），裁剪口径照 `pluginSummaryVmSchema` 的先例。
  - 测试 `packages/contracts/src/mcp.test.ts`（9 条）：transport 只认 stdio、status 三值、trust_level
    只有两档、体检 id 枚举拒绝未知值、VM 必带体检报告、`server_name` 字符集与长度、超时区间、
    summary VM 结构性拒绝宿主机字段。
- **新迁移 `packages/db/migrations/0073_mcp_servers.sql`**（journal `idx:73`，
  `tag:"0073_mcp_servers"`，`when:1783929005000`，接在 0072 之后严格递增）：
  - 逐列对照 0072 排：workspace 围栏 / `enabled` / `status` / 报告 jsonb（`precheck_report`）/
    `tool_count` / `installed_by` / 时间戳。
  - `CONSTRAINT mcp_servers_transport_ck CHECK (transport IN ('stdio'))`。
  - `CONSTRAINT mcp_servers_status_ck CHECK (status IN ('connected','connect_failed','disabled'))`。
  - `CONSTRAINT mcp_servers_trust_level_ck CHECK (trust_level IN ('read_only','external_effect'))`——
    这条 CHECK 不在设计稿原始 SQL 草稿里（那份草稿写在指挥者拍板「合并交付」之前），是这一批按
    拍板结论新增的；命名与写法与同表其余三个 CHECK 一致。
  - `CONSTRAINT mcp_servers_timeout_ck CHECK (tool_call_timeout_ms BETWEEN 1000 AND 300000)`。
  - 唯一索引 `mcp_servers_workspace_name_uq (workspace_id, server_name)`；两个非唯一索引对齐
    0072（按工作区+创建时间；按工作区的启用未停用部分索引）。
  - `url`/`auth_header_ct`/`auth_header_iv`/`auth_header_tag` 四列现在就建（全部 nullable，无默认
    值）——阶段 1 开 HTTP 时不必再补一次加列迁移，但 `transport` CHECK 现在就把它们锁死成
    「建了不能用」。
  - `env_json`（只允许非密键，应用层黑名单）与 `secret_refs_json`（`{子进程 env 名: 服务端 env
    名}`，存指针不是值）——本表结构性存不进任何一份明文凭据。
  - 全 additive（`CREATE TABLE`/`CREATE INDEX` 均 `IF NOT EXISTS`），无 `CONCURRENTLY`、无
    `DROP`/`ALTER COLUMN`。
- **`packages/db/src/schema/core.ts`**：新增 `mcpServers` pgTable，字段/CHECK/索引与迁移一一对应；
  注册进 `workHubTables`（活跃 graph 从 81 涨到 82）。
- **`packages/db/src/repositories/mcp-servers.ts`**（`createMcpServerRepository`，barrel 挂在
  `packages/db/src/index.ts`）：`listForWorkspace` / `listEnabledForWorkspace`（启用且未停用，
  上次连接失败的仍然带上——下次重试可能就好了）/ `findById` / `findByServerName` / `create`
  （`transport` 硬编码 `'stdio'`，`trustLevel` 缺省 `'external_effect'`）/ `updateConnectionResult`
  （回填 `status`/`tool_count`/`tools_json`/`last_error`）/ `setEnabled` / `remove`。全部原语带
  `workspaceId` 谓词。
  - **`setEnabled(true)` 不宣称已验证连接**：MCP 没有 plugins 那个中性的 `'installed'` 态，重新
    启用后 `status` 落回 `'connect_failed'`（不是伪造一个 `'connected'`），真实状态由紧随其后、
    同一次治理动作里的试连接（`updateConnectionResult`）再修正——对齐设计稿「启停/新增/移除/
    测试连接后按新清单重连」与 `services/plugins.ts` 的 `reloadQuietly` 口径：宿主起不来不该让
    一次已在 DB 上生效的治理动作失败。
- 测试 `packages/db/src/mcp-servers-repository.test.ts`（10 条，query recorder 风格，纯内存无真
  PG）+ `packages/db/src/schema.test.ts` 的三处改动：table 图计数 81→82、「journal 收于 0072」测试
  改写为「收于 0073」（含 0069→0073 五级 `when` 严格递增校验）、新增 0073 迁移/schema 同步测试块
  （CHECK 逐项对齐、唯一索引存在、阶段 1 占位列存在但结构性锁死、无明文密钥列字面量、无 emoji）。

## Alternatives considered

- **复用 0072 `plugins` 加 `source_kind` 判别值。** 否决：见 Problem 的四条理由——唯一键、配置
  形状、体检枚举、治理动作全都不同，硬塞会让插件表挂三个 MCP 用得上、插件用不上的列，且
  `pluginCompatCheckIdSchema` 的 switch 会变成两套逻辑挤一个函数。
- **`trust_level` 留到阶段 1 再加（维持设计稿原始草稿）。** 设计稿 5.3 本身列了这个开放问题、
  倾向合并但没有拍板；指挥者已明确拍板「合并交付」，这一批据此新增该列——不是对设计稿的偏离，
  是对设计稿明确标注「待拍板」的问题给出的上游决定。
- **`transport` 契约层用 `z.enum(["stdio","http"])` 提前占一个位。** 否决：会让契约层看起来「HTTP
  已经是合法输入，只是没人用」，与阶段 0「结构性只允许 stdio」的口径不符；「留位」这件事放在 DB
  列层面（`url`/`auth_header_*` 现在就建、由 CHECK 锁死）更诚实——契约的 `z.literal("stdio")` 和
  DB 的 `CHECK (transport IN ('stdio'))` 同步收紧，放开时两边一起改，改动点显式可查（同
  `pluginSourceKindSchema` 的先例）。
- **`setEnabled(true)` 把 `status` 直接写回 `'connected'`。** 否决：仓储层没有做真实的连接尝试，
  写 `'connected'` 是在冒充一个还没发生的验证结果；落 `'connect_failed'` 更诚实，且不影响
  `listEnabledForWorkspace` 的语义（该原语本就把「启用但上次连接失败」的行也纳入候选集，交给
  应用层决定要不要重试）。
- **`mcp_servers` 的 web 只读 VM 也带 `trust_level`/`transport`。** 保留（不是否决）：这两个字段
  不是宿主机事实也不是凭据，是「这台服务器的风险声明」，网页只读页面回答「装了什么、还活着吗、
  风险声明是什么」是合理的；结构性排除的只有 `command`/`args`/`env`/`secret_refs`/`cwd`。

## Consequences

- **M1（纯翻译包 `packages/mcp-client`）可以直接从 `@workhub/contracts` 引入
  `McpServerTrustLevel`/`McpPrecheckReport` 等类型**，不需要重新定义；`trust_level` 的
  「管理员断言 AND 服务器自述」映射真值表是 M1 的实现范围，M0 只交付了字段与默认值，**没有任何
  代码路径消费 `trust_level`**（与设计稿点名的 `minScope` 现状一致：字段存在但阶段 0 零运行时
  消费者，这条本身也如实写进了两处代码注释）。
- **M2/M3 可以直接基于 `createMcpServerRepository` 建连接监督与治理服务**，不需要再摸索仓储层
  的形状；但要注意 `setEnabled(true)` 之后必须紧跟一次真实的 `updateConnectionResult` 调用，
  否则行会滞留在 `'connect_failed'`（这是有意的诚实状态，不是 bug，但调用方必须知道这个约定）。
- **web 端只读 VM（`mcpServerSummaryVmSchema`）结构性不可能泄漏宿主机命令/参数/环境变量/密钥
  引用**——任何未来的 M8 网页只读页面天然安全，不会因为一次疏忽把它们序列化进响应。
- **0073 迁移把阶段 1 的列现在就建好但锁死**：M2/M3 若要在阶段 0 就使用 `url`/`auth_header_*`
  会直接撞上 `mcp_servers_transport_ck`（`transport` 只能是 `'stdio'`），这是有意的——阶段 1 开
  HTTP 时要走一条新迁移显式放开 CHECK，不能在阶段 0 的代码里悄悄绕过。
- **`mcp_servers_trust_level_ck` 这条 CHECK 不在原始设计稿的 SQL 草稿里**，是这一批按指挥者拍板
  结论新增的——后续读设计稿原文对照代码的人如果只看 4.3 节的 SQL 代码块会漏掉这一列，需要同时
  看顶层派工指令里「已拍板的两条」。
- **表命名与治理动作名与插件不共用**：审计事件名（`mcp_server.added`/`enabled`/`disabled`/
  `removed`/`tested` 与 `mcp.tool.called`）、端点路径（`/api/mcp-servers`）、体检项 id 全部是独立
  词表，不会与 `plugin.*` 系列在审计日志或错误码空间里混淆——这条本身在 M0 只是「表与契约互相
  独立」的自然结果，真正落地审计动作是 M3 的范围。
