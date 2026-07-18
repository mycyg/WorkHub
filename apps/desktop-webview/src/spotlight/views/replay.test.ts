import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentRunLiveVM, AgentStep } from "@workhub/contracts";

import { createReplayView, runListHtml } from "./replay.js";

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
