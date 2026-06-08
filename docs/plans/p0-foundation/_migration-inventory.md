---
title: WorkHub P0 地基 — 代码级迁移清单(内部参考)
type: reference
status: active
date: 2026-06-05
note: 由 repo-research 对现有「需求管理大师」代码逐一核验生成,是 F1–F11 各组件 plan 的共同代码级依据。锚点形如 file:line。
---

# WorkHub P0「地基」MIGRATION INVENTORY

现有「需求管理大师」(`D:\02_代码与开发\需求管理大师`)的 greenfield 演进。以下锚点均经实际代码核验。

核验中与规格有出入/需澄清处:
- **旧 Python 迁移工具曾是声明依赖但未实际配置**(`app/pyproject.toml:13` 附近可见迁移相关依赖)；新仓不沿用该运行时路线。当前真实状态仍是运行期 `Base.metadata.create_all` + `ensure_runtime_schema` ALTER 补丁，F03 目标改为 Drizzle Kit migrations。
- **7 处 LLM client 实例化全部确认**,各为一致的 `AsyncAnthropic(base_url=settings.llm_base_url, api_key=settings.llm_api_key)`。
- **`client-tauri` 已在 npm workspace**(`package.json:7-11`)。
- 单 worker 约束以中文写在 `DEPLOY.md:97`(非英文)。

---

## 1. 仓库/构建脚手架、配置与密钥
- **EXISTS:** `app/config.py` 单 pydantic-settings(`:7`):DB URL(`:9` 默认 `sqlite:////srv/yqgl/data/yqgl.db`)、`data_dir`(`:10`)、`app_env`(`:11`)、`cookie_secret/secure`(`:12-13`)、`admin_claim_secret`(`:20`)、`llm_base_url/model/api_key`(`:22-24`)、`asr/tts_base_url`(`:26-29`)、`cors_allow_origins=["*"]`(`:43`)。`app/pyproject.toml` `requires-python>=3.12`，旧迁移相关依赖未形成可用迁移体系。根 `package.json` workspaces `["shared","web","client-tauri"]`。生产校验 `app/main.py:227 _validate_runtime_config()`(production + 默认 cookie_secret 或 `"*"` CORS → RuntimeError)。`scripts/set_admin.py` + `YQGL_BOOTSTRAP_NICKNAMES`。
- **PORT:** pydantic-settings、`_validate_runtime_config` fail-closed、npm workspace、`@yqgl/shared`。
- **REFACTOR:** config 扩 PG pool、broker URL、provider-registry 块、三级预算默认;`database_url` 默认→`postgresql+psycopg://`;去 `/srv/yqgl` 硬编码;`models.py:37` 提到的 `YQGL_ADMIN_NICKNAMES` 全仓无消费者(删或实现)。
- **NEW:** greenfield 骨架;`drizzle.config.ts`+`packages/db/migrations/*` 首迁移;provider-registry 配置 schema;Org/Workspace 配置;broker 连接配置。
- **RISK:** 硬编码绝对路径 `/srv/yqgl/...` 散落运行时代码(非仅 config):`DOWNLOADS_ROOT`(`main.py:339`)、`WEB_ROOT`(`main.py:469`)、DB 默认(`config.py:9`)、data_dir(`config.py:10`)。greenfield 须全部经 settings,否则不可移植(尤其当前 Windows 开发机)。

