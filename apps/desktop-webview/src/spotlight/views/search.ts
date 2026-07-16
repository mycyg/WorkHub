// WorkHub 桌面 · Spotlight「搜索全部」能力内联视图（R14 批 SEARCH，工包 W2）。
// 跨会话·网盘·工单·会议的统一检索——GET /api/search 契约见 packages/contracts/src/domain/search.ts
// （02-search-design.md §4/§5）。api-client 目前还没有 search() 方法（那是 W3 web-search-page 工包的活，
// 本工包禁碰 packages/**/apps/web/**）——沿用 drive.ts 已导出、明确供跨 view 复用的鉴权 fetch helper
// （fetchDriveResource/driveResourceApiBase/driveResourceHref，同一套 token 自愈逻辑），不重复造轮子。
//
// 深链降级说明（诚实披露，见设计 §6）：
// - 网盘/工单结果有真实的逐项深链（ctx.open("drive"/"workitem", {...})，目标 view 会直接展开该项）。
// - 会话结果 MVP 只到会话级（invoke open_workbench + stashPendingWorkbenchDeepLink 带 conversationId，
//   不带 seq——stash payload 本就没有 seq 字段，精确滚动明确列为跨包依赖，不在本工包）。
// - 会议结果没有可复用的「打开某条会议」能力视图（team/日历视图不消费 target），只能诚实降级为
//   「在工作台打开该项目」——open_workbench 到项目级，行内文案如实告知，不假装精确跳转。

import type {
  ConversationSearchResult,
  DriveSearchResult,
  MeetingSearchResult,
  SearchGroup,
  SearchMatchedIn,
  SearchResultsVm,
  SearchScope,
  WorkItemSearchResult
} from "@workhub/contracts";
import {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
  SEARCH_SCOPE_ORDER,
  searchResultsVmSchema
} from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { resolveDesktopTauriInvoke } from "../../desktop-window-controls.js";
import { stashPendingWorkbenchDeepLink } from "../../workbench/pending-deep-link.js";
import { workItemStatusLabel } from "../labels.js";
import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";
import { driveResourceApiBase, driveResourceHref, fetchDriveResource } from "./drive.js";

export const SEARCH_DEBOUNCE_MS = 300;

// ── 纯函数：请求构造 / 文案 / 渲染 —— 与 DOM 接线分离，逐条可单测。 ──────────────────────────

export function buildSearchRequestPath(q: string, limit: number = SEARCH_LIMIT_DEFAULT): string {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return `/api/search?${params.toString()}`;
}

export function searchScopeLabel(scope: SearchScope, zh: boolean): string {
  switch (scope) {
    case "conversations":
      return zh ? "会话" : "Chat";
    case "drive":
      return zh ? "网盘" : "Drive";
    case "work_items":
      return zh ? "工单" : "Tasks";
    case "meetings":
      return zh ? "会议" : "Meetings";
    default:
      return scope;
  }
}

export function matchedInLabel(matchedIn: SearchMatchedIn, zh: boolean): string {
  switch (matchedIn) {
    case "name":
      return zh ? "文件名" : "Filename";
    case "body":
      return zh ? "正文" : "Content";
    case "title":
      return zh ? "标题" : "Title";
    case "description":
      return zh ? "描述" : "Description";
    case "text":
      return zh ? "正文" : "Message";
    case "minutes":
      return zh ? "纪要" : "Minutes";
    default:
      return zh ? "内容" : "Content";
  }
}

// 会议没有共享的状态词表（web/桌面此前都没建）——只给已知的三个真实值配人话，未知值如实透传，
// 不编造词表（去黑话的另一面：不认识的枚举值宁可原样显示也不要瞎翻译）。
const MEETING_STATUS_LABELS: Record<string, { zh: string; en: string }> = {
  processing: { zh: "处理中", en: "Processing" },
  ready: { zh: "已就绪", en: "Ready" },
  failed: { zh: "失败", en: "Failed" }
};

