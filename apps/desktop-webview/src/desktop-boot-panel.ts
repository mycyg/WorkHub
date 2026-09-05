// WorkHub 桌面 · 三张首启屏共用的液态玻璃面板（R24 I）。
//
// 走查 M-09：主窗首启会渲三张屏之一——「连接到你的服务器」（desktop-connect-screen.ts）、
// 「昵称首启/重绑」（desktop-rebind.ts）、「密码模式凭据门」（desktop-login.ts）。连接屏已经是
// 液态玻璃面板（与聚焦盒同一套语言），另外两张还是一张 rgba(255,255,255,.86) 的白卡、420px 宽、
// 靠 backdrop-filter 起毛玻璃——而 backdrop-filter 在「透明窗口 + 原生 vibrancy」的 Tauri 主窗里是
// 空操作（见 R8 桌面毛玻璃约束），用户实际看到的是灰色 vibrancy 底上贴了一张白纸，与聚焦盒断层。
//
// 本模块把那套面板抽出来，三张屏各自只提供面板内部的内容（inner）与自己独有的补充样式（extraCss），
// 一份实现同时决定三张屏的：
//   - head/filter 注入：字体 <link>（liquidGlassHeadHtml）+ 液态玻璃 filter 样式；
//   - 面板结构：玻璃层 renderWorkHubLiquidGlassLayer("spotlight") + 高光描边 rim + 内容层；
//   - 视觉口径：width:min(540px,100%)、圆角 22px、内边距 30px、标题 20px/900、说明走次级色；
//   - 量高锚点 desktopBootScreenFitAttribute（贴合逻辑见 desktop-boot-screen-fit.ts）：打在面板本体上，
//     外壳 padding 与那边的加法共用 desktopBootScreenFitPaddingPx——两边漂移就会重新裁面板边缘；
//   - 设计系统：注入 appleGlassDesignSystemCss 并在外壳挂 .wh-ds。此前三张屏都没注入过它，
//     模板里已经写着的 ds-pressable 之类工具类一直是死类（W-H 交接指出）。
//
// 深色外观：颜色一律走 CanvasText + color-mix，不写死墨色；亮色下用来把深色文字从花玻璃里"托"出来的
// 白色文字光晕，在深色下换成暗色光晕，否则白字会被白晕糊掉。

import { appleGlassDesignSystemCss, designSystem } from "./design-system.js";
import {
  desktopBootScreenFitAttribute,
  desktopBootScreenFitPaddingPx
} from "./desktop-boot-screen-fit.js";
import { liquidGlassHeadHtml } from "./liquid-glass.js";
import {
  liquidGlassFilterCss,
  liquidGlassFilterHtml,
  renderWorkHubLiquidGlassLayer
} from "./liquid-glass-filter.js";

/** 首启屏外壳（撑满窗口、居中面板）。三张屏共用，贴合逻辑量的不是它而是面板。 */
export const desktopBootPanelShellClass = "wh-desktop-boot-shell";
/** 面板本体：量高锚点就打在它上面。 */
export const desktopBootPanelClass = "wh-desktop-boot-panel";

/** 面板内部可复用的语义类名（给三张屏一个稳定契约，避免拼写漂移；同 design-system.ts 的取舍）。 */
export const desktopBootPanel = {
  shell: desktopBootPanelShellClass,
  panel: desktopBootPanelClass,
  mark: "wh-desktop-boot-mark",
  sub: "wh-desktop-boot-sub",
  fineprint: "wh-desktop-boot-fineprint",
  form: "wh-desktop-boot-form",
  actions: "wh-desktop-boot-actions",
  primary: "wh-desktop-boot-primary",
  secondary: "wh-desktop-boot-secondary",
  tabs: "wh-desktop-boot-tabs",
  error: "wh-desktop-boot-error"
} as const;

