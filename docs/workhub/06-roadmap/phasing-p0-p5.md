---
module: 06-roadmap
layer: 全局 / 跨层(交付分期)
status: 🚧
owner: workflow
---

# 路线图:P0–P5 分期(Phasing)

> **范围**:把 WorkHub 从「需求管理大师」演进为 AI-native 工作中台的**交付分期**——每一期的范围、**进入/退出标准(entry/exit gate)**、**依赖**、以及**与模块(M-/P-)与客户端(C-)的对应**。
> **定位**:本篇是 PRD [§12 里程碑与分期](../../prd/2026-06-04-workhub-prd.md) 的**完备展开**。PRD §12 只给一张五行总表;本篇逐期落到「做哪些、靠哪些已有零件、做到什么程度算过、卡在哪些前置」。
> **上游**:[PRD §6 分层架构](../../prd/2026-06-04-workhub-prd.md)(L0–L5 首发阶段列)、[PRD §12](../../prd/2026-06-04-workhub-prd.md)、[规格树索引](../README.md)(三端一核 + 模块地图)。
> **同层交叉**:全量 FR 清单与可追溯矩阵见 [`functional-requirements.md`](./functional-requirements.md)(随后落定);本篇引用 FR 编号但不重复其验收细则。架构形状见 [`../01-architecture/system-architecture.md`](../01-architecture/system-architecture.md);实体/状态机见 [`../01-architecture/data-model.md`](../01-architecture/data-model.md);接口契约见 [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md)。
> **术语**:本篇用**内部技术术语**(daemon / Branch / Proposal / merge / escalation);对应用户用语以 [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md) 为权威。
> **扎根**:每期的「复用零件」「退出标准」均锚定现有真实代码(`app/`、`client-tauri/`、`web/`、`shared/`)与已落定的地基文档,严禁臆造。

本篇小节:

1. 怎么读这张路线图(分期模型、gate 语义、与 L0–L5 / FR 的关系)
2. 全局视图:六期一览 + 价值主线 + 关键路径
3. 跨期通用 gate(每期都必须满足的横切红线)
4. **P0 地基** —— 迁移 + daemon 化 + SQLite→PG
5. **P1 旗舰** —— AI 工人 + 升级闭环(反转的证明)
6. **P2** —— AI 项目经理 + 智能派活
7. **P3** —— 协作(分支-提议-合并)+ 双向同步 + README=规格
8. **P4** —— 桌宠 + web 对等(小白 UX)
9. **P5** —— 治理 + 多租户 + 成本治理
10. 依赖图与并行化建议(哪些能提前预研 / 并行)
11. 与 PRD §13 成功度量、§14 风险的对齐

---

## 1. 怎么读这张路线图

### 1.1 分期模型(为什么是 P0–P5 而非「全都要」)

PRD §3.1 北极星是「让团队绝大多数事由 AI 默认完成」,但 PRD §14「范围蔓延」风险与 §12 收尾那句**「P1 必须先把『反转』证明给真实用户看,再铺 P2–P5 的宽度」**钉死了节奏:

- **P0 是地基,不产生用户可见价值**——它只把单体拆成 daemon、把 SQLite 换成 PostgreSQL、把实体/认证移植过来。它的价值是「架构就位」,让后续 AI 多 Agent 并发成为可能(PRD `NFR-01` 逃离 SQLite 单 worker 天花板)。
- **P1 是旗舰,是整个产品的命题验证**——证明「AI 干、人把关」的角色反转(PRD §1)在真实用户那里立得住。P1 不过,P2–P5 全是空中楼阁。
- **P2–P5 是宽度铺开**——受阻换帽(P2)、多人并行(P3)、小白入口(P4)、规模治理(P5),逐层加宽,每层都依赖前层的地基。

> **一句话**:**纵深先于宽度**。先把一条需求「AI 默认干完 + 该升级时升级」打穿(P0+P1),再横向加人、加协作、加入口、加治理。

### 1.2 每期三个 gate 的语义

每期给三类判据,均**可验证、可追溯**:

| gate | 含义 | 判定方式 |
|---|---|---|
| **进入标准(entry)** | 开工前必须就位的前置(依赖 + 决策) | 列前置期/前置文档/前置决策(D-x)是否 `🔒` |
| **退出标准(exit)** | 做到什么程度算「这期过了」 | 锚定 FR 编号 + 可观测行为 + 真实代码落点;能 demo / 能跑测试 |
| **价值证明(proof)** | 这期对外证明了什么(对齐 PRD §13) | 一句可对客户演示的命题 |

> exit 标准刻意写成**行为级**(「能做到 X」)而非「写完某文件」,避免「代码写了但跑不通」的假完成(承袭现有工程纪律:见 `app/main.py:102` 的崩溃恢复、`app/routers/auto.py` 的原子 CAS——这些都是「行为正确」而非「代码存在」的体现)。

### 1.3 与 L0–L5 分层、FR 编号的对应

PRD §6 已给每层「首发阶段」,本篇按它落期(下表是 PRD §6 的转置视图):

| 分层(PRD §6) | 首发阶段 | 本篇对应章节 |
|---|---|---|
| **L2 执行层(AI 劳动力)** | **P1(旗舰)** | §5 |
| **L0 身份层** + **L1 编排层(AI PM)** | P2 | §6 |
| **L3 协作层** | P3 | §7 |
| **L4 入口层(桌宠+web)** | P4 | §8 |
| **L5 治理层** | P5 | §9 |
| (地基,非分层功能) | **P0** | §4 |

> 注意 **L2 先于 L0/L1**:这是 PRD 的有意安排——先证明 AI 能独立干活(L2/P1),再补「喂 AI 决策的身份画像」(L0)与「受阻组织人」(L1)。地基(P0)不属于任何业务层,它是承载所有层的底座。

FR 编号(`FR-<模块>-NNN`)在各期 exit 标准里直接引用,完整可追溯矩阵见 [`functional-requirements.md`](./functional-requirements.md)。

> **⚠️ 两个「P」是两条正交的轴,别混。** PRD 给每条 FR 标的 `(P0/P1/P2)` 是**重要性**(PRD §0:`P0=MVP 必须 / P1=重要 / P2=可延后`),回答「该不该做」;本篇的 **P0–P5 是交付分期**(PRD §12),回答「何时做、按什么顺序做」。二者字母撞车但含义无关——**本篇一律按 FR ID 引用、不抄 PRD 的重要性标签**,落期以「依赖关系 + L0–L5 首发阶段」为准。所以会出现「重要性 P0 的 FR 落在交付期 P5」这类正常情况,例如:`FR-PERM-001/002/004`(PRD 重要性 P0)因强依赖 P3 协作模型而落在**交付 P5**(§9);`FR-PM-001`(PRD 重要性 P0)因属 L1 编排层而落在**交付 P2**(§6);`FR-WORKER-001`(PRD 重要性 P0)作为旗舰落在**交付 P1**(§5)。看到这种「错位」不是矛盾,是两条轴的必然投影。

---

## 2. 全局视图:六期一览

### 2.1 六期总表(PRD §12 展开版)

