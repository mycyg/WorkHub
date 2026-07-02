---
module: S1-pilot-feedback-log
layer: 运营 / 反馈
status: active-day3-preflight-ready
owner: workflow
date: 2026-06-13
depends_on:
  - ../../../../06-roadmap/archive/s1-pilot-day1-feedback-and-observability-plan-2026-06-13.md
  - ../../../../06-roadmap/archive/s1-pilot-day2-feedback-hardening-plan-2026-06-13.md
  - ../../../../06-roadmap/s1-pilot-day3-expansion-plan-2026-06-13.md
---

# S1 Pilot Feedback Log

## Template

| Field | Required | Notes |
|---|---:|---|
| Feedback ID | yes | `D#-FB-###` |
| User | yes | Nickname only; no secret, token, private content. |
| WorkItem | yes | Code/id or `n/a` if pre-intake. |
| Proposal | when relevant | Proposal id. |
| AgentRun | when relevant | Run id. |
| Screenshot | when relevant | Relative filename in this audit directory. |
| Category | yes | blocker / usability / surprise / backlog |
| Severity | yes | P0 / P1 / P2 |
| Observation | yes | What happened, user-facing wording. |
| Decision | yes | Fix today / watch / move to Day2 backlog. |

## Entries

| ID | User | WorkItem | Proposal | AgentRun | Screenshot | Category | Severity | Observation | Decision |
|---|---|---|---|---|---|---|---|---|---|
| D1-FB-001 | `S1 Day1 User 20260613075734` | `4afa12db-0a9a-448a-a0be-9bda4725c0e7` | `09b45408-6e19-4e79-bb98-68b6d953fcd8` | `1ea4dd8f-a466-45b4-b3d7-683a1dcf5544` | `05-workitem-run-succeeded-en-desktop.png` | usability | P1 | After start-run, the WorkItem route did not reliably surface the terminal run/proposal link inside the first 30 seconds, although the run succeeded and proposal existed. This can confuse a pilot user after clicking start. | Move to Day2: add post-run polling or clearer terminal notice on WorkItem route. |
| D1-FB-002 | QA operator | `35fe1f6e-9db1-421e-9dae-3121c941b365` | `7ade705e-3438-4edb-9c56-349b80176f3e` | `2e4c85c8-9940-42e4-9e2f-c4e21a3625a1` | `day1-browser-capture-report.json` | backlog | P2 | The first Day1 browser script had a false negative because it parsed a stale `Submitted` notice for run id. It left one opened proposal artifact. Product data stayed intact; metrics raw counts intentionally show opened > reviewed. | Fixed in Day2: browser QA is resumable/idempotent and the stale proposal was formally rejected as a QA artifact. |
| D1-FB-003 | `S1 Day1 User 20260613075734` | `4afa12db-0a9a-448a-a0be-9bda4725c0e7` | `09b45408-6e19-4e79-bb98-68b6d953fcd8` | `1ea4dd8f-a466-45b4-b3d7-683a1dcf5544` | `07-proposal-merged-en-desktop.png` | surprise | P2 | Review reason gate preserved pending reason state, then approving cleared dirty state and hid write actions after merge. | Keep as positive evidence for no-data-loss gate. |
| D2-FB-001 | `S1 Day2 QA Fresh 202606131651` | `956fcccc-68a7-499c-beee-63706466faf9` | `1f1579ef-e2ac-4557-86c5-94fc072e2a25` | `2334968f-32b0-4229-bf6c-74ca3dca80c4` | `../2026-06-13-s1-day2-feedback-hardening/03-day2-post-run-clarity.png` | usability | P1 | After Day2 hardening, the WorkItem route exposes Proposal and Replay next actions after run completion and no longer shows duplicate start-run. Desktop/mobile audits report no overflow and no secret leak. | Fixed in Day2; keep as post-run clarity regression evidence. |
| D2-FB-002 | QA operator | `956fcccc-68a7-499c-beee-63706466faf9` | `1f1579ef-e2ac-4557-86c5-94fc072e2a25` | `2334968f-32b0-4229-bf6c-74ca3dca80c4` | `../2026-06-13-s1-day2-feedback-hardening/s1-day2-browser-dry-run-report.json` | backlog | P1 | The repo browser QA can resume from WorkItem/Run ids, ignores stale notices, and verifies it did not create a duplicate start-run/action artifact. | Fixed in Day2; use resume mode before re-running failed pilot browser checks. |
| D2-FB-003 | QA operator | `35fe1f6e-9db1-421e-9dae-3121c941b365` | `7ade705e-3438-4edb-9c56-349b80176f3e` | `2e4c85c8-9940-42e4-9e2f-c4e21a3625a1` | `../2026-06-13-s1-day2-feedback-hardening/s1-pilot-day2-metrics-snapshot.json` | backlog | P2 | The stale Day1 false-negative proposal was still opened with no reviews or accepted changes. It was rejected through the normal review API with reason feedback, so metrics now show `proposals_rejected: 1` instead of leaving a hanging opened artifact. | Fixed in Day2; do not merge QA-only deliverables. |
| D3-FB-001 | QA operator | `956fcccc-68a7-499c-beee-63706466faf9` | `1f1579ef-e2ac-4557-86c5-94fc072e2a25` | `2334968f-32b0-4229-bf6c-74ca3dca80c4` | `../2026-06-13-s1-day3-expansion-preflight/s1-day3-expansion-preflight-report.json` | backlog | P2 | Day3 preflight found that the Day2 browser QA proposal still needed a final review decision before inviting real users. It was rejected through the normal review API, leaving opened proposals `0` and preserving a review trail. | Fixed in Day3 preflight; keep `qa:s1-day3-preflight` as the invite-before gate. |

## Triage Rules

- blocker: prevents registration, intake, run, review, merge, replay, cost, or backup today; fix before the next invited user.
- usability: user can proceed but the route is confusing, stale, or too quiet; collect for Day2/S2 unless repeated by two users.
- surprise: AI did useful work or the UX reduced effort; preserve exact screenshot and quote.
- backlog: useful request or QA/tooling hardening that does not block Day1.
