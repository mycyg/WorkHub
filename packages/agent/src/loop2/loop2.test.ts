import assert from "node:assert/strict";
import test from "node:test";

import {
	type AgentContext,
	type AgentEvent,
	agentLoop,
	type AgentLoopConfig,
	type AgentMessage,
	type AgentTool,
	type AgentToolResult,
	AssistantMessageEventStream,
	type AssistantMessage,
	type Message,
	type Model,
	runAgentLoop,
	setToolArgumentValidator,
	type StreamFn,
	type TextContent,
	type ToolCall,
	type ToolResultMessage,
} from "./index.js";

// --- builders -------------------------------------------------------------

function zeroUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function testModel(): Model {
	return {
		id: "test-model",
		name: "Test Model",
		api: "test-api",
		provider: "test-provider",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 1000,
	};
}

function text(value: string): TextContent {
	return { type: "text", text: value };
}

function toolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
	return { type: "toolCall", id, name, arguments: args };
}

function userMsg(value: string): Message {
	return { role: "user", content: value, timestamp: Date.now() };
}

function assistant(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "test-api",
		provider: "test-provider",
		model: "test-model",
		usage: zeroUsage(),
		stopReason,
		timestamp: Date.now(),
	};
}

function toolResult(textValue: string): AgentToolResult<Record<string, never>> {
	return { content: [text(textValue)], details: {} };
}

function makeTool(
	name: string,
	execute: AgentTool["execute"],
	overrides: Partial<AgentTool> = {},
): AgentTool {
	return {
		name,
		description: `${name} tool`,
		parameters: { type: "object", properties: {} },
		label: name,
		execute,
		...overrides,
	};
}

function ctx(tools?: AgentTool[]): AgentContext {
	return { systemPrompt: "you are a test agent", messages: [], tools };
}

function baseConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
	return {
		model: testModel(),
		// identity: AgentMessage is Message in the vendor closure (no custom messages).
		convertToLlm: (messages) => messages as Message[],
		...overrides,
	};
}

/**
 * In-memory streamFn: replays a scripted queue of assistant messages, one per
 * model call. Records the Context of each call so tests can assert what the loop
 * fed the model (e.g. injected steering/follow-up messages).
 */
function scriptedStreamFn(responses: AssistantMessage[]): { streamFn: StreamFn; calls: Message[][] } {
	const queue = [...responses];
	// One transcript snapshot per model call. Snapshot (not the live reference) because
	// the loop mutates `context.messages` in place across turns.
	const calls: Message[][] = [];
	const streamFn: StreamFn = (_model, context) => {
		calls.push([...context.messages]);
		const next = queue.shift();
		if (!next) {
			throw new Error("scriptedStreamFn: no scripted response left for this call");
		}
		const stream = new AssistantMessageEventStream();
		stream.push({ type: "start", partial: next });
		if (next.stopReason === "error" || next.stopReason === "aborted") {
			stream.push({ type: "error", reason: next.stopReason, error: next });
		} else {
			stream.push({ type: "done", reason: next.stopReason as "stop" | "length" | "toolUse", message: next });
		}
		return stream;
	};
	return { streamFn, calls };
}

async function collectRun(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	streamFn: StreamFn,
): Promise<{ events: AgentEvent[]; messages: AgentMessage[] }> {
	const events: AgentEvent[] = [];
	const messages = await runAgentLoop(prompts, context, config, (event) => {
		events.push(event);
	}, undefined, streamFn);
	return { events, messages };
}

function eventTypes(events: AgentEvent[]): string[] {
	return events.map((e) => e.type);
}

function toolResultMessages(messages: AgentMessage[]): ToolResultMessage[] {
	return messages.filter((m): m is ToolResultMessage => m.role === "toolResult");
}

// --- (a) basic turn -------------------------------------------------------

