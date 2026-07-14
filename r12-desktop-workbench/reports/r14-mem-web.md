# R14 批 MEM · W-B web-memory-page 施工汇报

- 分支：`r14/mem-web`
- 施工说明书：`r14-release-readiness/03-mem-design.md`（§6.1 web 路由/导航/两 tab/水合纪律/确认交互 + §2 语义红线）
- 上游：`r14/mem-server`（`3b471d18`，服务端 8 端点已挂载：`GET/PATCH/DELETE /api/me/memories*`、
  `GET/PATCH/POST /api/team-skills/manage*`；契约 6 个 schema 已在 `packages/contracts/src/pages.ts`）
- 验收自查：`@workhub/ui` / `@workhub/web` / `@workhub/api-client` test + `pnpm -r typecheck` 全绿（见文末计数）

## 1. 做了什么

### 新路由 `/settings/memory`（key: `memory`）

两 tab（关于我/团队技能）用 `?tab=profile|skills` query 切换，默认 `profile`，不分裂路由——沿用既有
`resolveWebRoute` 只锚定 pathname 的规则，两个 tab 链接是普通 `<a href>`，走既有的
`classifyGoldPathHref` → SPA 导航机制（无需任何特殊接线，`buildGoldPathRouteMap` 按 pathname 建
routeMap，两个 tab 共享同一个 pathname）。

**设计取舍（对 §6.1 字面表述的一处偏离，见下方「偏离说明」①）**：两个治理端点的列表数据（用户记忆 +
团队技能）在 `loadRouteSurface` 里**服务端真实拉取**（同 `skills`/`settings` 页既有口径），不是走
`renderSettingsMyProfileCard` 那套「SSR disabled skeleton + browser.ts 二次 GET 解禁」水合纪律——理由
见偏离说明。**编辑/删除/停用等交互动作**仍然是纯客户端接线（`bindMemoryPanel`），成功后整路由重渲
（`renderCurrentRoute`）取最新列表，同其余写动作既有口径。

### 「关于我」tab
- 列表：category 徽标（偏好/纠正/常用上下文）+ workspace_scoped 徽标 + 出处行（`provenance.label`，
  三级降级到「早期记录，出处不明」）+ `edited_at` 独立叠加行（「最近由你于 X 修改」，不与出处合并）。
- 编辑：点「编辑」进入整段替换 `<textarea>`（初始隐藏，maxlength=2000），「保存」PATCH
  `/api/me/memories/:id`（带 `expected_updated_at`）；409（`user_memory_version_conflict`/
  `..._deleted`）显式提示「已被更新，请刷新后重试」，不静默覆盖；失败保留用户已输入内容（不清空）。
- 删除：两步确认（`armMemoryConfirmButton` 复用 `apps/web` 既有 `r9ConfirmArmed` 先例——第一次点按钮
  变警示态「确定删除？再点一次」+ 显示提示行「删除后 AI 助手将忘记这条」，5 秒自动回退；限时内再点
  一次才真正 DELETE）。**文案用「AI 助手」不用「Cuu」**（web smoke 的 `/\bCuu\b/` 门；桌面端才用 Cuu）。
- 空态：`data-r14-mem-profile-empty` 诚实提示「AI 助手还没有记住关于你的任何偏好」，不留空白列表。

### 「团队技能」tab
- 列表：全员可读（含 deprecated 历史版本），版本/状态（在用/已停用）/AI 蒸馏或管理员手改/K2 精修
  出处徽标 + `deprecated_reason` 行。
- 编辑/停用：**仅 `isAdmin`** 渲染（SSR 阶段从 `shellUser.isAdmin` 判定，见下方"isAdmin 接线"），且
  **仅当前激活版本**（`status==='active'`）——已停用的历史版本不长出按钮，即使是管理员。非管理员额外看
  到一行「编辑与停用仅管理员可操作」。
- 编辑：K2 段落级受限编辑补丁的最简表单——1 个可见 op 行（操作类型/段落标题/正文）+「+ 加一处修改」
  按钮逐步露出第 2/3 行（最多 `TEAM_SKILL_MAX_EDIT_OPS`=3），带 `base_version` 乐观并发 + 可选
  `rationale_md`；PATCH 400 时逐 reason 的人话消息（服务端已生成）直接展示，不做前端二次校验。
- 停用：两步确认（同款 `armMemoryConfirmButton`）+ 可选原因输入框；POST
  `/api/team-skills/manage/:id/deactivate`。

### isAdmin 接线

