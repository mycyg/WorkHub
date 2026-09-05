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
  AddMcpServerRequest,
  AiGranularSettings,
  AiMode,
  ClientDeviceResponse,
  CuuProactivity,
  DispatchPolicy,
  McpServerActionResult,
  McpServerConnectionVM,
  McpServerTrustLevel,
  McpServerVM,
  PatchUserAiProfileRequest,
  PatchUserProfileRequest,
  PermissionEffect,
  PermissionPolicyWrite,
  PermissionScopeKind,
  PluginCompatReport,
  PluginVM,
  SettingsPageVM,
  UserAiProfileVM,
  UserProfileVM
} from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";
import type { HealthResponse } from "@workhub/api-client";
import { createApiClient } from "@workhub/api-client/client";

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

import { resolveDesktopShellEmitter } from "../../desktop-cuu-runtime.js";
import { clearDesktopClientToken } from "../../desktop-client-token.js";
import { resolveDesktopTauriInvoke } from "../../desktop-window-controls.js";
import {
  bindDesktopConnectScreen,
  createDesktopServerChoiceEffects
} from "../../desktop-connect-screen.js";
import { scheduleWorkHubLiquidGlassFilterRebuild } from "../../liquid-glass-filter.js";
import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";
import { driveResourceApiBase, fetchDriveResource } from "./drive.js";
import {
  emptyMcpFormState,
  mcpAddErrorText,
  mcpServersSectionHtml,
  parseMcpArgs,
  parseMcpEnv,
  parseMcpTimeoutMs,
  type DesktopMcpAddOutcome,
  type DesktopMcpFormState
} from "./settings-mcp.js";

import { spotlightViewsT } from "./locales.js";

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

// M-06（R24 S3 走查）：「AI assistant · Not set up」此前是个死状态——没有任何说明或入口，终端用户
// 读到只会觉得东西坏了。桌面端没有配置能力（LLM_API_KEY 是服务端 .env，desktop client 连不到那台
// 机器的文件系统），所以这里给不了「去配置」按钮，只能诚实说清楚谁能修、去哪看——与工作台聊天区
// 已有的同款横幅（workbench/chat/render.ts）同一个信息来源，措辞对齐。
const DEPLOY_DOC_URL = "https://github.com/mycyg/WorkHub/blob/main/DEPLOY.md";

function aiNotConfiguredNoteHtml(zh: boolean): string {
  const explanation = spotlightViewsT(zh, "theAiAssistantIsnTSet");
  return `<div class="wh-spot-row-sub wh-spot-row-sub--wrap" data-spot-ai-not-configured="true">${escapeHtml(explanation)} <button type="button" class="wh-spot-inline-link" data-set-ai-deploy-docs="true">${spotlightViewsT(zh, "viewDeploymentInstructions")}</button></div>`;
}

function localeLabel(locale: string, zh: boolean): string {
  if (locale === "zh-CN") return spotlightViewsT(zh, "chinese");
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
    auto: { titleZh: "自动接单", titleEn: "Auto-accept", descZh: "派过来就立刻开工，Cuu 只告知一声", descEn: "Starts as soon as it's assigned — Cuu just tells you" },
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
    dispatch_run: { zh: "派活给 AI", en: "Start AI runs" },
    mutate_drive: { zh: "改网盘文件", en: "Modify drive files" },
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
      <div class="wh-spot-row-sub">${spotlightViewsT(zh, "couldnTLoadAiSettings")}<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-spot-ai-retry style="margin-left:8px">${spotlightViewsT(zh, "retry")}</button></div>
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
    const stateText = allowed ? (spotlightViewsT(zh, "allowed")) : spotlightViewsT(zh, "blocked");
    return `<button type="button" class="wh-spot-reason" data-toggle-ai-granular="${key}" data-sel="${!allowed}">${escapeHtml(label)} · ${stateText}</button>`;
  }).join("");

  return `<div class="wh-spot-set-group" data-spot-ai-section="true">
    <div class="wh-spot-set-label">${spotlightViewsT(zh, "aiDefaultMode11")}</div>
    <div class="wh-spot-reasons-row">${modeChips}</div>
    <div class="wh-spot-row-sub">${escapeHtml(modeDesc)}</div>
  </div>
  <div class="wh-spot-set-group" data-spot-ai-dispatch-section="true">
    <div class="wh-spot-set-label">${spotlightViewsT(zh, "dispatchPolicy")}</div>
    <div class="wh-spot-reasons-row">${dispatchChips}</div>
    <div class="wh-spot-row-sub">${escapeHtml(dispatchDesc)}</div>
  </div>
  <div class="wh-spot-set-group" data-spot-ai-granular-section="true">
    <div class="wh-spot-set-label">${spotlightViewsT(zh, "whatAiCanDo")}</div>
    <div class="wh-spot-reasons-row">${granularChips}</div>
  </div>
  <div class="wh-spot-set-group" data-spot-ai-proactivity-section="true">
    <div class="wh-spot-set-label">${spotlightViewsT(zh, "cuuProactivity")}</div>
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
    <div class="wh-spot-set-label">${spotlightViewsT(zh, "avatar")}</div>
    <div class="wh-spot-avatar-row" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span class="wh-spot-avatar-preview" data-spot-avatar-preview="true" style="position:relative;display:inline-flex;width:44px;height:44px;flex:0 0 auto;border-radius:50%;overflow:hidden;background:var(--ds-ink-faint)">
        <span class="wh-spot-avatar-fallback" data-spot-avatar-fallback="true" aria-hidden="true" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800">${escapeHtml(fallbackLetter)}</span>
        <img class="wh-spot-avatar-img" data-spot-avatar-img="true" alt="${escapeHtml(spotlightViewsT(zh, "currentAvatar"))}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" hidden />
      </span>
      <label class="wh-spot-act wh-spot-act--quiet ds-pressable wh-spot-upload-label" data-spot-avatar-upload-label="true">
        <span>${spotlightViewsT(zh, "changeAvatar")}</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" class="wh-spot-file-input" data-spot-avatar-file-input="true" />
      </label>
      <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-spot-avatar-remove-btn="true" hidden>${spotlightViewsT(zh, "removeAvatar")}</button>
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
      <div class="wh-spot-set-label">${spotlightViewsT(zh, "myProfile")}</div>
      <div class="wh-spot-row-sub">${spotlightViewsT(zh, "couldnTLoadYourProfile")}<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-spot-profile-retry style="margin-left:8px">${spotlightViewsT(zh, "retry")}</button></div>
    </div>`;
  }
  if (!profile) {
    return "";
  }
  const skillsValue = profile.skill_tags.join(", ");
  return `<div class="wh-spot-set-group" data-spot-profile-section="true">
    <div class="wh-spot-set-label">${spotlightViewsT(zh, "myProfile")}</div>
    <div class="wh-spot-row-sub">${spotlightViewsT(zh, "cuuWillUseThisWhenSuggesting")}</div>
    <input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-set-profile-title value="${escapeHtml(profile.title ?? "")}" maxlength="128" placeholder="${escapeHtml(spotlightViewsT(zh, "titleEGFrontendLead"))}" />
    <textarea class="wh-spot-freetext" data-set-profile-bio rows="3" maxlength="4000" placeholder="${escapeHtml(spotlightViewsT(zh, "aShortBio"))}">${escapeHtml(profile.bio_md ?? "")}</textarea>
    <input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-set-profile-skills value="${escapeHtml(skillsValue)}" placeholder="${escapeHtml(spotlightViewsT(zh, "skillTagsCommaSeparated"))}" />
  </div>`;
}

// —— R20 DSK-UX（R19-5 撤销学到的自动通过策略）—— //
// 病灶：web 设置页把每条自动通过策略的「撤销」按钮标了 data-requires-desktop=true、指向桌面端，但桌面端
// 从来没有渲染 permission_policies 或调 DELETE /api/permissions/:id 的代码——用户能攒下常驻自动通过规则，却
// 在任何客户端都撤不掉，是治理死胡同。这里在桌面唯一的账户级设置面里补上：列出策略 + 两段式确认撤销
// （DELETE /api/permissions/:id，本地客户端 + 管理员门；桌面天然满足本地客户端，策略列表本身也只有管理员
// 能从 settings VM 拿到，见 apps/api/src/routes/pages.ts 的 /settings）。

type PermissionPolicyVM = NonNullable<SettingsPageVM["permission_policies"]>[number];

function permissionPolicyEffectLabel(effect: PermissionPolicyVM["effect"], zh: boolean): string {
  const table: Record<PermissionPolicyVM["effect"], { zh: string; en: string }> = {
    allow: { zh: "自动通过", en: "Auto-approve" },
    deny: { zh: "自动拒绝", en: "Auto-deny" },
    ask: { zh: "每次询问", en: "Always ask" }
  };
  return zh ? table[effect].zh : table[effect].en;
}

// —— R23 F-02（权限策略新增/调整）—— //
// PUT /api/permissions 早就在（本地客户端 + 管理员门），SDK 也补了 createPermissionPolicy，但桌面
// 设置页此前只能撤销、不能新增/调整——管理员想收紧或放宽一条规则，只能等 AI 在审批里被问到、勾选
// 「以后同类自动通过」才能"学"出一条，没有任何直接写入口。这里补一张最小可用的表单：范围×动作模式×
// 效果×优先级，字段与语义见 packages/permissions/src/evaluate.ts（globMatch 通配、scope 优先级
// org<workspace<role<session、deny 达到 OVERRIDE_DENY_PRIORITY=1000 是跨 scope 熔断）。
// scope_kind=org/workspace 时 scope_id 必须等于 actor 自己的 org_id/workspace_id（服务端
// assertPolicyScopeWithinActorTenant 强制），但这个 VM 里目前只有 workspace_id 能拿到（见下方
// aiProfile.workspace_id 预填）——org_id 没有现成来源，不为此新开端点/加字段（超出本工单范围），
// 留给用户自己填、错了服务端会给可读的 403。

const PERMISSION_SCOPE_KINDS: readonly PermissionScopeKind[] = ["org", "workspace", "role", "session"];
const PERMISSION_EFFECTS: readonly PermissionEffect[] = ["allow", "deny", "ask"];

function permissionScopeKindLabel(kind: PermissionScopeKind, zh: boolean): { title: string; desc: string } {
  const table: Record<PermissionScopeKind, { titleZh: string; titleEn: string; descZh: string; descEn: string }> = {
    org: { titleZh: "整个组织", titleEn: "Whole org", descZh: "标识要填你所在组织的", descEn: "Enter your own org's identifier" },
    workspace: { titleZh: "这个工作区", titleEn: "This workspace", descZh: "标识要填当前工作区的", descEn: "Enter the current workspace's identifier" },
    role: { titleZh: "某个角色", titleEn: "A role", descZh: "填角色的标识", descEn: "Enter a role identifier" },
    session: { titleZh: "单次会话", titleEn: "A single session", descZh: "填会话的标识，只在那次会话里生效", descEn: "Enter a session identifier — it applies only within that session" }
  };
  const entry = table[kind];
  return { title: zh ? entry.titleZh : entry.titleEn, desc: zh ? entry.descZh : entry.descEn };
}

export type PermissionPolicyFormState = {
  scopeKind: PermissionScopeKind;
  scopeId: string;
  actionPattern: string;
  effect: PermissionEffect;
  priority: string;
  busy: boolean;
  errorText: string | undefined;
  // ctx.client.createPermissionPolicy 是可选方法（同 revokePermissionPolicy 的既有取舍）——旧版
  // 客户端可能没有它，false 时表单仍渲染但提交即安静报错，不假装能用。
  supported: boolean;
};

export function permissionPolicyFormHtml(state: PermissionPolicyFormState, zh: boolean): string {
  const scopeChips = PERMISSION_SCOPE_KINDS.map((kind) => {
    const copy = permissionScopeKindLabel(kind, zh);
    return `<button type="button" class="wh-spot-reason" data-set-policy-scope-kind="${kind}" data-sel="${state.scopeKind === kind}" title="${escapeHtml(copy.desc)}">${escapeHtml(copy.title)}</button>`;
  }).join("");
  const scopeDesc = permissionScopeKindLabel(state.scopeKind, zh).desc;
  const effectChips = PERMISSION_EFFECTS.map((effect) => {
    const label = permissionPolicyEffectLabel(effect, zh);
    return `<button type="button" class="wh-spot-reason" data-set-policy-effect="${effect}" data-sel="${state.effect === effect}">${escapeHtml(label)}</button>`;
  }).join("");
  const submitLabel = state.busy ? (spotlightViewsT(zh, "submitting")) : (spotlightViewsT(zh, "createUpdatePolicy"));
  const error = state.errorText
    ? `<div class="wh-spot-row-sub" data-spot-policy-form-error="true" style="color:var(--ds-danger)">${escapeHtml(state.errorText)}</div>`
    : "";
  return `<div class="wh-spot-set-group" data-spot-policy-form-section="true">
    <div class="wh-spot-set-label">${spotlightViewsT(zh, "addAdjustAPolicy")}</div>
    <div class="wh-spot-row-sub">${spotlightViewsT(zh, "scope")}</div>
    <div class="wh-spot-reasons-row">${scopeChips}</div>
    <div class="wh-spot-row-sub">${escapeHtml(scopeDesc)}</div>
    <input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-set-policy-scope-id value="${escapeHtml(state.scopeId)}" maxlength="64" placeholder="${escapeHtml(spotlightViewsT(zh, "scopeId"))}" ${state.busy ? "disabled" : ""} />
    <input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-set-policy-action-pattern value="${escapeHtml(state.actionPattern)}" maxlength="128" placeholder="${escapeHtml(spotlightViewsT(zh, "actionPatternEGDriveWrite"))}" ${state.busy ? "disabled" : ""} />
    <div class="wh-spot-row-sub">${spotlightViewsT(zh, "effect")}</div>
    <div class="wh-spot-reasons-row">${effectChips}</div>
    ${state.effect === "deny" ? `<div class="wh-spot-row-sub">${spotlightViewsT(zh, "aDenyAtPriority1000Is")}</div>` : ""}
    <input type="number" class="wh-spot-freetext wh-spot-freetext--line" data-set-policy-priority value="${escapeHtml(state.priority)}" placeholder="${escapeHtml(spotlightViewsT(zh, "priorityDefault0"))}" ${state.busy ? "disabled" : ""} />
    <button type="button" class="wh-spot-act ds-pressable wh-spot-act--primary" data-set-policy-submit="true" ${state.busy ? "disabled" : ""}>${submitLabel}</button>
    ${error}
  </div>`;
}

