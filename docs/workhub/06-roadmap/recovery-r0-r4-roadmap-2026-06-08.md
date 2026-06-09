---
module: 06-roadmap
layer: recovery / governance / execution order
status: active
owner: workflow
date: 2026-06-08
source_review: D:/workhub审查报告
visuals:
  - ../05-clients/assets/shared/r0-r4-recovery-roadmap.svg
  - ../05-clients/assets/shared/r0-governance-boundary-concept.svg
  - ../05-clients/assets/shared/ts-first-runtime-concept.png
  - ../05-clients/assets/shared/endpoint-page-cuu-alignment.png
  - ../05-clients/assets/shared/prd-concept-gap-map.png
  - ../05-clients/assets/shared/shared-component-atlas.png
---

# R0-R4 纠偏施工路线

> 本篇把 `D:/workhub审查报告` 的 Claude 审查结论收进仓库文档树，作为 2026-06-08 之后的施工优先级。它不替代 PRD，而是修正当前执行顺序：先止血对账，再证明真实纵切，最后再回到 Cuu 与 Web 产品化。逐项领取与验收细节见 [`review-driven-r0-r4-detailed-construction-plan-2026-06-08.md`](./review-driven-r0-r4-detailed-construction-plan-2026-06-08.md)。

![R0-R4 recovery roadmap](../05-clients/assets/shared/r0-r4-recovery-roadmap.svg)

![R0 governance boundary](../05-clients/assets/shared/r0-governance-boundary-concept.svg)

## 0. 新铁律

| 铁律 | 说明 | 验收 |
|---|---|---|
| 冻结 Cuu 外观 | R1 真实纵切通过前，不再新增桌宠形象、动效、设置矩阵、截图矩阵、模型改色。仅允许 R0 治理修正：去橘猫、主窗无 Cuu、透明 pet smoke、文档对账。 | Cuu 相关新任务必须标 `deferred-until-R1`，除非直接修治理违规 |
| fixture 不算完成 | Gold Path、Replay、Proposal、Cost、Approval 只有走真实 AgentLoop、真实服务、真实持久化，才可宣称跑通。 | 生产路由不得用 `isP05*` / hardcoded manifest 作为完成证据 |
| 先证一条真实需求 | 下一个产品价值目标只有 R1：一条需求从 intake 到 AgentRun、manifest、Proposal、approve/merge、Replay 全链路落 PostgreSQL，重启不丢。 | R1 验收必须有运行命令、DB 证据、重启后查询证据 |
| TS-first 是当前现实 | 旧 Python/FastAPI 路径只能作为行为锚点；实现计划以 TS/Hono/Drizzle/contracts 为主。 | F01-F11 与 README 需标注 TS-first 权威路径 |

## 1. R0 止血与对账

目标：让计划、代码、概念图、截图证据重新对齐，避免继续在错误优先级上投入。

| 项 | 施工内容 | 当前落点 |
|---|---|---|
| R0-1 范围冻结 | README、Cuu 文档、roadmap 明确“R1 前冻结 Cuu 外观”。 | 本篇、README、`cuu-desktop-pet-concept.md` |
| R0-2 概念治理 | 旧 `2026-06-07-current-state` 橘猫截图判为 stale/fail；4 张 shared PNG 已原位替换为黑/白 Live2D 与“主窗无 Cuu”口径；主窗口无 Cuu 本体仍作为截图验收门。 | `prd-concept-reproduction-gap-audit.md`、`current-state-visual-audit-*`、`page-concepts.md` |
| R0-3 命门拍板 | `confidence-risk-escalation.md` 锁定 v1 owner、policy_version、阈值、风险维度默认值；`07-open-questions.md` 更新 OQ-2/OQ-3。 | `02-ai-engine/confidence-risk-escalation.md`、`07-open-questions.md` |
| R0-4 文档去 drift | D-1 正名为“参考 Python 行为的 TS-first 重写”；F03 迁移路线收敛到 Drizzle Kit；实体数、`medium` 枚举口径收敛。 | README、`phasing-p0-p5.md`、后续 plans 清理 |

R0 退出门：

- 主窗口截图和概念图入口不再把 Cuu 身体当作严肃工作界面元素。
- 旧橘猫截图只作为“失败样例/历史审计”，不再作为当前通过证据；shared 概念图当前版本已不含橘猫。
- OQ-2/OQ-3 有 v1 owner 和可执行默认值。
- 文档树明确后续施工顺序为 R0 -> R1 -> R2 -> R3 -> R4。

