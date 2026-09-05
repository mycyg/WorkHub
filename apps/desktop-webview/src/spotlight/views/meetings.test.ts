import assert from "node:assert/strict";
import { test } from "node:test";

import type { MeetingInsightVM, MeetingPageVM, MeetingRecordVM } from "@workhub/contracts";

import { createMeetingsView, meetingsHtml, meetingsNoProjectsEmptyHtml, meetingTargetIdFromRoute } from "./meetings.js";
import type { SpotlightViewContext } from "../view-context.js";

const PROJECT_ID = "90000000-0000-4000-8000-000000000001";
const PROJECT_ID_2 = "90000000-0000-4000-8000-000000000002";
const MEETING_ID = "90000000-0000-4000-8000-000000000011";
const MEETING_ID_2 = "90000000-0000-4000-8000-000000000012";
const INSIGHT_ID = "90000000-0000-4000-8000-000000000021";
const WORK_ITEM_ID = "90000000-0000-4000-8000-000000000031";
const PROPOSAL_ID = "90000000-0000-4000-8000-000000000041";

function insight(over: Partial<MeetingInsightVM> = {}): MeetingInsightVM {
  return {
    id: INSIGHT_ID,
    meeting_id: MEETING_ID,
    kind: "new_requirement",
    title: "需要一个导出按钮",
    description: "客户在会上提到要导出报表",
    confidence_reason: "转写里明确提到「希望能导出」",
    status: "pending",
    created_at: "2026-08-01T00:00:00.000Z",
    evidence_refs: [],
    actions: {
      create_draft: {
        id: "meeting_insight_to_draft",
        label: "生成草稿",
        method: "POST",
        href: `/api/meetings/projects/${PROJECT_ID}/insights/${INSIGHT_ID}/draft`
      },
      dismiss: {
        id: "meeting_insight_dismiss",
        label: "忽略",
        method: "POST",
        href: `/api/meetings/projects/${PROJECT_ID}/insights/${INSIGHT_ID}/dismiss`
      }
    },
    ...over
  } as MeetingInsightVM;
}

function meetingRecord(over: Partial<MeetingRecordVM> = {}): MeetingRecordVM {
  return {
    id: MEETING_ID,
    project_id: PROJECT_ID,
    uploaded_by_user_id: "90000000-0000-4000-8000-000000000099",
    uploaded_by_label: "张三",
    title: "周例会",
    audio_filename: "meeting.mp3",
    audio_size_bytes: 1024,
    status: "ready",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    insights: [insight()],
    ...over
  } as MeetingRecordVM;
}

function pageVm(over: Partial<MeetingPageVM> = {}): MeetingPageVM {
  return {
    generated_at: "2026-08-01T00:00:00.000Z",
    summary: { meeting_count: 1, ready_count: 1, pending_insight_count: 1, confirmed_insight_count: 0, dismissed_insight_count: 0 },
    can_manage: true,
    selected_meeting_id: MEETING_ID,
    meetings: [meetingRecord()],
    ...over
  } as MeetingPageVM;
}

// ── 纯渲染函数 ───────────────────────────────────────────────────────────────

test("meetingsHtml renders the meeting list row, the selected meeting's transcript/minutes, and its insight card", () => {
  const html = meetingsHtml(pageVm(), "", true);
  assert.match(html, new RegExp(`data-meeting-select="${MEETING_ID}"[^>]*data-meeting-selected="true"`, "u"));
  assert.match(html, /周例会/u);
  assert.match(html, /已就绪/u); // meetingRecordStatusLabel(status="ready")
  assert.match(html, /1 条待确认/u); // pending insight count on the row
  assert.match(html, /当前/u); // selected-row "Current" tag
  // 转写/纪要为空时按会议状态给贴合占位（该 fixture 未填 transcript_text/minutes_md，会议已 ready）。
  assert.match(html, /这次会议还没有转写内容/u);
  assert.match(html, /这次会议还没有纪要内容/u);
  // 洞察卡：kind/status chip + 两个动作按钮 + AI 推荐理由。
  assert.match(html, /新需求/u);
  assert.match(html, /待确认/u);
  assert.match(html, /需要一个导出按钮/u);
  assert.match(html, /AI 推荐理由：转写里明确提到「希望能导出」/u);
  assert.match(html, new RegExp(`data-meeting-insight-action="/api/meetings/projects/${PROJECT_ID}/insights/${INSIGHT_ID}/draft"`, "u"));
  assert.match(html, new RegExp(`data-meeting-insight-action="/api/meetings/projects/${PROJECT_ID}/insights/${INSIGHT_ID}/dismiss"`, "u"));
});

