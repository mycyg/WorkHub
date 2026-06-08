---
component: F06
title: 权限引擎（Permission Engine）系统级实现 plan
status: draft
depends: [F2, F4]
date: 2026-06-05
master: ../2026-06-05-feat-workhub-p0-foundation-master-plan.md
inventory: ./_migration-inventory.md
specs:
  - ../../workhub/01-architecture/security-and-permissions.md
  - ../../workhub/03-collaboration/review-and-approval.md
  - ./_experience-deliverable-contracts.md
---

# F06 权限引擎（Permission Engine）

> 把"散落在路由里的 `if` 关系检查"演进为**两层门**:① 移植现有 `services/permissions.py` 的 **RBAC 资源门**(纯函数,谁能碰这个资源)——逐字移植、**不放松** admin 读/写/设备不对称;② 新增 opencode 式 **动作门**(`PermissionPolicy` org→workspace→role→session 合并 + 默认 ask + `ApprovalRequest` 阻塞原语 + 路由/SLA/委派 + 工具可见性过滤 + "永远允许"学习)。
> 权威来源:实体字段以 [`data-model.md`] §8.1/§8.2/§8.3 为准;路由/事件名以 [`api-contract.md`] §2.8/§5 为准;本 plan 引用其产物,扩展列均显式标注"待收口"。

---

## 目标

1. **零放松地移植资源门**:`app/services/permissions.py:32-119`(8 个纯函数 + 2 个状态域常量)整体迁入 WorkHub,**逐字保留** admin 读短路/写仍 gated/设备门正交三条已调试不变式(Master §6 铁律4 "安全敏感逐字移植")。现有 18+ 路由/服务调用者的导入语义不变。
2. **建立动作门骨架**:`PermissionPolicy`(四作用域 allow/deny/ask,默认 ask)+ 确定性合并算法(scope 近邻降序 → `deny>ask>allow`)+ `is_admin` 迁移期最高优先 allow-fallback(**不覆盖**资源门写路径的项目活跃约束)。
3. **审批阻塞原语**:`ApprovalRequest`(`tool`/`proposal`/`revision` 三类共用一表)+ 路由(`route_approver`)+ SLA 截止/到期分流 + 委派 + 按身份审计,三铁律(同事务/commit 后推/CAS 防重)直接继承 `lifecycle.py`/`deliveries.py`。
4. **工具可见性过滤**:`visible_tools(actor) = [t for t in ALL_TOOLS if resolve(actor,t.id)!=DENY]`,供 F8 Agent 引擎组装模型可见工具菜单。
5. **"永远允许"学习**:裁决携带 `remember:"always"` → 沉淀 `learned_from_session=true` 的 allow policy(最细作用域、高风险不可学、可撤销可审计)。
6. **审批卡可渲染**:`ApprovalRequest.payload_json` 必须包含足够生成 `AttentionItem` / Cuu 审批气泡的信息(`summary_text`、`risk`、`evidence_refs`、`actions`),不能只存工具原始入参。

**北极星不变式**:权限外化后,既有的"陌生人看不到草稿态工单 / admin 能审计归档项目但不能写归档项目 / admin 不豁免设备门"行为**逐字等价**——以移植前的纯函数为基线回归(Master §9 风险4)。

---

## 范围（Scope）

### In（P0 必须）

- **资源门移植**:`permissions.py` 8 纯函数 + `PRIVATE_REQUIREMENT_STATUSES`/`ASSIGNMENT_EDITABLE_STATUSES` 常量;`Requirement→WorkItem` 改名适配(F2 牵动);依赖的 `services/assignments.py` 关系 helper(`is_assigned_user`/`lead_assignment`/`has_explicit_assignees`)随迁。
- **作用域感知**:函数签名扩 `org_id`/`workspace_id` 谓词(F2 提供 Org/Workspace 实体),但**判定语义不变**。
- **动作门**:`PermissionPolicy` 实体 + Drizzle 迁移 + `resolve(actor,tool,args)→effect` 合并算法 + 默认 ask。
- **审批原语**:`ApprovalRequest` 实体 + Drizzle 迁移 + 状态机(`pending/approved/denied/expired/delegated`)+ CAS 裁决 + `route_approver` 路由表 + SLA 截止计算 + 委派 + "永远允许"沉淀。
- **工具可见性过滤** API(供 F8 调用,本组件出函数,不在 F06 跑 Agent loop)。
- **API 端点**:`GET/POST /api/approvals*`、`GET/PUT /api/permissions`(签名以 api-contract §2.8 为准)。
- **事件**:`permission.ask`(api-contract §5 已定)发布点;扩展事件 `permission.decided/reassigned/expired` 标注待收口。
- **审计挂钩**:每个 approve/deny/delegate/expire 落 `AuditLog`(实体本身归 **F10**,本组件只写行)。

