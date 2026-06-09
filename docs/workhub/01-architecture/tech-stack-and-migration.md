---
module: 01-architecture
layer: 横切 / 地基
status: 🚧
owner: workflow
---

# 技术选型与迁移(Tech Stack & Migration)

> 本篇回答两个问题:**WorkHub 用什么技术栈、为什么**,以及**怎么把现有「需求管理大师」地基迁进新仓并演进成 headless agent daemon + 瘦客户端**。
>
> 上游:[PRD §11 技术架构方向](../../prd/2026-06-04-workhub-prd.md) · [规格树索引](../README.md)。
> 地基决策见 README §4(**D-1** 参考既有 Python/FastAPI 行为锚点的 TS-first 重写与演进、**D-2** SQLite→PostgreSQL、**D-3** LAN-first MVP + 云就绪)。
> 术语口径:本篇出现「daemon / Proposal / 分支 / 升级」等以 [glossary-dejargon](../00-overview/glossary-dejargon.md) 为准(对用户隐藏 git 黑话,内部文档可直说)。
> 兄弟篇:进程总图与事件流细节见 [system-architecture](./system-architecture.md);实体与状态机见 [data-model](./data-model.md);路由组与事件类型见 [api-contract](./api-contract.md);威胁模型与设备令牌门见 [security-and-permissions](./security-and-permissions.md)。本篇只做**选型决策 + 迁移映射 + 重构步骤**,不重复上述细节。
> **2026-06-05 修订**:新仓后续施工默认 **TypeScript-first**。本文中 FastAPI / SQLAlchemy / Python Agent 的内容保留为现有系统的行为锚点和迁移来源;新实现的模块、端口、页面返回、Cuu 对齐见 [`../../plans/p0-foundation/_ts-first-module-port-page-alignment.md`](../../plans/p0-foundation/_ts-first-module-port-page-alignment.md)。

---

## 1. 一句话结论

**不丢行为经验,但新仓 TS-first。** 现有仓库已经把 WorkHub 的脊梁骨造好了——状态机、`auto_agent` 工人 loop、`llm_review` 判分、`lifecycle` 通知中枢、`spec_watch` 同步地基、设备令牌门、按身份权限。它们都被验证过、扛过真实并发。WorkHub 的工作不是照搬 Python 单体,而是把这些行为迁成 TypeScript-first 地基:

1. **换语言心智**:API、Agent、权限、事件、审计、页面 VM、shared client 统一用 TypeScript;
2. **换底座**:SQLite → PostgreSQL,解除 `--workers 1` 的并发天花板;
3. **拆形态**:从「单进程 FastAPI 全栈」重构为 **Hono/Node headless agent daemon(唯一真相源)+ 瘦客户端(web / 桌宠)**;
4. **抽接口**:把硬编码的 DeepSeek-Anthropic 行为收进 **provider 注册表**,系统其余保持模型无关;
5. **补零件**:在复用行为之上新建 AI-native 的命门(置信度/风险分级、升级、分层 permission、Proposal、审计/快照)。

---

## 2. 技术选型(Stack Decisions)

### 2.1 现有系统迁移锚点表

> 下表记录「需求管理大师」的可复用行为和真实锚点,不再代表 WorkHub 新仓默认语言选择。新仓目标栈见 §2.3。

