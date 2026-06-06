---
title: WorkHub Interaction Improvements + Extension Backlog
type: product-backlog
status: draft
date: 2026-06-05
depends:
  - ./_gold-path-p0-5-vertical-slice.md
  - ./_experience-deliverable-contracts.md
  - ../../workhub/05-clients/prd-concept-reproduction-gap-audit.md
---

# WorkHub Interaction Improvements + Extension Backlog

> **一句话**:WorkHub 的交互原则是“AI 先过滤复杂度,用户只处理当前一件事”。本 backlog 收口 P1+ 可以拓展的功能和体验改善,但所有条目都要回到 Gold Path 和共享契约。
>
> **差距来源**:PRD / 概念图完全复现还缺 Cuu 动画 runtime、透明桌宠窗、生产 Tauri 壳、真实 Web SPA、视觉 QA 等，详见 [`prd-concept-reproduction-gap-audit.md`](../../workhub/05-clients/prd-concept-reproduction-gap-audit.md)。本 backlog 中涉及这些方向的条目必须回写该差距审计或对应客户端文档。

---

## 1. 分级原则

| 层级 | 含义 | 示例 |
|---|---|---|
| P0 契约 | 现在必须冻结 schema/event/type | `QuestionCard`, `AttentionItem`, `CuuState` |
| P0.5 纵切 | 可点击验证 Gold Path | Option intake, Proposal Detail, Replay fixture |
| P1 体验可用 | 用户日常能用 | Cuu 轻卡、审批中心、非代码 PR |
| P2 增强智能 | AI 更主动 | Remember Rule, Evidence Confidence, PM brief |
| P3+ 高表现力 | 品牌/动效/深协作 | Rive/Live2D Cuu, advanced sync merge |

---

## 2. 核心交互改善

### IX-1 Cuu 轻/重两级交互

| 项 | 设计 |
|---|---|
| 轻交互 | 小气泡、1 句摘要、1-3 个 chips |
| 重交互 | 展开卡片:证据、风险、回滚、审批动作 |
| 再重 | deep-link 打开 Web/Rust 主窗 |
| Payload | `AttentionItem`, `QuestionCard`, `EvidenceBubble` |
| 阶段 | P0.5 轻卡,P1 重卡,P2 动效 |

**验收**:任一 `permission.ask` 不应直接把用户扔到完整页面;先由 Cuu/Attention 卡解释“为什么找你”。

### IX-2 当前一件事优先

| 项 | 设计 |
|---|---|
| 默认入口 | `GET /api/pages/attention` |
| Web | 首页先显示 `primary AttentionItem`,列表在下方 |
| Rust | 单件事工作台,本地动作在右侧 |
| Cuu | 红点 + 当前事项气泡 |
| 阶段 | P0.5 |

**禁止**:默认首页先展示重型看板。

### IX-3 非代码 PR / Human-readable Change Package

| 项 | 设计 |
|---|---|
| 页面 | Proposal Detail |
| Payload | `DeliverableChangeManifest` |
| 交付物 | doc/ppt/xlsx/image/folder/structured_record |
| 必备区块 | 改了什么、影响什么、证据在哪、风险、检查、回滚 |
| 阶段 | P0.5/P1 |

**增强**:每次交付自动生成一页“给人看的变更说明”,可导出 Markdown/HTML。

### IX-4 澄清不做聊天墙

| 项 | 设计 |
|---|---|
| 默认输入 | `QuestionCard.options` |
| 打字 | 折叠在“其他/补充” |
| 进度 | 已确认内容 stack |
| Cuu | 一次只问一个问题 |
| 阶段 | P0.5 |

**验收**:主路径无需长文本输入即可完成一个简单需求。

### IX-5 知识库/项目检索归 Cuu,Web 保留高级检索

| 项 | 设计 |
|---|---|
| Cuu | 证据气泡、快捷 chips:找相关文件/总结会议/这次改了什么 |
| Web | 完整检索、筛选、管理、追溯 |
| Payload | `EvidenceBubble`, `EvidenceRef` |
| 阶段 | P1 |

---

## 3. 拓展功能 Backlog

