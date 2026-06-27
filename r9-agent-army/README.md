# R9 · Agent Army(每个人背后一支巨型 agent 军团)

> WorkHub 下一程的后续规划包。把单 agent 接任务,升级成「一个意图 → 一支会自己拆解、派发、自证、复盘的 agent 军团」。
> 状态:规划中 · 起草 2026-06-23 · 上游 R8(进行中)· 灵感来源:Matrix agentic-runtime 概念稿

---

## TL;DR

- **定位**:不是「0 人公司」,是 **「每个人 +1 支军团」**——人在中心当指挥官/审批者,高风险动作(法务/财务/身份)永远升级给人。
- **可行性**:**可行。最难的后端已造好一大半。** LLM-judge、预算硬上限、技能库 K1–K5、记忆三类雏形——都在。
- **真正要新建三件**:① meta-planner + 子 agent 层级派发(greenfield)② 记忆「隔离 + 冲突归并」(现在只覆盖不归并)③ OKR System + 修 escalated 死状态(逃生舱)。
- **成败手**:拆解准不准 · 记忆烂不烂 · 证明防不防自证 · 人类阀门和预算闸拦不拦得住失控。

---

## 怎么读

| 文档 | 给谁 | 一句话 |
|---|---|---|
| [00-vision-and-positioning.md](00-vision-and-positioning.md) | 所有人 | 「军团」定位、6 条设计哲学、为什么不做「0 人公司」 |
| [01-architecture.md](01-architecture.md) | 工程 | 8 概念逐一映射真实代码(复用/扩展/新建)+ 数据模型 + 控制流 |
| [02-memory-architecture.md](02-memory-architecture.md) | 工程 | 三层记忆 + 冲突归并(复用 P-COLLAB diff3)——最难一块 |
| [03-roadmap-phases.md](03-roadmap-phases.md) | 工程/PM | R9.0…R9.7 分阶段建造,带踩雷点与验收门 |
| [04-feasibility-and-risks.md](04-feasibility-and-risks.md) | 决策 | 真能成/难但能做/是虚构,红线与护栏 |
| [assets/visualization.html](assets/visualization.html) | 演示 | Matrix 玻璃风格一页图:架构 + 现状覆盖 + 路线图 |

---

## 一图速览(已建 vs 待建)

**已建可复用(别重造)**:AgentRun 引擎 + claim-lease · LLM-judge(reviewDeliverable + 置信度矩阵)· R2 预算 reservation 硬拦 · team_skills + 夜间 curation + K1–K5 · user_memories 三类 + 注入 · 提议→审批→合并 + merge-fusion · P-COLLAB diff3 · 自治率北极星 · 成本 labor-split。

**待建(R9 价值所在)**:meta-planner 拆解 · 子 agent 派发(parent_run_id)· 记忆隔离 + 冲突归并 · 跨 agent 仲裁 + 多票 · OKR(非阻断)· escalated 死状态修复 + 升级队列 · 按角色分工具子集 · 任务级预算 scope · Matrix 玻璃指挥台。

---

## 与 WorkHub 既有护栏的关系

R9 继承、不违背:**① 不直写生产**(子 agent 也走提议→审批→合并)**② OKR 非阻断**(只做观测镜头)**③ 自治率绝不拿信任换 ④ 去黑话 ⑤ 跨工作区隔离**。

---

*依据:2026-06-23 对 9 个子系统(agent-engine / skill-library / memory-library / decomposition-planner / okr-objectives / judge-verification / attention-escape-hatch / budget-cost / frontend-ux)的代码盘点,带 file:line 证据。*
