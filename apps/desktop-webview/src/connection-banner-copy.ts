// WorkHub 桌面 · 主窗聚焦盒顶部「连接状态」细条的文案单一来源（R25-Q）。
//
// 照 ai-provider-banner-copy.ts 的既有先例：这句话不该在 spotlight/controller.ts 里内联散写一遍，
// 也不该在未来别的 surface 想引用同一句话时被迫复制粘贴。桌宠离线卡（pet-surface.ts）用的是更短的
// 独立文案（带服务器地址 + 重连计次，塞进桌宠 260×340 小窗的紧凑气泡），故不复用这个函数——两处
// 文案表达同一个事实但版面约束不同，不是"该合并成一份却没合并"的重复。

import type { WorkHubLocale } from "@workhub/ui/gold-path";

import type { DesktopShellConnectionState } from "./shell-events.js";

import { desktopT } from "./locales.js";

// state === "connected" 时返回 undefined——横幅只在"不是已连接"时才该占位，调用方据此决定要不要渲。
export function desktopConnectionBannerText(
  state: DesktopShellConnectionState,
  locale: WorkHubLocale
): string | undefined {
  const zh = locale === "zh-CN";
  if (state === "offline") {
    return desktopT(locale, "offline");
  }
  if (state === "reconnecting") {
    return desktopT(locale, "canTReachTheServerReconnecting");
  }
  return undefined;
}
