import assert from "node:assert/strict";
import { test } from "node:test";

import type { SearchResultsVm } from "@workhub/contracts";

import {
  buildSearchRequestPath,
  createSearchView,
  highlightSnippet,
  matchedInLabel,
  meetingStatusLabel,
  moveSearchActive,
  nextSearchActiveIndex,
  resolveSearchRowAction,
  searchHintHtml,
  searchQueryHintMessage,
  searchResultsHtml,
  searchScopeLabel,
  searchShellHtml,
  SEARCH_DEBOUNCE_MS,
  type SearchNavHost,
  type SearchRowDataset
} from "./search.js";
import type { SpotlightViewContext } from "../view-context.js";

const PROJECT_ID = "80000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "80000000-0000-4000-8000-000000000002";
const MESSAGE_ID = "80000000-0000-4000-8000-000000000003";
const ITEM_ID = "80000000-0000-4000-8000-000000000004";
const WORK_ITEM_ID = "80000000-0000-4000-8000-000000000005";

function fixtureVm(overrides: Partial<SearchResultsVm> = {}): SearchResultsVm {
  return {
    query: "预算",
    groups: [
      {
        scope: "conversations",
        has_more: false,
        results: [
          {
            message_id: MESSAGE_ID,
            conversation_id: CONVERSATION_ID,
            project_id: PROJECT_ID,
            project_name: "增长项目",
            conversation_title: "主群聊",
            seq: 5,
            sender_type: "agent",
            sender_user_id: null,
            sender_label: null,
            matched_in: "text",
            snippet: "这季度的预算还没批",
            created_at: "2026-07-10T00:00:00.000Z",
            deep_link: { project_id: PROJECT_ID, conversation_id: CONVERSATION_ID, seq: 5 }
          }
        ]
      },
      {
        scope: "drive",
        has_more: true,
        results: [
          {
            item_id: ITEM_ID,
            project_id: PROJECT_ID,
            project_name: "增长项目",
            name: "Q3预算.xlsx",
            kind: "file",
            matched_in: "name",
            snippet: "Q3预算.xlsx",
            updated_at: "2026-07-10T00:00:00.000Z"
          }
        ]
      },
      {
        scope: "work_items",
        has_more: false,
        results: [
          {
            work_item_id: WORK_ITEM_ID,
            code: "WH-1",
            project_id: PROJECT_ID,
            project_name: "增长项目",
            title: "编制预算表",
            status: "ai_working",
            matched_in: "title",
            snippet: "编制预算表",
            updated_at: "2026-07-10T00:00:00.000Z"
          }
        ]
      },
      { scope: "meetings", has_more: false, results: [] }
    ],
    ...overrides
  } as SearchResultsVm;
}

// ── 纯函数 ────────────────────────────────────────────────────────────────

test("buildSearchRequestPath encodes q + limit, no scopes param (client always wants all four)", () => {
  const path = buildSearchRequestPath("预算");
  assert.match(path, /^\/api\/search\?/u);
  const params = new URLSearchParams(path.split("?")[1]);
  assert.equal(params.get("q"), "预算");
  assert.equal(params.get("limit"), "10");
  assert.equal(params.get("scopes"), null);
});

test("buildSearchRequestPath threads a custom limit through", () => {
  const params = new URLSearchParams(buildSearchRequestPath("abc", 25).split("?")[1]);
  assert.equal(params.get("limit"), "25");
});

test("searchScopeLabel gives human labels for all four scopes, zh + en", () => {
  assert.equal(searchScopeLabel("conversations", true), "会话");
  assert.equal(searchScopeLabel("drive", true), "网盘");
  assert.equal(searchScopeLabel("work_items", true), "工单");
  assert.equal(searchScopeLabel("meetings", true), "会议");
  assert.equal(searchScopeLabel("conversations", false), "Chat");
  assert.equal(searchScopeLabel("drive", false), "Drive");
  assert.equal(searchScopeLabel("work_items", false), "Tasks");
  assert.equal(searchScopeLabel("meetings", false), "Meetings");
});

