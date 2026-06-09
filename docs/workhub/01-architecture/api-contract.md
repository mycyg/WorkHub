---
module: 01-architecture
layer: C-DAEMON
status: 🚧
owner: workflow
---

# API 与事件契约(API & Event Contract)

> **范围**:WorkHub headless agent daemon(`C-DAEMON`)对所有瘦客户端(`C-WEB` / `C-PET`)暴露的 OpenAPI 路由组、SSE 事件流、鉴权与设备令牌门、统一错误约定。
> **定位**:本篇是接口/机制级契约。**领域实体的字段与状态机定义**见 [`data-model.md`](./data-model.md);**进程边界、事件总线拓扑、部署形态**见 [`system-architecture.md`](./system-architecture.md);**威胁模型与 RBAC 深设计**见 [`security-and-permissions.md`](./security-and-permissions.md);**去黑话用户用语**见 [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md)。交叉处只引用,不重复。
> **扎根**:本契约从现有「需求管理大师」真实代码演进而来,沿用其已验证的鉴权、SSE、原子 CAS、错误约定。代码锚点贯穿全文(`app/main.py`、`app/routers/*`、`app/auth.py`、`app/services/push_bus.py`、`app/services/jobs.py`、`app/services/lifecycle.py`)。

---

## 0. 契约总原则(沿用现有 + 演进)

| 原则 | 现状(锚点) | WorkHub 演进 |
|---|---|---|
| **REST + JSON**,FastAPI 自动产出 OpenAPI 3.x | `app/main.py:270` `FastAPI(title=..., version=...)` | daemon 暴露 `/openapi.json` → 生成类型化客户端(`C-UIKIT` 共享 API client),借鉴 opencode SDK 模式 |
| **路由前缀分组** `/api/<group>`,`tags=[...]` | 每个 router `APIRouter(prefix="/api/...", tags=[...])` | 沿用;新增 `session/proposal/review/permission/agent-run/escalation` 组 |
| **Pydantic DTO** 入参出参显式建模 | `app/schemas.py`(`*In` / `*Out`) | 沿用;DTO 命名约定不变 |
| **鉴权=依赖注入** | `Depends(current_user)` 等 5 档(§3) | 沿用;新增 `Depends(require_actor)`(支持 AI actor 身份) |
| **实时=SSE 单向推送**,主写仍走 REST | `app/routers/push.py` + `services/push_bus.py` | 沿用 SSE,topic 隔离强化(§5);WS 留作 P4+ 双工备选 |
| **写操作幂等护栏=原子 CAS** | 全部状态跃迁用 `sql_update(...).where(status==old)`,`rowcount==0 → 409` | **升格为强制约定**(§6.3),所有状态机写入照此 |
| **错误=`HTTPException(status_code, detail)`** | 全 routers 一致 | 沿用 + 统一错误体(§6) |

> **不在本篇**:LLM provider 协议、auto_agent 内部工具契约(见 [`../02-ai-engine/agent-loop-and-tools.md`](../02-ai-engine/agent-loop-and-tools.md))。本篇只定义 daemon 对外的 HTTP/SSE 边界。

---

## 1. API 命名空间地图(OpenAPI 路由组)

所有端点挂在 `/api/<group>` 下。下表给出**全量路由组**:左列为现有(`app/main.py:280-305` 已 `include_router`),右列标注 WorkHub 新增/演进。

| 组 | 前缀 | 现有锚点 | WorkHub 状态 | 职责一句话 |
|---|---|---|---|---|
| **auth** | `/api/auth` | `routers/auth.py` | 沿用 | 昵称身份、cookie 签发、登出 |
| **client-devices** | `/api/client-devices` | `routers/client_devices.py` | 沿用 | 设备令牌注册/吊销(**设备门**核心) |
| **session** | `/api/session` | (新增) | **新增** | 瘦客户端会话 = 一次桌宠/web 对话上下文(借鉴 opencode session) |
| **workitem** | `/api/projects/{id}/requirements`、`/api/requirements` | `routers/requirements.py` | 演进 | 工作项 CRUD、状态机、派生、排期、验收项 |
| **proposal** | `/api/proposals`、`/api/workitems/{id}/proposals` | (演进自 deliveries) | **新增(核心)** | 去黑话 PR:分支变更集请求合并 main |
| **review** | `/api/proposals/{id}/review`、`/api/requirements/{id}/revisions` | `routers/deliveries.py:226/267` | 演进 | 通过/打回(带理由)= 验收循环 |
| **agent-run** | `/api/workitems/{id}/agent-runs`、`/api/agent-runs/{id}` | 演进自 `routers/auto.py` | **新增** | 触发/查询 AI 工人执行 + trace |
| **escalation** | `/api/workitems/{id}/escalations` | (新增) | **新增(命门)** | 升级事件:触发器、交接件、转经理模式 |
| **permission** | `/api/permissions`、`/api/approvals` | (新增,借鉴 opencode) | **新增(护城河)** | 分层 allow/deny/ask 策略 + 审批阻塞原语 + 路由 |
| **drive** | `/api/projects/{id}/drive`、`/api/drive/*` | `routers/project_drive.py` | 沿用 | 项目网盘:文件树/版本/回收站/操作日志/评论 |
| **meeting** | `/api/projects/{id}/meetings`、`/api/meetings/*` | `routers/meetings.py` | 沿用 | 录音/上传→ASR→纪要→洞察→草稿 |
| **knowledge** | `/api/knowledge` | `routers/knowledge.py` | 沿用 | grep 语料检索 + 强制引用问答(无向量库) |
| **notify** | `/api/notifications` | `routers/notifications.py` | 沿用 | 通知收件箱、已读 |
| **reminder / calendar / task** | `/api/reminders`、`/api/calendar`、`/api/planning` | `routers/reminders.py`、`calendar.py`、`planning.py` | 沿用 | 待办/排期/提醒/工作量 |
| **sync** | `/api/requirements/{id}/sync-*`、`submit`、`claim` | `routers/sync.py` | 演进→双向 | 设备同步清单、ack、投递、认领 |
| **comments / activity** | `/api/requirements/{id}/comments`、`/activity` | `routers/comments.py` | 沿用 | 工作项评论 + 活动流(审计源) |
| **chat / assistant** | `/api/requirements/{id}/chat`、`/api/assistant/chat` | `routers/chat.py`、`assistant.py` | 演进→session | 澄清对话、助手 |
| **attachments / delivery-upload** | `/api/requirements/{id}/upload/*`、`/delivery/*` | `routers/attachments.py`、`delivery_upload.py` | 沿用 | 分片上传(init→chunk→finalize) |
| **voice** | `/api/voice` | `routers/voice.py` | 沿用 | ASR/TTS 代理(GPU 服务) |
| **users / workspaces** | `/api/users`、`/api/requirements/{id}/workspaces` | `routers/users.py`、`workspaces.py` | 演进 | 用户档案、个人工作区(→ Branch 雏形) |
| **jobs** | `/api/jobs/{id}` | `routers/jobs.py` | 沿用 | 后台任务进度查询 |
| **dashboard / health** | `/api/project-health`、`/api/projects/{id}/health` | `routers/health.py` | 演进 | 项目健康、自治率/升级精准度/成本看板 |
| **event(SSE)** | `/api/push/stream*` | `routers/push.py` | 演进→event | 事件流订阅(§5) |
| **downloads** | `/api/downloads/manifest`、`/downloads/*` | `app/main.py:428` | 沿用 | 桌面客户端安装包清单 |

