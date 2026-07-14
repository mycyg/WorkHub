// WorkHub 桌面 · 工作台「项目设置」（AI 治理）——纯渲染层（照 drive/render.ts 与 chat/render.ts 的
// 分工：这里全是可单测的纯函数，DOM 事件/数据请求在 view.ts）。
//
// R13 批 P3（功能审查 B3）：项目治理四项（观察者开关/静默窗口秒数/安静时段/Granular 能力开关）此前
// 桌面端零代码路径。表单只对项目负责人可编辑（editable=vm.viewer.is_project_owner）；非负责人渲染
// 同一布局的只读态（控件不带 data-* 钩子、不给 cursor:pointer，04 §4 铁律 3：看起来能点的必须真能点）。
// 注意服务端读取也是负责人独占（packages/db/src/repositories/ai-settings.ts 的
// activeProjectOwnerCondition 把 GET 也锁在 owner 上），所以非负责人实际连数据都拿不到——view.ts 对
// 404 渲染 renderProjectSettingsOwnerOnlyHtml 的诚实说明，而不是假装有一份只读数据。

import type { AiGranularSettings, AiQuietHours, ProjectAiGovernanceVM, RiskMonitorSettings } from "@workhub/contracts";
import { DEFAULT_RISK_MONITOR_SETTINGS } from "@workhub/contracts";
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

// —— R14 批 RISK（风险预警巡检，桌面设置分区）——阈值配置读写复用既有 GET/PATCH
// /api/projects/:id/ai-governance（05-risk-design.md §2 拍板：零新增路由，只加 additive
// risk_monitor 字段）。projectAiGovernanceVmSchema.risk_monitor 类型仍是 riskMonitorSettingsSchema
// （每个字段 z.optional()），但读侧服务层已经做了完整默认值合并输出（见 ai-settings.ts 的
// governanceView）——这里的 resolveRiskMonitorForDisplay 只是把 TS 类型上残留的 `| undefined` 兜底掉，
// 不是重新实现一遍合并逻辑，真正的默认值只有一份（DEFAULT_RISK_MONITOR_SETTINGS）。 —— //

// `Required<RiskMonitorSettings>` 不能直接用做「解析完一定有值」的类型标注——riskMonitorSettingsSchema
// 每个字段都是 z.optional()，zod 推导出的属性值类型本身带 `| undefined`（不只是 `?:` 修饰符），
// `Required<T>` 的 `-?` 只去掉可选修饰符，不去掉值类型里显式的 `| undefined`（同
// apps/api/src/services/risk-monitor.ts 的 ResolvedRiskMonitorSettings 踩过的同一个坑，这里单独声明
// 一个「解析后一定有具体值」的本地类型）。
export type ResolvedRiskMonitorSettings = {
  enabled: boolean;
  stall_days_threshold: number;
  deadline_lookahead_days: number;
  cost_spike_ratio_pct: number;
  cost_spike_min_cny: number;
};

export function resolveRiskMonitorForDisplay(risk: RiskMonitorSettings): ResolvedRiskMonitorSettings {
  return {
    enabled: risk.enabled ?? DEFAULT_RISK_MONITOR_SETTINGS.enabled,
    stall_days_threshold: risk.stall_days_threshold ?? DEFAULT_RISK_MONITOR_SETTINGS.stall_days_threshold,
    deadline_lookahead_days: risk.deadline_lookahead_days ?? DEFAULT_RISK_MONITOR_SETTINGS.deadline_lookahead_days,
    cost_spike_ratio_pct: risk.cost_spike_ratio_pct ?? DEFAULT_RISK_MONITOR_SETTINGS.cost_spike_ratio_pct,
    cost_spike_min_cny: risk.cost_spike_min_cny ?? DEFAULT_RISK_MONITOR_SETTINGS.cost_spike_min_cny
  };
}

// 契约边界见 packages/contracts/src/domain/conversation.ts 的 riskMonitorSettingsSchema——四个数值输入
// 各自的 min/max 直接对齐 zod 的 .min()/.max()，跟 view.ts 的客户端校验共用同一组数字（不是这里随手定
// 一套、view.ts 另定一套，两边失焦）。
export const RISK_MONITOR_BOUNDS = {
  stall_days_threshold: { min: 1, max: 90 },
  deadline_lookahead_days: { min: 0, max: 30 },
  cost_spike_ratio_pct: { min: 100, max: 2000 },
  cost_spike_min_cny: { min: 0, max: undefined as number | undefined }
} as const;

