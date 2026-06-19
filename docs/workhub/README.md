# WorkHub —— 产品规格文档树(Spec Tree)

> **业务版 GitHub × AI-native 工作中台。AI 是默认劳动力,人是审批者与异常处理者。**
> 本目录按"全新项目"组织。上游:[PRD](../prd/2026-06-04-workhub-prd.md) · [Brainstorm](../brainstorms/2026-06-04-workhub-ai-native-platform-brainstorm.md)。
> 研究参照:`D:/02_代码与开发/_workhub_research/opencode`。
> 状态(2026-06-20):**170 篇文档已落盘**。**2026-06-20 第四轮全量代码审查（137-agent，24 单元=逐行+4 链路追踪+提示词专项，对抗式验证）已出并已 fix-all**：107 原始→39 真发现（1 高 globMatch-ReDoS / 10 中 / 28 低）；**38 修复全程 main CI 绿（13 commit R4-1..R4-9c）+ #38 项目码前缀碰撞缓办（需决策）**；真 DeepSeek key provider 级 live e2e 3/3 通过（验证 R4-7 的 #31 abort / #32 空闲超时不砍健康流 / #33 事件释放）；3 个 must-have-now 缺口 + 余排 roadmap；详见 [`06-roadmap/full-codebase-audit-round4-2026-06-20.md`](./06-roadmap/full-codebase-audit-round4-2026-06-20.md)。**2026-06-19 第三轮全量代码审查 + 团队就绪度分析已出并已 fix-all**（多智能体逐行审查 + 8 链路追踪 + 对抗式复核：2 高 + 26 中 + 22 提示词质量 + 71 团队缺口 8must/44should/19nice；含独立复验 #43 LLM abort=HIGH、新发现工作项创建跨工作区写/提议编辑器 href XSS/锁定不重置等；详见 [`06-roadmap/full-codebase-audit-round3-2026-06-19.md`](./06-roadmap/full-codebase-audit-round3-2026-06-19.md)）。**2 高 + 26 中 + 22 提示词发现已全部修复、全程 main CI 绿**（16 批 + read-authz scope 热修），并以真 DeepSeek key 跑通 provider 级 live 实测（含 A1 abort/timeout 真验）；团队缺口里有界项已落地，余项排进 [`06-roadmap/team-readiness-gap-roadmap-2026-06-19.md`](./06-roadmap/team-readiness-gap-roadmap-2026-06-19.md)（EPIC 项 plan-first）。**2026-06-17 第二轮全量代码审查 + 团队就绪度分析已出**（180 真问题 18H/44M/118L + 67 团队缺口；详见 [`06-roadmap/full-codebase-audit-and-team-readiness-2026-06-17.md`](./06-roadmap/full-codebase-audit-and-team-readiness-2026-06-17.md)）。**2026-06-18：审查安全修复范围全部收口、CI 全绿**（18H 15 修 + ~23M + LOW 27 APPLY 全修，19 对抗驳回；剩判断/架构项）；用户拍板把剩余三大「团队就绪地基」XL epic 走 plan-first——**三份 epic 计划已落（待拍板 open questions 后实施）**：[`06-roadmap/r2-epic-auth-plan-2026-06-18.md`](./06-roadmap/r2-epic-auth-plan-2026-06-18.md)（真认证：密码 + 可插拔 OIDC）、[`06-roadmap/r2-epic-multi-tenancy-plan-2026-06-18.md`](./06-roadmap/r2-epic-multi-tenancy-plan-2026-06-18.md)（多租户隔离强制）、[`06-roadmap/r2-epic-atomic-budget-plan-2026-06-18.md`](./06-roadmap/r2-epic-atomic-budget-plan-2026-06-18.md)（原子预算预留）。**R6「复利劳动力」八阶段全部竣工、CI 全绿**（V0 靛蓝 token / A0 AI 战绩 / W1 决策收件箱首页 / M1 用户记忆 / S2 团队 skill 自迭代 / P3 桌宠情绪气泡 / **W2 审批中心 diff 工作台（全量含评论流，6 增量 + 对抗式验收 12 项加固）** / C4 卖萌文案）；**全项目多 agent 深度 review 出的 87 个真问题（3C+14H+27M+43L）已全部处置、CI 全绿**（详见 [`06-roadmap/full-project-review-2026-06-14.md`](./06-roadmap/full-project-review-2026-06-14.md)）。**权威施工顺序 = [`06-roadmap/s1-pilot-readiness-roadmap-2026-06-12.md`](./06-roadmap/s1-pilot-readiness-roadmap-2026-06-12.md)**（北极星 = 真实团队用核心闭环干一周活）。**S1 序列 R5.9–R5.12 全部竣工 → 系统代码已 pilot-ready**；**R5.10-dry + R5.10-real 已通过**：dry 在本机 PG16 跑完需求→AgentRun→proposal→审批→合并→accepted ledger→replay→download；real 用 DeepSeek 真 provider 跑完 6 个 AgentRun，T1–T4 质量全达标、T5 升级、B1 预算护栏，真实成本 `0.142346 CNY`。**S1 Pilot Launch Gate、Day 0 Real Work Entry、Day 1 Feedback + Observability、Day 2 Feedback Hardening 均已通过，Day 3 已 ready-to-invite-and-observe**：Docker Desktop + pilot compose 真实栈完成起栈、真实 `/intake` 到 WorkItem/AgentRun/Proposal/Replay/Cost、第二用户非 admin 路径、post-run WorkItem clarity、browser QA resume/idempotency、QA artifact triage、六指标 API/CLI、backup/restore、管理员注册、Cost/Settings 中英 UI 与 fresh pilot 导航复验；Day3 preflight 已确认 opened proposal / active run / pending approval 均为 `0`，observation audit 已要求显式真实参与者昵称。**2026-06-15 补充**：已修复 pilot API 因 `pg.Pool` idle client error 未处理而退出的问题，重建 compose 后三服务 healthy，`/api/health` ok。下一施工线为 [`s1-pilot-day3-expansion-plan-2026-06-13.md`](./06-roadmap/s1-pilot-day3-expansion-plan-2026-06-13.md)。

