// WorkHub 桌面 · Spotlight「会议」能力内联视图（F-09，接棒 scout-D-wiring.md 同节缺口）。
// 选项目（同 drive.ts 先选项目）→ pages.meetings → 会议列表 + 选中会议的转写/纪要/洞察卡。
// 与 web /meetings 页同源数据（packages/contracts meetingPageVmSchema），字段按当前契约诚实渲染——
// 服务端「转写 → AI 纪要/洞察」生成链路目前是否接通不是本视图的事：纪要/洞察为空时给贴合会议状态
// 的空态文案，不在桌面端造生成逻辑（那是 SA-02 的活，另立）。
//
// 洞察卡动作沿用服务端下发的 href/action 契约（与 web packages/ui route-components.ts 同一份
// ActionSpec：create_draft/dismiss），解析走 @workhub/web-runtime 的 meetingInsightActionFromHref
// ——与 web browser.ts 解析同一个 href 用的是同一个函数，两端对同一个动作不会走出两条不同的路；
// 解析出 projectId/insightId 后落到桌面已有的 SDK 方法（createMeetingInsightDraft/
// dismissMeetingInsight）。draft_href/proposal_href 是纯导航链接（/workitems/:id、/proposals/:id），
// 复用 attention.ts 已导出的 classifyAttentionActionHref 分类（同一套 href 形态两处不必各写一份正则）。
//
// 会议详情不是独立子路由——pages.meetings 一次性把「哪场被选中」和它的转写/纪要/洞察都下发了
// （selected_meeting_id + meetings[].insights），故本视图不做 list/detail 两级状态机（不像
// workitem.ts 那样另开 showDetail(id)），而是像 drive.ts 一样整块重渲；切换会议/项目/洞察动作后
// 一律重新 load()（显式带上当前 selectedMeetingId 查询），**不**直接拿 createMeetingInsightDraft/
// dismissMeetingInsight 的返回值重渲——服务端这两个写接口返回的 selected_meeting_id 恒为
// undefined（见 apps/api/src/services/meeting-pages.ts pageAfterMutation），直接渲会静默跳回
// 项目默认会议，而不是停留在用户正在看的这场。

import type { MeetingInsightVM, MeetingPageVM, MeetingRecordVM } from "@workhub/contracts";
import { escapeHtml, meetingInsightActionFromHref } from "@workhub/web-runtime";

import { classifyAttentionActionHref } from "./attention.js";
import { meetingInsightKindLabel, meetingInsightStatusLabel, meetingRecordStatusLabel } from "../labels.js";
import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";

import { spotlightViewsT } from "./locales.js";

// ── 纯函数：深链解析 / 渲染 —— 与 DOM 接线分离，逐条可单测（同 drive.ts 手法）。 ──────────────

// F-09：会议详情深链 `?m=meetingId`（search.ts 的 ctx.open("meetings", { route: "?m=..." })）与
// web 同款 `/meetings?project_id=&m=` 全路径都要认——同 driveTargetItemIdFromRoute 的两种形态。
export function meetingTargetIdFromRoute(route: string | undefined): string | undefined {
  if (!route) return undefined;
  try {
    const url = new URL(route.replaceAll("&amp;", "&"), "http://workhub.local");
    return url.searchParams.get("m") ?? url.searchParams.get("meetingId") ?? undefined;
  } catch {
    const query = route.replaceAll("&amp;", "&").split("?")[1];
    if (!query) return undefined;
    const params = new URLSearchParams(query);
    return params.get("m") ?? params.get("meetingId") ?? undefined;
  }
}

function formatMeetingTimestamp(iso: string, zh: boolean): string {
  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(iso));
}

// L27 同款（web route-components.ts meetingContentFallback）：转写/纪要为空时不能都说「还没有
// 内容」——会议还在 processing/failed 时那句是错的，按状态给贴合的占位。
function meetingContentFallback(kind: "transcript" | "minutes", status: MeetingRecordVM["status"], zh: boolean): string {
  const noun = kind === "transcript" ? (spotlightViewsT(zh, "transcript")) : (spotlightViewsT(zh, "minutes"));
  if (status === "processing") {
    return zh ? `${noun}还在准备中，稍后回来查看。` : `${noun} is still being prepared — check back shortly.`;
  }
  if (status === "failed") {
    return zh ? `${noun}没有生成成功。` : `${noun} could not be generated.`;
  }
  return zh ? `这次会议还没有${noun}内容。` : `This meeting has no ${kind === "transcript" ? "transcript" : "minutes"} yet.`;
}

