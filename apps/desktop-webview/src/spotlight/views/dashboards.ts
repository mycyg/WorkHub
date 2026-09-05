// WorkHub 桌面 · Spotlight 只读/检索类能力内联视图（S5/S7/S9/S10）：项目 · 成本 · 团队日历 · 知识检索。
// 统一玻璃风，复用 client.listProjects / pages.cost / pages.calendar / searchKnowledge 数据加载器。
// 这些能力以「看」为主（知识带检索框），故用一个共享的 read-only 装载器；写动作类（网盘/工作项/回放）另立。

import type {
  AgentArmyDashboardPlanVM,
  AgentArmyDashboardVM,
  CalendarPageVM,
  CostDashboardVM,
  EvidenceBubble,
  GithubActivityVM,
  NotificationPageVM,
  TeamSkillsPageVM,
  ProjectHomePageVM,
  ProjectListItemVM,
  ScheduleBlockVM
} from "@workhub/contracts";
import { notificationTypeLabel, uiFormatCny } from "@workhub/ui";
import { escapeHtml, safeHref } from "@workhub/web-runtime";

import type { CommandId } from "../../command-palette.js";
import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";
import { workItemPriorityLabel, workItemStatusLabel } from "../labels.js";

import { spotlightViewsT } from "./locales.js";

function loadingHtml(zh: boolean, label: string): string {
  return `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${escapeHtml(label)}</div>`;
}

