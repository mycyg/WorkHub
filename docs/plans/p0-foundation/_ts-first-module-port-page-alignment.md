---
title: WorkHub TS-first 模块 / 端口 / 页面返回对齐计划
type: cross-cutting-plan
status: draft
date: 2026-06-05
depends:
  - ./_experience-deliverable-contracts.md
  - ./_gold-path-p0-5-vertical-slice.md
  - ./_agent-eval-replay-plan.md
  - ./F11-headless-daemon-client-rewire-plan.md
visuals:
  - ../../workhub/05-clients/assets/shared/ts-first-runtime-concept.png
  - ../../workhub/05-clients/assets/shared/endpoint-page-cuu-alignment.png
---

# WorkHub TS-first 模块 / 端口 / 页面返回对齐计划

> **一句话**:WorkHub 仍然沿用现有「需求管理大师」的业务经验和迁移清单,但新仓施工默认采用 **TypeScript-first**:API daemon、AgentLoop、权限/审计/事件、OpenAPI 契约、Web、Tauri webview、Cuu 轻卡都用 TS 作为主语言;Rust 只承接本地壳能力;Python 只作为可选文档处理 worker。
>
> 这份文档是 F1-F11 的横切修正层:若组件 plan 里仍写 FastAPI/SQLAlchemy/Alembic,在概念阶段应理解为**行为锚点与迁移来源**,新实现默认按本文的 TS-first 模块边界落地。

---

## 0. 参考概念图

### 0.1 TS-first Runtime

![WorkHub TS-first Runtime](../../workhub/05-clients/assets/shared/ts-first-runtime-concept.png)

这张图定义语言和运行时边界:主业务在 TypeScript Core,客户端只消费 typed contract,基础设施只提供 DB/broker/storage/可选 worker。

### 0.2 Endpoint → Page → Cuu Alignment

![WorkHub Endpoint Page Cuu Alignment](../../workhub/05-clients/assets/shared/endpoint-page-cuu-alignment.png)

这张图定义施工时最容易乱的链路:模块触发动作 → 调哪个 endpoint → 返回什么 payload → 哪个页面承接 → Cuu 用什么状态表达。

---

## 1. 技术栈决策

### 1.1 默认路线

| 层 | P0 默认 | 备选 | 决策理由 |
|---|---|---|---|
| API daemon | **Hono on Node.js 22 LTS** | Fastify / Elysia | Hono 足够轻,路由分组清晰,支持 Node runtime 与 streaming/SSE;P0 避免 Bun-only 绑定 |
| Contract/schema | **Zod + OpenAPI 生成** | Valibot / TypeBox | 页面、Cuu、Agent 工具参数都需要同源 schema;Zod 生态成熟 |
| DB/ORM | **Drizzle ORM + PostgreSQL** | Prisma / Kysely | Drizzle 是 TS-first schema/query/migration;适合把实体定义、迁移、类型统一在 TS |
| Queue/broker | **Redis** | PG LISTEN/NOTIFY | P0 既要 SSE pub/sub,也要 AgentRun queue 和 presence;Redis 简单直接 |
| Client | **React + Vite + TS** | Next.js | 当前是 SPA 瘦客户端,不需要 SSR;Vite 与 Tauri webview 对齐更轻 |
| Desktop shell | **Tauri v2 + Rust** | Electron | Rust 壳保留本地能力:窗口、托盘、文件、通知、设备令牌、同步 |
| AI SDK | TS provider registry | Python SDK bridge | 主 AgentLoop 用 TS 统一工具/事件/审计;个别 Python 能力走 worker queue |
| Document worker | Optional Python service | WASM/LibreOffice sidecar | `.docx/.pptx/.xlsx/PDF` 深处理可用 Python/LibreOffice,但不能成为主业务后端 |

> Context7 官方文档核对: Hono 支持 Node runtime、路由分组和 streaming/SSE;Drizzle 支持 PostgreSQL schema、type-safe query 与迁移生成。本文只用这些稳定能力,不依赖边缘运行时特性。

### 1.2 语言边界

| 语言 | 应该负责 | 不应该负责 |
|---|---|---|
| TypeScript | API、AgentLoop、ToolRegistry、权限、审计、事件、OpenAPI、Web、Tauri webview、Cuu 适配器、shared UI/types | 不直接做 OS 文件监听、托盘、系统通知 |
| Rust | Tauri shell、本地文件监听、托盘、系统通知、deep-link、设备令牌保存、本地同步执行器 | 不写业务状态机、不复制权限逻辑、不手写 domain DTO |
| Python | 可选文档/PDF/Office 处理 worker、少量现有脚本迁移期兼容 | 不作为主 API daemon、不作为主 Agent 状态机 |

