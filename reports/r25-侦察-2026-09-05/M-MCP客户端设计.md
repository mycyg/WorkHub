# MCP 客户端接入设计（侦察员 W-M）

> 只出设计稿，不含产品代码。事实（带 file:line）与判断（标「判断」）分开写。
> 日期 2026-09-05，基线 `r25/integration-4`（`6db7a023`）。
>
> 术语：MCP = Model Context Protocol（模型上下文协议），一个「工具服务器」的开放标准。
> 一台 MCP 服务器把一组工具通过 JSON-RPC 暴露出来，客户端把它们翻成自己的工具喂给模型。
> stdio transport（标准输入输出传输）= 客户端起一个本机子进程，用它的 stdin/stdout 通信。
> Streamable HTTP transport（可流式 HTTP 传输）= 客户端对一个 URL 发 HTTP 请求，服务端可用
> SSE（Server-Sent Events，服务端推送事件）回流。

---

## 1. 一句话结论

**新建 `packages/mcp-client`，与 `packages/plugin-host` 平级而不复用它的子进程**——MCP 服务器本来就
是独立进程，再套一层我们自己的宿主只会多一跳；但**治理形状、env 白名单纪律、审计与热重载口径
全部照抄插件那一套**，另起一张 `mcp_servers` 表（迁移 0073），阶段 0 只做 stdio、只桥接 tools、
一律按 `external_effect` 对待。

---

## 2. 现状盘点

### 2.1 插件宿主（方案 B'）——MCP 要对齐的形状

事实：

- 子进程宿主本体 `packages/plugin-host/src/host.ts:188`（`createPluginHostRuntime`，运行时
  `await import()` 加载第三方模块）、`:272`（`serveStdio`，newline-delimited JSON-RPC）、
  `:313-317`（启动第一件事把 `process.stdout.write` 改道 stderr，防插件打印污染 RPC 流）。
- 线协议 `packages/plugin-host/src/protocol.ts:15`（`PLUGIN_HOST_PROTOCOL_VERSION = 1`，两端不一致
  握手直接失败）、`:18-31`（`PluginToolDescriptor`：pluginId/toolName/toolId/description/jsonSchema/
  timeoutMs）、`:78`（`createFrameDecoder`，坏行丢弃并计数）。
- env 白名单 `packages/plugin-host/src/env.ts:13`（只放行 `PATH HOME LANG LC_ALL TZ TMPDIR`）、
  `:21-33`（凭据形状黑名单兜底断言：`API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY` 及
  `DATABASE_URL|REDIS_URL|BROKER_URL|COOKIE_SECRET|ADMIN_CLAIM_SECRET`）、`:53`（`buildPluginHostEnv`
  命中黑名单直接抛错，fail-closed）、`:76`（明确不传 `NODE_OPTIONS`）。
- 两个方向的翻译器：宿主侧 `translate.ts:28`（`PLUGIN_TOOL_ID_PREFIX = "plugin__"`）、`:34`
  （`sanitizeToolNameSegment`，非 `[A-Za-z0-9_-]` 压成 `_`，**无 hash 兜底**）、`:40`（id 拼法
  `plugin__<插件>__<工具>`）、`:51`（`toJsonSchema`，删 `$schema`、`type` 缺省补 `object`）、
  `:86-113`（`renderToolContent`：只取 text 块，非 text 块留 `[unsupported content block: X]` 占位）；
  主进程侧 `to-tool-spec.ts:21`（`PLUGIN_TEXT_MAX_CHARS = 4000`）、`:28`（`sanitizePluginText`，去 C0
  控制字符 + 截断）、`:38-44`（入参 schema 只要求「是个对象」，真校验交给插件自己）、`:60-63`
  （阶段 0 硬钉 `sideEffect: "external_effect"` + `minScope: plugin:<id>:external_effect`）。
- 主进程生命周期 `apps/api/src/services/plugin-host-client.ts:48-58`（调用超时 30s、握手超时 20s、
  重启窗口 5 分钟内 3 次、活跃宿主上限 4）、`:241`（`createHostProcess` 每工作区一个）、`:258-276`
  （`onExit` 重启计数，超限置 `disabledReason`）、`:420-489`（按工作区分宿主 + LRU 关闭 + 清单变化即换进程）、
  `:491-533`（每次调用写审计 `plugin.tool.called`，写失败 fail-open 但留结构化日志）、`:607-618`
  （`reload` 顺手解除熔断）。
- 安装前静态体检 `apps/api/src/services/plugin-compat.ts:36`（安装期脚本键）、`:174`
  （`evaluatePluginManifest` 纯判定，无 IO）、`:281`（`normalizePluginSourcePath` 只认本机绝对目录）、
  `:302`（`inspectPluginSource` 只 stat + 读 package.json，**不执行插件代码**）。
- 治理服务与端点 `apps/api/src/services/plugins.ts:53-66`（拒装三类各有错误码）、`:88`（`requireAdmin`）、
  `:185-227`（`applyLoadResult`：试加载失败记 `load_failed` 而不是让请求失败）、`:246-337`（四个动作
  各落一条审计）；`apps/api/src/routes/plugins.ts:37-74`（五个端点）；`apps/api/src/app.ts:324` 挂载。
- 清单表 `packages/db/migrations/0072_plugins.sql:13-56`：workspace 围栏、`source_kind` 单值 CHECK
  （`local_path`）、`status ∈ {installed,load_failed,disabled}`、`compat_report`/`load_report` 两份 jsonb、
  唯一索引 `(workspace_id, source_path)`、启用行部分索引。
- 契约 `packages/contracts/src/domain/plugin.ts:17`（`source_kind` 单值字面量）、`:30-41`（体检项 id
  稳定枚举，两端 UI 靠它出人话）、`:81-97`（`pluginVmSchema`）、`:119-128`（`pluginSummaryVmSchema`，
  **刻意不含 `source_path`**，网页只回答「装了什么、还活着吗」）。
- 桌面端 `apps/desktop-webview/src/spotlight/views/settings.ts:535-740`：管理员门 =「服务端只给管理员
  填 `vm.plugins`」，`data-set-plugin-toggle` / `data-set-plugin-remove` 两段确认（`armedKey`），
  体检说明与安装错误码各有中英两版文案。
- 阶段 0 与阶段 1 的 Agent Note：`.agents/notes/implemented/2026-09-05-dsh-plugin-host-phase0.md:100-120`、
  `.agents/notes/implemented/2026-09-05-dsh-plugin-phase1-governance.md`。前者最后一条明写
  「与之并行的 MCP 客户端」是阶段 1 入口之一——本设计就是那一条。

### 2.2 工具契约与注册表

- `ToolSpec` 定义 `packages/tools/src/types.ts:63-92`：`id / description / promptSnippet? /
  promptGuidelines? / schema(Zod) / jsonSchema?(JSON Schema 旁路) / sideEffect / minScope? / execute`。
  `ToolSideEffect` 四档 `types.ts:3`：`none | sandbox_file | business_write | external_effect`。
- 注册表 `packages/tools/src/registry.ts:22-36`（`modelInputSchema`：有 `jsonSchema` 就直通，否则
  `zod.toJSONSchema`）、`:47-53`（重名 `register` 抛错）、`:88-106`（`visibleFor`/`toModelTools` 走 `canUse`）、
  `:108-152`（`execute`：canUse 再查一次 → Zod 校验 → 副作用非 none 必须过 `ctx.snapshot` 还原点门）。
