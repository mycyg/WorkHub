// WorkHub 桌面 · Spotlight「设置」能力内联视图（偏好 + 运行状态 + AI）。
// pages.settings → 统一玻璃：语言切换（可交互，updatePreferences + reload）、运行状态、AI 引擎、设备信息。
// 桌宠外观偏好走独立桌宠窗（pet_model_settings_in_web=false），这里只做账户级偏好与只读状态。
//
// R13 批 P3（功能审查 B1/B2：只观察 409 文案指向的「设置 · AI」此前不存在,两端对 5 类 AI 配置模型
// 全无入口）：这里补齐桌面端唯一的 AI 配置入口——GET/PATCH /api/me/ai-profile。五档默认/接单策略/
// Cuu 主动性走单选 chip（同一组内互斥,复用语言切换已经在用的 .wh-spot-reason[data-sel]手感）；
// Granular 四个能力开关各自独立、互不影响,用同一个 chip 类目但每个都是独立的二态开关（label 里直接
// 写出当前状态,不是靠 data-sel 的边框颜色暗示——独立开关比"选中态"更该说人话）。
// 不复用 apps/desktop-webview/src/workbench/chat/render.ts 的 renderModePopoverHtml——那份 HTML 的
// data-wb-chat-mode-* 钩子是工作台协同 composer 的私有约定,workbench/** 这一批的范围只批了
// "settings 新目录 + rail/store/shell 最小接线",不包含 chat/render.ts；本文件用 Spotlight 自己的
// wh-spot-* 视觉语言独立撰写同一份文案（标题/描述照抄 00-interaction-design.md §3/§6，故意不做
// cross-file 复用换取范围隔离，两处文案未来各自演进也不会互相牵连）。
// 读=挂载时并行拉一次 GET；写=每个 chip/开关点击即改即 PATCH，乐观更新 + 失败回滚 + 温和错误行
// （不是阻断式弹窗，同 workbench chat/view.ts selectMode 的既有取舍）。

import type {
  AiGranularSettings,
  AiMode,
  CuuProactivity,
  DispatchPolicy,
  PatchUserAiProfileRequest,
  PatchUserProfileRequest,
  SettingsPageVM,
  UserAiProfileVM,
  UserProfileVM
} from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";

const AI_PROFILE_PATH = "/api/me/ai-profile";
// R13 批 A2（派人推荐 v2）："我是谁"（个人资料），与上面的 AI_PROFILE_PATH（"AI 该怎么替我干活"）
// 语义分开，不同端点不同表。
const PROFILE_PATH = "/api/me/profile";

function localeLabel(locale: string, zh: boolean): string {
  if (locale === "zh-CN") return zh ? "简体中文" : "Chinese";
  if (locale === "en-US" || locale === "en") return zh ? "English" : "English";
  return locale;
}

// —— AI 分区文案（照 00-interaction-design.md §3 模式五档表 / §6 接单策略三档独立撰写，见顶部注释）—— //

const AI_MODE_LEVELS: readonly AiMode[] = [1, 2, 3, 4, 5];

function aiModeCopy(level: AiMode, zh: boolean): { title: string; desc: string } {
  const table: Record<AiMode, { titleZh: string; titleEn: string; descZh: string; descEn: string }> = {
    1: { titleZh: "只观察", titleEn: "Observe only", descZh: "只总结讨论，不提出也不执行", descEn: "Only summarizes — no proposals, no execution" },
    2: { titleZh: "全部先问", titleEn: "Ask first", descZh: "提出方案，任何执行都等你点头", descEn: "Proposes a plan — execution waits for your go-ahead" },
    3: { titleZh: "分级自动", titleEn: "Tiered auto", descZh: "有把握的直接干(可撤销)，拿不准的先问你", descEn: "Acts when confident (undoable) — asks first when unsure" },
    4: { titleZh: "全自动 · 人审", titleEn: "Full auto · human review", descZh: "拎出的事全都干，合并前仍由人审提议", descEn: "Does everything — a human still reviews before merge" },
    5: { titleZh: "全托管 · AI 审", titleEn: "Fully managed · AI review", descZh: "AI 复核通过即自动合并；法务/财务/身份类永远升级给人", descEn: "Auto-merges once AI review passes — legal/finance/identity always escalate" }
  };
  // AiMode is a zod-refined `number` (min 1 / max 5), not a literal union — TS can't narrow the
  // Record lookup to a known key, hence the non-null assertion (same pattern as chat/render.ts's
  // AI_MODE_CHIP_LABEL[mode]! for the identical underlying type).
  const row = table[level]!;
  return { title: zh ? row.titleZh : row.titleEn, desc: zh ? row.descZh : row.descEn };
}

