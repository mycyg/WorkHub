# R24-H 侦察：deepseek-harness 狠借清单

- 侦察对象：`/Users/apple/Desktop/开发项目/WorkHub/reference/deepseek-harness`（dsh-0.1.3-alpha.1，MIT，master @ `d347e70390`）
- 对照本仓：`/Users/apple/Desktop/开发项目/WorkHub`（main-integration @ 9f105dc0）
- 纪律：全程只读，两个仓库均未改动、未安装、未起服务
- 已读并尊重：`.agents/notes/rejected/2026-08-19-no-display-layer-copy-regex.md`（展示层 replaceAll 洗术语 = 已否决，本报告不再提该修法；B5 走的是它自己写下的「采纳方向」）

## 一句话结论

dsh 在**「让 AI 改动可被机械验证」**这条线上远超我们（无钥回放快照、提示词 golden、AST 文案门禁、658 篇分类 Agent Note、142 个 gen/verify 脚本）；
我们在**「钱和人」**这条线上超过它（预算四道闸、审批/升级/委派/审计全链、记忆晋升证据门——这些 dsh 一个都没有）。
所以借的重点不是它的架构，是它的**验证纪律**。

---

## Top 12 狠借项总表

| ID | 主题 | 一句话 | 杠杆 | 量 | 模型 | 借法 |
|---|---|---|---|---|---|---|
| B1 | 评测 | 把组装好的系统提示词 + 工具 schema 落成 `expected` golden，改一个字就出 diff | 高 | S | sonnet | 借思想 |
| B2 | 评测 | 无钥录制回放：真 key 录一次会话，此后永久免费重放整条链路 | 高 | L | opus 设计 / sonnet 施工 | 借思想 + 抄 `snapshot.yml` 格式 |
| B3 | 工程 | 补根 `AGENTS.md`（`CLAUDE.md` 软链），常驻规约每条 1-3 行 + 字数天花板 | 高 | S | sonnet | 借思想 |
| B4 | 工程 | lefthook 预提交：白空格 / 脏路径 / 术语 / 生成物「重生成而非拒绝」 | 高 | S | sonnet | 可近抄 `lefthook.yml` |
| B5 | 工程/i18n | UI 文案 locale 独占 + AST 门禁；顺手把禁词门从 5 个文件补到全量覆盖 | 高 | M | sonnet | 借代码（`verify-client-ui-i18n.ts` 可移植） |
| B6 | Agent 循环 | 重复工具调用先劝 3/5/8 次再断，别一撞上就升级给人 | 高 | S | sonnet | 借代码（MIT，~233 行） |
| B7 | 记忆技能 | 聊天轮次把技能目录发全量（现在只发按 `skill_key` 排序的前 5 个） | 高 | S | sonnet | 借思想 |
| B8 | 安全 | 命令沙箱 fail-closed + macOS Seatbelt argv 包裹，替掉「透传 PATH 的软沙箱」 | 高 | M | sonnet | 借思想 + 抄 argv 包裹契约 |
| B9 | 许可 | `THIRD_PARTY_NOTICES` 生成器 + 17 个 `package.json` 补 `license` 字段 | 中高 | S | sonnet | 借代码（`gen-third-party-notices.ts`） |
| B10 | Agent 循环 | 两段式压缩：先免费剪工具结果，再花钱摘要；超大结果落盘可检索 | 中 | M | sonnet | 借思想 |
| B11 | 工程/文档 | Agent Note 升级：`{lifecycle}/{class}/` 分层 + 冻结归档 + 反重开检查 | 中 | S | sonnet | 借思想 |
| B12 | 产品面 | 工具卡「渲染意图联合」：纯函数 presenter，可回放，不侵染模型可见文本 | 中 | M | sonnet | 借思想 |

---

# 逐主题详述

## 1. 架构：everything-is-a-plugin

### 它怎么做

- **无特权内核。**`reference/deepseek-harness/docs/architecture.md:11-13`：模型适配器、工具注册表、会话日志、**连 agent loop 本身**都是插件，全部可从配置替换；扩展 = 在旁边挂一个插件，不是打补丁。
- **profile / bundle 两层组合。**`docs/architecture.md:17-29`：profile 是命名组合（`web`/`headless`/`sdk`/`sdk-minimal`/`acp`），bundle 是可分发的配置行 + 代码。层序 = 各 bundle → profile patch → home patch → `--patch` 覆盖；patch 按 `id` **整体替换**目标行的 `config`，不做合并（`packages/bundle/base/cordis.patch.yml:6-8` 明确说明为什么不合并）。
- **注册即效果。**`reference/deepseek-harness/AGENTS.md:105`：每个贡献走 `ctx.effect()` / `ctx.on()`，注册表的 `register()` 返回 disposer；插件卸载时注册自动回滚。`packages/AGENTS.md:17` 要求每个注册表都有一条 HMR 安全测试（dispose fiber，断言移除）。
- **能力缝 = 三角色。**`docs/architecture.md:117`：Service Definition / Service Provider / Consumer，缺一不成缝。`AGENTS.md:112` 补了纪律：只有当角色会独立演化时才拆。
- **「新行为进插件，不进 loop」。**`AGENTS.md:111`：改 `agent-loop` 必须同步改 `docs/architecture.md`；`docs/architecture.md:127-149` 给了一张 22 行的「你想干 X → 挂在哪个扩展点」表。
- **包边界有机器门禁**：`verify-package-dependencies` / `verify-module-graph` / `verify-client-domain-graph` / `verify-application-entrypoints`（`package.json` scripts）。最后一条把每个 `bin`、可执行源、根 demo 归入显式分类，拒绝绕过 `dsh` CLI 的新应用入口。

### 我们现在怎么做

- 13 个 `packages/*`（`packages/contracts` 25406 行、`packages/db` 44765 行、`packages/agent` 16389 行、`packages/ui` 22367 行）+ 3 个 `apps/*`。
- 依赖图基本是干净的 DAG：`@workhub/contracts` / `@workhub/tools` / `@workhub/config` 零依赖，`@workhub/api` 是唯一的汇聚点。两条看着可疑的边（`@workhub/ui → @workhub/agent`、`@workhub/web → @workhub/db`）实测只出现在 `*.test.ts` 里（`packages/ui/src/gold-path/route-components.test.ts:4` 等 7 处 import `@workhub/agent/fixtures`），是 devDependency，不是运行时穿透。
- **但没有任何门禁守着这张图。** 根 `package.json` 里没有一个 `verify-*` 或 `gen-*` 脚本（只有 `db:generate` 和 5 个 `audit:*`）。
- 真正的问题不在 `packages/`，在 `apps/api`：**162284 行、113 个 service、67 个 route、16 个 worker，全在一层平铺**；100+ 个 `*.test.ts` 直接摊在 `apps/api/src/` 根目录。最大单文件 `apps/api/src/openapi.ts` **10252 行手写 OpenAPI**，`apps/api/src/workers/agent-runner.ts` 3138 行。

### 差距

不是「没有插件系统」，是**没有边界的守卫**。dsh 用 142 个脚本把每条结构约束变成红灯；我们的结构约束只存在于 `scripts/dev/check-target-paths.ts`（100+ 条必须存在的路径，只防删不防加）。

### 值不值得借

**思想值，框架不值。** 见文末「别借 1」。

### 怎么借

不引 Cordis。落三条可执行的：

1. **依赖方向门禁**（S）：写 `scripts/dev/check-package-graph.ts`，从各 `package.json` 读 `@workhub/*` 边，断言无环 + 断言 `apps/web`/`apps/desktop-webview` 的 **runtime** deps 不含 `@workhub/db`/`@workhub/agent`。挂进 `pnpm lint`。
2. **`apps/api` 分域**（L，先不做）：113 个 service 至少按 `docs/architecture.md:127` 那张表的思路，先出一份「新行为该落在哪」的映射表放进 B3 的根 AGENTS.md，比先动代码有用。
3. **借两条评审规则**（0 成本，进 B3）：
   - `packages/AGENTS.md:14`「决策在做出它的那个操作里落地」——schema 省略、提示词过滤、门面、包装器、监听器顺序都不算强制，要在 executor 上测拒绝路径。我们 `packages/tools/src/registry.ts:108-110` 的双重 `canUse`（列出时查一次、执行时再查一次）正好是这条规则的正面样本，值得写进规约当范例。
   - `packages/AGENTS.md:15`「只在提交点发布状态」——派生缓存、提示词、UI 回显、回放、查询视图都从同一个权威源派生。

### 风险

低。纯加门禁 + 写文档。唯一风险是依赖图门禁一开就红（先跑 `--report` 模式看基线）。

---

## 2. Agent 循环

### 它怎么做

| 维度 | dsh |
|---|---|
| turn/step 模型 | `docs/architecture.md:76-95`：step = 一次模型请求 + 它调的工具；turn = 0..n 个 step，输入被 claim 时开，无欠债时关。整条流程画成了 18 行伪代码。 |
| 提示词组装 | `packages/core/system-prompt`：插件贡献有序 prompt section、动态 runtime context、tool-schema provider、命名变量；loop 每 step 调一次 `assemble()`。 |
| 工具协议 | `packages/core/tools/src/schema.ts:545` `defineTool`：typed 参数/输出 schema、可选 `timeoutMs`、并行安全分类、可选 UI presentation intent。 |
| 并行工具 | `packages/core/agent-loop/src/tool-calls.ts:200`：池化并发，上限 `maxParallelToolCalls`；工具自报 `executionMode`（`packages/core/tools/src/index.ts:1267-1274`，`isConcurrencySafe` 为假即 `exclusive` 屏障），**结果按模型顺序提交**（`tool-calls.ts:147-161`）。 |
| 子代理 | `packages/subagent/` 一整族：一次性 / 可续（durable session，能收后续消息、能被 interrupt）；provider 可以是进程内 fork、ACP、SDK、真的 Codex 或 Claude Code。 |
| 中断与恢复 | `packages/core/agent-loop/src/agent.ts:71` 持久 `Inbox` + `steer()`（`:138`）；step 边界 claim（`:241`）；`session-checkpoint-policy` 在模型请求前、有外部副作用的工具体前、每个 step 边界落盘，**checkpoint 写失败就 fail-closed 不让请求发出**。 |
| 预算/成本 | **没有。** `packages/` 里没有 cost 包；只有 `packages/llm/token-meter`（压力计量）和 `llm-deepseek/request-pricing.ts`（图片计价）。`docs/testing.md` 那句「We are DeepSeek — do not ration real-API tests」把态度说得很清楚。 |
| 死循环闸 | **没有硬步数上限**（全仓 grep `maxSteps`/`MAX_STEPS`/`stepLimit` 零命中）。只有三层软的：`repeat-tool-reminder`（劝）、`goal` 的 round cap 256（`packages/goal/goal/src/index.ts:244`）、`tool-call-timeout-policy`（单调用超时）。 |
| 上下文压缩 | 两段式，见下。 |

