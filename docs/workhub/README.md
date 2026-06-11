# WorkHub —— 产品规格文档树(Spec Tree)

> **业务版 GitHub × AI-native 工作中台。AI 是默认劳动力,人是审批者与异常处理者。**
> 本目录按"全新项目"组织。上游:[PRD](../prd/2026-06-04-workhub-prd.md) · [Brainstorm](../brainstorms/2026-06-04-workhub-ai-native-platform-brainstorm.md)。
> 研究参照:`D:/02_代码与开发/_workhub_research/opencode`。
> 状态(2026-06-11):**84 篇文档已落盘**。最新权威施工顺序见 [`06-roadmap/recovery-r0-r4-roadmap-2026-06-08.md`](./06-roadmap/recovery-r0-r4-roadmap-2026-06-08.md),详细领取计划见 [`06-roadmap/review-driven-r0-r4-detailed-construction-plan-2026-06-08.md`](./06-roadmap/review-driven-r0-r4-detailed-construction-plan-2026-06-08.md):R0 止血对账 -> R1 真实纵切 -> R2 多 worker -> R3 Cuu Agent 入口 -> R4 Web 产品化。Cuu 当前只保留独立桌宠窗口中的黑猫/白猫 Live2D 二选项；R3.23 已补真实 Linux GNOME StatusNotifier/AppIndicator DBusMenu action，用户截图暴露的 failed run card 文本越框已补 Chrome 直渲染回归门，macOS menu bar 仍待实机；R4.1 已补 Web 高频页四态/双语/无溢出 route-state matrix foundation，R4.2 已补真实 URL route registry、loader 状态机与 typed Page VM endpoint proof，R4.3 已补多记录 Page VM ready/detail route 视觉 QA，R4.4 已补 Web product shell baseline、导航内部溢出与文本盒溢出门禁，R4.5 已补 Vite live browser route interaction smoke、重复 listener guard 与移动端滚动遮挡门，R4.6 已补 Rust system-string i18n、tray/notification/deep-link diagnostics 双语系统串，R4.7 已通过远端 Linux 真实 API/PG seed browser smoke；下一步 R4.8 接 Redis/SSE production browser smoke。

---

## 0. 怎么读这棵树

- **PRD** = WHAT/WHY 的总纲(一篇)。
- **本规格树** = 把 PRD 拆到"屏级 / 接口级 / 功能级"的细化(多篇,按模块)。
- **plan**(后续)= HOW:文件改动、构建顺序。
- 每篇文档头部带 `module / layer / status / owner`;状态:`📝待写 / 🚧进行 / ✅初稿 / 🔒评审通过`。

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