test("matchedInLabel covers every matched_in value from the contract", () => {
  assert.equal(matchedInLabel("name", true), "文件名");
  assert.equal(matchedInLabel("body", true), "正文");
  assert.equal(matchedInLabel("title", true), "标题");
  assert.equal(matchedInLabel("description", true), "描述");
  assert.equal(matchedInLabel("text", true), "正文");
  assert.equal(matchedInLabel("minutes", true), "纪要");
});

test("meetingStatusLabel translates known statuses and passes unknown ones through honestly", () => {
  assert.equal(meetingStatusLabel("processing", true), "处理中");
  assert.equal(meetingStatusLabel("ready", false), "Ready");
  assert.equal(meetingStatusLabel("some_future_status", true), "some_future_status");
});

test("highlightSnippet escapes HTML first, then wraps matches (case-insensitive) in <mark>", () => {
  assert.equal(highlightSnippet("Q3预算.xlsx", "预算"), "Q3<mark>预算</mark>.xlsx");
  assert.equal(highlightSnippet("Budget report", "budget"), "<mark>Budget</mark> report");
  assert.equal(highlightSnippet("no match here", "预算"), "no match here");
  assert.equal(highlightSnippet("", "预算"), "");
  // empty query: just escape, no highlighting.
  assert.equal(highlightSnippet("plain", ""), "plain");
});

test("highlightSnippet cannot be used to inject HTML via the snippet or the query", () => {
  const html = highlightSnippet('<img src=x onerror=alert(1)>预算', "预算");
  assert.doesNotMatch(html, /<img/u);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;<mark>预算<\/mark>/u);
  // a query containing regex metacharacters must not throw or behave like a regex.
  assert.doesNotThrow(() => highlightSnippet("50% off", "50%"));
  assert.equal(highlightSnippet("50% off", "50%"), "<mark>50%</mark> off");
});

test("searchQueryHintMessage: boundary cases around the 2-64 char contract window", () => {
  assert.match(searchQueryHintMessage(0, true) ?? "", /输入关键词/u);
  assert.match(searchQueryHintMessage(1, true) ?? "", /至少 2 个字/u);
  assert.equal(searchQueryHintMessage(2, true), undefined);
  assert.equal(searchQueryHintMessage(64, true), undefined);
  assert.match(searchQueryHintMessage(65, true) ?? "", /最多 64 个字符/u);
  assert.match(searchQueryHintMessage(0, false) ?? "", /Type to search/u);
  assert.match(searchQueryHintMessage(65, false) ?? "", /under 64 characters/u);
});

test("searchHintHtml escapes and renders a plain muted line, no emoji", () => {
  const html = searchHintHtml(true, "输入关键词，搜遍会话·网盘·工单·会议");
  assert.match(html, /data-search-hint="true"/u);
  assert.match(html, /输入关键词/u);
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});

test("searchShellHtml renders a search input, auto-focusable, no emoji", () => {
  const html = searchShellHtml(true);
  assert.match(html, /data-search-input/u);
  assert.match(html, /type="search"/u);
  assert.match(html, /data-search-result/u);
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});

test("searchResultsHtml renders all four scope groups in fixed order with human headings", () => {
  const html = searchResultsHtml(fixtureVm(), true);
  const conv = html.indexOf('data-search-group="conversations"');
  const drive = html.indexOf('data-search-group="drive"');
  const wi = html.indexOf('data-search-group="work_items"');
  const meet = html.indexOf('data-search-group="meetings"');
  assert.ok(conv >= 0 && drive > conv && wi > drive && meet > wi, "groups render in SEARCH_SCOPE_ORDER");
  assert.match(html, /会话（1）/u);
  assert.match(html, /网盘（1\+）/u); // has_more appends a "+"
  assert.match(html, /工单（1）/u);
  assert.match(html, /会议<\/p>/u); // zero-result group: no count suffix
  assert.match(html, /无匹配/u);
  assert.match(html, /还有更多，换更精确的词/u);
});