**压缩细节（关键）**：`packages/compaction/compaction-tool-result-pruner` 先把超预算的工具结果剪成 head + 「middle pruned」 + tail，**不发模型请求**，剪完压力可能就够了、摘要直接跳过；不够才由 `compaction-basic` 发一次摘要请求。阈值 `thresholdRatio 0.8`、保留尾部 `retainRatio 0.16`（`packages/compaction/compaction-basic/src/config.ts:20-23`），还有 `maxOverflowRetries`（撞 context overflow 报错后压缩再重试）。全程有 tool-pairing 守卫（`packages/compaction/compaction/src/tool-pairing.ts`）保证不把 `tool_call` 和它的 `tool_result` 切开。**原文全量留在 session log 里，回放可完整重现。**

`packages/spill/spill-policy`：超过 `maxInlineBytes` 的最终结果存进 `ctx.spillStore`，模型看到的是 head/tail 预览 + 一个 locator，模型可以自己去 `read`/`grep` 那个 spill 文件。

### 我们现在怎么做

两套引擎共一个输入契约：

- 传统 `packages/agent/src/loop/loop.ts`（1542 行），agent run 的**生产默认**（`packages/config/src/env.ts:136` `AGENT_RUN_LOOP2_MODE` 默认 `"off"`）。
- `loop2` = vendored pi（MIT，`packages/agent/src/loop2/NOTICE.md` 记了 commit `dcfe36c797` 和 6 条改造），会话轮次的生产默认（`env.ts:143` 默认 `"on"`）。
- 有 `shadow-assert` 模式同跑两套并 diff loop-core 投影（`loop2/config-builder.ts:826/861`）——这个双跑等价性检查本身是我们的原创亮点，dsh 没有。

我们**已经有而 dsh 没有**的：

- **DoomLoopDetector**（`packages/agent/src/loop/control.ts:98-130`）：SHA-256 指纹，既抓全同窗口（默认 3），也抓 A-B-A-B 周期 2 交替。
- **预算四道闸**：准入 `decideRunBudget`（`packages/cost/src/decision.ts:53-140`，超额 → HTTP 402）、原子预留防超发（`packages/cost/src/reservation.ts:72-90`，`committed + reserved_outstanding + estimate <= cap`，后端报错 fail-closed 到 503）、每 step `checkLoopBudget`（`control.ts:31-47`）、评审前再过一次闸（`loop.ts:1004-1005`）。7 种 `BudgetScope`，其中 `curation` 专门隔离夜间蒸馏花销。
- **超支不是崩，是 `escalated` + `StructuredHandoff`**（`packages/agent/src/loop/handoff.ts:29-42`：done/remaining/nextSteps/blockers/artifacts/budgetHit）。
- **租约 + fencing + 死信**：`claimedBy = workerId` 写入围栏（`agent-runner.ts:315-317`）、租约地平线自围栏 SIR-1（`:1232-1253`）、超 `maxRecoverAttempts` 死信到 `failed` 而不是无限重排（`:2474-2520`）。
- **截断工具批次的 thinking 安全处理**（`control.ts:138-144` + `loop.ts:1329-1348`）：`max_tokens` 截断导致 `tool_use.input` 退化成半截 JSON 时**一个工具都不执行**，只回错误 tool_result 让模型重发；`thinking`/`redacted_thinking` 块原样透传（`loop.ts:638-641` 注明丢弃会 400）。

我们**缺的**：

- **工具串行**。传统 loop 是硬串行（`loop.ts:1350-1364`，`for` + `await`，没有并发旋钮）。loop2 的 vendored pi 有并行能力（`loop2/vendor/agent-loop.ts:507-572`，`Promise.all` + 按调用顺序重排），但我们在 `loop2/config-builder.ts:488` 把它钉死成 `toolExecution: "sequential"`。
- **无 in-loop 恢复**。loop 永远从 `initialUserMessage` + 空历史起跑；恢复靠 worker 层重排 + workdir 复用（`agent-runner.ts:776-787`），**token 重烧**。loop2 vendored 了 `agentLoopContinue`（`vendor/agent-loop.ts:78/135`）但我们没用（`config-builder.ts:826-834` 永远传 `messages: []`）。
- **无跑中插话**。pi 的 steering / follow-up 队列（`vendor/agent-loop.ts:186-206/275-284`）是 loop2 相对传统 loop 的实质结构差异，但 agent run 还没切到 loop2。
- **无 in-context 子代理**。全仓穷举 `subagent|delegate|spawn|fanOut|agentAsTool` 在 loop 内零命中；委派是 DB 层的任务计划 DAG，一个 plan item 一个 `agent_run`（`packages/db/src/schema/core.ts:1787` `parentRunId`，调度器 `apps/api/src/services/task-dispatcher.ts:351`）。
- **工具结果只截不存**：`loop.ts:1444` `truncateForContext` 砍到 8000 字符（head 75% + tail 15%），原文丢弃，只给模型一句「去重读文件或用 run_command 提取」（`loop.ts:352-354` 注释坦白老文案说「完整内容在 trace 里」是谎话，trace 根本没存）。

### 差距

我们的循环在**「花钱/可靠性/不失控」**上明显更成熟；dsh 在**「不失控之前先给模型一次自救机会」**和**「省钱地压缩」**上更成熟。

### 值不值得借 / 怎么借

**B6（高杠杆 / S / sonnet / 借代码）——重复调用先劝再断。**

现状：DoomLoopDetector 窗口撞 3 次立刻 `escalated`（`loop.ts:1406` → `:1421-1428`），一条运行结束、一个人被叫醒。
dsh 做法（`packages/guard/repeat-tool-reminder/src/index.ts`）：在 `tools/post-execute` 观察但**绝不否决**（`:213-224` 先计数、再 `next()` 委托、最后把提醒折进下游 decision），阈值 `[3,5,8]`，第一档温和劝（`:63-67`），后续档位报出工具名 + 连续次数 + canonical 参数（`:70-79`，参数预览默认截 500 字符但**指纹永远用全串**，`:39-42`）；用户插话即重置链（`:229-232`）。参数用深度 key-sort 后 stringify 做规范化（`:89-105`），所以属性顺序不同不会漏判——**这一点我们的 SHA-256 指纹已经等价做了**（`control.ts:69-74`）。

借法：在 `packages/agent/src/loop/control.ts` 的 DoomLoopDetector 上加一层「提醒档位」——命中 3 次注入一条 plugin-source 的用户消息劝一次、5 次给详细版、8 次才走现在的 `escalated`。要动的文件：`packages/agent/src/loop/control.ts`（加档位）、`packages/agent/src/loop/loop.ts:1406-1428`（消费档位）、`loop2/config-builder.ts:566-574`（同步 `shouldStopAfterTurn`）。约 233 行 MIT 代码可直接参考逻辑，但**注入方式要改**：dsh 走 `additionalContexts` 挂在 tool decision 上，我们没有这个管道，直接往 `messages` 追加一条 user 消息即可。
风险：多烧 2 轮 step 才升级（对 `maxSteps: 15` 是 13% 预算）；必须同步改 `loop.test.ts` 里断言「撞 3 次即 escalated」的用例——**改的时候要在 PR 里说明这是行为变更，不是修 bug**（dsh `AGENTS.md:124`「测试描述行为，不描述正确性」）。

**B10（中杠杆 / M / sonnet / 借思想）——两段式压缩 + spill。**

现状：`loop.ts:1249` 命中 `compactThreshold`（默认 0.8，和 dsh 一致）后直接 `compactNow` → `tryGenerateStructuredSummary`（`loop.ts:568-632`，1500 max tokens，走单独计费的 `context_compact` 路由，`agent-runner.ts:817-827`），失败才退化到机械摘要（`loop.ts:518-548`）。**每次压缩都是一次真金白银的模型调用。**
借法两步：
1. 在 `compactNow` 之前插一道免费的「工具结果剪枝」：把历史里超预算的 `tool_result` 内容剪成 head + 标记 + tail，重算 token 压力，够了就不发摘要请求。要动 `packages/agent/src/loop/loop.ts:1207-1234`（`compactNow` 入口）。dsh 的顺序纪律值得照抄：**剪枝只在压缩触发时跑，压力线以下的会话一个字不动**。
2. spill：给 `truncateForContext`（`loop.ts:345-355`）一个落盘旁路——完整结果写进 run workdir 下的 `.spill/<n>.txt`，模型看到 head/tail + 路径，可以用已有的 `read_file` 自己去取。我们**已经有沙箱文件工具**，所以这个比 dsh 的 `SpillStore` 服务缝便宜得多，不需要新包。
风险：剪枝改的是发给模型的历史，属于「模型可见变更」，必须配 B1 的 golden 一起做，否则没人看得出改坏了。**所以 B1 必须排在 B10 前面。**

**并行工具调用**：值得借但不急。dsh 的做法是工具自报 `executionMode`，`exclusive` 的形成屏障，结果按模型顺序提交。我们 11 个内置工具里真正并行安全的只有 `list_files`/`read_file`（其余都有 `sideEffect`），收益有限；等工具集变大再说。**先在 `ToolSpec`（`packages/tools/src/types.ts:63-84`）上把 `isConcurrencySafe` 字段占好位**（S，几乎零成本），实现留后。

**in-loop 恢复**：dsh 的答案是「模型可见即已落盘」（`AGENTS.md:110`、`docs/architecture.md:111`）——任何进入模型请求的东西都必须能从 session log 重建，并有 runtime invariant 断言。我们有 `agent_run_snapshots` 但循环历史不从它派生。这是一条 L、动 `packages/agent` 最热文件的改造，**本轮不排**，但值得写一篇 proposed Agent Note 占坑。

---

## 3. 记忆与技能

### 它怎么做

