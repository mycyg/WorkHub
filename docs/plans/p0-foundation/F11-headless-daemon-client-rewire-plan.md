---
component: F11
title: headless daemon 拆分 + 客户端改接 — 系统级实现 plan
status: active
type: feat
date: 2026-06-05
depends: [F1, F2, F3, F4, F5, F6, F7, F8, F9, F10]
master: ../2026-06-05-feat-workhub-p0-foundation-master-plan.md
inventory: ./_migration-inventory.md
specs:
  - ../../workhub/01-architecture/system-architecture.md
  - ../../workhub/01-architecture/api-contract.md
  - ../../workhub/05-clients/web-app.md
  - ../../workhub/05-clients/desktop-pet-tauri.md
  - ./_experience-deliverable-contracts.md
  - ./_ts-first-module-port-page-alignment.md
---

# F11 — headless daemon 拆分 + 客户端改接

> **一句话**:把 daemon 从「自带 SPA 静态托管的单体」剥离为 **TS-first headless agent daemon**(Hono/Node,只暴露 OpenAPI + SSE),路由按域重排,从 `/api/openapi.json` 生成**类型化客户端**替手写 `shared/src/api/types.ts`/`client.ts`,把 web 的**同源假设**改为可配 daemon base-URL + 跨域 CORS/cookie(**不削弱生产门**),把 `requirements→workitem` 端点对齐改名,补 SSE 新 topic,Tauri 仅做**最小改接**。
> **定位**:F11 是 P0 的**汇聚与暴露层**(Master §5.2 P0c),依赖 F1–F10 全部。本 plan 只管「daemon 去 UI + 客户端连新 daemon」这条边界;实体/状态机以 [data-model] 为准,接口形状以 [api-contract] 为准,事件 broker 内核以 F5 为准,provider/Agent 引擎以 F7/F8 为准——**交叉处只引用,不复述**。
> **TS-first 修正**:原 `app/main.py` / FastAPI file:line 继续作为旧系统行为锚点;新仓实际模块、端口、Page VM、Endpoint→Page→Cuu 对齐以 [`_ts-first-module-port-page-alignment.md`](./_ts-first-module-port-page-alignment.md) 为准。
> **扎根**:本 plan 每条改动带 `file:line` 锚点,均经真实代码核验(`app/main.py`、`shared/src/api/client.ts`、`client-tauri/src-tauri/src/http.rs`、`app/routers/push.py`、`app/auth.py`、`app/config.py`、`client-tauri/web-src/src/lib/tauri.ts`)。

---

## 目标

1. **daemon headless 化**:新建 `apps/api` Hono/Node daemon,剥离旧 SPA 静态托管(`/assets` + SPA fallback,`main.py:469-498` 作为行为锚点),daemon 只服务 `/api/*` + `/api/push/stream*` + 安装包下载;web `dist` 由独立静态服务器/CDN 托管。
2. **路由按域重排**:把 26 个 `include_router`(`main.py:280-305`)按 api-contract §1 的域分组(session/workitem/proposal/permission/agent-run/escalation/event/sync …)显式化,使 `/openapi.json` 成为稳定契约。
3. **OpenAPI-first 类型化客户端**:从 daemon `/api/openapi.json` 生成 TS 类型 + API client,替换手写 `shared/src/api/types.ts` 与 `shared/src/api/client.ts`(P0 最高杠杆客户端改动)。
4. **web 跨域 base-URL/CORS/cookie 重解**:web 从「相对 `/api` 同源 + cookie」改为「可配 daemon base-URL + 跨域 CORS(`allow_credentials=True` + 显式 origin)+ cookie `SameSite=None;Secure`」,**且不放松** `_validate_runtime_config` 生产门(`main.py:227`)。
5. **`requirements→workitem` 端点对齐**:把 F2 改名(`requirements→work_items`)在 API 面与客户端 hook 统一落地,旧路径保留迁移期别名(deprecation 兼容窗)。
6. **SSE 新 topic 暴露**:在 `routers/push.py` 增 `/stream/session/{id}` 等新 topic 端点(F5 已实现 broker 内核与 topic 鉴权门),客户端 hook 消费 `agent_run.step`/`agent_run.escalated`/`permission.ask`/`proposal.opened|reviewed|merged`/`knowledge.evidence.ready`。
7. **Tauri 最小改接**:`http.rs:84` 已有可配 `base_url`,P0 仅对齐新/改名端点与新事件分发;**不做**双向同步、桌宠独立窗、自动更新(推 P1+)。
8. **体验契约类型化**:OpenAPI/shared generated types 必须覆盖 `AttentionItem` / `QuestionCard` / `EvidenceRef` / `DeliverableChangeManifest` / `WorkHubEvent` / `CuuState`,保证 Web、Rust 主窗、未来 Cuu pet window 同源消费。
9. **页面返回对齐**:关键 AI-native 页面使用 Page VM endpoint(`GET /api/pages/attention`、`/api/pages/proposals/:id`、`/api/pages/approvals` 等),避免 Web/Tauri/Cuu 各自拼接口。

