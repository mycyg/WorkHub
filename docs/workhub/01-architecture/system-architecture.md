---
module: 01-architecture
layer: 平台底座 (Platform / Cross-cutting)
status: 🚧
owner: workflow
---

# 系统架构（daemon + clients）

> 本篇是 WorkHub 的**架构级总图**:进程/服务边界、组件图、数据流、部署拓扑,以及「需求管理大师」单体 → headless agent daemon 的逐项切分清单。
> 上游:[PRD §11 技术架构方向](../../prd/2026-06-04-workhub-prd.md) · [规格树索引(三端一核)](../README.md)。
> 横向引用:实体与状态机见 [`data-model.md`](./data-model.md);路由组、事件类型清单、鉴权中间件的接口级细节见 [`api-contract.md`](./api-contract.md);选型与逐文件迁移见 [`tech-stack-and-migration.md`](./tech-stack-and-migration.md);威胁模型与设备令牌门见 [`security-and-permissions.md`](./security-and-permissions.md);术语(daemon / 瘦客户端 / 工作副本 等)以 [`glossary-dejargon.md`](../00-overview/glossary-dejargon.md) 为权威。本篇不重复这些细节,只给「形状」。

---

## 0. 一句话与三条架构地基

**WorkHub = 一个 headless agent daemon(唯一真相源 + AI 引擎)+ 若干瘦客户端(web / 桌宠)+ 一条事件流。** 客户端不含业务逻辑;权限询问、AI 进度、产出结果都是**事件流上的一等公民**。

落定本篇的三条地基决策(来自 PRD §15,本篇视为既定前提):
- **D-1**:不重写,**迁移**现有 FastAPI/SQLAlchemy/Tauri 地基入新仓再演进 —— 复用已验证的状态机、`auto_agent`、`lifecycle`、`spec_watch` 与安全模型。
- **D-2**:数据库 **SQLite → PostgreSQL**,以支撑多 Agent + 多人并发与业务对象合并所需的行级锁/乐观锁。
- **D-3**:**LAN-first MVP + 云就绪架构**;延续**设备令牌门**(接活/干活需桌面客户端);多租户公网延到 P5。

> 现状基线(为何要切分):今天的 `app/main.py` 是**单进程 FastAPI 单体** —— 路由、AI 执行(`auto_agent` 以 `asyncio.create_task` 在请求进程内跑)、知识库重建、崩溃恢复(`_resume_stuck_jobs`)、SSE(`push_bus`)全挤在一个 uvicorn worker 里。`app/db.py:8` 的 `check_same_thread=False` + WAL 注释明说「single-writer SQLite 默认」。这是 PRD §2.2「并发天花板」的根因,也是切分的起点。

---

## 1. 进程 / 服务边界(谁是谁)

WorkHub 把今天的单体拆成**一个核心进程 + 三类外围**,边界以「谁拥有真相、谁能跑 AI、谁能持久化」划分:

| 边界 | 代号 | 进程形态 | 拥有什么 | 现状对应 |
|---|---|---|---|---|
| **Agent Daemon(核心)** | C-DAEMON | 长驻服务进程(FastAPI/ASGI) | 业务真相、状态机、权限/审批、事件总线、API 契约 | 演进自 `app/`(去掉「在请求进程里跑 AI」) |
| **Agent Runner(执行)** | C-DAEMON 内的执行域 | daemon 内的 worker(MVP)→ 可抽出独立进程池(P1+) | AgentRun 生命周期、工具调用、沙箱、预算、快照 | 演进自 `services/auto_agent.py` |
| **PostgreSQL** | — | 独立 DB 服务 | 全量持久化、行级锁、合并并发控制 | 替换 `sqlite:///…`(`app/config.py:9`) |
| **Web 客户端** | C-WEB | 浏览器 SPA(React/Vite) | 仅视图 + 订阅;无业务逻辑 | 演进自 `web/`(今天已是瘦的) |
| **桌宠客户端** | C-PET | Tauri v2(Rust 壳 + webview) | 桌宠入口、本地文件同步、托盘/通知/deep-link、设备令牌持有者 | 演进自 `client-tauri/` |
| **外部能力** | — | 各自独立服务 | LLM(provider)、ASR、TTS | `llm_base_url` / `asr_base_url` / `tts_base_url`(`app/config.py:22-31`) |