function insightKindTone(kind: MeetingInsightVM["kind"]): "approval" | "choice" | "info" {
  if (kind === "new_requirement") return "approval";
  if (kind === "requirement_change") return "choice";
  return "info";
}

// 洞察状态第二枚 chip：confirmed 借「已批准」的绿、dismissed 借「已忽略」的灰，pending 留默认强调色
// （与 web 洞察卡「待确认」用强调色一个意思：这条需要有人看一眼）。
function insightStatusChipHtml(status: MeetingInsightVM["status"], zh: boolean): string {
  const cls =
    status === "confirmed" ? "wh-spot-chip wh-spot-chip--permission" : status === "dismissed" ? "wh-spot-chip wh-spot-chip--info" : "wh-spot-chip";
  return `<span class="${cls}">${escapeHtml(meetingInsightStatusLabel(status, zh))}</span>`;
}

function meetingInsightCardHtml(insight: MeetingInsightVM, zh: boolean): string {
  const tone = insightKindTone(insight.kind);
  const createBtn = insight.actions.create_draft
    ? `<button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-meeting-insight-action="${escapeHtml(insight.actions.create_draft.href)}">${escapeHtml(insight.actions.create_draft.label)}</button>`
    : "";
  const dismissBtn = insight.actions.dismiss
    ? `<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-meeting-insight-action="${escapeHtml(insight.actions.dismiss.href)}">${escapeHtml(insight.actions.dismiss.label)}</button>`
    : "";
  // draft_href/proposal_href 是纯导航（GET /workitems/:id、/proposals/:id），不是要提交的 ActionSpec——
  // 用 data-meeting-open-href 单独一类,分发给 classifyAttentionActionHref 而不是当写动作提交。
  const draftLink = insight.draft_href
    ? `<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-meeting-open-href="${escapeHtml(insight.draft_href)}">${escapeHtml(spotlightViewsT(zh, "openDraft"))}</button>`
    : "";
  const proposalLink = insight.proposal_href
    ? `<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-meeting-open-href="${escapeHtml(insight.proposal_href)}">${escapeHtml(spotlightViewsT(zh, "viewChangeRequest"))}</button>`
    : "";
  const actionsRow = createBtn || dismissBtn || draftLink || proposalLink
    ? `<div class="wh-spot-card-actions">${createBtn}${dismissBtn}${draftLink}${proposalLink}</div>`
    : "";
  return `<article class="wh-spot-card ds-glass" data-meeting-insight="${escapeHtml(insight.id)}" data-meeting-insight-status="${escapeHtml(insight.status)}" data-meeting-insight-kind="${escapeHtml(insight.kind)}">
    <span class="wh-spot-card-bar wh-spot-card-bar--${tone}"></span>
    <div class="wh-spot-card-main">
      <div class="wh-spot-card-head">
        <span class="wh-spot-chip wh-spot-chip--${tone}">${escapeHtml(meetingInsightKindLabel(insight.kind, zh))}</span>
        ${insightStatusChipHtml(insight.status, zh)}
      </div>
      <h3 class="wh-spot-card-title">${escapeHtml(insight.title)}</h3>
      <p class="wh-spot-card-desc">${escapeHtml(insight.description)}</p>
      <p class="wh-spot-card-desc">${escapeHtml(spotlightViewsT(zh, "aiReason2"))}${escapeHtml(insight.confidence_reason)}</p>
      ${actionsRow}
    </div>
  </article>`;
}