// 撤销两段式确认的纯判定（照 side-panel.ts decideRollbackConfirmation / drive view.ts
// decideDriveDeleteConfirmation 的同款先例）：同一条已武装的再点=真撤销；未武装或点了另一条=（重新）武装它。
export function decidePolicyRevokeConfirmation(
  armedId: string | undefined,
  clickedId: string
): { kind: "arm" | "execute"; id: string } {
  if (armedId === clickedId) {
    return { kind: "execute", id: clickedId };
  }
  return { kind: "arm", id: clickedId };
}

export function permissionPoliciesSectionHtml(input: {
  policies: readonly PermissionPolicyVM[] | undefined;
  armedId: string | undefined;
  busyId: string | undefined;
  errorText: string | undefined;
  zh: boolean;
  // 新增/调整策略表单——同一个治理区块的姊妹功能，与列表共用同一个 admin-only 门（见下方
  // `!input.policies` 早退）。省略时（既有调用点/既有测试）不渲表单，行为与改动前逐字节一致。
  form?: PermissionPolicyFormState;
}): string {
  // 非管理员：settings VM 结构性不含 permission_policies（服务端只给管理员填）——整个治理区不渲染。
  if (!input.policies) {
    return "";
  }
  const { policies, armedId, busyId, zh } = input;
  const body = policies.length === 0
    ? `<div class="wh-spot-row-sub">${zh ? "还没有学到的自动通过策略。" : "No learned auto-approve policies yet."}</div>`
    : policies
        .map((policy) => {
          const armed = armedId === policy.id;
          const busy = busyId === policy.id;
          const effect = permissionPolicyEffectLabel(policy.effect, zh);
          const learned = policy.learned_from_session ? (zh ? " · 从会话里学到的" : " · learned from a session") : "";
          const label = busy
            ? (zh ? "撤销中…" : "Revoking…")
            : armed
              ? (zh ? "确定？再点一次撤销" : "Sure? Click again")
              : (zh ? "撤销" : "Revoke");
          const revokeBtn = `<button type="button" class="wh-spot-act ds-pressable ${armed ? "wh-spot-act--danger" : "wh-spot-act--quiet"}" data-set-revoke-policy="${escapeHtml(policy.id)}" ${busy ? "disabled" : ""}>${label}</button>`;
          return `<div class="wh-spot-row" style="cursor:default">
            <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(policy.action_pattern)}</div><div class="wh-spot-row-sub">${escapeHtml(effect)}${learned}</div></div>
            ${revokeBtn}
          </div>`;
        })
        .join("");
  const error = input.errorText
    ? `<div class="wh-spot-row-sub" data-spot-policy-error="true" style="color:var(--ds-danger)">${escapeHtml(input.errorText)}</div>`
    : "";
  const form = input.form ? permissionPolicyFormHtml(input.form, zh) : "";
  return `<div class="wh-spot-set-group" data-spot-policies-section="true">
    <div class="wh-spot-set-label">${zh ? "自动通过策略" : "Auto-approve policies"}</div>
    <div class="wh-spot-row-sub">${zh
      ? "这些是「以后同类自动通过」的常驻规则。撤销后，同类操作会重新回到你这里等你拍板。"
      : "Standing 'auto-approve similar' rules. Revoke one and those actions come back to you for review."
    }</div>
    ${body}
    ${error}
  </div>
  ${form}`;
}

// —— R23 F-03（设备管理收尾 · 桌面镜像）—— //
// web /settings 的「已登录设备」区块早就接了 list/current/revoke-other（apps/web/src/settings-devices.ts），
// 但桌面——"本机"这个概念唯一真正成立的地方——反而从没渲过这份列表。这里镜像 web 的行 VM 形状
// （id/deviceName/platform/lastSeenLabel/isCurrent/isRevoked/statusLabel/canRevoke），独立实现而不是
// 跨 app 导入（apps/desktop-webview 不依赖 apps/web，见各自 package.json）。

type DesktopDeviceRowVM = {
  id: string;
  deviceName: string;
  platform: string;
  lastSeenLabel: string;
  isCurrent: boolean;
  isRevoked: boolean;
  statusLabel: string;
  canRevoke: boolean;
};

function formatDesktopDeviceLastSeen(lastSeenAt: string | undefined, zh: boolean): string {
  if (!lastSeenAt) {
    return spotlightViewsT(zh, "neverConnected");
  }
  const parsed = new Date(lastSeenAt);
  if (Number.isNaN(parsed.getTime())) {
    return spotlightViewsT(zh, "neverConnected");
  }
  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(parsed);
}

function buildDesktopDeviceRow(device: ClientDeviceResponse, currentDeviceId: string | null, zh: boolean): DesktopDeviceRowVM {
  const revoked = Boolean(device.revoked_at);
  // 已撤销的设备哪怕 id 命中当前探测也不再算「本机」——同 web 端 isCurrentDevice 的既有语义。
  const current = currentDeviceId !== null && !revoked && device.id === currentDeviceId;
  const statusLabel = revoked ? (spotlightViewsT(zh, "revoked")) : current ? (spotlightViewsT(zh, "thisDevice")) : (spotlightViewsT(zh, "active"));
  return {
    id: device.id,
    deviceName: device.device_name,
    platform: device.platform,
    lastSeenLabel: formatDesktopDeviceLastSeen(device.last_seen_at, zh),
    isCurrent: current,
    isRevoked: revoked,
    statusLabel,
    canRevoke: !revoked && !current
  };
}

export type DesktopDevicesSectionState = {
  devices: readonly ClientDeviceResponse[] | undefined;
  failed: boolean;
  currentDeviceId: string | null;
  armedId: string | undefined;
  busyId: string | undefined;
  errorText: string | undefined;
  revokeCurrentArmed: boolean;
  revokeCurrentBusy: boolean;
};

export function devicesSectionHtml(state: DesktopDevicesSectionState, zh: boolean): string {
  if (state.failed) {
    return `<div class="wh-spot-set-group" data-spot-devices-section="true">
      <div class="wh-spot-set-label">${spotlightViewsT(zh, "signedInDevices")}</div>
      <div class="wh-spot-row-sub">${spotlightViewsT(zh, "couldnTLoadDevices")}</div>
      <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-set-devices-retry="true">${spotlightViewsT(zh, "retry")}</button>
    </div>`;
  }
  if (!state.devices) {
    // 挂载首屏 load() 用 Promise.all 等设备列表落定才第一次 renderAll()——这个分支在生产路径下不可达，
    // 纯防御性兜底（同这份文件其它 section 的一贯写法）。
    return "";
  }
  const rows = state.devices.length === 0
    ? `<div class="wh-spot-row-sub">${spotlightViewsT(zh, "noSignedInDevicesYet")}</div>`
    : state.devices
        .map((device) => {
          const row = buildDesktopDeviceRow(device, state.currentDeviceId, zh);
          let actionHtml = "";
          if (row.isCurrent) {
            const label = state.revokeCurrentBusy
              ? (spotlightViewsT(zh, "signingOut"))
              : state.revokeCurrentArmed
                ? (spotlightViewsT(zh, "sureClickAgain3"))
                : (spotlightViewsT(zh, "revokeSignOut"));
            actionHtml = `<button type="button" class="wh-spot-act ds-pressable ${state.revokeCurrentArmed ? "wh-spot-act--danger" : "wh-spot-act--quiet"}" data-set-revoke-current-device="true" ${state.revokeCurrentBusy ? "disabled" : ""}>${label}</button>`;
          } else if (row.canRevoke) {
            const armed = state.armedId === row.id;
            const busy = state.busyId === row.id;
            const label = busy
              ? (spotlightViewsT(zh, "revoking"))
              : armed
                ? (spotlightViewsT(zh, "sureClickAgain3"))
                : (spotlightViewsT(zh, "revoke"));
            actionHtml = `<button type="button" class="wh-spot-act ds-pressable ${armed ? "wh-spot-act--danger" : "wh-spot-act--quiet"}" data-set-revoke-device="${escapeHtml(row.id)}" ${busy ? "disabled" : ""}>${label}</button>`;
          }
          return `<div class="wh-spot-row" style="cursor:default">
            <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(row.deviceName)}</div><div class="wh-spot-row-sub">${escapeHtml(row.platform)} · ${escapeHtml(row.lastSeenLabel)} · ${escapeHtml(row.statusLabel)}</div></div>
            ${actionHtml}
          </div>`;
        })
        .join("");
  const error = state.errorText
    ? `<div class="wh-spot-row-sub" data-spot-devices-error="true" style="color:var(--ds-danger)">${escapeHtml(state.errorText)}</div>`
    : "";
  // L-04（R24 S3 走查）：这段说明是完整的两句话，但 .wh-spot-row-sub 默认单行截断（给"行副标题"
  // 用）——之前借用它渲这段长说明，实测被裁成一行省略号。加 --wrap 修饰类让它正常换行。
  return `<div class="wh-spot-set-group" data-spot-devices-section="true">
    <div class="wh-spot-set-label">${spotlightViewsT(zh, "signedInDevices")}</div>
    <div class="wh-spot-row-sub wh-spot-row-sub--wrap">${spotlightViewsT(zh, "clientDevicesPairedToThisAccount")
    }</div>
    ${rows}
    ${error}
  </div>`;
}

// —— R24-P 阶段 1：插件（桌面端是这块的主场） —— //
// 为什么安装入口只在桌面端：安装要给一台机器上的**目录绝对路径**——那是「跑着 API 的这台机器」，
// 在网页里让人凭空写一个服务器路径既说不清也验不了。网页设置页只渲只读清单（见
// packages/ui/src/gold-path/route-components.ts 的 renderSettingsPluginsSection）。
//
// 管理员门与「自动通过策略」同款：服务端只给管理员填 settings VM 的 plugins 字段，
// 这里据 `vm.plugins !== undefined` 决定整区渲不渲——不自己猜身份、也不靠一个 403 的错误闪一下。

/** 体检结论里每条非 pass 的检查，翻成一句人话。pass 的不说——没问题的事不值得占一行。 */
export function pluginCompatLines(report: PluginCompatReport | undefined, zh: boolean): string[] {
  if (!report) {
    return [];
  }
  const lines: string[] = [];
  for (const check of report.checks) {
    if (check.level === "pass") {
      continue;
    }
    if (check.id === "manifest") {
      lines.push(spotlightViewsT(zh, "noReadablePackageJsonInThat"));
    } else if (check.id === "client_surface") {
      lines.push(
        spotlightViewsT(zh, "thisIsAUiThemePlugin")
      );
    } else if (check.id === "install_scripts") {
      lines.push(
        spotlightViewsT(zh, "itShipsInstallTimeScriptsWhich")
      );
    } else if (check.id === "dsh_tools_peer") {
      const versions = report.peer_dsh_tools_range && report.host_dsh_tools_version
        ? zh
          ? `（它需要 ${report.peer_dsh_tools_range}，当前自带的是 ${report.host_dsh_tools_version}）`
          : ` (needs ${report.peer_dsh_tools_range}; this build ships ${report.host_dsh_tools_version})`
        : "";
      lines.push(
        zh
          ? `它对着另一个版本的插件工具库发布${versions}，可能装不上。`
          : `It targets a different plugin toolkit version${versions}, so it may fail to load.`
      );
    } else if (check.id === "bundle_manifest") {
      lines.push(
        spotlightViewsT(zh, "itDeclaresNoDshBundleManifest")
      );
    }
  }
  return lines;
}

/** 安装被拒时的人话。服务端消息本身已经是中文，这里按错误码出双语，不把服务端文案当界面文案用。 */
export function pluginInstallErrorText(code: string | undefined, zh: boolean): string {
  switch (code) {
    case "plugin_manifest_unreadable":
      return spotlightViewsT(zh, "noReadablePackageJsonTherePoint");
    case "plugin_client_surface_unsupported":
      return spotlightViewsT(zh, "thisIsAUiThemePlugin2");
    case "plugin_install_scripts_refused":
      return spotlightViewsT(zh, "itShipsInstallTimeScriptsThat");
    case "plugin_already_installed":
      return spotlightViewsT(zh, "thatDirectoryIsAlreadyInstalled");
    case "plugin_admin_required":
      return spotlightViewsT(zh, "onlyAnAdminCanManagePlugins");
    case "validation_error":
      return spotlightViewsT(zh, "thePathMustBeAnAbsolute");
    default:
      return spotlightViewsT(zh, "installFailedTryAgain");
  }
}

function pluginStatusLine(plugin: PluginVM, zh: boolean): string {
  if (!plugin.enabled || plugin.status === "disabled") {
    return spotlightViewsT(zh, "disabled");
  }
  if (plugin.status === "load_failed") {
    const reason = plugin.load_report?.error;
    return zh
      ? `装不上${reason ? `：${reason}` : ""}`
      : `Won't load${reason ? `: ${reason}` : ""}`;
  }
  if (plugin.status === "crashed") {
    return spotlightViewsT(zh, "pluginStoppedAfterRepeatedFailures");
  }
  return zh
    ? `已启用 · ${plugin.tool_count} 个工具`
    : `Enabled · ${plugin.tool_count} tool${plugin.tool_count === 1 ? "" : "s"}`;
}

