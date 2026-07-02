---
module: S1-pilot-day0-real-work-entry
layer: 运营 / Web / Agent
status: pass
owner: workflow
date: 2026-06-13
depends_on:
  - s1-pilot-launch-gate-plan-2026-06-13.md
  - s1-pilot-week-runbook-2026-06-12.md
  - ../04-modules/requirements-workitem.md
  - ../04-modules/projects-and-drive.md
  - ../05-clients/web-app.md
  - ../05-clients/page-concepts.md
---

# S1 Day 0 Real Work Entry Plan

> 开工前必读：PRD、brainstorm、`requirements-workitem.md`、`projects-and-drive.md`、`web-app.md`、`page-concepts.md`、Launch Gate 报告与 Pilot Week runbook。
> 背景：Launch Gate 已证明 compose / provider / ledger / backup / 双语关键页可用；本轮 Browser 审查同时发现 fresh pilot 稳定页不应暴露旧 smoke seed detail 链接，已修复。Day 0 的目标是把“主持人能用真实工作开始”从 QA 脚本推进到可见 Web 操作闭环。
> 2026-06-13 竣工：Day 0 真实入口已 **PASS**。详见验收报告 [`s1-pilot-day0-real-work-entry-report-2026-06-13.md`](../05-clients/assets/audit/2026-06-13-s1-day0-real-work-entry/s1-pilot-day0-real-work-entry-report-2026-06-13.md)。

## 1. 目标

让主持人在同一套 pilot compose 栈里完成一条可见真实闭环：

1. 创建或选择一个真实项目/工作上下文。
2. 从 Web 进入 option-first intake，提交一件真实待办。
3. 触发/观察 AgentRun。
4. 在 Proposal / Approvals 中审批或合并。
5. 打开 Replay 与 Cost，确认审计和成本入账。
6. 截图留证，中英双语至少覆盖 Cost / Settings / Intake 成功态。

## 2. 当前事实

- ✅ Docker compose Launch Gate 已通过。
- ✅ 部署容器 dry/real smoke 已证明数据闭环。
- ✅ Web shell 稳定页不再暴露 `r4-live-*` 旧 seed detail 链接。
- ⚠️ `/intake` 目前是受控空态；真实用户从 UI 发起第一件工作还需要 Day 0 入口硬化。
- ⚠️ Pilot Week runbook 里的“建 1-2 个真实项目”需要明确 UI 或主持人脚本路径。

## 3. 施工范围

| 项 | 必须完成 |
|---|---|
| D0-1 Project seed | 给主持人一个安全入口：最小 UI、管理页动作，或明确的仓库内脚本，用于创建/选择 pilot 项目；不得依赖旧 smoke fixture。 |
| D0-2 Intake start | `/intake` 不能只是空态；要能开始真实 session 或给出唯一明确的开始动作。 |
| D0-3 Visible work loop | 从 Web 页面创建 WorkItem 后，能看到 work item/proposal/replay/cost 的真实链接。 |
| D0-4 Approval path | 若 proposal 可自动生成，审批/合并必须保留人类 reason gate / merge 审计；若需要等待 agent，则页面给出清晰状态。 |
| D0-5 Evidence | Browser 截图覆盖 desktop + mobile 关键屏；截图不含密钥，主窗无 Cuu。 |
| D0-6 Docs | 回写 Pilot Week runbook：主持人 Day 0 使用 UI 还是脚本、每一步在哪看结果。 |

## 4. 不做

- 不引入 OAuth/密码登录。
- 不做多租户/公网部署。
- 不扩 Drive/Meeting/Schedule 新功能。
- 不把桌宠/Cuu 放进 Web 主窗。
- 不重新评估 R5.10 6-run 质量结论。

## 5. Gate

