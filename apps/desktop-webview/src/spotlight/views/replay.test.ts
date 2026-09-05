import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentRunLiveVM, AgentStep, ReplayTraceVM, Snapshot } from "@workhub/contracts";

import { createReplayView, runListHtml, snapshotsSectionHtml } from "./replay.js";

const ts = "2026-07-03T10:24:00.000Z";

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

// R20 R19-30：trace 增量轮询用 setTimeout 自排程，单测里不能真等 4s——照 search.test.ts 的既有做法
// 劫持全局 setTimeout，把回调收进数组由测试手动触发，制造确定性。
function withMockedSetTimeout<T>(run: (scheduled: Array<() => void>) => Promise<T> | T): Promise<T> {
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const scheduled: Array<() => void> = [];
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => {
    scheduled.push(fn);
    return scheduled.length as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  (globalThis as { clearTimeout: unknown }).clearTimeout = (() => {}) as typeof clearTimeout;
  const restore = () => {
    (globalThis as { setTimeout: unknown }).setTimeout = previousSetTimeout;
    (globalThis as { clearTimeout: unknown }).clearTimeout = previousClearTimeout;
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

function liveRun(): AgentRunLiveVM {
  return {
    run: {
      id: "93000000-0000-4000-8000-000000000911",
      work_item_id: "93000000-0000-4000-8000-000000000901",
      mode: "worker",
      actor: "human",
      status: "running",
      model: "deepseek-v4-pro",
      turns_used: 1,
      max_turns: 10,
      token_in: 10,
      token_out: 20,
      created_at: ts,
      updated_at: ts
    },
    run_id: "93000000-0000-4000-8000-000000000911",
    work_item_id: "93000000-0000-4000-8000-000000000901",
    title: "整理客户周报",
    status: "running",
    budget: { max_steps: 10, total_timeout_s: 300, max_tokens: 10000, max_cost_cny: "5" },
    budget_decision: {
      decision_id: "decision-1",
      allowed: true,
      model_route: { provider: "deepseek", model: "deepseek-v4-pro", reason: "fixture" }
    },
    usage: { steps_used: 2, token_in: 10, token_out: 20, estimated_cost_cny: "0.01" },
    stream_href: "/api/push/stream/run/93000000-0000-4000-8000-000000000911",
    replay_href: "/agent-runs/93000000-0000-4000-8000-000000000911/replay",
    trace: [
      {
        id: "93000000-0000-4000-8000-000000000921",
        agent_run_id: "93000000-0000-4000-8000-000000000911",
        step_no: 1,
        phase: "tool_result",
        tool_name: "read_project_file",
        input_json: {},
        output_excerpt: "--- name: markdown-report description: raw tool payload",
        created_at: ts
      }
    ]
  };
}

test("R9.7 desktop replay empty list avoids dispatch copy", () => {
  const zh = runListHtml([], true);
  const en = runListHtml([], false);

  assert.doesNotMatch(zh, /派活/u);
  assert.doesNotMatch(en, /Dispatch|dispatch/u);
  assert.match(zh, /新建任务后/u);
  assert.match(en, /Create a task/u);
});

test("R9.7 desktop replay hides raw tool ids from visible trace copy", async () => {
  const body = {
    innerHTML: "",
    addEventListener() {}
  } as unknown as HTMLElement;
  const view = createReplayView();
  // R20 R19-30：liveRun() 的 status 是 running——mount 后会排一次增量轮询的 setTimeout。这里不关心轮询
  // 本身（专测见下面的 R19-30 用例），但必须在测试结束前 dispose 清掉这个定时器，否则真 4s 定时器会在
  // 测试进程里空跑，拖慢/污染后续测试。
  // mount() 的契约类型允许异步返回清理函数，但 createReplayView 的实现是同步的——按实际形状断言，
  // 与本文件其它用例一致（避免为一个已知同步的实现拉进不必要的 await/thenable 判别）。
  const dispose = view.mount({
    client: { async getAgentRun() { return liveRun(); } },
    locale: "zh-CN",
    body,
    back() {},
    open() {},
    target: { id: "93000000-0000-4000-8000-000000000911" },
    setSubtitle() {},
    toast() {},
    requestResize() {},
    refocusBody() {},
    signal: new AbortController().signal
  } as unknown as Parameters<typeof view.mount>[0]) as (() => void) | undefined;
  await tick();

  assert.match(body.innerHTML, /工具结果/u);
  assert.match(body.innerHTML, /工具已返回，AI 正在整理下一步。/u);
  // R9.7 review: the old replay line appended raw `tool_name`; visible Spotlight
  // copy must not expose machine ids even when the trace keeps them.
  assert.doesNotMatch(body.innerHTML, /read_project_file|markdown-report/u);
  dispose?.();
});

// R20 R19-30：GET /api/agent-runs/{id}/trace 早支持 ?after= 增量游标（apps/api/src/routes/agent-runs.ts），
// 但桌面/网页此前从没人传过——trace 详情页开着时若 run 还在跑，只会整份 run 重新拉（或干脆不刷新）。
// 根因测试：run 仍在跑（status running）时，详情页排的下一轮轮询必须调 getAgentRunTrace 并带上"目前见过
// 的最大 step_no"作游标，而不是重新整份 getAgentRun——这条断言在改动落地前会红（视图从不调
// getAgentRunTrace），落地后转绿。
test("R19-30 in-progress run trace polls incrementally with the after cursor instead of re-fetching the whole run", async () => {
  const body = {
    innerHTML: "",
    addEventListener() {}
  } as unknown as HTMLElement;

  await withMockedSetTimeout(async (scheduled) => {
    const getAgentRunCalls: string[] = [];
    const traceCalls: Array<{ runId: string; after: number | undefined }> = [];
    const newStep: AgentStep = {
      id: "93000000-0000-4000-8000-000000000922",
      agent_run_id: "93000000-0000-4000-8000-000000000911",
      step_no: 2,
      phase: "tool_call",
      tool_name: "list_work_items",
      input_json: {},
      created_at: ts
    };
    const view = createReplayView();
    const dispose = view.mount({
      client: {
        async getAgentRun(runId: string) {
          getAgentRunCalls.push(runId);
          return liveRun();
        },
        async getAgentRunTrace(runId: string, after?: number) {
          traceCalls.push({ runId, after });
          return [newStep];
        }
      },
      locale: "zh-CN",
      body,
      back() {},
      open() {},
      target: { id: "93000000-0000-4000-8000-000000000911" },
      setSubtitle() {},
      toast() {},
      requestResize() {},
      refocusBody() {},
      signal: new AbortController().signal
    } as unknown as Parameters<typeof view.mount>[0]) as (() => void) | undefined;
    await tick();

    // 首次加载仍是全量（getAgentRun 一次），游标端点这时还没被调用。
    assert.deepEqual(getAgentRunCalls, ["93000000-0000-4000-8000-000000000911"]);
    assert.deepEqual(traceCalls, []);
    assert.equal(scheduled.length, 1, "an active run must schedule exactly one poll timer");

    // 手动推进这一轮轮询（不真等 4s）。
    scheduled[0]?.();
    await tick();
    await tick();

    // 游标语义：liveRun() 初始 trace 只有 step_no=1，增量请求必须带 after=1（目前见过的最大 step_no），
    // 不是 0/undefined（那就是"当全量用"）。
    assert.deepEqual(traceCalls, [{ runId: "93000000-0000-4000-8000-000000000911", after: 1 }]);
    // 第 1 轮既无 final 步也不是第 5 轮，不该触发全量 getAgentRun 兜底核对——否则等于白做了增量。
    assert.deepEqual(getAgentRunCalls, ["93000000-0000-4000-8000-000000000911"]);
    // 新步骤（step_no=2, phase=tool_call）真的追加渲染出来了，而不是原地不动；渲染层按 R9.7 既有约束
    // 只出阶段标签/固定摘要，不裸露 tool_name（同上一条测试的红线）。
    assert.match(body.innerHTML, /调用工具/u);
    assert.match(body.innerHTML, /正在调用工具。/u);
    assert.doesNotMatch(body.innerHTML, /list_work_items/u);

    dispose?.();
  });
});

// ── F-06（一键回滚桌面挂载）：详情态补的「改动快照」区 ──────────────────────────────────────
function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: "94000000-0000-4000-8000-000000000001",
    work_item_id: "93000000-0000-4000-8000-000000000901",
    kind: "pre_step",
    ref: "wip/step-1",
    created_by_kind: "ai",
    created_at: ts,
    ...overrides
  } as Snapshot;
}

function replayVm(snapshots: Snapshot[]): ReplayTraceVM {
  return {
    run: { id: "93000000-0000-4000-8000-000000000911", work_item_id: "93000000-0000-4000-8000-000000000901" },
    steps: [],
    evidence_refs: [],
    snapshots
  } as unknown as ReplayTraceVM;
}

test("F-06 snapshotsSectionHtml renders nothing when there are no snapshots", () => {
  assert.equal(snapshotsSectionHtml(undefined, "run-1", true, true), "");
  assert.equal(snapshotsSectionHtml(replayVm([]), "run-1", true, true), "");
});

test("F-06 snapshotsSectionHtml gives an unreverted snapshot a real undo button carrying the binder's data-* contract", () => {
  const html = snapshotsSectionHtml(replayVm([snapshot()]), "run-7", true, true);
  assert.match(html, /改动快照/u);
  assert.match(html, /data-replay-revert-snapshot="94000000-0000-4000-8000-000000000001"/u);
  assert.match(html, /data-replay-revert-run="run-7"/u);
  assert.match(html, /data-revert-label-idle="撤销此次改动"/u);
  assert.match(html, /data-revert-label-arm="确认撤销？再点一次"/u);
  assert.match(html, />撤销此次改动</u);
  // 注意：不断言全文不含"已回滚"——按钮自己就带着 data-revert-label-reverted="已回滚" 这个数据属性
  // （供 binder 撤销成功后原地换字用），这是预期存在的，不是可见文案泄漏；可见文案的断言见上面几行。
});

test("F-06 snapshotsSectionHtml renders en-US copy", () => {
  const html = snapshotsSectionHtml(replayVm([snapshot()]), "run-7", false, true);
  assert.match(html, /Change snapshots/u);
  assert.match(html, />Undo these changes</u);
});

test("F-06 snapshotsSectionHtml shows an already-reverted snapshot as an inert label, not a button", () => {
  const html = snapshotsSectionHtml(replayVm([snapshot({ reverted_at: ts })]), "run-7", true, true);
  assert.match(html, /data-replay-snapshot-reverted="true"/u);
  assert.match(html, />已回滚</u);
  assert.doesNotMatch(html, /data-replay-revert-snapshot=/u);
});

test("F-06 snapshotsSectionHtml never renders a dead button when the client can't revert", () => {
  const html = snapshotsSectionHtml(replayVm([snapshot()]), "run-7", true, false);
  assert.doesNotMatch(html, /data-replay-revert-snapshot=/u);
  assert.match(html, /本机暂不支持撤销/u);
});

// 最小假 DOM——只服务 bindReplayRevertActions 唯一的查询面（querySelectorAll("[data-replay-revert-snapshot]")）。
// 不做真通用 HTML 解析：从渲染出的真实 innerHTML 里按 <button ...>text</button> 抠出这一种标签，
// 属性顺序无关（逐个 data-* 匹配），这样测试验的是「视图真渲出的按钮」而不是我预先假定的固定形状。
class FakeReplaySnapshotButton {
  dataset: Record<string, string>;
  textContent: string | null;
  private handlers: Array<(event: { preventDefault(): void; stopPropagation(): void }) => void> = [];
  constructor(dataset: Record<string, string>, textContent: string) {
    this.dataset = dataset;
    this.textContent = textContent;
  }
  setAttribute(): void {}
  removeAttribute(name: string): void {
    delete this.dataset[name];
  }
  addEventListener(_type: string, handler: (event: { preventDefault(): void; stopPropagation(): void }) => void): void {
    this.handlers.push(handler);
  }
  click(): void {
    const event = { preventDefault() {}, stopPropagation() {} };
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}

function extractReplayRevertButtons(html: string): FakeReplaySnapshotButton[] {
  const buttons: FakeReplaySnapshotButton[] = [];
  const buttonRe = /<button([^>]*)>([^<]*)<\/button>/gu;
  let m: RegExpExecArray | null;
  while ((m = buttonRe.exec(html))) {
    const attrsRaw = m[1] ?? "";
    if (!/data-replay-revert-snapshot=/u.test(attrsRaw)) continue;
    const dataset: Record<string, string> = {};
    const attrRe = /data-([a-z-]+)="([^"]*)"/gu;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrsRaw))) {
      const key = am[1]!.replace(/-([a-z])/gu, (_, c: string) => c.toUpperCase());
      dataset[key] = am[2]!;
    }
    buttons.push(new FakeReplaySnapshotButton(dataset, m[2] ?? ""));
  }
  return buttons;
}

