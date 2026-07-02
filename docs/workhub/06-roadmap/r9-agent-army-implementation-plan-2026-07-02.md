# R9 · Agent 军团实施施工图（执行级，2026-07-02）

> 读者：codex（执行者）。上游设计：`r9-agent-army/`（00 愿景 / 01 架构映射 / 02 记忆架构 / 03 阶段路线 / 04 风险）——**设计结论以那四篇为准，本文只把它们翻译成可逐条施工的切片**。
> 前置：[`r9-codex-handoff-plan-2026-07-02.md`](./r9-codex-handoff-plan-2026-07-02.md) 的批次 2→4→3→5 必须先收口（本文假设已完成）；其中红线 10 条在军团施工全程有效。
> 总原则（来自 01 架构篇）：**R9 不是新引擎，是在现有单 run 引擎之上长出「拆解—派发—仲裁—回灌」的编排层。** 引擎、判官、预算、技能、记忆雏形都在，禁止重造。
> 注意：规划包里的 file:line 是 2026-06-23 盘点值，代码已漂移——**每个切片开工先 grep 重定位，不要按行号盲改**。

## 北极星与红线（全程不变）

- 产品叙事：**不是 0 人公司，是每个人背后一支军团**。人在中心当指挥官/审批者。
- 硬红线：高风险动作（法务/财务/身份/对外发布）永远升级给人；`human-reserved-guard` 与审批流是产品底线，任何编排「提效」都不许绕。
- 自治纪律：自治到「该敲门的那一刻」为止；困难状态（卡死/升级/打回）是一等公民，必须现形在决策收件箱，不许 happy-path 化。
- 记忆纪律（02 篇铁律）：子 agent 只写 L1 私有记忆；L1→L2 晋升必须过门（judge/人确认）；L2→L3 走既有夜间 curation。记忆改动不悄悄进生产——照搬提议→审批→合并哲学。

## 现状锚点（2026-07-02 已核实）

- `work_items` 状态机已含 `escalated`（转移：`ai_working→escalated→{pm_mode,cancelled}`），`escalation_events` 表已存在（`packages/db/src/schema/core.ts` ~1263）——R9.0 是「接线」不是建表。
- `agent_runs` **无** `parent_run_id/task_plan_id/agent_role`；enqueue 一个 work_item 恰好一条 run。
- cost scope 现有 `workitem/user/team/curation/eval`，**无** `task/objective`。
- DB 迁移编号已到 `0030`；新迁移从 0031 起，走 `packages/db/migrations/` 手写 SQL + `meta/_journal.json` 惯例，必须过 `pnpm audit:migrations`。
- 判官（confidence 矩阵 + 独立 review client + 仅 grade5 auto-merge）、预算 reservation（advisory lock 串行化）、技能库 K1–K5、user_memories 三类注入——全部可复用，位置见 `r9-agent-army/01-architecture.md` §2 表。

---

## R9.0 · 逃生舱接线（1 切片）——自治的安全前置

**目标**：escalate verdict 真的把 work_item 打进 `escalated`，升级卡出现在决策收件箱，人能 resolve/delegate。没有这个，后面任何「自动派发」都是在无逃生舱状态下加速。

施工（新建/扩展）：
1. 排查 `escalation_events` 现有写入点（grep `escalationEvents`/`escalate`）：确认 agent-runner 的 escalate verdict 是否落表 + 是否把 `work_items.status` 置 `escalated`（用现有 CAS 状态守卫）。缺哪段补哪段。
2. 新建 `apps/api/src/routes/escalations.ts`：`POST /api/escalations/:id/resolve`（body: `{action: "retry"|"pm_mode"|"cancel", reason_md?}`）与 `/delegate`（转派他人）。鉴权照抄 approvals 路由的守卫模式（uuid 守卫 + workspace 校验 + CAS）。
3. attention 首页（`apps/api/src/pages/` 里 attention/gold-path 装配处）：查 `escalation_events.resolvedAt IS NULL` → 产 `kind:"escalation"` 的 AttentionItem（title=工作项名，reason_text=escalation reasonMd，actions=[resolve 三选 + delegate]）。契约在 `packages/contracts` 补 kind 枚举值——**记住 xlink-contract 教训：加枚举必须同步 web route-components 与桌面 cuu cards 的渲染分支与本地化，否则用户看到原始英文枚举**。
4. 通知：升级发生时给 work_item 提交人 + 项目 owner 发通知（复用 notifications service，遵守批次 1 的 cap 纪律）。