| 期 | 主题 | 核心交付(FR 锚) | 主导客户端 | 主导模块/能力 | 价值证明(对齐 PRD §13) |
|---|---|---|---|---|---|
| **P0** | 迁移 + daemon 化 | 新仓;daemon+OpenAPI+SSE;SQLite→PG;实体+认证移植;provider registry | **C-DAEMON**(+ C-WEB/C-PET 回归) | 全平台底座(D-1/D-2/D-3) | 架构就位:多 worker 可起,AI 并发不再被单 writer 卡死 |
| **P1** | **AI 工人 + 升级闭环** | `FR-WORKER-001~004`、`FR-ESC-001~003`、`FR-EXPLAIN-001` | **C-DAEMON**(Runner)+ C-WEB(trace/确认) | **P-AI**(工人引擎/置信度风险/升级)、M-WORKITEM | **验证「AI 干、人把关」反转**:自治率 > 0、升级精准、可回滚 |
| **P2** | AI 项目经理 + 智能派活 | `FR-PM-001~003`、`FR-STAFF-001~005`、`FR-ESC-004/005` | C-WEB(派活确认/onboarding)+ C-DAEMON | **P-AI**(PM 模式/派活)、**P-IDENTITY** | 验证「受阻即换帽」:升级后 AI 自动找对人、人确认即推进 |
| **P3** | 协作 + 同步 | `FR-COLLAB-001~004`、`FR-SYNC-001~003`、`FR-SPEC-001/002` | **C-PET**(双向同步)+ C-WEB(审批) | **P-COLLAB**、M-DRIVE | 验证多人并行:各干各的、提议合并、撞车 AI 调解 |
| **P4** | 桌宠 + web 对等 | `FR-PET-001~004`、`FR-PERM-002`(审批入口) | **C-PET**(桌宠)+ C-WEB(对等) | L4 入口层、M-NOTIFY | 验证「小白也能用」:一句话驱动 Agent、零术语 |
| **P5** | 治理 + 多租户 | `FR-PERM-001~004`、`NFR-05`、多租户/云 | C-WEB(管理台)+ C-DAEMON(多副本) | **P-PERM/P-AUDIT/P-COST**、M-DASHBOARD | 规模化与护城河:RBAC、审批路由、成本治理、上云 |

### 2.2 价值主线(为什么这个顺序)

```
P0 地基就位 ──► P1 证明「AI 干人把关」(纵深打穿一条需求)
                   │
                   ├─► P2 受阻时 AI 换帽找人(把「升级」从死胡同变活路)
                   ├─► P3 多人/多 AI 并行不打架(分支-提议-合并 + 双向同步)
                   ├─► P4 小白用一句话驱动全功能(桌宠入口)
                   └─► P5 规模化:谁该批、烧多少钱、能不能上云(治理)
```

- **P1 是分水岭**:P0 之前是「搬家+换地基」,P1 之后是「加宽」。
- **P2/P3/P4 在 P1 之上可一定程度并行**(§10),但都**强依赖 P1 的置信度/升级/Proposal 实体**。
- **P5 是收口**:把前四期分散落地的权限/审计/成本「散件」收敛为统一治理面,并解锁多租户公网(D-3 把多租户明确延到 P5)。

### 2.3 关键路径(critical path)

最长依赖链 = **P0 → P1 → P3 → P5**:
- P3「分支-提议-合并」要 P1 的 `Proposal`/`Review`/`Snapshot` 实体先落地;
- P5「审批路由 + 多租户」要 P3 的协作模型 + P0 的 `Org/Workspace` 预留;
- 因此 P2、P4 虽重要,但**不在最长链上**——可在 P1 完成后与 P3 部分并行(§10),而 P5 必须等 P3 协作模型稳定。

---

## 3. 跨期通用 gate(每期都必须满足的横切红线)

下列红线**不分期**——任何一期的任何 PR,违反即不予合并。它们承袭现有代码已沉淀的工程纪律,并落地 PRD 产品宪法(§5)与 NFR。

| 红线 | 出处 | 落地约束 |
|---|---|---|
| **零 git 黑话进用户面** | PRD 宪法 §4、[glossary §1.2](../00-overview/glossary-dejargon.md) | UI/桌宠/通知/AI 理由出现 `branch/commit/PR/merge/conflict/diff` 即缺陷;状态走 `statusLabel()`([`shared/src/design/status-vocab.ts:42`](../../../shared/src/design/status-vocab.ts)) |
| **状态机写入必走原子 CAS** | [api-contract §6.3](../01-architecture/api-contract.md) | `UPDATE … WHERE status=<expected>`,`rowcount==0 → 409`;现有统一模式(`sync.py`、`auto.py:84`、`deliveries.py`),PG 后叠行级锁 |
| **通知与状态同事务、commit 后才推 SSE** | [data-model §5](../01-architecture/data-model.md) | 沿用 `lifecycle.queue_status_notifications`/`flush_status_notifications`([`app/services/lifecycle.py:104`](../../../app/services/lifecycle.py)) |
| **私有事件按身份隔离** | PRD `NFR-08`、[system-architecture §5.2](../01-architecture/system-architecture.md) | 新增 topic 先问「谁能订」;严禁把 PII/正文/`result_ref` 发 `all`(历史泄漏教训见 `client-tauri/src-tauri/src/sse.rs` 注释) |
| **设备令牌门约束人类高权限动作** | D-3、[api-contract §3.2](../01-architecture/api-contract.md) | 接活/干活/同步需桌面客户端(`require_local_client`,[`app/auth.py:183`](../../../app/auth.py));`actor=ai` 的 daemon 内部执行不经此门 |
| **REST 为真相,SSE 为增量提示** | [api-contract §7](../01-architecture/api-contract.md) | SSE 会丢(背压 `push_bus.py` `QueueFull→pass`);客户端收事件后重拉 reconcile |
| **生产配置强校验** | [api-contract §4](../01-architecture/api-contract.md) | `app_env=production` 时 `*` CORS / 默认 `cookie_secret` 直接拒绝启动(`_validate_runtime_config`,`app/main.py:227`) |

> P1 起额外叠加两条 AI 红线(在 §5 给出,但适用其后所有期):**AI 副作用必有执行前快照可回滚**(`NFR-04`/`Snapshot`)、**AI 自治执行必在沙箱 + 硬预算上限内**(`FR-WORKER-003`)。

---

## 4. P0 地基 —— 迁移 + daemon 化 + SQLite→PG

> **主题**:把「需求管理大师」单体迁入新仓,重构为 **headless agent daemon + 瘦客户端**,数据库换 PostgreSQL,实体/认证移植,接入 provider registry。**不产生用户可见新功能**——目标是「架构就位」。

### 4.1 范围(做什么)

P0 是**迁移 + 重构**,不是重写(D-1)。逐项对照 [system-architecture §7 迁移清单](../01-architecture/system-architecture.md)(M1–M16):