### Out（明确推迟到 P1+ 或归属他组件）

- **SLA 到期后台扫描任务的多 worker 选主实现** → 归 F8/F11 的"后台周期任务域 + leader 选举";F06 只定到期处置语义与 CAS 幂等契约。
- **同步门"阻塞 Runner"的让出-唤醒实现**(`awaiting_approval` 状态 + resume 信号)→ 归 **F8** Agent 引擎(F06 定 `ApprovalRequest` 落库与裁决到达语义,不实现 Runner 挂起)。
- **`Snapshot` 实体与 revert 契约 / "快照失败⇒拒绝副作用"红线** → 归 **F10**(F06 的审批 deny 只触发"理由回灌",回滚衔接点留接口)。
- **置信度/风险 `risk_level` 的计算** → 归 confidence-risk 文档/P2;F06 只**消费** `risk_level` 做 SLA 分档与"高风险不可学"。
- **PM 模式编排 / `EscalationEvent` 的下游处置** → 归 F9/P2;F06 只在"路由失败 no_approver / SLA 超时 approval_timeout"时**创建** EscalationEvent(实体归 F2),不实现其消费。
- **AI 副作用快照、合并语义、双向同步、看板** → P1+(Master §3 Out)。
- **真实凭据替昵称(R1)、egress 封网(R2)、行级 RLS(R5)** → 上云强制项,P5(spec §1.3)。

---

## 现状 → 改动

> 锚点形如 `file:line`,均经实际代码核验(见 inventory §6)。

### PORT（逐字移植，禁止"顺手重构"——Master §6 铁律4）

- **P-1 八个纯函数资源门** `app/services/permissions.py:32-119`:`is_admin:32`、`is_submitter:37`、`is_assignee:41`、`requirement_project_is_active:45`、`can_view_requirement_record:50`、`can_view_requirement_assets:63`、`can_ack_requirement_sync:73`、`can_add_requirement_attachment:83`、`can_manage_requirement_assignees:91`、`can_claim_requirement:106`、`can_work_requirement:114`。无副作用、无 DB session,易测易移。
- **P-2 读/写不对称的语句顺序**(本组件最敏感):
  - **读路径** admin 短路在项目活跃过滤**之前**:`can_view_requirement_record:54`(`if is_admin(user): return True` 先于 `requirement_project_is_active:56`),`can_view_requirement_assets:64`、`can_ack_requirement_sync:76` 同构。
  - **写路径** 项目活跃过滤在 admin 短路**之前**:`can_add_requirement_attachment:84-87`、`can_manage_requirement_assignees:92-95`、`can_claim_requirement:107-109`、`can_work_requirement:115-117`(均 `if not project_is_active: return False` 先于 `if is_admin`)。
  - **此语句顺序是不变式本身**,移植时**逐行比对**,不得为"可读性"调换。
- **P-3 状态域常量** `PRIVATE_REQUIREMENT_STATUSES:28`、`ASSIGNMENT_EDITABLE_STATUSES:29`。
- **P-4 设备门正交于 admin**:`permissions.py:1-21` docstring 明载 "admin 仍需注册设备才能过 `require_local_client`"。设备门本身归 **F4**(`auth.py:172/183/189`),F06 **不得**在资源门里加任何"admin 豁免设备门"逻辑——保持正交。
- **P-5 关系 helper 依赖** `app/services/assignments.py`:`has_explicit_assignees:24`、`is_assigned_user:28`(含 `claimed_by_user_id` 兼容快照)、`lead_assignment:34`。资源门移植须连带这三函数(其余 assignment 写操作归 F2/工作流域)。
- **P-6 审批三铁律的现状先例**:`lifecycle.py` queue-in-tx / flush-post-commit;`deliveries.py:240/294` 的 `.where(status==...)` + `rowcount==0→409` CAS 防重;`request_revision` 的 `RevisionIn.reason_md` `min_length=1`(`deliveries.py:42`)即"deny 必带理由"先例。`ApprovalRequest` 的 CAS/同事务/理由非空**复用**这套,不重新发明。