- 装配点 `apps/api/src/workers/agent-runner.ts:713-733`：内置工具 + `extraSpecs`，**与内置重名的
  extra 被丢弃并记日志**（`:722-728`），不让重名抛错把整次执行带崩。插件工具来源
  `:296-306`（`defaultPluginToolsProvider`），角色可见性 `:262-268`（`canUseToolForTaskPlanRole`：
  research/review 角色只拿 `none`/`sandbox_file`）。
- `minScope` 至今**零运行时消费者**（全仓只有 `to-tool-spec.ts:63` 写、`plugin-smoke.ts:168` 与
  `to-tool-spec.test.ts:22` 断言）。R24-P 报告 6.2 那张 capability 表还是纸面设计。
  权限引擎本身是现成的：`packages/permissions/src/evaluate.ts:119-177`，`deny` 且
  `priority >= OVERRIDE_DENY_PRIORITY` 跨 scope 穿透一切，天然是「一键封禁某来源」的 kill-switch。

### 2.3 风险分级与人工保留门——一条必须先说清的硬事实

- `agent-runner.ts:709-711`：`sideEffectRiskCategory(sideEffect)`，`external_effect` → `"external"`。
- `agent-runner.ts:1716-1741`：每次 `execute` 先算 `riskCategory`，非空就问 `humanReservedGuard`，
  返回非空则**抛 409 `human_reserved_tool_call` 中断这次执行**。
- `human-reserved-guard.ts:246-250`：`toolRiskCategory` 非空时，**不管这个工单是否被标记人工保留，
  都会开升级事件**（`if (!workItem || (!workItem.humanReserved && !toolRiskCategory)) return null` ——
  有 riskCategory 就走不到 return null）。

**推论（事实层面的直接推导，不是判断）：按插件阶段 0 的口径把工具钉成 `external_effect`，
等于「每次调用都停下来转人」。** 插件冒烟之所以能跑通，是因为它注入了一个恒返回 null 的假 guard
（`apps/api/src/qa/plugin-smoke.ts:190-193`）。

判断：这对插件尚可接受（dsh 工具型插件多是写类动作），但对 MCP 是**产品级的不可用**——MCP 生态
里占大头的是只读检索/查询（文件系统、代码搜索、文档站）。所以本设计把「三档 sideEffect 映射」
从「以后再说」提前成阶段 1 的第一优先项，并给出一个不依赖服务器自述的安全映射（见 4.2）。
阶段 0 仍保持全 `external_effect`——不在打通链路的同一批里开新的放行口子。

### 2.4 提示词 golden 门

- 纪律条 `AGENTS.md:48`：模型可见文本（系统提示词、初始用户消息、**工具 name/description/input_schema**）
  由 `apps/api/expected/` 与 `packages/agent/expected/` 的逐字节 golden 钉住；改了要
  `pnpm gen:expected` 重生成并在 PR 贴 diff 摘要。`AGENTS.md:60`：模型可见文本的稳定变化要有可见评审证据。
- 生成脚本 `packages/agent/package.json:61` / `apps/api/package.json:12`（`WORKHUB_UPDATE_EXPECTED=1`）。
- 关键现状：`apps/api/src/golden/agent-run-prompt.golden.test.ts:53-57` 的 `registryForRole()`
  **只装内置工具**，所以插件工具的模型可见文本**至今没有任何 golden 覆盖**。产出文件
  `apps/api/expected/agent-run-tool-schemas.expected.json`。

判断：这是既有缺口。MCP 工具的 description 与 inputSchema 完全由第三方服务器控制，进模型请求体，
不加 golden 就等于这条通道无人看管。方案见 4.6。

### 2.5 沙箱与凭据现状

- `packages/tools/src/sandbox.ts:138-154`：`sandboxEnv` 原样透传宿主 `PATH`，注释自称
  「预算+路径围栏级别的软沙箱，**不是安全边界**」。`:8-19` 命令白名单，`:21-23` 明确禁
  `npm exec / pnpm dlx / bun x / run / create / init`（会从 registry 下载并执行任意包）。
- B8 Seatbelt 沙箱由另一位工人在做；设计底稿在 `r14-release-readiness/09-exec-design.md:103-124`
  （macOS `sandbox-exec` + SBPL `deny default`，`CommandRunner` 已是现成的注入点）。**本设计不与之
  重叠，只引用并在 4.4 给出衔接建议。**
- 可逆加密原语已有：`apps/api/src/services/secret-box.ts:34-60`（AES-256-GCM + env 主密钥
  `GITHUB_TOKEN_ENC_KEY`，零新依赖；`:7` 明写「主密钥与 COOKIE_SECRET 刻意分离」；未配置时
  调用方 fail-closed 503，绝不明文兜底）。
- 围栏中和：`packages/agent/src/loop/loop.ts:836-847`（`FENCE_TAG_NAMES` 九个 + `candidate_\d+`）、
  `:849-852`（`neutralizeFenceTags`：`<` → `‹`）、`:856-859`（`fenced()` 装入前先中和）。
  插件工具结果目前**不过**这道中和（`translate.ts:86-113` 返回原始文本）。

### 2.6 参考实现：deepseek-harness 的 MCP 客户端

事实（`reference/deepseek-harness/packages/mcp/mcp-client/`，包名 `@deepseek-ai/dsh-mcp-client@0.1.3-alpha.1`）：

- 用官方 SDK `@modelcontextprotocol/sdk`（`package.json` 里 `^1.12.0`；npm 上最新为 **1.30.0**，
  2026-09-05 联网确认）。不自己实现 JSON-RPC。
- Transport 工厂 `src/transport.ts:31-49`：`StdioClientTransport({command,args,env,cwd})` /
  `StreamableHTTPClientTransport(new URL(url), {requestInit:{headers}})`。子进程 env =
  `scrubbedParentEnv()`（`packages/subprocess/subprocess/src/index.ts:46,64`：**黑名单** 过滤
  `/KEY|PASSWORD|SECRET|TOKEN/i` 与 `DSH_*`，其余父环境全透传）再叠配置的显式 env。
- 命名 `src/tools.ts:110-117`：`publicToolName(serverName, rawName)` = `mcp__<server>__<raw>`，
  非法字符压 `_`；**一旦压缩或截断改了名，追加 12 位 SHA-256 hash**，保证不同 MCP 身份永不坍缩。
  上限 64 字符（DeepSeek 函数名约定，`:48`）。raw name 只在协议上用，公开名从不反解。
- 同步 `src/tools.ts:145-190`：两阶段——先把整代 `ToolDefinition` 拉全（分页 `tools/list`，
  同名 raw 直接抛错「无效工具列表」），再一次性换代；换代冲突整代回滚，绝不留半套。
- 配置 `src/index.ts:113-134`：`serverName` 必填且 `^[A-Za-z0-9_-]{1,32}$`，重复即启动失败；
  `toolCallTimeoutMs` 默认 60s；`failOnStartupError` 默认 false；`reconnect` 有界指数退避。
