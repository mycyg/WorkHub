---
title: P0 Experience + Deliverable Contracts
status: draft
date: 2026-06-05
owner: cross-cutting
depends: [F02, F05, F06, F08, F10, F11]
---

# P0 体验与交付物契约

> 本文是 P0 的横切补充契约:不施工 Web 完整页面、不施工 Cuu 桌宠、不施工完整协作合并,但先把后续不可返工的 **数据结构 / 事件名 / 客户端最小 payload / 验收红线** 定住。
> 目的只有一个:后续施工可以推迟 UI,但不能再长回重看板、聊天墙、代码 PR 心智或冷冰冰的符号化桌宠。

上游体验基线:

- [`docs/workhub/05-clients/page-concepts.md`](../../workhub/05-clients/page-concepts.md):AI-first、看板降级、桌宠优先、选项优先。
- [`docs/workhub/05-clients/cuu-desktop-pet-concept.md`](../../workhub/05-clients/cuu-desktop-pet-concept.md):Cuu 形象、气泡、动效、资产路线。
- [`docs/workhub/05-clients/web-app.md`](../../workhub/05-clients/web-app.md):Web 页面规划、选项澄清模型、交付物变更申请。
- [`docs/workhub/05-clients/desktop-pet-tauri.md`](../../workhub/05-clients/desktop-pet-tauri.md):Rust/Tauri 客户端、设备令牌门、Cuu runtime 边界。
- [`docs/workhub/03-collaboration/branch-proposal-merge.md`](../../workhub/03-collaboration/branch-proposal-merge.md):Proposal / 任意业务对象合并语义。
- [`docs/workhub/03-collaboration/review-and-approval.md`](../../workhub/03-collaboration/review-and-approval.md):审批阻塞原语。

---

## 1. P0 要守住什么

### 1.1 P0 不做 UI,但必须定契约

P0 仍然是地基期。完整 Web 新页、Cuu 动画窗、Live2D/Rive 资产、复杂 Proposal 合并语义都可以推迟。但以下契约必须在 P0 进入代码施工时同步落下,否则 P1+ 会被迫改 API、改事件、改数据库字段或改客户端抽象:

1. **选项式澄清契约**:daemon 输出的问题必须能被 Web/Cuu 渲染成可点击选项,而不是只输出聊天文本。
2. **证据气泡契约**:知识库/项目检索/AI 建议必须携带 evidence refs,客户端可渲染成 Cuu 气泡或 Web 证据卡。
3. **任意交付物变更契约**:Proposal 的 diff 不限代码;必须能描述 `.docx/.pptx/.xlsx/image/folder/binary/text/structured-record`。
4. **Cuu 事件契约**:桌宠可以只在 P1/P2 显示为简化 bubble,但 P0 的事件名和 payload 必须能驱动 Cuu 状态机。
5. **F8/F10 红线契约**:有副作用的 Agent 工具在 F10 未接入快照前不得静默执行。

### 1.2 P0 体验铁律

| 编号 | 铁律 | P0 落点 |
|---|---|---|
| UX-1 | AI 过滤复杂度,默认只递给用户一件要处理的事 | `AttentionItem` / `ApprovalRequest` / `QuestionCard` payload |
| UX-2 | 看板是高级/兜底视图,不是默认首页 | F11 不把 dashboard 作为默认验收页面;Web default route 后续指向 attention workspace |
| UX-3 | 澄清默认点选项,打字只是折叠兜底 | `QuestionCard.input_mode=single_choice|multi_choice|rank|confirm`;`free_text` 必须标 optional |
| UX-4 | 知识库/项目检索默认由 Cuu 气泡承接 | `EvidenceBubble` payload;Web knowledge page 只做完整检索兜底 |
| UX-5 | 变更申请像 PR,但对象不是代码 | `DeliverableChangeManifest` v0 |
| UX-6 | Cuu 是会动的黑猫/白猫 Live2D 桌宠入口,不是状态图标 | 事件到 `cuu_state` 的映射必须进入 SSE payload 或客户端映射表 |
| UX-7 | 用户面去黑话 | payload 可以有内部枚举,但必须同时给 `human_label` / `summary_text` |
| UX-8 | 浏览器不做本地高权限动作 | F11 / generated client 保留 Web vs Tauri 能力差异 |

