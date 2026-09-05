# MCP 客户端接入：夹具服务器与端到端冒烟门（工包 M5）

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code

## Problem

M1 有纯翻译、M2 有连接监督、M4 把 MCP（Model Context Protocol，模型上下文协议）工具接进了一次
agent run 的装配、M6 用常量夹具钉住了模型可见形态。但到 M4 为止，**没有任何一条证据说明这几段
在一个真的进程边界上串得起来**：M2 的 30 条监督测试喂的是一个假子进程对象，M4 的 7 条装配测试
喂的是一个假 provider，M6 的 golden 喂的是一份常量字面量。三者都绕开了真 spawn、真 stdout 分片、
真握手时序、真翻页、真退出码。这一层一旦对不上，全部单测照常绿，而产线一台服务器都连不上。

M5 要补的就是这条证据链：

1. 一台**真的**跑起来的 stdio MCP 夹具服务器；
2. 一道端到端冒烟门 `qa:mcp-smoke`：`mcp_servers` 里一行配置 → 真子进程 → 工具进注册表 →
   Cuu 真的调到 → 结果进轨迹 → 落审计；再把管理员断言收回最高档，证明同一个调用会停下来转人；
3. 把它接进 CI 的 workspace job（不需要 PG、不需要模型 key，所以能当常规门跑）。

## Decision

### 1. 夹具服务器：纯 Node 标准库，不用官方 SDK（与设计稿的偏离）

`packages/mcp-client/qa/fixtures/mcp-echo-server/`：

- `server.mjs`——纯 Node，说换行分隔的 JSON-RPC 2.0（stdin/stdout，UTF-8）；
- `tools.json`——工具清单的唯一事实源，与 M1 常量夹具
  （`qa/fixtures/echo-server-tools.ts` 的 `mcpEchoServerToolsListResult`）逐字节相同。

**设计稿 4.6 第 2 条要的是「用真 SDK 起服务端」，这一批做不到**：全程离线施工，
`@modelcontextprotocol/sdk` 装不上（M2 已经因为同一条约束手写了客户端侧的线协议）。
代价必须写在明处：**夹具的线协议与被测客户端的线协议是同一批人写的**，所以这台夹具
**证不了「我们对 MCP 规范的理解是对的」**；它证的是「我们这一侧的两半在一个真进程边界上对得上」。
规范符合性要等换回官方 SDK、或接一台真实第三方服务器时才谈得上——这句话原样进 M9 的兼容面说明，
不要含糊成「已用真服务器验证」。

协议面（客户端用到的全部四条 + 两条通知，逐条实现）：

| 方法 | 夹具的行为 |
|---|---|
| `initialize` | 回**客户端报的那一版**（若在支持清单内），否则回清单里最新的一版；`capabilities.tools.listChanged` 与 `serverInfo` 都在场 |
| `notifications/initialized` | 收下，不回话（它是通知，回话就是协议错误） |
| `tools/list` | **分两页**：第一页 `echo` + `nextCursor`，第二页 `write_note`。不分页的话客户端的翻页/游标去重/页数上限那几条路一次都没走过 |
| `tools/call` `echo` | 把入参 `text` **一字不改**回成一个 text 块（冒烟据此断言围栏中和） |
| `tools/call` `write_note` | 一个 text 块 + 一个**非 text**（`resource`）块（据此断言「非 text 块留占位、不静默丢」） |
| `tools/call` 未知名字 | `isError: true` 的**带内**错误（不是传输层错误） |
| 其它方法 | JSON-RPC `-32601` |
| stdin 关闭 | 退出码 0（走通客户端优雅关闭的第一档，不必每次等到 SIGTERM） |
| 启动日志 | 一行到 **stderr**。stdout 是协议面，夹具自己绝不往上面写 banner |

**故意犯错的三档**（`MCP_ECHO_FIXTURE_MODE`，供 M2 的失败处置在真进程上回归）：
`hang_handshake`（收到 `initialize` 不回话，进程活着）、`bad_version`（回一个清单外的协议版本）、
`crash_after_list`（握手与 `tools/list` 正常，收到 `tools/call` 不回话直接 `exit(9)`）。
模式串**认不出时当场退出**并在 stderr 说明——安静降级会让一条本该失败的回归测试永远通过。

`tools.json` 而不是 `server.mjs` 里的一段字面量：夹具是 `.mjs`（被 `process.execPath` 直接跑），
TS 测试没法干净地 import 它的导出；改成 JSON 之后，
`packages/mcp-client/src/stdio/session.fixture.test.ts` 一行 `readFileSync` + `deepEqual` 就能对着
M1 的常量夹具守漂移——**两份东西一漂移，M6 的 golden 钉住的就不再是这台真服务器实际会说的话**。

### 2. 真子进程回归：`session.fixture.test.ts`（8 条）