1. **新仓 + 项目骨架**:迁移现有 FastAPI(`app/`)、Tauri(`client-tauri/`)、web(`web/`)、shared(`shared/`)四树入新仓,品牌切到 WorkHub(`YQGL` 标识符迁移期可并存,见 [glossary §9](../00-overview/glossary-dejargon.md))。
2. **daemon 化**:确立 C-DAEMON 为唯一真相源;**把「AI 在请求进程内跑」(`app/services/auto_agent.py` 顶部注释「Runs as an asyncio task in the FastAPI process」)收口为可分离的 Agent Runner 执行域**(M2),由一张 `AgentRun` 表显式拥有生命周期(M3,收编 `app/main.py:176` 的「无主 finalize task」)。
3. **SQLite → PostgreSQL**(D-2 / M4):删 `app/db.py:8-39` 的 SQLite 专属补丁(`check_same_thread`、WAL/busy_timeout PRAGMA),`settings.database_url` 切 `postgresql+psycopg://…`(现 `app/config.py:9` 默认 `sqlite:///…`);新增连接池;**daemon 不再受「必须单 worker」约束**(现 `app/main.py:384` 注释明说「single-uvicorn-worker model」)。
4. **实体移植 + 演进骨架**:按 [data-model §9.5](../01-architecture/data-model.md) 迁移 `app/models.py` 全部实体;`Requirement→WorkItem` 重命名(或保留物理表名仅改 ORM 类);新增 `Org/Workspace` 默认行 + 回填 `workspace_id`;补软删除列;`Text` JSON → `JSONB`;**引入 Alembic**(若现仓未用)。新增实体(`Branch/Proposal/AgentRun/ConfidenceRecord/…`)此期**只建表骨架**,逻辑留后续期。
5. **认证移植**:原样保留 `app/auth.py` 五档鉴权([api-contract §3.1](../01-architecture/api-contract.md))——cookie + worker-token 双通道、`require_stream_user` 轻身份、设备令牌门(M7/M8);叠加 `Org/Workspace` 上下文注入(多租户预留,逻辑 P5)。
6. **事件网关内核**:`app/services/push_bus.py` 形状原样保留为事件网关内核(M5/M6);topic 体系扩展(`workitem:/agentrun:/…`)此期**只规划命名**,事件发射随对应功能期落地。
7. **provider registry**(M14):把 `auto_agent.py:34` 的 `AsyncAnthropic(base_url=settings.llm_base_url)`(DeepSeek-via-Anthropic)收进「模型无关 registry」抽象;低风险任务路由廉价模型的**路由逻辑**留 P5(成本治理),P0 只立抽象。
8. **OpenAPI 契约显式化 + 类型化客户端**:daemon 暴露 `/openapi.json`,`shared/src/api/`(`client.ts`/`types.ts`)演进为从契约生成的类型化 client(C-UIKIT)。
9. **静态托管延续**(M13):`app/main.py:340/469/474` 的 `/assets`(web/dist)、`/downloads`(安装包)、SPA fallback 原样保留(LAN 部署形态)。

### 4.2 进入标准(entry)

- **D-1 / D-2 / D-3 已拍板为 `🔒`**:三个地基决策(迁移 vs 重写、SQLite→PG、LAN-first)是 P0 的**唯一硬前置**——它们定了,`01-architecture/` 与 `security` 才落定(README §4 明示「这三个定了,01-architecture 与 security 才能落定」)。
- 地基文档 [`system-architecture.md`](../01-architecture/system-architecture.md) / [`data-model.md`](../01-architecture/data-model.md) / [`api-contract.md`](../01-architecture/api-contract.md) / [`tech-stack-and-migration.md`](../01-architecture/tech-stack-and-migration.md) 状态至少 `✅初稿`。

### 4.3 退出标准(exit)

P0 过的判据是**「在 PostgreSQL 上、多 worker 的 daemon,跑通现有产品的全部回归路径,且 AI 执行已被 `AgentRun` 表显式拥有」**:

1. **多 worker 可起且不锁死**:daemon 以 >1 uvicorn worker 启动;现有「Dashboard 每 6s 扇出 7 读 + reminders 每 60s 轮询」(`app/db.py:24-28` 注释所述并发场景)不再产生 `database is locked`(SQLite 时代的根因已消除)。
2. **现有功能零回归**:现有 web 页面(`web/src/pages/`:Dashboard / RequirementDetail / ProjectDrive / ProjectMeetings / Knowledge / Calendar …)与桌宠路由(`client-tauri/web-src/src/routes/`:Hub / HubDispatch / TaskDetail / Onboarding …)在新 daemon + PG 下行为不变;现有 E2E(`web/tests/`、`.e2e`)通过。
3. **AI 执行被显式拥有**:触发一次现有 `/auto-process`(`app/routers/auto.py:54`)后,产生一行 `AgentRun`(状态 `running→succeeded/failed`);**杀掉 daemon 重启,`_resume_stuck_jobs`(`app/main.py:102`)能按 `AgentRun` 状态精确恢复**(从「猜哪些 job 卡住」升级为「按行恢复」,M3)。
4. **迁移可逆校验**:[data-model §9.5](../01-architecture/data-model.md) 的迁移后校验通过——无悬空 FK、唯一约束无重复、旧 `Requirement.status` 按 §5 映射表正确改写(旧值留 `AuditLog` 备查)。
5. **OpenAPI 可生成客户端**:`/openapi.json` 产出,`shared` 能据此生成 TS 类型且 C-WEB/C-PET 编译通过。
6. **provider 抽象就位**:DeepSeek 经 registry 接入,**换一个 provider 配置不改业务代码**(模型无关验证)。

### 4.4 依赖与风险

- **依赖**:仅依赖 D-1/D-2/D-3 三决策 + 地基文档定稿。**P0 是所有后续期的前置**。
- **关键风险(PRD §14)**:「SQLite→PG 不是换连接串」([system-architecture §7 判断2](../01-architecture/system-architecture.md))——`app/auth.py:94` 为避免 SQLite 写锁「故意不更新 `last_seen_at`」这类**单 writer 遗产写法**要逐处审视;`Project.next_seq` 编号自增在多 worker 下需行级锁/PG `SEQUENCE` 防撞号([data-model §9.4](../01-architecture/data-model.md))。
- **P0 第一道闸**(system-architecture §7 判断3):「进程内跑 AI」是单 worker 遗产;多 worker 一开,**AgentRun 的拥有权、恢复、事件路由必须先收口**——这是 P0 不可绕过的核心动作。

### 4.5 客户端 / 模块对应

- **主导**:C-DAEMON(全部切分动作)。
- **回归保障**:C-WEB(`web/`)、C-PET(`client-tauri/`)、C-UIKIT(`shared/`)——三端在新底座上回归通过即可,**无新功能**。
- **模块**:全部现有业务模块(M-WORKITEM/M-DRIVE/M-MEETING/M-NOTIFY/M-KNOWLEDGE)随实体移植「平移」,功能不变。

---

## 5. P1 旗舰 —— AI 工人 + 升级闭环

> **主题**:让「产出交付物」成为 AI 的**默认动作**(L2 执行层),并补齐「做不好/做砸就升级」的安全闭环。**这是整个产品的命题验证**(PRD §12「P1 必须先把反转证明给真实用户看」)。

### 5.1 范围(做什么)

落地 PRD §8.1(AI 工人引擎)+ §8.2(升级 + 置信度/风险分级)的**核心子集**(先 file 类可交付物,PRD §16 开放问题6 的首发清单):

