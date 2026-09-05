# 侦察 D：F-01..F-10 施工单核实 + 独立接线审计

- 仓库：/Users/apple/Desktop/开发项目/WorkHub（分支 main-integration，含 2026-08-20 未提交改动，按当前文件内容审）
- 方式：只读。全仓 grep（apps/、packages/、client-tauri/、scripts/），端点/SDK/动作名/invoke 名四路对账脚本 + 逐条人工复核。
- 口径：`.agents/notes/implemented/2026-08-20-land-all-reserved-features.md`（完成标准＝端点+服务+至少一端 UI+实测）与 `2026-08-20-reserved-endpoints-and-sdk-policy.md`（api-client 零调用方法属正常 SDK 面）。

---

## 任务一：F-01..F-10 逐项核实

### F-01 OKR 目标列表/详情 —— 部分落地（web 有创建/挂链，无持久列表）

| 层 | 现状 | 证据 |
|---|---|---|
| 仓库层 | 有 createObjective / linkWorkItem / readObjectiveProgressSnapshot / listObjectiveTitlesByIds / listActiveObjectiveIdsForWorkspace；**没有「按工作区/项目列目标（带标题+进度）」的单条查询** | packages/db/src/repositories/objectives.ts:69-93 |
| 服务层 | ObjectiveService 只暴露 planningContext / refreshObjectiveProgress / createObjective / linkWorkItem / refreshWorkspaceObjectives | apps/api/src/services/objectives.ts:36-61 |
| 路由 | 只有 POST `/api/objectives`、POST `/api/objectives/:id/link`；**无 GET 列表 / GET 详情** | apps/api/src/routes/objectives.ts:52, :81 |
| OpenAPI | 已标注这两个 POST | apps/api/src/openapi.ts:9128, :9174 |
| SDK | createObjective / linkObjective（都有真实调用者） | packages/api-client/src/client.ts:506, :511；types.ts:365-366 |
| web UI | 项目主页「目标（OKR）」卡：SSR 骨架 + 客户端水合，能建目标、能把工作项挂上去；**列表只是会话内内存态，刷新即失**（代码注释已自认「服务端没有列全部已有目标的端点」） | packages/ui/src/gold-path/route-components.ts:4575-4594；apps/web/src/browser.ts:2862-2865（注释）、:2909-3013 |
| 桌面 UI | 只有时间线行上的只读 OKR tile（读 `objective_ids`/`objective_titles`），**无列表/详情/创建** | apps/desktop-webview/src/workbench/timeline/render.ts:297-307 |

**缺口**：仓库层 list 查询（工作区/项目维度，带 key results 与 progress）→ 服务层 listObjectives/getObjective → GET `/api/objectives`、GET `/api/objectives/:id` → OpenAPI（app.test.ts 有运行时/契约路由覆盖门，见 F-10）→ SDK 两方法 → web 把内存列表换成真拉取 + 详情抽屉。
**依赖**：无（自足）。**迁移**：不需要，表和列已在（objectives / key_results / objective_work_items）。
**切法**：packages/db/src/repositories/objectives.ts 加 `listObjectivesForWorkspace`（cap+游标，仿 listActiveObjectiveIdsForWorkspace）→ services/objectives.ts 加两方法 → routes/objectives.ts 加两 GET（工作区栅栏同 POST）→ openapi.ts → api-client（client.ts + types.ts）→ browser.ts:2867 的 `bindProjectHomeObjectivesPanel` 首屏改真拉取。契约要不要加：建议把返回 VM 放 packages/contracts（现在 POST 的返回是路由内联 shape）。
**工作量**：M。**模型**：sonnet。

---

### F-02 权限策略新增/调整 —— 后端齐、SDK 缺 3 个、UI 只有「撤销」

