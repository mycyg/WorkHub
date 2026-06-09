---
module: P-COLLAB
layer: L3
status: 🚧
owner: workflow
---

# 分支 · 提议 · 合并(去黑话)

> 本篇定义 WorkHub 协作层(P-COLLAB)的核心机制:**Branch(工作分支)→ Proposal(提议)→ Merge(合并入 main)**,以及多协作者 + 多 AI 并行、冲突 AI 调解、**业务对象合并语义**(文档型 vs 结构化记录型)。
> 上游:[PRD §8.5](../../prd/2026-06-04-workhub-prd.md) · [规格树索引](../README.md)。
> 同层交叉:审批阻塞原语/打回回灌/审批路由见 [`review-and-approval.md`](./review-and-approval.md);双向同步与离线冲突见 [`sync-and-spec.md`](./sync-and-spec.md);AI 工人循环与快照见 [`../02-ai-engine/agent-loop-and-tools.md`](../02-ai-engine/agent-loop-and-tools.md);分级裁决/三触发器见 [`../02-ai-engine/confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md)。
> 地基:实体全表/ER/状态机见 [`../01-architecture/data-model.md`](../01-architecture/data-model.md);OpenAPI 路由组与事件清单见 [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md);权威术语表见 [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md)。
>
> **本篇范围边界**:写"分支/提议/合并"的**数据结构 + 状态流转 + API/事件契约 + 合并算法与规则表 + 边界/失败处理"。审批本身的策略合并(allow/deny/ask)、路由/SLA/委派、"永远允许"学习 **不在本篇**,见 `review-and-approval.md`(本篇只写"提议进入待审"这条边)。

---

## 1. 为什么需要分支(从现有线性闭环说起)

现有「需求管理大师」的协作是**线性单写**的:

- `Requirement.status`(`app/models.py:328`)单条主轴推进 `draft → ... → delivered → accepted`,任一时刻只有一个 claimant(`claimed_by_user_id`)在"干"。
- 交付以 `Delivery`(`app/models.py:515`)按 `round` 版本化,`UniqueConstraint(requirement_id, round)`;打回走 `RevisionRequest.reason_md`(`app/models.py:542`,`Text NOT NULL`),负责人「通过/打回」由 `app/routers/deliveries.py` 的 `POST /requirements/{req_id}/accept`(`deliveries.py:226`,原子 CAS 把 `status="delivered"→"accepted"`)/ `POST /requirements/{req_id}/revisions`(`deliveries.py:267`,写 `status="revision_requested"` + 落 `RevisionRequest`)两端点驱动。
- 这本质上**已是 PR-review 的雏形**(PRD §2.3 洞察):deliver=提交、accept=合并、revision=打回。但它**没有"并行工作副本"的概念**——多个协作者无法各干各的再分别汇入。

WorkHub 把这条隐式 PR 循环**显式化为 Branch/Proposal**,并让 **AI 工人也成为一个分支作者**,从而支持:
1. **多协作者 + 多 AI 并行**:每人/每 AI 一个 Branch,互不阻塞(PRD FR-COLLAB-001)。
2. **改动以提议提交**:负责人审过才汇入 main(FR-COLLAB-002)。
3. **冲突 AI 调解**:同对象并发改动时 AI 给合并方案,人择一(FR-COLLAB-003)。
4. **全程去黑话**:UI 不出现 branch/commit/merge/conflict(FR-COLLAB-004)。

> 关键设计取舍:**WorkHub 不是把业务对象塞进 git**。git 适合行级文本 diff,而 WorkItem 是**结构化记录**(状态、估时、验收项、字段),Drive 文件才是**文档**。我们用 PostgreSQL(决策 D-2)的行级锁 + 版本指针实现"逻辑分支",对**文档型**对象保留可选的 git 式三方文本合并;**对结构化记录型对象自定义字段级合并语义**——这是 opencode 未解、WorkHub 必须啃的护城河(PRD §16 开放问题 4)。

---

## 2. 去黑话映射(本篇权威子集)

承接 PRD §8.5 与 [`glossary-dejargon.md`](../00-overview/glossary-dejargon.md),本篇所有内部术语对用户的呈现一律走下表。**内部数据结构/事件可用英文术语;任何面向用户的字符串(`user_label` 字段、通知文案、桌宠话术)只能用右列**。

| 内部(git 心智 / 数据层) | 用户看到的(去黑话) | 何处强制 |
|---|---|---|
| `Branch` | 「我的工作副本 / 草稿」 | UI label、桌宠话术 |
| `commit` / `BranchChange` / diff | 「改动」 | 改动列表标题 |
| open `Proposal`(PR) | 「提交给负责人确认」 | 提交按钮、卡片标题 |
| `review` / `approve` | 「确认」 | 审批面板 |
| `reject`(带 reason) | 「打回(说原因)」 | 打回按钮 |
| `merge to main` | 「采纳 / 汇入正式版」 | 合并成功提示 |
| `conflict` | 「和别人的改动撞了,AI 给了合并方案,选一个」 | 冲突卡片 |
| `MergeProposal`(AI 调解产物) | 「AI 拟的合并方案」 | 调解卡片 |
| `base` / `ancestor` / 三方合并 | (不暴露;内部字段) | — |

> **实现护栏**:面向用户的实体一律带 `user_label: str`(由后端按上表生成,不让前端拼接黑话);所有用户可见通知复用 `app/services/lifecycle.py` 的 `_MILESTONES` 模板模式(`lifecycle.py:31`,中文人话),且严格沿用其 `str.replace`(非 `str.format`)安全替换约定——`render()` 用 `out.replace(...)` 逐占位替换,以防昵称/标题里含 `{` 触发 `KeyError` 或属性泄漏(见 `lifecycle.py:124-139` 的注释与实现),禁止把 `branch/merge/conflict` 写进 `title`/`body`。

---

## 3. 数据结构(字段 + 类型)

> 命名延续 `app/models.py` 风格:主键 `id: String(32) = uid()`、`TimestampMixin`、软删除 `deleted_at`、外键显式 `ondelete`。下表为新增/演进实体的字段级定义;完整 ER 与跨实体关系图归 [`data-model.md`](../01-architecture/data-model.md),本篇只展开协作三件套及其直接依赖。

### 3.1 `Branch`(工作分支)— 新增,核心

某协作者或某 AI 工人对某 WorkItem 内容的**独立工作副本**。它是"谁在改什么"的容器,本身不直接改 main。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `String(32)` PK | `uid()` |
| `work_item_id` | `FK requirements.id` `ondelete=CASCADE`, index | 所属 WorkItem(= 演进后的 `Requirement`) |
| `owner_kind` | `String(8)` | `human` \| `ai` —— 分支作者类别 |
| `owner_user_id` | `FK users.id` nullable, index | 人类作者(`owner_kind=human` 时必填) |
| `owner_agent_run_id` | `FK agent_runs.id` nullable, index | AI 作者的那次执行(`owner_kind=ai` 时必填,见 §3.7) |
| `title` | `String(256)` | 人话标题,如「张三的草稿」「AI 的初稿」 |
| `status` | `String(16)` default `open`, index | `open` \| `proposed` \| `merged` \| `abandoned` \| `superseded`(§4.1) |
| `base_snapshot_id` | `String(32)`, index | **分叉锚点**:创建分支时 main 的快照 id(三方合并的 `ancestor`,§6) |
| `head_snapshot_id` | `String(32)`, index | 该分支最新一次改动后的快照 id |
| `last_change_seq` | `Integer` default 0 | 单调递增,分支内 `BranchChange.seq` 的水位线 |
| `user_label` | `String(64)` | 去黑话展示名(§2),后端生成 |
| `deleted_at` | `DateTime` nullable, index | 软删除 |

唯一约束:`UniqueConstraint(work_item_id, owner_user_id, owner_kind)` 的**部分**版本 —— 一个人在一个 WorkItem 上同时只允许一个 `open` 分支(PG 部分索引 `WHERE status='open'`)。AI 分支不受此限(同一 WorkItem 可有多次 AgentRun 各自分支,但靠 `owner_agent_run_id` 区分)。

> 与现有 `RequirementWorkspace`(`app/models.py:378`)的关系:`RequirementWorkspace` 记录"某人在某需求上的进度/阶段/blocked 原因",是**进度面板**;`Branch` 是**改动副本**。二者一对一并存(同 `work_item_id`+`user_id`),`RequirementWorkspace.progress_percent` 可由 Branch 的活跃度驱动。迁移时 `RequirementWorkspace` 保留为进度视图,不被 Branch 取代。

### 3.2 `BranchChange`(分支内一次改动)— 新增

分支内一次原子改动 = 去黑话的「改动」(隐藏 commit)。AI 工人每个副作用动作、人每次保存都落一条。**与 AI 引擎的"每步快照"(PRD §8.1、FR-WORKER-004)一一对应**。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `String(32)` PK | |
| `branch_id` | `FK branches.id` `ondelete=CASCADE`, index | |
| `seq` | `Integer` | 分支内序号,与 `branch_id` 组成 `UniqueConstraint(branch_id, seq)` |
| `actor_kind` | `String(8)` | `human` \| `ai` |
| `actor_user_id` | `FK users.id` nullable, index | |
| `target_kind` | `String(16)` | 改动的对象类型:`workitem_field` \| `drive_file` \| `acceptance_item` \| `delivery` …(决定合并语义,§5) |
| `target_ref` | `String(128)`, index | 被改对象引用(如 `requirements.id` 的某字段名、`project_drive_items.id`) |
| `op` | `String(16)` | `set` \| `add` \| `remove` \| `move` \| `upload`(结构化 vs 文档差异见 §5) |
| `before_json` | `Text` nullable | 改动前值(用于回滚 + 三方合并 ancestor 侧;binary 用 sha256 占位) |
| `after_json` | `Text` nullable | 改动后值 |
| `snapshot_id` | `String(32)`, index | 该步执行后的快照(可 revert,FR-WORKER-004) |
| `reason` | `Text` nullable | 人话理由(AI 改动必填,供可解释,PRD §8.10) |

### 3.3 `Proposal`(提议)— 新增,核心

一个分支请求合并入 main 的变更集 = 去黑话的 PR。**演进自现有 `Delivery`**(`app/models.py:515`):`Delivery.round` 的"轮次"语义被 `Proposal.round` 继承,但 Proposal 不再绑死"打了个 zip 包",而是"一组 BranchChange 的快照"。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `String(32)` PK | |
| `work_item_id` | `FK requirements.id` `ondelete=CASCADE`, index | |
| `branch_id` | `FK branches.id` `ondelete=CASCADE`, index | 来源分支 |
| `round` | `Integer` | 第几轮提议;`UniqueConstraint(work_item_id, round)`(延续 `uq_delivery_req_round`) |
| `origin` | `String(8)` | `ai` \| `human` \| `pm`(经理模式整理的产物,PRD FR-PM-003) |
| `status` | `String(20)` default `open`, index | 状态机见 §4.2 |
| `base_snapshot_id` | `String(32)` | 提交时记录的 main 快照(合并前再校验是否仍是 main head) |
| `head_snapshot_id` | `String(32)` | 提议内容快照 |
| `summary_md` | `Text` nullable | 「AI 拟好了什么」的人话摘要(演进自 `Delivery.delivery_doc_md`) |
| `confidence_record_id` | `FK confidence_records.id` nullable, index | 关联的置信度/风险裁决(决定 auto-merge / 抽检 / 升级,见 confidence 篇) |
| `merge_strategy` | `String(16)` nullable | 合并时实际采用的策略(§6.4):`fast_forward` \| `field_merge` \| `version_append` \| `ai_resolved` |
| `merged_snapshot_id` | `String(32)` nullable | 合并后的 main 快照(可回滚到此之前) |
| `package_path` / `package_sha256` / `file_count` | 同 `Delivery` | 当提议含可下载产物时保留(交付包,演进自 `Delivery`) |
| `submitted_by_user_id` | `FK users.id` | 提交者(人或代表 AI 的系统用户) |
| `user_label` | `String(64)` | 去黑话展示名 |

### 3.4 `ProposalReview`(对提议的审)— 演进自 `RevisionRequest` + accept 流

本篇只定义**与合并相关**的最小字段;审批策略/路由/SLA/委派/"永远允许"学习在 [`review-and-approval.md`](./review-and-approval.md)。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `String(32)` PK | |
| `proposal_id` | `FK proposals.id` `ondelete=CASCADE`, index | |
| `reviewer_kind` | `String(8)` | `human` \| `ai`(AI 主审,PRD §6 L1) |
| `reviewer_user_id` | `FK users.id` nullable | |
| `decision` | `String(12)` | `approve` \| `reject` \| `spotcheck_pass` |
| `reason_md` | `Text` nullable | **打回必须带理由**(PRD FR-ESC-003);`reject` 时 NOT NULL(应用层强制)。演进自 `RevisionRequest.reason_md`(`app/models.py:542`) |
| `created_at` | `DateTime` | |

> **打回回灌**:`reason_md` 在 `reject` 后被回灌为 AI 续做的上下文(同分支续做而非重来,FR-ESC-003)。回灌触发/喂回机制属升级闭环,见 [`confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md);本篇只负责"`reject` → Branch 重新 `open` → 允许产生新 `BranchChange` → 新一轮 `Proposal(round+1)`"这条边。

### 3.5 `MergeAttempt`(合并尝试 / 冲突检测结果)— 新增

每次 `merge` 触发时落一条,记录冲突探测与解决路径。**合并是否冲突在此判定**(§6)。

> **R1.11-R1.20 已落最小持久化、回放、LLM candidate、选择审计与 AI 融合写回子集**：`packages/db/src/schema/core.ts` 已新增 `merge_attempts` 与 `merge_proposals`。`ProposalRepository.merge()` 会在默认 merge 被冲突 gate 挡住时写 `merge_attempts.result="conflict"` 与未选择的 `merge_proposals` 候选；在显式 `accept_incoming_target_keys` 后成功采纳时写 `merge_attempts.result="merged"`，并把相关 `merge_proposals.chosen_option_key` 记为 `accept_incoming`。R1.13 已把这些行接入 `GET /api/agent-runs/{id}/replay` 的 `merge_timeline[]`。R1.14 起 service 可通过可注入 `MergeFusionCandidateGenerator` 追加通过质量门的 `ai_fusion` 候选；LLM 未配置或失败时仍降级为 deterministic 两选一。R1.15 起 `POST /api/merge-proposals/{id}/choose` 可把候选选择写入 `chosen_*` 字段；R1.16 起 `POST /api/merge-proposals/{id}/apply` 可把 `ai_fusion.merged_value` 物化并写入正式 accepted deliverable 链路；R1.17 起冲突卡会带 `merge_proposal_id`，`ai_fusion` option 可直接显示“采用 AI 融合稿”，点击 apply 会在未选择时先写 `chosen_*`，再物化，减少一步用户操作；R1.19 起 `text_doc/spec_doc` 的合格候选正文会直接写成正式文本文件，非文本/结构化目标仍保留 Markdown artifact 降级；R1.20 起 LLM 候选 prompt 会带真实 current accepted、incoming workdir 与可匹配 base accepted 文本摘录。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `String(32)` PK | |
| `proposal_id` | `FK proposals.id` `ondelete=CASCADE`, index | |
| `result` | `String(16)` | `clean` \| `conflict` \| `merged` \| `aborted` |
| `base_snapshot_id` | `String(32)` | 三方合并的 ancestor |
| `ours_snapshot_id` | `String(32)` | main 当前 head(自分叉后 main 的演进) |
| `theirs_snapshot_id` | `String(32)` | 提议 head |
| `conflicts_json` | `Text` default `[]` | 冲突清单(§6.2 的 `ConflictItem[]`) |
| `merge_proposal_id` | `FK merge_proposals.id` nullable | 若需 AI 调解,指向调解产物 |

### 3.6 `MergeProposal`(AI 调解的合并方案)— 新增,护城河

AI 对一处冲突给出的**候选合并结果** = 去黑话的「AI 拟的合并方案」。一处冲突可有多个候选供人择一(FR-COLLAB-003)。

> **R1.12-R1.32 当前实现**：`merge_proposals` 表已落地。默认 409 写入 `keep_current` / `accept_incoming` 两个 deterministic candidate，`recommended_option_key="keep_current"`、`chosen_option_key=null`；用户显式采纳 incoming 的成功 merge 会写 `chosen_option_key="accept_incoming"`、`chosen_by_user_id`、`chosen_at`。R1.14 起支持把 LLM 生成且通过质量门的 `ai_fusion` candidate 合并进 `candidates_json` 并在 409 / replay 中展示；R1.15 起支持显式选择任一候选并回显 candidate；R1.16 起支持把 `ai_fusion` apply 成正式融合稿，写入 `accepted_deliverable_changes`、`ProjectDriveVersion`、`snapshots(kind=merge)`、`merge_attempts(result="merged")` 与 `proposal.merged` audit。R1.17 起，若原 row 未选择，apply 会把“采用 AI 融合稿”点击本身记录为 `chosen_option_key="ai_fusion"`；若已选择其它候选，apply 会被拒绝。R1.19 起 `text_doc/spec_doc` 直接写候选正文，拒绝带 `<<<<<<<` / `=======` / `>>>>>>>` 的脏内容；R1.20 起 prompt/context 输入包含真实 current/incoming/base 文本摘录；R1.21 起 `ai_fusion.quality_gate.text_patch_preview` 会持久化 current -> merged 的 unified patch 预览；R1.22 起 Replay 严肃页会把该 preview 渲染为可扫描 diff；R1.23 起 409 / `/conflicts` 的 `ai_fusion` option 也会携带同一 `quality_gate`，Proposal 冲突卡可在采用前展示最小 patch preview；R1.24 起 text/spec 冲突会先跑 deterministic line diff3，无重叠 hunk 直接生成 `source="diff3"` 的 `ai_fusion` candidate，质量门包含 `text_diff3` 与 patch preview；R1.25 起重叠 hunk 的 LLM prompt 和质量门携带 `text_diff3_conflicts` / `text_diff3.auto_merge=false`；R1.26 起 Proposal 冲突卡与 Replay 决策记录可见化 `text_diff3` 自动/需复核状态、hunk 数和影响行；R1.27 起 `structured_record` 的 `ai_fusion` 质量门携带 `structured_record_patch`，列出目标对象、声明变更字段、模型实际给出的字段、缺失字段和额外字段，并在 Proposal / Replay 中可见；R1.28 起 contracts 固化 `StructuredFieldPatch` / `StructuredFieldPatchDryRun`，candidate 质量门携带 dry-run，Proposal / Replay 可见 dry-run 状态，API apply 会先 dry-run 并阻断 blocked 结构化字段建议。R1.29 起 `structured_record` 的 ready + executable WorkItem 标量字段补丁可在同一 merge transaction 内写回 `title`、`summary_md`、`priority`、`due_at`，并写 `merge_strategy="field_merge"`、`structured_field_changes` 审计、merge snapshot 与 merged attempt；该路径不创建 `accepted_deliverable_changes` 或 `ProjectDriveVersion`。R1.30 起 proposal 创建会把 WorkItem 标量 base 值写入 `machine_summary.field_values_before`，dry-run operation 携带 `before_value`，apply 时只有 `current == base` 或 `current == incoming` 才能写回；真正冲突返回 409 `structured_field_patch_conflict`，缺 base 返回 409 `structured_field_patch_base_missing`。R1.31 起 `acceptance_items` 也按稳定 id 捕获 base，并在同一 transaction 内替换写回 `work_item_acceptance_items`，审计 `itemCount` 与 base/current/incoming。R1.32 起最新 `dispatch` plan 的 `task_items` 也按稳定 id 捕获 base，并在同一 transaction 内替换写回 `work_item_task_items`，审计 `itemCount` 与 base/current/incoming。`needs_review`、`status`、目标不匹配和非法 task item 仍 fail-closed；重叠 hunk 逐项确认/编辑、React route 级逐行富 viewer、任务子记录多计划/逐项 UI 与多冲突批量工作台仍未完成。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `String(32)` PK | |
| `merge_attempt_id` | `FK merge_attempts.id` `ondelete=CASCADE`, index | |
| `conflict_key` | `String(128)`, index | 对应 `ConflictItem.key`(哪个字段/哪个文件) |
| `candidates_json` | `Text` | `MergeCandidate[]`:`[{option_key, target_kind, merged_value, rationale_md}]` |
| `recommended_option_key` | `String(64)` nullable | AI 推荐项(人话理由在 candidate 内) |
| `chosen_option_key` | `String(64)` nullable | 人选定项;null=未决 |
| `chosen_by_user_id` | `FK users.id` nullable | |
| `chosen_at` | `DateTime` nullable | |

### 3.7 与 AI 引擎的接缝:`AgentRun`(演进自 auto_agent)

不在本篇定义全字段(归 [`agent-loop-and-tools.md`](../02-ai-engine/agent-loop-and-tools.md)),但**协作层依赖三点**,在此固定接口:

1. **AI 工人 = 分支作者**:一次 `AgentRun` 绑定一个 `Branch`(`Branch.owner_agent_run_id`)。AI 在沙箱里干活(延续 `app/services/auto_agent.py` 的工具集 `list/read/write/mkdir/move/delete/run_command/zip/submit`、沙箱 `_safe_path`、预算 `MAX_TURNS=15`/`TOTAL_TIMEOUT_DEFAULT=300s`),产物落进该分支而非直接进 main。
2. **自然停止 + `outputs/` → manifest → Proposal**:`submit` 不再是唯一完成信号。当前 TS-first 口径是 `AgentLoop` 在模型自然停止且 `outputs/` 非空时生成 `DeliverableChangeManifest`，`AgentRunQueue` 成功后调用 `ProposalService.createFromManifest` 自动打开 Proposal。`submit` 只作为可选收尾标注保留，不能作为 R1 完成证据。
3. **`llm_review` → ConfidenceRecord**:现有 `llm_review`(`auto_agent.py:544`,输出 `{meets_requirement, reason}`)是置信度信号源之一,产物归到 `Proposal.confidence_record_id`,决定 auto-merge / 抽检 / 升级(本篇 §7 只消费裁决结果)。

> **2026-06-08 实现切片**：`apps/api/src/workers/agent-runner.ts` 已把成功 run 的 manifest 接到 proposal service，并发 `proposal.opened`；`packages/db/src/repositories/proposals.ts` 已能持久化 `Branch/Proposal/Review`。未完成的是 `AgentRun/AgentStep` DB store、queue pump、merge 写 main 与真实 replay。

### 3.8 快照(Snapshot)的物理形态

PRD §8.1「每步 git 快照」落地为统一的 `Snapshot` 引用(供 BranchChange / Proposal / MergeAttempt / 合并回滚共用):

- **结构化记录型**(WorkItem 字段、验收项):快照 = 受影响行的字段值 JSON 落 `Snapshot.payload_json` + `sha256`。回滚 = 字段级 restore。
- **文档型**(Drive 文件、交付包):快照 = 内容寻址(`sha256`),复用现有去重范式——`ProjectDriveVersion.sha256`(`app/models.py:204`)、`Delivery.package_sha256`、`spec_watch.rs` 的 SHA256 去重(`spec_watch.rs:743 sha256_of`)。**已存在的 sha 不重复存储**(append-only,延续 `spec_watch.rs` 注释的去重契约)。

> 这样可回滚(NFR-04)与审计(NFR-03)对两类对象统一为"按 snapshot_id revert",落进 `AuditLog`(PRD §7 新增治理实体)。

---

## 4. 状态流转

### 4.1 Branch 状态机

```
open ──(提交)──────────────► proposed
 ▲                              │
 │ (打回 reject / 续做)         ├─(approve+merge)──► merged   [终态]
 └──────────────────────────────┤
                                ├─(被另一提议先合并,内容已过时)──► superseded [终态]
                                └─(放弃 / WorkItem 取消)─────────► abandoned   [终态]
```

- `open → proposed`:产生 Proposal(§4.2),分支锁定为只读(防止边审边改导致 head 漂移)。
- `proposed → open`:被打回(`reject`),分支解锁,可续做(回灌 reason),下一轮 `Proposal.round+1`。
- `proposed → superseded`:并发下另一分支先合并且**令本分支内容失效**(§6.5 的"提议过时"判定)。
- `merged`/`abandoned`:终态。

### 4.2 Proposal 状态机(演进自 Delivery/Revision 流)

```
                ┌───────────────────────── reject(reason) ──────────────────────┐
                ▼                                                                 │
 open ──(进入审批)──► in_review ──┬─ approve ──► merging ──┬─ clean ───► merged   [终态]
                                  │                        │
                                  │                        └─ conflict ─► conflict_resolving
                                  │                                          │
                                  └─ spotcheck_pass ──► merging              │ (人择一 / AI 调解)
                                                                              ▼
                                                                     merging(retry)
 open / in_review ──(撤回 / WorkItem 取消)──► withdrawn  [终态]
```

状态语义:
- `open`:刚由分支生成,尚未路由给审批人(路由属 `review-and-approval.md`)。
- `in_review`:等待审批决策。**审批是阻塞原语**(PRD §8.6),阻塞点的 ask/路由不在本篇。
- `merging`:进入合并执行(§6),先做冲突探测。
- `conflict_resolving`:探测到冲突 → 创建 `MergeProposal`,等人择一;选定后回到 `merging` 重试。
- `merged`:写入 main,记录 `merged_snapshot_id` + `merge_strategy`,源 Branch → `merged`。
- `withdrawn`:作者撤回或 WorkItem 取消。

### 4.3 与 WorkItem(Requirement)主状态机的耦合

WorkItem 状态机(PRD §7.1)是**主轴**,Proposal/Branch 是其 `in_review/merged` 段的展开。对照:

| WorkItem 状态(PRD §7.1) | 协作层事件 | 现有锚点 |
|---|---|---|
| `ai_working` | 创建/更新 AI `Branch` | `auto_agent.py` run loop |
| `auto_proposal` / `human_spotcheck` | `Proposal.open → in_review` | (新增) |
| `in_review` | `Proposal.in_review` | 演进自 `delivered`(等验收) |
| `merged` | `Proposal.merged` + main 更新 | 演进自 `accepted`(`deliveries.py` accept) |
| `reject → ai_working`(回灌) | `Proposal.reject` + `Branch.open` | 演进自 `revision_requested`(`deliveries.py` request-revision) |
| `escalated → pm_mode` | doom-loop/超预算/低置信 → 不产生 auto-merge,转人(经理整理为 `origin=pm` 的 Proposal) | 见 confidence 篇 |

> **迁移映射(给 plan)**:现有 `app/routers/deliveries.py` 的 `POST /requirements/{req_id}/accept`(`deliveries.py:243` 写 `status="accepted"`)演进为 `Proposal.approve → merge`;`POST /requirements/{req_id}/revisions`(`deliveries.py:297` 写 `status="revision_requested"` + 落 `RevisionRequest`,并已调用 `queue_status_notifications(..., "revision_requested", ...)`,`deliveries.py:317`)演进为 `ProposalReview(decision=reject)` + Branch 续做。`app/services/lifecycle.py` 的 `_MILESTONES`(`lifecycle.py:31`)增加 `proposed`/`merged`/`merge_conflict` 三个里程碑模板(人话、去黑话),复用 `queue_status_notifications`(`lifecycle.py:104`)。

---

## 5. 业务对象合并语义(护城河:文档型 vs 结构化记录型)

> 这是 PRD §16 开放问题 4 的落点,也是 opencode(纯文本 git)未解的点。**不同 `target_kind` 走不同合并算法**;`BranchChange.target_kind` 即路由键。

### 5.1 类型分类表

| 合并类(merge class) | 对象示例 | 现有锚点 | diff 单位 | 合并算法 | 冲突单位 |
|---|---|---|---|---|---|
| **结构化记录型 STRUCT** | WorkItem 字段(title/summary_md/priority/due_at)、`RequirementAcceptanceItem`、`RequirementTaskItem` | `app/models.py:314 / 464 / 448` | **字段 / 子记录** | 字段级三方合并(§5.2) | 单个字段 / 单条子记录 |
| **文档型 DOC(文本)** | Drive 文本文件(md/txt/代码)、`SpecDoc`(README) | `ProjectDriveVersion.parsed_text`(`models.py:205`)、spec 文件夹 | **行 / 块** | 三方文本合并(可选 git 风格),失败→ AI 调解 | 文本块 / hunk |
| **文档型 DOC(二进制)** | Drive 二进制文件、交付 zip | `ProjectDriveVersion.sha256`、`Delivery.package_sha256` | **整文件(sha256)** | 版本追加 + 指针选择(§5.3),**不做内容合并** | 整文件 |
| **集合型 SET** | 协作者列表 `RequirementAssignment`、附件集合 | `models.py:363 / 479` | **元素增删** | 并集 + 去重(add/add 不冲突;同元素 set 冲突) | 同 key 的相斥设值 |

### 5.2 STRUCT 字段级三方合并(算法)

对每个被改字段 `f`,取三方值:`base=ancestor(分叉时)`、`ours=main 当前`、`theirs=提议`。

```
for f in changed_fields(theirs):
    b, o, t = base[f], ours[f], theirs[f]
    if o == b:                      # main 未动该字段
        merged[f] = t               # 采纳提议  (fast-path)
    elif t == b:                    # 提议未真正改(同 base)
        merged[f] = o               # 保持 main
    elif o == t:                    # 双方改成同值
        merged[f] = o               # 无冲突
    else:                           # 三方都不同 → 真冲突
        conflicts.append(ConflictItem(key=f, base=b, ours=o, theirs=t))
```

- **子记录(验收项/任务项)**:按稳定 key(子记录 `id`)做集合三方合并;同一子记录的字段再走上面的字段级规则。`add/add`(双方各加不同子项)= 并集,无冲突;`edit/edit` 同一子项的同字段不同值 = 冲突。
- **可自动消解的特例**(规则表,降低打扰):

| 字段 | 规则 | 理由 |
|---|---|---|
| `summary_md`(WorkItem 摘要,长文本) | 退化为 **DOC 文本三方合并**;失败才冲突 | 摘要是文档,不是标量 |
| `progress_percent`(`RequirementWorkspace`) | 取 `max(ours, theirs)` | 进度只增不减 |
| `status`(主状态) | **永不自动合并** —— 状态机转移只能由唯一权威路径写(§5.5),提议不得直接改 `status` | 防并发状态错乱 |
| `priority` / `due_at` 等标量 | 三方规则 + 冲突 | 需人裁 |

### 5.3 DOC 二进制 / 文件:版本追加 + 指针选择(扎根现有 Drive)

Drive 已有的并发模型就是答案的雏形,WorkHub 在其上加"分支指针":

- 现有:`ProjectDriveItem.current_version_id`(`models.py:176`)指向当前版本;新版本 `ProjectDriveVersion` 以 `version_no` 追加(`UniqueConstraint(item_id, version_no)`,`models.py:194`);同名上传冲突由 `app/routers/project_drive.py` 的 `conflict: replace|cancel`(`project_drive.py:859`)处理,replace 时记录 `previous_version_id`(`project_drive.py:965`)以便回退(`project_drive.py:1525`)。
- WorkHub 扩展:文件改动在分支内表现为**新增 `ProjectDriveVersion`(append-only,不动 main 的 `current_version_id`)**。合并 = 把 `current_version_id` 指针指向提议版本。
  - **clean**:自分叉以来 main 的该文件 `current_version_id` 未变(`ours==base`)→ 直接指针前移(`merge_strategy=version_append`)。
  - **conflict**:main 的该文件也产生了新版本(两个 `version_no` 都基于同一 `base`)→ **二进制不合并**,生成 `MergeProposal`,候选 = `{保留 main 版 / 采纳提议版 / 两个都留(改名)}`,人择一(去黑话:「两份文件撞了,要哪个,还是都留下?」)。
- **回滚/还原**:合并后回退 = 把 `current_version_id` 指回旧版本指针(沿用 `project_drive.py:1525` 的 restore 路径)。R1.8 最小实现已先按 accepted ledger 找上一版同 target / 同 drive item 的 `drive_version_id`，恢复 `ProjectDriveItem.current_version_id`，并写 Drive operation + audit；完整 `Proposal.merged_snapshot_id` 多文件回滚与 redo UI 后续补齐。

> **2026-06-09 R1 TS 切片**：`accepted_deliverable_changes` 已作为正式采纳账本落地；AgentRun-backed delivery 也已接入最小 `ProjectDriveItem/Version`：merge 前从 `Branch.agent_run_id -> AgentRun.workdir_ref` 找源文件，校验 sha 后复制到正式 storage root，merge transaction 内追加 `ProjectDriveVersion`、前移 `ProjectDriveItem.current_version_id`，并把 `drive_item_id/drive_version_id` 写回 accepted row。WorkItem page 与 AgentRun replay page 已能展示 accepted deliverables，并提供下载/文本预览；R1.8 已补 `POST .../restore`，可把当前正式交付物还原到上一版并审计。R1.9 已补最小冲突调解 API：`GET /api/workitems/{id}/conflicts` 返回 deterministic 两选一冲突卡，`POST /api/proposals/{id}/merge` 可带 `conflict_resolution.accept_incoming_target_keys` 显式采纳 incoming。R1.10 已把这份 conflict contract 接到 Web/Desktop/Cuu：页面渲染 option-first 冲突卡，merge 409 notice 可点击重试，独立桌宠可提交同一 payload。R1.11/R1.12 已把冲突尝试、候选方案与显式采纳 incoming 选择写入 `merge_attempts`、`merge_proposals` 与 `proposal.merged` audit detail；R1.13 已把这些记录接入 AgentRun replay timeline；R1.14 已把 LLM `ai_fusion` candidate 生成、质量门、持久化和展示接入同一通道；R1.15 已把候选选择写入同一审计通道；R1.16 已把 `ai_fusion` 物化为正式融合稿并复用 accepted ledger / Drive version / merge audit；R1.17 已把 409 / conflicts 返回里的 `ai_fusion` option 接成 Web/Desktop/Cuu 一键“采用 AI 融合稿”，服务端未选择时自动记录 `chosen_*`；R1.19 已让 `text_doc/spec_doc` 的融合正文直接写回正式文件，并拒绝冲突 marker；R1.20 已让候选生成读取真实 current/incoming/base 文本摘录；R1.21 已在 candidate quality gate 中持久化 text patch preview；R1.22 已把 replay candidate patch preview 渲染为可见 diff；R1.23 已把同一 preview 下沉到 Proposal 冲突卡的 `ai_fusion` option，用户采用前能看到最小 diff；R1.24 已为无重叠文本 hunk 生成 deterministic `source="diff3"` 融合 candidate；R1.25/R1.26 已把重叠 hunk 的原因和行号带到质量门并可见化；R1.27 已为 `structured_record` 候选补字段级 patch 元数据和 Proposal / Replay 可见化；R1.28 已把结构化字段 dry-run 契约、apply 阻断和 dry-run 状态可见化接入；R1.29 已把 ready + executable 的 WorkItem 标量字段补丁写入 `work_items`，覆盖 `title`、`summary_md`、`priority`、`due_at`，并把字段前后值写入 audit；R1.30 已把 WorkItem 标量字段 base 捕获、`before_value` dry-run、fast-path/same-value/true-conflict 判定接入，true conflict 409 不静默覆盖当前人工值；R1.31 已把 `acceptance_items` 子记录从 warning 升级为可执行替换写回，按稳定 id 捕获 base、比较 current/base/incoming，并写入 `work_item_acceptance_items` 与 `itemCount` 审计；R1.32 已把最新 `dispatch` plan 的 `task_items` 升级为可执行替换写回，并写入 `work_item_task_items` 与 `itemCount` 审计。仍未完成的是富预览、云对象存储 adapter、任务子记录多计划/逐项 UI、字段级编辑器、重叠 hunk 逐项确认/编辑、React route 级富 patch viewer 与多冲突逐项选择工作台。

### 5.4 DOC 文本三方合并

- 优先**三方文本合并**(base/ours/theirs 的行级 merge,类 `diff3`)。无重叠 hunk → 自动合并(`merge_strategy=field_merge`/文本变体)。
- 重叠 hunk → 不写带 `<<<<<<<` 标记的脏文件(那是黑话且不可用),而是**整块作为一个 `ConflictItem`** 交 AI 调解,AI 产出"融合两边意图"的候选文本(§6.3),人择一/微调。
- 文本相等性以规整后内容比较(忽略行尾差异);二进制判定走"非 UTF-8 解码失败"(复用 `auto_agent.py:208` `read_file` 的 `UnicodeDecodeError` 分支思路)。

### 5.5 不可合并的写(权威单写路径)

下列写**不走分支合并**,只能由唯一权威路径串行执行(避免并发语义灾难):
- `Requirement.status` 主状态转移 —— 由 lifecycle 状态机(演进 `app/services/lifecycle.py`)在 PG 行级锁下串行写。
- 合并本身(§6 的 `merge`)对 main 的写。
- 任何治理/权限策略变更。

> 这条对应 PRD §5「AI 绝不静默改生产态」——main 的状态推进永远经审批 + 唯一路径,提议只能"请求",不能"直写"。

---

## 6. 合并算法、并发与冲突 AI 调解

### 6.1 触发与并发控制

- **触发**:`Proposal.approve`(或 `spotcheck_pass`,或高置信低风险 auto-merge,裁决见 confidence 篇)→ `status=merging` → 进入合并。
- **并发控制(PG,决策 D-2)**:合并对 `work_item_id`(及涉及的 Drive item 行)取**行级锁** `SELECT ... FOR UPDATE`,序列化同一 WorkItem 的多个合并;DOC 二进制/集合的指针更新用乐观 `base_version` 比对(`Proposal.base_snapshot_id == main.head` 校验)。这是逃离 SQLite 单 worker(PRD NFR-01)后才可能的真并发合并。
- **base 再校验**:进入 `merging` 时先比 `Proposal.base_snapshot_id` 与 main 当前 head:
  - 相等 → main 自分叉未变 → 可能 `fast_forward`。
  - 不等 → main 已前进 → 必须三方合并,按 `target_kind` 路由(§5)。
- **R1 当前 gate**:在完整 `MergeAttempt` 表落地前，`ProposalRepository.merge` 先读取同一 `work_item_id + target_key` 的 current accepted row。若 incoming 带 `sha256_before/version_before`，必须与 current 对齐；若 `created/generated` 同路径 sha 不同，或 `updated/replaced/deleted` 缺 before ref，则直接返回 `merge_conflict`，避免静默覆盖正式版。AgentRun-backed delivery 还会额外校验 workdir 源文件实际 sha，采纳后 accepted row 必须能指到正式 `ProjectDriveVersion`。
- **R1.9/R1.10 当前调解入口**:冲突 gate 不再只返回裸 409。`ProposalRepository.listConflictsByWorkItem(work_item_id)` 会列出已确认 proposal 与 current accepted row 的冲突；`ProposalService` 映射为 `ProposalConflictListResult`，每个冲突至少有 `keep_current` 与 `accept_incoming` 两个 option。默认推荐 `keep_current`；只有用户通过 option action 发回 `conflict_resolution.accept_incoming_target_keys`，repository 才允许该 target 覆盖正式版。没有显式选择时仍 409。R1.10 已把这些 option 接到 `packages/ui`、`apps/web`、`apps/desktop-webview` 与 `packages/cuu`：主窗显示严肃冲突卡，独立 Cuu pet window 显示轻卡并透传 action payload。
- **R1.11 当前审计入口**:每次 `POST /api/proposals/{id}/merge` 都会形成可追踪尝试。默认 merge 若被冲突挡住，事务先写 `merge_attempts(result="conflict", conflicts_json)` 再返回 409；显式采纳 incoming 后成功 merge，写 `merge_attempts(result="merged", accepted_target_keys, conflicts_json)`，并在 `AuditLog(action="proposal.merged").detail_json.merge_attempt_id` 中串起 attempt、snapshot 与 accepted ledger。这样 replay 能解释“为什么当时没合并”和“后来为什么覆盖正式版”。
- **R1.12-R1.32 当前候选与回放入口**:`merge_attempts` 下会同时写 `merge_proposals`。默认 409 的候选 row 包含 `keep_current` / `accept_incoming`，但 `chosen_option_key=null`；成功采纳 incoming 的 row 写 `chosen_option_key="accept_incoming"` 与 `chosen_by_user_id/chosen_at`。R1.13 的 AgentRun replay 会读取同一数据通道展示 candidate、recommended 与 chosen 状态；R1.14 起 service 可把通过质量门的 `ai_fusion` 作为第三类 candidate 传入 repository 并持久化；R1.15 起可通过 choose endpoint 选择 `ai_fusion`；R1.16 起可通过 apply endpoint 把 `ai_fusion` 物化成正式融合稿；R1.17 起冲突卡可直接 POST apply，服务端在未选择时把该点击写成 `chosen_option_key="ai_fusion"`；R1.19 起 `text_doc/spec_doc` apply 写入正文而不是包装说明；R1.20 起候选生成读取 current/incoming/base 真实文本摘录；R1.21 起 candidate 会持久化 current -> merged patch preview；R1.22 起 replay 会显示该 patch preview；R1.23 起 Proposal 冲突卡会在 `ai_fusion` option 下显示采用前最小 patch preview；R1.24 起无重叠文本 hunk 可不调用 LLM 直接生成 `source="diff3"` 的 `ai_fusion` candidate；R1.25 起重叠 hunk 会把 conflict ranges 与双方改动行写入 LLM prompt 和 candidate quality gate；R1.26 起页面能显示 `text_diff3` 状态和影响行；R1.27 起页面能显示 `structured_record_patch` 的拟写入字段、缺失字段和额外字段；R1.28 起页面能显示 `StructuredFieldPatchDryRun` 状态，apply 会先 dry-run 并拒绝 blocked 结构化字段候选；R1.29 起 ready + executable 结构化字段候选可直接写回 WorkItem 标量字段，并把 `structured_field_changes` 进入 merge audit；R1.30 起写回前会比较 base/current/incoming，人工并发改动返回 `structured_field_patch_conflict` 并保持 proposal 未合并；R1.31 起 `acceptance_items` 子记录也可按稳定 id 写回，并保留同样冲突保护；R1.32 起最新 `dispatch` plan 的 `task_items` 子记录也可按稳定 id 写回，并保留同样冲突保护。后续仍需任务子记录多计划/逐项 UI、重叠 hunk 逐项确认/编辑、React route 级富 patch viewer 与多冲突工作台。

### 6.2 `ConflictItem` 结构(冲突清单)

```
ConflictItem = {
  key:         str,            # 字段名 / 子记录 id / 文件 item_id / hunk 锚
  merge_class: str,            # STRUCT | DOC_TEXT | DOC_BIN | SET
  target_kind: str,           # 同 BranchChange.target_kind
  base:        json|sha256,    # ancestor 侧
  ours:        json|sha256,    # main 当前
  theirs:      json|sha256,    # 提议
  user_hint:   str             # 去黑话提示:「『截止日期』你和李四都改了」
}
```

### 6.3 AI 调解(FR-COLLAB-003,护城河)

当 `MergeAttempt.result=conflict`:

1. **逐 `ConflictItem` 生成 `MergeProposal`**:TS-first 运行时复用 `ProviderRegistry` / Anthropic-compatible provider（DeepSeek 端点由 `packages/config` 配置），system prompt 喂"base/ours/theirs + WorkItem 上下文 + 各方改动理由(`BranchChange.reason`)",要求输出候选 + 人话 `rationale_md`,**禁止输出 git 标记**。STRUCT/DOC_TEXT 可由 AI 融合；DOC_BIN/SET 通常给"二选一/都留"枚举候选(无需 LLM 生成内容,降本)。旧 Python `auto_agent.py` 只作为迁移参考，不再作为新增实现目标。
2. **呈现**:UI 一张冲突卡:「和别人的改动撞了,AI 给了合并方案,选一个」,展示 `recommended_option_key` + 各候选 `rationale_md`。
3. **人择一/微调**:写 `chosen_option_key`/`chosen_by_user_id`/`chosen_at`;允许人手动覆盖为自定义值(记为额外 candidate)。
4. **回到 merging**:所有 `ConflictItem` 都有 `chosen` 后,用选定值组装 `merged` 结果,`merge_strategy=ai_resolved`,写 main。

> AI 调解只**建议**,人**裁决**——与 PRD §5 一致;调解失败/AI 不可用 → 降级为纯"二选一"枚举,绝不阻塞(失败处理见 §8)。
>
> **当前 R1.9-R1.32 状态**：已先落“二选一枚举”作为可用纵切：`keep_current`=保留正式版并回到变更申请；`accept_incoming`=用户明确采纳这次版本，POST body 固定为 `{conflict_resolution:{accept_incoming_target_keys:[target_key]}}`。Web/Desktop/Cuu 都已用 option-first 卡片承载这些动作，保证小白可以点选，不需要输入文字；R1.11/R1.12 已把冲突尝试、候选方案与用户选择落到 `merge_attempts`、`merge_proposals` 与 `proposal.merged` audit detail；R1.13 已在 replay 展示。R1.14 已把 LLM 融合候选接成可注入 service：有 provider 配置时对 `structured_record/text_doc/spec_doc` 尝试生成 `ai_fusion`，写入同一 `merge_proposals.candidates_json`。R1.15 已补 choose endpoint，可把 `ai_fusion` 选择写入 `chosen_*`。R1.16 已补 apply endpoint，可把 `ai_fusion.merged_value` 采纳到正式交付物。R1.17 已把冲突卡里的 `ai_fusion` 从“查看建议”升级为可执行的“采用 AI 融合稿”：payload 为 `POST /api/merge-proposals/{id}/apply {confirm:true}`，服务端在未选择时自动记录 `chosen_*`，已选其它候选时拒绝覆盖。R1.19 已补 `text_doc/spec_doc` 正文直写和冲突 marker 拒绝；R1.20 已补真实文本上下文；R1.21 已补数据层 patch preview；R1.22 已补 Replay 可见 patch preview；R1.23 已补 Proposal 采用前最小 patch preview；R1.24 已补 base/current/incoming 无重叠文本 hunk 的 deterministic line diff3 candidate；R1.25/R1.26 已补重叠 hunk 质量门和 Proposal / Replay 可见化；R1.27/R1.28 已补 `structured_record_patch`、`StructuredFieldPatchDryRun` 质量门、dry-run apply gate 和 Proposal / Replay 可见化；R1.29 已补 WorkItem `title/summary_md/priority/due_at` 标量字段 transaction 写回；R1.30 已补 WorkItem 标量字段 base/current/incoming 冲突检测，人工并发修改会返回 `structured_field_patch_conflict` 且不覆盖当前值；R1.31 已补 `acceptance_items` 子记录写回和冲突检测；R1.32 已补最新 `dispatch` plan 的 `task_items` 子记录写回和冲突检测。LLM 未配置、失败、JSON 不合格、目标类型不支持时继续降级为两选一或 Markdown artifact；无重叠文本合并不再依赖 LLM。尚未完成的是任务子记录多计划/逐项 UI、重叠 hunk 逐项确认/编辑、React route 级富 patch viewer 和多冲突逐项工作台。

### 6.4 合并策略枚举(写回 `Proposal.merge_strategy`)

| 策略 | 触发条件 | 写回动作 |
|---|---|---|
| `fast_forward` | `base==main.head`,无任何并发改动 | 直接把提议 head 提升为 main head |
| `field_merge` | STRUCT/DOC_TEXT 三方无冲突 | 写合并后字段值/文本 |
| `version_append` | DOC 文件,main 该文件未动 | 前移 `current_version_id` |
| `ai_resolved` | 有冲突且经 `MergeProposal` 人择一 | 写选定值 |

### 6.5 "提议过时"判定(superseded)

并发下,提议 A 在审,提议 B 先合并并改了 A 也要改的同一 `key`:
- A 进入 `merging` 时 base 再校验发现 main 已含 B 的改动:
  - 若 A 与 B 改动**不相交** → 正常三方合并(无冲突),A 仍可合并。
  - 若 A 的所有改动都已被 B 覆盖(A 的 theirs==合并后 main)→ A `superseded`(去黑话:「这份改动已经被别人的版本包含了,不用再提交」)。
  - 若相交且值不同 → 冲突,走 AI 调解。

---

## 7. 与分级裁决的接缝(本篇只消费结果)

置信度/风险的**计算与阈值**归 [`confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md);本篇只定义"裁决结果如何作用于 Proposal 的合并路径":

| 裁决档(PRD §8.2) | 协作层动作 |
|---|---|
| 高置信 + 低风险 | `Proposal.open → (策略允许时)auto-merge`:跳过人工 `in_review`,直接 `merging`;仍走冲突探测(撞车照样调解)。审计记 `reviewer_kind=ai`。 |
| 中等 | `Proposal.open → in_review`(`human_spotcheck`):人快速 `spotcheck_pass`/`reject` |
| 低置信 / 高风险 / doom-loop / 超预算 | **不生成 auto-merge**:WorkItem 转 `escalated`/`pm_mode`;若已有分支产物,经理模式整理为 `origin=pm` 的 Proposal 走正常人审 |

> doom-loop / 预算耗尽信号来自 AI 引擎(`auto_agent.py` 的 `MAX_TURNS`/超时 → 结构化交接,PRD FR-WORKER-003)。本篇保证:**未达高置信低风险的提议绝不自动并入 main**(呼应 §5.5、PRD §5)。

---

## 8. 边界条件与失败处理

| 场景 | 处理 |
|---|---|
| **AI 不可用 / 调解 LLM 调用失败** | 降级为纯枚举候选(保留 main / 采纳提议 / 都留),绝不阻塞合并决策;参照 `auto_agent.py:571` 的"LLM 失败返回结构化错误而非崩溃" |
| **合并写入中途失败(部分写)** | PG 事务内合并,失败整体回滚;`MergeAttempt.result=aborted`,Proposal 退回 `in_review`,通知作者重试 |
| **base 快照丢失 / 不可达** | 退化为两方比较(无 ancestor):任何双改即判冲突,交人裁(保守,不臆造合并) |
| **空提议(无 BranchChange)** | 拒绝创建 Proposal(演进自 `auto_agent.py:455` "submit 但产物为空 → 失败");去黑话提示「还没有任何改动可提交」 |
| **打回但无理由** | 应用层强制 `reject` 必填 `reason_md`(FR-ESC-003);缺失 → 422 |
| **同一 WorkItem 多提议并发合并** | 行级锁串行;后到者进入 `merging` 时 base 再校验 → 三方合并 / superseded(§6.5) |
| **分支作者(人)被软删除** | 沿用 `User.deleted_at` 软删除范式(`models.py:43`):分支保留(引用完整性),`user_label` 走 `display_name`(`models.py:46`)的"（已停用）"逻辑;未合并提议可由负责人接管或弃置 |
| **二进制冲突误判为文本** | 解码失败即判 DOC_BIN(`UnicodeDecodeError` 分支),只给整文件择一,绝不损坏二进制 |
| **WorkItem 在审批期间被取消** | 关联 Proposal/Branch → `withdrawn`/`abandoned`,复用 `lifecycle.py` `cancelled` 里程碑通知双方(`other_side`) |
| **合并成功但回滚需求** | 按 `Proposal.merged_snapshot_id` 字段级/指针级 revert(NFR-04),记 `AuditLog` |
| **跨用户事件泄漏** | 提议/冲突事件按身份隔离推送(NFR-08);沿用 `push_bus.py` 的 per-topic 订阅(`req:<id>`),敏感 payload 不进 `all` 主题 |

---

## 9. API / 事件契约(摘要)

> 完整 OpenAPI 路由组 + 鉴权中间件 + 全量事件清单归 [`api-contract.md`](../01-architecture/api-contract.md)。本篇给协作三件套的**契约骨架**,设备令牌门(接活/干活需桌面客户端,见 [README §1](../README.md))对"创建/更新分支、提交提议"这类干活动作生效;"审批/采纳"浏览器可达。

### 9.1 REST(路由组 `/workitems/{id}/...`)

| 方法 + 路径 | 动作(内部) | 用户语义 |
|---|---|---|
| `POST /workitems/{id}/branches` | 开 Branch（人或代表 AgentRun） | 「开始做 / 起草」 |
| `GET /workitems/{id}/branches` | 列分支 | 「谁在做什么」 |
| `POST /branches/{bid}/changes` | 追加 BranchChange（+ snapshot） | 「保存改动」 |
| `POST /branches/{bid}/proposals` | 由 head 生成 Proposal | 「提交给负责人确认」 |
| `GET /workitems/{id}/proposals` | 列提议 | 「待确认的东西」 |
| `GET /workitems/{id}/conflicts` | 列当前冲突卡和可点击方案 | 「撞车了，选保留正式版还是采纳这次版本」 |
| `POST /proposals/{pid}/review` | 写 ProposalReview（approve/reject/spotcheck_pass，reject 必带 reason） | 「确认 / 打回(说原因)」 |
| `POST /proposals/{pid}/merge` | 触发合并（探测冲突→clean/conflict；可带 `conflict_resolution.accept_incoming_target_keys`） | 「采纳 / 汇入正式版」 |
| `GET /proposals/{pid}/merge-attempts/{mid}/conflicts` | 取 ConflictItem[] + MergeProposal | 「撞车详情 + AI 方案」 |
| `POST /merge-proposals/{mpid}/choose` | 写 chosen_option_key → 回到 merging | 「选这个方案」 |
| `POST /merge-proposals/{mpid}/apply` | 对 `ai_fusion` 物化融合稿；text/spec 写 accepted ledger / Drive version / audit，ready + executable `structured_record` 写 WorkItem 标量字段、`acceptance_items`、最新 dispatch plan `task_items` 和 `field_merge` audit；未选择时把本次点击写为 `chosen_*`，已选其它候选时拒绝 | 「采用 AI 融合稿」 |
| `POST /proposals/{pid}/withdraw` | 撤回 | 「撤回提交」 |

所有响应实体带 `user_label`;错误用人话 `detail`(去黑话)。

### 9.2 SSE/WS 事件(复用 `push_bus`,topic `req:<work_item_id>`)

延续 `app/services/push_bus.py` 的 `bus.publish(topic, type, data)` 与 `app/services/auto_agent.py` 的事件命名风格(`ai.started/ai.tool_call/ai.text/ai.done`):

| 事件 type | data(关键字段) | 触发 |
|---|---|---|
| `branch.opened` | `branch_id, owner_kind, user_label` | 开分支 |
| `branch.change` | `branch_id, seq, target_kind, reason` | AI/人产生改动（AI 时与 `ai.tool_call` 同源) |
| `proposal.opened` | `proposal_id, round, origin, summary_md, confidence_label` | 生成提议 |
| `proposal.reviewed` | `proposal_id, decision, reason_md?` | 审批决策 |
| `merge.conflict` | `proposal_id, merge_attempt_id, conflicts:[{key,user_hint}]` | 探测到冲突 |
| `merge.proposal.ready` | `merge_proposal_id, conflict_key, recommended_option_key` | AI 调解方案就绪 |
| `merge.resolved` | `proposal_id, merge_strategy` | 人择一完成一处冲突 |
| `proposal.merged` | `proposal_id, merged_snapshot_id` | 合并入 main |

> `confidence_label` 是**人话**(如「我比较有把握」),不暴露数值阈值(FR-ESC-001)。事件按身份隔离(NFR-08);心跳沿用 `push_bus.stream` 的 30s heartbeat。

---

## 10. 给 plan 的落地要点(可复用零件映射)

| 新机制 | 复用 / 演进自 | 路径 |
|---|---|---|
| Proposal/round/打回 | `Delivery.round` + `RevisionRequest` + deliveries.accept/request-revision | `app/models.py:515/535`、`app/routers/deliveries.py` |
| 去黑话通知 | `_MILESTONES` 模板 + 安全替换 | `app/services/lifecycle.py:31/127` |
| AI 分支作者 + submit→提议 | auto_agent 工具集/沙箱/预算/`submit`/`llm_review` | `app/services/auto_agent.py:51/143/510/544` |
| DOC 文件版本/指针/冲突 | Drive version_no + current_version_id + conflict replace/cancel + previous_version_id | `app/models.py:167/176/192/204`、`app/routers/project_drive.py:859/965/1525` |
| 快照 sha256 去重 | spec_watch / Delivery / DriveVersion 的 sha256 | `client-tauri/.../spec_watch.rs:743`、`app/models.py:204/525` |
| 事件流 | push_bus per-topic + heartbeat | `app/services/push_bus.py` |
| 并发/行级锁 | 迁移到 PostgreSQL(决策 D-2) | 见 [`tech-stack-and-migration.md`](../01-architecture/tech-stack-and-migration.md) |

> **核心新建项**:`Branch` / `BranchChange` / `Proposal`(演进 Delivery) / `ProposalReview`(演进 RevisionRequest) / `MergeAttempt` / `MergeProposal` / 统一 `Snapshot`;以及字段级三方合并器与按 `target_kind` 路由的合并语义引擎(§5–§6 是 P3 的深设计专题)。