---

## 2. Client-Facing Payload 最小集合

### 2.1 `AttentionItem`

`AttentionItem` 是 Web AI-first 首页、Rust 单件事工作台、Cuu 红点/气泡的共同输入。它不是新表,可由 `ApprovalRequest` / `EscalationEvent` / `Proposal` / `Notification` / `AgentRun` 聚合生成。

```ts
type AttentionKind =
  | "clarification"
  | "approval"
  | "proposal_review"
  | "escalation"
  | "sync_conflict"
  | "knowledge_result"
  | "delivery_ready"
  | "system_health";

type AttentionItem = {
  id: string;
  kind: AttentionKind;
  priority: "low" | "normal" | "high" | "urgent";
  work_item_id?: string;
  project_id?: string;
  source_ref: {
    entity_type: "approval_request" | "proposal" | "agent_run" | "notification" | "escalation_event" | "knowledge_run";
    entity_id: string;
  };
  title: string;            // 用户可见,人话
  summary_text: string;     // 一句话,给 Cuu 气泡/首页主卡
  reason_text?: string;     // 为什么现在找你
  evidence_refs?: EvidenceRef[];
  actions: AttentionAction[];
  cuu_state?: CuuState;
  created_at: string;
  expires_at?: string;
};

type AttentionAction = {
  id: string;
  label: string;
  style: "primary" | "secondary" | "danger" | "quiet";
  method: "GET" | "POST";
  href: string;             // deep-link 或 HTTP endpoint
  requires_desktop?: boolean;
  requires_reason?: boolean;
};
```

P0 施工要求:

- F11 不必新增 `/api/attention` 端点,但所有相关事件 payload 必须能无损映射为 `AttentionItem`。
- 若新增 `/api/attention` 端点,它只读聚合,不成为新真相源。
- `actions[].requires_desktop=true` 时 Web 只能展示「在桌面客户端继续」或 deep-link,不能直接执行。

### 2.2 `QuestionCard`

澄清、打回原因分类、冲突选择、知识检索入口都复用同一结构。

```ts
type QuestionCard = {
  id: string;
  session_id?: string;
  work_item_id?: string;
  title: string;
  body?: string;
  input_mode: "single_choice" | "multi_choice" | "rank" | "confirm" | "short_text" | "long_text";
  options: QuestionOption[];
  recommended_option_ids?: string[];
  free_text: {
    enabled: boolean;
    collapsed_by_default: boolean;
    placeholder?: string;
    max_length?: number;
  };
  progress: Array<{ key: string; label: string; state: "done" | "active" | "pending" }>;
  evidence_refs?: EvidenceRef[];
  submit: {
    method: "POST";
    href: string;
  };
};

type QuestionOption = {
  id: string;
  label: string;
  description?: string;
  impact?: string;
  risk_hint?: "low" | "medium" | "high";
  icon?: string;
};
```

提交选项时统一使用 `NextQuestionRequest`，Cuu 气泡、Rust 主窗和 Web 页面不得各自发明字段名：

```ts
type NextQuestionRequest = {
  selected_option_ids?: string[];
  free_text?: string;
};
```

P0 施工要求:

- `input_mode=long_text` 只能作为明确兜底,不得作为澄清主路径默认。
- `options.length` 推荐 2-5;超过 7 个必须分组或改成 rank/step。
- `recommended_option_ids` 只能是辅助高亮,不能自动提交。
- 任何 `QuestionCard` 都可以被 Cuu 气泡、Web 页面、Rust 主窗复用。
- `selected_option_ids` 必须来自 `QuestionCard.options[].id`;无效 option id 必须 400 拒绝,不得默默当作 free text。

### 2.3 `EvidenceBubble`

知识库、项目检索、AI 建议、Proposal 说明都用 evidence refs,不把证据藏在长文本里。

