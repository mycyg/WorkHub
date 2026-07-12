# 批 7 完成汇报（Cuu 联动与打扰路由 · webview 侧切片）

日期：2026-07-12 · 分支：`r12/batch7-cuu`（从 `r12/workbench-full` @ `d51f1c0e` 切出，含 `b22f8c28`）

> 范围声明：这是批 7「Cuu 联动与通知」里**只做 webview 可达部分**的窄切片——`client-tauri/` 任何文件
> 一律不碰（Rust 通知栈正被 R11 加固线改造，越界会撞车）。真正能让 message/action_card 两类事件从
> 会话 SSE 流一路弹到桌宠气泡，还差 Rust 侧一个改动（见文末「Rust 侧待办」），本批诚实止步于此。

## 做了什么

四句话人话版：写了一个纯函数「打扰矩阵」——给定「工作台窗口是否前台且正看着这个会话」和「事件类别
（消息/行动卡/派活问询/提议）」，判定该窗内呈现、弹 Cuu 气泡、还是安安静静不打扰，外加骚扰控制（同
会话 60 秒合并气泡）和一个有上限的去重表。真正接上了两条通路：① 派活问询通知（`action_card_item.
dispatch_ask`，已经在走 `/me` 推送流的真实事件）现在换成 Cuu 二次元人格的问句话术，并带「去工作台看
看」的深链动作；② 工作台窗口自己看得到的会话事件（行动卡更新/消息）经打扰矩阵判断后，跨窗口广播给
桌宠/主窗弹气泡。气泡点击 → 深链定位工作台会话，复用批 1 已经验证过的 `open_workbench` invoke +
冷启动竞态 stash，不是另起的第二条协议。

## 改动文件清单

| 路径 | 说明 |
|---|---|
| `apps/desktop-webview/src/workbench/interruption-policy.ts` | 打扰矩阵核心：`decideWorkbenchInterruption`（纯函数决策）、`classifyWorkbenchInterruptionCategory`（事件类型→类别）、`extractWorkbenchDeepLinkTarget`、`createWorkbenchBubbleMergeThrottle`（60s 合并节流）、`createWorkbenchNotificationDeduper`（有上限 FIFO 去重，形状照抄 client-tauri `notify.rs` 的 `ShellSystemNotificationDeduper`，不是照抄代码）（新） |
| `apps/desktop-webview/src/workbench/interruption-policy.test.ts` | 18 条：2×4 全矩阵 + classify 正反例 + extract 边界 + throttle 合并/过期/分组隔离/reset + dedupe FIFO 淘汰/maxKeys=0（新） |
| `apps/desktop-webview/src/workbench/cuu-bubble-deeplink.ts` | 深链 href 构造/解析（`buildWorkbenchDeepLinkHref`/`parseWorkbenchDeepLinkHref`）+ 派活问询气泡话术（`buildDispatchAskBubbleCopy`）。纯函数，刻意不碰 `window`（见下方「我改过的断言」之外的架构说明）（新） |
| `apps/desktop-webview/src/workbench/cuu-bubble-deeplink.test.ts` | 8 条：href 构造/往返解析/协议白名单/话术真实性（新） |
| `apps/desktop-webview/src/workbench/cuu-bubble-open.ts` | 真正发起 `invoke("open_workbench", ...)` 的一半（原本和上面同一个文件，见下方拆分说明）（新） |
| `apps/desktop-webview/src/workbench/cuu-bubble-open.test.ts` | 3 条：降级路径 + stash-before-invoke 顺序 + conversationId 缺省省略（新） |
| `apps/desktop-webview/src/workbench/interrupt-broadcast.ts` | 工作台窗口侧：解析 `conversation.message.created`/`conversation.action_card.updated` 原始 SSE 帧 → 打扰矩阵判定 → dedupe/节流 → 跨窗口 `emit("workbench-interrupt", ...)`（新） |
| `apps/desktop-webview/src/workbench/interrupt-broadcast.test.ts` | 9 条：前台/后台×两类事件、garbage 静默忽略、dedupe、60s 合并、`isForeground()` 抛错时的降级默认值（新） |
| `apps/desktop-webview/src/workbench/window-bridge.ts` | 新增 `isFocused()` 方法（Tauri v2 `Window.isFocused()` 透传）——打扰矩阵靠它判断工作台窗口是否前台（改） |
| `apps/desktop-webview/src/workbench/window-bridge.test.ts` | +2 条覆盖 `isFocused`（改） |
| `apps/desktop-webview/src/workbench/chat/view.ts` | `mountChatView` 新增可选 `onConversationEvent` 回调，每条会话 SSE 帧原样转发一份（不只是消息/typing 消费得了的）；不传就是纯本地渲染，行为不变（改） |
| `apps/desktop-webview/src/workbench/shell.ts` | 组装 `interrupt-broadcast` 广播器（用 `windowBridge.isFocused()` + `resolveDesktopShellEmitter`），接进 `mountChatView` 的 `onConversationEvent`；任一依赖不可用时优雅降级为 `undefined`（改） |
| `apps/desktop-webview/src/desktop-cuu-runtime.ts` | `DesktopShellEventName` 新增 `"workbench-interrupt"`；`bindDesktopShellCuuRuntime` 拦截 `notification.created` 里的 dispatch_ask 换成自定义卡（并挡掉 `cardFromEvent` 的通用卡，避免同一条通知出两张卡）；新增 `workbench-interrupt` 事件的接收/去重/建卡（改） |
| `apps/desktop-webview/src/desktop-cuu-runtime.test.ts` | +4 条：dispatch_ask 单卡不重复、dispatch_ask dedupe、workbench-interrupt 建卡、workbench-interrupt 畸形 payload 静默忽略；改 1 条既有断言（见下）（改） |
| `apps/desktop-webview/src/pet-surface.ts` | 点击处理器新增分支：`/workbench/...` href → `openWorkbenchRouteFromPet`（真实 invoke），失败给诚实的「打不开」文案，不是假接线（改） |
| `apps/desktop-webview/src/pet-surface.test.ts` | +2 条：真实 invoke 路由 DOM 全链路（含点击→invoke 断言）+ 无 Tauri 时的降级文案（改） |

