# MCP 客户端接入：连接与监督（工包 M2）

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code

## Problem

M1 交付了纯翻译（服务器自报的工具定义 → `ToolSpec`），但没有任何东西真的去**起**一台 MCP
（Model Context Protocol，模型上下文协议）服务器。M2 补上中间那一层：起子进程、握手、列工具、
调工具，以及围着这条链路的全部监督——超时、重连预算、空闲回收、崩溃隔离、每次调用落审计、
把真实连接结果写回 `mcp_servers`。

两个约束在开工时就把方案定死了：

1. **全程离线，不装任何新的第三方包**，`@modelcontextprotocol/sdk` 也不装。设计稿 4.2 写的是
   「用官方 SDK」，这一批做不到。
2. **第三方进程是不可信输入。** 它的 stdout 可以是任意字节流，它可以不回话、可以回一个我们没
   见过的协议版本、可以反过来请求我们花模型预算、可以在一次调用中途死掉。每一条都得有确定的
   处置，而不是「让它抛出去」。

## Decision

### 1. 手写最小 MCP stdio 客户端，关在 `@workhub/mcp-client/stdio` 子路径里

MCP 的 stdio 面就是换行分隔的 JSON-RPC 2.0。仓库里已经有一套同形状的东西
（`packages/plugin-host/src/protocol.ts` 的增量行解析器 + `plugin-host-client.ts` 的子进程监督），
本工包照那套长，只实现我们真正用到的协议面：`initialize` / `notifications/initialized` /
`tools/list` / `tools/call`，加两条通知（`notifications/tools/list_changed` 收、
`notifications/cancelled` 发）。

分层照 `plugin-host/src/index.ts` 刻意不 re-export `./host.js` 的先例：
**主入口 `index.ts` 保持零 IO**，带 IO 的部分走 `./stdio` 子路径导出
（`packages/mcp-client/package.json` 的 `exports` 加一项）。换回官方 SDK 时替换点就是那三个文件。

新增三个文件：

- **`src/stdio/jsonrpc.ts`**：行编解码。两处比插件宿主那份收紧：
  - **单行 1MB 上限**，命中即协议错误并让解码器进终止态（不是「丢一行继续」——半行 JSON 之后
    的字节流没有可信的帧边界）。成型的行按 `Buffer.byteLength` 精确判；**未成帧的残留缓冲**用
    UTF-16 码元长度做保守预判（UTF-8 字节数恒 ≥ 码元数，所以判定正确；每来一个 chunk 就对整个
    缓冲算一次字节长度是 O(n²)，正好会在「服务器狂吐一大坨」这个要防的场景里最先炸）。
  - 合法 JSON 但 `jsonrpc !== "2.0"` 的行同样算噪声，丢弃并**计数**（计数是为了让「服务器一直
    往 stdout 打日志」这件事在诊断里看得见）。
- **`src/stdio/session.ts`**：一台服务器的一次会话。协议面见下方参数表。
- **`src/stdio/spawn.ts`**：默认启动口。三条不能改的默认值：不过 shell（`shell: true` 会把
  `args` 变成命令注入面）、env 全量替换而不是叠加（这是 `buildMcpChildEnv` 白名单能生效的前提）、
  不 detached（API 进程被 kill 时子进程不会活下来）。

### 2. 协议面的逐条处置

