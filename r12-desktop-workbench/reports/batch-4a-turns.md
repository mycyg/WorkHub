# 批 4a 完成汇报（协同会话 turns · 服务端切片）

日期: 2026-07-12 · 执行: Claude · 分支: `r12/batch4a-turns`（从 `r12/workbench-full` @ `356dac83` 切出）

> 范围声明：这是批 4「协同会话 + 模式五档」里**只做服务端 turns 通道**的窄切片，按集成者预先拍板的
> 设计决策实现。产出卡（+a −b 撤销/交给审核）、`#`/`@`/`/` 三类引用展开、chips UI、模式五档的执行侧
> gate（本批只做「mode=1 拦纯聊天」这一条最小语义）、judge、5 档 auto_merge 全托管合并——都归批 4b，
> 本批不做，路由/服务里也没有为它们预留假接线。

## 做了什么

三句话人话版：协同会话（单聊）现在能真的让 Cuu 回一句话了——发一条消息后 `POST /conversations/:id/turns`
会调真 LLM、边生成边把文字碎片广播出去、说完整句话后落一条真消息（带序号，能翻页看到）。会看用户的
记忆偏好和团队技能库，回话里会标出用了哪几条。但这一批不建工单、不接执行/审核，纯聊天而已；五档模式
现在只管一件事——档位 1（只观察）不让这条通道回话。

### 1. `packages/db/src/repositories/conversations.ts`（仅新增，未改动任何既有函数签名/行为）

- 新增 `createCuuMessage(input)`：往 `conversation_messages` 落一条 `sender_type='cuu'`、
  `sender_user_id=null`、`kind='text'` 的消息，走同一套原子 `next_seq` 分配（`UPDATE ... WHERE next_seq =
  currentSeq RETURNING`），保证 `UNIQUE(conversation_id, seq)` 不撞车。比 `createUserMessage` 精简——
  Cuu 不是 workspace 成员，不复用它那两段人类发言人的 membership/participant 锁；调用方
  （`services/conversation-turns.ts`）在调用前已经用 `findVisibleAccessRecord` 确认过发起 turn 的
  人类是这个会话的可见参与者。
- `ConversationRepository` 类型新增这一个字段；仓库层内容校验只做轻量防御性形状检查（非空
  text + 数组形状），完整的 `conversationTextContentSchema` 边界校验留给服务层的
  `parseOutputContract`——同 `createUserMessage`/`assertMessageContent` 的既有分工一致，不重复两份
  会漂移的校验逻辑。
- 单测：`packages/db/src/conversation-repository.test.ts` 新增 6 条（用既有 `createQueryRecorder`
  夹具），覆盖：正常落库+seq 分配+只 3 把锁不碰 membership/participant 表、内容校验拒绝空文本/非数组
  引用、会话不可见时 fail-closed、错误 thread_root、seq 耗尽、insert 空返回。

### 2. `apps/api/src/services/conversation-turns.ts`（新）

`createConversationTurnService(deps)` / `getDefaultConversationTurnService()`，仿
`apps/api/src/workers/conversation-observer.ts` 的依赖注入/LLM 调用/软预算模式：

- **鉴权与门禁**（按拍板顺序）：并发闸（见下）→ `findVisibleAccessRecord` 拿会话可见性
  （复用 conversations 仓库既有方法，fail-closed 404，同时天然判定发言人是不是可见参与者）→
  `kind !== 'collab'` → 409 `conversation_turn_not_collab` → 读 `user_ai_profiles.default_mode`
  （`aiSettings.findUserProfileAccessRecord`，缺行落 `DEFAULT_USER_AI_PROFILE.default_mode=3`）→
  `mode===1` → 409 `conversation_turn_mode_observe_only`（mode 2-5 都放行纯对话 turn，执行/审核语义
  的档位区分归批 4b）→ 校验 `user_message_id`（见下）→ 软预算闸 → 429
  `conversation_turn_budget_exhausted`。
- **并发闸**：`Set<conversationId>`，进程内、**函数体第一个同步动作**（在任何 `await` 之前）—— 两个
  并发请求在同一 tick 里先后调用时，第一个会同步跑完「检查+占位」才让出控制权，第二个紧接着同步
  执行到同一行时一定能看到占位已存在，保证闸是确定性的而不是取决于后续多个 `await` 的微任务交错
  顺序。代价是未过访问权限校验的请求也会短暂占用/释放这个会话的忙碌位（只泄露"这个会话 id 当前有
  turn 在跑"，`try/finally` 保证失败请求立刻释放）。**多进程部署下这不是完整闸**——见下「缺口」。
