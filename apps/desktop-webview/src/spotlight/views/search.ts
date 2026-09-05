// WorkHub 桌面 · Spotlight「搜索全部」能力内联视图（R14 批 SEARCH，工包 W2）。
// 跨会话·网盘·工单·会议的统一检索——GET /api/search 契约见 packages/contracts/src/domain/search.ts
// （02-search-design.md §4/§5）。api-client 目前还没有 search() 方法（那是 W3 web-search-page 工包的活，
// 本工包禁碰 packages/**/apps/web/**）——沿用 drive.ts 已导出、明确供跨 view 复用的鉴权 fetch helper
// （fetchDriveResource/driveResourceApiBase/driveResourceHref，同一套 token 自愈逻辑），不重复造轮子。
//
// 深链降级说明（诚实披露，见设计 §6）：
// - 网盘/工单/会议结果都有真实的逐项深链（ctx.open("drive"/"workitem"/"meetings", {...})，目标 view
//   会直接展开该项）。F-09：会议能力视图落地后，会议结果不再降级到「打开工作台看项目」——
//   直接 ctx.open("meetings", { id: projectId, route: "?m=meetingId" }) 展开该场会议的详情。
// - 会话结果 MVP 只到会话级（invoke open_workbench + stashPendingWorkbenchDeepLink 带 conversationId，
//   不带 seq——stash payload 本就没有 seq 字段，精确滚动明确列为跨包依赖，不在本工包）。

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
import { meetingRecordStatusLabel as meetingStatusLabel, workItemStatusLabel } from "../labels.js";
import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";
import { driveResourceApiBase, driveResourceHref, fetchDriveResource } from "./drive.js";

import { spotlightViewsT } from "./locales.js";

export const SEARCH_DEBOUNCE_MS = 300;

// ── 纯函数：请求构造 / 文案 / 渲染 —— 与 DOM 接线分离，逐条可单测。 ──────────────────────────

export function buildSearchRequestPath(q: string, limit: number = SEARCH_LIMIT_DEFAULT): string {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return `/api/search?${params.toString()}`;
}

export function searchScopeLabel(scope: SearchScope, zh: boolean): string {
  switch (scope) {
    case "conversations":
      return spotlightViewsT(zh, "chat");
    case "drive":
      return spotlightViewsT(zh, "drive");
    case "work_items":
      return spotlightViewsT(zh, "tasks");
    case "meetings":
      return spotlightViewsT(zh, "meetings");
    default:
      // 契约新增了检索域而这里忘了配词时，宁可显示「其它」也不把 snake_case 的域名渲染给用户。
      return spotlightViewsT(zh, "other");
  }
}

export function matchedInLabel(matchedIn: SearchMatchedIn, zh: boolean): string {
  switch (matchedIn) {
    case "name":
      return spotlightViewsT(zh, "filename");
    case "body":
      return spotlightViewsT(zh, "content");
    case "title":
      return spotlightViewsT(zh, "title");
    case "description":
      return spotlightViewsT(zh, "description");
    case "text":
      return spotlightViewsT(zh, "message");
    case "minutes":
      return spotlightViewsT(zh, "minutes");
    default:
      return spotlightViewsT(zh, "content2");
  }
}

// F-09：会议状态词表现在与「会议」能力视图共用（../labels.js meetingRecordStatusLabel），不再在这里
// 单独维护一份——避免同一枚举值在搜索结果行与会议详情页里被翻成两种不同的话。仍按原名字导出，
// search.test.ts 与旧调用点不用改。
export { meetingStatusLabel };

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
    return spotlightViewsT(zh, "typeToSearchAcrossChatDrive");
  }
  if (trimmedLength < SEARCH_QUERY_MIN_LENGTH) {
    return spotlightViewsT(zh, "typeAtLeast2CharactersTo");
  }
  if (trimmedLength > SEARCH_QUERY_MAX_LENGTH) {
    return zh
      ? `关键词太长了，最多 ${SEARCH_QUERY_MAX_LENGTH} 个字符`
      : `Keep it under ${SEARCH_QUERY_MAX_LENGTH} characters`;
  }
  return undefined;
}

