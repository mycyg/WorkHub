# F-05 撞车「先选稿再采纳」：把 choose 接成多冲突融合稿选择器

- Status: implemented
- Date: 2026-09-05
- Owner: claude（接班施工，工位 r23/p6b-conflict-choose）

## Problem

接线审计发现 POST `/api/merge-proposals/:id/choose`（选定某份 AI 融合候选）端点/契约/SDK
（`chooseMergeProposalCandidate`）全在，零调用者；apply 反而四处真调用（web browser.ts、
桌面 attention/proposals/editor 三处 runConflictAction、Cuu 卡）。按「全部预留功能落地，
不允许界面未上线」的既定口径（见 implemented/2026-08-20-land-all-reserved-features.md），
choose 需要接上真实 UI，不能继续做零调用的死代码。

关键地基问题：`choose` 到底在选什么「候选」？读服务层才弄清楚——

- 每个撞车目标（一个 `target_key`/`merge_proposal_id`）当前**只会**生成一份 `option_key:
  "ai_fusion"` 的候选（`apps/api/src/services/merge-fusion-candidates.ts` 两处
  `option_key: "ai_fusion"` 硬编码：LLM 路径与确定性 diff3 兜底路径都只产出 1 份）。
- apply 默认落到 `chosenOptionKey ?? "ai_fusion"`（`packages/db/src/repositories/proposals.ts`
  的 `findMergeProposalCandidateForApply`）——这正是过去 4 个 apply 调用点不经 choose 也能工作的
  原因：单一候选时 choose 是纯粹的确认动作，不影响最终写回哪份候选。
- 于是「多候选」的真实含义 = **一份提议里有多个撞车目标，每个目标各自生成了一份融合稿**，
  不是同一个目标有多份可比较的融合稿备选（schema 允许后者，但生成器从不产出）。

## Decision

- 渲染层（`packages/ui/src/proposal/render.ts`）新增 `renderConflictChooser`：当
  `fusionChooserCandidates(conflicts)`（跨 conflicts 筛出 `merge_proposal_id` 存在且
  `ai_fusion` action.id === "apply_ai_fusion" 的那些）数量 **≥2** 时，才渲染一个
  「选一份合并方案」选择器——单选 radio（`data-conflict-chooser-option` +
  `data-merge-proposal-id` + `data-proposal-id`）+ 一个隐藏的提示条
  （`data-proposal-conflict-chooser-warning`，未选中就点击时才 `removeAttribute("hidden")`）
  + 一个确认按钮（`data-proposal-conflict-chooser-submit`）。少于 2 份时直接跳过，函数
  返回空 html——**保持既有一键采纳，不新增这一步**（对应 i18n 注释里「只有一处时仍是一键
  采纳」的既定意图）。
- 被分组的那些冲突，各自卡片里原本的 `ai_fusion` 简单按钮换成一条「已并入上方」指路条
  （`data-conflict-option-handled-above="true"`），避免同一个 apply 端点有两个互相打架的
  入口（一个在选择器里、一个在卡片上）造成手误。keep_current/accept_incoming 两个选项
  完全不受影响——它们是独立决策，走既有 `/merge` 内联解决。
- **刻意不动**的两处：
  1. 逐段行编辑器（`route-line-editor.ts`）与重叠段复核（`overlap-hunk-review.ts`）——
     这两个是文本类冲突才有的进阶工具（diff3 quality_gate 数据驱动），本身就是主动展开、
     逐段挑选的高意图交互，不是「一键就发」的简单按钮，misclick 风险模型不一样；把它们也
     纳入选择器网关需要连带改两个组件的粒度语义，超出这次范围。**已知代价**：被分组的冲突
     如果恰好是 text_doc/spec_doc 且带 diff3 数据，仍能通过这条进阶路径直接 apply，绕开
     选择器——多一个入口，不多一个风险（进阶路径本就要求先展开、挑段落，misclick 门槛更高）。
  2. `apps/desktop-webview/src/desktop-cuu-runtime.ts` 的 `proposal-merge-candidate-apply`——
     `cardFromProposalConflict`（`packages/cuu/src/cards.ts`）逐个 conflict 建卡，Cuu
     气泡一次只呈现一个冲突的一个候选，不存在「多个候选并排、容易点错」的场景，维持
     直接 apply。
