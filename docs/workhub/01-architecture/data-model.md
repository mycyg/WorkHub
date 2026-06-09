---
module: 01-architecture
layer: L0-foundation
status: 🚧
owner: workflow
---

# WorkHub 领域数据模型(Domain Data Model)

> 本篇定义 WorkHub 的**全量持久化实体、字段类型、关系(ER)、状态机、软删除与审计字段,以及 SQLite→PostgreSQL 的迁移要点**。
> 上游:[PRD §7 领域模型](../../prd/2026-06-04-workhub-prd.md) · [规格树索引](../README.md)。
> 同层交叉(随后落定,届时改为深链):`system-architecture.md`(进程边界/事件流)、`api-contract.md`(读写这些实体的 OpenAPI 路由 + 事件类型)、`tech-stack-and-migration.md`(选型与迁移清单)、`security-and-permissions.md`(`PermissionPolicy`/`AuditLog` 的运行时语义)。
> 术语去黑话以 [`00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md) 为权威:本篇用**内部技术术语**(branch / proposal / merge),UI 文案映射见该表。
> 代码根:本篇所有"现有"字段均锚定真实代码 [`app/models.py`](../../../app/models.py),并标注行号。

---

## 1. 设计原则(贯穿所有实体)

延续现有 `app/models.py` 已验证的范式,叠加 D-1/D-2 的演进:

1. **主键 = 不透明字符串 ID**:现状 `id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)`,`uid()` 返回 `uuid.uuid4().hex`([`models.py:12`](../../../app/models.py))。WorkHub 保留"应用层生成 UUID"策略(便于 daemon 在事务前预知 ID、便于客户端乐观创建),但在 PG 下列类型升级为原生 `UUID`(见 §9)。
2. **`TimestampMixin`**:每张表带 `created_at` / `updated_at`(`server_default=func.now()` + `onupdate=func.now()`,[`models.py:20-24`](../../../app/models.py))。
3. **软删除而非硬删除**:`deleted_at: Optional[datetime]`(带 index)。理由见 `User` 的注释——约 15 张表引用 `users.id` 且无 `ondelete cascade`,硬删会破坏历史工单的引用完整性([`models.py:39-43`](../../../app/models.py))。WorkHub 把此范式推广为**全实体默认**:列表/检索/选人器过滤 `deleted_at IS NULL`,但保留行供审计与回滚。
4. **身份双写**:既存 `*_user_id`(权限判定的唯一真相)+ `*_nickname`(展示 + 兼容旧行)。`Project.owner_nickname` 的注释明确:**权限检查必须用 `owner_user_id`**,否则注销昵称被重注册会静默继承 owner 身份([`models.py:79-83`](../../../app/models.py))。WorkHub 沿用:展示用 nickname,授权用 user_id。
5. **JSON 存于 `Text` 列 + 应用层编解码**:现状所有结构化 payload(`content_json`/`citations_json`/`trace_json`/`participant_user_ids_json`/`detail_json`)都是 `Text` 默认 `"[]"`/`"{}"`。PG 下统一升级为 `JSONB`(可索引、可查询,见 §9)。
6. **AI 改动可解释 / 可回滚 / 经审批**(产品宪法第 5 条,延续 `models.py` 注释升级为全局默认):任何 AI 副作用都落 `AuditLog` + 关联快照引用,经 `Proposal` → `Review` 才汇入 main。
7. **乐观锁就绪**:支持并发合并的可变业务对象(`WorkItem`、`SpecDoc`、`Branch` 头指针)新增 `version: int`(行版本号),写入走 `WHERE version = :expected` 的 compare-and-set;PG 行级锁兜底(见 §9.4)。

---

## 2. 实体全景:现有 / 演进 / 新增

下表是本篇的索引。「来源」对齐 PRD §7 的实体表(现有/演进/新增),并补出落库归类。

| 实体 | 归类 | 来源锚点 | 本篇章节 |
|---|---|---|---|
| `User` | 现有 | [`models.py:27`](../../../app/models.py) | §3.1 |
| `ClientDevice` | 现有 | [`models.py:57`](../../../app/models.py) | §3.1 |
| `UserProfile` | **新增** | — | §3.2 |
| `CollaborationGraph`(物化视图) | **新增·聚合** | 聚合自 `ActivityLog`/交付历史 | §3.3 |
| `Org` / `Workspace` | **新增** | — | §3.4 |
| `Project` | 现有 | [`models.py:71`](../../../app/models.py) | §4.1 |
| `WorkItem` | **演进**(自 `Requirement`) | [`models.py:314`](../../../app/models.py) | §4.2 + §5(状态机) |
| `Assignment` | 现有 | [`models.py:363`](../../../app/models.py) | §4.3 |
| `AcceptanceCriteria` | 现有 | [`models.py:464`](../../../app/models.py) | §4.4 |
| `Branch` | **新增·核心** | — | §6.1 |
| `Proposal` | **新增·核心** | 演进自 deliver→验收循环 | §6.2 |
| `MergeAttempt` | **新增·审计** | Proposal merge 冲突检测/选择留痕 | §6.2.2 |
| `MergeProposal` | **新增·调解候选** | MergeAttempt 下的一处冲突候选方案 | §6.2.3 |
| `Review` | **演进**(自 `RevisionRequest`) | [`models.py:535`](../../../app/models.py) | §6.3 |
| `Delivery` | 现有 | [`models.py:515`](../../../app/models.py) | §6.4 |
| `AgentRun` | **演进**(自 `auto_agent` + `BackgroundJob`) | [`models.py:93`](../../../app/models.py) / `auto_agent.py` | §7.1 |
| `AgentStep`(trace) | **新增** | 演进自 `trace_json` | §7.2 |
| `ConfidenceRecord` | **新增·命门** | 演进自 `llm_review`(`auto_agent.py:544`) | §7.3 |
| `EscalationEvent` | **新增·命门** | — | §7.4 |
| `Snapshot` | **新增·安全红线** | — | §7.5 |
| `PermissionPolicy` | **新增**(借鉴 opencode) | 演进自 `services/permissions.py` | §8.1 |
| `ApprovalRequest` | **新增** | 演进自 `lifecycle.py` 审批中枢 | §8.2 |
| `AuditLog` | **新增·治理** | 演进自 `ActivityLog` [`models.py:554`](../../../app/models.py) | §8.3 |
| `SpecDoc`(README) | **演进** | spec 文件夹 + `spec_watch.rs` | §6.5 |
| `Document/DriveItem` 家族 | 现有 | [`models.py:167/192/214/228`](../../../app/models.py) | §10(沿用) |
| `Notification`/`ScheduleEvent`/通知 | 现有 | [`models.py:146/250`](../../../app/models.py) | §10(沿用) |
| `Knowledge*` | 现有 | [`models.py:110/128`](../../../app/models.py) | §10(沿用) |
| `Meeting*` | 现有 | [`models.py:269/291`](../../../app/models.py) | §10(沿用) |

> 命名约定:PRD/用户语境称「需求 / 工作项」,**库内实体统一命名 `WorkItem`**(旧 `Requirement` 的演进),旧字段语义在 §4.2 逐列映射。

---

## 3. 身份层(L0)

### 3.1 现有:`User` / `ClientDevice`(原样迁移)

`User`([`models.py:27`](../../../app/models.py))字段:`id`、`nickname`(unique,index)、`cookie_token`(unique)、`availability_status`(默认 `free`)、`availability_text`、`availability_updated_at`、`is_admin`(bool,index)、`deleted_at`(软删除墓碑)。`display_name` 属性会剥离 `_deleted_<id8>_` 前缀并追加「(已停用)」([`models.py:45-54`](../../../app/models.py))。

> `is_admin` 的真实语义比 [`models.py:36`](../../../app/models.py) 注释("短路为 True")更细:读路径(`can_view_*`/`can_ack_*`)admin 全短路、连"项目处于活跃态"过滤都绕过;但**写路径**(`can_add_attachment`/`can_manage_assignees`/`can_claim`/`can_work`)admin 只绕过关系过滤,**仍受 `requirement_project_is_active` 与状态域约束**(归档项目须先 restore;[`permissions.py:50-119`](../../../app/services/permissions.py))。WorkHub §8.1 把它降级为最高优先级 allow 兜底时须保留这一"读全开、写仍受活跃态/状态门"的细粒度,否则会放宽现有约束。

`ClientDevice`([`models.py:57`](../../../app/models.py))= **设备令牌门**的载体(D-3 延续):`user_id`(FK CASCADE)、`device_name`、`client_token_hash`(unique,index)、`platform`、`last_seen_at`、`revoked_at`(index)。接活/干活类高权限操作要求一台未吊销的设备(`require_local_client`),详见 `security-and-permissions.md`。

> 演进:`is_admin` 布尔将被 §8.1 的 RBAC `role` + `PermissionPolicy` 取代/补充,但**地基迁移期 `is_admin` 保留**,作为最高优先级的 allow 兜底,避免迁移期失权。

### 3.2 新增:`UserProfile`(技能档案,喂智能派活)

支撑 PRD §8.4 智能派活、FR-STAFF-001(onboarding 必填"擅长什么 + 自我介绍")。与 `User` 1:1。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | FK→users.id (unique) | 1:1;`ondelete CASCADE` |
| `bio_md` | Text | 自我介绍(Markdown) |
| `skills_text` | Text | 技能自述(自由文本,grep 可检索,无向量库——D-4) |
| `skill_tags` | JSONB `[]` | 归一化专长标签(`["前端","数据分析"]`),派活粗匹配用 |
| `availability_pref` | JSONB `{}` | 可用度/打扰边界(时段、并发上限),喂 §3.1 `availability_*` 与桌宠节制 |
| `onboarded_at` | DateTime? | onboarding 完成时间;为 NULL 触发 J1 引导 |
| `created_at`/`updated_at` | DateTime | `TimestampMixin` |

### 3.3 新增:`CollaborationGraph`(聚合视图,不是手填表)

PRD §7 标注为「聚合视图」。**不是用户直接写的表**,而是由 `AuditLog`/交付历史/`Review` 结果**离线聚合**出的"谁擅长什么、与谁合作过、命中率"。落库形态二选一(见 §9 决策):

- 形态 A(推荐 MVP):PG **物化视图(`MATERIALIZED VIEW`)** `collaboration_edge`,定时 `REFRESH`;
- 形态 B(需增量更新时):普通表 + 触发器/后台 job 维护。

逻辑边结构(无论 A/B):

| 字段 | 类型 | 说明 |
|---|---|---|
| `from_user_id` | UUID | |
| `to_user_id` | UUID | 与谁合作过(同一 WorkItem 的 lead↔collaborator) |
| `co_work_count` | int | 共事次数 |
| `domain_tag` | text | 该边主要发生的领域(由 WorkItem 画像聚合) |
| `hit_rate` | float | 命中率 = `accepted / (accepted + revision_requested)`(源自 §6.3 `Review`) |
| `last_co_work_at` | DateTime | 最近共事时间(派活新鲜度权重) |

> 冷启动降级(FR-STAFF-004):无边数据时,派活退化为只读 `UserProfile.skill_tags` 粗匹配 + 解释式推荐,不做命中率加权。

### 3.4 新增:`Org` / `Workspace`(多租户/治理预留)

为 L5 治理与 D-3"云就绪架构"预留;**MVP(LAN-first)默认单 Org 单 Workspace**,所有现有行挂到默认租户(迁移见 §9.5)。

`Org`:`id` UUID PK、`name`、`slug`(unique)、`plan`(套餐,默认 `lan`)、`deleted_at?`、时间戳。
`Workspace`:`id` UUID PK、`org_id`(FK→orgs.id, CASCADE, index)、`name`、`slug`、`deleted_at?`、时间戳;`UniqueConstraint(org_id, slug)`。

`Project`(§4.1)将新增 `workspace_id`(FK,index),把现有项目纳入工作区作用域。`PermissionPolicy`/`AuditLog`/`AgentRun` 等横切实体均带 `org_id`+`workspace_id` 以支持后续租户隔离与按租户审计(NFR-08 隐私隔离)。

---

## 4. 工作项主轴(L2/L1 核心)

### 4.1 现有:`Project`(迁移 + 加 `workspace_id`)

`Project`([`models.py:71`](../../../app/models.py)):`id`、`name`、`slug`(unique,index)、`description`、`owner_nickname`(展示)、`owner_user_id`(授权,index)、`archived`(bool)、`deleted_at?`、`deleted_by_nickname`、`next_seq`(int,供 `PROJ-001/002…` 自增编号)。
WorkHub 新增 `workspace_id`(FK→workspaces.id, index)。`requirements`/`drive_items` 关系沿用 `cascade="all, delete-orphan"`。

### 4.2 演进:`Requirement` → `WorkItem`(逐列映射 + 新增)

主轴。在现有 `Requirement`([`models.py:314`](../../../app/models.py))基础上演进:**保留全部现有列**(语义/迁移见下),新增 AI-native 字段。

**保留(自 `Requirement`)**:
`id`、`code`(unique,index;`PROJ-001` 形态)、`project_id`(FK CASCADE)、`submitter_user_id`、`claimed_by_user_id`/`claimed_by_nickname`、`title`、`raw_description`、`summary_md`、`status`(见 §5)、`priority`、`estimate_hours`/`estimate_confidence`/`planning_note`、`start_at`/`due_at`、`source_meeting_id`/`source_requirement_id`(派生溯源,均 `SET NULL`)、各里程碑时间戳(`claimed_at`/`done_at`/`delivered_at`/`delivery_doc_ready_at`/`accepted_at`)、`sync_state`(`pending|synced|failed`,[`models.py:350`](../../../app/models.py))。

**新增(AI-native)**:

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace_id` | FK→workspaces.id, index | 租户作用域(冗余自 project,便于按工作区查询/隔离) |
| `version` | int, default 0 | 乐观锁行版本(§9.4);状态/内容写入 CAS |
| `mode` | str(16), default `worker` | `worker`(AI 工人态) / `pm`(项目经理受阻态),对应 PRD §5 一人两顶帽子 |
| `human_reserved` | bool, default false | "人工保留"开关(FR-ESC-005 的 WorkItem 级);为 True 则禁止 AI 工人执行,直接走人 |
| `current_spec_id` | FK→spec_docs.id?, index | 当前 README/规格页头指针(§6.5) |
| `main_branch_id` | FK→branches.id?, index | "正式版/main"分支头指针(§6.1) |
| `latest_confidence_id` | FK→confidence_records.id?, index | 最近一次分级裁决(§7.3),驱动 §5 的 confidence 分叉 |
| `deleted_at` | DateTime?, index | 软删除(现 `Requirement` 无此列,WorkHub 补齐统一范式) |
| `deleted_by_user_id` | FK→users.id? | |

