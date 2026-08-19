// WorkHub 桌面 · Spotlight 能力占位内联视图。
// 还没做成内联的能力（S3–S11 逐片替换）显示一张干净的统一玻璃「正在接入」卡——绝不退回旧的全屏壳。
// 这样主窗在任何能力下都保持一致的盒子内联体验。

import { escapeHtml } from "@workhub/web-runtime";

import { commandRegistry, type CommandId } from "../../command-palette.js";
import type { SpotlightCapabilityView, SpotlightViewContext } from "../view-context.js";

export function createPlaceholderView(id: CommandId): SpotlightCapabilityView {
  return {
    id,
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      const cmd = commandRegistry.find((c) => c.id === id);
      const label = cmd ? cmd.label[zh ? "zh-CN" : "en"] : id;
      const hint = cmd ? cmd.hint[zh ? "zh-CN" : "en"] : "";
      ctx.setSubtitle(zh ? "即将上线" : "Coming soon");
      ctx.body.innerHTML = `<div class="wh-spot-placeholder">
        <span class="wh-spot-placeholder-icon">${cmd?.icon ?? ""}</span>
        <h3 class="wh-spot-placeholder-title">${escapeHtml(label)}</h3>
        <p class="wh-spot-placeholder-sub">${escapeHtml(hint)}</p>
        <p class="wh-spot-placeholder-note">${zh ? "这个能力正在接入苹果聚焦盒，马上就好。" : "Wiring this capability into the box — almost there."}</p>
      </div>`;
      ctx.requestResize();
    }
  };
}
