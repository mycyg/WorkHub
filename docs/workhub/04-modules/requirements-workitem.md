---
module: M-WORKITEM
layer: 业务模块（Business Module）— web + 桌宠两端
status: 🚧
owner: workflow
---

# 需求 / 工作项（M-WORKITEM）— 全功能 + 页面规划

> **一句话**：WorkItem 是 WorkHub 的**主轴**（演进自 `Requirement`，`app/models.py:314`）。一条工作从 intake → 澄清 → 规格就绪 → **AI 工人默认执行** → 置信度/风险分级 →（自动合并 / 人工抽检 / 升级换帽）→ 审批 → 合并 main →（可派生）。本篇把这条主轴**逐页**拆成 web（派活/管理/审批侧）与桌宠（接活/干活侧）两端的页面规划——给完整路由清单、每页的布局 / 组件 / 数据与 API 绑定 / SSE 订阅 / 四态（空·载入·错误·无权限）/ 关键交互与跳转流 / 响应式与 web↔桌宠差异，并尽量给文字版 wireframe。
>
> **上游（已读以统一口径，交叉处只引用不复述）**：
> - PRD：[`../../prd/2026-06-04-workhub-prd.md`](../../prd/2026-06-04-workhub-prd.md)（§7.1 状态机、§8 机制、领域表 WorkItem/Assignment/Delivery/AcceptanceCriteria）
> - 规格树索引（三端一核、模块地图、本篇范围）：[`../README.md`](../README.md)
> - 架构总图 / 进程边界 / SSE topic / 设备令牌门：[`../01-architecture/system-architecture.md`](../01-architecture/system-architecture.md)
> - 命门（置信度/风险/三触发器/打回回灌、`ConfidenceRecord`/`EscalationEvent` 字段）：[`../02-ai-engine/confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md)
> - 经理模式编排（升级简报/派活/催办/再审/`PendingDecision`）：[`../02-ai-engine/pm-mode-orchestration.md`](../02-ai-engine/pm-mode-orchestration.md)
> - 智能派活（`StaffingProposal`、`Suggestion`、冷启动）：[`../02-ai-engine/smart-staffing.md`](../02-ai-engine/smart-staffing.md)
> - **前向引用（尚待落定，先用规格树约定文件名）**：实体/字段/状态机全量 → [`../01-architecture/data-model.md`](../01-architecture/data-model.md)；OpenAPI 路由组与事件清单 → [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md)；去黑话术语权威 → [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md)；客户端壳（路由表/导航/桌宠窗口）→ [`../05-clients/web-app.md`](../05-clients/web-app.md) · [`../05-clients/desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md)。
>
> **参照代码（已读以扎根，下文引真实路径）**：`app/models.py`；web=`web/src/pages/{Home,ProjectView,NewRequirement,Clarify,RequirementDetail,PlanningPage,Dashboard}.tsx` + `web/src/App.tsx`；桌宠=`client-tauri/web-src/src/{App,routes/Hub,routes/HubDispatch,routes/TaskDetail,components/SpaceSwitcher,components/SidebarWork,components/FloatingAssistant}.tsx`。

---

## 0. 范围与非范围

**本篇定义**：
- M-WORKITEM 的**字段 / 状态流转 / 派生 / 验收项**全功能（§1–§3）。
- **web 端**页面规划：项目内工单列表、提需求向导、澄清、工单详情、派活看板（§5）。
- **桌宠端**页面规划：接活/派活双空间、接活 Hub、工单工作台、交付向导、桌宠浮窗（§6）。
- 两端**状态 × 可见性 × 可操作性**矩阵、SSE 实时订阅、四态、跳转流、响应式与差异（§4/§7/§8）。

**本篇不定义**（在邻篇，避免重复）：置信度怎么算、风险怎么评、三触发器如何点火、打回如何回灌 → [`confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md)；升级后经理模式编排细节 → [`pm-mode-orchestration.md`](../02-ai-engine/pm-mode-orchestration.md)；派活匹配打分 → [`smart-staffing.md`](../02-ai-engine/smart-staffing.md)；Branch/Proposal/合并/冲突调解 → [`branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md)；分层 allow/deny/ask 审批与审批路由 → [`review-and-approval.md`](../03-collaboration/review-and-approval.md)；网盘/会议/通知/知识库各自模块页面 → 04-modules 同级各篇；客户端壳的导航/托盘/deep-link/同步 → 05-clients。本篇**消费**这些产物（`ConfidenceRecord`/`EscalationEvent`/`StaffingProposal`/`Proposal`/`Notification`），只规定它们在**工作项页面里怎么呈现与如何交互**。

**现状基线（诚实标注）**：今天 `Requirement` 状态机是串行的 `draft|clarifying|summary_ready|ready|ai_processing|claimed|doing|delivery_doc_pending|delivered|revision_requested|accepted|cancelled`（`models.py:328-330`），打回（`RevisionRequest`）只回到 `doing` 给**人**重做、理由不回灌（见命门篇 §6.2 T2）。本篇按 PRD §7.1 把它演进为「AI 默认执行 + 分级 + 升级换帽 + 打回回灌 + 分支提议合并」，**是 P1 旗舰的增量，不是已实现的复述**。下文凡标 *(现状)* = 今天已有可直接移植；标 *(WorkHub 新增/演进)* = 需新建。

---

## 1. WorkItem 字段（演进自 `Requirement`）

> 全量字段与类型/约束以 [`data-model.md`](../01-architecture/data-model.md) 为权威；此处给**页面渲染需要的字段子集**与「现状 → WorkHub」对照。复用 `TimestampMixin`（`created_at/updated_at`）、`uid()` 主键、软删除范式（`models.py:20-23`）。

| 分组 | 字段（现状锚点） | 页面用途 | WorkHub 演进 |
|---|---|---|---|
| **标识** | `id` / `code`（`PROJ-001`，`models.py:318` + `Project.next_seq:87`） | 列表/详情页头部、URL `/r/:id` | 不变；`code` 仍是对用户的"工作编号" |
| **归属** | `project_id`（`:319`）、`submitter_user_id`（`:320`） | 面包屑、列表分组、"由谁提" | 不变；叠加 `org_id`/`workspace_id`（多租户预留） |
| **派单** | `claimed_by_user_id/_nickname`（`:321-322`）+ `RequirementAssignment(role=lead\|collaborator)`（`:363`） | "负责人 X +N"、派活/改派 | `Assignment` 为权威；`claimed_by_*` 退为兼容快照 |
| **内容** | `title` / `raw_description` / `summary_md`（`:324-326`） | 列表标题、详情概览、规格页 | `summary_md` 演进为 **README=规格活文档**（见 [`sync-and-spec.md`](../03-collaboration/sync-and-spec.md)） |
| **状态** | `status`（`:328`） | StatusBadge、可见性/可操作性裁决（§4） | 扩展状态机（§2） |
| **优先级/估算** | `priority` / `estimate_hours` / `estimate_confidence` / `planning_note`（`:331-334`） | 优先级 chip、概览卡、排期负载 | 不变；估算喂智能派活 `effort` 信号 |
| **排期** | `start_at` / `due_at`（`:336-337`） | DDL chip（逾期/今日着色）、日历、催办 | 不变；催办规则读 `due_at`（PM 篇 R1/R2） |
| **派生** | `source_meeting_id`（`:338`）、`source_requirement_id`（`:341`） | "源自会议/源自 XXX"链接 | 不变；派生链（§3.2） |
| **生命周期时间戳** | `claimed_at`/`done_at`/`delivered_at`/`delivery_doc_ready_at`/`accepted_at`（`:344-348`） | 时间线、活动 tab | 扩 `merged_at`/`escalated_at` |
| **同步** | `sync_state`（`pending\|synced\|failed`，`:350`） | 桌宠端同步徽标 | 双向同步（[`sync-and-spec.md`](../03-collaboration/sync-and-spec.md)） |
| **子实体** | `attachments` / `chat_messages` / `deliveries` / `assignments` / `workspaces` / `task_plans` / `acceptance_items`（`:354-360`） | 详情各 tab | 新增 `confidence_records` / `escalation_events` / `branches` / `proposals` 关系 |

