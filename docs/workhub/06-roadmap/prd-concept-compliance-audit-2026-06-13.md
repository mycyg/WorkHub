---
module: PRD-concept-compliance-audit
layer: 全局 / C-WEB / C-PET / P-AI / QA
status: active
owner: workflow
date: 2026-06-13
depends_on:
  - ../05-clients/page-concepts.md
  - ../05-clients/web-app.md
  - ../05-clients/cuu-desktop-pet-concept.md
  - r4-mid-review-upgrade-audit-2026-06-11.md
---

# PRD / 概念图符合度审查（2026-06-13，真环境实测）

> **触发**：用户用 codex 更新代码后，直觉"前端与概念图差很远"。本篇用**真实环境**（本地 Docker Postgres + 真实 DeepSeek key + 真实浏览器截图）逐模块比对实现 vs PRD/概念图，给出符合度、改进点、不足。
> **审查方法（非纸面）**：① 本地 PG 迁移 + deterministic seed 灌真实数据；② API daemon 接真 DeepSeek（`deepseek-v4-flash`）；③ headless Chrome 带真实会话 cookie 截 13 条产品路由；④ 逐张比对 `05-clients/assets/web|cuu` 概念图本体；⑤ 真 key 跑 6 个真实 AgentRun 端到端闭环。
> **截图证据**：`05-clients/assets/audit/2026-06-13-prd-concept-compliance/`（01-home … 13-settings）；真 LLM 证据：`.../2026-06-13-r5-10-real-key-evaluation/`。

---

## 0. 一句话结论

**后端与 AI 劳动力是真东西，前端呈现层与概念图差着一整个"视觉/信息架构实现层"。** 闭环功能真实可用（真 key 6 个 run、质量 4-5 分、富格式 PPTX/PNG 真生成、预算护栏/升级/llm_review 真实工作），但 Web 当前是**功能线框**（朴素卡片），概念图是**成品 SaaS 视觉**（密集仪表盘 + AI 助手面板 + diff 工作台）。用户的直觉成立。**根因：从来没有一道"视觉符合概念图"的验收门**——CI 只验 data 属性/四态/无溢出，所以实现可以一路偏离概念图而所有门全绿。

---

## 1. 维度 A：AI 引擎 / 真 LLM 闭环 —— ✅ 强（真实验证通过）

真 DeepSeek key 跑 6 个真实 AgentRun（证据 `r5-10-real-key-evaluation-report.json`）：

| 任务 | 结果 | 质量分 | 成本 | 关键证据 |
|---|---|---:|---:|---|
| T1 周报 | succeeded | 4 | ¥0.016 | 结构/风险/审批语言完整，可直接进人工审批 |
| T2 CSV 聚合 | succeeded | 5 | ¥0.023 | 聚合数字与预置答案一致 + 结论说明 |
| T3 PPTX+图表 | succeeded | 4 | ¥0.043 | **PPTX 与 PNG 真实生成**（富格式能力验证） |
| T4 脚本清洗 | succeeded | 4 | ¥0.029 | 脚本/结果/rejects/自验齐全 |
| T5 信息不足 | succeeded | n/a | ¥0.025 | **输出 blocker/handoff，未硬编结论**（升级语义正确） |
| B1 低预算 | escalated | n/a | ¥0.002 | **预算护栏触发结构化升级** |

总成本 ¥0.138 / 6 任务，全部带 `llm_review` usage source。**核心反转的"AI 干"这一端，是真的能干、质量过关、护栏有效。** 这一维度无需返工，是项目最硬的资产。

---

## 2. 维度 B：Web 前端 vs 概念图 —— ⚠️ 功能完整，视觉差距巨大

每个路由都真实渲染、带真实数据、双语、四态、无溢出——**功能层 codex 接通了**。但视觉/信息架构与概念图差距是**全局性**的，不是个别页面：

| 页面 | 概念图 | 实现现状 | 差距 |
|---|---|---|---|
| AI-first Home | 指挥中心：多彩决策卡区 + AI 工作区 + 风险区 + **右侧 AI 助手面板**（今日摘要/自治率度量条/evidence 列表）+ 顶部搜索/看板入口 | 稀疏白卡（需决定:暂无 / AI正在做:1 / 当前入口）+ 右侧三个抽象小卡（数据源/下一步/Web管理端）| 信息密度、视觉层次、**AI 助手面板实质内容**、品牌配色全缺 |
| Approval Center | 三栏 diff 工作台：审批列表 + 详细对比表格 + 操作 + **评论流** | 单列卡片 + 同意/打回/合并按钮 + SLA | **diff/对比可视化**、评论流缺失 |
| Proposal | 变更 diff 审阅（逐文件改动对比）| 稀疏卡片列表（AI摘要/文件改动名/证据/检查项）| **diff 可视化**缺失 |
| Intake 向导 | 卡片式 5 步向导 + Cuu 形象推荐 + 右侧 confidence | （未单独截，route component 存在）| 视觉精装待比对 |
| Cost/Health/其余 | 数据可视化（图表/度量）| 计数 + 文字档位 | 图表/可视化缺失（符合 v0 "不做图表库"边界，但与概念图有距离）|

