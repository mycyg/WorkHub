# 重复动作提醒的观测面（agent_run.reminded + 两端时间线）

- Status: implemented
- Date: 2026-09-06
- Owner: claude-code

## Problem

B6「重复动作先劝再断」（`.agents/notes/implemented/2026-09-05-repeat-tool-reminder-tiers.md`）
落地后，前两档提醒只存在于**模型可见的对话线**里：运行环境往对话里追加了一句「你已经连续 N 步…」，
模型看得见，人看不见。界面上唯一的迹象是这次运行多烧了几步，然后要么自己走出来、要么在第八步
突然升级成 `agent_run.escalated`——中间那两次「劝过」既没有事件、也没有任何一行界面。

那份落地档案自己把这件事记成了否决项（「为提醒新增一个事件类型：要动 contracts 的事件枚举与
openapi，范围外。提醒本身在对话线里，需要时再补事件」）。这一批就是来补的：Cuu 被劝了几次、
劝的是什么，得能在时间线上读到。

## Decision

**新增事件类型 `agent_run.reminded`，不复用 `agent_run.step` 加 `kind`。** 理由是形状：
`agent_run.compacting`（压缩）与 `agent_run.escalated`（升级）都是「运行环境介入了」这一类，
各自有独立事件类型；`agent_run.step` 的各种 `kind` 全是「模型这一步产出了什么」（thinking /
text / tool_call / stream_event / provider_retry）。提醒是前者不是后者——它恰好是升级的前两档，
和 `agent_run.escalated` 是同一条判定链上的三档，做成兄弟事件类型最贴既有形状。附带的好处是
消费方能按事件名过滤（桌面 per-run SSE 就是显式事件名订阅，见下方 Consequences）。

**payload 只带事实，不带句子。** `agentRunReminderFactsSchema`（`contracts/domain/agent.ts`）：
`step_no` / `tier`(1|2) / `repeats` / `shape`(identical|alternating) / `tool_id?` / `tool_ids?`。
事件 data 在此之上加 `run_id`（+ 运行器补的 `work_item_id`）。中英文句子由两端各自按 locale 组装：
事件里塞中文句子会让英文界面无法本地化，也会把**模型可见**的提醒正文和**用户可见**的界面文案
锁死在一起——那两份文本的读者不同，措辞标准也不同（一个要让模型改行为，一个要让人看懂发生了什么）。

`tool_ids` 只在一次重复涉及不止一个工具（交替形态两边工具不同）时出现，单工具只留 `tool_id`，
同一事实不存两份。两者都允许缺席（重复的那一步理论上可以没有工具调用），渲染层要能退回不提工具的说法。

**两套引擎同点同形状。** `loop.ts` 在提醒真正被 push 进 messages 的那一行发；
`loop2/config-builder.ts` 在 `shouldStopAfterTurn` 里暂存提醒的同一行发。两处都紧跟在这一步的
`agent_run.step(control)` 之后（loop2 的 `shouldStopAfterTurn` 跑在 `turn_end` sink 之后），
因此在事件序列里落在同一个位置。`equivalence.test.ts` 的事件投影补上 `tier/repeats/shape/tool_ids`
逐条 deepEqual，另加两条专项用例（全同链路两条提醒 + 第三档只发 escalated；交替形态带两个工具名）。

**第三档不重复发。** tier 3 在两套引擎里都提前 return 到升级路径，走不到发事件这一行。

**时间线渲染：事实进 VM，句子进词典。** `AgentRunLiveVM` / `ReplayTraceVM` / `AgentRunTraceVM`
各加一个 additive optional 的 `reminders` 数组（缺席与空数组同义，存量客户端零回归）。
`packages/ui`（实时页 + 回放页）与桌面 Spotlight 回放视图各自把提醒渲成**独立一行**，插在它所属
那一步之后——提醒不是模型的一步，不占步号、不冒充 `AgentStep`，`stepCount` 也不变。
对不上任何已渲染步骤的提醒补在时间线末尾：劝过就不许在界面上看不见。