> **演进映射要点**:WorkHub 的 `proposal` ≈ 现有 `delivery` + `revision` 的合并升级;`agent-run` ≈ 现有 `/auto-process` + `BackgroundJob` + auto_agent trace 的对外化;`session` ≈ 现有 `chat`/`assistant` 的会话化(供桌宠驱动 Agent)。详细实体差异见 [`data-model.md`](./data-model.md)。

---

## 2. 端点契约(方法 / 路径 / 入参 / 出参概要)

> 标注:**[现]** 现有真实端点(可直接引代码);**[新]** WorkHub 新增;**[演]** 现有端点演进。出参省略 `created_at` 等通用审计字段(见 data-model 软删除/审计字段约定)。

### 2.1 auth — 身份与会话

| 方法 路径 | 入参 | 出参 | 鉴权 | 锚点 |
|---|---|---|---|---|
| **[现]** `POST /api/auth/identify` | `{nickname, admin_secret?}` | `{id, nickname, created, is_admin, availability_status, availability_text}` | 公开(签 cookie) | `auth.py:56` |
| **[现]** `GET /api/auth/me` | — | `IdentifyOut \| null` | optional | `auth.py:92` |
| **[现]** `POST /api/auth/logout` | header `X-YQGL-Client-Token?` | `{ok}` | cookie | `auth.py:104` |

**昵称身份模型(沿用)**:LAN 场景无密码,昵称即身份,匹配昵称复用既有账户(`auth.py:63` 注释明确这是普通用户的有意设计——他们常清 cookie/换设备)。**Admin 例外**:认领 admin 昵称需 ① 已是该 admin(cookie/令牌证明)或 ② 提供 `admin_secret`,否则 `403`(`auth.py:74`)。

### 2.2 client-devices — 设备令牌门(高权限闸)

| 方法 路径 | 入参 | 出参 | 鉴权 | 锚点 |
|---|---|---|---|---|
| **[现]** `POST /api/client-devices/register` | `{device_name, platform?}` | `{device, client_token}`(令牌**仅此一次**明文返回) | `current_user` | `client_devices.py:27` |
| **[现]** `GET /api/client-devices/me` | — | `ClientDeviceOut[]` | `current_user` | `client_devices.py:47` |
| **[现]** `GET /api/client-devices/current` | header token | `ClientDeviceOut` | `current_client_device` | `client_devices.py:61` |
| **[现]** `POST /api/client-devices/{id}/revoke` | — | `ClientDeviceOut` | `current_user`(限本人设备) | `client_devices.py:68` |
| **[现]** `POST /api/client-devices/revoke-current` | header token | `ClientDeviceOut` | `current_client_device` | `client_devices.py:88` |

令牌存储为 `sha256`(`auth.py:41` `hash_client_token`),从不持久化明文。设备门机制见 §3.2 / §4。

### 2.3 session — 瘦客户端会话 **[新]**

> 桌宠 / web 的一次对话上下文。借鉴 opencode `createOpencode` + session:每个客户端开 session,Agent 在其中产生事件流;权限询问、进度、结果皆为 session topic 上的事件(§5)。演进自现有 `chat`/`assistant`。

| 方法 路径 | 入参 | 出参 | 鉴权 |
|---|---|---|---|
| **[新]** `POST /api/sessions` | `{title?, intent_text?, project_id?, workitem_id?}` | `SessionVM`（`session_id`, `topic`, `stream_href`, `next_question_href`, 首张 `QuestionCard`） | `require_actor` |
| **[新]** `GET /api/session/{id}` | — | `SessionOut`(含消息游标) | owner |
| **[新]** `POST /api/session/{id}/message` | `{text, attachments?}` | `202 {accepted}`(产物经 SSE 回流) | owner + 设备门(若驱动高权限工具) |
| **[新]** `GET /api/session/{id}/messages` | `?after=<cursor>` | `Message[]` | owner |
| **[新]** `POST /api/session/{id}/abort` | — | `{ok}` | owner |

**关键**:`message` 端点**不**在 HTTP 响应里返回 AI 产物——它 `202` 立即返回,Agent 的 thinking/tool_call/产物经 `session:{id}` SSE topic 流式回灌(对齐现有 `ai.*` 事件,§5.2)。桌宠"说人话→Agent 代操作"即走此路。

### 2.4 workitem — 工作项(主轴) **[演]**

| 方法 路径 | 入参 | 出参 | 鉴权 | 锚点 |
|---|---|---|---|---|
| **[现]** `POST /api/projects/{pid}/requirements` | `RequirementCreateIn` | `RequirementOut` `201` | `current_user` | `requirements.py:111` |
| **[现]** `GET /api/requirements` | `?project_id&status&mine` | `RequirementOut[]` | `current_user` | `requirements.py:192` |
| **[现]** `GET /api/requirements/{id}` | — | `RequirementOut` | 可见性门 | `requirements.py:233` |
| **[现]** `PATCH /api/requirements/{id}/status` | `{status}` | `RequirementOut` | `current_user` + 角色门 + **设备门**(worker 跃迁) | `requirements.py:249` |
| **[现]** `PATCH /api/requirements/{id}/planning` | `RequirementPlanningUpdateIn` | `RequirementOut` | 角色门 | `requirements.py:367` |
| **[现]** `GET/PUT /api/requirements/{id}/assignees` | `RequirementAssigneesUpdateIn` | `RequirementAssigneeOut[]` | 角色门 | `requirements.py:430/446` |
| **[现]** `PATCH /api/requirements/{id}/schedule` | `RequirementScheduleUpdateIn` | `RequirementOut` | 角色门 | `requirements.py:511` |
| **[现]** `POST /api/requirements/{id}/finalize-summary` | — | `RequirementOut` | submitter | `requirements.py:575` |
| **[现]** `DELETE /api/requirements/{id}` | — | `204` | submitter/admin | `requirements.py:630` |
| **[现]** `GET /api/requirements/{id}/acceptance` | — | `RequirementAcceptanceItemOut[]` | 可见性门 | `decompositions.py:135` |
| **[现]** `POST /api/requirements/{id}/decompositions` | `TaskDecompositionCreateIn` | `TaskPlanOut` | 角色门 | `decompositions.py:75` |