function dispatchPolicyCopy(policy: DispatchPolicy, zh: boolean): { title: string; desc: string } {
  const table: Record<DispatchPolicy, { titleZh: string; titleEn: string; descZh: string; descEn: string }> = {
    auto: { titleZh: "自动接单", titleEn: "Auto-accept", descZh: "指派即建工作副本，agent 立即开工，Cuu 只是告知一声", descEn: "Accepts immediately — your agent starts right away; Cuu just lets you know" },
    ask: { titleZh: "先问我", titleEn: "Ask me first", descZh: "指派后先问你，确认了才开工", descEn: "Asks first — work starts only after you confirm" },
    manual: { titleZh: "只挂单", titleEn: "Queue only", descZh: "进任务列表，你手动启动", descEn: "Goes to your task list — you start it manually" }
  };
  const row = table[policy];
  return { title: zh ? row.titleZh : row.titleEn, desc: zh ? row.descZh : row.descEn };
}

function proactivityCopy(value: CuuProactivity, zh: boolean): { title: string; desc: string } {
  const table: Record<CuuProactivity, { titleZh: string; titleEn: string; descZh: string; descEn: string }> = {
    quiet: { titleZh: "安静", titleEn: "Quiet", descZh: "很少主动开口，等你来问", descEn: "Rarely speaks up first — waits for you to ask" },
    balanced: { titleZh: "均衡", titleEn: "Balanced", descZh: "看情况开口，不多不少(默认)", descEn: "Speaks up when it matters (default)" },
    proactive: { titleZh: "主动", titleEn: "Proactive", descZh: "更爱主动汇报进展", descEn: "Reports progress more often, unprompted" }
  };
  const row = table[value];
  return { title: zh ? row.titleZh : row.titleEn, desc: zh ? row.descZh : row.descEn };
}

type GranularKey = keyof AiGranularSettings;
const GRANULAR_KEYS: readonly GranularKey[] = ["create_work_item", "dispatch_run", "mutate_drive", "send_notification"];

function granularLabel(key: GranularKey, zh: boolean): string {
  const table: Record<GranularKey, { zh: string; en: string }> = {
    create_work_item: { zh: "建任务", en: "Create tasks" },
    dispatch_run: { zh: "派 run", en: "Dispatch runs" },
    mutate_drive: { zh: "动网盘", en: "Touch drive" },
    send_notification: { zh: "发通知", en: "Send notifications" }
  };
  return zh ? table[key].zh : table[key].en;
}

// Granular 字段未设置时视为「允许」（服务端默认空对象 = 无限制覆盖，见
// packages/contracts/src/domain/conversation.ts 的 DEFAULT_USER_AI_PROFILE.granular_settings = {}）。
function granularEffective(settings: AiGranularSettings | undefined, key: GranularKey): boolean {
  const value = settings?.[key];
  return value !== false;
}

