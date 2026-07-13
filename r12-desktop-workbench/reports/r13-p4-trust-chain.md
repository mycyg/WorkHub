# R13 批 P4 完成汇报(全托管透明度 + labor-split 真做)

日期: 2026-07-13 · 执行: Claude · 分支: r13/p4-trust-chain(基线 `94e331e7`,拉自 `origin/main`)

## 做了什么

全程**不改 schema/迁移**——五项都从既有表推导。逐项推导路径:

### 1. labor-split 按 assignee 记账

- **推导路径**:`cost_ledger_entries` 本身没有「谁执行的」这个维度(既有 `userId` 列是 `usage.userId`,语义是「起意者/触发这次调用的身份」,不是任务书要的「执行身份」)。任务书明确要求按 `agent_runs.actor_user_id` 聚合——新增 `packages/db/src/repositories/cost-ledger.ts::listCostByAssigneeForWorkspace`,一条 SQL `LEFT JOIN agent_runs ON cost_ledger_entries.run_id = agent_runs.id LEFT JOIN users ON agent_runs.actor_user_id = users.id`,`GROUP BY actor_user_id, nickname`,只认 `scope_kind IN ('team','curation')`(与 `listEntriesForWorkspace` 的工作区归属判定同口径,避免同一次花费因 scope 扇出被计多次)。`actorUserId IS NULL` 的分组(无 run 关联的账目,如夜间技能蒸馏)天然落进「系统」桶。
- 路由层(`apps/api/src/routes/pages.ts` 的 `/cost`)新增 `assigneeCostReader` 依赖(默认直调上面的查询函数),仅管理员调用,取数失败静默降级(与 `taskPlanMeta`/`objectiveTitles` 同一惯例)。
- `apps/api/src/pages/cost.ts` 新增 `by_assignee` 字段(VM),装配「我」/昵称/系统标签 + 降序排列。
- `packages/ui/.../route-components.ts` 新增「按执行者分账」卡片(与 `by_user`/`by_objective` 并排)。

### 2. reviewer_kind 溯源

- **推导路径**:`reviews` 表本就有 `reviewerKind`(varchar,'human'|'ai'|历史上可能的 'system')列——批 4b 全托管档的 `attemptAutoMerge`(`apps/api/src/workers/agent-runner.ts`)在自动合并时以 `actor.actor_kind = "ai"` 调 `proposals.review()`,写入的正是这一列。为 `accepted_deliverables` 找到「这份交付物是谁复核通过的」,只需按 `proposalId` 反查 `reviews` 表最新一条 `decision='approve'` 的 `reviewerKind`。
- 新增 `packages/db/src/repositories/proposals.ts::listReviewsByProposalIds`(批量 IN 查询,按 `createdAt` 升序,调用方取最后一条 approve)。
- `packages/db/src/repositories/work-items.ts::readWorkItemDetail` 新增 `attachAcceptedDeliverableReviewerKind`(一次批量查询,不逐行,不构成 N+1),把 `reviewerKind` 挂在 `WorkItemAcceptedDeliverableRow` 上。
- `apps/api/src/services/accepted-deliverables.ts::acceptedDeliverableToVm` 新增 `reviewerKind` 可选项,透传到 `AcceptedDeliverableVM.reviewer_kind`。
- `apps/api/src/services/work-items.ts::buildWorkItemDetail` 透传 `row.reviewerKind`。
- UI(`route-components.ts`):accepted_deliverables 逐行,`reviewer_kind==="ai"` 时显示过去时提示「已由 AI 自动合并,无人工复核」(zh/en);置信度 pill 的「可自动采纳」在 `verdict==="auto_merge"` **且**确有 ai 复核的交付物时改成「已自动采纳」(过去时),否则保持原文案(仍是「有资格但尚未真正合并」的诚实状态)。

### 3. 观察者工单来源标注