文案是八条完整句子（档位 × 重复形态 × 有没有工具名）× 中英，不是拼半句——中英文的标点与语序
不一样，拆成碎片拼装迟早拼出病句。工具名先过 `humanizeAgentToolId`（取 `__` 最后一段、下划线换
空格）再按语言加引号（中文直角引号 + 顿号，英文弯引号 + 逗号），界面上不再可能出现 `run_command`、
`mcp__gh__list_issues` 这类原始 id。仓内没有既有的「工具 id → 人话名」对照表，所以不做任何猜词映射；
将来有了对照表，由调用方先查表、查不到再退到这个去下划线版本。

## Alternatives considered

- **复用 `agent_run.step` + `kind: "reminded"`，preview_text 直接写中文句子**：能白捡桌面 Cuu 卡片
  的现成渲染（`cardFromAgentRunEvent` 拿 `preview_text` 当卡片正文）。否决两条理由：一是
  `packages/agent` 也在 `audit:ui-i18n` 的扫描面内，loop 里新写中文字面量过不了门（既有的
  `previewText` 要么是机器串如 `doom_loop`，要么已在基线里）；二是英文界面会直接看到中文句子。
  改成结构化 payload + 两端组词后，`previewText` 只留机器串 `repeat_reminder tier=N`。
- **把提醒落成一条 `agent_run_steps` 行**，这样现有时间线（渲的是 `AgentStep[]`）不用改就能看见：
  要给 `agentStepPhases` 加枚举值 + 数据库迁移 + 运行器 recorder 改动，而且语义是错的——提醒不是
  模型的一步，混进步号会让「跑了几步」这个数字开始撒谎。
- **只加事件、不动 VM**，让前端从 SSE 流里自己攒：仓内没有任何一个前端保留 run 事件用于展示
  （web 回放页收到事件是触发整页重拉，桌面 run 卡是触发 `getAgentRun` 重取，Spotlight 回放视图走
  trace 游标轮询）。只发事件等于观测面停在「有一条 SSE，没人渲」。
- **在事件 payload 里直接给渲染好的句子**：见 Decision——两端无法本地化，且会把模型可见文本与
  界面文案绑死。

## Consequences

- **事件枚举增一项**：`eventTypeSchema` 由 `Object.values(eventTypes)` 生成，新类型自动进契约面。
  `toCuuState` 映到 `thinking`（不是 `worried`）——前两档只是自救提示，运行仍在继续；`worried`
  是「需要人介入」的信号，那由第三档的 `agent_run.escalated` 负责。
- **EventSource 是按事件名订阅的**：桌面 per-run 流的 `desktopCuuRunStreamEventNames` 必须显式登记
  新事件名，漏登记就被静默丢弃（web 的 `live-stream-targets.ts` 早有同款教训）。已登记。
- **openapi 的 `agentRunLive` / `replayTrace` 两个响应 schema 是 `additionalProperties: false`**，
  所以 `reminders` 必须同步声明，否则等于把这一列声明成非法字段。已同步。事件本身不进 openapi：
  `/api/push/stream/*` 一律只声明 `text/event-stream` 字符串，从不逐类枚举事件形状。
- **模型可见文本零变化**：`buildDoomLoopReminder` 一个字没动，`pnpm gen:expected` 跑完
  `packages/agent/expected/doom-loop-reminder.*` 无 diff。
- **还差最后一跳（本批范围外）**：事件已发、VM 字段已开、两端渲染已就位，但把
  `agent_run.reminded` 攒进运行记录再喂进 VM 的那一段在 `apps/api` 的业务代码里
  （运行器的 run 记录 + `apps/api/src/pages/replay.ts` 的 `toAgentRunLiveVm` / replay VM 组装 +
  trace 持久化）。补上之前，`reminders` 恒为缺席，时间线表现与改动前完全一致（additive optional
  的既有取舍）。这一段要连持久化一起做，否则 worker 重启后已发生的提醒会丢。
