# R23 P2：web 密码登录屏 / AI 就绪横幅 / 个人空间新建按钮

- Status: implemented
- Date: 2026-09-05
- Owner: 接班工人（scout-A-product-gaps.md SA-04/SA-08/SA-05，工位 wt-p2）

## Problem

侦察报告（scout-A-product-gaps.md）三条产品缺口：
1. SA-04（高）：生产模式强制非 nickname 认证时，web 端没有任何登录表单（只有桌面走 client.login）。
2. SA-08（中）：README/DEPLOY.md 承诺无 key 时顶部横幅，web 端实际没有。
3. SA-05（中）：个人空间只能在桌面创建，web 端此前连按钮都没有（后来发现 SSR 已由前序工人补好，只是点击没接线）。

## Decision（SA-05，已实现）

- 「新建个人空间」按钮点击后**停留在 /projects 原地、`renderCurrentRoute` 整页刷新**，不像团队项目
  bootstrap 那样跳转到新资源的项目主页。理由：个人空间创建是「清单里多一行」的轻量操作，服务端自动
  命名（无表单字段可填），跳转体验对「还没想好要不要开一个」的场景反而更重；团队项目创建有名字/描述
  等输入,跳进主页开始配置是自然延续,两者场景不同,不强求同一模式。
- 前序工人在 my-conversations.ts 里加了一个 `createPersonalSpaceError` 专用错误文案，但从未接线到
  实际的 catch 分支。检查后发现同级的 `createNamedProjectActionFromHref` 分支用的是通用
  `actionErrorNotice(locale, error, actionId)`（从 WorkHubApiError 派生消息，不查专用文案表）——
  为保持同一分发器内所有分支的错误处理口径一致，删掉了这条死文案，改用通用错误提示，而不是新造一条
  「跨模块查文案表」的特殊路径。
- 顺手把 `bindMyConversationsPanel` 里裸的 `client.request<ProjectListVM>("/api/me/personal-projects")`
  换成新补的类型化 `client.listPersonalProjects()`——同一端点的读/写现在走同一个类型化方法族。

## Alternatives considered（SA-05）

- 创建成功后 `navigateWebRoute` 跳进新空间主页（团队项目的既有模式）：否决，见上文「场景不同」。
- 保留 `createPersonalSpaceError` 死文案、想办法接线：否决——引入「browser.ts 反向 import
  my-conversations.ts 的私有 copy()」的耦合，收益（更友好的错误文案）不值这个耦合成本。

## Consequences

- 两处手写的全量 `WorkHubApiClient` 假实现（apps/web/src/main.test.ts、
  apps/desktop-webview/src/main.test.ts）在这一批新增 3 个接口方法（register/listPersonalProjects/
  createPersonalProject）后必须同步补桩，否则 tsc 报接口缺字段——这是本仓库「改 SDK 接口＝至少两处
  手写 stub 联动」的已知摩擦点，未来再加方法时记得同查这两个文件。

## Decision（SA-08，已实现）

- 任务原描述建议「产品壳 VM（apps/api/src/pages/ 下 product-shell 相关）加 AI 就绪态布尔字段」。
  调查后发现 `apps/api/src/pages/` 下并不存在 product-shell 相关文件（那是 `packages/ui/src/gold-path/
  product-shell.ts`，纯渲染层，不碰后端）；而这个布尔事实**早就存在**——`GET /api/health` 的
  `ai_provider_configured` 字段自 R14 FIX#8（`apps/api/src/app.ts:230`）起就已经是
  `getDefaultProviderRegistry().isConfigured()`，逐层追下去（`packages/agent/src/providers/registry.ts`
  → `packages/config/src/providers.ts` → `settings.llm.apiKey`）与设置页 `api_key_configured`
  （`apps/api/src/pages/settings.ts:60`）读的是同一个 `settings.llm.apiKey`，两者数学上恒等——
  且 openapi.ts 的 `healthResponseSchema` 早已把它标 required、app.test.ts 早已断言。
  **没有新增任何后端端点或字段**——新造一个「product-shell VM」端点会是重复的第二个真源，违反
  「同源」这个要求本身要保护的东西。唯一的缺口纯粹在前端：api-client 的 `HealthResponse` 类型漏了
  这个已存在的字段（已在 SDK 基础提交里补上），且没有任何 web 代码去读它、渲它。
