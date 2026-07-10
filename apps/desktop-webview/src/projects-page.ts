// R7 P4 · 桌面「项目」页(桌面专属,液态玻璃)。
// 纯渲染:把 ProjectListVM 渲染成一组玻璃项目按钮(名称 + 进行中工作项计数 + 负责人 + 描述),
// 整卡可点/可键盘触达(带 data-project-id/-slug/-name)以便 browser.ts 下钻到该项目的文件(client.pages.drive)。
// 数据来自 GET /api/projects(client.listProjects()),后端已实现。空态给 Cuu 文案。
// 不进共享 @workhub/ui;只在桌面注入,Web 与 web-live-route-smoke 不受影响。

import type { ProjectListVM, WorkHubLocale } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

function countLabel(count: number, zh: boolean): string {
  if (count <= 0) {
    return zh ? "暂无进行中" : "All clear";
  }
  return zh ? `${count} 个进行中` : `${count} active`;
}

function emptyState(zh: boolean): string {
  return `<div class="wh-proj" data-proj-empty="true">
    <div class="wh-proj-empty">
      <div class="wh-proj-empty-face gl-avatar">(=｀ω´=)</div>
      <h3 class="wh-proj-empty-title">${zh ? "还没有项目哦" : "No projects yet"}</h3>
      <p class="wh-proj-empty-sub">${zh ? "在「派个活儿」里提第一个需求，Cuu 就会替你把项目张罗起来 (=^･ω･^=)" : "Kick off a request in “Hand off a task” and Cuu will set the project up (=^･ω･^=)"}</p>
    </div>
  </div>`;
}

function renderCard(project: ProjectListVM["projects"][number], zh: boolean): string {
  const hasOpen = project.open_work_item_count > 0;
  const desc = project.description ? `<span class="wh-proj-desc">${escapeHtml(project.description)}</span>` : "";
  const label = `${zh ? "打开项目" : "Open project"} ${project.name}`;
  return `<button type="button" class="wh-proj-card gl-press" aria-label="${escapeHtml(label)}" data-proj-card="${escapeHtml(project.id)}" data-project-id="${escapeHtml(project.id)}" data-project-slug="${escapeHtml(project.slug)}" data-project-name="${escapeHtml(project.name)}">
    <span class="wh-proj-cardtop">
      <span class="wh-proj-name">${escapeHtml(project.name)}</span>
      <span class="wh-proj-count${hasOpen ? " wh-proj-count--active" : ""}">${escapeHtml(countLabel(project.open_work_item_count, zh))}</span>
    </span>
    ${desc}
    <span class="wh-proj-meta">
      <span class="wh-proj-owner">${zh ? "负责人" : "Owner"} · ${escapeHtml(project.owner_nickname)}</span>
      <span class="wh-proj-slug">${escapeHtml(project.slug)}</span>
    </span>
  </button>`;
}

export function renderProjectsListHtml(input: { page: ProjectListVM; locale: WorkHubLocale }): string {
  const zh = input.locale === "zh-CN";
  const projects = input.page.projects;
  if (projects.length === 0) {
    return emptyState(zh);
  }
  const totalOpen = projects.reduce((sum, project) => sum + project.open_work_item_count, 0);
  const cards = projects.map((project) => renderCard(project, zh)).join("");
  return `<div class="wh-proj" data-proj-count="${projects.length}">
    <header class="wh-proj-head">
      <h2 class="wh-proj-title">${zh ? "项目" : "Projects"}</h2>
      <div class="wh-proj-chips">
        <span class="wh-proj-chip"><b>${projects.length}</b>${zh ? "个项目" : "projects"}</span>
        <span class="wh-proj-chip${totalOpen > 0 ? " wh-proj-chip--active" : ""}"><b>${totalOpen}</b>${zh ? "进行中" : "active"}</span>
      </div>
    </header>
    <div class="wh-proj-grid">${cards}</div>
  </div>`;
}

// 项目页液态玻璃样式(桌面注入)。
export const projectsPageCss = [
  ".wh-proj{max-width:760px;margin:0 auto;font-family:'M PLUS Rounded 1c','Noto Sans SC',sans-serif}",
  ".wh-proj-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px}",
  ".wh-proj-title{margin:0;font-size:20px;font-weight:900;color:#1d1d1f}",
  ".wh-proj-chips{display:flex;gap:8px;flex-wrap:wrap}",
  ".wh-proj-chip{font:700 12px/1 'Noto Sans SC',sans-serif;color:#636366;background:rgba(255,255,255,.55);border:1px solid rgba(255,255,255,.7);border-radius:11px;padding:7px 11px}.wh-proj-chip b{color:#0a84ff;font-size:14px;margin-right:4px}",
  ".wh-proj-chip--active b{color:#30d158}",
  ".wh-proj-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}",
  ".wh-proj-card{appearance:none;-webkit-appearance:none;width:100%;text-align:left;font-family:inherit;display:flex;flex-direction:column;gap:10px;padding:18px 18px 16px;border-radius:20px;text-decoration:none;cursor:pointer;background:rgba(255,255,255,.58);backdrop-filter:blur(32px) saturate(180%);-webkit-backdrop-filter:blur(32px) saturate(180%);border:1px solid rgba(255,255,255,.78);box-shadow:0 24px 54px -30px rgba(60,60,67,.32),inset 0 1px 0 rgba(255,255,255,.78);transition:transform .15s ease,box-shadow .15s ease}",
  ".wh-proj-card:hover{transform:translateY(-2px);box-shadow:0 30px 62px -28px rgba(60,60,67,.38),inset 0 1px 0 rgba(255,255,255,.85)}",
  ".wh-proj-cardtop{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}",
  ".wh-proj-name{margin:0;font-size:16.5px;font-weight:800;color:#1d1d1f;line-height:1.35;overflow-wrap:anywhere}",
  ".wh-proj-count{flex:0 0 auto;font:800 11px/1 'M PLUS Rounded 1c','Noto Sans SC',sans-serif;color:#8e8e93;background:rgba(255,255,255,.6);border-radius:8px;padding:5px 8px;white-space:nowrap}",
  ".wh-proj-count--active{color:#30d158;background:rgba(48,209,88,.16)}",
  ".wh-proj-desc{margin:0;font:500 13px/1.55 'Noto Sans SC',sans-serif;color:#3a3a3c;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-proj-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:4px}",
  ".wh-proj-owner{font:700 12px/1.4 'Noto Sans SC',sans-serif;color:#636366}",
  ".wh-proj-slug{font:700 11px/1 'M PLUS Rounded 1c',monospace;color:#636366;background:rgba(10,132,255,.10);border-radius:6px;padding:4px 7px}",
  ".wh-proj-empty{max-width:560px;margin:8px auto 0;border-radius:24px;padding:46px 30px;text-align:center;background:rgba(255,255,255,.5);backdrop-filter:blur(30px) saturate(170%);-webkit-backdrop-filter:blur(30px) saturate(170%);border:1px solid rgba(255,255,255,.75);box-shadow:0 26px 60px -28px rgba(60,60,67,.32),inset 0 1px 0 rgba(255,255,255,.7)}",
  ".wh-proj-empty-face{font:700 32px/1 'M PLUS Rounded 1c',sans-serif}",
  ".wh-proj-empty-title{margin:16px 0 0;font-size:20px;font-weight:900;color:#1d1d1f}",
  ".wh-proj-empty-sub{margin:10px 0 0;font-size:13px;line-height:1.6;color:#636366}"
].join("");
