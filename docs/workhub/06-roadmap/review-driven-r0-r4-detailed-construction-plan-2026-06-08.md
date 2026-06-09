---
module: 06-roadmap
layer: review-driven construction plan
status: active
owner: workflow
date: 2026-06-08
source_review:
  - D:/workhub审查报告/00-WorkHub-项目审查总报告-2026-06-08.md
  - D:/workhub审查报告/01-后续施工计划与路线修正.md
  - D:/workhub审查报告/02-概念图与现状对照核对.md
  - D:/workhub审查报告/施工计划/
visuals:
  - ../05-clients/assets/shared/r0-governance-boundary-concept.svg
  - ../05-clients/assets/shared/r0-r4-recovery-roadmap.svg
  - ../05-clients/assets/shared/ts-first-runtime-concept.png
  - ../05-clients/assets/shared/endpoint-page-cuu-alignment.png
  - ../05-clients/assets/shared/prd-concept-gap-map.png
  - ../05-clients/assets/shared/shared-component-atlas.png
---

# Claude 审查后详细施工计划

> 本篇把 `D:/workhub审查报告` 的结论转成仓库内可执行计划，并按当前 `main` 已落代码校准。它是 [`recovery-r0-r4-roadmap-2026-06-08.md`](./recovery-r0-r4-roadmap-2026-06-08.md) 的细化版。

![R0 governance boundary](../05-clients/assets/shared/r0-governance-boundary-concept.svg)

## 0. 审查结论转译

Claude 审查指出的问题不是“代码质量差”，而是“范围优先级与真实验收定义偏了”。本仓当前应执行的纠偏如下：

| 审查问题 | 当前校准 | 施工结论 |
|---|---|---|
| Cuu 外观投入过多，且 P1 的 `FR-PET-002` 未做 | Cuu 黑/白 Live2D runtime 已存在，外观不再是主线 | R1 通过前冻结 Cuu 外观；R3 只恢复 Cuu 出站 Agent 入口 |
| Gold Path fixture 冒充完成 | `AgentLoopResult.manifest -> ProposalService.createFromManifest` 与 route auto-pump 已部分落代码，但 AgentRun 仍在内存 | R1 下一刀必须做 DB-backed AgentRun/AgentStep 与真实 replay |
| 业务状态仍有内存协调 | Proposal 默认已 DB-backed；AgentRun/trace/workdir 已 write-through DB，但 claim/drainer 仍靠进程内 Map/Set | R1 补真实 PG 重启验收；R2 再做 SKIP LOCKED 多 worker |
| 文档写 Python 迁移，现实是 TS-first 重写 | README、phasing、F 系列已有部分修正，但仍需避免旧 plan 被当目标路径 | 本篇和 TS-first 审计为后续施工权威；旧 Python 行号只作行为锚点 |
| 概念图/截图仍有橘猫与主窗 Cuu | `assets/cuu/` 已换黑/白；4 张 shared PNG 已原位替换；旧 current-state 截图仍标记 stale/fail | 以 R0 概念治理图、4 张新 shared 图和 Cuu 专图作为当前边界；旧截图只可作历史证据 |
| `mid`/`medium` 漂移 | `confidence-risk-escalation.md` 已规定 `medium` | 本轮清理 FR/phasing 的 `mid` 表述 |

## 1. 不变铁律

| 铁律 | 执行方式 |
|---|---|
| R1 前不做 Cuu 外观 | 不新增模型、动效、设置矩阵、录屏矩阵、改色、素材生成。只允许修主窗边界、透明窗、旧证据标注等 R0 治理项。 |
| fixture 不算完成 | `p05*` 只可作为 demo/test fixture；生产 route、R1 验收和文档“已完成”不得依赖硬编码 manifest/replay。 |
| 真实纵切先于多端 polish | 先跑通 `WorkItem -> AgentRun -> Manifest -> Proposal -> Review/Merge -> Replay`，再做 Web 产品化或 Cuu 指令入口。 |
| TS-first 是目标路径 | 代码落 `apps/*`、`packages/*`、`client-tauri/*`；旧 Python/FastAPI 只解释旧行为，不作为新仓施工路径。 |
| 每个模块完工必须有证据 | 至少包含 typecheck/test、数据流审查、PRD/概念图对账、必要截图或 DOM/report。 |

## 2. 当前权威概念边界

当前有效概念图分三类：

| 类别 | 当前权威图 | 用途 |
|---|---|---|
| 纠偏路线 | `assets/shared/r0-r4-recovery-roadmap.svg` | 施工顺序：R0 -> R1 -> R2 -> R3 -> R4 |
| 主窗 / Cuu 边界 | `assets/shared/r0-governance-boundary-concept.svg` | 主窗严肃无 Cuu；Cuu 只在透明独立 pet window |
| 横切 shared 图 | `assets/shared/ts-first-runtime-concept.png`、`endpoint-page-cuu-alignment.png`、`prd-concept-gap-map.png`、`shared-component-atlas.png` | 已按 R0 口径原位替换：黑/白 Cuu、独立 pet window、无主窗 Cuu |
| Cuu 形象 | `assets/cuu/cuu-character-animation-states.png`、`cuu-desktop-approval-search.png`、`cuu-option-first-clarify.png` | 黑猫 Hijiki 默认、白猫 Tororo 可选；只作已有模型基准 |

外部审查报告附件中的旧 shared 图不再作为当前证据；仓内同名 PNG 已替换。旧 `2026-06-07-current-state` 截图若出现橘猫或主窗 Cuu，仍判定为失败样例。

## 3. R0 止血与对账

目标：停止范围倒挂，让计划、文档、概念图、截图证据回到同一口径。

### R0-1 范围冻结

| 任务 | 落点 | 验收 |
|---|---|---|
| README 写明当前施工顺序和冻结规则 | `docs/workhub/README.md` | 明确 R1 前冻结 Cuu 外观 |
| Cuu 文档写 `frozen-until-R1-except-governance` | `cuu-desktop-pet-concept.md` | 外观工作不可作为下一步任务 |
| 已完成动效证据降级为冻结前 evidence | `current-state-visual-audit-*` | 文档不再把 Cuu QA 当当前主线 |

当前状态：已基本完成。本轮继续补“详细计划”和“概念边界图”。

### R0-2 概念治理

| 任务 | 落点 | 验收 |
|---|---|---|
| 主窗边界图 | `r0-governance-boundary-concept.svg` | 图中明确主窗无 Cuu，pet window 独立 |
| 概念索引更新 | `page-concepts.md` | R0 治理图与 4 张新 shared PNG 进入第 2 节；旧橘猫截图只保留失败样例说明 |
| 差距审计更新 | `prd-concept-reproduction-gap-audit.md` | shared 旧图/旧截图不再被视为通过 |
| 后续截图计划 | `current-state-visual-audit-*` | Web/desktop 主窗无 Cuu 截图列为 R0 evidence |

### R0-3 命门拍板

`confidence-risk-escalation.md` 已锁定 `policy_version=confidence-risk-v0.1-r0-2026-06-08`、owner、权重、阈值和 `medium` 枚举。本阶段只允许“按真实数据改版本”，不得无版本热改。

### R0-4 文档去 drift

| 漂移 | 修正 |
|---|---|
| `mid` | 生产 contract 和文档权威写 `medium`；旧 `mid` 只可作兼容读别名 |
| Python 目标路径 | F01-F11 旧路径均为行为锚点；实际施工看 `Target TS paths` 和本篇 R1/R2 |
| P0 完成幻觉 | P0/R1 完成必须要求真实 PG、真实 route、真实 replay，不以 fixture 通过 |

R0 退出门：

- README、roadmap、Cuu 文档、page-concepts 都指向本篇和新治理图。
- `functional-requirements.md` 与 `phasing-p0-p5.md` 不再用 `mid` 作为权威枚举。
- 旧橘猫截图只在“失败样例 / stale”上下文出现；当前 shared PNG 不再含橘猫。

## 4. R1 真实纵切

目标：一条真实需求端到端跑通，并且重启后可查。

### R1 当前已完成切片

| 切片 | 当前状态 | 剩余限制 |
|---|---|---|
| Queue auto-pump | `POST /workitems/:id/agent-runs` 默认后台执行 `queue.run(run_id)` | 仍是进程内 queue，不是多 worker drainer |
| Manifest 接 Proposal | 成功 `AgentLoopResult.manifest` 会调用 `ProposalService.createFromManifest` 并发 `proposal.opened` | 仍需真实 DB route 端到端验证 |
| Proposal DB-backed | 默认 `ProposalService` 已写 `branches/proposals/reviews`；merge 已写 `work_items/main_branch_id`、merge snapshot、persistent audit、accepted deliverable ledger，并对 AgentRun-backed delivery 写入最小 `ProjectDriveItem/Version` 正式文件版本；R1.8-R1.41 已连续补齐正式交付物还原、冲突卡、merge attempts/proposals、replay timeline、AI fusion、text/spec 正文直写、真实三方文本上下文、patch preview、无重叠 diff3、重叠 hunk metadata、字段/子记录写回、字段级审计、富 patch viewer、重叠 hunk review、子记录逐项编辑、多冲突折叠区、真实 route 视觉 QA、任务子记录目标 plan 选择、`text_hunk_overrides` 后端逐段 materialize 与 text hunk merge audit | 仍未接完整 Drive 富预览/历史/redo UI、Replay hunk decision audit、React route 级逐行选择/编辑产品化和多冲突批量执行/审计产品化 |
| P-COST DB-backed | `CostLedgerStore` 与 `BudgetPolicyStore` 已默认 DB-backed；`budget_policies` 保存 policy override；`PUT /api/cost/policies/:scope/:id` 写 `budget_policy.updated` 审计；R1.18 已把真实 PG policy override 纳入 smoke | 仍未发出 `usage.recorded`、`budget.warning`、`budget.exhausted` 事件；Cuu budget bubble 仍属后续 |

### R1 必做顺序

1. **补 AgentRun schema 与 migration**
   - **状态：2026-06-08 已完成代码切片。**
   - `agent_runs`:补 `title`、`actor_user_id`、`total_timeout_s`、`max_tokens`、`max_cost_cny`、`budget_decision_json`、`workdir_ref`、`handoff_json`。
   - `agent_steps`:补 `seq` 或等价排序字段；取消 `run_id + step_no` 唯一误设，因为同一 step 会有 `tool_call/tool_result/think/final` 多条 trace record。
   - 落点：`packages/db/src/schema/core.ts`、`packages/db/migrations/0002_rich_maggott.sql`、`packages/db/src/schema.test.ts`。
   - 迁移已由 Drizzle Kit 生成，可从空 PG 重建；后续不得手写 TS schema 而不生成 migration/meta。

2. **新增 DB-backed AgentRunStore**
   - **状态：2026-06-08 已完成 write-through + DB fallback 代码切片；R2 前仍不是多 worker claim store。**
   - 目标路径：`packages/db/src/repositories/agent-runs.ts`、`apps/api/src/services/agent-run-persistence.ts`。
   - 方法：`createRun`、`updateRun`、`replaceTrace`、`setWorkdir`、`findById`、`listActive`。
   - 默认 queue 已注入 persistence：enqueue 创建 DB run，running/final/cancel 状态写 DB，trace replace 写 DB，内存 miss 时 `get/trace/workdir/listActive` 从 DB 读回。
   - queue 当前仍保留执行协调 Map/Set；R2 再把 claim/drainer 完全 PG 化。

3. **让 Replay 读真实 DB**
   - **状态：部分完成。** `GET /api/agent-runs/:id/replay` 仍通过 queue facade 读取，但 queue facade 已有 DB fallback，可在内存 miss 时还原 `agent_runs + agent_steps`。
   - **2026-06-08 追加切片**：AgentRun replay 的 P0.5 fixture fallback 已完全移出生产 route；`/agent-runs/:id/replay` 只读真实 run/trace/snapshot/audit。
   - **2026-06-08 追加验收**：Linux 测试机真实 PG smoke 已通过，daemon restart 后 `/agent-runs/:id` 与 `/replay` 可读回。
   - **2026-06-09 追加切片**：merge 会创建真实 `snapshots(kind=merge)`、`audit_logs(action=proposal.merged)` 与 `accepted_deliverable_changes`，R1 smoke 会校验这些 DB 行。
   - **2026-06-09 追加切片**：ReplayTraceVM 已返回 `accepted_deliverables[]`，`/api/agent-runs/:id/replay` 可在 restart 后展示正式交付物、下载与文本预览入口。
   - **2026-06-09 R1.13 追加切片**：ReplayTraceVM 已返回 `merge_timeline[]`，由 `merge_attempts + merge_proposals` 组装，展示当时的冲突目标、候选方案、推荐项与最终选择。
   - **2026-06-09 R1.17 追加验收**：`qa:r1-pg-smoke` 已覆盖 one-click `ai_fusion`：生成 conflict、返回 `merge_proposal_id`、直接 `POST /api/merge-proposals/{id}/apply`、断言原 row `chosen_*`、accepted ledger、ProjectDriveVersion、audit 与 replay timeline；GitHub Actions 新增 `r1-pg-smoke` job 用 Postgres service 执行。
   - **2026-06-09 R1.18 追加验收**：`qa:r1-pg-smoke` 已覆盖 `budget_policies` override、`budget_policy.updated` audit、`/api/cost/usage` 与 `/api/pages/cost` 读取 DB policy。
   - 后续已补：R1.8 已接 Drive 指针恢复入口，可把正式交付物还原到上一版并审计。
   - 当前进程 Map 只作执行期缓存，不作长期回放真相源。

4. **隔离 fixture**
   - **状态：2026-06-08 已完成代码切片。**
   - `isP05*` 已从生产业务 route 删除；`apps/api/src/routes/*` grep 不再出现 P0.5 id matcher。
   - `sessions/workitems/knowledge/pages/workitems` 已接入 R1 最小真实 service：option-first intake、work item 创建、knowledge evidence bubble、work item page VM 与 evidence binding 走 DB/内存可注入服务，不再使用 P0.5 fixture。
   - `pages/proposals` 与 `proposals/*` 只读真实 `ProposalService`，不再返回 P0.5 proposal/review/merge fixture。
   - 仅 `/api/pages/gold-path` 保留 P0.5 demo bundle，用于概念/页面 VM 展示，不再作为 R1 完成证据。

5. **补审批人与 merge 真实语义**
   - **状态：2026-06-08 已完成最小真实切片。**
   - `packages/db/src/repositories/proposals.ts` 在同一事务内处理 `review/merge`：打回写 `Proposal.status=rejected` 并把 branch 解回 `open`；采纳写 `Proposal.status=merged`、`merge_snapshot_id`、`Branch.status=merged/head_ref/version+1`、`WorkItem.status=merged/main_branch_id/accepted_at/version+1`。
   - **2026-06-09 追加完成**：新增 `accepted_deliverable_changes` append-only 账本。merge 时按 manifest `target_ref` 生成 `target_key`，把每个被采纳的 change 写为正式版本记录，并 supersede 同一 `work_item_id + target_key` 的旧 current 记录。
   - **2026-06-09 追加完成**：merge 在同一 PG transaction 内创建 `snapshots(kind=merge)` 与 `audit_logs(action=proposal.merged)`；audit detail 记录 `accepted_change_ids`、`accepted_change_count`、`target_keys`、`conflict_checked=true`。
   - **2026-06-09 追加完成**：merge 前读取同一 target 的 current accepted row。若 incoming manifest 没有对齐 `sha256_before/version_before`，或 `created/generated` 同路径 sha 与正式版不同，返回 `merge_conflict`，用户面文案为「这份变更和正式版撞车，需要先选择处理方案。」
   - **2026-06-09 追加完成**：AgentRun-backed delivery 会在 merge 前通过 `Branch.agent_run_id -> AgentRun.workdir_ref` 找到源文件，从 run workdir 复制到正式 storage root，并在 merge transaction 内写 `ProjectDriveItem` / `ProjectDriveVersion`、前移 `current_version_id`，再把 `drive_item_id` / `drive_version_id` 写入 `accepted_deliverable_changes`。
   - `apps/api/src/services/proposals.ts` 禁止未确认 proposal 直接采纳，未 `reviewed` 会返回 `proposal_not_reviewed`。
   - `apps/api/src/workers/agent-runner.ts` 不再硬编码 `approverUserId=run.actor_id`；新增 `notificationWorkItem` resolver，默认通过 DB WorkItem context 读取 submitter/project owner/assignee，再交给 lifecycle approver fallback。
   - `packages/contracts/src/enums.ts` 已补齐 `branch.status=proposed/superseded`，与文档和现有 repository 写入值对齐。
- 剩余：完整 permission policy routing、审批中心持久 `ApprovalRequest`、Replay hunk decision audit、React route 级逐行选择/编辑产品化与多冲突批量执行/审计产品化；R1.9-R1.41 已接 deterministic 两选一 API、端侧按钮、尝试/候选/选择审计、replay 展示、LLM 融合候选、候选选择、AI 融合稿物化、Web/Desktop/Cuu 一键采用、text/spec 正文直写、真实内容三方读取、数据层 patch preview、Replay 可见 patch preview、Proposal 采用前最小 patch preview、无重叠文本 hunk deterministic diff3、重叠 hunk metadata/prompt/quality gate、`text_diff3` 可见化、`structured_record_patch` 可见化、dry-run gate、WorkItem 标量字段写回、字段冲突检测、`acceptance_items/task_items` 子记录写回、字段级落点和写回审计、折叠高级字段编辑器、共享富 patch viewer、重叠 hunk review、子记录逐项 diff/editor、折叠多冲突批量检查 foundation、任务子记录目标 plan 选择和 `text_hunk_overrides` 后端逐段 materialize。

### R1 验收

- 一条 file-only work item 经真实 route 跑完，产生 DB `agent_run`、`agent_steps`、`proposal`、`review`、`audit`、`snapshot`。
- merge 后至少产生 1 条 `accepted_deliverable_changes`、1 条 `ProjectDriveVersion`、1 条 `snapshots(kind=merge)`、1 条 `audit_logs(action=proposal.merged)`；accepted row 必须指向 `drive_version_id`；同路径不同 sha 的二次采纳必须 409。
- daemon 重启后，`GET /api/agent-runs/:id` 与 `/replay` 仍返回同一 run。
- 生产 route 中不能用 hardcoded manifest/replay 证明通过。
- 快照红线、provider 单出口、预算计量不回退。

### R1.1 本次落地验收（2026-06-08）

- 已通过：`pnpm --filter @workhub/db typecheck`。
- 已通过：`pnpm --filter @workhub/api typecheck`。
- 已通过：`pnpm --filter @workhub/db test`，覆盖新增 AgentRun 恢复字段与 `agent_steps.seq`。
- 已通过：`pnpm --filter @workhub/api test -- --test-name-pattern "writes through to persistence"`；该命令当时由 package script 跑完整 `src/*.test.ts`，结果 61/61 通过。
- 测试覆盖：fake persistence 冷启动读回 queued run、执行后读回 succeeded run、trace、workdir、active 列表。
- 后续已补：真实 PostgreSQL daemon restart 验收、P0.5 route set 整体迁出生产业务 route。
- 后续已补：R1 最小真实 `sessions/workitems/knowledge/page workitem` service 已接入，并纳入 API test 与 PG smoke。
- 后续已补：CostLedger 默认 store 已接 `usage_records/cost_ledger_entries` 与 DB-backed repository，并纳入 PG smoke 的 cost usage/page 断言。
- 后续已补：merge accepted deliverable ledger、merge snapshot、persistent proposal merge audit、同路径不同 sha 冲突 gate；API test 覆盖冲突阻断。
- 后续已补：AgentRun-backed delivery 的正式文件落盘与 `ProjectDriveItem/Version` 最小采纳；Linux PG smoke 覆盖 `adopted_drive_items=1`、`adopted_drive_versions=1`、正式 storage path 文件存在且内容匹配。
- 后续已补：正式交付物读取面最小切片；WorkItem page 与 AgentRun replay 返回 `accepted_deliverables`，并提供下载与文本预览 API。
- 后续已补：正式交付物最小还原入口；同一路径第二版采纳后可 `POST .../restore` 回到上一版 Drive version，并写 `ProjectDriveOperation` 与审计。
- 未完成：完整 approval policy routing、Replay hunk decision audit、React route 级逐行选择/编辑产品化、多冲突批量执行/审计产品化仍未完成。R1.9 已关闭“冲突只能裸 409、用户无法点选处理”的最小缺口，R1.11/R1.12 已关闭“冲突选择没有持久尝试和候选审计”的缺口，R1.13 已关闭“replay 看不到当时候选和选择”的缺口，R1.18 已关闭“BudgetPolicy 只在内存 override、无审计”的缺口，R1.19-R1.41 已关闭 text/spec 正文直写、真实三方文本上下文、数据层 patch preview、Replay 可见 patch preview、Proposal 采用前最小 patch preview、无重叠文本 diff3、重叠 hunk metadata、text_diff3 可见化、structured_record_patch 元数据可见化、StructuredFieldPatchDryRun 契约、WorkItem 标量字段写回、字段冲突检测、`acceptance_items/task_items` 子记录写回、字段级落点/写回审计渲染、标量字段高级覆盖、共享逐行富 patch viewer 基础、重叠 hunk review 基础、子记录逐项 diff/editor、折叠多冲突批量检查、任务子记录目标 plan 选择和 text hunk 后端逐段写回缺口。

### R1.2 真实 PG smoke 入口（2026-06-08）

新增可重复验收命令：

```powershell
pnpm qa:r1-pg-smoke
```

该脚本位于 `apps/api/src/qa/r1-pg-agent-run-smoke.ts`，执行顺序：

