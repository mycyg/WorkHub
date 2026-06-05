---
component: F05
title: 事件 bus → broker（Event Bus → Broker）系统级实现 plan
status: draft
depends: [F3]
date: 2026-06-05
master: ../2026-06-05-feat-workhub-p0-foundation-master-plan.md
inventory: ./_migration-inventory.md
specs:
  - ../../workhub/01-architecture/api-contract.md
  - ../../workhub/01-architecture/data-model.md
  - ./_experience-deliverable-contracts.md
  - ./_ts-first-module-port-page-alignment.md
---

# F05 事件 bus → broker（Event Bus → Broker）

> 把现有进程内单例 `PushBus`（`app/services/push_bus.py:47`）与 `presence`（`app/services/presence.py`）**抽象为接口 + broker 后端**（Redis pub/sub 或 PG `LISTEN/NOTIFY`），解除"单 worker 的事件半边"，使 2 worker 下 A worker 发的事件能投到连在 B worker 的订阅方。这是 Master §6 铁律 3「**F3 与 F5 成对发布**」中的事件那一半——**F3+F5 都到位才 `--workers N`**。
> 核心红线：broker 化后每条 payload 对所有 worker 可见，**隐私门（`can_view`、`user:{id}`-by-identity）必须在订阅边界重强制**（NFR-08，有跨用户泄漏前科）；禁止"全量发 Redis 客户端过滤"。
> 权威来源：SSE 帧格式 / topic 隔离以 [`api-contract.md`] §5 为准；P0 新事件的**正式实现名**与 `WorkHubEvent` envelope 以 [`_experience-deliverable-contracts.md`](./_experience-deliverable-contracts.md) §4 为准。本 plan 引用其产物，不重定义业务 payload schema。

---

## 目标

1. **PushBus 抽象 + broker 后端**：把 `push_bus.py` 的进程内 `dict[str,list[Queue]]`（`:23`）抽象为 `PushBus` 接口；落地 ① 进程内后端（开发/单 worker，等价现状）与 ② broker 后端（Redis pub/sub 或 PG `LISTEN/NOTIFY`，跨 worker）。**对 publisher/subscriber 的调用签名零改**（`bus.publish(topic, type, data)` / `stream(topic)` 不变），仅 import 的 `bus` 指向新后端。
2. **presence → 共享后端**：把 `presence.py` 的进程内 `RLock+dict`（`:18-20`，TTL 120s）迁到 Redis key+TTL（或 PG），使 2 worker 下在线状态一致（现状第 2 worker 看不到第 1 worker 的连接计数）。
3. **topic 鉴权门在订阅边界重强制**：`req:{id}`→`workitem:{id}` 订阅前 `can_view`（沿用 `push.py:84`）、`user:{id}` 由认证身份派生而非路径参数（沿用 `push.py:99`）、`job:{id}` 不发 `all`——broker 化后这些门**一条不削弱**，且在订阅边界（连接建立时）重新强制。
4. **topic taxonomy 扩展**：新增 `workitem:{id}`（演进自 `req:{id}`）、`run:{run_id}`、`session:{id}`、`proposal:{id}` topic，对齐 api-contract §5.3；事件**类型**（`agent_run.step`/`agent_run.escalated`/`permission.ask`/`proposal.opened` 等）由各产出组件（F8/F6/F9）发布，F05 只保证**topic 命名空间 + 订阅鉴权 + 跨 worker 扇出**到位。

---

## 范围（Scope）

### In（P0 必须）