| 情形 | 处置 | 理由 |
|---|---|---|
| `initialize` 回一个已知的更老版本 | 接受 | 我们用到的四条方法在这几版之间形状不变 |
| 回一个不在清单里的版本 | 断开，`protocol_version_unsupported` | 「不认识但先连上试试」= 对没读过的协议做兼容性猜测，猜错的表现是调用悄悄送错形状 |
| 10 秒内不回 `initialize` | 断开，`handshake_timeout`，**收干净子进程** | 握手没成时进程往往已经起来了；不收就是每次失败留一个孤儿 |
| 服务器没声明 `capabilities.tools` | 不发 `tools/list`，如实回报零工具 | 发一条注定被 -32601 拒的请求，只会把 `mcp_no_tools` 变成一条难解释的英文诊断 |
| `tools/list` 翻页 | 跟 cursor 到底，上限 20 页 | — |
| 同一个 cursor 回第二次 | 协议错误，整代拒绝 | 这是翻页死循环最常见的形状；只靠页数上限要等 20 页，而每一页都在吃内存 |
| 翻满 20 页仍不到底 | 协议错误，整代拒绝 | 半套清单 = 模型看到一个我们说不清边界的子集，比「这台连不上」难查得多 |
| 服务器反过来请求（sampling / roots / elicitation） | 一律回 JSON-RPC `-32601` | sampling 花的是我们的 key 与预算，而成本/预算/评审门全挂在一次执行上，服务器发起的补全没有可归属的执行、记不了账（设计稿 4.8）。回码而不是沉默，是因为沉默会让对面一直等到它自己的超时 |
| `notifications/tools/list_changed` | 只标脏，下一次取清单时刷新 | 阶段 0 不在一次执行**中途**换掉模型已经看过的工具清单（设计稿 4.1 第 3 条） |
| 认不出的通知（进度、日志） | 安静忽略 | — |
| 单次调用超时 | 拒绝 + 发 `notifications/cancelled` | 不通知对面的话，服务器会一直算着这次调用还在跑 |
| 超时之后迟到的回复 | 丢弃并记一条日志 | 唯一的「服务器很慢」线索；不能串到下一次调用上 |

### 3. 监督层 `apps/api/src/services/mcp-client.ts`

形状照 `plugin-host-client.ts`，**三处刻意不同**：

1. **熔断粒度是「一台服务器」，不是「整个 MCP 面」。** 插件那侧崩溃超限会把整个插件面关掉
   （一个坏插件带走全部插件）。这里的预算挂在每一台服务器上：一台 GitHub 服务器起不来，
   不该让文件系统服务器的工具跟着消失。
2. **一台连不上不让整次装配失败。** `toolSpecs()` 逐台 try/catch。
3. **连接是有状态的，所以有空闲回收。** 长连接不像插件宿主那样每次都能重建，但也不该在一个
   没人用的工作区里养一辈子子进程。

**监督参数表**（全部可注入覆盖，测试用假时钟驱动）：

| 参数 | 值 | 与插件宿主的对照 |
|---|---|---|
| 握手超时 | 10s | 插件 20s（那边要现场 `import` 第三方 JS，这边只是一次 RPC 往返） |
| 单次调用超时 | 取服务器行的 `tool_call_timeout_ms`，再夹进 1000..300000 | 插件取 `min(工具声明, 30s)` |
| 重连窗口 / 上限 | 10 分钟 / 3 次（第 4 次熔断） | 插件 5 分钟 / 3 次 |
| 活子进程上限 | 8（跨工作区合计，超了关最久未用） | 插件 4（按工作区，不是按服务器） |
| 空闲回收 | 10 分钟没被用到就关子进程 | 插件没有 |
| 空闲扫描间隔 | 60s，定时器 `unref` | 插件没有 |
| 单行上限 | 1MB | 插件无上限（对面是自己人） |
| stderr 保留 | 尾部 8KB | 插件不保留，直接进日志 |
| 结果上限 | 32KB（`renderMcpContent`）；错误文本同上限同中和 | 插件 32KB（M1b 补的） |
| 审计摘要上限 | 400 字符 | 同 |
| `last_error` 落库上限 | 1000 字符 | 插件不落库 |

**连接失败与非预期退出计进同一份预算。** 只数「退出」的话，一台命令根本不存在的服务器会在每一次
工具装配上重试一遍 spawn、永远不熔断——而那正是最常见的配错形状。

**空闲回收不是失败**：只关子进程，DB 里的状态不动，内存里的工具清单留着（`status()` 仍如实报
`connected` + 工具数 + `live: false`），下次用到重新握手。