1. **AI 工人默认执行**(`FR-WORKER-001`):`WorkItem` 在 `spec_ready` 后**默认派给 AI 工人**(`human_reserved=false` 时),无需人工逐步干预——状态 `spec_ready → ai_working`,创建 actor=AI 的 `Branch` + `AgentRun`([data-model §5 转移表](../01-architecture/data-model.md))。复用 `auto_agent.run`(tool-loop)+ 现有工具(`auto_agent.TOOLS`:list/read/write/mkdir/move/delete/run_command/zip/submit)。
2. **完整 trace 可审**(`FR-WORKER-002`):每次 `AgentRun` 落 `AgentStep` 逐步(演进自现有 `trace_json` 与 `ai.*` push 事件);对外 `GET /api/agent-runs/{id}/trace`([api-contract §2.6](../01-architecture/api-contract.md))。
3. **预算耗尽 → 结构化交接件**(`FR-WORKER-003`):超 `MAX_TURNS`/超时不静默截断,强制产出「已做/未做/下一步」`handoff_md`(现状 `auto_agent.py` 超 `MAX_TURNS=15`/`TOTAL_TIMEOUT_DEFAULT` 仅返回失败 `AutoResult`,P1 升级为结构化交接)。
4. **副作用可回滚**(`FR-WORKER-004` / `NFR-04`):AI 每次副作用前打 `Snapshot`(借鉴 opencode「每步 git 快照」);雏形是网盘版本(`ProjectDriveVersion`)+ 可撤销操作日志(`ProjectDriveOperation.undone_at`)。**安全红线**。
5. **置信度 + 风险分级**(`FR-ESC-001`):每次产出生成 `ConfidenceRecord`(置信度 + 风险 + 分级裁决 + 依据);v1 信号以 **② `llm_review` 判分**(`auto_agent.py:544` 的 `meets_requirement`)+ **③ 验收清单逐条命中率**(`AcceptanceCriteria.status` 的 `met/总数`)为主,① AI 自评为辅([data-model §7.3 信号表](../01-architecture/data-model.md))。**对用户以人话呈现,绝不暴露数值**([glossary §3.3](../00-overview/glossary-dejargon.md))。
6. **三档裁决分叉**(对齐 PRD §8.2):`high+low → auto_merge`(自动 Proposal,策略可自动合并)/ `mid → human_spotcheck`(人工抽检)/ `low/high_risk/blocked → escalate`(转 PM)。
7. **三个升级触发器中的两个(P1 必备)**(`FR-ESC-002`):① **不合格** ← `llm_review` 判分不过;② **用户不满意** ← 负责人打回(`Review.decision=reject`,演进自 `RevisionRequest`,现 `app/routers/deliveries.py:267`)。
8. **打回带理由回灌**(`FR-ESC-003`):`reject` 的 `reason_md` **必填**(现 `RevisionRequest.reason_md` 已 NOT NULL),作为上下文回灌 AI,**同分支续做**而非重来(`in_review → ai_working`,对齐 opencode CorrectedError)。
9. **去黑话 Proposal/Review 的最小实现**:AI 工人产出落 `Proposal`(去黑话 PR,演进自 `Delivery`),`auto_merge` 档可一跳 `ai_working → in_review → merged`。**P1 的 Branch/Proposal 是「单 actor」简化版**(只有 AI 一支 + main),**多人多分支并行留 P3**。
10. **可解释**(`FR-EXPLAIN-001`):置信度/升级判分附人话理由 + 证据(承袭 `MeetingInsight.confidence_reason` 与 `meeting_agent.py` 的「AI 自报理由」范式)。

> **明确不在 P1**:智能派活、PM 模式编排(P2);多人多分支并行、双向同步、对象合并冲突调解(P3);桌宠入口(P4);分层 permission 策略与审批路由(P5——P1 的「升级」直接转 PM 占位,不经完整审批路由)。doom-loop / 超预算**自动**升级(`FR-ESC-004`)与「人工保留」三级开关(`FR-ESC-005`)排到 P2(P1 先做「不合格/打回」两触发器 + 粗粒度 `MAX_TURNS` 上限)。

### 5.2 进入标准(entry)