test("searchResultsHtml highlights the query inside each row's snippet", () => {
  const html = searchResultsHtml(fixtureVm(), true);
  assert.match(html, /<mark>预算<\/mark>/u);
});

test("searchResultsHtml honestly labels the all-empty case instead of pretending nothing was searched", () => {
  const empty = fixtureVm({
    groups: [
      { scope: "conversations", has_more: false, results: [] },
      { scope: "drive", has_more: false, results: [] },
      { scope: "work_items", has_more: false, results: [] },
      { scope: "meetings", has_more: false, results: [] }
    ]
  });
  const html = searchResultsHtml(empty, true);
  assert.match(html, /data-search-empty="true"/u);
  assert.match(html, /没有找到和「预算」匹配的内容/u);
  // still shows all four (grey) sections, not a single collapsed blob.
  assert.equal((html.match(/data-search-group=/gu) ?? []).length, 4);
});

test("searchResultsHtml renders a null work-item title as an honest placeholder, not 'null'", () => {
  const vm = fixtureVm({
    groups: [
      { scope: "conversations", has_more: false, results: [] },
      { scope: "drive", has_more: false, results: [] },
      {
        scope: "work_items",
        has_more: false,
        results: [
          {
            work_item_id: WORK_ITEM_ID,
            code: "WH-2",
            project_id: PROJECT_ID,
            project_name: "增长项目",
            title: null,
            status: "intake",
            matched_in: "description",
            snippet: "还没定标题的早期条目",
            updated_at: "2026-07-10T00:00:00.000Z"
          }
        ]
      },
      { scope: "meetings", has_more: false, results: [] }
    ]
  });
  const html = searchResultsHtml(vm, true);
  assert.match(html, /（未命名工单）/u);
  assert.doesNotMatch(html, />null</u);
});

test("searchResultsHtml gives meetings an honest degrade note (no per-meeting deep link exists)", () => {
  const vm = fixtureVm({
    groups: [
      { scope: "conversations", has_more: false, results: [] },
      { scope: "drive", has_more: false, results: [] },
      { scope: "work_items", has_more: false, results: [] },
      {
        scope: "meetings",
        has_more: false,
        results: [
          {
            meeting_id: "80000000-0000-4000-8000-000000000006",
            project_id: PROJECT_ID,
            project_name: "增长项目",
            title: "季度评审",
            status: "ready",
            matched_in: "minutes",
            snippet: "预算口径统一为季度制",
            created_at: "2026-07-10T00:00:00.000Z"
          }
        ]
      }
    ]
  });
  const html = searchResultsHtml(vm, true);
  assert.match(html, /会议详情暂不能从搜索直达/u);
  assert.match(html, /data-search-kind="meeting"/u);
  assert.match(html, new RegExp(`data-search-project-id="${PROJECT_ID}"`, "u"));
});

test("searchResultsHtml wires drive/workitem/conversation rows with the exact dataset the click handler expects", () => {
  const html = searchResultsHtml(fixtureVm(), true);
  assert.match(html, new RegExp(`data-search-kind="conversation"[^>]*data-search-project-id="${PROJECT_ID}"[^>]*data-search-conversation-id="${CONVERSATION_ID}"`, "u"));
  assert.match(html, new RegExp(`data-search-kind="drive"[^>]*data-search-project-id="${PROJECT_ID}"[^>]*data-search-item-id="${ITEM_ID}"`, "u"));
  assert.match(html, new RegExp(`data-search-kind="workitem"[^>]*data-search-work-item-id="${WORK_ITEM_ID}"`, "u"));
});

// ── resolveSearchRowAction (dataset → strong action) ────────────────────────

