---
module: M-DASHBOARD
layer: L2（执行层 / 业务模块）
status: 🚧
owner: workflow
---

# 看板与度量（Dashboards & Metrics）—— 健康 / 自治率 / 升级精准度 / 信任 / 成本

> **一句话**：M-DASHBOARD 是 WorkHub 的「**驾驶舱**」——把 AI-native 工作中台跑出来的几条命门曲线（**AI 自治率**、**升级精准度**、**信任度**、**成本**）和老本行的**项目健康**摆到一起，回答管理者三个问题：*AI 到底替我干了多少？它该叫人时叫得准不准？这一切花了多少钱？* 它**只敲桌子、不改状态**（沿用现有 `health.py` 的设计立场），所有数字点得回原始工作项与 `AgentRun`。
>
> **范围**：本篇是**页面规划级**——逐页给出路由、布局（顶栏/侧栏/主区/面板/弹层）、关键组件、数据与 API 绑定、SSE 实时订阅、空/加载/错误/无权限四态、关键交互与跳转流、响应式与 **web↔桌宠**差异，并给**文字版 wireframe**。
>
> **边界（不在本篇，交叉处只链接不重复）**：
> - 指标背后的**算法定义**（置信度怎么算、风险怎么评、三触发器、doom-loop）→ [confidence-risk-escalation](../02-ai-engine/confidence-risk-escalation.md)。本模块只**消费**其裁决结果并可视化。
> - 看板的 HTTP/SSE **接口契约**（`/api/project-health` §2.14、新增 `/api/dashboard/*`、事件清单 §5、`job.updated`/`user:{id}` 隔离 §5.3）→ [api-contract](../01-architecture/api-contract.md)。
> - 度量所依赖的**实体字段**（`CostLedgerEntry`/`UsageRecord` 成本事实、`AgentRun.turns_used` 与成本摘要缓存、`ConfidenceRecord.grade/verdict`、`EscalationEvent.trigger`、`Review.decision`、`CollaborationGraph.hit_rate`、`Snapshot.reverted_at`）→ [data-model](../01-architecture/data-model.md) 与 [cost-governance](../02-ai-engine/cost-governance.md)。
> - 成本治理的**预算配额/模型路由策略**（三级预算、超额动作）→ [cost-governance](../02-ai-engine/cost-governance.md) 与 [agent-loop-and-tools](../02-ai-engine/agent-loop-and-tools.md)。本模块只**呈现**用量与配额对比。
> - 术语（健康分 / 自治 / 升级 / 信任 / 设备令牌门 / 置信度三档语气）以 [glossary-dejargon](../00-overview/glossary-dejargon.md) 为权威。**去黑话铁律在本篇尤其关键**：看板**绝不显示** `confidence=0.82` / `risk 7/10` 这类裸数值，只显示比率、计数与人话档位。
>
> **扎根**：本篇由现有「需求管理大师」真实实现演进而来。后端：`app/routers/health.py`（`_health_for_project` 全量评分逻辑）、`app/schemas.py:503`（`ProjectHealthOut`）、`app/services/auto_agent.py`（AI 执行循环，**注意：现状未采集 token/cost，本篇明确标为新增字段**）、`app/models.py:554`（`ActivityLog`，自治率/变更的事实源）。前端：`web/src/pages/HealthPage.tsx`（C-WEB 健康度现状）、`web/src/pages/Dashboard.tsx`（C-WEB 派活看板现状）、`client-tauri/web-src/src/routes/ProjectPulse.tsx`（C-PET「项目快报」现状）、`web/src/pages/PlanningPage.tsx`（负载现状）。共享件：`shared/src/ui/`（`Card`/`Progress`/`CircularProgress`/`Badge`/`EmptyState`/`Skeleton`/`Tabs`/`Tooltip`）、`shared/src/design/status-vocab.ts`（标签/色调权威）。所有路径与行号锚点贯穿全文。

---

## 0. 本模块小节导航

1. 模块在产品里的位置（为什么 WorkHub 必须有「驾驶舱」）
2. 指标定义总表（5 大看板 + 每个指标的口径/公式/数据源/图表类型）
3. 数据与 API 绑定总表（页面用得到的全部端点 + DTO + SSE）
4. 信息架构与路由清单（逐页 + 两端落点）
5. 页面 DASH-1：项目健康度（`/health`，演进自现有）—— 重点页
6. 页面 DASH-2：AI 运营总览（`/dashboard/ai`，新增）—— **命门页·重点**
7. 页面 DASH-3：成本看板（`/dashboard/cost`，新增）—— 重点页
8. 页面 DASH-4：项目内嵌「健康+AI」面板（`/p/:id` 副入口）
9. 桌宠端 DASH-P：「项目快报 + 我的 AI」轻量页（`/me/pulse`，演进自现有）
10. 图表组件清单（无图表库 → 自绘原语约定）
11. 四态规约（空/加载/错误/无权限）总表
12. SSE 实时订阅与 reconcile 规约
13. 响应式与 web↔桌宠差异
14. 设计约束与开放问题

---

## 1. 模块在产品里的位置

WorkHub 的产品宪法是「**AI 是默认劳动力**」。一旦 AI 真在产出交付物、真在受阻时找人，管理者立刻需要一个**可量化、可追责、可解释**的视图来回答：

| 管理者问题 | 对应看板 | 命门程度 |
|---|---|---|
| 项目现在健不健康？哪些活要出事？ | **DASH-1 项目健康度**（演进现有 `health.py`） | 老本行 |
| AI 到底替我干了多少？人只兜了多少底？ | **DASH-2 · AI 自治率** | **命门**（PRD §13 北极星之一） |
| AI「该叫人时叫人」叫得准吗？是不是乱升级 / 该升不升？ | **DASH-2 · 升级精准度** | **命门**（验证 confidence-risk 引擎是否可信） |
| 用户敢不敢把活交给 AI？返工/回滚多不多？ | **DASH-2 · 信任度** | **命门** |
| 这一切烧了多少 token / 钱？谁烧的？ | **DASH-3 成本看板** | **命门**（P-COST / NFR-05/11） |

> **设计立场（沿用现有）**：`HealthPage.tsx:69` 的文案已确立——「健康分只负责敲桌子，不会偷偷改需求状态」。**本模块全部页面延续此立场**：看板是**只读观测面**，不触发状态机、不下指令；要操作请跳转到对应工作项 / 排期页 / 审批页。这也保证看板可以放心地多 worker 并发读，不卷入 §api-contract 的 CAS 写路径。