> `cancelled` 是状态(§5),`deleted_at` 是软删除——两者正交:cancelled 仍可见于历史看板,软删才从列表隐藏。

### 4.3 现有:`Assignment`(= lead + N collaborators)

`RequirementAssignment`([`models.py:363`](../../../app/models.py)):`requirement_id`(→ 演进为 `work_item_id`)、`user_id`、`role`(`lead|collaborator`)、`assigned_by_user_id`;`UniqueConstraint(work_item_id, user_id)`。WorkHub 直接复用;派活(§8.4)的产出就是写入/调整本表的 `lead` + `collaborator` 行。

> 现有还有 `RequirementWorkspace` / `RequirementWorkspaceItem` / `RequirementProgressUpdate`([`models.py:378/396/408`](../../../app/models.py))——人侧的"个人工作区/勾选项/进度更新",`UniqueConstraint(requirement_id, user_id)` 即"每人一份"。
> **与 §6.1 `Branch` 的关系(对齐 [glossary §4 易混词](../00-overview/glossary-dejargon.md))**:glossary 明确指出 `RequirementWorkspace` 正是"**工作分支(Branch)**"的现实雏形(每人对一个 WorkItem 的独立工作面)。两条口径不冲突,分工是:`Branch`(§6.1)持有**内容头指针 + 合并语义**(走 Proposal→merge),而 `RequirementWorkspace` 退化为 `pm` 模式下被派活者的**执行进度面板**(phase/进度/阻塞,不参与合并)。迁移时字段原样保留、FK 改名 `work_item_id`;`human` 分支的 `Branch.actor_user_id` 与 `RequirementWorkspace.user_id` 同源,可一对一关联。

### 4.4 现有:`AcceptanceCriteria`(验收清单)

`RequirementAcceptanceItem`([`models.py:464`](../../../app/models.py)):`requirement_id`、`title`、`description`、`status`(`open|…`)、`sort_order`、`source_plan_id`(FK→task_plan)。
**关键演进**:验收清单**逐条命中率**是 §7.3 `ConfidenceRecord` 置信度的主信号之一(PRD §8.2 信号③)。`status` 状态域扩展为 `open | met | unmet | waived`,供分级算法逐条求"清单全过率"。

