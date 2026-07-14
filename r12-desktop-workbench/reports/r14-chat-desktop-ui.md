# R14 批 CHAT · 工包 W2-A desktop-chat-ui 完成汇报

> 分支 `r14/chat-desktop-ui`（基线含 Wave 1 全部服务端能力已挂载）。范围＝01-chat-design.md §5 全部
> 客户端交互 + §6 emoji 豁免边界。全部改动落在 `apps/desktop-webview/src/workbench/`（主要 chat/ 子域）。
> 禁区（apps/api、packages/{db,contracts,ui}、apps/web、client-tauri/src-tauri）一字未碰。

## 1. 做了什么（人话）

给桌面群聊/协同会话补齐「聊天基础完整度」的客户端：消息行 hover 工具条（回复/五键 emoji 反应/编辑/
删除/置顶，按权限裁剪）、行内编辑（含 409 窗过期温和话术）、墓碑删除占位、引用回复（composer「正在回复
xxx」条 + 气泡上方引用块 + 点击跳原消息，本地无则 beforeSeq 翻页加载到为止）、气泡下反应行（own 高亮、
乐观切换失败回滚）、聊天区顶部可折叠置顶条、已读游标（未读分割线 +「跳到未读」浮钮 + 自己最后一条消息
下「已读 N/M」）、成员条 presence 在线点、观察者「正在整理」瞬态指示灯、顺路撤「/技能」灰 chip、@/改派
picker 头像挂载已就位。所有新交互乐观 UI + 失败回滚 + 中文人话温和话术，SSE 事件解析全部照既有静默丢弃
模板补纯函数 parseIncomingXxx + 可单测的纯 apply。

## 2. 改动文件清单

### 纯函数层（新增，均带 colocated 单测）
- `chat/reactions.ts`：REACTION_KEYS（契约五键顺序）/hasOwnReaction/toggleOwnReaction（乐观切换，返回
  next 聚合 + add|remove，稳定顺序插入，不改入参）。emoji 字形**不在**这里（见 §6）。
- `chat/read-state.ts`：ReadCursorMap（receiptsToCursorMap/applyReadReceipt 单调推进）/highestMessageSeq/
  unreadDividerBeforeMessageId（entryReadSeq 之后第一条他人消息 id）/readReceiptSummary（自己最后一条未删
  消息下 N/M，M<1 不出）。
- `chat/presence-state.ts`：onlineUserIdsFromPresence（只收 is_online===true，不编造离线占位）。
- `chat/reaction-emotion.ts`（桌宠彩蛋纯核）：newlyAddedReactionKeys（diff 上一份聚合）/pickCuuReactionEmotion
  （仅 Cuu 消息新增反应→celebrating/worried/thinking）。

### 现有纯函数/薄层（扩充）
- `chat/api.ts`：+editConversationMessage/deleteConversationMessage/add·removeConversationReaction/
  pin·unpinConversationMessage/fetchConversationPins/advanceConversationReadCursor/fetchConversationReceipts/
  fetchPresence；sendConversationTextMessage 加第 5 位 optional replyToMessageId（既有 4 参位置兼容不变）。
- `chat/events.ts`：+parseIncomingMessageUpdated/parseIncomingReactionUpdated/parseIncomingReadUpdated/
  parseIncomingObserverAnalyzing（全走契约 zod 校验 + 会话 id 隔离 + 静默丢弃，同既有模板）。
- `chat/timeline.ts`：+applyMessageReplacement（按 id 整条替换，unknownId 触发补拉）/applyReactionUpdate
  （全量聚合幂等替换，写空数组表示清空）。

### 渲染层
- `chat/render.ts`：REACTION_EMOJI 映射常量（**唯一** emoji 出现点）+ REACTION_LABEL（aria/title 用中文
  人话，不进正文）；avatarTileHtml 加 online 视觉点参数；renderMemberBarHtml 加 onlineUserIds；renderMessageHtml
  重写（墓碑分流 + 引用块 + 已编辑灰标 + 反应行 + hover 工具条 + 行内编辑框 + 删除二次确认，全按权限/状态
  裁剪）；新增 renderPinBarHtml/renderUnreadDividerHtml/renderReadReceiptHtml/renderJumpToUnreadHtml/
  renderObserverAnalyzingHtml；renderComposerHtml 加 replyingToLabel banner + **撤「/技能」灰 chip**（#会话
  保留）+ 占位文案去掉「/技能」。ChatRenderContext 加 editing/confirmDeleteMessageId。