- `PushBus` 接口抽象（`subscribe`/`unsubscribe`/`publish`/`stream`，签名沿用 `push_bus.py:26-61`）+ 两后端（in-process / broker）+ 配置选择（F1 提供 broker URL）。
- broker 后端实现：Redis pub/sub **或** PG `LISTEN/NOTIFY`（二选一定调，见「数据与接口契约」）；跨 worker 扇出；每订阅者本地仍是 `asyncio.Queue(maxsize=256)` 背压 + 30s 心跳（**逐字保留** `push_bus.py:27/50` 的背压与心跳纪律）。
- `presence` 迁共享后端（Redis key+TTL 或 PG）：`mark_stream_open`/`mark_stream_closed`/`touch_user`/`get_presence`（`presence.py:27-60`）语义不变，存储跨 worker 共享。
- topic 命名空间扩展 + 订阅鉴权门：`workitem:{id}`（`can_view`）、`user:{id}`（身份派生）、`run:{run_id}`（owner/审批人）、`session:{id}`（session owner）、`proposal:{id}`（可见性门）；SSE 端点 `/api/push/stream*` 演进（新增 `/stream/session/{id}`、`/stream/run/{id}` 占位由 F8/F11 收口路径）。
- 订阅边界隐私门**重强制**：每个新 topic 在 `_gen`/订阅前做可见性检查（沿用 `push.py:77-87` 短会话鉴权范式），broker 收到的 payload 不"全量发客户端过滤"。
- 周期心跳 / 断连清理沿用（`push.py:43/49`、`push_bus.py:61`）。

### Out（明确推迟 / 归他组件）

- **事件 payload schema / 新事件类型定义**：由产出组件拥有——`agent_run.started`/`agent_run.step`/`agent_run.compacting`/`agent_run.escalated`/`step.snapshot` 归 **F8**（agent-loop §6.2）；`permission.ask`/`permission.decided` 归 **F6**；`proposal.opened`/`proposal.reviewed`/`proposal.merged` 与 `notification.created` 归 **F9/F10** 按生命周期与合并边界承接。F05 只提供 topic + 扇出 + 鉴权门，**不发这些业务事件**。
- **AgentRun 入队/出队队列**（`asyncio.create_task`→可恢复队列）：归 **F8**（其 queue 可复用 F05 的 broker 连接，但队列语义/lease 心跳归 F8）。F05 只交付 pub/sub + presence，不交付 work-queue。
- **里程碑通知中枢**（`_MILESTONES` 登记新状态、approver 路由、queue-in-tx/flush-post-commit）：归 **F9**；F05 只保证 `publish_notification` 的出口（`notifications.py:105` `bus.publish`）透明切到 broker 后端。
- **行级锁/乐观锁 / AgentRun 竞态护栏**：归 F8；F05 不碰 DB 锁（事件域）。
- **leader 选举 / 周期任务多 worker 编排**：归 F8/F11；F05 不实现 leader 选举（pub/sub 不需要 leader，但周期发布者需要——交 F11 lifespan 重排）。
- **WS 双工**：P4+；P0 仍单向 SSE（api-contract §0）。
- **org:/workspace: 租户 topic 的运行时隔离强制**：列/作用域 P0 预留，按租户过滤随 F11/P5（与 data-model §3.4 一致）。

---

## 现状 → 改动（按 PORT / REFACTOR / NEW 分组）

> 锚点经实际代码核验（inventory §4）。

### PORT（逐字保留语义，禁止"顺手重构"）