1. 读取 `DATABASE_URL`，拒绝 `APP_ENV=production`。
2. 执行 Drizzle migrations。
3. 写入最小 seed：org、workspace、owner user、project、knowledge document。
4. 通过真实 `POST /api/sessions` 创建 option-first session/work item。
5. 通过真实 `POST /api/sessions/:id/next-question` 记录澄清选择。
6. 通过真实 `POST /api/workitems` 将 session 固化为 `spec_ready` work item。
7. 通过真实 `POST /api/knowledge/search` 返回 EvidenceBubble，再用 `POST /api/workitems/:id/evidence-bindings` 绑定证据。
8. 通过真实 `GET /api/pages/workitems/:id` 读取 WorkItemDetailVM。
9. 通过真实 `createAgentRunRoutes` 发起 `/api/workitems/:id/agent-runs`。
10. 使用 fake Agent client 写入 `outputs/result.md`，但走真实 `AgentRunQueue`、tool、snapshot、audit、proposal service、AgentRun persistence。
11. 新建一个 queue 模拟 daemon restart，再通过 route 读取 `/api/agent-runs/:id` 与 `/api/agent-runs/:id/replay`。
12. Approve + merge 真实 DB proposal，断言 `proposal.status=merged`、`branch.status=merged`、`work_items.status=merged/main_branch_id`。
13. 断言 merge 产生 `accepted_deliverable_changes`、`ProjectDriveItem/Version`、`snapshots(kind=merge)`、`audit_logs(action=proposal.merged)`，且 proposal merge audit 绑定 `merge_snapshot_id`。
14. 断言 accepted row 指向 `drive_version_id`，Drive item 的 `current_version_id` 指向该版本，正式 storage path 文件存在且内容匹配 AgentRun output。
15. 断言 `GET /api/pages/workitems/:id` 与 `/api/agent-runs/:id/replay` 返回 `accepted_deliverables[]`，且 download/text-preview href 可读取同一正式文件内容。
16. 执行第二次同路径采纳，断言 accepted version 前进到新 `ProjectDriveVersion`。
17. 调用 `POST /api/workitems/:id/deliverables/:acceptedChangeId/restore`，断言返回上一版 `drive_version_id`、预览/下载内容回到第一版、`ProjectDriveOperation(op_type=restore_version)` 与 `AuditLog(action=accepted_deliverable.reverted)` 均存在。
18. 输出 JSON 证据：intake/evidence/page evidence、`usage_records`、`cost_ledger_entries`、cost page delta、`agent_runs`、`agent_steps`、`proposals`、`branches`、`accepted_deliverable_changes`、`adopted_drive_items`、`adopted_drive_versions`、`project_drive_operations`、`snapshots`、`audit_logs` 行数、merge/restore 状态、accepted targets/drive versions、download/preview 状态、replay accepted deliverables 与 replay 计数。

当前本机实测：

- `pnpm qa:r1-pg-smoke` 可加载脚本，但因 `127.0.0.1:5432` 无 PostgreSQL 返回 `ECONNREFUSED`。
- 本机 `docker` 与 `psql` 不在 PATH，无法在 Windows 本机直接拉起或检查 PG。
- 2026-06-09 起 GitHub Actions 新增 `r1-pg-smoke` job，使用 Postgres 16 service 执行同一命令，避免真实 PG 验收依赖 Windows 本机或人工 SSH 密码。

Linux 测试机最新通过证据（`192.168.5.53`，当前工作树 patch；数据库历史 usage 已存在，所以 cost 以 delta 验收）：

```json
{
  "ok": true,
  "work_item_id": "89befbf0-72f2-4070-a106-7216b3bafbe1",
  "run_id": "bfb729ca-d503-490b-abbf-749c007073e7",
  "intake": {
    "session_status": 200,
    "work_item_status": "spec_ready",
    "evidence_refs": 1,
    "page_evidence_refs": 1
  },
  "run_status": "succeeded",
  "db_rows": {
    "agent_runs": 1,
    "agent_steps": 4,
    "proposals": 1,
    "branches": 1,
    "accepted_deliverable_changes": 1,
    "adopted_drive_items": 1,
    "adopted_drive_versions": 1,
    "snapshots": 2,
    "audit_logs": 1,
    "proposal_merge_audit_logs": 1,
    "usage_records": 1,
    "cost_ledger_entries": 3
  },
  "cost": {
    "usage_me_token_delta": 1500,
    "usage_team_token_delta": 1500,
    "page_cost_cny_delta": "0.007",
    "page_token_delta": 1500
  },
  "merge": {
    "proposal_status": "merged",
    "branch_status": "merged",
    "work_item_status": "merged",
    "main_branch_id": "dd26e7bb-6c7e-4869-b0f5-c6092b2ae545",
    "merge_snapshot_id": "7a4286da-5371-4c15-8853-0c7dcd0ac9c5",
    "accepted_targets": ["delivery:/outputs/result.md"],
    "accepted_drive_version_ids": ["d4e0f2c3-b440-491c-98ce-92556c67dda6"]
  },
  "replay_steps": 4,
  "replay_snapshots": 1,
  "replay_audit_logs": 1
}
```

结论：R1 的“真实 PostgreSQL restart 后 run/replay 可读回”、“AgentRun-backed delivery 采纳后正式文件落盘”和“正式交付物上一版还原”缺口已关闭；最小 intake -> work item -> knowledge evidence -> page VM -> DB CostLedger -> AgentRun -> proposal -> accepted deliverable ledger -> ProjectDriveVersion -> merge audit -> restore -> replay 纵切已由 Linux PG smoke 验证通过。

### R1.4 Merge accepted ledger 与冲突 gate（2026-06-09）

本切片的范围是 **file-only proposal 的最小正式采纳语义**，不是完整网盘/对象存储实现。

已落代码：

- `packages/db/src/schema/core.ts` 新增 `accepted_deliverable_changes`。
- `packages/db/migrations/0004_little_molly_hayes.sql` 新增表、外键与索引。
- `packages/db/src/repositories/proposals.ts` 在 merge transaction 内：
  - 读取 `DeliverableChangeManifest.changes[]`。
  - 按 `target_ref.entity_type + entity_id/path/change_id` 生成稳定 `target_key`。
  - 对同一 `work_item_id + target_key` 的 current accepted row 做冲突检查。
  - clean 时 supersede 旧 current row，并写入新的 accepted row。
  - 写 `snapshots(kind=merge)` 和 `audit_logs(action=proposal.merged)`。
- `apps/api/src/services/proposals.ts` 把 repository conflict 转为稳定 `ProposalServiceError(code=merge_conflict,status=409)`。
- `apps/api/src/proposals.test.ts` 覆盖同路径不同 sha 的二次 merge 必须被阻断。
- `apps/api/src/qa/r1-pg-agent-run-smoke.ts` 把 accepted rows 与 persistent proposal merge audit 纳入真实 PG 验收。

当前冲突规则：

| 场景 | R1 行为 |
|---|---|
| 首次采纳某 target | 直接写 accepted ledger |
| incoming 带 `sha256_before` | 必须等于 current `sha256_after`，否则 409 |
| incoming 带 `version_before` | 必须等于 current `accepted_ref`，否则 409 |
| `created/generated` 且同 target 已存在 | sha 相同视为幂等，不同则 409 |
| `updated/replaced/deleted` 但未带 before ref | 保守 409，避免静默覆盖正式版 |

已由 R1.5 补齐：

- AgentRun-backed delivery 的真实 `ProjectDriveItem.current_version_id` / `ProjectDriveVersion` 指针前移。
- 文件 blob 从 run workdir 到正式 storage root 的本地对象存储搬运。

仍未完成：

- 非本地 storage adapter（S3/R2/MinIO）与孤儿文件 GC。
- 已由 R1.14/R1.15/R1.16/R1.17/R1.19/R1.20/R1.21/R1.22/R1.23/R1.24/R1.25/R1.26/R1.27/R1.28/R1.29/R1.30/R1.31/R1.32 部分补齐：LLM `ai_fusion` 候选生成、质量门、持久化、选择审计、Markdown 融合稿正式采纳、冲突卡一键采用、text/spec 正文直写、真实 current/incoming/base 文本上下文、数据层 `text_patch_preview`、Replay 可见 patch preview、Proposal 采用前最小 patch preview、无重叠文本 hunk deterministic diff3、重叠 hunk metadata、text_diff3 可见化、structured_record_patch 元数据、StructuredFieldPatchDryRun、WorkItem 标量字段写回、字段冲突检测、`acceptance_items` 子记录写回、最新 dispatch plan `task_items` 子记录写回与真实 PG one-click smoke 已接入；仍缺重叠 hunk 逐项确认/编辑、React route 级逐行选择/编辑产品化、任务子记录多计划/逐项 UI 和多冲突工作台。
- `/api/workitems/{id}/conflicts` API 已由 R1.9 落最小 deterministic 两选一版本，Web/Desktop/Cuu option-first UI 已由 R1.10 接入，`merge_attempts` 与 chosen incoming target 审计已由 R1.11 接入，`merge_proposals` deterministic candidates 与 chosen option 已由 R1.12 接入。
- 完整 Drive 历史/redo UI：R1.8 已有最小 accepted deliverable restore，但还没有多文件 rollback、redo、富预览时间线与用户可选择的版本浏览器。

### R1.5 ProjectDrive adoption 与正式文件落盘（2026-06-09）

本切片把 R1 的 file-only Proposal 从“只记账”推进到“可定位正式文件版本”。范围仍限 AgentRun-backed delivery：即 manifest change 的 `target_ref.entity_type="delivery"`、有 `target_ref.path`、来源 branch 带 `agent_run_id` 且 `AgentRun.workdir_ref` 可读。

已落代码：

- `apps/api/src/workers/agent-runner.ts`：成功 run 自动打开 proposal 时传入 `agentRunId`，写入 `branches.agent_run_id`。
- `apps/api/src/services/proposals.ts`：merge 前读取 `repository.findMergeContext()`，解析 `workdir_ref + target_ref.path`，校验路径不越界、源文件存在、sha256 与 manifest 一致，再复制到正式 storage root。
- `packages/db/src/repositories/proposals.ts`：merge transaction 内按 `AI Deliverables/{workItemCode}/outputs/...` 创建/复用 `ProjectDriveItem` 文件夹树和 file item，追加 `ProjectDriveVersion`，前移 `project_drive_items.current_version_id`。
- `packages/db/src/schema/core.ts` 与 `0005_flashy_shockwave.sql`：`accepted_deliverable_changes` 新增 `drive_item_id`、`drive_version_id` 外键与索引。
- `apps/api/src/qa/r1-pg-agent-run-smoke.ts`：真实 PG smoke 断言 Drive item/version、accepted row 指针、正式 storage path 文件存在且内容匹配。

当前契约：

| 项 | R1.5 行为 |
|---|---|
| 正式 Drive 路径 | `AI Deliverables/{workItemCode}/outputs/...` |
| 本地正式 storage | 默认 `DATA_DIR/project-drive/...`；测试可注入 `storageRoot` |
| sha 校验 | manifest `sha256_after` 必须等于源文件实际 sha，否则 409 `delivery_artifact_changed` |
| 源路径安全 | 源文件必须位于 `workdir_ref` 内，否则 409 `delivery_artifact_unsafe_path` |
| 缺源文件 | 409 `delivery_artifact_missing` |
| DB 指针 | accepted row 保存 `drive_item_id`、`drive_version_id`，audit detail 保存 adopted drive version ids |

R1.6 已补最小下载/文本预览读取面，R1.7 已把正式交付物接入 AgentRun replay，R1.8 已补最小 restore 执行入口，R1.9 已补最小冲突卡片 API 与显式采纳 incoming，R1.10 已补 Web/Desktop/Cuu option-first 冲突卡，R1.11/R1.12 已补 `merge_attempts` / `merge_proposals` 与选择审计，R1.14 已补 LLM `ai_fusion` 候选入口，R1.15 已补候选选择 API，R1.16 已补 AI 融合稿物化采纳，R1.19 已让 `text_doc/spec_doc` 的合格融合正文直接写回正式 Drive version，避免旧 Markdown/JSON 包装污染文本交付物，R1.20 已让候选生成读取真实 current/incoming/base 文本上下文，R1.21 已把 current -> merged patch preview 落入 candidate `quality_gate`，R1.22 已在 Replay 严肃页渲染该 patch preview，R1.23 已在 Proposal 冲突卡渲染采用前最小 diff，R1.24 已对无重叠文本 hunk 生成 deterministic diff3 candidate，R1.25/R1.26/R1.27/R1.28/R1.29/R1.30/R1.31/R1.32 已补重叠 hunk 元数据可见化、structured_record_patch 可见化、StructuredFieldPatchDryRun gate、WorkItem 标量字段写回、字段冲突检测、`acceptance_items` 子记录写回和最新 dispatch plan `task_items` 子记录写回。仍不是完整 Drive 产品化：当前没有二进制/Office 预览渲染、没有 redo/多文件历史 UI、没有云对象存储 adapter，也没有重叠 hunk 逐项确认/编辑、React route 级逐行选择/编辑产品化、任务子记录多计划/逐项 UI 和多冲突逐项选择历史。

### R1.6 AcceptedDeliverableVM、下载与文本预览（2026-06-09）

本切片把 R1.5 写入的正式 Drive version 暴露给用户可见页面与 API，避免“文件已落盘但页面看不到”。

已落代码：

- `packages/contracts/src/pages.ts`：`WorkItemDetailVM` 新增 `accepted_deliverables[]`，字段包含 `drive_item_id`、`drive_version_id`、`filename`、`mime`、`size_bytes`、`download_href`、`preview_href`；R1.8 追加可选 `restore_href`。
- `packages/db/src/repositories/work-items.ts`：`readWorkItemDetail()` 读取 current `accepted_deliverable_changes`，左连 `ProjectDriveItem/Version`；新增 `findAcceptedDeliverableFile()` 供下载/预览。
- `apps/api/src/services/work-items.ts`：将 accepted rows 映射为 `AcceptedDeliverableVM`；storage path 只在 service 内部使用，不进 page VM。
- `apps/api/src/routes/workitems.ts`：
  - `GET /api/workitems/:id/deliverables/:acceptedChangeId/download` 返回正式文件二进制。
  - `GET /api/workitems/:id/deliverables/:acceptedChangeId/preview` 对 `text/*`、`.md`、`.json`、`.csv`、`.txt` 返回文本预览；其它类型返回 415，提示下载查看。
- `apps/api/src/qa/r1-pg-agent-run-smoke.ts`：merge 后重新读取 WorkItem page，验证 `accepted_deliverables`、download、preview 都能读到 AgentRun output。

当前契约：

| 项 | R1.6 行为 |
|---|---|
| Page VM | `GET /api/pages/workitems/:id` 返回 `accepted_deliverables[]` |
| 下载 | `download_href` 读取正式 storage path 文件，不暴露本地路径 |
| 文本预览 | `preview_href` 只对文本类文件返回 JSON `{preview_type:"text", text, truncated}` |
| 二进制预览 | 暂不在线渲染，走下载 |
| 权限 | 当前复用 WorkItem page 的登录态与存在性校验；完整 `can_view_workitem/project` 仍属后续权限闭环 |

仍未完成：

- 完整 Drive 历史/redo UI 与多文件还原。
- PDF/Office/image 等富预览和 Range/streaming 下载。
- 云对象存储 adapter 与短签名 URL。

### R1.7 Replay accepted deliverables（2026-06-09）

本切片把 R1.6 的正式交付物读取面接入执行回放：用户从 `/agent-runs/:id/replay` 不只看到步骤、快照、审计和成本，也能看到这次执行最终采纳的正式文件。

已落代码：

- `packages/contracts/src/pages.ts`：抽出 `acceptedDeliverableVmSchema`，`WorkItemDetailVM` 与 `ReplayTraceVM` 共用；`ReplayTraceVM.accepted_deliverables[]` 默认空数组。
- `apps/api/src/pages/replay.ts`：`buildReplayTracePage()` 支持 `acceptedDeliverables` 入参，输出同一字段。
- `apps/api/src/routes/agent-runs.ts`：生产默认使用 `WorkItemService.detailPage()` 读取正式交付物；测试注入自定义 queue 且未传 WorkItem service 时保持空数组，避免 fixture 冒充生产数据。
- `apps/api/src/qa/r1-pg-agent-run-smoke.ts`：daemon restart 后 `/api/agent-runs/:id/replay` 断言 `accepted_deliverables[]`、`drive_version_id` 与 download href。
- `packages/ui/src/gold-path/render.ts`：Replay 页面可渲染正式交付物数量、文件名、target、预览/下载/还原按钮；中英双语文案已同步。
- `apps/web/src/main.ts`：新增 `loadWebAgentRunReplay()`，让 Web facade 暴露 replay loader。

当前契约：

| 项 | R1.7 行为 |
|---|---|
| Replay VM | `GET /api/agent-runs/:id/replay` 返回 `accepted_deliverables[]` |
| 来源 | 复用 WorkItem detail 的 current accepted rows，不新建第二套读取语义 |
| 权限 | 先通过 AgentRun owner/admin gate，再复用 WorkItem detail gate |
| UI | Replay 页面显示交付物数量；存在交付物时显示预览/下载动作 |
| 非目标 | 不做 Office/PDF/image 富预览，不引入云对象存储，不做完整 Drive 历史/redo UI |

### R1.8 Accepted deliverable restore（2026-06-09）

本切片关闭“正式交付物无法撤回到上一版”的安全缺口，但只做最小当前指针还原，不冒充完整 Drive 产品。

已落代码：

- `packages/contracts/src/pages.ts`：`AcceptedDeliverableVM` 新增可选 `restore_href`；新增 `AcceptedDeliverableRestoreResult`。
- `packages/db/src/repositories/work-items.ts`：新增 `restoreAcceptedDeliverable()` 事务，校验当前 Drive 指针未变化，查找同 target / 同 drive item 的上一版 accepted row，恢复 `ProjectDriveItem.current_version_id`，切换 current accepted row，并写 `ProjectDriveOperation(op_type="restore_version")` 与 `AuditLog(action="accepted_deliverable.reverted")`。
- `apps/api/src/services/work-items.ts`：`restore_href` 仅在 `accepted_version > 1` 时出现；首版不会给用户无效按钮。
- `apps/api/src/routes/workitems.ts`：新增 `POST /api/workitems/:id/deliverables/:acceptedChangeId/restore`。
- `packages/api-client`：新增 `restoreAcceptedDeliverable(workItemId, acceptedChangeId)`。
- `packages/ui/src/gold-path/render.ts`：Replay 交付物卡支持渲染 `restore_href` 为 POST 动作。
- `apps/api/src/qa/r1-pg-agent-run-smoke.ts`：真实 PG smoke 已升级为“v1 采纳 -> v2 同路径采纳 -> restore 回 v1 -> restart replay 仍读到 v1”。

当前契约：

| 项 | R1.8 行为 |
|---|---|
| 入口 | `POST /api/workitems/:id/deliverables/:acceptedChangeId/restore` |
| 可见按钮 | `AcceptedDeliverableVM.restore_href` 仅 `accepted_version > 1` 暴露 |
| 并发保护 | 当前 Drive item 必须仍指向请求的 `drive_version_id`，否则 409 |
| 还原动作 | 当前 accepted row 置 `superseded_at`；上一版 accepted row 清空 `superseded_at`；Drive item 指回上一版 version |
| 审计 | `project_drive_operations.op_type=restore_version` + `audit_logs.action=accepted_deliverable.reverted` |
| 非目标 | 不做 redo，不做多文件 snapshot rollback，不做 Drive 历史浏览器 |

### R1.9 Conflict cards and explicit incoming resolution（2026-06-09）

本切片关闭“同 target 撞车后只能看到裸 409，用户无法用点击方式处理”的缺口。范围限定为 file-only accepted deliverable ledger 的 deterministic 调解，不冒充完整 AI 融合合并。

已落代码：

- `packages/contracts/src/domain/collaboration.ts`：新增 `ProposalConflict`、`ProposalConflictOption`、`ProposalConflictListResult`；`MergeProposalRequest` 新增 `conflict_resolution.accept_incoming_target_keys[]`。
- `packages/db/src/repositories/proposals.ts`：新增 `listConflictsByWorkItem(workItemId)`；`merge()` 支持 `acceptIncomingTargetKeys`，仅对显式列入的 target 允许覆盖 current accepted row。
- `apps/api/src/services/proposals.ts`：把 repository conflict 映射为人话冲突卡；默认推荐 `keep_current`，另给 `accept_incoming` action，action body 固定带 `conflict_resolution.accept_incoming_target_keys:[target_key]`。
- `apps/api/src/routes/proposals.ts`：`POST /api/proposals/:id/merge` 的 409 `merge_conflict` 返回 `details.conflicts[]` 与 `recoverable:true`；新增 `GET /api/workitems/:id/conflicts`。
- `packages/api-client`：新增 `listWorkItemConflicts(workItemId)` typed client。
- `apps/api/src/openapi.ts`：新增 `/api/workitems/{id}/conflicts` contract seed。

当前契约：

| 项 | R1.9 行为 |
|---|---|
| 默认 merge | 未带 resolution 时仍返回 409 `merge_conflict`，不静默覆盖正式版 |
| 冲突读取 | `GET /api/workitems/:id/conflicts` 仅列 `reviewed` proposal 与 current accepted row 的冲突 |
| 保留正式版 | `keep_current` 是推荐项，只打开变更申请，不写 main |
| 采纳这次版本 | `accept_incoming` 必须回传 target key；repository 只跳过该 key 的 conflict gate，其它冲突仍会阻断 |
| 前端/Cuu | 可直接渲染两个按钮；无需用户打字 |
| 审计 | merge 成功仍走现有 accepted ledger、merge snapshot、proposal.merged audit 与 restore 入口 |

验证：

- `@workhub/contracts` typecheck 与测试通过；新增 contract test 验证 conflict option payload 可被 `mergeProposalRequestSchema` 接受。当前 R1.15 后 contracts 为 16 项测试全绿。
- `@workhub/api-client` typecheck 与 8/8 tests 通过；新增 client 路径断言。
- `@workhub/api` typecheck 与 67/67 tests 通过；新增 service/route test 覆盖“无 resolution 409 -> 读取 conflicts -> 带 target key 二次 merge 成功”。
- `@workhub/db`、`apps/web`、`apps/desktop-webview` typecheck 通过。

仍未完成：

- 已由 R1.14 部分补齐：LLM `ai_fusion` 候选生成、candidate rationale、推荐项和失败降级已接入。
- R1.16/R1.19-R1.41 已补 AI 融合稿物化采纳、text/spec 正文直写、真实 current/incoming/base prompt context、数据层 `text_patch_preview`、Replay 可见 patch preview、Proposal 采用前最小 patch preview、无重叠文本 hunk deterministic diff3、重叠 hunk metadata、text_diff3 可见化、structured_record_patch 可见化、StructuredFieldPatchDryRun gate、WorkItem 标量字段写回、base/current/incoming 字段冲突检测、`acceptance_items` 子记录写回、最新 dispatch plan `task_items` 子记录写回、字段级落点/写回审计渲染、标量字段高级覆盖、子记录逐项 diff/editor、任务子记录目标 plan 选择与 text hunk 后端逐段写回；仍缺 Replay hunk decision audit、React route 级逐行选择/编辑产品化与多冲突逐项选择历史。
- Web / Desktop / Cuu 冲突卡真实 UI 接入已由 R1.10 补齐：主界面可把 `details.conflicts` 渲染为按钮卡，Cuu card action 可携带同一 `request_json` 走 proposal merge。
- 非 delivery change 的任务子记录多计划/逐项 UI、重叠文本逐项确认/编辑、二进制“两份都留”自动改名。

### R1.10 Web/Desktop/Cuu conflict card wiring（2026-06-09）

本切片把 R1.9 的 deterministic 冲突 API 接到真实端侧渲染与点击链路，关闭“API 已有两选一，但用户仍看不到按钮”的缺口。范围仍限定为 file-only accepted deliverable ledger 的保守二选一，不引入 LLM 融合候选。

