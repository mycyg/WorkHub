import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { eventTypes } from "@workhub/contracts";
import { toCuuState } from "@workhub/events";
import { createBuiltInFileTools, createToolRegistry } from "@workhub/tools";

import type { LlmCreateResponse, LlmStream, LlmStreamEvent } from "../providers/types.js";
import { createAgentLoop, type AgentLoopClient, type AgentLoopEvent } from "./index.js";

const budget = {
  maxSteps: 5,
  totalTimeoutSeconds: 300,
  maxTokens: 120000,
  maxCostCny: "5",
  maxFiles: 800,
  maxBytes: 200 * 1024 * 1024,
  commandTimeoutSeconds: 45
};

async function tempWorkdir() {
  return mkdtemp(path.join(os.tmpdir(), "workhub-agent-loop-"));
}

function fakeClient(responses: LlmCreateResponse[]): AgentLoopClient {
  return {
    model: "fake-model",
    messages: {
      async create() {
        const response = responses.shift();
        if (!response) {
          throw new Error("No fake response queued");
        }
        return response;
      }
    }
  };
}

class FakeStream implements LlmStream {
  constructor(private readonly final: LlmCreateResponse) {}

  async *[Symbol.asyncIterator](): AsyncIterator<LlmStreamEvent> {
    yield { type: "content_block_delta", data: { text: "partial" } };
  }

  async getFinalMessage() {
    return this.final;
  }
}

function fakeStreamingClient(responses: LlmCreateResponse[]) {
  const calls = { create: 0, stream: 0 };
  const client: AgentLoopClient = {
    model: "fake-model",
    messages: {
      async create() {
        calls.create += 1;
        throw new Error("create should not be used when stream is available");
      },
      async stream() {
        calls.stream += 1;
        const response = responses.shift();
        if (!response) {
          throw new Error("No fake stream response queued");
        }
        return new FakeStream(response);
      }
    }
  };
  return { client, calls };
}

test("AgentLoop completes when the model stops after writing outputs", async () => {
  const workdir = await tempWorkdir();
  const tools = createToolRegistry(createBuiltInFileTools());
  const loop = createAgentLoop();
  const result = await loop.run({
    runId: "40000000-0000-4000-8000-000000000001",
    workItemId: "50000000-0000-4000-8000-000000000001",
    workdir,
    systemPrompt: "work",
    initialUserMessage: "write a file",
    client: fakeClient([
      {
        id: "m1",
        stopReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 20 },
        usageRecord: {
          provider: "deepseek",
          model: "deepseek-v4-flash",
          task: "worker",
          inputTokens: 10,
          outputTokens: 20,
          estimatedCostCny: "0.001",
          source: "agent_step",
          createdAt: "2026-06-05T00:00:00.000Z"
        },
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "write_file",
            input: { path: "outputs/result.md", content: "done" }
          }
        ]
      },
      {
        id: "m2",
        stopReason: "end_turn",
        usage: { inputTokens: 5, outputTokens: 5 },
        usageRecord: {
          provider: "deepseek",
          model: "deepseek-v4-flash",
          task: "worker",
          inputTokens: 5,
          outputTokens: 5,
          estimatedCostCny: "0.002",
          source: "agent_step",
          createdAt: "2026-06-05T00:00:01.000Z"
        },
        content: [{ type: "text", text: "交付完成" }]
      }
    ]),
    tools,
    budget,
    snapshot: () => ({ snapshotId: "60000000-0000-4000-8000-000000000001" })
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.steps.length, 2);
  assert.equal(result.usage.totalTokens, 40);
  assert.equal(result.usage.estimatedCostCny, "0.003");
  assert.equal(result.steps[0]?.snapshotId, "60000000-0000-4000-8000-000000000001");
  assert.equal(result.manifest?.work_item_id, "50000000-0000-4000-8000-000000000001");
  assert.equal(result.manifest?.base.snapshot_id, "60000000-0000-4000-8000-000000000001");
  assert.equal(result.manifest?.changes.some((change) => change.target_ref.path === "/outputs/result.md"), true);
  assert.equal(result.manifest?.checks.some((check) => check.id === "revert_available" && check.status === "passed"), true);
});