---

## 范围

### In(P0 必须)

- 剥离 SPA 静态托管,daemon 去 UI(`main.py:468-498`);保留 `/downloads`(`main.py:340`)与 `/client/{name}`(`main.py:325`)安装包托管(部署形态需要)。
- `include_router` 按域重排为显式分组(`main.py:280-305`),`/api/health`(`main.py:308`)与 `/openapi.json` 稳定。
- OpenAPI 类型生成管线(`openapi-typescript` 或等价),产物落 `shared/src/api/generated/`;`shared/src/api/client.ts` 改为基于生成类型 + 可注入 base-URL 的 fetch 封装。
- web base-URL 可配(env/运行时配置),`withCommon`(`client.ts:25`)从「同源相对路径」升级为「可绝对化到 daemon base-URL」。
- CORS 跨域重解:`config.py:43` `cors_allow_origins` 在 web 独立部署后必须列显式 origin;cookie 签发(`auth.py:issue_cookie`)在跨域下 `SameSite=None;Secure`;**生产门(`main.py:227-233`)逐字保留并补「跨域且 `*` → 拒绝」断言**。
- `requirements→workitem` 端点改名 + 旧路径别名;客户端 hook(`client.ts` 约 40 个方法)对齐新命名。
- `routers/push.py` 增 `/stream/session/{id}`(+ 复用 `require_stream_user` 轻鉴权 + 订阅前 `can_view` 门);客户端新增 hook 消费新 topic。
- Tauri:`http.rs`/`lib/tauri.ts` 对齐新端点路径与新事件名(经 `push-event` 单入口分发,无需新 Tauri 事件)。
- 端到端冒烟:web(跨域 CORS+cookie)与 Tauri(token)经生成客户端 + 新 SSE topic 成功访问 daemon。
- shared/OpenAPI 生成的客户端类型包含 `_experience-deliverable-contracts.md` 的体验契约;Web 可完整渲染, Cuu 可轻量渲染, Rust 可按 `requires_desktop` 执行边界分流。

### Out(明确推迟到 P1+)

- **Tauri 双向同步**(`sync.rs:227` 单向占位升级)→ P1+(sync-and-spec)。
- **桌宠独立窗 / 本地 agent / 人格 / Cuu**(`desktop-pet-tauri.md §2.2/§5`)→ P3/P4。
- **审批中心 / 提议详情 / 升级置信度呈现**的完整 web 页(`web-app.md` W1/W2)→ 页面骨架属 P1+ 产品层;F11 只保证其**底层 SSE topic 与端点契约**就绪。
- **自动更新、autostart 接线**(`desktop-pet-tauri.md §7`)→ P1+。
- **WS 双工通道**(api-contract §5.3)→ P4+;F11 维持 SSE 单向主干。
- **多副本负载均衡 / 云 blob / CDN 静态托管**(Master §4.2 P5)→ P5;F11 只做「daemon 不再自带 SPA」这一解耦动作,使上云成为部署形态切换而非代码改动。

---

## 现状 → 改动(按 PORT / REFACTOR / NEW 分组)

> 来源:迁移清单 §3(FastAPI daemon)+ §11(客户端壳),叠加 §4(事件 bus)/§5(鉴权)的客户端边界。