// L-01（R24 S3 走查）：几处空态"脸"此前用了 emoji（文件夹/铃铛/日历/放大镜四种）——违反
// 「界面一律不用 emoji」的产品口径。换成内联 SVG（同 command-palette.ts 的线性描边风格，
// stroke=currentColor 继承 .wh-spot-empty-face 的强调色），不新增视觉语言，只是把这几处能力网格
// 里已有的图标语汇挪过来用。
function faceIcon(inner: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
const FACE_ICON_FOLDER = faceIcon('<path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>');
const FACE_ICON_DONE = faceIcon('<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.6 2.6L16 9.3"/>');
const FACE_ICON_BELL = faceIcon('<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2 2 0 0 0 4 0"/>');
const FACE_ICON_CALENDAR = faceIcon('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>');
const FACE_ICON_SEARCH = faceIcon('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/>');

function emptyHtml(face: string, title: string, sub: string): string {
  return `<div class="wh-spot-empty"><div class="wh-spot-empty-face">${face}</div><h3 class="wh-spot-empty-title">${escapeHtml(title)}</h3><p class="wh-spot-empty-sub">${escapeHtml(sub)}</p></div>`;
}

function pctWidth(value: number | undefined): string {
  if (!Number.isFinite(value ?? 0)) {
    return "0";
  }
  return String(Math.max(0, Math.min(100, Math.round(value ?? 0))));
}

function cny(value: string | undefined): string {
  return uiFormatCny(value);
}

function taskPlanRoleLabel(role: AgentArmyDashboardPlanVM["roles"][number]["role"], zh: boolean): string {
  switch (role) {
    case "research":
      return spotlightViewsT(zh, "research");
    case "produce":
      return spotlightViewsT(zh, "produce");
    case "review":
      return spotlightViewsT(zh, "review");
    case "integrate":
      return spotlightViewsT(zh, "integrate");
    default:
      return spotlightViewsT(zh, "subtask");
  }
}

function agentTeamStatusLabel(status: AgentArmyDashboardPlanVM["statuses"][number]["status"], zh: boolean): string {
  switch (status) {
    case "pending":
      return spotlightViewsT(zh, "waiting");
    case "dispatched":
      return spotlightViewsT(zh, "inProgress");
    case "succeeded":
      return spotlightViewsT(zh, "done");
    case "failed":
      return spotlightViewsT(zh, "failed");
    case "needs_human":
      return spotlightViewsT(zh, "needsYou");
    case "skipped":
      return spotlightViewsT(zh, "skipped");
    default:
      return spotlightViewsT(zh, "subtask");
  }
}

function taskPlanStatusLabel(status: AgentArmyDashboardPlanVM["status"], zh: boolean): string {
  switch (status) {
    case "draft":
      return spotlightViewsT(zh, "draft");
    case "proposed":
      return spotlightViewsT(zh, "proposed");
    case "approved":
      return spotlightViewsT(zh, "approved2");
    case "dispatching":
      return spotlightViewsT(zh, "inProgress");
    case "done":
      return spotlightViewsT(zh, "done2");
    case "cancelled":
      return spotlightViewsT(zh, "cancelled");
    default:
      return spotlightViewsT(zh, "taskPlan");
  }
}

function agentArmyCappedCopy(hiddenCount: number, zh: boolean): string {
  if (hiddenCount > 0) {
    return zh
      ? `还有 ${hiddenCount} 个小队未在这里显示，打开工作项查看详情。`
      : `+${hiddenCount} more squads not shown here — open work items for detail.`;
  }
  return spotlightViewsT(zh, "moreSquadsAreNotShownHere");
}

function agentArmyPlanRow(plan: AgentArmyDashboardPlanVM, zh: boolean): string {
  const roles = plan.roles
    .map((role) => `<span class="wh-spot-row-tag">${escapeHtml(`${taskPlanRoleLabel(role.role, zh)} ${role.count}`)}</span>`)
    .join("");
  const statuses = plan.statuses
    .map((status) => `<span class="wh-spot-row-tag">${escapeHtml(`${agentTeamStatusLabel(status.status, zh)} ${status.count}`)}</span>`)
    .join("");
  const blocker = plan.oldest_blocker
    ? `<div class="wh-spot-row-sub">${escapeHtml(plan.oldest_blocker.label)}</div>`
    : "";
  return `<button type="button" class="wh-spot-row" data-open-agent-plan="${escapeHtml(plan.plan_id)}" style="cursor:pointer;width:100%;text-align:left">
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${escapeHtml(plan.work_item_title)}</div>
      <div class="wh-spot-row-sub">${escapeHtml(`${plan.work_item_code} · ${taskPlanStatusLabel(plan.status, zh)} · ${plan.progress.label}`)}</div>
      <div class="wh-spot-row-sub">${roles}${statuses}</div>
      ${blocker}
    </div>
    <div class="wh-spot-row-meta"><span class="wh-spot-row-badge">${escapeHtml(plan.progress.label)}</span><span class="wh-spot-row-metalabel">${escapeHtml(cny(plan.cost.used_cny))}</span></div>
  </button>`;
}

export function agentArmyPlanDetailHtml(plan: AgentArmyDashboardPlanVM, zh: boolean): string {
  const roles = plan.roles
    .map((role) => `<span class="wh-spot-row-tag">${escapeHtml(`${taskPlanRoleLabel(role.role, zh)} ${role.count}`)}</span>`)
    .join("");
  const statuses = plan.statuses
    .map((status) => `<span class="wh-spot-row-tag">${escapeHtml(`${agentTeamStatusLabel(status.status, zh)} ${status.count}`)}</span>`)
    .join("");
  const blocker = plan.oldest_blocker
    ? `<div class="wh-spot-card-actions"><button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-open-capability="approvals">${escapeHtml(spotlightViewsT(zh, "openInbox"))}</button></div><p class="wh-spot-row-sub">${escapeHtml(plan.oldest_blocker.label)}</p>`
    : "";
  return `<div class="wh-spot-dash ds-anim-fade-in" data-spot-agent-plan-detail="${escapeHtml(plan.plan_id)}">
    <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-back-to-agent-armies style="align-self:flex-start">${spotlightViewsT(zh, "backToSquads")}</button>
    <div>
      <div class="wh-spot-row-title" style="font-size:17px">${escapeHtml(plan.work_item_title)}</div>
      <div class="wh-spot-row-sub">${escapeHtml(`${plan.work_item_code} · ${taskPlanStatusLabel(plan.status, zh)} · ${plan.progress.label}`)}</div>
    </div>
    <div class="wh-spot-metrics">
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "progress")}</span><span class="wh-spot-metric-v wh-spot-metric-v--big">${escapeHtml(plan.progress.label)}</span></div>
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "cost")}</span><span class="wh-spot-metric-v">${escapeHtml(`${cny(plan.cost.used_cny)}${plan.cost.budget_cny ? `/${cny(plan.cost.budget_cny)}` : ""}`)}</span></div>
      <div class="wh-spot-metric" aria-label="${escapeHtml(zh ? `复核通过率 ${plan.judge.pass_rate_pct}%` : `Review pass rate ${plan.judge.pass_rate_pct}%`)}"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "reviewPassRate")}</span><span class="wh-spot-metric-v">${escapeHtml(String(plan.judge.pass_rate_pct))}%</span></div>
    </div>
    <div class="wh-spot-bars" aria-hidden="true"><span class="wh-spot-bar" style="height:8px;width:${escapeHtml(pctWidth(plan.cost.burn_pct))}%"></span></div>
    <div class="wh-spot-row-sub">${roles}${statuses}</div>
    ${blocker}
    <div class="wh-spot-card-actions">
      <button type="button" class="wh-spot-act ds-pressable" data-open-workitem="${escapeHtml(plan.work_item_id)}">${escapeHtml(spotlightViewsT(zh, "openWorkItem"))}</button>
    </div>
  </div>`;
}

export function agentArmyDashboardView(vm: AgentArmyDashboardVM, zh: boolean): string {
  const kpis = [
    { id: "active_team_count", label: spotlightViewsT(zh, "activeSquads"), value: String(vm.kpis.active_team_count) },
    { id: "waiting_decision", label: spotlightViewsT(zh, "needsYou2"), value: String(vm.kpis.waiting_decision_count), capability: "approvals" },
    { id: "today_cost", label: spotlightViewsT(zh, "todayCost"), value: cny(vm.kpis.today_cost_cny) },
    { id: "autonomy_rate", label: spotlightViewsT(zh, "autonomy"), value: `${vm.kpis.autonomy_rate_pct}%` }
  ].map((item) => {
    const body = `<span class="wh-spot-metric-k">${escapeHtml(item.label)}</span><span class="wh-spot-metric-v">${escapeHtml(item.value)}</span>`;
    return item.capability
      ? `<button type="button" class="wh-spot-metric" data-spot-agent-kpi="${escapeHtml(item.id)}" data-open-capability="${escapeHtml(item.capability)}">${body}</button>`
      : `<div class="wh-spot-metric" data-spot-agent-kpi="${escapeHtml(item.id)}">${body}</div>`;
  }).join("");
  const shownPlans = vm.plans.slice(0, 5);
  const rows = shownPlans.map((plan) => agentArmyPlanRow(plan, zh)).join("");
  const hiddenCount = Math.max(0, vm.page_info.returned - shownPlans.length);
  const capped = vm.page_info.plans_capped || hiddenCount > 0
    ? `<p class="wh-spot-row-sub" style="text-align:center">${escapeHtml(agentArmyCappedCopy(hiddenCount, zh))}</p>`
    : "";
  const sourceWarnings = vm.source_warnings ?? [];
  const warnings = sourceWarnings.length
    ? `<div class="wh-spot-list" data-spot-agent-source-warnings="${escapeHtml(String(sourceWarnings.length))}">
        ${sourceWarnings.map((warning) => `<div class="wh-spot-row" data-spot-agent-source-warning="${escapeHtml(warning.source)}">
          <div class="wh-spot-row-main">
            <div class="wh-spot-row-title">${escapeHtml(spotlightViewsT(zh, "decisionDataIsPartiallyLoaded"))}</div>
            <div class="wh-spot-row-sub">${escapeHtml(warning.message)}</div>
          </div>
        </div>`).join("")}
      </div>`
    : "";
  const empty = vm.empty_state === "no_agent_armies"
    ? `<div data-spot-agent-dashboard-empty="no_agent_armies">${emptyHtml("Cuu", spotlightViewsT(zh, "noCuuSquadsAreRunningYet"), spotlightViewsT(zh, "nextTimeThereIsALarge"))}<div style="text-align:center"><button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-open-capability="intake">${spotlightViewsT(zh, "newTask")}</button></div></div>`
    : "";
  const recent = vm.recent_escalations.length
    ? `<div class="wh-spot-list">${vm.recent_escalations.map((item) => `<button type="button" class="wh-spot-row" data-open-capability="approvals" style="cursor:pointer;width:100%;text-align:left">
        <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(item.title)}</div><div class="wh-spot-row-sub">${escapeHtml(item.reason_preview)}</div></div>
      </button>`).join("")}</div>`
    : `<p class="wh-spot-row-sub">${escapeHtml(spotlightViewsT(zh, "noRecentSquadDecisions"))}</p>`;
  return `<div class="wh-spot-dash ds-anim-fade-in" data-spot-agent-dashboard="true" data-spot-agent-dashboard-plan-count="${escapeHtml(String(vm.plans.length))}">
    <div>
      <div class="wh-spot-row-title" style="font-size:17px">${escapeHtml(spotlightViewsT(zh, "cuuSSquads"))}</div>
      <div class="wh-spot-row-sub">${escapeHtml(spotlightViewsT(zh, "observeProgressDecisionsStayInThe"))}</div>
    </div>
    <div class="wh-spot-metrics">${kpis}</div>
    ${warnings}
    ${empty}
    ${rows ? `<div class="wh-spot-list ds-stagger">${rows}</div>${capped}` : ""}
    <div class="wh-spot-row-metalabel">${escapeHtml(spotlightViewsT(zh, "recentActivity"))}</div>
    ${recent}
  </div>`;
}

// 共享只读装载器：先渲 loading → 拉数据 → 渲内容（带副标题）；失败渲错误。
function readOnlyView(
  id: CommandId,
  config: {
    loadingLabel: (zh: boolean) => string;
    errorLabel: (zh: boolean) => string;
    load: (ctx: SpotlightViewContext, zh: boolean) => Promise<{ html: string; subtitle: string }>;
    // 可选：处理内容区里的自定义点击（如「项目」行→开网盘、空态 CTA→开派活）。retry 已内置。
    onAction?: (target: HTMLElement, ctx: SpotlightViewContext) => void;
  }
): SpotlightCapabilityView {
  return {
    id,
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      let disposed = false;
      // rank7：装载失败渲带「重试」的错误块，点重试重跑同一装载器（不再是死胡同）。
      const load = async () => {
        ctx.body.innerHTML = loadingHtml(zh, config.loadingLabel(zh));
        ctx.requestResize();
        try {
          const { html, subtitle } = await config.load(ctx, zh);
          if (disposed) return;
          ctx.setSubtitle(subtitle);
          ctx.body.innerHTML = html;
        } catch {
          if (disposed) return;
          ctx.body.innerHTML = spotlightErrorHtml(zh, config.errorLabel(zh));
        }
        ctx.requestResize();
      };
      ctx.body.addEventListener(
        "click",
        (event) => {
          if (!(event.target instanceof HTMLElement)) return;
          if (event.target.closest("[data-spot-retry]")) {
            void load();
            return;
          }
          config.onAction?.(event.target, ctx);
        },
        { signal: ctx.signal }
      );
      void load();
      return () => {
        disposed = true;
      };
    }
  };
}

