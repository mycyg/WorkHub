---
module: R5-agent-capability-hardening
layer: P-AI / packages-agent / packages-tools / API
status: completed
owner: workflow
date: 2026-06-12
depends_on:
  - s1-pilot-readiness-roadmap-2026-06-12.md
  - ../02-ai-engine/agent-loop-and-tools.md
  - ../02-ai-engine/confidence-risk-escalation.md
  - ../07-open-questions.md
---

# R5.10-pre Agent 能力强化 Plan（真 key 验证前的引擎补强）

## 1. 背景

中期审查指出"agent 引擎 4400 行 vs 桌宠 5.4 万行，形象比劳动力先成熟"。R5.10 要用真 key 验证劳动力，但 2026-06-12 对照 [`agent-loop-and-tools.md`](../02-ai-engine/agent-loop-and-tools.md) 的逐文件对账发现，引擎有五处会在真实任务下立刻暴露的结构性短板。先补强，再验证——否则 R5.10 测的是一台残血引擎。

对账结论（真实差距，带证据）：

| # | 差距 | 证据 | 后果 |
|---|---|---|---|
| D1 | **上下文压缩是两个半截死路**（AL-4）：`checkLoopBudget` 会发 `compact` 信号但 loop 从不处理；`max_tokens` 截断路径直接终止升级 | `packages/agent/src/loop/control.ts:45-49`（信号无人消费）、`loop.ts:412-435`（截断即 escalate `compact_required`） | 长任务一旦逼近窗口或单步截断，run 直接报废 |
| D2 | **system prompt 只有一句话**："You are WorkHub's AI worker. Produce concise, reviewable deliverables." | `apps/api/src/workers/agent-runner.ts:663` | 无交付物纪律（outputs/）、无完成语义、无 FR-WORKER-008 边界、无 blockers 自报格式 |
| D3 | **tool_result 全文回灌 messages**：无截断 | `loop.ts:399-409` | 一次大文件 read 即可吃掉整个窗口 |
| D4 | **provider 瞬态错误零重试**：`retry.ts` 的 `nextRetryDecision` 已实现但无人接线 | `packages/agent/src/providers/retry.ts`（孤立）、`loop.ts callModel` | 真实 API 的 429/5xx/网络抖动直接 fail 整个 run |
| D5 | **llm_review（OQ-2 来源②，权重 0.50 的主信号）不存在**：置信度只有启发式 | `packages/agent/src/evaluation/confidence.ts`（无 review 输入）、对照 `confidence-risk-escalation.md §3` | 升级精准度的最重要信号缺席，R5.10 没法校准 |

工具面（10 个工具含 run_command 白名单沙箱）经核查是齐的，不在本次范围。

## 2. 目标

| # | 必须完成 | 边界 |
|---|---|---|
| H1 | **真·上下文压缩**：消费 `compact` 信号与 `max_tokens` 截断——确定性折叠（保留 system + 初始任务 + 最近 K 步完整交换，更早步骤折叠为结构化摘要），继续执行；每 run 压缩上限 2 次，超限才升级；emit `agentRunCompacting` | v1 用确定性结构摘要（可测、零额外成本）；模型摘要留待真实数据评估 |
| H2 | **tool_result 截断**：写入 messages 的内容 head+tail 截断（默认 8k 字符，注明省略），trace/事件仍记完整预览 | 不改 trace 语义 |
| H3 | **工人合同级 system prompt + 初始消息**：交付物纪律（outputs/）、完成语义（不再请求动作=完成）、file-only 白名单边界（FR-WORKER-008）、blockers 自报格式、工具要点 | 默认值在 runner，调用方仍可覆盖 |
| H4 | **provider 瞬态重试**：`callModel` 接 `nextRetryDecision`（429/5xx/retry-after，指数退避，≤3 次），重试事件入 trace | 4xx 业务错误不重试 |
| H5 | **单步 token 上限可配**：默认 4096→8192，`LLM_MAX_TOKENS_PER_STEP` env 可覆盖 | — |
| H6 | **llm_review 五档**：run 成功后用同 provider 追加一次评审调用（任务 + 交付物清单 + 最终陈述 → 严格 JSON `{grade:1-5, rationale}`），写入 `AgentLoopResult.review` 并接进置信度评估（R0 权重 review=0.50）；调用失败/不可用→降级现有启发式，绝不阻塞；成本计入 run usage | 不做多轮评审、不做独立评审模型路由 |