> 现有 `RequirementTaskPlan` / `RequirementTaskItem`([`models.py:425/448`](../../../app/models.py))= 拆解/排期产物(`stage: dispatch|worker`)。WorkHub 中 `pm` 模式的 AI 项目经理用它生成"派活+排期"提案,沿用字段,FK 改名。

---

## 5. `WorkItem` 状态机(全转移,锚定 PRD §7.1)

现有 `Requirement.status` 字符串域([`models.py:328-330`](../../../app/models.py)):
`draft | clarifying | summary_ready | ready | ai_processing | claimed | doing | delivery_doc_pending | delivered | revision_requested | accepted | cancelled`。

WorkHub 演进为 AI-native 状态域(下表给出**新状态 ← 旧状态**的映射,迁移见 §9.5):

| WorkHub 状态 | 含义 | 映射旧 `Requirement` 状态 |
|---|---|---|
| `intake` | 刚进系统,未澄清 | `draft` |
| `ai_clarifying` | AI 澄清需求中 | `clarifying` |
| `spec_ready` | 规格(README)就绪 | `summary_ready` / `ready` |
| `ai_working` | AI 工人执行中(默认态) | `ai_processing` / `claimed` / `doing` |
| `escalated` | 升级触发,准备转 pm | (新) |
| `pm_mode` | 项目经理模式:派活→人做 | (新;复用人侧 `doing`) |
| `in_review` | 负责人审 Proposal | `delivered` / `delivery_doc_pending` |
| `merged` | 已汇入 main | `accepted` |
| `done` | 收尾(可派生后续) | `accepted`(终态细分) |
| `cancelled` | 取消 | `cancelled` |
| (横切)`reject` 不是状态 | 打回是 `Review.decision`,回灌后退回 `ai_working` | `revision_requested` |

**全转移表**(`*` = 可由多源进入;括号内是触发器/守卫):

| From | To | 触发 / 守卫 |
|---|---|---|
| `intake` | `ai_clarifying` | 提交后自动澄清 |
| `ai_clarifying` | `spec_ready` | 澄清完成,README 生成 |
| `ai_clarifying` | `cancelled` | 用户/owner 取消 |
| `spec_ready` | `ai_working` | 默认派给 AI 工人(`human_reserved=false`);创建 `Branch`(actor=AI)+ `AgentRun` |
| `spec_ready` | `pm_mode` | `human_reserved=true` 或无可执行工人 → 直接走人 |
| `ai_working` | `in_review` | **confidence: high**:`AgentRun` 完成 → `ConfidenceRecord(grade=high)` → 自动生成 `Proposal`(按策略可自动 `merged`,见下) |
| `ai_working` | `in_review` | **confidence: medium**:生成 `Proposal` + 标记需人工抽检 |
| `ai_working` | `escalated` | **confidence: low / high_risk / blocked**:三触发器或 doom-loop/超预算(§7.4) |
| `ai_working` | `ai_working` | 工具调用循环内自旋(不换状态,增 `AgentStep`) |
| `escalated` | `pm_mode` | `EscalationEvent` 落库 → AI 切 `mode=pm`,生成派活+排期简报(FR-PM-001) |
| `pm_mode` | `in_review` | 被派的人完成 → AI 协助整理为 `Proposal`(FR-PM-003) |
| `pm_mode` | `cancelled` | owner 取消 |
| `in_review` | `merged` | `Review.decision=approve` → 合并 `Branch` 入 main(写 `WorkItem.main_branch_id`,`Snapshot` 落地) |
| `in_review` | `ai_working` | `Review.decision=reject`(**必须带 `reason_md`**)→ 理由回灌,**同分支续做**(FR-ESC-003),不新建 Branch |
| `in_review` | `pm_mode` | `reject` 且裁定 `reassign` → 改派 |
| `merged` | `done` | 无后续派生,收尾;`done_at` 置位 |
| `merged` | `intake` | 派生后续 WorkItem(新行,`source_requirement_id` 指向本行) |
| 任意非终态 | `cancelled` | owner/submitter 取消(终态) |

**高置信自动合并策略(`ai_working → in_review → merged` 可一跳)**:仅当 `ConfidenceRecord.grade=high` **且** `risk_level=low` **且** 项目策略允许 auto-merge **且** `PermissionPolicy` 对该 merge 动作判定为 `allow`(非 `ask`)时,`in_review` 可被系统自动 `approve`;否则停在 `in_review` 等人抽检/审批。对用户始终呈现"AI 拟好了,确认?"而非术语。

**边界与失败处理**:
- **状态写入并发**:`status` 变更走 §9.4 乐观锁 CAS(`WHERE version=:v`),失败 → 重读重试一次,再失败报 409,避免两个 AgentRun/审批者撞写。
- **非法转移**:转移表外的 (from,to) 一律拒绝并落 `AuditLog`。现有实现是显式 `allowed: dict[str, set]` 转移表 + `HTTPException(400, "cannot change status from {old} to {new}")`([`requirements.py:272-287`](../../../app/routers/requirements.py));WorkHub 沿用该表驱动范式,建议把状态码细化为 `422 invalid_transition`(语义更准:请求格式合法但状态不可达),迁移期保留 400 兼容旧客户端。
- **里程碑通知**:状态变更**同事务**写 `Notification`,**提交后**才发 SSE——沿用现有 `lifecycle.queue_status_notifications`([`lifecycle.py:104`](../../../app/services/lifecycle.py),不 commit 不 publish)/ `flush_status_notifications`([`lifecycle.py:164`](../../../app/services/lifecycle.py),commit 后才推、吞 bus 异常)的"先入库后推送"约定,保证通知与状态原子一致。`_MILESTONES`([`lifecycle.py:31`](../../../app/services/lifecycle.py))现仅覆盖 `claimed/delivered/delivery_doc_pending/accepted/revision_requested/cancelled`——WorkHub 新增态(`escalated`/`pm_mode`/`in_review`/`merged`)须补登记,否则升级/合并里程碑静默无通知。
- **取消的幂等**:`cancelled` 为终态;重复取消是 no-op(`dedupe_key=f"{new_status}:{req.id}:{actor.id}"` 防重复通知,沿用 [`lifecycle.py:159`](../../../app/services/lifecycle.py))。

---

## 6. 协作层:Branch / Proposal / Review / Spec(L3 核心,去黑话)

> 术语**仅存在于库与 daemon 内部**;UI 文案映射见 [glossary](../00-overview/glossary-dejargon.md) 与 PRD §8.5(branch→"工作副本",proposal→"提交确认",merge→"采纳")。

### 6.1 新增:`Branch`(工作分支)

某协作者**或某 AI 工人**对某 WorkItem 内容的独立工作副本(PRD §7 核心新增)。多 actor 各自一支,互不阻塞(FR-COLLAB-001)。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `work_item_id` | FK→work_items.id, CASCADE, index | |
| `actor_kind` | str(16) | `human` / `ai`(谁的分支) |
| `actor_user_id` | FK→users.id?, index | human 分支的人;ai 分支为 NULL |
| `agent_run_id` | FK→agent_runs.id?, index | ai 分支对应的执行(§7.1) |
| `kind` | str(16), default `work` | `work`(工作副本) / `main`(正式版,每 WorkItem 一条) |
| `base_snapshot_id` | FK→snapshots.id?, index | 从哪个 main 快照拉出(三方合并的 base) |
| `head_ref` | str(128) | 当前内容指针(指向底层 content store / drive 版本集) |
| `status` | str(16), default `open` | `open` / `proposed` / `merged` / `abandoned` / `superseded` |
| `version` | int, default 0 | 乐观锁(head 推进 CAS) |
| `created_at`/`updated_at` | DateTime | |

> **内容存于何处**:branch 的"改动"不直接进结构化列,而是引用 §10 的 Drive 版本家族(`ProjectDriveVersion`,内容寻址 `sha256` + `storage_path`)与 §6.5 `SpecDoc`。`Branch` 只持有头指针 + 元数据,合并语义按内容类型分派(文档 vs 结构化记录,PRD §8.5 开放项,详见 `03-collaboration/branch-proposal-merge.md`)。

### 6.2 新增:`Proposal`(提议 = 去黑话的 PR)