// —— 项目 —— //
function projectCard(p: ProjectListItemVM, zh: boolean): string {
  const open = p.open_work_item_count;
  const badge = open > 0 ? `<span class="wh-spot-row-badge">${open}</span>` : "";
  // rank14：项目行可点 → 进入该项目网盘（最贴近「项目主页」）。div→button，带 data-open-project。
  return `<button type="button" class="wh-spot-row" data-open-project="${escapeHtml(p.id)}" style="cursor:pointer;width:100%;text-align:left">
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${escapeHtml(p.name)}${p.archived ? `<span class="wh-spot-row-tag">${spotlightViewsT(zh, "archived")}</span>` : ""}</div>
      <div class="wh-spot-row-sub">${escapeHtml(p.description ?? (zh ? `负责人 ${p.owner_nickname}` : `Owner ${p.owner_nickname}`))}</div>
    </div>
    <div class="wh-spot-row-meta">${badge}<span class="wh-spot-row-metalabel">${spotlightViewsT(zh, "open")}</span></div>
  </button>`;
}

// rank14：可点的「新任务」CTA——空态/有项目都给一个去派活的入口（开 intake 能力）。
function newTaskCta(zh: boolean): string {
  return `<button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-open-intake style="align-self:flex-start">${spotlightViewsT(zh, "newTaskAskAi")}</button>`;
}

export function projectListEmptyHtml(zh: boolean): string {
  return `<div class="wh-spot-dash ds-anim-fade-in">${emptyHtml(FACE_ICON_FOLDER, spotlightViewsT(zh, "noProjectsYet"), spotlightViewsT(zh, "createATaskToCreateOne"))}<div style="text-align:center">${newTaskCta(zh)}</div></div>`;
}

// R14 批 GH（07-gh-design.md §5.1）：项目主页 github_activities 区块——GH-B 已把它接进
// ProjectHomePageVM（扁平数组，非富对象；绑定/同步元信息走独立的绑定卡端点，见 workbench/settings）。
// 无绑定/绑定但暂无活动/取数失败三种情况服务端都省略这个字段，故这里只需判空即可诚实不渲区块。
function githubActivityKindLabel(kind: GithubActivityVM["kind"], zh: boolean): string {
  switch (kind) {
    case "commit":
      return spotlightViewsT(zh, "commit");
    case "pull_request":
      return "PR";
    case "issue":
      return spotlightViewsT(zh, "issue");
    default:
      return kind;
  }
}

function githubActivityRow(item: GithubActivityVM, zh: boolean): string {
  const stateTag = item.state ? `<span class="wh-spot-row-tag">${escapeHtml(item.state)}</span>` : "";
  const whenMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u.exec(item.occurred_at);
  const when = whenMatch ? `${whenMatch[1]} ${whenMatch[2]}` : item.occurred_at;
  const meta = [when, item.author_login].filter((part): part is string => Boolean(part)).join(" · ");
  // 桌面 Tauri webview 对外部链接没有承接（target=_blank 点了没反应，同上面知识检索证据行的既有处理：
  // 点击给一句诚实提示，不假装能内联打开 github.com）——照抄那条既有外链模式，不新增打开能力。
  return `<button type="button" class="wh-spot-row" data-open-gh-activity="${escapeHtml(safeHref(item.html_url))}" style="cursor:pointer;width:100%;text-align:left">
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${escapeHtml(item.title)}<span class="wh-spot-row-tag">${escapeHtml(githubActivityKindLabel(item.kind, zh))}</span>${stateTag}</div>
      <div class="wh-spot-row-sub">${escapeHtml(meta)}</div>
    </div>
  </button>`;
}

// 项目主页（list→detail morph）：点项目行 → 在同一盒子内 morph 出该项目的「项目主页」
// （元信息 + 进行中工作清单链工作项 + 新任务/打开网盘入口），镜像 web /projects/:id。盒子随内容生长。
export function projectHomeDetailHtml(vm: ProjectHomePageVM, zh: boolean): string {
  const p = vm.project;
  // DF-1：与 web M5 + /projects 列表卡同口径。summary.open_work_item_count 是「可见且可处理」数;
  // total_open_work_item_count 是全量(含他人私有态)。头条数用全量,与列表卡一致;另标「你可处理 N」。
  const viewableOpen = vm.summary.open_work_item_count;
  const totalOpen = vm.summary.total_open_work_item_count ?? viewableOpen;
  const archived = p.status === "archived" ? `<span class="wh-spot-row-tag">${spotlightViewsT(zh, "archived")}</span>` : "";
  const desc = p.description ? `<p class="wh-spot-row-sub" style="margin-top:4px">${escapeHtml(p.description)}</p>` : "";
  const rows = vm.open_work_items.length
    ? vm.open_work_items
        .map(
          (w) =>
            `<button type="button" class="wh-spot-row" data-open-workitem="${escapeHtml(w.id)}" style="cursor:pointer;width:100%;text-align:left">
        <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(w.title)}</div><div class="wh-spot-row-sub">${escapeHtml(w.code)} · ${escapeHtml(workItemStatusLabel(w.status, zh))} · ${escapeHtml(workItemPriorityLabel(w.priority, zh))}</div></div>
      </button>`
        )
        .join("")
    : emptyHtml(FACE_ICON_DONE, spotlightViewsT(zh, "noOpenWork"), spotlightViewsT(zh, "useNewTaskToCreateWork"));
  // 隐藏量按全量算(曾用可见数自减恒为 0,提示从不出现)。原因可能是列表截断或权限过滤，
  // 当前 VM 无法区分，文案保持中性。
  const hidden = totalOpen - vm.open_work_items.length;
  const moreNote = hidden > 0
    ? `<p class="wh-spot-row-sub" style="text-align:center">${escapeHtml(zh ? `还有 ${hidden} 条进行中工作未在此处显示（可能是列表截断或权限过滤）。` : `+${hidden} more open items are not shown here (list cap or visibility filter).`)}</p>`
    : "";
  // 网盘同步是核心：项目主页直接呈现最近文件（点任意文件/「打开网盘」进完整文件树）。
  const fileRows = vm.drive.recent_files.length
    ? vm.drive.recent_files
        .map(
          (f) =>
            `<button type="button" class="wh-spot-row" data-open-drive="${escapeHtml(p.id)}" data-open-drive-route="${escapeHtml(safeHref(f.href))}" style="cursor:pointer;width:100%;text-align:left">
        <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(f.name)}</div><div class="wh-spot-row-sub">${escapeHtml(f.updated_at.slice(0, 10))} · ${spotlightViewsT(zh, "viewInDrive")}</div></div>
      </button>`
        )
        .join("")
    : `<p class="wh-spot-row-sub">${escapeHtml(spotlightViewsT(zh, "noFilesInTheDriveYet"))}</p>`;
  // DF-3:「最近文件 N」是项目文件总数,但只列 recent_files(≤5)。超出时给「还有 N 未显示」,
  // 否则一堆文件的项目只露几条却显示总数,像把这几条当成全部(web route-components 同款 note)。
  const hiddenFiles = vm.drive.file_count - vm.drive.recent_files.length;
  const filesMoreNote = hiddenFiles > 0 && vm.drive.recent_files.length > 0
    ? `<p class="wh-spot-row-sub" style="text-align:center">${escapeHtml(zh ? `还有 ${hiddenFiles} 个文件未显示，可用「打开网盘」查看完整文件树。` : `+${hiddenFiles} more files not shown here — use Open drive to review the full file tree.`)}</p>`
    : "";
  const filesBlock = `<div class="wh-spot-row-metalabel" style="margin-top:4px">${escapeHtml(zh ? `最近文件 ${vm.drive.file_count}` : `Recent files ${vm.drive.file_count}`)}</div><div class="wh-spot-list">${fileRows}</div>${filesMoreNote}`;
  // 未绑定/绑定但暂无活动/取数失败：服务端三种情况都省略这个字段（诚实缺省），故只有非空数组才渲区块。
  const githubActivities = vm.github_activities ?? [];
  const githubBlock = githubActivities.length
    ? `<div class="wh-spot-row-metalabel" style="margin-top:4px">${escapeHtml(spotlightViewsT(zh, "recentGithubActivity"))}</div><div class="wh-spot-list">${githubActivities.map((item) => githubActivityRow(item, zh)).join("")}</div>`
    : "";
  return `<div class="wh-spot-dash ds-anim-fade-in">
    <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-back-to-projects style="align-self:flex-start">${spotlightViewsT(zh, "backToProjects")}</button>
    <div>
      <div class="wh-spot-row-title" style="font-size:17px">${escapeHtml(p.name)}${archived}</div>
      ${desc}
      <div class="wh-spot-row-sub" style="margin-top:6px">${escapeHtml(p.owner_label)} · ${escapeHtml(totalOpen > viewableOpen ? (zh ? `进行中 ${totalOpen} · 你可处理 ${viewableOpen}` : `${totalOpen} open · you can handle ${viewableOpen}`) : (zh ? `进行中 ${totalOpen}` : `${totalOpen} open`))}</div>
    </div>
    <div class="wh-spot-card-actions">
      <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-open-intake="${escapeHtml(p.id)}" data-open-intake-name="${escapeHtml(p.name)}">${escapeHtml(vm.actions.new_task.label)}</button>
      <button type="button" class="wh-spot-act ds-pressable" data-open-drive="${escapeHtml(p.id)}">${escapeHtml(vm.actions.open_drive.label)}</button>
    </div>
    <div class="wh-spot-list ds-stagger">${rows}</div>
    ${moreNote}
    ${filesBlock}
    ${githubBlock}
  </div>`;
}

