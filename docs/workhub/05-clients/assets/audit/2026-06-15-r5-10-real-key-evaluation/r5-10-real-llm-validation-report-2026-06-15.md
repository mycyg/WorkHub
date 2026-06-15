# R5.10 Real LLM Validation Report

- generated_at: 2026-06-15T08:18:26.907Z
- provider: deepseek
- model: deepseek-v4-flash
- key: configured (redacted; not written to report)
- task_count: 6
- cost_delta_cny: 0.141888
- token_delta: 31503

## Gate Summary

- G2 real provider: pass
- G3 ledger: pass
- G4 quality: 4/4 T1-T4 scored >=4
- G5 budget: pass
- T5 structured upgrade: pass

## Task Results

| Task | Status | Mode | Operator quality | LLM verdict | Token | Cost CNY | Latency s | Key evidence |
|---|---|---|---:|---|---:|---:|---:|---|
| T1 | succeeded | deliverable | 4 | human_spotcheck | 4011 | 0.018528 | 23.8 | 周报结构、风险和审批语言完整，可直接进入人工审批。 |
| T2 | succeeded | deliverable | 5 | human_spotcheck | 5465 | 0.024592 | 30.4 | CSV 聚合数字与预置答案一致，且有结论说明。 |
| T3 | succeeded | deliverable | 4 | human_spotcheck | 5867 | 0.028312 | 53.1 | PPTX 与 PNG 均真实生成，满足富格式能力验证。 |
| T4 | succeeded | deliverable | 4 | human_spotcheck | 5784 | 0.029214 | 31.4 | 脚本、清洗结果、rejects 与自验记录齐全。 |
| T5 | succeeded | structured_upgrade | n/a | human_spotcheck | 5735 | 0.024004 | 30.3 | 信息不足任务输出了 blocker/handoff，没有硬编税务结论。 |
| B1 | escalated | budget_guard | n/a | escalate | 374 | 0.001504 | 1.7 | 低 token budget 触发 AgentLoop 结构化升级。 |

## Calibration Notes

1. OQ-7 budget baseline: this run consumed 0.126154 CNY across 6 real tasks; compare against the 5 CNY/run default after multiple pilot samples.
2. OQ-2 confidence: 4/4 production-style deliverables reached operator quality >=4; review verdicts are preserved in JSON for correlation.
3. OQ-3 escalation: T5 structured-upgrade=true; B1 budget-escalated=true.

## Evidence Files

- `r5-10-real-key-evaluation-report.json` contains sanitized REST, DB, usage, confidence, artifact, and assessment evidence.
