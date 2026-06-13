---
module: S1-pilot-day3-expansion
layer: 运营 / Pilot
status: planned
owner: workflow
date: 2026-06-13
depends_on:
  - s1-pilot-day2-feedback-hardening-plan-2026-06-13.md
  - ../05-clients/assets/audit/2026-06-13-s1-day2-feedback-hardening/s1-pilot-day2-feedback-hardening-report-2026-06-13.md
---

# S1 Day 3 Expansion Plan

## Goal

在 Day2 修掉已知摩擦后，把 Pilot Week 从受控 QA/第二用户路径扩大到 1-3 个真实使用者。每个使用者提交 1 件当天真实要完成的工作，主持人只观察、记录和帮忙恢复，不新增业务模块。

## Preconditions

- Day2 post-run WorkItem clarity PASS。
- Day2 browser QA resume/idempotency PASS。
- Day1 stale proposal artifact 已通过正式 review API 打回。
- Day2 metrics gates 全 true，backup + isolated restore dry check 通过。

## Work Packages

| ID | Scope | Deliverable |
|---|---|---|
| D3-1 User onboarding | 邀请 1-3 位真实使用者，用昵称注册；主持人记录昵称与任务主题，不记录密钥/私人内容。 | participant checklist |
| D3-2 Real task intake | 每人通过 `/intake` 提交 1 件真实工作，优先文档/方案/表格这类低风险交付。 | WorkItem ids |
| D3-3 Closed-loop observation | 跑 AgentRun，用户从 WorkItem 进入 Proposal/Replay；能 merge 的合并，不能 merge 的用 reason 打回。 | Run/Proposal/Replay evidence |
| D3-4 Feedback capture | 每条反馈写入 S1 feedback log，绑定 WorkItem/Run/Proposal/截图。 | `D3-FB-*` entries |
| D3-5 Metrics delta | 记录 Day3 六指标，比较 Day2 baseline。重点看采纳率、打扰密度、每件成本。 | metrics JSON |
| D3-6 Ops safety | Day3 结束 backup + isolated restore dry check；只修 blocker。 | backup path + restore query |

## Gates

| Gate | Must be true |
|---|---|
| G1 real users observed | 至少 1 位真实使用者完成从 `/intake` 到 WorkItem 的路径。 |
| G2 next action visible | 每个 terminal run 的 WorkItem 在 10 秒内显示 Proposal/Replay 或明确刷新动作。 |
| G3 no duplicate artifacts | QA 或人工恢复必须使用 resume ids，不重复造 WorkItem/Run/Proposal。 |
| G4 review decision recorded | 每个 Proposal 最终 merged 或 rejected，不能留下不明原因 opened artifact。 |
| G5 metrics comparable | Day3 metrics JSON 与 Day2 baseline 同口径，gates 全 true 或注明阻断原因。 |
| G6 backup restored | Day3 backup 可在隔离 restore project 中查询关键 WorkItem/Proposal/Run。 |

## QA

1. Fresh real-user browser path for each participant.
2. Resume QA for any failed or interrupted run:
   `S1_DAY2_WORKITEM_ID=<id> S1_DAY2_RUN_ID=<id> pnpm --filter @workhub/web qa:s1-day2-browser`
3. `S1_DAY1_REQUIRE_GATES=1 pnpm --filter @workhub/api qa:s1-day1-metrics`
4. Backup + isolated restore dry check.
5. Targeted tests only for blocker fixes; full `pnpm verify` before committing code changes.

## Non-Goals

- 不新增业务模块。
- 不把桌宠/Cuu 放进主 Web 窗口。
- 不为“想要但不阻断”的反馈当天改功能。
- 不提交 `reference/`。

## Exit

Day3 结束时产出一份 expansion report：参与者数、真实 WorkItem/Run/Proposal、合并/打回结果、六指标 delta、反馈 Top 3、backup/restore 证据，以及 Day4 继续扩大或暂停修 blocker 的建议。
