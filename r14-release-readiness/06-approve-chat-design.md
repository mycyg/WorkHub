# R14 · 批 APPROVE-CHAT 实现级设计（群聊内看提议 / 审批）

> 集成裁定（2026-07-14）：批准单工包 opus M1+M2 一起施工；档③服务端状态回流（review/merge 后 publish conversation.action_card.updated + proposal_settled system_event，additive）纳入同工包独立 commit——不留 fast-follow 尾巴，跨客户端真闭环一次到位。与 FEEDBACK 批的 chat/render.ts 占地按 §占地区分执行，本批先合。

> 状态：施工设计草案 · 2026-07-14 · 上游：pm-review-2026-07-14.md F1（金链路最后一公里断点，B/A 分级）+ 00-plan.md §5 B级1（「建议排 CHAT 批后第一优先」）
> 侦察基础（worktree r12-workbench-full，main=7a25c788）：右栏情境面板三控制器架构 · 产出卡/军团输出行 content_json 已存 proposal_id · 既有提议详情渲染/审批交互两处资产 · review/merge 端点语义 · 状态回流缺口
> 纪律：04 手册 13 条铁律不变；**零新表零迁移**（全复用 `client.pages.proposal` / `reviewProposal` / `mergeProposal` 与既有 `ProposalDetailVM`）；无 emoji / 去黑话 / 文档回真。
> 拍板红线（本批止血目标）：桌面（主战场）金链路 `建项目→群聊→拎活→行动卡→run→产出→审批` 的**最后两环**（看产出、审批）在群聊现场闭合，不再切 web `/approvals`。

---

## 0. 范围裁定

分两级交付，同一个新模块 `apps/desktop-webview/src/workbench/proposal/` 承载两级（**不拆两工包**，理由见 §7）：

- **M1 · 止血**（PM 分级 A，小时级）：产出卡 + 军团输出行的深链**接活**——点击 → 右栏情境面板打开提议详情**只读视图**（summary / 变更清单 / 检查项 / 当前状态）。移除两处「后续批次开放」死文本。
- **M2 · 闭环**（PM 分级 B，1–2 天）：右栏详情内联 **通过 / 打回两键**（复用 review/merge 端点，打回必填理由，409 冲突 / 403 权限温和话术），审批完成后右栏与聊天流**状态回流**。

M1 与 M2 共用同一次 `client.pages.proposal(id)` 拉取与同一份渲染骨架——`ProposalDetailVM.review_actions` 本身按 `status` 门控动作（`opened` 才有 approve/request_changes，`reviewed` 才有 merge，`merged/rejected` 无动作）。**「只读」与「可操作」不是两个视图，是同一渲染在不同 VM 状态下的自然分支**，故 M1 落地时详情渲染骨架已成型，M2 只是让 `review_actions` 存在时把按钮渲出来并接上处理器。这决定了拆两工包会重复搭建同一套骨架（§7）。

**非目标 / 明确不做（本批不碰）**：
- web 端不动（web 无群聊，F5 只读会话镜像另立 B 级；web `/approvals` 三栏工作台照旧）。
- 冲突解决全套（`renderProposalConflictCards` 那套多候选合并）不进本批 MVP——M2 的 merge 撞车（409）走**温和提示 + 「去审批工作台处理冲突」降级**（见 §5.4），不在右栏内联多候选冲突面板（那是 spotlight proposals 视图已有的重资产，右栏内联它需要额外注入其 CSS，超出止血范围）。
- 任务计划提议（task_plan）的「拆/不拆」`skip-plan` 分支不特化——右栏只做通用 review/merge 两键；计划类提议的特殊动作留给 spotlight/web。
- 主区消息「让 Cuu 接手这条」（F16）、记忆引用露出（F3/MEM）无关，不碰。

---

## 1. 侦察结论：可复用资产盘点（否决性检查先行）

**无否决性发现——数据侧全部就绪，proposal_id 两处都已落库。**

### 1.1 产出卡 / 军团输出行都已携带 proposal_id（零 additive 补缝）

- **产出卡**（chat 系统消息）：服务端 `apps/api/src/workers/agent-runner.ts:1418` `postDeliverableSystemMessage` 往来源会话 post 的 system_event，`content` = `{event:'proposal_opened'|'proposal_auto_merged', proposal_id, run_id, title, adds, dels}`（`:1421-1428`）。**`proposal_id` 已在 content_json 里**，M1 直接读取，无需改服务端、无需补列。
- **军团输出行**（右栏军团面板输出区）：`ArmyOutputLinkVM`（`packages/contracts/src/pages.ts:1615-1628`）= `{proposal_id, work_item_id, run_id, title, status, proposal_href, updated_at, changed_files?}`。**`proposal_id` + `status` 都在**，M1 直接读取。DOM 上 `data-wb-army-output="<proposal_id>"` 已存在（`army/render.ts:158`），只是点击未接线。