- **`user_message_id` 校验**：不新增仓库查询方法（范围围栏只批准 `createCuuMessage`）。做法：用
  既有 `listMessagesAfter` 拉一个有界窗口（默认最近 50 条，`afterSeq = max(0, nextSeq-1-50)`），在
  窗口里找 `id === user_message_id` 且 `sender_type==='user'` 且 `sender_user_id` 匹配发言人，三者
  都不满足就 404 `conversation_turn_message_not_found`。这个窗口同时也是 LLM 多轮对话的历史上下文
  ——一次查询做两件事，没有额外往返。**已知边界**：如果引用的消息比窗口更旧（超过最近 50 条），会
  报 404；正常场景下 `user_message_id` 就是发言人刚 POST 的那条，必然在窗口最新端，这条边界只影响
  「隔了 50+ 条消息之后才补触发 turn」这种反常调用序。
- **软预算闸**：与观察者 `checkObserverBudget` 同款理由复述（`decideRunBudget` 读团队维度用量快照
  做门槛判断，不参与原子 reservation 互斥）——见下「缺口」逐字复述批 3 记录在案的那条根因。
- **记忆/技能注入**：`userMemories.listForUser(userId, {limit: USER_MEMORY_PROMPT_TOP_N=5,
  workspaceId})` + `teamSkills.listActive(workspaceId).slice(0, 5)`，拼进 system prompt（用
  `packages/agent/src/turns/prompt.ts` 的纯函数），实际注入的条目原样落 `memory_citations`。
  注入后对用到的 user_memories 调 `touch()`（保持"最近使用"排序语义与 agent-runner 路径一致）；
  `touch()` 失败 fail-open，不影响这轮回复。
- **流式**：`client.messages.stream({..., signal})`（真实 wiring 用
  `ProviderRegistry.get(actor, "assistant").messages.stream`，与 `LlmCreateParams`/
  `MeasuredLlmClient.messages.stream` 结构性兼容）；逐个 `content_block_delta`/`text_delta` 事件
  发 `conversation.message.delta`（见下契约变更），`ordinal` 从 0 递增；`getFinalMessage()` 拿完整
  文本落库。
- **超时**：60s 硬上限（`AbortController` + `setTimeout(() => controller.abort(), timeoutMs)`，
  `timeoutMs` 可注入测试用小值）；**任何** LLM 失败（含超时）统一映射 500
  `conversation_turn_failed`，`createCuuMessage` 在 catch 路径之后才会被调用，保证不落半截消息。
  空文本回复（trim 后长度 0）同样落 500，不落一条空消息。
- 默认 wiring：`getDefaultConversationTurnService()` 用 `getSharedDatabaseClient()` +
  `createConversationRepository`/`createAiSettingsRepository`/`createUserMemoryRepository`/
  `createTeamSkillRepository`（均为已有仓库工厂，未新增）+
  `createActionCardRepository(db).listNicknamesByUserIds`（复用批3已有的通用昵称查找，只读不改）+
  `getDefaultProviderRegistry()` + `getDefaultBudgetPolicyStore()`/`getDefaultCostLedgerStore()`
  （均为已有 api 服务单例）。
- 单测：`apps/api/src/conversation-turns.test.ts`，19 条，覆盖非人类 actor 403、会话不可见 404、
  main 会话 409、mode=1 拦截+从不碰 LLM、mode 2-5 全放行、无 profile 行落默认档、
  `user_message_id` 三种失配（不在窗口内/属于别人/属于 Cuu 自己）各自 404、软预算闸 429+不碰 LLM、
  delta 事件严格按 ordinal 顺序发布+最终消息带正确 citations、记忆/技能各自的 top-N 截断、
  `touch()` 失败不拖垮整轮、LLM 抛错/60s 超时/空文本/持久化失败四种失败路径统一 500 且都不落半截
  消息、并发闸同会话串行+跨会话不互相阻塞+完成后正确释放。