## 2. 数据层
- **EXISTS:** `app/db.py` `create_engine(future=True, pool_pre_ping=True)`(`:17`,`:14-16` 注释明说为未来 PG/MySQL 埋点);`connect_args={"check_same_thread":False}` 仅 sqlite(`:8`);SQLite-only PRAGMA `_configure_sqlite`(`:30-39`:WAL/synchronous=NORMAL/busy_timeout=5000/foreign_keys=ON);`SessionLocal(autoflush=False, expire_on_commit=False)`(`:42`);`get_db()`(`:45-50`)。`app/models.py` 35 实体,`Base(DeclarativeBase)`(`:16`),`TimestampMixin`(`:20`),`uid()=uuid4().hex`→`String(32)` PK,JSON 存 `Text`;`Requirement` 状态串域(`:328-330`)。`app/services/schema_migrations.py` 幂等运行期 ALTER(docstring 明说"用 create_all 而非 Drizzle migration")。`main.py:251-252` `create_all`+`ensure_runtime_schema`。
- **PORT:** `pool_pre_ping`、`expire_on_commit=False`、`uid()`、`get_db()`、`TimestampMixin`、软删 `deleted_at`、非 sqlite 的 `connect_args={}` 分支(已 PG-ready)。
- **REFACTOR:** 删 PRAGMA hook;`String(32)`→PG `UUID`;`Text`-JSON→`JSONB`;`datetime.utcnow()`(naive,遍布,如 `main.py:116`/`auth.py:167`)→`timestamptz`;`is_admin BOOLEAN DEFAULT 0`→`boolean DEFAULT false`;可变实体加 `version`(乐观锁);`Project.next_seq`(`PROJ-NNN`)需 PG `SEQUENCE` 或行锁(现仅靠单 worker 安全)。
- **NEW:** Drizzle Kit init + 首迁移;新表 `Branch/Proposal/Review/AgentRun/AgentStep/ConfidenceRecord/EscalationEvent/Snapshot/PermissionPolicy/ApprovalRequest/AuditLog/UserProfile/Org/Workspace/SpecDoc`;`SELECT…FOR UPDATE`;`requirements→work_items` 改名;JSONB GIN 索引;`WHERE deleted_at IS NULL` 偏索引。
- **RISK:** SQLite→PG 类型强转**静默出错**:naive `utcnow()` 遍布且用于崩溃恢复时间数学(`main.py:116` 15 分钟 cutoff),naive/aware 混用比较结果错却不报错 —— stuck-job 清扫可能永不触发或全触发。`requirements→work_items` 改名牵动 15+ 表 `requirement_id` FK。

## 3. FastAPI daemon
- **EXISTS:** `app/main.py` `FastAPI(title="需求管理大师", lifespan=lifespan)`(`:270`);**26 routers** `include_router`(`:280-305`);CORS(`:272-278`);`lifespan`(`:236-267`)做 data-dir mkdir、`create_all`、`ensure_runtime_schema`、`cleanup_stale_partials`、`await _resume_stuck_jobs()`(`:255`)、两个周期任务(`:257-258`);静态托管 `/downloads`(`:340`)、`/client/{name}`(`:325`)、`/assets`+SPA fallback(`:469-498`);`GET /api/health`(`:308`)。`app/routers/auto.py` AI 运行为进程内 `asyncio.create_task(_run_and_finalize)`(`:103`)。
- **PORT:** 旧 Python API daemon/uvicorn 的行为锚点迁到 TS/Hono:路由前缀分组、CORS+生产门、`/api/health`、lifespan 周期任务(`asyncio.to_thread` 卸载,`main.py:77,96`)对应为 Node 后台任务/leader job、`/downloads`+`/client` 安装包托管。
- **REFACTOR:** 路由按域重组(session/workitem/proposal/permission/event/sync);**剥离 SPA 静态托管**(`:469-498`)→ daemon headless;`_resume_stuck_jobs` 语义移入 AgentRun worker 心跳;周期任务多 worker 下需 leader 选举;AI 执行移出请求进程。
- **NEW:** OpenAPI-first 生成类型化客户端;AgentRun 队列(Redis/PG)替 `asyncio.create_task`;单例 leader 选举。
- **RISK:** **单 worker 硬约束**(`DEPLOY.md:97` 明确为正确性而非容量):4 个进程内单例在第 2 worker 下**静默坏**——①`push_bus` SSE;②`presence`;③AI 澄清并发槽;④后台去重。解除须 **DB 行锁 + broker 同时**,只换库会 split-brain。此约束 gate 了 §2/3/4/8。