| 层 | 选型 | 现状锚点 | 决策 / 演进 |
|---|---|---|---|
| **后端框架** | Hono / Node 22（TS-first） | `app/main.py`(26 个 router via `include_router`)、`routers/push.py`、`auth.py` | **行为锚点，不复用运行时**。旧 FastAPI 证明了路由分组、SSE、OpenAPI、鉴权依赖与生产 fail-closed 的语义；新仓用 Hono route + middleware + OpenAPI registry 复刻这些不变量。 |
| **ORM** | Drizzle ORM + PostgreSQL | `app/db.py`、`app/models.py`(32KB 实体)、`services/schema_migrations.py` | **替换实现，复用实体语义**。`pool_pre_ping`、软删除、状态机、FK/唯一约束是迁移锚点；目标落 `packages/db/src/schema/*`、relations、repositories 与 Drizzle Kit migrations。 |
| **数据库** | **PostgreSQL**(替换 SQLite) | `db.py:8` 的 `startswith("sqlite")` 分支、`config.py:9` 默认 `sqlite:////...` | **替换(D-2)**。理由见 §6:多 Agent + 多人并发、业务对象合并需**行级锁 / `SELECT … FOR UPDATE` / 乐观锁**,SQLite 单写者做不到。 |
| **数据库迁移** | **Drizzle Kit**(替换运行时 `create_all`+ALTER) | `main.py:251` `Base.metadata.create_all`、`services/schema_migrations.py`(idempotent ALTER 补丁) | **新建**。现状仍靠运行期 `create_all` 与补丁式 ALTER；新仓用 Drizzle schema + migrations 版本化,多 Agent 并发写 PG 上 schema 不得运行时漂移。详见 §6.3。 |
| **LLM 接入** | provider 注册表;**DeepSeek-via-Anthropic** 作为首个 provider | `config.py:22` `llm_base_url=https://api.deepseek.com/anthropic`;**7 个模块**各自 `_client = AsyncAnthropic(...)`(`auto_agent.py:34`、`llm_agent.py:24`、`drive_comment_agent.py:12`、`meeting_agent.py:12`、`delivery_doc.py:23`、`task_decomposition.py:29`、`routers/assistant.py:29`) | **抽象化(D-5)**。现在 7 处硬编码同一个 client;收进统一注册表,低风险任务可路由更便宜模型(成本治理 NFR-05)。详见 §4。 |
| **实时事件** | SSE(MVP)/ 预留 WS;**Redis broker v0** | `services/push_bus.py`(进程内 pub/sub)、`routers/push.py`(`/api/push/stream{,/me,/req/{id}}`) | **复用语义 + 换实现**。事件契约(topic + event type)保留;R2.3 已落 Redis pub/sub + Redis presence 作为多 worker v0,R2.5 已新增真实 Postgres + Redis smoke(§6.2)。 |
| **桌面客户端** | **Tauri v2 + Rust + React webview** | `client-tauri/src-tauri/src/*`(`lib.rs` 14 个 mod、`sse.rs`/`sync.rs`/`spec_watch.rs`/`tray.rs`/`upload.rs`/`reminders.rs`/`deep_link.rs`) | **复用**。Rust 侧已具备 SSE 长连+退避、托盘、通知、deep-link、本地文件监听、分块上传——桌宠(C-PET)直接在此长出。 |
| **Web 客户端** | React + Vite + TS | `web/`(Vite + Playwright)、`app/main.py` SPA fallback(`/srv/yqgl/web/dist`) | **复用**。C-WEB 继续是 Vite SPA;daemon 化后改为纯 API 消费者(§5)。 |
| **共享层** | `@yqgl/shared`(API client + types + hooks + tokens + UI) | `shared/src/api/{client,types}.ts`、`hooks/use*Stream.ts`、`design/*` | **复用 + 升级为 C-UIKIT**。已是 web/tauri 共用的类型化 client;WorkHub 让它成为「OpenAPI 生成类型 + SSE hooks」的单一来源(§5.3)。 |
| **身份 / 鉴权** | Cookie 昵称身份 + 设备令牌门 | `app/auth.py`(`issue_cookie`、`require_stream_user`、`require_local_client`)、`models.ClientDevice` | **复用,P5 再演进**。LAN-first 延续昵称+设备令牌;RBAC / Org 多租户为 P5 预留(D-3)。详见 [security-and-permissions](./security-and-permissions.md)。 |
| **ASR / TTS** | 独立 GPU FastAPI 服务 | `systemd/yqgl-asr.service`、`yqgl-tts.service`(各 `--workers 1`、`cuda:0`) | **复用,原样保留**。已是独立进程,daemon 化天然解耦,只是被 daemon 当外部 provider 调用。 |
| **文件解析 / 知识** | 本地解析 + grep 语料(无向量库) | `services/file_parser.py`、`services/knowledge.py`(`rebuild_knowledge_index`) | **复用(D-4)**。延续 grep + 强制引用,不引入向量库。 |

### 2.2 为什么仍要迁移现有行为(而非完全重想)

- **现有 FastAPI/Tauri/React 已经验证了产品闭环**:OpenAPI、SSE、类型化客户端、设备令牌门、Tauri 本地能力都已跑通。TS-first 不是抛弃这些经验,而是把它们迁到单一 TypeScript 心智里。
- **Python Agent 行为是参考实现,不是目标运行时**:`auto_agent.py` 的 tool_use loop、沙箱、`llm_review`、通知中枢等仍是行为锚点;新仓用 TS AgentLoop/ToolRegistry 复刻这些不变量。
- **真正必须换的是并发与契约底座**:SQLite 单 worker、进程内 bus、手写 DTO 会限制 AI-native 后台大量运行。TS-first + PostgreSQL + Redis + generated client 是新的地基组合。

### 2.3 WorkHub 新仓 TS-first 目标栈

