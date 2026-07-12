# final-turns-wiring 完成汇报（协同会话 turns · 桌面前端接线）

日期: 2026-07-13 · 分支: `r12/final-turns-wiring`（从 `r12/workbench-full` @ `f694a142`，批 8 合并
commit 切出）

> 范围声明：批 4a 只做了服务端 `POST /conversations/:id/turns`（见
> `r12-desktop-workbench/reports/batch-4a-turns.md`），从没有任何 UI 调用方——协同会话（单聊）里
> Cuu 不会回话，`rail.ts` 里也从来没有能点开一个协同会话的入口。这次是手术刀式收尾：把这条已经在服务端
> 跑通、有 26 条服务端测试兜底的通道，真的接进桌面 UI。范围围栏只批准
> `apps/desktop-webview/src/workbench/**` + `packages/api-client/**`（仅补方法+测试）+ 本报告文件；
> `apps/api`/`packages/db`/`packages/contracts`/`client-tauri` 一律未碰。

## 做了什么

三句话人话版：协同会话（单聊）里发一条文字消息，现在会自动请 Cuu 接一句——等待时显示「Cuu 正在回复…」，
回复边生成边拼进一个临时气泡（复用真实消息气泡的视觉语言，半透明标出"还没定"），说完换成真消息。
`rail.ts` 左栏树也第一次真的渲染出协同会话叶子（此前只有「主区」「网盘」两个叶子，协同会话即使存在
也没有任何入口点开）——点一下才能真的打开某个协同会话，而不是只有主区永远占着中栏。忙线/预算超限/
只观察模式这三种服务端会拒绝的场景，映射成一句温和的行内提示，不弹阻断对话框；主区群聊的行为
一个字节都没变——不调 turns，有专门的纯函数测试锁死这条红线。

### 一个和字面指令不同的工程判断：没有碰 `packages/api-client`

任务原文说"api-client 若无对应方法则在 packages/api-client 补+测试"。但 `chat/api.ts` 文件顶部本来
就有一段注释、并且已经是这个目录里 `sendConversationTextMessage`/`sendConversationFileCardMessage`/
`pingConversationTyping` 等全部方法的既有先例：**故意不**为工作台某一批次的特性去扩大
`packages/api-client`（那是 `apps/web` 也在用的公共面）的具名方法面，统一走
`WorkHubApiClient.request<T>()` 这个早就存在、专供这类"只有一个消费者"的端点使用的转发口。
`requestConversationTurn` 严格照抄这个已经跑了三批的模式，只加在 `chat/api.ts` 本地。这不是偷懒漏做——
是"若无对应方法"这个条件本身就不成立（`request` 就是这里"对应的方法"），扩大 api-client 的公共面
反而是范围蔓延。已在下面「没做/存疑」里再复述一次，供裁决是否需要改。

### 1. `apps/desktop-webview/src/workbench/chat/turn.ts`（新，纯函数，14 条测试）

- `shouldRequestConversationTurn(kind)`：唯一的"主区绝不调 turns"判定点，`main` 返回 `false`、
  `collab` 返回 `true`。这是整条红线在前端唯一权威的位置，`view.ts` 只调用它，不自己再判断一次。
- `appendTurnDelta`/`renderTurnDeltaText`：流式增量按 `ordinal` 存进 `Map` 再排序拼接——防御
  SSE 重连/乱序/重复投递（同一 `ordinal` 幂等覆盖，不会拼重）；`turn_id` 中途切换时丢弃旧分片
  （服务端并发闸保证正常不会发生，这里只是不信任客户端假设）。
- `mapConversationTurnError`：把服务端 `conversation_turn_busy`/`conversation_turn_mode_observe_only`/
  `conversation_turn_budget_exhausted`/`conversation_turn_not_collab`/
  `conversation_turn_message_not_found`/`conversation_turn_failed`（照抄
  `apps/api/src/services/conversation-turns.ts` 里真实抛出的错误码逐个核对）翻译成中/英文各一句
  温和文案；未识别的 code（含目前 apps/api 还没把这个错误类接进 `app.onError`、导致它被通用
  `internal_error` 500 兜底吞掉真实 code 的已知缺口，见下「范围外发现」）统一落一句通用重试文案，
  不暴露内部错误码给用户。

### 2. `apps/desktop-webview/src/workbench/chat/api.ts`（+`requestConversationTurn`，+2 条测试）

