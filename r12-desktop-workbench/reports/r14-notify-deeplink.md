# R14 FIX 批第 4 项完成汇报（通知深链缺 conversation_id）

日期: 2026-07-14 · 执行: Claude · 分支: `r14/notify-deeplink`（拉自 `origin/main` @ `afc792d1`）
立案: R12 立案 A1 项——通知（notifications）契约缺 conversation_id，会话相关通知点开无法直达对应会话。

## 结论先说：不是从零开始，是补齐一个已经开了头的口子

调查发现 R13 批 P2（`r12-desktop-workbench/reports/r13-p2-decision-loop.md`）已经把
`action_card_item.dispatch_ask` 这一种通知类型的 conversation_id 深链全链路打通了（契约
`packages/contracts/src/notification.ts` 的 `Notification.conversation_id`、服务端
`extractConversationIdFromTargetUrl`、桌面气泡 `desktop-cuu-runtime.ts` 的
`parseDesktopDispatchAskNotification`）。本批要修的缺口是：**除 dispatch_ask 外，其它有会话上下文
的通知产生点没有跟进**，以及**通知页 VM（web 用的那份）和桌面通用气泡通路都没有跟进**。

## 调查结论：五个候选产生点逐一排查

按施工契约点名的「观察者派活、行动卡状态、升级、Cuu 汇报、会议」逐一核实：

1. **观察者派活**（`action_card_item.dispatch_ask`，`conversation-observer.ts` 的
   `dispatchExecuteItem`）——R13 P2 已做，本批不改，只加了桌面侧的回归覆盖（见下）。
2. **行动卡状态**——仓库里唯一挂在 notifications 表上的"行动卡"通知就是上面的 dispatch_ask；
   `dispatchDecideItem`（拿不准要人拍板的条目）本身不产生 notifications 表行，只写
   `escalation_events` + 会话内 systemNote（这条是另一个已知缺口，`functional-review-2026-07-13.md`
   的 A1/A2/A3，不在本批范围——本批没有touch escalations.ts/action-cards.ts）。
3. **升级**——`workitem.escalated`/`workitem.pm_mode`/`workitem.in_review` 里程碑通知
   （`packages/events/src/lifecycle.ts` 的 `createLifecycleNotificationDrafts`，唯一挂载点是
   `apps/api/src/workers/agent-runner.ts` 的 `notifyRunMilestone`，只在 run 结算为
   escalated/in_review 时触发——`ai_working`/`pm_mode`/`merged`/`cancelled` 四个里程碑目前没有任何
   调用点触发，是仓库既有的死枚举分支，不在本批范围）。**这是本批唯一实际有会话上下文、且当前确实
   缺 conversation_id 的产生点**：观察者以 `dispatch_policy=auto` 派发的 run 带
   `agent_runs.source_conversation_id`，run 失败/需要审查时应该能深链回那段会话讨论。**已修**。
4. **Cuu 汇报**——`apps/api/src/services/run-conversation-report.ts`：run 终态为
   failed/escalated 时往 `source_conversation_id` 那条会话里直接 post 一条 system_event，**这条汇报
   本来就活在会话里面**，不经过 notifications 表，没有"深链缺口"可修（打开那条会话就能看到）。
5. **会议**——`apps/api/src/services/schedule-notify-pages.ts` 的
   `ensureMeetingInsightNotifications`：会议洞察的来源是 `meeting_insights`/`meetings` 表，和工作台
   会话（`conversations`/`project_conversations`）是两套不相关的实体，没有会话上下文可关联——**没有
   硬造**。

## 改动清单

### 1. 契约（packages/contracts）

- `src/pages.ts`：`notificationItemVmSchema` 新增可选 `conversation_id: idSchema.optional()`——
  additive，镜像 `notification.ts` 里已有的 `Notification.conversation_id`。之前只有原始
  `GET /api/notifications` 的响应体有这个字段，`GET /api/pages/notifications`（web 通知页用的那份
  VM）没有，只能自己解析 `target_href` 查询串。
