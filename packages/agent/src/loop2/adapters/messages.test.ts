import assert from "node:assert/strict";
import test from "node:test";

import type { LlmMessage } from "../../providers/types.js";
import type { Message, ToolResultMessage } from "../index.js";
import {
	piAssistantContentToWorkhub,
	piMessagesToWorkhub,
	workhubAssistantContentToPi,
	workhubMessagesToPi,
} from "./messages.js";

// --- assistant content mapping -------------------------------------------

test("workhubAssistantContentToPi maps text / thinking / tool_use", () => {
	const blocks = workhubAssistantContentToPi([
		{ type: "text", text: "hi" },
		{ type: "thinking", thinking: "hmm", signature: "sig" },
		{ type: "tool_use", id: "call-1", name: "echo", input: { x: 1 } },
	]);
	assert.deepEqual(blocks, [
		{ type: "text", text: "hi" },
		{ type: "thinking", thinking: "hmm", thinkingSignature: "sig" },
		{ type: "toolCall", id: "call-1", name: "echo", arguments: { x: 1 } },
	]);
});

test("workhubAssistantContentToPi maps a bare string to one text block", () => {
	assert.deepEqual(workhubAssistantContentToPi("hello"), [{ type: "text", text: "hello" }]);
	assert.deepEqual(workhubAssistantContentToPi(""), []);
});

test("workhubAssistantContentToPi passes a truncated string tool_use.input through verbatim", () => {
	const blocks = workhubAssistantContentToPi([{ type: "tool_use", id: "c1", name: "write", input: '{"path":"a.txt","cont' }]);
	assert.equal(blocks.length, 1);
	const call = blocks[0];
	assert.equal(call?.type, "toolCall");
	// The degenerate partial-JSON string survives — the pi loop's length path fails it.
	assert.equal((call as { arguments: unknown }).arguments, '{"path":"a.txt","cont');
});

test("piAssistantContentToWorkhub is the inverse for the common block types", () => {
	const wire = piAssistantContentToWorkhub([
		{ type: "text", text: "hi" },
		{ type: "toolCall", id: "c1", name: "echo", arguments: { a: 1 } },
	]);
	assert.deepEqual(wire, [
		{ type: "text", text: "hi" },
		{ type: "tool_use", id: "c1", name: "echo", input: { a: 1 } },
	]);
});

// --- user messages --------------------------------------------------------

test("workhubMessagesToPi maps a string user message to a pi UserMessage", () => {
	const out = workhubMessagesToPi([{ role: "user", content: "do the thing" }]);
	assert.equal(out.length, 1);
	assert.equal(out[0]?.role, "user");
	assert.equal((out[0] as { content: unknown }).content, "do the thing");
});

test("piMessagesToWorkhub keeps a string user content as a string", () => {
	const wire = piMessagesToWorkhub([{ role: "user", content: "hi", timestamp: 1 }]);
	assert.deepEqual(wire, [{ role: "user", content: "hi" }]);
});

// --- tool_result pairing --------------------------------------------------

test("workhubMessagesToPi resolves tool_result toolName from the preceding assistant tool_use", () => {
	const messages: LlmMessage[] = [
		{ role: "user", content: "go" },
		{ role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "search", input: { q: "x" } }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "found it", is_error: false }] },
	];
	const out = workhubMessagesToPi(messages);
	const toolResult = out.find((m): m is ToolResultMessage => m.role === "toolResult");
	assert.ok(toolResult, "a ToolResultMessage was produced");
	assert.equal(toolResult.toolCallId, "call-1");
	assert.equal(toolResult.toolName, "search", "toolName resolved from the tool_use id→name map");
	assert.equal(toolResult.isError, false);
	assert.deepEqual(toolResult.content, [{ type: "text", text: "found it" }]);
});

test("workhubMessagesToPi splits a user turn that interleaves tool_result and text", () => {
	const messages: LlmMessage[] = [
		{ role: "assistant", content: [{ type: "tool_use", id: "c1", name: "run", input: {} }] },
		{
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: "c1", content: "ok", is_error: true },
				{ type: "text", text: "also please continue" },
			],
		},
	];
	const out = workhubMessagesToPi(messages);
	const roles = out.map((m) => m.role);
	assert.deepEqual(roles, ["assistant", "toolResult", "user"]);
	const tr = out[1] as ToolResultMessage;
	assert.equal(tr.isError, true);
	assert.equal((out[2] as { content: unknown }).content instanceof Array, true);
});

test("piMessagesToWorkhub collapses consecutive ToolResultMessages into one user turn", () => {
	const messages: Message[] = [
		{ role: "toolResult", toolCallId: "c1", toolName: "a", content: [{ type: "text", text: "r1" }], isError: false, timestamp: 1 },
		{ role: "toolResult", toolCallId: "c2", toolName: "b", content: [{ type: "text", text: "r2" }], isError: true, timestamp: 2 },
	];
	const wire = piMessagesToWorkhub(messages);
	assert.equal(wire.length, 1, "both tool results collapse into a single user message");
	assert.equal(wire[0]?.role, "user");
	assert.deepEqual(wire[0]?.content, [
		{ type: "tool_result", tool_use_id: "c1", content: "r1", is_error: false },
		{ type: "tool_result", tool_use_id: "c2", content: "r2", is_error: true },
	]);
});

// --- round trip -----------------------------------------------------------

test("assistant + tool_result round-trips WorkHub → pi → WorkHub", () => {
	const original: LlmMessage[] = [
		{ role: "user", content: "start" },
		{ role: "assistant", content: [{ type: "text", text: "calling" }, { type: "tool_use", id: "c1", name: "echo", input: { v: 2 } }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "done", is_error: false }] },
		{ role: "assistant", content: [{ type: "text", text: "finished" }] },
	];
	const round = piMessagesToWorkhub(workhubMessagesToPi(original));
	assert.deepEqual(round, original);
});

test("image content round-trips through user messages", () => {
	const original: LlmMessage[] = [
		{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] },
	];
	const round = piMessagesToWorkhub(workhubMessagesToPi(original));
	assert.deepEqual(round, original);
});