```ts
type EvidenceRef = {
  id: string;
  source_type: "drive_file" | "meeting" | "comment" | "work_item" | "spec_doc" | "agent_step" | "audit_log" | "external_url";
  source_id: string;
  title: string;
  excerpt?: string;          // <= 300 chars
  locator?: {
    page?: number;
    slide?: number;
    sheet?: string;
    cell_range?: string;
    timestamp_s?: number;
    path?: string;
    line_start?: number;
  };
  confidence_hint?: "found" | "weak" | "missing";
  href?: string;
};

type EvidenceBubble = {
  id: string;
  query_text?: string;
  summary_text: string;
  evidence_refs: EvidenceRef[];
  missing_evidence_note?: string;
  actions: Array<{
    id: "use_for_current_task" | "open_full_search" | "copy_summary" | "ask_followup";
    label: string;
    href?: string;
  }>;
};
```

P0 施工要求:

- `knowledge.evidence.ready` / `meeting.insight.ready` / `proposal.opened` 等事件只放摘要和 refs,完整内容由 REST 拉取。
- 若没有证据,必须明确 `missing_evidence_note`,不能假装找到了。
- Web 知识页和 Cuu 气泡同源,区别只是显示密度。

---

## 3. `DeliverableChangeManifest` v0

### 3.1 定位

`DeliverableChangeManifest` 是 Proposal 的可视化主载体,落在 `Proposal.diff_manifest JSONB`。它是 WorkHub 的"去代码 PR"层:用户看到的是「这次改了什么、影响什么、证据在哪、怎么回滚、要不要采纳」。

P0 不实现完整 merge,但 F02/F08/F10/F11 必须保证该 JSON 形态可存、可审、可通过 OpenAPI 类型生成。

### 3.2 Schema

```ts
type DeliverableChangeManifest = {
  version: 0;
  proposal_id?: string;
  work_item_id: string;
  branch_id?: string;
  title: string;
  summary_md: string;
  author: {
    actor_kind: "human" | "ai" | "system";
    actor_user_id?: string;
    label: string;
  };
  base: {
    snapshot_id?: string;
    branch_head_ref?: string;
    created_at?: string;
  };
  changes: DeliverableChange[];
  checks: DeliverableCheck[];
  evidence_refs: EvidenceRef[];
  risk: {
    level: "low" | "medium" | "high";
    human_label: string;
    reversible: boolean;
    irreversible_reasons?: string[];
  };
  rollback: {
    available: boolean;
    snapshot_id?: string;
    description: string;
  };
  review: {
    suggested_decision?: "approve" | "reject" | "needs_human";
    reason_required_on_reject: true;
  };
};

type DeliverableChange = {
  id: string;
  target_kind:
    | "structured_record"
    | "text_doc"
    | "binary_doc"
    | "spreadsheet"
    | "slide_deck"
    | "image"
    | "folder"
    | "archive"
    | "spec_doc";
  target_ref: {
    entity_type: "work_item" | "drive_item" | "delivery" | "spec_doc" | "folder" | "external";
    entity_id?: string;
    path?: string;
    version_before?: string;
    version_after?: string;
    sha256_before?: string;
    sha256_after?: string;
  };
  change_type: "created" | "updated" | "deleted" | "renamed" | "moved" | "replaced" | "generated";
  human_summary: string;
  machine_summary?: {
    before_excerpt?: string;
    after_excerpt?: string;
    changed_fields?: string[];
    row_count_delta?: number;
    slide_count_delta?: number;
    image_size_before?: string;
    image_size_after?: string;
  };
  preview_ref?: {
    kind: "text" | "image" | "pdf" | "office_preview" | "download";
    href: string;
  };
  evidence_refs?: EvidenceRef[];
};

type DeliverableCheck = {
  id: string;
  label: string;
  status: "passed" | "failed" | "warning" | "skipped";
  detail?: string;
  evidence_refs?: EvidenceRef[];
};
```

### 3.3 类型解释

