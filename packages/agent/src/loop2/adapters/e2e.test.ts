/**
 * loop2 Phase 1 — end-to-end harness test.
 *
 * Threads all four adapters through the vendored loop with an in-memory,
 * WorkHub-shaped provider stub:
 *
 *   scripted provider (LlmCreateResponse)
 *     → createProviderStreamFn (Adapter 1)      → pi AssistantMessageEventStream
 *   ToolRegistry (zod) → workhubToolsToPi (Adapter 3) → pi AgentTool[]
 *   piMessagesToWorkhub (Adapter 2) builds each request inside the streamFn
 *   runAgentLoop drives a full text → tool call → continue → stop round
 *     → toAgentLoopResult (Adapter 4)           → WorkHub AgentLoopResult
 */

import assert from "node:assert/strict";
import test from "node:test";

import { type AnyToolSpec, createToolRegistry, okToolResult, type ToolExecutionContext } from "@workhub/tools";
import { z } from "zod";

import type { LlmCreateParams, LlmCreateResponse } from "../../providers/types.js";
import { type AgentContext, type AgentLoopConfig, type AgentMessage, type Message, type Model, runAgentLoop } from "../index.js";
import { createProviderStreamFn, type ProviderStreamClient } from "./stream-fn.js";
import { toAgentLoopResult } from "./result.js";
import { workhubAfterToolCall, workhubToolsToPi } from "./tools.js";

function model(): Model {
	return {
		id: "deepseek-x",
		name: "X",
		api: "anthropic",
		provider: "deepseek",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100000,
		maxTokens: 4096,
	};
}

function usageRecord(estimatedCostCny: string) {
	return {
		provider: "deepseek",
		model: "deepseek-x",
		task: "worker" as const,
		inputTokens: 0,
		outputTokens: 0,
		estimatedCostCny,
		source: "agent_step" as const,
		createdAt: new Date().toISOString(),
	};
}

function scriptedClient(responses: LlmCreateResponse[]): { client: ProviderStreamClient; calls: LlmCreateParams[] } {
	const queue = [...responses];
	const calls: LlmCreateParams[] = [];
	const client: ProviderStreamClient = {
		messages: {
			create: async (params) => {
				calls.push(params);
				const next = queue.shift();
				if (!next) throw new Error("scriptedClient: no response left");
				return next;
			},
		},
	};
	return { client, calls };
}