---

## 2. 推荐仓库结构

```text
apps/
  api/                         # Hono API daemon, port 8787
    src/
      app.ts
      routes/
      middleware/
      services/
      pages/                   # BFF/page view model assemblers
      sse/
      workers/
  web/                         # Browser SPA, port 5173
  desktop-webview/             # Tauri webview React app, port 1420

client-tauri/
  src-tauri/                   # Rust shell only

packages/
  contracts/                   # Zod schemas, OpenAPI registry, event constants
  db/                          # Drizzle schema, migrations, repositories
  api-client/                  # generated typed fetch + SSE parser
  events/                      # WorkHubEvent helpers, toAttentionItem, toCuuState
  agent/                       # AgentLoop, ToolRegistry, budgets, provider registry
  tools/                       # ToolSpec implementations
  permissions/                 # policy evaluator, ApprovalRequest helpers
  audit/                       # snapshot/revert transaction wrappers
  ui/                          # shared components
  cuu/                         # Cuu state machine, bubble/card adapters
  config/                      # env schema, port map, runtime config

workers/
  document-python/             # optional: Office/PDF preview, OCR, export jobs
```

**原则**:

- `packages/contracts` 是上游:API、client、Cuu、Agent 工具参数都从这里导入类型。
- `apps/api/routes/*` 不直接拼复杂页面数据;复杂页面返回由 `apps/api/pages/*` 聚合。
- `client-tauri/src-tauri` 只 expose invoke 命令给本地能力;业务请求仍走 `packages/api-client`。
- `packages/events` 统一正式事件名,禁止页面里散落字符串。

---

## 3. 端口规划

| 端口 | 服务 | 用途 | P0 规则 |
|---|---|---|---|
| `5173` | `apps/web` | Web SPA dev server | 只连 `VITE_API_BASE_URL`,不假设同源 |
| `1420` | `apps/desktop-webview` | Tauri webview dev server | Tauri dev 固定;生产打包进客户端 |
| `8787` | `apps/api` | Hono API daemon | `/api/*` + `/api/push/stream*`;不托管 SPA |
| `5432` | PostgreSQL | 业务真相源 | Drizzle migrations 管理 schema |
| `6379` | Redis | SSE pub/sub、presence、Agent queue | 多 worker 前必需 |
| `6006` | Storybook/组件画廊(可选) | UI/Cuu 卡片验收 | 不进入生产部署 |
| `9323` | Playwright report(可选) | E2E 报告 | CI artifact |

**生产部署口径**:

- Web 静态资源走独立 origin/CDN/LAN 静态服务。
- API daemon 只服务 API/SSE/download manifest。
- Tauri 客户端的 `server_url` 指向 API daemon。
- CORS 生产门:不允许 `*` + credentials。

---

## 4. API 路由组与返回契约

### 4.1 路由组

