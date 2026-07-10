// WorkHub 桌面 · Spotlight「设置」能力内联视图（偏好 + 运行状态）。
// pages.settings → 统一玻璃：语言切换（可交互，updatePreferences + reload）、运行状态、AI 引擎、设备信息。
// 桌宠外观偏好走独立桌宠窗（pet_model_settings_in_web=false），这里只做账户级偏好与只读状态。

import type { SettingsPageVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";

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
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "AI 助手" : "AI assistant"}</span><span class="wh-spot-metric-v" style="color:${vm.llm_runtime.api_key_configured ? "var(--ds-success)" : "var(--ds-warn)"}">${vm.llm_runtime.api_key_configured ? (zh ? "已就绪" : "Ready") : zh ? "待配置" : "Not set up"}</span></div>
    </div>
    <div class="wh-spot-row" style="cursor:default">
      <div class="wh-spot-row-main">
        <div class="wh-spot-row-title">${zh ? "桌面客户端" : "Desktop client"}</div>
        <div class="wh-spot-row-sub">${zh ? "桌宠外观在独立桌宠窗设置；本地动作仅桌面端可用" : "Pet appearance is set on the pet window; local actions are desktop-only"}</div>
      </div>
    </div>
    <div class="wh-spot-row">
      <div class="wh-spot-row-main">
        <div class="wh-spot-row-title">${zh ? "账户" : "Account"}</div>
        <div class="wh-spot-row-sub">${zh ? "退出当前身份并重新绑定这台设备" : "Sign out and re-bind this device"}</div>
      </div>
      <button type="button" class="wh-spot-act wh-spot-act--danger ds-pressable" data-set-logout="true">${zh ? "登出" : "Sign out"}</button>
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
      // rank7：装载失败渲带「重试」的错误块，点重试重跑（不再死胡同）。
      const load = async () => {
        ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉设置…" : "Loading settings…"}</div>`;
        ctx.requestResize();
        try {
          const vm = await ctx.client.pages.settings({ locale: ctx.locale });
          if (disposed) return;
          storageKey = vm.language.storage_key || storageKey;
          ctx.body.innerHTML = settingsHtml(vm, zh);
        } catch {
          if (disposed) return;
          ctx.body.innerHTML = spotlightErrorHtml(zh, zh ? "设置没拉到" : "Couldn't load settings");
        }
        ctx.requestResize();
      };
      void load();

      ctx.body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest("[data-spot-retry]")) {
          void load();
          return;
        }
        // R9（身份边缘 high）：桌面此前完全没有登出/换身份入口——首启绑定后永久持有身份。
        // 登出=吊销服务端会话（尽力而为）+清本地 client_token+整窗 reload（重走 bootstrap 绑定流）。
        const logoutBtn = target.closest<HTMLElement>("[data-set-logout]");
        if (logoutBtn) {
          ctx.toast(zh ? "正在登出…" : "Signing out…", "info");
          void ctx.client.logout()
            .catch(() => undefined)
            .then(() => {
              try {
                window.localStorage.removeItem("workhub_client_token");
                window.localStorage.removeItem("yqgl_client_token");
                // R10：落显式登出标记——boot 见它则停在重新绑定屏，不再用固定昵称自动绑回同一账户。
                window.localStorage.setItem("workhub_desktop_logged_out", "1");
                // R11 回归修复：Rust 壳层 SSE worker 独立持有 client token——不清空它，
                // 登出后后台仍带旧身份重连推送流。空串即清（main.rs set_client_token 语义）。
                const tauri = (globalThis as {
                  __TAURI__?: {
                    core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
                    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
                  };
                }).__TAURI__;
                const invoke = tauri?.core?.invoke ?? tauri?.invoke;
                if (typeof invoke === "function") {
                  void invoke("set_client_token", { token: "" }).catch(() => undefined);
                }
              } catch {
                // ignore storage failure
              }
              window.location.reload();
            });
          return;
        }
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