export function createProjectsView(): SpotlightCapabilityView {
  return {
    id: "projects",
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      let disposed = false;
      // rank9 式单调代次：切换 list↔detail / 点不同项目时，使在途加载作废，避免错位渲染。
      let gen = 0;

      const renderList = async () => {
        const my = ++gen;
        ctx.body.innerHTML = loadingHtml(zh, spotlightViewsT(ctx.locale, "loadingProjects"));
        ctx.requestResize();
        try {
          const vm = await ctx.client.listProjects();
          if (disposed || my !== gen) return;
          const items = vm.projects;
          ctx.setSubtitle(zh ? `${items.length} 个项目` : `${items.length} project${items.length === 1 ? "" : "s"}`);
          ctx.body.innerHTML = items.length
            // #19：列表渲染也带 ds-anim-fade-in,与详情(projectHomeDetailHtml)进场一致——返回列表不再生硬瞬现。
            ? `<div class="wh-spot-dash ds-anim-fade-in">${newTaskCta(zh)}<div class="wh-spot-list ds-stagger">${items.map((p) => projectCard(p, zh)).join("")}</div></div>`
            : projectListEmptyHtml(zh);
        } catch {
          if (disposed || my !== gen) return;
          ctx.body.innerHTML = spotlightErrorHtml(zh, spotlightViewsT(ctx.locale, "couldnTLoadProjectsRetry"));
        }
        ctx.requestResize();
      };

      const renderDetail = async (projectId: string) => {
        const my = ++gen;
        ctx.body.innerHTML = loadingHtml(zh, spotlightViewsT(ctx.locale, "openingProject"));
        ctx.requestResize();
        try {
          const vm = await ctx.client.pages.project(projectId, { locale: ctx.locale });
          if (disposed || my !== gen) return;
          ctx.setSubtitle(vm.project.name);
          ctx.body.innerHTML = projectHomeDetailHtml(vm, zh);
        } catch {
          if (disposed || my !== gen) return;
          ctx.body.innerHTML = spotlightErrorHtml(zh, spotlightViewsT(ctx.locale, "couldnTOpenProjectRetry"));
        }
        ctx.requestResize();
      };

      ctx.body.addEventListener(
        "click",
        (event) => {
          if (!(event.target instanceof HTMLElement)) return;
          const target = event.target;
          if (target.closest("[data-spot-retry]")) {
            void renderList();
            return;
          }
          if (target.closest("[data-back-to-projects]")) {
            void renderList();
            return;
          }
          const proj = target.closest<HTMLElement>("[data-open-project]");
          if (proj?.dataset.openProject) {
            void renderDetail(proj.dataset.openProject);
            return;
          }
          const wi = target.closest<HTMLElement>("[data-open-workitem]");
          if (wi?.dataset.openWorkitem) {
            ctx.open("workitem", { id: wi.dataset.openWorkitem });
            return;
          }
          // R14 批 GH：GitHub 活动行的 html_url 是真外部站点（github.com），既不是 WorkHub 内部路由也
          // 不是"主窗口能打开"的东西——Tauri webview 对 target=_blank 没有承接（点了没反应，同上面知识
          // 检索证据行 rank2 的既有教训），故照抄那条既有外链模式：给一句诚实提示，不假装能内联打开。
          const ghActivity = target.closest<HTMLElement>("[data-open-gh-activity]");
          if (ghActivity?.dataset.openGhActivity) {
            ctx.toast(spotlightViewsT(ctx.locale, "openGithubLinksInYourSystem"), "info");
            return;
          }
          const drive = target.closest<HTMLElement>("[data-open-drive]");
          if (drive?.dataset.openDrive) {
            const route = drive.dataset.openDriveRoute;
            ctx.open("drive", { id: drive.dataset.openDrive, ...(route ? { route } : {}) });
            return;
          }
          const intakeBtn = target.closest<HTMLElement>("[data-open-intake]");
          if (intakeBtn) {
            // 项目主页「新任务」带项目 id+名 → 接入会话绑定到该项目并展示项目名；列表空态 CTA 无 id → 通用接入。
            const pid = intakeBtn.dataset.openIntake;
            const pname = intakeBtn.dataset.openIntakeName;
            ctx.open("intake", pid ? { id: pid, ...(pname ? { label: pname } : {}) } : undefined);
          }
        },
        { signal: ctx.signal }
      );

      // 深链/跨能力跳转可带项目 id（ctx.target.id）→ 直接进项目主页；否则从列表起。
      if (ctx.target?.id) {
        void renderDetail(ctx.target.id);
      } else {
        void renderList();
      }
      return () => {
        disposed = true;
      };
    }
  };
}