### PORT(逐字/原样移植,踩坑沉淀的契约,禁止顺手重构)

- **P-1 生产门 fail-closed**:`_validate_runtime_config`(`main.py:227-233`)——production + 默认 `cookie_secret` 或 `"*"` CORS → `RuntimeError`。**逐字保留**,跨域重解只能**收紧**(见 N-4),不得放松(Master §6 铁律4、api-contract §4)。
- **P-2 CORS 中间件形态**:`CORSMiddleware(allow_origins=settings.cors_allow_origins, allow_credentials=True, ...)`(`main.py:272-278`)——`allow_credentials=True` 与显式 origin 配对的形态保留(跨域 cookie 前提)。
- **P-3 流式轻鉴权**:`require_stream_user`(`auth.py:202-226`,不持 DB session)+ `stream_one` 的「短命 session 做 `can_view` 检查后立即 `db.close()`」(`push.py:77-87`)——新 `/stream/session/{id}` **照搬此姿势**(system-architecture §3「流式连接的特殊门」)。
- **P-4 token-胜-cookie 优先级链**:`current_user`(`auth.py:104-127`,worker-token 优先 `:112`,均 `deleted_at IS NULL`)——跨域后 web 仍走 cookie、Tauri 仍走 token,优先级链**不动**(F4 范围,F11 不重写)。
- **P-5 SSE 帧/心跳/背压**:`_sse` 逐行 `data:` 前缀 + `splitlines()`(`push.py:26-34`)、30s `: ping` 心跳、`Queue(maxsize=256)` 满则丢——新 topic 端点复用 `_gen`/`stream`(`push.py:37-50`),帧格式零改动(api-contract §5.1)。
- **P-6 安装包托管**:`/downloads`(`main.py:340`)+ `/api/downloads/manifest`(`main.py:428`)+ `/client/{name}`(`main.py:325`)+ sha256 缓存(`main.py:385`)——headless 后**保留**(LAN 部署仍需分发桌面端)。
- **P-7 客户端令牌注入 + desktop 检测**:`withCommon` 注 `X-YQGL-Client-Token`(`client.ts:25-30`)、`isDesktopRuntime`(`client.ts:8`)、`localClientToken`(`client.ts:16`)、Tauri `clientFetch` 的 token 注入 + base-URL 前缀(`tauri.ts:111-130`)——**逐字保留**,生成客户端在其上封装(N-2)。
- **P-8 状态获取双通道**:REST 拉真相、SSE 为增量(`client.ts` 各方法 + SSE hook 分离)——生成客户端不改变此约定(api-contract §7)。

### REFACTOR(改形不改契约)

- **R-1 剥离 SPA 静态托管**:删/禁用 `app.mount("/assets", ...)` 与 `spa_fallback`(`main.py:468-498`)。daemon 不再返回 `index.html`;web `dist` 移交独立静态服务器。`WEB_ROOT = Path("/srv/yqgl/web/dist")` 硬编码(`main.py:469`)随之删除(Master §6 铁律1、F1 去硬编码)。
- **R-2 路由按域重排**:`include_router` 块(`main.py:280-305`)重组为 api-contract §1 的分组顺序与 `tags`;新增 `session/proposal/review/agent-run/escalation/permission` 组的 router 文件(其 handler 由 F6/F8/F9/F10 提供,F11 只负责**挂载与前缀/tag 规范**),保证 `/openapi.json` 分组清晰。
- **R-3 `requirements→workitem` 端点改名**:`requirements.py`/`auto.py`/`sync.py`/`deliveries.py` 的 `/api/requirements/*`(如 `auto.py:54` `POST /requirements/{id}/auto-process` → `POST /api/workitems/{id}/agent-runs`)按 api-contract §2.4/§2.6 改名;**迁移期保留旧路径别名**(同一 handler 双 `@router.post` 装饰或 `APIRouter` 双 mount),deprecation header 标注。**CAS 模式不动**(`auto.py:84-93` `ready/summary_ready→ai_processing` 原子 CAS,api-contract §6.3)。
- **R-4 手写客户端 → 生成客户端**:`shared/src/api/types.ts`(手写)+ `shared/src/api/client.ts`(394 行,约 40 方法)→ 从 `/openapi.json` 生成类型,`client.ts` 改为「生成类型 + 薄 fetch 封装(保留 `withCommon`/`isDesktopRuntime`)」。方法签名对齐生成类型,消除手写类型与 DTO 漂移。
- **R-5 base-URL 可配**:`client.ts` 的相对 `/api` 路径(如 `"/api/auth/identify"` `client.ts:43`)经一个 `apiBase()` 解析——web 同源时为 `""`(向后兼容),web 独立部署时为 daemon 绝对 URL;Tauri 维持 `clientFetch` 的 base 前缀(`tauri.ts:116-121`)。
- **R-6 周期任务/恢复语义的多 worker 守卫(挂接点)**:`lifespan`(`main.py:236-267`)的 `_resume_stuck_jobs`(`main.py:255`)、`_periodic_knowledge_reindex`/`_periodic_partial_cleanup`(`main.py:257-258`)在多 worker 下需 leader 选举/锁——**实现属 F3/F5/F8**;F11 仅确认 headless daemon 的 `lifespan` 不因去 SPA 而破坏这些挂接点,并在 `--workers N` 下校验不重复跑。

