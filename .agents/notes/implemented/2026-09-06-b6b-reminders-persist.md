# 重复动作提醒进运行记录与库（agent_runs.reminders_json）

- Status: implemented
- Date: 2026-09-06
- Owner: claude-code

## Problem

B6（`.agents/notes/implemented/2026-09-06-b6-reminder-events.md`）把「先劝再断」的前两档做成了
`agent_run.reminded` 事件，契约面开了 `agentRunReminderFactsSchema`，三个运行 VM 各留了一个
additive optional 的 `reminders`，`packages/ui` 与桌面 Spotlight 也都写好了渲染。唯独中间那段没接：
**没有人把事件攒进运行记录**，于是 `reminders` 恒为缺席，两端时间线的表现与改动前一字不差。

这段缺口有两个后果，第二个更要命：

1. 回放页读的是库，不是 SSE 流。运行结束之后再打开回放，提醒那一行永远不存在——「劝过」这件事
   在人能回头看的地方从来没发生过。
2. 事件是转瞬即逝的。worker 换人接手（租约回收/重排）、或进程重启之后，已经发生的提醒既不在
   内存里也不在库里，连「这次运行已经被劝过一档了」都无从得知。

B6 那份档案自己把这一跳记成了遗留（「这一段要连持久化一起做，否则 worker 重启后已发生的提醒会丢」）。
这一批就是来补的。

## Decision

**存成 `agent_runs` 上的一列 jsonb（迁移 0075 `reminders_json`），不新开表、不塞 trace。**
形状与同表的 `handoff_json` / `budget_decision_json` 完全同款：一列 jsonb 装一个数组，每个元素就是
contracts 的 `agentRunReminderFactsSchema`（`step_no` / `tier` / `repeats` / `shape` / `tool_id?` / `tool_ids?`）。
提醒天然是 run 的附属事实、条数以个位数计、永远随 run 一起读写，够不上一张表。

**不落 `agent_steps`**——这条是 B6 已经拍过的否决项，这批照旧执行：提醒不是模型的一步，给它发一个
步号会让「跑了几步」这个数字开始撒谎；而且 `AgentRunTraceStepRecord` 只有六个标量列，塞提醒得先给
`agentStepPhases` 加枚举值再加迁移，语义和成本双输。渲染层按 `step_no` 把提醒插在**所属步骤之后**，
它自己不占号。

**列可空、无默认值；`null` 与空数组同义。** 既有行不用回填，新行没被劝过就是 `null`。写入侧空数组
不落列（`toPersistenceRun` 里 `run.reminders?.length` 才带这个键），读取侧空数组读回缺席
（`queueReminders` 空则 `undefined`）。理由是别让「这一列有没有内容」多出一个没有语义差别的第三态：
`undefined` / `null` / `[]` 三者在界面上都是「时间线不渲提醒行」，那就只保留一种表达。
省略键还有一个附带好处：drizzle 在 UPDATE 里跳过 `undefined`，一次不带提醒的进度写不会把已存的
`reminders_json` 清成 `null`。

**在事件出门的那一处累加，不额外发一次写。** 运行器把 `emit` 从 `(event) => emitRunEvent(event, current)`
改成先认一下 `agent_run.reminded`、用 `readAgentRunReminderFacts` 解析（事件专属的 `run_id` /
`work_item_id` 由它自动剥掉）再追加进 `current.reminders`，然后照旧发事件。累加**不触发**任何新的
DB 写：它随这次运行既有的落盘路径（终态/失败的 `persistRunWithTrace`）一起进库，与 `usage`、`handoff`
的落盘节奏完全一致。

这条取舍值得写清楚，因为它决定了持久化的粒度：`agent_runs` 这一行在一次执行里只被写三次
（enqueue 建行、起跑转 running、终态），中途每步只写 `agent_steps`（`replaceTrace`）和心跳。为了让提醒
在**每一步之后**就进库，要么给每条提醒多发一次 run 行的 UPDATE，要么把它搭到 `replaceTrace` 的事务里
去顺手改另一张表。前者是为一年也见不到几次的事实加一条常驻写放大，后者让 `replaceTrace` 名不副实。
两条都不划算：中途崩掉的 run 会被 `requeueExpiredClaims` 重排并**从头重跑**，trace 整个被 `replaceTrace`
换掉——上一轮的提醒本来就是过期数据，特意为它保命反而会让时间线出现两轮混在一起的提醒。所以「随
既有落盘路径」既是省一次写，也是对的语义。

**累加带守卫，且封顶 32 条。** 守卫与 `recordStep` 同款：从 `runs` map 取 live 记录、`status !== "running"`
（被取消/租约被回收）就不写；spread `live` 时显式带上 `current.usage`，否则 `recordUsage` 只写 `current`
不写 map 的最新用量会被盖掉（这个坑 `recordStep` 里已经踩过一次并留了注释）。
`AGENT_RUN_REMINDER_CAP = 32` 纯属防御——正常一次运行最多两条（第一档一次、第二档一次，第三档改走
`agent_run.escalated`），真出现病态序列时别让一列 jsonb 无限长。到顶后**丢新的留旧的**：最早那两条才是
解释这次运行为什么会升级的证据，后面的重复只是噪声。读取侧用同一个常量、同一个方向截断。