- `icons.ts`：+reply/edit/trash/pin 四枚 SVG（icons.test 逐个校验是 SVG 无 emoji，通过）。
- `css.ts`：presence 点、hover 工具条（默认隐藏、hover/focus-within 显）、反应行 chip、行内编辑框、删除
  确认、墓碑、跳转高亮闪烁（含 reduced-motion 收成瞬时）、置顶条、未读分割线、已读 N/M、跳到未读浮钮、
  正在回复 banner、观察者指示灯——全部用 design-system CSS 变量，**无 emoji**（css.test 的 emoji 门通过）。

### 接线层
- `chat/view.ts`：新状态（编辑/删除确认/回复态/置顶/读游标/entryReadSeq/presence/observer TTL/turn 期缓冲）；
  loadPins/loadReceipts/loadPresence/maybeMarkRead（5s 节流 PUT /read）/reconcilePinFromMessage；反应乐观切换
  + 回滚；beginEdit/saveEdit/cancelEdit；requestDelete/confirmDelete/cancelDelete（墓碑替换）；beginReply/
  cancelReply + 发送透传 reply_to；togglePin + GET /pins 刷新；jumpToMessage（DOM 内→撑窗口→beforeSeq 翻页，
  有硬上限 20 页）+ flashMessage(1.5s)；jumpToUnread；SSE 消费全部四个新事件（message.updated/reaction.updated
  在 turnActive 时缓冲，read.updated 只动 Map、observer.analyzing 独立指示行都不缓冲）；presence 30s 轮询 +
  重连即时刷新；窗口 focus 标记已读；桌宠彩蛋 detection（onCuuReactionEmotion 回调）。dispose 清全部新定时器
  与 focus 监听。

## 3. 施工清单完成矩阵（01-chat-design.md §5 逐条）

| # | 项 | 状态 | 备注 |
|---|---|---|---|
| 1 | 消息行 hover 工具条（回复/五键反应/编辑/删除/置顶，权限裁剪） | ✅ | 编辑删除仅本人（编辑再限 text）；置顶所有人；照 data-wb-chat-* 委托 |
| 2 | 编辑（行内 textarea + 保存/取消 + 已编辑灰标 + 409 温和话术） | ✅ | 成功用返回 VM 替换；409="发出超 15 分钟改不了" |
| 3 | 删除（确认 + 墓碑「此消息已删除」+ 被引用侧墓碑同步） | ✅ | 二次确认；引用侧 reply_to.deleted→「原消息已删除」 |
| 4 | 引用回复（composer 条 + 气泡引用块 + 点击跳原消息） | ✅ | 本地无→撑窗口→beforeSeq 翻页（照 loadOlderHistory，20 页上限） |
| 5 | reaction（有反应才渲行 + own 高亮 + 乐观切换回滚 + 工具条五键） | ✅ | slug→emoji 映射常量放 render.ts；消费 reaction.updated 全量替换 |
| 6 | 置顶（可折叠 pin bar + 点击跳 + 置顶/取消） | ✅ | 挂载 GET /pins；message.updated 里 pinned 变化增量维护 |
| 7 | 已读（5s 节流 PUT /read + 未读分割线 + 跳到未读 + 已读 N/M） | ✅ | 进会话/滚到底/窗口重获焦点触发；receipts 初始 + read.updated 增量 |
| 8 | presence 在线点（纯 CSS 视觉点，30s 轮询 + 重连刷新） | ✅ | 未改 render.test.ts:80 断言口径——见下 §4 |
| 9 | 观察者「正在整理」指示灯（消费 observer.analyzing，TTL/行动卡即消） | ✅ | typing 指示行同款样式，独立挂载点 |
| 10 | 桌宠彩蛋（stretch） | ◑ 半成 | 纯核 + detection 完成；跨窗口 emit/接收端待接线——见下 §5 |
| 11 | @picker/改派 picker 头像挂载 + 撤「/技能」灰 chip | ✅ | 两 picker 早已走 avatarTileHtml（带 data-wb-avatar-user-id，进 hydrateAvatarPhotos）；/技能 chip 已撤 |
| 12 | 全交互乐观 UI + 失败回滚 + 温和话术 + SSE 静默丢弃纯函数 | ✅ | apply 纯函数全在 timeline.ts/新模块，可单测 |

