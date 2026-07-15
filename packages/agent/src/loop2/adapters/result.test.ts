import assert from "node:assert/strict";
import test from "node:test";

import type { ToolResult } from "@workhub/tools";

import type { AgentMessage, AssistantMessage, ToolResultMessage, Usage } from "../index.js";
import { collectUsage, piAssistantContentToBlocks, toAgentLoopResult, toWorkhubStopReason } from "./result.js";
import { attachWorkhubUsage } from "./stream-fn.js";

function usage(input: number, output: number): Usage {
	return { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function assistant(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
	tokens: Usage = usage(0, 0),
	timestamp = 1,
): AssistantMessage {
	return { role: "assistant", content, api: "a", provider: "p", model: "m", usage: tokens, stopReason, timestamp };
}

function toolResultMessage(toolCallId: string, whResult: ToolResult, timestamp = 2): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "echo",
		content: [{ type: "text", text: whResult.content }],
		details: whResult,
		isError: whResult.isError,
		timestamp,
	};
}

function userMsg(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: 0 };
}

// --- stopReason inverse ---------------------------------------------------

test("toWorkhubStopReason inverts the streamFn mapping", () => {
	assert.equal(toWorkhubStopReason("stop"), "end_turn");
	assert.equal(toWorkhubStopReason("length"), "max_tokens");
	assert.equal(toWorkhubStopReason("toolUse"), "tool_use");
	assert.equal(toWorkhubStopReason("error"), "error");
	assert.equal(toWorkhubStopReason("aborted"), "aborted");
	assert.equal(toWorkhubStopReason(undefined), undefined);
});

// --- content mapping ------------------------------------------------------

test("piAssistantContentToBlocks maps pi content to WorkHub blocks", () => {
	const blocks = piAssistantContentToBlocks([
		{ type: "text", text: "hi" },
		{ type: "thinking", thinking: "hmm" },
		{ type: "toolCall", id: "c1", name: "echo", arguments: { x: 1 } },
	]);
	assert.deepEqual(blocks, [
		{ type: "text", text: "hi" },
		{ type: "thinking", text: "hmm" },
		{ type: "tool_use", id: "c1", name: "echo", input: { x: 1 } },
	]);
});

// --- step reconstruction --------------------------------------------------

test("reconstructs steps: one assistant turn + its following tool results, losslessly", () => {
	const messages: AgentMessage[] = [
		userMsg("go"),
		assistant([{ type: "text", text: "calling" }, { type: "toolCall", id: "c1", name: "echo", arguments: { a: 1 } }], "toolUse", usage(10, 5), 100),
		toolResultMessage("c1", { ok: true, content: "done", isError: false, snapshotId: "snap-1" }, 150),
		assistant([{ type: "text", text: "all finished" }], "stop", usage(3, 2), 200),
	];

	const result = toAgentLoopResult({ messages });

	assert.equal(result.steps.length, 2, "two assistant turns → two steps");
	const [step1, step2] = result.steps;
	assert.equal(step1?.index, 1);
	assert.equal(step1?.toolCalls.length, 1);
	assert.equal(step1?.control, "continue", "a tool_use turn continues");
	assert.equal(step1?.stopReason, "tool_use");
	assert.equal(step1?.toolResults.length, 1);
	assert.equal(step1?.toolResults[0]?.snapshotId, "snap-1", "snapshotId recovered from the stashed ToolResult");
	assert.equal(step1?.snapshotId, "snap-1", "step-level snapshotId picked up");
	assert.equal(step2?.control, "stop", "a plain-text end_turn turn stops");
	assert.equal(result.finalText, "all finished");
});

test("falls back to content text when a tool result has no stashed WorkHub result", () => {
	const bare: ToolResultMessage = {
		role: "toolResult",
		toolCallId: "c1",
		toolName: "x",
		content: [{ type: "text", text: "loop-made error" }],
		isError: true,
		timestamp: 2,
	};
	const messages: AgentMessage[] = [
		assistant([{ type: "toolCall", id: "c1", name: "x", arguments: {} }], "toolUse"),
		bare,
		assistant([{ type: "text", text: "ok" }], "stop"),
	];
	const result = toAgentLoopResult({ messages });
	assert.equal(result.steps[0]?.toolResults[0]?.isError, true);
	assert.equal(result.steps[0]?.toolResults[0]?.content, "loop-made error");
});

// --- status derivation ----------------------------------------------------

test("status derives from the terminal assistant stopReason", () => {
	assert.equal(toAgentLoopResult({ messages: [assistant([{ type: "text", text: "x" }], "stop")] }).status, "succeeded");
	assert.equal(toAgentLoopResult({ messages: [assistant([], "error")] }).status, "failed");
	assert.equal(toAgentLoopResult({ messages: [assistant([], "aborted")] }).status, "cancelled");
	assert.equal(toAgentLoopResult({ messages: [] }).status, "failed", "no assistant turn → failed");
});

test("status/control/reason/handoff can be overridden by the L3 layer (budget escalation)", () => {
	const messages: AgentMessage[] = [assistant([{ type: "text", text: "partial" }], "stop")];
	const result = toAgentLoopResult({
		messages,
		status: "escalated",
		control: "escalate",
		reason: "步数预算已耗尽",
		handoff: { done: [], remaining: [], nextSteps: [], blockers: [], artifacts: [], budgetHit: "steps" },
	});
	assert.equal(result.status, "escalated");
	assert.equal(result.control, "escalate");
	assert.equal(result.reason, "步数预算已耗尽");
	assert.equal(result.handoff?.budgetHit, "steps");
});

// --- usage accumulation ---------------------------------------------------

test("collectUsage sums tokens per turn and CNY cost from the side-channel", () => {
	const a1 = assistant([{ type: "text", text: "1" }], "toolUse", usage(10, 5));
	const a2 = assistant([{ type: "text", text: "2" }], "stop", usage(20, 8));
	attachWorkhubUsage(a1, { inputTokens: 10, outputTokens: 5, estimatedCostCny: "0.010000" });
	attachWorkhubUsage(a2, { inputTokens: 20, outputTokens: 8, estimatedCostCny: "0.020000" });

	const acc = collectUsage([userMsg("go"), a1, a2], 12.5);
	assert.equal(acc.stepsUsed, 2);
	assert.equal(acc.tokenIn, 30);
	assert.equal(acc.tokenOut, 13);
	assert.equal(acc.totalTokens, 43);
	assert.equal(acc.estimatedCostCny, "0.03", "cost summed and formatted like loop/loop.ts");
	assert.equal(acc.secondsUsed, 12.5);
});

test("toAgentLoopResult computes usage from the transcript when none is supplied", () => {
	const a1 = assistant([{ type: "text", text: "done" }], "stop", usage(7, 3));
	attachWorkhubUsage(a1, { inputTokens: 7, outputTokens: 3, estimatedCostCny: "0.007" });
	const result = toAgentLoopResult({ messages: [a1] });
	assert.equal(result.usage.totalTokens, 10);
	assert.equal(result.usage.estimatedCostCny, "0.007");
});

// --- passthroughs ---------------------------------------------------------

test("review / reviewFailed / manifest passthroughs are preserved for confidence.ts", () => {
	const messages: AgentMessage[] = [assistant([{ type: "text", text: "delivered" }], "stop")];
	const withReview = toAgentLoopResult({ messages, review: { source: "llm_review", grade: 5, rationale: "great", model: "m" } });
	assert.equal(withReview.review?.grade, 5);
	assert.equal(withReview.reviewFailed, undefined);

	const failed = toAgentLoopResult({ messages, reviewFailed: true });
	assert.equal(failed.reviewFailed, true);
});
