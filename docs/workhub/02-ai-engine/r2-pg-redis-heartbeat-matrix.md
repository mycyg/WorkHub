---
module: P-AI / P-PERM
layer: R2 multi-worker integration
status: current
owner: workflow
date: 2026-06-10
related:
  - ./agent-loop-and-tools.md
  - ./r2-agent-run-claim-lease.md
  - ./r2-multi-worker-pump.md
  - ./r2-redis-broker-presence.md
  - ./r2-topic-boundary.md
  - ../06-roadmap/recovery-r0-r4-roadmap-2026-06-08.md
  - ../06-roadmap/review-driven-r0-r4-detailed-construction-plan-2026-06-08.md
visuals:
  - ../05-clients/assets/shared/endpoint-page-cuu-alignment.png
---

# R2.5 PG + Redis Heartbeat Matrix

> R2.5 把 R2.1-R2.4 的单点能力接成真实集成门：AgentRun 运行期间即使卡在长 provider call 也会续租；Push route 默认接真实 WorkItem/Proposal resolver；CI 增加 Postgres + Redis service smoke，避免只靠 fake adapter 宣称跨 worker。

---

## 1. 开工前对齐

| 输入 | 结论 |
|---|---|
| [`r2-agent-run-claim-lease.md`](./r2-agent-run-claim-lease.md) | R2.1 只有 step 后 heartbeat；长 provider call 期间 lease 仍可能过期。 |
| [`r2-multi-worker-pump.md`](./r2-multi-worker-pump.md) | route 已经走 `runNext()` drain；R2.5 不改执行权，只补长调用续租。 |
| [`r2-redis-broker-presence.md`](./r2-redis-broker-presence.md) | fake Redis 单测已固定 adapter 语义；R2.5 必须加真实 Redis service smoke。 |
| [`r2-topic-boundary.md`](./r2-topic-boundary.md) | 资源 topic 默认 fail-closed；R2.5 接真实 WorkItem/Proposal resolver。 |
| Cuu/Web 概念图 | Cuu/Web 都走同一 endpoint 与权限边界；本切片不改 UI，只保证事件和权限地基可靠。 |

---

## 2. 已落范围

| 项 | 行为 |
|---|---|
| 长调用 heartbeat | `createInMemoryAgentRunQueue()` 新增 `heartbeatIntervalMs`；运行中每隔一段时间调用 `heartbeatClaim()`，覆盖 provider/tool 长耗时窗口。 |
| 默认 interval | 未显式配置时为 `min(30s, leaseMs/3)` 且不低于 1s；默认 5 分钟 lease 下为 30s。 |
| 停止语义 | `executeRun()` 进入 running 后启动 interval；terminal、失败、取消 drift 后 `finally` 停止 timer。 |
| step heartbeat | 保留原有 record step 后 heartbeat；interval 与 step heartbeat 共用同一 `heartbeatClaim()` 路径。 |
| WorkItem topic resolver | 默认 `createPushRoutes()` 可用 `WorkItemService.detailPage({ actor })` 判 `canViewWorkItem`。 |
| Session topic resolver | v0 中 session id 等同澄清 work item id，默认复用 `WorkItemService.detailPage()`。 |
| Proposal topic resolver | 默认 `ProposalService.get(proposalId)` 取 `work_item_id`，再复用 WorkItem 权限判定。 |
| Fail-closed 注入 | 测试/嵌入场景可传 `workItems:false` / `proposals:false`，保持资源 topic 403，不隐式连 DB。 |
| CI service matrix | 新增 `.github/workflows/verify.yml` job `r2-pg-redis-smoke`，同时启动 Postgres 16 与 Redis 7。 |

---

## 3. Runtime Contract

### 3.1 AgentRun heartbeat

```ts
createInMemoryAgentRunQueue({
  persistence,
  workerId: "worker-a",
  leaseMs: 300_000,
  heartbeatIntervalMs: 30_000
});
```

运行期规则：

1. run 必须先通过 `claimQueued()` 或 `claimNextQueued()` 进入 `running`。
2. `executeRun()` 在 provider client、tool execution、manifest/proposal 写入期间都维持 interval heartbeat。
3. `heartbeatClaim()` 只更新 `status='running' AND claimed_by=workerId` 的 row。
4. 如果用户取消 run，或其它路径把 run 置为 terminal，下一次 heartbeat 返回 `null`，本地不再刷新 claim。
5. `finally` 清理 interval，避免空闲进程残留 timer。

### 3.2 Topic resolver

默认 route 行为：

| endpoint | 默认 resolver |
|---|---|
| `GET /api/push/stream/workitem/:id` | `WorkItemService.detailPage({ workItemId:id, actor })` 成功才订阅。 |
| `GET /api/push/stream/req/:id` | legacy alias，走同一 WorkItem gate。 |
| `GET /api/push/stream/session/:id` | v0 复用 WorkItem gate。 |
| `GET /api/push/stream/proposal/:id` | `ProposalService.get(id)` -> `work_item_id` -> WorkItem gate。 |
| `GET /api/push/stream/run/:id` | 仍由 AgentRun actor/admin gate 处理。 |
| `GET /api/push/stream` | R2.4 已定为 admin-only。 |