| Route group | 代表 endpoint | 模块 owner | 返回类型来源 |
|---|---|---|---|
| `auth` | `POST /api/auth/identify` | `apps/api/routes/auth.ts` | `contracts/auth.ts` |
| `projects` | `GET /api/projects` | `routes/projects.ts` | `contracts/project.ts` |
| `workitems` | `GET /api/workitems/:id` | `routes/workitems.ts` | `contracts/workitem.ts` |
| `sessions` | `POST /api/sessions` | `routes/sessions.ts` | `SessionVM`（含首张 `QuestionCard`、`topic`、`stream_href`） |
| `agent-runs` | `POST /api/workitems/:id/agent-runs` | `routes/agent-runs.ts` | `AgentRun`, `WorkHubEvent` |
| `permissions` | `POST /api/permissions/ask` | `routes/permissions.ts` | `ApprovalRequest`, `AttentionItem` |
| `approvals` | `GET /api/approvals` | `routes/approvals.ts` | `ApprovalCenterVM` |
| `proposals` | `GET /api/proposals/:id` | `routes/proposals.ts` | `DeliverableChangeManifest` |
| `cost` | `GET /api/cost/usage` | `routes/cost.ts` | `CostSummaryVM`（内含 `BudgetUsage[]`）, `BudgetNotice` |
| `cost` | `GET /api/cost/policies`, `PUT /api/cost/policies/:scope/:id` | `routes/cost.ts` | `BudgetPolicy`, `BudgetDecision` audit ref |
| `knowledge` | `POST /api/knowledge/search` | `routes/knowledge.ts` | `EvidenceRef`, `EvidenceBubble` |
| `drive` | `GET /api/drive/items` | `routes/drive.ts` | `DriveItem`, `DeliverableTarget` |
| `meetings` | `GET /api/meetings/:id` | `routes/meetings.ts` | `EvidenceRef`, insight draft |
| `sync` | `GET /api/sync/conflicts` | `routes/sync.ts` | `ConflictChoice` |
| `notifications` | `GET /api/notifications` | `routes/notifications.ts` | `Notification`, `AttentionItem` |
| `push` | `GET /api/push/stream/me` | `routes/push.ts` | `WorkHubEvent<T>` SSE |
| `pages` | `GET /api/pages/attention` | `apps/api/pages/attention.ts` | `AttentionHomeVM` |
| `pages` | `GET /api/pages/cost` | `apps/api/pages/cost.ts` | `CostDashboardVM` |
| `pages` | `GET /api/agent-runs/:id/replay` | `apps/api/pages/replay.ts` | `ReplayTraceVM` |

### 4.2 REST envelope

P0 默认所有新 REST endpoint 使用同一 envelope,旧兼容 endpoint 可迁移期保留裸返回。

```ts
type ApiOk<T> = {
  ok: true;
  data: T;
  meta?: {
    request_id: string;
    version?: number;
    generated_at: string;
  };
};

type ApiErr = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    recoverable?: boolean;
  };
};
```

**用户面原则**:`message` 必须是人话;内部 tool enum、SQL、堆栈不进入用户面。

---

## 5. 页面返回规划(Page View Models)

AI-native 产品不应该让前端拼十几个接口才知道「现在要处理什么」。P0 起保留 domain API,同时给关键页面提供 BFF-style page endpoint。

| 页面 / surface | Endpoint | 返回 VM | 关键字段 | Cuu 承接 |
|---|---|---|---|---|
| AI-first 首页 / Rust 单件事工作台 | `GET /api/pages/attention` | `AttentionHomeVM` | `primary: AttentionItem`, `queue`, `background_runs`, `cuu_state` | 红点、轻气泡、当前一件事 |
| 提需求 / 澄清 | `POST /api/sessions` / `POST /api/sessions/:id/next-question` | `SessionVM` / `QuestionCard` | `session_id`, `topic`, `stream_href`, `question.options`, `recommended_option_ids`, `free_text` | `asking_approval` / `thinking` |
| 工作项详情 | `GET /api/pages/workitems/:id` | `WorkItemDetailVM` | `workitem`, `acceptance`, `agent_trace_preview`, `latest_proposal`, `evidence_refs` | carrying document / worried |
| 审批中心 | `GET /api/pages/approvals` | `ApprovalCenterVM` | `items: AttentionItem[]`, `filters`, `counts` | approval bubble |
| 提议详情 | `GET /api/pages/proposals/:id` | `ProposalDetailVM` | `manifest: DeliverableChangeManifest`, `checks`, `rollback`, `comments` | carrying document / celebrating |
| 知识/项目检索气泡 | `POST /api/knowledge/search` | `EvidenceBubble` | `query`, `evidence_refs`, `missing_evidence_note` | searching_evidence |
| 网盘变更草稿 | `POST /api/drive/change-drafts` | `DeliverableChangeManifest` | `targets`, `summary`, `checks`, `rollback` | carrying document |
| 会议洞察转草稿 | `POST /api/meetings/:id/insights/:id/draft` | `QuestionCard` or `WorkItemDraftVM` | `source_evidence`, `suggested_options` | thinking / asking |
| 同步冲突解决 | `GET /api/pages/sync/conflicts` | `SyncConflictResolverVM` | `conflicts`, `choices`, `recommended_choice` | worried |
| Agent 实时轨迹 | `GET /api/pages/agent-runs/:id` + SSE | `AgentRunTraceVM` | `steps`, `current_step`, `budget`, `snapshot_refs` | thinking |
| Agent 回放 | `GET /api/agent-runs/:id/replay` | `ReplayTraceVM` | `steps`, `evidence_refs`, `snapshots`, `cost` | deep-link 打开,复杂 trace 不塞气泡 |
| 成本治理 | `GET /api/pages/cost` | `CostDashboardVM` | `total_cost_cny`, `trend`, `budget`, `model_breakdown`, `notices` | `budget.warning` 轻气泡;`budget.exhausted` 审批/暂停卡 |