| 层 | 现状 | 证据 |
|---|---|---|
| 路由 | GET `/api/permissions`（admin）、PUT `/api/permissions`（**本地客户端 + admin**）、DELETE `/api/permissions/:id`（admin）、POST `/api/permissions/ask` 全在 | apps/api/src/routes/permissions.ts:77, :83, :92, :102 |
| OpenAPI | 三条路径都标了 | apps/api/src/openapi.ts:7592, :7605, :7613 |
| SDK | **只有** revokePermissionPolicy（DELETE） | packages/api-client/src/client.ts:717-721 |
| 列表数据源 | 前端拿策略列表走的是 settings 页 VM，不是 GET /api/permissions | apps/api/src/routes/pages.ts:1048-1051；apps/api/src/pages/settings.ts:13,32-34 |
| web UI | 只读列出 + 「撤销」按钮标 `data-requires-desktop="true"`（把用户推到桌面） | packages/ui/src/gold-path/route-components.ts:5766-5776 |
| 桌面 UI | 有策略区 + 两段确认撤销（真调 DELETE） | apps/desktop-webview/src/spotlight/views/settings.ts:265, :906-935 |

**缺口**：① SDK `listPermissionPolicies` / `createPermissionPolicy`(PUT) / `askPermission`(POST /ask)；② 桌面设置页「新增/调整规则」表单（effect × action_pattern × scope），PUT 要求本地客户端——桌面天然满足，**web 端做不了写入**，所以这一项只能落桌面；③ 可选：web 侧把「撤销」的 requires-desktop 文案改成明确指路。
**依赖**：无。**迁移**：不需要（permission_policies 表已在，服务层 createPolicy/revokePolicy 已有审计）。
**切法**：client.ts+types.ts 加 3 方法（契约 `permissionPolicyWriteSchema` 已在 @workhub/contracts，直接复用）→ spotlight/views/settings.ts 在 permissionPoliciesSectionHtml 下加表单 + 提交处理 → 保持两段确认与错误人话化风格一致。
**工作量**：M。**模型**：sonnet。

---

### F-03 设备管理收尾 —— web 列表已落地，缺「撤销本机」与桌面入口

| 层 | 现状 | 证据 |
|---|---|---|
| 路由 | register / me / current / :deviceId/revoke / revoke-current 全在 | apps/api/src/routes/client-devices.ts:24, :40, :47, :55, :74 |
| OpenAPI | 5 条全标 | apps/api/src/openapi.ts:7416-7448 |
| SDK | 5 个方法全在（registerClientDevice、revokeCurrentClientDevice **零调用者**） | packages/api-client/src/client.ts:428, :433, :434, :435, :437 |
| web UI | /settings「已登录设备」区块：拉 me + 尽力探测 current 标「本机」+ 撤销他机 | apps/web/src/settings-devices.ts（整文件）；apps/web/src/browser.ts:4516 |
| 明确未接 | 代码注释自认「本机自撤销 revoke-current 不在本工单范围内，这里不接」 | apps/web/src/settings-devices.ts:58-62 |
| 桌面 UI | **无任何设备管理**（settings.ts 只有「退出并重新绑定这台设备」文案，不是设备列表） | apps/desktop-webview/src/spotlight/views/settings.ts:360 |

**缺口**：① web 加「撤销本机（并登出）」两段确认按钮，接 `revokeCurrentClientDevice` + 撤销后走登出流；② 桌面设置页镜像设备列表（桌面才是「本机」概念真正成立的地方）。
**依赖**：登出链路（DSK-01 已修）。**迁移**：不需要。
**切法**：apps/web/src/settings-devices.ts 加 `buildRevokeCurrentRow` 纯函数 + browser.ts:4516 绑定；apps/desktop-webview/src/spotlight/views/settings.ts 复用 web 的行 VM 形状。
**工作量**：S。**模型**：sonnet。

---

### F-04 升级转交选人 UI —— 审批转交 web 已全通；升级转交端到端零入口

