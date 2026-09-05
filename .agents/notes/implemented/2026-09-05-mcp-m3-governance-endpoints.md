# MCP 客户端接入：治理服务与端点（工包 M3）

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code

## Problem

M0 建了 `mcp_servers` 表与契约，M1 交付了纯翻译，M2 交付了连接监督。三者之间缺一层：**没有任何
入口能往这张表里写一行**。要让一台 MCP（Model Context Protocol，模型上下文协议）服务器真的进入
一次执行，得有人回答这些问题：

1. 谁能添加？添加一台服务器 = 在跑着 API 的那台机器上多起一个长期存在的子进程，它以当前用户身份
   跑、能读写该用户能碰的文件、能出网。这不是「配置一个集成」。
2. 添加之前拦什么？生态里几乎每篇官方文档都写 `npx -y @modelcontextprotocol/server-github`，
   而仓库里两条既有红线（插件的 `plugin_install_scripts_refused`、`packages/tools/src/sandbox.ts`
   对 `npm exec / pnpm dlx / bun x` 的禁令）封的正是「每次启动从网上下载并执行代码」这条路。
3. 凭据放哪？表里绝不能有明文密钥，但没有凭据的 GitHub 服务器起来也只会在第一次调用时报一个远端
   的 401，更难查。
4. 一个动作之后，「行上写的」和「进程里跑的」怎么保持一致？M0 的仓储层刻意让 `setEnabled(true)`
   把 `status` 落回 `connect_failed`（不冒充一个还没发生的验证结果），真实结果只会由 M2 的
   `updateConnectionResult` 写回。

## Decision

### 1. 服务与端点逐条照 `services/plugins.ts` / `routes/plugins.ts` 长，多三件事

| 端点 | 鉴权 | 成功 | 失败码 |
|---|---|---|---|
| `GET /api/mcp-servers` | 管理员 | 200 | 401 / 403 `mcp_admin_required` |
| `POST /api/mcp-servers` | 管理员 | 201 | 400 / 403 / 409 `mcp_server_name_taken` / 413 / 422（体检八码，见下） |
| `POST /api/mcp-servers/:id/enable` | 管理员 | 200 | 401 / 403 / 404 `mcp_server_not_found` |
| `POST /api/mcp-servers/:id/disable` | 管理员 | 200 | 401 / 403 / 404 |
| `POST /api/mcp-servers/:id/reload` | 管理员 | 200 | 401 / 403 / 404 |
| `PATCH /api/mcp-servers/:id` | 管理员 | 200 | 400 / 403 / 404 / 413 / 422 |
| `DELETE /api/mcp-servers/:id` | 管理员 | 204 | 401 / 403 / 404 |

与插件治理的三处刻意不同：

- **多一个「测试连接」**（`reload`）。插件的加载是一次性的；MCP 是有状态长连接，「现在还连得上吗」
  是用户随时会问、也随时会变的问题，必须有独立入口与独立的审计动作。
- **多一个「改配置」**（`PATCH`：`trust_level` / `tool_call_timeout_ms` / `env` / `secret_refs`）。
  把一台服务器从 `external_effect` 降到 `read_only` 是管理员对它的断言，不该逼人删了重加。
  **刻意不含 `server_name` 与 `command`**：改名会让模型可见工具名整体换一批（历史审计里的调用还挂
  在旧名下），改命令等于把这条记录指向另一个可执行文件——两者都走「移除再添加」，好让体检与审计
  重跑一遍完整流程。
- **每个写动作之后都「reload 一次、再把行读一遍」**。漏掉重读那一步，回执会把 M0 那个诚实的
  「还没验证过」当成结论发出去，行也会一直停在 `connect_failed`。这一条在
  `routes/mcp-servers.test.ts` 里是可证伪的：假连接监督照 M2 的真实行为写（`reload()` 经
  `updateConnectionResult` 写回行），删掉重读就会红。

### 2. 「测试连接失败」不是 HTTP 错误

`POST /:id/reload` 连不上时仍然回 200，结论在 `server.status` / `server.last_error` /
`connection` 里。用户问的就是「现在连得上吗」，把答案编码成 5xx 会让客户端把一次成功的问询当成
自己坏了。同插件那侧「装不上是一条记录而不是一次失败的请求」的先例。

整次 `reload()` 抛错（罕见：M2 逐台 try/catch，单台失败进快照）同样不让一次已经落库的治理动作失败
——记结构化日志，把人话原因放进 `connection.last_error`。