---

## 0. 怎么读这棵树

- **PRD** = WHAT/WHY 的总纲(一篇)。
- **本规格树** = 把 PRD 拆到"屏级 / 接口级 / 功能级"的细化(多篇,按模块)。
- **plan**(后续)= HOW:文件改动、构建顺序。
- 每篇文档头部带 `module / layer / status / owner`;状态:`📝待写 / 🚧进行 / ✅初稿 / 🔒评审通过`。

### 0.1 当前状态与最近里程碑

| 阶段 | 状态 | 当前结论 |
|---|---|---|
| R4.19-pre/R4.19 | ✅ | true React mount spike、Proposal split migration 与 dirty SSE guard 已落。 |
| R4.20/R4.21 | ✅ | app-level SSE、Page VM local refetch、Last-Event-ID/cursor、fixture chrome 退役与 shared web runtime 已落。 |
| R4.22/R4.23 | ✅ | Proposal structured field scalar 与 text hunk line editor 已成为真实可见 React mutation islands。 |
| R4.24 | ✅ | hash route 写入清理、README 治理、browser smoke CI 拆分计划与 R5 业务纵切拍板已落。 |
| R5.1 | ✅ | Drive Page VM/API/Web route 已落，承接 accepted deliverables、Drive versions、preview/download/restore 与 comment draft link。 |
| R5.2 | ✅ | Drive upload/recycle/operation log、project 权限门、shared mapper 与 46 步 browser gate 已落。 |
| R5.3 | ✅ | Drive comment-to-draft / WorkItem 草稿链路已落，47 步 browser gate 覆盖 request proof、notice、operation log 与无溢出。 |
| R5.4 | ✅ | Drive draft-to-proposal 已落，50 步 browser gate 覆盖 source context、proposal action/link 与 operation log。 |
| R5.5 | ✅ | Meeting insight-to-draft 已落，55 步 browser gate 覆盖 meeting page、draft、source context、proposal action/link 与移动端无溢出。 |
| R5.6 | ✅ | Schedule / Notify 已落，`/notifications` 收件箱分组、`/calendar` 周视图、mark read/dismiss/complete + audit，63 步 browser gate 与 request proof 全过。 |
| R5.7 | ✅ | Knowledge grounding / dashboard health 已落，`/dashboard/health` admin 数值 / member 档位分层、通知 grounding 与 `source_ref` 证据回链，66 步 browser gate 全过。 |
| R5.8 | ✅ | Browser smoke 已进 CI：`web-live-route-smoke` job 64 秒跑完 66 步 / 114 gates；首跑抓出 Linux CJK 行高裁切并修复（16 处行高 → 1.35）。 |
| S1 序列 | active | **北极星迭代计划已立**：[s1-pilot-readiness-roadmap](./06-roadmap/s1-pilot-readiness-roadmap-2026-06-12.md)，R5.9–R5.12 消三大差距（注册流/真实 LLM 验证/部署包 + 权限审计）；Launch Gate、Day 0、Day 1、Day 2 已过，Day 3 ready-to-invite-and-observe；2026-06-15 runtime stability 修复已恢复 pilot 服务；OQ-4 护城河走 pilot 数据驱动。 |
| R5.9 | ✅ | Onboarding 已落：注册屏（昵称+locale+admin 口令）、登出、deep link 保持、第二用户切换；自动注册已删除；70 步 smoke 全过（P1-6 关闭）。 |
| R5.10-pre | ✅ | Agent 能力强化已落：真·上下文压缩、tool_result 截断、工人合同 prompt、HTTP/fetch-level 瞬态重试、`LLM_MAX_TOKENS_PER_STEP`、llm_review 五档接入 R0 置信度权重；agent 30 测全过。 |
| R5.10 | ✅ | dry + true-key 全过：6 个真实 AgentRun，T1–T4 人工质量 4/4 达标，T5 信息不足不编造，B1 预算护栏升级，成本/ledger/confidence 全留证。 |
| R5.11 | ✅ | Pilot 部署包已落：单镜像（API+Web 单源）+ compose 全栈自动迁移 + JSON 结构化日志 + DEPLOY.md + 备份脚本；CI `pilot-stack-smoke` 全绿，admin 认领自举（口令错误 403 fail-closed）。 |
| R5.11.1 | ✅ | 沙箱能力库 + 预设技能：AI 工人可直接交付 Word/Excel/PPT/中文统计图表/数据分析/自验脚本；七技能合同防 API 幻觉，CI 容器内生成冒烟全过。 |
| R5.12 | ✅ | 权限矩阵审计完成（P1-4 关闭）：79 路由全清点（业务路由已全 401 fail-closed），修复 audit 跨用户读 + permissions 治理面越权两洞，新增常驻路由 fail-closed 门。**S1 pilot-ready**。 |
| S1 Launch Gate | ✅ | Docker Desktop + pilot compose 现场门通过；dry/real、backup/restore、管理员注册、Cost/Settings 中英截图和 fresh pilot 稳定导航均留证，并修复旧 `r4-live-*` seed 链接泄漏。 |
| S1 Day 0 | ✅ | 真实 `/intake` 入口、Project bootstrap、WorkItem `DAY0PILOT-006`、AgentRun、Proposal merge、Replay/Cost、backup/restore 全绿；修复 worker 缺 WorkItem context 与 0 成本默认值。 |
| S1 Day 1 | ✅ | 第二用户非 admin 路径、Day1 真实任务 intent/free text、Proposal merge、Replay/Cost、六指标 API/CLI、feedback log、backup/restore 全绿。 |
| S1 Day 2 | ✅ | post-run WorkItem clarity、QA resume/idempotency、opened QA artifact triage、六指标 baseline、backup/restore 全绿。 |
| S1 Day 3 | observe-ready ✅ | `qa:s1-day3-preflight` 与 `qa:s1-day3-observation` 已准备：队列干净，metrics 与 Day2 baseline 可比，等待 1-3 位真实使用者进入 `/intake`。 |
| S1 Runtime Stability | ✅ | 修复 `pg.Pool` idle client error 未监听导致 pilot API 进程退出；DB 单测、全仓 typecheck、compose rebuild、health/ps 全绿。 |
| R6 复利劳动力 | ✅ | 方向 [r6-compounding-ai-labor-plan](./06-roadmap/r6-compounding-ai-labor-plan-2026-06-14.md)：八阶段 V0/A0/W1/M1/S2/P3/W2/C4 全竣工、CI 全绿。决策收件箱首页 + AI 战绩 + 团队 skill 自迭代（AI 全自动晋升、人类事后 kill-switch）+ 用户级 memory + 桌宠 5 情绪 3 气泡；目标=AI 劳动力复利、人逐步减负。 |
| 全项目深度 review | ✅ | 多 agent + 对抗验证出 87 真问题（3C+14H+27M+43L），按严重度分批全部处置、CI 全绿（迁移 0016/0017/0018）；仅首页 SSE 架构项 spawn 缓办、2 架构项注释归档。详见 [full-project-review](./06-roadmap/full-project-review-2026-06-14.md)。 |
| R6 W2 审批工作台 | ✅ | [r6-w2-approval-workbench-plan](./06-roadmap/r6-w2-approval-workbench-plan-2026-06-14.md)：审批中心升级为概念图④「三栏 diff 工作台」（左可选列表+SLA / 中 before→after 对比+合规检查+AI 解释+冲突 / 右 决策+记住规则+审批流程时间线+评论流），6 增量（含迁移 0019 approval_comments）+ 对抗式验收 12 项加固（IDOR/越权/无界查询/N+1 全清零），CI 全绿。 |

