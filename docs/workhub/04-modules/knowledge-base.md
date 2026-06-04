---
module: M-KNOWLEDGE
layer: L2（执行层 / 业务模块）
status: 🚧
owner: workflow
---

# 知识库（Knowledge Base）—— 语料构建 / 检索 / 引用问答

> **一句话**：WorkHub 的知识库是项目历史的「**可证据化记忆**」——把散落在需求 / 会议 / 文档 / 交付里的事实，用 **grep + 强制引用**（**无向量库**，PRD **D-4**）变成「能查、能问、每个结论都点得回原文」的语料。它是 [explainability](../02-ai-engine/explainability.md) 里所有「为何派此人 / 为何升级 / 为何判不合格」证据（`citations`）的**唯一来源**。
>
> **范围**：本篇是**页面规划级**——逐页给出路由、布局（顶栏/侧栏/主区/面板/弹层）、关键组件、数据与 API 绑定、SSE 订阅、空/加载/错误/无权限四态、关键交互与跳转流、响应式与 web↔桌宠差异、文字版 wireframe。
>
> **边界（不在本篇，交叉处只链接不重复）**：
> - 语料检索机制、grep 链路、强制引用铁律、`Rationale`(理由+证据+trace) 原语 → [explainability](../02-ai-engine/explainability.md)（本模块是它的「检索后端」与「独立页面入口」）。
> - 知识库的 HTTP/SSE 接口契约（`/api/knowledge/*` §2.11、事件清单 §5、`job.updated` 隔离 §5.3）→ [api-contract](../01-architecture/api-contract.md)。
> - `KnowledgeDocument` / `KnowledgeAskRun` 实体字段、软删除/审计字段 → [data-model](../01-architecture/data-model.md)。
> - 进程边界、`_periodic_knowledge_reindex` 在 daemon 后台任务域的位置、事件总线 → [system-architecture](../01-architecture/system-architecture.md)。
> - 术语（grep 知识库 / 证据 / 历史搜索 / 设备令牌门）以 [glossary-dejargon](../00-overview/glossary-dejargon.md) 为权威。
>
> **扎根**：本篇页面规划由现有「需求管理大师」真实实现演进而来。后端：`app/services/knowledge.py`、`app/routers/knowledge.py`、`app/models.py:110/128`、`app/schemas.py:416`；前端：`web/src/pages/KnowledgePage.tsx`（C-WEB 现状）、`client-tauri/web-src/src/routes/Knowledge.tsx`（C-PET 现状）。所有路径与行号锚点贯穿全文。

---

## 0. 本模块小节导航

1. 模块在产品里的位置（为什么知识库是 AI-native 的地基）
2. 数据与 API 绑定总表（页面用得到的全部端点 + DTO + SSE）
3. 信息架构与路由清单（逐页列出）
4. 页面 KB-1：历史搜索 / 问答主页（`/knowledge`）—— 重点页
5. 页面 KB-2：问答详情（deep-link `?run_id=`）—— 证据与 trace 呈现
6. 页面 KB-3：项目内嵌「证据」面板（`/p/:id` 等的副入口）
7. 嵌入式用法：作为 AI 决策的证据来源（与 explainability 的接缝）
8. 管理员：重建索引（reindex）入口与四态
9. 四态规约（空/加载/错误/无权限）总表
10. 响应式与 web↔桌宠差异
11. 设计约束与开放问题

---

## 1. 模块在产品里的位置

知识库**不是**一个独立的「文档管理」功能，而是两个角色叠加：

1. **面向人的「历史搜索 / 问答」页面**（`M-KNOWLEDGE` 看得见的功能）：用户（负责人/提交者/协作者）想知道「上次这个决策怎么定的」「这条规则在哪份文档里」时，来这里 grep 项目历史 + 让 AI 带证据回答。现状已落地为 web 的 `/knowledge`（`KnowledgePage.tsx`）与桌宠的 `Knowledge.tsx`。
2. **面向 AI 的「证据后端」**（横切 P-AI）：[explainability](../02-ai-engine/explainability.md) 规定「凡涉及项目事实的断言必须能落到 `citations`」，而 `citations` 唯一来源就是本模块的 `search_knowledge()`。`assistant.py:_evidence_block()` 已示范把 grep 命中作为 evidence block 注入 LLM 上下文——WorkHub 的三个「为何」决策点（派活/升级/判不合格）都复用这条链路。

> **去黑话**：用户面**不出现**「grep」「索引」「向量」「语料」这些词。用户看到的是「**在历史里翻翻**」「**查证据**」「**AI 助理找证据再回答**」（现有文案，`KnowledgePage.tsx:302-304`）。本篇正文用内部术语（grep / corpus / citations）沟通，UI 文案一律走人话。

**两条不可动摇的范式（PRD D-4 + explainability 第 3 节）**：
- **无向量库**：检索只走 `services/knowledge.py` 的 grep 链路（`rg --json` 优先，纯 Python 兜底），扩展只允许加 `source_type`，**不允许换检索范式**。
- **强制引用**：有命中→结论后必跟 `## 证据` 区块逐条可点回原文；零命中→**绝不编**，直接说「没有找到可靠依据」（`answer_from_hits()`，`knowledge.py:489`）。