| 对象 | 现状 | 证据 |
|---|---|---|
| 审批转交 | 路由 + SDK + **web 真选人器**（details/select/确认转交）全通 | apps/api/src/routes/approvals.ts:195；client.ts:549；route-components.ts:2199-2203；apps/web/src/browser.ts:849-896 |
| 升级转交 | 路由 + 服务层齐全 | apps/api/src/routes/escalations.ts:57；apps/api/src/services/escalations.ts:687-712 |
| 升级转交 SDK | `delegateEscalation` 存在但**零调用者** | packages/api-client/src/client.ts:570 |
| 升级卡动作 | 服务端**从不产出 delegate 动作**——升级卡只发 resolve 与 budget-actions | apps/api/src/services/escalations.ts:209（resolve href）、:310（budget href） |
| 卡片层 | 两端都在「剥掉 delegate」：web 通用卡 renderActions 过滤 `/delegate`；桌面 attention 与桌宠同样过滤 | packages/ui/src/gold-path/route-components.ts:1255-1260；apps/desktop-webview/src/spotlight/views/attention.ts:136-139；apps/desktop-webview/src/pet-surface.ts:1015-1022 |

**缺口**：① 服务端在升级卡里补 `delegate` 动作（href `/api/escalations/:id/delegate`，需要 to_user_id 走 request_json 或选人器）；② 桌面 attention/pet 拆掉 delegate 过滤 + 内联选人器（成员来源已有：GET `/api/workspace/roster`）；③ web 通用卡的 `isUnsupportedWebAction` 拆掉，复用已有审批选人器。
**依赖**：F-04 与 2b 的 `delegateEscalation` 零调用是同一件事。**迁移**：不需要。
**切法**：services/escalations.ts 的 attention item builder 加动作 → attention.ts 的 `runAction` 加 `/api/escalations/:id/delegate` 分支（调 client.delegateEscalation）→ 两端选人器复用 route-components 的 select 结构。
**工作量**：M（比台账估的「小-中」大，因为要先让服务端发这个动作）。**模型**：sonnet。

---

### F-05 撞车 choose —— 端点/契约/SDK 齐全，零 UI（apply 全端在用）

| 层 | 现状 | 证据 |
|---|---|---|
| 路由 | POST `/api/merge-proposals/:id/choose`（仅认 ai_fusion，keep_current/accept_incoming 显式 422 引导到 merge） | apps/api/src/routes/proposals.ts:1366-1394 |
| 契约 | chooseMergeProposalCandidateRequestSchema / mergeProposalCandidateChoiceResultSchema | packages/contracts/src/domain/collaboration.ts:140, :561 |
| SDK | chooseMergeProposalCandidate **零调用者** | packages/api-client/src/client.ts:627 |
| 对照：apply | 四处真调用 | apps/web/src/browser.ts:1720；apps/desktop-webview/src/spotlight/views/attention.ts:427、views/proposals.ts:401、workbench/editor/view.ts:457、desktop-cuu-runtime.ts:1682 |
| 多候选生产者 | LLM 融合候选是数组 | apps/api/src/services/merge-fusion-candidates.ts:41, :462, :728-745 |

**缺口**：现在的冲突 UI 直接对单一候选 apply；多候选时没有「先选稿」步骤。两条路：(a) 冲突面板加候选单选（选中→choose→apply），(b) 删端点（与 implemented note 冲突，不建议）。
**依赖**：无。**迁移**：不需要。
**切法**：packages/ui/src/proposal/render.ts:440 的 conflict option 渲染加多候选分组 → 桌面 editor/view.ts 与 attention.ts 的 conflict 处理链加 choose 前置调用。
**工作量**：S-M。**模型**：sonnet。

---

### F-06 一键回滚桌面挂载 —— 两端都点不到（web 推给桌面，桌面从没挂载）