// —— 成本 —— //
export function costView(vm: CostDashboardVM, zh: boolean): string {
  const trend = vm.trend.slice(-14);
  const nums = trend.map((t) => Number(t.cost_cny) || 0);
  const max = Math.max(0.0001, ...nums);
  // L16：成本柱原来只把日期/金额塞进 title 悬浮提示——在无边框 Tauri webview 里 title 不可靠、键盘/读屏
  // 用户也够不到,读起来像装饰性 sparkline。给每根柱 role=img + aria-label(数据不再只在 tooltip),
  // 柱组下补一条「起–止日期 · 峰值」可见说明,让它成为有上下文的图表而非匿名色块。
  const bars = trend
    .map((t) => {
      const h = Math.max(4, Math.round(((Number(t.cost_cny) || 0) / max) * 40));
      const label = `${t.date} · ${cny(t.cost_cny)}`;
      return `<span class="wh-spot-bar" role="img" aria-label="${escapeHtml(label)}" style="height:${h}px" title="${escapeHtml(label)}"></span>`;
    })
    .join("");
  const peak = trend.length
    ? trend.reduce((best, t) => ((Number(t.cost_cny) || 0) > (Number(best.cost_cny) || 0) ? t : best))
    : undefined;
  const barsCaption = trend.length
    ? `<div class="wh-spot-bars-cap"><span>${escapeHtml(trend[0]?.date ?? "")} – ${escapeHtml(trend[trend.length - 1]?.date ?? "")}</span><span>${spotlightViewsT(zh, "peak")} ${escapeHtml(cny(peak?.cost_cny ?? "0"))}</span></div>`
    : "";
  const labor = vm.labor_split
    ? `<div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "selfImprovement")}</span><span class="wh-spot-metric-v">${Math.round(vm.labor_split.self_improvement_ratio * 100)}%</span></div>`
    : "";
  const topItems = vm.by_workitem
    .slice(0, 5)
    .map(
      (w) =>
        `<div class="wh-spot-row"><div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(w.code)}</div><div class="wh-spot-row-sub">${w.turns} ${spotlightViewsT(zh, "turns")}</div></div><div class="wh-spot-row-meta">${escapeHtml(cny(w.cost_cny))}</div></div>`
    )
    .join("");
  return `<div class="wh-spot-dash">
    <div class="wh-spot-metrics">
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "totalSpend")}</span><span class="wh-spot-metric-v wh-spot-metric-v--big">${escapeHtml(cny(vm.total_cost_cny))}</span></div>
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">Tokens</span><span class="wh-spot-metric-v">${(vm.token_in + vm.token_out).toLocaleString()}</span></div>
      ${labor}
    </div>
    ${bars ? `<div class="wh-spot-bars" role="group" aria-label="${spotlightViewsT(zh, "copy14DaySpendTrend")}">${bars}</div>${barsCaption}` : ""}
    ${topItems ? `<div class="wh-spot-list">${topItems}${vm.by_workitem.length > 5 ? `<p class="wh-spot-card-desc">${zh ? `还有 ${vm.by_workitem.length - 5} 个事项的花费，去网页版成本页细看。` : `${vm.by_workitem.length - 5} more on the web cost page.`}</p>` : ""}</div>` : ""}
  </div>`;
}

export function createCostView(): SpotlightCapabilityView {
  return readOnlyView("cost", {
    loadingLabel: (zh) => (spotlightViewsT(zh, "loadingCost")),
    errorLabel: (zh) => (spotlightViewsT(zh, "couldnTLoadCostRetry")),
    load: async (ctx, zh) => {
      const vm = await ctx.client.pages.cost({ locale: ctx.locale });
      return { html: costView(vm, zh), subtitle: `${cny(vm.total_cost_cny)} · ${spotlightViewsT(zh, "total")}` };
    }
  });
}

// —— Agent Army —— //
export function createAgentsView(): SpotlightCapabilityView {
  return {
    id: "agents",
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      let disposed = false;
      let vm: AgentArmyDashboardVM | undefined;

      const renderList = async () => {
        ctx.body.innerHTML = loadingHtml(zh, spotlightViewsT(ctx.locale, "loadingCuuSSquads"));
        ctx.requestResize();
        try {
          vm = await ctx.client.pages.agents({ locale: ctx.locale });
          if (disposed) return;
          ctx.setSubtitle(zh ? `${vm.kpis.active_team_count} 个小队` : `${vm.kpis.active_team_count} squad${vm.kpis.active_team_count === 1 ? "" : "s"}`);
          const directPlan = ctx.target?.id
            ? vm.plans.find((plan) => plan.plan_id === ctx.target?.id || plan.work_item_id === ctx.target?.id)
            : undefined;
          ctx.body.innerHTML = directPlan ? agentArmyPlanDetailHtml(directPlan, zh) : agentArmyDashboardView(vm, zh);
        } catch {
          if (disposed) return;
          ctx.body.innerHTML = spotlightErrorHtml(zh, spotlightViewsT(ctx.locale, "couldnTLoadSquadsRetry"));
        }
        ctx.requestResize();
      };

      ctx.body.addEventListener(
        "click",
        (event) => {
          if (!(event.target instanceof HTMLElement)) return;
          const target = event.target;
          if (target.closest("[data-spot-retry]")) {
            void renderList();
            return;
          }
          if (target.closest("[data-back-to-agent-armies]")) {
            if (vm) {
              ctx.setSubtitle(zh ? `${vm.kpis.active_team_count} 个小队` : `${vm.kpis.active_team_count} squad${vm.kpis.active_team_count === 1 ? "" : "s"}`);
              ctx.body.innerHTML = agentArmyDashboardView(vm, zh);
              ctx.requestResize();
            } else {
              void renderList();
            }
            return;
          }
          const planButton = target.closest<HTMLElement>("[data-open-agent-plan]");
          const planId = planButton?.dataset.openAgentPlan;
          if (planId && vm) {
            const plan = vm.plans.find((candidate) => candidate.plan_id === planId);
            if (plan) {
              ctx.setSubtitle(plan.work_item_code);
              ctx.body.innerHTML = agentArmyPlanDetailHtml(plan, zh);
              ctx.requestResize();
            }
            return;
          }
          const workitem = target.closest<HTMLElement>("[data-open-workitem]");
          if (workitem?.dataset.openWorkitem) {
            ctx.open("workitem", { id: workitem.dataset.openWorkitem });
            return;
          }
          const capability = target.closest<HTMLElement>("[data-open-capability]");
          const id = capability?.dataset.openCapability as CommandId | undefined;
          if (id) {
            ctx.open(id);
          }
        },
        { signal: ctx.signal }
      );

      void renderList();
      return () => {
        disposed = true;
      };
    }
  };
}

// —— 团队日历 —— //
function blockRow(b: ScheduleBlockVM, zh: boolean): string {
  // R5 词表/时间一致性：对齐 web 端 formatApprovalTimestamp 的确定性格式（YYYY-MM-DD HH:MM），
  // 同一份日历数据不再两端两套格式。
  const whenMatch = b.ends_at ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u.exec(b.ends_at) : null;
  const when = whenMatch ? `${whenMatch[1]} ${whenMatch[2]}` : (b.ends_at ?? "");
  const tone = b.status === "overdue" ? "handoff" : b.status === "today" ? "approval" : "info";
  return `<div class="wh-spot-row">
    <span class="wh-spot-card-bar wh-spot-card-bar--${tone}" style="border-radius:3px"></span>
    <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(b.title)}</div><div class="wh-spot-row-sub">${escapeHtml(when)}</div></div>
  </div>`;
}