验收门：
- 单测：escalate verdict → status=escalated + event 落表 + attention 卡出现 + resolve 三个动作各自的状态转移（转移表在 `packages/contracts/src/enums.ts:27`）。
- r1-pg-smoke：加一段「制造 escalate → resolve」断言（改产线行为必须同步 smoke）。
- web/桌面各渲一张 escalation 卡（web smoke 若步数/计数变，按新语义更新精确门并注明）。

---

## R9.1 · Task Plan + Meta-Planner（3 切片）——拆解可审

**目标**：一个意图 → LLM 拆成带角色/验收/预算的子任务计划 → **以提议形式**给人审 → 通过后成为可派发的 task_plan。拆错是全链最大风险，「计划先过人」这道门不许省。

### 切片 1.1 数据与契约
- 迁移 0031：`task_plans`（id, work_item_id, workspace_id, status: draft|proposed|approved|dispatching|done|cancelled, objective_id nullable, budget_json, decomposition_context_json, created_by, timestamps）+ `task_plan_items`（id, plan_id, parent_item_id nullable, seq, title, role: research|produce|review|integrate, objective_md, acceptance_md, budget_share_pct, depends_on uuid[], status: pending|dispatched|succeeded|failed|skipped）。
- `packages/contracts`：`taskPlanVmSchema` + 枚举；所有新枚举值同步双端本地化表。
- 伪测试禁令适用：schema 测试必须走真 drizzle 查询/内存仓库行为，不做 grep 源码。

### 切片 1.2 planner 服务
- 新建 `apps/api/src/services/meta-planner.ts`：输入 work_item（意图+acceptance+已注入的 user/team 记忆），产出 plan draft。LLM 调用照抄 `createLlmClarificationGenerator` 的封装纪律（严格 JSON、超时、maxTokens、成本入账 scope=workitem）。
- 输出自检：先过一道结构校验（每个子任务有验收、无环依赖、role 合法、预算份额和=100），再过 LLM-judge 快评（复用 confidence 思路：模板化/不可测/互相重叠 → 打回重拆一次，仍差 → 直接 escalate 给人）。**拆解失败绝不静默 cancel 工单（批次 0-2 的教训写进测试）。**
- `POST /api/workitems/:id/task-plan`（触发拆解）→ 拆解结果落 `task_plans(status=draft)` 并 `proposals.createFromManifest` 生成「计划提议」；人审通过（merge）→ plan 置 approved。

### 切片 1.3 计划呈现
- web 工作项页加「任务计划」面板（DAG 顺序列表即可，不画图）：子任务标题/角色/验收/依赖/预算份额；提议 diff 视图复用现有审批工作台。
- 桌面 Spotlight workitem 视图加同款只读摘要。
- 验收门：真实意图（如「调研+产出一篇短剧选题报告」）→ 3–5 个原子子任务 → 人在提议里改一处 → merge 后 plan=approved。r1-pg-smoke 补 plan 断言。

---

## R9.2 · 层级派发（3 切片）——一个计划，N 个并行子 run

### 切片 2.1 引擎扩展
- 迁移 0032：`agent_runs` 加 `parent_run_id uuid nullable`、`task_plan_id`、`task_plan_item_id`、`agent_role text`、`objective_md text`。**子 run 就是普通 run**——claim-lease/心跳/恢复/预算全复用，禁止另起执行器。
- `AgentRunQueueRecord` 契约与 openapi 同步（openapi 手写易漂移——批次 5-2 若已建 CI 比对则自动守住，否则手动核）。

