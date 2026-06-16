// R7 P4 · 团队页「日历」段(桌面专属,液态玻璃)。
// 纯渲染:把 CalendarPageVM 渲染成玻璃日历——头部(视图/范围 + 概览计数)、按天分组的玻璃卡、
// 每条日程行(时间 + 类型标签 + 标题 + 状态徽标)。带 target_href 的行做成可点,复用 browser.ts
// 既有 bindGoldPathNavigation 点击管线(已知路由→跳转,未知→pending 提示),不需新交互代码。
// 后端零改动:GET /api/pages/calendar(client.pages.calendar)+ CalendarPageVM 早已存在,仅未接桌面。
// 不进共享 @workhub/ui;只在桌面注入,Web 与 web-live-route-smoke 不受影响。

import type { CalendarPageVM, ScheduleBlockVM, WorkHubLocale } from "@workhub/contracts";
import { escapeHtml, safeHref } from "@workhub/web-runtime";

type BlockTone = "event" | "due" | "meeting" | "review";

function toneForKind(kind: ScheduleBlockVM["kind"]): BlockTone {
  switch (kind) {
    case "work_item_due":
      return "due";
    case "meeting_followup":
      return "meeting";
    case "review_window":
      return "review";
    default:
      return "event";
  }
}

function kindLabel(kind: ScheduleBlockVM["kind"], zh: boolean): string {
  switch (kind) {
    case "work_item_due":
      return zh ? "截止" : "Due";
    case "meeting_followup":
      return zh ? "会议跟进" : "Follow-up";
    case "review_window":
      return zh ? "评审窗口" : "Review";
    default:
      return zh ? "日程" : "Event";
  }
}

function statusLabel(status: ScheduleBlockVM["status"], zh: boolean): string {
  switch (status) {
    case "today":
      return zh ? "今天" : "Today";
    case "overdue":
      return zh ? "逾期" : "Overdue";
    case "done":
      return zh ? "已完成" : "Done";
    default:
      return zh ? "待开始" : "Upcoming";
  }
}

// 从 ISO 字符串里抠出 HH:MM(确定性,测试不受时区影响);全天显示「全天」。
function clockLabel(block: ScheduleBlockVM, zh: boolean): string {
  if (block.all_day) {
    return zh ? "全天" : "All day";
  }
  const stamp = block.starts_at ?? block.ends_at;
  const matched = /T(\d{2}):(\d{2})/u.exec(stamp);
  return matched ? `${matched[1]}:${matched[2]}` : stamp;
}

function viewLabel(view: CalendarPageVM["scope"]["view"], zh: boolean): string {
  if (view === "week") {
    return zh ? "本周日程" : "This week";
  }
  return zh ? "今日日程" : "Today";
}

function renderBlock(block: ScheduleBlockVM, zh: boolean): string {
  const tone = toneForKind(block.kind);
  const clickable = typeof block.target_href === "string" && block.target_href.length > 0;
  const inner = `<span class="wh-tcal-time">${escapeHtml(clockLabel(block, zh))}</span>
        <span class="wh-tcal-block-main">
          <span class="wh-tcal-block-head">
            <span class="wh-tcal-tag wh-tcal-tag--${tone}">${escapeHtml(kindLabel(block.kind, zh))}</span>
            <span class="wh-tcal-status wh-tcal-status--${block.status}">${escapeHtml(statusLabel(block.status, zh))}</span>
          </span>
          <span class="wh-tcal-block-title">${escapeHtml(block.title)}</span>
          ${block.description ? `<span class="wh-tcal-block-desc">${escapeHtml(block.description)}</span>` : ""}
        </span>`;
  if (clickable) {
    return `<a class="wh-tcal-block wh-tcal-block--link gl-press" data-tcal-block="${escapeHtml(block.id)}" data-action-href="${escapeHtml(safeHref(block.target_href!))}" data-href="${escapeHtml(safeHref(block.target_href!))}">${inner}</a>`;
  }
  return `<div class="wh-tcal-block" data-tcal-block="${escapeHtml(block.id)}">${inner}</div>`;
}

