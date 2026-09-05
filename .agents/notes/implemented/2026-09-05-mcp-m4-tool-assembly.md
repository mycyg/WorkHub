# MCP 客户端接入：装配接线（工包 M4）

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code

## Problem

M2 交付了 MCP（Model Context Protocol，模型上下文协议）客户端监督层
（`apps/api/src/services/mcp-client.ts`：`getDefaultMcpClient()` / `useMcpServerSource(repository?)` /
`closeDefaultMcpClient()`），但没有任何东西真的把它接进一次 agent run 的工具装配——`toolSpecs()`
翻出来的 `ToolSpec` 还没人调用，`useMcpServerSource()` 也没人在启动早期调过。M4 补上这两处接线：

1. `apps/api/src/workers/agent-runner.ts` 的默认工具注册表要把 MCP 工具并进来，和 R24-P 阶段 0
   已经接好的插件工具一样——但这次是**三个**来源合流（内置 / 插件 / MCP），不是两个。三来源
   重名时谁赢、日志怎么记，是本工包要定下来的新规则（M2 的 Note 已经点名这是「给 M4 的入口」
   里唯一还没答案的部分：M2 内部只处理了同一次装配内 MCP 工具彼此之间的公开名坍缩）。
2. `apps/api/src/server.ts` 要在启动早期调 `useMcpServerSource()`（紧挨插件那行）、优雅关闭时调
   `closeDefaultMcpClient()`（紧挨插件宿主关闭那行）。

约束：模型可见的工具集在没配置 MCP 服务器时必须逐字节不变（`pnpm gen:expected` 后 `git status`
干净），这与插件工具当初接入时的承诺完全同构。

## Decision

### 1. 三来源合流：内置 > 插件 > MCP，重名按 id 后来者丢弃

把 `agent-runner.ts` 里 `defaultToolRegistryFor()` 的第三个参数从「一份扁平的插件 extraSpecs
数组」改成「一份按优先级从高到低排列的来源列表」：

```ts
type ExtraToolSourceName = "plugin" | "mcp";
function defaultToolRegistryFor(
  role, teamSkillContent,
  extraSpecSources: { source: ExtraToolSourceName; specs: AnyToolSpec[] }[] = []
)
```

函数内部用一份 `ownerBySpecId`（先用内置工具的 id 预置为 `"built_in"`）做单遍扫描：来源列表
按「插件先、MCP 后」的顺序传入，逐个来源、逐条 spec 检查 id 是否已被更高优先级的来源占用；
占用了就丢弃并记一条统一的 `tool_id_collision` 结构化日志（字段：`tool_id` / `kept_source` /
`dropped_source`），没占用就登记为这个来源的并加入注册表。这一条日志**替换**了原来专门给
「插件顶内置」这一种情形单独起的 `plugin_tool_id_collides_with_builtin` 事件名——全仓库只有
这一处引用它（已确认无其他测试/QA 脚本/文档依赖这个具体字符串），统一成一个通用事件、用
`kept_source`/`dropped_source` 字段表达「谁赢了」，比按每一对来源组合各起一个事件名更经得起
以后再加第四个来源。

调用侧（`queuedRun` 内，原来算 `pluginToolSpecs` 那一行）改成：

```ts
let pluginToolSpecs: AnyToolSpec[] = [];
let mcpToolSpecs: AnyToolSpec[] = [];
if (!options.tools) {
  [pluginToolSpecs, mcpToolSpecs] = await Promise.all([
    resolvePluginToolSpecs(executionInput),
    resolveMcpToolSpecs(executionInput)
  ]);
}
const rawTools = options.tools?.(executionInput) ?? defaultToolRegistryFor(
  current.agent_role, teamSkillContent,
  [{ source: "plugin", specs: pluginToolSpecs }, { source: "mcp", specs: mcpToolSpecs }]
);
```