> 结论：**本批零迁移、零加表、零加列、零新 api-client 面**。唯一契约层面动作（M2）：`WorkbenchShellApiClient` 的 `Pick<WorkHubApiClient, ...>` 增补 `"reviewProposal" | "mergeProposal"`（这两个方法 api-client 早已具名存在，`packages/api-client/src/client.ts:502/507`，只是 shell 的 Pick 白名单没列——`pages` 已在列，M1 只读所需的 `pages.proposal` 已可用）。

### 1.2 右栏情境面板架构：三控制器 + `{ownerId, html}` 不透明插槽（可直接加第四个 owner）

`store.ts:22` `WorkbenchSidePanelContent = {ownerId: string; html: string} | undefined`——**右栏是个不透明插槽**，store 不认识任何具体视图类型，谁持有内容就把自己的 `ownerId` 写进去。现有三个 owner 共用它：

| 控制器 | 模块 | ownerId | 挂载方式 | 职责 |
|---|---|---|---|---|
| 网盘侧栏 | `workbench/drive/side-panel.ts` `mountDriveSidePanel` | `"drive"` | shell.ts 挂载一次、活过整窗生命周期 | file_card/网盘文件预览 + 版本历史 + 回滚 |
| 军团面板 | `workbench/army/panel.ts` `mountArmyContextPanel` | `"army"` | 同上 | 输出/军团/后台三区 + run 详情下钻 |
| （空态） | `army/render.ts` `renderArmySidePanelIdleHtml` | — | shell.ts `renderSide` 兜底 | 无 owner 认领时的空态文案 |

**关键机制（M1/M2 直接照抄的先例）**：
- **挂载模式**：`mountXxx(sideBodyEl, store, {client, locale, ...})` → 返回 handle（`showXxx` / `clear` / `dispose`）。控制器**直接持有真实 DOM 节点 `sideBodyEl`**（不是只拿字符串），这样能自己 `addEventListener("click")` 做事件委托 + 手动恢复滚动位置（`army/panel.ts:4/166` `savedListScrollTop`）。
- **发布**：内部 state 变化 → `store.setState({sidePanelContent: {ownerId, html: renderXxx(state)}})`；shell.ts 的 `renderSide`（`shell.ts:497-502`）只管 `sideBodyEl.innerHTML = state.sidePanelContent?.html ?? idle`，不认识联合类型。
- **owner 互斥 + 背景刷新守卫**：`army/panel.ts:70` `publish({background})` 检查 `store.getState().sidePanelContent?.ownerId === DRIVE_OWNER_ID` —— 用户正看文件预览时，军团的被动后台刷新只更内部缓存不动 DOM（drive 是「用户主动点的」，优先级更高）。**新 proposal owner 要进这套互斥语义**（见 §5.5）。
- **多监听器共存**：三控制器都 `sideBodyEl.addEventListener("click")`，各自只认自己的 `data-*` 选择器（drive 认 `data-wb-drive-*`、army 认 `data-wb-army-*`），选择器不相交即无冲突。**proposal 控制器认 `data-wb-prop-*`，天然不撞。**
- **单调代次防竞态**：`loadGeneration`（`drive/side-panel.ts:90` / `army/panel.ts:79` 注释）——晚到的 await 不覆盖更新的一帧。新控制器照抄。

### 1.3 既有「提议详情渲染 + 审批交互」两处资产（复用逻辑，不复用 CSS）

**资产 A · `spotlight/views/proposals.ts`（528 行，spotlight 聚焦盒的提议能力视图）——参考实现的权威来源**：
- `detailHtml(vm: ProposalDetailVM, zh)`（:94）：完整详情渲染（风险标签 + summary + 检查项 chips + 逐处变更 + approve/deny/merge 按钮），**但用 `wh-spot-*` 类**。
- `reasonComposerHtml(zh)`（:166）：打回理由输入器（预设理由 chips + textarea + 发送）。
- `proposalRequestChangesReason(preset, detail)`（:181）：**纯函数**——把预设 chip 与 textarea 合成一段 reason_md（可复用，无 DOM/CSS）。
- `proposalMergeConflictHtml(error, zh)`（:150）：409 冲突面板（`wh-spot-*` + `@workhub/ui/proposal` 的 `renderProposalConflictCards`）。
- `reviewProposalWithoutMerge(client, id, opts)`（:232）：**纯封装**——`reviewProposal(id, {decision:"approve", remember:"once"})`（可复用）。
- `createProposalsView().mount`（:240-528）：**完整审批交互循环的参考实现**——approve/deny/merge/reason/conflict 全套，含 `markBusy` 忙态、失败 toast、成功后 `showList`/`showDetail` 刷新、`data-prop-approve/deny/merge/submit-deny/reason/back` 事件委托。**本批 M2 控制器就是把这套循环从 spotlight ctx（`ctx.body`/`ctx.toast`/`ctx.requestResize`）适配到 workbench 右栏（store publish + 面板内联通知）。**

