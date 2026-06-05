---
title: WorkHub P0「地基」总体实现规划(Master Plan)
type: feat
status: active
date: 2026-06-05
origin: docs/brainstorms/2026-06-04-workhub-ai-native-platform-brainstorm.md
---

# WorkHub P0「地基」总体实现规划(Master Plan)

> 本文是 **整体规划**:定义 P0 地基的范围、组件分解(F1–F11)、依赖与关键路径、共享规范、里程碑门禁、跨切风险与验收。
> **每个组件的"系统级 plan"** 另存于 [`docs/plans/p0-foundation/`](./p0-foundation/),由本文索引。
> 上游:[Brainstorm](../brainstorms/2026-06-04-workhub-ai-native-platform-brainstorm.md) · [PRD](../prd/2026-06-04-workhub-prd.md) · [规格树](../workhub/README.md)。

---

## 1. 概要(Overview)

P0「地基」把现有 **需求管理大师**(FastAPI 单体 + SQLite 单 worker + Tauri/Web 客户端)的业务经验迁移演进为 **WorkHub 的可并发地基**:一个 **TS-first headless agent daemon**(Hono/Node + OpenAPI + SSE)+ **PostgreSQL** + **消息 broker**,把 `auto_agent` 的行为抽象成可复用的 **TypeScript Agent 引擎核心**,并补齐 **分层权限 / 审计快照 / provider 抽象** 等 AI-native 必需底座。

> **2026-06-05 技术路线修正**:后续施工默认以 TypeScript 为主语言。F1-F11 中仍出现的 FastAPI/SQLAlchemy/Alembic 口径保留为现有系统的行为锚点;真正新仓模块/端口/页面返回以 [`p0-foundation/_ts-first-module-port-page-alignment.md`](./p0-foundation/_ts-first-module-port-page-alignment.md) 为准。

**P0 不做**上层产品功能(智能派活、协作分支-提议-合并、桌宠 Cuu、双向同步、看板)——这些是 P1–P5。P0 只做"让上面这些能被稳地建起来"的地基。
但 P0 **必须先冻结体验与交付物契约**:选项式澄清、证据气泡、任意交付物变更申请、Cuu 事件状态、side-effect 快照红线的 payload/事件/验收门禁见 [`p0-foundation/_experience-deliverable-contracts.md`](./p0-foundation/_experience-deliverable-contracts.md)。这些不是 UI 施工,而是防止后续返工的 API/事件/数据契约。

> 决策依据(见 brainstorm):AI-native = 「Agent 提议 → 人确认」为默认;AI 一人两顶帽子;升级 = 置信度/风险分级。地基必须先支撑这套范式的**并发、事件、权限、审计**四根柱子。

## 2. 问题陈述(为什么需要 P0 地基)

现有单体有四个"假设单 worker"的进程内单例,**多 Agent + 多人并发下会静默出错**(`DEPLOY.md:97`):SSE bus、presence、AI 澄清并发槽、后台任务去重。AI-native 的核心是"AI 默认在后台大量干活",这与单 worker 天花板**直接冲突**。同时缺失:版本化迁移、provider 抽象、分层权限、通用快照/回滚。P0 就是拆掉这堵墙、补齐这些底座。

## 3. 范围(Scope)

**In(P0 必须):** 仓库脚手架与配置可移植化;实体迁移 + `requirements→work_items`;PostgreSQL + Drizzle migrations;鉴权/设备令牌移植;事件 bus → broker(解除单 worker);分层权限引擎骨架;LLM provider 注册表(改接 7 处行为锚点);Agent 引擎核心抽取(loop/工具注册表/沙箱/预算 + AgentRun 持久化);生命周期/通知扩展(登记新状态);审计 + 快照/回滚红线;headless daemon 拆分 + 客户端最小改接(OpenAPI 客户端 + 跨域);**TS-first 模块/端口/页面返回对齐**;**体验与交付物契约**(`QuestionCard`/`EvidenceRef`/`DeliverableChangeManifest`/正式事件名/`CuuState`)的 schema 与验收门禁。

**Out(明确推迟):** 智能派活(P2)、经理模式编排(P2)、分支-提议-合并的完整合并语义(P3)、双向同步(P3)、Cuu 桌宠完整动效窗与页面施工(P3/P4)、看板/度量(P4)、多租户公网(P5)。注意:推迟的是 UI/完整功能,不是上述 schema/事件契约。