function aiSectionHtml(profile: UserAiProfileVM | undefined, aiFailed: boolean, zh: boolean): string {
  if (aiFailed) {
    return `<div class="wh-spot-set-group" data-spot-ai-section="true">
      <div class="wh-spot-set-label">${zh ? "AI" : "AI"}</div>
      <div class="wh-spot-row-sub">${zh ? "AI 设置没拉到。" : "Couldn't load AI settings."}<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-spot-ai-retry style="margin-left:8px">${zh ? "重试" : "Retry"}</button></div>
    </div>`;
  }
  if (!profile) {
    return "";
  }
  const modeChips = AI_MODE_LEVELS.map((level) => {
    const sel = profile.default_mode === level;
    const copy = aiModeCopy(level, zh);
    return `<button type="button" class="wh-spot-reason" data-set-ai-mode="${level}" data-sel="${sel}" title="${escapeHtml(copy.desc)}">${escapeHtml(copy.title)}</button>`;
  }).join("");
  const modeDesc = aiModeCopy(profile.default_mode, zh).desc;

  const dispatchValues: readonly DispatchPolicy[] = ["auto", "ask", "manual"];
  const dispatchChips = dispatchValues.map((value) => {
    const sel = profile.dispatch_policy === value;
    const copy = dispatchPolicyCopy(value, zh);
    return `<button type="button" class="wh-spot-reason" data-set-ai-dispatch="${value}" data-sel="${sel}" title="${escapeHtml(copy.desc)}">${escapeHtml(copy.title)}</button>`;
  }).join("");
  const dispatchDesc = dispatchPolicyCopy(profile.dispatch_policy, zh).desc;

  const proactivityValues: readonly CuuProactivity[] = ["quiet", "balanced", "proactive"];
  const proactivityChips = proactivityValues.map((value) => {
    const sel = profile.cuu_proactivity === value;
    const copy = proactivityCopy(value, zh);
    return `<button type="button" class="wh-spot-reason" data-set-ai-proactivity="${value}" data-sel="${sel}" title="${escapeHtml(copy.desc)}">${escapeHtml(copy.title)}</button>`;
  }).join("");

  const granularChips = GRANULAR_KEYS.map((key) => {
    const allowed = granularEffective(profile.granular_settings, key);
    const label = granularLabel(key, zh);
    const stateText = allowed ? (zh ? "允许" : "allowed") : zh ? "已禁止" : "blocked";
    return `<button type="button" class="wh-spot-reason" data-toggle-ai-granular="${key}" data-sel="${!allowed}">${escapeHtml(label)} · ${stateText}</button>`;
  }).join("");

  return `<div class="wh-spot-set-group" data-spot-ai-section="true">
    <div class="wh-spot-set-label">${zh ? "AI · 默认模式（单聊）" : "AI · Default mode (1:1)"}</div>
    <div class="wh-spot-reasons-row">${modeChips}</div>
    <div class="wh-spot-row-sub">${escapeHtml(modeDesc)}</div>
  </div>
  <div class="wh-spot-set-group" data-spot-ai-dispatch-section="true">
    <div class="wh-spot-set-label">${zh ? "接单策略" : "Dispatch policy"}</div>
    <div class="wh-spot-reasons-row">${dispatchChips}</div>
    <div class="wh-spot-row-sub">${escapeHtml(dispatchDesc)}</div>
  </div>
  <div class="wh-spot-set-group" data-spot-ai-granular-section="true">
    <div class="wh-spot-set-label">${zh ? "AI 能做什么" : "What AI can do"}</div>
    <div class="wh-spot-reasons-row">${granularChips}</div>
  </div>
  <div class="wh-spot-set-group" data-spot-ai-proactivity-section="true">
    <div class="wh-spot-set-label">${zh ? "Cuu 主动性" : "Cuu proactivity"}</div>
    <div class="wh-spot-reasons-row">${proactivityChips}</div>
  </div>`;
}