function userMsg(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

const config = (overrides: Partial<AgentLoopConfig>): AgentLoopConfig => ({
	model: model(),
	convertToLlm: (messages) => messages as Message[],
	// WorkHub's production loop executes tool calls sequentially — match it.
	toolExecution: "sequential",
	// Propagate WorkHub's return-based isError into pi's tool-result messages.
	afterToolCall: workhubAfterToolCall,
	...overrides,
});

test("full round: text + tool call + continue + stop, with accurate usage/cost accounting", async () => {
	const executed: Array<{ id: string; message: string }> = [];
	const echoSpec: AnyToolSpec = {
		id: "echo",
		description: "Echo the message back.",
		schema: z.object({ message: z.string() }),
		sideEffect: "none",
		execute: (input: { message: string }, _ctx) => {
			executed.push({ id: "echo", message: input.message });
			return okToolResult(`echo: ${input.message}`);
		},
	};
	const registry = createToolRegistry([echoSpec]);
	const toolCtx: ToolExecutionContext = { workdir: "/tmp/wd" };
	const tools = await workhubToolsToPi(registry, toolCtx);

	const { client, calls } = scriptedClient([
		{
			id: "m1",
			content: [
				{ type: "text", text: "let me echo that" },
				{ type: "tool_use", id: "call-1", name: "echo", input: { message: "hi" } },
			],
			usage: { inputTokens: 20, outputTokens: 10 },
			usageRecord: { ...usageRecord("0.02"), inputTokens: 20, outputTokens: 10 },
			stopReason: "tool_use",
		},
		{
			id: "m2",
			content: [{ type: "text", text: "done" }],
			usage: { inputTokens: 15, outputTokens: 5 },
			usageRecord: { ...usageRecord("0.01"), inputTokens: 15, outputTokens: 5 },
			stopReason: "end_turn",
		},
	]);

	const streamFn = createProviderStreamFn({ client, source: "agent_step" });
	const context: AgentContext = { systemPrompt: "you are a worker", messages: [], tools };
	const messages = await runAgentLoop([userMsg("please echo hi")], context, config({}), () => {}, undefined, streamFn);

	// The tool executed exactly once, and the model was called a second time after the result.
	assert.deepEqual(executed, [{ id: "echo", message: "hi" }]);
	assert.equal(calls.length, 2, "second model call happened after the tool result");
	// The second request carried the tool_result (Adapter 2 pi→WorkHub).
	const secondRequest = calls[1];
	const hasToolResult = Array.isArray(secondRequest?.messages)
		&& secondRequest.messages.some(
			(m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => (b as { type?: string }).type === "tool_result"),
		);
	assert.ok(hasToolResult, "the tool result was echoed back to the provider");

	const result = toAgentLoopResult({ messages });
	assert.equal(result.status, "succeeded");
	assert.equal(result.finalText, "done");
	assert.equal(result.steps.length, 2);
	assert.equal(result.steps[0]?.control, "continue");
	assert.equal(result.steps[0]?.toolResults[0]?.content, "echo: hi");
	assert.equal(result.steps[0]?.toolResults[0]?.isError, false);
	assert.equal(result.steps[1]?.control, "stop");

	// Usage accounting: tokens summed across both calls, CNY cost from the side-channel.
	assert.equal(result.usage.stepsUsed, 2);
	assert.equal(result.usage.tokenIn, 35);
	assert.equal(result.usage.tokenOut, 15);
	assert.equal(result.usage.totalTokens, 50);
	assert.equal(result.usage.estimatedCostCny, "0.03");
});

test("truncation: a max_tokens turn with a string tool_use.input fails the batch without executing it", async () => {
	const executed: string[] = [];
	const echoSpec: AnyToolSpec = {
		id: "echo",
		description: "Echo the message back.",
		schema: z.object({ message: z.string() }),
		sideEffect: "none",
		execute: (input: { message: string }) => {
			executed.push(input.message);
			return okToolResult(`echo: ${input.message}`);
		},
	};
	const registry = createToolRegistry([echoSpec]);
	const tools = await workhubToolsToPi(registry, { workdir: "/tmp/wd" });

	const { client } = scriptedClient([
		{
			id: "m1",
			// A stream truncated by the output token limit leaves tool_use.input a
			// degenerate partial-JSON string; stopReason is max_tokens.
			content: [{ type: "tool_use", id: "call-1", name: "echo", input: '{"message":"hi' }],
			usage: { inputTokens: 8, outputTokens: 4 },
			stopReason: "max_tokens",
		},
		{
			id: "m2",
			content: [{ type: "text", text: "recovered" }],
			usage: { inputTokens: 6, outputTokens: 2 },
			stopReason: "end_turn",
		},
	]);

	const streamFn = createProviderStreamFn({ client });
	const context: AgentContext = { systemPrompt: "worker", messages: [], tools };
	const messages = await runAgentLoop([userMsg("go")], context, config({}), () => {}, undefined, streamFn);

	assert.deepEqual(executed, [], "the truncated tool call was never executed");
	const result = toAgentLoopResult({ messages });
	assert.equal(result.status, "succeeded");
	assert.equal(result.finalText, "recovered");
	// Step 1 carried the tool_use (mapped to stopReason length) and one error tool result.
	assert.equal(result.steps[0]?.stopReason, "max_tokens");
	assert.equal(result.steps[0]?.toolResults.length, 1);
	assert.equal(result.steps[0]?.toolResults[0]?.isError, true);
	assert.match(result.steps[0]?.toolResults[0]?.content ?? "", /output token limit/i);
});
