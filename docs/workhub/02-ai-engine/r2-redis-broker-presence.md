---
module: P-AI
layer: R2 multi-worker / event broker
status: current
owner: workflow
date: 2026-06-10
related:
  - ./agent-loop-and-tools.md
  - ./r2-agent-run-claim-lease.md
  - ./r2-multi-worker-pump.md
  - ../01-architecture/system-architecture.md
  - ../01-architecture/api-contract.md
  - ../01-architecture/tech-stack-and-migration.md
  - ../06-roadmap/recovery-r0-r4-roadmap-2026-06-08.md
  - ../06-roadmap/review-driven-r0-r4-detailed-construction-plan-2026-06-08.md
visuals:
  - ../05-clients/assets/shared/endpoint-page-cuu-alignment.png
---

# R2.3 Redis Broker / Presence

> 本篇记录 R2.3 的落地口径：多 worker 下 SSE 事件和在线状态不能只活在单进程内存里。R2.3 选择 **Redis pub/sub + Redis TTL keys** 作为 v0 跨 worker 后端；`memory` 仅保留给开发、测试和单 worker；`pg_listen` 仍是预留配置，不在本切片宣称完成。

---

## 1. 开工前对齐

本切片开工前已阅读并对齐：

| 输入 | 结论 |
|---|---|
| [`agent-loop-and-tools.md`](./agent-loop-and-tools.md) | AgentRun trace 通过 SSE topic 投影，DB 是权威真相，SSE 是增量提示。 |
| [`system-architecture.md`](../01-architecture/system-architecture.md) | 多副本下进程内 bus 会让事件只到达产生事件的实例，必须换外部 broker。 |
| [`api-contract.md`](../01-architecture/api-contract.md) | topic 隔离是安全边界；`user:{id}` 由身份派生，资源 topic 必须先鉴权。 |
| R2 roadmap | R2.1/R2.2 已解决 run claim 与 active enqueue；R2.3 只处理 broker/presence，不处理订阅授权矩阵。 |
| 概念图 `endpoint-page-cuu-alignment.png` | 页面、endpoint、CuuState 分离；本切片不改变 Cuu / Web UI，只保证事件从任意实例都能回到正确订阅者。 |

---

## 2. 目标与非目标

### 2.1 目标

- `BROKER_BACKEND=redis` 时，两个独立 `RedisPushBus` 实例共享同一 Redis 后端：A 实例 publish，B 实例的本地 SSE subscription 能收到。
- `RedisPresenceStore` 的在线状态跨实例可见：A 实例 `markStreamOpen(user)`，B 实例 `getPresence(user)` 返回 online。
- 修正同一 topic 的 `unsubscribe -> subscribe` 竞态：最后一个订阅者退订尚未完成时，新订阅者不能被旧 `unsubscribe(channel)` 误退掉。
- 生产多 worker 配置 fail-closed：`APP_ENV=production + WORKER_COUNT>1 + BROKER_BACKEND=memory` 仍然拒绝启动；Redis 必须配置 `BROKER_URL`。
- 保持现有 SSE endpoint、topic、payload、backpressure 语义不变。

### 2.2 非目标

| 非目标 | 原因 / 后续归属 |
|---|---|
| 启用 `pg_listen` | 当前只保留配置枚举，真正 adapter 另开 R2.x 或 P5 云部署切片。 |
| 真实 Redis 容器集成矩阵 | R2.3 用 fake Redis adapter 单测钉语义；真实 PG + Redis 五场景归 R2.5。 |
| 订阅鉴权改造 | `/api/push/stream` all topic、资源 topic 非 owner 403 等归 R2.4。 |
| Exactly-once SSE | SSE 仍是增量提示，会丢慢订阅者；REST/DB 才是真相源。 |
| Cuu / Web UI 改动 | 本切片是 runtime 地基，不改变任何页面或桌宠表现。 |

---

## 3. Runtime Contract

### 3.1 配置

| 环境变量 | v0 行为 |
|---|---|
| `BROKER_BACKEND=memory` | 默认开发/测试后端；生产 `WORKER_COUNT>1` 禁止。 |
| `BROKER_BACKEND=redis` | R2.3 唯一完成的跨 worker 后端。 |
| `BROKER_URL=redis://...` | Redis 后端必填；缺失时 fail-closed。 |
| `BROKER_BACKEND=pg_listen` | 仍是预留值；`createPushBus()` 会拒绝，避免误以为 PG broker 已完成。 |

生产多 worker 的推荐最小配置：

```text
APP_ENV=production
WORKER_COUNT=2
BROKER_BACKEND=redis
BROKER_URL=redis://redis:6379
```

### 3.2 PushBus

现有接口保持不变：

```ts
type PushBus = {
  backend: "memory" | "redis";
  subscribe(topic: string): Promise<PushSubscription>;
  unsubscribe(topic: string, subscription: PushSubscription): Promise<void>;
  publish<T>(topic: string, type: string, data: T): Promise<void>;
  close?: () => Promise<void>;
};
```

