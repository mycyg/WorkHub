// WorkHub 桌面 · 「AI 服务未配置」横幅文案单一来源（R24 S6 / 原 R14 FIX#8）。
//
// 这句话此前只写在工作台聊天区（workbench/chat/render.ts 的 renderNoAiProviderBannerHtml），只用
// 工作台聊天区的人才看得到（E-11）。Spotlight 聚焦盒是产品主推的用法，同一个事实（服务端没配模型
// 密钥，Cuu 不会回应）也要在那里说——两处渲染各自的 DOM/样式，但文案必须是同一句话，不许各写一份、
// 日后改一处漏一处。

import type { WorkHubLocale } from "@workhub/ui/gold-path";

import { desktopT } from "./locales.js";

export function noAiProviderConfiguredText(locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  return desktopT(locale, "theAiServiceIsnTConfigured");
}