// R5 双端一致：桌面此前没有任何通知中心入口，web 的按类型静音偏好在桌面不可达。
// 通知行带「不再接收此类」，静音区带「恢复接收」；偏好走 get/setNotificationPreferences 全量提交。
function notificationRow(item: NotificationPageVM["items"][number], zh: boolean): string {
  const tone = item.severity === "urgent" ? "handoff" : item.inbox_bucket === "needs_decision" ? "approval" : "info";
  const timeMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u.exec(item.created_at);
  const when = timeMatch ? `${timeMatch[1]} ${timeMatch[2]}` : "";
  // R15 批 A（A2 提醒阶梯）：next_remind_at 非空 = 这条通知还挂在 24h 叮嘱阶梯上，给一个「暂停提醒」轻按钮
  // （POST /api/notifications/:id/snooze 置空 next_remind_at 即抑制，读/归档态不动，通知仍留在待决策队列）。
  const snoozeBtn = item.next_remind_at
    ? `<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-notif-snooze="${escapeHtml(item.id)}" title="${escapeHtml(spotlightViewsT(zh, "stopThe24hRemindersForThis"))}">${escapeHtml(spotlightViewsT(zh, "snooze"))}</button>`
    : "";
  return `<div class="wh-spot-row" data-notif-id="${escapeHtml(item.id)}">
    <span class="wh-spot-card-bar wh-spot-card-bar--${tone}" style="border-radius:3px"></span>
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${item.status === "unread" ? "● " : ""}${escapeHtml(item.title)}</div>
      <div class="wh-spot-row-sub">${escapeHtml([when, item.body ?? ""].filter(Boolean).join(" · "))}</div>
    </div>
    ${snoozeBtn}
    <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-notif-mute="${escapeHtml(item.type)}" title="${escapeHtml(zh ? `不再接收「${notificationTypeLabel(item.type, zh)}」类通知` : `Mute “${notificationTypeLabel(item.type, zh)}” notifications`)}">${escapeHtml(spotlightViewsT(zh, "muteType"))}</button>
  </div>`;
}

export function createNotificationsView(): SpotlightCapabilityView {
  return readOnlyView("notifications", {
    loadingLabel: (zh) => (spotlightViewsT(zh, "loadingNotifications")),
    errorLabel: (zh) => (spotlightViewsT(zh, "couldnTLoadNotificationsRetry")),
    load: async (ctx, zh) => {
      // R10-P1-7：偏好 GET 失败不能装作「什么都没静音」——那会让下一次「静音此类」整组 PUT
      // 把已有静音覆盖丢。失败时禁用静音入口+诚实提示（通知列表照常显示）。
      let prefsFailed = false;
      const [vm, prefs] = await Promise.all([
        ctx.client.pages.notifications({ locale: ctx.locale }) as Promise<NotificationPageVM>,
        ctx.client.getNotificationPreferences().catch(() => {
          prefsFailed = true;
          return { muted_notification_types: [] as string[], care_messages_enabled: true };
        })
      ]);
      const rows = [...vm.buckets.needs_decision, ...vm.buckets.fyi, ...vm.buckets.done].slice(0, 12);
      const overflow = vm.items.length > 12
        ? `<p class="wh-spot-card-desc">${escapeHtml(zh ? `还有 ${vm.items.length - 12} 条，去网页版通知中心细看。` : `${vm.items.length - 12} more in the web notification center.`)}</p>`
        : "";
      const muted = prefs.muted_notification_types;
      const mutedPanel = muted.length
        ? `<div class="wh-spot-list" data-notif-muted-panel><p class="wh-spot-card-desc">${escapeHtml(spotlightViewsT(zh, "mutedTypes"))}</p>${muted
          .map((type) => `<div class="wh-spot-row"><div class="wh-spot-row-main"><div class="wh-spot-row-sub">${escapeHtml(notificationTypeLabel(type, zh))}</div></div><button type="button" class="wh-spot-act ds-pressable" data-notif-unmute="${escapeHtml(type)}">${escapeHtml(spotlightViewsT(zh, "unmute"))}</button></div>`)
          .join("")}</div>`
        : "";
      const prefsFailedNote = prefsFailed
        ? `<p class="wh-spot-card-desc">${escapeHtml(spotlightViewsT(zh, "couldnTLoadMuteSettingsMute"))}</p>`
        : "";
      // G4 #10（关怀 opt-out）：Cuu 关怀私聊开关（默认开）。始终渲染（是持久偏好，不随收件箱空/满而消失），
      // 携带当前 muted 快照以便 PUT 时不误清静音；prefs 没读到时锁禁用+诚实提示（不装作已关/已开）。
      const careEnabled = prefs.care_messages_enabled !== false;
      const careCard = `<div class="wh-spot-list" data-notif-care data-notif-care-enabled="${careEnabled ? "true" : "false"}" data-notif-muted="${escapeHtml(JSON.stringify(muted))}"${prefsFailed ? " data-notif-prefs-failed=\"true\"" : ""}>
        <div class="wh-spot-row">
          <div class="wh-spot-row-main">
            <div class="wh-spot-row-title">${escapeHtml(spotlightViewsT(zh, "cuuCareCheckIns"))}</div>
            <div class="wh-spot-row-sub">${escapeHtml(spotlightViewsT(zh, "cuuPrivatelyChecksInWhenYour"))}</div>
          </div>
          <button type="button" class="wh-spot-act ds-pressable" data-notif-care-toggle="${careEnabled ? "off" : "on"}"${prefsFailed ? " disabled" : ""}>${escapeHtml(
            prefsFailed ? (spotlightViewsT(zh, "unavailable")) : careEnabled ? (spotlightViewsT(zh, "turnOff")) : (spotlightViewsT(zh, "turnOn"))
          )}</button>
        </div>
      </div>`;
      const listHtml = rows.length || muted.length
        ? `<div class="wh-spot-list ds-stagger" data-notif-list data-notif-muted="${escapeHtml(JSON.stringify(muted))}"${prefsFailed ? " data-notif-prefs-failed=\"true\"" : ""}>${prefsFailedNote}${rows.map((item) => notificationRow(item, zh)).join("")}${overflow}${mutedPanel}</div>`
        : emptyHtml(FACE_ICON_BELL, spotlightViewsT(zh, "inboxIsEmpty"), spotlightViewsT(zh, "approvalsTeamCompletionsAndEscalationsShow"));
      const html = `${careCard}${listHtml}`;
      // L-09（R24 S3 走查）："need a call" 是"待决策"的生硬直译，英文读起来不知所云——改成通顺表达。
      const subtitle = zh
        ? `未读 ${vm.summary.unread_count} · 待决策 ${vm.summary.needs_decision_count}`
        : `${vm.summary.unread_count} unread · ${vm.summary.needs_decision_count} awaiting your decision`;
      return { html, subtitle };
    },
    onAction: (target, ctx) => {
      const zh = ctx.locale === "zh-CN";
      // R15 批 A（A2 提醒阶梯）：暂停提醒——POST snooze，本地把按钮改成「已暂停」（不重拉整份列表）。
      const snoozeBtn = target.closest<HTMLButtonElement>("[data-notif-snooze]");
      if (snoozeBtn?.dataset.notifSnooze) {
        if (snoozeBtn.disabled) {
          return;
        }
        const notificationId = snoozeBtn.dataset.notifSnooze;
        const originalText = snoozeBtn.textContent;
        snoozeBtn.disabled = true;
        snoozeBtn.textContent = spotlightViewsT(ctx.locale, "snoozing");
        void ctx.client
          .request(`/api/notifications/${encodeURIComponent(notificationId)}/snooze`, { method: "POST" })
          .then(() => {
            snoozeBtn.textContent = spotlightViewsT(ctx.locale, "snoozed");
            snoozeBtn.removeAttribute("data-notif-snooze");
            ctx.toast(spotlightViewsT(ctx.locale, "remindersSnoozedForThisNotification"), "ok");
          })
          .catch(() => {
            snoozeBtn.disabled = false;
            snoozeBtn.textContent = originalText;
            ctx.toast(spotlightViewsT(ctx.locale, "couldnTSnoozeTryAgain"), "error");
          });
        return;
      }
      // G4 #10（关怀 opt-out）：切换 Cuu 关怀私聊开关。PUT 时带上当前 muted 快照（不误清静音）+
      // careMessagesEnabled；成功后重开面板让状态一致。prefs 没读到时禁用（按钮已 disabled，这里兜底）。
      const careBtn = target.closest<HTMLButtonElement>("[data-notif-care-toggle]");
      if (careBtn?.dataset.notifCareToggle) {
        if (careBtn.disabled) {
          return;
        }
        const careEl = ctx.body.querySelector<HTMLElement>("[data-notif-care]");
        if (careEl?.dataset.notifPrefsFailed === "true") {
          ctx.toast(spotlightViewsT(ctx.locale, "preferencesDidnTLoadReopenNotifications"), "error");
          return;
        }
        const nextEnabled = careBtn.dataset.notifCareToggle === "on";
        let careMuted: string[] = [];
        try {
          careMuted = JSON.parse(careEl?.dataset.notifMuted ?? "[]") as string[];
        } catch {
          careMuted = [];
        }
        careBtn.disabled = true;
        void ctx.client
          .setNotificationPreferences(careMuted, { careMessagesEnabled: nextEnabled })
          .then(() => {
            ctx.toast(
              nextEnabled
                ? (spotlightViewsT(ctx.locale, "cuuCareCheckInsTurnedOn"))
                : (spotlightViewsT(ctx.locale, "cuuCareCheckInsTurnedOff")),
              "ok"
            );
            ctx.open("notifications", {});
          })
          .catch(() => {
            careBtn.disabled = false;
            ctx.toast(spotlightViewsT(ctx.locale, "couldnTSaveThePreferenceTry"), "error");
          });
        return;
      }
      const muteBtn = target.closest<HTMLButtonElement>("[data-notif-mute]");
      const unmuteBtn = target.closest<HTMLButtonElement>("[data-notif-unmute]");
      const type = muteBtn?.dataset.notifMute ?? unmuteBtn?.dataset.notifUnmute;
      if (!type) {
        return;
      }
      const listEl = ctx.body.querySelector<HTMLElement>("[data-notif-list]");
      if (listEl?.dataset.notifPrefsFailed === "true") {
        ctx.toast(spotlightViewsT(ctx.locale, "muteSettingsDidnTLoadReopen"), "error");
        return;
      }
      let muted: string[] = [];
      try {
        muted = JSON.parse(listEl?.dataset.notifMuted ?? "[]") as string[];
      } catch {
        muted = [];
      }
      const next = muteBtn ? [...new Set([...muted, type])] : muted.filter((entry) => entry !== type);
      void ctx.client.setNotificationPreferences(next)
        .then(() => {
          ctx.toast(muteBtn
            ? (zh ? `已静音「${notificationTypeLabel(type, zh)}」类通知` : `Muted “${notificationTypeLabel(type, zh)}” notifications`)
            : (zh ? `已恢复接收「${notificationTypeLabel(type, zh)}」` : `Unmuted “${notificationTypeLabel(type, zh)}”`), "ok");
          // 重挂载最省事且状态一定一致：静音面板/按钮态全部随 VM 重渲。
          ctx.open("notifications", {});
        })
        .catch(() => {
          ctx.toast(spotlightViewsT(ctx.locale, "couldnTSaveThePreferenceTry"), "error");
        });
    }
  });
}