**资产 B · `desktop-proposal-actions.ts`（83 行，`handleDesktopProposalAction`）**：
- href 驱动的动作分发器：`proposalActionFromHref(href)` → review 走 `reviewProposalWithoutMerge`、merge 走 `mergeProposal`，处理 `requiresReason`（打回必填）/ 409 冲突 / 错误。
- **但它耦合 web-runtime 的 route-notice 机制**（`showRouteNotice` / `showPayloadFailureNotice` / `showMergeConflictNotice` / `reasonRequiredNotice` / `reviewReasonButtons`）——这套是桌面「web 风格路由页」（attention/approvals gold-path 路由组件）用的，**不适配 workbench 右栏的内联渲染范式**。
- **裁定**：M2 **不直接挂 `handleDesktopProposalAction`**（会把 route-notice 那套外壳拖进 workbench）。改为**复用资产 A 的纯逻辑原语**（`proposalRequestChangesReason` / `reviewProposalWithoutMerge` / 直接 `client.reviewProposal`/`mergeProposal`），交互循环照资产 A 的 `createProposalsView` 结构在右栏重写。任务书说的「复用 desktop-proposal-actions」在语义上通过复用同一批端点与同一套 reason 逻辑达成，但落点是资产 A 而非资产 B——如实记录这个取舍。

### 1.4 CSS 隔离：workbench 窗口不含 `wh-spot-*` 样式（决定「原生渲染」而非「直接复用 detailHtml」）

`shell.ts:62` `renderWorkbenchDocumentHead` = `<style>${appleGlassDesignSystemCss}${workbenchCss}</style>`——**只有设计系统 + workbench 自己的 `wh-wb-*`，没有 `spotlightCss`**。工作台是独立窗口独立文档（`boot.ts:2` 明确「工作台是独立窗口、独立生命周期」，刻意不 import browser.ts/spotlight）。

→ 若右栏直接塞 `detailHtml`（`wh-spot-*`），样式全丢，渲成裸 HTML。**两条路**：
- **(推荐) 原生渲染**：新写 `workbench/proposal/render.ts`，用 `wh-wb-*` 类（视觉对齐 drive/army 侧栏既有语言），复用 `ProposalDetailVM` 数据 + 资产 A 的纯逻辑原语。与三栏侧栏视觉一致，无跨窗口 CSS 污染风险。代价：多写一份详情渲染模板（约 120–160 行，含 loading/只读/可操作/理由器/错误/回流 各态）。
- **(不推荐) 注入 spotlightCss**：把 `spotlightCss`（282 行）也塞进 workbench `<style>`，直接复用 `detailHtml`。`wh-spot-*` 与 `wh-wb-*` 类名不撞，但 spotlight 样式是为「会生长的聚焦盒」设计的（容器 padding/背景/字号自成一套），塞进右栏与既有 drive/army 面板视觉不统一，且未来 spotlight 改样式会意外波及 workbench。**否决**——04 §4 铁律 + 视觉一致性。

→ **裁定：走原生渲染。** 复用 VM 数据形状与纯逻辑，重写 `wh-wb-*` 模板。

### 1.5 状态回流缺口（诚实记录，M2 需 additive 补缝或客户端兜底）

**关键发现：review / merge 端点当前不往来源会话回灌任何东西。** `apps/api/src/routes/proposals.ts` 的 review 路由只 `publishProposalEvents`（proposal 域 SSE，`:754`）+ 打回时给提交人落一条持久化通知（`:757-780`），**既不 `postSystemMessage` 到 `source_conversation_id`，也不 publish `conversation.action_card.updated`**（`grep` 证实：proposals.ts 里无 `postSystemMessage` / `action_card.updated` / `source_conversation`）。

会话流现有 SSE 事件（`chat/events.ts`）：`message.created` / `message.delta` / `typing` / `action_card.updated` / `message.updated` / `reaction.updated` / `read.updated` / `observer.analyzing`——**没有任何「提议被审了」的会话事件**。