### 1.1 核心切分:Daemon 持真相,Runner 干活,客户端只渲染

**今天的问题**:`auto_agent` 的 `run` 直接在 FastAPI 请求线程派生的 asyncio task 里执行 LLM tool-loop(`services/auto_agent.py` 顶部注释:「Runs as an asyncio task in the FastAPI process」)。一旦进程崩溃,留下 `ai_processing` / `delivery_doc_pending` 的孤儿,要靠 `app/main.py:102 _resume_stuck_jobs` 在启动时扫尾。这套「进程内跑 + 启动扫孤儿」在单 Agent 勉强成立,多 Agent 必然撑不住。

**WorkHub 的边界**:
- **Daemon** 只做「裁决 + 编排 + 持久化 + 推事件」:接 API、跑状态机、写 PostgreSQL、对工具的高风险动作发审批(阻塞原语)、把进度/结果 publish 到事件总线。
- **Runner**(AgentRun 执行域)做「按预算跑 tool-loop」:沿用 `auto_agent` 的循环骨架与沙箱/预算常量(`MAX_TURNS=15`、`TOTAL_TIMEOUT_DEFAULT`、`MAX_SANDBOX_FILES/BYTES`、`ALLOWED_COMMANDS`),但
  - **MVP**:仍作为 daemon 内的受控 worker(asyncio task / 进程池),由一张 `AgentRun` 表(演进自 `BackgroundJob` 的 running/恢复语义)显式拥有生命周期 —— 把今天的「无主 finalize task」(见 `app/main.py:176` 注释,`_finalize_doc` 不挂 `BackgroundJob`)收编为「每个 AgentRun 必有行」。
  - **云就绪**:Runner 的契约(输入 = WorkItem 上下文 + 工具菜单 + 预算;输出 = trace + 交付 + ConfidenceRecord)与 daemon 解耦,P1+ 可平移到独立进程/容器池,不改 API。
- **客户端** 不跑业务,只发请求 + 订阅事件 + 渲染。桌宠额外承担「本地文件同步」与「设备令牌门」(下文 §4)。

> AI 工人循环、控制信号、工具契约、沙箱、预算、doom-loop、快照的**机制细节**在 [`agent-loop-and-tools.md`](../02-ai-engine/agent-loop-and-tools.md);本篇只确立 Runner 是与 daemon **可分离的执行域**这一边界。

---

## 2. 组件图(文字版)

```
                            ┌─────────────────────────────────────────────┐
                            │            外部能力 (各自独立服务)            │
                            │  LLM provider(s)   ASR 服务      TTS 服务     │
                            │  DeepSeek-via-Anthropic / 模型无关 registry   │
                            └───────▲─────────────────▲──────────▲─────────┘
                                    │                 │          │
┌──────────────┐   HTTP/JSON       │                 │          │
│   C-WEB      │  (OpenAPI client) │                 │          │
│ React/Vite   ├───────────┐       │                 │          │
│ 派活/审批/看板│           │       │                 │          │
└──────┬───────┘           ▼       │                 │          │
       │ SSE      ┌─────────────────────────────────────────────────────────┐
       │ /event   │                    C-DAEMON (核心进程)                    │
       └─────────►│                                                          │
                  │  ┌────────────────────────────────────────────────┐    │
┌──────────────┐  │  │  API 层 (FastAPI 路由组, OpenAPI 契约)            │    │
│   C-PET      │  │  │  session·workitem·proposal·permission·event·sync │    │
│ Tauri v2     │  │  └───────────────┬────────────────────────────────┘    │
│ Rust 壳+webview │  │  ┌─────────────▼──────────┐  ┌──────────────────────┐ │
│ 桌宠/托盘/同步 ├──┼─►│  鉴权中间件 (auth)       │  │  事件总线 (push_bus)   │ │
│ 设备令牌持有者 │  │  │  cookie + 设备令牌门 +   │  │  topic 化 pub/sub +   │ │
└──────┬───────┘  │  │  RBAC + 分层 permission  │  │  SSE/WS 网关          │ │
       │ SSE      │  └─────────────┬──────────┘  └──────────▲───────────┘ │
       │ /event   │  ┌─────────────▼──────────────────────────────────┐    │
       └─────────►│  │  编排域: 状态机 · lifecycle · 升级裁决            │    │
                  │  │  审批阻塞原语 · 智能派活 · PM 模式               │    │
                  │  └─────────────┬───────────────────────────────────┘   │
                  │  ┌─────────────▼──────────┐  ┌──────────────────────┐   │
                  │  │  Agent Runner (执行域)  │  │  后台周期任务         │   │
                  │  │  tool-loop · 沙箱 ·     │  │  knowledge reindex ·  │   │
                  │  │  预算 · 快照 · trace    │  │  partial cleanup ·    │   │
                  │  │  (可分离为进程池)        │  │  AgentRun 崩溃恢复     │   │
                  │  └─────────────┬───────────┘  └──────────┬───────────┘   │
                  └────────────────┼─────────────────────────┼──────────────┘
                                   ▼                         ▼
                            ┌──────────────────────────────────────┐
                            │            PostgreSQL                 │
                            │  业务真相 + 行级锁/乐观锁 + 软删除      │
                            │  + 快照/审计 + 事件去重               │
                            └──────────────────────────────────────┘
                            ┌──────────────────────────────────────┐
                            │   对象存储 (本地 data_dir → 云 blob)   │
                            │  uploads / deliveries / drive / spec  │
                            └──────────────────────────────────────┘
```