**现状基线（必须诚实标注）**：今天只有 **DASH-1 的雏形**真实存在——`GET /api/project-health`（`health.py:99`）→ `ProjectHealthOut`（`schemas.py:503`）→ 三端渲染（`HealthPage.tsx` / `ProjectPulse.tsx`）。**DASH-2（AI 运营）与 DASH-3（成本）是全新页面**，依赖 data-model 新增的 `AgentRun` / `ConfidenceRecord` / `EscalationEvent` / `Review` 落库，以及 `AgentRun` 上**现在还不存在**的 `token_in/token_out/cost_estimate`（`auto_agent.py` 现仅传 `max_tokens=32768` 给模型，从不读 `resp.usage`——见 §2 注脚）。

---

## 2. 指标定义总表（5 大看板）

> **口径铁律**：① 每个指标都点得回明细（钻取到工作项 / `AgentRun`）；② 用户面只出**比率/计数/人话档位**，**绝不**出 `confidence`/`risk` 裸分值（去黑话 §3.3）；③ 分母为 0 时显示「样本不足」而非 `NaN`/`0%`（§11 空态）。

### 2.1 看板 A — 项目健康（DASH-1，演进自 `health.py`，**全部已落地**）

| 指标 | 用户标签 | 口径 / 公式（真实代码） | 数据源 | 图表类型 |
|---|---|---|---|---|
| 健康分 | 健康分 | `score = 100 − 逾期×10 − 阻塞×8 − 未接×6 − 临期×4 − 返工×5`，clamp `[0,100]`（`health.py:65-71`） | `Requirement` 聚合 | 大数字 + 进度条 + 圆环 |
| 风险等级 | 健康/看护中/风险高 | `≥80 healthy / ≥60 watch / else risk`（`health.py:72-77`） | 同上 | 色调徽标（`Badge` tone） |
| 逾期 | 逾期需求 | `active 且 due_at < now`（`health.py:24`） | `Requirement.due_at` | 计数卡 + 红色 |
| 临期 | 3 天内到期 | `now ≤ due_at ≤ now+3d`（`health.py:25`） | 同上 | 计数卡 |
| 阻塞 | 阻塞工作区 | `RequirementWorkspace.blocked_reason IS NOT NULL` 计数（`health.py:31-35`） | 个人工作区 | 计数卡 |
| 未接 | 公开池待接 | `status=ready 且无 claimed_by`（`health.py:27`） | `Requirement` | 计数卡 |
| 返工 | 返工中 | `status=revision_requested` 计数（`health.py:26`） | 同上 | 计数卡 |
| 30 天吞吐 | 30天交付 | `accepted_at ≥ now−30d` 计数（`health.py:36`） | `Requirement.accepted_at` | 计数卡 + 迷你趋势(新增) |
| 平均周期 | 平均周期 | `mean(accepted_at − created_at)` 小时（`health.py:37-41`） | 同上 | 大数字(h) |
| 当前负载 | 当前负载 | `Σ estimate_hours(active)`（`health.py:28`） | `Requirement.estimate_hours` | 计数卡(h) + 跳排期 |
| 需求变动 | 需求变动 | 派生数 + `ActivityLog` 中 `schedule/planning/assignees/revision` 动作计数（`health.py:42-49`） | `ActivityLog` | 计数卡 |
| 风险清单 | 风险预警 | 上述命中项的人话句子数组（`health.py:51-64`） | 派生文案 | 项目符号列表 |

> 这一列**无新增后端**即可全量呈现——`ProjectHealthOut` 已带齐这些字段（`schemas.py:503-520`）。WorkHub 仅做**可视化升级**（加圆环、迷你趋势、钻取链接）。

### 2.2 看板 B — AI 自治率（DASH-2 核心区，**新增**）

> 北极星：**AI 直接交付占比**。语义对齐 §5 状态机——`ai_working → in_review → merged`（人没碰执行）= 一次「自治完成」。

| 指标 | 用户标签 | 口径 / 公式 | 数据源（data-model） | 图表类型 |
|---|---|---|---|---|
| AI 自治率 | AI 独立完成占比 | `自治完成的 WorkItem / 已完成总数`；「自治完成」= `merged` 且该 WorkItem 全程无 human `Branch` 提议、无 `pm_mode` 介入 | `WorkItem.mode` + `Branch.actor_kind` + `EscalationEvent`（无升级记录） | 大百分比 + 圆环 + 周趋势折线 |
| AI 经手率 | AI 参与的活 | `存在 actor=ai 的 AgentRun 的 WorkItem / 总数` | `AgentRun`（`actor` 字段） | 计数 + 占比条 |
| 人兜底率 | 转人工占比 | `1 − 自治率`，且拆出「升级转人」vs「人工保留(`human_reserved`)」 | `EscalationEvent` + `WorkItem.human_reserved` | 堆叠条 |
| 平均自治步数 | AI 平均干几步 | `mean(AgentRun.turns_used)`（成功 run） | `AgentRun.turns_used`（演进自 `MAX_TURNS=15`，`auto_agent.py:36`） | 大数字 + 分布直方 |

### 2.3 看板 C — 升级精准度（DASH-2 核心区，**新增·命门**）

> 验证 confidence-risk 引擎「**该叫人时才叫人**」。三触发器(`unqualified`/`user_unsatisfied`/`user_forbidden`)+ 自动信号(`doom_loop`/`budget_exhausted`) 的裁决质量。**这是判断 [confidence-risk-escalation](../02-ai-engine/confidence-risk-escalation.md) 阈值是否需要重标定的主仪表。**

| 指标 | 用户标签 | 口径 / 公式 | 数据源 | 图表类型 |
|---|---|---|---|---|
| 升级精准度 | AI「叫人」叫得准吗 | `好升级 / 全部升级`。「好升级」= 升级后人确认确有问题（人也未轻易 approve 原产物）；反例=人看后秒过（=误升级/狼来了） | `EscalationEvent` × 其后 `Review.decision` | 仪表盘(gauge) + 趋势 |
| 漏升级（假阴） | 该叫没叫 | `auto_merge 或 spotcheck 通过，但随后被打回 / 回滚` 的占比 | `ConfidenceRecord.verdict` × 后续 `Review(reject)` / `Snapshot.reverted_at` | 计数卡 + 红色 |
| 误升级（假阳） | 不必要的打扰 | `升级后人秒过(无打回)` 的占比 | `EscalationEvent` × `Review(approve, 无 reason)` | 计数卡 |
| 触发器构成 | 为什么叫人 | 按 `trigger` 枚举分组计数 | `EscalationEvent.trigger` | 环形/堆叠条 |
| 抽检通过率 | 中档一次过率 | `human_spotcheck` 裁决里 `approve / (approve+reject)` | `ConfidenceRecord(verdict=human_spotcheck)` × `Review` | 占比条 |
| doom-loop 率 | AI 打转次数 | `AgentRun.status=escalated 且 trigger=doom_loop` 占比 | `EscalationEvent.trigger=doom_loop` | 计数卡 |

### 2.4 看板 D — 信任度（DASH-2 侧栏，**新增·命门**）

> 「用户敢不敢把活交给 AI」的代理指标。**低返工 + 低回滚 + 高一次过 = 高信任**。