---

## 2. 数据与 API 绑定总表

页面只消费下列既有端点（全部 **[现]**，见 [api-contract §2.11](../01-architecture/api-contract.md)）；WorkHub 仅做演进标注，不新增检索范式。

| # | 方法 路径 | 入参 | 出参 DTO | 鉴权 | 页面用途 | 锚点 |
|---|---|---|---|---|---|---|
| K1 | `GET /api/knowledge/search` | `?q`（1–500）`&project_id?` `&scope?` `&limit?`(1–80,默认20) | `KnowledgeSearchOut{query, hits[]}` | `current_user` | KB-1 关键字搜索主区 | `knowledge.py:42` |
| K2 | `POST /api/knowledge/ask` | `KnowledgeAskIn{question(1–2000), project_id?}` | `KnowledgeAskCreateOut{id, job_id, status}`（**异步**） | `current_user` | KB-1 问答面板「让 AI 找证据」 | `knowledge.py:73` |
| K3 | `GET /api/knowledge/runs/{id}` | — | `KnowledgeAskRunOut{question, status, answer_md, citations[], trace[], job_id, …}` | **仅提问本人**（`created_by_user_id`） | KB-2 轮询/回放问答结果 | `knowledge.py:96` |
| K4 | `POST /api/knowledge/reindex` | `?project_id?` | `{ok, count}` | **admin only** | 管理员重建索引（§8） | `knowledge.py:57` |
| 辅 | `GET /api/projects`（listProjects） | — | `Project[]` | `current_user` | 项目范围下拉 | `web/src/lib/api` |
| 辅 | `GET /api/jobs/{id}` | — | `BackgroundJobOut{status, progress_percent, message, result_ref, error}` | owner（知识库 job 的 `result_ref` 非 req/meeting，故 `_can_view_job` 落到属主短路，`routers/jobs.py:14/48`）| （可选）问答进度条 | `routers/jobs.py:43` |

**关键 DTO**（`schemas.py:416-454`）：

```text
KnowledgeSearchHit            # 一条证据 = grep 命中的一行
├─ document_id / source_id    # 定位语料行
├─ source_type                # project|requirement|chat|comment|activity|
│                             #   workspace_update|meeting|meeting_insight|drive_file|delivery
├─ project_id? / requirement_id?
├─ title                      # 人话标题，如 "PROJ-001 登录页改版" / "会议：周会"
├─ source_url                 # 可点回原文，如 /r/<id> /p/<id>/drive /r/<id>/clarify
├─ line_no                    # 命中行号（呈现为「第 N 行」）
└─ snippet                    # 命中行上下文（±1 行，≤1000 字符；rg 命中为单行）

KnowledgeAskRunOut
├─ question / status(running|succeeded|failed)
├─ answer_md                  # 人话结论（Markdown）= Rationale.summary_md 的同源
├─ citations: KnowledgeSearchHit[]   # 强制引用（≤8）
├─ trace: dict[]              # [{tool:"grep_corpus", query, hit_count}]（可回放过程）
└─ job_id?                    # 关联 BackgroundJob（进度/崩溃恢复）
```

### 2.1 SSE 订阅（页面实时性来自哪里）

> **现状**：知识库问答**不走 SSE 订阅**——`KnowledgePage.tsx` / `Knowledge.tsx` 都用**轮询** `GET /knowledge/runs/{id}`（默认 1s 间隔、上限 120 次，`askPollIntervalMs`/`askPollLimit`，`KnowledgePage.tsx:11-22`）。问答完成时后端发一条 `notification.created`（`type=knowledge_answer`，私有 `user:{id}` topic，`knowledge.py:134`）+ `job.updated`（`job:{id}`+owner `user:{id}`，**绝不发 `all`**，`services/jobs.py:71`）。
>
> **注**：本树有两个 `jobs.py`——`routers/jobs.py`（HTTP 端点 `GET /api/jobs/{id}` 及 `_can_view_job` 可见性）与 `services/jobs.py`（`create_job`/`update_job`/`publish_job` 发布逻辑）。下文锚点带目录前缀以消歧。

| 事件 | topic | 谁可订阅 | 页面消费 | 锚点 |
|---|---|---|---|---|
| `notification.created` | `user:{id}`（私有） | 仅本人 | 全局 toast「知识库回答好了」→ 点击跳 KB-2 | `knowledge.py:134`、`notifications.py:105` |
| `job.updated` | `job:{id}` + owner `user:{id}` | 该 job 查询者 | （可选）问答进度条 25%→70%→100% | `services/jobs.py:79-81` |

**WorkHub 演进（建议，不强制）**：把问答进度从「轮询」升级为订阅 `job:{id}` 的 `job.updated`（与会议/decomposition 一致），轮询作为 SSE 丢包后的 reconcile 兜底（遵循 [api-contract §7](../01-architecture/api-contract.md) 的「REST 拉取为真相，SSE 为增量提示」）。该升级**不改 K1–K4 契约**，仅前端订阅方式变化。**搜索（K1）保持同步**，无需 SSE。

