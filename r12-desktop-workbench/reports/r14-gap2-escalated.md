# R14 GAP-2 完成汇报（work_items.escalated 死状态接线）

日期: 2026-07-14 · 执行: Claude · 分支: `r14/gap2-escalated-status`（基线 `adb241b4`，拉自 `origin/main`）
来源: R14 FIX 批第 2 项，立案自 memory `attention-queue-coverage-and-escalated-status-gap.md`
（2026-06-16 审计：「没有任何代码把 work_items.status 置为 escalated——纯死枚举」）。

## 结论先说：GAP-2 已经在别的批次里修完了，本批只补测试

调查结论：立案当天记录的坑（agent-run-confidence.ts 只写 escalation_event、工单仍停
ai_working；escalation_events.resolvedAt 从没被设过）在**审计后第二天**就被
`09cb30b2 fix(r2): B-LOOP-1 core-loop work-item state transitions (H8/H9 + proposal-fail)`
（2026-06-17）修掉了，随后 R12 波次一（`d3fcc71f fix(r12): close wave-1 functional review gaps`
及其前置的一串 `fix(escalations)/fix(api)/fix(agent-army)` 提交，A2/A3 编号）又把 resolve 侧的
行动卡回写、委派、预算决策补齐。截止本批开工，施工契约里要求的 5 条能力**已经全部存在且被测试
覆盖**：

1. **升级创建 → 工单置 escalated（CAS + 终态跳过 + best-effort）**
   `apps/api/src/services/agent-run-confidence.ts:213-250`：置信度记录器开出升级事件后（且本次
   run 不会同时开一个可审阅提议，`proposalWillOpen` 为假），调用注入的
   `transitionWorkItemStatus({ workItemId, to: "escalated", at })`，包在 `try/catch` 里只
   `logger.warn`，从不让升级创建本身失败。CAS 守卫在仓库层：
   `packages/db/src/repositories/work-items.ts:288-292` 的 `transitionWorkItemStatus`——只有当前状态
   是 `to` 在 `allowedWorkItemTransitions` 里的合法前驱才写（`ai_working→escalated`），否则 0 行
   no-op（终态/已被并发迁走都安全跳过，不报错）。
   另有一条独立入口：`conversation-observer.ts` 的「决议」类行动卡条目（AI 拿不准要人拍板）在
   `dispatchDecideItem` 里直接以 `status: "escalated"` 创建工作项（出生即 escalated），同时开一条
   `escalation_events` 记录，`handoffJson` 带 `action_card_item_id` 供 resolve 时回写行动卡。
   *（有意不这么做的两处，均有代码注释说明是架构决策而非疏漏：`human-reserved-guard.ts` 高风险工具
   调用直接 `ai_working→pm_mode`（需要立即人工接管，跳过「AI还在等」的 escalated 语义）；
   `task-dispatcher.ts` 的军团/任务计划级升级是切片级的——见 `packages/contracts/src/enums.ts:28`
   注释「军团升级是切片级的（其他子任务可能还在健康跑），工单不整体置 escalated」。）*

2. **resolve 两分支回写**（`apps/api/src/services/escalations.ts:129-137` + 仓库层
   `packages/db/src/repositories/confidence.ts:402-648`）：`retry→ai_working`、
   `pm_mode→pm_mode`、`cancel→cancelled`，同一事务里按 CAS 守卫迁移工单状态；`escalated` 在
   `allowedWorkItemTransitions` 里的合法后继正好是这三个（`enums.ts:31`），语义严丝合缝。

3. **幂等**：`resolveEscalation` 的 UPDATE 带 `WHERE resolvedAt IS NULL`，第二次调用命中 0 行返回
   `null`；service 层 `resolve()` 据此抛 `EscalationServiceError(409, "escalation_race", ...)`，不
   二次迁移、不裸 500。

4. **决策队列接线**：`GET /api/pages/attention` 早就从 `listUnresolvedEscalationsForWorkspace`
   （查 `escalation_events` 而非 `work_items.status`）装配 `kind: "escalation"` 卡片，排在决策队列
   最前（`apps/api/src/pages/attention.ts:7-14` 的 `decisionKindRank`），三个动作（让它重试/转成我来做/
   取消这个子任务）分别打向 `/api/escalations/:id/resolve`。`packages/ui/src/gold-path/route-components.ts:1322`
   已把 `"escalation"` 纳入统一的风险卡渲染分支，无需新开 UI 分支。
   端到端验证见真库冒烟 `apps/api/src/qa/r1-pg-agent-run-smoke.ts:983-1069`（R9 escalation smoke：
   造一条 `status: "escalated"` 的工单 + 一条未解决 `escalation_events` 行，断言 attention 页面吐出
   对应卡片，POST resolve 后工单回 `ai_working` 且 `resolvedAt` 落库）。

