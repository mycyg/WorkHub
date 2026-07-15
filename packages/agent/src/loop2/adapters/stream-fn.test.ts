import assert from "node:assert/strict";
import test from "node:test";

import type { LlmCreateParams, LlmCreateResponse, LlmStream, LlmStreamEvent } from "../../providers/types.js";
import type { AssistantMessage, AssistantMessageEvent, Context, Model } from "../index.js";
import { type AssistantMessageEventStream } from "../index.js";
import {
	type ProviderStreamClient,
	attachWorkhubUsage,
	createProviderStreamFn,
	readWorkhubUsage,
	toPiStopReason,
} from "./stream-fn.js";

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
		contextWindow: 1000,
		maxTokens: 4096,
	};
}

function ctx(overrides: Partial<Context> = {}): Context {
	return { systemPrompt: "sys", messages: [{ role: "user", content: "hi", timestamp: 1 }], ...overrides };
}

async function drive(stream: AssistantMessageEventStream): Promise<{ events: AssistantMessageEvent[]; final: AssistantMessage }> {
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) events.push(event);
	const final = await stream.result();
	return { events, final };
}

// --- stopReason normalization (every value) -------------------------------

test("toPiStopReason maps every WorkHub value", () => {
	assert.equal(toPiStopReason("end_turn", false), "stop");
	assert.equal(toPiStopReason("max_tokens", false), "length");
	assert.equal(toPiStopReason("tool_use", true), "toolUse");
	assert.equal(toPiStopReason(undefined, true), "toolUse", "absent + tool calls → toolUse");
	assert.equal(toPiStopReason(undefined, false), "stop", "absent + no tool calls → stop");
	assert.equal(toPiStopReason("stop_sequence", false), "stop", "unknown → stop");
	assert.equal(toPiStopReason("stop_sequence", true), "toolUse", "unknown + tool calls → toolUse");
});

// --- buffered (create-only) path ------------------------------------------

test("buffered path: create response becomes a terminal done message with cost side-channel", async () => {
	let seenParams: LlmCreateParams | undefined;
	const client: ProviderStreamClient = {
		messages: {
			create: async (params) => {
				seenParams = params;
				return {
					id: "msg-1",
					content: [{ type: "text", text: "answer" }],
					usage: { inputTokens: 10, outputTokens: 4 },
					usageRecord: {
						provider: "deepseek",
						model: "deepseek-x",
						task: "worker",
						inputTokens: 10,
						outputTokens: 4,
						estimatedCostCny: "0.0123",
						source: "agent_step",
						createdAt: new Date().toISOString(),
					},
					stopReason: "end_turn",
				} satisfies LlmCreateResponse;
			},
		},
	};

	const streamFn = createProviderStreamFn({ client, source: "agent_step" });
	const { events, final } = await drive(streamFn(model(), ctx(), {}) as AssistantMessageEventStream);

	assert.deepEqual(events.map((e) => e.type), ["start", "done"]);
	assert.equal(final.stopReason, "stop");
	assert.deepEqual(final.content, [{ type: "text", text: "answer" }]);
	assert.equal(final.usage.input, 10);
	assert.equal(final.usage.output, 4);
	assert.equal(final.usage.totalTokens, 14);
	assert.equal(final.provider, "deepseek");
	assert.equal(final.responseId, "msg-1");

	// Cost lives on the side-channel keyed by the final message object.
	const cost = readWorkhubUsage(final);
	assert.equal(cost?.estimatedCostCny, "0.0123");
	assert.equal(cost?.inputTokens, 10);

	// The request carried the system prompt and a per-call seq.
	assert.equal(seenParams?.system, "sys");
	assert.equal(seenParams?.seq, 1);
	assert.equal(seenParams?.source, "agent_step");
});

test("buffered path: absent stopReason with tool_use content maps to toolUse", async () => {
	const client: ProviderStreamClient = {
		messages: {
			create: async () => ({
				id: "m",
				content: [{ type: "tool_use", id: "call-1", name: "echo", input: { a: 1 } }],
				usage: { inputTokens: 1, outputTokens: 1 },
			}),
		},
	};
	const { final } = await drive(createProviderStreamFn({ client })(model(), ctx(), {}) as AssistantMessageEventStream);
	assert.equal(final.stopReason, "toolUse");
	assert.equal(final.content[0]?.type, "toolCall");
});

// --- streaming path -------------------------------------------------------