- `src/contracts.test.ts`：补 schema 级回归（有/无 conversation_id 都能 parse，非法 uuid 拒绝）。

### 2. 产生点（apps/api）

- `services/notifications.ts`：
  - `extractConversationIdFromTargetUrl` 改为 `export`，给 `schedule-notify-pages.ts` 复用（同一个
    字段、同一份正则，不重复写）。
  - 新增 `appendConversationIdToTargetUrl`；`notifyMilestone` 签名扩展为
    `MilestoneNotificationContext & { conversationId?: string }`（只在 apps/api 这一层扩展，不改
    `packages/events` 的契约类型——那是 range fence 之外的包）,有值时把它缝进每条里程碑草稿的
    `targetUrl`，和 dispatch_ask 用同一套 `?conversation_id=` 查询串约定。
- `workers/agent-runner.ts`：`notifyRunMilestone` 调 `notifications.notifyMilestone(...)` 时透传
  `run.source_conversation_id`（有则带，无则不传，不硬造）。
- `services/schedule-notify-pages.ts`：`notificationItem()` 用同一份 `extractConversationIdFromTargetUrl`
  解出 `conversation_id` 暴露到页面 VM——和 `target_href` 共享同一条可见性判定（`target_href` 被
  `safeTargetHref` 拒绝时 conversation_id 也一并不可见，不绕过可见性判定单独泄漏"这条通知关联哪个
  会话"的信号）。

### 3. web 消费端（packages/ui）

- `gold-path/route-components.ts`：通知列表项新增 `data-r14-notification-conversation-id` 属性 +
  一行"这条通知关联一段讨论，打开后能看到相关上下文"的人话标注（中英文都有），只在
  `item.conversation_id` 存在时渲染。**跳转目标本身没有改变**——web 没有聊天 UI，`target_href`
  一直就是工作项页链接（已经带着 `?conversation_id=` 查询串），这里只是把"这条通知有会话背景"的
  事实标注出来，没有发明新路由。

### 4. 桌面消费端（apps/desktop-webview）

- `workbench/interruption-policy.ts`：修正一处过时注释（曾写"Notification 行没有 conversation_id
  字段"，R13 P2 起已经不准确），并确认 `extractWorkbenchDeepLinkTarget`（此前是没有生产调用方的
  死代码，只在自己的测试里用）现在被下面的桌面消费点复用起来。
- `desktop-cuu-runtime.ts`：新增 `parseDesktopConversationNotification` +
  `buildDesktopConversationNotificationCuuCard`，在既有的 dispatch_ask 专属拦截之后再加一层通用拦截：
  任何 `notification.created` 事件只要同时带 `project_id` + `conversation_id`（用
  `extractWorkbenchDeepLinkTarget` 抠取，不是重新写一份正则），就转成一张走
  `buildWorkbenchDeepLinkHref`（既有的 `pendingConversationId` 深链机制，R12 批7/F3 已经打通）的气泡，
  而不是退化成 `cardFromEvent`（`@workhub/cuu`）通用兜底——那条兜底路径的 href 直接是 `target_url`，
  点击后 `desktopPetMainRouteFromHref` 会把它当"主窗口路由"打开工作项页，完全绕开工作台/会话。
  文案不套 dispatch_ask 那句专属问句（"有个活想派给你"是特定语境），直接用通知自己的 title/body。
  没有 conversation_id 的通知（老部署/无会话上下文的类型）不受影响，照旧走通用兜底。

## 自查

```
pnpm --filter @workhub/contracts test        # 112 → 113（+1）全绿
pnpm --filter @workhub/api test               # 1205 → 1211（+6）全绿，1 skipped（既有，无关）
pnpm --filter @workhub/ui test                # 144 → 145（+1）全绿
pnpm --filter @workhub/web test               # 68 → 68（无新增——web 侧改动只在 packages/ui，
                                               #   apps/web 没有直接改动，无聊天 UI/无新路由）
pnpm --filter @workhub/desktop-webview test   # 859 → 862（+3）全绿
pnpm -r typecheck                             # 16/16 workspaces done，0 错
```