test("resolveSearchRowAction resolves each kind from its dataset, and rejects incomplete ones", () => {
  assert.deepEqual(
    resolveSearchRowAction({ searchKind: "conversation", searchProjectId: "p1", searchConversationId: "c1" }),
    { kind: "conversation", projectId: "p1", conversationId: "c1" }
  );
  assert.equal(resolveSearchRowAction({ searchKind: "conversation", searchProjectId: "p1" }), undefined);
  assert.deepEqual(
    resolveSearchRowAction({ searchKind: "drive", searchProjectId: "p1", searchItemId: "i1" }),
    { kind: "drive", projectId: "p1", itemId: "i1" }
  );
  assert.equal(resolveSearchRowAction({ searchKind: "drive", searchProjectId: "p1" }), undefined);
  assert.deepEqual(resolveSearchRowAction({ searchKind: "workitem", searchWorkItemId: "w1" }), {
    kind: "workitem",
    workItemId: "w1"
  });
  assert.equal(resolveSearchRowAction({ searchKind: "workitem" }), undefined);
  assert.deepEqual(resolveSearchRowAction({ searchKind: "meeting", searchProjectId: "p1" }), {
    kind: "meeting",
    projectId: "p1"
  });
  assert.equal(resolveSearchRowAction({}), undefined);
  assert.equal(resolveSearchRowAction({ searchKind: "bogus" } as SearchRowDataset), undefined);
});

// ── keyboard nav math ────────────────────────────────────────────────────

test("nextSearchActiveIndex wraps in both directions and starts sensibly from 'nothing active'", () => {
  assert.equal(nextSearchActiveIndex(-1, 1, 3), 0); // first ArrowDown selects the first row
  assert.equal(nextSearchActiveIndex(-1, -1, 3), 2); // first ArrowUp selects the last row
  assert.equal(nextSearchActiveIndex(0, 1, 3), 1);
  assert.equal(nextSearchActiveIndex(2, 1, 3), 0); // wraps forward
  assert.equal(nextSearchActiveIndex(0, -1, 3), 2); // wraps backward
  assert.equal(nextSearchActiveIndex(-1, 1, 0), -1); // no rows
});

class FakeRow {
  public dataset: Record<string, string> = {};
  public scrollCalls = 0;
  scrollIntoView() {
    this.scrollCalls += 1;
  }
}

test("moveSearchActive toggles data-search-active on exactly one row and scrolls it into view", () => {
  const rows = [new FakeRow(), new FakeRow(), new FakeRow()];
  const container = { querySelectorAll: () => rows } as unknown as SearchNavHost;
  moveSearchActive(container, 1);
  assert.deepEqual(rows.map((r) => r.dataset.searchActive), ["true", undefined, undefined]);
  assert.equal(rows[0]!.scrollCalls, 1);
  moveSearchActive(container, 1);
  assert.deepEqual(rows.map((r) => r.dataset.searchActive), [undefined, "true", undefined]);
  moveSearchActive(container, -1);
  assert.deepEqual(rows.map((r) => r.dataset.searchActive), ["true", undefined, undefined]);
});

test("moveSearchActive is a no-op on an empty result set", () => {
  const container = { querySelectorAll: () => [] } as unknown as SearchNavHost;
  assert.doesNotThrow(() => moveSearchActive(container, 1));
});

// ── mount() wiring ─────────────────────────────────────────────────────────

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

class FakeElement {
  public dataset: Record<string, string> = {};
  public value = "";
  public focusCalls = 0;
  private readonly queryResults = new Map<string, FakeElement>();
  private readonly queryAllResults = new Map<string, FakeElement[]>();

  constructor(private readonly selectors = new Set<string>()) {}

  closest<T extends Element = Element>(selector: string): T | null {
    return this.selectors.has(selector) ? (this as unknown as T) : null;
  }

  matches(selector: string): boolean {
    return this.selectors.has(selector);
  }