**WorkHub 新增（页面需直接渲染的命门对象，字段定义在邻篇）**：
- `ConfidenceRecord`（命门篇 §2.1）：`confidence_band`/`risk_tier`/`verdict`/`verdict_reason_md` —— 详情页"AI 把握度"卡的数据源；**数值/阈值绝不下发客户端**（PRD 宪法 §4）。
- `EscalationEvent`（命门篇 §2.2）：`trigger`/`reason_md`/`handoff_md`/`suggested_assignees`/`status` —— 详情页"升级简报"卡。
- `Branch` / `Proposal`（[`branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md)）：详情页"交付物/提议"区与审批弹层。

---

## 2. 状态流转（页面以此裁决可见性/可操作性）

> 完整状态机与全量转移以 [`data-model.md`](../01-architecture/data-model.md) 为权威；命门相关切面见 [`confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md) §7.1，经理模式段见 [`pm-mode-orchestration.md`](../02-ai-engine/pm-mode-orchestration.md) §1。本篇画"页面要识别的状态簇"。

### 2.1 状态簇（页面只需按"簇"切换形态，不必记全枚举）

```
intake / ai_clarifying / spec_ready      ── 簇A「沟通中」→ 跳澄清页(§5.3)
ai_working                               ── 簇B「AI 在干」→ 详情显 AgentRun live(§5.4)
  ├ verdict=auto_merge → auto_proposal → merged     ── 簇F「已合并/完成」
  ├ verdict=spotcheck  → human_spotcheck            ── 簇D「等你抽检」(审批弹层)
  └ verdict=escalate   → escalated → pm_mode        ── 簇C「升级·经理模式」
human_doing                              ── 簇E「人在干」→ 桌宠工作台(§6.3)
ai_re_review                             ── 簇B'「AI 在审人产出」
in_review                                ── 簇D「等你确认 Proposal」
  ├ approve → merged                     ── 簇F
  └ reject(带理由) → ai_working(回灌) / human_doing / reassign
merged → (派生后续) / done               ── 簇F
cancelled                                ── 簇G「已取消」
```

> *(现状)* 今天 `RequirementDetail.tsx:210` 与 `ProjectView.tsx:188` 各自硬编码了一张 `statusProgress` 表把状态映射成进度条百分比；WorkHub 把这套"状态→簇→进度/形态"收口为 **C-UIKIT 的 `statusCluster()` 工具 + `StatusBadge`**（`web/src/components/StatusBadge.tsx` 已是 `@yqgl/shared` 的 re-export shim），两端共用，避免重复硬编码。

### 2.2 状态 × 簇 × 进度 × 主行动（页面映射表）

| 簇 | 状态（含演进） | 进度% | StatusBadge 文案（人话） | 详情页主行动区 | 实时事件（type @ topic） |
|---|---|---|---|---|---|
| A 沟通中 | intake/ai_clarifying/spec_ready *(现状 draft/clarifying/summary_ready)* | 5 | "沟通中" | → 跳澄清页 | 澄清流（独立 SSE，`useChatStream`） |
| B AI 在干 | ai_working *(现状 ai_processing)* | 50 | "AI 正在做" | AgentRun live 视图（只读） | `agent_run.step` @ `workitem:<id>` |
| B' AI 再审 | ai_re_review *(新增)* | 70 | "AI 正在看一遍" | 再审进度（只读） | `agent_run.step` @ `workitem:<id>`（mode=pm 再审）|
| C 升级 | escalated/pm_mode *(新增)* | 60 | "需要你来定一下" | 升级简报卡 + 派活建议卡 | `escalation.created` @ `workitem:<id>`+`user:<id>`；派活建议见 PM 篇 |
| D 等审 | human_spotcheck/in_review *(演进 delivered)* | 90 | "等你确认" / "等你扫一眼" | 审批面板（采纳/打回） | `confidence.assessed` / `proposal.opened` @ `workitem:<id>` |
| E 人在干 | human_doing/doing/claimed *(现状)* | 15–45 | "进行中" / "已接单" | 桌宠工作台（进度/清单/动态） | `requirement.updated`+`workspace.updated` @ `req:<id>` |
| F 完成 | merged/accepted *(演进)* | 100 | "已采纳 ✅" | 派生后续 / 看结果 | `proposal.merged` @ `workitem:<id>` |
| G 取消 | cancelled *(现状)* | 0 | "已取消" | （只读） | `requirement.updated`(status=cancelled) @ `req:<id>` |

> **事件名权威**：上表「实时事件」列的 type 与 topic 以 [`api-contract.md`](../01-architecture/api-contract.md) §5.2「事件类型清单」为准（现有事件 `requirement.updated`/`workspace.updated` 已落地；`agent_run.step`/`confidence.assessed`/`escalation.created`/`proposal.opened|reviewed|merged` 是该篇定的 WorkHub 新增事件）。本篇只标"页面订阅哪条、收到做什么"，不另造事件名；PM 模式专属的派活提议/抽检/催办/再审事件以 [`pm-mode-orchestration.md`](../02-ai-engine/pm-mode-orchestration.md) 为准。
> **去黑话纪律**：StatusBadge 与一切按钮文案对用户**只说人话**——"等你确认 / 已采纳 / 撞车了 AI 给了方案"，绝不出现 `merge`/`branch`/`proposal`/`escalate`/`confidence` 等词（PRD §8.5 映射、[`glossary-dejargon.md`](../00-overview/glossary-dejargon.md)）。内部状态枚举与 topic 仍用英文。

---

## 3. 派生与验收项

### 3.1 验收项（`RequirementAcceptanceItem`，`models.py:464`）*(现状已有)*
- 字段：`title`/`description`/`status`(open|hit)/`sort_order`/`source_plan_id`（来自 `RequirementTaskPlan`）。
- **页面呈现**：详情页"概览" tab 已渲染验收清单（`RequirementDetail.tsx:488-503`）+ 计数卡（`:477-480`）。WorkHub 增强：每条验收项旁显示 **AI 命中态徽标**（满足/部分/未满足），数据来自命门篇 §3.2 的"逐条命中率"——这是置信度的输入，也是用户判断"AI 做对没"的最直观证据。
- **写入点**：澄清→投递阶段的"投递拆解"（`stage=dispatch`）产出 `item_type=acceptance` 的拆解项，人确认后落 `RequirementAcceptanceItem`（`RequirementDetail.tsx:580-751` 的 `DecompositionPanel` + `apply_confirmed_plan`）。

### 3.2 派生（一条工作生出另一条）*(现状已有 source 链)*
- **源自会议**：`source_meeting_id`（`models.py:338`）—— 会议洞察确认后创建需求（M-MEETING），详情页头部显"源自会议 ◯◯"链接。
- **源自工作项**：`source_requirement_id`（`:341`）—— 一条工作完成（merged）后派生后续。
- **WorkHub 页面落点**：簇F「完成」详情页主行动区出现 **"派生后续工作"** 按钮 → 走提需求向导（§5.2）并预填 `source_requirement_id` + 继承项目/负责人建议。派生链在概览以"← 源自 / → 派生出"双向链呈现。

### 3.3 两阶段拆解 *(现状已有，桥接 AI 工人)*
- `RequirementTaskPlan(stage=dispatch|worker)` + `RequirementTaskItem(item_type=task|risk|acceptance)`（`models.py:425-461`）：投递前拆验收（dispatch）、接单后拆个人清单（worker），**都要人工确认才落库**（`DecompositionPanel` 文案 `RequirementDetail.tsx:668`）。
- WorkHub 复用此路径作为"AI 工人执行前的规格细化"与"经理模式拆解排期"的共同底座（见 PM 篇 §5.1）。

---

## 4. 两端总纲：可见性 / 可操作性矩阵（页面规划的地基）

> 这张矩阵是后续每页"谁能看到什么 tab / 什么按钮"的**单一裁决依据**，落地为 C-UIKIT 的 `usePermissions(workItem, me, runtime)` hook，两端共用。它收口现有散落判断：`RequirementDetail.tsx` 的 `canClaim/canStartDoing/canManageAssignees/isWorker`（`:203-207`）、tab 的 `desktopOnly`（`:46`）、`ASSIGNEE_MANAGE_STATUSES`（`:60`）。

### 4.1 角色（对工作项而言）
- **提交者 submitter**：`me.id === submitter_user_id` —— 管派活/改派、审 Proposal（默认负责人=提交者时）。
- **负责人 lead / 协作者 collaborator**：`Assignment.role`；干活、交付、在自己 Branch 工作。
- **审批人 approver**：`PendingDecision.approver_user_id`（审批路由解析，多数=lead/submitter）。
- **旁观者**：有项目可见权但非以上 —— 只读。
- **admin**：`User.is_admin` 短路放行（`models.py:36`、`services/permissions.py`）。