> **隐私铁律（NFR-08）**：`job.updated` 携带 `result_ref`（= `KnowledgeAskRun.id`）与 `message`，**绝不**发 `all`——历史上发生过把通知/进度扇出到 `all` 导致跨用户泄漏的事故（[system-architecture §5.2](../01-architecture/system-architecture.md) sse.rs 事故注释、`services/jobs.py:71` 与 `services/notifications.py:95` 注释明写「same class of cross-user info disclosure」）。新增任何知识库事件**先判私有性**。

---

## 3. 信息架构与路由清单

知识库在两端都是「PM/查证」类工具，**纯查询、无设备令牌门**（K1–K4 仅需 `current_user`；reindex 需 admin）。

| 代号 | 路由（C-WEB）| 路由（C-PET）| 页面 | 入口 | 设备门 |
|---|---|---|---|---|---|
| **KB-1** | `/knowledge` | `/knowledge`（侧栏「在历史里翻翻」）| 历史搜索 + 问答主页（**重点**）| 顶栏「看板」二级菜单→「历史搜索」(`App.tsx:323`)、⌘K「历史搜索」(`App.tsx:136`)、桌宠对话「帮我查…」 | 否 |
| **KB-2** | `/knowledge?run_id=<id>` | 同（deep-link）| 问答详情（一次 ask 的结论+证据+trace 回放）| KB-1 内发起 ask 后、通知 toast 跳转、桌宠 deep-link | 否 |
| **KB-3** | （内嵌）`/p/:id`·`/r/:id`·`/p/:id/drive` 的「证据/相关历史」面板 | 同 | 项目/工单上下文内的轻量 grep 副入口（带 `project_id`/`scope` 预填）| 项目页、工单详情、网盘评论旁 | 否 |
| **KB-A** | （内嵌于 KB-1，admin 可见）| 同 | 重建索引按钮 + 状态 | KB-1 顶部 admin-only 操作 | 否（admin RBAC）|

> **现状说明**：KB-1 与 KB-2 在现有代码里是**同一个页面**（`KnowledgePage.tsx`），靠 URL query (`q` / `run_id` / `project_id`) 切换视图——这是有意的（可深链、可分享、可被通知 `target_url` 直达，`knowledge.py:131`）。本篇按「逻辑页面」拆开规划布局，实现上仍是一个路由 + query 驱动的双栏页。**KB-3 是 WorkHub 新增**的内嵌入口（现状只有独立页，无项目内副入口），落地为复用同一 K1 端点 + 预填 `project_id`/`scope`。

**导航位置（沿用现有 `App.tsx`）**：
- C-WEB：顶栏 4 主入口（项目/日程/通知/设置）之外，「看板」DropdownMenu 里第二组放「历史搜索」(`App.tsx:298-327`)；⌘K 命令面板也有「历史搜索」(`App.tsx:136`)。
- C-PET：桌宠侧栏常驻；额外可由**桌宠对话**驱动——用户说「帮我查一下登录页那个需求上次怎么定的」，Agent 走 K1/K2 并把结果渲染进对话（[api-contract §2.3 session](../01-architecture/api-contract.md)）。

---

## 4. 页面 KB-1：历史搜索 / 问答主页（`/knowledge`）【重点页】

**目的**：一页同时支持两种心智——① **关键字搜索**（grep，秒回，给原始证据行）；② **AI 问答**（带证据的人话结论，异步）。两者共享同一个「项目范围」过滤器。

**现状基线**：`KnowledgePage.tsx`（C-WEB）已是双栏布局——左「关键字搜索」、右「Agent 问答」，顶部一个「全部项目」下拉。桌宠 `Knowledge.tsx` 是两张上下堆叠的 Card（搜索 / 问 AI 助理）。

### 4.1 布局（文字版 wireframe，C-WEB）

```
┌─ 顶栏(全局 TopNav, sticky) ──────────────────────────────────────────────┐
│ 需求管理大师  项目 │看板▾│ 日程 │ 通知       ⌘K搜索…  ☀/☾  [昵称]  ? ⚙ │
└──────────────────────────────────────────────────────────────────────────┘
┌─ 主区 header ─────────────────────────────────────────────────────────────┐
│ 在历史里翻翻                                   [项目范围 ▾ 全部项目      ] │  ← 范围过滤器(K-辅)
│ 历史搜索                                                                   │
│ 查项目过去的决策、规则、交付物 —— 在需求、会议、文档里找证据。            │
└──────────────────────────────────────────────────────────────────────────┘
┌─ 左栏：关键字搜索 (1.1fr) ───────────────┐ ┌─ 右栏：Agent 问答 (0.9fr,≥360) ──────┐
│ [搜需求编号/会议标题/文件名/接单人…] [搜索]│ │ 🤖 Agent 问答                         │
│ 当前只搜：登录改版项目  (若选了 project)  │ │ ┌─────────────────────────────────┐  │
│ ─────────────────────────────────────── │ │ │ 问一个基于项目历史的问题…(多行)  │  │
│ ┌ 命中卡片 ─────────────────────────────┐│ │ └─────────────────────────────────┘  │
│ │ [requirement]  L42        [打开证据↗] ││ │ [✨ 让 AI 助理找证据]                 │
│ │ PROJ-001 登录页改版                    ││ │ ┌ 结论卡片(run) ──────────────────┐  │
│ │ ┌ snippet(pre, 可滚) ───────────────┐ ││ │ │ succeeded · 6 条证据             │  │
│ │ │ ## Summary 把登录页拆成…          │ ││ │ │ 我用项目知识库 grep 到这些依据…  │  │
│ │ └───────────────────────────────────┘ ││ │ │ ## 证据 1.[标题](↗)·第N行 …      │  │
│ └────────────────────────────────────────┘│ │ └─────────────────────────────────┘  │
│ … 更多命中(≤40)                            │ │ 💡 AI 助理只能基于项目历史回答；     │
│                                            │ │    找不到证据时会直接说明。          │
└────────────────────────────────────────────┘ └──────────────────────────────────────┘
```