后果：
- 审批后，群聊里那张产出卡文案永远停在「已起草…等待人工确认」，军团输出行 status 也不会自动从 `opened` 翻成 `reviewed/merged/rejected`（军团面板只在收到 `conversation.action_card.updated` 时后台重拉，而 review/merge 不发这个）。
- **跨客户端回流为零**：别的成员看不到「这份提议已被 XX 通过」。

→ 三档处置（M2 采**档②为主 + 档③作为推荐 fast-follow**，见 §5.5 / §6）：
- **档① 纯本地（最小）**：本机审批人自己发起的 review/merge，控制器知道结果——右栏就地重渲成 merged/rejected 只读态；聊天流产出卡靠本地 `settledProposalIds` 集合打一层「已处理 · 已通过/已打回/已合并」覆盖标（见 §5.5）。**零服务端改动**，但只本机可见、刷新页面即丢覆盖标（需重新从 VM 判定）。
- **档② 客户端联动军团面板刷新**：审批成功后控制器回调 shell → `armyPanel` 重拉当前会话（军团输出行 status 走 `ArmyOutputLinkVM.status` 自然更新为 reviewed/merged/rejected）。仍零服务端改动，输出行状态真实回流，本机可见。
- **档③（推荐 additive 补缝，无迁移无表）**：服务端 review/merge 成功且 proposal 有 `source_conversation_id` 时，**publish 一条 `conversation.action_card.updated`**（复用既有事件类型，军团面板已监听即自动后台刷新，`army/panel.ts:117-125`）——**跨客户端**输出行状态回流，零新契约。若还要产出卡本身翻状态给所有成员看，则**再 post 一条 `proposal_settled` system_event**（新 content shape，复用既有 `postSystemMessage` 与 `system_event` kind，**无迁移无表无新 DB kind**，照 `proposal_opened` 同款），产出卡渲染层加一个 `proposal_settled` 分支即可。档③是「AI 当默认劳动力闭环真正闭合」的完整答案，但它是服务端改动，需评估是否纳入本批或紧随 fast-follow。

---

## 2. 数据模型

**本批零迁移、零加表、零加列。** 全复用既有：
- 读：`GET /api/pages/proposals/:id` → `ProposalDetailVM`（`packages/contracts/src/pages.ts:1235-1255`）。
- 写：`POST /api/proposals/:id/review`（approve / request_changes）、`POST /api/proposals/:id/merge`。

（可选，仅当采纳 §1.5 档③的 `proposal_settled` 产出卡回流）：新增一个 **system_event content 变体** `{event:'proposal_settled', proposal_id, run_id, outcome:'approved'|'merged'|'rejected'}`——走既有 `postSystemMessage`、既有 `conversation_messages.kind='system_event'`、既有 content_json 列，**不加表不加列不加 DB kind不加迁移**，只是 content_json 里多一种 `event` 取值。

---

## 3. HTTP 端点

**零新端点。** 复用现有三条，语义原样：

| 端点 | 语义 | 客户端调用 | 本批新用途 |
|---|---|---|---|
| `GET /api/pages/proposals/:id` | 提议详情 VM（含 `review_actions` 按 status 门控） | `client.pages.proposal(id, {locale})` | M1 右栏只读 + M2 可操作，同一次拉取 |
| `POST /api/proposals/:id/review` body `{decision:"approve"\|"request_changes", reason_md?, remember}` | 通过 / 打回（request_changes 必带 reason_md，`proposals.ts:757`） | `client.reviewProposal(id, payload, {locale})` | M2 通过（approve）/ 打回（request_changes） |
| `POST /api/proposals/:id/merge` body=`review_actions.merge.request_json` | 合入交付物 | `client.mergeProposal(id, payload, {locale})` | M2 已审阅（reviewed）态的合入 |

**打回必填理由的权威信号**：`ProposalDetailVM.review_actions.request_changes.requires_reason`（`actionSpecSchema.requires_reason`，`pages.ts:52`）——右栏据此决定「打回」点下去先展开理由器、空理由拦截（`proposalRequestChangesReason` 返回 undefined 即提示「先写一句打回说明」，照资产 A `proposals.ts:507-512`）。

**契约层唯一改动（M2）**：`WorkbenchShellApiClient` 的 `Pick` 增补 `reviewProposal | mergeProposal`（`shell.ts:46`）。M1 只需 `pages`（已在）。

---

## 4. 桌面文件占地精确清单