| 指标 | 用户标签 | 口径 / 公式 | 数据源 | 图表类型 |
|---|---|---|---|---|
| AI 一次过率 | AI 一次做对率 | `AI 产出的 Proposal 中首轮 approve / 首轮总数` | `Proposal(created_by_kind=ai, round=1)` × `Review` | 大百分比 + 趋势 |
| 返工率 | 平均返工次数 | `mean(同一 WorkItem 的 Review(reject) 次数)`；演进自现有「返工」（`revision_requested`） | `Review.decision=reject` | 大数字 + 分布 |
| 回滚率 | 撤销/还原占比 | `已回滚 Snapshot / merge 类 Snapshot 总数`（去黑话：撤销，非 revert） | `Snapshot.reverted_at IS NOT NULL`（沿用 `ProjectDriveOperation.undone_at` 范式，`models.py:222`） | 计数卡 + 红色 |
| 命中率(派活) | 推荐靠谱度 | `CollaborationGraph.hit_rate = accepted/(accepted+revision_requested)`（§data-model 3.3） | `CollaborationGraph`（聚合视图） | 占比条（冷启动→「样本不足」） |
| 人工保留率 | 主动留给人的活 | `human_reserved=true 的 WorkItem / 总数`（三级开关，FR-ESC-005） | `WorkItem.human_reserved` | 计数卡 |

### 2.5 看板 E — 成本（DASH-3，**新增·命门**）

> P-COST / NFR-05/11：用户/团队/任务三级用量与预算对比 + 模型路由分布。
>
> **诚实注脚（关键）**：现状 `auto_agent.py` **不采集 token/成本**——它对话用 `max_tokens=32768`（`auto_agent.py:415`）、复审用 `max_tokens=2048`（`auto_agent.py:560`），但从不读取 `resp.usage.{input_tokens,output_tokens}`。**本看板上线的前置条件**是：provider registry 统一产生 `UsageRecord`，P-COST 归集为 `CostLedgerEntry`；`AgentRun.token_in/token_out/cost_estimate` 只能作为由 ledger 回填的摘要缓存，不能成为看板真相源。模型单价表属 P-COST 配置，业务 route、页面、Cuu 不得硬编码。本篇负责呈现，采集与预算裁决落点见 [cost-governance](../02-ai-engine/cost-governance.md) 与 [agent-loop-and-tools](../02-ai-engine/agent-loop-and-tools.md)。

| 指标 | 用户标签 | 口径 / 公式 | 数据源 | 图表类型 |
|---|---|---|---|---|
| 总成本 | 本期总花费 | `Σ CostLedgerEntry.estimated_cost_cny`（区间内） | `CostLedgerEntry` | 大数字(¥) + 周趋势面积图 |
| Token 用量 | 处理量 | `Σ token_in / Σ token_out` | `CostLedgerEntry.token_in/out` | 双值卡 + 趋势 |
| 按人 | 谁触发的花费 | `groupby(user_id)` 求和 | `CostLedgerEntry` × `User` label | 横向条形榜 |
| 按团队/项目 | 各项目花费 | `groupby(team_id / project_id)` | ledger + `WorkItem.project_id` join | 横向条形 |
| 按工作项 | 单个活的花费 | `groupby(workitem_id)` Top-N 烧钱榜 | `CostLedgerEntry.workitem_id` | 排行表（可钻取） |
| 模型分布 | 用了哪些模型 | `groupby(provider, model)` 计数+成本 | `UsageRecord.provider/model` + ledger cost | 环形图 |
| 预算用量 | 配额还剩多少 | `已用 / 配额`（三级：用户/团队/任务） | `BudgetPolicy` × `BudgetUsage`（ledger 汇总） | 进度条（超额变红 + 告警） |
| 单位成本 | 每完成一个活多少钱 | `总成本 / merged 数` | 派生 | 大数字(¥) |

---

## 3. 数据与 API 绑定总表（页面级）

> 端点契约权威在 [api-contract §2.14](../01-architecture/api-contract.md)；此处给「页面 → 端点 → DTO/事件」的消费视图。**[现]**=今天可直接调；**[新]**=随 data-model 落库后开放。

| # | 方法 路径 | 出参（DTO） | 状态 | 谁用 | 锚点 |
|---|---|---|---|---|---|
| D1 | `GET /api/project-health` | `ProjectHealthOut[]` | **[现]** | DASH-1 / DASH-P | `health.py:99`、`schemas.py:503` |
| D2 | `GET /api/projects/{id}/health` | `ProjectHealthOut` | **[现]** | DASH-4 内嵌 | `health.py:108` |
| D3 | `GET /api/dashboard/autonomy?range=&project_id=` | `{autonomy_rate, ai_touch_rate, handoff_breakdown, avg_turns, escalation_precision, false_neg, false_pos, trigger_breakdown, spotcheck_pass, trust:{first_pass, rework_rate, rollback_rate, hit_rate, reserved_rate}, trend[]}` | **[新]** | DASH-2 | api-contract §2.14 |
| D4 | `GET /api/pages/cost?range=&group_by=&project_id=` | `CostDashboardVM`（`total_cost_cny/token_in/token_out/trend/by_user/by_team/by_workitem/model_breakdown/budget/notices/top_exhaustion_risks`） | **[新]** | DASH-3 | api-contract §2.14/§2.15 + P-COST |
| D5 | `GET /api/projects` | `Project[]` | **[现]** | 项目筛选器（全页复用） | `HealthPage.tsx:23` |
| D6 | `GET /api/planning/workload` | `UserWorkloadOut[]` | **[现]** | DASH-1「负载」联动 | `planning.py:22` |
| D7 | `GET /api/agent-runs/{id}` + `/trace` | `AgentRunOut` / `TraceStep[]` | **[新]** | 任意指标**钻取**到单次 AI 执行 | api-contract §2.6 |
| D8 | `GET /api/workitems/{id}/escalations` | `EscalationEvent[]` | **[新]** | 升级精准度钻取 | api-contract §2.7 |

**SSE 订阅（增量提示，非数据源）**：R2.4 后 `GET /api/push/stream` / `all` 为 **admin-only**，只用于运维/聚合刷新；普通看板不得再把它当公共刷新通道。项目/事项看板应订阅 `workitem:{id}`、后续 `project:{id}` 或 `stream/me`，监听**任一非 `heartbeat` 事件**即触发**节流 reconcile**（重拉 D1/D3/D4），复刻 `Dashboard.tsx:94-143` 的「SSE→refresh + 6s 兜底轮询」双通道模式。相关事件：`requirement.ready` / `requirement.updated`（影响健康），新增 `agent_run.step` / `confidence.assessed` / `escalation.created` / `proposal.merged`（影响 AI/成本，topic `workitem:{id}` 或 `user:{id}`，见 api-contract §5.2）。**私有成本细节不广播**——按人/项目的成本明细只在 REST 拉取时按 `current_user` 可见域返回（§12）。