| target_kind | 示例 | P0 diff 粒度 | P1+ 可升级 |
|---|---|---|---|
| `structured_record` | WorkItem 字段、验收项、任务清单 | 字段/子记录摘要 | 字段级三方合并 |
| `text_doc` | `.md`/`.txt`/代码片段 | before/after excerpt + sha256 | 文本 diff / hunk |
| `binary_doc` | `.docx`/`.pdf`/zip | 整文件版本 + preview/download | Office 结构化 diff |
| `spreadsheet` | `.xlsx`/`.csv` | sheet/range 摘要 | 单元格级 diff |
| `slide_deck` | `.pptx` | slide count + preview | slide-level diff |
| `image` | `.png`/`.jpg` | 尺寸/sha/预览 | visual diff |
| `folder` | 文件夹 | children add/remove/move 摘要 | tree diff |
| `archive` | zip/交付包 | manifest + sha | 解包 diff |
| `spec_doc` | 需求说明页 | content sha + excerpt | live spec diff |

### 3.4 P0 生成规则

- F08 Agent 完成时,若产出 `outputs/` 或业务对象变化,必须生成 `DeliverableChangeManifest` 草案。
- F10 快照服务负责给 `base.snapshot_id`、`rollback.snapshot_id`、`risk.reversible` 提供真相。
- F11 通过 OpenAPI 暴露 `Proposal.diff_manifest` 时,TS 类型要能覆盖上述字段。
- 如果某类文件无法预览,仍必须有 `human_summary`、`sha256_after`、`download` 入口。
- `checks` 至少包含:
  - `snapshot_exists`
  - `artifact_exists`
  - `evidence_linked`
  - `revert_available` 或 `ask_gate_required`

### 3.5 验收用例

1. `.docx` 交付包:manifest 中 `target_kind=binary_doc`,包含文件名、sha、下载/预览 ref、摘要、回滚说明。
2. `.pptx` 交付包:manifest 中 `target_kind=slide_deck`,包含 slide_count_delta 或 skipped detail。
3. `.xlsx` 交付包:manifest 中 `target_kind=spreadsheet`,可记录 sheet/range 摘要。
4. 图片交付:manifest 中 `target_kind=image`,包含尺寸、sha、preview ref。
5. 文件夹变更:manifest 中 `target_kind=folder`,至少列 add/remove/move 的 children 摘要。
6. 结构化记录:WorkItem title/due_at/acceptance item 变化必须以 `structured_record` 表示,不得藏在纯文本 summary。
7. 打回时 `reason_md` 必填,并作为下一轮 AgentRun 输入。
8. manifest 中任何 `risk.reversible=false` 的条目必须已触发 ask-gate 或被拒绝执行。

### 3.6 Replay merge history（R1.13 已落）

AgentRun replay 必须解释交付物变更是如何进入正式版的。R1.13 已将 `merge_attempts + merge_proposals` 收敛为 `ReplayTraceVM.merge_timeline[]`：

```ts
type ReplayMergeAttemptVM = {
  id: string;
  proposal_id: string;
  work_item_id: string;
  branch_id?: string;
  actor_kind: string;
  actor_user_id?: string;
  result: string;
  merge_snapshot_id?: string;
  conflict_count: number;
  target_keys: string[];
  accepted_target_keys: string[];
  conflicts: unknown[];
  decisions: ReplayMergeDecisionVM[];
  created_at: string;
};

type ReplayMergeDecisionVM = {
  id: string;
  conflict_key: string;
  recommended_option_key?: string;
  chosen_option_key?: string;
  chosen_by_user_id?: string;
  chosen_at?: string;
  candidates: ReplayMergeCandidateVM[];
};

type ReplayMergeCandidateVM = {
  option_key: string;
  target_kind?: string;
  rationale_md?: string;
  merged_value?: Record<string, unknown>;
  recommended: boolean;
  chosen: boolean;
};
```

端侧渲染规则：

- Replay 页面只读展示 attempt、candidate、recommended/chosen 状态，不发明新的合并动作。
- Cuu 只负责冲突轻卡和提交 option payload，不塞完整 timeline。
- Web/Desktop 主窗展示严肃“决策记录”，不出现 Cuu 本体。
- 动态 `rationale_md` 保留服务端原文；固定 chrome 走 zh-CN/en-US locale key。

---

## 4. 事件命名收敛

### 4.1 正式事件名

P0 代码实现必须使用下表 **正式名**。概念图/旧文档中的别名只可作为注释,不得成为新事件 type。