test("(a) basic turn: assistant text, no tools, stop — full ordered event sequence", async () => {
	const { streamFn, calls } = scriptedStreamFn([assistant([text("hello")], "stop")]);
	const { events, messages } = await collectRun([userMsg("hi")], ctx(), baseConfig(), streamFn);

	assert.deepEqual(eventTypes(events), [
		"agent_start",
		"turn_start",
		"message_start", // prompt (user)
		"message_end",
		"message_start", // assistant
		"message_end",
		"turn_end",
		"agent_end",
	]);
	assert.equal(calls.length, 1);
	assert.equal(messages.length, 2);
	assert.equal(messages[0]?.role, "user");
	assert.equal(messages[1]?.role, "assistant");

	const end = events.at(-1);
	assert.equal(end?.type, "agent_end");
	if (end?.type === "agent_end") {
		assert.equal(end.messages.length, 2);
	}
});

test("(a) agentLoop EventStream entry point yields the same events and final messages", async () => {
	const { streamFn } = scriptedStreamFn([assistant([text("hi there")], "stop")]);
	const stream = agentLoop([userMsg("hi")], ctx(), baseConfig(), undefined, streamFn);

	const seen: string[] = [];
	for await (const event of stream) {
		seen.push(event.type);
	}
	const finalMessages = await stream.result();

	assert.deepEqual(seen, [
		"agent_start",
		"turn_start",
		"message_start",
		"message_end",
		"message_start",
		"message_end",
		"turn_end",
		"agent_end",
	]);
	assert.equal(finalMessages.length, 2);
});

// --- (b) tool loop --------------------------------------------------------

test("(b) tool loop: tool_use → execute → tool_result → next turn", async () => {
	const executed: string[] = [];
	const tool = makeTool("echo", async (id) => {
		executed.push(id);
		return toolResult("echoed");
	});
	const { streamFn, calls } = scriptedStreamFn([
		assistant([toolCall("call-1", "echo", { x: 1 })], "toolUse"),
		assistant([text("done")], "stop"),
	]);

	const { events, messages } = await collectRun([userMsg("run echo")], ctx([tool]), baseConfig(), streamFn);

	assert.deepEqual(executed, ["call-1"], "the tool executed exactly once");
	assert.equal(calls.length, 2, "the model was called again after the tool result");
	assert.deepEqual(eventTypes(events), [
		"agent_start",
		"turn_start",
		"message_start", // prompt
		"message_end",
		"message_start", // assistant #1 (tool call)
		"message_end",
		"tool_execution_start",
		"tool_execution_end",
		"message_start", // tool result
		"message_end",
		"turn_end", // end of turn 1
		"turn_start", // turn 2
		"message_start", // assistant #2 (text)
		"message_end",
		"turn_end",
		"agent_end",
	]);

	const results = toolResultMessages(messages);
	assert.equal(results.length, 1);
	assert.equal(results[0]?.toolCallId, "call-1");
	assert.equal(results[0]?.isError, false);
});

// --- (c) steering ---------------------------------------------------------

test("(c) steering: getSteeringMessages injects into the next model call", async () => {
	let steeringPolls = 0;
	const config = baseConfig({
		getSteeringMessages: async () => {
			steeringPolls += 1;
			// Inject only on the poll right after turn 1 (poll #2).
			return steeringPolls === 2 ? [userMsg("actually, focus on X")] : [];
		},
	});
	const { streamFn, calls } = scriptedStreamFn([
		assistant([text("working")], "stop"),
		assistant([text("focusing on X")], "stop"),
	]);

	const { events } = await collectRun([userMsg("start")], ctx(), config, streamFn);

	assert.equal(calls.length, 2, "steering continued the run into a second model call");
	// The steering message is present in the transcript fed to the 2nd model call,
	// but was absent from the 1st.
	const firstCallHasSteer = calls[0]?.some(
		(m) => m.role === "user" && m.content === "actually, focus on X",
	);
	const secondCallHasSteer = calls[1]?.some(
		(m) => m.role === "user" && m.content === "actually, focus on X",
	);
	assert.equal(firstCallHasSteer, false);
	assert.equal(secondCallHasSteer, true);

	// The injected message is emitted (start/end) before the 2nd assistant streams.
	const idxSteerStart = events.findIndex(
		(e) => e.type === "message_start" && e.message.role === "user" && e.message.content === "actually, focus on X",
	);
	assert.ok(idxSteerStart > 0, "steering message was emitted");
});

// --- (d) follow-up --------------------------------------------------------