### NEW(净新增)

- **N-1 OpenAPI 生成管线**:`shared/` 加 `openapi-typescript`(或等价)devDependency + npm script(`generate:api`),从运行中 daemon 或导出的 `openapi.json` 生成 `shared/src/api/generated/`。CI(F1 最小 CI)加「契约漂移检测」:生成产物与提交版不一致则 fail。
- **N-2 生成客户端封装层**:`shared/src/api/client.ts` 重写为基于生成类型的 typed fetcher,注入 `apiBase()` + `withCommon`(令牌/credentials)+ 统一错误抛出(沿用 `json()` 的 `!r.ok→throw` `client.ts:32-39`)。
- **N-3 web base-URL 配置**:web 加 `VITE_API_BASE_URL`(构建期)或运行时 `/config.json` 注入;`apiBase()` 读取之。SSE hook 同步用此 base 拼 `/api/push/stream*`。
- **N-4 跨域 CORS + cookie 收紧**:`config.py` 注释/校验明确「web 独立部署 ⇒ `cors_allow_origins` 必须列 web origin」;`auth.py` cookie 签发在跨域场景 `SameSite=None; Secure`(LAN http 同源时维持现状);`_validate_runtime_config` 补断言「production 下若 web 跨域则 origin 不得含 `*` 且 cookie 必 secure」。
- **N-5 SSE 新 topic 端点**:`routers/push.py` 增 `GET /api/push/stream/session/{id}`(owner 鉴权 + 短命 session 检查,照搬 `stream_one` `push.py:63-92`);`/stream/req/{id}` 接受 `workitem:{id}` 别名 topic(api-contract §5.3)。
- **N-6 客户端新 topic hook**:`shared/src/hooks/` 增 `useSessionStream`(消费 `session:{id}` 的 `agent_run.step`/`permission.ask`)、扩 `useReqStream` 消费 `agent_run.escalated`/`proposal.opened|reviewed|merged`/`knowledge.evidence.ready`;Tauri 经 `push-event` 单入口按 `data.event` 分发(无新 Tauri 事件,`desktop-pet-tauri.md §4.2`)。
- **N-7 Tauri 端点/事件对齐**:`commands/*.rs` 中改名端点路径对齐(如 `submitter.rs` 的 `/auto-process` → `/agent-runs`),`http.rs`/`tauri.ts` 不需结构改动(base-URL 与 token 已就绪);新事件按 `data.event` 在 webview 侧分发。
- **N-8 体验契约类型导出**:`shared/src/api/generated/` 或 `shared/src/types/workhub-experience.ts` 导出 `AttentionItem`/`QuestionCard`/`EvidenceRef`/`DeliverableChangeManifest`/`WorkHubEvent`/`CuuState`;若 OpenAPI 暂不能表达全部 union,先以 shared 手写类型承接,但必须进入 CI 类型检查。
- **N-9 Cuu 轻消费适配器**:`shared/src/events/toAttentionItem.ts` / `toCuuState.ts` 把正式 SSE 事件映射为 `AttentionItem` + `CuuState`;P0 不施工 pet window,但适配器必须可被主窗 bubble 和未来 pet window 复用。