| 层 | 新仓默认 | 说明 |
|---|---|---|
| API daemon | Hono on Node.js 22 LTS | `/api/*` + SSE;不托管 SPA |
| Contract/schema | Zod + OpenAPI | `QuestionCard`/`EvidenceRef`/`DeliverableChangeManifest`/`WorkHubEvent` 同源生成 |
| DB/迁移 | PostgreSQL + Drizzle ORM + Drizzle Kit | TS schema、type-safe query、migration drift check |
| Agent | TypeScript AgentLoop + ToolRegistry | 迁移现有 `auto_agent` 行为,不复制 Python 单体 |
| Events | Redis broker + `packages/events` | 正式事件名、WorkHubEvent envelope、toCuuState |
| Client | React + Vite + TS | Web 与 Tauri webview 共用 generated API client |
| Desktop shell | Tauri v2 + Rust | 本地能力边界:窗口/托盘/文件/通知/设备令牌/同步 |
| Optional worker | Python document worker | Office/PDF/图片预览等重文档处理,通过 queue/API 调用 |

**更新原则**:本文件后续若新增选型内容,必须同时检查 [`_ts-first-module-port-page-alignment.md`](../../plans/p0-foundation/_ts-first-module-port-page-alignment.md),避免再次把 Python/FastAPI 写回默认路线。

---

## 3. 目标架构:进程 / 服务边界(组件图)

> 总图、SSE/WS 事件流细节、部署拓扑以 [system-architecture](./system-architecture.md) 为准。此处给**迁移视角**的边界划分:谁是进程、谁是真相源、谁只是瘦客户端。

### 3.1 文字组件图(目标态)

```
                         ┌──────────────────────────────────────────────┐
                         │            C-DAEMON  (唯一真相源)              │
                         │            headless agent daemon               │
                         │            Hono + Node.js (可多 worker)        │
                         │  ┌──────────────────────────────────────────┐  │
   ┌─────────┐  HTTP     │  │ API 层   OpenAPI 路由组 (api-contract.md)  │  │
   │ C-WEB   │──────────▶│  ├──────────────────────────────────────────┤  │
   │ React/  │  SSE/WS   │  │ AuthZ    设备令牌门 + 分层 permission       │  │
   │ Vite    │◀─────────▶│  ├──────────────────────────────────────────┤  │
   └─────────┘           │  │ Domain   WorkItem 状态机 / Proposal / 审批 │  │
                         │  ├──────────────────────────────────────────┤  │
   ┌─────────┐  HTTP     │  │ AI Engine 工人 loop / PM 模式 / 置信风险   │  │
   │ C-PET   │──────────▶│  │           provider 注册表 (§4)             │  │
   │ Tauri+  │  SSE/WS   │  ├──────────────────────────────────────────┤  │
   │ Rust+   │◀─────────▶│  │ Events   事件总线 → Redis pub/sub (§6.2)   │  │
   │ webview │           │  └──────────────────────────────────────────┘  │
   └────┬────┘           └───────┬───────────────┬───────────────┬────────┘
        │ 本地能力               │ SQLAlchemy     │ 调外部服务     │ blob/工件
        │ (托盘/通知/             ▼                ▼                ▼
        │  spec_watch/        ┌──────────┐   ┌──────────┐    ┌──────────┐
        │  双向同步/           │PostgreSQL│   │ DeepSeek │    │ 对象存储 │
        │  本地 Agent)         │(行级锁/  │   │ ASR/TTS  │    │ data_dir │
        └─────────────────────│ 乐观锁)  │   │ (GPU)    │    │ /工件树  │
                              └──────────┘   └──────────┘    └──────────┘
```

### 3.2 进程边界(谁是进程)

| 进程 | 现状 | 目标态 | 边界理由 |
|---|---|---|---|
| **daemon (C-DAEMON)** | `app/` 单进程 FastAPI,既出 API 又托管 AI 任务又托管 SPA 静态文件(`main.py` SPA fallback) | Hono/Node TS daemon:API + AI 引擎 + 事件流。**不再托管前端静态文件**(交给 web 自己的静态服务 / CDN) | 真相源单一;客户端可任意部署/版本 |
| **web (C-WEB)** | Vite build 部署到 `/srv/yqgl/web/dist`,由 daemon `StaticFiles` 挂载 | 独立 SPA,纯 API/SSE 消费者 | 浏览器可达,只能派活/审批(设备令牌门) |
| **桌宠 (C-PET)** | `client-tauri` Tauri app,Rust 侧已有 sse/sync/spec_watch/tray | 瘦客户端 + 本地能力(同步、桌宠窗口、本地 Agent、托盘/deep-link) | 接活/干活专属;持设备令牌 |
| **ASR / TTS** | 已是独立 systemd 服务 | 不变,被 daemon 作为 provider 调用 | GPU 隔离,天然独立 |
| **broker (新增)** | 无(进程内 `PushBus`) | Redis(pub/sub + 任务协调) | 解除单 worker(§6.2) |

> **关键迁移动作**:把 `app/main.py` 里「daemon 兼托管 SPA」的耦合拆开(§5.1)。现状 `main.py:469` 的 `WEB_ROOT = /srv/yqgl/web/dist` + SPA fallback 是单体遗留;daemon 化后 daemon 只暴露 `/api` + `/downloads` + `/client`,前端独立部署。

