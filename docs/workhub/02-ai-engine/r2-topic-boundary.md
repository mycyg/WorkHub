---
module: P-AI / P-PERM
layer: R2 multi-worker / SSE authorization
status: current
owner: workflow
date: 2026-06-10
related:
  - ./r2-redis-broker-presence.md
  - ../01-architecture/api-contract.md
  - ../01-architecture/security-and-permissions.md
  - ../06-roadmap/recovery-r0-r4-roadmap-2026-06-08.md
  - ../06-roadmap/review-driven-r0-r4-detailed-construction-plan-2026-06-08.md
visuals:
  - ../05-clients/assets/shared/endpoint-page-cuu-alignment.png
---

# R2.4 Topic Boundary

> R2.4 的目标是把 SSE topic 从“能连上就订”收口成明确的授权边界。R2.3 解决跨 worker 不丢事件；R2.4 解决事件到了之后不能泄漏给不该看的人。

---

## 1. 开工前对齐

| 输入 | 结论 |
|---|---|
| [`api-contract.md §5.3`](../01-architecture/api-contract.md#53-topic-隔离与隐私nfr-08沿用真实修复) | topic 是安全边界；新增事件先判私有性。 |
| [`security-and-permissions.md §7.4`](../01-architecture/security-and-permissions.md#74-私有事件按身份隔离nfr-08) | 私有 topic 订阅前必须 `can_view`；事件载荷不夹带越权字段。 |
| [`r2-redis-broker-presence.md`](./r2-redis-broker-presence.md) | Redis 只负责把事件送到各实例，本切片负责决定谁能订阅。 |
| `endpoint-page-cuu-alignment.png` | Cuu/Web 都通过 endpoint 订阅事件；Cuu 不绕过权限边界。 |

---

## 2. Runtime Contract

| topic / endpoint | R2.4 行为 |
|---|---|
| `GET /api/push/stream` -> `all` | **admin-only**。普通用户 403，避免全局 topic 成为公共泄漏口。 |
| `GET /api/push/stream/me` -> `user:{auth_user_id}` | 仅本人。topic 由鉴权身份派生，不接受 path 参数。 |
| `GET /api/push/stream/workitem/:id` | 必须 `access.canViewWorkItem(user,id) === true`。无 resolver 默认 403。 |
| `GET /api/push/stream/req/:id` | legacy alias，走同一 workitem gate。 |
| `GET /api/push/stream/run/:id` | 默认 resolver 允许 run actor 或 admin；其他用户 403。 |
| `GET /api/push/stream/session/:id` | 必须显式 `canViewSession` 放行；默认 403。 |
| `GET /api/push/stream/proposal/:id` | 必须显式 `canViewProposal` 放行；默认 403。 |

默认原则：

```text
me = identity-derived
all = admin-only
resource topics = fail-closed unless a resolver proves can_view
```

---

## 3. 文件落点

| 文件 | 变更 |
|---|---|
| `apps/api/src/sse/topic-access.ts` | `all` topic 从任意认证用户改为 admin-only；其它资源 topic 继续 resolver fail-closed。 |
| `apps/api/src/push.test.ts` | 新增 `/api/push/stream` admin-only route test；补 session/proposal 默认拒绝断言。 |
| `docs/workhub/01-architecture/api-contract.md` | topic 表更新：`all` admin-only，仅保留运维级公共/聚合事件。 |
| `docs/workhub/02-ai-engine/r2-topic-boundary.md` | 本篇记录 R2.4 contract、边界和验收。 |

---

## 4. 验收证据

已通过：

- `corepack pnpm --filter @workhub/api test`：94/94。
- `corepack pnpm --filter @workhub/api typecheck`。

新增关键测试：

| 测试 | 证明 |
|---|---|
| `topic authorization derives user streams from identity and rejects unregistered private topics` | 普通用户不能解析 `all`；admin 可解析；run/session/proposal 默认拒绝。 |
| `push route limits the global all stream to admins` | 普通用户请求 `/api/push/stream` 得 403，admin 得 SSE。 |
| 既有 run/workitem tests | run owner/admin 可订，stranger 不可订；workitem 无 resolver 默认 403，有 resolver 才放行。 |

R2.4 退出门：

- [x] `/api/push/stream` 不再对普通用户开放。
- [x] `user:{id}` 仍由身份派生。
- [x] workitem/run/session/proposal 默认 fail-closed。
- [x] run owner/admin 与 workitem explicit resolver 保持可用。

---

## 5. 剩余风险与下一步

| 风险 | 当前处理 | 后续 |
|---|---|---|
| WorkItem/Proposal/Session 的真实 DB resolver 仍未全部接入默认 route | R2.4 保持 fail-closed，不给就拒 | R2.5 或审批中心切片接真实 repository resolver |
| `all` 上历史事件仍在代码中发布 | 订阅 admin-only 后不再泄漏给普通用户；发布面后续可清理 | R2.5/R4 逐步迁移公共事件到 workspace/org 或资源 topic |
| 真实多 worker + Redis + resource authorization 未做端到端矩阵 | 本切片单元测试固定授权函数行为 | R2.5 建 PG + Redis full matrix |
| Cuu 订阅策略 | Cuu 只能走 `me` / resource topic，不订 `all` | R3 Cuu Agent 入口接同一 typed client 与权限边界 |

后续顺序：

1. **R2.5 集成矩阵**：PG + Redis 真服务，覆盖 SSE、stuck-job、长 LLM heartbeat、CORS/cookie、revert、escalation。
2. **真实 resource resolvers**：workitem/proposal/session 默认 route 接 repository，不靠显式测试注入。
3. **R3 Cuu Agent 入口**：在 R2 授权边界稳定后恢复 Cuu 出站能力。