| 层 | 现状 | 证据 |
|---|---|---|
| 路由 | POST `/api/agent-runs/:id/revert` | apps/api/src/routes/audit.ts:106 |
| 渲染 | replay 页快照区渲「撤销此次改动」按钮，标 `data-requires-desktop="true"` | packages/ui/src/replay/render.ts:373, :389 |
| binder | `bindReplayRevertActions`（两段确认 + 5s 解除武装 + 状态机）已写好 | packages/ui/src/replay/render.ts:535-560 |
| 桌面薄接线 | `renderDesktopAgentRunReplay` / `bindDesktopAgentRunReplayRevert` 已写好 | apps/desktop-webview/src/main.ts:139, :147-158 |
| **致命点** | 这两个桌面导出**只被 main.test.ts 引用**，任何桌面外壳/视图都没调用 | 全仓 grep 仅命中 apps/desktop-webview/src/main.ts 与 main.test.ts:18/27/1224/1241/1254 |
| 桌面 replay 视图 | 自己渲 trace（列表→时间线增量拉取），**完全没有 snapshots 区** | apps/desktop-webview/src/spotlight/views/replay.ts:1-60（模块注释即写明只做 trace） |
| web | 按钮渲出但被 requires-desktop 拦截 | apps/web/src/main.ts:172 |

**缺口**：桌面 spotlight `replay` 视图（或工作台某处）要真正渲染 `renderAgentRunReplay` 的快照区并调 `bindDesktopAgentRunReplayRevert`；回滚成功后重拉。README 承诺的「一键回滚」现在是打不开的按钮——正是 implemented note 点名的场景。
**依赖**：无（binder/渲染/端点全在）。**迁移**：不需要。
**切法**：spotlight/views/replay.ts 详情态改为「trace（现有）+ 快照区（renderAgentRunReplay 的 snapshots 片段）」，mount 后调 bindDesktopAgentRunReplayRevert(ctx.body, ctx.client, { onReverted: 重拉 })。注意 spotlight 视图用的是 `ctx.client`（WorkHubApiClient 切面），需确认切面含 `revertAgentRun`。
**工作量**：S-M。**模型**：sonnet。

---

### F-07 聊天 #会话引用 / /技能唤起 —— 解析器全通、picker 本体缺席

| 层 | 现状 | 证据 |
|---|---|---|
| 触发符解析 | `detectComposerTrigger` 三种触发符（@/#//）+ `applyComposerChipInsertion` 全实现、有专测 | apps/desktop-webview/src/workbench/chat/trigger-parser.ts:12-71 |
| @ picker | 真实：成员本地过滤 + 网盘文件走既有搜索端点；键盘高亮/Enter 选中齐全 | render.ts:2005-2058；view.ts:1344-1364, :1372-1384 |
| # 和 / | `renderPicker()` 对这两种 kind **直接 return**，什么都不弹；假「即将上线」picker 已撤线，函数 `renderComingSoonPickerHtml` 留着没删没人调 | view.ts:1366-1370；render.ts:2061-2071 |
| composer 工具条 | 只剩一个 `data-wb-chat-tool-trigger="@"` 按钮（「#会话」灰 chip 已删） | render.ts:1867；view.ts:3256 |
| 数据源可用性 | 会话列表 GET `/api/projects/:id/conversations`（routes/conversations.ts:49）；技能 GET `/api/team-skills/manage`（team-skill-governance.ts:52）或 GET `/api/pages/skills`（pages.ts:1032）——都已在 | — |

**缺口**：① `renderConversationRefPickerHtml` / `renderSkillPickerHtml` 两个渲染函数；② view.ts 的取数（会话列表按项目、技能列表按工作区，都要 debounce + 单调代次，照 mentionFiles 现成套路）；③ 选中后插入什么——**要先拍板 chip 文本形态**（@ 现在插的是纯文本；# / 要不要落结构化引用、服务端要不要解析）；④ composer 工具条恢复「#会话」「/技能」入口。
**依赖**：需要产品拍板 chip 语义（纯文本 vs 结构化 ref）；若要结构化，contracts 的消息体要加字段（**这会带契约变更**，但不需要迁移，除非要落库索引）。
**切法**：render.ts 加两个 picker 渲染 + view.ts 的 renderPicker 补两个 kind 分支 + 两条取数；CSS 类 `.wh-wb-chat-ctag--soon` / `.wh-wb-chat-picker--soon` 已在 css.ts 留好。
**工作量**：M。**模型**：opus（因为要先定 chip 语义与服务端是否解析，判断成分大）。

---