## 2. R1 真实纵切

目标：把“AI 干、人把关”的反转第一次用真实数据证明。

| 步骤 | 必须做什么 | 验收证据 |
|---|---|---|
| R1-0 Queue pump | `POST /workitems/:id/agent-runs` 后 daemon 自动 drain queue，不靠测试手动 `runNext()`。 | **2026-06-08 已落代码切片**：默认 route 会调用 `queue.run(run_id)` 自动 pump，测试覆盖 POST 后无需 `runNext()` 也能 `queued -> succeeded`。 |
| R1-1 接缝 | `AgentLoopResult.manifest` 传给 `ProposalService.createFromManifest`，真实 run 成功后自动 opened proposal。 | **2026-06-08 已落代码切片**：`apps/api/src/workers/agent-runner.ts` 成功 run 会打开 proposal 并发布 `proposal.opened`；`apps/api/src/agent-runs.test.ts` 覆盖真实 AgentLoop manifest。下一步仍需用真实 route/DB 端到端验收。 |
| R1-2 PG 持久化 | AgentRun、AgentStep、Proposal、CostLedger、BudgetPolicy 从内存 Map 切到 PostgreSQL repo。 | **2026-06-09 已落最小真实切片**：`packages/db/src/repositories/proposals.ts` + DB-backed `ProposalService` 已接 `branches/proposals/reviews`；`packages/db/src/repositories/agent-runs.ts` + `apps/api/src/services/agent-run-persistence.ts` 已支持 AgentRun/AgentStep write-through 与 DB fallback；`packages/db/src/repositories/cost-ledger.ts` + `usage_records/cost_ledger_entries` 已支持默认 DB-backed CostLedger；`packages/db/src/repositories/budget-policies.ts` + `budget_policies` 已支持 BudgetPolicy override 持久化与 `budget_policy.updated` 审计；真实 PG restart/replay/cost smoke 已覆盖。 |
| R1-3 删除 fixture 生产分支 | `isP05*` 不出现在生产路由判断；没有真实 service 的 route 失败关闭。 | **2026-06-08 已落代码切片**：生产 routes grep 清零，仅 `/api/pages/gold-path` 保留 demo bundle。 |
| R1-4 审批人路由 | 自审批 stub 改为 WorkItem owner / 项目负责人 / permission routing。 | **2026-06-08 已落最小真实切片**：AgentRun 通知新增 DB WorkItem context resolver，默认读取 submitter/project owner/assignee 并交给 lifecycle approver fallback；`packages/events` 覆盖 project owner fallback。完整 permission policy routing 仍属 R2/R3 审批中心。 |
| R1-5 Intake/WorkItem/Knowledge/Page VM | `sessions/workitems/knowledge/pages/workitems` 从 501 失败关闭升级为真实最小服务。 | **2026-06-08 已落代码切片**：`apps/api/src/services/work-items.ts` + `packages/db/src/repositories/work-items.ts` 接入 option-first intake、work item 创建/固化、knowledge evidence bubble、evidence binding、WorkItemDetailVM；API test 与 Linux PG smoke 已覆盖。 |

R1 退出门：

- 一条真实 file-only work_item 端到端跑通：intake -> AgentRun -> manifest -> Proposal -> approve/reject -> merge -> Replay。
- 数据落 PostgreSQL，daemon 重启后不丢。
- ReplayTraceVM 来自真实 run/step/snapshot/audit，不是 fixture。
- 快照红线、provider 单出口、预算计量不回退。

### 2.1 R1 当前代码状态（2026-06-10）

已完成的真实切片：