- **P-1 背压纪律**：每订阅者 `asyncio.Queue(maxsize=256)`（`push_bus.py:27`），`publish` 满队列 `QueueFull → pass`（丢慢订阅者，`:43-44`）。这是"SSE 尽力推送、客户端以 REST reconcile 为真相"的契约（api-contract §5.1）——broker 后端的**本地分发段**逐字保留此背压，不得改为阻塞投递。
- **P-2 30s 心跳**：`stream()` 无事件时每 30s 发 `heartbeat`（`push_bus.py:50/59`），SSE 层转 `: ping` 注释行（`push.py:46`，不触发客户端 handler）。保留。
- **P-3 SSE 帧格式**：`_sse()` 每行 `data:` 前缀 + `splitlines()`（非 `split`）防 CRLF 破帧（`push.py:31-34`，docstring 记录真实症状）。**逐字保留**，broker 化不碰帧编码。
- **P-4 连接确认**：连上先发 `event: connected\ndata: {"topic": ...}`（`push.py:41`）。保留。
- **P-5 隐私门三条（NFR-08 核心，有前科）**：
  - **`workitem:{id}`（演进自 `req:{id}`）订阅前 `can_view`**：`push.py:77-87` 开短会话查 `can_view_requirement_record` → 403，随即关 session（流不持 DB 资源）。**逐字保留此范式**，仅 `Requirement`→`WorkItem`、`can_view_requirement_record`→F6 改名后的等价函数。
  - **`user:{id}` 由认证身份派生，非路径参数**：`/stream/me` topic = `user:{user.id}`（`push.py:99`，注释明示"客户端无法请求他人流"）。新增 `/stream/run`/`/stream/session` 同理——owner 校验从认证身份推导，**绝不**让客户端用路径参数点名他人。
  - **`job:{id}` 等私有 topic 绝不发 `all`**：`job.updated` 只发 `job:{id}`+owner `user:{id}`（api-contract §5.3 / inventory §3 锚点 `jobs.py:71` 注释）。F05 扇出层不引入"全量广播 + 客户端过滤"。
- **P-6 断连清理**：`request.is_disconnected()` 检测 + `finally` `unsubscribe`（`push.py:43/49`、`push_bus.py:61`）。保留；broker 后端 unsubscribe 时同步退订 channel。
- **P-7 presence 语义**：在线判定 = `stream_count>0 OR last_seen 在 120s 内`（`presence.py:59-60`），`mark_stream_open/closed` 引用计数（`:32-45`）。语义逐字保留，仅存储后端从进程内 dict 换共享 store。

### REFACTOR（抽象 + 后端切换，行为等价）

- **R-1 `PushBus` 接口化**：`push_bus.py:21` 的 `class PushBus` 抽象为接口；现进程内实现保留为 `InProcessPushBus`（开发/单 worker）；新增 `BrokerPushBus`（Redis/PG）。模块单例 `bus`（`:47`）按 `settings` 选择后端实例化。**`subscribe/unsubscribe/publish/stream` 签名不变**——所有 publisher（`auto_agent.py`/`deliveries.py`/`notifications.py:105` 等）与 `push.py` 的 `stream()` 零改。
- **R-2 broker 扇出模型**：`publish(topic, type, data)` → 发布到 broker channel（topic 即 channel）；每个 worker 的每个订阅者本地 `subscribe(topic)` → 该 worker 订阅 broker channel（首订阅时）+ 本地 `Queue` 接力（保留 P-1 背压）。Redis 方案：`PUBLISH topic <json>` + 每 worker 一个 `PUBSUB` 连接多路复用到本地 queue；PG 方案：`pg_notify(channel, payload)` + 一个 `LISTEN` 连接。
- **R-3 `req:{id}`→`workitem:{id}` 改名**：topic 字符串随 Master `requirements→work_items` 改名（F2 牵动）；`/stream/req/{id}` 端点路径由 **F11** 客户端改接同步（F05 落 topic 命名 + 鉴权门，路径最终收口 F11）。现状 `all` 上的 `requirement.ready`/`requirement.updated` 事件名由 F8/各域改名（不在 F05）。
- **R-4 presence 共享化**：`presence.py` 的 `_last_seen`/`_open_streams` 两个 dict（`:19-20`）→ Redis key（`presence:lastseen:{uid}` 带 TTL、`presence:streams:{uid}` 计数）或 PG 表。`_now()` 用 aware UTC（已是 `datetime.now(timezone.utc)`，`presence.py:24`，与 F3 timestamptz 口径一致，**无需改**）。读写经共享 store，跨 worker 一致。
- **R-5 通知出口透明切换**：`notifications.py:105` `await bus.publish("user:{id}", "notification.created", ...)` 与 `:124` threadsafe 出口——import 的 `bus` 指向 `BrokerPushBus` 后即跨 worker 可达，**F05 不改 `notifications.py` 逻辑**（F09 确认切换 + 隐私门）。

