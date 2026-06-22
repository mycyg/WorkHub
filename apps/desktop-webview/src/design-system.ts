// WorkHub R8 客户端设计系统 —— Apple 液态玻璃（desktop-only）。
// 这是 Cuu 为核心的新客户端所有表面共用的视觉/动效地基：设计 token + 玻璃表面 + 动效原语 + 微交互。
// 只在桌面 webview 注入（liquid-glass 同理），绝不进共享 @workhub/ui → Web 走 GitHub 风、互不影响。
// 设计取向：Apple「液态玻璃」——半透明分层表面 + backdrop blur/saturate、发丝高光描边、柔和大投影、
// SF 圆体字、弹性过渡(spring)、灵动微交互(悬浮上浮/按压回弹/卡片入场)。值可在此一处集中微调。
//
// 用法：把 `appleGlassDesignSystemCss` 注入 <style>，给根加 `.wh-ds` 类即可用下列 token/工具类。

// 设计 token（挂在 .wh-ds 上，作用域隔离，不污染全局）。
const tokens = `.wh-ds{
  --ds-font: -apple-system, "SF Pro Text", "SF Pro Display", "PingFang SC", "M PLUS Rounded 1c", "Noto Sans SC", system-ui, sans-serif;
  --ds-ink: #1f1d2b; --ds-ink-soft: #43405a; --ds-ink-muted: #6f6a8c; --ds-ink-faint: #9b96b8;
  --ds-accent: #5a45d8; --ds-accent-2: #b57bff; --ds-accent-soft: rgba(124,131,255,.16);
  --ds-success: #1faf86; --ds-success-soft: rgba(31,175,134,.16);
  --ds-warn: #d98a1f; --ds-warn-soft: rgba(217,138,31,.16);
  --ds-danger: #e85d70; --ds-danger-soft: rgba(232,93,112,.16);
  --ds-info: #4f89f1; --ds-info-soft: rgba(79,137,241,.16);
  /* 玻璃表面：半透明 + backdrop blur 让底层极光/桌面透出 */
  --ds-glass: rgba(255,255,255,.52); --ds-glass-strong: rgba(255,255,255,.66); --ds-glass-quiet: rgba(255,255,255,.34);
  --ds-glass-border: rgba(255,255,255,.66); --ds-glass-hairline: rgba(255,255,255,.8);
  --ds-blur: 26px; --ds-blur-strong: 40px;
  --ds-radius-sm: 10px; --ds-radius-md: 14px; --ds-radius-lg: 18px; --ds-radius-xl: 24px; --ds-radius-pill: 999px;
  /* 柔和分层投影（Apple 风：近实远柔 + 内高光） */
  --ds-shadow-1: 0 1px 2px rgba(40,30,90,.06), inset 0 1px 0 rgba(255,255,255,.6);
  --ds-shadow-2: 0 10px 26px -16px rgba(40,30,90,.4), inset 0 1px 0 rgba(255,255,255,.65);
  --ds-shadow-3: 0 24px 56px -28px rgba(40,30,90,.5), inset 0 1px 0 rgba(255,255,255,.7);
  --ds-shadow-glow: 0 14px 26px -8px rgba(124,131,255,.6);
  /* 间距 4px 网格 */
  --ds-s1: 4px; --ds-s2: 8px; --ds-s3: 12px; --ds-s4: 16px; --ds-s5: 24px; --ds-s6: 32px;
  /* 动效：时长 + 缓动（standard / 弹性 spring 带回弹 / 减速） */
  --ds-dur-fast: 140ms; --ds-dur: 240ms; --ds-dur-slow: 380ms;
  --ds-ease: cubic-bezier(.4,0,.2,1); --ds-ease-out: cubic-bezier(.16,1,.3,1); --ds-spring: cubic-bezier(.34,1.56,.64,1);
  font-family: var(--ds-font); color: var(--ds-ink); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
}`;

// 玻璃表面工具类。
const surfaces = [
  ".wh-ds .ds-glass{background:var(--ds-glass);backdrop-filter:blur(var(--ds-blur)) saturate(180%);-webkit-backdrop-filter:blur(var(--ds-blur)) saturate(180%);border:1px solid var(--ds-glass-border);box-shadow:var(--ds-shadow-2)}",
  ".wh-ds .ds-glass-strong{background:var(--ds-glass-strong);backdrop-filter:blur(var(--ds-blur-strong)) saturate(180%);-webkit-backdrop-filter:blur(var(--ds-blur-strong)) saturate(180%);border:1px solid var(--ds-glass-border);box-shadow:var(--ds-shadow-3)}",
  ".wh-ds .ds-glass-quiet{background:var(--ds-glass-quiet);backdrop-filter:blur(calc(var(--ds-blur) * .7)) saturate(160%);-webkit-backdrop-filter:blur(calc(var(--ds-blur) * .7)) saturate(160%);border:1px solid var(--ds-glass-hairline)}",
  ".wh-ds .ds-card{border-radius:var(--ds-radius-lg);padding:var(--ds-s4) var(--ds-s5)}",
  ".wh-ds .ds-panel{border-radius:var(--ds-radius-xl);padding:var(--ds-s5)}"
].join("");

