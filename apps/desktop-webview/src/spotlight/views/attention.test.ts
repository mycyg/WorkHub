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
import { renderInboxNavHtml } from "../../workbench/rail.js";
import { pendingDecisionCount } from "../../pending-decision-count.js";

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

class FakeElement {
  public dataset: Record<string, string> = {};
  public textContent = "";
  public disabled = false;
  // R23 F-04：转交选人层是 actionrow 的兄弟节点（insertAdjacentHTML afterend），去重守卫查的是父容器
  // ——这两项让假 DOM 能走完那条真实路径，而不是只验一段字符串。
  public parentElement: FakeElement | null = null;
  public readonly queryResults = new Map<string, FakeElement | null>();
  public readonly insertedHtml: Array<{ position: InsertPosition; html: string }> = [];
  private readonly attributes = new Set<string>();
  // F-05：closest 默认仍是「选择器命中就返回自己」(既有用法不受影响)；closestOverrides/queryResults
  // 让个别测试按需配成「命中这个选择器时返回另一个（祖先/后代）伪元素」，够用来测冲突选择器
  // （提交按钮 closest 找容器，容器 querySelector 找勾选的 radio/提示条）而不用引入真 DOM。
  private readonly closestOverrides = new Map<string, FakeElement | null>();

  constructor(private readonly selectors = new Set<string>(), dataset: Record<string, string> = {}) {
    this.dataset = dataset;
  }

  closest<T extends Element = Element>(selector: string): T | null {
    if (this.closestOverrides.has(selector)) {
      return (this.closestOverrides.get(selector) ?? null) as unknown as T | null;
    }
    return this.selectors.has(selector) ? (this as unknown as T) : null;
  }

  querySelector<T extends Element = Element>(selector: string): T | null {
    return (this.queryResults.get(selector) ?? null) as unknown as T | null;
  }

  insertAdjacentHTML(position: InsertPosition, html: string) {
    this.insertedHtml.push({ position, html });
  }

  setClosest(selector: string, element: FakeElement | null) {
    this.closestOverrides.set(selector, element);
  }

  setQueryResult(selector: string, element: FakeElement | null) {
    this.queryResults.set(selector, element);
  }

  setAttribute(name: string) {
    this.attributes.add(name);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
}

// R23 F-04：选人层里的成员下拉。loadDelegateMembers 用 ownerDocument.createElement("option") 逐个建节点
// （昵称走 textContent，不拼 innerHTML），并在 await 回来后确认 select 还挂在树上。
type FakeOption = { value: string; textContent: string | null };

class FakeSelect extends FakeElement {
  public value = "";
  public isConnected = true;
  public replaced: FakeOption[] = [];
  public readonly ownerDocument = {
    createElement: (): FakeOption => ({ value: "", textContent: null })
  };

  replaceChildren(...nodes: FakeOption[]) {
    this.replaced = nodes;
  }
}

class FakeBody extends FakeElement {
  public innerHTML = "";
  // R23 F-04：外部入口指名的那张卡（桌宠「转交他人」→ 主窗决策队列）在每次渲染后要被找出来滚进视野。
  public readonly queryAllResults = new Map<string, FakeElement[]>();
  private readonly clickListeners: Array<(event: { target: unknown; preventDefault: () => void }) => void> = [];