- **P0 已过**(§4.3 全部退出标准达成)——尤其「AgentRun 表显式拥有 AI 执行」「PG 多 worker 可起」。
- 地基文档 [`agent-loop-and-tools.md`](../02-ai-engine/agent-loop-and-tools.md) 与 [`confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md) 至少 `✅初稿`。
- **PRD §16 开放问题2/3/6 给出 v1 收敛值**:置信度信号与档位阈值、风险维度权重、L2 首发可做领域清单(先 file 类)——**P1 必须有一个可标定的初始口径**,允许粗糙(随数据校准,PRD §14「冷启动」缓解)。

### 5.3 退出标准(exit)

P1 过的判据是**「一条真实需求能被 AI 默认干完并自动汇入正式版;做不好时该升级就升级、被打回能续做、任何 AI 改动可回滚」**:

1. **自治闭环可 demo**(对齐 PRD J2 主路径):提交一条 file 类需求 → AI 澄清 → `spec_ready` → **AI 工人自动执行**(无人逐步干预)→ 产出 + `ConfidenceRecord` → 高置信低风险**自动 Proposal → 合并** → 通知提交者完成。**自治率指标 > 0**(PRD §13 北极星)。
2. **升级路径可 demo**(对齐 PRD J3):`llm_review` 判不过 → 创建 `EscalationEvent` → `WorkItem` 切 `escalated`(P1 转 `pm_mode` 占位,完整编排 P2)→ 产出「为什么升级」可读简报种子(`reason_md`)。
3. **打回纠偏可 demo**(对齐 PRD J4):负责人对 Proposal `reject` + 写原因 → 原因回灌 → AI **同分支续做**(`in_review → ai_working`,`reason_fed_back_at` 置位)→ 重新提交;**空理由被拒(400)**。
4. **trace 完整可审**:`GET /api/agent-runs/{id}/trace` 返回每步动作 + 工具 IO(`FR-WORKER-002`);web 端能实时渲染(承袭现有 `ai.thinking/ai.tool_call/ai.done` 事件流,`auto_agent.py:438-507`)。
5. **超预算优雅降级**:人为制造一个超 `MAX_TURNS` 的任务,daemon 产出结构化 `handoff_md`(「已做/未做/下一步」),状态 `escalated`,**不静默截断**(`FR-WORKER-003`)。
6. **回滚可验证**(`NFR-04`):对 AI 已写入的产物执行回滚,内容还原到「改之前」(`Snapshot.reverted_at` 置位,沿用 `ProjectDriveOperation.undone_at` 范式)。
7. **置信度零数值泄漏**:用户面只见三档语气(有把握/建议看一眼/拿不准),**界面/通知中无 `0.82`/`7/10` 一类裸数值**([glossary §3.3](../00-overview/glossary-dejargon.md) 硬规则)——可 lint。
8. **沙箱与硬预算生效**:`AgentRun` 必有 `max_turns` 落库;沙箱路径限定 + 命令白名单(`ALLOWED_COMMANDS`)+ rlimit 在执行中实际拦截越界(沿用 `auto_agent` 的 `_safe_path`/`_enforce_sandbox_budget`/`_sandbox_rlimits`)。

### 5.4 依赖与风险

- **依赖**:P0(daemon/PG/AgentRun 表)。**P1 解锁 P2/P3/P4 的全部下游**——`ConfidenceRecord`/`EscalationEvent`/`Proposal`/`Review`/`Snapshot` 实体在此首次承载真实逻辑。
- **核心风险(PRD §14「信任崩塌」)**:AI 过度自信发垃圾 → 用户退回手动,产品死。**缓解即 P1 的设计本体**:保守分级、中档**强制**抽检、快照回滚、透明置信度 + 人话理由。**P1 的退出标准 7(零数值泄漏)+ 标准 6(可回滚)是这条风险的直接对冲**。
- **次级风险(冷启动 / 成本)**:置信度信号 v1 不准 → 先用 ②③ 可观测信号、人可打回纠偏;token 成本 → 先有 `AgentRun` 的硬 `max_turns` 上限,三级预算治理留 P5。

### 5.5 客户端 / 模块对应

- **主导**:C-DAEMON(Agent Runner 执行域:tool-loop / 沙箱 / 预算 / 快照 / trace / 置信度裁决)。
- **配合**:C-WEB —— trace 实时渲染、Proposal 的「确认/打回(写原因)」按钮(承袭 `client-tauri/web-src/src/routes/TaskDetail.tsx`/`HubDispatch.tsx` 的「通过/打回」文案)、置信度人话呈现。
- **模块/能力**:**P-AI**(工人引擎 + 置信度风险 + 升级裁决,旗舰)、**M-WORKITEM**(状态机扩展 `ai_working/escalated/in_review/merged` + `STATUS_VOCAB` 同步登记新标签,[glossary §7.2](../00-overview/glossary-dejargon.md))。

---

## 6. P2 —— AI 项目经理 + 智能派活

> **主题**:补齐「一人两顶帽子」的另一顶——AI 受阻时**化身项目经理组织人推进**(L1 编排层),并落地喂派活决策的**身份画像**(L0 身份层)。验证「受阻即换帽」。

### 6.1 范围(做什么)

落地 PRD §8.3(PM 模式)+ §8.4(智能派活)+ L0 身份层:

1. **UserProfile 与 onboarding**(`FR-STAFF-001`):新用户必填「擅长什么 + 自我介绍」(`UserProfile.skills_text`/`bio_md`/`skill_tags`,[data-model §3.2](../01-architecture/data-model.md));承袭现有 `client-tauri/web-src/src/routes/Onboarding.tsx`。可用度雏形复用 `User.availability_status`。
2. **CollaborationGraph 聚合**(L0):由 `AuditLog`/交付历史/`Review` 结果聚合「谁擅长什么、与谁合作过、命中率」(`hit_rate = approve/(approve+reject)`),MVP 用 PG 物化视图([data-model §3.3](../01-architecture/data-model.md))。
3. **PM 模式激活 + 简报**(`FR-PM-001`):`EscalationEvent` 触发 → AI 切 `mode=pm`(`WorkItem.mode`)→ 据交接件(`handoff_json`)生成「为什么升级 + 建议谁来做 + 计划」可读简报(`escalated → pm_mode`)。
4. **智能派活提议**(`FR-STAFF-002/003`):有新 WorkItem 或升级时,AI 提议**负责人 + 协作人 + 推荐理由**,写入/调整 `Assignment`(`role=lead|collaborator`,现 `app/models.py:363`);**推荐必须可被人一键确认或调整**(护栏:负责人一键改派)。
5. **冷启动降级**(`FR-STAFF-004`):无 CollaborationGraph 边时,退化为只读 `UserProfile.skill_tags` 粗匹配 + **解释式推荐**(展示理由让人定),不做命中率加权(PRD §14「冷启动」缓解)。
6. **PM 排期 + 催办**(`FR-PM-002`):AI 自动排期并设提醒/催办——复用现有 `RequirementTaskPlan`/`RequirementTaskItem`(拆解/排期,`stage=dispatch|worker`)、`ScheduleEvent`、`Reminder`、人侧执行视图 `RequirementWorkspace`/`RequirementProgressUpdate`([data-model §4.3/§4.4 注](../01-architecture/data-model.md))。
7. **人产出 → AI 整理为 Proposal**(`FR-PM-003`):被派的人完成后 AI 协助整理为可审 Proposal(`pm_mode → in_review`)。
8. **补齐 P1 缓出的升级件**:doom-loop / 超预算**自动**升级(`FR-ESC-004`,由 `AgentStep` 检测连续 N 步相同动作)、「人工保留」三级开关(`FR-ESC-005`:`WorkItem.human_reserved` + 项目级 + 用户级,经 `POST /api/workitems/{id}/hold`)——构成第③触发器「用户明确不让 AI 干」。
9. **派活纠正回流**(`FR-STAFF-005`,P2 可延至尾):负责人对推荐的纠正写入反馈,改进后续(PRD §14「随数据校准」)。

> **关键**(PRD §8.3):PM 模式下 AI **不静默替人决策**——派活、催办都是「提议→人确认」(承接产品宪法 §5)。

### 6.2 进入标准(entry)

- **P1 已过**(尤其 `EscalationEvent` 已能在「不合格/打回」时落库并切 `pm_mode` 占位)。
- 地基文档 [`pm-mode-orchestration.md`](../02-ai-engine/pm-mode-orchestration.md) 与 [`smart-staffing.md`](../02-ai-engine/smart-staffing.md) 至少 `✅初稿`。
- PRD §16 开放问题2(命中率作为信号④何时接入)有初步答案——P2 引入 `CollaborationGraph` 后,置信度信号④可随数据接入([data-model §7.3 信号④](../01-architecture/data-model.md))。

### 6.3 退出标准(exit)

1. **onboarding 闭环**(对齐 PRD J1):新用户进入 → 必填技能 + 自我介绍 → `UserProfile.onboarded_at` 置位(NULL 触发引导)。
2. **升级→换帽可 demo**(对齐 PRD J3 后半):升级后 AI 自动生成「为什么升级 + 建议谁来做 + 计划」简报(`FR-PM-001`),并**提议 lead + collaborator + 人话理由**(`FR-STAFF-002`)。
3. **一键确认/改派**:负责人能一键采纳或调整 AI 的派活提议(`FR-STAFF-003`);改派后 `Assignment` 正确更新。
4. **冷启动不崩**:无历史数据时派活退化为解释式推荐(只凭 `skill_tags` 粗匹配),**不报错、不空白**(`FR-STAFF-004`)。
5. **排期 + 催办可见**:PM 模式下 AI 产出排期(`RequirementTaskPlan`)并设提醒(`Reminder`/`ScheduleEvent`),到期触发催办通知(`FR-PM-002`)。
6. **三触发器齐全**(`FR-ESC-002/004/005`):不合格 / 打回 / 人工保留 三触发器 + doom-loop + 超预算 五信号任一命中均能创建 `EscalationEvent`;「人工保留」开关在 WorkItem/项目/用户三级生效(`spec_ready → pm_mode` 直接走人)。
7. **升级精准度可度量**(PRD §13):有数据口径统计「该升级时升级、不该时不升级」的 precision/recall。

### 6.4 依赖与风险

- **依赖**:P1(`EscalationEvent`/`ConfidenceRecord`/`Review`)。**P2 与 P3 可部分并行**(§10):P2 走 AI 引擎 + 身份线,P3 走协作 + 同步线,二者在 P1 之上相对独立。
- **风险(PRD §14「冷启动」)**:无历史时派活失准 → 降级解释式推荐 + 人可改派 + 纠正回流(`FR-STAFF-005`)随数据校准。

### 6.5 客户端 / 模块对应

- **主导**:C-WEB(派活提议确认 UI、onboarding、PM 简报视图)+ C-DAEMON(PM 编排 + 派活算法 + CollaborationGraph 聚合)。
- **模块/能力**:**P-AI**(PM 模式 + 智能派活)、**P-IDENTITY**(UserProfile + CollaborationGraph + Org/Workspace 上下文)、M-NOTIFY(催办/提醒)、M-WORKITEM(`pm_mode` 态 + Assignment)。

---

## 7. P3 —— 协作(分支-提议-合并)+ 双向同步 + README=规格

> **主题**:把 P1 的「单 AI 一支」升级为**多协作者 + 多 AI 工人各在分支并行**(L3 协作层),补齐双向同步与活文档规格页。验证多人并行不打架。

### 7.1 范围(做什么)

落地 PRD §8.5(分支-提议-合并)+ §8.7(双向同步)+ §8.8(README=规格):

1. **多分支并行**(`FR-COLLAB-001`):每个协作者/AI 工人对 WorkItem 的改动在独立 `Branch`(`actor_kind=human|ai`)进行,互不阻塞(P1 的单 actor 简化版在此泛化为多 actor)。
2. **提议→合并**(`FR-COLLAB-002`):改动以 `Proposal` 提交,负责人 `approve→merged`(写 `WorkItem.main_branch_id`,落 `merge` `Snapshot`)/ `reject` 带理由([data-model §6.1/§6.2](../01-architecture/data-model.md))。
3. **冲突 AI 调解**(`FR-COLLAB-003`):同一业务对象并发改动 → AI 生成合并建议,人择一/微调(`GET /api/workitems/{id}/conflicts`)。**业务对象合并语义(文档 vs 结构化记录)是护城河**(PRD §16 开放问题4),按内容类型分派,详见 [`branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md)。`Branch` 内容载体复用 Drive 版本家族(`ProjectDriveVersion` 内容寻址 sha256)。
4. **全程零术语**(`FR-COLLAB-004`):UI 不出现 `branch/PR/merge/conflict`——API 保留技术名,翻译在客户端([glossary §2](../00-overview/glossary-dejargon.md))。
5. **双向同步**(`FR-SYNC-001`):客户端 ↔ daemon 双向——**替换现有只下载占位**(`client-tauri/src-tauri/src/sync.rs:227` 注释明说「placeholder: 单向下载」)。复用 `spec_watch.rs`(sha256 去重 + append-only manifest)做地基;`POST /api/requirements/{id}/sync-push` 上传本地改动([api-contract §2.13](../01-architecture/api-contract.md))。
6. **同步冲突 AI 调解**(`FR-SYNC-002`):同步撞车走与 §7.1#3 同一调解路径,返回 `conflicts[]`,人择一。
7. **离线编辑后合并**(`FR-SYNC-003`,P3 可延至尾):离线编辑,联网后同步并解冲突。
8. **README=规格活文档**(`FR-SPEC-001`):每个 WorkItem/项目有自动维护的 `SpecDoc`(`body_md` + 内容寻址 sha256 + 乐观锁 version),随澄清/交付自动更新(演进自 spec 文件夹 + `spec_watch.rs`)。
9. **规格页变更走提议→合并**(`FR-SPEC-002`,P3 可延至尾):与内容协作一致(`SpecDoc` 也走 Branch→Proposal→merge)。