### REFACTOR（语义保持，做最小必要改动）

- **R-1 `Requirement`→`WorkItem` 改名**:`permissions.py:25` 导入、所有函数形参 `req: Requirement`、字段访问(`req.submitter_user_id`/`req.status`/`req.assignments`/`req.project`)随 F2 改名适配。函数命名建议泛化为 `can_view_record`/`can_work_item`…(保留旧名 thin alias 一个迁移周期,降低 18+ 调用者改动面)。
- **R-2 作用域谓词**:函数签名加可选 `org_id`/`workspace_id`(F4 注入的 actor 上下文);v1 单 Org 下退化为恒真,但签名就位以备 R5 上云行级过滤。**判定逻辑不变**。
- **R-3 调用者改导入**(18+ 处,grep 实证):`attachments.py:30`、`chat.py:19`、`calendar.py:14`、`comments.py:12`、`decompositions.py:26`、`knowledge.py(svc):33`、`deliveries.py:21/61`、`delivery_upload.py:27`、`jobs.py:9`、`meetings.py:31`、`knowledge.py(router):65`、`projects.py:33/80/93`、`project_drive.py:48`、`push.py:19`、`requirements.py:22`、`sync.py:21`、`users.py:11`、`workspaces.py:16`。**改名漏一处 = ImportError(非静默)**,可由测试/启动捕获。提供旧名 alias 可让此步零破坏过渡。
- **R-4 `is_admin` 双角色**:既是资源门短路(保留 P-2 语义),**又**作为动作门合并算法的最高优先级 allow-fallback(spec review §3.2 步骤4)。两者**不同层、不互相覆盖**:资源门写路径的项目活跃约束**不被** allow-fallback 放松(这正是 Master §9 风险4 要防的)。
- **R-5 AI actor 一等化**:现状 `auto.py:224` 伪造 `User(id="ai-auto")` 过资源门。F06 的 `resolve(actor,...)` 与 `route_approver` 须识别 `actor_kind ∈ {human, ai_worker, ai_pm, system}`(F4 提供 `require_actor` DI),AI 发起的审批**不路由回 AI 自己**(对齐 `lifecycle._resolve_recipients` 的 `discard(actor.id)`,`lifecycle.py:93`)。
- **R-6 `is_admin` 列类型**:`models.py:38` `is_admin BOOLEAN DEFAULT 0`(SQLite)→ PG `boolean DEFAULT false`(F3 类型审校;F06 仅消费,不拥有该列)。

### NEW（净新设计）

- **N-1 `PermissionPolicy` 实体**(data-model §8.1):`id`、`scope_kind ∈ {org,workspace,role,session}`、`scope_id`、`action_pattern`(glob)、`effect ∈ {allow,deny,ask}`、`priority:int`、`learned_from_session:bool=false`、`reason`、`created_by`、`expires_at?`、`org_id/workspace_id?`、`version`(乐观锁)、`deleted_at`(软删)。
- **N-2 合并算法** `resolve(actor, tool, args) -> effect`:见"数据与接口契约"。确定性、可审计、默认 ask。
- **N-3 `ApprovalRequest` 实体**(data-model §8.2):`id`、`work_item_id?`、`agent_run_id?`、`kind ∈ {tool,proposal,revision}`[扩展待收口]、`action_pattern`、`payload_json`(JSONB)、`rationale_json?`(JSONB)、`risk_level ∈ {low,medium,high}`[扩展;**枚举与 data-model §7.3 `ConfidenceRecord.risk_level` 同源,统一用 `medium`(非 `medium`),对齐现有 `estimate_confidence` 正则与 glossary**]、`status ∈ {pending,approved,denied,expired,delegated}` default `pending`、`routed_to_user_id?`、`assignee_role?`[扩展]、`decided_by_user_id?`、`decision_reason_md?`、`delegated_to_user_id?`、`sla_due_at?`、`escalation_event_id?`[扩展]、`org_id/workspace_id?`、`TimestampMixin`、`version`。
- **N-3a 审批 payload 体验切片**:`payload_json.ui` 可选但 P0 推荐写入 `{summary_text, reason_text, evidence_refs, risk, affected_targets, requires_desktop}`;F11/Cuu 可直接映射成 `AttentionItem`。原始工具入参保留在 `payload_json.raw_args`,避免 UI 摘要与执行入参混淆。
- **N-4 `route_approver(kind, work_item, action_pattern, risk)`**:按 review §3.3 路由表;硬约束=裁决者须过 `can_view_*`、排除软删用户、排除发起者本人;算不出 → 不入 pending,直接 `EscalationEvent(no_approver)`。
  > **EscalationEvent.trigger 枚举对齐**:data-model §7.4 与 api-contract §2.7 现定 `trigger ∈ {unqualified, user_unsatisfied, user_forbidden, doom_loop, budget_exhausted}`;F06 因审批路由失败/超时新增的 `no_approver`(N-4)、`approval_timeout`(N-5)是**审批侧扩展 trigger 值,标注 [扩展待收口],由 F2/data-model §7.4 收口进枚举**——F06 创建 `EscalationEvent` 时用这两值,但实体/枚举权威归 F2。