test("(d) follow-up: getFollowUpMessages resumes a run that would otherwise stop", async () => {
	let followUpPolls = 0;
	const config = baseConfig({
		getFollowUpMessages: async () => {
			followUpPolls += 1;
			return followUpPolls === 1 ? [userMsg("one more thing")] : [];
		},
	});
	const { streamFn, calls } = scriptedStreamFn([
		assistant([text("all done")], "stop"),
		assistant([text("handling the follow-up")], "stop"),
	]);

	const { events } = await collectRun([userMsg("do work")], ctx(), config, streamFn);

	assert.equal(calls.length, 2, "the follow-up drove a second model call");
	const secondCallHasFollowUp = calls[1]?.some(
		(m) => m.role === "user" && m.content === "one more thing",
	);
	assert.equal(secondCallHasFollowUp, true);
	// Exactly two follow-up polls: one that injected, one that ended the run.
	assert.equal(followUpPolls, 2);
	assert.equal(eventTypes(events).filter((t) => t === "turn_start").length, 2);
});

// --- (e) truncated batch --------------------------------------------------

test("(e) truncation: stopReason=length fails every tool call without executing them", async () => {
	const executed: string[] = [];
	const tool = makeTool("echo", async (id) => {
		executed.push(id);
		return toolResult("should not run");
	});
	const { streamFn } = scriptedStreamFn([
		assistant(
			[toolCall("call-1", "echo", { a: 1 }), toolCall("call-2", "echo", { b: 2 })],
			"length",
		),
		assistant([text("recovered")], "stop"),
	]);

	const { events, messages } = await collectRun([userMsg("go")], ctx([tool]), baseConfig(), streamFn);

	assert.deepEqual(executed, [], "no tool executed on a truncated batch");
	const results = toolResultMessages(messages);
	assert.equal(results.length, 2, "one error result per truncated tool call");
	for (const result of results) {
		assert.equal(result.isError, true);
		const body = result.content.map((c) => (c.type === "text" ? c.text : "")).join(" ");
		assert.match(body, /output token limit/i);
	}
	// Every tool_execution_end for the batch reported an error.
	const toolEnds = events.filter((e) => e.type === "tool_execution_end");
	assert.equal(toolEnds.length, 2);
	assert.ok(toolEnds.every((e) => e.type === "tool_execution_end" && e.isError === true));
});

// --- (f) parallel tools ---------------------------------------------------

test("(f) parallel tools: result messages are backfilled in source order (deterministic)", async () => {
	// slow (call-1) finishes AFTER fast (call-2); tool_execution_end fires in
	// completion order, but the tool-result messages must follow source order.
	const slow = makeTool("slow", async () => {
		await new Promise((resolve) => setTimeout(resolve, 15));
		return toolResult("slow-result");
	});
	const fast = makeTool("fast", async () => toolResult("fast-result"));

	const { streamFn } = scriptedStreamFn([
		assistant(
			[toolCall("call-1", "slow", {}), toolCall("call-2", "fast", {})],
			"toolUse",
		),
		assistant([text("both done")], "stop"),
	]);

	const { events, messages } = await collectRun([userMsg("go")], ctx([slow, fast]), baseConfig(), streamFn);

	// Completion order: fast (call-2) ended before slow (call-1).
	const endOrder = events
		.filter((e) => e.type === "tool_execution_end")
		.map((e) => (e.type === "tool_execution_end" ? e.toolCallId : ""));
	assert.deepEqual(endOrder, ["call-2", "call-1"], "tools completed out of source order");

	// Source order: the tool-result messages appear call-1 then call-2 regardless.
	const results = toolResultMessages(messages);
	assert.deepEqual(
		results.map((r) => r.toolCallId),
		["call-1", "call-2"],
		"tool-result messages are backfilled in source order",
	);
});

// --- (g) beforeToolCall / afterToolCall hooks -----------------------------