**读图要点**:
- **唯一入口是 API + 事件流**;所有客户端走同一组 OpenAPI 路由,经同一鉴权中间件,订阅同一事件总线。这正是 PRD §11「headless daemon + OpenAPI + SSE/WS + 类型化客户端」的落地。
- **鉴权中间件夹在 API 层与编排/执行域之间**(§3),是「设备令牌门 + RBAC + 分层 permission」的唯一关卡。
- **Runner 与 DB/对象存储相邻但与 API 解耦**:它的副作用(写交付、改业务对象)走快照 + 审计,经审批裁决才汇入 main。

---

## 3. 鉴权中间件位置(请求穿过哪几道门)

鉴权是**一条贯穿 API 层的责任链**,位置在「路由解析之后、业务处理之前」。现有 `app/auth.py` 已经分好了层次,WorkHub 把它从「LAN/昵称」演进为「身份 + 设备 + 角色 + 策略」四道门,但**位置不变**:

```
请求 → [CORS] → [身份门] → [设备令牌门] → [RBAC/资源门] → [分层 permission/审批] → 业务处理
```

| 门 | 职责 | 现状对应(逐项映射) | WorkHub 演进 |
|---|---|---|---|
| **身份门** | 解析 who | `current_user` / `optional_current_user`(`auth.py:104/130`):cookie(`itsdangerous` 签名)**或** `X-YQGL-Client-Token` worker token | 保留双通道;Org/Workspace 上下文注入(多租户预留) |
| **设备令牌门** | 高权限操作必须来自注册桌面设备 | `current_client_device` / `require_local_client`(`auth.py:172/183`)校验 `ClientDevice.client_token_hash`,未注册 → 403「local client required」 | **延续**(D-3):接活/干活/同步类路由挂此门;派活/审批走浏览器 |
| **RBAC / 资源门** | who 能否操作该资源 | `services/permissions.py` 的 `can_view_/can_claim_/can_work_requirement` 等 + `is_admin` 短路 | 演进为 Org→Workspace→Role 的 RBAC + 资源级检查 |
| **分层 permission / 审批** | 工具在「该决策那一刻」allow/deny/ask | (新增)借鉴 opencode:`org→workspace→role→session` 合并,默认 `ask` | 见 [`security-and-permissions.md`](./security-and-permissions.md) / [`review-and-approval.md`](../03-collaboration/review-and-approval.md) |

**流式连接的特殊门**:长连(SSE/WS)不能整条请求握着 DB session(否则在 SQLite 上直接锁死、在 PG 上白占连接池)。现有 `require_stream_user`(`auth.py:202`)已经示范了正确姿势 —— 用一个**轻量 `StreamUser`(只含 id + nickname)**做鉴权,permission 检查用一个**短命 session**(见 `app/routers/push.py:77` 的 `stream_one`:开 session 查 `can_view_requirement_record` 后立刻 `db.close()`,再交给长连生成器),之后生成器**不持有任何 DB 资源**。WorkHub 把这条「流式鉴权 = 轻身份 + 短命权限检查 + 无状态生成器」**升级为事件网关的统一规范**(§5)。