新增测试覆盖点（对应验收门要求）：
- 至少两个产生点带出 conversation_id：`notifications.test.ts`（`notifyMilestone` 直接单测）+
  `agent-runs.test.ts`（`notifyRunMilestone` 端到端：source_conversation_id → 里程碑通知）+
  `schedule-notify-pages.test.ts`（页面 VM 解析出 conversation_id）。
- 桌面点开带会话通知走深链：`desktop-cuu-runtime.test.ts` 新增
  "deep-links any conversation-linked notification (not just dispatch_ask) straight to the workbench"。
- 无会话上下文的通知不带字段且消费端不炸：上述每个正向测试都配了对照组（milestone 无
  conversationId 时 targetUrl 原样、页面 VM 不出现字段、桌面回退到通用兜底卡）。

## openapi.ts 手写 schema 未同步（范围围栏禁碰，只报不做）

`apps/api/src/openapi.ts` 有两处手写 JSON Schema 描述通知响应体，`additionalProperties: false`，
目前都没有 `conversation_id` 字段——这个抽屉从 R13 P2 给 `Notification.conversation_id` 落地时就已经
没同步（不是本批引入的新漂移，本批只是让它更明显：现在两个类型都会真的带上这个字段）：

1. `notificationItemResponseSchema`（约 2062 行，`GET /api/notifications` 用）：
   ```js
   conversation_id: uuidStringSchema,
   ```
   加进 `properties`，不加进 `required`（可选）。

2. `notificationPageItemResponseSchema`（约 2564 行，`GET /api/pages/notifications` 用）：
   同样加一行 `conversation_id: uuidStringSchema,`（不进 `required`）。

`pnpm --filter @workhub/api test` 全绿（含 `app.test.ts`），说明现有测试没有对这两个 schema 做
`additionalProperties:false` 的强校验回归，暂不会因为这个漂移在 CI 里炸红，但从文档准确性上看，
这两处需要人工同步。

## 范围外发现（不修，只报）

- `functional-review-2026-07-13.md` 的 A1/A2/A3（"拍板闭环"双端断裂：decide 类行动卡条目不产生
  notifications 表行、`POST /action-card-items/:id/decide` 零调用方、`escalations.resolve()` 与
  `action_card_items` 状态机不联动）不在本批范围——本批范围围栏禁碰 `action-cards.ts`/`escalations.ts`，
  且这是独立于"conversation_id 字段缺失"的另一类问题（这些条目现在压根没有 notifications 表行，
  不是"有行但缺字段"）。
- `packages/events/src/lifecycle.ts` 的 `lifecycleMilestones` 字典定义了
  `ai_working`/`pm_mode`/`merged`/`cancelled` 四个里程碑，但除了本批处理的
  `escalated`/`in_review`，仓库里没有任何调用点会触发这四个（`notifyMilestone` 只有
  `agent-runner.ts` 一处调用方，`notifyRunMilestone` 只计算 `escalated`/`in_review` 两种
  `newStatus`）——是否要接线是独立于本批的功能缺口，不在"通知深链"范围内。

## 没做/存疑

- 无。五个候选产生点全部排查完毕，能修的（升级）已修，不能修/不该修的（Cuu 汇报本就在会话内、会议
  无会话上下文、行动卡状态就是 dispatch_ask 本身）已在上面逐条说明理由。

## 测试数量汇总

| 包 | 之前 | 之后 |
|---|---|---|
| @workhub/contracts | 112 | 113 |
| @workhub/api | 1205 | 1211 |
| @workhub/ui | 144 | 145 |
| @workhub/web | 68 | 68 |
| @workhub/desktop-webview | 859 | 862 |
