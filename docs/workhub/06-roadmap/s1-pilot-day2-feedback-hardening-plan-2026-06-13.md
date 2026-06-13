---
module: S1-pilot-day2-feedback-hardening
layer: 运营 / Web / QA
status: planned
owner: workflow
date: 2026-06-13
depends_on:
  - s1-pilot-day1-feedback-and-observability-plan-2026-06-13.md
  - ../05-clients/assets/audit/2026-06-13-s1-day1-feedback-and-observability/s1-pilot-day1-feedback-and-observability-report-2026-06-13.md
---

# S1 Day 2 Feedback Hardening Plan

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

## Gates

| Gate | Must be true |
|---|---|
| G1 post-run clarity | 用户启动 run 后，WorkItem route 在 run terminal 后 10 秒内显示 Proposal/Replay next action 或明确刷新动作。 |
| G2 no duplicate QA artifacts | Dry run 脚本失败可 resume，不因等待条件重复创建 WorkItem/Run。 |
| G3 feedback log continuity | Day1 feedback log 继续追加，所有 Day2 issue 绑定 WorkItem/Run/Proposal/截图。 |
| G4 metrics continuity | `qa:s1-day1-metrics` 仍 all gates true，且 Day2 baseline 与 Day1 可比较。 |
| G5 backup | Day2 结束再次 backup + isolated restore dry check。 |

## QA

1. `pnpm --filter @workhub/web-runtime test`
2. `pnpm --filter @workhub/web test`
3. `pnpm --filter @workhub/api test`
4. Browser dry run with resume mode
5. `S1_DAY1_REQUIRE_GATES=1 pnpm --filter @workhub/api qa:s1-day1-metrics`
6. `pnpm verify`

## Exit

Day2 全绿后，Pilot Week 可以从“受控第二用户”扩大到 1-3 个真实使用者日常提交；若 G1 或 G2 失败，继续修 Web runtime/QA，不邀请新用户。