| Gate | 必须为真 |
|---|---|
| G1 project context | fresh compose 库里，主持人能创建或选择真实 pilot 项目；无旧 seed ID。 |
| G2 intake entry | `/intake` 或明确按钮能启动真实 session；无 500；空态只在无权限/无项目时出现并给出下一步。 |
| G3 work item | Browser 可见新 WorkItem detail，title/summary/status 与提交内容一致。 |
| G4 agent/proposal | 至少一条真实 AgentRun 生成 proposal，或用可解释升级阻塞；不得假成功。 |
| G5 approval/merge/replay | 审批/合并后 Replay 可打开，accepted ledger / download sha / audit 可追。 |
| G6 cost/i18n | Cost 页面显示本次 run 成本；zh-CN/en-US 无混文、无文本溢出。 |
| G7 backup after Day0 | Day 0 数据再次 backup + restore dry check 成功。 |

## 6. 建议施工顺序

1. 复读本计划依赖文档和概念图，确认 Day 0 不引入新产品面。
2. 先查数据库/service 是否已有默认 workspace/project 创建 API；优先复用现有 auth/workitem/drive service。
3. 给 `/intake` 增加真实开始路径，或在 Home 空态放一个可审计的“开始派活”动作。
4. 用 Browser 完整跑主持人路径，截图到新的 Day 0 audit 目录。
5. 跑 `pnpm --filter @workhub/web test`、相关 API tests、compose dry/real task-limit、backup/restore。
6. 更新 runbook 与 roadmap，把 Day 0 结论写回。
7. 提交并推送 main。

## 7. 完成后的后续

Day 0 若全绿，Pilot Week runbook 状态从 `ready-after-launch-gate` 推进为 `active-day1`，开始邀请真实使用者；若任一 Gate 红，先修阻断，不开多人试运行。

## 8. 竣工记录（2026-06-13）

| Gate | 结果 | 证据 |
|---|---|---|
| G1 project context | PASS | `/intake` Day 0 start card 创建/复用真实 pilot project context；无 `r4-live-*` seed。 |
| G2 intake entry | PASS | Session `cf6396b7-a1d0-4084-bcfe-b7a698a81085`，option-first，desktop/mobile 截图通过。 |
| G3 work item | PASS | WorkItem `DAY0PILOT-006` 可见，真实 task summary 与验收项进入 detail。 |
| G4 agent/proposal | PASS | AgentRun `3bb9bd88-85e7-4f4e-bb26-f8ebcff5eb77` succeeded，Proposal `2cff8131-400f-4a19-9dd6-01a5daa06e9c` opened。 |
| G5 approval/merge/replay | PASS | Proposal reviewed + merged，Replay 显示 17 steps / 1 accepted deliverable / 2 snapshots。 |
| G6 cost/i18n | PASS | 本次 run cost `0.028870` CNY；Cost 页面总成本非零；Web 主窗 en-US 截图无 Cuu。 |
| G7 backup after Day0 | PASS | Backup `/private/tmp/workhub-backups/workhub-20260613-151604.sql.gz`，独立 restore dry check 通过。 |

### 实施摘要

- 新增 Project bootstrap contract/repository/service/route/API client，`/intake` 无 session 时显示 Day 0 真实项目入口。
- Web runtime 增加 project bootstrap 与 start AgentRun action parsing；Browser dispatcher 串起 project -> session -> workitem -> run。
- AgentRun 执行前注入 DB-backed WorkItem context，修复真实工单只给 `work_item_id` 导致 worker 误判空任务的问题。
- Proposal action 按 status 收口：`opened` 只允许 approve/request changes，`reviewed` 才 merge，`merged` 隐藏写动作。
- DeepSeek provider 默认成本从 `0/0` 修正为 `2/8` CNY per MTok，并加配置测试。

### 后续

进入 [`s1-pilot-day1-feedback-and-observability-plan-2026-06-13.md`](./s1-pilot-day1-feedback-and-observability-plan-2026-06-13.md)，保持 Pilot Week `active-day1`，先固化反馈与指标采集，不扩业务面。
