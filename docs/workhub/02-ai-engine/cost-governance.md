---
module: 02-ai-engine/cost-governance
layer: L2（P-COST / 成本治理）
status: 🚧
owner: workflow
---

# 成本治理（P-COST）

> **一句话**：P-COST 决定 AI 能花多少钱、什么时候降级、什么时候停下来交给人。Dashboard 只展示成本结果，AgentLoop 只消费已裁出的预算，本篇是三级配额、模型路由和成本口径的单一来源。
>
> 上游：[PRD NFR-05](../../prd/2026-06-04-workhub-prd.md) · [功能需求 FR-COST](../06-roadmap/functional-requirements.md#12-成本治理fr-cost--p-cost)。同层消费方：[agent-loop-and-tools §4](./agent-loop-and-tools.md) · [LLM provider 注册表](../01-architecture/tech-stack-and-migration.md#4-llm-provider-抽象与迁移) · [成本看板](../04-modules/dashboards-and-metrics.md#7-页面-dash-3成本看板dashboardcost重点页)。

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
  period_start: string;
  period_end: string;
  token_in: number;
  token_out: number;
  total_tokens: number;
  estimated_cost_cny: string;
  warning_ratio: number;
};
```

### 3.4 `BudgetDecision`

```ts
type BudgetDecision = {
  allowed: boolean;
  reason?: "ok" | "warning" | "critical" | "budget_exhausted";
  run_budget: RunBudget;
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
  run_id?: string;
  workitem_id?: string;
  user_id?: string;
  team_id?: string;
  scope: BudgetScope;
  token_in: number;
  token_out: number;
  estimated_cost_cny: string;
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
  active_notices: BudgetNotice[];
};

type BudgetNotice = {
  severity: "info" | "warning" | "critical";
  message: string;
  scope: BudgetScope;
  action_href?: string;
};

type CostDashboardVM = {
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
| `GET /api/cost/usage` | `BudgetUsage[]` | admin 看全局；普通用户只看自己 |
| `GET /api/pages/cost` | `CostDashboardVM` | admin / owner 全量；普通用户降级为个人视图 |

| Event | Payload | Topic | 用途 |
|---|---|---|---|
| `usage.recorded` | `{run_id, cost, tokens, model}` | `run:{id}` / admin metrics | Replay 与成本看板 reconcile。 |
| `budget.warning` | `BudgetNotice` | `user:{id}` / admin | Cuu 气泡或 Web 条幅。 |
| `budget.exhausted` | `BudgetNotice` | `user:{id}` / admin | 阻断新 run 或当前 run 交接。 |

---

## 7. 页面与 Cuu 呈现

| Surface | 呈现 |
|---|---|
| Web 成本看板 | 读 `GET /api/pages/cost`，展示总成本、趋势、预算进度、模型分布与烧钱榜。 |
| Web Attention | 预算 warning 只显示为一条需要处理的 `AttentionItem`，不把数字压给普通用户。 |
| Rust 主窗 | 只显示当前 run 的预算状态和交接动作。 |
| Cuu | `budget.warning` 时轻提示；`budget.exhausted` 时变为 `asking_approval` 或 `worried`，引导用户点选「暂停 / 降级模型 / 找管理员」。 |
| Replay | footer 显示本次 run 的 cost summary；raw token 只给可见权限用户展开。 |

---

## 8. 验收门禁

- `RunBudget.max_cost` 来源必须可追溯到 `BudgetDecision`，不得在 AgentLoop 内硬编码。
- provider 的每次真实调用都产生 `UsageRecord`，并能聚合为 `AgentRun.token_in/token_out/cost_estimate`。
- 重试、compact、review token 均计入 run 成本。
- `budget_exhausted` 统一走 `ApiErr.code = "budget_exhausted"`，用户面文案来自 `message`。
- `GET /api/pages/cost` 非 admin 不返回全员 `by_user`。
- Dashboard 成本页空态能区分「还没有 AgentRun」与「usage 采集未上线」。
- nightly eval 成本进入 `scope.kind="eval"`，不污染用户/team 配额。

---

## 9. 与其他文档的边界

| 文档 | 边界 |
|---|---|
| [`agent-loop-and-tools.md`](./agent-loop-and-tools.md) | 消费 `RunBudget`，执行超额交接；不自定配额。 |
| [`tech-stack-and-migration.md`](../01-architecture/tech-stack-and-migration.md) | provider 注册表与模型单价配置。 |
| [`dashboards-and-metrics.md`](../04-modules/dashboards-and-metrics.md) | 成本页面布局和图表，不裁决预算。 |
| [`api-contract.md`](../01-architecture/api-contract.md) | API envelope、错误码、路由清单。 |
| [`functional-requirements.md`](../06-roadmap/functional-requirements.md) | FR-COST 与 L2 白名单可追溯需求。 |