已落代码：

- `packages/ui/src/proposal/render.ts`：新增 `renderProposalConflictCards()`，`renderProposalDetail()` 支持 `options.conflicts`，页面内显示「和别人的改动撞车了」冲突区，按钮带 `data-conflict-option-id` 与 `data-request-json`。
- `apps/web/src/main.ts` / `apps/desktop-webview/src/main.ts`：Proposal detail render helper 读取 `GET /api/workitems/:id/conflicts` 并过滤当前 proposal；surface pages 清单加入 `/api/workitems/:id/conflicts`。
- `apps/web/src/browser.ts` / `apps/desktop-webview/src/browser.ts`：`merge_conflict` 409 会展开 option-first notice；点击冲突卡按钮时解析 `data-request-json`，调用 `client.mergeProposal(proposalId, payload)`。
- `packages/cuu/src/cards.ts`：新增 `cardFromProposalConflict()` / `cardsFromProposalConflicts()`，把 `ProposalConflict` 转为 Cuu `asking_approval` 卡；`accept_incoming` action 保留 `payload`。
- `apps/desktop-webview/src/desktop-cuu-runtime.ts`：Cuu pet action runtime 新增 `proposal-merge` typed action，独立 pet window 可直接提交冲突选择 payload。

当前契约：

| 项 | R1.10 行为 |
|---|---|
| 页面已有冲突 | `renderWebProposalDetail()` / `renderDesktopProposalDetail()` 会读取 conflicts endpoint，并在 Proposal 页显示两个选项 |
| merge 时才发现冲突 | Web/Desktop browser 捕获 `ApiErr.code="merge_conflict"`，从 `error.details.conflicts[]` 渲染同一冲突卡，并保持 notice 不自动消失 |
| 保留正式版 | 按 R1.9 `keep_current` action body 提交，默认不接受 incoming target |
| 采纳这次版本 | `accept_incoming` action body 必须包含 `conflict_resolution.accept_incoming_target_keys[]`；浏览器和 Cuu runtime 都透传 payload |
| Cuu | 只作为独立 pet window 的轻卡，不进入 Web/Desktop 主窗；card state 为 `asking_approval` |
| 去黑话 | 用户面使用“撞车 / 保留正式版 / 采纳这次版本”，不显示 branch/merge/conflict 等术语 |

验证：

- `@workhub/ui` typecheck 与 25/25 tests 通过；新增 proposal renderer test 覆盖 conflict card、双按钮、payload 和英文文案。
- `@workhub/cuu` typecheck 与 30/30 tests 通过；新增 Cuu card test 覆盖 `proposal_conflict` payload_ref 与 action payload。
- `apps/web` typecheck 与 4/4 tests 通过；新增 Web render helper test 覆盖 conflicts endpoint 与 proposal page card。
- `apps/desktop-webview` typecheck 与 58/58 tests 通过；新增 Desktop render helper / Cuu runtime test 覆盖 conflict Cuu cards 与 `proposal-merge` action payload。

仍未完成：

- 已由 R1.14 部分补齐：LLM `ai_fusion` 候选生成、candidate rationale、推荐项和失败降级已接入。
- R1.16/R1.19-R1.41 已补 AI 融合稿物化采纳、text/spec 正文直写、真实 current/incoming/base prompt context、数据层 `text_patch_preview`、Replay 可见 patch preview、Proposal 采用前最小 patch preview、无重叠文本 hunk deterministic diff3、重叠 hunk metadata、text_diff3 可见化、structured_record_patch 可见化、StructuredFieldPatchDryRun gate、WorkItem 标量字段写回、字段冲突检测、`acceptance_items` 子记录写回、最新 dispatch plan `task_items` 子记录写回、字段级落点/写回审计渲染、标量字段高级覆盖、子记录逐项 diff/editor、任务子记录目标 plan 选择与 text hunk 后端逐段写回；仍缺 Replay hunk decision audit、React route 级逐行选择/编辑产品化与多冲突逐项选择历史。
- 非 delivery change 的任务子记录多计划/逐项 UI、重叠文本逐项确认/编辑、二进制“两份都留”自动改名。
- 真实 React route 产品化与 Playwright 截图门禁；当前仍是 TS-first shared renderer / shell 纵切。

### R1.11 MergeAttempt audit trail（2026-06-09）

本切片关闭“冲突选择只存在于一次 API 请求，事后无法解释”的缺口。范围仍限定为 R1 file-only accepted deliverable ledger 的 deterministic 两选一，不引入 LLM 融合候选。

已落代码：

- `packages/db/src/schema/core.ts`：新增 `merge_attempts` 表，并由 Drizzle 生成 `packages/db/migrations/0006_fantastic_nightmare.sql` 与 `meta/0006_snapshot.json`。表字段包含 `proposal_id`、`work_item_id`、`branch_id`、`actor_kind/user_id`、`result`、`merge_snapshot_id`、`conflicts_json`、`accepted_target_keys`、`target_keys`、`conflict_count`。
- `packages/db/src/repositories/proposals.ts`：`merge()` 在冲突 gate 阻断时先提交 `merge_attempts(result="conflict")`，再在事务外抛 `ProposalRepositoryMergeConflictError`；显式采纳 incoming 后成功 merge 时写 `merge_attempts(result="merged")`。
- `AuditLog(action="proposal.merged").detail_json` 新增 `merge_attempt_id`、`accepted_incoming_target_keys`、`resolved_conflict_target_keys`、`conflict_count`，把用户选择、merge snapshot 与 accepted ledger 串起来。
- `apps/api/src/proposals.test.ts` 的 DB-backed fake repository 同步记录 `mergeAttempts`，测试覆盖默认 409 后有 `result="conflict"`、带 target key 二次 merge 后有 `result="merged"` 与 `acceptedTargetKeys`。
- `packages/db/src/schema.test.ts` 把 F02 表数更新为 45，并新增 `merge_attempts` 字段断言。

当前契约：

| 场景 | R1.11 行为 |
|---|---|
| 默认 merge 撞车 | 返回 409 前持久化 `merge_attempts.result="conflict"`，`conflicts_json` 保存被挡住的冲突 |
| 用户点击“采纳这次版本” | 请求体携带 `conflict_resolution.accept_incoming_target_keys[]`，成功 merge 写 `merge_attempts.result="merged"` |
| clean merge | 仍写 `merge_attempts.result="merged"`，`conflict_count=0` |
| replay/audit 串联 | `proposal.merged` audit detail 保存 `merge_attempt_id`，后续 replay 可从 audit 追到 attempt、snapshot、accepted rows |
| 用户面 | UI/桌宠不新增复杂控件；仍使用 R1.10 的两个按钮，不要求用户打字 |

验证：

- `@workhub/db` typecheck 通过；`@workhub/db` tests 当前 12/12 通过。
- `@workhub/api` typecheck 通过；`apps/api/src/proposals.test.ts` 当前 7/7 通过。

仍未完成：

- 已由 R1.14/R1.16/R1.19-R1.41 部分补齐：LLM `ai_fusion` 候选生成、candidate rationale、recommended option、失败降级、Markdown 融合稿物化采纳、text/spec 正文直写、真实 current/incoming/base prompt context、数据层 `text_patch_preview`、Replay 可见 patch preview、Proposal 采用前最小 patch preview、无重叠文本 hunk deterministic diff3、重叠 hunk metadata、text_diff3 可见化、structured_record_patch 可见化、StructuredFieldPatchDryRun gate、WorkItem 标量字段写回、字段冲突检测、`acceptance_items/task_items` 子记录写回、字段级落点/审计渲染、标量字段高级覆盖、子记录逐项 diff/editor、任务子记录目标 plan 选择与 text hunk 后端逐段写回已接入；仍缺 Replay hunk decision audit、React route 级逐行选择/编辑产品化与多冲突工作台。
- 多冲突逐项选择历史：当前 `accepted_target_keys` 可记录多个 key，但 UI 仍是每个 conflict card 自带单 key payload，不是完整冲突工作台。
- 非 delivery change 的字段级三方合并、重叠文本逐项确认/编辑、二进制“两份都留”自动改名。
- Replay 页面展示已由 R1.13 接入；当前仍不是完整多冲突工作台。

### R1.12 MergeProposal deterministic candidates（2026-06-09）

本切片关闭“候选方案只存在于前端 conflict options，后端没有候选表”的缺口。范围仍限定为 deterministic 两选一；不调用 LLM，不生成融合文本。

已落代码：

- `packages/db/src/schema/core.ts`：新增 `merge_proposals` 表，并由 Drizzle 生成 `packages/db/migrations/0007_fast_pet_avengers.sql` 与 `meta/0007_snapshot.json`。
- `packages/db/src/repositories/proposals.ts`：`recordMergeProposals()` 在每个 `merge_attempts` 下写候选。默认 409 写 `keep_current` / `accept_incoming` 两个 candidate、`recommended_option_key="keep_current"`、`chosen_option_key=null`；成功采纳 incoming 时写 `chosen_option_key="accept_incoming"`、`chosen_by_user_id`、`chosen_at`。
- `apps/api/src/proposals.test.ts`：fake repository 同步记录 `mergeProposals`；测试覆盖阻断时未选择候选、二次采纳时 chosen option 与决策人落表。
- `packages/db/src/schema.test.ts`：F02 表数更新为 46，并新增 `merge_proposals` 字段断言。

当前契约：

| 场景 | R1.12 行为 |
|---|---|
| 默认 merge 撞车 | `merge_attempts.result="conflict"` 下写 `merge_proposals`，候选存在但 `chosen_option_key=null` |
| 用户点击“采纳这次版本” | 成功 merge 的 `merge_proposals` 写 `chosen_option_key="accept_incoming"`、`chosen_by_user_id`、`chosen_at` |
| R1.12 历史边界 | `candidates_json` 当时只有 deterministic 两项；R1.14 已把 LLM 融合候选追加为第三类 candidate 的入口补上 |
| 用户面 | Web/Desktop/Cuu 仍使用 R1.10 的 option-first 按钮，不新增输入负担 |

验证：

- `@workhub/db` typecheck 通过；`@workhub/db` tests 当前 13/13 通过。
- `@workhub/api` typecheck 通过；`apps/api/src/proposals.test.ts` 当前 7/7 通过。

仍未完成：

- 已由 R1.14/R1.16/R1.19-R1.41 部分补齐：LLM 融合候选生成、candidate rationale、推荐项、失败降级、Markdown 融合稿物化采纳、text/spec 正文直写、真实 current/incoming/base prompt context、数据层 `text_patch_preview`、Replay 可见 patch preview、Proposal 采用前最小 patch preview、无重叠文本 hunk deterministic diff3、重叠 hunk metadata、text_diff3 可见化、structured_record_patch 可见化、StructuredFieldPatchDryRun gate、WorkItem 标量字段写回、字段冲突检测、`acceptance_items/task_items` 子记录写回、字段级落点/审计渲染、标量字段高级覆盖、子记录逐项 diff/editor、任务子记录目标 plan 选择与 text hunk 后端逐段写回已接入；仍缺 Replay hunk decision audit、React route 级逐行选择/编辑产品化与多冲突工作台。
- 多冲突逐项选择工作台：当前表能记录多 key，但 UI 仍是每张 conflict card 独立提交。
- 完整多冲突逐项选择工作台：R1.13 只展示历史，不提供批量选择/自定义候选编辑。

### R1.13 Replay merge decision timeline（2026-06-09）

本切片关闭“冲突候选和用户选择虽然已落库，但 replay 页面解释不了当时发生了什么”的缺口。范围限定为展示历史，不新增用户选择负担，不改变 Cuu 外观冻结规则。

已落代码：

- `packages/contracts/src/pages.ts`：新增 `ReplayMergeCandidateVM`、`ReplayMergeDecisionVM`、`ReplayMergeAttemptVM`，并在 `ReplayTraceVM` 上暴露 `merge_timeline[]`。
- `apps/api/src/pages/replay.ts`：新增 `toReplayMergeAttemptVm()`，把 `MergeAttemptRow` / `MergeProposalRow` 转为 replay snake_case VM。
- `apps/api/src/routes/agent-runs.ts`：`GET /api/agent-runs/:id/replay` 会按 work item 读取 proposal、attempt、proposal candidates，并把排序后的 `merge_timeline` 传入 `buildReplayTracePage()`。
- `packages/ui/src/gold-path/render.ts`：Replay Work 严肃页面新增“决策记录”统计和 timeline 卡片，展示冲突目标、候选、推荐项和最终选择；Web/Desktop 主窗仍不显示 Cuu 本体。
- `packages/agent/src/fixtures/gold-path.ts`：P0.5 fixture 默认 `merge_timeline: []`，避免 demo bundle 冒充真实冲突历史。

当前契约：

| 场景 | R1.13 行为 |
|---|---|
| 无冲突历史 | `merge_timeline=[]`，页面只显示 0 次决策记录 |
| 默认 409 冲突 | 若已有 `merge_attempts.result="conflict"` 与未选择候选，replay 可展示候选和未选择状态 |
| 用户采纳 incoming | replay 展示 `chosen_option_key="accept_incoming"`、`chosen_by_user_id`、`chosen_at` 与 chosen candidate |
| 语言 | 固定 chrome 支持 zh-CN / en-US；动态 rationale 保留服务端原文 |
| 边界 | 只读历史，不提供自定义候选、不做批量冲突工作台、不调用 LLM |

验证：

- `packages/contracts` typecheck 通过；`src/contracts.test.ts` 测试通过。当前 R1.15 后 contracts 为 16 项测试全绿。
- `packages/ui` typecheck 通过；`src/gold-path/render.test.ts` 8/8 通过。
- `apps/api` typecheck 通过；`src/agent-runs.test.ts` 13/13 通过。

仍未完成：

- 已由 R1.14/R1.16/R1.19-R1.41 部分补齐：LLM 融合候选生成、candidate rationale、推荐项、失败降级、Markdown 融合稿物化采纳、text/spec 正文直写、真实 current/incoming/base prompt context、数据层 `text_patch_preview`、Replay 可见 patch preview、Proposal 采用前最小 patch preview、无重叠文本 hunk deterministic diff3、重叠 hunk metadata、text_diff3 可见化、structured_record_patch 可见化、StructuredFieldPatchDryRun gate、WorkItem 标量字段写回、字段冲突检测、`acceptance_items/task_items` 子记录写回、字段级落点/审计渲染、标量字段高级覆盖、子记录逐项 diff/editor、任务子记录目标 plan 选择与 text hunk 后端逐段写回已接入；仍缺 Replay hunk decision audit、React route 级逐行选择/编辑产品化与多冲突工作台。
- 多冲突逐项选择工作台：当前 replay 能解释历史，但用户选择仍分散在每张 conflict card 的单 key payload。
- 真实 React route 产品化：当前 P0.5 renderer 已能展示 timeline，长期页面仍需迁到 `apps/web/src/routes/*` 组件体系。

### R1.14 LLM fusion candidate wiring（2026-06-09）

本切片关闭“`merge_proposals` 只能存 deterministic 两选一，LLM 融合候选没有代码入口”的缺口。R1.14 当时的范围限定为候选生成、质量门、持久化和展示；正式写回已在 R1.16 以 Markdown 融合稿物化采纳的方式补上，字段级/text diff3 仍归后续 v2。

已落代码：

- `apps/api/src/services/merge-fusion-candidates.ts`：新增 `MergeFusionCandidateGenerator`，默认实现使用 `ProviderRegistry` 的 review task 调用 Anthropic-compatible provider；无 API key、无支持目标、LLM 报错、输出非 JSON、带 git conflict marker 时返回空候选，保证 fail-open 到 deterministic 两选一。
- `apps/api/src/services/proposals.ts`：`createDbProposalService()` 在 merge 前读取同 proposal 的冲突，调用可注入 generator，生成 `candidateSupplements` 后传给 repository；409 响应会把 `ai_fusion` 作为“查看建议” option 放进 `details.conflicts[]`，但 `recommended_option_id` 仍默认 `keep_current`。
- `packages/db/src/repositories/proposals.ts`：`MergeProposalInput` 新增 `candidateSupplements`，`recordMergeProposals()` 把 supplement candidates 与 `keep_current/accept_incoming` 合并去重后写入 `merge_proposals.candidates_json`；repository 不直接调用 LLM。
- `packages/contracts/src/domain/collaboration.ts`：`ProposalConflictOption.id` / `recommended_option_id` 允许 `ai_fusion`，为后续 choose endpoint 留同一 contract。
- `packages/ui` 与 `packages/cuu`：Web/Desktop 主窗、Replay、Cuu 轻卡新增 `ai_fusion` 的 zh-CN/en-US 固定标签；主窗仍严肃无 Cuu 本体，Cuu 仍只在独立 pet window。
- `apps/api/src/merge-fusion-candidates.test.ts`、`apps/api/src/proposals.test.ts`、`packages/contracts/src/contracts.test.ts`、`packages/ui/src/gold-path/render.test.ts` 覆盖 LLM JSON -> candidate、unsupported family skip、409 option、持久化 candidate、schema 和 replay 双语展示。

当前契约：

| 场景 | R1.14 行为 |
|---|---|
| LLM 未配置/失败 | `candidateSupplements=[]`，merge 409 与 replay 保持 R1.12 deterministic 两项 |
| 目标类型不支持 | `binary_doc/spreadsheet/slide_deck/image/folder/archive` 不调用 LLM；后续走两选一或“两份都留”切片 |
| 支持目标且 LLM 返回合格 JSON | `merge_proposals.candidates_json` 追加 `option_key="ai_fusion"`、`source="llm"`、`quality_gate.status="passed"`、`merged_value` |
| 409 用户面 | 冲突卡可显示“AI 融合建议/AI fusion draft”查看型 option；真正能提交 merge 的仍是 `accept_incoming` payload |
| replay | `merge_timeline[].decisions[].candidates[]` 会展示 `ai_fusion`，并保留 `recommended/chosen` 标记 |

验证：

- `@workhub/api` typecheck 通过；`@workhub/api` tests 当前 71/71 通过。
- `@workhub/db` typecheck 通过；`@workhub/db` tests 当前 13/13 通过。
- `@workhub/contracts` tests 当前 16/16 通过。
- `@workhub/ui` tests 当前 26/26 通过。
- `@workhub/cuu` typecheck 通过；`@workhub/cuu` tests 当前 30/30 通过。

仍未完成：

- 已由 R1.15 补齐：`POST /api/merge-proposals/{id}/choose` 可把 `ai_fusion` 等候选选择写入 `chosen_option_key/chosen_by_user_id/chosen_at`。
- 已由 R1.16/R1.17/R1.19/R1.21/R1.22/R1.23/R1.24/R1.25 部分补齐：`ai_fusion` 可物化为正式交付物并走 Drive version / accepted ledger / rollback/audit 链路，冲突卡可一键采用，`text_doc/spec_doc` 会正文直写，candidate 带数据层 patch preview，Replay 与 Proposal 采用前均可见该 preview，无重叠文本 hunk 可 deterministic diff3；仍缺 `structured_record` 字段合并器、重叠 hunk 逐项确认/编辑与 React route 级逐行选择/编辑产品化。
- 多冲突逐项选择工作台：当前仍是每张 conflict card 独立提交，不支持一页批量选择/自定义候选编辑。
- R1.20 已解除最小 prompt 上下文真空：`text_doc/spec_doc` 冲突的 prompt 会读取 current accepted Drive 文本、incoming workdir 文件文本与可匹配的 base accepted 文本；仍只是截断摘录，不是完整 diff3/patch 输入。

### R1.15 MergeProposal candidate choose API（2026-06-09）

本切片关闭“`ai_fusion` 候选只能展示，不能形成审计选择”的缺口。R1.15 当时的范围限定为候选选择与回显；正式写回已在 R1.16 以 Markdown 融合稿物化采纳的方式补上，字段级/text diff3 仍归后续 v2。

已落代码：

- `packages/db/src/repositories/proposals.ts`：新增 `chooseMergeProposalCandidate()`，只更新 `merge_proposals.chosen_option_key/chosen_by_user_id/chosen_at/updated_at`；候选不存在返回 invalid，已选择其它候选返回 already chosen，repository 不调用 LLM、不改正式文件。
- `packages/contracts/src/domain/collaboration.ts`：新增 `ChooseMergeProposalCandidateRequest`、`MergeProposalCandidateChoiceResult` 与 candidate 回显 schema。
- `apps/api/src/services/proposals.ts` / `apps/api/src/routes/proposals.ts`：新增 `ProposalService.chooseMergeCandidate()` 与 `POST /api/merge-proposals/{id}/choose`，把 repository 错误映射为 422/409/404 人话错误。
- `packages/api-client`：新增 `chooseMergeProposalCandidate(id,{option_key})`，供 Web/Desktop 后续接按钮。
- `apps/api/src/pages/replay.ts` / `packages/contracts/src/pages.ts`：Replay candidate 继续显示 chosen 状态，并保留 `source/quality_gate`，方便审计 LLM 候选质量门。

当前契约：

| 场景 | R1.15 行为 |
|---|---|
| 选择 `ai_fusion` | 写 `chosen_option_key="ai_fusion"`、`chosen_by_user_id`、`chosen_at`，响应回显 candidate |
| 选择不存在的 option | 422 `invalid_merge_proposal_candidate` |
| 已选择其它 option 后覆盖 | 409 `merge_proposal_already_chosen` |
| 幂等选择同一 option | 返回现有选择记录 |
| 正式版写回 | 不发生；后续 `ai_resolved` 切片处理 |

验证：

- `@workhub/api` typecheck 通过；`@workhub/api` tests 当前 71/71 通过。
- `@workhub/db` typecheck 与 tests 当前 13/13 通过。
- `@workhub/contracts` tests 当前 16/16 通过。
- `@workhub/api-client` tests 当前 8/8 通过。
- `@workhub/ui` tests 当前 26/26 通过。

仍未完成：

- 已由 R1.16 部分补齐：已选择的 `ai_fusion.merged_value` 可写成正式 Markdown 融合稿；仍需把它进一步转成结构化字段更新或文本/规格文档 patch。
- R1.20 已补 text/spec 的真实 current/incoming/base prompt context；R1.21 已补数据层 patch preview；R1.22 已补 Replay 可见 patch preview；R1.23 已补 Proposal 采用前最小 patch preview；R1.24 已补无重叠文本 hunk deterministic diff3，R1.25 已补重叠 hunk metadata/prompt/quality gate；后续仍需重叠 hunk 逐项确认/编辑、React route 级逐行选择/编辑产品化 与结构化字段 patch。
- 多冲突逐项选择工作台：当前可逐 row 选择，但还不是一个严肃批量处理页面。

### R1.16 AI fusion apply artifact（2026-06-09）