---

## 实施步骤(有序、可勾选)

> 节奏对齐 Master §5.2 P0c。F11 在 F1–F10 全部就绪后施工;每步以 `--workers 1` 验证后再进 `--workers 2` 冒烟。

### 阶段 A — daemon headless 化与路由重排

- [ ] **A1** 删除 SPA 静态托管:移除 `app.mount("/assets", ...)`、`spa_fallback`、`WEB_ROOT` 硬编码(`main.py:468-498`);保留 `/downloads`、`/client/{name}`、`/api/downloads/manifest`。
- [ ] **A2** 校验 headless daemon:无 web/dist 时根路径返回 JSON(沿用 `main.py:492-498` 的 `root()` 分支作为唯一根),`/api/health` 正常(`main.py:308`)。
- [ ] **A3** 路由按域重排:把 `include_router`(`main.py:280-305`)重排为 api-contract §1 顺序,统一前缀/`tags`;为 F6/F8/F9/F10 提供的新组(session/proposal/agent-run/escalation/permission)挂载占位 router(handler 由各组件提供)。
- [ ] **A4** 导出 `openapi.json` 并人工核对分组与 DTO 命名(`FastAPI` 自动产出,`main.py:270`)。

### 阶段 B — `requirements→workitem` 端点改名

- [ ] **B1** 按 api-contract §2.4/§2.6 改名 `requirements.py`/`auto.py`/`sync.py`/`deliveries.py` 路径;每个改名端点**加旧路径别名**(双装饰/双 mount)+ deprecation 标注。
- [ ] **B2** 回归 CAS 与事件:确认改名后 `auto.py:84` CAS、`bus.publish("req:{id}"/"all", ...)`(`auto.py:100-101`)与 §6.3 原子约定不变。
- [ ] **B3** 更新 OpenAPI tag/summary 文案为「人话」(api-contract §6.1)。

### 阶段 C — OpenAPI 生成客户端

- [ ] **C1** 加 `openapi-typescript` 管线 + `npm run generate:api`,产物落 `shared/src/api/generated/`。
- [ ] **C2** 重写 `shared/src/api/client.ts` 为生成类型 + 薄 fetcher,保留 `withCommon`/`isDesktopRuntime`/`localClientToken`(`client.ts:8-30`)与 `json()` 错误语义(`client.ts:32-39`)。
- [ ] **C3** 引入 `apiBase()`(R-5/N-3):web env-driven base-URL,Tauri 维持 `clientFetch` base 前缀。
- [ ] **C4** 逐方法迁移 web 调用点至生成客户端(约 40 方法),`tsc` 零类型错误为门。
- [ ] **C5** CI 加契约漂移检测(生成产物 vs 提交版)。
- [ ] **C6** 导出体验契约类型(N-8):确保 `QuestionCard`/`EvidenceRef`/`DeliverableChangeManifest`/`WorkHubEvent`/`CuuState` 可被 Web 与 client-tauri web-src import;补 fixture type tests。

### 阶段 D — 跨域 CORS / cookie 重解(不削弱生产门)

- [ ] **D1** `config.py` 文档化「web 独立部署 ⇒ `cors_allow_origins` 列显式 origin」;本地默认仍 `["*"]` 仅 dev(`config.py:43`)。
- [ ] **D2** cookie 签发跨域适配:`SameSite=None; Secure`(跨域)/ 维持现状(同源 LAN);`cookie_secure`(`config.py:13`)在跨域 production 强制 `True`。
- [ ] **D3** **加固生产门**:`_validate_runtime_config`(`main.py:227`)补断言——production 下 `*` origin 拒绝(已有 `:232`),并新增「跨域 + cookie 非 secure → 拒绝」。
- [ ] **D4** 集成测试③:跨域 web 经 CORS preflight + cookie 鉴权成功,且 production 配置错误时 daemon 拒绝启动。

### 阶段 E — SSE 新 topic + 客户端 hook

