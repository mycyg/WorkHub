---
module: 06-roadmap
layer: L0-foundation（全局可追溯口径）
status: 🚧
owner: workflow
---

# WorkHub 全量功能需求（Functional Requirements）

> 本篇是 WorkHub **唯一权威的功能需求清单**:汇总 [PRD §8](../../prd/2026-06-04-workhub-prd.md) 已有的全部 `FR-*`,**补全**各平台横切能力(P-*)与各客户端(C-WEB/C-PET/C-UIKIT)新增 FR,统一编号、优先级、验收标准与可追溯关系。
> 上游:[PRD](../../prd/2026-06-04-workhub-prd.md)(WHAT/WHY 总纲)· [规格树索引](../README.md)。
> 同层交叉:阶段划分见 [`phasing-p0-p5.md`](./phasing-p0-p5.md)(出入口标准),开放问题见 [`../07-open-questions.md`](../07-open-questions.md)。
> 字段/状态机以 [`01-architecture/data-model.md`](../01-architecture/data-model.md) 为准;术语去黑话以 [`00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md) 为准;运行时权限/审计语义见 [`01-architecture/security-and-permissions.md`](../01-architecture/security-and-permissions.md)。
> **铁律**:每条 FR 必须**扎根现有真实代码或明确标注新增**,引用真实路径(`app/…`、`client-tauri/…`、`web/…`、`shared/…`)。本篇正文用内部术语(branch/proposal/merge),用户面文案映射见 glossary。

---

## 0. 怎么读这张清单

### 0.1 编号约定(延续 [PRD §0](../../prd/2026-06-04-workhub-prd.md))

- 功能需求:`FR-<模块>-<序号>`;非功能:`NFR-<序号>`;决策:`D-<序号>`。
- 模块前缀(对齐 [PRD §8](../../prd/2026-06-04-workhub-prd.md) 与 [README §2](../README.md) 的能力/模块代号):

| 前缀 | 域 | 对应能力/模块 | PRD 出处 |
|---|---|---|---|
| `FR-WORKER-*` | AI 工人引擎 | P-AI(L2) | [PRD §8.1](../../prd/2026-06-04-workhub-prd.md) |
| `FR-ESC-*` | 置信度/风险/升级 | P-AI(命门) | [PRD §8.2](../../prd/2026-06-04-workhub-prd.md) |
| `FR-PM-*` | 项目经理模式 | P-AI(L1) | [PRD §8.3](../../prd/2026-06-04-workhub-prd.md) |
| `FR-STAFF-*` | 智能派活 | P-AI(旗舰) | [PRD §8.4](../../prd/2026-06-04-workhub-prd.md) |
| `FR-COLLAB-*` | 分支→提议→合并 | P-COLLAB(L3) | [PRD §8.5](../../prd/2026-06-04-workhub-prd.md) |
| `FR-PERM-*` | 权限与审批 | P-PERM | [PRD §8.6](../../prd/2026-06-04-workhub-prd.md) |
| `FR-SYNC-*` | 双向同步 | P-COLLAB | [PRD §8.7](../../prd/2026-06-04-workhub-prd.md) |
| `FR-SPEC-*` | README=规格 | P-COLLAB | [PRD §8.8](../../prd/2026-06-04-workhub-prd.md) |
| `FR-PET-*` | 桌宠入口 | C-PET(L4) | [PRD §8.9](../../prd/2026-06-04-workhub-prd.md) |
| `FR-EXPLAIN-*` | 可解释 | P-AI | [PRD §8.10](../../prd/2026-06-04-workhub-prd.md) |
| `FR-AUDIT-*` | 审计与回滚 | P-AUDIT | [PRD §7/§8.6](../../prd/2026-06-04-workhub-prd.md) |
| `FR-COST-*` | 成本治理 | P-COST | [PRD NFR-05](../../prd/2026-06-04-workhub-prd.md) |
| `FR-IDENT-*` | 身份/档案/协作图 | P-IDENTITY(L0) | [PRD §6/§8.4](../../prd/2026-06-04-workhub-prd.md) |
| `FR-WORKITEM-*` | 工作项主轴 | M-WORKITEM | [PRD §7.1](../../prd/2026-06-04-workhub-prd.md) |
| `FR-DRIVE-*` | 项目+网盘 | M-DRIVE | [PRD §2.1](../../prd/2026-06-04-workhub-prd.md) |
| `FR-MEET-*` | 会议→洞察 | M-MEETING | [PRD §2.1](../../prd/2026-06-04-workhub-prd.md) |
| `FR-NOTIFY-*` | 任务/提醒/通知 | M-NOTIFY | [PRD §2.1](../../prd/2026-06-04-workhub-prd.md) |
| `FR-KB-*` | 知识库 | M-KNOWLEDGE | [PRD §3.3/§8.10](../../prd/2026-06-04-workhub-prd.md) |
| `FR-DASH-*` | 看板/度量 | M-DASHBOARD | [PRD §13](../../prd/2026-06-04-workhub-prd.md) |
| `FR-WEB-*` | Web 应用端 | C-WEB | [README §1](../README.md) |
| `FR-UIKIT-*` | 共享设计系统 | C-UIKIT | [README §1](../README.md) |
| `FR-PLAT-*` | daemon/契约/事件流 | C-DAEMON | [PRD §11](../../prd/2026-06-04-workhub-prd.md) |

> **来源标注**:`[PRD]` = 直接抄录自 PRD §8(原文已有);`[补]` = 本篇补全(模块/客户端新增,PRD 未单列但其机制/NFR 已隐含)。补全项均给出现有代码锚点或 *(新增)* 注明。

### 0.2 优先级与阶段(对齐 [PRD §12](../../prd/2026-06-04-workhub-prd.md))

- **P0**=MVP 必须 / **P1**=重要 / **P2**=可延后(沿用 PRD 优先级)。
- 「阶段」列标注预期落地阶段 `P0–P5`(地基/旗舰/PM+派活/协作+同步/桌宠/治理),详见 [`phasing-p0-p5.md`](./phasing-p0-p5.md)。优先级与阶段正交:一条 P0 优先级的需求可能落在 P3 阶段(因依赖前序地基)。

### 0.3 验收标准写法

每条 FR 给「验收(AC)」=**可观测、可测试**的判定;凡涉及现有行为的演进,AC 锚定现有代码的真实约束(如 CAS、`reason_md` 非空、`dedupe_key` 去重),确保迁移**不回退**已修复的缺陷。

### 0.4 全量索引(共 **98** 条 FR)

| 域 | 编号区间 | 条数 |
|---|---|---|
| AI 工人引擎 | FR-WORKER-001..008 | 8 |
| 置信度/升级 | FR-ESC-001..008 | 8 |
| 项目经理模式 | FR-PM-001..005 | 5 |
| 智能派活 | FR-STAFF-001..006 | 6 |
| 协作合并 | FR-COLLAB-001..006 | 6 |
| 权限审批 | FR-PERM-001..006 | 6 |
| 双向同步 | FR-SYNC-001..004 | 4 |
| README 规格 | FR-SPEC-001..003 | 3 |
| 桌宠入口 | FR-PET-001..006 | 6 |
| 可解释 | FR-EXPLAIN-001..002 | 2 |
| 审计回滚 | FR-AUDIT-001..004 | 4 |
| 成本治理 | FR-COST-001..004 | 4 |
| 身份档案 | FR-IDENT-001..004 | 4 |
| 工作项主轴 | FR-WORKITEM-001..005 | 5 |
| 网盘 | FR-DRIVE-001..004 | 4 |
| 会议 | FR-MEET-001..003 | 3 |
| 通知 | FR-NOTIFY-001..004 | 4 |
| 知识库 | FR-KB-001..002 | 2 |
| 看板 | FR-DASH-001..003 | 3 |
| Web 端 | FR-WEB-001..004 | 4 |
| 设计系统 | FR-UIKIT-001..003 | 3 |
| daemon/平台 | FR-PLAT-001..004 | 4 |
| **合计** | — | **98** |

---

## 1. AI 工人引擎(`FR-WORKER-*` · P-AI · L2 旗舰)

> 上游 [PRD §8.1](../../prd/2026-06-04-workhub-prd.md);引擎细节见 [`02-ai-engine/agent-loop-and-tools.md`](../02-ai-engine/agent-loop-and-tools.md);实体见 [data-model §7.1/§7.2](../01-architecture/data-model.md)。
> **现状锚点**:工人循环 [`auto_agent.py:405`](../../../app/services/auto_agent.py)(`for turn in range(1, MAX_TURNS+1)`);工具表 [`auto_agent.py:51`](../../../app/services/auto_agent.py)(`TOOLS`);沙箱 `_safe_path`([`auto_agent.py:154`](../../../app/services/auto_agent.py))/ `_enforce_sandbox_budget`([`auto_agent.py:176`](../../../app/services/auto_agent.py))/ `ALLOWED_COMMANDS`([`auto_agent.py:42`](../../../app/services/auto_agent.py))/ rlimit `_sandbox_rlimits`([`auto_agent.py:268`](../../../app/services/auto_agent.py));触发与编排 [`routers/auto.py`](../../../app/routers/auto.py)。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-WORKER-001** | P0 | P1 | [PRD] | 系统支持将一个 WorkItem **默认**派给 AI 工人执行,无需人工逐步干预。 |
| **FR-WORKER-002** | P0 | P1 | [PRD] | 每次 `AgentRun` 产生**完整 trace**(每步动作 + 工具输入输出)可供人审。 |
| **FR-WORKER-003** | P0 | P1 | [PRD] | `AgentRun` 超预算时,强制产出「已做/未做/下一步」结构化交接件,而非静默截断。 |
| **FR-WORKER-004** | P0 | P1 | [PRD] | AI 的每次副作用动作可回滚到执行前快照。 |
| **FR-WORKER-005** | P0 | P1 | [补] | 工具系统为最小契约 `{id, 描述, 参数 schema, execute}`;入参 schema 校验失败时回灌「请改输入」可恢复错误(不崩溃、不中断 run)。 |
| **FR-WORKER-006** | P0 | P1 | [补] | AI 工人执行全程沙箱化:路径限定在 per-WorkItem workdir、文件数/字节数上限、命令白名单、子进程 rlimit;越界一律拒绝并回灌。 |
| **FR-WORKER-007** | P1 | P1 | [补] | 工具注册表按「当前 actor 权限」过滤模型可见的工具菜单(同一引擎不同 actor 看到不同工具集),为 [`FR-PERM-001`](#5-权限与审批-fr-perm--p-perm) 的分层策略提供执行面落点。 |
| **FR-WORKER-008** | P0 | P1 | [补] | L2 首发覆盖 **file-only 数字可交付物白名单**：文档/周报/方案草稿、结构化 JSON/YAML/CSV/config、小型代码或模板改动、CSV/TSV 分析报告、会议/网盘证据生成的需求草稿。 |

**验收(AC)**

- **FR-WORKER-001**:当 WorkItem 进入 `spec_ready` 且 `human_reserved=false`,系统自动创建 `Branch(actor_kind=ai)` + `AgentRun(mode=worker)` 并切 `ai_working`(见 [data-model §5](../01-architecture/data-model.md) 转移表);**演进点**:现状仅 `summary_ready/ready` 由提交者手动点 `/auto-process` 触发([`auto.py:76`](../../../app/routers/auto.py),且 `submitter_user_id != user.id` 拒绝),WorkHub 改为默认自动,触发权移交编排层。
  - 保留现有 **CAS 原子触发**(`UPDATE … WHERE status IN {…}`,[`auto.py:84-93`](../../../app/routers/auto.py)),并发触发仅一次成功,另一路返回 409,不产生重复 `AgentRun`/重复交付。
- **FR-WORKER-002**:每个 `AgentRun` 落 `AgentStep` 行(`step_no`/`phase`/`tool_name`/`input_json`/`output_excerpt`/`control_signal`,见 [data-model §7.2](../01-architecture/data-model.md));现状以 SSE 事件 `ai.thinking`/`ai.text`/`ai.tool_call`([`auto_agent.py:438-447`](../../../app/services/auto_agent.py))呈现且不落库,WorkHub 改为**入库可回放**。trace 在 Web 与桌宠均可逐步查看(见 [`FR-WEB-003`](#19-web-应用端-fr-web--c-web)、`AILiveView.tsx`)。
- **FR-WORKER-003**:`AgentRun.status ∈ {budget_exhausted}` 时必有非空 `handoff_md`;不得停在静默失败。现状超 `MAX_TURNS=15`/`TOTAL_TIMEOUT_DEFAULT=300s` 仅返回失败 `AutoResult`(`reason="达到最大轮次…"`,[`auto_agent.py:505`](../../../app/services/auto_agent.py)),WorkHub 升级为结构化交接件并触发 [`FR-ESC-006`](#2-置信度风险与升级-fr-esc--p-ai-命门)。
- **FR-WORKER-004**:每个写类工具(`write_file`/`write_base64_file`/`mkdir`/`move_path`/`delete_path`/`zip_path`,见 `TOOLS`)执行前生成 `Snapshot(kind=pre_step)`(见 [data-model §7.5](../01-architecture/data-model.md));提供单步与整段回滚,`reverted_at` 置位(沿用 `ProjectDriveOperation.undone_at` 的 undo 范式,[`models.py:222`](../../../app/models.py))。用户面呈现为「撤销/还原到改之前」(glossary §2 revert 行)。
- **FR-WORKER-005**:工具异常以可恢复错误文本回灌(沿用现状 `content = f"[error] …"`,[`auto_agent.py:490`](../../../app/services/auto_agent.py)),`AgentStep.phase=tool_result` 记录;**不**让单个工具异常终止整个 run。
- **FR-WORKER-006**:`run_command` 仅放行 `ALLOWED_COMMANDS`(`python/node/npm/pnpm/bun/pytest/ruff/tsc`,[`auto_agent.py:42`](../../../app/services/auto_agent.py)),`npm/pnpm/bun install` 被显式禁用([`auto_agent.py:296`](../../../app/services/auto_agent.py));文件数 > `MAX_SANDBOX_FILES=800` 或字节 > `MAX_SANDBOX_BYTES=200MB` 抛错;子进程 rlimit(CPU/AS/FSIZE/NOFILE,[`auto_agent.py:282-285`](../../../app/services/auto_agent.py))生效(POSIX);路径逃逸(`_safe_path`)被拒。**威胁模型重审**:现状 network egress 未阻断,基于「可信 LAN」假设([`auto_agent.py:268-279`](../../../app/services/auto_agent.py) 注释),上云前须重审(见 [`security-and-permissions.md`](../01-architecture/security-and-permissions.md) 与 [PRD NFR-02](../../prd/2026-06-04-workhub-prd.md))。
- **FR-WORKER-007**:模型每轮收到的 `tools=` 列表由 actor 权限过滤;现状为静态 `TOOLS` 全集([`auto_agent.py:418`](../../../app/services/auto_agent.py)),WorkHub 改为按 `PermissionPolicy` 计算可见集。
- **FR-WORKER-008**:首发白名单只允许「文件型/文本型/可由沙箱命令本地算出」的交付物。允许子类包括:需求/方案/周报/纪要草稿,结构化 JSON/YAML/CSV/config,小型代码或模板改动,CSV/TSV 轻分析报告,会议/网盘证据生成的需求草稿。明确排除:外部发送、付款、生产部署、法律/医疗/财务专业判断、联网装包、不可逆删除。命中排除项时不得自动执行,必须走风险门 `domain_gate` 或权限 `ask`。

---

## 2. 置信度、风险与升级(`FR-ESC-*` · P-AI · 命门)

> 上游 [PRD §8.2](../../prd/2026-06-04-workhub-prd.md);算法见 [`02-ai-engine/confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md);实体见 [data-model §7.3/§7.4](../01-architecture/data-model.md)。
> **现状锚点**:`llm_review`([`auto_agent.py:544`](../../../app/services/auto_agent.py),返回 `(bool, reason)`,即触发器①)、`RevisionRequest`([`models.py:535`](../../../app/models.py),`reason_md` 非空 = 触发器②的数据基础)、`estimate_confidence` 三档枚举(`low|medium|high`,[`models.py:333`](../../../app/models.py))= 置信度人话三档的现实先例。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-ESC-001** | P0 | P1 | [PRD] | 每次产出生成 `ConfidenceRecord`(置信度 + 风险 + 分级裁决 + 依据),对用户以**人话**呈现(如「我比较有把握,但建议你扫一眼」),**不暴露数值阈值**。 |
| **FR-ESC-002** | P0 | P1 | [PRD] | 三个触发器任一命中即创建 `EscalationEvent` 并切 WorkItem 至经理模式(`mode=pm`)。 |
| **FR-ESC-003** | P0 | P1 | [PRD] | 打回**必须带理由**;理由作为上下文回灌,AI 在**同分支续做**而非重来。 |
| **FR-ESC-004** | P1 | P1 | [PRD] | doom-loop / 超预算自动升级。 |
| **FR-ESC-005** | P1 | P2 | [PRD] | 「人工保留」开关支持 **WorkItem / 项目 / 用户** 三级配置。 |
| **FR-ESC-006** | P0 | P1 | [补] | 分级裁决产出三选一 `verdict`(`auto_merge`/`human_spotcheck`/`escalate`)并驱动状态机三分叉([data-model §5](../01-architecture/data-model.md)),裁决依据(各信号原值)落 `signals_json` 可标定。 |
| **FR-ESC-007** | P1 | P2 | [补] | 风险评分覆盖**可逆性、对外性、金额/合规敏感度、影响人数**四维度,落 `signals_json.risk.*`;权重可由管理员配置(开放问题 3,见 [`../07-open-questions.md`](../07-open-questions.md))。 |
| **FR-ESC-008** | P1 | P1 | [补] | 升级与打回**回灌闭环**有审计可见的「已回灌」标记,确保理由确实进入下一轮上下文(防止理由被吞)。 |

