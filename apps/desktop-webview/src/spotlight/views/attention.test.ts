import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";
import type { AttentionHomeVM, ProposalConflict } from "@workhub/contracts";

import {
  attentionCardDisplayTitle,
  attentionTagLabelForKind,
  attentionConflictHtmlFromError,
  classifyAttentionActionHref,
  createAttentionView,
  mountAttentionInbox,
  resolveAttentionMemoryConflictAction,
  reviewAttentionProposalWithoutMerge
} from "./attention.js";
import type { SpotlightViewContext } from "../view-context.js";

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

class FakeElement {
  public dataset: Record<string, string> = {};
  public textContent = "";
  public disabled = false;
  private readonly attributes = new Set<string>();

  constructor(private readonly selectors = new Set<string>(), dataset: Record<string, string> = {}) {
    this.dataset = dataset;
  }

  closest<T extends Element = Element>(selector: string): T | null {
    return this.selectors.has(selector) ? (this as unknown as T) : null;
  }

  setAttribute(name: string) {
    this.attributes.add(name);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
}

class FakeBody extends FakeElement {
  public innerHTML = "";
  private readonly clickListeners: Array<(event: { target: unknown; preventDefault: () => void }) => void> = [];

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
      listener({ target, preventDefault() {} });
    }
  }
}

test("classifyAttentionActionHref routes proposal/workitem detail hrefs to inline navigation (no dead button)", () => {
  // 对抗审查 HIGH:决策卡「查看变更」是 GET /proposals/:id,之前落到 runAction 末尾死 toast。现走 ctx.open。
  assert.deepEqual(classifyAttentionActionHref("/proposals/abc-123"), {
    kind: "navigate",
    view: "proposals",
    id: "abc-123"
  });
  assert.deepEqual(classifyAttentionActionHref("/workitems/wi-9"), {
    kind: "navigate",
    view: "workitem",
    id: "wi-9"
  });
});

test("classifyAttentionActionHref keeps POST action hrefs as submit (runAction handles them)", () => {
  assert.equal(classifyAttentionActionHref("/api/approvals/x/respond").kind, "submit");
  assert.equal(classifyAttentionActionHref("/api/proposals/abc/review").kind, "submit");
  assert.equal(classifyAttentionActionHref("/api/proposals/abc/merge").kind, "submit");
});

test("classifyAttentionActionHref only treats a clean single-segment detail path as navigation", () => {
  // 带 query、带额外路径段、空 id 的都不算干净详情导航 → 留给 submit/runAction。
  assert.equal(classifyAttentionActionHref("/proposals/abc/extra").kind, "submit");
  assert.equal(classifyAttentionActionHref("/proposals/abc?focus=diff").kind, "submit");
  assert.equal(classifyAttentionActionHref("/proposals/").kind, "submit");
  assert.equal(classifyAttentionActionHref("/something/else").kind, "submit");
});

test("attention proposal approval reviews only and never merges in the same click", async () => {
  const calls: string[] = [];
  const client = {
    async reviewProposal(id: string, payload: unknown) {
      calls.push(`review:${id}:${JSON.stringify(payload)}`);
      return { attention: { summary_text: "已确认通过" } };
    },
    async mergeProposal(id: string) {
      calls.push(`merge:${id}`);
      return { attention: { summary_text: "已合入" } };
    }
  };

  const result = await reviewAttentionProposalWithoutMerge(client, "proposal-1") as { attention: { summary_text: string } };

  assert.deepEqual(calls, ['review:proposal-1:{"decision":"approve","remember":"once"}']);
  assert.equal(result.attention.summary_text, "已确认通过");
});