test("meetingsHtml gives processing/failed meetings honest transcript+minutes copy instead of the generic 'nothing yet'", () => {
  const processing = meetingsHtml(pageVm({ meetings: [meetingRecord({ status: "processing", insights: [] })] }), "", true);
  assert.match(processing, /转写还在准备中，稍后回来查看/u);
  assert.match(processing, /纪要还在准备中，稍后回来查看/u);
  const failed = meetingsHtml(pageVm({ meetings: [meetingRecord({ status: "failed", insights: [] })] }), "", true);
  assert.match(failed, /转写没有生成成功/u);
  assert.match(failed, /纪要没有生成成功/u);
});

test("meetingsHtml shows a plain empty note (no card) when a meeting has zero insights", () => {
  const html = meetingsHtml(pageVm({ meetings: [meetingRecord({ insights: [] })] }), "", true);
  assert.match(html, /这场会议还没有洞察/u);
  assert.doesNotMatch(html, /wh-spot-card"/u);
});

test("meetingsHtml points to the web app for the no-meetings-in-project empty state (desktop has no import UI in this batch)", () => {
  const html = meetingsHtml(pageVm({ meetings: [], selected_meeting_id: undefined, summary: { meeting_count: 0, ready_count: 0, pending_insight_count: 0, confirmed_insight_count: 0, dismissed_insight_count: 0 } }), "", true);
  assert.match(html, /这个项目还没有会议，去网页版导入会议转写后会显示在这里/u);
});

test("meetingsHtml embeds the given project-switcher chips verbatim", () => {
  const html = meetingsHtml(pageVm(), "<div data-test-chips>marker</div>", true);
  assert.match(html, /data-test-chips>marker</u);
});

test("meetingsHtml keeps a deep-linked selected meeting visible even beyond the first page slice", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    meetingRecord({ id: `90000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, title: `会议-${i}`, insights: [] })
  );
  const deepLinked = meetingRecord({ id: "90000000-0000-4000-8000-000000000777", title: "从搜索直达.打开", insights: [] });
  const html = meetingsHtml(pageVm({ meetings: [...many, deepLinked], selected_meeting_id: deepLinked.id }), "", true);
  assert.match(html, new RegExp(`data-meeting-select="${deepLinked.id}"[^>]*data-meeting-selected="true"`, "u"));
  assert.match(html, /从搜索直达\.打开/u);
});

test("meetingsNoProjectsEmptyHtml offers a direct new-task action and avoids dispatch wording", () => {
  const zh = meetingsNoProjectsEmptyHtml(true);
  const en = meetingsNoProjectsEmptyHtml(false);
  assert.match(zh, /data-meeting-open-intake="true"/u);
  assert.match(zh, /新任务/u);
  assert.doesNotMatch(zh, /派活/u);
  assert.match(en, /data-meeting-open-intake="true"/u);
  assert.doesNotMatch(en, /Dispatch|dispatch/u);
});

test("meetingTargetIdFromRoute reads m= from both a bare query string and a full path+query", () => {
  // 桌面内部跳转只带查询串（search.ts ctx.open("meetings", { route: "?m=..." })）。
  assert.equal(meetingTargetIdFromRoute(`?m=${MEETING_ID}`), MEETING_ID);
  // web 同款全路径深链形态。
  assert.equal(meetingTargetIdFromRoute(`/meetings?project_id=${PROJECT_ID}&m=${MEETING_ID}`), MEETING_ID);
  assert.equal(meetingTargetIdFromRoute(`/meetings?project_id=${PROJECT_ID}`), undefined);
  assert.equal(meetingTargetIdFromRoute(undefined), undefined);
});

// ── mount() 接线：list→detail 重渲、动作分发分支 ──────────────────────────────

class FakeElement {
  public dataset: Record<string, string> = {};
  public textContent = "";

  constructor(private readonly selectors = new Set<string>(), dataset: Record<string, string> = {}) {
    this.dataset = dataset;
  }

  closest<T extends Element = Element>(selector: string): T | null {
    return this.selectors.has(selector) ? (this as unknown as T) : null;
  }
}

class FakeBody extends FakeElement {
  public innerHTML = "";
  private readonly clickListeners: Array<(event: { target: unknown }) => void> = [];

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type !== "click") return;
    this.clickListeners.push((event) => {
      if (typeof listener === "function") {
        listener(event as unknown as Event);
      } else {
        listener.handleEvent(event as unknown as Event);
      }
    });
  }

  click(target: FakeElement) {
    for (const listener of this.clickListeners) {
      listener({ target });
    }
  }
}

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
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

type FakeMeetingsRequest = { project_id?: string; meetingId?: string; locale?: string };

type FakeClientOptions = {
  projects?: { id: string; name: string }[];
  meetingsByProject?: Record<string, MeetingPageVM>;
  meetingsByRequest?: (req: FakeMeetingsRequest) => MeetingPageVM;
  onMeetingsRequest?: (options: FakeMeetingsRequest) => void;
  createMeetingInsightDraft?: (projectId: string, insightId: string) => Promise<MeetingPageVM>;
  dismissMeetingInsight?: (projectId: string, insightId: string) => Promise<MeetingPageVM>;
};

function fakeClient(options: FakeClientOptions) {
  const projects = options.projects ?? [{ id: PROJECT_ID, name: "增长项目" }];
  return {
    async listProjects() {
      return { projects };
    },
    pages: {
      async meetings(req: FakeMeetingsRequest) {
        options.onMeetingsRequest?.(req);
        if (options.meetingsByRequest) {
          return options.meetingsByRequest(req);
        }
        const vm = options.meetingsByProject?.[req.project_id ?? ""];
        if (!vm) {
          throw new Error(`no fixture for project ${req.project_id}`);
        }
        return vm;
      }
    },
    createMeetingInsightDraft:
      options.createMeetingInsightDraft ?? (async () => pageVm()),
    dismissMeetingInsight:
      options.dismissMeetingInsight ?? (async () => pageVm())
  };
}

function baseCtx(
  body: FakeBody,
  client: ReturnType<typeof fakeClient>,
  overrides: Partial<SpotlightViewContext> = {}
): SpotlightViewContext {
  return {
    body: body as unknown as HTMLElement,
    locale: "zh-CN",
    client: client as unknown as SpotlightViewContext["client"],
    back() {},
    open() {},
    setSubtitle() {},
    toast() {},
    requestResize() {},
    refocusBody() {},
    signal: new AbortController().signal,
    ...overrides
  } as SpotlightViewContext;
}

test("mount resolves the target project + meeting from ctx.target and renders that meeting's detail", async () => {
  await withFakeHTMLElement(async () => {
    const body = new FakeBody();
    const requests: Array<{ project_id?: string; meetingId?: string }> = [];
    const client = fakeClient({
      projects: [{ id: PROJECT_ID, name: "增长项目" }, { id: PROJECT_ID_2, name: "另一个项目" }],
      meetingsByProject: { [PROJECT_ID]: pageVm() },
      onMeetingsRequest: (req) => requests.push(req)
    });
    createMeetingsView().mount(baseCtx(body, client, { target: { id: PROJECT_ID, route: `?m=${MEETING_ID}` } }));
    await tick();
    await tick();
    assert.deepEqual(requests, [{ project_id: PROJECT_ID, locale: "zh-CN", meetingId: MEETING_ID }]);
    assert.match(body.innerHTML, /周例会/u);
  });
});

test("mount falls back to the no-projects empty state and its intake CTA opens the intake capability", async () => {
  await withFakeHTMLElement(async () => {
    const body = new FakeBody();
    const client = fakeClient({ projects: [] });
    const opened: string[] = [];
    createMeetingsView().mount(baseCtx(body, client, { open: (id) => opened.push(id) }));
    await tick();
    await tick();
    assert.match(body.innerHTML, /还没有项目/u);
    body.click(new FakeElement(new Set(["[data-meeting-open-intake]"])));
    assert.deepEqual(opened, ["intake"]);
  });
});

test("clicking a different meeting row reloads with the new selectedMeetingId and clears it back to default on project switch", async () => {
  await withFakeHTMLElement(async () => {
    const body = new FakeBody();
    const requests: Array<{ project_id?: string; meetingId?: string }> = [];
    const secondMeeting = meetingRecord({ id: MEETING_ID_2, title: "第二场会议", insights: [] });
    // 服务端「选中项跟着请求走」的行为要在假客户端里真实体现（否则测不出「点行会切换」这件事本身）：
    // 没带 meetingId → 回默认第一场；带了 meetingId → 回那一场被选中。project 2 只有一场会议。
    const client = fakeClient({
      projects: [{ id: PROJECT_ID, name: "增长项目" }, { id: PROJECT_ID_2, name: "另一个项目" }],
      onMeetingsRequest: (req) => requests.push(req),
      meetingsByRequest: (req) => {
        if (req.project_id === PROJECT_ID) {
          return pageVm({
            meetings: [meetingRecord(), secondMeeting],
            selected_meeting_id: req.meetingId ?? MEETING_ID
          });
        }
        return pageVm({
          meetings: [secondMeeting],
          selected_meeting_id: MEETING_ID_2,
          summary: { meeting_count: 1, ready_count: 1, pending_insight_count: 0, confirmed_insight_count: 0, dismissed_insight_count: 0 }
        });
      }
    });
    createMeetingsView().mount(baseCtx(body, client));
    await tick();
    await tick();
    assert.deepEqual(requests[0], { project_id: PROJECT_ID, locale: "zh-CN" });
    assert.match(body.innerHTML, /周例会/u);

    body.click(new FakeElement(new Set(["[data-meeting-select]"]), { meetingSelect: MEETING_ID_2 }));
    await tick();
    await tick();
    assert.deepEqual(requests[1], { project_id: PROJECT_ID, locale: "zh-CN", meetingId: MEETING_ID_2 });
    assert.match(body.innerHTML, /第二场会议/u);

    body.click(new FakeElement(new Set(["[data-meeting-proj]"]), { meetingProj: PROJECT_ID_2 }));
    await tick();
    await tick();
    // 切项目清空 selectedMeetingId——不带着上一个项目的会议 id 请求新项目。
    assert.deepEqual(requests[2], { project_id: PROJECT_ID_2, locale: "zh-CN" });
  });
});

test("clicking the create-draft insight action shows busy copy, calls createMeetingInsightDraft with the parsed ids, then reloads the same meeting", async () => {
  await withFakeHTMLElement(async () => {
    const body = new FakeBody();
    const requests: Array<{ project_id?: string; meetingId?: string }> = [];
    const calls: Array<[string, string]> = [];
    const toasts: string[] = [];
    const client = fakeClient({
      meetingsByProject: { [PROJECT_ID]: pageVm() },
      onMeetingsRequest: (req) => requests.push(req),
      createMeetingInsightDraft: async (projectId, insightId) => {
        calls.push([projectId, insightId]);
        return pageVm();
      }
    });
    createMeetingsView().mount(baseCtx(body, client, { toast: (message) => toasts.push(message) }));
    await tick();
    await tick();

    const btn = new FakeElement(new Set(["[data-meeting-insight-action]"]), {
      meetingInsightAction: `/api/meetings/projects/${PROJECT_ID}/insights/${INSIGHT_ID}/draft`
    });
    body.click(btn);
    // 请求发出前先同步落笔忙态文案——不是先静默一拍再变字，用户点下去立刻看到反馈。
    assert.equal(btn.textContent, "生成草稿中…");
    await tick();
    await tick();

    assert.deepEqual(calls, [[PROJECT_ID, INSIGHT_ID]]);
    assert.deepEqual(toasts, ["已生成草稿"]);
    // 动作完成后重拉了同一场会议（selectedMeetingId 沿用初次 load 落定的值），不是拿动作接口自己
    // 返回的页面直接渲（那个恒是默认会议，见 meetings.ts 头部注释）。
    assert.equal(requests.length, 2);
    assert.equal(requests[1]?.project_id, PROJECT_ID);
  });
});

test("clicking dismiss calls dismissMeetingInsight and toasts a distinct message; a failed call still recovers (busy clears, view reloads)", async () => {
  await withFakeHTMLElement(async () => {
    const body = new FakeBody();
    const toasts: string[] = [];
    let dismissCalls = 0;
    const client = fakeClient({
      meetingsByProject: { [PROJECT_ID]: pageVm() },
      dismissMeetingInsight: async () => {
        dismissCalls += 1;
        throw new Error("boom");
      }
    });
    createMeetingsView().mount(baseCtx(body, client, { toast: (message) => toasts.push(message) }));
    await tick();
    await tick();

    body.click(
      new FakeElement(new Set(["[data-meeting-insight-action]"]), {
        meetingInsightAction: `/api/meetings/projects/${PROJECT_ID}/insights/${INSIGHT_ID}/dismiss`
      })
    );
    await tick();
    await tick();

    assert.equal(dismissCalls, 1);
    assert.deepEqual(toasts, ["操作失败，稍后重试"]);
    // 失败后仍然重渲了会议详情（busy 已释放，不是卡死在忙态）。
    assert.match(body.innerHTML, /周例会/u);
  });
});

test("an insight action href that doesn't match the known draft/dismiss shape gets an honest error toast, not a silent stuck button", async () => {
  await withFakeHTMLElement(async () => {
    const body = new FakeBody();
    const toasts: string[] = [];
    const client = fakeClient({ meetingsByProject: { [PROJECT_ID]: pageVm() } });
    createMeetingsView().mount(baseCtx(body, client, { toast: (message) => toasts.push(message) }));
    await tick();
    await tick();

    const btn = new FakeElement(new Set(["[data-meeting-insight-action]"]), {
      meetingInsightAction: "/api/meetings/projects/oops/not-a-real-action"
    });
    body.click(btn);
    assert.deepEqual(toasts, ["这个操作暂时打不开"]);
    // 没有把按钮文案换成忙态——分发不认识的动作不假装在处理。
    assert.equal(btn.textContent, "");
  });
});

test("draft_href and proposal_href are plain navigation: they open workitem/proposals with the parsed id, not a write action", async () => {
  await withFakeHTMLElement(async () => {
    const body = new FakeBody();
    const opened: Array<[string, unknown]> = [];
    const client = fakeClient({ meetingsByProject: { [PROJECT_ID]: pageVm() } });
    createMeetingsView().mount(baseCtx(body, client, { open: (id, target) => opened.push([id, target]) }));
    await tick();
    await tick();

    body.click(new FakeElement(new Set(["[data-meeting-open-href]"]), { meetingOpenHref: `/workitems/${WORK_ITEM_ID}` }));
    body.click(new FakeElement(new Set(["[data-meeting-open-href]"]), { meetingOpenHref: `/proposals/${PROPOSAL_ID}` }));

    assert.deepEqual(opened, [
      ["workitem", { id: WORK_ITEM_ID, route: `/workitems/${WORK_ITEM_ID}` }],
      ["proposals", { id: PROPOSAL_ID, route: `/proposals/${PROPOSAL_ID}` }]
    ]);
  });
});

test("an open-href that doesn't classify as navigation gets an honest 'not available' toast instead of doing nothing silently", async () => {
  await withFakeHTMLElement(async () => {
    const body = new FakeBody();
    const toasts: string[] = [];
    const opened: unknown[] = [];
    const client = fakeClient({ meetingsByProject: { [PROJECT_ID]: pageVm() } });
    createMeetingsView().mount(baseCtx(body, client, { toast: (message) => toasts.push(message), open: (id) => opened.push(id) }));
    await tick();
    await tick();

    body.click(new FakeElement(new Set(["[data-meeting-open-href]"]), { meetingOpenHref: "/api/meetings/projects/p1/insights/i1/draft" }));
    assert.deepEqual(toasts, ["这个入口暂时打不开"]);
    assert.deepEqual(opened, []);
  });
});

test("a failed initial load renders a retry affordance, and retry re-issues the same request", async () => {
  await withFakeHTMLElement(async () => {
    const body = new FakeBody();
    let attempts = 0;
    const client = {
      async listProjects() {
        return { projects: [{ id: PROJECT_ID, name: "增长项目" }] };
      },
      pages: {
        async meetings() {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("boom");
          }
          return pageVm();
        }
      },
      createMeetingInsightDraft: async () => pageVm(),
      dismissMeetingInsight: async () => pageVm()
    };
    createMeetingsView().mount(baseCtx(body, client as unknown as ReturnType<typeof fakeClient>));
    await tick();
    await tick();
    assert.match(body.innerHTML, /会议没拉到/u);
    assert.match(body.innerHTML, /data-spot-retry/u);

    body.click(new FakeElement(new Set(["[data-spot-retry]"])));
    await tick();
    await tick();
    assert.equal(attempts, 2);
    assert.match(body.innerHTML, /周例会/u);
  });
});