---

## 4. 信息架构与路由清单（逐页）

| 路由 | 页面 | 端 | 状态 | 入口 | 落点 |
|---|---|---|---|---|---|
| `/health` | **DASH-1 项目健康度** | C-WEB | **[现·演进]** | 「看板▾」下拉「项目健康度」(`App.tsx:319`) + ⌘K 命令 `health`(`App.tsx:135`) | 演进自 `HealthPage.tsx` |
| `/dashboard/ai` | **DASH-2 AI 运营总览** | C-WEB | **[新]** | 「看板▾」下拉新增「AI 运营」+ ⌘K 命令 | 全新页 |
| `/dashboard/cost` | **DASH-3 成本看板** | C-WEB | **[新]** | 「看板▾」下拉新增「成本」（admin 优先）+ ⌘K 命令 | 全新页 |
| `/p/:id`（内嵌段） | **DASH-4 项目健康+AI 面板** | C-WEB | **[现·演进]** | 项目详情页 `ProjectView` 内的「健康」区 | `health.py:108` |
| `/me/pulse` | **DASH-P 项目快报+我的 AI** | C-PET | **[现·演进]** | 桌宠侧栏「项目快报」(`SidebarWork.tsx:31`/`SidebarDispatch.tsx:132`) | 演进自 `ProjectPulse.tsx` |

> **入口落点（扎根现有 `App.tsx`，勿臆造扁平顶栏）**：现仓 C-WEB 顶栏只有 4 个主入口（项目 / **看板▾** / 日程 / 通知，`App.tsx:206-211`），分析类页面都收在「看板▾」二级下拉 `BoardsMenu` 里（派活看板 / 资源排期 / 项目健康度 / 历史搜索，`App.tsx:298-328`）；命令面板 `commands[]` 同步登记（`App.tsx:131-141`）。**DASH-2/3 上线 = 给 `BoardsMenu` 增「AI 运营 / 成本」两项（建议归到新分组「度量看板」与现有「派活方工具」分组并列）+ 给 `commands[]` 增两条**，而非新加顶栏主入口。下方各页 wireframe 顶栏画成一行只为示意可达性，真实层级是「看板▾」下拉。（另：现仓品牌字样仍是「需求管理大师」`App.tsx:204`，WorkHub 为新仓品牌，迁移期可能并存，见 glossary §9「YQGL」行。）
>
> **两端分工（沿用现有定位）**：
> - **C-WEB = 管理/分析端**：完整 5 看板、可钻取、可调区间、可导出。**派活看板（`/dashboard`，`Dashboard.tsx`）保持独立**——它是「工单看板」(operational kanban)，与本模块的「度量看板」(analytics) 是两件事，**不合并**（避免把只读分析面塞进操作面）。
> - **C-PET = 干活端**：只给**轻量个人视角**——「我参与项目的健康」+「我触发的 AI 花了多少/做了几个」。**不放**全局成本/全员自治率（那是管理者的事，且桌宠窗口小）。`ProjectPulse.tsx:66` 现有文案「我参与项目的整体健康度」已是此定位。

---

## 5. 页面 DASH-1：项目健康度（`/health`）—— 重点页

**演进自** `web/src/pages/HealthPage.tsx`（保留其全部数据流与「敲桌子不改状态」立场），升级可视化（圆环、迷你趋势、钻取）。

### 5.1 布局（文字版 wireframe）

