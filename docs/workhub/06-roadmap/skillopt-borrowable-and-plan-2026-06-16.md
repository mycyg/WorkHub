---
status: active
created: 2026-06-16
owner: WorkHub
title: SkillOpt 借鉴评估 + 技能自进化迭代计划
---

# SkillOpt → WorkHub：借鉴评估与迭代计划

> *“给我一个支点，我可以撬动地球。”——阿基米德。* 对一个会复利的 AI 劳动力来说，支点不是更大的模型，而是**让技能文档像被训练的权重一样，沿着真实反馈一点点变好**。这正是 SkillOpt 想做的事，也是 WorkHub R6「复利劳动力」缺的最后一块拼图。

## 0. 这份文档是什么

研究 Microsoft 开源的 [SkillOpt](https://github.com/microsoft/SkillOpt)（MIT，[paper](https://arxiv.org/abs/2605.23904)），评估有哪些机制值得搬进 WorkHub 的「团队技能自迭代」，并落成一份可施工的迭代计划。

SkillOpt 源码已 clone 到 `reference/SkillOpt/`（`/reference/` 已 gitignore，**不进版本库**）。本文是研究结论；不照搬代码，在 TS 栈里按 WorkHub 的真实信号重建。

## 1. SkillOpt 是什么（一句话）

**把 `SKILL.md` 当作一个冻结模型的「可训练权重」，用深度学习优化器的纪律去训练它**——不动模型权重，只改技能文档：

- **DL 类比**（`reference/SkillOpt/docs/guide/dl-analogy.md`）：技能文档=权重，rollout=前向，reflect=反向传播，编辑补丁=梯度，held-out 选择集=验证集。
- **训练循环**（`skillopt/engine/trainer.py` `ReflACTTrainer.train()`）：每个 epoch 把固定训练池洗成 batch，每步跑六相——
  1. **Rollout**：目标模型用当前技能跑一批任务，hard/soft 打分；
  2. **Reflect**：优化器 LLM 把失败轨迹变成编辑补丁（喂入 step_buffer 历史失败 + 被拒编辑 + meta-skill 记忆）；
  3. **Aggregate**：层次化去重补丁；
  4. **Select/Clip**：只留 top-K 编辑，K = edit_budget = 「学习率」（constant/linear/cosine/autonomous 调度）——即梯度裁剪；
  5. **Update**：应用补丁产生候选技能；
  6. **Gate**：在 held-out 验证集上重跑候选，**只有严格优于现役才接受**，单独追踪 best-so-far。
- **稳定性机制**：rejected-edit buffer（被拒编辑回灌，避免重复提）、slow update（epoch 级动量）、meta-skill（跨 epoch 优化器策略记忆）、按技能哈希缓存分数。
- **SkillOpt-Sleep**（`skillopt_sleep/`）：**夜间离线自进化**——收割真实 agent 会话 → 挖掘任务（带稳定哈希的 held-out 划分）→ 重放+固化 → 同一个 gate → 暂存提案给人审（可选自动采纳），全程在 token/分钟 Budget 下。

部署产物是一份 300–2000 token 的 `best_skill.md`，对**不变的目标模型**零推理期开销，跨模型/跨 harness（Codex CLI、Claude Code CLI）可迁移。

## 2. 一个事实，重构了所有结论 ⚠️

SkillOpt 的 gate 之所以成立，是因为它的分数是 **benchmark ground-truth、近似确定性**——1 分的差就是信号。

**WorkHub 没有 ground-truth。** 我们的「分数」是 `packages/agent/src/evaluation/confidence.ts` 里的 5 档 llm_review 置信度：
- 50% 是**单次 LLM 调用**（`packages/agent/src/loop/loop.ts:362` `reviewDeliverable`）给任务↔交付物打 1–5 分，**无 ground-truth、无 rubric 锚定、有 run-to-run 方差**；
- 35% 是二元采纳（succeeded + manifest 存在）；其余是对自身轨迹的启发式。

且 `GET /agent-runs/:id/replay`（`apps/api/src/routes/agent-runs.ts:216`）**只重建已存轨迹，不重新执行**——技能只能通过「改变 agent 实际做什么」来改变结果，所以给候选技能打分需要一次**全新的、有副作用的 rollout**，再用一个吵的 1–5 judge 评分。

**结论：任何「只有候选分严格高于现役才晋升」的机制，在 WorkHub 的信号质量下，是「裹着严谨外衣的抛硬币」**，还要为每次抛硬币付真实 rollout 成本。所以下面按「依赖什么信号」分类，而不是按 SkillOpt 的原始优先级。

## 3. 真正该借鉴的（noise-tolerant，用 WorkHub 真实代理信号）

这些只用真实的 accept/reject、escalation/rework、cost、审计历史，**不假装 1–5 分是 ground-truth**。

| # | 借鉴机制 | 落点 | 为什么适配 | 工作量 |
|---|---|---|---|---|
| **K1** | **Rejected-edit / 弃用记忆 buffer 回灌 curation prompt** | `agent-skill-curation.ts:96`（已写 `team_skill.distilled_but_discarded`，**只写不读**）→ `skill-curation.ts:68` `buildCurationPrompt` 读最近 N 条弃用审计渲染成「勿再提」块 | 当前 prompt 跨夜无记忆，同一个低置信技能可被每晚重复提议再丢弃，白烧 curator 调用。纯靠已有 reject 信号，零打分基建。 | **S（先做）** |
| **K2** | **整文档重写 → 受限编辑补丁（对当前激活版本做 Add/Modify/Delete，封顶 L 段）+ 打字化段落 schema**（General/Patterns/Edge Cases/Output Format） | `skill-curation.ts` 把激活键的 `content_md` 喂回，要小补丁；`team-skill.ts:73` `promote()` 已按键版本化 | 让 R6「复利劳动力」名副其实（精修而非churn），给可审 diff，保留「改了什么」的 provenance。**不需要分数**，本身就是质量/可审性赢。 | **M** |
| **K3** | **递减的 edit-budget / 学习率节流**（`TEAM_SKILL_MAX_PER_CURATION` 从平constant→按 version/confidence 退火的每-tick 预算） | `@workhub/contracts` 配置化 + `agent-skill-curation.ts` promote 前 rank+clip | 这是**数值 gate 的正确替代**：不去「测量」改进（信号太吵），而是**限制每次改动的爆炸半径**，配合 rollback 兜底。跳过「LLM 输出整数+risk_notes」的花活，静态 cosine/linear 调度足够。 | **S** |
| **K4** | **append-only、去重的升级 appendix（失败提醒）** | `team-skill.ts:217` `escalationSignals` 已有；同一升级在某技能任务族复发时，往**受保护 appendix** 追加去重提醒，而非重写正文 | **加性、低风险、可逆、由硬信号（升级真的发生了）驱动**——这里最站得住的「从失败学习」机制。比一半「high」想法信号更强。 | **M（很安全）** |
| **K5** | **阶段标记的成本核算（生产 vs 自我改进花费）** | `packages/cost/src/types.ts:73` `UsageSource` 已有 `agent_step/review/compact/retry/eval`，加 `"curation"`，在 AI 战绩里显「干活 vs 自进化」分账 | 已 80% 建好，诚实、便宜、直接服务 R6 叙事，**不需标签**。 | **S** |
| **K6** | **结果分桶的 minibatch 反思**（把近期 run 分「低分/升级」桶 vs「采纳/高分」桶，每桶一次 LLM 调用只抽**跨 run** 的共性模式） | `skill-curation.ts` `analyze()`/curation tick | 把 grade 当**3 档粗桶（低/中/高）而非精确标量**——这是用吵信号的正确姿势。最强的「gradient」想法，分桶容忍噪声而严格阈值不能。 | **M** |

**施工顺序建议**：K1（S，立刻）→ K3（S）→ K5（S）→ K2+段落schema（M）→ K4（M）→ K6（M）。前三个 S 当周可落，把「读回弃用日志 + 节流 + 分账」这条最便宜的复利闭环先合上。

## 4. 陷阱：别搬这些 🚫

| 陷阱 | 为什么是陷阱 |
|---|---|
| **T1：accept-only-if-improves held-out gate（原样）** | SkillOpt 的核心 cargo-cult。WorkHub 的分是吵的 1–5，**没有便宜的 re-scorer**（replay 是重建不是重跑）。原样落地=每晚每技能付 N 次全 rollout，比较两个吵均值却**无 n、无方差预算、无显著性边界**，held-out 集还小且非平稳。**在抛硬币上 gate 技能进化，还付 rollout 钱。不要搬数值 gate。** |
| **T2：稳定哈希 held-out 划分 + 技能哈希分数缓存** | T1 的副产物；缓存一个吵的数=冻结的硬币。随 T1 一起跳过。 |
| **T3：gate rollout 的 `plan_depth` 成本控制器** | 为让 T1 负担得起而存在；T1 不做就无物可控。预算担忧由 K3 + 现有 per-run 计量满足。 |
| **T4：带 before/after **分数** 的暂存评审件** | diff UI 可以（契合 W2），但「展示 baseline_score→candidate_score」**把吵分数洗成看似权威的数字**。要建就只建 diff + 展示 rejected-edit 原因，**省掉分数对比**。 |
| **T5：受保护的纵向 slow-update 区（周对比 job 写）** | 两时间尺度想法优雅，但周 job 的活就是「上次什么回退了」——需要 WorkHub 信不过的同一个跨版本结果测量。内容源是陷阱。K4 的升级 appendix 用硬信号拿到同样的「持久失败记忆」收益。 |
| **T6：基于存储 gate 分数的 best-so-far + 自动回滚** | **回滚机制本身好**（`rollbackTo()` 已有），但「按存储 grade 触发」会抖动（回滚↔再晋升）。**保留回滚接线，由持久生产信号驱动**（窗口内采纳率持续下滑/升级飙升），不是存储 gate 分。 |
| **T7：support_count→confidenceScore 失败优先聚合** | 预设你在跑多个独立反思批（没有），且把「N 批同意」和「技能表现为 X 级」混进同一列。等 K6 真有多批再说。 |

## 5. 「若真要结果 gate」——唯一站得住的版本

不要合成 held-out replay 打分。要的话只做 **生产非回归守卫**：技能晋升后，**观察接下来真实一周**的采纳率/升级率，只有**实质性变差**（宽死区）才阻断 + 自动回滚到 best 版本。即「从生产学习，不从合成回放学习」——它退化成 K1（回滚记忆）+ T6 的回滚半边，已在保留清单里。

## 6. 迭代计划（提案：R8「技能自进化」线）

定位：把 WorkHub 已有的 S2 团队技能自迭代（`agent-skill-curation` 夜间 tick + `team-skill` 版本化 + confidence + rollback），从「一次性整文档蒸馏」升级为「**有记忆、会节流、按硬信号精修、可审计**」的复利闭环。**全程不引入数值 gate**。

- **R8.1 闭合最便宜的复利环（S 批）**：K1 读回弃用日志 + K3 递减 edit-budget + K5 curation 成本分账。产出：curation 不再重复白烧、每夜改动有上限、AI 战绩显「自进化花费」。
- **R8.2 精修而非churn（M）**：K2 受限编辑补丁 + 打字化段落 schema（+ 顺带 #20 token 大小带守卫，技能注入每个未来 prompt，得管体积）。产出：技能演进有可审 diff、保留 provenance。
- **R8.3 从失败学习（M）**：K4 append-only 升级 appendix。产出：复发升级转成技能里的去重「踩坑提醒」，硬信号驱动、可逆。
- **R8.4 吵信号下的 gradient（M）**：K6 结果分桶 minibatch 反思。产出：curation 抽「跨 run 共性」而非单 run 噪声。
- **R8.5（可选，靠后）**：#27 优化器/目标模型分离（curation/review 走 deepseek-pro、rollout 走 flash）；#24 挖掘复发任务族播种 curation；#22 技能演进指标进战绩（**只显编辑采纳率/演进数，不显 validation-vs-baseline 差**）；WebUI 阶段可视化（契合 R7 液态玻璃）。
- **R8.future（仅当出现可信结果信号）**：生产非回归守卫 + 自动回滚（§5）。在此之前**不建数值 gate**。

每阶段照仓库惯例：typecheck + test + CI 绿、对抗式验收、README 文档数同提交回写。

## 7. 一句话总结

SkillOpt 最值钱的不是它的 gate（那依赖 WorkHub 拿不到的 ground-truth），而是它把「技能=可训练状态」这件事**工程化**的纪律：编辑补丁、被拒记忆、学习率节流、失败回灌、夜间离线自进化。把这些**适配到 WorkHub 的吵信号**（用 reject/escalation/cost 这些硬代理，把 grade 当粗桶不当标量），就能让 R6「复利劳动力」从口号变成每晚都在发生、且可审计的真事。

— 配套：[`r6-compounding-ai-labor-direction`]、`apps/api/src/services/skill-curation.ts`、`apps/api/src/workers/agent-skill-curation.ts`、`packages/db/src/repositories/team-skill.ts`、`packages/agent/src/evaluation/confidence.ts`。
