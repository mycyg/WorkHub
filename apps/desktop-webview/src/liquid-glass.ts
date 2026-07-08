// R7 液态玻璃 · 桌面专属视觉地基。
// 只在 apps/desktop-webview/src/browser.ts 注入,覆盖共享 @workhub/ui/gold-path app-shell(wh-app-*)
// 与路由组件(wh-card / wh-r4-* / wh-btn)的表面,使其呈现液态玻璃质感。
// **绝不进共享 @workhub/ui**——否则 Web 跟着变、web-live-route-smoke 会红。
// 取值直接来自 Claude Design 打磨稿 v2.3(WorkHub Desktop 打磨 v2.dc.html)。

// 字体用独立 <link> 注入(放在 <style> 之前),避免 @import 必须位于样式表首条的限制;
// 离线/被 CSP 拦时回退到 Noto Sans SC / Segoe UI,布局不受影响。
export const liquidGlassHeadHtml =
  // R12（首帧）：外部字体前置 preconnect 提前建连；display=swap 已保证字体未到先渲系统字不阻塞文字。
  "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">" +
  "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin=\"anonymous\">" +
  "<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;500;700;800;900&family=Noto+Sans+SC:wght@400;500;700;900&display=swap\">";

const auroraBackground = [
  // R7 真·液态玻璃：底色改半透明，让窗口透明 + OS 毛玻璃(vibrancy/acrylic)穿透看到桌面，
  // 同时保留极光色调叠加（彩色玻璃 + 模糊桌面）。alpha 调低=更穿透，调高=更不透。
  "radial-gradient(900px 620px at 10% 6%,rgba(10,132,255,.28),transparent 60%)",
  "radial-gradient(820px 700px at 90% 10%,rgba(100,210,255,.24),transparent 55%)",
  "radial-gradient(900px 820px at 78% 96%,rgba(48,209,88,.18),transparent 55%)",
  "radial-gradient(760px 720px at 16% 95%,rgba(255,159,10,.14),transparent 55%)",
  "linear-gradient(160deg,rgba(242,247,255,.30),rgba(247,250,252,.30))"
].join(",");

