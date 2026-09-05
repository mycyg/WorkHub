# R24-P 侦察：WorkHub 支持 deepseek-harness 插件生态的兼容层方案

- 用户原话：「https://github.com/deepseek-ai/deepseek-harness 这个插件最好支持下哦～方便后续大家用自己的插件啥的」
- 侦察对象：`/Users/apple/Desktop/开发项目/WorkHub/reference/deepseek-harness`（dsh-0.1.3-alpha.1，MIT）+ npm registry + GitHub `dsh-plugin` topic
- 对照本仓：`/Users/apple/Desktop/开发项目/WorkHub`（`main-integration` @ `2f96d035`）
- 纪律：全程只读，两个仓库均未改动、未安装、未起服务
- 已读并尊重：`.agents/notes/rejected/2026-08-19-no-display-layer-copy-regex.md`（与插件无关，不构成约束）
- 前置：`r24-H-deepseek-harness-borrow.md`。那篇的「别借 1（不要全量 Cordis 化）」结论**本报告不推翻**——推荐方案不引 Cordis 进 `apps/api` 的主进程树，见第 4 节。

---

## 一句话结论

**推荐方案 B'（适配壳 + 子进程宿主）：不把 WorkHub 改造成 Cordis 应用，而是在 `apps/api` 之外起一个独立的「插件宿主子进程」，在那里跑一个最小 Cordis Context，把 dsh 插件贡献的 `ctx.tools` 工具翻译成 WorkHub `ToolSpec`，经 RPC 回注到现有 `AgentRunToolsProvider` 缝里，全程走既有 `canUse` / 快照门 / 审批 / 审计。**

理由三条，每条都有硬证据：

1. **dsh 插件的真实运行时依赖面比想象中小**：一个真实第三方插件（`dsh-plugin-finance-data@0.2.0`）编译产物 `lib/index.js` 只 `import` 了 `@deepseek-ai/schemastery` 和 `@deepseek-ai/dsh-tools` 两个包。`@deepseek-ai/dsh-tools` 声明 9 个 peer，但其中 5 个（`dsh-agent`/`dsh-session`/`dsh-system-prompt`/`dsh-code-runtime`/`dsh-user-approval`）在 `packages/core/tools/src/index.ts:13-20` 全是 `import type`，**运行时不加载**。真实运行时闭包 ≈ 9 个 MIT 包 / ~1.2MB。
2. **但 dsh 对插件零隔离**：`SAFETY.md:9` 自己写明「load third-party plugins … untrusted plugins may damage the host computer, modify or delete files, disclose data or credentials」；awesome 列表的警告更直白：「Tool approvals don't sandbox plugin code」。WorkHub 的 `apps/api` 进程里有 PG 连接、Redis、LLM key、多租户 `workspace_id` 围栏——**把第三方 JS 加载进这个进程等于把整个租户体系交出去**。所以宿主必须出进程。
3. **能真正兼容的只是生态的一个切片**：3158 个精选插件里，最大类目「UI Enhancements」519 个（16.4%）+「Themes & Appearance」112 个，走的是 dsh 的**浏览器侧第二个 Cordis Context + React + CSS Modules + `ctx.slots.register`**（`packages/client/ui-settings-plugin-inventory/src/client/index.ts:29-57`）。WorkHub 全仓零 `.tsx`、桌面端是字符串模板 DOM，这一类**不可能兼容**，要在文案上讲清楚，不能承诺「支持 dsh 插件」四个字。

**阶段 0（一周内可交付）**：装一个真实的 dsh 工具型插件（`dsh-plugin-finance-data`），让 Cuu 在一次 agent run 里真的调用到它，全程过 `canUse` + 快照门 + 审计。

---

# 1. dsh 插件到底是什么

## 1.1 包格式

| 维度 | 事实 | 证据 |
|---|---|---|
| 发现标记 | GitHub 仓库打 `dsh-plugin` topic | `README.md:46`、`CONTRIBUTING.md:15` |
| npm 关键字 | 惯例 `["deepseek-harness","dsh","dsh-plugin","cordis","plugin","bundle", …]` | 真实包 `dsh-plugin-finance-data` 的 `package.json.keywords` |
| **可安装性的唯一判据** | `package.json` 里有 `dsh.bundle.patch` | `docs/user/develop/basic/publish.md:13`、`.agents/skills/dsh-doc/SKILL.md:43` |
| 三种包形态 | **bundle**（有 `dsh.bundle.patch`，`dsh plugin add` 能激活一层）/ **plugin**（有 `apply` 导出或默认 service 导出，只能靠手写 `cordis.yml` 行挂载）/ **library**（普通模块 API，无安装路径） | `.agents/skills/dsh-doc/references/review.md:26` |
| bundle 目录形状 | `package.json` + `cordis.patch.yml` + `index.js` | `docs/user/develop/basic/publish.md:27-31` |
| patch 语义 | YAML 数组，`- insert: [{id, name, config}]`；`name` 是 npm 包名或绝对路径 | `docs/user/develop/basic/publish.md:56-62` |
| **patch 是整体替换不是深合并** | 按 `id` 命中后替换整个 `config` | `docs/user/develop/basic/publish.md:123` |
| 客户端插件额外声明 | `package.json` 的 `dsh.client = { inject: [...], platform: "web" }` + `./client` 子导出 | `packages/client/ui-settings-plugin-inventory/package.json` |

## 1.2 Context API 面（插件作者能碰到的全部）

**插件模块本身的导出契约极小**（`docs/user/develop/basic/index.md:17-27, 87-103, 105-138`）：

```ts
export const name = 'my-plugin'          // loader 诊断用名
export const inject = ['tools', 'llm']   // 依赖的 service，全部就绪后才调 apply
export const Config: z<Config> = z.object({ … })   // schemastery（非 zod）
export function apply(ctx: Context, config: Config): void { … }
```

三种形态：函数模块 / 对象默认导出（`{name, inject, apply}`）/ class 继承 `Service`（插件自己**提供** service 时用）。

生命周期（`docs/user/develop/basic/index.md:66-85`）：**注册即效果**——通过 `ctx` 注册的一切（事件监听、工具、定时器）在插件卸载时自动回滚；需要显式清理的资源用 `ctx.effect(() => { …; return dispose })`。

**「你想干 X → 挂在哪」的官方 22 行映射表**在 `docs/architecture.md:127-149`。摘对我们有意义的：

