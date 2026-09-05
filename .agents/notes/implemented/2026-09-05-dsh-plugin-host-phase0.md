# 子进程插件宿主：兼容 DeepSeek Harness 的工具型插件（阶段 0）

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code

## Problem

用户要求「支持 deepseek-harness 插件，方便后续大家用自己的插件」。dsh 生态里被策展收录的
插件约 3158 个，插件的入口契约是 `apply(ctx)` —— 不跑一个 Cordis Context 就没有 `ctx`，
也就装不上任何现成插件。

但 dsh 是**单机开发者工具**，它对插件零隔离：`SAFETY.md` 自己写明第三方插件可以损坏主机、
删改文件、泄露数据与凭据；策展列表的原话是工具审批不为插件代码提供沙箱。WorkHub 是
**多租户服务端**：`apps/api` 进程里有 PG 连接、Redis、LLM key，`workspace_id` 围栏遍布 DB 层。
把第三方 JS 直接 import 进这个进程，等于把整个租户体系交出去。

另外还有三条硬约束：

1. `packages/tools` 的 `ToolSpec.schema` 要求 Zod，而 dsh 的 `defineTool` 只产出 JSON Schema；
2. 全仓零动态加载先例（`apps/api` + `packages/*` 里唯一的运行时 `await import()` 是一处循环依赖破除）；
3. dsh 0.1.x 在持续破坏兼容（`@deepseek-ai/dsh-tools` 已发 16 个版本，`dist-tags.latest`
   被钉死在 `0.0.1-rc.1`，插件却在 pin `^0.1.0-rc.6`），我们对上游没有任何影响力。

## Decision

**方案 B'：适配壳 + 子进程宿主。不把 WorkHub 改造成 Cordis 应用。**

- 新建 `packages/plugin-host`：一个独立子进程（`node --import tsx src/host.ts`），里面起最小
  Cordis Context，只提供 dsh 工具型插件用得到的两个 service —— `ctx.tools`（`register`）与
  `ctx.systemPrompt`（`section`）。第三方代码只在这个进程里跑。
- 宿主与 `apps/api` 之间走 **newline-delimited JSON-RPC over stdio**，两个方法：`list_tools`
  与 `call_tool`。**故意没有反向通道**——插件宿主只提供「能力实现」，不提供「授权」。
  宿主启动时先把 `process.stdout.write` 改道到 stderr，插件的 `console.log` 污染不了 RPC 流。
- 子进程 env 走**白名单**（`PATH`/`HOME`/`LANG`/`LC_ALL`/`TZ`/`TMPDIR`）+ `WORKHUB_PLUGIN_PATHS`，
  外加一层凭据形状的兜底黑名单（`DATABASE_URL`/`REDIS_URL`/`BROKER_URL`/`COOKIE_SECRET`/
  `ADMIN_CLAIM_SECRET`/`*API_KEY*`/`*SECRET*`/`*TOKEN*`/`*PASSWORD*`/`*CREDENTIAL*`/`*PRIVATE_KEY*`），
  命中即抛错而不是「跳过该键继续」。也不透传 `NODE_OPTIONS`。
- 插件安装源阶段 0 **只认本地路径**。npm 包名 / git url / tarball url 一律拒绝：从这些源装包会在
  安装期跑它自己的 `prepare`/`postinstall`，那是任何沙箱之外的任意代码执行。
- 主仓只开三个最小口子：
  - `packages/tools/src/types.ts` 的 `ToolSpec` 加 `jsonSchema?` 旁路，`registry.ts` 的
    `modelInputSchema()` 优先用它（不给这个字段时 Zod 那条路一字未动）；
  - `apps/api/src/workers/agent-runner.ts` 的 `defaultToolRegistryFor` 接受 `extraSpecs`，
    装配处并入，另加一个 `pluginTools` 提供者（默认走进程内单例宿主客户端）；
  - `apps/api/src/services/plugin-host-client.ts` 管子进程生命周期与每次调用的审计。