  focus() {
    this.focusCalls += 1;
  }

  querySelector<T extends Element = Element>(selector: string): T | null {
    return (this.queryResults.get(selector) as unknown as T) ?? null;
  }

  querySelectorAll<T extends Element = Element>(selector: string): T[] {
    return (this.queryAllResults.get(selector) as unknown as T[]) ?? [];
  }

  setQueryResult(selector: string, element: FakeElement): void {
    this.queryResults.set(selector, element);
  }

  setQueryAllResult(selector: string, elements: FakeElement[]): void {
    this.queryAllResults.set(selector, elements);
  }
}

class ResultSlot extends FakeElement {
  public innerHTML = "";
}

class SearchInput extends FakeElement {
  constructor() {
    super(new Set(["[data-search-input]"]));
  }
}

class FakeBody extends FakeElement {
  public innerHTML = "";
  private readonly clickListeners: Array<(event: { target: unknown }) => void> = [];
  private readonly inputListeners: Array<(event: { target: unknown }) => void> = [];
  private readonly keydownListeners: Array<(event: unknown) => void> = [];

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const bucket =
      type === "click" ? this.clickListeners : type === "input" ? this.inputListeners : type === "keydown" ? this.keydownListeners : undefined;
    if (!bucket) return;
    bucket.push((event) => {
      if (typeof listener === "function") {
        listener(event as unknown as Event);
      } else {
        listener.handleEvent(event as unknown as Event);
      }
    });
  }

  click(target: FakeElement) {
    for (const listener of this.clickListeners) listener({ target });
  }

  input(target: FakeElement) {
    for (const listener of this.inputListeners) listener({ target });
  }

  keydown(event: unknown) {
    for (const listener of this.keydownListeners) listener(event);
  }
}

async function withFakeHTMLElement<T>(run: () => Promise<T> | T): Promise<T> {
  const globals = globalThis as typeof globalThis & { HTMLElement: typeof HTMLElement };
  const previous = globals.HTMLElement;
  globals.HTMLElement = FakeElement as unknown as typeof HTMLElement;
  try {
    return await run();
  } finally {
    globals.HTMLElement = previous;
  }
}

function withMockedSetTimeout<T>(run: (scheduled: Array<{ fn: () => void; ms: number }>) => Promise<T> | T): Promise<T> {
  const previous = globalThis.setTimeout;
  const scheduled: Array<{ fn: () => void; ms: number }> = [];
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void, ms?: number) => {
    scheduled.push({ fn, ms: ms ?? 0 });
    return scheduled.length as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const restore = () => {
    (globalThis as { setTimeout: unknown }).setTimeout = previous;
  };
  try {
    const result = run(scheduled);
    if (result instanceof Promise) {
      return result.finally(restore);
    }
    restore();
    return Promise.resolve(result);
  } catch (error) {
    restore();
    throw error;
  }
}

function withMockedFetch<T>(handler: (url: string) => Response | Promise<Response>, run: () => Promise<T> | T): Promise<T> {
  const previous = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: string | URL | Request) => handler(String(input))
  });
  const restore = () => {
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: previous });
  };
  return Promise.resolve(run()).finally(restore);
}

function baseCtx(
  body: FakeBody,
  overrides: Partial<SpotlightViewContext> & { toasts?: Array<{ message: string; tone?: string }> } = {}
): SpotlightViewContext {
  return {
    body: body as unknown as HTMLElement,
    locale: "zh-CN",
    client: {} as SpotlightViewContext["client"],
    back() {},
    resetShell() {},
    open() {},
    setSubtitle() {},
    toast() {},
    requestResize() {},
    refocusBody() {},
    signal: new AbortController().signal,
    ...overrides
  } as SpotlightViewContext;
}