function meetingDetailHtml(m: MeetingRecordVM, zh: boolean): string {
  const transcript = m.transcript_text?.trim() || meetingContentFallback("transcript", m.status, zh);
  const minutes = m.minutes_md?.trim() || meetingContentFallback("minutes", m.status, zh);
  const insights = m.insights.length
    ? `<div class="wh-spot-cards ds-stagger">${m.insights.map((i) => meetingInsightCardHtml(i, zh)).join("")}</div>`
    : `<p class="wh-spot-bubble-note" style="color:var(--ds-ink-muted)">${spotlightViewsT(zh, "noInsightsFromThisMeetingYet")}</p>`;
  return `<div class="wh-spot-drive-section" data-meeting-detail="${escapeHtml(m.id)}">
    <p class="wh-spot-reasons-q">${spotlightViewsT(zh, "transcript")}</p>
    <pre class="wh-spot-row-sub wh-spot-drive-preview-text">${escapeHtml(transcript)}</pre>
    <p class="wh-spot-reasons-q">${spotlightViewsT(zh, "minutes")}</p>
    <pre class="wh-spot-row-sub wh-spot-drive-preview-text">${escapeHtml(minutes)}</pre>
    <p class="wh-spot-reasons-q">${spotlightViewsT(zh, "insights")}</p>
    ${insights}
  </div>`;
}

function meetingRowHtml(m: MeetingRecordVM, zh: boolean, selected: boolean): string {
  const pendingCount = m.insights.filter((i) => i.status === "pending").length;
  const pendingTag = pendingCount > 0
    ? ` <span class="wh-spot-row-tag">${escapeHtml(zh ? `${pendingCount} 条待确认` : `${pendingCount} pending`)}</span>`
    : "";
  const current = selected ? `<span class="wh-spot-row-current">${spotlightViewsT(zh, "current")}</span>` : "";
  return `<button type="button" class="wh-spot-row" data-meeting-select="${escapeHtml(m.id)}" data-meeting-selected="${selected ? "true" : "false"}"${selected ? ' aria-current="true"' : ""}>
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${escapeHtml(m.title)} <span class="wh-spot-row-tag">${escapeHtml(meetingRecordStatusLabel(m.status, zh))}</span>${pendingTag}</div>
      <div class="wh-spot-row-sub">${escapeHtml(`${formatMeetingTimestamp(m.created_at, zh)} · ${m.uploaded_by_label}`)}</div>
    </div>
    ${current}
  </button>`;
}

// 深链选中的会议即使不在前 10 条时间序里也要留在可见列表（同 drive.ts visibleDriveItems 的手法）。
const MEETING_LIST_CAP = 10;

function visibleMeetings(meetings: readonly MeetingRecordVM[], selectedId: string | undefined): MeetingRecordVM[] {
  const selected = selectedId ? meetings.find((m) => m.id === selectedId) : undefined;
  if (!selected) {
    return meetings.slice(0, MEETING_LIST_CAP);
  }
  const firstPage = meetings.slice(0, MEETING_LIST_CAP);
  if (firstPage.some((m) => m.id === selected.id)) {
    return firstPage;
  }
  return [selected, ...meetings.filter((m) => m.id !== selected.id).slice(0, MEETING_LIST_CAP - 1)];
}

export function meetingsHtml(vm: MeetingPageVM, projectChips: string, zh: boolean): string {
  const s = vm.summary;
  const summary = `<div class="wh-spot-metrics">
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "meetings")}</span><span class="wh-spot-metric-v">${s.meeting_count}</span></div>
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "ready")}</span><span class="wh-spot-metric-v">${s.ready_count}</span></div>
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "pending")}</span><span class="wh-spot-metric-v">${s.pending_insight_count}</span></div>
  </div>`;
  const selected = vm.meetings.find((m) => m.id === vm.selected_meeting_id) ?? vm.meetings[0];
  const list = vm.meetings.length
    ? `<div class="wh-spot-list ds-stagger">${visibleMeetings(vm.meetings, selected?.id).map((m) => meetingRowHtml(m, zh, m.id === selected?.id)).join("")}</div>${vm.meetings.length > MEETING_LIST_CAP ? `<p class="wh-spot-card-desc" data-meeting-list-overflow="${vm.meetings.length - MEETING_LIST_CAP}">${zh ? `只显示最近 ${MEETING_LIST_CAP} 场会议（共 ${vm.meetings.length} 场），全部会议去网页版看。` : `Showing the ${MEETING_LIST_CAP} most recent of ${vm.meetings.length} meetings — open the web app for the full list.`}</p>` : ""}`
    // 桌面此前完全没有会议视图,现在有读的一面了,但导入转写仍只有网页版能做（F-09 范围不含导入
    // UI）——诚实指路,不假装桌面也能建,同 drive.ts 回收站/超量列表指去网页版的口径。
    : `<p class="wh-spot-bubble-note" style="color:var(--ds-ink-muted)">${spotlightViewsT(zh, "noMeetingsInThisProjectYet")}</p>`;
  const detail = selected ? meetingDetailHtml(selected, zh) : "";
  return `<div class="wh-spot-know">${projectChips}${summary}${list}${detail}</div>`;
}

