# 批3 完成汇报（静默观察者 + 行动卡运行时，服务端切片）

日期：2026-07-12 · 分支：`r12/batch3-server`（从 `r12/workbench-full` 拉出，HEAD 含 `31f022c2`）

## 做了什么

- `packages/db/src/repositories/action-cards.ts`（新）：行动卡/条目/观察者水位线的仓库层。租户过滤全部写进 SQL、所有列表查询带 cap、观察者候选扫描+建卡/追加卡在事务内行锁。含 28 条 colocated query-recorder 单测（`packages/db/src/action-cards-repository.test.ts`）。
- `packages/agent/src/observer/`（新）：观察者 prompt 构造（`prompt.ts`）+ 结构化输出 zod schema（`schema.ts`）+ 容错解析/低质自检（`parse.ts`）。纯函数，18 条单测，不碰网络/DB。
- `apps/api/src/workers/conversation-observer.ts`（新）：claim-lease 风格的 tick scheduler（仿 `agent-run-recovery.ts`/`session-sweep.ts`），含安静时段纯函数 `isWithinQuietHours`、执行/决策/观察三类条目的分派、失败静默计数、SSE 生产者。18 条单测（`apps/api/src/conversation-observer.test.ts`）。
- `apps/api/src/services/action-cards.ts`（新）+ `apps/api/src/routes/action-cards.ts`（新，**不挂载**）：`decide`（交给我干/派给别人/先不动）与 `undo` 两个端点的业务逻辑与路由层，uuid 守卫+json 校验+窄口径鉴权（仅被 @ 负责人或管理员）。服务层 18 条单测 + 路由层 8 条单测。
- `packages/contracts/src/events.ts`（只增）：新增 `conversationActionCardUpdatedEventSchema`（`conversation.action_card.updated` 从批0「仅保留名称」升级为真实 payload/校验）。
- 必要的 barrel 导出（超出字面文件清单，但没有它们新模块无法被使用，逐条列在下方「范围外的必要改动」）。

## 改动文件清单

| 路径 | 说明 |
|---|---|
| `packages/db/src/repositories/action-cards.ts` | 行动卡仓库（新） |
| `packages/db/src/action-cards-repository.test.ts` | 仓库单测，28 条（新） |
| `packages/agent/src/observer/schema.ts` | 观察者输出 zod schema（新） |
| `packages/agent/src/observer/prompt.ts` | 观察者 prompt 构造（新） |
| `packages/agent/src/observer/parse.ts` | 容错解析 + 低质自检（新） |
| `packages/agent/src/observer/index.ts` | 观察者模块 barrel（新） |
| `packages/agent/src/observer/observer.test.ts` | 观察者模块单测，18 条（新） |
| `apps/api/src/workers/conversation-observer.ts` | 观察者 worker（新） |
| `apps/api/src/conversation-observer.test.ts` | worker 单测，18 条（新） |
| `apps/api/src/services/action-cards.ts` | decide/undo 业务逻辑（新） |
| `apps/api/src/action-cards-service.test.ts` | 服务层单测，18 条（新） |
| `apps/api/src/routes/action-cards.ts` | decide/undo 路由，**不挂载**（新） |
| `apps/api/src/action-card-routes.test.ts` | 路由层单测，8 条（新） |
| `packages/contracts/src/events.ts` | 新增 `conversationActionCardUpdatedEventSchema`（只增） |
| `packages/contracts/src/r12-workbench.test.ts` | 见下「我改过的断言」 |
| `packages/db/src/index.ts` | 新增一行 `export * from "./repositories/action-cards.js"` |
| `packages/agent/src/index.ts` | 新增一行 `export * from "./observer/index.js"` |
| `packages/agent/package.json` | 新增 `"./observer"` subpath export |

## 我改过的断言

**`packages/contracts/src/r12-workbench.test.ts`**：批0的测试 `R12 typing events reserve a strict server-owned 3000ms transient contract only` 末尾断言 `conversationActionCardUpdatedEventSchema` 这个名字**尚未导出**（`assert.equal(contracts[name], undefined)`）——这正是批0文档里写的「批3实现」。我把这个名字从「仅保留名称」清单里移出，并新增一条独立正例测试 `R12 action-card-updated events carry a minimal renderable summary bound to one conversation topic`（同款覆盖：合法事件、跨会话 topic 拒绝、actor 缺 user_id 拒绝、items 超 8 条拒绝、未知字段拒绝），与 `message-created`/`typing` 两个事件的既有测试风格一致。这是铁律1允许的「计划内、有理由」的断言变更，不是迁就实现而改测试。

**未改动**：`proposal-review-attention.test.ts` 与任何 PG smoke 脚本——见下「没做/存疑」。

## 自查输出