| 目标 | 机制 | `ctx` key |
|---|---|---|
| 加模型 provider | `ctx.llm.registerAdapter(['route'], adapter)` | `ctx.llm` |
| 加模型可见能力（工具） | `ctx.tools.register(defineTool({…}))`，schema 自动进提示词组装 | `ctx.tools` |
| 加人类命令（不走模型轮次） | `ctx.commands` | `ctx.commands` |
| 加后台工作 | `ctx.jobs` | `ctx.jobs` |
| 加文件系统访问/策略 | `ctx.fs` provider 或 `fs/*` 事件 | `ctx.fs` |
| 拦截请求/工具/轮次 | `agent/*`、`tools/*` 事件（**waterfall，必须 `next()` 委托**） | — |
| 加模型可见上下文 | `agent.inject()` | — |
| 加 UI / 编辑器集成 | 驱动 `ctx.agents` + 从 `session/event` 渲染 | `ctx.agents` |
| 加 Web Chat 节点 | `ConversationNodeDefinition` + keyed renderer | — |
| 加持久会话状态 | 扩 `SessionEventMap`，从 log 渲染与回放 | `ctx.sessions` |
| 技能目录 | `ctx.skills.registerProvider(…)` | `ctx.skills` |

事件分三域（`docs/architecture.md:66-72`）：**Session events**（持久化事实，必须能从 log 重建）/ **Agent events**（`agent/*`，携带活的 Agent）/ **Capability events**（`fs/*`、`tools/*`、`telemetry/*`）。

## 1.3 八个真实插件解剖

| # | 包 | 类型 | 行数 | `inject` | 用到的 Context 面 | 能否移植到 WorkHub |
|---|---|---|---|---|---|---|
| 1 | `web/tool-web` | 工具 | 95 | `['tools','web','systemPrompt']` | `ctx.tools.register(defineTool)` × 2；提示词 section | **能**（tool 适配器） |
| 2 | `todo/tool-todo` | 工具 + 会话投影 | 223 | `['tools','sessionProjections']` | `ctx.sessionProjections.register({key,stateSchema,init,apply,wire})`；`ctx.tools.register` | **半能**（工具能，投影不能——我们无 session log） |
| 3 | `guard/repeat-tool-reminder` | loop 扩展 | 233 | 无 | `ctx.on('tools/post-execute', (exec,result,next)=>…)`；`ctx.on('agent/pre-step', …)` | **半能**（需要在 loop 里造等价 waterfall 钩子） |
| 4 | `skill/skill-filesystem` | 技能 provider | 1041 | `['skills']` | `ctx.skills.registerProvider(…)`；`ctx.logger.warn` | **能**（我们已有三层技能目录，见 3.5） |
| 5 | `mcp/mcp-client` | 外部工具桥 | 1149 | `['tools']` | `ctx.tools.register`（名字空间 `mcp__<server>__<raw>`）；`ctx.effect` 管连接生命周期 | **能，且是战略入口**（见 4.4） |
| 6 | `llm/llm-deepseek` 家族 | provider | — | `['llm']` | `ctx.llm.registerAdapter(['my-provider'], new MyAdapter())`；适配器实现 `async *stream(opts): AsyncIterable<StreamChunk>` | **能**（我们 `TransportFactory` 是可注入的） |
| 7 | `llm/plugin-package-inventory-deepseek` | 请求扩展 | 199 | `['agents','deepseekLlmApiExtensions','loader']` | `ctx.deepseekLlmApiExtensions.register('dsh_plugin_packages', {prepare})`；直接读 `ctx.loader` 的 Fiber 树 | **不能**（深度绑 Loader 内部） |
| 8 | `client/ui-settings-plugin-inventory` | UI | 58（client 侧） | `['slots','locale','remote','remote.pluginInventory']` | `ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({name,id,order,label,locale,inject}, ReactComponent))`；`ctx.locale.register(NS,{zh,en})`；`ctx.remote.<face>.<method>()` | **不能**（浏览器侧第二个 Cordis + React + CSS Modules + 生成式 Remote） |

**工具定义 DSL（`defineTool`）的完整字段**（`packages/core/tools/src/schema.ts:526-560`、`packages/core/tools/src/index.ts:213-280`）：

```
name, description, parameters（自有 spec → 转 JSON Schema）,
output: { schema, render(args,value)→ContentBlock[], presentationMeta? },   // 强制
execute(args, exec: ToolRunContext) → Promise<canonical JSON value>,
timeoutMs?,                    // 从不发给模型
isConcurrencySafe?(args),      // 只有 true 才并行；从不发给模型
finalizeContent?(exec,result), // 同步、必须 total、不许抛
presentCall?(args) → ToolCallView | undefined,       // 纯函数，回放要跑
presentResult?(args,result) → ToolResultView | undefined
```

关键契约差异（**这是适配层要翻译的地方**）：

- dsh 的 `parameters` 是自有 spec（`{name:{type:'string',required:true,description:…}}`），由 `parameterSchemaSpecToJsonSchema` 转 JSON Schema（`schema.ts:547`）。**WorkHub 的 `ToolSpec.schema` 要求 Zod**（`packages/tools/src/types.ts:80`），注册表用 zod v4 的 `toJSONSchema` 反向出 JSON Schema（`packages/tools/src/registry.ts:22-30`）。→ 适配器要么把 dsh 的 JSON Schema 包成 `z.custom()` 并覆写 `modelInputSchema`，要么给 `ToolSpec` 加一个 `jsonSchema?` 旁路字段。**这是唯一必须改 `packages/tools` 的地方。**
- dsh 的 `execute` 返回**规范 JSON 值**，再由 `output.render` 转成模型可见 `ContentBlock[]`；WorkHub 的 `execute` 直接返回 `ToolResult{content:string, data?}`（`packages/tools/src/types.ts:17-24`）。→ 适配器：`content = render(args, value).filter(text).join("\n")`，`data = value`。天然对齐，我们的 `content`/`data` 早就分开了。

---

# 2. 生态现状

## 2.1 规模

- GitHub `topic:dsh-plugin` 搜索命中 **13629** 个仓库（`gh api search/repositories -f q='topic:dsh-plugin'`，2026-09-05）。这个数字**不可尽信**——返回结果里混进了 `amruthpillai/reactive-resume`（简历生成器）这类蹭 topic 的项目。
- 更可信的口径：`awesome-dsh-plugin/awesome-dsh-plugin`（14.5k★）的策展列表，`https://awesome-dsh-plugin.com/count.json` 报 **3158** 个。收录门槛写死在 README：「installs with `dsh plugin add`, does what its one-line description says, sits in the right category, and is maintained」——即**必须声明 `dsh.bundle`**。
- 另有 `AdamPlatin123/dsh-plugin-radar` 声称自动发现 **15900+** 候选并跑 k8s 实测流水线。