> 鉴权中间件的**逐路由清单**与依赖注入签名归 [`api-contract.md`](./api-contract.md);本篇只钉「四道门的次序与位置」。

---

## 4. 部署拓扑(LAN-first → 云就绪)

### 4.1 LAN-first MVP(P0–P4 主形态)

```
┌─────────────────────────── 局域网 ───────────────────────────┐
│                                                               │
│   [负责人/提交者浏览器] ──┐                                    │
│   [管理员浏览器]        ──┤  http(s)://lan-host               │
│                          ▼                                    │
│   ┌──────────────────────────────────────────────────┐       │
│   │            单机/单 LAN 主机 (server box)           │       │
│   │  ┌────────────┐  ┌──────────────┐  ┌───────────┐  │       │
│   │  │ Agent Daemon│  │ PostgreSQL   │  │ 对象存储   │  │       │
│   │  │ (ASGI)      │──│ (本机/同网)   │  │ data_dir  │  │       │
│   │  │ + Runner    │  └──────────────┘  └───────────┘  │       │
│   │  └─────┬───────┘                                   │       │
│   │  静态托管: /assets (web/dist) · /downloads (安装包) │       │
│   └─────────┼──────────────────────────────────────────┘      │
│             │ SSE + HTTP                                       │
│   [桌宠客户端 × N] ── 持设备令牌,接活/干活/本地同步           │
│                                                               │
│   外部能力(可同机或同网 GPU 盒): LLM provider · ASR · TTS    │
└───────────────────────────────────────────────────────────────┘
```

- **延续现有部署形状**:今天 daemon 已自带静态托管(`app/main.py:469` 挂 `/srv/yqgl/web/dist`,`:340` 挂 `/downloads` 安装包,`:474` SPA fallback)。WorkHub 保留「单主机一把梭」的 LAN 体验。
- **关键变化**:DB 从「daemon 进程内的 SQLite 文件」变为「同网 PostgreSQL 服务」。daemon 不再被 `check_same_thread` / 单 writer 绑死,可起**多 worker**;Runner 可与 API worker 分属不同进程。
- **数据目录**:`app/main.py:239` lifespan 建的 `uploads/voice/outputs/project_drive/deliveries/auto` 等子树原样保留为「对象存储」抽象的本地实现,云就绪时换 blob 后端(已有 P0 的 blob-path 清理/孤儿守护机制,见近期 commit 历史)。

### 4.2 云就绪(P5 多租户)

同一套二进制、同一组 API,只换**部署形态与后端**:
- Daemon 多副本(无状态,真相在 PG)置于负载均衡之后;Runner 池水平扩展。
- PostgreSQL 托管化(主从/连接池),对象存储换云 blob,事件总线在多副本下需从「进程内 pub/sub」升级为**外部 broker**(§5.3)。
- **威胁模型从「可信局域网」重审**(PRD NFR-02):公网下设备令牌门、CORS(`app/main.py:232` 已禁止生产用 `*`)、cookie secret(`_validate_runtime_config` 已强制非默认)等全部收紧。详见 [`security-and-permissions.md`](./security-and-permissions.md)。

---

## 5. 事件流(SSE/WS、topic 与隐私隔离)

### 5.1 总线模型(直接复用 push_bus 的形状)

现有 `services/push_bus.py` 是一个**进程内 topic 化 pub/sub**:每个订阅者一条 `asyncio.Queue(maxsize=256)`,`publish(topic, type, data)` 扇出,满队列直接丢(慢订阅者降级),`stream()` 用 30s 心跳保活 SSE。WorkHub 把这套模型**原样升级为「事件网关」的内核**,并固化 topic 命名规范。

### 5.2 topic 体系(命名空间 = 隐私边界)

topic 既是路由键,也是**隐私隔离边界**。现状已有三类(`app/routers/push.py`):