// PATCH 的 risk_monitor 是整列替换写（同 granular_settings 口径，packages/db/src/repositories/
// ai-settings.ts 的 riskMonitorJson upsert 条件化 spread）——view.ts 的每一次写（启停开关即改即发 /
// 阈值显式保存）都必须带上全部五个键，不能只发变化的那个，否则会把用户之前设过的其它阈值悄悄清空。
function riskMonitorGroupHtml(risk: RiskMonitorSettings, zh: boolean, editable: boolean, saving: boolean | undefined): string {
  const resolved = resolveRiskMonitorForDisplay(risk);
  const dis = editable ? "" : " disabled";
  const numberRow = (input: {
    hook: string;
    value: number;
    min: number;
    max?: number;
    step?: string;
    label: string;
    unit: string;
  }) =>
    `<div class="wh-wb-risk-set-field"><label class="wh-wb-pset-inline-k">${escapeHtml(input.label)}</label><div class="wh-wb-pset-inline"><input type="number" min="${input.min}"${input.max !== undefined ? ` max="${input.max}"` : ""} step="${input.step ?? "1"}" class="wh-wb-pset-num" value="${escapeHtml(String(input.value))}" ${input.hook}${dis} /><span class="wh-wb-pset-inline-k">${escapeHtml(input.unit)}</span></div></div>`;

  const fields = [
    numberRow({
      hook: "data-wb-risk-stall-input",
      value: resolved.stall_days_threshold,
      min: RISK_MONITOR_BOUNDS.stall_days_threshold.min,
      max: RISK_MONITOR_BOUNDS.stall_days_threshold.max,
      label: zh ? "工单停滞天数阈值" : "Stall threshold",
      unit: zh ? "天" : "days"
    }),
    numberRow({
      hook: "data-wb-risk-deadline-input",
      value: resolved.deadline_lookahead_days,
      min: RISK_MONITOR_BOUNDS.deadline_lookahead_days.min,
      max: RISK_MONITOR_BOUNDS.deadline_lookahead_days.max,
      label: zh ? "deadline 前瞻天数" : "Deadline lookahead",
      unit: zh ? "天" : "days"
    }),
    numberRow({
      hook: "data-wb-risk-cost-ratio-input",
      value: resolved.cost_spike_ratio_pct,
      min: RISK_MONITOR_BOUNDS.cost_spike_ratio_pct.min,
      max: RISK_MONITOR_BOUNDS.cost_spike_ratio_pct.max,
      label: zh ? "成本放量比例" : "Cost spike ratio",
      unit: "%"
    }),
    numberRow({
      hook: "data-wb-risk-cost-min-input",
      value: resolved.cost_spike_min_cny,
      min: RISK_MONITOR_BOUNDS.cost_spike_min_cny.min,
      step: "0.01",
      label: zh ? "成本放量下限" : "Cost spike floor",
      unit: "¥"
    })
  ].join("");

  const saveButton = editable
    ? `<button type="button" class="wh-wb-btn" data-wb-risk-save${saving ? " disabled" : ""}>${saving ? (zh ? "保存中…" : "Saving…") : zh ? "保存阈值" : "Save thresholds"}</button>`
    : "";

  return `<section class="wh-wb-pset-group wh-wb-risk-set" data-wb-pset-risk-group="true">
    <div class="wh-wb-pset-row">
      <div class="wh-wb-pset-row-main">
        <div class="wh-wb-pset-row-title">${zh ? "风险巡检" : "Risk monitor"}</div>
        <div class="wh-wb-pset-row-sub">${zh ? "PM 视角每日巡检——工单停滞、临期未动工、项目成本异常放量，一天一次合并汇报" : "A daily PM-style patrol — stalled work, looming deadlines, cost spikes, merged into one digest a day"}</div>
      </div>
      ${switchHtml({ on: resolved.enabled, hook: "data-wb-risk-enabled", editable, label: zh ? "风险巡检" : "Risk monitor" })}
    </div>
    <div class="wh-wb-risk-set-fields">${fields}</div>
    ${saveButton ? `<div class="wh-wb-pset-inline" style="margin-top:9px">${saveButton}</div>` : ""}
  </section>`;
}

export function renderProjectSettingsHtml(input: {
  locale: Locale;
  projectName: string;
  governance: ProjectAiGovernanceVM;
  editable: boolean;
  savingSilenceWindow?: boolean;
  savingRiskThresholds?: boolean;
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
    ${riskMonitorGroupHtml(gov.risk_monitor, zh, input.editable, input.savingRiskThresholds)}
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
