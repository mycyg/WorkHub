# R14 FIX批10 · 被 @ 的回复延迟：事件驱动直通

> 分支：`r14/mention-direct-trigger`（从 `origin/main` @ `eb44b304` 拉出，worktree
> `/Users/apple/.codex/worktrees/WorkHub/r14-mention-direct`）
> 施工范围：`r14-release-readiness/00-plan.md` §2 批 FIX 第 10 项。

## 做了什么

回话判定器（`apps/api/src/workers/conversation-reply-judge.ts` + `services/conversation-reply-judge.ts`）
原本是纯 15s 轮询——小群里被 `@Cuu` 的消息也要等下一次 tick 才可能触发回复，明明 `@Cuu` 是一个确定性
信号，不需要等轮询。本批改成：消息落库（`services/conversations.ts` 的 `createMessage`）时如果命中
`@Cuu` 且会话是真小群（`kind='collab'` 且 `participantCount>1`，与判定器自己的候选口径完全一致），
**异步（fire-and-forget）直接触发一次 `createTurn`**，不再等轮询；轮询判定器保留原样，继续兜底
"没被 `@`" 的消息。

同一条消息绝不能触发两轮 turn 是这一批的红线。三个可能触发方——①新的落库直通 ②判定器 tick ③客户端
自动请（1:1/个人空间即时请求，含 P1-11 补请）——的并发语义处理如下：

1. **直通与判定器去重**：给 `ConversationReplyJudgeService` 新增一个 `markMentionHandled(input)`
   方法，直接写判定器 `runOnce()` 内部本来就有的 `lastJudgedByConversation` 水位线 Map（同一张 Map，
   不是另开一份状态、不加表/字段）。直通命中时，`createMessage` 会在调用 `createTurn` **之前**同步调用
   这个方法——由于它是函数体里在任何 `await` 之后紧跟着的第一段同步代码（没有再等待任何 I/O），
   `createMessage` 这次 `await` 返回给 HTTP 层之前，判定器的去重水位线就已经更新；下一次轮询 tick
   扫到这条消息时，`isAlreadyJudgedMessage` 会判定"已经判定过"，计入 `skipped_already_judged`，不会
   再调用一次 `createTurn`。重启安全等级与既有机制一致（进程内内存态，重启清空——最坏情况是重启后
   轮询多判一次，不会漏判/错判，不是新缺口）。
2. **1:1/个人空间**：直通的触发口径要求 `kind==='collab' && participantCount>1`——与判定器
   `listReplyJudgeCandidates` 的候选口径完全一致。团队主区/个人空间单聊（`kind==='main'`）和 1:1
   collab（`participantCount<=1`）都不满足这个口径，直通对它们**不生效**（选的是"不生效"而不是
   "让它触发再靠 busy 闸互斥"——这类会话本来就有桌面端"发消息即时自动请一轮 turn"的既有路径，主动
   制造一次注定会被丢弃的调用没有意义，也不给原本不存在的竞态留口子）。
3. **主区与 `cuu_enabled=false`**：`access.conversation.kind` 和 `access.conversation.cuuEnabled`
   在 `findVisibleAccessRecord` 这次调用里已经读到了（`conversationToVm` 早就在用这两个字段），直通
   逻辑前置判断这两条，命中即跳过、不占用一次 `createTurn` 调用——比"调用 `createTurn` 再吃它的 409"
   更省一次函数调用，且信息已经在手，没有额外查询代价。
4. **触发失败静默**：`createTurn` 的调用是 `void ....createTurn(...).catch(logger.warn)`，不 await、
   不阻塞 HTTP 响应；失败（撞会话忙碌闸 409/模式闸/预算耗尽/LLM 失败等）只记一条
   `conversation_mention_direct_trigger_failed` 警告，绝不让消息创建这次请求本身失败或变成 500。

## 改动文件清单

- `apps/api/src/services/conversations.ts`：`createMessage` 落库+广播之后新增直通判断与触发；
  新增可选依赖 `ConversationMentionTriggerDeps`（`turns.createTurn` + `markMentionHandled` +
  可选 `cuuDisplayName`），挂在 `ConversationServiceOptions.mentionTrigger` 上，省略时行为与本批之前
  完全一致（零回归，已有专门测试钉死这一点）；`getDefaultConversationService()` 用既有的
  `getDefaultConversationTurnService()` / `getDefaultConversationReplyJudgeService()` 单例接线（都是
  模块级缓存的同一个实例，`activeTurns` 忙碌闸和 `lastJudgedByConversation` 去重水位线天然共享，
  不产生第二份状态）。
- `apps/api/src/services/conversation-reply-judge.ts`：`ConversationReplyJudgeService` 接口新增
  `markMentionHandled(input)`，实现直接写 `runOnce()` 闭包里已有的 `lastJudgedByConversation` Map，
  不改判定/限频/预算闸的既有语义。
