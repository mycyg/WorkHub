---
module: P-AI
layer: L1
status: 🚧
owner: workflow
---

# AI 项目经理模式（PM Mode / Orchestration）

> **一句话**：当 AI 工人受阻（① 产出不合格 ② 用户不满意 ③ 用户明确不让 AI 干），AI 不硬扛，而是**化身项目经理**——理解卡点、智能派活、拆解排期、催办提醒、人产出后再审并协助生成 Proposal。经理模式下 AI **永不替人决策**：派活、催办、合并一律"提议 → 人确认"。
>
> 上游：[PRD §8.3 / §8.4 / §9-J3](../../prd/2026-06-04-workhub-prd.md) · 规格树索引：[README](../README.md)
> 同层必读（口径以它们为准）：
> - 架构总图与进程边界：[`01-architecture/system-architecture.md`](../01-architecture/system-architecture.md)
> - 实体与状态机：[`01-architecture/data-model.md`](../01-architecture/data-model.md)
> - API/事件契约：[`01-architecture/api-contract.md`](../01-architecture/api-contract.md)
> - 去黑话术语：[`00-overview/glossary-dejargon.md`](../../00-overview/glossary-dejargon.md)
> 紧邻模块（交叉处只引用、不复述）：
> - 激活的上游（置信度/风险/三触发器/打回回灌）：[`confidence-risk-escalation.md`](./confidence-risk-escalation.md)
> - 工人循环/工具/沙箱/预算/快照：[`agent-loop-and-tools.md`](./agent-loop-and-tools.md)
> - 智能派活的匹配算法与冷启动：[`smart-staffing.md`](./smart-staffing.md)
> - 决策可解释与 trace 呈现：[`explainability.md`](./explainability.md)
>
> **本篇深度**：接口/机制级。给数据结构、状态流转、API/事件契约、规则表、边界与失败处理。
> **本篇范围**：编排器的**激活 → 简报 → 派活提议 → 拆解/排期/催办/提醒 → 人产出后 AI 再审 → 协助生成 Proposal** 全链路；以及贯穿其中的"提议→确认"阻塞原语。
> **本篇不写**：置信度怎么算、风险怎么评、三触发器如何点火（见 [`confidence-risk-escalation.md`](./confidence-risk-escalation.md)）；派活的匹配打分细节（见 [`smart-staffing.md`](./smart-staffing.md)）。本篇消费它们的产物（`EscalationEvent`、`StaffingProposal`）。

---

## 0. 根基与命名（从现有代码演进）

本篇的编排逻辑不是凭空设计，而是把现有「需求管理大师」里**散落在四处的状态机驱动 + 通知中枢 + 拆解 + 排期** 收拢成一个 headless 的 `PMOrchestrator` 服务（D-1 迁移再演进）。可复用零件映射：

| WorkHub 概念 | 现有代码锚点 | 演进动作 |
|---|---|---|
| 里程碑通知中枢（一处声明，多处触发） | `app/services/lifecycle.py:104` `queue_status_notifications` + `:31` `_MILESTONES` 表 | 扩展事件表，增 `escalated / pm_briefed / staffing_proposed / catchup / re_reviewed` 等里程碑 |
| 通知发布（事务内排队、commit 后推 SSE） | `lifecycle.py:164` `flush_status_notifications` | 原样复用；经理模式所有外发走它，保证"行先落库再推流" |
| 拆解为可执行工作（task/risk/acceptance） | `app/services/task_decomposition.py:103` `analyze_requirement` + `:187` `apply_confirmed_plan` | 复用其 `stage=worker` 路径产出排期草稿；新增"经理拆解"调用点 |
| 排期/DDL ↔ 日历事件 | `app/services/schedule.py:45` `sync_requirement_due_event` | 复用；催办/提醒挂在 `ScheduleEvent` 与 `Reminder` 上 |
| 私有通知（按身份隔离，禁跨用户泄漏） | `app/services/notifications.py:94-105` `publish_notification`（仅发到 `user:{id}` topic，由 `/stream/me` 订阅；曾因发 `all` 致泄漏，已修复） | 沿用隐私红线（[NFR-08](../../prd/2026-06-04-workhub-prd.md)），简报/催办只发给目标人 |
| 质量复审（第 4 道失败检查） | `app/services/auto_agent.py:544` `llm_review` | 经理模式"人产出后 AI 再审"复用同一 reviewer，仅把输入从"AI 产出"换成"人产出" |
| 进度记录（"心跳"） | `models.py:408` `RequirementProgressUpdate`（`kind/body/phase/progress_percent`；**无** `blocked_reason`） | 催办读它判断"该不该催"；人回写进度即"心跳" |
| 阻塞标记 | `models.py:388` `RequirementWorkspace.blocked_reason`（注意：阻塞挂在工作区上，不在 `ProgressUpdate`） | 催办 R4 读它把阻塞升级给负责人 |