```
┌─ TopNav（全局，App.tsx Shell）──────────────────────────────────────────────┐
│  WorkHub   项目  派活看板  [项目健康度]  AI运营  成本  …      ⌘K   昵称▾      │
├──────────────────────────────────────────────────────────────────────────────┤
│  eyebrow: 项目健康度                                                           │
│  H1 项目健康度          说明: 健康分只负责敲桌子，不会偷偷改需求状态。          │
│                                            ┌─[筛选]──────────────────┐         │
│                                            │ ⨂ 项目: [全部项目 ▾]    │ ← URL 同步 │
│                                            │ 区间: [近30天 ▾]        │ (新增)  │
│                                            └─────────────────────────┘         │
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌ 概览四卡（grid md:grid-cols-4）────────────────────────────────────────┐    │
│  │ [平均健康分 82] [风险项目 1] [逾期需求 3] [项目数 7]                   │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────────────────┤
│  主区：项目健康卡网格（xl:grid-cols-2）                                        │
│  ┌─ 项目卡 ────────────────────────────────────────────────────────────┐      │
│  │ ❤ 项目名  [风险高]                              ⊙ 圆环 73            │      │
│  │ proj-slug                                       ▓▓▓▓▓▓░░░ 73         │      │
│  │ ┌[风险 2][30天吞吐 5][当前负载 18h]┐  ← 三 Metric 卡                 │      │
│  │ ┌─ 风险预警 ──────────┐ ┌─ 效率统计 ───────────┐                    │      │
│  │ │ · 3 个需求已逾期     │ │ 活跃 6   已完成 12    │                    │      │
│  │ │ · 2 个工作区阻塞     │ │ 平均周期 41h 变动 4   │ + 迷你吞吐趋势(新) │      │
│  │ └─────────────────────┘ └───────────────────────┘                    │      │
│  │ [需求]  [排期]  [知识库]   ← 跳转按钮（现有）                         │      │
│  └──────────────────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 关键组件 + 数据绑定

| 区 | 组件 | 数据 | 锚点 |
|---|---|---|---|
| 筛选 | `<select>` 项目（URL `?project_id` 同步）+ **新增**区间下拉 | `api.listProjects()` | `HealthPage.tsx:23/47-56`（项目筛选与 URL 同步逻辑**原样保留**） |
| 概览四卡 | `paper-surface` 计数卡 | `avgScore/risky/overdue/rows.length`（前端聚合，`HealthPage.tsx:59-61`） | 同上 |
| 健康卡·分值 | **新增** `CircularProgress`（`shared/ui/Progress.tsx:44`）替/补现有进度条 | `row.score`，tone 按 `scoreTone` | `HealthPage.tsx:112-116` |
| 健康卡·三指标 | `Metric`（现有内部组件） | `risks.length/throughput_30d/load_hours` | `HealthPage.tsx:117-121/155` |
| 风险预警 | 项目符号列表 / 空态绿勾 | `row.risks[]` | `HealthPage.tsx:123-132` |
| 效率统计 | 定义列表 `<dl>` + **新增**迷你吞吐趋势 | `active/accepted/avg_cycle/change` | `HealthPage.tsx:133-141` |
| 跳转 | 「需求/排期/知识库」`Link` | `to=/p/:id`、`/planning?project_id=`、`/knowledge?project_id=` | `HealthPage.tsx:143-147` |

### 5.3 四态

- **加载**：四卡 + 卡网格用 `Skeleton`（现状是直接空渲染，建议补 `<Skeleton>`）。
- **空**：无项目 → `EmptyState title="还没有项目"`（对齐 `ProjectPulse.tsx:69`）。
- **错误**：红框 `bg-red-50`（`HealthPage.tsx:99`，已有）；**钻取项目不存在**→ 自动切「全部项目」+ 提示「项目筛选不存在，已切回全部项目」（`HealthPage.tsx:36-45`，**原样保留**，这是真实修过的健壮性 bug）。
- **无权限**：健康度对**任意已认证用户**开放（`health.py:100` `current_user`，无角色门），故无独立无权限态；但**钻取**到不可见工作项时由目标页的可见性门处理（§11）。

### 5.4 交互与跳转流

筛选项目 → URL `?project_id` 改写（`replace:true`，不污染历史）→ 卡网格收敛为单卡。卡内「排期」跳 `/planning?project_id=`（联动 D6 负载），「需求」跳项目详情。**新增**：点健康分圆环 → 展开该项目的「风险明细抽屉」（列出逾期/阻塞/返工的具体工作项 `Link`，复用 `Drawer`）。

---

## 6. 页面 DASH-2：AI 运营总览（`/dashboard/ai`）—— 命门页·重点

**全新页**。把 §2.2/2.3/2.4（自治率 + 升级精准度 + 信任度）摆进一个驾驶舱。这是验证「[confidence-risk-escalation](../02-ai-engine/confidence-risk-escalation.md) 引擎是否可信」的主仪表。

### 6.1 布局（文字版 wireframe）

```
┌─ TopNav ──────────────────────────────────────────────────────────────────────┐
│  …  派活看板  项目健康度  [AI运营]  成本  …                       ⌘K  昵称▾    │
├──────────────────────────────────────────────────────────────────────────────┤
│  eyebrow: AI 运营                       ┌[筛选]──────────────────────────┐     │
│  H1 AI 帮你做了多少                      │ 项目[全部▾]  区间[近30天▾]      │     │
│  副: AI 自己干、该叫人时叫人——这页看准不准。│ [实时连接 ●] 最近同步 14:03    │     │
│                                          └────────────────────────────────┘     │
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌─ 北极星行（grid md:grid-cols-3，大圆环）──────────────────────────────┐    │
│  │ ⊙ AI 独立完成 68%   ⊙ 叫人叫得准 81%   ⊙ AI 一次做对 74%             │    │
│  │   (自治率·趋势↑)       (升级精准度)        (信任·首轮过)               │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌─ 主区 左 2/3 ───────────────────────────┐ ┌─ 侧栏 右 1/3：信任度 ──────┐  │
│  │ Tabs: [自治率] [升级精准度]              │ │ 返工率   平均 0.4 次/活    │  │
│  │ ── 自治率面板 ──                         │ │ 撤销率   3%  (回滚)        │  │
│  │  折线: 周自治率趋势 ───────╱╲___         │ │ 推荐靠谱度 72% / 样本不足  │  │
│  │  堆叠条: 自治 vs 升级转人 vs 人工保留    │ │ 人工保留   5 个活          │  │
│  │  直方: AI 平均干几步 (turns 分布)        │ ├────────────────────────────┤  │
│  │ ── 升级精准度面板 ──                     │ │ 最近升级（列表，可钻取）   │  │
│  │  gauge: 精准度 81%                       │ │ • REQ-014 不合格 → 人确认  │  │
│  │  环形: 触发器构成(不合格/不满意/禁止/    │ │ • REQ-009 打转  → 人接手   │  │
│  │        打转/超预算)                      │ │ • REQ-021 误升级(秒过) ⚠   │  │
│  │  双计数: 漏升级 2  误升级 5              │ │   → 点开看 AgentRun trace  │  │
│  └──────────────────────────────────────────┘ └────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 关键组件 + 数据绑定

| 区 | 组件 | 数据（D3 `GET /api/dashboard/autonomy`） |
|---|---|---|
| 北极星行 | 3× `CircularProgress`（大号）+ 趋势小箭头 | `autonomy_rate` / `escalation_precision` / `trust.first_pass` |
| 自治率·趋势 | **自绘折线**（§10） | `trend[].autonomy_rate` |
| 自治率·构成 | **自绘堆叠条**（§10） | `handoff_breakdown{autonomy, escalated, reserved}` |
| 自治率·步数 | **自绘直方**（§10） | `avg_turns` + 分布桶（`AgentRun.turns_used`） |
| 精准度·gauge | **自绘半圆 gauge**（§10） | `escalation_precision` |
| 精准度·触发器 | **自绘环形/堆叠**（§10） | `trigger_breakdown{unqualified,user_unsatisfied,user_forbidden,doom_loop,budget_exhausted}` |
| 假阴假阳 | 双计数卡（红/橙） | `false_neg` / `false_pos` |
| 信任侧栏 | 4× 指标行 + `Progress` | `trust.{rework_rate, rollback_rate, hit_rate, reserved_rate}` |
| 最近升级 | 列表（`Card` 行）+ 钻取 | D8 `EscalationEvent[]`（`trigger` 人话化 + `Link` 到 AgentRun trace D7） |

> **去黑话渲染**：触发器枚举 → 人话（`unqualified`→「AI 自查觉得没达标」、`doom_loop`→「AI 在原地打转」、`user_forbidden`→「这个活你选了人来做」，映射见 glossary §3.2）。**精准度的「误升级」行**给橙色警示 + Tooltip「AI 多此一举叫了人，人看一眼就过了——阈值可能偏保守」，引导去 [confidence-risk-escalation](../02-ai-engine/confidence-risk-escalation.md) 调阈值。

### 6.3 四态

- **加载**：北极星圆环 + 面板均 `Skeleton`（圆环骨架用灰圆）。
- **空 / 样本不足**：区间内无 `AgentRun` → `EmptyState title="这段时间 AI 还没接活" description="派点活给 AI，这里就会有数据"`；**分母 < 阈值(如 5)** 的比率显示「样本不足」灰字而非百分比（避免「100% 自治（共 1 个活）」的误导）。
- **错误**：复用 `ProjectPulse.tsx:30-38` 的「非数组守卫」教训——后端返回 `{detail}` 时**不可** `.map`，必须 `Array.isArray` 守卫后渲染红框，否则整页崩。
- **无权限**：自治率/升级精准度对**已认证用户**可见（项目级聚合）；但**跨项目全局**视图建议加角色门（管理者/admin），非管理者只看自己参与项目的聚合（按 `current_user` 的 `Assignment`/`Project.owner` 过滤）——细则见 §12。

### 6.4 交互与跳转流

调区间/项目 → 重拉 D3。点「最近升级」某行 → 跳 `AgentRun` trace（D7，复用 `AILiveView` 的 trace 渲染思路，`AILiveView.tsx`）看 AI 当时到底卡在哪。点触发器环形扇区 → 过滤出该触发器的升级列表（侧栏）。**只读，不下指令**——要改阈值得去引擎配置页（不在本模块）。

