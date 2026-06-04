---
module: P-AI
layer: L1
status: 🚧
owner: workflow
related:
  - ../../prd/2026-06-04-workhub-prd.md            # §8.4 智能派活 / FR-STAFF-*
  - ../README.md                                    # 模块地图 P-AI
  - ../00-overview/glossary-dejargon.md             # 术语去黑话(权威)
  - ../01-architecture/data-model.md                # UserProfile / CollaborationGraph / Assignment 全量字段
  - ../01-architecture/api-contract.md              # OpenAPI 路由组与事件类型清单
  - ../01-architecture/system-architecture.md       # daemon + SSE 事件流
  - ./confidence-risk-escalation.md                 # 命门:升级触发器、打回回灌、命中率来源
  - ./pm-mode-orchestration.md                      # 经理模式:智能派活是其第②步
  - ./explainability.md                             # "为什么推荐他"的理由+证据范式
  - ../03-collaboration/branch-proposal-merge.md    # 派活落地为 lead+collaborators 分支
code_anchors:
  - app/models.py:363                               # RequirementAssignment(lead|collaborator)
  - app/models.py:448                               # RequirementTaskItem.suggested_user_id(既有"AI 荐人"原语)
  - app/models.py:554                               # ActivityLog(协作图/命中率聚合源)
  - app/models.py:535                               # RevisionRequest(打回 → 纠正回流)
  - app/routers/planning.py:22                       # GET /planning/workload(负载信号现成实现)
  - app/services/assignments.py:89                  # replace_assignments(人确认/调整落地)
  - app/services/task_decomposition.py:103          # analyze_requirement(LLM JSON 契约范式 + fallback)
  - app/services/presence.py:54                      # get_presence(在线/可用度)
---

# 智能派活（Smart Staffing，旗舰）

> **一句话**:有新工作要交给人时（升级后、或用户明确禁用 AI 执行时），AI 不替你拍板，而是**提议**一个负责人 + 协作人组合，并对每个人给出**"为什么推荐他"**的人话理由 + 证据;你一键**确认**或**调整**;无历史时降级为**解释式推荐**;你纠正后**回流**改进下次。
>
> 本篇是 PRD §8.4 / `FR-STAFF-001..005` 的接口/机制级细化。智能派活是 [AI 项目经理模式](./pm-mode-orchestration.md) 编排链的第 ② 步,由 [升级](./confidence-risk-escalation.md) 触发后进入;它的输出最终落地为 [分支-提议-合并](../03-collaboration/branch-proposal-merge.md) 里的 `lead + collaborators` 角色分配。

---

## 0. 范围与非目标

**在范围内**:输入信号采集与归一化、可解释匹配算法与规则表、`StaffingProposal` 数据结构与 API/事件契约、人确认/调整闭环、冷启动降级、纠正回流的反馈数据与权重更新机制、边界条件与失败处理。

**不在范围内**(交叉引用,勿在此重复):
- 升级如何被触发、置信度/风险如何裁决 → [confidence-risk-escalation.md](./confidence-risk-escalation.md)。
- 经理模式的简报/排期/催办/再审 → [pm-mode-orchestration.md](./pm-mode-orchestration.md)。
- 分支/提议/合并的数据与冲突调解 → [branch-proposal-merge.md](../03-collaboration/branch-proposal-merge.md)。
- 实体的全量字段与 ER 图(`UserProfile` / `CollaborationGraph` / `Assignment`)以 [data-model.md](../01-architecture/data-model.md) 为准,本篇只给与派活直接相关的字段子集。

**去黑话纪律**(详见 [glossary](../00-overview/glossary-dejargon.md)):对用户永远说"建议谁来做 / 推荐理由 / 换个人",**绝不**暴露 score/weight/embedding/命中率数值/阈值。所有分数仅存于后端与审计 trace,API 对客户端只渲染**人话理由 + 离散标签**。

---

## 1. 在系统中的位置（数据流）