> **与 FEEDBACK 批桌面工包的占地区分（关键）**：两批都动 `chat/render.ts` 与 `chat/view.ts`，但**函数级不相交**——
> - 本批（APPROVE-CHAT）动：`renderDeliverableCardHtml`（产出卡，render.ts:444-470）、`renderArmyOutputsSectionHtml`（军团输出行，army/render.ts:151-175）、view.ts **scroll 区**新增 `data-wb-chat-open-proposal` 分支（紧邻 file_card 的 `:2481` `data-wb-chat-open-file`）。
> - FEEDBACK 批动：`renderMessageToolbarHtml`（消息行 hover 工具条，render.ts:658）、`renderReactionRowHtml`（反应行，render.ts:630）、`renderMessageHtml` 的 **Cuu 消息行**（render.ts:739-764）、view.ts 的 `data-wb-chat-react`/反馈钮分支。
> - **共享文件但不共享函数**——`chat/render.ts` / `chat/view.ts` 是合并磁铁，集成者按函数块手解；两批各自的 `data-*` 命名空间（`open-proposal` vs `react`/反馈）天然隔离。建议两批不并行同一 commit 段，或本批先合（占地更小、更止血）。

### 4.1 新增模块 `apps/desktop-webview/src/workbench/proposal/`（本批主体，parallel to `drive/` `army/`）
- `render.ts` —— `renderProposalSidePanelHtml(state: ProposalSidePanelState, locale)` + `ProposalSidePanelState` 联合（`loading` / `detail`（含只读与可操作两态，由 `vm.review_actions` 决定渲不渲按钮）/ `reason`（打回理由器展开）/ `submitting` / `conflict_fallback` / `error`）。用 `wh-wb-*` 类。纯函数、可单测。
- `panel.ts` —— `mountProposalSidePanel(sideBodyEl, store, {client, locale, onBack, onSettled})` → `ProposalSidePanelHandle`（`showForProposal({proposalId})` / `clear` / `dispose`）。ownerId=`"proposal"`。照 `army/panel.ts` 结构：`loadGeneration` 防竞态、`sideBodyEl.addEventListener("click")` 委托 `data-wb-prop-*`、publish 到 store。审批交互循环移植自 `createProposalsView`（approve/deny/reason/merge/back）。
- `render.test.ts` / `panel.test.ts` —— node --test（无真实 DOM，照 chat/view.test.ts 顶部注释的纯函数测法 + panel 用最小 DOM stub，照 `army/panel.test.ts`）。

### 4.2 产出卡接活（M1）—— `apps/desktop-webview/src/workbench/chat/render.ts`
- `renderDeliverableCardHtml`（:444）：把 `:462-467` 的「提议详情页由后续批次接入这个窗口」死文本替换为一个真按钮 `<button data-wb-chat-open-proposal="<proposal_id>">看提议</button>`（`content["proposal_id"]` 读取，两个 event 变体都有）。`proposal_auto_merged` 变体按钮文案「看已采纳的提议」（打开即 merged 只读态）。保留 `+adds -dels`、时间戳。
- （M2 档① 回流）新增可选入参 `settledProposalIds?: ReadonlySet<string>` 进 `ChatRenderContext`——命中则产出卡追加「已通过/已打回/已合并」覆盖标（本地乐观回流，见 §5.5）。

### 4.3 军团输出行接活（M1）—— `apps/desktop-webview/src/workbench/army/render.ts`
- `renderArmyOutputsSectionHtml`（:151-175）：把 `<details>` + `:167` 的「深链：… （跳转后续批次开放）」死文本，改成真可点行——`<button class="wh-wb-army-out-row" data-wb-army-open-proposal="<proposal_id>">`（title + status chip + chevron）。`data-wb-army-output` 属性已存在可保留/改名。移除 `_proposalHref` 死文本展示。

### 4.4 军团面板接线（M1）—— `apps/desktop-webview/src/workbench/army/panel.ts`
- `ArmyContextPanelHandle` 输入加可选 `onOpenProposal?: (proposalId: string) => void`。
- click 委托（:208-232）加分支：`el.closest("[data-wb-army-open-proposal]")` → `input.onOpenProposal?.(pid)`。（army 面板不认识 proposal 详情，只把点击往外抛给 shell。）

### 4.5 聊天视图接线（M1）—— `apps/desktop-webview/src/workbench/chat/view.ts`
- `mountChatView` 入参加可选 `onOpenProposal?: (proposalId: string) => void`（紧邻 `:366` `onOpenDriveFile`，同款可选注释）。
- scroll 区 click 委托（紧邻 `:2481` file_card 分支）加：`const propBtn = target.closest("[data-wb-chat-open-proposal]"); if (propBtn?.dataset.wbChatOpenProposal) { input.onOpenProposal?.(propBtn.dataset.wbChatOpenProposal); return; }`。
- （M2 档① 回流）`ChatRenderContext` 传 `settledProposalIds`；控制器 `onSettled` 回调 → view 本地把该 id 加入集合并 `renderScroll()`。

