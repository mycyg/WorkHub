---
component: F02
title: F02 实体与模型移植 — 系统级实现 Plan
status: active
depends: [F1]
date: 2026-06-05
type: feat
origin: docs/plans/2026-06-05-feat-workhub-p0-foundation-master-plan.md
spec:
  - docs/workhub/01-architecture/data-model.md
  - docs/plans/p0-foundation/_experience-deliverable-contracts.md
  - docs/plans/p0-foundation/_ts-first-module-port-page-alignment.md
inventory: docs/plans/p0-foundation/_migration-inventory.md §2
code_root: D:/02_代码与开发/需求管理大师 (app/models.py)
---

# F02 实体与模型移植 — 系统级实现 Plan

> 本 plan 是 Master Plan §5「组件表」F2 行的系统级展开,代码级依据见迁移清单 §2(数据层)。
> 所有"现有"字段锚定真实代码 `app/models.py`(行号经本次核验)。**严守 Master §6 九铁律**,逐条在 §回滚与风险标注命中。
> 上游契约以 [data-model.md](../../workhub/01-architecture/data-model.md) 为准;凡跨组件共享字段语义(状态机、租户列、快照引用),本 plan **不重定义**,仅落 ORM 形态并深链规格。Proposal 的交付物变更说明另以 [`_experience-deliverable-contracts.md`](./_experience-deliverable-contracts.md) 的 `DeliverableChangeManifest v0` 为准。

---

## 目标

把现有「需求管理大师」的 **28 个 SQLAlchemy ORM 实体**(`app/models.py`,核验为 28 个 `class …(Base)`,Master「35 实体」为含人侧子表/沿用家族的概数)**结构化迁入** WorkHub 的 `app/models/` 包,并完成三件 AI-native 地基改造:

1. **横切列补齐**:为可变业务实体补 `version`(乐观锁)、`deleted_at`(软删除)、`org_id`/`workspace_id`(租户作用域),消灭 `Requirement` 等表缺软删/版本列的不一致。
2. **`Requirement → WorkItem` 演进**:ORM 类改名 + 全部 `requirement_id` FK 改名 `work_item_id`,新增 AI-native 字段(`mode`/`human_reserved`/`current_spec_id`/`main_branch_id`/`latest_confidence_id`),并把状态串域演进为新状态机(状态映射在 F3 数据迁移落地,本组件只定 ORM 形态与转移表常量)。
3. **新增 15 个 AI-native 实体**:`Org`/`Workspace`/`UserProfile`/`Branch`/`Proposal`/`Review`(自 `RevisionRequest`)/`SpecDoc`/`AgentRun`/`AgentStep`/`ConfidenceRecord`/`EscalationEvent`/`Snapshot`/`PermissionPolicy`/`ApprovalRequest`/`AuditLog`。

**本组件交付的是"声明式 ORM 模型层 + PG 就绪的列类型/约束/关系",不含运行期逻辑**(Alembic 迁移脚本与数据回填属 F3;权限合并算法属 F6;Agent 引擎读写属 F8;通知登记属 F9;快照运行时属 F10)。本组件为它们提供**正确的表结构地基**。

> 成功判据:`import app.models` 全图可加载(关系/FK 互引无环错),`Base.metadata` 能在一张空 PG 上由 F3 的 Alembic 首迁移建出全部表,且 28 个旧实体的既有字段/约束**零语义丢失**。

---

## 范围

### In(P0 本组件必做)

- 28 个现有实体逐类移植到 `app/models/` 分模块包,字段/约束/关系**逐列保真**。
- `Requirement`→`WorkItem` 类改名;**全仓 `requirement_id`→`work_item_id`** 的 ORM 侧改名(物理表名 `requirements`→`work_items`,FK 目标随改)。
- 横切列:`version` / `deleted_at`(+`deleted_by_user_id`) / `org_id`+`workspace_id` 按实体分级补齐(分级清单见 §数据与接口契约)。
- 新增 15 个 AI-native 实体的 ORM 声明(字段、FK、唯一约束、关系、索引意图)。
- PG 列类型就绪声明:`String(32)` PK→`Uuid`、`Text`-JSON→`JSONB`、`DateTime`→`DateTime(timezone=True)`(timestamptz)、`is_admin` server_default 修正——**以声明形态就绪,真实建表/转换在 F3**。
- `WorkItem`/`SpecDoc`/`Branch` 配置 `__mapper_args__={"version_id_col": version}`(乐观锁就绪)。
- 状态转移表常量(`ALLOWED_TRANSITIONS: dict[str, set[str]]`)与新状态枚举常量,作为模型层单一真相导出,供 F8/F9/路由消费。
- `estimate_confidence` / `grade` / `risk_level` 枚举统一为 `low|medium|high`(消灭 `mid` 漂移,见风险)。

