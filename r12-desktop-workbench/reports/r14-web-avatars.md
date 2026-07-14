# R14 批 CHAT · W1-C web-avatars · 完成汇报

分支：`r14/web-avatars`
Worktree：`/Users/apple/.codex/worktrees/WorkHub/r14-web-avatars`
背景：`r14-release-readiness/pm-review-2026-07-14.md` F6——AVATAR 批（`r14-avatar.md`）落地的渲染点集中在桌面
（聊天行/成员条/建群选人器），web 因为没有群聊、成员列表也稀薄，用户在 web 设置里传了头像，回到 web
却看不到它出现在任何协作场景。PM 建议：「把头像铺到 web 已有的人出现的地方——审批工作台的审批人/负责人、
工单 assignee、军团 run 执行者身份、项目成员区。这些 VM 已带 user_id，加一个 `avatarTileHtml` 等价渲染即可」。

## 做了什么

1. **可复用的只读头像 tile helper**：新文件 `packages/ui/src/avatar/avatar-tile.ts` 导出
   `personAvatarTileHtml({ userId, label, size? })`，纯字符串渲染、零 DOM 依赖（同 `avatar-crop.ts` 的约定）。
   复用设置页头像预览已经在用的三个 class（`.wh-avatar-preview`/`.wh-avatar-fallback`/`.wh-avatar-img`，
   定义在 `route-components.ts` 的 `webRouteComponentCss`），只加一个更小尺寸的 modifier
   class（`.wh-avatar-preview--sm`，18px，供列表行内联使用）——不是重新发明视觉，沿用 web 现状已经选定的
   「首字母色块打底 + `<img>` 叠加，onerror 时 `<img>` 保持 hidden、色块天然兜底」这套回退模式。
   没有配对昵称时（如审批的 `routed_to_user_id`）`label` 传空串：回退字母显示 `?`，整个 tile 标
   `aria-hidden`（没有可读人名，不对屏幕阅读器宣称"这是一张头像"），但图片本身仍照常尝试加载。
   6 条单测（`avatar-tile.test.ts`）覆盖：默认小尺寸+回退首字母、拉丁文大写首字母+可访问名、空 label
   回退 `?`+decorative、纯空白 label 同样回退、`size: "md"` 变体、userId/label 转义防注入。
   与桌面 `apps/desktop-webview` 的 `avatarTileHtml`（`workbench/chat/render.ts`）故意不共享实现——
   桌面按 userId 算 hue 给每个人分配不同底色，web 从一开始就用统一中性底色，这里延续 web 自己已选定的
   简化视觉；范围围栏也不许碰 `apps/desktop-webview`。
2. **水合步骤**：`apps/web/src/browser.ts` 新增 `bindAvatarTiles(container, signal)`，挂在 `bindReadyRoute`
   末尾（不按 route key 过滤，任意路由都可能出现头像 tile）。查找所有 `[data-r14-avatar-tile-user-id]`，
   把 `<img>` 的 `src` 指向 `/api/users/:id/avatar`（web 走 cookie 鉴权，直连即可，不需要像桌面
   `hydrateAvatarPhotos` 那样走鉴权 fetch+blob），`onload` 显示、`onerror` 保持隐藏。逻辑上是设置页
   `bindSettingsAvatarPanel` 里 `showAvatarUrl` 那套的泛化版本，只是覆盖任意个数的只读 tile，不带
   上传/删除交互。
3. **逐点铺开**（`packages/ui/src/gold-path/route-components.ts`）：见下表。

## 铺开点清单（VM 已带 user_id，加了头像）

