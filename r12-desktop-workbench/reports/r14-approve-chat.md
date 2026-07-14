# R14 · 批 APPROVE-CHAT 完成汇报（群聊内看提议 / 审批，金链路收口）

> 施工说明书：`r14-release-readiness/06-approve-chat-design.md`（M1+M2+档③单工包，档③独立 commit）
> 分支：`r14/approve-chat`；基线 `843f605e`（设计稿定稿）
> Commit：`2625560b`（M1+M2 桌面）→ `5d242ec8`（档③服务端+落定行渲染）→ 本报告

## 完成矩阵

| 级别 | 内容 | 状态 | 落点 |
|---|---|---|---|
| M1 产出卡接活 | 「看提议」真按钮替换「后续批次接入」死文本，auto_merged 变体文案「看已采纳的提议」 | 完成 | `chat/render.ts` renderDeliverableCardHtml |
| M1 军团输出行接活 | `<details>` 深链死文本翻真可点按钮 `data-wb-army-open-proposal` | 完成 | `army/render.ts` renderArmyOutputsSectionHtml |
| M1 右栏只读详情 | 第四 owner（ownerId="proposal"），loading/detail/error 态，风险标签+标题去黑话+总结+检查项+逐处变更+终态 chip | 完成 | 新模块 `workbench/proposal/{render,panel}.ts` |
| M1 接线 | chat view onOpenProposal（照 onOpenDriveFile 同款）+ army panel 抛点击 + shell 汇流装配/dispose | 完成 | `chat/view.ts` / `army/panel.ts` / `shell.ts` |
| M2 通过 | opened 态「确认通过」→ reviewProposalWithoutMerge（复用 spotlight 纯封装）→ 忙态 → 重拉翻 reviewed 出合入键 | 完成 | `proposal/panel.ts` approve |
| M2 打回 | requires_reason 门控理由器（预设 chip+textarea，wh-wb 重写），空理由本地拦截不发请求，proposalRequestChangesReason 纯函数复用 | 完成 | `proposal/panel.ts` submitDeny + render reasonComposer |
| M2 合入 | reviewed 态渲 merge 键，payload 吃 review_actions.merge.request_json | 完成 | `proposal/panel.ts` merge |
| M2 温和话术 | 403=不归你审 / 409 撞车=降级去审批工作台（conflictsFromMergeError 判定，不渲 wh-spot 冲突卡）/ 网络=可重试；面板内联非 toast | 完成 | `proposal/render.ts` classifyProposalActionError |
| M2 回流档①② | onSettled → 产出卡「已处理」覆盖标（本机乐观）+ 军团面板后台重拉（输出行 status 翻新）；army 后台刷新守卫纳入 proposal owner 不挤掉审批现场 | 完成 | `chat/view.ts` markProposalSettled / `shell.ts` / `army/panel.ts` |
| 档③ ① | 提议源自行动卡条目 → publish 既有 `conversation.action_card.updated`（emitUpdated 同款事件形状，军团面板已监听自动后台刷新，跨客户端） | 完成 | `apps/api/src/routes/proposals.ts` createDefaultProposalSettledNotifier |
| 档③ ② | 往来源会话 post system_event `{event:'proposal_settled', proposal_id, outcome, title}`——新 event 取值非新 kind，零迁移零表零列（照 proposal_opened 同款写入口）；失败仅 warn 不影响 2xx | 完成 | 同上 + review/merge handler 尾部 settleNotifyBestEffort |
| 档③ 消费 | 聊天流落定行（标题+已通过/已合并/已打回+看提议深链；未知 outcome 诚实回退折叠系统行）；右栏审批后本就重拉详情自更新 | 完成 | `chat/render.ts` renderProposalSettledLineHtml |
| CSS | wh-wb-prop-* 全新前缀独立追加，零 wh-spot 泄漏（render.test 有专项断言），不动既有被 css.test 锁死的规则字符串 | 完成 | `css.ts` 尾部追加块 |
| 契约 | WorkbenchShellApiClient Pick 增补 reviewProposal/mergeProposal（api-client 既有具名方法，零新增面）；packages/contracts 未动（boundedConversationObjectContentSchema 宽松边界天然放行 proposal_settled content） | 完成 | `shell.ts:39-57` |

## 血缘字段事实（档③侦察结论）

- 链路：`proposals.branch_id → branches.agent_run_id → agent_runs.source_conversation_id / workspace_id / source_action_card_item_id`。
- 与军团输出行 `listOutputLinksForConversation`（`packages/db/src/repositories/conversation-runs.ts`）的 join 是同一条链，方向相反。
- 实现全走既有仓库方法：`createProposalRepository().findMergeContext(proposalId)`（返回 `agentRunId`）+ `createAgentRunRepository().findById(runId)`（run 行携带三个来源字段）。零迁移零新列零新查询方法。
- 无血缘场景（人工创建的提议 / branch 无 agentRunId，如单测里的计划提议）：warn `proposal_settled_no_run_lineage` 跳过，不猜会话。run 无来源会话（系统派发）：warn `proposal_settled_no_source_conversation` 跳过。

