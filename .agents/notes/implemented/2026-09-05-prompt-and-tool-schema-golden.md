# 提示词与工具 schema 的逐字节 golden 门

- Status: implemented
- Date: 2026-09-05
- Owner: Claude（R25 批 B1，借鉴 deepseek-harness `snapshots/AGENTS.md` 的 gen/verify 成对模式）

## Problem

AGENTS.md 评审规则第 8 条早就写着「稳定的模型可见文本变化要有可见的评审证据（golden/snapshot
或端到端覆盖）」，但仓库里一份 golden 都没有——这条规则此前无处落地。

模型可见文本（系统提示词、初始用户消息、工具的 name/description/input_schema）有两个别的测试拦不住的性质：

1. **没有「无关紧要的差异」**。一个标点、一处换行、一个字段顺序的变化都会改变模型行为与 token 成本。
   既有单测对提示词的断言全是关键词命中式的（`assert.match(prompt, /outputs\//)`），恰好放过这一类改动。
2. **改动极易搭便车**。提示词分散在两套引擎 + 十来个服务里，一次重构顺手动一个字，评审时没人看得见——
   diff 里它只是一行字符串常量。

## Decision

在 `packages/agent/src/golden/expected.ts` 落一个**逐字节**比对的 golden 基元，被两个包共用：

- 比对 `Buffer`，不 trim、不归一化、不排序 JSON 键——因为这道门唯一想拦的就是「看起来无所谓的差异」。
- 确定性靠夹具承担（固定 id/日期/样本），因此不需要 dsh 那样的 `{{token}}` 归一化层。
- 落盘口径：提示词 `*.expected.md`，schema `*.expected.json`（2 空格缩进，键序=生产代码插入序）。
- 不一致时报错带首处差异与重生成命令；`WORKHUB_UPDATE_EXPECTED=1`（或 `pnpm gen:expected`）重生成。

覆盖 47 份 expected（`apps/api/expected/` 28 + `packages/agent/expected/` 19），按「模型看到的字
不一样」逐条分支，而不是每个函数一份 happy path：

| 层 | 覆盖 |
| --- | --- |
| agent run | 系统提示词（默认工人 / 项目指令+团队技能完整态）、初始用户消息（最小 / 工单上下文+任务计划+双层记忆+project/）、工具 schema 可见集、工具文案参考 |
| 两套引擎 | `createAgentLoop().run` 与 `runAgentLoop2` 各自真正发给 provider 的 `system`/`tools` |
| 对话轮次 | 系统提示词（最小/完整）、历史消息（含超长截断）、工具可见集（两 actor 态）、上下文压缩（首次/滚动）、记忆引用 |
| packages/agent 判定链路 | observer（系统+用户，含空态与三处截断上限）、reply-judge（有/无历史）、spotlight-intent（有/无能力清单） |
| apps/api 服务 | 会议分析（locale 中英）、技能策展（有/无人类反馈）、技能精修（有/无激活技能、正文截断）、项目计划起草（locale 中英、重拟反馈）、项目计划评审、跨 agent 评审（单视角/三视角投票）、澄清反问（locale 中英、有/无文件） |

**两套引擎那条断言没有写成「逐字节全等」**，因为实测两套并不全等。改成具名允许清单
`KNOWN_ENGINE_DELTA`：`system` 与工具的 name/description/input_schema 必须逐字节相同，剩下的结构差异
必须**恰好**等于清单内容；新增差异或既有差异消失都会红。

清单当前只有一条，是这轮实测出来的一个既有现象：传统 loop 把 `toModelTools()` 的返回值原样塞进请求体
（`packages/tools/src/registry.ts:98` 带出的 `side_effect` 也一起上 wire，见
`providers/anthropic-compatible.ts` 的 `body.tools = params.tools`），而 loop2 的 `makePiTool`
（`loop2/config-builder.ts:407`）只投影 name/description/parameters。`side_effect` 是 WorkHub 私有字段，
对模型无意义，legacy 路径把它发给 provider 属于多余负载。**本轮只记录不修**——改 wire body 是产线行为
变更，不该搭在一道测试门的便车上。