test("attention sync-conflict actions resolve through the typed client", async () => {
  const calls: unknown[] = [];
  const result = await resolveAttentionMemoryConflictAction({
    async resolveMemoryConflict(id: string, payload: unknown) {
      calls.push({ id, payload });
      return { attention: { summary_text: "偏好已确认" } };
    }
  }, "/api/memory-conflicts/conflict%202/resolve/merge_both?expected_updated_at=2026-07-03T10%3A40%3A00.000Z") as { attention: { summary_text: string } };

  assert.deepEqual(calls, [{
    id: "conflict 2",
    payload: { resolution: "merge_both", expected_updated_at: "2026-07-03T10:40:00.000Z" }
  }]);
  assert.equal(result.attention.summary_text, "偏好已确认");
});

test("attention proposal review cards hide model self narration in their title", () => {
  assert.equal(
    attentionCardDisplayTitle({
      kind: "proposal_review",
      title: "The file looks good and complete. Let me now provide the summary."
    }, true),
    "交付物变更申请"
  );
  assert.equal(
    attentionCardDisplayTitle({
      kind: "approval",
      title: "审批预算"
    }, true),
    "审批预算"
  );
});

test("attention escalation cards do not label retry/cancel actions as assignment", () => {
  assert.equal(attentionTagLabelForKind("escalation", true), "需处理");
  assert.equal(attentionTagLabelForKind("escalation", false), "Needs action");
});

test("desktop attention forwards locale to escalation and budget actions", async () => {
  const globals = globalThis as typeof globalThis & { HTMLElement: typeof HTMLElement };
  const previousHTMLElement = globals.HTMLElement;
  globals.HTMLElement = FakeElement as unknown as typeof HTMLElement;
  const body = new FakeBody();
  const calls: unknown[] = [];
  const vm = {
    primary: undefined,
    queue: [
      {
        id: "budget-1",
        kind: "budget",
        title: "Budget decision",
        actions: [
          {
            id: "finish_current_output",
            label: "Finish current output",
            style: "primary",
            method: "POST",
            href: "/api/escalations/esc%201/budget-actions/finish_current_output"
          }
        ]
      },
      {
        id: "escalation-1",
        kind: "escalation",
        title: "Worker needs help",
        actions: [
          {
            id: "escalation_retry",
            label: "Retry",
            style: "primary",
            method: "POST",
            href: "/api/escalations/esc%202/resolve"
          }
        ]
      }
    ],
    background_runs: [],
    cuu_state: "worried"
  } as unknown as AttentionHomeVM;

  try {
    await createAttentionView().mount({
      body: body as unknown as HTMLElement,
      locale: "en-US",
      client: {
        pages: {
          async attention() {
            return vm;
          }
        },
        async resolveBudgetDecision(id: string, actionId: string, options: unknown) {
          calls.push({ type: "budget", id, actionId, options });
          return { attention: { summary_text: "Budget recorded" } };
        },
        async resolveEscalation(id: string, payload: unknown, options: unknown) {
          calls.push({ type: "resolve", id, payload, options });
          return { attention: { summary_text: "Escalation handled" } };
        }
      },
      back() {},
      open() {},
      setSubtitle() {},
      toast() {},
      requestResize() {},
    refocusBody() {},
      signal: new AbortController().signal
    } as unknown as SpotlightViewContext);
    await tick();

    body.click(new FakeElement(new Set(["[data-att-action-id]"]), {
      attHref: "/api/escalations/esc%201/budget-actions/finish_current_output",
      attActionId: "finish_current_output"
    }));
    await tick();
    await tick();
    body.click(new FakeElement(new Set(["[data-att-action-id]"]), {
      attHref: "/api/escalations/esc%202/resolve",
      attActionId: "escalation_retry"
    }));
    await tick();
    await tick();

    assert.deepEqual(calls, [
      { type: "budget", id: "esc 1", actionId: "finish_current_output", options: { locale: "en-US" } },
      { type: "resolve", id: "esc 2", payload: { action: "retry" }, options: { locale: "en-US" } }
    ]);
  } finally {
    globals.HTMLElement = previousHTMLElement;
  }
});

test("attention plan_review cards use explicit plan-review labels", () => {
  assert.equal(attentionTagLabelForKind("plan_review", true), "计划审阅");
  assert.equal(attentionTagLabelForKind("plan_review", false), "Plan review");
});