export function meetingsNoProjectsEmptyHtml(zh: boolean): string {
  return `<div class="wh-spot-empty">
    <div class="wh-spot-empty-face">(=^･ω･^=)</div>
    <h3 class="wh-spot-empty-title">${spotlightViewsT(zh, "noProjects")}</h3>
    <p class="wh-spot-empty-sub">${spotlightViewsT(zh, "createATaskAndCuuWill2")}</p>
    <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-meeting-open-intake="true">${spotlightViewsT(zh, "newTaskAskAi")}</button>
  </div>`;
}

// ── 视图接线 ───────────────────────────────────────────────────────────────────────────────

export function createMeetingsView(): SpotlightCapabilityView {
  return {
    id: "meetings",
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      let disposed = false;
      let busy = false;
      // rank9 同款：单调代次，切项目/切会议时旧请求晚到不得覆盖新状态。
      let loadGen = 0;
      // rank7：上次失败的加载器，点「重试」即重跑。
      let retry: (() => void) | undefined;
      let projects: { id: string; name: string }[] = [];
      let projectId: string | undefined;
      // 当前选中的会议——深链带来的初值，之后随用户点击列表行/切项目而变，每次都显式带给
      // pages.meetings（不依赖写动作接口自己回的 selected_meeting_id，见文件头注释）。
      let selectedMeetingId = meetingTargetIdFromRoute(ctx.target?.route);
      ctx.setSubtitle(spotlightViewsT(ctx.locale, "transcriptsMinutesInsights"));

      const chips = (): string => {
        if (projects.length <= 1) return "";
        return `<div class="wh-spot-know-projects">${projects
          .map((p) => `<button type="button" class="wh-spot-reason" data-meeting-proj="${escapeHtml(p.id)}" data-sel="${p.id === projectId}">${escapeHtml(p.name)}</button>`)
          .join("")}</div>`;
      };

      const load = async () => {
        if (!projectId) return;
        const gen = ++loadGen;
        const reqProjectId = projectId;
        ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(ctx.locale, "loadingMeetings")}</div>`;
        ctx.requestResize();
        try {
          const vm = await ctx.client.pages.meetings({
            project_id: reqProjectId,
            locale: ctx.locale,
            ...(selectedMeetingId ? { meetingId: selectedMeetingId } : {})
          });
          if (disposed || gen !== loadGen) return;
          selectedMeetingId = vm.selected_meeting_id;
          const proj = projects.find((p) => p.id === reqProjectId);
          ctx.setSubtitle(proj ? proj.name : spotlightViewsT(ctx.locale, "meetings"));
          ctx.body.innerHTML = meetingsHtml(vm, chips(), zh);
        } catch {
          if (disposed || gen !== loadGen) return;
          retry = () => void load();
          ctx.body.innerHTML = spotlightErrorHtml(zh, spotlightViewsT(ctx.locale, "couldnTLoadMeetings"));
        }
        ctx.requestResize();
        // R11（键盘全程）：innerHTML 重渲后焦点掉回 body——交还内容区，Tab 起点可预期。
        ctx.refocusBody();
      };

      ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(ctx.locale, "preparing")}</div>`;
      ctx.requestResize();
      void (async () => {
        try {
          const list = await ctx.client.listProjects();
          projects = list.projects.map((p) => ({ id: p.id, name: p.name }));
          // rank14/13 同款：深链/命令面板带了目标项目 id 且存在就直接开它，否则默认第一个。
          const wanted = ctx.target?.id;
          projectId = wanted && projects.some((p) => p.id === wanted) ? wanted : projects[0]?.id;
        } catch {
          // 走空态
        }
        if (disposed) return;
        if (!projectId) {
          ctx.body.innerHTML = meetingsNoProjectsEmptyHtml(zh);
          ctx.requestResize();
          return;
        }
        await load();
      })();

      ctx.body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest("[data-spot-retry]")) {
          retry?.();
          return;
        }
        if (target.closest("[data-meeting-open-intake]")) {
          ctx.open("intake");
          return;
        }
        const proj = target.closest<HTMLElement>("[data-meeting-proj]");
        if (proj?.dataset.meetingProj) {
          if (busy || proj.dataset.meetingProj === projectId) return;
          projectId = proj.dataset.meetingProj;
          selectedMeetingId = undefined;
          void load();
          return;
        }
        const row = target.closest<HTMLElement>("[data-meeting-select]");
        if (row?.dataset.meetingSelect && !busy) {
          if (row.dataset.meetingSelect === selectedMeetingId) return;
          selectedMeetingId = row.dataset.meetingSelect;
          void load();
          return;
        }
        // 纯导航链接（打开草稿工作项 / 查看变更申请）：复用 attention.ts 已导出的 href 分类器，
        // 不再为同样形态的 /workitems/:id、/proposals/:id 各写一份正则。
        const openHrefEl = target.closest<HTMLElement>("[data-meeting-open-href]");
        if (openHrefEl?.dataset.meetingOpenHref) {
          const nav = classifyAttentionActionHref(openHrefEl.dataset.meetingOpenHref);
          if (nav.kind === "navigate") {
            ctx.open(nav.view, nav.id ? { id: nav.id, route: openHrefEl.dataset.meetingOpenHref } : { route: openHrefEl.dataset.meetingOpenHref });
          } else {
            // 分发表没有的形态：诚实告知打不开，不落一个静默无效的按钮（不能假装在处理）。
            ctx.toast(spotlightViewsT(ctx.locale, "thisActionIsNotAvailableHere"), "error");
          }
          return;
        }
        // 洞察卡的写动作（生成草稿/忽略）：href 契约与 web 同源，解析走共享的
        // meetingInsightActionFromHref，落到对应的桌面 SDK 方法。
        const insightAction = target.closest<HTMLElement>("[data-meeting-insight-action]");
        if (insightAction?.dataset.meetingInsightAction && !busy) {
          const parsed = meetingInsightActionFromHref(insightAction.dataset.meetingInsightAction);
          if (!parsed) {
            ctx.toast(spotlightViewsT(ctx.locale, "thisActionIsNotAvailableHere2"), "error");
            return;
          }
          busy = true;
          insightAction.textContent =
            parsed.action === "draft" ? (spotlightViewsT(ctx.locale, "creatingDraft")) : (spotlightViewsT(ctx.locale, "dismissing"));
          const call =
            parsed.action === "draft"
              ? ctx.client.createMeetingInsightDraft(parsed.projectId, parsed.insightId, { locale: ctx.locale })
              : ctx.client.dismissMeetingInsight(parsed.projectId, parsed.insightId, { locale: ctx.locale });
          void call
            .then(() =>
              ctx.toast(
                parsed.action === "draft" ? (spotlightViewsT(ctx.locale, "draftCreated")) : (spotlightViewsT(ctx.locale, "dismissed")),
                "ok"
              )
            )
            .catch(() => ctx.toast(spotlightViewsT(ctx.locale, "couldnTCompleteThisTryAgain"), "error"))
            .finally(() => {
              busy = false;
              // 显式带着当前 selectedMeetingId 重拉——不用这次调用自己返回的页面（见文件头注释）。
              void load();
            });
          return;
        }
      });

      return () => {
        disposed = true;
      };
    }
  };
}