| ID | 功能 | 用户价值 | 契约/页面 | 阶段 |
|---|---|---|---|---|
| EX-1 | Replay Work | 用户能理解 AI 怎么做的 | `ReplayTraceVM`, `/agent-runs/:id/replay` | P0.5 |
| EX-2 | Remember This Rule | 审批后学习“以后这种自动允许/总问我” | `PermissionPolicy`, approval card | P1 |
| EX-3 | Human-readable Change Package | 交付物不只是 diff,而是人能读的说明 | `DeliverableChangeManifest` export | P1 |
| EX-4 | Cuu Quiet Mode | 专注/会议时不打扰 | `UserPreference`, Cuu state policy | P1 |
| EX-5 | Inbox Zero for Work | 审批/澄清/冲突/打回一个队列 | `AttentionHomeVM.queue` | P1 |
| EX-6 | Evidence Confidence | 不显示分数,显示证据足/弱/缺失 | `EvidenceBubble.confidence_hint` | P1 |
| EX-7 | Proposal Compare Modes | 文档/PPT/表格/图片不同预览 | manifest target renderer | P2 |
| EX-8 | PM Brief | AI 整理为什么卡、建议谁做 | `EscalationEvent`, `AttentionItem` | P2 |
| EX-9 | Local Sync Conflict Coach | AI 帮用户选保留/合并/打开编辑器 | `ConflictChoice[]` | P2 |
| EX-10 | Cuu Personality Preferences | 可调提醒频率和语气 | `CuuPreference` | P2 |
| EX-11 | Cost Lens | 管理者看 AI 成本/收益 | Agent metrics | P3 |
| EX-12 | Rive/Live2D Cuu | 更高表现力桌宠 | `CuuState` runtime adapter | P3 |
| EX-13 | PRD Concept Gap Closure | 把概念图差距变成可验收施工项 | GAP-CUU/GAP-RUST/GAP-WEB/GAP-GOLD | P0.5-P3 |

---

## 4. Cuu 交互策略

### 4.1 状态到动作

| CuuState | 默认动作 | 可展开卡 |
|---|---|---|
| `idle` | 呼吸/待命 | 无 |
| `thinking` | 小转圈/整理中 | Agent progress |
| `asking_approval` | 举手/提示 | `QuestionCard` or approval card |
| `carrying_document` | 抱文件 | Proposal summary |
| `searching_evidence` | 放大镜 | EvidenceBubble |
| `syncing_files` | 搬文件 | Sync progress |
| `worried` | 紧张/提醒 | Risk/conflict card |
| `revision_requested` | 回去改 | Revision reason |
| `celebrating` | 完成庆祝 | Completion summary |
| `offline` | 睡觉/断线 | Diagnostic link |

### 4.2 打扰策略

| 严重度 | 行为 |
|---|---|
| low | Cuu 状态变化,不弹卡 |
| normal | 气泡 1 次,可自动收起 |
| high | 气泡 + 托盘/通知,需要用户处理 |
| urgent | 展开轻卡,但仍允许 snooze |

Quiet Mode 下:

- low/normal 只变状态。
- high 只显示红点。
- urgent 才弹最小卡。

---

## 5. 页面策略

| 页面 | 改善方向 |
|---|---|
| Home | 当前一件事 + 后台工作,看板下沉 |
| Intake | option-first,已确认内容右侧/下方 |
| WorkItem Detail | live trace preview + latest proposal |
| Approval Center | 阻塞收件箱,支持批量但不做复杂看板 |
| Proposal Detail | 非代码 PR,按 target kind 渲染 |
| Knowledge | 高级检索兜底,Cuu 承接轻检索 |
| Replay Work | 人话 timeline,raw 可展开 |
| Sync Conflict | 三选一 + AI 推荐 + 证据 + 本地打开 |

---

## 6. 排期建议

### P0.5

- Gold Path 页面最小可点
- Replay fixture
- Cuu 静态状态 + 气泡
- Proposal Detail 非代码 PR 最小版
- PRD/概念复现差距审计入文档树,后续每个 gap 有 owner path 和验收门

### P1

- Cuu 轻/重卡
- Cuu sprite runtime MVP
- Approval Center
- Inbox Zero for Work
- Remember This Rule
- Evidence Confidence
- Quiet Mode
- Web Gold Path shell 升级为真实 React SPA routes

### P2

- PM Brief
- Sync Conflict Coach
- Proposal renderer per target type
- Cuu preference/personality
- 独立 Tauri `pet` window + 拖拽/静音/勿扰
- Rust shell SSE worker / tray / notification / deep-link

### P3+

- Rive/Live2D Cuu
- Cost Lens
- Advanced replay analytics
- Multi-agent collaboration view
- local sync / delivery / conflict 的生产桌面体验

---

## 7. 验收门禁

- [ ] 每个 backlog 条目能指向一个 shared contract 或新增 contract proposal。
- [ ] Cuu 相关功能必须有 `CuuState` 映射。
- [ ] 页面增强不得绕过 Page VM 自己拼状态。
- [ ] 拓展功能不得成为 P0.5 阻塞项,除非 Gold Path 必需。
- [ ] 所有用户面文案去黑话,不暴露 tool enum / raw event name / confidence score。

---

## 8. 不做清单

- 不把看板重新放回默认首页。
- 不做“全功能聊天助手”作为主入口。
- 不让 Cuu 只当通知图标。
- 不把 Replay 做成开发者日志页面。
- 不把 Remember Rule 做成永久不可撤销授权。
- 不让 Evidence Confidence 变成裸分数展示。