## 我改过的断言

**`apps/desktop-webview/src/desktop-cuu-runtime.test.ts`**：既有测试「desktop Cuu runtime listens to
Rust push-event and sse-status channels」末尾断言 `dispose()` 后停掉的订阅列表
`["push-event", "sse-status", "system-notification"]`。本批新增了第四条真实订阅
（`"workbench-interrupt"`，接收工作台窗口广播），`dispose()` 现在会多停一条，我把断言改成
`["push-event", "sse-status", "system-notification", "workbench-interrupt"]`。这是铁律1允许的
「计划内、有理由」变更——新订阅是本批要求的真实行为变化，不是迁就实现而削弱断言。

**没有为了绿而改的断言**：以上是唯一改动的既有断言；其余全部是新增测试。

## 架构说明：为什么 `cuu-bubble-deeplink.ts` 拆成了两个文件

写完第一版（`buildWorkbenchDeepLinkHref` + `openWorkbenchRouteFromPet` + `buildDispatchAskBubbleCopy`
放同一个文件）后跑 `pnpm -r typecheck`，`apps/api` 报错：

```
apps/api typecheck: ../desktop-webview/src/workbench/pending-deep-link.ts(41,23): error TS2304: Cannot find name 'window'.
```

根因：`apps/api/src/qa/cuu-r3-launcher-harness.ts`（既有代码，本批之前就在）直接跨包
`import ... from "../../../desktop-webview/src/desktop-cuu-runtime.js"`，把 `desktop-cuu-runtime.ts`
整条 import 链纳入了 `apps/api` 的 tsconfig（`lib` 只有 `ES2022`，没有 `DOM`）重新 typecheck 一遍。
本批往 `desktop-cuu-runtime.ts` 加了对 `cuu-bubble-deeplink.ts` 的 import（要用
`buildWorkbenchDeepLinkHref`/`buildDispatchAskBubbleCopy` 渲染派活问询卡），而当时那个文件里还捆着
`openWorkbenchRouteFromPet`——它经 `pending-deep-link.ts` 的 `stashPendingWorkbenchDeepLink` 用到
`window.localStorage`，这个引用顺着 import 图传染进了 `apps/api` 的 Node-only 编译单元。

