import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRunLiveVM } from "@workhub/contracts";

import { renderAgentRunLive } from "./render.js";

const baseRun = {
  run: {
    id: "40000000-0000-4000-8000-000000000025",
    work_item_id: "50000000-0000-4000-8000-000000000021",
    mode: "worker",
    actor: "human",
    status: "running",
    model: "deepseek-v4-flash",
    turns_used: 1,
    max_turns: 15,
    token_in: 10,
    token_out: 20,
    cost_estimate: "0.003",
    created_at: "2026-06-05T00:00:00.000Z",
    updated_at: "2026-06-05T00:00:01.000Z"
  },
  run_id: "40000000-0000-4000-8000-000000000025",
  work_item_id: "50000000-0000-4000-8000-000000000021",
  title: "Executable worker run",
  status: "running",
  budget: {
    max_steps: 15,
    total_timeout_s: 300,
    max_tokens: 120000,
    max_cost_cny: "5"
  },
  budget_decision: {
    decision_id: "decision-run",
    allowed: true,
    model_route: {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      reason: "default"
    }
  },
  usage: {
    steps_used: 1,
    token_in: 10,
    token_out: 20,
    estimated_cost_cny: "0.003"
  },
  trace: [
    {
      id: "60000000-0000-4000-8000-000000000001",
      agent_run_id: "40000000-0000-4000-8000-000000000025",
      step_no: 1,
      phase: "think",
      input_json: {},
      output_excerpt: "Cuu 正在读取项目文档。",
      created_at: "2026-06-05T00:00:01.000Z"
    }
  ],
  stream_href: "/api/push/stream/run/40000000-0000-4000-8000-000000000025",
  replay_href: "/api/agent-runs/40000000-0000-4000-8000-000000000025/replay"
} satisfies AgentRunLiveVM;

test("agent run renderer shows live trace, budget, stream and replay affordances", () => {
  const rendered = renderAgentRunLive(baseRun, "web");

  assert.equal(rendered.surface, "web");
  assert.equal(rendered.runId, baseRun.run_id);
  assert.equal(rendered.cuuState, "thinking");
  assert.equal(rendered.traceCount, 1);
  assert.equal(rendered.streamHref, baseRun.stream_href);
  assert.equal(rendered.replayHref, baseRun.replay_href);
  assert.equal(rendered.html.includes("AI 实时执行"), true);
  assert.equal(rendered.html.includes("取消执行"), true);
  assert.equal(rendered.html.includes("AI 正在整理材料，稍后给你下一步。"), true);
  assert.equal(rendered.html.includes("隐藏推理内容"), false);
  assert.equal(rendered.html.includes("Cuu 正在读取项目文档。"), false);
});

test("agent run renderer celebrates completed runs without showing cancel action", () => {
  const completed = {
    ...baseRun,
    run: { ...baseRun.run, status: "succeeded" as const, turns_used: 2 },
    status: "succeeded" as const,
    trace: [
      ...baseRun.trace,
      {
        id: "60000000-0000-4000-8000-000000000002",
        agent_run_id: baseRun.run_id,
        step_no: 2,
        phase: "final" as const,
        input_json: {},
        output_excerpt: "交付完成。",
        created_at: "2026-06-05T00:00:02.000Z"
      }
    ]
  } satisfies AgentRunLiveVM;
  const rendered = renderAgentRunLive(completed, "desktop");

  assert.equal(rendered.surface, "desktop");
  assert.equal(rendered.cuuState, "celebrating");
  assert.equal(rendered.html.includes("做完啦"), true);
  assert.equal(rendered.html.includes("取消执行"), false);
});

test("agent run renderer localizes fixed labels and visible run status in English", () => {
  const rendered = renderAgentRunLive(baseRun, "web", { locale: "en-US" });

  assert.equal(rendered.html.includes("Live AI work"), true);
  assert.equal(rendered.html.includes("Cancel run"), true);
  assert.equal(rendered.html.includes("Running"), true);
  assert.equal(rendered.html.includes("Thinking"), true);
  assert.equal(rendered.html.includes(">running<"), false);
  assert.equal(rendered.html.includes("AI 实时执行"), false);
  assert.equal(rendered.html.includes("AI is organizing the materials and preparing the next step."), true);
  assert.equal(rendered.html.includes("hidden reasoning"), false);
  assert.equal(rendered.html.includes("Cuu 正在读取项目文档。"), false);
});

test("findings: budget card token unit is localized, no hardcoded English 'tokens' in zh", () => {
  const renderedZh = renderAgentRunLive(baseRun, "web", { locale: "zh-CN" });
  // 之前硬编码 ' tokens' 单位会漏进 zh；现在走 generic.tokens 文案键。
  assert.equal(renderedZh.html.includes(" tokens<"), false);
  assert.equal(renderedZh.html.includes("令牌"), true);

  const renderedEn = renderAgentRunLive(baseRun, "web", { locale: "en-US" });
  assert.equal(renderedEn.html.includes("tokens<"), true);
});