test("AgentLoop escalates repeated identical tool calls as a doom loop", async () => {
  const workdir = await tempWorkdir();
  const tools = createToolRegistry(createBuiltInFileTools());
  const loop = createAgentLoop();
  const repeated = {
    type: "tool_use",
    id: "tool-1",
    name: "read_file",
    input: { path: "missing.md" }
  };
  const result = await loop.run({
    runId: "40000000-0000-4000-8000-000000000002",
    workItemId: "50000000-0000-4000-8000-000000000002",
    workdir,
    systemPrompt: "work",
    initialUserMessage: "read",
    client: fakeClient([
      { id: "m1", stopReason: "tool_use", content: [repeated] },
      { id: "m2", stopReason: "tool_use", content: [{ ...repeated, id: "tool-2" }] },
      { id: "m3", stopReason: "tool_use", content: [{ ...repeated, id: "tool-3" }] }
    ]),
    tools,
    budget
  });

  assert.equal(result.status, "escalated");
  assert.equal(result.reason, "doom_loop");
  assert.equal(result.handoff?.budgetHit, "doom_loop");
});

test("AgentLoop prefers streaming clients and emits formal trace events", async () => {
  const workdir = await tempWorkdir();
  const tools = createToolRegistry(createBuiltInFileTools());
  const loop = createAgentLoop();
  const { client, calls } = fakeStreamingClient([
    {
      id: "m1",
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 20 },
      content: [
        {
          type: "tool_use",
          id: "tool-1",
          name: "write_file",
          input: { path: "outputs/result.md", content: "done" }
        }
      ]
    },
    {
      id: "m2",
      stopReason: "end_turn",
      usage: { inputTokens: 5, outputTokens: 5 },
      content: [
        { type: "thinking", thinking: "检查交付物" },
        { type: "text", text: "交付完成" }
      ]
    }
  ]);
  const events: AgentLoopEvent[] = [];

  const result = await loop.run({
    runId: "40000000-0000-4000-8000-000000000003",
    workItemId: "50000000-0000-4000-8000-000000000003",
    workdir,
    systemPrompt: "work",
    initialUserMessage: "write a file",
    client,
    tools,
    budget,
    reviewDeliverable: false,
    snapshot: () => ({ snapshotId: "60000000-0000-4000-8000-000000000003" }),
    emit: (event) => {
      events.push(event);
    }
  });

  assert.equal(result.status, "succeeded");
  assert.equal(calls.stream, 2);
  assert.equal(calls.create, 0);
  assert.equal(events.every((event) => Object.values(eventTypes).includes(event.type)), true);
  assert.equal(events.some((event) => event.type === eventTypes.stepSnapshot), true);
  assert.equal(events.some((event) => event.type === eventTypes.stepToolResult), true);
  assert.equal(
    events.some((event) => event.type === eventTypes.agentRunStep && event.data.kind === "tool_call"),
    true
  );
  assert.equal(
    events.some((event) => event.type === eventTypes.agentRunStep && event.data.kind === "thinking"),
    true
  );
  assert.equal(toCuuState({ type: eventTypes.agentRunStep }), "thinking");
});