### F-08 时间线「Cuu 起草整份计划」E3 —— **实质已落地**，只剩一句过时的「即将上线」文案

| 层 | 现状 | 证据 |
|---|---|---|
| 服务层 | 项目规划 agent（LLM 起草 + 自建 judge + 结构/环/日期校验 + 物化事务） | apps/api/src/services/project-planner.ts:1-6（模块注释即 "R15 批 E3"） |
| 路由 | 起草/列表/详情/批准/驳回/物化六端点全在 | apps/api/src/routes/project-planner.ts:60, :72, :78, :84, :90, :102 |
| 桌面 UI | 工作台日程左栏：「用 Cuu 起草计划」按钮 → 起草表单 → 列表 → 详情 → 批准/驳回 → 物化，全真接线 | workbench/schedule/render.ts:283, :421；schedule/view.ts:207, :254, :327；schedule/api.ts:71-110 |
| web UI | 项目主页只读小块（pending_review 计数 + 最新草案状态），明确写「起草/审批/物化在桌面客户端」 | apps/web/src/browser.ts:2461-2505；route-components.ts:4554 |
| meta-planner 链 | 单工作项拆解的 meta-planner 是**另一条链**，由 task-plans 服务持有并调用（不是 E3） | apps/api/src/services/meta-planner.ts:272；apps/api/src/services/task-plans.ts:25, :396 |
| **残留** | 桌面时间线空态仍写「让 Cuu 起草整份计划的入口即将上线（E3）。」 | apps/desktop-webview/src/workbench/timeline/render.ts:455-459 |

**缺口**：把 timeline 空态那句「即将上线」换成指向日程左栏真入口的引导（或直接放一颗跳转按钮）。这是台账里唯一还成立的部分。
**依赖**：无。**迁移**：不需要。**契约**：不需要。
**工作量**：S。**模型**：sonnet。
**注意**：台账把 F-08 描述成「起草入口+接 meta-planner 链」，与代码实况不符——E3 用的是 project-planner，不是 meta-planner；不要照台账去「接 meta-planner」。

---

### F-09 搜索直达会议详情 —— web 已直达，桌面明说「暂不能直达」

| 层 | 现状 | 证据 |
|---|---|---|
| 搜索服务 | meetings scope 返回 meeting_id / project_id / matched_in / snippet | apps/api/src/services/search.ts:203-215 |
| 后端会议页 | GET `/api/pages/meetings` 支持 `?m=`（或 meeting_id）选中某场 | apps/api/src/routes/pages.ts:854-871 |
| web | 搜索结果直接给深链 `/meetings?project_id=..&m=..` | apps/web/src/browser.ts:4158-4160；对照会议页行链 route-components.ts:3463 |
| 桌面 | 会议行**没有 meeting_id 属性**，行内明写「会议详情暂不能从搜索直达，点开将在工作台打开该项目」；点开只 `open_workbench{projectId}` | apps/desktop-webview/src/spotlight/views/search.ts:183-191, :407-437 |
| 桌面会议面 | **整个桌面端没有会议视图**（grep 全仓：desktop-webview 里 meeting 只出现在 main.ts / command-palette / QA 场景 / workitem / search） | — |

**缺口**：桌面要么新建一个 spotlight「会议」能力视图（读 `client.pages.meetings({ projectId, meetingId })`），要么在工作台加会议标签；然后搜索行带上 `data-search-meeting-id` 并 `ctx.open("meetings", { id, route })`。
**依赖**：桌面新增能力要同步 spotlight registry（apps/desktop-webview/src/spotlight/registry.ts:38 那张表）与 state.ts 的深链路由表（state.ts:81-82 同款）。
**迁移/契约**：都不需要（MeetingPageVM 已在 contracts）。
**工作量**：M（新建一个桌面视图，不是小改）。**模型**：sonnet。

---

### F-10 OpenAPI「界面未上线」标注 —— **已无事可做（口径已废）**

