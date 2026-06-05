---
title: WorkHub Agent Eval / Replay Plan
type: cross-cutting-plan
status: draft
date: 2026-06-05
depends:
  - ./_gold-path-p0-5-vertical-slice.md
  - ./_experience-deliverable-contracts.md
  - ./F08-agent-engine-core-plan.md
  - ./F10-audit-snapshot-rollback-plan.md
---

# WorkHub Agent Eval / Replay Plan

> **一句话**:WorkHub 的 Agent 不能只靠“看起来跑通”。每一次 AgentRun 都必须可回放,每一次模型/工具/提示词调整都必须过 eval fixtures,否则 AI-native 会变成不可验证的黑箱。

---

## 1. 目标

1. **Replay Work**:用户能打开“看看 AI 怎么做的”,用人话时间线回放 Agent 的关键步骤、证据、工具调用、快照和决策。
2. **Eval Gate**:开发者改 prompt、工具、模型、路由、权限、manifest 生成逻辑时,必须跑 golden fixtures。
3. **Schema Guard**:所有 LLM 输出先过 schema 校验;失败要有 repair / fallback / escalation,不能把坏结构扔给页面。
4. **Evidence Guard**:AI 建议必须能绑定证据;无证据时必须显式说“没找到证据”。
5. **Cost/Latency Guard**:每个 AgentRun 有 token、成本、耗时、工具调用次数和人工打回率指标。

---

## 2. Replay Trace Contract

### 2.1 `ReplayTraceVM`

```ts
type ReplayTraceVM = {
  run_id: string;
  workitem_id: string;
  title: string;
  outcome: "completed" | "proposal_opened" | "escalated" | "failed" | "stopped";
  summary: string;
  steps: ReplayStepVM[];
  evidence_refs: EvidenceRef[];
  snapshots: SnapshotRef[];
  proposal_id?: string;
  cost: {
    input_tokens: number;
    output_tokens: number;
    estimated_cost: string;
    latency_ms: number;
  };
};

type ReplayStepVM = {
  step_id: string;
  index: number;
  kind:
    | "thought"
    | "tool_call"
    | "tool_result"
    | "evidence"
    | "snapshot"
    | "manifest"
    | "decision"
    | "error";
  title: string;
  human_summary: string;
  raw_ref?: string;
  evidence_refs?: EvidenceRef[];
  snapshot_ref?: SnapshotRef;
  redacted: boolean;
};
```

### 2.2 Replay 页面原则

- 默认展示 5-12 个关键步骤,不是完整日志墙。
- 每步都是人话标题 + 摘要 + 可展开 raw。
- 工具入参/结果默认脱敏;敏感内容只给有权限用户展开。
- 快照/回滚点必须可见。
- 若 Agent 失败,Replay 仍要解释“失败在哪里、下一步怎么办”。

---

## 3. Eval 数据集

### 3.1 Golden fixtures

| Fixture | 目的 | 预期结果 |
|---|---|---|
| `clarify_option_first_basic` | 澄清不退化为聊天 | 返回 `QuestionCard` 且有推荐选项 |
| `weekly_report_manifest_doc` | 文档交付物变更包 | 生成 doc/markdown target + evidence + rollback |
| `ppt_change_manifest` | PPT 非代码 PR | target_kind=`slide_deck`, preview/download refs |
| `xlsx_change_manifest` | 表格变更 | target_kind=`spreadsheet`, checks 包含公式/行列摘要 |
| `image_asset_manifest` | 图片资产变更 | target_kind=`image`, preview/sha/risk |
| `folder_reorg_manifest` | 文件夹结构变更 | target_kind=`folder`, affected paths |
| `missing_evidence` | 无证据场景 | `missing_evidence_note` 必填,不得编造证据 |
| `low_confidence_escalation` | 低置信升级 | `agent_run.escalated` + `AttentionItem` |
| `permission_required_tool` | 权限 ask gate | 生成 `permission.ask`,不执行副作用 |
| `snapshot_fail_closed` | 快照失败红线 | side-effect 被拒绝,Replay 说明原因 |
| `budget_threshold_warning` | 成本接近阈值 | provider fixture 写 `UsageRecord`→`CostLedgerEntry`;触发 `budget.warning`;Replay footer 显示当前 run cost summary |
| `budget_exhausted_handoff` | 成本硬上限耗尽 | `BudgetDecision.allowed=false` 时返回 `ApiErr.code=budget_exhausted`;运行中耗尽时产结构化交接 |
| `revision_feedback_loop` | 打回理由回灌 | 下一轮 context 包含用户理由 |
| `sync_conflict_choice` | 冲突调解 | 返回 `ConflictChoice[]` + recommended choice |

### 3.2 Eval 输入形态

```text
evals/
  fixtures/
    weekly_report_manifest_doc/
      input.json
      evidence/
      expected.manifest.partial.json
      expected.events.json
      expected.replay.partial.json
```

`expected.*.partial.json` 使用局部匹配,避免对 LLM 文案做脆弱精确比较。

---

## 4. Eval 维度

