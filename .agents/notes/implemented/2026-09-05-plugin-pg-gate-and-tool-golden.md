# 插件治理的真 PG 门与插件工具的模型可见 golden

- Status: implemented
- Date: 2026-09-05
- Owner: Claude（R26 工位 W-V）

## Problem

插件面上有两条被上一轮明确记下、又都没做的收口：

1. **阶段 1 治理没在真库上跑过。**`2026-09-05-dsh-plugin-phase1-governance.md` 落的是迁移 0072
   加五个管理员端点，但覆盖它的只有内存仓储的单测。于是三件事没有任何证据：0072 在 journal
   整链跑完之后到底建出了什么（唯一索引、三条 CHECK、两条外键）、「同一目录装两次」那个 409
   是不是真的靠唯一索引、以及**启停之后宿主按新清单热重载，这个工作区的工具注册表是不是真的
   跟着增减**。最后一条尤其关键——它就是「装了插件到底有没有用」这个问题本身。
2. **插件工具的模型可见文本没有 golden。**`2026-09-05-prompt-and-tool-schema-golden.md` 把
   「插件工具的翻译形状」写成**合并后的第一优先补丁**：那一批的分支基线上全库还没有插件面，
   而插件工具会经 `to-tool-spec.ts` 翻成 `ToolSpec`、并进默认注册表，于是通过 `toModelTools`
   的 name/description/input_schema 通道对模型可见——一段第三方文本进模型上下文的通道，
   正是逐字节 golden 门存在的理由。

## Decision

**两条门各补一份，都跑在既有基建上，不新起一套。**

### 一、`qa:r1-pg-plugin-smoke`：真 PostgreSQL 的治理链

新增 `apps/api/src/qa/r1-pg-plugin-governance-smoke.ts`，在 verify.yml 的
**r1-pg-smoke job 里追加一步**（同一个容器、同一份 env，不新开 job）。八段：

| 段 | 钉住的事 |
| --- | --- |
| 0072 表形状 | 14 列 / 4 索引 / 6 约束逐条核对——证明的是「整链跑完之后这张表还在且没被改坏」 |
| 空清单 | `plugins: []` 且 `bootstrap_path_count: 0`（不设 `WORKHUB_PLUGIN_PATHS`，清单只来自表） |
| 非管理员 | 四个端点全 403 `plugin_admin_required`，用真的认证解析出来的普通成员，不是手捏 actor |
| 体检拒装 | 假目录 / 有 `dsh.client` / 有安装期脚本 三类各自的错误码不许混，且被拒的不留行 |
| 安装 | 201、`status='installed'`、`load_report.ok`、`tool_count=1`、`installed_by` 指向真管理员；再装一次 409 |
| 工具注册表 | `toolSpecs({workspaceId})` 装完有 / 停用没 / 再启用又有；另一个工作区看不到 |
| 移除 | 清单空、工具消失、对同一个 id 再动手是 404 |
| 审计 | 四个写动作各**恰好一条**，都带工作区、操作者、插件名、来源路径 |

**可观测点选的是 `PluginHostClient.toolSpecs({ workspaceId })`，不是新开一个只读接口。**
它就是 agent-runner 的 `defaultPluginToolsProvider` 走的那一条（`agent-runner.ts:299`），
所以它返回什么，这次执行里模型就能看到什么——这是产线路径本身，不是为了测试造的观测口。
补一个新端点只会多一份要跟着治理面漂的表面。

起库 / 种子 / 鉴权 / 错误信封抽到 `apps/api/src/qa/r1-pg-harness.ts` 由两条门共用
（`assertNotProduction` / `ensureDefaultSeed` / `seedAdminHeaders` / `withErrors`）。
`withErrors` 与 `app.ts` 的 onError 同口径，且补上了 `PluginServiceError`——冒烟自己拼 Hono app，
不带这一份的话 403/404/409/422 会被兜底压成无语义的 500。

`seedAdminHeaders` 顺手做了一件 r1 原先没做的事：**轮换种子管理员的 cookie 令牌**。
种子令牌是每进程随机生成的（`seed.ts` 的 L36），而 `ensureDefaultSeed` 是 `onConflictDoNothing`——
所以在一个已经跑过一次的库上，库里存的是上一次那个进程的令牌，本进程签出来的 cookie 认不出来。
CI 每次都是新库所以从没暴露，本机复跑才是常态。轮换之后两条门在同一个库上都能重复跑。

### 二、`plugin-tool.golden.test.ts`：四层模型可见形态

落 `apps/api/src/golden/`（那里已经有 `@workhub/agent/golden` 与 `@workhub/plugin-host`），
四份 expected 都小到能读：

- `plugin-tool-spec` —— **真起一个宿主子进程**加载 echo 夹具，翻成 `ToolSpec` 之后的非函数面。
- `plugin-tool-model-view` —— `toModelTools` 里的那一项 + 按任务计划角色的可见性。
- `plugin-tool-engine-request` —— 两套引擎真正发给 provider 的请求体里插件那一项。
- `plugin-tool-sanitized` —— 一份「不老实」的插件文案经 `sanitizePluginText` 之后的样子。

