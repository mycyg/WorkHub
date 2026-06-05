---
title: WorkHub Gold Path + P0.5 Vertical Slice
type: cross-cutting-plan
status: draft
date: 2026-06-05
depends:
  - ./_experience-deliverable-contracts.md
  - ./_ts-first-module-port-page-alignment.md
---

# WorkHub Gold Path + P0.5 Vertical Slice

> **一句话**:所有地基、页面、Cuu、Agent、审计和事件规划,都必须服务同一条黄金路径:用户一句话提需求 → Cuu 选项澄清 → Agent 执行 → 生成交付物变更申请 → 用户审批/打回 → 合并 → 通知/回滚/审计可见。
>
> 这不是完整产品施工,而是 P0.5 的最小纵切。它允许 Agent 先 mock,允许页面先 fixture,但不允许 schema、事件、Page VM、Cuu 状态彼此脱节。

---

## 1. Gold Path

### 1.1 用户叙事

1. 用户在 Web 或 Rust 主窗里说一句话:「帮我整理一个客户周报模板,用上上次会议和项目网盘里的数据」。
2. Cuu 弹出选项式澄清卡,让用户点选范围、截止时间、格式和是否需要审批。
3. 用户点选后,系统创建 `WorkItem` 与 `AgentRun`,Cuu 进入 `thinking`。
4. Agent 读取知识/会议/网盘证据,生成一个 `.docx` 或 Markdown 文档草案。
5. Agent 生成 `DeliverableChangeManifest`,说明改了什么、证据来自哪里、风险是什么、如何回滚。
6. 系统发出 `proposal.opened`,Cuu 进入 `carrying_document`,Web/Rust 可打开 Proposal Detail。
7. 用户在审批卡里点「采纳」或「打回」;打回必须给理由,理由回灌给 Agent。
8. 若采纳,系统合并交付物,发 `proposal.merged`,Cuu `celebrating`,通知写入收件箱。
9. 全程可打开 AgentRun replay,能看到关键步骤、证据、快照和回滚点。

### 1.2 黄金路径表

| Step | 用户看到什么 | Endpoint / event | Payload | 页面 / Cuu | 必须落地的组件 |
|---|---|---|---|---|---|
| 1. 输入意图 | 一句话输入 + 附件/项目上下文 | `POST /api/sessions` | `SessionVM` | Web intake / Rust one thing | F2,F4,F11 |
| 2. 选项澄清 | Cuu/页面问一个问题,给选项 | `POST /api/sessions/:id/next-question` | `QuestionCard` | Option Wizard / Cuu chips | 契约,F11 |
| 3. 创建工作项 | “我开始处理了” | `POST /api/workitems` | `WorkItemDetailVM` | WorkItem detail | F2,F6,F11 |
| 4. Agent 开跑 | 进度流、工具步骤、人话摘要 | `POST /api/workitems/:id/agent-runs`, `agent_run.started/step` | `WorkHubEvent<AgentStep>` | Live Trace / Cuu thinking | F5,F7,F8 |
| 5. 证据查找 | “我找到这些来源” | `knowledge.evidence.ready` | `EvidenceBubble` | Evidence panel / Cuu search bubble | F8,P1 knowledge |
| 6. 产出变更包 | 非代码 PR 页面 | `proposal.opened` | `DeliverableChangeManifest` | Proposal Detail / Cuu carrying doc | F2,F8,F10,F11 |
| 7. 审批/打回 | 审批卡、理由、记住规则 | `POST /api/proposals/:id/review` | `AttentionItem` | Approval Center / Cuu approval | F6,F9,F11 |
| 8. 合并完成 | 完成通知、可回滚入口 | `proposal.merged`, `notification.created` | `AttentionItem` | Timeline / Cuu celebrate | F9,F10,F11 |
| 9. Replay | “看看 AI 怎么做的” | `GET /api/agent-runs/:id/replay` | `ReplayTraceVM` | Replay Work | Eval/Replay,F8,F10 |

---

## 2. P0.5 Vertical Slice

### 2.1 目标

P0.5 是 P0 和 P1 之间的产品验证切片。目标不是完整功能,而是**真实点击一遍黄金路径**。

| 层 | P0.5 允许 mock | P0.5 必须真实 |
|---|---|---|
| Agent | 可用 scripted agent / fixture tool result | AgentRun/AgentStep 持久化、事件、replay trace |
| 交付物 | 可生成 Markdown/HTML 代替 Office | `DeliverableChangeManifest` 结构真实 |
| 审批 | 可只有 approve/request changes | `ApprovalRequest` / reason / notification 真实 |
| Cuu | 可用静态小猫 + CSS 动效 | `CuuState` 映射真实 |
| 页面 | 可低保真但可点 | Page VM、路由、typed client 真实 |
| 审计 | 可只覆盖文件/Proposal 写 | Snapshot/AuditLog/revert facts 真实 |

### 2.2 最小实体

- `User`
- `Project`
- `WorkItem`
- `Session`
- `AgentRun`
- `AgentStep`
- `EvidenceRef`
- `Proposal`
- `ApprovalRequest`
- `Notification`
- `AuditLog`
- `Snapshot`

