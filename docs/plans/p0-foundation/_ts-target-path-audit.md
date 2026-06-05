---
title: WorkHub TS Target Path Audit
type: cross-cutting-audit
status: draft
date: 2026-06-05
depends:
  - ./_ts-first-module-port-page-alignment.md
---

# WorkHub TS Target Path Audit

> **一句话**:F1-F11 可以保留现有 Python/FastAPI 文件作为行为锚点,但施工必须落到明确的 TypeScript 目标路径。这个审计表用于防止“计划写 TS-first,实现又滑回旧单体”。

---

## 1. 审计规则

1. 每个组件 PR 必须在描述中写明 `Target TS paths`。
2. 旧系统文件只能作为 `Behavior source`,不能作为新仓默认实现路径。
3. 新 endpoint 的 schema 必须来自 `packages/contracts`。
4. 新 DB schema 必须来自 `packages/db`。
5. 新事件必须来自 `packages/events` 常量和 helper。
6. 新页面数据必须来自 Page VM 或 typed domain DTO,不能直接读 ORM row。
7. Rust 只能承接本地能力,不得复制业务权限/状态机/DTO。
8. Python 只能作为 optional worker,不得成为主业务后端。

---

## 2. F1-F11 Target Path Matrix

| 组件 | Behavior source | Target TS paths | 必须产物 | 审计门禁 |
|---|---|---|---|---|
| F01 Repo/config | `app/config.py`, root package files | `package.json`, `pnpm-workspace.yaml`, `packages/config`, `apps/api`, `apps/web`, `apps/desktop-webview` | Node 22, pnpm workspace, env schema, docker compose | `pnpm typecheck`, env parse 不触碰 `/srv/yqgl` |
| F02 Entities/models | `app/models.py` | `packages/db/src/schema/*`, `packages/contracts/src/domain/*` | Drizzle tables, Zod DTO, relation helpers | 新实体不得只存在 route local type |
| F03 PG/migrations | `app/db.py`, `schema_migrations.py` | `packages/db`, `drizzle.config.ts`, `migrations/` | 首迁移, drift check, seed fixture | 无 runtime ALTER/create_all |
| F04 Auth/identity | `app/auth.py` | `apps/api/src/middleware/auth.ts`, `packages/contracts/src/auth.ts`, `packages/db/src/repositories/devices.ts` | cookie/device token middleware | token-beats-cookie 行为回归 |
| F05 Event broker | `push_bus.py`, `push.py`, `presence.py` | `packages/events`, `apps/api/src/sse`, `apps/api/src/broker`, `packages/contracts/src/events.ts` | WorkHubEvent helper, Redis pub/sub, SSE writer | 不手写事件名;订阅边界鉴权 |
| F06 Permission | `permissions.py` | `packages/permissions`, `apps/api/src/services/approvals.ts`, `packages/contracts/src/approval.ts` | policy evaluator, ApprovalRequest, AttentionItem UI slice | admin 读/写/设备不对称回归 |
| F07 Provider registry | 7 处 `AsyncAnthropic` | `packages/agent/src/providers`, `packages/config/src/providers.ts`, `packages/cost` | provider registry, usage sink, BudgetDecision 输入 | grep 无裸 SDK client in services/tools |
| F08 Agent engine | `auto_agent.py`, `auto.py`, `llm_review` | `packages/agent`, `packages/tools`, `apps/api/src/workers/agent-runner.ts` | AgentLoop, ToolRegistry, AgentRun queue, replay trace | side-effect gate; AgentStep persisted |
| F09 Lifecycle/notifications | `lifecycle.py`, `notifications.py` | `packages/events/src/lifecycle.ts`, `apps/api/src/services/notifications.ts` | milestones, notification routing | 新状态必须登记,不发 `all` 私有内容 |
| F10 Audit/snapshot | `ActivityLog`, drive undo | `packages/audit`, `packages/db/src/schema/audit.ts`, `packages/contracts/src/replay.ts` | AuditLog, Snapshot, manifest facts | 快照失败 fail-closed |
| F11 Daemon/client | `app/main.py`, `shared/src/api/client.ts` | `apps/api/src/routes`, `apps/api/src/pages`, `packages/api-client`, `apps/web`, `apps/desktop-webview` | Hono routes, OpenAPI, generated client, Page VM | Web/Tauri consume same types |

---

## 3. Target Package Contracts

### 3.1 `packages/contracts`

必须包含:

- domain DTO: `User`, `Project`, `WorkItem`, `AgentRun`, `Proposal`, `ApprovalRequest`
- UX DTO: `AttentionItem`, `QuestionCard`, `EvidenceRef`, `EvidenceBubble`, `DeliverableChangeManifest`, `BudgetNotice`
- event DTO: `WorkHubEvent<T>`, `eventTypes`
- page VM: `AttentionHomeVM`, `WorkItemDetailVM`, `ProposalDetailVM`, `ApprovalCenterVM`, `ReplayTraceVM`, `CostSummaryVM`, `CostDashboardVM`
- action DTO: `ActionSpec`, `ReviewAction`, `ConflictChoice`

