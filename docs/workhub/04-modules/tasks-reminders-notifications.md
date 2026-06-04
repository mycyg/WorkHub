---
module: M-NOTIFY（任务 / 提醒 / 通知）
layer: L4（入口层 / 业务模块）· web + 桌宠两端
status: 🚧
owner: workflow
---

# 任务 · 提醒 · 通知（Tasks · Reminders · Notifications）

> **范围**：M-NOTIFY —— WorkHub 里「叫人、提醒人、把事推到人面前」的那一层：**通知收件箱（去重 + 变更检测）· 待办/DDL 提醒 · 日程排期 · 桌宠主动呈现（替代右下角弹窗）**。本篇是**页面规划级**：逐页给路由、布局（顶栏/侧栏/主区/面板/弹层）、关键组件、数据/API 绑定、SSE 实时订阅、四态（空/加载/错误/无权限）、关键交互与跳转流、web↔桌宠差异，尽量给文字版 wireframe。
>
> **定位与边界**：本篇只管「通知/提醒/日程这一层的页面与流转」。
> - 实体字段、软删除/审计字段 → 见 [`../01-architecture/data-model.md`](../01-architecture/data-model.md) §10（`Notification`/`ScheduleEvent` 沿用）与真实实体 `app/models.py`（`Notification:146` / `ScheduleEvent:250`）。
> - 端点签名、SSE 帧格式、鉴权依赖、错误码、topic 隔离 → 见 [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md) §2.12 / §3 / §5；本篇只引用不重抄。
> - 桌宠窗口/托盘/deep-link/本地能力的**端侧机制** → 见 [`../05-clients/desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md)（🚧）；本篇只管「通知/提醒在桌宠上**怎么呈现给用户**」。
> - **通知文案、状态标签、AI 把握程度的人话** → 以 [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md) 为权威；本篇用户面文案一律走人话（零 snake_case、零 git 黑话、零裸数值）。
> - 升级简报、审批询问这类「AI 主动找人」的**内容来源** → 见 [`../02-ai-engine/pm-mode-orchestration.md`](../02-ai-engine/pm-mode-orchestration.md) 与 [`../03-collaboration/review-and-approval.md`](../03-collaboration/review-and-approval.md)；本篇负责把它们**投递并渲染**为通知/桌宠气泡。
>
> **扎根**：通知/提醒/日程是现有「需求管理大师」**已跑通**的能力，且踩过真实的坑（跨用户泄漏、徽章卡死、提醒刷屏），WorkHub **保留这些已沉淀的契约并 AI-native 化**。核心代码锚点贯穿全文：`app/services/notifications.py`、`app/services/push_bus.py`、`app/routers/notifications.py`、`app/routers/reminders.py`、`app/routers/calendar.py`、`app/routers/planning.py`、`app/routers/push.py`、`web/src/pages/NotificationsPage.tsx`、`web/src/pages/CalendarPage.tsx`、`web/src/pages/PlanningPage.tsx`、`web/src/hooks/useNotificationToasts.ts`、`web/src/App.tsx`、`client-tauri/src-tauri/src/reminders.rs`、`client-tauri/src-tauri/src/tray.rs`、`client-tauri/src-tauri/src/sse.rs`、`client-tauri/src-tauri/src/notify.rs`、`client-tauri/src-tauri/src/deep_link.rs`、`client-tauri/src-tauri/src/commands/submitter.rs`、`client-tauri/web-src/src/App.tsx`、`client-tauri/web-src/src/routes/Inbox.tsx`、`client-tauri/web-src/src/routes/Calendar.tsx`、`client-tauri/web-src/src/routes/MyWorkload.tsx`、`client-tauri/web-src/src/components/SidebarWork.tsx`、`client-tauri/web-src/src/components/FloatingAssistant.tsx`。

---

## 0. 这个模块在 WorkHub 里的位置（先对齐心智）

### 0.1 M-NOTIFY 不产生事实，它是「事实的扩音器 + 闹钟」

WorkHub 的事实在别处发生（WorkItem 状态流转、AI 升级、审批询问、DDL 临近、工作区阻塞）。M-NOTIFY 的职责是把这些事实**及时、不重复、按身份私密地**推到对的人面前，并提供一个可回看的收件箱。三类载体各司其职：

| 载体 | 内部实体 | 用户用语 | 触发主体 | 落库锚点 |
|---|---|---|---|---|
| **通知** | `Notification`（带 `dedupe_key` 去重 + 变更检测） | 「通知 / 收件箱」 | 系统/AI/他人动作 | `models.py:146`、`services/notifications.py:30` |
| **提醒** | (派生，不落表) `ReminderOut` | 「提醒 / 还有多久到截止」 | DDL 临近/逾期 | `routers/reminders.py:29`（实时从 `Requirement.due_at` 算） |
| **日程** | `ScheduleEvent` | 「日程 / 日历」 | 用户预约 + 需求 DDL 自动落点 | `models.py:250`、`routers/calendar.py` |

> **关键区分**：**通知是持久的、可读/可归档的收件箱条目**；**提醒是瞬时计算的、不落库的「当前该被催的事」**（`reminders.py` 每次实时查 `due_at`，不存 `Reminder` 行）；**日程是日历上的时间块**。三者在 UI 上互相引用（一条 DDL 既是日历上的块、又会派生「即将到期」通知、又会被桌宠提醒），但数据来源不同，不要混为一谈。

### 0.2 AI-native 化：通知是「AI 找人」的最后一公里

WorkHub 的命门是「AI 受阻 → 化身项目经理组织人」（PRD §5）。AI 找人的所有出口——升级简报、催办、审批询问、派活提议——**最终都落成一条通知 + 一次桌宠呈现**。所以 M-NOTIFY 是 AI 自治闭环对用户可见的「最后一公里」：

- **现状先例**：通知已经在承载「你被指派到 X」「DDL 逾期」「工作区阻塞」（`routers/notifications.py:38/51/75`），且 `severity` 已分 `normal/high/urgent`，桌宠端据此决定是否弹系统通知(`reminders.rs:135`)。
- **WorkHub 增量**：新增通知 `type`——`escalation`（AI 请人接手）、`approval_ask`（等你点头）、`staffing_proposal`（AI 建议谁来做）、`agent_done`（AI 做完待你扫一眼）。这些不是新机制，是给现有 `create_notification` 加 `type` + 走现有 `severity` 分级（详见 §2.3 通知类型表）。
- **去黑话 + 带理由 + 不暴露数值**：通知正文一律人话（承袭 `notifications.py:43` 的「该去把它从火里捞出来了」风格），表达 AI 把握程度只用三档语气，绝不出现 `confidence=0.82`（glossary §3.3）。

> **WorkHub 不重写已跑通的链路**（D-1）：去重/变更检测（`notifications.py:43-77`）、按身份私有投递（`notifications.py:105`）、徽章不卡死的 read 语义、桌宠 60s 兜底轮询去重（`reminders.rs`）——这些是踩坑沉淀的契约，**原样保留**，只在其上加事件流实时性与新 `type`。

### 0.3 通知严重度与状态（用户标签走 glossary）

通知本身无复杂状态机，只有「读/未读 + 归档」两个正交标记 + 一个严重度。真实枚举来自代码：

| 实体.字段 | 内部枚举（真实代码） | 用户呈现 | 锚点 |
|---|---|---|---|
| `Notification.severity` | `normal` | 普通条目（info 色），桌宠**不**弹系统通知 | `notifications.py:51` |
| | `high` | 高亮条目（红 pill / warn 色），桌宠**弹**系统通知 | `notifications.py:46`、`reminders.rs:135` |
| | `urgent` | 同 high，最高优先（红色 + 置顶语气） | `useNotificationToasts.ts:60` |
| `Notification.read_at` | `null` / 时间戳 | **未读**(实心底) / **已读**(淡底) | `NotificationsPage.tsx:102` |
| `Notification.archived_at` | `null` / 时间戳 | 列表默认过滤掉已归档（`archived_at IS NULL`） | `notifications.py:101` |
| `ReminderOut.kind` | `overdue` | **已超过截止时间 N 分钟** | `reminders.py:20`、`reminders.rs:72` |
| | `due_now` | **现在到截止时间** | `reminders.py:21`、`reminders.rs:73` |
| | `due_2h` / `due_24h` | **还有 N 分钟到截止时间** | `reminders.py:22-26`、`reminders.rs:74` |

> **严重度→桌宠呈现的硬规则（沿用 `reminders.rs:135`）**：只有 `high`/`urgent` 走 OS 级系统通知（避免 normal 噪声轰炸）；所有 `severity` 都进收件箱列表与桌宠未读徽章。WorkHub 演进：把这条规则上移到「桌宠呈现策略」（§7.4），与 `availability_pref` 打扰边界（`data-model.md` §3.2）联动——忙碌时段降噪。

---

## 1. 页面与路由清单（逐页）

> 列「端」：W=web（C-WEB），P=桌宠（C-PET）。**web 与桌宠路由不同**——web 是 `BrowserRouter` 顶栏导航（`web/src/App.tsx:163`），桌宠是侧栏 + 托盘 + deep-link（`client-tauri/web-src/src/App.tsx`、`tray.rs`、`deep_link.rs`）。

| # | 页面 / 呈现 | web 路由 | 桌宠路由 | 端 | 现状锚点 | WorkHub 状态 |
|---|---|---|---|---|---|---|
| **N1** | **通知中心**（收件箱） | `/notifications` | `/inbox` | W+P | `NotificationsPage.tsx`、`Inbox.tsx` | 演进（加 type 分组 + 行内动作） |
| **N2** | **实时 Toast**（瞬时弹层，非页面） | 全局挂载 | 全局 `push-event` 转发 | W+P | `useNotificationToasts.ts`、`sse.rs` | 沿用 |
| **N3** | **日程表**（日历） | `/calendar` | `/me/calendar` | W+P | `CalendarPage.tsx`、`Calendar.tsx` | 沿用 |
| **N4** | **新建/编辑日程**（弹层/侧卡） | `/calendar` 内左卡 | （桌宠为只读，跳 web） | W | `CalendarPage.tsx:172`、`calendar.py:125` | 沿用 |
| **N5** | **资源排期**（团队负载，派活方工具） | `/planning` | `/me/workload`（我的负载，单人版） | W+P | `PlanningPage.tsx`、`MyWorkload.tsx`、`planning.py` | 沿用 |
| **N6** | **桌宠主动呈现**（系统通知 + 气泡，替代右下角弹窗） | (无；web 用浏览器 Toast) | 托盘徽章 + 系统通知 + 桌宠气泡 | P | `reminders.rs`、`tray.rs`、`commands/submitter.rs:242`、`FloatingAssistant.tsx` | 演进（命门，§7） |
| **N7** | **通知设置 / 打扰边界**（降噪偏好） | 设置弹层内分区 | `/settings` 内分区 | W+P | `SettingsDialog`、`Settings.tsx` | 新增（FR-IDENTITY `availability_pref`） |

> **三个不在本模块的相邻入口**（避免误归类）：① 需求详情页内的「工作区阻塞」开关是 M-WORKITEM 的，但它**产生**本模块的 `workspace_blocked` 通知（`notifications.py:75`）；② 会议确认产生的草稿通知归 M-MEETING；③ 审批询问的「同意/拒绝」按钮归 P-PERM，本模块只负责把它**送达 + 唤起**。

---

## 2. N1 — 通知中心（核心页，最详）

> **路由**：web `/notifications`（`App.tsx:163`）；桌宠 `/inbox`（`tray.rs:24` 托盘「打开待办收件箱」直达，deep-link `yqgl://inbox` 亦达，`deep_link.rs:9`）。

### 2.1 布局（文字版 wireframe）

web 端骨架（沿用 `NotificationsPage.tsx:73` 的真实结构，`max-w-5xl` 单列）：

```
┌─ 顶栏（无独立侧栏；web 全局顶栏 App.tsx:196 在页面之上）────────────────┐
│  eyebrow「通知中心」                                                    │
│  H1「通知中心」    [✓ 全部已读]（unread=0 时禁用）                       │
│  副标题「指派、DDL、阻塞、返工、Agent 完成，全在这里排队等你审判。」      │
├─ Tab 行（border-b）──────────────────────────────────────────────────┤
│  [🔔 未读]  [📥 全部]                                                    │
├─ 列表（paper-surface, divide-y）─────────────────────────────────────┤
│  ┌ 条目 ───────────────────────────────────────────────────────────┐  │
│  │ [severity pill]  2026-06-04 14:20                                │  │
│  │ 标题（粗）                                                        │  │
│  │ 正文（whitespace-pre-wrap，多行）                                 │  │
│  │                                      [去看看 ↗]  [已读]           │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  …（按 created_at desc 排列）                                          │
└────────────────────────────────────────────────────────────────────────┘
```

桌宠端骨架（沿用 `Inbox.tsx:74`，**带左侧 SidebarWork** `SidebarWork.tsx:75` 的「通知」入口高亮）：

```
┌─ 侧栏(SidebarWork w-56) ─┬─ 主区（flex-1 p-6 overflow-auto）──────────────┐
│ 需求 / 视角 分组          │  H1「🔔 通知」  [计数 Badge]   [未读][全部][全部已读]│
│ …                         │  ┌ Card（interactive，整卡可点跳详情）──────────┐ │
│ ─────────────             │  │ [type Badge]  标题(truncate)         [已读]   │ │
│ ▸ 通知 ←高亮              │  │              正文(line-clamp-2)               │ │
│   设置                    │  │              06-04 14:20                      │ │
└───────────────────────────┤  └────────────────────────────────────────────┘ │
                            └──────────────────────────────────────────────────┘
```

布局要点：
- **顶栏**：标题 + 「全部已读」主动作 + 未读/全部 Tab。web 用 `eyebrow+H1+副标题`（`NotificationsPage.tsx:75`），桌宠用 `H1 + 计数 Badge`（`Inbox.tsx:78`）。
- **无独立侧栏（web）/ 复用 SidebarWork（桌宠）**：web 顶栏即导航；桌宠在「接活 Space」左栏底部固定「通知」入口（`SidebarWork.tsx:75`）。
- **主区 = 单列卡片流**：每条一卡，`severity`/`type` 角标 + 时间 + 标题 + 正文 + 行内动作。
- **无面板/弹层**：N1 不开抽屉；点条目直接 deep-link 跳目标（`target_url` / `requirement_id`）。

> **WorkHub 演进（布局增量）**：在 Tab 行右侧加**类型筛选 chip**（全部 / 找你接手 / 等你确认 / DDL / 阻塞 / AI 完成），映射 §2.3 的 `type` 分组——让「AI 请人接手」这类高优先通知能一眼筛出。chip 仅前端按 `type` 过滤，不新增端点。

### 2.2 关键组件

| 组件 | 职责 | 现状/共享件 |
|---|---|---|
| `<NotifTabBar>` | 未读/全部 切换（+ WorkHub 类型 chip） | 内联（`NotificationsPage.tsx:86` / `Inbox.tsx:81`），抽进 C-UIKIT |
| `<NotificationItem>` | 单条（severity/type 角标 + 时间 + 标题 + 正文 + 去看看/已读） | `NotificationsPage.tsx:102` / `Inbox.tsx:120` |
| `<SeverityPill>` / `<Badge>` | 严重度/类型视觉（normal=info、high=warn/红、urgent=error） | `NotificationsPage.tsx:106`、`Inbox.tsx:125`（`@yqgl/shared` Badge） |
| `<ReadAllButton>` | 全部已读（unread=0 禁用 + 乐观刷新） | `NotificationsPage.tsx:80`、`Inbox.tsx:95` |
| `<TargetLink>` | `target_url` 跳转（站内 `<Link>` / 站外 `<a>`） | `NotificationsPage.tsx:8` |
| `<EmptyState>` / `<Skeleton>` / `toast` | 四态 + 实时提示 | 桌宠已用 `@yqgl/shared`（`Inbox.tsx:4`），web 端 WorkHub 统一收口 |

### 2.3 数据与 API 绑定

| 数据 | 来源 API（api-contract §2.12） | 现状锚点 | 触发时机 |
|---|---|---|---|
| 通知列表（未读/全部） | `GET /api/notifications?status=unread\|all&limit=80` → `NotificationOut[]` | `notifications.py:89`，`api.listNotifications()` / `clientJson` | 进页 + Tab 切换 + SSE reconcile |
| 标记已读 | `POST /api/notifications/{id}/read` → `NotificationOut` | `notifications.py:113` | 点「已读」/ 点整卡跳转时顺带 |
| 全部已读 | `POST /api/notifications/read-all` → `{ok, count}` | `notifications.py:129` | 点「全部已读」 |

> **数据形状要点（`NotificationOut`，`schemas.py:488`）**：`{id, type, severity, title, body?, target_url?, project_id?, requirement_id?, read_at?, archived_at?, created_at, updated_at}`。`body` 可空（仅标题的轻通知）；`target_url` 可空（无跳转目标）；桌宠端额外用 `requirement_id` 直跳 `/r/{id}`（`Inbox.tsx:121`），web 端优先用 `target_url`（`NotificationsPage.tsx:115`）。

> **服务端去重 + 变更检测（务必懂，UI 行为依赖它）**：`GET /api/notifications` 进来会先 `_ensure_due_notifications`（`notifications.py:96`）——它把「即将到期/逾期/工作区阻塞」按 `dedupe_key` **幂等**生成。关键坑（`services/notifications.py:43-77` 的注释明示）：同一 `dedupe_key` 每次轮询都会被重新 `create_notification`，**只有内容真变了才会清 `read_at` 重新置顶**；否则原样返回——否则一条逾期通知会**永远无法保持已读**，徽章卡死、「标为已读」看着像坏了。**UI 不需要自己去重，信任后端**。

**WorkHub 新增通知类型**（不改机制，加 `type` + 复用 `severity`/`dedupe_key`/`target_url`）：

| 新 `type` | severity | 触发来源 | 人话标题示例 | dedupe 策略 |
|---|---|---|---|---|
| `escalation` | `high` | AI 升级转 PM（`EscalationEvent`，data-model §7.4） | 「这个活 AI 拿不准，想请你来接手」 | `escalation:{workitem_id}:{round}` |
| `approval_ask` | `urgent` | 审批阻塞原语（`ApprovalRequest`，data-model §8.2） | 「有个操作等你点头才继续」 | `approval:{approval_id}` |
| `staffing_proposal` | `normal` | 智能派活建议（PRD §8.4） | 「AI 建议让小李来做这条，你看行不行」 | `staffing:{workitem_id}:{round}` |
| `agent_done` | `normal` | AI 工人完成待抽检（`ConfidenceRecord.verdict=human_spotcheck`） | 「AI 做好了，你快速扫一眼，通过或打回」 | `done:{proposal_id}` |
| `revision_requested`（现有 `revision.requested` 事件配套通知） | `high` | 打回回灌 | 「这个活被打回了，附了原因」 | `revision:{workitem_id}:{round}` |

> 现有 `type` 沿用：`due_overdue` / `due_soon` / `workspace_blocked`（`notifications.py:41/51/78`）+ 指派通知「你被指派到…」（经 `publish_notification_threadsafe`，`services/notifications.py:108`）。

### 2.4 SSE 实时订阅

通知的实时性来自**私有专流**（不是全局 `all`，这是安全红线，见下）：

| 事件 type | topic | payload | 现状锚点 | 本页如何用 |
|---|---|---|---|---|
| `notification.created` | **`user:{id}`**（私有） | `NotificationOut` 全字段 | `services/notifications.py:105` | 收到即：弹 Toast（N2）+ 列表插入/重拉 + 未读徽章 +1 |
| `connected` | (本连接) | `{topic}` | `routers/push.py:42` | 流就绪确认 |

**订阅姿势（两端已各自实现，WorkHub 统一收口）**：
- **web**：`useNotificationToasts()` 在 app shell 挂一次（`App.tsx:129`），`fetch("/api/push/stream/me", {credentials:"include"})` 读 `ReadableStream`，逐行解析 SSE 帧（`useNotificationToasts.ts:32`），`event:notification.created` → `toast()`。带**指数退避重连**（1s→30s 上限，`useNotificationToasts.ts:78`）。N1 页面自身也监听同一事件做列表 reconcile。
- **桌宠**：Rust 侧 `sse.rs` 同时连 `/stream`（全局非 PII）+ `/stream/me`（私有），统一转发为 Tauri `push-event`（`sse.rs:149`）；React 侧 `Inbox.tsx:46` 监听 `push-event` 内层 `notification.created` → `refresh()`。

> **安全红线（NFR-08，沿用真实事故修复）**：通知**只**发 `user:{id}` 私有 topic，**绝不**发 `all`。`services/notifications.py:94-103` 与 `sse.rs:6-10` 的注释都记录了同一起事故：早期把通知扇出到 `all`，导致每个客户端都收到**所有人**的通知（标题+正文+昵称），是跨用户信息泄漏。修复 = 拆 `/stream/me`。**WorkHub 以此为戒，任何新通知一律走 `user:{id}`**（api-contract §5.3）。

> **SSE 是尽力推送，REST 是真相（api-contract §7）**：`push_bus` 满队列会丢慢订阅者的事件（`push_bus.py:43`）。所以 N1 收到事件后**重拉列表 reconcile**，不把 SSE 当唯一数据源；桌宠还有 60s 兜底轮询（§7.2）确保不漏。

### 2.5 四态：空 / 加载 / 错误 / 无权限

| 态 | 触发条件 | web（`NotificationsPage`） | 桌宠（`Inbox`） | 现状锚点 |
|---|---|---|---|---|
| **空** | 未读 tab 无未读 | EmptyState：「暂时没有通知。系统终于学会闭嘴了。」 | EmptyState（BellOff 图标）：「没有未读通知」+「新事件出现时会实时弹通知并在这里出现。」+「查看全部」 | `NotificationsPage.tsx:100`、`Inbox.tsx:101` |
| | 全部 tab 无任何通知 | 同上文案 | EmptyState（Inbox 图标）：「通知箱是空的」+「你的全部通知都会在这里留存。」+「只看未读」 | `Inbox.tsx:104` |
| **加载** | 进页/切 Tab 拉列表 | WorkHub 加 Skeleton 行（现状直接空→填，`busy` 仅控按钮禁用） | 同（`@yqgl/shared` Skeleton） | `NotificationsPage.tsx:33`（`busy`） |
| **错误** | 列表拉取失败 | 红框：原始错误串（`setErr(String(e))`） | 静默置空 + `console.warn`（WorkHub 升级为可见错误条 + 重试） | `NotificationsPage.tsx:97`、`Inbox.tsx:35` |
| | 标记已读失败 | 红框：「标记已读失败：{e}」（但仍 reconcile，避免按钮卡死） | `console.warn("markRead failed")` + `finally refresh()` | `NotificationsPage.tsx:53`、`Inbox.tsx:54` |
| **无权限** | 未登录 / 无 cookie/令牌 | 整页被身份门拦截（401，`auth.py:127`），跳昵称弹窗 | 同（onboarding 守卫） | `auth.py:127` |

> **「已读」失败也要 reconcile（现状已实现，WorkHub 保留）**：两端的 `markRead`/`readAll` 都在 `finally` 里 `refresh/load`（`NotificationsPage.tsx:56`、`Inbox.tsx:60`），即使请求失败也重拉——否则用户反复点「已读」徽章不动，体验崩。这是踩过的坑（`Inbox.tsx:55` 注释明示「Previously failures were silent」）。

> **归档项不显示**：列表 SQL 过滤 `archived_at IS NULL` 且**软删项目的通知也不显示**（`notifications.py:101-105`：`outerjoin Project` + 过滤 `archived/deleted_at`）——admin 删了项目，就不再拿该项目的通知烦用户。

### 2.6 关键交互与跳转流

```
【进页】
GET /api/notifications?status=unread
  └ 后端先 _ensure_due_notifications（幂等生成 DDL/阻塞通知）→ 返回列表

【切 Tab：未读 ↔ 全部】
switchStatus(next) → load(next)（带 loadSeqRef 单调令牌防乱序，NotificationsPage.tsx:22）
  桌宠侧用 reqTokenRef 同样防「慢的未读结果盖掉快的全部结果」（Inbox.tsx:26）

【点条目 → 跳目标】
web:  点「去看看」→ target_url 站内 <Link> / 站外 <a>（NotificationsPage.tsx:8）
桌宠: 点整卡 → 若有 requirement_id → nav(/r/{id}) + 顺带 markRead（Inbox.tsx:120）

【标记已读】
点「已读」→ POST /read → finally 重拉（成功/失败都 reconcile）
  桌宠点整卡跳转时若未读则同时 markRead

【全部已读】
点「全部已读」→ POST /read-all → 重拉；unread=0 时按钮禁用（NotificationsPage.tsx:80）

【实时到达】
SSE user:{id} 推 notification.created
  → web: toast 弹层（N2）+ 若停在 N1 则重拉
  → 桌宠: push-event → Inbox.refresh() + 未读徽章刷新（§7.1）+ 若 high/urgent 弹系统通知
```

竞态防护（现状已实现，WorkHub 保留）：web `loadSeqRef` + `statusRef`（`NotificationsPage.tsx:22/23`，防 Tab 乱序 + 跨切刷新用对的 status）；桌宠 `reqTokenRef`（`Inbox.tsx:26`）。

### 2.7 与桌宠端（C-PET）的差异

| 维度 | web（C-WEB） | 桌宠（C-PET） | 锚点 |
|---|---|---|---|
| 路由 | `/notifications`（顶栏「通知」） | `/inbox`（侧栏「通知」+ 托盘直达 + `yqgl://inbox`） | `App.tsx:210`、`SidebarWork.tsx:75`、`tray.rs:24`、`deep_link.rs:9` |
| 组件来源 | 项目自有 + C-UIKIT | **`@yqgl/shared`**（Button/Card/EmptyState/Badge） | `Inbox.tsx:4` |
| 网络层 | `api`（cookie 鉴权） | `clientFetch`/`clientJson`（带 `X-YQGL-Client-Token` 设备令牌头） | `Inbox.tsx:5`、glossary §8 |
| 实时通道 | 浏览器 `EventSource`-风格 `fetch` 读流（`useNotificationToasts`） | Rust `sse.rs` 双流 → `push-event` Tauri 事件 → React 监听 | `useNotificationToasts.ts:32`、`sse.rs:149` |
| 条目交互 | 行内「去看看 + 已读」两键 | **整卡可点**直跳需求 + 角落「已读」 | `NotificationsPage.tsx:114`、`Inbox.tsx:120` |
| 系统级呈现 | 无（仅页内 Toast） | 托盘徽章 + OS 系统通知 + 桌宠气泡（§7） | `commands/submitter.rs:242`、`reminders.rs`、§7 |
| 未读徽章 | 无（页内 Tab 即可见） | **托盘 tooltip/title 同步未读数**（防抖 250ms） | 桌宠 `web-src/src/App.tsx` 的 `refreshUnreadBadge`、`commands/submitter.rs:242` |

### 2.8 响应式

- web `max-w-5xl` 单列；顶栏标题/动作 `flex-col sm:flex-row`（`NotificationsPage.tsx:74`），条目 `flex-col sm:flex-row`（窄屏标题/正文上、动作下，`NotificationsPage.tsx:103`）。
- 桌宠固定桌面窗口，`flex-1 p-6 overflow-auto`（`Inbox.tsx:74`），侧栏 `w-56` 定宽。

---

## 3. N3 — 日程表（日历）

> **路由**：web `/calendar`（`App.tsx:162`，顶栏「日程」）；桌宠 `/me/calendar`（`SidebarWork.tsx:29`「我的日程」）。

### 3.1 布局（文字版 wireframe）

web 端骨架（沿用 `CalendarPage.tsx:147`，双栏 `xl:grid-cols-[360px_minmax(0,1fr)]`）：

```
┌─ 顶栏 ───────────────────────────────────────────────────────────────┐
│  eyebrow「日程」  H1「📅 日程表」          [周][月][列表] 切换         │
│  副标题「需求 DDL 和预约事项都在这里，防止"明天要"变成"昨天就要"。」    │
├─ 左卡（paper-surface, 360）──┬─ 右卡（paper-surface, flex, min-h-520）─┤
│  「＋ 预约日程」              │  「📋 本周/本月/全部事项」  [N 件]      │
│  ┌ 标题 input ──────────┐    │  ┌ 事件卡（tone 按类型/到期着色）──────┐ │
│  ┌ datetime-local ──────┐    │  │ 标题(粗)                            │ │
│  ┌ 参与人勾选（在线点）─┐    │  │ 🕐 时间   👥 N人        [🗑(自定义)] │ │
│  └ [＋ 保存日程] ───────┘    │  │ 描述                                │ │
│                              │  └──────────────────────────────────────┘ │
│                              │  …（按 end_at 升序；月视图 2-3 列网格）  │
└──────────────────────────────┴────────────────────────────────────────┘
```

桌宠端骨架（沿用 `Calendar.tsx:58`，**7 列周视图网格** + 下方「本周一览」，**只读**）：

```
┌─ 侧栏 ─┬─ 主区 ───────────────────────────────────────────────────────┐
│ …      │  H1「我的日程」          [← 上周][今天][下周 →]                │
│        │  ┌周一┬周二┬…┬周日┐  ← grid-cols-7，今天 ring-accent          │
│        │  │08:00│   │   │   │  ← 事件块按 requirement_due/custom 着色   │
│        │  │需求X│   │   │   │     点块 → nav(/r/{id})                    │
│        │  └────┴────┴───┴───┘                                            │
│        │  ┌「本周事项一览」（Card）──────────────────────────────────┐ │
│        │  │ [截止/会议 Badge] 标题  时间        [打开 →]              │ │
│        │  └──────────────────────────────────────────────────────────┘ │
└────────┴──────────────────────────────────────────────────────────────┘
```

布局要点：
- **顶栏**：标题 + 视图切换（web 周/月/列表，`CalendarPage.tsx:158`；桌宠上周/今天/下周翻页，`Calendar.tsx:62`）。
- **左卡 = 预约面板（web 专有）**：标题 + 时间 + 参与人多选（带在线绿点）+ 保存（`CalendarPage.tsx:172`）。**桌宠无此卡（只读日程）**。
- **主区 = 事件列表/网格**：事件按 `event_type` + 到期状态着色（`tone()`，`CalendarPage.tsx:21`；桌宠 `Calendar.tsx:88`）。

### 3.2 关键组件

| 组件 | 职责 | 现状/共享件 |
|---|---|---|
| `<ViewSwitcher>` | 周/月/列表（web）或翻周（桌宠） | `CalendarPage.tsx:158` / `Calendar.tsx:62` |
| `<EventComposer>` | 预约日程（标题+时间+参与人，web 专有） | `CalendarPage.tsx:172` |
| `<ParticipantPicker>` | 用户多选 + 在线点 | `CalendarPage.tsx:181`（`api.listUsers`） |
| `<EventCard>` / `<DayCell>` | 事件块（着色 + 删除/打开） | `CalendarPage.tsx:213` / `Calendar.tsx:77` |
| `<EmptyState>` | 空态 | `CalendarPage.tsx:212` / `Calendar.tsx:108` |

### 3.3 数据与 API 绑定

| 数据 | 来源 API（api-contract §2.12） | 现状锚点 | 触发时机 |
|---|---|---|---|
| 事件列表 | `GET /api/calendar/events?start&end&project_id?&mine?` → `ScheduleEventOut[]` | `calendar.py:68`，`api.listCalendarEvents` | 进页 + 翻周/视图变 |
| 用户列表（参与人选择） | `GET /api/users` → `UserOption[]` | `api.listUsers`（web 预约用） | 进页 |
| 新建事件 | `POST /api/calendar/events` → `ScheduleEventOut` `201` | `calendar.py:125` | 点「保存日程」 |
| 改事件 | `PATCH /api/calendar/events/{id}` | `calendar.py:150`（仅创建者） | 编辑 |
| 删事件 | `DELETE /api/calendar/events/{id}` | `calendar.py:182`（仅创建者，**`requirement_due` 不可删**） | 点垃圾桶 |

> **数据形状要点（`ScheduleEventOut`，`schemas.py:584`）**：`{id, project_id?, requirement_id?, title, description?, event_type, start_at?, end_at, participant_user_ids[], created_by_nickname, ...}`。`event_type ∈ custom | requirement_due`（`schemas.py:568`）；`requirement_due` 是需求 DDL 自动落到日历的块——**用户不能手动删它**（`calendar.py:191`：「DDL 由需求管理」），只能去需求改 `due_at`。`start_at` 可空（只有 `end_at`=截止点的块）。

> **可见性过滤在 SQL 里完成（务必懂）**：`list_events` 用 `aliased(Project)` 双别名 join，过滤掉软删/归档项目的事件，且对关联了**私有需求**（draft/clarifying/summary_ready，`PRIVATE_REQUIREMENT_STATUSES`）的事件，仅 submitter/认领人/被指派者可见（`calendar.py:91-105`）。前端拿到的就是已脱敏列表，**无需二次过滤**。`mine=true` 进一步只取「我创建或我参与」（桌宠 `Calendar.tsx:43` 默认带 `mine:true`）。

### 3.4 SSE 实时订阅

> **现状：日历无专属 SSE 事件**（`ScheduleEvent` 变更不 publish）。日历依赖**进页/翻周重拉**。但需求 DDL 块来自 `requirement_due` 事件——当 `requirement.updated`（含 `due_at` 变更，`api-contract §5.2`）到达时，日历理应刷新。
> - **现状**：web `CalendarPage` 不订阅 SSE；桌宠 `Calendar.tsx` 也不订阅（仅 `anchor` 变化重拉）。
> - **WorkHub 演进**：日历页订阅 `requirement.updated`（携 `due_at`）→ 防抖重拉当前窗口；新增可选 `calendar.changed` 事件（`workitem:{id}`/`project:{id}`）让多人协作时他人改 DDL 能实时反映。MVP 可不做（翻周即刷新足够）。

### 3.5 四态：空 / 加载 / 错误 / 无权限

| 态 | 触发 | web | 桌宠 | 锚点 |
|---|---|---|---|---|
| **空** | 窗口内无事件 | 「这段时间没有日程。」 | EmptyState：「本周没有日程」+「需求截止时间会自动出现；也可手动创建」+「新建需求（自带截止时间）」 | `CalendarPage.tsx:212`、`Calendar.tsx:108` |
| **加载** | 进页/翻周 | 现状无显式 loading（`mountedRef`+`loadSeqRef` 守竞态）；WorkHub 加骨架 | 同（`alive` 守竞态，`Calendar.tsx:36`） | `CalendarPage.tsx:43`、`Calendar.tsx:36` |
| **错误** | 列表/创建/删除失败 | 红框错误条（`setErr`） | 静默置空（WorkHub 升级为可见） | `CalendarPage.tsx:210`、`Calendar.tsx:47` |
| **无权限** | 编辑/删别人的事件 | 仅创建者可改（前端不渲染他人事件的删除键，`CalendarPage.tsx:229`）；越权 → 403 | 桌宠只读，无编辑入口 | `calendar.py:158/189` |
| | 删 `requirement_due` | 前端不渲染该类型的删除键；越权调 → 400 | 同 | `CalendarPage.tsx:229`、`calendar.py:191` |

### 3.6 关键交互与跳转流

```
【新建日程（web）】
填标题+时间+参与人 → 点保存 → 乐观 pin（pinnedEventIds，CalendarPage.tsx:110）
  → POST → 重拉（带 pinned 兜底，避免新事件因窗口边界被过滤掉，CalendarPage.tsx:45）
  竞态：busyRef 防双击重复创建（CalendarPage.tsx:101）

【删事件】
点垃圾桶 → window.confirm 二次确认（CalendarPage.tsx:126，防触摸板误触）→ DELETE → 重拉

【点需求 DDL 块 → 跳需求】
桌宠: 点事件块 → requirement_id ? nav(/r/{id})（Calendar.tsx:87）
web:  事件卡无直跳（WorkHub 补：点 requirement_due 卡 → /r/{id}）

【翻周/换视图】
桌宠: 上周/今天/下周 改 anchor → useEffect 重拉（alive 守竞态）
web:  周/月/列表仅改前端窗口过滤（visibleEvents useMemo），不重新请求（已一次拉 -31~+62 天）
```

---

## 4. N5 — 资源排期 / 我的负载

> **路由**：web `/planning`（看板二级菜单「资源排期」，`App.tsx:158/316`，**派活方工具**）；桌宠 `/me/workload`（「我的负载」，单人聚焦版，`SidebarWork.tsx:28`）。

### 4.1 布局（文字版 wireframe）

web 团队负载（`PlanningPage.tsx:66`，顶部 4 个汇总卡 + 多人卡片网格 `2xl:grid-cols-2`）：

```
┌─ 顶栏 eyebrow「资源排期」 H1「排期 / 负载」 + 项目筛选 select（全部项目）─┐
│  副标题「按接单人、DDL、估算工时和接单状态看负载。忙碌按半天产能算。」    │
├─ 汇总卡 ×4（md:grid-cols-4）：范围 · 估算工时 · 满载人员 · 阻塞 ─────────┤
├─ 成员卡网格（按 load_percent 降序，PlanningPage.tsx:107）────────────────┤
│  ┌ 成员卡（paper-surface）─────────────────────────────────────────┐ │
│  │ ●在线点 昵称  [接单状态 pill]                       83% / load   │ │  ← :112/:113/:114/:125
│  │ N 个任务 · X/Yh · 逾期2 · 阻塞1 · 本周3                          │ │  ← :117-121
│  │ ▓▓▓▓▓░░ 负载条（tone 按 load 着色，width 上限 140%）            │ │  ← :129-130
│  │ └ 任务清单（code + 标题 + status + due + 阻塞 + 进度% pill）展开 │ │  ← :138-152，整条 <Link> 跳 /r/{id}
│  └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

> **注**：现状顶栏**没有显式时间窗控件**（前端固定不传 `start/end`，由后端默认「今 +14 天」算容量，`planning.py:38`）；筛选只有项目 select（`PlanningPage.tsx:74`）。**WorkHub 演进**可补一个时间窗选择器（端点已支持 `start/end` 入参，`planning.py:23`），但 MVP 用默认窗即可。

桌宠「我的负载」（`MyWorkload.tsx`，单人版，只看自己那行的展开）。

### 4.2 数据与 API 绑定

| 数据 | 来源 API（api-contract §2.12） | 现状锚点 | 触发时机 |
|---|---|---|---|
| 团队负载 | `GET /api/planning/workload?start&end&project_id?` → `UserWorkloadOut[]` | `planning.py:22`、`PlanningPage.tsx:32`（`api.workload`） | 进页 + 改项目筛选（`projectId` 变即重拉，带 `loadTokenRef` 防乱序，`PlanningPage.tsx:27/47`） |

> **数据形状要点（`UserWorkloadOut`，`schemas.py:472`）**：每人 `{user_id, nickname, is_online, availability_status, availability_text, task_count, estimate_hours, capacity_hours, load_percent, overdue_count, blocked_count, due_this_week_count, requirements[]}`。负载算法在服务端：按 `estimate_hours` 在多 assignee 间均摊、`busy` 状态容量减半、`load=hours/capacity*100`（`planning.py:74-106`）。**软删用户被过滤**（避免泄漏 `_deleted_` 墓碑昵称 + 0 容量幽灵行，`planning.py:58-61`）。排序：负载降序 → 逾期降序 → 昵称（`planning.py:122`）。

> **AI-native 关联**：`UserWorkloadOut` + `availability_status` 是**智能派活的输入信号之一**（PRD §8.4，data-model §3.2 `availability_pref`）。本页对人是「看谁忙」；对 AI 是「派给谁」的依据。派活算法见 [`../02-ai-engine/smart-staffing.md`](../02-ai-engine/smart-staffing.md)，本篇只负责呈现负载。

### 4.3 四态 + 无权限

| 态 | 触发 | 呈现 | 锚点 |
|---|---|---|---|
| 空（整页） | 无任何活跃任务 | 现状直接渲染空网格（无成员行）；WorkHub 补整页空态文案「这段时间大家都很闲（或者活还没派）」 | `PlanningPage.tsx:106` |
| 空（单人无活） | 某成员卡内 `requirements` 为空 | 虚线框「暂时没排上活。」 | `PlanningPage.tsx:133` |
| 加载 | 进页/切项目 | 现状文本占位「加载排期...」（`loading` 态，非骨架）；WorkHub 可升级为骨架卡 | `PlanningPage.tsx:103` |
| 错误 | 项目 id 不存在 / 列表失败 | 红框错误条（`setErr`）；项目不存在后端返 404「project not found」 | `PlanningPage.tsx:102`、`planning.py:35` |
| 无权限 | — | 仅需登录（`current_user`）；团队负载对所有成员可见，无项目级门 | `planning.py:28` |

---

## 5. N2 — 实时 Toast（瞬时弹层，全局）

> **不是页面，是全局弹层**。任何路由下都可能弹出，承接 `notification.created` 事件的「第一眼」。

### 5.1 呈现与触发

| 维度 | web | 桌宠 | 锚点 |
|---|---|---|---|
| 挂载点 | app shell 调 `useNotificationToasts()` 一次 + `<ToastHost>` | app shell `<ToastHost>` + Rust `osNotify` | web `App.tsx:111/129`、桌宠 `web-src/src/App.tsx` 的 `osNotify`（调 `notify.rs:11`） |
| 数据来源 | SSE `/stream/me` 的 `notification.created` | `push-event` 转发同事件 | `useNotificationToasts.ts:55`、`sse.rs:149` |
| 视觉 | `toast({title, description, tone})`，high/urgent → `warn`，否则 `info` | 同 `toast` + high/urgent 额外走 OS 系统通知 | `useNotificationToasts.ts:59`、`reminders.rs:135` |
| 多行正文 | 按 SSE 多行 `data:` 用 `\n` 拼回（正文可含换行） | Rust 侧同样 `\n` 拼接（`sse.rs:161`） | `useNotificationToasts.ts:53`、`sse.rs:164` |

### 5.2 四态与健壮性

- **畸形 payload**：`JSON.parse` 失败 → 忽略，**不崩流**（`useNotificationToasts.ts:64`）；Rust 侧解析失败 → 退化为字符串 value（`sse.rs:144`）。
- **断连**：web 指数退避重连（1s→30s，`useNotificationToasts.ts:78`）；桌宠 Rust 退避同上（`sse.rs:177`），且端点/令牌变更触发重连（`sse.rs:110`）。
- **背压丢事件**：`push_bus` 满队列丢（`push_bus.py:43`）——Toast 丢了不致命，N1 列表与桌宠 60s 轮询（§7.2）兜底。

---

## 6. 数据流总览（端到端，一张图）

```
事实发生（状态流转 / AI 升级 / 审批 ask / DDL 临近 / 工作区阻塞）
  │
  ├─[持久通知]→ create_notification(dedupe_key, severity, target_url)   services/notifications.py:30
  │     └ 去重 + 变更检测（内容没变不重置 read_at）                      notifications.py:43-77
  │     └ 同事务入库；commit 后才 publish（lifecycle 铁律）              lifecycle.py / data-model §5
  │     └ publish → user:{id} 私有 topic（绝不 all）                     notifications.py:105
  │           │
  │           ├─ web:  /stream/me → useNotificationToasts → Toast + N1 reconcile
  │           └─ 桌宠: sse.rs(/stream/me) → push-event → Inbox.refresh + 徽章 + (high)系统通知
  │
  ├─[瞬时提醒]→ 不落库；GET /api/reminders/due 实时算 due_at            reminders.py:29
  │     └ 桌宠 60s 轮询（reminders.rs:15）按 {id}:{due_at} 去重 → 系统通知 + emit "reminder"
  │
  └─[日程落点]→ requirement_due 块自动入日历；用户预约 custom 块         calendar.py
        └ GET /api/calendar/events（SQL 内脱敏）→ 日历渲染
```

> **三条线的同一性**：DDL 临近这一个事实，会**同时**走「持久通知（`due_soon`/`due_overdue`，N1 可回看）」+「瞬时提醒（桌宠系统通知，N6）」+「日历块（N3 可视化）」。三者数据源不同（持久表 / 实时算 / 时间块表），但用户感知是一致的「该做这个活了」。

---

## 7. 桌宠端（C-PET）主动呈现：替代右下角弹窗（命门，§N6）

> WorkHub 的产品决策：**桌宠是常驻入口，主动呈现替代「右下角弹窗 + 托盘」的旧范式**（glossary §8「桌面宠物」、README §1 C-PET）。本节是 M-NOTIFY 在桌宠端的核心增量——把「通知/提醒/AI 找人」从被动列表升级为**有人格的主动呈现**。

### 7.1 三层呈现通道（由轻到重）

| 通道 | 何时用 | 现状机制 | WorkHub 呈现 |
|---|---|---|---|
| **托盘徽章**（最轻） | 任何未读 | `update_tray_unread(count)` 改托盘 tooltip/title「需求管理大师 · N 条新通知」（`commands/submitter.rs:242`），防抖 250ms（桌宠 `web-src/src/App.tsx` 的 `refreshUnreadBadge`） | 沿用 + 桌宠头顶小红点 |
| **OS 系统通知**（中） | `severity=high/urgent` 通知 + 所有到期提醒 | `tauri-plugin-notification`（`notify.rs:11`、`reminders.rs:135/146`） | 沿用；标题/正文人话化 |
| **桌宠气泡**（重，命门） | AI 主动找人：升级简报 / 审批 ask / 派活建议 | （新增）现有 `FloatingAssistant` 是被动气泡（用户点开问），WorkHub 让它**被事件唤起** | 桌宠主动开口：「这个活我拿不准，想请你来定」+ 行内操作 |

### 7.2 兜底轮询 + 去重（沿用 `reminders.rs`，务必保留）

桌宠 Rust 侧 `reminders::spawn` 起一个 **60s ticker**（`reminders.rs:15`），双轮询：
- `GET /api/reminders/due`：到期提醒。按 `{reminder_id}:{due_at}` 组键去重（`reminders.rs:49`），**空 id 跳过**（避免空键吞掉所有未来提醒，`reminders.rs:42`），命中过的不再弹。按 `kind` 生成人话正文（逾期/现在/还有 N 分钟，`reminders.rs:71`），弹系统通知 + `emit("reminder")`。
- `GET /api/notifications?status=unread`：未读通知。按 `{notification_id}:{updated_at}` 去重（`reminders.rs:127`），**仅 high/urgent 弹系统通知**（`reminders.rs:135`），所有都 `emit("notification")`。

> **去重表会膨胀**：`known_reminders`/`known_notifications` 存在本地 config，`prune_seen_map` 按时间裁到上限（提醒 500 / 通知 1000，`reminders.rs:98/162`），避免无限增长。**WorkHub 保留这套**——它是 SSE 丢事件时的可靠兜底（SSE 尽力推送，轮询保证不漏）。

> **SSE 与轮询的分工（沿用）**：SSE（`sse.rs`）负责**实时**（秒级到达 → `push-event` → Inbox 刷新 + 徽章），60s 轮询（`reminders.rs`）负责**可靠兜底 + 系统通知去重**。两条腿走路，缺一不可：SSE 断了有轮询，轮询慢了有 SSE。

### 7.3 桌宠气泡：被事件唤起（WorkHub 新增交互）

现有 `FloatingAssistant`（`FloatingAssistant.tsx:26`）是**被动**的右下角气泡——用户点开、提问、AI 答、可一键转草稿（`createFromDraft`，`:194`）。WorkHub 把它升级为**双向**：既能被点开，也能**被 AI 主动唤起**。

唤起来源 = 高优先事件（`escalation` / `approval_ask`）：

```
SSE user:{id} → notification.created (type=escalation|approval_ask)
  → 桌宠气泡自动展开 + 桌宠人格开口（气泡顶部一条 assistant 消息）
     ┌─────────────────────────────────────────────┐
     │ 🤖 这个「导出报表」的活我做完了但拿不准，      │  ← 人话，零术语零数值
     │    要不你扫一眼？或者直接交给小李也行。         │
     │    [去看看 →]   [通过]   [打回(说原因)]         │  ← 行内操作，避免跳转打断
     └─────────────────────────────────────────────┘
```

- **行内操作**：尽量在气泡里完成「通过/打回/同意/拒绝」，减少跳转（呼应 opencode 审批=阻塞原语，回复即解阻塞）。打回必带理由（glossary §2、data-model §6.3）。
- **deep-link 落点**：「去看看」走 `yqgl://r/{id}`（`deep_link.rs`）唤起主窗口跳详情；审批 ask 走 `yqgl://r/{id}?tab=...`。`deep_link.rs:9` 的 `ALLOWED_HOSTS` 白名单需扩 `approval` 之类（或复用 `r`）。
- **节制**：normal 通知**不**自动弹气泡（只进徽章 + 列表），避免桌宠话痨——只有 high/urgent 才主动开口（沿用 §0.3 严重度规则）。

### 7.4 打扰边界（N7，新增）

把「弹不弹、何时弹」交给用户（FR-IDENTITY，`availability_pref`，data-model §3.2）：

| 偏好 | 作用 | 落点 |
|---|---|---|
| 接单状态 `busy` | 忙碌时段：仅 urgent 弹系统通知/气泡，high 降级为静默徽章 | 联动 `User.availability_status`（`tray.rs:84` 已有「接单状态」子菜单） |
| 勿扰时段 | 时段内全部降级为徽章，结束后汇总一条 | `availability_pref`（新增） |
| 暂停同步/提醒 | 沿用托盘「⏸ 暂停同步」（`tray.rs:95`），扩为「暂停桌宠提醒」 | `cfg.drive_sync_paused` 模式扩展 |

> 设置入口：桌宠 `/settings`（`tray.rs:42` 托盘「设置…」直达）；web 设置弹层分区。

### 7.5 托盘菜单与 deep-link（呈现入口，机制详见 desktop-pet 篇）

- **托盘菜单**（`tray.rs:65`）已有「打开待办收件箱」(`/inbox`)、「立即拉新需求」、接单状态、网盘同步等。WorkHub 不改菜单结构，只确保「打开待办收件箱」指向 N1（`tray.rs:24` 注释已修过「`/current` 死链 → `/inbox`」）。
- **deep-link**（`deep_link.rs`）：`yqgl://inbox` → N1、`yqgl://r/{id}` → 需求详情。host 白名单 + 路径穿越防护（`deep_link.rs:9/24`），通知点击/系统通知点击都经此唤起主窗口。
- **导航事件**：托盘/deep-link 都 `emit("navigate", {path})`（`tray.rs:129`、`deep_link.rs:41`），React 侧 `useEvent("navigate")` 跳转（`client-tauri App.tsx`）。

---

## 8. 验收要点（本模块页面级 checklist）

> 对齐 PRD 验收口径；每条可追溯到真实代码/契约。

- [ ] **通知按身份私密**：抓包 `/api/push/stream`（全局）**收不到**任何含 title/body 的 `notification.created`；只有 `/stream/me` 收得到自己的（`notifications.py:105`、`sse.rs:6`）。
- [ ] **徽章不卡死**：一条逾期通知标已读后，下次轮询/进页**不**因 `_ensure_due_notifications` 重新置未读（内容没变，`notifications.py:65`）。
- [ ] **已读失败也 reconcile**：断网点「已读」→ 报错但列表/徽章仍重拉，不卡在错误态（`NotificationsPage.tsx:56`、`Inbox.tsx:60`）。
- [ ] **Tab 切换不串数据**：快速切未读↔全部，最终列表与当前 Tab 一致（`loadSeqRef`/`reqTokenRef`，`NotificationsPage.tsx:22`、`Inbox.tsx:26`）。
- [ ] **桌宠两条腿**：SSE 断开时，60s 轮询仍能弹到期提醒 + high 通知系统通知（`reminders.rs`）；SSE 恢复后秒级实时（`sse.rs`）。
- [ ] **提醒不刷屏**：同一 `{id}:{due_at}` 提醒只弹一次（`reminders.rs:49`）；空 id 不吞未来提醒（`reminders.rs:42`）。
- [ ] **日历脱敏**：私有需求（draft/clarifying）的 DDL 块，非 submitter/认领人/被指派者**看不到**（`calendar.py:99`）。
- [ ] **DDL 块不可手删**：`requirement_due` 事件前端无删除键、后端 400（`CalendarPage.tsx:229`、`calendar.py:191`）。
- [ ] **去黑话 + 不暴露数值**：所有通知/气泡文案零 `merge/branch/conflict`、零 `confidence=0.x`、零 snake_case 状态（glossary §1.2）。
- [ ] **AI 找人落地为通知**：`escalation`/`approval_ask`/`agent_done` 三类新通知能到达 + 桌宠 high/urgent 主动开口（§7.3）。
- [ ] **多行正文不破帧**：含换行的通知正文在 web/桌宠都完整还原（`useNotificationToasts.ts:53`、`sse.rs:164`、`push.py:31`）。
- [ ] **软删项目不烦人**：admin 删项目后，该项目相关通知不再出现在列表/提醒（`notifications.py:101`、`reminders.py:49`）。

---

## 附：与其他文档的边界（避免重复）

| 想找 | 去哪 |
|---|---|
| `Notification`/`ScheduleEvent` 字段、软删除/审计、JSON→JSONB | [`../01-architecture/data-model.md`](../01-architecture/data-model.md) §10 |
| 端点签名、SSE 帧格式/心跳/背压、topic 隔离、错误码 | [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md) §2.12 / §5 / §6 |
| 事件总线模型、`user:{id}` 私有隔离、多副本 broker | [`../01-architecture/system-architecture.md`](../01-architecture/system-architecture.md) §5 |
| 桌宠窗口/托盘/deep-link/spec_watch/本地能力机制 | [`../05-clients/desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md) |
| web 信息架构、全局顶栏、命令面板 | [`../05-clients/web-app.md`](../05-clients/web-app.md) |
| 升级简报内容、PM 模式催办再审 | [`../02-ai-engine/pm-mode-orchestration.md`](../02-ai-engine/pm-mode-orchestration.md) |
| 审批=阻塞原语、路由、SLA、委派、拒绝回灌 | [`../03-collaboration/review-and-approval.md`](../03-collaboration/review-and-approval.md) |
| 智能派活的负载/可用度信号 | [`../02-ai-engine/smart-staffing.md`](../02-ai-engine/smart-staffing.md) |
| 通知文案/状态标签/AI 把握程度的人话 | [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md) |
| 会议/网盘/需求产生的通知（上游来源） | [`./meetings-and-insights.md`](./meetings-and-insights.md) · [`./projects-and-drive.md`](./projects-and-drive.md) · [`./requirements-workitem.md`](./requirements-workitem.md) |

---

*本篇定位：M-NOTIFY 的页面规划单一来源。机制级（端点/事件/隔离）→ `api-contract.md`；端侧能力 → `desktop-pet-tauri.md`；AI 找人的内容 → `pm-mode-orchestration.md` / `review-and-approval.md`。*