与 `session.test.ts` 是对照组而不是替代：那一份用假子进程制造极端时序（超长帧、迟到回复、赖着不退），
这一份用真进程走同一批路径。8 条：`tools.json` 与常量夹具逐字节一致（漂移守卫）；握手报版本 +
`capabilities.tools` + 启动日志只在 stderr + stdout 零噪声行；`tools/list` 翻两页拼回来正好是常量
夹具那份清单；`echo` 一字不改回显且 `renderMcpContent` 把 `</outputs>` 中和成 `‹/outputs›`；
非 text 块留占位 + 未知工具走带内错误；`handshake_timeout` 且子进程被收干净；
`protocol_version_unsupported`；调用中途服务器死掉时在飞调用拿到 `exited`（调用超时给到 30 秒，
如果这条是靠超时成立的，测试会先超时失败）。

### 3. 冒烟门 `apps/api/src/qa/mcp-smoke.ts`（六步）

内存 `mcp_servers` 仓储插一行（`command` = `process.execPath`，`args` = 夹具路径，
`trust_level` 先 `read_only`，`status` 先 `connect_failed`——M0 有意的诚实状态）：

1. **产线接线自检**：`useMcpServerSource(仓储)` + `getDefaultMcpClient()`（M4 在 `server.ts` 接的
   就是这两个）真的把夹具连起来、翻出两个工具、`status()` 报 `connected`/`live`，并按 `connected`
   回写仓储（`tool_count: 2`、`tools: ["echo","write_note"]`、`last_error: null`）。做完
   `closeDefaultMcpClient()` 收掉这个单例。
2. **翻译逐字对齐**：真服务器翻出来的 ToolSpec 与 M1 常量夹具经同一个 `describeMcpTools` 算出来的
   描述符逐字相同（id/description/jsonSchema/sideEffect/minScope）——两条证据链对得上。
3. **分级真值**：`echo` → `none` / `mcp:echo:read`，`write_note` → `external_effect` /
   `mcp:echo:external_effect`；模型可见 schema 走 JSON Schema 旁路（看得到 `text` 参数）。
4. **只读档不转人**：真 `createHumanReservedGuard`（只换仓储），run 成功；工具调用与结果都在轨迹里；
   结果里的 `</outputs>` 已中和成 `‹/outputs›`；升级事件 0；`pm` 模式 0；**没有为它开还原点**
   （`sideEffect: none` 的既有语义），调用记录也不带 `snapshot_id`。
5. **审计**：恰好一条 `mcp.tool.called`，`entityType: mcp_tool_invocation`、`entityId: echo:echo`、
   `actorKind: ai`，detail 的 `capability` 与**当时生效的那一档**同源（`mcp:echo:read`，
   断言的是 `echoSpec.minScope` 而不是一个写死的字符串），并带 `agent_run_id` / `work_item_id`。
6. **最高档仍然转人**：把行改成 `external_effect` + `reload()` → 同一个 `echo` 变成
   `external_effect` → 同一次调用开一条 `user_forbidden` 升级（handoff 的 `source: tool_call` /
   `risk_category: external` / `tool_id`）并以 409 `human_reserved_tool_call` 中断这次执行，
   收尾原因与插件冒烟同口径（「高风险工具调用已停止」）；**不再落新的调用审计**（它根本没执行）。

收尾：关客户端、`closeDefaultMcpClient()`、`pgrep -f mcp-echo-server/server.mjs` 断言零残留
（本机没有 `pgrep` 时如实打印「跳过」，不假装查过）。

**为什么是两个客户端。** 第 1 步走产线单例，它没有审计 sink 的注入点（默认落
`getDefaultAuditStores()`，也就是共享 PG 连接池）；要断言 `mcp.tool.called` 的具体字段就必须把
审计接到内存里，所以第 3-6 步用一个显式构造的 `createMcpClient`（同一份内存仓储 + 内存审计）
并从 `mcpTools` 递进队列。这与 `plugin-smoke.ts` 逐字同构：那一份也没有用
`getDefaultPluginHostClient()`，而是显式构造宿主客户端再从 `pluginTools` 递进队列，
产线那条「并入默认注册表」的路由此照走。

### 4. 顺手修的两处（`apps/api/src/services/mcp-client.ts`，M2 的文件）

两处都是**已经写在注释里的 fail-open 承诺没兑现**，且都是这道门第一次真的走到才暴露的：

- `writeConnectionResult` / `writeAudit` 里，默认仓储的解析（`getDefaultMcpServerRepository()` /
  `getDefaultAuditStores()`）在 `try` **外面**。这两个函数会现建共享 PG 客户端，自己也可能抛；
  抛出去之后，前者顺着 `connect()` 的 try 上去把一次**本来握好手、列好工具**的连接判成
  `connect_failed`，后者顺着 `callTool()` 的 try 上去把一次**已经成功执行完**的工具调用变成错误
  结果——与紧挨着的两段注释承诺的正好相反。修法是把解析挪进 `try`。