两路来源用 `Promise.all` 并发解析（插件宿主与 MCP 客户端是两个独立的子进程集合，互不依赖，
串行解析只会让一次装配的等待时间变成两者之和）；`options.tools`（自定义整体替换式工具提供者）
仍然优先级最高，此时两路额外来源都不参与——插件工具早就是这个行为，这次原样把 MCP 也纳入
同一条短路（两个 provider 调用次数都是 0，测试断言两者）。

### 2. MCP 工具来源本身：形状与插件工具提供者逐字对照

```ts
export type AgentRunMcpToolsProvider = (input: AgentRunExecutionInput) => Promise<AnyToolSpec[]> | AnyToolSpec[];
const defaultMcpToolsProvider: AgentRunMcpToolsProvider = (input) =>
  getDefaultMcpClient().toolSpecs({
    ...(input.run.workspace_id ? { workspaceId: input.run.workspace_id } : {}),
    ...(input.run.actor_id ? { actorId: input.run.actor_id } : {}),
    runId: input.run.run_id,
    workItemId: input.run.work_item_id
  });
```

新增选项 `mcpTools?: AgentRunMcpToolsProvider | false`（与 `pluginTools` 同款：`false` 显式关掉，
不传走 `defaultMcpToolsProvider`，测试可注入假 provider）。`resolveMcpToolSpecs()` 包一层
try/catch：拿不到就退化成空数组并记 `mcp_tools_unavailable` 警告日志，绝不让 run 失败——这是
双保险：`getDefaultMcpClient().toolSpecs()` 内部已经对逐台服务器的连接失败 try/catch 过（M2），
这里再包一层防的是「调 `toolSpecs()` 这件事本身」出意外（例如测试或未来调用方注入的 provider
同步抛错）。

### 3. `server.ts` 接线：紧挨插件那两行

```ts
usePluginRegistryPathSource();
useMcpServerSource();               // 启动早期，紧跟插件路径来源
...
void closeDefaultPluginHostClient().catch(...);
void closeDefaultMcpClient().catch((error) => {   // 优雅关闭，紧跟插件宿主关闭
  logger.warn("mcp_client_close_failed", { error });
});
```

`useMcpServerSource()` 只在这里调用一次（进程启动早期）；不调用时 `getDefaultMcpClient()` 单例
的 `serverSource` 保持 `undefined`，`toolSpecs()` 命中 M2 已经写好的快路径 `if (closed ||
!serverSource) return [];`——**一次 DB 查询都不发生**，与插件路径来源的「显式接线」先例完全
同构。`closeDefaultMcpClient()` 关闭失败只记警告日志、不阻塞进程退出（下方 8s 强退兜底照旧
生效）。

### 4. 测试：behavioral-only，不暂替 `process.stdout.write`

新增 `apps/api/src/agent-runner-tool-sources.test.ts`（7 条），钉住：

- MCP 工具并入默认注册表后模型真的能调到；
- `mcpTools: false` 时点名调它只拿到 `tool not available`；
- MCP 工具顶不掉内置工具（同名 spec 丢弃，`write_file` 仍是真的写文件，不是 MCP 那份的桩内容）；
- MCP 工具提供者抛错时 run 照常成功，只是这次没有 MCP 工具（fail-open 的可观察结果）；
- 自定义 `tools` 提供者优先，插件与 MCP 两路 provider 调用次数都是 0；
- 插件与 MCP 同名时插件赢（合流优先级的可观察结果：`PLUGIN WINS` 内容出现，`MCP LOSES`
  永远不出现——因为它整条从没被注册过）；
- 不覆写 `mcpTools`/`pluginTools`（走真单例）时零行为变化，模型点一个 MCP 形状的工具名只拿到
  `tool not available`，run 正常跑完——证明默认路径不会因为这次改动意外发起真实连接或挂起。