function fakeLlmStream(events: LlmStreamEvent[], final: LlmCreateResponse, onFinal: () => void): LlmStream {
	return {
		async *[Symbol.asyncIterator]() {
			for (const event of events) yield event;
		},
		getFinalMessage: async () => {
			onFinal();
			return final;
		},
	};
}

test("streaming path: maps SSE increments to pi delta events and records usage via getFinalMessage", async () => {
	let finalCalled = false;
	const sse: LlmStreamEvent[] = [
		{ type: "message_start", data: { type: "message_start", message: { id: "m", usage: { input_tokens: 5, output_tokens: 0 } } } },
		{ type: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
		{ type: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } } },
		{ type: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } } },
		{ type: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
		{ type: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } } },
	];
	const final: LlmCreateResponse = {
		id: "m",
		content: [{ type: "text", text: "Hello" }],
		usage: { inputTokens: 5, outputTokens: 2 },
		usageRecord: {
			provider: "deepseek",
			model: "deepseek-x",
			task: "worker",
			inputTokens: 5,
			outputTokens: 2,
			estimatedCostCny: "0.005",
			source: "agent_step",
			createdAt: new Date().toISOString(),
		},
		stopReason: "end_turn",
	};
	const client: ProviderStreamClient = {
		messages: {
			create: async () => {
				throw new Error("should not use create when stream is available");
			},
			stream: async () => fakeLlmStream(sse, final, () => {
				finalCalled = true;
			}),
		},
	};

	const { events, final: message } = await drive(createProviderStreamFn({ client })(model(), ctx(), {}) as AssistantMessageEventStream);

	assert.ok(finalCalled, "getFinalMessage() was called (usage recording happens there)");
	const types = events.map((e) => e.type);
	assert.equal(types[0], "start");
	assert.equal(types.at(-1), "done");
	assert.ok(types.includes("text_start"), "emitted text_start");
	assert.ok(types.includes("text_delta"), "emitted text_delta");
	assert.ok(types.includes("text_end"), "emitted text_end");
	assert.deepEqual(message.content, [{ type: "text", text: "Hello" }]);
	assert.equal(message.stopReason, "stop");
	assert.equal(readWorkhubUsage(message)?.estimatedCostCny, "0.005");
});

test("streaming path is skipped when streaming: false, falling back to create", async () => {
	let usedStream = false;
	const client: ProviderStreamClient = {
		messages: {
			create: async () => ({ id: "m", content: [{ type: "text", text: "buffered" }], usage: { inputTokens: 1, outputTokens: 1 } }),
			stream: async () => {
				usedStream = true;
				return fakeLlmStream([], { id: "m", content: [], usage: { inputTokens: 0, outputTokens: 0 } }, () => {});
			},
		},
	};
	const { final } = await drive(createProviderStreamFn({ client, streaming: false })(model(), ctx(), {}) as AssistantMessageEventStream);
	assert.equal(usedStream, false);
	assert.deepEqual(final.content, [{ type: "text", text: "buffered" }]);
});

// --- error / abort path ---------------------------------------------------

test("provider failure is encoded as an error event, never thrown", async () => {
	const client: ProviderStreamClient = {
		messages: {
			create: async () => {
				throw new Error("boom 500");
			},
		},
	};
	const { events, final } = await drive(createProviderStreamFn({ client })(model(), ctx(), {}) as AssistantMessageEventStream);
	assert.equal(events.at(-1)?.type, "error");
	assert.equal(final.stopReason, "error");
	assert.match(final.errorMessage ?? "", /boom 500/);
});

test("an aborted request produces an aborted stopReason", async () => {
	const controller = new AbortController();
	controller.abort();
	const client: ProviderStreamClient = {
		messages: {
			create: async () => {
				throw new Error("request aborted");
			},
		},
	};
	const { final } = await drive(
		createProviderStreamFn({ client })(model(), ctx(), { signal: controller.signal }) as AssistantMessageEventStream,
	);
	assert.equal(final.stopReason, "aborted");
});

// --- side-channel isolation ----------------------------------------------

test("attach/readWorkhubUsage do not mutate the message object", () => {
	const msg = { role: "assistant" as const };
	attachWorkhubUsage(msg, { inputTokens: 3, outputTokens: 1, estimatedCostCny: "0.001" });
	assert.equal(readWorkhubUsage(msg)?.estimatedCostCny, "0.001");
	assert.deepEqual(Object.keys(msg), ["role"], "no extra keys added to the message");
});