- **没有第一方长期记忆。** `packages/` 无 `mem*` 包；记忆是外挂 MCP（`apps/cli/config/examples/mcp-memory/` 给了 engram / memorix / `@modelcontextprotocol/server-memory` 三份配置）。
- **有的是 `agent-instructions`**（`packages/context/agent-instructions`）：加载 `AGENTS.md` 兼容的工作区指令文件，用户全局文件 + 项目链在首次请求前作为一份持久基线；之后 `read`/`write`/`edit` 成功会把新相关的嵌套文件、变更、删除带进后续请求。**全程受字节预算约束：宁可整份省略更宽的文件，也不截断最具体的那份。**
- **技能 = provider registry + 目录 + loader 工具**：
  - `packages/skill/skill` 是注册表，合并多 provider 目录，**每个 name 有唯一胜出者**；registry 分层（host + per-scope），最近层直接胜出，同层内按 rank / provider 顺序 / local 顺序（`docs/subsystems/skills.md`「Provider registry」段）。
  - `packages/skill/skill-filesystem`：项目 / 自定义 / 用户三个根，`SKILL.md` 目录包或扁平 `<name>.md`，**watch 目录，新增/改名/删除不重启即达**。
  - `packages/skill/tool-skill`：**首次请求前就把全量目录（name + 截断后的 description）作为一条 durable 事件发给模型**；成员/描述/可见性变化 → 追加一份**完整替换目录**；被删的技能**显式退休**。模型用 `skill` 工具按名加载全文；用户可用 `/name` 直接注入。唯一配置是目录 description 的字数上限。

### 我们现在怎么做

三层记忆 + 两层技能：

| 层 | 存储 | 作用域 | 注入点 |
|---|---|---|---|
| L1 agent memory | `agent_memory` | workspace × **task_plan_item** | `apps/api/src/workers/agent-runner.ts:1739` → `:1789` → `:915` |
| L2 user memory | `user_memories` | user × workspace（`workspace_id IS NULL` 即全局） | `agent-runner.ts:916`；轮次 `conversation-turns.ts:1088` |
| team skills | `team_skills` | workspace | `agent-runner.ts:836/1741/1744`；轮次 `:1089` |
| bundled skills | `packages/tools/skills/*/SKILL.md` | 进程全局 | `agent-runner.ts:836` |

**我们有而 dsh 没有的（不要为了对齐它而砍掉）**：

- **L1→L2 晋升的证据门**：`apps/api/src/services/agent-memory.ts:441-447` 要求 ≥2 条候选来自 ≥2 个不同 `source_run_id`，否则 `discarded / insufficient_evidence`；注释明说这是防单次运行的 LLM 编造高置信度写入。晋升还要过 LLM 裁判 + `confidence >= 0.8`（`:495`）+ 冲突落 `memory_conflicts` 表（`:464-488`）。
- **不编造记忆的教训已经吃过**：`agent-memory.ts:271-274` 记录了旧实现会从运行统计里编出「用户偏好简洁执行」，已删；现在 L1 只记锚定在真实产出上的观察（review grade ≥4、manifest 标题）。
- **注入前全量做提示词注入中和**：`neutralizeFenceTags` 覆盖每一处（`agent-memory.ts:245`、`user-memory.ts:28`、`turns/prompt.ts:114/300/329`），且**故意不发明新围栏标签**（`prompt.ts:100-105`）。
- **技能蒸馏的自验闸**：`services/skill-curation.ts:108-136`（`sample_count>=5`、`confidence>=0.7`、frontmatter 合法、≤8000 字符、去重、**注入话术正则筛查** `:78-95`）+ K2 受限编辑补丁的乐观 `base_version`（`:318-356`）+ 预算退火（`agent-skill-curation.ts:297`，超预算的合格候选是**延后**不是拒绝）。

**缺口三条**：

1. **聊天轮次只发前 5 个技能，且排序无意义。** `apps/api/src/services/conversation-turns.ts:1091` 按 `TURN_TEAM_SKILL_TOP_N = 5`（`:137`）切片，来源是 `teamSkills.listActive(workspaceId)` 的默认顺序（`skill_key`），**没有任何相关性排序**。而 `MAX_ACTIVE_PER_WORKSPACE = 50`（`packages/contracts/src/domain/team-skill.ts`）——**最多 45 个技能在聊天里永远不可见**。worker run 那条路径反倒是发全量的（`agent-runner.ts:836-838`）。
2. **分层技能发现是死代码。** `.agents/notes/implemented/2026-08-19-layered-skill-discovery.md` 标记 implemented，`packages/tools/src/skills.ts:153-174` 的 `listLayeredSkills` 也确实写好了、有测试（`skills-layered.test.ts`），但**全仓 grep `listLayeredSkills|resolveSkillLayers|WORKHUB_SKILLS_PROJECT_DIR` 只命中它自己和它的测试**。生产四个调用点全走单根：`agent-runner.ts:690`（`createSkillTool(undefined, …)`）、`agent-runner.ts:836`、`services/team-skill-context.ts:47`、`workers/agent-skill-curation.ts:621`。那篇 Note 自己在 Consequences 里承认了（`:42-44`）。
3. **技能目录不是 durable 事件，没有退休语义。** 每次组 prompt 现算，模型无法从会话历史里知道「上次可用的技能集是什么」。

### 差距

我们的**准入质量**（证据门、注入中和、自验闸）比 dsh 严；**分发**比 dsh 差一截。

### 值不值得借 / 怎么借

**B7（高杠杆 / S / sonnet / 借思想）——技能目录发全量 + 显式退休。**

要动的文件：
- `apps/api/src/services/conversation-turns.ts:1091` —— 把 `slice(0, 5)` 换成「发全量 name + `when_to_use`（description 截断到 N 字符）」。dsh 的成本控制手段是**截断 description 而不是截断目录**（`packages/skill/tool-skill` 唯一配置就是这个字数上限），50 个技能 × ~40 字 ≈ 2000 字符，完全可接受。
- `packages/agent/src/turns/prompt.ts:128-136`（`buildTurnMemorySection`）—— 目录渲染，同时保留 `neutralizeFenceTags`。
- 顺手把 `packages/contracts/src/domain/team-skill.ts` 里的 `TURN_TEAM_SKILL_TOP_N` 换成 `TURN_TEAM_SKILL_DESCRIPTION_CHARS`。

风险：轮次提示词变长，直接影响成本 —— **所以必须先有 B1 的提示词 golden**，让这个 diff 可见可评审。

**顺带（S，可并入 B7）——把分层技能发现接上或撤掉。** 两条路二选一，别让它继续躺着：
- 接上：`agent-runner.ts:690` 的 `createSkillTool` 第一参从 `undefined` 改成 `LayeredSkillOptions`，`:836` 的 `skillCatalogForPrompt` 同改。
- 撤掉：删 `skills.ts:96-174` 和 `skills-layered.test.ts`，把那篇 Note 移到 `archived/`。
我倾向接上——项目级 `.workhub/skills/` 对「AI 项目经理」这个产品是真需求（每个项目有自己的交付规范）。

**不借的**：dsh 的 MCP 外挂记忆路线。我们的三层记忆 + 晋升证据门是产品差异化资产，换成 MCP server 是净损失。

---

## 4. 评测与质量

### 它怎么做

**五层测试（`docs/testing.md`）**：

| 层 | 命令 | 是什么 |
|---|---|---|
| Unit | `pnpm run test` | vitest，测试**放在包内 `tests/`**，每个注册表配一条 HMR 安全测试 |
| Coverage gate | `pnpm run test:coverage` | `packages/*/*/src` **逐文件 100% 行覆盖** |
| Real-API e2e | `pnpm run test:e2e` | 真 key；无 key 自跳过 |
| Owner-local expected | `pnpm run test:expected` | 无钥，组装态 CLI/进程期望输出，`vitest.expected.config.ts` |
| **Snapshot** | `pnpm run test:snapshot` | **无钥录制回放**，`vitest.snapshot.config.ts` |
| Web browser snapshot | `pnpm run test:web` | Chromium + ARIA 树，Linux 必过门 |

**核心资产是 `snapshots/`（659 个文件，81 个 session 场景 + 38 个 web 场景）**，机制：

- 一个场景一个目录，`snapshot.yml` 声明 profile / composition / header class / 录制策略（`snapshots/session/compaction-recovery/snapshot.yml`）。
- `session.v2.jsonl` 是**既是回放输入、又是期望持久化输出**（`snapshots/AGENTS.md:3`）。录一次真 key（`DSH_SNAPSHOT=record`），之后 replay **永远不读 `.env`、不发网络请求**（`vitest.snapshot.config.ts:24-28`）。
- 期望输出四件套：
  - `system-prompt.expected.md`（9459 字节）——**组装好的系统提示词逐字落盘**，`{{cwd}}` 之类的易变值换成规范化 token
  - `tool-schemas.expected.json`（73409 字节）——**发给模型的工具 schema 全量落盘**
  - `ui.expected.md`——Playwright ARIA 树（`snapshots/web/bash-abort-row/ui.expected.md`，39 行，连「1 turns · 1 steps … Input 10 tok · Output 10 tok」这行状态条都钉住了）
  - `workspace.expected/`——**磁盘上真实产出的文件树**，`workspace.final: true` 时逐字节比对，record/refresh **永不重写**（`snapshots/AGENTS.md:15`：「模型散文和工具结果文本不能证明外部效果」）
- 每个进程都从 `dsh` CLI + 已发布 profile 起（`snapshots/AGENTS.md:5`）：**不许为测试新增应用入口、隐藏 CLI 模式或场景驱动器**。
- 规约级要求：`AGENTS.md:127`「每个非平凡的、模型可见或产品用户可见的变更都要更新一份无钥录制会话快照」；`AGENTS.md:130` TS 和 Python 两个 SDK 的期望输出必须同 PR 更新。

**其它值钱的**：

- **`gen-X` / `verify-X --check` 成对模式**（142 个脚本里至少 12 对）：tool-catalog、config-catalog、persistence-catalog、session-format-catalog、module-graph、scoped-events、cordis-api、client-catalog、third-party-notices……生成物提交进仓，`--check` 断言committed 字节一致。
- **lefthook 预提交**（`lefthook.yml`）5 个 job：翻译配对（暂存文件）、归档 Agent Note、暂存 lint（`--fix` + `stage_fixed`）、**第三方声明「重生成而非拒绝」**（`:24-32` 注释解释：依赖改了忘更新 notices 的话，与其晚在 test lane 报错，不如 hook 里直接重生成 + `git add`）、`git diff --cached --check` 白空格、vendor manifest 守卫。pre-push 只跑 typecheck。
- **`all-checks-passed` 汇聚 job**（`.github/workflows/ci.yml:655`）给分支保护用一个名字。
- **测试教义四条**（`docs/testing.md`）：
  1. 「**Verify the world, not the self-report**」——e2e 断言要重跑命令或从外部重读文件；对 agent 自己的输出做关键词探测，会让作弊的 agent 通过。断言未触碰的文件逐字节一致。
  2. 「**Prefer the real implementation over a mock**」——只 mock 昂贵/非确定的边界（LLM 适配器、网络、时钟），下游全真。
  3. 「**A guard only guards if the regression fails it**」（`packages/AGENTS.md` / `docs/testing.md`）——加守卫要**先引入回归、看它红、再还原**。
  4. 「**Test the real entry path**」——「真实入口」指已发布产物：包 `bin` 跑构建后的 `lib/bin.js`、用普通 `node`，暴露 tsx 掩盖的 settle race / 模块解析 / 吞掉的加载失败。