### Out(明确推迟到 P1+,或归属其他 P0 组件)

- **Alembic 配置 + 首迁移脚本 + 数据回填/状态映射**(`UPDATE…CASE`、租户回填、`USING ::jsonb`、`requirements`→`work_items` 物理改名 DDL)→ **F3**。
- **`CollaborationGraph` 物化视图/聚合表**(data-model §3.3,聚合自审计/交付,**MVP 推迟**)→ P1(派活)。
- 权限合并算法、`PermissionPolicy` 运行时求值 → **F6**(本组件只建表)。
- `AgentRun` 队列/心跳/行锁恢复语义、`AgentStep` 写入时机 → **F8**(本组件只建表)。
- `_MILESTONES` 新状态登记、approver 通知路由 → **F9**(本组件只提供状态枚举/转移表)。
- `Snapshot` revert 运行时、"快照失败⇒拒副作用"红线、同事务快照写 → **F10**(本组件只建 `Snapshot`/`AuditLog`/审计列)。
- `JSONB` 的 `GIN` 索引、`WHERE deleted_at IS NULL` 偏索引、`PROJ-NNN` 的 PG `SEQUENCE`/行锁 → **F3**(索引/序列是迁移期 DDL 决策;本组件标注索引意图)。
- 真凭证替昵称、跨 Org 公网隔离 → **P5**。

---

## 现状 → 改动(按 PORT / REFACTOR / NEW 分组)

> 锚点为 `app/models.py:line`。"现状"经本次 grep 核验:28 个 `class …(Base)`(`models.py:27..554`);`requirement_id`/`requirements.id` 在 **app/ 下 30 文件 317 处**(`models.py` 内 19 处 FK + 7 处自/交叉引用)。

### PORT —— 逐列保真移植(28 实体,禁止顺手重构)

| 实体 | 锚点 | 移植要点(保真不变式) |
|---|---|---|
| `User` | `models.py:27` | `nickname` unique+index、`cookie_token` unique、`is_admin` index、`deleted_at` 墓碑、`display_name` 剥离 `_deleted_<id8>_` 属性(`:45-54`)**逐字保留**——身份双写不变式(Master §6.4 关联 F4) |
| `ClientDevice` | `models.py:57` | `client_token_hash` unique+index、`revoked_at` index、`user_id` FK CASCADE——**设备令牌门载体,逐字移植**(Master §6.4) |
| `Project` | `models.py:71` | `slug` unique、`owner_user_id`(授权真相,注释 `:78-81` 保留)、`next_seq`(`:87`)、`archived`、软删三件套;`requirements`/`drive_items` 关系 `cascade="all, delete-orphan"` |
| `BackgroundJob` | `models.py:93` | 原样移植;`AgentRun`(NEW)部分吸收其执行编排语义,但 `BackgroundJob` **本组件保留**(meetings/knowledge 仍用) |
| `KnowledgeDocument` / `KnowledgeAskRun` | `models.py:110/128` | `uq_knowledge_source`、`citations_json`/`trace_json`(→JSONB)、`content_hash` 内容寻址 |
| `Notification` | `models.py:146` | `dedupe_key` index(`:158`)幂等去重不变式(Master §6.7);`requirement_id`→`work_item_id`(`:157`) |
| `ProjectDriveItem/Version/Operation/Comment` | `models.py:167/192/214/228` | **内容寻址 `sha256`**、`uq_project_drive_version_no`、`undone_at`(`:222`,现有唯一 undo 原语)、`status=pending_llm`——是 §Branch 内容底层载体,原样移植 |
| `ScheduleEvent` | `models.py:250` | `participant_user_ids_json`(→JSONB)、`requirement_id`→`work_item_id` |
| `MeetingRecord` / `MeetingInsight` | `models.py:269/291` | 三处 `requirements.id` SET NULL FK(`:274/300/305`)→`work_items.id`;`created_requirement_id` 溯源链保留 |
| `RequirementAssignment` | `models.py:363` | `uq_requirement_assignment_user`→`uq_work_item_assignment_user`;`role=lead|collaborator`;派活产出落本表 |
| `RequirementWorkspace`/`Item`/`ProgressUpdate` | `models.py:378/396/408` | 人侧执行视图;data-model §4.3 定其为 `pm` 模式执行面板(不参与合并),字段原样、FK 改名 |
| `RequirementTaskPlan` / `RequirementTaskItem` | `models.py:425/448` | `stage=dispatch|worker`;pm 模式拆解/排期产物,FK 改名 |
| `RequirementAcceptanceItem` | `models.py:464` | `status` 域**扩展** `open|met|unmet|waived`(data-model §4.4,喂 ConfidenceRecord 信号③);FK 改名 |
| `Attachment` / `ChatMessage` / `Comment` | `models.py:479/498/545` | `content_json`(→JSONB)、`size_bytes` BigInteger(PG bigint 无需改);FK 改名 |
| `Delivery` | `models.py:515` | `uq_delivery_req_round`→`uq_delivery_work_item_round`;**新增 `proposal_id?` FK**,`round` 与 `Proposal.round` 对齐(data-model §6.4) |
| `RevisionRequest` | `models.py:535` | **不直接 PORT**——演进为 `Review`(见 NEW);`reason_md` NOT NULL 语义保留为 `Review` 的 reject 校验 |
| `ActivityLog` | `models.py:554` | **不直接 PORT**——演进为 `AuditLog`(见 NEW);`actor_nickname`/`action`/`detail_json` 语义吸收 |