```
WorkItem(待派) ──触发──> StaffingService.propose()
        │                         │
        │            ┌────────────┴───────────────┐
        │            │  采信号(§2)                 │
        │            │  1 SkillProfile(自述/自我介绍)│
        │            │  2 CollaborationGraph(协作+命中率) ← ActivityLog/Delivery/RevisionRequest 聚合
        │            │  3 LoadSnapshot(负载/可用度)  ← GET /planning/workload + presence
        │            │  4 WorkItemFeatures(画像)     ← 技能需求抽取(LLM/规则)
        │            └────────────┬───────────────┘
        │                         ▼
        │              候选打分(§3 可解释匹配)
        │                         ▼
        │              StaffingProposal(§4):lead + collaborators + 每人 reasons[] + evidence[]
        ▼                         ▼
   SSE: staffing.proposed ──> C-WEB/C-PET 渲染"建议谁来做 + 为什么"
                                  │
                 人确认/调整(§5) ─┤── 一键确认 → replace_assignments() 落地角色分配
                                  ├── 调整(换人/增删协作者)→ 重新落地
                                  └── 纠正信号 → StaffingFeedback(§7) 回流改进
```

- `StaffingService` 是 daemon 内的一个无状态领域服务(演进自 [`task_decomposition.analyze_requirement`](../../../app/services/task_decomposition.py) 的 "LLM 出 JSON + 本地 fallback" 范式)。
- 触发者:① 经理模式激活后自动调用;② 负责人/管理员在工作项上手动"求建议";③ intake 阶段对**明确标记不让 AI 执行**的工作项直接走派活(跳过 worker)。
- 现有最接近的原语是 [`RequirementTaskItem.suggested_user_id`](../../../app/models.py)(任务项级"AI 荐人,人确认")与 [`RequirementAssignment`](../../../app/models.py)(`role = lead | collaborator`)。WorkHub 把"荐人"从任务项级提升为**工作项级、带理由、带证据、可回流**的一等公民。

---

## 2. 输入信号（采集 + 归一化）

四类信号统一归一到 `[0,1]` 的子分,再按 §3 规则表加权。每个子分都**必须携带可读 evidence**(供 §4 渲染"为什么")。

### 2.1 信号一:SkillProfile（技能自述 / 自我介绍）

来源 = 新增实体 `UserProfile`(由 onboarding 必填,`FR-STAFF-001`)。**字段口径以 [data-model §3.2](../01-architecture/data-model.md) 为准**,本篇只复述与派活直接相关的列,不另立新字段:

| `UserProfile` 字段(权威定义见 data-model) | 类型 | 在派活里的用途 |
|---|---|---|
| `user_id` | FK→`users.id`(unique) | 与 `User` 1:1 |
| `bio_md` | `Text` | 自我介绍(Markdown);grep 命中其句子作 evidence(§3.4) |
| `skills_text` | `Text` | 技能自述(自由文本,grep 可检索,无向量库——D-4) |
| `skill_tags` | `JSONB` `[]`(`["前端","数据分析"]`) | 归一化专长标签,集合命中算 `skill_sub`(§3.4) |
| `availability_pref` | `JSONB` `{}` | 可用度/打扰边界;喂 §2.3 负载与桌宠节制 |
| `onboarded_at` | `DateTime?` | 为 NULL 触发 J1 引导,也是 §6 冷启动判据 |

> **去掉了向量字段**:data-model 的 `UserProfile` **不含** `skill_embedding`——D-4 已决策不做向量库,匹配只走 grep + `skill_tags` 集合(§3.4)。若未来引入向量,是 data-model 的扩展项,本篇接口与 evidence 契约不变。
> **角色偏好 / 资料填充度不是 `UserProfile` 列**,而是 StaffingService 运行时的派生量:
> - `_profile_completeness ∈ [0,1]`(派生)= `bio_md`/`skills_text`/`skill_tags` 三者非空填充度,喂 §6 冷启动判定;
> - 角色偏好暂由 `skill_tags` + 历史 `role` 分布推断(无专门字段),需要硬偏好时走 §2.4 `hard_constraints`。

归一化:`skill_sub = f(WorkItemFeatures.required_skills ∩ skill_tags)`,加权交并比按 §3.4 计算;evidence = 命中的 tag 列表 + `bio_md`/`skills_text` 里 grep 命中的句子片段(强制引用,延续 [explainability](./explainability.md) 的 grep+引用范式)。

### 2.2 信号二:CollaborationGraph（既往协作 + 命中率）

`CollaborationGraph` 是**聚合视图**(PG `MATERIALIZED VIEW` `collaboration_edge` / 周期重算,落库形态见 [data-model §3.3](../01-architecture/data-model.md)),不是手填实体。聚合源全部为现有真实表:

| 聚合源 | 现有表 | 贡献的派生量 |
|---|---|---|
| 历史承接 | [`RequirementAssignment`](../../../app/models.py)(`role`,`requirement_id`,`user_id`) | 谁做过哪个项目/技能域的活、做 lead 还是 collaborator |
| 完成与验收 | [`Requirement`](../../../app/models.py)(`accepted_at`,`status`) + [`Delivery`](../../../app/models.py)(`round`) | 交付轮次、是否一次过 |
| 打回 | [`RevisionRequest`](../../../app/models.py)(`requirement_id`,`delivery_id`,`reason_md`) | 返工次数 → 命中率扣分 |
| 行为流水 | [`ActivityLog`](../../../app/models.py)(`actor_nickname`,`action`,`detail_json`) | 协作配对(谁和谁在同一工作项)、活跃度 |

**聚合视图字段口径以 [data-model §3.3](../01-architecture/data-model.md) 为准**(逻辑边 = `from_user_id` / `to_user_id` / `co_work_count` / `domain_tag` / `hit_rate` / `last_co_work_at`)。本篇直接消费这几列,只额外定义两个**派活内部派生量**(不外显数值、不写回视图):

| 派生量(StaffingService 内部) | 来源列 | 定义 | 边界处理 |
|---|---|---|---|
| `_first_pass`(一次过) | `Delivery.round` + `Requirement.accepted_at` | `round==1 && accepted` 占已交付比 | 样本 `n < N_MIN`(默认 3)→ 不可用(非 0),见 §6 |
| `_recency_w`(新鲜度权重) | `last_co_work_at` | 半衰期 `HALF_LIFE_DAYS=90` 的指数衰减 | 防"一年前合作过"误判为强信号 |

> **`hit_rate` 的权威定义在 [data-model §3.3](../01-architecture/data-model.md)**:`hit_rate = accepted /(accepted + revision_requested)`(同一 `accepted`/打回信号也被 [confidence-risk-escalation.md](./confidence-risk-escalation.md) 的来源④"历史校准"消费,但那条线 v1 标「待数据」)。本篇**只读** `hit_rate`,不重定义命中率算法,保持单一口径。

归一化:`history_sub = clip( w_hit·hit_rate + w_first·_first_pass , 0, 1 )`(打回已含在 `hit_rate` 分母里,不再单列扣分项);`affinity_sub`(§3.3)= 与拟定 lead 的 `co_work_count·_recency_w` 归一。evidence = "在 N 个同类活里有 M 个一次通过 / 上次与 X 合作的活顺利交付了"。

### 2.3 信号三:LoadSnapshot（当前负载 / 可用度）

**已有现成实现** [`GET /api/planning/workload`](../../../app/routers/planning.py),直接复用其 `UserWorkloadOut`(`app/schemas.py`):

| 复用字段 | 来源 | 在派活里的用途 |
|---|---|---|
| `load_percent` | `estimate_hours / capacity_hours`(busy 时 capacity×0.5) | 负载越高,推荐分越低(过载惩罚) |
| `capacity_hours` | `span_days × 6h`,按 `availability_status` 调整 | 容量上限 |
| `overdue_count` / `blocked_count` | 逾期 / 阻塞工作项数 | 有逾期/阻塞 → 强惩罚,evidence 提示"他手上还有逾期" |
| `is_online` | [`presence.get_presence`](../../../app/services/presence.py)(stream 计数或 120s 内 last_seen) | 在线轻微加成(能更快接手) |
| `availability_status` / `availability_text` | [`User.availability_status`](../../../app/models.py)(`free\|busy`) | `busy` 降权;`busy` 文本作为 evidence |

归一化:`load_sub = clamp(1 − load_percent/100) − penalty(overdue, blocked)`;evidence 直接取 `availability_text` 与计数。**注意**:LoadSnapshot 是**软约束**——过载不"硬禁",而是降权 + 在理由里如实说明(因为负责人有权派给忙人)。

### 2.4 信号四:WorkItemFeatures（工作项画像）

对待派 `WorkItem` 抽取结构化特征,作为匹配的"需求侧"。抽取器复用 [`task_decomposition.analyze_requirement`](../../../app/services/task_decomposition.py) 的"LLM 出 JSON,失败回 fallback"范式:

```jsonc
// StaffingService 内部结构(非 API)
WorkItemFeatures {
  required_skills: list[{tag: str, weight: float}],   // 从 title/summary_md/raw_description 抽
  domain: str,                                        // 业务域(项目 slug + LLM 归类);对齐 CollaborationGraph.domain_tag(§2.2)
  estimated_effort_hours: float | null,               // 复用 Requirement.estimate_hours
  risk_band: "low" | "mid" | "high",                  // = ConfidenceRecord.risk_tier(若来自升级;口径见 confidence-risk-escalation)
  needs_lead: bool,                                   // 是否需要一个负责人(几乎恒 true)
  collaborator_slots: int,                            // 建议协作人数(默认 0;按 effort/拆解项推断)
  hard_constraints: {                                 // 硬约束(非 0 即排除)
    must_include_user_ids: list[str],                 // 提交者点名要某人
    exclude_user_ids: list[str],                      // 提交者排除某人 / 被纠正回流写入
    project_membership_required: bool
  }
}
```

抽取失败(无 LLM key 或解析异常)→ fallback:`required_skills` 取空、`domain` 取项目 slug、`collaborator_slots=0`,匹配自动退化为 §6 冷启动路径。

---

## 3. 可解释匹配逻辑

### 3.1 总体公式

对每个**候选用户** `u` 与目标角色 `r ∈ {lead, collaborator}`,算一个**可分解**的总分:

```
score(u, r) = Σ_i  w[r][i] · sub_i(u)        // i ∈ {skill, history, load, affinity}
              · gate(u)                       // 硬约束门:0/1
```

- `gate(u)` = 硬约束(§2.4 `hard_constraints.exclude_user_ids`、被停用 [`users.deleted_at`](../../../app/models.py)、`project_membership_required`)命中任一即 0,直接出局。
- `sub_i` 全部 ∈ `[0,1]`(§2 已归一)。
- **可解释性来自"可分解"**:总分永远可拆回四个子分 + 各自 evidence,这是 §4 "为什么推荐他"的数据底座,也是 [explainability](./explainability.md) 要求的"决策附理由+证据"。

### 3.2 角色相关权重表（默认值，`PermissionPolicy` 可按 org/workspace 覆盖）

| 子分 `sub_i` | lead 权重 `w[lead]` | collaborator 权重 `w[collab]` | 理由 |
|---|---|---|---|
| `skill_sub`(技能匹配,§3.4) | 0.35 | 0.45 | 协作人更看纯技能贴合 |
| `history_sub`(命中率,§2.2) | 0.30 | 0.15 | lead 担责,历史靠谱更重要 |
| `load_sub`(负载/可用,§2.3) | 0.25 | 0.25 | 两角色都怕过载 |
| `affinity_sub`(协作默契,§2.2) | 0.10 | 0.15 | 与既定 lead 合得来对协作人更关键 |

> 权重是**配置而非硬编码**:存一张**新增的派活配置** `StaffingWeightConfig`(`org_id`+`workspace_id` 作用域,就近覆盖,沿用 data-model 的多租户作用域范式)。**注意**:它与 [`PermissionPolicy`](../01-architecture/security-and-permissions.md) 不是同一张表——`PermissionPolicy` 管 allow/deny/ask,这里只调权重,二者只是共享"org→workspace 就近合并"的作用域口径。冷启动期与有数据期用两套权重 profile(§6)。

### 3.3 组队算法（lead 先选，collaborator 条件化再选）

```
1. 算所有候选对 lead 的 score(u, lead);gate=0 的剔除。
2. 取 top-K_LEAD(默认 3)作为 lead 候选,推荐第 1 名,其余作"备选可换"。
3. 若 collaborator_slots > 0:
   固定"拟定 lead = top1"后,重算 score(u, collaborator),
   其中 affinity_sub 取候选与该 lead 的 `co_work_count·_recency_w` 归一(§2.2);
   选 top-collaborator_slots 名,排除已是 lead 的人。
4. 平局打破顺序:更高 `_first_pass`(§2.2)> 更低 `load_percent`(§2.3)> `is_online` > 字典序(稳定可复现)。
```

- **为什么 lead 先定**:协作人推荐依赖"与谁组队"(affinity),所以必须先有 lead 锚点。负责人换 lead 时(§5),collaborator 推荐**自动重算**。
- `K_LEAD` / `collaborator_slots` 上限受预算与团队规模约束;`collaborator_slots` 默认 0(多数活一人即可),由 effort 或拆解项数推断上调。