- **插件工具一律按 `sideEffect: "external_effect"` 对待**。这一条把治理全部接上了既有链路：
  副作用非 `none` → 强制走快照门（无还原点直接拒执行）；`external_effect` →
  `sideEffectRiskCategory()` 归为 external → 进 human-reserved 拦截门 → 走审批。
  `minScope` 复活成 capability 键 `plugin:<pluginId>:external_effect`（`packages/permissions`
  的 glob 匹配里 `deny` 优先级最高，天然支持「一键封禁某插件」）。
- 每次调用落一条审计：`entityType:"plugin_invocation"`、`entityId:"<插件名>:<工具名>"`、
  `action:"plugin.tool.called"`，detail 带插件名/工具名/耗时/参数与结果摘要（各封 400 字）。
  审计写失败 fail-open（与 agent-runner 既有口径一致），但必留结构化日志。
- 崩溃隔离：宿主挂了 → 在飞调用返回**工具错误**而不是抛异常，这次 run 照常往下走；
  下次调用重启；5 分钟内重启超过 3 次就把整个插件面标为不可用。宿主起不来 / 配置写错 /
  提供者抛错，一律退化成「这次 run 没有插件工具」，绝不让 run 起不来。
- 验收门 `pnpm qa:plugin-smoke`：假 provider + 内存仓库（无 LLM key、无 PG），
  一次 agent run 里模型真的调到插件工具，结果进执行轨迹，调用落 audit_logs。

## Alternatives considered

- **方案 A：直接依赖 Cordis，在 `apps/api` 里起插件宿主 Context。** 兼容度最高（工具/provider/
  技能/事件类插件基本原样跑），但安全上不可接受：插件代码能拿到 `process.env` 里的
  `DATABASE_URL` 与 LLM key，能 import 任意 workspace 包直连 PG 绕过所有租户围栏。而且它把
  dsh 的版本节奏焊进 `apps/api`——上游一破坏兼容我们就得跟着改 service 接口。否决。
- **方案 C：只做「插件即工具包」（加载工具定义数组，不碰 Cordis）。** 对 dsh 生态兼容度 ≈ 0，
  因为 dsh 插件的入口是 `apply(ctx)` 而不是导出工具数组；用户拿现成插件装不上。
  它实际上是 B' 的**内层契约**（翻译器最终产出的就是这个），不能单独成方案。
- **把 `dsh-plugin-finance-data` 装成仓库依赖当冒烟对象。** 报告点名了这个包，我们也实测过
  （见 Consequences），但没有把它焊进构建：门要能离线、可复现地跑，公开仓也不该把某个
  陌生人的 npm 包变成构建期依赖。改用自己写的夹具 `packages/plugin-host/qa/fixtures/
  dsh-plugin-echo`——形状照真实 bundle 逐项对齐，并且真的调用 `@deepseek-ai/dsh-tools` 的
  `defineTool` 与 `@deepseek-ai/cordis` 的 Context，所以兼容面是真跑出来的，不是假装的。
- **让插件文案进系统提示词。** `ToolSpec.promptSnippet`/`promptGuidelines` 现成可用，接上去
  只要几行。但插件自报文案进系统提示词就是提示词注入面，得排在提示词 golden 之后。
  阶段 0 不设这两个字段——模型仍通过 `toModelTools`（tool description 通道）看得见并调得到。
- **在主进程重实现一份 JSON Schema 入参校验。** 与插件侧的校验容易不一致，且 dsh 的
  `execute` 自带校验（缺必填抛 `INVALID_ARGS`）。主进程只做「是个对象」的粗校验，
  结构校验交回插件，错误如实带回。

## Consequences