- 横幅内容走**客户端水合**（不是 SSR 服务端渲染）：`packages/ui/src/gold-path/product-shell.ts` 的
  `renderWebProductShell` 只挂一个恒定 `hidden` 的空槽位 `[data-wh-ai-banner]`；
  `apps/web/src/browser.ts` 的 `bindAiReadinessNotices` 在每次「就绪路由」渲染后（不按路由 key
  过滤，同 `bindAvatarTiles` 先例）取一次 `client.health()`（整个页面会话内缓存，不必每次导航重新打）
  并按结果填充/隐藏。理由：AI 是否配置是部署级事实，不属于任何单个路由的页面 VM；给每个路由 loader
  都手工传一遍这个字段属于重复线路（该文件本身已有「零缓存/每次导航重新拉」的路由 VM 纪律，但那条纪律
  管的是会频繁变化、影响决策的运营数据，AI 配置状态只随 `LLM_API_KEY` + 容器重启变化，不属于这一类，
  值得单独缓存），SSR 线路穿透还会牵动 `WebRouteReadyResult`/`renderReadyRoute`/`shellSurfaceFor` 等
  被大量测试覆盖的既有管线，风险/收益比不划算。
- 横幅**不可关闭**（无 X 按钮）——「常驻」是任务本身的措辞，且未配置这件事在配好之前始终成立，不是
  一次性通知；配色用 amber 而非 danger，措辞照抄 README 的「提示性的，不拦你发送」口径。
- intake 入口在 AI 未配置时额外插一条更具体的说明（"提交会收到明确的失败提示"），复用同一次缓存的
  健康检查结果，不额外发请求；同一份纯渲染逻辑（`apps/web/src/ai-readiness-banner.ts`）同时产出顶部
  横幅与 intake 内联说明的 HTML，可单测覆盖（DOM 水合逻辑本身不可单测，见该文件顶部注释）。
- 顺带把 DEPLOY.md §3.2 的「Web/桌面 composer 顶部会出现」改成「Web 端任意页面顶部、桌面聊天输入区
  顶部都会出现」——旧措辞在 web 端一直是假的（此前压根没有横幅），现在落地后要让文档如实反映横幅的
  实际挂载位置（壳层级，不是某个输入框级）。

## Alternatives considered（SA-08）

- 新建 `apps/api/src/pages/product-shell.ts` + 新端点（如 `GET /api/pages/shell`）+
  `packages/contracts` 新 schema：否决——`/api/health` 已经是同一个事实的权威来源（且已公开、无需
  鉴权、已在 openapi 里标注多年），新增端点只是制造第二个需要保持同步的真源，且这个端点大概率要挂
  `createCurrentUserMiddleware`（其余 `/api/pages/*` 全部如此），反而让未登录场景（邀请落地页、
  登录屏本身）更难拿到这个信号——`/api/health` 恰恰因为公开无需鉴权而更适合做这件事。
- SSR 把该字段线穿 `WebRouteReadyResult`/`renderReadyRoute`/`WebProductShellOptions`（每次导航时与
  路由数据一起并行拉取，首屏不闪烁）：否决——收益（消除一次极短暂的「横幅稍后出现」）不值得触碰
  routes.ts 里被大量测试覆盖、且明确写明「设计决策不是遗漏」的零缓存路由管线；客户端水合完全参照
  已有的 `bindMyConversationsPanel`/`bindAvatarTiles` 先例，风险低得多。
- 横幅可关闭（本地存偏好）：否决——见上文「常驻」的措辞依据；且可关闭会制造「关掉后配置真的出问题却
  再也看不到提示」的场景，与「诚实展示系统状态」的产品纪律冲突。

## Consequences（SA-08）

- 新增缓存变量 `cachedAiProviderConfigured`（browser.ts 模块级，页面刷新即重置）——刻意违反同文件里
  「路由零缓存」的一般纪律，原因见上文 Decision；如果以后 AI 配置状态需要在不刷新页面的情况下变化
  （目前不存在这种场景——改 key 需要重启容器），这个缓存假设要重新审视。
- `renderWebProductStateShell`（loading/403/404/error 的状态壳）没有拿到这个横幅槽位——只有「就绪」
  路由会显示。这些状态页本身是过渡态，用户很快会离开或重试到一个就绪页面，可接受。