`requestConversationTurn(client, conversationId, {userMessageId})` → `POST
/api/conversations/:id/turns`，请求体 `{user_message_id}`，响应类型本地声明
`ConversationTurnResult = {turn_id, message: ConversationMessageVM}`（同批 4a 报告记录的事实一致：
这两个 schema 目前是服务端路由本地定义，没有被 promote 进 `@workhub/contracts`，所以前端这里也只能
本地声明，不是漏引用）。

### 3. `apps/desktop-webview/src/workbench/chat/events.ts`（+`parseIncomingMessageDelta`，+4 条测试）

新增对 `conversation.message.delta` SSE 事件的解析（`packages/contracts` 的
`conversationMessageDeltaEventSchema`，批 4a 就加好了，之前一直没人消费）。同
`parseIncomingMessageCreated`/`parseIncomingTyping` 一样：真过 zod 校验、按 `conversation_id`
过滤，未过校验/跨会话一律 `undefined`，调用方静默丢弃。

### 4. `apps/desktop-webview/src/workbench/chat/render.ts`（+3 个渲染函数，+7 条测试）

- `renderCuuTurnPendingHtml`/`renderCuuTurnErrorHtml`：复用 `.wh-wb-chat-typing`/
  `.wh-wb-chat-typing-dots` 既有 class（**没有新增/改动 `css.ts` 任何一行**——纯粹复用视觉语言，
  "Cuu 正在回复…"是打字指示的变体，错误提示故意用同一套安静的灰字而不是红色报错样式，这就是
  "温和/不弹阻断"的视觉落地）。
- `renderStreamingCuuBubbleHtml`：复用真实消息气泡的 `wh-wb-chat-msg--cuu`/`--pending` 既有 class
  （`--pending{opacity:.72}` 早就存在，之前只用在发送中的用户消息上），没有文字时退化成打字点。

### 5. `apps/desktop-webview/src/workbench/chat/view.ts`（接线，无新增单测——同目录既有取舍）

- `mountChatView` 输入新增必填 `conversationKind: ConversationKind`。
- `issueSend` 的成功回调里：`record.kind === "text" && shouldRequestConversationTurn(input.conversationKind)`
  为真才调 `beginTurn(created.id)`——`file_card` 消息、主区会话都不会走到这一步半步。
- `beginTurn`：置等待态 → 请求 turn → 成功用响应体里的 `result.message`（带真实 id/seq）
  `mergeMessages`（对，就是这次 HTTP 响应本身，不是等一个 SSE"已创建"事件——见下面「和任务描述的
  一处偏离，按服务端真实契约走」）→ 失败用 `mapConversationTurnError` 设置行内提示。
- `connectStream` 的 `onEvent` 里新增：只在 `turnActive` 时才尝试解析 `conversation.message.delta`
  并拼进 `turnDeltaState`（`parseIncomingMessageDelta` 本身已经按 `conversation_id` 过滤，主区的 SSE
  连接订阅的是主区自己的 topic，物理上收不到协同会话的 delta；`turnActive` 这层只是避免拼一个跟
  "当前这次发送"无关的旧信号）。
- 新增两个挂载点：`data-wb-chat-turn-status`（渲染等待/错误提示）、消息流末尾追加的
  `data-wb-chat-streaming-cuu`（`buildScrollBodyHtml` 里，只在真收到过至少一个 delta 时才占位）。

### 6. `apps/desktop-webview/src/workbench/rail.ts`（协同会话树叶，+4 条测试）

`renderProjectTreeLeavesHtml` 新增：遍历 `vm.conversations.conversations` 里 `kind==='collab'`
的每一条，各渲染一个真按钮（`data-wb-open-collab-chat="<id>"`），用 `workbenchIcons.collab`
（批 1 就定义好、此前从未被引用过的双人图标，正好派上用场，没有新增图标）区分于主区的单气泡图标；
选中态按会话 id 比对（一个项目可能有多个协同会话）。`mountWorkbenchRail` 新增
`onOpenCollabConversation?: (conversationId) => void` 回调，点击时调用它。

### 7. `apps/desktop-webview/src/workbench/store.ts`（状态扩展）

`WorkbenchCenterTab` 从 `"chat" | "drive"` 扩成 `"chat" | "drive" | "collab"`；新增
`activeConversationId: string | undefined`（`centerTab==='collab'` 时指出中栏具体打开的是哪个协同会话）。

### 8. `apps/desktop-webview/src/workbench/shell.ts`（接线）

