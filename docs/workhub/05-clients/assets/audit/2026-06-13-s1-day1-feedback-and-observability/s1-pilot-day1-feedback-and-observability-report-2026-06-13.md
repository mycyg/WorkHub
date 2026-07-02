---
module: S1-pilot-day1-feedback-and-observability-report
layer: 运营 / Web / Metrics / QA
status: pass
owner: workflow
date: 2026-06-13
depends_on:
  - ../../../../06-roadmap/archive/s1-pilot-day1-feedback-and-observability-plan-2026-06-13.md
  - ../../../../06-roadmap/archive/s1-pilot-week-runbook-2026-06-12.md
---

# S1 Day 1 Feedback and Observability Report

## Verdict

**PASS.** Day 1 反馈与观测地基已落：非 admin 第二用户完成真实任务 intake -> WorkItem -> AgentRun -> Proposal review/merge -> Replay -> Cost；六项指标快照可由 API/QA 取数；反馈模板、triage 规则、15 分钟 ops loop、backup/restore dry check 均已固化。

本轮同时修复 2 个 Day1 阻断风险：

1. `/intake` 启动入口不再硬编码 Day 0 任务，新增 Day1 真实任务输入；空白时才使用通用 pilot feedback intent。
2. option-first intake 的自由文本从“只显示说明”变为真实 textarea，并进入 `next-question` / `create-workitem` payload；review reason gate 和 intake free text 都会触发 dirty guard。

## Evidence

| Gate | Result | Evidence |
|---|---|---|
| G1 feedback log | PASS | [`s1-pilot-day1-feedback-log-2026-06-13.md`](./s1-pilot-day1-feedback-log-2026-06-13.md) 定义字段、分类和首批 3 条记录。 |
| G2 metrics | PASS | `GET /api/pilot/day1/metrics` + `pnpm --filter @workhub/api qa:s1-day1-metrics` 输出六项指标；快照见 [`s1-pilot-day1-metrics-snapshot.json`](./s1-pilot-day1-metrics-snapshot.json)。 |
| G3 second-user path | PASS | 非 admin `S1 Day1 User 20260613075734`，WorkItem `4afa12db-0a9a-448a-a0be-9bda4725c0e7`，Run `1ea4dd8f-a466-45b4-b3d7-683a1dcf5544` succeeded，Proposal `09b45408-6e19-4e79-bb98-68b6d953fcd8` merged。截图：`01`-`09`。 |
| G4 no data loss | PASS | `day1-browser-capture-report.json`：start intent dirty、intake free text payload、review reason pending dirty、merge 后 dirty 清空；单元测试覆盖 shared runtime payload。 |
| G5 ops loop | PASS | runbook 已补 Day1 15 分钟检查：health/cost/approvals/replay/logs/backup/metrics。 |
| G6 backup | PASS | backup `/private/tmp/workhub-backups/workhub-20260613-160144.sql.gz`；隔离 `workhub_restore` project restore query 返回 run `succeeded` / proposal `merged` / accepted_count `1` / ledger_cost `0.037162`。 |

## Metrics Baseline

| Metric | Value | Raw |
|---|---:|---|
| Closed loops | 8 | `closed_loop_work_items=8` |
| Proposal adoption | 100% | `proposals_reviewed=8`, `proposals_merged=8` |
| Escalations | 3 | `escalation_events=3`, `approval_requests=0` |
| Cost per merged item | 0.017361 CNY | `total_cost_cny=0.138888 / closed_loop=8` |
| Conflicts | 0 | `merge_conflict_instances=0` |
| Notification density | 1.25/user | `notifications_created=5 / active_user_count=4` |

Notes:

- Direct Proposal review/merge is counted through `proposals.reviewed_at` and `proposals.merged_at`; approval center rows are not required for adoption.
- Cost follows the Cost page ledger rule: one row per unique `usage_record_id`.
- The interrupted first browser attempt intentionally leaves `proposals_opened=9` while reviewed/merged is `8`; it is recorded as D1-FB-002 and does not affect adoption denominator.