**截图对照**：`01-home.png` vs `assets/web/web-ai-first-home.png`；`02-approvals.png` vs `assets/web/web-approval-center.png`；`04-proposal.png` vs `assets/web/web-deliverable-change-request.png`。

---

## 3. 维度 C：去黑话宪法违规 —— 🔴 P0（亲眼实测）

实测发现两处**直接违反产品宪法"去黑话"**（`00-overview/glossary-dejargon.md` / `vision-and-principles` 宪法 4），小白用户会直接看到技术黑话：

1. **左导航把路由路径当副标题暴露**：导航项"审批"下面灰字显示 `/approvals`、"网盘"显示 `/drive`、"项目健康"显示 `/dashboard/health` …… URL path 直接糊到用户脸上。
2. **顶栏暴露内部技术标签**：`Web R4` + `/api/pages/attention`（当前路由的 API 端点）常驻顶栏。

这两处不是视觉偏好问题，是**宪法级缺陷**——目标用户恰是"不会用 git、看不懂技术黑话"的中小团队。pilot 前应优先修。

---

## 4. 维度 D：桌宠 Cuu vs 概念图 —— ⚠️ 名实不符

- **代码契约正确**：`packages/cuu/src/model-pack.ts` 定义 `cuu-hijiki-live2d-cubism2`（黑猫，默认）+ `cuu-tororo-live2d-cubism2`（白猫），9 个动作状态枚举（idle/thinking/approval/search/deliverable/sync/worried/done/offline）契约齐全。
- **实际模型资产不符**：`reference/` 里的实际模型包名为 `hijiki-cuu-orange-prototype` / `tororo-cuu-light-orange-prototype`——**渲染出的是橙色虎斑猫**，而概念图 `cuu-character-animation-states.png` 明确要求**黑猫 Hijiki + 白猫 Tororo**。capture（`2026-06-07-cuu-live2d-prototype`）证实是橙猫。
- **形变深度存疑**：prototype 三帧（0/1600/3200ms）形变微弱，概念图验收要求"真实 Live2D 形变随时间，不只是缩放"。
- 真模型资产不在仓库（运行时从 reference 借鉴源加载，reference 不入库 ✓）。

**结论**：桌宠是"代码骨架对、视觉资产是橙猫占位"，与概念图黑/白猫不符。需补黑/白猫真资产，或显式更新概念图口径承认橙猫为当前临时态。

---

## 5. 不足（根因）

**缺一道"视觉符合概念图"的验收门。** 现有 browser smoke 验的是 `data-*` 标记、四态、双语、无横向/文本溢出——全是**功能正确性**，没有一条验"长得像不像概念图"。所以：
- codex（及此前 R4 系列）能做出功能全对、所有门全绿、但视觉是线框的前端；
- 实现可以持续偏离概念图而无人报警。

这解释了用户的全部困惑：**门都绿，但东西不像设计稿**。视觉符合度本质需要人眼/截图对照（难自动化），但至少可以建立"概念图对照清单 + 每页人工 sign-off"的轻流程。

---

## 6. 改进点清单（分级）

| 级别 | 改进点 | 理由 |
|---|---|---|
| **P0** | 去黑话：隐藏左导航路由路径 + 顶栏技术标签（`Web R4`/API path）| 宪法级违规，pilot 用户直面黑话，改动小见效大 |
| **P1** | Web 视觉精装专项（S2 候选）：按概念图重做 Home 指挥中心 + 右侧 AI 助手面板 + Approval/Proposal diff 工作台 | 用户最痛点；工作量大，单列为专项纵切 |
| **P1** | 桌宠资产对齐：补黑/白猫 Live2D 真资产，或更新概念图承认橙猫临时态 | 名实不符，二选一收口 |
| **P1** | 建立"概念图对照验收清单"：每产品页一行 expected-vs-actual + 人工 sign-off | 堵住"门绿但不像设计"的根因 |
| **P2** | 工程债：r5-10-real 与 review API 共享 PG，teardown 删表互相干扰——评估脚本应使用独立 schema/db | 本次实测踩到（截图后 DB 被清）|

---

## 7. 给后续的建议

1. **P0 去黑话** 半天可修，建议立即做（不依赖 pilot）。
2. **P1 视觉精装** 是 S2 的核心命题，本审查已把概念图与现状的差距逐页列清，可直接转成施工 backlog。建议先做 Home + Approval + Proposal 三个高频页（用户接触最多）。
3. AI 引擎维度无需动——把工期押在前端呈现层追平概念图，正是项目当前的最高杠杆。

*本篇为真环境实测审查，截图与真 LLM 证据已归档。后续视觉精装专项另立 plan。*