`StreamUser` 转 `AuthActor` 时只提供权限判定所需字段：`id/userId/isAdmin/label`；WorkItem 权限当前只依赖这些字段。后续 Org/Workspace 多租户上线时，必须把真实 `orgId/workspaceId` 从 auth deps 传入，而不是继续使用占位值。

---

## 4. CI Smoke

新增脚本：

```text
apps/api/src/qa/r2-pg-redis-smoke.ts
pnpm qa:r2-pg-redis-smoke
```

CI 环境：

```text
APP_ENV=development
DATABASE_URL=postgresql+psycopg://workhub:workhub@127.0.0.1:5432/workhub
BROKER_BACKEND=redis
BROKER_URL=redis://127.0.0.1:6379
WORKER_COUNT=2
```

覆盖场景：

| 场景 | 验收 |
|---|---|
| Redis broker | `RedisPushBus A` publish，`RedisPushBus B` subscription 收到 `r2.smoke`。 |
| Redis presence | `RedisPresenceStore A.markStreamOpen(user)` 后，`RedisPresenceStore B.getPresence(user).is_online === true`。 |
| 真实 WorkItem topic auth | owner 订 `/api/push/stream/workitem/:id` 得 SSE 200；stranger 得 403。 |
| PG long provider heartbeat | queue claim 后 client 阻塞；DB `agent_runs.heartbeat_at > claimed_at` 后释放 provider，run 最终 succeeded。 |
| 秘钥输出 | summary 中 `DATABASE_URL` 密码脱敏。 |

---

## 5. 文件落点

| 文件 | 变更 |
|---|---|
| `apps/api/src/workers/agent-runner.ts` | 增加 `heartbeatIntervalMs` 与 running interval heartbeat。 |
| `apps/api/src/agent-runs.test.ts` | 新增长 provider call 期间续租单测。 |
| `apps/api/src/routes/push.ts` | 默认接 WorkItem/Session/Proposal resource resolver；支持 `false` 显式 fail-closed。 |
| `apps/api/src/push.test.ts` | 新增默认 resolver workitem/session/proposal owner/stranger 测试。 |
| `apps/api/src/qa/r2-pg-redis-smoke.ts` | 新增真实 Postgres + Redis smoke。 |
| `.github/workflows/verify.yml` | 新增 `r2-pg-redis-smoke` job。 |
| `package.json` / `apps/api/package.json` | 新增 `qa:r2-pg-redis-smoke` script。 |

---

## 6. 验收证据

本地已通过：

- `corepack pnpm --filter @workhub/api test`：96/96。
- `corepack pnpm --filter @workhub/api typecheck`。

提交前还必须通过：

- `corepack pnpm verify`。
- `git diff --check`。
- `docs/workhub` markdown 数量与 README 一致。
- `reference_paths=0`。
- `secret_like_matches=0`。

CI 必须通过：

- `workspace`。
- `r1-pg-smoke`。
- `r2-pg-redis-smoke`。
- `migration-placeholder`。

---

## 7. 剩余风险与下一步

| 风险 | 当前处理 | 后续 |
|---|---|---|
| Stuck-job recovery 曾停在 primitive | R2.6 已加 periodic requeue、进程内 stats 与 `agent_run.requeued_stale_claim` audit；R2.7 已纳入 release gate | R4/R5 接 dashboard metrics store。 |
| R2.5 前 Proposal route 尚未统一 actor-based read gate | R2.6 已把 Proposal REST/Page 与 Approval REST/Page 全部接 WorkItem gate | R4 接完整角色/策略化 review/merge 权限。 |
| CORS/cookie、revert、escalation 仍在 R1/R0 其它 smoke 分散覆盖 | R2.5 新增核心 PG+Redis+heartbeat matrix；R2.7 已检查 `workspace`、`r1-pg-smoke`、`r2-pg-redis-smoke` 持续接线 | 后续如新增 R3/R4 smoke，同步扩展 release gate。 |
| Org/Workspace 多租户未上线 | `streamActor()` 使用最小权限字段 | 多租户切片必须从 auth deps 传真实 org/workspace。 |
| Redis pub/sub 非持久 | REST/DB 仍是真相源，SSE 只触发 reconcile | R4 页面保持 reconcile，云部署再评估 durable queue。 |

R2.5 后的 R2.6 已补 stuck-job 后台调度与 Proposal/审批 REST 权限全面收口，详见 [`r2-recovery-rest-auth.md`](./r2-recovery-rest-auth.md)。R2.7 已把 release gate 接入 `pnpm verify`，详见 [`r2-release-gate.md`](./r2-release-gate.md)。下一步进入 R3 Cuu 出站 Agent 入口。
