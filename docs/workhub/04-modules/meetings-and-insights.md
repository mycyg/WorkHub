---
module: M-MEETING（会议与洞察）
layer: L2（执行层 / 业务模块）· web + 桌宠两端
status: 🚧
owner: workflow
---

# 会议与洞察（Meetings & Insights）

> **范围**：M-MEETING —— 把一次会议（录音 / 上传音频 / 转写文本）变成可信资产链：**录制/上传 → ASR 转写 → AI 纪要 → AI 洞察 → 需求草稿（人确认）**。本篇是**页面规划级**：逐页给路由、布局、组件、数据/API 绑定、SSE 订阅、四态（空/加载/错误/无权限）、关键交互与跳转流、web↔桌宠差异。
>
> **定位与边界**：本篇只管「会议这一段」的页面与流转。
> - 实体字段、状态机、软删除/审计字段 → 见 [`../01-architecture/system-architecture.md`](../01-architecture/system-architecture.md)（数据模型篇暂并入架构篇）与真实实体 `app/models.py`（`MeetingRecord:269` / `MeetingInsight:291`）。
> - 端点签名、SSE 帧格式、鉴权依赖、错误码 → 见 [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md) §2.10 / §3 / §5；本篇只引用不重抄。
> - 洞察→草稿后**进入需求主轴**的流转（澄清/派活/执行）→ 见 [`requirements-workitem.md`](./requirements-workitem.md)（同级，🚧）。
> - **AI 给的「这是不是新需求 + 为什么」** 是置信度/可解释的一个落点，口径见 [`../02-ai-engine/confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md) 与 [`../02-ai-engine/explainability.md`](../02-ai-engine/explainability.md)。
> - **所有术语/状态标签**以 [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md) 为权威；本篇用户面文案一律走人话（零 snake_case、零 git 黑话）。
>
> **扎根**：会议链是现有「需求管理大师」**已跑通**的能力，WorkHub **保留并 AI-native 化**。核心代码锚点贯穿全文：`app/routers/meetings.py`、`app/services/meeting_agent.py`、`app/routers/voice.py`、`web/src/pages/ProjectMeetings.tsx`、`client-tauri/web-src/src/routes/ProjectMeetings.tsx`。
>
> **⚠️ 读之前先看 [§5.5 TypeScript 实现现状](#55-typescript-实现现状2026-09-05sa-02-落地后)**：本篇大部分内容描述的是被迁移的 Python 实现与目标形态。WorkHub 这边现在真正跑通的是「粘转写文本 → AI 纪要 + AI 洞察 → 人确认生成草稿」，**没有**录音上传与 ASR。

---

## 0. 这个模块在 WorkHub 里的位置（先对齐心智）

### 0.1 它是「需求的上游入口之一」

WorkHub 的主轴是 WorkItem（需求/任务，演进自 `Requirement`，`models.py:314`）。需求的来源有三条上游入口，会议是其中信息密度最高的一条：

| 上游入口 | 模块 | 落库锚点 | 产物 |
|---|---|---|---|
| 口头/文字直接提交 | M-WORKITEM | `Requirement.raw_description` | WorkItem(draft) |
| 网盘文件评论触发 | M-DRIVE | `ProjectDriveComment.draft_requirement_id`（`models.py:240`） | WorkItem(draft) |
| **会议洞察确认** | **M-MEETING（本篇）** | `MeetingInsight.created_requirement_id`（`models.py:304`） | **WorkItem(draft)，带 `source_meeting_id` 回链** |

> 三条入口殊途同归：都产出一个 `status=draft` 的 WorkItem，再进澄清流程。会议入口的独特价值 = **一次会能裂变多条需求草稿**，且每条都带「来源会议 + AI 判断理由」的可追溯链（`Requirement.source_meeting_id`，`models.py:338`）。

### 0.2 AI-native 化：会议链里 AI 已经在「干活」，人只「确认」

会议链天然契合 PRD §5「AI 默认驾驶、人确认」的宪法，且**现状已经是这个形状**——这是它作为迁移样板的价值：

- **AI 工人态（默认）**：ASR 转写 + `meeting_agent.analyze_meeting`（`meeting_agent.py:94`）直接产出纪要 + 洞察（`kind` ∈ `new_requirement | requirement_change | normal_note`），**无需人逐步干预**。
- **人是确认者，不是劳动力**：洞察永不静默改需求——`SYSTEM` 提示词第三条硬约束「Never directly modify a requirement. Only produce suggestions that a human can confirm.」（`meeting_agent.py:34`）。人只在「洞察确认页」点「进入评估 / 忽略」。
- **去黑话 + 带理由**：每条洞察带 `confidence_reason`（`meeting_agent.py:20`、`models.py:302`），AI 说人话解释「为什么我觉得这是个新需求」——这正是 `FR-EXPLAIN-001` 在会议链的现成先例（glossary §3.3 已点名）。

> **WorkHub 的增量**（相对现状）：① 把「确认洞察 → 建草稿」从一次性动作升级为**可携 ConfidenceRecord 进主轴**；② 转写/纪要的进度从轮询 `job` 升级为**走统一事件流**（见 §6）；③ 录音入口在桌宠端原生化（见 §7）。**不重写已跑通的链路**（D-1）。

### 0.3 会议状态与洞察状态（用户标签走 glossary）

两套状态，分别挂在 `MeetingRecord.status` 与 `MeetingInsight.status`（真实枚举来自 `meetings.py`）：

| 实体.字段 | 内部枚举（真实代码） | 用户标签（人话） | 锚点 |
|---|---|---|---|
| `MeetingRecord.status` | `processing` | **处理中**（脉动 + 进度条） | `meetings.py:289` |
| | `ready` | **已生成** | `meetings.py:372`，UI pill 见 `ProjectMeetings.tsx:335` |
| | `failed` | **处理失败**（可重试） | `meetings.py:396` |
| `MeetingInsight.status` | `pending` | **待你确认** | `meetings.py:382`（建洞察时 `status="pending"`） |
| | `creating_requirement` | **创建中**（transient，CAS 占位） | `meetings.py:501` |
| | `confirmed` | **已确认**（→ 跳草稿） | `meetings.py:567` |
| | `dismissed` | **已忽略** | `meetings.py:626` |

> 新枚举（如 WorkHub 把 ConfidenceRecord 引入会议洞察）**必须同步登记到 `shared/src/design/status-vocab.ts`**（glossary §7 的硬规则），否则用户面会漏 snake_case。

---

## 1. 页面与路由清单（逐页）

M-MEETING 是「项目下的一个视图 + 三类视图状态」，**不是独立顶层导航**，而是挂在项目空间内。**两端的「进出导航」现状不同**（页面规划须分端写清）：

> - **web**：与「需求 / 网盘」并列三个 tab 的 tab 条（真实 `<Link>` tab 条，`web/.../ProjectMeetings.tsx:250-265`；路由参数名 `:id`）。
> - **桌宠**：**没有 tab 条**，靠顶部单个返回按钮「返回项目网盘」回项目（`client-tauri/.../ProjectMeetings.tsx:318-323` 用 `useNavigate(/p/:projectId)`；路由参数名 `:projectId`）。
>
> WorkHub 演进建议：把导航收口为 C-UIKIT 统一的 `<ProjectTabBar>`，让两端都走一致的「需求/网盘/会议」tab（消除桌宠靠单返回键的不对等）。

| # | 页面（视图） | 路由（web）| 路由（桌宠）| 呈现形态 | 现状锚点 |
|---|---|---|---|---|---|
| **P1** | **会议列表 + 详情**（主页，左右双栏） | `/p/:id/meetings`（tab 条切入） | `#/p/:projectId/meetings`（返回键切出，无 tab 条） | 项目内视图 | `web/.../ProjectMeetings.tsx`、`client-tauri/.../ProjectMeetings.tsx` |
| **P1-a** | └ 列表栏（left aside） | 同上（左栏） | 同上 | 主页内分区 | `ProjectMeetings.tsx:314-340` |
| **P1-b** | └ 详情栏（right main，含转写/纪要/洞察） | 同上（右栏，`?m=<meetingId>` 选中态） | 同上 | 主页内分区 | `ProjectMeetings.tsx:343-458` |
| **P2** | **导入会议**（上传/录制面板 → 弹层化） | 主页左栏的「导入会议录音」卡 → WorkHub 提为**弹层/抽屉** | 同左栏，桌宠加**本地录音**入口 | 弹层 over P1 | `ProjectMeetings.tsx:269-312`、录音走 `voice.py:31` |
| **P3** | **洞察确认**（needs-action 聚焦视图） | 详情栏内「需求评估」分区 + 跨项目聚合页 `/inbox?tab=insights`（WorkHub 新增） | 桌宠**会主动弹**待确认洞察（替代右下角弹窗） | 分区 + 聚合页 + 桌宠卡片 | `ProjectMeetings.tsx:397-455`、确认 `meetings.py:470` |

> **路由设计判断**：
> - **保留单页双栏**（不拆成「列表页 + 详情页」两个路由）。理由：会议数量通常不大（`list_meetings` 上限 100，`meetings.py:167`），双栏「选中即看」比来回跳页顺手；现状已是此形态。
> - **新增选中态可深链**：现状选中态仅在内存（`active` state，`ProjectMeetings.tsx:24`）。WorkHub 把选中态提到 query `?m=<meetingId>`，让「桌宠通知 → 点开直达某会议某洞察」可 deep-link（呼应桌宠 deep-link 能力，glossary §8）。
> - **新增跨项目洞察聚合**（P3 的 `/inbox?tab=insights`）：现状洞察散在各项目会议详情里，没有「我名下所有待确认洞察」的统一入口。WorkHub 在通知收件箱（M-NOTIFY）下加一个「待确认草稿建议」标签，把所有 `pending` 洞察聚合到一处（详见 §4.3）。

---

## 2. P1 — 会议列表 + 详情主页（核心页，最详）

> **一句话**：左栏「导入 + 会议列表」，右栏「选中会议的全文资产（转写 / 纪要 / 洞察）」。这是 M-MEETING 的家。

### 2.1 布局（文字版 wireframe）

```
┌─ 顶栏（页眉 header）────────────────────────────────────────────────┐
│  eyebrow: 会议要点                                      [↻ 刷新]      │
│  H1: 🎙 {项目名}                                                     │
│  副标题: 上传录音 → 自动转写 → AI 整理要点 → 你确认 → 生成需求草稿     │
├─ 项目内 tab 条（仅 web；桌宠改为顶部「← 返回项目网盘」单按钮）──────┤
│  [📅 需求]   [💾 网盘]   [🎙 会议 ←当前]                              │
├──────────────────┬─────────────────────────────────────────────────┤
│  左栏 aside       │  右栏 main（min-w-0，可滚）                       │
│  (360px 固定)     │                                                  │
│                   │  ┌─ 会议头卡 ────────────────────────────────┐   │
│ ┌─ 导入会议 ────┐ │  │ eyebrow:会议   [状态 pill: 处理中 65%]      │   │
│ │ 🔼 导入录音    │ │  │ H2: {会议标题}                             │   │
│ │ [标题输入框]   │ │  │ {音频文件名} · {时间}                       │   │
│ │ ┌──拖放区──┐   │ │  │ [████████░░░░ 进度条(processing 时)]        │   │
│ │ │ 🎵 选择   │   │ │  └────────────────────────────────────────────┘ │
│ │ │ 音频/文本 │   │ │  ┌─ 转写 ─────────┐ ┌─ 纪要 ─────────────┐      │
│ │ │ [选择文件]│   │ │  │ ASR 转写        │ │ 会议纪要(Markdown) │      │
│ │ │ [🎙 录制] │   │ │  │ <pre 全文滚动>  │ │ <pre/md 滚动>      │      │
│ │ └──────────┘   │ │  └─────────────────┘ └────────────────────┘      │
│ │ [⚠ 错误行]     │ │  ┌─ 需求评估（洞察列表，见 §4）────────────┐    │
│ └────────────────┘ │  │ ✨ 需求评估                               │   │
│ ┌─ 会议列表 ─────┐ │  │ ┌ 洞察卡 ×N: [类型][状态] 标题 描述 理由  │   │
│ │ ○ 会议A 已生成  │ │  │ │  [进入评估][忽略] / [去澄清→]          │   │
│ │ ● 会议B 处理中  │ │  │ └────────────────────────────────────────│   │
│ │ ○ 会议C 失败    │ │  └──────────────────────────────────────────┘   │
│ └────────────────┘ │                                                  │
└──────────────────┴─────────────────────────────────────────────────┘
```

布局骨架（沿用现状 `ProjectMeetings.tsx:267` 的真实 grid）：
- **栅格**：`grid xl:grid-cols-[360px_minmax(0,1fr)]`，左栏定宽 360、右栏弹性。`<xl` 断点下单列堆叠（响应式见 §2.8）。
- **顶栏**：`eyebrow + H1(项目名 + Mic2 图标) + 副标题`（人话流程描述）+ 右侧「刷新」次按钮。
- **左栏 aside**：上「导入会议」卡（P2），下「会议列表」卡（`max-h-[520px] overflow-auto`）。
- **右栏 main**：选中会议的「会议头卡 → 转写/纪要双栏 → 需求评估分区」三段竖排。

### 2.2 关键组件

| 组件 | 职责 | 现状/共享件 |
|---|---|---|
| `<ProjectTabBar>` | 需求/网盘/会议 三 tab 切换 | 现状内联（`ProjectMeetings.tsx:250`），WorkHub 抽进 C-UIKIT |
| `<MeetingImportCard>` | 导入入口（标题 + 拖放 + 选择/录制） | `ProjectMeetings.tsx:269`，见 P2 |
| `<MeetingListItem>` | 单条会议（标题 + 状态 pill + 时间 + 上传人） | `ProjectMeetings.tsx:316` |
| `<MeetingHeaderCard>` | 会议头（标题 + 状态 + 进度条 / 失败提示） | `ProjectMeetings.tsx:347` |
| `<TranscriptPane>` | ASR 转写全文（可滚 `<pre>`） | `ProjectMeetings.tsx:383` |
| `<MinutesPane>` | 会议纪要（Markdown 渲染） | `ProjectMeetings.tsx:389`（现状 `<pre>`，WorkHub 升级为 md 渲染） |
| `<InsightCard>` | 单条洞察（类型 + 状态 + 标题 + 描述 + 理由 + 操作） | `ProjectMeetings.tsx:412`，见 §4 |
| `<StatusPill>` / `<Progress>` / `<EmptyState>` / `<Skeleton>` / `toast` | 状态/进度/四态/通知 | 桌宠端已用 `@yqgl/shared`（`ProjectMeetings.tsx:7` import），web 端 WorkHub 统一收口 |

### 2.3 数据与 API 绑定

| 数据 | 来源 API（api-contract §2.10） | 现状锚点 | 触发时机 |
|---|---|---|---|
| 项目信息（标题/标签条） | `GET /api/projects`（取当前 id） | `listProjects()`，`ProjectMeetings.tsx:45` | 进页 |
| 会议列表 | `GET /api/projects/{pid}/meetings` → `MeetingOut[]` | `meetings.py:158`，`listMeetings()` | 进页 + 刷新 + 事件 reconcile |
| 单会议详情（含 insights） | `GET /api/meetings/{id}` → `MeetingOut`（内嵌 `insights[]`） | `meetings.py:444`，`getMeeting()` | 选中 / 上传完成 / 确认后 |
| 处理进度 | `GET /api/jobs/{id}` → `BackgroundJobOut` | `meetings.py`（`job_id`）、`jobs.py:43` | processing 期间轮询（WorkHub → 事件，§6） |

> **数据形状要点**：`MeetingOut`（`schemas.py:653`）**把 insights 内嵌**返回（`insights: MeetingInsightOut[]`，`schemas.py:666`）——所以选中一个会议即一次性拿到转写、纪要、全部洞察，无需二次请求洞察列表。`transcript_text` / `minutes_md` 可为 `null`（处理中/失败时）。

### 2.4 SSE 实时订阅

会议链的实时性来自三条事件，三条都已是真实代码所发（api-contract §5.2）。注意「是否被本页订阅」与「是否被发出」是两回事——前两条本页已订阅，`job.updated` 现状由后端发出但**前端尚未订阅**（仍轮询，见 §6 演进）：

| 事件 type | topic | payload | 现状锚点（发布方） | 本页如何用 |
|---|---|---|---|---|
| `meeting.ready` | `all` | `{meeting_id, project_id}` | `meetings.py:387`（`bus.publish("all", ...)`） | 列表里把该会议从「处理中」翻成「已生成」；若正选中它，重拉详情显示转写/纪要/洞察 |
| `meeting.insight_confirmed` | `all` | `{meeting_id, insight_id, created_requirement_id}` | `meetings.py:600`（确认成功后） | 多端协作时，他人确认后本端把该洞察标「已确认」+ 显示「去澄清」 |
| `job.updated` | `job:{id}` + `user:{id}` | `BackgroundJobOut`（含 `status / progress_percent / message / result_ref / error`） | **`services/jobs.py:79`**（`publish_job`；**非** `routers/jobs.py`，后者 `:43` 只有轮询 GET） | **现状未用**：本页对进度仍走 1500ms 轮询 `GET /api/jobs/{id}`（`ProjectMeetings.tsx:129`、tauri `:196`）；WorkHub 改订阅此事件实时推进度（§6） |

> **关键约定（沿用 + 收紧，呼应 NFR-08）**：现状 `meeting.ready` / `meeting.insight_confirmed` 发在 `all` topic（全局），payload 仅含 id（非敏感）——客户端收事件后**按 id 重拉** `GET /api/meetings/{id}`，重拉时经鉴权门，私有内容不会因事件泄漏。这符合 api-contract §7「REST 为真相，SSE 为增量提示」。
>
> **WorkHub 演进**：把 `meeting.ready` / `meeting.insight_confirmed` 从 `all` 迁到 **`workitem:` 不适用、改用项目/上传者维度** —— 至少把「带 `created_requirement_id` 的确认事件」按 `project:{id}` 或上传者 `user:{id}` 投递，避免无关项目成员收到噪声（对齐架构篇 §5.2 「清退 `all` 滥用」）。MVP 阶段沿用 `all`（payload 无敏感字段，安全可接受）。

### 2.5 四态：空 / 加载 / 错误 / 无权限

| 态 | 触发条件 | 左栏（列表） | 右栏（详情） | 现状锚点 |
|---|---|---|---|---|
| **空** | 项目无任何会议 | EmptyState：「还没有会议录音。点上方按钮试一下？」 | EmptyState：「选一个会议，或者先上传录音。」 | `ProjectMeetings.tsx:315/344` |
| | 选中会议但无洞察 | — | 需求评估区 EmptyState：「暂时没有识别出要进需求流程的内容。」 | `ProjectMeetings.tsx:403` |
| **加载** | 进页拉列表 / 切项目 | Skeleton 列表行（WorkHub 加；现状直接空→填） | Skeleton 头卡 + 两个 `<pre>` 骨架 | `@yqgl/shared` `Skeleton`（桌宠已 import） |
| | 上传中 | 拖放区文案变「上传 {文件名}」+ 禁用 | — | `ProjectMeetings.tsx:283`（`busy` state） |
| | 会议 processing | 该行 pill「处理中」 | 头卡 pill「{job.message} · {n}%」+ 进度条；转写/纪要占位「还在等声音变成文字」「纪要还没端上来」 | `ProjectMeetings.tsx:354/386/392` |
| **错误** | 上传/确认失败 | 导入卡下红色 `⚠ {错误}` 行 | — | `ProjectMeetings.tsx:306` |
| | 会议 `status=failed` | 该行 pill「失败」 | 头卡红 pill「处理失败」+ 失败提示框（`job.error` 或人话兜底「可稍后重试上传，或先上传文本纪要」）；转写/纪要显示「转写失败，未生成可用文本。」 | `ProjectMeetings.tsx:360/372/386` |
| **无权限** | 未登录 / 无 cookie | （整页被路由守卫拦截，跳登录） | — | `current_user` 401（`auth.py:127`） |
| | 关联了不可见需求的上传 | init 阶段 403「you do not have access to this requirement」→ 错误行 | — | `meetings.py:194`（`can_view_requirement_record`） |
| | 非上传者想编辑/确认/忽略 | 操作按钮**不渲染**（前端按 `uploaded_by` 判）；越权直调 → 403 | 同左 | `meetings.py:458/481/618`（仅 uploader 可改/确认/忽略） |

> **权限模型（本模块的真实约束，来自代码）**：
> - **查看**：项目任意成员可看会议列表与详情（`list_meetings` / `get_meeting` 仅 `current_user`，`meetings.py:159/445`）。
> - **编辑纪要/转写、确认洞察、忽略洞察**：**仅上传者**（`meeting.uploaded_by_user_id != user.id → 403`，`meetings.py:458/481/618`）。
> - WorkHub 演进：在 RBAC 下放宽为「上传者 **或** 项目 lead/admin 可确认洞察」（呼应 security 篇 RBAC 资源门），但**默认仍收敛到上传者**，避免多人乱建草稿。

### 2.6 关键交互与跳转流

```
【选中会议】
点列表项 → selectionToken++ → setActive(meeting) → 右栏渲染
  └ 若 meeting.job_id 且 status=processing → 启动进度订阅（§6）

【上传完成 → 自动选中】
finalize 返回 meeting → 若用户仍停在原选中（token 比对）→ applyMeetingDetail(自动选中新会议)
  （ProjectMeetings.tsx:156：竞态守卫，快速切项目/换选中不会被旧上传抢焦点）

【处理完成（SSE meeting.ready）】
收事件 → 列表该项翻「已生成」→ 若正选中它 → 重拉 getMeeting → 转写/纪要/洞察出现

【确认洞察 → 进需求主轴】（核心跳转，见 §4.4）
点「进入评估」→ POST confirm → 返回带 created_requirement_id →
  按钮变「去澄清」→ 点击 → 跳 /r/{created_requirement_id}/clarify（离开本模块，进 M-WORKITEM）
```

竞态防护（现状已实现，WorkHub 保留）：`uploadBusyRef` / `actionBusyRef`（防双击重复上传/确认）+ `loadTokenRef` / `selectionTokenRef`（防快速切项目落地旧数据），见 `ProjectMeetings.tsx:32-41`。后端侧的幂等护栏见 §4.2。

### 2.7 与桌宠端（C-PET）的差异

| 维度 | web（C-WEB） | 桌宠（C-PET） | 锚点 |
|---|---|---|---|
| 组件来源 | 项目自有 + C-UIKIT | **`@yqgl/shared`**（Button/Card/EmptyState/Progress/Skeleton/toast） | `client-tauri/.../ProjectMeetings.tsx:7` |
| 网络层 | `api`（cookie 鉴权） | `clientFetch`/`clientJson`（带 `X-YQGL-Client-Token` 设备令牌头） | `:9`、glossary §8 |
| 录音入口 | 浏览器 `MediaRecorder` → 走 `voice.py`（§7.1） | **原生录音**（Tauri 可调系统麦克风，体验更稳）+ 同 ASR | §7 |
| 上传跨页持久 | 切页即停（SPA 内存态） | **全局上传总线**（切到别的 route 仍在传，完成回灌） | `:42-58`（`activeMeetingUploads` map + listener） |
| 返回/切页导航 | 三 tab `<Link>` 条切换（`:250-265`） | **无 tab 条**；顶部单个 `ArrowLeft`「返回项目网盘」+ `useNavigate`（`:318-323`） | 两端文件各自 |
| 操作反馈 | 仅 `err` 行（无 toast 组件，错误落红字行 `:306`） | `@yqgl/shared` `toast()`（确认成功/创建中均弹 toast，`:269-271`） | 两端文件各自 |
| 主动通知呈现 | 无（页面内静态） | **桌宠主动弹**「会议处理好了 / 有 N 条待确认」（替代右下角弹窗，§7.3 为 WorkHub 目标） | §7.3、glossary §8「桌宠」 |

> **会议链的设备令牌门定位**：会议**查看/上传/确认**属「派活/管理」性质，**不强制**设备令牌门（浏览器可做，沿用现状——`meetings.py` 各端点只挂 `current_user`，未挂 `require_local_client`）。这与「接活/干活/同步需桌面端」的门是两回事（api-contract §3.2）。**唯一桌宠独占**的是「原生录音」的体验增强，非权限限制。

### 2.8 响应式

- **≥xl**：左右双栏（360 + 弹性）。
- **<xl**：单列堆叠——导入卡 → 会议列表 → 选中详情依次竖排（`xl:grid-cols-*` 在窄屏退化为单列，现状栅格天然支持）。
- 详情内「转写 / 纪要」双栏在 `<xl` 也退为单列（`xl:grid-cols-2`，`ProjectMeetings.tsx:382`）。
- 头卡操作区 `sm:flex-row`，窄屏竖排（`ProjectMeetings.tsx:348`）。

---

## 3. P2 — 导入会议（上传 / 录制）

> 现状是左栏内的一张卡（`ProjectMeetings.tsx:269`）。WorkHub 把它**提为弹层/抽屉**（点「导入会议」浮起），让主页更聚焦于「看资产」，但**交互内核不变**。

### 3.1 布局（弹层 wireframe）

```
┌─ 弹层：导入会议 ──────────────────────────────[✕]┐
│  🔼 导入会议录音                                   │
│  [ 会议标题（不写就用文件名） ........... ]         │
│  ┌─────────── 拖放区（dashed）───────────────┐    │
│  │            🎵                              │    │
│  │   选择音频 / 会议转写文本                   │    │
│  │   真实环境走 ASR；也可上传文本纪要          │    │
│  │   [ 选择文件 ]   [ 🎙 现在录制 ]            │    │
│  └────────────────────────────────────────────┘    │
│  支持: 音频(*) / .txt / .md ；音频上限 {N}MB，      │
│        文本上限 1MB                                  │
│  [⚠ {错误}]                                         │
└─────────────────────────────────────────────────────┘
```

### 3.2 关键组件与数据/API 绑定

| 元素 | 行为 | API（分片上传，api-contract §2.10） | 现状锚点 |
|---|---|---|---|
| 标题输入 | 可空，空则用文件名 stem | （随 init 带 `title`） | `ProjectMeetings.tsx:148` |
| 选择文件 | `accept="audio/*,.txt,.md"` | 见下三步 | `ProjectMeetings.tsx:297` |
| **录制**（WorkHub 显式化） | 浏览器 `MediaRecorder` / 桌宠原生 → 得到 blob，复用上传链 | 同上传链 | §7.1 |
| init | 算 `total_chunks=ceil(size/5MB)` → 拿 `upload_id` | `POST .../meetings/upload/init` | `meetings.py:172`、`ProjectMeetings.tsx:143` |
| 逐块 PUT | 5MB/块顺序上传 | `PUT .../upload/{uid}/chunk/{idx}` | `meetings.py:214`、`:151` |
| finalize | 合并 → 建 `MeetingRecord` + `BackgroundJob` → 触发后台处理 | `POST .../upload/{uid}/finalize` | `meetings.py:258`、`:153` |

> **上传约束（真实代码，UI 须前置提示）**：
> - 音频总上限 `settings.meeting_max_bytes`（init 超限 413，`meetings.py:181`）。
> - **文本会议**（`.txt/.md` 或 `text/*`）单独 1MB 上限（`TEXT_MEETING_MAX_BYTES`，`meetings.py:182`）。
> - `total_chunks` 必须与 5MB 切块算法一致，否则 400（`meetings.py:187`）。
> - 仅上传发起者能续传/finalize（`meetings.py:228/273`，403）。

### 3.3 四态

| 态 | 表现 |
|---|---|
| **空/初始** | 拖放区静态文案「选择音频 / 会议转写文本」 |
| **加载（上传中）** | 拖放区文案 → 「上传 {文件名}」；「选择文件」「录制」禁用（`disabled={!!busy}`）；WorkHub 加分块进度条（现状只显示文案） |
| **错误** | 红 `⚠` 行：413 超限 / 400 块不匹配 / 403 非发起者 / 网络错 |
| **无权限** | 关联不可见需求 → init 403；UI 落到错误行 |

### 3.4 跳转流

```
选文件/录制 → upload() → init → N×chunk → finalize
  → 返回 MeetingRecord(status=processing) → 关闭弹层
  → 主页左栏列表插入该会议(处理中) + 自动选中
  → 后台 ASR+纪要异步跑（_process_meeting，meetings.py:347）
  → 完成 SSE meeting.ready → 详情出现转写/纪要/洞察
```

---

## 4. P3 — 洞察确认（人确认 = 草稿入口的闸门）

> 这是 M-MEETING 与 PRD「AI 干、人确认」宪法咬合最紧的一页：AI 已经判好「这是不是需求 + 为什么」，**人只做一个动作——进入评估 / 忽略**。现状是详情右栏的「需求评估」分区（`ProjectMeetings.tsx:397`），WorkHub 额外加跨项目聚合页（§4.3）。

### 4.1 单条洞察卡布局（wireframe）

```
┌─ 洞察卡（InsightCard）───────────────────────────────────┐
│ [类型 pill: 新增需求 | 需求变更 | 普通纪要]                 │
│ [状态 pill: 待你确认 | 创建中 | 已确认 | 已忽略]            │
│ {洞察标题}                                                 │
│ {洞察描述（多行，whitespace-pre-wrap）}                     │
│ 💡 AI：{confidence_reason —— 我为什么这么判断}              │
│                         [进入评估]  [忽略]                  │
│                         （已确认后 → [去澄清 →]）           │
└───────────────────────────────────────────────────────────┘
```

字段映射（`MeetingInsightOut`，`schemas.py:639`）：`kind` → 类型 pill；`status` → 状态 pill；`title`/`description` → 正文；`confidence_reason` → AI 理由行；`created_requirement_id` → 「去澄清」链。

> **去黑话/可解释落点（两端现状已分叉，必须拉齐）**：`confidence_reason` 直接是 glossary §3.3 「AI 之所以这么判断，是因为…」的现成实现。**但前缀文案两端不一致**——
> - **桌宠端已合规**：标签是「AI 判断：{reason}」（`client-tauri/.../ProjectMeetings.tsx:497`），符合人话规则。
> - **web 端仍漏黑话**：标签是「LLM：{reason}」（`web/.../ProjectMeetings.tsx:426`），「LLM」违反 glossary §1.2 规则 1。
>
> **WorkHub 须把 web 端拉齐到桌宠端的「AI …」口径**（这是 web 残留，不是统一现状），并在 C-UIKIT 收口为单一组件杜绝再分叉。

### 4.2 数据/API 绑定 + 后端幂等（务必懂，UI 行为依赖它）

| 操作 | API | 返回 | 现状锚点 |
|---|---|---|---|
| 进入评估（确认） | `POST /api/meeting-insights/{id}/confirm` | `MeetingInsightOut`（理想含 `created_requirement_id`） | `meetings.py:470`、`confirmInsight()` |
| 忽略 | `POST /api/meeting-insights/{id}/dismiss` | `MeetingInsightOut`（`dismissed`） | `meetings.py:608` |

确认的后端语义（**真实、复杂、UI 必须配合**，`meetings.py:470-605`）：
1. **仅上传者**可确认（`:481`，403）。
2. **原子 CAS 占位**：`pending`（或 `confirmed`/`creating_requirement` 但 `created_requirement_id` 仍为 NULL 的可重试态）→ `creating_requirement`，防双击/双设备各建一个 `Requirement`（`:503-526`）。CAS 失败（别人抢先）→ 直接返回最新态。
3. 先 commit 占位，**再建草稿** `Requirement`（`status=draft`、带 `source_meeting_id`、`source_requirement_id`、`raw_description` 内含「来源会议」回链，`:547`）。
4. **`next_seq` 编号竞态重试 5 次**（并发确认/建需求/网盘评论都在抢 `PROJ-NNN`，IntegrityError 重试，`:543-595`）。
5. 失败兜底：把洞察重置为「`confirmed` + `created_requirement_id=NULL`」，**让 UI 重试**（`:584`）——这就是为什么前端有「重试创建需求」按钮（`ProjectMeetings.tsx:437`）。
6. 成功 → 发 `meeting.insight_confirmed`（`:600`）。

> **UI 必须懂的两个非显然态**（现状已实现，`ProjectMeetings.tsx:405-410`）：
> - `creating_requirement` 且无 `created_requirement_id` = transient「创建中」，但**仍可点**（崩溃恢复路径）。
> - `confirmed` 但 `created_requirement_id=NULL` = 上一次建草稿失败，按钮显示**「重试创建需求」**而非「进入评估」。

### 4.3 三种 kind 的确认行为差异

| `kind` | 用户标签 | 「进入评估」是否建需求 | 确认后跳转 |
|---|---|---|---|
| `new_requirement` | 新增需求 | **是**，建 `draft` WorkItem | 「去澄清」→ `/r/{id}/clarify` |
| `requirement_change` | 需求变更 | **是**，建 `draft` WorkItem，`source_requirement_id` 指向被变更需求（`:561`） | 同上 |
| `normal_note` | 普通纪要 | **否**，仅记录（`creates_requirement=False`，`:488`） | 无跳转，显示「已记录」pill（`ProjectMeetings.tsx:447`） |

> 现状 `normal_note` **不可确认**（`canConfirmInsight = insight.kind !== "normal_note" && ...`，`ProjectMeetings.tsx:407`）——它只能被「忽略」或保持。

### 4.4 关键跳转流（出 M-MEETING，入 M-WORKITEM）

```
洞察(new_requirement, pending)
  └ 点「进入评估」→ confirm → creating_requirement →（后台建 draft WorkItem）→ confirmed + created_requirement_id
        └ 按钮变「去澄清」→ /r/{created_requirement_id}/clarify
             └ 进入需求主轴：ai_clarifying → spec_ready → ai_working …（见 requirements-workitem.md / PRD §7.1）
```

> **WorkHub 增量**：确认建出的 WorkItem 默认进 `ai_clarifying`，且因为 PRD「AI 默认驾驶」，**可直接排队给 AI 工人**（无需人再推一把）——会议→需求→AI 执行可端到端自治，人只在洞察确认这一个闸门点头。这正是会议链成为 P1 旗舰「反转」样板的原因（PRD §12）。

### 4.5 跨项目洞察聚合页（WorkHub 新增，挂 M-NOTIFY 收件箱）

- **路由**：`/inbox?tab=insights`（web）/ 桌宠 Inbox（`client-tauri/.../routes/Inbox.tsx`）。
- **目的**：解决「洞察散落在各项目会议详情、没有统一待办入口」的现状缺口。
- **布局**：列表，每行 = `<InsightCard>` + 来源会议/项目标签 + 「打开会议」链（深链回 P1 `?m=`）。
- **数据**：聚合「我作为上传者、`status=pending` 的全部洞察」。MVP 可前端聚合各项目 `listMeetings` 的内嵌 insights；P2+ 加专用端点（归 api-contract，本篇不定签名）。
- **四态**：空「没有待确认的会议建议」；加载 Skeleton；错误 toast；无权限走整页守卫。

---

## 5. 数据流总览（端到端，一张图）

```
[录制/上传] (P2)
   │ 分片 init→chunk→finalize (meetings.py:172/214/258)
   ▼
MeetingRecord(status=processing) + BackgroundJob(meeting_minutes)
   │ background_tasks → _process_meeting (meetings.py:347)
   ├─ 25%: ASR 转写 _transcribe_or_decode → transcript_text   (meetings.py:354/406)
   │        └ 音频→ASR(asr_base_url)/ 文本→本地解码(utf-8/gb18030/utf-16)
   ├─ 60%: meeting_agent.analyze_meeting (meeting_agent.py:94)
   │        └ LLM → {minutes_md, insights[{kind,title,description,confidence_reason}]}
   │           └ 无 key / 异常 → _fallback(关键词判 kind + 提示人工确认) (meeting_agent.py:52)
   ├─ 写 minutes_md + 删旧 insights + 建新 MeetingInsight(status=pending) (meetings.py:371-383)
   └─ 100%: status=ready → publish meeting.ready (meetings.py:387)
   ▼
[详情页渲染转写/纪要/洞察] (P1) ← SSE meeting.ready 触发重拉
   ▼
[洞察确认] (P3) 人点「进入评估」
   │ confirm CAS + 建 draft Requirement(source_meeting_id 回链) (meetings.py:547)
   ▼
WorkItem(draft) → 进澄清主轴（M-WORKITEM）→ publish meeting.insight_confirmed
```

> **AI 降级（现状已有，WorkHub 保留并接成升级口径）**：`analyze_meeting` 在**无 LLM key 或调用异常**时走 `_fallback`（`meeting_agent.py:52/137`）——关键词粗判 `kind`，纪要直接放转写片段，`confidence_reason` 明写「本地 fallback 根据关键词判断，建议人工确认」。这是「AI 受阻不静默失败、转人确认」的天然样板，呼应 PRD §8.2 三触发器之「不合格→请人」。WorkHub 把这种「AI 没把握」统一用 glossary §3.3 三档语气呈现（此处=「我不太确定，想请你拍板」）。

---

## 5.5 TypeScript 实现现状（2026-09-05，SA-02 落地后）

> 上面 §5 描述的是被迁移的「需求管理大师」Python 实现。这一节写 **WorkHub 现在真正跑的东西**，
> 用于回答「点了导入之后到底发生了什么」。

### 5.5.1 真实链路

```
[导入会议转写] POST /api/meetings/projects/:projectId/import
   │ meetings.ts importTranscript → meeting_records(status=transcribed)
   │ 源文件语义 = 转写文本本身（audio_* 列存的是记录源文件，不必有音频）
   ▼
[排队分析] 两条触发路径，认领是同一把闸
   ├─ 导入成功后立刻排一次（services/meeting-pages.ts，不 await）
   └─ 后台巡检 workers/meeting-analysis.ts 每轮扫 status=transcribed
   │   以及认领后卡死超时的 processing（进程崩在分析中途的孤儿）
   ▼
[分析] services/meeting-analysis.ts
   │ ① provider 未配置 → 直接返回，**绝不动会议状态**（页面负责说明）
   │ ② 认领：条件 UPDATE status transcribed→processing，认领不到即已有人在跑
   │ ③ 预算软闸：decideRunBudget 读团队用量快照，不足则把认领放回 transcribed
   │ ④ 一次 LLM 调用（disableThinking，结构化 JSON 输出）
   │ ⑤ 解析：{minutes_md, insights[{kind,title,description,confidence_reason}]}
   ▼
[落库] meetings.ts saveMeetingAnalysis（一个事务）
   │ 清掉上一轮还没被人处理的 pending 洞察（confirmed/dismissed 是人的决定，不动）
   │ 插 meeting_insights(status=pending) + 写 minutes_md + status=ready + 审计
   ▼
[通知] createOrUpdateNotification(meeting.insight.pending)
   │ dedupeKey = meeting_insight:<insightId>，与读路径
   │ services/schedule-notify-pages.ts 的补通知共用同一把 key，不会重复出卡
   ▼
[洞察确认] 人点「生成草稿」/「忽略」（这两条端点早已存在并可用）
   POST /api/meetings/projects/:projectId/insights/:insightId/draft|dismiss
   │ insightToDraft：建 work_item(status=ai_clarifying, source_meeting_id 回链)
   │ + 一条 intent chat_message（带转写/纪要摘录）+ 洞察置 confirmed
   ▼
[变更提议] POST /api/meetings/workitems/:workItemId/proposal-draft
```

### 5.5.2 会议状态（`meeting_records.status`，无新增迁移）

| 取值 | 用户标签 | 含义 |
|---|---|---|
| `transcribed` | 转写已导入 | 转写在库，纪要还没生成；也是分析可认领态 |
| `processing` | 处理中 | 分析已被认领、正在跑 |
| `ready` | 已生成 | 纪要与洞察都已落库 |
| `failed` | 处理失败 | 分析失败，等人点「重新生成纪要」 |

> `transcribed` 此前被服务端折叠进 `processing`（`meetingStatus()`），于是「AI 正在分析」和
> 「AI 从没被叫起来」在页面上长得一模一样。SA-02 把它放出来，页面才说得清话。

### 5.5.3 AI 未配置时的诚实呈现（不是降级伪造）

现状**不做**上面 §5 里 Python 版的 `_fallback` 关键词伪纪要。理由：关键词拼出来的「纪要」
仍然是一条会进搜索、会进证据链的记录，读的人无从分辨它是不是 AI 读懂了这场会。改成直说：

- 会议页 VM 带 `ai_analysis_configured`（`packages/contracts/src/pages.ts`）；
- 为 false 时页面顶部出提示条「这个部署还没有配置 AI：导入的会议只会保存转写，纪要和洞察不会自动生成。」，
  纪要区写「AI 还没有配置，这场会议只保存了转写。」，并且**不下发**「重新生成纪要」按钮；
- 会议状态停在「转写已导入」，绝不会被写成「处理中」或「处理失败」。

### 5.5.4 重新生成纪要

`POST /api/meetings/:meetingId/analyze`（项目管理者）。强制认领，`ready`/`failed` 都能重跑，
同步等分析跑完再回一份新的会议页。分析中（`processing`）时不下发这个按钮，避免一次误点重复烧模型。
错误码：`meeting_analysis_unavailable`(503，未配置)、`meeting_analysis_budget_exhausted`(409)、
`meeting_analysis_failed`(409)、`meeting_forbidden`(403)、`meeting_not_found`(404)。

### 5.5.5 还没做的

- 音频与 ASR：现在只有「粘转写文本」这一条入口，没有录音上传、没有分片、没有 ASR。
- SSE：分析完成没有事件推送，页面靠下一次打开或手动刷新看到结果（§6 的演进点仍然待做）。
- 桌面端没有会议视图。

---

## 6. 进度推送：从轮询升级到事件流（WorkHub 演进点）

| 维度 | 现状 | WorkHub |
|---|---|---|
| 处理进度 | 前端 `setInterval(1500ms)` 轮询 `GET /api/jobs/{id}`（web `ProjectMeetings.tsx:101-131`、tauri `:176-198`），succeeded/failed 时停并重拉 | 订阅 `job.updated`（`job:{id}` + `user:{id}`，发布方 `services/jobs.py:79`；轮询 GET 在 `routers/jobs.py:43`）实时推进度；保留轮询作降级兜底（SSE 会丢，api-contract §5.1 背压） |
| 完成通知 | `meeting.ready`（`all`） | 同事件，topic 收敛到项目/上传者维度（§2.4） |
| 失败 | job `status=failed` + `error` 文案；轮询拾取 | `job.updated(failed)` 直接推 + 桌宠主动告知 |

> 进度文案以 `BackgroundJob.message` 为准（真实节点：「会议录音已上传，等待转写」→「正在转写会议录音」25%→「正在整理会议纪要」60%→「会议纪要已生成」100%，`meetings.py:279/354/360/384`）。UI 不自造文案，直接渲染 `job.message + progress_percent`（沿用 `ProjectMeetings.tsx:357`）。

---

## 7. 桌宠端（C-PET）专属：录音、上传持久化、主动提醒

### 7.1 本地录音

- **web**：`navigator.mediaDevices.getUserMedia` + `MediaRecorder` → webm blob → 走 §3 上传链（finalize 后同样 ASR）。
- **桌宠**：可走系统级录音（Tauri 命令调原生麦克风，稳定性/权限体验优于浏览器），录完落 webm → 同上传链。ASR 后端同一个（`voice.py` 代理 `asr_base_url`，或会议链内 `_transcribe_or_decode` 直连，`meetings.py:427`）。
- **零转写降级**：录音环境无 ASR 时，允许「上传文本纪要」（`.txt/.md`），`_decode_meeting_text` 本地解码（`meetings.py:70`）——E2E 也走这条文本 fixture 路径（`ProjectMeetings.tsx:284` 文案已点明）。

### 7.2 上传跨页持久化

桌宠用**全局上传总线**（`activeMeetingUploads` map + listener，`client-tauri/.../ProjectMeetings.tsx:42-58`）：上传在切到其它 route 后仍继续，完成回灌补选中。web 端为 SPA 内存态，切页即丢——WorkHub 可选择把此总线模式上提到 C-UIKIT 共享。

### 7.3 主动提醒（替代右下角弹窗，glossary §8 / PRD §8.9）

桌宠订阅 `meeting.ready` / `job.updated(failed)` / 自己名下 `pending` 洞察，**主动**以桌宠气泡呈现：
- 「{会议标题} 整理好了，有 N 条要点等你看」→ 点击 deep-link 到 `#/p/{pid}/meetings?m={id}`。
- 「{会议标题} 处理失败了，要不要重试或上传文本？」
- 提醒频率/时段受用户边界约束（`FR-PET-004`，归 [`tasks-reminders-notifications.md`](./tasks-reminders-notifications.md) / [`../05-clients/desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md)）。

---

## 8. 验收要点（本模块页面级 checklist）

> 完整 FR 清单见 [`../06-roadmap/functional-requirements.md`](../06-roadmap/functional-requirements.md)；此处给「页面对不对得上」的速查。

- [ ] **P1** 双栏：列表（状态 pill + 时间 + 上传人）+ 详情（头卡 + 转写 + 纪要 + 洞察），选中态可 `?m=` 深链。
- [ ] **四态齐全**：空（无会议/无洞察）、加载（上传中/processing 进度条）、错误（上传失败/processing 失败可重试）、无权限（非上传者隐藏确认/忽略，越权 403）。
- [ ] **P2** 导入：标题可空、`audio/*,.txt,.md`、分片 init→chunk→finalize、超限/块不匹配前置提示、录制入口（web `MediaRecorder` / 桌宠原生）。
- [ ] **P3** 洞察确认：三种 `kind` 行为正确（`normal_note` 不建需求）、`confidence_reason` 两端都以**人话「AI …」**呈现（桌宠端 `:497` 已是「AI 判断：」；**web 端 `:426` 现状仍是「LLM：」，须改**）、确认后跳 `/r/{id}/clarify`、失败态显示「重试创建需求」。
- [ ] **去黑话**：状态标签全走 `status-vocab.ts`，无 snake_case；无 `LLM`/`merge`/`PR` 等黑话漏出（glossary §1.2）。
- [ ] **SSE**：`meeting.ready` 翻列表态 + 重拉详情；`job.updated` 实时进度（替代/兜底轮询）；事件不泄漏私有内容（按 id 重拉经鉴权门）。
- [ ] **幂等**：双击确认/双设备确认不重复建 `Requirement`（CAS + `next_seq` 重试，依赖后端 `meetings.py:503/543`）。
- [ ] **桌宠差异**：`@yqgl/shared` 组件、设备令牌头、上传跨页持久、主动提醒 deep-link 回会议。

---

## 附：与其他文档的边界（避免重复）

| 想找 | 去哪 |
|---|---|
| `MeetingRecord`/`MeetingInsight` 字段、状态机、软删除字段 | [`../01-architecture/system-architecture.md`](../01-architecture/system-architecture.md) + 真实实体 `app/models.py:269/291` |
| 会议端点签名、SSE 帧格式、鉴权依赖、错误码 | [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md) §2.10 / §3 / §5 |
| 洞察确认后的需求澄清/派活/执行主轴 | [`requirements-workitem.md`](./requirements-workitem.md) |
| 「AI 判这是不是需求 + 为什么」的置信度/可解释口径 | [`../02-ai-engine/confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md) · [`../02-ai-engine/explainability.md`](../02-ai-engine/explainability.md) |
| 跨项目洞察聚合所在的通知收件箱、桌宠提醒边界 | [`tasks-reminders-notifications.md`](./tasks-reminders-notifications.md) · [`../05-clients/desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md) |
| 状态枚举→用户标签权威映射、去黑话规则 | [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md) §7 / §1.2 / §3.3 |
| ASR/TTS 代理端点 | 真实路由 `app/routers/voice.py`（`/api/voice/transcribe` 等） |

*本篇定位：M-MEETING 的页面规划单一来源。实体级 → 架构/数据模型篇；接口级 → api-contract；下游主轴 → requirements-workitem。*
