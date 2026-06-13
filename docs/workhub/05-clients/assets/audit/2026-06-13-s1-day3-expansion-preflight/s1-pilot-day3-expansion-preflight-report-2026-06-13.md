---
module: S1-pilot-day3-expansion-preflight-report
layer: 运营 / QA / Ops
status: pass-ready-to-invite
owner: workflow
date: 2026-06-13
depends_on:
  - ../../../../06-roadmap/s1-pilot-day3-expansion-plan-2026-06-13.md
  - ../2026-06-13-s1-day2-feedback-hardening/s1-pilot-day2-feedback-hardening-report-2026-06-13.md
---

# S1 Day 3 Expansion Preflight Report

## Result

PASS. Day3 is ready to invite 1-3 real users. Preflight cleared the remaining opened Day2 QA proposal through the normal review API, verified no opened proposal / active run / pending approval remains, compared metrics against the Day2 baseline, and proved the updated database can be backed up and restored in the isolated `workhub_restore` project.

Day3 itself is not complete yet: G1 still needs at least one real user to submit a real `/intake` task.

## Read Before Work

- `s1-pilot-day3-expansion-plan-2026-06-13.md`
- `s1-pilot-week-runbook-2026-06-12.md`
- `web-app.md`
- `page-concepts.md`
- Concept images: `web-option-first-intake-wizard.png`, `web-workitem-detail.png`, `web-deliverable-change-request.png`, `web-operations-pages-atlas.png`

## Changes

| Area | Result |
|---|---|
| Preflight QA command | Added `pnpm --filter @workhub/api qa:s1-day3-preflight`, a DB-backed JSON preflight that checks opened proposals, active runs, pending approvals, S1 metric gates, and Day2 baseline availability. |
| Baseline handling | The command reads the committed Day2 metrics file by default; production/pilot containers can use `S1_DAY3_BASELINE_FILE` or `S1_DAY3_BASELINE_JSON` because `docs/` is intentionally excluded from the pilot image. |
| Queue cleanup | Proposal `1f1579ef-e2ac-4557-86c5-94fc072e2a25` from Day2 browser QA was rejected with reason through `/api/proposals/:id/review` before real-user expansion. |
| Metrics evidence | Saved `s1-day3-expansion-preflight-report.json`, `s1-pilot-day3-preflight-metrics-snapshot.json`, and `s1-pilot-day3-preflight-metrics-cli.json`. |
| Ops safety | Backup `/private/tmp/workhub-backups/workhub-20260613-181935.sql.gz` restored into isolated `workhub_restore`; query evidence saved as `s1-day3-restore-query.json`. |

## Gates

| Gate | Status | Evidence |
|---|---|---|
| No opened proposals | PASS | `s1-day3-expansion-preflight-report.json`: `opened_proposals=[]`, `no_opened_proposals=true`. |
| No active runs | PASS | `active_runs=[]`, `no_active_runs=true`. |
| No pending approvals | PASS | `pending_approvals=[]`, `no_pending_approvals=true`. |
| Metrics comparable | PASS | Day2 baseline generated at `2026-06-13T08:54:36.106Z`; current metrics gates all true. |
| Queue-clean adoption delta explained | PASS | Adoption moved from `89%` to `80%` because reviewed proposals increased from 9 to 10 after rejecting the Day2 QA-only proposal; merged count stayed 8. |
| Backup restored | PASS | Restore query: opened proposals `0`, active runs `0`, pending approvals `0`, proposal counts `{ merged: 8, rejected: 2 }`. |
| Real users observed | WAITING | External dependency: invite 1-3 real users; each submits one real `/intake` task. |

## Dataflow Audit

- Preflight uses read-only SQL for queue state and the existing `buildPilotDay1MetricsSnapshot()` contract for metric continuity.
- Day2 baseline comparison is explicit; the pilot image does not need to carry `docs/` assets.
- Review cleanup used the production proposal review path, so the rejected QA artifact has a durable review trail instead of being deleted or hidden.
- No session cookie, API key, or private task content is emitted in the preflight JSON.

## Verification

- `pnpm --filter @workhub/api typecheck`
- `pnpm --filter @workhub/api test` (`145/145` pass)
- `docker compose --env-file .env.pilot -f docker-compose.pilot.yml up -d --build workhub`
- `docker cp .../s1-pilot-day2-metrics-snapshot.json workhub-workhub-1:/tmp/s1-pilot-day2-metrics-snapshot.json`
- `S1_DAY3_BASELINE_FILE=/tmp/s1-pilot-day2-metrics-snapshot.json S1_DAY3_REQUIRE_PREFLIGHT=1 pnpm --filter @workhub/api qa:s1-day3-preflight` inside the pilot container
- `S1_DAY1_REQUIRE_GATES=1 pnpm --filter @workhub/api qa:s1-day1-metrics` inside the pilot container
- `bash scripts/ops/backup-pg.sh /private/tmp/workhub-backups 14`
- Isolated restore into `workhub_restore` and query saved to `s1-day3-restore-query.json`

## PRD / Concept Alignment

This preflight keeps Day3 inside the PRD pilot shape: real users enter through `/intake`, AI output remains reviewable through Proposal/Replay, every proposal has a final decision, and Web stays a bilingual serious workspace. No desktop pet/Cuu surface was added to the main Web window.

## Next

Proceed with Day3 expansion: invite 1-3 real users, one real low-risk task each, observe without feature work, bind every feedback item to WorkItem/Run/Proposal/evidence, and run the same preflight/metrics/backup sequence at Day3 close.