- 结果：保留规范 MCP 值 `{content, structuredContent}`，另做一份 Native 投影；多个 text 块用
  `'\n'` 连接（它的 Note 明写「保留多个 TextBlock」被否决，因为下游 `flattenText()` 用 `join('')` 会丢边界）。

**不该照抄的两处**（判断）：

1. `scrubbedParentEnv()` 是黑名单。WorkHub 已经在 `plugin-host/src/env.ts:1-10` 明确否决过这条口径
   （原话：「白名单，不是黑名单」）。MCP 子进程走白名单。
2. 它的 `serverName` 唯一性只在进程内存里（`index.ts:45` 一个 `WeakMap`）。WorkHub 有工作区围栏和
   一张表，唯一性该落到 `UNIQUE (workspace_id, server_name)` 上。

**该照抄的三处**：`mcp__<server>__<tool>` 命名与 hash 兜底（跨服务器重名是常态：Note 引的微软调查
里 1470 台服务器出现 775 个重名工具，`search` 一个名字出现在 32 台上）；两阶段换代；
per-server 有界重连（它最初否决了自动重连，运营反馈把这个决定翻了过来——这是别人已经付过学费的一课）。

---

## 3. 方案总览

```
                        apps/api 进程（有凭据、有 PG、有多租户围栏）
   ┌──────────────────────────────────────────────────────────────────────┐
   │  agent-runner  ──extraSpecs──►  ToolRegistry（canUse / 还原点门 /       │
   │        │                        human-reserved 门 —— 授权全在这一侧）    │
   │        │                                                              │
   │  services/mcp-client.ts（连接监督 + 每调用审计 + 超时/上限）             │
   │        │  用 packages/mcp-client 的纯函数做翻译                         │
   │        ▼                                                              │
   │   @modelcontextprotocol/sdk Client                                    │
   └────────┬──────────────────────────────────┬──────────────────────────┘
            │ stdio（阶段 0）                   │ Streamable HTTP（阶段 1）
            ▼                                  ▼
      本机 MCP 服务器子进程                 远端 MCP 服务器
      （白名单 env + 引用式密钥）           （密文 header + egress 白名单）
```

阶段划分与验收标准：

| 阶段 | 范围 | 验收标准 |
|---|---|---|
| **0** | 只 stdio（`command + args + env + cwd`）；只桥接 tools；全部 `external_effect`；无 live 重同步；管理员端点 + 桌面 UI + 网页只读；密钥走**引用**不落库 | ① `pnpm qa:mcp-smoke` 绿（六条断言 + 两条负向）；② 新 golden 文件生成且既有 expected 零 diff；③ 桌面 `.app` 真机走查：装一台真实 stdio 服务器 → 一次真执行里被调到 → `audit_logs` 查得到 `mcp.tool.called`；④ `pnpm verify` 全绿 |
| **1** | Streamable HTTP + 鉴权 header 密文落库 + egress 白名单；管理员断言的读写分级（把只读工具降到 `sideEffect:"none"`）；per-server 重连预算；B8 沙箱包裹 | ① HTTP 夹具（进程内 `StreamableHTTPServerTransport`）端到端；② `MCP_SECRET_ENC_KEY` 未配时 fail-closed 503，DB 里搜不到任何明文 header；③ 未登记 host 被 egress 闸拒掉；④ 只读工具不再触发人工保留升级，写类工具仍触发（同一夹具两个工具，正反各断言一次） |
| **2** | resources / prompts / `notifications/tools/list_changed` 实时重同步 | 只有当 WorkHub 侧出现明确消费方时才启动（见 4.8） |

---

## 4. 逐问题答案

### 4.1 范围与阶段

见上表。三条阶段 0 硬约束，逐条给理由：

1. **只 stdio。** HTTP 引入两件全新的东西——出网目的地治理（SSRF、数据外传）与密钥落库。
   两件都值得单独一批，混在打通链路的同一批里会让评审说不清哪条风险被谁挡住了。
2. **只桥接 tools。** 与 harness 同口径：resources 需要「什么时候把内容注进上下文」的决定，
   prompts 需要 WorkHub 还没有的「提示词模板」概念。tools 是高价值低风险的起点。
3. **无 live 重同步。** `tools/list_changed` 要求在一次执行**中途**换掉模型已经看过的工具清单，
   语义上很脏。阶段 0 只在连接时与显式治理动作（启停/新增/移除/测试连接）后重新发现。

### 4.2 与插件宿主的关系：新包 `packages/mcp-client`

**推荐新包，不复用 plugin-host 的子进程。** 理由三条：

- `plugin-host` 存在的唯一理由是「第三方 JS 必须在别的进程里 `await import()`」
  （`host.ts:10-12` 原话：加载第三方 JS 等于把凭据交出去）。MCP 服务器**本来就是别的进程**，
  第三方代码从不进我们的模块图。我们唯一新增的依赖是官方 SDK——那是我们自己选的一等依赖，
  与 `hono`/`zod` 同级，不需要进程隔离。
- 走 plugin-host 会变成 `apps/api → 我们的 RPC → 宿主进程 → MCP RPC → 服务器进程` 两跳，
  多一层帧解析、多一层超时叠加，且宿主的 env 白名单是「一个配置键都不给」的形状
  （`env.ts:64-71` 连覆盖 `PATH` 都拒），而 MCP 服务器**必须**能拿到配置与凭据。
- 生命周期不同：插件宿主是无状态的、可随时 LRU 关掉重建（`plugin-host-client.ts:440-458`）；
  MCP 连接是**有状态的长连接**（HTTP 还有 session id、有 `list_changed` 通知），
  按「清单一变就换进程」的策略去管会反复掐断在飞调用。

**包内分层**（按「纯函数可单测、IO 关在 apps/api」的既有分工）：

```
packages/mcp-client/src/
  names.ts        publicToolName / 服务器名校验          纯
  to-tool-spec.ts McpToolDescriptor → AnyToolSpec        纯
  content.ts      MCP CallToolResult → ToolResult        纯
  env.ts          子进程 env 组装（白名单 + 密钥引用）     纯
  precheck.ts     启动前静态体检（纯判定，IO 在 apps/api） 纯
  index.ts        纯入口（不 export SDK 相关）
apps/api/src/services/mcp-client.ts   SDK Client、连接监督、审计、超时
```

`index.ts` 只导出纯模块——照 `plugin-host/src/index.ts:1-12` 的先例（那里刻意不 re-export
`./host.js`，把 Cordis 关在子进程侧），这里把 SDK 关在 `apps/api` 侧。

**逐字段映射表**（MCP `Tool` → `ToolSpec`）：