### NEW（净新增）

- **N-1 broker 后端选型 + 适配器**：`app/services/push_backends/`（或 `app/events/`）含 `InProcessPushBus` + `RedisPushBus`/`PgNotifyPushBus`；连接配置经 `settings.broker_url`（F1）。**P0 定调一种**（建议 Redis pub/sub，`DEPLOY.md:97` 点名；PG `LISTEN/NOTIFY` 作为无 Redis 部署的降级，见「开放/选型」）。
- **N-2 topic 命名空间表 + 订阅鉴权注册**：集中定义 topic → 鉴权谓词映射（`workitem:{id}`→`can_view`、`user:{id}`→身份派生、`run:{id}`→owner/审批人、`session:{id}`→owner、`proposal:{id}`→`can_view`），SSE 端点订阅前查表强制（防新增 topic 漏门）。
- **N-3 正式事件名注册表**：集中定义 `_experience-deliverable-contracts.md` §4 的正式事件 type 常量;旧概念名(`agent.run.started`/`proposal.ready`)只可写入 alias 注释/迁移表,不得作为新 publish type。
- **N-4 `WorkHubEvent` envelope 适配**：新事件发布时至少带 `event_id/type/topic/ts/preview_text?/data`;允许旧事件迁移期裸 payload,但新增 WorkHub 事件必须 envelope 化,便于 Cuu/Web/Rust 共享消费。
- **N-5 新 SSE 端点（路径占位，F11 收口）**：`/api/push/stream/session/{id}`（session owner）、`/api/push/stream/run/{id}`（run owner/审批人）——沿用 `stream_one` 的"短会话鉴权 → 关 session → 流"范式（`push.py:77-92`）。
- **N-6 presence 共享 store 适配器**：Redis key+TTL（或 PG）实现 `presence` 协议；`get_presence_map` 批量读（`presence.py:63`）改为共享 store 的 pipeline/批查。
- **N-7 broker 连接健康 + 降级**：broker 不可达时 fail-closed 行为定义（启动拒绝 vs 降级单 worker）；连接断开重连 + 重订阅（不丢订阅）。

---

## 实施步骤（有序可勾选）

> 顺序：先抽象接口（不换后端，等价现状）→ 实现 broker 后端 + presence 共享 → 扩 topic + 鉴权门 → 2 worker 冒烟门禁。每步保持单 worker 仍可跑。