### 7.2 进入标准(entry)

- **P1 已过**(`Branch`/`Proposal`/`Review`/`Snapshot` 实体已承载单 actor 逻辑)。
- 地基文档 [`branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md) / [`review-and-approval.md`](../03-collaboration/review-and-approval.md) / [`sync-and-spec.md`](../03-collaboration/sync-and-spec.md) 至少 `✅初稿`。
- **PRD §16 开放问题4(对象合并语义)有 v1 收敛**:文档类 vs 结构化记录类各自的 diff/merge 策略需在进入 P3 前定型(这是 opencode 未解、WorkHub 必啃的护城河,PRD §14 列为预研专题)。

### 7.3 退出标准(exit)

1. **多人并行可 demo**(对齐 PRD J5):两位协作者各在 `Branch` 干 → 分别提议 → 负责人逐个审 → 合并;**互不阻塞**(`FR-COLLAB-001/002`)。
2. **撞车调解可 demo**:两支改同一对象 → AI 给合并建议 → 人择一/微调后合并成功(`FR-COLLAB-003`),按内容类型(文档/结构化)分派语义。
3. **双向同步可验证**:桌宠本地改文件 → `sync-push` 上传 → daemon 接收;daemon 侧改动 → 拉到本地;**不再是单向下载**(`sync.rs:227` 占位被真实双向取代,`FR-SYNC-001`)。
4. **零术语**:协作全流程 UI/通知无 git 黑话(`FR-COLLAB-004`,可 lint)。
5. **规格页活更新**:WorkItem 澄清/交付后 `SpecDoc.body_md` 自动更新且版本递增(`FR-SPEC-001`)。
6. **合并强一致**:并发合并走行级锁(`SELECT … FOR UPDATE` 锁 WorkItem + main branch 头)+ 乐观锁 CAS,**无丢更新**([data-model §9.4](../01-architecture/data-model.md))。

### 7.4 依赖与风险

- **依赖**:P1(Proposal/Snapshot)、P0(PG 行级锁/乐观锁——对象合并的地基)。**P3 在关键路径上**(§2.3),P5 审批路由依赖 P3 协作模型。
- **风险(PRD §14「护城河三难」之对象合并)**:最难、最易低估——合并语义按内容类型分类定义,提前预研(开放问题4)。

### 7.5 客户端 / 模块对应

- **主导**:C-PET(双向同步:`sync.rs`/`spec_watch.rs` 升级)+ C-WEB(提议审阅/冲突择一 UI)。
- **模块/能力**:**P-COLLAB**(分支-提议-合并 + 同步 + README=规格)、**M-DRIVE**(Drive 版本家族作为 Branch 内容载体)、M-WORKITEM(SpecDoc 头指针)。

---

## 8. P4 —— 桌宠 + web 对等(小白 UX)

> **主题**:把现有右下角弹窗/托盘升级为**有人格、可对话、能代操作的桌面宠物**(L4 入口层),让小白「说句话,剩下别让我学」。验证「小白也能用」。

### 8.1 范围(做什么)

落地 PRD §8.9(桌宠入口):

1. **桌宠常驻 + 点击对话**(`FR-PET-001`):桌宠替代现有托盘弹窗(`client-tauri/src-tauri/src/tray.rs`/`notify.rs`);点击出对话框。
2. **自然语言驱动 Agent 操作**(`FR-PET-002`):用户一句话 → Agent 代操作几乎所有功能(派活、查状态、提交、催办)。**走 session 机制**(`POST /api/session/{id}/message`,`202` 立即返回,产物经 `session:{id}` SSE 回流,[api-contract §2.3](../01-architecture/api-contract.md));桌宠/web 都是同一 daemon 的瘦客户端(借鉴 opencode `createOpencode` + SSE)。
3. **提醒/升级以桌宠呈现**(`FR-PET-003`):替代右下角弹窗;复用 P2 的 `Reminder`/`EscalationEvent` 事件,经桌宠人格化呈现。
4. **打扰边界可设**(`FR-PET-004`,P4 可延至尾):用户设频率/时段边界(`UserProfile.availability_pref`,[data-model §3.2](../01-architecture/data-model.md))。
5. **web 对等**:C-WEB 保持与桌宠功能对等(浏览器可达的派活/审批/看板),复用 C-UIKIT 组件与同一 session/SSE 契约。
6. **审批入口前移**(`FR-PERM-002` 的 UI 部分):桌宠/web 收 `permission.ask` 事件并就地响应(完整审批策略/路由引擎在 P5,P4 先打通「事件下行 + HTTP 回复」的入口形状)。

### 8.2 进入标准(entry)

- **P1 已过**(session/SSE 事件流 + AI 工人可被 session 驱动);**P2 已过**(桌宠要能驱动派活、呈现升级简报)。建议 P3 同步或稍前,使桌宠能驱动协作动作。
- 地基文档 [`desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md) / [`web-app.md`](../05-clients/web-app.md) / [`shared-ui-kit.md`](../05-clients/shared-ui-kit.md) 至少 `✅初稿`。