- 全仓 grep「界面未上线」只命中两份 note 与台账本身，**openapi.ts 里一处都没有**——要撤的标注本来就没落地过。
- 真正在起作用的是 app.test.ts 的运行时路由 ↔ OpenAPI 路由双向覆盖门：新增端点若不同批补 openapi.ts 会红。
  - 证据：apps/api/src/app.test.ts:41-66（`runtimeContractRoutes()` / `openApiContractRoutes()` 两个集合）。
- 结论：F-10 降级为「F-01/F-02/F-04 新增端点时顺手补 openapi.ts」，不单独立项。
**工作量**：S（并入各项）。**模型**：随各项。

---

## 任务二：独立接线审计（只列台账未记的）

统计口径：路由文件挂载出的端点 **203 条**（另有 app.ts 直挂 5 条：`/`、`/api/health`、`/api/ready`、`/openapi.json`、`/api/openapi.json`，见 apps/api/src/app.ts:209-244）。逐条用「literal + 路径构造器 + 服务端 href 生产者」三路核对，误报已剔除（如 deliverables download/preview 由服务端 href 下发、chat/army/drive 走 `xxxPath(id, suffix)` 构造器、proposal changes preview 由 `preview_ref` 下发）。

### (a) 零消费者端点（15 条，全部人工复核过）

| # | 端点 | 定义处 | 备注 |
|---|---|---|---|
| A1 | POST `/api/workitems/:id/assign` | routes/workitems.ts:282 | **R20 P2A 纯后端族**，服务层注释自认「纯后端」：services/work-item-assignment.ts:1 |
| A2 | POST `/api/workitems/:id/claim` | routes/workitems.ts:299 | 同上 |
| A3 | GET `/api/workitems/:id/comments` | routes/workitems.ts:310 | services/work-item-comments.ts:1「通用 comments 表全库此前零读写」 |
| A4 | POST `/api/workitems/:id/comments` | routes/workitems.ts:321 | 同上 |
| A5 | POST `/api/projects/:id/archive` | routes/projects.ts:71 | services/project-ops.ts:1「纯后端」；web 只有「已归档」徽标（route-components.ts:4389-4390），无动作 |
| A6 | POST `/api/projects/:id/delete` | routes/projects.ts:82 | 同上 |
| A7 | GET `/api/workspace/audit` | routes/workspace-audit.ts:29 | services/workspace-audit.ts:1「纯后端 · 仅管理员」；两端零 UI |
| A8 | POST `/api/escalations/:id/delegate` | routes/escalations.ts:57 | SDK 有方法（client.ts:570）但零调用；见 F-04 |
| A9 | PUT `/api/permissions` | routes/permissions.ts:83 | 见 F-02 |
| A10 | POST `/api/permissions/ask` | routes/permissions.ts:102 | 见 F-02 |
| A11 | GET `/api/permissions` | routes/permissions.ts:77 | 被 settings 页 VM 取代（routes/pages.ts:1048-1051），属「事实重复口」 |
| A12 | GET `/api/approvals` | routes/approvals.ts:147 | 被 GET `/api/pages/approvals` 取代，属「事实重复口」 |
| A13 | POST `/api/auth/register` | routes/auth.ts:481 | pilot password 模式预留（note 已批准保留） |
| A14 | POST `/api/auth/password` | routes/auth.ts:642 | 同上 |
| A15 | POST `/api/auth/users/:id/deactivate` | routes/auth.ts:998 | 停用成员：web 只有 DELETE/PATCH `/api/workspace/members/:userId`（那两条有消费者），这条是并行的第二条停用口 |

**订正 note**：`2026-08-20-reserved-endpoints-and-sdk-policy.md` 说「auth 邀请族保留为预留」——实况是**邀请族四条已全部接线**（POST/GET `/api/auth/invites` ← apps/web/src/browser.ts:3918/3986、apps/desktop-webview/src/workbench/rail.ts:588；DELETE ← browser.ts:3960；accept ← browser.ts:5515）。真正没接的只有 register/password/deactivate 三条。