- [ ] **S0 前置（F1/F3）**：`settings.broker_url`（F1 配置块）；确认 F3 已落 PG（PG `LISTEN/NOTIFY` 方案需要）。
- [ ] **S1 抽象 `PushBus` 接口**：把 `push_bus.py:21` 拆为接口 + `InProcessPushBus`；模块单例 `bus` 按 settings 选后端；**签名零改**，跑现有 SSE 回归（连上收 `connected`、收 `requirement.updated`、30s 心跳、断连清理）。
- [ ] **S2 实现 broker 后端**（N-1）：Redis pub/sub（或 PG `LISTEN/NOTIFY`）；每 worker 一条订阅连接多路复用 → 本地 `Queue(maxsize=256)`（保 P-1 背压）；`publish` 走 broker channel。单测：A "worker"（进程/事件循环）publish → B 订阅者收到。
- [ ] **S3 presence 共享化**（R-4/N-6）：`presence` 存储换 Redis key+TTL（或 PG）；`mark_stream_open/closed`/`get_presence` 语义不变。单测：跨"worker"读写一致。
- [ ] **S4 topic 扩展 + 鉴权注册表**（N-2）：`req:{id}`→`workitem:{id}`；新增 `run:{id}`/`session:{id}`/`proposal:{id}` topic + 订阅鉴权谓词；订阅前查表强制。
- [ ] **S5 事件常量 + envelope**（N-3/N-4）：新增正式事件 type 常量表 + `WorkHubEvent` envelope helper;新增 publish 调用必须用正式名,并能携带 `cuu_state` / `attention` hint。
- [ ] **S6 新 SSE 端点占位**（N-5）：`/stream/session/{id}`、`/stream/run/{id}` 用短会话鉴权范式（`push.py:77-92`）；路径最终由 F11 收口。
- [ ] **S7 隐私门订阅边界回归**（NFR-08）：`workitem:{id}` 私有态他人订阅 403；`user:{id}` 客户端无法点名他人；`job:{id}`/私有 topic 不发 `all`；broker payload 不全量广播。
- [ ] **S8 通知出口确认**（与 F9）：`notifications.py:105` 经 broker 后端跨 worker 可达，双段式（queue-in-tx/flush-post-commit）不变。
- [ ] **S9 broker 健康/降级**（N-7）：broker 不可达的 fail-closed/降级策略 + 断线重连重订阅。
- [ ] **S10 2 worker 冒烟门禁**（Master §8 / §7 集成场景①③）：`--workers 2`，A worker 发 `workitem:{id}` 事件 → 连在 B worker 的有权订阅方收到；**无跨用户泄漏**（无权方收不到）；presence 跨 worker 一致。**此门禁过后方可解禁 `--workers N`（与 F3 成对）。**

---

## 数据与接口契约

> 跨组件共享处以 Master + api-contract 为准。F05 **不新增 DB 业务表**（presence 若用 PG 落一张轻量表）；**不定义事件 payload schema**（归各产出组件）；契约面 = topic 命名空间 + 订阅鉴权 + 后端接口。

### `PushBus` 接口（签名沿用现状 `push_bus.py`）

```python
class PushBus(Protocol):
    async def subscribe(self, topic: str) -> asyncio.Queue[Event]: ...
    async def unsubscribe(self, topic: str, q: asyncio.Queue[Event]) -> None: ...
    async def publish(self, topic: str, ev_type: str, data: Any) -> None: ...
# 模块级 stream(topic, *, heartbeat_secs=30.0) 沿用 push_bus.py:50（背压 + 心跳）
```

### Topic 命名空间 + 订阅鉴权（权威：api-contract §5.3）

| topic | 谁可订阅 | 订阅边界强制点 | 现状/演进 |
|---|---|---|---|
| `all` | 任意已认证用户 | 只承载**公共**事件，绝不放私有数据 | 现状（`push.py:54`） |
| `workitem:{id}` | 过 `can_view` 的人 | 订阅前短会话查可见性 → 403（`push.py:77-87` 范式） | 演进自 `req:{id}` |
| `user:{id}` | **仅身份解析出的本人** | topic 由 `user.id` 派生，非路径参数（`push.py:99`） | 现状（`/stream/me`） |
| `job:{id}` | 该 job 的查询者 | 只发 `job:{id}`+owner，**绝不 `all`** | 现状（inventory §3） |
| `run:{run_id}` **[新]** | run owner / 审批人 | 订阅前校验 run 归属（接 F8） | 新增（agent-loop §6.1） |
| `session:{id}` **[新]** | session owner（+被路由审批人） | 身份派生 + owner 校验 | 新增（api-contract §2.3/§5.3） |
| `proposal:{id}` **[新]** | 过 `can_view` 的人 | 同 `workitem` 可见性门 | 新增 |

> **约定**（api-contract §5.3）：任何新增 topic **先判私有性**——含 `result_ref`/正文/置信细节的一律走 `user:{id}` 或 `workitem:{id}`（经可见性门），不走 `all`。审批私有事件 `permission.ask` 走 `user:{被路由人 id}`，**不另立 `permission:*` 命名空间**（对齐 api-contract §5.3 / F09 收口口径）。