**部署形态(决策 D-3):** P0 仍 **LAN-first**(延续设备令牌门),但架构去掉所有 `/srv/yqgl` 硬编码、为多 worker 与上云预留。

## 4. 目标架构(Target)

```
                 ┌──────────── WorkHub TS-first headless daemon (Hono/Node, N workers) ─────────┐
  Web (SPA)  ──► │  OpenAPI 路由组  │  TS Agent 引擎核心(loop/工具/沙箱/预算/AgentRun)         │
  Tauri 客户端 ─► │  鉴权/设备令牌门  │  分层权限引擎(allow/deny/ask)  │  审计+快照/回滚         │
  (+未来 Cuu)    │  Provider 注册表(DeepSeek-via-Anthropic 首发)                                │
                 └───────┬───────────────────────┬───────────────────────────┬──────────────────┘
                         │                        │                           │
                   PostgreSQL(实体+Drizzle)   Broker(Redis / PG LISTEN-NOTIFY)   沙箱工作目录
                   行级/乐观锁                  跨 worker SSE 事件 + presence
```

迁移策略(决策 D-1):**迁移现有地基再演进**,不重写。安全敏感代码(鉴权链、权限不对称、沙箱)**逐字移植**,不"顺手重构"。

## 5. 组件分解(F1–F11)—— 整体规划的核心

> 来源:对现有代码逐一核验的迁移清单(见 §12 引用)。每个组件的字段级 exists/port/refactor/new/risk 已在迁移清单中,本表给出**规划视角**;系统级展开见各组件 plan。

| ID | 组件 | 一句话目标 | 关键交付 | 依赖 | 首要风险 |
|---|---|---|---|---|---|
| **F1** | 仓库/构建脚手架 + 配置 | 可移植的 greenfield 骨架 | settings 重构、npm workspace、去 `/srv/yqgl` 硬编码、provider/budget 配置块 | — | 硬编码绝对路径散落在运行时代码(非仅 config) |
| **F2** | 实体与模型移植 | 35 实体迁入 + 新增实体 + `requirements→work_items` | 移植 35 类、加 `version`/`deleted_at`/tenant 列、新增 Branch/Proposal/AgentRun/ConfidenceRecord/EscalationEvent/Snapshot/PermissionPolicy/AuditLog/UserProfile/Org/Workspace | F1 | `requirements→work_items` 牵动 15+ 表 FK |
| **F3** | PostgreSQL + Drizzle migrations | 换库 + 真迁移体系 | 换 engine、删 SQLite PRAGMA 行为、init Drizzle schema/migrations、首迁移、类型审校(`utcnow`→`timestamptz`、Text-JSON→JSONB、String(32)→UUID) | F2 | 类型强转**静默出错**(naive datetime vs timestamptz) |
| **F4** | 鉴权/身份移植 | 双通道鉴权 + 设备门**逐字移植** | cookie+worker-token 优先级链、设备令牌门、`require_stream_user`、admin-claim、AI actor 一等身份 | F2 | token-beats-cookie 是已修过的 outage,**禁止重写** |
| **F5** | 事件 bus → broker | 解除单 worker 的事件半边 | `PushBus` 抽象 + Redis/LISTEN-NOTIFY 后端、`presence`→Redis、topic 鉴权门、新事件 taxonomy | F3(与 F3 **成对**解除单 worker) | broker 化后**跨用户事件泄漏**(NFR-08,有前科) |
| **F6** | 权限引擎 | 把"if 散落代码"变"规则在数据" | 移植纯函数检查、`PermissionPolicy`(org→workspace→role→session,默认 ask)、`ApprovalRequest` 阻塞原语+路由+SLA | F2, F4 | 外化时**不得放松**现有 admin 读/写/设备不对称 |
| **F7** | LLM provider 注册表 | 一个注册表,改接 7 处 | `registry.get(actor,task)`、成本计量、模型路由骨架 | F1(配置) | 高面广(7 文件 2 种调用),漏一处即静默绕过治理 |
| **F8** | Agent 引擎核心 | `auto_agent`→可复用引擎 | `AgentLoop`+`ToolRegistry`、沙箱/预算**逐字移植**、AgentRun/AgentStep 持久化、控制信号(continue/stop/compact/escalate)、doom-loop、AI 出请求进程进队列 | F3,F5,F6,F7 | 把分离任务竞态护栏从单 worker 移到行锁/乐观锁;沙箱 rlimit 仅 POSIX → **生产须 Linux** |
| **F9** | 生命周期/通知扩展 | 新状态不静默漏通知 | `_MILESTONES` 登记 `escalated/pm_mode/in_review/merged`、approver 路由 | F5,F2 | 状态变更脱离通知码路 = **隐形 outage**(有前科) |
| **F10** | 审计 + 快照/回滚 | AI 副作用可审可回滚(红线) | 统一 `AuditLog`、新 `Snapshot`+revert、**"快照失败⇒拒绝副作用"**、同事务快照+写 | F3,F8 | 通用业务对象逆操作是**净新设计**;不可逆写(已发外部通知)需先 ask-gate(未解,见开放问题) |
| **F11** | headless daemon 拆分 + 客户端改接 | daemon 去 UI,客户端连新 daemon | 剥离 SPA 托管、OpenAPI-first、生成类型化客户端、跨域 base-URL/CORS/cookie、路由分组重排 | 以上全部 | web 同源假设是**结构性**的,跨域 CORS+cookie 须重解且不削弱生产门 |