- **N-5 SLA**:`sla_due_at = created_at + sla_duration(kind, risk_level)`(review §4.1 默认表);到期分流(`tool`→升级、`proposal`→催办/改派);**超时只朝"找人"降级,绝不放行**。
- **N-6 委派** `delegate(approval, to_user)`:CAS `pending`→经 `delegated` 改 `routed_to_user_id` 回 `pending`;仅当前 `routed_to`/admin 可发起;受让人须过 `can_view_*`。
- **N-7 "永远允许"沉淀**:`respond(remember="always")` → 写 `learned_from_session=true` allow policy(最细作用域、高风险不可学、可撤销可审计)。
- **N-8 工具可见性过滤** `visible_tools(actor)`:供 F8 组装模型可见菜单(`effect==ask` 仍可见,execute 时阻塞)。

---

## 实施步骤（有序可勾选）

### 阶段 A — 资源门移植 + 回归基线（先做,gate 全组件)

- [ ] A1. 移植前先对现 `permissions.py:32-119` 写**特征化回归测试**(submitter/assignee/陌生人/admin × 各状态 × 项目 active/archived 的真值表),作为"不放松"基线。
- [ ] A2. 在 WorkHub 新仓建 `app/services/permissions.py`,逐行移植 8 函数 + 2 常量;`req: Requirement` 形参随 F2 改 `WorkItem`;**保留 P-2 语句顺序**(读 admin 先/写 active 先)。
- [ ] A3. 连带移植 `assignments.py` 的 `has_explicit_assignees`/`is_assigned_user`/`lead_assignment`。
- [ ] A4. 加可选 `org_id`/`workspace_id` 形参(默认退化恒真),判定逻辑不变。
- [ ] A5. 旧名 → 新名提供 thin alias;批量改 18+ 调用者导入(R-3);启动 + 测试捕获遗漏。
- [ ] A6. 跑 A1 基线测试,**真值表逐格等价**方可进阶段 B。

### 阶段 B — 动作门骨架（PermissionPolicy + 合并）

- [ ] B1. 定义 `PermissionPolicy` 实体(N-1)+ Drizzle 迁移(JSONB 不涉,GIN 仅 `action_pattern` 视需要;`deleted_at` 偏索引;`(scope_kind, scope_id, action_pattern)` 复合索引)。
- [ ] B2. 实现 `resolve(actor, tool, args)`:收集匹配 → 排序键 `(scope 特异度 desc, priority desc, pattern 特异度 desc)` → 平级 `deny>ask>allow` → 无匹配 `ask`;`is_admin` 最高优先 allow-fallback(**不覆盖**资源门)。
- [ ] B3. 实现 `visible_tools(actor)`(N-8)。
- [ ] B4. 合并算法单测:覆盖 review §5.3 规则表四行(session allow vs org deny → session 胜;同层 deny vs ask → deny 胜;无匹配 → ask;高风险叠加风险门)。

### 阶段 C — 审批原语 + 路由 + SLA + 委派