## 4. 事件 bus
- **EXISTS:** `app/services/push_bus.py` 进程内 `PushBus`:`dict[str,list[Queue]]`(`:23`),每订阅 `Queue(maxsize=256)`(`:27`),`publish` 扇出 `QueueFull→pass`(丢慢订阅,`:43-44`),`stream()` 30s 心跳(`:50-61`),模块单例 `bus`(`:47`)。`app/routers/push.py` SSE,topic `all`/`req:{id}`/`user:{id}`;`req:{id}` 订阅前 `can_view_requirement_record`;`user:{id}` 由认证 `user.id` 派生(非路径)。`app/services/presence.py` 另一进程内单例(RLock+dict,TTL 120s)。
- **PORT:** topic 命名、maxsize-256 丢慢订阅背压、30s 心跳、"订阅前鉴权"隐私门、`user:{id}`-by-identity 规则。
- **REFACTOR:** `PushBus` 抽象为接口,后端 **Redis pub/sub**(`DEPLOY.md:97` 点名)或 PG `LISTEN/NOTIFY`(跨 worker);`presence`→Redis key+TTL;扩 topic `workitem:{id}`/`run:{id}`/`proposal:{id}`/`session:{id}`/`org:`/`workspace:`;审批私有事件按 approver 路由到 `user:{id}`,不另立 `permission:*` 物理 topic。
- **NEW:** broker 适配器;跨 worker 扇出;新 topic + 鉴权门;正式事件类型采用 `_experience-deliverable-contracts.md` §4,如 `permission.ask`/`agent_run.step`/`agent_run.escalated`/`proposal.opened`。
- **RISK:** broker 化后每 payload 对所有 worker 可见 —— 隐私门(`can_view`、`user:{id}`-by-identity)须在**订阅边界**重强制(NFR-08,有跨用户泄漏前科)。"全量发 Redis 客户端过滤"会重现泄漏。

## 5. 鉴权/身份
- **EXISTS:** `app/auth.py` `User`/`ClientDevice`;`StreamUser`(`:27`);`make_client_token`(48B,`:38`)/`hash_client_token`(sha256,`:41`)/`issue_cookie`(itsdangerous,`:45`);**优先级链** `current_user`(`:104`):worker-token 优先(`_user_from_worker_token` `:67`,token 胜 cookie `:109-111`)→签名 cookie(`:119`),均 `deleted_at IS NULL`;设备门 `current_client_device`(`:172`)/`require_local_client`(`:183`→403)/软 `optional_local_client`(`:189`)/`require_stream_user`(`:202`,不持 DB session)。`_user_from_worker_token` 故意不更新 `last_seen_at`(`:94`)避 SQLite 单写锁。`app/routers/auth.py` admin-claim(`secrets.compare_digest`)。`models.py:27 User`/`:57 ClientDevice`(`client_token_hash` 唯一索引,`revoked_at`)。
- **PORT:** 整套双通道(cookie+device token)、token-胜-cookie 优先级、sha256(永不明文)、设备门、`require_stream_user` 无 session、admin-claim 常数时间门、软删即不存在、`scripts/set_admin.py` 带外授权。
- **REFACTOR:** `_user_from_worker_token` 不更新 `last_seen_at` 的 hack 在 PG 下可放开(行锁≠全库锁);注入 Org/Workspace 上下文;`is_admin` 留作迁移期最高优先 allow-fallback 但被 RBAC 角色增强;新 `require_actor` DI 给 AI 合成 actor(现 `auto.py:224` 伪造 `User(id="ai-auto")`)。
- **NEW:** AI actor 一等身份;Org/Workspace scoping;(P5)真凭证替昵称。
- **RISK:** 优先级链是安全敏感顺序,token-胜-cookie 专为 Tauri WebView2 cookie jar 与 Rust reqwest jar 分离而设(`auth.py:68-75` 记录真实 outage)。任何"干净重写"有重现风险。**逐字移植,勿重造。**

## 6. 权限
- **EXISTS:** `app/services/permissions.py` 纯函数无副作用:`is_admin`(`:32`)/`is_submitter`(`:37`)/`is_assignee`(`:41`)/`requirement_project_is_active`(`:45`);能力检查(`:50-119`):`can_view_*`/`can_ack_*`/`can_add_*`/`can_manage_*`/`can_claim_*`/`can_work_*`;`PRIVATE_REQUIREMENT_STATUSES`/`ASSIGNMENT_EDITABLE_STATUSES`(`:28-29`)。**读/写不对称**(docstring `:6-21`):admin 在**读**短路 project-active(`:54`),在**写**不短路(`:84-86`);admin 永不绕设备门。散落路由守卫(`requirements.py`/`sync.py`/`deliveries.py`)。
- **PORT:** 纯函数关系检查风格、读/写/设备门不对称、状态域守卫。
- **REFACTOR:** 检查 scope 化(加 `org_id`/`workspace_id`);`Requirement`→`WorkItem`/`Proposal` 泛化;`is_admin` 成新引擎最高优先 allow-fallback,**但须保留读开/写仍 gated 的细粒度**(规格 data-model §3.1 警告:合并会放松约束)。
- **NEW:** `PermissionPolicy`(org→workspace→role→session,allow/deny/ask,默认 ask);合并算法(scope 近邻降序→`deny>ask>allow`);`ApprovalRequest` 阻塞原语+路由+SLA+委派;工具注册表按 actor 可见性过滤;"永远允许"学习。
- **RISK:** 把"if-in-code"外化为"rules-in-data" 而**不放松**现模型。admin 读/写不对称、设备门正交于 admin 是已调试的微妙不变式;新默认-ask 引擎叠加迁移期 `is_admin` allow-fallback,precedence 误序会过度拦截或静默重开归档项目写。