---

## 1. 产品呈现模式(三端一核)

WorkHub 不是单一 app,而是**一个 headless 核心 + 多个瘦客户端**(借鉴 opencode):

| 代号 | 呈现模式 | 技术 | 职责 | 用户 |
|---|---|---|---|---|
| **C-DAEMON** | 后端核心(Agent 守护进程) | **TypeScript / Hono / Node 22** + OpenAPI + SSE;现有 Python/FastAPI 只作行为锚点与可选 worker 来源 | 所有业务逻辑、AI 引擎、权限、事件流。唯一真相源。 | (无 UI) |
| **C-WEB** | Web 应用 | React + Vite + TS | 派活/管理/审批/看板;浏览器可达的一切。 | 负责人 / 提交者 / 管理员 |
| **C-PET** | 桌面宠物客户端 | Tauri v2 + Rust + React webview | 接活/干活专属;桌宠入口、本地同步、本地 Agent 能力、托盘/通知/deep-link。 | 协作人 / 小白 |
| **C-UIKIT** | 共享设计系统 | `@yqgl/shared`(演进) | 跨端组件、tokens、API client、类型。 | (内部) |

> **设备令牌门**延续:接活/干活类高权限操作要求桌面客户端(服务端校验),浏览器只能派活/审批。

---

## 2. 模块地图(有哪些模块 / 模块功能)

### 2.1 业务功能模块(看得见的功能)

| 模块 | 代号 | 核心功能 | 现有代码锚点 |
|---|---|---|---|
| 需求 / 工作项 | **M-WORKITEM** | 主轴:intake→澄清→执行→分级→审批→合并;状态机;派生 | `models.py:314/328` |
| 项目 + 网盘 | **M-DRIVE** | 项目、文件树、版本、回收站、操作日志、评论触发 LLM | `models.py:167/192/214/228` |
| 会议 → 洞察 | **M-MEETING** | 音频/文本→ASR→纪要→洞察→需求草稿(人确认) | `models.py:269/291` |
| 任务/提醒/通知 | **M-NOTIFY** | 待办、排期、提醒、通知(去重/变更检测);桌宠呈现 | `models.py:146/250` |
| 知识库 | **M-KNOWLEDGE** | grep 语料 + 强制引用的问答(无向量库) | `models.py:110/128` |
| 看板 / 度量 | **M-DASHBOARD** | 项目健康、自治率、升级精准度、成本看板 | (新增为主) |

### 2.2 平台 / 横切能力(撑起 AI-native 的底座)

| 能力 | 代号 | 核心功能 |
|---|---|---|
| AI 引擎 | **P-AI** | 工人引擎 / 项目经理模式 / 置信度风险分级 / 智能派活 / 可解释 |
| 协作 | **P-COLLAB** | 去黑话分支-提议-合并 / 审批 / 双向同步 / README=规格 |
| 身份 | **P-IDENTITY** | 用户 / 技能档案 / 协作图 / Org / 角色 |
| 权限与审批 | **P-PERM** | 分层 allow/deny/ask 策略 / 审批路由 / SLA / 委派 |
| 审计与回滚 | **P-AUDIT** | 按身份全量审计 / AI 副作用快照与 revert |
| 成本治理 | **P-COST** | 用户/团队/任务三级预算配额 / 模型路由 / 成本计量 / 超额动作 |

---

## 3. 文档树(逐篇 + 范围界定)

> 每篇的"范围"即它要写到的深度边界,也是后续逐篇深写的任务说明。

### 00-overview/
| 文档 | 范围 | 状态 |
|---|---|---|
| `vision-and-principles.md` | 愿景、产品宪法×5、定位、非目标(从 PRD §3/§5 展开) | ✅ |
| `personas-and-jtbd.md` | 5 类画像的详细场景、痛点、JTBD、成功标准 | ✅ |
| `glossary-dejargon.md` | 全量术语表 + git 黑话→用户用语映射(权威版) | ✅ |