## Dataflow Audit

| Segment | Result |
|---|---|
| Intake start | `/intake` renders project bootstrap plus `data-s1-day1-intent-input`; browser runtime sends this value to `POST /api/sessions` as `intent_text`. |
| Intake free text | `packages/web-runtime/src/action-payload.ts` materializes `free_text` into both continue and create WorkItem actions. |
| Second user | Non-admin identity is preserved; `/api/pilot/day1/metrics` returns 403 for non-admin; Day0 WorkItem cross-user read returns 403. |
| Agent/Proposal | Run succeeded, proposal opened from manifest, human approval merged it, write actions disappeared after merge. |
| Replay/Cost | Replay shows 32 steps / 1 accepted deliverable / 1 merge attempt; Cost page shows total tokens `33639`, CNY `0.138888`. |
| Backup/Restore | `pg_dump` gzip restored into isolated compose project and matched Day1 WorkItem/Run/Proposal/ledger facts. |

## Bug Review

| Finding | Severity | Status |
|---|---|---|
| `/intake` hard-coded Day 0 validation note, blocking a true Day1 non-Day0 task. | P0 | Fixed with Day1 intent textarea and generic fallback. |
| Intake free text did not exist as an input, so G4 could not be proven. | P0 | Fixed with textarea + payload materialization + tests. |
| Browser QA parsed a stale `Submitted` notice and then waited for a too-specific WorkItem live marker. | P2 | QA script was resumed and evidence completed; Day2 plan includes idempotent/resumable browser QA. |
| WorkItem page may not make post-run proposal/replay availability obvious within 30 seconds. | P1 | Logged as D1-FB-001; Day2 first product hardening item. |

## QA Commands

| Command | Result |
|---|---|
| `pnpm --filter @workhub/contracts test` | PASS |
| `pnpm --filter @workhub/web-runtime test` | PASS |
| `pnpm --filter @workhub/api-client test` | PASS |
| `pnpm --filter @workhub/ui test` | PASS |
| `pnpm --filter @workhub/api test` | PASS |
| `pnpm --filter @workhub/api typecheck` | PASS |
| `pnpm --filter @workhub/web test` | PASS |
| `pnpm --filter @workhub/web typecheck` | PASS |
| `pnpm --filter @workhub/desktop-webview test` | PASS |
| `docker compose --env-file .env.pilot -f docker-compose.pilot.yml up -d --build` | PASS |
| `node /private/tmp/workhub-day1-capture.mjs` + `node /private/tmp/workhub-day1-resume.mjs` | PASS after resume; screenshots `01`-`09`, JSON report written. |
| `docker compose ... exec -T workhub sh -lc 'S1_DAY1_REQUIRE_GATES=1 pnpm --filter @workhub/api qa:s1-day1-metrics'` | PASS, all gates true. |
| `bash scripts/ops/backup-pg.sh /private/tmp/workhub-backups 14` | PASS |
| isolated restore query | PASS |

## PRD / Concept Review

- 符合 PRD 核心反转：AI 默认产出，用户以 Proposal 审阅/合并进入可信源。
- 符合 Web concept：Web 主窗是严肃工作台；中英切换保留；无 Cuu 主窗泄漏。
- 符合 option-first：用户先点选类型，自由文本只是补充；自由文本不再丢失。
- 符合安全边界：第二用户只能看自己的 WorkItem，admin-only metrics fail-closed。

## Next

进入 [`s1-pilot-day2-feedback-hardening-plan-2026-06-13.md`](../../../../06-roadmap/archive/s1-pilot-day2-feedback-hardening-plan-2026-06-13.md)：先修 post-run WorkItem 刷新/notice 和 QA idempotency，再邀请下一批 1-3 个真实用户。