| 正式事件 type | 旧名/概念名 | topic | 主要消费方 |
|---|---|---|---|
| `agent_run.started` | `agent.run.started`, `ai.started` | `run:{id}`, `workitem:{id}` | Web trace, Cuu thinking |
| `agent_run.step` | `agent.run.step`, `run.step`, `ai.thinking/text/tool_call` | `run:{id}` | Web trace, Rust main |
| `step.tool_result` | tool result preview | `run:{id}` | Web trace, Agent replay |
| `agent_run.compacting` | `run.compacting` | `run:{id}` | Web trace |
| `agent_run.failed` | `run.failed`, `ai.failed` | `run:{id}`, `workitem:{id}` | Web/Cuu worried |
| `agent_run.escalated` | `escalation.created` | `workitem:{id}`, `user:{id}` | Cuu worried, Web detail |
| `permission.ask` | same | `session:{id}`, `user:{id}` | Cuu approval, Web approvals |
| `permission.decided` | same | `workitem:{id}`, `user:{id}` | Agent resume, audit UI |
| `proposal.opened` | `proposal.ready` | `workitem:{id}`, `user:{id}` | Web Proposal, Cuu carrying document |
| `proposal.reviewed` | same | `workitem:{id}` | Web detail |
| `proposal.merged` | `work.completed` for merged | `workitem:{id}`, `user:{id}` | Cuu celebrating |
| `step.snapshot` | same | `run:{id}` | Trace, audit |
| `knowledge.evidence.ready` | same | `session:{id}`, `user:{id}` | Cuu evidence bubble |
| `sync.progress` | same | `workitem:{id}` or `user:{id}` | Rust sync |
| `sync.conflict` | `conflict.detected` for sync | `workitem:{id}`, `user:{id}` | Rust conflict UI, Cuu worried |
| `usage.recorded` | cost usage event | `run:{id}` | Replay footer, cost reconcile |
| `budget.warning` | cost warning | `user:{id}` | Web attention banner, Cuu light bubble |
| `budget.exhausted` | cost hard stop | `user:{id}` | Agent handoff, Cuu approval/pause card |
| `notification.created` | same | `user:{id}` | Web toast, Rust OS notify |

### 4.2 Event Envelope

所有新 SSE 事件都必须能放入统一 envelope。旧事件迁移期可不全量符合,但新事件必须符合。

```ts
type WorkHubEvent<T> = {
  event_id: string;
  type: string;
  topic: string;
  ts: string;
  actor?: {
    actor_kind: "human" | "ai" | "system";
    actor_user_id?: string;
    label?: string;
  };
  work_item_id?: string;
  project_id?: string;
  session_id?: string;
  run_id?: string;
  proposal_id?: string;
  preview_text?: string;       // <= 200 chars
  cuu_state?: CuuState;
  attention?: AttentionItem;
  data: T;
};
```

成本治理 payload 统一来自 P-COST:

```ts
type BudgetScope =
  | { kind: "workitem"; workitem_id: string }
  | { kind: "user"; user_id: string }
  | { kind: "team"; team_id: string }
  | { kind: "eval"; suite: "nightly" | "release" };

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

type BudgetUsage = {
  scope: BudgetScope;
  scope_label: string;
  total_tokens: number;
  max_tokens: number;
  remaining_tokens: number;
  estimated_cost_cny: string;
  max_cost_cny: string;
  remaining_cost_cny: string;
  warning_ratio: number;
  status: "ok" | "warning" | "critical" | "exhausted";
};

type CostSummaryVM = {
  me: BudgetUsage;
  team?: BudgetUsage;
  scopes: BudgetUsage[];
  active_notices: BudgetNotice[];
  generated_at: string;
};

type CostDashboardVM = {
  generated_at: string;
  currency: "CNY";
  total_cost_cny: string;
  token_in: number;
  token_out: number;
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

约束:

- `preview_text` 不放敏感全文。
- 私有事件不得发 `all`。
- `cuu_state` 是提示,客户端可以按本地状态机覆盖。
- `attention` 可选;用于一件事卡片和 Cuu 气泡。
- `BudgetNotice.options` 必须是可点击选项;Cuu/Rust 不要求用户输入预算处理命令。
- `CostSummaryVM` 是轻量摘要,可进入 Attention/Cuu/Rust one thing;`CostDashboardVM` 是页面 VM,只由 `GET /api/pages/cost` 返回,不得塞进 SSE 事件或 Cuu 气泡。
- `BudgetDecision` 只给 AgentLoop/API 裁决使用;端侧只消费 `BudgetNotice`、`CostSummaryVM` 或 `CostDashboardVM`。

### 4.3 Cuu State

```ts
type CuuState =
  | "idle"
  | "thinking"
  | "asking_approval"
  | "carrying_document"
  | "searching_evidence"
  | "syncing_files"
  | "worried"
  | "revision_requested"
  | "celebrating"
  | "offline";
