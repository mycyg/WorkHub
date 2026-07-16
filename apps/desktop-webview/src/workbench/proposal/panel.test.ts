import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";
import type { ProposalDetailVM } from "@workhub/contracts";

import { createWorkbenchStore } from "../store.js";
import { mountProposalSidePanel, type ProposalSidePanelApiClient } from "./panel.js";
import { proposalVm } from "./test-fixtures.js";

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

// 这个 workspace 的测试运行器没有真实 DOM（node --import tsx --test，无 jsdom；见 chat/view.test.ts 顶部
// 注释）——照 settings/view.test.ts 的既有先例：最小 FakeElement/FakeContainer + 临时把 globalThis.HTMLElement
// 换成 Fake 类，让 mount 内部的 `event.target instanceof HTMLElement` 运行时判断走得通。
class FakeElement {
  public dataset: Record<string, string> = {};
  public value = "";
  public textContent = "";
  public focused = false;
  public attributes: Record<string, string> = {};
  private readonly queryResults = new Map<string, FakeElement>();
  private readonly queryAllResults = new Map<string, FakeElement[]>();

  constructor(
    private readonly selectors = new Set<string>(),
    private readonly closestTargets = new Map<string, FakeElement>()
  ) {}

  closest<T = FakeElement>(selector: string): T | null {
    if (this.selectors.has(selector)) {
      return this as unknown as T;
    }
    return (this.closestTargets.get(selector) as unknown as T) ?? null;
  }

  setQueryResult(selector: string, element: FakeElement) {
    this.queryResults.set(selector, element);
  }

  setQueryAllResult(selector: string, elements: FakeElement[]) {
    this.queryAllResults.set(selector, elements);
  }

  querySelector<T = FakeElement>(selector: string): T | null {
    return (this.queryResults.get(selector) as unknown as T) ?? null;
  }

  querySelectorAll<T = FakeElement>(selector: string): T[] {
    return (this.queryAllResults.get(selector) as unknown as T[]) ?? [];
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  focus() {
    this.focused = true;
  }
}

class FakeSideBody extends FakeElement {
  private readonly listeners: Array<(event: { target: unknown }) => void> = [];

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type !== "click") {
      return;
    }
    this.listeners.push((event) => {
      if (typeof listener === "function") {
        listener(event as unknown as Event);
      } else {
        listener.handleEvent(event as unknown as Event);
      }
    });
  }

  click(target: FakeElement) {
    for (const listener of this.listeners) {
      listener({ target });
    }
  }
}

async function withFakeDomGlobals<T>(run: () => Promise<T>): Promise<T> {
  const globals = globalThis as typeof globalThis & { HTMLElement: typeof HTMLElement };
  const previous = globals.HTMLElement;
  globals.HTMLElement = FakeElement as unknown as typeof HTMLElement;
  try {
    return await run();
  } finally {
    globals.HTMLElement = previous;
  }
}

type ClientCalls = {
  pages: string[];
  reviews: Array<{ id: string; payload: Record<string, unknown> }>;
  merges: Array<{ id: string; payload: unknown }>;
};

function fakeClient(input: {
  onProposal?: (id: string, callIndex: number) => ProposalDetailVM | Promise<ProposalDetailVM>;
  onReview?: () => unknown | Promise<unknown>;
  onMerge?: () => unknown | Promise<unknown>;
  calls?: ClientCalls;
}): ProposalSidePanelApiClient {
  let pageCalls = 0;
  return {
    pages: {
      proposal: async (id: string) => {
        input.calls?.pages.push(id);
        const index = pageCalls++;
        if (!input.onProposal) {
          throw new Error("unexpected pages.proposal");
        }
        return input.onProposal(id, index);
      }
    },
    reviewProposal: async (id: string, payload: unknown) => {
      input.calls?.reviews.push({ id, payload: payload as Record<string, unknown> });
      if (!input.onReview) {
        throw new Error("unexpected reviewProposal");
      }
      return input.onReview();
    },
    mergeProposal: async (id: string, payload?: unknown) => {
      input.calls?.merges.push({ id, payload });
      if (!input.onMerge) {
        throw new Error("unexpected mergeProposal");
      }
      return input.onMerge();
    }
  } as unknown as ProposalSidePanelApiClient;
}

function newCalls(): ClientCalls {
  return { pages: [], reviews: [], merges: [] };
}