### 4.2 设备令牌门（D-3 延续，决定 web↔桌宠差异的根）
> 来自 [`system-architecture.md`](../01-architecture/system-architecture.md) §3 + README §1：**接活/干活/交付/同步**类高权限操作要求**桌面客户端**（服务端校验 `ClientDevice.client_token_hash`，`auth.py:183`）；浏览器只能**派活 / 审批 / 改派 / 看**。这是下面"web 无某按钮、桌宠才有"的统一原因，不在每页重复解释。

### 4.3 可见性 / 可操作性矩阵

| 能力 | web（浏览器） | 桌宠（C-PET） | 现状锚点 |
|---|---|---|---|
| 看工作项详情 / 概览 / 验收 / 对话 / 活动 / 评论 | ✅ | ✅ | `RequirementDetail.tsx:42` 全 tab |
| "我的工作区" tab（进度/清单/动态） | ❌（`desktopOnly`） | ✅ | `:46` |
| 接这单 / 开始做 / 交付 | ❌ | ✅（设备令牌门） | `:204-205`；桌宠 `Hub.tsx:130` |
| 改派接单人 / 管理负责人协作者 | ✅（提交者/admin） | ✅ | `:206` `canManageAssignees` |
| 让 AI 先试（触发工人） | ✅（投递时勾选） | ✅ | `Clarify.tsx:404` `autoProcess` |
| 审 Proposal：采纳 / 打回(带理由) | ✅（审批人） | ✅ | 演进 `DeliverablesTab`（`:527`） |
| 抽检快速通过/打回 | ✅ | ✅ | 新增（簇D） |
| 升级简报 / 确认派活建议 / 调整计划 | ✅（审批人/负责人） | ✅ | 新增（消费 PM 篇 `PendingDecision`） |
| 人工保留开关（不让 AI 干） | ✅ | ✅ | 新增（命门篇 §2.3 `HumanOnlyPolicy`） |

---

## 5. web 端页面规划（C-WEB：派活 / 管理 / 审批侧）

> web 路由现状见 `web/src/App.tsx:152-174`（`react-router-dom` `<Routes>`）。M-WORKITEM 相关页面如下；**逐页**给布局/组件/数据/SSE/四态/交互。顶栏=`App.tsx` 的 sticky glass `TopNav`（项目·看板▾·日程·通知·⌘K·主题·昵称），全站共用，下文不再重复画顶栏内部，只标"复用全局顶栏"。

### 5.0 路由清单（web，M-WORKITEM 范围）

| # | 路由 | 页面 | 现状文件 | 本篇章节 |
|---|---|---|---|---|
| W1 | `/p/:id` | 项目内工单列表（项目首页·需求 tab） | `ProjectView.tsx` | §5.1 |
| W2 | `/p/:id/new` | 提一条新需求（5 步向导） | `NewRequirement.tsx` | §5.2 |
| W3 | `/r/:id/clarify` | 澄清（AI 对话 → 规格 → 投递/让 AI 试） | `Clarify.tsx` | §5.3 |
| W4 | `/r/:id` | 工作项详情（tab 容器：概览/拆解/对话/附件/交付/评论/活动） | `RequirementDetail.tsx` | §5.4 |
| W5 | `/dashboard` | 派活看板（PM/提交者全局视角） | `Dashboard.tsx` | §5.5 |
| W6 | `/planning` | 资源排期 / 负载（按接单人看 WorkItem 分布） | `PlanningPage.tsx` | §5.6 |

> `/notifications`（通知中心）与 `/calendar`（日程）虽承载 WorkItem 升级/催办/DDL，但归 [`tasks-reminders-notifications.md`](./tasks-reminders-notifications.md)；本篇只在跳转流里引用它们。

---

### 5.1 W1 — 项目内工单列表 `/p/:id` *(现状 `ProjectView.tsx`)*

**职责**：一个项目下所有 WorkItem 的列表 + 项目级 tab 导航（需求/网盘/会议/知识库/排期/健康）。是提交者/负责人进入单条工作的主入口。

**布局（文字版 wireframe）**：
```
[← 全部项目]
项目 ‹eyebrow›
项目名 {name}              [+ 提一条新需求] [归档] [删除]
‹slug pill› [已归档?] [回收站?]
────────────────────────────────────────────────────────
[需求✓] [网盘] [会议] [知识库] [排期] [健康]        ← 项目级 tab 行(底边线)
────────────────────────────────────────────────────────
┌ 工单行（可点 → /r/:id） ───────────────────────────────┐
│ ▣ {code} {title}                          [StatusBadge] →│
│   👤{submitter}  👥 负责人 {lead}+N | 公开池             │
│   🗓 {created_at}                                        │
│   进度 ▓▓▓▓░░░░ 45%                                      │
└─────────────────────────────────────────────────────────┘
（更多行…）
```

- **顶栏**：复用全局顶栏。**主区**：列表（无侧栏，`narrow-container`）。**项目级 tab**：当前 `ProjectView.tsx:154-179`（需求/网盘/会议/知识库/排期/健康）。
- **关键组件**：`StatusBadge`、进度条、`ProjectStateConfirm`（归档/删除/恢复确认弹层）。
- **数据 & API 绑定**：`api.getProject(id)` + `api.listRequirements({project_id})`（`ProjectView.tsx:33-35`）；带 monotonic token 防竞态（`:23` 注释）。
- **SSE 订阅**：*(WorkHub 新增)* 订阅 `workitem:<projectId 下各 id>` 或项目级聚合事件（演进自桌宠 `Hub.tsx:77` 对 `requirement.ready/.updated` 的 `all` 监听），收到即 `refresh()` 让新工单/状态变更实时入列，不必手刷。
- **四态**：
  - **空**：`empty-state「还没有需求」`（`:183`）→ CTA "提一条新需求"。
  - **载入**：`「加载中…」`（`:75`）。
  - **错误**：`paper-surface` 红字 + [重试][回项目列表]（`:64-73`，404 时不再无限"加载中"）。
  - **无权限**：项目不可见 → 后端 403 → 走错误态文案"你没有这个项目的访问权"。
- **关键交互/跳转**：行点击 → W4 详情；`[+ 提一条新需求]` → W2；项目 tab → 各模块页。
- **响应式**：行在 `sm` 以下纵向堆叠（`:194` `flex-col sm:flex-row`）；操作按钮 `w-full sm:w-auto`。
- **web↔桌宠差异**：桌宠**无项目工单列表页**——桌宠以"接活/派活双空间 + 按状态分组"组织（§6.2），项目维度在桌宠是 `/p/:projectId` 网盘视图（`client-tauri` `ProjectDrive`）。

---

### 5.2 W2 — 提一条新需求 `/p/:id/new` *(现状 `NewRequirement.tsx`)*

**职责**：5 步向导收集最小必要信息 → 创建 draft → 交棒澄清页。步骤：`想说的事 → 谁来做 → 截止时间 → 附件 → 跟 AI 聊聊`（`NewRequirement.tsx:23-29`）。

**布局（文字版 wireframe）**：
```
提一条新需求 ‹eyebrow›
{当前步骤标题}                                   ← h1 随步骤变
[●想说的事]—[○谁来做]—[○截止]—[○附件]—[○跟AI聊]   ← Stepper(可回跳，不可前跳)
┌ paper-surface ─────────────────────────────────┐
│ (step0) 多行描述 textarea + 🎤语音 + 优先级chips │
│ (step1) AssigneeSelector(负责人+协作者，可留空)  │
│ (step2) 预计开始 / 截止*(必填) / 工时 / 信心     │
│ (step3) FileUpload + 已传附件列表(已解析徽标)    │
│ (step4) ✨"差不多了" → [下一步：跟 AI 聊聊]      │
│ [上一步]                         [下一步/保存并继续]│
└─────────────────────────────────────────────────┘
```