### 3.4 技能匹配的具体计算（无向量库下，D-4）

延续 [PRD §3.3 / D-4](../../prd/2026-06-04-workhub-prd.md)"不做向量检索,grep + 强制引用":

```
skill_sub(u) =
   0.6 · weighted_jaccard(required_skill_tags, u.skill_tags)        // 标签集合,按需求侧 weight 加权
 + 0.4 · grep_hit_ratio(required_skill_terms, u.skills_text + u.bio_md)  // 自述全文 grep 命中率
```

- `weighted_jaccard` = 加权交并比:交集标签按 `WorkItemFeatures.required_skills[].weight`(§2.4 需求侧权重)累加 ÷ 并集。`UserProfile.skill_tags` 是**纯标签串列表**(data-model §3.2 形如 `["前端","数据分析"]`,**不含**自评熟练度),故权重只来自需求侧,不臆造 `self_level`。
- `grep_hit_ratio` = 命中 term 数 / 需求 term 数;命中句子(来自 `skills_text`/`bio_md`)作为 evidence 引用(可点开看原文,强制引用,复用 [explainability §3](./explainability.md) 的 grep 链路)。
- **向量是 data-model 的未来扩展、非本篇字段**:若 data-model 后续给 `UserProfile` 加向量列,只需把这 0.6/0.4 项替换为余弦相似度,**本篇接口与 evidence 契约不变**。

---

## 4. 提议格式（`StaffingProposal`，含"为什么推荐他"）

### 4.1 实体 `StaffingProposal`（持久化，可审计、可回流）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `str(32)` PK | |
| `work_item_id` | `str(32)` FK→WorkItem | 目标工作项 |
| `escalation_event_id` | `str(32)?` FK | 若由升级触发,关联 `EscalationEvent`(见 [esc](./confidence-risk-escalation.md)) |
| `status` | `str(16)` | `proposed \| confirmed \| adjusted \| dismissed \| superseded` |
| `mode` | `str(16)` | `explained_only`(冷启动) \| `weighted`(有数据) — 决定 UI 是否标"暂无历史" |
| `generated_by` | `str(16)` | `ai`(默认) \| `manual_request` |
| `lead_suggestion_json` | `jsonb` | 一个 `Suggestion`(见 §4.2) |
| `collaborator_suggestions_json` | `jsonb` | `list[Suggestion]` |
| `alternatives_json` | `jsonb` | `list[Suggestion]`(备选可换,top-K 余项) |
| `trace_json` | `Text` | 各候选完整子分 + 权重 + gate(仅后端/审计可见,**不下发客户端**) |
| `model_meta_json` | `jsonb` | provider/model/token 用量(成本治理 [P-COST](../README.md)) |
| `created_at` / `updated_at` | `datetime` | `TimestampMixin` |
| `confirmed_by_user_id` / `confirmed_at` | `str(32)?` / `datetime?` | 人确认者 |

> 设计对齐现有 `RequirementTaskPlan`(`status: draft→confirmed`、`confirmed_by_user_id`、`job_id`、`target_user_id` + 子项 `RequirementTaskItem.suggested_user_id`),是其"工作项级 + 带理由 + 可回流"的升级版。

### 4.2 `Suggestion`（每个被推荐的人 + 为什么）

```jsonc
Suggestion {
  user_id: str,
  nickname: str,                  // 用 User.display_name(已剥离 _deleted_ tombstone)
  role: "lead" | "collaborator",
  // —— 给用户看的(人话,无数值)——
  why: [                          // "为什么推荐他":2~4 条,按子分降序
    { factor: "skill" | "history" | "load" | "affinity",
      headline: str,              // 如 "做过 3 个同类报表,都一次通过"
      tone: "plus" | "caveat",    // caveat=如实点出顾虑(如"他手上有 1 个逾期")
      evidence: [                 // 强制引用,可点开溯源
        { kind: "skill_tag" | "bio_quote" | "past_workitem" | "load_metric",
          ref: str,               // 工作项 code / 引用句 / 标签
          url: str | null }       // 可跳转(/r/<id> 等)
      ] }
  ],
  // —— 后端内部(NOT serialized to client)——
  _score: float,                  // 仅 trace_json,审计用
  _subscores: { skill: float, history: float, load: float, affinity: float }
}
```