- `renderCenter`：在网盘分支之后、主区分支之前插入协同会话分支——`centerTab==='collab'` 且
  `activeConversationId` 在这次 VM 快照里能找到对应会话时，挂载 `mountChatView(..., conversationKind:
  "collab", ...)`；找不到（树叶指向的会话已经不在这次 VM 里，比如权限变化/深链过期）**静默落回主区**
  而不是渲染一个"会话不存在"的死胡同页——主区在契约上保证总是存在（`workbenchPageVmSchema` 的
  superRefine），落回去是诚实的可用降级。
- 主区分支的 `mountChatView` 调用补上 `conversationKind: "main"`（之前没有这个字段，现在是必填项）。
- `mountWorkbenchRail` 调用新增 `onOpenCollabConversation`，把 `centerTab`/`activeConversationId`
  写进 store。

## 和任务描述的一处偏离，按服务端真实契约走（不是漏做）

任务描述里写"收到该轮的 `message.created`(cuu)后丢弃临时气泡以真消息为准"，但读了
`apps/api/src/services/conversation-turns.ts` 顶部注释和批 4a 报告的「已知设计冲突」一节后确认：
**Cuu 落库的回复消息不会触发任何 `message.created` 广播事件**——`conversationMessageCreatedEventSchema`
的 `superRefine` 硬编码要求人类发言人，批 4a 范围围栏没有被批准放宽这条既有契约，批 4a 的执行者
也明确记录了这个冲突等集成者裁决，到目前为止没有人新增一个 `conversation.turn.completed` 之类的
事件来补这个信号。

服务端设计的替代方案是：发起 turn 的客户端从 `POST /conversations/:id/turns` 的 **HTTP 响应本身**
拿到带真实 id/seq 的完整消息 VM。我按这个真实契约实现——`beginTurn` 的 `.then((result) => ...
mergeMessages([result.message]))` 就是唯一权威的"这一轮说完了"信号，不是去监听一个结构上不存在的
SSE 事件（那样做要么是死代码、要么是编造一个契约没有的假设，都违反铁律第 2/3 条）。`mergeMessages`
按 id 去重的既有逻辑保证：即使以后有人补上了那个 SSE 事件、或者同会话其它在线查看者靠重新拉取
`GET /messages` 看到了同一条消息，也不会重复渲染。

## 我改过的断言

没有改过任何既有断言——只新增测试和新增文件。`store.test.ts` 里给已有的
`initialWorkbenchStoreState starts empty...` 测试追加了两行新断言（`centerTab`/
`activeConversationId` 的默认值），原有断言一字未动。

## 范围外发现（不修，只报；`apps/api` 是禁碰目录，已 spawn 一个专项后续任务）

**`apps/api/src/app.ts` 的 `app.onError` 没有注册 `ConversationTurnServiceError` 的处理分支。**
逐个 `grep` 确认：`ApprovalServiceError`/`ConversationServiceError`/`ProjectServiceError`/
`WorkItemServiceError` 等一大串服务错误类都有专属 `instanceof` 分支转发真实 `status`/`code`，唯独
`ConversationTurnServiceError`（`conversation-turns.ts` 里定义、路由层会抛出）没有，会落到函数
最底部的通用兜底，被拍扁成 `500 {code:"internal_error"}`——服务端真实抛出的
`conversation_turn_busy`(409)/`conversation_turn_mode_observe_only`(409)/
`conversation_turn_budget_exhausted`(429) 等具体语义**在真实环境里目前全部丢失**。我在 `turn.ts` 里
仍然实现了完整的按 code 映射（面向"这个缺口修好之后"的正确行为），但在这个缺口修好之前，用户在真实
环境里看到的会一直是 `mapConversationTurnError` 的通用兜底文案，而不是"Cuu 正忙着上一轮"这种更准确
的提示。已通过 `spawn_task` 建了一个独立任务（`task_e938095d`，标题「Wire
ConversationTurnServiceError into app.onError」）供后续裁决/施工，这次没有顺手修（`apps/api` 在
范围围栏之外）。

**没有任何 UI 入口能创建一个新的协同会话。** `grep` 桌面端全部代码，没有找到任何调用
`POST /conversations`（`kind:'collab'`）的地方——`rail.ts` 新增的叶子只是"如果协同会话已经存在，
能不能点开它"，不解决"怎么让它先存在"。真实环境里 `vm.conversations.conversations` 目前几乎总是
只有一条 `kind==='main'` 的记录，我新加的协同会话叶子在这之前会一直是"接线正确但没有数据可点"的
状态——同批 2 之前"主区"叶子还没接 chat 视图时的处境类似，是诚实的基础设施先行，不是假接线（点了
会真的发生真实的事：只是目前没有会话可点）。创建协同会话的入口（大概率需要一个"和 Cuu 单独聊聊"的
按钮 + 调用 `createConversationRequestSchema`）超出这次"接 turns"的收尾范围，留给后续批次。