Redis 实现细节：

- publisher 与 subscriber 分离：subscriber 由 `publisher.duplicate()` 创建，遵循 node-redis pub/sub 专用连接约束。
- 每个 topic 仍有本地 `LocalEventQueue(maxSize=256)`，保持旧 push_bus 的慢订阅者丢弃语义。
- 每个 topic 有串行化锁：`subscribe(topic)` 与 `unsubscribe(topic)` 不能并发交错。
- 当最后一个本地订阅者退订时，才执行 Redis `unsubscribe(channel)`。
- `close()` 会关闭本地订阅队列、清空 handler 与 topic lock，再退出 Redis 连接。
- Redis connect 失败后会清空 `connecting` latch，允许下一次 subscribe/publish/touch 重试连接。

### 3.3 Presence

Redis presence 使用两个 key：

| key | 用途 |
|---|---|
| `presence:lastseen:{user_id}` | 最近一次 touch/open/close 时间，TTL=`120s`。 |
| `presence:streams:{user_id}` | 当前打开的 SSE stream 计数，TTL=`120s`。 |

在线判定：

```text
is_online = stream_count > 0 OR last_seen_at within 120s
```

这延续内存版语义：断流后短时间仍视为 recent online，避免网络抖动让桌宠/页面状态瞬间闪烁。

---

## 4. 文件落点

| 文件 | 变更 |
|---|---|
| `apps/api/src/broker/redis.ts` | 增加 Redis client factory 注入；topic 级 subscribe/unsubscribe 串行化；`close()` 清理本地队列；connect 失败后可重试。 |
| `apps/api/src/broker/presence.ts` | 增加 Redis presence client factory 与 `now()` 注入；支持 `close()`；connect 失败后可重试；测试可共享 fake Redis KV。 |
| `apps/api/src/broker.test.ts` | 新增跨实例 publish/subscribe、退订竞态、跨实例 presence 三个测试。 |
| `packages/config/src/env.test.ts` | 新增 Redis 多 worker production 配置允许、缺 `BROKER_URL` 拒绝测试。 |
| `docs/workhub/*` | README、架构、路线图与本篇同步 R2.3 状态。 |

---

## 5. 验收证据

已通过：

- `corepack pnpm --filter @workhub/api test`：93/93。
- `corepack pnpm --filter @workhub/api typecheck`。
- `corepack pnpm --filter @workhub/config test`：9/9。

新增关键测试：

| 测试 | 证明 |
|---|---|
| `redis bus delivers events across independent worker instances` | 两个 `RedisPushBus` 实例共享同一 fake Redis hub；A publish，B subscription 收到。 |
| `redis bus serializes unsubscribe and resubscribe for the same topic` | 旧订阅的 `unsubscribe` 阻塞期间，新 `subscribe` 必须等待；释放后新订阅仍能收到事件。 |
| `redis presence shares online state across worker instances` | 两个 `RedisPresenceStore` 实例共享 fake Redis KV；A open，B get online。 |
| `allows redis broker for multiple production workers when url is configured` | 多 worker 生产环境允许 Redis broker。 |
| `requires broker url for non-memory production broker` | 非 memory broker 无 URL 直接拒绝。 |

R2.3 退出门：

- [x] A 实例发布，B 实例订阅者收到。
- [x] Presence 在线状态跨实例可见。
- [x] 同 topic `unsubscribe` / `subscribe` 竞态被单测固定。
- [x] 生产多 worker 下 memory broker 仍 fail-closed，Redis 必须有 URL。
- [x] 无 public API / UI contract 破坏。

---

## 6. 剩余风险与下一步

| 风险 | 当前处理 | 后续 |
|---|---|---|
| fake Redis 不能覆盖真实网络、认证、重连、容器启动顺序 | R2.3 先固定 adapter 语义，避免无 Redis 的 CI 阻塞 | R2.5 加真实 Redis service matrix |
| Redis pub/sub 不持久化事件 | REST/DB 是真相源，SSE 只是增量提示；客户端收到事件后重拉 | R4 前端需保持 reconcile 策略 |
| `all` topic 仍可能过宽 | R2.4 已改为 admin-only；资源 topic 默认 fail-closed | R2.5 接真实 Redis/PG matrix 与更多 repository resolver |
| 长 LLM call 中途 lease 可能过期 | R2.1 只在 step record 后 heartbeat | R2.5 增加 interval heartbeat |
| `pg_listen` 被配置枚举暴露但实现未落 | `createPushBus()` 明确 throw | 后续如果需要 PG-only 部署再实现 |

后续顺序：

1. **R2.5 集成矩阵**：PG + Redis 真服务，覆盖 SSE、stuck-job、长 LLM heartbeat、CORS/cookie、revert、escalation。
2. **真实 resource resolvers**：workitem/proposal/session 默认 route 接 repository，不靠显式测试注入。
3. **R3 Cuu Agent 入口**：在 R2 地基稳定后，让 Cuu 走同一 session/intake/workitem/agent-run/proposal API。
