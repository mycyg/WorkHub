# R13 批 S2 完成汇报（Cuu 异步化与进度可视）

日期: 2026-07-13 · 执行: Claude · 分支: `r13/s2-async-cuu`（基线 `3a9a70d9`，拉自 `origin/main`，与
`main` 完全同步）
来源: `r13-workbench-refinement/00-plan.md` 批 S2 + 「Cuu = 项目经理」角色总纲（本批的三条汇报文案都按
PM 例行同步的口吻写）。

## 异步心智模型（设计先行，300 字内）

对话流与任务流是两条视觉/时序都独立的通道，只在两个节点交汇：

```
对话流 ──"顺便干个活"──▶ 任务流（后台 run，随时推进）
  │  turn 流式进行中：任务事件先攒队列，不打断气泡     │
  │◀── turn 落定：一次性把队列摊开(状态就地生效) ──────┘
  │                                                      │
  聊天里的行动卡条目 = 任务流的"橱窗"：              run 到终态
  阶段流进度行 认领→干活→产出→提议 随节流轮询推进      │
                                                          ▼
                                            会话里出现一条 PM 语气汇报
                                        （成功已被产出卡覆盖；失败/升级补播报）
```

一句话：**对话本身的实时性不受任何影响，任务的画面更新可以稍等，但绝不假装任务不存在**——查得到就诚实
展示进度，查不到就保留现状文案，不编故事。

## 做了什么

1. **turn 期间任务事件缓冲**（`chat/turn-task-buffer.ts`，新增）：协同会话流式回复进行期间
   （`turnActive===true`）收到的 `conversation.action_card.updated` 事件不再立即
   `applyActionCardUpdate + renderScroll`（那会打断正在阅读的流式气泡），而是攒进一个纯队列
   （`enqueueBufferedActionCardUpdate`），`beginTurn` 的 `.then`/`.catch`（turn 落定，成功/失败都算）
   里统一 `flushBufferedActionCardUpdates` 重放——按接收顺序逐条 `applyActionCardUpdate`，收敛到跟
   "完全不缓冲、来一条应用一条"完全相同的最终状态，只是画面更新的时间点推迟了。typing/message.delta
   两类事件**不缓冲**——它们买的就是"实时"这个属性，缓冲是错误行为。main 会话里 `turnActive` 恒为
   `false`（`beginTurn` 只在协同会话被调用），这个队列在主区永远不会真的攒上东西。
2. **聊天里的活进度行**（`chat/run-progress.ts`，新增；`render.ts`/`view.ts` 接线）：行动卡 execute
   条目（`status=running`）从静态「进行中」升级为阶段流进度行——**认领→干活→产出→提议**。
   数据源：该会话军团面板端点 `GET /conversations/:id/army`（批 P1 已挂载，本批只复用
   `army/api.ts` 的既有导出 `fetchConversationArmyPanel`，**没有新造 SSE**）返回的 run 卡片
   `status`/`recent_step.phase`，按 `source_action_card_item_id` 关联到具体条目。
   - 阶段推断（`inferActionCardRunProgress`，纯函数）：`queued`→认领；`running`+
     `think`/`tool_call`/`tool_result`（或还没有任何步骤）→干活；`running`+`final`→产出；
     `succeeded`→提议（批 4b 的产出卡已经在这个时点播报"提议在等审"，这里只是把"提议"标成条目当前
     所处阶段）；`failed`/`escalated`→独立的终态视觉；`cancelled`/任何未识别的状态或 phase 组合→
     `undefined`，调用方据此保留既有"进行中"纯文字，**不编造进度故事**。
   - 节流：≥10 秒最小间隔，由「聊天视图历史加载完成」和每一条 `action_card.updated` 事件共同触发；
     窗口内的触发不会被丢弃——安排一次"窗口结束时刻"的收尾重取（leading+trailing 节流，
     `shouldRefetchActionCardRunProgressNow`/`nextAllowedActionCardRunProgressFetchAtMs` 两个纯函数
     单测覆盖边界）。
   - 与 task 1 的交互：`refreshActionCardRunProgress` 拿到新快照后，如果 `turnActive` 就**不**立即
     `renderScroll`（否则会用同一个"打断流式气泡"的方式抵消 task 1 的效果）——最新快照会在
     `flushBufferedActionCardUpdates` 的那次渲染里一并呈现。
   - 视觉：三个终态各有明确颜色（完成=`--ds-success`，跟批 4b 产出卡同一个语汇；失败=`--ds-danger`；
     升级=`--ds-warn`），进行中的四段用 `--ds-accent` 高亮当前段、已过段 `.55` 透明度、未到段 `.3`
     透明度——全部复用既有 CSS 自定义属性 + 内联 `style`，**没有碰 `css.ts`**（范围围栏禁止）。