### 4.2 区域与关键组件

| 区域 | 组件 | 说明 / 锚点 |
|---|---|---|
| **顶栏** | 全局 `TopNav`（web）/ 侧栏（桌宠）| 非本模块私有，沿用 `App.tsx:185` |
| **主区 header** | 标题区 + **项目范围下拉**（`<select>`，`Filter` 图标）| 选项 = 「全部项目」+ `listProjects()`；切换调 `updateProject()`，写 URL `project_id` 并清空当前命中/run（`KnowledgePage.tsx:233-252`）|
| **左栏·搜索框** | `input`（≥`min-h-11`）+ `button-primary`「搜索」| Enter 触发（避开输入法 composing，`KnowledgePage.tsx:322`）；`q` 为空禁用按钮；placeholder「搜需求编号、会议标题、文件名、接单人、关键句…」|
| **左栏·命中列表** | `article` 卡片数组 | 每卡：`pill`(source_type) + `L{line_no}` + 加粗 `title` + `internalLink(source_url,"打开证据")` + `<pre>`(snippet，`max-h-44` 可滚) |
| **右栏·问答输入** | `textarea`（`min-h-28`）+ `button-accent`「让 AI 助理找证据」| 提交调 `ask()`→K2→拿 `run_id`→写 URL→轮询 K3 |
| **右栏·结论卡片** | `run` 渲染块 | 头部 `{status}` + `{citations.length} 条证据`；`<pre>` 渲染 `answer_md`（含内联 `## 证据`）|
| **右栏·脚注** | 静态提示条（`FileSearch` 图标）| 「AI 助理只能基于项目的需求、会议、文档等历史回答；找不到证据时会直接说明」——**对用户明示无向量库/强制引用范式** |

### 4.3 数据流与跳转流

```
进入 /knowledge
  └─ listProjects() 填充范围下拉
  └─ 解析 URL: ?q / ?project_id / ?run_id
        ├─ 有 q 且无 run_id → 自动执行 K1 搜索(去抖、防竞态 searchSeqRef)
        ├─ 有 run_id        → 进入 KB-2 视图：轮询 K3(见 §5)
        └─ 都没有           → 空态(左:命中空提示；右:无 run)

关键字搜索:
  输入 q →[搜索/Enter]→ 写 URL(q, project_id, 删 run_id) → K1 → setHits
        └─ 点命中卡「打开证据」→ 路由跳 source_url(站内 <Link> / 站外 <a>)
                                  例: /r/<id>(工单) /p/<id>/drive(网盘) /r/<id>/clarify(澄清对话)

AI 问答:
  输入 question →[让 AI 找证据]→ K2 拿 {id} → 写 URL(run_id, 删 q) → 轮询 K3
        └─ 完成: 渲染 answer_md + citations；后端另发私有通知(可在别处点回)
        └─ 切换为 KB-2 的可分享/可深链状态(URL 带 run_id)
```

**防竞态（沿用现有，迁移须保留）**：搜索与问答各有单调 token（`searchSeqRef`/`askTokenRef`），快速二次提交或卸载时旧结果**不得覆盖**新结果；轮询循环每轮检查 token，过期即 abort（`KnowledgePage.tsx:42-49,254-263`、`Knowledge.tsx:50-55,84-89` 注释详述「two concurrent loops race on setRun → UI flicker」）。这是踩过坑的契约。

### 4.4 四态（KB-1）

