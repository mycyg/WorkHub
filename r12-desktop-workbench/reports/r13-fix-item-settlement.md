# R13 修复：action_card_items.status 永远停在 running

日期: 2026-07-13 · 执行: Claude · 分支: `r13/fix-item-settlement`（基线 `63aa2bae`，拉自 `origin/main`，
与 `main` 完全同步）

来源: 批 S2 汇报（`r12-desktop-workbench/reports/r13-s2-async-cuu.md`）「范围外发现」第一条——
execute 类 `action_card_items.status` 只有手动撤销（`action-cards.ts` 的 `undo()`）会把它从
`running` 转出去；run 自然结算（`succeeded`/`failed`/`escalated`）时没有任何代码回写，条目在服务端的
权威状态永远卡在 `running`。

## 做了什么

1. **新模块 `apps/api/src/services/action-card-run-settlement.ts`**：run 终态 → `action_card_items`
   条目状态的唯一权威映射与结算 hook。

   | run 终态 | item 目标状态 |
   |---|---|
   | `succeeded` | `done` |
   | `failed` | `escalated` |
   | `escalated` | `escalated` |
   | `cancelled` | `undone` |

   写法照 `run-conversation-report.ts`（批 S2 先例）的同款取舍：
   - `fromStatuses` 恒为 `["running"]`，复用 `packages/db` 已有的 CAS 语义（`transitionItemStatus`），
     不新增任何仓库写面。
   - 没有 `source_action_card_item_id`（这次 run 不是从行动卡执行条目派发的）→ 直接跳过，不调用仓库。
   - 非终态（`queued`/`running`）→ 防御性跳过（理论上 settled hook 不会用这两个状态调用它）。
   - 缺 `workspace_id` → `warn` 一条结构化日志后跳过（不猜测租户）。
   - CAS 落空（返回 `null`，条目已经被别的动作转出 `running`）→ **安静的幂等 no-op，不是失败**，不额外
     记日志（避免把正常路径刷成噪音）。
   - 仓库调用本身抛错 → 只 `warn`，**绝不外泄**——这条状态回写不能因为自己失败就把一次已经真实结束的
     run 判成"结算失败"、触发 `agent-runner.ts` 里 `agent_run_settled_hook_failed` 的重试路径（那条
     路径是给 `task-dispatcher.handleRunSettled` 那种"必须成功"的写路径设计的）。

2. **挂进 `AgentRunSettledHook` 组合链**（`apps/api/src/workers/agent-runner.ts`，只改组合点，未碰执行
   逻辑本身）：`getDefaultAgentRunQueue()` 里新增 `getDefaultActionCardRunSettlementHook()` 惰性单例
   （注入真实 `createActionCardRepository(getSharedDatabaseClient().db)`），挂在
   `getDefaultTaskDispatcher(...).handleRunSettled(run)` 之后、
   `getDefaultRunConversationReportHook()(run)` 之前——先改状态，再让 PM 汇报读到结算后的状态。

3. **SSE `action_card.updated` 事件：判断为"不硬造"，没有新发**。`action-cards.ts` 里的
   `emitUpdated`（`conversationActionCardUpdatedEventSchema` + `bus.publish`）是私有闭包，不在导出面上；
   `conversation-observer.ts` 里还有一份几乎相同的内联实现——两处都不在本批范围围栏内（围栏只允许改
   `action-card-run-settlement.ts` + 测试 + `agent-runner.ts` 的组合点接线），没有现成的可复用导出函数
   能在不碰这两个文件的前提下调用。按任务要求"没有就不硬造"，本模块**不发** SSE 事件；前端已有节流轮询
   兜底（批 S2 的 `run-progress.ts` 每 ≥10 秒重取一次军团面板，状态刷新只是稍有延迟，不会永远看不到）。

## 改动文件清单

- `apps/api/src/services/action-card-run-settlement.ts`（新增）— 终态映射纯函数 + 结算 hook 工厂
- `apps/api/src/services/action-card-run-settlement.test.ts`（新增）— 14 条单测
- `apps/api/src/workers/agent-runner.ts` — 新增 import + `getDefaultActionCardRunSettlementHook` 惰性
  单例，挂进 `getDefaultAgentRunQueue()` 的 `runSettled` 组合链
- `r12-desktop-workbench/reports/r13-fix-item-settlement.md`（本文件）

## 自查输出

```
pnpm --filter @workhub/api test
  1122 pass / 0 fail / 1 skip（改动前 1108 pass；本批新增 14 条；跳过项是既有真库门 R12 workbench PG
  smoke，无本地 PG 连接时的既有行为，非本批引入）

pnpm -r typecheck
  16/16 workspace 全绿（第 17 个是 client-tauri Rust 项目，非 TS 包，不在这个命令范围内）

git status --short
  只有范围围栏内的文件被改（action-card-run-settlement.ts 及测试、agent-runner.ts、本报告文件）；
  无范围外脏文件被 add
```

## 测试覆盖说明

- **仓库级**（`transitionItemStatus` 的 CAS 语义）：`packages/db/src/action-cards-repository.test.ts`
  已有通用覆盖（"transitionItemStatus is a CAS write scoped by workspace and source statuses, returning
  null on a lost race"，就是拿 `fromStatuses:["running"]` → `toStatus:"undone"` 做的用例，跟本模块的
  写法完全一致），本批**没有补充仓库级测试**——四终态映射是本模块的业务逻辑，不是仓库层的职责，仓库层
  的 CAS 机制本身已经被验证过。
- **hook 级**（`action-card-run-settlement.test.ts`，假仓库记录调用）：四终态映射各一条 + 纯函数
  `actionCardItemStatusForRunStatus` 的直接单测（含非终态防御性用例）+ 无 `source_action_card_item_id`
  不调用仓库 + 缺 `workspace_id` 告警后跳过 + CAS 落空的幂等 no-op（不告警、不抛错）+ 仓库抛错不外泄
  （告警但 `assert.doesNotReject`）。