export function meetingStatusLabel(status: string, zh: boolean): string {
  const entry = MEETING_STATUS_LABELS[status];
  if (!entry) {
    return status;
  }
  return zh ? entry.zh : entry.en;
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

// 服务端已给 snippet 纯文本；客户端按 q 在**已转义**的文本里定位命中词并包 <mark>——先转义再匹配，
// 保证插入的 <mark> 标签是唯一未转义内容，不给 snippet 里的用户输入任何注入 HTML 的机会。
export function highlightSnippet(snippet: string, query: string): string {
  const escaped = escapeHtml(snippet);
  const q = query.trim();
  if (!q) {
    return escaped;
  }
  const needle = escapeRegExpLiteral(escapeHtml(q));
  if (!needle) {
    return escaped;
  }
  const pattern = new RegExp(needle, "giu");
  return escaped.replace(pattern, (match) => `<mark>${match}</mark>`);
}

// <2 字不发请求；>64 字提前拦（服务端也会拒，但本地先给人话提示，省一次网络往返）。
// 返回 undefined 表示这个长度应该真的去搜。
export function searchQueryHintMessage(trimmedLength: number, zh: boolean): string | undefined {
  if (trimmedLength === 0) {
    return zh
      ? "输入关键词，搜遍会话·网盘·工单·会议"
      : "Type to search across chat, drive, tasks, and meetings";
  }
  if (trimmedLength < SEARCH_QUERY_MIN_LENGTH) {
    return zh ? "再多打一个字才能搜（至少 2 个字）" : "Type at least 2 characters to search";
  }
  if (trimmedLength > SEARCH_QUERY_MAX_LENGTH) {
    return zh
      ? `关键词太长了，最多 ${SEARCH_QUERY_MAX_LENGTH} 个字符`
      : `Keep it under ${SEARCH_QUERY_MAX_LENGTH} characters`;
  }
  return undefined;
}

function searchLoadingHtml(zh: boolean): string {
  return `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在搜索…" : "Searching…"}</div>`;
}

export function searchHintHtml(zh: boolean, message: string): string {
  return `<p class="wh-spot-card-desc" data-search-hint="true">${escapeHtml(message)}</p>`;
}

function conversationSenderLabel(result: ConversationSearchResult, zh: boolean): string {
  if (result.sender_label) {
    return result.sender_label;
  }
  return result.sender_type === "agent" ? "Cuu" : zh ? "系统" : "System";
}

function conversationRowHtml(r: ConversationSearchResult, zh: boolean, query: string): string {
  const sender = conversationSenderLabel(r, zh);
  return `<button type="button" role="option" tabindex="-1" class="wh-spot-row" data-search-row="true" data-search-kind="conversation" data-search-project-id="${escapeHtml(r.deep_link.project_id)}" data-search-conversation-id="${escapeHtml(r.deep_link.conversation_id)}" data-search-seq="${escapeHtml(String(r.deep_link.seq))}">
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${escapeHtml(r.project_name)} · ${escapeHtml(r.conversation_title)}</div>
      <div class="wh-spot-row-sub">${escapeHtml(sender)}：${highlightSnippet(r.snippet, query)}</div>
    </div>
  </button>`;
}

function driveRowHtml(r: DriveSearchResult, zh: boolean, query: string): string {
  const matchLabel = matchedInLabel(r.matched_in, zh);
  return `<button type="button" role="option" tabindex="-1" class="wh-spot-row" data-search-row="true" data-search-kind="drive" data-search-project-id="${escapeHtml(r.project_id)}" data-search-item-id="${escapeHtml(r.item_id)}">
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${escapeHtml(r.project_name)} · ${escapeHtml(r.name)}</div>
      <div class="wh-spot-row-sub">${escapeHtml(matchLabel)}：${highlightSnippet(r.snippet, query)}</div>
    </div>
  </button>`;
}

function workItemRowHtml(r: WorkItemSearchResult, zh: boolean, query: string): string {
  const title = r.title ?? (zh ? "（未命名工单）" : "(Untitled)");
  const matchLabel = matchedInLabel(r.matched_in, zh);
  return `<button type="button" role="option" tabindex="-1" class="wh-spot-row" data-search-row="true" data-search-kind="workitem" data-search-work-item-id="${escapeHtml(r.work_item_id)}">
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${escapeHtml(r.code)} · ${escapeHtml(title)} <span class="wh-spot-row-tag">${escapeHtml(workItemStatusLabel(r.status, zh))}</span></div>
      <div class="wh-spot-row-sub">${escapeHtml(matchLabel)}：${highlightSnippet(r.snippet, query)}</div>
    </div>
  </button>`;
}

function meetingRowHtml(r: MeetingSearchResult, zh: boolean, query: string): string {
  const matchLabel = matchedInLabel(r.matched_in, zh);
  return `<button type="button" role="option" tabindex="-1" class="wh-spot-row" data-search-row="true" data-search-kind="meeting" data-search-project-id="${escapeHtml(r.project_id)}">
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${escapeHtml(r.project_name)} · ${escapeHtml(r.title)} <span class="wh-spot-row-tag">${escapeHtml(meetingStatusLabel(r.status, zh))}</span></div>
      <div class="wh-spot-row-sub">${escapeHtml(matchLabel)}：${highlightSnippet(r.snippet, query)}</div>
      <div class="wh-spot-row-sub">${escapeHtml(zh ? "会议详情暂不能从搜索直达，点开将在工作台打开该项目" : "Meeting detail isn't linkable yet — opens the project in the workbench")}</div>
    </div>
  </button>`;
}

function searchGroupHtml(group: SearchGroup, zh: boolean, query: string): string {
  const label = searchScopeLabel(group.scope, zh);
  let rows: string;
  switch (group.scope) {
    case "conversations":
      rows = group.results.map((r) => conversationRowHtml(r, zh, query)).join("");
      break;
    case "drive":
      rows = group.results.map((r) => driveRowHtml(r, zh, query)).join("");
      break;
    case "work_items":
      rows = group.results.map((r) => workItemRowHtml(r, zh, query)).join("");
      break;
    case "meetings":
      rows = group.results.map((r) => meetingRowHtml(r, zh, query)).join("");
      break;
    default:
      rows = "";
  }
  const count = group.results.length;
  const heading = count ? `${escapeHtml(label)}（${count}${group.has_more ? "+" : ""}）` : escapeHtml(label);
  const body = count
    ? `<div class="wh-spot-list">${rows}</div>${group.has_more ? `<p class="wh-spot-card-desc">${escapeHtml(zh ? "还有更多，换更精确的词" : "More results — try a more specific term")}</p>` : ""}`
    : `<p class="wh-spot-row-sub">${escapeHtml(zh ? "无匹配" : "No matches")}</p>`;
  return `<section class="wh-spot-search-group" data-search-group="${escapeHtml(group.scope)}">
    <p class="wh-spot-reasons-q">${heading}</p>
    ${body}
  </section>`;
}

// 恒按 SEARCH_SCOPE_ORDER 渲染（防御性重排——服务端已保证顺序，这里不依赖它）；四组永远都渲，
// 命中 0 的组灰显「无匹配」而不是消失——用户能看出「这四类我都真搜了」，不是悄悄漏了一类。
export function searchResultsHtml(vm: SearchResultsVm, zh: boolean): string {
  const ordered = SEARCH_SCOPE_ORDER.map((scope) => vm.groups.find((g) => g.scope === scope)).filter(
    (g): g is SearchGroup => Boolean(g)
  );
  const anyResults = ordered.some((g) => g.results.length > 0);
  const sections = ordered.map((g) => searchGroupHtml(g, zh, vm.query)).join("");
  const emptyBanner = anyResults
    ? ""
    : `<p class="wh-spot-row-sub" data-search-empty="true">${escapeHtml(zh ? `没有找到和「${vm.query}」匹配的内容` : `No matches for "${vm.query}"`)}</p>`;
  return `<div class="wh-spot-search-groups">${emptyBanner}${sections}</div>`;
}

export function searchShellHtml(zh: boolean): string {
  const placeholder = zh ? "搜会话、网盘、工单、会议…" : "Search chat, drive, tasks, meetings…";
  return `<div class="wh-spot-know">
    <div class="wh-spot-know-bar">
      <input class="wh-spot-freetext wh-spot-freetext--line" type="search" role="searchbox" data-search-input placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}" />
    </div>
    <div data-search-result></div>
  </div>`;
}

// ── 点击/回车直达：DOM dataset → 强类型动作。dataset 只是 Record<string,string|undefined>，
// 不依赖真实 DOM，纯逻辑可单测。 ────────────────────────────────────────────────────────────

export type SearchOpenAction =
  // #30：会话命中带 seq——工作台打开会话后按 seq 定位滚动 + 高亮该消息。
  | { kind: "conversation"; projectId: string; conversationId: string; seq?: number }
  | { kind: "drive"; projectId: string; itemId: string }
  | { kind: "workitem"; workItemId: string }
  | { kind: "meeting"; projectId: string };

export type SearchRowDataset = {
  searchKind?: string;
  searchProjectId?: string;
  searchConversationId?: string;
  searchSeq?: string;
  searchItemId?: string;
  searchWorkItemId?: string;
};

export function resolveSearchRowAction(dataset: SearchRowDataset): SearchOpenAction | undefined {
  switch (dataset.searchKind) {
    case "conversation": {
      if (!dataset.searchProjectId || !dataset.searchConversationId) {
        return undefined;
      }
      const parsedSeq = dataset.searchSeq === undefined ? Number.NaN : Number(dataset.searchSeq);
      const seq = Number.isInteger(parsedSeq) && parsedSeq >= 0 ? parsedSeq : undefined;
      return {
        kind: "conversation",
        projectId: dataset.searchProjectId,
        conversationId: dataset.searchConversationId,
        ...(seq !== undefined ? { seq } : {})
      };
    }
    case "drive":
      return dataset.searchProjectId && dataset.searchItemId
        ? { kind: "drive", projectId: dataset.searchProjectId, itemId: dataset.searchItemId }
        : undefined;
    case "workitem":
      return dataset.searchWorkItemId ? { kind: "workitem", workItemId: dataset.searchWorkItemId } : undefined;
    case "meeting":
      return dataset.searchProjectId ? { kind: "meeting", projectId: dataset.searchProjectId } : undefined;
    default:
      return undefined;
  }
}

// ── 键盘：结果间上下移动。纯索引数学 + 一层薄 DOM 接线。 ──────────────────────────────────────

export function nextSearchActiveIndex(current: number, delta: number, length: number): number {
  if (length <= 0) {
    return -1;
  }
  if (current < 0) {
    return delta >= 0 ? 0 : length - 1;
  }
  return (current + delta + length) % length;
}

// 结构判别而非 `instanceof KeyboardEvent`：Node 测试环境没有全局 KeyboardEvent 构造器（那是浏览器/
// webview 才有的 DOM 全局），`instanceof` 在那里会直接抛错。真实 keydown 事件恒有字符串 `.key`，
// 结构检查在浏览器/webview 生产环境行为等价，且能在 node:test 里用一个普通对象真实驱动这条监听器
// （见 search.test.ts 的键盘用例），不像其它 view 的同类判断那样测不到。
function isKeyboardEvent(event: Event): event is KeyboardEvent {
  return typeof (event as { key?: unknown }).key === "string";
}

// `Pick<HTMLElement, "querySelectorAll">` rather than a hand-rolled generic method signature: a real
// `ctx.body` satisfies this trivially, and tests can force-cast a plain `{ querySelectorAll: () => [...] }`
// fake through `unknown` without fighting TS's generic-method structural-compatibility checks.
export type SearchNavHost = Pick<HTMLElement, "querySelectorAll">;

export function moveSearchActive(container: SearchNavHost, delta: number): void {
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-search-row]"));
  if (rows.length === 0) {
    return;
  }
  const current = rows.findIndex((row) => row.dataset.searchActive === "true");
  const nextIndex = nextSearchActiveIndex(current, delta, rows.length);
  rows.forEach((row, index) => {
    if (index === nextIndex) {
      row.dataset.searchActive = "true";
    } else {
      delete row.dataset.searchActive;
    }
  });
  rows[nextIndex]?.scrollIntoView?.({ block: "nearest" });
}