**状态机权威**:转移表见 [`data-model.md`](./data-model.md) 与 PRD §7.1。现有 `requirements.py:272` 的 `allowed` 邻接表(`draft→clarifying→summary_ready→ready→claimed→doing→delivered→accepted` + `cancelled`)是 WorkHub 状态机的迁移起点;WorkHub 在 `ai_working / escalated / pm_mode / in_review / merged` 等节点上扩展(PRD §7.1)。**对外端点不变**——状态机扩展通过 `allowed` 表与新 `agent-run`/`escalation` 组承载,`PATCH /status` 仍是通用人工跃迁入口。

### 2.5 proposal & review — 去黑话分支-提议-合并 **[新/演]**

> **心智映射(对用户隐藏 git 黑话)**见 [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md):branch=「工作副本」、proposal=「提交给负责人确认」、approve=「采纳/汇入正式版」、reject=「打回(说原因)」。**API 层用中性技术名 `proposal`/`branch`,但所有 `detail`/通知文案用人话**(沿用 `lifecycle.py:31` 的中文模板风格)。

| 方法 路径 | 入参 | 出参 | 鉴权 |
|---|---|---|---|
| **[新]** `POST /api/workitems/{id}/branches` | `{actor}` | `{branch_id}`(协作者/AI 各开分支) | 角色门 + 设备门(人工接活) |
| **[新]** `POST /api/workitems/{id}/evidence-bindings` | `{evidence_bubble_id?, evidence_refs[], note?}` | `WorkItemDetailVM`(证据引用并入当前任务上下文) | 可见性门 |
| **[新]** `POST /api/workitems/{id}/proposals` | `{branch_id, summary, changeset_ref}` | `ProposalOut`(状态 `open`) | branch owner |
| **[新]** `GET /api/proposals/{id}` | — | `ProposalOut`(含 diff 摘要、ConfidenceRecord 引用) | 可见性门 |
| **[新/演]** `POST /api/proposals/{id}/review` | `{decision: "approve"\|"reject", reason_md?}` | `{ok, status}` | reviewer(负责人) |
| **[现→演]** `POST /api/requirements/{id}/revisions` | `{reason_md}` | `{ok, status}` | submitter(负责人) | `deliveries.py:267` |
| **[现→演]** `POST /api/requirements/{id}/accept` | — | `{ok, status}` | submitter(负责人) | `deliveries.py:226` |
| **[新]** `POST /api/proposals/{id}/merge` | `{confirm?: true, conflict_resolution?: {accept_incoming_target_keys?: string[]}}` | `ProposalMergeResult`(含 `merge_snapshot_id`、rollback、events、audit facts)；409 `merge_conflict` 带 `details.conflicts[]` | reviewer / 策略自动 |
| **[新]** `POST /api/workitems/{id}/deliverables/{acceptedChangeId}/restore` | — | `{accepted_deliverable}`(恢复后的当前正式交付物 VM)；409 表示没有上一版或版本已变化 | 可见性门 |
| **[新]** `GET /api/workitems/{id}/conflicts` | — | `ProposalConflictListResult`：`{conflicts:[{target_key, headline, recommended_option_id, options[]}]}` | 可见性门 |

**打回回灌(命门,沿用 + 强化)**:现有 `request_revision`(`deliveries.py:267`)已要求 `reason_md` 必填、写 `RevisionRequest` 行、CAS `delivered→revision_requested`、发 `revision.requested` 事件(`deliveries.py:321`)。WorkHub 强化为 **PRD FR-ESC-003**:`reject` 的 `reason_md` 作为上下文**回灌**给 AI,在**同分支续做**而非重来(对齐 opencode CorrectedError)。**`reject` 必须带理由**——空理由 `400`。

**R1 merge 返回语义(2026-06-09)**:`POST /api/proposals/{id}/merge` 成功时，DB transaction 已写 `proposals/branches/work_items` 状态、`snapshots(kind=merge)`、`accepted_deliverable_changes`、`audit_logs(action=proposal.merged)`。AgentRun-backed delivery 还会把源文件从 `AgentRun.workdir_ref` 复制到正式 storage root，追加 `ProjectDriveVersion`，前移 `ProjectDriveItem.current_version_id`，并把 `drive_item_id/drive_version_id` 写入 accepted row。若同一 target 当前正式版与 incoming `sha256_before/version_before` 不一致，generated 同路径 sha 不同，源文件缺失/越界，或源文件 sha 与 manifest 不一致，返回 409；用户面说“和正式版撞车”或“交付文件已变化”，不显示 merge/conflict 黑话。R1.9 起 `merge_conflict` 的错误体是 `{ok:false,error:{code:"merge_conflict",message,details:{conflicts},recoverable:true}}`，其中每个 conflict 都有 `keep_current` 与 `accept_incoming` 两个 option；`accept_incoming.action.request_json` 固定带 `conflict_resolution.accept_incoming_target_keys:[target_key]`。只有带该 payload 的二次 merge 才允许覆盖当前正式版。R1.10 起 Web/Desktop 主窗会把 `details.conflicts[]` 渲染为严肃 option-first 冲突卡，独立 Cuu pet window 会把同一 payload 作为 Cuu action 提交；公开 merge 返回体暂不展开正式交付物 VM，WorkItem page 与 AgentRun replay page 已提供 accepted deliverables。

**R1 accepted deliverable 读取与还原语义(2026-06-09)**:`GET /api/pages/workitems/{id}` 与 `GET /api/agent-runs/{id}/replay` 均返回 `accepted_deliverables[]`，每项包含 `drive_item_id`、`drive_version_id`、`filename`、`mime`、`size_bytes`、`download_href`、可选 `preview_href`，以及仅在 `accepted_version > 1` 时出现的 `restore_href`。`GET /api/workitems/{id}/deliverables/{acceptedChangeId}/download` 返回正式文件内容，不暴露 `storage_path`；若账本存在但正式文件已丢失，返回 404 而不是暴露内部路径。`GET /api/workitems/{id}/deliverables/{acceptedChangeId}/preview` 仅支持文本类预览，返回 `{preview_type:"text", text, truncated}`，非文本返回 415 并提示下载查看。`POST /api/workitems/{id}/deliverables/{acceptedChangeId}/restore` 会校验当前 Drive item 仍指向该 accepted row 的版本，然后把 `ProjectDriveItem.current_version_id` 指回上一版 accepted row 的 `drive_version_id`，将上一版重新设为 current accepted row，并写 `ProjectDriveOperation(op_type="restore_version")` 与 `AuditLog(action="accepted_deliverable.reverted")`。首版无上一版时返回 409，用户面文案说“还没有上一版可还原”，不显示 snapshot/revert/commit 黑话。