// 面板样式。刻意全部走 CanvasText / color-mix：主窗是透明 + vibrancy，底色随系统外观在浅灰/深灰之间
// 变，写死墨色就会在深色外观下变成"深底深字"。
export const desktopBootPanelCss = [
  // 三张屏都会整个替换掉 boot 首帧壳（连同 spotlightCss 的 margin 归零一起），自己不补就会吃到 UA
  // 默认的 8px body margin：面板偏移 + 出滚动条 + 窗口比内容矮 8px。
  "html,body,#root{margin:0;padding:0;min-height:100%;background:rgba(0,0,0,0)!important}",
  // 外壳 padding 必须与 desktopBootScreenFitPaddingPx 同源，否则贴合出来的窗口会裁掉面板边缘。
  `.${desktopBootPanelShellClass}{box-sizing:border-box;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:${desktopBootScreenFitPaddingPx}px;font-family:'M PLUS Rounded 1c','Noto Sans SC','Segoe UI',sans-serif;color:CanvasText;background:transparent}`,
  // 面板自身完全透明——玻璃质感由内部的 wh-liquid-glass-* 层给，面板只负责圆角/描边/投影。
  `.${desktopBootPanelClass}{position:relative;box-sizing:border-box;width:min(540px,100%);border-radius:22px;background:transparent;border:1px solid rgba(255,255,255,.26);box-shadow:0 24px 76px -46px rgba(0,0,0,.52);overflow:hidden;--wh-liquid-edge:16px}`,
  `.${desktopBootPanelClass}>.wh-liquid-glass-content{display:grid;gap:12px;padding:30px 30px 26px;text-shadow:0 1px 12px rgba(255,255,255,.42),0 0 2px rgba(255,255,255,.66)}`,
  `.${desktopBootPanel.mark}{width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#0a84ff,#64d2ff);box-shadow:0 10px 22px -6px rgba(10,132,255,.45)}`,
  // 标题两种标签都认：连接屏在 <section> 里用 h2，另外两张是整屏唯一标题用 h1。
  `.${desktopBootPanelClass} h1,.${desktopBootPanelClass} h2{margin:2px 0 0;font-size:20px;font-weight:900;line-height:1.24;color:CanvasText}`,
  // 段落的默认口径。下面每一条修饰类都必须带上面板前缀——不带就只有一个类的权重（0,1,0），
  // 会被这条「类 + 标签」（0,1,1）盖掉，说明/细则/错误行全都会退回同一个灰。
  `.${desktopBootPanelClass} p{margin:0;font-size:13px;line-height:1.55;color:color-mix(in srgb, CanvasText 78%, transparent)}`,
  `.${desktopBootPanelClass} .${desktopBootPanel.sub}{font-size:13px}`,
  `.${desktopBootPanelClass} .${desktopBootPanel.fineprint}{font-size:12px;color:color-mix(in srgb, CanvasText 60%, transparent)}`,
  // 表单：标签在上、输入在下的两行栅格；输入框透明 + 发丝白描边（同聚焦盒的输入语言）。
  `.${desktopBootPanel.form}{display:grid;gap:9px}`,
  `.${desktopBootPanelClass} label{display:grid;gap:6px;font-size:12px;font-weight:850;color:color-mix(in srgb, CanvasText 72%, transparent)}`,
  `.${desktopBootPanelClass} input{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.32);border-radius:12px;background:transparent;color:CanvasText;padding:10px 12px;font:700 13px/1.3 inherit;outline:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}`,
  `.${desktopBootPanelClass} input::placeholder{color:color-mix(in srgb, CanvasText 42%, transparent);font-weight:600}`,
  `.${desktopBootPanelClass} input:focus{border-color:rgba(10,132,255,.48);box-shadow:0 0 0 3px rgba(10,132,255,.16),inset 0 1px 0 rgba(255,255,255,.24)}`,
  `.${desktopBootPanel.actions}{display:flex;gap:10px;flex-wrap:wrap;margin-top:2px}`,
  // 主按钮蓝渐变、次按钮透明 + 白描边（同连接屏「使用这台服务器 / 测试连接」的分工）。
  `.${desktopBootPanel.primary}{border:0;border-radius:12px;padding:10px 18px;font:inherit;font-weight:850;color:#fff;background:linear-gradient(135deg,#0a84ff,#64d2ff);box-shadow:0 14px 26px -10px rgba(10,132,255,.45);cursor:pointer}`,
  `.${desktopBootPanel.secondary}{border:1px solid rgba(255,255,255,.30);border-radius:12px;padding:10px 18px;font:inherit;font-weight:850;color:CanvasText;background:transparent;box-shadow:inset 0 1px 0 rgba(255,255,255,.22);cursor:pointer}`,
  `.${desktopBootPanelClass} button:disabled{opacity:.5;cursor:not-allowed}`,
  // 页签（登录 / 注册 / 我有邀请码）：同一套玻璃语言的下划线页签，选中态用系统蓝。
  `.${desktopBootPanel.tabs}{display:flex;gap:4px;border-bottom:1px solid color-mix(in srgb, CanvasText 16%, transparent);margin-bottom:2px}`,
  `.${desktopBootPanel.tabs} button{flex:1;padding:8px 6px;border:0;border-radius:10px 10px 0 0;background:transparent;font:inherit;font-size:12.5px;font-weight:850;color:color-mix(in srgb, CanvasText 55%, transparent);cursor:pointer;border-bottom:2px solid transparent}`,
  `.${desktopBootPanel.tabs} button:hover{color:color-mix(in srgb, CanvasText 80%, transparent)}`,
  `.${desktopBootPanel.tabs} button[aria-selected="true"]{color:#0a84ff;border-bottom-color:#0a84ff;background:rgba(10,132,255,.10)}`,
  `.${desktopBootPanelClass} .${desktopBootPanel.error}{margin:0;font-size:12px;font-weight:850;color:#c43d2b}`,
  // 深色外观：白光晕换暗光晕（白字被白晕糊掉），描边/投影压深一档，错误色提亮到深底上可读。
  // 次级层次（说明/细则/标签/未选中页签）同时整体提一档：玻璃的雾面本身是浅色的，深色外观下面板是
  // 一块中灰，同样的百分比在白字上比在黑字上淡得多。
  "@media (prefers-color-scheme: dark){" +
    `.${desktopBootPanelClass}{border-color:rgba(255,255,255,.16);box-shadow:0 24px 76px -46px rgba(0,0,0,.78)}` +
    `.${desktopBootPanelClass}>.wh-liquid-glass-content{text-shadow:0 1px 12px rgba(0,0,0,.5),0 0 2px rgba(0,0,0,.66)}` +
    `.${desktopBootPanelClass} input{border-color:rgba(255,255,255,.22);background:rgba(255,255,255,.06)}` +
    `.${desktopBootPanelClass} p{color:color-mix(in srgb, CanvasText 88%, transparent)}` +
    `.${desktopBootPanelClass} .${desktopBootPanel.fineprint}{color:color-mix(in srgb, CanvasText 74%, transparent)}` +
    `.${desktopBootPanelClass} label{color:color-mix(in srgb, CanvasText 84%, transparent)}` +
    `.${desktopBootPanel.tabs} button{color:color-mix(in srgb, CanvasText 70%, transparent)}` +
    `.${desktopBootPanelClass} .${desktopBootPanel.error}{color:#ff8f85}` +
  "}"
].join("\n");

