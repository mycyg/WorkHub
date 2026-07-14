# R14 FIX 批 1 · P1-11：turn 进行中发第二条消息被晾住 —— 完成汇报

> 分支：`r14/p1-11-turn-queue`（从 `origin/main @ adb241b4` 拉出）
> 范围围栏：只改了 `apps/desktop-webview/src/workbench/chat/turn.ts`、`chat/view.ts`、`chat/turn.test.ts`。未碰 `apps/api/**`、`packages/**`、`chat/render.ts`（复用既有渲染函数，不需要新样式）。

## 现状调查（先于修复）

- 服务端会话级忙碌闸：`apps/api/src/services/conversation-turns.ts` 用一个进程内 `activeTurns: Set<string>`（conversationId 粒度）挡第二个并发 `createTurn` 调用，命中就抛 `409 conversation_turn_busy`（约第 735-750 行）。这个闸门语义合理，本次未改。
- 病灶实锤：composer 的发送按钮在 `turnActive === true` 时才禁用（`view.ts` 里 `handleSend` 顶部 `if (turnActive) return;` 是权威闸门，按钮 `disabled` 只是视觉辅助）。但 `turnActive` 只在 `beginTurn` 被真正调用（即第一条消息**落库成功之后**）才翻成 `true`——从"用户按下发送"到"消息创建的 HTTP 响应回来"之间有一段窗口，`turnActive` 仍是 `false`，composer 没被禁用。用户如果在这个窗口里又发了一条（常见于快速连按 Enter/粘贴多行分次发送），两条消息的创建请求前后脚落库，两个 `issueSend(...).then` 回调都满足 `shouldRequestConversationTurn`，修复前的代码**无条件**对每一条都调 `beginTurn`——第二次调用撞上服务端的会话级忙碌闸，拿到 `409 conversation_turn_busy`。修复前没有任何重试逻辑：这条消息的 Cuu 回应就永久性地丢了，composer 上只是短暂闪过（随即被第一条消息落定时的渲染覆盖掉）一条会被淹没的"忙碌"提示。
- 判定器兜底缺口确认：`r13-g1-small-groups.md` 记录的"回话判定器"（`ConversationTurnRespondDecider` 接缝）目前默认实现永远返回 `true`，`participantCount > 1` 的小群也没有独立的 15 秒 tick 兜底重新触发——本次调查没有找到"服务端会自动帮忙补一轮"的路径；客户端确实是唯一的触发方，验证了任务描述里"1:1 与个人空间 main 无兜底"的判断。这一点只是确认，不属于本次要修的服务端范围。

## 修复设计

在 `turn.ts` 新增一组纯状态机（不碰 DOM/网络，`view.ts` 只负责在正确的时机调用）：

- `TurnQueueState = { pendingAnchorMessageId, pursuitMessageId, consecutiveBusyFailures }`——`pendingAnchorMessageId` 是"待回应锚点"，只记最新一条（`queueTurnAnchor` 直接覆盖，不排队列表）；`pursuitMessageId`/`consecutiveBusyFailures` 追踪"当前正在追（发起/重试）的这条消息，连续撞见 409 busy 几次了"。
- `queueTurnAnchor(state, messageId)`：`view.ts` 的 `issueSend(...).then` 里，发现 `turnActive` 已经是 `true`（另一轮 turn 正在飞）时调用——不再无脑调 `beginTurn`，只记锚点。
- `beginTurnPursuit(state, messageId)`：每次真正发起 `POST /turns` 前调用，决定这次尝试是"同一条消息的连续重试"（保留连败计数）还是"追一条新消息"（清零，给全新预算）。
- `settleTurnPursuit(state, outcome)`（`outcome: "busy" | "settled"`）：每次请求 `.then`/`.catch` 收尾时调用，返回四选一决策：`retry_same`（撞 busy 但未到上限，原地重试同一条）、`give_up`（连败满 `TURN_QUEUE_MAX_CONSECUTIVE_BUSY_FAILURES = 3` 次，放弃并清空——**连排队中的新锚点也一并清空**，不做"放弃一条、偷偷再战另一条"的隐藏行为，真要再问用户自己重新发一句最省心）、`retry_anchor`（这一轮非 busy 收场，且有排队的新锚点——追它，给全新预算）、`idle`（没有排队的锚点）。
- `classifyTurnErrorOutcome(code)`：把服务端错误码分成三类界面处理方式——`busy`（`conversation_turn_busy`，转自动重试，界面不展示任何文字，重试对用户透明）、`silent`（`conversation_turn_not_warranted`，回话判定器认为这句话不需要 Cuu 接话，是正常业务态，不当错误处理，不展示 `mapConversationTurnError` 那句"@Cuu 一下"提示）、`error`（其它任何已知/未知错误码，含网络失败，照旧展示 `mapConversationTurnError` 的温和文案）。
- `turnQueueGiveUpText(locale)`：连败放弃后的独立温和提示（"Cuu 正忙，这条稍后手动再问。"/英文对应句），故意跟 `mapConversationTurnError` 的 `conversation_turn_busy` 文案（"Cuu 正忙着上一轮，等它说完再试。"）不同——前者暗示"马上再试就行"，后者需要说清楚"已经自动试过 3 次、放弃了、要靠你自己再问一次"。

