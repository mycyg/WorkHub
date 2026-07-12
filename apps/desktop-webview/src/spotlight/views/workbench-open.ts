// WorkHub 桌面 · Spotlight「打开工作台」「新建项目」两条入口。
// 工作台是独立的原生 Tauri 窗口（不是盒子内联能力），所以这两个 view 的 mount() 不渲染业务内容——
// 它们唯一的动作是 invoke 真实的 Tauri command "open_workbench"（client-tauri/src-tauri/src/main.rs
// 里已注册，批 0 的 Rust 范围完成），成功后给出「已打开」的确认态；失败/非 Tauri 环境（浏览器 dev 预览）
// 给出诚实的说明，不假装打开了。

import { escapeHtml } from "@workhub/web-runtime";

import type { CommandId } from "../../command-palette.js";
import { resolveDesktopTauriInvoke } from "../../desktop-window-controls.js";
import type { SpotlightCapabilityView, SpotlightViewContext } from "../view-context.js";

function openWorkbenchLoadingHtml(zh: boolean): string {
  return `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在打开工作台窗口…" : "Opening the workbench window…"}</div>`;
}

function openWorkbenchSuccessHtml(zh: boolean, projectLabel: string | undefined): string {
  const detail = projectLabel
    ? zh
      ? `已在工作台窗口打开「${escapeHtml(projectLabel)}」。`
      : `Opened "${escapeHtml(projectLabel)}" in the workbench window.`
    : zh
      ? "已打开工作台窗口。"
      : "Opened the workbench window.";
  return `<div class="wh-spot-placeholder">
    <p class="wh-spot-placeholder-sub">${detail}</p>
  </div>`;
}

function openWorkbenchUnavailableHtml(zh: boolean): string {
  return `<div class="wh-spot-placeholder">
    <p class="wh-spot-placeholder-sub">${zh ? "工作台只在桌面客户端里可用，这个预览环境打不开原生窗口。" : "The workbench only opens inside the desktop app — this preview can't open a native window."}</p>
  </div>`;
}

function openWorkbenchErrorHtml(zh: boolean): string {
  return `<div class="wh-spot-error">${zh ? "没打开工作台窗口，稍后重试" : "Couldn't open the workbench window — retry"}
    <div style="margin-top:13px"><button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-spot-retry>${zh ? "重试" : "Retry"}</button></div>
  </div>`;
}

// bare=true（「新建项目」入口）永远不带 projectId：打开一个空的工作台窗口，用户在那边点左栏的
// 「新建项目」瓦片走真正的创建流程（rail.ts 的模态，接 POST /api/projects/bootstrap）。
export function createWorkbenchOpenView(id: CommandId, options: { bare: boolean } = { bare: false }): SpotlightCapabilityView {
  return {
    id,
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      const projectId = options.bare ? undefined : ctx.target?.id;
      const projectLabel = options.bare ? undefined : ctx.target?.label;
      ctx.setSubtitle(zh ? "打开中" : "Opening");
      const invoke = resolveDesktopTauriInvoke();
      if (!invoke) {
        ctx.body.innerHTML = openWorkbenchUnavailableHtml(zh);
        ctx.requestResize();
        return;
      }
      const attempt = () => {
        ctx.body.innerHTML = openWorkbenchLoadingHtml(zh);
        ctx.requestResize();
        void Promise.resolve(invoke("open_workbench", projectId ? { projectId } : {}))
          .then(() => {
            ctx.body.innerHTML = openWorkbenchSuccessHtml(zh, projectLabel);
            ctx.requestResize();
          })
          .catch(() => {
            ctx.body.innerHTML = openWorkbenchErrorHtml(zh);
            ctx.requestResize();
          });
      };
      // 一个委托监听器管重试（照 spotlightErrorHtml 的 data-spot-retry 约定），不是每次失败后现挂一个。
      ctx.body.addEventListener(
        "click",
        (event) => {
          if (event.target instanceof HTMLElement && event.target.closest("[data-spot-retry]")) {
            attempt();
          }
        },
        { signal: ctx.signal }
      );
      attempt();
    }
  };
}
