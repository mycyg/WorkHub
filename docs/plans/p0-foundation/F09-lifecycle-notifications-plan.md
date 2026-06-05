---
component: F09
title: F09 生命周期 / 通知扩展 — 系统级实现 plan
status: draft
depends: [F5, F2]
type: feat
date: 2026-06-05
master: ../2026-06-05-feat-workhub-p0-foundation-master-plan.md
inventory: ./_migration-inventory.md
specs:
  - ../../workhub/02-ai-engine/pm-mode-orchestration.md
  - ../../workhub/03-collaboration/review-and-approval.md
---

# F09 生命周期 / 通知扩展 — 系统级实现 plan

> **一句话**:把现有「需求管理大师」的里程碑通知中枢(`lifecycle.py` 的 `_MILESTONES` + queue-in-tx/flush-post-commit 双段式)**原样保住其铁律**,只做加法:登记四个新状态(`escalated / pm_mode / in_review / merged`)、新增 `approver` 收件人角色与 `permission:{approver}` 投递语义、保持 `dedupe_key` 幂等、并随 F5 broker 化后实现**跨 worker 投递**。
>
> 上游:[Master Plan](../2026-06-05-feat-workhub-p0-foundation-master-plan.md)(§5 F9 行、§5.1 依赖图、§6 九铁律之 7「通知不漏」、§8 整体验收)· [迁移清单 §10](./_migration-inventory.md)。
> 规格(本组件作为消费方,口径以规格为准):[`pm-mode-orchestration.md`](../../workhub/02-ai-engine/pm-mode-orchestration.md) §0/§2.2/§3.3/§8 · [`review-and-approval.md`](../../workhub/03-collaboration/review-and-approval.md) §0/§3.3/§8.2。
> 真实代码锚点:`app/services/lifecycle.py`、`app/services/notifications.py`、`app/services/push_bus.py`、`app/models.py:146`。

---

## 目标