### 5.1 `AttentionHomeVM`

```ts
type AttentionHomeVM = {
  primary?: AttentionItem;
  queue: AttentionItem[];
  background_runs: {
    run_id: string;
    workitem_id?: string;
    title: string;
    state: "queued" | "running" | "waiting_for_user" | "failed";
    preview_text: string;
  }[];
  cuu_state: CuuState;
};
```

### 5.2 `ProposalDetailVM`

```ts
type ProposalDetailVM = {
  proposal_id: string;
  workitem_id: string;
  title: string;
  status: "opened" | "reviewed" | "merged" | "rejected";
  manifest: DeliverableChangeManifest;
  evidence_refs: EvidenceRef[];
  review_actions: {
    approve: ActionSpec;
    request_changes: ActionSpec;
    merge?: ActionSpec;
  };
  comments: CommentVM[];
};
```

### 5.3 字段级落点矩阵

| VM / payload | 字段 | 端点 / 事件 | TS owner | Web 落点 | Rust / Cuu 落点 |
|---|---|---|---|---|---|
| `ReplayTraceVM` | `steps[]`, `evidence_refs[]`, `snapshots[]`, `cost` | `GET /api/agent-runs/:id/replay` | `packages/contracts/src/replay.ts`, `apps/api/src/pages/replay.ts` | Replay Work | deep-link 打开;Cuu 不塞完整 trace |
| `ReplayTraceVM.cost` | `input_tokens`, `output_tokens`, `estimated_cost`, `latency_ms` | `GET /api/agent-runs/:id/replay` | `packages/cost` + `packages/audit` facts | Replay footer | Rust footer 只显示当前 run 摘要 |
| `CostSummaryVM` | `me`, `team`, `scopes`, `active_notices` | `GET /api/cost/usage` | `packages/contracts/src/cost.ts`, `packages/cost/src/usage.ts` | Attention banner / compact budget strip | OneThing budget strip / Cuu 轻气泡 |
| `BudgetNotice` | `code`, `severity`, `message`, `scope`, `usage_ratio`, `recommended_action`, `options` | `budget.warning`, `budget.exhausted` | `packages/contracts/src/cost.ts`, `packages/events` | Attention item / Cost Dashboard warning | `worried` 或 `asking_approval`;必须点选操作 |
| `BudgetPolicy` | `scope_kind`, `period`, `max_tokens`, `max_cost_cny`, `warning_ratio`, `critical_ratio`, `on_warning`, `on_exhausted`, `model_route_hint`, `version` | `GET /api/cost/policies`, `PUT /api/cost/policies/:scope/:id` | `packages/contracts/src/cost.ts`, `packages/cost/src/policies.ts`, `apps/api/src/routes/cost.ts` | Cost policy settings / admin panel | Cuu 不直接编辑 policy;只展示告警动作 |
| `BudgetDecision` | `allowed`, `reason`, `run_budget`, `limiting_scope`, `model_route`, `notice` | AgentRun 启动前内部裁决;拒绝时转 `ApiErr.code="budget_exhausted"` | `packages/cost/src/decision.ts`, `packages/agent/src/loop/*` | 仅表现为启动失败或告警 banner | 仅消费 `notice` 映射,不暴露裁决细节 |
| `CostDashboardVM` | `total_cost_cny`, `token_in`, `token_out`, `trend`, `model_breakdown` | `GET /api/pages/cost` | `apps/api/src/pages/cost.ts` | Cost Dashboard 概览/趋势/模型图 | 不在 Cuu 展开 |
| `CostDashboardVM` | `by_user`, `by_team`, `by_workitem`, `budget`, `notices`, `top_exhaustion_risks` | `GET /api/pages/cost` | `apps/api/src/pages/cost.ts`, `packages/permissions` | Cost Dashboard 排行/预算/钻取 | Rust 只消费当前 actor 切片;普通用户不看全员榜 |

字段落点规则:

- Page VM assembler 只聚合 contracts DTO,不直接把 Drizzle row 透给页面。
- `BudgetNotice.options` 是端侧动作来源;Cuu/Rust 不要求用户输入预算处理命令。
- `ReplayTraceVM` 的 raw 内容必须走单独 raw endpoint 并按权限脱敏,不得塞进 Cuu 气泡。
- `CostDashboardVM.by_user` 仅 admin / owner 返回全量;普通用户返回空数组或个人切片,由服务端裁定。

---

## 6. Endpoint → Page → Cuu 对齐表

| 模块 | Endpoint / event | Payload | Web 页面 | Rust 主窗 | Cuu state |
|---|---|---|---|---|---|
| Clarify | `POST /api/sessions/:id/next-question` | `QuestionCard` | Option Wizard | 同步显示 | `thinking` / `asking_approval` |
| Approval | `permission.ask` + `GET /api/pages/approvals` | `AttentionItem` | Approval Center | OneThingCard | `asking_approval` |
| Proposal | `proposal.opened` + `GET /api/pages/proposals/:id` | `DeliverableChangeManifest` | Proposal Detail | Deliverable card | `carrying_document` |
| Knowledge | `knowledge.evidence.ready` | `EvidenceBubble` | Knowledge / Evidence panel | Cuu bubble + detail deep-link | `searching_evidence` |
| Cost | `usage.recorded`, `budget.warning`, `budget.exhausted` | `CostSummaryVM` / `BudgetNotice` | Cost Dashboard / Attention banner | OneThing budget strip | `thinking` / `worried` / `asking_approval` |
| Sync | `sync.conflict` | `ConflictChoice[]` | Conflict Resolver | Local sync panel | `worried` |
| Agent run | `agent_run.step` | `WorkHubEvent<AgentStep>` | Live trace | Live trace compact | `thinking` |
| Merge done | `proposal.merged` | `AttentionItem` | Timeline + notification | Summary card | `celebrating` |

---

## 7. SSE 与事件实现规则

### 7.1 Topic

| Topic | 谁订阅 | 典型事件 |
|---|---|---|
| `user:{id}` | 当前用户私有流 | `permission.ask`, `proposal.opened`, `notification.created` |
| `workitem:{id}` | 可见该工作项的人 | `proposal.opened`, `proposal.reviewed`, `agent_run.escalated` |
| `run:{id}` | run owner / 审批人 | `agent_run.started`, `agent_run.step`, `step.snapshot` |
| `session:{id}` | session owner | `question.ready`, `permission.ask` |
| `proposal:{id}` | 可见该提议的人 | `proposal.reviewed`, `proposal.merged` |

### 7.2 Envelope

所有新 SSE 用 `_experience-deliverable-contracts.md` 的 `WorkHubEvent<T>`。实现时由 `packages/events` 暴露:

```ts
export const eventTypes = {
  agentRunStep: "agent_run.step",
  permissionAsk: "permission.ask",
  proposalOpened: "proposal.opened",
  knowledgeEvidenceReady: "knowledge.evidence.ready",
  usageRecorded: "usage.recorded",
  budgetWarning: "budget.warning",
  budgetExhausted: "budget.exhausted",
  syncConflict: "sync.conflict",
} as const;
```

页面和 Cuu 不允许手写字符串判断,必须 import 常量或 adapter。

---

## 8. F1-F11 的 TS-first 覆盖关系

| 原组件 | 原 plan 口径 | TS-first 施工口径 |
|---|---|---|
| F1 | repo + Python settings | pnpm workspace、Node 22、TS config、env schema、Docker compose(Postgres/Redis) |
| F2 | SQLAlchemy models | `packages/db/src/schema/*.ts` Drizzle schema + Zod DTO |
| F3 | Alembic | Drizzle Kit migrations + migration drift check |
| F4 | FastAPI auth deps | Hono middleware + signed cookie + device token repositories |
| F5 | PushBus broker | Redis pub/sub + `packages/events` + SSE stream writer |
| F6 | PermissionPolicy/ApprovalRequest | `packages/permissions` evaluator + `ApprovalRequest` repositories |
| F7 | Python provider registry | `packages/agent/providers` TS adapters + `packages/cost` usage sink |
| F8 | Python AgentLoop | `packages/agent` TS AgentLoop + ToolRegistry + queue worker |
| F9 | lifecycle.py milestones | `packages/events/lifecycle.ts` + notification service |
| F10 | audit/snapshot | `packages/audit` transaction wrapper + snapshot facts |
| F11 | OpenAPI client | Hono route OpenAPI + generated `packages/api-client` + Web/Tauri consumption |