### 5.1 依赖图与关键路径

```
F1 ──► F2 ──► F3 ──┬─► F5 ─┐
                   ├─► F6 ─┼─► F8 ──┬─► F9 ─┐
        F1 ──► F7 ─┘       │        └─► F10 ┼─► F11
                   F4 ─────┘                │
                                            └────►(F11 暴露以上全部)
```
**关键路径:** `F1 → F2 → F3 → {F5,F6,F7} → F8 → {F9,F10} → F11`。
**可并行:** F7 不依赖 DB,可与 F3–F5 并行;F4 依赖 F2 即可早开;F9/F10 在 F8 后并行。
**成对约束:** **F3 与 F5 必须协同落地**——只换库不换 bus,第 2 个 worker 会静默丢 SSE(Top 风险 #1)。

### 5.2 P0 内部分期(建议施工节奏)

- **P0a 地基之地基(F1→F2→F3):** 仓库、实体、PG+Drizzle migrations。产出"能在 PG 上跑起来的空 TS daemon"。
- **P0b 平台柱子(F4,F5,F6,F7 并行):** 鉴权、事件 broker、权限引擎、provider 注册表。门禁:**多 worker 冒烟**(2 worker 下 SSE 不丢、presence 不错、无跨用户泄漏)。
- **P0c 汇聚与暴露(F8→{F9,F10}→F11):** Agent 引擎、生命周期/审计快照、daemon 拆分 + 客户端改接。门禁:**端到端冒烟**(一条 work_item 经 AI 引擎产出 → 审计有快照 → 客户端经 OpenAPI/SSE 看到事件)。

## 6. 共享规范与标准(每个组件都遵守)

1. **可移植:** 一切路径/URL/密钥经 `settings`;禁止 `/srv/yqgl` 类硬编码进运行时代码。
2. **PG/迁移:** TS-first 施工默认 Drizzle Kit migrations;若迁移期保留 Python 组件才允许 Alembic。新增可变实体带 `version`(乐观锁)与 `deleted_at`(软删除);JSON→JSONB;时间一律 `timestamptz`(消灭 naive `utcnow`)。
3. **单 worker→多 worker 铁律:** 任何进程内单例必须 broker 化或加 DB 锁;**F3 与 F5 成对发布**,之前不得 `--workers N`。
4. **安全敏感代码逐字移植(禁止重写):** 鉴权优先级链(`auth.py:104` token-beats-cookie)、权限读/写/设备不对称(`permissions.py`)、沙箱 rlimit/命令白名单/路径前缀(`auto_agent.py`)。
5. **隐私铁律(NFR-08):** broker 化后,`user:{id}` topic 由身份派生(非路径)、订阅前 `can_view` 门必须在**订阅边界**重新强制;禁止"全量发 Redis 客户端过滤"。
6. **AI 不静默改生产(红线):** AI 任何副作用先有 `Snapshot`(同事务),快照失败则拒绝执行;不可逆写须 ask-gate。
7. **通知不漏(铁律):** 任何状态机新节点必须登记进 `_MILESTONES`;状态变更脱离通知码路视为 bug。
8. **事件 taxonomy(供 F5,对齐桌宠概念):** 概念层事件包括 agent run、permission、proposal、confidence、escalation、knowledge、sync、revision、work completed 等;实现层正式事件名以 [`_experience-deliverable-contracts.md` §4](./p0-foundation/_experience-deliverable-contracts.md) 为准,旧概念名(如 `agent.run.started`、`proposal.ready`)只作别名说明,不得作为新增实现名。
9. **provider 单出口:** 所有 LLM 调用经 registry;低风险任务可路由廉价模型(NFR-05),每调用计量 token/成本。
10. **体验契约不回退:** P0 不施工完整页面,但所有新客户端可见 payload 必须能映射为 [`_experience-deliverable-contracts.md`](./p0-foundation/_experience-deliverable-contracts.md) 中的 `AttentionItem` / `QuestionCard` / `EvidenceRef` / `DeliverableChangeManifest` / `CuuState`;澄清主路径不得退化为纯打字聊天墙,Proposal 不得退化为代码 diff 专用。
11. **TS-first 单一心智:** API、Agent、权限、事件、审计、页面 VM、Web/Tauri webview/Cuu 适配器默认 TypeScript;Rust 只做本地壳;Python 只做可选文档 worker。模块/端口/页面返回以 [`_ts-first-module-port-page-alignment.md`](./p0-foundation/_ts-first-module-port-page-alignment.md) 为准。
12. **Gold Path 优先:** 所有 P0/P0.5 交付都必须能说明服务黄金路径哪一步;纵切验收以 [`_gold-path-p0-5-vertical-slice.md`](./p0-foundation/_gold-path-p0-5-vertical-slice.md) 为准。
13. **Eval/Replay 不可缺席:** AgentRun 必须可 replay;prompt/tool/model/schema 变更必须能跑 fixtures;门禁见 [`_agent-eval-replay-plan.md`](./p0-foundation/_agent-eval-replay-plan.md)。
14. **TS 目标路径审计:** 每个实现 PR 必须声明 Behavior source 与 Target TS paths;审计表见 [`_ts-target-path-audit.md`](./p0-foundation/_ts-target-path-audit.md)。

## 7. 系统级影响(System-Wide Impact)

- **交互图:** daemon 启动 → config/Drizzle migration 校验 → broker 连接 → 周期任务 leader 选举 → 路由就绪。一次 AI 运行:`POST /workitem/{id}/run` → 入 AgentRun 队列 → worker 取出 → AgentLoop(工具→沙箱→快照→事件 `run:{id}`)→ 完成判定 → ConfidenceRecord → 生命周期里程碑 → 通知 `user:{id}` + 审计。
- **错误传播:** LLM 瞬时错 → 退避重试(尊重 Retry-After);卡住 → doom-loop → 升级;超预算 → 结构化交接件(非静默 fail);快照失败 → 拒绝副作用。每类失败都是**可被客户端消费的 typed 事件**。
- **状态生命周期风险:** 分离 AI 任务的 start-CAS / settle-on-drift / revert-only-if-in-flight 三护栏(现靠单 worker SQLite)→ 必须改为行锁/乐观锁,否则多 worker 下重复执行或孤儿状态。
- **API 面对等:** `requirements→workitem` 改名牵动所有暴露同义能力的端点与客户端 hook;须统一改。
- **集成测试场景(单测 mock 抓不到):** ①2-worker 下 A 发事件 B 端收到;②PG 上 15 分钟 stuck-job 清扫按真实 timestamptz 触发;③跨域 web 经 CORS+cookie 鉴权成功且生产门不被削弱;④AI 写业务对象→快照存在→revert 还原;⑤新状态 `escalated` 触发通知到正确 approver。

## 8. 验收标准(P0 整体)

**功能门禁**
- [ ] daemon 以 `--workers 2` 运行:SSE 事件不丢、presence 正确、**无跨用户事件泄漏**(集成测试①③)。
- [ ] 全部 schema 经 Drizzle migrations;从空 PG 库可重建;无 `create_all`/运行时 ALTER。
- [ ] 7 处 LLM 调用全部经 provider 注册表(grep 无残留 `AsyncAnthropic(` 裸实例化)。
- [ ] 一条 `work_item` 走 Agent 引擎产出交付物;`llm_review` 判分;AgentRun/AgentStep 持久化且可重放 trace。
- [ ] AI 任一副作用有同事务 `Snapshot`;`revert` 可还原;快照失败则副作用被拒。
- [ ] 鉴权链、权限不对称、沙箱**逐字移植**并有回归测试覆盖既有不变式。
- [ ] web + Tauri 客户端经 **OpenAPI 生成的类型化客户端** + 跨域成功访问 daemon。
- [ ] `QuestionCard` / `EvidenceRef` / `DeliverableChangeManifest` / `WorkHubEvent` / `CuuState` 进入 shared/OpenAPI 类型或等价生成产物;至少 `.docx/.pptx/.xlsx/image/folder` 五类交付物 fixture 可生成变更申请 manifest。
- [ ] 新 SSE 事件使用正式事件名常量;不新增 `agent.run.started` / `proposal.ready` 等概念别名作为实现名;`permission.ask`、`proposal.opened`、`knowledge.evidence.ready`、`sync.conflict` 可映射到 Cuu 状态。
- [ ] P0.5 Gold Path 可用 fixture 完整跑通:option-first intake → AgentRun → Manifest → Proposal → approve/reject → replay。
- [ ] `GET /api/agent-runs/:id/replay` 返回 `ReplayTraceVM`;至少 12 个 eval fixtures 中 P0 必需项通过。
- [ ] 每个组件 PR 能通过 TS target path audit:声明 Behavior source、Target TS paths、contracts/db/events/page VM 归属。

**非功能门禁**:NFR-01 并发(多 worker)、NFR-02 安全(沙箱+权限+生产门)、NFR-03 审计、NFR-04 回滚、NFR-08 隐私(见 PRD §10)。

**质量门禁**:每组件 plan 有验收用例;§7 五个集成场景有自动化测试;关键路径组件(F3/F5/F8)有 code review。

## 9. 风险与缓解(Top 5 跨切 + 处置)

1. **解除单 worker 需 DB+broker 同时到位,半做即 split-brain(静默)。** → F3、F5 成对发布;发布前 `--workers 1`;门禁含 2-worker 冒烟。
2. **SQLite→PG 类型强转静默出错(naive datetime ↔ timestamptz)。** → F3 设"时间审校"专项任务,全仓 `utcnow` 清零;迁移后跑 stuck-job/dedup 时间逻辑回归。
3. **broker 化引入跨用户泄漏(有前科)。** → §6.5 隐私铁律;订阅边界重强制 `can_view`;集成测试③。
4. **权限外化放松既有不对称。** → 移植纯函数为基线回归;新引擎 admin 作为最高优先 allow-fallback 但保留读开/写仍 gated;precedence 单测覆盖。
5. **通用快照/回滚是净新设计、且 gate AI 安全。** → F10 先定"哪些写不可逆 → 必须 ask-gate"清单(解 PRD 开放问题 §10.5);MVP 先覆盖可逆写,不可逆写一律 ask。

## 10. 跨切关注(非单一组件)

- **可观测:** AgentRun trace、置信度、升级、成本看板(度量在 P4,但 P0 须埋点结构化日志/事件)。
- **测试策略:** §7 五场景 + Gold Path fixture 为集成测试基线;安全敏感移植件须回归;Drizzle migration drift check + Eval/Replay fixtures 必跑。
- **CI:** 现仓**无 CI**(`docs/ITERATIONS.md`)→ P0 顺手起最小 CI(lint + 迁移校验 + 冒烟),作为 F1 的一部分。

## 11. 每组件系统级 plan 索引

> 下列 11 份 plan 将各自展开:架构与文件改动清单(含 `file.py:line` 锚点)、实施步骤/子任务、数据/接口契约、验收用例、回滚、风险——即"系统级 plan"。

| 组件 | plan 文件(待生成) |
|---|---|
| F1 仓库/配置 | `p0-foundation/F01-repo-scaffold-config-plan.md` |
| F2 实体模型 | `p0-foundation/F02-entities-models-port-plan.md` |
| F3 PG+Drizzle migrations | `p0-foundation/F03-postgres-alembic-plan.md` |
| F4 鉴权身份 | `p0-foundation/F04-auth-identity-plan.md` |
| F5 事件 broker | `p0-foundation/F05-event-bus-broker-plan.md` |
| F6 权限引擎 | `p0-foundation/F06-permission-engine-plan.md` |
| F7 provider 注册表 | `p0-foundation/F07-llm-provider-registry-plan.md` |
| F8 Agent 引擎核心 | `p0-foundation/F08-agent-engine-core-plan.md` |
| F9 生命周期/通知 | `p0-foundation/F09-lifecycle-notifications-plan.md` |
| F10 审计/快照/回滚 | `p0-foundation/F10-audit-snapshot-rollback-plan.md` |
| F11 daemon 拆分/客户端改接 | `p0-foundation/F11-headless-daemon-client-rewire-plan.md` |
| P0 横切体验与交付物契约 | `p0-foundation/_experience-deliverable-contracts.md` |
| P0 横切 TS-first 模块/端口/页面返回 | `p0-foundation/_ts-first-module-port-page-alignment.md` |
| P0.5 Gold Path 纵切 | `p0-foundation/_gold-path-p0-5-vertical-slice.md` |
| Agent Eval / Replay | `p0-foundation/_agent-eval-replay-plan.md` |
| TS 目标路径审计 | `p0-foundation/_ts-target-path-audit.md` |
| 交互改善与拓展 backlog | `p0-foundation/_interaction-extension-backlog.md` |
| P-COST 成本治理专篇 | `../workhub/02-ai-engine/cost-governance.md` |

## 12. 来源与参考

- **Origin brainstorm:** [docs/brainstorms/2026-06-04-workhub-ai-native-platform-brainstorm.md](../brainstorms/2026-06-04-workhub-ai-native-platform-brainstorm.md) —— 关键决策:AI-native 默认驾驶、一人两顶帽子、升级=置信度/风险分级、迁移而非重写、PG、LAN-first。
- **PRD:** [docs/prd/2026-06-04-workhub-prd.md](../prd/2026-06-04-workhub-prd.md)(§7 数据模型、§8 机制、§10 NFR、§12 分期)。
- **规格树:** [docs/workhub/](../workhub/README.md) —— 尤其 `01-architecture/*`、`02-ai-engine/agent-loop-and-tools.md`、`02-ai-engine/cost-governance.md`。
- **概念图:** [`05-clients/page-concepts.md`](../workhub/05-clients/page-concepts.md)、[`cuu-desktop-pet-concept.md`](../workhub/05-clients/cuu-desktop-pet-concept.md)、[`ts-first-runtime-concept.png`](../workhub/05-clients/assets/shared/ts-first-runtime-concept.png)、[`endpoint-page-cuu-alignment.png`](../workhub/05-clients/assets/shared/endpoint-page-cuu-alignment.png)(P0 仅取事件 taxonomy、共享类型、端口与页面返回边界;Cuu/页面完整施工属 P3/P4)。
- **P0 体验与交付物契约:** [`p0-foundation/_experience-deliverable-contracts.md`](./p0-foundation/_experience-deliverable-contracts.md) —— P0 必须冻结的 `QuestionCard`、`EvidenceRef`、`DeliverableChangeManifest`、正式事件名、`CuuState`、side-effect 红线门禁。
- **P0 TS-first 对齐计划:** [`p0-foundation/_ts-first-module-port-page-alignment.md`](./p0-foundation/_ts-first-module-port-page-alignment.md) —— P0 默认 TS 技术栈、模块目录、端口、路由组、Page VM、Endpoint→Page→Cuu 映射。
- **P0.5 Gold Path:** [`p0-foundation/_gold-path-p0-5-vertical-slice.md`](./p0-foundation/_gold-path-p0-5-vertical-slice.md) —— 从一句话需求到 Proposal 合并和 Replay 的最小纵切。
- **Eval / Replay:** [`p0-foundation/_agent-eval-replay-plan.md`](./p0-foundation/_agent-eval-replay-plan.md) —— Agent 可靠性、golden fixtures、ReplayTraceVM、CI/nightly eval 门禁。
- **TS 目标路径审计:** [`p0-foundation/_ts-target-path-audit.md`](./p0-foundation/_ts-target-path-audit.md) —— F1-F11 旧行为锚点到 TS 目标路径的审计表。
- **交互 backlog:** [`p0-foundation/_interaction-extension-backlog.md`](./p0-foundation/_interaction-extension-backlog.md) —— Cuu 轻/重交互、Inbox Zero、Remember Rule、Evidence Confidence 等 P1+ 增强。
- **迁移清单(本规划的代码级依据):** 由 repo-research 对现有代码逐一核验生成,关键锚点:`app/db.py:14-17`、`app/models.py:328`、`app/main.py:227/255/469`、`app/services/push_bus.py:23-47`、`app/auth.py:104/183`、`app/services/permissions.py:50-119`、`app/services/auto_agent.py:34/374/544`、`app/services/notifications.py:105`、`app/services/lifecycle.py:31`、7 处 LLM 实例化(auto_agent/llm_agent/drive_comment_agent/meeting_agent/delivery_doc/task_decomposition/assistant)。

---

*下一步:为 F1–F11 各生成"系统级 plan"(见 §11)。*
