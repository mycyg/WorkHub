# R14 批 SEARCH · 工包 W3 search-web 交付报告

分支：`r14/search-web` · 施工说明书：`r14-release-readiness/02-search-design.md` §7（web 顶栏搜索页）
契约：`packages/contracts/src/domain/search.ts`（`searchResultsVmSchema`；q 2–64、limit 1–25 默认 10）——W1 已交付并合入本分支。
服务端报告：`r12-desktop-workbench/reports/r14-search-core.md`（`GET /api/search` 已在本分支挂载并有真库冒烟）。

## 1. 做了什么

### 新路由 `search`（`/dashboard/search`）
照 team-skills（`854b3eef`）与本批 §0 踩坑清单逐处接线：

- `apps/web/src/routes.ts`：`routeMatchers`（`/dashboard/search`，`apiBaseLabel:"/api/search"`）、`WebRouteSurface`
  联合（`{ key:"search"; q?:string }`）、`WebRouteTreePageVm`/`routeTreePageVmByKey`、`shellPageOrder`、
  `shellDefaultRoutes`、`shellPageTitles`（zh"搜索"/en"Search"）、`metricLabels`（新增 `query` 键）、
  `metricsForSurface`（masthead 只报「当前搜索词」+「实时数据」，不编造结果计数）、`routeComponentForSurface`、
  `loadRouteSurface`（**零 API 调用**——只透传 URL 里的 `?q=`，见下）。
- `packages/ui/src/route-state.ts`：`R4WebRouteKey`/`r4WebRouteKeys`/`routeInfo` 双语。
- `packages/ui/src/gold-path/render.ts`：`GoldPathRenderedPage["key"]` 联合 + `pageTitles` 双语。
  **未**新增 `renderSearch()`/未并入 `renderGoldPathSurface()` 的 `pages` 数组——见「偏离」§1。
- `packages/ui/src/gold-path/route-components.ts`：`WebRouteComponentKey`、`RouteCopyKey`（`search.*` 12 条双语）、
  新 CSS（`.wh-r14-search-form` 照 `.wh-r4-knowledge-search`；`.wh-r14-search-result-link` 照
  `.wh-r4-drive-item-link` 整行可点悬停下划线）、`renderSearchRouteComponent()`、`WebRouteComponentInput`
  联合 + switch case。
- `packages/ui/src/gold-path/product-shell.ts`：`nav.search`/`rail.nextSearch` 双语；`search` 并入非
  adminOnly 的 `assets` 导航组（与 drive/meetings/knowledge 同组——"搜索资产"语义贴切；比塞进顶栏输入框
  风险小得多，且设计 §7 本就把两个选项并列"顶栏独立位而非塞 assets 组，呼应…"与"或顶栏搜索入口——设计稿为准"）。
- `packages/api-client`：`SearchRequestParams` 类型 + `client.search()` 方法（`GET /api/search?q=&scopes=&limit=`）。

### 服务端渲染纪律（SSR 骨架 + 客户端水合解禁）
`renderSearchRouteComponent(q, locale)` 只渲：kicker/标题/摘要 + 搜索表单（`<form method="get"
action="/dashboard/search">`，回填 `q`，走浏览器原生导航，**不需要**任何 JS 拦截提交）+ 诚实状态行
（`search.promptEmpty`/`search.promptShort`/`search.loading` 三态，按 `!q` / `trim().length<2` / 有效
区分）+ 四个结果分组卡（**恒按 `conversations/drive/work_items/meetings` 固定顺序**，与契约
`SEARCH_SCOPE_ORDER` 对齐；q 无效时结果容器整体 `hidden`，q 有效时容器可见但四张卡各自仍 `hidden`，
等客户端注入）。照 `renderNotificationMutePanel`/`renderSettingsAiAssistantCard` 的"SSR 骨架 disable/hidden
→ 客户端拉真值后解禁，失败保持锁定 + 显式错误 + 重试"纪律。

### 客户端水合（`apps/web/src/browser.ts` `bindSearchRoutePanel`）
挂在 `bindReadyRoute` 里（与 `bindNotificationMutePanel` 同级），`result.match.key==="search"` 时生效：
q < 2 字符直接返回（SSR 已给诚实提示，不发请求）；否则拉 `client.search({ q, limit: 10 })`（默认四
scope 全开）成功后按 `SEARCH_SCOPE_ORDER` 逐组注入结果（DOM API `createElement`/`textContent`，不拼
HTML 字符串，天然免转义风险）、揭示 `has_more` 提示、空组显式"此范围没有匹配"；全组皆空则顶部状态行给
"没有找到…换个关键词"；失败保留错误 + 重试按钮（不吞错）。

