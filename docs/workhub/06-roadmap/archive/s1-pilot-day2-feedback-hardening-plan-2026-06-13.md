---
module: S1-pilot-day2-feedback-hardening
layer: 运营 / Web / QA
status: pass
owner: workflow
date: 2026-06-13
depends_on:
  - s1-pilot-day1-feedback-and-observability-plan-2026-06-13.md
  - ../05-clients/assets/audit/2026-06-13-s1-day1-feedback-and-observability/s1-pilot-day1-feedback-and-observability-report-2026-06-13.md
---

# S1 Day 2 Feedback Hardening Plan

> 2026-06-13 result: **PASS**. Report: [`s1-pilot-day2-feedback-hardening-report-2026-06-13.md`](../05-clients/assets/audit/2026-06-13-s1-day2-feedback-hardening/s1-pilot-day2-feedback-hardening-report-2026-06-13.md). Next: [`s1-pilot-day3-expansion-plan-2026-06-13.md`](./s1-pilot-day3-expansion-plan-2026-06-13.md).

## Goal

把 Day 1 暴露的“真实用户看不见下一步”和“QA 脚本不够可恢复”两个摩擦点修掉，再继续扩大 1-3 个真实使用者。Day 2 仍不扩业务模块，不开 Cuu 新面。

## Work Packages

| ID | Scope | Deliverable |
|---|---|---|
| D2-1 Post-run WorkItem clarity | AgentRun terminal 后，WorkItem 页必须清楚显示 Proposal/Replay 下一步；若 SSE 未及时到达，用短轮询或明确刷新 notice。 | Web runtime/product route fix + browser evidence |
| D2-2 Browser QA idempotency | Day1 capture 脚本改为 repo 内可复跑 QA：支持 resume ids、不会误读 stale notice、不会重复造无用 proposal。 | `apps/web/qa/s1-day1-pilot-browser-dry-run.ts` 或等价 |
| D2-3 Open QA artifact triage | 处理 Day1 首次 false-negative 留下的 opened proposal `7ade705e-3438-4edb-9c56-349b80176f3e`：合并、打回或标记 QA artifact。 | feedback log 更新 |
| D2-4 Metrics operator surface | 管理员能用 runbook/API 快速取六指标；保留 CLI 但记录 curl/API 示例。 | runbook 更新 + metrics JSON |
| D2-5 Invite next real users | 在 D2-1/D2-2 后再邀请 1-3 个真实用户，每人 1 件真实任务。 | Day2 browser/DB evidence |

## Completion Notes

| ID | Status | Evidence |
|---|---|---|
| D2-1 | PASS | WorkItem `956fcccc-68a7-499c-beee-63706466faf9` shows Proposal `1f1579ef-e2ac-4557-86c5-94fc072e2a25` and Replay for Run `2334968f-32b0-4229-bf6c-74ca3dca80c4`; no duplicate start-run. |
| D2-2 | PASS | `apps/web/qa/s1-day2-pilot-browser-dry-run.ts` supports fresh/resume, stale notice filtering, desktop/mobile screenshots, overflow and duplicate-start gates. |
| D2-3 | PASS | Proposal `7ade705e-3438-4edb-9c56-349b80176f3e` rejected through normal review API as QA artifact; metrics record `proposals_rejected: 1`. |
| D2-4 | PASS | `s1-pilot-day2-metrics-snapshot.json`: closed loops `8`, adoption `89%`, all gates true; runbook has API + CLI examples. |
| D2-5 | PASS-to-expand | Day2 did not create more real-user work beyond QA validation; it exits by opening Day3 expansion with 1-3 real users and a detailed gate plan. |

## Gates

| Gate | Must be true |
|---|---|
| G1 post-run clarity | PASS: browser report `post_run_clarity=true`, `nextActionKind=proposal`, `startRunAction=false`。 |
| G2 no duplicate QA artifacts | PASS: resume report `resume_without_duplicate_start=true`。 |
| G3 feedback log continuity | PASS: `D2-FB-001` through `D2-FB-003` appended。 |
| G4 metrics continuity | PASS: `qa:s1-day1-metrics` all gates true，Day2 baseline 已保存。 |
| G5 backup | PASS: `/private/tmp/workhub-backups/workhub-20260613-165459.sql.gz` + isolated restore query。 |

## QA

1. `pnpm --filter @workhub/web-runtime test`
2. `pnpm --filter @workhub/web test`
3. `pnpm --filter @workhub/api test`
4. Browser dry run with resume mode
5. `S1_DAY1_REQUIRE_GATES=1 pnpm --filter @workhub/api qa:s1-day1-metrics`
6. `pnpm verify`

## Exit

Day2 已全绿。Pilot Week 进入 Day3 expansion：从“受控第二用户”扩大到 1-3 个真实使用者日常提交；若 Day3 任一真实用户路径复现 G1/G2 类问题，立即停止扩人并按 blocker 修复。