### 3. `apps/api/src/routes/conversation-turns.ts`（新，**不挂载**）

`createConversationTurnRoutes(deps)`，`POST /conversations/:id/turns`；uuid 守卫照
`routes/uuid-param.ts` 既有用法；请求体 `{ user_message_id: uuid }` 用路由本地的 zod schema
校验（照 `routes/action-cards.ts` 的既有先例——不是所有请求 schema 都要住在 `@workhub/contracts`
里，本批范围围栏也没批准往 contracts 加这个请求/响应 schema）。写法/挂载声明注释照
`routes/conversation-army.ts`。单测 7 条（`apps/api/src/routes/conversation-turns.test.ts`）：
未登录 401、非法 uuid 404（不碰 service）、请求体缺字段/非 uuid/多余字段三种 422（不碰 service）、
正常请求透传 actor/conversationId/payload 并原样回传 service 的 VM、service 的 409（busy/not_collab）
与 `InternalContractError`（500）原样透传。

### 4. `packages/contracts` 两处 additive 变更（范围围栏预批）

- `domain/conversation.ts`：新增 `conversationMemoryCitationSchema`（导出，`{kind, title}`
  strict）+ `MAX_CONVERSATION_MEMORY_CITATIONS = 20`；`conversationTextContentSchema` 新增
  optional `memory_citations` 字段（`z.array(conversationMemoryCitationSchema).max(20)`），保持
  `.strict()`，既有 `text` 字段边界不变。这个 schema 被 `createConversationMessageRequestSchema`
  （人类发消息的请求体）和 `conversationMessageVmSchema`（所有 text 消息的读出 VM）共用；影响面
  评估：人类发消息走 `createUserMessage` 仓库函数，其 `assertMessageContent` 仍然手动校验「只能有
  `text` 一个 key」，即使这条 zod 请求 schema 现在允许多传 `memory_citations`，人类发的消息真带
  这个字段也会在仓库层被 400 拒掉——两层校验分工没变，人类消息路径行为不变。

### 5. `packages/contracts/src/events.ts`（additive）

新增 `conversationMessageDeltaEventSchema`——批0遗留的「仅保留名称」占位升级为真实 payload。刻意
极简：只有 `event_id/type/topic/ts/data{conversation_id, turn_id, delta_text, ordinal}`，**没有
`actor`/`project_id`/`preview_text`**（`makeWorkHubEvent` 这些字段本来就是 optional，不传就不出现
在 envelope 里，天然满足 `.strict()`）。这是纯瞬态的流式打字事件，不落库、无 seq、不参与任何
reconcile。

### 6. `packages/contracts/src/r12-workbench.test.ts`（范围围栏预批的两处断言改动，逐条说明见下）

### 7. `packages/agent/src/turns/`（新目录）+ `packages/agent/package.json`（新增一个 exports 条目）

- `prompt.ts`：纯函数，`buildTurnSystemPrompt()`/`buildTurnMemorySection()`/`buildTurnMessages()`，
  同构 `packages/agent/src/observer/prompt.ts` 的既有形态（数据隔离围栏措辞、`truncate` 惯例），
  但改成多轮 `{role, content}[]` 格式而不是观察者那种单块分析文本——turn 是真对话，多轮上下文能让
  回复更贴合语境。`user_memories` 用既有 `<user_memory>` 围栏 + `neutralizeFenceTags`（从
  `../loop/loop.js` 相对导入，`@workhub/agent/loop` 子路径背后就是这个文件，同包内直接相对导入不
  受 `exports` 字段限制）；`team_skills` **不做**围栏包裹（原因见文件内注释：`FENCE_TAG_PATTERN`
  没有 `team_skill` 这个标签名，引入一个新的、未被中和覆盖的围栏名反而是更差的选择；这批数据本身
  也是已过 `promote()` 蒸馏/审核流程的内容，风险档位与 `team-skill-context.ts` 现有对同一批数据
  的处理一致——那份代码本身也没做围栏中和）。
- `index.ts`：`export * from "./prompt.js"`。
- `prompt.test.ts`：7 条，覆盖 system prompt 含数据隔离/边界措辞、空输入返回空 section、
  `user_memories` 围栏包裹+字面 `</user_memory>` 注入被中和、`team_skills` 打标签不做围栏、
  两类合并顺序、`buildTurnMessages` 的 user/assistant 映射与截断。