- **推导路径**:观察者(`apps/api/src/workers/conversation-observer.ts`)的三条派发路径(execute+auto/execute+ask/decide)在建工作项后,都会把新工作项的 `id` 写进同一批新建的 `action_card_items.workItemId`(经 `createOrAppendCard` 落库,`conversationId` 同批必填)。逐一确认:`transitionItemStatus`(撤销/改派/认领等既有写路径)从不重写 `workItemId`;`createOrAppendCard` 全仓库只被 `conversation-observer.ts` 调用。故 `action_card_items.workItemId = 这个工作项` 是三条派发路径共通、且不会被其他来源污染的最直接反查路径(比只覆盖 execute+auto 一条路径的 `agent_runs.sourceConversationId` 更完整)。
- 新增 `packages/db/src/repositories/work-items.ts::readObserverActionCardItem`(按 `work_item_id` 索引的单行查询,`readWorkItemDetail` 每次详情页只查一次,不构成 N+1)。
- `packages/contracts/src/pages.ts` 给 `workItemSourceContextVmSchema` 判别式联合新增 `conversation_observer` 变体(与 `drive_comment`/`meeting_insight` 平级,互斥——观察者派发从不途经评论/会议)。
- `apps/api/src/services/work-items.ts` 只在既有两种来源都缺席时补这条(`driveSourceContext ?? meetingSourceContext ?? observerSourceContext`);同时把 `canCreateSourceProposal`/`createProposalAction` 的二元判断改成显式三路分支(observer 恒不给「转草稿」动作——没有评论/纪要正文可转)。
- UI 渲染人话文案「由项目群聊的 Cuu 观察者创建」(zh/en),不带会话深链(桌面优先战略,web 无群聊 UI,给假链接不如不给)。

### 4. KPI:AI 自动合并数/占比

- **推导路径**:同题 2,`reviews.reviewerKind='ai'` 且 `decision='approve'` 就是「AI 自动合并」发生的那一刻(批 4b 逻辑:AI 只在这个条件下才会调用 review+merge)。新增 `packages/db/src/repositories/proposals.ts::countTodayMergeReviewsByActorKind`(今日全部 `decision='approve'` 的评审计数 vs 其中 `reviewerKind='ai'` 的计数,按 workspace 归属 + 当日窗口,与既有 `countTodayAiReviewOutcomes` 同款 join 结构但不预先按 reviewerKind 过滤)。
- `agent-army` 页(`kpis.ai_auto_merge_count`/`ai_auto_merge_ratio_pct`)与 `cost` 页(`ai_auto_merge.count`/`ratio_pct`)都加了这个 KPI,同源同口径,仅管理员可见(与 `by_assignee` 同门槛——暴露的是同组织的评审活动)。`ai-worklog` 的 `autonomy_rate` 一字未改,只加不改。

### 5. web 网盘版本历史桌面提示

- **推导路径**:`driveFileVersionVmSchema.restore_href` 本就是服务端为两端共出的同一份字段(`apps/api/src/services/drive-pages.ts` 无条件填充),但 web 的 `versionRows` 模板从来不渲染这个恢复按钮(回滚是桌面独有能力)——此前完全没有提示,看起来像「没有历史版本可恢复」而不是「这个能力只在桌面」。
- `route-components.ts` 的版本历史区块新增一行提示(仅当选中文件确有非当前版本时才渲,避免只有一个版本时的噪音):「找回历史版本需要桌面客户端」/「Restoring an older version requires the desktop client.」,复用既有 `desktopRequiredNotice` 的诚实标注精神(此处是静态文案,没有可点击动作需要拦截,故未改 `apps/web/src/browser.ts`)。

## 范围围栏与必要例外(如实说明)