| 维度 | 自动检查 | 人工抽检 |
|---|---|---|
| Schema validity | Zod parse | 页面是否自然 |
| Evidence grounding | evidence id 必须来自 fixture | 摘要是否忠实 |
| No hallucinated sources | 禁止未知 source id | 是否有误导表达 |
| Option-first | `QuestionCard.options.length >= 2` | 问题是否好点选 |
| Manifest completeness | target/evidence/risk/rollback/checks | 是否像人能审的 PR |
| Permission safety | side-effect 前必须 ask/snapshot | 权限文案是否清楚 |
| Replay readability | steps 关键字段齐全 | 回放是否能解释过程 |
| Cost/latency | token/耗时阈值 | 是否值得自动跑 |
| Budget policy | warning/exhausted 事件与 `CostLedgerEntry` | 是否该降级或停 |
| Cuu mapping | event → CuuState | 动作是否符合语境 |

---

## 5. Replay 运行机制

### 5.1 Trace 来源

| 来源 | 存储 | Replay 使用 |
|---|---|---|
| `AgentRun` | DB | run 状态、耗时、owner |
| `AgentStep` | DB / object storage raw ref | 步骤标题、工具调用、结果摘要 |
| `WorkHubEvent` | event log / AgentStep mirror | 时间线事件 |
| `AuditLog` | DB | 业务写入事实 |
| `Snapshot` | DB + object storage | 回滚点 |
| `DeliverableChangeManifest` | `Proposal.diff_manifest` | 产出说明 |
| `EvidenceRef` | DB/json | 证据来源 |
| `CostLedgerEntry` | DB | cost footer、预算阈值、模型路由依据 |

### 5.2 Replay endpoint

| Endpoint | 返回 | 权限 |
|---|---|---|
| `GET /api/agent-runs/:id/replay` | `ReplayTraceVM` | run owner / workitem viewer |
| `GET /api/agent-runs/:id/steps/:stepId/raw` | raw JSON/text | 更严格;默认脱敏 |
| `POST /api/agent-runs/:id/replay/export` | Markdown/HTML report | viewer + audit permission |

### 5.3 Redaction

默认脱敏:

- API keys / tokens / cookies
- 文件绝对路径中的用户名
- 邮箱/手机号
- 成本明细中的全员排行:非 admin 只保留当前用户切片
- 不属于当前用户权限范围的证据内容
- tool raw stdout 中的密钥模式

---

## 6. CI / 本地命令

### 6.1 命令

```text
pnpm eval:fixtures
pnpm eval:fixtures -- --fixture weekly_report_manifest_doc
pnpm replay:fixture -- weekly_report_manifest_doc
pnpm eval:report
```

### 6.2 门禁

| 阶段 | 必跑 | 可选 |
|---|---|---|
| PR 快速检查 | schema/evidence/manifest fixtures | 无模型 mock replay |
| Nightly | 真实模型 golden eval | 成本/延迟趋势 |
| Release | 全量 fixtures + Playwright replay screenshots | 人工抽检 |

### 6.3 最小通过标准

- Schema pass rate = 100%
- 禁止 hallucinated evidence = 0
- Side-effect without snapshot/ask = 0
- Replay endpoint fixture pass = 100%
- Manifest target coverage >= docx/pptx/xlsx/image/folder
- CuuState mapping coverage >= `permission.ask/proposal.opened/knowledge.evidence.ready/sync.conflict`
- Budget threshold fixture pass = 100%;`retry`/`compact` usage 必须计入 run 成本,`nightly eval` 必须进 `scope.kind="eval"` 而非用户/team 配额

---

## 7. 指标

| 指标 | 说明 |
|---|---|
| `agent_success_rate` | AgentRun 到 proposal/complete 的比例 |
| `human_revision_rate` | 用户打回比例 |
| `first_pass_accept_rate` | 第一次审批通过比例 |
| `missing_evidence_rate` | 无证据显式说明比例 |
| `hallucinated_evidence_count` | 编造证据次数 |
| `avg_steps_per_run` | 平均步骤数 |
| `avg_cost_per_run` | 平均成本 |
| `p95_latency_ms` | 95 分位耗时 |
| `snapshot_fail_closed_count` | 快照失败拒绝次数 |
| `permission_ask_rate` | ask gate 触发比例 |

---

## 8. 与页面/Cuu 的关系

| 能力 | 页面 | Cuu |
|---|---|---|
| Replay Work | `/agent-runs/:id/replay` | 复杂时 deep-link 打开 |
| Evidence confidence | Proposal / Evidence panel | `searching_evidence` 气泡 |
| Revision feedback | Proposal timeline | `revision_requested` |
| Snapshot/revert | Proposal Detail / Replay | `worried` if unavailable |
| Cost summary | Replay footer / admin metrics | 不直接打扰用户 |

---

## 9. 实施切片

1. **ER-1 Trace contract**:新增 `ReplayTraceVM` / `ReplayStepVM`。
2. **ER-2 Fixture runner**:scripted AgentRun fixture 可生成 replay。
3. **ER-3 Manifest eval**:覆盖 doc/ppt/xlsx/image/folder。
4. **ER-4 Evidence guard**:source id 必须来自 fixture。
5. **ER-5 Replay page**:低保真页面渲染 trace。
6. **ER-6 Real model nightly**:接真实 provider,不阻塞本地快速 PR。
7. **ER-7 Metrics**:把指标写入 AgentRun summary / dashboard seed。

---

## 10. 禁止事项

- 禁止只存最终答案,不存 AgentStep。
- 禁止 eval 只看“有没有报错”。
- 禁止在无证据时编造引用。
- 禁止 Replay 页面展示完整 raw log 但没有人话摘要。
- 禁止真实模型 eval 进入每个 PR 的硬阻塞,导致开发不可用;PR 用 mock/fixture,nightly 用真实模型。