export const liquidGlassCss = [
  // 极光底 + 圆体字 + 玻璃配色变量(覆盖 app-shell 的 --wh-app-* 默认蓝灰)
  `.wh-app-root{font-family:'M PLUS Rounded 1c','Noto Sans SC','Segoe UI',sans-serif!important;color:#1d1d1f;background:${auroraBackground}!important;background-attachment:fixed;--wh-app-ink:#1d1d1f;--wh-app-muted:#636366;--wh-app-blue:#0a84ff;--wh-app-green:#30d158;--wh-app-coral:#ff453a;--wh-app-line:rgba(255,255,255,.6)}`,
  // 半透明薄底而非全透明：让 OS 毛玻璃(vibrancy/acrylic)穿透看到桌面，同时保证内容未渲染(如后端不可达)时
  // 窗口仍可见(不会整窗透明消失)。alpha 调低=更穿透，调高=更不透。
  "html,body{margin:0;background:rgba(240,242,252,.20)!important}",
  // 顶栏磨砂玻璃
  ".wh-app-topbar{background:rgba(255,255,255,.32)!important;backdrop-filter:blur(40px) saturate(180%)!important;-webkit-backdrop-filter:blur(40px) saturate(180%)!important;border-bottom:1px solid rgba(255,255,255,.5)!important}",
  ".wh-app-mark{background:conic-gradient(from 130deg,#0a84ff,#64d2ff,#30d158,#0a84ff)!important;box-shadow:0 10px 22px -6px rgba(10,132,255,.45)!important;border-radius:10px!important}",
  ".wh-app-brand{color:#1d1d1f}.wh-app-runtime{color:#636366;font-weight:700}",
  ".wh-app-dot{background:#30d158!important;box-shadow:0 0 0 4px rgba(48,209,88,.18)!important}",
  // 语言切换胶囊玻璃
  ".wh-locale-toggle{border:1px solid rgba(255,255,255,.7)!important;background:rgba(255,255,255,.4)!important;border-radius:999px!important}",
  ".wh-locale-toggle button{border-radius:999px!important;color:#8e8e93}",
  ".wh-locale-toggle button[aria-pressed=true]{background:#fff!important;color:#0a84ff!important;box-shadow:0 4px 12px rgba(10,132,255,.18)!important}",
  // 侧栏导航玻璃 + 圆角 pill
  ".wh-app-nav{background:rgba(255,255,255,.2)!important;border-right:1px solid rgba(255,255,255,.5)!important}",
  ".wh-app-nav-title{color:#636366!important}",
  ".wh-app-nav a{border-radius:14px!important;color:#1d1d1f}",
  ".wh-app-nav a:hover{background:rgba(255,255,255,.6)!important}",
  ".wh-app-nav a[aria-current=page]{background:rgba(255,255,255,.7)!important;color:#0a84ff!important;box-shadow:0 10px 24px -8px rgba(10,132,255,.24),inset 0 1px 0 rgba(255,255,255,.7)!important}",
  ".wh-app-nav small{color:#8e8e93!important}",
  // 内容区卡片玻璃(路由组件复用 wh-card / wh-r4-route-card)
  ".wh-app-content .wh-card,.wh-app-content .wh-r4-route-card{background:rgba(255,255,255,.5)!important;backdrop-filter:blur(22px) saturate(170%);-webkit-backdrop-filter:blur(22px) saturate(170%);border:1px solid rgba(255,255,255,.7)!important;border-radius:18px!important;box-shadow:0 16px 40px -24px rgba(60,60,67,.28),inset 0 1px 0 rgba(255,255,255,.6)!important}",
  // 主按钮渐变 + 次按钮玻璃
  ".wh-app-content .wh-btn{border-radius:13px!important}",
  ".wh-app-content .wh-btn-primary{background:linear-gradient(135deg,#0a84ff,#64d2ff)!important;border:0!important;color:#fff!important;box-shadow:0 14px 26px -8px rgba(10,132,255,.45)!important}",
  // 浮层提示玻璃
  ".wh-app-notice{background:rgba(255,255,255,.6)!important;backdrop-filter:blur(30px) saturate(170%);-webkit-backdrop-filter:blur(30px) saturate(170%);border:1px solid rgba(255,255,255,.75)!important;border-radius:16px!important;color:#1d1d1f!important;box-shadow:0 26px 60px -28px rgba(60,60,67,.32)!important}",
  // —— 路由组件内部(首页决策收件箱) ——
  ".wh-app-content .wh-r4-home-banner{background:rgba(255,255,255,.42)!important;border:1px solid rgba(255,255,255,.6)!important;border-radius:16px!important;backdrop-filter:blur(20px) saturate(170%);-webkit-backdrop-filter:blur(20px) saturate(170%);color:#3a3a3c}",
  ".wh-app-content .wh-r4-home-chip{background:rgba(255,255,255,.55)!important;border:1px solid rgba(255,255,255,.8)!important;border-radius:999px!important;color:#3a3a3c}",
  ".wh-app-content .wh-r4-home-chip--accent{background:rgba(10,132,255,.14)!important;color:#0a84ff!important}",
  ".wh-app-content .wh-r4-home-chip--ok{background:rgba(48,209,88,.16)!important;color:#30d158!important}",
  ".wh-app-content .wh-r4-decision-top{background:linear-gradient(90deg,#0a84ff,#64d2ff)!important}",
  ".wh-app-content .wh-r4-route-kicker{color:#0a84ff!important}",
  ".wh-app-content .wh-r4-route-count{color:#0a84ff!important}",
  ".wh-app-content .wh-r4-run{background:rgba(255,255,255,.45)!important;border:1px solid rgba(255,255,255,.65)!important;border-radius:14px!important}",
  ".wh-app-content .wh-r4-runstate--accent{background:rgba(10,132,255,.14)!important;color:#0a84ff!important}",
  ".wh-app-content .wh-r4-runstate--warn{background:rgba(255,193,117,.22)!important;color:#b06a17!important}",
  ".wh-app-content .wh-r4-runstate--danger{background:rgba(255,69,58,.16)!important;color:#ff453a!important}",
  // —— 桌宠设置面板(主窗内浮层)玻璃 ——
  ".wh-cuu-preferences{background:rgba(255,255,255,.55)!important;backdrop-filter:blur(34px) saturate(180%)!important;-webkit-backdrop-filter:blur(34px) saturate(180%)!important;border:1px solid rgba(255,255,255,.75)!important;border-radius:14px!important;box-shadow:0 30px 66px -28px rgba(60,60,67,.34),inset 0 1px 0 rgba(255,255,255,.8)!important}",
  ".wh-cuu-pref-row{border-radius:12px}.wh-cuu-pref-button{border-radius:12px!important}.wh-cuu-pref-toggle{border-radius:999px!important}",
  // —— live proposal 详情面板玻璃化(共享 renderProposalDetail 用 wh-proposal-* 类,非 gold-path 的 wh-panel) ——
  // 去掉它自带的靛蓝渐变底让极光透出;主栏/侧栏磨砂成玻璃卡(对齐 .wh-card 玻璃质感)。
  ".wh-app-content .wh-proposal{background:transparent!important;padding:4px!important}",
  ".wh-app-content .wh-proposal-main,.wh-app-content .wh-proposal-rail{background:rgba(255,255,255,.5)!important;backdrop-filter:blur(30px) saturate(175%);-webkit-backdrop-filter:blur(30px) saturate(175%);border:1px solid rgba(255,255,255,.7)!important;border-radius:20px!important;box-shadow:0 26px 58px -28px rgba(60,60,67,.32),inset 0 1px 0 rgba(255,255,255,.7)!important}",
  ".wh-app-content .wh-proposal .wh-kicker{color:#0a84ff!important}",
  // —— R7.1 桌面布局重设计：玻璃浮动面板 + 填满主区 + 结构化侧栏（参考 AutoMedPPT 壳层，desktop-only） ——
  // 壳层改为「带间距的浮动玻璃面板」：顶栏可拖拽、侧栏与内容各自成卡。
  ".wh-app-layout{padding:14px!important;gap:14px!important;min-height:calc(100vh - 63px)!important}",
  ".wh-app-topbar{-webkit-app-region:drag!important}",
  ".wh-app-topbar a,.wh-app-topbar button,.wh-locale-toggle,.wh-app-nav,.wh-app-content{-webkit-app-region:no-drag!important}",
  // 品牌 mark 内嵌「W」字母
  ".wh-app-mark{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:26px!important;height:26px!important}",
  ".wh-app-mark::after{content:\"W\"!important;color:#fff!important;font:800 13px/1 'M PLUS Rounded 1c','Segoe UI',sans-serif!important}",
  // R8 搜索框为核心：移除旧侧栏（连同那一片 low emoji 图标）；导航全部从顶部命令搜索框（⌘K / 点搜索条）延展。
  // 整体交互与搜索框统一为 Apple 玻璃风；侧栏隐藏后主区铺满整窗。
  ".wh-app-nav{display:none!important}",
  ".wh-app-layout{grid-template-columns:minmax(0,1fr)!important}",
  // 填满主区：覆盖 goldPathCss 的 `.wh-desktop .wh-stage{max-width:660px;margin:0}`（660 左对齐 → 居中铺满，
  // 消除右侧极光空洞 + 桌宠悬浮在空白处的「奇怪」观感）。仍保留可读行宽上限。
  ".wh-desktop .wh-shell{background:transparent!important;padding:10px!important}",
  ".wh-desktop .wh-stage{max-width:1080px!important;margin:0 auto!important;gap:16px!important}",
  // 内容面板玻璃化（home/intake/审批/工作项 等 gold-path 页都落在 .wh-panel.wh-main 里）
  ".wh-desktop .wh-panel{background:rgba(255,255,255,.5)!important;border:1px solid rgba(255,255,255,.65)!important;border-radius:20px!important;box-shadow:0 24px 56px -28px rgba(60,60,67,.30),inset 0 1px 0 rgba(255,255,255,.65)!important;backdrop-filter:blur(26px) saturate(170%)!important;-webkit-backdrop-filter:blur(26px) saturate(170%)!important}",
  ".wh-desktop .wh-kicker{color:#0a84ff!important}",
  ".wh-desktop .wh-title{color:#1d1d1f!important;font-size:26px!important}",
  ".wh-desktop .wh-grid{gap:14px!important;margin-top:16px!important}",
  // 滚动条
  ".wh-app-root ::-webkit-scrollbar{width:10px}",
  ".wh-app-root ::-webkit-scrollbar-thumb{background:rgba(10,132,255,.22);border-radius:8px;border:3px solid transparent;background-clip:content-box}"
].join("");
