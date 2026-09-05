# R23 P2：web 密码登录屏 / AI 就绪横幅 / 个人空间新建按钮

- Status: implemented
- Date: 2026-09-05
- Owner: 接班工人（scout-A-product-gaps.md SA-04/SA-08/SA-05，工位 wt-p2）

## Problem

侦察报告（scout-A-product-gaps.md）三条产品缺口：
1. SA-04（高）：生产模式强制非 nickname 认证时，web 端没有任何登录表单（只有桌面走 client.login）。
2. SA-08（中）：README/DEPLOY.md 承诺无 key 时顶部横幅，web 端实际没有。
3. SA-05（中）：个人空间只能在桌面创建，web 端此前连按钮都没有（后来发现 SSR 已由前序工人补好，只是点击没接线）。

## Decision（SA-04，已实现）

- **模式探测不新增端点**——复用 `POST /api/auth/identify` 本身的行为差异：该端点在解析请求体
  *之前* 就先检查 `AUTH_MODE`（`apps/api/src/routes/auth.ts` 的 `passwordModeEnabled`），
  password/hybrid 模式恒 404；nickname 模式下传空昵称只会在 schema 校验（`min(1)`）这一步失败
  （422），不会走到 `getOrCreateActiveByNickname`，不会建用户。探测函数
  `apps/web/src/auth-screen-mode.ts` 的 `detectAuthScreenMode` 因此可以安全地用 `{nickname:""}`
  探测，零副作用；任何非 404 的结果（含网络错误）一律回退到 nickname（本仓库默认值，误判代价
  最小——参考桌面端 `desktop-login.ts` 的 `isPasswordModeBootstrapError` 同款「用 404 判定模式」
  先例，只是探测的端点换成了 web 更自然的 identify 而非 desktop-bootstrap）。
- **探测结果缓存 Promise（非缓存值）**，一个页面会话内只探测一次——AUTH_MODE 是部署期常量，
  重复探测除了浪费一次网络往返没有任何好处；同 SA-08 `aiProviderConfiguredCached` 的缓存写法
  （`x ??= fn().then(...)`，天然合并并发调用，不会因为还没 resolve 就重复发起）。
- `showOnboardingScreen` 从同步函数变成异步函数（要 await 探测结果）后，新增 `renderId` 竞态
  守卫（写法照抄 `renderCurrentRoute` 自身已有的同款守卫）——等待期间如果又发生了一次更新的
  登出/导航请求（`activeRouteRenderId` 被递归调用递增），旧的这次探测结果作废，不覆盖新画面。
  15 处调用点按各自上下文改成 `await`（enclosing 函数本就 async 且随后 `return`）或
  `void`（同步回调/`.then` 链），未做的话会在这批改动后触发
  `@typescript-eslint/no-floating-promises`（这个仓库其它「不等的异步调用」处都是这样处理的，
  如 `void renderCurrentRouteOrOnboard(...).catch(...)`）。
- **登录/注册/昵称报到三条路径共享 `completeAuthSuccess`**——从原 `submitOnboarding` 里抽出「设
  身份→同步语言偏好→渲工作台」这段收尾编排，避免三份几乎一样的代码。`fallbackNickname` 参数
  （`identityUserFrom` 解不出昵称时的兜底显示名）视场景取不同值：昵称报到用输入的昵称、密码
  登录没有对应概念故退而用邮箱、密码注册用输入的昵称——这个兜底路径正常不会触发（服务端响应
  正常情况下总能提供 nickname），只是防御性分支。
- 注册屏（`renderPasswordAuthScreen` 的 register tab）**不采集任何「我是管理员」字段**——
  `POST /api/auth/register` 服务端在建号前直接查 `hasAnyActiveAdmin()`，零管理员实例的首个
  注册者自动建为 admin（`apps/api/src/routes/auth.ts:~505`）；前端只用一句 hint 说明这件事
  （`firstAdminHint` 文案），不用表单字段掺和进服务端已经做完的判定，避免「用户勾选了我是管理员
  但服务端判定不是」或反过来的语义分裂。
- 错误文案统一走 `describeAuthScreenError(error, locale, context)`——同一个函数处理 login 和
  register 的错误分支（`context` 参数区分「409＝密码错」vs「409＝该邮箱已注册」），而不是两个
  重复的函数；对 400/422 的处理刻意不透传服务端原文（服务端的 `WeakPasswordError` 消息只有中文，
  英文界面下会露馅），改用通用的双语「请检查邮箱/昵称/密码」文案——同桌面端 `describeDesktopLoginError`
  的既有取舍（`MRG-26` 注释：4xx 消息虽是「写给人看的」，但只对本就双语的错误码路径这样做，
  未国际化的服务端消息不能直接透传）。
- DEPLOY.md §8（安全口径）补 `AUTH_MODE=password/hybrid` 的生产要求和「登录屏切到注册标签页」
  的首个管理员流程；顺带记录一个发现（未在本批修）：`packages/config/src/env.ts` 的
  `validateRuntimeConfig` 在生产环境无条件要求 `ADMIN_CLAIM_SECRET` 非空且 ≥16 位，但这个值
  只在 nickname 模式的 identify/desktop-bootstrap 认领路径里被读取——而 nickname 模式本身在
  生产环境是被禁止的（同一个函数里的另一条 fail-closed 规则）。等于生产部署被迫配置一个永远不会
  被用到的密钥。已 `spawn_task`（task_ae85fd2b）留给后续会话判断是放宽校验还是维持现状加注释，
  不在本批顺手改动共享的配置校验函数。

## Alternatives considered（SA-04）

- 新增一个公开、无需鉴权的端点/字段直接暴露 `AUTH_MODE`（如扩展 `GET /api/health`）：否决——
  收益（省掉一次探测请求 + 不依赖 identify 的 404 副作用）不值得再开一个需要长期维护的公开面，
  尤其是 identify 的探测法已经零副作用、且和桌面端「用 404 判定模式」的既有先例完全一致。
- 保持 `showOnboardingScreen` 同步、在渲染前用「已缓存」的模式做同步分支（第一次访问强制先当
  nickname 渲一次，探测结果出来后再切换）：否决——闪烁一次«昵称屏→密码屏»的体验比等一次探测
  更糟，尤其密码模式下昵称屏提交必然 404，等于让用户看一眼注定失败的表单。
- 登录/注册各自独立处理错误文案（不共享 describeAuthScreenError）：否决——两者错误码高度重叠
  （401 只属于 login、409 只属于 register，其余 429/400/422/404 完全共享），拆开是纯重复。

## Consequences（SA-04）

- `showOnboardingScreen` 从同步变异步是这批改动里唯一有「新引入的竞态窗口」的地方——已加
  `renderId` 守卫，但如果未来有新调用点忘记 `void`/`await`，不会有任何工具报错：核实过这个仓库
  各包的 `lint` 脚本就是 `tsc --noEmit` 的别名（没有 ESLint 配置文件，无
  `no-floating-promises` 规则），未加 `void` 的浮空 Promise 纯靠人工审查发现。全文各处
  `void xxx(...).catch(...)` 只是团队约定的可读性写法，不是工具强制——这批改动照抄这个约定。
- 两处手写的全量 `WorkHubApiClient` 假实现已在 SDK 基础提交里补了 `register` 桩——这批新增的
  `login`/`register` 调用不需要再改那两个文件（`login` 桩此前就有）。

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