- `pnpm --filter @workhub/db typecheck / test`：typecheck 0 错；211 tests，210 pass，1 skip（PG-gated，与批0一致），0 fail。
- `pnpm --filter @workhub/agent typecheck / test`：typecheck 0 错；69 tests（含新增 18），全 pass。
- `pnpm --filter @workhub/contracts typecheck / test`：typecheck 0 错；89 tests（含新增 1），全 pass。
- `pnpm --filter @workhub/api typecheck / test`：typecheck 0 错；947 tests（含新增 44：18 worker + 18 service + 8 routes），946 pass，1 skip（PG-gated，与批0一致），0 fail。
- `pnpm -r typecheck`：16/17 workspace 全过（第 17 个是 Rust crate，无 typecheck 脚本，与本批无关）。
- `pnpm test`（全仓）：所有 workspace 0 fail（db 211/agent 69/contracts 89/api 947/web-runtime 28/desktop-webview 269/web 67/ui 130/…）。
- `pnpm verify`：**PASS**（typecheck+test+lint+audit:portable-config+audit:target-paths+audit:migrations+qa:r2-release-gate+qa:r4-rust-system-i18n+全部 cuu-r3-\* smoke，exit 0）。verify 运行期间 `qa:r4-rust-system-i18n` 重新生成了 `docs/workhub/05-clients/assets/audit/2026-06-11-r4-rust-system-i18n/{rust-system-i18n-report.json,smoke-summary.md}` 两个时间戳型 artifact——已用 `git checkout --` 还原，未纳入提交（铁律6/8）。
- `git status`：无范围外文件被改（见下方提交清单）。

## 范围外的必要改动（超出字面文件清单，但不加就是死代码）

- `packages/db/src/index.ts` 加一行 barrel 导出——不加，`createActionCardRepository` 就无法通过 `@workhub/db` 被 worker/service 引用。
- `packages/agent/src/index.ts` + `packages/agent/package.json` 加 `./observer` subpath——同理，不加 worker 就无法 `import { ... } from "@workhub/agent/observer"`。
这两处都是纯粹的一行/一段导出注册，没有改动任何既有导出或行为。

## 未挂载清单（给集成者）

- `apps/api/src/routes/action-cards.ts` 导出 `createActionCardRoutes()`，未挂进 `app.ts`（铁律，本批不许改 app.ts）。集成者需要 `app.route("/api", createActionCardRoutes())`，参照 `routes/conversations.ts` 挂法。
- `apps/api/src/workers/conversation-observer.ts` 导出 `getDefaultConversationObserverScheduler()`，**没有任何地方调用 `.start()`**——需要在服务端进程启动处（参照 `session-sweep`/`agent-run-recovery` 的启动位置）接线，否则观察者永远不会自动跑。
- `conversation.action_card.updated` 事件的生产者已在 worker 与 service 两处接好（tick 建/追加卡时、decide/undo 变更条目时），但**SSE 订阅端**（`GET /api/push/stream/conversation/:id`）已在批0交付，无需额外挂载，事件会自动流过去。

## 缺口（真实存在，需要人裁决，未硬造绕过）

1. **`agent_runs.source_conversation_id`/`source_action_card_item_id` 应用层未接线**（P0，影响批5）。批0迁移 0046 已经在 DB 层建好这两列+FK+check 约束，但 `apps/api/src/workers/agent-runner.ts` 的 `EnqueueAgentRunInput`/`AgentRunQueueRecord` 类型、`apps/api/src/services/agent-run-persistence.ts` 的映射、`packages/db/src/repositories/agent-runs.ts` 的 insert 都**完全没有**这两个字段的读写路径——我逐一 grep 确认过，零匹配。这两个文件不在本批范围内（agent-runner.ts/agent-run-persistence.ts/repositories/agent-runs.ts 都没被列进我的允许清单），我没有绕过去伪造。当前折衷：`action_card_items.run_id`（我拥有的表）忠实记录了「条目 → run」的正向链接；但 run 行本身查不出「我是从哪个会话/哪条卡片来的」。批5要做「会话维度 runs 列表」时，要么先给 agent-runner.ts 补上这两个字段的透传（自然的扩展点，仿 `taskPlanId`/`taskPlanItemId` 现成的透传模式），要么退而通过 `action_card_items.run_id` 反查（多一次 join，且覆盖不到未来非行动卡来源的 run）。
2. **观察者自身 LLM 分析调用无法接入原子预算预留**（budget_reservations 表）。`budget_reservations.run_id` 是 `NOT NULL` 外键指向 `agent_runs.id`，而 `agent_runs.work_item_id` 也 `NOT NULL`——观察者的分析调用发生在任何 work_item 存在之前，没有合法的 run_id 可挂靠。强行接入需要为每次分析伪造一个 work_item+agent_run，这正是铁律3禁止的假接线，所以我没做。改用**软闸**：分析前用 `decideRunBudget` 读团队维度的已用量快照做门槛判断（超限则跳过，不建卡也不推水位线，下个 tick 重试；不是硬性原子互斥，高并发下理论上仍可能小幅超额）。真实成本仍会计入 `cost_ledger_entries`（`ProviderRegistry` 的 `usageSink` 自动记账），只是不参与跨请求的原子预留互斥。`UsageSource` 枚举（`packages/cost/src/types.ts`，不在本批范围）也没有专门的 "observer" 值，复用了 `"agent_step"`。
3. **`escalationTriggers` 枚举没有「观察者建议决策」这个专用值**（`packages/contracts/src/enums.ts`，不在本批范围）。decide 类条目建的升级事件复用了 `"unqualified"`（AI 认为这事需要人判断，语义上最贴近）。若产品需要专门区分「AI 主动拎出的决策」与「AI 自己拿不准而升级」两种来源，需要新增枚举值。
4. **被引用上下文（@文件/#会话 chip 展开）未接线**。观察者 prompt 已经预留 `referencedContext` 参数，但批2/批4的 chip 展开链路还不存在，worker 目前恒传空数组。等批2/批4落地后，只需在 `conversation-observer.ts` 的 `analyzeConversation` 里把展开结果塞进这个参数即可，观察者模块本身不用改。
5. **PG smoke 未新增 R12 观察者全链路小节**。02 计划批3的验收门写了「发言→停 60s→出卡→run 跑→线程回贴→提议链接出现」的 PG smoke。我的范围围栏没有列出任何 `scripts/qa/*` 文件，且指令原文写了「禁跑 qa smoke」，我理解为本批不新增/不跑 smoke 改动，交给集成者在路由挂载+worker 启动接线之后统一补——观察者是一个真实定时+真 LLM 的后台任务，为它写 smoke 前需要先有「测试时钟可缩」的接线点（我的 `now`/`intervalMs` 都已 DI 化，具备被 smoke 驱动的条件）。
6. **`proposal-review-attention.test.ts` 未改动**。我检查过：当前没有任何既有测试或 smoke 路径会触发 `conversation-observer.ts`（它的 scheduler 未被启动，路由未挂载），所以这批改动不会让任何既有 escalation/attention 计数漂移。等集成者把 worker 接上生产启动流程后，若真实观察者产出的 decide 类升级卡开始出现在 attention 队列里，需要重新核对该测试与相关 smoke 的期望条数。
7. **「接单即建工作副本」没有新增任何机制**。execute 条目走的是 `AgentRunQueue.enqueue()` 这条既有通道，工作副本/快照语义完全继承 agent-runner.ts 已有的 workdir/base-snapshot 机制（P-COLLAB M2），本批没有在此基础上新增「用户能立刻打开看到的工作副本」概念——如果 03 §1 描述的「张三可随时打开副本查看」需要比现状更强的可见性，这是一个独立于本批的产品/架构决策，我没有替集成者做主。