> PORT 红线:`User.display_name` 墓碑逻辑、`Project.owner_user_id` 授权注释、drive `undone_at`/`sha256` 范式、`Notification.dedupe_key`——属"已验证安全/正确性资产",**复制不重写**(Master §6.4)。

### REFACTOR —— 改名 + 列类型 PG 化 + 横切列

1. **`Requirement`→`WorkItem`(类改名,牵动最广)**
   - 现状:`class Requirement`(`models.py:314`),`__tablename__="requirements"`,状态串域(`:328-330`)。
   - 改动:类名 `WorkItem`、表名 `work_items`;`status` default 改新域 `intake`(data-model §5 映射);新增字段见 §契约。
   - **FK 改名扇出**:`models.py` 内 19 处 `requirements.id` FK(`:116/157/241/255/274/300/305/342/368/383/412/429/468/483/502/520/539/549/558`)→ `work_items.id`,列名 `requirement_id`→`work_item_id`;自引用 `source_requirement_id`(`:341`)→`source_work_item_id`、`draft_requirement_id`(`:240`)/`created_requirement_id`(`:304`)/`target_requirement_id`(`:299`)同步改名。
   - **跨文件扇出(非本组件改逻辑,但需协调)**:`requirement_id` 出现于 **30 个 app/ 文件 317 处**;本组件负责 **模型 + Pydantic schema 字段名**;**路由/服务的属性引用改名属 F11 的 API 面对等**,本组件在交付物附"改名影响文件清单"交接 F11(见 §依赖)。
   - **降险选项(留给 F3 决策)**:物理表可保留名 `requirements` 仅改 ORM 类(data-model §9.5.4 二选一);本组件**默认按"表名也改 `work_items`"声明**,F3 若选保留物理名则在迁移层做 `__tablename__` 覆盖,模型代码不受影响。

2. **PG 列类型就绪(声明形态,真实转换在 F3)**
   - `id: String(32)`(全表 PK,`default=uid`)→ `Mapped[str] = mapped_column(Uuid(as_uuid=False), …)`;`uid()`(`models.py:12`)保留(应用层生成 hex,PG 列 `UUID`,data-model §9.2)。
   - 所有 `Text` JSON 列(`citations_json`/`trace_json`/`content_json`/`detail_json`/`participant_user_ids_json`/`payload_json`)→ `JSONB`(`from sqlalchemy.dialects.postgresql import JSONB`),应用层去掉手工 `json.dumps/loads`(default 由 `"[]"`→`list`/`dict`)。
   - 所有 `DateTime`(含 `TimestampMixin` `:20-24`、各里程碑时间戳)→ `DateTime(timezone=True)`(timestamptz),消灭 naive(Master §6.2;`utcnow` 清零属 F3,本组件保证**列类型 aware**)。
   - `is_admin`(`models.py:38`)server_default 在 PG 下为 `false`(SQLAlchemy `default=False` 已对;F3 迁移确认 DDL `DEFAULT false`,本组件不写 `DEFAULT 0`)。