### 2.6 agent-run — AI 工人执行 + trace **[演]**

> 演进自 `routers/auto.py`(`/auto-process`)+ `BackgroundJob` + `auto_agent` 内部事件。把"触发执行 / 查 trace / 查预算"对外化为头等资源。

| 方法 路径 | 入参 | 出参 | 鉴权 | 锚点 |
|---|---|---|---|---|
| **[现→演]** `POST /api/workitems/{id}/agent-runs`(原 `POST /api/requirements/{id}/auto-process`) | `{mode?: "worker"\|"pm"}` | `{ok, status, run_id, job_id}` | submitter + 角色门 | `auto.py:54` |
| **[新]** `GET /api/agent-runs/{id}` | — | `AgentRunOut`(状态、预算用量、ConfidenceRecord) | 可见性门 |
| **[新]** `GET /api/agent-runs/{id}/trace` | `?after=<step>` | `TraceStep[]`(每步动作+工具 IO,**FR-WORKER-002**) | 可见性门 |
| **[新]** `POST /api/agent-runs/{id}/abort` | — | `{ok}` | submitter/admin |
| **[现]** `GET /api/jobs/{id}` | — | `BackgroundJobOut`(`{kind,status,progress_percent,message,result_ref,error}`) | owner | `jobs.py:43` |

**执行语义(沿用 `auto.py`)**:触发用**原子 CAS** `ready/summary_ready → ai_processing`(`auto.py:84`,双击防重、防重复 Delivery + 重复通知);后台 `asyncio` 任务跑 `auto_process`,经 `BackgroundJob` 报进度;成功→打包 Delivery + `status=delivered`,失败→回滚 `ready` + 留痕(`auto.py:237`)。**硬预算上限**(`MAX_TURNS`/超时)与 doom-loop 见 [`../02-ai-engine/agent-loop-and-tools.md`](../02-ai-engine/agent-loop-and-tools.md);超预算强制产「已做/未做/下一步」交接件(FR-WORKER-003)→ 触发 escalation(§2.7)。

### 2.7 escalation — 升级(命门) **[新]**

| 方法 路径 | 入参 | 出参 | 鉴权 |
|---|---|---|---|
| **[新]** `GET /api/workitems/{id}/escalations` | — | `EscalationEvent[]`(触发器、原因、交接件、目标人) | 可见性门 |
| **[新]** `POST /api/workitems/{id}/escalations` | `{trigger: "unqualified"\|"user_unsatisfied"\|"user_forbidden"\|"doom_loop"\|"budget_exhausted", handoff}` | `EscalationOut`(切 `pm_mode`) | 系统/reviewer |
| **[新]** `GET /api/workitems/{id}/confidence` | — | `ConfidenceRecord`(置信度+风险+分级裁决+依据,**人话呈现**) | 可见性门 |
| **[新]** `POST /api/workitems/{id}/hold` | `{level: "workitem"\|"project"\|"user", reason?}` | `{ok}`("人工保留"开关,FR-ESC-005) | 角色门 |

