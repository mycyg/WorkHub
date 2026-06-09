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
| Proposal DB-backed | 默认 `ProposalService` 已写 `branches/proposals/reviews`；merge 已写 `work_items/main_branch_id`、merge snapshot、persistent audit、accepted deliverable ledger，并对 AgentRun-backed delivery 写入最小 `ProjectDriveItem/Version` 正式文件版本；R1.8 已补最小正式交付物还原入口；R1.9 已补 deterministic 冲突卡片 API 与显式采纳 incoming payload；R1.10 已补 Web/Desktop/Cuu option-first 冲突卡渲染与 payload merge；R1.11 已补 `merge_attempts` 持久表与 blocked/merged 尝试审计 | 仍未接完整 Drive 富预览/历史/redo UI，也未做 LLM 融合候选、`MergeProposal` 表和多冲突逐项选择历史 |

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
   - 剩余：完整 permission policy routing、审批中心持久 `ApprovalRequest`、LLM 冲突调解候选与 `MergeProposal` 表仍未完成；R1.9 已先落 deterministic 两选一 API，R1.10 已接端侧按钮，R1.11 已接尝试审计。

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
- 未完成：BudgetPolicy 持久化与审计、LLM 冲突调解候选/`MergeProposal`、完整 approval policy routing 仍未完成。R1.9 已关闭“冲突只能裸 409、用户无法点选处理”的最小缺口，R1.11 已关闭“冲突选择没有持久尝试审计”的缺口。

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
- `MergeProposal` 表与 AI 候选生成。
- LLM 融合候选与 `MergeProposal` 持久表仍未落；`/api/workitems/{id}/conflicts` API 已由 R1.9 落最小 deterministic 两选一版本，Web/Desktop/Cuu option-first UI 已由 R1.10 接入，`merge_attempts` 与 chosen incoming target 审计已由 R1.11 接入。
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

R1.6 已补最小下载/文本预览读取面，R1.7 已把正式交付物接入 AgentRun replay，R1.8 已补最小 restore 执行入口，R1.9 已补最小冲突卡片 API 与显式采纳 incoming，R1.10 已补 Web/Desktop/Cuu option-first 冲突卡，R1.11 已补 `merge_attempts` 与选择审计。仍不是完整 Drive 产品化：当前没有二进制/Office 预览渲染、没有 redo/多文件历史 UI、没有云对象存储 adapter，也没有 LLM 融合候选、`MergeProposal` 表和多冲突逐项选择历史。

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

- `@workhub/contracts` typecheck 与 15/15 tests 通过；新增 contract test 验证 conflict option payload 可被 `mergeProposalRequestSchema` 接受。
- `@workhub/api-client` typecheck 与 8/8 tests 通过；新增 client 路径断言。
- `@workhub/api` typecheck 与 67/67 tests 通过；新增 service/route test 覆盖“无 resolution 409 -> 读取 conflicts -> 带 target key 二次 merge 成功”。
- `@workhub/db`、`apps/web`、`apps/desktop-webview` typecheck 通过。

仍未完成：

- `MergeProposal` 持久表、LLM 候选与多冲突逐项选择历史。
- LLM 融合候选：STRUCT/DOC_TEXT 的 base/ours/theirs prompt、候选 rationale、推荐项与降级枚举。
- Web / Desktop / Cuu 冲突卡真实 UI 接入已由 R1.10 补齐：主界面可把 `details.conflicts` 渲染为按钮卡，Cuu card action 可携带同一 `request_json` 走 proposal merge。
- 非 delivery change 的结构化字段级合并、文本 diff3、二进制“两份都留”自动改名。

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

- `MergeProposal` 持久表、LLM 候选与多冲突逐项选择历史。
- LLM 融合候选：STRUCT/DOC_TEXT 的 base/ours/theirs prompt、候选 rationale、推荐项与降级枚举。
- 非 delivery change 的结构化字段级合并、文本 diff3、二进制“两份都留”自动改名。
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

- `MergeProposal` 表与 LLM 融合候选生成：STRUCT/DOC_TEXT 需要 base/ours/theirs prompt、candidate rationale、recommended option 与 chosen option。
- 多冲突逐项选择历史：当前 `accepted_target_keys` 可记录多个 key，但 UI 仍是每个 conflict card 自带单 key payload，不是完整冲突工作台。
- 非 delivery change 的字段级三方合并、文本 diff3、二进制“两份都留”自动改名。
- Replay 页面尚未显式展示 merge attempt timeline；当前数据已落库，展示面后续补。

### R1.3 P0.5 fixture 生产分支迁出（2026-06-08）

已落代码切片：

- `apps/api/src/routes/agent-runs.ts` 删除 `allowP05ReplayFixture` 和 P0.5 replay fallback。
- `apps/api/src/routes/proposals.ts` 删除 P0.5 proposal/review/merge 分支，所有读写都走 `ProposalService`。
- `apps/api/src/routes/pages.ts` 只保留 `/api/pages/gold-path` demo bundle；`/api/pages/proposals/:id` 只读真实 proposal；`/api/pages/workitems/:id` 读取真实 `WorkItemService`。
- `apps/api/src/routes/sessions.ts`、`workitems.ts`、`knowledge.ts` 已接入真实 `WorkItemService`，避免用固定 fixture 冒充产品链路。
- `apps/api/src/pages/gold-path.ts` 删除未使用的 `isP05*` id matcher，减少误接回生产 route 的风险。
- `apps/api/src/services/work-items.ts` 新增 R1 最小真实 service；`packages/db/src/repositories/work-items.ts` 新增 DB repository；`apps/api/src/qa/r1-pg-agent-run-smoke.ts` 将 intake/knowledge/page 纳入 smoke。
- `apps/api/src/workers/agent-runner.ts` 串行化同一 run 的 trace persistence，避免 background trace 与 final trace 在真实 PG 下抢写 `agent_steps`。
- `packages/db/src/repositories/cost-ledger.ts` 新增 DB-backed `CostLedgerStore`；`apps/api/src/services/cost-ledger-store.ts` 的生产默认 store 已切 DB，`createInMemoryAgentRunQueue()` 仍默认内存 ledger 以保留单元测试隔离。
- `packages/db/migrations/0003_amused_raider.sql` 新增 `usage_records` 与 `cost_ledger_entries`，幂等键为 `usage_record_id + scope_kind + scope_id + period_bucket`。

验证：

- `rg -n "isP05|p05GoldPathIds|getP05GoldPathFixture|allowP05ReplayFixture|P0\\.5" apps/api/src/routes apps/api/src/openapi.ts -S` 只剩 `/api/pages/gold-path` 的 OpenAPI 摘要。
- `pnpm --filter @workhub/api typecheck` 通过。
- `pnpm --filter @workhub/api test` 通过，当前 66/66；新增测试确认生产 route 对 P0.5 fixture route set fail-closed，并覆盖正式交付物 restore route。
- `pnpm --filter @workhub/cost test` 通过，当前 8/8；`pnpm --filter @workhub/db test` 通过，当前 10/10；`pnpm db:check` 与 `pnpm audit:migrations` 通过。

仍不能宣称 R1 全部完成，因为 BudgetPolicy 持久化与审计、AI 冲突调解、完整 approval policy routing 仍未落地。

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
