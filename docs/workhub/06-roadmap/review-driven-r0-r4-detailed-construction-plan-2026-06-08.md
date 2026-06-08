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
| Proposal DB-backed | 默认 `ProposalService` 已写 `branches/proposals/reviews` | merge 还未完整写 main 状态和真实 rollback |

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
   - 剩余：把 replay 依赖的 merge/main 状态做实，避免只靠 proposal 状态与 merge snapshot id。
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
   - `apps/api/src/services/proposals.ts` 禁止未确认 proposal 直接采纳，未 `reviewed` 会返回 `proposal_not_reviewed`。
   - `apps/api/src/workers/agent-runner.ts` 不再硬编码 `approverUserId=run.actor_id`；新增 `notificationWorkItem` resolver，默认通过 DB WorkItem context 读取 submitter/project owner/assignee，再交给 lifecycle approver fallback。
   - `packages/contracts/src/enums.ts` 已补齐 `branch.status=proposed/superseded`，与文档和现有 repository 写入值对齐。
   - 剩余：完整 permission policy routing、审批中心持久 `ApprovalRequest`、merge audit repo 持久化、文件物理采纳、冲突调解、revert 仍未完成。

### R1 验收

- 一条 file-only work item 经真实 route 跑完，产生 DB `agent_run`、`agent_steps`、`proposal`、`review`、`audit`、`snapshot`。
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
- 未完成：CostLedger 默认 store、merge 的文件物理采纳、冲突调解、audit repo 持久化、完整 approval policy routing 仍未完成。

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
13. 输出 JSON 证据：intake/evidence/page evidence、`agent_runs`、`agent_steps`、`proposals`、`branches`、`snapshots`、`audit_logs` 行数、merge 状态与 replay 计数。

当前本机实测：

- `pnpm qa:r1-pg-smoke` 可加载脚本，但因 `127.0.0.1:5432` 无 PostgreSQL 返回 `ECONNREFUSED`。
- 本机 `docker` 与 `psql` 不在 PATH，无法在 Windows 本机直接拉起或检查 PG。

Linux 测试机通过证据（`192.168.5.53`，Ubuntu，PostgreSQL 18.4，当前工作树 patch）：

```json
{
  "ok": true,
  "work_item_id": "b9e30126-5d19-4ac7-8061-1600c4b00955",
  "run_id": "fe4df610-c877-4aea-bdf3-03e99dc27c18",
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
    "snapshots": 1,
    "audit_logs": 1
  },
  "merge": {
    "proposal_status": "merged",
    "branch_status": "merged",
    "work_item_status": "merged",
    "main_branch_id": "8cb85cde-57fd-4257-bce4-6e0d06d6698c",
    "merge_snapshot_id": "dd1b46ef-a066-43e9-84e0-d886682e104a"
  },
  "replay_steps": 4,
  "replay_snapshots": 1,
  "replay_audit_logs": 1
}
```

结论：R1 的“真实 PostgreSQL restart 后 run/replay 可读回”缺口已关闭；最小 intake -> work item -> knowledge evidence -> page VM -> AgentRun -> proposal -> merge -> replay 纵切已由 Linux PG smoke 验证通过。

### R1.3 P0.5 fixture 生产分支迁出（2026-06-08）

已落代码切片：

- `apps/api/src/routes/agent-runs.ts` 删除 `allowP05ReplayFixture` 和 P0.5 replay fallback。
- `apps/api/src/routes/proposals.ts` 删除 P0.5 proposal/review/merge 分支，所有读写都走 `ProposalService`。
- `apps/api/src/routes/pages.ts` 只保留 `/api/pages/gold-path` demo bundle；`/api/pages/proposals/:id` 只读真实 proposal；`/api/pages/workitems/:id` 读取真实 `WorkItemService`。
- `apps/api/src/routes/sessions.ts`、`workitems.ts`、`knowledge.ts` 已接入真实 `WorkItemService`，避免用固定 fixture 冒充产品链路。
- `apps/api/src/pages/gold-path.ts` 删除未使用的 `isP05*` id matcher，减少误接回生产 route 的风险。
- `apps/api/src/services/work-items.ts` 新增 R1 最小真实 service；`packages/db/src/repositories/work-items.ts` 新增 DB repository；`apps/api/src/qa/r1-pg-agent-run-smoke.ts` 将 intake/knowledge/page 纳入 smoke。
- `apps/api/src/workers/agent-runner.ts` 串行化同一 run 的 trace persistence，避免 background trace 与 final trace 在真实 PG 下抢写 `agent_steps`。

验证：

- `rg -n "isP05|p05GoldPathIds|getP05GoldPathFixture|allowP05ReplayFixture|P0\\.5" apps/api/src/routes apps/api/src/openapi.ts -S` 只剩 `/api/pages/gold-path` 的 OpenAPI 摘要。
- `pnpm --filter @workhub/api typecheck` 通过。
- `pnpm --filter @workhub/api test` 通过，当前 60/60；新增测试确认生产 route 对 P0.5 fixture route set fail-closed。

仍不能宣称 R1 全部完成，因为 CostLedger 默认 store、文件物理采纳、冲突调解、完整 approval policy routing 仍未落地。

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