3. **横切列补齐**(分级清单见 §契约表)
   - `version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)` + `__mapper_args__={"version_id_col": version}`,加于 `WorkItem`/`SpecDoc`/`Branch`(data-model §1.7/§9.4)。
   - `deleted_at`(index)+ `deleted_by_user_id`(FK?)加于缺失的 `WorkItem`(现 `Requirement` 无)及其余可变业务实体(`Project`/`User`/drive 已有则保留)。
   - `org_id`/`workspace_id`(FK?, index)加于横切实体(`Project` 加 `workspace_id`;`WorkItem`/`PermissionPolicy`/`AuditLog`/`AgentRun` 带租户列,data-model §3.4)。

4. **`RequirementAssignment` 等 `uq_*` 约束改名**:`uq_requirement_assignment_user`→`uq_work_item_assignment_user` 等,保持唯一语义不变。

### NEW —— 新增 15 个 AI-native 实体(`app/models/` 新模块)

> 字段定义以 data-model 对应 §为唯一真相,本 plan 落 ORM 形态并标注 §锚点。建议分模块文件(见 §实施步骤)。

| 实体 | 规格 § | 关键 ORM 要点 |
|---|---|---|
| `Org` | §3.4 | `slug` unique;`plan` default `lan`;软删 |
| `Workspace` | §3.4 | `org_id` FK CASCADE;`UniqueConstraint(org_id, slug)`;软删 |
| `UserProfile` | §3.2 | `user_id` FK unique CASCADE(1:1);`skill_tags`/`availability_pref` JSONB;`onboarded_at?` |
| `Branch` | §6.1 | `work_item_id` FK CASCADE;`actor_kind`、`actor_user_id?`、`agent_run_id?`、`kind=work|main`、`base_snapshot_id?`、`head_ref`、`status`、`version`(+`version_id_col`) |
| `Proposal` | §6.2 + experience §3 | `branch_id` FK CASCADE;`round`;`diff_manifest` JSONB(**必须承载 `DeliverableChangeManifest v0`,覆盖文档/表格/PPT/图片/文件夹/结构化记录**);`confidence_id?`、`merge_snapshot_id?`;`UniqueConstraint(branch_id, round)` |
| `Review`(自 `RevisionRequest`) | §6.3 | `proposal_id` FK CASCADE;`decision=approve|reject`;`reason_md`(reject 时应用层 NOT NULL);`reason_fed_back_at?`、`reviewer_kind` |
| `SpecDoc` | §6.5 | `scope_kind=work_item|project`;`work_item_id?`/`project_id?` 二选一;`content_sha256`、`version`(+`version_id_col`) |
| `AgentRun` | §7.1 | `work_item_id` FK CASCADE、`branch_id?`;`mode`、`actor`、`status`、`model`、`turns_used`、`max_turns`(必填)、`token_in/out`、`cost_estimate?`、`handoff_md?` |
| `AgentStep` | §7.2 | `agent_run_id` FK CASCADE;`step_no`、`phase`、`tool_name?`、`input_json` JSONB、`output_excerpt`、`control_signal?`、`snapshot_id?`;`UniqueConstraint(agent_run_id, step_no)` |
| `ConfidenceRecord` | §7.3 | `work_item_id`/`proposal_id?`/`agent_run_id?`;`confidence_score`/`risk_score` float、`grade`/`risk_level`(**`low|medium|high`**)、`verdict`、`signals_json` JSONB、`rationale_md` |
| `EscalationEvent` | §7.4 | `work_item_id`/`agent_run_id?`/`confidence_id?`;`trigger`(枚举 `unqualified\|user_unsatisfied\|user_forbidden\|doom_loop\|budget_exhausted`,**以 data-model §7.4 为准**;api-contract §2.7 写作 `user_rejected` 属表述漂移,API 面对等由 F11 收敛到本枚举)、`reason_md`、`handoff_json` JSONB、`suggested_lead_user_id?`、`resolved_at?` |
| `Snapshot` | §7.5 | `work_item_id`/`branch_id?`;`kind=pre_step|merge|manual`、`ref`、`content_sha256?`、`created_by_kind`、`reverted_at?`(沿用 `undone_at` 范式) |
| `PermissionPolicy` | §8.1 | `scope_kind`/`scope_id`、`action_pattern`、`effect=allow|deny|ask`、`priority`、`learned_from_session`、`org_id?`/`workspace_id?`、软删 |
| `ApprovalRequest` | §8.2 | `work_item_id?`/`agent_run_id?`;`action_pattern`、`payload_json` JSONB、`status`、`routed_to_user_id?`、`decided_by_user_id?`、`decision_reason_md?`、`delegated_to_user_id?`、`sla_due_at?` index |
| `AuditLog`(自 `ActivityLog`+`ProjectDriveOperation`) | §8.3 | `org_id?`/`workspace_id?`、`actor_kind`、`actor_user_id?`+`actor_nickname`、`entity_type`/`entity_id`(index)、`action`(index)、`detail_json` JSONB、`snapshot_id?`、`undone_at?`、`created_at` index;**不软删**(治理证据不可篡改,data-model §8.3) |