这不是本批引入的架构问题（那条跨包 QA import 本来就在，`client-tauri` 也不许碰），但拆分是范围内、
不碰 `apps/api` 就能做到的干净修法：`cuu-bubble-deeplink.ts` 现在只剩纯函数（href 构造/解析 + 话术模
板），`desktop-cuu-runtime.ts` 只依赖这个干净的一半；真正碰 `window`/`invoke` 的
`openWorkbenchRouteFromPet` 挪进新文件 `cuu-bubble-open.ts`，只被从不进 `apps/api` 编译图的
`pet-surface.ts` 引用。拆分后 `pnpm -r typecheck` 全绿（16/17 workspace，第 17 个是 Rust crate）。

## 自查输出

- `pnpm --filter @workhub/desktop-webview test`：**494 个测试，494 通过，0 失败**（批 6 交接时的基线
  是 448；本批净增 46 条：3 个新文件 30 条 + 4 个改动文件新增 16 条，见下方明细）。
  - `interruption-policy.test.ts`：18（新文件）
  - `cuu-bubble-deeplink.test.ts`：8（新文件，原 11 条里的 3 条随 `openWorkbenchRouteFromPet` 一起搬到新文件）
  - `cuu-bubble-open.test.ts`：3（新文件）
  - `interrupt-broadcast.test.ts`：9（新文件）
  - `window-bridge.test.ts`：5 → 7（+2）
  - `desktop-cuu-runtime.test.ts`：35 → 39（+4）
  - `pet-surface.test.ts`：45 → 47（+2）
- `pnpm --filter @workhub/desktop-webview typecheck`：0 错。
- `pnpm -r typecheck`：**16/17 workspace 全过**（第 17 个是 Rust crate，无 typecheck 脚本，与本批无关；
  途中撞见并修复了上述跨包 typecheck 传染问题）。
- `pnpm test`（全仓）：所有 workspace 0 fail（`apps/api`/`apps/web`/`packages/*` 均未受影响——本批唯一
  改的既有文件都在 `apps/desktop-webview/**`）。
- `pnpm verify`：**PASS**（`Overall: PASS`，typecheck+test+lint+audit:portable-config+
  audit:target-paths+audit:migrations+qa:r2-release-gate+qa:r4-rust-system-i18n+全部 cuu-r3-*
  smoke，退出码 0）。跑完后 `git status` 发现三个被 QA 脚本副作用重新生成的文件（
  `client-tauri/src-tauri/gen/schemas/capabilities.json`、
  `docs/workhub/05-clients/assets/audit/2026-06-11-r4-rust-system-i18n/{rust-system-i18n-report.json,
  smoke-summary.md}`）——这是仓库既有的已知行为（批3汇报也记过同款现象），已用
  `git checkout --` 全部还原、未纳入提交（铁律6/8；其中 `capabilities.json` 尤其不能提交，
  它在 `client-tauri/**` 范围内）。
- `git status`：确认没有范围外文件被改（下方逐条列过的改动清单是全部改动，都在
  `apps/desktop-webview/**` 与本报告文件内）。
- Rust 批次要求的 `cargo test --manifest-path client-tauri/src-tauri/Cargo.toml`：**没有跑，也不许
  跑**——任务原文明确「本批禁碰 client-tauri/ 任何文件」，覆盖了铁律5关于批7要跑 cargo test 的默认
  要求；本批对 client-tauri 只做了只读阅读（notify.rs/sse.rs/window_controls.rs/main.rs 的
  `open_workbench`），零改动。

## 设计决策（供集成者/审查者知晓）

