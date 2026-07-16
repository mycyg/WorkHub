# 批次 C:pi 引擎彻底引入(loop2 绞杀者计划)

用户拍板"MIT 要升级就彻底点儿"。经两侧逐行核对(pi `reference-pi/packages/{agent,ai,coding-agent}` vs WorkHub `packages/agent/src/loop/loop.ts` 与 `conversation-turns.ts`),结论:**可行,且比想象干净——但走绞杀者,不做大爆炸**。

## 核心结论

- pi 的 `agent-loop.ts`(792 行)已把 provider 抽象成可注入 `streamFn`(`agent-loop.ts:304`),一切 I/O 与决策走 `AgentLoopConfig` 回调。WorkHub money-critical 的 provider 栈(deepseek/anthropic-compatible、usageSink、成本账本、task-class 路由)**整层保留**,只写一个 streamFn 适配器。
- conversation-turns 与现 loop 实为解耦(只共享 provider 层 + 一个纯函数),可以最后统一。
- zod 不迁 typebox:toolWrapper 的 execute 直接委托 `ToolRegistry.execute`(内部 zod safeParse + snapshot 门),pi 的 `parameters` 只喂 zod→JSONSchema 形状。

## 目标分层(能力落点)

| WorkHub 能力 | 新架构落点 |
|---|---|
| 预算控制(checkLoopBudget) | `config.shouldStopAfterTurn` |
| 压缩触发 | `config.transformContext`;摘要文案换 pi Goal/Constraints 模板(`compaction.ts:383-457`) |
| 溢出自愈 | harness 层,搬 pi compact-and-retry(`agent-session.ts:1894-1958`) |
| snapshot gate / sideEffect 门 | toolWrapper 内保留(工具执行边界) |
| humanReservedGuard(现已是手写 before 钩子,`agent-runner.ts:1498-1531`) | `config.beforeToolCall` 一对一映射 |
| tool_note 落库/结果加工 | `config.afterToolCall` |
| 置信度 judge/escalate | L3 应用层 run 后,消费 resultAdapter,**零改动** |
| SSE 发布 / trace / 租约心跳 | L3 订阅 AgentEvent 流(message_end/tool_execution_end/turn_end) |
| steering/follow-up 队列、并行工具、截断逐个 fail | L0/L1 **天然获得** |

## 搬 / 改 / 重写清单

**搬(near-verbatim + MIT NOTICE)**:pi `agent/src/agent-loop.ts`(792)、`agent/src/types.ts`(430)、pi-ai 消息类型最小子集(vendor,不然 loop 编不过——选 vendor 而非改写,保住"未来拉 pi 更新近乎免费")、compaction 摘要 prompt(~75 行)、prompt-templates(可选)。

**改**:pi `agent.ts`(575,Agent 类,steering 队列用)、compaction.ts 主体(token 计数换 WorkHub)、harness skills 与现有 `packages/tools/src/skills.ts` 合流不重复造。

**重写(真正的新代码,共 4 个适配器 + 1 个组装器)**:
1. `streamFn` 适配器:ProviderRegistry.stream ↔ pi EventStream/AssistantMessage;stopReason 归一(max_tokens↔length,end_turn↔stop);透传 usage。
2. `convertToLlm`:WorkHub LlmMessage ↔ pi Message 块。
3. `toolWrapper`:ToolSpec(zod)+Registry ↔ pi AgentTool。
4. `resultAdapter`:AgentMessage[] → AgentLoopResult,让 confidence 与 agent-runner 下游零改动。
5. `configBuilder`(agent-runner 内):按上表组装 AgentLoopConfig。

## 迁移路径(绞杀者,每步 CI 独立绿)

- **Phase 0** vendor + 底座(3-4 人日):进 `packages/agent/src/loop2/` 新目录,不碰 loop.ts,内存 streamFn 桩单测。零生产接线。
- **Phase 1** 四个适配器(4-6 人日):各自对 provider 桩单测。
- **Phase 2** 影子切一条低危 agent-run(3-5 人日)——**最危险的一步**:特性开关下单 task role(或 pg smoke)走 loop2,同输入**双跑对账**(AgentLoopResult 等价 + usage 记账一致)。风险集中在 provider 适配器:usage seq 去重、abort/超时合并、tool_use/tool_result 配对不变量,错一点=成本记错或线上 400。缓解=双跑断言+记账对账+开关秒回滚。
- **Phase 3** 翻默认 + 删 loop.ts(3-4 人日):迁 loop.test 行为用例到事件模型。
- **Phase 4(可选,推荐做)** 统一 conversation-turns(3-5 人日):映射关系已核对(预算/工具可见性→beforeToolCall;tool_note→afterToolCall;澄清位/轮上限→shouldStopAfterTurn;连发→steering 队列替掉 409 busy;SSE delta→订阅 message_update)。**steering 白送**,对话侧 409"请稍候"就此消失。

## 测试碎裂账(已数,共 ~58)

必重写 ~15(loop.test 行为用例 13 + control.test 2,场景保留只换表达);搬 util 进 compat 即存活 ~8-10;靠 resultAdapter 零改动 ~17(confidence 8 + manifest 4 + gold-path 5);完全不动 16(providers.test)。Phase 2 期间 agent-runs.test 与 qa smoke 必须两套实现都绿。

## 总账与推荐

| | 彻底引入(绞杀者) | 九条逐项补丁 |
|---|---|---|
| 工作量 | ~15-25 人日 | ~6-9 人日 |
| 风险 | 高(集中在 provider 适配) | 低-中 |
| 短期收益 | 低 | 高 |
| 长期收益 | 高:单一 loop,steering/并行/压缩/自愈/钩子内生,pi 更新近乎免费 | 中:双路径分裂持续 |

**执行顺序(定稿)**:
1. 立刻做三条便宜补丁:工具描述双通道、结构化压缩 prompt、截断逐个 fail(~2 人日)——即时收益,且压缩 prompt 直接被 loop2 复用,不浪费。
2. 绞杀者 Phase 0-3 把 agent-run 切到 pi loop。
3. Phase 4 统一 conversation-turns。
4. 上一轮九条清单中 4-9 条在 loop2 落地后大部分内生,不再单独打补丁。