**三触发器映射真实零件**(PRD §8.2):`unqualified` ← `auto_agent` 的 `llm_review` 判分不过(`services/auto_agent.py:544`,`{"meets_requirement": bool, "reason"}`;系统提示词 `REVIEW_SYSTEM` 在 `:535`);`user_unsatisfied` ← `request_revision`(`deliveries.py:267`,用户打回/不满意);`user_forbidden` ← `hold` 开关。算法与阈值见 [`../02-ai-engine/confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md)——本篇只定契约形状,不重复算法。

### 2.8 permission & approval — 分层策略 + 审批阻塞 **[新,借鉴 opencode]**

> 审批 = **阻塞原语**:工具在"该决策那一刻"可 `ask` 人,阻塞至回复(对齐 opencode)。daemon 内部阻塞,对客户端表现为一条 `permission.ask` 事件 + 一个待响应资源。详细策略合并/RBAC 见 [`security-and-permissions.md`](./security-and-permissions.md) 与 [`../03-collaboration/review-and-approval.md`](../03-collaboration/review-and-approval.md)。

| 方法 路径 | 入参 | 出参 | 鉴权 |
|---|---|---|---|
| **[新]** `GET /api/permissions` | `?scope=org\|workspace\|role\|session` | `PermissionPolicy[]`(allow/deny/ask 通配规则) | admin/角色门 |
| **[新]** `PUT /api/permissions` | `{scope, target, rules}` | `PermissionPolicy` | admin |
| **[新]** `GET /api/approvals` | `?pending=true` | `ApprovalRequest[]`(路由到本人的待批) | 被路由到的人 |
| **[新]** `POST /api/approvals/{id}/respond` | `{decision: "allow"\|"deny", reason_md?, remember?: "once"\|"always"}` | `{ok}`(`always`→沉淀自动规则) | 被路由到的人 |
| **[新]** `POST /api/approvals/{id}/delegate` | `{to_user_id}` | `{ok}` | 当前批准人 |

**默认就问**:未匹配任何规则 → 默认 `ask`(PRD FR-PERM-001)。**审批路由**(护城河,opencode 无):按角色/负责人/项目决定谁该批,带超时 SLA + 可委派,**按身份审计**(FR-PERM-002/003)。**拒绝回灌**:`deny` 的 `reason_md` 作为下一步上下文喂回 AI。

### 2.9 drive — 项目网盘 **[现]**

> 完整端点见 `routers/project_drive.py`(行 691–1700)。这里给分组概要;字段见 `schemas.py:32-160`(`DriveItemOut`/`DriveManifestOut`/`DriveOperationOut` 等)。

| 子组 | 代表端点 | 锚点 |
|---|---|---|
| 浏览 | `GET .../drive`、`/tree`、`/manifest`、`/changes` | `project_drive.py:691/734/758/785` |
| 上传(分片) | `POST .../drive/upload/init` → `PUT .../chunk/{idx}` → `POST .../finalize` | `project_drive.py:843/891/931` |
| 文件操作 | `GET /drive/files/{id}/download`、`/render-html`、`/preview`;`POST /drive/bulk-download` | `project_drive.py:1090/1125/1218/1156` |
| 树操作 | `PATCH /drive/items/{id}`、`paste`、`copy`、`cut`、`DELETE`、`bulk-delete` | `project_drive.py:1265-1457` |
| 回收站/撤销 | `restore`、`bulk-restore`、`POST .../drive/undo` | `project_drive.py:1457/1477/1504` |
| 评论(触发 LLM) | `GET/POST .../drive/folders/{fid}/comments` | `project_drive.py:1579/1595` |

事件 `drive.changed` / `drive.comment`(§5)。回收站/版本/操作日志的软删除范式见 [`data-model.md`](./data-model.md)。

### 2.10 meeting — 会议→洞察 **[现]**

| 方法 路径 | 出参 | 锚点 |
|---|---|---|
| `GET /api/projects/{pid}/meetings` | `MeetingOut[]` | `meetings.py:158` |
| `POST .../meetings/upload/init` → `PUT .../chunk/{idx}` → `POST .../finalize` | `MeetingOut` | `meetings.py:172/214/258` |
| `GET/PATCH /api/meetings/{id}` | `MeetingOut` | `meetings.py:444/449` |
| `POST /api/meeting-insights/{id}/confirm`(洞察→需求草稿,人确认) | `MeetingInsightOut` | `meetings.py:470` |
| `POST /api/meeting-insights/{id}/dismiss` | `MeetingInsightOut` | `meetings.py:608` |

ASR/纪要异步,经 `BackgroundJob` 报进度;完成发 `meeting.ready`,洞察确认发 `meeting.insight_confirmed`(§5)。

### 2.11 knowledge — grep 检索 + 引用问答 **[现]**

| 方法 路径 | 入参 | 出参 | 锚点 |
|---|---|---|---|
| `POST /api/knowledge/search` | `{q?/query?, project_id?, run?}` | `EvidenceBubble`(`evidence_refs[]` + Cuu actions) | `knowledge.py:42` |
| `POST /api/knowledge/reindex` | — | `{ok}`(admin 强制重建) | `knowledge.py:57` |
| `POST /api/knowledge/ask` | `KnowledgeAskIn` | `KnowledgeAskCreateOut`(`{run_id}`,异步) | `knowledge.py:73` |
| `GET /api/knowledge/runs/{id}` | — | `KnowledgeAskRunOut`(`answer_md` + 引用) | `knowledge.py:96` |

**无向量库(D-4)**:语料每 5 分钟后台重建(`main.py:49` `_periodic_knowledge_reindex`),搜索读索引而非每次全扫(原 self-DoS 修复)。强制引用范式见 [`../02-ai-engine/explainability.md`](../02-ai-engine/explainability.md)。

### 2.12 notify / reminder / calendar / planning **[现]**

| 方法 路径 | 出参 | 锚点 |
|---|---|---|
| `GET /api/notifications` | `NotificationOut[]` | `notifications.py:89` |
| `POST /api/notifications/{id}/read`、`/read-all` | `NotificationOut` / `{ok}` | `notifications.py:113/129` |
| `GET /api/reminders/due` | `ReminderOut[]` | `reminders.py:29` |
| `GET/POST/PATCH/DELETE /api/calendar/events` | `ScheduleEventOut` | `calendar.py:68-182` |
| `GET /api/planning/workload` | `UserWorkloadOut[]` | `planning.py:22` |

通知**按身份私有投递**:`notification.created` 仅发到 `user:{id}` topic(`services/notifications.py:105`,§5.3 隔离),严禁全局广播(NFR-08)。

### 2.13 sync — 设备同步(演进→双向)**[演]**

| 方法 路径 | 入参 | 出参 | 鉴权 | 锚点 |
|---|---|---|---|---|
| `POST /api/requirements/{id}/submit` | — | `{ok, status}` | submitter | `sync.py:39` |
| `GET /api/requirements/{id}/sync-manifest` | — | manifest(文件清单+sha256) | **设备门** `require_local_client` | `sync.py:88` |
| `POST /api/requirements/{id}/sync-ack` | — | `{ok}` | **设备门** | `sync.py:98` |
| `POST /api/requirements/{id}/claim` | — | `{ok, status}` | **设备门** + 认领权 | `sync.py:111` |
| **[新]** `POST /api/requirements/{id}/sync-push` | `{manifest, blobs_ref}` | `{accepted, conflicts[]}` | **设备门** | (演进) |

**现状**:`sync.rs` 客户端只下载,双向是占位(PRD §2.2#4)。**WorkHub 演进**:复用 `spec_watch.rs`(sha256 去重 + append-only)做本地↔云双向;`sync-push` 上传本地改动,冲突走 AI 调解(返回 `conflicts[]`,人择一)。详见 [`../03-collaboration/sync-and-spec.md`](../03-collaboration/sync-and-spec.md)。

### 2.14 dashboard / health **[演]**

| 方法 路径 | 出参 | 锚点 |
|---|---|---|
| `GET /api/project-health` | `ProjectHealthOut[]` | `health.py:99` |
| `GET /api/projects/{id}/health` | `ProjectHealthOut` | `health.py:108` |
| **[新]** `GET /api/dashboard/autonomy` | `{autonomy_rate, escalation_precision, rollback_rate, ...}` 或后续 `AIOperationsVM` | (PRD §13 度量;可作为页面 VM 的原始指标源) |
| **[新]** `GET /api/pages/cost` | `CostDashboardVM` | (NFR-05/11;权威成本页面 VM,字段见 §2.15 与 P-COST) |

指标定义见 [`../04-modules/dashboards-and-metrics.md`](../04-modules/dashboards-and-metrics.md)。成本不再让客户端拼散字段;页面主口径统一走 `GET /api/pages/cost`,轻量摘要走 `GET /api/cost/usage`。

### 2.14.1 page VM locale envelope **[当前]**

所有 `GET /api/pages/*` Page VM route 均接受可选 `locale` query；未传时可读 `Accept-Language`，最终只允许 `zh-CN` / `en-US`，未知值回退 `zh-CN`。共享合同见 `packages/contracts/src/locale.ts` 与 [`../05-clients/i18n-locale-contract-p1-1.md`](../05-clients/i18n-locale-contract-p1-1.md)。

| 路径族 | 入参 | 出参 envelope | 说明 |
|---|---|---|---|
| `GET /api/pages/gold-path` | `?locale=zh-CN\|en-US` | `{ ok:true, data:GoldPathSurfaceVM, meta:{ locale } }` | Web / desktop main 首屏。 |
| `GET /api/pages/workitems/:id` | `?locale=...` | `{ ok:true, data:WorkItemDetailVM, meta:{ locale } }` | 当前固定 chrome 可按 locale 渲染；任务标题/摘要仍保留 daemon 原文。 |
| `GET /api/pages/proposals/:id` | `?locale=...` | `{ ok:true, data:ProposalDetailVM, meta:{ locale } }` | proposal manifest 不在客户端硬翻译。 |
| `GET /api/pages/cost` | `?locale=...` | `{ ok:true, data:CostDashboardVM, meta:{ locale } }` | 成本固定标签由客户端/页面 renderer 本地化；金额和 usage 数字不变。 |
| `GET /api/pages/attention` / `approvals` | `?locale=...` | `{ ok:true, data:..., meta:{ locale } }` | Cuu / 页面固定 action label 由客户端词表承接。 |

错误 envelope 不因 locale 改变 `ApiErr.code`。后续 `me.locale` 用户偏好落地后，服务端可在未传 query 时优先用用户偏好，再回退 `Accept-Language`。

### 2.15 cost governance **[新]**

| 方法 路径 | 出参 | 鉴权 | 说明 |
|---|---|---|---|
| `GET /api/cost/policies` | `BudgetPolicy[]` | admin / team owner | 三级预算策略。 |
| `PUT /api/cost/policies/:scope/:id` | `BudgetPolicy` | admin / team owner | 更新用户/团队/任务配额;写审计。 |
| `GET /api/cost/usage` | `CostSummaryVM` | current user / admin | 普通用户只看自己;admin 可看全局摘要;原始 `BudgetUsage` 嵌在 `me/team/scopes` 中。 |
| `GET /api/pages/cost` | `CostDashboardVM` | current user / admin | Page VM;admin 含全员榜,普通用户降级为个人视图。 |

成本裁决、默认配额和计入口径见 [`../02-ai-engine/cost-governance.md`](../02-ai-engine/cost-governance.md)。预算拒绝统一返回 `ApiErr.code="budget_exhausted"`;客户端不得自行推断是否还能跑 Agent。

---

## 3. 鉴权与设备令牌门

### 3.1 五档鉴权依赖(沿用 `app/auth.py`)

| 依赖 | 接受凭据 | 失败码 | 用途 | 锚点 |
|---|---|---|---|---|
| `current_user` | cookie `yqgl_id`(itsdangerous 签名)**或** header `X-YQGL-Client-Token` | `401` | 多数读写 | `auth.py:104` |
| `optional_current_user` | 同上,可空 | — | 匿名可读端点 | `auth.py:130` |
| `current_client_device` | `current_user` + **有效设备令牌** | `403 local client required` | 需设备门的高权限 | `auth.py:172` |
| `require_local_client` | = `current_client_device` 取 user | `403` | 接活/同步类 | `auth.py:183` |
| `require_stream_user` | cookie 或令牌(**不持 DB 会话**) | `401` | SSE 长连接 | `auth.py:202` |

**令牌优先于 cookie**:Tauri WebView2 的 cookie jar 与 Rust reqwest jar 分离,clientFetch 必带令牌,故**令牌存在时优先用令牌**(`auth.py:109` 注释);否则验签 cookie。软删除用户视为不存在(`deleted_at` 过滤,`auth.py:120`),使 admin 的删除立即生效。

### 3.2 设备令牌门(LAN-first 的高权限闸)

- **门的含义**(D-3 沿用):**浏览器只能派活/审批;接活、干活、同步需桌面客户端**,服务端校验设备令牌(README §1)。
- **机制**:`current_client_device` 按 `client_token_hash + user_id + revoked_at IS NULL` 查 `ClientDevice`,命中即放行并刷新 `last_seen_at`(`auth.py:150`);否则 `403`。
- **覆盖端点**:sync 的 `sync-manifest/sync-ack/claim`(`sync.py:88/98/111`)、`PATCH /status` 的 worker 跃迁(`requirements.py:301` `worker_transition and local_user is None → 403`)。WorkHub 新增:`branch` 接活、`agent-run` 人工触发、`sync-push`。
- **WorkHub 演进**:`actor=ai` 的 daemon 内部执行**不经设备门**(AI 是 server 侧劳动力);设备门只约束**人类高权限动作**。多租户公网(P5)需重审此门(NFR-02),见 [`security-and-permissions.md`](./security-and-permissions.md)。

### 3.3 AI actor 身份 **[新]**

现有代码已用合成 `User` 占位代表 AI(如 `auto.py:224` `User(id="ai-auto", nickname=f"AI ({model})")`)。WorkHub 把它正规化为一等 **actor**:每个 `agent-run`/`proposal` 携带 `actor: {kind: "user"|"ai", id, label}`,审计与通知据此区分(`lifecycle.py` 的 actor 排除逻辑已支持非真实用户 id)。`require_actor` 依赖在 daemon 内部为 AI 注入 actor 上下文,对外 HTTP 仍以人类身份鉴权。

---

## 4. CORS、生产校验与静态资源(沿用 `app/main.py`)

- **CORS**:`CORSMiddleware`,`allow_origins=settings.cors_allow_origins`,`allow_credentials=True`(`main.py:272`)。**生产强校验**:`app_env=production` 时 `*` 通配 origin 或默认 `cookie_secret` 直接 `RuntimeError` 拒绝启动(`main.py:227` `_validate_runtime_config`)。
- **SPA 回退**:`/{full_path:path}` 兜底返回 `index.html`,但 `api/`、`assets/`、`downloads/`、`client/` 前缀**不**被吞入 SPA(`main.py:474`),避免 `404` 资源返回 HTML。
- **健康检查**:`GET /api/health` → `{status, service, version}`(`main.py:308`)。

---

## 5. SSE 事件契约

### 5.1 传输与帧格式(沿用 `routers/push.py` + `push_bus.py`)

- **端点**:`GET /api/push/stream`(全局)、`/stream/req/{id}`(单工作项)、`/stream/me`(本人私有)。WorkHub 演进新增 `/stream/session/{id}`(会话流)。
- **媒体类型**:`text/event-stream`,响应头 `Cache-Control: no-cache` + `X-Accel-Buffering: no`(`push.py:59`,禁 nginx 缓冲)。
- **帧**:`event: <type>\n` + 每行 `data: <line>\n`(多行 payload 按 `splitlines()` 逐行加 `data:` 前缀,避免内嵌 `\n`/CRLF 破帧——`push.py:31`)。
- **连接确认**:连上先发 `event: connected\ndata: {"topic": "..."}`(`push.py:42`)。
- **心跳**:无事件时每 30s 发注释行 `: ping`(`push_bus.py:50` `heartbeat_secs=30.0`,SSE 注释不触发客户端 handler)。
- **背压**:每订阅者一个 `asyncio.Queue(maxsize=256)`,满则**丢弃**慢订阅者的事件(`push_bus.py:43` `QueueFull → pass`)——SSE 是尽力推送,客户端关键状态以 REST 拉取为准(reconcile)。
- **断连**:`request.is_disconnected()` 检测,清理订阅(`push.py:46`、`push_bus.py:61`)。

### 5.2 事件类型清单(全量,均为真实代码所发)

| 事件 type | topic | payload 概要 | 锚点 |
|---|---|---|---|
| `connected` | (本连接) | `{topic}` | `push.py:42` |
| `heartbeat` | — | `: ping`(注释行) | `push_bus.py:59` |
| `requirement.ready` | `all` | `{requirement_id, code?, title, project_id?, ai_failed?, reason?}` | `sync.py:81`、`auto.py:270` |
| `requirement.updated` | `req:{id}` + `all` | `{requirement_id?, status, claimed_by?, assignees?, due_at?, decomposition?}` | 多处(`sync.py:82`、`requirements.py:362`、`deliveries.py:262` …) |
| `ai.started` | `req:{id}` | `{max_turns, timeout_s}` | `auto_agent.py:400` |
| `ai.thinking` | `req:{id}` | `{turn, text}`(截断 200) | `auto_agent.py:438` |
| `ai.text` | `req:{id}` | `{turn, text}`(截断 200) | `auto_agent.py:440` |
| `ai.tool_call` | `req:{id}` | `{turn, tool, ...}` | `auto_agent.py:444` |
| `ai.done` | `req:{id}` | `{turns}` | `auto_agent.py:507` |
| `ai.failed` | `req:{id}` | `{reason, notes}` | `auto.py:259/353` |
| `comment.added` | `req:{id}` | `{...comment}` | `comments.py:70` |
| `revision.requested` | `all` | `{requirement_id, round, reason_preview, requested_by}` | `deliveries.py:321` |
| `delivery.doc_ready` | `req:{id}` + `all` | `{delivery_id, round, requirement_id}` | `delivery_upload.py:110` |
| `drive.changed` | `all` | `{...drive change}` | `project_drive.py:278` |
| `drive.comment` | `all` | `{...}` | `project_drive.py:1700` |
| `meeting.ready` | `all` | `{meeting_id, project_id}` | `meetings.py:387` |
| `meeting.insight_confirmed` | `all` | `{...}` | `meetings.py:600` |
| `notification.created` | `user:{id}` | `{...notification}`(**私有**) | `notifications.py:105` |
| `job.updated` | `job:{id}` + `user:{id}` | `{id,kind,status,progress_percent,message,result_ref,error,...}`(**不发 all**) | `jobs.py:79` |
| `workspace.updated` | `req:{id}` | `{requirement_id, workspace_id}` | `workspaces.py:90` |

**WorkHub 新增事件(对齐上表风格)**,topic 见 §5.3:

| 事件 type | topic | payload 概要 |
|---|---|---|
| `agent_run.started` | `run:{id}` / `workitem:{id}` | `{run_id, budget}`(对外化 `ai.started`) |
| `agent_run.step` | `run:{id}` / `workitem:{id}` | `{run_id, step, action, tool?}`(对外化 `ai.*` trace) |
| `confidence.assessed` | `workitem:{id}` | `{run_id, tier, headline}`(人话呈现,不暴露数值) |
| `agent_run.escalated` | `workitem:{id}` + 目标人 `user:{id}` | `{trigger, headline, handoff_ref}` |
| `permission.ask` | `session:{id}` + 被路由人 `user:{id}` | `{approval_id, tool, summary, ttl}`(阻塞原语外显) |
| `proposal.opened` / `proposal.reviewed` / `proposal.merged` | `workitem:{id}` | `{proposal_id, status, by?}` |
| `sync.conflict` | `workitem:{id}` / `user:{id}` | `{conflict_id, choices, recommended_choice}`(AI 调解候选) |
| `usage.recorded` | `run:{id}` / admin metrics | `{usage_record_id, run_id?, workitem_id?, provider, model, input_tokens, output_tokens, estimated_cost_cny, source}` |
| `budget.warning` | `user:{id}` + admin metrics | `BudgetNotice`(预算接近阈值;Cuu/Web 轻提示) |
| `budget.exhausted` | `user:{id}` + admin metrics | `BudgetNotice`(硬配额耗尽;阻断新 run 或当前 run 交接) |

### 5.3 Topic 隔离与隐私(NFR-08,沿用真实修复)

topic 命名空间与可订阅性如下——**隔离是安全约束,不是性能优化**(历史上发生过跨用户泄漏,已修复并固化):

| topic | 谁可订阅 | 强制点 |
|---|---|---|
| `all` | 任意已认证用户 | 只承载**公共**事件(工作项就绪/状态);**绝不**放私有数据 |
| `req:{id}` / `workitem:{id}` | 通过 `can_view_requirement_record` 的人 | `/stream/req/{id}` 在订阅前做可见性检查(`push.py:84`),私有(draft/clarifying/summary_ready)他人不可订 |
| `run:{id}` **[新]** | run owner、可见 WorkItem 的 reviewer/owner | AgentRun 细节、成本、工具 trace 均可能含私有内容;订阅前必须经 run→workitem 可见性门 |
| `proposal:{id}` **[新]** | 可见该 Proposal 的 reviewer/branch owner/WorkItem viewer | 只承载该提议的 reviewed/merged/comment 增量;完整 manifest 仍 REST 拉取 |
| `user:{id}` | **仅 cookie/令牌解析出的本人** | topic 由 `user.id` 派生而非路径参数(`push.py:99` 注释:客户端无法请求他人流) |
| `job:{id}` | 该 job 的查询者 | `job.updated` **只**发 `job:{id}` + owner `user:{id}`,**绝不发 `all`**——否则泄漏 `result_ref`(=requirement_id)/进度给所有人(`jobs.py:71` 注释,与通知泄漏同类) |
| `session:{id}` **[新]** | session owner(+ 被路由的审批人) | 桌宠/web 会话事件;`permission.ask` 额外发给被路由审批人的 `user:{id}` |

**约定**:任何新增事件**先判私有性**——含 `result_ref`/正文/置信细节的一律走 `user:{id}` 或 `workitem:{id}`(经可见性门),不走 `all`。

---

## 6. 统一错误约定

### 6.1 错误体(沿用 FastAPI `HTTPException`)

所有错误返回 `{"detail": <message|structured>}`,HTTP 状态码语义化。`detail` 为**人话**(中文优先,沿用现有风格,如 `"DDL is required before dispatch"`、`"该昵称是管理员账号，需要管理员口令才能在新设备登录"`)。Pydantic 入参校验失败由 FastAPI 自动返回 `422` + 字段级 `detail` 数组。

成本治理统一错误码为 `budget_exhausted`:当用户/团队/任务任一硬配额耗尽时,新 TS-first endpoint 返回 `ApiErr.code="budget_exhausted"` + 人话 `message` + `details.scope/action`;现有 FastAPI 迁移期可先放入 `detail` 结构体,但用户面文案不得要求客户端解析内部 budget enum。

### 6.2 状态码语义表(从现有 routers 归纳)

| 码 | 含义 | 真实触发例 |
|---|---|---|
| `200` | 成功(读/幂等写) | 多数 |
| `201` | 资源创建 | `create_project`、`register_client_device`、评论创建 |
| `202` | 已受理、异步处理 **[新]** | `session/message`、`agent-run` 触发后产物经 SSE 回流 |
| `204` | 成功无体 | `DELETE /requirements/{id}` |
| `400` | 业务前置不满足 | `"no summary yet"`(`sync.py:45`)、`"DDL is required before dispatch"`(`sync.py:52`)、`"no delivery to revise"`(`deliveries.py:288`);非法状态转移现状亦走 `400`,但口径收敛见下方注 |
| `401` | 未识别身份 | `current_user` 无 cookie/令牌(`auth.py:127`) |
| `403` | 已识别但无权 / 缺设备门 | `"only the requester can ..."`、`"local client required"`(`auth.py:179`) |
| `404` | 资源不存在 / 不可见 | `"requirement not found"`、`"client device not found"` |
| `409` | **并发竞态**(CAS 失败) | `"claim race: requirement is now {current}"`(`sync.py:149`)、`"status race"`(`requirements.py:319`)、`"accept race"`(`deliveries.py:249`)、`"revision race"`(`deliveries.py:303`) |
| `422` | 入参 schema 校验失败 | Pydantic 自动(如 `nickname` 越界) |
| `500` | 服务端异常 | 兜底;后台任务异常另见 §6.5 恢复 |

> **非法状态转移的码:`400`(现状)vs `422`(目标)——需对齐**。现状 `PATCH /status` 对转移表外的 (from,to) 返回 **`400` `"cannot change status from X to Y"`**(`requirements.py:287`,真实代码);而 [`data-model.md`](./data-model.md) §5「边界与失败处理」把目标约定写为 **`422 invalid_transition` + 落 `AuditLog`**。两者一为入参校验(`422`)、一为业务前置(`400`),语义上有歧义。**WorkHub 收敛口径**:非法转移属"入参不满足状态机契约",归 **`422`**,与 data-model 对齐;迁移期 `requirements.py` 的 `400` 视为待改齐的现状,不作为新端点范本。Pydantic 字段级 `422`(schema)与状态机 `422`(`invalid_transition`)用 `detail` 形态区分(前者为字段错误数组,后者为单串/结构体)。

### 6.3 并发与幂等:原子 CAS 约定(强制)

**所有状态机写入必须用 compare-and-swap**:`UPDATE ... WHERE id=? AND status=<expected>`,`rowcount==0` → 回滚 + 重读真实状态 + `409 "{op} race: requirement is now {current}"`。这是现有代码的统一模式(`sync.py:59/138`、`auto.py:84`、`deliveries.py:240/294`、`requirements.py:310`),**WorkHub 升格为强制约定**:

- 防双击副作用(重复 SSE 事件、重复 Delivery、重复通知风暴)。
- D-2 迁 PostgreSQL 后,CAS 之上叠加**行级锁/乐观锁**支撑多 Agent + 多人并发改同一业务对象的合并(PRD §11、`branch-proposal-merge.md`)。
- **事务边界约定**:通知在**同一事务**内 `queue_status_notifications`(`lifecycle.py:104`,不 commit 不 publish),`db.commit()` 后才 `flush_status_notifications` 发 SSE(`deliveries.py:258`)——保证"状态变更与通知同生同灭",SSE 永不先于持久化。

### 6.4 重试与退避(NFR-06)

- **瞬时错误**(LLM/ASR 调用、`429`):指数退避重试,**尊重 `Retry-After`**(对齐 opencode)。详细策略见 [`tech-stack-and-migration.md`](./tech-stack-and-migration.md) provider 抽象。
- **卡住/超预算**:不静默截断 → 优雅降级为**人话交接件**(FR-WORKER-003)→ `escalation.created`。

### 6.5 后台任务失败恢复(沿用 `main.py` 启动扫描)

异步任务(`agent-run`/meeting/knowledge-ask/delivery-doc)进程崩溃会留下 `running` 孤儿。启动时 `_resume_stuck_jobs`(`main.py:102`)扫描:把超 15 分钟的 `running` job 置 `failed` 并**解冻**其驱动的工作项(`ai_processing→ready`、`delivery_doc_pending→delivered`),meeting/ask 置 `failed` 并留人话提示。**约定**:任何新异步流程必须可被此扫描复原(关联一个 `BackgroundJob` 或在 finalize 自带恢复路径,见 `main.py:176` 对无 job 的 `delivery_doc_pending` 的兜底)。

---

## 7. 客户端契约约定(供 C-WEB / C-PET / C-UIKIT)

- **类型化客户端**:从 daemon `/openapi.json` 生成 TS 类型 + API client,收敛进 `C-UIKIT`(`@yqgl/shared` 演进)。详见 [`../05-clients/shared-ui-kit.md`](../05-clients/shared-ui-kit.md)。
- **状态获取双通道**:**REST 拉取为真相,SSE 为增量提示**。SSE 会丢(§5.1 背压),客户端收到事件后按需重拉对应资源 reconcile,不把 SSE 当唯一数据源。
- **设备令牌投递**:`C-PET` 所有请求(含 SSE)带 `X-YQGL-Client-Token` header(`auth.py:23` `LOCAL_CLIENT_HEADER`);`C-WEB` 走 cookie。
- **去黑话**:客户端展示层把 `proposal/branch/merge/conflict` 翻成用户用语(glossary);**API 契约保留技术名**以稳定,翻译在客户端完成(NFR-10、PRD §8.5)。

---

## 附:与其他文档的边界(避免重复)

| 想找 | 去哪 |
|---|---|
| 实体字段、ER、状态机全转移、软删除/审计字段 | [`data-model.md`](./data-model.md) |
| 进程边界、事件总线拓扑、部署、daemon 生命周期 | [`system-architecture.md`](./system-architecture.md) |
| 威胁模型、RBAC、设备门重审、分层 permission 策略细节 | [`security-and-permissions.md`](./security-and-permissions.md) |
| 选型、SQLite→PG 迁移、provider 抽象、复用映射 | [`tech-stack-and-migration.md`](./tech-stack-and-migration.md) |
| 工人循环、工具契约、沙箱、预算、doom-loop、快照 | [`../02-ai-engine/agent-loop-and-tools.md`](../02-ai-engine/agent-loop-and-tools.md) |
| 置信度算法、风险维度、分级阈值、三触发器 | [`../02-ai-engine/confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md) |
| 分支/提议/合并数据流、冲突 AI 调解、对象合并语义 | [`../03-collaboration/branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md) |
| 审批阻塞原语、路由、SLA、委派、"永远允许"学习 | [`../03-collaboration/review-and-approval.md`](../03-collaboration/review-and-approval.md) |
| 双向同步协议、冲突、离线、README=规格 | [`../03-collaboration/sync-and-spec.md`](../03-collaboration/sync-and-spec.md) |
| git 黑话→用户用语权威映射 | [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md) |