### 事件类型（F05 不拥有，仅承载；正式名权威：`_experience-deliverable-contracts.md` §4）

F05 提供 topic + 扇出 + 鉴权，**不发布业务事件**。产出方与归属：
- 现状 `requirement.ready`/`requirement.updated`/`comment.added`/`drive.changed`/`notification.created`/`job.updated` 等（api-contract §5.2 全清单）——各域沿用，topic 改名（`req:`→`workitem:`）随 F11。
- WorkHub 新增正式事件名采用 `_experience-deliverable-contracts.md` §4:`agent_run.started`/`agent_run.step`/`agent_run.escalated`/`permission.ask`/`permission.decided`/`proposal.opened|reviewed|merged`/`knowledge.evidence.ready`/`sync.progress|conflict`/`step.snapshot` 等——归 **F8/F6/F9/F10/P1**。F05 保证这些事件能跨 worker 扇出到正确 topic 并经订阅鉴权。

> 注：Master §6.8 与早期概念图里的 `agent.run.started` / `proposal.ready` 属概念别名。**P0 新实现只能 publish 正式名**;别名可在前端迁移层兼容旧事件,但不得继续扩散。

### Event Envelope

新增 WorkHub 事件使用 `_experience-deliverable-contracts.md` §4.2 的 `WorkHubEvent<T>` envelope。F05 不校验业务 `data`,但可在测试里断言新事件至少含 `event_id/type/topic/ts/data`,且 `preview_text` 不超过 200 字符。

### broker 后端选型（P0 定调）

- **首选 Redis pub/sub**（`DEPLOY.md:97` 点名）：跨 worker 扇出成熟、低延迟；`settings.broker_url=redis://…`。
- **降级 PG `LISTEN/NOTIFY`**（无 Redis 部署 / LAN-first 最小依赖）：复用 F3 的 PG，`pg_notify(channel, payload)` + 单 `LISTEN` 连接；**注意** payload 8KB 上限——超限事件只发"提示 + 拉取键"（与 P-1"SSE 只放预览、REST reconcile"契约天然一致）。
- 二者经 `PushBus` 接口同构；**P0 落一种即可过门禁**，另一种作部署选项（不阻塞）。

### Alembic

- pub/sub **无表**。presence 若选 PG 后端：一张 `presence`（`user_id` PK、`last_seen_at timestamptz`、`open_streams int`）轻量表，随 F3 Alembic 体系出迁移（`timestamptz`、up/down 可逆）；选 Redis 则无表。

### API / 事件

- SSE 端点演进：`/api/push/stream`（all）、`/stream/req/{id}`→`/stream/workitem/{id}`（F11 路径收口）、`/stream/me`（`user:{id}`）沿用；**新增** `/stream/session/{id}`、`/stream/run/{id}`（鉴权范式沿用 `stream_one`）。
- F05 **不新增业务 HTTP 端点**（非 SSE）。

---

## 验收用例（可测）

> 对齐 Master §8 功能门禁第 1 条（`--workers 2` SSE 不丢、presence 正确、无跨用户泄漏）+ §7 集成场景①③。