| # | 页面/位置 | VM 字段（user_id + 配对昵称） | 改动 | data 钩子 |
|---|---|---|---|---|
| 1 | 成本看板「按人花费」行 | `CostDashboardVM.by_user[].user_id` + `.label` | 头像铺在名字前 | `data-r9-cost-user` 不变 |
| 2 | 成本看板「按执行者分账」行（PM 说的"军团 run 执行者身份"） | `CostDashboardVM.by_assignee[].user_id?`（可选）+ `.label` | 有 user_id 才铺；「系统」桶维持纯文字，不编假头像 | `data-r13-cost-assignee` 不变 |
| 3 | 首页项目桌 + `/projects` 列表 两处项目行的「负责人」药丸 | `ProjectListItemVM.owner_user_id?`（可选）+ `.owner_nickname` | 有 id 才铺 | 新 `data-r14-avatar-tile-user-id`（两处一致改法） |
| 4 | 会议页每条会议行的上传者 | `MeetingRecordVM.uploaded_by_user_id`（必填）+ `.uploaded_by_label` | 头像铺在文字前 | 同上 |
| 5 | 审批工作台右栏「已路由/未路由」药丸 | `ApprovalRequest.routed_to_user_id?` **无配对昵称** | 加头像（无姓名回退，图片仍照常尝试加载） | 同上 |
| 6 | 审批工作台右栏新增「已委派」药丸 | `ApprovalRequest.delegated_to_user_id?` **无配对昵称、此前零展示点** | **新增**同款药丸（仅存在时出现）+ 头像 | 新 `data-r14-approval-delegated="true"` |
| 7 | 工单详情上下文卡新增「负责人」药丸 | `WorkItem.claimed_by_user_id?` + `.claimed_by_nickname?` **契约早就有，web 端此前从没渲过** | **新增**文字 + 头像一起铺（不是给已有文字加图） | 新 `data-r14-workitem-claimed-by="true"` |

第 6、7 两点是"VM 早有数据、但此前连纯文字都没展示过"——不是给已有文案加图，而是把本来就有、
一直没用的信息第一次显性化，顺带带上头像。做的理由：两点都被 PM 明确点名（"委派人""工单 assignee"），
且都是最小侵入的加法（一枚条件渲染的 pill，不挪动/重排任何既有结构），风险可控。

## VM 缺 user_id 的人物出现点（如实立案，未改 API/契约）

按范围围栏「VM 缺 user_id 的面禁止去改 API/契约加字段」，以下是排查中发现的、web 端已经在展示某个人
（一段 label 文本）却**没有配对 user_id** 可用的点，本批未动，供后续批次评估是否值得给 API/契约加字段：

| 位置 | 现状字段 | 缺什么 |
|---|---|---|
| 审批详情面板时间线（`renderApprovalDetailPanel` 的 `timelineSection`） | `ApprovalRoutingStep.actor_label?` | 无 `actor_user_id` |
| 审批详情面板讨论区评论作者（同函数 `commentsSection`） | `ApprovalCommentVM.author_label` | 无 `author_user_id` |
| 审批工作台左栏「最近已处理」列表 | `ApprovalCenterVM.decided[].decided_by_label?` | 无 `decided_by_user_id` |
| 项目主页（`/projects/:id`，非列表页）头部「负责人」药丸 | `ProjectHomePageVM.project.owner_label` | 无 `owner_user_id`（注意：`/projects` 列表页与首页项目桌用的是另一个类型 `ProjectListItemVM`，**那个有** `owner_user_id`，已铺，见上表第 3 点；只有主页这个单独的 `project.owner_label` 字段缺） |
| 网盘评论作者（`DriveCommentVM.author_label`） | 同上 | 无 `author_user_id` |
| 回放页合并时间线（`replayMergeAttemptVmSchema.actor_user_id?` / `decisions[].chosen_by_user_id?`） | 这两个字段**其实带 user_id**，但 `packages/ui/src/replay/render.ts` 从没渲过任何配对的昵称/标签——不是"缺 id"而是"从没展示过这个人是谁"，比 claimed_by 更深一层（回放页信息密度已经很高，是否该加一整块"谁做的这个合并决策"UI 需要更完整的设计，未在本批擅自加） |
| `/dashboard/agents`（军团面板本身，`AgentArmyDashboardPlanVmSchema`） | 无任何 user_id 字段 | 整页都是 AI-run 口径（计划/角色计数/预算/judge 通过率），没有一处绑定到具体某个真人；"军团 run 执行者身份"这个 PM 用语实际落点是成本页的「按执行者分账」（已铺，见上表第 2 点），不是这个面板 |
| `apps/desktop-webview` 的 `WorkbenchMemberVmSchema`（工作台成员条，`user_id`+`nickname`） | 有 user_id，但这是**桌面独占 VM**，web 端完全不消费（无群聊工作台页面） | 不适用于本批（web-avatars 范围），非"缺字段"而是"web 没有这个页面" |