export function createCalendarView(): SpotlightCapabilityView {
  return readOnlyView("team", {
    loadingLabel: (zh) => (spotlightViewsT(zh, "loadingSchedule")),
    errorLabel: (zh) => (spotlightViewsT(zh, "couldnTLoadScheduleRetry")),
    load: async (ctx, zh) => {
      // R5 双端一致：命令面板对 team 的承诺是「成员、日历与技能库」——此前只拉日历，技能承诺落空。
      // 与日历并行拉 pages.skills；技能拉取失败只降级该区块，不连累日历。
      const [vm, skills] = await Promise.all([
        ctx.client.pages.calendar({ locale: ctx.locale }) as Promise<CalendarPageVM>,
        (ctx.client.pages.skills({ locale: ctx.locale }) as Promise<TeamSkillsPageVM>).catch(() => undefined)
      ]);
      const blocks = vm.blocks ?? [];
      const subtitle = zh
        ? `今天 ${vm.summary.today_count} · 逾期 ${vm.summary.overdue_count}`
        : `today ${vm.summary.today_count} · overdue ${vm.summary.overdue_count}`;
      const calendarHtml = blocks.length
        ? `<div class="wh-spot-list ds-stagger">${blocks.slice(0, 20).map((b) => blockRow(b, zh)).join("")}</div>`
        : emptyHtml(FACE_ICON_CALENDAR, spotlightViewsT(zh, "nothingScheduled"), spotlightViewsT(zh, "dueItemsAndReviewWindowsShow"));
      const skillsHtml = skills
        ? `<div class="wh-spot-list" data-team-skills data-team-skills-active="${escapeHtml(String(skills.totals.active))}">
            <p class="wh-spot-card-desc"><strong>${escapeHtml(spotlightViewsT(zh, "teamSkills"))}</strong> · ${escapeHtml(zh
              ? `激活 ${skills.totals.active} · AI 沉淀 ${skills.totals.ai_authored} · 精修 ${skills.totals.refined}`
              : `${skills.totals.active} active · ${skills.totals.ai_authored} AI-authored · ${skills.totals.refined} refined`)}</p>
            ${skills.skills.slice(0, 5).map((skill) => `<div class="wh-spot-row" data-team-skill="${escapeHtml(skill.skill_key)}">
              <div class="wh-spot-row-main">
                <div class="wh-spot-row-title">${escapeHtml(skill.name)} · v${escapeHtml(String(skill.version))}</div>
                <div class="wh-spot-row-sub">${escapeHtml(skill.when_to_use)}</div>
              </div>
            </div>`).join("")}
            ${skills.skills.length > 5 ? `<p class="wh-spot-card-desc">${escapeHtml(zh ? `还有 ${skills.skills.length - 5} 项技能，去网页版技能页细看。` : `${skills.skills.length - 5} more on the web skills page.`)}</p>` : ""}
          </div>`
        : `<p class="wh-spot-card-desc" data-team-skills-unavailable>${escapeHtml(spotlightViewsT(zh, "skillsAreUnavailableRightNow"))}</p>`;
      return { html: calendarHtml + skillsHtml, subtitle };
    }
  });
}