- `package.json`：新增 `"./turns"` exports 条目（同 `"./observer"` 一模一样的写法）——没有这一条，
  `apps/api` 侧就没法 `import ... from "@workhub/agent/turns"`（Node ESM 的 `exports` 字段会拒绝
  没声明的子路径深导入）。这是让新文件可被外部消费的必要机械动作，没有改动任何既有 exports 条目
  或既有文件的行为，同批 5 汇报里「`index.ts` 各加一行 `export *`」是同一档次的必要基础设施改动。

## 我改过的断言（两处，均为集成者预先获批）

1. **`packages/contracts/src/r12-workbench.test.ts` 的保留名单**：从
   `test("R12 typing events reserve a strict server-owned 3000ms transient contract only", ...)`
   里的 `reservedName` 数组移除了 `"conversationMessageDeltaEventSchema"`（原先断言这个导出必须是
   `undefined`）。理由：批 4a 把它从「仅保留名称」升级为真实 schema，这是设计要求本身，不是为了
   迁就实现而改断言。
2. **同一个文件新增两块正例测试**（不是改动既有断言，是新增）：
   - `test("R12 message-delta events are a minimal strict transient contract with no seq or actor", ...)`
     —— 紧跟在上面那条测试后面，同 `conversation.action_card.updated` 当年从「仅保留名称」升级时
     的做法（批3 报告里也是这个分离到独立正例测试的模式）。
   - 在既有 `test("R12 message VMs validate text/file cards fail-closed and bound future content
     records", ...)` 测试体内**追加**了 `memory_citations` 的正反例（cuu 发言人 + 合法引用清单通过
     / 未知 kind 拒绝 / 超过 20 条上限拒绝），紧跟在原有断言之后，原有断言一字未动。

## 挂载清单（给集成者）

1. `apps/api/src/app.ts`：
   - `import { createConversationTurnRoutes } from "./routes/conversation-turns.js";`
   - 在 `app.route("/api", createConversationRoutes());` 附近加一行
     `app.route("/api", createConversationTurnRoutes());`（与 `conversation-army.ts`/
     `conversations.ts` 同款挂法，默认 `deps` 走 `getDefaultConversationTurnService()`）。
2. `apps/api/src/openapi.ts`：新端点 `POST /conversations/:id/turns` 及其请求/响应 schema
   未登记——不在我的改动范围（铁律 §4 明确排除 openapi.ts），且这批的请求/响应 schema 目前是路由/
   服务本地定义（未promote进 `@workhub/contracts`，见上「做了什么·3」），集成时如果要登记 openapi
   需要先决定这两个 schema 要不要一并 promote 进 contracts。
3. **`conversation.message.delta` 的 SSE 分发链路**：本批只在服务层发布事件到 push bus（
   `topics.conversation(id).topic`），前端订阅/渲染这条 transient 事件属于批 4 的前端切片，不在
   本批范围（本批只做服务端 turns 通道）。
4. 前端调用这个端点前，请先确认发起方是「协同会话」（`kind='collab'`）而不是项目主区
   （`kind='main'`）——主区群聊由静默观察者（批3）处理，这条端点会直接对主区请求返回 409。

## 已知设计冲突（写进报告，不是我漏做，需要集成者裁决）

**Cuu 落库的回应消息不会触发任何"消息已创建"类的实时广播事件。**

设计决策原文写的是"AI 回复……自动触发既有 message.created 事件"，但实际检查
`conversationMessageCreatedEventSchema`（`packages/contracts/src/events.ts`）后发现它的
`superRefine` **硬编码**要求 `data.sender_type === "user"` 且 `actor.actor_kind === "human"`
且两者的 user id 必须一致——这个契约从一开始就没有给 AI 发言者开过口子。范围围栏只预批了
"delta schema 只增"这一处 events.ts 改动，没有授权放宽 `conversationMessageCreatedEventSchema`
（放宽它意味着改变一条**既有**契约的语义，属于铁律第 1 条"不许改测试/断言来迁就实现"要单独获批
的范畴，我没有自作主张做这个决定）。