一个分支请求合并入 main 的变更集(PRD §7 核心新增)。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `work_item_id` | FK→work_items.id, CASCADE, index | |
| `branch_id` | FK→branches.id, CASCADE, index | 来源分支 |
| `round` | int | 第几轮提议(打回续做后 +1;与 §6.4 `Delivery.round` 对齐) |
| `title` | str(256) | |
| `summary_md` | Text | "AI 做了什么/为什么"的人话说明(可解释,FR-EXPLAIN-001) |
| `diff_manifest` | JSONB `[]` | 变更清单(新增/改/删的 drive item + 版本号),供审阅渲染 |
| `confidence_id` | FK→confidence_records.id?, index | 这轮提议的分级裁决(§7.3) |
| `status` | str(16), default `opened` | `opened` / `reviewed` / `rejected` / `merged` |
| `merge_snapshot_id` | FK→snapshots.id?, index | 合并成功后产生的 main 新快照 |
| `opened_by_kind` | str(16) | `ai` / `human` / `system` |
| `opened_by_user_id` | FK→users.id? | |
| `created_at`/`updated_at` | DateTime | |
| `UniqueConstraint` | `(branch_id, round)` | 一支一轮一提议 |

### 6.2.1 新增:`AcceptedDeliverableChange`(正式采纳账本,R1 最小物理语义)

> **R1 当前实现表**：`accepted_deliverable_changes`。它是 Proposal merge 的正式采纳账本，用来证明“哪些 manifest change 已经进入正式版”，并为同 target 并发覆盖提供冲突 gate。2026-06-09 后，AgentRun-backed delivery 已接最小 `ProjectDriveItem.current_version_id` / `ProjectDriveVersion`：accepted row 会保存 `drive_item_id` 与 `drive_version_id`；WorkItem page 与 AgentRun replay 可展示 accepted deliverables，并提供下载/文本预览；R1.8 已补最小还原入口，把当前 Drive 指针恢复到上一版 accepted row 并写审计。R1.16 起，`ai_fusion` 可先物化为 Markdown 融合稿，走同一 accepted ledger / Drive version / merge snapshot / audit 链路；R1.17 起，冲突卡里的“采用 AI 融合稿”点击本身即可作为人工选择写入 `merge_proposals.chosen_*`，不再要求用户先点 choose 再点 apply；R1.19 起 `text_doc/spec_doc` 的候选正文直接写入正式 Drive version；R1.20 起候选 prompt 可读取 current/incoming/base 真实文本摘录；R1.24 起无重叠文本 hunk 会由 deterministic line diff3 先生成；R1.25 起重叠 hunk 会把 conflict ranges 写入 LLM prompt 与 quality gate；无重叠 hunk 即使无 LLM 时也可审计。字段级结构化写回、重叠 hunk 逐项确认/编辑、富预览与完整 Drive 历史 UI 仍按后续切片推进。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `work_item_id` | FK→work_items.id, CASCADE, index | 所属事项 |
| `proposal_id` | FK→proposals.id, CASCADE, index | 哪个提议被采纳后产生 |
| `branch_id` | FK→branches.id?, SET NULL, index | 来源工作副本 |
| `change_id` | UUID | `DeliverableChange.id` |
| `target_kind` | str(32) | `binary_doc/text_doc/spreadsheet/slide_deck/image/folder/structured_record/...` |
| `target_entity_type` | str(32) | `work_item/drive_item/delivery/spec_doc/folder/external` |
| `target_entity_id` | UUID? | manifest 中的 `target_ref.entity_id` |
| `target_path` | str(512)? | manifest 中的 `target_ref.path` |
| `target_key` | str(768), index | 稳定合并键：`entity_type + entity_id/path/change_id` |
| `change_type` | str(32) | `created/updated/deleted/renamed/moved/replaced/generated` |
| `accepted_version` | int, default 1 | 同 target 的正式版递增序号 |
| `base_version_ref` | str(128)? | `version_before` 或 `sha256_before` |
| `accepted_ref` | str(512)? | `version_after` / `sha256_after` / preview href / change id |
| `drive_item_id` | FK→project_drive_items.id?, SET NULL, index | AgentRun-backed delivery 采纳后的正式 Drive 文件节点 |
| `drive_version_id` | FK→project_drive_versions.id?, SET NULL, index | AgentRun-backed delivery 采纳后的正式 Drive 文件版本 |
| `sha256_before` / `sha256_after` | str(64)? | 文件类冲突 gate |
| `preview_ref_json` | JSONB? | manifest preview ref |
| `manifest_change_json` | JSONB | 原始 `DeliverableChange` 快照 |
| `superseded_at` | DateTime? | null 表示当前正式版 |
| `created_at`/`updated_at` | DateTime | |

R1 冲突 gate：

- incoming 带 `sha256_before` 时，必须等于 current accepted row 的 `sha256_after`。
- incoming 带 `version_before` 时，必须等于 current accepted row 的 `accepted_ref`。
- `created/generated` 同 target 已存在且 sha 不同，返回 409 `merge_conflict`。
- `updated/replaced/deleted` 缺 before ref 时保守 409，避免静默覆盖正式版。

R1 delivery adoption：

- `apps/api/src/workers/agent-runner.ts` 在自动打开 Proposal 时传入 `agentRunId`，写入 `branches.agent_run_id`。
- `apps/api/src/services/proposals.ts` merge 前读取 `AgentRun.workdir_ref`，从 `target_ref.path` 定位源文件，校验路径边界、文件存在与 sha256。
- `packages/db/src/repositories/proposals.ts` 在 merge transaction 内创建/复用 Drive 文件夹树 `AI Deliverables/{workItemCode}/outputs/...`，追加 `ProjectDriveVersion`，前移 `ProjectDriveItem.current_version_id`，并把 Drive 指针写回 accepted row。
- `packages/db/src/repositories/work-items.ts` 读取 WorkItem detail 时左连 current accepted rows 与 Drive item/version；`WorkItemDetailVM.accepted_deliverables[]` 暴露下载/文本预览 href，但不暴露 `storage_path`。

R1 delivery restore：

- `AcceptedDeliverableVM.restore_href` 只在 `accepted_version > 1` 时出现，避免首版交付物给出必失败动作。
- `POST /api/workitems/{id}/deliverables/{acceptedChangeId}/restore` 在事务内校验 `ProjectDriveItem.current_version_id == accepted.drive_version_id`；若当前版本已被其它动作前移，返回 409。
- 还原动作将当前 accepted row 标记 `superseded_at`，把上一版同 target / 同 drive item 的 accepted row 重新设为 current，并把 `ProjectDriveItem.current_version_id` 指向上一版 `ProjectDriveVersion`。
- 还原本身写 `ProjectDriveOperation(op_type="restore_version")` 与 `AuditLog(action="accepted_deliverable.reverted")`；这是 R1 最小审计语义，不等同于完整 Drive 历史/redo UI。

### 6.2.2 新增:`MergeAttempt`(合并尝试与冲突选择审计,R1.11)

> **R1.11 当前实现表**：`merge_attempts`。它记录每次 `POST /api/proposals/{id}/merge` 的冲突检测结果：默认 merge 被 gate 挡住时写 `result="conflict"`；用户通过 `accept_incoming` option 显式带回 target key 后，成功采纳时写 `result="merged"`，并把 `merge_attempt_id`、`accepted_incoming_target_keys`、`resolved_conflict_target_keys` 写入 `AuditLog(action="proposal.merged").detail_json`。这一步只落 file-only deterministic 两选一的审计事实；LLM 融合候选仍由后续 `MergeProposal` 切片补齐。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | 单次尝试 |
| `proposal_id` | FK→proposals.id, CASCADE, index | 被尝试合并的变更申请 |
| `work_item_id` | FK→work_items.id, CASCADE, index | 冗余作用域，便于 replay/audit 查询 |
| `branch_id` | FK→branches.id?, SET NULL, index | 来源工作副本 |
| `actor_kind` / `actor_user_id` | str / FK→users.id? | 谁触发本次尝试 |
| `result` | str(16), index | `conflict` / `merged` / `aborted` / `clean`；R1.11 实际写 `conflict|merged` |
| `merge_snapshot_id` | FK→snapshots.id?, SET NULL, index | 成功 merge 时关联的 merge snapshot |
| `conflicts_json` | JSONB `[]` | 被阻断的冲突，或成功时已由用户选择接收 incoming 的冲突 |
| `accepted_target_keys` | JSONB `[]` | 本次请求显式选择采纳 incoming 的 target keys |
| `target_keys` | JSONB `[]` | 本次 proposal 涉及的全部 target keys |
| `conflict_count` | int | `conflicts_json.length`，便于看板聚合 |
| `created_at` | DateTime | |

R1.11 审计规则：

