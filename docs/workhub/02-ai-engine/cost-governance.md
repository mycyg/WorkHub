---
module: 02-ai-engine/cost-governance
layer: L2（P-COST / 成本治理）
status: ✅
owner: workflow
---

# 成本治理（P-COST）

> **一句话**：P-COST 决定 AI 能花多少钱、什么时候降级、什么时候停下来交给人。Dashboard 只展示成本结果，AgentLoop 只消费已裁出的预算，本篇是三级配额、模型路由和成本口径的单一来源。
>
> 上游：[PRD NFR-05](../../prd/2026-06-04-workhub-prd.md) · [功能需求 FR-COST](../06-roadmap/functional-requirements.md#12-成本治理fr-cost--p-cost)。同层消费方：[agent-loop-and-tools §4](./agent-loop-and-tools.md) · [LLM provider 注册表](../01-architecture/tech-stack-and-migration.md#4-llm-provider-抽象与迁移) · [成本看板](../04-modules/dashboards-and-metrics.md#7-页面-dash-3成本看板dashboardcost重点页)。

---

## 0. 参考概念图

P-COST 不新增独立概念图，施工时引用现有三张横切图来避免端侧各自解释成本状态：

| 概念图 | 用途 |
|---|---|
| ![Endpoint Page Cuu Alignment](../05-clients/assets/shared/endpoint-page-cuu-alignment.png) | 定义 `GET /api/cost/usage`、`GET /api/pages/cost`、`budget.warning`、`budget.exhausted` 如何落到 Web 页面、Rust 主窗和 Cuu 气泡。 |
| ![TS-first Runtime](../05-clients/assets/shared/ts-first-runtime-concept.png) | 定义 `packages/cost`、provider registry、AgentLoop、Page VM 的 TS-first 责任边界。 |
| ![Web Operations Pages Atlas](../05-clients/assets/web/web-operations-pages-atlas.png) | 定义成本看板属于管理/治理入口，而不是普通用户默认首页或重看板。 |

---

## 1. 治理目标

| 目标 | 决策 |
|---|---|
| 不让 Agent 跑飞 | 每个 `AgentRun` 必须先拿到 `RunBudget`，每步开头先检查预算。 |
| 不把成本塞给用户理解 | 普通用户只看到「还够 / 快用完 / 已暂停」；管理员才看 token、金额、模型分布。 |
| 不阻断合理工作 | 快到预算先降级模型或提示；真正超额才拒绝新 run 或升级人工。 |
| 不让各端各算各的 | provider 统一上报 `UsageRecord`，P-COST 统一写 `CostLedgerEntry`，页面统一读 `CostSummaryVM`。 |

**边界**：
- P-COST 负责配额、裁决、口径、用量账本。
- AgentLoop 负责执行预算闸门，收到 `BudgetDecision` 后不再自定规则。
- Provider registry 负责模型单价和实际 usage 采集，不负责阻断。
- Dashboard 负责展示 `CostDashboardVM`，不负责裁决。

---

## 2. v0 默认值

> v0 是文档默认值，后续实现必须走配置/策略表覆盖，不能把这些数值写死在业务逻辑里。

### 2.1 单 run 硬上限

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `max_steps` | `15` | 沿用现状 `MAX_TURNS=15`。 |
| `total_timeout_s` | `300` | 沿用现状 5 分钟总超时。 |
| `max_tokens` | `120000` | input + output + retry + compact 共同计入。 |
| `max_cost` | `5 CNY` | 单个 AgentRun 的硬成本上限。 |

### 2.2 三级配额

| Scope | 默认周期 | 默认配额 | 超额默认动作 |
|---|---|---:|---|
| `workitem` | 单个 work item | `120000 tokens / 5 CNY` | 停止当前 run，生成结构化交接件。 |
| `user` | 日 | `500000 tokens / 20 CNY` | 阻断该用户新建 AI run，允许人工审批/查看。 |
| `team` | 日 | `5000000 tokens / 200 CNY` | 低风险任务降级模型；仍超则阻断新 run。 |
| `team` | 月 | `50000000 tokens / 2000 CNY` | 阻断新 run，通知 admin。 |

### 2.3 告警阈值

| 阈值 | 动作 |
|---|---|
| `80%` | 发 `budget.warning`，用户面只说「预算快用完了」。 |
| `95%` | 降级模型优先；若已是最低成本模型，则提示 admin。 |
| `100%` | 发 `budget.exhausted`，拒绝新 run 或让当前 run 交接。 |

---

## 3. 数据结构

### 3.1 `BudgetScope`

```ts
type BudgetScope =
  | { kind: "workitem"; workitem_id: string }
  | { kind: "user"; user_id: string }
  | { kind: "team"; team_id: string }
  | { kind: "eval"; suite: "nightly" | "release" };
```

### 3.2 `BudgetPolicy`

```ts
type BudgetPolicy = {
  id: string;
  scope_kind: BudgetScope["kind"];
  period: "run" | "day" | "month";
  max_tokens: number;
  max_cost_cny: string;
  warning_ratio: number;
  critical_ratio: number;
  on_warning: "notify" | "downgrade_model";
  on_exhausted: "block_new_run" | "handoff_current_run";
  model_route_hint?: "cheapest_safe" | "balanced" | "premium";
  enabled: boolean;
  version: number;
};
```

### 3.3 `BudgetUsage`

```ts
type BudgetUsage = {
  scope: BudgetScope;
  scope_label: string;
  policy_id: string;
  period: "run" | "day" | "month";
  period_start: string;
  period_end: string;
  token_in: number;
  token_out: number;
  total_tokens: number;
  max_tokens: number;
  remaining_tokens: number;
  estimated_cost_cny: string;
  max_cost_cny: string;
  remaining_cost_cny: string;
  warning_ratio: number;
  status: "ok" | "warning" | "critical" | "exhausted";
};
```

### 3.4 `BudgetDecision`

```ts
type RunBudget = {
  max_steps: number;
  total_timeout_s: number;
  max_tokens: number;
  max_cost_cny: string;
};

type BudgetDecision = {
  decision_id: string;
  allowed: boolean;
  reason?: "ok" | "warning" | "critical" | "budget_exhausted";
  run_budget: RunBudget;
  limiting_scope?: BudgetScope;
  model_route: {
    provider: string;
    model: string;
    reason: "default" | "low_risk_cheaper" | "near_budget_downgrade";
  };
  notice?: BudgetNotice;
};
```

### 3.5 `UsageRecord`

```ts
type UsageRecord = {
  run_id?: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_cny: string;
  source: "agent_step" | "review" | "compact" | "retry" | "eval";
  created_at: string;
};
```

### 3.6 `CostLedgerEntry`

```ts
type CostLedgerEntry = {
  id: string;
  usage_record_id: string;
  policy_id?: string;
  run_id?: string;
  workitem_id?: string;
  user_id?: string;
  team_id?: string;
  scope: BudgetScope;
  period_bucket: string;
  token_in: number;
  token_out: number;
  estimated_cost_cny: string;
  unit_price_cny?: string;
  currency: "CNY";
  model: string;
  source: UsageRecord["source"];
  created_at: string;
};
```

### 3.7 页面 VM

```ts
type CostSummaryVM = {
  me: BudgetUsage;
  team?: BudgetUsage;
  scopes: BudgetUsage[];
  active_notices: BudgetNotice[];
  generated_at: string;
};

type BudgetNotice = {
  code: "budget_warning" | "budget_exhausted";
  severity: "info" | "warning" | "critical";
  message: string;
  scope: BudgetScope;
  usage_ratio: number;
  recommended_action: "continue" | "downgrade_model" | "pause" | "ask_admin";
  options?: { id: string; label: string; action_href: string }[];
  action_href?: string;
};

type CostDashboardVM = {
  generated_at: string;
  currency: "CNY";
  total_cost_cny: string;
  token_in: number;
  token_out: number;
  unit_cost_cny?: string;
  trend: { date: string; cost_cny: string; tokens: number }[];
  by_user: { user_id: string; label: string; cost_cny: string; tokens: number }[];
  by_team: { team_id: string; label: string; cost_cny: string; tokens: number }[];
  by_workitem: { workitem_id: string; code: string; cost_cny: string; turns: number }[];
  model_breakdown: { provider: string; model: string; count: number; cost_cny: string }[];
  budget: BudgetUsage[];
  notices: BudgetNotice[];
  top_exhaustion_risks: { scope: BudgetScope; label: string; remaining_cost_cny: string; status: BudgetUsage["status"] }[];
  empty_state?: "no_agent_runs" | "usage_not_connected";
};
```

---

## 4. 裁决流程

1. 用户或编排层请求启动 `AgentRun`。
2. P-COST 读取 workitem/user/team 三层 policy 与当前 ledger 汇总。
3. 取三层中最紧的剩余额度，裁出 `RunBudget`。
4. 若任一硬配额已耗尽，返回 `ApiErr.code = "budget_exhausted"`。
5. 若接近预算，返回 `BudgetDecision.allowed=true`，但 `model_route.reason="near_budget_downgrade"`。
6. AgentLoop 每步开头用 `run_budget` 检查；命中超额时停止副作用，写结构化交接件。
7. Provider 每次调用产生 `UsageRecord`，P-COST 写 `CostLedgerEntry` 并发事件。

**合并规则**：
- 单 run 上限优先于 user/team 配额，任何 run 不得超过自己的 `max_cost`。
- user/team 同时命中时取更严格动作；`block_new_run` 高于 `downgrade_model`。
- eval/nightly 不占用户配额，单独计入 `scope.kind="eval"`。

---

## 5. 计入口径

| 项 | 是否计入真实成本 | 是否计入用户/team 配额 | 说明 |
|---|---|---|---|
| 正常 Agent step | 是 | 是 | 主成本来源。 |
| LLM review | 是 | 是 | 属于该 run 的质量检查成本。 |
| retry | 是 | 是 | 真实花费，不能免费。 |
| compact | 是 | 是 | 压缩上下文也是模型调用。 |
| schema repair | 是 | 是 | 由错误输出触发，但仍消耗成本。 |
| PR fixture eval | 是 | 否 | PR 用 mock/fixture，不进真实模型成本。 |
| nightly eval | 是 | 否 | 单独进 eval scope，避免污染用户账单。 |

---

## 6. API 与事件

| API | 返回 | 鉴权 |
|---|---|---|
| `GET /api/cost/policies` | `BudgetPolicy[]` | admin / team owner |
| `PUT /api/cost/policies/:scope/:id` | `BudgetPolicy` | admin / team owner |
| `GET /api/cost/usage` | `CostSummaryVM` | admin 看全局摘要；普通用户只看自己 |
| `GET /api/pages/cost` | `CostDashboardVM` | admin / owner 全量；普通用户降级为个人视图 |

| Event | Payload | Topic | 用途 |
|---|---|---|---|
| `usage.recorded` | `{usage_record_id, run_id?, workitem_id?, provider, model, input_tokens, output_tokens, estimated_cost_cny, source}` | `run:{id}` / admin metrics | Replay 与成本看板 reconcile。 |
| `budget.warning` | `BudgetNotice` | `user:{id}` / admin | Cuu 气泡或 Web 条幅。 |
| `budget.exhausted` | `BudgetNotice` | `user:{id}` / admin | 阻断新 run 或当前 run 交接。 |

### 6.1 API 返回口径

- `GET /api/cost/usage` 是轻量摘要，面向 Attention/Cuu/Rust one thing。它必须返回 `CostSummaryVM`，不得让客户端自己拼 `BudgetUsage[]`。
- `GET /api/pages/cost` 是页面 VM，面向 Web 成本看板。admin/owner 可见 `by_user/by_team/by_workitem`；普通用户只保留个人切片，`by_user` 不返回全员榜。
- `PUT /api/cost/policies/:scope/:id` 只能更新 `BudgetPolicy`，不得绕过审计；调参只改 policy，不改 AgentLoop 常量。
- 预算拒绝统一返回 `ApiErr.code="budget_exhausted"`，`details` 至少包含 `scope`, `policy_id`, `remaining_tokens`, `remaining_cost_cny`, `recommended_action`。

---

## 7. 页面与 Cuu 呈现

| Surface | 呈现 |
|---|---|
| Web 成本看板 | 读 `GET /api/pages/cost`，展示总成本、趋势、预算进度、模型分布与烧钱榜。 |
| Web Attention | 预算 warning 只显示为一条需要处理的 `AttentionItem`，不把数字压给普通用户。 |
| Rust 主窗 | 只显示当前 run 的预算状态和交接动作。 |
| Cuu | `budget.warning` 时轻提示；`budget.exhausted` 时变为 `asking_approval` 或 `worried`，引导用户点选「暂停 / 降级模型 / 找管理员」。 |
| Replay | footer 显示本次 run 的 cost summary；raw token 只给可见权限用户展开。 |

### 7.1 看板数据来源

| `CostDashboardVM` 字段 | 数据来源 | 权限/空态 |
|---|---|---|
| `total_cost_cny`, `token_in`, `token_out` | `CostLedgerEntry` 按查询区间聚合 | 无 run 时 `empty_state="no_agent_runs"`。 |
| `trend` | `CostLedgerEntry.period_bucket` 日/周聚合 | usage sink 未接入时 `empty_state="usage_not_connected"`。 |
| `by_user`, `by_team`, `by_workitem` | ledger + identity/project/workitem label join | 普通用户不返回全员 `by_user`。 |
| `model_breakdown` | `UsageRecord.provider/model` + ledger cost | provider key 不进入 VM。 |
| `budget` | `BudgetPolicy` + ledger 汇总后的 `BudgetUsage` | 显示用户/团队/任务三层中与当前 actor 有关的切片。 |
| `notices`, `top_exhaustion_risks` | `BudgetDecision` / `BudgetUsage.status` | `warning` 轻提示，`exhausted` 给暂停/降级/找管理员选项。 |

---

## 8. 验收门禁

- **2026-06-09 当前实现状态**：C1/C2/C3/C4/C5/C6 已落最小真实切片。`usage_records` 与 `cost_ledger_entries` 由 Drizzle migration `0003_amused_raider.sql` 创建；`budget_policies` 由 migration `0008_panoramic_dark_phoenix.sql` 创建；`packages/db/src/repositories/cost-ledger.ts` 实现 DB-backed `CostLedgerStore`；`packages/db/src/repositories/budget-policies.ts` 实现 DB-backed `BudgetPolicyStore`；生产默认 cost policy/ledger store 已切 DB；`PUT /api/cost/policies/:scope/:id` 会写 `AuditLog(action="budget_policy.updated")`；`/api/cost/usage` 与 `/api/pages/cost` 会从 DB policy + ledger 读取。尚未完成：`usage.recorded` / `budget.warning` / `budget.exhausted` 事件发出与 Cuu budget bubble。

- `RunBudget.max_cost` 来源必须可追溯到 `BudgetDecision`，不得在 AgentLoop 内硬编码。
- provider 的每次真实调用都产生 `UsageRecord`，并能幂等聚合为 `CostLedgerEntry`；`AgentRun.token_in/token_out/cost_estimate` 只能从 ledger 回填为摘要缓存。
- 重试、compact、review token 均计入 run 成本。
- `budget_exhausted` 统一走 `ApiErr.code = "budget_exhausted"`，用户面文案来自 `message`。
- `GET /api/pages/cost` 非 admin 不返回全员 `by_user`。
- Dashboard 成本页空态能区分「还没有 AgentRun」与「usage 采集未上线」。
- nightly eval 成本进入 `scope.kind="eval"`，不污染用户/team 配额。

---

## 9. 实现路线

### 9.1 目标 TS 路径

| 层 | 目标路径 | 产物 | 不允许 |
|---|---|---|---|
| contracts | `packages/contracts/src/cost.ts` | `BudgetPolicy`、`BudgetScope`、`BudgetUsage`、`BudgetDecision`、`UsageRecord`、`CostLedgerEntry`、`CostSummaryVM`、`BudgetNotice`、`CostDashboardVM` Zod schema | route/page local type |
| cost package | `packages/cost/src/policies.ts`, `packages/cost/src/decision.ts`, `packages/cost/src/ledger.ts`, `packages/cost/src/model-route.ts` | policy merge、预算裁决、账本写入、模型路由建议 | AgentLoop 内硬编码三级配额 |
| DB | `packages/db/src/schema/core.ts`, `packages/db/src/repositories/cost-ledger.ts`, `packages/db/src/repositories/budget-policies.ts` | 当前已落 `usage_records`、`cost_ledger_entries`、`budget_policies` 表与查询 helper；policy 更新写 audit | Dashboard 直接读 provider usage |
| API | `apps/api/src/routes/cost.ts`, `apps/api/src/pages/cost.ts` | `/api/cost/*` 与 `/api/pages/cost` | 客户端拼多个散接口生成成本页 |
| events | `packages/events/src/event-types.ts`, `packages/events/src/toAttentionItem.ts`, `packages/events/src/toCuuState.ts` | `usage.recorded`、`budget.warning`、`budget.exhausted` 常量与映射 | 页面/Cuu 手写事件字符串 |
| client | `packages/api-client/src/*`, `apps/web/src/pages/*`, `apps/desktop-webview/src/*` | typed client、成本页、OneThing budget strip、Cuu budget bubble | Rust/Web 本地重算预算状态 |

### 9.2 施工切片

| 切片 | 目标 | 验收 |
|---|---|---|
| C1 contracts first | 先把 §3 的全部类型落入 `packages/contracts/src/cost.ts` | OpenAPI 能生成 `BudgetNotice`、`CostSummaryVM`、`CostDashboardVM`;`budget_exhausted` 错误结构有 schema |
| C2 default policy seed | 将 §2 默认值写成可配置 seed,启动时生成 `BudgetPolicy` | 单 run `15/300s/120k/5 CNY`、用户日、团队日、团队月四条 policy 可查;业务逻辑不写死数值 |
| C3 usage sink | provider registry 每次真实调用写 `UsageRecord` | 正常 step、review、retry、compact、schema repair 都能被 fixture 计入 |
| C4 ledger reconcile | `UsageRecord` 归集到 workitem/user/team/eval scope 的 `CostLedgerEntry` | nightly eval 只进 `eval` scope;用户/team 配额不被污染 |
| C5 budget decision | AgentRun 启动前调用 `decideRunBudget()` | `BudgetDecision.allowed=false` 时统一返回 `ApiErr.code="budget_exhausted"`;allowed=true 近阈值时给 `BudgetNotice` |
| C6 page/API | 补 `/api/cost/policies`、`/api/cost/usage`、`/api/pages/cost` | 普通用户只看个人切片;admin/team owner 可看策略和全量成本页 |
| C7 event/Cuu | 将 warning/exhausted 事件映射为 Attention 和 Cuu 状态 | `budget.warning` → `worried`;`budget.exhausted` → `asking_approval` 且必须有可点选项 |

### 9.3 持久化策略

- P0 允许用配置 seed 初始化默认 policy,但产品态必须落 `budget_policies` 表并记录 `version`。
- policy 更新只改 `BudgetPolicy`,不得改 AgentLoop 常量;每次更新写 `AuditLog(action="budget_policy.updated")`。
- `CostLedgerEntry` 是看板和 replay 的真相源;`UsageRecord` 是 provider 原始调用事实,两者都要可追溯。
- 账本 reconcile 必须幂等:同一个 `usage_record_id + scope + period_bucket` 不得重复记账。
- provider 单价表属于 P-COST/model route 配置;业务 route、页面和 Cuu 不得硬编码模型单价。
- P0 可先同步写 ledger;多 worker 后改为事件/queue reconcile,但 API 契约不变。

---

## 10. 与其他文档的边界

| 文档 | 边界 |
|---|---|
| [`agent-loop-and-tools.md`](./agent-loop-and-tools.md) | 消费 `RunBudget`，执行超额交接；不自定配额。 |
| [`tech-stack-and-migration.md`](../01-architecture/tech-stack-and-migration.md) | provider 注册表与模型单价配置。 |
| [`dashboards-and-metrics.md`](../04-modules/dashboards-and-metrics.md) | 成本页面布局和图表，不裁决预算。 |
| [`api-contract.md`](../01-architecture/api-contract.md) | API envelope、错误码、路由清单。 |
| [`functional-requirements.md`](../06-roadmap/functional-requirements.md) | FR-COST 与 L2 白名单可追溯需求。 |