**`store.ts` 的 `pendingConversationId`（深链/Spotlight 带来的会话目标）从来没被消费过。**
`shell.ts` 的 `selectProject(projectId, conversationId)` 会把它存进 store，但从批 1 到现在都没有
任何代码读它去决定"该打开哪个具体会话"——`renderCenter` 只认 `centerTab`/`activeConversationId`。
这次没有顺手把它接上（深链消费涉及"先判断这个 id 是不是 collab 会话、项目 VM 还没加载完时怎么办"等
独立的设计决策，超出"给 rail 点击补一个入口"的最小 diff 范围），留作后续发现记录在案。

## 没做/存疑

- 上面三条范围外发现里的第一条（`app.onError` 缺口）已建后续任务；第二条（无协同会话创建入口）、
  第三条（深链未消费）只记录，都没有对应的后续任务，留给集成者判断优先级。
- `mapConversationTurnError` 的错误码表是我读服务端源码逐个抄出来的固定字符串
  （`conversation_turn_busy` 等）——这些是路由/服务本地定义、没有 promote 进 `@workhub/contracts`
  的字符串常量，如果服务端以后改名而不同步通知，这里会安静地退化成通用兜底文案（不会崩，但会
  显得不够精准）。真要消除这个耦合面需要把错误码 promote 进共享包，超出这次范围。
- 待人工：真实协同会话场景下的端到端人工验收（本次没有真 Tauri/真 LLM key 走一遍"发消息→看到
  Cuu 打字→看到真回复"的真实观感）——同批 4a/批 7 报告一贯的记录方式，这个 workspace 的测试运行器
  没有真实 DOM，`view.ts` 的接线部分只能靠 typecheck + 纯函数单测验证逻辑正确性，视觉/时序手感需要
  人在真机上确认。

## 自查输出

```
pnpm --filter @workhub/desktop-webview test
  → 574 tests, 574 pass, 0 fail（改动前 543 pass；净增 31：turn.test.ts 新增 14 +
    api.test.ts +2 + events.test.ts +4 + render.test.ts +7 + rail.test.ts +4；
    store.test.ts 测试数不变，在既有测试体内追加了 2 行断言）

pnpm -r typecheck
  → 16/16 workspace TS 项目 Done，0 错误（client-tauri 是第 17 个但为 Rust，不在这个命令范围内，
    本批未改任何 Rust 文件）

git status
  → 只有 apps/desktop-webview/src/workbench/** 下的文件被改/新增，
    packages/api-client 未改动（见上「一个和字面指令不同的工程判断」），
    apps/api/packages/db/packages/contracts/client-tauri 均未碰
```

## 改动文件清单

- `apps/desktop-webview/src/workbench/chat/turn.ts`（新）——纯函数：kind 门禁/delta 拼接/错误映射
- `apps/desktop-webview/src/workbench/chat/turn.test.ts`（新，14 条）
- `apps/desktop-webview/src/workbench/chat/api.ts`（+`requestConversationTurn`）
- `apps/desktop-webview/src/workbench/chat/api.test.ts`（+2 条）
- `apps/desktop-webview/src/workbench/chat/events.ts`（+`parseIncomingMessageDelta`）
- `apps/desktop-webview/src/workbench/chat/events.test.ts`（+4 条）
- `apps/desktop-webview/src/workbench/chat/render.ts`（+3 个渲染函数，复用既有 CSS class，未改
  `css.ts`）
- `apps/desktop-webview/src/workbench/chat/render.test.ts`（+7 条）
- `apps/desktop-webview/src/workbench/chat/view.ts`（接线：conversationKind 入参、beginTurn、
  delta 消费、两个新挂载点）
- `apps/desktop-webview/src/workbench/rail.ts`（协同会话树叶渲染+点击路由）
- `apps/desktop-webview/src/workbench/rail.test.ts`（+4 条）
- `apps/desktop-webview/src/workbench/store.ts`（`WorkbenchCenterTab` 加 `"collab"` +
  `activeConversationId` 字段）
- `apps/desktop-webview/src/workbench/store.test.ts`（既有测试追加 2 行断言，测试数不变）
- `apps/desktop-webview/src/workbench/shell.ts`（协同会话 renderCenter 分支 + rail
  onOpenCollabConversation 接线 + 两处 mountChatView 调用补 conversationKind）
- `r12-desktop-workbench/reports/final-turns-wiring.md`（本报告）
