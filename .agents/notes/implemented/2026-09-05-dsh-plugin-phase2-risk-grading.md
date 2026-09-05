# 插件工具的风险分级：管理员断言 AND 工具自述（阶段 2）

- Status: implemented
- Date: 2026-09-05
- Owner: Claude（R26 工位 W-X）

## Problem

阶段 0/1 之后插件面在真实部署里**不可用**，链条是死的而不是紧的：

1. `to-tool-spec.ts` 把每件插件工具钉成 `sideEffect: "external_effect"`；
2. `agent-runner.ts:709-711` 的 `sideEffectRiskCategory` 把这一档映成 `"external"`；
3. `human-reserved-guard.ts:246-250` 只要 `toolRiskCategory` 非空就**必开升级事件**
   （`if (!workItem || (!workItem.humanReserved && !toolRiskCategory)) return null` —— 有风险类就走不到 return null）；
4. `agent-runner.ts:1716-1741` 拿到非 null 就抛 409 `human_reserved_tool_call` 中断这次执行。

合起来：**每一次插件工具调用都停下来转人**。`qa:plugin-smoke` 之所以能跑绿，是因为它注入了一个
恒返回 null 的假守卫（旧文件 186-196 行）——这道门恰好绕开了它本该回答的那个问题。
R25 M-MCP 设计 2.3 把这条记成硬事实，并把「三档映射」提前成第一优先项。

同一批还有两个已被点名、未处置的相邻缺口：熔断是**整个插件面**级别的（一个坏插件关掉全部插件，
M-MCP 设计 5.2 第 3 条），以及 `plugin-host-client.ts` 的 `callTool` 在插件**抛错**时把
`error.message` 未中和拼进 `errorToolResult()`（M1b Note 的 Consequences 明写「留作后续独立小修」）。

## Decision

### 一、分级 = 管理员断言 AND 工具自述，且自述只能降不能抬

`plugins` 表加 `trust_level`（迁移 0074，`read_only` | `external_effect`，**默认 external_effect**），
它是管理员对这个插件设定的**风险上限**。最终副作用档由 `resolvePluginToolSideEffect()` 定，四行就是全部：

| 管理员断言 | 工具自述只读 | `sideEffect` | `minScope` | 风险类 | research / review 可见 |
|---|---|---|---|---|---|
| `external_effect`（默认） | 是 | `external_effect` | `plugin:<id>:external_effect` | external → 升级 + 409 | 否 |
| `external_effect`（默认） | 否 | `external_effect` | `plugin:<id>:external_effect` | external → 升级 + 409 | 否 |
| `read_only` | 是 | `none` | `plugin:<id>:read` | 无 | **是** |
| `read_only` | 否 | `external_effect` | `plugin:<id>:external_effect` | external → 升级 + 409 | 否 |

两条不对称都是有意的：**自述来自第三方代码，它不是授权来源**，所以只能在管理员划定的上限内往下降；
**没有自述就取最高风险**，默认拒绝。

低风险档选 `none` 而不是 `sandbox_file`：后者的语义是「写 run 工作目录里的文件」，一个只读检索工具
一个字节都不写，标成 `sandbox_file` 会让快照门为它开一个永远用不上的还原点（`SnapshotHookInput.sideEffect`
排除 `none` 正是这个原因）。落到 `none` 同时让它顺着 `canUseToolForTaskPlanRole` 的既有规则
（放行 `none` / `sandbox_file`）对 research / review 可见——**没有为插件新开任何口子**。

`agent-runner.ts` 因此**一行没改**：分级在翻译层落地，风险类判定与角色可见性都是既有规则的自然结果。

### 二、自述信号：`readOnlyHint === true`，因为 dsh 根本没有这个字段

逐字段读过 `@deepseek-ai/dsh-tools@0.1.0-rc.8` 的 `DefineToolOptions` / `ToolDefinition`：
`name` / `description` / `parameters` / `output{schema,render,presentationMeta}` / `timeoutMs` /
`isConcurrencySafe` / `execute` / `finalizeContent` / `presentCall` / `presentResult`。
**没有任何只读或破坏性声明位**，而且 `defineTool`（`lib/types/schema.js:274`）按白名单**重建**定义对象，
作者多写的键在归一化时被丢掉。

