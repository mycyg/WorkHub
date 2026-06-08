---
module: 06-roadmap
layer: recovery / governance / execution order
status: active
owner: workflow
date: 2026-06-08
source_review: D:/workhub审查报告
visuals:
  - ../05-clients/assets/shared/r0-r4-recovery-roadmap.svg
---

# R0-R4 纠偏施工路线

> 本篇把 `D:/workhub审查报告` 的 Claude 审查结论收进仓库文档树，作为 2026-06-08 之后的施工优先级。它不替代 PRD，而是修正当前执行顺序：先止血对账，再证明真实纵切，最后再回到 Cuu 与 Web 产品化。

![R0-R4 recovery roadmap](../05-clients/assets/shared/r0-r4-recovery-roadmap.svg)

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
| R0-2 概念治理 | 旧 `2026-06-07-current-state` 橘猫截图判为 stale/fail；shared 旧橘猫概念图标记待替换；主窗口无 Cuu 本体作为截图验收门。 | `prd-concept-reproduction-gap-audit.md`、`current-state-visual-audit-*`、`page-concepts.md` |
| R0-3 命门拍板 | `confidence-risk-escalation.md` 锁定 v1 owner、policy_version、阈值、风险维度默认值；`07-open-questions.md` 更新 OQ-2/OQ-3。 | `02-ai-engine/confidence-risk-escalation.md`、`07-open-questions.md` |
| R0-4 文档去 drift | D-1 正名为“参考 Python 行为的 TS-first 重写”；F03 迁移路线收敛到 Drizzle Kit；实体数、`medium` 枚举口径收敛。 | README、`phasing-p0-p5.md`、后续 plans 清理 |

R0 退出门：

- 主窗口截图和概念图入口不再把 Cuu 身体当作严肃工作界面元素。
- 旧橘猫截图只作为“失败样例/历史审计”，不再作为当前通过证据。
- OQ-2/OQ-3 有 v1 owner 和可执行默认值。
- 文档树明确后续施工顺序为 R0 -> R1 -> R2 -> R3 -> R4。

## 2. R1 真实纵切

目标：把“AI 干、人把关”的反转第一次用真实数据证明。

| 步骤 | 必须做什么 | 验收证据 |
|---|---|---|
| R1-0 Queue pump | `POST /workitems/:id/agent-runs` 后 daemon 自动 drain queue，不靠测试手动 `runNext()`。 | run 状态自动 `queued -> running -> terminal` |
| R1-1 接缝 | `AgentLoopResult.manifest` 传给 `ProposalService.createFromManifest`，真实 run 成功后自动 opened proposal。 | `GET /workitems/:id/proposals` 返回真实 run 产物 |
| R1-2 PG 持久化 | AgentRun、AgentStep、Proposal、CostLedger 从内存 Map 切到 PostgreSQL repo。 | 重启后 replay/proposal/run 仍可查 |
| R1-3 删除 fixture 生产分支 | `isP05*` 只保留测试夹具，不出现在生产路由判断。 | 生产路由 grep 清零 |
| R1-4 审批人路由 | 自审批 stub 改为 WorkItem owner / 项目负责人 / permission routing。 | escalation 或 review 发给正确 approver |

R1 退出门：

- 一条真实 file-only work_item 端到端跑通：intake -> AgentRun -> manifest -> Proposal -> approve/reject -> merge -> Replay。
- 数据落 PostgreSQL，daemon 重启后不丢。
- ReplayTraceVM 来自真实 run/step/snapshot/audit，不是 fixture。
- 快照红线、provider 单出口、预算计量不回退。

## 3. R2 真正解除单 worker

目标：兑现 P0 地基存在的理由：多 worker / 多实例下不脑裂、不丢 SSE、不泄漏事件。

| 步骤 | 必须做什么 | 验收证据 |
|---|---|---|
| R2-1 PG 队列 claim | `SELECT ... FOR UPDATE SKIP LOCKED` claim queued run，去掉进程内 Map/Set 抢任务。 | 并发 enqueue 同 work_item 只执行一次 |
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