test("mountAttentionInbox is a decoupled two-window entry: renders the queue and routes proposal detail via the narrowed open()", async () => {
  // R15 批 I1：证明抽取出的共用入口不再依赖 SpotlightViewContext——它只吃 AttentionInboxContext（工作台
  // 收件箱薄壳照此喂）。这里用一个「非聚焦盒」的最小上下文（没有 back/refocusBody/signal/target），并断言
  // proposal「查看变更」导航型动作走的是收窄后的 open(view,{id,route})，工作台侧据此把它路由到右栏提议详情。
  const globals = globalThis as typeof globalThis & { HTMLElement: typeof HTMLElement };
  const previousHTMLElement = globals.HTMLElement;
  globals.HTMLElement = FakeElement as unknown as typeof HTMLElement;
  const body = new FakeBody();
  const opened: Array<{ view: string; target?: { id?: string; route?: string } }> = [];
  let subtitle = "";
  const vm = {
    primary: undefined,
    queue: [
      {
        id: "prop-1",
        kind: "proposal_review",
        title: "交付物变更申请",
        actions: [
          {
            id: "view_changes",
            label: "查看变更",
            style: "quiet",
            href: "/proposals/p-1"
          }
        ]
      }
    ],
    background_runs: [],
    cuu_state: "idle"
  } as unknown as AttentionHomeVM;

  try {
    const handle = mountAttentionInbox({
      body: body as unknown as HTMLElement,
      locale: "zh-CN",
      client: {
        pages: {
          async attention() {
            return vm;
          }
        }
      } as never,
      setSubtitle(text: string) {
        subtitle = text;
      },
      toast() {},
      requestResize() {},
      open(view, target) {
        opened.push({ view, ...(target ? { target } : {}) });
      }
    });
    await tick();

    // 队列渲成决策卡（复用 .wh-spot-* 结构）。
    assert.match(body.innerHTML, /wh-spot-card/u);
    assert.match(body.innerHTML, /交付物变更申请/u);
    assert.equal(subtitle, "1 条待你拍板");

    // 点「查看变更」→ 收窄后的 open("proposals", {id, route})，不当 POST 动作提交。
    body.click(new FakeElement(new Set(["[data-att-action-id]"]), {
      attHref: "/proposals/p-1",
      attActionId: "view_changes"
    }));
    await tick();

    assert.deepEqual(opened, [{ view: "proposals", target: { id: "p-1", route: "/proposals/p-1" } }]);
    handle.dispose();
  } finally {
    globals.HTMLElement = previousHTMLElement;
  }
});

test("desktop attention view surfaces source warnings instead of showing all clear", async () => {
  const body = {
    innerHTML: "",
    addEventListener() {}
  } as unknown as HTMLElement;
  const vm: AttentionHomeVM = {
    primary: undefined,
    queue: [],
    source_warnings: [{
      source: "approvals",
      message: "Approval decisions could not be loaded. Open Approvals or retry."
    }],
    background_runs: [],
    cuu_state: "worried"
  };
  let subtitle = "";

  await createAttentionView().mount({
    body,
    locale: "en-US",
    client: {
      pages: {
        async attention() {
          return vm;
        }
      }
    },
    back() {},
    open() {},
    setSubtitle(text: string) {
      subtitle = text;
    },
    toast() {},
    requestResize() {},
    refocusBody() {},
    signal: new AbortController().signal
  } as unknown as SpotlightViewContext);
  await tick();

  assert.match(body.innerHTML, /data-spot-attention-source-warnings="1"/u);
  assert.match(body.innerHTML, /data-spot-attention-source-warning="approvals"/u);
  assert.match(body.innerHTML, /Approval decisions could not be loaded/u);
  assert.doesNotMatch(body.innerHTML, /All clear/u);
  assert.notEqual(subtitle, "all done");
});