- `AgentLoopResult.manifest -> ProposalService.createFromManifest` 已由 queue 注入的 proposal sink 承接；成功 run 后发布 `workitem:{id}` 上的 `proposal.opened`，Cuu 状态为 `carrying_document`。
- 默认 `ProposalService` 已从内存实现切到 DB-backed lazy service，写入 `branches`、`proposals`、`reviews`；内存 service 只保留为测试/显式注入隔离用。
- `POST /workitems/:id/agent-runs` 默认自动 pump：route enqueue 后后台执行 `queue.run(run_id)`；测试用 `autoRun:false` 保留手动 queue 单元边界。
- AgentRun persistence 已落代码切片：`agent_runs` 补 `title/actor_user_id/budget_decision_json/workdir_ref/handoff_json` 等恢复字段，`agent_steps` 补 `seq` 并取消错误唯一约束；默认 queue 写穿透 DB，内存 miss 时可从 DB 读回 run/trace/workdir/listActive。
- AgentRun replay fixture fallback 已完全移出生产 route：`/api/agent-runs/:id/replay` 只读真实 queue/persistence/audit/snapshot，不再接受 `allowP05ReplayFixture`。
- P0.5 route set 已从生产业务 route 迁出：`sessions/workitems/knowledge/pages/workitems` 已改为 R1 最小真实 service；`pages/proposals` 与 `proposals/*` 只读真实 `ProposalService`；仅 `/api/pages/gold-path` 保留 demo bundle。
- CostLedger 默认 store 已从内存切到 DB-backed：`usage_records` 保存 provider 原始调用事实，`cost_ledger_entries` 按 workitem/user/team/eval scope 幂等归集；`/api/cost/usage` 与 `/api/pages/cost` 会从 DB 读取 ledger。
- BudgetPolicy 默认 store 已从内存切到 DB-backed：`budget_policies` 保存 v0 policy overrides；`PUT /api/cost/policies/:scope/:id` 写 `budget_policy.updated` 审计；内存 policy store 只保留为单元测试/显式注入隔离用。
- R1 PG smoke 入口已新增并在 Linux/CI PostgreSQL 上通过：`pnpm qa:r1-pg-smoke` 会跑 migrations、最小 seed、真实 intake/work item/knowledge/page route、DB-backed CostLedger/AgentRun/Proposal/Snapshot/Audit，并用新 queue 模拟 daemon restart 后读取 run/replay。2026-06-09 后 smoke 已覆盖正式交付物 v1 采纳、v2 同路径采纳、restore 回 v1、页面/预览/下载/replay 仍读 v1；R1.17 追加覆盖同 target conflict、`merge_proposal_id`、直接 apply `ai_fusion`、原 `merge_proposals.chosen_*`、accepted ledger、ProjectDriveVersion、audit 与 replay timeline；R1.18 追加覆盖 `budget_policies` override、`budget_policy.updated` audit、`/api/cost/usage` 与 `/api/pages/cost` 读取 DB policy；R1.19 追加覆盖 `text_doc` AI fusion 正文直写，正式 Drive version 不再带旧 Markdown/JSON 包装；R1.20 追加要求 one-click AI fusion 前必须读到 current/incoming 文本 context；R1.21 追加要求原始 `ai_fusion` candidate 持久化 `quality_gate.text_patch_preview`；R1.23 的 API test 已覆盖 409 与 `/conflicts` 把该 preview 透到 `ai_fusion` option；R1.24 的 API test 已覆盖无重叠文本 hunk 生成 `source="diff3"` candidate，且重叠 hunk 回退 LLM 且携带 R1.25 metadata；R1.29 追加覆盖 ready + executable `structured_record` 写回 WorkItem `title/summary_md/priority/due_at`、无 accepted deliverable ledger、`field_merge` audit 与 `structured_field_changes[]`；R1.30 追加覆盖 proposal 创建时捕获 base、人工并发改标题后 apply 返回 `structured_field_patch_conflict`、proposal 未 merged、chosen option 回滚、WorkItem 保持人工标题。GitHub Actions 已新增 `r1-pg-smoke` job 用 Postgres 16 service 持续执行。
- Proposal merge accepted ledger 已落：采纳时写 `accepted_deliverable_changes`、merge snapshot、persistent `proposal.merged` audit，并用 sha/version gate 阻断同 target 静默覆盖。
- AgentRun-backed delivery 正式文件落盘已落：merge 前从 `Branch.agent_run_id -> AgentRun.workdir_ref` 找源文件，校验 sha 后复制到正式 storage root，merge transaction 内写 `ProjectDriveItem/Version` 并把 `drive_item_id/drive_version_id` 写回 accepted row。
- 正式交付物读取面已落最小切片：`GET /api/pages/workitems/:id` 返回 `accepted_deliverables[]`，并提供正式文件 download 与文本 preview API；R1 PG smoke 已覆盖页面字段、预览与下载内容。
- 正式交付物还原入口已落最小切片：`AcceptedDeliverableVM.restore_href` 仅在有上一版时出现；`POST .../restore` 会恢复 `ProjectDriveItem.current_version_id`，切换 current accepted row，并写 Drive operation + audit。
- Proposal / Replay 字段级落点与审计渲染已落最小切片：`StructuredFieldPatchDryRun.patch.operations[]` 会在 Proposal 冲突卡显示 base/current/after；`proposal.merged.detail_json.structured_field_changes[]` 会在 Replay 严肃页显示 field_merge 写回审计，覆盖标量字段、`acceptance_items` 与 `task_items`。
- Proposal / Replay 真实 route 视觉 QA 已落最小切片：`pnpm qa:r1-route-visual` 会通过 Web 与 desktop webview surface 函数渲染 Proposal / Replay，生成 zh-CN/en-US、desktop/mobile-narrow、loading/empty/error/forbidden 四态截图，并 gate 富 patch viewer、长 patch 折叠、重叠 hunk review、子记录逐项 diff、多冲突折叠工作台、主窗无 Cuu、默认无重看板词与 `no_horizontal_overflow`。
- 任务子记录多计划/目标 plan 选择已落最小切片：`POST /api/merge-proposals/:id/apply` 支持 `task_plan_scope.target_plan_id`；Proposal 子记录编辑区可显示目标 plan 按钮；DB repository 在多 plan 无 scope 时返回 `task_plan_scope_required`，有 scope 时只重写目标 plan。
- 重叠文本 hunk 后端逐段 materialize 已落最小切片：`POST /api/merge-proposals/:id/apply` 支持 `text_hunk_overrides.hunks[]`；service 读取 full base/current/incoming/AI fusion 文本，按 `quality_gate.text_diff3.conflict_ranges[]` fail-closed 校验，逐段生成最终文本；DB repository 复用 accepted deliverable / Drive version / snapshot / merge attempt 链路，并在 `proposal.merged.detail_json` 写入 `text_hunk_overrides`、`text_hunk_decisions`、conflict ranges 与 base/current/incoming/output sha。
- 多冲突批量执行审计已落最小切片：`POST /api/proposals/:id/merge` 支持 `conflict_resolution.bulk_action`；批量 keep/accept 的 conflict 与 merged 两条路径都会写 `proposal.bulk_action`，成功 merge 的 `proposal.merged.detail_json` 也会带 `bulk_action` 摘要。
- 验证：`pnpm --filter @workhub/api typecheck`、`pnpm --filter @workhub/api test`、生产 route grep 审计已通过；API test 当前 86/86 通过。