### 4.6 外壳装配（M1+M2）—— `apps/desktop-webview/src/workbench/shell.ts`
- 挂载第四个控制器（照 `:229` driveSidePanel / `:242` armyPanel）：`const proposalPanel = mountProposalSidePanel(sideBodyEl, store, {client: input.client, locale, onBack: () => armyPanel.reshow(), onSettled: (proposalId) => { /* 本地回流：转发给当前 chat view + 令 armyPanel 后台刷新 */ }})`。
- 两处 chat view 挂载（主区 `:475`、协同 `:435`）与军团面板挂载各补 `onOpenProposal` / `armyPanel` 的 `onOpenProposal` → 统一指向 `(proposalId) => proposalPanel.showForProposal({proposalId})`。
- `dispose`（:610-611）补 `proposalPanel.dispose()`。
- （M2 契约）`WorkbenchShellApiClient` Pick 增 `reviewProposal | mergeProposal`（:46）。
- （M1 回流辅助）`armyPanel` 需一个轻量 `reshow()`（重新 publish 当前会话缓存态，不强制 refetch）——`army/panel.ts` 补一个把当前 `state` 重 publish 的导出方法；或退而用现成 `showForConversation(currentTarget)`（会 refetch，可接受）。onBack 返回军团面板（输出列表）。

---

## 5. 客户端设计

### 5.1 M1 入口与只读详情
- **两个点击源**汇流到同一 `proposalPanel.showForProposal({proposalId})`：
  1. 群聊产出卡「看提议」按钮（chat 中栏 → view.ts `onOpenProposal` → shell → proposalPanel）。
  2. 右栏军团面板输出行（army/panel.ts `onOpenProposal` → shell → proposalPanel）。
- `showForProposal` → `state={mode:"loading"}` publish → `client.pages.proposal(id, {locale})` → `state={mode:"detail", vm}` publish。`loadGeneration` 防竞态（照 army/drive）。
- 只读渲染（`renderProposalSidePanelHtml` detail 态）：顶部「← 返回」（`data-wb-prop-back` → onBack）+ 风险标签 + 标题（`publicProposalDisplayTitle` 复用 `@workhub/ui/proposal`，去黑话）+ summary + 检查项 + 逐处变更摘要 + 当前状态 chip（opened/reviewed/merged/rejected）。**`review_actions` 缺对应动作时不渲按钮**（merged/rejected 天然只读）——这就是 M1 的「只读」，无需专门只读模式。

### 5.2 M2 通过（approve）
- `opened` 态渲两键：「确认通过」`data-wb-prop-approve` + 「打回修改」`data-wb-prop-deny`（照 `detailHtml` :121-126 的语义，wh-wb 化）。
- 点「确认通过」→ 按钮忙态（`markBusy` 移植：禁用 + 「确认中…」）→ `reviewProposalWithoutMerge(client, id, {locale})`（= `reviewProposal(id,{decision:"approve",remember:"once"})`）→ 成功：refetch 详情（此时 status 翻 `reviewed`，若有 `review_actions.merge` 则渲「合入交付物」），面板内联成功提示；`onSettled(id)` 触发回流。失败：复原按钮 + 面板内联温和错误（见 §5.4）。

### 5.3 M2 打回（request_changes，必填理由）
- 点「打回修改」→ 若 `review_actions.request_changes.requires_reason`（权威信号）：详情下方展开 `reasonComposerHtml` 同构的 wh-wb 理由器（预设 chip「方向不对/细节要调整/缺少依据」+ textarea + 「发送打回说明」`data-wb-prop-submit-deny`），聚焦 textarea。
- 提交 → `proposalRequestChangesReason(preset, detail)`（复用纯函数）合成 reason_md；空 → 面板内联提示「先写一句打回说明」+ 聚焦，不发请求。非空 → 忙态 → `client.reviewProposal(id,{decision:"request_changes", reason_md, remember:"once"},{locale})` → 成功：面板回「已打回」只读态 + `onSettled(id)`；失败：复原 + 温和错误。

### 5.4 温和话术（403 / 409 / 网络）
- 全部**面板内联**渲染（非 toast——workbench 右栏范式是内联态，照 drive `preview_error`），文案分类照 `turn.ts` 既有分类模式：
  - **403 权限**：「这份提议不归你审（可能不是你的工作区，或已交给别人）。」+ 「去审批工作台看看」降级链（打开 web/spotlight 审批，或仅提示）。
  - **409 冲突（merge 撞车）**：「这份变更和别人的改动冲突了，得先在审批工作台里逐个处理冲突再合入。」+ 降级入口。**MVP 不在右栏内联多候选冲突解决**（§0 非目标）。
  - **网络/未知**：「没提交成功，稍后重试。」+ 重试按钮（重发同一动作）。