/**
 * 信任级别这一行：它是这个插件的**风险上限**，所以说的是上限，不是「它安全」。
 *
 * R26 M7 补：**词表分类先于风险分级**。插件工具 id 是 `plugin__<插件名>__<工具名>`，
 * `classifyHumanReservedToolCall` 对整个 id 分词，所以一个叫 `finance` / `publish` 的插件，
 * 它的每个工具都会被归到高风险类、每次调用都转人——与这里设的信任级别无关。这是设计属性，
 * 但不写出来，用户只会以为只读断言按错了。分区里的 `pluginNameRiskNote` 就是这句话，
 * 与 MCP 分区的 `mcpNameRiskNote` 是同一条纪律的两面。
 */
export function pluginTrustLine(plugin: PluginVM, zh: boolean): string {
  return spotlightViewsT(zh, plugin.trust_level === "read_only" ? "pluginTrustReadOnly" : "pluginTrustExternalEffect");
}

export type DesktopPluginInstallOutcome =
  | { kind: "installed"; plugin: PluginVM }
  | { kind: "refused"; code: string | undefined };

export type DesktopPluginsSectionState = {
  /** 管理员门：settings VM 的 plugins 字段存在才渲整区（服务端只给管理员填）。 */
  visible: boolean;
  plugins: readonly PluginVM[] | undefined;
  failed: boolean;
  hostDshToolsVersion: string | undefined;
  /** 还有几条插件路径来自环境变量（不在清单里，但确实会被加载）——不说清楚会显得清单在撒谎。 */
  bootstrapPathCount: number;
  /** 两段式确认的武装态。键是 `toggle:<id>` / `remove:<id>`，两个动作互不串。 */
  armedKey: string | undefined;
  busyId: string | undefined;
  errorText: string | undefined;
  installPath: string;
  installBusy: boolean;
  installOutcome: DesktopPluginInstallOutcome | undefined;
  /** 旧服务端没有这批端点时（api-client 上是可选方法）安静降级，不给一个点了没反应的按钮。 */
  supported: boolean;
};

export function pluginsSectionHtml(state: DesktopPluginsSectionState, zh: boolean): string {
  if (!state.visible) {
    return "";
  }
  const rows = state.failed
    ? `<div class="wh-spot-row" style="cursor:default"><div class="wh-spot-row-main"><div class="wh-spot-row-sub">${spotlightViewsT(zh, "couldnTLoadThePluginList")}</div></div><button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-set-plugins-retry="true">${spotlightViewsT(zh, "retry")}</button></div>`
    : !state.plugins || state.plugins.length === 0
      ? `<div class="wh-spot-row-sub">${spotlightViewsT(zh, "noPluginsInstalledYet")}</div>`
      : state.plugins
          .map((plugin) => {
            const busy = state.busyId === plugin.id;
            const enabled = plugin.enabled && plugin.status !== "disabled";
            const toggleArmed = state.armedKey === `toggle:${plugin.id}`;
            const removeArmed = state.armedKey === `remove:${plugin.id}`;
            const toggleLabel = busy
              ? (spotlightViewsT(zh, "working"))
              : toggleArmed
                ? (spotlightViewsT(zh, "sureClickAgain3"))
                : enabled
                  ? (spotlightViewsT(zh, "disable"))
                  : (spotlightViewsT(zh, "enable"));
            const removeLabel = busy
              ? (spotlightViewsT(zh, "working"))
              : removeArmed
                ? (spotlightViewsT(zh, "sureClickAgain4"))
                : (spotlightViewsT(zh, "remove"));
            const compat = pluginCompatLines(plugin.compat_report, zh);
            const title = plugin.version ? `${plugin.name} ${plugin.version}` : plugin.name;
            const trustArmed = state.armedKey === `trust:${plugin.id}`;
            const trustLabel = busy
              ? (spotlightViewsT(zh, "working"))
              : trustArmed
                ? (spotlightViewsT(zh, "sureClickAgain5"))
                : plugin.trust_level === "read_only"
                  ? (spotlightViewsT(zh, "takeBackReadOnlyTrust"))
                  : (spotlightViewsT(zh, "trustAsReadOnly"));
            return `<div class="wh-spot-row" style="cursor:default" data-spot-plugin="${escapeHtml(plugin.id)}" data-spot-plugin-trust="${escapeHtml(plugin.trust_level)}">
              <div class="wh-spot-row-main">
                <div class="wh-spot-row-title">${escapeHtml(title)}</div>
                <div class="wh-spot-row-sub">${escapeHtml(pluginStatusLine(plugin, zh))}</div>
                <div class="wh-spot-row-sub">${escapeHtml(pluginTrustLine(plugin, zh))}</div>
                <div class="wh-spot-row-sub">${escapeHtml(plugin.source_path)}</div>
                ${compat.map((line) => `<div class="wh-spot-row-sub">${escapeHtml(line)}</div>`).join("")}
              </div>
              <button type="button" class="wh-spot-act ds-pressable ${trustArmed ? "wh-spot-act--danger" : "wh-spot-act--quiet"}" data-set-plugin-trust="${escapeHtml(plugin.id)}" ${busy ? "disabled" : ""}>${trustLabel}</button>
              <button type="button" class="wh-spot-act ds-pressable ${toggleArmed ? "wh-spot-act--danger" : "wh-spot-act--quiet"}" data-set-plugin-toggle="${escapeHtml(plugin.id)}" ${busy ? "disabled" : ""}>${toggleLabel}</button>
              <button type="button" class="wh-spot-act ds-pressable ${removeArmed ? "wh-spot-act--danger" : "wh-spot-act--quiet"}" data-set-plugin-remove="${escapeHtml(plugin.id)}" ${busy ? "disabled" : ""}>${removeLabel}</button>
            </div>`;
          })
          .join("");

  const outcome = (() => {
    if (!state.installOutcome) {
      return "";
    }
    if (state.installOutcome.kind === "refused") {
      return `<div class="wh-spot-row" style="cursor:default" data-spot-plugin-outcome="refused">
        <div class="wh-spot-row-main">
          <div class="wh-spot-row-title">${spotlightViewsT(zh, "notInstalled")}</div>
          <div class="wh-spot-row-sub">${escapeHtml(pluginInstallErrorText(state.installOutcome.code, zh))}</div>
        </div>
      </div>`;
    }
    const plugin = state.installOutcome.plugin;
    const notes = pluginCompatLines(plugin.compat_report, zh);
    const loaded = plugin.status === "installed";
    return `<div class="wh-spot-row" style="cursor:default" data-spot-plugin-outcome="${loaded ? "installed" : "load_failed"}">
      <div class="wh-spot-row-main">
        <div class="wh-spot-row-title">${escapeHtml(plugin.version ? `${plugin.name} ${plugin.version}` : plugin.name)}</div>
        <div class="wh-spot-row-sub">${escapeHtml(
          loaded
            ? zh
              ? `装好了，上线 ${plugin.tool_count} 个工具。`
              : `Installed — ${plugin.tool_count} tool${plugin.tool_count === 1 ? "" : "s"} are live.`
            : zh
              ? `登记好了，但没能加载${plugin.load_report?.error ? `：${plugin.load_report.error}` : ""}`
              : `Registered, but it did not load${plugin.load_report?.error ? `: ${plugin.load_report.error}` : ""}`
        )}</div>
        ${notes.map((line) => `<div class="wh-spot-row-sub">${escapeHtml(line)}</div>`).join("")}
      </div>
    </div>`;
  })();

  const hostNote = state.hostDshToolsVersion
    ? zh
      ? `插件工具库版本 ${state.hostDshToolsVersion}。`
      : `Plugin toolkit ${state.hostDshToolsVersion}.`
    : "";
  const bootstrapNote = state.bootstrapPathCount > 0
    ? zh
      ? `另有 ${state.bootstrapPathCount} 个插件由服务器直接加载，不在这份清单里，也不能在这里启停。`
      : `${state.bootstrapPathCount} more plugin${state.bootstrapPathCount === 1 ? " is" : "s are"} loaded by the server itself — not listed here and not switchable from here.`
    : "";
  const installForm = state.supported
    ? `<div class="wh-spot-row" style="cursor:default">
        <div class="wh-spot-row-main">
          <div class="wh-spot-row-title">${spotlightViewsT(zh, "installFromALocalDirectory")}</div>
          <div class="wh-spot-row-sub">${spotlightViewsT(zh, "enterTheAbsolutePathOfThe")
          }</div>
          <input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-set-plugin-install-path value="${escapeHtml(state.installPath)}" maxlength="1000" placeholder="/srv/plugins/dsh-plugin-echo" ${state.installBusy ? "disabled" : ""} />
        </div>
        <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-set-plugin-install="true" ${state.installBusy ? "disabled" : ""}>${state.installBusy ? (spotlightViewsT(zh, "installing")) : spotlightViewsT(zh, "install")}</button>
      </div>`
    : `<div class="wh-spot-row-sub">${spotlightViewsT(zh, "thisServerVersionHasNoPlugin")
      }</div>`;
  const error = state.errorText
    ? `<div class="wh-spot-row-sub" data-spot-plugin-error="true" style="color:var(--ds-danger)">${escapeHtml(state.errorText)}</div>`
    : "";

  return `<div class="wh-spot-set-group" data-spot-plugins-section="true">
    <div class="wh-spot-set-label">${spotlightViewsT(zh, "plugins")}</div>
    <div class="wh-spot-row-sub">${spotlightViewsT(zh, "compatibleWithDeepseekHarnessToolPlugins")
    }</div>
    <div class="wh-spot-row-sub">${spotlightViewsT(zh, "pluginTrustSectionNote")}</div>
    <div class="wh-spot-row-sub wh-spot-row-sub--wrap">${spotlightViewsT(zh, "pluginNameRiskNote")}</div>
    ${hostNote ? `<div class="wh-spot-row-sub">${escapeHtml(hostNote)}</div>` : ""}
    ${rows}
    ${bootstrapNote ? `<div class="wh-spot-row-sub">${escapeHtml(bootstrapNote)}</div>` : ""}
    ${installForm}
    ${outcome}
    ${error}
  </div>`;
}

// R24 S5（N-02/E-02 补齐）：全仓此前唯一能填服务器地址的地方是首启失败时才可能浮出的连接屏——
// 已经登录之后想换一台服务器（或只是想看看自己连的是哪台），设置页里完全没有入口。这里补一行
// 只读现状 + 一个「更换服务器」按钮，点了直接在设置视图内就地渲连接服务器屏（复用
// desktop-connect-screen.ts 的 bindDesktopConnectScreen，同一套 probe/effects/applyDesktopServerChoice
// 顺序——不是另起一份"设置页专属"的换服务器实现）。
export type DesktopServerSectionState = {
  apiBase: string;
  // best-effort：拉不到（网络问题/老服务端缺字段）就只显示地址本身，不阻塞这一行的渲染。
  health: HealthResponse | undefined;
};