// ── 视图接线：mount 聚焦输入框、输入防抖 300ms 拉取、点击/回车直达、上下键移动。 ──────────────────

export function createSearchView(): SpotlightCapabilityView {
  return {
    id: "search",
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      let disposed = false;
      let debounceTimer: ReturnType<typeof setTimeout> | undefined;
      // 单调代次：切query/切能力使在途请求作废，防旧结果覆盖新结果。
      let fetchGen = 0;
      let retry: (() => void) | undefined;

      ctx.setSubtitle(zh ? "跨会话·网盘·工单·会议" : "Across chat, drive, tasks, meetings");

      const renderResult = (html: string) => {
        const slot = ctx.body.querySelector<HTMLElement>("[data-search-result]");
        if (slot) {
          slot.innerHTML = html;
        }
        ctx.requestResize();
      };

      const runSearch = async (q: string) => {
        const gen = ++fetchGen;
        renderResult(searchLoadingHtml(zh));
        try {
          const base = driveResourceApiBase();
          const url = driveResourceHref(buildSearchRequestPath(q), base);
          const response = await fetchDriveResource(url, {}, base);
          const payload = (await response.json()) as { ok?: boolean; data?: unknown; error?: { message?: string } };
          if (!response.ok || payload.ok !== true) {
            throw new Error(payload.error?.message ?? "search failed");
          }
          const parsed = searchResultsVmSchema.safeParse(payload.data);
          if (!parsed.success) {
            throw new Error("malformed search response");
          }
          if (disposed || gen !== fetchGen) {
            return;
          }
          renderResult(searchResultsHtml(parsed.data, zh));
        } catch {
          if (disposed || gen !== fetchGen) {
            return;
          }
          retry = () => void runSearch(q);
          renderResult(spotlightErrorHtml(zh, zh ? "搜索失败" : "Search failed"));
        }
      };

      const scheduleSearch = (raw: string) => {
        if (debounceTimer !== undefined) {
          clearTimeout(debounceTimer);
          debounceTimer = undefined;
        }
        const trimmed = raw.trim();
        const hint = searchQueryHintMessage(trimmed.length, zh);
        if (hint) {
          // 让任何仍在飞的请求作废——用户已经把词改短/清空了，不该让它晚到覆盖提示态。
          fetchGen += 1;
          renderResult(searchHintHtml(zh, hint));
          return;
        }
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          void runSearch(trimmed);
        }, SEARCH_DEBOUNCE_MS);
      };

      const openInWorkbench = async (action: Extract<SearchOpenAction, { kind: "conversation" | "meeting" }>) => {
        const invoke = resolveDesktopTauriInvoke();
        if (!invoke) {
          ctx.toast(zh ? "工作台只在桌面客户端里可用" : "The workbench only opens in the desktop app", "info");
          return;
        }
        // 冷启动竞态兜底：invoke 之前同步写 stash（见 workbench/pending-deep-link.ts 顶部注释）。
        // #30：会话命中把 seq 一并 stash，工作台打开会话后据此定位滚动 + 高亮该消息。
        if (action.kind === "conversation") {
          stashPendingWorkbenchDeepLink({
            projectId: action.projectId,
            conversationId: action.conversationId,
            ...(action.seq !== undefined ? { seq: action.seq } : {})
          });
        } else {
          stashPendingWorkbenchDeepLink({ projectId: action.projectId });
        }
        try {
          await invoke("open_workbench", { projectId: action.projectId });
          ctx.toast(
            action.kind === "conversation"
              ? zh
                ? "已在工作台打开该会话"
                : "Opened the conversation in the workbench"
              : zh
                ? "已在工作台打开该项目，会议详情请在里面查看"
                : "Opened the project in the workbench — find the meeting there",
            "ok"
          );
        } catch {
          ctx.toast(zh ? "没打开工作台窗口，稍后重试" : "Couldn't open the workbench — try again", "error");
        }
      };

      const openSearchRow = (row: HTMLElement) => {
        const action = resolveSearchRowAction(row.dataset as SearchRowDataset);
        if (!action) {
          return;
        }
        if (action.kind === "drive") {
          ctx.open("drive", { id: action.projectId, route: `?item_id=${encodeURIComponent(action.itemId)}` });
          return;
        }
        if (action.kind === "workitem") {
          ctx.open("workitem", { id: action.workItemId });
          return;
        }
        void openInWorkbench(action);
      };

      ctx.body.innerHTML = searchShellHtml(zh);
      renderResult(searchHintHtml(zh, searchQueryHintMessage(0, zh) ?? ""));
      ctx.requestResize();
      ctx.body.querySelector<HTMLInputElement>("[data-search-input]")?.focus();

      ctx.body.addEventListener("input", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.matches("[data-search-input]")) {
          scheduleSearch((target as HTMLInputElement).value);
        }
      });

      ctx.body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        if (target.closest("[data-spot-retry]")) {
          retry?.();
          return;
        }
        const row = target.closest<HTMLElement>("[data-search-row]");
        if (row) {
          openSearchRow(row);
        }
      });

      ctx.body.addEventListener("keydown", (event) => {
        if (!isKeyboardEvent(event)) {
          return;
        }
        // R11：中文输入法组合态的回车/方向键是「选字」，不是导航——与顶层搜索框同款守卫。
        if (event.isComposing || event.keyCode === 229) {
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveSearchActive(ctx.body, 1);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          moveSearchActive(ctx.body, -1);
          return;
        }
        if (event.key === "Enter") {
          const rows = Array.from(ctx.body.querySelectorAll<HTMLElement>("[data-search-row]"));
          const active = rows.find((row) => row.dataset.searchActive === "true") ?? rows[0];
          if (active) {
            event.preventDefault();
            openSearchRow(active);
          }
        }
        // Esc 不在这里处理：顶层 controller 的 window keydown 监听器已经统一处理「退回 launcher」
        // （本视图没有内部 list→detail 层，SPOTLIGHT_INTERNAL_BACK_SELECTOR 查不到就直接 topLevelBack）。
      });

      return () => {
        disposed = true;
        if (debounceTimer !== undefined) {
          clearTimeout(debounceTimer);
        }
      };
    }
  };
}