**没有断言日志内容**（`mcp_tools_unavailable` / `tool_id_collision` 具体是否落过日志），只断言
可观察的执行结果。原因见下面「Alternatives considered」——诊断过程中发现暂替
`process.stdout.write` 收集日志行这个仓库里已有先例（`agent-runs.test.ts`）在本机 Node v22.17.0
上会与 `node:test` 自身的 TAP 报告竞态，偶发吞掉同文件里相邻测试的 `ok`/统计行（测试本体其实
执行过、断言也真的通过过，只是那一行「测试跑过」的报告消失，等价于悄悄削弱这一份 CI 信号）。
两条日志本身的真实落地在诊断过程的多次手工重跑里都直接见过（`tool_id_collision` 与
`mcp_tools_unavailable` 的 JSON 行都出现在过程输出里），逻辑是对的；只是不适合用会自己引入
报告竞态的方式钉进自动化测试。

## Alternatives considered

- **保留 `plugin_tool_id_collides_with_builtin` 专名，MCP 相关碰撞另起一个事件名。** 否决：
  两三个来源就要维护 2-3 个专名事件（`plugin_vs_built_in`、`mcp_vs_built_in`、
  `mcp_vs_plugin`……），往后再加第四个来源（比如设计稿提到过的技能市场工具）事件名会线性增长。
  统一成 `tool_id_collision` + `kept_source`/`dropped_source` 字段是一次性把「谁赢了」这件事
  表达清楚，且全仓库唯一引用点确认改名不破坏任何既有断言。
- **`defaultToolRegistryFor` 的第三参数保持扁平数组，合流优先级判定挪到调用侧单独一个函数
  （如 `mergeExtraToolSpecs`）。** 两种写法等价；选择把判定放在 `defaultToolRegistryFor` 内部
  是因为它本来就已经持有 `builtIn` 列表与丢弃逻辑，拆成两个函数反而要么重复传一次 `builtIn`
  的 id 集合，要么把「内置 vs 额外」和「额外 vs 额外」两次判定分裂在两处、容易后续维护时改了
  一处忘了另一处。
- **插件与 MCP 两路来源串行 `await`，不用 `Promise.all`。** 否决：两者是完全独立的子进程集合，
  没有先后依赖；串行等待只会让「一次装配」的耗时变成两者之和，尤其 MCP 服务器的握手可能到
  10 秒超时量级（M2 的握手超时参数），插件宿主也有自己的握手窗口，叠加起来对每次 run 的启动
  延迟是纯粹的浪费。
- **在自动化测试里继续用暂替 `process.stdout.write` 断言 `mcp_tools_unavailable` /
  `tool_id_collision` 两条日志（照抄 `agent-runs.test.ts` 的先例）。** 否决：诊断发现这个模式在
  本机 Node v22.17.0 上不可靠——用 `--test-name-pattern` 反复缩小范围实测到：只要某个测试在
  同一个文件里暂替过 `process.stdout.write`，无论它本身、还是它前一个/后一个测试，都有概率在
  `node --test` 的 TAP 统计里整条消失（"ok N" 行与总数悄悄减一，但退出码仍是 0、`fail` 仍是
  0）——测试本体真的执行且断言真的通过，只是这一条「有没有跑过」的报告本身丢了，比测试失败
  更隐蔽。反复重跑同一份 7 条测试的文件 3 次全部 `pass 7`（去掉日志断言之后），证明去掉
  暂替 stdout 这一步之后是确定性可靠的。**这是这个仓库里一个尚待确认范围的通病，不是本工包
  引入的新问题**——`agent-runs.test.ts` 里那两处暂替（约 5540/8017 行）用的是同一个模式，
  没有在本工包范围内验证它们是否也会偶发丢行；本工包范围明确只能改
  `workers/agent-runner.ts`/`server.ts`/新测试文件，所以没有去动那两处，只是在本文件里换了
  一种不依赖它的钉法，并把这个发现记在这里供以后排查。
