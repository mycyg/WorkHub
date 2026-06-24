// WorkHub 桌面 · Spotlight 只读/检索类能力内联视图（S5/S7/S9/S10）：项目 · 成本 · 团队日历 · 知识检索。
// 统一玻璃风，复用 client.listProjects / pages.cost / pages.calendar / searchKnowledge 数据加载器。
// 这些能力以「看」为主（知识带检索框），故用一个共享的 read-only 装载器；写动作类（网盘/工作项/回放）另立。

import type {
  CalendarPageVM,
  CostDashboardVM,
  EvidenceBubble,
  ProjectHomePageVM,
  ProjectListItemVM,
  ScheduleBlockVM
} from "@workhub/contracts";
import { escapeHtml, safeHref } from "@workhub/web-runtime";

import type { CommandId } from "../../command-palette.js";
import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";
import { workItemPriorityLabel, workItemStatusLabel } from "../labels.js";

function loadingHtml(zh: boolean, label: string): string {
  return `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${escapeHtml(label)}</div>`;
}

function emptyHtml(face: string, title: string, sub: string): string {
  return `<div class="wh-spot-empty"><div class="wh-spot-empty-face">${face}</div><h3 class="wh-spot-empty-title">${escapeHtml(title)}</h3><p class="wh-spot-empty-sub">${escapeHtml(sub)}</p></div>`;
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
      <div class="wh-spot-row-title">${escapeHtml(p.name)}${p.archived ? `<span class="wh-spot-row-tag">${zh ? "已归档" : "Archived"}</span>` : ""}</div>
      <div class="wh-spot-row-sub">${escapeHtml(p.description ?? (zh ? `负责人 ${p.owner_nickname}` : `Owner ${p.owner_nickname}`))}</div>
    </div>
    <div class="wh-spot-row-meta">${badge}<span class="wh-spot-row-metalabel">${zh ? "进行中" : "open"}</span></div>
  </button>`;
}

// rank14：可点的「新任务」CTA——空态/有项目都给一个去派活的入口（开 intake 能力）。
function newTaskCta(zh: boolean): string {
  return `<button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-open-intake style="align-self:flex-start">${zh ? "＋ 新任务 / 交给 AI" : "＋ New task / Dispatch to AI"}</button>`;
}

// 项目主页（list→detail morph）：点项目行 → 在同一盒子内 morph 出该项目的「项目主页」
// （元信息 + 进行中工作清单链工作项 + 新任务/打开网盘入口），镜像 web /projects/:id。盒子随内容生长。
export function projectHomeDetailHtml(vm: ProjectHomePageVM, zh: boolean): string {
  const p = vm.project;
  // DF-1：与 web M5 + /projects 列表卡同口径。summary.open_work_item_count 是「可见且可处理」数;
  // total_open_work_item_count 是全量(含他人私有态)。头条数用全量,与列表卡一致;另标「你可处理 N」。
  const viewableOpen = vm.summary.open_work_item_count;
  const totalOpen = vm.summary.total_open_work_item_count ?? viewableOpen;
  const archived = p.status === "archived" ? `<span class="wh-spot-row-tag">${zh ? "已归档" : "Archived"}</span>` : "";
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
    : emptyHtml("✅", zh ? "暂无进行中的工作" : "No open work", zh ? "点「新任务」就能派活" : "Hit New task to assign some");
  // 隐藏量按全量算(曾用可见数自减恒为 0,提示从不出现);诚实说明是无权限查看的他人私有态事项。
  const hidden = totalOpen - vm.open_work_items.length;
  const moreNote = hidden > 0
    ? `<p class="wh-spot-row-sub" style="text-align:center">${escapeHtml(zh ? `还有 ${hidden} 条进行中工作你暂无权限查看。` : `+${hidden} more open items you cannot view.`)}</p>`
    : "";
  // 网盘同步是核心：项目主页直接呈现最近文件（点任意文件/「打开网盘」进完整文件树）。
  const fileRows = vm.drive.recent_files.length
    ? vm.drive.recent_files
        .map(
          (f) =>
            `<button type="button" class="wh-spot-row" data-open-drive="${escapeHtml(p.id)}" style="cursor:pointer;width:100%;text-align:left">
        <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(f.name)}</div><div class="wh-spot-row-sub">${escapeHtml(f.updated_at.slice(0, 10))}</div></div>
      </button>`
        )
        .join("")
    : `<p class="wh-spot-row-sub">${escapeHtml(zh ? "网盘里还没有文件。" : "No files in the drive yet.")}</p>`;
  // DF-3:「最近文件 N」是项目文件总数,但只列 recent_files(≤5)。超出时给「还有 N 未显示」,
  // 否则一堆文件的项目只露几条却显示总数,像把这几条当成全部(web route-components 同款 note)。
  const hiddenFiles = vm.drive.file_count - vm.drive.recent_files.length;
  const filesMoreNote = hiddenFiles > 0 && vm.drive.recent_files.length > 0
    ? `<p class="wh-spot-row-sub" style="text-align:center">${escapeHtml(zh ? `还有 ${hiddenFiles} 个文件未显示，前往网盘查看全部。` : `+${hiddenFiles} more files not shown — open the drive.`)}</p>`
    : "";
  const filesBlock = `<div class="wh-spot-row-metalabel" style="margin-top:4px">${escapeHtml(zh ? `最近文件 ${vm.drive.file_count}` : `Recent files ${vm.drive.file_count}`)}</div><div class="wh-spot-list">${fileRows}</div>${filesMoreNote}`;
  return `<div class="wh-spot-dash ds-anim-fade-in">
    <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-back-to-projects style="align-self:flex-start">${zh ? "← 返回项目列表" : "← Back to projects"}</button>
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
        ctx.body.innerHTML = loadingHtml(zh, zh ? "正在拉项目…" : "Loading projects…");
        ctx.requestResize();
        try {
          const vm = await ctx.client.listProjects();
          if (disposed || my !== gen) return;
          const items = vm.projects;
          ctx.setSubtitle(zh ? `${items.length} 个项目` : `${items.length} project${items.length === 1 ? "" : "s"}`);
          ctx.body.innerHTML = items.length
            // #19：列表渲染也带 ds-anim-fade-in,与详情(projectHomeDetailHtml)进场一致——返回列表不再生硬瞬现。
            ? `<div class="wh-spot-dash ds-anim-fade-in">${newTaskCta(zh)}<div class="wh-spot-list ds-stagger">${items.map((p) => projectCard(p, zh)).join("")}</div></div>`
            : `<div class="wh-spot-dash ds-anim-fade-in">${emptyHtml("📁", zh ? "还没有项目" : "No projects yet", zh ? "派个活就会自动建项目和网盘" : "Dispatch a task to create one")}<div style="text-align:center">${newTaskCta(zh)}</div></div>`;
        } catch {
          if (disposed || my !== gen) return;
          ctx.body.innerHTML = spotlightErrorHtml(zh, zh ? "项目没拉到，稍后重试" : "Couldn't load projects — retry");
        }
        ctx.requestResize();
      };

      const renderDetail = async (projectId: string) => {
        const my = ++gen;
        ctx.body.innerHTML = loadingHtml(zh, zh ? "正在打开项目…" : "Opening project…");
        ctx.requestResize();
        try {
          const vm = await ctx.client.pages.project(projectId, { locale: ctx.locale });
          if (disposed || my !== gen) return;
          ctx.setSubtitle(vm.project.name);
          ctx.body.innerHTML = projectHomeDetailHtml(vm, zh);
        } catch {
          if (disposed || my !== gen) return;
          ctx.body.innerHTML = spotlightErrorHtml(zh, zh ? "项目主页没打开，稍后重试" : "Couldn't open project — retry");
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
          const drive = target.closest<HTMLElement>("[data-open-drive]");
          if (drive?.dataset.openDrive) {
            ctx.open("drive", { id: drive.dataset.openDrive });
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
      const label = `${t.date} · ¥${t.cost_cny}`;
      return `<span class="wh-spot-bar" role="img" aria-label="${escapeHtml(label)}" style="height:${h}px" title="${escapeHtml(label)}"></span>`;
    })
    .join("");
  const peak = trend.length
    ? trend.reduce((best, t) => ((Number(t.cost_cny) || 0) > (Number(best.cost_cny) || 0) ? t : best))
    : undefined;
  const barsCaption = trend.length
    ? `<div class="wh-spot-bars-cap"><span>${escapeHtml(trend[0]?.date ?? "")} – ${escapeHtml(trend[trend.length - 1]?.date ?? "")}</span><span>${zh ? "峰值" : "Peak"} ¥${escapeHtml(peak?.cost_cny ?? "0")}</span></div>`
    : "";
  const labor = vm.labor_split
    ? `<div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "自我精进占比" : "Self-improvement"}</span><span class="wh-spot-metric-v">${Math.round(vm.labor_split.self_improvement_ratio * 100)}%</span></div>`
    : "";
  const topItems = vm.by_workitem
    .slice(0, 5)
    .map(
      (w) =>
        `<div class="wh-spot-row"><div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(w.code)}</div><div class="wh-spot-row-sub">${w.turns} ${zh ? "轮" : "turns"}</div></div><div class="wh-spot-row-meta">¥${escapeHtml(w.cost_cny)}</div></div>`
    )
    .join("");
  return `<div class="wh-spot-dash">
    <div class="wh-spot-metrics">
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "累计花费" : "Total spend"}</span><span class="wh-spot-metric-v wh-spot-metric-v--big">¥${escapeHtml(vm.total_cost_cny)}</span></div>
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">Tokens</span><span class="wh-spot-metric-v">${(vm.token_in + vm.token_out).toLocaleString()}</span></div>
      ${labor}
    </div>
    ${bars ? `<div class="wh-spot-bars" role="group" aria-label="${zh ? "近 14 天花费趋势" : "14-day spend trend"}">${bars}</div>${barsCaption}` : ""}
    ${topItems ? `<div class="wh-spot-list">${topItems}</div>` : ""}
  </div>`;
}