**审计** `mcp.tool.called`，形状对齐 `plugin.tool.called`：`actorKind` 有执行上下文时记 `ai`、
没有时记 `system`；`entityType: "mcp_tool_invocation"`，`entityId: "<服务器名>:<原始工具名>"`；
detail 带 `server_name` / `tool_name`（原始名）/ `tool_id`（公开名）/ `ok` / `duration_ms` /
`args_summary` / `result_summary` / `capability`（= M1 的 `minScope`）/ `agent_run_id` /
`work_item_id`。写失败 fail-open 但留结构化日志——「没有审计」和「没有调用」必须分得清。

**状态回写**：连接成功/失败/清单刷新都调 `updateConnectionResult`，回填 `status` / `tool_count` /
`tools_json` / `last_error`。这条与 M0 的治理约定对上：`setEnabled(true)` 把 `status` 落回
`connect_failed`（仓储层不冒充一个还没发生的验证结果），**真实结果由这里写回**，所以 M3 的治理
动作在 `setEnabled` 之后必须紧跟一次 `reload()`。

**DB 来源显式接线**：`useMcpServerSource()`（M4 在 `server.ts` 调），照
`usePluginRegistryPathSource()` 的先例。不接线就一台都不连、一次 PG 查询都不会发生——全部既有
单测行为逐字节不变。

### 4. 顺带接上 M1b 留的合并点

`packages/mcp-client/src/content.ts` 里 `sanitizeModelFacingText` / `neutralizeMcpFenceTags` /
围栏标签表原先是三份复制来的副本，现在全部改成转调 `@workhub/tools`
（`sanitizeModelFacingText` 显式传 `truncation: "tail"` 以保持行为逐字不变；`MCP_FENCE_TAG_NAMES`
改成 re-export `DEFAULT_FENCE_TAG_NAMES`）。`content.test.ts` 的 17 条断言**一行没改**。
那条「对着 `packages/agent/src/loop/loop.ts` 源码核对围栏标签表」的漂移守卫因此从「盯本包的副本」
变成「盯共享包的副本」——守的还是同一件事，而需要人工同步的表从三份降到两份。

## Alternatives considered

- **装 `@modelcontextprotocol/sdk`（设计稿的原方案）。** 这一批的硬约束是离线施工，做不到。
  代价如实写在 `session.ts` 的模块注释里：**协议面现在是我们自己维护的**，MCP 规范加了新东西不会
  自动跟上。缓解办法是把协议面关在一个文件里（换 SDK 时替换点唯一）并逐条测。
- **协议版本「不认识也先连上试试」。** 否决：这等于对一份没读过的协议做兼容性猜测，而猜错的
  表现不是一个响亮的错误，是调用悄悄送错形状。改成白名单（当前三版），**加一版要过 Agent Note**
  ——加进来等于宣称我们读过那一版的差异并确认这四条方法没变，与 `env.ts` 的白名单同一条纪律。
- **`tools/list` 翻满页数上限就把已翻到的部分留下。** 否决：见上表——半套清单让模型看到一个我们
  说不清边界的子集，而下一次可能又是另一个子集。与 M1 「整份清单级别的问题整代拒绝」同一口径。
- **服务器反向请求沉默丢弃。** 否决：对面会一直等到它自己的超时。回 `-32601` 是协议规定的
  「我不实现这个方法」，语义准确且立刻。
- **熔断粒度沿用插件宿主的「整个面」。** 否决：插件那侧那么写有它的历史（报告 6.4），但 MCP 的
  服务器之间彼此无关，一台连不上就关掉全部 MCP 工具是一次不必要的连坐。**这也顺带说明插件那侧
  的同源缺口仍在**（M1b 的 Note 已记：三个同源缺口里的第 3 条建议单独开工包，本轮不做）。
- **只把「非预期退出」计进重连预算，连接失败不计。** 否决：命令不存在 / 不是 MCP 服务器 /
  凭据没配好，这三种最常见的配错都停在「连接失败」这一档，不计的话永远不熔断。
- **空闲回收把 DB 状态写成 `connect_failed`。** 否决：那是在冒充一次没发生的失败。回收只关进程，
  状态与工具清单保持诚实，`live: false` 单独一个字段说清「进程不在但上次是连上的」。
- **只在调用时惰性连接，`toolSpecs()` 不连。** 否决：装配阶段必须知道有哪些工具，不连就没有清单。
  「懒」体现在**没人要工具就一个进程都不起**，这一点由 `toolSpecs()` 是唯一入口保证。
