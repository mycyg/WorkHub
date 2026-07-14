// R14 批 CHAT（web-avatars，2026-07-14 用户点名新增，见 r12-desktop-workbench/reports/
// r14-web-avatars.md）：可复用的只读头像 tile 字符串渲染 helper——首字母色块 tile 打底 +
// data-r14-avatar-tile-user-id 钩子，供 apps/web/src/browser.ts 的 bindAvatarTiles（路由渲染后的
// 命令式水合步骤，纯 DOM，不属于这个文件）据此把 <img src="/api/users/:id/avatar"> 叠上去。
//
// 复用设置页「我的资料」头像预览已经在用的三个 class（.wh-avatar-preview / .wh-avatar-fallback /
// .wh-avatar-img，定义见 packages/ui/src/gold-path/route-components.ts 的 webRouteComponentCss）——
// 不是重新发明一套视觉，只加一个更小尺寸的 modifier class（.wh-avatar-preview--sm，供审批/成本/
// 项目/会议/工单等列表行内联使用），沿用现状已经选定的「首字母色块打底 + img 叠加，onerror 时
// img 保持 hidden、色块天然兜底」这套回退模式，不重新设计。
//
// 与桌面 apps/desktop-webview 的 avatarTileHtml（workbench/chat/render.ts）故意不共享实现：桌面
// 按 userId 算 hue 给每个人一个不同底色，web 的设置页头像预览从一开始就用统一的中性底色
// （.wh-avatar-preview 的 var(--wh-product-line)），这里延续 web 自己已经选定的这套简化视觉——
// 范围围栏也不许碰 apps/desktop-webview，两边各自独立演化不算重复造轮子。
//
// 没有 nickname 可用时（如审批请求的 routed_to_user_id/delegated_to_user_id，VM 里只带 id、没有
// 任何配对的展示名——见报告里的"仅头像无姓名"分类）label 传空串：回退字母显示 "?"，且整个 tile
// 标成 aria-hidden（没有可读的人名，不值得对屏幕阅读器宣称"这是一张头像"）；图片本身仍然照常
// 尝试加载——用户认得出照片里的同事，哪怕这里读不出名字。

export type PersonAvatarTileInput = {
  /** 真人 user_id——用于拼 /api/users/:id/avatar 与水合钩子，不做格式校验（上游已经是 idSchema）。 */
  userId: string;
  /** 配对的昵称/标签，用于计算首字母回退与可访问名；没有就传空串。 */
  label: string;
  /** "sm"（默认，18px，供行内列表/pill 旁使用）｜"md"（48px，独立展示位）。 */
  size?: "sm" | "md";
};

function escapeAttr(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

/** 纯字符串渲染，零 DOM 依赖——与 avatar-crop.ts 同一套约定，可在 web/desktop 任意 SSR 上下文里调用。 */
export function personAvatarTileHtml(input: PersonAvatarTileInput): string {
  const trimmed = input.label.trim();
  const initial = trimmed ? trimmed[0]!.toUpperCase() : "?";
  const sizeClass = input.size === "md" ? "wh-avatar-preview" : "wh-avatar-preview wh-avatar-preview--sm";
  const a11yAttrs = trimmed ? ` role="img" aria-label="${escapeAttr(trimmed)}"` : " aria-hidden=\"true\"";
  return `<span class="${sizeClass}" data-r14-avatar-tile-user-id="${escapeAttr(input.userId)}"${a11yAttrs}><span class="wh-avatar-fallback" aria-hidden="true">${escapeAttr(initial)}</span><img class="wh-avatar-img" alt="" hidden /></span>`;
}