### 01-architecture/
| 文档 | 范围 | 状态 |
|---|---|---|
| `system-architecture.md` | daemon+clients 总图、进程边界、SSE/WS 事件流、部署拓扑 | ✅ |
| `data-model.md` | 全量实体、字段、ER 图、WorkItem 状态机全转移、软删除/审计字段 | ✅ |
| `api-contract.md` | OpenAPI 路由组(session/workitem/proposal/permission/event/sync…)、事件类型清单、鉴权中间件 | ✅ |
| `tech-stack-and-migration.md` | 选型(TS-first/Hono/Drizzle/PG/Tauri/provider)、Python 行为锚点→新仓 TS 重写清单、复用映射 | ✅ |
| `security-and-permissions.md` | 威胁模型(LAN→云重审)、设备令牌门、RBAC、分层 permission 策略 | ✅ |

### 02-ai-engine/
| 文档 | 范围 | 状态 |
|---|---|---|
| `agent-loop-and-tools.md` | 工人循环、控制信号、工具契约与注册表、沙箱、预算、doom-loop、快照 | ✅ |
| `r2-agent-run-claim-lease.md` | **R2.1**:AgentRun PG claim/lease、`FOR UPDATE SKIP LOCKED`、heartbeat、stuck run recovery primitive 与 queue 执行合同 | current |
| `r2-multi-worker-pump.md` | **R2.2**:同 work item active run 唯一、DB 原子 enqueue、route `runNext()` drain 与 PG smoke hook | current |
| `r2-redis-broker-presence.md` | **R2.3**:Redis PushBus / Presence 跨 worker 后端、unsubscribe 竞态门、生产多 worker broker 配置与验收证据 | current |
| `r2-topic-boundary.md` | **R2.4**:SSE topic 授权边界，`all` admin-only，资源 topic fail-closed，Cuu/Web 共用同一订阅门 | current |
| `r2-pg-redis-heartbeat-matrix.md` | **R2.5**:长 provider call interval heartbeat、真实 WorkItem/Proposal topic resolver、Postgres + Redis CI smoke | current |
| `r2-recovery-rest-auth.md` | **R2.6**:stuck AgentRun 后台恢复调度、Proposal/Approval REST 与 Page endpoint 的 WorkItem 资源权限收口 | current |
| `r2-release-gate.md` | **R2.7**:R0/R1/R2 静态门、CI smoke、文档口径与提交纪律的可复跑 release gate report | current |
| `cost-governance.md` | **P-COST**:三级预算、模型路由、成本计量、超额动作、成本 Page VM / 事件契约 | ✅ |
| `confidence-risk-escalation.md` | **命门**:置信度来源与算法、风险维度与评分、分级阈值、三触发器、打回回灌 | ✅ |
| `pm-mode-orchestration.md` | 项目经理模式:激活、简报、排期、催办、再审 | ✅ |
| `smart-staffing.md` | **旗舰**:输入信号、匹配逻辑、提议格式、冷启动降级、纠正回流 | ✅ |
| `explainability.md` | 决策可解释、grep 引用、trace 呈现 | ✅ |

### 03-collaboration/
| 文档 | 范围 | 状态 |
|---|---|---|
| `branch-proposal-merge.md` | 分支/提议/合并的数据与流程、并发、冲突 AI 调解、对象合并语义 | ✅ |
| `review-and-approval.md` | 审批阻塞原语、打回带理由回灌、审批路由、SLA、委派、"永远允许"学习 | ✅ |
| `sync-and-spec.md` | 双向同步协议、冲突解决、离线、README=规格活文档 | ✅ |

### 04-modules/(业务模块逐个,含 web/桌宠两端呈现)
| 文档 | 范围 | 状态 |
|---|---|---|
| `requirements-workitem.md` | M-WORKITEM 全功能:字段、流转、派生、验收项、两端 UI | ✅ |
| `projects-and-drive.md` | M-DRIVE 全功能:文件树/版本/回收站/操作日志/评论 LLM、两端 UI | ✅ |
| `meetings-and-insights.md` | M-MEETING:录制/上传/ASR/纪要/洞察/草稿、两端 UI | ✅ |
| `tasks-reminders-notifications.md` | M-NOTIFY:待办/排期/提醒/通知规则、桌宠呈现 | ✅ |
| `knowledge-base.md` | M-KNOWLEDGE:语料构建、检索、引用问答 | ✅ |
| `dashboards-and-metrics.md` | M-DASHBOARD:各看板指标定义与图表 | ✅ |