3. **run 终态 PM 汇报**（`apps/api/src/services/run-conversation-report.ts`，新增；挂进
   `agent-runner.ts` 现有的 `AgentRunSettledHook` 组合链）：带 `source_conversation_id` 的 run 到达
   `failed`/`escalated` 终态时，往该会话 `postSystemMessage`（`senderType: "cuu"`，因为这是 Cuu 第一
   人称主动汇报，不是中立系统通知——同批 3 `action_card_item_undone` 播报的取舍）一条 PM 语气播报。
   **终态→播报覆盖矩阵**（`run-conversation-report.ts` 顶部注释是唯一权威版本，这里复述一遍）：

   | run 终态 | 谁已经播报过 | 本模块要不要发 |
   |---|---|---|
   | `succeeded` | 批 4b `postDeliverableSystemMessage`（`proposal_opened`/`proposal_auto_merged`，在
   `notifyRunSettled` **之前**已经发过"已生成变更申请，等待人工确认后采纳"/"已自动采纳 · 全托管"）——
   语义上就是"XX 干完了，提议在等审" | **不发**（避免重复播报） |
   | `failed` | 没有任何人播报过（`openProposalFromManifest` 见 `result.status!=='succeeded'` 直接
   短路，批 4b 完全不碰这条终态） | **发**——"XX · 这次没干成"+一句人话原因（从最后一条
   `phase==='final'` trace 的 `output_excerpt` 提取，封顶 160 字；没有可用文本就说"具体原因还在整理"，
   不编造） |
   | `escalated` | 同 `failed`——批 4b 同样短路不发 | **发**——"XX · 需要你拍板" |
   | `cancelled` | 没有人播报过，但这是发起中止的人自己刚做的动作 | **不发**（设计取舍：PM 不需要
   转头汇报对方刚做完的事，这不是"异步、没人盯着"的场景） |

   服务端只发**结构化 content**（`{event:'run_settled_report', outcome, title, reason}`），本批范围
   里的 `chat/render.ts` 加一个新的产出卡变体识别它，按 locale 渲染中/英文——跟批 4b 产出卡的
   "服务端只管数据，客户端管文案"分工完全一致。`createRunConversationReportHook` 内部 try/catch 吞掉
   一切 `postSystemMessage` 错误（只 warn 日志），**绝不抛错**——不能因为这条锦上添花的汇报失败，就
   把一次已经真实结束的 run 判成"结算失败"、触发 `agent_run_settled_hook_failed` 的重试路径（那条
   路径是为 task-plan 结算这种"必须成功"的写路径设计的）。

## 改动文件清单

- `apps/desktop-webview/src/workbench/chat/turn-task-buffer.ts`（新增）— 缓冲队列纯函数
- `apps/desktop-webview/src/workbench/chat/turn-task-buffer.test.ts`（新增）— 6 条单测
- `apps/desktop-webview/src/workbench/chat/run-progress.ts`（新增）— 阶段推断 + 节流判定纯函数
- `apps/desktop-webview/src/workbench/chat/run-progress.test.ts`（新增）— 19 条单测
- `apps/desktop-webview/src/workbench/chat/view.ts` — turn 期间缓冲接线（SSE handler +
  `beginTurn` 两处 flush）+ 军团面板节流拉取接线（首屏 + 事件触发）+ dispose 补清定时器
- `apps/desktop-webview/src/workbench/chat/render.ts` — `ChatRenderContext` 新增
  `actionCardRunProgress` 字段；execute+running 条目的状态渲染改走
  `renderActionCardItemStatusHtml`（阶段流/终态优先，查不到退回既有纯文字）；新增
  `run_settled_report` system_event 变体的产出卡渲染
- `apps/desktop-webview/src/workbench/chat/render.test.ts` — 新增 11 条（`run_settled_report` 卡片 3
  条 + 阶段流/终态渲染 8 条），`ctxWith` 测试帮手扩展支持 `actionCardRunProgress`
- `apps/api/src/services/run-conversation-report.ts`（新增）— 终态矩阵实现 + 汇报器工厂
- `apps/api/src/services/run-conversation-report.test.ts`（新增）— 18 条单测（原因提取 6 + 内容构造 5
  + 汇报器接线 7，含终态矩阵每一格的覆盖断言）