## 改过断言清单（全部为 M1 接活的正当行为变更，非迁就实现）

1. `chat/render.test.ts`「proposal_opened 产出卡」：删 `doesNotMatch(/<button/)` 与「后续批次接入」死文本口径 → 改为必须有 `data-wb-chat-open-proposal` 真按钮 +「看提议」文案（死文本换真接线，断言随行为翻转）。
2. `chat/render.test.ts`「proposal_auto_merged」：追加「看已采纳的提议」按钮断言。
3. `army/render.test.ts`「list mode」：删「深链」文案与 `proposal_href` 裸文本断言（死文本已删）。
4. `army/render.test.ts`「`<details>` disclosure」：改为断言 `<button … data-wb-army-open-proposal>`、仍无 `<a href>` 假跳转、无「跳转后续批次开放」死文本。
5. `task-plans-routes.test.ts` **未改**——它对注入 logger 的 warn 内容精确断言曾被回流 warn 污染，修复方式是把回流 warn 移到结构化日志（与既有 `proposal_revision_notify_failed` 同口径），不迁就断言。

## 测试计数

| 包 | 前 | 后 | 增量 |
|---|---|---|---|
| @workhub/desktop-webview | 1025 | **1048**（全绿） | +23：proposal/render.test 13 条、proposal/panel.test 8 条、chat/render.test 新增 2 条（本机覆盖标、落定行三变体+未知回退） |
| @workhub/api | 1345 | **1346**（1345 pass + 1 既有 skip） | +1：settledNotifier 三 outcome 时序 + 重复合并不重发 + 回流抛错不破 2xx |
| `pnpm -r typecheck` | — | 16/16 包全过 | — |

## 偏离与如实记录

1. **档③落点在 `routes/proposals.ts` 而非 `services/proposals.ts`**：工单文字提 services，设计稿 §7 明确「apps/api/src/routes/proposals.ts review/merge 成功尾部 publish」。bus、2xx 判定、actor、既有 revision-notify 先例全在路由层，服务层不持有消息写入口——按设计稿执行。`settledNotifier` 可注入（`false` 关闭），测试用记录桩，不碰共享 DB。
2. **`chat/view.test.ts` 未加「点击 → onOpenProposal」用例**（设计稿 §8 曾列）：`mountChatView` 在本 workspace 无直接单测先例（view.test.ts 只测纯函数；挂载需 SSE/document 监听，fake DOM 起不来，见该文件顶部注释与 onOpenDriveFile 的同款空缺）。覆盖口径改为：render.test 钉死 `data-wb-chat-open-proposal` 属性 + proposal/panel.test 钉死 showForProposal 全链路，view.ts 的委托分支是与 file_card 完全同构的三行转发。
3. **产出卡本地覆盖标文案「已处理 · 见落定消息」不区分通过/打回/合并**：档① 本地只知道「动过」，不瞎猜方向；精确落定态由档③ 的落定行（所有成员可见、含 outcome）承载。刷新后覆盖标消失、落定行仍在——设计稿 §5.5 预告过的乐观语义。
4. **档③不额外 publish `message.created`**：落定行与产出卡（proposal_opened）同款——写库不广播，实时性由 ① 的 action_card.updated（军团面板）+ 本机档①②承担，聊天流落定行在下次历史拉取时呈现。与 agent-runner postDeliverableSystemMessage 既有口径一致，不为本批新开广播面。
5. **默认回流器在无 PG 的单测环境会走到共享 DB 失败路径**：被 best-effort try/catch 收口成结构化 warn（与既有 request_changes 持久化通知块完全同款），既有测试全绿验证过。
6. spotlight/** 只读复用（import 纯函数 `proposalRequestChangesReason` / `reviewProposalWithoutMerge`），未改其任何文件；packages/db、packages/contracts、apps/web、packages/ui 零改动。

## 验收自查

- `pnpm --filter @workhub/desktop-webview test`：1048/1048 绿
- `pnpm --filter @workhub/api test`：1346（1345 pass + 1 既有 skip，0 fail）绿
- `pnpm -r typecheck`：16 包全过
- 浏览器管道端到端（隔离 PG:5433 + API:8791 套路）未在本工包内跑——单工包纪律禁 qa smoke/后台进程；建议集成者按设计稿 §8 的 6 个可验点走一遍真 key 冒烟。