**读回宽容到条，不宽容到列。** `queueReminders` 逐条走 `readAgentRunReminderFacts`，解析不出来的整条
丢掉（宁可少一行，也绝不把半截数据编成一句话）；整列不是数组（历史脏数据/手改）则整列当缺席，不猜、
不半读。两端渲染层本来就共用同一份宽容读取，服务端这层是同一条纪律往前挪了一站。

**两个 VM 各加一行透传，仍然是 additive optional。** `toAgentRunLiveVm`（实时页）与
`buildReplayTracePage`（回放页）都只在 `reminders?.length` 时带这个键。第三个 VM
`agentRunTraceVmSchema` 仓内没有任何生产者（纯契约面），这批不造一个出来。

## Alternatives considered

- **每条提醒多发一次 run 行 UPDATE**，让提醒在下一步之前就落库：见 Decision——为极低频事实加常驻写
  放大，而中途崩掉的 run 会从头重跑、上一轮提醒本就是过期数据，保住它反而让时间线更乱。
- **把 `reminders_json` 的写搭进 `replaceTrace` 的事务**（那是每步都会跑的既有写）：一次调用改两张表，
  `replaceTrace` 这个名字就不再说实话；而且每步都要重写整列，写放大反而更大。
- **另起一张 `agent_run_reminders` 表**：条数以个位数计、永远随 run 一起读写、没有任何独立查询需求，
  一张表换来的是一次 join、一份迁移、一套仓储方法。`handoff_json` 当年也是同样的判断。
- **让前端从 SSE 流自己攒**：B6 已经否过一次——仓内没有任何前端保留 run 事件用于展示（回放页收到事件
  是触发整页重拉），只发事件等于观测面停在「有一条 SSE，没人渲」。这批只是把结论落到服务端。
- **提醒也塞进 trace 步骤**（复用现成的 `AgentStep[]` 渲染）：B6 已否——占步号会让「跑了几步」撒谎。
- **读取侧不做上限**：读回的本来就是写入侧写的，理论上不会超。但脏数据/手改是真实存在的运维面，
  一列畸形 JSON 不该能把整页时间线撑爆，所以两侧同一个常量各截一次。

## Consequences

- **迁移 0075**（`0075_agent_run_reminders.sql`，journal `idx:75`、`when: 1783929007000`，严格大于 0074）。
  全 additive：`ADD COLUMN IF NOT EXISTS`、可空、无默认，migration-audit 的整链 replay 重跑安全。
- **`AgentRunQueueRecord` 多一个可选字段**。所有 spread 式的记录构造（`finalizeExecutedRun`、
  `recordStep`、恢复路径的 `toQueueRun`）天然带着它走，无需逐处补写。
- **落盘节奏 = 与 `usage` / `handoff` 同档**：run 行的写发生在 enqueue / 起跑 / 终态三处。运行**结束后**
  的回放页一定看得到提醒；运行**进行中**换 worker 接手则看不到上一轮的提醒——但那一轮本来就要从头重跑。
  这是刻意的取舍，不是漏接线。
- **`agent_run.reminded` 事件本身一字未动**，`packages/agent` / `packages/contracts` / `packages/ui` /
  桌面端全部零改动（B6 已定型）。openapi 的 `agentRunLive` / `replayTrace` 两个响应 schema 在 B6 就已经
  声明了 `reminders`（两者都是 `additionalProperties: false`，漏声明等于把这一列宣布成非法字段），
  这批不用再动。
- **模型可见文本零变化**：`buildDoomLoopReminder` 没碰，`pnpm gen:expected` 跑完无 diff。
- **真 PG 门加了一条断言**：`qa:r1-pg-agent-run-smoke` 在迁移跑完后查 `information_schema`，要求
  `agent_runs.reminders_json` 是**可空、无默认**的 jsonb。列不在就等于「被劝过几次」只活在 SSE 流里。
  本机一次性 `postgres:16` 容器实跑通过；把该列 drop 掉后这条断言按预期报错（验证非空跑）。
- **`agent-run-persistence.ts` 现在从 `workers/agent-runner.js` 取一个值**（`AGENT_RUN_REMINDER_CAP`），
  与既有的反向 import（agent-runner → `getDefaultAgentRunPersistence`）构成一个 ESM 环。两边都只在函数体里
  用对方的绑定、模块顶层不读，因此没有 TDZ 风险；`apps/api` 全量测试与 typecheck 已覆盖两种加载顺序。
  真要拆环，该常量应该搬到一个两边都能引的小模块，那超出本批范围。