### 05-clients/(产品呈现模式逐端)
| 文档 | 范围 | 状态 |
|---|---|---|
| `web-app.md` | **C-WEB**:信息架构、路由/页面清单、关键组件、状态管理、实时订阅、空/错/载入态 | ✅ |
| `desktop-pet-tauri.md` | **C-PET**:Rust 侧能力(托盘/通知/提醒/deep-link/spec_watch/双向同步)、桌宠窗口与人格、本地 Agent、webview↔Rust 边界、安装/更新 | ✅ |
| `page-concepts.md` | **C-WEB/C-PET**:页面概念图索引,覆盖 Web、Rust 客户端、桌宠/澄清/检索视觉方向 | concept |
| `cuu-desktop-pet-concept.md` | **C-PET/Cuu**:Cuu 只在独立桌宠窗口出现;黑猫/白猫 Live2D 形象、动效状态、审批/检索气泡、选项优先澄清概念图 | current |
| `cuu-live2d-cat-options-current-plan.md` | **C-PET/Cuu/Live2D**:当前唯一可选模型包为黑猫 Hijiki 与白猫 Tororo;定义源码、QA、偏好页、真实录屏验收收束口径 | current |
| `cuu-r3-agent-entry.md` | **C-PET/Cuu/R3**:option-first Agent launcher、`sessions -> workitems -> agent-runs` 三段真实 API 链、run stream 回流、错误卡、Rust 边界、R3.3 验收计划 | current |
| `i18n-locale-contract-p1-1.md` | **C-WEB/C-PET/Cuu/Contracts**:中英双语 locale 合同、API Page VM query/meta、typed client、Cuu 固定文案与后续多语言路线 | current |
| `i18n-nongoldpath-render-helpers-p1-2.md` | **C-WEB/C-PET/C-UIKIT**:非 Gold Path helper 固定文案双语、可见 enum 人话标签、Web/Desktop facade locale 接线 | current |
| `i18n-user-locale-preference-p1-3.md` | **C-WEB/C-PET/Identity**:用户 locale 偏好持久化、`PATCH /api/auth/preferences`、Web/Desktop/Pet 共享 `workhub.locale` | current |
| `pet-right-click-settings-menu-p1-4.md` | **C-PET/Cuu/Tauri**:独立 pet window 右键轻菜单,黑猫/白猫、中文/EN、悬停避让、打开设置、隐藏 Cuu | current |
| `pet-settings-recovery-p1-5.md` | **C-PET/Cuu/Tauri/Settings**:主窗 `/settings` 与托盘恢复 pass-through/hide-on-hover 的源码门和后续 settings matrix | current |
| `cuu-behavior-manifest-p1-6.md` | **C-PET/Cuu/Live2D**:P1.6 鲜活动作状态机源码合同,定义 `CuuBehaviorManifest`、Start/Loop/End、idle random、真实 `.mtn` QA attrs | current |
| `cuu-tauri-business-motion-capture-p1-7.md` | **C-PET/Cuu/Tauri QA**:P1.7 业务动作录屏入口,用 env-gated scripted events 让真实 pet window 录 approval/search/sync/done/offline | current |
| `cuu-tauri-actual-dom-and-anchor-qa-p1-8.md` | **C-PET/Cuu/Tauri QA**:P1.8 真实 WebView DOM attrs 落盘、approval 气泡 Cuu 邻近锚点、首帧猫体 gate | current |
| `cuu-tauri-business-matrix-and-card-framing-p1-9.md` | **C-PET/Cuu/Tauri QA**:P1.9 黑猫业务 smoke 矩阵、白猫 approval、card/tip 透明画布定位、强 actual DOM gate | current |
| `desktop-pet-reference-package-audit-2026-06-08.md` | **C-PET/Cuu/Reference**:`reference` 压缩包复用价值审查,VPet/像素猫只借鉴状态机、资源包和窗口交互,不提交引用资产 | current |
| `prd-concept-reproduction-gap-audit.md` | **C-WEB/C-PET/Cuu/Rust shell**:当前实现距离 PRD 与概念图完全复现的差距、概念图补充、后续施工路线 | draft |
| `current-state-visual-audit-and-construction-plan-2026-06-07.md` | **C-WEB/C-PET/Cuu/Rust shell**:真实页面截图、Cuu 黑/白 Live2D 概念源帧、Tauri 多帧动作抓取与下一轮施工验收门 | audit |
| `r1-route-visual-qa.md` | **C-WEB/C-DESKTOP/QA**:R1.39 Proposal/Replay 真实 route 浏览器截图门、mobile overflow gate、无 Cuu/无重看板默认词证据 | current |
| `r1-task-plan-scope-ui.md` | **C-WEB/C-DESKTOP/API/DB**:R1.40 多 task plan 场景下 `task_items` 写回前的 option-first 目标 plan 选择、API 契约与 fail-closed 后端门 | current |
| `r1-text-hunk-materializer.md` | **C-WEB/C-DESKTOP/API/DB**:R1.41 `text_hunk_overrides` 从 UI 点选意图升级为后端逐段 materialize、Drive version 写回与审计 | current |
| `r1-multi-conflict-execution-audit.md` | **C-WEB/C-DESKTOP/API/DB**:R1.42 批量 keep/accept payload 显式 `bulk_action`、冲突/成功路径审计与后续 Replay 回放边界 | current |
| `r1-replay-hunk-bulk-audit.md` | **C-WEB/C-DESKTOP/API/Contracts**:R1.43 Replay 将 `text_hunk_decisions` 与 `bulk_action` 渲染为用户可读回放，保留 Cuu 独立边界 | current |
| `r1-route-line-editor.md` | **C-WEB/C-DESKTOP/C-UIKIT**:R1.44 Proposal route line editor，文件 tabs、搜索、逐段点选、完整 `text_hunk_overrides` payload 与键盘可达性 | current |
| `shared-ui-kit.md` | **C-UIKIT**:设计 tokens、组件库、API client、共享 hooks/types | ✅ |

