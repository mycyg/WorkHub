---
module: P-AI / R2
layer: L2 worker concurrency
status: current
owner: workflow
related:
  - ./agent-loop-and-tools.md
  - ./r2-agent-run-claim-lease.md
  - ../01-architecture/data-model.md
  - ../06-roadmap/recovery-r0-r4-roadmap-2026-06-08.md
  - ../06-roadmap/review-driven-r0-r4-detailed-construction-plan-2026-06-08.md
---

# R2.2 Multi-worker Pump / Active Run Gate

本切片关闭 R2 的第二个硬缺口：同一个 `work_item_id` 在多进程 / 多实例下不能被重复 enqueue 和重复执行。R2.1 已解决“一个 queued run 只能被一个 worker claim”；R2.2 解决“一个 work item 同时只能有一个 active run”以及“route 自动执行必须通过 claim pump，而不是指定本进程刚创建的 run”。

## 1. 已落范围

| 项 | 行为 |
|---|---|
| Active unique gate | `agent_runs_work_item_active_uq` 对 `work_item_id` 建 partial unique index，仅覆盖 `status in ('queued','running')` |
| Atomic enqueue | DB persistence 暴露 `createRunIfWorkItemIdle()`；insert 走 `ON CONFLICT (work_item_id) WHERE status in ('queued','running') DO NOTHING` |
| Queue fallback | 无 DB persistence 时继续使用 `startingWorkItems` 保护单进程；有 DB persistence 时它只作为本地缓存，不再是最终裁决 |
| Route pump | `POST /api/workitems/:id/agent-runs` 后台触发 `runNext()` drain；执行权仍由 PG claim 决定 |
| Multi-instance unit proof | 两个独立 queue 实例共享同一 persistence，并发 enqueue 同一 work item，只允许一个成功 |
| PG smoke hook | `qa:r1-pg-smoke` 增加 R2 专项 summary：`r2_multi_worker_enqueue` |

## 2. 不在本切片

| 项 | 后续 |
|---|---|
| 长 LLM call interval heartbeat | R2.5 已落：running 期间按 interval 续租，长时间无 step 的 provider call 不再只依赖 lease timeout |
| Dedicated worker daemon | 当前 route 触发 drain；后续可加独立 worker loop / process manager |
| Redis / PG event broker | R2.3 已落 Redis PushBus / Presence v0；PG `LISTEN/NOTIFY` 仍预留 |
| SSE topic hardening | R2.4 已落：`all` admin-only，资源 topic 默认 fail-closed，显式 resolver 才放行 |
| CI `WORKHUB_WORKERS=2` full matrix | R2.5 已新增 `r2-pg-redis-smoke`，覆盖真实 Postgres + Redis + long provider heartbeat |

## 3. Data Contract

新增索引：

```sql
CREATE UNIQUE INDEX "agent_runs_work_item_active_uq"
ON "agent_runs" USING btree ("work_item_id")
WHERE "agent_runs"."status" in ('queued', 'running');
```

语义：

| 状态 | 是否占用 work item active slot |
|---|---|
| `queued` | 是 |
| `running` | 是 |
| `succeeded` / `failed` / `escalated` / `cancelled` | 否 |

这意味着同一个 work item 可以有历史 run，但任何时刻只能有一个待执行或执行中的 run。若 running run 崩溃，先由 `requeueExpiredClaims()` 回收；回收后仍是 queued，因此仍占用 active slot，用户应继续同一 run，而不是创建第二个 run。

## 4. Repository / Persistence Contract

`packages/db/src/repositories/agent-runs.ts` 新增：

```ts
createRunIfWorkItemIdle(run): Promise<AgentRunRow | null>
```

行为：

1. 插入 queued run。
2. 若同一 `work_item_id` 已存在 queued/running run，partial unique index 命中，返回 `null`。
3. 调用方把 `null` 映射为业务错误 `409 agent_run_already_active`。
4. 其它 DB 错误仍按真实错误暴露给调用层，不伪装成业务冲突。

`apps/api/src/services/agent-run-persistence.ts` 映射为：

