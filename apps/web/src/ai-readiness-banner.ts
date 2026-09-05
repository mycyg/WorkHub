import type { WorkHubLocale } from "@workhub/ui/gold-path";
import { escapeHtml } from "@workhub/web-runtime";

import { webT } from "./locales.js";

// R23 P2（SA-08）：README 承诺「无 key 时顶部会出现一条 AI 服务未配置的横幅」，但那条文案此前只写
// 进了桌面聊天输入区（apps/desktop-webview/src/workbench/chat/render.ts）——web 端只有设置页一行 pill，
// 首页/审批/网盘等页面完全没有提示，新用户第一次提需求才会撞上后端的失败响应。
//
// 这里是纯渲染层（无 DOM 依赖，便于单测）：browser.ts 的 bindAiReadinessNotices 负责取数（GET
// /api/health 的 ai_provider_configured——与设置页 llm_runtime.api_key_configured 同一来源
// settings.llm.apiKey，见 apps/api/src/pages/settings.ts 与 apps/api/src/app.ts 的 /api/health 处理器）
// 并在取到「未配置」时调用这里的渲染函数、把结果注进壳层的常驻横幅挂载点
// （packages/ui/src/gold-path/product-shell.ts 的 [data-wh-ai-banner]）。取数失败或已配置时橫幅保持
// hidden，不在这里处理——fail-soft 属于 browser.ts 的水合逻辑，不属于纯渲染。

const settingsHref = "/settings";

function copy(locale: WorkHubLocale) {
  const zh = locale === "zh-CN";
  return {
    bannerBody: webT(locale, "aiEngineKeyNotSetChat"),
    bannerCta: webT(locale, "viewInSettings"),
    intakeNote: webT(locale, "thisEntryNeedsTheAiEngine")
  };
}

// 常驻横幅（壳层 [data-wh-ai-banner] 的 innerHTML）：一句话说明 + 「去设置查看」链接，不带关闭按钮
// （见 product-shell.ts 顶部注释：未配置这件事在配好之前始终成立，不该有「关掉后就再也看不见」的状态）。
export function renderAiReadinessBannerHtml(locale: WorkHubLocale): string {
  const t = copy(locale);
  return `<span>${escapeHtml(t.bannerBody)}</span><a href="${settingsHref}" data-wh-route="${settingsHref}" data-wh-page-key="settings" data-r23-ai-banner-cta="true">${escapeHtml(t.bannerCta)}</a>`;
}

// intake 入口的预先说明——比顶部横幅更具体（点名「提交会失败」），插在 intake 路由面板内部靠近
// 起点的位置。data-r23-intake-ai-note 供 browser.ts 判断是否已经注入过（同一路由面板不重复插入）。
export function renderIntakeAiReadinessNoteHtml(locale: WorkHubLocale): string {
  const t = copy(locale);
  return `<p class="wh-subtle" data-r23-intake-ai-note="true">${escapeHtml(t.intakeNote)}</p>`;
}
