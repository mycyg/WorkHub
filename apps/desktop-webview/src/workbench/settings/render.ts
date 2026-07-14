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
  ProjectAiGovernanceVM
} from "@workhub/contracts";
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
      return zh ? "提交" : "Commit";
    case "pull_request":
      return "PR";
    case "issue":
      return zh ? "议题" : "Issue";
    default:
      return kind;
  }
}

function githubBoundStatusFieldsHtml(status: GithubBindingStatusVM, zh: boolean): string {
  const visibilityPill =
    status.repo_private === undefined
      ? ""
      : `<span class="wh-wb-pset-chip" data-sel="false">${escapeHtml(status.repo_private ? (zh ? "私有" : "Private") : zh ? "公开" : "Public")}</span>`;
  const syncedAt = githubDateTime(status.last_synced_at);
  const syncedLine = syncedAt
    ? (zh ? `最近同步 ${syncedAt}` : `Last synced ${syncedAt}`)
    : zh
      ? "尚未完成过同步"
      : "Not synced yet";
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
      zh ? "连接成功" : "Connection succeeded",
      result.repo_full_name,
      result.repo_default_branch ? (zh ? `默认分支 ${result.repo_default_branch}` : `default branch ${result.repo_default_branch}`) : undefined,
      result.repo_private === undefined ? undefined : result.repo_private ? (zh ? "私有仓库" : "private repo") : zh ? "公开仓库" : "public repo"
    ].filter((part): part is string => Boolean(part));
    return `<div class="wh-wb-pset-note" data-wb-gh-test-result="ok">${escapeHtml(bits.join(" · "))}</div>`;
  }
  return `<div class="wh-wb-pset-error" data-wb-gh-test-result="fail">${escapeHtml(result.error ?? (zh ? "连接失败" : "Connection failed"))}</div>`;
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
    <label class="wh-wb-pset-inline-k" for="wh-wb-gh-repo-input">${zh ? "仓库（owner/repo）" : "Repository (owner/repo)"}</label>
    <input id="wh-wb-gh-repo-input" class="wh-wb-pset-text" type="text" placeholder="octocat/Hello-World" value="${escapeHtml(input.formRepo)}" data-wb-gh-repo-input${dis} />
    <label class="wh-wb-pset-inline-k" for="wh-wb-gh-pat-input">Personal Access Token</label>
    <input id="wh-wb-gh-pat-input" class="wh-wb-pset-text" type="password" placeholder="ghp_..." value="${escapeHtml(input.formPat)}" data-wb-gh-pat-input${dis} autocomplete="off" />
    <p class="wh-wb-pset-note">${zh ? "只用于连接测试与后台同步，绝不会再次显示。" : "Used only to test the connection and sync in the background — it is never shown again."}</p>
    ${errorRow}
    ${githubTestResultHtml(input.testResult, zh)}
    <div class="wh-wb-pset-gh-actions">
      <button type="button" class="wh-wb-btn" data-wb-gh-test${dis}>${input.testPending ? (zh ? "正在测试…" : "Testing…") : zh ? "测试连接" : "Test connection"}</button>
      <button type="button" class="wh-wb-btn wh-wb-btn--primary" data-wb-gh-submit${dis}>${input.saving ? (zh ? "保存中…" : "Saving…") : zh ? "绑定仓库" : "Link repository"}</button>
      ${input.showCancel ? `<button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-gh-cancel${dis}>${zh ? "取消" : "Cancel"}</button>` : ""}
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
      <div class="wh-wb-pset-row-title">${zh ? "GitHub 集成" : "GitHub integration"}</div>
      <div class="wh-wb-pset-row-sub">${
        zh
          ? "把这个项目关联到一个 GitHub 仓库，commit/issue/PR 动态会同步进项目主页。"
          : "Link this project to a GitHub repository — commit/issue/PR activity syncs into the project home page."
      }</div>
    </div>
  </div>`;

  if (input.loadState === "loading") {
    return `<section class="wh-wb-pset-group" data-wb-gh-section="true" data-wb-gh-loading="true">
      ${head}
      <div class="wh-wb-pset-gh-loading-row"><span class="wh-wb-spinner"></span>${zh ? "正在拉 GitHub 绑定状态…" : "Loading the GitHub binding…"}</div>
    </section>`;
  }
  if (input.loadState === "error" || !input.status) {
    return `<section class="wh-wb-pset-group" data-wb-gh-section="true" data-wb-gh-error="true">
      ${head}
      <p class="wh-wb-pset-error">${zh ? "GitHub 绑定状态没拉到，稍后重试" : "Couldn't load the GitHub binding — retry"}</p>
      <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-gh-retry>${zh ? "重试" : "Retry"}</button>
    </section>`;
  }

  const status = input.status;
  const readonlyNote = input.editable
    ? ""
    : `<p class="wh-wb-pset-readonly-note">${zh ? "只有项目负责人能管理 GitHub 绑定。" : "Only the project owner can manage the GitHub binding."}</p>`;

  if (!input.editable) {
    // 非负责人：只读态——已绑定显示状态字段，未绑定显示诚实的空说明，两者都不给任何写钩子。
    const body = status.bound
      ? githubBoundStatusFieldsHtml(status, zh)
      : `<p class="wh-wb-pset-note" data-wb-gh-unbound="true">${zh ? "还没有关联 GitHub 仓库。" : "No GitHub repository linked yet."}</p>`;
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
      <p class="wh-wb-pset-note" data-wb-gh-unbound="true">${zh ? "还没有关联 GitHub 仓库。" : "No GitHub repository linked yet."}</p>
      <div class="wh-wb-pset-gh-actions">
        <button type="button" class="wh-wb-btn wh-wb-btn--primary" data-wb-gh-bind-cta>${zh ? "绑定 GitHub 仓库" : "Link a GitHub repository"}</button>
      </div>
    </section>`;
  }

  const unbindLabel = input.unbindArmed
    ? zh
      ? "确认解绑？"
      : "Confirm unbind?"
    : zh
      ? "解绑"
      : "Unbind";
  const busy = input.saving || input.testPending;
  return `<section class="wh-wb-pset-group" data-wb-gh-section="true" data-wb-gh-bound="true" data-wb-gh-mode="status">
    ${head}
    ${githubBoundStatusFieldsHtml(status, zh)}
    ${input.errorText ? `<div class="wh-wb-pset-error" data-wb-gh-form-error="true">${escapeHtml(input.errorText)}</div>` : ""}
    ${githubTestResultHtml(input.testResult, zh)}
    <div class="wh-wb-pset-gh-actions">
      <button type="button" class="wh-wb-btn" data-wb-gh-retest${busy ? " disabled" : ""}>${input.testPending ? (zh ? "正在测试…" : "Testing…") : zh ? "重新测试连接" : "Test connection again"}</button>
      <button type="button" class="wh-wb-btn" data-wb-gh-edit-cta${busy ? " disabled" : ""}>${zh ? "更换仓库 / PAT" : "Change repo / PAT"}</button>
      <button type="button" class="wh-wb-btn wh-wb-btn--ghost${input.unbindArmed ? " wh-wb-pset-gh-unbind--armed" : ""}" data-wb-gh-unbind${busy ? " disabled" : ""}>${unbindLabel}</button>
    </div>
  </section>`;
}