### 切片 2.2 dispatcher
- 新建 `apps/api/src/services/task-dispatcher.ts`：
  - `dispatch(planId)`：按 `depends_on` 拓扑序，把无未决依赖的 item enqueue 成子 run（携带 role/objective/acceptance + 从 plan 预算按 `budget_share_pct` 切出的子预算）；有环/依赖失败 → item=skipped + 升级。
  - 完成回调（复用 agent-runner finalize 钩子）：item 状态推进 → 解锁下游 → 全部终态后父级汇总（成功产物清单 + 失败/升级列表）写回 work_item 时间线。
  - 并发安全：item 状态推进用 CAS（`UPDATE ... WHERE status='pending'`），多 worker 下不重复派发（对照 claim-lease 的 SKIP LOCKED 纪律）。
- 工具子集：`createToolRegistry` 按 `agent_role` 过滤（research 无写盘工具、review 只读 + judge 工具、produce 全集）。技能注入（load_skill）不变。
- **读路径三件套**适用于所有新查询：plan 的 items 列表、run 树查询都要 cap + 批量。

### 切片 2.3 可见性
- work_item 详情页：run 树视图（父 run + 子 run 列表：角色/状态/成本/产物链接）。VM 字段进契约，双端渲染 + 本地化。
- 验收门：一个 approved plan → 3 子 run 并行（真 PG smoke 断言并发抢占不重复执行）→ 各产 outputs/ → 父汇总出现在时间线；一个子 run escalate → R9.0 的逃生舱链路被真实触发（集成断言）。

---

## R9.3 · 记忆隔离 + 冲突归并（3 切片）——设计全文见 02 篇，此处只列施工顺序

1. **切片 3.1 L1 私有记忆**：迁移 0033 `agent_memory`（agent_context_id = task_plan_item_id 维度隔离）+ `agent_memory_versions`（append-only，带 base_version 供 diff3）；`services/agent-memory.ts`（读自己的 L1 + L2 + L3，只写 L1）；agent-runner finalize 接 `extractPreferenceMemory`（r6-m1 已设计未接）写 L1。
2. **切片 3.2 晋升门**：`promoteMemory(l1EntryId)`：meta-planner 聚合同 plan 各子 agent 的 L1 → LLM-judge 评「值得晋升/矛盾/噪音」→ 高置信写 L2（user_memories/team_memories），矛盾走 3.3，噪音丢弃。子 agent 无直接写 L2 的代码路径（用类型/接口锁死，不靠自觉）。
3. **切片 3.3 冲突归并**：L2 写入从 upsert 覆盖改为「base 快照 + diff3」：可调和自动并、不可调和产 `memory_conflict` 提议进审批（复用 P-COLLAB 原语——从 proposals ai_fusion 处抽出通用 diff3 helper，别复制粘贴）。补 `user_memories.workspace_id` 租户列（迁移 + 回填 + 查询过滤，参照 0028 workspace_scoped 迁移的写法）。
4. 验收门：两个子 agent 写矛盾偏好 → 不再静默覆盖：要么合并结果带两者、要么弹 conflict 提议；真 PG 并发写不丢更新（pilot-stack-smoke 补断言——**内存假仓库测不出真库合并，这是 P-COLLAB 的既有教训**）。

---

## R9.4 · 跨 Agent 仲裁（2 切片）

1. 新建 `services/cross-agent-judge.ts`：输入同一 plan 下 N 份产出（或同一 item 的重试对比），按验收标准仲裁：采纳其一/合并/全部打回重规划。复用 confidence 矩阵与「独立 client 反自评」设计；输出进 proposal 的 review 记录（可审计）。
2. 高风险任务（plan item 标 `risk: high`，由 planner 标注 + 人在计划提议里可改）：2-of-3 多票对抗（不同 prompt 视角），任一票 escalate 即整体 escalate。成本敏感：多票只对 high 开，token 计入 plan 预算。
3. 验收门：构造两个子 agent 产出矛盾结论 → judge 不盲采、给出带理由的仲裁 + 置信；低置信走人审。**judge 永远不能是「同一个 client 同一段上下文」自评（reviewDeliverable 的既有铁律）。**

---

## R9.5 · OKR + 任务级预算（2 切片）

