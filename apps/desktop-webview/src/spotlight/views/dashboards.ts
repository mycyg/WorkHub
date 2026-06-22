// WorkHub 桌面 · Spotlight 只读/检索类能力内联视图（S5/S7/S9/S10）：项目 · 成本 · 团队日历 · 知识检索。
// 统一玻璃风，复用 client.listProjects / pages.cost / pages.calendar / searchKnowledge 数据加载器。
// 这些能力以「看」为主（知识带检索框），故用一个共享的 read-only 装载器；写动作类（网盘/工作项/回放）另立。

import type {
  CalendarPageVM,
  CostDashboardVM,
  EvidenceBubble,
  ProjectListItemVM,
  ScheduleBlockVM
} from "@workhub/contracts";
import { escapeHtml, safeHref } from "@workhub/web-runtime";

import type { CommandId } from "../../command-palette.js";
import type { SpotlightCapabilityView, SpotlightViewContext } from "../view-context.js";

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
  }
): SpotlightCapabilityView {
  return {
    id,
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      let disposed = false;
      ctx.body.innerHTML = loadingHtml(zh, config.loadingLabel(zh));
      ctx.requestResize();
      void (async () => {
        try {
          const { html, subtitle } = await config.load(ctx, zh);
          if (disposed) return;
          ctx.setSubtitle(subtitle);
          ctx.body.innerHTML = html;
          ctx.requestResize();
        } catch {
          if (disposed) return;
          ctx.body.innerHTML = `<div class="wh-spot-error">${escapeHtml(config.errorLabel(zh))}</div>`;
          ctx.requestResize();
        }
      })();
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
  return `<div class="wh-spot-row">
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${escapeHtml(p.name)}${p.archived ? `<span class="wh-spot-row-tag">${zh ? "已归档" : "Archived"}</span>` : ""}</div>
      <div class="wh-spot-row-sub">${escapeHtml(p.description ?? (zh ? `负责人 ${p.owner_nickname}` : `Owner ${p.owner_nickname}`))}</div>
    </div>
    <div class="wh-spot-row-meta">${badge}<span class="wh-spot-row-metalabel">${zh ? "进行中" : "open"}</span></div>
  </div>`;
}

export function createProjectsView(): SpotlightCapabilityView {
  return readOnlyView("projects", {
    loadingLabel: (zh) => (zh ? "正在拉项目…" : "Loading projects…"),
    errorLabel: (zh) => (zh ? "项目没拉到，稍后重试" : "Couldn't load projects — retry"),
    load: async (ctx, zh) => {
      const vm = await ctx.client.listProjects();
      const items = vm.projects;
      const subtitle = zh ? `${items.length} 个项目` : `${items.length} project${items.length === 1 ? "" : "s"}`;
      const html = items.length
        ? `<div class="wh-spot-list ds-stagger">${items.map((p) => projectCard(p, zh)).join("")}</div>`
        : emptyHtml("📁", zh ? "还没有项目" : "No projects yet", zh ? "派个活就会自动建项目" : "Dispatch a task to create one");
      return { html, subtitle };
    }
  });
}

// —— 成本 —— //
function costView(vm: CostDashboardVM, zh: boolean): string {
  const trend = vm.trend.slice(-14);
  const nums = trend.map((t) => Number(t.cost_cny) || 0);
  const max = Math.max(0.0001, ...nums);
  const bars = trend
    .map((t) => {
      const h = Math.max(4, Math.round(((Number(t.cost_cny) || 0) / max) * 40));
      return `<span class="wh-spot-bar" style="height:${h}px" title="${escapeHtml(t.date)} · ¥${escapeHtml(t.cost_cny)}"></span>`;
    })
    .join("");
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
    ${bars ? `<div class="wh-spot-bars">${bars}</div>` : ""}
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
      ctx.setSubtitle(zh ? "搜索沉淀的知识" : "Search knowledge");

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
          if (r) r.innerHTML = `<div class="wh-spot-error">${zh ? "检索失败，稍后重试" : "Search failed — retry"}</div>`;
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
        renderShell("");
        ctx.body.querySelector<HTMLInputElement>("[data-know-input]")?.focus();
      })();

      ctx.body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const proj = target.closest<HTMLElement>("[data-know-proj]");
        if (proj?.dataset.knowProj && proj.dataset.knowProj !== projectId) {
          projectId = proj.dataset.knowProj;
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
        if (target.closest("[data-know-go]")) {
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