| topic 模式 | 范围 | 现状端点 | 隐私语义 |
|---|---|---|---|
| `all` | 全局非 PII | `GET /api/push/stream` | 谁都能订;只发 `requirement.ready/.updated` 一类组织级非敏感事件 |
| `req:<id>` | 单工单 | `GET /api/push/stream/req/{id}` | **订阅前**经 `can_view_requirement_record` 鉴权(见 `push.py:84`),防止偷看 draft/clarifying 私有工单 |
| `user:<auth_user_id>` | 单用户私有 | `GET /api/push/stream/me` | topic 取**鉴权得到的 user.id**,非 path 参数 —— 客户端无法请求别人的流(`push.py:99` 注释) |

> 这条「私有事件按身份隔离」是 PRD NFR-08 的硬约束。代码注释(`client-tauri/.../sse.rs:6-10`)记录过一次真实事故:早期把通知扇出到 `all`,导致每个客户端收到所有人的通知;修复 = 拆 `user:<id>` 专流。WorkHub **以此为戒**,新增 topic 一律先问「谁能订」。

WorkHub 在此基础上扩展(具体清单归 [`api-contract.md`](./api-contract.md) 的「事件类型清单」),按业务对象与并发主体分层,示意:
- `workitem:<id>` —— 状态机流转、ConfidenceRecord、EscalationEvent(演进自 `req:<id>`)。
- `agentrun:<id>` —— AI 工人 trace 逐步推送(演进自 `auto_agent` 现在 publish 的 `ai.*` 事件,见 `auto_agent.py:507` 的 `ai.done`)。
- `proposal:<id>` —— 提议的审批/打回/合并事件。
- `permission:<approver_id>` / `user:<id>` —— 审批请求路由到该批的人、私有通知。
- `org:<id>` / `workspace:<id>` —— 组织/工作区级看板事件(替代过去滥用的 `all`)。

### 5.3 SSE vs WS,以及多副本下的总线

- **SSE 为主**:现有全链路(daemon `text/event-stream` ↔ Tauri `sse.rs` 字节级 SSE 解析 ↔ web `EventSource`)已验证,**MVP 不引入 WS**。SSE 单向够用:服务端推、客户端发动作走普通 HTTP API。审批询问也是「事件(ask)下行 + HTTP(答复)上行」。
- **WS 预留**:仅当出现真正双向低延迟需求(如桌宠的实时语音/打字回显)时局部引入,不替换 SSE 主干。
- **多副本(P5)的总线**:进程内 `push_bus` 在 daemon 多副本下会「事件只到达产生它的那台」。云就绪时把 publish/subscribe 后端换成**外部 broker**(如 Redis pub/sub / PG `LISTEN/NOTIFY`),`stream()` 与 topic 契约不变 —— 这正是「核心架构与部署形态解耦」的价值。

---

## 6. 关键数据流(三条主路径)

### 6.1 AI 工人执行(J2 主路径:AI 默认干完)

```
提交者(web/桌宠) ──POST 工单──► API 层
   └─► 鉴权门 → 状态机: intake → ai_clarifying → spec_ready → ai_working
        └─► 编排域 创建 AgentRun(有预算上限) ──► Agent Runner
               └─ tool-loop(沙箱内 read/write/run_command/…),每步:
                    · 副作用前打快照(可回滚)
                    · publish agentrun:<id> 进度事件 ──► SSE ──► 客户端实时渲染
               └─ 产出交付 → llm_review 判分 + 验收清单命中 → ConfidenceRecord
        └─► 升级裁决:
              · 高置信+低风险 → 生成 Proposal →(策略)合并 main
              · 中档 → human_spotcheck(审批阻塞原语,推 permission/user 事件)
              · 低/高风险/卡住 → EscalationEvent → 转 PM 模式
        └─► 写 PostgreSQL(状态+快照+审计) → publish workitem:<id> ──► 通知提交者
```

> 这条路径**复用**了 `auto_agent.run`(tool-loop)+ `llm_review`(`auto_agent.py:544`,PRD 的「不合格」触发器之一)+ `lifecycle.queue_status_notifications/flush_status_notifications`(`services/lifecycle.py`:在 `db.commit()` 后才 publish SSE,保证「通知与状态变更同事务、推送不阻塞成功的状态变更」)。

### 6.2 审批阻塞(分层 permission + 路由)

```
Runner 触到高风险工具 ──► 编排域查分层策略(org→workspace→role→session)
   └─ 命中 ask → 创建审批请求(阻塞该 AgentRun)
        └─► 审批路由:按角色/负责人决定「谁该批」→ publish permission:<approver>
              └─► 该批的人(web/桌宠)收事件 → HTTP 回复 allow/deny(+理由)
        └─ allow → Runner 续跑;deny(带理由)→ 理由回灌为下一步上下文(自我纠偏)
```