### 我们现在怎么做

- **没有 linter。** 全仓无 `.oxlintrc` / `.eslintrc` / `eslint.config.*` / biome / prettier 配置。`pnpm lint`（`package.json:12`）= 5 个 `audit:*` + `qa:r2-release-gate` + `qa:r4-rust-system-i18n` + 6 个 cuu-r3 冒烟。静态分析只有 `tsc`。
- **没有 git hook。** `.git/hooks/` 无非 sample 文件，`core.hooksPath` 空，无 husky/lefthook/pre-commit。本地推送前零门禁。
- **没有根 `CLAUDE.md` / `AGENTS.md`。** 事实上的规约是 `CONTRIBUTING.md`（迁移纪律 `:63`、提交纪律 `:83`、不用 emoji `:107`、去黑话文案表 `:114-131`、并行批次 `:136`）+ `.agents/notes/`。
- **没有任何 golden / snapshot 测试。** 全仓 `toMatchSnapshot` / `__snapshots__` / `*.snap` 零命中。所有测试是 `node --test` + `node:assert/strict` 显式断言。`packages/ui/src/gold-path/` 的 gold 是「gold **path**（正常路径）」不是「golden file」。
- **有的**：cuu-r3 六件套（`apps/api/src/qa/cuu-r3-*.ts` + 765 行共享 harness），`qa:r2-release-gate` 12 道门（`scripts/qa/r2-release-gate-report.ts`，含 `git.diff-check` / `git.no-reference` / `git.no-secret-diff`），`audit:migrations` 真 PG 迁移重放，CI 8 job（`.github/workflows/verify.yml`）含 `pilot-stack-smoke` 里那条**唯一的阻塞式安全信号**——未认证访问 `/api/pages/attention` 必须 401/403（`:219-221`）。

### 差距

**这是全报告差距最大的一块。** 我们对「AI 改了提示词/文案/工具 schema」这类变更**没有任何机械可见性**——评审只能靠人读 diff，而 `agent-runner.ts` 的提示词是跨 100 行的字符串拼接（`:831-874` 系统提示词 + `:876-929` 初始用户消息 + `:915` 记忆 + `:916` 用户记忆 + `:836` 技能目录）。

### 值不值得借 / 怎么借

**B1（最高 ROI / S / sonnet / 借思想）——提示词 + 工具 schema golden。**

不需要回放引擎，不需要真 key。做法：
1. 新建 `apps/api/src/qa/prompt-golden.ts`（或 `packages/agent` 侧更好，因为组装逻辑一半在 worker 一半在包里——**这里要顺手把 `defaultWorkerSystemPrompt` / `defaultInitialUserMessage` 从 `agent-runner.ts` 抽成纯函数**，它们本来就没有 IO）。
2. 用一组固定 fixture（我们已经有 `packages/agent/src/fixtures/gold-path.ts`，1256 行）喂进去，把组装结果写进 `apps/api/src/qa/expected/worker-system-prompt.expected.md` 和 `worker-tools.expected.json`。
3. 易变值规范化：workdir 路径 → `{{workdir}}`、时间 → `{{clock}}`、run id → `{{run:1}}`（照抄 dsh 的 token 风格）。
4. 一个 `node --test` 断言 committed 字节一致 + 一个 `--update` 旁路。挂进 `pnpm lint`。
5. 至少四份 golden：worker 默认、worker 带项目指令 + 记忆 + 技能、会话轮次系统提示词（`packages/agent/src/turns/prompt.ts:72`）、会话轮次带被 `/name` 唤起的技能（`prompt.ts:322`）。

杠杆点：B5（文案）、B6（劝导话术）、B7（技能目录）、B10（压缩）**四个借项全都改模型可见文本**，没有 B1 它们的评审等于闭眼。**B1 是本清单的施工前置。**

**B2（高杠杆 / L / opus 设计 + sonnet 施工 / 借思想）——无钥录制回放。**

野心版：录一次真 key 的 agent run（我们已有 `qa:r5-10-real` 会烧真 key），把每次模型响应存成 JSONL，之后 replay 时用一个 `ScriptedProvider` 顶掉 `packages/agent/src/providers` 的真 client，**其余全真**（工具注册表、沙箱、DB、SSE）。期望输出四件套照抄 dsh：提示词、工具 schema、最终 trace、**以及 workdir 产出的文件树**（我们的 agent 就是产文件的，`workspace.expected/` 这条对我们比对 dsh 还合适）。

抄它的 `snapshot.yml` 格式和 `snapshots/AGENTS.md` 的三条硬规矩：
- 「已提交的会话是规范化的不动点」——把易变身份换成保关系的 token，绝不因为像 id 就把用户/工具文本涂掉。
- 「产出工作区是独立 oracle」——record/refresh **不许重写** `workspace.expected/`。
- 「每个进程从已发布入口起」——不许为测试造新入口。

风险：L 量级，且会长期占用一个人的注意力（dsh 用了 659 个文件才做到今天这样）。**建议先做 B1，跑三个月，确认 golden review 这件事在我们的节奏里立得住，再上 B2。**

**B4（高杠杆 / S / sonnet / 可近抄）——lefthook 预提交。**

我们有一条血泪教训写在记忆里：「绝不 `git add -A`，工作树常残留并行 codex/QA 的脏文件」。这条纪律现在**只存在于人的记忆里**，而 `qa:r2-release-gate` 的 `git.no-reference`（`scripts/qa/r2-release-gate-report.ts:228`）只在 `pnpm lint` 里跑——提交那一刻没人拦。

抄 `lefthook.yml` 的形状，落 5 个 job：
1. `git diff --cached --check`（白空格）——直接抄。
2. **暂存路径黑名单**：`reference/**`、`.claude/worktrees/**`、`artifacts/**` 一律拒绝进暂存区（把 `git.no-reference` 从 CI 前移，并把 worktree 也纳入——见 B5 里 i18n 计数被污染那件事）。
3. `audit:copy-terms` 只跑暂存文件（现在是全量扫 5 个字典）。
4. `audit:agent-notes` glob `.agents/notes/**`。
5. 密钥形状扫描（把 `git.no-secret-diff` 前移）。
pre-push 只挂 `pnpm typecheck`（照抄 dsh，重活留给 CI）。

风险：低。要点是**必须快**——dsh 的注释第一行就是「Keep these local checkpoints fast; CI owns the full repository-wide gate matrix」。别把 `pnpm test` 挂进去。

**顺带借（0 成本，进 B3 的规约）**：那四条测试教义。特别是「a guard only guards if the regression fails it」——我们加了 12 道 release gate、5 个 audit，**没有一条被证明过能红**。写进规约：新增门禁的 PR 必须附「我先把回归引进去，看它红了，再还原」的证据。

---

## 5. 安全

### 它怎么做

- **SAFETY.md 的口径值得逐句学**（`reference/deepseek-harness/SAFETY.md`）：开门就写「实验性开发者预览、**未经安全审计**、不得当作安全或生产就绪」（`:7`）；然后 `:13` 那句最狠——「**沙箱、审批提示和权限控制可以降低风险，但不保证隔离、不阻止损害。即使正确执行的限制也保护不了本项目被允许访问的资源。**」；`:15`「不要把它当作不受信工作负载的唯一安全控制」。后面是 5 条负责任使用清单和免责声明。**全文没有一句自夸。**
- **沙箱是真 OS 级的**（`packages/sandbox/`）：三种模式 `read-only` / `workspace-write` / `danger-full-access`；后端 Linux 用 `bwrap`，不行降级 Landlock 启动器（`native/landlock-run/`，自建 npm 原生包 + 三平台预构建 + 自己的发布流水线）；macOS 用 Seatbelt（`sandbox-exec`）；Windows 用 ACL 受限令牌。
  - **没有可用 runner 就 `SANDBOX_UNAVAILABLE` fail-closed，绝不静默无约束执行**（`packages/sandbox/sandbox-local/README.md` Summary）。
  - 每次包裹**报告执行完整度 `full` 还是 `partial`** + 后端的拒绝签名，消费者能区分「沙箱坏了」和「命令被拒」。
  - 被拒的调用可以请求**严格更宽**的模式，由人批一次。
  - `sandbox-policy` 把当前模式和工作区**写进模型的每次请求**（`snapshots/session/compaction-recovery/system-prompt.expected.md:3` 里就有那句「a `[sandbox: file access denied …]` result is policy, not a command bug」——告诉模型这是策略不是 bug，防止它绕）。
- **审批**（`packages/interaction/user-approval`）：`ctx.approval.request(req)` 返回 `allowed-once | rejected | cancelled | unavailable`；**缺席、非所有者、抛异常的应答者一律 fail-closed 到 `unavailable`**；授权只对被请求的那一个动作生效；会话级策略 `ask`（默认）/ `never`，`never` 不问任何人直接确定性拒绝。每次请求记进会话审计日志，**模型只看到调用方的工具结果 + 当前策略**。
- `permission-presets` 把「沙箱模式」和「审批策略」两个独立旋钮打包成用户可选的命名预设，不匹配任何预设时读回派生的 `custom`（可显示不可选）。
- `AGENTS.md:118`「在类型化的同进程边界信任 TypeScript」——只在 parser/config、队列、模型/工具 JSON、持久化/文件、worker、进程、wire 这七类边界做运行时校验。这条**反过来**也是纪律：这七类边界必须校验。

### 我们现在怎么做

**审批链我们更完整**（dsh 的审批是「一次性放行一个动作」，没有路由、没有 SLA、没有委派、没有事后审计表）：

