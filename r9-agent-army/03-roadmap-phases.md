# R9 · 分阶段建造路线图

> 原则:**先修安全洞 → 先打地基(任务/派发)→ 再上记忆归并 → 再上仲裁/OKR → 最后玻璃指挥台。** 每阶段标清复用/新建/踩雷点/验收门。顺序遵循 WorkHub 既有纪律:能机械验证的先做、护栏先于自治、PG smoke 是唯一真库门。

排序逻辑:**逃生舱(escalated)是自治的前置安全件,放最前;指挥台是门面,放最后(等真数据)。**

---

## R9.0 · 地基盘点 + 安全前置(1 个切片)

**目标**:不重造已建的,先补一个安全洞。

- **盘点冻结**:judge(`confidence.ts`)、预算 reservation、技能库 K1–K5、记忆三类——确认「复用不重造」(详见 01 §7)。
- **修 escalated 死状态(逃生舱漏洞)**:`work_items.escalated` 是合法状态但生产里从没被可靠写过 / escalation 不上 attention 首页。
  - **新建**:`routes/escalations.ts`(resolve/delegate),`pages/attention.ts` 查 `escalation_events.resolvedAt IS NULL` → 建 `kind='escalation'` 的 AttentionItem,带 reasonMd + suggested_lead。
  - **复用**:approvals 的 respond/delegate 模式、CAS guard、notification。
- **踩雷**:改 attention 首页要同步 `proposal-review-attention.test.ts` 与 PG smoke;`/api/pages/attention` 断言新增 escalation 卡片。
- **验收**:制造一个 escalate verdict → work_item.status 真的进 escalated → 升级卡出现在决策收件箱 → 人能 resolve/delegate。

---

## R9.1 · 任务与 Meta-Planner(2–3 切片)

**目标**:意图能被自动拆成子任务计划,且计划可审。

- **新建**:`task_plans` + `task_dependencies` 表;`services/meta-planner.ts`(读 work_item 意图 + user-memory + 未来 OKR → LLM 产 task_plan{子任务[], 角色[], 验收, 预算});`POST /tasks`(decompose 端点)。
- **复用**:`proposals.createFromManifest` —— **拆解结果以提议形式落地**,人可审可编辑(别让 planner 拆完直接派发);merge-fusion 做拆解质量门(子任务是否原子/可测/独立)。
- **关键设计**:planner 拆完先过 LLM-judge 自检 → 高置信可自动派发 / 否则进 attention 等人点头。**拆错是最大风险**(整条链白跑),这道门不能省。
- **踩雷**:task_items 现在是 flat(无 parent_task_id),要加 `parent_task_id/depth`;decomposition 要存 trace(`decomposition_context`)供 judge 与回灌。
- **验收**:给一个真实 work_item(如「调研+产出一篇短剧选题报告」)→ planner 产出 3–5 个带角色与验收的子任务 → 人在提议里能改 → 通过后落 task_plan。

---

## R9.2 · 子 Agent 层级派发(2–3 切片)

**目标**:一个计划能派生多个并行子 run,各带角色与目标。

- **扩展** `agent_runs`:加 `parent_run_id / task_plan_id / agent_role / objective_md`。
- **新建**:`services/task-dispatcher.ts` —— 按 DAG 拓扑序 enqueue 子 run,监听完成、汇总。
- **复用**:AgentRunQueue.enqueue/claim-lease/心跳租约(子 run 就是普通 run,多 worker 自然并行抢占);per-run budget。
- **扩展技能库**:`createToolRegistry` 按 `agent_role` 分工具子集(研究 agent ≠ 产出 agent ≠ 复核 agent)。
- **踩雷**:子 run 的预算要从 task_plan 预算里切(见 R9.5 任务级 scope);父子 run 的状态汇总别和现有 work_item 状态机打架(CAS 守护)。
- **验收**:一个 task_plan → 派 3 个子 run 并行跑 → 各产 outputs/ 交付物 → 父 run 汇总;真 PG smoke 下并发抢占不重复执行。

---

## R9.3 · 记忆隔离 + 冲突归并(2–3 切片)

**目标**:子 agent 各有私有记忆,治理记忆冲突不再静默覆盖。详见 `02-memory-architecture.md` §5。

- **新建**:`agent_memory` + `agent_memory_versions` 表;`services/agent-memory.ts`。
- **复用**:P-COLLAB 的 base-snapshot/diff3(从 `proposals` ai_fusion 搬到 memory);`UserMemoryContextProvider` 加 `agent_context_id`。
- **接线**:`extractPreferenceMemory`(r6-m1 已设计未接)补到 `agent-runner.ts` finalize → 写 L1;`correctionFromReview` 改成 L1→L2 晋升门。
- **多租户**:填 `user_memories.workspace_id`,按租户过滤。
- **验收**:两个子 agent 写矛盾 L2 记忆 → diff3 自动合并(可调和)或弹 `memory_conflict` 提议(不可调和);真 PG 并发不丢更新(对照 pilot-stack-smoke)。

---

## R9.4 · 跨 Agent 仲裁(Judge 升级)(1–2 切片)