- [ ] C1. 定义 `ApprovalRequest` 实体(N-3)+ Drizzle 迁移(`status` 索引、`sla_due_at` 索引、`routed_to_user_id` 索引、`version`)。
- [ ] C2. 创建流程 `create_approval`:策略评估(allow/deny 直接返回,不建审批)→ 仅 `ask` 落 `pending` → `route_approver`(N-4)→ 算不出则 `EscalationEvent(no_approver)`(不入 pending)。
- [ ] C3. 审批 payload 组装(N-3a):写 `payload_json.raw_args` + `payload_json.ui` 摘要;能映射 `_experience-deliverable-contracts.md` 的 `AttentionItem`/`EvidenceRef`,且用户面不暴露内部 tool enum。
- [ ] C4. 裁决 `respond`:CAS `status==pending`(rowcount==0 → 409 "approval race");`deny` 强校验 `reason_md` 非空(min_length=1,否则 422);写 `AuditLog`(同事务);commit 后 publish `permission.decided`。
- [ ] C5. `route_approver` 路由表(review §3.3):`proposal/revision`→提交者(`submitter_user_id`,延续现状);`tool`→lead→owner→admin;硬约束(有权/非软删/排除发起者本人)。
- [ ] C6. SLA:`sla_due_at` 计算(review §4.1 表);到期处置语义(`tool`→`pending→expired` CAS + `EscalationEvent(approval_timeout)`;`proposal`→催办通知 + 二次到期改派)。**后台扫描的多 worker 选主归 F8/F11,F06 定 CAS 幂等契约。**
- [ ] C7. 委派 `delegate`(N-6):CAS、权限校验、`permission.reassigned` 事件、`decided_by` 仍空。
- [ ] C8. "永远允许"沉淀(N-7):`remember="always"` → 写 `learned_from_session=true` policy;护栏(最细作用域 / `risk_level=high` 拒学 / 软删可撤 / 写 AuditLog)。

### 阶段 D — API + 事件 + 审计接线

- [ ] D1. `GET /api/approvals?pending=true`(我的待批,按 `current_user` 过滤 + admin 全见);`POST /api/approvals/{id}/respond`;`POST /api/approvals/{id}/delegate`(签名以 api-contract §2.8 为准)。
- [ ] D2. `GET/PUT /api/permissions?scope=...`(读/写分层策略)。
- [ ] D3. 鉴权门接线:`respond`/`delegate` 需 `current_user` + `routed_to`/admin;**工具门高权限裁决仍受设备令牌门** `require_local_client`(F4)。
- [ ] D4. 事件发布:`permission.ask` 发 `user:<被路由人 id>` + `session:<id>`,**绝不发 `all`**(NFR-08);扩展事件标注待 api-contract §5 收口。
- [ ] D5. 审计:每个 approve/deny/delegate/expire 落 `AuditLog`(实体归 F10,F06 写行,锚点用 `*_user_id` 非昵称)。

### 阶段 E — 集成与门禁

- [ ] E1. 工具可见性过滤接口交付给 F8(契约测试:deny 工具不出现在菜单,ask 工具出现但 execute 阻塞)。
- [ ] E2. 端到端:`tool` ask → 建审批 → 路由 → `permission.ask` 到正确 `user:<id>` → respond allow → resume 信号(F8 消费)/ respond deny → 理由回灌接口。
- [ ] E3. 跨用户隔离测试:A 不能在 `GET /api/approvals` 看到路由给 B 的审批;A 不能订阅 B 的 `permission.ask`。

---

## 数据与接口契约

> 字段名以 data-model.md §8.1/§8.2/§8.3 为唯一权威;此处给机制视角与扩展列(标注待收口)。

### 实体:`PermissionPolicy`(data-model §8.1)

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | UUID PK | `uid()` 迁移期沿用 |
| `scope_kind` | enum(org/workspace/role/session) | 合并优先级 低→高 |
| `scope_id` | str | 对应作用域实体 id |
| `action_pattern` | str(128) | glob,如 `tool.delete_file`/`merge.*`/`run_command:*`/`*` |
| `effect` | enum(allow/deny/ask) | 未匹配兜底 = ask |
| `priority` | int | 同 scope 内冲突排序 |
| `learned_from_session` | bool default false | true=「永远允许」沉淀 |
| `reason` | str? | 去黑话人话 |
| `created_by` | str | 审计:谁定的规则 |
| `expires_at` | datetime? | timestamptz |
| `org_id`/`workspace_id` | FK? index | 作用域(R5 预留) |
| `version` | int | 乐观锁(Master §6 铁律2) |
| `deleted_at` | datetime? | 软删(撤销学习规则) |

