---
module: R5.10-real-key-evaluation-run
layer: P-AI / P-COST / QA / Pilot readiness
status: completed
owner: workflow
date: 2026-06-13
depends_on:
  - r5-10-real-llm-validation-plan-2026-06-12.md
  - s1-pilot-readiness-roadmap-2026-06-12.md
  - r5-10-pre-agent-capability-hardening-plan-2026-06-12.md
  - r5-11-1-sandbox-libraries-and-skills-plan-2026-06-12.md
  - ../05-clients/page-concepts.md
  - ../05-clients/assets/shared/endpoint-page-cuu-alignment.png
---

# R5.10 真 key 评估 Run Plan（R5.10-dry 之后）

> 开工前已读：S1 roadmap、R5.10 plan、R5.10-pre、R5.11.1、cost/confidence 文档、`page-concepts.md` 与 `endpoint-page-cuu-alignment.png`。本模块无新增视觉概念图；遵循 endpoint -> Page VM -> CuuState 分离，验证后端劳动力与可审交付链路，不改 Web/Cuu 外观。

## 1. 当前硬门

R5.10-dry 已在 2026-06-13 本机 PostgreSQL 16 上通过：

- 命令：`pnpm qa:r5-10-dry`
- 证据：`docs/workhub/05-clients/assets/audit/2026-06-13-r5-10-dry-agent-pipeline/r5-10-dry-agent-pipeline-report.json`
- 覆盖：17 段 REST evidence、AgentRun succeeded、proposal review/merge、accepted deliverable preview/download、replay、3 条 usage_records、9 条 cost_ledger_entries、`agent_step` + `review` source、llm_review grade=4 进入 confidence。

真 key 评估开工前必须保持 dry 脚本绿；若 dry 失败，先修管线，不消耗真模型预算。

## 1.1 竣工记录（2026-06-13）

状态：✅ completed。

新增并通过 `pnpm qa:r5-10-real`：

- 使用真实 DeepSeek Anthropic-compatible provider（`deepseek-v4-flash`），无 fake transport。
- 覆盖 T1–T5 + B1 共 6 个真实 AgentRun：T1 周报、T2 CSV 聚合、T3 PPT+PNG、T4 Python 清洗脚本自验、T5 信息不足 handoff、B1 低预算护栏。
- 质量：T1–T4 人工质量 `4/4 >= 4`；T5 输出 blocker/handoff 且不编造税务结论；B1 `agent_runs.status=escalated` 且 `escalation_events.trigger=budget_exhausted`。
- 成本：本轮 cost page delta `0.142346 CNY`，token delta `30103`；每个成功 run 记录 `agent_step + review` usage，B1 记录 `agent_step` usage；ledger 覆盖 workitem/user/team。
- 证据：[`../05-clients/assets/audit/2026-06-13-r5-10-real-key-evaluation/r5-10-real-llm-validation-report-2026-06-13.md`](../05-clients/assets/audit/2026-06-13-r5-10-real-key-evaluation/r5-10-real-llm-validation-report-2026-06-13.md) 与同目录 JSON 报告。

真 provider 首跑暴露并修复了两个系统性问题：

- 工具注册表此前只暴露 `input_schema: {type:"object"}`，DeepSeek 无法看到 `write_file.path/content` 等必填字段；现已改为由 Zod schema 生成真实 JSON Schema，并补 `@workhub/tools` 回归门。
- provider retry 此前只覆盖 HTTP 429/5xx，`fetch failed` / `terminated` 这类 fetch-level 网络异常不重试；现已纳入 transient retry，并补 AgentLoop 回归门。

## 2. 执行环境

| 项 | 要求 |
|---|---|
| 数据库 | 本机 PostgreSQL 或 pilot compose PostgreSQL；先跑 migrations。 |
| Provider | DeepSeek Anthropic-compatible endpoint，`LLM_MODEL=deepseek-v4-flash` 默认。 |
| Secret | `LLM_API_KEY` 只进本机环境变量或 `.env.pilot`，不得写入仓库、报告、截图或命令输出。 |
| 成本 | 保留真实 `usage_records` / `cost_ledger_entries`；报告只写 token、CNY、source、model，不写 key。 |
| 证据目录 | `docs/workhub/05-clients/assets/audit/<date>-r5-10-real-key-evaluation/` |

## 3. 任务矩阵

| 任务 | 输入 | 期望交付 | 主要判据 |
|---|---|---|---|
| T1 周报 | 一段会议要点 | `md` 周报 | 结构清晰、去黑话、可直接审批 |
| T2 数据分析 | 小 CSV | CSV 聚合 + `md` 结论 | 数字正确、分析可复算 |
| T3 PPT | 项目周度统计 | `pptx` + 图表 PNG | 富格式能生成、中文字体正常 |
| T4 脚本 | 数据清洗需求 | Python 脚本 + 自验记录 | 脚本跑通、错误可解释 |
| T5 信息不足 | 故意缺关键输入 | 升级/阻塞 handoff | 不编造，升级精准 |

每个任务都必须走：intake/session -> WorkItem -> AgentRun -> proposal -> human review -> merge/reject -> replay/cost/confidence 采集。

## 4. 验收 Gate

| Gate | 必须为真 |
|---|---|
| G1 dry preflight | `pnpm qa:r5-10-dry` 通过，报告中 `cost_page_delta` 匹配当前 run usage。 |
| G2 real provider | ≥5 个真实 AgentRun 使用真 provider 完成或结构化升级；无 fake transport。 |
| G3 ledger | 每个 run 至少有 `agent_step` usage；成功 run 还有 `review` usage；成本进入 workitem/user/team ledger。 |
| G4 quality | T1–T4 至少 3 个人工质量 ≥4；T5 必须升级而非硬编。 |
| G5 budget | 至少 1 个任务用低预算触发 `escalated` + handoff，不静默截断。 |
| G6 report | 产出 `r5-10-real-llm-validation-report-<date>.md`，回写 S1 roadmap 六指标初值。 |

## 5. 后续动作

1. 设置真 key 环境后，先跑 `pnpm qa:r5-10-dry`。
2. 起本地 API 或 pilot stack，逐个提交 T1–T5。
3. 每个任务保存 proposal/replay/cost/confidence 证据与人工评分。
4. 汇总质量-成本-时延报告，给出 OQ-2/OQ-3/OQ-7 校准建议。
5. 更新 S1 roadmap、Pilot Week runbook 与 `07-open-questions.md`，再提交 main。

## 6. Handoff

R5.10 已从“key 待输入”转为真实证据闭环。S1 关键路径不再卡模型质量/成本/时延基线；下一步按 [`s1-pilot-launch-gate-plan-2026-06-13.md`](./s1-pilot-launch-gate-plan-2026-06-13.md) 做 Pilot Week 启动前最后核验：用部署栈复跑 dry/real gate 的最小组合、确认 operator 手册与备份恢复、再进入真实使用者 pilot。