## 4. 我改过的断言（每处理由）

1. **`render.test.ts` composer chip 断言（点名批准，§5「撤 /技能 chip」）**：原「# 和 / 都在」改为「# 在、
   / 不在」——`assert.doesNotMatch(html, /<b>\/<\/b>/u)` + `doesNotMatch(html, /技能/u)`。因为撤掉了「/技能」
   灰 chip（§5 顺路项：技能唤起归 SEARCH 批，不摆假 affordance）。
2. **`render.test.ts` 8 条行动卡「无按钮」断言（新 affordance 导致的正当扩展）**：原
   `assert.doesNotMatch(html, /<button/u)` 收窄成 `assert.doesNotMatch(html, /data-wb-chat-actioncard-(decide|undo|reassign)/u)`。
   原意是「这个行动卡**条目**不摆决策/撤销/改派按钮」；现在每条非墓碑消息都带 hover 工具条（回复/反应/
   编辑/删除/置顶）的 `<button>`，`/<button/` 会误伤新工具条。收窄后精确保住原意、不迁就实现。（系统事件卡
   走 early-return 无工具条，其 `/<button/` 断言原样保留仍严格。）
3. **`render.test.ts:80「不许编造在线态」断言——未改**：presence 在线点用纯 CSS 视觉点（不写「在线」文字），
   `renderMemberBarHtml` 输出仍不含 /在线/，断言原样通过。设计 §5 批准过「若必须改该断言口径就写理由」——我
   没必须改，视觉点绕开即符合其本意，故保持不动（更保守）。

（未改任何禁区包的断言。）

## 5. 桌宠彩蛋（item 10）完成态与偏离说明

**已完成（可验证）**：`chat/reaction-emotion.ts` 纯核——五键→情绪映射（approve/done→celebrating、
question/disagree→worried、watch→thinking）+ diff 上一份聚合算「新增了哪个键」+ 仅对 Cuu 消息生效，
6 条单测钉死；view.ts 里 `applyIncomingReactionUpdate` 用它做 detection，命中就调 `onCuuReactionEmotion`
回调（best-effort、失败静默）。因为我自己的反应先乐观应用过（previous 已含我），SSE 回来时无新增→
只有**别人给 Cuu 消息新加反应**才触发情绪，正是彩蛋想要的语义。

**未完成（如实报告，stretch 不拖批）**：跨窗口 emit（interrupt-broadcast.ts）+ 接收端 CuuState 驱动
（desktop-cuu-runtime.ts）**未接线**，理由有二、都不是偷懒：
1. **事件形状不允许在 interrupt-broadcast.ts 里做「反查+diff」**：`conversation.reaction.updated` 是全量
   聚合幂等替换（契约明写不发增量），单看一条事件根本不知道「刚加的是哪个键」；只有持有上一份 reactions
   快照的 view.ts 能 diff。所以设计说的「interrupt-broadcast.ts 加解析分支反查」在数据上做不到——我把
   detection 放在 view.ts（数据在那），这是 emit 端接线时该消费的信号，纯核已备好。
2. **接收端接线会撞既有 exhaustive 断言且无法在本环境验证**：`desktop-cuu-runtime.test.ts:255`
   `assert.deepEqual(stopped, ["push-event","sse-status","system-notification","workbench-interrupt"])`
   钉死了监听器全集，加第 5 条监听会破坏它；且桌宠情绪只能在真 Tauri 桌宠窗看到（本环境浏览器预览渲染
   不出，桌宠状态属 client-tauri 视界）。为一个装饰性、本环境不可验证的效果去改 mascot 运行时的 exhaustive
   断言、动跨窗口协议，风险/收益不划算。**留给后续：** view.ts 已暴露 `onCuuReactionEmotion` 清晰接缝，
   shell.ts 传入一个把情绪经既有 Tauri 桥广播的实现 + desktop-cuu-runtime 接收端映射 CuuState（复用
   `cuuMotionForState`/packages/cuu motion.ts），即可闭环，需连带更新那条 exhaustive 断言并真机验收。

## 6. turn 流式期间的事件缓冲决策（点名要在报告说明）

参考 `turn-task-buffer.ts` 对 action_card.updated 的取舍，逐类判定：
- **message.updated（编辑/删除/置顶回流）/ reaction.updated**：`turnActive` 时**缓冲**，turn 落定
  （成功/失败都算）随 `flushBufferedActionCardUpdates` 同一收尾点 `flushChatBuffers` 统一重放。理由同
  action_card——它们会 renderScroll 整块重建滚动区，会抖动正在阅读的流式气泡；且两者都是幂等按 id 替换，
  推迟画面更新不改最终态。**main 会话 turnActive 恒 false，这两个队列在主区永远不攒东西**（缓冲只影响
  collab 1:1，那里编辑/置顶本就罕见）。
- **read.updated**：**不缓冲**——只动 receipts Map（幂等、不进滚动区 DOM），但 `turnActive` 时不立刻
  renderScroll（避免抖动），turn 落定的 renderScroll 会带出来。
- **observer.analyzing**：**不缓冲**——渲在独立指示行挂载点（不进滚动区），物理上不会打断流式气泡，照
  typing 瞬态处理。
- **message.created（新消息）**：照旧 mergeMessages（原行为）；额外：贴底时才顺带节流标记已读。

## 7. 消息窗口化（windowRecentMessages 300 条）的分割线/跳转处理

- 未读分割线 / 已读 N/M 的目标 id 在**整段 messages** 上算，但只有目标落在可见窗口内才渲（目标滚出 DOM
  窗口时不硬渲）。
- 跳转（引用块/置顶条/跳到未读）分三档：DOM 内→直接滚+高亮；本地有但被窗口折叠→撑 renderWindowSize 到
  包含它再滚；本地没有→照 loadOlderHistory 反向翻页（20 页硬上限，防跳到已删/不存在目标时无限翻页）加载
  到后撑窗口再滚，到头还没有就诚实什么都不做。

## 8. 自查输出（测试计数前后对比）

| 命令 | 前 | 后 | 结果 |
|---|---|---|---|
| `pnpm --filter @workhub/desktop-webview test` | 890 | 966 | 绿（966 pass / 0 fail / 0 skip） |
| `pnpm -r typecheck` | — | 16/16 项目 0 错 | 绿 |

新增测试文件：reactions.test.ts(9)/read-state.test.ts(12)/presence-state.test.ts(2)/reaction-emotion.test.ts(6)；
扩充：events.test.ts(+13)/timeline.test.ts(+7)/render.test.ts(+18 新增，修 9 处既有断言见 §4)/api.test.ts(+10)。

## 9. 范围外发现 / 没做 / 存疑

- **桌宠彩蛋接收端接线**（见 §5）——stretch 未完，clean 接缝已留，需连带改 desktop-cuu-runtime.test:255
  exhaustive 断言 + 真机验收。
- **`#会话` 灰 chip 保留**（按 §5，等 SEARCH 批接线）——`/` trigger 解析器（trigger-parser.ts）未动，用户
  在输入框敲 `/` 仍会弹既有「即将上线」占位 picker；只撤了可见的 `/技能` chip 与占位文案里的「/技能」。
  这是设计只说「撤 chip」的最小改动，未越界动解析器。
- **真机/浏览器验收**：desktop-webview 需 Tauri（vibrancy/桌宠窗），浏览器预览渲染不出——本工包验收 =
  typecheck + 966 单测全绿，真机图文验收归人工（同本仓库 desktop 既有约定）。
- **mountChatView 无 DOM 单测**（既有事实，见其顶部注释）：本批新接线逻辑全部下沉进 render/api/events/
  timeline/reactions/read-state/presence-state/reaction-emotion 的纯函数逐一单测，view.ts 只接线。