**迁移要求**:每个组件 plan 可以保留现有 Python file:line 作为行为锚点,但施工任务必须在标题或任务里标出 TS 目标路径。

---

## 9. 实施切片

1. **TS-X1 contracts first**:创建 `packages/contracts`,迁入 `AttentionItem/QuestionCard/EvidenceRef/DeliverableChangeManifest/WorkHubEvent/CuuState`。
2. **TS-X2 API skeleton**:创建 `apps/api`,Hono route groups + `/api/health` + `/api/openapi.json` + SSE helper。
3. **TS-X3 DB skeleton**:创建 `packages/db`,Drizzle schema 最小表:users/projects/work_items/agent_runs/agent_steps/proposals/approval_requests/audit_logs/snapshots。
4. **TS-X4 typed client**:创建 `packages/api-client`,Web/Tauri 只从这里发请求。
5. **TS-X5 page VM layer**:创建 `apps/api/src/pages`,先落 `attention/proposal/workitem/approvals/cost` 五个页面 VM。
6. **TS-X6 Cuu adapters**:创建 `packages/events/toAttentionItem.ts` 和 `packages/cuu/toCuuState.ts`。
7. **TS-X7 Agent worker**:创建 TS queue worker,只跑 read-only/mock tools;F10 snapshot gate 未就位前拒绝 side-effect。
8. **TS-X8 Rust shell minimal rewire**:Tauri 只改 base URL、token 注入、`push-event` 分发和本地能力命令。
9. **TS-X9 Gold Path fixture**:创建 P0.5 fixture,打通 intake → AgentRun → Manifest → Proposal → Replay。
10. **TS-X10 Eval/Replay gate**:把 `ReplayTraceVM` 和 manifest/evidence fixtures 接进 CI/nightly。
11. **TS-X11 Cost governance**:创建 `packages/cost`,让 AgentRun 启动前消费 `BudgetDecision`,provider usage 写 `CostLedgerEntry`。

---

## 10. 验收门禁

- [ ] `pnpm typecheck` 覆盖 `apps/*` 和 `packages/*`。
- [ ] `packages/contracts` 生成 OpenAPI;`packages/api-client` 由 OpenAPI 生成并被 Web/Tauri import。
- [ ] `GET /api/pages/attention` 能返回 `AttentionHomeVM`;Web 和 desktop-webview 都能渲染同一 mock fixture。
- [ ] `permission.ask`、`proposal.opened`、`knowledge.evidence.ready`、`sync.conflict` 四类事件能经 `toCuuState` 映射。
- [ ] `.docx/.pptx/.xlsx/image/folder` 五类 fixture 能生成 `DeliverableChangeManifest`。
- [ ] Redis broker 关闭时 API 启动 fail-closed 或进入明确单 worker dev 模式,不得静默多 worker。
- [ ] 新页面不得直接读 ORM row;必须读 domain DTO 或 Page VM。
- [ ] Rust 侧不得复制权限判断;本地动作失败必须显示服务端返回的人话 `message`。
- [ ] Gold Path fixture 能经同一 typed client 在 Web 与 desktop-webview 渲染。
- [ ] Replay fixture 能生成 `ReplayTraceVM`,且 `AgentStep` / `Snapshot` / `EvidenceRef` 关联完整。
- [ ] `GET /api/pages/cost` 返回 `CostDashboardVM`;普通用户不含全员 `by_user`,admin 才能看全量。
- [ ] `budget.warning` / `budget.exhausted` 能经 `toAttentionItem` 与 `toCuuState` 映射。

---

## 11. 开放问题

| 问题 | 默认答案 | 何时重看 |
|---|---|---|
| Hono 还是 Fastify | P0 默认 Hono | 若 OpenAPI 生成或 SSE middleware 卡住 |
| Drizzle 还是 Prisma | P0 默认 Drizzle | 若迁移 diff/关系查询维护成本过高 |
| Bun 还是 Node | 生产默认 Node 22 LTS | 若明确需要 Bun 性能且无 runtime API 分叉 |
| Python 文档处理是否常驻 | P0 可选 worker | 当 Office/PDF 预览进入主链路 |
| 是否加 page-specific endpoints | P0 对 AI-first 关键页必须加 | 若页面 VM 和 domain API 重复到难维护 |