### 实体:`ApprovalRequest`(data-model §8.2;扩展列标 *[待收口]*)

`id`、`work_item_id?`、`agent_run_id?`、`action_pattern(128)`、`payload_json(JSONB)`、`status(16) default pending`、`routed_to_user_id?`、`decided_by_user_id?`、`decision_reason_md? (deny 必填)`、`delegated_to_user_id?`、`sla_due_at?`、`created_at/updated_at`、`org_id/workspace_id?`、`version`;*[待收口]* `kind(16)`、`risk_level(8)`、`rationale_json(JSONB)`、`assignee_role(16)?`、`escalation_event_id?`。

`payload_json` 建议分层,既保留执行真相,也给 Cuu/Web 审批卡一眼可读的摘要:

```json
{
  "ui": {
    "summary_text": "AI 想替你改交付包里的 3 个文件,要点头才继续",
    "reason_text": "涉及对外交付,需要确认",
    "risk": { "level": "medium", "human_label": "影响面不小,稳一点" },
    "evidence_refs": [],
    "affected_targets": [],
    "requires_desktop": false
  },
  "raw_args": {}
}
```

### Drizzle 迁移

- 两张新表;`PermissionPolicy` 复合索引 `(scope_kind, scope_id, action_pattern)` + `deleted_at` 偏索引;`ApprovalRequest` 索引 `status`、`sla_due_at`、`routed_to_user_id`。所有时间列 `timestamptz`(Master §6 铁律2);up/down 可逆测试。

### 合并算法（确定性,可审计）

```
resolve(actor, tool, args) -> effect:
  cands = [p for p in policies(active, scope in {org,workspace,role,session})
           if glob_match(p.action_pattern, tool)]
  if not cands:
      if is_admin(actor): return ALLOW        # 迁移期最高优先 allow-fallback
      return ASK                              # ★ 默认就问 (FR-PERM-001)
  best = max(cands, key=lambda p: (
      scope_specificity(p.scope_kind),         # session>role>workspace>org
      p.priority,
      pattern_specificity(p.action_pattern)))  # 精确串 > 短通配
  # 平级冲突 fail-safe:同最高键多条 → effect 强弱 deny>ask>allow
  return strongest_effect(top_tied(cands, best))
```
> **风险门是独立第二道闸**(spec §6.3):即便命中 allow,高风险/不可逆/对外动作仍叠加风险门 → ask/升级。F06 消费 `risk_level`,不计算。

### API（签名以 api-contract §2.8 为准）

| 端点 | 语义 |
|---|---|
| `GET /api/approvals?pending=true` | 我的待批队列(按 `current_user` 过滤;admin 全见) |
| `POST /api/approvals/{id}/respond` | `{decision: allow\|deny, reason_md?, remember?: once\|always}`;CAS `pending→approved/denied`;deny 时 reason_md 必填;`always`→沉淀 |
| `POST /api/approvals/{id}/delegate` | `{to_user_id}`;CAS 经 delegated 改 routed_to 回 pending |
| `GET/PUT /api/permissions?scope=...` | 读/写分层策略(含永远允许、人工保留) |

### 事件（topic + 名以 api-contract §5 为准；Master §6 铁律8 taxonomy）

| 事件 | topic | 触发 |
|---|---|---|
| `permission.ask`(已定) | `user:<被路由人>` + `session:<id>` | →pending 路由后 |
| `permission.decided` *[待收口]* | `workitem:<id>` + `user:<决策人>` | approved/denied commit 后 |
| `permission.reassigned` *[待收口]* | `user:<old>` + `user:<new>` | 委派后 |
| `permission.expired` *[待收口]* | `workitem:<id>` | SLA 到期处置后 |

> **铁律**(继承 `lifecycle.flush_status_notifications:164` + `push_bus`):一律 commit 后 publish;publish 失败吞异常(行已落库);私有事件**绝不发 `all`**(`sse.rs:6-10` 跨用户泄漏事故教训,NFR-08);满队列丢 + 30s 心跳沿用现状。

### 跨组件共享处（以 Master + 规格为准)