| 态 | 左栏（搜索）| 右栏（问答）|
|---|---|---|
| **空** | `empty-state`「还没有命中。换一些关键词试试。」（`hits.length===0`，`KnowledgePage.tsx:335`）| 无 `run` 时不渲染结论卡，仅显示输入框 + 脚注提示 |
| **加载** | 按钮文案「搜索中…」+ 禁用；`setHits([])` 清空（搜索是同步秒回，无骨架）| 按钮文案「正在查找证据…」+ 禁用（桌宠用 `Skeleton h-16`，`Knowledge.tsx:200`）；结论卡显示 `running` |
| **错误** | `searchErr` 红字（`text-red-700`），命中清空（`KnowledgePage.tsx:332`）| `askErr` 红字；或轮询超时→`run.status="failed"` + 人话「AI 助理处理时间过长，请稍后重试。」（`KnowledgePage.tsx:84`）|
| **无权限** | K1 仅需 `current_user`（401 才拦）；**行级可见性在后端静默过滤**——他人 draft/clarifying 工单的命中**根本不出现在 hits 里**（`_requirement_visible`→`can_view_requirement_record`，`knowledge.py:67/459`），前端无需特殊态 | 同；K3 若非提问本人访问→403「only the question owner can view this run」（`knowledge.py:106`），前端显示「这条问答不属于你」并提供回 KB-1 |

> **无权限的关键设计**：知识库**不抛 403 给搜索**——它**从结果里抹掉**不可见行（NFR-08 隐私隔离）。同一条 ask 呈现给不同审批人时，`citations` 可能因可见性不同被裁剪（[explainability §3.2](../02-ai-engine/explainability.md)）。因此「无权限」对搜索是**透明的更少结果**，不是错误页。

---

## 5. 页面 KB-2：问答详情（`?run_id=<id>`）—— 证据与 trace 呈现

**目的**：一次 `ask` 的可分享/可回放结果页。承载 explainability 的 `Rationale`（结论 + 证据 + trace）三件套面向**人**的呈现。现状是 KB-1 右栏的「结论卡片」放大版，靠 `run_id` 深链进入。

### 5.1 布局（文字版 wireframe）

```
┌─ 主区 header（同 KB-1，范围下拉随 run.project_id 自动校正，KnowledgePage.tsx:177-187）┐
└────────────────────────────────────────────────────────────────────────────────────┘
┌─ 问答详情卡 ──────────────────────────────────────────────────────────────┐
│ 问题：上次登录页改版的验收标准是怎么定的？        [状态: succeeded] [6 条证据]│
│ ─────────────────────────────────────────────────────────────────────────│
│ 【结论 answer_md】                                                         │
│   我用项目知识库 grep 到这些依据，先给结论：                               │
│   - 和"…"最相关的是：PROJ-001 登录页改版。                                 │
│   ## 证据                                                                  │
│   1. [PROJ-001 登录页改版](/r/abc) · requirement · 第 12 行                 │
│        ## Summary 验收：① 支持手机号登录 ②…                                │
│   2. [会议：登录评审](/p/x/meetings) · meeting · 第 40 行  …               │
│ ─────────────────────────────────────────────────────────────────────────│
│ ▸ 看看 AI 是怎么找的（trace，可折叠）  ← grep_corpus · query=… · 命中 6 条  │
└────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 区域、绑定与受众分层

| 区域 | 组件 | 绑定 | 说明 |
|---|---|---|---|
| **问题行** | `run.question` + 状态 `pill` + 证据计数 | K3 | 状态 `running/succeeded/failed` 走 [glossary §7](../00-overview/glossary-dejargon.md) 语气，不显原始枚举给小白 |
| **结论区** | `<pre>` / Markdown 渲染 `answer_md` | K3 `answer_md` | = `Rationale.summary_md`；含内联 `## 证据`（`answer_from_hits` 已格式化，`knowledge.py:497-507`）|
| **证据列表** | 可点条目（`[title](source_url) · source_type · 第 N 行` + snippet）| K3 `citations[]` | 每条点开跳 `source_url` 核对原文；这是「强制引用」的呈现 |
| **trace 折叠区** | `<details>`「看看 AI 是怎么找的」| K3 `trace[]` | 现状 `[{tool:"grep_corpus", query, hit_count}]`；小白默认折叠（[explainability §4.3](../02-ai-engine/explainability.md) 受众分层）|

**受众分层呈现（[explainability §4.3](../02-ai-engine/explainability.md)，本页落地）**：
- **小白/提交者**：默认只看 `answer_md` 一句话结论 + 折叠的「看看 AI 是怎么找的」。
- **负责人/审批人**：展开 `citations` 逐条核对 + trace 步骤。
- **管理员/复盘**：跨 run 聚合到看板（[dashboards-and-metrics](./dashboards-and-metrics.md)，不在本页）。

### 5.3 加载 / 轮询语义（KB-2 核心）

```
URL 带 run_id → 进入 KB-2
  └─ pollKnowledgeRun(run_id): 每 intervalMs(默认1s) GET K3
        ├─ status==running → 继续轮询(上限 limit 次，默认120)
        ├─ status==succeeded → 停，渲染结论+证据+trace
        ├─ status==failed → 停，显示 answer_md(失败原因，人话) 红字
        └─ 超 limit 仍 running → 本地置 failed + 人话超时提示(KnowledgePage.tsx:84)
  └─ 副作用: run.project_id 回填范围下拉(replace URL，不污染历史，:177-187)
```

### 5.4 四态（KB-2）

