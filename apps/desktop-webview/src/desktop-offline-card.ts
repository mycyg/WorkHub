import type { WorkHubLocale } from "@workhub/ui/gold-path";

import { liquidGlassHeadHtml } from "./liquid-glass.js";
import {
  liquidGlassFilterCss,
  liquidGlassFilterHtml,
  renderWorkHubLiquidGlassLayer
} from "./liquid-glass-filter.js";

type DesktopOfflineCardInput = {
  apiBase: string;
  detail: string;
  locale: WorkHubLocale;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/gu, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char
  ));
}

export function renderDesktopOfflineCardHtml(input: DesktopOfflineCardInput): string {
  const zh = input.locale === "zh-CN";
  const title = zh ? "暂时连不上后端" : "Can't reach the backend";
    const body = zh
      ? `WorkHub 桌面端需要后端运行后才能同步项目、网盘和审批。当前连接：${input.apiBase}`
      : `WorkHub desktop needs the backend running before it can sync projects, drive files, and approvals. Trying: ${input.apiBase}`;
    const hint = zh
      ? "请先启动后端（默认端口 8787），或在这里修改服务器地址后重试。"
      : "Start the backend on the default port 8787, or change the server address here, then retry.";

  return `${liquidGlassHeadHtml}${liquidGlassFilterHtml}<style>${liquidGlassFilterCss}
html,body,#root{margin:0;min-height:100%;background:rgba(0,0,0,0)!important}
.wh-desktop-offline-shell{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;box-sizing:border-box;font-family:'M PLUS Rounded 1c','Noto Sans SC','Segoe UI',sans-serif;color:CanvasText;background:transparent}
.wh-desktop-offline-card{position:relative;box-sizing:border-box;width:min(520px,100%);border-radius:22px;background:transparent;border:1px solid rgba(255,255,255,.26);box-shadow:0 24px 76px -46px rgba(0,0,0,.52);overflow:hidden;--wh-liquid-edge:16px}
.wh-desktop-offline-card>.wh-liquid-glass-content{display:grid;gap:12px;padding:30px 30px 26px;text-shadow:0 1px 12px rgba(255,255,255,.42),0 0 2px rgba(255,255,255,.66)}
.wh-desktop-offline-mark{width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#0a84ff,#64d2ff);box-shadow:0 10px 22px -6px rgba(10,132,255,.45)}
.wh-desktop-offline-card h2{margin:2px 0 0;font-size:20px;font-weight:900;line-height:1.24;color:CanvasText}
  .wh-desktop-offline-card p{margin:0;color:color-mix(in srgb, CanvasText 78%, transparent);line-height:1.55}
  .wh-desktop-offline-hint{font-size:13px;color:color-mix(in srgb, CanvasText 64%, transparent)}
  .wh-desktop-offline-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}
  .wh-desktop-offline-actions button{border-radius:12px;padding:10px 18px;font:inherit;font-weight:850;cursor:pointer}
  .wh-desktop-offline-actions button:first-child{border:0;color:#fff;background:linear-gradient(135deg,#0a84ff,#64d2ff);box-shadow:0 14px 26px -10px rgba(10,132,255,.45)}
  .wh-desktop-offline-actions button:last-child{border:1px solid rgba(255,255,255,.30);color:CanvasText;background:transparent;box-shadow:inset 0 1px 0 rgba(255,255,255,.22)}
  .wh-desktop-offline-settings{display:grid;gap:9px;border-top:1px solid rgba(255,255,255,.22);padding-top:12px}
  .wh-desktop-offline-settings[hidden]{display:none}
  .wh-desktop-offline-settings label{display:grid;gap:6px;font-size:12px;font-weight:850;color:color-mix(in srgb, CanvasText 72%, transparent)}
  .wh-desktop-offline-settings input{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.32);border-radius:12px;background:transparent;color:CanvasText;padding:10px 12px;font:700 13px/1.3 inherit;outline:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}
  .wh-desktop-offline-settings input:focus{border-color:rgba(10,132,255,.48);box-shadow:0 0 0 3px rgba(10,132,255,.16),inset 0 1px 0 rgba(255,255,255,.24)}
  .wh-desktop-offline-settings-row{display:flex;gap:8px;flex-wrap:wrap}
  .wh-desktop-offline-settings-row button{border:1px solid rgba(255,255,255,.30);border-radius:12px;background:transparent;color:CanvasText;padding:9px 14px;font:inherit;font-weight:850;cursor:pointer}
  .wh-desktop-offline-settings-row button:first-child{border:0;color:#fff;background:linear-gradient(135deg,#0a84ff,#64d2ff)}
  .wh-desktop-offline-detail{margin-top:2px;font-size:11px;color:color-mix(in srgb, CanvasText 52%, transparent);word-break:break-all}
  .wh-desktop-offline-detail summary{cursor:pointer;font-weight:850}
  </style><main class="wh-desktop-offline-shell"><section class="wh-desktop-offline-card" aria-live="polite">${renderWorkHubLiquidGlassLayer("spotlight")}<span class="wh-liquid-glass-rim" aria-hidden="true"></span><div class="wh-liquid-glass-content"><div class="wh-desktop-offline-mark" aria-hidden="true"></div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p><p class="wh-desktop-offline-hint">${escapeHtml(hint)}</p><div class="wh-desktop-offline-actions"><button id="wh-retry" type="button">${zh ? "重试" : "Retry"}</button><button id="wh-open-settings" type="button">${zh ? "打开设置" : "Open Settings"}</button></div><form id="wh-offline-settings" class="wh-desktop-offline-settings" hidden><label>${zh ? "服务器地址" : "Server address"}<input id="wh-api-base" name="apiBase" type="url" value="${escapeHtml(input.apiBase)}" placeholder="http://127.0.0.1:8787" /></label><div class="wh-desktop-offline-settings-row"><button type="submit">${zh ? "保存并重试" : "Save and Retry"}</button><button id="wh-default-api" type="button">${zh ? "使用默认" : "Use Default"}</button></div></form><details class="wh-desktop-offline-detail"><summary>${zh ? "高级详情" : "Details"}</summary>${escapeHtml(input.detail)}</details></div></section></main>`;
  }