对照施工契约逐条打勾：第 2/3/4 条能力代码均已存在，第 5 条中文文案/无 emoji 早已满足（`escalations.ts`
里 `actionSummary`/`budgetDecisionSummary` 等函数全中文人话，web 侧无 "Cuu" 字样——`escalationActions`
等函数只输出「让它重试/转成我来做/取消这个子任务」）。**没有发现需要迁移文件的缺口**，`escalated`
枚举值和 transition 表在 `packages/contracts/src/enums.ts` 里从最初就存在，本批未触碰任何迁移文件。

## 本批实际做的事：补测试盲区

代码本身对，但覆盖有系统性漏洞——「CAS 落空」「重复调用」这类竞态分支只在最初写代码的那次 PR
里被验证过一半，后续没人回头把镜像场景（谁赢/谁输）都补齐。逐一列出并补上：

1. **`apps/api/src/services/agent-run-confidence.test.ts`**（+2 用例）：
   这个文件此前**没有任何一条用例**调用过 `transitionWorkItemStatus` 这个缝隙——19 条既有用例全部
   聚焦模式五档红线，用的 `proposalWillOpen: true` 路径，天然跳过状态迁移分支；真实的
   H9 wiring 只在 `apps/api/src/agent-runs.test.ts` 里跟 agent-runner 其余流程混着间接跑过。
   新增：①正常路径——`proposalWillOpen:false` + grade=1(escalate) 时真的调用了
   `transitionWorkItemStatus({ to: "escalated" })`；②best-effort——`transitionWorkItemStatus` 拒绝
   （模拟工单已终态导致 CAS 落空/DB 抖动）时，升级创建仍然返回 `escalationId`，不被拖垮。
2. **`packages/db/src/confidence.test.ts`**（+2 用例）：`resolveEscalation` 的 task-plan
   分支（pm_mode taskPlanAction）早有对应的「工单不能转移→抛 conflict」用例
   （`"B-R9.0 pm_mode surfaces a conflict when the work item cannot transition"`），但**最常见的
   plain（非任务计划）分支**——单个工作项升级走 retry/pm_mode/cancel 的日常路径——两处 CAS 守卫
   （`escalation_events.resolvedAt IS NULL`、`work_items.status IN (合法前驱)`）只测过 happy path
   （`"R9.7 escalation resolution mutations are fenced by workspace"`）。新增：①重复 resolve 命中
   0 行返回 `null` 且不再碰 `work_items`（真幂等）；②工单已离开合法前驱态时抛
   `escalation_status_transition_conflict`。
3. **`apps/api/src/services/escalations.test.ts`**（+2 用例，含给 `MemoryEscalationRepository`
   加两个可选的竞态模拟开关 `raceOnResolveAfter`/`resolveConflict`）：service 层把仓库返回的
   `null`/`escalation_status_transition_conflict` 翻译成 409 `escalation_race`/
   `escalation_status_conflict` 这段 catch 逻辑此前完全没有测试断言过——之前只测过三个动作到目标
   状态的正向映射。新增两条覆盖这两条转译路径，均验证 `EscalationServiceError` 的 `status`/`code`。

## 验收

```
pnpm --filter @workhub/db test    → 280 tests, 278 pass, 2 skip(real-PG matrix), 0 fail
pnpm --filter @workhub/api test   → 1205 tests, 1204 pass, 1 skip, 0 fail
pnpm --filter @workhub/ui test    → 144 tests, 144 pass, 0 fail（未改动 UI，回归确认）
pnpm -r typecheck                 → 16/17 workspaces, 0 错误
git status                        → 只有本批新增的 3 个测试文件被改，无范围外改动
```

新增 6 条用例全部以 `R14 GAP-2` 前缀命名，均已在上面各 test 命令输出里逐条核对过 `ok`。

## 缺口 / 未做

- 未发现需要生产代码改动的真实缺口——GAP-2 描述的核心机制已由 `09cb30b2` + R12 波次一实现并被
  真库冒烟验证。若后续要扩展，唯一潜在的产品讨论点是：`task-dispatcher.ts`（军团切片级升级）与
  `human-reserved-guard.ts`（高风险工具直转 pm_mode）目前都**不**把工单标记为 `escalated`——这是
  已有代码注释明确记录的架构决策（切片级 vs 整单级、需要立即接管 vs 需要人判断），本批判断不属于
  GAP-2 范畴，未改动，仅在此记录供后续批次参考。
- 建议：`attention-queue-coverage-and-escalated-status-gap.md` 这条 memory 已经是 27 天前的过期快照
  且核心结论已被后续提交推翻，后续若有 agent 依赖它立案，应先按本汇报核实再动手，避免重复"发现"
  一个已经修完的问题。

## 提交

```
d4c59a98 test(gap2): cover escalated-status CAS races and resolve idempotency
```
