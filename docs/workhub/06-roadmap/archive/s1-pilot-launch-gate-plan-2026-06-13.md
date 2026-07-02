---
module: S1-pilot-launch-gate
layer: 运营 / 部署 / QA
status: passed
owner: workflow
date: 2026-06-13
depends_on:
  - s1-pilot-readiness-roadmap-2026-06-12.md
  - s1-pilot-week-runbook-2026-06-12.md
  - r5-10-real-key-evaluation-run-plan-2026-06-13.md
  - r5-11-pilot-deploy-package-plan-2026-06-12.md
  - r5-12-permission-matrix-audit-plan-2026-06-12.md
---

# S1 Pilot Launch Gate Plan（R5.10-real 之后）

> 开工前已读：S1 roadmap、Pilot Week runbook、R5.10 real-key 竣工记录、Pilot deploy package、权限矩阵审计、PRD/brainstorm、Web 概念图与 Settings/Cost 边界图。
> 2026-06-13 执行结论：**PASS**。首轮 NO-GO 是本机无 Docker / 远端 SSH 阻断；随后已安装 Docker Desktop，在真实 pilot compose 栈完成 G1-G6。证据见 [`s1-pilot-launch-gate-report-2026-06-13.md`](../05-clients/assets/audit/2026-06-13-s1-pilot-launch-gate/s1-pilot-launch-gate-report-2026-06-13.md)。

## 1. 当前入口状态

截至 2026-06-13：

- R5.9 onboarding ✅
- R5.10-pre agent hardening ✅
- R5.10-dry ✅
- R5.10-real ✅：6 个真 provider AgentRun，T1-T4 质量全达标，T5 升级，B1 预算护栏，真实成本 `0.142346 CNY`
- R5.11/R5.11.1 deploy + sandbox libraries ✅
- R5.12 permission matrix ✅
- S1 Launch Gate ✅：Docker Desktop + `docker-compose.pilot.yml` 现场起栈，dry/real、backup/restore、Browser UI/i18n/secret gate 全过

系统已从“代码 pilot-ready”推进到“受控 Day 0 可启动”。下一步不是扩新模块，而是按 Day 0 计划把真实工作入口和主持人可见闭环做扎实。

## 2. Gate

| Gate | 结果 | 证据 |
|---|---|---|
| G1 deploy stack | ✅ | `docker compose --env-file .env.pilot -f docker-compose.pilot.yml up -d --build` 成功；workhub/postgres/redis healthy；`/api/health` ok。 |
| G2 dry smoke | ✅ | 部署容器内 `pnpm qa:r5-10-dry` 通过；修复后 run `17132ee8-c13a-4fde-a030-426e357f7327`。 |
| G3 real smoke | ✅ | 部署容器内 `R5_10_REAL_TASK_LIMIT=1 pnpm qa:r5-10-real` 通过；run `c49c6067-0879-449c-9260-8cd0687353bb`，成本 `0.019976 CNY`。 |
| G4 backup | ✅ | `/private/tmp/workhub-backups/workhub-20260613-025228.sql.gz` 写出；独立 `workhub_restore` project 恢复后关键表非空。 |
| G5 secret hygiene | ✅ | `.env.pilot` 不入库；报告/截图不含 provider key、cookie、DB password。 |
| G6 operator loop | ✅ | Browser 完成 admin 认领、Cost/Settings 中英切换、fresh pilot 导航复验；dry/real 覆盖数据闭环。 |

## 3. 本轮发现与修复

### Fresh Pilot Shell 旧 Seed 链接

真实 compose Browser 审查发现稳定页导航仍暴露 `r4-live-*` smoke seed detail 链接。fresh pilot 库没有这些记录，点击 `/intake/r4-live-session` 会触发 500。

修复：

- `apps/web/src/routes.ts`：intake/workitem/proposal/replay 改为 detail-only shell page，只在当前 route 是对应真实记录时显示；稳定页导航不再暴露旧 seed。
- `apps/web/src/routes.test.ts`：新增 S1 guard，断言稳定页不包含 `r4-live-*`。

验证：

- `pnpm --filter @workhub/web test`：27 tests passed。
- 重建 compose 后 Browser 复查：稳定页 nav `hasR4Seed=false`，`/intake` 为受控空态而非旧 seed 500。

## 4. 验收产物

- [`../05-clients/assets/audit/2026-06-13-s1-pilot-launch-gate/`](../05-clients/assets/audit/2026-06-13-s1-pilot-launch-gate/)
- `06-compose-register.png` 到 `12-compose-intake-empty-en.png`
- `s1-pilot-launch-gate-report-2026-06-13.md`
- 新后续计划：[`s1-pilot-day0-real-work-entry-plan-2026-06-13.md`](./s1-pilot-day0-real-work-entry-plan-2026-06-13.md)

## 5. 不做

- 不把 Day 0 直接扩大为多人 pilot week。
- 不新增业务模块。
- 不做云部署或多租户。
- 不调模型路由策略。

## 6. 下一步

Launch Gate 已完成，施工顺序切到 **S1 Day 0 Real Work Entry**：

1. 补齐真实用户从 UI 发起工作 / 项目种子的受控入口。
2. 在现有 compose 栈跑主持人可见闭环：提交 → agent run → proposal → approval/merge → replay → cost。
3. Day 0 全绿后，再按 Pilot Week runbook 邀请真实使用者进入一周试运行。