- 409 `merge_conflict` 不能只返回给前端，必须留下 `merge_attempts.result="conflict"`，否则事后无法解释“为什么没有交付”。
- 成功 merge 也必须留下 `merge_attempts.result="merged"`；若是带 `accept_incoming_target_keys` 的二次 merge，`conflicts_json` 记录这些已解决冲突。
- `proposal.merged` audit detail 必须带 `merge_attempt_id`，把正式采纳账本、merge snapshot 与用户选择串起来。
- `MergeAttempt` 不替代 `accepted_deliverable_changes`：前者证明“当时怎么决策”，后者证明“最终哪些版本进了正式版”。

### 6.2.3 新增:`MergeProposal`(冲突候选方案,R1.12)

> **R1.12/R1.25 当前实现表**：`merge_proposals`。它挂在 `merge_attempts` 下，一行对应一个 `conflict_key` 的候选方案集合。R1.12 先持久化 deterministic `keep_current` / `accept_incoming` 两个候选；默认推荐 `keep_current`，用户显式采纳 incoming 后写 `chosen_option_key="accept_incoming"`、`chosen_by_user_id`、`chosen_at`。R1.14 已允许 API service 传入 `ai_fusion` 候选补充，写入同一 `candidates_json`，并可带 `source="llm"`、`quality_gate` 与 `merged_value`；R1.15 已提供 `POST /api/merge-proposals/{id}/choose` 把任一候选选择写入 `chosen_*` 字段。R1.16 已提供 `POST /api/merge-proposals/{id}/apply`，把 `merged_value` 物化为正式 Markdown 融合稿并写入 accepted ledger。R1.17 把端侧路径收敛为一键采用：若原 row 仍未选择且 candidate 是 `ai_fusion`，apply 会先写原 row 的 `chosen_option_key="ai_fusion"`、`chosen_by_user_id`、`chosen_at`，再物化；若原 row 已选择其它候选则 409。R1.19 起 `text_doc/spec_doc` apply 直接写候选正文；R1.20 起生成候选前，service 会读取 current accepted Drive 文本、incoming workdir 文本、可匹配的 base accepted 文本作为 `content_context`；R1.21 起 `quality_gate.text_patch_preview` 保存 current -> merged patch preview 与 overlap risk；R1.22 起 replay renderer 会显示该 preview；R1.23 起 `ProposalConflictOption.quality_gate` 会把同一 preview 下沉到 409 / `/conflicts` 的 `ai_fusion` option，Proposal 冲突卡可在采用前显示最小 diff；R1.24 起 `text_doc/spec_doc` 在 base/current/incoming 均可用且未截断时先跑 deterministic line diff3，无重叠 hunk 直接写入 `source="diff3"`、`quality_gate.text_diff3` 与 `merged_value.merged_text`，重叠 hunk 会继续 LLM/人工路径，并携带 R1.25 的结构化冲突块 metadata。Cuu/Web 仍保持 option-first 点击模型，AI 不替用户做裁决。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `merge_attempt_id` | FK→merge_attempts.id, CASCADE, index | 属于哪次合并尝试 |
| `conflict_key` | str(768), index | 对应 `ProposalConflict.target_key` / `ConflictItem.key` |
| `candidates_json` | JSONB `[]` | `[{option_key,target_kind,merged_value?,rationale_md,source?,quality_gate?}]`；R1.12 写保留正式版/采纳这次版本，R1.14 可追加 `ai_fusion` |
| `recommended_option_key` | str(64)? | deterministic 默认 `keep_current`；R1.14 起 LLM 方案通过质量门时可推荐 `ai_fusion`，但不自动选择 |
| `chosen_option_key` | str(64)? | 人最终选择；未选择时为 null；R1.15 起可由 choose endpoint 写入 `ai_fusion` 等候选；R1.17 起 apply 未选择的 `ai_fusion` 会先回写原 row，再在新的 merged attempt row 里保留 `chosen_option_key="ai_fusion"` |
| `chosen_by_user_id` | FK→users.id?, SET NULL, index | 谁做了选择 |
| `chosen_at` | DateTime?, index | 何时选择 |
| `created_at`/`updated_at` | DateTime | |

R1.12 审计规则：

- 默认 409 时，`merge_proposals.chosen_option_key` 为空，证明系统只给出候选，没有替用户做决定。
- 带 `accept_incoming_target_keys` 成功 merge 时，相关 `conflict_key` 的 row 写 `chosen_option_key="accept_incoming"` 与决策人。
- R1.13 起，`GET /api/agent-runs/{id}/replay` 已读取 `merge_attempts + merge_proposals` 并返回 `merge_timeline[]`，用于展示“当时有哪些候选、推荐哪个、最终谁选了什么”。
- R1.14 起，`ai_fusion` 候选由 API service 的 `MergeFusionCandidateGenerator` 生成并传给 repository；repository 只负责与 deterministic 候选合并、去重和持久化，不直接调用 LLM。
- R1.15 起，候选选择由 repository 的 `chooseMergeProposalCandidate()` 原子写入 `chosen_option_key/chosen_by_user_id/chosen_at`；已选择其他候选后禁止覆盖。
- R1.17 起，`applyMergeProposalCandidate()` 会重新校验 proposal 仍为 `reviewed`、候选为 `ai_fusion`、candidate 带 `merged_value`。若原 row 尚未选择，apply 将本次点击视为人工选择并回写 `chosen_option_key="ai_fusion"`、`chosen_by_user_id`、`chosen_at`；若原 row 已选择其它候选则返回 409。随后写 `snapshots(kind=merge)`、`merge_attempts(result="merged")`、新的 `merge_proposals(chosen_option_key="ai_fusion")`、`accepted_deliverable_changes`、`ProjectDriveVersion` 与 `AuditLog(action="proposal.merged", merge_strategy="ai_resolved")`。
- 当前 `ai_fusion` 写回对 `text_doc/spec_doc` 已是候选正文直写，对其它目标仍是保守 Markdown artifact。R1.20 已把真实 current/incoming/base 文本摘录喂给候选生成，R1.21 已在 candidate `quality_gate` 中持久化 text patch preview，R1.22 已在 Replay 页面渲染该 preview，R1.23 已在 Proposal 冲突卡显示采用前最小 diff，R1.24 已对无重叠文本 hunk 自动生成 `source="diff3"` candidate；但它仍不是字段级原位 patch、重叠 hunk 逐项确认/编辑或 React route 级富 patch viewer。真正把融合内容写回结构化记录字段、编辑/确认重叠 hunk，需要后续 `ai_resolved` v2 切片。
- 现有 `ProposalConflict.options[]` 仍是用户面入口；`merge_proposals` 是 replay、后续调解页与 LLM 候选的持久真相源。

### 6.3 演进:`Review`(对 Proposal 的通过/打回,自 `RevisionRequest`)

现有 `RevisionRequest`([`models.py:535`](../../../app/models.py))只建模"打回":`requirement_id`、`delivery_id`、`requested_by_nickname`、`reason_md`(NOT NULL——**打回必须带理由**,正是 PRD §8.2 触发器②/FR-ESC-003 的数据基础)。WorkHub 泛化为对称的 `Review`(通过 + 打回都建模):

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `proposal_id` | FK→proposals.id, CASCADE, index | |
| `work_item_id` | FK→work_items.id, CASCADE, index | (冗余便于查询) |
| `reviewer_kind` | str(16) | `human` / `ai`(AI 主审,PRD §8.1) |
| `reviewer_user_id` | FK→users.id?, index | |
| `decision` | str(16) | `approve` / `reject` |
| `reason_md` | Text | **`reject` 时 NOT NULL**(应用层校验);`approve` 可选附言 |
| `reason_fed_back_at` | DateTime? | 打回理由已回灌给 AI 的时间(§5 `in_review→ai_working` 闭环标记) |
| `created_at` | DateTime | |

> 命中率(§3.3)= `approve` / (`approve`+`reject`) 按 reviewer 维度聚合;打回理由(`reason_md`)既驱动回灌纠偏,又是升级触发器②的证据。

### 6.4 现有:`Delivery`(交付包,按 round 版本化)

`Delivery`([`models.py:515`](../../../app/models.py)):`requirement_id`、`round`(int)、`package_path`、`package_size`、`package_sha256`、`file_count`、`delivery_doc_md`、`notes`、`submitted_by_nickname`;`UniqueConstraint(requirement_id, round)`。WorkHub 中 `Delivery` 是 `Proposal` 的**打包产物附件**(一个 approved/merged proposal 可固化为一个 delivery 包),FK 增 `proposal_id?`,`round` 与 `Proposal.round` 对齐。

### 6.5 演进:`SpecDoc`(README = 需求规格活文档)