---

## 实施步骤(有序、可勾选)

- [ ] **S0 前置(依赖 F1)**:确认 `app/models/` 拟拆包结构(`base.py`/`identity.py`/`tenancy.py`/`work_item.py`/`collab.py`/`agent.py`/`governance.py`/`legacy_family.py`),`app/config.py` 已有 PG/`database_url` 块(F1 交付)。**单文件 `models.py` 拆包是 P0 唯一结构重排,不改字段语义**。
- [ ] **S1 基础设施**:迁 `Base`/`uid()`/`TimestampMixin`(`models.py:12-24`)入 `base.py`;`TimestampMixin` 的 `DateTime`→`DateTime(timezone=True)`;新增 `SoftDeleteMixin`(`deleted_at` index + `deleted_by_user_id?`)、`TenantMixin`(`org_id?`/`workspace_id?` index)、`OptimisticLockMixin`(`version` + `version_id_col`)。
- [ ] **S2 PORT 现有实体(逐类)**:按 PORT 表逐类迁移,**先保字段保真,后改列类型**;每类迁完即 `python -c "import app.models"` 验证可加载。JSON 列改 JSONB、`DateTime`→tz、PK→`Uuid` 在本步统一应用。
- [ ] **S3 `Requirement`→`WorkItem` 改名**:类/表/状态 default 改名;新增 §契约的 AI-native 字段;`version_id_col` 配置。
- [ ] **S4 全仓 FK 改名(`requirement_id`→`work_item_id`)**:`models.py` 内 19 处 FK + 关系 `back_populates`/`foreign_keys` 同步;`uq_*` 约束名改;**产出"跨文件 317 处改名清单"交 F11**(routers/services 的属性引用)。
- [ ] **S5 NEW 实体(15 个)**:按 NEW 表分模块声明;FK 互引按依赖序(`Org`→`Workspace`→…→`Branch`/`AgentRun`→`Proposal`/`ConfidenceRecord`→`EscalationEvent`/`Snapshot`);唯一约束与 index 意图标注。
- [ ] **S6 枚举/常量单一真相**:导出 `WORK_ITEM_STATUSES`、`ALLOWED_TRANSITIONS`(自 data-model §5 全转移表)、`CONFIDENCE_GRADES=("low","medium","high")`、`RISK_LEVELS`、`VERDICTS`、`ESCALATION_TRIGGERS=("unqualified","user_unsatisfied","user_forbidden","doom_loop","budget_exhausted")`(以 data-model §7.4 为准,消灭 api-contract §2.7 的 `user_rejected` 漂移);**统一 `mid`→`medium`**;同步 `shared/src/design/status-vocab.ts` 人话标签(交 F11,本组件出枚举清单)。
- [ ] **S7 Pydantic schema 字段名对齐**:`app/schemas.py` 内 `requirement_id`→`work_item_id`(16 处)、`estimate_confidence` 正则保持 `low|medium|high`(已对,`schemas.py:227/250`)、新实体读写 schema 骨架(详细 API schema 属 F11)。
- [ ] **S8 `DeliverableChangeManifest` 契约接入**:`Proposal.diff_manifest` 的 ORM/Pydantic 类型标为 JSONB/dict,并在 schema docstring / OpenAPI extra 中引用 `_experience-deliverable-contracts.md` §3;不新增表,但交 F8/F10/F11 一份 fixture 清单(`docx/pptx/xlsx/image/folder/structured_record`)。
- [ ] **S9 自检 gate**:① `import app.models` 全图加载无错;② `Base.metadata.sorted_tables` 含全部新旧表且拓扑可建(FK 无悬空);③ 在临时 PG 上 `Base.metadata.create_all()` 冒烟建表成功(仅本组件自检,正式建表走 F3 Alembic);④ grep 确认 `models.py`/`schemas.py` 内无残留 `requirement_id`。
- [ ] **S10 交接产物**:向 F3 交"列类型转换清单 + 状态映射表 + 租户回填点";向 F6/F8/F9/F10 交"对应新实体已就绪 + version_id_col 位置";向 F11 交"FK/字段改名的 317 处跨文件清单 + 枚举词表 + `DeliverableChangeManifest` fixture 清单"。