function dayHeading(date: string, scopeDate: string, zh: boolean): string {
  const isToday = date === scopeDate;
  const todayBadge = isToday ? `<span class="wh-tcal-today">${zh ? "今天" : "Today"}</span>` : "";
  return `<div class="wh-tcal-dayhead"><span class="wh-tcal-daydate">${escapeHtml(date)}</span>${todayBadge}</div>`;
}

function emptyState(zh: boolean): string {
  return `<div class="wh-tcal" data-tcal-empty="true">
    <div class="wh-tcal-empty">
      <div class="wh-tcal-empty-face gl-avatar">(=^‥^=)ﾉ</div>
      <h3 class="wh-tcal-empty-title">${zh ? "这阵子没有排期～" : "Nothing on the schedule"}</h3>
      <p class="wh-tcal-empty-sub">${zh ? "有截止、评审或会议跟进时，Cuu 会把它们摆到这儿 (=^･ω･^=)" : "Deadlines, reviews and follow-ups will show up here (=^･ω･^=)"}</p>
    </div>
  </div>`;
}

export function renderTeamCalendarHtml(input: { page: CalendarPageVM; locale: WorkHubLocale }): string {
  const zh = input.locale === "zh-CN";
  const page = input.page;
  const daysWithBlocks = page.days.filter((day) => day.blocks.length > 0);
  if (page.empty_state === "no_schedule_blocks" || page.blocks.length === 0 || daysWithBlocks.length === 0) {
    return emptyState(zh);
  }
  const summary = page.summary;
  const chips = [
    `<span class="wh-tcal-chip"><b>${summary.today_count}</b>${zh ? "今天" : "today"}</span>`,
    summary.overdue_count > 0
      ? `<span class="wh-tcal-chip wh-tcal-chip--alert"><b>${summary.overdue_count}</b>${zh ? "逾期" : "overdue"}</span>`
      : "",
    `<span class="wh-tcal-chip"><b>${summary.block_count}</b>${zh ? "共" : "total"}</span>`
  ].filter(Boolean).join("");
  const dayCards = daysWithBlocks
    .map((day) => `<section class="wh-tcal-day">
      ${dayHeading(day.date, page.scope.date, zh)}
      <div class="wh-tcal-blocks">${day.blocks.map((block) => renderBlock(block, zh)).join("")}</div>
    </section>`)
    .join("");
  return `<div class="wh-tcal" data-tcal-view="${escapeHtml(page.scope.view)}">
    <header class="wh-tcal-head">
      <div class="wh-tcal-headline">
        <h2 class="wh-tcal-title">${escapeHtml(viewLabel(page.scope.view, zh))}</h2>
        <span class="wh-tcal-range">${escapeHtml(page.scope.date)}</span>
      </div>
      <div class="wh-tcal-chips">${chips}</div>
    </header>
    <div class="wh-tcal-days">${dayCards}</div>
  </div>`;
}

