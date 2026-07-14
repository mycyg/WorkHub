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

import {
  AVATAR_CROP_OUTPUT_SIZE,
  cropSourceRect,
  initialCropState,
  maxCropScale,
  minCropScale,
  panCropBy,
  zoomCropTo,
  type CropState,
  type NaturalSize
} from "@workhub/ui";

import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";
import { driveResourceApiBase, fetchDriveResource } from "./drive.js";

const AI_PROFILE_PATH = "/api/me/ai-profile";
// R13 批 A2（派人推荐 v2）："我是谁"（个人资料），与上面的 AI_PROFILE_PATH（"AI 该怎么替我干活"）
// 语义分开，不同端点不同表。
const PROFILE_PATH = "/api/me/profile";
// R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增）：头像二进制的 PUT/DELETE 端点；
// GET 的预览走 fetchDriveResource（同网盘那套 client-token 鉴权+401 自愈重试——桌面端 auth 是
// token 走响应体，不是 cookie，<img src> 直连拿不到鉴权头，必须走这条已有的授权 fetch 复用同一份逻辑）。
const AVATAR_PATH = "/api/me/avatar";
function avatarHref(userId: string): string {
  return `/api/users/${encodeURIComponent(userId)}/avatar`;
}

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

// R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增）：头像分区落在"我的资料"文本字段前面
// （同一个"我是谁"故事的一部分）。<img> 起手 hidden——预览走鉴权 fetch（见文件头 avatarHref 注释），
// 不能像 web 端那样直接给 src；createSettingsView().mount 的 renderAll() 每次全量重绘后异步把
// blob URL 塞回来（hydrateAvatarPreview），拉不到/没头像就保持回退首字母 tile。
function avatarSectionHtml(profile: UserProfileVM | undefined, profileFailed: boolean, zh: boolean): string {
  if (profileFailed || !profile) {
    return "";
  }
  const initial = (profile.nickname ?? "").trim();
  const fallbackLetter = initial ? initial[0]!.toUpperCase() : "?";
  return `<div class="wh-spot-set-group" data-spot-avatar-section="true">
    <div class="wh-spot-set-label">${zh ? "头像" : "Avatar"}</div>
    <div class="wh-spot-avatar-row" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span class="wh-spot-avatar-preview" data-spot-avatar-preview="true" style="position:relative;display:inline-flex;width:44px;height:44px;flex:0 0 auto;border-radius:50%;overflow:hidden;background:var(--ds-ink-faint)">
        <span class="wh-spot-avatar-fallback" data-spot-avatar-fallback="true" aria-hidden="true" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800">${escapeHtml(fallbackLetter)}</span>
        <img class="wh-spot-avatar-img" data-spot-avatar-img="true" alt="${escapeHtml(zh ? "当前头像" : "Current avatar")}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" hidden />
      </span>
      <label class="wh-spot-act wh-spot-act--quiet ds-pressable wh-spot-upload-label" data-spot-avatar-upload-label="true">
        <span>${zh ? "更换头像" : "Change avatar"}</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" class="wh-spot-file-input" data-spot-avatar-file-input="true" />
      </label>
      <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-spot-avatar-remove-btn="true" hidden>${zh ? "移除头像" : "Remove avatar"}</button>
    </div>
    <div class="wh-spot-row-sub" data-spot-avatar-status="true" hidden></div>
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
    ${avatarSectionHtml(profile, profileFailed, zh)}
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

// R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增，追加拍板：必须支持用户自己裁剪，不能只做
// 自动居中裁）——桌面 Spotlight 设置视图自己的裁剪层：选图后弹一个固定方形取景框，支持拖动平移
// （Pointer Events）+ 缩放滑杆，确认后按取景框换算出源图区域、canvas 裁出 256x256 再走
// PUT /api/me/avatar。取景框↔源图的坐标数学复用 packages/ui 的纯函数（同 apps/web/src/
// avatar-crop-modal.ts 那份 web 端实现），DOM 编排各自独立成文——两端"薄 DOM 层各写一份、
// 共享同一套坐标数学"是本批设计的既定取舍，不是遗漏了去重。
//
// SpotlightAvatarCropDeps 是这层相对"真实 DOM/Image/canvas"的唯一接缝：生产用
// defaultSpotlightAvatarCropDeps（真浏览器 API），测试注入假 dom/假图片加载/假 canvas 编码——
// createSettingsView() 本身可以在无 DOM 的 node:test 下 import（不像 apps/web/src/browser.ts
// 顶层直接摸 document 那样一 import 就炸），但 mount() 内部的真实交互仍然离不开真 DOM，所以这个
// 裁剪层同样需要走依赖注入才能被单测覆盖。
const SPOTLIGHT_AVATAR_CROP_VIEWPORT_SIZE = 240;

export type SpotlightAvatarCropElement = {
  style: Record<string, string>;
  className: string;
  textContent: string | null;
  hidden: boolean;
  disabled?: boolean;
  type?: string;
  value?: string;
  min?: string;
  max?: string;
  step?: string;
  alt?: string;
  appendChild(child: SpotlightAvatarCropElement): void;
  remove(): void;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, handler: (event: any) => void): void;
  setPointerCapture?(pointerId: number): void;
};

export type SpotlightAvatarCropRect = { sx: number; sy: number; sWidth: number; sHeight: number };

export type SpotlightAvatarCropLoadedImage = {
  previewElement: SpotlightAvatarCropElement;
  drawSource: unknown;
  naturalSize: NaturalSize;
  release: () => void;
};

export type SpotlightAvatarCropDeps = {
  createElement: (tag: string) => SpotlightAvatarCropElement;
  appendToBody: (el: SpotlightAvatarCropElement) => void;
  loadImage: (file: File) => Promise<SpotlightAvatarCropLoadedImage>;
  renderCrop: (source: unknown, rect: SpotlightAvatarCropRect, outputSize: number) => Promise<Blob>;
};

export function defaultSpotlightAvatarCropDeps(): SpotlightAvatarCropDeps {
  return {
    createElement: (tag) => document.createElement(tag) as unknown as SpotlightAvatarCropElement,
    appendToBody: (el) => document.body.appendChild(el as unknown as Node),
    loadImage: (file) =>
      new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
          resolve({
            previewElement: image as unknown as SpotlightAvatarCropElement,
            drawSource: image,
            naturalSize: { width: image.naturalWidth, height: image.naturalHeight },
            release: () => URL.revokeObjectURL(url)
          });
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("avatar_image_load_failed"));
        };
        image.src = url;
      }),
    renderCrop: (source, rect, outputSize) =>
      new Promise((resolve, reject) => {
        const canvas = document.createElement("canvas");
        canvas.width = outputSize;
        canvas.height = outputSize;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("avatar_canvas_unavailable"));
          return;
        }
        ctx.drawImage(source as CanvasImageSource, rect.sx, rect.sy, rect.sWidth, rect.sHeight, 0, 0, outputSize, outputSize);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
              return;
            }
            canvas.toBlob((pngBlob) => {
              if (pngBlob) {
                resolve(pngBlob);
              } else {
                reject(new Error("avatar_encode_failed"));
              }
            }, "image/png");
          },
          "image/webp",
          0.86
        );
      })
  };
}

// 导出供测试注入假 deps；生产调用点（createSettingsView 的 mount 内部）不传第四参，走真浏览器 API。
export function openSpotlightAvatarCropModal(
  file: File,
  zh: boolean,
  onConfirm: (blob: Blob) => void | Promise<void>,
  deps: SpotlightAvatarCropDeps = defaultSpotlightAvatarCropDeps()
): Promise<void> {
  return new Promise((resolveOpen, rejectOpen) => {
    void deps
      .loadImage(file)
      .then((loaded) => {
        let disposed = false;
        let state: CropState = initialCropState(loaded.naturalSize, SPOTLIGHT_AVATAR_CROP_VIEWPORT_SIZE);

        const overlay = deps.createElement("div");
        overlay.className = "wh-spot-avatar-crop-overlay";
        overlay.style.cssText =
          "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(15,18,28,.55);z-index:2000";

        const modal = deps.createElement("div");
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-label", zh ? "裁剪头像" : "Crop avatar");
        modal.style.cssText =
          "background:#fff;border-radius:16px;padding:20px;display:grid;gap:14px;max-width:calc(100vw - 32px)";

        const title = deps.createElement("h3");
        title.textContent = zh ? "裁剪头像" : "Crop avatar";
        title.style.cssText = "margin:0;font-size:16px";

        const viewport = deps.createElement("div");
        viewport.style.cssText = `position:relative;width:${SPOTLIGHT_AVATAR_CROP_VIEWPORT_SIZE}px;height:${SPOTLIGHT_AVATAR_CROP_VIEWPORT_SIZE}px;overflow:hidden;border-radius:12px;background:#111;touch-action:none;cursor:grab`;

        const previewEl = loaded.previewElement;
        previewEl.style.position = "absolute";
        previewEl.style.left = "0px";
        previewEl.style.top = "0px";
        previewEl.style.transformOrigin = "top left";
        previewEl.alt = "";

        const zoomSlider = deps.createElement("input");
        zoomSlider.type = "range";
        const minScale = minCropScale(loaded.naturalSize, SPOTLIGHT_AVATAR_CROP_VIEWPORT_SIZE);
        const maxScale = maxCropScale(loaded.naturalSize, SPOTLIGHT_AVATAR_CROP_VIEWPORT_SIZE);
        zoomSlider.min = String(minScale);
        zoomSlider.max = String(maxScale);
        zoomSlider.step = String((maxScale - minScale) / 200 || 0.001);
        zoomSlider.value = String(state.scale);
        zoomSlider.setAttribute("aria-label", zh ? "缩放" : "Zoom");

        const hint = deps.createElement("p");
        hint.textContent = zh
          ? "拖动图片调整位置，用滑杆缩放，取景框内的区域会被保存为头像。"
          : "Drag to reposition, use the slider to zoom — the area inside the frame becomes your avatar.";
        hint.style.cssText = "margin:0;font-size:12px;color:#666";

        const actions = deps.createElement("div");
        actions.style.cssText = "display:flex;gap:10px;justify-content:flex-end";
        const cancelBtn = deps.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "wh-spot-act wh-spot-act--quiet";
        cancelBtn.textContent = zh ? "取消" : "Cancel";
        const confirmBtn = deps.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "wh-spot-act wh-spot-act--primary";
        confirmBtn.textContent = zh ? "确认" : "Confirm";

        viewport.appendChild(previewEl);
        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
        modal.appendChild(title);
        modal.appendChild(viewport);
        modal.appendChild(zoomSlider);
        modal.appendChild(hint);
        modal.appendChild(actions);
        overlay.appendChild(modal);
        deps.appendToBody(overlay);

        const applyState = () => {
          previewEl.style.width = `${loaded.naturalSize.width * state.scale}px`;
          previewEl.style.height = `${loaded.naturalSize.height * state.scale}px`;
          previewEl.style.left = `${state.offset.x}px`;
          previewEl.style.top = `${state.offset.y}px`;
        };
        applyState();

        const close = () => {
          if (disposed) {
            return;
          }
          disposed = true;
          overlay.remove();
          loaded.release();
        };

        let dragging = false;
        let dragStart = { x: 0, y: 0 };
        let dragBase = state;
        viewport.addEventListener("pointerdown", (event: PointerEvent) => {
          dragging = true;
          dragStart = { x: event.clientX, y: event.clientY };
          dragBase = state;
          viewport.setPointerCapture?.(event.pointerId);
        });
        viewport.addEventListener("pointermove", (event: PointerEvent) => {
          if (!dragging) {
            return;
          }
          const delta = { x: event.clientX - dragStart.x, y: event.clientY - dragStart.y };
          state = panCropBy(dragBase, delta, loaded.naturalSize, SPOTLIGHT_AVATAR_CROP_VIEWPORT_SIZE);
          applyState();
        });
        const endDrag = () => {
          dragging = false;
        };
        viewport.addEventListener("pointerup", endDrag);
        viewport.addEventListener("pointercancel", endDrag);

        zoomSlider.addEventListener("input", () => {
          const next = Number(zoomSlider.value);
          state = zoomCropTo(state, Number.isFinite(next) ? next : state.scale, loaded.naturalSize, SPOTLIGHT_AVATAR_CROP_VIEWPORT_SIZE);
          zoomSlider.value = String(state.scale);
          applyState();
        });

        cancelBtn.addEventListener("click", () => {
          close();
          resolveOpen();
        });

        confirmBtn.addEventListener("click", () => {
          const rect = cropSourceRect(state, SPOTLIGHT_AVATAR_CROP_VIEWPORT_SIZE);
          void deps
            .renderCrop(loaded.drawSource, rect, AVATAR_CROP_OUTPUT_SIZE)
            .then((blob) => {
              close();
              return onConfirm(blob);
            })
            .then(() => resolveOpen())
            .catch((error: unknown) => {
              close();
              rejectOpen(error);
            });
        });
      })
      .catch((error: unknown) => {
        rejectOpen(error);
      });
  });
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
      // R14 批 AVATAR：头像预览走鉴权 fetch（见文件头 avatarHref 注释），拿到的 blob URL 只在
      // 本次挂载生命周期内有效——单调代次防止连续快速重渲（比如连点 AI 分区开关）时晚到的预览
      // 覆盖新一轮渲染；dispose 时连同最后一个 blob URL 一起释放，不留内存泄漏。
      let avatarHydrateGen = 0;
      let lastAvatarObjectUrl: string | undefined;
      ctx.setSubtitle(zh ? "偏好与状态" : "Preferences & status");

      const revokeAvatarObjectUrl = () => {
        if (lastAvatarObjectUrl) {
          URL.revokeObjectURL(lastAvatarObjectUrl);
          lastAvatarObjectUrl = undefined;
        }
      };

      // 头像预览：<img> 不能像 web 端那样直接给 src——桌面鉴权是 client-token 走响应体，不是
      // cookie，<img src> 直连拿不到鉴权头。走 fetchDriveResource（同网盘那套授权 fetch + 401
      // 自愈重试）拿字节转 blob URL；404（没设头像）或任何失败都安静回退首字母 tile，不报错闪烁。
      function hydrateAvatarPreview(): void {
        if (!profile) {
          return;
        }
        const img = ctx.body.querySelector<HTMLImageElement>("[data-spot-avatar-img]");
        const removeBtn = ctx.body.querySelector<HTMLElement>("[data-spot-avatar-remove-btn]");
        if (!img) {
          return;
        }
        const gen = ++avatarHydrateGen;
        const href = `${driveResourceApiBase()}${avatarHref(profile.user_id)}`;
        void fetchDriveResource(href)
          .then((response) => {
            if (disposed || gen !== avatarHydrateGen || !response.ok) {
              return undefined;
            }
            return response.blob();
          })
          .then((blob) => {
            if (!blob || disposed || gen !== avatarHydrateGen) {
              return;
            }
            revokeAvatarObjectUrl();
            const url = URL.createObjectURL(blob);
            lastAvatarObjectUrl = url;
            img.src = url;
            img.hidden = false;
            if (removeBtn) {
              removeBtn.hidden = false;
            }
          })
          .catch(() => {
            // best-effort：留在回退首字母 tile 上，不报错、不重试轮询。
          });
      }

      const renderAll = () => {
        if (!vm) {
          return;
        }
        ctx.body.innerHTML = settingsHtml(vm, zh, aiProfile, aiFailed, aiErrorText, profile, profileFailed, profileErrorText);
        ctx.requestResize();
        hydrateAvatarPreview();
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
        // R14 批 AVATAR：移除头像——DELETE 成功后隐藏预览图+按钮本身（回退首字母 tile 自然露出）。
        const removeAvatarBtn = target.closest<HTMLElement>("[data-spot-avatar-remove-btn]");
        if (removeAvatarBtn) {
          const status = ctx.body.querySelector<HTMLElement>("[data-spot-avatar-status]");
          const setAvatarStatus = (text: string) => {
            if (!status) return;
            status.hidden = false;
            status.textContent = text;
          };
          setAvatarStatus(zh ? "正在移除…" : "Removing…");
          void ctx.client
            .request(AVATAR_PATH, { method: "DELETE" })
            .then(() => {
              if (disposed) return;
              revokeAvatarObjectUrl();
              const img = ctx.body.querySelector<HTMLImageElement>("[data-spot-avatar-img]");
              if (img) {
                img.hidden = true;
              }
              removeAvatarBtn.hidden = true;
              setAvatarStatus(zh ? "已移除头像" : "Avatar removed");
            })
            .catch(() => {
              if (disposed) return;
              setAvatarStatus(zh ? "移除失败，请重试" : "Failed to remove — please try again");
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

      // R14 批 AVATAR：文件选择器 change——开裁剪层（选图→拖动/缩放→确认才真正上传，见
      // openSpotlightAvatarCropModal 顶部注释），取消什么都不发生。change 委托监听（不是绑到单个
      // input 上，同这个文件其余交互一样走 ctx.body 一处委托）。
      ctx.body.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const fileInput = target.closest<HTMLInputElement>("[data-spot-avatar-file-input]");
        if (!fileInput) {
          return;
        }
        const file = fileInput.files?.[0];
        fileInput.value = "";
        if (!file || !profile) {
          return;
        }
        const status = ctx.body.querySelector<HTMLElement>("[data-spot-avatar-status]");
        const setAvatarStatus = (text: string) => {
          if (!status) return;
          status.hidden = false;
          status.textContent = text;
        };
        void openSpotlightAvatarCropModal(file, zh, async (blob) => {
          setAvatarStatus(zh ? "正在上传…" : "Uploading…");
          try {
            await ctx.client.request(AVATAR_PATH, {
              method: "PUT",
              headers: { "Content-Type": blob.type || "application/octet-stream" },
              body: blob
            });
            if (disposed) return;
            setAvatarStatus(zh ? "头像已更新" : "Avatar updated");
            hydrateAvatarPreview();
          } catch {
            if (disposed) return;
            setAvatarStatus(zh ? "上传失败，请重试" : "Upload failed — please try again");
          }
        });
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
        revokeAvatarObjectUrl();
      };
    }
  };
}
