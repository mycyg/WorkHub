# R2.6 Recovery / REST Auth

> 状态: current
> 日期: 2026-06-10
> 范围: stuck AgentRun 后台恢复调度、Proposal/Approval REST 与 Page endpoint 的 WorkItem 资源权限收口。

---

## 1. 为什么要补

R2.1-R2.5 已把 AgentRun claim/lease、多 worker pump、Redis bus/presence、topic boundary、PG+Redis smoke 逐步补齐，但还留下两个生产风险：

| 风险 | R2.6 前状态 | R2.6 后状态 |
|---|---|---|
| worker 崩溃或进程退出后，`running` run 只存在 repository primitive，没有后台触发 | `requeueExpiredClaims()` 可手动调用 | API daemon 启动 periodic recovery scheduler，过期 claim 自动回 `queued` 并可继续 drain |
| Proposal/Approval REST 只校验登录或审批路由，可能绕过 WorkItem 可见性 | SSE topic 已 gate，REST 未全收口 | Proposal/Approval REST 与 `/api/pages/*` 统一经 WorkItemService detail gate |

R2.6 的目标不是做新 UI，而是把“AI 默认施工、多端只订资源流、用户只看该看的信息”的地基补到一致。

---

## 2. 代码落点

| 文件 | 变更 |
|---|---|
| `apps/api/src/workers/agent-runner.ts` | `AgentRunQueue.recoverExpiredClaims()` 调用 persistence primitive，刷新本地缓存，写 `agent_run.requeued_stale_claim` system audit |
| `apps/api/src/workers/agent-run-recovery.ts` | 新增 recovery scheduler，提供 `tick/start/stop/stats` |
| `apps/api/src/server.ts` | daemon 启动时 `start()` recovery scheduler；`SIGINT/SIGTERM` 时 stop |
| `packages/config/src/env.ts` | 新增 `AGENT_RUN_LEASE_MS`、`AGENT_RUN_HEARTBEAT_INTERVAL_MS`、`AGENT_RUN_RECOVERY_INTERVAL_MS` |
| `packages/db/src/repositories/proposals.ts` | 新增 `findProposalByMergeProposalId()`，用于 candidate endpoint 写前鉴权 |
| `apps/api/src/services/proposals.ts` | `ProposalService.getByMergeProposal()` |
| `apps/api/src/routes/proposals.ts` | Proposal create/list/get/review/merge/conflicts/choose/apply 全部经 WorkItemService gate |
| `apps/api/src/services/approvals.ts` | `ApprovalService.get()` 供 route 写前鉴权 |
| `apps/api/src/routes/approvals.ts` | approval list 按 WorkItem 可见性过滤；respond/delegate 写前 gate |
| `apps/api/src/routes/pages.ts` | `/api/pages/approvals` 和 `/api/pages/proposals/:id` 与 REST 同步 gate |

---

## 3. Recovery Contract

### 3.1 配置

```text
AGENT_RUN_LEASE_MS=300000
AGENT_RUN_HEARTBEAT_INTERVAL_MS=0      # 0 表示 queue 按 lease/3 自动推导
AGENT_RUN_RECOVERY_INTERVAL_MS=30000   # 0 表示禁用 daemon 后台 recovery
```

### 3.2 调度语义

1. `server.ts` 启动后创建默认 queue 与 scheduler。
2. scheduler 每 `AGENT_RUN_RECOVERY_INTERVAL_MS` 执行一次 `tick()`。
3. `tick()` 调用 `queue.recoverExpiredClaims()`。
4. queue 通过 `persistence.requeueExpiredClaims({ expiredBefore: now, requeuedAt: now })` 把过期 `running` run 改回 `queued`。
5. 每个恢复 run 写 audit：
   - `entity_type="agent_run"`
   - `action="agent_run.requeued_stale_claim"`
   - `detail_json.run_id/work_item_id/requeued_at`
6. 若恢复数量 > 0，scheduler 会调用 `runNext()` drain，让当前存活 worker 继续抢占执行。
7. scheduler 有并发保护：上一轮 `tick()` 未结束时，新 tick 返回 0，不重入。

### 3.3 不变量