class FakeReplayBody {
  innerHTML = "";
  // 缓存上一次抽取结果，直到 innerHTML 真的变了——同真实 DOM 同款语义：只要没有重渲，两次
  // querySelectorAll 拿到的是同一批节点对象。binder 绑定监听器的那个对象，必须和测试点击的
  // 是同一个引用，否则测试点的是另一份"平行宇宙"按钮，监听器根本没挂上去（真实 bug 会踩的坑，
  // 这里如果不缓存，假 DOM 会比真 DOM 更容易露出假阳性）。
  private lastHtml: string | undefined;
  private lastButtons: FakeReplaySnapshotButton[] = [];
  addEventListener() {}
  querySelectorAll(selector: string): FakeReplaySnapshotButton[] {
    if (selector !== "[data-replay-revert-snapshot]") return [];
    if (this.innerHTML !== this.lastHtml) {
      this.lastHtml = this.innerHTML;
      this.lastButtons = extractReplayRevertButtons(this.innerHTML);
    }
    return this.lastButtons;
  }
}

test("F-06 opening a run with a snapshot renders a real undo button wired through the shared binder end to end", async () => {
  const body = new FakeReplayBody();
  const revertCalls: Array<{ runId: string; payload: { snapshot_id: string } }> = [];
  let replayCallCount = 0;
  const view = createReplayView();
  const dispose = view.mount({
    client: {
      async getAgentRun() {
        // succeeded（非 queued/running）——这条用例只关心撤销接线，不关心增量轮询，避免两者互相
        // 干扰（succeeded 不会排 setTimeout，测试不用额外劫持定时器）。
        return { ...liveRun(), status: "succeeded" };
      },
      async replayAgentRun() {
        replayCallCount += 1;
        // 第一次拉：快照还没被撤销；成功撤销后 onReverted 触发的第二次拉，服务端已把它标成已回滚——
        // 验证详情态真的重新拉了权威态，不是只信任按钮自己的乐观 DOM patch。
        return replayVm([snapshot(replayCallCount === 1 ? {} : { reverted_at: ts })]);
      },
      revertAgentRun(runId: string, payload: { snapshot_id: string }) {
        revertCalls.push({ runId, payload });
        return Promise.resolve({ status: "reverted" as const, snapshot: snapshot({ reverted_at: ts }) });
      }
    },
    locale: "zh-CN",
    body: body as unknown as HTMLElement,
    back() {},
    open() {},
    target: { id: "93000000-0000-4000-8000-000000000911" },
    setSubtitle() {},
    toast() {},
    requestResize() {},
    refocusBody() {},
    signal: new AbortController().signal
  } as unknown as Parameters<typeof view.mount>[0]) as (() => void) | undefined;
  await tick();
  await tick();

  assert.match(body.innerHTML, /改动快照/u);
  const buttons = body.querySelectorAll("[data-replay-revert-snapshot]");
  assert.equal(buttons.length, 1, "the rendered snapshot must carry exactly one real undo button");
  const button = buttons[0]!;
  assert.equal(button.dataset["replayRevertRun"], "93000000-0000-4000-8000-000000000911");
  assert.equal(button.dataset["replayRevertSnapshot"], "94000000-0000-4000-8000-000000000001");

  button.click(); // 第一次点：武装（确认提示），不发请求。
  assert.equal(revertCalls.length, 0);
  button.click(); // 第二次点：真执行。
  await tick();
  await tick();

  assert.deepEqual(revertCalls, [
    {
      runId: "93000000-0000-4000-8000-000000000911",
      payload: { snapshot_id: "94000000-0000-4000-8000-000000000001" }
    }
  ]);
  // 回滚成功 → 重拉快照 → 服务端权威态已回滚 → 详情态重渲出「已回滚」，而不仅是按钮自身的乐观文案。
  assert.equal(replayCallCount, 2);
  assert.match(body.innerHTML, /已回滚/u);

  dispose?.();
});

test("F-06 a snapshot renders as unactionable text (not a dead button) when the client can't revert", async () => {
  const body = new FakeReplayBody();
  const view = createReplayView();
  const dispose = view.mount({
    client: {
      async getAgentRun() {
        return { ...liveRun(), status: "succeeded" };
      },
      async replayAgentRun() {
        return replayVm([snapshot()]);
      }
      // 没有 revertAgentRun：canRevert=false。
    },
    locale: "zh-CN",
    body: body as unknown as HTMLElement,
    back() {},
    open() {},
    target: { id: "93000000-0000-4000-8000-000000000911" },
    setSubtitle() {},
    toast() {},
    requestResize() {},
    refocusBody() {},
    signal: new AbortController().signal
  } as unknown as Parameters<typeof view.mount>[0]) as (() => void) | undefined;
  await tick();
  await tick();

  assert.match(body.innerHTML, /改动快照/u);
  assert.match(body.innerHTML, /本机暂不支持撤销/u);
  assert.equal(body.querySelectorAll("[data-replay-revert-snapshot]").length, 0);

  dispose?.();
});
