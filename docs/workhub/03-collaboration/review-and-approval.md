---
module: P-PERM
layer: 平台底座 (Platform / Cross-cutting)
status: 🚧
owner: workflow
---

# 审批与路由（Review & Approval）

> **一句话**:WorkHub 把现有「负责人通过/打回」这一条**人工验收回路**(`accept_delivery` / `request_revision`)与 opencode 式**分层 permission 阻塞原语**合并成一套统一机制 —— 任何 AI 动作或人工提议在「该决策那一刻」都可被**阻塞**直到有权的人答复;**打回必须带理由**,理由作为上下文**回灌**给 AI 触发自我纠偏(CorrectedError 式);**谁该批**由角色/负责人/项目路由裁定;未答复有 **SLA 超时**与**委派**;反复 allow 的请求可沉淀为「**永远允许**」规则;全程**按身份审计**。
>
> 本篇深度 = 接口/机制级:给数据结构、状态流转、API/事件契约、算法与规则表、边界与失败处理。
>
> **范围边界**:本篇只写「审批 + 路由」这一层 —— 阻塞原语、打回回灌、审批路由、SLA、委派、永远允许、按身份审计。**不写**:分层策略的*威胁模型与设备令牌门*(归 [`security-and-permissions.md`](../01-architecture/security-and-permissions.md));*提议/合并/冲突调解*本身(归 [`branch-proposal-merge.md`](./branch-proposal-merge.md));*置信度/风险分级与三触发器*的判定算法(归 [`confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md));*PM 模式编排*(归 [`pm-mode-orchestration.md`](../02-ai-engine/pm-mode-orchestration.md));*工具契约与 Agent 循环*(归 [`agent-loop-and-tools.md`](../02-ai-engine/agent-loop-and-tools.md))。本篇引用它们的产物,不重复其内部逻辑。
>
> **权威来源**:术语(审批 / 提议 / 采纳 / 打回 / 永远允许)以 [`glossary-dejargon.md`](../00-overview/glossary-dejargon.md) 为准;实体字段与软删除/审计列以 [`data-model.md`](../01-architecture/data-model.md) 为准;路由签名、事件类型清单、鉴权依赖注入以 [`api-contract.md`](../01-architecture/api-contract.md) 为准;`Rationale`(理由+证据+trace 三元组)以 [`explainability.md`](../02-ai-engine/explainability.md) 为准。参照代码:`app/services/lifecycle.py`、`app/routers/deliveries.py`、`app/routers/requirements.py`、`app/services/permissions.py`、`app/auth.py`。

---

## 0. 为什么是一套机制,而不是两套

今天的产品里有**两条互不相干的"等人点头"路径**,WorkHub 要把它们统一为同一原语:

1. **人工验收回路(已存在)**:交付物提交后状态进 `delivered`,负责人/提交者在 `accept_delivery`(`deliveries.py:226`)点「通过」→ `accepted`,或在 `request_revision`(`deliveries.py:267`)写理由打回 → `revision_requested`,理由落 `RevisionRequest.reason_md`(`models.py:535`)。这正是 PRD §2.3 洞察里说的"**deliver→通过/打回 其实就是 PR review**"。
2. **工具级审批(新增)**:借鉴 opencode —— AI 工人跑到一个高风险工具(删文件、改业务对象、对外发送…)时,在执行**前**停下来问人 allow/deny,**阻塞**该 AgentRun 直到答复。现有代码里**还没有**这道门,`auto_agent` 的工具直接在沙箱里跑(见 `agent-loop-and-tools.md`)。

**统一的依据**:这两条本质都是「**一个待裁决的请求 + 一个有权的裁决者 + 一个带理由的 allow/deny 结果**」。WorkHub 把它抽象为一个 **`ApprovalRequest`** 实体 + 一套路由/SLA/委派/审计机制,让"审 Proposal"与"审一次工具调用"走同一条管线、同一套事件、同一份审计。下文统一称**审批请求(approval request)**。

> 与现有代码一脉相承的三条铁律(从 `lifecycle.py` / `deliveries.py` 继承,不重新发明):
> - **同事务**:审批结果的副作用(状态变更、通知行)必须与裁决写在**同一个 DB 事务**里(`queue_status_notifications` 不 commit、不 publish,交调用者控制)。
> - **commit 后再推**:事件/通知**只在 `db.commit()` 之后** publish 到事件总线(`flush_status_notifications` 在 commit 后 fire SSE,且吞掉 bus 异常,绝不让一次推送失败把成功的状态变更 500 掉)。
> - **原子 CAS 防重**:每个裁决都用 compare-and-swap 把状态从「裁决前」精确翻到「裁决后」(`deliveries.py:240/294` 的 `.where(status=="delivered")` + `rowcount==0 → 409`),双击/并发只有第一个生效。

---

## 1. 审批 = 阻塞原语

### 1.1 语义

**审批是一个阻塞原语**:在「该决策那一刻」,发起方(AgentRun 或一个 Proposal 提交动作)创建一条 `ApprovalRequest` 并**停在那里**,直到有权的裁决者回 `allow` / `deny`(或 SLA 超时触发兜底)。

两种阻塞形态,对应两类发起方:

| 形态 | 发起方 | 阻塞的是 | 现状对应 |
|---|---|---|---|
| **同步阻塞(工具门)** | AgentRun 的一次工具调用 | 该 AgentRun 的执行循环(不再 step,挂起) | (新增)opencode 式 ask |
| **异步阻塞(提议门)** | 一次 Proposal 提交 / 一次 `delivered` 交付 | WorkItem 在 `in_review` 不前进,等审 | `accept_delivery` / `request_revision` 的 `delivered → accepted/revision_requested` |

> **为什么不是"轮询一个 flag"**:opencode 的审批是真正的阻塞调用,执行域 `await` 在审批上。WorkHub 的 Runner 与 daemon 可分离(见 [`system-architecture.md`](../01-architecture/system-architecture.md) §1.1),所以"阻塞"在实现上是 **Runner 把该 AgentRun 标记为 `awaiting_approval` 并让出**,daemon 侧 `ApprovalRequest` 落库等裁决;裁决到达后由 `pending → resume` 信号唤醒 Runner 续跑。**绝不在请求线程里 busy-wait**(那会重蹈 `auth.py:94` 注释里"长握 DB writer 锁 → database is locked"的覆辙)。

### 1.2 数据结构:`ApprovalRequest`

> **字段名与最终 DDL 以 [`data-model.md`](../01-architecture/data-model.md) §8.2 为唯一权威**;下表 = 该权威表的**机制视角注解** + 本篇为支撑路由/SLA/委派/审计而**显式提出的扩展列**(标 *[扩展]*,需 data-model.md 收口)。已在 data-model.md §8.2 落定的列用其原名,**不另造同义词**。

| 字段(data-model.md §8.2 原名) | 类型 | 含义 / 约束 |
|---|---|---|
| `id` | UUID PK | 主键(迁移期沿用 `uid()` 32-hex,见 data-model §9.2) |
| `work_item_id` | FK? index | 关联 WorkItem(演进自 `requirement_id`) |
| `agent_run_id` | FK? index | `tool` 门时指向阻塞的 AgentRun |
| `action_pattern` | `str(128)` | 被审动作的稳定标识,命中 `PermissionPolicy.effect=ask`(见 §3.2),如 `tool.delete_file`、`merge.*` |
| `payload_json` | JSONB | 待批动作的入参快照(工具入参 / diff 摘要 / 影响面),供裁决者看「批的是什么」 |
| `status` | `str(16)`, default `pending` | `pending`/`approved`/`denied`/`expired`/`delegated`(见 §1.3) |
| `routed_to_user_id` | FK? index | **当前**该批的人(路由产物,可因委派/超时改写;FR-PERM-002) |
| `decided_by_user_id` | FK? index | 实际裁决者身份(**审计锚点**;可 ≠ `routed_to` —— 委派受让人或 admin 介入) |
| `decision_reason_md` | `Text?` | 裁决理由。**`deny`/`denied` 时非空**(强约束,见 §2);拒绝理由回灌 AI |
| `delegated_to_user_id` | FK? index | 委派目标(见 §5;FR-PERM-003) |
| `sla_due_at` | `DateTime?` index | SLA 截止(见 §4);`null` = 不超时 |
| `created_at` / `updated_at` | `DateTime` | `TimestampMixin` |
| *[扩展]* `kind` | `str(16)` | `tool` \| `proposal` \| `revision` —— 决定走同步门还是异步门(§1.1)。**data-model.md §8.2 当前未列**,本篇为「三类审批共用一表」需此判别列,请 data-model 收口(否则需用 `agent_run_id` 是否为空 + `action_pattern` 前缀间接区分) |
| *[扩展]* `risk_level` | `str(8)` | `low` \| `medium` \| `high` —— 由 [`confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md) 评出,**只输入路由/SLA,不在本篇计算**;落库以便 SLA 分档(§4.1)与「高风险不可学」(§6.2)查询 |
| *[扩展]* `rationale_json` | JSONB | `Rationale` 三元组(人话理由+grep 证据+trace_ref),见 [`explainability.md`](../02-ai-engine/explainability.md) §2;与 `payload_json` 分列以便审阅 UI 区分「批什么」与「为什么这么提」 |
| *[扩展]* `assignee_role` | `str(16)?` | 路由命中的角色(`lead`/`owner`/`admin`…),审计用(§7) |
| *[扩展]* `escalation_event_id` | FK? | 超时/拒绝触发升级时回填(见 §4.3),形成可审计链路 |
| *[扩展]* `org_id` / `workspace_id` | FK? index | 策略合并与路由作用域(多租户预留);data-model.md §6 已规定横切实体均带此二列 |

> **状态枚举对齐**:data-model.md §8.2 的 `status` 域为 `pending`/`approved`/`denied`/`expired`/`delegated`。本篇沿用此五值(下文 §1.3 用 `approved`=批准、`denied`=拒绝;`delegated` 为委派后的过渡态)。本篇**不引入** data-model 之外的 `created`/`routing_failed`/`allowed` 等同义状态 —— `routing_failed`/路由中等瞬态不落 `status` 列,作为创建事务内的处置分支(§3.4 直接升级),不进枚举。

**派生而非新建的关联**:`kind=revision` 的 `ApprovalRequest` 与现有 `RevisionRequest`(`models.py:535`)是**同一事实的两种视图** —— 迁移期 `RevisionRequest.reason_md`(`models.py:542`,`nullable=False`)即 `ApprovalRequest.decision_reason_md`,`delivery_id` 经 WorkItem/Proposal 间接关联。二者是合并成一张表还是 `RevisionRequest` 作为明细行,见 §11 RA-1 与 [`data-model.md`](../01-architecture/data-model.md) §8.2 收口。

### 1.3 状态流转

> 状态枚举 = data-model.md §8.2 的 `pending` / `approved` / `denied` / `expired` / `delegated`。「路由计算」与「无人可批」是**创建事务内**的瞬态处置(不落 `status` 列):路由成功 → 写 `pending`;路由失败 → 不建 `pending`,直接升级(§3.4)。

```
        ┌──── delegate(委派,改 routed_to)→ delegated ─(再路由到新人)→ pending ────┐
        │                                                                        │
(创建事务: route_approver)                                                        │
   ├─ 路由成功 → pending ──┬─ approve ───────────► approved ─► (resume Runner / merge Proposal)
   │                       │
   │                       ├─ deny(必带 reason)─► denied ───► (理由回灌 AI / 打回提议)
   │                       │
   │                       └─ SLA 超时(sla_due_at)► expired ─► 兜底(升级/催办/再路由,绝不放行)
   │                                                           见 §4.2
   └─ 路由失败(无人可批)→ 不入 pending,直接 EscalationEvent(原因 no_approver,§3.4)
```

| 状态 | 含义 | 进入动作 |
|---|---|---|
| `pending` | 已路由,等人答复(唯一可裁决态) | publish `permission.ask` 到裁决者私有 topic(§5) |
| `approved` | 已批准 | 同步门:resume AgentRun;异步门:执行合并 / `accepted` 转移 |
| `denied` | 已拒绝(带理由) | 理由回灌(§2);异步门走 `revision_requested` |
| `delegated` | 委派过渡态 | 改 `routed_to_user_id` 后再回 `pending` 等新人裁决(§5) |
| `expired` | SLA 到期未答 | 兜底(§4.2) |

**状态机硬约束**(继承 `requirements.py:273` 的「allowed-transitions 表 + CAS」范式):
- `pending` 是唯一可裁决态;任何 `approve`/`deny`/`delegate` 都对 `status==pending` 做 CAS,`rowcount==0 → 409 "approval race"`。这把 `accept_delivery`(`deliveries.py:240`)已有的「双击/竞态防护」推广到所有审批。
- 终态 `approved`/`denied`/`expired` 不可再变(对齐 `requirements.py:283` 的 `accepted: set()`、`cancelled: set()` 空出边)。`delegated` 非终态,只能转回 `pending`。

### 1.4 阻塞-唤醒时序(同步门,J3 升级路径片段)

```
AgentRun 循环(Runner) ── 触到 action_pattern="tool.delete_file"
   └─► daemon: evaluate_policy(org→workspace→role→session)  [§3.2]
         ├─ allow 命中 → 直接执行,不建审批(零打扰)
         ├─ deny  命中 → 不执行;以 deny 理由回灌,Runner 续跑    [§2]
         └─ ask   命中(或未匹配,默认 ask)→
               创建 ApprovalRequest(status=pending) + 路由 routed_to  [§3]
               Runner 把 AgentRun 标 awaiting_approval 并让出   ← 阻塞
               publish permission.ask → 裁决者(web/桌宠)        [§5]
                  └─ 裁决者 HTTP POST /approvals/{id}/respond {decision}(+理由)
                        ├ allow → status=approved → resume:Runner 执行该工具,续 step
                        └ deny  → status=denied → CorrectedError 回灌 → Runner 续 step(换方案)  [§2]
```

> 注意:**daemon 先查策略,命中 allow/deny 直接放行/拦截,只有落到 `ask` 才真正建审批阻塞** —— 这就是「永远允许」沉淀(§6)能减少打扰的机制入口。

---

## 2. 打回带理由回灌(CorrectedError 式)

### 2.1 现有先例:`RevisionRequest.reason_md` 是强制的

打回带理由**今天已经是硬约束**:`request_revision` 的入参 `RevisionIn.reason_md` 是 `Field(min_length=1, max_length=200_000)`(`deliveries.py:42`)—— 空理由直接 422。理由落 `RevisionRequest.reason_md`(`models.py:542`,`nullable=False`),并写进 `ActivityLog`(`action="revision_requested"`, `detail.reason_preview`)与发给 assignees 的通知(`lifecycle.py` 的 `revision_requested` milestone:*"{actor} 打回了你的交付,请到工单看返工说明"*)。

WorkHub 把这条约束**从"审交付"推广到所有 `deny`**:任何 `ApprovalRequest.decision="deny"` 必须 `reason_md` 非空(§1.2),否则裁决 API 422。

### 2.2 回灌算法(CorrectedError)

opencode 的 CorrectedError 思想:**错误/拒绝不是终点,而是下一步的输入**。WorkHub 的回灌分两路,但**结构一致**:

| 打回类型 | 触发器(PRD §8.2) | 现状对应 | 回灌动作 |
|---|---|---|---|
| **工具拒绝**(同步门) | —— (审批 deny) | (新增) | deny 理由包装成一条 `tool_result`(`is_error: true`,content = 人话理由)塞回 Runner 的 `messages`,AgentRun **在同分支续 step**,模型据此换方案。形如 `auto_agent.py:491` 现在对工具异常的处理(`content = f"[error] …"` 回灌),只是来源从「异常」变成「人的拒绝理由」。 |
| **提议打回**(异步门) | ② 用户不满意 ← 负责人打回 | `request_revision` → `revision_requested` | 理由作为上下文喂回**接管该 WorkItem 的 AI 工人**,在**同一分支**续做(PRD **FR-ESC-003**:"在同分支续做而非重来"),对应状态 `revision_requested → doing`(`requirements.py:282` 已是合法转移)。 |

**回灌的不变式**:
1. **同分支续做,不重开**(FR-ESC-003)。分支/提议的延续语义见 [`branch-proposal-merge.md`](./branch-proposal-merge.md);本篇只保证「理由作为新一轮 AgentRun 的输入上下文」。
2. **理由进 trace 与审计**:回灌的理由既是模型上下文,也写入 `AgentRun.trace`(kind=`correction`)与 `ActivityLog`,使「为什么返工」可回放(见 [`explainability.md`](../02-ai-engine/explainability.md) §4)。
3. **回灌 ≠ 无限循环**:连续 N 轮被打回 / 反复相同动作 → 命中 doom-loop,**自动升级**为 `EscalationEvent`(阈值与 doom-loop 检测归 [`confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md));本篇只声明「回灌次数是升级的输入信号之一」。
4. **去黑话**:回灌给用户侧的措辞(若需展示)遵循 `glossary-dejargon.md` —— 用户看到的是"按你说的改了再提交",而非"CorrectedError re-injected"。

### 2.3 第三种升级触发器在本篇的接口

PRD §8.2 三触发器里,**①不合格**(`llm_review` 判分不过,`auto_agent.py:544`)与**③用户明确不让 AI 干**(人工保留开关)不属于"打回",但都可能落成审批/升级:
- **①不合格**:`llm_review` 返回 `(meets_requirement=false, reason)` → 进 `ConfidenceRecord` → 低档触发升级(不经人审,见 confidence 文档)。它**不创建** `ApprovalRequest`(没有人在等批),而是直接 `EscalationEvent`。
- **③人工保留**:这是一条**策略**(§3.2),表现为对该 WorkItem/项目/用户的某类 `action_pattern` 命中 `deny`(禁止 AI 自动执行)或强制 `ask`(必须人批)。它在本篇就是一条高优先级 deny/ask 规则(对应 PRD **FR-ESC-005** 的 WorkItem/项目/用户三级"人工保留"开关)。

---

## 3. 审批路由(谁该批)

> 这是 PRD §8.6 点名的**护城河**("opencode 没有"):决定**谁该批**、未响应的**超时**、可**委派**、**按身份审计**。

### 3.1 路由的两步:先定策略动作,再定裁决者

```
ApprovalRequest(created)
   │
   ├─ 步骤A 策略评估 evaluate_policy(action_pattern, 作用域)  → allow / deny / ask   [§3.2]
   │        └ allow/deny:不产生待批请求(直接放行/拦截 + 理由)
   │
   └─ 步骤B 路由(仅 ask)route_approver(kind, work_item, action_pattern, risk) → routed_to_user_id  [§3.3]
            └ 算不出 → 不入 pending,直接升级(EscalationEvent 原因 no_approver)            [§3.4]
```

### 3.2 分层策略合并(allow / deny / ask,默认 ask)

策略在四个作用域分层定义,**合并**出对某个 `action_pattern` 的有效动作:

```
org  →  workspace  →  role  →  session
（粗）                              （细）
```

| 概念 | 字段(`PermissionPolicy`,data-model.md §8.1 原名) | 说明 |
|---|---|---|
| 作用域 | `scope_kind ∈ {org, workspace, role, session}` + `scope_id` | 越细优先级越高 |
| 匹配 | `action_pattern`(通配,如 `tool.delete_file`、`merge.*`、`run_command:*`、`*`) | 对 `ApprovalRequest.action_pattern` 做 glob 匹配 |
| 动作 | `effect ∈ {allow, deny, ask}` | **未命中任何规则 → 默认 `ask`**(PRD **FR-PERM-001**) |
| 同层解析序 | `priority`(int) | 同 `scope_kind` 内冲突的排序;`deny` 通常压 `allow` |
| 学习来源 | `learned_from_session`(bool, default false) | `true` = §6"永远允许"沉淀的自动规则(FR-PERM-003) |

> data-model.md §8.1 用布尔 `learned_from_session` 而非 `origin` 枚举区分「admin 手配 / session 学习」:`false`=人工配置,`true`=学习沉淀。本篇沿用此布尔,**不引入** `origin` 枚举。

**合并算法(确定性,可审计;对齐 data-model.md §8.1 的"`deny` > `ask` > `allow`")**:
1. 收集所有作用域中 `action_pattern` 匹配本 `action_pattern` 的规则。
2. 排序键 = `(scope_kind 特异度, priority, pattern 特异度)`:作用域越细(session>role>workspace>org)、`priority` 越高、模式越具体(精确串 > 越短的通配)优先级越高。
3. 取最高优先级规则的 `effect`。**平级冲突时 `deny` > `ask` > `allow`**(安全优先,对齐 `permissions.py` 写路径"宁可拒绝"的保守姿态与 data-model.md §8.1 合并规则)。
4. 全表无匹配 → `ask`。`is_admin`(`permissions.py:32`)在迁移期作为最高优先级 allow 兜底(data-model.md §8.1),避免迁移期失权。

> 这层与现有 `services/permissions.py` 的关系:`permissions.py` 的 `can_view_requirement_record`/`can_claim_requirement`/`can_work_requirement`(`permissions.py:50/106/114`)+ `is_admin`(`permissions.py:32`)短路是**RBAC 资源门**(who 能否碰这个资源),发生在审批**之前**(见 [`system-architecture.md`](../01-architecture/system-architecture.md) §3 的四道门次序)。本篇的分层策略是**动作门**(这个动作在此刻要不要问人)。RBAC 决定"能不能进这扇门",策略决定"进门要不要先举手"。规则的威胁模型语义归 [`security-and-permissions.md`](../01-architecture/security-and-permissions.md)。

### 3.3 路由表:谁该批(按角色 / 负责人 / 项目)

`route_approver` 按 `kind` + WorkItem 上下文裁定 `routed_to_user_id`。下表是 v1 默认路由(可被项目级配置覆盖):

| `kind` / 场景 | 该批的人(优先级从高到低) | 现状依据 |
|---|---|---|
| `proposal` / `revision`(审交付) | ① WorkItem 的 **lead**(`lead_assignment`,role=`lead`)→ 但**采纳/打回交付**遵循现状由**提交者**裁决 | `accept_delivery`/`request_revision` 现在校验 `r.submitter_user_id != user.id → 403`(`deliveries.py:232/278`) |
| `tool`(工人高风险动作) | ① WorkItem **lead** → ② 项目 **owner**(`Project.owner_user_id`)→ ③ 任一 **admin** | `lead_assignment`(`assignments.py:34`);`owner_user_id`(`models.py:83`);`is_admin`(`permissions.py:32`) |
| 人工保留命中 | 触发该保留的**配置主体**(WorkItem→其 lead;项目→owner;用户→该用户本人) | (新增,§2.3) |
| 兜底(以上皆空) | 项目 owner;再空 → 任一 admin;再空 → 路由失败 → 升级(§3.4) | —— |

**路由的硬约束**:
- **裁决者必须有该资源的权限**:`route_approver` 选出的 `routed_to_user_id` 必须通过对应的 `permissions.can_*` 检查 —— 不能把审批路由给一个连工单都看不到的人(否则他在 `push.py:84` 的订阅鉴权 `can_view_requirement_record` 处就收不到事件)。
- **排除软删除用户**:沿用 `lifecycle._resolve_recipients`(`lifecycle.py:99`)"跳过 `deleted_at` 用户"的做法 —— 给幽灵账号路由审批 = 永远超时。
- **排除发起者自己**:AI 发起的审批不能路由回"AI 自己";人发起的提议不路由回提交者本人(对齐 `lifecycle._resolve_recipients` 的 `user_ids.discard(actor.id)`,`lifecycle.py:93`)。
- **提交者 vs lead 的取舍**:**交付采纳/打回**(`proposal`/`revision`)延续现状由**提交者**(`submitter_user_id`)裁决 —— 他是"要结果的人";**工人高风险工具门**(`tool`)路由给 **lead/owner** —— 他们是"对执行负责的人"。这条区分是从现有 `accept_delivery`(提交者审)与"谁在干活"(assignee)的现状直接继承,不臆造新角色。

### 3.4 路由失败 = 升级,绝不静默放行

**路由失败**(无人可批)**绝不降级为自动 allow**(那违反产品宪法第 5 条"AI 绝不静默改生产态")。处置:**不写 `pending`**,在创建事务内直接创建 `EscalationEvent`(原因=`no_approver`),转 PM 模式找人 —— "没人能批"本身就是一种"卡住"。这与 §4.3 的 SLA 超时升级共用同一兜底出口。

---

## 4. SLA 超时

### 4.1 截止的计算

`ApprovalRequest.sla_due_at = created_at + sla_duration(kind, risk_level)`(`sla_due_at` 字段见 data-model.md §8.2)。`sla_duration` 是一张可配置规则表(默认值,可被 org/project 覆盖):

| `kind` | `risk_level` | 默认 SLA | 理由 |
|---|---|---|---|
| `tool` | `high` | 30 min | 高风险动作卡着 Runner,要么快批要么快升级 |
| `tool` | `medium` | 2 h | |
| `proposal` / `revision` | * | 24 h | 人审交付物,给足时间;延续"交付后等验收"的现状无硬超时,但 WorkHub 加软超时以驱动催办 |
| 人工保留命中 | * | `null`(不超时) | 用户明确要自己把关的事,不替他兜底放行 |

> `risk_level` 来自 [`confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md),本篇只**消费**它做 SLA 分档,不计算。

### 4.2 到期处置(按 kind 分流)

到期由后台周期任务扫描(复用现有"后台周期任务域"模式,见 `system-architecture.md` §7 M12;选主避免多副本重复跑),对 `status==pending and sla_due_at < now()` 的请求按 `kind` 分流:

| `kind` | 到期动作 | 绝不做 |
|---|---|---|
| `tool`(同步门) | **升级**:CAS `pending→expired` → 创建 `EscalationEvent`(原因=`approval_timeout`)→ AgentRun 转 PM 模式 | 绝不"超时即 allow"放行高风险动作 |
| `proposal`/`revision`(异步门) | **催办 + 软升级**:先发提醒通知(沿用 `lifecycle` 通知管线 + `M-NOTIFY` 提醒)给 `routed_to_user_id`;二次到期 → CAS `pending→expired` 后升级或改派给 owner/admin | 绝不"超时即自动采纳"合并提议 |

**核心原则**:**超时永远朝"找人"方向降级,不朝"放行"方向降级**。这是与"默认 ask"一致的保守姿态。

### 4.3 升级回填

超时升级时,把生成的 `EscalationEvent.id` 回填到 `ApprovalRequest.escalation_event_id`,使"这条审批为什么没人理 → 升级了 → 谁接手"形成可审计链路。`EscalationEvent` 携带与审批同一个 `Rationale`(见 explainability §5 的端到端链)。

---

## 5. 委派

### 5.1 语义

**委派(delegate)** = 在不裁决的前提下,把"该批的人"从 A 改成 B。两种来源:
- **主动委派**:当前 `routed_to_user_id`(A)说"这事该 X 批"。
- **被动委派**:SLA 二次超时的自动改派(§4.2 proposal 分支),或 admin 介入接管。

### 5.2 接口与约束

委派对 `ApprovalRequest(status==pending)` 做 CAS:写 `delegated_to_user_id=B`、把 `routed_to_user_id` 改为 B、`status` 经 `delegated` 过渡态回到 `pending`(对齐 data-model.md §8.2 的 `delegated` 枚举与 §1.3 状态图),重置或保留 `sla_due_at`(由策略定:主动委派通常重置 SLA,给新人足够时间)。委派后请求仍处于**可裁决**态,只是裁决者已换人。

| 约束 | 依据 |
|---|---|
| 只有**当前 `routed_to_user_id` 或 admin** 能发起委派 | 防止任意人改写审批归属;复用 `can_manage_requirement_assignees`(`permissions.py:91`)"提交者或当前 lead 可改派"的判断 |
| 被委派者 B 必须通过 `permissions.can_*` 资源检查 | 同 §3.3 —— 不能委派给看不到工单的人 |
| 委派写 `AuditLog`(`action="approval_delegated"`, detail={from, to, by})| 按身份审计(§7;`AuditLog` 演进自 `ActivityLog`,见 data-model.md §8.3) |
| 委派 publish `permission.reassigned` 给旧 `routed_to`(A)+ `permission.ask` 给新 `routed_to`(B) | 让两端 UI 同步(事件名见 §8.2 与 api-contract.md §5) |
| **委派非裁决**:`decided_by_user_id` 仍为空,直到 B(或后续受让人)真正 approve/deny | 审计区分"谁转交"(`delegated_to_user_id`)与"谁拍板"(`decided_by_user_id`) |

### 5.3 与现状的衔接

现状已有**再派活**的雏形:`can_manage_requirement_assignees`(`permissions.py:91`)允许"提交者或当前 lead 改派",`replace_assignments`(`assignments.py:89`)换 lead/collaborator。委派复用这套"谁能改派"的权限判断,但作用对象是**单条审批的裁决者**,而非 WorkItem 的整体 assignment —— 二者正交(改派换的是"谁干活",委派换的是"谁批这一次")。

---

## 6. "永远允许"沉淀规则

### 6.1 机制

当裁决者对某类 `action_pattern` 反复 `allow`,系统**提议**把它沉淀为一条 `effect=allow, learned_from_session=true` 的 `PermissionPolicy`(§3.2),从此该动作在该作用域命中 allow → **不再建审批阻塞**(§1.4 的"直接执行"分支),打扰随使用递减。这正是 opencode"永远允许"的落地,也直接服务 PRD **FR-PERM-003**。沉淀的触发口径:裁决者裁决时携带"记住"意图(api-contract.md §2.8 的 `POST /approvals/{id}/respond` 入参 `remember: "once"|"always"`,`always`→沉淀;见 §8.1)。

### 6.2 沉淀的护栏(学习不能放大攻击面)

| 护栏 | 规则 |
|---|---|
| **必须用户显式确认** | 系统只**提议**"以后这类操作不用再问你?",由裁决者点确认(`remember:"always"`)才写 `learned_from_session=true` 规则 —— 不偷偷学(对齐宪法"AI 绝不静默") |
| **作用域绑定** | 学习规则默认落在**最细可用作用域**(优先 `scope_kind=session/role`,而非 org),避免一次"永远允许"泄漏到整个组织 |
| **高风险不可学** | `risk_level=high` 的动作 **禁止**沉淀为 `allow`(只能逐次批);可配置白名单 |
| **可撤销 + 可审计** | 学习规则可一键关闭(`DELETE` 该 `PermissionPolicy`,软删 `deleted_at`);写入/命中都进 `AuditLog`,看板可见(NFR-11) |
| **deny 优先仍生效** | §3.2 的"`deny` > `ask` > `allow`"对学习规则同样成立 —— 一条 admin `deny` 能压住一条 `learned_from_session=true` 的 allow |

### 6.3 与人工保留的对称

「永远允许」与「人工保留」(§2.3)是同一套 `PermissionPolicy` 的两极:前者沉淀 `effect=allow`(减少打扰),后者配置 `effect=deny`/`ask`(强制把关)。同一张表、同一套合并算法,方向相反。

---

## 7. 按身份审计

### 7.1 现状基线:已经在按身份记

审计**今天已有真实载体**,WorkHub 扩展而非重建:
- **`ActivityLog`**(`models.py:554`):`actor_nickname` + `action` + `detail_json`,每个状态变更/打回都落一行(`deliveries.py:253/312` 的 `log_activity(action="accepted"/"revision_requested")`)。
- **通知按身份隔离**:`lifecycle._resolve_recipients`(`lifecycle.py:77`)按 submitter/assignees 解析收件人并 `discard(actor.id)`;SSE 私有事件走 `user:<auth_user_id>` 专流(`push.py:99`,topic 取鉴权得到的 id 而非 path 参数,防越权)。
- **裁决者是有身份的**:`accept_delivery`/`request_revision` 都经 `current_user`(`auth.py:104`)拿到真实 `User`,`requested_by_nickname` 落 `RevisionRequest`。

### 7.2 WorkHub 的审计契约

每条审批的**完整身份链**必须可回溯:

| 审计问题 | 字段 |
|---|---|
| 谁发起的(AI/人)? | `agent_run_id`(AI)或提交动作的 `actor`;`action_pattern` 标识动作 |
| 路由给了谁? | `routed_to_user_id` + `assignee_role`(可因委派变化,委派轨迹在 `AuditLog`) |
| 谁真正拍的板? | **`decided_by_user_id`**(可 ≠ `routed_to`:委派受让人 / admin 介入) |
| 批/拒 + 为什么? | `status`(`approved`/`denied`)+ `decision_reason_md`(`deny` 必填) |
| 何时? | `created_at` / `updated_at`(裁决时刻随 status CAS 落 `updated_at`)/ `sla_due_at` |
| 关联到哪个执行/提议? | `agent_run_id` / `work_item_id` / `escalation_event_id`(提议关联经 `work_item_id`→Proposal) |

**审计写入复用现有铁律**:审批裁决与其 `AuditLog` 行写在**同一事务**,事件在 commit 后 publish(§0 三铁律)。每个 `approve/deny/delegate/expire` 都落一条 `AuditLog`(`AuditLog` 演进自 `ActivityLog`,data-model.md §8.3),`detail_json` 记 `{decision, reason_preview, routed_to, decided_by}`。

> **身份的"按真实身份"而非"按昵称"**:现状 `ActivityLog.actor_nickname`(`models.py:559`)存的是昵称(显示用)。WorkHub 的 `AuditLog` **主键锚点用 `actor_user_id`/`*_user_id`**(对齐 `models.py:83` 注释"权限检查 ALWAYS 用 owner_user_id,否则重名重注册会误继承";data-model.md §8.3 已把 `actor_user_id` 设为锚点、`actor_nickname` 降为冗余展示),昵称仅作显示快照。这条是迁移到 PG + 多人并发后的硬要求。

### 7.3 AI 动作一律可审计 + 可回滚

PRD **FR-PERM-004**:所有 AI 动作按身份写入审计,可追溯、可回滚。本篇保证**审批侧**的可追溯(上表);**可回滚**(AI 副作用快照与 revert)归 P-AUDIT,见 [`data-model.md`](../01-architecture/data-model.md) §7.5/§8.3 的 `Snapshot`/`AuditLog.snapshot_id` 与 [`agent-loop-and-tools.md`](../02-ai-engine/agent-loop-and-tools.md) 的"每步快照"机制。审批与回滚的衔接点:一条 `deny`(无论人工还是超时升级后人决定不采纳)→ 触发对应 AgentRun 副作用的 revert(经 `AuditLog.snapshot_id` 定位回滚点)。

---

## 8. API / 事件契约(机制级,签名以 api-contract 为准)

> **完整路由签名、请求/响应 schema、鉴权依赖注入以 [`api-contract.md`](../01-architecture/api-contract.md) §2.8 / §5 为唯一权威**;此处给**本篇机制必需的端点形状与事件名**,并**与 api-contract 对齐**(下方凡 api-contract 已定者用其原形;本篇额外提出的端点/事件标 *[待 api-contract 收口]*)。

### 8.1 端点(REST,动作上行;形如 api-contract.md §2.8)

| 端点(api-contract.md §2.8) | 语义 | 现状演进自 |
|---|---|---|
| `GET /api/approvals?pending=true` | 我的待批队列(收件箱;只返回路由到本人的) | (新增)——现状无统一审批队列 |
| `POST /api/approvals/{id}/respond` | 裁决:`{decision: "allow"\|"deny", reason_md?, remember?: "once"\|"always"}` → CAS `pending→approved/denied`;`deny` 时 `reason_md` 必填(min_length=1);`remember="always"` → 沉淀学习规则(§6) | 异步门对应 `POST /requirements/{id}/accept`(`deliveries.py:226`)与 `POST /requirements/{id}/revisions`(`deliveries.py:267`,`RevisionIn.reason_md` min_length=1) |
| `POST /api/approvals/{id}/delegate` | 委派(`{to_user_id}`)→ CAS 经 `delegated` 改 `routed_to_user_id` 回 `pending`(§5) | (新增)——复用 `can_manage_requirement_assignees`(`permissions.py:91`)权限判断 |
| `GET /api/permissions?scope=…` / `PUT /api/permissions` | 读/写分层策略(含"永远允许"沉淀、人工保留;`PUT` 入参 `{scope, target, rules}`) | (新增)——外化 `services/permissions.py` 的硬编码规则 |
| *[待 api-contract 收口]* `GET /api/approvals/{id}` | 单条审批详情(`payload_json` + `rationale_json` + trace_ref),供审阅页 | —— |

> **与 api-contract 的差异说明(已就地对齐)**:本篇早前稿曾写 `/allow`+`/deny` 双端点与 `/api/policies`,与 api-contract.md §2.8 的**单 `/respond`(带 `decision`)** + `/api/permissions` 不一致;现统一采用 api-contract 形式,避免双源歧义。批/拒的区别由 `respond` 入参 `decision` 承载,"永远允许"由 `remember:"always"` 承载——一次裁决一次往返,不分两个端点。

**鉴权门**(沿用 `auth.py` 四道门,见 system-architecture §3):
- `respond`/`delegate` 需 `current_user`(`auth.py:104`)+ 该审批的 `routed_to_user_id`/admin 资格;**工具门的高权限裁决**(如桌宠侧)仍受**设备令牌门**约束(`require_local_client`,`auth.py:183`)—— 接活/干活类高权限操作要桌面客户端,延续 D-3。
- `GET /api/approvals` 列表按 `current_user` 过滤,只返回路由给本人的(+admin 全见,沿用 `is_admin` 短路,`permissions.py:32`)。

### 8.2 事件(SSE,状态下行;事件名以 api-contract.md §5 为准)

api-contract.md §5 已定**唯一审批事件 `permission.ask`**;topic 隔离见 api-contract.md §5.3。本篇沿用,并提出三条审批生命周期事件作为**待 api-contract 收口的扩展**(对齐 §5 的 `proposal.*`/`escalation.*` 风格):

| 事件 | topic | data(摘要) | 触发点 |
|---|---|---|---|
| `permission.ask`(**api-contract.md §5 已定**) | `session:<id>` + 被路由人 `user:<id>` | `{approval_id, tool, summary, ttl}` | `→pending` 路由后 |
| *[待收口]* `permission.decided` | `workitem:<id>`(+ `user:<决策人>`) | `{approval_id, decision, by}` | `approved`/`denied` 后(commit 之后 publish) |
| *[待收口]* `permission.reassigned` | 旧 `user:<old>` + 新 `user:<new>` | `{approval_id, from, to, by}` | 委派后 |
| *[待收口]* `permission.expired` | `workitem:<id>` | `{approval_id, escalated: bool}` | SLA 到期处置后 |

> **私有 topic 而非 `permission:<id>`**:本篇早前稿用过 `permission:<assignee_id>` 这一虚构 topic;api-contract.md §5.3 的真实 topic 命名空间是 `user:<id>`(本人私有)+ `workitem:<id>`(经可见性门)+ `session:<id>`。故审批私有事件一律走 **`user:<被路由人 id>`**,绝不另立 `permission:*` 命名空间。

**事件铁律**(继承 `lifecycle.flush_status_notifications`(`lifecycle.py:164`)+ `push_bus`):
- 一律 **commit 后** publish;publish 失败吞异常(`lifecycle.py:170` 的姿态)—— 行已落库,下次拉取补上。
- `permission.ask` 与上述私有事件 **只发裁决者 `user:<id>` 专流 / 经可见性门的 `workitem:<id>`**,绝不发 `all`(对齐 `client-tauri/src-tauri/src/sse.rs:6-10` 记录的"后端把通知扇出到 `all` → 每个客户端收到每个用户的通知"跨用户泄漏事故教训,NFR-08)。
- 满队列丢 + 30s 心跳:沿用 `push_bus` 现状(慢订阅者降级,不阻塞发布者)。

---

## 9. 边界条件与失败处理

| 场景 | 处理 | 依据 |
|---|---|---|
| **双击 / 并发裁决** | CAS `status==pending`,`rowcount==0 → 409 "approval race"` | `deliveries.py:240/294` 范式 |
| **裁决时 WorkItem 已变态**(如已 cancelled) | 异步门:CAS 的 `.where` 同时校验 WorkItem 状态,失配 → 409,审批随之失效 | `accept_delivery` 的 `.where(status=="delivered")`(`deliveries.py:242`) |
| **裁决者中途被软删除** | 路由阶段已排除 `deleted_at`;若 `pending` 中被删 → 视为路由失效 → 再路由/升级(§3.4) | `lifecycle.py:99` |
| **路由算不出人** | 不入 `pending`,直接 `EscalationEvent`(`no_approver`),绝不静默 allow | §3.4 |
| **SLA 到期** | 朝"找人"降级(升级/催办/改派),绝不朝"放行"降级 | §4.2 |
| **deny 无理由** | API 422(`reason_md`/`decision_reason_md` min_length=1) | `RevisionIn`(`deliveries.py:42`) |
| **Runner 已崩溃但审批还 pending** | 裁决到达时若 AgentRun 不可 resume(状态校验失败)→ 审批仍落 `approved/denied` 但标注,由 AgentRun 崩溃恢复机制(`system-architecture.md` §7 M3)精确接管,绝不留孤儿 | `_resume_stuck_jobs` 演进 |
| **publish 失败** | 吞异常,行已落库,轮询/下次加载补上 | `lifecycle.py:170` |
| **回灌引发 doom-loop** | 反复打回/相同动作 → 自动升级(阈值见 confidence 文档) | §2.2 不变式3 |
| **多副本下后台扫超时重复执行** | 扫描任务选主(单实例跑),或对每条 `pending→expired` 做 CAS 幂等 | `system-architecture.md` §7 M12 |

---

## 10. 设计约束清单(给 plan 阶段的硬边界)

1. **统一原语**:`proposal`/`revision`/`tool` 三类审批共用 `ApprovalRequest` 表(data-model.md §8.2)+ 同一套路由/SLA/委派/审计;不为工具门另起炉灶。
2. **三铁律不可违**:裁决副作用同事务、事件 commit 后推、CAS 防重(直接继承 `lifecycle.py`/`deliveries.py`)。
3. **默认 ask**:策略未命中一律 `ask`;平级冲突 `deny` > `ask` > `allow`(FR-PERM-001 + 安全优先,对齐 data-model.md §8.1)。
4. **deny 必带理由 + 回灌**:`decision_reason_md` 非空;理由作为 CorrectedError 回灌,**同分支续做不重开**(FR-ESC-003)。
5. **超时只朝找人降级**:`tool` 超时→升级,`proposal` 超时→催办/改派;**绝不超时即放行/自动合并**。
6. **路由必须落到有权且非软删的真人**;算不出 → 升级,不静默 allow(宪法第5条)。
7. **委派非裁决**:经 `delegated` 改 `routed_to_user_id`,`decided_by_user_id` 区分"转交人"(`delegated_to_user_id`)与"拍板人"。
8. **永远允许须显式确认(`remember:"always"`)+ 作用域最小 + 高风险不可学 + 可撤销可审计**。
9. **审计锚点用 `*_user_id` 非昵称**;每个 approve/deny/delegate/expire 落 `AuditLog`(data-model.md §8.3)。
10. **私有审批事件只发裁决者 `user:<id>` 专流**,绝不 `all`(NFR-08,sse.rs 事故教训)。
11. **高权限裁决仍受设备令牌门**(D-3,`require_local_client`,`auth.py:183`)。
12. **命名一致性**:实体字段名以 data-model.md §8.1/§8.2、端点/事件名以 api-contract.md §2.8/§5 为唯一权威;本篇扩展项均显式标注待收口,不另造同义词。

---

## 11. 开放问题(汇总至 [07-open-questions.md](../07-open-questions.md))

- **RA-1** `ApprovalRequest` 与现有 `RevisionRequest`(`models.py:535`)合并成一张表,还是后者作为前者的明细?且 data-model.md §8.2 当前**未列** `kind` 区分列(§1.2 *[扩展]*)、未列 `assignee_role`/`escalation_event_id`/`rationale_json` —— 这些扩展列是否纳入,待 [`data-model.md`](../01-architecture/data-model.md) §8.2 收口。
- **RA-2** 交付采纳/打回的裁决者:**延续现状由提交者**(`submitter_user_id`)裁决,还是改为 **lead**?二者职责在 WorkHub 角色模型下需与 PRD owner/lead 定义对齐(§3.3 暂定提交者优先,lead 为 v1 默认路由的备选)。
- **RA-3** SLA 默认时长与分档(§4.1)需与业务方共定;人工保留是否一律不超时(`sla_due_at=null`)?
- **RA-4** "永远允许"可学习的 `action_pattern` 白名单边界 —— 哪些中风险动作允许沉淀、哪些一律逐次批?与 [`security-and-permissions.md`](../01-architecture/security-and-permissions.md) 的威胁模型共定。
- **RA-5** 同步门"阻塞 Runner"的实现:`awaiting_approval` 让出 + 唤醒 vs 进程池里真 `await` —— 取决于 Runner 是否已抽出独立进程(`system-architecture.md` §1.1 的 MVP/云就绪分界)。
- **RA-6** 委派链深度:是否限制连续委派(`delegated→pending` 往复)次数以防"踢皮球"超时?
- **RA-7** §8.2 三条审批生命周期事件(`permission.decided`/`reassigned`/`expired`)是否纳入 api-contract.md §5 正式事件清单,还是仅靠 `permission.ask` + 状态轮询?待 [`api-contract.md`](../01-architecture/api-contract.md) §5 收口。
