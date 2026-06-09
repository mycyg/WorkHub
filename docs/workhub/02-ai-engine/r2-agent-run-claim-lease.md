---
module: P-AI / R2
layer: L2 worker concurrency
status: current
owner: workflow
related:
  - ./agent-loop-and-tools.md
  - ./r2-multi-worker-pump.md
  - ../06-roadmap/recovery-r0-r4-roadmap-2026-06-08.md
  - ../06-roadmap/review-driven-r0-r4-detailed-construction-plan-2026-06-08.md
  - ../01-architecture/data-model.md
---

# R2.1 AgentRun Claim / Lease

本切片把 `AgentRun` 从“进程内 queue 抢任务”推进到“PostgreSQL 行级 claim/lease”。目标是 R2 多 worker 的第一块地基：多个 API/worker 实例可以同时尝试 drain queue，但同一个 `agent_runs` row 只能被一个 worker claim。

## 1. 范围

已落范围：

| 项 | 行为 |
|---|---|
| DB 字段 | `agent_runs.claimed_by`、`claimed_at`、`heartbeat_at`、`lease_expires_at` |
| Claim | `claimQueued(run_id)` 与 `claimNextQueued()` 使用 transaction + `FOR UPDATE SKIP LOCKED` |
| Queue | `queue.run(id)` 和 `queue.runNext()` 在 DB persistence 支持 claim 时都必须先 claim |
| Heartbeat | 每次 AgentLoop step record 后用 `heartbeatClaim()` 续租；R2.5 起 running 期间也有 interval heartbeat |
| Recovery primitive | `requeueExpiredClaims()` 可把过期 `running` run 放回 `queued` |
| Tests | DB schema test 固定字段；API queue test 固定 by-id claim 与 next claim |

不在本切片：

| 项 | 后续 |
|---|---|
| 后台 drainer / active enqueue gate | R2.2 已由 [`r2-multi-worker-pump.md`](./r2-multi-worker-pump.md) 承接：route 触发 `runNext()` drain，同 work item active run 用 partial unique index 裁决 |
| 定时 heartbeat | R2.5 已增加 interval heartbeat，覆盖长 provider/LLM call 无 step 的窗口 |
| Redis/PG event broker | R2.3 已落 Redis PushBus / Presence v0；PG `LISTEN/NOTIFY` 仍预留 |
| Topic authorization 收口 | R2.4 收敛 `/api/push/stream` 全局 topic |
| 真实双 worker smoke | R2.5 在 PG service 上跑 `WORKHUB_WORKERS=2` full matrix；R2.2 已在 `qa:r1-pg-smoke` 增加 duplicate enqueue hook |

## 2. 数据契约

`agent_runs` 新增字段：

```text
claimed_by        varchar(128)  # worker instance id, e.g. host:pid or deployment instance id
claimed_at        timestamptz   # claim 成功时间
heartbeat_at      timestamptz   # 最近一次 worker 心跳
lease_expires_at  timestamptz   # 租约到期时间
```

索引：

```text
agent_runs_claim_idx(status, lease_expires_at, created_at)
agent_runs_claimed_by_idx(claimed_by)
```

字段语义：

| 状态 | Claim 字段 |
|---|---|
| `queued` | 正常应为空；stuck recovery 会清空后放回 queued |
| `running` | 必须有 `claimed_by/claimed_at/heartbeat_at/lease_expires_at` |
| terminal | 可保留最后 claim 信息作为审计事实，但不参与 active claim |

## 3. Repository Contract

`packages/db/src/repositories/agent-runs.ts` 暴露：

```ts
claimQueued(runId, claim): Promise<StoredAgentRunRows | null>
claimNextQueued(claim): Promise<StoredAgentRunRows | null>
heartbeatClaim(input): Promise<AgentRunRow | null>
requeueExpiredClaims(input): Promise<AgentRunRow[]>
```

`claimNextQueued()` 逻辑：