**目标**:从「单 run 自评」升到「比较 N 份子 agent 产出 + 仲裁」。

- **扩展** `evaluation/confidence.ts` → `services/cross-agent-judge.ts`:比较多份 proposal,合并/取舍/打回重规划;高风险任务上**多票对抗验证**(2-of-3,prompt 各异,参考 WorkHub review 那套对抗)。
- **复用**:reviewDeliverable 的独立 client 反自评设计、置信度矩阵、仅 grade5 auto-merge、fail-closed 惩罚。
- **可选增强**:结构化验收门(测试通过率/覆盖率)、产物 hash 溯源。
- **踩雷**:judge 与执行同源会自我背书——多票要用不同视角/不同 prompt;成本会涨(N 票 × token),只对高风险开。
- **验收**:两个子 agent 给矛盾产出 → judge 不盲采,按验收标准仲裁出合并方案 + 置信;高风险任务触发多票。

---

## R9.5 · OKR System + 任务级预算(2 切片)

**目标**:目标↔任务对账(观测),预算按目标/任务设硬上限。

- **新建**:`objectives` + `key_results` + `objective_work_item_links`(软链接)+ `team_memories` 表;`services/objectives.ts`;夜间 `ObjectiveProgressAggregator`。
- **铁律**:**OKR 非阻断**——work_item 没绑 objective 也照跑,OKR 只做规划/分析镜头(盘点原话:observability, not enforcement)。
- **预算扩展**:`packages/cost` scope union 加 `task/objective`,policy 加 `pcost-task-*`,enqueue 把 taskId/objectiveId 传进 scopeIds;**复用** reservation 串行化原语(advisory lock per (scope,bucket))。
- **复用**:cost ledger、labor-split、自治率北极星(作为 OKR 的系统级 KR 之一)。
- **踩雷**:OKR 表多但都是新增,不碰核心 loop;预算 scope 加列要走 migration + cost dashboard 聚合。
- **验收**:给 objective 设 token 上限 → 旗下子任务总花超限 → enqueue 被 402 拦 → 升级给人「加预算/收工/改范围」。

---

## R9.6 · Matrix 玻璃指挥台(2–3 切片)

**目标**:把军团状态做成 Matrix 那张玻璃 dashboard,人能一眼指挥。

- **新建**:web 新路由 `agent-army`;`AgentArmyDashboardVM`(队列深度、各角色子 agent 状态、成本燃烧、成功率、各「部门」进度);`buildAgentArmyDashboardPage()`;React 组件 + SSE/轮询实时;玻璃渲染(desktop 已有 glass-window,web 补 modal)。
- **复用**:route-registry 模式、GoldPath shell、page VM Zod 契约、desktop liquid-glass design-system、SSE(`shell-events.ts`)。
- **踩雷(盘点已列全)**:`routeMatchers` 17→18 + 同步 `data-r4-route-tree-route-count`;`shellPageOrder` 加 agent-army(**非 detail-only**,常驻导航);`shellPageTitles` 加 i18n「智能代理军团 / Agent Army」;`metricsForSurface` 加 case;smoke 测 `/dashboard/agents` 两种入口;desktop `desktopWebviewSurface.pages` 注册。web smoke 别用定高 line-clamp(CJK 换行触溢出门)。
- **验收**:路由实路由冒烟进 CI;玻璃 dashboard 渲染真实 agent-run 数据;移动端不溢出。

---

## R9.7 · 加固与对抗收尾(1–2 切片)

- 跨工作区隔离审计(记忆/技能/写操作钉死租户)。
- 高风险动作(法务/财务/身份)强制升级给人——**绝不让 agent 自动办银行卡/接 ToS**(红线,见 04)。
- happy-path 反演:构造 partial failure / 卡死 / 假装 done,确认困难状态都现形在 attention。
- 多 agent review 对抗一轮,挖编排层真问题。

---

## 阶段依赖图

```
R9.0 安全前置(逃生舱)
   └─> R9.1 任务+Planner ──> R9.2 子agent派发 ──┬──> R9.4 跨agent仲裁 ──┐
                                                ├──> R9.3 记忆归并 ──────┤
                                                └──> R9.5 OKR+任务预算 ──┴──> R9.6 玻璃指挥台 ──> R9.7 加固
```

R9.3 / R9.4 / R9.5 可在 R9.2 之后**并行**推进(互不强依赖);R9.6 等前面有真数据再做。

---

## 每阶段通用门(WorkHub 纪律)

- `pnpm verify`(typecheck + test + lint + 文档一致性门)全绿;新 `*.test.ts` 写完补 `pnpm -r typecheck`(tsx 不严格查类型)。
- 改产线行为同步改 PG smoke 断言;`gh run view --json jobs` 逐 job 核 conclusion(watch 退出码不可靠)。
- 只 targeted `git add` 自己改的,绝不 `git add -A`(工作树常有并行脏文件)。
- 增删 `docs/workhub/*.md` 要同 commit 改 README「N 篇文档已落盘」计数——**本 R9 规划包在 `r9-agent-army/`,不在 `docs/workhub/`,不触发该门**;若日后正式纳入 spec 树再补计数。