- **布局**：无侧栏，`narrow-container max-w-4xl`；`Stepper`（`@yqgl/shared`）+ 单 `paper-surface` 表单卡。
- **关键组件**：`Stepper`、`AssigneeSelector`、`FileUpload`、`VoiceButton`、优先级 chips（`PRIORITY_CHIPS`，`:31`）。
- **数据 & API**：step2 末（拿齐必填）调 `api.createRequirement(projectId, {...})` 建 draft（`:145`）；附件在有 `reqId` 后才能传（`:317`）。带 `draftSeq`/`goNextSeq` 锁防双建（`:137` 注释）。
- **SSE 订阅**：无（创建前无实时需求）。
- **四态**：
  - **空/初始**：step0 空 textarea + 引导占位文案。
  - **载入**：按钮态"保存中…/附件上传中"（`:377`）。
  - **错误**：步内校验红字（"先写一下要做什么""截止时间是前提"`:128-134`）+ 上传未完成阻断（`blockIfUploading`，`:96`）。
  - **无权限**：归档/回收站项目不应到此（W1 已隐藏入口）；直达 URL 时后端拒建 → 错误态。
- **关键交互/跳转**：step4 `[下一步：跟 AI 聊聊]` → `nav('/r/:id/clarify')`（`:177-181`）。
- **响应式**：表单 grid `sm:grid-cols-2`/`sm:grid-cols-[1fr_180px]`。
- **web↔桌宠差异**：桌宠也有提需求（`client-tauri` `routes/NewRequirement.tsx`，入口在派活空间 `HubDispatch` 或浮窗"新建为需求"`FloatingAssistant.tsx:268`），向导一致；差异是桌宠在"派活空间"内发起、可由桌宠浮窗自然语言一句话起草。

---

### 5.3 W3 — 澄清 `/r/:id/clarify` *(现状 `Clarify.tsx`)*

**职责**：AI 与提交者多轮对话把模糊需求打磨成清晰规格（summary）→ 决定**投递给负责人**还是**让 AI 先试一遍**（这是 J2"AI 默认干完"主路径的入口）。

**布局（文字版 wireframe，双栏）**：
```
┌ 左 aside (sticky, 280px) ─┐ ┌ 右 主区：对话线程 ────────────────┐
│ [← 项目]                  │ │  🤖 AI 提问气泡 / 💬 用户气泡       │
│ {code} {title}            │ │  …(history)…                       │
│ [StatusBadge]             │ │  ┌ LiveBubble：AI 思考中… ┐         │
│ ── 接单人 [管理] ──        │ │  │ (thinking 折叠 / 流式 text)│       │
│  负责人pill / 公开池       │ │  └────────────────────────┘         │
│ ── 附件 ──                │ │  ┌ QuestionCard(选择/开放) ┐        │
│  file (已解析)            │ │  │ 选项按钮 / 文本框+🎤+发送 │        │
│ [够了，给我总结]           │ │  └────────────────────────┘         │
└───────────────────────────┘ │  ┌ SummaryCard(规格就绪) ───────┐   │
                               │  │ 最终需求 {title} [复杂度][AI可处理]│ │
                               │  │ summary_md 预览               │   │
                               │  │ 投递 DDL: [datetime]          │   │
                               │  │ ☑ 让 AI 助理先试一遍(建议)     │   │
                               │  │ [让 AI 助理先试 / 投递给负责人] │   │
                               │  └──────────────────────────────┘   │
                               └──────────────────────────────────────┘
```

- **布局**：`grid lg:grid-cols-[280px_1fr]`（`Clarify.tsx:275`）。**左栏=面板**（meta/接单人/附件/"给我总结"）；**右栏=主区**（对话流 + 当前问题/总结卡）。
- **关键组件**：`Bubble`/`LiveBubble`/`QuestionCard`/`SummaryCard`、`AssigneeSelector`、`StatusBadge`、`VoiceButton`/`SpeakButton`（语音问答/朗读）。
- **数据 & API**：`api.getRequirement`+`listAttachments`+`listChatMessages`（`:102-106`）；问答 `api.postAnswer` + 重跑流（`:245`）；强制总结 `force_summarize`（`:260`）；投递分叉 `api.autoProcess`（让 AI 试）或 `api.submitRequirement`（投递人）（`:404-411`）。
- **SSE 订阅**：澄清流式走 `useChatStream(reqId)`（`:79`，自有 SSE：thinking/text/parsed/done/error）；`stream.done` → `refresh()`（`:161`）。
- **四态**：
  - **空**：无历史且 draft/clarifying → **自动开第一轮**（`:166-177` `autoStarted`），不留白。
  - **载入**：`「加载中…」`（`:189`）；流内 `「让我想一下…」`（`:492`）。
  - **错误**：加载失败红字 + [重试]（`:179`）；流错误红字（`:430`）。
  - **无权限**：非提交者看澄清 → 后端按 `can_view_requirement_record` 裁决；只读时隐藏"管理接单人"（`canManageAssignees`，`:210`）与投递按钮。
- **关键交互/跳转**：
  - 投递（不试 AI）→ `submitRequirement` → 状态 `ready`（公开池/指定人）→ `nav('/r/:id')`。
  - 让 AI 先试 → `autoProcess` → 状态 `ai_working`(*现状 ai_processing*) → `nav('/r/:id')` 看 live。
  - 详情页若发现状态仍在簇A，会**自动重定向回澄清页**（`RequirementDetail.tsx:167-171`、`:188-197`），保证"没澄清完不进详情"。
- **响应式**：`lg` 以下左栏不再 sticky、单列堆叠；卡片输入区 `flex-col md:flex-row`。
- **web↔桌宠差异**：桌宠 `routes/Clarify.tsx` 同构；桌宠额外可由托盘/deep-link `yqgl://r/<id>` 直达（见 §6 与 `RequirementDetail.tsx:391` 的 web→桌宠跳转链）。
- **WorkHub 演进**：`SummaryCard` 的"让 AI 助理先试一遍（失败会自动转给人）"勾选（`Clarify.tsx:704`）正是 PRD §8.1"AI 默认驾驶"的入口——WorkHub 把它从**可选勾选**升级为**默认勾选**（除非命中"人工保留"开关，命门篇 §2.3），并在勾选区旁加一句人话风险提示（高风险/对外时）。

---

### 5.4 W4 — 工作项详情 `/r/:id`（核心页）*(现状 `RequirementDetail.tsx`)*

**职责**：单条 WorkItem 的全貌与全操作中枢。tab 容器；按状态簇切换"主行动区"。这是 M-WORKITEM 最重的页面，也是 WorkHub 新增"AI 把握度 / 升级简报 / 提议审批"三块的落点。

**布局（文字版 wireframe）**：
```
[← {project_slug}]
{code}
{title}                                        [改派接单人][接这单/开始做][在桌面端继续→][🔊]
[StatusBadge] by {submitter} | 负责人{lead}+N | 等人接 · {created_at}
🗓 截止 {due_at}(逾期/今日着色)
工作区进度 ▓▓▓▓░ 45%  · N个阻塞
[公开池 / 负责人pill / 协作pill…]
─────────────────────────────────────────────
‹动态横幅区(按簇)›
 簇B: ┌ AILiveView：AI 正在做（trace 流式）┐
 簇C: ┌ 升级简报卡：为什么卡 + 建议谁做 + 计划 [确认/调整/我来定] ┐   ← WorkHub 新增
 簇D: ┌ AI 把握度卡：「我比较有把握，建议你扫一眼」+ 验收命中 [采纳][打回(写原因)] ┐ ← WorkHub 新增
─────────────────────────────────────────────
[概览][我的工作区*桌宠][拆解][对话历史][附件(n)][交付物][评论][活动]   ← tab 行
─────────────────────────────────────────────
‹tab 主区›
```