function mountInput(over: Partial<Parameters<typeof mountProposalSidePanel>[2]> = {}) {
  return {
    client: fakeClient({ onProposal: () => proposalVm() }),
    locale: "zh-CN" as const,
    onBack: () => {},
    onSettled: () => {},
    ...over
  };
}

test("showForProposal loads the detail and publishes it into the side-panel slot under the proposal ownerId", async () => {
  await withFakeDomGlobals(async () => {
    const store = createWorkbenchStore();
    const body = new FakeSideBody();
    const calls = newCalls();
    const panel = mountProposalSidePanel(
      body as unknown as HTMLElement,
      store,
      mountInput({ client: fakeClient({ onProposal: () => proposalVm(), calls }) })
    );
    panel.showForProposal({ proposalId: "prop-1" });
    // 同步先发 loading 帧。
    assert.equal(store.getState().sidePanelContent?.ownerId, "proposal");
    assert.match(store.getState().sidePanelContent?.html ?? "", /正在拉提议详情/u);
    await tick();
    assert.deepEqual(calls.pages, ["prop-1"]);
    const html = store.getState().sidePanelContent?.html ?? "";
    assert.match(html, /选题报告 · 第三节\(草稿\)/u);
    assert.match(html, /data-wb-prop-approve/u);
  });
});

// R15 批 A6（产出卡内联「打回」）：showForProposal({ focusReason:true }) 加载完详情后直接摊开理由输入器并聚焦。
test("showForProposal with focusReason opens the reason composer and focuses the textarea after the detail loads", async () => {
  await withFakeDomGlobals(async () => {
    const store = createWorkbenchStore();
    const body = new FakeSideBody();
    const textarea = new FakeElement();
    body.setQueryResult("[data-wb-prop-reason-text]", textarea);
    const panel = mountProposalSidePanel(
      body as unknown as HTMLElement,
      store,
      mountInput({ client: fakeClient({ onProposal: () => proposalVm() }) })
    );
    panel.showForProposal({ proposalId: "prop-1", focusReason: true });
    await tick();
    // 详情加载完 → 理由器已摊开 + 焦点交给 textarea。
    assert.match(store.getState().sidePanelContent?.html ?? "", /data-wb-prop-reasons/u);
    assert.equal(textarea.focused, true);
  });
});

test("showForProposal without focusReason does not auto-open the reason composer (plain view-proposal)", async () => {
  await withFakeDomGlobals(async () => {
    const store = createWorkbenchStore();
    const body = new FakeSideBody();
    const panel = mountProposalSidePanel(
      body as unknown as HTMLElement,
      store,
      mountInput({ client: fakeClient({ onProposal: () => proposalVm() }) })
    );
    panel.showForProposal({ proposalId: "prop-1" });
    await tick();
    assert.doesNotMatch(store.getState().sidePanelContent?.html ?? "", /data-wb-prop-reasons/u);
  });
});

test("a late-arriving first load never overwrites a newer navigation (monotonic load generation)", async () => {
  await withFakeDomGlobals(async () => {
    const store = createWorkbenchStore();
    const body = new FakeSideBody();
    let releaseFirst: (() => void) | undefined;
    const panel = mountProposalSidePanel(
      body as unknown as HTMLElement,
      store,
      mountInput({
        client: fakeClient({
          onProposal: (id, index) => {
            if (index === 0) {
              return new Promise<ProposalDetailVM>((resolve) => {
                releaseFirst = () => resolve(proposalVm({ title: "旧的一份提议" }));
              });
            }
            return proposalVm({ title: "新的一份提议" });
          }
        })
      })
    );
    panel.showForProposal({ proposalId: "prop-old" });
    panel.showForProposal({ proposalId: "prop-new" });
    await tick();
    assert.match(store.getState().sidePanelContent?.html ?? "", /新的一份提议/u);
    releaseFirst?.();
    await tick();
    // 晚到的旧响应不得覆盖新的一帧。
    assert.match(store.getState().sidePanelContent?.html ?? "", /新的一份提议/u);
    assert.doesNotMatch(store.getState().sidePanelContent?.html ?? "", /旧的一份提议/u);
  });
});