---

## 4. LLM provider 抽象(DeepSeek-Anthropic 端点)

### 4.1 现状(硬编码,**7 处**各自 `new` 同一个 client)

```
config.py:22   llm_base_url = "https://api.deepseek.com/anthropic"
config.py:23   llm_model    = "deepseek-v4-pro"

# 7 个模块各自在顶部 new 一个完全相同的 client(同 base_url / 同 api_key):
auto_agent.py:34          _client = AsyncAnthropic(base_url=settings.llm_base_url, api_key=settings.llm_api_key)
llm_agent.py:24           _client = AsyncAnthropic(...)
drive_comment_agent.py:12 _client = AsyncAnthropic(...)
meeting_agent.py:12       _client = AsyncAnthropic(...)
delivery_doc.py:23        _client = AsyncAnthropic(...)
task_decomposition.py:29  _client = AsyncAnthropic(...)
routers/assistant.py:29   _client = AsyncAnthropic(...)
```

即:DeepSeek 通过 **Anthropic 兼容端点** 接入,用官方 `anthropic` SDK 的 `AsyncAnthropic`。`auto_agent` 用 `messages.stream`(`auto_agent.py:413`)跑 tool_use loop;`llm_agent` 用 `messages.stream`(`:154`)做澄清;`llm_review` 及网盘评论 / 会议 / 交付文档 / 任务分解 / 助手等用 `messages.create` 做判分与单轮生成。**端点 / 鉴权散落在 7 个模块顶部各 `new` 一份**——换 provider、加路由、挂预算都要改 7 处,这正是要收敛的原因。

### 4.2 目标(统一 provider 注册表)

新建一个 provider registry(`services/providers/` 或 `app/llm/`),把「端点 + 鉴权 + 模型 + 能力(流式/工具/上下文窗口)+ 成本档」收成一处。系统其余只向注册表要「一个能跑 messages 的 client」,**保持模型无关**:

- **接入形态不变**:DeepSeek-via-Anthropic 仍是「一个 `AsyncAnthropic(base_url, api_key)`」,只是从 7 处各自 `new` 收成注册表里 `provider="deepseek"` 的**一个**条目,各 service 改向注册表取。
- **可路由**:高风险/复杂任务走强模型,低风险任务路由更便宜模型(直接服务 NFR-05 成本治理 + PRD §11 LLM 抽象决策)。
- **可扩展**:未来接 Anthropic 原生 / OpenAI 兼容端点只是新增注册条目,`auto_agent` / `llm_agent` 不动。
- **预算挂钩**:每个 provider 调用挂 token 计量,喂给 [`cost-governance.md`](../02-ai-engine/cost-governance.md) 的三级预算(用户/团队/任务)。

> 迁移成本可控但**面广**:7 个模块(`auto_agent` / `llm_agent` / `drive_comment_agent` / `meeting_agent` / `delivery_doc` / `task_decomposition` / `routers/assistant`)都要把模块级 `_client = AsyncAnthropic(...)` 改成 `client = registry.get(actor, task)`。调用点(`messages.stream` / `messages.create`)签名不变,改动是机械的;plan 阶段按这 7 个落点逐一领任务。

---

## 5. 单体 → daemon 重构步骤

> 目标:从「FastAPI 单进程全栈」的行为经验演进为「TS-first daemon + 瘦客户端」。**渐进式**,每步可独立验证、不破坏现有闭环(对应 PRD P0 地基阶段)。

### 5.1 步骤(建议顺序)

1. **搭 TS daemon 骨架并剥离前端托管**。新建 `apps/api`(Hono/Node);现有 `app/main.py` 的 `WEB_ROOT` 挂载与 `spa_fallback`(`main.py:469-498`)只作为迁移反例。daemon 只暴露 `/api`、`/downloads`、`/client`。web 独立部署。→ daemon 收敛为「纯核心」。
2. **统一事件契约 + 抽 broker 接口**。保留 `push_bus.py` 的 topic/event 语义(`all` / `req:<id>` / `user:<id>`),把 `PushBus` 抽象成接口;当前代码已支持内存与 Redis 后端,R2.3 固定 Redis 跨实例语义(§6.2)。客户端侧 `sse.rs` / `useReqStream` 不变。
3. **DB 切 PostgreSQL + Drizzle migrations**(§6)。这是解除单 worker 的前置。
4. **provider 注册表落地**(§4),把 `auto_agent`/`llm_agent` 行为迁成 TS provider adapters。
5. **AgentRun 出请求进程,进可 claim 的队列**。现状 AI 任务是 FastAPI 进程内的 `asyncio.create_task`(`auto.py` 后台任务、`main.py:_resume_stuck_jobs` 的崩溃恢复扫描)。TS daemon 化后改为「daemon 收请求 → 投递 AgentRun 到 DB-backed queue → worker 通过 claim/lease 执行」,使 web/API 与长跑 Agent 解耦,worker 可水平扩展。R2.1-R2.6 已把崩溃恢复语义落为 PostgreSQL claim/lease、interval heartbeat、`requeueExpiredClaims()` 与 daemon recovery scheduler；后续若引入 Redis/BullMQ 等 durable queue，也必须保留 DB 作为 run 状态真相源。
6. **OpenAPI 契约固化 + 类型化客户端生成**。Hono route + Zod schema 生成 OpenAPI;`packages/api-client` 由 OpenAPI 生成,web + 桌宠共用(详见 [api-contract](./api-contract.md))。