### 3. 错误码映射表（两端界面按码出话，绝不解析英文诊断）

体检拒绝：码由 M1 的 `mcpPrecheckErrorCode` 出，本层只补「配多少状态、说哪句话」。

| 体检项 | 码 | 状态 |
|---|---|---|
| `server_name`（形状不合） | `mcp_server_name_invalid` | 422 |
| `server_name`（已被占用） | `mcp_server_name_taken` | **409** |
| `command_resolvable` | `mcp_command_not_found` | 422 |
| `remote_exec_launcher` | `mcp_remote_exec_refused` | 422 |
| `args_shape` | `mcp_args_invalid` | 422 |
| `env_credential_shaped` | `mcp_env_credential_shaped` | 422 |
| `env_overrides_base` | `mcp_env_overrides_base` | 422 |
| `secret_ref_scope` | `mcp_secret_ref_out_of_scope` | 422 |
| 说拒但没给码（枚举漂移） | `mcp_precheck_refused` | 422 |

只有「名字被占用」是 409：那是一次和现有清单的冲突，改个名就能过（同 `plugin_already_installed`）。

会话失败（M2 的 `McpSessionError.reason`）→ `describeMcpSessionFailure()`：
`spawn_failed`→`mcp_spawn_failed`、`handshake_timeout`→`mcp_handshake_timeout`、
`protocol_version_unsupported`→`mcp_protocol_version_unsupported`、
`protocol_error`→`mcp_protocol_error`、`server_error`→`mcp_server_error`、
`call_timeout`→`mcp_call_timeout`、`not_running`→`mcp_not_running`、`exited`→`mcp_exited`，
拿不到原因回落 `mcp_connect_failed`。**导出**是为了 M7 的设置页与未来放开 HTTP 之后的调用点共用
同一份映射，而不是各自再猜一遍英文诊断的意思。

### 4. 文案进 `services/mcp-servers-copy.ts`，不再往 ui-i18n 存量基线里添账

`services/plugins.ts` 把中文直接写在服务里，代价是整个文件被记进了棘轮基线，两端想换语言只能各自
再写一份。这一批用 per-package 词典的既有形状（中文对象是 key 集事实源，英文对象
`satisfies Record<keyof typeof zh, string>` 做编译期对齐）。`{command}` / `{keys}` 是占位符，
值在调用点填，词典条目保持纯字符串以维持那条 `satisfies`。

**文案里要点名的东西在服务里重算一遍，不从体检报告的英文 `detail` 反解**——detail 是给人看的诊断，
不是给代码解析的结构；照着它切字符串，改一次措辞就会把界面上的中文变成半截英文。凭据形状的键名
用 `isDeniedPluginHostEnvKey` 重算，基座键用 `MCP_CHILD_ENV_ALLOWLIST` 重算。

### 5. 审计：六个动作、只记键名不记值

`mcp_server.added / enabled / disabled / updated / reloaded / removed`，`entityType: "mcp_server"`，
`detailJson` 带 `server_name` / `command` / `status` / `trust_level` / `tool_count` /
**`env_keys` 与 `secret_ref_keys`（只有键名）**。值里可能有配置也可能有别人以为不敏感的东西，
审计表不是它们该出现的地方——与 `env_json` 结构性存不进密文是同一条理由。写审计失败 fail-open
（同 plugins / agent-runner），但必须留结构化日志。

### 6. 服务器名的高风险词在添加时就说明白

`serverNameRiskTokens()` 把名字切成词，**逐词问一次 `classifyHumanReservedToolCall`**（人工保留门
的真实实现），再用 M1 的 `mcpServerNameRiskTokens` 收敛回「名字里确实出现过的词」。词表本身不复制
到这一层，从根上没有「两份词表漂移」这回事。结果放进每个动作回执的 `risk_tokens`：一台叫 `finance`
或 `publish` 的服务器，它的**每一个**工具都会被判成高风险、每次调用都停下来转人。这是设计属性而
非故障，但必须在添加表单上先说，否则用户只会以为坏了。

### 7. 仓储补一条 `updateSettings`（M0 没有的原语）

`PATCH` 需要写 `trust_level` / `tool_call_timeout_ms` / `env_json` / `secret_refs_json`，M0 的八条
原语里没有能写它们的。备选是在 apps/api 侧直接用 drizzle 写这张表（仓库里有先例但极少），那会把
「谁拥有这张表」这件事撕成两半。选了在 `packages/db/src/repositories/mcp-servers.ts` 加一条 additive
原语：**只写调用方真的传了的列**（`undefined` = 不动这一列）。`env` / `secret_refs` 是整份替换语义，
分不清「没传」与「传了空对象」，会把一次只改超时的 PATCH 变成一次清空环境变量的事故。