禁止:

- route 文件里临时定义用户可见 DTO
- Web/Tauri/Cuu 复制同名类型

### 3.2 `packages/db`

必须包含:

- Drizzle schema
- migrations
- repositories 或 query helpers
- seed fixtures
- transaction helper

禁止:

- 页面直接 import Drizzle table
- Rust 端直接访问 DB

### 3.3 `packages/events`

必须包含:

- event name constants
- `makeWorkHubEvent`
- `toAttentionItem`
- `toCuuState`
- SSE parser utilities for client side if needed

禁止:

- 页面里 `if (event.type === "proposal.opened")` 手写字符串;应 import 常量或 adapter

### 3.4 `packages/agent`

必须包含:

- `AgentLoop`
- `ToolRegistry`
- provider registry
- budget/cost recorder
- replay trace builder
- eval fixture runner hooks

禁止:

- tool 直接绕过 permission/snapshot gate
- LLM 输出绕过 schema parse

### 3.5 `packages/cost`

必须包含:

- `BudgetPolicy`, `BudgetScope`, `BudgetUsage`, `BudgetDecision`
- `UsageRecord`, `CostLedgerEntry`, `CostSummaryVM`, `BudgetNotice`, `CostDashboardVM`
- `decideRunBudget(actor, workItem, risk)` 裁决入口
- provider registry 的 usage sink;每次真实模型调用必须进入账本
- `budget_exhausted` ApiErr helper 与 `budget.warning` / `budget.exhausted` event builder

禁止:

- AgentLoop 自行硬编码 `max_cost` 或三级配额
- Dashboard 直接从 provider usage 临时聚合全员成本
- eval/nightly 成本混入用户或团队配额

---

## 4. PR 检查清单

每个功能 PR 至少回答:

- [ ] 这个改动属于 F 几?
- [ ] Behavior source 是哪些旧文件?
- [ ] Target TS paths 是哪些?
- [ ] 新/改 DTO 是否在 `packages/contracts`?
- [ ] 新/改 DB schema 是否在 `packages/db`?
- [ ] 新/改事件是否在 `packages/events`?
- [ ] 新/改成本口径是否在 `packages/cost`?
- [ ] Web/Tauri/Cuu 是否消费同一类型?
- [ ] 是否需要 Gold Path fixture?
- [ ] 是否需要 Eval/Replay fixture?
- [ ] 是否碰 side-effect? 若是,Snapshot gate 在哪里?

---

## 5. 审计命令建议

```text
pnpm audit:target-paths
pnpm audit:event-names
pnpm audit:contracts
pnpm audit:rust-business-logic
pnpm audit:python-boundary
```

### 5.1 规则示例

| 命令 | 检查 |
|---|---|
| `audit:event-names` | 新代码不得出现 `proposal.ready` / `agent.run.started` 等旧概念名 |
| `audit:contracts` | route/page 引用的 DTO 必须从 `packages/contracts` import |
| `audit:rust-business-logic` | Rust 不得出现 permission policy / workitem status transition 的重复实现 |
| `audit:python-boundary` | Python 目录只允许 worker/fixture/tooling,不得 expose `/api/*` |

---

## 6. 分阶段审计

| 阶段 | 审计目标 |
|---|---|
| P0a | F01/F02/F03 目标路径清楚,DB schema 不回退 |
| P0b | F04/F05/F06/F07 不复制旧单体服务结构 |
| P0c | F08/F09/F10/F11 的 Agent、事件、Page VM、client 全 TS-first |
| P0.5 | Gold Path 纵切全部使用 shared contracts |
| P1+ | 页面/交互新增前先补 Page VM 和 Cuu mapping |

---

## 7. 风险

| 风险 | 结果 | 缓解 |
|---|---|---|
| 旧 Python plan 被当成实现路径 | 新仓重复单体 | Master/F 计划标注 Behavior source vs Target path |
| Web/Tauri 各写 API client | 类型漂移 | generated `packages/api-client` 唯一入口 |
| Rust 复制业务判断 | 安全规则分叉 | Rust 只显示服务端返回状态和 action |
| Python worker 越界成后端 | 多语言心智破裂 | Python 只通过 queue/API 被调用 |
| Page VM 缺失 | 页面拼十几个接口 | 关键 AI-native 页面强制 BFF endpoint |

---

## 8. 下一步

1. 在 F01-F11 每份计划的实施步骤里补 `Target TS paths` 小节。
2. 为 `packages/contracts` 先建类型索引草案。
3. 为 Gold Path 创建第一个 fixture。
4. 在 PR 模板里加入本审计表的必答项。