## 我改过的断言（如有）

无。没有修改任何既有测试的断言。

## 范围外发现（不修，只报）——阻塞风险，建议合并前决策

**`undo()`（`apps/api/src/services/action-cards.ts` 第 278-333 行）在手动撤销 execute 条目时，会被本批
新挂的结算 hook 抢先写入，导致 `undo()` 自己随后的 CAS 落空、误抛 409。**

具体执行顺序（已用代码逐行核对，非猜测）：

1. `undo()` 第 292 行：`await options.agentRuns.abort(item.runId, ...)`。
2. `abort()`（`agent-runner.ts` 第 2232-2269 行）内部在 `return cancelled` **之前**会
   `await notifyRunSettled(cancelled)`（第 2268 行）——也就是说，`abort()` 不会在 `notifyRunSettled`
   （现在包含本批新挂的结算 hook）跑完之前把控制权还给调用方。
3. 于是本模块对 `cancelled` 状态的 CAS 写入（`fromStatuses:["running"]` → `toStatus:"undone"`），会在
   `undo()` 走到它自己第 313-319 行那句 `transitionItemStatus({fromStatuses:["running"],
   toStatus:"undone"})` **之前**就已经执行完毕——而且这次 CAS **必然成功**，因为此刻条目确实还是
   `running`（`undo()` 还没来得及写）。
4. `undo()` 自己随后的写入因为条目已经不是 `running` 了而 CAS 落空，返回 `null`；`undo()` 第 320-322
   行把"落空"当错误处理：`if (!updated) throw new ActionCardServiceError(409,
   "action_card_item_not_undoable", "这个条目已经过了可撤销的窗口。")`。

**净效果：一旦本批的 hook 接入生产（`getDefaultAgentRunQueue()`），每一次对"正在跑"的 execute 条目点
"撤销"，用户会收到一个错误的 409（"已经过了可撤销的窗口"），即便数据实际上已经正确落到 `undone`
（是本模块的写入替它完成的，只是 `undo()` 自己不知道）。这不是低概率竞态——只要 `undo()` 走一次正常
流程就会 100% 触发，因为 `abort()` 必然在 `undo()` 自己的写入之前完成结算 hook 链。**

（`hook 级`测试里的"CAS 落空 = 幂等 no-op"用例覆盖的是另一个安全场景：settled hook 被*重放*——比如
`recoverUnsettledTaskPlanRuns()` 对已经结算过的 run 再次调用 `notifyRunSettled`，或是某次 `undo()` 已经
在更早的请求里完整跑完、条目本来就是 `undone`，这时本模块的 CAS 才是"迟到的、无害的落空"。上面第 1-4
点描述的是同一次 `undo()` 请求内部的执行顺序问题，是另一回事。）

这个问题的根因在 `action-cards.ts` 的 `undo()` 如何处理"CAS 落空"，不在本批范围围栏内（围栏只允许改
`action-card-run-settlement.ts` + 测试 + `agent-runner.ts` 的组合点接线）。最小修复方向（供决策参考，
**未实现**）：`undo()` 在自己的 `transitionItemStatus` 返回 `null` 时，不要直接判定为 409——重新读一次
条目当前状态，如果已经是 `undone`，当作撤销成功处理（幂等）；如果是别的状态，才是真的"晚了"。

**这是一个合并前必须决策的阻塞项**：要么（a）接受现状先合并、随后立刻补一个针对 `action-cards.ts` 的
快速修复任务，要么（b）在本 PR 合并前先由人/另一个任务把 `undo()` 改成幂等容错，要么（c）指示我把
`cancelled → undone` 这一条映射从本模块里去掉（一行改动），把"中止后回写"完全留给 `undo()` 自己处理
（代价：非经 `undo()` 触发的取消——比如通用 `/agent-runs/:id/abort` 路由或 `proposals.ts` 的拒绝流程
直接中止一个 execute 条目的 run——条目仍会永远停在 `running`，回到本任务要修的原始问题的一个子集）。
本批**没有**擅自选择以上任一方案，因为都需要碰围栏外的文件或改变已明确要求的四映射之一。

## 没做/存疑

- 上面的 `undo()` 竞态是本次实现中发现的最重要的存疑项，需要人工裁决（见上）。
- SSE `action_card.updated` 事件本批没有新发（见"做了什么"第 3 点的决定与理由）；前端靠既有节流轮询
  兜底，状态刷新会有 ≤10 秒左右的可见延迟，不算错误但是体验上不是即时的。
- `packages/db` 仓库层没有为"四终态映射"新增测试——如上文"测试覆盖说明"所述，判断为已被通用 CAS
  测试覆盖，映射本身是本模块的业务逻辑不是仓库职责；如果人工认为仓库层也需要针对这四个具体 toStatus
  值的专门测试，属于本批未做的补充项。

---

## 阻塞风险已解决（集成者跟进,main 1b87b1bb）

「范围外发现——阻塞风险」一节描述的 undo() 确定性 409 已在合并本分支的同一波集成中修复:
apps/api/src/services/action-cards.ts 的 undo() 在自身 CAS 落空后复读条目——已是 undone 即视为
成功(钩子抢先=殊途同归,留痕/播报照旧),其它状态才维持原 409。回归测试
「undo succeeds when the settlement hook already flipped the item to undone during abort」
落在 apps/api/src/action-cards-service.test.ts。验证:pnpm --filter @workhub/api test = 1123/0,
pnpm -r typecheck = 16/16 净。三个候选方案中选了「修 undo 幂等」——语义最诚实,cancelled 映射保留。