| MCP 字段 | ToolSpec 字段 | 规则 | 依据 |
|---|---|---|---|
| `name`（raw，≤128 字符，可含 `.`） | `id` | `mcp__<serverName>__<rawName>`，非 `[A-Za-z0-9_-]` 压 `_`；**若替换或截断改了名，追加 12 位 SHA-256(`serverName\0rawName`) hash**；上限 **64** 字符 | 借 harness `tools.ts:110-117`；64 是 DeepSeek 函数名约定与 Anthropic `^[a-zA-Z0-9_-]{1,128}$` 的交集（WorkHub 走 DeepSeek 的 /anthropic 兼容端点，`packages/config/src/providers.ts:49`） |
| — | — | raw name **只**在 `tools/call` 上用，公开名永不反解 | 同上 |
| `description`（可缺） | `description` | `sanitizeModelFacingText(desc, 4000)`；缺省回落 `Tool '<raw>' from MCP server '<server>'.` | 对齐 `to-tool-spec.ts:28` 与 `translate.ts:69-71` |
| `inputSchema` | `jsonSchema` | 直通，删 `$schema`，`type` 缺省补 `"object"`；**序列化超 32KB → 丢弃该工具并记诊断**（截断 JSON Schema 会产出无效 schema，宁可不上线）；含**远程 `$ref`**（`http:`/`file:`）→ 丢弃 | 对齐 `translate.ts:51-61`；上限是新增（现无上限，见 5.3） |
| — | `schema`（Zod） | `z.custom` 只要求「是对象或空」+ 序列化入参 ≤256KB | 对齐 `to-tool-spec.ts:38-44`（真校验交给服务器） |
| `annotations.readOnlyHint` / `destructiveHint` | `sideEffect` | **阶段 0：一律 `external_effect`，完全忽略 annotations。** 阶段 1：`sideEffect = "none"` 当且仅当**管理员把这台服务器断言为只读** **且** 该工具 `readOnlyHint === true`；其余一律 `external_effect` | MCP 规范自己写明 annotations 是不可信提示，客户端不得据以做安全判断。「管理员断言 AND 服务器自述」= 服务器只能在管理员划定的上限内**降**风险，不能自己抬权限 |
| — | `minScope` | `mcp:<serverName>:<external_effect \| read>` | 对齐 `to-tool-spec.ts:63` 的 `plugin:<id>:<cap>` 拼法；喂 `permissions/evaluate.ts:119-177` 的 glob，`mcp:github:*` / 全局 `mcp:*` 一键封禁。**如实说明：`minScope` 至今零消费者，它不是门** |
| `outputSchema` / `structuredContent` | `ToolResult.data` | 原样带回，不做校验 | 对齐 `plugin-host-client.ts:556` |
| `content[]` | `ToolResult.content` | 只取 text 块，`\n` 连接；非 text 留 `[unsupported content block: X]`；**过 `neutralizeFenceTags`**；上限 32KB，超出截断并留 `[truncated: 共 N 字符]` | 前两条对齐 `translate.ts:100-113`；中和与上限是新增（见 4.4、6.2）；截断标记形态对齐 `file-tools.ts:231` |
| `isError: true` | — | 转 `errorToolResult`，不当传输失败 | MCP 把工具错误放在带内 |

**`human-reserved-guard` 词表怎么套**：不用改词表。`classifyHumanReservedToolCall`
（`human-reserved-guard.ts:105-140`）把工具 id 按非字母数字切词，`mcp__stripe__create_payment`
→ `[mcp, stripe, create, payment]`，`payment` 命中 finance 词表（`:77`）直接归财务类。
**副作用（也是设计属性）：服务器名参与分词。** 一台叫 `finance` 的服务器，它的每个工具都会被
归到财务类。判断：这是好事（管理员给服务器起名等于给它打风险标签），但必须在添加服务器的
界面上说明白，否则一台叫 `publish` 的服务器会让所有工具无差别升级，用户会以为坏了。

**与内置工具的命名空间**：内置 id 是 `list_files / read_file / write_file / write_base64_file /
mkdir / move_path / delete_path / run_command / zip_path / submit / load_skill`
（`file-tools.ts:185-376`、`skills.ts:194`），没有任何一个以 `mcp__` 开头，
且 `agent-runner.ts:722-728` 的重名丢弃守卫照样兜底。

**共享一小块**：`sanitizePluginText`（`to-tool-spec.ts:28`）会有第二个消费者。建议挪进
`packages/tools`（改名 `sanitizeModelFacingText`，两个包都已依赖它，且它管的正是「第三方文本进
模型可见通道」这件事），plugin-host 改一处 import。**只挪这一个函数**——`sanitizeToolNameSegment`
不共享，因为 MCP 版本需要 hash 兜底，逻辑本来就不同，强行合并会造出一个带开关的四不像。

### 4.3 治理：新表 `mcp_servers`（迁移 0073）

**不复用 0072 `plugins` 加 `source_kind`。** 四条理由：

1. **唯一键不同。** 插件是「同一目录不许装两次」（`plugins_workspace_source_path_uq`）；
   MCP 是「`server_name` 在工作区内必须唯一且稳定」——因为它直接构成模型可见工具名，
   撞名会让两台服务器的工具坍缩。把这条约束塞进 `source_path` 的唯一索引里是伪装。
2. **配置形状是判别联合。** stdio 有 `command/args/env/cwd`，HTTP 有 `url/headers`，
   后者半边带密钥。挂到 `plugins` 上等于给每一行插件都白挂三个用不上的 `bytea` 列。
3. **体检项枚举不相交。** `pluginCompatCheckIdSchema`（`contracts/domain/plugin.ts:30-41`）
   全是 dsh 概念（`dsh_tools_peer`、`bundle_manifest`、`client_surface`）；MCP 一条都不适用。
   混进同一个 z.enum 会让桌面端 `pluginCompatLines` 的 switch 变成两套逻辑挤在一个函数里。
4. **治理动作不同**：MCP 多一个「测试连接」和「重新发现工具」，审计动作名也该分开。

**复用的是形状，不是表**：`mcp_servers` 逐列对照 0072 排（workspace 围栏 / enabled / status /
报告 jsonb / tool_count / installed_by / 时间戳），服务层与路由层照 `services/plugins.ts` 与
`routes/plugins.ts` 一比一长。

```sql
-- packages/db/migrations/0073_mcp_servers.sql（全 additive，IF NOT EXISTS，与 0072 同约定）
CREATE TABLE IF NOT EXISTS "mcp_servers" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  -- 模型可见工具名的命名空间；本地配置，绝不取远端自报的 serverInfo.name。
  "server_name" varchar(32) NOT NULL,
  "display_name" text,
  "transport" varchar(24) NOT NULL DEFAULT 'stdio',
  "command" text,                                  -- stdio
  "args_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "env_json" jsonb NOT NULL DEFAULT '{}'::jsonb,   -- 只允许非密键（应用层黑名单 + 本表不存密文）
  "secret_refs_json" jsonb NOT NULL DEFAULT '{}'::jsonb, -- {子进程env名: 服务端env名}，见下
  "cwd" text,
  "url" text,                                      -- 阶段 1
  "auth_header_ct" bytea, "auth_header_iv" bytea, "auth_header_tag" bytea, -- 阶段 1
  "tool_call_timeout_ms" integer NOT NULL DEFAULT 60000,
  "enabled" boolean NOT NULL DEFAULT true,
  "status" varchar(24) NOT NULL DEFAULT 'connected',
  "precheck_report" jsonb NOT NULL,                -- 启动前静态体检，不执行任何东西
  "last_error" text,
  "tool_count" integer NOT NULL DEFAULT 0,
  "tools_json" jsonb,                              -- 最近一次发现的工具名清单，给设置页预览
  "installed_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  -- 阶段 0 结构性只允许 stdio；放开 http 必须走新迁移，改动点显式可查（同 plugins_source_kind_ck）
  CONSTRAINT "mcp_servers_transport_ck" CHECK ("transport" IN ('stdio')),
  CONSTRAINT "mcp_servers_status_ck" CHECK ("status" IN ('connected','connect_failed','disabled')),
  CONSTRAINT "mcp_servers_timeout_ck" CHECK ("tool_call_timeout_ms" BETWEEN 1000 AND 300000),
  CONSTRAINT "mcp_servers_tool_count_ck" CHECK ("tool_count" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_servers_workspace_name_uq" ON "mcp_servers"("workspace_id","server_name");
CREATE INDEX IF NOT EXISTS "mcp_servers_workspace_created_idx" ON "mcp_servers"("workspace_id","created_at");
CREATE INDEX IF NOT EXISTS "mcp_servers_workspace_enabled_idx" ON "mcp_servers"("workspace_id")
  WHERE "enabled" = true AND "status" <> 'disabled';
```