test("AgentLoop compacts after a max_tokens truncation and continues to success", async () => {
  const workdir = await tempWorkdir();
  const tools = createToolRegistry(createBuiltInFileTools());
  const loop = createAgentLoop();
  const events: AgentLoopEvent[] = [];
  const result = await loop.run({
    runId: "40000000-0000-4000-8000-000000000004",
    workItemId: "50000000-0000-4000-8000-000000000004",
    workdir,
    systemPrompt: "work",
    initialUserMessage: "write a long report",
    client: fakeClient([
      {
        id: "m1",
        stopReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 20 },
        content: [{
          type: "tool_use",
          id: "tool-1",
          name: "write_file",
          input: { path: "outputs/report.md", content: "part one" }
        }]
      },
      {
        id: "m2",
        stopReason: "max_tokens",
        usage: { inputTokens: 10, outputTokens: 4096 },
        content: [{ type: "text", text: "报告写到一半就被截" }]
      },
      {
        id: "m3",
        stopReason: "end_turn",
        usage: { inputTokens: 5, outputTokens: 5 },
        content: [{ type: "text", text: "交付完成" }]
      }
    ]),
    tools,
    budget,
    snapshot: () => ({ snapshotId: "60000000-0000-4000-8000-000000000004" }),
    emit: (event) => {
      events.push(event);
    }
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.usage.compactions, 1);
  assert.equal(events.some((event) => event.type === eventTypes.agentRunCompacting && event.data.trigger === "max_tokens"), true);
  assert.equal(result.steps.length, 3);
});

test("AgentLoop escalates when the compaction budget is exhausted", async () => {
  const workdir = await tempWorkdir();
  const tools = createToolRegistry(createBuiltInFileTools());
  const loop = createAgentLoop();
  const truncated = (id: string) => ({
    id,
    stopReason: "max_tokens",
    usage: { inputTokens: 10, outputTokens: 4096 },
    content: [{ type: "text" as const, text: `截断 ${id}` }]
  });
  const result = await loop.run({
    runId: "40000000-0000-4000-8000-000000000005",
    workItemId: "50000000-0000-4000-8000-000000000005",
    workdir,
    systemPrompt: "work",
    initialUserMessage: "write",
    client: fakeClient([truncated("m1"), truncated("m2"), truncated("m3")]),
    tools,
    budget: { ...budget, maxCompactions: 2 },
    requireDeliverable: false
  });

  assert.equal(result.status, "escalated");
  assert.equal(result.reason, "compact_required");
  assert.equal(result.usage.compactions, 2);
});

test("AgentLoop truncates oversized tool results in the conversation context", async () => {
  const workdir = await tempWorkdir();
  const tools = createToolRegistry(createBuiltInFileTools());
  const loop = createAgentLoop();
  const seenMessages: unknown[] = [];
  const big = "x".repeat(20000);
  const client: AgentLoopClient = {
    model: "fake-model",
    messages: {
      async create(params) {
        seenMessages.push(JSON.parse(JSON.stringify(params.messages)));
        if (seenMessages.length === 1) {
          return {
            id: "m1",
            stopReason: "tool_use",
            content: [{
              type: "tool_use",
              id: "tool-1",
              name: "write_file",
              input: { path: "outputs/big.md", content: big }
            }]
          };
        }
        if (seenMessages.length === 2) {
          return {
            id: "m2",
            stopReason: "tool_use",
            content: [{
              type: "tool_use",
              id: "tool-2",
              name: "read_file",
              input: { path: "outputs/big.md" }
            }]
          };
        }
        return {
          id: "m3",
          stopReason: "end_turn",
          content: [{ type: "text", text: "done" }]
        };
      }
    }
  };
  const result = await loop.run({
    runId: "40000000-0000-4000-8000-000000000006",
    workItemId: "50000000-0000-4000-8000-000000000006",
    workdir,
    systemPrompt: "work",
    initialUserMessage: "write",
    client,
    tools,
    budget: { ...budget, toolResultContextChars: 500 },
    snapshot: () => ({ snapshotId: "60000000-0000-4000-8000-000000000006" })
  });

  assert.equal(result.status, "succeeded");
  const thirdCall = seenMessages[2] as Array<{ role: string; content: unknown }>;
  const toolResultMessage = [...thirdCall].reverse().find((message) =>
    Array.isArray(message.content) &&
    (message.content as Array<{ type?: string }>).some((block) => block.type === "tool_result")
  );
  const blocks = toolResultMessage?.content as Array<{ type: string; content: string }>;
  const toolResult = blocks.find((block) => block.type === "tool_result");
  assert.ok(toolResult);
  assert.equal(toolResult.content.length < 700, true);
  assert.equal(toolResult.content.includes("完整内容见 trace"), true);
});

