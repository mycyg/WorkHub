# R9 · 目标架构:从「单 run」到「会分工的军团」

> 本文把 R9 的四件核心资产 + meta-planner + OKR + LLM-judge + budget,**逐一映射到 WorkHub 现有真实代码**,标清「复用 / 扩展 / 新建」。所有结论基于 2026-06-23 的 9 子系统代码盘点(证据见各处 `file:line`)。
>
> 一句话总览:**R9 不是新引擎,是在现有单 run 引擎之上长出「拆解—派发—仲裁—回灌」的编排层。** 引擎、判官、预算、技能、记忆雏形都在;缺的是它们之间的「军团调度」。

---

## 1. 现状形状:今天是「一个意图 = 一个 run」

```
work_item(意图+验收) ──enqueue──> AgentRunQueueRecord(单条) ──claim-lease──> executeRun()
                                                                              │
                                                  loop.run() 跑一次(内部多步 tool 调用)
                                                                              │
                                          reviewDeliverable(独立 review client) → confidence 矩阵
                                                                              │
                                              verdict: auto_merge(仅 grade5) / human_spotcheck / escalate
                                                                              │
                                                  openProposalFromManifest → 提议→审批→合并
```

- `apps/api/src/workers/agent-runner.ts:1337` `enqueue()` —— 一个 work_item 造**恰好一条** run。
- `agent-runner.ts:919` `executeRun()` —— 调 `loop.run()` **一次**,无任何 spawn 子 run 的代码路径。
- 状态机:`queued→running→{succeeded|failed|escalated|cancelled}`,多 worker 用 `claimNextQueued`(FOR UPDATE SKIP LOCKED)+ 心跳租约抢占。

**这套是 R9 的子 agent 执行器底座——不动它,在它外面套调度。**

---

## 2. 八个 R9 概念 → 真实代码映射

| R9 概念 | 现状 | 证据(file) | 动作 |
|---|---|---|---|
| **① 任务 Task** | work_item(意图+acceptance_items+task_items),launcher spec 拆出验收项 | `services/work-items.ts:863`、`:343` | **扩展**:加 objective 绑定 + task_plan |
| **② 子 agent Sub-agent** | flat 单 run,无层级 | `agent-runner.ts:919`、`:1052` | **新建**:parent_run_id + 派发器 |
| **③ 技能库 Skill-lib** | team_skills 表 + 夜间 curation + load_skill + K1/K2/K3/K5 全在 | `agent-skill-curation.ts`、`packages/tools/src/skills.ts`、`team-skill.ts` | **复用**;**扩展**:按角色分工具子集 |
| **④ 记忆库 Memory-lib** | user_memories 三类 + team_skills + 纠错回灌,top-N 注入 | `services/user-memory.ts:76`、`team-skill-context.ts` | **扩展**:子 agent 隔离 + 冲突归并(见 02) |
| **⑤ meta-planner** | 无;拆解是人工 launcher + 提议合并 | `services/work-items.ts`、`proposals.ts:1816` | **新建**(greenfield) |
| **⑥ OKR System** | 无;最近的是「自治率」北极星 + work_item priority 枚举 | `ai-worklog-metrics.ts`、`enums.ts` | **新建**(greenfield,**非阻断**) |
| **⑦ LLM-judge** | 已在 loop 里:独立 review client + 置信度矩阵 + 仅 grade5 auto-merge + fail-closed | `packages/agent/src/loop/loop.ts:636`、`evaluation/confidence.ts:94` | **复用**;**扩展**:跨子 agent 仲裁 + 高风险多票 |
| **⑧ 预算 Budget** | R2 atomic budget ~95%:cost ledger + 5 档 policy + reservation 硬拦 + labor-split | `packages/cost/src/reservation.ts`、`decision.ts:51`、`pages/cost.ts` | **复用**;**扩展**:加 task/objective scope |

**读法**:绿(③⑦⑧基本复用)、黄(①④扩展)、红(②⑤⑥新建)。R9 的新代码量集中在红黄两栏。

---

## 3. 端到端控制流(目标态)

```
                          ┌─────────────────────────────────────────────┐
   用户意图  ──────────>  │  ⑤ Meta-Planner(新建)                       │
   (work_item)            │  读意图+OKR+user-memory+team-skill            │
                          │  产出 task_plan{子任务[], 角色[], 验收, 预算}  │
                          └───────────────┬─────────────────────────────┘
                                          │  (拆解结果先过 LLM-judge 自检 +
                                          │   可选「人确认/可编辑」门 → 提议复用)
                          ┌───────────────▼─────────────────────────────┐
                          │  Task-Dispatcher(新建)                       │
                          │  for 每个子任务: enqueue({parent_run_id,      │
                          │     agent_role, objective, task_budget})     │
                          └───────────────┬─────────────────────────────┘
            ┌─────────────────────────────┼─────────────────────────────┐
            ▼(并行,claim-lease 抢占)       ▼                             ▼
     子 agent:研究            子 agent:产出            子 agent:复核
   (角色专属工具子集 ← ③)    (private 记忆 ← ④)      (独立 review client ← ⑦)
            │                             │                             │
            └─────────────────────────────┼─────────────────────────────┘
                                          ▼
                          ⑦ Cross-Agent Judge(扩展现有 confidence)
                          仲裁 N 份 proposal:合并 / 取舍 / 打回重规划
                                          │
                          ┌───────────────▼─────────────────────────────┐
                          │  结果 = 证明(outputs/ 交付物,硬门)           │
                          │       + 技能/记忆收割(④ 回灌)               │
                          │       + 提议→审批→合并(不直写 main)          │
                          └───────────────┬─────────────────────────────┘
                                          ▼
                          ⑥ OKR 复盘(观测,非阻断):按 key result 对账 → 调优先级
                          预算对账(⑧ reconcile) · escalated 升级给人(逃生舱)
```