**密钥不落库明文的方案——阶段 0 干脆不落库。**

- `env_json` 的键过 `isDeniedPluginHostEnvKey`（`plugin-host/src/env.ts:35-38`）：命中
  `API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY` 等形状**直接 422 拒绝**，
  错误码 `mcp_env_credential_shaped`，文案告诉用户改用密钥引用。于是这一列结构性存不进凭据。
- `secret_refs_json` 存的是**指针不是值**：`{"GITHUB_TOKEN": "WORKHUB_MCP_SECRET_GITHUB"}`，
  API 进程在 spawn 时从**自己的** `process.env` 里取值注入子进程。运维方式与
  `WORKHUB_PLUGIN_PATHS`、`LLM_API_KEY` 完全一致，零新增的静态密钥面。
  引用的服务端变量不存在 → **fail-closed**：该服务器标 `connect_failed`，`last_error` 写
  「引用的服务端变量 X 没有配置」，不拿空串起进程（起来了也只会在第一次调用时报一个远端的 401，
  更难查）。
- 阶段 1 的 HTTP header 才需要真正的落库密文：复用 `services/secret-box.ts` 的
  AES-256-GCM 三列形态（`ciphertext/iv/authTag`），**用一把独立主密钥 `MCP_SECRET_ENC_KEY`**
  ——理由照抄 `secret-box.ts:7`：泄漏影响面和轮换节奏都不同。未配置时相关端点 503。

**启动前静态体检**（不执行任何东西，纯判定 + 一次 `access()`），照 `evaluatePluginManifest` 的
「稳定 id 枚举 + level(pass/warn/block) + 英文 detail，人话由展示层出」形状：

| id | 判据 | 结论 |
|---|---|---|
| `server_name` | 不匹配 `^[A-Za-z0-9_-]{1,32}$`，或该工作区已被占用 | block |
| `command_resolvable` | 裸名在 API 进程 `PATH` 上找不到；或绝对路径不存在/不可执行；**相对路径一律拒**（相对谁？API 的 cwd 是部署细节，同 `normalizePluginSourcePath` 的理由） | block |
| `remote_exec_launcher` | 命令归一化后是 `npx` / `pnpm dlx` / `bunx` / `uvx` 等「每次启动从 registry 下载并执行」的启动器 | **block**（见 5.1 待拍板） |
| `args_shape` | 参数含 NUL；或含 `..` 路径穿越片段 | NUL→block，`..`→warn |
| `env_credential_shaped` | `env_json` 的键命中凭据形状黑名单 | block |
| `env_overrides_base` | `env_json` 试图覆盖白名单基座键（PATH/HOME/…） | block（对齐 `env.ts:66-71`） |
| `secret_refs_present` | 引用的服务端变量当前不存在 | warn（管理员可能先配后重启） |

**启停 / 热重载 / 崩溃熔断**，与插件对齐但有一处**刻意的改进**：

- 启停/新增/移除/测试连接后按新清单重连（对齐 `services/plugins.ts:229-236` 的 `reloadQuietly`：
  宿主起不来不该让一次已在 DB 上生效的治理动作失败）。
- 握手（connect + `initialize` + 首次 `tools/list`）超时 20s，同 `PLUGIN_HOST_HANDSHAKE_TIMEOUT_MS`。
- 单次调用超时 `min(配置值, 120s)`，默认 60s（与 harness 同；MCP 工具常做真网络活，插件那条 30s 太短）。
- 重连：有界指数退避，窗口内次数用尽 → 注销**这一台**服务器的工具、标 `connect_failed`，其余服务器不受影响。
  **改进点**：插件那侧的熔断是**整个插件面**级别的（`plugin-host-client.ts:228-229` 的
  `disabledReason` 是闭包级变量），一个坏插件能把所有插件一起关掉。MCP 从第一天就做成 per-server。
  判断：这也是插件那侧值得回头修的一条，但**不在本轮范围**，只在报告里点名。
- 活跃子进程上限 8 + **空闲 10 分钟自动断开**（下次用到重连）。插件那侧只有数量上限
  （`PLUGIN_HOST_MAX_LIVE_PROCESSES = 4`），对长连接来说空闲回收比数量封顶更贴切。

**端点**（照 `routes/plugins.ts` 一比一，全管理员门，判定在服务层）：

```
GET    /api/mcp-servers                 清单 + 每台的工具名预览 + SDK 版本
POST   /api/mcp-servers                 新增（体检 → 登记 → 试连接 → 回填工具数）
POST   /api/mcp-servers/:id/enable      启用（重连，结果可能是连不上）
POST   /api/mcp-servers/:id/disable     停用（工具从此不出现在任何一次执行里）
POST   /api/mcp-servers/:id/test        测试连接：连上、列工具、**不注册**，只回报告
DELETE /api/mcp-servers/:id             移除
```

审计五条：`mcp_server.added / enabled / disabled / removed / tested`，加上每次工具调用的
`mcp.tool.called`（entityType `mcp_invocation`，detail 带 server_name / raw tool name / duration /
args 摘要 / 结果摘要，摘要上限 400 字符——全部对齐 `plugin-host-client.ts:491-533`）。

新端点必须同批补三处（`AGENTS.md` 纪律）：`apps/api/src/openapi.ts` + `packages/contracts` +
`packages/api-client`。

### 4.4 安全

1. **子进程 env：白名单，不是黑名单。** 基座 = `PLUGIN_HOST_ENV_ALLOWLIST` 那六个键
   （`PATH HOME LANG LC_ALL TZ TMPDIR`），叠 `env_json`（已过凭据形状黑名单），叠
   `secret_refs_json` 解出来的值。不传 `NODE_OPTIONS`。**明确否决 harness 的 `scrubbedParentEnv()`**
   ——WorkHub 已经写下过这条判断（`env.ts:1-10`），黑名单漏一个 `MY_COMPANY_PAT` 就全给出去了。
   代价要说清：某些 MCP 服务器依赖 `HTTPS_PROXY`/`NO_PROXY` 才能出网；要加就**显式加进白名单
   并过一条 Agent Note**（`env.ts:12` 原话「加键要过 Agent Note，不能顺手加」）。