`SettingsPageVM`/新 VM 均不带 `isAdmin` 字段（同设置页既有现状）。isAdmin 走**已验证过的既有通路**：
`browser.ts` 的 `currentIdentity`（登录态）→ `loadWebRoute(client, match, locale, shellUser)` →
`renderReadyRoute` → 新增 `routeComponentsForSurface(surface, locale, isAdmin)` 参数 →
`renderWebRouteComponent({key:"memory", memory:{..., isAdmin}})`。**SSR 阶段直接按 isAdmin 条件渲染**
（不是「先渲后隐藏」的闪烁写法），与 topbar 管理员徽标同一条数据通路，语义上更贴近现状（topbar 已经
这样做）而非重新发明。

### 坑位接线清单（照 §6.1 + 施工中发现的额外必经点）

- `apps/web/src/routes.ts`：`WebRouteSurface` 联合类型 + `routeMatchers`（新增 `/settings/memory`
  matcher）+ `shellPageOrder`（紧邻 `health`，与 nav "team" 组顺序对齐）+ `shellDefaultRoutes` +
  `shellPageTitles`（zh/en）+ `metricLabels`（新增 `memoriesActive`/`skillsDeprecated`）+
  `metricsForSurface`/`routeComponentForSurface`/`loadRouteSurface` 各加 `memory` 分支 +
  `routeTreePageVmByKey`（`WebRouteTreePageVm` 联合类型加 `"memory"`）。
- `packages/ui/src/gold-path/route-components.ts`：`WebRouteComponentKey`/`WebRouteComponentInput`
  加 `memory` 变体；新增 `renderMemoryRouteComponent`/`renderMemoryProfilePanel`/
  `renderMemorySkillsPanel` 等渲染函数；`RouteCopyKey` 加 24 个 `memory.*` key（zh/en 双语）；CSS
  追加 tab 条/textarea/armed 态/K2 op 行等样式。
- `packages/ui/src/gold-path/product-shell.ts`：`ProductShellCopyKey` 加 `nav.memory`/
  `rail.nextMemory`/`masthead.memory`（zh/en）；`productNavGroups` 把 `"memory"` 塞进 `team` 组的
  `keys` Set（**不进** `adminOnly:true` 的 `admin` 组——理由见 §6.1：团队技能 tab 虽然编辑要管理员，
  整页对普通成员也要可读只读，塞进 admin 组会让普通成员连"关于我"都点不到导航入口）。
- **`packages/ui/src/gold-path/render.ts`**（§6.1 未点名，但施工中 typecheck 逼出的必经点）：
  `GoldPathRenderedPage["key"]` 联合类型是 `WebRouteComponentKey`/`shellPageOrder`/`shellDefaultRoutes`/
  `shellPageTitles` 等多处的类型源头，`pageTitles` 是 `Record<Locale, Record<GoldPathRenderedPage["key"],
  string>>`——不加 "memory" 会在这个 exhaustive Record 上直接 TS2739。
- **`packages/ui/src/route-state.ts`**（同上，未点名但必经）：`R4WebRouteKey` 联合类型 +
  `r4WebRouteKeys` 数组 + `routeInfo`（zh/en 的 403/404/error 态卡片文案表）——`routes.ts` 从
  `@workhub/ui` 导入 `R4WebRouteKey` 作为 `WebRouteMatch["key"]` 的类型，不加会导致
  `renderRouteStateCard({routeKey: match.key, ...})` 类型不匹配。
- **`packages/api-client/src/{types,client}.ts`**（W-B 名义围栏未列出，但没有它前端就无法真正调用两个
  治理端点——见偏离说明②）：新增 6 个客户端方法（`listUserMemories`/`patchUserMemory`/
  `deleteUserMemory`/`listTeamSkillsManage`/`patchTeamSkillManage`/`deactivateTeamSkillManage`）。
- `apps/web/src/browser.ts`：新增 `bindMemoryPanel`/`bindMemoryProfileItems`/`bindMemorySkillItems`/
  `armMemoryConfirmButton`，接进 `bindReadyRoute` 的绑定列表。

## 2. i18n 文件位置纠偏（对 §6.1 字面表述的偏离说明）

设计文档写"i18n key 加进 `packages/ui/src/gold-path/i18n.ts`"，侦察阶段已自承"未逐行验证"。施工时
核实：`i18n.ts` 的 `GoldPathCopyKey` 表**没有任何** `nav.*`/`masthead.*`/`skills.*` 这类页面级 key——
真实位置是**两处**：
1. 导航栏文案（`nav.skills`/`masthead.skills` 等）在 `packages/ui/src/gold-path/product-shell.ts`
   自己的 `ProductShellCopyKey`/`productShellCopy` 表里（`productT()` 消费）。
2. 页面正文文案（`skills.kicker`/`skills.title` 等）在 `packages/ui/src/gold-path/route-components.ts`
   自己的 `RouteCopyKey`/`routeCopy` 表里（`routeT()` 消费）。