任务书列出的范围围栏未显式包含以下文件,但改动是上述 5 项功能**唯一可行的落地路径**,不改就是「假接线」(违反 04 手册铁律 #3)——逐一说明:

- **`apps/api/src/routes/pages.ts`**:这是 `/cost`、`/agents` 两个路由把 page-builder 接到真实数据源的唯一位置(`taskPlanMeta`/`objectiveTitles` 现有先例就在这个文件)。新增 `assigneeCostReader`、`proposalMergeStats` 两个可注入依赖,默认直连 `packages/db` 的新查询,不新建 service 层。
- **`packages/contracts/src/pages.ts`**:全部 5 项都要求扩 VM 字段(题面原话「加一个分账表格区块」「带 reviewer_kind」等)——VM 契约本就定义在这里,不在 `apps/api/src/pages/**` 内。已核实这些 schema 均**不在 openapi 契约门里**(`apps/api/src/openapi.ts` 无一处引用),故未触碰 openapi。
- **`packages/agent/src/fixtures/gold-path.ts`、`packages/cuu/src/cards.test.ts`**:`by_assignee` 用 `.default([])` 而非 `.optional()`(`z.infer` 输出因此是必填字段),两处手写 `CostDashboardVM` 字面量原本不含该字段,不补就编不过——纯粹的机械兼容性修复,补一行 `by_assignee: []`,零行为变化。
- **`apps/api/src/drive-pages.test.ts`、`meeting-pages.test.ts`、`agent-army-dashboard.test.ts`、`proposals.test.ts`**:`WorkItemSourceContextVM` 新增第三个判别式联合成员后,这几个文件里原本假设「非 drive_comment 就是 meeting_insight」的窄化访问(解构/直接取 `.proposal_id` 等)不再类型安全;`MemoryProposalRepository` 假仓库因 `ProposalRepository` 接口新增两个方法而缺实现。均已按「显式窄化 `source_type` 再取字段」「补最小假实现」的方式修复,零断言语义变化。

以上例外全部是**新增/机械兼容性修复**,没有一处改动了范围内文件的既有行为或断言语义。

## 自查(全部通过)

```
pnpm --filter @workhub/db test        245 pass / 0 fail / 2 skip(真 PG 矩阵,无库跳过)
pnpm --filter @workhub/api test       1063 pass / 0 fail / 1 skip
pnpm --filter @workhub/ui test        142 pass / 0 fail
pnpm --filter @workhub/web test       67 pass / 0 fail
pnpm -r typecheck                     16/17 workspace 全绿(client-tauri 非 TS 包不参与)
```

另外顺手核实过的相邻包(非任务书要求,但因契约改动牵连,已验证零回归):
`@workhub/cuu`(52/52)、`@workhub/agent`(76/76)、`@workhub/desktop-webview`(652/652)。

## 我改过的断言

无。所有 `*.test.ts` 改动都是「新增测试」或「因契约新增字段/联合成员而补的窄化/桩实现」,没有一处放宽或删除既有断言。

## 新增测试清单

- `packages/db/src/cost-ledger-assignee.test.ts`(新文件):`listCostByAssigneeForWorkspace` 的 join 形状 + limit 钳制。
- `packages/db/src/proposals-repository.test.ts`:`countTodayMergeReviewsByActorKind`(2 条)+ `listReviewsByProposalIds`(2 条)。
- `packages/db/src/work-items-detail.test.ts`:`readWorkItemDetail` 批量挂 `reviewerKind` + `observerActionCardItem`(2 条,含「无匹配行」的负例)。
- `apps/api/src/cost-labor-split.test.ts`:`by_assignee`/`ai_auto_merge` 装配 + 管理员门槛(6 条)。
- `apps/api/src/cost.test.ts`:`/api/pages/cost` 端到端接线 + 降级(2 条)。
- `apps/api/src/agent-army-dashboard.test.ts`:`/api/pages/agents` 的 KPI 接线 + 管理员门槛(1 条)。
- `apps/api/src/accepted-deliverables.test.ts`:`reviewer_kind` 透传(1 条)。
- `apps/api/src/work-items-service.test.ts`:`reviewer_kind` 透传 + `conversation_observer` 来源(含与 drive_comment 互斥优先级,4 条)。
- `packages/ui/src/gold-path/route-components.test.ts`:cost 页两张新卡(4 条)、agent-army KPI 卡(2 条)、workitem 过去时提示与置信度 pill(4 条)、drive 桌面提示(2 条)。

## 没做/存疑

- **labor-split「我」标签的语义边界**:`by_assignee` 的「我」判定用 `actorUserId === currentUserId`(当前请求者)。若管理员查看的是「别人的 run」,该行显示真实昵称;这与 `by_user` 现有惯例一致,未额外处理「管理员看别人视角下的『我』」这种多层视角混淆(判断这不是本批范围)。
- **`by_assignee` 与既有 `by_user` 的概念重叠未收拢**:审查纠误提到两者概念相近但字段来源不同(`by_user` 用 `cost_ledger_entries.userId` 反规范化列,`by_assignee` 是本批新加的 `agent_runs.actor_user_id` 真实执行身份)。这次严格按任务书要求实现新维度,没有去重构/合并 `by_user`——如需收敛,建议下一批评估直接用 `by_assignee` 取代 `by_user`(不在本批范围,未擅动)。
- **`ai_auto_merge` KPI 的分母口径**:分母是「今日全部通过评审」(人+AI),不是「今日全部合并的提议」——如果存在「通过评审但因撞车未能真正合并」的边缘情况,`ai_auto_merge.count` 会比「真正落地的自动合并次数」略高。这是对任务书「reviews 表 ai actor 的 merge 计数推导」最直接的字面实现;如需与 `merge_attempts.result='merged'` 对账到分毫不差,需要额外一次 join,判断超出本批需要,未做。