---

## 数据与接口契约

### 横切列补齐分级清单(本组件落 ORM,DDL/回填在 F3)

| 列 | 加于哪些实体 | 形态 | 规格锚点 |
|---|---|---|---|
| `version` (+`version_id_col`) | `WorkItem`、`SpecDoc`、`Branch` | `Integer default 0 not null` | data-model §1.7/§9.4 |
| `deleted_at` (index) + `deleted_by_user_id?` | `WorkItem`(新补)、其余可变业务实体(已有者保留) | `DateTime(timezone=True)` | §1.3/§4.2 |
| `org_id?` / `workspace_id?` (index) | `Project`(仅 `workspace_id`)、`WorkItem`、`PermissionPolicy`、`AuditLog`、`AgentRun` | `Uuid FK?` | §3.4 |

### `WorkItem` 新增字段(自 `Requirement` 演进,data-model §4.2)

`workspace_id`(FK index)、`version`(int 0)、`mode`(str16 `worker`)、`human_reserved`(bool false)、`current_spec_id`(FK→spec_docs?)、`main_branch_id`(FK→branches?)、`latest_confidence_id`(FK→confidence_records?)、`deleted_at`(index)、`deleted_by_user_id?`。**保留全部现有列**(`models.py:314-360` 逐列)。

### 状态枚举与转移表(模型层单一真相,供 F8/F9/路由)

- 新状态域(data-model §5):`intake|ai_clarifying|spec_ready|ai_working|escalated|pm_mode|in_review|merged|done|cancelled`(`reject` 非状态,是 `Review.decision`)。
- `ALLOWED_TRANSITIONS` 按 data-model §5 全转移表声明;非法转移由消费方(路由/F8)拒绝并落 `AuditLog`(`422 invalid_transition`,迁移期保留 400 兼容,data-model §12)。
- **本组件只导出常量与转移表数据;不实现状态机执行**(执行属 F8;通知登记属 F9)。

### 枚举一致性(消灭漂移,data-model §7.3 ⚠️)

`ConfidenceRecord.grade` / `risk_level` 与 `WorkItem.estimate_confidence` **统一 `low|medium|high`**;`schemas.py:227/250` 现有正则 `^(low|medium|high)$` 为基准,新实体对齐,**禁用 `mid`**。
`EscalationEvent.trigger` 单一真相 = `unqualified|user_unsatisfied|user_forbidden|doom_loop|budget_exhausted`(data-model §7.4);api-contract §2.7 的 `user_rejected` 与 F08 文档措辞统一收敛到 `user_unsatisfied`,API 面由 F11 对齐(本组件导出 `ESCALATION_TRIGGERS` 常量为消费方基准)。

### Alembic 契约(交 F3,本组件不写迁移)

本组件保证 `Base.metadata` 是 F3 `--autogenerate` 的**正确目标**:全部列类型为 PG 原生(`Uuid`/`JSONB`/`timestamptz`),约束/index 在 ORM 声明完整。F3 据此出首迁移 + `requirements→work_items` 改名 DDL + JSON `USING ::jsonb` + 状态 `UPDATE…CASE` + 租户回填 + 软删补列 + 唯一去重预检(data-model §9.5)。

### API / 事件 topic 契约(交 F11/F5,本组件仅命名对齐)

- API 字段改名 `requirement_id`→`work_item_id` 的端点/客户端 hook 对等属 **F11**;本组件出"字段改名清单"。
- 正式事件 taxonomy(`agent_run.started`/`agent_run.step`/`agent_run.escalated`/`proposal.opened`/`permission.ask` 等,见 `_experience-deliverable-contracts.md` §4)由 **F5** 落 topic;本组件提供其载体实体(`AgentRun`/`AgentStep`/`ConfidenceRecord`/`EscalationEvent`/`Proposal`/`ApprovalRequest`)字段就绪。
- `Proposal.diff_manifest` 的 JSON 形态以 `_experience-deliverable-contracts.md` §3 为准;P0 不要求 F2 校验每个字段,但 F11 生成类型和 F8/F10 manifest 生成必须能引用同一 schema。

---

## 验收用例(可测)