---

## 7. 页面 DASH-3：成本看板（`/dashboard/cost`）—— 重点页

**全新页**。前置：provider usage sink 已能写 `UsageRecord`，P-COST 已能归集 `CostLedgerEntry`；`AgentRun.token_in/out/cost_estimate` 只是可选摘要缓存（§2.5 注脚）。

### 7.1 布局（文字版 wireframe）

```
┌─ TopNav … [成本] … ───────────────────────────────────────────────────────────┐
├──────────────────────────────────────────────────────────────────────────────┤
│  eyebrow: 成本                    ┌[筛选]──────────────────────────────────┐    │
│  H1 这一切花了多少                 │ 维度:[按人▾] 区间[近30天▾] 项目[全部▾]│    │
│  副: 只统计 AI 干活的花费。        └────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌ 概览四卡 ──────────────────────────────────────────────────────────────┐    │
│  │ [本期总花费 ¥128] [处理量 1.2M→340K tok] [单位成本 ¥4.6/活] [模型 3 种]│    │
│  └────────────────────────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌─ 主区 左 2/3 ───────────────────────────┐ ┌─ 侧栏 右 1/3 ──────────────┐  │
│  │ 面积图: 每日花费趋势 ▁▂▅▇▃▂              │ │ 预算用量（三级进度条）     │  │
│  │ ── 排行（按所选维度切换）──              │ │ 我的     ▓▓▓▓░ 78% ¥39/50  │  │
│  │  按人:  小李 ████ ¥52                     │ │ 团队A    ▓▓▓▓▓ 超额! ⚠     │  │
│  │         小王 ███ ¥38                      │ │ 某任务   ▓▓░░░ 40%         │  │
│  │  (切「按项目/按工作项」=同款条形/排行表)  │ ├────────────────────────────┤  │
│  │                                           │ │ 模型分布（环形）           │  │
│  │  烧钱榜 Top10 工作项（表，可钻取 D7）     │ │ ◉ deepseek 72%             │  │
│  │  REQ-031  ¥14  18步  → 看 trace           │ │ ◉ …                        │  │
│  └──────────────────────────────────────────┘ └────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 关键组件 + 数据绑定（D4 `GET /api/pages/cost` → `CostDashboardVM`）

| 区 | 组件 | 数据 |
|---|---|---|
| 概览四卡 | 计数卡 | `total_cost_cny` / `token_in,token_out` / `unit_cost_cny` / `model_breakdown.length` |
| 花费趋势 | **自绘面积图**（§10） | `trend[].cost_cny` |
| 维度排行 | **自绘横向条形** + 切换 Tabs（按人/团队/项目） | `by_user[] / by_team[]`（`{label, cost_cny, tokens}`）;普通用户不返回全员 `by_user` |
| 烧钱榜 | 排行表（`Card` 行，可钻取 D7） | `by_workitem[]`（Top-N，`{workitem_id, code, cost_cny, turns}`） |
| 预算用量 | 三级 `Progress`（超额 tone=error + 告警条） | `budget[]: BudgetUsage[]` + `notices[]: BudgetNotice[]` |
| 模型分布 | **自绘环形** + 图例 | `model_breakdown[]`（`{provider, model, count, cost_cny}`） |
| 即将耗尽 | 轻量风险列表 | `top_exhaustion_risks[]`（只展示当前 actor 可见范围） |

### 7.3 四态

- **加载**：`Skeleton`。
- **空**：无 `CostLedgerEntry` 或 usage sink 未接入（**采集未上线**）→ `empty_state="no_agent_runs"` 或 `empty_state="usage_not_connected"`，页面显示 `EmptyState title="还没有成本数据" description="AI 接活后会自动记账"`。**这是当前最可能的真实态**（采集是新增）——页面必须优雅退化，不报错。
- **错误**：`Array.isArray` 守卫（同 §6.3）。
- **无权限**：**成本含隐私**——`by_user` 暴露「谁烧了多少」。非 admin/非项目 owner **只看自己的花费**（按 `current_user` 过滤），全员排行仅 admin 可见（§12，对齐 NFR-08 隐私隔离的精神）。

### 7.4 交互与跳转流

切维度（按人/团队/项目）→ 重排主区条形。烧钱榜某行 → 钻取该工作项的 `AgentRun` 列表 + 单次 trace（D7）。预算超额 → 红条 + 顶部告警「团队 A 本期 AI 预算已超」，告警动作直接来自 `BudgetNotice.options/action_href`，**链接到 P-COST 配额配置**（不在本模块）。**导出**：右上「导出 CSV」按当前筛选导明细（管理刚需）。

---

## 8. 页面 DASH-4：项目内嵌「健康+AI」面板（`/p/:id` 副入口）

不是独立路由，是**项目详情页**（`ProjectView`）里的一段。复用 D2（`GET /api/projects/{id}/health`，`health.py:108`）+ D3 的 `project_id` 过滤版。

### 8.1 布局（文字版 wireframe，嵌入项目页）

```
┌─ 项目详情页 /p/:id ────────────────────────────────────────────┐
│  …（项目头、需求列表…）                                        │
│  ┌─ 健康 & AI 速览（折叠段）─────────────────────────────────┐  │
│  │ ❤ 健康分 78 [看护中]    🤖 AI 自治 64%   叫人准 80%        │  │
│  │ ▓▓▓▓▓▓▓░ 78            ⊙              ⊙                  │  │
│  │ 风险: · 2 逾期 · 1 阻塞        [去 AI 运营详情 →]          │  │
│  └────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 8.2 要点

- **数据**：单项目 `ProjectHealthOut`（D2）+ 单项目自治/精准度（D3 带 `project_id`）。
- **四态**：加载 `Skeleton`；该项目无 AI 活 → 只显示健康段，AI 段显「这个项目还没派给 AI」。
- **跳转**：「去 AI 运营详情」→ `/dashboard/ai?project_id=:id`；健康风险句 → 钻取对应工作项。
- **无权限**：项目不可见则整段不渲染（由 `ProjectView` 的项目可见性门兜底）。

---

## 9. 桌宠端 DASH-P：「项目快报 + 我的 AI」（`/me/pulse`）

**演进自** `client-tauri/web-src/src/routes/ProjectPulse.tsx`（保留其 `clientFetch` + 非数组守卫 + 现有卡片），**增量加**一段「我的 AI」。

### 9.1 布局（文字版 wireframe，窄窗）