```

映射基线:

| 事件/状态 | CuuState | 展开卡 |
|---|---|---|
| `agent_run.started`, `agent_run.step` | `thinking` | 执行步骤 |
| `permission.ask` | `asking_approval` | 审批卡 |
| `proposal.opened` | `carrying_document` | 交付物变更申请 |
| `knowledge.evidence.ready` | `searching_evidence` | 证据气泡 |
| `budget.warning` | `worried` | 预算轻提示 |
| `budget.exhausted` | `asking_approval` | 暂停/降级/找管理员选项 |
| `sync.progress` | `syncing_files` | 同步队列 |
| `sync.conflict`, `agent_run.escalated`, `agent_run.failed` | `worried` | 冲突/升级卡 |
| `proposal.reviewed` with reject | `revision_requested` | 打回理由 |
| `proposal.merged`, `work.completed` | `celebrating` | 完成卡 |
| `sse-status:disconnected` | `offline` | 诊断入口 |

---

## 5. F8/F10 红线门禁

### 5.1 施工顺序

F8 可以先实现 AgentLoop、只读工具、provider、trace、队列。但 **任何 `side_effect=true` 工具解禁** 必须满足:

1. F10 `SnapshotService.take()` 已可用,且能在同一 DB transaction 内写 `Snapshot` / `AuditLog`。
2. F8 工具执行前调用 `require_snapshot_before_side_effect(ctx)`。
3. `take()` 抛错时工具不执行,返回 `ToolResult(is_error=true)`。
4. 生产环境没有“快照失败仅告警”的降级。
5. 对不可逆写,先走 F6 ask-gate;F6 不可用时硬拒绝。

### 5.2 ToolSpec 分级

```ts
type ToolSideEffect = "none" | "sandbox_file" | "business_write" | "external_effect";