仍不能宣称 R1 完成：

- AgentRun queue 的任务 claim/drainer 仍以内存 Map/Set 协调；R2 前还不能宣称多 worker 安全。
- Windows 本机 `pnpm qa:r1-pg-smoke` 因无本地 PostgreSQL (`ECONNREFUSED 127.0.0.1:5432`) 且无 Docker/psql 暂未跑通；这不再阻塞 R1，因为 GitHub Actions `r1-pg-smoke` job 和 Linux/CI PostgreSQL 给出真实 PG 通过证据。
- proposal merge/main 已落最小真实切片：DB repository 在 approve/reject/merge 时更新 `reviews/proposals/branches/work_items`；reject 解锁 branch，merge 写 `work_items.status=merged`、`main_branch_id`、`accepted_at` 与 branch head/version；accepted deliverable ledger、ProjectDriveVersion 最小采纳、WorkItem page / AgentRun replay accepted deliverables、download/text-preview、restore、merge snapshot、persistent audit、同 target 冲突 gate、AI fusion candidate、one-click apply、text/spec 正文直写、真实 current/incoming/base prompt context、text patch preview、Replay patch preview 渲染、Proposal 采用前最小 patch preview、无重叠文本 hunk deterministic diff3、重叠 hunk metadata/prompt/quality gate、replay 选择记录、WorkItem 标量字段写回、字段冲突检测、`acceptance_items` 子记录写回、最新 dispatch plan `task_items` 子记录写回、字段级 Proposal/Replay 落点与写回审计、Proposal 高级字段编辑器与 `structured_field_overrides`、Proposal / Replay 共享逐行富 patch viewer 基础、Proposal / Replay 重叠 hunk review 与逐段点选意图模板、子记录逐项 diff/editor 与 `structured_item_overrides`、Proposal 折叠多冲突批量检查 foundation、Web/Desktop route 视觉 QA、任务子记录多计划/目标 plan 选择 UI、重叠文本 hunk 后端逐段 materialize、批量 keep/accept `bulk_action` 审计、Replay hunk/bulk decision 用户可读回放、Proposal route line editor 已落。完整 Drive 产品化仍待后续 R2/R4。

下一施工顺序：

1. R2.1 已补：AgentRun PG claim/lease，包含 `FOR UPDATE SKIP LOCKED` claim、lease 字段、step heartbeat 与 stuck run requeue primitive；详见 [`../02-ai-engine/r2-agent-run-claim-lease.md`](../02-ai-engine/r2-agent-run-claim-lease.md)。
2. 继续 R2.2：多实例 pump、定时 heartbeat、`WORKHUB_WORKERS=2` 真实 smoke。