PRD §8.8 / FR-SPEC-001:每个 WorkItem/项目有自动维护的 README 规格页,演进自 spec 文件夹 + `spec_watch.rs` 同步地基。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `scope_kind` | str(16) | `work_item` / `project` |
| `work_item_id` | FK? / `project_id` FK? | 按 scope 二选一 |
| `body_md` | Text | 规格正文(随澄清/交付自动更新) |
| `content_sha256` | str(64) | 内容寻址,去重(沿用 `spec_watch` 的 sha256 去重范式) |
| `version` | int, default 0 | 乐观锁 + append-only 版本递增 |
| `updated_by_kind` | str(16) | `ai` / `human` |
| `created_at`/`updated_at` | DateTime | |

> 规格页变更也走 Branch→Proposal→merge(FR-SPEC-002),与内容协作一致。

---

## 7. AI 引擎实体(L2 命门)

### 7.1 演进:`AgentRun`(一次 AI 自治执行)

演进自 `auto_agent.run_auto` 的 `AutoResult`([`auto_agent.py:364-381`](../../../app/services/auto_agent.py))+ `BackgroundJob`([`models.py:93`](../../../app/models.py))。把"一次 AI 工人/经理执行"持久化为可审实体(FR-WORKER-002 完整 trace)。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `work_item_id` | FK→work_items.id, CASCADE, index | |
| `branch_id` | FK→branches.id?, index | 该 run 产出落到的分支 |
| `mode` | str(16) | `worker` / `pm`(对应 §4.2 WorkItem.mode) |
| `actor` | str(32) | 执行身份(用于 §8.1 工具菜单过滤 + 审计),如 `ai:worker` |
| `actor_user_id` | FK→users.id?, index | 发起/授权用户；API 读权限以此还原 `actor_id` |
| `title` | str(256), default `AI worker run` | Live VM / 列表显示标题 |
| `status` | str(16), default `queued` | `queued`/`running`/`succeeded`/`failed`/`escalated`/`budget_exhausted`/`cancelled` |
| `model` | str(64) | 实际调用模型(成本治理/路由,NFR-05;现 `settings.llm_model`) |
| `turns_used` | int | 已用步数(现 `MAX_TURNS=15`,[`auto_agent.py:36`](../../../app/services/auto_agent.py)) |
| `max_turns` | int | 硬预算上限(FR-WORKER-003;必填) |
| `total_timeout_s` | int, default 300 | 单 run 总超时预算 |
| `max_tokens` | int, default 120000 | 单 run token 硬预算 |
| `max_cost_cny` | numeric(12,6), default `5` | 单 run 成本硬预算 |
| `budget_decision_json` | JSONB | P-COST 决策、模型路由、预算告警 payload |
| `seconds` | float | 耗时(现 `TOTAL_TIMEOUT_DEFAULT=300`) |
| `token_in`/`token_out` | int | token 计量(成本看板,NFR-11) |
| `cost_estimate` | float? | 估算成本(NFR-05) |
| `outcome_reason` | str(256) | 结束原因短描(现 `AutoResult.reason`) |
| `handoff_md` | Text? | 超预算/卡住时的「已做/未做/下一步」结构化交接件(FR-WORKER-003) |
| `handoff_json` | JSONB? | `StructuredHandoff` 机器可读版本 |
| `workdir_ref` | str(512)? | 沙箱 workdir 引用；revert/审计恢复用 |
| `started_at`/`finished_at` | DateTime? | |
| `created_at`/`updated_at` | DateTime | |

> 沙箱/预算参数(`MAX_SANDBOX_FILES=800`、`MAX_SANDBOX_BYTES=200MB`、`COMMAND_TIMEOUT`、`ALLOWED_COMMANDS` 白名单,[`auto_agent.py:38-46`](../../../app/services/auto_agent.py))是 daemon 运行时常量,不入库;但**每个 AgentRun 必有硬预算上限**(`max_turns`)落库。

### 7.2 新增:`AgentStep`(trace 逐步)

演进自现有 `trace_json`(如 `KnowledgeAskRun.trace_json`,[`models.py:139`](../../../app/models.py))与 `auto_agent` 的 push 事件流。把每步动作落库,使 trace 可审、可回放(FR-WORKER-002)。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `agent_run_id` | FK→agent_runs.id, CASCADE, index | |
| `seq` | int, index `(agent_run_id, seq)` | trace 展示与 replay 排序；同一步可有多条 record |
| `step_no` | int | 第几步(对应 opencode runLoop 的 step++) |
| `phase` | str(32) | `think` / `tool_call` / `tool_result` / `final` |
| `tool_name` | str(64)? | 工具名(`list_files`/`read_file`/`write_file`/`run_command`/`submit`…,见 `auto_agent.TOOLS`) |
| `input_json` | JSONB | 工具入参(schema 校验失败→回灌可恢复错误,不崩) |
| `output_excerpt` | Text | 工具输出(截断;现 `COMMAND_OUTPUT_LIMIT=12000`) |
| `control_signal` | str(16)? | `continue`/`stop`/`compact`/`escalate`(借鉴 opencode 控制信号) |
| `snapshot_id` | FK→snapshots.id?, index | 该步副作用前的快照(§7.5;可回滚单步) |
| `created_at` | DateTime | |

> 注意：`step_no` 是语义步号，不唯一。同一次模型 step 可能产生 `think`、多个 `tool_call`、多个 `tool_result` 与最终 `final` record；唯一约束会截断真实 trace，因此排序以 `seq` 为准。

### 7.3 新增:`ConfidenceRecord`(置信度 + 风险 + 分级裁决,命门)

PRD §8.2 / FR-ESC-001。每次产出生成一条,驱动 §5 的 confidence 分叉。算法信号见下规则表(对用户**以人话呈现,不暴露数值**)。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `work_item_id` | FK→work_items.id, CASCADE, index | |
| `proposal_id` | FK→proposals.id?, index | 关联提议(若已生成) |
| `agent_run_id` | FK→agent_runs.id?, index | 产出该结果的 run |
| `confidence_score` | float | 0–1 综合置信度 |
| `risk_score` | float | 0–1 综合风险 |
| `grade` | str(8) | `high` / `medium` / `low`(置信度档) |
| `risk_level` | str(8) | `low` / `medium` / `high` |
| `verdict` | str(16) | 分级裁决:`auto_merge` / `human_spotcheck` / `escalate`(§5 三分叉) |
| `signals_json` | JSONB | 各信号原值(见下表),可解释/可标定 |
| `rationale_md` | Text | 人话理由("我比较有把握,但建议你扫一眼") |
| `created_at` | DateTime | |

> ⚠️ 枚举一致性:R0 后 `grade`/`risk_level` 权威值统一为 `medium`,与现有 `Requirement.estimate_confidence` 的 `low\|medium\|high` 正则([`schemas.py:227/250`](../../../app/schemas.py))和 [glossary §3.3](../00-overview/glossary-dejargon.md) 对齐。旧 `mid` 只作为兼容读别名,生产 contract 不再新增,并把新档同步登记到 `shared/src/design/status-vocab.ts` 的人话标签,避免用户面漏出裸枚举。

**置信度信号表**(PRD §8.2;v1 以 ②③ 为主、① 为辅、④ 随数据接入):

| # | 信号 | 来源 | v1 权重 |
|---|---|---|---|
| ① | AI 自评分 | 模型自报 | 辅 |
| ② | `llm_review` 判分 | `auto_agent.llm_review`([`auto_agent.py:544`](../../../app/services/auto_agent.py),返回 `(bool, str)`) | 主 |
| ③ | 验收清单逐条命中率 | `AcceptanceCriteria.status`(§4.4)`met/总数` | 主 |
| ④ | 历史校准 | `CollaborationGraph.hit_rate`(§3.3) | 待数据 |

**风险维度**(PRD §8.2 开放,需与业务方共定权重,落 `signals_json.risk.*`):可逆性、对外性、金额/合规敏感度、影响人数。

**分级裁决规则表**(对齐 PRD §8.2):

| `grade` × `risk_level` | `verdict` | §5 去向 |
|---|---|---|
| high + low(review 过 + 清单全过 + 低风险) | `auto_merge` | 自动 Proposal,策略允许则自动 merge |
| medium / 部分不确定 / 中风险 | `human_spotcheck` | Proposal + 人工抽检(快速通过/打回) |
| low / high_risk / blocked / doom-loop / 超预算 | `escalate` | 创建 `EscalationEvent`,转 pm |

### 7.4 新增:`EscalationEvent`(升级事件,命门)