本切片关闭“用户已经选择 `ai_fusion`，但系统仍无法形成正式交付物”的最小缺口。范围刻意收窄：把已选择的 `ai_fusion.merged_value` 物化成 Markdown 融合稿，接入既有 accepted deliverable / Drive version / merge snapshot / audit / replay 链路；当时不在本切片里做结构化业务字段写回、text/spec doc diff3，也不做多冲突批量工作台；后续 R1.29 已补 WorkItem 标量字段写回。

已落代码：

- `packages/contracts/src/domain/collaboration.ts`：新增 `ApplyMergeProposalCandidateRequest`，payload 为 `{confirm?: true}`；返回沿用 `ProposalMergeResult`，避免出现第二套“已合并”返回模型。
- `packages/db/src/repositories/proposals.ts`：新增 `findMergeProposalCandidateForApply()` 与 `applyMergeProposalCandidate()`。apply 会重新校验 proposal 仍为 `reviewed`、候选已选择且为 `ai_fusion`、candidate 带 `merged_value`、目标不是 folder，并要求 service 传入已物化的 artifact。
- DB apply transaction 会写 `snapshots(kind=merge, ref="merge-proposal:{id}:ai_fusion")`、`merge_attempts(result="merged")`、新的 `merge_proposals(chosen_option_key="ai_fusion")`、`accepted_deliverable_changes`、`ProjectDriveVersion`，并更新 `proposals/branches/work_items` 到 merged。
- `AuditLog(action="proposal.merged").detail_json` 新增 `merge_strategy="ai_resolved"`、`merge_proposal_id`、`chosen_option_key="ai_fusion"`、`accepted_change_ids`、`adopted_drive_version_ids` 与 resolved target keys。
- `apps/api/src/services/proposals.ts`：新增 `applyMergeCandidate()`。service 先读 apply context，把 `merged_value`、rationale、source、conflict key 写成 Markdown 融合稿，保存到 storage root，再把 sha/size/mime/path 交给 repository。
- `apps/api/src/routes/proposals.ts`：新增 `POST /api/merge-proposals/{id}/apply`，返回标准 `ProposalMergeResult`；普通 `POST /api/proposals/{id}/merge` 与 apply 共用同一 merge result builder。
- `packages/api-client`：新增 `applyMergeProposalCandidate(id, payload?)`；Web/Desktop 测试 fake client 同步补齐方法。
- `apps/api/src/proposals.test.ts`：route 测试覆盖 `merge_conflict -> choose ai_fusion -> apply -> merged`，断言 latest attempt 为 `merged`、`acceptedTargetKeys` 为冲突 target、latest merge proposal `chosenOptionKey="ai_fusion"`，重复 apply 返回 409。

R1.16 基线契约（R1.17 已把未选择 `ai_fusion` 的 apply 升级为一键选择 + 物化，见下一节）：

| 场景 | R1.16 行为 |
|---|---|
| 未选择候选即 apply | 409 `merge_proposal_not_chosen` |
| 已选择非 `ai_fusion` | 409 `merge_proposal_apply_requires_ai_fusion` |
| `ai_fusion` 无 `merged_value` | 409 `merge_candidate_missing_result` |
| proposal 已 merged | 409 `proposal_already_merged`，避免重复写 accepted row |
| apply 成功 | 生成 Markdown 融合稿，写 Drive version、accepted row、merge snapshot、merged attempt、`proposal.merged` audit，返回 `ProposalMergeResult` |
| replay/work item | 通过既有 `accepted_deliverables[]` 与 `merge_timeline[]` 看到融合稿和 `chosen_option_key="ai_fusion"` |

验证：

- `corepack pnpm --filter @workhub/contracts test` 通过，16/16。
- `corepack pnpm --filter @workhub/api test -- proposals` 通过；实际脚本运行 `apps/api/src/*.test.ts`，71/71。
- `corepack pnpm --filter @workhub/api-client test` 通过，8/8。

仍未完成：

- `ai_fusion` v2 原位写回：R1.19 已补 `text_doc/spec_doc` 候选正文直写与冲突 marker 拒绝；R1.20 已补真实 current/incoming/base prompt context；R1.21 已补数据层 `text_patch_preview`；R1.22 已补 Replay 可见 patch preview；R1.23 已补 Proposal 采用前最小 patch preview；R1.24 已补无重叠文本 hunk deterministic diff3，R1.25 已补重叠 hunk metadata/prompt/quality gate；仍缺重叠 hunk 逐项确认/编辑、React route 级逐行选择/编辑产品化、rollback proof，以及 `structured_record` 字段级 merge policy 与 schema-aware patch。
- R1.17 已补 Web/Desktop/Cuu “采用 AI 融合稿”一键入口，并已纳入真实 PG smoke；仍需 React route 产品化和视觉截图验收。
- 多冲突逐项选择工作台尚未完成；当前仍是每个 merge proposal row 单独 choose/apply。
- R1.17 one-click PG smoke 已覆盖 apply 物化链路；R1.16 的 choose-first 路径仍由 API fake repository 测试覆盖，后续若保留 choose-first 产品入口，再补真实 PG choose->apply 专项。

### R1.17 AI fusion one-click conflict card apply（2026-06-09）

本切片关闭“API 已能 apply，但用户仍要先 choose 再 apply，Cuu 轻卡也没有真正采用按钮”的缺口。目标是符合 AI Native 的 option-first 设计：当系统已有合格 `ai_fusion.merged_value`，用户在严肃主窗或独立 Cuu 桌宠里只需要点击一次“采用 AI 融合稿”。

已落代码：

- `packages/contracts/src/domain/collaboration.ts`：`ProposalConflict` 新增可选 `merge_proposal_id`，让 409 和 `GET /api/workitems/:id/conflicts` 能把冲突卡与可 apply 的候选行对齐。
- `apps/api/src/services/proposals.ts`：`listConflicts()` 与 merge 409 会读取最近一次 `merge_proposals`，把 `merge_proposal_id`、`recommended_option_id` 与 `ai_fusion` rationale 映射进 `ProposalConflict`；可 apply 时 `ai_fusion` option 的 action 为 `apply_ai_fusion`，`href=/api/merge-proposals/{id}/apply`，`request_json={confirm:true}`。
- `packages/db/src/repositories/proposals.ts`：`findMergeProposalCandidateForApply()` 允许未选择但存在 `ai_fusion` candidate 的 row 返回 apply context；`applyMergeProposalCandidate()` 若发现原 row 未选择，会先写 `chosen_option_key="ai_fusion"`、`chosen_by_user_id`、`chosen_at`，再创建 merged attempt、accepted row、Drive version、merge snapshot 和 audit。已选择其它候选仍返回 409。
- `apps/web/src/browser.ts` 与 `apps/desktop-webview/src/browser.ts`：主窗 action dispatcher 识别 `/api/merge-proposals/{id}/apply`，调用 `client.applyMergeProposalCandidate(id,{confirm:true})`。主窗仍只显示严肃冲突卡，不显示 Cuu 本体。
- `packages/ui/src/proposal/render.ts`：当 `ai_fusion` option 的 action id 为 `apply_ai_fusion` 时，按钮文案显示“采用 AI 融合稿 / Use AI fusion draft”。
- `packages/cuu/src/cards.ts` 与 `apps/desktop-webview/src/desktop-cuu-runtime.ts`：Cuu 轻卡同样显示“采用 AI 融合稿”，点击后解析为 `proposal-merge-candidate-apply` typed action 并调用 `client.applyMergeProposalCandidate()`。Cuu 仍只存在于独立 pet window。

当前契约：

| 场景 | R1.17 行为 |
|---|---|
| 409 conflict 有合格 `ai_fusion` candidate | conflict 带 `merge_proposal_id`，`ai_fusion` option 显示「采用 AI 融合稿」，action 指向 `/api/merge-proposals/{id}/apply` |
| `GET /api/workitems/{id}/conflicts` | 与 409 一致返回 `merge_proposal_id` 与 apply action，页面预读和错误恢复路径一致 |
| 未选择候选直接 apply | 服务端把本次点击写入原 `merge_proposals.chosen_*`，再物化融合稿；R1.19 起 `text_doc/spec_doc` 直接写候选正文，非文本/结构化目标仍保留 Markdown artifact |
| 已选择 `ai_fusion` 后 apply | 幂等走同一物化路径；若 proposal 已 merged，返回既有 409，避免重复 accepted row |
| 已选择非 `ai_fusion` 后 apply | 409 `merge_proposal_apply_requires_ai_fusion`，不覆盖人的既有选择 |
| `ai_fusion` 无 `merged_value` | 409 `merge_candidate_missing_result` |
| Cuu 点击 | 走 `proposal-merge-candidate-apply` typed action，不要求输入文字或二次选择 |

验证：

- `corepack pnpm --filter @workhub/contracts test` 通过，16/16。
- `corepack pnpm --filter @workhub/ui test` 通过，26/26。
- `corepack pnpm --filter @workhub/cuu test` 通过，30/30。
- `corepack pnpm --filter @workhub/desktop-webview test` 通过，59/59。
- `corepack pnpm --filter @workhub/api test` 通过，71/71。
- `corepack pnpm --filter @workhub/api typecheck`、`@workhub/web typecheck`、`@workhub/desktop-webview typecheck`、`@workhub/db typecheck` 通过。

仍未完成：

- `ai_fusion` v2 原位写回：R1.19 已补 `text_doc/spec_doc` 的正文直写和冲突 marker 拒绝；R1.20 已补真实 current/incoming/base prompt context；R1.21 已补数据层 `text_patch_preview`；R1.22 已补 Replay 可见 patch preview；R1.23 已补 Proposal 采用前最小 patch preview；R1.24 已补无重叠文本 hunk deterministic diff3，R1.25 已补重叠 hunk metadata/prompt/quality gate；仍缺重叠 hunk 逐项确认/编辑、React route 级逐行选择/编辑产品化、rollback proof，以及 `structured_record` 字段级 merge policy 与 schema-aware patch。
- 多冲突逐项选择工作台尚未完成；当前仍是每个 merge proposal row 单独 apply。
- 真实 PG smoke 已新增 R1.17 one-click 路径：生成 conflict、返回 `merge_proposal_id`、直接 apply、断言原 row `chosen_*`、`accepted_deliverable_changes`、`ProjectDriveVersion`、audit 与 replay；CI 通过 `.github/workflows/verify.yml` 的 `r1-pg-smoke` job 持续执行。
- React route 产品化与 Playwright 截图尚未补；当前主窗路径仍由 TS renderer/browser shell 覆盖。

### R1.18 BudgetPolicy PG persistence + audit（2026-06-09）

本切片关闭“P-COST policy 只能内存 override、管理员调参不可重启保留、没有审计证据”的缺口。范围刻意收窄：只落 BudgetPolicy override 持久化、成功 PUT 审计、cost usage/page 读取同一 DB policy；不在本切片里做预算事件推送或 Cuu budget bubble。

已落代码：

- `packages/db/src/schema/core.ts`：新增 `budget_policies` 表，字段覆盖 `scope_kind`、`period`、`max_tokens`、`max_cost_cny`、阈值、动作、`model_route_hint`、`enabled`、`version`、租户字段与更新人字段。
- `packages/db/migrations/0008_panoramic_dark_phoenix.sql`：创建 `budget_policies` 及 scope/enabled/workspace/updated_by 索引。
- `packages/db/src/repositories/budget-policies.ts`：实现 DB-backed `BudgetPolicyStore`。读取时把 `budget_policies` override 覆盖到配置 seed；更新时用 `applyBudgetPolicyPatch()` 递增 version，并 upsert 到 DB。
- `apps/api/src/services/cost-policy-store.ts`：生产默认 `BudgetPolicyStore` 切 DB-backed；同时暴露默认 audit repo，复用同一个 DB client。
- `apps/api/src/routes/cost.ts`：`GET /api/cost/policies`、`GET /api/cost/usage` 支持 async store；`PUT /api/cost/policies/:scope/:id` 成功后写 `AuditLog(action="budget_policy.updated")`，detail 记录 patch、before/after 与版本。
- `apps/api/src/workers/agent-runner.ts`：`createInMemoryAgentRunQueue()` 默认保持内存 policy store，避免单测误连 DB；`getDefaultAgentRunQueue()` 显式注入 DB-backed policy store，生产队列读真实 policy。
- `apps/api/src/qa/r1-pg-agent-run-smoke.ts`：真实 PG smoke 新增 policy list、PUT、readback、`budget_policies` 行、`budget_policy.updated` audit、cost usage/page policy override 断言。

当前契约：

| 场景 | R1.18 行为 |
|---|---|
| 首次读取 policy | 返回配置 seed 的四条 v0 默认 policy，不要求 DB 预填 |
| 更新默认 policy | upsert 一条 `budget_policies` override，`version = before.version + 1` |
| 重启后读取 | DB override 覆盖配置 seed；未 override 的 policy 仍由 seed 补齐 |
| 成功 PUT | 写 `budget_policy.updated` audit，带 `version_before/version_after/patch/before/after` |
| 单元测试队列 | `createInMemoryAgentRunQueue()` 不隐式连接 DB，必须显式注入才读 DB |
| 生产默认队列/路由 | `getDefaultAgentRunQueue()`、`createCostRoutes()` 默认读 DB-backed policy store |

验证：

- `corepack pnpm --filter @workhub/db typecheck` 通过。
- `corepack pnpm --filter @workhub/cost typecheck` 通过。
- `corepack pnpm --filter @workhub/api typecheck` 通过。
- `corepack pnpm --filter @workhub/db test` 通过，14/14。
- `corepack pnpm --filter @workhub/api test` 通过，71/71。
- `corepack pnpm verify` 通过。
- `corepack pnpm db:check` 通过。
- 本机 `corepack pnpm qa:r1-pg-smoke` 因无本地 PostgreSQL 服务失败于 `ECONNREFUSED 127.0.0.1:5432`；该项由 GitHub Actions `r1-pg-smoke` Postgres service 作为最终验收。

仍未完成：

- `usage.recorded`、`budget.warning`、`budget.exhausted` 事件尚未发出。
- Cuu budget bubble 仍未接真实 BudgetNotice。
- BudgetPolicy 更新目前由 route 顺序写 DB + audit，尚未做同事务封装；若后续要把 audit 作为强事务证据，需要把 update + audit 下沉到 DB transaction service。

### R1.19 AI fusion text/spec direct writeback（2026-06-09）

本切片关闭“`text_doc/spec_doc` 采用 AI 融合稿后，正式文件仍是包装说明 + JSON block，而不是用户可直接打开的正文”的缺口。范围刻意收窄：只处理已存在 `ai_fusion.merged_value` 的文本/规格文档正文写回；不在本切片里读取真实 base/ours/theirs，不做 diff3 自动合并，也不做结构化字段 patch。

已落代码：

- `apps/api/src/services/proposals.ts`：`materializeAiFusionCandidate()` 新增目标类型分流。`text_doc/spec_doc` 会从 `merged_value.merged_text/content_md/content/text/proposed_resolution_md/proposed_resolution/markdown` 中提取第一段非空正文，直接写入正式 storage；`structured_record`、二进制、表格、幻灯、图片等非文本目标继续走 R1.16 的 Markdown artifact 降级。
- 同一 service 增加冲突 marker 安全门：候选正文出现 `<<<<<<<`、`=======`、`>>>>>>>` 时返回 409 `merge_candidate_contains_conflict_markers`，禁止把 git/diff3 脏标记写进正式文件。
- MIME 规则收敛：`spec_doc` 固定 `text/markdown`；`text_doc` 的 `.md/.markdown/.mdx` 走 `text/markdown`，其它扩展名走 `text/plain`。
- `apps/api/src/proposals.test.ts`：route 测试把 one-click `ai_fusion` 冲突目标改为 `text_doc`，并断言落盘文件内容等于候选正文，不含“AI 融合正式稿”、`Merge Proposal ID` 或旧 JSON code fence 包装。
- `apps/api/src/qa/r1-pg-agent-run-smoke.ts`：真实 PG smoke 的 R1.17 one-click 路径升级为 R1.19 验收，断言 `ProjectDriveVersion.storagePath` 的文本严格等于 deterministic `proposed_resolution_md`，且没有旧包装。

当前契约：

| 场景 | R1.19 行为 |
|---|---|
| `ai_fusion.target_kind=text_doc/spec_doc` 且有文本字段 | 直接把候选正文写成正式 Drive version |
| `target_kind=text_doc/spec_doc` 但没有可提取正文 | 409 `merge_candidate_missing_text_result` |
| 正文含冲突 marker | 409 `merge_candidate_contains_conflict_markers` |
| `structured_record` | 暂不字段级 patch；继续物化 Markdown artifact，等待 schema-aware merge 切片 |
| 二进制/表格/幻灯/图片/文件夹 | 继续走既有保守行为；不做内容合并 |

验证：

- 计划验证命令：`corepack pnpm --filter @workhub/api typecheck`、`corepack pnpm --filter @workhub/api test`、`corepack pnpm verify`、`git diff --check`。
- 真实 PG 验收：GitHub Actions `r1-pg-smoke` 使用 Postgres service 跑 one-click AI fusion，并检查正式 Drive version 不再包含旧 Markdown/JSON 包装。

仍未完成：

- 真正 diff3：无重叠 hunk 自动合并、重叠 hunk 进入 AI mediation、React route 级逐行选择/编辑产品化、冲突块逐项确认尚未落地；R1.21 完成了数据层 current -> merged patch preview，R1.22 完成了 Replay 可见 patch preview，R1.23 完成了 Proposal 采用前最小 patch preview。
- `structured_record` 字段级 merge policy：字段优先级、schema-aware patch、枚举/日期/长文本/子记录规则仍待实现。
- 多冲突工作台：当前仍是每个 merge proposal row 单独 apply，不支持同页批量选择、编辑 AI 候选和逐项预览。

### R1.20 AI fusion real text content contexts（2026-06-09）

本切片关闭“LLM `ai_fusion` 只能看到 conflict / manifest / ref / hash 元数据，无法实际阅读两边文本”的最小缺口。范围仍刻意收窄：只为 `text_doc/spec_doc` 冲突提供 current / incoming / base 文本摘录，不在本切片做 diff3 自动合并、patch preview、结构化字段 patch 或多冲突工作台。

已落代码：

- `apps/api/src/services/proposals.ts`：新增 `fusionContentContextsForConflicts()`。在 proposal merge 检测到 text/spec 冲突后，先通过 repository 找当前 accepted Drive file，再从 `Branch.agent_run_id -> AgentRun.workdir_ref` 对应 manifest path 读取 incoming 文件；若 conflict 的 `incoming_version_before` / `incoming_sha256_before` 可匹配历史 accepted row，则读取 base 文件。
- `apps/api/src/services/proposals.ts`：新增 UTF-8 文本摘录读取门。读取失败、非文件、非 UTF-8 或路径解析失败不会阻塞 merge，只是不传对应 context；每段文本按 `maxFusionContextChars=16000` 截断，并带 `bytes/truncated/ref/sha256`。
- `packages/db/src/repositories/proposals.ts`：新增 `findAcceptedDriveFileForTarget({workItemId,targetKey,ref?,sha256?})`。无 ref/sha 时返回当前 accepted row；有 ref/sha 时可按 `accepted_ref` 或 `sha256_after` 查历史 accepted row，用于 base context。
- `apps/api/src/services/merge-fusion-candidates.ts`：`MergeFusionCandidateGeneratorInput` 新增 `contentContexts`，prompt 中每个 conflict 带 `content_context:{current?,incoming?,base?}`，并明确要求 LLM 使用这些上下文。
- `apps/api/src/qa/r1-pg-agent-run-smoke.ts`：deterministic fusion generator 会强制检查 current/incoming context；若真实 PG smoke 没读到正文上下文，one-click AI fusion 验收会失败。
- `apps/api/src/merge-fusion-candidates.test.ts`：新增 prompt 单测，断言 current / incoming / base 文本原样进入 LLM prompt JSON。

当前契约：

| 场景 | R1.20 行为 |
|---|---|
| `text_doc/spec_doc` 冲突且当前正式文件可读 | `content_context.current` 带正式版文本摘录 |
| incoming workdir 文件可读 | `content_context.incoming` 带这次提议文本摘录 |
| `version_before/sha256_before` 匹配历史 accepted row | `content_context.base` 带分叉基线文本摘录 |
| base 与 current 是同一 accepted row | 不重复传 base，避免误导 LLM |
| 任一文件缺失、越界、非 UTF-8、读取失败 | 省略该侧 context，保持 deterministic 两选一降级能力 |
| `structured_record` / 二进制 / 表格 / 图片等 | 不读文本 context，仍等待各自 merge policy |

验证：

- `corepack pnpm --filter @workhub/db typecheck` 通过。
- `corepack pnpm --filter @workhub/api typecheck` 通过。
- `corepack pnpm --filter @workhub/api test` 通过，新增 prompt context 单测；当前 API test 为 72/72。
- 后续完整验证仍需本切片提交前跑 `corepack pnpm verify`、`git diff --check`、reference 路径审计与 GitHub Actions。

仍未完成：

- 真正 diff3：无重叠 hunk 自动合并、重叠 hunk 进入 AI mediation、冲突块逐项确认。
- `structured_record` 字段级 merge policy：schema-aware patch、字段优先级、枚举/日期/子记录规则。
- 多冲突工作台：一个页面批量选择、编辑 AI 候选、逐项预览与一次性提交。
- 文本 context 仍是摘录，不是 streaming/分块检索；超长文档需要后续 chunk + evidence window。

### R1.21 AI fusion text patch preview（2026-06-09）

本切片关闭“AI 融合候选能写正文，但用户/回放看不到它相对正式版改了哪里”的最小缺口。范围限定为数据层 patch preview：在 `ai_fusion` candidate 的 `quality_gate.text_patch_preview` 中保存 current -> merged 的 unified patch 预览，并用 base/current/incoming 做行级 overlap 风险标记；不自动写回无冲突 hunk，不做结构化字段 patch，不做完整多冲突工作台 UI。

已落代码：

- `apps/api/src/services/merge-fusion-candidates.ts`：新增 `MergeFusionTextPatchPreview`、current->merged 单 hunk unified patch 生成、`base/current/incoming` 行级 overlap risk 计算。
- 同一 service 会把 `quality_gate.checks` 扩展为 `current_text_context`、`incoming_text_context`、可选 `base_text_context`、`text_patch_preview`，并把 `text_patch_preview` 写进 candidate。
- `safelyGenerateMergeFusionCandidates()` 会对任意 generator 返回的 `text_doc/spec_doc` `ai_fusion` 候选补 preview，因此真实 PG smoke 的 deterministic generator 也不会绕过。
- `apps/api/src/merge-fusion-candidates.test.ts`：断言 LLM prompt 仍带真实 current/incoming/base，并断言 candidate 持久前已有 patch preview、增删行、overlap risk 与 hunk lines。
- `apps/api/src/qa/r1-pg-agent-run-smoke.ts`：真实 PG one-click AI fusion 会检查原始 `merge_proposals.candidates_json` 里的 `ai_fusion.quality_gate.text_patch_preview` 已持久化。

