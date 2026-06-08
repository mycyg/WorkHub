# WorkHub —— 产品规格文档树(Spec Tree)

> **业务版 GitHub × AI-native 工作中台。AI 是默认劳动力,人是审批者与异常处理者。**
> 本目录按"全新项目"组织。上游:[PRD](../prd/2026-06-04-workhub-prd.md) · [Brainstorm](../brainstorms/2026-06-04-workhub-ai-native-platform-brainstorm.md)。
> 研究参照:`D:/02_代码与开发/_workhub_research/opencode`。
> 状态(2026-06-08):**37 篇文档已落盘**(含 P-COST 专篇、PRD/概念复现差距审计、Cuu 黑猫/白猫 Live2D 当前路线、当前真实截图/动作审计;详见各篇 frontmatter)。Cuu 当前只保留独立桌宠窗口中的黑猫/白猫 Live2D 二选项；失败实验路线已撤出当前文档树和源码入口。

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
| `tech-stack-and-migration.md` | 选型(FastAPI/PG/Tauri/provider)、现有→新仓迁移清单、复用映射 | ✅ |
| `security-and-permissions.md` | 威胁模型(LAN→云重审)、设备令牌门、RBAC、分层 permission 策略 | ✅ |

### 02-ai-engine/
| 文档 | 范围 | 状态 |
|---|---|---|
| `agent-loop-and-tools.md` | 工人循环、控制信号、工具契约与注册表、沙箱、预算、doom-loop、快照 | ✅ |
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
| `i18n-locale-contract-p1-1.md` | **C-WEB/C-PET/Cuu/Contracts**:中英双语 locale 合同、API Page VM query/meta、typed client、Cuu 固定文案与后续多语言路线 | current |
| `i18n-nongoldpath-render-helpers-p1-2.md` | **C-WEB/C-PET/C-UIKIT**:非 Gold Path helper 固定文案双语、可见 enum 人话标签、Web/Desktop facade locale 接线 | current |
| `prd-concept-reproduction-gap-audit.md` | **C-WEB/C-PET/Cuu/Rust shell**:当前实现距离 PRD 与概念图完全复现的差距、概念图补充、后续施工路线 | draft |
| `current-state-visual-audit-and-construction-plan-2026-06-07.md` | **C-WEB/C-PET/Cuu/Rust shell**:真实页面截图、Cuu 黑/白 Live2D 概念源帧、Tauri 多帧动作抓取与下一轮施工验收门 | audit |
| `shared-ui-kit.md` | **C-UIKIT**:设计 tokens、组件库、API client、共享 hooks/types | ✅ |

### 06-roadmap/
| 文档 | 范围 | 状态 |
|---|---|---|
| `phasing-p0-p5.md` | 各阶段范围、出入口标准、依赖 | ✅ |
| `functional-requirements.md` | 全量 FR 清单(可追溯到模块与验收) | ✅ |

### 根级
| 文档 | 范围 | 状态 |
|---|---|---|
| `07-open-questions.md` | 跨文档开放问题汇总与收敛状态 | ✅ |

---

## 4. 地基决策(已敲定 · 2026-06-04)
- **D-1** 新仓 = **迁移现有地基再演进**(非重写)。✅
- **D-2** 数据库 = **PostgreSQL**(替换 SQLite)。✅
- **D-3** 部署 = **LAN-first MVP + 云就绪**;多租户公网延到 P5。✅

> 已据此落定 `01-architecture/` 五篇与 `security-and-permissions`。