| 态 | 表现 |
|---|---|
| **空** | `run_id` 不存在/被删 → K3 404「knowledge run not found」→ 显示「这条问答找不到了」+ 回 KB-1 按钮 |
| **加载** | `status==running`：骨架 / 「正在翻资料…」（`KnowledgePage.tsx:376` 的 `answer_md \|\| "正在翻资料…"`），轮询进行中 |
| **错误** | `status==failed`：`answer_md` 即失败人话（来自后端 `_process_knowledge_ask` except 分支，`knowledge.py:148-159`，message「知识库问答失败」）；或轮询超时人话提示 |
| **无权限** | K3 403（非 `created_by_user_id` 本人）→「这条问答不属于你」+ 回 KB-1（`knowledge.py:105`）|

> **WorkHub 演进点**：现状 `KnowledgeAskRun` 严格私有（仅提问本人可见 K3）。当知识库问答被嵌入**协作场景**（如把一条 ask 作为 Proposal 的证据附给负责人）时，需要把 run 的可见性从「仅本人」放宽到「该 WorkItem 可见者」——但**`citations` 仍按访问者身份做行级过滤**（不可因为能看 run 就越权看到原本不可见的证据行）。此放宽是 P2/P3 协作接入时的开放问题，见 §11。

---

## 6. 页面 KB-3：项目内嵌「证据」面板（副入口）【WorkHub 新增】

**目的**：把 grep 检索从「独立页面」下沉为「**上下文内的查证按钮**」——用户在工单详情、项目页、网盘评论旁，不必跳走就能 grep 当前项目历史。这是 WorkHub 对现状的增量（现状只有独立 `/knowledge`）。

**实现策略**：**不新增端点**，复用 K1，预填 `project_id`（来自当前路由的 `:id`）与可选 `scope`（如在网盘里→`scope=drive_file`；在澄清页→`scope=chat`，对齐 K1 的 `scope` 入参，`knowledge.py:46/457`）。

### 6.1 布局（文字版 wireframe，作为侧抽屉/面板嵌入 `/r/:id`）

```
┌─ 工单详情主区 ───────────────────────┐ ┌─ 证据面板(抽屉, 可关) ──────────────┐
│ PROJ-001 登录页改版 ...               │ │ 在这个项目里翻翻         [✕ 关闭]   │
│ 概要 / 验收 / 交付 / 活动 ...          │ │ [搜本项目历史…]            [搜索]    │
│                                       │ │ 范围: ● 全部  ○ 文档  ○ 对话 ...    │ ← scope 切换(可选)
│                  [🔍 查相关历史] ─────┼─►│ ┌ 命中卡(同 KB-1 卡片样式) ───────┐ │
│                                       │ │ │ [meeting] L40  [打开↗] 会议：…   │ │
│                                       │ │ └─────────────────────────────────┘ │
│                                       │ │ 没找到？[去完整历史搜索 → /knowledge]│ ← 升级到 KB-1
└───────────────────────────────────────┘ └──────────────────────────────────────┘
```

### 6.2 区域与跳转

| 区域 | 绑定 | 说明 |
|---|---|---|
| 触发按钮「查相关历史」| — | 嵌入工单页/项目页/网盘评论；点开抽屉 |
| 搜索框（预填 project_id）| K1 + `project_id=<route id>` | 范围锁定当前项目，文案「在这个项目里翻翻」|
| scope 切换（可选）| K1 `&scope=` | 全部 / 文档(drive_file) / 对话(chat) / 会议(meeting) / 交付(delivery)——映射 `source_type` |
| 命中卡 | 同 KB-1 | 点「打开证据」跳 `source_url`（同项目内多为站内 `<Link>`）|
| 「去完整历史搜索」| 跳 `/knowledge?project_id=<id>&q=<q>` | 把当前 query/范围带去 KB-1，跨项目继续找 |

### 6.3 四态（KB-3）
- **空**：抽屉内「这个项目里没翻到。试试更具体的词，或去完整历史搜索。」+ 跳 KB-1 链接。
- **加载**：按钮「搜索中…」禁用（同步秒回）。
- **错误**：红字 + 重试。
- **无权限**：后端行级过滤静默裁剪（同 KB-1）；项目本身若不可见，触发按钮不渲染（由宿主页 RBAC 决定）。

---

## 7. 嵌入式用法：作为 AI 决策的证据来源（与 explainability 的接缝）

知识库的**第二个角色**没有独立页面，但页面规划必须明确它在别处怎么「显形」：

| AI 决策点 | 在哪个页面显形 | 证据来自本模块 | 锚点 |
|---|---|---|---|
| **为何派此人** | 智能派活提议卡（[smart-staffing](../02-ai-engine/smart-staffing.md)）| 提议卡的「为什么推荐他」附 `citations`（点回历史协作记录）| explainability §1/§5 |
| **为何升级** | 升级简报 / 工单详情升级条（[pm-mode](../02-ai-engine/pm-mode-orchestration.md)、[confidence-risk-escalation](../02-ai-engine/confidence-risk-escalation.md)）| `EscalationEvent` 的 `Rationale.citations` | explainability §5 |
| **为何判不合格** | Proposal 审查页 / 打回理由（[review-and-approval](../03-collaboration/review-and-approval.md)）| `llm_review` reason + grep 命中作证 | explainability 第 1 节、`auto_agent.py:544` |
| **助手对话引用** | 澄清对话 / 桌宠会话 | `assistant.py:_evidence_block()` 把 grep 命中作 evidence block 注入 LLM（`assistant.py:78`）| explainability §3.3 |