test("clicking approve reviews with decision=approve, fires onSettled, and refetches the detail", async () => {
  await withFakeDomGlobals(async () => {
    const store = createWorkbenchStore();
    const body = new FakeSideBody();
    const calls = newCalls();
    const settled: string[] = [];
    let detailCall = 0;
    const panel = mountProposalSidePanel(
      body as unknown as HTMLElement,
      store,
      mountInput({
        client: fakeClient({
          onProposal: () => {
            detailCall += 1;
            return detailCall === 1
              ? proposalVm()
              : proposalVm({
                  status: "reviewed",
                  review_actions: {
                    approve: { id: "approve", label: "确认通过", method: "POST", href: "/x" },
                    request_changes: { id: "request_changes", label: "打回修改", method: "POST", href: "/x", requires_reason: true },
                    merge: { id: "merge", label: "合入交付物", method: "POST", href: "/x" }
                  }
                });
          },
          onReview: () => ({ ok: true }),
          calls
        }),
        onSettled: (id) => settled.push(id)
      })
    );
    panel.showForProposal({ proposalId: "prop-1" });
    await tick();
    body.click(new FakeElement(new Set(["[data-wb-prop-approve]"])));
    await tick();
    assert.equal(calls.reviews.length, 1);
    assert.deepEqual(calls.reviews[0]?.payload, { decision: "approve", remember: "once" });
    assert.deepEqual(settled, ["prop-1"]);
    // 重拉后 status 翻 reviewed，出「合入交付物」。
    assert.match(store.getState().sidePanelContent?.html ?? "", /data-wb-prop-merge/u);
  });
});

test("deny with an empty reason is intercepted locally: no request, an inline hint, focus back to the textarea", async () => {
  await withFakeDomGlobals(async () => {
    const store = createWorkbenchStore();
    const body = new FakeSideBody();
    const calls = newCalls();
    const panel = mountProposalSidePanel(
      body as unknown as HTMLElement,
      store,
      mountInput({ client: fakeClient({ onProposal: () => proposalVm(), calls }) })
    );
    panel.showForProposal({ proposalId: "prop-1" });
    await tick();
    // 点「打回修改」→ 理由器展开。
    body.click(new FakeElement(new Set(["[data-wb-prop-deny]"])));
    assert.match(store.getState().sidePanelContent?.html ?? "", /data-wb-prop-reasons/u);
    // 空理由提交 → 拦截。
    const composer = new FakeElement();
    const textarea = new FakeElement();
    const errorEl = new FakeElement();
    composer.setQueryResult("[data-wb-prop-reason-text]", textarea);
    composer.setQueryResult("[data-wb-prop-reason-error]", errorEl);
    const submitBtn = new FakeElement(
      new Set(["[data-wb-prop-submit-deny]"]),
      new Map([["[data-wb-prop-reasons]", composer]])
    );
    body.click(submitBtn);
    await tick();
    assert.equal(calls.reviews.length, 0);
    assert.match(errorEl.textContent, /先写一句打回说明/u);
    assert.equal(textarea.focused, true);
  });
});

test("deny with a real reason posts request_changes with the composed reason_md and settles", async () => {
  await withFakeDomGlobals(async () => {
    const store = createWorkbenchStore();
    const body = new FakeSideBody();
    const calls = newCalls();
    const settled: string[] = [];
    let detailCall = 0;
    const panel = mountProposalSidePanel(
      body as unknown as HTMLElement,
      store,
      mountInput({
        client: fakeClient({
          onProposal: () => {
            detailCall += 1;
            return detailCall === 1 ? proposalVm() : proposalVm({ status: "rejected" });
          },
          onReview: () => ({ ok: true }),
          calls
        }),
        onSettled: (id) => settled.push(id)
      })
    );
    panel.showForProposal({ proposalId: "prop-1" });
    await tick();
    body.click(new FakeElement(new Set(["[data-wb-prop-deny]"])));
    const composer = new FakeElement();
    const preset = new FakeElement();
    preset.dataset.wbPropReason = "细节要调整";
    const textarea = new FakeElement();
    textarea.value = "第三节的引用要补来源";
    composer.setQueryResult('[data-wb-prop-reason][data-sel="true"]', preset);
    composer.setQueryResult("[data-wb-prop-reason-text]", textarea);
    const submitBtn = new FakeElement(
      new Set(["[data-wb-prop-submit-deny]"]),
      new Map([["[data-wb-prop-reasons]", composer]])
    );
    body.click(submitBtn);
    await tick();
    assert.equal(calls.reviews.length, 1);
    assert.deepEqual(calls.reviews[0]?.payload, {
      decision: "request_changes",
      reason_md: "细节要调整\n\n第三节的引用要补来源",
      remember: "once"
    });
    assert.deepEqual(settled, ["prop-1"]);
    // 重拉后 rejected 终态只读。
    assert.match(store.getState().sidePanelContent?.html ?? "", /wh-wb-prop-status--rejected/u);
  });
});