**验收(AC)**

- **FR-ESC-001**:`ConfidenceRecord` 含 `confidence_score`/`risk_score`(0–1)+ `grade`(`high/mid/low`)+ `risk_level`(`low/mid/high`)+ `rationale_md`(人话)+ `signals_json`([data-model §7.3](../01-architecture/data-model.md))。**用户面零数值**:UI/桌宠/通知只出三档语气(有把握 / 建议看一眼 / 拿不准请你定,glossary §3.3),与现有 `estimate_confidence` 三档对齐。提示词英文、输出用户语言(沿用 `REVIEW_SYSTEM` 的「Write the reason in the user's language」,[`auto_agent.py:541`](../../../app/services/auto_agent.py))。
- **FR-ESC-002**:`EscalationEvent.trigger ∈ {unqualified, user_unsatisfied, user_forbidden, doom_loop, budget_exhausted}`([data-model §7.4](../01-architecture/data-model.md));落库**同事务**切 `WorkItem.mode=pm` + 状态 `escalated`。三触发器映射现有零件:① `unqualified` ← `llm_review` 判 `meets_requirement=false`([`auto_agent.py:584`](../../../app/services/auto_agent.py));② `user_unsatisfied` ← `Review.decision=reject`(自 `RevisionRequest`);③ `user_forbidden` ← `human_reserved`(见 FR-ESC-005)。
- **FR-ESC-003**:`Review.reason_md` 在 `decision=reject` 时**应用层强制非空**(锚定现状 `RevisionRequest.reason_md` NOT NULL,[`models.py:535`](../../../app/models.py));回灌后状态 `in_review→ai_working` 且**复用同一 `Branch`**(不新建,见 [data-model §5](../01-architecture/data-model.md) 该行守卫)。现状的回退转移 `revision_requested→doing` 是其雏形([`requirements.py:282`](../../../app/routers/requirements.py))。
- **FR-ESC-004**:doom-loop = 连续 N 步相同动作(由 `AgentStep` 检测,[data-model §7.2](../01-architecture/data-model.md));超预算 = 命中 `AgentRun.max_turns`/超时。任一命中 → `verdict=escalate`。现状仅粗粒度 `MAX_TURNS=15` 上限([`auto_agent.py:36`](../../../app/services/auto_agent.py)),无相同动作检测,WorkHub 补齐。
- **FR-ESC-005**:三级开关任一为「保留」即跳过 AI 工人,`spec_ready→pm_mode`(见 [data-model §5](../01-architecture/data-model.md));优先级 WorkItem > 项目 > 用户(就近覆盖)。*(新增字段 `WorkItem.human_reserved`,[data-model §4.2](../01-architecture/data-model.md))*
- **FR-ESC-006**:裁决规则对齐 [PRD §8.2](../../prd/2026-06-04-workhub-prd.md) 表:`high+low→auto_merge`;`mid/部分不确定/中风险→human_spotcheck`;`low/high_risk/blocked/doom_loop/超预算→escalate`。`auto_merge` 仅在项目策略允许且 `PermissionPolicy` 判 `allow`(非 `ask`)时一跳到 `merged`,否则停 `in_review`(见 [data-model §5 自动合并策略](../01-architecture/data-model.md))。
- **FR-ESC-007**:四维度均有原值可查;无业务方权重时落保守默认(高风险倾向 `escalate`)。
- **FR-ESC-008**:`Review.reason_fed_back_at` 或 `ApprovalRequest.decision_reason_md` 回灌后置位时间戳([data-model §6.3/§8.2](../01-architecture/data-model.md));`AuditLog` 记 `action=reason_fed_back`。

---

## 3. AI 项目经理模式(`FR-PM-*` · P-AI · L1 受阻态)

> 上游 [PRD §8.3](../../prd/2026-06-04-workhub-prd.md);见 [`02-ai-engine/pm-mode-orchestration.md`](../02-ai-engine/pm-mode-orchestration.md)。
> **现状锚点**:拆解/排期产物 `RequirementTaskPlan`/`RequirementTaskItem`([`models.py:425/448`](../../../app/models.py),`stage: dispatch|worker`);人侧执行视图 `RequirementWorkspace`/`RequirementProgressUpdate`([`models.py:378/408`](../../../app/models.py));排期 `ScheduleEvent`([`models.py:250`](../../../app/models.py))+ [`routers/planning.py`](../../../app/routers/planning.py)/[`routers/calendar.py`](../../../app/routers/calendar.py);拆解服务 [`services/task_decomposition.py`](../../../app/services/task_decomposition.py)。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-PM-001** | P0 | P2 | [PRD] | 升级后 AI 自动生成「为什么升级 + 建议谁来做 + 计划」的可读简报。 |
| **FR-PM-002** | P1 | P2 | [PRD] | AI 自动排期并按计划设置提醒/催办。 |
| **FR-PM-003** | P1 | P2 | [PRD] | 人完成后,AI 协助把产物整理为可审的 Proposal。 |
| **FR-PM-004** | P1 | P2 | [补] | 经理模式下 AI **不静默替人决策**:派活、催办、改派均以「提议→人确认」呈现。 |
| **FR-PM-005** | P2 | P2 | [补] | 经理模式可对一个 WorkItem 拆解为多个子任务并分别派活/排期,沿用现有拆解-排期实体。 |

**验收(AC)**

- **FR-PM-001**:`EscalationEvent.reason_md` + `handoff_json`(承接 `AgentRun.handoff_md`,[data-model §7.4](../01-architecture/data-model.md))渲染为用户简报;含 `suggested_lead_user_id`(来自 [`FR-STAFF-002`](#4-智能派活-fr-staff--p-ai-旗舰))。用户面**不出现「升级」二字**,说「AI 觉得这个得请人来 / 转人工接手」(glossary §3.2)。
- **FR-PM-002**:排期写 `ScheduleEvent` + 提醒经 `Notification`/桌宠呈现(见 [`FR-NOTIFY-*`](#17-任务提醒通知-fr-notify--m-notify));催办遵守 [`FR-PET-004`](#9-桌宠入口-fr-pet--c-pet-l4) 的打扰边界。
- **FR-PM-003**:被派的人完成(人侧 `RequirementWorkspace`/进度更新)后,AI 把产物整理为 `Proposal`(`created_by_kind=ai`),状态 `pm_mode→in_review`(见 [data-model §5](../01-architecture/data-model.md))。
- **FR-PM-004**:派活/催办/改派均生成「提议」并需人确认;`AuditLog` 区分 `actor_kind=ai`(提议)与 `human`(确认),呼应产品宪法第 5 条「AI 绝不静默改生产态」([PRD §5](../../prd/2026-06-04-workhub-prd.md))。
- **FR-PM-005**:子任务沿用 `RequirementTaskPlan`/`RequirementTaskItem`(`stage=dispatch`),FK 改名 `work_item_id`([data-model §4.4 备注](../01-architecture/data-model.md))。

---

## 4. 智能派活(`FR-STAFF-*` · P-AI · 旗舰)

> 上游 [PRD §8.4](../../prd/2026-06-04-workhub-prd.md);见 [`02-ai-engine/smart-staffing.md`](../02-ai-engine/smart-staffing.md)。
> **现状锚点**:指派表 `RequirementAssignment`(`role: lead|collaborator`,[`models.py:363`](../../../app/models.py))+ [`services/assignments.py`](../../../app/services/assignments.py)(`lead_assignment`/`is_assigned_user`)+ [`routers/decompositions.py`](../../../app/routers/decompositions.py);选人器 `AssigneeSelector.tsx`([`web/src/components/AssigneeSelector.tsx`](../../../web/src/components/AssigneeSelector.tsx));可用度 `User.availability_status`(`free` 默认,[`models.py:33`](../../../app/models.py),由 [`routers/users.py:65`](../../../app/routers/users.py) 维护)。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-STAFF-001** | P0 | P2 | [PRD] | 新用户 onboarding **必填**「擅长什么 + 自我介绍」。 |
| **FR-STAFF-002** | P0 | P2 | [PRD] | 有新 WorkItem 时,AI 提议 负责人 + 协作人 + 推荐理由。 |
| **FR-STAFF-003** | P0 | P2 | [PRD] | 推荐必须可被人**一键确认或调整**。 |
| **FR-STAFF-004** | P1 | P2 | [PRD] | 冷启动时降级为「解释式推荐」;有历史后引入命中率加权。 |
| **FR-STAFF-005** | P2 | P2 | [PRD] | 负责人对推荐的**纠正回流**,用于改进模型。 |
| **FR-STAFF-006** | P1 | P2 | [补] | 派活输入信号需同时纳入**当前负载/可用度**(避免把活压给已满负荷的人)。 |

**验收(AC)**

- **FR-STAFF-001**:onboarding 必填写入 `UserProfile.skills_text` + `bio_md`,`onboarded_at` 置位([data-model §3.2](../01-architecture/data-model.md));未完成则触发 J1 引导。现有 onboarding 路由雏形 `Onboarding.tsx`([`client-tauri/web-src/src/routes/Onboarding.tsx`](../../../client-tauri/web-src/src/routes/Onboarding.tsx)),WorkHub 扩展为采集技能/简介。*(`UserProfile` 新增)*
- **FR-STAFF-002**:输入 = `UserProfile.skill_tags`/`skills_text`(grep 匹配,无向量库 — [D-4](../../prd/2026-06-04-workhub-prd.md))+ `CollaborationGraph`(命中率/共事/新鲜度,[data-model §3.3](../01-architecture/data-model.md))+ WorkItem 画像;输出写候选 `Assignment` 提议 + 每人**人话理由**(呼应 [`FR-EXPLAIN-001`](#10-可解释性与知识-fr-explain--p-ai))。
- **FR-STAFF-003**:一键确认即写 `RequirementAssignment`(`lead`+`collaborator` 行,沿用 `UniqueConstraint(work_item_id,user_id)`);改派复用现有 `can_manage_requirement_assignees` 的权限模型([`permissions.py:91`](../../../app/services/permissions.py))。
- **FR-STAFF-004**:`CollaborationGraph` 无边数据时,只读 `skill_tags` 粗匹配 + 解释式推荐,**不做命中率加权**([data-model §3.3 冷启动降级](../01-architecture/data-model.md))。
- **FR-STAFF-005**:纠正(人改派/否决推荐)写 `AuditLog`,作为后续 `CollaborationGraph` 重算与提示词反馈的输入。
- **FR-STAFF-006**:候选排序纳入 `availability_status` 与在途 WorkItem 计数;满负荷者降权或剔除。

---

## 5. 协作:分支→提议→合并(`FR-COLLAB-*` · P-COLLAB · L3)

> 上游 [PRD §8.5](../../prd/2026-06-04-workhub-prd.md);见 [`03-collaboration/branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md);实体见 [data-model §6](../01-architecture/data-model.md)。
> **现状锚点**:deliver→验收循环 = PR-review 雏形(`Delivery` 按 `round` 版本化,[`models.py:515`](../../../app/models.py);验收态 `accepted`/打回态 `revision_requested`);人侧分支雏形 `RequirementWorkspace`([`models.py:378`](../../../app/models.py));网盘版本 `ProjectDriveVersion`(内容寻址 `sha256`,[`models.py:192`](../../../app/models.py))= branch 内容底层载体。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-COLLAB-001** | P0 | P3 | [PRD] | 每个协作者 / AI 工人对 WorkItem 的改动在**独立分支**进行。 |
| **FR-COLLAB-002** | P0 | P3 | [PRD] | 改动以 Proposal 提交,负责人 通过→合并 main / 打回带理由。 |
| **FR-COLLAB-003** | P1 | P3 | [PRD] | 并发改动冲突时,AI 生成合并建议供人选择。 |
| **FR-COLLAB-004** | P0 | P3 | [PRD] | 全程 UI **不出现 git 术语**。 |
| **FR-COLLAB-005** | P0 | P3 | [补] | 合并入 main 受**乐观锁 + 行级锁**保护,杜绝并发双写丢更新。 |
| **FR-COLLAB-006** | P1 | P3 | [补] | 业务对象合并语义**按内容类型分派**(文档类 vs 结构化记录类),各自定义 diff/merge。 |

**验收(AC)**

- **FR-COLLAB-001**:每 actor 一条 `Branch`(`actor_kind=human|ai`,[data-model §6.1](../01-architecture/data-model.md)),多支互不阻塞;内容引用 Drive 版本家族 + `SpecDoc`,`Branch` 仅持头指针 + 元数据。
- **FR-COLLAB-002**:`Proposal`(`UniqueConstraint(branch_id, round)`,[data-model §6.2](../01-architecture/data-model.md))→ `Review`(`approve`→`merged` / `reject`+`reason_md`→回灌,见 [`FR-ESC-003`](#2-置信度风险与升级-fr-esc--p-ai-命门))。`Delivery` 作为打包产物附件,`round` 与 `Proposal.round` 对齐([data-model §6.4](../01-architecture/data-model.md))。
- **FR-COLLAB-003**:同一对象并发改动 → AI 给合并建议,人择一/微调;语义按 [`FR-COLLAB-006`](#5-协作分支提议合并-fr-collab--p-collab--l3) 分派。
- **FR-COLLAB-004**:用户面零 `branch/commit/PR/merge/conflict/diff/rebase/HEAD/repo`(glossary §1.2 第 1 条,可被 lint/review 检查);文案走 glossary §2 右列(草稿/改动/提交确认/采纳/打回说原因/撞车了 AI 给方案)。**现状先例**:`shared/src/design/status-vocab.ts` 已把 `delivered/accepted` 映射为「已交付/已完成」([`status-vocab.ts:36-38`](../../../shared/src/design/status-vocab.ts)),客户端按钮已是「通过」([`client-tauri/web-src/src/routes/HubDispatch.tsx`](../../../client-tauri/web-src/src/routes/HubDispatch.tsx))。
- **FR-COLLAB-005**:合并走 `SELECT … FOR UPDATE`(PG 行级锁)+ `version` CAS([data-model §9.4](../01-architecture/data-model.md));冲突重读一次再失败报 409。**前提**:[D-2](../../prd/2026-06-04-workhub-prd.md) SQLite→PG(SQLite 不支持 `FOR UPDATE`,现状靠单 worker 串行,[`db.py:22-39`](../../../app/db.py) 注释明示 `database is locked` 之痛)。
- **FR-COLLAB-006**:文档类(Markdown/文本)走三方文本 merge;结构化记录类(状态/字段)走字段级 CAS;无法自动合并 → 升级为 [`FR-COLLAB-003`](#5-协作分支提议合并-fr-collab--p-collab--l3) 人工择一(开放问题 4,见 [`../07-open-questions.md`](../07-open-questions.md))。

---

## 6. 权限与审批(`FR-PERM-*` · P-PERM)

> 上游 [PRD §8.6](../../prd/2026-06-04-workhub-prd.md);见 [`03-collaboration/review-and-approval.md`](../03-collaboration/review-and-approval.md) 与 [`01-architecture/security-and-permissions.md`](../01-architecture/security-and-permissions.md);实体见 [data-model §8.1/§8.2](../01-architecture/data-model.md)。
> **现状锚点**:硬编码 RBAC `services/permissions.py`(`can_view_*`/`can_claim_*`/`can_work_*`,[`permissions.py:50-119`](../../../app/services/permissions.py))、`User.is_admin` 短路(为 True 时 `can_*` 返回 True,[`models.py:38`](../../../app/models.py))、审批/状态推进中枢 [`services/lifecycle.py`](../../../app/services/lifecycle.py)、设备令牌门 `require_local_client`([`auth.py:183`](../../../app/auth.py))。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-PERM-001** | P0 | P5 | [PRD] | 支持分层 allow/deny/ask 权限策略,**未匹配默认 ask**。 |
| **FR-PERM-002** | P0 | P5 | [PRD] | 审批请求按角色/负责人/项目**路由**到正确的人。 |
| **FR-PERM-003** | P1 | P5 | [PRD] | 审批支持「永远允许」沉淀规则 + 超时 SLA + 委派。 |
| **FR-PERM-004** | P0 | P5 | [PRD] | 所有 AI 动作按身份写入 `AuditLog`,可追溯、可回滚。 |
| **FR-PERM-005** | P0 | P1 | [补] | 审批 = **阻塞原语**:工具在「该决策那一刻」命中 `ask` 即阻塞至人回复(approve/deny),拒绝带理由回灌 AI。 |
| **FR-PERM-006** | P0 | P0 | [补] | 设备令牌门**延续**:接活/干活类高权限操作要求一台未吊销的注册桌面设备(服务端校验),浏览器只能派活/审批。 |

**验收(AC)**

- **FR-PERM-001**:`PermissionPolicy`(`scope_kind ∈ {org,workspace,role,session}`,`effect ∈ {allow,deny,ask}`,[data-model §8.1](../01-architecture/data-model.md))合并算法:按 `org→workspace→role→session` 收集 → 同优先级 `deny > ask > allow` → 无匹配落 `ask`。迁移期 `is_admin` 作为最高优先级 allow 兜底([data-model §3.1 备注](../01-architecture/data-model.md))。把现状「代码里的 if」([`permissions.py`](../../../app/services/permissions.py))外化为「数据里的规则」。
- **FR-PERM-002**:`ApprovalRequest.routed_to_user_id` 按角色/负责人/项目计算([data-model §8.2](../01-architecture/data-model.md))。**护城河**:opencode 无此能力。
- **FR-PERM-003**:`PermissionPolicy.learned_from_session=true` 沉淀「永远允许」;`ApprovalRequest.sla_due_at` 到期未响应触发升级/重路由;`delegated_to_user_id` 支持委派。用户面说「以后这类不用再问我 / 太久没人批就转给别人」(glossary §6)。
- **FR-PERM-004**:见 [`FR-AUDIT-001`](#11-审计与回滚-fr-audit--p-audit)。
- **FR-PERM-005**:命中 `effect=ask` 即建 `ApprovalRequest(status=pending)` 并阻塞对应 `AgentRun`;`decision_reason_md` 拒绝理由回灌下一步上下文([data-model §8.2](../01-architecture/data-model.md))。现状最接近的阻塞原语是设备令牌门(见 FR-PERM-006),WorkHub 泛化为通用阻塞审批。
- **FR-PERM-006**:沿用 header `X-YQGL-Client-Token`(`LOCAL_CLIENT_HEADER`,[`auth.py:23`](../../../app/auth.py))+ `ClientDevice`(`client_token_hash`/`revoked_at`,[`models.py:57`](../../../app/models.py));admin **不**绕过设备门(`permissions.py` 模块 docstring 明示「admin doesn't mean bypass device safety」)。LAN-first 延续([D-3](../../prd/2026-06-04-workhub-prd.md))。

---

## 7. 双向同步(`FR-SYNC-*` · P-COLLAB)

> 上游 [PRD §8.7](../../prd/2026-06-04-workhub-prd.md);见 [`03-collaboration/sync-and-spec.md`](../03-collaboration/sync-and-spec.md)。
> **现状锚点**:`client-tauri/src-tauri/src/sync.rs:227` 注释明说当前仅**单向下载**(`sync_drive_download`,placeholder);双向地基 `spec_watch.rs`(spec 文件夹 ↔ 服务器、sha256 去重、append-only,[`spec_watch.rs:122`](../../../client-tauri/src-tauri/src/spec_watch.rs));清单 `Manifest`/`ManifestFile`(sha256 校验)+ 服务端 [`services/sync_manifest.py`](../../../app/services/sync_manifest.py) / [`routers/sync.py`](../../../app/routers/sync.py)。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-SYNC-001** | P1 | P3 | [PRD] | 客户端与服务端文件**双向**同步。 |
| **FR-SYNC-002** | P1 | P3 | [PRD] | 同步冲突由 AI 给建议、人确认。 |
| **FR-SYNC-003** | P2 | P3 | [PRD] | 支持离线编辑后联网合并。 |
| **FR-SYNC-004** | P1 | P3 | [补] | 同步以**内容寻址(sha256)去重**,已存在内容不重复传输;传输可断点/可取消。 |

**验收(AC)**

- **FR-SYNC-001**:替换 `sync.rs:227` 的单向占位,实现上传方向(本地→服务端)并与下载方向合流;复用 `spec_watch` 的 append-only + sha256 范式([`spec_watch.rs:561` 的 `sha256_of`](../../../client-tauri/src-tauri/src/spec_watch.rs))。用户面说「同步/拿到本地/传上去」(glossary §2 clone/pull/push 行)。
- **FR-SYNC-002**:冲突解决同 [`FR-COLLAB-003`](#5-协作分支提议合并-fr-collab--p-collab--l3)(AI 建议 + 人择一)。
- **FR-SYNC-003**:离线编辑缓存于本地 sync root,联网后按清单 diff 上传并解冲突。
- **FR-SYNC-004**:现状下载已做 sha256 校验与 size 校验([`sync.rs:318-329`](../../../client-tauri/src-tauri/src/sync.rs))且支持取消(`download_response_to_tmp_with_cancel`),WorkHub 上传方向对齐同等保障。

---

## 8. README = 需求规格展示页(`FR-SPEC-*` · P-COLLAB)

> 上游 [PRD §8.8](../../prd/2026-06-04-workhub-prd.md);见 [`03-collaboration/sync-and-spec.md`](../03-collaboration/sync-and-spec.md);实体见 [data-model §6.5](../01-architecture/data-model.md)。
> **现状锚点**:spec 文件夹同步 `spec_watch.rs`(`spec_folder`/`start`,[`spec_watch.rs:112/122`](../../../client-tauri/src-tauri/src/spec_watch.rs));澄清产物写 `Requirement.summary_md`(由 [`routers/requirements.py`](../../../app/routers/requirements.py) + `prompts/summarize.md` 生成)。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-SPEC-001** | P1 | P3 | [PRD] | 每个 WorkItem/项目有**自动维护**的 README 规格页。 |
| **FR-SPEC-002** | P2 | P3 | [PRD] | 规格页变更走提议→合并(与内容协作一致)。 |
| **FR-SPEC-003** | P1 | P3 | [补] | 规格页是**单一可信源门面**:AI 与人均对照它工作与验收;版本化可追溯。 |

**验收(AC)**

- **FR-SPEC-001**:`SpecDoc`(`scope_kind ∈ {work_item, project}`,`body_md`/`content_sha256`/`version`,[data-model §6.5](../01-architecture/data-model.md))随澄清/交付自动更新;`WorkItem.current_spec_id` 头指针。用户面说「需求说明页/这个活到底要做什么」(glossary §2 README 行)。
- **FR-SPEC-002**:规格页改动走 `Branch→Proposal→merge`(与 [`FR-COLLAB-002`](#5-协作分支提议合并-fr-collab--p-collab--l3) 一致)。
- **FR-SPEC-003**:`content_sha256` 内容寻址去重(沿用 `spec_watch` sha256 范式);`version` append-only 递增。

---

## 9. 桌宠入口(`FR-PET-*` · C-PET · L4)

> 上游 [PRD §8.9](../../prd/2026-06-04-workhub-prd.md);见 [`05-clients/desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md)。
> **现状锚点**:右下角弹窗/托盘 `tray.rs`/`notify.rs`、deep-link `deep_link.rs`、提醒 `reminders.rs`、SSE 接收 `sse.rs`、窗口 `window.rs`(均在 `client-tauri/src-tauri/src/`);助手对话 [`routers/assistant.py`](../../../app/routers/assistant.py)(SSE 流式)+ `prompts/assistant_system.md`(现仅 `answer`/`draft_requirement` 两动作,[`assistant_system.md:25`](../../../app/prompts/assistant_system.md))。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-PET-001** | P1 | P4 | [PRD] | 桌宠常驻,点击出对话框。 |
| **FR-PET-002** | P1 | P4 | [PRD] | 用户**自然语言指令**可驱动 Agent 操作功能(派活、查状态、提交等)。 |
| **FR-PET-003** | P1 | P4 | [PRD] | 提醒/升级以桌宠呈现,**替代**右下角弹窗。 |
| **FR-PET-004** | P2 | P4 | [PRD] | 打扰频率/时段可由用户设边界。 |
| **FR-PET-005** | P1 | P4 | [补] | 桌宠与 Web 同为同一 headless daemon 的瘦客户端,功能对等(Agent 能操作几乎所有功能)。 |
| **FR-PET-006** | P2 | P4 | [补] | 桌宠保留并演进现有 deep-link / 托盘 / 安装更新能力,接活/干活专属于桌面端(承接设备令牌门)。 |

**验收(AC)**

- **FR-PET-001**:桌宠窗口常驻,点击展开对话框(演进现有 `window.rs`/`tray.rs`)。
- **FR-PET-002**:自然语言 → Agent 工具操作。**演进点**:现状助手仅 `answer`(问答)+ `draft_requirement`(起草需求草稿)两动作,**不能真正代操作**([`assistant_system.md:25`](../../../app/prompts/assistant_system.md));WorkHub 扩展工具集到派活/查状态/提交确认等,且每个动作走 [`FR-PERM-005`](#6-权限与审批-fr-perm--p-perm) 审批阻塞 + [`FR-EXPLAIN-001`](#10-可解释性与知识-fr-explain--p-ai) 理由。用户面说「桌宠/助理」(glossary §8)。
- **FR-PET-003**:升级/提醒经 SSE(`sse.rs` 订阅 `all`/`req:<id>`/`user:<id>` 主题,[`push_bus.py:3-4`](../../../app/services/push_bus.py))推送,以桌宠呈现替代 `notify.rs` 原始弹窗;沿用 `Notification.dedupe_key` 去重([`models.py:146`](../../../app/models.py))。
- **FR-PET-004**:打扰边界写 `UserProfile.availability_pref`(时段/并发上限,[data-model §3.2](../01-architecture/data-model.md));催办/提醒遵守该边界。
- **FR-PET-005**:桌宠/Web 共用 daemon OpenAPI + 类型化 client(演进 `shared/src/api/client.ts`);二者功能差异仅在设备令牌门(接活/干活)。
- **FR-PET-006**:deep-link(`deep_link.rs`)/托盘(`tray.rs`)/安装更新沿用;接活/干活 header `X-YQGL-Client-Token` 校验(见 [`FR-PERM-006`](#6-权限与审批-fr-perm--p-perm))。

---

## 10. 可解释性与知识(`FR-EXPLAIN-*` · P-AI)

> 上游 [PRD §8.10](../../prd/2026-06-04-workhub-prd.md);见 [`02-ai-engine/explainability.md`](../02-ai-engine/explainability.md)。
> **现状锚点**:`MeetingInsight.confidence_reason`([`models.py:302`](../../../app/models.py))+ `meeting_agent.py:20`(AI 自报判断理由,本地 fallback 写「建议人工确认」,[`meeting_agent.py:77`](../../../app/services/meeting_agent.py));知识问答强制引用 `KnowledgeAskRun.citations_json`/`trace_json`([`models.py:128/139`](../../../app/models.py))。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-EXPLAIN-001** | P1 | P1 | [PRD] | AI 的派活/升级/判分决策均附**人话理由 + 证据引用**。 |
| **FR-EXPLAIN-002** | P1 | P1 | [补] | AI 执行 trace 可读呈现(每步做了什么),用户可追问「为什么这么做」。 |

**验收(AC)**

- **FR-EXPLAIN-001**:派活理由(`FR-STAFF-002`)、升级理由(`EscalationEvent.reason_md`)、判分理由(`ConfidenceRecord.rationale_md` / `llm_review` 的 `reason`)均非空且为用户语言。把现有 `confidence_reason` 范式([`meeting_agent.py`](../../../app/services/meeting_agent.py))推广到所有 AI 决策。延续 grep + 强制引用([D-4](../../prd/2026-06-04-workhub-prd.md)),证据走 `citations_json`。
- **FR-EXPLAIN-002**:trace 由 `AgentStep`([`FR-WORKER-002`](#1-ai-工人引擎-fr-worker--p-ai--l2-旗舰))渲染;用户面说「AI 都做了哪些步骤」(glossary §5 trace 行)。

---

## 11. 审计与回滚(`FR-AUDIT-*` · P-AUDIT)

> 上游 [PRD §7/§8.6](../../prd/2026-06-04-workhub-prd.md);实体见 [data-model §8.3/§7.5](../01-architecture/data-model.md)。
> **现状锚点**:`ActivityLog`(`actor_nickname`/`action`/`detail_json`,[`models.py:554`](../../../app/models.py))+ [`services/activity.py`](../../../app/services/activity.py)(`log_activity`);网盘可撤销操作 `ProjectDriveOperation.undone_at`([`models.py:214/222`](../../../app/models.py));`ActivityTimeline.tsx`([`web/src/components/ActivityTimeline.tsx`](../../../web/src/components/ActivityTimeline.tsx))。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-AUDIT-001** | P0 | P0 | [补] | 所有 AI/人/系统动作按身份记入 `AuditLog`(`actor_kind`/`actor_user_id`/`entity`/`action`/前后值),可追溯。 |
| **FR-AUDIT-002** | P0 | P1 | [补] | AI 副作用动作均有执行前 `Snapshot`,可 revert;回滚动作本身也记审计。 |
| **FR-AUDIT-003** | P0 | P0 | [补] | `AuditLog` **不软删、不可改**(append-only),仅按保留策略归档(治理证据须不可篡改)。 |
| **FR-AUDIT-004** | P0 | P0 | [补] | 私有事件/审计按身份与租户隔离,防跨用户泄漏(对齐 [NFR-08](../../prd/2026-06-04-workhub-prd.md))。 |

**验收(AC)**

- **FR-AUDIT-001**:统一 `ActivityLog`+`ProjectDriveOperation` 为全实体 `AuditLog`([data-model §8.3](../01-architecture/data-model.md));`actor_kind ∈ {human,ai,system}`。现状已用 `actor_nickname=f"AI ({model})"` 区分 AI 动作([`auto.py:216`](../../../app/routers/auto.py)),WorkHub 升级为结构化身份。
- **FR-AUDIT-002**:见 [`FR-WORKER-004`](#1-ai-工人引擎-fr-worker--p-ai--l2-旗舰);`AuditLog.snapshot_id` 关联回滚点,`undone_at` 置位。
- **FR-AUDIT-003**:`AuditLog` 表无 `deleted_at`,`created_at` 后不可改([data-model §8.3 备注](../01-architecture/data-model.md))。
- **FR-AUDIT-004**:`AuditLog`/SSE 主题按 `actor_user_id`/`org_id`/`workspace_id` 过滤;私有事件(草稿态等,沿用 `PRIVATE_REQUIREMENT_STATUSES`,[`permissions.py:28`](../../../app/services/permissions.py))不外泄。

---

## 12. 成本治理(`FR-COST-*` · P-COST)

> 上游 [PRD NFR-05/§11](../../prd/2026-06-04-workhub-prd.md);治理专篇见 [`02-ai-engine/cost-governance.md`](../02-ai-engine/cost-governance.md);成本事实以 `UsageRecord` / `CostLedgerEntry` 为准,`AgentRun.token_in/out` / `cost_estimate` / `model` 只是执行摘要与可钻取索引。
> **现状锚点**:统一 provider `AsyncAnthropic(base_url=settings.llm_base_url)`([`auto_agent.py:34`](../../../app/services/auto_agent.py))、模型 `settings.llm_model`、端点配置 [`config.py`](../../../app/config.py);硬预算 `MAX_TURNS`/`TOTAL_TIMEOUT_DEFAULT`([`auto_agent.py:36-37`](../../../app/services/auto_agent.py))。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-COST-001** | P0 | P1 | [补] | 每个 `AgentRun` 有**硬预算上限**(轮次/超时/token),超限按 [`FR-WORKER-003`](#1-ai-工人引擎-fr-worker--p-ai--l2-旗舰) 优雅降级。 |
| **FR-COST-002** | P0 | P5 | [补] | 支持 **用户/团队/任务** 三级预算与配额。 |
| **FR-COST-003** | P1 | P5 | [补] | 低风险任务可路由**更便宜模型**;provider 统一注册表,系统其余保持模型无关。 |
| **FR-COST-004** | P1 | P5 | [补] | 每条已交付需求的 AI token 成本可计量、可上看板([`FR-DASH-002`](#19-看板与度量fr-dash--m-dashboard))。 |

**验收(AC)**

- **FR-COST-001**:`AgentRun.max_turns` 必填([data-model §7.1](../01-architecture/data-model.md));v0 默认 `15 steps / 300s / 120k tokens / 5 CNY`,具体数值由 [`cost-governance.md §2`](../02-ai-engine/cost-governance.md#2-v0-默认值) 配置化裁出。
- **FR-COST-002**:三级配额耗尽时阻断新 `AgentRun` 并提示;v0 默认用户日 `500k tokens / 20 CNY`,团队日 `5M tokens / 200 CNY`,团队月 `50M tokens / 2000 CNY`,合并规则见 [`cost-governance.md §4`](../02-ai-engine/cost-governance.md#4-裁决流程)。
- **FR-COST-003**:`AgentRun.model` 记录实际模型;低风险或接近预算时走廉价模型,由 provider 注册表 + `BudgetDecision.model_route` 裁决([PRD §11 LLM 抽象](../../prd/2026-06-04-workhub-prd.md))。
- **FR-COST-004**:每次真实 provider 调用先写 `UsageRecord`,再由 P-COST 幂等归集 `CostLedgerEntry`;看板读取 `CostDashboardVM` / ledger 聚合,`AgentRun.token_in/token_out/cost_estimate` 仅作摘要缓存。重试、compact、review token 计入真实成本,nightly eval 单独进 `scope.kind="eval"`。

---

## 13. 身份/档案/协作图(`FR-IDENT-*` · P-IDENTITY · L0)

> 上游 [PRD §6/§8.4](../../prd/2026-06-04-workhub-prd.md);实体见 [data-model §3](../01-architecture/data-model.md)。
> **现状锚点**:`User`(昵称唯一/`cookie_token`/`is_admin`/软删除 `deleted_at`+`display_name` 墓碑,[`models.py:27-54`](../../../app/models.py))、昵称免密身份 `COOKIE_NAME="yqgl_id"`([`auth.py:22`](../../../app/auth.py),itsdangerous 签名)、可用度 `availability_status`([`models.py:33`](../../../app/models.py))。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-IDENT-001** | P0 | P0 | [补] | 昵称免密身份(cookie+签名令牌)**延续**;授权用 `*_user_id`,展示用 nickname(防昵称重用继承身份)。 |
| **FR-IDENT-002** | P0 | P2 | [补] | `UserProfile`(技能自述/自我介绍/专长标签/可用度)落库并喂所有 AI 决策。 |
| **FR-IDENT-003** | P1 | P2 | [补] | `CollaborationGraph`(谁擅长什么/与谁合作过/命中率)由历史**聚合**(非手填)。 |
| **FR-IDENT-004** | P2 | P5 | [补] | `Org`/`Workspace` 多租户作用域(MVP 默认单租户,云就绪预留)。 |

**验收(AC)**

- **FR-IDENT-001**:权限检查一律用 `*_user_id`(锚定 `Project.owner_nickname` 注释「权限检查必须用 owner_user_id」,[`models.py:79-83`](../../../app/models.py));软删用户保留行,选人器过滤 `deleted_at IS NULL`(沿用 `lifecycle._resolve_recipients` 的过滤,[`lifecycle.py:99-101`](../../../app/services/lifecycle.py))。
- **FR-IDENT-002**:见 [`FR-STAFF-001`](#4-智能派活-fr-staff--p-ai-旗舰);1:1 关联 `User`([data-model §3.2](../01-architecture/data-model.md))。
- **FR-IDENT-003**:`hit_rate = accepted/(accepted+revision_requested)` 源自 `Review` 聚合([data-model §3.3](../01-architecture/data-model.md));MVP 用 PG 物化视图定时刷新。
- **FR-IDENT-004**:横切实体带 `org_id`+`workspace_id`;MVP 回填默认租户([data-model §3.4/§9.5](../01-architecture/data-model.md))。

---

## 14. 工作项主轴(`FR-WORKITEM-*` · M-WORKITEM)

> 上游 [PRD §7.1](../../prd/2026-06-04-workhub-prd.md);见 [`04-modules/requirements-workitem.md`](../04-modules/requirements-workitem.md);实体/状态机见 [data-model §4.2/§5](../01-architecture/data-model.md)。
> **现状锚点**:主轴 `Requirement`(`code`/`status`/`priority`/`due_at`,[`models.py:314`](../../../app/models.py));状态域 12 态([`models.py:328-330`](../../../app/models.py));合法转移表 `allowed`([`requirements.py:272-285`](../../../app/routers/requirements.py));状态 CAS([`requirements.py:304-310`](../../../app/routers/requirements.py));派生溯源 `source_requirement_id`([`models.py:341`](../../../app/models.py));里程碑通知 `lifecycle.queue_status_notifications`([`lifecycle.py:104`](../../../app/services/lifecycle.py))。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-WORKITEM-001** | P0 | P0 | [补] | WorkItem 是状态机驱动的主轴:intake→澄清→执行→分级→审批→合并(全转移见 data-model §5)。 |
| **FR-WORKITEM-002** | P0 | P0 | [补] | 状态变更走**乐观锁 CAS**,并发写串行化;非法转移拒绝(`422 invalid_transition`)并记审计。 |
| **FR-WORKITEM-003** | P0 | P0 | [补] | 里程碑状态变更与通知**同事务入库、提交后推 SSE**;通知按 `dedupe_key` 去重。 |
| **FR-WORKITEM-004** | P1 | P1 | [补] | WorkItem 可**派生后续**(merged→新 intake,`source_requirement_id` 溯源)。 |
| **FR-WORKITEM-005** | P0 | P0 | [补] | 私有态(草稿/澄清/规格未就绪)仅提交者/被指派者/admin 可见;已派发态对项目成员可见。 |

**验收(AC)**

- **FR-WORKITEM-001**:状态域演进为 `intake/ai_clarifying/spec_ready/ai_working/escalated/pm_mode/in_review/merged/done/cancelled`(旧 12 态映射见 [data-model §5 映射表](../01-architecture/data-model.md));`cancelled` 为终态,`done` 收尾。
- **FR-WORKITEM-002**:沿用现状 `UPDATE … WHERE id=:id AND status=:expected` CAS(命中 0 行 → 409,[`requirements.py:304-310`](../../../app/routers/requirements.py)),叠加 `version` 行版本([data-model §9.4](../01-architecture/data-model.md));转移表外 (from,to) 拒绝。
- **FR-WORKITEM-003**:锚定现状「先入库后推送」约定(`queue_status_notifications` 不 commit/不 publish,`flush_status_notifications` 在 commit 后发 SSE,[`lifecycle.py:104-173`](../../../app/services/lifecycle.py));`dedupe_key=f"{status}:{req}:{actor}"`([`lifecycle.py:159`](../../../app/services/lifecycle.py))防双 toast。
- **FR-WORKITEM-004**:派生写新行 `source_requirement_id` 指向源(沿用 `SET NULL` 溯源,[`models.py:341`](../../../app/models.py));用户面说「基于这个再开一个新活」(glossary §2 fork 行)。
- **FR-WORKITEM-005**:沿用 `PRIVATE_REQUIREMENT_STATUSES`(`draft/clarifying/summary_ready`,[`permissions.py:28`](../../../app/services/permissions.py))→ 映射新私有态;`can_view_requirement_record` 逻辑迁移([`permissions.py:50`](../../../app/services/permissions.py))。

---

## 15. 项目 + 网盘(`FR-DRIVE-*` · M-DRIVE)

> 见 [`04-modules/projects-and-drive.md`](../04-modules/projects-and-drive.md);实体见 [data-model §4.1/§10](../01-architecture/data-model.md)。
> **现状锚点**:`Project`(`slug`/`owner_user_id`/`next_seq` 生成 `PROJ-001`,[`models.py:71`](../../../app/models.py));网盘家族 `ProjectDriveItem`/`ProjectDriveVersion`/`ProjectDriveOperation`/`ProjectDriveComment`([`models.py:167/192/214/228`](../../../app/models.py));路由 [`routers/projects.py`](../../../app/routers/projects.py)/[`routers/project_drive.py`](../../../app/routers/project_drive.py);评论触发 LLM `drive_comment_agent.py`([`services/drive_comment_agent.py`](../../../app/services/drive_comment_agent.py));Web 页 `ProjectDrive.tsx`/`DriveHome.tsx`、桌宠 `ProjectDrive.tsx`。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-DRIVE-001** | P0 | P0 | [补] | 项目网盘:文件树(file/folder)+ 版本(内容寻址 sha256)+ 回收站(软删)+ 操作日志(可撤销)。 |
| **FR-DRIVE-002** | P1 | P0 | [补] | 网盘评论可触发 LLM 处理并可生成需求草稿(`pending_llm`)。 |
| **FR-DRIVE-003** | P0 | P0 | [补] | 项目编号 `PROJ-NNN` 自增在多 worker 下**不撞号**(行级锁或 PG SEQUENCE)。 |
| **FR-DRIVE-004** | P0 | P3 | [补] | 网盘版本家族作为 [`Branch`](#5-协作分支提议合并-fr-collab--p-collab--l3) 内容的底层载体,支撑去黑话合并。 |

**验收(AC)**

- **FR-DRIVE-001**:沿用现有家族字段;版本 `sha256` 去重([`models.py:192`](../../../app/models.py)),操作 `undone_at` 可撤销([`models.py:222`](../../../app/models.py)),回收站走软删 `deleted_at`。
- **FR-DRIVE-002**:沿用 `ProjectDriveComment.status=pending_llm`([`models.py:228`](../../../app/models.py))+ `drive_comment_agent`。
- **FR-DRIVE-003**:现状 `Project.next_seq` 在 SQLite 单 worker 下安全;PG 多 worker 下走行级锁/SEQUENCE([data-model §9.4](../01-architecture/data-model.md))。
- **FR-DRIVE-004**:见 [`FR-COLLAB-001`](#5-协作分支提议合并-fr-collab--p-collab--l3)。

---

## 16. 会议 → 洞察(`FR-MEET-*` · M-MEETING)

> 见 [`04-modules/meetings-and-insights.md`](../04-modules/meetings-and-insights.md);实体见 [data-model §10](../01-architecture/data-model.md)。
> **现状锚点**:`MeetingRecord`/`MeetingInsight`(`confidence_reason`/`created_requirement_id`,[`models.py:269/291/302`](../../../app/models.py));服务 `meeting_agent.py`([`services/meeting_agent.py`](../../../app/services/meeting_agent.py));路由 [`routers/meetings.py`](../../../app/routers/meetings.py)/[`routers/voice.py`](../../../app/routers/voice.py)(ASR/TTS);Web/桌宠页 `ProjectMeetings.tsx`。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-MEET-001** | P1 | P0 | [补] | 音频/文本 → ASR → 纪要 → 洞察 → 需求草稿(**人确认**才入池)。 |
| **FR-MEET-002** | P1 | P0 | [补] | 每条洞察附**置信度理由**(AI 自报);本地 fallback 提示「建议人工确认」。 |
| **FR-MEET-003** | P2 | P2 | [补] | 由会议洞察生成的需求草稿可一键进入 WorkItem intake 流。 |

**验收(AC)**

- **FR-MEET-001**:沿用现有 ASR/纪要/洞察链路;草稿不自动入池,需人确认(产品宪法第 1/5 条)。
- **FR-MEET-002**:`MeetingInsight.confidence_reason` 非空(锚定 `meeting_agent.py:20/44`);本地 fallback 文案沿用([`meeting_agent.py:77`](../../../app/services/meeting_agent.py))。呼应 [`FR-EXPLAIN-001`](#10-可解释性与知识-fr-explain--p-ai)。
- **FR-MEET-003**:`MeetingInsight.created_requirement_id` 串联草稿→WorkItem([`models.py:291`](../../../app/models.py))。

---

## 17. 任务/提醒/通知(`FR-NOTIFY-*` · M-NOTIFY)

> 见 [`04-modules/tasks-reminders-notifications.md`](../04-modules/tasks-reminders-notifications.md);实体见 [data-model §10](../01-architecture/data-model.md)。
> **现状锚点**:`Notification`(`dedupe_key` 去重,[`models.py:146`](../../../app/models.py))/`ScheduleEvent`([`models.py:250`](../../../app/models.py));服务 `notifications.py`/`schedule.py`([`services/notifications.py`](../../../app/services/notifications.py)/[`services/schedule.py`](../../../app/services/schedule.py));路由 [`routers/notifications.py`](../../../app/routers/notifications.py)/[`routers/reminders.py`](../../../app/routers/reminders.py)/[`routers/calendar.py`](../../../app/routers/calendar.py);桌宠 `reminders.rs`/`notify.rs`;Web `NotificationsPage.tsx`/`CalendarPage.tsx`。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-NOTIFY-001** | P0 | P0 | [补] | 里程碑/升级/催办经通知中枢推送,**去重 + 变更检测**(`dedupe_key`)。 |
| **FR-NOTIFY-002** | P1 | P0 | [补] | 待办/排期/提醒可创建、查询、按时触发。 |
| **FR-NOTIFY-003** | P1 | P1 | [补] | 私有事件按身份隔离推送(NFR-08),不向无关用户广播。 |
| **FR-NOTIFY-004** | P2 | P4 | [补] | 通知呈现可由桌宠承接(替代右下角弹窗,见 [`FR-PET-003`](#9-桌宠入口-fr-pet--c-pet-l4))。 |

**验收(AC)**

- **FR-NOTIFY-001**:沿用 `create_notification`/`publish_notification`([`notifications.py`](../../../app/services/notifications.py))+ `dedupe_key`;通知与状态变更同事务(见 [`FR-WORKITEM-003`](#14-工作项主轴-fr-workitem--m-workitem))。
- **FR-NOTIFY-002**:沿用 `ScheduleEvent` + reminders 链路。
- **FR-NOTIFY-003**:广播主题区分 `req:<id>`(req 内可见)与 `all`(全局,如新工单),不把私有事件发到 `all`(锚定现状对 `ai.failed` 用 req-scoped、对 `requirement.ready` 才用 `all` 的判断,[`auto.py:257-273`](../../../app/routers/auto.py))。
- **FR-NOTIFY-004**:见 [`FR-PET-003`](#9-桌宠入口-fr-pet--c-pet-l4)。

---

## 18. 知识库(`FR-KB-*` · M-KNOWLEDGE)

> 见 [`04-modules/knowledge-base.md`](../04-modules/knowledge-base.md);实体见 [data-model §10](../01-architecture/data-model.md)。
> **现状锚点**:`KnowledgeDocument`/`KnowledgeAskRun`(`citations_json` 强制引用 + `trace_json`,[`models.py:110/128/139`](../../../app/models.py));服务 `knowledge.py`([`services/knowledge.py`](../../../app/services/knowledge.py));路由 [`routers/knowledge.py`](../../../app/routers/knowledge.py);Web `KnowledgePage.tsx`、桌宠 `Knowledge.tsx`。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-KB-001** | P1 | P0 | [补] | grep 语料检索 + **强制引用**的问答(**无向量库**,[D-4](../../prd/2026-06-04-workhub-prd.md))。 |
| **FR-KB-002** | P2 | P0 | [补] | 问答产出可审 trace(检索→引用→作答)。 |

**验收(AC)**

- **FR-KB-001**:作答必须带 `citations_json`(沿用现状强制引用,[`models.py:128`](../../../app/models.py));不引入向量检索([D-4 决策](../../prd/2026-06-04-workhub-prd.md))。
- **FR-KB-002**:`KnowledgeAskRun.trace_json` 落库可回放([`models.py:139`](../../../app/models.py))。

---

## 19. 看板与度量(`FR-DASH-*` · M-DASHBOARD)

> 见 [`04-modules/dashboards-and-metrics.md`](../04-modules/dashboards-and-metrics.md);度量定义对齐 [PRD §13](../../prd/2026-06-04-workhub-prd.md)。
> **现状锚点**:健康/概览雏形 `ProjectPulse.tsx`(桌宠)、`Dashboard.tsx`/`HealthPage.tsx`(Web,[`web/src/pages/Dashboard.tsx`](../../../web/src/pages/Dashboard.tsx))、[`routers/health.py`](../../../app/routers/health.py);后台任务 `BackgroundJob`(`progress_percent`,[`models.py:93`](../../../app/models.py))。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-DASH-001** | P1 | P2 | [补] | 项目健康看板:在途/阻塞/逾期 WorkItem。 |
| **FR-DASH-002** | P1 | P5 | [补] | AI 度量看板:自治率、升级精准度(precision/recall)、回滚率/打回率、token 成本。 |
| **FR-DASH-003** | P1 | P1 | [补] | AgentRun trace / 置信度 / 升级可观测(对齐 [NFR-11](../../prd/2026-06-04-workhub-prd.md))。 |

**验收(AC)**

- **FR-DASH-001**:演进 `ProjectPulse.tsx`/`Dashboard.tsx`,按 WorkItem 状态聚合。
- **FR-DASH-002**:指标定义对齐 [PRD §13 成功度量](../../prd/2026-06-04-workhub-prd.md);数据源 `AuditLog`/`Review`/`ConfidenceRecord`/`AgentRun`。
- **FR-DASH-003**:trace/置信度/升级从 `AgentStep`/`ConfidenceRecord`/`EscalationEvent` 取数。

---

## 20. Web 应用端(`FR-WEB-*` · C-WEB)

> 见 [`05-clients/web-app.md`](../05-clients/web-app.md)。浏览器可派活/管理/审批/看板;接活干活类高权限受设备令牌门限制(见 [`FR-PERM-006`](#6-权限与审批-fr-perm--p-perm))。
> **现状锚点**:Web 页 `web/src/pages/*`(`Home`/`Dashboard`/`ProjectView`/`RequirementDetail`/`Clarify`/`NewRequirement`/`KnowledgePage`/`CalendarPage`/`NotificationsPage`/`PlanningPage`/`ProjectDrive`/`ProjectMeetings`/`DriveHome`/`HealthPage`);组件 `web/src/components/*`(`AILiveView`/`ActivityTimeline`/`AssigneeSelector`/`StatusBadge`/`DeliverablesTab`/`ClientDownloadBanner` 等);实时 SSE 经 `shared/src/api`。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-WEB-001** | P0 | P4 | [补] | Web 提供派活/澄清/审批/看板/项目网盘/会议等浏览器可达的全部功能。 |
| **FR-WEB-002** | P0 | P4 | [补] | 事件经 SSE 实时订阅,关键视图(AI 处理中、状态、通知)实时更新。 |
| **FR-WEB-003** | P1 | P1 | [补] | AI 处理实时视图呈现 trace(承接 `AILiveView.tsx`),用户可看每步动作。 |
| **FR-WEB-004** | P0 | P4 | [补] | 所有状态/协作文案走 glossary 映射,**零 git 黑话、零 snake_case 状态**;高权限操作引导到桌面客户端。 |

**验收(AC)**

- **FR-WEB-001**:页面清单演进现有 `web/src/pages/*`;补审批中心(承接 [`FR-PERM-002`](#6-权限与审批-fr-perm--p-perm))。
- **FR-WEB-002**:SSE 订阅 `req:<id>`/`all`(沿用 `push_bus` 主题,[`push_bus.py:3-4`](../../../app/services/push_bus.py));断线重连。
- **FR-WEB-003**:`AILiveView.tsx`([`web/src/components/AILiveView.tsx`](../../../web/src/components/AILiveView.tsx))渲染 `ai.thinking`/`ai.tool_call`/`ai.done`,升级为读 `AgentStep`。
- **FR-WEB-004**:状态走 `statusLabel()`([`status-vocab.ts:42`](../../../shared/src/design/status-vocab.ts));高权限操作显示 `ClientDownloadBanner.tsx` 类引导([`web/src/components/ClientDownloadBanner.tsx`](../../../web/src/components/ClientDownloadBanner.tsx))。

---

## 21. 共享设计系统(`FR-UIKIT-*` · C-UIKIT)

> 见 [`05-clients/shared-ui-kit.md`](../05-clients/shared-ui-kit.md)。跨端组件/tokens/API client/类型。
> **现状锚点**:`shared/src/`(`design/status-vocab.ts`/`design/tokens.css`/`design/tailwind-preset.ts`、`api/client.ts`/`api/types.ts`/`api/time.ts`、`ui/`、`hooks/`、`index.ts`)。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-UIKIT-001** | P0 | P0 | [补] | 跨端(Web/桌宠)共用设计 tokens、组件库、hooks。 |
| **FR-UIKIT-002** | P0 | P0 | [补] | 共享 **API client + 类型**,由 daemon OpenAPI 契约驱动(类型化客户端)。 |
| **FR-UIKIT-003** | P0 | P0 | [补] | **状态→标签映射唯一来源**为 `status-vocab.ts`:任何新状态必须登记,否则用户面会漏 snake_case。 |

**验收(AC)**

- **FR-UIKIT-001**:Web 与桌宠 webview 均 import `@yqgl/shared`(演进品牌至 WorkHub,迁移期标识符可并存,glossary §9 YQGL 行)。
- **FR-UIKIT-002**:演进 `shared/src/api/client.ts`/`types.ts` 为 OpenAPI 生成类型(对齐 [`api-contract.md`](../01-architecture/api-contract.md))。
- **FR-UIKIT-003**:新增 WorkItem 状态(`ai_working`/`escalated`/`pm_mode`/`in_review`/`merged` 等)同步登记 `STATUS_VOCAB`(锚定 glossary §7.2 建议标签);`statusLabel()` 对未登记 key 不得直接吐 snake_case。

---

## 22. daemon / 契约 / 事件流(`FR-PLAT-*` · C-DAEMON · 地基)

> 上游 [PRD §11/§12 P0](../../prd/2026-06-04-workhub-prd.md);见 [`01-architecture/system-architecture.md`](../01-architecture/system-architecture.md)/[`api-contract.md`](../01-architecture/api-contract.md)/[`tech-stack-and-migration.md`](../01-architecture/tech-stack-and-migration.md)。
> **现状锚点**:FastAPI `app/main.py`(daemon 雏形)、SSE `push_bus.py`(topic + heartbeat,[`push_bus.py:50-61`](../../../app/services/push_bus.py))、引擎 DB `db.py`(SQLite 单 worker 之痛,[`db.py:22-39`](../../../app/db.py))、配置 `config.py`。

| 编号 | 优先级 | 阶段 | 来源 | 需求 |
|---|---|---|---|---|
| **FR-PLAT-001** | P0 | P0 | [补] | headless agent daemon 暴露 **OpenAPI 契约 + SSE/WS 事件流**;桌宠/Web/未来移动端皆瘦客户端。 |
| **FR-PLAT-002** | P0 | P0 | [补] | **SQLite→PostgreSQL** 迁移,逃离单 worker 天花板,支撑多 Agent+多人并发(对齐 [D-2](../../prd/2026-06-04-workhub-prd.md)/[NFR-01](../../prd/2026-06-04-workhub-prd.md))。 |
| **FR-PLAT-003** | P0 | P0 | [补] | 现有实体/认证/状态机/`auto_agent`/`lifecycle`/`spec_watch`/安全模型**迁移复用**(非重写,对齐 [D-1](../../prd/2026-06-04-workhub-prd.md))。 |
| **FR-PLAT-004** | P1 | P0 | [补] | 瞬时错误重试+退避(尊重 Retry-After);卡住/超预算优雅降级为人话交接(对齐 [NFR-06](../../prd/2026-06-04-workhub-prd.md))。 |

**验收(AC)**

- **FR-PLAT-001**:权限询问、进度、结果皆为流上事件(SSE 主题沿用 `push_bus` 形态,[`push_bus.py:3-4`](../../../app/services/push_bus.py));OpenAPI 驱动 [`FR-UIKIT-002`](#21-共享设计系统-fr-uikit--c-uikit)。
- **FR-PLAT-002**:`settings.database_url` 切 `postgresql+psycopg://…`,SQLite-only `PRAGMA` 钩子自动不触发([`db.py:8-39`](../../../app/db.py));`pool_pre_ping=True` 已就绪;新增连接池;daemon 可多 worker([data-model §9.1](../01-architecture/data-model.md))。
- **FR-PLAT-003**:复用清单见 [`tech-stack-and-migration.md`](../01-architecture/tech-stack-and-migration.md);状态映射/租户回填/JSON→JSONB/UUID 见 [data-model §9](../01-architecture/data-model.md)。
- **FR-PLAT-004**:重试退避覆盖 LLM 调用(现状超时即返回失败 `AutoResult`,[`auto_agent.py:426-430`](../../../app/services/auto_agent.py),无重试,WorkHub 补退避);降级走 [`FR-WORKER-003`](#1-ai-工人引擎-fr-worker--p-ai--l2-旗舰)。

---

## 23. 非功能需求引用(NFR · 不在本篇展开)

完整 NFR 表见 [PRD §10](../../prd/2026-06-04-workhub-prd.md)。本篇相关 FR 与 NFR 的对照(便于可追溯):

| NFR | 关联 FR |
|---|---|
| NFR-01 并发 | FR-PLAT-002、FR-COLLAB-005、FR-DRIVE-003、FR-WORKITEM-002 |
| NFR-02 安全 | FR-WORKER-006、FR-PERM-001/005/006 |
| NFR-03 可审计 | FR-AUDIT-001/003、FR-PERM-004 |
| NFR-04 可回滚 | FR-WORKER-004、FR-AUDIT-002 |
| NFR-05 成本治理 | FR-COST-001..004 |
| NFR-06 可靠性 | FR-PLAT-004、FR-WORKER-003、FR-ESC-004 |
| NFR-07 实时 | FR-PLAT-001、FR-WEB-002、FR-PET-003 |
| NFR-08 隐私 | FR-AUDIT-004、FR-NOTIFY-003、FR-WORKITEM-005 |
| NFR-09 国际化 | FR-ESC-001、FR-EXPLAIN-001(用户语言输出) |
| NFR-10 易用(小白) | FR-COLLAB-004、FR-WEB-004、FR-PET-001/002、FR-UIKIT-003 |
| NFR-11 可观测 | FR-DASH-002/003、FR-WORKER-002 |

---

## 24. 可追溯性总表(FR ↔ PRD ↔ 实体 ↔ 阶段)

> 一张表回答「每条 FR 从哪来、落在哪个实体、何时交付」。`[补]` 列标注本篇补全项。

| FR | PRD 出处 | 主要实体(data-model) | 阶段 | 补全 |
|---|---|---|---|---|
| FR-WORKER-001..004 | §8.1 | AgentRun/AgentStep/Snapshot | P1 | — |
| FR-WORKER-005..008 | §8.1(隐含)+§12 file-only 首发范围 | AgentStep/PermissionPolicy/Run whitelist | P1 | 补 |
| FR-ESC-001..005 | §8.2 | ConfidenceRecord/EscalationEvent | P1–P2 | — |
| FR-ESC-006..008 | §8.2(隐含) | ConfidenceRecord/Review | P1–P2 | 补 |
| FR-PM-001..003 | §8.3 | EscalationEvent/TaskPlan | P2 | — |
| FR-PM-004..005 | §8.3(隐含) | AuditLog/TaskPlan | P2 | 补 |
| FR-STAFF-001..005 | §8.4 | UserProfile/CollaborationGraph/Assignment | P2 | — |
| FR-STAFF-006 | §8.4(隐含) | UserProfile.availability | P2 | 补 |
| FR-COLLAB-001..004 | §8.5 | Branch/Proposal/Review | P3 | — |
| FR-COLLAB-005..006 | §8.5+NFR-01 | Branch(version)/DriveVersion | P3 | 补 |
| FR-PERM-001..004 | §8.6 | PermissionPolicy/ApprovalRequest/AuditLog | P5 | — |
| FR-PERM-005..006 | §8.6+§2.1 | ApprovalRequest/ClientDevice | P0–P1 | 补 |
| FR-SYNC-001..003 | §8.7 | (Drive/Spec via sync) | P3 | — |
| FR-SYNC-004 | §8.7(隐含) | DriveVersion(sha256) | P3 | 补 |
| FR-SPEC-001..002 | §8.8 | SpecDoc | P3 | — |
| FR-SPEC-003 | §8.8(隐含) | SpecDoc(version) | P3 | 补 |
| FR-PET-001..004 | §8.9 | (C-PET) | P4 | — |
| FR-PET-005..006 | §8.9+README | ClientDevice | P4 | 补 |
| FR-EXPLAIN-001 | §8.10 | ConfidenceRecord/citations | P1 | — |
| FR-EXPLAIN-002 | §8.10(隐含) | AgentStep | P1 | 补 |
| FR-AUDIT-001..004 | §7+§8.6+NFR-03/04/08 | AuditLog/Snapshot | P0–P1 | 补 |
| FR-COST-001..004 | NFR-05+§11 | AgentRun | P1–P5 | 补 |
| FR-IDENT-001..004 | §6+§8.4 | User/UserProfile/CollaborationGraph/Org | P0–P5 | 补 |
| FR-WORKITEM-001..005 | §7.1 | WorkItem(状态机) | P0–P1 | 补 |
| FR-DRIVE-001..004 | §2.1 | DriveItem 家族 | P0–P3 | 补 |
| FR-MEET-001..003 | §2.1 | MeetingRecord/Insight | P0–P2 | 补 |
| FR-NOTIFY-001..004 | §2.1+NFR-08 | Notification/ScheduleEvent | P0–P4 | 补 |
| FR-KB-001..002 | §3.3+§8.10 | Knowledge 家族 | P0 | 补 |
| FR-DASH-001..003 | §13+NFR-11 | (聚合 AuditLog/AgentRun) | P1–P5 | 补 |
| FR-WEB-001..004 | README §1 | (C-WEB) | P1–P4 | 补 |
| FR-UIKIT-001..003 | README §1 | (C-UIKIT/status-vocab) | P0 | 补 |
| FR-PLAT-001..004 | §11+§12+D-1/D-2 | (C-DAEMON/全实体) | P0 | 补 |

---

*下一步:本篇定 FR 全集与可追溯;阶段出入口标准见 [`phasing-p0-p5.md`](./phasing-p0-p5.md),未决项收敛见 [`../07-open-questions.md`](../07-open-questions.md)。任何新增/变更 FR 必须回填本篇编号与 §24 追溯表。*