- `apps/api/src/conversations.test.ts`：新增 5 条测试（含 1 条内含 4 个场景的循环用例，实际覆盖
  4+2=6 条断言路径）：
  - `@Cuu` 消息在真小群里异步触发直通 turn，且不阻塞 HTTP 响应（用手动可控 promise 证明
    `createMessage` 先返回、直通 turn 后 resolve）；同时钉死合成 actor 的形状。
  - 直通撞会话忙碌闸（`ConversationTurnServiceError(409, "conversation_turn_busy", ...)`）只记警告，
    `createMessage` 正常返回消息，不抛错、不变成 500。
  - 团队主区 / `cuu_enabled=false` / 1:1 collab（`participantCount<=1`）/ 未 `@Cuu` 的文本——四种场景
    都不触发 `createTurn`，也不调用 `markMentionHandled`。
  - 不传 `mentionTrigger` 依赖时行为与本批之前完全一致（零回归门）。
- `apps/api/src/services/conversation-reply-judge.test.ts`：新增 2 条测试，直接验证
  `markMentionHandled` 写的水位线确实被 `runOnce()` 读到——标记过的消息下一次 tick 被
  `skipped_already_judged` 挡住、不再调用 `createTurn`；同时验证它只挡自己标记过的那条消息 id，
  不会连坐同一会话里后续的新消息。
- `apps/api/src/workers/conversation-reply-judge.test.ts`：机械性改动（范围外强制项，见下）——这个
  文件里 5 处手写的 fake `ConversationReplyJudgeService` 对象因为接口新增了必需方法
  `markMentionHandled` 而编译不过，各补一个不改变任何断言语义的空桩 `markMentionHandled() {}`。
  没有改动这个文件测的任何调度逻辑（tick/start/stop/stats）。

## 自查输出

- `pnpm --filter @workhub/api test`：**1244 tests, 1243 pass, 1 skip, 0 fail**（施工前基线：1238
  tests, 1237 pass, 1 skip——净增 6 条测试，跳过的那 1 条是既有的真 PostgreSQL 端点测试，与本批无关，
  施工前后都是同一条）。
- `pnpm --filter @workhub/api exec tsc --noEmit -p .`：0 错误。
- `pnpm -r typecheck`（单独跑，未接 tail）：全部 16 个 workspace 项目 `Done`，含
  `apps/desktop-webview`（本批未改动它，仍然 0 错误）。
- 未跑 `pnpm verify` / PG smoke / cargo test：本批不涉及数据库 schema、不涉及 Rust 客户端，范围围栏
  也没有把它们列为本批验收门；纯服务层单测 + 全仓 typecheck 已覆盖本批改动的全部路径。

## 我改过的断言（如有）

无。没有修改任何既有测试的断言语义——`workers/conversation-reply-judge.test.ts` 的改动只是给 5 个
fake service 对象补一个新接口要求的空方法，原有的每一条 `assert.equal`/`assert.rejects` 都原封不动。

## 范围外发现（不修，只报）

- `apps/api/src/workers/conversation-reply-judge.ts` 顶部有一段过时注释，说这个 scheduler
  "目前只被本文件的测试直接构造调用，没有在服务端启动流程里被自动 start()"——核实后这句话已经**不是
  事实**：`apps/api/src/server.ts` 第 60-64/91 行确实在 `getDefaultProviderRegistry().isConfigured()`
  为真时构造并 `start()` 这个 scheduler（与 `conversationObserverScheduler` 相邻挂载）。本批范围围栏
  禁止碰 `server.ts`/worker 启动逻辑，这条不是本批需要的改动（本批的直通触发不依赖这句注释是否准确，
  只是顺路核实时发现文档与代码不一致），如实记录，留给后续批次或文档清理顺手订正这条注释。

## 没做/存疑

- **重启安全**：`markMentionHandled` 写的水位线与判定器 `runOnce()` 自己的去重状态是同一张进程内
  内存 Map，本来就不是持久化状态——这不是本批引入的新缺口，是 R13 批 4c/G1 就有的既有取舍（见
  `conversation-reply-judge.ts` 文件顶部注释第 4 点），本批只是复用它，没有让它变得更脆弱，也没有
  试图修补这个已知的多进程/重启缺口（超出本批范围）。
- **`cuuDisplayName` 覆盖**：`ConversationMentionTriggerDeps.cuuDisplayName` 是可选字段，
  `getDefaultConversationService()` 目前没有传它——同 `conversation-reply-judge.ts` 已有的
  `cuuDisplayName` 可选项一样，默认落回 `mentionsCuu` 自己的默认显示名 `"Cuu"`。如果后续有"团队/会话
  级自定义 Cuu 昵称"的产品需求，这里已经是现成的接线点，本批没有去发明这个特性。
- 未跑真机/真 LLM key 冒烟——本批是纯服务层逻辑（触发时机 + 去重接线），不涉及 UI、不涉及新的 LLM
  提示词，行为已经由单测的 fake `createTurn`/`markMentionHandled` 完整覆盖，判断不需要真 key 验证。
