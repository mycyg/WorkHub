---
module: S1-pilot-launch-gate
layer: 运营 / 部署 / QA
status: planned
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

> 开工前已读：S1 roadmap、Pilot Week runbook、R5.10 real-key 竣工记录、Pilot deploy package、权限矩阵审计。当前不新增功能面；目标是把“系统 pilot-ready”转成“部署现场可启动”。

## 1. 当前入口状态

截至 2026-06-13：

- R5.9 onboarding ✅
- R5.10-pre agent hardening ✅
- R5.10-dry ✅
- R5.10-real ✅：6 个真 provider AgentRun，T1–T4 质量全达标，T5 升级，B1 预算护栏，真实成本 `0.142346 CNY`
- R5.11/R5.11.1 deploy + sandbox libraries ✅
- R5.12 permission matrix ✅

系统已 pilot-ready；下一步只做启动前核验，不扩新模块。

## 2. Gate

| Gate | 必须为真 |
|---|---|
| G1 deploy stack | `docker compose -f docker-compose.pilot.yml` 起 API/Web/PG/Redis，health 全绿，migrations 已跑。 |
| G2 dry smoke | 部署现场 `pnpm qa:r5-10-dry` 或等价容器内 dry smoke 通过。 |
| G3 real smoke | 部署现场 `R5_10_REAL_TASK_LIMIT=1 pnpm qa:r5-10-real` 通过，证明 key、provider、tool schema、ledger 都可用。 |
| G4 backup | `scripts/ops/backup-pg.sh` 成功并能列出备份产物。 |
| G5 secret hygiene | `.env.pilot` 不入 git；报告、日志、截图无 `LLM_API_KEY`、Cookie、DB password。 |
| G6 operator loop | 主持人能按 runbook 完成：注册 admin、建项目、提一个真实任务、审批、合并、回放、看成本。 |

## 3. 施工顺序

1. 复跑本机 `pnpm verify` 与密钥/reference 扫描，确认 main 基线干净。
2. 用 pilot compose 起一套本机部署栈。
3. 在部署栈或等价本机环境跑 G2/G3。
4. 做一次备份/恢复 dry check（不破坏当前库）。
5. 形成 `s1-pilot-launch-gate-report-2026-06-13.md`，列出 go/no-go 与剩余人工输入。
6. 若 Gate 全绿，进入 S1 Pilot Week；若某 Gate 红，先修阻断 bug，不开新功能面。

## 4. 不做

- 不新增业务模块。
- 不做云部署或多租户。
- 不调模型路由策略。
- 不修改 R5.10 的评估结论；只验证部署现场可复现。

## 5. 验收产物

- `docs/workhub/05-clients/assets/audit/2026-06-13-s1-pilot-launch-gate/`
- `s1-pilot-launch-gate-report-2026-06-13.md`
- README / S1 roadmap / Pilot runbook 状态回写