- **顶栏**：复用全局顶栏。**主区**：`narrow-container max-w-6xl` 单列（header + 横幅 + tab + tab 内容）。**面板**：改派接单人弹出区（`AssigneeSelector`，`:408-440`）、审批弹层（采纳/打回，WorkHub 新增）。**弹层**：打回写原因 modal、人工保留开关 modal。
- **关键组件**（现状）：`StatusBadge`、`AssigneeSelector`、`AILiveView`（`:445`，AI 处理时显 trace）、`ActivityTimeline`、`CommentsPanel`、`DeliverablesTab`、`SpeakButton`；tab 内 `WorkspaceBoard`/`DecompositionPanel`/`ChatHistory`（同文件内组件）。
- **关键组件**（WorkHub 新增，挂在动态横幅/对应 tab）：
  - **`ConfidenceCard`（AI 把握度卡）**：消费 `ConfidenceRecord`（命门篇 §2.1）。**只渲染人话**：`verdict_reason_md` + band→文案映射（"我比较有把握"/"我不太确定，建议你扫一眼"）+ 验收清单逐条命中徽标 + risk_tier→人话（"这事改动较大/对外，我先请你拍板"）。**绝不显数值**（命门篇 §1）。簇D 时浮现，带 [采纳][打回(写原因)]。
  - **`EscalationBriefCard`（升级简报卡）**：消费 `EscalationEvent` + PM 篇 `EscalationBrief`（§3）。三段式：为什么卡（`reason_md` 首句，附 trace 引用）/ 建议谁做（嵌入 `StaffingSuggestionCard`）/ 计划（`plan_md`）。行动 = `PendingDecision`：[确认这样推进][调整][我自己来定]。
  - **`StaffingSuggestionCard`（派活建议卡）**：消费 `StaffingProposal`/`Suggestion`（smart-staffing 篇 §4.2/§4.3）。每个被荐人显"为什么推荐他"（`why[].headline` + 可点开 `evidence`，含 `caveat` 如"他手上有 1 个逾期"）。行动：[确认这个安排][换个负责人▾][改协作人][我自己来定]。**`_score`/`_subscores` 不下发**（smart-staffing 篇 §4.2 硬约束）。
  - **`ProposalReviewPanel`（提议审批面板）**：演进自 `DeliverablesTab`（`:527`）。簇D `in_review` 时显"AI/人整理好的成果 + 对照验收清单的勾选 + 变更说明"，行动 [采纳（汇入正式版）][打回（写原因）]。打回理由必填 → 回灌（命门篇 §7.2）。
- **tab 清单**（`ALL_DETAIL_TABS`，`:42-53`）：概览 / 我的工作区(`desktopOnly`) / 拆解 / 对话历史 / 附件(n) / 交付物 / 评论 / 活动。tab 由 `?tab=` 同步 URL（`:298-307`），非法值归一到概览（`:62`）。**WorkHub 新增 tab/区**：把 ConfidenceRecord 历史轮次、EscalationEvent 时间线并入"活动"tab（统一 trace 呈现，见 [`explainability.md`](../02-ai-engine/explainability.md)）。
- **数据 & API**：`api.getRequirement` + `Promise.all([listAttachments, listRequirementWorkspaces(桌宠), listTaskPlans, listAcceptanceItems])`（`:108-122`），带 `refreshToken` 防 `/r/A→/r/B` 串数据（`:99-102` 注释）。动作：`claimRequirement`/`patchStatus('doing')`/`updateAssignees`（`:240/260/281`）。WorkHub 新增动作：`POST /decisions/{id}/confirm|adjust|reject|delegate`（PM 篇 §8.2）、采纳/打回 Proposal、设/撤"人工保留"。
- **SSE 订阅**：`useReqStream(id)`（`:91`）→ `{events, latestStatus}`；`latestStatus` 变 → `refresh()`（`:166`）；`events` 喂 `AILiveView`。**WorkHub 扩展**（topic 体系见架构篇 §5.2、事件名见 api-contract §5.2、汇总见本篇 §7）：在 `workitem:<id>` 上接收 `agent_run.step`(trace) / `confidence.assessed`(把握度) / `escalation.created`(升级) / `proposal.opened\|reviewed\|merged`(审批) / `conflict.detected`(撞车)；私有审批询问 `permission.ask` 走 `user:<id>`（NFR-08 按身份隔离）。
- **四态**：
  - **空**：各 tab 自带空态（附件"无附件"`:518`、对话"无对话"`:555`、工作区"还没有个人工作区"`:767`、拆解"还没有拆解草稿"`:691`）。
  - **载入**：整页 `「加载中…」`（`:185`）；tab 内子加载各自处理。
  - **错误**：整页加载失败红字 + [重试]（`:173-183`）；动作失败 `actionErr` 横幅（`:406`）；子组件（对话）独立错误+重试（`:549`）。
  - **无权限**：非 worker 不显接单/开始做（`canClaim/canStartDoing` 含 `desktopRuntime` 且 `isWorker`，`:204`）；非提交者不显改派（`canManageAssignees`，`:206`）；"我的工作区"tab 对 web 整体隐藏（`desktopOnly`）；后端 403 → 错误态。
- **关键交互/跳转**：
  - 簇A 自动跳澄清（`:167`）。
  - web 上 worker 想干活 → `[在桌面客户端继续 →]`（`yqgl://r/:id` deep-link，`:389-398`）跳桌宠。
  - 簇D 采纳 → `merged` → 横幅转"已采纳✅" + 出现"派生后续"。
  - 簇C 确认派活 → `human_doing`，被指派人收通知（PM 篇 §4.2）。
- **响应式**：header `flex-col lg:flex-row`（`:316`）；概览卡 `md:grid-cols-3`（`:468`）；tab 行横向滚动（`scrollbar-thin-warm overflow-x-auto`，`:450`）。
- **web↔桌宠差异**：桌宠详情=`client-tauri/web-src/src/routes/TaskDetail.tsx`（**接活方**重排：突出"我的工作区/交付"，弱化派活管理）；"我的工作区"tab 仅桌宠可编辑（`WorkspaceCard.canEdit = isDesktop && me.id===workspace.user_id`，`:790/917`）。审批/改派/升级确认两端都在（设备令牌门不挡审批类）。

---

### 5.5 W5 — 派活看板 `/dashboard` *(现状 `Dashboard.tsx`)*

**职责**：提交者/PM 的**全局**视角：跨项目看"我派出去的"工作项状态分布、需我处理的（待审/升级/抽检）。是 PM 把关的主入口（对应桌宠"派活空间"Hub）。

**布局（文字版 wireframe）**：
```
派活看板 ‹eyebrow›
[筛选: 项目▾ / 状态簇▾ / 仅需我处理]
┌ 概览统计条：在跑AI N · 等我审 M · 已升级 K · 本周DDL J ┐   ← WorkHub 增"等我处理"聚合
├ 待我处理（簇C/D 优先）────────────────────────────────┤
│  {code} {title} [簇D 等你确认] [负责人] [去处理→/r/:id] │
├ AI 正在做（簇B）──────────────────────────────────────┤
│  {code} {title} [AI 正在做] live点状指示                │
├ 进行中 / 已完成 分组…                                   │
└────────────────────────────────────────────────────────┘
```

- **布局**：无侧栏，统计卡条 + 分组列表（按状态簇分区，"待我处理"置顶）。
- **关键组件**：统计卡、`StatusBadge`、工单行（复用 W1 行样式）、筛选器。WorkHub 新增"待我处理"聚合区（汇集 `PendingDecision`/`spotcheck`/`escalation` 指向我的项）。
- **数据 & API**：`api.listRequirements`（按 submitter/参与过滤）+ WorkHub 新增 `GET /api/me/inbox?kind=approval|escalation`（汇总需我拍板的）。
- **SSE 订阅**：`user:<me.id>`（私有：派活建议/抽检/审批路由到我）+ 关注的 `workitem:<id>` 状态。收 `escalation.created`（@ `user:<id>`，api-contract §5.2）或 PM 模式派活/抽检事件（PM 篇）即把对应行移入"待我处理"并角标提示。
- **四态**：空"暂时没有需要你处理的"；载入骨架；错误横幅+重试；无权限（未登录走 NicknameDialog，`App.tsx:78`）。
- **关键交互/跳转**：行 → W4 对应簇的主行动区（直接落到审批/简报卡）。
- **响应式**：统计卡 `grid md:grid-cols-4`；分组列表单列。
- **web↔桌宠差异**：桌宠对等视图=`routes/HubDispatch.tsx`（派活空间），但桌宠按"派给我处理 / 我派出"分组、聚焦个人；web `/dashboard` 是更宽的 PM 看板。看板度量（自治率/升级精准度/成本）归 [`dashboards-and-metrics.md`](./dashboards-and-metrics.md)，本页只放"工作项工作流"维度。

---

### 5.6 W6 — 资源排期 / 负载 `/planning` *(现状 `PlanningPage.tsx`)*

**职责**：按接单人看 WorkItem 分布、负载、逾期/阻塞——派活与改派的决策辅助；也是智能派活 `LoadSnapshot` 信号的可视化对照（smart-staffing 篇 §2.3 复用 `GET /api/planning/workload`）。