## 2.2 类目分布（3158 条，按 awesome 列表分类统计）

| 类目 | 条数 | 占比 | WorkHub 可兼容性 |
|---|---:|---:|---|
| UI Enhancements | 519 | 16.4% | **不可能**（React + 浏览器 Cordis + slots） |
| Tools & Capabilities | 420 | 13.3% | **可以**（tool 适配器主战场） |
| Development & Runtime | 254 | 8.0% | 部分（多数是 shell/fs/lsp 绑定） |
| Sessions & Messages | 198 | 6.3% | 不可能（绑 dsh session log） |
| Workflow & Automation | 189 | 6.0% | 部分 |
| Usage & Billing | 176 | 5.6% | 不可能（绑 dsh 计量/UI） |
| Memory | 146 | 4.6% | 部分（我们有更强的三层记忆，别换） |
| Skills | 135 | 4.3% | **可以**（多数是 `SKILL.md` 包） |
| Models & Providers | 126 | 4.0% | **可以**（`TransportFactory` 可注入） |
| Notifications & Integrations | 125 | 4.0% | 部分（我们无 channel 抽象） |
| Themes & Appearance | 112 | 3.5% | 不可能 |
| Security & Permissions | 106 | 3.4% | 部分（`tools/pre-execute` 钩子） |
| Just for Fun | 101 | 3.2% | 多为 UI |
| Vision & Multimodal | 99 | 3.1% | **可以**（多是工具） |
| Remote & Mobile / Git & Code Review / Plugin Markets / Browser & Web / Voice / Docs / WSL / Identity / AGI | 448 | 14.2% | 混合 |

**保守估算可兼容切片：Tools & Capabilities + Skills + Models & Providers + Vision ≈ 780 条（约 25%）**，加上 Development/Workflow/Security 里纯工具的部分，乐观到 35%。**「支持 dsh 插件」不能无限定地说。**

## 2.3 安装与版本兼容

- 安装命令：`dsh plugin --profile <name> add <package|./path|github:user/repo|*.tgz>`，本质是**在 profile 目录里转发 pnpm**（`.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.md:15`：「a thin pnpm forwarder」），装完把包名追加进 `dsh.profile.bundles`。
- 卸载：`dsh plugin --profile demo remove <pkg>`，同时摘依赖与层。
- **git 安装的构建脚本陷阱**（`docs/user/develop/basic/publish.md:161-173`）：git 装的是源码不是产物，作者要提供 `prepare` 脚本，用户要在 profile 的 `pnpm-workspace.yaml` 里 `allowBuilds: {pkg: true}`。dsh 自己的原话是：**「Treat that allowance as permission to execute the package's code on your machine at install time, outside any sandbox the agent runs under」**，并建议 pin commit sha。
- **版本兼容策略：靠 peerDependencies，没有 API 版本协商。** 实测 `dsh-plugin-finance-data@0.2.0` 声明：
  ```
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-fs": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-system-prompt": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-tools": "^0.1.0-rc.6",
    "@deepseek-ai/schemastery": "^3.18.1"
  }
  ```
