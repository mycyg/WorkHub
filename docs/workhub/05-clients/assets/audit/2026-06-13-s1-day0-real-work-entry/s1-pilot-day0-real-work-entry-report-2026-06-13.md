---
module: S1-pilot-day0-real-work-entry-report
layer: 运营 / Web / Agent / QA
status: pass
owner: workflow
date: 2026-06-13
depends_on:
  - ../../../../06-roadmap/archive/s1-pilot-day0-real-work-entry-plan-2026-06-13.md
  - ../../../../06-roadmap/archive/s1-pilot-week-runbook-2026-06-12.md
---

# S1 Day 0 Real Work Entry Report

## Verdict

**PASS.** Day 0 真实入口已从 Web 主窗完成：真实 pilot project context -> option-first intake -> WorkItem -> AgentRun -> Proposal -> human review/merge -> Replay -> Cost -> backup/restore。

本轮发现并修复 2 个会影响 Pilot Week 的真实问题：

1. AgentRun 默认 prompt 只给 `work_item_id`，没有带 WorkItem 标题、描述、选项和验收项，导致真实工单可能被 worker 误判为“没有任务”。已改为执行前从 DB 读取 WorkItem context 并注入首轮 user message，新增回归测试。
2. DeepSeek provider 成本默认值为 0，pilot 环境未覆盖时会出现真实 usage 但 Cost 为 0。已把默认值改为 input `2` / output `8` CNY per MTok，并加配置测试。

## Evidence

| Gate | Result | Evidence |
|---|---|---|
| G1 project context | PASS | `/intake` 显示 `Pilot project context`，无旧 `r4-live-*` seed 泄漏。截图：`01-intake-start-en-desktop.png` |
| G2 intake entry | PASS | 点击 `Start work intake` 后创建真实 session `cf6396b7-a1d0-4084-bcfe-b7a698a81085`，4 个 option，选中 `document-draft`。截图：`02-intake-session-en-desktop.png`、`05-intake-session-en-mobile.png` |
| G3 work item | PASS | 真实 WorkItem `DAY0PILOT-006`，id `cf6396b7-a1d0-4084-bcfe-b7a698a81085`，状态进入可执行链路。截图：`03-workitem-real-task-en-desktop.png` |
| G4 agent/proposal | PASS | AgentRun `3bb9bd88-85e7-4f4e-bb26-f8ebcff5eb77` succeeded，生成 Proposal `2cff8131-400f-4a19-9dd6-01a5daa06e9c`。截图：`04-workitem-run-started-en-desktop.png` |
| G5 approval/merge/replay | PASS | Proposal reviewed/merged at `2026-06-13T07:12:40Z`，merge snapshot `02ba6cf3-f3ff-482d-a8f6-c84716b13079`；Replay 显示 17 steps / 1 accepted deliverable / 2 snapshots。截图：`06-proposal-merged-en-desktop.png`、`08-replay-en-desktop.png` |
| G6 cost/i18n | PASS | Run token `6146`，estimated cost `0.028870` CNY；Cost 页面总成本 `0.07758` CNY、budget risk ok；主窗中英切换可见且无 Cuu。截图：`09-cost-en-desktop.png` |
| G7 backup after Day 0 | PASS | backup `/private/tmp/workhub-backups/workhub-20260613-151604.sql.gz`；独立 `workhub_restore` project restore query 返回 `workitem_count=1 / run_status=succeeded / proposal_status=merged / accepted_count=1`。 |

## Dataflow Audit

| Segment | Result |
|---|---|
| Project bootstrap | `POST /api/projects/bootstrap` authenticates the operator, creates/reuses `Day 0 Pilot Project`, and passes `project_id` into session creation. |
| Intake | `/intake` now has a real start card rather than a dead empty state. Session and WorkItem are created through existing REST services, not fixture HTML. |
| Worker context | AgentRun now resolves DB context before the LLM call: WorkItem code/title/status, raw description, summary, planning note, selected options, acceptance checks, evidence/source hints. |
| Deliverable | Worker wrote `outputs/day-0-pilot-validation-note.md`; accepted deliverable row `53f9ac51-f916-4af4-8a30-68699dcc80e1`, target `delivery:/outputs/day-0-pilot-validation-note.md`, sha `c91772ddb03d73bc37afc76d3b7c1ca9251b54f0c3a852f70fa9c0407ca893fa`. |
| Proposal review | This route uses direct Proposal review/merge, not an `approval_requests` row; `approval_requests` count for the run is `0`, and merge audit is carried by proposal/audit/snapshot rows. |
| Cost | 7 usage records were written for this run (`agent_step` + `review`), total `0.028870` CNY. |

## Bug Review

| Finding | Severity | Fix |
|---|---|---|
| Worker saw an empty temp workdir and only `work_item_id`, causing failed run `1176bcc2-1118-4360-ba85-ae6a01b2c753` with `AI 没产出交付物`. | P0 | `apps/api/src/workers/agent-runner.ts` now supports `workItemContext` and default DB-backed context provider. Regression: `agent run prompt includes resolved WorkItem context before calling the model`. |
| Provider cost default was `0`, so real pilot runs could show 0 cost unless env overrode it. | P0 | `packages/config/src/env.ts` and `.env.example` default DeepSeek input/output costs to `2/8`; `packages/config/src/env.test.ts` asserts it. |
| Merged Proposal page still exposed write actions in some render paths. | P1 | Proposal action rendering now gates by status: `opened` shows approve/request changes, `reviewed` shows merge, `merged/rejected` hides write actions. |

## QA Commands

| Command | Result |
|---|---|
| `pnpm --filter @workhub/config test` | PASS |
| `pnpm --filter @workhub/api test` | PASS |
| `pnpm --filter @workhub/api typecheck` | PASS |
| `docker compose --env-file .env.pilot -f docker-compose.pilot.yml up -d --build` | PASS |
| `node /private/tmp/workhub-day0-capture.mjs` | PASS, captured 01-05 |
| `WORKHUB_DAY0_CAPTURE_PAGES=1 ... node /private/tmp/workhub-day0-capture.mjs` | PASS, captured 06-09 |
| `docker compose --env-file .env.pilot -f docker-compose.pilot.yml exec -T workhub pnpm qa:r5-10-dry` | PASS, run `cc89d359-dcf6-4174-8f6d-eb906448fb08` |
| `bash scripts/ops/backup-pg.sh /private/tmp/workhub-backups 14` | PASS |
| restore dry check with `workhub_restore` compose project | PASS |

## PRD / Concept Review

- 符合 PRD 的核心反转：AI 默认工作，人通过 Proposal 合并进入可信源。
- 符合 concept：Web 主窗是严肃工作台；无 Cuu 主窗泄漏；option-first intake；Replay/Cost 提供可追溯证据。
- 中英双语：当前截图在 en-US，顶部可切 zh-CN；固定 shell 文案没有溢出；移动 intake 截图通过。
- 与 Pilot Week runbook 一致：Day 0 已证明主持人可见闭环，可以进入受控 Day 1 反馈/观测阶段。

## Next

进入 [`s1-pilot-day1-feedback-and-observability-plan-2026-06-13.md`](../../../../06-roadmap/archive/s1-pilot-day1-feedback-and-observability-plan-2026-06-13.md)：不扩业务面，先把真实用户反馈、每日指标、异常 triage 和 Pilot Week report 输入源固化。