PRD §8.2 / FR-ESC-002:三触发器任一命中 → 落库 + 切 `WorkItem.mode=pm`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `work_item_id` | FK→work_items.id, CASCADE, index | |
| `agent_run_id` | FK→agent_runs.id?, index | 触发时的 run |
| `confidence_id` | FK→confidence_records.id?, index | 触发的裁决 |
| `trigger` | str(24) | `unqualified`(llm_review 不过)/ `user_unsatisfied`(打回)/ `user_forbidden`(人工保留)/ `doom_loop` / `budget_exhausted` |
| `reason_md` | Text | 为什么升级(人话简报种子,FR-PM-001) |
| `handoff_json` | JSONB | 交接件(已做/未做/下一步 + 上下文,承接 `AgentRun.handoff_md`) |
| `suggested_lead_user_id` | FK→users.id?, index | AI 建议的负责人(派活产出,§8.4) |
| `resolved_at` | DateTime? | pm 模式处置完成 |
| `created_at` | DateTime | |

**三触发器 ← 现有零件映射**(PRD §17.2):① 不合格 ← `llm_review` 判分不过(`auto_agent.py:544`);② 用户不满意 ← `Review.decision=reject`(自 `RevisionRequest`);③ 用户明确不让 ← `WorkItem.human_reserved` / 项目级 / 用户级三档开关(FR-ESC-005)。额外自动信号:`doom_loop`(连续 N 步相同动作,由 §7.2 `AgentStep` 检测)、`budget_exhausted`。

### 7.5 新增:`Snapshot`(AI 副作用执行前快照,安全红线)

PRD §8.1 / FR-WORKER-004 / NFR-04:借鉴 opencode"每步 git 快照",AI 对业务数据的每次副作用生成可 revert 的快照。**对用户隐藏 git 黑话**——内部用 git 机制,呈现为"撤销/回滚"。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `work_item_id` | FK→work_items.id, CASCADE, index | |
| `branch_id` | FK→branches.id?, index | |
| `kind` | str(16) | `pre_step`(步前) / `merge`(合并点) / `manual` |
| `ref` | str(128) | 底层快照引用(git commit hash / content-store ref) |
| `content_sha256` | str(64)? | 内容寻址校验 |
| `created_by_kind` | str(16) | `ai` / `human` / `system` |
| `reverted_at` | DateTime? | 已回滚标记(沿用现 `ProjectDriveOperation.undone_at` 的 undo 范式,[`models.py:222`](../../../app/models.py)) |
| `created_at` | DateTime | |

---

## 8. 权限 / 审批 / 审计(L5 治理,借鉴 opencode)

### 8.1 新增:`PermissionPolicy`(分层 allow/deny/ask)