> **evidence 与 explainability 同源**:`bio_quote`/`past_workitem` 这类**事实性**证据由 grep 知识库产出,底层结构对齐 [explainability §2](./explainability.md) 的 `KnowledgeSearchHit`(`{source_type, source_url, line_no, snippet}`,`schemas.py:416`);此处 `{kind, ref, url}` 是其面向派活卡片的**渲染投影**。`skill_tag`/`load_metric` 是非事实性的结构化证据(标签/计数),不走 grep。凡涉及项目事实的 `headline` 必须能落到一条 evidence,落不到即按 explainability §3.4 的"无依据"措辞处理,不编造。

**客户端契约硬约束**:序列化给 C-WEB/C-PET 时,`_score`/`_subscores` 字段**必须剔除**;UI 只渲染 `why[].headline` + `evidence`。这是去黑话纪律的接口级落地(见 [glossary](../00-overview/glossary-dejargon.md))。

### 4.3 用户看到的呈现（示意，人话）

> **建议让「阿美」来做这个活**
> · 她做过 3 个类似的数据报表,都一次通过 ✅(点开看)
> · 这周比较闲,现在在线 ✅
> · ⚠️ 她手上还有 1 个快到期的活,你也可以换人
> **再带上「小林」一起**:他上次和阿美合作的活顺利交付了。
> [确认这个安排] [换个负责人▾] [改协作人] [我自己来定]

---

## 5. 人确认 / 调整（闭环落地）

### 5.1 动作与状态流转

```
proposed ──confirm────────────────> confirmed   (落地角色分配)
   │
   ├──adjust(换 lead / 增删 collaborator)─> adjusted ─(可再 confirm)
   ├──request_again(换一批建议)──────────> superseded(旧)+ 新 proposed
   └──dismiss(我自己定,不要建议)─────────> dismissed
```

- **确认 / 调整都落到现有** [`assignments.replace_assignments()`](../../../app/services/assignments.py):它已处理 `lead/collaborator` 去重、`lead 必填于 active 状态`、`claimed_by_*` 兼容快照同步。智能派活只是它的**上游建议者**,不绕过其校验。
- 确认后:写 `confirmed_by_user_id/at`;触发 [pm-mode](./pm-mode-orchestration.md) 的排期/提醒;若需进入"人做"阶段,工作项状态按状态机推进(见 [data-model 状态机](../01-architecture/data-model.md))。
- **调整即弱反馈**:任何 `adjust`/`dismiss` 都生成一条 `StaffingFeedback`(§7),即使用户没明说"AI 推荐错了"。

### 5.2 API 契约（OpenAPI,挂在 [api-contract](../01-architecture/api-contract.md) 的 staffing 路由组）

| 方法 + 路径 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `POST /api/workitems/{id}/staffing/proposals` | `{ generated_by?, collaborator_slots? }` | `StaffingProposalOut` | 触发一次提议(经理模式自动调 / 手动求建议);幂等键 = `work_item_id + 最新 escalation_event_id` |
| `GET /api/workitems/{id}/staffing/proposals/latest` | — | `StaffingProposalOut` | 取当前 `proposed/adjusted` 提议 |
| `POST /api/staffing/proposals/{pid}/confirm` | `{ lead_user_id, collaborator_user_ids[] }` | `AssignmentOut[]` | 确认/微调后落地;**复用** assignments 校验 |
| `POST /api/staffing/proposals/{pid}/dismiss` | `{ reason? }` | `204` | "我自己定";记 feedback |
| `POST /api/staffing/proposals/{pid}/feedback` | `StaffingFeedbackIn`(§7) | `202` | 显式纠正(`FR-STAFF-005`) |

权限:谁能确认/调整 = 谁能管理 assignees,**直接复用** [`permissions.can_manage_requirement_assignees`](../../../app/services/permissions.py)(提交者 / 当前 lead / admin,且工作项处于可编辑状态)。这条把派活护栏接到既有 RBAC,不另起一套。

### 5.3 事件契约（SSE,复用 [`push_bus`](../../../app/services/push_bus.py) topic `req:<id>` 与 `all`）

| 事件 type | topic | data(节选) | 消费端 |
|---|---|---|---|
| `staffing.proposed` | `req:<id>` | `{ proposal_id, mode, lead, collaborators, alternatives }`(已剥分数) | C-WEB / C-PET 渲染建议卡 |
| `staffing.confirmed` | `req:<id>` + `all` | `{ proposal_id, lead_user_id, collaborator_user_ids }` | 看板 / 通知 |
| `staffing.dismissed` | `req:<id>` | `{ proposal_id }` | UI 收起建议卡 |
| `staffing.recomputing` | `req:<id>` | `{ reason: "lead_changed" \| "feedback" }` | 换 lead 后协作人重算的 loading 态 |