当前数据契约：

| 字段 | 含义 |
|---|---|
| `quality_gate.text_patch_preview.type` | 固定 `unified_text_patch_preview` |
| `base_available` | 是否有可读 base accepted 文本 |
| `current_ref` / `incoming_ref` / `base_ref` | 可选来源 ref，给 replay/调试用 |
| `merged_sha256` | merged text 的 SHA256，便于确认预览与写回正文一致 |
| `stats.changed` | merged text 是否和 current 不同 |
| `stats.added_lines` / `removed_lines` | 单 hunk 预览中的增删行数 |
| `stats.overlap_risk` | `unknown` / `low` / `requires_review`；基于 base 行号重叠粗判 |
| `hunks[].header` / `hunks[].lines` | unified patch 片段；长行会截断，避免把过大正文塞进候选 |

仍未完成：

- 真正 diff3 自动合并：无重叠 hunk 自动写 merged，重叠 hunk 再交 AI mediation。
- Patch UI：R1.22 已在 `packages/ui/src/gold-path/render.ts` 的 Replay timeline 中渲染 `quality_gate.text_patch_preview`，显示 changed、增删行、overlap risk、base 状态与 unified hunk；R1.23 已把同一 preview 下沉到 `ProposalConflictOption.quality_gate` 并在 `packages/ui/src/proposal/render.ts` 的冲突卡里渲染采用前最小 diff；仍不是 React route 级逐行选择/编辑产品化。

### R1.22 Replay patch preview rendering（2026-06-09）

本切片关闭“R1.21 已持久化 patch preview，但 Replay 严肃页面仍看不到改动内容”的最小缺口。范围限定为 UI renderer：读取 replay candidate 的 `quality_gate.text_patch_preview` 并渲染为可扫描的 diff 预览；不改 API schema、不扩展 `ProposalConflict`、不实现自动 diff3，也不做多冲突工作台。

已落代码：

- `packages/ui/src/gold-path/render.ts`：新增 Replay candidate patch preview 渲染。每个带 `text_patch_preview` 的候选会显示“改动预览 / Change preview”、changed/unchanged、`+N / -N`、overlap risk、base 是否可用，并以等宽 diff 行展示 hunk。
- `packages/ui/src/gold-path/i18n.ts`：补齐中英双语 fixed chrome 文案，保持现有语言切换模型。
- `packages/ui/src/gold-path/render.test.ts`：新增断言，覆盖 `data-replay-text-patch-preview`、`data-overlap-risk`、增删行、中文“需要复核”和英文“Review required”。

当前边界：

| 项 | R1.22 行为 |
|---|---|
| 数据来源 | 只读 replay `merge_timeline[].decisions[].candidates[].quality_gate.text_patch_preview` |
| 展示位置 | Gold Path / Replay 严肃页的 merge decision candidate 下方 |
| 风险提示 | 展示 `overlap_risk`，但不替用户裁决 |
| Proposal 冲突卡 | R1.23 已扩展 `ProposalConflictOption.quality_gate`，可在 `ai_fusion` option 下展示采用前最小 patch preview |
| 富 viewer | 尚未做折叠、行号、文件级 tabs、分块大文档、逐项确认、React route 产品化 |

验证：

- `corepack pnpm --filter @workhub/ui typecheck` 通过。
- `corepack pnpm --filter @workhub/ui test` 通过，26/26。

仍未完成：

- R1.24 已补无重叠 hunk deterministic diff3；R1.25 已补重叠 hunk metadata；仍缺重叠 hunk 逐项确认/编辑。
- React route 级逐行选择/编辑产品化：折叠、行号、文件级 tabs、分块大文档、逐项确认仍未做；R1.23 只关闭“采用前完全看不到 diff”的最小缺口。
- `structured_record` 字段级 merge policy 与 schema-aware patch。
- 多冲突工作台：批量选择、编辑 AI 候选、逐项预览、一次性提交。

### R1.23 Proposal apply-before patch preview（2026-06-09）

本切片关闭“用户在 Proposal 冲突卡里点 `采用 AI 融合稿` 前看不到具体改动”的最小缺口。范围限定为契约透传与现有 TS renderer：把 `ai_fusion.quality_gate.text_patch_preview` 从 `merge_proposals.candidates_json` 下沉到 `ProposalConflictOption.quality_gate`，让 409 `details.conflicts[]` 与 `GET /api/workitems/{id}/conflicts` 返回同一 preview，再由 Proposal renderer 显示采用前 diff。不做自动 diff3、不做结构化字段 patch、不做多冲突工作台，也不把这次最小 renderer 当成最终 React 富 viewer。

已落代码：

- `packages/contracts/src/domain/collaboration.ts`：`proposalConflictOptionSchema` 新增可选 `quality_gate`，保持旧客户端兼容；没有改变 action payload。
- `apps/api/src/services/proposals.ts`：`mergeProposalRefsByConflictKey()` 读取 `ai_fusion` candidate 的 `quality_gate`；`conflictToVm()` 把它挂到 `ai_fusion` option；当前 merge 409 和后续 `/conflicts` 查询都走同一透传逻辑。
- `packages/ui/src/proposal/render.ts`：在冲突卡按钮下渲染 `data-proposal-text-patch-preview`，展示 changed/unchanged、`+N / -N`、overlap risk、base 状态和 unified hunk lines；中英文文案来自 `packages/ui/src/i18n.ts`。
- `packages/contracts/src/contracts.test.ts`、`packages/ui/src/proposal/render.test.ts`、`apps/api/src/proposals.test.ts`：覆盖 schema 保真、中文/英文 DOM、409 返回和 `/conflicts` 返回。

当前边界：

| 项 | R1.23 行为 |
|---|---|
| 数据来源 | 只读 `ai_fusion` candidate 的 `quality_gate.text_patch_preview` |
| 返回链路 | `POST /api/proposals/{id}/merge` 的 409 与 `GET /api/workitems/{id}/conflicts` 均透传 |
| 展示位置 | Proposal 冲突卡内、`采用 AI 融合稿` option 下方 |
| 用户裁决 | 仍是 option-first，人点击才 apply；preview 不会自动选择 |
| 降级 | 无 preview 时只保留原按钮，不阻塞 keep/accept/apply |
| 仍缺（R1.23 当时） | 自动 diff3、结构化业务字段写回、React route 级富 viewer、多冲突工作台；R1.24 已先关闭无重叠文本 hunk deterministic diff3；R1.25 已补重叠 hunk metadata/prompt/quality gate；R1.27 已补结构化字段元数据可见化；R1.29 已补 WorkItem 标量字段写回 |

验证：

- `corepack pnpm --filter @workhub/contracts typecheck` 通过。
- `corepack pnpm --filter @workhub/ui typecheck` 通过。
- `corepack pnpm --filter @workhub/api typecheck` 通过。
- `corepack pnpm --filter @workhub/contracts test` 通过，16/16。
- `corepack pnpm --filter @workhub/ui test` 通过，26/26。
- `corepack pnpm --filter @workhub/api test` 通过，72/72。

### R1.24 Deterministic text diff3 candidate（2026-06-09）

本切片关闭“无重叠文本改动仍必须依赖 LLM 才能生成融合稿”的最小缺口。范围限定在 `MergeFusionCandidateGenerator` 内部：当 `text_doc/spec_doc` 冲突已经有完整且未截断的 base/current/incoming 文本时，先做 deterministic line diff3；若 current 与 incoming 相对 base 的 hunk 不重叠，则直接生成 `source="diff3"` 的 `ai_fusion` candidate，并沿用 R1.21-R1.23 的 patch preview / option-first apply 链路。若缺 base、任一文本被截断、hunk 重叠、非文本目标或候选含冲突 marker，则不生成自动候选，继续走 LLM/两选一。

已落代码：

- `apps/api/src/services/merge-fusion-candidates.ts`：新增行级 LCS diff、hunk overlap 检测、descending patch apply 与 deterministic `textDiff3Merge()`；`createLlmMergeFusionCandidateGenerator()` 会先收集 diff3 supplement，再只把未自动解决的 eligible conflict 交给 LLM。
- `quality_gate`：diff3 candidate 写入 `status="passed"`、`checks=["line_text_diff3","non_overlapping_hunks",...]`、`text_diff3.{auto_merge,conflict_hunks,current_hunks,incoming_hunks}`，并继续追加 `text_patch_preview`。
- `apps/api/src/merge-fusion-candidates.test.ts`：新增两个测试：无重叠文本改动不调用 LLM 且返回 `source="diff3"`；同一文本块双方都改时仍走 LLM。

当前边界：

| 项 | R1.24 行为 |
|---|---|
| 自动范围 | 仅 `text_doc/spec_doc`、base/current/incoming 都存在且未截断、hunk 不重叠 |
| 候选形态 | 仍复用 `option_key="ai_fusion"`，source 改为 `diff3`，用户仍需点击采用 |
| 可见性 | 继续通过 R1.21-R1.23 的 `quality_gate.text_patch_preview` 在 Replay / Proposal 卡片显示 |
| 降级 | 重叠 hunk、缺上下文、截断或非文本目标继续走 LLM/两选一，不写脏 marker |
| 仍缺 | R1.25 已补重叠 hunk 的 LLM 调解输入与质量门；仍缺逐项确认/编辑、`structured_record` 字段级 patch、React route 级富 viewer、多冲突工作台 |

验证：

- `corepack pnpm --filter @workhub/api typecheck` 通过。
- `corepack pnpm --filter @workhub/api test` 通过，74/74。

### R1.25 Overlapping hunk mediation metadata（2026-06-09）

本切片关闭“重叠文本 hunk 交给 LLM 时缺少结构化事实、回放也看不出为什么需要人工/AI 调解”的最小缺口。范围限定在 `MergeFusionCandidateGenerator`：当 `text_doc/spec_doc` 有完整且未截断的 base/current/incoming 文本，但 deterministic diff3 检测到 hunk 重叠时，不再只把整段 `content_context` 丢给模型，而是追加 `text_diff3_conflicts[]`，列出每个重叠块的 base 行号、base/current/incoming 行内容。LLM 仍只产候选，用户仍点 option-first 采用；本切片不做逐行编辑器、不做 React 富 viewer、不做多冲突工作台，也不让 LLM 自动覆盖人的裁决。

已落代码：

- `apps/api/src/services/merge-fusion-candidates.ts`：新增 `textDiff3Analysis()`、`overlappingDiffHunkPairs()`、`textDiff3ConflictHints()` 与 `textDiff3QualityGate()`；prompt 的每个文本冲突可带 `text_diff3_conflicts[]`，质量门可带 `text_diff3.{auto_merge:false, conflict_hunks, current_hunks, incoming_hunks, conflict_ranges[]}`。
- `candidateWithTextPatchPreview()`：对 LLM 产生的 text/spec `ai_fusion` candidate 追加 `checks=["line_text_diff3","overlapping_hunks_for_ai_mediation",...]`，并保留 R1.21-R1.23 的 `text_patch_preview`。
- `apps/api/src/merge-fusion-candidates.test.ts`：覆盖同一行双方都改的场景，断言 prompt 包含 `base_lines/current_lines/incoming_lines`，candidate quality gate 标记 `auto_merge:false` 和 `conflict_hunks=1`。

当前边界：

| 项 | R1.25 行为 |
|---|---|
| 输入范围 | 仅 `text_doc/spec_doc`、base/current/incoming 都存在且未截断、且 hunk 重叠 |
| Prompt | `text_diff3_conflicts[]` 只放 capped 重叠块事实，不替模型写最终答案 |
| 审计 | `quality_gate.text_diff3.auto_merge=false`，记录 conflict hunk 数与 base 行号范围 |
| 用户裁决 | 仍复用 `ai_fusion` option-first apply；未点击不写正式版 |
| 仍缺 | 逐项确认/编辑、React route 级逐行选择/编辑产品化、`structured_record` 字段级 patch、多冲突工作台 |

验证：

- `corepack pnpm --filter @workhub/api typecheck` 通过。
- `corepack pnpm --filter @workhub/api test` 通过，74/74。

### R1.26 Text diff3 visible quality gate（2026-06-09）

本切片关闭“R1.25 的 `quality_gate.text_diff3` 只存在于数据里，用户在 Proposal / Replay 页面看不到自动合并状态和重叠行号”的最小缺口。范围限定在现有 HTML renderer，不新增后端字段、不改 merge 行为、不做逐行编辑器。

已落代码：

- `packages/ui/src/proposal/render.ts`：Proposal 冲突卡在 `ai_fusion` option 下展示 `text_diff3` 面板，包含“已自动合并 / 需逐项确认”、正式版改动段、这次版本改动段、重叠段与影响行。
- `packages/ui/src/gold-path/render.ts`：Replay 决策记录在候选下展示同一 `text_diff3` 面板，保证回放能解释当时为什么需要人工确认。
- `packages/ui/src/i18n.ts`、`packages/ui/src/gold-path/i18n.ts`：补中英文 copy，避免 CI locale 漂移造成误判。
- `packages/ui/src/proposal/render.test.ts`、`packages/ui/src/gold-path/render.test.ts`：固定 DOM 属性 `data-text-diff3-*` / `data-replay-text-diff3`、中英文标题、状态和影响行。

当前边界：

| 项 | R1.26 行为 |
|---|---|
| 可见性 | Proposal 和 Replay 均能显示 `text_diff3.auto_merge`、hunk 计数与 `conflict_ranges` |
| 用户动作 | 仍是 option-first 采用，不允许直接编辑 hunk |
| 契约 | 不新增后端 schema，复用 R1.24/R1.25 的 `quality_gate.text_diff3` |
| 仍缺 | 重叠 hunk 逐项确认/编辑、React route 级逐行选择/编辑产品化、任务子记录多计划/逐项 UI、多冲突工作台；R1.27 已补结构化字段元数据可见化，R1.29 已补 WorkItem 标量字段写回，R1.30 已补字段冲突检测，R1.31 已补 `acceptance_items` 子记录写回，R1.32 已补最新 dispatch plan `task_items` 子记录写回 |

验证：

- `corepack pnpm --filter @workhub/ui typecheck` 通过。
- `corepack pnpm --filter @workhub/ui test` 通过，26/26。

### R1.27 Structured record field patch quality gate（2026-06-09）

本切片关闭“`structured_record` 的 `ai_fusion` 候选只有自由文本解释，缺少机器可审计字段清单，Proposal / Replay 也看不到模型准备改哪些字段”的最小缺口。范围限定为候选生成质量门和现有 HTML renderer 可见化：不在本切片做 DB 字段写回、不做 schema-aware merge policy、不允许 AI 绕过人类 option-first 裁决。

已落代码：

- `apps/api/src/services/merge-fusion-candidates.ts`：`changeSummary()` 保留 `machine_summary`，LLM prompt 明确要求 `structured_record` 把拟改字段放进 `merged_value.fields`；`ai_fusion.quality_gate.structured_record_patch` 记录 `target_kind`、`target_entity_type`、`target_entity_id`、`changed_fields`、`merged_value_fields`、`missing_fields`、`unknown_fields`、`field_count` 与 `has_structured_result`。
- `apps/api/src/merge-fusion-candidates.test.ts`：新增结构化冲突 fixture，断言 prompt 包含 `change.machine_summary.changed_fields`，质量门能同时暴露“缺少验收项字段”和“模型额外给出的未知字段”。
- `packages/ui/src/proposal/render.ts`：Proposal 冲突卡在 `ai_fusion` option 下展示“结构化字段检查”，列出将写入字段、原声明字段、缺少字段和额外字段，并带 `data-structured-record-patch` / `data-structured-patch-*` 稳定 DOM 证据。
- `packages/ui/src/gold-path/render.ts`：Replay 决策记录展示同一结构化字段检查，便于事后解释当时 AI 建议改哪些字段、哪些字段未覆盖。
- `packages/ui/src/i18n.ts`、`packages/ui/src/gold-path/i18n.ts`：补中英文 copy，避免 locale 漂移。
- `packages/ui/src/proposal/render.test.ts`、`packages/ui/src/gold-path/render.test.ts`：覆盖 Proposal 与 Replay 的中英文结构化字段检查。

当前边界：

| 项 | R1.27 行为 |
|---|---|
| 数据契约 | `quality_gate.structured_record_patch` 是候选审计元数据，不是数据库字段 patch 执行计划 |
| 可见性 | Proposal / Replay 均能显示模型拟写入字段、声明变更字段、缺失字段与额外字段 |
| 用户动作 | 仍是 option-first 采用；没有逐字段勾选、编辑或批量确认 |
| 写回行为 | R1.29 已让 ready + executable WorkItem `title/summary_md/priority/due_at` 标量字段直接写回业务表；`needs_review` 与子记录仍不写 |
| 仍缺 | R1.30 已补 WorkItem 标量字段 base/current/incoming 冲突检测，R1.34 已补 ready + executable 标量字段高级覆盖，R1.37 已补子记录逐项 diff/editor；仍缺 schema-aware merge policy、多计划选择和多冲突工作台 |

后续施工切片：

1. **R1.28 Structured field patch contract（已落）**：在 contracts 中定义可执行 `StructuredFieldPatch`，按 `target_entity_type + target_entity_id + field` 固定字段类型、值类型、校验错误与审计 payload；API apply 前先做 dry-run。
2. **R1.29 WorkItem scalar field writeback（已落）**：支持 `title`、`summary_md`、`priority`、`due_at` 等标量字段从 dry-run -> transaction 写回；`status` 永不自动合并。
3. **R1.30 Structured field conflict detector（已落）**：为 WorkItem 标量字段补 base/current/incoming 三方检测，区分 fast-path、same-value、true conflict。
4. **R1.31 Acceptance item subrecord merge（已落）**：`acceptance_items` 已按稳定 id 写回并保留 base/current/incoming 冲突保护。
5. **R1.32 Task subrecord merge（已落）**：最新 dispatch plan 的 `task_items` 按稳定 id 整组替换写回；新增、删除、编辑受 base/current/incoming gate 保护。
6. **R1.33 Field-level Proposal / Replay renderer（已落）**：在 Proposal route 与 Replay 严肃页展示字段级 base/current/after、dry-run operation、field_merge audit 与 itemCount；默认仍推荐 AI 给出的整体方案，避免把小白拖进表格工作台。
7. **R1.34 Field-level editor（已落）**：为高阶用户提供折叠的逐字段接受、保留当前值、自定义值输入；默认路径仍保持 option-first。
8. **R1.35 Rich patch viewer foundation（已落）**：共享 Proposal / Replay line/hunk viewer、行号和大 patch 折叠已落。
9. **R1.36 Overlap hunk review foundation（已落）**：共享 Proposal / Replay 重叠 hunk review 已落，`text_diff3.conflict_ranges[]` 会映射为可点选 current / incoming / AI fusion 的逐段决策意图；R1.37 已补子记录逐项 diff/editor，后端逐段 materialize、逐行编辑、任务子记录多计划/目标 plan 选择 UI 与多冲突工作台顺延到 R1.38+。

验证：

- `corepack pnpm --filter @workhub/api typecheck` 通过。
- `corepack pnpm --filter @workhub/api test` 通过，75/75。
- `corepack pnpm --filter @workhub/ui typecheck` 通过。
- `corepack pnpm --filter @workhub/ui test` 通过，26/26。
- `corepack pnpm verify` 通过。
- `git diff --check` 通过，`reference_paths=0`，`secret_like_matches=0`。

### R1.28 Structured field patch dry-run contract（2026-06-09）

本切片关闭“`structured_record_patch` 仍只是自由 record，无法作为可执行字段补丁契约审计，也无法在 apply 前阻断明显错误字段”的最小缺口。范围限定为 contracts、candidate 质量门、apply dry-run gate 与现有 Proposal / Replay 可见化：当时仍不写 WorkItem 业务字段，不做 base/ours/theirs 字段三方 merge，不做字段编辑器；R1.29 已在此契约上追加标量字段写回，R1.30 已补 WorkItem 标量字段三方检测。

已落代码：

- `packages/contracts/src/domain/collaboration.ts`：新增 `StructuredFieldPatch`、`StructuredFieldPatchOperation`、`StructuredFieldPatchDryRun`、`StructuredFieldPatchDryRunIssue` 与 `buildStructuredFieldPatchDryRun()`。R1.28 只允许 `target_entity_type="work_item"`，字段白名单为 `title`、`summary_md`、`priority`、`due_at`、`acceptance_items`；`status` 不在白名单内，仍必须由权威状态机写。
- `packages/contracts/src/contracts.test.ts`：新增 ready 与 blocked 两类 dry-run 测试。ready 覆盖 `title/priority/due_at` 的值类型和 audit payload；blocked 覆盖缺失声明字段、未知字段、非法日期。
- `apps/api/src/services/merge-fusion-candidates.ts`：`structured_record_patch` 下新增 `structured_field_patch` 与 `structured_field_patch_dry_run`，由 `merged_value.fields` 生成；unknown / missing / invalid value 不再只停留在 UI 文案，而是进入机器可审计 dry-run。
- `apps/api/src/services/proposals.ts`：`applyMergeCandidate()` 在 `structured_record` 上优先读取 candidate dry-run；旧候选缺少 dry-run 时从 `diff_manifest + merged_value` 即时构造。`status="blocked"` 时返回 409 `structured_field_patch_dry_run_failed`，避免明显错误结构化字段建议被当成正式 artifact 采纳。
- `apps/api/src/merge-fusion-candidates.test.ts`、`apps/api/src/proposals.test.ts`：覆盖 candidate dry-run 生成与 apply 前阻断。
- `packages/ui/src/proposal/render.ts`、`packages/ui/src/gold-path/render.ts`：结构化字段面板新增 dry-run 状态与 issue 数，带 `data-structured-patch-dry-run-status` / `data-structured-patch-dry-run-issues` 稳定 DOM 证据。
- `packages/ui/src/i18n.ts`、`packages/ui/src/gold-path/i18n.ts`、对应 renderer tests：补中英文 dry-run 文案和 Proposal / Replay 断言。

当前边界：