**布局（文字版 wireframe）**：
```
资源排期 ‹eyebrow›  排期 / 负载        [筛选: 项目▾]
┌ 范围 ┐┌ 估算工时 ┐┌ 满载人员 ┐┌ 阻塞 ┐
└ 全部 ┘└ 128.0h  ┘└   2     ┘└  3   ┘
┌ 人员卡(2xl 双列) ─────────────────────────┐
│ ●在线 {nickname} [空闲/忙碌]      load 80% │
│ N任务 · 24/30h · 1逾期 · 2阻塞 · 3本周到期 │
│ ▓▓▓▓▓▓▓░ (load 着色)                      │
│  ├ {code} {title} [status] 🗓DDL [阻塞?] 45%│ ← 点 → /r/:id
│  └ …                                       │
└────────────────────────────────────────────┘
```

- **布局**：`app-container`；统计 `grid md:grid-cols-4`（`:83`）+ 人员卡 `grid 2xl:grid-cols-2`（`:106`）。每张卡内嵌该人的 WorkItem 链接列表。
- **关键组件**：负载条（`tone(load)` 着色，`:8`）、在线点、`pill`(空闲/忙碌)、工单子行（点 → `/r/:id`，`:139`）。
- **数据 & API**：`api.listProjects` + `api.workload({project_id})`（`:32-34`）；带 monotonic token 防串项目数据（`:27` 注释）。
- **SSE 订阅**：*(WorkHub 新增)* `workspace:<id>` 或项目级负载事件，进度/阻塞变更实时重算（现状靠 `[projectId]` 重载，`:47`）。
- **四态**：空"暂时没排上活"（`:134`）；载入"加载排期..."（`:104`）；错误横幅（`:102`）；无权限（项目过滤越权 → 后端裁决）。
- **关键交互/跳转**：人员卡内工单 → W4；负载/逾期/阻塞是改派判断依据，可跳 W4 改派。
- **响应式**：卡内 `md:flex-row`；统计 `md:grid-cols-4`。
- **web↔桌宠差异**：桌宠对应"我的负载"=`routes/MyWorkload.tsx`（只看自己）；web `/planning` 看全员（PM 视角）。

---

## 6. 桌宠端页面规划（C-PET：接活 / 干活侧）

> 桌宠 = Tauri v2 壳 + React webview（README §1 C-PET）。**两个空间**：`work`(接活/我接的) 与 `dispatch`(派活/我派出的)，由 `SpaceSwitcher` 切换（`Ctrl+1/2`，`SpaceSwitcher.tsx:14-31`、`App.tsx:112-122`）。路由现状见 `client-tauri/web-src/src/App.tsx:308-324`（扁平路由）。布局骨架 = `TitleBar`(顶) + `Sidebar`(左，按空间变) + 主区 + `FloatingAssistant`(右下浮窗，常驻)。

### 6.0 路由清单（桌宠，M-WORKITEM 范围）

| # | 路由 | 页面 | 现状文件 | 空间 | 本篇章节 |
|---|---|---|---|---|---|
| P1 | `/`（`work` 空间） | 接活 Hub（公共池/派给我的/进行中/待返工/近期交付） | `routes/Hub.tsx` | work | §6.2 |
| P2 | `/`（`dispatch` 空间） | 派活 Hub（我派出的工作项管理） | `routes/HubDispatch.tsx` | dispatch | §6.2 |
| P3 | `/r/:id` | 工作项工作台（接活方详情：工作区/拆解/交付/审批） | `routes/TaskDetail.tsx` | both | §6.3 |
| P4 | `/r/:id/clarify` | 澄清（同 web，桌宠壳内） | `routes/Clarify.tsx` | both | §5.3 引用 |
| P5 | `/r/new` | 提一条新需求（桌宠壳内向导） | `routes/NewRequirement.tsx` | dispatch | §5.2 引用 |
| P6 | `/me/workload` | 我的负载（只看自己） | `routes/MyWorkload.tsx` | work | §6.4 引用 |
| — | （浮窗，非路由） | 桌宠 AI 助理浮窗（问功能/问项目/一句话起草/接收升级催办） | `components/FloatingAssistant.tsx` | both | §6.5 |