### 6.3 桌宠本地双向同步(替换今天的「只下载」占位)

```
桌宠(C-PET, Rust 侧 spec_watch/sync) ──► daemon 同步 API
   现状:sync.rs:227 sync_drive_download 明注「placeholder: 单向下载」
   WorkHub:复用 spec_watch.rs 的 sha256 去重 + append-only manifest,
            升级为双向:本地变更 ──提议──► daemon;冲突 → AI 调解 → 人择一
```

> 同步协议、冲突解决、离线合并、README=规格活文档的细节归 [`sync-and-spec.md`](../03-collaboration/sync-and-spec.md);本篇只钉「同步是桌宠↔daemon 的数据流,且从单向升级为双向」。

---

## 7. 现有单体 → daemon 迁移清单(逐项映射)

> 原则(D-1):**移植 + 重构**,不重写。下表是「现状 → WorkHub 形态」的逐项切分;**复用映射的逐文件粒度**(哪个 `.py`/`.rs` 落到新仓哪个模块)归 [`tech-stack-and-migration.md`](./tech-stack-and-migration.md),本篇给「差异与切分」的架构判断。

| # | 现状(单体) | 现状代码锚点 | WorkHub 形态 | 切分动作 / 差异 |
|---|---|---|---|---|
| M1 | FastAPI 单体应用 + 全部路由 `include_router` | `app/main.py:270-305` | C-DAEMON 的 API 层,按业务域重组路由组 | **保留** FastAPI/ASGI;路由按 session/workitem/proposal/permission/event/sync 重切;OpenAPI 契约显式化 |
| M2 | AI 在请求进程内跑(asyncio task) | `services/auto_agent.py`(顶部注释) | 抽出 **Agent Runner 执行域** | MVP 仍在 daemon 内但由 `AgentRun` 表显式拥有;契约与 API 解耦,云就绪可平移进程池 |
| M3 | 崩溃恢复靠启动扫孤儿 | `app/main.py:102 _resume_stuck_jobs` + `:176` 无主 finalize 注释 | **每个 AgentRun 必有持久行**,生命周期显式 | 收编「无主后台 task」;恢复从「猜哪些卡住」变为「按 AgentRun 状态精确恢复」 |
| M4 | SQLite 单 writer + WAL/busy_timeout 补丁 | `app/db.py:8-39` | **PostgreSQL** | 删 `check_same_thread`/SQLite PRAGMA 分支;`pool_pre_ping` 注释(`db.py:14`)早已为换库埋点;启用多 worker;行级锁/乐观锁支撑对象合并 |
| M5 | 进程内 SSE pub/sub(每订阅一队列,满则丢) | `services/push_bus.py` | **事件网关内核**(同形状) | 形状不变;多副本(P5)换外部 broker,topic 契约稳定 |
| M6 | SSE 路由 + topic(all / req / user) | `app/routers/push.py` | 事件网关路由,扩 topic 体系(workitem/agentrun/proposal/permission/org) | **保留**「订阅前鉴权 + 私有事件按身份隔离」;清退 `all` 滥用(见 sse.rs 事故注释) |
| M7 | cookie + worker-token 双通道鉴权 | `app/auth.py:104/172/202` | 身份门 + 设备令牌门(延续) | **保留**双通道与 `require_stream_user` 轻身份模式;叠加 RBAC + Org/Workspace 上下文 |
| M8 | 设备令牌门(接活/干活需桌面端) | `auth.py:183` + `routers/client_devices.py` | **延续**(D-3 LAN-first 核心) | 不变;云就绪时在威胁模型下收紧 |
| M9 | 资源级访问检查 | `services/permissions.py` | RBAC 资源门 + 分层 permission/审批 | `can_view_/can_claim_/can_work` 演进为角色 + 策略;新增 allow/deny/ask 阻塞原语 |
| M10 | 生命周期通知(同事务建,commit 后推) | `services/lifecycle.py` | 编排域的通知/事件发射器 | **保留**「同事务 + commit 后 publish」铁律,扩到 Proposal/升级事件 |
| M11 | 业务实体 + 状态机 | `app/models.py`(Requirement 等) | C-DAEMON 领域模型(PG) | **演进**:WorkItem/Branch/Proposal/AgentRun/Confidence/Escalation/Permission;详见 [`data-model.md`](./data-model.md) |
| M12 | 后台周期任务(知识重建/清理) | `app/main.py:49/83`(`asyncio.to_thread` 卸载) | daemon 后台任务域 | **保留**「重活卸载到 worker 线程,别冻 event loop」的判断;多副本下需选主避免重复跑 |
| M13 | 静态托管 web/dist + 安装包下载 | `app/main.py:340/469/474` | LAN 部署的静态托管(保留) | 不变;云就绪时可移到 CDN/对象存储 |
| M14 | 配置(DB/LLM/ASR/TTS/CORS/cookie) | `app/config.py` + `_validate_runtime_config`(`main.py:227`) | daemon 配置 + **provider registry** | DeepSeek-via-Anthropic 收进「模型无关 registry」;低风险任务路由廉价模型(成本治理) |
| M15 | Tauri 壳:SSE/同步/托盘/deep-link/spec_watch | `client-tauri/src-tauri/src/{lib,sse,sync,spec_watch,tray,deep_link}.rs` | **C-PET 瘦客户端** | **保留** Rust 侧能力;桌宠入口替代托盘弹窗;`sync.rs:227` 单向 → 双向 |
| M16 | web SPA(React/Vite) | `web/` | **C-WEB 瘦客户端** | 已是瘦的;接 OpenAPI 类型化 client + 统一事件订阅 |