- `useMcpServerSource(repository)` 只接了读侧：写侧无条件走 `getDefaultMcpServerRepository()`。
  任何显式传仓储的调用方因此拿到一份**分裂的清单**——从自己那份读行，却把
  `status`/`tool_count`/`tools_json`/`last_error` 写进另一个库，自己那份行的状态永远停在旧值。
  修法是仓储带 `updateConnectionResult` 时，把它也接成默认客户端的 `connectionResults`。
  **产线调用点 `server.ts` 是不带参数调的**（两侧都退回共享库），所以这条对产线零行为变化。

### 5. CI

`.github/workflows/verify.yml` 的 workspace job 在 `pnpm qa:plugin-smoke` 之后追加一步
`pnpm qa:mcp-smoke`（根 `package.json` 转发到 `@workhub/api` 的同名脚本，与插件冒烟同款）。
不需要 PG、不需要模型 key。

## Alternatives considered

- **装 `@modelcontextprotocol/sdk` 起真服务端（设计稿 4.6 第 2 条的原方案）。** 这一批离线，
  做不到。已在上面与 `server.mjs` 的模块注释里如实标注这条偏离及其后果（夹具与客户端同源，
  证不了规范符合性）。
- **让冒烟全程走产线单例（`getDefaultMcpClient()`），不显式构造客户端。** 否决：单例没有审计 sink
  的注入点，`mcp.tool.called` 会落到共享 PG 连接池上——要么断言不了（这道门最核心的一条），
  要么这道「不需要 PG」的门开始往一个可能存在的本地库里写审计行。改成第 1 步单例自检 +
  第 3-6 步注入式客户端，两边覆盖的东西说得清。`plugin-smoke.ts` 是同一条先例。
- **为了让单例路径可断言，给 `useMcpServerSource()` 加一个审计 sink 参数。** 否决：那是为测试
  便利改产线接线口的形状，与「只修真 bug」的施工范围冲突。上面第 4 条修的两处都是**注释已经
  承诺、实现没兑现**的行为差，不是为了让测试好写。
- **夹具的工具清单直接写在 `server.mjs` 里。** 否决：那样 M1 常量夹具与真服务器之间就只剩「两处
  人工手抄」这一条纽带，漂移无人守。抽成 `tools.json` 之后有一条一行的 `deepEqual` 守卫。
- **`tools/list` 一页回完。** 否决：客户端的翻页、游标去重、页数上限三条路在真进程上就一次都没
  走过。分两页的成本是夹具多四行。
- **用 `ps` 全表扫描判残留子进程，或干脆不判。** 否决前者（输出难解析、跨平台差异大），
  否决后者（「子进程漏收」正是这一层最容易出、又最难在别处发现的故障）。用
  `pgrep -f mcp-echo-server/server.mjs`，并在没有 `pgrep` 的机器上**明说跳过**而不是静默通过。
- **在冒烟里也覆盖 `write_note`（非 text 块）与未知工具（带内错误）。** 否决：那两条会多出两条
  `mcp.tool.called` 审计，把「恰好一条」这个最有信息量的断言冲淡。改放进
  `session.fixture.test.ts`——那里没有审计噪声，且本来就是协议面的地盘。

## Consequences

- **新增一道常规 CI 门 `pnpm qa:mcp-smoke`**（workspace job，`qa:plugin-smoke` 之后）。本机全量
  耗时约 1 秒（三次真 spawn）。它挂了通常意味着 M1/M2/M4 中某一层的**跨层**契约破了，而不是某一层
  内部的单测破了——先看它打印的六步里断在哪一步。
- **`packages/mcp-client/qa/fixtures/mcp-echo-server/tools.json` 与
  `qa/fixtures/echo-server-tools.ts` 的 `mcpEchoServerToolsListResult` 必须逐字节一致**，
  守卫在 `session.fixture.test.ts` 第一条。改其中一个就要同步改另一个，否则 M6 的 golden 与这道门
  说的不再是同一台服务器。
- **`MCP_ECHO_FIXTURE_MODE` 的三个值是夹具的对外契约**（`hang_handshake` / `bad_version` /
  `crash_after_list`）。加一档要同时加一条真子进程回归，否则等于加了一个没人用的分支。
- **`useMcpServerSource()` 现在接受带 `updateConnectionResult` 的仓储**（新导出类型
  `McpServerSourceRepository`）。`server.ts` 的产线调用点不带参数，行为逐字不变；M3 的治理端点
  如果要用注入仓储跑测试，读写会自动落在同一份上。
- **模型可见文本零改动**：`pnpm gen:expected` 之后 `git status` 干净（本工包新增的全部是 QA 夹具、
  测试与门禁脚本，不碰任何进模型上下文的文案）。
- **仍然没有的东西**：这道门用的是我们自己写的夹具，**不是**规范符合性验证；没有覆盖
  `resources` / `prompts`（设计稿 4.1 第 2 条不接）、`notifications/progress`（收到即忽略）、
  沙箱包裹（设计稿 4.4 第 4 条点名的阶段 1 工包）。阶段 0 的 MCP 服务器仍然是一个由管理员显式
  启动的第三方进程，以 API 进程的用户身份运行。
