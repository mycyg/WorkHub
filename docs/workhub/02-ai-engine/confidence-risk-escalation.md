---
module: P-AI
layer: L2
status: 🚧
owner: workflow
---

# 置信度 / 风险分级与升级（命门）

> 本篇是 WorkHub「AI 干、人把关」反转的**裁决中枢**：每次 AI 产出都被打一个**置信度**与一个**风险**评分，二者交叉落到**分级阈值表**上，决定三种处置之一——**直接合并 / 人工抽检 / 升级换帽**。三个升级触发器全部映射现有真实零件。
>
> 上游：[PRD §8.2](../../prd/2026-06-04-workhub-prd.md)（FR-ESC-001~005、FR-WORKER-003）、[规格树索引](../README.md)。
> 同层先读（口径以其为准，本篇不重复长篇）：[`agent-loop-and-tools.md`](./agent-loop-and-tools.md)（工人循环、控制信号 `continue/stop/compact/escalate`、预算、doom-loop、快照）、[`pm-mode-orchestration.md`](./pm-mode-orchestration.md)（升级后的经理模式）、[`smart-staffing.md`](./smart-staffing.md)（升级后派给谁）、[`explainability.md`](./explainability.md)（理由与证据的人话呈现）。
> 地基交叉（**已在磁盘，字段/枚举名以其为权威**）：[`../01-architecture/data-model.md`](../01-architecture/data-model.md) §7.3/§7.4（`ConfidenceRecord` / `EscalationEvent` 的 ER 收口字段、`Snapshot`、WorkItem 状态机全转移）、[`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md) §3（去黑话三档语气，**裸数值绝不进用户面**）。`api-contract.md`（事件类型清单与路由）仍待落定，先按规格树文件名前向引用。
>
> **字段名对齐声明**：data-model.md 是实体/字段的 ER 收口处。本篇沿用其权威字段名——置信度档=`grade`、风险档=`risk_level`、裁决=`verdict ∈ {auto_merge, human_spotcheck, escalate}`、依据=`signals_json`（风险五维落 `signals_json.risk.*`）、人话理由=`rationale_md`、触发器枚举=`{unqualified, user_unsatisfied, user_forbidden, doom_loop, budget_exhausted}`；本篇在其之上**深化机制**并提出若干增量字段（`round`/`policy_version`/`model`/`calibration_bucket`/`handoff_md`），这些增量并入 data-model.md 时以其最终命名为准。
> 参照代码（已读以扎根）：`app/services/auto_agent.py`、`app/routers/auto.py`、`app/routers/deliveries.py`、`app/routers/requirements.py`、`app/services/lifecycle.py`、`app/models.py`。

---

## 0. 范围与非范围

**本篇定义**：
- 置信度的**四个来源**与**聚合算法**（`llm_review` / 验收命中率 / AI 自评 / 历史校准）。
- 风险的**五个维度**与**评分**。
- **分级阈值表**（高 / 中 / 低·高风险·卡住）与处置。
- **三触发器**到现有代码的精确映射，加两个自动升级信号（doom-loop / 预算耗尽）。
- 打回**带理由回灌**的数据流与状态流。
- `ConfidenceRecord` / `EscalationEvent` 的字段级数据结构、SSE 事件契约、边界与失败处理。

**本篇不定义**（在邻篇）：升级后经理模式怎么编排（[`pm-mode-orchestration.md`](./pm-mode-orchestration.md)）；派给谁、冷启动降级（[`smart-staffing.md`](./smart-staffing.md)）；工人循环内部如何发 `escalate` 信号、快照如何 revert（[`agent-loop-and-tools.md`](./agent-loop-and-tools.md)）；分层 allow/deny/ask 权限与审批路由（[`../03-collaboration/review-and-approval.md`](../03-collaboration/review-and-approval.md)、[`../01-architecture/security-and-permissions.md`](../01-architecture/security-and-permissions.md)）。

> **现状基线（必须诚实标注）**：今天 `auto_agent.py` 只有 `llm_review` 这**一个**通过/不通过的二值判分（`auto_agent.py:544`），失败一律 `status → ready` 转人工（`auto.py:242`），打回理由 `RevisionRequest.reason_md` 落库但**不回灌**给 AI（`deliveries.py:305`、状态只回到 `doing` 给人，`requirements.py:282`）。本篇把这个二值判分**扩成连续置信度 + 风险二维裁决**，并补齐回灌闭环——这是 P1 旗舰的核心增量，不是已实现的复述。

---

## 0.1 R0 v1 默认策略（先施工，后校准）

> **2026-06-08 R0 锁定口径**：Claude 审查报告指出 OQ-2/OQ-3 不能继续停留在“责任人待定”。R0 起，R1/R2 施工先采用本篇 v0.1 默认策略：`policy_version = confidence-risk-v0.1-r0-2026-06-08`；策略 owner 为 **WorkHub product owner（mycyg）+ workflow implementation steward**，后续真实数据校准可改版本号但不得无版本热改。枚举统一用 `medium`，旧文档/旧 fixture 中的 `mid` 只作为兼容别名，生产 contract 不再新增 `mid`。

| 项 | R0 默认值 | 说明 |
|---|---|---|
| `policy_version` | `confidence-risk-v0.1-r0-2026-06-08` | 每条 `ConfidenceRecord` 必写入，便于回放与调参追责 |
| 责任人 | WorkHub product owner（mycyg）+ workflow implementation steward | 业务域 reviewer 后续可加入，但 R1 不再因“谁标定”停工 |
| 置信度权重 | `review=0.50`、`acceptance=0.35`、`self=0.15` | `self` 只降不升；缺失信号按 §3.5 重分配 |
| 置信度档 | `high >= 0.85` 且硬验收全过；`medium = [0.60, 0.85)`；`low < 0.60` 或硬失败 | 面向用户只渲染人话档位，不暴露分数 |
| 风险维度 | `reversibility`、`external`、`monetary`、`blast_radius`、`domain_gate` | 五维先等权输入，聚合仍由 max/mean 主导 |
| 风险聚合 | `risk_score = 0.6 * max(dims) + 0.4 * mean(dims)` | 单一红线足以拉高总风险 |
| 风险档 | `low < 0.30`；`medium = [0.30, 0.60)`；`high >= 0.60` | 命中硬升档时直接 `high` |
| 硬升档 | `external=1` 或 `monetary=1` 或 `domain_gate=1` | 对外、涉钱/合规、需专业资质必须人拍板 |
| 失败姿态 | `llm_review` 不可用、JSON 不可解析、空产物、必过验收失败 → `grade=low` | 保守优先，不能把“看不清”当“通过” |

R0 默认策略的目标不是完美预测，而是让 R1 真实纵切能用同一套可审计规则跑起来。后续调参必须基于 `ConfidenceRecord`、`Review`、`EscalationEvent` 与 replay 结果，而不是凭感觉改阈值。

---

## 1. 概念与术语（去黑话锚点）

| 内部概念 | 用户看到的（人话） | 来源 |
|---|---|---|
| `ConfidenceRecord` | （不暴露实体）"我比较有把握" / "我不太确定，建议你扫一眼" | 新增 |
| `confidence_score` / `grade` 数值 | **绝不暴露数值/阈值**（PRD 宪法 §4、glossary §3.3 三档语气） | 新增 |
| `risk_level` | "这事改动较大 / 对外 / 涉钱，我先请你拍板" | 新增 |
| `EscalationEvent` | "这个我搞不定 / 不该我来，已经请人接手并安排好了" | 新增 |
| revision 回灌 | "你说的我记下了，按你的意见接着改" | 演进自 `RevisionRequest` |
| doom-loop | "我卡住了，反复试同一招没进展" | 借鉴 opencode |

> 凡对用户的呈现，统一走 [`explainability.md`](./explainability.md) 的"判断 + 人话理由 + 证据引用"三件套；本篇只产出**结构化裁决**，呈现层负责翻译。

---

## 2. 数据结构（字段 + 类型）

> 与 [`../01-architecture/data-model.md`](../01-architecture/data-model.md) 对齐：复用 `TimestampMixin`（`created_at/updated_at`）、`uid` 主键、软删除范式；PostgreSQL（D-2）下评分字段用 `Numeric`/`SmallInt`，JSON 依据用 `JSONB`。本篇给字段级定义，ER 归属由 data-model 收口。

### 2.1 `ConfidenceRecord`（命门·新增）

每个 `AgentRun` 产出一次终评即写一条；同一 WorkItem 多轮（打回重做）追加多条，`round` 单调递增，复用 `Delivery.round` 的版本语义（`models.py:521`）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `str(32)` PK | `uid()` |
| `work_item_id` | FK → WorkItem | 主轴（演进自 `Requirement`，`models.py:314`） |
| `agent_run_id` | FK → AgentRun | 哪次执行（演进自 `auto_process` 的一次运行） |
| `round` | `int` | 第几轮产出（对齐 `Delivery.round`） |
| `confidence_score` | `Numeric(4,3)` ∈ [0,1] | 聚合后置信度（§3.5）。data-model §7.3 同名 |
| `grade` | `str(8)` | `high` / `medium` / `low`（由 score + §4 阈值落档）。**R0 后 contract 权威枚举；旧 `mid` 仅兼容读** |
| `signals_json` | `JSONB` | 四来源置信度原始分/权重 + 风险五维逐项分（`signals_json.risk.*`，对齐 data-model §7.3 信号表 + §383 风险落点）。可解释/可审计/可标定的全部依据 |
| `risk_score` | `Numeric(4,3)` ∈ [0,1] | 聚合后风险（§5.2）。data-model §7.3 同名 |
| `risk_level` | `str(8)` | `low` / `medium` / `high`（§5.3）。**R0 后 contract 权威枚举；旧 `mid` 仅兼容读** |
| `verdict` | `str(16)` | 裁决：`auto_merge` / `human_spotcheck` / `escalate`（§6，与 data-model §7.3、§5 三分叉一致） |
| `rationale_md` | `Text` | 给人看的人话依据（喂呈现层）。data-model §7.3 同名 |
| `agent_run_id` | FK → AgentRun, nullable | 产出该结果的 run（data-model §7.3 同名） |
| `proposal_id` | FK → Proposal, nullable | 关联提议（若已生成，data-model §7.3 同名） |
| `round` | `int` | 第几轮产出（对齐 `Delivery.round`）。**本篇增量**，建入 data-model |
| `policy_version` | `str(32)` | 命中的阈值表/权重版本（§9，回溯用）。**本篇增量** |
| `model` | `str(64)` | 产出所用模型（成本/校准分桶，见 `settings.llm_model`）。**本篇增量** |
| `calibration_bucket` | `str(64)` | 历史校准分桶键（§3.4，如 `project:doc:llm-review`）。**本篇增量** |

```python
# 形态示意（落库见 data-model）
@dataclass
class ConfidenceRecord:
    work_item_id: str
    agent_run_id: str
    round: int
    confidence_score: float            # 0..1
    grade: str                         # high | medium | low（R0 contract）
    signals_json: dict                 # {"llm_review":{...}, "acceptance":{...}, "risk":{"reversibility":0.2,"external":1.0,...}}
    risk_score: float                  # 0..1
    risk_level: str                    # low | medium | high（R0 contract）
    verdict: str                       # auto_merge | human_spotcheck | escalate
    rationale_md: str
    policy_version: str                # 本篇增量
```

> **演进对照**：今天 `AutoOutcome`（`auto_agent.py:591`）已携带 `success / review_passed / review_reason / file_count / seconds`——这些是 `signals_json` 的**子集**。`ConfidenceRecord` 是 `AutoOutcome` 的超集化、二维化与持久化。

### 2.2 `EscalationEvent`（命门·新增）

任一升级触发器命中即创建一条，并驱动 WorkItem 进入经理模式（§7 状态流）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `str(32)` PK | `uid()` |
| `work_item_id` | FK → WorkItem | data-model §7.4 同名 |
| `agent_run_id` | FK → AgentRun, nullable | 哪次执行触发（人工保留开关触发时可空）。data-model §7.4 同名 |
| `confidence_id` | FK → ConfidenceRecord, nullable | 裁决依据（doom-loop/预算耗尽可能先于终评，故可空）。**data-model §7.4 权威名（非 `confidence_record_id`）** |
| `trigger` | `str(24)` | `unqualified` / `user_unsatisfied` / `user_forbidden` / `doom_loop` / `budget_exhausted`（与 data-model §7.4、§6.2/§6.3 一致） |
| `reason_md` | `Text` | 机器+人话的"为什么升级"（人话简报种子，FR-PM-001）。data-model §7.4 同名 |
| `handoff_json` | `JSONB` | **结构化交接件**：done[]/todo[]/blockers[]/artifacts[]（已做/未做/下一步/卡点，FR-WORKER-003，承接 `AgentRun.handoff_md`）。data-model §7.4 同名 |
| `suggested_lead_user_id` | FK → User, nullable | AI 建议的负责人（派活产出，由 [`smart-staffing.md`](./smart-staffing.md) 回填）。**data-model §7.4 权威名** |
| `resolved_at` | `DateTime`, nullable | pm 模式处置完成。data-model §7.4 同名 |

> **`handoff_json` 不是可选项**：PRD FR-WORKER-003 把"超预算 → 强制产出已做/未做/下一步交接件"列为 P0。所有升级（含 doom-loop / 预算耗尽 / 不合格）共用这一交接件契约，**禁止静默截断**。交接件以结构化 `handoff_json`（done/todo/blockers/artifacts）落库；其人话渲染（`handoff_md`）由呈现层据此生成（见 `agent-loop-and-tools.md` 的 `AgentRun.handoff_md` 与 [`explainability.md`](./explainability.md)）。
>
> **建模差异提示**：本篇 §7/§8 提到 `EscalationEvent.status`（`open/acknowledged/staffed/resolved/cancelled`）与"最终接手人"作为生命周期细化建议；data-model §7.4 当前只落 `resolved_at`（无独立 `status`、接手人记在 Assignment）。两者归一以 data-model 为准——若引入 `status` 机，则作为本篇增量并入 ER。

### 2.3 人工保留开关（`HumanOnlyPolicy`·新增，三级）

承载第三个触发器"用户明确不让 AI 干"（FR-ESC-005，对应 `trigger=user_forbidden`）。data-model §7.4 把它落为 `WorkItem.human_reserved` + 项目级 + 用户级三档开关；本篇给出该三档的合并语义。三级合并，**就近优先 + 任一为真即生效**（fail-safe 偏保守）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `scope` | `str(16)` | `work_item` / `project` / `user` |
| `scope_id` | `str(32)` | 对应主键 |
| `human_reserved` | `bool` | true = 该范围内 WorkItem 禁止 AI 工人执行（与 data-model `WorkItem.human_reserved` 同名） |
| `reason_md` | `Text`, nullable | 可选说明（呈现给后续操作者） |
| `set_by_user_id` | FK → User | 谁设的（审计） |

合并规则：`effective = work_item.human_reserved OR project.human_reserved OR user(submitter|lead).human_reserved`。该值在 WorkItem 进入 `ai_working` **之前**即被检查（§6.2-T3），命中则**根本不进工人态**，直接落经理模式（建 `EscalationEvent(trigger="user_forbidden")`）。

---

## 3. 置信度来源与计算

> **裁决律**：置信度衡量"**这东西做对了吗**"，与风险（"**做错代价多大**"）正交（§5）。两者独立评分，最后在 §4/§6 交叉裁决。

### 3.1 来源 ②（主）`llm_review` — 现成零件

- **现状**：`auto_agent.py:544 llm_review()` 跑一次独立 LLM 调用，系统提示 `REVIEW_SYSTEM`（`auto_agent.py:535`）强制输出 `{"meets_requirement": true/false, "reason": "..."}`，返回 `(bool, str)`。
- **演进**：把二值 `meets_requirement` 升级为**五档量表**（让模型给 `score ∈ {0.0, 0.25, 0.5, 0.75, 1.0}` 而非纯布尔），保留 `reason` 进 `rationale_md`。提示词改造在 `prompts/auto_agent.md`（评审段）+ 新增 `prompts/confidence_review.md`。
- **稳健解析**：沿用 `auto_agent.py:574-586` 的容错——剥 ```` ```json ```` 围栏、`json.loads` 失败则**判最低分**（保守），不崩。
- **`s_review ∈ [0,1]`**。

### 3.2 来源 ③（主）验收清单逐条命中率 — 现成零件

- **现状**：`RequirementAcceptanceItem`（`models.py:464`）已有 `status`（现默认 `open`）+ `title` + `description`，由澄清/排期阶段写入（`source_plan_id` 关联 `RequirementTaskPlan`）。data-model §4.4/§164 把 `status` 域扩展为 `open | met | unmet | waived`，正是为本来源的"逐条命中率"服务。
- **算法**：对每条验收项跑一次"命中判定"（可批量进同一 review 调用以省 token），写回 `status` 并映射为 `hit`：`met → 1`、部分满足 → `0.5`（仍记 `unmet` 或新增"部分"标注）、`unmet → 0`；`waived`（人工豁免）→ **不计入分母**。
  - `s_acceptance = Σ(weight_i · hit_i) / Σ(weight_i)`（仅含 `met/unmet`，`waived` 排除），默认 `weight_i = 1`；可选给"必过项"更高权重。
  - **边界**：验收项为空或全 `waived`（冷启动需求未拆验收）→ `s_acceptance = None`，权重在 §3.5 归零再重分配，**不**当作满分（避免"无验收 = 高置信"的危险默认）。
- **`s_acceptance ∈ [0,1] ∪ {None}`**。

### 3.3 来源 ①（辅）AI 自评 — 工人自报

- 工人在 `submit` 时（`auto_agent.py:449`，工具 `submit.notes`）附带一个自评字段 `self_confidence ∈ [0,1]` + 简短依据。新增到 `submit` 工具 schema 的可选属性。
- **反作弊**：自评**单独**不可触发 `auto_merge`；仅作为**降档信号**——自评低则拉低聚合分，自评高**不能**单独抬高（防过度自信，PRD §14 风险"信任崩塌"）。实现为：`s_self` 仅在低于其它来源时生效（见 §3.5 的 `min` 夹断）。
- **`s_self ∈ [0,1] ∪ {None}`**（未自报则 None）。

### 3.4 来源 ④（随数据接入）历史校准

- **数据底座**：复用 `ActivityLog`（`log_activity`：`ai_delivered`/`ai_failed` 见 `auto.py:215/247`，`accepted`/`revision_requested` 见 `deliveries.py:253/312`）聚合出**同类任务过往真实通过率**——即 [PRD §7](../../prd/2026-06-04-workhub-prd.md) `CollaborationGraph` 的一个切片，对齐 [data-model §7.3 信号④ `CollaborationGraph.hit_rate`](../01-architecture/data-model.md)。
- **分桶键** `calibration_bucket`：`{project_type}:{deliverable_kind}:{model}`（如 `内部文档:doc:deepseek`）。
- **校准值** `c_hist = 通过数 / (通过数 + 打回数)`（Laplace 平滑：`(hits+1)/(total+2)`，避免小样本极端）。
- **作用**：不是独立加分，而是**对聚合分做缩放校准**——某桶历史通过率低，则同样的 `llm_review` 高分要打折（模型在该桶偏乐观）。`confidence_score_calibrated = raw · (0.5 + 0.5·c_hist)`。
- **冷启动**：样本 < N（建议 N=20）→ `c_hist` 退化为 1.0（不缩放），与 [`smart-staffing.md`](./smart-staffing.md) 的冷启动降级口径一致。

### 3.5 聚合算法

```
权重（v1 建议，policy_version 可调）：
  w_review     = 0.50
  w_acceptance = 0.35
  w_self       = 0.15   # 仅作降档
  # 来源缺失（None）→ 其权重按比例重分配给在场来源

raw = (w_review·s_review + w_acceptance·s_acceptance') / (w_review + w_acceptance')
      # s_acceptance' / w_acceptance' = 缺失时的重分配结果

# 自评只降不升（反过度自信）：
adjusted = min(raw, lerp(raw, s_self, 0.3)) if s_self is not None else raw
          # 即 s_self 低时把 raw 往下拉，s_self 高时不动

# 历史校准缩放：
confidence_score = adjusted · (0.5 + 0.5·c_hist)
```

- **决定性**：同输入恒定输出（除 LLM 评审本身的随机性，评审调用建议 `temperature=0`）。
- **可审计**：四来源的原始分、权重、缺失重分配、校准因子全部写入 `signals_json`（JSONB），供 [`explainability.md`](./explainability.md) 展开"为什么是这个把握度"。

---

## 4. 分级阈值表（置信度落档）

> 数值阈值是**内部配置**（`policy_version` 管理），**绝不**呈现给用户（PRD 宪法 §4 去黑话）。

| `grade`（置信度档） | 阈值（v1 建议） | 含义 |
|---|---|---|
| `high` | `score ≥ 0.85` **且** `s_acceptance` 全过（无 `unmet` 项） | 高把握 |
| `medium` | `0.6 ≤ score < 0.85`，或有"部分满足"验收项 | 中等 |
| `low` | `score < 0.6`，或任一**必过**验收项 `unmet`，或 `llm_review` 判不过（`s_review = 0`） | 低把握 |

**硬否决（`grade` 强制降到 low，不论数值）**：`llm_review` 明确 `meets_requirement=false`（即来源②的二值仍是一道闸）。这保留了现状 `auto_agent.py` 的"复审不过即失败"语义（`auto_agent.py:651`），只是从"成败"升级为"降到 low 档触发升级"。

---

## 5. 风险维度与评分

> 风险与置信度**正交**：一件 AI 很有把握的事，若高风险，仍**不能**自动合并（PRD §14）。风险维度需与业务方共定（[PRD §16 开放问题 3](../../prd/2026-06-04-workhub-prd.md)），下表为 v1 建议骨架。

### 5.1 五维度（每维 `∈ [0,1]`）

| 维度 | 含义 | 评分线索（规则优先，LLM 兜底） |
|---|---|---|
| `reversibility` | 不可逆性 | 可回滚=0；删除/覆盖生产数据/对外发送=高。直接读 §8 快照能力：**有执行前快照 → 该维度封顶 0.4**（因为可 revert） |
| `external` | 对外性 | 纯内部草稿=0；发邮件/对客户/发布到 main 对外页=1 |
| `monetary` | 金额/合规敏感 | 无关=0；涉付款/合同/合规承诺=1（命中关键词清单即升档） |
| `blast_radius` | 影响人数/范围 | 单人草稿=0；影响整个项目/多人/全 workspace=高 |
| `domain_gate` | 需专业资质判断 | PRD 非目标 L2 不覆盖"需专业资质"的事——命中即 1（强制升级） |

- **评分顺序**：先**确定性规则**（关键词、可逆性标志、对外标志位）给硬分；规则未覆盖的残余由一次轻量 LLM 评估补（与 `llm_review` 可合并调用省 token）。
- **可解释**：逐维分写入 `signals_json.risk.*`（JSONB）。

### 5.2 风险聚合

```
# 取最大主导 + 均值修正：单一极高维度（如 external=1）足以拉高总风险
risk_score = 0.6·max(dims) + 0.4·mean(dims)
```

**硬升档**：`domain_gate = 1` 或 `monetary = 1` 或 `external = 1` 时，`risk_level` 直接置 `high`（不论 `risk_score`）——这些是"必须人来拍板"的红线。

### 5.3 风险落档

| `risk_level` | 条件 |
|---|---|
| `low` | `risk_score < 0.3` 且无硬升档维度 |
| `medium` | `0.3 ≤ risk_score < 0.6` |
| `high` | `risk_score ≥ 0.6` 或命中任一硬升档维度 |

---

## 6. 裁决：置信度 × 风险 → 处置（核心规则表）

### 6.1 二维裁决矩阵

> 行=置信度档，列=风险档。单元格=`verdict`。**保守优先**：任何"低/高风险/卡住"都压向 `escalate`。

| `grade` \ `risk_level` | `low` 风险 | `medium` 风险 | `high` 风险 |
|---|---|---|---|
| **`high`** 置信 | **`auto_merge`** 直接生成 Proposal，按策略自动合并 main | **`human_spotcheck`** 生成 Proposal，转人工抽检 | **`escalate`** 高风险必须人拍板 |
| **`medium`** 置信 | **`human_spotcheck`** 人工抽检（快速 通过/打回） | **`human_spotcheck`** | **`escalate`** |
| **`low`** 置信 | **`escalate`** | **`escalate`** | **`escalate`** |

对应 [PRD §8.2 分级裁决表](../../prd/2026-06-04-workhub-prd.md) 与 [data-model §7.3 分级裁决规则表](../01-architecture/data-model.md)：
- **高置信 + 低风险** → `auto_merge`（review 过 + 清单全过 + 低风险）。
- **中等 / 中风险** → `human_spotcheck`（部分不确定 → 转人工抽检）。
- **低置信 / 高风险 / 卡住** → `escalate`（转经理模式找人）。

> `auto_merge` 是否真"自动合并"还受合并策略与权限闸约束——见 [`../03-collaboration/branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md)（合并语义）与 [`review-and-approval.md`](../03-collaboration/review-and-approval.md)（即便高置信低风险，若 PermissionPolicy 命中 `ask` 仍阻塞询问）。本篇只给**裁决建议**，合并动作由协作层执行。

### 6.2 三个升级触发器 → 现有代码映射（命门）

| # | 触发器（PRD 用语） | 现有零件 / 锚点 | 现状 → WorkHub 演进 |
|---|---|---|---|
| **T1** | **不合格**（`trigger=unqualified`） | `llm_review` 判分不过（`auto_agent.py:544`，复审 `meets_requirement=false`，编排处 `auto_agent.py:651`） | 现状：`review_passed=false` → `AutoOutcome.success=false` → `auto.py:242` 回 `ready` 转人工。演进：转为 `grade=low`（§4 硬否决）→ `verdict=escalate` → 建 `EscalationEvent(trigger="unqualified")` |
| **T2** | **用户不满意**（`trigger=user_unsatisfied`） | 负责人打回 `RevisionRequest.reason_md`（`models.py:535/542`、`deliveries.py:267-328`） | 现状：`status → revision_requested`，转移到 `{doing, cancelled}`（`requirements.py:282`），**理由不回灌**、给人重做。演进：理由**回灌**（§7.2），AI 在**同分支**续做（FR-ESC-003），而非停摆 |
| **T3** | **用户明确不让 AI 干**（`trigger=user_forbidden`） | （**今天不存在**） | 新增 `HumanOnlyPolicy` 三级开关（§2.3，落 data-model `WorkItem.human_reserved`）。进入 `ai_working` 前检查，命中即建 `EscalationEvent(trigger="user_forbidden")`，**不进工人态** |

### 6.3 额外自动升级信号（借鉴 opencode）

| # | 信号 | 现状 → 演进 | 锚点 |
|---|---|---|---|
| **T4** | **doom-loop**（连续 N 次相同/等价动作判"卡住"） | **今天不存在**。新增：在工人循环里指纹化每步 `tool_use`（`name` + 规范化 `input`），连续 `N=3` 次等价即发 `escalate` 控制信号 | 循环位置见 [`agent-loop-and-tools.md`](./agent-loop-and-tools.md)；现循环 `auto_agent.py:405`（`for turn in range(1, MAX_TURNS+1)`）无去重 |
| **T5** | **预算耗尽**（`trigger=budget_exhausted`） | 现状：`MAX_TURNS=15`（`auto_agent.py:36`）/ `TOTAL_TIMEOUT_DEFAULT=300s`（`:37`）/ 单轮 LLM 超时（`:426`）→ 直接 `_result(False, ...)` **静默截断**。演进:耗尽时**强制产出结构化交接件 `handoff_json`**（FR-WORKER-003）再升级 | `auto_agent.py:405-407/505`；新增成本预算见 [PRD NFR-05](../../prd/2026-06-04-workhub-prd.md) |

> T4（`trigger=doom_loop`）/ T5 对应 FR-ESC-004（P1）。两者**先于**终评发生（AI 还没产出最终交付），故 `EscalationEvent.confidence_id` 可空、必带 `handoff_json`。

---

## 7. 状态流转

### 7.1 WorkItem 状态机（升级相关切面）

> 全量转移在 [`../01-architecture/data-model.md`](../01-architecture/data-model.md)；此处只画与裁决/升级相关的弧。演进自现 `Requirement` 状态机（`models.py:328-330`：`draft|clarifying|summary_ready|ready|ai_processing|claimed|doing|delivery_doc_pending|delivered|revision_requested|accepted|cancelled`）。

```
spec_ready
  │  (检查 human_reserved 三级开关 §2.3)
  ├── human_reserved=true ─────────────► escalated  [trigger=user_forbidden]   (T3)
  └── human_reserved=false
        ▼
     ai_working ──(每步指纹去重)──► doom-loop?──yes─► escalated [doom_loop]     (T4)
        │         ──(turns/timeout/cost)─► budget?─yes─► (产出 handoff_json) escalated [budget_exhausted] (T5)
        ▼  (工人 submit + 终评)
     评分：ConfidenceRecord(grade, risk_level, verdict)
        ├── verdict=auto_merge      ─► auto_proposal ─► (策略/权限闸) merged
        ├── verdict=human_spotcheck ─► human_spotcheck ─► approve→merged / reject→(T2 回灌)
        └── verdict=escalate        ─► escalated  [trigger=unqualified]        (T1)
                                     │
                                     ▼
                                  pm_mode (经理模式：派活→人做→提议)  ──► in_review ─► merged
  in_review (人审 Proposal)
     ├── approve ─► merged
     └── reject(带理由 reason_md) ─► ai_working(同分支回灌续做)  (T2)  /  reassign
```

- `escalated` 状态对齐 [PRD §7.1 状态机](../../prd/2026-06-04-workhub-prd.md)；进入即创建 `EscalationEvent` 并交棒 [`pm-mode-orchestration.md`](./pm-mode-orchestration.md)。
- `reject → ai_working` 这条弧是对现状 `revision_requested → doing`（`requirements.py:282`，回到**人**）的关键改写：默认回到 **AI 同分支续做**；只有当置信度持续低（连续 M 轮打回，建议 M=2）才升级转人。

### 7.2 打回带理由回灌（FR-ESC-003，命门数据流）

> 现状：`reason_md` 只落 `RevisionRequest` 表 + 发通知（`lifecycle.py` 的 `revision_requested` 里程碑 → assignees），**从不进入下一次 LLM 上下文**。这是 WorkHub 必补的闭环。

回灌机制（在工人循环的消息装配处实现，参 `auto_agent.py:387` 的 `messages` 初始化）：

1. 负责人打回 → `RevisionRequest{reason_md}` 落库（沿用 `deliveries.py:305` 的 CAS 防并发双写）。
2. WorkItem → `ai_working`（同分支、同 `agent_run` 续作或派生 round+1 的新 run）。
3. 新一轮工人启动时，**把历史打回理由作为高优先上下文注入** `messages`：

```python
# 新一轮 run 的 system/user 拼装（演进 auto_agent.py:387 的 messages 初始化）
revision_context = "\n\n".join(
    f"# 第 {rr.round} 轮被打回，负责人意见（必须针对性修正）:\n{rr.reason_md}"
    for rr in prior_revisions  # 按 round 升序
)
messages = [{
    "role": "user",
    "content": (
        f"# Requirement\n{title}\n\n{summary_md}\n\n"
        f"{revision_context}\n\n"            # ← 回灌点
        f"上一轮产物在 inputs/_prev_round/ ，请在其上**针对性修改**，而非从零重写。"
    ),
}]
```

4. 同时把上一轮 `outputs/` 拷入新 sandbox 的 `inputs/_prev_round/`（复用 `auto_agent.py:603 _preload_inputs` 的预载机制），让 AI 增量改而非重做。
5. 续做产出 → 重新评分 → 新 `ConfidenceRecord(round+1)`。

**回灌也适用于 T1/权限拒绝**：与 opencode 的 `CorrectedError`/拒绝回灌同构——`llm_review` 的 `reason`（T1）、权限 `ask` 被 deny 的理由（见 [`review-and-approval.md`](../03-collaboration/review-and-approval.md)），都按同一格式注入下一步上下文，让 AI 自我纠偏而非停摆（[PRD §8.6 回灌](../../prd/2026-06-04-workhub-prd.md)）。

---

## 8. 与快照/回滚的关系

风险维度 `reversibility` 的封顶（§5.1：有执行前快照 → ≤0.4）依赖 [`agent-loop-and-tools.md`](./agent-loop-and-tools.md) 定义的**每步快照**能力 + [data-model §7.5 `Snapshot` 实体](../01-architecture/data-model.md)（PRD §8.1 安全红线、FR-WORKER-004、NFR-04）。判定口径：存在 `Snapshot(kind=pre_step)` 且 `reverted_at IS NULL` 可用 → 该动作可 revert，`reversibility` 封顶 0.4。语义：因为可 revert，"做错"的代价被压低，故同等不确定性下风险更小、更可能落 `human_spotcheck` 而非 `escalate`。**反之**：若某动作无法快照（如已对外发送），`reversibility=1`，几乎必然 `high` 风险。本篇不重复快照实现，只声明这条耦合。

---

## 9. 配置与可调性（`policy_version`）

所有阈值/权重/关键词清单集中为一份**带版本的策略对象**，不散落代码：

| 配置块 | 内容 | 默认 |
|---|---|---|
| `confidence.weights` | `w_review/w_acceptance/w_self` | 0.50/0.35/0.15 |
| `confidence.bands` | high/medium/low 阈值 | 0.85 / 0.6 |
| `confidence.review_scale` | llm_review 五档量表锚点 | {0,.25,.5,.75,1} |
| `risk.dimension_weights` | 五维度权重与硬升档清单 | external/monetary/domain_gate 为硬升档 |
| `risk.tiers` | low/medium/high 阈值 | 0.3 / 0.6 |
| `escalation.doom_loop_n` | 等价动作连发阈值 | 3 |
| `escalation.budget` | MAX_TURNS / timeout / token 上限 | 15 / 300s / （NFR-05 三级预算） |
| `escalation.max_reject_rounds_before_human` | 连续打回多少轮后转人 | 2 |
| `calibration.min_samples` | 校准最小样本 | 20 |

每条 `ConfidenceRecord.policy_version` 记录命中的版本，便于回溯"当时为何这么判"（与成功度量"升级精准度"对账，[PRD §13](../../prd/2026-06-04-workhub-prd.md)）。R0 默认 owner 与初值见 §0.1；后续业务方校准必须另起 `policy_version`，并在 `07-open-questions.md` 标记为“校准中”，不得回到“待拍板阻塞 R1”。

---

## 10. SSE / 事件契约

> 复用现有 `push_bus`（`services/push_bus.py`，topic `req:<id>` + `all`），演进自 `auto_agent.py` / `auto.py` 已发的 `ai.started / ai.thinking / ai.tool_call / ai.text / ai.done / ai.failed`、`requirement.updated`、`revision.requested`。完整事件清单收口于 [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md)；本篇只定义裁决/升级相关事件。

| 事件 `type` | topic | payload（要点） | 触发点 |
|---|---|---|---|
| `confidence.scored` | `req:<id>` | `{round, grade, risk_level, verdict}`（**不含数值**，呈现层取人话） | 终评落 `ConfidenceRecord` 后 |
| `escalation.opened` | `req:<id>` + `all` | `{work_item_id, trigger, reason_preview}` | 建 `EscalationEvent` |
| `escalation.handoff_ready` | `req:<id>` | `{handoff_preview}` | T5/超预算产出交接件 |
| `proposal.auto_created` | `req:<id>` + `all` | `{round, auto_merge: bool}` | `verdict=auto_merge` 生成 Proposal |
| `spotcheck.requested` | `req:<id>` + `all` | `{round}`（路由给 reviewer，对齐 `lifecycle.py` 里程碑） | `verdict=human_spotcheck` |
| `revision.fedback` | `req:<id>` | `{round, reason_preview}` | T2 回灌、AI 同分支续做开始 |

- **私有事件隔离**（NFR-08）：`confidence.scored` / `handoff_ready` 等含内部细节的事件只发 `req:<id>`（订阅者限相关方）；org 级广播只发脱敏的 `escalation.opened`，沿用现 `revision.requested` 只发 `reason_preview[:160]` 的脱敏惯例（`deliveries.py:321`）。

---

## 11. 边界条件与失败处理

| 场景 | 处理 |
|---|---|
| `llm_review` 调用失败/超时 | 沿用 `auto_agent.py:571` 容错：`s_review` 判**最低分**（保守），并在 `rationale_md` 注明"复审不可用"；绝不当作通过 |
| 评审输出无法解析 JSON | 同上判最低 → 落 `low` 档 → `escalate`（`auto_agent.py:585` 的现状语义保留） |
| 无验收项（冷启动） | `s_acceptance=None`，权重重分配；**不**视为满分；置信度更易落 medium/low |
| 历史样本不足 | `c_hist=1.0`（不缩放），与冷启动降级一致 |
| 产物目录为空但 AI 调了 submit | 沿用 `auto_agent.py:451 _has_deliverables` / `:510`：判失败 → `low` → `escalate` |
| WorkItem 在评分期间被取消 | 沿用 `auto.py:166` 的 race check：`status != ai_working` 则**不写** ConfidenceRecord、不建 Escalation、不发事件 |
| 评分/升级写库时崩溃 | 沿用 `auto.py:279` 的兜底：`rollback` + 转终态，**绝不**把 WorkItem 卡在 `ai_working`（防 15 分钟重启扫才回收） |
| `human_reserved` 与已在跑的 run 冲突 | 开关在 `ai_working` **入口**检查；运行中临时设 `human_reserved` 不中断当前 run，但下一轮（含 T2 回灌）前重检，命中则转 escalate |
| doom-loop 误判（合法重试） | 指纹规范化时**排除**已知幂等/重试场景（如 `run_command` 同命令重试受 NFR-06 退避保护）；阈值 `N` 可调（§9） |
| 自评字段缺失或越界 | `s_self=None` 走缺失分支；越界值夹断到 [0,1] |

---

## 12. 验收映射（可追溯）

| PRD FR | 本篇落点 |
|---|---|
| FR-ESC-001（每产出生成 ConfidenceRecord + 人话呈现，不暴露数值） | §2.1 + §10（事件不含数值）+ §1 去黑话映射 |
| FR-ESC-002（任一触发器命中即建 EscalationEvent 切经理模式） | §6.2 + §7.1 状态机 |
| FR-ESC-003（打回带理由，理由回灌，同分支续做） | §7.2 回灌数据流 |
| FR-ESC-004（doom-loop / 超预算自动升级，P1） | §6.3 T4/T5 |
| FR-ESC-005（人工保留三级开关，P1） | §2.3 + §6.2 T3 |
| FR-WORKER-003（超预算强制产出结构化交接件） | §2.2 `handoff_json` + §6.3 T5 |
| NFR-03/04（可审计 / 可回滚） | §2 全字段 + `signals_json` + §8 快照耦合 |

---

*下一步：按 §0.1 的 R0 默认策略施工 R1 真实纵切；R1 产生真实 `ConfidenceRecord` / `EscalationEvent` / `Review` 数据后，再用 replay/eval 做阈值校准。`ConfidenceRecord`/`EscalationEvent` 字段仍需并入 [`../01-architecture/data-model.md`](../01-architecture/data-model.md) ER 图与状态机全量转移。*
