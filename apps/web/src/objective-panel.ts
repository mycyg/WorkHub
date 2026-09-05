import type { ObjectiveDetailResponse, ObjectiveListItemVM, ProjectHomeWorkItemVM } from "@workhub/contracts";
import type { WorkHubLocale } from "@workhub/ui/gold-path";
import { escapeHtml } from "@workhub/web-runtime";

import { webT } from "./locales.js";

// R23 F-01（OKR 列表/详情持久化）：项目主页 OKR 面板此前只有创建/挂链两个写动作——列表是会话内内存态
// （刷新即失，见 apps/web/src/browser.ts 里 bindProjectHomeObjectivesPanel 的旧注释）。服务端已补
// GET /api/projects/:id/objectives（列表）与 GET /api/objectives/:id（详情），这里是纯字符串渲染层：
// 不碰 DOM/网络，方便直接单测。DOM 水合与取数在 browser.ts，SSR 骨架在
// packages/ui/src/gold-path/route-components.ts（renderProjectHomeRouteComponent 的 objectivesSection）。

export type ObjectiveListItem = Pick<ObjectiveListItemVM, "objective_id" | "title" | "status" | "progress_percent">;

function zhLocale(locale: WorkHubLocale) {
  return locale === "zh-CN";
}

function objectiveLinkControlsHtml(openWorkItems: ProjectHomeWorkItemVM[], locale: WorkHubLocale) {
  const zh = zhLocale(locale);
  if (!openWorkItems.length) {
    return `<span class="wh-subtle">${escapeHtml(
      webT(zh, "noOpenWorkItemsInThis")
    )}</span>`;
  }
  const options = openWorkItems
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(`${item.code} · ${item.title}`)}</option>`)
    .join("");
  return `<select class="wh-pill" data-r20-okr-link-select aria-label="${escapeHtml(webT(zh, "pickAWorkItemToLink"))}">
      <option value="">${escapeHtml(webT(zh, "pickAWorkItem"))}</option>
      ${options}
    </select>
    <button type="button" class="wh-btn" data-r20-okr-link-submit="true">${escapeHtml(webT(zh, "link"))}</button>`;
}

// 一个目标渲两个相邻同级块：可见行 + 默认折叠的详情容器（用 objective_id 关联，不依赖兄弟节点顺序）。
// list.innerHTML 整体重建后这两块仍是彼此紧邻的同级节点，但取详情容器一律走
// `[data-r23-okr-detail-body="<id>"]` 属性选择，不假设 DOM 结构。
export function objectiveRowHtml(
  objective: ObjectiveListItem,
  openWorkItems: ProjectHomeWorkItemVM[],
  locale: WorkHubLocale
) {
  const zh = zhLocale(locale);
  return `<div class="wh-r4-route-row" data-r20-okr-item="${escapeHtml(objective.objective_id)}">
      <div>
        <strong>${escapeHtml(objective.title)}</strong>
        <div class="wh-r4-route-meta">
          <span class="wh-pill">${escapeHtml(objective.status)}</span>
          <span class="wh-pill">${escapeHtml(`${objective.progress_percent}%`)}</span>
        </div>
      </div>
      <div>
        <button type="button" class="wh-btn" data-r23-okr-detail-toggle="true" aria-expanded="false">${escapeHtml(webT(zh, "details"))}</button>
        ${objectiveLinkControlsHtml(openWorkItems, locale)}
        <p class="wh-subtle" data-r20-okr-link-status hidden></p>
      </div>
    </div>
    <div class="wh-r23-okr-detail" data-r23-okr-detail-body="${escapeHtml(objective.objective_id)}" hidden></div>`;
}

function objectiveListEmptyHtml(locale: WorkHubLocale) {
  const zh = zhLocale(locale);
  return `<p class="wh-subtle" data-r20-okr-list-empty="true">${escapeHtml(
    webT(zh, "noObjectivesYetInThisWorkspace")
  )}</p>`;
}

function objectiveListCappedNoteHtml(locale: WorkHubLocale) {
  const zh = zhLocale(locale);
  return `<p class="wh-subtle" data-r20-okr-list-capped="true">${escapeHtml(
    webT(zh, "moreObjectivesExistButArenT")
  )}</p>`;
}

// 首屏真拉取（成功路径）与创建/挂链之后的重拉共用这一份渲染——整体重建列表容器，不做增量 DOM diff。
export function objectiveListBodyHtml(
  items: ObjectiveListItem[],
  capped: boolean,
  openWorkItems: ProjectHomeWorkItemVM[],
  locale: WorkHubLocale
) {
  if (items.length === 0) {
    return objectiveListEmptyHtml(locale);
  }
  const rows = items.map((item) => objectiveRowHtml(item, openWorkItems, locale)).join("");
  return capped ? `${rows}${objectiveListCappedNoteHtml(locale)}` : rows;
}

export function objectiveListLoadingHtml(locale: WorkHubLocale) {
  const zh = zhLocale(locale);
  return `<p class="wh-subtle" data-r20-okr-list-loading="true">${escapeHtml(webT(zh, "loadingObjectives"))}</p>`;
}

// P1-07 同款取舍（project-home-plans 先例）：403（无权）与其它失败（网络/5xx）分开报——前者不该被
// 说成「暂无目标」，后者要给可见告警 + 可点重试，不能拿空态糊弄一次真实的取数失败。
export function objectiveListErrorHtml(locale: WorkHubLocale, forbidden: boolean) {
  const zh = zhLocale(locale);
  if (forbidden) {
    return `<p class="wh-subtle" data-r20-okr-list-forbidden="true">${escapeHtml(
      webT(zh, "youDonTHavePermissionTo4")
    )}</p>`;
  }
  return `<p class="wh-subtle" data-r20-okr-list-error="true">${escapeHtml(
    webT(zh, "couldnTLoadObjectivesRetryLater")
  )}</p><button type="button" class="wh-btn" data-r20-okr-list-retry="true">${escapeHtml(webT(zh, "retry"))}</button>`;
}

function keyResultRowHtml(keyResult: ObjectiveDetailResponse["key_results"][number]) {
  return `<div class="wh-r4-route-meta"><span class="wh-pill">${escapeHtml(keyResult.title)}</span><span class="wh-pill">${escapeHtml(`${keyResult.progress_percent}%`)}</span></div>`;
}

function linkedWorkItemRowHtml(item: ObjectiveDetailResponse["linked_work_items"][number]) {
  return `<div class="wh-r4-route-meta"><span class="wh-pill">${escapeHtml(item.code)}</span><span>${escapeHtml(item.title ?? "")}</span><span class="wh-pill">${escapeHtml(item.status)}</span></div>`;
}

function linkedTaskPlanRowHtml(plan: ObjectiveDetailResponse["linked_task_plans"][number]) {
  return `<div class="wh-r4-route-meta"><span class="wh-pill">${escapeHtml(plan.status)}</span></div>`;
}

// 详情抽屉：关键结果 + 挂链工作项 + 挂链执行计划（task_plans.objective_id 这条既有列此前从没有查询
// 读过——见 packages/db/src/repositories/objectives.ts 的 readObjectiveDetail 注释）。三路各自诚实
// 上限提示，capped 时追加一句「更多未显示」而不是悄悄截断。
export function objectiveDetailBodyHtml(detail: ObjectiveDetailResponse, locale: WorkHubLocale) {
  const zh = zhLocale(locale);
  const cappedSuffix = (capped: boolean) => (capped ? ` · ${escapeHtml(webT(zh, "moreNotShown"))}` : "");
  const keyResultsHtml = detail.key_results.length
    ? detail.key_results.map(keyResultRowHtml).join("")
    : `<p class="wh-subtle">${escapeHtml(webT(zh, "noKeyResultsYet"))}</p>`;
  const workItemsHtml = detail.linked_work_items.length
    ? detail.linked_work_items.map(linkedWorkItemRowHtml).join("")
    : `<p class="wh-subtle">${escapeHtml(webT(zh, "noLinkedWorkItemsYet"))}</p>`;
  const taskPlansHtml = detail.linked_task_plans.length
    ? detail.linked_task_plans.map(linkedTaskPlanRowHtml).join("")
    : `<p class="wh-subtle">${escapeHtml(webT(zh, "noLinkedTaskPlansYet"))}</p>`;
  return `<div data-r23-okr-detail-krs="true">
      <p class="wh-subtle"><strong>${escapeHtml(webT(zh, "keyResults"))}</strong>${cappedSuffix(detail.key_results_capped)}</p>
      ${keyResultsHtml}
    </div>
    <div data-r23-okr-detail-workitems="true">
      <p class="wh-subtle"><strong>${escapeHtml(webT(zh, "linkedWorkItems"))}</strong>${cappedSuffix(detail.linked_work_items_capped)}</p>
      ${workItemsHtml}
    </div>
    <div data-r23-okr-detail-plans="true">
      <p class="wh-subtle"><strong>${escapeHtml(webT(zh, "linkedTaskPlans"))}</strong>${cappedSuffix(detail.linked_task_plans_capped)}</p>
      ${taskPlansHtml}
    </div>`;
}

export function objectiveDetailLoadingHtml(locale: WorkHubLocale) {
  const zh = zhLocale(locale);
  return `<p class="wh-subtle">${escapeHtml(webT(zh, "loadingDetail"))}</p>`;
}

export function objectiveDetailErrorHtml(locale: WorkHubLocale) {
  const zh = zhLocale(locale);
  return `<p class="wh-subtle" data-r23-okr-detail-error="true">${escapeHtml(
    webT(zh, "couldnTLoadDetailPleaseRetry")
  )}</p><button type="button" class="wh-btn" data-r23-okr-detail-retry="true">${escapeHtml(webT(zh, "retry"))}</button>`;
}