- 判定复用：`proposalMergeConflictHtml` 能识别冲突 error（`conflictsFromMergeError`）——M2 用它判定「是不是冲突」以切换到降级话术，但不渲染它那套 `wh-spot-*` 冲突卡。

### 5.5 状态回流（M2）
- **本机（档①+档②，本批落地）**：
  - 右栏：审批成功后 refetch 详情或就地翻只读态（approve→reviewed 可继续 merge；merge/reject→终态只读）。
  - 产出卡：`onSettled(proposalId)` → shell 转发给当前 chat view → view 把 id 加入本地 `settledProposalIds` → `renderScroll()` → `renderDeliverableCardHtml` 追加「已通过/已合并/已打回」覆盖标（乐观、本机、刷新即依 VM 重判）。
  - 军团输出行：`onSettled` → shell 令 `armyPanel` 后台重拉当前会话（`ArmyOutputLinkVM.status` 自然更新）。
- **跨客户端（档③，推荐 fast-follow 或纳入本批服务端小改）**：review/merge 成功且有 `source_conversation_id` → 服务端 publish `conversation.action_card.updated`（军团面板已自动监听刷新，零客户端改动）+ 可选 post `proposal_settled` system_event（产出卡对所有成员翻状态）。**如实标注：真正闭环需要档③；档①②只让本机审批人看到即时反馈。** 由集成者/用户拍板档③是否进本批。

---

## 6. additive 补缝方案汇总（诚实清单）

| 缺口 | 影响 | 补缝 | 是否需迁移/表 |
|---|---|---|---|
| 产出卡 content_json 有无 proposal_id | 无缺口 | 已有（agent-runner.ts:1423） | 否 |
| 军团输出行有无 proposal_id | 无缺口 | 已有（ArmyOutputLinkVM） | 否 |
| shell client 有无 review/merge | M2 缺 | Pick 增补两具名方法（已存在） | 否 |
| workbench 窗口有无 spotlight CSS | 有缺口 | 走 wh-wb 原生渲染（不注入 spotlightCss） | 否 |
| review/merge 有无回会话事件 | **有缺口** | 档③：publish 既有 `conversation.action_card.updated` +（可选）post `proposal_settled` system_event（新 content event 取值，非新 kind/表/列/迁移） | **否** |

---

## 7. 施工切片

**建议：单工包、单 opus、M1+M2 一起。** 理由：
1. **M1/M2 共用同一次拉取 + 同一渲染骨架**——`review_actions` 按 status 门控，「只读」是「可操作」的按钮不渲版，不是独立视图。拆两工包会重复搭 `workbench/proposal/render.ts` + `panel.ts` 的脚手架、重复接线 shell/view/army 四个触点。
2. **止血价值需两级合体**：只 M1 用户能看不能批，仍要切 web 审批——金链路仍断。M1+M2 才真闭合「产出→审批」两环。M2 增量小（审批循环整套是从 `createProposalsView` 移植的成熟逻辑，非从零设计）。
3. **opus**：涉及右栏第四 owner 的互斥语义、竞态代次、跨模块四触点接线、回流分档——判断密度高于机械改，opus 合适（照 01-chat-design.md W2-A desktop-chat-ui 同款用 opus）。

**工包边界**：新模块 `workbench/proposal/**` + 四触点（render 产出卡、army/render 输出行、army/panel 抛点击、chat/view onOpenProposal、shell 装配）。**不并入 FEEDBACK 批**（同文件不同函数，合并磁铁；建议本批先合，占地更小）。

**档③服务端小改**若纳入：可作同工包内的独立 commit（`apps/api/src/routes/proposals.ts` review/merge 成功尾部 publish action_card.updated + 可选 post system_event + `chat/render.ts` 加 `proposal_settled` 渲染分支 + PG smoke 断言），也可拆 fast-follow 由集成者定。

---

## 8. 验收

**mock/单测（node --import tsx --test，无真实 DOM）**：
- `workbench/proposal/render.test.ts`：各态快照——loading / detail(opened 有两键) / detail(reviewed 有 merge) / detail(merged 只读无键) / detail(rejected 只读) / reason 展开 / 冲突降级 / 错误。断言按钮 data 属性、无 `wh-spot-*` 泄漏（只用 `wh-wb-*`）、去黑话文案、状态 chip 双语。
- `workbench/proposal/panel.test.ts`：最小 DOM stub（照 army/panel.test.ts）——`showForProposal` 拉取 → publish ownerId="proposal"；approve 调 `reviewProposal({decision:"approve"})`；deny 空理由拦截、非空 → `request_changes` 带 reason_md；merge 调 `mergeProposal`；409 → 降级话术不崩；back → onBack；竞态：晚到 await 不覆盖。
- `chat/render.test.ts`：产出卡渲出 `data-wb-chat-open-proposal="<id>"`（两 event 变体）、死文本已消除；`settledProposalIds` 命中渲覆盖标。
- `army/render.test.ts`：输出行渲 `data-wb-army-open-proposal`、「跳转后续批次开放」死文本已消除。
- `chat/view.test.ts`：点 `data-wb-chat-open-proposal` → `onOpenProposal` 收到 id。
- 全量门：各包 `test` + `pnpm -r typecheck`（tsx 不严格查类型，务必补 typecheck，见记忆「写完测试要再 typecheck」）。

