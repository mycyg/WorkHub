---
module: S1-pilot-day1-feedback-and-observability
layer: 运营 / 观测 / Web
status: planned
owner: workflow
date: 2026-06-13
depends_on:
  - s1-pilot-day0-real-work-entry-plan-2026-06-13.md
  - ../05-clients/assets/audit/2026-06-13-s1-day0-real-work-entry/s1-pilot-day0-real-work-entry-report-2026-06-13.md
  - s1-pilot-week-runbook-2026-06-12.md
  - ../04-modules/dashboards-and-metrics.md
  - ../02-ai-engine/cost-governance.md
---

# S1 Day 1 Feedback and Observability Plan

## Goal

把 Day 0 的单人主持人闭环推进到 **受控 Day 1**：邀请 1-3 个真实使用者各提交 1-2 件真实数字工作，同时把反馈、成本、异常、采纳率和阻断 issue 的采集方式固定下来。

## Product Boundary

- 不新增业务模块。
- 不开桌宠/Cuu 新面。
- 不重做 agent 质量策略。
- 只修会阻断 Day 1 真实使用的问题：入口、权限、数据丢失、成本不可见、无法合并、无法回放。

## Work Packages

| ID | Scope | Deliverable |
|---|---|---|
| D1-1 Feedback intake | 给主持人一份最小反馈表字段，或者仓库内 markdown 记录模板：使用者、WorkItem、现象、截图、严重度、是否阻断。 | `s1-pilot-day1-feedback-log-<date>.md` 模板或 runbook 小节 |
| D1-2 Metrics snapshot | 固化每日查询口径：closed loop count、proposal adoption、escalation count、cost per merged item、conflict count、notification density。 | SQL/API/query notes + Day 1 baseline values |
| D1-3 Live ops checklist | 主持人每日 15 分钟操作：health/cost/approvals/replay/logs/backup。 | runbook 更新 |
| D1-4 Day 1 pilot dry run | 用真实用户或模拟第二用户跑 1 条非 Day0 真实任务；必须走 proposal review/merge/replay/cost。 | audit screenshot + DB ids |
| D1-5 Triage policy | 把反馈分为 blocker/usability/surprise/backlog，并规定 blocker 当天修、非 blocker 入 S2 backlog。 | runbook 更新 |

## Gates

| Gate | Must be true |
|---|---|
| G1 feedback log | 每条反馈能绑定 WorkItem/Proposal/Run 和截图；无敏感信息。 |
| G2 metrics | 至少能从 DB/API 取到当天六项指标，且和 Cost/Replay UI 对得上。 |
| G3 second-user path | 非 admin 使用者能注册、提交真实任务、看自己的 WorkItem；越权读写保持 fail-closed。 |
| G4 no data loss | Day 1 入口中的 intake 选项、自由文本、review reason 不被 SSE refresh 清空。 |
| G5 ops loop | 主持人能用 runbook 在 15 分钟内完成健康、成本、待审、异常日志扫描。 |
| G6 backup | Day 1 结束后再次 backup + restore dry check。 |

## Known Follow-ups From Day 0

- WorkItem run-start screenshot 在刚提交时还没有 proposal/replay link；Day 1 应观察 SSE/refresh 后链接是否自然出现，若使用者困惑，再补 post-run polling or clearer notice。
- Proposal 直审合并不会产生 `approval_requests` 行；指标口径要把 direct Proposal review/merge 计入 adoption，不要只看 approval center。
- Cost 页面现在有真实成本；若 `.env.pilot` 显式设置 provider cost 为 0，会覆盖默认值，主持人检查时要看 Cost 是否非零。

## Planned QA

1. `pnpm --filter @workhub/api test`
2. `pnpm --filter @workhub/web test`
3. `pnpm --filter @workhub/ui test`
4. `pnpm verify`
5. Browser screenshots for Day 1 user path: intake, workitem, proposal, replay, cost.
6. Docker compose dry QA and backup/restore.

## Exit

Day 1 全绿后，Pilot Week runbook 状态保持 `active-day1`，开始按每日节奏收集 1-3 人真实反馈；若 G2/G3/G4 任一失败，先修阻断再邀请更多人。