> **接缝约定**：这些页面渲染证据时，**复用 KB-1/KB-2 的「命中卡 / 证据条」组件**（`source_type` pill + title + `source_url` 链接 + snippet），保证「证据长得到处一样、都点得回原文」。组件归 `C-UIKIT`（[shared-ui-kit](../05-clients/shared-ui-kit.md)），本模块是其首发使用者。**语料扩列**：派活/升级要引用到提议正文与规格页，需给 `_source_docs()` 增加 `branch`/`proposal`/`spec_doc` 三个 `source_type`（[explainability §3.1](../02-ai-engine/explainability.md) WorkHub 演进点，纯增量）。

---

## 8. 管理员：重建索引（reindex）入口

**目的**：语料默认由后台周期任务刷新（`_periodic_knowledge_reindex`，5 分钟，`main.py` lifespan），但 admin 需要「立即重建」的手动入口（如刚导入大量历史、或排查搜不到）。

### 8.1 入口与布局
- **位置**：KB-1 主区 header 右侧，**仅 admin 可见**的次要按钮「重建索引」（普通用户不渲染——RBAC，`is_admin(user)` 短路，`knowledge.py:65-67`）。
- **行为**：点击 → 确认弹层（说明「这会扫描全部项目数据，可能耗时」）→ K4（带当前 `project_id` 或全量）→ 返回 `{ok, count}` → toast「已重建 N 条语料」。

### 8.2 四态
| 态 | 表现 |
|---|---|
| **加载** | 按钮「重建中…」禁用（K4 是同步阻塞调用，O(全量数据)，可能数秒）|
| **成功** | toast「已重建 {count} 条语料」|
| **错误** | toast 红「重建失败」+ 保留可重试 |
| **无权限** | 非 admin **看不到按钮**；强行调用 K4 → 403「admin only」（`knowledge.py:67`）|

> **为什么 reindex 是 admin-only**：现有注释明说「Any user being able to trigger it was a denial-of-service vector」（`knowledge.py:63`）——全量重扫是 O(所有数据) 的重活。**搜索时绝不内联重建**（曾是 self-DoS，`knowledge.py:437` 注释），新鲜度靠周期任务 + 此手动入口。WorkHub 迁移须保留这两条。

---

## 9. 四态规约（总表）

| 页面/区域 | 空 | 加载 | 错误 | 无权限 |
|---|---|---|---|---|
| KB-1 搜索 | 「还没有命中。换一些关键词试试。」 | 「搜索中…」禁用，清空旧命中 | `searchErr` 红字 | **静默裁剪**不可见行（不报错）|
| KB-1 问答 | 不渲染结论卡 | 「正在查找证据…」/ `Skeleton` | `askErr` 红字 / 超时人话 | 后端身份隔离 |
| KB-2 详情 | run 不存在→「找不到了」+回 KB-1 | `running`：「正在翻资料…」轮询 | `failed`：`answer_md` 失败人话 | 403→「不属于你」+回 KB-1 |
| KB-3 内嵌 | 「这个项目里没翻到」+去 KB-1 | 「搜索中…」 | 红字重试 | 触发按钮按宿主 RBAC 显隐 |
| KB-A reindex | — | 「重建中…」 | toast「重建失败」 | 按钮对非 admin 不渲染 |

**通用文案口径（[glossary §10](../00-overview/glossary-dejargon.md)）**：错误体走后端人话 `detail`（中文优先，[api-contract §6.1](../01-architecture/api-contract.md)）；零证据**明说无依据、绝不编**；不暴露异常栈/数值/「grep/索引」黑话给用户（[explainability §6](../02-ai-engine/explainability.md) 约束 6）。

---

## 10. 响应式与 web↔桌宠差异

### 10.1 响应式（C-WEB）
- **桌面 (≥xl)**：双栏 `xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]`（搜索 | 问答），右栏最小 360px（`KnowledgePage.tsx:315`）。
- **平板/窄屏 (<xl)**：单列堆叠——搜索在上、问答在下；范围下拉从 header 右侧落到标题下方（`lg:flex-row` 退化，`:300`）。
- **命中卡内部**：`<pre>` snippet `max-h-44` 可滚，长内容不撑破布局；卡头在 `sm` 以下竖排（`sm:flex-row`，`:338`）。
- **搜索/问答输入**：`md:flex-row`，窄屏输入框与按钮竖排（`:317`）。

### 10.2 web↔桌宠差异（C-WEB vs C-PET）