test("clicking merge sends the merge with review_actions.merge.request_json as the payload", async () => {
  await withFakeDomGlobals(async () => {
    const store = createWorkbenchStore();
    const body = new FakeSideBody();
    const calls = newCalls();
    const reviewedVm = () =>
      proposalVm({
        status: "reviewed",
        review_actions: {
          approve: { id: "approve", label: "确认通过", method: "POST", href: "/x" },
          request_changes: { id: "request_changes", label: "打回修改", method: "POST", href: "/x", requires_reason: true },
          merge: { id: "merge", label: "合入交付物", method: "POST", href: "/x", request_json: { dispatch: true } }
        }
      });
    let detailCall = 0;
    const panel = mountProposalSidePanel(
      body as unknown as HTMLElement,
      store,
      mountInput({
        client: fakeClient({
          onProposal: () => {
            detailCall += 1;
            return detailCall === 1 ? reviewedVm() : proposalVm({ status: "merged" });
          },
          onMerge: () => ({ ok: true }),
          calls
        })
      })
    );
    panel.showForProposal({ proposalId: "prop-1" });
    await tick();
    body.click(new FakeElement(new Set(["[data-wb-prop-merge]"])));
    await tick();
    assert.equal(calls.merges.length, 1);
    assert.deepEqual(calls.merges[0]?.payload, { dispatch: true });
    assert.match(store.getState().sidePanelContent?.html ?? "", /wh-wb-prop-status--merged/u);
  });
});

test("a 409 merge conflict renders the gentle approvals-workspace downgrade inline instead of crashing or faking success", async () => {
  await withFakeDomGlobals(async () => {
    const store = createWorkbenchStore();
    const body = new FakeSideBody();
    const settled: string[] = [];
    const reviewedVm = proposalVm({
      status: "reviewed",
      review_actions: {
        approve: { id: "approve", label: "确认通过", method: "POST", href: "/x" },
        request_changes: { id: "request_changes", label: "打回修改", method: "POST", href: "/x", requires_reason: true },
        merge: { id: "merge", label: "合入交付物", method: "POST", href: "/x" }
      }
    });
    const panel = mountProposalSidePanel(
      body as unknown as HTMLElement,
      store,
      mountInput({
        client: fakeClient({
          onProposal: () => reviewedVm,
          onMerge: () => {
            throw new WorkHubApiError(409, "merge_conflict", "conflict", {
              conflicts: [{ target_key: "k", target_kind: "text_doc", change_type: "updated", human_summary: "撞车了", options: [] }]
            });
          }
        }),
        onSettled: (id) => settled.push(id)
      })
    );
    panel.showForProposal({ proposalId: "prop-1" });
    await tick();
    body.click(new FakeElement(new Set(["[data-wb-prop-merge]"])));
    await tick();
    const html = store.getState().sidePanelContent?.html ?? "";
    assert.match(html, /wh-wb-prop-notice--conflict/u);
    assert.match(html, /审批工作台/u);
    // 失败不触发回流，也复原了合入按钮（非禁用）。
    assert.deepEqual(settled, []);
    assert.match(html, /data-wb-prop-merge(?! disabled)/u);
  });
});

test("back clicks hand the panel back to the army panel via onBack; clear releases the slot only when owning it", async () => {
  await withFakeDomGlobals(async () => {
    const store = createWorkbenchStore();
    const body = new FakeSideBody();
    let backs = 0;
    const panel = mountProposalSidePanel(
      body as unknown as HTMLElement,
      store,
      mountInput({ onBack: () => (backs += 1) })
    );
    panel.showForProposal({ proposalId: "prop-1" });
    await tick();
    body.click(new FakeElement(new Set(["[data-wb-prop-back]"])));
    assert.equal(backs, 1);
    // clear：自己是 owner 时释放插槽。
    panel.clear();
    assert.equal(store.getState().sidePanelContent, undefined);
    // 别人（army）占着插槽时 clear 不碰它。
    store.setState({ sidePanelContent: { ownerId: "army", html: "<div>army</div>" } });
    panel.clear();
    assert.equal(store.getState().sidePanelContent?.ownerId, "army");
  });
});