- 双层权限：动作模式策略（`packages/permissions/src/evaluate.ts:119-177`，scope 阶梯 org<workspace<role<session，`deny` 优先级 ≥1000 是穿透一切的 kill-switch，`globMatch:43-55` 带 ReDoS 与 dotAll 两处加固）+ 资源能力谓词（`resource-permissions.ts`，11 个手写谓词，租户围栏对 null fail-closed）。
- 三类触发：策略 `ask`、**人类保留高危工具**（`services/human-reserved-guard.ts:75-103`，legal/finance/identity/publish 四类词表，命中直接 409 `human_reserved_tool_call` + 开升级）、角色限制（`agent-runner.ts:259-263`，research/review 角色只能碰 `none`/`sandbox_file`）。
- 审批人路由（`packages/permissions/src/approval-routing.ts:138-157`）、双层动作守卫（route `routes/approvals.ts:80-91` + service `services/approvals.ts:481-488`）、拒绝必须给理由、非管理员的 TOCTOU CAS 谓词（`services/approvals.ts:987`）。
- SLA 过期扫描 + 24h 提醒阶梯 + `audit_logs` 表（`packages/db/src/schema/core.ts:2166-2192`），其中**「学到的 allow 策略」的审计是提交前写的**（`services/approvals.ts:627-631`，理由 `:995-997`：放宽 AI 权限这件事不能等提交成功才记）。

**沙箱我们差得远**（`packages/tools/src/sandbox.ts`，237 行）：

- 10 个二进制白名单、禁裸路径、禁依赖安装/远程执行、词法路径围栏、`realpathSync` 软链逃逸检查（有 TOCTOU 窗口）、文件/字节预算、`shell:false`、SIGKILL 超时、2MB 输出上限。
- **全在用户态。** `sandboxEnv`（`:138-154`）**原样透传宿主 `PATH`**，注释（CORE-16）自己写明这是「预算 + 路径围栏」级软沙箱，**不是安全边界**，多租户/公网部署必须关掉并注入真容器/namespace/firejail。无 chroot、无 namespace、无 seccomp、**无任何网络出口封锁**。
- 唯一的硬停：`run_command` 默认 fail-closed（`packages/tools/src/file-tools.ts:338-342`，无注入 `ctx.commandRunner` 就报错），开关是 `AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS`（默认 false）。`file-tools.ts:334-337` 记着无约束回退**实测能读 `/etc/hosts`**。
- 我们自己的文档 `docs/workhub/01-architecture/security-and-permissions.md:46-53` 把「沙箱出口未封锁」列为 R2 号已知接受残余风险。
- **没有 `SAFETY.md`。** 有的是 `SECURITY.md`（55 行，纯漏洞披露流程）。

### 差距

审批我们赢，沙箱他们赢，**免责口径我们完全空白**——而仓库是 PUBLIC 的。

### 值不值得借 / 怎么借

**B8（高杠杆 / M / sonnet / 借思想 + 抄 argv 包裹契约）——macOS Seatbelt + fail-closed。**

我们是桌面优先、macOS 为主战场，Seatbelt 恰好是 dsh 三个后端里最便宜的一个（`sandbox-exec -p '<profile>' -- <argv>`，一个 profile 字符串 + argv 前缀，不需要原生包，不需要 Landlock 那一整套发布流水线）。

要动的文件：
- `packages/tools/src/sandbox.ts:156-163`（`nodeCommandRunner`）—— 在 spawn 前包一层 argv；按 `read-only` / `workspace-write` 两档写 profile（`danger-full-access` = 不包）。
- `packages/tools/src/types.ts:11-13` —— 加 `sandboxMode` 字段。
- `packages/config/src/env.ts:120` —— `AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS` 的语义从「允许无约束」改成「允许降级到软沙箱」；**新增：没有可用 runner 时默认拒绝而不是降级**（dsh 的 `SANDBOX_UNAVAILABLE` 契约）。
- 报告 `full` / `partial`：macOS 上是 `full`，Linux/Windows 暂时 `partial` 并在结果里说明——**别假装跨平台都保护到了**。

顺手抄一句到系统提示词（进 B1 的 golden）：dsh 那句「`[sandbox: file access denied …]` 是策略不是命令 bug」。我们现在的沙箱拒绝会被模型当成命令写错，然后它会去换写法绕——这是真实的失控路径。

风险：`sandbox-exec` 在 macOS 上被标记 deprecated（但 Chrome/Codex 至今在用）；profile 写窄了会误伤 python/node 的正常临时目录写入。**必须配一条「拒绝路径可复现」的测试**（照 dsh 的「a guard only guards if the regression fails it」）。

**顺带借（S，0 技术风险）——写一份 `SAFETY.md`。**
仓库 PUBLIC、PolyForm NC、跑模型生成的代码、有一个自己承认不是安全边界的沙箱——**现在没有任何免责与安全口径**。照 dsh 的五段结构写：实验状态 / 沙箱局限（那句「即使正确执行的限制也保护不了本项目被允许访问的资源」直接对我们成立）/ 负责任使用 / 无担保。中英双语（我们已有双语 `SECURITY.md` 的先例）。这条可以和 B9 打包成一个「合规小包」。

**不借的**：Landlock 原生包 + 三平台预构建 + 独立发布流水线（`native/landlock-run/` 有 51 个文件、7 个发布脚本、独立 GitHub workflow）。那是为了给 Linux 上没有 bwrap 的机器兜底，我们没有那个用户群。

---

## 6. 产品面

### 它怎么做

- **`apps/web` 是个薄壳**：`index.html` + 4 个 `.ts`（`main.ts` / `preview.ts` / stub / env），真正的 UI 全在 `packages/client/` 的 **40+ 个 `ui-*` 包**里（React 18 + CSS Modules + clsx，`docs/web-styling.md:12` 明确禁止引入组件库和 Tailwind）。每个 ui 包自带 `src/client/locales.ts`。
- **工具卡是「渲染意图联合」**（`docs/cookbook/adding-a-tool.md:69-91`）：
  - `presentCall(args)` → `ToolCallView`：`{card:'generic'|'terminal'|'diff', …}`，`locations: [{path, line?}]` 让编辑器能跟随跳转。
  - `presentResult(args, result)` → 完成卡：另有 `read`（重建的文件窗口，带 1-based offset、行号、totalLines、语言提示）、`search`（按文件分组的匹配 / 扁平路径列表，**带 `truncated`/`total` 所以 UI 绝不把截断结果显示成完整结果**）、`web`。
  - **三条硬规矩**：①**纯函数**——这些在实时流式**和会话日志回放**上都要跑，禁 IO、禁读会话状态、禁时钟/随机；②**UI 专用格式绝不进模型结果**——```console 围栏、diff、相对路径都不许为了 UI 而混进 canonical value；③`defineTool` **软校验显示路径**——畸形或旧日志参数让 wrapper 返回 `undefined` 退回通用卡，**显示绝不能让回放崩掉**。
  - Web Client **不消费** `presentCall`/`presentResult`：它从 wire 上的 `tool/call` / `tool/result` 事件 + 持久化 `result.meta` **自己派生**（`docs/cookbook/adding-a-tool.md:95`）。
- **`native/` 不是桌面壳。** 它是 `@deepseek-ai/node-addon-landlock-run`——Linux 沙箱启动器的原生包。**dsh 没有桌面客户端**，没有 Tauri、没有窗口/托盘/更新器/签名。分发 = `npx @deepseek-ai/dsh web` 起本地服务 + 浏览器。
- **`python/` 是子进程 SDK 桥**：`HarnessClient` 用 newline-delimited JSON-RPC over stdio 驱动一个 `dsh --profile sdk` 子进程（`python/sdk/src/deepseek_harness/client.py:25-37`），runtime wheel 里打包了整个 `dsh` CLI 可执行文件。**Python 只暴露 profile 选择 + 有序 patch 文件，不暴露完整 Cordis 树。**
- **样式系统有机器契约**：`packages/client/ui-theme/tests/elevation-styles.client.spec.ts`（182 行）+ `corner-shape-styles.client.spec.ts`（91 行）+ `stylesheet-scan.ts`（91 行）——**直接读磁盘上的 CSS 文本**，断言「没有任何规则把 elevation 阴影和中性 border token 配对」「每个全圆角都配了 `corner-shape: round`」。

### 我们现在怎么做

- `apps/web`（47 个 `.ts`，**全仓零 `.tsx`**）：手搓字符串模板 DOM，React 只用在两个「变更孤岛」上（`apps/web/src/react-route-mount.ts:35`，只允许 `HomeRouteComponent | ProposalMutationEditor | ProposalLineEditor`）。渲染主力是 `packages/ui/src/gold-path/route-components.ts`（~6200 行）。会话页是**只读镜像**（`apps/web/src/routes.ts:1386-1387` 注释、`:629` 标签「会话镜像」）。SSE 走原生 `EventSource`（`packages/web-runtime/src/live-runtime.ts:12-25`）。**web 侧没有工具卡。**
- `apps/desktop-webview`（**217 个 `.ts`**，web 的 4.6 倍）：三个入口 = 三个 Tauri 窗口（`index.html`→main 命令条 720×64 / `pet.html`→桌宠 260×340 / `workbench.html`→工作台 1280×800）。SSE 是手搓 `fetch` + `ReadableStream`（`workbench/chat/stream.ts:1-5` 说明原因：`EventSource` 设不了 `X-YQGL-Client-Token` 头）。
- **工具卡只有桌面有，且只认 3 个工具**：`apps/desktop-webview/src/workbench/chat/render.ts:1435` `renderToolActivityGroupHtml()`，标签表 `:1417-1421` 只有 `drive_search` / `send_file_card` / `create_work_item`，其余一律退化成「工具调用 / Tool call」（`:1423-1429`）。**没有通用参数/结果查看器，没有 diff/JSON 检视。**
- `client-tauri`：Tauri **2.11.2**，三窗口全 `decorations:false` + `transparent:true`，托盘手写（`src-tauri/src/tray.rs`，8 个菜单动作），深链 `workhub`/`yqgl`，**能力按窗口分域**（`capabilities/default.json` 只给 main+pet，`workbench.json` 单独放开 hide/minimize/is-focused——这一点做得比很多 Tauri 项目好），CSP 已设且不松（`tauri.conf.json:14`）。
- **但分发链是空的**：无 updater（全仓 `updater` 零命中，无 `tauri-plugin-updater`、无公钥）；签名是 ad-hoc（`tauri.conf.json:92-96` `signingIdentity: "-"`、`hardenedRuntime: false`），`scripts/dev/build-macos-app.sh:17-19` 自己写明「这不是 Apple 公证，`spctl --assess` 仍会拒」；CI 8 个 job **没有一个构建或打包桌面端**。
- **回放有**（agent run 回放，不是会话回放）：契约 `packages/contracts/src/replay.ts`、页面 VM `apps/api/src/pages/replay.ts`（515 行）、共享渲染 `packages/ui/src/replay/render.ts`（629 行）、web 路由 `/agent-runs/:id/replay`、桌面 Spotlight 视图。
- **设计系统只有桌面有**：`apps/desktop-webview/src/design-system.ts`（110 行 Apple 液态玻璃 token），且**故意不进 `@workhub/ui`**（`:3` 注释：「绝不进共享 @workhub/ui → Web 走 GitHub 风、互不影响」）。视觉契约测试有一条 26 行的（`desktop-visual-language.test.ts`），是对字面 hex 值的正则（`#0a84ff` 必须在、旧紫色必须不在）。

