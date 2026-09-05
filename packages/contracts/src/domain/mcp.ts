import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./common.js";

// R26 M0（MCP 客户端接入·阶段 0，见 scratchpad 报告 r25-侦察-2026-09-05/M-MCP客户端设计.md）。
// MCP（Model Context Protocol，模型上下文协议）服务器是一台把一组工具通过 JSON-RPC 暴露出来的
// 独立进程。这一层把「装了哪些 MCP 服务器」变成可查询、可治理的记录——形状照抄
// `./plugin.js` 的插件治理（同一套 workspace 围栏 / enabled / status / 报告 jsonb / tool_count /
// installed_by / 时间戳），但不复用那张表：MCP 的唯一键是 server_name（它直接构成模型可见工具名，
// 撞名会让两台服务器的工具坍缩），配置形状是判别联合（stdio 有 command/args/env，HTTP 有
// url/headers，后者半边带密钥），体检项枚举也完全不相交。

// 传输方式。阶段 0 结构性只允许 stdio——HTTP 引入出网目的地治理（SSRF、数据外传）与密钥落库两件
// 全新的事，值得单独一批评审，不与「打通链路」的这一批混在一起。留成单值 literal 而不是裸字符串，
// 是为了以后放开时有明确的迁移点（同 `pluginSourceKindSchema` 的先例：DB 侧 CHECK 与这里同步收紧，
// 放开必须两边一起改）。
export const mcpTransportSchema = z.literal("stdio");
export type McpTransport = z.infer<typeof mcpTransportSchema>;

// connected=登记且最近一次连接/发现成功；connect_failed=登记了但握手或发现失败（原因在
// last_error）；disabled=管理员停用（工具从此不出现在任何一次执行里）。没有 plugins 的
// 'installed'——MCP 是有状态长连接,「装上了」这件事本身不构成独立状态,登记后立刻按新清单连接一次。
export const mcpServerStatusSchema = z.enum(["connected", "connect_failed", "disabled"]);
export type McpServerStatus = z.infer<typeof mcpServerStatusSchema>;

// 管理员断言的读写分级上限。这条规则本身（把只读工具降到 sideEffect:"none"）是后续工包 M1 的实现，
// M0 只把字段与枚举钉死：**工具最终风险 = 管理员断言 AND 服务器自述**——服务器只能在管理员划定的
// 上限内把风险往下降（把自己的工具标成 readOnlyHint），不能自己往上抬。管理员把一台服务器断言成
// external_effect 时，即使服务器的每个工具都自称只读，风险仍按 external_effect 算。默认
// external_effect：新增服务器时不假设它安全，必须管理员主动降级。阶段 0 全部工具仍按
// external_effect 对待（不消费这一列），这里先落地字段与词表，供 M1 的映射真值表直接引用。
export const mcpServerTrustLevelSchema = z.enum(["read_only", "external_effect"]);
export type McpServerTrustLevel = z.infer<typeof mcpServerTrustLevelSchema>;

// 静态体检单条结论。block=拒装；warn=允许尝试但先把话说清；pass=这条没问题——与
// `pluginCompatCheckLevelSchema` 同一套词表（同一展示层 switch 可以共用文案装配逻辑）。
export const mcpPrecheckCheckLevelSchema = z.enum(["pass", "warn", "block"]);
export type McpPrecheckCheckLevel = z.infer<typeof mcpPrecheckCheckLevelSchema>;

// 体检项 id——服务端与两端 UI 共用的稳定键，文案由展示层按 locale 出（这里只存结构与英文诊断）。
// 不执行任何插件/服务器代码：只做字符串校验、PATH 查找、一次 access()。
export const mcpPrecheckCheckIdSchema = z.enum([
  // 不匹配 ^[A-Za-z0-9_-]{1,32}$，或该工作区已被占用 → block
  "server_name",
  // 裸名在 API 进程 PATH 上找不到；或绝对路径不存在/不可执行；相对路径一律拒 → block
  "command_resolvable",
  // 命令归一化后是 npx / pnpm dlx / bunx / uvx 等「每次启动从 registry 下载并执行」的启动器 → block
  "remote_exec_launcher",
  // 参数含 NUL → block；含 .. 路径穿越片段 → warn
  "args_shape",
  // env_json 的键命中凭据形状黑名单（API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY 等）→ block
  "env_credential_shaped",
  // env_json 试图覆盖白名单基座键（PATH/HOME/LANG/LC_ALL/TZ/TMPDIR）→ block
  "env_overrides_base",
  // 引用的服务端变量（secret_refs_json 的值）当前不存在 → warn（管理员可能先配后重启）
  "secret_refs_present"
]);
export type McpPrecheckCheckId = z.infer<typeof mcpPrecheckCheckIdSchema>;

