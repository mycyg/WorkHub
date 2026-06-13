---
module: S1-pilot-day1-feedback-log
layer: 运营 / 反馈
status: active-template
owner: workflow
date: 2026-06-13
depends_on:
  - ../../../../06-roadmap/s1-pilot-day1-feedback-and-observability-plan-2026-06-13.md
---

# S1 Day 1 Feedback Log

## Template

| Field | Required | Notes |
|---|---:|---|
| Feedback ID | yes | `D1-FB-###` |
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
| D1-FB-002 | QA operator | `35fe1f6e-9db1-421e-9dae-3121c941b365` | `7ade705e-3438-4edb-9c56-349b80176f3e` | `2e4c85c8-9940-42e4-9e2f-c4e21a3625a1` | `day1-browser-capture-report.json` | backlog | P2 | The first Day1 browser script had a false negative because it parsed a stale `Submitted` notice for run id. It left one opened proposal artifact. Product data stayed intact; metrics raw counts intentionally show opened > reviewed. | Move to Day2: make browser QA idempotent/resumable and triage stale QA proposals before inviting more users. |
| D1-FB-003 | `S1 Day1 User 20260613075734` | `4afa12db-0a9a-448a-a0be-9bda4725c0e7` | `09b45408-6e19-4e79-bb98-68b6d953fcd8` | `1ea4dd8f-a466-45b4-b3d7-683a1dcf5544` | `07-proposal-merged-en-desktop.png` | surprise | P2 | Review reason gate preserved pending reason state, then approving cleared dirty state and hid write actions after merge. | Keep as positive evidence for no-data-loss gate. |

## Triage Rules

- blocker: prevents registration, intake, run, review, merge, replay, cost, or backup today; fix before the next invited user.
- usability: user can proceed but the route is confusing, stale, or too quiet; collect for Day2/S2 unless repeated by two users.
- surprise: AI did useful work or the UX reduced effort; preserve exact screenshot and quote.
- backlog: useful request or QA/tooling hardening that does not block Day1.