### 5.2 不变量(重构期间必须守住)

- **闭环不能断**:`intake→澄清→执行→交付→验收/打回` 任何一步在迁移期都要可跑(对应现状 `lifecycle.py` 通知中枢的四个 status 变更站点)。
- **设备令牌门不能破**:接活/干活仍走 `require_local_client`(`auth.py:183`),浏览器只能派活/审批。
- **按身份隔离不能丢**:私有事件按用户隔离(`push.py` 的 `/stream/me` 用 `user:{id}` topic、`stream_one` 的 `can_view_requirement_record` 门),迁 broker 时这条隔离要原样带过去(NFR-08)。

### 5.3 客户端瘦身(C-WEB / C-PET / C-UIKIT)

- **C-UIKIT(`@yqgl/shared`)**:已是 web+tauri 共用的 API client + hooks + tokens(`shared/src/api/client.ts`、`hooks/useReqStream.ts`、`design/tokens.css`)。WorkHub 让它成为「OpenAPI 生成类型 + SSE 订阅 hooks + 设计 tokens」的唯一来源。
- **C-PET(Tauri)**:Rust 侧 `sse.rs`(双流 + 退避)、`spec_watch.rs`、`reminders.rs`、`tray.rs`、`deep_link.rs`、`upload.rs` 全部复用;新增桌宠窗口与本地 Agent 能力(详见 `05-clients/desktop-pet-tauri.md`)。
- **C-WEB**:页面/路由复用,数据层切到 OpenAPI client。

---

## 6. SQLite → PostgreSQL 迁移 + 解除单 worker

> 这是 NFR-01(逃离 SQLite 单 worker 天花板)与 D-2 的核心。两件事必须一起做:**换 DB** 解除「单写者」,**抽 broker** 解除「进程内单例」。只换一个不够。

### 6.1 为什么 SQLite 撑不住(现状证据)

- **单写者**:`db.py:22-39` 现状靠 `PRAGMA journal_mode=WAL` + `busy_timeout=5000` 缓解 `database is locked`——注释直言「the single-writer SQLite default produces `database is locked` errors under realistic concurrent polling」。WAL 让读不阻塞写,但**写仍串行**。多 Agent 并发写、业务对象合并需要的**行级锁**,SQLite 给不了。
- **必须单 worker(真正的天花板)**:`systemd/yqgl-web.service` 与 `DEPLOY.md:97` 都明确——`--workers 1` **是强制项不是容量选择**。原因是**进程内单例**:
  - `services/push_bus.py` 的 SSE 总线(worker A 发的事件到不了连 worker B 的客户端,且静默无报错);
  - `services/presence.py` 的在线状态表;
  - AI 澄清的并发槽 / 后台任务去重状态。

  > 即:就算 DB 能并发,只要这些单例还在进程内,加 worker 就脑裂。所以「解除单 worker」= **换 DB(行级锁)+ 把进程内单例搬到共享 broker**,缺一不可。

### 6.2 解除单 worker:进程内单例 → 共享 broker

| 进程内单例 | 现状文件 | 迁移目标 |
|---|---|---|
| SSE pub/sub | `push_bus.py`(`dict[str, list[Queue]]`) | **Redis pub/sub**(DEPLOY.md:97 点名的方案)。R2.3 已落 v0:topic 语义不变,publish 进 Redis,各 worker 订阅 → 转发给本地 SSE 连接 |
| 在线状态 | `presence.py` | Redis(key + TTL)。R2.3 已落 v0:`presence:lastseen:*` 与 `presence:streams:*` 跨实例可见 |
| 任务去重 / 并发槽 | `auto.py` / 后台任务状态 | R2 当前用 PostgreSQL partial unique index + `FOR UPDATE SKIP LOCKED` claim/lease 做真相；Redis 可作为后续分布式锁 / 计数 / durable queue 加速层，但不能替代 DB run ledger |

完成后 daemon 可 `--workers N`,AgentRun worker 可独立水平扩展。

### 6.3 DB 迁移步骤