  querySelectorAll<T extends Element = Element>(selector: string): T[] {
    return (this.queryAllResults.get(selector) ?? []) as unknown as T[];
  }

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

// F-05：撞车「先选稿再采纳」——多处冲突各自带融合稿时，选择器提交按钮先 choose 勾选的候选、
// 成功后才 apply，再走既有的 toast/onActionSettled/refresh 收尾（与 apply/merge 分支同一套）。
test("F-05 mountAttentionInbox conflict chooser submit chooses the checked candidate before applying it", async () => {
  // actionHrefFromElement（web-runtime）先判 `element instanceof HTMLAnchorElement` 才落到 dataset 兜底——
  // 裸 Node 没有这个全局，不像 FakeElement 那样有既有的 HTMLElement 换入口，这里跟着一起换，避免
  // 引用未声明全局直接抛 ReferenceError（此前没有测试真的点通 runConflictAction 到这一行）。
  const globals = globalThis as typeof globalThis & { HTMLElement: typeof HTMLElement; HTMLAnchorElement: typeof HTMLAnchorElement };
  const previousHTMLElement = globals.HTMLElement;
  const previousHTMLAnchorElement = globals.HTMLAnchorElement;
  globals.HTMLElement = FakeElement as unknown as typeof HTMLElement;
  globals.HTMLAnchorElement = class {} as unknown as typeof HTMLAnchorElement;
  const body = new FakeBody();
  const calls: string[] = [];
  const vm: AttentionHomeVM = { primary: undefined, queue: [], background_runs: [], cuu_state: "idle" };

  try {
    const handle = mountAttentionInbox({
      body: body as unknown as HTMLElement,
      locale: "zh-CN",
      client: {
        pages: {
          async attention() {
            calls.push("refresh");
            return vm;
          }
        },
        async chooseMergeProposalCandidate(id: string, payload: { option_key: string }) {
          calls.push(`choose:${id}:${payload.option_key}`);
          return { merge_proposal_id: id, chosen_option_key: payload.option_key };
        },
        async applyMergeProposalCandidate(id: string) {
          calls.push(`apply:${id}`);
          return { attention: { summary_text: "已采纳融合稿" } };
        }
      } as never,
      setSubtitle() {},
      toast(message: string, tone?: string) {
        calls.push(`toast:${tone}:${message}`);
      },
      requestResize() {},
      open() {},
      onActionSettled() {
        calls.push("settled");
      }
    });
    await tick();
    calls.length = 0; // 只看点击之后的调用序列，滤掉初次挂载的那次 hydrate refresh。

    const checkedRadio = new FakeElement();
    checkedRadio.dataset = { mergeProposalId: "mp-2", proposalId: "proposal-9" };
    const chooserContainer = new FakeElement();
    chooserContainer.setQueryResult("[data-conflict-chooser-option]:checked", checkedRadio);
    const submit = new FakeElement(
      new Set(["[data-prop-conflict-panel] a[href],[data-prop-conflict-panel] [data-action-href],[data-prop-conflict-panel] [data-href]"]),
      { actionHref: "/api/merge-proposals/choose-selected", proposalConflictChooserSubmit: "true" }
    );
    submit.setClosest("[data-proposal-conflict-chooser]", chooserContainer);

    body.click(submit);
    await tick();

    assert.deepEqual(calls, [
      "choose:mp-2:ai_fusion",
      "apply:mp-2",
      "toast:ok:已采纳融合稿",
      "settled",
      "refresh"
    ]);
    handle.dispose();
  } finally {
    globals.HTMLElement = previousHTMLElement;
    globals.HTMLAnchorElement = previousHTMLAnchorElement;
  }
});

test("F-05 mountAttentionInbox conflict chooser submit reveals the pick-first warning instead of guessing a candidate", async () => {
  const globals = globalThis as typeof globalThis & { HTMLElement: typeof HTMLElement; HTMLAnchorElement: typeof HTMLAnchorElement };
  const previousHTMLElement = globals.HTMLElement;
  const previousHTMLAnchorElement = globals.HTMLAnchorElement;
  globals.HTMLElement = FakeElement as unknown as typeof HTMLElement;
  globals.HTMLAnchorElement = class {} as unknown as typeof HTMLAnchorElement;
  const body = new FakeBody();
  const calls: string[] = [];
  const vm: AttentionHomeVM = { primary: undefined, queue: [], background_runs: [], cuu_state: "idle" };

  try {
    const handle = mountAttentionInbox({
      body: body as unknown as HTMLElement,
      locale: "zh-CN",
      client: {
        pages: { async attention() { return vm; } },
        async chooseMergeProposalCandidate(id: string) {
          calls.push(`choose:${id}`);
          return {};
        },
        async applyMergeProposalCandidate(id: string) {
          calls.push(`apply:${id}`);
          return { attention: { summary_text: "不该走到这" } };
        }
      } as never,
      setSubtitle() {},
      toast(message: string, tone?: string) {
        calls.push(`toast:${tone}:${message}`);
      },
      requestResize() {},
      open() {}
    });
    await tick();
    calls.length = 0;

    const warning = new FakeElement();
    warning.setAttribute("hidden");
    const chooserContainer = new FakeElement();
    chooserContainer.setQueryResult("[data-conflict-chooser-option]:checked", null);
    chooserContainer.setQueryResult("[data-proposal-conflict-chooser-warning]", warning);
    const submit = new FakeElement(
      new Set(["[data-prop-conflict-panel] a[href],[data-prop-conflict-panel] [data-action-href],[data-prop-conflict-panel] [data-href]"]),
      { actionHref: "/api/merge-proposals/choose-selected", proposalConflictChooserSubmit: "true" }
    );
    submit.setClosest("[data-proposal-conflict-chooser]", chooserContainer);

    assert.equal(warning.hasAttribute("hidden"), true);
    body.click(submit);
    await tick();

    // 没选中就不猜——choose/apply/toast 都不该被调用，只点亮既有的提示条。
    assert.deepEqual(calls, []);
    assert.equal(warning.hasAttribute("hidden"), false);
    handle.dispose();
  } finally {
    globals.HTMLElement = previousHTMLElement;
    globals.HTMLAnchorElement = previousHTMLAnchorElement;
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

// ── R23 F-04（升级转交端到端）─────────────────────────────────────────────────────
// 此前桌面 attention 把「转交他人」整个剥掉（rank8）：服务端即便发这个动作也进不了界面，
// 而 runAction 末尾那句「这类请到对应能力处理」的兜底 toast 会先接住它（侦察 C3）。
// 下面四条把「按钮留着 → 就地展开选人层 → 选人提交 → 未选人不发请求」整条路径钉住。

const delegateEscalationId = "40000000-0000-4000-8000-000000000f04";
const delegateEscalationHref = `/api/escalations/${delegateEscalationId}/delegate`;
const delegateTeammateId = "40000000-0000-4000-8000-0000000000aa";

function delegateQueueVm(): AttentionHomeVM {
  return {
    primary: undefined,
    queue: [
      {
        id: delegateEscalationId,
        kind: "escalation",
        title: "《供应延期》卡住了",
        actions: [
          { id: "escalation_pm_mode", label: "我来定方向", style: "primary", method: "POST", href: `/api/escalations/${delegateEscalationId}/resolve` },
          { id: "escalation_delegate", label: "转交他人", style: "secondary", method: "POST", href: delegateEscalationHref }
        ]
      }
    ],
    background_runs: [],
    cuu_state: "worried"
  } as unknown as AttentionHomeVM;
}

function delegateHarness(overrides: { rosterMembers?: Array<{ user_id: string; nickname: string; is_admin: boolean }> } = {}) {
  const toasts: Array<{ message: string; tone?: string }> = [];
  const delegateCalls: unknown[] = [];
  const rosterPaths: string[] = [];
  let attentionLoads = 0;
  const members = overrides.rosterMembers ?? [
    { user_id: delegateTeammateId, nickname: "Nova", is_admin: false },
    { user_id: "40000000-0000-4000-8000-0000000000bb", nickname: "Ada", is_admin: true }
  ];
  const client = {
    pages: {
      async attention() {
        attentionLoads += 1;
        return delegateQueueVm();
      }
    },
    async request(path: string) {
      rosterPaths.push(path);
      return { members, total: members.length, limit: 100, offset: 0 };
    },
    async delegateEscalation(id: string, payload: unknown, options: unknown) {
      delegateCalls.push({ method: "delegateEscalation", id, payload, options });
      return { attention: { summary_text: "已转交给 Nova，等她拿主意" } };
    },
    async delegateApproval(id: string, payload: unknown) {
      delegateCalls.push({ method: "delegateApproval", id, payload });
      return { ok: true };
    }
  };
  return {
    client,
    toasts,
    delegateCalls,
    rosterPaths,
    attentionLoads: () => attentionLoads,
    ctx: {
      locale: "zh-CN" as const,
      client: client as never,
      setSubtitle() {},
      toast(message: string, tone?: string) {
        toasts.push({ message, ...(tone ? { tone } : {}) });
      },
      requestResize() {},
      open() {}
    }
  };
}

test("R23 F-04 desktop attention keeps the hand-off action on the card instead of stripping it", async () => {
  const globals = globalThis as typeof globalThis & { HTMLElement: typeof HTMLElement };
  const previousHTMLElement = globals.HTMLElement;
  globals.HTMLElement = FakeElement as unknown as typeof HTMLElement;
  const body = new FakeBody();
  const harness = delegateHarness();

  try {
    const handle = mountAttentionInbox({ ...harness.ctx, body: body as unknown as HTMLElement });
    await tick();

    assert.match(body.innerHTML, /data-att-action-id="escalation_delegate"/u);
    assert.match(body.innerHTML, new RegExp(`data-att-href="${delegateEscalationHref}"`, "u"));
    assert.match(body.innerHTML, /转交他人/u);
    handle.dispose();
  } finally {
    globals.HTMLElement = previousHTMLElement;
  }
});

test("R23 F-04 clicking hand-off opens the picker and lazy-loads the roster — it does not submit", async () => {
  const globals = globalThis as typeof globalThis & { HTMLElement: typeof HTMLElement };
  const previousHTMLElement = globals.HTMLElement;
  globals.HTMLElement = FakeElement as unknown as typeof HTMLElement;
  const body = new FakeBody();
  const harness = delegateHarness();

  try {
    const handle = mountAttentionInbox({ ...harness.ctx, body: body as unknown as HTMLElement });
    await tick();

    const select = new FakeSelect();
    const host = new FakeElement();
    host.queryResults.set("[data-att-delegate]", null);
    host.queryResults.set("[data-att-delegate] [data-att-delegate-select]", select);
    const actionBtn = new FakeElement(new Set(["[data-att-action-id]", "[data-att-actionrow]"]), {
      attHref: delegateEscalationHref,
      attActionId: "escalation_delegate"
    });
    actionBtn.parentElement = host;

    body.click(actionBtn);
    await tick();
    await tick();

    // 选人层挂在动作行后面（与打回理由层同款），带着这条升级的真 href。
    assert.equal(actionBtn.insertedHtml.length, 1);
    assert.equal(actionBtn.insertedHtml[0]?.position, "afterend");
    assert.match(String(actionBtn.insertedHtml[0]?.html), new RegExp(`data-att-delegate-href="${delegateEscalationHref}"`, "u"));
    assert.match(String(actionBtn.insertedHtml[0]?.html), /data-att-delegate-submit/u);
    // 成员来自工作区花名册，翻页参数照端点契约。
    assert.deepEqual(harness.rosterPaths, ["/api/workspace/roster?limit=100&offset=0"]);
    assert.deepEqual(select.replaced.map((option) => option.textContent), ["Nova", "Ada（管理员）"]);
    assert.deepEqual(select.replaced.map((option) => option.value), [delegateTeammateId, "40000000-0000-4000-8000-0000000000bb"]);
    // 只展开，不提交——也没落到「这类请到对应能力处理」的兜底 toast（侦察 C3）。
    assert.deepEqual(harness.delegateCalls, []);
    assert.deepEqual(harness.toasts, []);
    handle.dispose();
  } finally {
    globals.HTMLElement = previousHTMLElement;
  }
});

test("R23 F-04 confirming the hand-off calls delegateEscalation and reads back the server's own wording", async () => {
  const globals = globalThis as typeof globalThis & { HTMLElement: typeof HTMLElement };
  const previousHTMLElement = globals.HTMLElement;
  globals.HTMLElement = FakeElement as unknown as typeof HTMLElement;
  const body = new FakeBody();
  const harness = delegateHarness();

  try {
    const handle = mountAttentionInbox({ ...harness.ctx, body: body as unknown as HTMLElement });
    await tick();
    const loadsAfterMount = harness.attentionLoads();

    const select = new FakeSelect();
    const submitBtn = new FakeElement(new Set(["[data-att-delegate-submit]", "[data-att-delegate]"]), {
      attDelegateHref: delegateEscalationHref
    });
    submitBtn.queryResults.set("[data-att-delegate-select]", select);

    // 没选人就点确认：不发请求，直说要先选人。
    body.click(submitBtn);
    await tick();
    await tick();
    assert.deepEqual(harness.delegateCalls, []);
    assert.deepEqual(harness.toasts, [{ message: "先选一位同事，再确认转交", tone: "error" }]);

    select.value = delegateTeammateId;
    body.click(submitBtn);
    await tick();
    await tick();
    await tick();

    assert.deepEqual(harness.delegateCalls, [{
      method: "delegateEscalation",
      id: delegateEscalationId,
      payload: { to_user_id: delegateTeammateId },
      options: { locale: "zh-CN" }
    }]);
    assert.deepEqual(harness.toasts[1], { message: "已转交给 Nova，等她拿主意", tone: "ok" });
    // 转交成功后队列重拉——卡片的归属/可见性以服务端为准，不靠前端猜。
    assert.ok(harness.attentionLoads() > loadsAfterMount);
    handle.dispose();
  } finally {
    globals.HTMLElement = previousHTMLElement;
  }
});

test("R23 F-04 an inbox opened on a named card focuses it once, then stops pulling the reader back", async () => {
  const globals = globalThis as typeof globalThis & { HTMLElement: typeof HTMLElement };
  const previousHTMLElement = globals.HTMLElement;
  globals.HTMLElement = FakeElement as unknown as typeof HTMLElement;
  const body = new FakeBody();
  const harness = delegateHarness();
  const namedCard = new FakeElement(new Set(), { attId: delegateEscalationId });
  const otherCard = new FakeElement(new Set(), { attId: "40000000-0000-4000-8000-000000000f99" });
  body.queryAllResults.set("[data-att-id]", [otherCard, namedCard]);

  try {
    const handle = mountAttentionInbox({
      ...harness.ctx,
      body: body as unknown as HTMLElement,
      target: { id: delegateEscalationId }
    });
    await tick();

    assert.equal(namedCard.dataset["attFocus"], "true");
    assert.equal(otherCard.dataset["attFocus"], undefined);

    // 再刷新一次（转交成功后就会发生）——高亮只认一次，不该把人从当前位置拽回去。
    delete namedCard.dataset["attFocus"];
    handle.refresh();
    await tick();
    await tick();
    assert.equal(namedCard.dataset["attFocus"], undefined);
    handle.dispose();
  } finally {
    globals.HTMLElement = previousHTMLElement;
  }
});

// R27（真机走查）：快捷入口「审批队列」写着「1 条待你拍板」时，工作台左上「待拍板」还是「都处理完了」。
// 两面读的本来就是同一个 GET /api/pages/attention，但各自在自己的文件里把 queue 数了一遍——这条
// 测试把「同一件待拍板的事在两面必须是同一个数」钉在一处，两面从此都只经 pendingDecisionCount。
test("R27 同一条待审批在快捷入口副标题与工作台徽标上是同一个数", async () => {
  const globals = globalThis as { HTMLElement?: unknown };
  const previousHTMLElement = globals.HTMLElement;
  globals.HTMLElement = FakeElement;
  const body = new FakeBody();
  let subtitle = "";
  // 一条来自 approval_requests 的待审批（决策队列四个来源之一）。
  const vm = {
    queue: [
      {
        id: "ap-1",
        kind: "approval",
        title: "把这次改动发出去",
        summary: "需要你拍板",
        actions: []
      }
    ],
    background_runs: [],
    cuu_state: "idle"
  } as unknown as AttentionHomeVM;

  try {
    const handle = mountAttentionInbox({
      body: body as unknown as HTMLElement,
      locale: "zh-CN",
      client: { pages: { async attention() { return vm; } } } as never,
      setSubtitle(text: string) {
        subtitle = text;
      },
      toast() {},
      requestResize() {},
      open() {}
    });
    await tick();

    assert.equal(subtitle, "1 条待你拍板");
    // 工作台左上徽标读的是同一份计数（shell.ts 的 refreshInboxBadge → store.inboxCount）。
    const railHtml = renderInboxNavHtml(true, false, pendingDecisionCount(vm));
    assert.match(railHtml, /data-wb-inbox-count="1"/u);
    assert.match(railHtml, />1</u);
    handle.dispose();
  } finally {
    globals.HTMLElement = previousHTMLElement;
  }
});

// 队列空了两面也要一致：快捷入口说「都处理完了」，工作台徽标干脆不渲。
test("R27 队列为空时两面同样一致：一句「都处理完了」，一个不渲的徽标", async () => {
  const globals = globalThis as { HTMLElement?: unknown };
  const previousHTMLElement = globals.HTMLElement;
  globals.HTMLElement = FakeElement;
  const body = new FakeBody();
  let subtitle = "";
  const vm = { queue: [], background_runs: [], cuu_state: "idle" } as unknown as AttentionHomeVM;
  try {
    const handle = mountAttentionInbox({
      body: body as unknown as HTMLElement,
      locale: "zh-CN",
      client: { pages: { async attention() { return vm; } } } as never,
      setSubtitle(text: string) {
        subtitle = text;
      },
      toast() {},
      requestResize() {},
      open() {}
    });
    await tick();

    assert.equal(subtitle, "都处理完了");
    assert.equal(pendingDecisionCount(vm), 0);
    assert.doesNotMatch(renderInboxNavHtml(true, false, pendingDecisionCount(vm)), /data-wb-inbox-count/u);
    handle.dispose();
  } finally {
    globals.HTMLElement = previousHTMLElement;
  }
});