test("AgentLoop retries transient provider errors with backoff and then succeeds", async () => {
  const workdir = await tempWorkdir();
  const tools = createToolRegistry(createBuiltInFileTools());
  const loop = createAgentLoop();
  const events: AgentLoopEvent[] = [];
  let calls = 0;
  const client: AgentLoopClient = {
    model: "fake-model",
    messages: {
      async create() {
        calls += 1;
        if (calls <= 2) {
          throw Object.assign(new Error("rate limited"), {
            status: 429,
            headers: { get: () => null }
          });
        }
        return {
          id: "m1",
          stopReason: "end_turn",
          content: [{ type: "text", text: "done" }]
        };
      }
    }
  };
  const result = await loop.run({
    runId: "40000000-0000-4000-8000-000000000007",
    workItemId: "50000000-0000-4000-8000-000000000007",
    workdir,
    systemPrompt: "work",
    initialUserMessage: "say done",
    client,
    tools,
    budget: { ...budget, providerRetryBaseDelayMs: 1 },
    requireDeliverable: false,
    reviewDeliverable: false,
    emit: (event) => {
      events.push(event);
    }
  });

  assert.equal(result.status, "succeeded");
  assert.equal(calls, 3);
  assert.equal(events.filter((event) => event.data.kind === "provider_retry").length, 2);
});

test("AgentLoop does not retry non-transient provider errors", async () => {
  const workdir = await tempWorkdir();
  const tools = createToolRegistry(createBuiltInFileTools());
  const loop = createAgentLoop();
  let calls = 0;
  const client: AgentLoopClient = {
    model: "fake-model",
    messages: {
      async create() {
        calls += 1;
        throw Object.assign(new Error("bad request"), {
          status: 400,
          headers: { get: () => null }
        });
      }
    }
  };
  await assert.rejects(() => loop.run({
    runId: "40000000-0000-4000-8000-000000000008",
    workItemId: "50000000-0000-4000-8000-000000000008",
    workdir,
    systemPrompt: "work",
    initialUserMessage: "say done",
    client,
    tools,
    budget: { ...budget, providerRetryBaseDelayMs: 1 },
    requireDeliverable: false
  }));
  assert.equal(calls, 1);
});

test("AgentLoop runs an llm_review after success and carries the grade into the result", async () => {
  const workdir = await tempWorkdir();
  const tools = createToolRegistry(createBuiltInFileTools());
  const loop = createAgentLoop();
  const result = await loop.run({
    runId: "40000000-0000-4000-8000-000000000009",
    workItemId: "50000000-0000-4000-8000-000000000009",
    workdir,
    systemPrompt: "work",
    initialUserMessage: "任务：写一份报告",
    client: fakeClient([
      {
        id: "m1",
        stopReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 20 },
        content: [{
          type: "tool_use",
          id: "tool-1",
          name: "write_file",
          input: { path: "outputs/report.md", content: "报告" }
        }]
      },
      {
        id: "m2",
        stopReason: "end_turn",
        usage: { inputTokens: 5, outputTokens: 5 },
        content: [{ type: "text", text: "交付完成" }]
      },
      {
        id: "review-1",
        stopReason: "end_turn",
        usage: { inputTokens: 30, outputTokens: 20 },
        content: [{ type: "text", text: "{\"grade\": 4, \"rationale\": \"结构完整，可基本直接采纳\"}" }]
      }
    ]),
    tools,
    budget,
    snapshot: () => ({ snapshotId: "60000000-0000-4000-8000-000000000009" })
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.review?.grade, 4);
  assert.equal(result.review?.source, "llm_review");
  assert.equal(result.review?.rationale.includes("采纳"), true);
  assert.equal(result.usage.totalTokens, 90);
});