// R13 批 A2（派人推荐 v2）："我的资料"分区，落在 AI 分区旁边（P3 已规划的落点）。三个自由文本字段
// （title/bio_md/skill_tags）用 focusout 委托保存（同一份 innerHTML 全量重绘架构下，逐字符 input
// 事件会打断输入焦点——照 AI 分区已有的"点击即改即 PATCH，乐观更新+失败回滚"取舍，只是触发时机从
// click 换成 focusout，因为这里是文本字段不是按钮）。
function profileSectionHtml(profile: UserProfileVM | undefined, profileFailed: boolean, zh: boolean): string {
  if (profileFailed) {
    return `<div class="wh-spot-set-group" data-spot-profile-section="true">
      <div class="wh-spot-set-label">${zh ? "我的资料" : "My profile"}</div>
      <div class="wh-spot-row-sub">${zh ? "资料没拉到。" : "Couldn't load your profile."}<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-spot-profile-retry style="margin-left:8px">${zh ? "重试" : "Retry"}</button></div>
    </div>`;
  }
  if (!profile) {
    return "";
  }
  const skillsValue = profile.skill_tags.join(", ");
  return `<div class="wh-spot-set-group" data-spot-profile-section="true">
    <div class="wh-spot-set-label">${zh ? "我的资料" : "My profile"}</div>
    <div class="wh-spot-row-sub">${zh ? "以后 Cuu 派活会参考这些信息。" : "Cuu will use this when suggesting who to assign work to."}</div>
    <input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-set-profile-title value="${escapeHtml(profile.title ?? "")}" maxlength="128" placeholder="${escapeHtml(zh ? "职位/角色头衔，例如：前端负责人" : "Title, e.g. Frontend lead")}" />
    <textarea class="wh-spot-freetext" data-set-profile-bio rows="3" maxlength="4000" placeholder="${escapeHtml(zh ? "简单介绍一下自己" : "A short bio")}">${escapeHtml(profile.bio_md ?? "")}</textarea>
    <input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-set-profile-skills value="${escapeHtml(skillsValue)}" placeholder="${escapeHtml(zh ? "技能标签，用逗号分隔" : "Skill tags, comma separated")}" />
  </div>`;
}