type ToolSpec = {
  id: string;
  side_effect: ToolSideEffect;
  irreversible: boolean;
  requires_snapshot: boolean;
  requires_approval_when?: "risk_high" | "always" | "external";
};
```

P0 默认:

| side_effect | 示例 | 快照 | 审批 |
|---|---|---|---|
| `none` | read/search/list | 不需要 | 不需要 |
| `sandbox_file` | write/move/delete in workdir | 必须 | 高风险或不可逆时 |
| `business_write` | WorkItem 状态、Assignment、Proposal 草稿 | 必须 | 按 F6 policy/risk |
| `external_effect` | 对外通知、网络命令、发布包 | 必须 | always ask |

### 5.3 验收用例

- mock F10 未接入:side-effect 工具全部拒绝,只读工具可跑。
- mock snapshot failure:`write_file` 不落盘。
- mock approval denied:不可逆写不发生,deny reason 回灌给 AgentLoop。
- `run_command` 因网络出口未封,默认标 `external_effect`,除 allowlist 明确声明纯本地外都 ask。

---

## 6. 端侧边界

### 6.1 Web

P0/F11 对 Web 的最低要求:

- generated client 必须保留 `requires_desktop` 能力位。
- Web 可以审批、查看 Proposal、管理项目、完整检索。
- Web 不得执行接活/本地同步/本地交付/设备令牌动作。
- Web 默认入口后续指向 AI attention workspace,不是多列 Kanban。

### 6.2 Rust/Tauri

P0/F11 对 Rust 客户端的最低要求:

- `http.rs` base URL、设备令牌、SSE worker 继续是本地能力边界。
- 新事件仍走单一 `push-event` 入口,由 webview 分发。
- `permission.ask`、`proposal.opened`、`knowledge.evidence.ready` 必须能被主窗内 bubble 或未来 pet window 消费。
- 独立 `pet` window 可以推迟,但事件和 payload 不得假设只有主窗页面。

### 6.3 Cuu

P0 不交付完整 Cuu,但必须做到:

- `cuu_state` 或客户端映射表可由正式事件名驱动。
- `QuestionCard`、`EvidenceBubble`、`AttentionItem` 能渲染成 Cuu 气泡。
- 审批卡动作必须有明确 `href` / `method` / `requires_reason`。
- 资产目录和运行时路线仍以 `cuu-desktop-pet-concept.md` 为准;P0 不把 Cuu 降级成 bot icon 的最终方案。

---

## 7. 跨组件落点

| 组件 | 必补内容 |
|---|---|
| F02 实体模型 | `Proposal.diff_manifest` 明确承载 `DeliverableChangeManifest v0`;不新增表 |
| F05 事件 broker | 正式事件名表 + envelope;topic 鉴权仍是核心 |
| F06 权限引擎 | `ApprovalRequest.payload_json` 可承载 `AttentionItem` / `DeliverableChangeManifest` 摘要;deny reason 必填 |
| F08 Agent 引擎 | 生成 manifest 草案;side-effect 分级;正式事件名;Cuu state hint |
| F09 通知 | `AttentionItem` 可由 notification/escalation 映射;文案人话 |
| F10 审计快照 | manifest 中 rollback/snapshot/checks 的真相源 |
| P-COST 成本治理 | `BudgetNotice` / `CostSummaryVM` / `usage.recorded` 的真相源;AgentLoop 只消费 `BudgetDecision` |
| F11 客户端改接 | OpenAPI generated types 覆盖 payload;Web/Tauri 能力差异;SSE hook 消费正式事件 |

---

## 8. P0 新增验收门禁

1. **选项式澄清契约**:`QuestionCard` 类型出现在 OpenAPI schema 或 shared TS 类型中;澄清主路径不只返回纯文本。
2. **证据气泡契约**:`EvidenceRef` 可被知识检索、Proposal、升级理由复用;无证据时有 `missing_evidence_note`。
3. **交付物变更契约**:至少 5 类非代码交付物 fixture 生成 `DeliverableChangeManifest`。
4. **成本治理契约**:`BudgetNotice` / `CostSummaryVM` 出现在 shared TS 或 OpenAPI schema;`budget_exhausted` 统一走 `ApiErr.code`。
5. **事件命名契约**:新代码中正式事件名来自集中常量;grep 不新增 `agent.run.started` / `proposal.ready` 等旧名实现。
6. **Cuu state 契约**:`permission.ask` / `proposal.opened` / `knowledge.evidence.ready` / `budget.exhausted` / `sync.conflict` 至少五类事件能映射到 `CuuState`。
7. **红线契约**:F10 未就位时 side-effect 工具硬拒绝;F10 就位后快照失败拒绝副作用。
8. **端侧边界**:generated client / action payload 能标记 `requires_desktop`;Web 不渲染本地高权限执行按钮。
9. **去黑话**:用户可见 payload 有 `title` / `summary_text` / `human_label`,不要求客户端直接展示内部 enum。

---

## 9. 建议 PR 切分

1. **P0-X1 shared types**:新增 `AttentionItem` / `QuestionCard` / `EvidenceRef` / `DeliverableChangeManifest` / `WorkHubEvent` / `CuuState` 类型与测试 fixture。
2. **P0-X2 event constants**:集中事件常量和别名迁移说明,F05/F08/F09/F11 改引用。
3. **P0-X3 proposal manifest**:F02/F08/F10 接入 `Proposal.diff_manifest` 生成与校验。
4. **P0-X4 side-effect gate**:F08/F10 协同,实现 side-effect 分级与 fail-closed stub。
5. **P0-X5 client compatibility**:F11 generated client 暴露这些类型,Web/Tauri hook 只做最小消费测试。

*本文是 P0 地基对产品体验的保护层。凡与本文冲突的组件 plan,以本文和上游 `05-clients` 概念文档共同收口。*