// —— 知识检索（带检索框） —— //
function bubbleHtml(bubble: EvidenceBubble, zh: boolean): string {
  const refs = bubble.evidence_refs
    .slice(0, 8)
    .map((r) => {
      const conf = r.confidence_hint === "found" ? "ok" : r.confidence_hint === "weak" ? "warn" : "muted";
      // 普通用户审查 R2：target=_blank 在 Tauri 内无承接（点了没反应）——改内联分派。
      return `<a class="wh-spot-row" href="${escapeHtml(safeHref(r.href ?? "#"))}" data-know-ref="${escapeHtml(safeHref(r.href ?? ""))}">
        <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(r.title)}<span class="wh-spot-conf wh-spot-conf--${conf}"></span></div><div class="wh-spot-row-sub">${escapeHtml(r.excerpt ?? "")}</div></div>
      </a>`;
    })
    .join("");
  return `<div class="wh-spot-bubble">
    <p class="wh-spot-bubble-summary">${escapeHtml(bubble.summary_text)}</p>
    ${bubble.missing_evidence_note ? `<p class="wh-spot-bubble-note">${escapeHtml(bubble.missing_evidence_note)}</p>` : ""}
    ${refs ? `<div class="wh-spot-list">${refs}</div>` : ""}
  </div>`;
}

// 知识检索 API 要求在具体项目/事项内检索（裸查询 403）。故先选项目再搜。
export function knowledgeNoProjectsEmptyHtml(zh: boolean): string {
  return emptyHtml(FACE_ICON_SEARCH, spotlightViewsT(zh, "noProjectToSearch"), spotlightViewsT(zh, "createATaskFirstEvidenceAccrues"));
}

export function createKnowledgeView(): SpotlightCapabilityView {
  return {
    id: "knowledge",
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      let disposed = false;
      let busy = false;
      // rank9：单调代次——切项目使在途检索作废，避免「B 项目下渲染 A 项目结果」+ 锁死 busy。
      let searchGen = 0;
      let projects: { id: string; name: string }[] = [];
      let projectId: string | undefined;
      // rank22：副标题始终标出当前检索的项目（单项目时没有切换 chip，否则用户不知道在搜哪个项目）。
      const syncSubtitle = () => {
        const name = projects.find((p) => p.id === projectId)?.name;
        ctx.setSubtitle(name ? (zh ? `在「${name}」里搜` : `Search in ${name}`) : spotlightViewsT(ctx.locale, "searchKnowledge"));
      };
      syncSubtitle();

      const projectChips = (): string => {
        if (projects.length <= 1) {
          return "";
        }
        return `<div class="wh-spot-know-projects">${projects
          .map(
            (p) =>
              `<button type="button" class="wh-spot-reason" data-know-proj="${escapeHtml(p.id)}" data-sel="${p.id === projectId}">${escapeHtml(p.name)}</button>`
          )
          .join("")}</div>`;
      };

      const renderShell = (resultHtml: string) => {
        if (!projects.length) {
          ctx.body.innerHTML = knowledgeNoProjectsEmptyHtml(zh);
          ctx.requestResize();
          return;
        }
        ctx.body.innerHTML = `<div class="wh-spot-know">
          ${projectChips()}
          <div class="wh-spot-know-bar">
            <input class="wh-spot-freetext" style="min-height:auto" data-know-input placeholder="${spotlightViewsT(ctx.locale, "searchWithinTheProject")}" />
            <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-know-go>${spotlightViewsT(ctx.locale, "search")}</button>
          </div>
          <div data-know-result>${resultHtml}</div>
        </div>`;
        ctx.requestResize();
      };

      const run = async () => {
        if (busy || !projectId) return;
        const q = ctx.body.querySelector<HTMLInputElement>("[data-know-input]")?.value.trim() ?? "";
        if (!q) return;
        const gen = ++searchGen;
        const reqProjectId = projectId;
        busy = true;
        const result = ctx.body.querySelector<HTMLElement>("[data-know-result]");
        if (result) result.innerHTML = loadingHtml(zh, spotlightViewsT(ctx.locale, "searching"));
        ctx.requestResize();
        try {
          const bubble = await ctx.client.searchKnowledge({ q, project_id: reqProjectId });
          if (disposed || gen !== searchGen) return;
          const r = ctx.body.querySelector<HTMLElement>("[data-know-result]");
          if (r) r.innerHTML = bubbleHtml(bubble, zh);
        } catch {
          if (disposed || gen !== searchGen) return;
          const r = ctx.body.querySelector<HTMLElement>("[data-know-result]");
          if (r) r.innerHTML = spotlightErrorHtml(zh, spotlightViewsT(ctx.locale, "searchFailed"));
        } finally {
          // 仅当本次仍是最新代次才解锁——避免被切项目作废的旧检索把新检索的 busy 解掉。
          if (gen === searchGen) busy = false;
          if (!disposed) ctx.requestResize();
        }
      };

      ctx.body.innerHTML = loadingHtml(zh, spotlightViewsT(ctx.locale, "preparing"));
      ctx.requestResize();
      void (async () => {
        try {
          const vm = await ctx.client.listProjects();
          projects = vm.projects.map((p) => ({ id: p.id, name: p.name }));
          projectId = projects[0]?.id;
        } catch {
          // 项目拉不到就走空态。
        }
        if (disposed) return;
        syncSubtitle();
        renderShell("");
        ctx.body.querySelector<HTMLInputElement>("[data-know-input]")?.focus();
      })();

      ctx.body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const proj = target.closest<HTMLElement>("[data-know-proj]");
        if (proj?.dataset.knowProj && proj.dataset.knowProj !== projectId) {
          projectId = proj.dataset.knowProj;
          syncSubtitle();
          ctx.body.querySelectorAll<HTMLElement>("[data-know-proj]").forEach((el) => {
            el.dataset.sel = String(el.dataset.knowProj === projectId);
          });
          // M5+rank9：切项目使在途检索作废(代次++)并解锁 busy——否则旧检索回来会把
          // A 项目结果渲染到 B 项目下，且 busy 不复位会锁死后续检索。
          searchGen += 1;
          busy = false;
          const stale = ctx.body.querySelector<HTMLElement>("[data-know-result]");
          if (stale) stale.innerHTML = "";
          ctx.requestResize();
          return;
        }
        if (target.closest("[data-know-go]") || target.closest("[data-spot-retry]")) {
          void run();
          return;
        }
        // 证据行：工作项/回放内联打开，其余（drive 等）提示到主窗查看，绝不静默无反应。
        const refRow = target.closest<HTMLElement>("[data-know-ref]");
        if (refRow) {
          event.preventDefault();
          const href = refRow.dataset.knowRef ?? "";
          const workitemId = /^\/workitems\/([^/?#]+)/.exec(href)?.[1];
          const replayId = /^\/agent-runs\/([^/?#]+)\/replay/.exec(href)?.[1];
          if (workitemId) {
            ctx.open("workitem", { id: decodeURIComponent(workitemId), route: href });
          } else if (replayId) {
            ctx.open("replay", { id: decodeURIComponent(replayId), route: href });
          } else {
            ctx.toast(spotlightViewsT(ctx.locale, "openThisSourceInTheMain"), "info");
          }
        }
      });
      ctx.body.addEventListener("keydown", (event) => {
        // R11：中文输入法组合态的回车是「选字」不是「确认」——与顶层搜索框同款守卫。
        if (event instanceof KeyboardEvent && (event.isComposing || event.keyCode === 229)) {
          return;
        }
        if (event instanceof KeyboardEvent && event.key === "Enter" && event.target instanceof HTMLElement && event.target.matches("[data-know-input]")) {
          event.preventDefault();
          void run();
        }
      });
      return () => {
        disposed = true;
      };
    }
  };
}