1. **全图可加载**:`python -c "import app.models; print(len(app.models.Base.metadata.tables))"` 退出 0,表数 = 28 旧 − 2 演进吸收(`RevisionRequest`/`ActivityLog`)+ 15 新 = **41 张表**(含演进后的 `work_items`),无 `InvalidRequestError`/悬空 FK。
2. **空 PG 建表冒烟**:对临时 PG `Base.metadata.create_all()` 成功;`\d work_items` 含 `version`/`deleted_at`/`workspace_id`/`mode`/`main_branch_id` 等新列且 `version` `NOT NULL DEFAULT 0`。
3. **改名零残留**:`rg "requirement_id|requirements\.id" app/models.py app/schemas.py` **零命中**;`rg "class Requirement\b" app/models` 零命中,`class WorkItem` 命中 1。
4. **列类型 PG 化**:断言 `WorkItem.created_at.type` 为 `DateTime(timezone=True)`;`AgentStep.input_json.type` 为 `JSONB`;`WorkItem.id.type` 为 `Uuid`。
5. **乐观锁就绪**:`WorkItem.__mapper_args__["version_id_col"]` 指向 `version` 列;`SpecDoc`/`Branch` 同。
6. **唯一约束**:`Proposal` 含 `UniqueConstraint(branch_id, round)`;`AgentStep` 含 `(agent_run_id, step_no)`;`Workspace` 含 `(org_id, slug)`。
7. **枚举一致**:`CONFIDENCE_GRADES == ("low","medium","high")`;源码内 `rg "\bmid\b" app/models app/schemas` 在 grade/risk 语境零命中。
8. **审计不软删**:`AuditLog` 无 `deleted_at` 列、有 `created_at` index(`hasattr(AuditLog,"deleted_at") is False`)。
9. **关系往返**:`WorkItem.branches`/`AgentRun.steps`/`Branch.proposals` relationship 双向 `back_populates` 一致(SQLAlchemy `configure_mappers()` 无警告)。
10. **交付物 manifest 载体就绪**:`Proposal.diff_manifest` 是 JSONB/dict,并有至少 6 个 fixture 类型(docx/pptx/xlsx/image/folder/structured_record)可作为 F8/F10/F11 共享测试输入。

---

## 回滚与风险(逐条对照 Master §6 九铁律)

