---
module: R5-real-llm-validation
layer: P-AI / P-COST / QA / 验证报告
status: completed
owner: workflow
date: 2026-06-13
depends_on:
  - s1-pilot-readiness-roadmap-2026-06-12.md
  - r5-10-pre-agent-capability-hardening-plan-2026-06-12.md
  - r5-11-1-sandbox-libraries-and-skills-plan-2026-06-12.md
  - ../02-ai-engine/cost-governance.md
  - ../02-ai-engine/confidence-risk-escalation.md
---

# R5.10 真实 LLM 端到端验证 Plan（S1 第二刀 · "证明劳动力"）

> `R5.10-dry` 与真 key 评估均已在 2026-06-13 本机 PostgreSQL 16 上通过。真 key 评估详见 [`r5-10-real-key-evaluation-run-plan-2026-06-13.md`](./r5-10-real-key-evaluation-run-plan-2026-06-13.md) 与审计证据目录 `2026-06-13-r5-10-real-key-evaluation`。

## 1. 目标与边界

R5.10 用真实模型把核心闭环跑出**数据**，回答中期审查最尖锐的一问："AI 劳动力到底行不行"。R5.10-pre 已把引擎补强到能扛截断/重试/自评，R5.11.1 已解锁富格式交付——现在要的是真实证据，不是再加功能。

| 必须产出 | 不做 |
|---|---|
| 一份**质量-成本-时延评估报告**（§5 模板），覆盖 ≥5 个真实任务 | 不扩工具面、不调模型路由策略（只记录与校准默认值） |
| 预算护栏真实触发证据（超 token/cost → escalate，非静默截断） | 不做多模型对比评测（单 provider 即可，pilot 用什么测什么） |
| 成本真实入 ledger（`source` 区分 agent_step/review/retry/compact） | 不做自动化回归评测集（nightly eval 是 P2+ 专题） |
| llm_review 五档对真实交付物的判分分布 → 校准 OQ-2 置信度 | 不改 confidence 权重（先收数据，调参另开 policy_version） |
| 校准建议：OQ-7 预算默认值、OQ-2/3 阈值是否现实 | — |

## 2. 任务集（覆盖真实业务交付面）

每个任务 = 一个真实 WorkItem，走完整闭环。**file-only 基础集（FR-WORKER-008 白名单）+ 富格式集（R5.11.1 解锁）**：

| # | 任务 | 交付物类型 | 验证什么 |
|---|---|---|---|
| T1 | 把一段会议要点整理成结构化周报 | markdown 文档 | 基础文档质量、去黑话呈现 |
| T2 | 给一份 CSV 销售数据做描述统计 + 分组聚合，出结论 | CSV + 结论 md（data-analysis 技能） | pandas 真实可用、数字正确性 |
| T3 | 生成一份项目周度统计图表 PPT | pptx + 图表 PNG（pptx + stat-charts 技能） | 富格式 + 中文字体 + 技能合同防 API 幻觉 |
| T4 | 写一个数据清洗脚本并自验跑通 | python 脚本（code-script 技能，run_command 自验） | 沙箱执行 + 自验闭环 |
| T5 | 一个**故意信息不足**的任务（缺关键输入） | 应升级而非硬编 | blockers 自报、不臆造、升级精准度 |

T5 是关键对照——验证"AI 知道自己不知道"，直接喂 OQ-2/3 校准。

## 3. R5.10-dry：key 无关的全链彩排（第 0 步，可立即执行）

**目的**：把"管线通不通"与"AI 好不好"解耦。用 fake/deterministic provider（返回固定的 write_file + end_turn）跑一个真实 WorkItem 走完 **提需求 → AgentRun → proposal → 审批 → 合并 → accepted ledger → replay → 下载**，落一个真实合并的交付物文件。

- ✅ **已完成（2026-06-13）**：新增 `apps/api/src/qa/r5-10-dry-agent-pipeline.ts` 与 root `pnpm qa:r5-10-dry`。
- ✅ 复用正式 provider registry + fake transport，而不是裸 fake client；因此 measured client 照常写入 `usage_records` 与 `cost_ledger_entries`。
- ✅ 贯通 **提需求 → evidence bind → AgentRun → proposal → 审批 → 合并 → accepted ledger → replay → preview/download**。
- ✅ 证据：[`../05-clients/assets/audit/2026-06-13-r5-10-dry-agent-pipeline/r5-10-dry-agent-pipeline-report.json`](../05-clients/assets/audit/2026-06-13-r5-10-dry-agent-pipeline/r5-10-dry-agent-pipeline-report.json)，17 段 REST evidence、3 条 usage_records、9 条 ledger entries、`agent_step` + `review` source、llm_review grade=4 进入 confidence、下载 SHA 与 drive version SHA 一致。
- ✅ 本步成为 pilot 主持人的"系统自检"脚本；真 key 到位时若失败，先修管线，不消耗模型预算。

## 4. 执行步骤（key 到位后）

1. 跑 `pnpm qa:r5-10-dry`，确认管线绿（2026-06-13 已有基线，真 key 前仍需复跑）。
2. `.env` 填 `LLM_API_KEY`，起 pilot 栈或本地 daemon。
3. 逐个提交 T1–T5 为真实 WorkItem，观察 AgentRun 执行。
4. 每个 run 采集：交付物质量（人工评 1-5 + llm_review 自评 1-5）、token_in/out、成本 CNY、墙钟时延、步数、是否触发压缩/重试/升级、置信度档位与 verdict。
5. 故意压低某任务的 `RunBudget`（token/cost），验证护栏真触发 escalate + 结构化 handoff。
6. 汇总成 §5 报告，给出三条校准建议。

## 5. 评估报告模板（产出物 `docs/.../r5-10-real-llm-validation-report-<date>.md`）

```
## 环境
provider / model / 端点 / 日期 / RunBudget 默认值

## 逐任务结果表
| 任务 | 交付物 | 人工质量(1-5) | llm_review(1-5) | 置信档 | verdict | token | 成本CNY | 时延s | 压缩 | 重试 | 升级 |

## 聚合
- AI 直出采纳率（人工≥4 且未打回 占比）
- 每件平均成本 / 时延
- 护栏触发证据（哪个任务、什么阈值、handoff 内容）
- llm_review vs 人工质量的相关性（自评是否可信）

## 校准建议
1. OQ-7 预算默认值：单 run 120k token / 5 CNY 是否现实？
2. OQ-2 置信度：review=0.50 权重下，low/medium/high 阈值是否合理？
3. OQ-3 风险：T5 类升级是否精准？
```

## 6. Handoff

报告已产出并回写 S1 roadmap / Pilot runbook / OQ。R5.10 结论：

- `pnpm qa:r5-10-dry` 仍通过。
- `pnpm qa:r5-10-real` 使用真实 DeepSeek provider 跑完 T1–T5 + B1。
- T1–T4 人工质量 `4/4 >= 4`；T5 正确升级；B1 预算护栏升级。
- 本轮真实成本 `0.142346 CNY / 30103 tokens / 6 runs`，成为 OQ-7 初始样本。
- llm_review 与人工评分都已进入 JSON 证据，可供 OQ-2 后续相关性校准。

R5.10 完成 + S1 Pilot Week 完成 = S1 闭环，由 pilot 报告决定 S2（最可能是 OQ-4 护城河，视真实冲突数据）。下一步执行清单见 [`s1-pilot-launch-gate-plan-2026-06-13.md`](./s1-pilot-launch-gate-plan-2026-06-13.md)。