- `AuditLog`/`Snapshot`/`EscalationEvent`/`Org`/`Workspace`/`AgentRun` 实体 → **F2/F10/F8 拥有**,F06 仅写行/引用 id。
- 设备令牌门 `require_local_client`/`require_actor`/`current_user` → **F4 拥有**。
- 事件 broker 扇出与 topic 鉴权门 → **F5 拥有**,F06 经其发布。
- SLA 后台扫描 leader 选举 → **F8/F11 拥有**,F06 定 CAS 幂等契约。

---

## 验收用例（可测)

**资源门不放松（基线回归,Master §8/§9 风险4)**

- [ ] AC-1 陌生人对 `status∈{draft,clarifying,summary_ready}` 工单 `can_view_*` → False;非私有态 → True(等价 `permissions.py:60/70`)。
- [ ] AC-2 admin 对**归档/已删**项目工单:`can_view_*` → True(读短路);`can_add_attachment`/`can_manage_assignees`/`can_claim`/`can_work` → False(写仍受项目活跃约束)。**这条是风险4 的核心回归。**
- [ ] AC-3 admin **不**豁免设备门:经 `require_local_client` 的路由对 admin 仍 403(无设备)——F06 资源门不含任何设备豁免。
- [ ] AC-4 18+ 调用者改名后启动无 ImportError;旧名 alias 一周期内仍可用。

**动作门 + 合并**

- [ ] AC-5 无任何 policy 匹配 → `resolve` 返回 ASK(默认就问)。
- [ ] AC-6 session `allow` vs org `deny` → session allow 胜;同 scope `deny` 与 `ask` 并存 → deny 胜。
- [ ] AC-7 `visible_tools(actor)` 不含 deny 工具;含 ask 工具。
- [ ] AC-8 `is_admin` allow-fallback 命中动作门,但**不**放松资源门写路径(归档项目写仍 False)。

**审批原语**

- [ ] AC-9 `ask` 命中 → 建 `ApprovalRequest(pending)` + 路由 + `permission.ask` 只到正确 `user:<id>`(A 看不到 B 的)。
- [ ] AC-10 并发双击 respond → 仅第一个 CAS 成功,第二个 409 "approval race"。
- [ ] AC-11 `deny` 无 `reason_md` → 422;有理由 → denied + AuditLog 落行 + 理由回灌接口可取。
- [ ] AC-12 路由算不出人 → 不入 pending,直接 `EscalationEvent(no_approver)`,**绝不静默 allow**。
- [ ] AC-13 `tool` SLA 到期 → `pending→expired` CAS + `EscalationEvent(approval_timeout)`;`proposal` 到期 → 催办,**绝不超时即放行/自动合并**。
- [ ] AC-14 委派:仅当前 routed_to/admin 可发起;经 delegated 改 routed_to 回 pending;`decided_by` 仍空;`permission.reassigned` 发旧 + 新两端。
- [ ] AC-15 `remember="always"` → 写 `learned_from_session=true` allow(最细作用域);`risk_level=high` 动作拒学;软删该 policy 可撤销;命中/写入均落 AuditLog。
- [ ] AC-15a 审批卡 payload:`permission.ask` 对应的 `ApprovalRequest.payload_json.ui` 能映射为 `AttentionItem`,含 `summary_text/risk/actions/evidence_refs?`;UI 摘要不包含裸 `tool.delete_file` 这类内部黑话。

**审计**

- [ ] AC-16 每个 approve/deny/delegate/expire 落 `AuditLog`,锚点 `*_user_id`(非昵称),`decided_by` 可 ≠ `routed_to`(委派/admin 介入)。

---

## 回滚与风险

### 回滚策略

- **分阶段独立**:阶段 A(资源门)可单独发布并回滚——它只是纯函数 + 旧名 alias,不依赖新表;若动作门(B–E)出问题,可关 feature flag 让 `resolve` 一律返回 ASK(最保守,fail-safe)而保留资源门。
- **新表可回退**:`PermissionPolicy`/`ApprovalRequest` 走 Drizzle migration,`downgrade` 可逆删表(无下游 FK 强依赖时);`learned_from_session` 规则软删即撤。
- **动作门旁路**:未接 F8 前,动作门不 gate 任何真实工具执行——可安全先合表结构与算法,后接执行。

### 风险