// 动效原语：关键帧 + 入场/退场/强调工具类。
const motion = [
  "@keyframes ds-spring-in{0%{opacity:0;transform:translateY(10px) scale(.96)}60%{opacity:1}100%{opacity:1;transform:translateY(0) scale(1)}}",
  "@keyframes ds-pop{0%{transform:scale(.9);opacity:0}100%{transform:scale(1);opacity:1}}",
  "@keyframes ds-slide-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}",
  "@keyframes ds-fade-in{from{opacity:0}to{opacity:1}}",
  "@keyframes ds-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}",
  "@keyframes ds-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}",
  ".wh-ds .ds-anim-spring-in{animation:ds-spring-in var(--ds-dur-slow) var(--ds-spring) both}",
  ".wh-ds .ds-anim-pop{animation:ds-pop var(--ds-dur) var(--ds-spring) both}",
  ".wh-ds .ds-anim-slide-up{animation:ds-slide-up var(--ds-dur) var(--ds-ease-out) both}",
  ".wh-ds .ds-anim-fade-in{animation:ds-fade-in var(--ds-dur) var(--ds-ease) both}",
  ".wh-ds .ds-anim-float{animation:ds-float 3.6s var(--ds-ease) infinite}",
  // 逐项入场错峰（列表/卡叠灵动感）
  ".wh-ds .ds-stagger>*{animation:ds-slide-up var(--ds-dur) var(--ds-ease-out) both}",
  ".wh-ds .ds-stagger>*:nth-child(2){animation-delay:40ms}.wh-ds .ds-stagger>*:nth-child(3){animation-delay:80ms}",
  ".wh-ds .ds-stagger>*:nth-child(4){animation-delay:120ms}.wh-ds .ds-stagger>*:nth-child(5){animation-delay:160ms}",
  ".wh-ds .ds-stagger>*:nth-child(6){animation-delay:200ms}.wh-ds .ds-stagger>*:nth-child(n+7){animation-delay:240ms}",
  // 尊重系统「减弱动态效果」
  "@media (prefers-reduced-motion: reduce){.wh-ds *{animation-duration:1ms!important;animation-iteration-count:1!important;transition-duration:1ms!important}}"
].join("");

// 微交互：悬浮上浮、按压回弹、可聚焦环。
const interactions = [
  ".wh-ds .ds-interactive{transition:transform var(--ds-dur-fast) var(--ds-ease-out),box-shadow var(--ds-dur-fast) var(--ds-ease),background var(--ds-dur-fast) var(--ds-ease);will-change:transform}",
  ".wh-ds .ds-interactive:hover{transform:translateY(-1px)}",
  ".wh-ds .ds-interactive:active{transform:translateY(0) scale(.975)}",
  ".wh-ds .ds-pressable{transition:transform var(--ds-dur-fast) var(--ds-spring)}.wh-ds .ds-pressable:active{transform:scale(.94)}",
  ".wh-ds .ds-lift:hover{box-shadow:var(--ds-shadow-3)}",
  ".wh-ds :focus-visible{outline:2px solid var(--ds-accent);outline-offset:2px;border-radius:6px}"
].join("");

// 基础组件：按钮、胶囊、输入、文字层级。
const components = [
  ".wh-ds .ds-btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--ds-s2);border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);background:var(--ds-glass-strong);color:var(--ds-ink);font:600 14px/1 var(--ds-font);padding:9px 14px;cursor:pointer;transition:transform var(--ds-dur-fast) var(--ds-spring),box-shadow var(--ds-dur-fast),filter var(--ds-dur-fast)}",
  ".wh-ds .ds-btn:hover{filter:brightness(1.03)}.wh-ds .ds-btn:active{transform:scale(.96)}",
  ".wh-ds .ds-btn-primary{border:0;color:#fff;background:linear-gradient(135deg,#7c83ff,#b57bff);box-shadow:var(--ds-shadow-glow)}",
  ".wh-ds .ds-btn-danger{color:var(--ds-danger);background:var(--ds-danger-soft);border-color:transparent}",
  ".wh-ds .ds-pill{display:inline-flex;align-items:center;gap:6px;border-radius:var(--ds-radius-pill);background:var(--ds-accent-soft);color:var(--ds-accent);font:600 12px/1 var(--ds-font);padding:5px 10px}",
  ".wh-ds .ds-field{width:100%;box-sizing:border-box;border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);background:rgba(255,255,255,.6);color:var(--ds-ink);font:500 14px/1.4 var(--ds-font);padding:11px 13px;transition:border-color var(--ds-dur-fast),box-shadow var(--ds-dur-fast)}",
  ".wh-ds .ds-field:focus{outline:none;border-color:var(--ds-accent);box-shadow:0 0 0 3px var(--ds-accent-soft)}",
  ".wh-ds .ds-kicker{font:700 11px/1 var(--ds-font);letter-spacing:.4px;color:var(--ds-accent);text-transform:uppercase}",
  ".wh-ds .ds-title{font:650 20px/1.3 var(--ds-font);color:var(--ds-ink);margin:0}",
  ".wh-ds .ds-subtle{color:var(--ds-ink-muted);font:500 13px/1.5 var(--ds-font);margin:0}"
].join("");

export const appleGlassDesignSystemCss = `${tokens}${surfaces}${motion}${interactions}${components}`;

// 设计系统里被组件依赖的关键类名（给消费方/测试一个稳定契约，避免拼写漂移）。
export const designSystem = {
  rootClass: "wh-ds",
  glass: "ds-glass",
  glassStrong: "ds-glass-strong",
  card: "ds-card",
  panel: "ds-panel",
  interactive: "ds-interactive",
  pressable: "ds-pressable",
  btn: "ds-btn",
  btnPrimary: "ds-btn-primary",
  pill: "ds-pill",
  field: "ds-field",
  springIn: "ds-anim-spring-in",
  pop: "ds-anim-pop",
  stagger: "ds-stagger"
} as const;