test("mount focuses the search input and shows the initial guiding hint (no fetch yet)", async () => {
  await withFakeHTMLElement(async () => {
    const body = new FakeBody();
    const input = new SearchInput();
    const slot = new ResultSlot();
    body.setQueryResult("[data-search-input]", input);
    body.setQueryResult("[data-search-result]", slot);
    let fetchCalled = false;
    await withMockedFetch(
      () => {
        fetchCalled = true;
        throw new Error("must not fetch before the user types anything");
      },
      () => {
        createSearchView().mount(baseCtx(body));
      }
    );
    assert.equal(input.focusCalls, 1);
    assert.match(slot.innerHTML, /输入关键词/u);
    assert.equal(fetchCalled, false);
  });
});

test("typing 1 character shows the 'type more' hint and does not schedule a fetch", async () => {
  await withFakeHTMLElement(async () => {
    const body = new FakeBody();
    const input = new SearchInput();
    const slot = new ResultSlot();
    body.setQueryResult("[data-search-input]", input);
    body.setQueryResult("[data-search-result]", slot);
    await withMockedSetTimeout((scheduled) => {
      createSearchView().mount(baseCtx(body));
      const typed = new SearchInput();
      typed.value = "预";
      body.input(typed);
      assert.equal(scheduled.length, 0);
      assert.match(slot.innerHTML, /至少 2 个字/u);
    });
  });
});

test("typing >=2 characters debounces 300ms then fetches /api/search and renders grouped results", async () => {
  await withFakeHTMLElement(async () => {
    const body = new FakeBody();
    const input = new SearchInput();
    const slot = new ResultSlot();
    body.setQueryResult("[data-search-input]", input);
    body.setQueryResult("[data-search-result]", slot);
    const urls: string[] = [];
    // NB: the fetch mock must still be active when the debounce timer actually fires (the whole
    // point of this test) — nest setTimeout-mocking *inside* fetch-mocking's run callback so the
    // fetch mock is never restored before `scheduled[0].fn()` runs. Getting this backwards once
    // leaked a real, un-awaited network call into the process that corrupted a later test.
    await withMockedFetch(
      (url) => {
        urls.push(url);
        return new Response(JSON.stringify({ ok: true, data: fixtureVm({ query: "预算" }) }), { status: 200 });
      },
      () =>
        withMockedSetTimeout(async (scheduled) => {
          createSearchView().mount(baseCtx(body));
          const typed = new SearchInput();
          typed.value = "预算";
          body.input(typed);
          assert.equal(scheduled.length, 1);
          assert.equal(scheduled[0]!.ms, SEARCH_DEBOUNCE_MS);
          scheduled[0]!.fn();
          await tick();
          await tick();
        })
    );
    assert.equal(urls.length, 1);
    assert.match(urls[0]!, /\/api\/search\?q=%E9%A2%84%E7%AE%97&limit=10/u);
    assert.match(slot.innerHTML, /会话（1）/u);
  });
});

test("a failed search renders a retry affordance, and retry re-issues the same query", async () => {
  await withFakeHTMLElement(async () => {
    const body = new FakeBody();
    const input = new SearchInput();
    const slot = new ResultSlot();
    body.setQueryResult("[data-search-input]", input);
    body.setQueryResult("[data-search-result]", slot);
    let attempts = 0;
    await withMockedFetch(
      () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response(JSON.stringify({ ok: false, error: { message: "boom" } }), { status: 500 });
        }
        return new Response(JSON.stringify({ ok: true, data: fixtureVm() }), { status: 200 });
      },
      async () => {
        await withMockedSetTimeout(async (scheduled) => {
          createSearchView().mount(baseCtx(body));
          const typed = new SearchInput();
          typed.value = "预算";
          body.input(typed);
          assert.equal(scheduled.length, 1);
          scheduled[0]!.fn();
          await tick();
          await tick();
        });
        assert.equal(attempts, 1);
        assert.match(slot.innerHTML, /搜索失败/u);
        assert.match(slot.innerHTML, /data-spot-retry/u);

        const retryBtn = new FakeElement(new Set(["[data-spot-retry]"]));
        body.click(retryBtn);
        await tick();
        await tick();
        assert.equal(attempts, 2);
        assert.match(slot.innerHTML, /会话（1）/u);
      }
    );
  });
});