- [ ] **E1** `routers/push.py` 增 `/stream/session/{id}`(owner 检查照搬 `stream_one` `push.py:63-92`),`workitem:{id}` 别名(N-5)。
- [ ] **E2** `shared/src/hooks/` 增 `useSessionStream` + 扩 `useReqStream` 新事件(N-6),base-URL 经 `apiBase()`。
- [ ] **E3** 新事件使用 `WorkHubEvent` envelope;hook 只读正式事件名,旧事件别名在迁移层兼容但不扩散。
- [ ] **E4** Tauri webview 按 `data.event` 分发新事件(`desktop-pet-tauri.md §4.2`),`sse.rs` 无结构改动。
- [ ] **E5** `toAttentionItem` / `toCuuState` 适配器覆盖 `permission.ask`、`proposal.opened`、`knowledge.evidence.ready`、`sync.conflict` 四类 Cuu 必备事件。

### 阶段 F — Tauri 最小改接

- [ ] **F1** `commands/*.rs` 改名端点路径对齐(B1 的镜像);`http.rs`(`:84` base-URL、`:68` token)零结构改动。
- [ ] **F2** webview 调用点用生成客户端类型(`web-src` 复用 `@yqgl/shared`)。
- [ ] **F3** 冒烟:Tauri onboarding(`test_server`→`/api/health`、`identify`、`register_device`)经新端点 + SSE 双流正常。

### 阶段 G — 端到端验收

- [ ] **G1** `--workers 2` 下 web(cookie)+ Tauri(token)经生成客户端访问 daemon,SSE 不丢、无跨用户泄漏(集成测试①③)。
- [ ] **G2** Master §8「web + Tauri 经 OpenAPI 生成客户端 + 跨域成功访问 daemon」勾选。

---

## 数据与接口契约

> **跨组件共享处以 Master + 规格为准**。F11 不定义实体/事件 taxonomy 本身,只负责**暴露与改接**。

### 实体字段 / Alembic

- F11 **不新增实体**,不产生 Alembic 迁移。`requirements→work_items` 表改名属 **F2/F3**(迁移清单 §2,牵动 15+ FK);F11 只对齐**端点路径与客户端类型**,依赖 F2/F3 的表/迁移已落地。

### API(改名 + headless,详契约见 api-contract)

| 现状(锚点) | WorkHub 端点 | F11 动作 |
|---|---|---|
| `POST /api/requirements/{id}/auto-process`(`auto.py:54`) | `POST /api/workitems/{id}/agent-runs`(api-contract §2.6) | 改名 + 旧别名 |
| `GET/POST /api/requirements*`(`requirements.py`) | `/api/workitems*` / `/api/requirements`(兼容)(§2.4) | 改名 + 别名 |
| `POST /api/requirements/{id}/accept`/`revisions`(`deliveries.py:226/267`) | `/api/proposals/{id}/review` + 现路径演进(§2.5) | 挂载演进组(handler 属 F9/F10) |
| 静态 `/assets` + SPA fallback(`main.py:469-498`) | (删除,daemon headless) | 剥离 |
| `/downloads`、`/client/{name}`(`main.py:325/340`) | 不变(LAN 分发) | 保留 |
| `GET /openapi.json`(FastAPI 自动) | 类型化客户端生成源(§0) | 稳定化 |

- **错误约定**:沿用 api-contract §6;非法状态转移收敛 `422`(§6.2 注),CAS 竞态 `409`(§6.3)。F11 改名不改错误码语义。
- **CORS/生产门**:api-contract §4 + `main.py:227-233`,逐字保留 + 跨域收紧(N-4)。

### 事件 topic(暴露,taxonomy 见 Master §6 铁律8 / api-contract §5.2)

| topic | 端点 | F11 动作 |
|---|---|---|
| `all` / `req:{id}`→`workitem:{id}` / `user:{id}` | `/stream`、`/stream/req/{id}`、`/stream/me`(`push.py:53/63/95`) | 保留 + `workitem` 别名 |
| `session:{id}` **[新]** | `GET /api/push/stream/session/{id}` | N-5 新增(owner 门) |
| `agent_run.started`/`agent_run.step`/`agent_run.escalated`/`permission.ask`/`permission.decided`/`proposal.opened`/`proposal.reviewed`/`proposal.merged`/`knowledge.evidence.ready`/`sync.*` | 经上述 topic | 客户端 hook 消费(N-6);正式名见 `_experience-deliverable-contracts.md` §4 |