`client.search` 在共享 `WorkHubApiClient` 接口上声明为**可选**（`search?:`）——原因见「偏离」§2。
`bindSearchRoutePanel` 用 `client.search?.(...)` 调用，`undefined` 时同样落错误分支（不会静默卡死）。

### 结果点击直达
- **工单**（`work_items` scope）→ `<a href="/workitems/:id">`，既有 detail-only 路由。
- **网盘**（`drive` scope）→ `<a href="/drive?project_id=&item_id=">`，与 `loadRouteSurface` 的 drive
  分支读取键名完全一致（`project_id`/`item_id`，非 camelCase）。
- **会议**（`meetings` scope）→ `<a href="/meetings?project_id=&m=">`，与 meetings 分支读取键名一致
  （`m` 不是 `meeting_id`——meetings loader 的真实参数名）。
- **会话**（`conversations` scope）→ **不可点**的说明行（项目名 · 会话标题 + 片段 + 发送者/时间 + 一条
  常驻"会话内容在桌面工作台查看"提示，SSR 时在该分组卡头就静态渲好，不必等结果注入才看到）；发送者标签
  为 `null`（agent/system 消息）时显示"AI 助手"/"AI assistant"，**不**用"Cuu"（web smoke 的
  `/\bCuu\b/` 门；本工包新测试也直接断言了这条）。`SearchResultsVm` 已经带 `deep_link`（seq 精确定位），
  但 web 端没有聊天页可消费它——诚实降级为纯文字，不做假链接（设计 §6 拍板）。

### CJK/溢出纪律
未使用任何定高 `-webkit-line-clamp`；片段/标题走既有 `.wh-r4-route-row p{overflow-wrap:anywhere}` 规则，
CJK 长文本正常折行不触发 web smoke 溢出门。

## 2. 偏离说明

1. **未新增 `render.ts` 的 `renderSearch()` / 未把 "search" 并入 `renderGoldPathSurface().pages`。**
   施工说明书 §7 字面写"新增 renderSearch()（照 renderKnowledge:710）"，但经核查该函数所在的
   `renderGoldPathSurface()` 管线是**独立于本批的 P0.5 静态 gold-path 演示渲染器**（`render.test.ts`
   的 key 清单钉死 `[home,intake,approvals,workitem,proposal,replay,cost,knowledge,settings]`，
   `drive/meetings/notifications/calendar/health/agents/skills` 等所有 R4+ 之后新增的真实路由**全部
   没有**进这个数组——`skills`（`854b3eef`）落地时就只改了 `GoldPathRenderedPage["key"]` 联合 +
   `pageTitles`，同样没碰 `renderGoldPathSurface()`）。桌面端对这条管线的 live 接线
   （`apps/desktop-webview/src/browser.ts:1042` `liveGoldPathPages`）也只硬编码了
   `approvals/workitem/replay/cost` 四个 key，与 search 无关。故本工包按 skills 先例，只做类型层面的
   两处必需改动（`GoldPathRenderedPage["key"]` 联合 + `pageTitles` 双语），不额外造一个永远不会被调用
   的 `renderSearch()`。真正的搜索页渲染逻辑在 `route-components.ts` 的 `renderSearchRouteComponent`
   （SSR 骨架 + 客户端水合），这才是 web 实际路由走的路径。
2. **`WorkHubApiClient.search` 声明为可选（`search?:`），而非必需成员。** 原因：`apps/desktop-webview/
   src/main.test.ts` 的 `fakeClient` 把返回值直接标注为 `: WorkHubApiClient`（穷举字面量），若把
   `search` 定成必需字段，该文件会编译失败——但它在本工包禁区（`apps/desktop-webview/**`）内，不能改。
   声明为可选后，`ReturnType<typeof createApiClient>` 中该属性变成 `(...) => Promise<...> | undefined`；
   `bindSearchRoutePanel` 用 `client.search?.(...)` 调用，真实客户端（`createApiClient`）始终具体实现
   它，`undefined` 分支只在防御性代码里出现（对应错误提示 + 重试，不会静默卡死）。已用
   `pnpm -r typecheck`（16/16 包全绿，含 `apps/desktop-webview`）验证这个选择不引入回归。
3. **导航入口放进非 adminOnly 的 `assets` 分组，而非顶栏独立搜索框。** 设计 §7 原话给了两个选项
   （"顶栏独立位…或顶栏搜索入口——设计稿为准"）。顶栏是 `packages/ui/src/gold-path/product-shell.ts`
   的 `renderProductTopbar`，跨*所有*路由渲染，改动面/回归面显著大于侧栏新增一个导航项；而侧栏方案
   零风险、与 drive/meetings/knowledge 语义高度贴合（"跨项目资产搜索"）。搜索页本身的搜索框
   （`renderSearchRouteComponent`）已经是主要交互入口，侧栏只是发现入口。