- [ ] **AC-1 接口抽象等价**：切 `InProcessPushBus`（单 worker），现有 SSE 回归全过——`connected` 帧、`requirement.updated` 投递、30s `: ping` 心跳、断连 `unsubscribe`、`splitlines` 多行 payload 不破帧（P-3）。
- [ ] **AC-2 跨 worker 扇出（核心）**：`--workers 2`，连在 worker-A 的订阅者订 `workitem:{id}`，worker-B `publish` 同 topic → A **收到**（broker 后端）；切回 `InProcessPushBus` 则 A 收不到（证明确为 broker 扇出，非偶然同进程）。
- [ ] **AC-3 背压保留**：单订阅者灌满 256 队列 → 后续事件被丢（不阻塞 publisher），与现状一致（P-1）。
- [ ] **AC-4 presence 跨 worker 一致**：worker-A `mark_stream_open(u)` → worker-B `get_presence(u).is_online == True`；TTL 120s 过期后转 offline（语义同 `presence.py:59`）。
- [ ] **AC-5 隐私门：`workitem:{id}`**：陌生人订阅私有态（draft/clarifying/summary_ready）工单的 `/stream/workitem/{id}` → 403（`can_view` 门，P-5）；有权者 200。
- [ ] **AC-6 隐私门：`user:{id}` 身份派生**：客户端无法构造请求订阅他人 `user:{id}` 流（topic 从认证身份派生，非路径，P-5）。
- [ ] **AC-7 无跨用户泄漏（NFR-08，有前科）**：worker-A 发到 `user:{B}` / `job:{B}` 的私有事件，连在 worker-B 但非 B 本人的订阅者**收不到**；broker payload 未"全量广播 + 客户端过滤"（grep 无全量发 + 客户端 filter 模式）。
- [ ] **AC-8 新 topic 鉴权**：`run:{id}` 非 owner/审批人订阅被拒；`session:{id}` 非 owner 被拒。
- [ ] **AC-9 事件正式名守卫**：新增 WorkHub 事件 publish 点只引用正式事件常量;`rg "agent\\.run|proposal\\.ready"` 在新增 publish 代码中零命中。
- [ ] **AC-10 envelope 守卫**：`permission.ask` / `proposal.opened` / `knowledge.evidence.ready` 三类 fixture 事件都含 `WorkHubEvent` 基本字段,且可映射 `cuu_state`。
- [ ] **AC-11 通知出口跨 worker**：worker-A `publish_notification`（`user:{B}`）→ 连在 worker-B 的 B 本人 `/stream/me` 在心跳窗口内收到 `notification.created`（与 F9 AC5 同源，验出口 broker 化）。
- [ ] **AC-12 broker 降级/重连**：broker 短暂断开重连后，已有订阅自动重订阅、不丢后续事件;broker 启动不可达按 N-7 策略 fail-closed/降级（不静默脑裂）。

---

## 回滚与风险

### 回滚策略

- **接口切换点单一**：模块单例 `bus` 是唯一后端选择点；回滚 = `settings` 切回 `InProcessPushBus`（恢复单 worker 行为）+ `--workers 1`。`presence` 同理切回进程内 dict。无 schema 变更（选 Redis 时）或单表可 `downgrade`（选 PG 时）。
- **成对发布纪律**：F05 与 F3 成对——任一未就位则 `--workers 1`（Master §6 铁律 3）；F05 单独 merge 但**不解禁多 worker**，门禁（AC-2/AC-7）过后才开 N。

### 风险

| # | 风险 | 缓解 |
|---|---|---|
| RK-1（Master 风险 1） | 只换库不换 bus（或反之），半做即 split-brain（静默丢 SSE） | F3+F5 成对；发布前 `--workers 1`；AC-2 为门禁；接口切换点单一，未过门禁不解禁 |
| RK-2（Master 风险 3，**有前科**） | broker 化后每 payload 全 worker 可见 → 跨用户事件/通知泄漏（NFR-08） | 隐私门在**订阅边界**重强制（P-5/N-2）；`user:{id}` 身份派生、`workitem:{id}` `can_view`、私有不发 `all`；**禁**"全量发 Redis 客户端过滤"；AC-5/6/7 守 |
| RK-3 | broker 不可达 → 事件静默丢 / 进程卡死 | N-5 健康检查 + fail-closed/降级策略 + 断线重连重订阅；AC-10 守 |
| RK-4 | PG `LISTEN/NOTIFY` 8KB payload 上限截断大事件 | 事件只放预览 + 拉取键（与 api-contract §5.1"SSE 尽力、REST reconcile"契约一致）；大 payload 落 DB，事件带 ref |
| RK-5 | 背压语义在 broker 化时被改成阻塞投递 → 慢订阅者拖垮 publisher | 本地分发段逐字保留 `maxsize=256`+`QueueFull→pass`（P-1）；AC-3 守 |
| RK-6 | presence 共享后端 TTL/计数竞态（多 worker 并发增减 `open_streams`） | Redis 原子 `INCR/DECR`+TTL（或 PG 行锁）；引用计数语义沿用 `presence.py:41-45`；AC-4 守 |
| RK-7 | 新增 topic 漏配鉴权门 → 默认可订阅泄漏 | N-2 集中鉴权注册表 + 订阅前查表（无表项默认拒），新 topic 必须登记谓词；AC-8 守 |