export type DesktopBootPanelInput = {
  /** 面板内容（标题/说明/表单……）——各屏自己的部分，已转义。 */
  inner: string;
  /** 这张屏独有的补充样式（拼在共享样式之后，可覆盖）。 */
  extraCss?: string | undefined;
  /** 外壳上额外挂的类名（各屏保留自己的类钩子，便于定位/覆盖）。 */
  shellClass?: string | undefined;
  /** 面板本体上的额外属性串（如 aria-live="polite"），原样拼进标签。 */
  panelAttrs?: string | undefined;
};

/**
 * 渲一张首启屏：head/filter 注入 + 样式 + 外壳 + 液态玻璃面板 + 内容。
 * 面板顶部固定有一块品牌色玻璃方块（无文字、无图标字符），三张屏的取景框因此完全一致。
 */
export function renderDesktopBootPanelHtml(input: DesktopBootPanelInput): string {
  const shellClass = input.shellClass ? ` ${input.shellClass}` : "";
  const panelAttrs = input.panelAttrs ? ` ${input.panelAttrs}` : "";
  const extraCss = input.extraCss ? `\n${input.extraCss}` : "";
  return (
    `${liquidGlassHeadHtml}${liquidGlassFilterHtml}` +
    `<style>${liquidGlassFilterCss}\n${appleGlassDesignSystemCss}\n${desktopBootPanelCss}${extraCss}</style>` +
    `<main class="${designSystem.rootClass} ${desktopBootPanelShellClass}${shellClass}">` +
    `<section ${desktopBootScreenFitAttribute} class="${desktopBootPanelClass}"${panelAttrs}>` +
    `${renderWorkHubLiquidGlassLayer("spotlight")}` +
    `<span class="wh-liquid-glass-rim" aria-hidden="true"></span>` +
    `<div class="wh-liquid-glass-content">` +
    `<div class="${desktopBootPanel.mark}" aria-hidden="true"></div>` +
    `${input.inner}` +
    `</div></section></main>`
  );
}