这道门第一次生成就照出一条**新事实**：`canUseToolForTaskPlanRole` 只放行 `none` / `sandbox_file`，
而插件工具一律 `external_effect`——**插件工具是本仓第一个 `external_effect` 工具**，
于是 `research` / `review` 角色看不到它。`agent-run-prompt.golden.test.ts` 里那条
「三种角色可见集当前一致（因为出厂工具集里这两档一个都没有）」的断言，从此只对**不装插件**的
部署成立。新 golden 把这条差异显式落盘：装了插件之后，调研/评审子任务用不了它。

另外钉住阶段 0 的硬约束：**装了插件之后系统提示词逐字节不变**。这不是碰巧——
`to-tool-spec.ts` 显式不设 `promptSnippet`/`promptGuidelines`，而系统提示词的
「可用工具（Available tools）」清单正是由 `promptReference()` 的 snippets 拼的。宿主那一侧同理：
dsh 插件的 `ctx.systemPrompt.section()` 只被 host 收集成一个**计数**（`promptSectionCount`），
section 正文根本不过线协议——`ListToolsResult` 里没有任何字段承载它。所以
**`ctx.systemPrompt.section` 尚未接线，本轮 golden 只覆盖工具面**；将来真接进去时这条断言会先红。

## Alternatives considered

- **为「工具注册表里有没有这个插件工具」补一个只读观测端点。** 否决：产线已经有这条路
  （`toolSpecs`），冒烟直接调它就是在验产线；新端点只是多一份要跟着漂的表面，
  而且它的存在会让人以为治理面还缺一个读口。
- **把插件 golden 放进 `packages/plugin-host`（更贴翻译层），在那儿接一套 `gen:expected`。**
  否决：`assertGolden` 住在 `@workhub/agent/golden`，plugin-host 要用就得新增一条
  `@workhub/agent` 依赖——一个叶子包为了测试反向依赖一个重包，还要动 lockfile。
  两套引擎的请求体本来也只有 `apps/api` 这一侧拼得出来，放一起反而是一份完整的链。
- **在 golden 里手写一个 `PluginToolDescriptor` 常量，省掉宿主子进程。** 否决：那样钉住的是
  「我以为宿主会报什么」。这条链上有三段各自会漂的翻译（dsh `defineTool` 归一化、
  `translate.ts` 的 `toJsonSchema`/`describePluginTool`、`to-tool-spec.ts`），手写常量把它们全绕过去。
  实测一次握手约 1 秒，整个文件只握手一次（模块级 memo），代价可接受。
- **给 4000 字符截断态落一份完整 expected。** 否决：`assertGolden` 的 firstDiff 按行报差异，
  一整行 4000 字符的前后对照不可读——那样的 expected 只是看起来像门。改用精确断言
  （长度 = 上限 + 1、保留头、结尾省略号、尾巴不留），与 B1 批对超长转录的处置同一条理由。
- **把 `qa:plugin-smoke`（阶段 0 那条端到端）也一并塞进 CI。** 本轮范围外，见下方遗留。

## Consequences

- **verify.yml 的 r1-pg-smoke job 多一步**，跑在 r1 之后、同一个库上（已按这个顺序在本机实跑验证过）。
  两条门共用 `r1-pg-harness.ts`：改那个文件会同时影响两条门，改动要按两条门都跑一遍。
- **改插件夹具、改 `translate.ts`/`to-tool-spec.ts`、放宽 `external_effect` 保守口径、
  或把插件文案接进系统提示词**，都会让新 golden 变红。正确做法照旧：`pnpm gen:expected`
  重生成 + 读一遍 diff + 把 diff 摘要贴进 PR。
- **`agent-run-prompt.golden.test.ts` 里「三种角色可见集一致」那条断言仍然绿**——它构造的注册表
  不含插件。两条断言现在共同描述完整事实：不装插件时一致，装了插件之后 research/review 少一项。
- **仍未覆盖**：
  - `ctx.systemPrompt.section` 的正文没有过线协议，所以**插件对系统提示词的注入面为零**，
    golden 只覆盖工具面。哪天要接，得先给 `ListToolsResult` 加字段，那是一次协议变更 + 一次
    提示词注入面扩张，两件都要独立评审。
  - `qa:plugin-smoke`（阶段 0：插件工具真的被 Cuu 调起来 + 落审计）**至今不在 CI 里**——
    它不需要 PG 也不需要 key，本机稳定通过，但没有任何 job 跑它。要不要挂进 workspace job
    留给指挥者拍板（它会起一个 tsx 子进程，是这条 job 里的第一例）。
  - 插件工具的**执行侧**在真 PG 上没跑（本门只到「工具出现在注册表里」）。真调用那一段由
    `qa:plugin-smoke` 用假 provider + 内存仓储覆盖；两条合起来才是完整链，但它们跑在不同的门里。