| # | 风险 | 缓解 |
|---|---|---|
| RK-1（Master 风险4) | 外化放松 admin 读/写/设备不对称 | 阶段 A 先写特征化基线测试(AC-1/2/3),真值表逐格等价才进 B;P-2 语句顺序逐行比对;`is_admin` allow-fallback 与资源门**分层不互覆盖** |
| RK-2 | 改名漏一处调用者 | 18+ 处 grep 清单(R-3);旧名 alias 过渡;ImportError 非静默,启动/CI 捕获 |
| RK-3 | 合并算法 precedence 误序 → 过度拦截或静默重开归档项目写 | 确定性排序键 + 平级 deny>ask>allow 单测(AC-5/6);默认 ask 兜底;动作门不触及资源门写约束 |
| RK-4 | 审批私有事件跨用户泄漏(NFR-08,有前科) | `permission.ask` 由身份派生 `user:<id>`,订阅边界重强制 `can_view`(F5);绝不发 `all`;AC-9/E3 覆盖 |
| RK-5 | "超时即放行"破宪法第5条 | SLA 到期**只朝找人降级**(升级/催办/改派);路由失败→升级;AC-12/13 守 |
| RK-6 | 同步门在请求线程 busy-wait → 重蹈 DB writer 锁 outage(`auth.py:94`) | F06 只落库 + 标记,**不** busy-wait;Runner 让出-唤醒归 F8(spec RA-5) |
| RK-7 | "永远允许"放大攻击面 | 显式确认 + 最细作用域 + 高风险不可学 + deny 优先仍压学习规则 + 可撤可审(AC-15) |

---

## 依赖与被依赖

**依赖(上游)**

- **F2 实体模型**:`WorkItem`(改名自 `Requirement`)、Org/Workspace、`AgentRun`、`AuditLog`、`Snapshot`、`EscalationEvent`、`PermissionPolicy`/`ApprovalRequest` 表落地与 `version`/`deleted_at` 列。
- **F4 鉴权身份**:`current_user`(`auth.py:104`)、设备门 `require_local_client`(`auth.py:183`)、`require_actor` DI(AI 合成 actor,替 `auto.py:224` 伪造)、Org/Workspace 上下文注入。

**被依赖(下游)**

- **F8 Agent 引擎核心**:消费 `visible_tools(actor)` 组装模型菜单;消费 `resolve` 在工具 execute 前 gate;实现同步门"阻塞 Runner"让出-唤醒 + 审批 resume;SLA 后台扫描 leader 选举。
- **F9 生命周期/通知**:审批裁决/委派的里程碑通知路由(approver);`escalated` 新状态登记 `_MILESTONES`。
- **F10 审计/快照/回滚**:`AuditLog` 实体与"deny → revert"衔接点;`Snapshot` 红线。
- **F11 daemon 拆分/客户端改接**:`/api/approvals*`、`/api/permissions` 经 OpenAPI 暴露;`permission.ask` SSE topic 客户端消费。

**成对/协同约束**

- 审批私有事件依赖 **F5** broker 化的订阅边界鉴权门(单 worker→多 worker 不得在 F5 落地前 `--workers N`,Master §6 铁律3)。

---

## Target TS paths

> 本组件施工时,旧 `permissions.py` 是资源门、admin 不对称、设备门正交性的 behavior source;新实现落 policy package 与 approval service。

| 类别 | 目标路径 | 必须产物 | 审计门禁 |
|---|---|---|---|
| policy engine | `packages/permissions/src/evaluate.ts`, `packages/permissions/src/policies.ts` | allow/deny/ask 分层 evaluator | deny > ask > allow 单测 |
| approval service | `apps/api/src/services/approvals.ts`, `apps/api/src/routes/permissions.ts` | `ApprovalRequest` 创建/路由/裁决 | SLA 到期不自动放行 |
| contracts | `packages/contracts/src/approval.ts`, `packages/contracts/src/attention.ts` | `ApprovalRequest`, `ReviewAction`, `AttentionItem` | 用户面 action payload 人话 |
| persistence | `packages/db/src/repositories/approval-requests.ts` | 审批请求、委派、永远允许规则 | 高风险不可学习 |

**PR 必答**:说明每个高权限 endpoint 的设备门要求。Rust/Web 只展示服务端返回 action,不得本地重算 permission。
