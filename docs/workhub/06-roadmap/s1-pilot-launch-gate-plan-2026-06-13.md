---
module: S1-pilot-launch-gate
layer: 运营 / 部署 / QA
status: blocked-no-go
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
> 2026-06-13 执行结论：**NO-GO**。本机等价门通过，但真实 Docker compose / backup / operator loop 因本机无 Docker 且远端 SSH 在 KEX 前断开而未能完成。证据见 [`s1-pilot-launch-gate-report-2026-06-13.md`](../05-clients/assets/audit/2026-06-13-s1-pilot-launch-gate/s1-pilot-launch-gate-report-2026-06-13.md)。

## 1. 当前入口状态

截至 2026-06-13：

- R5.9 onboarding ✅
- R5.10-pre agent hardening ✅
- R5.10-dry ✅
- R5.10-real ✅：6 个真 provider AgentRun，T1–T4 质量全达标，T5 升级，B1 预算护栏，真实成本 `0.142346 CNY`
- R5.11/R5.11.1 deploy + sandbox libraries ✅
- R5.12 permission matrix ✅

系统代码已 pilot-ready；启动现场仍需可执行 Docker compose 的本机或远端环境。下一步只补部署运行时与 Launch Gate 真证据，不扩新模块。

## 2. Gate

| Gate | 必须为真 |
|---|---|
| G1 deploy stack | `docker compose --env-file .env.pilot -f docker-compose.pilot.yml` 起 API/Web/PG/Redis，health 全绿，migrations 已跑。 |
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

## 3.1 2026-06-13 执行记录

| Gate | 结果 | 说明 |
|---|---|---|
| G1 deploy stack | BLOCKED | 本机无 Docker/Colima/OrbStack/Podman；远端 `192.168.5.53` 的 `22/2222/22022/2022` 均在 SSH banner/KEX 前关闭连接，无法进入测试环境。 |
| G2 dry smoke | PASS（本机等价） | `pnpm qa:r5-10-dry` 通过，accepted deliverable download、usage、ledger、confidence 均留证。 |
| G3 real smoke | PASS（本机等价） | `R5_10_REAL_TASK_LIMIT=1 pnpm qa:r5-10-real` 通过，run `afbac902-389a-4022-ac89-8d431742fb87`，成本 `0.021664 CNY`。 |
| G4 backup | BLOCKED | `bash -n scripts/ops/backup-pg.sh` 通过；真实 `pg_dump` 依赖 compose postgres，受 G1 阻断。 |
| G5 secret hygiene | PASS（复扫后提交） | `.env.pilot` 未入库；报告/截图不写入 provider key、cookie、DB password。 |
| G6 operator loop | PARTIAL | 本机单源 API+Web 完成注册、关键页面、Cost/Settings 中英截图；compose 现场完整 loop 未完成。 |

本轮发现并修复 Cost Page VM 英文页“团队 AI 预算”漏翻译为团队月预算标签的问题，新增回归测试并通过 API test/typecheck。

## 4. 不做

- 不新增业务模块。
- 不做云部署或多租户。
- 不调模型路由策略。
- 不修改 R5.10 的评估结论；只验证部署现场可复现。

## 5. 验收产物

- `docs/workhub/05-clients/assets/audit/2026-06-13-s1-pilot-launch-gate/`
- `s1-pilot-launch-gate-report-2026-06-13.md`
- README / S1 roadmap / Pilot runbook 状态回写

## 6. 后续硬门

1. 先取得可执行 Docker compose 的环境：本机安装 Docker Desktop / Colima / OrbStack，或修复远端 Linux SSH + Docker。
2. 用真实 `.env.pilot` 运行 `docker compose --env-file .env.pilot -f docker-compose.pilot.yml up -d --build`。
3. 在部署现场复跑 dry / task-limit real smoke。
4. 备份写仓库外目录，并用 `-p workhub_restore` 独立 compose project 做 restore dry check。
5. 主持人按 runbook 完成真实 operator loop 后，再把本计划状态改为 `passed` 并启动 Pilot Week。