| 项 | R1.28 行为 |
|---|---|
| 契约 | `StructuredFieldPatch` 是可审计字段补丁计划，operation 只允许 `set` |
| 字段白名单 | `work_item.title/summary_md/priority/due_at/acceptance_items`；`status` 禁止 |
| dry-run | R1.28 允许 `ready` 继续、`needs_review` 继续但显示复核状态、`blocked` 阻断 apply；R1.29 对真实写回进一步要求 `ready + executable` |
| 写回 | R1.29 已让 ready + executable WorkItem 标量字段写回业务表；R1.31 已让 `acceptance_items` 子记录在 base/current/incoming 保护下替换写回；其它结构化目标仍 fail-closed 或后续处理 |
| UI | Proposal / Replay 显示 dry-run 状态和 issue 数；R1.34 已在 Proposal 的高级折叠区补标量字段编辑 |
| 仍缺 | R1.30 已补 WorkItem 标量字段三方检测；R1.31 已补 `acceptance_items` 子记录 merge；R1.32 已补最新 `dispatch` plan 的 `task_items` 首发 merge；R1.34 已补标量字段高级覆盖；R1.37 已补子记录逐项 diff/editor；仍缺任务子记录多计划/目标 plan 选择 UI 和多冲突工作台 |

后续施工切片：

1. **R1.29 WorkItem scalar field writeback（已落）**：读取 current WorkItem 行，支持 `title`、`summary_md`、`priority`、`due_at` 的 dry-run -> transaction 写回；`status` 继续 fail-closed。
2. **R1.30 Structured field conflict detector（已落）**：为 WorkItem 标量字段补 base/current/incoming 三方 merge，区分 fast-path、same-value、true conflict。
3. **R1.31 Acceptance item subrecord merge（已落）**：`acceptance_items` 从 warning 升级为可执行子记录 patch，按稳定 id 写回 `work_item_acceptance_items`，写入 `itemCount`、base/current/incoming 与 `mergeDecision` 审计。
4. **R1.32 Task subrecord merge（已落）**：把最新 `dispatch` plan 的 `task_items` 从后续路径升级为可执行子记录 patch，沿用 R1.31 的 base/current/incoming gate。
5. **R1.33 Field-level Proposal / Replay renderer（已落）**：字段级预览与 Replay 写回审计已显示 base/current/after、dry-run、`mergeDecision` 与 itemCount，但不提供字段编辑。
6. **R1.34 Field-level editor（已落）**：逐字段接受、保留当前值和自定义值输入作为高级折叠能力补齐；默认仍保持整体 option-first。
7. **R1.35 Rich patch viewer foundation（已落）**：Proposal / Replay 共用逐行 viewer；R1.36/R1.37 已补重叠 hunk review 与子记录逐项 diff/editor；继续补 React route 级逐行选择/编辑产品化、后端 hunk materialize 和多冲突工作台。

验证：

- `corepack pnpm --filter @workhub/contracts typecheck` 通过。
- `corepack pnpm --filter @workhub/contracts test` 通过，18/18。
- `corepack pnpm --filter @workhub/api typecheck` 通过。
- `corepack pnpm --filter @workhub/api test` 通过，76/76。
- `corepack pnpm --filter @workhub/ui typecheck` 通过。
- `corepack pnpm --filter @workhub/ui test` 通过，26/26。
- `corepack pnpm verify` 通过，覆盖全仓 typecheck/test/lint 与 portable config / target path / migration audits。
- 提交前安全门禁需保持：`git diff --check` 通过，`reference_paths=0`，`secret_like_matches=0`。

### R1.29 WorkItem scalar field writeback（2026-06-09）

本切片关闭“结构化字段 dry-run 已能判断对错，但 ready 候选仍不能写回业务字段”的最小缺口。范围限定为 WorkItem 标量字段：`title`、`summary_md`、`priority`、`due_at`。`status` 仍由权威生命周期服务写入，`acceptance_items` 和任务项仍等 R1.31 子记录 merge；R1.29 当时不做字段三方冲突检测、不做字段编辑器、不创建 accepted deliverable/Drive version；R1.30 已补 WorkItem 标量字段冲突检测。

已落代码：

- `packages/db/src/repositories/proposals.ts`：新增 `ProposalStructuredFieldPatchInput` 与 `applyStructuredWorkItemFieldPatch()`。`applyMergeProposalCandidate()` 对 `target_kind="structured_record"` 走结构化字段分支，要求 dry-run 为 `ready + executable`，校验目标 WorkItem 一致后在同一 transaction 内更新 `work_items.title/summary_md/priority/due_at`、`status="merged"`、`main_branch_id`、`accepted_at`、`version+1`，并写 merge snapshot、merged attempt、chosen merge proposal、proposal/branch 状态和 `proposal.merged` audit。
- `apps/api/src/services/proposals.ts`：`applyMergeCandidate()` 在 `structured_record` 上先解析 candidate dry-run。`blocked` 继续返回 `structured_field_patch_dry_run_failed`；`needs_review` 或非 executable 返回 `structured_field_patch_not_executable`；target 与当前 WorkItem 不一致返回 `structured_field_patch_target_mismatch`。结构化写回分支不再物化 Markdown artifact。
- `apps/api/src/proposals.test.ts`：补内存 repository 字段写回模拟，覆盖 `title/summary_md/priority/due_at` 写入、proposal merged、latest merge attempt merged、chosen option 为 `ai_fusion`，并断言结构化写回不会伪造 `accepted_deliverable_changes`。
- `apps/api/src/qa/r1-pg-agent-run-smoke.ts`：真实 PostgreSQL smoke 追加结构化字段 apply 场景，断言 WorkItem 标量字段落库、没有 accepted deliverable ledger、merge proposal chosen、`proposal.merged` audit 携带 `merge_strategy="field_merge"`、`structured_field_count=4` 与 `structured_field_changes[]`。

当前边界：

| 项 | R1.29 行为 |
|---|---|
| 可写字段 | `work_item.title`、`summary_md`、`priority`、`due_at` |
| 禁止字段 | `status` 不在写回白名单内，只能由生命周期服务推进 |
| 子记录 | `acceptance_items` 在 R1.31 已升级为可执行子记录写回；R1.29 本身只负责标量字段 |
| 执行条件 | 必须是 `structured_record`、target WorkItem 匹配、dry-run `ready` 且 `executable=true` |
| 审计 | `proposal.merged.detail_json` 写 `merge_strategy="field_merge"`、`structured_field_patch_dry_run`、`structured_field_changes`、`structured_field_count` |
| 交付账本 | 不创建 `accepted_deliverable_changes`、不创建 `ProjectDriveVersion`、`accepted_change_count=0` |
| 仍缺 | R1.30 已补 WorkItem 标量字段 base/current/incoming 冲突检测；R1.31 已补 `acceptance_items` 子记录 merge；R1.32 已补最新 `dispatch` plan 的 `task_items` 首发 merge；R1.33 已补字段级 Proposal/Replay 渲染和写回审计；R1.34 已补标量字段高级覆盖；R1.37 已补子记录逐项 diff/editor；仍缺任务子记录多计划/目标 plan 选择 UI 和多冲突工作台 |

后续施工切片：

1. **R1.30 Structured field conflict detector（已落）**：记录 base/current/incoming，给 WorkItem 标量字段补 fast-path、same-value、true conflict 判定；true conflict 返回 409，不静默覆盖。
2. **R1.31 Acceptance item subrecord merge（已落）**：把 `acceptance_items` 从 warning 升级为可执行子记录 patch，按稳定 id 替换写回，true conflict 返回 409。
3. **R1.32 Task subrecord merge（已落）**：把最新 `dispatch` plan 的 `task_items` 接入同一结构化补丁模型，支持整组新增、删除、编辑和并发冲突。
4. **R1.33 Field-level Proposal / Replay renderer（已落）**：Proposal route 展示字段前后值与 dry-run；Replay 展示每个字段的 before/after、来源、执行者、dry-run 状态和 audit payload。
5. **R1.34 Field-level editor（已落）**：标量字段编辑和逐字段选择折叠到高级区，默认仍是整体“采用 AI 融合稿”。
6. **R1.38 Multi-conflict workbench**：批量处理入口和多计划选择只给高阶用户，默认仍由 AI 推荐下一步；子记录逐项编辑已由 R1.37 落在单冲突卡内。

验证：

- `corepack pnpm --filter @workhub/db typecheck` 通过。
- `corepack pnpm --filter @workhub/api typecheck` 通过。
- `corepack pnpm --filter @workhub/db test` 通过，14/14。
- `corepack pnpm --filter @workhub/api test` 通过，77/77。
- `corepack pnpm verify`、`git diff --check`、`reference_paths=0`、`secret_like_matches=0` 作为提交前最终门禁执行。

### R1.30 Structured field conflict detector（2026-06-09）

本切片关闭“结构化字段已经能写回业务表，但没有 base/current/incoming 三方保护，可能覆盖人工并发修改”的缺口。范围仍限定为 WorkItem 标量字段：`title`、`summary_md`、`priority`、`due_at`。目标是让 AI 方案继续是主路径，但真正写入前必须证明当前字段仍等于 proposal 创建时捕获的 base，或者已经等于 AI 候选值。

已落代码：

- `packages/contracts/src/experience.ts`：`DeliverableChange.machine_summary` 增加 `field_values_before`，用于在 manifest 中记录结构化字段 base 值。
- `packages/contracts/src/domain/collaboration.ts`：`buildStructuredFieldPatchDryRun()` 增加 `base_fields` 输入；生成的 `StructuredFieldPatchOperation` 会携带 `before_value`，让 apply 阶段可以做字段级三方判定。
- `apps/api/src/services/merge-fusion-candidates.ts`：结构化候选质量门从 `change.machine_summary.field_values_before` 读取 base，并把 `before_value` 写入 candidate dry-run。
- `apps/api/src/services/proposals.ts`：旧候选缺少 candidate dry-run 时，从 `diff_manifest + merged_value + field_values_before` 即时构造 dry-run，避免历史候选绕过 base 检测。
- `packages/db/src/repositories/proposals.ts`：`createFromManifest()` 创建结构化 proposal 时读取当前 WorkItem 行并注入 `field_values_before`；`applyStructuredWorkItemFieldPatch()` 在 transaction 内读取当前行，按字段判断 `current == base` 为 `fast_path`，`current == incoming` 为 `same_value`，二者都不满足则返回 409 `structured_field_patch_conflict`；缺少 base 值返回 409 `structured_field_patch_base_missing`。
- `apps/api/src/proposals.test.ts`：内存 repository 补 base 捕获与冲突判定，覆盖“proposal 创建后人工改标题，AI 候选不得覆盖当前标题”。
- `apps/api/src/qa/r1-pg-agent-run-smoke.ts`：真实 PostgreSQL smoke 追加 R1.30 场景：先创建结构化字段 proposal 捕获 base，再模拟人工并发改标题，最后应用 AI 候选并断言 `structured_field_patch_conflict`、proposal 未 merged、chosen option 回滚、WorkItem 标题保持人工值。

当前边界：

| 项 | R1.30 行为 |
|---|---|
| 字段范围 | 仅 `work_item.title/summary_md/priority/due_at` |
| base 来源 | proposal 创建时由 DB repository 从当前 WorkItem 行写入 `machine_summary.field_values_before` |
| fast-path | `current == before_value` 时允许写入 AI 候选 |
| same-value | `current == incoming` 时允许幂等完成，避免重复点击失败 |
| true conflict | `current != before_value` 且 `current != incoming` 时 409 `structured_field_patch_conflict`，不写 WorkItem，不合并 proposal，不记录 chosen option |
| fail-closed | 缺 `before_value` 时 409 `structured_field_patch_base_missing`，旧候选不能无 base 直写 |
| 审计 | 成功路径继续写 `structured_field_changes[]`，每项包含 base/current/after 与 `mergeDecision` |
| 仍缺 | R1.31 已补 `acceptance_items` 子记录 merge；R1.32 已补最新 `dispatch` plan 的 `task_items` 首发 merge；R1.33 已补字段级 Proposal/Replay 渲染和写回审计；R1.34 已补标量字段高级覆盖；R1.37 已补子记录逐项 diff/editor；R1.40 已补任务子记录多计划/目标 plan 选择 UI；R1.41 已补 text hunk 后端逐段 materialize；仍缺 Replay hunk decision audit、多冲突执行审计和逐行编辑产品化 |

后续施工切片：

1. **R1.31 Acceptance item subrecord merge（已落）**：把 `acceptance_items` 从字段 warning 升级为按稳定 id 替换写回的子记录 patch，保留 base/current/incoming gate 和 `itemCount` audit。
2. **R1.32 Task subrecord merge（已落）**：把最新 `dispatch` plan 的任务子记录接入同一 gate；整组新增/删除/编辑按 id 保持稳定，同字段 edit/edit 由 base/current/incoming gate 阻断。
3. **R1.33 Field-level Proposal / Replay renderer（已落）**：Proposal route 显示字段 before/current/incoming 和推荐动作；Replay 展示字段旧值、新值、base/current/incoming 判定、执行者和 audit payload。
4. **R1.34 Field-level editor（已落）**：补标量字段编辑和逐字段选择；默认仍保持 option-first，不把小白拖进表格工作台。
5. **R1.38 Multi-conflict workbench**：在不加重默认看板的前提下，为高阶用户提供批量处理入口和多计划选择，默认仍由 AI 推荐下一步；单冲突内的子记录逐项编辑已由 R1.37 落地。

验证：

- `corepack pnpm --filter @workhub/contracts typecheck` 通过。
- `corepack pnpm --filter @workhub/contracts test` 通过，18/18。
- `corepack pnpm --filter @workhub/db typecheck` 通过。
- `corepack pnpm --filter @workhub/db test` 通过，14/14。
- `corepack pnpm --filter @workhub/api typecheck` 通过。
- `corepack pnpm --filter @workhub/api test` 通过，80/80。
- `pnpm qa:r1-pg-smoke` 场景已纳入 GitHub Actions `r1-pg-smoke`，用 PostgreSQL 16 service 验证真实 DB 路径。
- 提交前最终门禁仍需执行 `corepack pnpm verify`、`git diff --check`、`reference_paths=0`、`secret_like_matches=0`。

### R1.31 Acceptance item subrecord merge（2026-06-09）

本切片关闭“结构化记录可以改 WorkItem 标量字段，但验收项仍只能提示人工复核”的缺口。范围限定为 `work_item_acceptance_items` / `acceptance_items`，不扩展到任务项、不做字段级编辑器、不做多冲突批量工作台。实现策略是先支持整组 `acceptance_items` 替换写回，但必须带 proposal 创建时的 base，并在 apply 时比较 current/base/incoming，防止覆盖人工并发修改。

已落代码：

- `packages/contracts/src/domain/collaboration.ts`：`acceptance_items` 不再进入 deferred warning；新增结构化验收项 patch schema，要求每项有稳定 `id`、非空 `title`，允许 `description/status/sort_order/source_plan_id`，并继续拒绝非法 status、重复 id 与非数组值。
- `packages/contracts/src/contracts.test.ts`：结构化 dry-run fixture 覆盖 `acceptance_items`，确认 operation 可生成 `value_type="json_array"` 且携带 `before_value=[]`。
- `packages/db/src/repositories/proposals.ts`：`createFromManifest()` 在捕获 WorkItem base 字段时同步读取 `work_item_acceptance_items`；`applyStructuredWorkItemFieldPatch()` 在 transaction 内读取当前验收项，执行 `current == base` fast-path、`current == incoming` same-value、否则 409 `structured_field_patch_conflict`；成功时删除并重建该 WorkItem 的验收项集合，并在 `structured_field_changes[]` 写入 `field="acceptance_items"`、`itemCount`、base/current/after 与 `mergeDecision`。
- `apps/api/src/proposals.test.ts`：内存 repository 补验收项 base 捕获、替换写回和冲突阻断；覆盖“新增/更新验收项成功写入”和“proposal 创建后人工改验收项时拒绝 AI fusion”。
- `apps/api/src/qa/r1-pg-agent-run-smoke.ts`：真实 PostgreSQL smoke 新增 R1.31 场景：插入基线验收项，创建结构化 proposal 捕获 base，AI fusion 候选把原项改为 `met` 并新增一项，apply 后断言 `work_item_acceptance_items` 两行、无 accepted deliverable ledger、merge proposal chosen、`proposal.merged` audit 携带 `structured_field_count=1` 和 `itemCount=2`。

当前边界：

| 项 | R1.31 行为 |
|---|---|
| 子记录范围 | 仅 `acceptance_items` / `work_item_acceptance_items` |
| 稳定 key | 每项必须有稳定 `id`；重复 id 或非法数组 fail-closed |
| 写入策略 | 整组替换写回，先 delete 当前 WorkItem 验收项，再按 incoming 顺序 insert |
| 并发保护 | proposal 创建时捕获 base；apply 时比较 current/base/incoming，真正冲突 409 |
| 幂等 | current 已等于 incoming 时按 same-value 成功，避免重复点击失败 |
| 审计 | `structured_field_changes[]` 记录 base/current/after、`mergeDecision` 和 `itemCount` |
| 仍缺 | R1.32 已补最新 `dispatch` plan 的 `task_items` 首发 merge；R1.33 已补字段级 Proposal/Replay 渲染和写回审计；R1.34 已补标量字段高级覆盖；仍缺逐项子记录冲突 UI、任务子记录多计划合并、多冲突工作台 |

后续施工切片：

1. **R1.32 Task subrecord merge（已落）**：把最新 `dispatch` plan 的 `work_item_task_items` 接入同一 `StructuredFieldPatch` 模型，按 `id` 保持稳定并支持整组新增/删除/编辑；`title/description/item_type/suggested_user_id/estimate_hours/sort_order` 都有 base/current/incoming gate。
2. **R1.33 Field-level Proposal / Replay renderer（已落）**：Proposal 冲突卡显示 `acceptance_items` / `task_items` 的 before/current/after 与 item 摘要；Replay 严肃页展示 before/current/after、`mergeDecision`、`itemCount` 和执行者。
3. **R1.34 Field-level editor（已落）**：补标量字段高级编辑器；默认仍是一键采用 AI 融合稿，高级明细折叠。
4. **R1.38 Multi-conflict workbench**：补逐项子记录冲突 UI、多计划选择和批量处理入口；默认用户继续由 AI 以少量 option-first 卡片引导。

验证：

- `corepack pnpm --filter @workhub/contracts typecheck` 通过。
- `corepack pnpm --filter @workhub/db typecheck` 通过。
- `corepack pnpm --filter @workhub/api typecheck` 通过。
- `corepack pnpm --filter @workhub/contracts test` 通过，18/18。
- `corepack pnpm --filter @workhub/db test` 通过，14/14。
- `corepack pnpm --filter @workhub/api test` 通过，82/82。

### R1.32 Task item subrecord merge（2026-06-09）

本切片关闭“结构化记录可以改标量字段和验收项，但任务计划项仍不能由 AI fusion 安全写回”的首发缺口。范围限定为最新 `stage="dispatch"` 的 `work_item_task_plans` / `work_item_task_items`，对外字段名为 `task_items`。实现策略与 R1.31 一致：proposal 创建时捕获 base，apply 时比较 current/base/incoming；当前未变则 fast-path，当前已等于 incoming 则 same-value 幂等成功，否则 409 `structured_field_patch_conflict`，不静默覆盖人工修改。

已落代码：

- `packages/contracts/src/domain/collaboration.ts`：`task_items` 加入 `structured_record` 可执行字段白名单；新增结构化任务项 patch schema，要求每项有稳定 `id` 和非空 `title`，允许 `description/item_type/suggested_user_id/estimate_hours/sort_order`，并拒绝重复 id、非法 `item_type`、负数或非有限 `estimate_hours`。
- `packages/contracts/src/contracts.test.ts`：结构化 dry-run fixture 同时覆盖 `task_items`，确认 operation 可生成 `value_type="json_array"` 且携带 `before_value=[]`。
- `packages/db/src/repositories/proposals.ts`：`createFromManifest()` 捕获 WorkItem base 字段时读取最新 `dispatch` task plan 的 items；`applyStructuredWorkItemFieldPatch()` 在 transaction 内读取同一 plan 的当前 items，执行 base/current/incoming gate；成功时只删除并重建该 plan 下的 `work_item_task_items`，审计写入 `field="task_items"`、`itemCount`、base/current/after 与 `mergeDecision`。
- `packages/db/src/repositories/proposals.ts`：若 incoming `task_items` 非空且当前 WorkItem 没有 `dispatch` plan，会用 apply actor 创建一个 `stage="dispatch"`, `status="draft"` 的 task plan；如果 incoming 为空且没有 plan，则作为空集合 no-op 合并。
- `apps/api/src/proposals.test.ts`：内存 repository 补任务项 base 捕获、替换写回和冲突阻断；覆盖“新增/更新任务项成功写入”和“proposal 创建后人工改任务项时拒绝 AI fusion”。
- `apps/api/src/qa/r1-pg-agent-run-smoke.ts`：真实 PostgreSQL smoke 新增 R1.32 场景：插入 dispatch task plan 和基线 task item，创建结构化 proposal 捕获 base，AI fusion 候选更新估时并新增 risk item，apply 后断言 `work_item_task_items` 两行、无 accepted deliverable ledger、merge proposal chosen、`proposal.merged` audit 携带 `structured_field_count=1` 和 `itemCount=2`。

当前边界：

| 项 | R1.32 行为 |
|---|---|
| 子记录范围 | 仅最新 `stage="dispatch"` 的 `task_items` / `work_item_task_items` |
| 稳定 key | 每项必须有稳定 `id`；重复 id 或非法数组 fail-closed |
| 写入策略 | 整组替换写回，只删除并重建目标 dispatch plan 下的 items，不跨 plan 删除 |
| 并发保护 | proposal 创建时捕获 base；apply 时比较 current/base/incoming，真正冲突 409 |
| 幂等 | current 已等于 incoming 时按 same-value 成功，避免重复点击失败 |
| plan 创建 | 当前无 dispatch plan 且 incoming 非空时，使用 apply actor 创建 draft dispatch plan |
| 审计 | `structured_field_changes[]` 记录 base/current/after、`mergeDecision` 和 `itemCount` |
| 仍缺 | 多 dispatch/多阶段 task plan 选择 UI、跨 conflict 批量子记录工作台、多冲突工作台 |

后续施工切片：

1. **R1.33 Field-level Proposal / Replay renderer（已落）**：Proposal 冲突卡显示 dry-run operation 的 base/current/after；Replay 严肃页显示候选字段落点与 `proposal.merged` audit 中的 `structured_field_changes[]`，覆盖标量、`acceptance_items`、`task_items`。
2. **R1.34 Field-level editor（已落）**：在不加重默认页面的前提下，为高阶用户提供折叠的标量字段编辑器；默认仍是一键采用 AI 融合稿。
3. **R1.37 Subrecord item editor（已落）**：把 `acceptance_items` / `task_items` 从整组 operation 展开为逐项 diff，支持新增、删除、修改的逐项保留/采纳。
4. **R1.38 Multi-conflict workbench**：只给高阶用户批量处理入口和多计划选择；默认用户继续由 AI 以少量 option-first 卡片引导。
5. **R1.40 Task plan scope UI（已落）**：当一个 WorkItem 存在多个 `dispatch` 或多阶段 task plan 时，由 Proposal/后续 Cuu 让用户点选目标 plan，避免后台猜测。