不做：approval-blocking ask 工具（RA-5，独立专题）、模型摘要压缩、工具面扩列、smart-staffing/pm-mode。

## 3. QA Gate

- `packages/agent` 单测新增：压缩触发与继续执行、压缩上限、tool_result 截断、429→退避重试→成功、review JSON 解析与降级、review 计入 usage；
- `packages/agent/evaluation` 单测：有 review 时按 R0 权重融合、无 review 时回退启发式；
- 既有 cuu-r3 launcher/run-stream smokes（`pnpm lint` 链内，走 fake provider）全回归；
- `pnpm typecheck`、`pnpm test`、browser smoke 70 步回归、release gate、`git diff --check`。

## 4. 竣工记录

状态：✅ completed（2026-06-12）

落地范围（对应 §2 H1–H6 全部完成）：

- **H1 真·上下文压缩**：`packages/agent/src/loop/loop.ts` 新增 `compactConversation()`/`summarizeStepsForCompaction()`；`context_window` 信号与 `max_tokens` 截断两条路径都改为确定性折叠（保留初始任务 + 摘要 + assistant 边界对齐的尾部，tool_use/tool_result 配对完整）后继续执行；默认上限 2 次（`budget.maxCompactions`），超限才升级 `compact_budget_exhausted`/`compact_required`；压缩计入 `usage.compactions` 并 emit `agentRunCompacting`（带 trigger）。
- **H2 tool_result 截断**：写回对话的内容按 `budget.toolResultContextChars`（默认 8000 字符）head+tail 截断并标注"完整内容见 trace"；trace/事件保持完整预览语义。
- **H3 工人合同 prompt**：runner 默认 system prompt 升级为六条工作纪律（outputs/ 交付物纪律、file-only 边界、完成判定、blockers 自报、截断应对、语言跟随）；初始消息升级为三步工作法模板。
- **H4 provider 瞬态重试**：`callModelWithRetry()` 接线 `nextRetryDecision`（retry-after 优先、429/5xx 指数退避、默认 ≤3 次），重试以 `provider_retry` step 事件入 trace；4xx 业务错误不重试。
- **H5 单步 token 上限**：`LLM_MAX_TOKENS_PER_STEP`（默认 8192）进 config，runner 透传 `maxTokensPerStep`。
- **H6 llm_review 五档**：run 成功后用同 client 追加一次 `source:"review"` 评审调用（任务 + 变更清单 + 最终陈述 → 严格 JSON 五档），写入 `AgentLoopResult.review` 并 emit `llm_review` step 事件；评审 token/成本计入 run usage；解析失败或调用异常静默降级。`evaluateAgentRunConfidence` 按 R0 权重融合（review=0.50 / acceptance=0.35，self 缺席归一化）：grade 5 + manifest → 1.0，grade 1 → ≈0.41（low，必升级人审）；无 review 回退原启发式；`signalsJson.sources.review` 如实记录 grade/model/rationale 或回退原因。

验收证据：

- `pnpm --filter @workhub/agent test`：**29 pass / 0 fail**（新增：max_tokens 压缩后继续成功、压缩预算耗尽升级、大 tool_result 截断、429 退避重试成功、400 不重试、llm_review 端到端入 result 与 usage、置信度 R0 融合三态）
- `pnpm typecheck` 全绿、`pnpm test` 全包 0 fail、`pnpm lint` 全链 OK（含 6 个 cuu-r3 真实 launcher/run-stream smokes 回归——新 prompt 与 review 路径在真实 API 进程中跑通）、browser smoke 70 步回归通过
- 测试中顺带验证了工具层 fail-closed 设计（side-effect 工具无 snapshot hook 即拒绝），未发现需修复项

## 5. Handoff

H1–H6 已全部落地，**R5.10 真 key 端到端验证**随时可开：需要 `LLM_API_KEY`（DeepSeek 默认端点或任何 Anthropic 协议兼容端点）。此时测得的质量-成本-时延数据反映补强后的引擎，且 llm_review 让升级精准度（OQ-2 校准）第一次有真实主信号——评审调用的成本也会如实进入 ledger（`source:"review"` 口径早已在 cost-governance 预留）。