**迁移的三个非显而易见的判断**:
1. **不动的资产最值钱**:`push_bus` 的「满队列丢 + 心跳」、`lifecycle` 的「同事务 + commit 后推」、`require_stream_user` 的「流式轻鉴权」、`auto_agent` 的沙箱/预算常量 —— 这些是踩过坑沉淀的契约,**原样移植**,别在迁移期重新发明。
2. **SQLite→PG 不是「换连接串」**:`db.py` 里大量 SQLite 专属补丁(WAL/busy_timeout/check_same_thread)与「绝不在请求里长握 writer 锁」的写法(见 `auth.py:94` 注释:为避免锁,`_user_from_worker_token` 故意不更新 `last_seen_at`)是为 SQLite 单 writer 设计的;迁到 PG 后这些约束放松,但**对象合并需要的行级锁/乐观锁是新增能力**,要在 data-model 层显式设计。
3. **「进程内跑 AI」是单 worker 的遗产**:它能成立完全依赖「只有一个 uvicorn worker」这一前提(`main.py:384` 注释明说「single-uvicorn-worker model」)。多 worker / 多副本一旦开启,AgentRun 的拥有权、恢复、事件路由都必须先收口,**这是 P0 地基阶段的第一道闸**。

---

## 8. 与其他文档的边界(避免重复)

| 想了解 | 看哪篇 |
|---|---|
| 实体字段、ER 图、WorkItem 状态机全转移、软删除/审计字段、行级锁/乐观锁 | [`data-model.md`](./data-model.md) |
| OpenAPI 路由组逐条、事件类型完整清单、鉴权依赖注入签名 | [`api-contract.md`](./api-contract.md) |
| 选型理由、逐 `.py`/`.rs` 文件复用映射、迁移工序 | [`tech-stack-and-migration.md`](./tech-stack-and-migration.md) |
| 威胁模型(LAN→云重审)、设备令牌门细节、RBAC、分层 permission 规则语义 | [`security-and-permissions.md`](./security-and-permissions.md) |
| AI 工人循环/控制信号/工具契约/沙箱/预算/doom-loop/快照 | [`agent-loop-and-tools.md`](../02-ai-engine/agent-loop-and-tools.md) |
| 双向同步协议、冲突解决、README=规格 | [`sync-and-spec.md`](../03-collaboration/sync-and-spec.md) |
| 术语权威定义(daemon / 瘦客户端 / 工作副本 / 提议 / 采纳) | [`glossary-dejargon.md`](../00-overview/glossary-dejargon.md) |

---

*本篇定位:架构「形状」的单一来源。接口级 → `api-contract.md`;数据级 → `data-model.md`;迁移工序级 → `tech-stack-and-migration.md`。*
