# R5.10 Real LLM Validation Report

- generated_at: 2026-06-28T14:07:36.714Z
- provider: deepseek
- model: deepseek-v4-pro
- key: configured (redacted; not written to report)
- run_scope: limited_sample (1/6, R5_10_REAL_TASK_LIMIT=1)
- task_count: 1
- cost_delta_cny: 0.053462
- token_delta: 13063

## Limited Sample Summary

- Real provider sample: pass
- Ledger sample: pass
- Quality sample: 1/1 sampled T1-T4 scored >=4
- Full-suite gates: not asserted in limited sample
- Unsampled full-suite checks: T5, B1

## Task Results

| Task | Status | Mode | Operator quality | LLM verdict | Token | Cost CNY | Latency s | Key evidence |
|---|---|---|---:|---|---:|---:|---:|---|
| T1 | succeeded | deliverable | 4 | escalate | 7891 | 0.032276 | 45.4 | 周报结构、风险和审批语言完整，可直接进入人工审批。 |

## Calibration Notes

1. OQ-7 budget baseline: this run consumed 0.032276 CNY across 1 real tasks; compare against the 5 CNY/run default after multiple pilot samples.
2. OQ-2 confidence: 1/1 sampled production-style deliverables reached operator quality >=4; review verdicts are preserved in JSON for correlation.
3. OQ-3 escalation: full-suite escalation gates were not asserted in this limited sample; unsampled checks=T5, B1.

## Evidence Files

- `r5-10-real-key-evaluation-report.json` contains sanitized REST, DB, usage, confidence, artifact, and assessment evidence.