test("clicking a drive row opens the drive capability with an item deep link", async () => {
  await withFakeHTMLElement(async () => {
    const opened: Array<[string, unknown]> = [];
    const body = new FakeBody();
    createSearchView().mount(baseCtx(body, { open: (id, target) => opened.push([id, target]) }));
    const row = new FakeElement(new Set(["[data-search-row]"]));
    row.dataset = { searchRow: "true", searchKind: "drive", searchProjectId: PROJECT_ID, searchItemId: ITEM_ID };
    body.click(row);
    assert.deepEqual(opened, [["drive", { id: PROJECT_ID, route: `?item_id=${ITEM_ID}` }]]);
  });
});

test("clicking a work-item row opens the workitem capability directly on that item", async () => {
  await withFakeHTMLElement(async () => {
    const opened: Array<[string, unknown]> = [];
    const body = new FakeBody();
    createSearchView().mount(baseCtx(body, { open: (id, target) => opened.push([id, target]) }));
    const row = new FakeElement(new Set(["[data-search-row]"]));
    row.dataset = { searchRow: "true", searchKind: "workitem", searchWorkItemId: WORK_ITEM_ID };
    body.click(row);
    assert.deepEqual(opened, [["workitem", { id: WORK_ITEM_ID }]]);
  });
});

test("clicking a conversation row invokes open_workbench with a project+conversation stash and toasts success", async () => {
  await withFakeHTMLElement(async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: async (command: string, args?: Record<string, unknown>) => (calls.push([command, args]), undefined) }
    };
    const storageValues = new Map<string, string>();
    const globals = globalThis as unknown as { window?: unknown };
    globals.window = {
      localStorage: {
        getItem: (key: string) => storageValues.get(key) ?? null,
        setItem: (key: string, value: string) => storageValues.set(key, value),
        removeItem: (key: string) => storageValues.delete(key)
      }
    };
    const toasts: Array<{ message: string; tone?: string | undefined }> = [];
    try {
      const body = new FakeBody();
      createSearchView().mount(baseCtx(body, { toast: (message, tone) => toasts.push({ message, tone }) }));
      const row = new FakeElement(new Set(["[data-search-row]"]));
      row.dataset = {
        searchRow: "true",
        searchKind: "conversation",
        searchProjectId: PROJECT_ID,
        searchConversationId: CONVERSATION_ID
      };
      body.click(row);
      const stashed = JSON.parse(storageValues.get("workhub_workbench_pending_deep_link")!) as {
        projectId?: string;
        conversationId?: string;
      };
      assert.equal(stashed.projectId, PROJECT_ID);
      assert.equal(stashed.conversationId, CONVERSATION_ID);
      await tick();
      assert.deepEqual(calls, [["open_workbench", { projectId: PROJECT_ID }]]);
      assert.equal(toasts.length, 1);
      assert.equal(toasts[0]!.tone, "ok");
      assert.match(toasts[0]!.message, /已在工作台打开该会话/u);
    } finally {
      delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
      delete globals.window;
    }
  });
});

test("clicking a meeting row degrades honestly: opens the project only (no conversationId), with a degrade toast", async () => {
  await withFakeHTMLElement(async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: async (command: string, args?: Record<string, unknown>) => (calls.push([command, args]), undefined) }
    };
    const toasts: Array<{ message: string; tone?: string | undefined }> = [];
    try {
      const body = new FakeBody();
      createSearchView().mount(baseCtx(body, { toast: (message, tone) => toasts.push({ message, tone }) }));
      const row = new FakeElement(new Set(["[data-search-row]"]));
      row.dataset = { searchRow: "true", searchKind: "meeting", searchProjectId: PROJECT_ID };
      body.click(row);
      await tick();
      assert.deepEqual(calls, [["open_workbench", { projectId: PROJECT_ID }]]);
      assert.equal(toasts[0]!.tone, "ok");
      assert.match(toasts[0]!.message, /已在工作台打开该项目，会议详情请在里面查看/u);
    } finally {
      delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    }
  });
});