**建议处置（按 implemented note 口径「不得存在界面未上线」）**：A1-A7 这七条属于「R20 P2A 纯后端」批次遗留，是新的施工单候选（F-11..F-17 级别）：指派/认领要接工作项详情页；工作项评论要接详情页评论区；项目归档/删除要接项目设置；工作区审计要接 /settings 或 /health 的管理员区。

### (b) api-client 零调用方法（11 个，按 note 口径不定性为问题，仅备查）

| 方法 | client.ts | 对应端点 | 备注 |
|---|---|---|---|
| openapi | :411 | GET /api/openapi.json | 契约自省，正常 |
| registerClientDevice | :428 | POST /api/client-devices/register | 注册由 Rust 壳做 |
| revokeCurrentClientDevice | :437 | POST /api/client-devices/revoke-current | F-03 缺的就是它的 UI |
| delegateEscalation | :570 | POST /api/escalations/:id/delegate | F-04 |
| listApprovalComments | :587 | GET /api/approvals/:id/comments | 评论从 pages.approvals 的 items_detail 拿（attention.ts:621-627），故此方法冗余 |
| createProposalFromManifest | :593 | POST /api/workitems/:id/proposals | 服务端/QA 路径在用，前端不用 |
| getProposal | :602 | GET /api/proposals/:id | 前端一律走 pages.proposal |
| chooseMergeProposalCandidate | :627 | POST /api/merge-proposals/:id/choose | F-05 |
| listUsers | :690 | GET /api/users | web 已改用 `/api/workspace/roster?limit=1`（browser.ts:2810-2812），**browser.ts:2741 那句「拉 /api/users」的注释已过时** |
| costUsage | :710 | GET /api/cost/usage | 前端走 pages.cost |
| pilotDay1Metrics | :722 | GET /api/pilot/day1/metrics | 运维口 |

### (c) UI 动作名 ↔ 处理分支

**C1（真问题）**：Cuu 卡片动作 `start_agent` 全仓**只有生产者、没有任何消费者**。
- 生产：packages/cuu/src/cards.ts:861-871，`id: "start_agent"`、`method: "POST"`、`href: /api/workitems/${id}/agent-runs`（工作项 spec_ready 且无提议时出现）。
- 桌宠点击链：`resolveDesktopCuuAction` 没有 `/api/workitems/:id/agent-runs` 分支（apps/desktop-webview/src/desktop-cuu-runtime.ts:1369-1533，穷举到 :1533 结束返回 undefined）；随后的兜底 `desktopPetMainRouteFromHref` 白名单是 `^/(approvals|dashboard|drive|files|projects|settings|workitems|agent-runs|proposals)`，`/api/...` 开头不匹配（apps/desktop-webview/src/pet-surface.ts:766-789）。
- 卡片确实会上桌宠：`normalizeDesktopPetCard` 只改标签、`stripUnsupportedPetActions` 只剥 delegate（pet-surface.ts:2314-2347, :1015-1022）；`cardFromWorkItemDetail` 是 use-evidence 动作的结果卡（desktop-cuu-runtime.ts:1622）与 main.ts:208/212 的加载器产物。
- 全仓 grep `start_agent\b`：**只有 cards.ts:866 一处**（web 侧用的是另一个 id `start_agent_run`）。
- 结论：这是一颗点了没反应的按钮（既不提交也不导航）。修法二选一：在 resolveDesktopCuuAction 加分支调 `client.startAgentRun`，或把 href 换成 Cuu 启动器口 `/api/cuu/start-agent`（该分支已存在，desktop-cuu-runtime.ts:1380）。

**C2（真问题，见 F-06）**：`revert_agent_run` 是唯一一个「web 标 requires-desktop、桌面又没接」的动作——`data-requires-desktop` 全集只有 4 个（packages/ui/src/replay/render.ts:389 revert_agent_run、route-components.ts:5775 revoke_policy、:5612 open_desktop_ai_settings、:5760 open_desktop_settings），其余三个桌面都能落地。

