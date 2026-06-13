---
module: S1-pilot-day3-live-observation-checklist
layer: 运营 / Pilot / QA
status: ready-for-real-users
owner: workflow
date: 2026-06-13
depends_on:
  - ../../../../06-roadmap/s1-pilot-day3-expansion-plan-2026-06-13.md
  - ./s1-pilot-day3-expansion-preflight-report-2026-06-13.md
---

# S1 Day 3 Live Observation Checklist

## Purpose

This is the operator sheet for Day3 live expansion. It keeps the pilot honest: only declared real participant nicknames can satisfy G1, and every observed WorkItem must keep a WorkItem -> AgentRun -> Proposal/Replay -> review decision evidence chain.

## Before Inviting

- Confirm `s1-pilot-day3-expansion-preflight-report-2026-06-13.md` is PASS.
- Open the Web app at `http://<pilot-host>:8787/`.
- Keep the participant list to 1-3 people.
- Ask each participant to register with a nickname; do not collect secrets, session cookies, private source text, or personal credentials in docs.
- Give each participant only one instruction: submit one real low-risk task through `/intake`.

## Participant Tracker

| Slot | Nickname | Task theme only | WorkItem id/code | Run id | Proposal id | Final decision | Feedback ids | Notes |
|---|---|---|---|---|---|---|---|---|
| P1 | _waiting_ | _waiting_ | _waiting_ | _waiting_ | _waiting_ | _waiting_ | _waiting_ | _waiting_ |
| P2 | optional | optional | optional | optional | optional | optional | optional | optional |
| P3 | optional | optional | optional | optional | optional | optional | optional | optional |

Task theme means a short category such as "proposal draft", "spreadsheet cleanup", or "meeting summary". Do not paste the participant's private work content here.

## During Observation

1. Participant opens `/intake`.
2. Participant chooses or enters the real task using the existing option-first intake flow.
3. Host records the created WorkItem id/code.
4. Participant or host starts the AgentRun from the WorkItem.
5. After the run reaches terminal status, the WorkItem must show Proposal/Replay or an explicit refresh/replay fallback.
6. Proposal must be either merged or rejected with a reason. Do not leave `opened` proposals.
7. Every feedback item goes into `s1-pilot-day1-feedback-log-2026-06-13.md` as `D3-FB-*` and must bind WorkItem/Run/Proposal/evidence.

## Audit Command

Copy or inject the Day2 baseline into the pilot container:

```bash
docker cp \
  docs/workhub/05-clients/assets/audit/2026-06-13-s1-day2-feedback-hardening/s1-pilot-day2-metrics-snapshot.json \
  workhub-workhub-1:/tmp/s1-pilot-day2-metrics-snapshot.json
```

Run the live observation audit with explicit nicknames:

```bash
docker compose --env-file .env.pilot -f docker-compose.pilot.yml exec -T workhub \
  sh -lc 'S1_DAY3_PARTICIPANTS="nickname-one,nickname-two" S1_DAY3_BASELINE_FILE=/tmp/s1-pilot-day2-metrics-snapshot.json S1_DAY3_REQUIRE_OBSERVATION=1 pnpm --filter @workhub/api qa:s1-day3-observation'
```

Expected closeout status is `ready_for_day3_exit_report`.

## Exit Evidence

- `qa:s1-day3-observation` JSON saved into this audit directory.
- Day3 metrics JSON saved next to the observation audit.
- Updated feedback log with all `D3-FB-*` rows.
- Backup path and isolated restore query saved.
- Day3 expansion report summarizing participant count, WorkItem/Run/Proposal ids, decisions, metrics delta, feedback top issues, and Day4 recommendation.

## Current State

As of this checklist, no real participant nicknames have been provided in the repo evidence. The system is ready to invite, but Day3 G1 remains waiting on real users.