验证：

- `corepack pnpm --filter @workhub/contracts typecheck` 通过。
- `corepack pnpm --filter @workhub/contracts test` 通过，18/18。
- `corepack pnpm --filter @workhub/db typecheck` 通过。
- `corepack pnpm --filter @workhub/db test` 通过，14/14。
- `corepack pnpm --filter @workhub/api typecheck` 通过。
- `corepack pnpm --filter @workhub/api test` 通过，82/82。
- 本轮提交前仍需跑 `corepack pnpm verify`、`git diff --check`、`reference_paths=0`、`secret_like_matches=0`；GitHub Actions `r1-pg-smoke` 会用 PostgreSQL 16 service 验证真实 DB 路径。

### R1.33 Field-level Proposal / Replay renderer（2026-06-09）

本切片关闭“结构化字段已经能写回，但用户只能看到字段名和计数，不能看到采用前落点与采用后审计”的缺口。范围只做严肃主窗渲染和共享 helper，不新增 Cuu 外观、不引入看板工作台、不做字段级编辑器。

已落代码：

- `packages/ui/src/structured-field-details.ts`：新增共享字段详情渲染 helper，能把 `StructuredFieldPatchDryRun.patch.operations[]` 渲染为字段级 base/current/after，并把 `AuditLog.detail_json.structured_field_changes[]` 渲染为写回审计；数组型子记录按 item 数和 item title 摘要显示。
- `packages/ui/src/proposal/render.ts`：Proposal 冲突卡在 `structured_record_patch` 下显示“字段级落点”，覆盖 `title/summary_md/priority/due_at/acceptance_items/task_items` 的采用前值。
- `packages/ui/src/gold-path/render.ts`：Gold Path Replay 同步显示候选字段落点和 apply 后 field_merge audit，保持概念页与真实 renderer 同口径。
- `packages/ui/src/replay/render.ts`：新增独立 `renderAgentRunReplay()`，直接消费真实 `ReplayTraceVM`，显示步骤、成本、正式交付物、merge timeline、text patch/diff3、structured patch 和字段写回审计。
- `apps/web/src/main.ts`、`apps/desktop-webview/src/main.ts`：新增 `renderWebAgentRunReplay()` / `renderDesktopAgentRunReplay()`，让 Web 与 Tauri webview 都能渲染真实 `/api/agent-runs/:id/replay` 返回值。

当前边界：

| 项 | R1.33 行为 |
|---|---|
| 用户心智 | 默认仍是“采用 AI 融合稿”少量选项；字段详情是解释证据，不把小白推入表格工作台 |
| Proposal | 采用前展示 dry-run operation 的 base/current/after、value_type、itemCount |
| Replay | 采用后展示 field_merge audit 的 base/current/after、`mergeDecision`、`itemCount` 与 merge snapshot 摘要 |
| 子记录 | `acceptance_items` / `task_items` 以数组 item 数和 item title 摘要呈现；逐项编辑仍不在本切片 |
| Cuu | 不新增主窗 Cuu，不新增桌宠外观；Cuu 只可继续承接轻量提醒/动作入口 |
| 仍缺 | 逐项子记录 conflict card、多 plan 选择、多冲突工作台、React route 级逐行选择/编辑产品化 |

验证：

- `corepack pnpm --filter @workhub/ui typecheck` 通过。
- `corepack pnpm --filter @workhub/ui test` 通过，27/27；新增 replay renderer 测试覆盖字段级落点和写回审计，中英双语均断言。
- `corepack pnpm --filter @workhub/web typecheck` 通过；`corepack pnpm --filter @workhub/web test` 通过，4/4。
- `corepack pnpm --filter @workhub/desktop-webview typecheck` 通过；`corepack pnpm --filter @workhub/desktop-webview test` 通过，59/59。
- 提交前仍需跑全量 `corepack pnpm verify`、`git diff --check`、`reference_paths=0`、`secret_like_matches=0`。

### R1.34 Field-level editor（2026-06-09）

本切片关闭“字段级落点已经可见，但高阶用户不能在不打字给 AI 的情况下微调字段裁决”的最小缺口。范围刻意收窄：只在 Proposal 严肃主窗的高级折叠区暴露 ready + executable `structured_record_patch` 的逐字段动作；默认主路径仍是一键“采用 AI 融合稿”，Cuu 不显示表格，不新增主窗桌宠，不处理 blocked dry-run，也不做子记录逐项编辑。

已落代码：

- `packages/contracts/src/domain/collaboration.ts`：新增 `StructuredFieldOverrideDecision`、`StructuredFieldOverride`、`StructuredFieldApplyOverrides` 与 `structured_field_overrides` apply payload。`decision` 只允许 `accept_incoming`、`keep_current`、`custom`；`custom` 必须显式带 `value`。
- `apps/api/src/routes/proposals.ts`：`POST /api/merge-proposals/:id/apply` 接收 `structured_field_overrides`，并传给 Proposal service；普通一键 apply payload 保持兼容。
- `apps/api/src/services/proposals.ts`：在原有 dry-run、target、base/current/incoming gate 前应用覆盖：`accept_incoming` 保留原 operation，`keep_current` 删除该 operation，`custom` 把 operation value 改成用户给定值并标记 `source="manual"`。重复字段、未知字段、空补丁或 invalid dry-run 都 fail-closed。
- `packages/ui/src/proposal/render.ts`：`ai_fusion` ready + executable option 下新增 `details[data-proposal-structured-field-editor]` 高级区；每个字段提供“只采用此字段”“保留当前字段”“使用自定义值”三个按钮/输入。按钮写 `data-request-json` 或 `data-request-json-template`，用于浏览器 runtime 提交同一 apply endpoint。
- `packages/ui/src/i18n.ts`、`packages/ui/src/proposal/render.test.ts`：补中英双语文案和 DOM contract 测试，保证默认页面仍是 option-first，高级编辑器只在展开后出现。
- `apps/api/src/proposals.test.ts`、`packages/contracts/src/contracts.test.ts`：覆盖字段覆盖契约与服务端写回。示例场景为 `title` 使用自定义值、`summary_md` 默认采用 incoming、`priority/due_at` 保留当前值，最终仍通过同一个 merge transaction 和 `structured_field_changes` 审计。

当前边界：

| 项 | R1.34 行为 |
|---|---|
| 默认心智 | 用户仍先看到整体“采用 AI 融合稿”，字段编辑折叠在高级区 |
| 可编辑范围 | 当前只面向 ready + executable structured patch；blocked / needs_review 不显示编辑器 |
| 标量字段 | `title/summary_md/priority/due_at` 可逐字段接受、保留当前值或写自定义值 |
| 子记录字段 | `acceptance_items/task_items` 仍可作为整组 operation 展示和 apply；逐项子记录编辑未落 |
| 服务端保护 | 覆盖后的 patch 仍复用原 dry-run、target 和 base/current/incoming gate；不能绕过并发冲突检测 |
| Cuu | 不承载字段表格；Cuu 只继续给“需要审批/采用/打开详情”等轻卡 |
| 仍缺 | 子记录逐项 conflict card、多 plan 选择、重叠 hunk 逐项编辑、React route 富 viewer、多冲突工作台 |

验证：

- `corepack pnpm --filter @workhub/contracts typecheck` 通过。
- `corepack pnpm --filter @workhub/contracts test` 通过，18/18。
- `corepack pnpm --filter @workhub/api typecheck` 通过。
- `corepack pnpm --filter @workhub/api test` 通过，83/83。
- `corepack pnpm --filter @workhub/ui typecheck` 通过。
- `corepack pnpm --filter @workhub/ui test` 通过（该切片测试通过；后续新增测试已提升总数）。
- 提交前仍需跑全量 `corepack pnpm verify`、`git diff --check`、`reference_paths=0`、`secret_like_matches=0`。

### R1.35 Rich patch viewer foundation（2026-06-10）

本切片关闭“Proposal / Replay 能看到 patch，但仍是无行号、无 hunk 结构、无大文档折叠的裸文本块”的缺口。范围刻意收窄：只做共享 TS renderer 基础件，不新增重型冲突工作台，不让 Cuu 承载完整 diff，不把普通用户拖进复杂看板。

已落代码：

- `packages/ui/src/rich-patch-viewer.ts`：新增共享 renderer 和 CSS，消费 `quality_gate.text_patch_preview` 的 `unified_text_patch_preview`，输出 `data-rich-patch-viewer`、hunk 数、总行数、可见行数、折叠行数、truncated 状态、每个 hunk 的 index/start line，以及每行的 old/new 行号。
- `packages/ui/src/proposal/render.ts`：Proposal 冲突卡不再自带一套 patch 解析逻辑，改用共享 renderer；继续保留 `data-proposal-text-patch-preview`、`data-conflict-option-preview-for`、`data-overlap-risk` 和 `data-patch-line-kind`，兼容既有冲突卡动作。
- `packages/ui/src/replay/render.ts`：Replay 决策记录同样改用共享 renderer，新增 `data-replay-text-patch-option-key`，保证采用前和回放后看到的是同一份 line/hunk 语义。
- `packages/ui/src/i18n.ts`：补 `proposal.patchHunks`、`proposal.patchLines`、`proposal.patchFoldedLines` 中英双语，避免 Replay/Proposal 写两套文案。
- `packages/ui/src/proposal/render.test.ts`、`packages/ui/src/replay/render.test.ts`：覆盖 Proposal / Replay 的 hunk、行号、增删行、折叠和中英文案。新增大 patch 测试证明默认最多展示 80 行，其余折叠，避免把冲突卡变成重型工作台。

当前边界：

| 项 | R1.35 行为 |
|---|---|
| 默认心智 | 用户仍先看到少量选项；diff 是采用前证据，不是默认工作台 |
| Proposal | `ai_fusion` option 的 patch 预览有 hunk、old/new line、增删行、风险和折叠摘要 |
| Replay | 决策记录复用同一 viewer，能追溯当时候选正文相对正式版的变化 |
| 大文档 | 默认展示前 80 行，记录 folded line count；完整展开/文件 tab 留给后续 route 产品化 |
| Cuu | 不显示完整 diff；只保留轻卡摘要和 deep-link |
| 仍缺 | Replay hunk decision audit、逐行选择/编辑、文件级 tabs、多冲突工作台、Playwright 截图门 |

后续施工切片：

1. **R1.36 Overlap hunk review foundation（已落）**：把 `text_diff3.conflict_ranges[]` 映射到可点选 hunk，用户可逐段选择 current / incoming / AI fusion；默认仍只推荐一条处理方式。
2. **R1.37 Subrecord item editor（已落）**：把 `acceptance_items` / `task_items` 从整组 operation 展开为逐项 diff，支持新增、删除、修改的逐项保留/采纳。
3. **R1.38 Multi-conflict workbench**：只给高阶用户批量入口；普通用户仍由 AI 按“最需要处理的一件事”递卡。
4. **R1.39 Route visual QA（已落）**：用 Web/desktop 真实 route + 浏览器截图检查长 patch、移动端、en-US、空/错态和不重叠。
5. **R1.40 Task plan scope UI（已落）**：多 `dispatch` / 多阶段 plan 场景必须显式点选目标 plan，禁止后台猜测写入落点。
6. **R1.41 Text hunk materializer（已落）**：后端正式支持 `text_hunk_overrides`，把逐段 current / incoming / AI fusion 决策写入最终文本并审计。

验证：

- `corepack pnpm --filter @workhub/ui typecheck` 通过。
- `corepack pnpm --filter @workhub/ui test` 通过，29/29。
- 提交前仍需跑全量 `corepack pnpm verify`、`git diff --check`、`reference_paths=0`、`secret_like_matches=0`。

### R1.36 Overlap hunk review foundation（2026-06-10）

本切片关闭“`text_diff3` 只能显示影响行，用户无法对重叠段形成可点击决策意图”的最小缺口。范围刻意限定在共享 UI renderer：Proposal 采用前和 Replay 回放后都能看到同一组重叠 hunk、同一组 current / incoming / AI fusion 选择按钮、同一份 `text_hunk_overrides` 请求模板。R1.36 完成时该 payload 仍是前端意图模型；R1.41 已把它升级为后端正式写回能力。

已落代码：

- `packages/ui/src/overlap-hunk-review.ts`：新增共享 renderer 和 CSS，消费 `quality_gate.text_diff3` 的 `type="line_text_diff3"`、`auto_merge`、`current_hunks`、`incoming_hunks`、`conflict_hunks`、`conflict_ranges[]`，输出 `data-overlap-hunk-review`、`data-overlap-hunk-count`、`data-overlap-hunk-index`、`data-overlap-hunk-start-line`、`data-overlap-hunk-end-line` 与每段 choice 的 `data-overlap-hunk-decision`。
- `packages/ui/src/proposal/render.ts`：Proposal 冲突卡不再自带一套 `text_diff3` renderer；`keep_current`、`accept_incoming`、`ai_fusion` 三个 option action 被映射为 hunk choice 的稳定 `data-action-*` 属性，并保留旧的 `data-text-diff3*` 兼容属性。
- `packages/ui/src/replay/render.ts`：Replay 决策记录复用同一 renderer，保留 `data-replay-text-diff3` 与 `data-text-diff3-option-key`，保证回放能解释当时哪几段需要人工判断。
- `packages/ui/src/i18n.ts`：补重叠段按钮中英双语，保持 zh-CN / en-US 同步。
- `packages/ui/src/proposal/render.test.ts`、`packages/ui/src/replay/render.test.ts`：覆盖 Proposal / Replay 的 hunk review、行范围、三个决策按钮、`text_hunk_overrides` 模板与中英文案。

当前边界：

| 项 | R1.36 行为 |
|---|---|
| 默认心智 | 用户仍先看到 AI 推荐的一条 option；hunk review 是证据区的可点选细节，不是默认工作台 |
| 数据来源 | 只消费后端已存在的 `text_diff3.conflict_ranges[]`，不在前端重算 diff3 |
| Proposal | 重叠段显示 current / incoming / AI fusion 三个按钮，并携带 `text_hunk_overrides` 模板与原 option action 元数据 |
| Replay | 回放页显示同一组 hunk 和决策按钮，用于解释当时为何需要逐项确认 |
| API | R1.41 后 `POST /api/merge-proposals/:id/apply` 已正式支持 `text_hunk_overrides` 逐段写回 |
| Cuu | 不展示完整 hunk review；Cuu 只给摘要和 deep-link |
| 仍缺 | Replay hunk decision audit、逐行编辑、React route 截图门、文件 tabs、多冲突工作台 |

后续施工切片：

1. **R1.37 Subrecord item editor（已落）**：把 `acceptance_items` / `task_items` 从整组 operation 展开为逐项 diff，支持新增、删除、修改的逐项保留/采纳。
2. **R1.38 Multi-conflict workbench**：只给高阶用户批量入口；普通用户仍由 AI 按“最需要处理的一件事”递卡。
3. **R1.39 Route visual QA（已落）**：把 shared rich patch viewer、overlap hunk review 和 subrecord item diff 接入真实 Web/Desktop route 截图检查，覆盖长 patch、移动端、en-US、空/错态和不重叠。
4. **R1.40 Task plan scope UI（已落）**：多 `dispatch` / 多阶段 plan 场景必须显式点选目标 plan，禁止后台猜测写入落点。
5. **R1.41 Text hunk materializer（已落）**：在 contracts/API/service/db 层正式接 `text_hunk_overrides`，逐段生成最终文本、写 Drive version、记录 audit，并拒绝缺失 range、越界 range 或 stale base。

验证：

- `corepack pnpm --filter @workhub/ui typecheck` 通过。
- `corepack pnpm --filter @workhub/ui test` 通过，29/29。
- 提交前仍需跑全量 `corepack pnpm verify`、`git diff --check`、`reference_paths=0`、`secret_like_matches=0`。

### R1.37 Subrecord item editor（2026-06-10）

本切片关闭“`acceptance_items` / `task_items` 只能整组替换，用户无法对新增、删除、修改的单个子记录点选裁决”的缺口。范围仍保持 AI-native：默认卡片继续推荐一条最稳路径，高阶逐项编辑折叠在 Proposal 证据区；Cuu 不展示表格，只保留摘要和 deep-link。

已落代码：

- `packages/contracts/src/domain/collaboration.ts`：新增 `StructuredItemOverrideDecision`、`StructuredItemOverride`、`StructuredItemApplyOverrides` 与 `structured_item_overrides` apply payload；字段白名单限定为 `acceptance_items` / `task_items`，每项通过稳定 `item_id` 定位，只允许 `accept_incoming` 或 `keep_current`。
- `apps/api/src/routes/proposals.ts`、`apps/api/src/services/proposals.ts`：`POST /api/merge-proposals/:id/apply` 支持 `structured_item_overrides`；服务层会先复用原 `StructuredFieldPatchDryRun`，再把逐项决策 materialize 回最终数组，然后继续走既有 base/current/incoming merge gate。重复 item 选择、未知字段、非数组字段、未知 item 都 fail-closed 为 409。
- `packages/ui/src/subrecord-item-diff.ts`：新增共享子记录 diff renderer，按 item id 对比 current/incoming，区分 `added`、`removed`、`modified`、`unchanged`；Proposal 模式输出“采纳此项/保留当前项”按钮与 `structured_item_overrides` 请求模板，Replay 模式只显示审计回放。
- `packages/ui/src/proposal/render.ts`：ready + executable `structured_record_patch` 下新增折叠“高级子记录编辑”，只在有子记录变化时展示，避免把普通用户推入重型工作台。
- `packages/ui/src/replay/render.ts`：Replay 严肃页显示同一子记录逐项变化，用于解释当时具体哪条验收项/任务项被新增、修改或保留。
- `packages/ui/src/i18n.ts`：补全 zh-CN / en-US 文案，保持多语言切换契约。
- `apps/api/src/proposals.test.ts`、`packages/contracts/src/contracts.test.ts`、`packages/ui/src/proposal/render.test.ts`、`packages/ui/src/replay/render.test.ts`：覆盖 payload schema、重复选择拒绝、逐项 keep/accept apply、Proposal 按钮、Replay 回放与中英文案。

当前边界：

| 项 | R1.37 行为 |
|---|---|
| 默认心智 | 用户仍先看到 AI 推荐的一条 option；逐项子记录编辑是折叠高级证据，不是默认工作台 |
| 子记录范围 | `acceptance_items` 和最新 `dispatch` plan 的 `task_items` |
| item 定位 | 仅通过稳定 `id` / `item_id`，新增、删除、修改都必须能映射到 current 或 incoming |
| Proposal | 展示当前/写入摘要、diff kind、逐项“采纳此项/保留当前项”按钮和 `structured_item_overrides` 模板 |
| API | `structured_item_overrides` 会被 materialize 成最终 operation value，然后复用既有 dry-run 与 DB 写回 gate |
| Replay | 记录采用后的子记录逐项变化；不再只显示“2 项”这种粗粒度摘要 |
| Cuu | 不展示表格；只做轻提醒和 deep-link，符合“桌宠不进主窗、不变成工作台”的概念边界 |
| 仍缺 | 多 dispatch / 多阶段 task plan 选择 UI、跨多个 conflict 的批量工作台后端审计产品化、React route 截图门、真实浏览器长列表交互验证 |

后续施工切片：

1. **R1.38 Multi-conflict workbench foundation（已落）**：为高阶用户补折叠批量冲突处理入口，但默认仍由 AI/Cuu 递一件最需要处理的事。
2. **R1.39 Route visual QA（已落）**：把 rich patch viewer、overlap hunk review、subrecord item diff 通过真实 Web/Desktop route 渲染并截图检查，覆盖移动端、en-US、长 patch、长子记录列表、空/错/载入/权限四态。
3. **R1.40 Task plan scope UI（已落）**：当 WorkItem 存在多个 `dispatch` 或多阶段 task plan 时，Proposal 先让用户点选目标 plan，再允许写入 `task_items`。
4. **R1.41 Text hunk materializer（已落）**：把 `text_hunk_overrides` 从前端意图模板升级为真正后端写回能力。

验证：

- `corepack pnpm --filter @workhub/contracts typecheck` 通过。
- `corepack pnpm --filter @workhub/contracts test` 通过，18/18。
- `corepack pnpm --filter @workhub/api typecheck` 通过。
- `corepack pnpm --filter @workhub/api test` 通过，84/84。
- `corepack pnpm --filter @workhub/ui typecheck` 通过。
- `corepack pnpm --filter @workhub/ui test` 通过，29/29。
- 提交前仍需跑全量 `corepack pnpm verify`、`git diff --check`、`reference_paths=0`、`secret_like_matches=0`。

### R1.38 Multi-conflict workbench foundation（2026-06-10）

本切片关闭“多个冲突同时出现时，高阶用户只能逐张卡片重复点击，无法快速核对全部冲突和执行相同安全决策”的最小缺口。范围刻意收窄：只做 Proposal 共享 renderer 的折叠批量检查区，不改 Cuu 外观、不新增复杂看板、不新增后端批量 API；普通用户默认仍先处理 AI 递出的一件最重要事项。

已落代码：

- `packages/ui/src/proposal/render.ts`：`conflicts.length > 1` 时在冲突卡顶部渲染 `<details data-proposal-conflict-workbench="true">`。单冲突不渲染批量区，避免普通路径变重。
- `packages/ui/src/proposal/render.ts`：批量区逐行列出 `conflict_id`、`target_key`、`target_kind`、推荐选项和目标路径，作为 route JS / QA 可稳定读取的数据模型。
- `packages/ui/src/proposal/render.ts`：仅在每个冲突都有同一 `POST /api/proposals/:id/merge` 动作时生成批量按钮；支持 `keep_current` 和 `accept_incoming`，不批量执行 `ai_fusion`。
- `packages/ui/src/proposal/render.ts`：批量 `keep_current` payload 为 `{ confirm: true, conflict_resolution: { accept_incoming_target_keys: [] } }`；批量 `accept_incoming` payload 聚合所有冲突 `target_key`。
- `packages/ui/src/i18n.ts`：新增批量冲突检查区 zh-CN / en-US 文案，保持双语切换。
- `packages/ui/src/proposal/render.test.ts`：覆盖单冲突不显示批量区、多冲突显示折叠区、两个批量动作、payload 聚合、多语言文案以及不出现 `kanban` / `git` 字符串。

当前边界：

| 项 | R1.38 行为 |
|---|---|
| 默认心智 | AI 仍先递一件最需要判断的事；批量入口默认折叠 |
| 批量范围 | 只处理同一 proposal merge endpoint 下的 `keep_current` / `accept_incoming` |
| AI fusion | 不做批量 AI 融合稿，因为每个候选质量门、hunk 和结构化字段可能不同 |
| Cuu | Cuu 不承载批量列表；只继续显示轻提醒和 deep-link |
| API | 复用现有 `/api/proposals/:id/merge` 的 `accept_incoming_target_keys[]`，本切片不新增 API |
| 审计 | 依赖现有 merge/audit；后续可补显式 bulk action audit 与 route JS 执行日志 |
| 仍缺 | 批量动作前端执行器、显式 bulk_action audit、Replay hunk decision audit、逐行编辑产品化 |