| 维度 | C-WEB（`KnowledgePage.tsx`）| C-PET（`Knowledge.tsx`）|
|---|---|---|
| **布局** | 双栏（搜索 \| 问答）+ 顶部范围下拉 | 上下两张 `Card`（关键字搜索 / 问 AI 助理），无项目下拉（默认全局） |
| **设计系统** | 项目本地 class（`paper-surface`/`pill`/`field`）| `@yqgl/shared` 组件（`Card`/`Input`/`Button`/`EmptyState`/`Skeleton`）+ `glass-sunken`/`text-ink` tokens |
| **深链/分享** | **支持** `?q`/`?run_id`/`?project_id`（可被通知 `target_url` 直达）| 现状**不写 URL query**（无 run_id 深链）；点证据 `target="_blank"` 新窗 |
| **范围过滤** | 有「全部项目/单项目」下拉 | 现状无（全局搜索）；WorkHub 可补 |
| **加载呈现** | 文案切换（无骨架） | `Skeleton h-16`（`Knowledge.tsx:200`）|
| **问答入口** | 独立右栏 | 独立 Card；**额外**可由桌宠对话驱动 Agent 走 K1/K2（[session §2.3](../01-architecture/api-contract.md)）|
| **设备令牌门** | 无（纯查询）| 无（纯查询）——知识库不是「接活/干活」高权限操作 |
| **通知回流** | toast 跳 KB-2（`useNotificationToasts`，`App.tsx:129`）| 桌宠 `/stream/me` 收 `notification.created` → 桌宠气泡提醒「回答好了」 |

> **桌宠特性**：知识库问答是桌宠「说人话→Agent 代操作」的天然样板——用户对桌宠说「上周那个登录需求验收咋定的」，桌宠在会话里调 K2、轮询/订阅 K3、把 `answer_md`+`citations` 渲染成对话气泡（证据条可点回主窗）。这条路无需用户进任何「页面」，契合 L4 入口层「小白零术语」目标（PRD §8.9）。

---

## 11. 设计约束与开放问题

### 11.1 设计约束（给 plan 阶段的硬边界）
1. **无向量库（D-4）**：页面只消费 `services/knowledge.py` 的 grep 链路（K1–K4），扩展只允许加 `source_type`，**不换检索范式**。
2. **强制引用**：KB-2 结论必带 `## 证据`；零命中明说无依据（`answer_from_hits`）。
3. **身份隔离（NFR-08）**：搜索结果与证据按访问者身份行级过滤（`can_view_requirement_record`）；K3 run 严格属主（现状）；任何新增事件先判私有性，**绝不发 `all`**。
4. **防竞态契约**：搜索/问答的单调 token + 轮询过期 abort 必须保留（迁移别重新发明）。
5. **reindex admin-only + 不内联重建**：保留 self-DoS 修复（`knowledge.py:63/437`）。
6. **去黑话**：用户面不出现 grep/索引/向量/语料；状态走人话语气（glossary §7/§10）。

### 11.2 开放问题（汇总至 [07-open-questions](../07-open-questions.md)）
- **KB-1** 问答进度：维持轮询 vs 升级订阅 `job.updated`（§2.1 建议升级，与会议/decomposition 对齐）？
- **KB-2** run 可见性放宽：协作场景把 ask 附给负责人时，run 从「仅本人」→「WorkItem 可见者」，而 `citations` 仍按访问者过滤——边界与实现待定（§5.4）。
- **KB-3** 内嵌入口的落点与 `scope` 映射粒度（文档/对话/会议/交付够不够，要不要 `activity`/`workspace_update`）？
- **语料扩列**：`branch`/`proposal`/`spec_doc` 进 `_source_docs()` 的时点（P2/P3，[explainability §3.1/§7](../02-ai-engine/explainability.md)）。
- **trace 体积**：知识库 `trace_json` 轻量（单条 grep），但与 `AgentRun.trace` 统一呈现时的留存/截断策略（[explainability EX-2](../02-ai-engine/explainability.md)）。

---

## 附：与其他文档的边界

| 想了解 | 看哪篇 |
|---|---|
| grep 链路机制、强制引用铁律、`Rationale` 原语、trace 呈现 | [explainability](../02-ai-engine/explainability.md) |
| `/api/knowledge/*` 契约、SSE 事件清单、`job.updated` 隔离 | [api-contract §2.11/§5](../01-architecture/api-contract.md) |
| `KnowledgeDocument`/`KnowledgeAskRun` 字段、软删除/审计 | [data-model](../01-architecture/data-model.md) |
| `_periodic_knowledge_reindex` 在后台任务域的位置、事件总线 | [system-architecture §5/§7](../01-architecture/system-architecture.md) |
| 证据条/命中卡共享组件、tokens、API client | [shared-ui-kit](../05-clients/shared-ui-kit.md) |
| 桌宠会话驱动 Agent 查证据 | [desktop-pet-tauri](../05-clients/desktop-pet-tauri.md)、[api-contract §2.3](../01-architecture/api-contract.md) |
| 术语（历史搜索/证据/grep 知识库）人话映射 | [glossary-dejargon](../00-overview/glossary-dejargon.md) |

*本篇定位：M-KNOWLEDGE 的页面规划单一来源。机制级 → explainability；接口级 → api-contract；字段级 → data-model。*