2. **工具结果是不可信数据。** 三层处理：`neutralizeFenceTags` 中和 → 非 text 块占位不静默丢 →
   32KB 上限带截断标记。中和这一层的理由要说准：工具结果本身进的是 tool_result 消息（不在围栏里），
   但它**常被工人原样抄进 `outputs/` 与自述**，而那两条确实进围栏
   （`loop.ts:856-859` 的 `fenced()`、`collectOutputExcerpts`）。中和成本 O(len)，堵的是一条二段式逃逸。
   判断：插件那侧同样没做，建议同一批一起补（见 5.2）。
3. **每次调用落审计**，写失败 fail-open 但留结构化日志——照抄 `plugin-host-client.ts:528-532` 的理由：
   「没有审计」和「没有调用」必须分得清。
4. **与 B8 Seatbelt 沙箱的关系——建议：阶段 0 不包，阶段 1 单独一个工包，且不能照搬 run_command 的策略。**
   - 不在阶段 0 包：B8 还没落地，让 MCP 依赖未完成的工作会把两件事一起卡住。
   - 阶段 1 要包，但**策略必须不同**：`run_command` 的目标是「只准碰 workdir、不准出网」；
     一台文件系统 MCP 服务器的**全部价值**就是读 workdir 之外的目录，一台检索类服务器的全部价值
     就是出网。套上 `deny default` 会把它们变成摆设。
   - 建议的形状：B8 把策略构造暴露成可复用的 seam（`CommandRunner` 已经是现成先例，
     `types.ts:50`）；MCP 侧按服务器逐台声明「读根目录清单 / 是否允许出网」，默认
     「只读 cwd + 禁网」，管理员逐台放宽，每次放宽落一条审计。
   - 在此之前，README/`.env.example` 照阶段 0 的原话写实：这是一个由管理员显式启动的第三方进程，
     它以 API 进程的用户身份运行（`.agents/notes/implemented/2026-09-05-dsh-plugin-host-phase0.md:112`
     已有同样口径的先例，不要在 MCP 这里含糊）。
5. **不做静态源码扫描。** 阶段 1 的插件 Note 已经写过这条判断并否决了：静态扫描对一行 `eval` 就失效，
   给的是虚假安全感。MCP 更甚——服务器可能根本不是 JS。

### 4.5 桌面端体验

`apps/desktop-webview/src/spotlight/views/settings.ts` 的「插件」分区下长出并列的「MCP 服务器」子分区，
形状一比一照抄现有实现：

- **管理员门**：`vm.mcp_servers !== undefined` 才渲整区（服务端只给管理员填这个字段），
  不自己猜身份、不靠一个 403 闪一下（`settings.ts:537-538` 的既有口径）。
- **列表行**：`<名字> <版本/传输>` / 状态行（`已启用 · N 个工具` / `已停用` / `连不上：<原因>`）/
  命令行（灰字，网页看不到）/ 工具名预览（最多 6 个 + `还有 N 个`）。
- **动作**：启停、移除各两段确认（复用 `armedKey` 机制）；「测试连接」单段，跑完在行内出结果。
- **添加表单**：名字 / 命令 / 参数（一行一个）/ 工作目录 / 环境变量（`KEY=VALUE` 一行一条）/
  密钥引用（`子进程变量名 → 服务端变量名`）。
  - **实时预览工具名前缀**：填名字时就显示 `mcp__<名字>__…`。这不是装饰——算术是
    `mcp__`(5) + 名字(≤32) + `__`(2) = 最多 39 字符，64 的预算只剩 25 给服务器自己的工具名，
    超了就会挂 hash 后缀变得难认。预览会自然把人推向 `gh`、`fs` 这种短名。
  - 名字下方一行提示：**名字里的词会参与高风险判定**（4.2 末尾那条属性）。

首次添加引导文案（中英各一段，短）：

- 中：「MCP 服务器是跑在这台机器上的一个小程序，它把一组工具借给 Cuu 用。你要填的是启动它的命令——
  和你在终端里敲的那一行一样。名字只用来区分服务器，它会出现在工具名前面。」
- 英："An MCP server is a small program on this machine that lends a set of tools to Cuu. What you
  provide is the command that starts it — the same line you would type in a terminal. The name only
  tells servers apart; it shows up in front of the tool names."

错误态（每条一个稳定错误码，两端 UI 按码出人话，不解析英文诊断——`services/plugins.ts:52` 的既有纪律）：

| 码 | 中 | 英 |
|---|---|---|
| `mcp_command_not_found` | 找不到命令「X」。请填这台机器上真实存在的可执行文件；`which X` 查到的完整路径最稳。 | Can't find the command "X". Point this at a real executable on this machine; the full path from `which X` is safest. |
| `mcp_handshake_timeout` | 这台服务器 20 秒内没握上手。多半是命令起来了但它不是一个 MCP 服务器，或者它在等一个没拿到的凭据。 | This server didn't answer within 20 seconds. Either the command isn't an MCP server, or it's waiting on a credential it didn't get. |
| `mcp_no_tools` | 连上了，但它一个工具都没提供。它可能只提供资源或提示词——这一版只接工具。 | Connected, but it offers no tools. It may only offer resources or prompts, which this version doesn't take. |
| `mcp_server_name_taken` | 这个名字已经被另一台服务器用了。名字会出现在工具名里，必须唯一。 | That name is already used by another server. Names appear inside tool names, so they must be unique. |
| `mcp_remote_exec_refused` | `npx` 每次启动都会从网上下载并执行代码，我们不这么起服务器。请先把它装到本机，再填装好之后的路径。 | `npx` downloads and runs code from the network on every start, so we don't launch servers that way. Install it locally first, then point at the installed path. |
| `mcp_env_credential_shaped` | 环境变量「X」看着像一份凭据。凭据不落库——请改用密钥引用，指向服务端上的一个变量名。 | The variable "X" looks like a credential. Credentials aren't stored here — use a secret reference that points at a server-side variable name. |

**网页端只读**，理由与插件一字不差：要填的是「跑着 API 的那台机器」上的命令，在网页里让人凭空写
一个服务器命令既说不清也验不了。网页 VM 照 `pluginSummaryVmSchema:119-128` 的裁剪口径——
**不含 command / args / env / url**（那些是宿主机事实与潜在凭据），只回答「装了什么、还活着吗」，
动作入口指向桌面客户端。

桌面端改动必须真机走查（`AGENTS.md` 纪律：浏览器预览没有 Tauri 运行时，渲染不出）。

### 4.6 测试与门

1. **纯函数单测**（`packages/mcp-client`，`node:test`）：
   - `publicToolName`：干净名原样、非法字符压缩、超长截断加 hash、确定性、两个不同身份永不坍缩、
     hash 只在有损时才加（这条最容易写反）。
   - `toMcpToolSpec`：description 缺省回落 / 中和 / 4000 上限；jsonSchema 直通 + 删 `$schema` +
     补 `type`；32KB 超限丢弃；远程 `$ref` 丢弃；`sideEffect`/`minScope` 两档映射的真值表
     （管理员断言 × `readOnlyHint` 四种组合各一条）。
   - `renderMcpContent`：多 text 块 `\n` 连接、非 text 占位、`isError` 转错误结果、
     32KB 截断带标记、围栏字面量被中和。
   - `buildMcpChildEnv`：白名单基座、凭据形状键抛错、覆盖基座键抛错、密钥引用解析、
     引用不存在时 fail-closed。
   - `precheckMcpServer`：七条规则各一条正例一条反例（纯判定，`access()` 结果由入参给）。
   - 边界要覆盖极小值/临界值/超大单块/多字节边界（`AGENTS.md` 评审规则第 7 条）。