### 06-roadmap/
| 文档 | 范围 | 状态 |
|---|---|---|
| `phasing-p0-p5.md` | 各阶段范围、出入口标准、依赖 | ✅ |
| `recovery-r0-r4-roadmap-2026-06-08.md` | **纠偏路线**:冻结 Cuu 外观、修正概念/文档 drift、R1 真实纵切、R2 多 worker、R3 Cuu 指令入口、R4 Web 产品化 | active |
| `review-driven-r0-r4-detailed-construction-plan-2026-06-08.md` | **Claude 审查后详细施工计划**:按当前 main 校准 R0-R4 任务、验收门、概念治理、模块开工阅读清单 | active |
| `r3-21-cross-platform-tray-smoke-plan-2026-06-10.md` | **R3.21**:Linux/macOS transparent pet window、tray/menu 恢复、截图权限和跨平台验收策略；2026-06-11 已落 Linux Xvfb/openbox 首轮 smoke | current |
| `r3-22-text-overflow-permission-offline-qa-plan-2026-06-11.md` | **R3.22**:用户截图所示文本越框问题的后续详细计划，覆盖 failed/permission/offline/generic/main notice 的横向与纵向边界门；2026-06-11 已落 text/frame hardgate 与 Linux mock API 证据 | current |
| `r3-23-real-linux-tray-macos-menu-plan-2026-06-11.md` | **R3.23**:真实 Linux DE tray/appindicator 菜单点击、macOS menu bar、截图权限和 Accessibility 自动化策略 | active |
| `r4-01-web-route-state-matrix-plan-2026-06-11.md` | **R4.1**:Web 高频页 loading/empty/error/forbidden 四态、双语状态卡、desktop/mobile Chrome 截图、无 Cuu 主窗标记与无横向溢出 gate | current |
| `r4-02-web-route-registry-loader-plan-2026-06-11.md` | **R4.2**:Web URL route registry、`idle/loading/ready/empty/error/forbidden` loader、真实 path 导航、typed Page VM endpoint proof 与 Chrome 截图 gate | current |
| `r4-03-web-multi-record-page-vm-visual-qa-plan-2026-06-11.md` | **R4.3**:多记录 Page VM ready/detail route 视觉 QA、去 `客户周报/weekly` 单 fixture、empty/forbidden fallback 与无溢出 gate | current |
| `r4-04-web-product-shell-baseline-plan-2026-06-11.md` | **R4.4**:Web product shell baseline、Home/Approvals/WorkItem/Proposal 四屏截图、path nav、双语 chrome、无 Cuu/无 Kanban、无横向与文本盒溢出 gate | current |
| `r4-05-web-live-route-interaction-smoke-plan-2026-06-11.md` | **R4.5**:Vite live browser route interaction smoke、path nav/back/forward、locale reload、ready/empty/forbidden/error、重复 listener guard、mobile scroll 文本/遮挡门 | current |
| `r4-06-rust-system-string-i18n-plan-2026-06-11.md` | **R4.6**:Rust shell locale contract、tray/menu/tooltip、system notification fallback、deep-link/single-instance diagnostics 双语系统串与 cargo/QA gate | current |
| `r4-07-web-live-api-pg-seed-smoke-2026-06-11.md` | **R4.7**:真实 API daemon + deterministic PG seed 浏览器 smoke；远端 Linux PostgreSQL/Chrome 13 步验收通过 | ✅ |
| `r4-08-redis-sse-production-browser-smoke-2026-06-11.md` | **R4.8**:真实 Redis broker + 双 API worker + Chrome EventSource 浏览器 smoke；远端 Linux PG/Redis/Chrome 15 步验收通过 | ✅ |
| `r4-09-web-locale-page-vm-shell-metrics-2026-06-11.md` | **R4.9**:Page VM 系统生成标签双语、Replay/Cost shell metrics 以 VM 为真相源；远端 Linux PG/Redis/Chrome locale metrics smoke 通过 | ✅ |
| `r4-10-web-route-componentization-plan-2026-06-11.md` | **R4.10**:Home/Approvals/Replay route componentization first slice、active-only product panel、本机 Chrome 11 步 smoke 通过 | ✅ |
| `r4-11-web-route-componentization-second-slice-plan-2026-06-11.md` | **R4.11**:WorkItem/Proposal/Cost/Settings route componentization second slice、Settings typed Page VM、本机 Chrome 13 步 smoke 通过 | ✅ |
| `r4-12-web-action-notice-locale-route-ux-plan-2026-06-11.md` | **R4.12**:Web action/notice locale route UX，approval/proposal reason gate、desktop gate、SSE refresh、budget warning 与 route-state feedback；本机 Chrome 22 步 smoke 通过 | ✅ |
| `r4-13-proposal-advanced-route-ux-convergence-plan-2026-06-11.md` | **R4.13**:Proposal advanced route UX convergence，conflict workbench、field/line/subrecord editor 收敛到 active-only route component；本机 Chrome 29 步 smoke 与 advanced payload/fail-closed/no-overflow gates 通过 | ✅ |
| `r4-14-option-intake-knowledge-route-componentization-plan-2026-06-11.md` | **R4.14**:Option Intake / Knowledge route componentization，option-first intake、knowledge fallback 与 workitem creation 串成真实 route dataflow；本机 Chrome 36 步 smoke 通过 | ✅ |
| `r4-15-settings-locale-device-boundary-hardening-plan-2026-06-11.md` | **R4.15**:Settings / locale / device boundary hardening，统一语言偏好、桌面能力门、运行时状态和恢复动作；本机 Chrome 38 步 smoke 通过 | ✅ |
| `r4-16-react-route-tree-hydration-boundary-plan-2026-06-11.md` | **R4.16**:React route tree / hydration boundary，route adapter marker、hydration boundary、active-only 与 Settings regression gates；本机 Chrome 38 步 smoke 通过 | ✅ |
| `r4-17-react-route-component-first-migration-plan-2026-06-11.md` | **R4.17**:React route component first migration，Home / Settings React-compatible adapter、HTML fallback parity、single dispatcher 与 Settings boundary gates；本机 Chrome 38 步 smoke 通过 | ✅ |
| `r4-18-react-route-migration-expansion-plan-2026-06-11.md` | **R4.18**:React route migration expansion，Cost / Replay React-compatible adapter、Replay restore single dispatcher、R4.17 regression 与本机 Chrome 39 步 smoke 通过 | ✅ |
| `r4-mid-review-upgrade-audit-2026-06-11.md` | **R4 中期审查**:R4.18 竣工节点全项目升级点清单（React 迁移 spike、SSE 编辑态丢失、fixture chrome 退役、双端分发器分叉、QA CI 化），含 R4.19 之后施工顺序建议 | active |
| `r4-19-pre-true-react-mount-spike-plan-2026-06-11.md` | **R4.19-pre**:True React mount spike，Home `createRoot` hidden probe、delegated dispatcher coexistence、Home SSE `react-props` update 与本机 Chrome 41 步 smoke 通过 | ✅ |
| `r4-19-proposal-advanced-split-migration-plan-2026-06-11.md` | **R4.19**:Proposal advanced split migration，readonly split adapter、advanced fallback boundary、dirty edit SSE guard、no-new-fixture-chrome gate 与本机 Chrome 42 步 smoke 通过 | ✅ |
| `r4-20-dataflow-foundation-plan-2026-06-11.md` | **R4.20**:Dataflow foundation，app 级 SSE、Page VM local refetch、Last-Event-ID/cursor、fixture chrome 退役与本机 Chrome 42 步 smoke 通过，`goldPath=0` | ✅ |
| `r4-21-shared-web-runtime-plan-2026-06-11.md` | **R4.21**:Shared web runtime，新增 `@workhub/web-runtime`，收敛 Web 与 desktop-webview dispatcher/notice/payload/line-editor/live SSE runtime 分叉，42 步 smoke 与 R4.21 gates 通过 | ✅ |
| `r4-22-proposal-mutation-editor-migration-plan-2026-06-11.md` | **R4.22**:Proposal mutation editor migration，structured field scalar editor 第一段真实可见 React controlled-state 迁移，42 步 smoke 与 R4.22 gates 通过 | ✅ |
| `r4-23-proposal-line-editor-react-migration-plan-2026-06-11.md` | **R4.23**:Proposal line editor React migration，text hunk decision/search/current file scope 第二段真实可见 React mutation island，42 步 smoke 与 R4.23 gates 通过 | ✅ |
| `r4-24-web-runtime-finalization-plan-2026-06-11.md` | **R4.24**:Web runtime finalization，hash route 写入清理、README 状态治理、browser smoke CI 拆分计划与 R5.1 Drive 决策均落地 | ✅ |
| `r5-01-drive-business-slice-decision-2026-06-11.md` | **R5.1**:Drive business slice first vertical，已落 Drive Page VM/API/Web route，承接 accepted deliverables、Drive versions、preview/download/restore 与 comment draft link | ✅ |
| `r5-02-drive-upload-recycle-operation-log-plan-2026-06-11.md` | **R5.2**:Drive upload/recycle/operation log，补写操作、project 权限门、operation timeline 与 46 步 browser gate 已落 | ✅ |
| `r5-03-drive-comment-to-draft-plan-2026-06-11.md` | **R5.3**:Drive comment-to-draft，把资料评论生成可审批 WorkItem 草稿，不直接改正式文件；47 步 browser gate 已落 | ✅ |
| `r5-04-drive-draft-to-proposal-plan-2026-06-11.md` | **R5.4**:Drive draft-to-proposal，把 comment draft 接入 proposal/change preview 与正式审批写回主线；50 步 browser gate 已落 | ✅ |
| `r5-05-meeting-insight-to-draft-plan-2026-06-11.md` | **R5.5**:Meeting insight-to-draft，把会议洞察生成可追溯 WorkItem 草稿并复用 proposal writeback 主线；55 步 browser gate 已落 | ✅ |
| `r5-06-schedule-notify-plan-2026-06-11.md` | **R5.6**:Schedule / Notify，`/notifications` 收件箱与 `/calendar` 周视图接入 Page VM、shared runtime，mark read/dismiss/complete + audit；63 步 browser gate 已落 | ✅ |
| `r5-07-knowledge-grounding-dashboard-plan-2026-06-11.md` | **R5.7**:Knowledge grounding / dashboard health，`/dashboard/health` 健康档位分层、通知 grounding、knowledge `source_ref` 上下文条；66 步 browser gate 已落 | ✅ |
| `r5-08-browser-smoke-ci-plan-2026-06-12.md` | **R5.8**:Browser smoke CI 化第一段，`web-live-route-smoke` job 64 秒跑 66 步并上传证据 artifact；首跑修复 Linux CJK 行高；五组拆分降级为维护性重构 | ✅ |
| `s1-pilot-readiness-roadmap-2026-06-12.md` | **S1 北极星路线**:真实团队用核心闭环干一周活；现状盘点（闭环已真实现 + 三大差距）、六项成功指标、R5.9–R5.12+Pilot 序列、桌宠双轨、pilot 要回答的四个战略问题 | active |
| `r5-09-onboarding-minimal-plan-2026-06-12.md` | **R5.9**:Onboarding 最小闭环，注册屏/登出/deep link 保持/第二用户切换，自动注册删除；70 步 smoke 与 `r5_9_onboarding_routes` gate 已落 | ✅ |
| `r5-10-pre-agent-capability-hardening-plan-2026-06-12.md` | **R5.10-pre**:Agent 能力强化，5 处引擎短板全部补强（压缩/截断/工人 prompt/HTTP+fetch-level 重试/llm_review 五档进 R0 置信度），agent 30 测与全链回归 | ✅ |
| `r5-10-real-key-evaluation-run-plan-2026-06-13.md` | **R5.10 真 key 评估**:R5.10-dry 之后的真实任务评估已完成，T1-T5+B1、secret 口径、ledger/confidence/预算护栏 gates 与报告回写均落证 | ✅ |
| `r5-11-pilot-deploy-package-plan-2026-06-12.md` | **R5.11**:Pilot 部署包已落，CI `pilot-stack-smoke` 三跑抓三真 bug（env 模板被 gitignore 吞/根路由 banner/admin 无法自举）后全绿；DEPLOY.md 十分钟部署 + 安全口径专节 | ✅ |
| `r5-11-1-sandbox-libraries-and-skills-plan-2026-06-12.md` | **R5.11.1**:沙箱能力库 + 预设技能已落，镜像预装六库与 CJK 字体（pip 仍禁），七个 SKILL.md + `load_skill` fail-closed；CI 容器内真实生成 docx/xlsx/中文图表/pptx 冒烟通过 | ✅ |
| `r5-12-permission-matrix-audit-plan-2026-06-12.md` | **R5.12**:权限矩阵审计（P1-4），79 路由全清点 + 修复 audit 跨用户读/permissions 越权两洞 + 常驻 fail-closed 路由门；S1 pilot-ready | ✅ |
| `r5-10-real-llm-validation-plan-2026-06-12.md` | **R5.10**:真实 LLM 验证已完成：dry + true-key 6-run 质量-成本-时延报告，OQ-2/3/7 已回写首批样本 | ✅ |
| `s1-pilot-launch-gate-plan-2026-06-13.md` | **S1 Pilot Launch Gate**:R5.10-real 之后的启动前核验计划；Docker Desktop + pilot compose 现场门已通过，含 dry/real、backup/restore、UI/i18n/secret/fresh-nav gates | ✅ |
| `s1-pilot-day0-real-work-entry-plan-2026-06-13.md` | **S1 Day 0**:真实用户从 UI 发起工作/项目种子的可见入口；WorkItem `DAY0PILOT-006`、AgentRun、Proposal merge、Replay/Cost、Day0 backup/restore gates 全绿 | ✅ |
| `s1-pilot-day1-feedback-and-observability-plan-2026-06-13.md` | **S1 Day 1**:反馈入口、每日六指标、第二用户路径、ops loop、Day1 backup/restore；第二用户闭环与六指标 gates 全绿 | ✅ |
| `s1-pilot-day2-feedback-hardening-plan-2026-06-13.md` | **S1 Day 2**:post-run WorkItem clarity、browser QA resume/idempotency、opened QA artifact triage、Day2 metrics baseline 与 backup/restore 全绿 | ✅ |
| `s1-pilot-day3-expansion-plan-2026-06-13.md` | **S1 Day 3**:邀请 1-3 个真实使用者，每人 1 件真实任务，继续 metrics delta、反馈 issue 化与 backup/restore | active |
| `s1-pilot-runtime-stability-plan-2026-06-15.md` | **S1 Runtime Stability**:恢复 pilot compose 中已退出的 API 服务；修复 `pg.Pool` idle client error 未监听导致的 Node 进程退出，并记录后续长稳观察计划 | ✅ |
| `s1-pilot-week-runbook-2026-06-12.md` | **S1 运营**:Pilot Week turnkey 手册，起飞前检查 / day-0 seed / 每日反馈回灌 / 六指标采集 / 周末报告模板 / S2 决策口径；Launch Gate、Day0、Day1、Day2 全绿后进入 active-day3-expansion | active-day3-expansion |
| `r6-compounding-ai-labor-plan-2026-06-14.md` | **R6 方向总纲**:复利劳动力——决策收件箱 + AI 战绩 + 团队 skill 自迭代 + 用户 memory；八阶段相位表与客户端分工 | ✅ |
| `r6-web-redesign-plan-2026-06-14.md` | **R6 V0+W1+W2**:Web 视觉重做（靛蓝 token / 决策收件箱首页 / 审批三栏）规范化施工步骤 | ✅ |
| `r6-a0-ai-worklog-plan-2026-06-14.md` | **R6 A0**:AI 战绩（自主率 / 今日处理 N 件 / 估算省时），派生自 pilot 指标行 + `/api/ai-worklog/today` | ✅ |
| `r6-m1-user-memory-plan-2026-06-14.md` | **R6 M1**:用户个人级 memory（偏好/纠正注入 worker prompt，规则提取 v0 不烧 LLM，可自助删） | ✅ |
| `r6-s-team-skill-self-iteration-plan-2026-06-14.md` | **R6 S2/S3**:团队（workspace）级 skill 自迭代——FS∪DB 合并视图 + 闲时蒸馏，AI 全自动晋升 + 人类事后 kill-switch | ✅ |
| `r6-p3-cuu-pet-plan-2026-06-14.md` | **R6 P3**:桌宠表现层收敛 5 情绪 3 气泡（cream 审批 / white 对话 / light-blue 检索），不动 Live2D 黑白猫资产 | ✅ |
| `r6-w2-approval-workbench-plan-2026-06-14.md` | **R6 W2**:审批中心概念图④「三栏 diff 工作台」（含评论流）；6 增量 + 迁移 0019 + 对抗式验收 12 项加固 | ✅ |
| `r6-project-file-merge-collaboration-plan-2026-06-14.md` | **P-COLLAB**:项目文件合并协作（序列化锁 + project 范围撞车 + base snapshot + stale-base 可恢复 rebase） | M2 已落 |
| `full-project-review-2026-06-14.md` | **全项目深度 review**:多 agent + 对抗验证出 87 真问题（3C+14H+27M+43L），全部处置记录与缓办理由 | ✅ |
| `functional-requirements.md` | 全量 FR 清单(可追溯到模块与验收) | ✅ |

### 根级
| 文档 | 范围 | 状态 |
|---|---|---|
| `07-open-questions.md` | 跨文档开放问题汇总与收敛状态 | ✅ |

---

## 4. 地基决策(已敲定 · 2026-06-04 / 2026-06-08 口径修正)
- **D-1** 新仓 = **参考既有 Python/FastAPI 行为锚点的 TS-first 重写与演进**。旧 `app/*.py:line` 只用于说明行为来源,不再作为本仓实现路径。✅
- **D-2** 数据库 = **PostgreSQL**(替换 SQLite)。✅
- **D-3** 部署 = **LAN-first MVP + 云就绪**;多租户公网延到 P5。✅

> 已据此落定 `01-architecture/` 五篇与 `security-and-permissions`。
