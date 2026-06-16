---
status: done
created: 2026-06-16
owner: WorkHub
title: LLM 调用全链路系统审查 + 真 key 测试
---

# LLM 调用全链路系统审查 + 真 key 测试（2026-06-16）

> 目标：系统审查所有涉及 LLM 调用的地方——数据流是否通畅、提示词质量、返回内容能否正确对接前后端；并用真 DeepSeek key 把所有涉 LLM 模块端到端测通。顺带评估 SkillOpt 集成度。

## 0. 测试接入

- provider：DeepSeek，Anthropic 兼容端点 `https://api.deepseek.com/anthropic`（WorkHub 默认 provider = anthropic-compatible）。
- model：`deepseek-v4-flash`（便宜，测试默认）；`deepseek-v4-pro` 仅在不稳定/质量差时切。
- 连通性 smoke：直连端点 + flash 模型返回正常（注意 flash 会先发 `thinking` 块再发 `text` 块——provider 必须取 text，不取 thinking）。

## 1. LLM 调用点清单（5 个模块）

| # | 模块 | 位置 | LLM 调用 |
|---|---|---|---|
| 1 | Provider 适配器 | `packages/agent/src/providers/anthropic-compatible.ts` | 构造 messages/tools/system → DeepSeek；解析 content 块(text/thinking/tool_use) + usage |
| 2 | Agent 工人循环 | `packages/agent/src/loop/loop.ts` | 工人 system prompt + 工具循环 → 交付物 manifest |
| 3 | 交付物质检（5 档） | `loop.ts:~362 reviewDeliverable` + `packages/agent/src/evaluation/confidence.ts` | 1–5 打分 → 0–1 置信 + low/med/high + verdict |
| 4 | 技能蒸馏（curation） | `apps/api/src/services/skill-curation.ts` + `workers/agent-skill-curation.ts` | 把近 7 天信号蒸馏成 0–3 项 SKILL.md |
| 5 | 合并融合（merge fusion） | `apps/api/src/services/merge-fusion-candidates.ts` | 冲突两侧 → LLM 调解出融合候选 |

注：intake 澄清问题**不是** LLM——`questionFor`（work-items.ts）用静态 i18n 模板。

## 2. 审查结论（5 个 reviewer + 对抗复核）

**数据流 / 提示词质量 / 返回映射——全部 sound**，无高危。所有模块都对 LLM 输出做了校验（zod safeParse / fail-closed 解析 / 回退），不裸信。唯二确认项都在 **Provider**，且都是**测试覆盖缺口**（非线上缺陷）：

- **F1（已解决·经验证非 bug）**：流式 usage 用 `Math.max` 合并 `output_tokens`。**实测 DeepSeek 在单个 `message_delta` 里报累计总量（0→110）**，故 Math.max 取到的就是正确总量（不是增量求和）。已补流式 usage 测试锁定「累计语义」（两个 delta 递增 → 取最大 110，非求和 150）。
- **F2（已解决）**：provider 流式路径缺 `thinking` / `tool_use` 块的测试。已补：thinking-先于-text 顺序保留、tool_use 的 `input_json_delta` 重组+JSON.parse。

→ 补丁见 `packages/agent/src/providers/providers.test.ts`（+3 测试，33/33 绿）。无生产代码改动（行为本就正确，只是把行为钉死）。

## 3. 真 key 端到端测试（全绿）

`pnpm qa:r5-10-real`（真 DeepSeek key + flash + 本机 PG），6 个真 AgentRun，详见同目录 [`assets/audit/2026-06-16-r5-10-real-key-evaluation/`](../05-clients/assets/audit/2026-06-16-r5-10-real-key-evaluation/r5-10-real-llm-validation-report-2026-06-16.md)：

- **G2 真 provider / G3 ledger / G4 质量(T1–T4 全 ≥4) / G5 预算 / T5 结构化升级 = 全 pass**。
- T1–T4 operator quality 4/5/4/4；T5 信息不足→输出 blocker/handoff 不硬编结论（escalate）；B1 低预算→AgentLoop 结构化升级（escalate）。
- 总成本 `¥0.199692` / 44574 tokens（~¥0.03/任务）。`no_fake_transport` = 真调用非 mock。
- **覆盖模块 1（provider）+ 2（agent loop）+ 3（review，每个任务 usage_sources 都含 `review`）+ 预算护栏 + 结构化升级**。
- **模块 4（技能蒸馏 distill）**：直连真 key 测通——`buildCurationPrompt` → DeepSeek → `parseDistilledResponse` → `validateDistilledSkill` 全链路 ok（合成分析样本，LLM 返回合法 JSON，证据不足时正确返回空 distilled_skills）。
- **模块 5（merge fusion）**：审查判定 sound + 连通性已证；其 LLM 路径仅在「支持的冲突类型」真实合并时触发，端到端用例需构造多变更冲突夹具（窄路径，留作后续）。

## 4. SkillOpt 集成度：**0%（仅计划文档，无代码）**

- 仓库里关于 SkillOpt 的唯一产物是计划文档 [`skillopt-borrowable-and-plan-2026-06-16.md`](./skillopt-borrowable-and-plan-2026-06-16.md)；`apps/`、`packages/` 里**没有任何 SkillOpt 代码**。
- 现有技能蒸馏（`skill-curation.ts` 夜间 tick）是 **SkillOpt 之前的一次性整文档蒸馏**——R8 计划里借鉴的机制（弃用-edit buffer、编辑补丁、递减 edit-budget、升级 appendix、成本分账、分桶反思）**一个都还没实现**。
- 即：SkillOpt 是「研究过、出了计划」，但尚未动工集成。下一步若要做，按 R8 计划逐项落（先 K1 读回弃用日志，最便宜）。

## 5. 结论

WorkHub 的 LLM 层**数据流通畅、提示词质量达标、返回映射稳健、真 key 端到端全绿**。本轮把 provider 的 thinking/tool_use/累计-usage 行为钉进测试，关掉了唯二的覆盖缺口。剩一个窄路径（merge fusion 的真实冲突 e2e）+ SkillOpt 尚未集成（计划已就绪）。