## Alternatives considered

- **改 `env` / `secret_refs` 不重跑体检**（只有添加时查）。否决：那样「凭据形状的键一律拒」这条红线
  会被一次 PATCH 从后门整个绕过去。现在 `PATCH` 带 `env` 或 `secret_refs` 时重跑一遍体检；名字与命令
  不可改，故与它们相关的检查结论原样沿用。
- **在契约层用 `^[A-Za-z0-9_-]{1,32}$` 挡掉不合形状的名字**。否决：客户端只会收到一个通用的
  `validation_error`，界面说不出「名字会进工具名，所以只收这些字符」。形状判定留给体检那一条
  `server_name` 检查，它给 `mcp_server_name_invalid` 与 `mcp_server_name_taken` 两个**不同**的码。
- **`DELETE` 回 `{removed:true}`**（同插件）。否决：删除没有第二种成功形态，回一个躯壳只是让客户端
  多解析一次。这一条与 `/api/plugins/{id}` 的 200 不一致是**有意的**，新端点按更干净的口径来。
- **一次治理动作只重连那一台服务器**。M2 的 `reload(workspaceId)` 粒度就是整个工作区，没有单台入口
  （`services/mcp-client.ts` 是 M2 已定型的文件，本工包只调用不改）。整工作区重连的代价是几次握手，
  换来的是不必在两个文件里各留一套连接生命周期。
- **把连接的 `live` 折进行上的 `status`**。否决：空闲回收把子进程收掉之后 `live=false` 而 `status`
  仍是 `connected`，这不是矛盾（下次用到会重新握手）。挤进一个字段，设置页就只能在「刚回收过」和
  「连不上」之间二选一地说错话。

## Consequences

- **M7（桌面设置页）要消费的字段**：
  - 清单 `McpServerListVM`：`servers`（完整 VM，含 `command`/`args`/`env`/`secret_refs`/`cwd`——
    管理员面才有）、`connections`（按 id 索引的 `{live, tool_count, tool_ids?, blocked_reason?,
    last_error?}`）、`secret_ref_env_prefix`、`available_secret_refs`（**只有名字，没有值**，
    添加表单据此避免填一个还没配的引用）。
  - 五个写动作回执 `McpServerActionResult`：`server` / `connection?` / `risk_tokens`。
    停用的服务器 `connection` 整体缺席（不是 `live:false` 那种「连过但没活着」）。
  - 状态行的三种说法直接对应：`已启用 · N 个工具`（`status==="connected"`）/ `已停用`
    （`status==="disabled"`）/ `连不上：<原因>`（`status==="connect_failed"`，原因取
    `server.last_error`，重连预算耗尽时取 `connection.blocked_reason`）。
  - 工具名前缀实时预览用 `@workhub/mcp-client` 的 `mcpToolNameBudget(serverName)`（纯函数，零 IO），
    不走接口——这件事在用户还没提交表单时就要显示。
- **M8（网页只读）不消费本工包的端点**：网页走 `mcpServerSummaryVmSchema` 的裁剪口径（结构性不含
  `command`/`args`/`env`/`secret_refs`/`cwd`），入口指向桌面客户端。
- **M4 是这批端点真正生效的前提**：`getDefaultMcpServerService()` 用的是 `getDefaultMcpClient()`，
  而那个单例在 `server.ts` 调 `useMcpServerSource()` 之前**一台服务器都不连**。所以在 M4 接线之前，
  治理端点本身全部可用（增删改查、审计、体检都真的发生），但每次 `reload` 都会得到空快照、行会停在
  `connect_failed`。服务里对客户端是**懒取**（每次调用现取单例）而不是构造期抓一份引用，正是因为
  `useMcpServerSource()` 会重建那个单例。
- **`/api/mcp-servers` 五条路径已进 OpenAPI**，`app.test.ts` 的「运行时路由与 OpenAPI 文档保持一致」
  双向对账因此仍然绿；后续增删端点必须同步改 `openapi.ts`。
- **`mcp_server_*` 错误码空间与 `plugin_*` 完全不相交**，审计动作名同理，两套治理面在日志与错误码里
  永远分得开。