- 共享逻辑落 `packages/web-runtime/src/action-payload.ts`：
  `selectedConflictChooserCandidate(container)`（读 `:checked` 的
  `data-merge-proposal-id`/`data-proposal-id`）+
  `chooseThenApplyMergeCandidate(client, mergeProposalId, options)`（先 choose、成功后才
  apply，choose 失败直接冒泡不掩盖）——web、桌面 spotlight（attention/proposals）、工作台
  编辑器三条链路都调同一对函数，行为不会三处各写一份、悄悄跑偏。
- 四个接线点统一用「未选中 → 点亮选择器自带的隐藏提示条」而非各写 toast/notice——工作台
  编辑器的 conflict 态本来就没有独立提示槽，这样四处只用一套机制，不用为编辑器单独扩
  `EditorViewState`。
- 提交按钮本体没有真实 href（选中哪个候选是运行时才知道），用一个不指向任何真端点的占位
  `data-action-href="/api/merge-proposals/choose-selected"` 过掉各端「这是个可执行动作」的
  最外层门（web 的 `a[href],[data-action-href],[data-href]` 门、desktop 的
  `[data-prop-conflict-panel] [data-action-href]` 门），真正的 id 全部从选中的 radio 读，
  从不触达这个占位 href 本身。
- 三处桌面客户端切面（`AttentionInboxApiClient`/`WorkbenchShellApiClient`/
  `EditorViewApiClient`）补 `chooseMergeProposalCandidate`——`WorkHubApiClient` 早已具名
  存在，boot 传的就是全量客户端，零新增 api-client 面。
- 契约（`packages/contracts`）/OpenAPI/SDK **未改动**：choose 所需的一切（`merge_proposal_id`
  已在 `ProposalConflict.merge_proposal_id`、`option_key` 恒为 `"ai_fusion"`）都已存在，选择器
  的 choose href 由渲染层直接拼 `conflict.merge_proposal_id` 得到，不需要新字段。

## Alternatives considered

- 把「多候选」理解成同一个冲突里的多份融合稿备选，给 schema 加数组字段：否决——生成器
  从没产出过这种数据，会做出一套无法用真实数据驱动、只能靠手搓 fixture 验证的界面，
  且要动契约（`proposalConflictOptionSchema.id` 目前是三值枚举）。
- 只做「多选/全选」批量 apply（类似既有 `renderConflictWorkbench` 的批量保留/采纳）：
  否决——choose 端点语义是「登记选中哪一份」，一次只认一个 option_key，没有批量 choose
  接口；且批量一键把好几份 AI 生成的融合稿一次性写正式版，与「先选稿再确认，降低手误」
  的初衷相反。
- 提交按钮直接给真实 href、靠「radio 改变时同步更新按钮 href」的 change 监听：否决——
  多一层状态同步、多一处可能和真实选中状态失焦的 bug 面；选择在提交这一刻直接读
  `:checked` 更简单也更不容易错。

## Consequences

- 新的「先选稿再采纳」路径成功后会重拉当前路由/列表（`renderCurrentRoute`/`refresh`/
  `reload`）；失败复用既有 rebase_required/merge_conflict 回显（本来就调
  `renderProposalConflictCards`，重渲染出的新一批 conflicts 若仍 ≥2 份带融合稿，选择器
  自然又出现，无需特殊处理）。
- 测试覆盖：`packages/ui/src/proposal/render.test.ts`（多候选分组 + 单候选保持一键两个
  场景）、`packages/web-runtime/src/action-payload.test.ts`（选中态读取 + choose→apply
  顺序 + choose 失败不掩盖）、`apps/desktop-webview/src/spotlight/views/attention.test.ts`
  （`mountAttentionInbox` 端到端：选中态全链路 + 未选中态点亮提示条）。**已知缺口**：
  `apps/web/src/browser.ts` 与 `apps/desktop-webview/src/workbench/editor/view.ts` 的接线
  只过了 typecheck，没有专门的挂载态单测——前者是因为 browser.ts 的点击分发历来没有
  DOM 模拟测试先例（现有回归全靠共享 web-runtime 函数 + smoke，超出这次工位范围新建整套
  harness）；后者是因为 `workbench/editor/view.ts` 本来就没有任何 `view.test.ts`（只有
  `render.test.ts` 测纯渲染半边），是既有缺口，不是这次引入的新缺口。两处都是与
  attention.ts/proposals.ts 逐字同构的同一段代码（`runConflictAction` 的同一处分支），
  故复用同一份 `chooseThenApplyMergeCandidate`/`selectedConflictChooserCandidate` 的测试
  可信度可以合理外推，但严格意义上这两处仍待真机/更完整测试收口。
