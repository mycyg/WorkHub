/**
 * loop2 Phase 1 — Adapter 4: result adapter.
 *
 * Folds a loop2 terminal transcript (`AgentMessage[]`, as returned by
 * `runAgentLoop` / carried on the `agent_end` event) plus the usage attached to
 * each assistant message by the streamFn adapter into a WorkHub `AgentLoopResult`,
 * so the existing downstream — `evaluation/confidence.ts` and the agent-runner —
 * consumes an unchanged shape.
 *
 * Field-source table (what each `AgentLoopResult` field is derived from):
 *
 *  | field         | source                                                            |
 *  |---------------|-------------------------------------------------------------------|
 *  | status        | last assistant `stopReason` (aborted→cancelled, error→failed,     |
 *  |               |   else succeeded) — OR the caller's override (budget escalation / |
 *  |               |   missing-deliverable are L3/config decisions, not loop-core ones) |
 *  | usage         | summed per assistant turn: tokenIn/out from pi `Usage.input/output`|
 *  |               |   (totalTokens = in+out, matching `loop/loop.ts`); estimatedCostCny|
 *  |               |   summed from the streamFn usage side-channel (WeakMap)           |
 *  | steps         | one step per assistant turn + the tool-result messages that follow |
 *  |               |   it; ToolResult reconstructed losslessly from the stashed detail |
 *  |               |   (falls back to content text + isError); control via the shared  |
 *  |               |   `controlFromAssistant`; snapshotId from the tool results        |
 *  | control       | override, else `controlFromAssistant` of the last turn            |
 *  | reason        | override, else first meaningful line of finalText                 |
 *  | finalText     | override, else text/thinking of the last assistant turn          |
 *  | handoff       | passthrough (loop-core does not synthesize one)                  |
 *  | manifest      | passthrough — built by the L3 layer from workdir outputs, never  |
 *  |               |   fabricated here                                                |
 *  | review        | passthrough — the L3 llm_review call, never fabricated here       |
 *  | reviewFailed  | passthrough                                                       |
 *
 * `steps` is a reasonable approximation (timestamps come from message
 * timestamps); `status`/`usage` and the manifest-related passthroughs carry
 * accurate semantics.
 */

import type { DeliverableChangeManifest } from "@workhub/contracts";
import type { ToolResult } from "@workhub/tools";

import { controlFromAssistant } from "../../loop/control.js";
import type {
	AgentAssistantBlock,
	AgentLoopControlSignal,
	AgentLoopResult,
	AgentLoopStep,
	AgentLoopUsage,
	AgentRunReview,
	AgentRunTerminalStatus,
	StructuredHandoff,
} from "../../loop/types.js";
import type { AgentMessage, AssistantMessage, StopReason, TextContent, ThinkingContent, ToolCall } from "../index.js";
import { readWorkhubUsage } from "./stream-fn.js";
import { extractWorkhubToolResult } from "./tools.js";

// --- CNY math (replicated from loop/loop.ts to keep identical formatting) ---

function parseCny(value: string | undefined): number {
	const parsed = Number.parseFloat(value ?? "0");
	return Number.isFinite(parsed) ? parsed : 0;
}

function formatCny(value: number): string {
	return value.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "") || "0";
}

// --- content / stopReason mapping -----------------------------------------

/** pi assistant content blocks → WorkHub `AgentAssistantBlock[]`. */
export function piAssistantContentToBlocks(content: (TextContent | ThinkingContent | ToolCall)[]): AgentAssistantBlock[] {
	return content.map((block): AgentAssistantBlock => {
		if (block.type === "text") return { type: "text", text: block.text };
		if (block.type === "thinking") return { type: "thinking", text: block.thinking };
		return { type: "tool_use", id: block.id, name: block.name, input: block.arguments };
	});
}

/** pi `StopReason` → WorkHub stop reason string (inverse of the streamFn map). */
export function toWorkhubStopReason(stopReason: StopReason | undefined): string | undefined {
	switch (stopReason) {
		case "stop":
			return "end_turn";
		case "length":
			return "max_tokens";
		case "toolUse":
			return "tool_use";
		case "error":
		case "aborted":
			return stopReason;
		default:
			return undefined;
	}
}

function toolResultFromMessage(message: Extract<AgentMessage, { role: "toolResult" }>): ToolResult {
	const stashed = extractWorkhubToolResult(message.details);
	if (stashed) return stashed;
	const text = message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	return { ok: !message.isError, content: text, isError: message.isError };
}

// --- step reconstruction --------------------------------------------------