1. **`database_url` 切 PG**:`config.py:9` 默认值与 `.env` 改为 `postgresql+psycopg://…`。`db.py:8` 已有 `connect_args = {} if not sqlite`、`db.py:22` 的 `startswith("sqlite")` 分支会自动跳过 WAL PRAGMA(那是 SQLite 专属)——**`db.py` 几乎零改动即支持 PG**,这是当初埋的伏笔。补一个 `pool_size`/`max_overflow` 配置即可。
2. **引入 Drizzle Kit,弃用运行时 `create_all`+ALTER**:把 `services/schema_migrations.py` 的 idempotent ALTER 字典(`REQUIREMENT_COLUMNS` / `USER_COLUMNS` / `PROJECT_COLUMNS` …)翻译成 `packages/db/src/schema/*` + 首版 SQL migration;删 `main.py:251-252` 的 `create_all` + `ensure_runtime_schema` 行为。多 Agent 并发写 PG 上,schema 必须版本化、可回滚。
3. **类型审校(SQLite→PG 差异)**:
   - **布尔**:`is_admin` 现状 `BOOLEAN DEFAULT 0`(SQLite 把 bool 存成 0/1),PG 是真 `boolean`,SQLAlchemy `Boolean` 类型透明处理,但裸 SQL 的 `DEFAULT 0` 要改 `DEFAULT false`。
   - **时间**:`DATETIME` → PG `timestamp`;现状大量 `datetime.utcnow()`(naive UTC),迁移时统一 `timestamptz` 口径,避免跨用户时区歧义。
   - **大小写 / 排序**:PG 区分大小写且默认排序规则不同;昵称唯一性(LAN 身份)要确认 `citext` 或显式 `lower()` 唯一索引。
   - **JSON**:现状 `content_json` 等 TEXT 存 JSON 字符串(`llm_agent.py` 手动 `json.loads`),PG 可升级为 `jsonb`(可索引/可查询),作为后续优化非必须。
4. **数据搬迁**:LAN-first MVP 多为**新仓重建**(PRD §7「新仓库重建,但概念上是现有实体的演进」),不强制带历史数据。若需迁老库:导出 SQLite → 转换脚本(处理上述类型差异)→ 灌 PG。软删除范式(`deleted_at`)原样保留。
5. **并发原语落地(换 DB 的目的)**:业务对象合并(Branch/Proposal,见 [branch-proposal-merge](../03-collaboration/branch-proposal-merge.md))用 `SELECT … FOR UPDATE`(行级锁)或乐观锁(version 列);`db.py` 注释里早写好的 `pool_pre_ping` 在 PG 下才真正生效(SQLite 上是 no-op)。

---

## 7. 现有 → 新仓逐项迁移清单(复用 / 改造 / 新建)

> 图例:♻️ **复用**(基本原样搬) · 🔧 **改造**(搬过来要改) · ✨ **新建**(WorkHub 全新)。
> PRD §7 / §17.2 已给实体级锚点,本表给**代码资产级**映射,供 plan 阶段直接领任务。

### 7.1 后端核心(`app/`)

