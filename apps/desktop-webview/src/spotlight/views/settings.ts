// WorkHub 桌面 · Spotlight「设置」能力内联视图（偏好 + 运行状态）。
// pages.settings → 统一玻璃：语言切换（可交互，updatePreferences + reload）、运行状态、AI 引擎、设备信息。
// 桌宠外观偏好走独立桌宠窗（pet_model_settings_in_web=false），这里只做账户级偏好与只读状态。

import type { SettingsPageVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import type { SpotlightCapabilityView, SpotlightViewContext } from "../view-context.js";

function localeLabel(locale: string, zh: boolean): string {
  if (locale === "zh-CN") return zh ? "简体中文" : "Chinese";
  if (locale === "en-US" || locale === "en") return zh ? "English" : "English";
  return locale;
}

function settingsHtml(vm: SettingsPageVM, zh: boolean): string {
  const lang = vm.language;
  const langChips = lang.supported_locales
    .map(
      (loc) =>
        `<button type="button" class="wh-spot-reason" data-set-locale="${escapeHtml(loc)}" data-sel="${loc === lang.active_locale}">${escapeHtml(localeLabel(loc, zh))}</button>`
    )
    .join("");
  const runtimeOk = vm.runtime.runtime_status === "ready";
  return `<div class="wh-spot-dash">
    <div class="wh-spot-set-group">
      <div class="wh-spot-set-label">${zh ? "语言" : "Language"}</div>
      <div class="wh-spot-reasons-row">${langChips}</div>
    </div>
    <div class="wh-spot-metrics">
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "运行状态" : "Runtime"}</span><span class="wh-spot-metric-v" style="color:${runtimeOk ? "var(--ds-success)" : "var(--ds-warn)"}">${runtimeOk ? (zh ? "正常" : "Ready") : zh ? "需关注" : "Attention"}</span></div>
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "AI 模型" : "AI model"}</span><span class="wh-spot-metric-v" style="font-size:13px">${escapeHtml(vm.llm_runtime.default_model)}</span></div>
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "密钥" : "API key"}</span><span class="wh-spot-metric-v">${vm.llm_runtime.api_key_configured ? (zh ? "已配置" : "Set") : zh ? "未配置" : "Missing"}</span></div>
    </div>
    <div class="wh-spot-row" style="cursor:default">
      <div class="wh-spot-row-main">
        <div class="wh-spot-row-title">${zh ? "桌面客户端" : "Desktop client"}</div>
        <div class="wh-spot-row-sub">${zh ? "桌宠外观在独立桌宠窗设置；本地动作仅桌面端可用" : "Pet appearance is set on the pet window; local actions are desktop-only"}</div>
      </div>
    </div>
  </div>`;
}

export function createSettingsView(): SpotlightCapabilityView {
  return {
    id: "settings",
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      let disposed = false;
      let storageKey = "workhub_locale";
      ctx.setSubtitle(zh ? "偏好与状态" : "Preferences & status");
      ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉设置…" : "Loading settings…"}</div>`;
      ctx.requestResize();
      void (async () => {
        try {
          const vm = await ctx.client.pages.settings({ locale: ctx.locale });
          if (disposed) return;
          storageKey = vm.language.storage_key || storageKey;
          ctx.body.innerHTML = settingsHtml(vm, zh);
        } catch {
          if (disposed) return;
          ctx.body.innerHTML = `<div class="wh-spot-error">${zh ? "设置没拉到，稍后重试" : "Couldn't load settings — retry"}</div>`;
        }
        ctx.requestResize();
      })();

      ctx.body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const loc = target.closest<HTMLElement>("[data-set-locale]");
        if (loc?.dataset.setLocale && loc.dataset.sel !== "true") {
          const next = loc.dataset.setLocale;
          ctx.toast(zh ? "正在切换语言…" : "Switching language…", "info");
          try {
            window.localStorage.setItem(storageKey, next);
          } catch {
            // ignore storage failure
          }
          void ctx.client
            .updatePreferences({ locale: next as "zh-CN" | "en-US" })
            .then(() => window.location.reload())
            .catch(() => ctx.toast(zh ? "切换失败，稍后重试" : "Failed — retry", "error"));
        }
      });

      return () => {
        disposed = true;
      };
    }
  };
}