// 团队日历液态玻璃样式(桌面注入)。
export const teamCalendarCss = [
  ".wh-tcal{max-width:640px;margin:0 auto;font-family:'M PLUS Rounded 1c','Noto Sans SC',sans-serif}",
  ".wh-tcal-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px}",
  ".wh-tcal-title{margin:0;font-size:20px;font-weight:900;color:#2c2746}",
  ".wh-tcal-range{font:700 13px/1 'Noto Sans SC',sans-serif;color:#8b84ad;margin-left:10px}",
  ".wh-tcal-chips{display:flex;gap:8px;flex-wrap:wrap}",
  ".wh-tcal-chip{font:700 12px/1 'Noto Sans SC',sans-serif;color:#6b6488;background:rgba(255,255,255,.55);border:1px solid rgba(255,255,255,.7);border-radius:11px;padding:7px 11px}.wh-tcal-chip b{color:#7c83ff;font-size:14px;margin-right:4px}",
  ".wh-tcal-chip--alert{background:rgba(255,155,176,.2);border-color:rgba(255,155,176,.45)}.wh-tcal-chip--alert b{color:#e85d70}",
  ".wh-tcal-days{display:flex;flex-direction:column;gap:16px}",
  ".wh-tcal-day{border-radius:22px;overflow:hidden;background:rgba(255,255,255,.55);backdrop-filter:blur(32px) saturate(180%);-webkit-backdrop-filter:blur(32px) saturate(180%);border:1px solid rgba(255,255,255,.75);box-shadow:0 26px 58px -30px rgba(70,54,140,.55),inset 0 1px 0 rgba(255,255,255,.75)}",
  ".wh-tcal-dayhead{display:flex;align-items:center;gap:10px;padding:14px 20px 10px}",
  ".wh-tcal-daydate{font:800 14px/1 'M PLUS Rounded 1c','Noto Sans SC',sans-serif;color:#2c2746}",
  ".wh-tcal-today{font:800 10px/1 'Noto Sans SC',sans-serif;color:#fff;background:linear-gradient(135deg,#7c83ff,#b57bff);border-radius:7px;padding:4px 8px}",
  ".wh-tcal-blocks{display:flex;flex-direction:column}",
  ".wh-tcal-block{display:flex;gap:14px;padding:13px 20px;border-top:1px solid rgba(124,131,255,.12);text-decoration:none}",
  ".wh-tcal-block--link{cursor:pointer;transition:background .15s ease}.wh-tcal-block--link:hover{background:rgba(124,131,255,.08)}",
  ".wh-tcal-time{flex:0 0 52px;font:800 13px/1.5 'M PLUS Rounded 1c',sans-serif;color:#7c83ff;padding-top:2px}",
  ".wh-tcal-block-main{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}",
  ".wh-tcal-block-head{display:flex;align-items:center;gap:7px}",
  ".wh-tcal-tag{font:800 10px/1 'M PLUS Rounded 1c','Noto Sans SC',sans-serif;color:#5a45d8;background:rgba(124,131,255,.16);border-radius:7px;padding:4px 7px}",
  ".wh-tcal-tag--due{color:#c4567f;background:rgba(255,155,176,.2)}",
  ".wh-tcal-tag--meeting{color:#1faf86;background:rgba(52,199,154,.16)}",
  ".wh-tcal-tag--review{color:#8a5cd8;background:rgba(181,123,255,.18)}",
  ".wh-tcal-status{font:700 10px/1 'Noto Sans SC',sans-serif;color:#8b84ad}",
  ".wh-tcal-status--today{color:#5a45d8}",
  ".wh-tcal-status--overdue{color:#e85d70}",
  ".wh-tcal-status--done{color:#1faf86}",
  ".wh-tcal-block-title{font:700 14.5px/1.45 'Noto Sans SC',sans-serif;color:#2c2746;overflow-wrap:anywhere}",
  ".wh-tcal-block-desc{font:500 12.5px/1.5 'Noto Sans SC',sans-serif;color:#6b6488;overflow-wrap:anywhere}",
  ".wh-tcal-empty{max-width:560px;margin:8px auto 0;border-radius:24px;padding:46px 30px;text-align:center;background:rgba(255,255,255,.5);backdrop-filter:blur(30px) saturate(170%);-webkit-backdrop-filter:blur(30px) saturate(170%);border:1px solid rgba(255,255,255,.75);box-shadow:0 26px 60px -28px rgba(70,54,140,.5),inset 0 1px 0 rgba(255,255,255,.7)}",
  ".wh-tcal-empty-face{font:700 32px/1 'M PLUS Rounded 1c',sans-serif}",
  ".wh-tcal-empty-title{margin:16px 0 0;font-size:20px;font-weight:900;color:#2c2746}",
  ".wh-tcal-empty-sub{margin:10px 0 0;font-size:13.5px;line-height:1.6;color:#6b6488}"
].join("");
