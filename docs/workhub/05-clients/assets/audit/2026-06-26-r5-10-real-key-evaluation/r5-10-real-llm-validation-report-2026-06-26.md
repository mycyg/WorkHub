# R5.10 Real LLM Validation Report

- generated_at: 2026-06-26T04:11:56.116Z
- provider: deepseek
- model: deepseek-v4-pro
- key: configured (redacted; not written to report)
- task_count: 1
- cost_delta_cny: 0.03723
- token_delta: 9771

## Gate Summary

- G2 real provider: fail
- G3 ledger: pass
- G4 quality: 1/4 T1-T4 scored >=4
- G5 budget: fail
- T5 structured upgrade: fail

## Task Results

| Task | Status | Mode | Operator quality | LLM verdict | Token | Cost CNY | Latency s | Key evidence |
|---|---|---|---:|---|---:|---:|---:|---|
| T1 | succeeded | deliverable | 4 | escalate | 6777 | 0.025632 | 34.2 | 周报结构、风险和审批语言完整，可直接进入人工审批。 |

## Calibration Notes

1. OQ-7 budget baseline: this run consumed 0.025632 CNY across 1 real tasks; compare against the 5 CNY/run default after multiple pilot samples.
2. OQ-2 confidence: 1/4 production-style deliverables reached operator quality >=4; review verdicts are preserved in JSON for correlation.
3. OQ-3 escalation: T5 structured-upgrade=false; B1 budget-escalated=false.

## Evidence Files

- `r5-10-real-key-evaluation-report.json` contains sanitized REST, DB, usage, confidence, artifact, and assessment evidence.