- **把 M4 的合流逻辑做成可无限扩展的来源注册表（比如一个 `Map<string, ToolSourceProvider>`），
  为未来第四个来源预留接口。** 否决：YAGNI——设计稿 4.7 只点了插件与 MCP 两路，现在就为一个
  假设的第三方来源设计通用注册表是过度设计；`{ source, specs }[]` 这个形状加一路新来源时改
  动量很小（一行类型联合 + 一次 `resolveXxxToolSpecs` + 一行数组字面量），不需要现在就抽象。

## Consequences

- **合流优先级内置 > 插件 > MCP 已经钉死在类型与实现里**：`ExtraToolSourceName` 只有
  `"plugin" | "mcp"` 两个值，调用侧数组字面量的顺序（`plugin` 在前）就是优先级顺序——以后要
  改优先级或加来源，这一行就是唯一要改的地方。
  `defaultToolRegistryFor` 的第三个参数从「扁平 `AnyToolSpec[]`」变成「`{source, specs}[]`」——
  这是给未来加第三个来源（如果有）的调用约定；不传（默认 `[]`）时注册表与两次改造前逐字节
  一致，`pnpm gen:expected` 后 `git status` 干净已验证。
- **`server.ts` 的接线顺序是硬约定**：`useMcpServerSource()` 紧跟 `usePluginRegistryPathSource()`
  之后（两者互不依赖，谁先谁后不影响正确性，但保持相邻方便以后一起审查这一段「显式接线」）；
  `closeDefaultMcpClient()` 紧跟 `closeDefaultPluginHostClient()`——两者都是 fail-open（关闭失败
  只记警告日志），不阻塞 8 秒强退兜底。
- **给 M5 的入口**：`qa:mcp-smoke` 的端到端冒烟需要真正触发这条合流路径——用 M0 的
  `mcp_servers` 表插入一行启用的服务器配置、调 `useMcpServerSource(repository)` 接上真实/假仓库、
  再跑一次 `createInMemoryAgentRunQueue`（或走 PG 队列）触发 `agent-runner.ts` 的默认路径（不传
  `mcpTools` override），观察模型是否真的能调到夹具服务器翻出来的工具、以及一台服务器连不上
  时其余工具是否照常可用。M4 这一层的装配规则已经用假 provider 钉死；M5 要验的是「真实
  `useMcpServerSource()` → `getDefaultMcpClient()` → 真子进程」这条链路端到端通。
- **`tool_id_collision` 是一条新的结构化日志事件**（`apps/api/src/workers/agent-runner.ts`），
  字段 `tool_id` / `kept_source`（`"built_in" | "plugin" | "mcp"`）/ `dropped_source`
  （`"plugin" | "mcp"`）。运维/采集器如果之前按 `plugin_tool_id_collides_with_builtin` 这个
  事件名建过告警规则，需要改成按 `tool_id_collision` 事件名 + 过滤/分组 `kept_source`=
  `"built_in"` 来复现原来的那一种告警——全仓库搜索确认这次改名之前没有任何测试/脚本/文档引用
  旧事件名，所以这次改名不破坏任何既有断言，但外部（仓库之外）如果接了日志采集要知会一声。
- **测试模式发现待跟进**：本 Note 的「Alternatives considered」最后一条记录了
  `agent-runs.test.ts` 里暂替 `process.stdout.write` 断言日志这个模式在本机 Node v22.17.0 上
  可能偶发丢测试报告行的风险；本工包范围不含那个文件，没有去验证/修复，只是把发现记下来，
  建议另开一个不占用当前施工范围的任务去核实那两处是否受影响（若受影响，同一份修复思路是
  改成断言可观察行为而非日志内容，或换一种不依赖全局可变 `process.stdout.write` 的日志捕获
  方式）。
- **模型可见文本零改动**：本工包新增的都是内部装配逻辑与日志字段，没有新增/修改任何模型可见
  或界面可见文案；`pnpm gen:expected` 之后 `git status` 干净。