- **隐私铁律(Master §6 铁律5、NFR-08)**:新 `session:{id}` 订阅前 owner 检查在**订阅边界**强制(照搬 `stream_one` 的短命 session `can_view`);`user:{id}` 仍由身份派生而非路径(`push.py:99`)。**禁止**「全量发 broker 客户端过滤」。

---

## 验收用例(可测)

1. **AC-headless**:`/srv` 无 `web/dist` 时,`GET /` 返回 JSON(非 `index.html`);`GET /assets/x.js` → 404;`GET /api/health` → `{status:"ok"}`。(R-1/A2)
2. **AC-openapi-client**:`npm run generate:api` 后 `shared` `tsc` 零错误;手写 `types.ts` 删除后 web 仍编译通过;CI 契约漂移检测在 DTO 改动未重生成时 fail。(N-1/R-4/C5)
3. **AC-rename-alias**:`POST /api/workitems/{id}/agent-runs` 与旧 `POST /api/requirements/{id}/auto-process` 均触发同一 CAS(`ready/summary_ready→ai_processing`),旧路径响应带 deprecation 标注;并发双击仍 `409`(api-contract §6.3)。(B1/B2)
4. **AC-cross-origin**:web 部署于不同 origin,CORS preflight 通过、cookie 跨域携带(`SameSite=None;Secure`)、鉴权成功(集成测试③)。(D1-D4)
5. **AC-prod-gate**:`app_env=production` + `cors_allow_origins=["*"]` → daemon `RuntimeError` 拒绝启动;production + 跨域 + cookie 非 secure → 拒绝(生产门未被削弱)。(P-1/D3)
6. **AC-sse-session**:订 `/stream/session/{id}`:owner 收 `agent_run.step`;非 owner → 403;`permission.ask` 仅到被路由人 `user:{id}`,他人订不到(无跨用户泄漏,集成测试①③)。(N-5/N-6)
7. **AC-stream-auth-light**:`/stream/session/{id}` 鉴权用 `require_stream_user`(不持 DB session),`can_view` 检查在短命 session 内完成后 `db.close()`,生成器无 DB 资源。(P-3)
8. **AC-tauri-rewire**:Tauri onboarding 全流程(`test_server`/`identify`/`register_device`/双 SSE 流)经新端点正常;`http.rs` base-URL/token 零结构改动。(F1-F3)
9. **AC-multiworker**:`--workers 2` 下 web+Tauri 双客户端经生成客户端 + SSE 访问,事件不丢、presence 正确、无泄漏(Master §8 功能门禁)。(G1/G2)
10. **AC-experience-types**:`QuestionCard`/`EvidenceRef`/`DeliverableChangeManifest`/`WorkHubEvent`/`CuuState` 可在 Web 与 client-tauri web-src 中类型导入;`.docx/.pptx/.xlsx/image/folder` manifest fixture 通过 `tsc`。
11. **AC-cuu-adapter**:`permission.ask`→`asking_approval`,`proposal.opened`→`carrying_document`,`knowledge.evidence.ready`→`searching_evidence`,`sync.conflict`→`worried`;适配器输出 `AttentionItem` 且 action 的 `requires_desktop` 被 Web 正确降级。

---

## 回滚与风险

### 回滚

- **分阶段、可独立回滚**:A(headless)/B(改名)/C(生成客户端)/D(跨域)/E(SSE)各为独立 PR。
- **headless 回滚**:R-1 删除的 SPA 托管以 feature flag(`SERVE_SPA` env)守门,回滚即重新挂载(保留 `main.py:470` 的 `is_dir()` 守卫逻辑)。
- **改名回滚**:旧路径别名(B1)在 deprecation 窗内**始终存在**,客户端可随时回退旧路径;别名删除是独立的后续 PR(P1+)。
- **生成客户端回滚**:保留手写 `client.ts` 于 git 历史;生成管线失败时可临时回退(但 `tsc` 门会暴露漂移)。