**C3（低）**：桌面 attention 的提交兜底 toast「这类请到对应能力处理」（attention.ts:531）在队列四源（升级/记忆冲突/审批/提议评审，见 routes/pages.ts:575-660）之外没有已知触发路径——目前是防御性分支，不是死码，但一旦 F-04 让升级卡带上 delegate 动作，会先落到这里，改动时注意先加分支再放动作。

**非发现（已核实，避免误报）**：AttentionItem 的 `clarification`/`knowledge_result` 两个 kind 无生产者，但 packages/contracts/src/experience.ts:65-69 已有 R17 #31 的书面说明（枚举保留是为让双端 switch 保持穷举），属已知已决策项，不重复上报。

### (d) Tauri 命令 ↔ 前端 invoke 对账

- 定义 `#[tauri::command]` 共 24 个；release `generate_handler!` 注册 22 个（client-tauri/src-tauri/src/main.rs:1881-1903），另外 2 个（`restore_pet_window_interaction`、`write_cuu_qa_dom_report`）走 debug-only 宏（main.rs:1876 注释 + :2044）。
- 前端 invoke 名 21 个（apps/desktop-webview 全仓静态字符串；唯一的动态 invoke 是 desktop-window-controls.ts:27，命令名仍是模块内静态常量）。

| 发现 | 内容 |
|---|---|
| **D1（中）** | `set_shell_locale` **注册了但前端从没 invoke**。它是 R19-13 专门为「应用内切语言 → 原生外壳跟随（托盘菜单/tooltip/通知兜底文案）」加的（main.rs:583-604），现在托盘语言仍然启动即冻结。桌面切语言的两处写入（spotlight/views/settings.ts:1082-1094、pet-surface.ts:1259-1263（setLocalePreference））都只写 localStorage + `updatePreferences` + reload，没有通知壳层。**修法**：那两处 reload 前加 `invoke("set_shell_locale", { locale: next })`。 |
| **D2（低）** | `toggle_pet_window` 作为 invoke 命令注册，但前端零 invoke——实际调用方是托盘菜单（Rust 侧 tray.rs:173）。属可保留的对称面，非缺陷。 |
| **D3（低）** | `restore_pet_window_interaction`（main.rs:1582）连 debug 下也没有任何前端 invoke，是纯死命令（`write_cuu_qa_dom_report` 有真调用者：apps/desktop-webview/src/cuu-qa-dom-report.ts:128）。 |
| 反向 | 前端 invoke 的 21 个命令名全部能在 Rust 侧找到对应（含 debug-only 的 write_cuu_qa_dom_report），**无「invoke 了不存在的命令」**。 |

### (e) 顺手核到的过时注释（不影响功能，但会误导后续施工）

- apps/web/src/browser.ts:2741：说该面板拉 `/api/users`，实码拉 `/api/workspace/roster?limit=1`（:2810）。
- packages/ui/src/gold-path/route-components.ts:1255-1256：说「转交他人在 web 尚无选人 UI」，但同文件 :2199-2203 已有审批转交选人器（两处是不同 surface，注释没写清，容易被读成「web 完全没有」）。
- `2026-08-20-reserved-endpoints-and-sdk-policy.md` 关于 auth 邀请族的描述已过时（见 (a) 订正）。

---

## 汇总建议的施工顺序

1. **F-06**（一键回滚桌面挂载）——README 承诺项，且所有零件都在，只差挂载，性价比最高。
2. **C1 start_agent 死按钮** + **D1 set_shell_locale** ——两颗小钉子，各自 1 处改动。
3. **F-08 残留文案**、**F-03 revoke-current**、**F-10 并入各项** —— S 级。
4. **F-05 choose**、**F-02 权限写入 UI**、**F-04 升级转交** —— M 级，互不依赖，可并行。
5. **F-01 OKR 列表/详情**、**F-09 桌面会议视图** —— M 级，各带一个新面。
6. **F-07 #// picker** —— 需先拍板 chip 语义（建议 opus 先出设计再交 sonnet 施工）。
7. **A1-A7「R20 P2A 纯后端」七条** —— 按 implemented note 口径应立新施工单（台账第十六节没有它们）。
