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
  assert.equal(rendered.html.includes("已完成"), true);
  assert.equal(rendered.html.includes("取消执行"), false);
});

test("agent run renderer localizes fixed labels and visible run status in English", () => {
  const rendered = renderAgentRunLive(baseRun, "web", { locale: "en-US" });

  assert.equal(rendered.html.includes("Live AI work"), true);
  assert.equal(rendered.html.includes("Cancel run"), true);
  assert.equal(rendered.html.includes("In progress"), true);
  assert.equal(rendered.html.includes("Thinking"), true);
  assert.equal(rendered.html.includes(">running<"), false);
  assert.equal(rendered.html.includes("AI 实时执行"), false);
  assert.equal(rendered.html.includes("AI is organizing the materials and preparing the next step."), true);
  assert.equal(rendered.html.includes("hidden reasoning"), false);
  assert.equal(rendered.html.includes("Cuu 正在读取项目文档。"), false);
});

test("findings: budget card token unit is localized, no hardcoded English 'tokens' in zh", () => {
  const renderedZh = renderAgentRunLive(baseRun, "web", { locale: "zh-CN" });
  // UX-R2 词表统一：zh 单位=「token」（与全站「个 token」一致），仍走 generic.tokens 键非硬编码。
  assert.equal(renderedZh.html.includes(" tokens<"), false);
  assert.equal(renderedZh.html.includes("token"), true);

  const renderedEn = renderAgentRunLive(baseRun, "web", { locale: "en-US" });
  assert.equal(renderedEn.html.includes("tokens<"), true);
});

// R26 批 B6 观测面：「重复动作被劝过几次、劝的是什么」要在实时时间线上看得见。
test("B6: 实时时间线在被劝的那一步之后补一条人话提醒行", () => {
  const rendered = renderAgentRunLive(
    {
      ...baseRun,
      trace: [
        { ...baseRun.trace[0]!, step_no: 3, phase: "tool_call" },
        { ...baseRun.trace[0]!, id: "60000000-0000-4000-8000-000000000002", step_no: 4, phase: "tool_call" }
      ],
      reminders: [{ step_no: 3, tier: 1, repeats: 3, shape: "identical", tool_id: "run_command" }]
    },
    "web"
  );

  assert.equal(rendered.html.includes("第一次提醒：Cuu 连续 3 步做了同一件事"), true);
  assert.equal(rendered.html.includes("run_command"), false, "原始工具 id 不该渲给用户");
  // 提醒行紧跟第 3 步、排在第 4 步之前。
  const reminderAt = rendered.html.indexOf('data-phase="reminded"');
  const step4At = rendered.html.lastIndexOf('<span class="wh-dot">4</span>');
  assert.equal(reminderAt > -1 && step4At > reminderAt, true);
});

test("B6: 英文界面渲英文提醒行；脏数据整行不渲，不把半截事实编成句子", () => {
  const withJunk = {
    ...baseRun,
    reminders: [
      { step_no: 1, tier: 2, repeats: 5, shape: "identical", tool_id: "echo" },
      { step_no: 1, repeats: 5, shape: "identical" },
      { step_no: 1, tier: 1, repeats: 3, shape: "spiral" },
      "not-an-object"
    ]
  } as unknown as AgentRunLiveVM;

  const en = renderAgentRunLive(withJunk, "web", { locale: "en-US" });
  assert.equal(en.html.includes("Second reminder: Cuu repeated the same action for 5 steps"), true);
  assert.equal(en.html.match(/data-phase="reminded"/gu)?.length, 1, "只有合法的那一条被渲出来");

  const zh = renderAgentRunLive(withJunk, "web");
  assert.equal(zh.html.includes("第二次提醒：Cuu 连续 5 步做了同一件事"), true);
});

test("B6: 对不上任何步骤的提醒补在时间线末尾，不被悄悄丢掉", () => {
  const rendered = renderAgentRunLive(
    { ...baseRun, reminders: [{ step_no: 99, tier: 1, repeats: 3, shape: "alternating" }] },
    "web"
  );

  assert.equal(rendered.html.includes("第一次提醒：Cuu 连续 3 步在两个动作之间来回切换"), true);
});

test("B6: 没有提醒的运行渲染完全不变（additive optional，存量响应零回归）", () => {
  assert.equal(renderAgentRunLive(baseRun, "web").html, renderAgentRunLive({ ...baseRun, reminders: [] }, "web").html);
  assert.equal(renderAgentRunLive(baseRun, "web").html.includes('data-phase="reminded"'), false);
});