- **兼容面是一个切片，不是全部，文案上必须说清。** 能兼容的是**工具型**插件（以及后续阶段的
  技能、模型 provider 类）。占策展列表最大两块的 UI Enhancements 与 Themes（合计约 20%）走的是
  浏览器侧第二个 Cordis Context + React + `ctx.slots.register`，WorkHub 全仓零 `.tsx`、桌面端是
  字符串模板 DOM，**永远兼容不了**；Sessions & Messages、Usage & Billing 绑 dsh 的 session log
  与计量，同样不行。对外只说「兼容 DeepSeek Harness 的工具类插件」，不说「支持 dsh 插件」。
- **实测：报告点名的真实插件 `dsh-plugin-finance-data@0.2.0` 当前装不上，原因在 dsh 生态那边。**
  在隔离目录里按它自己声明的 peer 范围 `@deepseek-ai/dsh-tools@^0.1.0-rc.6` 装齐（rc.6 / rc.7 /
  rc.8 三个版本各试一遍），`defineTool` 都在加载期直接抛
  `unsupported JSON schema: parameters.targets.additionalProperties must be explicitly true or false`；
  它的 `output.schema` 顶层还用了 rc.8 已不接受的 `required: true`。也就是这个已发布插件是对着
  另一个 dsh-tools 版本发的。**我们的宿主对此的表现正是设计意图**：失败原因精确进
  `PluginLoadReport`，宿主活着，工具列表为空，agent run 不受影响。这条实测同时坐实了
  侦察报告的风险 3（dsh 0.1.x 破坏性变更节奏），也说明阶段 1 的安装页必须做**静态体检 +
  兼容度预判**，否则用户会遇到「装了三个有两个装不上」。该验证在临时目录里做，未进仓库。
- **不配 `WORKHUB_PLUGIN_PATHS` 时零行为变化**：客户端构造时就看到空路径，同步返回空数组，
  不 spawn 任何子进程。既有 run 与全部既有单测的工具集逐字节不变。
- **插件顶不掉内置工具**：与 `read_file`/`write_file`/`run_command`/`load_skill`/`submit` 同名的
  插件 spec 在装配时被丢弃并记日志，而不是让注册表的重名 `throw` 把整次 run 带崩。
- **这是全仓第一处运行时动态加载**（`await import()` 加载外部模块）。它被关在
  `packages/plugin-host/src/host.ts` 一个文件里，且只在子进程里执行。
- **dsh 依赖全部关在 `packages/plugin-host` 一个包里**（`@deepseek-ai/cordis@4.0.2`、
  `@deepseek-ai/dsh-tools@0.1.0-rc.8`、`@deepseek-ai/schemastery@3.18.2`，全部 MIT，
  连同传递依赖安装闭包约 2.7MB）。主仓与 `packages/tools` 的契约不变，上游破坏性改版
  只砸在这一个包上。`apps/api` 只 import `@workhub/plugin-host` 的**纯**入口（协议 + 翻译器 +
  env），不 import `./host.js`，所以 Cordis 永远不进主进程的模块图。
- **进程边界顺带解掉 GPL 插件的链接争议**：进程分离 + 明确 wire 协议是较弱耦合形态。
  我们也不在 `THIRD_PARTY_NOTICES.md` 里替用户装的插件做许可声明——我们不分发它们。
- **这是容器，不是沙箱。** 子进程没有凭据、没有 DB 连接，但仍以当前用户身份跑，能读写这台机器
  上该用户能碰的文件、能出网。Seatbelt/bwrap 包裹与 capability 声明留到阶段 1。
  `.env.example` 里对这条已按原话写明，不含糊。
- **阶段 1 的入口**（本轮明确不做）：插件清单契约与 `plugins` 表、设置页安装/启用停用 UI 与
  管理员审批、安装源扩到 npm 包名与 tarball（git 源默认禁用）、静态体检与兼容度预判、
  提示词通道打通（把 `promptReference()` 从 `defaultToolRegistryFor` 解耦）、
  技能类插件接上 `listLayeredSkills`、以及与之并行的 MCP 客户端。