**浏览器管道可验点（4174 dist 管道已存在，参「工作台浏览器验证套路」记忆）**：隔离 PG:5433 + worktree API:8791 + localStorage `api_base` 覆写免 Tauri。冒烟脚本走通金链路尾段：建项目 → 群聊触发观察者拎活 → run 产出 proposal_opened 系统消息 →
1. 群聊产出卡「看提议」可点 → 右栏出提议详情（截图对比 diff 摘要）。
2. 右栏「确认通过」→ 详情翻 reviewed/出「合入交付物」→ merge → 终态只读。
3. 「打回修改」→ 理由器展开 → 空理由拦截 → 填理由发送 → 「已打回」。
4. 军团面板输出行可点 → 同一右栏详情。
5. 回流：审批后产出卡覆盖标出现、军团输出行 status 翻 reviewed/merged/rejected（档②本机）。
6. 温和话术：构造 409（并发改同文件）验降级提示不白屏、不假接线。

**真机验（Tauri .app）**：右栏第四 owner 与 drive/army 互斥不打架（点文件预览能盖过提议详情、提议详情不悄悄挤掉文件预览——照 §1.2 背景刷新守卫），返回军团面板滚动位置恢复。

---

## 附：关键文件行号索引（施工直达）

- 产出卡渲染死文本：`apps/desktop-webview/src/workbench/chat/render.ts:444-470`（`renderDeliverableCardHtml`，死文本 `:462-467`）；dispatch `:722-732`（`renderMessageHtml`）。
- 军团输出行死文本：`apps/desktop-webview/src/workbench/army/render.ts:151-175`（死文本 `:167`）；VM 契约 `packages/contracts/src/pages.ts:1615-1636`。
- 右栏插槽：`store.ts:16-49`（`WorkbenchCenterTab`/`WorkbenchSidePanelContent`）。
- 侧栏控制器先例：`drive/side-panel.ts`（`mountDriveSidePanel`，:51/:78 publish/:237 click 委托）；`army/panel.ts`（`mountArmyContextPanel`，:47/:66 publish 背景守卫/:208 click/:162 run 详情下钻/:171 backToList 滚动恢复）。
- 提议详情渲染 + 审批循环参考实现：`spotlight/views/proposals.ts`（`detailHtml`:94、`reasonComposerHtml`:166、`proposalRequestChangesReason`:181、`proposalMergeConflictHtml`:150、`reviewProposalWithoutMerge`:232、`createProposalsView.mount`:240-528，事件委托 :446-515）。
- href 动作分发器（不直接复用，语义参考）：`desktop-proposal-actions.ts`（`handleDesktopProposalAction`）。
- ProposalDetailVM：`packages/contracts/src/pages.ts:1235-1255`；`actionSpecSchema.requires_reason` `:52`。
- review/merge 端点：`apps/api/src/routes/proposals.ts:757`（request_changes 必带 reason + 通知）；回流缺口证实（无 postSystemMessage/action_card.updated）。
- api-client：`reviewProposal` `client.ts:502`、`mergeProposal` `:507`、`pages.proposal` `api-client.test.ts:209`；shell Pick `shell.ts:39-46`。
- 聊天视图接线点：`chat/view.ts:340`（mountChatView 入参）、`:366`（onOpenDriveFile 先例）、`:2481-2488`（file_card click 先例）。
- 外壳装配：`shell.ts:227-263`（driveSidePanel/armyPanel 挂载 + showIdle/clear）、`:435`/`:475`（两处 chat view 挂载 onOpenDriveFile）、`:497-502`（renderSide）、`:610-611`（dispose）。
- 服务端产出卡 content 形状：`apps/api/src/workers/agent-runner.ts:1387-1439`（`postDeliverableSystemMessage`，`proposal_id` `:1423`）。
- CSS 隔离：`shell.ts:62`（workbench 只含 appleGlassDesignSystemCss+workbenchCss）；`spotlight/css.ts:7`（spotlightCss，不在 workbench 窗口）。