| 资产 | 现状文件 | 处置 | 改造要点 / 去向 |
|---|---|---|---|
| AI 工人 loop | `services/auto_agent.py`(`run_auto` tool_use loop、`MAX_TURNS=15`、`TOTAL_TIMEOUT_DEFAULT`) | 🔧 | 升级为通用 AgentRun 引擎:控制信号 `continue/stop/compact/escalate`、doom-loop 检测、超预算结构化交接(PRD §8.1)。工具系统抽成 `{id,desc,schema,execute}` 注册表,按 actor 权限过滤(详见 [agent-loop-and-tools](../02-ai-engine/agent-loop-and-tools.md))。 |
| 工具集 + 沙箱 | `auto_agent.py`(`list/read/write/mkdir/move/delete/run_command/zip/submit`、`_safe_path`、`_sandbox_rlimits`、`ALLOWED_COMMANDS`、`MAX_SANDBOX_*`) | ♻️ | 沙箱(path 限制 / rlimit / 命令白名单 / 文件大小上限)原样复用,是已验证的安全资产。 |
| LLM 判分 | `auto_agent.py:544` `llm_review`(返回 `(meets_requirement: bool, reason: str)`) | ♻️🔧 | 复用为升级触发器①「不合格」的信号源;接入 ConfidenceRecord(详见 [confidence-risk-escalation](../02-ai-engine/confidence-risk-escalation.md))。 |
| 澄清 agent | `services/llm_agent.py`(`step` 流式、`ask_choice/ask_open/summarize` 契约、JSON 容错) | ♻️ | intake→澄清→规格(README)阶段复用。 |
| LLM client(7 处) | `auto_agent.py:34`、`llm_agent.py:24`、`drive_comment_agent.py:12`、`meeting_agent.py:12`、`delivery_doc.py:23`、`task_decomposition.py:29`、`routers/assistant.py:29` 各自的 `AsyncAnthropic` | 🔧 | 7 处全部收进 provider 注册表(§4)。 |
| 生命周期通知中枢 | `services/lifecycle.py`(`_MILESTONES`、`queue_status_notifications`、`flush_status_notifications`) | ♻️🔧 | 「打回带理由回灌」「升级通知」挂在此扩展;现状已是「所有 status 变更通知收一处」的好模式。 |
| 状态机 | `models.Requirement`(status 字段 + `routers/requirements.py` PATCH /status) | 🔧 | 演进为 WorkItem 状态机(intake→ai_working→escalated→in_review→merged,PRD §7.1),新增分级/升级转移(详见 [data-model](./data-model.md))。 |
| 权限检查 | `services/permissions.py`(`can_view/claim/work_requirement`、admin 短路) | 🔧 | 关系级检查复用;升级为分层 allow/deny/**ask** 策略(`org→workspace→role→session`,PRD §8.6,详见 [security-and-permissions](./security-and-permissions.md))。 |
| 鉴权 + 设备令牌门 | `app/auth.py`(`issue_cookie`、`require_stream_user`、`require_local_client`、`hash_client_token`)、`models.ClientDevice` | ♻️ | LAN 昵称身份 + 设备令牌门原样保留;Org/RBAC 为 P5 叠加。 |
| SSE 总线 + 路由 | `services/push_bus.py`、`routers/push.py`(`/stream{,/me,/req/{id}}`) | 🔧 | 事件契约复用;R2.3 已落 Redis pub/sub/presence v0(§6.2)。按身份隔离(`user:{id}` topic + `can_view` 门)必须带过去,R2.4 已收 `all` admin-only,R2.5 已接默认 WorkItem/Proposal topic resolver。 |
| 交付 / 验收 | `models.Delivery`(按 round 版本化)、`routers/deliveries.py`、`delivery_upload.py`、`services/delivery_doc.py` | ♻️🔧 | Delivery 演进为 Proposal 的产物载体;打回循环对接 Review/Approval。 |
| 任务分解 / 排期 | `services/task_decomposition.py`、`schedule.py`、`routers/decompositions.py`、`planning.py`、`calendar.py` | ♻️🔧 | 喂 PM 模式(派活→拆解→排期→提醒,PRD §8.3)。 |
| 通知 / 提醒 | `services/notifications.py`、`routers/notifications.py`、`reminders.py`、`models.Notification/Reminder/Task` | ♻️ | M-NOTIFY 复用;桌宠呈现替代右下角弹窗。 |
| 知识库 | `services/knowledge.py`(grep 语料 `rebuild_knowledge_index`)、`routers/knowledge.py` | ♻️ | D-4:延续 grep + 强制引用,无向量库。 |
| 项目网盘 | `routers/project_drive.py`(74KB)、`comments.py`、`drive_comment_agent.py`、`services/sync_manifest.py` | ♻️🔧 | M-DRIVE 复用;文件树合并语义对接 Branch/Proposal(对象合并护城河)。 |
| 会议→洞察 | `routers/meetings.py`、`services/meeting_agent.py` | ♻️ | M-MEETING 复用(ASR→纪要→洞察→需求草稿)。 |
| 崩溃恢复 | `main.py:_resume_stuck_jobs`、`models.BackgroundJob`、`services/jobs.py` | 🔧 | R2.6 已落最小 TS 形态：running claim 超过 lease 后由 daemon recovery scheduler 调 `requeueExpiredClaims()` 回 `queued`，写 `agent_run.requeued_stale_claim` audit，并触发 `runNext()` drain；不是直接标 failed。 |
| Schema 迁移 | `services/schema_migrations.py`、`main.py:create_all` | 🔧→替换 | 翻译成 Drizzle schema + Drizzle Kit migration,弃用运行时 ALTER(§6.3)。 |
| 上传 / 分块 / 清理 | `services/partial_uploads.py`、`main.py:_periodic_partial_cleanup` | ♻️ | blob 上传 + 孤儿清理(近期 commit 修过的路径)复用。 |
| 配置 | `app/config.py`(pydantic-settings) | 🔧 | 翻译成 TS env schema,加 PG `pool_*`、provider 注册表配置、broker URL、预算配额默认值；R2.6 已新增 `AGENT_RUN_LEASE_MS`、`AGENT_RUN_HEARTBEAT_INTERVAL_MS`、`AGENT_RUN_RECOVERY_INTERVAL_MS`，默认值只在配置层定义，业务逻辑按 `settings.agentRun` 消费。 |

### 7.2 新建(WorkHub 命门,无现成代码)

| 新建资产 | 服务的 FR | 落点 |
|---|---|---|
| **ConfidenceRecord + 风险评分 + 分级裁决** | FR-ESC-001 | [confidence-risk-escalation](../02-ai-engine/confidence-risk-escalation.md) |
| **EscalationEvent + PM 模式编排** | FR-ESC-002 / FR-PM-* | [pm-mode-orchestration](../02-ai-engine/pm-mode-orchestration.md) |
| **Branch / Proposal + 对象合并** | FR-COLLAB-* | [branch-proposal-merge](../03-collaboration/branch-proposal-merge.md) |
| **分层 PermissionPolicy + 审批路由 + SLA** | FR-PERM-* | [security-and-permissions](./security-and-permissions.md)、`03-collaboration/review-and-approval.md` |
| **AuditLog + AI 副作用快照/revert** | FR-WORKER-004 / NFR-03/04 | `data-model` + AI 引擎篇 |
| **UserProfile + CollaborationGraph + 智能派活** | FR-STAFF-* | [smart-staffing](../02-ai-engine/smart-staffing.md) |
| **Org / Workspace 多租户骨架** | P5 | 预留,LAN-first 暂空 |
| **成本治理(三级预算 / 模型路由)** | NFR-05 | provider 注册表(§4)+ P-COST |
| **doom-loop / 控制信号 / 结构化交接** | FR-WORKER-003 / FR-ESC-004 | [agent-loop-and-tools](../02-ai-engine/agent-loop-and-tools.md) |

### 7.3 客户端(`client-tauri/` · `web/` · `shared/`)

| 资产 | 现状文件 | 处置 |
|---|---|---|
| Tauri SSE 双流 + 退避 | `client-tauri/.../sse.rs` | ♻️ |
| spec_watch(本地 spec 文件夹 ↔ 服务器、sha256、append-only) | `spec_watch.rs`(35KB) | ♻️ 双向同步地基 |
| 双向同步(现状仅下载占位) | `sync.rs:227`(`sync_drive_download` 注释「placeholder … single-direction download」) | 🔧 补齐双向(FR-SYNC-*) |
| 托盘 / 通知 / deep-link / 提醒 / 分块上传 | `tray.rs`、`notify.rs`、`deep_link.rs`、`reminders.rs`、`upload.rs`、`operation_locks.rs` | ♻️ |
| 桌宠窗口 + 本地 Agent + 人格 | — | ✨(`05-clients/desktop-pet-tauri.md`) |
| 共享 API client / types / hooks / tokens | `shared/src/api/*`、`hooks/use*Stream.ts`、`design/*` | ♻️🔧 升级为 OpenAPI 生成(§5.3) |
| Web SPA(派活/管理/审批/看板) | `web/src/*`(Vite) | ♻️🔧 数据层切 OpenAPI client |
| 旧版 Python 托盘客户端 | `client/yqgl_tray.py`(59KB)、`yqgl_dashboard.py` | ⛔ 弃用(被 Tauri 桌宠取代) |

---

## 8. 迁移顺序与风险(收口)

**建议落地顺序**(对应 PRD P0 地基阶段,每步可独立验证):

1. 新仓搭骨架(pnpm workspace + Hono API + Drizzle + Tauri + shared contracts),移植实体与认证行为;
2. **DB 切 PG + Drizzle migrations**(§6.3)——解除单 worker 的前置;
3. **抽 broker(Redis)**(§6.2)——R2.3 已完成 Redis PushBus / Presence v0,daemon 多 worker 的事件/在线状态不再只依赖进程内单例;
4. **TS provider 注册表**(§4)——接入 DeepSeek/Anthropic-compatible endpoint;
5. **剥离前端托管 + AgentRun 入队**(§5.1)——daemon 收敛为纯核心;
6. 在复用件之上叠 P1 命门(置信度/风险/升级/回灌/快照,§7.2)。

**主要迁移风险**:

| 风险 | 缓解 |
|---|---|
| 只换 DB 不抽 broker → 加 worker 仍脑裂 | §6.2 两件事必须一起做(DEPLOY.md:97 已点名 Redis) |
| 运行时 ALTER 习惯带进多 Agent PG → schema 漂移 | 强制 Drizzle migrations,删 `create_all`(§6.3) |
| SQLite→PG 类型差异(bool/时间/大小写)静默出错 | §6.3 步骤 3 逐项审校;naive UTC → `timestamptz` |
| 按身份事件隔离在迁 broker 时丢失 → 跨用户泄漏(NFR-08) | §5.2 不变量;`user:{id}` topic + `can_view` 门原样带过去 |
| daemon 化打断现有闭环 | 渐进式重构,每步保闭环可跑(§5.2) |

---

*下一篇:DB 切换与 broker 抽象的具体改动顺序在 plan 阶段展开;实体字段与状态机全转移见 [data-model](./data-model.md),路由组与事件类型见 [api-contract](./api-contract.md)。*