> `/inbox`（通知）、`/me/calendar`、`/me/knowledge`、`/me/pulse`、`/p/:projectId`（网盘）承载 WorkItem 的通知/日程/检索/网盘，归各自模块篇；本篇只在跳转流引用。桌宠 Rust 侧能力（托盘/通知/deep-link/spec_watch/双向同步）归 [`desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md)。

### 6.1 桌宠骨架（两端差异之源）
```
┌ TitleBar：[需求管理大师] [SpaceSwitcher:接活▾] … [SSE●连接态] [窗口控件] ┐
├ Sidebar(随空间) ┬ 主区(路由) ─────────────────────────────┐
│ 接活栏(SidebarWork): │   {当前路由页面}                          │
│  公共池/派给我的/进行中│                                          │
│  /待返工/近期交付      │                                          │
│  ── 视角 ──            │                                          │
│  我的负载/日程/检索/快报│                                          │
│  ── 通知/设置 ──       │                                          │
│ 派活栏(SidebarDispatch)│                                          │
└────────────────────────┴──────────────────────────[✨浮窗(右下)]─┘
```
- **接活栏** `SidebarWork.tsx`：工单分组用 `/?tab=public|mine|active|revision|delivered`（同 pathname `/`，按 tab 值判激活，`:42`）。**派活栏** `SidebarDispatch.tsx`（派活空间）。
- **设备令牌门**：桌宠已持 `client_token`（`App.tsx:147-158` 启动自动注册设备）；这是桌宠能接活/干活/交付而 web 不能的根（§4.2）。

---

### 6.2 P1/P2 — 接活 Hub / 派活 Hub `/` *(现状 `Hub.tsx` / `HubDispatch.tsx`)*

**职责**：桌宠主页，按空间二选一渲染（`HubRouter`，`App.tsx:89-92`）。接活 Hub = 协作人找活、推进自己手上的工作；派活 Hub = 提交者管自己派出的工作项。

**布局（接活 Hub，文字版 wireframe）**：
```
{分组标题：公共池/派给我的/进行中/待返工/近期交付}      [刷新][清除过滤]
{items.length} 条
┌ TaskCard ───────────────────────────────────────────┐
│ {code} {title}  [StatusBadge]                         │
│ 负责人/DDL/进度…                          [接单/开始做]│  ← 行内主行动随状态
└───────────────────────────────────────────────────────┘
（更多…）
```

- **布局**：左 `Sidebar`(分组) + 主区列表；`p-6 overflow-auto`（`Hub.tsx:149`）。主行动按钮**在卡内行内**（`ready`→接单 / `claimed`→开始做，`:222-244`）。
- **关键组件**：`TaskCard`、`StatusBadge`、`EmptyState`、`Skeleton`、`Button`（`@yqgl/shared`）。
- **数据 & API**（经 Tauri `invoke`，非直接 fetch）：`invoke('list_public_pool')` / `invoke('list_my',{assignedToMe})`，按 tab 客户端过滤状态（`:44-59`）；动作 `invoke('claim')` / `invoke('patch_status',{status:'doing'})`（`:133/142`），带 monotonic token + busy set 防并发/乱序（`:24-27` 注释）。
- **SSE 订阅**：`useEvent('push-event')` 监听 `requirement.ready/.updated`（Rust 把 `all` topic 转发为 `push-event`，`:77-81`）→ `refresh()`。**WorkHub 演进**：接活方还应收 `escalation.created`(派给我，@ `user:<id>`)→"待返工/待处理"分组角标、`agent_run.step`(终态)→"AI 做完了等我看"。
- **四态**：
  - **空**：分组各自空态文案（公共池"暂时没有可接的需求"+CTA"自己提一条"，`:172-214`）。
  - **载入**：3 条 `Skeleton`（`:166`）。
  - **错误**：`glass p-4 text-error` 横幅（`:163`）+ 行动失败 toast。
  - **无权限**：未注册设备 → 接单/开始做后端 403；桌宠启动已自动注册（`App.tsx:151`），异常时 toast 引导重新 onboarding。
- **关键交互/跳转**：卡点击 → P3 工作台 `/r/:id`；"自己提一条" → 切 `dispatch` 空间 + `/r/new`（`Hub.tsx:203`）。tray "do_deliver" → 切 work 空间 + `/?tab=mine`（`App.tsx:187-190`）。
- **响应式**：桌宠固定窗口，主区随窗宽；卡纵向列表（`space-y-3`）。
- **web↔桌宠差异**：web **无**接活 Hub（接活是桌宠专属，设备令牌门）；web 的对等只到"派活看板"(W5)。桌宠 Hub 主行动**行内即点**（接单/开始做），web 详情页才有这些按钮且仅在桌宠 runtime 出现——所以 web 用户在 W4 看到的是"在桌面客户端继续→"。

---

### 6.3 P3 — 工作项工作台 `/r/:id` *(现状 `TaskDetail.tsx`)*

**职责**：桌宠的工作项详情，**接活方重排版**——突出"我的工作区（进度/清单/动态/阻塞）"与"交付"，把 web 详情的派活管理弱化。是协作人/AI 受阻后人接手干活的主战场（簇E）。

**布局（文字版 wireframe，接活方视角）**：
```
[← 返回]  {code} {title}  [StatusBadge] 🗓DDL
─────────────────────────────────────────────
‹动态横幅(按簇)›
 簇C: 升级简报卡（我被派来接手：为什么 + 计划 + 我的清单）   ← 消费 EscalationEvent
 簇D': 我交付后 AI 再审反馈（"这两处再调一下"）             ← 消费 PM 篇再审事件（pm-mode-orchestration §7）
─────────────────────────────────────────────
[我的工作区✓][拆解][概览][附件][交付物][对话][活动]   ← 接活方默认落"我的工作区"
─────────────────────────────────────────────
‹我的工作区(WorkspaceCard, canEdit)›
 阶段[input] 进度[0-100] 现在干到哪[textarea] 阻塞[textarea] [保存进度]
 清单: ☐待办/☑完成 (+加待办)
 动态: (+写一句进展)  时间线…
[生成我的清单(worker拆解)]   [交付/提交成果 →DeliveryWizard]
```

- **布局**：`Sidebar` + 主区 tab 容器，**默认 tab=我的工作区**（与 web 默认概览不同）。审批/交付动作区按簇浮现。
- **关键组件**：`WorkspaceCard`（可编辑：阶段/进度/状态备注/阻塞/清单/动态，参 `RequirementDetail.tsx:803-985` 同构）、`DeliveryWizard`（`components/DeliveryWizard.tsx`，交付向导）、`ActionRailDispatch`、拆解面板、`StatusBadge`。WorkHub 新增：接活方版 `EscalationBriefCard`（"我被派来接手"）、`ProposalReviewPanel`（人产出 → AI 再审 → 协助生成 Proposal，PM 篇 §7）。
- **数据 & API**：`invoke('get_requirement')` + workspaces/taskPlans/acceptance；进度写回 `invoke('patch_my_workspace')`（参 `RequirementDetail.tsx:845`）；交付走 `DeliveryWizard` → `Delivery`(round 版本化, `models.py:515`)。WorkHub 新增 `POST /api/workitems/{id}/human-output`（声明完成→触发 AI 再审 S5，**设备令牌门**，PM 篇 §8.2）。
- **SSE 订阅**：`workitem:<id>`(自现状 `req:<id>`，进度/状态 + AI 协助的 `agent_run.step`) + `user:<me.id>`(再审反馈/审批路由)。`WorkspaceCard` 注意：**SSE 触发的 refresh 不能覆盖用户正在输入的草稿**——web 侧用 `dirty` 守卫（`RequirementDetail.tsx:826/834`，注释记录过这个真实 bug），桌宠侧现以写入合并队列规避并发覆盖（`TaskDetail.tsx:518-536` 的 `workspaceSaveBusyRef`/`workspacePendingPatchRef`）；WorkHub 两端都须保留"输入态不被远端刷新冲掉"的守卫。
- **四态**：
  - **空**：工作区"还没有个人工作区。接单后这里会出现进度、清单和动态"（`:767`）；清单"清单还空着"（`:938`）；动态"还没有动态"（`:970`）。
  - **载入**：整页 loading；tab 子加载。
  - **错误**：加载失败 + 重试；保存失败行内红字（`:982`）。
  - **无权限**：非该 workspace 所有者 → 工作区只读（`canEdit=false` → "个人区只读"，`:907`）；未持设备令牌 → 交付/声明完成被后端拒。
- **关键交互/跳转**：保存进度 → `RequirementProgressUpdate`(心跳，重置催办 staleness，PM 篇 R3)；交付 → 进入审批簇D（提交者/负责人审）；簇D' 再审打回 → 带 AI 建议回 `human_doing`（PM 篇 §7.2）。
- **响应式**：桌宠窗口；工作区卡 `xl:grid-cols-2`（多人并列，`:788`）。
- **web↔桌宠差异**：这是**桌宠独有的"干活"重排**；web 的 `/r/:id`(W4) 同 URL 但版式偏"派活/审批"，且"我的工作区"tab 在 web 隐藏（`desktopOnly`，`RequirementDetail.tsx:46`）。两端审批/改派一致。

---

### 6.4 P6 — 我的负载 `/me/workload` *(现状 `MyWorkload.tsx`)*
- 桌宠版"只看自己"的负载视图（web `/planning` 看全员的个人切片）。布局/数据同 §5.6 思路，过滤为 `me`。SSE 订阅自己的 `workspace:<id>`。四态同 W6。**差异**：web 无此个人专页（融在 `/planning` 行内）。

### 6.5 桌宠 AI 助理浮窗（`FloatingAssistant`，非路由，常驻）*(现状已有)*
- **职责**：PRD §8.9 桌宠入口的当前雏形——右下角浮窗，问功能/基于项目 grep 问答/**一句话起草需求**（`FloatingAssistant.tsx:251` "问功能·问项目·帮你提需求"）。WorkHub 把它演进为**桌宠人格入口 + Agent 代操作**（FR-PET-001~003）。
- **布局**：固定右下 `bottom-5 right-5` 圆形触发钮（`:233`）→ 展开 `380×520` 玻璃面板（`:245`）：头部 + 消息流 + 输入区（Enter 发送/停止）。
- **数据 & API**：流式 `POST /api/assistant/chat`（SSE：thinking/parsed/error/done，`:109-164`），带 `project_id`(从 `/p/<id>` 路由 grep 接地，`:14`)、45s 超时(`:9`)。起草 → `invoke('create_requirement')` → `nav('/r/:id/clarify')`（`:213-221`）。
- **SSE / 实时**：**WorkHub 新增**——浮窗是**升级/催办/审批询问的桌宠呈现**（替代右下弹窗，FR-PET-003）：收 `escalation.created`/`permission.ask`（api-contract §5.2）或 PM 模式催办事件（PM 篇）时桌宠主动冒泡"这个活我先卡住了…要不要我帮你派给 X？"，行动按钮直接发 `PendingDecision` 确认。打扰频率/时段可由用户设边界（FR-PET-004）。
- **四态**：空（欢迎语 `:256`）；载入（"思考中…"+流式 `:276`）；错误（"连接失败/超时"气泡 `:174-178`）；无权限（未登录桌宠不到此）。
- **关键交互/跳转**：起草 → 澄清页(P4)；自然语言"查我那个活的进度并催一下" → Agent 查状态+起草催办 → "确认?"（J6，FR-PET-002）。
- **响应式 & 差异**：浮窗 `max-w-[calc(100vw-2.5rem)]` 适配窄窗。**web 也有同类浮窗**（`useNotificationToasts` + 未来 web 版助理），但**桌宠浮窗是有人格、能代操作、能主动提醒的"桌宠本体"**，web 偏被动 toast——这是 PRD §8.9"替代右下角弹窗/托盘"的核心差异。

---

## 7. 两端实时订阅汇总（SSE topic × 页面）

> topic 体系与隐私隔离以 [`system-architecture.md`](../01-architecture/system-architecture.md) §5.2 为权威；事件完整清单归 [`api-contract.md`](../01-architecture/api-contract.md)。本表给 M-WORKITEM 页面**订阅哪些 topic / 收到后做什么**。现状钩子：web `useReqStream`/`useChatStream`/`useNotificationToasts`；桌宠 `useEvent('push-event')`（Rust SSE → webview 事件）。

> **列约定**：本表按 **topic** 组织（topic = 隐私边界）；「承载事件 type」列的事件名以 [`api-contract.md`](../01-architecture/api-contract.md) §5.2「事件类型清单」为唯一权威，本篇不另造。

| topic *(演进)* | 现状 | 承载事件 type（权威=api-contract §5.2） | 订阅页面 | 收到后动作 | 隐私 |
|---|---|---|---|---|---|
| `workitem:<id>` *(自 `req:<id>`)* | `useReqStream`(`RequirementDetail.tsx:91`) | `requirement.updated`(现)、`agent_run.step`/`confidence.assessed`/`escalation.created`/`proposal.opened\|reviewed\|merged`/`conflict.detected`(新) | W4/P3/W5 | `latestStatus` 变 → `refresh()`；状态簇切换横幅；审批/简报卡浮现 | 订阅前 `can_view_requirement_record`（`push.py:84`） |
| `user:<me.id>`（私有通知/审批路由） | `/stream/me`(`push.py:99`)、桌宠 `notification.created`(`App.tsx:238`) | `notification.created`(现)、`escalation.created`/`permission.ask`(新，按身份路由) | W5/Inbox/浮窗/toast | toast + 角标 + 移入"待我处理" + 跳 `/r/:id` | **topic=鉴权 user.id，非 path**（`push.py:99` 注释，防跨用户泄漏） |
| `session:<id>` *(新增)* | — | `agent_run.step`/`permission.ask`（桌宠 Agent 代操作会话） | 浮窗 | 流式渲染 Agent 进度；审批询问冒泡 | session owner（+ 被路由审批人）|
| `all`（仅组织级非 PII） | `requirement.ready/.updated`（`Hub.tsx:77`） | `requirement.ready`/`requirement.updated` | P1 接活 Hub | 新公共池工单实时入列 | 只发非敏感事件（架构篇 §5.2 戒 `all` 滥用） |
| 澄清流（独立 SSE，非 push_bus） | `useChatStream`(`Clarify.tsx:79`) | thinking/text/parsed/done | W3/P4 | 驱动对话卡 | 流式轻鉴权(`require_stream_user`) |

> **私有事件隔离铁律**（NFR-08）：升级简报、派活建议、审批询问、再审反馈一律走 `user:<id>`/`permission:<approver>` 精确投递，**绝不**进 `all`（代码注释 `client-tauri/.../sse.rs` 记录过早期把通知扇出 `all` 导致每人收到所有人通知的真实事故，架构篇 §5.2）。`agentrun:<id>`/`proposal:<id>` 等"单对象专流"是否拆出独立 topic（而非复用 `workitem:<id>`）由 [`api-contract.md`](../01-architecture/api-contract.md) §5.3 定夺；本表按其当前口径（trace/confidence/proposal 事件统一走 `workitem:<id>`）呈现。

---

## 8. 响应式与 web↔桌宠差异（横切总结）

| 维度 | web（C-WEB） | 桌宠（C-PET） |
|---|---|---|
| **组织方式** | 项目 → 工单列表 → 详情；PM 看板/排期是全局工具 | 接活/派活双空间 → 按状态分组 → 工作台；聚焦"我的" |
| **能接活/干活/交付** | ❌（设备令牌门）→ W4 显"在桌面客户端继续→" | ✅（持 `client_token`） |
| **派活/审批/改派** | ✅ | ✅（设备令牌门不挡审批类） |
| **AI 入口** | 被动 toast（`useNotificationToasts`）+ 未来 web 助理 | **桌宠浮窗本体**：有人格、代操作、主动提醒（FR-PET） |
| **详情默认视图** | 概览 tab（派活/审批向） | 我的工作区 tab（干活向） |
| **"我的工作区"可编辑** | ❌ 隐藏（`desktopOnly`） | ✅（仅本人 workspace，`canEdit`） |
| **导航壳** | sticky glass 顶栏 + 看板▾下拉 | TitleBar + 空间切换 + 随空间 Sidebar + 浮窗 |
| **进入单条工作的 deep-link** | URL `/r/:id` | URL + `yqgl://r/:id`（托盘/系统通知唤起） |
| **断网/响应式** | 浏览器自适应；SSE 断线 `EventSource` 自动重连 | 固定窗口；`TitleBar` 显 SSE 连接态（`App.tsx:289`） |
| **去黑话** | 全程人话（StatusBadge/按钮）；无 git 术语 | 同左；桌宠口吻更"陪伴" |

---

## 9. 与其他文档的边界（避免重复）

| 想了解 | 看哪篇 |
|---|---|
| WorkItem 全量字段、类型/约束、ER 图、完整状态机转移、软删除/审计字段 | [`data-model.md`](../01-architecture/data-model.md) |
| 置信度算法、风险维度、三触发器点火、打回回灌、`ConfidenceRecord`/`EscalationEvent` 字段 | [`confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md) |
| 升级后经理模式编排（简报/派活/拆解/排期/催办/再审）、`PendingDecision` | [`pm-mode-orchestration.md`](../02-ai-engine/pm-mode-orchestration.md) |
| 派活匹配打分、`StaffingProposal`/`Suggestion`/`why+evidence`、冷启动 | [`smart-staffing.md`](../02-ai-engine/smart-staffing.md) |
| Branch/Proposal/合并/冲突 AI 调解、对象合并语义、README=规格 | [`branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md) · [`sync-and-spec.md`](../03-collaboration/sync-and-spec.md) |
| 分层 allow/deny/ask 审批、审批路由、SLA、委派、"永远允许"学习 | [`review-and-approval.md`](../03-collaboration/review-and-approval.md) |
| AgentRun trace 呈现、grep 强制引用、决策可解释 | [`explainability.md`](../02-ai-engine/explainability.md) |
| 通知/提醒/催办规则与中心页、日历页 | [`tasks-reminders-notifications.md`](./tasks-reminders-notifications.md) |
| 看板度量（自治率/升级精准度/成本）图表定义 | [`dashboards-and-metrics.md`](./dashboards-and-metrics.md) |
| 客户端壳：web 路由表/导航；桌宠窗口/托盘/deep-link/spec_watch/双向同步 | [`web-app.md`](../05-clients/web-app.md) · [`desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md) |
| 去黑话术语权威（工作副本/改动/提交确认/采纳/撞车了） | [`glossary-dejargon.md`](../00-overview/glossary-dejargon.md) |

---

## 10. FR 追溯（M-WORKITEM 页面落点）

| PRD FR | 本篇页面落点 |
|---|---|
| FR-WORKER-001（默认派 AI 工人执行） | W3 `SummaryCard` 默认勾"让 AI 先试"（§5.3 演进）→ 簇B |
| FR-WORKER-002（AgentRun trace 可审） | W4/P3 `AILiveView` + 活动 tab（§5.4） |
| FR-ESC-001（ConfidenceRecord 人话呈现，不露数值） | W4 `ConfidenceCard`（§5.4，簇D） |
| FR-ESC-002（升级即建 EscalationEvent 切经理模式） | W4/P3 `EscalationBriefCard`（簇C，§5.4/§6.3） |
| FR-ESC-003（打回带理由回灌） | W4 `ProposalReviewPanel` 打回写原因必填（§5.4） |
| FR-ESC-005（人工保留三级开关） | W4 "不让 AI 干"开关弹层（§4.3/§5.4） |
| FR-STAFF-002/003（提议负责人+协作人+理由，一键确认/调整） | W4/W5 `StaffingSuggestionCard`（§5.4/§5.5） |
| FR-COLLAB-002（改动以 Proposal 提交，采纳/打回） | W4 `ProposalReviewPanel`（§5.4，簇D） |
| FR-COLLAB-004（UI 不出现 git 术语） | §2.2 去黑话纪律 + StatusBadge/按钮文案全篇 |
| FR-PET-001~003（桌宠常驻/代操作/呈现升级催办） | 桌宠浮窗 `FloatingAssistant`（§6.5） |

---

*本篇定位：M-WORKITEM 的"页面规划单一来源"。机制级 → 02-ai-engine 各篇；数据级 → data-model；客户端壳级 → 05-clients。下一步：W4 新增的 `ConfidenceCard`/`EscalationBriefCard`/`StaffingSuggestionCard`/`ProposalReviewPanel` 四个组件的 props 契约随 [`api-contract.md`](../01-architecture/api-contract.md) 的响应 schema 落定（确保数值字段不下发）。*