2. **本地假 MCP 服务器夹具**：`packages/mcp-client/qa/fixtures/mcp-echo-server/`，
   一个 `index.js`（纯 `.js`，裸 `node` 可跑，不需要 tsx——照 `plugin-host/qa/fixtures/dsh-plugin-echo/lib/index.js` 的先例），
   **用官方 SDK 的 `Server` + `StdioServerTransport`**，暴露恰好两个工具：
   - `echo`（`annotations.readOnlyHint: true`，参数 `{text: string}`，把 text 原样返回）
   - `write_note`（无 annotations，带副作用语义）
   两个工具正好把 4.2 的映射真值表跑成端到端。用真 SDK 起服务端而不是手搓 JSON-RPC，
   是因为手搓只能证明「我们的帧解析和自己一致」（`AGENTS.md` 评审规则：验证世界，不验证自述）。
   SDK 已是本包依赖，夹具**不需要联网**。
3. **`pnpm qa:mcp-smoke`**（`apps/api/src/qa/mcp-smoke.ts`，脚本挂在根 `package.json` 的
   `qa:plugin-smoke`（`package.json:42`）旁边和 `apps/api/package.json`），断言链照
   `plugin-smoke.ts` 的六条改写，另加两条负向：
   1. 连上、发现恰好 2 个工具、id 都在 `mcp__` 名字空间；
   2. 模型可见 schema 走 MCP `inputSchema`（看得见 `text` 参数），不是退化的 `{type:"object"}`；
   3. 两个工具的 `sideEffect`/`minScope` 与映射表一致；
   4. 一次执行里模型发出的调用真的执行了，内容是夹具算出来的；
   5. 轨迹里既有调用也有结果；
   6. `audit_logs` 里有 `mcp.tool.called`，带服务器名/工具名/耗时/结果摘要；
   7. **负向**：夹具返回一段含 `</outputs>` 的文本 → 回来的内容里是 `‹/outputs›`；
   8. **负向**：夹具返回 100KB 文本 → 回来的内容 ≤32KB 且带截断标记。
   全程假 provider（不需要 LLM key）、内存仓库（不碰 PG），可当常规门跑。
   PR 必须附「先引入一次回归、看它红、再还原」的证据（`AGENTS.md` 评审规则第 4 条）。
4. **golden 覆盖**：新建 `apps/api/src/golden/mcp-tool-schemas.golden.test.ts`，用**常量
   `McpToolDescriptor` 夹具**（不起服务器——golden 必须离线且确定）建注册表，产出新文件
   `apps/api/expected/agent-run-tool-schemas.mcp.expected.json`，钉住 id 形状 / 中和后的
   description / 直通的 input_schema / `side_effect`。
   **硬约束：不许改动任何既有 expected 文件。** 既有 `registryForRole()`
   （`golden.test.ts:53-57`）只装内置工具，MCP 是新增的独立 golden；`pnpm gen:expected` 之后
   `git diff` 应当只有新文件。这条要写进工包验收命令里。
5. **DB 层**：`packages/db/src/schema.test.ts` 补 `mcp_servers`（照 `schema.test.ts:1087` 那条
   「密文三列、迁移里绝不出现明文列」的断言写法），`mcp-servers-repository.test.ts` 照
   `plugins-repository.test.ts` 写；`pnpm audit:migrations` 必过。
6. **不新增 `docs/workhub/*.md`**（会触 `qa:r2-release-gate` 的 `docs.count` 门，
   `scripts/qa/r2-release-gate-report.ts:183-186`）；文档落在 Agent Note 与 README 的兼容面表格里。

### 4.7 派工切分

模型建议一栏：opus 给「一次做对成本远高于返工成本」的（命名不变式、内容中和、连接监督、门禁）；
其余 sonnet。

| 包 | 内容 | 模型 | 大小 | 允许改动文件 | 验收命令 |
|---|---|---|---|---|---|
| **M0** 契约与迁移 | `packages/contracts/src/domain/mcp.ts` + barrel；`0073_mcp_servers.sql`；`packages/db/src/schema/core.ts`、`repositories/mcp-servers.ts` + 两个测试 | sonnet | M | 上述 + `packages/db/src/schema.test.ts` | `pnpm typecheck && pnpm --filter @workhub/db test && pnpm audit:migrations` |
| **M1** 纯翻译包 | 新包 `packages/mcp-client`：`names/to-tool-spec/content/env/precheck/index` + 单测。**零 IO、零 SDK 依赖** | opus | M | 只该包 | `pnpm --filter @workhub/mcp-client test && pnpm typecheck` |
| **M1b** 抽 sanitize | `sanitizePluginText` → `packages/tools` 的 `sanitizeModelFacingText`；plugin-host 改一处 import | sonnet | S | `packages/tools/src/{types,index}.ts`、`packages/plugin-host/src/to-tool-spec.ts` + 其测试 | `pnpm test && pnpm gen:expected`（diff 必须为空） |
| **M2** 连接与监督 | `apps/api/src/services/mcp-client.ts`：SDK Client、transport、握手/调用超时、per-server 重连预算、空闲回收、每调用审计；SDK 依赖进 `packages/mcp-client` | opus | L | 上述 + 该文件的测试（假 transport） | `pnpm --filter @workhub/api test && pnpm typecheck` |
| **M3** 治理服务与端点 | `services/mcp-servers.ts`、`routes/mcp-servers.ts`、`app.ts` 挂载与错误映射、`openapi.ts`、`packages/contracts`、`packages/api-client` | sonnet | L | 上述 + `routes/mcp-servers.test.ts` | `pnpm --filter @workhub/api test && pnpm typecheck` |
| **M4** 装配接线 | `agent-runner.ts` 的 `extraSpecs` 合流（插件 ∪ MCP，重名丢弃记日志）、`server.ts` 接线与优雅关闭 | sonnet | S | `workers/agent-runner.ts`、`server.ts` | `pnpm --filter @workhub/api test` |
| **M5** 夹具与冒烟门 | `packages/mcp-client/qa/fixtures/mcp-echo-server/`、`apps/api/src/qa/mcp-smoke.ts`、两处 package.json 脚本 | opus | M | 上述 | `pnpm qa:mcp-smoke`；**PR 附回归变红的证据** |
| **M6** golden | `apps/api/src/golden/mcp-tool-schemas.golden.test.ts` + 新 expected 文件 | sonnet | S | 上述两处 | `pnpm gen:expected` 后 `git diff` 只有新文件；`pnpm --filter @workhub/api test` |
| **M7** 桌面端 | `spotlight/views/settings.ts` 的 MCP 分区 + `settings.test.ts` + 窗口桥接 | sonnet | L | `apps/desktop-webview/src/spotlight/views/*`、`window-bridge.ts` | `pnpm --filter @workhub/desktop-webview test` + **`.app` 真机走查截图** |
| **M8** 网页只读 | `apps/api/src/pages/settings.ts` 加 `mcp_servers` 只读行 + `packages/ui` 渲染 + i18n | sonnet | M | 上述 | `pnpm --filter @workhub/api test`、`pnpm audit:copy-terms`，必要时 `qa:r4-web-live-route-interaction` |
| **M9** Note 与文档 | `.agents/notes/implemented/2026-09-05-mcp-client-phase0.md`；README 兼容面表格补 MCP 一行 | sonnet | S | notes + README | `pnpm audit:agent-notes && pnpm lint` |

