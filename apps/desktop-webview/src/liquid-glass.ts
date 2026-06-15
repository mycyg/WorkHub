// R7 液态玻璃 · 桌面专属视觉地基。
// 只在 apps/desktop-webview/src/browser.ts 注入,覆盖共享 @workhub/ui/gold-path app-shell(wh-app-*)
// 与路由组件(wh-card / wh-r4-* / wh-btn)的表面,使其呈现液态玻璃质感。
// **绝不进共享 @workhub/ui**——否则 Web 跟着变、web-live-route-smoke 会红。
// 取值直接来自 Claude Design 打磨稿 v2.3(WorkHub Desktop 打磨 v2.dc.html)。

// 字体用独立 <link> 注入(放在 <style> 之前),避免 @import 必须位于样式表首条的限制;
// 离线/被 CSP 拦时回退到 Noto Sans SC / Segoe UI,布局不受影响。
export const liquidGlassHeadHtml =
  "<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;500;700;800;900&family=Noto+Sans+SC:wght@400;500;700;900&display=swap\">";

const auroraBackground = [
  "radial-gradient(900px 620px at 10% 6%,rgba(176,196,255,.92),transparent 60%)",
  "radial-gradient(820px 700px at 90% 10%,rgba(255,196,216,.85),transparent 55%)",
  "radial-gradient(900px 820px at 78% 96%,rgba(184,255,224,.82),transparent 55%)",
  "radial-gradient(760px 720px at 16% 95%,rgba(222,204,255,.85),transparent 55%)",
  "linear-gradient(160deg,#edeffb,#f6eff6)"
].join(",");

export const liquidGlassCss = [
  // 极光底 + 圆体字 + 玻璃配色变量(覆盖 app-shell 的 --wh-app-* 默认蓝灰)
  `.wh-app-root{font-family:'M PLUS Rounded 1c','Noto Sans SC','Segoe UI',sans-serif!important;color:#2c2746;background:${auroraBackground}!important;background-attachment:fixed;--wh-app-ink:#2c2746;--wh-app-muted:#6b6488;--wh-app-blue:#5a45d8;--wh-app-green:#1faf86;--wh-app-coral:#e85d70;--wh-app-line:rgba(255,255,255,.6)}`,
  "body{margin:0;background:#edeffb}",
  // 顶栏磨砂玻璃
  ".wh-app-topbar{background:rgba(255,255,255,.32)!important;backdrop-filter:blur(40px) saturate(180%)!important;-webkit-backdrop-filter:blur(40px) saturate(180%)!important;border-bottom:1px solid rgba(255,255,255,.5)!important}",
  ".wh-app-mark{background:conic-gradient(from 130deg,#7c83ff,#34c79a,#ff9bb0,#7c83ff)!important;box-shadow:0 10px 22px -6px rgba(124,131,255,.7)!important;border-radius:10px!important}",
  ".wh-app-brand{color:#2c2746}.wh-app-runtime{color:#5f5886;font-weight:700}",
  ".wh-app-dot{background:#34c79a!important;box-shadow:0 0 0 4px rgba(52,199,154,.2)!important}",
  // 语言切换胶囊玻璃
  ".wh-locale-toggle{border:1px solid rgba(255,255,255,.7)!important;background:rgba(255,255,255,.4)!important;border-radius:999px!important}",
  ".wh-locale-toggle button{border-radius:999px!important;color:#8b84ad}",
  ".wh-locale-toggle button[aria-pressed=true]{background:#fff!important;color:#5a45d8!important;box-shadow:0 4px 12px rgba(90,69,216,.18)!important}",
  // 侧栏导航玻璃 + 圆角 pill
  ".wh-app-nav{background:rgba(255,255,255,.2)!important;border-right:1px solid rgba(255,255,255,.5)!important}",
  ".wh-app-nav-title{color:#9a8fd0!important}",
  ".wh-app-nav a{border-radius:14px!important;color:#2c2746}",
  ".wh-app-nav a:hover{background:rgba(255,255,255,.6)!important}",
  ".wh-app-nav a[aria-current=page]{background:rgba(255,255,255,.7)!important;color:#5a45d8!important;box-shadow:0 10px 24px -8px rgba(90,69,216,.3),inset 0 1px 0 rgba(255,255,255,.7)!important}",
  ".wh-app-nav small{color:#9a93b8!important}",
  // 内容区卡片玻璃(路由组件复用 wh-card / wh-r4-route-card)
  ".wh-app-content .wh-card,.wh-app-content .wh-r4-route-card{background:rgba(255,255,255,.5)!important;backdrop-filter:blur(22px) saturate(170%);-webkit-backdrop-filter:blur(22px) saturate(170%);border:1px solid rgba(255,255,255,.7)!important;border-radius:18px!important;box-shadow:0 16px 40px -24px rgba(70,54,140,.4),inset 0 1px 0 rgba(255,255,255,.6)!important}",
  // 主按钮渐变 + 次按钮玻璃
  ".wh-app-content .wh-btn{border-radius:13px!important}",
  ".wh-app-content .wh-btn-primary{background:linear-gradient(135deg,#7c83ff,#b57bff)!important;border:0!important;color:#fff!important;box-shadow:0 14px 26px -8px rgba(124,131,255,.7)!important}",
  // 浮层提示玻璃
  ".wh-app-notice{background:rgba(255,255,255,.6)!important;backdrop-filter:blur(30px) saturate(170%);-webkit-backdrop-filter:blur(30px) saturate(170%);border:1px solid rgba(255,255,255,.75)!important;border-radius:16px!important;color:#2c2746!important;box-shadow:0 26px 60px -28px rgba(70,54,140,.5)!important}",
  // 滚动条
  ".wh-app-root ::-webkit-scrollbar{width:10px}",
  ".wh-app-root ::-webkit-scrollbar-thumb{background:rgba(90,69,216,.22);border-radius:8px;border:3px solid transparent;background-clip:content-box}"
].join("");