test("attention proposal merge conflict renders actionable choices instead of a generic failure", () => {
  const conflict: ProposalConflict = {
    id: "conflict-1",
    work_item_id: "work-1",
    proposal_id: "proposal-1",
    change_id: "change-1",
    target_key: "drive_item:outputs/demo.md",
    target_kind: "text_doc",
    change_type: "generated",
    target_path: "outputs/demo.md",
    headline: "demo.md 已经有正式版本",
    summary_text: "这份变更和正式版撞车，需要先选择处理方案。",
    existing: { proposal_id: "old-proposal", change_id: "old-change", sha256: "a".repeat(64) },
    incoming: { sha256_before: "b".repeat(64), sha256_after: "c".repeat(64) },
    recommended_option_id: "keep_current",
    options: [
      {
        id: "keep_current",
        label: "保留正式版",
        summary_text: "保留已正式采纳的版本。",
        recommended: true,
        action: {
          id: "keep_current",
          label: "保留正式版",
          method: "POST",
          href: "/api/proposals/proposal-1/merge",
          request_json: { conflict_resolution: { accept_incoming_target_keys: [] } }
        }
      },
      {
        id: "accept_incoming",
        label: "查看变更申请",
        summary_text: "先打开总结和改动明细。",
        action: {
          id: "accept_incoming",
          label: "查看变更申请",
          method: "GET",
          href: "/proposals/proposal-1"
        }
      }
    ]
  };

  const html = attentionConflictHtmlFromError(
    new WorkHubApiError(409, "merge_conflict", conflict.summary_text, { conflicts: [conflict] }),
    true
  );

  assert.match(html ?? "", /data-prop-conflict-panel="true"/u);
  assert.match(html ?? "", /这份变更和别人的改动冲突了/u);
  assert.match(html ?? "", /保留正式版/u);
  assert.match(html ?? "", /href="\/proposals\/proposal-1"/u);
  assert.match(html ?? "", /data-method="GET"/u);
});

// UX-M7（桌面死按钮）：「看 B 的出处」/「打开设置」/「查看预算」GET 导航路由到对应能力。
test("classifyAttentionActionHref routes replay/settings/cost GET actions to capabilities", () => {
  assert.deepEqual(classifyAttentionActionHref("/agent-runs/r-1/replay"), {
    kind: "navigate",
    view: "replay",
    id: "r-1"
  });
  assert.deepEqual(classifyAttentionActionHref("/settings"), { kind: "navigate", view: "settings" });
  assert.deepEqual(classifyAttentionActionHref("/dashboard/cost"), { kind: "navigate", view: "cost" });
  assert.deepEqual(classifyAttentionActionHref("/api/memory-conflicts/c1/resolve/merge_both"), { kind: "submit" });
});

// UX-M6（桌面可编辑合并）：merge_both 提交带上编辑稿；非 merge 不带。
test("resolveAttentionMemoryConflictAction forwards the edited merge draft as value_md", async () => {
  const calls: unknown[] = [];
  const client = {
    async resolveMemoryConflict(id: string, payload: unknown) {
      calls.push({ id, payload });
      return { attention: { summary_text: "已合并" } };
    }
  };
  await resolveAttentionMemoryConflictAction(
    client,
    "/api/memory-conflicts/c1/resolve/merge_both?expected_updated_at=2026-07-03T10%3A40%3A00.000Z",
    "  合并后的一条。  "
  );
  await resolveAttentionMemoryConflictAction(
    client,
    "/api/memory-conflicts/c1/resolve/discard_both?expected_updated_at=2026-07-03T10%3A40%3A00.000Z",
    "不该带上的稿"
  );
  assert.deepEqual(calls, [
    {
      id: "c1",
      payload: { resolution: "merge_both", expected_updated_at: "2026-07-03T10:40:00.000Z", value_md: "合并后的一条。" }
    },
    {
      id: "c1",
      payload: { resolution: "discard_both", expected_updated_at: "2026-07-03T10:40:00.000Z" }
    }
  ]);
});