export function createCostView(): SpotlightCapabilityView {
  return readOnlyView("cost", {
    loadingLabel: (zh) => (zh ? "正在算成本…" : "Loading cost…"),
    errorLabel: (zh) => (zh ? "成本没拉到，稍后重试" : "Couldn't load cost — retry"),
    load: async (ctx, zh) => {
      const vm = await ctx.client.pages.cost({ locale: ctx.locale });
      return { html: costView(vm, zh), subtitle: `¥${vm.total_cost_cny} · ${zh ? "累计" : "total"}` };
    }
  });
}

// —— 团队日历 —— //
function blockRow(b: ScheduleBlockVM, zh: boolean): string {
  const when = b.ends_at ? new Date(b.ends_at).toLocaleString(zh ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const tone = b.status === "overdue" ? "handoff" : b.status === "today" ? "approval" : "info";
  return `<div class="wh-spot-row">
    <span class="wh-spot-card-bar wh-spot-card-bar--${tone}" style="border-radius:3px"></span>
    <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(b.title)}</div><div class="wh-spot-row-sub">${escapeHtml(when)}</div></div>
  </div>`;
}

export function createCalendarView(): SpotlightCapabilityView {
  return readOnlyView("team", {
    loadingLabel: (zh) => (zh ? "正在拉日程…" : "Loading schedule…"),
    errorLabel: (zh) => (zh ? "日程没拉到，稍后重试" : "Couldn't load schedule — retry"),
    load: async (ctx, zh) => {
      const vm: CalendarPageVM = await ctx.client.pages.calendar({ locale: ctx.locale });
      const blocks = vm.blocks ?? [];
      const subtitle = zh
        ? `今天 ${vm.summary.today_count} · 逾期 ${vm.summary.overdue_count}`
        : `today ${vm.summary.today_count} · overdue ${vm.summary.overdue_count}`;
      const html = blocks.length
        ? `<div class="wh-spot-list ds-stagger">${blocks.slice(0, 20).map((b) => blockRow(b, zh)).join("")}</div>`
        : emptyHtml("🗓️", zh ? "近期没有日程" : "Nothing scheduled", zh ? "工作项到期、复盘窗口会出现在这里" : "Due items and review windows show here");
      return { html, subtitle };
    }
  });
}

// —— 知识检索（带检索框） —— //
function bubbleHtml(bubble: EvidenceBubble, zh: boolean): string {
  const refs = bubble.evidence_refs
    .slice(0, 8)
    .map((r) => {
      const conf = r.confidence_hint === "found" ? "ok" : r.confidence_hint === "weak" ? "warn" : "muted";
      return `<a class="wh-spot-row" href="${escapeHtml(safeHref(r.href ?? "#"))}" target="_blank" rel="noreferrer">
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
        ctx.setSubtitle(name ? (zh ? `在「${name}」里搜` : `Search in ${name}`) : zh ? "搜索沉淀的知识" : "Search knowledge");
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
          ctx.body.innerHTML = emptyHtml("🔍", zh ? "还没有可检索的项目" : "No project to search", zh ? "先派个活建项目，证据会沉淀在项目里" : "Dispatch a task first — evidence accrues per project");
          ctx.requestResize();
          return;
        }
        ctx.body.innerHTML = `<div class="wh-spot-know">
          ${projectChips()}
          <div class="wh-spot-know-bar">
            <input class="wh-spot-freetext" style="min-height:auto" data-know-input placeholder="${zh ? "在所选项目里搜什么？" : "Search within the project…"}" />
            <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-know-go>${zh ? "搜索" : "Search"}</button>
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
        if (result) result.innerHTML = loadingHtml(zh, zh ? "正在检索…" : "Searching…");
        ctx.requestResize();
        try {
          const bubble = await ctx.client.searchKnowledge({ q, project_id: reqProjectId });
          if (disposed || gen !== searchGen) return;
          const r = ctx.body.querySelector<HTMLElement>("[data-know-result]");
          if (r) r.innerHTML = bubbleHtml(bubble, zh);
        } catch {
          if (disposed || gen !== searchGen) return;
          const r = ctx.body.querySelector<HTMLElement>("[data-know-result]");
          if (r) r.innerHTML = spotlightErrorHtml(zh, zh ? "检索失败" : "Search failed");
        } finally {
          // 仅当本次仍是最新代次才解锁——避免被切项目作废的旧检索把新检索的 busy 解掉。
          if (gen === searchGen) busy = false;
          if (!disposed) ctx.requestResize();
        }
      };

      ctx.body.innerHTML = loadingHtml(zh, zh ? "正在准备…" : "Preparing…");
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
        }
      });
      ctx.body.addEventListener("keydown", (event) => {
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