## 测试数字（最终全量跑，全绿）

| 命令 | 结果 |
|---|---|
| `pnpm --filter @workhub/ui test` | 193 tests, 193 pass, 0 fail（含新增 `avatar-tile.test.ts` 6 条 + `route-components.test.ts` 新增 5 条铺开点覆盖） |
| `pnpm --filter @workhub/web test` | 73 tests, 73 pass, 0 fail（`routes.test.ts` 50 条含在内，未新增——现有断言全部原样通过） |
| `pnpm -r typecheck` | 16/16 workspace 项目 0 错误（含 `apps/desktop-webview`，未touch 但确认未被波及） |

新增/改动测试逐条对应：
- `packages/ui/src/avatar/avatar-tile.test.ts`（新文件，6 条）：默认小尺寸渲染+回退首字母、拉丁文首字母
  大写+可访问名、空 label 回退 `?`+decorative、纯空白 label 同样回退、`size:"md"` 变体、注入转义。
- `packages/ui/src/gold-path/route-components.test.ts`：新增 5 条（claimed-by 头像有/无两态、成本
  by_user 头像、by_assignee 真人有头像/系统桶无头像、审批 routed 头像+新增 delegated 药丸、会议上传者
  头像、home+projects 两处 owner 头像）+ 修正 1 条既有断言（见下）。

### 撞见并正当更新的既有断言

`route-components.test.ts` 的 `"Approvals route component does not leak raw approval facts"`
断言 `routed_to_user_id` 的原始 UUID **完全不出现**在渲染的 HTML 里。这条断言的本意是"审批人的原始
UUID 不该被当作人类可读内容裸露给用户"——在本批之前完全正确，因为除了算一个布尔"已路由"药丸，
这个字段没有任何合法理由出现在 DOM 里。本批给它加了合法用途：作为头像 tile 的
`data-r14-avatar-tile-user-id` 钩子（供 `browser.ts` 水合真实头像图），与本文件里
`data-r9-cost-user`/`data-r13-cost-assignee` 已经在用的"user_id 进 data 属性"是同一套先例，不是
新发明的口子。没有直接删掉这条断言（那是纯迁就），而是把它改得更精确：仍然要求这个 UUID
**只能出现在这一个 data 钩子属性里**，除此之外（任何 pill 文本、任何其它属性）一次都不能出现——
断言的原始意图（"不当人类可读内容裸露"）完整保留，只是判定方式从"完全不出现"精确到"只允许出现在
这一个已知合法的钩子里"。

## 关键文件

- `packages/ui/src/avatar/avatar-tile.ts`（新增）——`personAvatarTileHtml` helper。
- `packages/ui/src/avatar/avatar-tile.test.ts`（新增）——6 条单测。
- `packages/ui/src/index.ts`——导出新文件。
- `packages/ui/src/gold-path/route-components.ts`——7 处铺开点 + CSS modifier `.wh-avatar-preview--sm`。
- `packages/ui/src/gold-path/route-components.test.ts`——5 条新测试 + 1 条既有断言的正当更新。
- `apps/web/src/browser.ts`——`bindAvatarTiles` 水合步骤，挂进 `bindReadyRoute`。

## 未做/留给后续的

- 上面"VM 缺 user_id"表格里的 7 个点，按范围围栏未动 API/契约，留给后续批次判断是否值得加字段。
- 回放页（replay）的合并决策归属（`chosen_by_user_id`/`actor_user_id`）虽然带 id，但因为从零开始
  （没有任何配对昵称、也没有现成的"谁做的"文本可以直接挂头像），需要更完整的信息架构设计，未在本批
  擅自加一块新 UI——不是"缺 user_id"而是"缺一整块尚未设计的展示"，性质与其余立案项不同，故单独说明
  而不是简单归入立案表。