```ts
createRunIfWorkItemIdle(run): Promise<boolean>
```

## 5. Queue Contract

`createInMemoryAgentRunQueue()` 的名字仍保留，因为测试和无 DB fallback 仍用内存结构；但 DB persistence 存在时，enqueue 的最终 gate 是数据库。

| Queue path | DB persistence 存在 | DB persistence 不存在 |
|---|---|---|
| local active check | 只做快速本地缓存检查 | 主保护之一 |
| persisted active check | 先读一次，提供早失败 UX | 不适用 |
| create | `createRunIfWorkItemIdle()` 原子写入 | `createRun()` |
| duplicate result | `409 agent_run_already_active` | `409 agent_run_already_active` |

关键边界：两个实例都可能先通过 `listActive()`，甚至都完成预算计算；最终仍只有一个能 insert。预算计算不是副作用写入，允许重复发生；真正的 run 创建由 DB 唯一索引裁决。

## 6. Route Pump Contract

旧行为：

```ts
void queue.run(run.run_id)
```

问题：route 会直接执行“本请求刚创建的 run”，容易让调用者误以为执行权属于当前进程。

新行为：

```ts
void drainAutoRunQueue(queue)
```

`drainAutoRunQueue()` 循环调用 `queue.runNext()`，直到没有可 claim 的 queued run。执行权由 R2.1 的 `claimNextQueued()` 决定，因此多个实例同时 drain 时会自然分摊 queued rows。

## 7. Failure Semantics

| 场景 | 行为 |
|---|---|
| 两个实例同时 enqueue 同一 work item | 一个 202/fulfilled，一个 `409 agent_run_already_active` |
| 两个实例同时 drain queue | 每个实例通过 `FOR UPDATE SKIP LOCKED` claim 不同 run；没有 run 时返回 null |
| route enqueue 后别的实例先 claim | 当前 route drain 得到 null 或下一条 run；不影响已创建 run 的执行 |
| run 已 terminal | active unique slot 释放；可创建后续 run |
| stuck running | slot 不释放；必须先 recovery，不允许叠加第二个 run |

## 8. Code Map

| 文件 | 作用 |
|---|---|
| `packages/db/src/schema/core.ts` | `agent_runs_work_item_active_uq` partial unique index |
| `packages/db/migrations/0010_whole_sharon_carter.sql` | Drizzle migration |
| `packages/db/src/repositories/agent-runs.ts` | `createRunIfWorkItemIdle()` atomic insert |
| `apps/api/src/services/agent-run-persistence.ts` | persistence boolean wrapper |
| `apps/api/src/workers/agent-runner.ts` | DB create gate and fallback `startingWorkItems` behavior |
| `apps/api/src/routes/agent-runs.ts` | route auto-pump drains through `runNext()` |
| `apps/api/src/agent-runs.test.ts` | cross-queue duplicate enqueue test and route pump contract test |
| `apps/api/src/qa/r1-pg-agent-run-smoke.ts` | real PG duplicate enqueue smoke hook |

## 9. Acceptance

本切片完成时必须满足：

| Gate | 期望 |
|---|---|
| `@workhub/db typecheck` | 通过 |
| `@workhub/db test` | 通过 |
| `@workhub/api typecheck` | 通过 |
| `@workhub/api test` | 通过，新增 persistent duplicate enqueue 与 route `runNext()` tests |
| `pnpm db:check` | Drizzle schema 与 migration meta 对齐 |
| `pnpm audit:migrations` | 通过 |
| `pnpm verify` | 提交前通过 |
| `qa:r1-pg-smoke` | 在有 PostgreSQL 的环境中 summary 包含 `r2_multi_worker_enqueue.active_agent_runs=1` |

本地 2026-06-10 验证记录：`qa:r1-pg-smoke` 在当前 Windows 机因 `127.0.0.1:5432 ECONNREFUSED` 失败，原因是本机没有 PostgreSQL 服务；这不代表代码失败。GitHub Actions 的 `r1-pg-smoke` 容器 job 负责最终远端验收。