### 差距

三条：

1. **工具卡的信息密度**：我们的模型会调 11 个工具，用户只能看到 3 个有名字，其余是「工具调用」。dsh 有 6 种卡型 + 「截断必须自曝」的规矩。
2. **两端已经分叉成两个产品**：三套独立 SSE 实现（`web-runtime/live-runtime.ts`、`workbench/chat/stream.ts`、`desktop-cuu-runtime.ts:1878`）、两套视觉语言无共享 token、聊天一边是真客户端一边是只读镜像。桌面的 action-card VM 是**手抄的 snake_case 副本**（`workbench/chat/api.ts:195-197` 承认没提升进 `@workhub/contracts`）——活的漂移风险。
3. **桌面分发从零**：无版本号变动（17 个 `package.json` + Cargo + tauri.conf 全是 `0.1.0`）、无 tag（`git tag` 空）、无 changelog、无公证、无 updater、无 CI 打包。

### 值不值得借 / 怎么借

**B12（中杠杆 / M / sonnet / 借思想）——工具卡渲染意图联合。**

不抄 dsh 的 `presentCall`/`presentResult` 方法位置（他们的 Web 端自己都不消费），抄**联合类型 + 三条硬规矩**：
- 在 `packages/contracts` 定义 `ToolCardIntent = {card:'generic'|'terminal'|'diff'|'read'|'search'} & …`，**放 contracts 顺手解决第 2 条差距**（桌面手抄 VM 那件事）。
- 由 `packages/ui` 出一个纯函数 `renderToolCard(intent)`，**web 和 desktop 共用**（我们两端都是字符串模板渲染，这一步比 dsh 的 React 情况还容易）。
- 三条硬规矩逐条落：①纯函数、可回放（我们的 replay 页正好需要）；②UI 专用格式不进 `ToolResult.content`（我们现在 `packages/tools/src/types.ts:17-24` 的 `content` 是给模型的，`data` 是结构化的——已经分开了，别混）；③畸形参数退回通用卡而不是抛。
- **`search`/`read` 卡那条「带 `truncated`/`total`，UI 绝不把截断当完整」直接对上我们的痛点**：`file-tools.ts:219-231` 读文件截 2MB 只标了 `[truncated]`，`sandbox.ts:186-198` 输出截 2MB 直接 SIGKILL——这些在 UI 上现在是看不见的。

要动的文件：`packages/contracts/src/`（新增）、`packages/ui/src/`（新增 renderer）、`apps/desktop-webview/src/workbench/chat/render.ts:1414-1435`（换实现）、`packages/ui/src/gold-path/route-components.ts`（web 侧新增消费点）。

风险：M 量级且碰 `route-components.ts` 这个 6200 行文件（同时也是 B5 的主战场）——**B12 和 B5 会撞车**，见互斥表。

**顺带借（S / sonnet）——CSS 文本契约测试。**
我们已经有 26 行的雏形（`desktop-visual-language.test.ts`），但它断言的是字面 hex 值，一改 token 就假红/假绿。抄 dsh 的 `stylesheet-scan.ts`（91 行，把 CSS 文本拍平成 selector + declarations）+ 一条契约 spec，断言的是**关系不是值**（例：凡用了 `--ds-shadow-*` 的规则不得同时带 `border: 1px solid var(--ds-line-*)`）。考虑到我们「codex 玻璃三次改炸 + 测试迁就」的历史，这个 ~270 行的投入回报率很高。

**桌面分发**：**dsh 这里什么都教不了我们**（他们根本没有桌面壳）。updater / 公证 / CI 打包这条线得另找参考（Tauri 官方 updater + `tauri-action`），不在本报告范围。

---

## 7. 工程与文档

### 它怎么做

- **`*.i18n.yaml` 不是翻译资源文件。**（这条要更正立项时的假设）它是**双语文档配对一致性记录**：里面只有两行 git blob hash（`README.i18n.yaml`），配 `scripts/verify-translation-pairing.ts` 检查「英文改了中文没跟上」。改完任一侧要 `pnpm run verify-translation-pairing --write <file>` 重录。lefthook 在 pre-commit 和 pre-merge-commit 各挂一次。
- **真正的 UI i18n 是**：每个 `ui-*` 包自带 `src/client/locales.ts`，**中文是 key 集的事实源**、英文用 `satisfies Record<ZhKey, string>` 对齐（`packages/client/ui-approval/src/client/locales.ts:4-22`，一共 30+ 个这样的小文件）；`AGENTS.md:126`「客户端 UI 文案由 locale 独占」；门禁是 `scripts/verify-client-ui-i18n.ts`——**用 TypeScript AST 扫**，JSX 文本 + 14 个文案属性（`:17-32`）+ 后缀正则（`:33-36`）+ 喂给它们的 data/helper 形式，只有 `locale.ts` / `locales.ts` / `/locales/` 下的文件允许拥有译文（`:69-75`），并且设了下限 `MINIMUM_CLIENT_UI_SOURCES = 450`（`:15`）防扫描器本身失效。
- **`BRAND_GUIDELINES.md` 不是设计规范，是商标使用政策**（也要更正假设）：允许第三方在描述性文字里说「built on DeepSeek Harness」、建议项目名用缩写 `DSH`、**禁止在项目名里直接用注册商标全称**、禁止用官方素材造成官方背书的错觉。12 行，中英双语。
- **`docs/architecture.md` 只有 150 行**，写法是「有序地图」：Cordis 是什么（2 段）→ profile/bundle 组合（5 段）→ 应用启动（3 段）→ 8 行核心包表（含 `ctx` key）→ 事件三域 → **18 行 turn flow 伪代码** → session log → 能力缝 → **22 行「你想干 X → 挂哪」表**。全文没有一个类型定义（那些在 `subsystems/`），没有一句设计理由（那些在 Agent Note），没有实现状态标注。
- **文档分层税制**（`docs/AGENTS.md:19-32`）：一张表，每一层有「Job」和**「Does NOT belong there」**两列。根 `AGENTS.md` = 常驻命令，每条 1-3 行 + 链到它的家，**不许有故事、举例、情景流程、以及任何从被链文档搬过来的重复**。
- **字数天花板**（`docs/AGENTS.md:47-57`）：`scripts/doc-budgets.manifest.json` 逐文件设上限，`verify-doc-budgets` 拒绝超额**和缺失**。根 `AGENTS.md` ≤1950 字、`architecture.md` ≤2400、子树 `AGENTS.md` ≤600。红灯时的处置顺序写死了：**先搬（到该去的层）→ 再压 → 最后才提天花板，且要在 PR 里解释**。
- **Slop 清单 9 条**（`docs/AGENTS.md:59-71`）：同一条规则有两个家 / 叙述历史（"previously"、"now"、"no longer"、PR、commit）/ **实现状态标注**（"implemented!"、"future: …"——「状态会腐烂，仓库布局和包清单才承载它」）/ 手抄的目录与清单 / 推理过程转录 / 理由在兄弟方法旁重复 / 段落墙 / 强调通胀 / implemented Note 里的 spec-speak。
- 交叉引用必须是相对 markdown 链接，`verify-md-links` 拒绝失效目标和死锚点。
- **postmortem 是独立一层**（`docs/postmortem/`，4 篇）：明确「post-mortem 不是 Agent Note」——后者记深思熟虑的设计决策，前者记**「为什么我们的流程放它过去了」**。写的条件是三条同时成立：subtle（机制不显然）、systemic（逃逸原因是测试/工具/约定的缺口而非一次手误）、costly to rediscover。每篇开头必须有 30 秒能读完的 Executive summary。
- **发布**：`dsh-v*` tag（11 个）、`release/dsh-0.1.3-alpha.1` 发布分支、`scripts/release/` 9 个脚本（bump/pack/verify/publish/verify-packed-install），打包和依赖布局校验**在每个 PR 上都跑**（无凭据），发布本身是从 tag 手动 `workflow_dispatch`。
- **THIRD_PARTY_NOTICES 是生成的**（17561 字节）：从 workspace manifest + `vendor/README.md` + Python `pyproject.toml` + pnpm patch 列表生成，license/repo 元数据取自已安装的 store；pre-commit 钩子在输入变化时**重生成并 `git add`**，test lane 再断言 committed 字节一致。分三档：vendored source（连上游 commit SHA 都记了）、runtime npm deps、其余。

### 我们现在怎么做

- **i18n 的真实数字要更正**：`docs/workhub` 里说的「1066 处内联三元」不成立。实际模式是 `locale === "zh-CN" ? … : …`，**产品代码（apps + packages + client-tauri + scripts）里 261 处**；全仓 943 处，其中 **682 处在 `.claude/worktrees/` 的 5 份陈旧全量检出里**（占 72%）。且**我们本来就有字典系统**：5 个模块共 2136 行（`packages/cuu/src/i18n.ts` 728、`packages/ui/src/gold-path/i18n.ts` 652、`packages/ui/src/i18n.ts` 583、`packages/web-runtime/src/locale.ts` 70、`packages/contracts/src/locale.ts` 24）+ `apps/api/src/pages/i18n.ts` 128 + Rust 侧 `client-tauri/src-tauri/src/locale.rs` 79（有 CI job 守）。调用点 `cuuT(` 216 / `t(` 203 / `uiT(` 199 / `goldPathT(` 121。
  **所以准确画像是：字典系统基本建成，剩 261 处没迁移，其中 138 处（53%）挤在 `packages/ui/src/gold-path/route-components.ts` 一个文件里。**
  另发现一处待查：字典里 `"zh-CN":` 416 个 key vs `"en-US":` 363 个，**53 个不对称**。