## 设计决策（非缺口，供集成者知晓）

- **execute 条目的 `action_card_items.status` 在 auto/ask/manual 三种派发策略下都落 `'running'`**——枚举是冻结的，没有「已分配未开始」这个中间态。UI 要区分「AI 真的在跑」vs「等接单人/等手动开始」，看 `run_id` 是否非空即可（非空=auto 已入队；为空但 `work_item_id` 非空=ask/manual）。
- **撤销窗口只对 auto 派发（有 `run_id`）的 execute 条目开放**，10 分钟（`UNDO_WINDOW_MS`），对齐 `00-interaction-design.md` §2.3 的原型文案。decide 条目走 `claim`（交给我干，`assignee_user_id`=操作者本人）本身不产出可撤销的 run。
- **decide 端点鉴权用了比 `work-items.ts` 的 `assertCanMutateWorkItem` 更窄的口径**（只认「当前 `assignee_user_id` 或 `actor.isAdmin`」，不额外放行项目负责人/认领人/协作 assignment），严格对应任务描述「仅被 @ 的负责人或管理员可操作」的字面要求。
- **安静时段的星期编号采用 JS `Date.getDay()` 惯例**（0=周日…6=周六），通过 `Intl.DateTimeFormat` 按目标时区取短星期名再映射数字，避免直接用 `Date` 对象在错误时区下取 `getDay()`。这是本仓库第一处真正做时区感知安静时段判断的代码，后续批4/批8做治理设置 UI 时应沿用同一编号。

## 待人工（真 LLM key 冒烟）

- `packages/agent/src/observer/*` 的 prompt/parse 只用假文本单测过；观察者 prompt 面对真实模型输出的质量（尤其「低质自检」是否准确、`suggested_assignee_nickname` 抽取准确率）需要真 key 跑一次「讨论 → 行动卡」全链路，成本预期 <¥0.05/次（02 计划验收门原话）。
- `conversation-observer.ts` 的 `defaultClientProvider()` 直接接 `getDefaultProviderRegistry().get(actor, "assistant")`，没有单独验证过真实 provider 返回的 JSON 是否总能被 `parseObserverPlanResponse` 正确抠出（已用容错解析兜底，但没有真流量验证过误判率）。

## 结论

批3服务端切片（行动卡仓库、观察者 prompt/worker、decide/undo 服务与路由、SSE 事件契约）完成，`pnpm verify` 全绿，无范围外文件改动。因两处底层通道（agent_runs 溯源列、budget_reservations 的 run_id 外键）在应用层尚未打通，观察者的会话溯源与预算原子互斥暂时是「诚实降级」而非「假装齐全」——详见上方「缺口」，需要集成者裁决是否在本批之后立即补，还是留给批5/批8。路由与 worker 启动尚未接线，等待集成者挂载。