1. **打扰矩阵的输入粒度是「会话」不是「窗口」**：00 §8 原文只提到「主窗前台/后台」，本批把它收窄成
   「工作台窗口前台 且 正看着这条事件所属的会话」——这是对原设计的忠实细化（群聊+协同会话架构下，
   窗口前台但开着别的会话/网盘视图仍然应该弹气泡），不是自创新规则。
2. **矩阵结论**：`message`(未看着)→静默（大流量群聊不能条条弹气泡，00 §2.1"刻意不做已读回执"的克制
   基调）；`action_card`/`dispatch_ask`/`proposal`(未看着)→气泡；任何类别(正看着)→窗内呈现。
3. **dispatch_ask 话术改成了问句，不是任务原文示例给的"我开工了喵"（既成事实句）**：查了真实服务端
   代码（`conversation-observer.ts` 的 `dispatchExecuteItem`）——`dispatch_ask` 通知只在
   `dispatchPolicy==="ask"` 时发，语义是"问要不要接"，还没开始跑；`dispatchPolicy==="auto"` 的路径
   直接执行、**当前完全不产生任何通知**。示例文案的"已开工"语气对应的是 auto 路径，但那条路径没有
   事件可挂。本批把话术写成忠于"ask"语义的问句（保留二次元语气/@口吻/喵结尾），并在下方「Rust 侧
   待办」外单独记一条服务端缺口。
4. **dispatch_ask 只能深链到项目，深不到精确会话**：`Notification` 契约（`packages/db/src/repositories
   /notifications.ts` 的 `CreateNotificationInput`）没有 `conversationId` 字段，只有 `projectId`/
   `workItemId`。深链动作因此只带 `projectId`，落地会打开该项目工作台的主区群聊（默认会话），不是
   精确定位到某条行动卡。诚实降级，不伪造。
5. **60s 合并节流目前只做"是否再弹一条"的判定，不做 UI 角标数字**：`createWorkbenchBubbleMergeThrottle`
   返回 `mergedCount`，但没有任何地方把这个数字画到已展示的气泡上（比如"3 条新动态"）。这是刻意的
   最小实现——UI 合并展示需要气泡组件支持"原地更新计数"，属于 pet-surface.ts 气泡渲染层的改动，
   本批没有为它扩大范围。
6. **`workbench-interrupt` 广播依赖两个独立的优雅降级点**：`resolveDesktopShellEmitter()`（拿不到
   `__TAURI__.event.emit`）和 `windowBridge.isFocused()`（拿不到就默认"前台"）。两者任一失效，
   `shell.ts` 就不传 `onConversationEvent`，`interrupt-broadcast.ts` 整条链路直接不跑，`chat/view.ts`
   的本地渲染完全不受影响——这不是"半成品"，是显式设计的降级路径，且有专门测试覆盖
   （`interrupt-broadcast.test.ts` 的 "isForeground() 抛错时默认当作前台"）。

## Rust 侧待办（留给 R11 加固线，本批诚实止步，未强行绕过）

1. **`message`/`action_card` 两类会话事件目前只能从"已经打开工作台窗口"这一侧触达气泡，桌宠/主窗
   自己收不到**。根因（已用只读方式核实，未改动任何 Rust 文件）：
   - `client-tauri/src-tauri/src/sse.rs` 的 `startup_shell_sse_targets()` 硬编码
     `vec![ShellSseTarget::Me]`——桌宠/主窗的 SSE worker 只订阅 `/api/push/stream/me`。
   - `conversation.message.created`/`conversation.action_card.updated` 只发布到
     `topics.conversation(<id>).topic`（`apps/api/src/services/action-cards.ts:158`、
     `apps/api/src/workers/conversation-observer.ts:546`），从不进入 `topics.user(<id>)`（"me"话题）。
   - 本批的 workaround（`interrupt-broadcast.ts`）只能覆盖"工作台窗口这次会话开着"的场景——工作台窗口
     完全没打开时，`message`/`action_card` 事件哪怕产生了也传不到桌宠。
   - **建议修法（不确定是否是 R11 线该管的范围，留给人裁决）**：要么给桌宠/主窗额外订阅用户参与的
     所有 `conversation:<id>` 话题（需要一个"我在哪些会话里"的列表 API + 动态订阅管理，改动量不小），
     要么服务端把"值得打扰"的会话事件也镜像发布一份到 `topics.user(<id>)`（复用现有 `/me` 通路，
     改动集中在 `action-cards.ts`/`conversation-observer.ts` 两处 publish 调用，量小但要过一遍
     `notification.created` 的既有 dedupe/urgency 规则，避免和 dispatch_ask 撞车）。