## 7. LLM provider 调用点
- **EXISTS(7 处全确认,均 `AsyncAnthropic(base_url=settings.llm_base_url, api_key=settings.llm_api_key)`):** ①`auto_agent.py:34`(`messages.stream` 工具循环)②`llm_agent.py:24`(澄清,`messages.stream`)③`drive_comment_agent.py:12` ④`meeting_agent.py:12` ⑤`delivery_doc.py:23` ⑥`task_decomposition.py:29` ⑦`routers/assistant.py:29`。另 `llm_review`(`auto_agent.py:544`)复用模块 `_client`。配置源 `config.py:22-24`。DeepSeek 经 Anthropic 兼容端点 + 官方 `anthropic` SDK。
- **PORT:** `AsyncAnthropic(base_url, api_key)` 形态(DeepSeek-via-Anthropic 仍首发);调用签名(`.stream`/`.create`)不变。
- **REFACTOR:** 7 处模块级 `_client` → `registry.get(actor, task)`;加 token 计量+成本 hook。
- **NEW:** provider 注册表(`app/llm/`),含端点+鉴权+模型+能力+成本档;模型路由(低风险走廉价,NFR-05);可扩 Anthropic/OpenAI 原生;预算计量喂三级配额。
- **RISK:** 概念易但**面广易半成**——7 文件 2 种模式(`.stream` vs `.create`),漏一处即静默绕过治理,无编译错。须逐文件列任务。

## 8. Agent 引擎
- **EXISTS:** `app/services/auto_agent.py`:常量 `MAX_TURNS=15`(`:36`)/`TOTAL_TIMEOUT_DEFAULT=300`(`:37`)/`MAX_SANDBOX_FILES=800`(`:38`)/`MAX_SANDBOX_BYTES=200MiB`(`:39`)/`COMMAND_TIMEOUT=45`(`:40`)/`ALLOWED_COMMANDS`(`:42`)。`TOOLS`(`:51`,9 工具 Anthropic schema);`run_auto`(`:374`),`for turn in range(1,MAX_TURNS+1)`(`:405`),`submit` 分支(`:449`),工具 dispatch(`:457+`),停判(`:499-505`)。沙箱:`_safe_path`(`:154`)/`_enforce_sandbox_budget`(`:176`)/`_sandbox_rlimits`(`:268`,POSIX preexec_fn:CPU120s/AS2GiB/FSIZE256MiB/NOFILE512;egress 不拦,trusted-LAN 接受),命令白名单(`:294`),禁装依赖(`:296`),env 收窄(`:304`),`run_command` 经 `to_thread`。`llm_review`(`:544`)返回 `(bool, reason)`。`AutoResult`(`:365`)/`AutoOutcome`(`:592`)/`auto_process`(`:623`);事件发 `req:{id}`。
- **PORT:** **整个沙箱**(路径前缀/rlimit/命令白名单/文件预算,"已验证安全资产");所有预算/沙箱常量;`llm_review` 作升级触发①;loop 骨架;`run_command` 经 `to_thread`;schema-fail→错误反馈不崩。
- **REFACTOR:** `run_auto`→可复用 `AgentLoop`;`TOOLS`+内联 `if name==…`→`ToolRegistry`(`{id,description,schema,execute,side_effect,min_scope}`);完成判定从"调 `submit`"→"`end_turn` 无 `tool_use`"(`submit` 降级可选);常量→每运行 `RunBudget`;超预算从静默 `failed`→`escalate`+结构化交接;生命周期耦合(`auto.py` 直写 `Requirement.status`)→统一中枢;事件 `ai.*`→`run:{run_id}`。
- **NEW:** 显式控制信号(continue/stop/compact/escalate);doom-loop 检测(指纹最近 N 步);每步快照+revert(今无);`compact` 上下文压缩(今无,靠 MAX_TURNS=15);瞬时重试 Retry-After(今 LLM 错全 `failed`);`AgentRun/AgentStep` 持久化(今为 transient dataclass);token/成本计量。
- **RISK:** 把 AI 执行从请求进程 `asyncio.create_task`(`auto.py:103`)移入可恢复 `AgentRun`,同时保留分离任务竞态护栏(现仅靠单 worker SQLite):start-CAS(`auto.py:84`)、settle-on-drift(`auto.py:166`)、failure-revert-only-if-in-flight(`auto.py:318`)→ 多 worker 下须行锁/乐观锁;沙箱 `_sandbox_rlimits` 仅 POSIX(Windows no-op,`auto_agent.py:22`)→ **生产须 Linux**。