1. 开 transaction。
2. `SELECT id FROM agent_runs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`。
3. 找到候选后，在同一 transaction 内更新：
   - `status='running'`
   - `claimed_by=workerId`
   - `claimed_at=now`
   - `heartbeat_at=now`
   - `lease_expires_at=now+lease`
   - `started_at=claimed_at`
4. 返回 run + steps。

`claimQueued(runId)` 用同样语义处理指定 run。R2.2 后 route auto-pump 默认走 `queue.runNext()` drain；若其它调用方仍指定 `queue.run(run_id)`，也不能因为本进程内刚 enqueue 过就绕过 DB claim。

## 4. Worker Contract

`createInMemoryAgentRunQueue()` 仍保留名字和内存 fallback，但在 `persistence` 暴露 claim 方法时进入 DB claim 模式：

| Queue method | R2.1 行为 |
|---|---|
| `enqueue()` | R2.2 起在 DB persistence 下走 `createRunIfWorkItemIdle()`，由 `agent_runs_work_item_active_uq` 裁决同 work item active run；无 DB 时保留内存 fallback |
| `run(run_id)` | 先 `claimQueued(run_id)`；claim 失败返回 `agent_run_not_queued` |
| `runNext()` | 先 `claimNextQueued()`；没有可 claim run 返回 `null` |
| `recordStep()` | trace 写入后触发 `heartbeatClaim()` |
| `abort()` | 仍按 owner/admin gate 改 `cancelled`；R2.2 再补 running worker 中止协调 |

默认 worker id：

```text
${os.hostname()}:${process.pid}
```

默认 lease：

```text
5 minutes
```

测试可通过 `workerId` 与 `leaseMs` 注入确定性值。

## 5. Failure Semantics

| 场景 | 行为 |
|---|---|
| 两个 worker 同时 `runNext()` | 只有一个拿到 row；另一个跳过 locked row 或返回 null |
| 指定 `run(id)` 已被 claim | claim 返回 null，queue 抛 `agent_run_not_queued` |
| worker 崩溃 | row 留在 `running`，后续 `requeueExpiredClaims(expiredBefore)` 可回收 |
| heartbeat worker 不匹配 | `heartbeatClaim()` 返回 null，不续租 |
| terminal run | 不再进入 `listActive()` claim 路径 |

## 6. Code Map

| 文件 | 作用 |
|---|---|
| `packages/db/src/schema/core.ts` | `agent_runs` claim/lease 字段与索引 |
| `packages/db/migrations/0009_easy_morg.sql` | Drizzle migration |
| `packages/db/src/repositories/agent-runs.ts` | PG claim/heartbeat/requeue repository |
| `apps/api/src/services/agent-run-persistence.ts` | DB row 与 queue record 的 claim 字段映射 |
| `apps/api/src/workers/agent-runner.ts` | queue run/runNext claim gate 与 step heartbeat |
| `apps/api/src/agent-runs.test.ts` | by-id claim 与 next claim 单测 |
| `packages/db/src/schema.test.ts` | claim/lease 字段 schema drift test |

## 7. Acceptance

本切片完成时必须满足：

| Gate | 期望 |
|---|---|
| `@workhub/db typecheck` | 通过 |
| `@workhub/db test` | 通过，schema 字段固定 |
| `@workhub/api typecheck` | 通过 |
| `@workhub/api test` | 通过，新增 claim tests |
| `pnpm db:check` | Drizzle schema 与 migration meta 对齐 |
| `pnpm audit:migrations` | 无 runtime schema mutation |

R2.1 已完成 claim/lease；R2.2 已补 active enqueue gate 与 route `runNext()` drain；R2.3 已补 Redis broker/presence；R2.4 已补订阅权限；R2.5 已补长 provider call interval heartbeat 与真实 PG/Redis smoke。R2 剩余地基工作集中在 stuck-job 后台调度与 Proposal/审批 REST 权限全面收口。