1. **新状态不静默漏通知(九铁律 #7)**:WorkHub 新增的 `escalated / pm_mode / in_review / merged` 四个状态机节点全部登记进 `_MILESTONES`,任一状态变更都走中枢通知码路。`lifecycle.py:3-14` 已记录真实 outage——状态变更脱离通知码路是**隐形 outage**(无报错,用户只是收不到),F09 的核心就是不让最重要的新流(升级/合并)重蹈覆辙。
2. **approver 路由**:新增 `approver` 收件人角色,把升级简报、审批待办、合并结果精确投递到「该决策的人」(`route_approver` 的产物 `routed_to_user_id`),投递语义对齐规格的 `permission:{approver}` 概念(实现层落为私有 `user:{id}` topic,见「数据与接口契约」)。
3. **铁律原样保住**:queue-in-tx(`queue_status_notifications` 不 commit/不 publish)、flush-post-commit(`flush_status_notifications` 在 commit 后 fire 且吞 bus 异常)、`dedupe_key` 幂等、`str.replace` 安全替换(非 `str.format`)、私有按身份(只发 `user:{id}`,永不 `all`)——逐条保留,不"顺手重构"。
4. **跨 worker 投递**:随 F5 把 `publish_notification` 的出口从进程内 `bus` 切到 broker 后端,保证 2 worker 下 A worker 写的通知能投到连在 B worker 的接收方;隐私门在订阅边界重强制(九铁律 #5)。

---

## 范围(Scope)

### In(P0 必须)

- `_MILESTONES` 登记四个新状态键:`escalated / pm_mode / in_review / merged`(文案、severity、recipients、type)。
- `_resolve_recipients` 扩展 `approver` 收件人角色(解析 `routed_to_user_id` / EscalationEvent.target_user_id / Proposal lead-owner)。
- `render()` 替换表 `subs` 扩展 `{reason_oneline}` 等新占位符(取 `why_md`/`reason_md` 首句),沿用 `str.replace`。
- `dedupe_key` 公式覆盖新状态(含 actor.id,防 `revision_requested→doing→revision_requested` 循环互相覆盖的同款风险)。
- 新状态写入点(F8 Agent 引擎的 escalate/in_review/merge,F6/审批侧的 in_review)接 `queue_status_notifications` + `flush_status_notifications`(成对调用)。
- 随 F5:`publish_notification`/`publish_notification_threadsafe` 出口改 broker 后端,实现跨 worker 投递;订阅边界 `can_view`/`user:{id}`-by-identity 不削弱。

### Out(明确推迟到 P1+)

- **PM 模式编排逻辑本身**(`PMOrchestrator.on_escalated`、简报生成 `build_brief`、催办巡检 `catchup_sweep`、智能派活)→ **P2**(`pm-mode-orchestration.md` 全篇)。F09 只提供其依赖的「里程碑通知中枢」扩展点,不实现编排。
- **`ApprovalRequest` 阻塞原语 + 审批路由 + SLA + 委派 + 永远允许学习**(`review-and-approval.md` §1/§3/§4/§5/§6)→ **F6 / P2**。F09 只提供 `approver` recipient 角色,不实现路由算法/SLA 扫描。
- **细粒度催办规则表 R1–R5、催办节流频率上限、静默时段**(`pm-mode-orchestration.md` §5.3)→ **P2**。
- **`pm_briefed / staffing_proposed / catchup / re_reviewed` 等编排子里程碑**(规格 §0 表)→ 随 PM 模式落地于 **P2**;F09 只登记四个 P0 状态机主节点。
- **Proposal/Review/Escalation 通知的完整字段映射**(依赖这些实体定稿)→ 字段以 F2/data-model 收口为准,F09 落最小可用映射。
- **`Notification` → `permission:{approver}` 物理 topic 新命名空间**:规格 §8.2 明确不另立 `permission:*` 命名空间,审批私有事件走 `user:{被路由人 id}`。F09 不新建 topic 命名空间。

---

## 现状 → 改动

> 按 PORT / REFACTOR / NEW 分组。锚点为当前「需求管理大师」真实 file:line。

### PORT(逐字保留,禁重写)

- **P1 queue-in-tx / flush-post-commit 双段式** — `lifecycle.py:104` `queue_status_notifications`(不 commit/不 publish,`:113-114` docstring 明示)+ `lifecycle.py:164` `flush_status_notifications`(commit 后发、吞 bus 异常 `:170-173`)。**原样保留**,新状态复用同一双段式。这是九铁律 #7 与规格 §0「三铁律」的代码载体。
- **P2 `str.replace` 安全替换** — `lifecycle.py:124-139`:昵称/标题含 `{` 时 `str.format` 会 KeyError 甚至泄漏属性访问,故用 `str.replace`。新占位符**必须**继续走 `subs` 表 + `render()`,不得引入 `str.format`(规格 §3.3 重复强调)。
- **P3 私有按身份投递** — `notifications.py:94-105` `publish_notification` **仅**发 `user:{row.user_id}`(`:105`);`:96-103` docstring 记录了发 `all` 导致跨用户信息泄漏的真实事故(NFR-08)。新状态/approver 一律走 `user:{id}`,**永不** `all`。
- **P4 `dedupe_key` 幂等** — `notifications.py:43-77` 的 change-detection guard(同 key 内容不变则不 resurface)+ `lifecycle.py:159` 的 `dedupe_key=f"{new_status}:{req.id}:{actor.id}"`(含 actor.id 防循环覆盖)。`Notification.dedupe_key`(`models.py:158`,`String(256)` index)。新状态复用同款公式。
- **P5 软删除收件人过滤** — `lifecycle.py:99-101` 跳过 `deleted_at` 用户;`:93` `discard(actor.id)` 排除 actor 自己。`approver` 解析必须沿用(规格 §3.3「排除软删除用户/排除发起者自己」)。
- **P6 threadsafe 桥** — `notifications.py:108` `publish_notification_threadsafe`(sync 端点 anyio 桥 + same-loop fallback + poll 兜底)。保留;broker 化后内部出口换 backend,签名不变。

### REFACTOR(在不放松不变式前提下扩展)

- **R1 `_MILESTONES` 加四键** — `lifecycle.py:31-74`。现覆盖 `claimed / delivered / delivery_doc_pending / accepted / revision_requested / cancelled` 六键;**追加** `escalated / pm_mode / in_review / merged`(文案见「数据与接口契约」)。迁移清单 §10 REFACTOR 与规格 data-model §5 警告:不登记则升级/合并里程碑静默不通知。
- **R2 `_resolve_recipients` 加 `approver` 角色** — `lifecycle.py:77-101`。现解析 `submitter / assignees / other_side` 三角色;**追加** `approver`(规格 §3.3「`owner` 是新增 recipient 角色,需扩展该函数」/ pm-mode §3.3)。`approver` 解析顺序:① 显式 `routed_to_user_id`(若 ApprovalRequest 已存在,F6 提供)→ ② EscalationEvent.target_user_id → ③ WorkItem lead(`RequirementAssignment.role=='lead'`)→ ④ Project.owner_user_id → ⑤ 空则不投(由 F6 路由失败→升级兜底,不在 F09 兜底)。仍走 `:93` discard-actor、`:99-101` 跳软删。
- **R3 `render()` 的 `subs` 加占位符** — `lifecycle.py:129-139`。现 4 键 `{code}/{title}/{label}/{actor}`;**追加** `{reason_oneline}`(取 escalation `why_md`/`reason_md` 首句,规格 §3.3 明示「需加进 subs 否则原样透传给用户」)。仍用 `str.replace`。新增的取值来源经调用方以参数传入(见 R6),`render` 不直接读 ORM 关联以避免 N+1/越权。
- **R4 `queue_status_notifications` 签名兼容 WorkItem** — `lifecycle.py:104-161` 现签名 `(db, req: Requirement, new_status, actor)`。F2 把 `Requirement`→`WorkItem` 改名后,类型注解与字段引用(`req.code`/`req.title`/`req.submitter_user_id`/`req.assignments`/`req.project_id`/`req.id`)随之改名;**逻辑不变**。`target_url` 从 `/r/{req.id}`(`:151`)按 F11 路由重排为 work_item 路径(以 api-contract 为准,F09 落占位、F11 收口)。
- **R5 出口 broker 化** — `notifications.py:105` `await bus.publish(...)` 与 `:124` threadsafe 内的 `bus.publish`。F5 把 `bus`(`push_bus.py:47` 进程内单例)抽象为 `PushBus` 接口 + Redis/LISTEN-NOTIFY 后端后,这两处出口**透明切换**(import 的 `bus` 指向新 backend)。F09 不重写出口逻辑,只确认切换后跨 worker 可达 + 隐私门在订阅边界(F5 的 `push.py`)重强制。**成对约束**:此项必须与 F5 同发,F3+F5 未成对前不得 `--workers N`(九铁律 #3)。
- **R6 写状态点接中枢** — 现有 AI 写状态点 `auto.py:212`(`r.status="delivered"`)已正确接 `queue_status_notifications`(`auto.py:223-234`,合成 `ai-auto` actor `:224`)。F8 新增的 escalate / in_review / merge 状态写点必须**同款接法**:写状态 → `queue_status_notifications(db, wi, new_status, actor)` → `db.commit()` → `await flush_status_notifications(pending)`。AI 触发的状态用合成 actor(沿用 `auto.py:224` `User(id="ai-auto"|"ai-pm", nickname=...)` 范式;F4 的 `require_actor` 一等 AI actor 落地后改用之)。

### NEW(净新增)

- **N1 `approver` 投递的 EscalationEvent / ApprovalRequest 解析适配** — 新实体(F2 建表:`EscalationEvent` / `ApprovalRequest` / `Proposal`)的收件人解析小函数,供 R2 调用。F09 落「能解析出 approver user_id」的最小实现;路由算法(scope 合并、SLA)归 F6。
- **N2 跨 worker 投递验收钩子** — 2 worker 下「A worker 触发 escalated → 连在 B worker 的 approver 收到 `notification.created`」的集成测试(对齐 Master §7 集成场景⑤、§8 整体验收)。依赖 F5 broker。
- **N3 新事件 type 常量** — 通知 `type` 串(`workitem.escalated` / `workitem.in_review` / `workitem.merged` 等,见契约表),与 F5 事件 taxonomy(`escalation.created` 等 SSE 事件)区分:F09 负责**Notification.type**(收件箱条目),F5 负责 **SSE event type**(实时事件名)。二者命名不冲突、各有出口。

### RISK(本组件首要风险,见「回滚与风险」详列)

- 加状态时**静默漏通知**(`lifecycle.py:3-14` 史证)——首要风险,缓解=登记即测。
- `approver` 解析放松隐私(投给看不到工单的人 / 投 `all`)——缓解=沿用软删过滤 + 订阅边界 `can_view` 重强制。
- broker 出口切换半做(只换库不换 bus)→ 跨 worker 丢通知(split-brain,九铁律 #3)。

---

## 实施步骤(有序、可勾选)

> 前置:F2(WorkItem/EscalationEvent/ApprovalRequest/Proposal 实体就位)、F5(PushBus 抽象 + broker 后端 + 订阅边界鉴权)。F09 在 F8 后、与 F10 并行(Master §5.1)。

- [ ] **S0 基线回归固化**:为现有六个里程碑(`claimed/delivered/delivery_doc_pending/accepted/revision_requested/cancelled`)补/确认通知断言测试(收件人、文案 `str.replace`、dedupe、commit 后才 publish),作为「不放松」基线。
- [ ] **S1 登记四个新状态键**:在 `lifecycle.py:31` `_MILESTONES` 追加 `escalated / pm_mode / in_review / merged`(文案/severity/recipients/type 见契约表)。
- [ ] **S2 扩 `_resolve_recipients` 的 `approver` 角色**(`lifecycle.py:77`):实现 N1 解析链(routed_to → target_user_id → lead → owner → 空),沿用 discard-actor + 跳软删。
- [ ] **S3 扩 `render()` 的 `subs`**(`lifecycle.py:129`):加 `{reason_oneline}`,值由调用方传入;保持 `str.replace`。`queue_status_notifications` 增可选 `extra_subs: dict[str,str] | None` 形参承载新占位符值,旧调用方零改动。
- [ ] **S4 WorkItem 改名兼容**(随 F2):类型注解与字段引用 `Requirement`→`WorkItem`;`target_url` 路径占位待 F11。
- [ ] **S5 出口 broker 化对接**(随 F5):确认 `publish_notification`/`_threadsafe` 经新 `bus` backend 跨 worker 可达;不改双段式语义。
- [ ] **S6 接 F8 写状态点**:escalate / in_review / merge 三处状态写后成对调 `queue_status_notifications` + `flush_status_notifications`(commit 之间);AI 触发用合成/一等 AI actor。
- [ ] **S7 dedupe_key 公式覆盖新状态**:沿用 `f"{new_status}:{wi.id}:{actor.id}"`;对 `merged`/`in_review` 这类「一次性、不应被同一 actor 重发」事件确认 key 唯一性,避免重投。
- [ ] **S8 集成测试**:① 四个新状态各触发一次,断言正确收件人/文案/severity/commit 后 publish;② 2 worker 跨 worker 投递(N2);③ approver 解析的隐私边界(投给非参与者应被订阅门拦)。
- [ ] **S9 grep 守卫**:确认无新增 `str.format` 用于通知模板、无新增向 `all` topic 发带正文/`trigger` 的私有内容(对齐 Master §8 验收风格)。

---

## 数据与接口契约

> 跨组件共享处以 Master + 规格为准;F09 只定义本组件**直接读写**的面。

### 实体字段(复用,不新造)

- `Notification`(`models.py:146`):复用 `type/severity/title/body/target_url/project_id/requirement_id/dedupe_key/user_id`。F2 改名后 `requirement_id`→`work_item_id`(FK 随 `requirements→work_items`)。**无新增列**——F09 是配置(`_MILESTONES`)+ 路由(`_resolve_recipients`)扩展,不改 `Notification` schema。
- 读侧依赖(F2 建表,F09 只读其字段做 approver 解析):`EscalationEvent.target_user_id` / `status`(权威定义 confidence-risk-escalation §2.2);`ApprovalRequest.routed_to_user_id`(权威 data-model §8.2 / review-and-approval §1.2);`RequirementAssignment.role=='lead'`(`models.py:370`);`Project.owner_user_id`(`models.py:83`)。

### Alembic

- **F09 不引入新表/新列** → 无独立迁移。`Notification.requirement_id→work_item_id` 的改名随 **F2/F3** 的 `requirements→work_items` 主迁移(15+ 表 FK 一并改),F09 不单独出迁移。若实测发现 `dedupe_key` 长度(`String(256)`)对新 key 不足,则随 F2 主迁移放宽——目前公式 `{status}:{uuid32}:{uuid32}` < 80 字符,**无需放宽**。

### `_MILESTONES` 新增条目(契约,文案去黑话、severity 见下)

> 收件人角色 `approver`/`assignees`/`submitter`;`{reason_oneline}` 取自 escalation 首句,经 R3 `extra_subs` 注入。用户**永不**看到 `trigger=doom_loop` / confidence 数值 / git 术语(规格 §3.3)。

| 新状态 key | recipients | Notification.type | title 模板 | body 模板 | severity |
|---|---|---|---|---|---|
| `escalated` | `approver` | `workitem.escalated` | `{code} 需要你来定一下` | `这个活我先卡住了:{reason_oneline}。我建议这么推进,看一眼?` | `high` |
| `pm_mode` | `approver` | `workitem.pm_mode` | `{code} 我整理好了推进方案` | `为什么卡 / 建议谁做 / 计划都列好了 — 确认或调整` | `high` |
| `in_review` | `approver` | `workitem.in_review` | `{code} 成果待你确认采纳` | `{actor} 把成果整理好了,进去确认采纳或打回` | `high` |
| `merged` | `submitter` | `workitem.merged` | `{code} 已合并完成 🎉` | `{actor} 采纳了成果,本次工作已汇入` | `normal` |

> **来源对齐**:`escalated`/`pm_mode` 文案取自 `pm-mode-orchestration.md §3.3`(其 `pm_briefed` 子里程碑属 P2,F09 用 `pm_mode` 状态主节点承载首条简报通知)。`in_review`/`merged` 对齐 `review-and-approval.md §1.1` 异步门(`proposal.ready_for_review`/合并)与 pm-mode §7.3。事件 `type` 命名与 F5 SSE 事件(`escalation.created`/`proposal.ready`)分属两套出口,不冲突。

### 事件 topic(投递语义)

- 里程碑通知**收件箱条目**:`create_notification` 落库 → commit 后 `publish_notification` 发 `notification.created` 到 **`user:{recipient_id}`**(`notifications.py:105`)。这是 `permission:{approver}` 概念的**实现落点**——approver 是一个 user,其私有流是 `user:{approver_id}`,客户端经 `/stream/me`(cookie/令牌派生 id)订阅。**不新建** `permission:*` topic 命名空间(规格 §8.2 明确)。
- 与 F5 SSE 事件的分工:F5 负责 `escalation.created` / `proposal.ready` / `permission.ask` 等**实时事件**(topic `workitem:{id}` + 目标人 `user:{id}`);F09 负责**里程碑通知行**(`notification.created` → `user:{id}`)。两者都 commit 后发、都不发 `all`、都在订阅边界重强制 `can_view`。

### API

- F09 **不新增 HTTP 端点**。通知读取沿用现有 `app/routers/notifications.py`(收件箱列表/标记已读)。审批响应端点(`POST /api/approvals/{id}/respond` 等)归 F6 / api-contract §2.8。

---

## 验收用例(可测)

> 对齐 Master §7 集成场景⑤(新状态 `escalated` 触发通知到正确 approver)、§8 整体验收(通知不漏)。

1. **AC1 四个新状态都触发通知**:对一条 WorkItem 依次置 `escalated → pm_mode → in_review → merged`,每次断言:`Notification` 行已创建、`type`/`severity` 符合契约表、`title`/`body` 经 `str.replace` 渲染(无残留 `{...}` 占位)、收件人符合 recipients 角色。**反例守卫**:删掉 `_MILESTONES['escalated']` 后该测试必须红(证明登记是必要的,非装饰)。
2. **AC2 approver 路由正确**:`escalated` 的通知投到 EscalationEvent.target_user_id / routed_to / lead(按解析链),**不**投到非参与者;actor 自己被 `discard`;软删用户被跳过。
3. **AC3 queue-in-tx / flush-post-commit 不变式**:`queue_status_notifications` 调用后、`commit` 前,SSE bus **未收到**任何事件(断言 publish 未被调用);`commit` 后 `flush_status_notifications` 才 publish。模拟 `publish` 抛异常:状态变更**不被回滚**、不 500(`flush` 吞异常),行仍在库。
4. **AC4 dedupe 幂等**:同一 `(new_status, wi, actor)` 重放(SSE 重投 / PATCH replay),内容不变则不 resurface(read_at 不被重置)、不重复发 SSE(沿用 `notifications.py:50-66` change-detection)。
5. **AC5 跨 worker 投递(2 worker)**:daemon `--workers 2`,A worker 触发 `escalated`,连在 B worker `/stream/me` 的 approver 在心跳窗口内收到 `notification.created`(依赖 F5 broker)。
6. **AC6 隐私不泄漏**:对 `escalated`/`in_review`(带 `{reason_oneline}` 正文)断言**只**发 `user:{approver_id}`,grep 无向 `all` 的私有正文发布;非 approver 的 `/stream/me` 收不到。
7. **AC7 `str.format` 守卫**:构造 nickname/title 含 `{actor.__class__}` 的 WorkItem,渲染不抛异常、不泄漏属性(证明 `str.replace` 路径未被 `str.format` 取代)。

---

## 回滚与风险

| 风险 | 触发 | 缓解 | 回滚 |
|---|---|---|---|
| **R-A 新状态静默漏通知**(首要,`lifecycle.py:3-14` 史证) | 加 `escalated/in_review/merged` 状态但忘登记 `_MILESTONES` | AC1 反例守卫(删条目即红)+ S9 grep;CI 校验「状态机枚举 ⊇ _MILESTONES 覆盖的 P0 关键节点」 | `_MILESTONES` 是纯数据 dict,回滚=删回新增键,无 schema 变更、无数据迁移 |
| **R-B approver 解析泄漏** | `approver` 投给看不到工单的人,或退化成发 `all` | 沿用 `:93` discard-actor + `:99-101` 跳软删;F5 订阅边界 `can_view` 重强制;AC2/AC6 | 还原 `_resolve_recipients` 到三角色;approver 投递降级为不投(由 F6 路由兜底) |
| **R-C broker 出口半做 → 跨 worker 丢通知** | 只换库(F3)不换 bus(F5),第 2 worker 收不到 | 九铁律 #3 成对约束:F3+F5 未成对前 `--workers 1`;AC5 门禁 | 出口 `bus` 是单一 import 切换点,回退到进程内 `push_bus.bus` 即恢复单 worker 行为 |
| **R-D `str.format` 误用** | 新占位符用 `str.format` 渲染 → nickname 含 `{` 时 KeyError/泄漏 | R3 强制走 `subs`+`render`;AC7 + S9 grep | 还原 `render()` |
| **R-E dedupe key 冲突** | `merged`/`in_review` 一次性事件被同 actor 重投覆盖 | key 含 actor.id(`:159` 范式)+ change-detection guard;AC4 | key 公式纯函数,调整即生效 |

**回滚总评**:F09 改动集中在 `lifecycle.py`(纯数据 dict + 两个纯函数扩展)与 `notifications.py` 出口(随 F5 切换),**无新表、无 Alembic 迁移、无 schema 变更**,回滚成本低、可独立 revert 而不影响 F2/F5/F8 已落地部分。最大不可逆风险来自「漏登记」——这是**遗漏**而非**破坏**,由 AC1 反例守卫 + CI 枚举校验前置拦截。

---

## 依赖与被依赖

### 依赖(F09 需要它们先就位)

- **F5 事件 bus → broker**:`publish_notification` 的跨 worker 出口、订阅边界 `can_view`/`user:{id}`-by-identity 隐私门。**成对约束**:F09 的 R5/AC5 必须等 F5 broker 后端 + F3 PG 同时到位(九铁律 #3),否则跨 worker 投递无意义且会 split-brain。
- **F2 实体与模型移植**:`WorkItem` 改名;新实体 `EscalationEvent`(`target_user_id`)/`ApprovalRequest`(`routed_to_user_id`)/`Proposal`——`approver` 解析链(R2/N1)读它们的字段。
- **(间接)F4** 一等 AI actor(`require_actor`):S6 的 AI 触发状态用之替代 `auto.py:224` 的手搓 `User(id="ai-auto")`;F4 未到位前沿用手搓 actor,不阻塞 F09。

### 被依赖(它们等 F09)

- **F8 Agent 引擎核心**:escalate / 完成判定后的 in_review/merge 状态写点调 F09 的 `queue_status_notifications`(S6);F8 是 F09 新状态的主要写入方。
- **F6 权限引擎 / 审批**(P2 完整化):`ApprovalRequest` 路由产物 `routed_to_user_id` 喂给 F09 的 `approver` 解析;反向 F09 提供「审批待办落收件箱」的通知出口。
- **P2 PM 模式编排**(`pm-mode-orchestration.md`):其简报/派活/催办全部经 F09 扩展后的中枢通知中枢外发(规格 §0「经理模式所有外发走 `flush_status_notifications`」);F09 是 PM 模式的通知地基。
- **F11 客户端改接**:`/stream/me` 订阅、`notification.created` 事件、`target_url` work_item 路径的最终收口。