## 9. 审计/快照/回滚
- **EXISTS:** `ActivityLog`(`models.py:554`,WorkItem 级 `actor_nickname/action/detail_json`);`ProjectDriveOperation`(`:214`,`op_type/payload_json/`**`undone_at`**`:222` —— 现有 undo 原语);`ProjectDriveVersion`(`:192`,`sha256+version_no` append-only);`RequirementProgressUpdate`(`:408`);`RevisionRequest`(`:535`,`reason_md` NOT NULL);`Delivery.round` 唯一(`:515`);软删遍布;近期 blob-orphan 清理提交(finalize-rollback 清盘上 blob)。
- **PORT:** `undone_at` undo 范式、内容寻址 sha256、append-only drive 版本、round 化交付、"queue-in-transaction/publish-after-commit"(`lifecycle.py`)。
- **REFACTOR:** `ActivityLog`+`ProjectDriveOperation`→统一 `AuditLog`(actor_kind human/ai/system、`before_ref/after_ref` 快照引用、`undone_at`、append-only、永不软删)。
- **NEW:** `Snapshot` 实体 + 每 AI 副作用快照(今无,drive undo 是唯一回滚且 drive 专用);`revert` 契约;**fail-closed 红线**"快照失败⇒拒绝副作用";快照与业务写同一 PG 事务。
- **RISK:** 规格把"每 AI 副作用快照、任一步可 revert"升为安全宪法/红线,但今**无通用快照**(仅 drive `undone_at`)。业务对象回滚需异构写(状态/派活/结构化记录)的逆操作完备性;部分写本质不可逆(已发外部通知,规格开放问题 §10.5)。判定哪些写不可逆、须执行前 ask-gate,是**未解设计**非移植。

## 10. 实时/通知
- **EXISTS:** `app/services/notifications.py` `create_notification`(`:30`)/`publish_notification`(`:94`,**仅**发 `user:{row.user_id}`,`:105`,私有)/`publish_notification_threadsafe`(`:108`,同步上下文桥)。`app/services/lifecycle.py` `_MILESTONES`(`:31`,覆盖 `claimed/delivered/delivery_doc_pending/accepted/revision_requested/cancelled`),`queue_status_notifications`(事务内不发)/`flush_status_notifications`(commit 后发);docstring(`:3-14`)记录真实 outage:PATCH /status 不在 claim/deliver 路 → 提交者收不到 → 故中枢化。`Notification` 带 `dedupe_key`(`models.py:146`)。
- **PORT:** "里程碑通知集中一处"、私有按身份(`user:{id}`,永不 `all`)、queue-in-tx/flush-post-commit 铁律、`dedupe_key` 幂等、`publish_notification_threadsafe` 桥。
- **REFACTOR:** `_MILESTONES` 须加**新状态** `escalated/pm_mode/in_review/merged`(规格 data-model §5 警告:现未登记 → 升级/合并里程碑会静默不通知);扩 Proposal/Review/Escalation。
- **NEW:** 通知按 approver 路由到私有 `user:{id}`;新状态机节点的里程碑路由;跨 worker 投递(依赖 broker §4)。
- **RISK:** 加状态时静默漏通知。`lifecycle.py:3-14` 史证:状态变更脱离通知码路是**隐形 outage**(无错,用户只是收不到)。加 `escalated/pm_mode/in_review/merged` 不登记 `_MILESTONES` 即对最重要新流(升级/合并)重现此 bug。