**串行依赖**（其余可并行）：

```
M0 ─┐
M1 ─┼─► M2 ─► M3 ─► M7
M1b─┘        └► M4 ─► M5
                     M6（需 M1）
             M0 ─► M8
    全部 ─► M9（Note 要写最终决定，不能先写）
```

- M0 / M1 / M1b **可同时开工**（M1 的描述符类型留在包内，不进 contracts，照
  `PluginToolDescriptor` 留在 plugin-host 的先例）。
- M5 必须在 M2+M4 之后（它跑的是端到端）。M6 只依赖 M1（用常量夹具）。
- M7 可在 M0 的契约落地后就开工（对着契约写 UI），但真机走查要等 M3。

### 4.8 不做什么（各一句理由）

| 不做 | 理由 |
|---|---|
| **sampling**（`sampling/createMessage`，服务器反过来请求我们的模型出文本） | 它花的是我们的 key 和预算，而 WorkHub 的成本/预算/评审门全挂在一次 agent 执行上——服务器发起的补全没有可归属的执行，记不了账 |
| **roots**（告诉服务器它可以碰哪些目录） | 我们在阶段 0 根本不向 MCP 服务器授予文件系统权限（它拿的是 API 进程用户能碰的一切），公布 roots 等于做一个我们执行不了的承诺 |
| **elicitation**（服务器在调用中途向人提问） | WorkHub 唯一的「执行中问人」机制是升级，它是异步且按执行范围的；把一个同步的、服务器驱动的提问接进去是另一套设计 |
| **OAuth 完整流程** | 需要回调地址、按用户存 token、刷新——那是身份功能，不是工具来源功能。阶段 1 只存一个静态 bearer header |
| **resources / prompts** | 我们侧没有消费方：resources 要先决定「什么时候把内容注进上下文」，prompts 要先有「提示词模板」概念。harness 也因为同样理由延后了 |
| **把 WorkHub 暴露成 MCP 服务器** | 反方向的功能、另一套威胁模型，且没人提这个需求 |
| **`tools/list_changed` 实时重同步** | 要在一次执行中途换掉模型已经看过的工具清单，语义脏；阶段 0 只在连接与显式治理动作后重新发现 |
| **npm / git / tarball 形式的服务器安装通道** | 与 `plugin_install_scripts_refused` 是同一条红线：安装期脚本是任何沙箱之外的任意代码执行 |
| **静态扫描服务器源码找危险 API** | 阶段 1 的插件 Note 已经否决过：一行 `eval` 就失效，给的是虚假安全感；MCP 服务器还可能根本不是 JS |
| **阶段 0 包 Seatbelt** | B8 在做，依赖未完成的工作会把两件事一起卡住；且 MCP 的策略不能照搬 run_command 的（见 4.4 第 4 条） |

---

## 5. 风险与开放问题（需要指挥者拍板）

### 5.1 【要拍板】`npx` 类启动器拦不拦

生态现实：几乎所有 MCP 服务器的官方文档都写
`npx -y @modelcontextprotocol/server-github`。拦掉等于「教程上的每一行都用不了」。
不拦等于每次起服务器都从 registry 下载并执行任意代码——正是 `plugin_install_scripts_refused`
（`plugin-compat.ts:36`）和 `sandbox.ts:21-23` 各自封死过的那条路。

三个选项：

- **A（本设计推荐）**：阶段 0 拦，错误文案教用户「先本机装好，再填装好之后的路径」。
  代价是上手多一步，收益是安全口径全仓一致。
- **B**：放行，但只允许 `npx --no-install`（不存在就失败，不下载），并要求包已在本机缓存。
  折中，但「已缓存」这个状态用户看不见也控制不了，出错时极难解释。
- **C**：放行并记一条醒目审计。判断：这会让 WorkHub 的两条既有红线对同一类风险给出相反答案，
  评审上说不通。

### 5.2 【建议同批修】插件那侧的三个同源缺口

都不是 MCP 引入的，但 MCP 会把它们放大，且改法完全一样：

1. 插件工具结果**不过** `neutralizeFenceTags`（`translate.ts:86-113`）。
2. 插件工具结果**没有长度上限**——`read_file` 有 2MB 上限（`file-tools.ts:219-231`），
   插件返回多少就进多少。
3. 插件熔断是**整个插件面**级别的（`plugin-host-client.ts:228-229`），一个坏插件关掉全部插件。

建议：1 和 2 在 M1b 那个工包里顺手一起做（同一个纯函数、同一批测试）；3 单独开一个小工包，
不与 MCP 混在一起。

### 5.3 【要拍板】阶段 1 的读写分级什么时候做

2.3 那条硬事实意味着：**阶段 0 交付的东西，管理员每装一台 MCP 服务器，Cuu 每调用一次就升级一次给人。**
链路是通的、审计是全的、但产品上接近不可用。两个选择：

- 阶段 0 与阶段 1 的分级**合并成一批交付**（工作量 +1 个中等工包：管理员断言字段 + 映射真值表 +
  正反两条端到端断言），一次给出可用的东西。
- 按本设计分两批，阶段 0 明确标注为「链路验证，尚不适合日常使用」，在设置页上如实写出来。

判断：倾向合并。分级的实现本身很小（一个 `trust_level` 列 + 一个 AND 判断），风险全在
「会不会被服务器自述骗过去」，而「管理员断言 AND 服务器自述」这条规则已经把这个风险关死了。

### 5.4 其它风险（不需拍板，施工时留意）

- **SDK 演进**：`@modelcontextprotocol/sdk` 当前 1.30.0（联网确认），仍在快速迭代。
  缓解与插件同款：把 SDK 关在 `packages/mcp-client` + `services/mcp-client.ts` 两处，
  `packages/tools` 的契约不变，破坏性改版只砸在这两个文件上；版本号钉死（不用 `^`）。
- **工具 schema 质量**：MCP 服务器可能给出模糊描述、残缺 schema。我们原样透传——
  这是服务器作者的责任。但 32KB 上限与远程 `$ref` 拒绝这两条是我们的责任，别省。
- **子进程卡死**：行为不端的服务器可能忽略信号。收尾照 `plugin-host-client.ts:395-416`：
  先关 stdin 等自退，2 秒后 `SIGTERM`。
- **名字预算**：`mcp__` + 32 + `__` = 39，只剩 25 给服务器自己的工具名。真实服务器的工具名
  （`create_pull_request` = 19、`search_repositories` = 19）大多刚好塞得下，但服务器名一长就会
  批量挂 hash 后缀，工具名变得没法读。UI 的实时预览（4.5）是这条风险的主要缓解。
- **多工作区**：MCP 子进程按 `(工作区, 服务器)` 计，上限 8。单工作区部署（常态）无感；
  多工作区部署要在 README 写清这个数。