- **R1 改名扇出静默坏(首要风险,Master §6.2/系统影响"API 面对等")**:`requirement_id`→`work_item_id` 涉 **30 文件 317 处**;ORM 漏改 → 加载即报错(快失败,可控);但**路由/服务属性引用漏改**只在运行时炸。缓解:本组件只改模型+schema 字段,产出**完整 317 处清单交 F11**统一改;S8 grep gate 卡 `models.py`/`schemas.py` 零残留。**回滚**:模型层改名是纯结构,git revert 单 commit 可整体回退。
- **R2 类型强转静默出错(Master §6.2,Top 风险 #2)**:naive `DateTime`→timestamptz、`Text`-JSON→`JSONB`、`String(32)`→`Uuid` 的**真实数据转换在 F3**;本组件只改**声明形态**,不触数据,故本组件无静默数据风险,但**必须把声明做对**否则 F3 autogenerate 错。缓解:S2 逐类改 + S8 类型断言(验收用例 4)。
- **R3 软删/版本列不一致**:`Requirement` 现无 `deleted_at`/`version`(`models.py:314-360` 确认),补列后旧行 `version=0`/`deleted_at=NULL` 默认安全;F3 回填确认。
- **R4 乐观锁误配(Master §6.3 单→多 worker)**:`version_id_col` 只加于真正并发合并对象(`WorkItem`/`SpecDoc`/`Branch`),**误加于高频写小表会引入无谓 409**;缓解:严格按 data-model §9.4 三对象,不外扩。
- **R5 安全敏感实体逐字移植(Master §6.4)**:`User.display_name` 墓碑、`ClientDevice.client_token_hash` unique、`Project.owner_user_id` 授权语义——**复制不重写**,改名/拆包不得改这些字段语义。F4/F6 依赖其保真。
- **R6 隐私门载体就绪(Master §6.5)**:`AuditLog`/`Notification` 的 `actor_user_id`/`user_id` + 租户列是 NFR-08"按身份过滤"的**数据基础**;本组件保证列存在且 index,运行时强制属 F5/F10。
- **R7 快照红线载体(Master §6.6)**:`Snapshot`/`AuditLog.snapshot_id`/`AgentStep.snapshot_id` 字段就绪是 F10"快照失败⇒拒副作用"的前提;本组件只建表,**红线运行时属 F10**——本组件不得把 `snapshot_id` 设为 NOT NULL(F10 未落地前会卡死写)。
- **R8 通知不漏(Master §6.7)**:本组件导出新状态枚举/转移表,但**登记 `_MILESTONES` 属 F9**;风险是 F9 漏登记 `escalated/pm_mode/in_review/merged` → 静默漏通知(`lifecycle.py:3-14` 有前科)。缓解:S6 把四个新状态显式列入交接 F9 的清单。
- **R9 事件 taxonomy / provider(Master §6.8/§6.9)**:本组件提供事件载体实体字段就绪(F5 用)、`AgentRun.model`/`token_in/out`/`cost_estimate` 喂 provider 计量(F7/F8 用),本组件不发事件、不调 LLM,故不触此二律,仅保证字段齐备。
- **R10 `Requirement`→`WorkItem` 物理表名二义**:data-model §9.5.4 留"改物理名 vs 仅改 ORM 类"二选一;本组件默认声明 `work_items`,**最终由 F3 拍板**;若 F3 选保留 `requirements` 物理名,本组件改动不变(F3 在迁移层 override `__tablename__`)。回滚成本低。

---

## 依赖与被依赖

**依赖(上游):**
- **F1**(仓库/配置):需 `app/models/` 包结构位、`config.py` 的 PG `database_url`/连接池块、`from sqlalchemy.dialects.postgresql import JSONB/Uuid` 的 PG 依赖(psycopg)就位。F1 未就绪则本组件无法以 PG 列类型声明落地。

**被依赖(下游,本组件是关键路径 `F1→F2→F3→…` 的第二棒):**
- **F3**(PG+Alembic):以本组件 `Base.metadata` 为 autogenerate 目标;接本组件交付的"列类型转换清单 + 状态映射 + 租户回填点 + 改名 DDL 范围"。**F3 直接 gate 在 F2 完成**。
- **F4**(鉴权):依赖 `User`/`ClientDevice` 保真 + `org_id`/`workspace_id` 注入位、AI actor 一等身份字段。
- **F6**(权限):依赖 `PermissionPolicy`/`ApprovalRequest` 建表 + `WorkItem`/`Proposal` 泛化字段。
- **F8**(Agent 引擎):依赖 `AgentRun`/`AgentStep`/`Branch` + `version_id_col`(行锁/乐观锁地基)。
- **F9**(生命周期/通知):依赖本组件导出的状态枚举 + `ALLOWED_TRANSITIONS`;必须登记四个新状态进 `_MILESTONES`。
- **F10**(审计/快照):依赖 `Snapshot`/`AuditLog`/`*.snapshot_id` 字段就绪。
- **F11**(daemon/客户端改接):接本组件"317 处 `requirement_id`→`work_item_id` 跨文件改名清单"+ 枚举词表,做 API 面对等与 `shared/` 类型生成。

---

*本 plan 只定 ORM 模型层与横切列/枚举/约束;读写它们的迁移在 F3、路由/事件在 F5/F11、权限/审计/快照运行时在 F6/F10。字段语义以 [data-model.md](../../workhub/01-architecture/data-model.md) 为唯一真相。*

---

## Target TS paths

> 本组件施工时,旧 `app/models.py` 只作为 behavior source;实体真相落在 Drizzle schema 与 shared contracts。

| 类别 | 目标路径 | 必须产物 | 审计门禁 |
|---|---|---|---|
| DB schema | `packages/db/src/schema/*.ts` | users/projects/work_items/agent_runs/proposals/approval_requests/audit/snapshots 等表 | 新实体不得只存在 route local type |
| relations | `packages/db/src/relations/*.ts` | Drizzle relation helpers | FK 与 data-model 对齐 |
| domain DTO | `packages/contracts/src/domain/*.ts` | `User`, `Project`, `WorkItem`, `AgentRun`, `Proposal` 等 Zod DTO | API/Page VM 只能 import contracts |
| enums/constants | `packages/contracts/src/enums.ts` | 状态机、事件目标、target_kind、risk/verdict 枚举 | 禁止页面/route 手写状态字符串 |

**PR 必答**:说明 `Requirement`→`WorkItem` 的物理表名决策;新增字段必须同时在 `packages/db` 与 `packages/contracts` 出现。Rust 不得直接访问 DB schema。