```
┌─ 桌宠主窗（TitleBar + SidebarWork/Dispatch + 主区）──────────────┐
│ [侧栏]│ H2 项目快报                                               │
│ 公共池│ 我参与项目的整体健康度。                                  │
│ 派给我│ ┌─ 我的 AI（新增条幅）──────────────────────────────┐    │
│ 进行中│ │ 🤖 这周 AI 替我做了 7 个活 · 花了 ¥23 · 1 个打回   │    │
│ …     │ └────────────────────────────────────────────────────┘    │
│ ───   │ ┌ 项目卡(grid md:2 xl:3) ──────────────────────────┐      │
│ 我的负载│ │ 项目名 [健康]  健康分 82 ▓▓▓▓▓▓▓░               │      │
│ 我的日程│ │ [活跃 6][30天交付 12][逾期 0]                    │      │
│ 历史检索│ │ • 风险句…（≤3 条）                               │      │
│[项目快报]│ └──────────────────────────────────────────────────┘      │
│ ───   │                                                            │
│ 通知  │                                                            │
│ 设置  │                                                            │
└──────────────────────────────────────────────────────────────────┘
```

### 9.2 关键组件 + 数据绑定

| 区 | 组件 | 数据 | 锚点 |
|---|---|---|---|
| 我的 AI 条幅 | **新增** `Card`（一行摘要） | D3 的「我」切片：`me.{ai_done_count, cost, rework}`（按 `current_user` 过滤） | 新增 |
| 项目卡 | `Card`+`Progress`+`Badge`+`glass-sunken` | D1 `ProjectHealthOut[]`（**只我参与的**） | `ProjectPulse.tsx:71-110`（**原样保留**卡片结构） |
| 风险句 | 项目符号 `slice(0,3)` | `risks[]` | `ProjectPulse.tsx:103-108` |

> **桌宠克制**：条幅只给「我触发的 AI」的轻量三数（做了几个/花了多少/几个打回），**不展开**全局看板。点条幅可 deep-link 到 web 端 `/dashboard/ai`（若仅桌面运行则在内嵌 webview 打开），桌宠本身不渲染重型图表（窗口小 + 干活端定位，对齐 README §1 C-PET 职责）。

### 9.3 四态（沿用现有，已是真实健壮实现）

- **加载**：`<div>加载中…</div>`（`ProjectPulse.tsx:53`）。
- **空**：`EmptyState title="还没有项目"`（`ProjectPulse.tsx:69`）。
- **错误**：`glass p-4 text-error` 显错 + **非数组守卫**（`ProjectPulse.tsx:30-49`，**必须保留**——这是修过的「route appeared to crash」真实 bug）。
- **无权限**：桌宠请求带设备令牌（`clientFetch` 自动附 `X-YQGL-Client-Token`，见 api-contract §7）；健康端点本身不需设备门。

---

## 10. 图表组件清单（无图表库 → 自绘原语约定）

> **关键现实**：现仓**没有任何图表库**（`web/package.json`、`client-tauri/web-src/package.json`、`shared/package.json` 均无 recharts/d3/visx/nivo）。现有可视化全是**手绘 div + Tailwind**——健康进度条是 `div` 宽度（`HealthPage.tsx:114-116`），`CircularProgress` 是 `shared/ui/Progress.tsx:44` 的 SVG 圆环。**本模块沿用此风格**，把常用图表收敛为一组 `C-UIKIT` 新增原语（详见 [shared-ui-kit](../05-clients/shared-ui-kit.md)），避免引入重型依赖（与「瘦客户端 + LAN-first」一致）。

| 图表 | 实现方式 | 复用/新增 | 用在哪 |
|---|---|---|---|
| 大数字卡 | 现有 `paper-surface`/`glass-sunken` + 文本 | 复用 | 全看板概览 |
| 线性进度条 | `Progress`（`Progress.tsx:20`，tone 五色） | 复用 | 健康分、预算、占比 |
| 圆环 | `CircularProgress`（`Progress.tsx:44`，SVG） | 复用 | 健康分、北极星三圆环 |
| 半圆 gauge | SVG 弧（`CircularProgress` 变体，270°→180°） | **新增** `Gauge` | 升级精准度 |
| 折线/面积趋势 | SVG `polyline`/`path`（响应式 viewBox） | **新增** `Sparkline`/`AreaTrend` | 自治率趋势、花费趋势、迷你吞吐 |
| 横向条形榜 | flex 行 + `div` 宽度归一化 | **新增** `BarList` | 成本按人/项目、触发器 |
| 堆叠条 | flex 分段宽度 | **新增** `StackedBar` | 兜底构成、触发器构成 |
| 环形/饼 | SVG `circle` `stroke-dasharray` | **新增** `DonutChart` | 模型分布、触发器构成 |
| 直方图 | `div` 柱（桶化数据） | **新增** `Histogram` | AI 平均步数分布 |

> **可达性约定**（沿用现有 `aria-label`/`aria-hidden` 习惯，如 `HealthPage.tsx:73/106`）：每个自绘图表配 `role="img"` + `aria-label` 概述（如「自治率近30天趋势，从58%升至68%」），并提供**数据表 fallback**（`<details>` 内嵌 `<table>`），让纯数字也能读到——看板尤其需要无障碍，因为它是决策面。

---

## 11. 四态规约（空 / 加载 / 错误 / 无权限）总表

| 页面 | 空 | 加载 | 错误 | 无权限 |
|---|---|---|---|---|
| DASH-1 健康 | `EmptyState`「还没有项目」 | `Skeleton`（建议补） | 红框 + **筛选不存在自动回退**（`HealthPage.tsx:36-45`） | 全员可读；钻取由目标页门控 |
| DASH-2 AI | 「这段时间 AI 还没接活」/ 分母<阈值显「样本不足」 | `Skeleton`（含圆环骨架） | **`Array.isArray` 守卫**后红框 | 全局视图建议角色门；非管理者只看己方参与项目 |
| DASH-3 成本 | 「还没有成本数据」（**采集未上线的真实态**） | `Skeleton` | `Array.isArray` 守卫 | `by_user` 全员榜仅 admin；他人只看自己 |
| DASH-4 内嵌 | AI 段显「还没派给 AI」 | `Skeleton` | 整段降级，不崩项目页 | 项目不可见则不渲染 |
| DASH-P 桌宠 | `EmptyState`「还没有项目」（`ProjectPulse.tsx:69`） | 「加载中…」（`ProjectPulse.tsx:53`） | `text-error` + **非数组守卫**（现有） | 设备令牌由 `clientFetch` 附带 |

**通用规约**：① **分母为 0 → 「样本不足」**，绝不 `NaN`/误导性 `100%`；② **比率永远显比率/计数/人话**，不显裸 `confidence`/`risk` 分值（去黑话 §1.2 硬规则 3）；③ **错误体永远先 `Array.isArray` 守卫再 `.map`**（`ProjectPulse.tsx` 的真实教训，后端错误返回 `{detail}`）。

---

## 12. SSE 实时订阅与 reconcile 规约

**双通道（REST 为真相 + SSE 为增量提示）**，复刻 `Dashboard.tsx` 已验证的健壮模式：