function settingsHtml(
  vm: SettingsPageVM,
  zh: boolean,
  aiProfile: UserAiProfileVM | undefined,
  aiFailed: boolean,
  aiErrorText: string | undefined,
  profile: UserProfileVM | undefined,
  profileFailed: boolean,
  profileErrorText: string | undefined
): string {
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
    ${aiSectionHtml(aiProfile, aiFailed, zh)}
    ${aiErrorText ? `<div class="wh-spot-row-sub" data-spot-ai-error="true" style="color:var(--ds-danger)">${escapeHtml(aiErrorText)}</div>` : ""}
    ${profileSectionHtml(profile, profileFailed, zh)}
    ${profileErrorText ? `<div class="wh-spot-row-sub" data-spot-profile-error="true" style="color:var(--ds-danger)">${escapeHtml(profileErrorText)}</div>` : ""}
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
      let vm: SettingsPageVM | undefined;
      let aiProfile: UserAiProfileVM | undefined;
      let aiFailed = false;
      let aiErrorText: string | undefined;
      // R13 批 A2（派人推荐 v2）："我的资料"（title/bio_md/skill_tags），独立于上面的 aiProfile
      // （PATCH /me/ai-profile 是"AI 该怎么替我干活"，这里是"我是谁"，不同表不同端点）。
      let profile: UserProfileVM | undefined;
      let profileFailed = false;
      let profileErrorText: string | undefined;
      ctx.setSubtitle(zh ? "偏好与状态" : "Preferences & status");

      const renderAll = () => {
        if (!vm) {
          return;
        }
        ctx.body.innerHTML = settingsHtml(vm, zh, aiProfile, aiFailed, aiErrorText, profile, profileFailed, profileErrorText);
        ctx.requestResize();
      };

      const loadAiProfile = async () => {
        try {
          aiProfile = await ctx.client.request<UserAiProfileVM>(AI_PROFILE_PATH);
          aiFailed = false;
        } catch {
          if (disposed) return;
          aiProfile = undefined;
          aiFailed = true;
        }
      };

      const loadProfile = async () => {
        try {
          profile = await ctx.client.request<UserProfileVM>(PROFILE_PATH);
          profileFailed = false;
        } catch {
          if (disposed) return;
          profile = undefined;
          profileFailed = true;
        }
      };

      // rank7：装载失败渲带「重试」的错误块，点重试重跑（不再死胡同）。
      const load = async () => {
        ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉设置…" : "Loading settings…"}</div>`;
        ctx.requestResize();
        try {
          vm = await ctx.client.pages.settings({ locale: ctx.locale });
        } catch {
          if (disposed) return;
          ctx.body.innerHTML = spotlightErrorHtml(zh, zh ? "设置没拉到" : "Couldn't load settings");
          ctx.requestResize();
          return;
        }
        if (disposed) return;
        storageKey = vm.language.storage_key || storageKey;
        await Promise.all([loadAiProfile(), loadProfile()]);
        if (disposed) return;
        renderAll();
      };
      void load();

      // 单个字段的乐观更新 + PATCH + 失败回滚——不重新拉整页 settings，只更新 aiProfile 这一份状态。
      function patchAiProfile(patch: PatchUserAiProfileRequest, previous: UserAiProfileVM): void {
        aiErrorText = undefined;
        renderAll();
        ctx.client
          .request<UserAiProfileVM>(AI_PROFILE_PATH, { method: "PATCH", body: JSON.stringify(patch) })
          .then((next) => {
            if (disposed) return;
            aiProfile = next;
            renderAll();
          })
          .catch(() => {
            if (disposed) return;
            aiProfile = previous;
            aiErrorText = zh ? "没保存成功，再试一次。" : "Couldn't save — try again.";
            renderAll();
          });
      }

      // 同款乐观更新 + PATCH + 失败回滚，作用在 profile 这份独立状态上。
      function patchProfile(patch: PatchUserProfileRequest, previous: UserProfileVM): void {
        profileErrorText = undefined;
        renderAll();
        ctx.client
          .request<UserProfileVM>(PROFILE_PATH, { method: "PATCH", body: JSON.stringify(patch) })
          .then((next) => {
            if (disposed) return;
            profile = next;
            renderAll();
          })
          .catch(() => {
            if (disposed) return;
            profile = previous;
            profileErrorText = zh ? "没保存成功，再试一次。" : "Couldn't save — try again.";
            renderAll();
          });
      }

      ctx.body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest("[data-spot-retry]")) {
          void load();
          return;
        }
        if (target.closest("[data-spot-ai-retry]")) {
          aiFailed = false;
          ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉设置…" : "Loading settings…"}</div>`;
          ctx.requestResize();
          void loadAiProfile().then(() => {
            if (disposed) return;
            renderAll();
          });
          return;
        }
        if (target.closest("[data-spot-profile-retry]")) {
          profileFailed = false;
          ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉设置…" : "Loading settings…"}</div>`;
          ctx.requestResize();
          void loadProfile().then(() => {
            if (disposed) return;
            renderAll();
          });
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
          return;
        }

        // —— AI 分区交互：每次点击即改即 PATCH，乐观更新 + 失败回滚（见 patchAiProfile 顶部注释）—— //
        if (!aiProfile) return;
        const modeBtn = target.closest<HTMLElement>("[data-set-ai-mode]");
        if (modeBtn?.dataset.setAiMode) {
          const level = Number(modeBtn.dataset.setAiMode) as AiMode;
          if (level === aiProfile.default_mode) return;
          const previous = aiProfile;
          aiProfile = { ...aiProfile, default_mode: level };
          patchAiProfile({ default_mode: level }, previous);
          return;
        }
        const dispatchBtn = target.closest<HTMLElement>("[data-set-ai-dispatch]");
        if (dispatchBtn?.dataset.setAiDispatch) {
          const value = dispatchBtn.dataset.setAiDispatch as DispatchPolicy;
          if (value === aiProfile.dispatch_policy) return;
          const previous = aiProfile;
          aiProfile = { ...aiProfile, dispatch_policy: value };
          patchAiProfile({ dispatch_policy: value }, previous);
          return;
        }
        const proactivityBtn = target.closest<HTMLElement>("[data-set-ai-proactivity]");
        if (proactivityBtn?.dataset.setAiProactivity) {
          const value = proactivityBtn.dataset.setAiProactivity as CuuProactivity;
          if (value === aiProfile.cuu_proactivity) return;
          const previous = aiProfile;
          aiProfile = { ...aiProfile, cuu_proactivity: value };
          patchAiProfile({ cuu_proactivity: value }, previous);
          return;
        }
        const granularBtn = target.closest<HTMLElement>("[data-toggle-ai-granular]");
        if (granularBtn?.dataset.toggleAiGranular) {
          const key = granularBtn.dataset.toggleAiGranular as GranularKey;
          const previous = aiProfile;
          // 全量重发四个 key 的显式布尔值——PATCH 的 granular_settings 是整体替换写（见
          // packages/db/src/repositories/ai-settings.ts 的 governanceUpdateValues/profileUpdateValues
          // 同款「patch.granularJson !== undefined 时整体覆盖列」实现），只发被点的这一个 key 会把其余
          // 三个键的既有覆盖悄悄清空。未设置的 key 按「允许」处理（见 granularEffective 顶部注释）。
          const nextGranular: AiGranularSettings = {};
          for (const k of GRANULAR_KEYS) {
            nextGranular[k] = k === key ? !granularEffective(previous.granular_settings, k) : granularEffective(previous.granular_settings, k);
          }
          aiProfile = { ...aiProfile, granular_settings: nextGranular };
          patchAiProfile({ granular_settings: nextGranular }, previous);
        }
      });

      // —— "我的资料"分区：自由文本字段用 focusout（离开字段时才触发，不是逐字符的 input）保存 ——
      // 同一份 innerHTML 全量重绘架构下，input 事件会在用户还在打字时就把 DOM 重建掉，打断输入焦点；
      // focusout 本身就意味着用户已经离开这个字段，这时候重绘不会有体验代价（同 AI 分区的按钮点击
      // 场景一样，都是"交互已经结束才重绘"）。focusout 会冒泡（blur 不会），所以能用同一个委托监听器。
      ctx.body.addEventListener("focusout", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !profile) return;
        const titleInput = target.closest<HTMLInputElement>("[data-set-profile-title]");
        if (titleInput) {
          const next = titleInput.value.trim();
          const nextValue = next.length > 0 ? next : null;
          if (nextValue === (profile.title ?? null)) return;
          const previous = profile;
          profile = { ...profile, title: nextValue };
          patchProfile({ title: nextValue }, previous);
          return;
        }
        const bioInput = target.closest<HTMLTextAreaElement>("[data-set-profile-bio]");
        if (bioInput) {
          const next = bioInput.value.trim();
          const nextValue = next.length > 0 ? next : null;
          if (nextValue === (profile.bio_md ?? null)) return;
          const previous = profile;
          profile = { ...profile, bio_md: nextValue };
          patchProfile({ bio_md: nextValue }, previous);
          return;
        }
        const skillsInput = target.closest<HTMLInputElement>("[data-set-profile-skills]");
        if (skillsInput) {
          const next = skillsInput.value.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
          if (JSON.stringify(next) === JSON.stringify(profile.skill_tags)) return;
          const previous = profile;
          profile = { ...profile, skill_tags: next };
          patchProfile({ skill_tags: next }, previous);
        }
      });

      return () => {
        disposed = true;
      };
    }
  };
}