### 风险(对齐迁移清单 §3/§11 RISK + Master §9)

1. **web 同源假设是结构性的(迁移清单 §11 RISK)**:`shared/src/api/client.ts` 全程相对 `/api` + `credentials:"include"`(`client.ts:29`),「自然可用」依赖 daemon 同源托管 SPA。解耦后跨域 → CORS preflight + cookie `SameSite/secure` 必须重解,**且不削弱生产门**(`main.py:227`)。**缓解**:N-4 收紧而非放松;集成测试③专测;Tauri 路已用 token 不受影响(`tauri.ts:114-127`)。
2. **跨用户事件泄漏(NFR-08,有前科)**:新 `session:{id}` topic 与新事件若订阅边界漏 `can_view`,重现泄漏。**缓解**:照搬 `stream_one` 短命 session 门(`push.py:84`);`user:{id}` 身份派生;Master §6 铁律5。
3. **生产门被跨域改动无意放松**:为「让跨域跑通」而把 `cors_allow_origins` 放 `*` 或关 `cookie_secure`。**缓解**:P-1 逐字保留 + D3 加断言;AC-prod-gate 守门。
4. **改名牵动全 API 面 + 客户端 hook(Master §7「API 面对等」)**:漏改一处即客户端 404。**缓解**:旧别名兜底 + 生成客户端 `tsc` 门暴露漏改 + 逐文件清单(B1)。
5. **headless 后多 worker 周期任务重复跑**:去 SPA 不解决 `_resume_stuck_jobs`/reindex 的 leader 选举(`main.py:255-258`)。**缓解**:R-6 明确实现属 F3/F5/F8;F11 在 `--workers 2` 冒烟校验不重复(AC-multiworker),发布前 `--workers 1`(Master §6 铁律3)。
6. **OpenAPI 生成与 FastAPI DTO 漂移**:DTO 改了忘重生成。**缓解**:CI 契约漂移检测(C5)。
7. **体验契约被各端复制分叉**:Web、Rust 主窗、Cuu 各自手写 payload → 后续页面施工返工。**缓解**:N-8 shared 类型 + N-9 适配器集中;AC-experience-types/AC-cuu-adapter 守。

---

## 依赖与被依赖

### 依赖(F11 needs)

- **F1**(配置去硬编码:`WEB_ROOT`/`DOWNLOADS_ROOT` 经 settings;base-URL/CORS 配置块)。
- **F2**(`requirements→work_items` 实体改名,端点改名的实体侧)。
- **F3**(PG + Alembic 落地;多 worker 前提)。
- **F4**(鉴权链/设备门/`require_stream_user` 不变式;跨域 cookie 仍走此链)。
- **F5**(事件 broker 内核 + topic 鉴权门;新 SSE topic 暴露的后端)。
- **F6**(permission/approval 组 handler;`permission.ask` 事件源)。
- **F7**(provider 注册表;不直接耦合,但 agent-run 端点暴露其结果)。
- **F8**(Agent 引擎核心;`agent-run`/`agent_run.step` 端点与事件源)。
- **F9**(生命周期/通知;`agent_run.escalated` 对应通知路由、`notification.created` 收件箱事件源)。
- **F10**(审计/快照;proposal/review 端点的副作用契约)。
- **P0 横切体验契约**:`_experience-deliverable-contracts.md` 的 shared types / event names / Cuu state / manifest schema。

### 被依赖(needs F11)

- **P0 整体验收**(Master §8):「web + Tauri 经 OpenAPI 生成客户端 + 跨域成功访问 daemon」是 P0 出口门禁,F11 是其唯一交付者。
- **P0c 端到端冒烟**(Master §5.2):一条 work_item 经 AI 引擎产出 → 审计有快照 → 客户端经 OpenAPI/SSE 看到事件——客户端侧由 F11 提供。
- **P1+ 产品页**(web W1/W2 审批中心、提议详情;Tauri 桌宠窗/双向同步):全部建立在 F11 暴露的端点契约 + SSE topic 之上。