### 2.3 最小 endpoint

| Endpoint | 用途 | 返回 |
|---|---|---|
| `POST /api/auth/identify` | 登录/昵称 | `Identity` |
| `POST /api/sessions` | 创建 intake session | `SessionVM` |
| `POST /api/sessions/:id/next-question` | 选项澄清 | `QuestionCard` |
| `POST /api/workitems` | 创建工作项 | `WorkItemDetailVM` |
| `GET /api/pages/attention` | 当前一件事 | `AttentionHomeVM` |
| `POST /api/workitems/:id/agent-runs` | 开始 Agent | `AgentRun` |
| `GET /api/push/stream/run/:id` | Agent SSE | `WorkHubEvent<T>` |
| `GET /api/pages/proposals/:id` | 提议详情 | `ProposalDetailVM` |
| `POST /api/proposals/:id/review` | 通过/打回 | `ReviewResult` |
| `POST /api/proposals/:id/merge` | 合并 | `MergeResult` |
| `GET /api/agent-runs/:id/replay` | 回放 | `ReplayTraceVM` |

### 2.4 最小页面

| 页面 | 路由 | 目标 |
|---|---|---|
| AI-first Home | `/` | 只展示当前一件事 + 后台运行 |
| Option Intake | `/intake/:sessionId` | 选项式澄清 |
| WorkItem Detail | `/workitems/:id` | 工作项状态 + live trace preview |
| Proposal Detail | `/proposals/:id` | 非代码 PR |
| Replay Work | `/agent-runs/:id/replay` | AI 关键步骤回放 |
| Approval Center | `/approvals` | 阻塞收件箱 |

### 2.5 最小 Cuu 状态

| 事件 | Cuu state | 展开卡 |
|---|---|---|
| session question ready | `asking_approval` | `QuestionCard` |
| agent running | `thinking` | 进度气泡 |
| evidence ready | `searching_evidence` | `EvidenceBubble` |
| proposal opened | `carrying_document` | Proposal summary |
| sync/conflict/low confidence | `worried` | 风险卡 |
| proposal merged | `celebrating` | 完成卡 |

---

## 3. Fixture 设计

### 3.1 项目 fixture

```text
Project: 客户成功周报
WorkItem: 生成客户周报模板
Evidence:
  - meeting: 上次周会纪要
  - drive: 项目网盘 / 数据汇总.xlsx
  - comment: 客户希望格式更像日报
Deliverable:
  - weekly-report-template.md
  - preview.html
```

### 3.2 Agent fixture

Agent 不必一开始真调用 LLM。P0.5 可用 scripted trace:

1. `agent_run.started`
2. `agent_run.step` read meeting
3. `knowledge.evidence.ready`
4. `agent_run.step` write deliverable
5. `step.snapshot`
6. `proposal.opened`

**要求**:scripted trace 必须和真实 Agent 使用同一 `AgentStep` / `WorkHubEvent` / `DeliverableChangeManifest` 类型。

---

## 4. Gold Path 验收

- [ ] 用户从 `/` 进入,能完成一次 option-first intake,全程不需要长篇打字。
- [ ] Cuu 至少经历 `asking_approval → thinking → carrying_document → celebrating`。
- [ ] AgentRun replay 页面能展示不少于 5 个关键步骤。
- [ ] Proposal Detail 能显示非代码变更包,含 `summary/targets/evidence/risk/rollback/checks`。
- [ ] 用户打回时必须填写理由;理由出现在下一轮 Agent context 中。
- [ ] 用户采纳后能看到 `proposal.merged`、通知、审计记录和回滚入口。
- [ ] Web 与 Tauri webview 渲染同一 Page VM fixture。
- [ ] 所有用户可见 payload 来自 `packages/contracts` 或 OpenAPI generated types。

---

## 5. 禁止事项

- 禁止把 Gold Path 做成聊天墙。
- 禁止 Proposal 页面只支持代码 diff。
- 禁止 Cuu 只是静态图标,没有状态映射。
- 禁止 Web/Tauri/Cuu 各自手写 payload。
- 禁止 Agent mock 使用不同于真实 Agent 的事件和 trace 类型。
- 禁止审批通过后没有审计和快照事实。

---

## 6. 与其他计划关系

| 文档 | Gold Path 对它的要求 |
|---|---|
| `_experience-deliverable-contracts.md` | 提供 QuestionCard/EvidenceRef/Manifest/Event/CuuState |
| `_ts-first-module-port-page-alignment.md` | 提供模块、端口、Page VM、Endpoint→Cuu 对齐 |
| `_agent-eval-replay-plan.md` | 提供 trace replay 与 eval gate |
| `_interaction-extension-backlog.md` | 提供 P1+ 交互增强,不能阻塞 P0.5 |
| F08 | AgentRun/AgentStep/ToolRegistry 必须支持 replay |
| F10 | Snapshot/AuditLog 必须给 Manifest facts |
| F11 | 必须提供 Page VM 与 generated client |