2. **`ShellSystemNotificationPlan` 的 `window_control` 目前只会算出 `focus_main_route`（聚焦到经典主
   窗），从不算 `focus_workbench_route`（`window_controls.rs` 里这个函数已经存在，但
   `notify.rs::system_notification_plan_from_push_payload_for_locale` 从没调用它）。这意味着：真正
   触发系统级 OS 通知（如 dispatch_ask 若被判定为 High/Urgent urgency）、用户点系统通知气泡时，
   Rust 侧会拉起经典主窗而不是工作台窗口——和本批 webview 侧"点 Cuu 气泡→进工作台"的体验不一致。
   跨过这条边界需要 Rust 判断该事件是不是"工作台/会话相关"，不在本批 webview 范围内。
3. **`ShellSystemNotificationDeduper`（Rust）与本批新增的 `createWorkbenchNotificationDeduper`
   （TS）是两套独立的、不共享状态的去重表**——形状故意保持一致（cap+FIFO），但没有打通。目前互不冲突
   （分别管各自能看到的事件源），但如果未来 Rust 侧的系统通知管线开始处理
   `conversation.action_card.updated` 之类事件，需要有人核对两边 dedupe key 是否会对同一条事件各自
   放行一次（造成"系统通知+Cuu气泡各弹一次"）。

## 服务端侧待办（不在 client-tauri，也不在本批 apps/desktop-webview 范围，纯记录）

- `dispatchPolicy==="auto"` 的执行类派活目前**不产生任何通知**（`conversation-observer.ts` 的
  `dispatchExecuteItem`，`auto` 分支直接 `enqueue` 后返回，没有 `createOrUpdateNotification` 调用）。
  若产品希望"已经开工了"这类既成事实播报（批7任务原文示例的语气），需要服务端为 auto 路径也补一条
  通知（类型待定，例如 `action_card_item.dispatch_auto`），本批 webview 侧的 `classifyWorkbenchInterruptionCategory`
  已经预留了识别新 notification type 的扩展点（改一行 `switch`/正则即可接上），不需要动打扰矩阵本身。

## 没做/存疑

- **真机验收**（真实 `.app` 里点击气泡、拖动工作台窗口切前后台、观察 vibrancy/穿透）未做——这批全程
  只用 `node --test` 的 DOM 假宿主环境验证（`withFakePetDom` + 真实 `__TAURI__.core.invoke` mock）。
  `window-bridge.ts` 顶部注释已经点出的已知缺口（`capabilities/default.json` 的 `windows` 列表还没把
  `"workbench"` 加进去）依然存在——这意味着即使桌宠气泡的深链点击代码是真实接线，工作台窗口本身能不
  能收到 Tauri 事件/权限仍取决于这个配置项，需要人工在真机上确认。
- **桌宠状态呼应**（00 §8 提到的"项目有 run 跑→专注小动作/有卡待拍板→举牌"）——任务描述里标注为
  「彩蛋级」，本批没有做，也没找到任何真实数据源可以驱动（军团面板批5的会话级 runs 数据本身也还在
  分期边界内）。诚实跳过，不伪造。
- **60s 合并计数没有画到气泡 UI 上**（见上方设计决策 #5）。
- **`message` 类别弹"静默"这条决策是本批的产品判断，不是 00 文档字面写死的**——00 §8 只说"前台在窗
  内/后台走气泡"，没有细分事件类别。如果集成者认为普通消息也该弹气泡（比如高优先度的项目），
  `classifyWorkbenchInterruptionCategory`/`decideWorkbenchInterruption` 的矩阵表是一处集中修改点，
  不需要动其它文件。