export function serverSectionHtml(state: DesktopServerSectionState, zh: boolean): string {
  const parts = [state.apiBase];
  if (state.health?.instance_name) {
    parts.push(state.health.instance_name);
  }
  if (state.health?.version) {
    parts.push(`v${state.health.version}`);
  }
  const detail = parts.map((part) => escapeHtml(part)).join(" · ");
  return `<div class="wh-spot-row" style="cursor:default" data-spot-server-section="true">
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${spotlightViewsT(zh, "server")}</div>
      <div class="wh-spot-row-sub">${detail}</div>
    </div>
    <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-set-change-server="true">${spotlightViewsT(zh, "changeServer")}</button>
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
  profileErrorText: string | undefined,
  policiesHtml: string,
  devicesHtml: string,
  serverHtml: string,
  pluginsHtml: string,
  mcpHtml: string
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
      <div class="wh-spot-set-label">${spotlightViewsT(zh, "language")}</div>
      <div class="wh-spot-reasons-row">${langChips}</div>
    </div>
    <div class="wh-spot-metrics">
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "runtime")}</span><span class="wh-spot-metric-v" style="color:${runtimeOk ? "var(--ds-success)" : "var(--ds-warn)"}">${runtimeOk ? (spotlightViewsT(zh, "ready2")) : spotlightViewsT(zh, "attention")}</span></div>
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "aiAssistant")}</span><span class="wh-spot-metric-v" style="color:${vm.llm_runtime.api_key_configured ? "var(--ds-success)" : "var(--ds-warn)"}">${vm.llm_runtime.api_key_configured ? (spotlightViewsT(zh, "ready")) : spotlightViewsT(zh, "notSetUp")}</span></div>
    </div>
    ${vm.llm_runtime.api_key_configured ? "" : aiNotConfiguredNoteHtml(zh)}
    ${aiSectionHtml(aiProfile, aiFailed, zh)}
    ${aiErrorText ? `<div class="wh-spot-row-sub" data-spot-ai-error="true" style="color:var(--ds-danger)">${escapeHtml(aiErrorText)}</div>` : ""}
    ${avatarSectionHtml(profile, profileFailed, zh)}
    ${profileSectionHtml(profile, profileFailed, zh)}
    ${profileErrorText ? `<div class="wh-spot-row-sub" data-spot-profile-error="true" style="color:var(--ds-danger)">${escapeHtml(profileErrorText)}</div>` : ""}
    ${policiesHtml}
    ${pluginsHtml}
    ${mcpHtml}
    ${serverHtml}
    ${devicesHtml}
    <button type="button" class="wh-spot-row" data-set-open-memory="true">
      <div class="wh-spot-row-main">
        <div class="wh-spot-row-title">${spotlightViewsT(zh, "cuuSMemory")}</div>
        <div class="wh-spot-row-sub">${spotlightViewsT(zh, "viewAndManageWhatCuuRemembers")}</div>
      </div>
    </button>
    <div class="wh-spot-row" style="cursor:default">
      <div class="wh-spot-row-main">
        <div class="wh-spot-row-title">${spotlightViewsT(zh, "desktopClient")}</div>
        <div class="wh-spot-row-sub">${spotlightViewsT(zh, "petAppearanceIsSetOnThe")}</div>
      </div>
    </div>
    <div class="wh-spot-row">
      <div class="wh-spot-row-main">
        <div class="wh-spot-row-title">${spotlightViewsT(zh, "account")}</div>
        <div class="wh-spot-row-sub">${spotlightViewsT(zh, "signOutAndReBindThis")}</div>
      </div>
      <button type="button" class="wh-spot-act wh-spot-act--danger ds-pressable" data-set-logout="true">${spotlightViewsT(zh, "signOut")}</button>
    </div>
    <div class="wh-spot-set-bottom-spacer" aria-hidden="true"></div>
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
        modal.setAttribute("aria-label", spotlightViewsT(zh, "cropAvatar"));
        modal.style.cssText =
          "background:#fff;border-radius:16px;padding:20px;display:grid;gap:14px;max-width:calc(100vw - 32px)";

        const title = deps.createElement("h3");
        title.textContent = spotlightViewsT(zh, "cropAvatar");
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
        zoomSlider.setAttribute("aria-label", spotlightViewsT(zh, "zoom"));

        const hint = deps.createElement("p");
        hint.textContent = spotlightViewsT(zh, "dragToRepositionUseTheSlider");
        hint.style.cssText = "margin:0;font-size:12px;color:#666";

        const actions = deps.createElement("div");
        actions.style.cssText = "display:flex;gap:10px;justify-content:flex-end";
        const cancelBtn = deps.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "wh-spot-act wh-spot-act--quiet";
        cancelBtn.textContent = spotlightViewsT(zh, "cancel");
        const confirmBtn = deps.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "wh-spot-act wh-spot-act--primary";
        confirmBtn.textContent = spotlightViewsT(zh, "confirm");

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

// —— R20 SEC P1-01（桌面 logout 吞错伪装成功）——————————————————————————————————————————————
// 旧实现：`ctx.client.logout().catch(()=>undefined).then(...)` 吞掉服务端登出失败，随后照样清本地令牌、
// `invoke("set_client_token","")` 也 fire-and-forget 且 `.catch` 吞错，最后无条件 reload——断网时用户看到
// "已退出"而服务端 token 仍有效、Rust 壳层仍带旧身份重连。改为有序状态机：①await 服务端登出（失败即停，
// 界面可见错误+可重试，绝不静默）→②await 清 Rust 壳层令牌（失败同样可见）→③清本地→广播→reload。
// 服务端不可达时提供显式"仍要本地退出"兜底（force 跳过①，文案警示服务端凭证可能仍有效）。
// 副作用抽成注入的 effects，让状态机可脱离真实 window/__TAURI__ 单测（同头像裁剪层依赖注入的取舍）。

export type DesktopLogoutStage = "server" | "shell";

export type DesktopLogoutEffects = {
  // ① 撤销服务端会话/设备令牌（POST /api/auth/logout）。失败必须抛出，绝不吞。
  serverLogout: () => Promise<unknown>;
  // ② 清空 Rust 壳层令牌（invoke set_client_token ""）：递增身份代际、中止旧身份后台 SSE pump。失败必须抛出。
  clearShellToken: () => Promise<unknown>;
  // ③ 清本地身份（localStorage 令牌 + 登出标记）。内部 best-effort，不抛。
  clearLocalIdentity: () => void;
  // ③ 跨窗口广播登出（工作台/桌宠丢弃旧 token）。best-effort，不抛。
  broadcastLoggedOut: () => void;
  // ③ 整窗 reload（重走 bootstrap 绑定流）。
  reload: () => void;
};

export type DesktopLogoutView = {
  showProgress: () => void;
  showError: (stage: DesktopLogoutStage) => void;
};

export type DesktopLogoutResult = "done" | "server-failed" | "shell-failed";

// 有序登出状态机。force=true 表示用户在服务端不可达后显式选择"仍要本地退出"——跳过①，直接做②③本地清理，
// 接受服务端凭证可能仍有效（错误文案已警示）。返回结果供测试断言（顺序 + 失败在哪一步止住）。
export async function runDesktopLogout(
  effects: DesktopLogoutEffects,
  view: DesktopLogoutView,
  options: { force: boolean }
): Promise<DesktopLogoutResult> {
  view.showProgress();
  // ① 服务端登出。非 force 时失败即停：绝不在服务端凭证仍有效时清本地、伪装成功（P1-01 根因）。
  if (!options.force) {
    try {
      await effects.serverLogout();
    } catch {
      view.showError("server");
      return "server-failed";
    }
  }
  // ② 清 Rust 壳层令牌（await、失败可见）。此时①已成功（服务端已安全），②失败只是本地令牌没清干净，可重试。
  try {
    await effects.clearShellToken();
  } catch {
    view.showError("shell");
    return "shell-failed";
  }
  // ③ 清本地 → 广播 → reload。
  effects.clearLocalIdentity();
  effects.broadcastLoggedOut();
  effects.reload();
  return "done";
}

// 登出失败面板：可见错误 + 重试；server 阶段另给"仍要本地退出"兜底。文案中文/英文双语、无 emoji，语气对齐产品。
export function logoutErrorPanelHtml(zh: boolean, stage: DesktopLogoutStage): string {
  const title =
    stage === "server"
      ? spotlightViewsT(zh, "signOutDidnTComplete")
      : spotlightViewsT(zh, "localCleanupDidnTFinish");
  const detail =
    stage === "server"
      ? spotlightViewsT(zh, "couldnTReachTheServerYour")
      : spotlightViewsT(zh, "signedOutOnTheServerBut");
  // 重试：server 阶段重跑完整流程（含服务端）；shell 阶段服务端已完成，只重跑本地清理（force 跳过①）。
  const retryForce = stage === "shell" ? "true" : "false";
  const retryBtn = `<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-set-logout-retry data-logout-force="${retryForce}">${spotlightViewsT(zh, "retry")}</button>`;
  // 仅 server 阶段给"仍要本地退出"兜底：服务端不可达时用户显式本地退出，文案已警示服务端凭证可能仍有效。
  const forceBtn =
    stage === "server"
      ? `<button type="button" class="wh-spot-act wh-spot-act--danger ds-pressable" data-set-logout-local>${spotlightViewsT(zh, "signOutLocallyAnyway")}</button>`
      : "";
  return `<div class="wh-spot-error" data-spot-logout-error="${stage}"><div class="wh-spot-row-title">${title}</div><div class="wh-spot-row-sub" style="margin-top:6px">${detail}</div><div style="margin-top:13px;display:flex;gap:8px;flex-wrap:wrap">${retryBtn}${forceBtn}</div></div>`;
}

// 清 Rust 壳层令牌。与旧实现的关键差异：await 且不吞错——失败向上抛给状态机（可见可重试），不再 fire-and-forget
// 伪装成功。浏览器 dev 无 __TAURI__ 时 no-op（那种环境本就没有壳层 SSE pump 要停）。
async function invokeShellClearClientToken(): Promise<void> {
  const tauri = (
    globalThis as {
      __TAURI__?: {
        core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
        invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
    }
  ).__TAURI__;
  const invoke = tauri?.core?.invoke ?? tauri?.invoke;
  if (typeof invoke !== "function") {
    return;
  }
  await invoke("set_client_token", { token: "" });
}

/**
 * R26 M7：MCP 添加表单里「离开字段就收值」的字段表。
 *
 * 为什么是 focusout 而不是 input：这一层是全量 innerHTML 重绘，逐字符重绘会在用户打字时打断焦点
 * （同「我的资料」三个字段与插件安装路径的既有取舍）。收值本身不重绘；只有服务器名要重绘一次，
 * 因为它下面挂着实时的工具名预览——不重绘那行预览就永远说的是上一个名字。
 */
const MCP_FORM_TEXT_FIELDS: ReadonlyArray<{
  selector: string;
  assign: (form: DesktopMcpFormState, value: string) => DesktopMcpFormState;
  rerender: boolean;
}> = [
  { selector: "[data-set-mcp-name]", assign: (form, value) => ({ ...form, serverName: value }), rerender: true },
  { selector: "[data-set-mcp-display]", assign: (form, value) => ({ ...form, displayName: value }), rerender: false },
  { selector: "[data-set-mcp-command]", assign: (form, value) => ({ ...form, command: value }), rerender: false },
  { selector: "[data-set-mcp-args]", assign: (form, value) => ({ ...form, argsText: value }), rerender: false },
  { selector: "[data-set-mcp-env]", assign: (form, value) => ({ ...form, envText: value }), rerender: false },
  { selector: "[data-set-mcp-cwd]", assign: (form, value) => ({ ...form, cwd: value }), rerender: false },
  { selector: "[data-set-mcp-timeout-new]", assign: (form, value) => ({ ...form, timeoutText: value }), rerender: false },
  {
    selector: "[data-set-mcp-secret-child]",
    assign: (form, value) => ({ ...form, secretRefChildKey: value }),
    rerender: false
  },
  { selector: "[data-set-mcp-secret-var]", assign: (form, value) => ({ ...form, secretRefEnvVar: value }), rerender: false }
];

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
      // R24 S5（N-02/E-02 补齐）：服务器信息行的 best-effort 状态——地址本身走 driveResourceApiBase()
      // 现拿现算（同步、不需要状态），只有 health（拉服务器名/版本）需要异步落进状态。拉不到就是
      // undefined，这一行照样渲，只是详情少两截（见 serverSectionHtml）。
      let serverHealth: HealthResponse | undefined;
      // R20 DSK-UX（R19-5）：自动通过策略撤销的两段式确认武装态 / 撤销进行中 / 失败提示。
      let policyRevokeArmedId: string | undefined;
      let policyRevokeBusyId: string | undefined;
      let policyRevokeError: string | undefined;
      let policyRevokeArmTimer: ReturnType<typeof setTimeout> | undefined;
      const clearPolicyRevokeArm = () => {
        policyRevokeArmedId = undefined;
        if (policyRevokeArmTimer !== undefined) {
          clearTimeout(policyRevokeArmTimer);
          policyRevokeArmTimer = undefined;
        }
      };
      // R23 F-02：新增/调整策略表单的字段态。文本字段（scope_id/action_pattern/priority）走 focusout
      // 提交（同下面"我的资料"三个字段的既有取舍——全量 innerHTML 重渲架构下，input 事件重渲会在用户
      // 打字时打断输入焦点），chip 类字段（scope_kind/effect）点击即改即重渲。
      let policyFormScopeKind: PermissionScopeKind = "workspace";
      let policyFormScopeId = "";
      let policyFormActionPattern = "";
      let policyFormEffect: PermissionEffect = "ask";
      let policyFormPriority = "0";
      let policyFormBusy = false;
      let policyFormError: string | undefined;

      // R24-P 阶段 1：插件治理（管理员门走 vm.plugins !== undefined，同 permission_policies 的先例）。
      // 清单本身走 GET /api/plugins（要 source_path / compat_report / load_report 这些管理面才需要的字段，
      // settings VM 里的只读摘要不带）。
      let plugins: PluginVM[] | undefined;
      let pluginsFailed = false;
      let pluginHostVersion: string | undefined;
      let pluginBootstrapPathCount = 0;
      let pluginArmedKey: string | undefined;
      let pluginBusyId: string | undefined;
      let pluginErrorText: string | undefined;
      let pluginInstallPath = "";
      let pluginInstallBusy = false;
      let pluginInstallOutcome: DesktopPluginInstallOutcome | undefined;
      let pluginArmTimer: ReturnType<typeof setTimeout> | undefined;
      const clearPluginArm = () => {
        pluginArmedKey = undefined;
        if (pluginArmTimer !== undefined) {
          clearTimeout(pluginArmTimer);
          pluginArmTimer = undefined;
        }
      };

      // R26 M7：MCP 服务器治理。
      //
      // 管理员门走 `vm.mcp_servers !== undefined`：服务端只给管理员填那个字段（M8 的网页只读行加的），
      // 而 /api/mcp-servers 整条端点也是管理员门（403 `mcp_admin_required`）——两者是同一个身份判定
      // 的两个出口，据它就不必自己猜身份、也不必靠一个注定 403 的请求闪一下。M7 当时这个字段还不
      // 存在，借的是同一道门的 `vm.plugins`；M8 落地后换成本字段，一个只有插件管理权的身份不会再
      // 看到一个必然 403 的分区。
      let mcpServers: McpServerVM[] | undefined;
      let mcpConnections: Record<string, McpServerConnectionVM> = {};
      let mcpSecretRefEnvPrefix = "";
      let mcpAvailableSecretRefs: string[] = [];
      // 高风险词只在**动作回执**上（清单端点不带），所以是一次次攒下来的：没做过动作的行没有这一句。
      let mcpRiskTokens: Record<string, readonly string[]> = {};
      let mcpFailed = false;
      let mcpArmedKey: string | undefined;
      let mcpBusyId: string | undefined;
      let mcpErrorText: string | undefined;
      let mcpForm: DesktopMcpFormState = emptyMcpFormState();
      let mcpAddOutcome: DesktopMcpAddOutcome | undefined;
      let mcpArmTimer: ReturnType<typeof setTimeout> | undefined;
      const clearMcpArm = () => {
        mcpArmedKey = undefined;
        if (mcpArmTimer !== undefined) {
          clearTimeout(mcpArmTimer);
          mcpArmTimer = undefined;
        }
      };

      // R23 F-03：已登录设备列表 + 撤销他机/本机。currentDeviceId 起始为 null（"尚未判定"与"探测到没有
      // 本地客户端"用同一个值——桌面正常情况下探测会成功，探测失败只影响"哪一行标本机"，不影响列表本身）。
      let devices: ClientDeviceResponse[] | undefined;
      let devicesFailed = false;
      let currentDeviceId: string | null = null;
      let deviceRevokeArmedId: string | undefined;
      let deviceRevokeBusyId: string | undefined;
      let deviceRevokeError: string | undefined;
      let deviceRevokeArmTimer: ReturnType<typeof setTimeout> | undefined;
      const clearDeviceRevokeArm = () => {
        deviceRevokeArmedId = undefined;
        if (deviceRevokeArmTimer !== undefined) {
          clearTimeout(deviceRevokeArmTimer);
          deviceRevokeArmTimer = undefined;
        }
      };
      // 撤销本机走另一条完全不同的收尾——它不是"撤销这条设备记录"本身，是"确定要登出这台设备"。
      // 桌面登出（runLogoutFlow → POST /api/auth/logout）已经会按 client-token 撤销这台设备（见
      // apps/api/src/routes/auth.ts 的 logout 处理器），所以这里点了就直接复用既有登出/重绑状态机
      // （runDesktopLogout），不再单独调 revokeClientDevice——避免"先撤销本机→当前 client-token
      // 立刻失效→紧接着的登出请求自己都认证不了"这种自扣脚枪。两段式确认只需要一个布尔武装态
      // （不是按 id，本机只有一条）。
      let revokeCurrentDeviceArmed = false;
      let revokeCurrentDeviceBusy = false;
      let revokeCurrentDeviceArmTimer: ReturnType<typeof setTimeout> | undefined;
      const clearRevokeCurrentDeviceArm = () => {
        revokeCurrentDeviceArmed = false;
        if (revokeCurrentDeviceArmTimer !== undefined) {
          clearTimeout(revokeCurrentDeviceArmTimer);
          revokeCurrentDeviceArmTimer = undefined;
        }
      };
      // R14 批 AVATAR：头像预览走鉴权 fetch（见文件头 avatarHref 注释），拿到的 blob URL 只在
      // 本次挂载生命周期内有效——单调代次防止连续快速重渲（比如连点 AI 分区开关）时晚到的预览
      // 覆盖新一轮渲染；dispose 时连同最后一个 blob URL 一起释放，不留内存泄漏。
      let avatarHydrateGen = 0;
      let lastAvatarObjectUrl: string | undefined;
      ctx.setSubtitle(spotlightViewsT(ctx.locale, "preferencesStatus"));

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
        const policiesHtml = permissionPoliciesSectionHtml({
          policies: vm.permission_policies,
          armedId: policyRevokeArmedId,
          busyId: policyRevokeBusyId,
          errorText: policyRevokeError,
          zh,
          // 表单跟列表用同一个 admin-only 门（vm.permission_policies 非 undefined 才渲）——非管理员
          // 时 permissionPoliciesSectionHtml 早退返回 ""，这个 form 字段传了也不会被渲染。
          form: {
            scopeKind: policyFormScopeKind,
            scopeId: policyFormScopeId,
            actionPattern: policyFormActionPattern,
            effect: policyFormEffect,
            priority: policyFormPriority,
            busy: policyFormBusy,
            errorText: policyFormError,
            supported: Boolean(ctx.client.createPermissionPolicy)
          }
        });
        const devicesHtml = devicesSectionHtml(
          {
            devices,
            failed: devicesFailed,
            currentDeviceId,
            armedId: deviceRevokeArmedId,
            busyId: deviceRevokeBusyId,
            errorText: deviceRevokeError,
            revokeCurrentArmed: revokeCurrentDeviceArmed,
            revokeCurrentBusy: revokeCurrentDeviceBusy
          },
          zh
        );
        const serverHtml = serverSectionHtml({ apiBase: driveResourceApiBase(), health: serverHealth }, zh);
        const pluginsHtml = pluginsSectionHtml(
          {
            // 管理员门：非管理员的 settings VM 结构性不含 plugins，整区不渲（同 permission_policies）。
            visible: vm.plugins !== undefined,
            plugins,
            failed: pluginsFailed,
            hostDshToolsVersion: pluginHostVersion,
            bootstrapPathCount: pluginBootstrapPathCount,
            armedKey: pluginArmedKey,
            busyId: pluginBusyId,
            errorText: pluginErrorText,
            installPath: pluginInstallPath,
            installBusy: pluginInstallBusy,
            installOutcome: pluginInstallOutcome,
            supported: Boolean(ctx.client.installPlugin)
          },
          zh
        );
        const mcpHtml = mcpServersSectionHtml(
          {
            visible: vm.mcp_servers !== undefined,
            servers: mcpServers,
            connections: mcpConnections,
            secretRefEnvPrefix: mcpSecretRefEnvPrefix,
            availableSecretRefs: mcpAvailableSecretRefs,
            riskTokens: mcpRiskTokens,
            failed: mcpFailed,
            armedKey: mcpArmedKey,
            busyId: mcpBusyId,
            errorText: mcpErrorText,
            form: mcpForm,
            addOutcome: mcpAddOutcome,
            supported: Boolean(ctx.client.addMcpServer)
          },
          zh
        );
        ctx.body.innerHTML = settingsHtml(vm, zh, aiProfile, aiFailed, aiErrorText, profile, profileFailed, profileErrorText, policiesHtml, devicesHtml, serverHtml, pluginsHtml, mcpHtml);
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

      // R23 F-03：设备列表 + 尽力探测"哪一台是本机"。桌面天然带 client-token，GET /current 正常情况下
      // 应该总能成功；仍然 catch 折叠为 null（同 web bindSettingsDevicesPanel 的既有先例）而不是让这一
      // 个补充探测的失败挡住整份设备列表的渲染。
      const loadDevices = async () => {
        try {
          devices = await ctx.client.listClientDevices();
          devicesFailed = false;
        } catch {
          if (disposed) return;
          devices = undefined;
          devicesFailed = true;
        }
        try {
          const current = await ctx.client.currentClientDevice();
          currentDeviceId = current.id;
        } catch {
          currentDeviceId = null;
        }
      };

      // R24-P 阶段 1：插件清单。旧服务端没有这批端点（api-client 上是可选方法）时安静降级成
      // 「不支持」而不是「拉取失败」——两者的下一步动作不同（升级服务端 vs 重试）。
      const loadPlugins = async () => {
        const list = ctx.client.listPlugins;
        if (!list) {
          plugins = undefined;
          pluginsFailed = false;
          return;
        }
        try {
          const result = await list.call(ctx.client);
          plugins = [...result.plugins];
          pluginHostVersion = result.host_dsh_tools_version;
          pluginBootstrapPathCount = result.bootstrap_path_count;
          pluginsFailed = false;
        } catch {
          if (disposed) return;
          plugins = undefined;
          pluginsFailed = true;
        }
      };

      // R26 M7：MCP 服务器清单。同插件清单的取舍——旧服务端没有这批端点（api-client 上是可选方法）
      // 时安静降级成「不支持」而不是「加载失败」，两者的下一步动作不同（升级服务端 vs 重试）。
      const loadMcpServers = async () => {
        const list = ctx.client.listMcpServers;
        if (!list) {
          mcpServers = undefined;
          mcpFailed = false;
          return;
        }
        try {
          const result = await list.call(ctx.client);
          mcpServers = [...result.servers];
          mcpConnections = { ...result.connections };
          mcpSecretRefEnvPrefix = result.secret_ref_env_prefix;
          mcpAvailableSecretRefs = [...result.available_secret_refs];
          mcpFailed = false;
        } catch {
          if (disposed) return;
          mcpServers = undefined;
          mcpFailed = true;
        }
      };

      // R24 S5（N-02/E-02 补齐）：服务器名/版本纯粹是锦上添花——拉不到（老服务端缺字段/一次性网络
      // 抖动）就静默留 undefined，serverSectionHtml 照样渲地址本身，不因为这个次要信息挡住整页设置。
      const loadServerHealth = async () => {
        try {
          serverHealth = await ctx.client.health();
        } catch {
          if (disposed) return;
          serverHealth = undefined;
        }
      };

      // rank7：装载失败渲带「重试」的错误块，点重试重跑（不再死胡同）。
      const load = async () => {
        ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(ctx.locale, "loadingSettings")}</div>`;
        ctx.requestResize();
        try {
          vm = await ctx.client.pages.settings({ locale: ctx.locale });
        } catch {
          if (disposed) return;
          ctx.body.innerHTML = spotlightErrorHtml(zh, spotlightViewsT(ctx.locale, "couldnTLoadSettings"));
          ctx.requestResize();
          return;
        }
        if (disposed) return;
        storageKey = vm.language.storage_key || storageKey;
        await Promise.all([
          loadAiProfile(),
          loadProfile(),
          loadDevices(),
          loadServerHealth(),
          // 非管理员的 VM 里没有 plugins 字段——那就连列表都不去拉（省一次注定 403 的请求）。
          vm.plugins !== undefined ? loadPlugins() : Promise.resolve(),
          // MCP 清单端点同样是管理员门，据它自己的那个信号（见上面 mcpServers 那组状态的注释）。
          vm.mcp_servers !== undefined ? loadMcpServers() : Promise.resolve()
        ]);
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
            aiErrorText = spotlightViewsT(ctx.locale, "couldnTSaveTryAgain");
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
            profileErrorText = spotlightViewsT(ctx.locale, "couldnTSaveTryAgain");
            renderAll();
          });
      }

      // R20 DSK-UX（R19-5）：撤销一条自动通过策略（DELETE /api/permissions/:id）。成功后从本地 vm 里把它摘掉
      // 并重渲（乐观），失败给行内错误 + toast，不吞。桌面天然满足本地客户端门；能读到这个列表本身就意味着
      // 当前身份是管理员（服务端只给管理员填 permission_policies）。
      function revokePolicy(policyId: string): void {
        clearPolicyRevokeArm();
        // MRG-25：revokePermissionPolicy 在 api-client 类型上是可选方法——旧版客户端缺它时不能
        // 非空断言硬调（会抛 TypeError，按钮永久卡「撤销中…」）。缺方法=安静降级：复位 busy、给行内
        // 错误提示，不发请求。
        const revoke = ctx.client.revokePermissionPolicy;
        if (!revoke) {
          policyRevokeBusyId = undefined;
          policyRevokeError = spotlightViewsT(ctx.locale, "thisClientVersionCanTRevoke");
          renderAll();
          return;
        }
        policyRevokeBusyId = policyId;
        policyRevokeError = undefined;
        renderAll();
        void revoke
          .call(ctx.client, policyId)
          .then(() => {
            if (disposed) return;
            policyRevokeBusyId = undefined;
            if (vm) {
              vm = { ...vm, permission_policies: (vm.permission_policies ?? []).filter((policy) => policy.id !== policyId) };
            }
            ctx.toast(spotlightViewsT(ctx.locale, "autoApprovePolicyRevoked"), "ok");
            renderAll();
          })
          .catch(() => {
            if (disposed) return;
            policyRevokeBusyId = undefined;
            policyRevokeError = spotlightViewsT(ctx.locale, "couldnTRevokeTryAgain");
            ctx.toast(spotlightViewsT(ctx.locale, "revokeFailed"), "error");
            renderAll();
          });
      }

      // R23 F-02：提交「新增/调整策略」表单（PUT /api/permissions）。服务端对等价规则会直接返回已存在
      // 的记录（见 services/approvals.ts createPolicy 的 findEquivalentActivePolicy）——按响应里的 id
      // 去重合并进本地 vm.permission_policies 即可，不必整表重拉 GET /api/permissions。
      function submitPolicyForm(): void {
        const scopeId = policyFormScopeId.trim();
        const actionPattern = policyFormActionPattern.trim();
        const priority = Number(policyFormPriority);
        if (!scopeId || !actionPattern || !Number.isFinite(priority)) {
          policyFormError = spotlightViewsT(ctx.locale, "enterAScopeIdAndAction");
          renderAll();
          return;
        }
        // MRG-25 同款取舍：createPermissionPolicy 是可选方法，旧版客户端缺它就安静降级，不非空断言硬调。
        const create = ctx.client.createPermissionPolicy;
        if (!create) {
          policyFormError = spotlightViewsT(ctx.locale, "thisClientVersionCanTCreate");
          renderAll();
          return;
        }
        const payload: PermissionPolicyWrite = {
          scope_kind: policyFormScopeKind,
          scope_id: scopeId,
          action_pattern: actionPattern,
          effect: policyFormEffect,
          priority: Math.trunc(priority),
          learned_from_session: false
        };
        policyFormBusy = true;
        policyFormError = undefined;
        renderAll();
        void create
          .call(ctx.client, payload)
          .then((created) => {
            if (disposed) return;
            policyFormBusy = false;
            if (vm) {
              const nextItem: PermissionPolicyVM = {
                id: created.id,
                action_pattern: created.action_pattern,
                effect: created.effect,
                learned_from_session: created.learned_from_session,
                created_at: created.created_at,
                revoke_href: `/api/permissions/${encodeURIComponent(created.id)}`
              };
              vm = {
                ...vm,
                permission_policies: [...(vm.permission_policies ?? []).filter((policy) => policy.id !== nextItem.id), nextItem]
              };
            }
            // 范围/效果/优先级多半跨几条规则复用，动作模式清空以方便连续新增。
            policyFormScopeId = "";
            policyFormActionPattern = "";
            ctx.toast(spotlightViewsT(ctx.locale, "policySaved"), "ok");
            renderAll();
          })
          .catch(() => {
            if (disposed) return;
            policyFormBusy = false;
            policyFormError = spotlightViewsT(ctx.locale, "couldnTSaveTryAgain2");
            ctx.toast(spotlightViewsT(ctx.locale, "saveFailed"), "error");
            renderAll();
          });
      }

      // —— R24-P 阶段 1：插件动作 —— //
      // 三个写动作共用一条收尾：成功就用服务端回执替换本地那一行（服务端是唯一事实源，
      // 启停之后的 status 可能是 load_failed，本地猜不出来），失败给行内错误 + toast，不吞。
      function replacePluginRow(next: PluginVM): void {
        plugins = (plugins ?? []).map((plugin) => (plugin.id === next.id ? next : plugin));
      }

      function runPluginAction(
        id: string,
        run: () => Promise<PluginVM | { removed: true }>,
        onDone: (result: PluginVM | { removed: true }) => void,
        okToast: string,
        failToast: string
      ): void {
        clearPluginArm();
        pluginBusyId = id;
        pluginErrorText = undefined;
        renderAll();
        void run()
          .then((result) => {
            if (disposed) return;
            pluginBusyId = undefined;
            onDone(result);
            ctx.toast(okToast, "ok");
            renderAll();
          })
          .catch(() => {
            if (disposed) return;
            pluginBusyId = undefined;
            pluginErrorText = spotlightViewsT(ctx.locale, "thatDidnTWorkTryAgain");
            ctx.toast(failToast, "error");
            renderAll();
          });
      }

      function togglePlugin(plugin: PluginVM): void {
        const enabled = plugin.enabled && plugin.status !== "disabled";
        const call = enabled ? ctx.client.disablePlugin : ctx.client.enablePlugin;
        if (!call) {
          pluginErrorText = spotlightViewsT(ctx.locale, "thisServerVersionHasNoPlugin2");
          renderAll();
          return;
        }
        runPluginAction(
          plugin.id,
          () => call.call(ctx.client, plugin.id),
          (result) => replacePluginRow(result as PluginVM),
          enabled ? (spotlightViewsT(ctx.locale, "disabled")) : (spotlightViewsT(ctx.locale, "enabled")),
          spotlightViewsT(ctx.locale, "couldnTChangeIt")
        );
      }

      /**
       * 改信任级别。**只有「往下放宽」需要两段式确认**——那一步是在撤掉一道人工门；
       * 往回收紧是把门装回去，没有理由再拦一次。
       */
      function setPluginTrust(plugin: PluginVM): void {
        const call = ctx.client.setPluginTrustLevel;
        if (!call) {
          pluginErrorText = spotlightViewsT(ctx.locale, "thisServerVersionHasNoPlugin2");
          renderAll();
          return;
        }
        const next = plugin.trust_level === "read_only" ? "external_effect" : "read_only";
        runPluginAction(
          plugin.id,
          () => call.call(ctx.client, plugin.id, { trust_level: next }),
          (result) => replacePluginRow(result as PluginVM),
          spotlightViewsT(ctx.locale, next === "read_only" ? "pluginTrustReadOnly" : "pluginTrustExternalEffect"),
          spotlightViewsT(ctx.locale, "couldnTChangeIt")
        );
      }

      function removePlugin(plugin: PluginVM): void {
        const call = ctx.client.removePlugin;
        if (!call) {
          pluginErrorText = spotlightViewsT(ctx.locale, "thisServerVersionHasNoPlugin2");
          renderAll();
          return;
        }
        runPluginAction(
          plugin.id,
          () => call.call(ctx.client, plugin.id),
          () => {
            plugins = (plugins ?? []).filter((entry) => entry.id !== plugin.id);
            if (pluginInstallOutcome?.kind === "installed" && pluginInstallOutcome.plugin.id === plugin.id) {
              // 刚装完就移除：那张结果卡说的已经不成立了，收掉，不留一条骗人的「装好了」。
              pluginInstallOutcome = undefined;
            }
          },
          spotlightViewsT(ctx.locale, "removed"),
          spotlightViewsT(ctx.locale, "couldnTRemoveIt")
        );
      }

      // 安装：服务端先做**不执行插件代码**的静态体检。被拒时按错误码出人话（服务端消息是中文，
      // 界面文案两种语言都要有，所以这里按 code 出而不是直接渲服务端 message）。
      function submitPluginInstall(): void {
        const sourcePath = pluginInstallPath.trim();
        const install = ctx.client.installPlugin;
        if (!install) {
          pluginErrorText = spotlightViewsT(ctx.locale, "thisServerVersionHasNoPlugin2");
          renderAll();
          return;
        }
        if (!sourcePath) {
          pluginErrorText = spotlightViewsT(ctx.locale, "enterThePluginDirectorySAbsolute");
          renderAll();
          return;
        }
        pluginInstallBusy = true;
        pluginErrorText = undefined;
        pluginInstallOutcome = undefined;
        renderAll();
        void install
          .call(ctx.client, { source_path: sourcePath })
          .then((installed) => {
            if (disposed) return;
            pluginInstallBusy = false;
            pluginInstallPath = "";
            plugins = [...(plugins ?? []).filter((entry) => entry.id !== installed.id), installed];
            pluginInstallOutcome = { kind: "installed", plugin: installed };
            ctx.toast(
              installed.status === "installed"
                ? (spotlightViewsT(ctx.locale, "pluginInstalled"))
                : (spotlightViewsT(ctx.locale, "registeredButItDidNotLoad")),
              installed.status === "installed" ? "ok" : "info"
            );
            renderAll();
          })
          .catch((error: unknown) => {
            if (disposed) return;
            pluginInstallBusy = false;
            // WorkHubApiError 的公开字段是 code——duck-type 读，不 import 运行时类
            // （同 apps/web/src/settings-devices.ts humanizeDeviceRevokeError 的既有先例）。
            const code = error && typeof error === "object" && "code" in error
              ? String((error as { code?: unknown }).code)
              : undefined;
            pluginInstallOutcome = { kind: "refused", code };
            ctx.toast(spotlightViewsT(ctx.locale, "notInstalled"), "error");
            renderAll();
          });
      }

      // —— R26 M7：MCP 服务器动作 —— //
      // 五个写动作（启用/停用/测试连接/改配置/移除）里前四个回执形状相同（`{server, connection?,
      // risk_tokens}`），所以共用一条收尾：**服务端是唯一事实源**——启停之后的 status 可能是
      // connect_failed（M0 的仓储层刻意不冒充一个还没发生的验证结果），本地猜不出来，一律用回执替换。
      function applyMcpActionResult(result: McpServerActionResult): void {
        mcpServers = (mcpServers ?? []).map((server) => (server.id === result.server.id ? result.server : server));
        const next = { ...mcpConnections };
        if (result.connection) {
          next[result.server.id] = result.connection;
        } else {
          // 停用的服务器整体没有连接快照——留着上一份会让「已停用」旁边还挂着「3 个工具活着」。
          delete next[result.server.id];
        }
        mcpConnections = next;
        mcpRiskTokens = { ...mcpRiskTokens, [result.server.id]: result.risk_tokens };
      }

      function runMcpAction(
        id: string,
        run: () => Promise<McpServerActionResult | void>,
        onDone: (result: McpServerActionResult | void) => void,
        okToast: string,
        failToast: string
      ): void {
        clearMcpArm();
        mcpBusyId = id;
        mcpErrorText = undefined;
        renderAll();
        void run()
          .then((result) => {
            if (disposed) return;
            mcpBusyId = undefined;
            onDone(result);
            ctx.toast(okToast, "ok");
            renderAll();
          })
          .catch((error: unknown) => {
            if (disposed) return;
            mcpBusyId = undefined;
            mcpErrorText = mcpErrorTextFor(error);
            ctx.toast(failToast, "error");
            renderAll();
          });
      }

      // WorkHubApiError 的公开字段是 code——duck-type 读，不 import 运行时类（同
      // submitPluginInstall 与 apps/web/src/settings-devices.ts 的既有先例）。
      function mcpErrorCodeOf(error: unknown): string | undefined {
        return error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : undefined;
      }

      function mcpErrorTextFor(error: unknown): string {
        const code = mcpErrorCodeOf(error);
        return code ? mcpAddErrorText(code, ctx.locale === "zh-CN") : spotlightViewsT(ctx.locale, "thatDidnTWorkTryAgain");
      }

      function toggleMcpServer(server: McpServerVM): void {
        const enabled = server.enabled && server.status !== "disabled";
        const call = enabled ? ctx.client.disableMcpServer : ctx.client.enableMcpServer;
        if (!call) {
          mcpErrorText = spotlightViewsT(ctx.locale, "mcpUnsupported");
          renderAll();
          return;
        }
        runMcpAction(
          server.id,
          () => call.call(ctx.client, server.id),
          (result) => applyMcpActionResult(result as McpServerActionResult),
          spotlightViewsT(ctx.locale, enabled ? "disabled" : "enabled"),
          spotlightViewsT(ctx.locale, "couldnTChangeIt")
        );
      }

      /**
       * 测试连接。**单段确认**：它不改任何配置，只是问一句「现在连得上吗」。
       * 连不上时端点仍然回 200——结论在回执的 status / last_error 里（见 M3 Note 第 2 节），
       * 所以这条成功路径也可能渲出一行「连不上」，那不是这次请求失败了。
       */
      function testMcpConnection(server: McpServerVM): void {
        const call = ctx.client.reloadMcpServer;
        if (!call) {
          mcpErrorText = spotlightViewsT(ctx.locale, "mcpUnsupported");
          renderAll();
          return;
        }
        runMcpAction(
          server.id,
          () => call.call(ctx.client, server.id),
          (result) => applyMcpActionResult(result as McpServerActionResult),
          spotlightViewsT(ctx.locale, "mcpTested"),
          spotlightViewsT(ctx.locale, "mcpCouldnTTest")
        );
      }

      /**
       * 改信任级别。**只有「往下放宽」需要两段式确认**——那一步是在撤掉一道人工门；
       * 往回收紧是把门装回去，没有理由再拦一次（同插件那侧的既有取舍）。
       */
      function setMcpTrust(server: McpServerVM): void {
        const call = ctx.client.updateMcpServer;
        if (!call) {
          mcpErrorText = spotlightViewsT(ctx.locale, "mcpUnsupported");
          renderAll();
          return;
        }
        const next: McpServerTrustLevel = server.trust_level === "read_only" ? "external_effect" : "read_only";
        runMcpAction(
          server.id,
          () => call.call(ctx.client, server.id, { trust_level: next }),
          (result) => applyMcpActionResult(result as McpServerActionResult),
          spotlightViewsT(ctx.locale, next === "read_only" ? "mcpTrustReadOnly" : "mcpTrustExternalEffect"),
          spotlightViewsT(ctx.locale, "couldnTChangeIt")
        );
      }

      /** 改单次调用超时。值没变就什么都不做——一次空 PATCH 是 422，不该由「点了别处」触发。 */
      function setMcpTimeout(server: McpServerVM, raw: string): void {
        const call = ctx.client.updateMcpServer;
        if (!call) {
          mcpErrorText = spotlightViewsT(ctx.locale, "mcpUnsupported");
          renderAll();
          return;
        }
        const parsed = parseMcpTimeoutMs(raw);
        if (parsed === undefined) {
          mcpErrorText = spotlightViewsT(ctx.locale, "mcpTimeoutInvalid");
          renderAll();
          return;
        }
        if (parsed === server.tool_call_timeout_ms) {
          return;
        }
        runMcpAction(
          server.id,
          () => call.call(ctx.client, server.id, { tool_call_timeout_ms: parsed }),
          (result) => applyMcpActionResult(result as McpServerActionResult),
          spotlightViewsT(ctx.locale, "mcpTimeoutSaved"),
          spotlightViewsT(ctx.locale, "couldnTChangeIt")
        );
      }

      function removeMcpServer(server: McpServerVM): void {
        const call = ctx.client.removeMcpServer;
        if (!call) {
          mcpErrorText = spotlightViewsT(ctx.locale, "mcpUnsupported");
          renderAll();
          return;
        }
        runMcpAction(
          server.id,
          () => call.call(ctx.client, server.id),
          () => {
            mcpServers = (mcpServers ?? []).filter((entry) => entry.id !== server.id);
            const next = { ...mcpConnections };
            delete next[server.id];
            mcpConnections = next;
            if (mcpAddOutcome?.kind === "added" && mcpAddOutcome.server.id === server.id) {
              // 刚接完就移除：那张结果卡说的已经不成立了，收掉，不留一条骗人的「接好了」。
              mcpAddOutcome = undefined;
            }
          },
          spotlightViewsT(ctx.locale, "removed"),
          spotlightViewsT(ctx.locale, "couldnTRemoveIt")
        );
      }

      /**
       * 接一台服务器。表单先在本地拦三种一定会被 422 的填法（名字/命令为空、环境变量行读不了、
       * 超时越界），其余交给服务端的启动前检查——**它不执行任何服务器代码**，只做字符串判定、
       * PATH 查找和一次 access()。被拒时按稳定错误码出人话（不解析服务端的英文诊断）。
       */
      function submitMcpAdd(): void {
        const add = ctx.client.addMcpServer;
        if (!add) {
          mcpForm = { ...mcpForm, errorText: spotlightViewsT(ctx.locale, "mcpUnsupported") };
          renderAll();
          return;
        }
        const serverName = mcpForm.serverName.trim();
        const command = mcpForm.command.trim();
        if (!serverName || !command) {
          mcpForm = { ...mcpForm, errorText: spotlightViewsT(ctx.locale, "mcpFillNameAndCommand") };
          renderAll();
          return;
        }
        const env = parseMcpEnv(mcpForm.envText);
        if (!env.ok) {
          mcpForm = {
            ...mcpForm,
            errorText: spotlightViewsT(ctx.locale, "mcpEnvLineInvalid").replace("{line}", env.badLine)
          };
          renderAll();
          return;
        }
        const timeout = parseMcpTimeoutMs(mcpForm.timeoutText);
        if (timeout === undefined) {
          mcpForm = { ...mcpForm, errorText: spotlightViewsT(ctx.locale, "mcpTimeoutInvalid") };
          renderAll();
          return;
        }
        const args = parseMcpArgs(mcpForm.argsText);
        const displayName = mcpForm.displayName.trim();
        const cwd = mcpForm.cwd.trim();
        // 请求体是 `.strict()`：多一个字段就是 422，空值一律**不带**这个键而不是发一个空串。
        const payload: AddMcpServerRequest = {
          server_name: serverName,
          command,
          trust_level: mcpForm.trustLevel,
          tool_call_timeout_ms: timeout,
          ...(displayName ? { display_name: displayName } : {}),
          ...(args.length > 0 ? { args } : {}),
          ...(Object.keys(env.env).length > 0 ? { env: env.env } : {}),
          ...(Object.keys(mcpForm.secretRefs).length > 0 ? { secret_refs: { ...mcpForm.secretRefs } } : {}),
          ...(cwd ? { cwd } : {})
        };
        mcpForm = { ...mcpForm, busy: true, errorText: undefined };
        mcpAddOutcome = undefined;
        mcpErrorText = undefined;
        renderAll();
        void add
          .call(ctx.client, payload)
          .then((result) => {
            if (disposed) return;
            mcpServers = [...(mcpServers ?? []).filter((entry) => entry.id !== result.server.id), result.server];
            if (result.connection) {
              mcpConnections = { ...mcpConnections, [result.server.id]: result.connection };
            }
            mcpRiskTokens = { ...mcpRiskTokens, [result.server.id]: result.risk_tokens };
            mcpAddOutcome = {
              kind: "added",
              server: result.server,
              connection: result.connection,
              riskTokens: result.risk_tokens
            };
            // 接好了就把表单清空——留着上一台的命令，下一次「添加」很容易变成一次误提交。
            mcpForm = emptyMcpFormState();
            ctx.toast(
              spotlightViewsT(ctx.locale, result.server.status === "connected" ? "mcpAdded" : "mcpAddedButNotConnected"),
              result.server.status === "connected" ? "ok" : "info"
            );
            renderAll();
          })
          .catch((error: unknown) => {
            if (disposed) return;
            mcpForm = { ...mcpForm, busy: false };
            mcpAddOutcome = { kind: "refused", code: mcpErrorCodeOf(error) };
            ctx.toast(spotlightViewsT(ctx.locale, "mcpNotAdded"), "error");
            renderAll();
          });
      }

      /** 加一条引用式密钥。两边都只是**名字**——值在服务端上，这一层结构性拿不到。 */
      function addMcpSecretRef(): void {
        const childKey = mcpForm.secretRefChildKey.trim();
        const envVar = mcpForm.secretRefEnvVar.trim();
        if (!childKey || !envVar) {
          mcpForm = { ...mcpForm, errorText: spotlightViewsT(ctx.locale, "mcpSecretRefIncomplete") };
          renderAll();
          return;
        }
        mcpForm = {
          ...mcpForm,
          secretRefs: { ...mcpForm.secretRefs, [childKey]: envVar },
          secretRefChildKey: "",
          errorText: undefined
        };
        renderAll();
      }

      // 两段式确认的共用武装动作：武装 5 秒后自动解除（同插件/策略/设备三处的既有节奏）。
      function armMcp(key: string): void {
        clearMcpArm();
        mcpArmedKey = key;
        mcpErrorText = undefined;
        mcpArmTimer = setTimeout(() => {
          mcpArmTimer = undefined;
          if (disposed) return;
          mcpArmedKey = undefined;
          renderAll();
        }, 5000);
        renderAll();
      }

      /** 从一个 `data-set-mcp-*` 按钮的 id 找回那一行；忙着的时候一概不接新动作。 */
      function mcpServerFor(id: string | undefined): McpServerVM | undefined {
        if (!id || mcpBusyId) {
          return undefined;
        }
        return (mcpServers ?? []).find((server) => server.id === id);
      }

      // R23 F-03：撤销他机（非本机）——POST /api/client-devices/:id/revoke。乐观本地替换（同 revokePolicy
      // 的既有取舍），不整表重拉。revokeClientDevice 是必填方法（不是可选面），不需要 MRG-25 式降级判断。
      function revokeDevice(deviceId: string): void {
        clearDeviceRevokeArm();
        deviceRevokeBusyId = deviceId;
        deviceRevokeError = undefined;
        renderAll();
        void ctx.client
          .revokeClientDevice(deviceId)
          .then((revoked) => {
            if (disposed) return;
            deviceRevokeBusyId = undefined;
            if (devices) {
              devices = devices.map((device) => (device.id === deviceId ? revoked : device));
            }
            ctx.toast(spotlightViewsT(ctx.locale, "deviceRevoked"), "ok");
            renderAll();
          })
          .catch(() => {
            if (disposed) return;
            deviceRevokeBusyId = undefined;
            deviceRevokeError = spotlightViewsT(ctx.locale, "couldnTRevokeTryAgain");
            ctx.toast(spotlightViewsT(ctx.locale, "revokeFailed"), "error");
            renderAll();
          });
      }

      // R20 SEC P1-01：登出的生产副作用（摸真 window/__TAURI__/壳层广播）。状态机本身 (runDesktopLogout) 与
      // 这些副作用解耦，单测直接注入假 effects 断言顺序/失败停位；这里只在真实桌面环境执行。
      const logoutEffects: DesktopLogoutEffects = {
        serverLogout: () => ctx.client.logout(),
        clearShellToken: () => invokeShellClearClientToken(),
        clearLocalIdentity: () => {
          try {
            // DSK-06：清令牌走单一收口（新旧两键都删）。
            clearDesktopClientToken(window.localStorage);
            // R10：落显式登出标记——boot 见它则停在重新绑定屏，不再用固定昵称自动绑回同一账户。
            window.localStorage.setItem("workhub_desktop_logged_out", "1");
          } catch {
            // ignore storage failure
          }
        },
        broadcastLoggedOut: () => {
          // 跨窗口登出广播：已开着的工作台/桌宠窗手里的 client token 刚被清空，靠既有 Tauri 事件桥通知它们。
          // 无 Tauri（浏览器 dev 预览）时 resolveDesktopShellEmitter() 返回 undefined，静默跳过。
          const shellEmitter = resolveDesktopShellEmitter();
          void Promise.resolve(shellEmitter?.emit?.("workhub-logged-out")).catch(() => undefined);
        },
        reload: () => window.location.reload()
      };
      const logoutView: DesktopLogoutView = {
        showProgress: () => ctx.toast(spotlightViewsT(ctx.locale, "signingOut"), "info"),
        showError: (stage) => {
          ctx.body.innerHTML = logoutErrorPanelHtml(zh, stage);
          ctx.requestResize();
          if (!disposed) {
            ctx.refocusBody();
          }
        }
      };
      const runLogoutFlow = (opts: { force: boolean }) => {
        void runDesktopLogout(logoutEffects, logoutView, opts);
      };

      // R23 F-03：撤销本机——见文件顶部状态声明处的注释：直接复用既有登出/重绑状态机（服务端 logout
      // 处理器已经会按 client-token 撤销这台设备），不单独调 revokeClientDevice(currentDeviceId)（那会
      // 让当前 client-token 在登出请求自己发出之前就先失效）。
      function revokeCurrentDeviceAndSignOut(): void {
        clearRevokeCurrentDeviceArm();
        revokeCurrentDeviceBusy = true;
        renderAll();
        runLogoutFlow({ force: false });
      }

      // R24 S5（N-02/E-02 补齐）：设置页「更换服务器」——就地把连接服务器屏渲进这个能力视图自己的
      // ctx.body（不新开窗口/不整窗替换），走跟首启/离线兜底完全同一套 bindDesktopConnectScreen +
      // applyDesktopServerChoice（探测不带令牌 C1、地址只认输入框 C2、确认顺序 C3——见
      // desktop-connect-screen.ts 顶注，这里不重造一份"设置页专属"的换服务器实现）。
      // onUnchanged：地址跟当前一样时 applyDesktopServerChoice 短路跳过清身份/通知壳层
      // （R24 S5 N-07），这里对应地收起这一屏、重渲回设置本身，而不是 reload 掉一个正常在线的会话。
      function openChangeServerScreen(): void {
        bindDesktopConnectScreen(ctx.body, {
          locale: ctx.locale,
          apiBase: driveResourceApiBase(),
          probe: (base) => createApiClient({ baseUrl: base }).health(),
          effects: createDesktopServerChoiceEffects({
            storage: window.localStorage,
            invoke: resolveDesktopTauriInvoke()
          }),
          reload: () => window.location.reload(),
          onUnchanged: () => {
            renderAll();
          },
          scheduleRebuild: () => scheduleWorkHubLiquidGlassFilterRebuild(document)
        });
        ctx.requestResize();
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
          ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(ctx.locale, "loadingSettings")}</div>`;
          ctx.requestResize();
          void loadAiProfile().then(() => {
            if (disposed) return;
            renderAll();
          });
          return;
        }
        if (target.closest("[data-spot-profile-retry]")) {
          profileFailed = false;
          ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(ctx.locale, "loadingSettings")}</div>`;
          ctx.requestResize();
          void loadProfile().then(() => {
            if (disposed) return;
            renderAll();
          });
          return;
        }
        // R20 DSK-UX（R19-5）：撤销自动通过策略——两段式确认（decidePolicyRevokeConfirmation）：第一下武装、
        // 5 秒内对同一条再点一次才真发 DELETE。武装超时自动解除。
        const revokePolicyBtn = target.closest<HTMLElement>("[data-set-revoke-policy]");
        if (revokePolicyBtn?.dataset.setRevokePolicy) {
          const policyId = revokePolicyBtn.dataset.setRevokePolicy;
          if (policyRevokeBusyId) {
            return;
          }
          const decision = decidePolicyRevokeConfirmation(policyRevokeArmedId, policyId);
          if (decision.kind === "execute") {
            revokePolicy(policyId);
            return;
          }
          clearPolicyRevokeArm();
          policyRevokeArmedId = policyId;
          policyRevokeError = undefined;
          policyRevokeArmTimer = setTimeout(() => {
            policyRevokeArmTimer = undefined;
            if (disposed) return;
            policyRevokeArmedId = undefined;
            renderAll();
          }, 5000);
          renderAll();
          return;
        }
        // R23 F-02：新增/调整策略表单——scope_kind/effect 是 chip，点即改即重渲；scope_id 切到
        // workspace 且尚未手填过时，顺手把 aiProfile.workspace_id 填进去做个方便默认（org 没有现成来源，
        // 不瞎猜，见文件顶部注释）。
        const scopeKindBtn = target.closest<HTMLElement>("[data-set-policy-scope-kind]");
        if (scopeKindBtn?.dataset.setPolicyScopeKind) {
          const kind = scopeKindBtn.dataset.setPolicyScopeKind as PermissionScopeKind;
          if (kind !== policyFormScopeKind) {
            policyFormScopeKind = kind;
            if (kind === "workspace" && !policyFormScopeId && aiProfile) {
              policyFormScopeId = aiProfile.workspace_id;
            }
            renderAll();
          }
          return;
        }
        const policyEffectBtn = target.closest<HTMLElement>("[data-set-policy-effect]");
        if (policyEffectBtn?.dataset.setPolicyEffect) {
          const effect = policyEffectBtn.dataset.setPolicyEffect as PermissionEffect;
          if (effect !== policyFormEffect) {
            policyFormEffect = effect;
            renderAll();
          }
          return;
        }
        if (target.closest("[data-set-policy-submit]")) {
          if (!policyFormBusy) {
            submitPolicyForm();
          }
          return;
        }
        // —— R24-P 阶段 1：插件区的四个动作 —— //
        if (target.closest("[data-set-plugins-retry]")) {
          pluginsFailed = false;
          void loadPlugins().then(() => {
            if (disposed) return;
            renderAll();
          });
          return;
        }
        if (target.closest("[data-set-plugin-install]")) {
          if (!pluginInstallBusy) {
            submitPluginInstall();
          }
          return;
        }
        // 信任级别：放宽（→ 只读断言）要两段式确认，收紧（→ 最高风险）立即生效。
        const trustBtn = target.closest<HTMLElement>("[data-set-plugin-trust]");
        if (trustBtn?.dataset.setPluginTrust) {
          const id = trustBtn.dataset.setPluginTrust;
          const plugin = (plugins ?? []).find((entry) => entry.id === id);
          if (!plugin || pluginBusyId) {
            return;
          }
          if (plugin.trust_level === "read_only") {
            clearPluginArm();
            setPluginTrust(plugin);
            return;
          }
          const decision = decidePolicyRevokeConfirmation(pluginArmedKey, `trust:${id}`);
          if (decision.kind === "execute") {
            setPluginTrust(plugin);
            return;
          }
          clearPluginArm();
          pluginArmedKey = `trust:${id}`;
          pluginErrorText = undefined;
          pluginArmTimer = setTimeout(() => {
            pluginArmTimer = undefined;
            if (disposed) return;
            pluginArmedKey = undefined;
            renderAll();
          }, 5000);
          renderAll();
          return;
        }
        // 启停/移除都是两段式确认（复用 decidePolicyRevokeConfirmation 这个纯 armed/clicked 判定）。
        // 武装键带动作前缀，两个按钮不会互相解除对方的武装。
        const toggleBtn = target.closest<HTMLElement>("[data-set-plugin-toggle]");
        if (toggleBtn?.dataset.setPluginToggle) {
          const id = toggleBtn.dataset.setPluginToggle;
          const plugin = (plugins ?? []).find((entry) => entry.id === id);
          if (!plugin || pluginBusyId) {
            return;
          }
          const decision = decidePolicyRevokeConfirmation(pluginArmedKey, `toggle:${id}`);
          if (decision.kind === "execute") {
            togglePlugin(plugin);
            return;
          }
          clearPluginArm();
          pluginArmedKey = `toggle:${id}`;
          pluginErrorText = undefined;
          pluginArmTimer = setTimeout(() => {
            pluginArmTimer = undefined;
            if (disposed) return;
            pluginArmedKey = undefined;
            renderAll();
          }, 5000);
          renderAll();
          return;
        }
        const removeBtn = target.closest<HTMLElement>("[data-set-plugin-remove]");
        if (removeBtn?.dataset.setPluginRemove) {
          const id = removeBtn.dataset.setPluginRemove;
          const plugin = (plugins ?? []).find((entry) => entry.id === id);
          if (!plugin || pluginBusyId) {
            return;
          }
          const decision = decidePolicyRevokeConfirmation(pluginArmedKey, `remove:${id}`);
          if (decision.kind === "execute") {
            removePlugin(plugin);
            return;
          }
          clearPluginArm();
          pluginArmedKey = `remove:${id}`;
          pluginErrorText = undefined;
          pluginArmTimer = setTimeout(() => {
            pluginArmTimer = undefined;
            if (disposed) return;
            pluginArmedKey = undefined;
            renderAll();
          }, 5000);
          renderAll();
          return;
        }
        // —— R26 M7：MCP 服务器区的动作 —— //
        if (target.closest("[data-set-mcp-retry]")) {
          mcpFailed = false;
          void loadMcpServers().then(() => {
            if (disposed) return;
            renderAll();
          });
          return;
        }
        if (target.closest("[data-set-mcp-add]")) {
          if (!mcpForm.busy) {
            submitMcpAdd();
          }
          return;
        }
        if (target.closest("[data-set-mcp-secret-add]")) {
          if (!mcpForm.busy) {
            addMcpSecretRef();
          }
          return;
        }
        const mcpSecretDrop = target.closest<HTMLElement>("[data-set-mcp-secret-drop]");
        if (mcpSecretDrop?.dataset.setMcpSecretDrop) {
          const key = mcpSecretDrop.dataset.setMcpSecretDrop;
          const secretRefs = { ...mcpForm.secretRefs };
          delete secretRefs[key];
          mcpForm = { ...mcpForm, secretRefs, errorText: undefined };
          renderAll();
          return;
        }
        const mcpFormTrust = target.closest<HTMLElement>("[data-set-mcp-form-trust]");
        if (mcpFormTrust?.dataset.setMcpFormTrust) {
          mcpForm = { ...mcpForm, trustLevel: mcpFormTrust.dataset.setMcpFormTrust as McpServerTrustLevel };
          renderAll();
          return;
        }
        // 测试连接不改任何配置，单段即走。
        const mcpTestBtn = target.closest<HTMLElement>("[data-set-mcp-test]");
        if (mcpTestBtn?.dataset.setMcpTest) {
          const server = mcpServerFor(mcpTestBtn.dataset.setMcpTest);
          if (server) {
            clearMcpArm();
            testMcpConnection(server);
          }
          return;
        }
        // 信任级别：放宽（→ 只读断言）要两段式确认，收紧（→ 最高风险）立即生效。
        const mcpTrustBtn = target.closest<HTMLElement>("[data-set-mcp-trust]");
        if (mcpTrustBtn?.dataset.setMcpTrust) {
          const id = mcpTrustBtn.dataset.setMcpTrust;
          const server = mcpServerFor(id);
          if (!server) {
            return;
          }
          if (server.trust_level === "read_only") {
            clearMcpArm();
            setMcpTrust(server);
            return;
          }
          if (decidePolicyRevokeConfirmation(mcpArmedKey, `trust:${id}`).kind === "execute") {
            setMcpTrust(server);
            return;
          }
          armMcp(`trust:${id}`);
          return;
        }
        // 启停/移除都是两段式确认（复用 decidePolicyRevokeConfirmation 这个纯 armed/clicked 判定）。
        const mcpToggleBtn = target.closest<HTMLElement>("[data-set-mcp-toggle]");
        if (mcpToggleBtn?.dataset.setMcpToggle) {
          const id = mcpToggleBtn.dataset.setMcpToggle;
          const server = mcpServerFor(id);
          if (!server) {
            return;
          }
          if (decidePolicyRevokeConfirmation(mcpArmedKey, `toggle:${id}`).kind === "execute") {
            toggleMcpServer(server);
            return;
          }
          armMcp(`toggle:${id}`);
          return;
        }
        const mcpRemoveBtn = target.closest<HTMLElement>("[data-set-mcp-remove]");
        if (mcpRemoveBtn?.dataset.setMcpRemove) {
          const id = mcpRemoveBtn.dataset.setMcpRemove;
          const server = mcpServerFor(id);
          if (!server) {
            return;
          }
          if (decidePolicyRevokeConfirmation(mcpArmedKey, `remove:${id}`).kind === "execute") {
            removeMcpServer(server);
            return;
          }
          armMcp(`remove:${id}`);
          return;
        }
        // R23 F-03：设备列表重试。
        if (target.closest("[data-set-devices-retry]")) {
          devicesFailed = false;
          ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(ctx.locale, "loadingSettings")}</div>`;
          ctx.requestResize();
          void loadDevices().then(() => {
            if (disposed) return;
            renderAll();
          });
          return;
        }
        // R23 F-03：撤销他机——两段式确认，同撤销策略的先例（decidePolicyRevokeConfirmation 是纯粹的
        // armedId/clickedId 判定，不含策略专属逻辑，这里直接复用而不重写一份等价函数）。
        const revokeDeviceBtn = target.closest<HTMLElement>("[data-set-revoke-device]");
        if (revokeDeviceBtn?.dataset.setRevokeDevice) {
          const deviceId = revokeDeviceBtn.dataset.setRevokeDevice;
          if (deviceRevokeBusyId) {
            return;
          }
          const decision = decidePolicyRevokeConfirmation(deviceRevokeArmedId, deviceId);
          if (decision.kind === "execute") {
            revokeDevice(deviceId);
            return;
          }
          clearDeviceRevokeArm();
          deviceRevokeArmedId = deviceId;
          deviceRevokeError = undefined;
          deviceRevokeArmTimer = setTimeout(() => {
            deviceRevokeArmTimer = undefined;
            if (disposed) return;
            deviceRevokeArmedId = undefined;
            renderAll();
          }, 5000);
          renderAll();
          return;
        }
        // R23 F-03：撤销本机（并登出）——两段式确认，同一个动作没有多个 id 可武装，只需一个布尔态。
        if (target.closest("[data-set-revoke-current-device]")) {
          if (revokeCurrentDeviceBusy) {
            return;
          }
          if (!revokeCurrentDeviceArmed) {
            revokeCurrentDeviceArmed = true;
            renderAll();
            revokeCurrentDeviceArmTimer = setTimeout(() => {
              revokeCurrentDeviceArmTimer = undefined;
              if (disposed) return;
              revokeCurrentDeviceArmed = false;
              renderAll();
            }, 5000);
            return;
          }
          revokeCurrentDeviceAndSignOut();
          return;
        }
        // R14 批 MEM：设置区旁挂的记忆管理面入口——独立能力视图（views/memory.ts），不是内联区块。
        if (target.closest("[data-set-open-memory]")) {
          ctx.open("memory");
          return;
        }
        // R24 S5（N-02/E-02 补齐）：登录之后想换一台服务器，此前全仓没有入口——直接在设置视图的内容区
        // 就地渲连接服务器屏（同 openChangeServerScreen 顶注）。
        if (target.closest("[data-set-change-server]")) {
          openChangeServerScreen();
          return;
        }
        // M-06：「查看部署说明」——桌面 Tauri webview 对外部链接没有承接（target=_blank 点了没反应，
        // 同 dashboards.ts 的 GitHub 活动行 rank2 那条既有教训：不假装能内联打开外部站点）。这里退而
        // 求其次，把链接复制进剪贴板并诚实告知，让用户自己粘到系统浏览器——比只说「去系统浏览器打开」
        // 却不给链接本身更可行动。
        if (target.closest("[data-set-ai-deploy-docs]")) {
          const copied = globalThis.navigator?.clipboard?.writeText?.(DEPLOY_DOC_URL);
          if (copied && typeof copied.then === "function") {
            copied.then(
              () => {
                ctx.toast(
                  spotlightViewsT(ctx.locale, "copiedTheDeploymentDocLinkPaste"),
                  "ok"
                );
              },
              () => {
                ctx.toast(zh ? `未能复制，请手动打开：${DEPLOY_DOC_URL}` : `Couldn't copy — open manually: ${DEPLOY_DOC_URL}`, "error");
              }
            );
          } else {
            ctx.toast(zh ? `请在浏览器打开：${DEPLOY_DOC_URL}` : `Open in your browser: ${DEPLOY_DOC_URL}`, "info");
          }
          return;
        }
        // R9 → R20 SEC P1-01：登出走有序状态机（runDesktopLogout：①服务端登出 ②清 Rust 壳层令牌
        // ③清本地→广播→reload）。服务端失败即停并渲可见错误+可重试，绝不吞错伪装成功。见文件上方状态机注释。
        if (target.closest("[data-set-logout]")) {
          runLogoutFlow({ force: false });
          return;
        }
        // 失败面板上的按钮：重试（force 由阶段编码在 data-logout-force）/ 仍要本地退出（服务端不可达兜底，force=true）。
        const logoutRetry = target.closest<HTMLElement>("[data-set-logout-retry]");
        if (logoutRetry) {
          runLogoutFlow({ force: logoutRetry.dataset.logoutForce === "true" });
          return;
        }
        if (target.closest("[data-set-logout-local]")) {
          runLogoutFlow({ force: true });
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
          setAvatarStatus(spotlightViewsT(ctx.locale, "removing"));
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
              setAvatarStatus(spotlightViewsT(ctx.locale, "avatarRemoved"));
            })
            .catch(() => {
              if (disposed) return;
              setAvatarStatus(spotlightViewsT(ctx.locale, "failedToRemovePleaseTryAgain"));
            });
          return;
        }
        const loc = target.closest<HTMLElement>("[data-set-locale]");
        if (loc?.dataset.setLocale && loc.dataset.sel !== "true") {
          const next = loc.dataset.setLocale;
          ctx.toast(spotlightViewsT(ctx.locale, "switchingLanguage"), "info");
          try {
            window.localStorage.setItem(storageKey, next);
          } catch {
            // ignore storage failure
          }
          void ctx.client
            .updatePreferences({ locale: next as "zh-CN" | "en-US" })
            .then(() => {
              // D1（R19-13 托盘语言联动补线）：webview 切语言成功后要把新 locale 同步给原生外壳
              // （托盘菜单/tooltip/通知兜底文案），否则那些地方永远停在启动语言——见 set_shell_locale
              // 顶部注释。best-effort、fire-and-forget：非 Tauri 环境（web/测试）没有 invoke 时直接
              // 跳过，绝不阻塞 reload。
              const invokeShell = resolveDesktopTauriInvoke();
              if (invokeShell) {
                void Promise.resolve(invokeShell("set_shell_locale", { locale: next })).catch(() => undefined);
              }
              window.location.reload();
            })
            .catch(() => ctx.toast(spotlightViewsT(ctx.locale, "failedRetry2"), "error"));
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
          setAvatarStatus(spotlightViewsT(ctx.locale, "uploading2"));
          try {
            await ctx.client.request(AVATAR_PATH, {
              method: "PUT",
              headers: { "Content-Type": blob.type || "application/octet-stream" },
              body: blob
            });
            if (disposed) return;
            setAvatarStatus(spotlightViewsT(ctx.locale, "avatarUpdated"));
            hydrateAvatarPreview();
          } catch {
            if (disposed) return;
            setAvatarStatus(spotlightViewsT(ctx.locale, "uploadFailedPleaseTryAgain"));
          }
        });
      });

      // —— "我的资料"分区：自由文本字段用 focusout（离开字段时才触发，不是逐字符的 input）保存 ——
      // 同一份 innerHTML 全量重绘架构下，input 事件会在用户还在打字时就把 DOM 重建掉，打断输入焦点；
      // focusout 本身就意味着用户已经离开这个字段，这时候重绘不会有体验代价（同 AI 分区的按钮点击
      // 场景一样，都是"交互已经结束才重绘"）。focusout 会冒泡（blur 不会），所以能用同一个委托监听器。
      ctx.body.addEventListener("focusout", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        // R23 F-02：新增/调整策略表单的三个自由文本字段——同"我的资料"字段一样走 focusout（不重渲，
        // 只把值收进状态变量，submitPolicyForm 提交时才读取；不依赖 profile 是否加载成功，
        // 独立于下面 `if (!profile) return` 之前判定）。
        const scopeIdInput = target.closest<HTMLInputElement>("[data-set-policy-scope-id]");
        if (scopeIdInput) {
          policyFormScopeId = scopeIdInput.value;
          return;
        }
        const actionPatternInput = target.closest<HTMLInputElement>("[data-set-policy-action-pattern]");
        if (actionPatternInput) {
          policyFormActionPattern = actionPatternInput.value;
          return;
        }
        const priorityInput = target.closest<HTMLInputElement>("[data-set-policy-priority]");
        if (priorityInput) {
          policyFormPriority = priorityInput.value;
          return;
        }
        // R24-P 阶段 1：插件安装路径——同款 focusout 收值（不重渲，submitPluginInstall 提交时才读）。
        const pluginPathInput = target.closest<HTMLInputElement>("[data-set-plugin-install-path]");
        if (pluginPathInput) {
          pluginInstallPath = pluginPathInput.value;
          return;
        }
        // R26 M7：MCP 添加表单的自由文本字段——同款 focusout 收值（不重渲，submitMcpAdd 提交时才读）。
        // 密钥引用的下拉也走 focusout：点「加一条」时浏览器先派 focusout 再派 click（同上面插件路径
        // 那条依赖的顺序），所以按钮读到的一定是刚选中的那个值。
        for (const field of MCP_FORM_TEXT_FIELDS) {
          const input = target.closest<HTMLInputElement>(field.selector);
          if (input) {
            mcpForm = field.assign(mcpForm, input.value);
            if (field.rerender) {
              renderAll();
            }
            return;
          }
        }
        // 每行的调用超时：离开字段即保存（值没变就什么都不做，见 setMcpTimeout）。
        const mcpTimeoutInput = target.closest<HTMLInputElement>("[data-set-mcp-timeout]");
        if (mcpTimeoutInput?.dataset.setMcpTimeout) {
          const server = mcpServerFor(mcpTimeoutInput.dataset.setMcpTimeout);
          if (server) {
            setMcpTimeout(server, mcpTimeoutInput.value);
          }
          return;
        }
        if (!profile) return;
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
        clearPluginArm();
        clearPolicyRevokeArm();
        clearDeviceRevokeArm();
        clearRevokeCurrentDeviceArm();
        revokeAvatarObjectUrl();
      };
    }
  };
}