> 事件流与 daemon/SSE 边界以 [system-architecture](../01-architecture/system-architecture.md) 为准;桌宠对升级/派活的呈现见 PRD §8.9。

---

## 6. 冷启动降级（无历史 → 解释式推荐）

`FR-STAFF-004`。判定与降级是**逐信号**的,不是全局开关。

### 6.1 触发条件（任一成立即对该候选启用降级）

| 维度 | 冷启动判据 | 降级动作 |
|---|---|---|
| 无协作历史 | `CollaborationGraph` 中该用户样本 `n < N_MIN`(默认 3) | `history_sub` / `affinity_sub` **置为不可用**(不是 0),权重重分配 |
| 自述不全 | `_profile_completeness < 0.5`(§2.1) | UI 提示"资料还少,建议先完善",`skill_sub` 标 `low_confidence` |
| 全新团队 | 整个 workspace 无人有足够样本 | 提议整体 `mode = explained_only` |

### 6.2 降级后的权重重分配

当 `history_sub` / `affinity_sub` 不可用时,把其权重**按比例摊回**仍可用的子分(主要是 `skill_sub` + `load_sub`),保证 `Σw = 1`。例:lead 角色冷启动 → `skill 0.35→0.58, load 0.25→0.42`。

### 6.3 解释式推荐（`mode = explained_only`）

- **不替用户定**:UI 标注"**目前还没有历史数据,这是按大家填写的擅长方向给的初步建议,你来定**"。
- `why` 只含 `skill`/`load` 因子,`evidence` 全来自自述引用与负载,不编造历史。
- **多给候选、弱化排序**:`alternatives` 放宽到 top-5,呈现更平铺,降低"AI 很笃定"的错觉(对齐 PRD 风险表"冷启动"缓解项)。
- 随 `accepted` 数据积累,该用户/团队自动从 `explained_only` 切到 `weighted`(无需人工开关)。

---

## 7. 纠正回流改进（feedback loop）

`FR-STAFF-005`。目标:把"负责人把 AI 推荐的人换掉"沉淀为可学习信号,而非丢弃。

### 7.1 `StaffingFeedback`（实体）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `str(32)` PK | |
| `proposal_id` | `str(32)` FK→`StaffingProposal` | |
| `work_item_id` | `str(32)` FK | 冗余,便于聚合 |
| `kind` | `str(24)` | `replaced_lead \| removed_collaborator \| added_unsuggested \| dismissed_all \| explicit_thumbs_down` |
| `suggested_user_id` | `str(32)?` | 被换掉/被否的那个人 |
| `chosen_user_id` | `str(32)?` | 用户改选的人(`added_unsuggested` 时有值) |
| `reason_md` | `Text?` | 可选理由(打回带理由范式,见 [esc](./confidence-risk-escalation.md)) |
| `actor_user_id` | `str(32)` | 谁纠正的 |
| `created_at` | `datetime` | |

采集点:§5 的 `confirm(微调时 diff)` / `dismiss` / `feedback` 三个 API 自动派生;**隐式信号**(微调 diff)与**显式信号**(thumbs-down)都收。

### 7.2 改进机制（两层,从轻到重）

1. **即时·确定性(无需训练)**:
   - `replaced_lead` / `removed_collaborator` → 在**该 `domain_tag`**(§2.2)内对 `suggested_user_id` 累加一个**软抑制项** `discourage[user][domain]`(按 `HALF_LIFE_DAYS` 衰减,同 `_recency_w`),下次该域派活时其 `score` 乘 `(1 − λ·discourage)`,`λ` 受上限(避免一次纠正永久封杀)。
   - `added_unsuggested` → 对 `chosen_user_id` 在该 `domain_tag` 累加**软提升项**,并回填:若该人 `UserProfile.skill_tags` 未覆盖此域,提示其补全档案(闭合"自述不准"缺口)。
   - `must/exclude` 类硬点名 → 写入该工作项 `WorkItemFeatures.hard_constraints`,立即生效。

