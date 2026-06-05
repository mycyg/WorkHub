import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBuiltInFileTools, createToolRegistry } from "@workhub/tools";

import type { LlmCreateResponse } from "../providers/types.js";
import { createAgentLoop, type AgentLoopClient } from "./index.js";

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
  assert.equal(result.steps[0]?.snapshotId, "60000000-0000-4000-8000-000000000001");
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