function searchLoadingHtml(zh: boolean): string {
  return `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(zh, "searching2")}</div>`;
}

export function searchHintHtml(zh: boolean, message: string): string {
  return `<p class="wh-spot-card-desc" data-search-hint="true">${escapeHtml(message)}</p>`;
}

function conversationSenderLabel(result: ConversationSearchResult, zh: boolean): string {
  if (result.sender_label) {
    return result.sender_label;
  }
  return result.sender_type === "agent" ? "Cuu" : spotlightViewsT(zh, "system");
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
  const title = r.title ?? (spotlightViewsT(zh, "untitled"));
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
  // F-09：会议结果现在带 meeting_id，直达会议详情（不再降级到工作台项目级）。
  return `<button type="button" role="option" tabindex="-1" class="wh-spot-row" data-search-row="true" data-search-kind="meeting" data-search-project-id="${escapeHtml(r.project_id)}" data-search-meeting-id="${escapeHtml(r.meeting_id)}">
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${escapeHtml(r.project_name)} · ${escapeHtml(r.title)} <span class="wh-spot-row-tag">${escapeHtml(meetingStatusLabel(r.status, zh))}</span></div>
      <div class="wh-spot-row-sub">${escapeHtml(matchLabel)}：${highlightSnippet(r.snippet, query)}</div>
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
    ? `<div class="wh-spot-list">${rows}</div>${group.has_more ? `<p class="wh-spot-card-desc">${escapeHtml(spotlightViewsT(zh, "moreResultsTryAMoreSpecific"))}</p>` : ""}`
    : `<p class="wh-spot-row-sub">${escapeHtml(spotlightViewsT(zh, "noMatches"))}</p>`;
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
  const placeholder = spotlightViewsT(zh, "searchChatDriveTasksMeetings");
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
  // F-09：会议命中现在带 meetingId——直达该场会议详情（不再只到项目级）。
  | { kind: "meeting"; projectId: string; meetingId: string };

export type SearchRowDataset = {
  searchKind?: string;
  searchProjectId?: string;
  searchConversationId?: string;
  searchSeq?: string;
  searchItemId?: string;
  searchWorkItemId?: string;
  searchMeetingId?: string;
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
      return dataset.searchProjectId && dataset.searchMeetingId
        ? { kind: "meeting", projectId: dataset.searchProjectId, meetingId: dataset.searchMeetingId }
        : undefined;
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

      ctx.setSubtitle(spotlightViewsT(ctx.locale, "acrossChatDriveTasksMeetings"));

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
          renderResult(spotlightErrorHtml(zh, spotlightViewsT(ctx.locale, "searchFailed2")));
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

      const openInWorkbench = async (action: Extract<SearchOpenAction, { kind: "conversation" }>) => {
        const invoke = resolveDesktopTauriInvoke();
        if (!invoke) {
          ctx.toast(spotlightViewsT(ctx.locale, "theWorkbenchOnlyOpensInThe"), "info");
          return;
        }
        // 冷启动竞态兜底：invoke 之前同步写 stash（见 workbench/pending-deep-link.ts 顶部注释）。
        // #30：会话命中把 seq 一并 stash，工作台打开会话后据此定位滚动 + 高亮该消息。
        stashPendingWorkbenchDeepLink({
          projectId: action.projectId,
          conversationId: action.conversationId,
          ...(action.seq !== undefined ? { seq: action.seq } : {})
        });
        try {
          await invoke("open_workbench", { projectId: action.projectId });
          ctx.toast(spotlightViewsT(ctx.locale, "openedTheConversationInTheWorkbench"), "ok");
        } catch {
          ctx.toast(spotlightViewsT(ctx.locale, "couldnTOpenTheWorkbenchTry"), "error");
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
        if (action.kind === "meeting") {
          // F-09：会议能力视图落地——直达该场会议详情，不再降级到工作台项目级。
          ctx.open("meetings", { id: action.projectId, route: `?m=${encodeURIComponent(action.meetingId)}` });
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
