// WorkHub 桌面 · 工作台「项目设置」（AI 治理）——纯渲染层（照 drive/render.ts 与 chat/render.ts 的
// 分工：这里全是可单测的纯函数，DOM 事件/数据请求在 view.ts）。
//
// R13 批 P3（功能审查 B3）：项目治理四项（观察者开关/静默窗口秒数/安静时段/Granular 能力开关）此前
// 桌面端零代码路径。表单只对项目负责人可编辑（editable=vm.viewer.is_project_owner）；非负责人渲染
// 同一布局的只读态（控件不带 data-* 钩子、不给 cursor:pointer，04 §4 铁律 3：看起来能点的必须真能点）。
// 注意服务端读取也是负责人独占（packages/db/src/repositories/ai-settings.ts 的
// activeProjectOwnerCondition 把 GET 也锁在 owner 上），所以非负责人实际连数据都拿不到——view.ts 对
// 404 渲染 renderProjectSettingsOwnerOnlyHtml 的诚实说明，而不是假装有一份只读数据。

import type {
  AiGranularSettings,
  AiQuietHours,
  GithubActivityKind,
  GithubBindingStatusVM,
  GithubTestConnectionResult,
  ProjectAiGovernanceVM,
  RiskMonitorSettings
} from "@workhub/contracts";
import { DEFAULT_RISK_MONITOR_SETTINGS, PROJECT_INSTRUCTIONS_MAX_CHARS } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { settingsT } from "./locales.js";

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
    dispatch_run: { zh: "派活给 AI", en: "Start AI runs" },
    mutate_drive: { zh: "改网盘文件", en: "Modify drive files" },
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
      <label class="wh-wb-pset-inline-k">${settingsT(zh, "from")}</label>
      <input type="time" class="wh-wb-pset-time" value="${escapeHtml(minuteToHhmm(quiet.start_minute))}" data-wb-pset-quiet-start${dis} />
      <label class="wh-wb-pset-inline-k">${settingsT(zh, "to")}</label>
      <input type="time" class="wh-wb-pset-time" value="${escapeHtml(minuteToHhmm(quiet.end_minute))}" data-wb-pset-quiet-end${dis} />
    </div>
    <div class="wh-wb-pset-days">${weekdayChips}</div>
    <div class="wh-wb-pset-note">${settingsT(zh, "timezone")}: ${escapeHtml(quiet.timezone)}</div>
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
      label: settingsT(zh, "stallThreshold"),
      unit: settingsT(zh, "days")
    }),
    numberRow({
      hook: "data-wb-risk-deadline-input",
      value: resolved.deadline_lookahead_days,
      min: RISK_MONITOR_BOUNDS.deadline_lookahead_days.min,
      max: RISK_MONITOR_BOUNDS.deadline_lookahead_days.max,
      label: settingsT(zh, "deadlineLookahead"),
      unit: settingsT(zh, "days")
    }),
    numberRow({
      hook: "data-wb-risk-cost-ratio-input",
      value: resolved.cost_spike_ratio_pct,
      min: RISK_MONITOR_BOUNDS.cost_spike_ratio_pct.min,
      max: RISK_MONITOR_BOUNDS.cost_spike_ratio_pct.max,
      label: settingsT(zh, "costSpikeRatio"),
      unit: "%"
    }),
    numberRow({
      hook: "data-wb-risk-cost-min-input",
      value: resolved.cost_spike_min_cny,
      min: RISK_MONITOR_BOUNDS.cost_spike_min_cny.min,
      step: "0.01",
      label: settingsT(zh, "costSpikeFloor"),
      unit: "¥"
    })
  ].join("");

  const saveButton = editable
    ? `<button type="button" class="wh-wb-btn" data-wb-risk-save${saving ? " disabled" : ""}>${saving ? (settingsT(zh, "saving")) : settingsT(zh, "saveThresholds")}</button>`
    : "";

  return `<section class="wh-wb-pset-group wh-wb-risk-set" data-wb-pset-risk-group="true">
    <div class="wh-wb-pset-row">
      <div class="wh-wb-pset-row-main">
        <div class="wh-wb-pset-row-title">${settingsT(zh, "riskMonitor")}</div>
        <div class="wh-wb-pset-row-sub">${settingsT(zh, "aDailyPmStylePatrolStalled")}</div>
      </div>
      ${switchHtml({ on: resolved.enabled, hook: "data-wb-risk-enabled", editable, label: settingsT(zh, "riskMonitor") })}
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
    const stateText = allowed ? (settingsT(input.locale, "allowed")) : settingsT(input.locale, "blocked");
    const hook = input.editable ? ` data-wb-pset-granular="${key}"` : " disabled";
    return `<button type="button" class="wh-wb-pset-chip" data-sel="${!allowed}"${hook}>${escapeHtml(projectGranularLabel(key, zh))} · ${stateText}</button>`;
  }).join("");

  const readOnlyNote = input.editable
    ? ""
    : `<p class="wh-wb-pset-readonly-note">${settingsT(input.locale, "onlyTheProjectOwnerCanChange")}</p>`;

  const errorRow = input.errorText
    ? `<div class="wh-wb-pset-error" data-wb-pset-error="true">${escapeHtml(input.errorText)}</div>`
    : "";

  return `<div class="wh-wb-pset ds-anim-fade-in">
    <div class="wh-wb-pset-head">
      <h2 class="wh-wb-pset-title">${settingsT(input.locale, "projectSettings")} · ${escapeHtml(input.projectName)}</h2>
      <p class="wh-wb-pset-sub">${
        settingsT(input.locale, "aiGovernanceAffectsThisProjectS")
      }</p>
      ${readOnlyNote}
    </div>
    ${errorRow}
    <section class="wh-wb-pset-group" data-wb-pset-observer-group="true">
      <div class="wh-wb-pset-row">
        <div class="wh-wb-pset-row-main">
          <div class="wh-wb-pset-row-title">${settingsT(input.locale, "silenceObserver")}</div>
          <div class="wh-wb-pset-row-sub">${settingsT(input.locale, "afterTheChatGoesQuietCuu")}</div>
        </div>
        ${switchHtml({ on: gov.observer_enabled, hook: "data-wb-pset-observer", editable: input.editable, label: settingsT(input.locale, "silenceObserver") })}
      </div>
    </section>
    <section class="wh-wb-pset-group" data-wb-pset-silence-group="true">
      <div class="wh-wb-pset-row">
        <div class="wh-wb-pset-row-main">
          <div class="wh-wb-pset-row-title">${settingsT(input.locale, "silenceWindow")}</div>
          <div class="wh-wb-pset-row-sub">${settingsT(input.locale, "howManyQuietSecondsBeforeThe")}</div>
        </div>
        <div class="wh-wb-pset-inline">
          <input type="number" min="0" max="86400" step="1" class="wh-wb-pset-num" value="${escapeHtml(String(gov.silence_window_seconds))}" data-wb-pset-silence-input${dis} />
          <span class="wh-wb-pset-inline-k">${settingsT(input.locale, "s")}</span>
          ${input.editable ? `<button type="button" class="wh-wb-btn" data-wb-pset-silence-save${input.savingSilenceWindow ? " disabled" : ""}>${input.savingSilenceWindow ? (settingsT(input.locale, "saving")) : settingsT(input.locale, "save")}</button>` : ""}
        </div>
      </div>
    </section>
    <section class="wh-wb-pset-group" data-wb-pset-quiet-group="true">
      <div class="wh-wb-pset-row">
        <div class="wh-wb-pset-row-main">
          <div class="wh-wb-pset-row-title">${settingsT(input.locale, "quietHours")}</div>
          <div class="wh-wb-pset-row-sub">${settingsT(input.locale, "theObserverStaysQuietDuringThese")}</div>
        </div>
        ${switchHtml({ on: gov.quiet_hours.enabled, hook: "data-wb-pset-quiet-toggle", editable: input.editable, label: settingsT(input.locale, "quietHours") })}
      </div>
      ${quietHoursBodyHtml(gov.quiet_hours, zh, input.editable)}
    </section>
    <section class="wh-wb-pset-group" data-wb-pset-granular-group="true">
      <div class="wh-wb-pset-row">
        <div class="wh-wb-pset-row-main">
          <div class="wh-wb-pset-row-title">${settingsT(input.locale, "whatAiCanDoInThis")}</div>
          <div class="wh-wb-pset-row-sub">${settingsT(input.locale, "perCapabilitySwitchesTheObserverWon")}</div>
        </div>
      </div>
      <div class="wh-wb-pset-chips">${granularChips}</div>
    </section>
    ${riskMonitorGroupHtml(gov.risk_monitor, zh, input.editable, input.savingRiskThresholds)}
  </div>`;
}

// —— R17 批 G1（#2 兑现「项目设置里调成员」的承诺）：项目成员分区 ——
// 拍板 A（项目成员=会话参与者的可管理化）下，这个分区是「概览 + 跳转」而非独立成员数据层：
//   * 主区 = 全员（工作区所有成员都能进主区群聊）——诚实说明，不摆一份假的「项目成员名单」；
//   * 该项目各协同会话概览（会话名 + 跳到该会话成员条管理）——加人/退群/移出在会话成员条里操作。
// 数据由 shell 从已就绪的 workbench VM 直接传入（全员数 + collab 会话列表），本分区不额外取数。
export type ProjectMembersOverview = {
  totalMembers: number;
  collabConversations: ReadonlyArray<{ id: string; title: string }>;
};

export function renderProjectMembersSectionHtml(input: {
  locale: Locale;
  overview: ProjectMembersOverview;
}): string {
  const zh = input.locale === "zh-CN";
  const { totalMembers, collabConversations } = input.overview;
  const mainRow = `<div class="wh-wb-pset-row">
    <div class="wh-wb-pset-row-main">
      <div class="wh-wb-pset-row-title">${settingsT(input.locale, "mainChatEveryone")}</div>
      <div class="wh-wb-pset-row-sub">${
        zh
          ? `工作区全部 ${totalMembers} 名成员都能进主区群聊，无需单独拉人。`
          : `All ${totalMembers} workspace members can join the main chat — no invite needed.`
      }</div>
    </div>
  </div>`;
  const collabRows = collabConversations.length
    ? collabConversations
        .map(
          (conversation) => `<div class="wh-wb-pset-row">
      <div class="wh-wb-pset-row-main">
        <div class="wh-wb-pset-row-title">${escapeHtml(conversation.title)}</div>
        <div class="wh-wb-pset-row-sub">${settingsT(input.locale, "collabChatAddOrRemoveMembers")}</div>
      </div>
      <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-pset-open-conversation="${escapeHtml(
        conversation.id
      )}">${settingsT(input.locale, "manageMembers")}</button>
    </div>`
        )
        .join("")
    : `<p class="wh-wb-pset-readonly-note">${
        settingsT(input.locale, "noCollabChatsYetCreateOne")
      }</p>`;
  return `<section class="wh-wb-pset-group" data-wb-pset-members-section="true">
    <div class="wh-wb-pset-row">
      <div class="wh-wb-pset-row-main">
        <div class="wh-wb-pset-row-title">${settingsT(input.locale, "members")}</div>
        <div class="wh-wb-pset-row-sub">${
          settingsT(input.locale, "whoSInThisProjectThe")
        }</div>
      </div>
    </div>
    ${mainRow}
    ${collabRows}
  </section>`;
}

export function renderProjectSettingsLoadingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-loading"><span class="wh-wb-spinner"></span>${settingsT(locale, "loadingProjectSettings")}</div>`;
}

export function renderProjectSettingsErrorHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-error">${settingsT(locale, "couldnTLoadThisProjectS")}
    <div style="margin-top:13px"><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-pset-retry>${settingsT(locale, "retry")}</button></div>
  </div>`;
}

// 服务端把治理读取也锁在负责人上（见文件顶部注释）——非负责人打开时 GET 404，渲染这份诚实说明，
// 不假装有只读数据可看。
export function renderProjectSettingsOwnerOnlyHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-error" data-wb-pset-owner-only="true">${
    settingsT(locale, "onlyTheProjectOwnerCanView")
  }</div>`;
}

// —— R14 批 GH（07-gh-design.md §3 UI 节）：GitHub 绑定卡——独立分区，独立状态机（GET 是项目可见者
// 皆可读，写/测试/解绑收紧到 owner-only，与上方 AI 治理的"读也锁负责人"不是同一权限口径，所以这个
// 分区必须有自己的加载态，不能挂在 governance 的 loadState 上）。纯渲染，DOM 事件在 view.ts。 —— //

function githubDateTime(iso: string | undefined): string | undefined {
  if (!iso) {
    return undefined;
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u.exec(iso);
  return match ? `${match[1]} ${match[2]}` : iso;
}

function githubActivityKindLabel(kind: GithubActivityKind, zh: boolean): string {
  switch (kind) {
    case "commit":
      return settingsT(zh, "commit");
    case "pull_request":
      return "PR";
    case "issue":
      return settingsT(zh, "issue");
    default:
      return kind;
  }
}

function githubBoundStatusFieldsHtml(status: GithubBindingStatusVM, zh: boolean): string {
  const visibilityPill =
    status.repo_private === undefined
      ? ""
      : `<span class="wh-wb-pset-chip" data-sel="false">${escapeHtml(status.repo_private ? (settingsT(zh, "private")) : settingsT(zh, "public"))}</span>`;
  const syncedAt = githubDateTime(status.last_synced_at);
  const syncedLine = syncedAt
    ? (zh ? `最近同步 ${syncedAt}` : `Last synced ${syncedAt}`)
    : settingsT(zh, "notSyncedYet");
  const activityLine =
    status.activity_count_7d === undefined
      ? ""
      : `<div class="wh-wb-pset-note" data-wb-gh-activity-7d="${escapeHtml(String(status.activity_count_7d))}">${escapeHtml(
          zh ? `近 7 天活动 ${status.activity_count_7d} 条` : `${status.activity_count_7d} activity item${status.activity_count_7d === 1 ? "" : "s"} in the last 7 days`
        )}</div>`;
  const errorLine = status.last_error
    ? `<div class="wh-wb-pset-error" data-wb-gh-last-error="true">${escapeHtml(
        zh
          ? `最近一次同步失败${githubDateTime(status.last_error_at) ? `（${githubDateTime(status.last_error_at)}）` : ""}：${status.last_error}`
          : `Last sync failed${githubDateTime(status.last_error_at) ? ` (${githubDateTime(status.last_error_at)})` : ""}: ${status.last_error}`
      )}</div>`
    : "";
  return `<div class="wh-wb-pset-gh-status" data-wb-gh-repo="${escapeHtml(status.repo_full_name ?? "")}">
    <div class="wh-wb-pset-row-title">${escapeHtml(status.repo_full_name ?? "")} ${visibilityPill}</div>
    <div class="wh-wb-pset-row-sub">${escapeHtml(syncedLine)}</div>
    ${activityLine}
    ${errorLine}
  </div>`;
}

function githubTestResultHtml(result: GithubTestConnectionResult | undefined, zh: boolean): string {
  if (!result) {
    return "";
  }
  if (result.ok) {
    const bits = [
      settingsT(zh, "connectionSucceeded"),
      result.repo_full_name,
      result.repo_default_branch ? (zh ? `默认分支 ${result.repo_default_branch}` : `default branch ${result.repo_default_branch}`) : undefined,
      result.repo_private === undefined ? undefined : result.repo_private ? (settingsT(zh, "privateRepo")) : settingsT(zh, "publicRepo")
    ].filter((part): part is string => Boolean(part));
    return `<div class="wh-wb-pset-note" data-wb-gh-test-result="ok">${escapeHtml(bits.join(" · "))}</div>`;
  }
  return `<div class="wh-wb-pset-error" data-wb-gh-test-result="fail">${escapeHtml(result.error ?? (settingsT(zh, "connectionFailed")))}</div>`;
}

function githubFormHtml(input: {
  zh: boolean;
  formRepo: string;
  formPat: string;
  saving: boolean;
  testPending: boolean;
  testResult?: GithubTestConnectionResult | undefined;
  errorText?: string | undefined;
  showCancel: boolean;
}): string {
  const busy = input.saving || input.testPending;
  const dis = busy ? " disabled" : "";
  const zh = input.zh;
  const errorRow = input.errorText
    ? `<div class="wh-wb-pset-error" data-wb-gh-form-error="true">${escapeHtml(input.errorText)}</div>`
    : "";
  return `<form class="wh-wb-pset-gh-form" data-wb-gh-form="true">
    <label class="wh-wb-pset-inline-k" for="wh-wb-gh-repo-input">${settingsT(zh, "repositoryOwnerRepo")}</label>
    <input id="wh-wb-gh-repo-input" class="wh-wb-pset-text" type="text" placeholder="octocat/Hello-World" value="${escapeHtml(input.formRepo)}" data-wb-gh-repo-input${dis} />
    <label class="wh-wb-pset-inline-k" for="wh-wb-gh-pat-input">Personal Access Token</label>
    <input id="wh-wb-gh-pat-input" class="wh-wb-pset-text" type="password" placeholder="ghp_..." value="${escapeHtml(input.formPat)}" data-wb-gh-pat-input${dis} autocomplete="off" />
    <p class="wh-wb-pset-note">${settingsT(zh, "usedOnlyToTestTheConnection")}</p>
    ${errorRow}
    ${githubTestResultHtml(input.testResult, zh)}
    <div class="wh-wb-pset-gh-actions">
      <button type="button" class="wh-wb-btn" data-wb-gh-test${dis}>${input.testPending ? (settingsT(zh, "testing")) : settingsT(zh, "testConnection")}</button>
      <button type="button" class="wh-wb-btn wh-wb-btn--primary" data-wb-gh-submit${dis}>${input.saving ? (settingsT(zh, "saving")) : settingsT(zh, "linkRepository")}</button>
      ${input.showCancel ? `<button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-gh-cancel${dis}>${settingsT(zh, "cancel")}</button>` : ""}
    </div>
  </form>`;
}

export function renderGithubBindingSectionHtml(input: {
  locale: Locale;
  editable: boolean;
  loadState: "loading" | "ready" | "error";
  status?: GithubBindingStatusVM | undefined;
  mode: "status" | "form";
  formRepo: string;
  formPat: string;
  saving: boolean;
  testPending: boolean;
  testResult?: GithubTestConnectionResult | undefined;
  unbindArmed: boolean;
  errorText?: string | undefined;
}): string {
  const zh = input.locale === "zh-CN";
  const head = `<div class="wh-wb-pset-row">
    <div class="wh-wb-pset-row-main">
      <div class="wh-wb-pset-row-title">${settingsT(input.locale, "githubIntegration")}</div>
      <div class="wh-wb-pset-row-sub">${
        settingsT(input.locale, "linkThisProjectToAGithub")
      }</div>
    </div>
  </div>`;

  if (input.loadState === "loading") {
    return `<section class="wh-wb-pset-group" data-wb-gh-section="true" data-wb-gh-loading="true">
      ${head}
      <div class="wh-wb-pset-gh-loading-row"><span class="wh-wb-spinner"></span>${settingsT(input.locale, "loadingTheGithubBinding")}</div>
    </section>`;
  }
  if (input.loadState === "error" || !input.status) {
    return `<section class="wh-wb-pset-group" data-wb-gh-section="true" data-wb-gh-error="true">
      ${head}
      <p class="wh-wb-pset-error">${settingsT(input.locale, "couldnTLoadTheGithubBinding")}</p>
      <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-gh-retry>${settingsT(input.locale, "retry")}</button>
    </section>`;
  }

  const status = input.status;
  const readonlyNote = input.editable
    ? ""
    : `<p class="wh-wb-pset-readonly-note">${settingsT(input.locale, "onlyTheProjectOwnerCanManage")}</p>`;

  if (!input.editable) {
    // 非负责人：只读态——已绑定显示状态字段，未绑定显示诚实的空说明，两者都不给任何写钩子。
    const body = status.bound
      ? githubBoundStatusFieldsHtml(status, zh)
      : `<p class="wh-wb-pset-note" data-wb-gh-unbound="true">${settingsT(input.locale, "noGithubRepositoryLinkedYet")}</p>`;
    return `<section class="wh-wb-pset-group" data-wb-gh-section="true" data-wb-gh-bound="${escapeHtml(String(status.bound))}">
      ${head}
      ${body}
      ${readonlyNote}
    </section>`;
  }

  if (input.mode === "form") {
    return `<section class="wh-wb-pset-group" data-wb-gh-section="true" data-wb-gh-bound="${escapeHtml(String(status.bound))}" data-wb-gh-mode="form">
      ${head}
      ${githubFormHtml({
        zh,
        formRepo: input.formRepo,
        formPat: input.formPat,
        saving: input.saving,
        testPending: input.testPending,
        testResult: input.testResult,
        errorText: input.errorText,
        showCancel: true
      })}
    </section>`;
  }

  if (!status.bound) {
    return `<section class="wh-wb-pset-group" data-wb-gh-section="true" data-wb-gh-bound="false" data-wb-gh-mode="status">
      ${head}
      <p class="wh-wb-pset-note" data-wb-gh-unbound="true">${settingsT(input.locale, "noGithubRepositoryLinkedYet")}</p>
      <div class="wh-wb-pset-gh-actions">
        <button type="button" class="wh-wb-btn wh-wb-btn--primary" data-wb-gh-bind-cta>${settingsT(input.locale, "linkAGithubRepository")}</button>
      </div>
    </section>`;
  }

  const unbindLabel = input.unbindArmed
    ? settingsT(input.locale, "confirmUnbind")
    : settingsT(input.locale, "unbind");
  const busy = input.saving || input.testPending;
  return `<section class="wh-wb-pset-group" data-wb-gh-section="true" data-wb-gh-bound="true" data-wb-gh-mode="status">
    ${head}
    ${githubBoundStatusFieldsHtml(status, zh)}
    ${input.errorText ? `<div class="wh-wb-pset-error" data-wb-gh-form-error="true">${escapeHtml(input.errorText)}</div>` : ""}
    ${githubTestResultHtml(input.testResult, zh)}
    <div class="wh-wb-pset-gh-actions">
      <button type="button" class="wh-wb-btn" data-wb-gh-retest${busy ? " disabled" : ""}>${input.testPending ? (settingsT(input.locale, "testing")) : settingsT(input.locale, "testConnectionAgain")}</button>
      <button type="button" class="wh-wb-btn" data-wb-gh-edit-cta${busy ? " disabled" : ""}>${settingsT(input.locale, "changeRepoPat")}</button>
      <button type="button" class="wh-wb-btn wh-wb-btn--ghost${input.unbindArmed ? " wh-wb-pset-gh-unbind--armed" : ""}" data-wb-gh-unbind${busy ? " disabled" : ""}>${unbindLabel}</button>
    </div>
  </section>`;
}

// —— R16 批 W4b1（项目自定义指令 · 桌面 UI）：项目设置里的第三个独立分区——同 GH 绑定卡一个道理，
// 后端 GET/PATCH /api/projects/:id/instructions（apps/api/src/services/project-instructions.ts）的
// 权限门是 canManageProjectDrive（跟 GH 写路径同一道守卫，见该服务顶部注释），GET 也锁在这道门后面
// （不像 governance 的"读锁负责人"，也不像 GH 的"读放开、写收紧"——这里读写同一道门），所以只有两种
// 加载结局：拿到数据（编辑态由 input.editable 控制是否渲可写 textarea）或者 403/其它错误。403 时不
// 渲任何"看起来能编辑"的假象——直接整个分区收成只读说明（04 §4 铁律 3）。纯渲染，DOM 事件在 view.ts。 —— //

export type ProjectInstructionsSectionLoadState = "loading" | "ready" | "forbidden" | "error";
export type ProjectInstructionsSaveErrorKind = "validation" | "network";

// 4000 字符是后端 trim 后的硬上限（PROJECT_INSTRUCTIONS_MAX_CHARS，同 packages/contracts 那份数字，
// 不是这里另定一套）；90% 处开始给警示色，纯前端体验提示，不是契约边界。
const PROJECT_INSTRUCTIONS_WARN_RATIO = 0.9;

export function projectInstructionsCounterState(length: number): "normal" | "warn" | "over" {
  if (length > PROJECT_INSTRUCTIONS_MAX_CHARS) {
    return "over";
  }
  if (length >= Math.round(PROJECT_INSTRUCTIONS_MAX_CHARS * PROJECT_INSTRUCTIONS_WARN_RATIO)) {
    return "warn";
  }
  return "normal";
}

export function renderProjectInstructionsSectionHtml(input: {
  locale: Locale;
  editable: boolean;
  loadState: ProjectInstructionsSectionLoadState;
  // 当前 textarea 里应该显示的内容——挂载时=GET 回来的 instructions_md，失焦保存尝试之后（无论成功/
  // 失败）都同步成用户刚敲的内容，绝不在保存失败时悄悄替换回旧值把用户的输入吞掉（见 view.ts
  // attemptSaveFromTextarea 顶部注释）。
  draft: string;
  saving: boolean;
  savedPillVisible: boolean;
  saveErrorKind?: ProjectInstructionsSaveErrorKind | undefined;
  saveErrorText?: string | undefined;
}): string {
  const zh = input.locale === "zh-CN";
  const savedPill = input.loadState === "ready" && input.savedPillVisible
    ? `<span class="wh-wb-pset-saved-pill ds-anim-pop" data-wb-instr-saved-pill="true">${settingsT(input.locale, "saved")}</span>`
    : "";
  const head = `<div class="wh-wb-pset-row">
    <div class="wh-wb-pset-row-main">
      <div class="wh-wb-pset-row-title">${settingsT(input.locale, "customInstructions")}</div>
      <div class="wh-wb-pset-row-sub">${
        settingsT(input.locale, "everyCuuConversationAndAgentRun")
      }</div>
    </div>
    ${savedPill}
  </div>`;

  if (input.loadState === "loading") {
    return `<section class="wh-wb-pset-group" data-wb-instr-section="true" data-wb-instr-state="loading">
      ${head}
      <div class="wh-wb-pset-gh-loading-row"><span class="wh-wb-spinner"></span>${settingsT(input.locale, "loadingCustomInstructions")}</div>
    </section>`;
  }

  if (input.loadState === "forbidden") {
    return `<section class="wh-wb-pset-group" data-wb-instr-section="true" data-wb-instr-state="forbidden">
      ${head}
      <p class="wh-wb-pset-readonly-note" data-wb-instr-forbidden="true">${
        settingsT(input.locale, "youNeedProjectManagementPermissionTo")
      }</p>
    </section>`;
  }

  if (input.loadState === "error") {
    return `<section class="wh-wb-pset-group" data-wb-instr-section="true" data-wb-instr-state="error">
      ${head}
      <p class="wh-wb-pset-error">${settingsT(input.locale, "couldnTLoadCustomInstructionsRetry")}</p>
      <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-instr-retry-load>${settingsT(input.locale, "retry")}</button>
    </section>`;
  }

  // ready
  if (!input.editable) {
    const body = input.draft
      ? `<pre class="wh-wb-pset-instr-readonly" data-wb-instr-readonly="true">${escapeHtml(input.draft)}</pre>`
      : `<p class="wh-wb-pset-note" data-wb-instr-empty="true">${settingsT(input.locale, "noCustomInstructionsConfiguredYet")}</p>`;
    return `<section class="wh-wb-pset-group" data-wb-instr-section="true" data-wb-instr-state="ready" data-wb-instr-editable="false">
      ${head}
      ${body}
      <p class="wh-wb-pset-readonly-note">${settingsT(input.locale, "onlyTheProjectOwnerCanChange2")}</p>
    </section>`;
  }

  const length = input.draft.length;
  const counterState = projectInstructionsCounterState(length);
  const counterClass = counterState === "over" ? " wh-wb-pset-instr-count--over" : counterState === "warn" ? " wh-wb-pset-instr-count--warn" : "";
  const counter = `<span class="wh-wb-pset-instr-count${counterClass}" data-wb-instr-count="${length}">${length} / ${PROJECT_INSTRUCTIONS_MAX_CHARS}</span>`;

  const placeholder = settingsT(input.locale, "eGReplyInPlainEnglish");

  const errorRow = input.saveErrorText
    ? `<div class="${input.saveErrorKind === "validation" ? "wh-wb-pset-error" : "wh-wb-pset-note"}" data-wb-instr-error="${input.saveErrorKind ?? "generic"}">${escapeHtml(
        input.saveErrorText
      )}${
        input.saveErrorKind === "network"
          ? ` <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-instr-retry-save${input.saving ? " disabled" : ""}>${settingsT(input.locale, "retry")}</button>`
          : ""
      }</div>`
    : "";

  return `<section class="wh-wb-pset-group" data-wb-instr-section="true" data-wb-instr-state="ready" data-wb-instr-editable="true">
    ${head}
    <textarea class="wh-wb-pset-instr-area" data-wb-instr-textarea rows="8" placeholder="${escapeHtml(placeholder)}"${
      input.saving ? " disabled" : ""
    }>${escapeHtml(input.draft)}</textarea>
    <div class="wh-wb-pset-instr-foot">
      ${counter}
      ${input.saving ? `<span class="wh-wb-pset-note" data-wb-instr-saving="true">${settingsT(input.locale, "saving")}</span>` : `<span class="wh-wb-pset-note">${settingsT(input.locale, "savesAutomaticallyWhenYouLeaveThe")}</span>`}
    </div>
    ${errorRow}
  </section>`;
}