- **0.1.x 确实在破坏兼容**：`@deepseek-ai/dsh-tools` 已发 16 个版本（`0.0.1-rc.1 … 0.1.2-rc.1`），`dist-tags.latest` 停在 `0.0.1-rc.1` 而 `next=0.1.2-rc.1`、`alpha=0.1.2-alpha.5`——**`latest` 标签是故意钉死的旧版**，插件都在 pin `^0.1.0-rc.6`。这意味着我们无论选哪个版本作宿主基线，都会有一批插件装不上。
- npm 上的官方包**全部已发布**（不只在 vendor）：`@deepseek-ai/cordis@4.0.2`、`@deepseek-ai/schemastery@3.18.2`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh`（CLI，`0.1.2-rc.1`）。全部 MIT。
- **重要事实更正**：dsh 仓库里的 `vendor/cordis` **不是**上游 `cordis`，是 rescope 到 `@deepseek-ai/` 的分叉，且有 **19 条本地修改**（`vendor/README.md` 的 Local modifications 段），其中第 6 条「fiber.ts lifecycle hardening」修了三处可重入 dispose 缺陷，第 8/12/15 条是 Loader/Include 的事务化重构。**上游 npm `cordis@4.0.0-rc.9` 不含这些**。要装就装 `@deepseek-ai/cordis`。

---

# 3. WorkHub 能承载什么（扩展点映射表）

> 全部 file:line 来自 `main-integration @ 2f96d035`。

| # | WorkHub 扩展点 | 现状机制 | 可映射的 dsh 贡献 | 需要新建的适配 | 安全边界 |
|---|---|---|---|---|---|
| 3.1 | **工具注册表** `packages/tools/src/registry.ts:32-47` | `ToolRegistry` 是 `Map` 包装，构造时注入数组；`register()` 存在但**生产零调用方**（唯一装配点 `apps/api/src/workers/agent-runner.ts:688-693` 的 `defaultToolRegistryFor`） | `ctx.tools.register(defineTool(…))` —— **主战场** | `dshToolToWorkHubSpec()`：dsh JSON Schema → `ToolSpec.schema`；`output.render` → `content`；`sideEffect` **由插件声明映射**（见 3.9） | 已有双重 `canUse`（列出 `registry.ts:85` + 执行 `registry.ts:108-110`）+ **副作用工具强制快照门**（`registry.ts:118-121`：`sideEffect!=="none"` 且无 `ctx.snapshot` 直接拒），插件工具只要声明非 `none` 就自动落进快照/回滚/审计体系 |
| 3.2 | **agent run 工具注入缝** `apps/api/src/workers/agent-runner.ts:281-284` `AgentRunToolsProvider` + `:1745` `options.tools?.(executionInput) ?? defaultToolRegistryFor(...)` | 已是**整体替换式**注入口（只暴露 `toModelTools`/`execute`） | 插件工具集的挂载点 | 把 `defaultToolRegistryFor` 改成接受额外 specs，或写一个 composing provider | **代价已知**：`agent-runner.ts:1798-1804` 注释明写——自定义 tools provider 时 system prompt 的「可用工具/Guidelines」段仍按默认工具集组装，**插件工具不进提示词清单**。修法：让 `promptReference()` 也走 provider（见阶段 1） |
| 3.3 | **provider registry** `packages/agent/src/providers/registry.ts:54-69` | `get(actor,task)` 查 `config.providers[name]`（**字面量硬编码在 `packages/config/src/providers.ts:32-59`，只有 `deepseek` 一条**）；`transportFactory` **是可注入的**（`types.ts:88-94`），但生产无人传 | `ctx.llm.registerAdapter(['route'], adapter)` | 把 `providers` 从字面量改成「基线 + 插件贡献合并」；`transportFactory` 按 `provider.name` 分派；dsh `AsyncIterable<StreamChunk>` → 我们的 `LlmTransport{create,stream}` | provider 插件会拿到 **API key**。必须走 settings 存储 + 只在子进程里解密；审批门：新增 provider 视为管理员操作 |
| 3.4 | **prompt 组装** worker：`apps/api/src/workers/agent-runner.ts:831-874` / turn：`packages/agent/src/turns/prompt.ts:72-97` | **纯字符串数组 join，无 section 注册表**；唯一结构化通道是 `ToolPromptReference`（`packages/tools/src/registry.ts:17-20`：`snippets`+`guidelines`） | dsh 的 `ctx.systemPrompt.section({name,order,text})` | 用 `ToolSpec.promptSnippet` / `promptGuidelines`（`packages/tools/src/types.ts:74,79`）承接插件的 prompt 片段——**已经存在，不用新建** | 插件写进系统提示词 = 提示词注入面。必须过 `neutralizeFenceTags` 同款中和 + 长度上限 + 落进 B1 的提示词 golden |
| 3.5 | **技能** `packages/tools/src/skills.ts:96-174` | **三层目录发现已建成**：`project`(rank 100,`WORKHUB_SKILLS_PROJECT_DIR` 或 `<repo>/.workhub/skills`) / `user`(200, `~/.workhub/skills`) / `bundled`(600)，低层被高层覆盖 —— **这是全仓最接近「插件安装目录」的既有机制**。但 `listLayeredSkills` 是死代码（生产四个调用点全走单根，见 R24-H 第 3 节） | dsh 的 `SKILL.md` 技能包（135 条 Skills 类插件） | 几乎零：把 `agent-runner.ts:690/836` 的 `createSkillTool(undefined,…)` 接上分层即可 | 技能是**纯 markdown 提示词素材，无可执行代码**（`skills.ts:207-219` 只 `readFileSync` + 回给模型）。风险只有提示词注入，不是 RCE。**这是全场最便宜、最安全的一条兼容路径** |
| 3.6 | **后台任务** `apps/api/src/workers/pulse-scheduler.ts:36-41` `PulseTask{name,intervalMs,tick,maxDrainPerTick}` + `:207` 起 7 次 `scheduler.register(...)` | **真正可注入的任务表**（重名抛错、错误隔离、`stats()` 暴露 tick/skip/error） | dsh 的 `ctx.jobs` / `ctx.schedule` | 一个 `registerPluginPulseTask()` 包装 + 预算/超时上限 | 顶层 10 个 worker 是硬编码（`apps/api/src/server.ts:41-114`，import/start/stop 三处）——**插件周期任务一律挂 pulse，绝不允许新起 worker** |
| 3.7 | **通知渠道** `apps/api/src/services/notifications.ts` | **没有 channel 抽象**；`notifications` 表（`packages/db/src/schema/core.ts:1022-1062`）**无 transport 列**，只有 `type`/`severity`；全仓无 webhook/smtp/apns 实现 | dsh 的 Notifications & Integrations 类（125 条） | 需要先自建一层 notifier 抽象。**最省事的接法**：在 pulse 里注册一个消费 `notifications` 表的投递任务 | 通知外发 = 数据出境。必须走 `external_effect` 侧效分类 + 审批 |
| 3.8 | **桌面端 Spotlight** `apps/desktop-webview/src/spotlight/registry.ts:32-53` | `builtViews` 是**模块级 const 字面量**（19 条），无 setter、未导出；`CommandId` 是字面量联合（`command-palette.ts:8-33`）；元数据 `commandRegistry` 是硬编码数组（`:60`）——**新增一个能力要改 3 处** | dsh UI 插件（519+112 条） | **不做**。见 4.5 | — |
| 3.9 | **桌面端工作台面板** `apps/desktop-webview/src/workbench/shell.ts:19,35,42,43` 四个面板静态 import + `:405,418,438,465` 顺序调用 | 无注册机制。**唯一解耦契约**：`workbench/store.ts:45-49` `WorkbenchSidePanelContent = {ownerId:string; html:string}` ——「store.ts 不认识任何具体视图的类型」 | 插件的只读展示面板 | 一个「插件面板」宿主：给 `{ownerId:"plugin:<id>", html}` 即可占用右栏 | **插件给的 html 必须当不可信内容处理**（sanitize / 无 script / CSP），绝不 `innerHTML` 直塞 |
| 3.10 | **web 路由** `apps/web/src/routes.ts:127` `routeMatchers` | **5 个同步点 + 3 个测试断言焊死**（`routes.test.ts:991-1010` 的 22 key 字面量 deepEqual、`:1053-1057` nav 孤儿检查、`:1807` 路由计数） | — | **不做**。插件页面只能「寄生」在既有路由内（仓库已有这种规避写法：`apps/web/src/browser.ts:3368`、`my-conversations.ts:7` 的注释） | — |
| 3.11 | **审批** `apps/api/src/services/approvals.ts:715` `createApproval(input: CreateApprovalInput)`，入参 `{actor, kind:"tool"|"proposal"|"revision", actionPattern, payloadJson, routedToUserId, slaDueAt}`（`:165-175`） | 已有完整链路（策略求值 `:717-722`、路由目标校验 `:735-757`、SLA、审计） | dsh 的 `ctx.approval.request()`（我们比它完整得多） | 插件声明的 capability → `actionPattern` 字符串（如 `plugin:finance-data:net.fetch`） | **插件权限声明的落点就是这里**。`ToolSpec.minScope`（`packages/tools/src/types.ts:82`）**声明了但全仓零消费者**——正好复活它做 capability 键 |
| 3.12 | **审计** `packages/db/src/repositories/audit.ts:203` `createAuditLog(input)`，入参 `:23-35` | 各服务自建 repo，**无统一门面**，但都在 deps 里声明 `Pick<AuditLogRepository,"createAuditLog">` → 可注入 | — | 插件调用落一条 `entityType:"plugin_invocation"` | 已有原子「快照+审计」事务 `audit.ts:37-53` `createSnapshotWithAudit` |
| 3.13 | **高危工具拦截** `apps/api/src/workers/agent-runner.ts:1757` `classifyHumanReservedToolCall({toolId}) ?? sideEffectRiskCategory(...)` | 分类是**基于 toolId 字符串分词的猜测**（`services/human-reserved-guard.ts:105-140`，legal/finance/identity/publish 四类词表） | — | 插件工具应该**声明式**给出风险类别，而不是让分词器去猜 `mcp__foo__transfer_money` | 这是插件接入后最先会漏的地方：**插件工具名不在我们的词表词汇里，分词猜测必然漏判** |

## 3.14 三个结构性事实（决定方案形态）

1. **全仓零动态加载先例**：`apps/api/src` + `packages/*/src` 里唯一的运行时 `await import()` 是 `apps/api/src/routes/proposals.ts:752-753` 的循环依赖破除。零 `require(`。**插件层将是第一个引入外部模块加载的地方。**
2. **全仓零 MCP**：grep `modelcontextprotocol|McpClient|mcp_` 在 `apps/`+`packages/` 零命中。
3. **`packages/tools` 不编译**：`package.json.exports` 直接指向 `./src/index.ts`，消费方吃 TS 源码；`apps/api` 的 `start` 是 `node --import tsx src/server.ts`，`build` 只做 `tsc --noEmit`。**没有 JS 产物** —— 这对「插件宿主要不要跟主进程共享类型」有直接影响（宿主子进程也可以 `--import tsx`，但生产部署最好给它一个真编译产物）。

---

# 4. 兼容层方案评估

## 4.1 方案 A：直接依赖 Cordis，在 `apps/api` 起插件宿主 Context

**做法**：`pnpm add @deepseek-ai/cordis @deepseek-ai/schemastery @deepseek-ai/dsh-tools …`，在 `apps/api` 里 `new Context()`，把 WorkHub 的工具注册表/provider/事件/技能包装成 Cordis service（`ctx.tools`、`ctx.llm`、`ctx.skills`、`ctx.systemPrompt`…），dsh 插件原样 `ctx.plugin(mod, config)`。

| 维度 | 评估 |
|---|---|
| 兼容度 | **最高**（工具/provider/skill/事件类插件基本原样跑；UI 类仍然不行） |
| 依赖量 | 运行时闭包 9 个 MIT 包：`@deepseek-ai/cordis`(233KB) + `cosmokit`(52KB) + `@standard-schema/spec` + `schemastery`(106KB) + `dsh-tools`(479KB) + `dsh-scope`(44KB) + `dsh-llm`(314KB，**带 zod 依赖**) + `dsh-util-values`(20KB) + `dsh-brand`(14KB) ≈ **1.26MB**。要 Loader/YAML patch 还得加 `cordis-plugin-loader` + `cordis-plugin-include` |
| 工程量 | **L**。要实现的 service 面：`ctx.tools`（scoped 注册表 + 5 个 waterfall 事件 + guard）、`ctx.systemPrompt`（section + tool-schema provider）、`ctx.llm`（adapter registry + StreamChunk 协议）、`ctx.skills`（provider registry + 唯一胜出者语义）、`ctx.sessions`（我们根本没有 append-only session log —— **这条做不到，做了就是重写引擎**） |
| 安全 | **最差**。插件代码跑在 `apps/api` 进程内，能拿到 `process.env`（`DATABASE_URL`/LLM key）、能 `import` 任意 workspace 包直连 PG、能绕过所有租户围栏。dsh 自己 `SAFETY.md:9` 就说这是已知风险，但 dsh 是单机开发者工具，我们是多租户服务端 |
| 桌面端 | 无帮助（UI 插件仍不兼容） |
| 维护成本 | **最高**。dsh 0.1.x 在破坏兼容（16 个版本），我们要跟着它的 service 接口改；且 `dist-tags.latest` 被钉死，选版本本身就是持续判断 |
| 结论 | **否决**。这正是 R24-H「别借 1」说的路，而且安全上对多租户服务端不可接受 |

## 4.2 方案 B：自定义 `@workhub/plugin-sdk` + dsh 适配壳

**做法**：定义我们自己的插件 API，另出一个「dsh 适配壳」把 dsh 插件的常见贡献（tool / provider / prompt / skill）翻译过来，不承诺 100% 兼容。

| 维度 | 评估 |
|---|---|
| 兼容度 | 中（可兼容切片见 2.2，约 25-35%）。但**每一条兼容都是我们写的翻译，行为可控可测** |
| 工程量 | **M**（阶段化后每阶段 S-M） |
| 安全 | 取决于宿主进程位置。**放在 `apps/api` 内 = 和方案 A 一样差** |
| 桌面端 | 面板可通过 `WorkbenchSidePanelContent` 的 `{ownerId, html}` 契约承接只读展示 |
| 维护成本 | 中。dsh 破坏性变更只影响适配壳这一层，主仓不动 |
| 结论 | **方向对，但必须补一条「宿主出进程」** → 演化成 B' |

## 4.3 方案 B'（推荐）：适配壳 + 子进程插件宿主

**做法**：

```
apps/api（主进程，有 PG/Redis/key/租户围栏）
  └─ PluginHostClient（RPC 客户端，超时/熔断/审计）
        │  newline-delimited JSON-RPC over stdio
        ▼
  workers/plugin-host（独立进程，无 DB 连接、无 LLM key、无 workspace 身份）
        └─ 最小 Cordis Context
             ├─ ctx.tools    ← 我们实现的 service（收集 defineTool 产物）
             ├─ ctx.systemPrompt ← 收集 section
             ├─ ctx.llm      ← 收集 adapter（阶段 2）
             ├─ ctx.skills   ← 收集 provider（阶段 2）
             └─ ctx.plugin(dshPluginModule, config)   ← 第三方代码在这里跑
```

- 子进程用 macOS Seatbelt / Linux bwrap 包裹（复用 R24-H 的 B8 沙箱线），`sandboxEnv` 只给白名单 env，**绝不透传 `DATABASE_URL` / `LLM_API_KEY` / `REDIS_URL`**。
- 插件工具的执行请求由主进程发起，**结果回来后仍然过主进程的 `canUse` + 快照门 + `human-reserved-guard` + 审批**——即插件宿主只提供「能力实现」，不提供「授权」。
- 这个形状**dsh 自己就在用**：Python SDK 就是 newline-delimited JSON-RPC over stdio 驱动一个 `dsh --profile sdk` 子进程（`python/sdk/src/deepseek_harness/client.py:25-37`）。我们只是把角色对调。

| 维度 | 评估 |
|---|---|
| 兼容度 | 与方案 B 相同（25-35%），但 **tool 类插件可以做到接近原样**（因为宿主里跑的是真 Cordis + 真 `defineTool`） |
| 工程量 | **M（阶段 0 是 S）**：阶段 0 只要 stdio JSON-RPC + 一个 `ctx.tools` service + 一个翻译器 |
| 安全 | **可接受**：崩溃隔离（子进程挂了主进程不受影响）、内存/CPU 上限、无凭据、可沙箱、每次调用落审计。仍需在 SAFETY.md 里写明「第三方插件代码不是安全边界」 |
| 桌面端 | 插件 UI 走 `{ownerId, html}` 只读面板（sanitize 后）；Spotlight **不开放** |
| 维护成本 | **可控**：dsh 破坏性变更只砸在 `workers/plugin-host` 这一个包上，主仓与 `packages/tools` 契约不变 |
| 结论 | **推荐** |

## 4.4 方案 C：只做「插件即工具包」的最小版本

**做法**：加载 npm 包 / 本地目录里的工具定义（JSON schema + handler），走现有 `canUse`/沙箱/审批，不碰 Cordis。

| 维度 | 评估 |
|---|---|
| 兼容度 | **对 dsh 生态 ≈ 0**——因为 dsh 插件的入口是 `apply(ctx)` 而不是导出一个工具数组；不装 Cordis 就没有 `ctx`。这个方案实际上是「我们自己的插件格式」，用户拿现成 dsh 插件装不上 |
| 工程量 | S |
| 安全 | 同 B'（取决于是否出进程） |
| 结论 | **单独不够**，但它是 B' 的**内层契约**：B' 的翻译器最终产出的就是 C 描述的东西。把 C 当作 `@workhub/plugin-sdk` 的原生格式，把 dsh 适配壳叠在它上面 |

## 4.5 关于 MCP：被忽略的第三条路（建议并行推进）

`packages/mcp/mcp-client`（1149 行）证明：**dsh 自己接入外部工具生态的方式就是 MCP 桥**——一个普通插件，把 MCP server 的工具注册成 `mcp__<serverName>__<rawName>`。

WorkHub **零 MCP**（第 3.14 条）。这意味着：

- 我们现在既够不着 dsh 生态，也够不着比它大得多的 MCP 生态。
- 一个 MCP 客户端的安全模型**天然优于插件**：MCP server 是**独立进程 + 明确 wire 协议**，我们只交换 JSON，不加载对方代码。stdio transport 的 `env` 是显式给的（`mcp-client/src/index.ts:63-64` `env: Record<string,string>`，注释写明「merged on top of scrubbed ambient env」）。
- 用户说的「大家用自己的插件」，**MCP 很可能覆盖更大比例的真实诉求，且成本更低、风险更小**。

**建议**：MCP 客户端与 dsh 兼容层**并行立项**，且 MCP 优先级不低于 dsh 兼容层。二者共用同一套「外部工具接入」的治理面（安装页、能力声明、审批、审计）。

---

# 5. 推荐路线（阶段 0/1/2）

## 阶段 0 —— 「一个真的 dsh 工具型插件被 Cuu 调用到」（S，一周内，sonnet 施工 + opus 定契约）

**可交付物**：`pnpm qa:plugin-smoke` 跑通——装 `dsh-plugin-finance-data`，Cuu 在一次 agent run 里调用 `finance_data`，结果进 trace，调用落 `audit_logs`。

要动的文件与新建物：

| 动作 | 路径 | 量 |
|---|---|---|
| 新建包 | `packages/plugin-host/`（`package.json` + `src/`）：最小 Cordis Context、`ctx.tools` service（只实现 `register`）、`ctx.systemPrompt` service（只实现 section 收集）、stdio JSON-RPC server | ~600 行 |
| 新建 | `packages/plugin-host/src/translate.ts`：dsh `ToolDefinition` → WorkHub `ToolSpec`（parameters JSON Schema 直通、`output.render` → `content`、`sideEffect` 从清单读、`promptSnippet` 从 `description` 首句取） | ~200 行 |
| 新建 | `apps/api/src/services/plugin-host-client.ts`：spawn 子进程、握手、超时、熔断、崩溃重启（有上限）、每次调用落审计 | ~350 行 |
| **改** | `packages/tools/src/types.ts:80` —— `ToolSpec` 加 `jsonSchema?: Record<string,unknown>` 旁路（dsh 工具没有 Zod） | 1 字段 |
| **改** | `packages/tools/src/registry.ts:22-30` —— `modelInputSchema()` 优先用 `spec.jsonSchema` | 3 行 |
| **改** | `apps/api/src/workers/agent-runner.ts:688-693` —— `defaultToolRegistryFor` 接受 `extraSpecs: AnyToolSpec[]` | ~10 行 |
| **改** | `apps/api/src/workers/agent-runner.ts:1745` —— 装配处把插件 specs 并进去 | ~5 行 |
| 新建 | `apps/api/src/qa/plugin-host-smoke.ts` + 挂 `pnpm lint` | ~200 行 |
| 新建 | `.agents/notes/proposed/2026-09-05-dsh-plugin-compat-layer.md`（Problem/Decision/Alternatives/Consequences 四段，记录「不全量 Cordis 化 + 宿主出进程」的取舍） | — |

**阶段 0 硬约束（写进 Note）**：
- 子进程 env 白名单：只给 `PATH`/`HOME`/`LANG` + 插件自己声明的配置；**明令禁止透传 `DATABASE_URL`/`REDIS_URL`/任何 `*_API_KEY`**。
- 插件工具一律先按 `sideEffect: "external_effect"` 对待（最保守），除非清单显式声明更低——**默认拒绝比默认放行安全**。
- 插件工具**不进 `human-reserved-guard` 的分词猜测**，改成读清单的 capability 声明（3.13 的漏判风险）。
- 只支持**本地路径**安装（`file:./path`），不开 npm/git —— 网络安装留到阶段 1 配审批。

## 阶段 1 —— 「装得进来、管得住」（M，opus 定治理契约 + sonnet 施工）

- 插件清单契约 `packages/contracts/src/domain/plugin.ts`：`{id, source, version, capabilities[], tools[], status, installedBy, approvedBy, approvedAt}`。
- DB 迁移：`plugins` + `plugin_capabilities` 表（迁移必须 replay-safe，`CONTRIBUTING.md:63`）。
- 安装源扩到 npm 包名 / tarball；**git 源默认禁用**（因为 `prepare` 脚本 = 安装期任意代码执行，`docs/user/develop/basic/publish.md:173`）。
- 提示词通道打通：把 `promptReference()` 从 `defaultToolRegistryFor` 里解耦，让 `AgentRunToolsProvider` 也能贡献 snippets/guidelines（修 `agent-runner.ts:1798-1804` 那条已知代价）。**这一步改模型可见文本，必须排在 R24-H 的 B1（提示词 golden）之后。**
- 技能类插件接入：接上 `listLayeredSkills`（`packages/tools/src/skills.ts:156-174` 的死代码），把插件包里的 `SKILL.md` 映射进 `project` 层。**这条几乎零风险，可以和阶段 0 并行发车。**
- 桌面端设置页「插件」：列表 / 启用停用 / 能力声明展示 / 审批入口。走 `WorkbenchSidePanelContent`，不动 Spotlight 三处硬编码。
- 与之并行：MCP 客户端（4.5）。

## 阶段 2 —— 「provider / 面板 / 周期任务」（M-L）

- provider 类插件：`packages/config/src/providers.ts:46-56` 的字面量改成「基线 + 插件合并」；`transportFactory` 按 name 分派（`packages/agent/src/providers/registry.ts:61`）。
- 插件周期任务挂 `PulseScheduler.register()`（`apps/api/src/workers/pulse-scheduler.ts:36-41`），带预算上限。
- 插件只读面板：`{ownerId:"plugin:<id>", html}` + sanitize + CSP。
- **明确不做**：Spotlight 能力注册、web 新路由、session 投影、UI/Theme 类插件。写进 Note 的 Consequences。

---

# 6. 安装与治理体验草案

## 6.1 安装流

设置页 → 插件 → 添加：

1. **来源**：本地路径（阶段 0）/ npm 包名（阶段 1）/ tarball（阶段 1）/ git url（**默认禁用**，开启需管理员二次确认并展示 dsh 那句原文：安装期执行代码不在任何沙箱内）。
2. **静态体检**（不执行代码）：读 `package.json` —— 有没有 `dsh.bundle.patch`？peerDeps 要求的 `@deepseek-ai/*` 版本我们宿主给不给得起？license 是什么？有没有 `prepare`/`postinstall` 脚本（有就红牌）。
3. **能力声明展示**：从 patch + 我们的静态扫描推导，列成人话（「这个插件会：注册 3 个工具 / 访问网络 / 读写工作区文件」）。
4. **管理员审批**：走既有 `createApproval({kind:"tool", actionPattern:"plugin:install:<id>"})`（`apps/api/src/services/approvals.ts:715`）。非管理员只能提请求。
5. **启用/停用**：停用即 `status="disabled"`，宿主 dispose 该插件的 fiber（Cordis 的 dispose 语义天然支持），工具从注册表消失。

## 6.2 权限模型草案（声明式 capabilities）

复活 `ToolSpec.minScope`（`packages/tools/src/types.ts:82`，现为零消费者的死字段）作为 capability 键：

| capability | 含义 | 默认 | 审批 |
|---|---|---|---|
| `net.fetch` | 出网 | 拒 | 管理员一次性批，落 allow 策略 |
| `fs.workspace.read` | 读 run workdir | 允 | 无 |
| `fs.workspace.write` | 写 run workdir | 拒 | 走既有快照门 + 审批 |
| `fs.host` | 读写 workdir 之外 | **永久拒绝**（宿主沙箱层面封死） | — |
| `proc.spawn` | 起子进程 | 拒 | 管理员 |
| `data.read.<entity>` | 读 WorkHub 业务数据 | 拒 | 管理员 + 逐 entity |
| `data.write.<entity>` | 写业务数据 | 拒 | 管理员 + 每次调用审批 |
| `secret.<name>` | 读某个配置密钥 | 拒 | 管理员，只注入到子进程该插件的 config |

`actionPattern` 拼法：`plugin:<pluginId>:<capability>`，直接喂 `packages/permissions` 的 glob 匹配（`evaluate.ts:119-177`，`deny` 优先级 ≥1000 是穿透一切的 kill-switch —— 天然支持「一键封禁某插件」）。

## 6.3 审计

每次插件工具调用落一条：`entityType:"plugin_invocation"`, `entityId:"<pluginId>:<toolId>"`, `action:"invoke"`, `detailJson:{args摘要, durationMs, ok, capabilities用到的}`。副作用调用复用 `createSnapshotWithAudit`（`packages/db/src/repositories/audit.ts:37-53`）的原子事务。

## 6.4 崩溃隔离

- 子进程崩溃 → 主进程收 `exit` → 当前 in-flight 调用返回 `errorToolResult("插件宿主已重启，这次调用没完成")`，**不让 agent run 崩**。
- 重启上限（如 5 分钟 3 次），超限把该插件标 `status="crashed"` 并发通知。
- 单次调用超时（默认 30s，可按插件配）+ 内存上限。
- 一个插件的错误不能影响其他插件：Cordis 的 fiber 错误隔离天然给这条，但 **RPC 层要按 pluginId 分账**。

---

# 7. 许可与署名

## 7.1 事实

- dsh：MIT，`Copyright (c) 2026 DeepSeek`。`@deepseek-ai/cordis` / `schemastery` / `dsh-tools` / `dsh-scope` / `dsh-llm` / `dsh-util-values` / `dsh-brand` / `cosmokit` **npm 上全部 MIT**。
- WorkHub：**PolyForm Noncommercial 1.0.0**（`LICENSE:1`，source-available，非 OSI，仅非商业）。
- WorkHub 已有 `THIRD_PARTY_NOTICES.md`（生成式，`scripts/dev/gen-third-party-notices.ts`，`pnpm audit:third-party-notices --check` 守字节一致）和 `AGENTS.md`（R24-H 的 B9/B3 已落）。**仍无 `SAFETY.md`**。

## 7.2 需要做的

1. **依赖 `@deepseek-ai/*` 属于 runtime npm dep，不是 vendor**：生成器会自动把它们列进 `THIRD_PARTY_NOTICES.md` 的 MIT 档 —— 加依赖后跑一次 `pnpm gen:third-party-notices` 即可，无需手写。
2. **若移植 dsh 代码**（例如照抄 `defineTool` 的 `parameterSchemaSpecToJsonSchema` 逻辑，或 `mcp-client` 的名字空间规则）：文件顶部加 MIT 归属块，格式照 `packages/agent/src/loop2/NOTICE.md` 的先例（记上游 repo + commit + 逐条本地改动），并在 `THIRD_PARTY_NOTICES.md` 的 vendored source 档登记。**只借思想/格式（清单字段名、目录约定、治理措辞）不需要署名，但应在 Agent Note 里注明出处。**
3. **PolyForm NC 与插件生态的边界**（要在文档里写清，这是用户最容易踩的坑）：
   - PolyForm NC 约束的是**我们的软件**（WorkHub 本体）。第三方插件是**独立作品**，作者用什么许可是他们的自由（MIT/GPL/商业闭源都行）。
   - **但 GPL 插件是个真问题**：如果插件在我们进程内被动态链接，GPL 的传染性有争议。**方案 B' 的子进程 + JSON-RPC 边界正好把这个问题解掉**——进程分离 + 明确 wire 协议是 FSF 自己也承认的较弱耦合形态。这是选 B' 的第四个理由。
   - 我们**不能**在 `THIRD_PARTY_NOTICES.md` 里替用户安装的插件做许可声明（我们不分发它们）。安装页要展示插件自报的 license，并说明「插件由第三方提供，其许可与 WorkHub 无关」。
   - **商标**：dsh 有 `BRAND_GUIDELINES.md`（12 行商标使用政策），我们**没有**。我们要在文案里说「兼容 DeepSeek Harness 插件」而不能暗示官方背书；同时我们自己也该补一份（R24-H 已把它归进 B9 合规小包）。

---

# 8. 三个最大风险

## 风险 1（最高）—— 「支持插件」这四个字会被理解成 100%，但真实兼容面只有约 25-35%

3158 个精选插件里最大的两类（UI Enhancements 519 + Themes 112，合计 20%）走的是浏览器侧第二个 Cordis Context + React + CSS Modules + `ctx.slots.register`（`packages/client/ui-settings-plugin-inventory/src/client/index.ts:29-57`），WorkHub 全仓零 `.tsx`、桌面端是字符串模板 DOM，**永远兼容不了**。Sessions & Messages（198）、Usage & Billing（176）绑 dsh 的 session log 与计量，同样不行。

用户装了三个插件有两个装不上，比根本不支持更伤。

**缓解**：安装页做**静态体检 + 兼容度预判**（读 `package.json` 的 `dsh.client` 字段就能判断是不是 UI 插件，直接给出「这个插件是 Web UI 扩展，WorkHub 桌面端不支持」的明确答复而不是失败）。文案统一口径：「兼容 DeepSeek Harness 的**工具/技能/模型 provider** 类插件」，不说「支持 dsh 插件」。

## 风险 2 —— 安全模型：第三方代码 + 多租户服务端

dsh 是单机开发者工具，`SAFETY.md:9` 明说插件可以「damage the host computer, modify or delete files, disclose data or credentials」，awesome 列表说「Tool approvals don't sandbox plugin code」。WorkHub 是**多租户**（`workspace_id` 围栏遍布 DB 层），`apps/api` 进程里有 PG/Redis/LLM key。

而且我们的沙箱**本来就是软的**：`packages/tools/src/sandbox.ts:138-154` 的 `sandboxEnv` 原样透传宿主 `PATH`，注释自己写明「不是安全边界」；`docs/workhub/01-architecture/security-and-permissions.md:46-53` 把「沙箱出口未封锁」列为已接受残余风险 R2。**在这个基线上加载第三方 JS = 把已知残余风险乘以插件数量。**

另有两个具体漏点：
- `human-reserved-guard` 的高危分类是**基于 toolId 字符串分词的猜测**（`services/human-reserved-guard.ts:105-140`），插件工具名（`mcp__x__transfer`、`finance_data`）不在词表词汇里，**必然漏判**。
- git 源安装的 `prepare` 脚本是**安装期任意代码执行，在任何沙箱之外**。

**缓解**：宿主必须出进程 + env 白名单 + Seatbelt/bwrap 包裹（和 R24-H 的 B8 打包做）；插件工具默认 `external_effect`；capability 声明式而非猜测；git 源默认关闭；**先写 `SAFETY.md`**（我们至今没有，而仓库是 PUBLIC 的），把插件风险写进去。

## 风险 3 —— dsh 0.1.x 的破坏性变更节奏，我们跟不动

`@deepseek-ai/dsh-tools` 已发 16 个版本（`0.0.1-rc.1` → `0.1.2-rc.1`），`dist-tags.latest` 被**故意钉死在 `0.0.1-rc.1`**，插件在 pin `^0.1.0-rc.6`。dsh 的 `vendor/README.md` 记了 **19 条**对 Cordis 的本地修改，其中多条是 fiber 生命周期与 Loader 事务化的实质改动 —— **上游 npm `cordis@4.0.0-rc.9` 不含这些**，只能用 `@deepseek-ai/cordis`。dsh 自己 `CONTRIBUTING.md:9` 说「still at an early stage」且**不接受外部 PR**，我们对上游没有任何影响力。

选定的宿主版本一旦落后，新插件装不上；跟进版本又可能把已装插件搞挂。

**缓解**：把 dsh 依赖**全部关在 `packages/plugin-host` 一个包里**（主仓与 `packages/tools` 契约不变），宿主版本作为可配置项、允许并存两个基线；每次升版跑一遍「已装插件回归」冒烟；在插件清单里记录「本插件在哪个宿主基线上验证过」。**这是选方案 B' 而不是 A 的最强理由——A 把 dsh 的版本节奏焊进 `apps/api`。**

---

## 附：本次侦察更正的三个假设

1. **「cordis 只在 dsh 里 vendor」不成立**：`@deepseek-ai/cordis@4.0.2` 已发 npm（233KB，MIT），`schemastery`/`dsh-tools`/`dsh-scope`/`dsh-llm` 等全部已发。但**上游 `cordis` 不等于 `@deepseek-ai/cordis`**（19 条本地修改，包括 fiber 生命周期加固）。
2. **「`@deepseek-ai/dsh-tools` 的 9 个 peer 全要装」不成立**：`packages/core/tools/src/index.ts:13-20` 里 `dsh-agent`/`dsh-session`/`dsh-system-prompt`/`dsh-code-runtime`/`dsh-user-approval` 全是 `import type`，运行时不加载。真实闭包 9 个包 ~1.26MB。
3. **「dsh 生态 = 13629 个插件」不可信**：GitHub topic 搜索混进大量蹭 topic 的项目（简历生成器、图床）。可信口径是策展列表的 **3158** 个，且收录门槛是「声明 `dsh.bundle` 且能被 `dsh plugin add` 装上」。

**另有一条 dsh 教不了我们的**：dsh 对插件**零隔离、零权限模型、零审计**——它的答案是 `SAFETY.md` 免责 + 「安装前自己看源码」。我们是多租户服务端，这条必须自己造，没有可抄的。反过来，我们的审批/权限/审计链（`packages/permissions` + `services/approvals.ts` + `audit_logs`）**比 dsh 完整得多**，正好是插件治理的现成地基。
