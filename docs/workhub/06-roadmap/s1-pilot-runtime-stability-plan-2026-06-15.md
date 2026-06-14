---
module: S1-pilot-runtime-stability
layer: 运营 / 部署 / QA
status: completed
owner: engineering
date: 2026-06-15
depends_on:
  - s1-pilot-readiness-roadmap-2026-06-12.md
  - s1-pilot-day3-expansion-plan-2026-06-13.md
  - r5-11-pilot-deploy-package-plan-2026-06-12.md
---

# S1 Pilot Runtime Stability Plan

## 开工前阅读

- PRD: `docs/prd/2026-06-04-workhub-prd.md` 中 P-COLLAB / 去黑话 / pilot 闭环要求。
- 协作规格: `docs/workhub/03-collaboration/branch-proposal-merge.md`、`sync-and-spec.md`。
- 词汇宪法: `docs/workhub/00-overview/glossary-dejargon.md`。
- Pilot 路线: `s1-pilot-readiness-roadmap-2026-06-12.md`、`s1-pilot-day3-expansion-plan-2026-06-13.md`。
- 当前 P-COLLAB 计划: `r6-project-file-merge-collaboration-plan-2026-06-14.md`。
- 概念图: 本模块不改 UI，不存在新增页面概念图；只验证服务可用性与 pilot 运行稳定性。

## 事故与根因

2026-06-15 恢复 session 时发现 pilot compose 栈中 Postgres / Redis 仍在，但 `workhub-workhub-1` 已退出，`GET /api/health` 不可达。

容器日志首个错误为：

- Postgres 返回 `57P01 terminating connection due to administrator command`。
- `pg.Pool` 的 idle client `error` 事件无人监听。
- Node 对未监听的 `error` 事件执行默认抛出，API 进程退出。

这不是业务数据错误，而是运行时稳定性缺口：管理员重启 Postgres、compose recreate 或网络抖动都可能让 idle 连接报错；API 应记录告警并继续服务，不能让整个 pilot 守护进程退出。

## 修复范围

代码：

- `packages/db/src/client.ts`
  - `createPgPool()` 创建池后默认注册 `pool.on("error", handleIdlePoolError)`。
  - handler 输出 JSON warning：`service=workhub-db`、`event=pg_pool_idle_client_error`、错误 `name/message/code/severity`、可用时附 `process_id`。
  - 仅处理 idle client pool error；请求中的 query error 仍按原路径向调用者传播，不吞业务错误。
- `packages/db/src/client.test.ts`
  - 新增回归：`createPgPool()` 必须注册 1 个 `error` listener，避免 idle client error 再次成为进程级未捕获异常。
- `scripts/qa/r2-release-gate-report.ts`
  - 修复文档数检查的字符串误报：三位数文档计数不应被判为历史两位数旧计数；改为只匹配独立的旧计数。

不改：

- 不改 schema / migrations。
- 不改业务数据流、Proposal / merge / rebase 语义。
- 不改 UI / 双语文案 / 概念图。
- 不提交或引用 `reference/`。

## PRD 与数据流审视

- PRD 底线是"AI 改动不静默写生产态"，本修复不改变任何写路径，只让守护进程在数据库 idle 连接被关闭时保持可用。
- P-COLLAB 的采纳数据流仍为 `AgentRun -> Proposal -> Review -> Merge -> acceptedDeliverableChanges / projectDriveVersions`，本修复只位于 DB 连接池基础设施层。
- 去黑话与中英双语不受影响：本次新增日志是工程运维 JSON，不进入用户 UI。
- Pilot Day3 的前置要求是系统稳定可观测；恢复后 `workhub/postgres/redis` 三服务 healthy，`/api/health` ok。

## 验收

已执行：

```bash
pnpm --filter @workhub/db test
pnpm -r --if-present typecheck
docker compose --env-file .env.pilot -f docker-compose.pilot.yml up -d --build workhub
curl -fsS http://127.0.0.1:8787/api/health
docker compose --env-file .env.pilot -f docker-compose.pilot.yml ps
pnpm qa:r2-release-gate
pnpm verify
```

结果：

- DB package 16 tests passed。
- 全仓 typecheck passed。
- pilot 镜像重建成功；`workhub-postgres-1` / `workhub-redis-1` / `workhub-workhub-1` 均 healthy。
- health 返回 `{"ok":true,"service":"workhub-api","env":"development","runtime":"node","port":8787}`。
- `qa:r2-release-gate` passed：README 文档数 `158` 与实际 `158` 一致，stale R2.6 phrases 为 0。
- `pnpm verify` passed：typecheck、test、lint 全绿。

## 后续详细计划

1. **继续 Day3 invitation gate**：恢复服务后先复跑 Day3 preflight；若 opened proposal / active run / pending approval 仍为 0，再邀请 1-3 位真实使用者进入 `/intake`。
2. **补 pilot 长稳观察**：Day3 真实使用期间把 `pg_pool_idle_client_error` 当运维 warning 记录；若短时间内重复出现，回查 compose / Postgres recreate / 健康检查行为，不把它误判为业务失败。
3. **后续可观测增强**：如 pilot 周内再次发生服务退出，优先补 `process.on("uncaughtException")` / `unhandledRejection` 结构化日志与容器 restart policy 审计；该项暂不并入本修复，避免扩大运行时语义。
4. **P-COLLAB 下一模块**：当前 M2 base snapshot + rebase 恢复已落，下一步按 `r6-project-file-merge-collaboration-plan-2026-06-14.md` 数据驱动推进 `structuredRecord3WayDryRun()` 与去黑话审计，不在 Day3 邀人前强行开大改。

## 结论

本模块完成。pilot 的退出根因已闭环，服务已恢复；该修复符合 PRD 的可用性与可信运行要求，不改变用户面和协作语义。