## 3. R2 真正解除单 worker

目标：兑现 P0 地基存在的理由：多 worker / 多实例下不脑裂、不丢 SSE、不泄漏事件。

| 步骤 | 必须做什么 | 验收证据 |
|---|---|---|
| R2-1 PG 队列 claim | **已落 R2.1**：`claimQueued()` / `claimNextQueued()` 使用 `FOR UPDATE SKIP LOCKED`，`queue.run(id)` 与 `runNext()` 都先 claim；进程内 Map/Set 降为本地缓存与测试 fallback。 | `@workhub/api` claim tests、`@workhub/db` schema test |
| R2-2 多实例 pump | 每个实例可跑 pump，靠 PG claim 协同；leader 任务用 Redis/PG lock。 | `WORKHUB_WORKERS=2` 跑 R1 链路 |
| R2-3 Redis bus/presence | PushBus / presence 默认跨 worker，修 unsubscribe 竞态。 | A 实例发布，B 实例订阅者收到 |
| R2-4 订阅边界 | `/api/push/stream` 全局 all 删除或 admin-only，资源 topic 强制 `can_view`。 | 非 owner 订阅他人 run/workitem/proposal 得 403 |
| R2-5 集成测试/CI | PG + Redis 五场景：SSE、stuck-job、CORS、revert、escalation。 | CI 或本地脚本全绿 |

## 4. R3 Cuu Agent 入口

目标：补 Cuu 真正属于 P1/P4 价值的能力：自然语言驱动 Agent，而不是继续做外观。

| 步骤 | 必须做什么 | 验收证据 |
|---|---|---|
| R3-1 出站输入 | 点 Cuu 出现真实输入/选项气泡；不是静态 input hint。 | DOM 有真实 input/textarea 或 option-first submit contract |
| R3-2 指令到 Agent | Cuu 输入复用 Web 同一 API：session/intake/workitem/agent-run/proposal。 | 一句话从 Cuu 触发真实 R1/R2 链路 |
| R3-3 回流闭环 | 进展经 SSE 回到 Cuu 卡片。 | Cuu 显示 pending/success/failure，人话可恢复 |

R3 禁止项：不新增模型、改色、动效、设置矩阵；黑猫/白猫 Live2D 仅作为现有运行时。

## 5. R4 Web 产品化与双语

目标：把 Web 从单场景预览壳变成真实产品界面。

| 步骤 | 必须做什么 | 验收证据 |
|---|---|---|
| R4-1 四态 | home/intake/workitem/proposal/replay/cost/approvals 都有 loading/empty/error/forbidden。 | 页面快照或 Playwright smoke |
| R4-2 真实数据 | 去除单硬编码“客户周报”假场景，接 R1 后端多 work_item/proposal。 | 多条真实数据渲染 |
| R4-3 设计语言 | 概念图和实现统一中文优先 + en-US 切换；主窗严肃、无 Cuu 本体。 | zh-CN/en-US 截图 |
| R4-4 Rust 系统串 i18n | Tauri tray、通知、错误、settings 系统串进入 locale contract。 | Windows/Linux/macOS smoke 文案一致 |

## 6. 已完成但降级为“冻结前证据”的 Cuu QA

本次审查前已经补了 P1.10 动效硬门：`scripts/qa/cuu-tauri-motion-capture.ps1` 新增 `motion_liveness`，并生成两组 32 帧证据：

| 场景 | 路径 | 结论 |
|---|---|---|
| Hijiki approval formal | `../05-clients/assets/audit/2026-06-08-cuu-live2d-cat-runtime/hijiki/approval-formal-liveness-p1-10/` | `motion_gate_passed=true`，DOM 合同匹配 |
| Hijiki look-only formal | `../05-clients/assets/audit/2026-06-08-cuu-live2d-cat-runtime/hijiki/look-only-formal-anchor-p1-10/` | `motion_gate_passed=true`，窗口 rect 稳定 |

这些证据只证明“现有黑猫运行时没有退回静态/漂移”；它们不改变冻结原则，不开启新的 Cuu 外观施工。

## 7. 后续提交纪律

- 每个模块开工前读本篇和对应模块文档。
- 每个模块完成后更新文档和验收证据。
- 不提交 `reference/` / `references/`。
- 若发现计划与真实代码冲突，以真实代码和本篇纠偏路线为准，先修计划再施工。