本工包按**实际代码位置**（而非文档字面路径）落地：`nav.memory`/`rail.nextMemory`/`masthead.memory`
进 product-shell.ts；`memory.*`（24 个 key）进 route-components.ts。`i18n.ts` 未改动一行。

## 3. 偏离说明

1. **两个治理端点的列表数据服务端真实拉取，不是 disabled-skeleton 水合**。§6.1 原文指向
   `renderSettingsMyProfileCard`/`renderSettingsAiAssistantCard` 那套「SSR 禁用骨架 + browser.ts 二次
   GET 解禁」竞态收口纪律。核实后发现：那套纪律的真实理由是"数据结构性不在页面 VM 里"（设置页 VM 没有
   AI 档案/资料字段，扩 VM 要动 contracts，超出各自批次围栏）——不是"所有表单都该走这个模式"的通用规则；
   `notifications` 页的静音偏好面板也是同款理由（`muted_notification_types` 不在 `NotificationPageVM`
   里）。而记忆管理面的核心内容**就是**两个治理端点的列表本身，`loadRouteSurface` 完全可以像
   `skills`/`settings` 页一样直接拉取真实数据——这样反而更彻底地贯彻了"不渲染会闪烁的假数据"的精神
   （SSR 就是真数据，零闪烁，无 JS 也能看到列表），也让 masthead 统计数字（`memoriesActive`/
   `skillsActive`/`skillsDeprecated`）有真实来源而不必留空。**交互动作**（编辑/删除/停用）仍然全部是
   纯客户端接线，遵循"失败不清空用户输入""两步确认危险动作"等纪律，与设计文档的水合精神一致。
2. **触碰了名义围栏外的 4 个文件**（`packages/ui/src/gold-path/render.ts`、
   `packages/ui/src/route-state.ts`、`packages/api-client/src/{types,client}.ts`）。前两个是
   `GoldPathRenderedPage["key"]`/`R4WebRouteKey` 两个联合类型的定义源头，新增路由 key 必然触发这两处
   `Record<..., 该 key 联合类型>` 的 exhaustive 检查报错（`pnpm -r typecheck` 逐一验证过，不改会红）；
   后两个是唯一能让 `apps/web` 真正调用两个治理端点的客户端层——没有它们前端只能拼字符串裸调
   `client.request()`，既不类型安全也不可测。全部严格限定在新增/追加，未删改任何既有逻辑。
3. **`WorkHubApiClient` 上的 6 个新方法标成可选（`?:`）**，照抄 `pages.workbench?` 的既有先例
   （`packages/api-client/src/types.ts:258-262` 原有注释）：标成必填会强迫
   `apps/desktop-webview/src/main.test.ts` 里已有的完整 `WorkHubApiClient` 字面量 mock 也补一批用不到
   的桩——那个文件在本工包的禁区内（`apps/desktop-webview/**`），不能碰。`apps/web/src/routes.ts` 的
   调用点因此老实处理"万一没有"（同 `apps/desktop-webview/src/workbench/shell.ts:265-275` 对
   `pages.workbench?` 的既有处理方式），报真错误而不是假装能拿到数据；真实 `createApiClient()` 一定
   实现这 6 个方法，运行时不会真的走到这个分支。
4. **未做**（防范围漂移，同 03-mem-design §8 与本工包的桌面/服务端围栏）：桌面 Spotlight 记忆视图
   （W-C 工包）、团队技能回滚 HTTP 端点、用户记忆回收站视图、`apps/web/qa/r4-web-live-route-interaction.ts`
   等需要真实运行服务端的 live 冒烟脚本（本工包只跑单元/组件级 test + typecheck，符合任务给定的验收
   自查范围）。

## 4. 测试计数（前 → 后）

| 包 | 前 | 后 | 新增 | 备注 |
|---|---|---|---|---|
| `@workhub/ui` | 193 | 196 | +3 | `route-components.test.ts`：渲染两 tab（category/出处/edited 行）、空态、admin 门槛（仅激活版本+仅管理员） |
| `@workhub/web` | 73 | 79 | +6 | `routes.test.ts`：路由注册、双端点并行拉取、`?tab=` 切换、admin 门槛端到端、空态、nav 分组归属 |
| `@workhub/api-client` | 19 | 21 | +2 | `api-client.test.ts`：6 个新方法的 URL/method/body 构造逐字对齐服务端路由 |

`pnpm -r typecheck` 全绿（16/17 workspace，`apps/desktop-webview`/`apps/api` 等禁区包均未改动、
自身也保持绿）。

## 5. 文案红线自查

- 全新增代码 `git diff` 逐行 grep `Cuu`：0 命中（web 端一律用「AI 助手」，桌面端才用 Cuu）。
- 逐行 grep emoji（Unicode 表情符号区间）：0 命中。
- CSS 未使用 `-webkit-line-clamp`（web smoke 溢出门已知坑）。