2. **周期·权重再标定(数据驱动)**:
   - 离线 job 周期性比对"AI 提议 vs 最终确认"的吻合度(precision/recall,对齐 PRD §13"升级精准度/派活准确度"度量),在 `StaffingWeightConfig` 上做**有界**调参(grid/坐标下降,变更幅度设上限,人可回滚)。
   - 结果只调权重,**不改可解释结构**——任何调整后总分仍可分解、仍出 evidence。

### 7.3 防过拟合 / 公平性边界

- **抑制有上限 + 会衰减**:单人单域的软抑制 clip 到上限并按 `HALF_LIFE_DAYS` 衰减,防"一次换人 = 永久不推荐"。
- **不歧视新人**:冷启动用户的 `history_sub` 不可用而非置 0(§6),避免"没历史 → 永远排不上 → 永远没历史"的死循环。
- **可审计**:每次回流写 [`ActivityLog`](../../../app/models.py) + `StaffingProposal.trace_json`,管理员可看"为什么这个人最近被降权"(治理 [P-AUDIT](../README.md))。

---

## 8. 边界条件与失败处理

| 场景 | 处理 |
|---|---|
| 无 LLM key / 抽取异常 | `WorkItemFeatures` 走 fallback(§2.4)→ 自动进入冷启动解释式推荐;**绝不**因 AI 不可用而阻塞派活,负责人仍可手动指派(走 `replace_assignments`) |
| 候选池为空(全被 gate 出局 / 全员停用) | 提议 `status=proposed` 但 `lead_suggestion=null`,`why` 给"没人满足硬条件(被排除/已停用),请放宽要求或手动指派";不报 500 |
| 候选全部 `busy`/过载 | 不硬禁,照常推荐 + `tone:"caveat"` 如实标"大家都比较忙",由人决策(LoadSnapshot 是软约束,§2.3) |
| 被推荐者在确认前被停用 | `confirm` 时 `replace_assignments` 内 `_users_by_id` 校验失败 → `400 unknown user id`;UI 提示重新取建议 |
| 提议与确认间负载已变 | 提议带 `created_at`;`GET .../latest` 重算;陈旧提议在 confirm 时不阻断(以人确认为准),但记录 drift 供审计 |
| 并发:两人同时改派 | 落地走 `replace_assignments`(DB 层),配合 PG **行级锁**(D-2)对 WorkItem 加锁,后写覆盖前写并发 `staffing.confirmed` 事件让 UI 收敛 |
| 用户明确"不让 AI 干"(`FR-ESC-005` 人工保留开关) | 跳过 worker,**直接**走智能派活;`generated_by` 仍是 `ai`,但全程"提议→人确认",AI 不替人决策(对齐产品宪法第 4 条) |
| 重复触发(同一升级反复点) | 幂等键 `work_item_id + escalation_event_id`;命中则返回既有 `proposed` 提议,旧的置 `superseded` |
| 隐私(NFR-08) | 提议事件按身份隔离,只推给有权管理该工作项 assignees 的人;`trace_json`(含分数)**永不**进入任何客户端可达的响应 |

---

## 9. 与上下游的契约边界（一句话各表）

- **上游(谁来调我)**:[pm-mode-orchestration](./pm-mode-orchestration.md) 在升级后第 ② 步调 `propose()`;[confidence-risk-escalation](./confidence-risk-escalation.md) 提供 `ConfidenceRecord.risk_tier`(本篇 §2.4 `risk_band` 即取自它)。命中率 `hit_rate` 的口径在 [data-model §3.3](../01-architecture/data-model.md),非升级文档。
- **下游(我落到哪)**:确认后写 [`RequirementAssignment`](../../../app/models.py) via [`replace_assignments`](../../../app/services/assignments.py);角色分配进入 [branch-proposal-merge](../03-collaboration/branch-proposal-merge.md) 的分支模型。
- **横切**:权限用 [`can_manage_requirement_assignees`](../../../app/services/permissions.py);可解释范式用 [explainability](./explainability.md);成本/模型用量记 [P-COST](../README.md);全量字段/状态机以 [data-model](../01-architecture/data-model.md) 为准。
- **FR 追溯**:`FR-STAFF-001`(onboarding 必填 → §2.1)、`FR-STAFF-002`(提议含理由 → §4)、`FR-STAFF-003`(一键确认/调整 → §5)、`FR-STAFF-004`(冷启动解释式 → §6)、`FR-STAFF-005`(纠正回流 → §7)。