1. 迁移 0034：`objectives` + `key_results` + `objective_work_item_links`（软链接）。`services/objectives.ts` + 夜间聚合进度（复用 worklog/metrics 聚合模式）。**铁律：OKR 非阻断**——不绑 objective 的 work_item 照跑；OKR 只是规划输入（meta-planner 读它排优先级）与观测镜头（dashboard 展示）。
2. 预算：`packages/cost` 的 `BudgetScope` union 加 `{kind:"task"; taskPlanId}` 与 `{kind:"objective"; objectiveId}`；policy 命名 `pcost-task-*`；enqueue 把 planId/objectiveId 进 scopeIds；复用 reservation advisory-lock 串行化。成本页聚合加对应维度（**遵守批次 1-4 的窄查询纪律，别再全量扫**）。
3. 验收门：objective 设 token 上限 → 旗下子任务累计超限 → 下一次 enqueue 402 → 升级卡给人「加预算/收工/改范围」三选。

---

## R9.6 · 玻璃指挥台（2 切片）——等前面有真数据再做

1. API：`AgentArmyDashboardVM`（zod 契约）：各 plan 汇总（进行中/等审/升级中）、子 agent 角色分布与状态、成本燃烧（按 objective/plan）、判官通过率、最近升级列表。`buildAgentArmyDashboardPage()` 装配（全部窄查询 + cap）。
2. web `/dashboard/agents` 路由 + 桌面 Spotlight `agents` 能力内联视图。**接线雷区清单（每条都踩过）**：`routeMatchers` 计数 +1 并同步 `data-r4-route-tree-route-count`；`shellPageOrder`/`shellPageTitles`（常驻导航，i18n「智能代理军团/Agent Army」）；`GoldPathRenderedPage` key；`metricsForSurface` 加 case；web-live-smoke 步数与请求计数门按新路由更新；desktop `desktopWebviewSurface.pages` 注册；玻璃样式走 main 窗 vibrancy + 既有 ds 类，**禁止新的 transparent+backdrop-filter**；不用定高 line-clamp（CJK 溢出门）。
3. 验收门：web smoke 覆盖新路由两种入口；真实 run 数据渲染；移动端不溢出；桌面 typecheck+测试绿（真机截图标注待人验）。

---

## R9.7 · 加固与对抗收尾（1–2 切片）

- 跨工作区隔离审计：新表（task_plans/agent_memory/objectives）每条查询钉死 workspace 过滤（对照 xlink-authz 审计法：middleware→route→service→SQL 全链）。
- happy-path 反演：构造 partial failure（3 子 run 挂 1）/ 卡死（心跳超时）/ 假 done（产物为空），确认全部现形于 attention 而不是静默。
- 高风险动作红线回归测试：法务/财务/身份类工具调用必须走 human-reserved-guard，写进永久测试。
- 最后：请人发起一轮多 agent 对抗式 review（复用 `reference/audit-r9/` 的工作流管道），挖编排层真问题后再宣布收口。

---

## 依赖与推进顺序

```
批次2 → 批次4 → 批次3(真机项攒着人验) → 批次5
  → R9.0(逃生舱) → R9.1(计划) → R9.2(派发)
      → R9.3(记忆) / R9.4(仲裁) / R9.5(OKR+预算)   ← 三者可并行，但建议按 3→4→5 串行降低同文件冲突
  → R9.6(指挥台) → R9.7(加固) → 人工验收 + 对抗 review
```

每切片 = 一个 commit（或少量紧密 commit），跑满交接文档第五节验证清单，push 后逐 job 核 CI。**任何一个切片卡住超过两次尝试：停下，把卡点写进 `docs/workhub/07-open-questions.md`，跳到下一个不依赖它的切片，不要硬闯。**

## 明确不做（防跑偏）

- 不做 agent 自动注册实体/银行卡/接受 ToS/自动付款（04 风险篇红线）。
- 不重写 AgentRun 执行引擎、不换队列实现、不引入新消息中间件。
- 不做「无人值守全自动 merge」：auto_merge 仍仅限 grade5 且可被 kill-switch 关停。
- OKR 不做强制门禁（非阻断铁律）。
- 指挥台不做花哨 3D/canvas 动效——玻璃语言用现有 design-system。