对照 Matrix 灵感稿那张「一个目标变成公司循环」:User→CEO Office→OKR→部门(Lead+Worker)→结果(证明+技能记忆)→复盘。**结构同构,只是我们把 CEO Office = Meta-Planner + Judge,部门 = 子 agent 角色,且 OKR 是观测不是闸门。**

---

## 4. 数据模型变更(最小集)

**扩展现有表 `agent_runs`(AgentRunQueueRecord)**,加四列:
- `parent_run_id uuid NULL` —— 子 agent 指向父 run
- `task_plan_id uuid NULL` —— 归属哪个拆解计划
- `agent_role text NULL` —— 研究 / 产出 / 复核 / …(决定工具子集 + 记忆作用域)
- `objective_md text NULL` —— 子 agent 的目标(覆盖 work_item.title)

**新建表:**
- `task_plans(id, work_item_id, objective_md, success_criteria_json, budget_json, status, created_by_kind)` —— meta-planner 产出
- `task_dependencies(plan_id, from_task, to_task)` —— 子任务 DAG(A 阻塞 B)
- `objectives(id, workspace_id, title, period, owner_user_id, target_metric, status)` —— OKR(⑥)
- `key_results(id, objective_id, title, success_criteria, progress)` —— KR
- `objective_work_item_links(objective_id, work_item_id, weight)` —— 目标↔任务,**软链接、非外键强约束**(OKR 不阻断执行)
- `agent_memory(id, scope_kind, scope_id, agent_context_id, key, value_md, confidence, base_version)` —— 子 agent 隔离记忆 + 冲突归并(见 02)
- `agent_memory_versions(...)` —— 记忆版本史,支撑 diff3 归并

**预算扩展**:`packages/cost` 的 scope union 加 `task` / `objective` 两档,policy 加 `pcost-task-*`,enqueue 时把 taskId 传进 `scopeIds`(`reservation.ts` 的串行化原语直接复用)。

---

## 5. 五个要新建的服务(各自归属)

1. **`services/meta-planner.ts`** —— 读 work_item 意图 + OKR + user-memory,调 LLM 产 task_plan;拆解结果走「LLM-judge 自检 + 可选人确认」再派发。**复用** `proposals` 的 createFromManifest 让计划可审。
2. **`services/task-dispatcher.ts`** —— 遍历 task_plan 子任务,按 DAG 拓扑 enqueue 子 run;监听子 run 完成,汇总进 judge。**复用** AgentRunQueue.enqueue/claim-lease。
3. **`services/cross-agent-judge.ts`** —— 扩展现有 `evaluation/confidence.ts`:从「单 run 自评」升级到「比较 N 份子 agent 产出 + 仲裁 + 高风险多票对抗」。**复用** reviewDeliverable 独立 client 的反自评设计。
4. **`services/agent-memory.ts`** —— 三层记忆读写边界 + 冲突归并(详见 `02-memory-architecture.md`)。**复用** P-COLLAB 的 base-snapshot/diff3 原语(现只用在 proposal,搬到 memory)。
5. **`services/objectives.ts` + `team-memory`** —— OKR CRUD + 进度 rollup + 团队记忆注入(sibling of UserMemoryContextProvider)。**约束:观测/lens,绝不做执行闸门。**

---

## 6. 三条不可违背的继承约束

来自 WorkHub 既有护栏(详见 `04-feasibility-and-risks.md` §2):

1. **不直写生产** —— 每个子 agent 产出走提议→审批→合并,军团不绕过 `proposals` 网关。
2. **OKR 非阻断** —— work_item 没绑 objective 也能正常跑;OKR 只做规划与分析的镜头(盘点结论原话:"objectives are observability, not enforcement")。
3. **租户/工作区隔离** —— 子 agent 的记忆、技能、写操作钉死 workspace 边界(R3 审查出过工作项跨工作区写的洞,军团会放大这风险)。

---

## 7. 已建 vs 待建 一页速查

**已建可直接复用(别重造):**
`AgentRunQueue` 引擎与 claim-lease · `reviewDeliverable` + 置信度矩阵(=LLM-judge) · R2 reservation 预算硬拦 · `team_skills` + 夜间 curation + K1/K2/K3/K5 · user_memories 三类 + 注入 · proposals 提议→审批→合并 + merge-fusion 冲突归并 · P-COLLAB diff3 原语 · 自治率北极星 · cost labor-split(干活 vs 自进化)

**待建(R9 全部价值所在):**
meta-planner 拆解 · 子 agent 层级派发(parent_run_id) · 记忆隔离 + 冲突归并(搬 diff3 到 memory) · 跨 agent 仲裁 + 高风险多票 · OKR 模块(非阻断) · **修 escalated 死状态 + 升级队列上 attention 首页**(逃生舱,安全前置) · 按角色分工具子集 · 任务级预算 scope · Matrix 玻璃指挥台(新路由)

→ 分阶段建造顺序见 `03-roadmap-phases.md`。