### 8.3 退出标准(exit)

1. **桌宠对话可 demo**(对齐 PRD J6):点开桌宠 → 「帮我把上周那个活的进度问一下并催一下」→ Agent 查状态 + 起草催办 → 「确认?」→ 用户确认 → 完成。
2. **一句话驱动多功能**:桌宠能驱动派活/查状态/提交/催办等(`FR-PET-002`),全程经 session SSE 回流,**不在 HTTP 响应里返产物**(`202` 语义)。
3. **零术语 + 一句话 + 可撤销**(`NFR-10`):关键路径无术语、可一句话完成、可撤销(承袭 P1 的 Snapshot 回滚)。
4. **提醒人格化**:升级/提醒经桌宠呈现,替代右下角弹窗(`FR-PET-003`);设备令牌门下桌宠仍持有令牌(`X-YQGL-Client-Token`)。
5. **web/桌宠对等**:同一功能在两端行为一致(共享 C-UIKIT + 同一契约)。

### 8.4 依赖与风险

- **依赖**:P1(session/SSE/Agent)、P2(可驱动的派活/PM 能力)。**P4 不在最长关键路径上**(§2.3),可在 P2 后与 P3 并行推进入口层。
- **风险(PRD §16 开放问题5「桌宠人格与打扰边界」)**:陪伴感 vs 不烦人 —— `FR-PET-004` 的打扰边界 + `availability_pref` 是缓解;节制提醒承袭现有 `Notification.dedupe_key` 去重范式。

### 8.5 客户端 / 模块对应

- **主导**:C-PET(桌宠窗口 + 人格 + 本地 Agent + Rust 侧托盘/通知/deep-link 升级)+ C-WEB(对等)。
- **模块/能力**:L4 入口层、M-NOTIFY(桌宠呈现)、C-UIKIT(跨端组件/hooks/types)。

---

## 9. P5 —— 治理 + 多租户 + 成本治理

> **主题**:把前四期分散落地的权限/审计/成本「散件」收敛为**统一治理面**(L5 治理层),并解锁多租户公网(D-3 把多租户明确延到此期)。规模化与护城河。

### 9.1 范围(做什么)

落地 PRD §8.6(审批与权限)+ NFR-05(成本治理)+ 多租户:

1. **分层 allow/deny/ask 策略**(`FR-PERM-001`):`PermissionPolicy` 的 `org→workspace→role→session` 合并,**未匹配默认 `ask`**;把现有硬编码 `services/permissions.py`(`can_view/can_claim/can_work`)外化为数据规则([data-model §8.1](../01-architecture/data-model.md))。`is_admin` 迁移期作最高优先级 allow 兜底。
2. **审批 = 阻塞原语**(借鉴 opencode):工具在「该决策那一刻」`ask` 人,阻塞 `AgentRun` 至回复(`ApprovalRequest`,[data-model §8.2](../01-architecture/data-model.md));对客户端表现为 `permission.ask` 事件(P4 已打通入口,P5 补完整策略引擎)。
3. **审批路由 + SLA + 委派**(护城河,opencode 无)(`FR-PERM-002/003`):按角色/负责人/项目决定**谁该批**(`routed_to_user_id`);超时 SLA(`sla_due_at`)到期升级/重路由;可委派(`delegated_to_user_id`);**按身份审计**。
4. **「永远允许」学习**(`FR-PERM-003`):一次放行沉淀为自动规则(`PermissionPolicy.learned_from_session`),逐步减少打扰。
5. **拒绝回灌**:`deny` 的 `decision_reason_md` 作为下一步上下文喂回 AI(对齐 P1 的打回回灌范式)。
6. **全量按身份审计 + 可回滚**(`FR-PERM-004` / `NFR-03`):所有 AI/人动作落 `AuditLog`(`actor_kind=human|ai|system` + `entity_type/entity_id/action` + `snapshot_id` 回滚点),**append-only 不可篡改、不软删**([data-model §8.3](../01-architecture/data-model.md));演进自 `ActivityLog` + `ProjectDriveOperation.undone_at`。
7. **三级成本治理**(`NFR-05`):用户/团队/任务三级预算与配额;低风险任务路由更便宜模型(P0 立的 provider registry 在此接入路由逻辑);`AgentRun` 的 `token_in/out`/`cost_estimate` 已为此埋点([data-model §7.1](../01-architecture/data-model.md))。
8. **多租户 / 云就绪兑现**(D-3 / `NFR-02`):`Org/Workspace`(P0 预留)启用真实租户隔离;daemon 多副本(无状态,真相在 PG)置于 LB 后;事件总线从进程内 `push_bus` 升级为外部 broker(Redis pub/sub / PG `LISTEN/NOTIFY`,topic 契约不变,[system-architecture §5.3](../01-architecture/system-architecture.md));**威胁模型从「可信局域网」重审**——公网下设备令牌门、CORS、cookie secret 全面收紧。
9. **治理看板**(M-DASHBOARD):自治率、升级精准度、回滚率、成本。自治指标可先走 `GET /api/dashboard/autonomy`;成本页面主口径必须走 `GET /api/pages/cost -> CostDashboardVM`,轻量预算摘要走 `GET /api/cost/usage -> CostSummaryVM`([api-contract §2.14/§2.15](../01-architecture/api-contract.md));指标定义见 [`dashboards-and-metrics.md`](../04-modules/dashboards-and-metrics.md)。

### 9.2 进入标准(entry)

- **P3 已过**(协作模型稳定——审批路由依赖 Proposal/Review 的协作上下文)。
- 地基文档 [`security-and-permissions.md`](../01-architecture/security-and-permissions.md) 与 [`review-and-approval.md`](../03-collaboration/review-and-approval.md) 至少 `✅初稿`。
- **PRD §16 开放问题3/7 收敛**:风险维度权重、用户/团队/任务三级初始配额——P5 需要可标定的初值。
- **D-3 多租户公网的部署形态拍板**(从「云就绪架构」走到「真上云」的运维/安全前置)。

### 9.3 退出标准(exit)