`view.ts` 接线：

1. `issueSend(...).then`（`record.kind === "text"` 且 `shouldRequestConversationTurn` 为真）：`turnActive` 为 `true` 时 `queueTurnAnchor`，否则原样 `beginTurn`。
2. `beginTurn(userMessageId)` 开头调 `beginTurnPursuit` 登记本次在追哪条消息。
3. 新增 `advanceTurnQueue(outcome)`：调用 `settleTurnPursuit` 拿决策，`retry_same`/`retry_anchor` 都递归调 `beginTurn(decision.messageId)`（自然复用已有的 render 时序，无需额外定时器——每次重试都是真实网络往返，天然有节奏，不会热循环）；`give_up` 时设置 `turnErrorText = turnQueueGiveUpText(...)` 并重渲染。
4. `beginTurn` 的 `.then` 收尾调 `advanceTurnQueue("settled")`；`.catch` 收尾按 `classifyTurnErrorOutcome` 决定 `turnErrorText`（只有 `"error"` 分类才设文案，`"busy"`/`"silent"` 都留空）并调 `advanceTurnQueue(classification === "busy" ? "busy" : "settled")`。

## 已知缺口 / 只报不改

- **服务端无独立兜底**：确认了任务描述里的判断——1:1 协同会话和个人空间 main 完全依赖客户端触发；如果用户直接关闭桌面客户端（而不是发消息失败），一条"该由 Cuu 接话"的消息不会有任何服务端自愈路径。这不在本次范围内（铁律禁碰 `apps/api/**`），只记录。
- **连败放弃会连带丢弃排队中的新锚点**：如果用户在某条消息的 busy 重试风暴期间又发了一条完全不同的新消息，而旧消息最终放弃（连败 3 次），新消息也会被一并清空、不会自动重试（详见 `turn.ts` 里 `settleTurnPursuit` 的 `give_up` 分支注释与测试 `"giving up after a busy streak also drops any queued anchor..."`）。这是有意的简化取舍（避免"放弃一条却偷偷继续战另一条"的隐藏行为），认为符合"最多连败 3 次后放弃"的字面契约，但如果产品希望"新消息应该有自己独立的重试预算"，这里可以再细化——目前没有测试覃盖这个更细的分支，留作已知设计取舍供复核。

## 改动文件清单

- `apps/desktop-webview/src/workbench/chat/turn.ts`：新增 `TurnQueueState`/`EMPTY_TURN_QUEUE_STATE`/`TURN_QUEUE_MAX_CONSECUTIVE_BUSY_FAILURES`/`queueTurnAnchor`/`beginTurnPursuit`/`TurnSettleOutcome`/`TurnSettleDecision`/`settleTurnPursuit`/`TurnErrorClassification`/`classifyTurnErrorOutcome`/`turnQueueGiveUpText`（纯函数，无既有导出被改动或删除）。
- `apps/desktop-webview/src/workbench/chat/view.ts`：新增 `turnQueue` 状态变量；`issueSend` 的 turn 触发点加 `turnActive` 分支（忙时排队而非直接调用）；新增 `advanceTurnQueue` 收尾函数；`beginTurn` 开头登记 pursuit，`.then`/`.catch` 收尾分别调用 `advanceTurnQueue`；`.catch` 按 `classifyTurnErrorOutcome` 决定是否展示 `turnErrorText`。
- `apps/desktop-webview/src/workbench/chat/turn.test.ts`：新增 18 条单测，钉死四条验收要求（turn 中发第二条→结束自动补请；连败 3 次放弃+提示；not_warranted 静默；锚点只记最新一条）以及支撑用例（`beginTurnPursuit` 连败计数的保留/重置、`classifyTurnErrorOutcome` 三分类全覆盖、`turnQueueGiveUpText` 中英文且与忙碌文案不同）。

## 验收门

```
pnpm --filter @workhub/desktop-webview test   # 859 tests / 859 pass / 0 fail
pnpm -r typecheck                              # 16/16 workspace projects Done，0 错
git status --porcelain                         # 只有上述 3 个文件被改
```

未跑 qa smoke / 未 push origin，按范围围栏要求。