1. **订阅**：管理员看板可订 `GET /api/push/stream`（`all` admin-only）；普通页面订 `stream/me` 或资源 topic。监听非 `heartbeat` 事件 → 触发**节流 reconcile**（重拉本页 D1/D3/D4）。指数退避重连（`Dashboard.tsx:98-135`，**必须保留**：单次 SSE 断连曾让看板永久显示「已断开」）。
2. **兜底轮询**：无事件时 6s 轮询一次（`Dashboard.tsx:38` `TICK_MS`），并在 **tab 隐藏时暂停、返回时立刻刷新**（`Dashboard.tsx:82-87`，省服务器扇出）。
3. **单调 token 防乱序**：并发刷新只让最新一次写状态（`Dashboard.tsx:46-56` `refreshTokenRef`，看板多指标并发拉取，乱序会闪烁旧快照）。
4. **相关事件**：健康受 `requirement.ready`/`requirement.updated` 影响；AI/成本受新增 `agent_run.step`/`confidence.assessed`/`escalation.created`/`proposal.merged` 影响（api-contract §5.2）。
5. **隐私隔离（NFR-08，沿用真实修复）**：看板不再把 `all` 当公共流；`GET /api/push/stream` 只给 admin 聚合刷新。普通用户走 `stream/me` 或资源 topic，**绝不订阅**他人的 `user:{id}` 私有 topic 来拼数据；**成本/自治的按人明细只在 REST 拉取时按 `current_user` 可见域服务端过滤**。现成的真实隔离范式有二：① 私有投递走 `stream/me`，topic 是服务端从 cookie 推出的 `user:{user.id}` 而**非路径参数**；② 单事项流 `stream/workitem/{id}` / `stream/req/{id}` 由 WorkItem 可见性门把关，看不到的事项订阅不了。SSE 只承载「有变化了，去重拉」的信号，不承载明细。

---

## 13. 响应式与 web↔桌宠差异

| 维度 | C-WEB（管理/分析端） | C-PET（桌宠/干活端） |
|---|---|---|
| 路由 | `/health`、`/dashboard/ai`、`/dashboard/cost`、`/p/:id` 内嵌 | 仅 `/me/pulse`（轻量个人视角） |
| 看板范围 | 全 5 看板，跨项目/全员，可钻取/调区间/导出 | 只「我参与项目健康」+「我的 AI」三数摘要 |
| 成本 | 完整（admin 看全员榜） | **不展示全员成本**，只「我触发的花费」 |
| 图表密度 | 高（折线/gauge/环形/排行/直方） | 低（进度条 + 计数卡，不渲染重型 SVG 图） |
| 网格 | `md:grid-cols-4` 概览、`xl:grid-cols-2/3` 卡、左右 2:1 分栏 | `md:grid-cols-2 xl:grid-cols-3`（`ProjectPulse.tsx:71`） |
| 取数 | cookie（浏览器） | `clientFetch` + 设备令牌（`tauri.ts`，api-contract §7） |
| 入口 | 「看板▾」下拉 `BoardsMenu`（`App.tsx:298-328`）增「AI运营/成本」+ ⌘K `commands[]`（`App.tsx:131-141`）增两条 | 侧栏「项目快报」(`SidebarWork.tsx:31`) |
| 容器 | `app-container`/`paper-surface`（纸感主题） | `glass`/`glass-sunken`（玻璃主题，`ProjectPulse.tsx`） |
| 跳转重图表 | 站内 | deep-link 回 web 端 `/dashboard/ai`（窗口小不内渲） |

> **响应式断点**：概览卡 `grid-cols-1 → md:grid-cols-4`；主区左右分栏 `< lg` 时上下堆叠（侧栏信任度/预算落到主区下方）；横向条形榜在窄屏标签换行（沿用 `HealthPage.tsx:65` `lg:flex-row` 的响应式习惯）。

---

## 14. 设计约束与开放问题

**约束（硬性）**：
1. **只读观测面**：看板不触发状态机、不写业务对象，不进 CAS 写路径（沿用 `health.py` 立场）。
2. **去黑话**：绝不出 `confidence=0.82`/`risk 7/10`；只出比率/计数/人话档位（去黑话 §1.2/§3.3）。
3. **REST 为真相**：SSE 会丢（背压，api-contract §5.1），看板状态以 REST 拉取为准，事件只触发 reconcile。
4. **隐私**：按人/项目成本明细服务端按可见域过滤，私有不入 `all` 流（NFR-08）。
5. **无图表库**：图表用自绘 SVG/div 原语收敛进 `C-UIKIT`（§10），不引重依赖。

**开放问题（待收敛，登记到 [07-open-questions](../07-open-questions.md)）**：
- **OQ-DASH-1（采集前置）**：provider registry 何时把 `resp.usage` 统一写成 `UsageRecord`，并由 P-COST 幂等归集为 `CostLedgerEntry`？成本看板（DASH-3）**强依赖**此项，否则永远空态。`AgentRun.token_in/out/cost_estimate` 只允许作为 ledger 派生摘要；模型单价表已收口到 P-COST 的 provider/model 配置，业务逻辑不得硬编码单价。
- **OQ-DASH-2（精准度判据）**：「好升级 / 误升级」的判据需 confidence-risk 引擎共定——「误升级=人秒过」是否过严？是否要引入「人虽 approve 但确认了 AI 提的风险点」的中间态？（与 [confidence-risk-escalation](../02-ai-engine/confidence-risk-escalation.md) 对齐。）
- **OQ-DASH-3（全局视图权限）**：跨项目/全员的自治率与成本榜，是否仅 admin/管理者可见？非管理者的「全局」是否退化为「我参与项目的聚合」？（与 [security-and-permissions](../01-architecture/security-and-permissions.md) 的 RBAC 对齐。）
- **OQ-DASH-4（区间与留存）**：区间下拉的默认值（近30天？）与历史留存窗口；`AgentRun`/`EscalationEvent` 量大后，看板聚合是否需要预聚合表/物化视图（对齐 `CollaborationGraph` 的物化视图思路，data-model §3.3）。
- **OQ-DASH-5（派活看板是否并入）**：`/dashboard`（工单 kanban，`Dashboard.tsx`）与本模块的分析看板长期是否合并入口？本篇建议**不合并**（操作面 vs 观测面），待信息架构定稿确认。

---

*下一步：本篇定页面与四态；指标背后的算法在 [confidence-risk-escalation](../02-ai-engine/confidence-risk-escalation.md)，接口/事件契约在 [api-contract §2.14](../01-architecture/api-contract.md)，依赖实体字段在 [data-model](../01-architecture/data-model.md)，自绘图表原语在 [shared-ui-kit](../05-clients/shared-ui-kit.md)，成本采集与账本真相源在 [cost-governance](../02-ai-engine/cost-governance.md)，AgentLoop 只消费其裁出的预算。*