test("a row click without a Tauri bridge (browser dev preview) gives an honest 'desktop only' toast, no crash", async () => {
  await withFakeHTMLElement(async () => {
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    const toasts: Array<{ message: string; tone?: string | undefined }> = [];
    const body = new FakeBody();
    createSearchView().mount(baseCtx(body, { toast: (message, tone) => toasts.push({ message, tone }) }));
    const row = new FakeElement(new Set(["[data-search-row]"]));
    row.dataset = { searchRow: "true", searchKind: "meeting", searchProjectId: PROJECT_ID };
    body.click(row);
    await tick();
    assert.equal(toasts.length, 1);
    assert.match(toasts[0]!.message, /只在桌面客户端里可用/u);
  });
});

test("ArrowDown/ArrowUp move the active row and Enter opens whichever row is active", async () => {
  await withFakeHTMLElement(async () => {
    const opened: Array<[string, unknown]> = [];
    const body = new FakeBody();
    createSearchView().mount(baseCtx(body, { open: (id, target) => opened.push([id, target]) }));
    const rowA = new FakeElement(new Set(["[data-search-row]"]));
    rowA.dataset = { searchRow: "true", searchKind: "workitem", searchWorkItemId: "wa" };
    const rowB = new FakeElement(new Set(["[data-search-row]"]));
    rowB.dataset = { searchRow: "true", searchKind: "workitem", searchWorkItemId: "wb" };
    body.setQueryAllResult("[data-search-row]", [rowA, rowB]);

    body.keydown({ key: "ArrowDown", preventDefault() {} });
    assert.equal(rowA.dataset.searchActive, "true");
    assert.equal(rowB.dataset.searchActive, undefined);

    body.keydown({ key: "ArrowDown", preventDefault() {} });
    assert.equal(rowA.dataset.searchActive, undefined);
    assert.equal(rowB.dataset.searchActive, "true");

    body.keydown({ key: "Enter", preventDefault() {} });
    assert.deepEqual(opened, [["workitem", { id: "wb" }]]);
  });
});

test("Enter with nothing arrowed-to yet opens the first row", async () => {
  await withFakeHTMLElement(async () => {
    const opened: Array<[string, unknown]> = [];
    const body = new FakeBody();
    createSearchView().mount(baseCtx(body, { open: (id, target) => opened.push([id, target]) }));
    const rowA = new FakeElement(new Set(["[data-search-row]"]));
    rowA.dataset = { searchRow: "true", searchKind: "workitem", searchWorkItemId: "first" };
    body.setQueryAllResult("[data-search-row]", [rowA]);
    body.keydown({ key: "Enter", preventDefault() {} });
    assert.deepEqual(opened, [["workitem", { id: "first" }]]);
  });
});

test("an IME composition Enter/ArrowDown is ignored (R11 guard, matches the rest of the box)", async () => {
  await withFakeHTMLElement(async () => {
    const opened: Array<[string, unknown]> = [];
    const body = new FakeBody();
    createSearchView().mount(baseCtx(body, { open: (id, target) => opened.push([id, target]) }));
    const rowA = new FakeElement(new Set(["[data-search-row]"]));
    rowA.dataset = { searchRow: "true", searchKind: "workitem", searchWorkItemId: "first" };
    body.setQueryAllResult("[data-search-row]", [rowA]);
    body.keydown({ key: "Enter", isComposing: true, preventDefault() {} });
    assert.deepEqual(opened, []);
  });
});