1. **分层策略生效**:`PermissionPolicy` 按 `org→workspace→role→session` 合并裁决,**未匹配默认 ask**(`FR-PERM-001`);可在管理台增删规则。
2. **审批阻塞 + 路由可 demo**:AI 触高风险工具 → 阻塞 → 按角色/负责人路由到正确的人(`FR-PERM-002`)→ 该人 allow/deny(带理由)→ AI 续跑或回灌纠偏;超时 SLA 触发重路由/升级,可委派(`FR-PERM-003`)。
3. **「永远允许」减打扰**:选 `remember=always` 后同类动作不再询问(沉淀 `learned_from_session` 规则)。
4. **全量审计可追溯可回滚**(`FR-PERM-004`):任意 AI/人动作可在 `AuditLog` 按身份查到,关联 `Snapshot` 可回滚;审计 append-only 不可改。
5. **成本治理生效**(`NFR-05`):三级预算/配额可设;超额触发降级/拦截;低风险任务实际路由廉价模型;成本看板按用户/团队/任务/模型分解(PRD §13)。
6. **多租户隔离可验证**:两个 Org 的数据/事件/审计互不可见(`NFR-08` 隔离);daemon 多副本下事件经外部 broker 正确扇出(不再「只到产生它的那台」)。
7. **公网威胁模型重审通过**(`NFR-02`):设备令牌门、CORS、cookie secret 在公网形态下收紧并通过 [`security-and-permissions.md`](../01-architecture/security-and-permissions.md) 的审查清单。

### 9.4 依赖与风险

- **依赖**:P3(协作模型)、P0(Org/Workspace 预留 + provider registry)、P1(AgentRun token/cost 埋点 + 快照)。**P5 是关键路径终点**(§2.3)。
- **风险(PRD §14「护城河三难」之审批路由 + 治理)**:opencode 未解、最易低估——列为 P5 深设计专题;成本失控用三级预算 + 廉价模型路由 + 硬上限缓解;安全用沙箱 + 策略 + 高风险人工门 + 审计 + 回滚 + 上云前重审威胁模型。

### 9.5 客户端 / 模块对应

- **主导**:C-WEB(管理台:策略编辑/审批收件箱/成本看板)+ C-DAEMON(策略引擎 + 审批路由 + 多副本 + 外部 broker)。
- **模块/能力**:**P-PERM**(分层策略 + 审批路由 + SLA + 委派)、**P-AUDIT**(按身份审计 + 回滚)、**P-COST**(三级预算 + 模型路由)、**M-DASHBOARD**(治理看板)。

---

## 10. 依赖图与并行化建议

### 10.1 期间依赖图(文字版)

```
            ┌──────────────────────────────────────────────┐
   D-1/D-2/D-3 拍板 ──► P0 地基(daemon+PG+实体/认证移植+provider 抽象)
            └───────────────┬──────────────────────────────┘
                            ▼
                       P1 旗舰(AI 工人 + 置信度/风险分级 + 升级闭环 + Proposal/Review/Snapshot)
                            │  ← 实体 ConfidenceRecord/EscalationEvent/Proposal/Snapshot 在此首次承载真实逻辑
            ┌───────────────┼───────────────┬───────────────┐
            ▼               ▼               ▼
         P2 PM+派活      P3 协作+同步      P4 桌宠+web
       (L0/L1)         (L3,关键路径)     (L4)
            │               │               │
            │               ▼               │
            └──────────────►P5 治理+多租户◄──┘
                       (L5,关键路径终点;强依赖 P3)
```

### 10.2 关键路径 vs 可并行

- **关键路径(最长链)**:`P0 → P1 → P3 → P5`。压缩总工期应优先保障这条链不阻塞。
- **可并行(P1 之后)**:
  - **P2(AI 引擎/身份线)** 与 **P3(协作/同步线)** 在 P1 之上相对独立,可并行——但若团队有限,**P3 优先**(它在关键路径上,且 P5 依赖它)。
  - **P4(入口线)** 依赖 P1(session)+ P2(可驱动的派活),可在 P2 后与 P3 并行——它不在关键路径上。
- **可提前预研(不阻塞当期、但早做早受益)**(PRD §14 列为预研专题):
  - **对象合并语义**(P3 护城河,PRD §16 开放问题4):文档 vs 结构化记录的 diff/merge,可在 P1 期就预研。
  - **审批路由 + 治理**(P5 护城河):可在 P3 期就起草策略合并算法。
  - **置信度/风险标定**(P1 命门,PRD §16 开放问题2/3):信号与阈值需真实数据,P1 上线即开始积累校准。

### 10.3 「散件先落、P5 收口」的横切能力

权限、审计、成本不是 P5 才出现,而是**各期落散件、P5 收敛为统一面**:

| 横切能力 | 散件落点(早) | P5 收口 |
|---|---|---|
| 权限/审批 | P1 升级转 PM 占位;P4 打通 `permission.ask` 事件入口 | 完整分层策略引擎 + 路由 + SLA + 委派 |
| 审计 | P0 起 `AuditLog` 表骨架 + 现有 `ActivityLog`/`ProjectDriveOperation` | 全实体按身份审计 + 可回滚 |
| 成本 | P0 立 provider registry;P1 起 `AgentRun` token/cost 埋点 | 三级预算/配额 + 廉价模型路由 |

---

## 11. 与 PRD §13 成功度量、§14 风险的对齐

### 11.1 各期主证的度量(PRD §13)

| 度量(PRD §13) | 首次可测期 | 锚点 |
|---|---|---|
| **自治率**(无人执行即完成占比,北极星) | **P1** | P1 退出标准1(自治闭环 demo) |
| **升级精准度**(precision/recall) | **P2** | P2 退出标准7 |
| **信任**(合并后回滚率、打回率) | P1(回滚率)/ P2(打回率趋势) | P1 退出标准3/6 |
| **效率**(平均交付时长下降) | P2 起持续 | PM 排期 + 自治率综合 |
| **小白激活**(onboarding 完成率、首个 AI 任务成功率) | P2(onboarding)/ P4(桌宠首任务) | P2 退出标准1、P4 退出标准1 |
| **成本**(每条已交付需求 token 成本) | P1 埋点 / P5 治理 | `AgentRun.token_*`,P5 成本看板 |

### 11.2 风险→缓解所在期(PRD §14)

| 风险(PRD §14) | 缓解主要落在 | 本篇对应 |
|---|---|---|
| **信任崩塌**(AI 过度自信) | **P1** | 保守分级 + 中档强制抽检 + 快照回滚 + 透明理由(P1 退出标准6/7) |
| **冷启动**(无历史/自述不准) | **P2** | 解释式推荐 + 人可改派 + 纠正回流(`FR-STAFF-004/005`) |
| **成本失控**(AI 当默认劳动力) | P1(硬上限)→ **P5**(三级预算) | `AgentRun.max_turns` + P5 成本治理 |
| **安全**(AI 自治改数据/上云) | 全期(沙箱/快照/审计)→ **P5**(威胁模型重审) | 跨期红线 §3 + P5 退出标准7 |
| **范围蔓延** | 全期(严格分期) | **P1 旗舰先证明价值**(§1.1) |
| **护城河三难**(审批路由/对象合并/治理) | **P3**(对象合并)+ **P5**(路由/治理) | P3/P5 深设计专题 + §10.2 提前预研 |

---

*本篇定位:交付分期的单一来源——每期范围/出入口/依赖/客户端对应。FR 逐条验收 → [`functional-requirements.md`](./functional-requirements.md);跨文档开放问题收敛 → [`../07-open-questions.md`](../07-open-questions.md)(随后落定);架构/实体/接口细节 → `01-architecture/`。*