> **去黑话纪律**：经理模式的所有外发文案对用户都是人话。内部叫 `EscalationEvent` / `Proposal`，对用户说"这个活我先卡住了，建议找 X 来做" / "我把 Y 整理好了，确认采纳？"。术语映射见 [`00-overview/glossary-dejargon.md`](../../00-overview/glossary-dejargon.md)。

---

## 1. 在状态机中的位置

经理模式是 `WorkItem` 状态机里 `escalated → pm_mode` 这一段的**驱动器**。完整状态机见 [`data-model.md`](../01-architecture/data-model.md#workitem-状态机)；这里只画经理模式相关子图（演进自现有 `models.py:328` 的 `draft|clarifying|…|revision_requested|accepted` 串行机）。

```
                         (来自 confidence-risk-escalation.md 的三触发器之一)
ai_working ──escalate──► escalated
                            │  PMOrchestrator.on_escalated()
                            ▼
                          pm_mode ──────────────────────────────────────────┐
                            │                                                │
        ┌───────────────────┼───────────────────┬──────────────┐            │
        ▼ (S1)              ▼ (S2)               ▼ (S3)         ▼ (S4)        │
   生成升级简报        派活提议(StaffingProposal)  拆解+排期      催办/提醒循环  │
   (EscalationBrief)   →人确认/调整              →人确认计划     (定时,无需人确认│
        │                   │                     │             触发,但动作=提议)│
        └─── 全部经"提议→确认"阻塞原语，人未确认则停在 awaiting_human ───────┘
                            │ 人确认派活 & 计划
                            ▼
                     human_doing (被指派的人在自己 Branch 上干，AI 辅助)
                            │ 人回写"我做完了"/上传产物
                            ▼ (S5) PMOrchestrator.on_human_output()
                     ai_re_review (复用 llm_review 审人产出)
                       ├─ pass ─► (S6) 协助生成 Proposal ─► in_review ─►(负责人审)─► merged
                       └─ fail ─► 回到 human_doing(带 AI 修改建议) 或 再次 escalate
```

**关键不变式**：
- **I1（不替人决策）**：`pm_mode` 下任何"改变现实"的动作（指派人、改 DDL、合并）都必须先成为一条 `PendingDecision`（阻塞原语，见 §6），人 `confirm` 后才执行。AI 可以**自动触发**催办/提醒（定时任务无需人点），但催办**内容**仍是"建议你催一下 X，确认发送？"或按用户预置的 allow 规则自动发（见 [`review-and-approval.md`](../../03-collaboration/review-and-approval.md) 的"永远允许"沉淀）。
- **I2（单一可信源）**：经理模式不直接写 `main`；人产出经 AI 再审 → Proposal → 负责人审 → 合并，与 AI 工人产出走**同一条** Proposal 通道（[`branch-proposal-merge.md`](../../03-collaboration/branch-proposal-merge.md)）。
- **I3（可解释）**：S1–S6 每一步都附人话理由 + 证据引用（[`explainability.md`](./explainability.md)）。

---

## 2. 激活条件（Activation）

经理模式**不自己判断**该不该升级——它是 `EscalationEvent` 的**消费者**。点火逻辑（不合格 / 不满意 / 明确禁止 / doom-loop / 超预算）完整定义在 [`confidence-risk-escalation.md`](./confidence-risk-escalation.md)。本篇只规定**握手契约**。

### 2.1 入口：`EscalationEvent`（由分级裁决或触发器写入）

> **结构归属（防双源漂移）**：`EscalationEvent` 的**权威字段定义**在 [`confidence-risk-escalation.md §2.2`](./confidence-risk-escalation.md)（含 `handoff_json` / `suggested_assignees` / `target_user_id` / `resolved_at` 等）。本篇只列**经理模式作为消费方**直接读写的子集，**枚举/类型一律以上游为准**。

```python
# 数据结构（PG 表 escalation_events；权威定义见 confidence-risk-escalation.md §2.2，此处为消费视图）
@dataclass
class EscalationEvent:
    id: str                        # uid
    work_item_id: str              # FK work_items
    agent_run_id: str | None       # 触发升级的那次 AgentRun（含 trace），可为 None（纯人工/人工保留触发）
    trigger: str                   # 见下枚举（以 confidence-risk-escalation.md §6.1 为准）
    reason_md: str                 # 人话："为什么卡住"（来自 llm_review.reason / RevisionRequest.reason_md / HumanOnlyPolicy）
    handoff_md: str                # 结构化交接件「已做/未做/下一步/卡点」(Markdown，FR-WORKER-003)
    confidence_record_id: str | None  # 关联的 ConfidenceRecord（数值不外露给用户）
    risk_tier: str                 # low | medium | high（口径以 confidence-risk-escalation.md §2.2 为准；决定简报语气与默认审批人）
    target_user_id: str | None     # 人确认后的最终接手人（上游 §2.2）
    created_at: datetime
    # 经理模式推进的状态（口径同上游 §2.2 的 status）：
    status: str = "open"           # open | acknowledged | staffed | resolved | cancelled
    resolved_at: datetime | None = None
```

> 注：上游 `status` 无 `briefed`/`abandoned`。本篇映射：S1 简报发出 → `acknowledged`（已确定接手人）；S2 派活确认 → `staffed`；合并完成 → `resolved`；经理模式被取消（§9）→ `cancelled`。合并产物用 `resolved_proposal_id` 记在 Proposal/WorkItem 关联上（§7.3），不占 `EscalationEvent` 字段。

`trigger` 枚举（**以 [`confidence-risk-escalation.md §6.1`](./confidence-risk-escalation.md) 为权威**）：

| `trigger` | 中文 | 对应现有零件 | 默认 `risk_tier` 影响 |
|---|---|---|---|
| `unqualified` | 不合格 | `auto_agent.py:544` `llm_review` 判 `meets_requirement=false`（编排处 `auto_agent.py:651`） | 不变（取产出本身风险） |
| `user_unsatisfied` | 用户不满意（打回） | `RevisionRequest`（`models.py:535`，`reason_md` 必填） | 由早期 `user_rejected` 同义项收敛而来 |
| `user_forbidden` | 用户明确不让 AI 干 | `HumanOnlyPolicy` 三级开关（work_item/project/user，上游 §2.3） | 通常人来做，简报偏"派活" |
| `doom_loop` | 卡住（连续 N 次相同动作） | 工人循环检测（[`agent-loop-and-tools.md`](./agent-loop-and-tools.md) 命中即 `trigger=doom_loop`） | 提一档 |
| `budget_exhausted` | 超预算 | `MAX_TURNS=15` / `TOTAL_TIMEOUT_DEFAULT=300s`（`auto_agent.py:36-37`） | 不变 |

### 2.2 激活时序（`on_escalated`）

```
confidence-risk-escalation 写入 EscalationEvent(status=open)
        │  并 publish 事件 escalation.created（topic/契约见 §8.1）
        ▼
PMOrchestrator.on_escalated(event):                 # 幂等：以 event.id 去重
  1. 校验 WorkItem.status == 'ai_working'/'in_review' → CAS 置 'escalated'（行级锁，见 §8 边界）
  2. 终止/冻结仍在跑的 AgentRun（若 agent_run_id 存在且 active）——优雅停（结构化交接），不杀进程
  3. 装载上下文：handoff_md + 受阻 Branch 的快照 + WorkItem README(规格页) + 历史 ProgressUpdate
  4. 置 WorkItem.status='pm_mode'，EscalationEvent 保持 'open'；S1 简报发出后置 'acknowledged'
  5. 通过 lifecycle.queue_status_notifications 写"已升级"里程碑（见 §3 文案）
```

**幂等与并发**：`on_escalated` 必须可重入（SSE 重投、定时器重触发）。用 `EscalationEvent.status` 单调推进 + WorkItem 状态 CAS 防止两个 worker 同时把一个 WorkItem 推入经理模式（PG `SELECT … FOR UPDATE`，对应 D-2 行级锁动机）。

---

## 3. S1 — 升级简报（Escalation Brief）

**FR-PM-001（P0）**：升级后 AI 自动生成"**为什么升级 + 建议谁来做 + 计划**"的可读简报。

简报是经理模式的**第一份对人产物**，发给"该接手的人"（默认 = WorkItem 负责人；`human_reserved`/高风险时按审批路由解析，见 [`review-and-approval.md`](../../03-collaboration/review-and-approval.md)）。

### 3.1 数据结构 `EscalationBrief`

```python
@dataclass
class EscalationBrief:
    id: str
    escalation_event_id: str       # FK
    work_item_id: str
    # 三段式（对用户一律人话，禁数值阈值/git 术语）：
    why_md: str                    # 为什么升级：从 reason_md + handoff_md 提炼，附 trace 引用
    who_suggestion: "StaffingProposal | None"  # 建议谁来做（来自 smart-staffing；冷启动可为 None→解释式）
    plan_md: str                   # 计划：拆解+排期草稿的人话摘要（详见 S3）
    evidence_refs: list[dict]      # [{kind:'trace'|'file'|'review'|'progress', ref:..., quote:...}]
    generated_by: str = "ai"
    created_at: datetime
    # 阻塞确认：
    decision_id: str | None = None # 关联 PendingDecision（人对"是否照此推进"拍板）
```

### 3.2 生成算法

```
build_brief(event):
  why  = summarize(event.reason_md, event.handoff_md, trace=event.agent_run_id)   # LLM，附引用
  who  = smart_staffing.propose(work_item, exclude=[已证明做不了的 AI])            # 见 smart-staffing.md；失败→None
  plan = decompose_and_schedule(work_item, stage='worker')                        # S3，先出草稿
  brief = EscalationBrief(why_md=why, who_suggestion=who, plan_md=plan.human_summary, evidence_refs=...)
  decision = open_pending_decision(kind='approve_brief', payload=brief, approver=resolve_approver(event))
  brief.decision_id = decision.id
  publish('pm.briefed', {...}); lifecycle 通知 approver
  return brief                       # WorkItem 停在 pm_mode/awaiting_human，等 confirm
```

- **`who_suggestion` 为空（冷启动）**：不阻断；简报照发，`plan_md` 里写"我还不了解谁擅长这个，请你指定负责人"，把人选交回人决定（[`smart-staffing.md`](./smart-staffing.md) 的冷启动降级）。
- **`why_md` 强制引用**：延续"grep + 强制引用"范式与 `llm_review.reason` 的可读性约定（`auto_agent.py:541` 要求 reason 用用户语言）。无证据不下结论。

### 3.3 文案（去黑话）

在 `lifecycle._MILESTONES` 风格的事件表里新增（沿用 `str.replace` 安全替换，**不可**用 `str.format`，理由见 `lifecycle.py:124-127`：昵称/标题含 `{` 会让 `str.format` KeyError 甚至泄漏属性访问）：

| 里程碑 key | recipients | type | title 模板 | body 模板 | severity |
|---|---|---|---|---|---|
| `escalated` | `owner` | `workitem.escalated` | `{code} 需要你来定一下` | `这个活我先卡住了：{reason_oneline}。我建议这么推进，看一眼？` | `high` |
| `pm_briefed` | `owner` | `workitem.pm_briefed` | `{code} 我整理好了推进方案` | `为什么卡 / 建议谁做 / 计划都列好了 — 确认或调整` | `high` |

> **两处现成代码必须扩展（否则文案不生效）**：
> 1. 现有 `render()` 的替换表 `subs`（`lifecycle.py:129-139`）只覆盖 `{code}/{title}/{label}/{actor}` 四键——新增的 `{reason_oneline}` 占位**需把它加进 `subs`**（取 `why_md` 首句），否则会原样透传给用户。
> 2. 现有 `_resolve_recipients`（`lifecycle.py:77`）只解析 `submitter / assignees / other_side`——经理模式的 `owner`（WorkItem 负责人；`human_reserved`/高风险按审批路由解析）是**新增 recipient 角色**，需扩展该函数。

> 用户**永远看不到** `trigger=doom_loop`、`confidence` 数值、`Branch`/`Proposal` 等词。`{reason_oneline}` 由 `why_md` 取首句（去黑话映射见 [`glossary-dejargon.md`](../../00-overview/glossary-dejargon.md)）。

---

## 4. S2 — 调用智能派活（Staffing Proposal）

**FR-STAFF-002/003（P0）**：有新 WorkItem（含升级后的）时，AI **提议** 负责人 + 协作人 + 推荐理由；推荐必须可被人**一键确认或调整**。

经理模式**不自己实现**匹配算法——它调用 [`smart-staffing.md`](./smart-staffing.md) 暴露的 `propose(work_item, context) -> StaffingProposal`，把结果包进简报（S1）或单独发起改派。本篇定义**消费契约 + 确认/纠正回流**。

### 4.1 契约 `StaffingProposal`（本篇为消费方，结构定义以 smart-staffing.md 为准）

```python
@dataclass
class StaffingProposal:
    id: str
    work_item_id: str
    lead: "StaffingCandidate"              # 提议负责人
    collaborators: list["StaffingCandidate"]
    rationale_md: str                      # "为什么推荐他"——必带（FR-EXPLAIN-001）
    cold_start: bool                       # True=无历史，解释式推荐
    decision_id: str | None = None         # 人对此提议的确认/调整

@dataclass
class StaffingCandidate:
    user_id: str
    nickname: str
    role: str                              # 'lead' | 'collaborator'（对齐 RequirementAssignment.role，models.py:370）
    why_md: str                            # 单人理由（技能命中 / 既往命中率 / 当前负载）
```

### 4.2 人确认后落地（复用现有 Assignment）

人 `confirm`（或调整后 confirm）→ 写 `RequirementAssignment`（`models.py:363`，`role ∈ {lead, collaborator}`，`assigned_by_user_id = 确认人`）。这复用现有"lead + N collaborators"模型（PRD 领域表 `Assignment`），**不新造**指派表。

```
on_staffing_confirmed(proposal, final_assignment, confirmer):
  upsert RequirementAssignment rows (唯一约束 uq_requirement_assignment_user 防重，models.py:365)
  WorkItem.status: pm_mode → human_doing
  schedule.sync_requirement_due_event(...)  # 把被指派人纳入 DDL 日历事件参与者（schedule.py:45）
  lifecycle.queue_status_notifications(new_status='assigned')  # 通知被指派人"你被指派到 {code}"
  若 proposal 被人改过 → 记 StaffingCorrection（FR-STAFF-005 回流，见 §4.3）
```

### 4.3 纠正回流（`StaffingCorrection`，FR-STAFF-005 P2）

人推翻 AI 推荐时记录差异，回喂 smart-staffing 改进后续（本篇只产生事件，模型更新在 [`smart-staffing.md`](./smart-staffing.md)）：

```python
@dataclass
class StaffingCorrection:
    proposal_id: str
    suggested_lead: str            # AI 提议
    chosen_lead: str               # 人实选
    suggested_collaborators: list[str]
    chosen_collaborators: list[str]
    corrected_by: str
    created_at: datetime
```

---

## 5. S3 — 拆解 / 排期 / 催办 / 提醒

**FR-PM-002（P1）**：AI 自动排期并按计划设置提醒/催办。

### 5.1 拆解（复用 `task_decomposition`）

经理模式调用现有 `analyze_requirement(req, stage='worker', actor=<ai>)`（`task_decomposition.py:103`），产出 `Decomposition{summary, risks, estimate_hours, estimate_confidence, items[]}`，`items.type ∈ {task, risk, acceptance}`。失败有本地 `_fallback`（`:65`），**不崩**。

人确认计划后落地走现有 `apply_confirmed_plan`（`:187`）：`stage='worker'` 路径把 `task` 项写成 `RequirementWorkspaceItem(status='todo')`（`models.py:396`）。**经理模式不绕过这条路径**，保证 web/桌宠两端看到的待办与现有一致。

### 5.2 排期（复用 `schedule`）

- WorkItem 的 `due_at`/`start_at` 一旦确定，调 `sync_requirement_due_event`（`schedule.py:45`）维护一条 `event_type='requirement_due'` 的 `ScheduleEvent`（`models.py:250`），参与者 = `participant_ids_for_requirement`（提交者 + assignees + claimer，`schedule.py:11`，自动去重）。
- 计划里每个 `task` 项的子 DDL → 经理模式可派生 `ScheduleEvent(event_type='task_due')`（新增枚举值），同样进日历。

### 5.3 催办 / 提醒 —— 规则引擎

经理模式跑一个**定时巡检**（headless daemon 内的周期任务；对应现有 `BackgroundJob` + push 机制），对每个 `human_doing` 的 WorkItem 评估是否该催/该提醒。**触发是自动的，发送动作仍按 §6 的 allow/ask 决定是否需人确认。**

**催办规则表**（`reason` 越靠前优先级越高，命中即停）：

| # | 条件（全部用 server 时钟，UTC） | 动作 | `severity` | 去重键 |
|---|---|---|---|---|
| R1 | `due_at` 已过且未交付（无 `delivered_at`） | 升级催办 → 提议负责人介入/改派 | `high` | `overdue:{wi}:{day}` |
| R2 | `due_at - now < 24h` 且 `progress_percent < 100` | 临期提醒被指派人 | `high` | `due_soon:{wi}` |
| R3 | 最近一条 `RequirementProgressUpdate` 距今 > `STALE_HOURS`（默认 48h） | "好久没动静了，需要帮忙吗？" | `normal` | `stale:{wi}:{day}` |
| R4 | 有 `RequirementWorkspace.blocked_reason` 非空 | 把阻塞升级给负责人/相关人 | `high` | `blocked:{wi}:{hash(reason)}` |
| R5 | `PendingDecision`（任意来源）超 `DECISION_SLA`（默认 12h）未响应 | 催审批人 + 按路由可升级/委派 | `high` | `decision_sla:{decision}` |

**催办判据靠真实进度信号**：R3 读 `RequirementProgressUpdate.created_at`（`models.py:408`），人**回写进度即"心跳"**，重置 staleness；R4 读 `RequirementWorkspace.blocked_reason`（`models.py:388`）。这样催办不是盲目定时骚扰，而是"看见没动/被卡才催"。

**节流与去重**（沿用现有通知去重范式）：
- 每条催办落 `Notification`，`dedupe_key` 见上表（复用 `notifications.create_notification` 的 `dedupe_key`，`models.py:158`），**同一天同一原因只发一次**。
- 全局每用户催办频率上限可由用户设边界（FR-PET-004），默认"工作时段、每 WorkItem 每天≤1 次主动催办"。
- 发送一律走 `lifecycle.flush_status_notifications`（commit 后推 SSE）+ `notifications.publish_notification`（**仅**发 `user:{id}` topic，由 `/stream/me` 订阅，禁跨用户泄漏，`notifications.py:105`）。

```python
# 催办巡检（每 N 分钟）伪码
def catchup_sweep():
  for wi in work_items_in('human_doing'):     # 批量、分页、读时不持长锁
    rule = first_matching([R1,R2,R3,R4,R5], wi, now=utcnow())
    if not rule: continue
    notice = render_human(rule, wi)            # 人话文案，含 target_url=/r/{wi}
    if needs_confirm(rule, actor='ai'):        # §6：未沉淀 allow 规则 → 先 PendingDecision
        open_pending_decision(kind='send_catchup', payload=notice, approver=owner_of(wi))
    else:
        # 催办不是状态跃迁，不走 _MILESTONES；直接复用底层 create_notification
        # （即 queue_status_notifications 内部所用，lifecycle.py:145），带上表 dedupe_key
        rows = [create_notification(db, target, **notice, dedupe_key=rule.dedupe_key)]
        commit(); await flush_status_notifications(rows)   # commit 后推 user:{id}
```

---

## 6. 贯穿原语：提议 → 人确认（`PendingDecision`）

经理模式所有"改变现实"的动作都经此阻塞原语（借鉴 opencode 的"审批=阻塞原语"）。这是 [`review-and-approval.md`](../../03-collaboration/review-and-approval.md) 里**审批/permission** 的一个特例视图；本篇只列经理模式用到的 `kind` 与默认决策档。

```python
@dataclass
class PendingDecision:
    id: str
    work_item_id: str
    kind: str                      # 见下表
    payload_json: str              # 被提议的具体内容（brief / staffing / catchup / proposal …）
    proposed_by: str = "ai"
    approver_user_id: str          # 谁该拍板（审批路由解析，见 review-and-approval.md）
    status: str = "pending"        # pending | confirmed | adjusted | rejected | timed_out | delegated
    decision_note_md: str | None = None  # 人若 adjust/reject 的理由 → 回灌
    sla_deadline: datetime | None = None # 超时 → 触发 R5 催办 / 委派
    created_at: datetime
    decided_at: datetime | None = None
```

| `kind` | 含义 | 默认档（未配 allow 规则时） | 拒绝/调整理由去向 |
|---|---|---|---|
| `approve_brief` | 是否照简报推进 | `ask` | adjust → 改派/改计划 |
| `confirm_staffing` | 确认/调整负责人+协作人 | `ask` | 调整 → `StaffingCorrection` 回流（§4.3） |
| `confirm_plan` | 确认拆解+排期 | `ask`（低风险可 allow 沉淀） | reject → 重新拆解 |
| `send_catchup` | 发催办/提醒 | 低风险 `allow` 可沉淀；默认 `ask` | — |
| `accept_proposal` | 采纳人产出的 Proposal（即合并） | **始终 `ask`**（合并 main 不可自动） | reject → 带理由回 `human_doing`（§5.5 of escalation 回灌一致） |

**默认就问**：未命中任何 allow/deny 规则一律 `ask`（PRD FR-PERM-001）。"永远允许"可由用户对低风险 `kind`（如 `send_catchup`）沉淀成自动规则，逐步减少打扰（学习机制在 [`review-and-approval.md`](../../03-collaboration/review-and-approval.md)）。

---

## 7. S5 — 人产出后 AI 再审；S6 — 协助生成 Proposal

**FR-PM-003（P1）**：人完成后，AI 协助把产物整理为可审的 Proposal。

### 7.1 触发

人在自己 Branch 上回写"我做完了"（或上传交付物）→ `on_human_output(work_item, branch, actor)`。WorkItem `human_doing → ai_re_review`。

### 7.2 AI 再审（复用 `llm_review`）

复用 `auto_agent.py:544` 的 `llm_review(req_title, summary_md, workdir)`，**只换输入源**：从"AI 工人 outputs/" 换成"人产出的 Branch 内容/上传交付物目录"。返回 `(meets_requirement: bool, reason: str)`（reason 用用户语言，`:541`）。

```
on_human_output(wi, branch, actor):
  ok, reason = await llm_review(wi.title, wi.summary_md, branch.workdir)
  # 同时逐条核对验收清单（RequirementAcceptanceItem, models.py:464）→ 命中率
  checklist = score_acceptance(wi.acceptance_items, branch)   # 见 confidence-risk-escalation.md 的清单命中
  if ok and checklist.all_pass:
      go S6 (assist_build_proposal)
  else:
      # 不满意 → 带 AI 修改建议回 human_doing（不是再丢给 AI 工人；人在做）
      write ProgressUpdate(kind='ai_review_feedback', body=reason)
      WorkItem.status: ai_re_review → human_doing
      lifecycle 通知 actor "我看了一下，这两处建议再调一下：…"（人话 reason）
      若反复 N 次仍不过 → 可再 escalate（回 §2，trigger=quality_failed）
```

> 注意区别：AI 工人产出不合格 → 触发器 `quality_failed` → 升级找人；**人产出**不合格 → AI **不**替人重做，而是给建议让人改（人是劳动力时 AI 是辅助/PM）。这守住"经理模式下 AI 不静默替人决策"（I1）。

### 7.3 S6 — 协助生成 Proposal（仍是"提议→确认"）

再审通过后，AI **协助**把人产物整理成可审的 `Proposal`（去黑话 PR；结构见 [`branch-proposal-merge.md`](../../03-collaboration/branch-proposal-merge.md)）：自动起草 Proposal 标题/摘要/变更说明/对照验收清单的勾选，但**提交动作 = `PendingDecision(kind='accept_proposal')`**——

- 发给 WorkItem **负责人**审（`in_review`）。
- 负责人 `approve` → `merged`（汇入 main）；`reject` 带理由 → 理由回灌、回 `human_doing`（与打回回灌口径一致，见 [`confidence-risk-escalation.md`](./confidence-risk-escalation.md)）。
- 合并成功 → 回填 `EscalationEvent.status='resolved'`、`resolved_proposal_id`，关闭本次经理模式编排。

---

## 8. 事件与 API 契约（增量）

完整 OpenAPI 路由组与全量事件清单见 [`api-contract.md`](../01-architecture/api-contract.md)；这里只列**经理模式新增/复用**的契约面。所有事件经 SSE/WS 推送（NFR-07），私有事件按身份隔离（NFR-08）。

### 8.1 SSE/WS 事件

> **topic vs 端点（精确化）**：`user:{id}` 是**topic**，客户端通过 `/stream/me` 端点订阅（topic 由 cookie/令牌解析的 `user.id` 派生，客户端无法请求他人流，见 [`api-contract.md §5.3`](../01-architecture/api-contract.md) + `push.py:99`）。`req:{id}` 与 `workitem:{id}` 是同一可见性门下的**别名**（[`api-contract.md §5.3`](../01-architecture/api-contract.md)）。下表 topic 列写真实 topic，不写订阅端点。事件名以 [`api-contract.md §5.2`](../01-architecture/api-contract.md) 为权威。

| event `type` | topic | data（要点） | 用户侧呈现 |
|---|---|---|---|
| `escalation.created` | `workitem:{wi}` + 目标人 `user:{id}` | `{event_id, trigger, reason_oneline}` | 桌宠："这个活我先卡住了…" |
| `pm.briefed` | owner `user:{id}` | `{brief_id, decision_id, why_oneline}` | "我整理好推进方案了，看一眼？" |
| `staffing.proposed` | owner `user:{id}` | `{proposal_id, lead, collaborators[], cold_start}` | "建议让 X 牵头、Y 协作（原因…）确认？" |
| `pm.catchup` | 目标人 `user:{id}` | `{wi, rule, target_url}` | 催办/临期/阻塞提醒 |
| `pm.re_review` | actor `user:{id}` | `{ok, reason_oneline}` | "我看过了：通过 / 这两处再调一下" |
| `proposal.ready_for_review` | owner `user:{id}` | `{proposal_id, decision_id}` | "我把成果整理好了，确认采纳？" |
| `escalation.resolved` | `workitem:{wi}` | `{event_id, proposal_id}` | "搞定了 ✅" |

> **事件名对齐**：`escalation.created`（非 `escalation.opened`）取自 [`api-contract.md §5.2`](../01-architecture/api-contract.md) 的 WorkHub 新增事件清单；命门侧 [`confidence-risk-escalation.md`](./confidence-risk-escalation.md) 旧稿写作 `escalation.opened` 且发 `req:<id>+all`——**以 api-contract 为准**：私有/带 `trigger` 的事件**不发 `all`**，走 `workitem:{id}`（经可见性门）+ 目标人 `user:{id}`。
>
> 复用现有发布通道：里程碑类走 `lifecycle.flush_status_notifications`→`notifications.publish_notification`（commit 后发到 `user:{id}`，`notifications.py:105`，**仅本人私有频道**）；细粒度进度类走 `push_bus.bus.publish(f"req:{wi}", type, data)`（`auto_agent.py:507` 同款）。**禁止**再向全局 `all` topic 发带正文/`trigger` 的私有内容（`notifications.py:94-103` 的跨用户泄漏教训）。

### 8.2 HTTP（REST，OpenAPI 化）

| 方法 路径 | 作用 | 鉴权/门 |
|---|---|---|
| `GET /api/workitems/{id}/escalation` | 取当前 `EscalationEvent` + `EscalationBrief` | 参与者可读 |
| `POST /api/decisions/{id}/confirm` | 确认一个 `PendingDecision`（brief/staffing/plan/catchup/proposal） | `approver` 本人 |
| `POST /api/decisions/{id}/adjust` | 调整后确认（带 `payload` 覆盖 + `decision_note_md`） | 同上 |
| `POST /api/decisions/{id}/reject` | 打回（`reason` 必填 → 回灌） | 同上 |
| `POST /api/decisions/{id}/delegate` | 委派给他人（审批路由） | 同上 / admin |
| `POST /api/workitems/{id}/human-output` | 人声明完成/上传产物 → 触发 S5 | 被指派人；**设备令牌门**（接活/干活需桌面客户端，见 README §1） |

> **设备令牌门延续**：`human-output` 等"干活类"高权限操作要求桌面客户端、服务端校验设备令牌（D-3 / README §1）；浏览器（C-WEB）能做的是审批/确认/改派类（`/decisions/*`）。

---

## 9. 边界条件与失败处理

| 场景 | 处理 |
|---|---|
| **重复升级**（同 WorkItem 短时内多次触发） | `on_escalated` 以 `EscalationEvent.id` 幂等；WorkItem 已在 `pm_mode` 则把新触发**并入**当前 event 的 `handoff_md`（追加），不另起编排 |
| **并发把同一 WorkItem 推入经理模式** | WorkItem 状态 CAS + PG 行级锁（`SELECT … FOR UPDATE`，D-2 动机）；败者放弃 |
| **`llm_review` LLM 调用失败** | 同 `auto_agent.py:571-572` 容错（`except Exception: return False, "复审 LLM 调用失败…"`）：**降级为人工抽检**（生成 `accept_proposal` 决策直接让负责人看），不阻断流程 |
| **拆解 LLM 失败** | `task_decomposition._fallback`（`:65`）给本地草稿，简报照发并标注"AI 草稿，请人工确认" |
| **smart-staffing 无候选/冷启动** | 简报 `who_suggestion=None`，转"请你指定负责人"；不空转、不瞎指派 |
| **审批人长期不响应** | R5 催办 + `sla_deadline` 到点按路由升级/委派（`/decisions/{id}/delegate`）；仍无人 → WorkItem 保持 `pm_mode/awaiting_human` 并在看板标"等待拍板"（不静默丢） |
| **人产出反复不过审** | S5 计数；超阈值再 `escalate(trigger=quality_failed)`，避免人 ↔ AI 死循环（与工人侧 doom-loop 对称） |
| **催办风暴** | `dedupe_key` 天级去重 + 每用户频率上限（FR-PET-004）；用户可设静默时段 |
| **经理模式被取消**（WorkItem `cancelled`） | `EscalationEvent.status='cancelled'`（对齐上游 §2.2 枚举），清理未决 `PendingDecision`（置 `rejected/timed_out`），发 `requirement.cancelled` 通知（复用 `lifecycle._MILESTONES['cancelled']`） |
| **通知发布失败** | `flush_status_notifications` 吞异常、记日志，行已落库，下次轮询补显（`lifecycle.py:164` 既有保证） |
| **跨用户隐私** | 简报/催办/再审反馈一律走 `user:{id}` topic（`/stream/me` 订阅），按 `approver`/被指派人/actor 精确投递（NFR-08；`notifications.py:105`） |

---

## 10. 与其他文档的边界（避免重复）

| 主题 | 归属文档 |
|---|---|
| 置信度算法、风险维度、三触发器点火、打回回灌细节 | [`confidence-risk-escalation.md`](./confidence-risk-escalation.md) |
| 派活匹配打分、UserProfile/CollaborationGraph 输入、冷启动、纠正回流模型 | [`smart-staffing.md`](./smart-staffing.md) |
| 工人循环、工具契约、沙箱、预算、doom-loop 检测、快照回滚 | [`agent-loop-and-tools.md`](./agent-loop-and-tools.md) |
| 审批阻塞原语全貌、分层 allow/deny/ask、审批路由、SLA、委派、"永远允许"学习 | [`review-and-approval.md`](../../03-collaboration/review-and-approval.md) |
| Branch/Proposal/合并的数据与流程、对象合并语义 | [`branch-proposal-merge.md`](../../03-collaboration/branch-proposal-merge.md) |
| 决策可解释、trace 呈现、grep 强制引用 | [`explainability.md`](./explainability.md) |
| WorkItem 全量字段、完整状态机、软删除/审计字段 | [`data-model.md`](../01-architecture/data-model.md) |
| 全量 OpenAPI 路由、事件清单、鉴权中间件、设备令牌门 | [`api-contract.md`](../01-architecture/api-contract.md) · [`system-architecture.md`](../01-architecture/system-architecture.md) |
| git 黑话 ↔ 用户用语权威映射 | [`00-overview/glossary-dejargon.md`](../../00-overview/glossary-dejargon.md) |
