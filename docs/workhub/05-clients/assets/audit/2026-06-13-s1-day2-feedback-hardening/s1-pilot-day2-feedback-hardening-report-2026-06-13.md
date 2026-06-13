---
module: S1-pilot-day2-feedback-hardening-report
layer: 运营 / Web / QA
status: pass
owner: workflow
date: 2026-06-13
depends_on:
  - ../../../../06-roadmap/s1-pilot-day2-feedback-hardening-plan-2026-06-13.md
---

# S1 Day 2 Feedback Hardening Report

## Result

PASS. Day 2 fixed the two Day 1 friction points before expanding the pilot: post-run WorkItem clarity and resumable browser QA. The stale Day 1 QA proposal was triaged through the normal review API, metrics remained all gates true, and backup/restore dry check passed.

## Read Before Work

- `s1-pilot-day2-feedback-hardening-plan-2026-06-13.md`
- `s1-pilot-day1-feedback-log-2026-06-13.md`
- `web-app.md`
- `page-concepts.md`
- `s1-pilot-week-runbook-2026-06-12.md`
- Concept images: `web-workitem-detail.png`, `web-deliverable-change-request.png`, `web-operations-pages-atlas.png`

## Changes

| Area | Result |
|---|---|
| Post-run clarity | WorkItem actions now mark Proposal/Replay as Day2 next actions. After terminal AgentRun, Web monitors run status and refreshes WorkItem until Proposal/Replay is visible, otherwise shows persistent refresh/replay fallback. |
| Duplicate start-run guard | WorkItem hides `start_agent_run` once a proposal or trace exists, preventing repeat runs after the first successful output. |
| Shared runtime | Added `inspectPostRunWorkItemClarity()` so QA and Web can detect Proposal/Replay next actions with the same contract. |
| Browser QA | Added `apps/web/qa/s1-day2-pilot-browser-dry-run.ts` with fresh and resume modes, stale notice protection, mobile screenshot, overflow checks, and duplicate-start assertion. |
| QA artifact triage | Proposal `7ade705e-3438-4edb-9c56-349b80176f3e` was rejected through `/api/proposals/:id/review` as a Day1 false-negative QA artifact. |
| Operator metrics | Day2 metrics baseline written to `s1-pilot-day2-metrics-snapshot.json`; runbook now keeps API and CLI examples. |

## Gates

| Gate | Status | Evidence |
|---|---|---|
| G1 post-run clarity | PASS | `s1-day2-browser-dry-run-report.json`: `post_run_clarity=true`, `nextActionKind=proposal`, `startRunAction=false`; screenshots `03` and `04`. |
| G2 no duplicate QA artifacts | PASS | Resume mode with WorkItem `956fcccc-68a7-499c-beee-63706466faf9` and Run `2334968f-32b0-4229-bf6c-74ca3dca80c4`: `resume_without_duplicate_start=true`. |
| G3 feedback continuity | PASS | Feedback log appended with `D2-FB-001` through `D2-FB-003`, all linked to WorkItem/Run/Proposal/evidence. |
| G4 metrics continuity | PASS | `s1-pilot-day2-metrics-snapshot.json`: all six gates true, closed loops `8`, adoption `89%`, rejected proposals `1`. |
| G5 backup/restore | PASS | Backup `/private/tmp/workhub-backups/workhub-20260613-165459.sql.gz`; isolated restore query returned Day2 run `succeeded` and artifact proposal `rejected`. |

## Browser Evidence

| File | What it proves |
|---|---|
| `01-day2-home-or-entry.png` | Resume QA starts from a known authenticated entry without creating a new task. |
| `02-day2-workitem-before-run.png` | Existing WorkItem has Proposal/Replay next actions and no duplicate start-run action. |
| `03-day2-post-run-clarity.png` | Desktop WorkItem view shows `查看变更申请` and `查看回放`, no start-run, no overflow. |
| `04-day2-post-run-clarity-mobile.png` | Mobile layout keeps actions and long text inside the viewport. |

In-app Browser also verified English mode on the same WorkItem: `Task detail`, `Open change request`, `Open replay`, `lang=en-US`, no `Start AI run`, and no horizontal overflow.

## Dataflow Audit

- `start_agent_run` now transitions from action success to WorkItem refresh/monitor instead of relying only on SSE timing.
- Terminal status is read from `GET /api/agent-runs/:id`; the WorkItem Page VM remains the truth for Proposal/Replay.
- Day2 QA resume mode does not create new WorkItems, runs, or proposals when WorkItem/Run ids are supplied.
- Rejecting the stale Day1 proposal preserved audit/review trail and avoids counting a QA-only deliverable as a closed loop.

## Verification

- `pnpm --filter @workhub/web-runtime test`
- `pnpm --filter @workhub/ui test`
- `pnpm --filter @workhub/web test`
- `pnpm --filter @workhub/web typecheck`
- `S1_DAY2_NICKNAME='S1 Day2 QA Fresh 202606131651' S1_DAY2_WORKITEM_ID='956fcccc-68a7-499c-beee-63706466faf9' S1_DAY2_RUN_ID='2334968f-32b0-4229-bf6c-74ca3dca80c4' pnpm --filter @workhub/web qa:s1-day2-browser`
- `S1_DAY1_REQUIRE_GATES=1 pnpm --filter @workhub/api qa:s1-day1-metrics`

## PRD / Concept Alignment

WorkItem detail still centers on status, acceptance, evidence, AI trace, and next actions. The Web app remains a serious workspace with bilingual chrome and no Cuu/pet surface in the main window. The Day2 change strengthens the PRD loop: users can see what AI produced and how to review it without understanding runs, streams, or internal retries.

## Next

Proceed to `s1-pilot-day3-expansion-plan-2026-06-13.md`: invite 1-3 real users, one real WorkItem each, keep the same browser QA resume discipline, collect qualitative feedback, run metrics delta, and backup/restore at day end.