## 11. 客户端壳
- **EXISTS:** **Tauri**(`client-tauri/src-tauri/src/`,17 模块):`sse.rs`(字节级 SSE 解析+退避)、`sync.rs`(**`sync_drive_download` 占位,仅单向下载**,`:227-228`)、`spec_watch.rs`(sha256+append-only 本地↔server)、`tray.rs`、`notify.rs`、`deep_link.rs`、`reminders.rs`、`upload.rs`(分块)、`operation_locks.rs`、`http.rs`(`base_url` `:70`)、`config.rs`、`delivery.rs`、`window.rs`、`commands/`。**Web**(`web/src/`):`App.tsx`/`pages/`/`components/`/`hooks/`/`lib/`,纯 SPA 消费 `@yqgl/shared`。**Shared**(`shared/src/`):`api/client.ts`(相对 `/api`,同源 fetch,`withCommon` 注 `X-YQGL-Client-Token`,`:25-30`,`credentials:"include"`)、`api/types.ts`(手写)、`hooks/use*Stream.ts`(SSE,`customFetch` 因 Tauri origin `tauri://localhost`,`:5-13`)。
- **PORT:** 全部 Tauri Rust 能力;`@yqgl/shared` 客户端+SSE hook;`withCommon` token 注入+`isDesktopRuntime`;`customFetch`-for-Tauri-origin。
- **REFACTOR(P0 最小):** `shared/src/api/types.ts`+`client.ts` 手写→**OpenAPI 生成**(规格 §5.3,P0 最高杠杆客户端改动);base-URL:web 现同源(相对 `/api`),daemon headless 后 web 单独部署→需可配 daemon base URL(Tauri 已有 `http::base_url`);新/改名端点 `requirements→workitem`+`session/agent-run/proposal` 组;SSE `/stream/session/{id}`;hook 消费新 topic。
- **NEW(多 P1+):** Tauri 双向同步(升级 `sync.rs:227`);桌宠窗+本地 agent+人格。
- **RISK:** web 同源假设是**结构性**(今 daemon 服务 SPA `main.py:469`,相对 `/api`+cookie `credentials:include` "自然可用")。解耦后跨域 → CORS+cookie `SameSite/secure` 须重解(Tauri 路已用 token);跨域做对 CORS+cookie 且不削弱生产门(`main.py:227`)是 P0 客户端 tripwire,与 §5 交互。

---

## (A) 依赖序 P0 组件(各自成 plan)
1. **F1** 仓库/构建脚手架+配置 —— *blocks 全部*
2. **F2** 实体模型移植 + `requirements→work_items` —— 依赖 F1
3. **F3** PostgreSQL+Drizzle —— 依赖 F2 —— **地基第一道门**
4. **F4** 鉴权/身份移植 —— 依赖 F2
5. **F5** 事件 bus→broker —— 依赖 F3,**与 F3 成对**解除单 worker
6. **F6** 权限引擎 —— 依赖 F2,F4
7. **F7** LLM provider 注册表 —— 依赖 F1,可与 F3–F5 并行
8. **F8** Agent 引擎核心抽取 —— 依赖 F3,F5,F6,F7 —— **汇聚点**
9. **F9** 生命周期/通知扩展 —— 依赖 F5,F2
10. **F10** 审计/快照/回滚 —— 依赖 F3,F8
11. **F11** headless daemon 拆分+客户端改接 —— 依赖以上全部

关键路径:**F1→F2→F3→{F5,F6,F7}→F8→{F9,F10}→F11**。

## (B) Top 5 跨切迁移风险
1. 解除单 worker 需 DB+broker 同时,半做即 split-brain(静默)——F3、F5 成对。
2. SQLite→PG 类型强转静默出错(naive datetime ↔ timestamptz),叠加 `requirements→work_items` 15+ 表 FK。
3. broker 化引入跨用户事件/通知泄漏(NFR-08,有前科)——订阅边界重强制鉴权。
4. 权限外化放松既有 admin 读/写/设备不对称。
5. 每副作用快照/回滚红线是净新设计,gate AI 安全;不可逆写须执行前 ask-gate(未解,§10.5)。