- `apps/api/src/workers/agent-runner.ts` — 新增 `getDefaultRunConversationReportHook` 惰性单例，挂进
  `getDefaultAgentRunQueue` 的 `runSettled` 组合链（`getDefaultTaskDispatcher(...).handleRunSettled`
  之后）

## 自查输出

```
pnpm --filter @workhub/desktop-webview test
  765 pass / 0 fail（改动前 729 pass；本批新增 36 条：turn-task-buffer 6 + run-progress 19 + render 11）

pnpm --filter @workhub/api test
  1095 pass / 0 fail / 1 skip（改动前 1077 pass；本批新增 18 条；跳过项是既有真库门 R12 workbench PG
  smoke，无本地 PG 连接时既有行为，非本批引入）

pnpm -r typecheck
  16/16 workspace 全绿（第 17 个是 client-tauri Rust 项目，非 TS 包，不在这个命令范围内）

git status --short
  只有范围围栏内的文件被改（chat/**、agent-runner.ts、新增的 run-conversation-report.ts 及测试、本
  报告文件）；无范围外脏文件被 add
```

## 我改过的断言（如有）

无。没有修改任何既有测试的断言。

## 范围外发现（不修，只报）

- **`action_card_items.status` 从来不会在 run 正常结算时自动从 `running` 转到 `done`/`failed`/
  `escalated`**——全仓库搜索确认唯一一处 `fromStatuses: ["running"]` 的迁移在
  `apps/api/src/services/action-cards.ts` 的手动撤销（`toStatus: "undone"`），没有任何代码在 run
  settled 时把对应的行动卡条目状态回写。本批任务 2（阶段流进度行）能在数据层面绕过这个坑——阶段流
  直接读 `agent_runs.status`/`recent_step`，不依赖 `action_card_items.status` 是否准确——但这意味着
  哪怕 run 已经 `succeeded`/`failed`/`escalated`，这条 execute 条目在服务端的权威状态、以及它的"撤销"
  按钮判定（`renderExecuteItemActionsHtml` 仍然看 `row.status==='running'` + `undo_deadline_at`）都
  还停留在"运行中"——一个 run 早就失败了的条目理论上仍然可能显示"撤销（N 分钟内）"这个已经没有意义
  的按钮（虽然点击会被服务端 409 兜底，不会造成错误后果，只是体验上的诚实度缺口）。这是一个先于本批
  就存在的结构性缺口，修复需要触碰 `packages/db`/`services/action-cards.ts`（本批范围围栏之外），
  建议作为独立任务处理。
- `run-conversation-report.ts` 对 `succeeded` 终态的处理是保守判断：只要 `run.status==='succeeded'`
  就认定批 4b 已经播报过，不再重复发。但如果某次 run 成功却因为 `requireDeliverable=false`/
  `proposalSink` 未接/`manifest` 缺失而没有真正开出提议（理论边缘情况，`requireDeliverable` 默认
  `true` 时代理循环本身会在无交付物时提前转 `failed`/`escalated`，所以生产路径里基本不会触发），
  这批不会补发任何播报——要精确识别需要查这条会话里是否已经有一条 `proposal_opened`/`auto_merged`
  消息（DB 读），这需要新的仓库查询能力，超出本批"只挂 settled hook + 新汇报器模块"的范围围栏。

## 没做/存疑

- 任务 2 的"点击展开右栏 run 详情"（00 §「异步心智模型」原文提到"依赖 P1 的军团面板组件"）本批
  **没有**接线——阶段流进度行本身是纯文字/纯样式，没有加可点击交互；P1 的军团面板本身已经有独立的
  run 卡下钻详情入口，本批判断"聊天里的进度行再叠加一个跳转"不在"克制不越界"的三件事范围内，留给
  后续批次视需要决定要不要加这条捷径。
- 三处新增的渲染/接线逻辑里，**turn 期间缓冲**和**军团面板节流拉取**在 view.ts 里的接线部分没有直接
  单测——这个 workspace 的测试运行器没有真实 DOM（`view.ts` 顶部注释历来如此，`mountChatView` 本身
  从批 2 起就没有单测），真正的逻辑已经拆进 `turn-task-buffer.ts`/`run-progress.ts` 的纯函数里逐一
  覆盖；DOM 接线是否真的按预期触发（比如"turn 进行中收到卡片更新事件真的没有打断流式气泡"）需要真机/
  预览手验，未做。
- `run_settled_report` 卡片的中英文文案未经过真实用户验收，只保证了"不编造原因"和"三终态视觉可区分"
  这两条硬性要求；具体措辞可能需要后续按真实反馈微调。