所以信号只能走宿主自己的 `ctx.tools.register()` 面：`readsAsReadOnly()` 严格认
`definition.readOnlyHint === true`（真值字符串、函数、`"false"` 都不算——模糊匹配等于替作者做了
他没做过的声明）。作者写法是 `register({ ...defineTool({...}), readOnlyHint: true })`，README 里照此写明。
名字借 MCP 的 `annotations.readOnlyHint`：同一个概念在插件与 MCP 两条第三方工具通道上用同一个词。

**刻意不拿 `isConcurrencySafe` 当只读信号**：它的契约是「可以和兄弟调用并行」（dsh 原话是 opted-in
executions must not mutate parent-owned state），一个往日志追加一行的工具完全可以并行安全却不只读。
拿它当只读用，是在编一条作者没做过的断言。

线协议描述符加**必填**的 `selfReportedReadOnly`，版本推进到 2。做成必填 + 推版本而不是「可选、缺了当 false」：
后者会让一台过期宿主把整个部署静默降级成「每次调用都转人」，看起来像功能坏了却没有解释；握手直接失败
至少说得清是什么。

### 三、熔断按插件，先归因再关

`disabledReason`（整插件面）保留为**兜底**，前面加一层按目录的 `quarantine`。归因两条判据，都不猜：
崩的时候只有一个插件的调用在飞 → 就是它；这个宿主本来只装了一个插件 → 除了它没别的可能。
其余情况（多个插件的调用同时在飞、握手期崩溃且装了不止一个）**不归因**，落回整插件面熔断。
被熔断的目录从下一次 `resolveEntries` 的清单里摘掉，于是新宿主的 `WORKHUB_PLUGIN_PATHS` 里不再有它。

**键是 source_path 不是包名**：`plugins` 表的唯一索引就是 `(workspace_id, source_path)`，两个不同目录
完全可以是同一个包名的两个版本；路径是这一层唯一能对回一行记录的键。包名只用来说人话与写日志。

落库走 `pluginCrashSink`（`status='crashed'`，`plugins.status` 的新值），与 `pluginPathSource` 同款纪律：
**不接线就一次 PG 都不碰**，进程内隔离照样生效。`crashed` 与 `load_failed` 分成两个词——前者是
「装上了、跑起来把进程带崩了」，后者是「根本没装上」，用户要做的处置完全不同。热重载（安装/启停/移除）
一并解除两种熔断：管理员刚亲手改过清单，这一轮该按新清单如实重试一次。

### 四、错误路径中和

`callTool` 的 catch 把插件抛出的 `error.message` 经
`sanitizeModelFacingText(raw, { maxChars: 32KB, neutralizeFenceTags: true })` 之后再进 `errorToolResult()`
——与 `translate.ts` 的 `renderToolContent` 逐项同一口径。抛错和返回值是同一类第三方数据，走的也是
同一条「进 ToolResult.content → 被工人抄进 outputs/ → 被装进围栏」的路。

### 五、`qa:plugin-smoke` 换成真守卫

去掉假守卫，装配**真的** `createHumanReservedGuard()`，只把它的四个仓储换成内存实现，并且这些内存实现
是 `Proxy` 包的：守卫哪天多调一个方法就**当场炸**并指名道姓，而不是安静拿到假空结果继续跑绿——
那正是上一版的失败模式。夹具 `dsh-plugin-echo` 现在注册两个工具，各占一档（`echo` 补了 `readOnlyHint`，
`write_note` 没有），于是同一次冒烟里两条路都真跑：只读那次成功、零升级、零还原点；
`write_note` 那次开一条 `user_forbidden` 升级并以 409 中断执行。

## Alternatives considered