- **禁词门有一个大洞**：`scripts/dev/check-copy-terms.ts:19-25` 只扫 5 个字典文件。那 261 处内联三元、以及桌面端全部文案，**完全在门禁覆盖之外**。这个脚本自己在 `:9` 承认它是「术语单一事实源上线前的最低限度防线」。
- **术语表是文档不是模块**：`docs/workhub/00-overview/glossary-dejargon.md`（304 行，自称「词汇宪法」）。`packages/contracts/src/` 里没有术语模块——这正是那篇 rejected Note 写下的采纳方向，至今未落。
- **无根 `AGENTS.md`/`CLAUDE.md`**；事实规约在 `CONTRIBUTING.md`。
- **无字数预算、无 slop 清单、无 postmortem 层、无 `verify-md-links`。**
- **文档规模**：`docs/workhub` 2093 个文件，其中 **186 个 `.md`**，其余是证据媒体（1141 png / 396 txt / 182 json / 60 gif / 58 mp4）。索引 `docs/workhub/README.md` 34KB，第 6 行自报「186 篇文档已落盘」（与实际一致，`docs.count` 门在 `scripts/qa/r2-release-gate-report.ts:181-187` 守着）。
  但这份索引本身踩了 dsh slop 清单两条：`:5` 硬编码了一条陈旧的 Windows 研究路径；`:19-49` 是一张逐迭代状态表，每格都标「已完成」（= dsh 明令禁止的「实现状态标注」）。
- **没有单一 architecture.md**：`docs/workhub/01-architecture/` 拆成 5 个文件共 2262 行，其中最接近的 `system-architecture.md` 只有 294 行，是这个目录里**最小**的文件（`data-model.md` 723 / `api-contract.md` 472 / `security-and-permissions.md` 470）。
- **发布流程实质为零**：`git tag` 0 个、无 CHANGELOG、17 个 `package.json` + Cargo + tauri.conf 全停在 `0.1.0`、40+ 分支全是迭代/agent 草稿分支、CI 8 job 全是验证不产出任何制品。服务端有 Docker 部署链（`DEPLOY.md` + `docker-compose.pilot.yml` + `pilot-stack-smoke`），桌面端没有。
- **无品牌/商标政策，无设计系统文档**（`design-system.ts` 110 行代码是唯一的 token 来源，只覆盖桌面）。

### 差距 / 怎么借

**B5（高杠杆 / M / sonnet / 借代码）——文案 locale 独占 + AST 门禁。**

这是**一石二鸟**：
- 鸟一：把 261 处内联三元逼进字典。
- 鸟二：**一旦全部文案都在字典里，`check-copy-terms` 那个「只扫 5 个文件」的洞就自动补上了**——扫描范围和实际文案位置终于重合。

做法（严格避开被否决的展示层正则修法）：
1. 移植 `scripts/verify-client-ui-i18n.ts` 的 AST 扫描（用 `typescript` 编译器 API 遍历，判定文案属性 + JSX 文本 + copy-shaped 变量名）。我们没有 JSX，所以要改判定条件：**扫「含 CJK 的字符串字面量出现在非 i18n 文件里」**，比 dsh 的规则更简单也更准。
2. 允许列表照抄它的形状：只有 `i18n.ts` / `locale.ts` / `locales/` 下的文件可以拥有译文。加 `MINIMUM_SOURCES` 下限防扫描器失效（抄 `:15`）。
3. **先跑 `--report` 建立基线**，把 261 处按文件排序（`route-components.ts` 138 / `apps/web/src/routes.ts` 19 / `workbench/rail.ts` 9 / `chat/render.ts` 8 / …），分批清；门禁先设成「基线不许变大」的棘轮，清完再翻成零容忍。
4. **新代码走 dsh 的形状而不是我们现有的形状**：per-package 的小 `locales.ts`（中文是 key 集事实源 + 英文 `satisfies Record<ZhKey,string>` 编译期对齐），而不是继续往 652 行的 `gold-path/i18n.ts` 里堆。顺手把那 53 个 key 不对称查掉——`satisfies` 会直接编译报错。
5. 门禁挂进 `pnpm lint` **和** B4 的 pre-commit（只扫暂存文件）。

要动的文件：新增 `scripts/dev/check-ui-copy-ownership.ts`；`package.json`（挂 lint）；`packages/ui/src/gold-path/route-components.ts`（主战场，138 处）；`apps/web/src/routes.ts`；`apps/desktop-webview/src/workbench/*`。

风险：**碰 `route-components.ts` 这个 6200 行文件**，和 B12 撞车；且这是纯机械但量大的迁移，适合分批派 sonnet。**每批必须过 typecheck + `pnpm test`，不许一次性大改。**

**B3（高杠杆 / S / sonnet / 借思想）——根 `AGENTS.md`。**

写一份根 `AGENTS.md`，`CLAUDE.md` 软链过去（抄 dsh 的 `CLAUDE.md -> AGENTS.md`）。内容纪律照抄 `docs/AGENTS.md:21`：**每条 1-3 行，链到它的家，不许重复被链内容**。必收的条目（都是我们已有但只活在人的记忆里的规则）：
- 绝不 `git add -A`（链到 B4 的 hook）
- 迁移必须 replay-safe（链 `CONTRIBUTING.md:63`）
- 界面/文档/对话一律不用 emoji（链 `CONTRIBUTING.md:107`）
- 用户可见文案的禁词与去黑话表（链 `docs/workhub/00-overview/glossary-dejargon.md`）
- 非平凡变更必须带 Agent Note（链 `.agents/notes/README.md`）
- 写完测试要再 `pnpm typecheck`（`pnpm test` 用 tsx 不严格查类型）
- 增删 `docs/workhub/*.md` 必须同 commit 改 README 计数（链 `r2-release-gate-report.ts:181`）
- 四条测试教义（见主题 4）
- 「新行为落在哪」的映射表（见主题 1）
配 `verify-doc-budgets` 式的字数上限（≤2000 字），防它长成第二份 `CONTRIBUTING.md`。

**B9（中高杠杆 / S / sonnet / 借代码）——许可合规小包。** 见主题 8。

**B11（中杠杆 / S / sonnet / 借思想）——Agent Note 升级。** 见下。

**顺带（S）**：
- 把 `docs/workhub/README.md:5` 的陈旧 Windows 路径删掉，`:19-49` 那张全「已完成」的逐迭代状态表删掉（dsh slop 清单第 3 条：状态会腐烂，仓库布局才承载它）。
- 抄 `verify-md-links`（S）：我们 186 篇文档的相互链接目前无人守。
- **`.claude/worktrees/` 那 5 份陈旧全量检出应该清掉或加进 `.rgignore`**——它们污染了每一次全仓统计（i18n 那 682 处就是它们贡献的），也是「绝不 git add -A」这条纪律的根源。这条应该单开一个 chip。

---

## 8. 许可

### 事实

- dsh：MIT，`Copyright (c) 2026 DeepSeek`（`reference/deepseek-harness/LICENSE`）。MIT 的唯一义务是**「上述版权声明和本许可声明须包含在软件的所有副本或实质部分中」**。
- WorkHub：**PolyForm Noncommercial License 1.0.0**（`/Users/apple/Desktop/开发项目/WorkHub/LICENSE:1`），source-available、非 OSI、仅限非商业。
- WorkHub 现状：**17 个 `package.json` 无一个 `license` 字段**；**无 `THIRD_PARTY_NOTICES`**；已经在 vendor pi（MIT）于 `packages/agent/src/loop2/vendor/`，署名是一份 87 行的 `packages/agent/src/loop2/NOTICE.md`（记了上游 commit `dcfe36c797` + 6 条改造 + 「Deviations from pi behavior: None intended」）——**这份 NOTICE.md 的写法是对的，就照它办**。

### 借代码需要怎么署名

MIT 允许我们把代码放进 PolyForm NC 的作品里（MIT 是宽松许可，不传染），但必须保留声明。具体到本清单：

| 借项 | 借的是 | 署名要求 |
|---|---|---|
| B6 重复调用提醒 | **代码**（`packages/guard/repeat-tool-reminder/src/index.ts` 的逻辑与话术） | 需要 |
| B4 lefthook.yml | **配置**（近抄） | 需要（配置文件也是「实质部分」的候选，成本极低，照做） |
| B5 verify-client-ui-i18n | **代码**（AST 扫描骨架） | 需要 |
| B9 gen-third-party-notices | **代码** | 需要 |
| B12 CSS 契约测试 `stylesheet-scan.ts` | **代码** | 需要 |
| B1 / B2 / B3 / B7 / B8 / B10 / B11 | **思想 / 格式 / 纪律**（snapshot.yml 字段名、目录结构、规约条目措辞） | 不需要（但值得在 Agent Note 里注明出处，我们已有先例：`.agents/notes/README.md` 开头就写了「借鉴 deepseek-harness」） |

**落地做法**（= B9，S / sonnet）：

1. **建 `/Users/apple/Desktop/开发项目/WorkHub/THIRD_PARTY_NOTICES.md`**，照 dsh 的三档结构：① vendored source（记上游 repo + commit SHA + 许可，现在有 pi，将来有 dsh 的片段）② runtime npm deps ③ dev-only。
2. **移植 `scripts/dev/gen-third-party-notices.ts`**（参考 `reference/deepseek-harness/scripts/gen-third-party-notices.ts`），从各 `package.json` + `pnpm-lock.yaml` 生成，`--check` 断言 committed 字节一致；挂进 `pnpm lint` **和** B4 的 pre-commit（用 dsh 的「重生成而非拒绝」策略：`run: tsx scripts/dev/gen-third-party-notices.ts && git add THIRD_PARTY_NOTICES.md`）。
3. **17 个 `package.json` 补 `"license": "PolyForm-Noncommercial-1.0.0"`**（SPDX id）。工具链和 registry 现在把整个项目读成 unlicensed。
4. **借 dsh 代码的每个文件顶部加 MIT 归属块**，格式照 `packages/agent/src/loop2/NOTICE.md` 的先例：
   ```
   /**
    * Adapted from deepseek-harness (MIT), packages/guard/repeat-tool-reminder/src/index.ts
    * Copyright (c) 2026 DeepSeek. Upstream commit d347e70390.
    * Local changes: <逐条列>
    */
   ```
   并在 `THIRD_PARTY_NOTICES.md` 的 vendored source 档里登记一行。
5. **顺手写 `SAFETY.md`**（见主题 5）——同一个小包一起做。

### 只借思想不借代码的

- Cordis / 插件树（见别借 1）
- Typert 类型图生成器（见别借 2）
- Landlock 原生包（见主题 5）
- `snapshots/` 的具体 harness 实现（格式和纪律抄，实现我们自己写——他们的绑死在 Cordis profile 上）

### 商标

dsh 的 `BRAND_GUIDELINES.md` 是给第三方看的商标使用政策。**我们的仓库是 PUBLIC 的，同样需要一份**：允许别人怎么描述关系、建议用什么缩写、禁止在项目名里用我们的名字、禁止造成官方背书错觉。12 行的事，可以并进 B9 那个合规小包。

---

# 建议的施工顺序与互斥关系