为把私有组装点纳入门内，做了**只加 `export` 关键字**的重构（函数体逐字未动）：
`project-planner.ts` 的 `plannerPrompt`/`judgePrompt`、`cross-agent-judge.ts` 的
`candidatePrompt`/`judgePrompt`/`HIGH_RISK_VOTE_PERSPECTIVES`、`work-items.ts` 的
`clarificationPrompt`/`ClarificationQuestionInput`。这三处本来就是纯函数（输入全在参数里，不碰 DB、
不读时钟、不生成 id），所以「分离拼字符串与取数」这一步在此前就已经完成，只差没导出。
`agent-runner.ts` 的两个组装闭包则真的提了出来，落到新文件 `workers/agent-run-prompt.ts`。

## Alternatives considered

- **语义/关键词比对**（沿用既有 `assert.match` 风格）：放过的恰好是这道门唯一想拦的东西——
  一个标点、一处换行、一次字段重排都能过。否。
- **快照库（vitest `toMatchSnapshot` 等）**：本仓 node:test 为主，且快照库默认「跑一下 -u 就过」的
  工效学正是要避免的——expected 必须是提交进仓、在 PR diff 里看得见的文件。否。
- **两套引擎断言逐字节全等**：写下去就是红的（`side_effect`）。要么顺手改产线（越界），要么把断言
  放水成「差不多相等」（等于没门）。选了第三条：具名允许清单，把现状写死并让任何偏移变红。
- **给超长截断态落整份 golden**：会议转录截断需要 24000 字符填充，仓库要多背 70KB 噪声，而报错的
  `firstDiff` 是按行比对的——一整行 24000 字符的 diff 不可读，那样的 expected 只是看起来像门。
  改用两条精确断言钉住该支独有的提示语与截断算术。
- **同时覆盖 `reviewDeliverable` / `tryGenerateStructuredSummary`**（loop.ts 的评审与压缩提示词）：
  前者的用户提示词由 `collectOutputExcerpts(workdir)` 真读磁盘文件拼出，要落门得先把「读文件」与
  「拼字符串」拆开——那是一次真重构，不该塞进这一批。见下方遗留。

## Consequences

- 改任何提示词或工具 schema，`pnpm test` 会红并给出首处差异；正确做法是 `pnpm gen:expected`
  重生成 + **读一遍 diff** + 把 diff 摘要贴进 PR。已写进 AGENTS.md 纪律条。
- expected 文件是生成物，纳入「重生成而非手改」那条纪律。
- 工具 `side_effect` 上 wire 这个现象被清单钉住了但没修；将来清理它时，`KNOWN_ENGINE_DELTA`
  会红一次，要顺手清空该清单。
- **仍未覆盖**（都不是遗漏，是各有明确阻塞）：
  - `loop.ts` 的 `reviewDeliverable`（需先分离 `collectOutputExcerpts` 的磁盘读取）与
    `tryGenerateStructuredSummary`（需要一个可注入的 `compactionClient`，且 `buildCompactionTranscript`
    与三个提示词常量都未导出）；
  - `meta-planner.ts` / `merge-fusion-candidates.ts` / `agent-memory.ts` 的提示词——与已覆盖的
    project-planner / 策展同构，属于同一模式的第 N 份，本批按优先级留到后续；
  - 「管理员 vs 普通成员」的工具可见集：**这个维度在本仓不存在**。工具可见性只有两条闸——
    agent run 的任务计划角色（`canUseToolForTaskPlanRole`）与 turn 的 `allowCreateWorkItem`，
    两条都已覆盖，没有任何按 `isAdmin` 分叉的工具集。
  - 插件工具的翻译形状：**本仓没有插件工具**（全库无 plugin tool 概念），无从落门。