---

## 依赖与被依赖

### 依赖（上游）

- **F3 PostgreSQL+Alembic**：与 F5 **成对**解除单 worker（Master §6 铁律 3）。F3 提供多 worker-ready engine；选 PG `LISTEN/NOTIFY` 方案时直接复用 F3 的 PG。**两者都到位才 `--workers N`。**
- **F1 仓库/配置**（间接）：`settings.broker_url`（broker 连接）、broker 配置块（Master §3 In）。

### 被依赖（下游）

- **F8 Agent 引擎核心**：`run:{run_id}` topic 跨 worker 扇出 + 订阅边界隐私门；AgentRun 队列后端可复用 F05 broker 连接（队列语义/lease 归 F8）。
- **F6 权限引擎**：`permission.ask` 经 F05 发 `user:{被路由人}`（订阅边界鉴权门）；F06 是 publisher，F05 提供 topic + 扇出。
- **F9 生命周期/通知**：`publish_notification` 出口透明切到 broker 后端（R-5）；跨 worker 投递（F09 AC5 依赖 F05 broker）。
- **F11 daemon 拆分/客户端改接**：SSE 端点路径收口（`/stream/req`→`/stream/workitem`、新 `/stream/session`、`/stream/run`）；周期发布者的 leader 选举（pub/sub 无需 leader，周期任务需要——F11 lifespan 重排）；跨域 SSE（CORS+cookie）。

### 成对/协同约束

- **F3 ⇄ F5 成对铁律**（Master §6 铁律 3、§5.1）：单独任一落地后**仍 `--workers 1`**；2 worker 冒烟（AC-2/AC-7）过门禁才解禁 N。
- F05 只交付 **pub/sub + presence**；**work-queue（F8）、里程碑通知中枢（F9）、行级锁（F8）** 各归其组件——F05 不越界发业务事件、不实现队列/锁。

---

## Target TS paths

> 本组件施工时,旧 `push_bus.py` / `push.py` / `presence.py` 是 topic、背压和身份隔离行为来源;新实现落 `packages/events` 与 API SSE/broker。

| 类别 | 目标路径 | 必须产物 | 审计门禁 |
|---|---|---|---|
| event contracts | `packages/events/src/types.ts`, `packages/events/src/event-types.ts` | `WorkHubEvent<T>`、正式事件名常量 | 页面/Cuu 不手写事件字符串 |
| adapters | `packages/events/src/toAttentionItem.ts`, `packages/events/src/toCuuState.ts` | 事件→一件事/Cuu 状态映射 | `budget.warning`/`proposal.opened` 等均可映射 |
| broker | `apps/api/src/broker/*` | Redis pub/sub 或 dev in-memory backend | Redis 关闭时 fail-closed 或显式 single-worker dev |
| SSE | `apps/api/src/sse/*`, `apps/api/src/routes/push.ts` | `/api/push/stream/me`, `/run/:id`, topic 鉴权 | 私有事件不发 `all` |

**PR 必答**:新增 topic 必须登记鉴权谓词;大 payload 只发 ref/preview。F05 不实现 work queue,AgentRun queue 归 F08。