function reconstructSteps(messages: AgentMessage[]): AgentLoopStep[] {
	const steps: AgentLoopStep[] = [];
	let index = 0;

	for (let i = 0; i < messages.length; i += 1) {
		const message = messages[i];
		if (!message || message.role !== "assistant") continue;
		index += 1;

		const blocks = piAssistantContentToBlocks(message.content);
		const toolCalls = blocks.filter((block): block is Extract<AgentAssistantBlock, { type: "tool_use" }> => block.type === "tool_use");

		const toolResults: ToolResult[] = [];
		let endedAtMs = message.timestamp;
		for (let j = i + 1; j < messages.length; j += 1) {
			const next = messages[j];
			if (!next || next.role !== "toolResult") break;
			toolResults.push(toolResultFromMessage(next));
			endedAtMs = next.timestamp;
		}

		const stopReason = toWorkhubStopReason(message.stopReason);
		const step: AgentLoopStep = {
			index,
			assistant: blocks,
			toolCalls,
			toolResults,
			control: controlFromAssistant(blocks, stopReason),
			startedAt: new Date(message.timestamp).toISOString(),
			endedAt: new Date(endedAtMs).toISOString(),
		};
		if (stopReason) step.stopReason = stopReason;
		const snapshotId = toolResults.find((result) => result.snapshotId)?.snapshotId;
		if (snapshotId) step.snapshotId = snapshotId;
		steps.push(step);
	}

	return steps;
}

// --- usage / text helpers -------------------------------------------------

function lastAssistant(messages: AgentMessage[]): AssistantMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message && message.role === "assistant") return message;
	}
	return undefined;
}

function textFromBlocks(blocks: AgentAssistantBlock[]): string {
	return blocks
		.filter((block): block is Extract<AgentAssistantBlock, { type: "text" | "thinking" }> => block.type === "text" || block.type === "thinking")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

function firstMeaningfulLine(finalText: string): string {
	const line = finalText
		.split(/\r?\n/u)
		.map((value) => value.trim())
		.find((value) => value.length > 0);
	return (line ?? "AgentRun completed").slice(0, 256);
}

/** Accumulate WorkHub usage from the assistant messages' token counts + cost side-channel. */
export function collectUsage(messages: AgentMessage[], secondsUsed = 0): AgentLoopUsage {
	let tokenIn = 0;
	let tokenOut = 0;
	let steps = 0;
	let cost = 0;
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		steps += 1;
		tokenIn += message.usage.input;
		tokenOut += message.usage.output;
		cost += parseCny(readWorkhubUsage(message)?.estimatedCostCny);
	}
	return {
		stepsUsed: steps,
		secondsUsed,
		tokenIn,
		tokenOut,
		totalTokens: tokenIn + tokenOut,
		estimatedCostCny: formatCny(cost),
	};
}

function deriveStatus(last: AssistantMessage | undefined): AgentRunTerminalStatus {
	if (!last) return "failed";
	if (last.stopReason === "aborted") return "cancelled";
	if (last.stopReason === "error") return "failed";
	return "succeeded";
}

// --- public entry point ---------------------------------------------------

export type ResultAdapterInput = {
	/** loop2 terminal transcript (runAgentLoop return / agent_end.messages). */
	messages: AgentMessage[];
	/** Wall-clock seconds for the run (used for usage.secondsUsed). */
	secondsUsed?: number;
	/** Pre-accumulated usage; when omitted it is computed from the transcript. */
	usage?: AgentLoopUsage;
	/** Terminal status override (budget escalation / missing deliverable — L3 decisions). */
	status?: AgentRunTerminalStatus;
	/** Control-signal override (e.g. "escalate"). */
	control?: AgentLoopControlSignal;
	/** Human reason override. */
	reason?: string;
	/** Final text override. */
	finalText?: string;
	/** L3-supplied passthroughs (never fabricated by the loop core). */
	handoff?: StructuredHandoff;
	manifest?: DeliverableChangeManifest;
	review?: AgentRunReview;
	reviewFailed?: boolean;
};

/** Convert a loop2 terminal transcript into a WorkHub `AgentLoopResult`. */
export function toAgentLoopResult(input: ResultAdapterInput): AgentLoopResult {
	const { messages } = input;
	const steps = reconstructSteps(messages);
	const last = lastAssistant(messages);
	const lastBlocks = last ? piAssistantContentToBlocks(last.content) : [];

	const usage = input.usage ?? collectUsage(messages, input.secondsUsed ?? 0);
	const status = input.status ?? deriveStatus(last);
	const finalText = input.finalText ?? textFromBlocks(lastBlocks);
	const control = input.control ?? controlFromAssistant(lastBlocks, toWorkhubStopReason(last?.stopReason));
	const reason = input.reason ?? (finalText ? firstMeaningfulLine(finalText) : "AgentRun completed");

	const result: AgentLoopResult = {
		status,
		reason,
		control,
		usage,
		steps,
	};
	if (finalText) result.finalText = finalText;
	if (input.handoff) result.handoff = input.handoff;
	if (input.manifest) result.manifest = input.manifest;
	if (input.review) result.review = input.review;
	if (input.reviewFailed) result.reviewFailed = true;
	return result;
}