| 不变量 | 说明 |
|---|---|
| lease 真相在 DB | 只有 repository 根据 `lease_expires_at < now` 改状态 |
| recovery 不跳过 queue claim | 恢复只是回 `queued`，真正执行仍走 `runNext()` 和 PG claim |
| audit 是系统行为 | actor 固定 `system / agent-run-recovery` |
| memory fallback 不宣称多 worker | 无 persistence 或无 `requeueExpiredClaims` 时返回空数组 |

---

## 4. REST / Page Auth Contract

### 4.1 Proposal

所有 Proposal 写前或读前都要先解析 WorkItem 并调用：

```ts
workItems.detailPage({ workItemId, actor })
```

覆盖端点：

| Endpoint | Gate source |
|---|---|
| `POST /api/workitems/:id/proposals` | path workItemId |
| `GET /api/workitems/:id/proposals` | path workItemId |
| `GET /api/workitems/:id/conflicts` | path workItemId |
| `GET /api/proposals/:id` | proposal.work_item_id |
| `POST /api/proposals/:id/review` | proposal.work_item_id |
| `POST /api/proposals/:id/merge` | proposal.work_item_id |
| `POST /api/merge-proposals/:id/choose` | mergeProposal -> proposal -> work_item_id |
| `POST /api/merge-proposals/:id/apply` | mergeProposal -> proposal -> work_item_id |
| `GET /api/pages/proposals/:id` | proposal.work_item_id |

`merge-proposals` 两个端点必须先通过 `ProposalService.getByMergeProposal()` 反查，不允许先写 `chosen_*` 或 apply 后再验权。

### 4.2 Approval

| Endpoint | 行为 |
|---|---|
| `GET /api/approvals` | 仍由 service 取“路由给当前用户 / admin 全部”的 pending 列表，route 再按 WorkItem 可见性过滤 requests/items/counts |
| `POST /api/approvals/:id/respond` | 先 `ApprovalService.get(id)`，再按 `work_item_id` gate，通过后才调用 `respond()` |
| `POST /api/approvals/:id/delegate` | 同 respond |
| `GET /api/pages/approvals` | 与 REST list 使用同一 WorkItem 可见性过滤语义 |

Approval 自身仍保留“只有 routed user 或 admin 能处理”的 service gate；R2.6 新增的是资源可见性 gate，两层同时成立才允许写。

---

## 5. 验收

本地已通过：

```powershell
corepack pnpm --filter @workhub/api typecheck
corepack pnpm --filter @workhub/api test
```

新增/更新测试点：

| 测试 | 证据 |
|---|---|
| AgentRun expired claim recovery | running + expired lease -> queued，claim 清空，写 `agent_run.requeued_stale_claim` audit |
| Recovery scheduler tick | 一次 tick 恢复 1 条并 drain 1 条，stats 计数正确 |
| Approval REST resource gate | list 过滤不可见 WorkItem；respond/delegate 对不可见 WorkItem 返回 403 |
| Proposal REST resource gate | create/list/read/review/merge 对不可见 WorkItem 返回 403 |
| 既有 Proposal candidate routes | route test 仍覆盖 conflicts、choose AI candidate、apply AI fusion artifact |

---

## 6. 剩余风险

| 风险 | 后续 |
|---|---|
| Release gate 漂移 | R2.7 已把 package scripts、CI smoke、文档口径、runtime 路径、diff check、reference discipline 和 secret-like diff count 收进 `pnpm qa:r2-release-gate` |
| Proposal/Approval 的“谁能 review/merge”仍是 WorkItem 可见性 + routed/admin 的 v0 规则 | R4 产品化时接完整 role/permission policy |
| scheduler stats 只在进程内，不是持久 metrics | R4/R5 接 dashboard metrics store |
| 多租户 org/workspace 仍依赖默认 auth actor 字段 | 多租户切片从 auth deps 传真实 org/workspace，并在 WorkItem gate 中验证 workspace |
| Redis pub/sub 非持久 | REST/DB 仍是真相源，SSE 仅触发 reconcile；云部署再评估 durable queue |

R2.7 完成后，R2 地基首版的验收入口已接入 `pnpm verify`；R3.1 已补 Cuu option-first Agent launcher 与真实 `sessions -> workitems -> agent-runs` API 链，下一步进入 R3.2 SSE 回流、失败态和真实 Tauri 点击截图。