4. **组标题用「任务」而非说明书行文里出现过的「工单」。** `work_items` scope 的中文组标题用
   `search.groupWorkItems = "任务"`，与本应用其余导航/标题一贯使用的措辞对齐（`nav.workitem="任务"`、
   `shellPageTitles.workitem="任务详情"`）；"工单"在本仓库现有 web 文案里从未出现过，引入会造成同一概念
   两个中文词并存。
5. **`q`≥2 字符但＜3 字符（trgm 索引失效区间）不做任何前端特殊处理。** 服务端已在 §3 承诺 seqscan 兜底
   （围栏 join + LIMIT 压成本），前端无需知道这个实现细节；诚实文案统一走 `search.promptShort`（＜2）
   /`search.loading`（≥2）两态，不额外暴露"2–3 字符可能慢"之类的实现泄漏。
6. **未做 spotlight 意图分类/桌面聚焦盒接线。** 那是并行工包 W2（`r14/search-spotlight`，
   `apps/desktop-webview/src/spotlight/**`），本工包全程未触碰 `apps/desktop-webview/**`。

## 3. 路由接线清单

| 文件 | 改动 |
|---|---|
| `apps/web/src/routes.ts` | routeMatchers/`WebRouteSurface`/`WebRouteTreePageVm`/`routeTreePageVmByKey`/shellPageOrder/shellDefaultRoutes/shellPageTitles/metricLabels/metricsForSurface/routeComponentForSurface/loadRouteSurface |
| `packages/ui/src/route-state.ts` | `R4WebRouteKey`/`r4WebRouteKeys`/`routeInfo`（zh/en） |
| `packages/ui/src/gold-path/render.ts` | `GoldPathRenderedPage["key"]` 联合 + `pageTitles`（zh/en），**不**新增渲染函数（见偏离§1） |
| `packages/ui/src/gold-path/route-components.ts` | `WebRouteComponentKey`、`RouteCopyKey`+双语文案、CSS、`renderSearchRouteComponent`、`WebRouteComponentInput`+switch |
| `packages/ui/src/gold-path/product-shell.ts` | `nav.search`/`rail.nextSearch`双语、`assets` 导航组新增 `search` |
| `packages/api-client/src/types.ts` | `SearchRequestParams`、`WorkHubApiClient.search?`（可选，见偏离§2） |
| `packages/api-client/src/client.ts` | `withSearchParams`、`search` 方法实现 |
| `apps/web/src/browser.ts` | `bindSearchRoutePanel`（+`formatSearchTimestamp`/`searchMatchedInLabel`），挂进 `bindReadyRoute` |

## 4. 跳转矩阵

| scope | web 结果行为 | 目标路由/说明 |
|---|---|---|
| `conversations` | 不可点，纯说明行 + 常驻"去桌面工作台"提示 | 无 web 聊天页（R13 定调），`deep_link` 数据已给但不消费 |
| `drive` | 整行链接 | `/drive?project_id=<id>&item_id=<id>` |
| `work_items` | 整行链接 | `/workitems/<id>` |
| `meetings` | 整行链接 | `/meetings?project_id=<id>&m=<id>` |

## 5. 测试计数

| 包 | 命令 | 结果 |
|---|---|---|
| `@workhub/api-client` | `pnpm --filter @workhub/api-client test` | 20/20（新增 1：`search()` 查询串构造） |
| `@workhub/ui` | `pnpm --filter @workhub/ui test` | 196/196（新增 3：`renderSearchRouteComponent` 空/短词/有效查询三态） |
| `@workhub/web` | `pnpm --filter @workhub/web test` | 76/76（新增 4 新测试 + 修 2 条既有计数门：`webRouteRegistry`/`webReactRouteTree` 清单各 +1 "search"） |
| 全仓 | `pnpm -r typecheck` | 16/16 包全绿（含 `apps/desktop-webview`，验证 `search?:` 可选设计不引入回归） |

未跑（禁区/纪律要求）：web smoke（`scripts/qa/*.ts`）、截图 artifacts、后台进程。

## 6. 交付

- 分支 `r14/search-web`，targeted commits（无 `git add -A`）。
- 禁区未触碰：`apps/api/**`、`packages/db/**`、`packages/contracts/**`、`apps/desktop-webview/**`
  （`git status --short` 核对过，只有本清单里列的 11 个文件变更）。