export const mcpPrecheckCheckSchema = z.object({
  id: mcpPrecheckCheckIdSchema,
  level: mcpPrecheckCheckLevelSchema,
  // 英文诊断细节（找不到的命令名、命中的键名等）。人话由展示层按 check id + detail 组装。
  detail: z.string().max(500).optional()
});
export type McpPrecheckCheck = z.infer<typeof mcpPrecheckCheckSchema>;

// 一次静态体检的完整结论。**不执行任何东西**——只做字符串判定与一次 access()。
export const mcpPrecheckReportSchema = z.object({
  // ok=可以登记；warn=能登记但有已知风险；blocked=拒绝登记。
  verdict: z.enum(["ok", "warn", "blocked"]),
  checks: z.array(mcpPrecheckCheckSchema),
  // 体检那一刻的时间戳，进 DB 的 precheck_report。
  checked_at: isoDateTimeSchema
});
export type McpPrecheckReport = z.infer<typeof mcpPrecheckReportSchema>;

// 一条 MCP 服务器记录的完整 VM——管理员/桌面端专用（列表端点整体是管理员门）。command / args / env /
// secret_refs / cwd 是「跑着 API 的这台机器」上的事实，只对管理员可见；网页只读走
// `mcpServerSummaryVmSchema`，结构性不给这些字段一个位置。
export const mcpServerVmSchema = z.object({
  id: idSchema,
  // 模型可见工具名的命名空间；本地配置，绝不取远端自报的 serverInfo.name。工作区内唯一。
  server_name: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/u),
  display_name: z.string().min(1).max(200).optional(),
  transport: mcpTransportSchema,
  // stdio 启动命令——裸名或本机绝对路径；相对路径在体检阶段就被拒绝。
  command: z.string().min(1).max(1000),
  args: z.array(z.string()),
  // 只允许非密键（应用层过凭据形状黑名单）；真正的密钥走 secret_refs，本表不存密文。
  env: z.record(z.string(), z.string()),
  // {子进程 env 名: 服务端 env 名}——存指针不是值。API 进程在 spawn 时从自己的 process.env 取值注入
  // 子进程；引用的服务端变量不存在时 fail-closed（该服务器标 connect_failed），不拿空串起进程。
  secret_refs: z.record(z.string(), z.string()),
  cwd: z.string().min(1).max(1000).optional(),
  tool_call_timeout_ms: z.number().int().min(1000).max(300000),
  enabled: z.boolean(),
  status: mcpServerStatusSchema,
  // 管理员断言的读写上限——规则见 mcpServerTrustLevelSchema 上方注释；映射本身在 M1。
  trust_level: mcpServerTrustLevelSchema,
  precheck_report: mcpPrecheckReportSchema,
  // 握手/调用失败的人话原因（连接失败时非空，成功后清空）。
  last_error: z.string().max(2000).optional(),
  // 最近一次发现的工具数。
  tool_count: z.number().int().nonnegative(),
  // 最近一次发现的工具名清单，给设置页预览（最多 6 个 + 「还有 N 个」由展示层截断）。
  tools: z.array(z.string()).optional(),
  installed_by: idSchema.optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema
});
export type McpServerVM = z.infer<typeof mcpServerVmSchema>;

// web 设置页的**只读**行。刻意不含 command / args / env / secret_refs / cwd——那些是宿主机事实与
// 潜在凭据指针，网页只回答「装了什么、还活着吗」，动作入口指向桌面客户端。裁剪口径照
// `pluginSummaryVmSchema` 的先例（那里刻意不含 source_path）。
export const mcpServerSummaryVmSchema = z.object({
  id: idSchema,
  server_name: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/u),
  display_name: z.string().min(1).max(200).optional(),
  transport: mcpTransportSchema,
  enabled: z.boolean(),
  status: mcpServerStatusSchema,
  trust_level: mcpServerTrustLevelSchema,
  tool_count: z.number().int().nonnegative(),
  precheck_verdict: mcpPrecheckReportSchema.shape.verdict
});
export type McpServerSummaryVM = z.infer<typeof mcpServerSummaryVmSchema>;
