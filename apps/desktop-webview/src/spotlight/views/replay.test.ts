import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentRunLiveVM } from "@workhub/contracts";

import { createReplayView, runListHtml } from "./replay.js";

const ts = "2026-07-03T10:24:00.000Z";

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
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
  view.mount({
    client: { async getAgentRun() { return liveRun(); } },
    locale: "zh-CN",
    body,
    back() {},
    open() {},
    target: { id: "93000000-0000-4000-8000-000000000911" },
    setSubtitle() {},
    toast() {},
    requestResize() {},
    signal: new AbortController().signal
  } as unknown as Parameters<typeof view.mount>[0]);
  await tick();

  assert.match(body.innerHTML, /工具结果/u);
  assert.match(body.innerHTML, /工具已返回，AI 正在整理下一步。/u);
  // R9.7 review: the old replay line appended raw `tool_name`; visible Spotlight
  // copy must not expose machine ids even when the trace keeps them.
  assert.doesNotMatch(body.innerHTML, /read_project_file|markdown-report/u);
});