PRD §8.6 / FR-PERM-001:分层 `org → workspace → role → session` 合并的 allow/deny/**ask(默认就问)** 通配规则。演进自现有硬编码的 `services/permissions.py`([`permissions.py:50-119`](../../../app/services/permissions.py),`can_view/can_claim/can_work…`)——把"代码里的 if"外化为"数据里的规则"。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `scope_kind` | str(16) | `org` / `workspace` / `role` / `session`(分层来源) |
| `scope_id` | str(64) | 对应 scope 的主体 id(org_id/workspace_id/role 名/session id) |
| `action_pattern` | str(128) | 工具/动作通配(`tool.write_file`、`merge.*`、`run_command:*`) |
| `effect` | str(8) | `allow` / `deny` / `ask`(**未匹配默认 `ask`**) |
| `priority` | int | 同层冲突的解析序;`deny` 通常压 `allow` |
| `learned_from_session` | bool, default false | "永远允许"沉淀成的自动规则(FR-PERM-003) |
| `created_by_user_id` | FK→users.id? | |
| `org_id`/`workspace_id` | FK?, index | 租户作用域 |
| `deleted_at` | DateTime?, index | |
| `created_at`/`updated_at` | DateTime | |

**合并算法**(运行时,详见 `security-and-permissions.md`):按 `org → workspace → role → session` 收集匹配 `action_pattern` 的规则 → 同优先级 `deny` > `ask` > `allow` → **无匹配落 `ask`**。`is_admin`(§3.1)在迁移期作为最高优先级 allow 兜底。

### 8.2 新增:`ApprovalRequest`(审批阻塞原语 + 路由)

PRD §8.6:审批 = 阻塞原语(工具在"该决策那一刻" `ask` 人,阻塞至回复)。演进自现有 `lifecycle.py` 的状态推进 + 通知中枢——但把"审批"提升为一等实体,补 opencode 没有的**审批路由 + SLA + 委派**(护城河)。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `work_item_id` | FK→work_items.id?, index | |
| `agent_run_id` | FK→agent_runs.id?, index | 阻塞中的 run |
| `action_pattern` | str(128) | 触发审批的动作(命中 `PermissionPolicy.effect=ask`) |
| `payload_json` | JSONB | 待批动作的入参快照(供审阅) |
| `status` | str(16), default `pending` | `pending`/`approved`/`denied`/`expired`/`delegated` |
| `routed_to_user_id` | FK→users.id?, index | 路由到谁批(按角色/负责人/项目,FR-PERM-002) |
| `decided_by_user_id` | FK→users.id?, index | 实际决策人 |
| `decision_reason_md` | Text? | **拒绝带理由 → 回灌 AI 下一步上下文**(PRD §8.6) |
| `delegated_to_user_id` | FK→users.id?, index | 委派目标(FR-PERM-003) |
| `sla_due_at` | DateTime?, index | 超时 SLA;到期未响应触发升级/重路由 |
| `created_at`/`updated_at` | DateTime | |

### 8.3 新增:`AuditLog`(按身份全量审计,治理)

PRD §7 / FR-PERM-004 / NFR-03:所有 AI/人动作按身份记录,可追溯、可回滚。演进自现有 `ActivityLog`([`models.py:554`](../../../app/models.py),`requirement_id`/`actor_nickname`/`action`/`detail_json`)与 `ProjectDriveOperation`([`models.py:214`](../../../app/models.py),`op_type`/`payload_json`/`undone_at`)——统一为全实体审计:

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `org_id`/`workspace_id` | FK?, index | 租户作用域(按租户审计 + NFR-08 隔离) |
| `actor_kind` | str(16) | `human` / `ai` / `system` |
| `actor_user_id` | FK→users.id?, index | 人/触发 AI 的人;`actor_nickname` 冗余展示 |
| `entity_type` | str(64), index | 被作用实体表名(`work_item`/`proposal`/`drive_item`…) |
| `entity_id` | str(64), index | 被作用实体 id |
| `action` | str(64), index | 动作(`status_change`/`merge`/`write_file`/`approve`…) |
| `detail_json` | JSONB | 前后值/差异/上下文 |
| `snapshot_id` | FK→snapshots.id?, index | 关联回滚点(§7.5) |
| `undone_at` | DateTime? | 已回滚标记(沿用 `ProjectDriveOperation.undone_at` 范式) |
| `created_at` | DateTime, index | append-only;不可改 |

> `AuditLog` **不软删**(治理证据须不可篡改);仅按保留策略归档。

---

## 9. SQLite → PostgreSQL 迁移要点(D-2)

PRD NFR-01 / D-2:逃离 SQLite 单 worker 天花板(现 `db.py` 注释明示 `database is locked`、WAL+busy_timeout 仅是缓解,[`db.py:22-39`](../../../app/db.py)),迁到 PG 支撑多 Agent + 多人并发与业务对象合并的行级锁。

### 9.1 连接与引擎
现有 `db.py` 已对非 SQLite 友好:`pool_pre_ping=True` 已就绪,`connect_args` 仅在 sqlite 注入 `check_same_thread`,SQLite-only 的 `PRAGMA`(WAL/busy_timeout/foreign_keys)在 `event.listens_for(...connect)` 钩子内([`db.py:8-39`](../../../app/db.py))。迁移:`settings.database_url` 切 `postgresql+psycopg://…`,该钩子自动不触发;新增连接池配置(`pool_size`/`max_overflow`)。**daemon 不再受"必须单 worker"约束**,可多 worker/多协程并发。

### 9.2 UUID 主键
- **现状**:`id = String(32)` 存 `uuid4().hex`(32 位无连字符 hex)。
- **PG**:列类型升级为原生 `UUID`(`sqlalchemy.dialects.postgresql.UUID(as_uuid=False)` 或 `Uuid`),应用层仍可生成。**迁移期**:用 `::uuid` 显式转换把 32-hex 文本转为 UUID;ID 值不变,仅类型与索引效率提升。FK 列同步改 `UUID`。

### 9.3 约束与索引
- **外键 + 级联**:现有 `ondelete="CASCADE"`/`"SET NULL"` 在 PG 原生强制(SQLite 需 `PRAGMA foreign_keys=ON` 才生效;PG 默认强制,更可靠)。
- **唯一约束**:沿用现有 `UniqueConstraint`(`uq_delivery_req_round`、`uq_requirement_assignment_user`、`uq_knowledge_source`、`uq_project_drive_version_no` 等),新增 `(branch_id, round)`、`(org_id, slug)` 等。
- **索引**:保留现有热点 index(`status`、`*_user_id`、`deleted_at`、`dedupe_key`);PG 下对 `JSONB` 列按需建 `GIN` 索引(`skill_tags`、`diff_manifest`、`signals_json` 查询)。
- **部分索引**:对软删除可用 PG 部分索引(`WHERE deleted_at IS NULL`)加速"活行"列表。
- **大字段**:`size_bytes` 现已用 `BigInteger`(PG `bigint`),无需改。

### 9.4 并发:乐观锁 + 行级锁(对象合并的地基)
- **乐观锁**:可变业务对象(`WorkItem`/`SpecDoc`/`Branch`)新增 `version: int`,写入 `UPDATE … SET version=version+1 WHERE id=:id AND version=:expected`;命中 0 行 → 冲突 → 重读/报 409。SQLAlchemy 可用 `__mapper_args__ = {"version_id_col": version}`。
- **行级锁**:合并/审批等强一致路径用 `SELECT … FOR UPDATE`(PG 原生,SQLite 不支持)锁住 WorkItem + 其 main branch 头,串行化合并,杜绝双写丢更新。
- **JSON 计数器去 race**:现 `Project.next_seq` 在 SQLite 单 worker 下安全;PG 多 worker 下编号自增须走行级锁或 PG `SEQUENCE`,避免 `PROJ-001` 撞号。

### 9.5 数据迁移与回填
1. **建模工具**:延续 Drizzle Kit(新仓 P0 引入),为新增表/列出迁移脚本。
2. **租户回填**:为 `Org`/`Workspace` 建默认行,所有现有 `Project`/`WorkItem` 等回填 `workspace_id`(NOT NULL 前先回填再加约束)。
3. **状态映射**:按 §5 映射表把旧 `Requirement.status` 批量改写为新状态域(`UPDATE` + CASE);旧值留 `AuditLog` 备查。
4. **`Requirement`→`WorkItem` 重命名**:表/FK 改名(`requirement_id`→`work_item_id`),或保留物理表名 `requirements`、仅 ORM 类改名以降低迁移风险(二选一,详见 `tech-stack-and-migration.md`)。
5. **软删除补列**:为缺 `deleted_at` 的表(如 `Requirement`)加列,默认 NULL。
6. **JSON→JSONB**:`Text` JSON 列 `USING col::jsonb` 转换。
7. **校验**:迁移后跑引用完整性检查(无悬空 FK)、唯一约束去重预检。

---

## 10. 沿用的现有实体(原样迁移,FK 改名)

下列实体 WorkHub **原样迁移**(字段不变,仅 `requirement_id`→`work_item_id`、补 `workspace_id`/`deleted_at`、JSON→JSONB),不在本篇展开;模块细化见 `04-modules/`:

- **Drive 家族**:`ProjectDriveItem` / `ProjectDriveVersion` / `ProjectDriveOperation` / `ProjectDriveComment`([`models.py:167/192/214/228`](../../../app/models.py))——文件树/版本(内容寻址 `sha256`)/操作日志(`undone_at` 回滚)/评论触发 LLM(`status: pending_llm`)。是 §6.1 `Branch` 内容的底层载体。
- **会议家族**:`MeetingRecord` / `MeetingInsight`([`models.py:269/291`](../../../app/models.py))——音频→纪要→洞察→需求草稿(`created_requirement_id`)。
- **知识家族**:`KnowledgeDocument` / `KnowledgeAskRun`([`models.py:110/128`](../../../app/models.py))——grep 语料(无向量库,D-4)+ 强制引用问答(`citations_json`/`trace_json`)。
- **通知/排期/后台**:`Notification`(`dedupe_key` 去重,[`models.py:146`](../../../app/models.py))/ `ScheduleEvent`([`models.py:250`](../../../app/models.py))/ `BackgroundJob`([`models.py:93`](../../../app/models.py),被 `AgentRun` 部分吸收为执行编排)。
- **附件/会话/评论**:`Attachment` / `ChatMessage`(`content_json` 多态 payload)/ `Comment`([`models.py:479/498/545`](../../../app/models.py))。

---

## 11. ER 关系(文字版)

> 实线 = FK 强引用;`?` = 可空;`*` = 一对多。完整 OpenAPI 形态见 `api-contract.md`。

```
Org 1—* Workspace 1—* Project 1—* WorkItem
User 1—1 UserProfile
User 1—* ClientDevice
(User × User) —* CollaborationGraph边(聚合,非 FK 表)

WorkItem 1—* Assignment(role: lead|collaborator)→ User
WorkItem 1—* Branch(actor_kind: human|ai)
WorkItem 1—1 SpecDoc(current_spec_id 头指针) / Branch(main_branch_id 头指针)
WorkItem 1—* AcceptanceCriteria
WorkItem 1—* RequirementTaskPlan 1—* RequirementTaskItem   (pm 模式拆解/排期)
WorkItem 1—* RequirementWorkspace 1—* (Item / ProgressUpdate)  (人侧执行视图)

Branch 1—* Proposal(UniqueConstraint branch_id+round)
Proposal 1—* Review(decision: approve|reject; reject 必带 reason_md)
Proposal 1—* AcceptedDeliverableChange(正式采纳账本;current row = superseded_at is null)
Proposal 1—? Delivery(打包产物;round 对齐)
Proposal —? ConfidenceRecord

WorkItem 1—* AgentRun(mode: worker|pm)
AgentRun 1—* AgentStep(index run_id+seq; step_no is semantic, not unique)
AgentRun —? ConfidenceRecord —? (drives §5 verdict)
ConfidenceRecord ——(verdict=escalate)→ EscalationEvent
AgentStep —? Snapshot   /   Proposal.merge —? Snapshot

PermissionPolicy(scope: org|workspace|role|session) ——(effect=ask)→ ApprovalRequest
全实体 写动作 ——→ AuditLog(actor_kind: human|ai|system; —? Snapshot 可回滚)
```

---

## 12. 边界条件与失败处理(汇总)

| 场景 | 处理 |
|---|---|
| 两个 AgentRun / 审批者并发改同一 WorkItem | 乐观锁 CAS(§9.4),失败重读一次→ 409 + `AuditLog` |
| 合并冲突(同对象并发改) | AI 调解给合并建议,人择一(FR-COLLAB-003);语义按内容类型分派,见 `03-collaboration/branch-proposal-merge.md` |
| 打回但缺理由 | 应用层拒绝(`Review.reason_md` 必填);保证 §5 回灌闭环有上下文 |
| AgentRun 超预算 / doom-loop | 强制产出 `handoff_md` 结构化交接(FR-WORKER-003),状态→ `escalated`,不静默截断 |
| 工具入参 schema 校验失败 | 回灌"请改输入"可恢复错误(`AgentStep.phase=tool_result`),不崩(沿用 `auto_agent` 现行为) |
| 非法状态转移 | `422 invalid_transition` + `AuditLog` |
| 软删用户仍被历史行引用 | 保留行(`deleted_at`),列表/选人器过滤;授权用 `*_user_id` 防昵称重用继承(§1.4) |
| 通知与状态不一致 | 同事务入库、提交后推 SSE(沿用 `lifecycle` 约定,§5) |
| 权限未匹配任何规则 | 默认 `ask`(§8.1),阻塞建 `ApprovalRequest` |
| 跨用户私有事件泄漏 | 私有事件按 `actor_user_id`/租户隔离(NFR-08),`AuditLog`/SSE 主题按身份过滤 |
| 编号(`PROJ-NNN`)多 worker 撞号 | 行级锁或 PG `SEQUENCE`(§9.4) |

---

*下一步:本篇定字段与约束;读写它们的路由组 + 事件类型在 [`api-contract.md`](./api-contract.md),进程/事件流在 [`system-architecture.md`](./system-architecture.md),运行时权限/审计语义在 [`security-and-permissions.md`](./security-and-permissions.md),迁移执行清单在 [`tech-stack-and-migration.md`](./tech-stack-and-migration.md)。*