我选择的处理方式：Cuu 落库的这条消息**不**触发任何专属的实时"已创建"事件。发起 turn 的客户端从
这次 HTTP 响应本身就能拿到完整消息 VM（含真实 `id`/`seq`）；同会话其它在线查看者能通过
`conversation.message.delta` 流实时看到文字在生成（内容层面不缺），但拿不到一个明确的"turn 已
完成、真实消息已落库"信号，需要自己重新拉取 `GET /conversations/:id/messages` 才能看到这条消息
进入历史（并且拿到真实 seq）。这与批 3 的 `postSystemMessage`（行动卡的 `@` 提醒/撤销留痕消息，
同样是 `kind='system_event'` 且不配对任何专属实时事件，只靠 `conversation.action_card.updated`
提示"该刷新了"）是同一个先例档位，不是孤例。

集成者需要裁决：要不要新起一个 additive 事件类型（例如 `conversation.turn.completed`，携带
`{conversation_id, turn_id, message}` 或类似最小摘要）来补上这条"其它在线查看者也能拿到确定性
完成信号"的缺口？这属于新增契约设计，超出本批"只做 delta schema 一处 additive"的预批范围，
留给批 4b 或专门决策。

## 缺口（不修，只报）

- **并发闸是进程内的**：`Set<conversationId>` 只在单个 Node 进程内生效。多进程/多实例部署下，
  不同进程各自维护自己的 Set，互不知情——同一会话完全可能在两个进程上同时各跑一个 turn。要做
  跨进程闸需要落库一个带唯一约束的"进行中 turn"标记（类似 `budget_reservations` 或专门一张表），
  这超出本批范围，按指示"内存闸+409 即可，报告注明多进程限制"处理。
- **软预算闸不是原子预留**：与批 3 观察者记录在案的根因完全相同——`budget_reservations.run_id`
  是 `NOT NULL` 外键指向 `agent_runs`（`agent_runs.work_item_id` 也 `NOT NULL`），而 turn 按设计
  决策 1 不建 work_item/agent_run，没有可挂靠的 `run_id`。接入原子 reservation 需要为每次 turn
  伪造一个 work_item+agent_run，这正是铁律第 3 条禁止的假接线。改用软闸：调用前读团队维度已用量
  快照做门槛判断（不足即拒绝，不建任何行）；调用本身仍通过 `ProviderRegistry` 的 `usageSink` 计入
  `cost_ledger_entries`（真实成本记账），只是这次判断和记账之间存在一个竞态窗口——理论上可以有
  两个并发 turn 都通过了软闸判断，然后都真的发生了调用，合计花费超过单次判断时看到的额度。这是
  记录在案的既有缺口，不是本批新引入的。
- **消息已创建的实时广播**：见上「已知设计冲突」一节，不重复。
- **`user_message_id` 只能是最近窗口内的消息**：见上「服务端」小节的"已知边界"，正常调用序不受
  影响。
- **memory_citations 的 `title` 字段取值**：`user_memory` 的 title 用的是 `user_memories.key`
  （现有仓库没有独立的"标题"字段，`key` 是最接近的稳定标识，例如 `"proposal:xxx"`——不一定对
  终端用户友好，前端渲染"N 条记忆引用"折叠区时可能需要额外映射成更友好的文案，而不是直接展示
  这个 key 原文）；`team_skill` 的 title 用 `team_skills.name`（人类可读，没有这个问题）。

## 待人工

- **真 key 冒烟**：本批全部测试用假 LLM client（`respondingClient`/`throwingClient`/
  `hangingUntilAbortedClient`，同 observer 测试的 `llmClientReturning` 同一档次），没有跑过真实
  DeepSeek/Anthropic-compatible key 的端到端验证——流式 `content_block_delta`/`text_delta` 的
  真实事件形状假设来自阅读 `packages/agent/src/providers/anthropic-compatible.ts` 的现有实现，
  没有拿真 key 实际跑通验证这个假设。集成前建议至少跑一次真实协同会话 turn，确认：(a) delta 事件
  真的按预期节奏到达前端可感知的粒度、(b) `getFinalMessage()` 拼出的文本与逐个 delta 拼接结果
  一致、(c) 60s 超时在真实网络条件下不会把正常响应也误杀。
- **多用户并发真实场景**：并发闸的单测都是进程内用手动 gate 模拟竞态，没有真实两个 HTTP 请求
  同时打进来的集成测试（这需要挂载路由后才能做，本批路由故意不挂载）。