- **把 `isConcurrencySafe` 的存在当作只读自述。** 否决：语义不同（并行安全 ≠ 只读），而且它是个
  取 args 的函数、按调用而变，静态判不出来。用它等于伪造一条作者没做过的安全声明——比不分级更糟。
- **只按管理员断言分级，忽略工具自述。** 否决：一个被断言成只读的插件里完全可能有写类工具
  （夹具里就有一个）。只看断言等于把整包工具一起放行，管理员没法逐工具判断，也没有任何东西
  阻止插件下一个版本悄悄加一件写类工具。
- **给 `plugins` 表加一列 JSON 存「逐工具的能力清单」（报告 6.2 那张表）。** 否决：那张表的
  capability 键（`net.fetch` / `data.write.<entity>` …）需要宿主侧真的能拦住对应能力才有意义，
  当前宿主只有进程隔离与 env 白名单，落一份查不出真假的清单是**虚假的安全感**。本轮先把
  「读 / 写」这一刀切准，逐能力授权留给宿主具备拦截能力之后。
- **`readOnlyHint` 走 `package.json` 的 `dsh` 字段（安装期静态体检就能读到）。** 否决：粒度错了——
  声明的对象是**一件工具**，不是一个包；而且体检那一层看不到工具清单（它刻意不执行插件代码）。
- **改 `canUseToolForTaskPlanRole` 让 research/review 也能用低风险插件工具。** 不需要：那条规则本来
  就放行 `none` / `sandbox_file`，把工具映到 `none` 之后可见性是自然结果。新开口子只会多一条要维护的例外。
- **崩溃归因不到时也随便挑一个插件关掉。** 否决：把锅扣在无辜插件头上比整面熔断更难排查——
  用户会看到一个「反复出错」的插件，而真正的元凶还在。宁可保守。
- **信任级别改动后热重载宿主。** 否决：子进程加载的还是同一批目录，分级是主进程这一侧的参数，
  `toolSpecs()` 每次都按最新清单重算。为一次授权改动掐断在飞的插件调用没有道理。

## Consequences

- **既有部署零行为变化**：0074 给既有行填的是 `external_effect`，与阶段 0/1 的口径逐字节一致。
  要让插件工具不再逐次转人，必须管理员**主动**去断言，且工具**自己**声明只读——两件事都发生才生效。
- **绝大多数现存 dsh 插件即使被断言成只读也仍在最高档**，因为它们没写 `readOnlyHint`。这是「默认拒绝」
  该有的样子，不是漏配；README 与设置页都照实说明。
- **`agent-run-prompt.golden.test.ts` 的「三种角色可见集一致」仍然绿**（它构造的注册表不含插件）。
  `plugin-tool.golden.test.ts` 现在按两档信任级别各落一份，把这条差异的完整形状钉住：
  断言只读时 `echo` 对 research/review 可见，`write_note` 原地不动。
- **人工保留门的词表分类优先于副作用分级**：`agent-runner.ts:1718` 先跑
  `classifyHumanReservedToolCall({ toolId })`，命中才回落到 `sideEffectRiskCategory`。所以一个 id 里带
  `payment` / `publish` 一类词的插件工具**即使落在 `none` 档也照样转人**。这与 M-MCP 设计 4.2 记下的
  「服务器名参与分词」是同一条性质，不是缺陷，但两端界面目前没有任何地方解释它。
- **线协议版本 2**：宿主与客户端在同一个包里一起发布，跨版本共存不会发生；真发生了会在握手期
  明确失败，而不是静默降级。
- **仍未覆盖**：
  - 熔断落库（`status='crashed'`）只有单测覆盖，`qa:r1-pg-plugin-smoke` 没有跑它——要在真库上跑
    需要一个**真的会把子进程弄崩**的夹具，那会给 CI 引入一个按时序判定的不稳定源。
  - `minScope` 至今**零消费者**。`plugin:<id>:read` / `plugin:<id>:external_effect` 是给
    `packages/permissions` 的 glob 预留的封禁键，不是当前生效的门。
  - 逐能力授权（报告 6.2 那张 capability 表）仍未做，见 Alternatives。