test("(g) beforeToolCall block: blocked tool never executes and yields an error result", async () => {
	const executed: string[] = [];
	const tool = makeTool("danger", async (id) => {
		executed.push(id);
		return toolResult("ran");
	});
	const config = baseConfig({
		beforeToolCall: async ({ toolCall: tc }) => {
			return tc.name === "danger" ? { block: true, reason: "blocked by policy" } : undefined;
		},
	});
	const { streamFn } = scriptedStreamFn([
		assistant([toolCall("call-1", "danger", {})], "toolUse"),
		assistant([text("understood")], "stop"),
	]);

	const { messages } = await collectRun([userMsg("go")], ctx([tool]), config, streamFn);

	assert.deepEqual(executed, [], "blocked tool did not execute");
	const results = toolResultMessages(messages);
	assert.equal(results.length, 1);
	assert.equal(results[0]?.isError, true);
	const body = results[0]?.content.map((c) => (c.type === "text" ? c.text : "")).join(" ");
	assert.equal(body, "blocked by policy");
});

test("(g) afterToolCall rewrite: overrides the executed tool result content", async () => {
	const tool = makeTool("echo", async () => toolResult("original"));
	const config = baseConfig({
		afterToolCall: async () => ({ content: [text("rewritten")], isError: false }),
	});
	const { streamFn } = scriptedStreamFn([
		assistant([toolCall("call-1", "echo", {})], "toolUse"),
		assistant([text("ok")], "stop"),
	]);

	const { messages } = await collectRun([userMsg("go")], ctx([tool]), config, streamFn);

	const results = toolResultMessages(messages);
	assert.equal(results.length, 1);
	const body = results[0]?.content.map((c) => (c.type === "text" ? c.text : "")).join(" ");
	assert.equal(body, "rewritten");
});

test("(g) afterToolCall terminate: a fully-terminating batch stops the loop after one turn", async () => {
	const tool = makeTool("finish", async () => toolResult("done"));
	const config = baseConfig({
		afterToolCall: async () => ({ terminate: true }),
	});
	// Only one scripted response: if the loop tried a second model call it would throw.
	const { streamFn, calls } = scriptedStreamFn([assistant([toolCall("call-1", "finish", {})], "toolUse")]);

	const { events } = await collectRun([userMsg("go")], ctx([tool]), config, streamFn);

	assert.equal(calls.length, 1, "terminate short-circuits the loop before another model call");
	assert.equal(eventTypes(events).at(-1), "agent_end");
});

// --- validation seam ------------------------------------------------------

test("injectable validator: a throwing validator surfaces as an immediate error result", async (t) => {
	t.after(() => setToolArgumentValidator(null));
	setToolArgumentValidator(() => {
		throw new Error("schema mismatch: missing field 'q'");
	});

	const executed: string[] = [];
	const tool = makeTool("search", async (id) => {
		executed.push(id);
		return toolResult("results");
	});
	const { streamFn } = scriptedStreamFn([
		assistant([toolCall("call-1", "search", {})], "toolUse"),
		assistant([text("noted")], "stop"),
	]);

	const { messages } = await collectRun([userMsg("go")], ctx([tool]), baseConfig(), streamFn);

	assert.deepEqual(executed, [], "invalid arguments never reach the tool");
	const results = toolResultMessages(messages);
	assert.equal(results.length, 1);
	assert.equal(results[0]?.isError, true);
	const body = results[0]?.content.map((c) => (c.type === "text" ? c.text : "")).join(" ");
	assert.match(body, /schema mismatch/);
});

// --- error stop branch ----------------------------------------------------

test("error stopReason halts the loop after emitting turn_end and agent_end", async () => {
	const errored = assistant([text("boom")], "error");
	errored.errorMessage = "provider exploded";
	// A second response is scripted but must never be requested.
	const { streamFn, calls } = scriptedStreamFn([errored, assistant([text("unreached")], "stop")]);

	const { events } = await collectRun([userMsg("go")], ctx(), baseConfig(), streamFn);

	assert.equal(calls.length, 1, "the loop stopped after the errored turn");
	assert.deepEqual(eventTypes(events), [
		"agent_start",
		"turn_start",
		"message_start", // prompt
		"message_end",
		"message_start", // assistant (error)
		"message_end",
		"turn_end",
		"agent_end",
	]);
	const turnEnd = events.find((e) => e.type === "turn_end");
	assert.ok(turnEnd && turnEnd.type === "turn_end" && turnEnd.toolResults.length === 0);
});
