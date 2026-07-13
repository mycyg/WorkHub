// WorkHub 桌面 · 工作台「项目设置」（AI 治理）——纯渲染层（照 drive/render.ts 与 chat/render.ts 的
// 分工：这里全是可单测的纯函数，DOM 事件/数据请求在 view.ts）。
//
// R13 批 P3（功能审查 B3）：项目治理四项（观察者开关/静默窗口秒数/安静时段/Granular 能力开关）此前
// 桌面端零代码路径。表单只对项目负责人可编辑（editable=vm.viewer.is_project_owner）；非负责人渲染
// 同一布局的只读态（控件不带 data-* 钩子、不给 cursor:pointer，04 §4 铁律 3：看起来能点的必须真能点）。
// 注意服务端读取也是负责人独占（packages/db/src/repositories/ai-settings.ts 的
// activeProjectOwnerCondition 把 GET 也锁在 owner 上），所以非负责人实际连数据都拿不到——view.ts 对
// 404 渲染 renderProjectSettingsOwnerOnlyHtml 的诚实说明，而不是假装有一份只读数据。

import type { AiGranularSettings, AiQuietHours, ProjectAiGovernanceVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

type Locale = "zh-CN" | "en-US";

// —— 分钟 <-> HH:MM 换算（quiet_hours 的 start_minute/end_minute 是 0-1439 的当日分钟数）—— //

export function minuteToHhmm(minute: number): string {
  const clamped = Math.min(1439, Math.max(0, Math.trunc(minute)));
  const hh = String(Math.trunc(clamped / 60)).padStart(2, "0");
  const mm = String(clamped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function hhmmToMinute(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh > 23 || mm > 59) {
    return undefined;
  }
  return hh * 60 + mm;
}

type GranularKey = keyof AiGranularSettings;
export const PROJECT_GRANULAR_KEYS: readonly GranularKey[] = [
  "create_work_item",
  "dispatch_run",
  "mutate_drive",
  "send_notification"
];

export function projectGranularLabel(key: GranularKey, zh: boolean): string {
  const table: Record<GranularKey, { zh: string; en: string }> = {
    create_work_item: { zh: "建任务", en: "Create tasks" },
    dispatch_run: { zh: "派 run", en: "Dispatch runs" },
    mutate_drive: { zh: "动网盘", en: "Touch drive" },
    send_notification: { zh: "发通知", en: "Send notifications" }
  };
  return zh ? table[key].zh : table[key].en;
}

// Granular 字段未设置时视为「允许」（服务端默认空对象 = 无限制，见 DEFAULT_PROJECT_AI_GOVERNANCE）。
export function projectGranularEffective(settings: AiGranularSettings | undefined, key: GranularKey): boolean {
  return settings?.[key] !== false;
}

const WEEKDAY_LABELS_ZH = ["日", "一", "二", "三", "四", "五", "六"] as const;
const WEEKDAY_LABELS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function switchHtml(input: { on: boolean; hook: string; hookValue?: string; editable: boolean; label: string }): string {
  const attrs = input.editable
    ? ` ${input.hook}${input.hookValue !== undefined ? `="${escapeHtml(input.hookValue)}"` : ""} role="switch" aria-checked="${input.on}" aria-label="${escapeHtml(input.label)}"`
    : ` disabled role="switch" aria-checked="${input.on}" aria-label="${escapeHtml(input.label)}"`;
  return `<button type="button" class="wh-wb-pset-switch" data-on="${input.on}"${attrs}><span class="wh-wb-pset-knob"></span></button>`;
}

function quietHoursBodyHtml(quiet: AiQuietHours, zh: boolean, editable: boolean): string {
  if (!quiet.enabled) {
    return "";
  }
  const dis = editable ? "" : " disabled";
  const labels = zh ? WEEKDAY_LABELS_ZH : WEEKDAY_LABELS_EN;
  const weekdayChips = labels
    .map((label, index) => {
      const sel = quiet.weekdays.includes(index);
      const hook = editable ? ` data-wb-pset-quiet-weekday="${index}"` : " disabled";
      return `<button type="button" class="wh-wb-pset-day" data-sel="${sel}"${hook}>${escapeHtml(label)}</button>`;
    })
    .join("");
  return `<div class="wh-wb-pset-quiet-body">
    <div class="wh-wb-pset-inline">
      <label class="wh-wb-pset-inline-k">${zh ? "从" : "From"}</label>
      <input type="time" class="wh-wb-pset-time" value="${escapeHtml(minuteToHhmm(quiet.start_minute))}" data-wb-pset-quiet-start${dis} />
      <label class="wh-wb-pset-inline-k">${zh ? "到" : "to"}</label>
      <input type="time" class="wh-wb-pset-time" value="${escapeHtml(minuteToHhmm(quiet.end_minute))}" data-wb-pset-quiet-end${dis} />
    </div>
    <div class="wh-wb-pset-days">${weekdayChips}</div>
    <div class="wh-wb-pset-note">${zh ? "时区" : "Timezone"}: ${escapeHtml(quiet.timezone)}</div>
  </div>`;
}

export function renderProjectSettingsHtml(input: {
  locale: Locale;
  projectName: string;
  governance: ProjectAiGovernanceVM;
  editable: boolean;
  savingSilenceWindow?: boolean;
  errorText?: string | undefined;
}): string {
  const zh = input.locale === "zh-CN";
  const gov = input.governance;
  const dis = input.editable ? "" : " disabled";

  const granularChips = PROJECT_GRANULAR_KEYS.map((key) => {
    const allowed = projectGranularEffective(gov.granular_settings, key);
    const stateText = allowed ? (zh ? "允许" : "allowed") : zh ? "已禁止" : "blocked";
    const hook = input.editable ? ` data-wb-pset-granular="${key}"` : " disabled";
    return `<button type="button" class="wh-wb-pset-chip" data-sel="${!allowed}"${hook}>${escapeHtml(projectGranularLabel(key, zh))} · ${stateText}</button>`;
  }).join("");

  const readOnlyNote = input.editable
    ? ""
    : `<p class="wh-wb-pset-readonly-note">${zh ? "只有项目负责人能修改这些设置。" : "Only the project owner can change these settings."}</p>`;

  const errorRow = input.errorText
    ? `<div class="wh-wb-pset-error" data-wb-pset-error="true">${escapeHtml(input.errorText)}</div>`
    : "";

  return `<div class="wh-wb-pset ds-anim-fade-in">
    <div class="wh-wb-pset-head">
      <h2 class="wh-wb-pset-title">${zh ? "项目设置" : "Project settings"} · ${escapeHtml(input.projectName)}</h2>
      <p class="wh-wb-pset-sub">${
        zh
          ? "AI 治理——只影响这个项目的主区观察者与项目级 AI 行为；个人单聊模式在 设置 · AI 里调。"
          : "AI governance — affects this project's main-chat observer and project-level AI behavior; your personal 1:1 mode lives in Settings · AI."
      }</p>
      ${readOnlyNote}
    </div>
    ${errorRow}
    <section class="wh-wb-pset-group" data-wb-pset-observer-group="true">
      <div class="wh-wb-pset-row">
        <div class="wh-wb-pset-row-main">
          <div class="wh-wb-pset-row-title">${zh ? "静默观察者" : "Silence observer"}</div>
          <div class="wh-wb-pset-row-sub">${zh ? "群聊安静一段时间后，Cuu 自动把讨论里的活拎出来（行动卡）" : "After the chat goes quiet, Cuu pulls actionable work out of the discussion (action cards)"}</div>
        </div>
        ${switchHtml({ on: gov.observer_enabled, hook: "data-wb-pset-observer", editable: input.editable, label: zh ? "静默观察者" : "Silence observer" })}
      </div>
    </section>
    <section class="wh-wb-pset-group" data-wb-pset-silence-group="true">
      <div class="wh-wb-pset-row">
        <div class="wh-wb-pset-row-main">
          <div class="wh-wb-pset-row-title">${zh ? "静默窗口" : "Silence window"}</div>
          <div class="wh-wb-pset-row-sub">${zh ? "聊天停多少秒后观察者开始分析（0-86400）" : "How many quiet seconds before the observer analyzes (0-86400)"}</div>
        </div>
        <div class="wh-wb-pset-inline">
          <input type="number" min="0" max="86400" step="1" class="wh-wb-pset-num" value="${escapeHtml(String(gov.silence_window_seconds))}" data-wb-pset-silence-input${dis} />
          <span class="wh-wb-pset-inline-k">${zh ? "秒" : "s"}</span>
          ${input.editable ? `<button type="button" class="wh-wb-btn" data-wb-pset-silence-save${input.savingSilenceWindow ? " disabled" : ""}>${input.savingSilenceWindow ? (zh ? "保存中…" : "Saving…") : zh ? "保存" : "Save"}</button>` : ""}
        </div>
      </div>
    </section>
    <section class="wh-wb-pset-group" data-wb-pset-quiet-group="true">
      <div class="wh-wb-pset-row">
        <div class="wh-wb-pset-row-main">
          <div class="wh-wb-pset-row-title">${zh ? "安静时段" : "Quiet hours"}</div>
          <div class="wh-wb-pset-row-sub">${zh ? "这段时间里观察者不打扰（不分析、不发行动卡）" : "The observer stays quiet during these hours (no analysis, no action cards)"}</div>
        </div>
        ${switchHtml({ on: gov.quiet_hours.enabled, hook: "data-wb-pset-quiet-toggle", editable: input.editable, label: zh ? "安静时段" : "Quiet hours" })}
      </div>
      ${quietHoursBodyHtml(gov.quiet_hours, zh, input.editable)}
    </section>
    <section class="wh-wb-pset-group" data-wb-pset-granular-group="true">
      <div class="wh-wb-pset-row">
        <div class="wh-wb-pset-row-main">
          <div class="wh-wb-pset-row-title">${zh ? "AI 在这个项目里能做什么" : "What AI can do in this project"}</div>
          <div class="wh-wb-pset-row-sub">${zh ? "按能力细分——禁了的能力观察者不会做" : "Per-capability switches — the observer won't do what's blocked"}</div>
        </div>
      </div>
      <div class="wh-wb-pset-chips">${granularChips}</div>
    </section>
  </div>`;
}

export function renderProjectSettingsLoadingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-loading"><span class="wh-wb-spinner"></span>${zh ? "正在拉项目设置…" : "Loading project settings…"}</div>`;
}

export function renderProjectSettingsErrorHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-error">${zh ? "没拉到这个项目的设置，稍后重试" : "Couldn't load this project's settings — retry"}
    <div style="margin-top:13px"><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-pset-retry>${zh ? "重试" : "Retry"}</button></div>
  </div>`;
}

// 服务端把治理读取也锁在负责人上（见文件顶部注释）——非负责人打开时 GET 404，渲染这份诚实说明，
// 不假装有只读数据可看。
export function renderProjectSettingsOwnerOnlyHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-error" data-wb-pset-owner-only="true">${
    zh ? "这个项目的 AI 治理设置只有项目负责人能查看和修改。" : "Only the project owner can view and change this project's AI governance."
  }</div>`;
}