- **空闲回收只在别的调用顺手扫一遍，不开定时器。** 否决：单工作区部署里，工作区一闲下来就再也
  没有「别的调用」，子进程会一直活着。改成 `unref` 的 60s 定时器（绝不拖住进程退出）+ 暴露
  `reapIdle()` 让测试确定性驱动。

## Consequences

- **协议面是自维护的技术债**，替换点唯一（`packages/mcp-client/src/stdio/session.ts`）。
  换成官方 SDK 时，`apps/api` 侧的监督逻辑与全部 29 条监督测试都不用动——两层的边界就是为此划的。
- **协议版本清单是 `MCP_SUPPORTED_PROTOCOL_VERSIONS`（`2025-06-18` / `2025-03-26` / `2024-11-05`）。**
  一台跑更新协议版本的服务器现在会被拒绝连接并报 `protocol_version_unsupported`；这是有意的
  fail-closed。放宽要改那一个常量并过一条 Note。
- **给 M3 的入口**：`createMcpClient()` 的 `status(workspaceId)` 是只读快照（`id` / `serverName` /
  `status` / `toolCount` / `live` / `lastError` / `blockedReason` / `toolIds`），
  `reload(workspaceId)` 是治理动作之后的重连口，两者都不抛。**快照的 `status` 永远不会是
  `disabled`**——来源只给启用的行，停用是 DB 的事实，M3 要从行里读而不是问这个内存快照。
  会话失败原因码（`spawn_failed` / `handshake_timeout` / `protocol_version_unsupported` /
  `protocol_error` / `server_error` / `call_timeout` / `not_running` / `exited`）在
  `McpSessionError.reason` 上，M3 的错误码映射可以直接对着它写。
- **给 M4 的入口**：`useMcpServerSource(repository?)`（在 `server.ts` 启动早期调一次）、
  `getDefaultMcpClient()`（`agent-runner` 的 `extraSpecs` 合流处调
  `toolSpecs({ workspaceId, runId, actorId, workItemId })`）、`closeDefaultMcpClient()`
  （优雅关闭）。合流时的重名丢弃：本文件内部已经对**同一次装配内**的公开名坍缩做了丢弃并记日志，
  M4 还需要处理「MCP 工具 vs 内置/插件工具」的跨来源重名。
- **给 M5 的入口**：夹具服务器只要说换行分隔的 JSON-RPC 2.0 就能被连上，**不需要官方 SDK**。
  必须实现 `initialize`（回一个清单内的 `protocolVersion` 且 `capabilities.tools` 在场）、
  `notifications/initialized`（收下即可）、`tools/list`、`tools/call`。设计稿 4.6 第 2 条写的
  「用真 SDK 起服务端」这一批做不到，M5 需要在报告里如实说明这一点。
- **`packages/mcp-client` 的 test 脚本 glob 从 `src/*.test.ts` 改成 `src/**/*.test.ts`**，
  否则 `src/stdio/` 下的测试是死测试（跑不到但看着像跑了）。
- **`apps/api` 新增 workspace 依赖 `@workhub/mcp-client`**（`pnpm-lock.yaml` 同批提交，只多三行
  link 记录）。
- **模型可见文本零变化**：`pnpm gen:expected` 之后 `git status` 干净。MCP 工具的 golden 归 M6。
- **两处 `ui-i18n-allow` 行内豁免**（`services/mcp-client.ts` 的两句工具错误文案）：它们是**给模型
  看的工具结果**，两端 UI 从不渲染，与 `content.ts` 的截断标记同一类。基线文件未改动。
- **已知未做**：`notifications/progress`（长任务进度）收到即忽略；`resources` / `prompts` 不接
  （设计稿 4.1 第 2 条）；B8 沙箱不包（设计稿 4.4 第 4 条点名的阶段 1 工包）。**阶段 0 的
  MCP 服务器就是一个由管理员显式启动的第三方进程，以 API 进程的用户身份运行**——这句话要原样
  出现在 M9 的 README 兼容面里，不要含糊。