## 前置链（必须串行）

```
B1（提示词 golden）
  └─→ B6（劝导话术）    ┐
  └─→ B7（技能目录全量）├─ 三者都改模型可见文本，没有 B1 就是闭眼评审
  └─→ B10（两段式压缩） ┘
```

`B1` 是整张清单的地基。**任何改模型可见文本的借项都不许排在 B1 前面。**

## 会碰 `packages/agent` 热点文件的（必须串行，不许并行派单）

| 借项 | 热点文件 |
|---|---|
| B1 | `apps/api/src/workers/agent-runner.ts:831-929`（抽纯函数） |
| B6 | `packages/agent/src/loop/control.ts:98-130`、`loop.ts:1406-1428`、`loop2/config-builder.ts:566-574` |
| B10 | `packages/agent/src/loop/loop.ts:345-355 / 1207-1234`、`loop2/config-builder.ts:466-511` |

**B6 和 B10 都改 `loop.ts` 且都要同步改 `loop2/config-builder.ts`**（我们是双引擎，任何循环行为改动必须两边一起改，否则 `shadow-assert` 的等价性检查会红）。这三个**顺序执行，不并行**。

## 会撞 `packages/ui/src/gold-path/route-components.ts`（6200 行）的

| 借项 | 撞点 |
|---|---|
| B5 | 138 处内联三元，全文件 |
| B12 | 新增 web 侧工具卡消费点 |

**B5 先，B12 后。** B5 是机械迁移会重排大量行，B12 在它之后接手成本低得多；反过来会让 B5 的 diff 变成灾难。

## 完全独立、可立刻并行发车的

- **B3**（根 AGENTS.md）——纯文档，零代码冲突
- **B4**（lefthook）——只加 `lefthook.yml` + `scripts/dev/` 新文件 + `package.json` 一行
- **B9**（许可合规小包：THIRD_PARTY_NOTICES + license 字段 + SAFETY.md + 商标政策）——只碰根目录和 `package.json`
- **B11**（Agent Note 分层）——只碰 `.agents/notes/` 和 `scripts/dev/check-agent-notes.ts`
- **B8**（Seatbelt 沙箱）——只碰 `packages/tools/src/sandbox.ts` + `types.ts` + `config/src/env.ts`

## 建议波次

| 波 | 内容 | 说明 |
|---|---|---|
| **W0** | B3 + B4 + B9 + B11 四路并行 | 全是 S、零冲突、当天可完；先把「规约 + 本地门禁 + 合规 + 决策档案」这四块地基垫上 |
| **W1** | B1 单独 | 地基。做完再动任何模型可见文本 |
| **W2** | B8 + B5 并行 | 互不相交（沙箱 vs UI 文案）；B5 分批派单，每批过 typecheck |
| **W3** | B6 → B10 串行 | 都碰 `loop.ts` + `config-builder.ts` |
| **W4** | B7 + B12 并行 | B7 碰 `conversation-turns.ts` + `turns/prompt.ts`；B12 碰 `route-components.ts`（B5 已清完） |
| **W5** | B2（无钥回放） | 独立 L 项。**建议等 W1 的 golden 跑满三个月**，确认「golden diff 评审」这件事在我们的节奏里立得住再上 |

## 一件不在清单里但应该单开 chip 的事

`/Users/apple/Desktop/开发项目/WorkHub/.claude/worktrees/` 下 5 份陈旧全量检出（`agitated-bose-7ad50e` / `beautiful-fermat-440e14` / `lucid-wilbur-363a8c` / `nervous-easley-b9f617` / `vigorous-ritchie-6062c2`）污染了每一次全仓统计（i18n 那 682 处、行数、grep 结果），也是「绝不 git add -A」这条纪律的根源。清理或加进 `.rgignore`/`.gitignore`——但记忆里写着 `nervous-easley-b9f617` 上有未合并的成果，**不能盲删，要先确认**。

---

# 三条「别借」的坑

## 别借 1 —— Cordis / everything-is-a-plugin 的全量重构

**它为什么那样做**：dsh 是要做一个**给别人挂插件的 harness**——模型适配器可换、agent loop 可换、沙箱后端可换、子代理后端可以是 Codex 或 Claude Code。为此它付出的代价是 `packages/` 下 4615 个文件、~200 个 npm 包、把 Cordis **源码 vendor 进仓再 rescope 到 `@deepseek-ai/` 命名空间**（`vendor/`，7 个包 + 同步流程 + manifest + SHA 记录），再加 `verify-cordis-config` / `verify-cordis-catalog` / `verify-cordis-api` / `verify-cordis-inspect-catalog` 四个门禁维护它。

**我们为什么不该**：WorkHub 是**一个产品**，不是 harness。我们不需要可换的模型适配器（就是 DeepSeek），不需要第三方插件生态，不需要一个进程里同时跑 web/headless/sdk/acp 四种 profile。我们真正的结构痛点在 `apps/api`——**162284 行、113 个 service 平铺、10252 行手写 openapi**——那是**模块边界**问题，不是 DI 容器问题。给它套一层 Cordis 只会在 162k 行之上再加一层 YAML 组合树，让本来就难读的代码更难读。

**该借的替代品**：`packages/AGENTS.md` 里那 20 条包作者纪律，尤其：
- 「决策在做出它的那个操作里落地」（`:14`）
- 「只在提交点发布状态」（`:15`）
- 「限界要覆盖完整结果」（`:16`，包括包装器和元数据）
- 「要求当前的所有者和需求」（`:11`，每个抽象/状态机/选项/防御性拷贝都要绑到一个当前契约或生产消费者）
把它们抄进 B3 的根 AGENTS.md 当评审规则，成本 0，收益立刻。

## 别借 2 —— Typert（自研类型图生成器 + RPC 网关）

**它是什么**：`packages/typert/` 四个包——generator（构建期分析整个 workspace 的 TS 类型树，产出 `FaceModel` + 类型图 + 可执行 JS + Zod schema）、loader、registry、protocol（`@Remote` / `@RemoteScope` 装饰器）。加上 `packages/api/` 的网关，构成一套「Host 方法标注一下就自动出 Client 类型和 wire 协议」的体系（`docs/api-gateway.md`）。

**我们为什么会想借**：看到 `apps/api/src/openapi.ts` 那 10252 行手写规范，第一反应就是「dsh 那套能自动生成」。

**为什么别借**：Typert 是一个**编译器级别的工程**，量级以人年计，而且它解决的是「Host 和 Browser Client 之间的类型化 RPC」——我们用的是普通 REST + Hono + 已有的 `@workhub/api-client`，问题域根本不同。

**该借的替代品**：借它的 **`gen-X` / `verify-X --check` 成对模式**，实现用我们已有的资产：`packages/contracts` 已经是 78 个文件 25406 行的 **zod schema**。写一个 `scripts/dev/gen-openapi.ts` 从 zod 派生 OpenAPI（`zod-to-json-schema` 一类的现成库，或者我们 `packages/tools/src/registry.ts:22-30` 已经在用的 `toJSONSchema`），生成物提交进仓，`--check` 挂 lint。**这是 M 不是 L**，而且顺手消灭一个 10252 行的漂移源。（不在 Top 12 里是因为它是纯内务，不是从 dsh 学到的新东西；但如果要排 W6，这是首选。）

## 别借 3 —— 逐文件 100% 覆盖率门禁

**它怎么做**：`pnpm run test:coverage` 是 CI 的把关跑，`packages/*/*/src` **逐文件 100% 行覆盖**（`docs/testing.md`）。理由写得很有说服力：「一条未覆盖的行往往是门禁替你标出来的死代码，该删，不是该补测试」。

**为什么它成立**：dsh 的包极小（`packages/guard/repeat-tool-reminder/src/index.ts` 233 行，`packages/core/agent-loop` 全部 2104 行，一个包常常就一个文件），有自建 runner、覆盖率分区并发（`scripts/run-coverage-partitions.ts`）、以及 DeepSeek 自家的推理预算。

**为什么对我们是毒**：我们的文件形状完全不同——`apps/desktop-webview/src/workbench/chat/view.ts` **202KB**、`chat/render.ts` **135KB**、`route-components.ts` ~6200 行、`openapi.ts` 10252 行、`agent-runner.ts` 3138 行。在这些文件上开 100% 覆盖，产出的必然是成千上万条「调用一下、断言不抛」的空测试——**正是 R9 那轮对抗审查已经点名的「伪测试」通病**。而且我们连 linter 都没有，先补 100% 覆盖是把力气用在了最不划算的地方。

**该借的替代品**：dsh 的**测试教义**，不是它的覆盖率数字。四条按性价比排序：
1. **「一个门禁只有在回归能让它红的时候才算门禁」** —— 我们有 12 道 release gate + 5 个 audit，**没有一条被证明过能红**。写进 B3 规约：新增门禁的 PR 必须附「先引入回归 → 看红 → 还原」的证据。这条几乎零成本，价值最大。
2. **「验证世界，不验证自述」** —— e2e 断言要重跑命令、从外部重读文件；对 agent 自己的输出做关键词探测会让作弊的 agent 通过。断言未触碰的文件逐字节一致。
3. **「优先用真实现，别用 mock」** —— 只 mock 昂贵/非确定的边界（LLM 适配器、网络、时钟），下游全真。这条正好是 B2 无钥回放的理论基础。
4. **「测真实入口路径」** —— 测已发布产物（构建后的 `lib/`，用普通 `node`），暴露 tsx 掩盖的失败。我们的 `pnpm test` 全程跑 tsx，这个盲区是真的。

---

## 附：本次侦察更正的三个立项假设

1. **`*.i18n.yaml` 不是翻译资源格式**，是双语文档配对的 git blob hash 一致性记录（`README.i18n.yaml`）。真正的 UI i18n 是每包一份 `src/client/locales.ts` + AST 门禁。
2. **`BRAND_GUIDELINES.md` 不是设计规范**，是商标与命名的第三方使用政策（12 行）。dsh 的设计系统在 `docs/web-styling.md` + `packages/client/ui-theme`。
3. **「我们 1066 处内联三元 i18n」不成立**：产品代码 261 处，全仓 943 处中 682 处来自 `.claude/worktrees/` 的陈旧检出。而且我们本来就有 2136 行的字典系统 —— 真实画像是「字典基本建成，剩 261 处未迁移，53% 挤在一个文件里」。

**另有一条 dsh 教不了我们的**：dsh **没有桌面客户端**（`native/` 是 Linux Landlock 沙箱启动器，不是壳）。我们桌面端的 updater / 公证 / CI 打包这条空白，得另找参考。