后续施工切片：

1. **R1.39 Route visual QA（已落）**：把 Proposal 多冲突、rich patch viewer、overlap hunk review、subrecord item diff 通过真实 Web/Desktop route 渲染并截图检查，覆盖移动端、en-US、长 patch、长子记录列表、空/错/载入/权限四态。
2. **R1.40 Task plan scope UI（已落）**：当 WorkItem 存在多个 `dispatch` 或多阶段 task plan 时，先显式选择目标 plan，再允许写入 `task_items`。
3. **R1.41 Text hunk materializer（已落）**：把 `text_hunk_overrides` 从前端意图模板升级为后端正式写回能力。
4. **R1.42 Multi-conflict execution audit**：如果 route JS 批量执行落地，需要为批量 keep/accept 增加明确 `bulk_action` audit 与失败局部回滚说明。

验证：

- `corepack pnpm --filter @workhub/ui typecheck` 通过。
- `corepack pnpm --filter @workhub/ui test` 通过，30/30。
- 提交前仍需跑全量 `corepack pnpm verify`、`git diff --check`、`reference_paths=0`、`secret_like_matches=0`。

### R1.39 Route visual QA（2026-06-10）

本切片关闭“Proposal / Replay 共享 renderer 已有字符串测试，但缺真实 Web/Desktop route 截图证据”的缺口。范围只覆盖 R1 高风险页面组件的浏览器视觉门，不把 Web 产品化提前扩大成完整 SPA，不把 Cuu 放回主窗口，也不引入重型看板。

已落代码与资产：

- `scripts/qa/r1-route-visual-qa.ts`：新增 route 视觉 QA 脚本，通过 `apps/web/src/main.ts` 与 `apps/desktop-webview/src/main.ts` surface 函数渲染，不绕过真实 route wrapper 直接测 renderer。
- `package.json`：新增 `pnpm qa:r1-route-visual`，用于生成 HTML、PNG、contact sheet 与 `route-visual-report.json`。
- `docs/workhub/05-clients/assets/audit/2026-06-10-r1-route-visual-qa/`：落盘 Web Proposal zh-CN desktop、Web Proposal en-US mobile-narrow、Desktop Proposal zh-CN、Web Replay en-US desktop、Desktop Replay zh-CN、route states zh-CN 六组截图与总览图。
- `docs/workhub/05-clients/r1-route-visual-qa.md`：记录截图目录、DOM gates、当前边界、复跑命令和后续 R1.40-R1.42 计划。
- `packages/ui/src/proposal/render.ts`、`packages/ui/src/replay/render.ts`：修复 mobile route 的横向撑宽风险，给主列/侧栏/card/grid/row 增加 `min-width:0`、长文本断行、窄屏单列布局。
- `packages/ui/src/rich-patch-viewer.ts`：限制 rich patch 与 diff code 在容器内滚动/截断，不再把页面整体撑宽。
- `packages/ui/src/proposal/render.test.ts`、`packages/ui/src/replay/render.test.ts`：补移动端布局 CSS contract，防止后续误删断行/单列规则。

已验收 gates：

| Gate | 证据 |
|---|---|
| Web Proposal zh-CN desktop | `web-proposal-zh-desktop.png` |
| Web Proposal en-US mobile-narrow | `web-proposal-en-mobile.png` |
| Desktop Proposal zh-CN | `desktop-proposal-zh.png` |
| Web Replay en-US desktop | `web-replay-en-desktop.png` |
| Desktop Replay zh-CN | `desktop-replay-zh.png` |
| loading / empty / error / forbidden 四态示意 | `web-route-states-zh.png` |
| 主窗口无 Cuu | `route-visual-report.json:gates.no_main_window_cuu=true` |
| 默认无重看板词 | `route-visual-report.json:gates.no_kanban_default=true` |
| 富 patch viewer / 长 patch 折叠 / hunk review / 子记录 diff / 多冲突折叠区 | `route-visual-report.json:gates.rich_patch_viewer...conflict_workbench=true` |
| 移动端无横向 overflow | `route-visual-report.json:gates.no_horizontal_overflow=true` |

当前边界：

| 项 | R1.39 行为 |
|---|---|
| Web 产品化 | 仍是 route visual QA，不等同完整 SPA 信息架构 |
| 四态 | 先有 route-state evidence page；R4 需要接真实页面 VM 的 loading/error/forbidden |
| 多语言 | 固定 UI 文案覆盖 zh-CN/en-US；fixture 业务正文仍按测试数据原文显示 |
| Cuu | 只验证主窗口无 Cuu；桌宠独立窗口动作 QA 不在本切片 |
| CI | 本地/人工执行截图脚本并提交证据；后续可接 nightly artifact |
| Chrome 行为 | Windows headless 下 mobile viewport 采用 `467px` 的实测 narrow width，避免浏览器最小窗口造成假裁切 |

后续施工切片：

1. **R1.40 Task plan scope UI（已落）**：当 WorkItem 存在多个 `dispatch` 或多阶段 task plan 时，Proposal/Cuu 先让用户点选目标 plan，再允许写入 `task_items`；不能后台猜测写入落点。
2. **R1.41 Text hunk materializer（已落）**：把 `text_hunk_overrides` 从前端意图模板升级为 API/service/DB 正式能力，逐段 materialize 最终文本并写审计。
3. **R1.42 Multi-conflict execution audit**：把批量 keep/accept 从稳定数据模型升级为 route JS 执行器，补 `bulk_action` audit 与局部失败说明。
4. **R1.43 Replay hunk decision audit**：把 `proposal.merged.detail_json.text_hunk_decisions[]` 回放为每段来源说明。
5. **R4 Route visual matrix**：把 home/intake/workitem/proposal/replay/cost/approvals 全页面接入真实 loading/empty/error/forbidden 截图矩阵。

验证：

- `corepack pnpm --filter @workhub/ui test` 通过。
- `pnpm qa:r1-route-visual` 通过并生成截图/报告。
- 提交前仍需跑全量 `corepack pnpm verify`、`git diff --check`、`reference_paths=0`、`secret_like_matches=0`。

### R1.40 Task plan scope UI（2026-06-10）

本切片关闭“`task_items` 写回默认猜最新 dispatch plan，多个 plan 或多阶段 plan 时可能误写目标”的缺口。实现策略不引入重型看板：Proposal 高级子记录编辑区只在 `task_items` 场景显示一组目标 plan 选项；用户点击 plan 后，请求体携带 `task_plan_scope.target_plan_id`；DB repository 在多 plan 无 scope 时 fail closed。

已落代码与文档：

- `packages/contracts/src/domain/collaboration.ts`：`ApplyMergeProposalCandidateRequest` 新增 `task_plan_scope.target_plan_id`。
- `apps/api/src/routes/proposals.ts`、`apps/api/src/services/proposals.ts`：`POST /api/merge-proposals/:id/apply` 解析并透传 plan scope。
- `packages/db/src/repositories/proposals.ts`：`task_items` patch 写回前读取 WorkItem 下所有 task plans；多 plan 无 scope 返回 `task_plan_scope_required`，scope 非法返回 `task_plan_scope_invalid`，scope 合法时只重写目标 plan。
- `packages/ui/src/subrecord-item-diff.ts`、`packages/ui/src/proposal/render.ts`：Proposal 子记录 diff 可读取 `task_plan_scope.options[]` 并渲染“先选目标计划”按钮，按钮 payload 直接携带 `target_plan_id`。
- `packages/ui/src/i18n.ts`：新增 zh-CN/en-US plan scope 文案。
- `apps/api/src/proposals.test.ts`：in-memory repository 模拟多 plan，覆盖未选 plan 拒绝、选中后只写目标 plan。
- `docs/workhub/05-clients/r1-task-plan-scope-ui.md`：记录 PRD 对齐、数据契约、后端写回规则、页面/Cuu 边界和后续切片。

已验收 gates：

| Gate | 证据 |
|---|---|
| Contract payload | `applyMergeProposalCandidateRequestSchema` 接受 `task_plan_scope.target_plan_id` |
| UI option-first | Proposal 渲染 `data-task-plan-scope="required"`、`data-task-plan-choice="true"` 与 `task_plan_scope` request template |
| API/service 透传 | `applyMergeCandidate` 将 scope 绑定到 `resolvedStructuredFieldPatch.taskPlanScope` |
| DB fail closed | 多 task plans 且无 scope 时拒绝 `task_plan_scope_required` |
| DB 定向写回 | scope 合法时只替换选中 plan 的 `work_item_task_items`，其他 plan 不变 |

当前边界：

| 项 | R1.40 行为 |
|---|---|
| Cuu | 只定义后续 bubble/deep-link 边界，本切片不把 Cuu 本体放入主窗 |
| Replay | 暂不展示 target plan；R1.43 需要把 targetPlanId 写入 `field_merge` audit 后回放 |
| Quality gate options | UI 已支持从 quality gate/dry-run hint 读取 `task_plan_scope.options[]`；后续 merge mediator 需要自动补真实 plan 列表 |
| Route visual | 本切片先补字符串/服务门；R4 再把 plan scope 场景纳入截图矩阵 |

后续施工切片：

1. **R1.41 Text hunk materializer（已落）**：把 `text_hunk_overrides` 从前端意图模板升级为 API/service/DB 正式逐段写回。
2. **R1.42 Multi-conflict execution audit**：批量 keep/accept route 执行器、`bulk_action` audit、局部失败说明。
3. **R1.43 Replay audit polish**：把 `targetPlanId`、plan label、stage/status 与 `text_hunk_decisions` 渲染为可读回放。
4. **R4 Route visual matrix**：把 plan scope 与 text hunk 场景纳入真实 loading/empty/error/forbidden 截图矩阵。

验证：

- `corepack pnpm --filter @workhub/contracts test` 通过，18/18。
- `corepack pnpm --filter @workhub/ui test` 通过，30/30。
- `corepack pnpm --filter @workhub/api test` 通过，85/85。
- `corepack pnpm --filter @workhub/db typecheck` 通过。
- `corepack pnpm --filter @workhub/api typecheck` 通过。
- `corepack pnpm --filter @workhub/ui typecheck` 通过。
- `corepack pnpm qa:r1-route-visual` 通过，`route-visual-report.json:gates.task_plan_scope=true`。
- 提交前仍需跑全量 `corepack pnpm verify`、`git diff --check`、`reference_paths=0`、`secret_like_matches=0`。

### R1.41 Text hunk materializer（2026-06-10）

本切片关闭“重叠 hunk review 只能生成前端点选意图，后端仍只能整体 apply AI fusion”的缺口。实现策略保持 AI-native：用户只点每段 current / incoming / AI fusion，后端读取 full base/current/incoming/AI fusion 文本并逐段生成最终文本；不引入默认大编辑器，不让 Cuu 承载完整 diff。

已落代码与文档：

- `packages/contracts/src/domain/collaboration.ts`：新增 `TextHunkOverrideDecision`、`TextHunkOverride`、`TextHunkApplyOverrides`；`ApplyMergeProposalCandidateRequest` 支持 `text_hunk_overrides.hunks[]`，并校验 `end_line >= start_line`。
- `apps/api/src/routes/proposals.ts`：`POST /api/merge-proposals/:id/apply` 解析并透传 `text_hunk_overrides`。
- `apps/api/src/services/text-hunk-materializer.ts`：新增纯 TS materializer，基于 base/current/incoming/AI fusion 的 line hunks 组装最终文本；要求 overrides 精确覆盖 `quality_gate.text_diff3.conflict_ranges[]`。
- `apps/api/src/services/proposals.ts`：为 text hunk apply 读取 full UTF-8 base/current/incoming 文本，校验 stale base/current/source sha，拒绝缺 context、source 改变、非 text/spec target 与冲突 marker。
- `packages/db/src/repositories/proposals.ts`：接受 `resolvedTextHunkPatch`，复用 accepted deliverable / Drive version / snapshot / merge attempt 链路，并在 `proposal.merged.detail_json` 写入 `text_hunk_overrides`、`text_hunk_decisions`、conflict ranges 与 base/current/incoming/output sha。
- `apps/api/src/proposals.test.ts`、`packages/contracts/src/contracts.test.ts`：覆盖合法 payload、非法 range、range mismatch 拒绝、逐段采纳 incoming 后最终文件内容正确且不是整篇 AI fusion。
- `docs/workhub/05-clients/r1-text-hunk-materializer.md`：记录 PRD 对齐、apply request、写回规则、审计 payload、页面/Cuu 边界和后续切片。

当前边界：

| 项 | R1.41 行为 |
|---|---|
| 目标类型 | 仅 `text_doc/spec_doc` |
| 数据来源 | full base/current/incoming/AI fusion 文本；`quality_gate.text_diff3.conflict_ranges[]` 是 hunk 权威范围 |
| 用户输入 | 只允许 `keep_current` / `accept_incoming` / `ai_fusion`，不接自由文本 |
| fail-closed | 缺 range、重复 hunk、range mismatch、未覆盖全部 conflict ranges、stale current/base/source、非 UTF-8/缺文件、冲突 marker 均拒绝 |
| 写回 | 生成最终文本，写正式 Drive version、accepted ledger、merge snapshot、merge attempt 和 `proposal.merged` audit |
| Replay | 当前 audit 已有机器可读 `text_hunk_decisions`；R1.43 需要渲染为可读回放 |
| Cuu | 只做摘要和 deep-link，不展示完整 hunk review |
| 仍缺 | 多冲突执行审计、Replay hunk decision audit、逐行编辑产品化、文件 tabs |

后续施工切片：

1. **R1.42 Multi-conflict execution audit**：批量 keep/accept route 执行器、`bulk_action` audit、局部失败说明。
2. **R1.43 Replay hunk decision audit**：把 `text_hunk_decisions`、目标文件、行号和最终来源渲染到 Replay。
3. **R1.44 React route line editor**：把逐行选择/编辑、文件 tabs、长文搜索和键盘可达性产品化。
4. **R4 Route visual matrix**：把 text hunk materializer 场景纳入真实 loading/error/forbidden 截图矩阵。

验证：

- `corepack pnpm --filter @workhub/contracts test` 通过，18/18。
- `corepack pnpm --filter @workhub/api test` 通过，86/86。
- `corepack pnpm --filter @workhub/db typecheck` 通过。
- `corepack pnpm --filter @workhub/api typecheck` 通过。
- 提交前仍需跑全量 `corepack pnpm verify`、`git diff --check`、`reference_paths=0`、`secret_like_matches=0`。

### R1.3 P0.5 fixture 生产分支迁出（2026-06-08）

已落代码切片：

- `apps/api/src/routes/agent-runs.ts` 删除 `allowP05ReplayFixture` 和 P0.5 replay fallback。
- `apps/api/src/routes/proposals.ts` 删除 P0.5 proposal/review/merge 分支，所有读写都走 `ProposalService`。
- `apps/api/src/routes/pages.ts` 只保留 `/api/pages/gold-path` demo bundle；`/api/pages/proposals/:id` 只读真实 proposal；`/api/pages/workitems/:id` 读取真实 `WorkItemService`。
- `apps/api/src/routes/sessions.ts`、`workitems.ts`、`knowledge.ts` 已接入真实 `WorkItemService`，避免用固定 fixture 冒充产品链路。
- `apps/api/src/pages/gold-path.ts` 删除未使用的 `isP05*` id matcher，减少误接回生产 route 的风险。
- `apps/api/src/services/work-items.ts` 新增 R1 最小真实 service；`packages/db/src/repositories/work-items.ts` 新增 DB repository；`apps/api/src/qa/r1-pg-agent-run-smoke.ts` 将 intake/knowledge/page 纳入 smoke。
- `apps/api/src/workers/agent-runner.ts` 串行化同一 run 的 trace persistence，避免 background trace 与 final trace 在真实 PG 下抢写 `agent_steps`。
- `packages/db/src/repositories/cost-ledger.ts` 新增 DB-backed `CostLedgerStore`；`packages/db/src/repositories/budget-policies.ts` 新增 DB-backed `BudgetPolicyStore`；生产默认 cost ledger/policy store 已切 DB，`createInMemoryAgentRunQueue()` 仍默认内存 ledger/policy 以保留单元测试隔离。
- `packages/db/migrations/0003_amused_raider.sql` 新增 `usage_records` 与 `cost_ledger_entries`，幂等键为 `usage_record_id + scope_kind + scope_id + period_bucket`；`0008_panoramic_dark_phoenix.sql` 新增 `budget_policies`。

验证：

- `rg -n "isP05|p05GoldPathIds|getP05GoldPathFixture|allowP05ReplayFixture|P0\\.5" apps/api/src/routes apps/api/src/openapi.ts -S` 只剩 `/api/pages/gold-path` 的 OpenAPI 摘要。
- `pnpm --filter @workhub/api typecheck` 通过。
- `pnpm --filter @workhub/api test` 通过，当前 71/71；新增测试确认生产 route 对 P0.5 fixture route set fail-closed，并覆盖正式交付物 restore route 与 BudgetPolicy audit。
- `pnpm --filter @workhub/cost test` 通过，当前 8/8；`pnpm --filter @workhub/db test` 通过，当前 14/14；`pnpm db:check` 与 `pnpm audit:migrations` 通过。

仍不能宣称 R1/R2 全部完成，因为 `ai_fusion` v2 的后端逐段 materialize/编辑、React route 级逐行选择/编辑产品化、任务子记录多计划/目标 plan 选择 UI、多冲突批量执行/审计产品化、完整 approval policy routing、PG claim/多 worker 仍未落地。

## 5. R2 多 worker 与订阅边界

目标：兑现地基存在的理由，多实例下不重复执行、不丢事件、不泄漏。

施工顺序：

1. `claimNextQueued()` 使用 `FOR UPDATE SKIP LOCKED` 或等价 CAS，多个实例可以同时跑 pump。
2. `running` run 增加 `claimed_by`、`claimed_at`、heartbeat；崩溃后 stuck-job 可回收。
3. 去掉 `startingWorkItems` 等进程内抢占状态，改 DB 唯一约束或条件插入。
4. PushBus / presence 默认切 Redis 或 PG broker；补 unsubscribe 引用计数。
5. `/api/push/stream` 的 `all` topic 删除或 admin-only；资源 topic 订阅前强制 `can_view`。
6. 建 PG + Redis 集成测试：2 worker SSE、stuck run 回收、CORS+cookie、revert、escalation approver、非 owner 403。

R2 验收：

- `WORKHUB_WORKERS=2` 下 R1 纵切仍通过。
- 同一 work item 并发 enqueue 只有一个 run 执行。
- A 实例发布事件，B 实例订阅者收到。
- 非 owner 订阅他人 run/workitem/proposal 被拒。

## 6. R3 Cuu Agent 入口

目标：补 `FR-PET-002`，让 Cuu 成为小白入口，而不是继续做外观。

范围：

- 点 Cuu 出现真实输入/选项气泡，不是静态 hint。
- 桌宠出站走 Web 同一 API：session、intake、workitem、agent-run、proposal review/merge。
- 出站动作经真实鉴权与权限引擎，不开 Cuu 专用后门。
- SSE/CuuState 回流显示 pending/success/failure。

禁止：

- 不新增模型、改色、动效、设置矩阵。
- 不把 Cuu 放回 Web/desktop 主窗。
- 不让 Cuu 绕过 proposal/review/permission 规则。

R3 验收：

- 一句话从 Cuu 触发 R1/R2 真实链路。
- Cuu 可查状态、确认、打回，并有失败态。
- 主窗依然无 Cuu 本体。

## 7. R4 Web 产品化

目标：把 Web 从预览壳补成真实产品界面。

优先页：

| 页面 | 必做 |
|---|---|
| `/` | attention workspace，只递一件最需要判断的事 |
| `/intake/:id` | option-first 控件全量接入，free text 折叠 |
| `/workitems/:id` | 真实状态、验收项、trace、proposal timeline |
| `/proposals/:id` | 多类型交付物变更包，文档/PPT/表格/图片/文件夹 |
| `/agent-runs/:id/replay` | 真实 AgentStep/Snapshot/Audit 回放 |
| `/dashboard/cost` | P-COST 真实 usage 与 BudgetNotice |
| `/approvals` | 正确 approver、理由回灌、委派/记住规则入口 |

每页四态：

- loading：短文案/局部 skeleton，不阻塞整页。
- empty：说明没有当前事项，并给下一步入口。
- error：错误人话 + retry。
- forbidden：说明无权限 + 申请/返回入口。

R4 验收：

- 高频页四态都有截图或 Playwright smoke。
- 页面接真实多场景数据，不再只有“客户周报”单硬编码。
- zh-CN/en-US 截图通过，Rust 系统串纳入 locale contract。
- 主窗口无 Cuu 本体。

## 8. 模块开工前阅读清单

| 模块 | 必读文档 | 必读概念/证据 |
|---|---|---|
| AgentRun DB | `agent-loop-and-tools.md`、本篇 R1、`api-contract.md` | `r0-r4-recovery-roadmap.svg` |
| Proposal / Review | `branch-proposal-merge.md`、`review-and-approval.md`、`requirements-workitem.md` | `web-deliverable-change-request.png` |
| Replay / Eval | `_agent-eval-replay-plan.md`、`explainability.md` | `web-real-ui-gap-roadmap.png` |
| Push / broker | `system-architecture.md`、`api-contract.md`、本篇 R2 | `endpoint-page-cuu-alignment.png` 当前版本：页面与 CuuState 分离，Cuu 只在 pet window |
| Web 页面 | `web-app.md`、`page-concepts.md`、本篇 R4 | Web concept atlas + `r0-governance-boundary-concept.svg` |
| Cuu | `cuu-desktop-pet-concept.md`、`cuu-live2d-cat-options-current-plan.md`、本篇 R3 | Cuu 黑/白 Live2D 三张专图；旧橘猫图只作失败证据 |
| Rust shell | `desktop-pet-tauri.md`、`current-state-visual-audit-*` | desktop gap roadmap + pet motion reports |

## 9. 提交与验证纪律

每完成一个模块：

1. 审查是否符合本篇、PRD、概念图。
2. 更新对应计划文档和验收证据。
3. 运行相关 typecheck/test；有 UI 或桌宠变化时补截图/录屏/DOM report。
4. `git diff --name-only` 确认无 `reference/` / `references/`。
5. 提交并推送 `main`。

本轮文档补齐验收：

- 本篇进入 README 与 roadmap。
- 新 R0 概念治理图进入 `page-concepts.md`。
- `mid` 权威枚举改为 `medium`。
- `git diff --check` 通过。