## 自查输出

```
pnpm --filter @workhub/contracts test  → 95 tests, 95 pass, 0 fail
pnpm --filter @workhub/db test         → 227 tests, 225 pass, 0 fail, 2 skip（含本批 6 pass）
pnpm --filter @workhub/agent test      → 76 tests, 76 pass, 0 fail（含本批 7 pass）
pnpm --filter @workhub/api test        → 989 tests, 988 pass, 0 fail, 1 skip（含本批 19+7=26 pass）
pnpm -r typecheck                      → 16/16 workspace 项目 Done，0 错误
git status                             → 只有本批范围内文件被改（见下），无范围外改动
```

新增测试净增 45 条（db 6 条、contracts 5 条正反例断言追加在既有测试体内 + 1 条独立正例测试、
agent 7 条、api 19+7=26 条），均为「先写会红后写绿」的真断言（并发闸用手动 gate 精确控制竞态窗口、
超时用真实 `AbortSignal` 事件驱动而非 `setTimeout` 竞速、失败路径用「持久化调用次数为 0」硬断言
而非只查错误类型）。

## 改动文件清单

- `packages/db/src/repositories/conversations.ts`（新增 `createCuuMessage`）
- `packages/db/src/conversation-repository.test.ts`（新增 6 条测试）
- `apps/api/src/services/conversation-turns.ts`（新）
- `apps/api/src/conversation-turns.test.ts`（新，19 条）
- `apps/api/src/routes/conversation-turns.ts`（新，不挂载）
- `apps/api/src/routes/conversation-turns.test.ts`（新，7 条）
- `apps/api/src/conversations.test.ts`（范围外的一处最小收尾，见下）
- `packages/contracts/src/domain/conversation.ts`（additive：`conversationMemoryCitationSchema` +
  `conversationTextContentSchema.memory_citations`）
- `packages/contracts/src/events.ts`（additive：`conversationMessageDeltaEventSchema`）
- `packages/contracts/src/r12-workbench.test.ts`（预批的两处改动，见上）
- `packages/agent/src/turns/prompt.ts`（新）
- `packages/agent/src/turns/index.ts`（新）
- `packages/agent/src/turns/prompt.test.ts`（新，7 条）
- `packages/agent/package.json`（新增 `"./turns"` exports 条目）

## 范围外发现（不修，只报）

- `apps/api/src/conversations.test.ts` 里有一个未导出、供多个测试复用的 `repository(overrides)`
  工厂函数，构造一个完整的 `ConversationRepository` 假实现。我给 `ConversationRepository` 类型加了
  `createCuuMessage` 字段后，这个工厂函数不再满足类型（缺少必填字段），`tsc` 报错。这不是我改动
  范围内的文件，但不修就没法让 `pnpm -r typecheck` 通过——按照"铁律第 5 条：新增/修改测试后必须
  typecheck 通过"，我在这个文件里加了一个同风格的拒绝桩方法（`async createCuuMessage() { throw
  new Error("createCuuMessage not expected"); }`），没有改动这个文件里任何既有断言/行为，只是让
  已有的类型契约保持满足。如果这个改动不被接受，替代方案是把 `ConversationRepository.
  createCuuMessage` 声明成可选字段，但那样会削弱类型对"真实实现必须提供这个方法"的保证，我认为
  加一个拒绝桩是更小、更一致的改动。

## 没做/存疑

- 见上「已知设计冲突」「缺口」两节，不重复。
- 没有触碰 `app.ts`/`openapi.ts`/schema/迁移/`desktop-webview`/`client-tauri`，按范围围栏要求。
- 产出卡（+a −b 撤销/交给审核）、`#`/`@`/`/` 三类引用的服务端展开+防注入包裹、chips UI、模式档位
  的执行/审核语义 gate、5 档 auto_merge 全托管合并、"深入处理"行动卡→collab 会话——全部归批 4b，
  本批没有为它们预留任何假接线或占位路由。

## 结论

批 4a 协同会话 turns 服务端切片完成，自查全绿，范围内改动无越界。等待集成者挂载路由、核对「已知
设计冲突」一节的裁决（是否需要新增 `conversation.turn.completed` 一类事件补上实时广播缺口），并
安排真 key 冒烟。
