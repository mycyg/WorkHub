/**
 * loop2 Phase 2 — double-run equivalence.
 *
 * For each scenario the same deterministic scripted client + tools drive BOTH the
 * production loop (`AgentLoop.run`) and loop2 (`runAgentLoop2`), and we assert the
 * loop-core projection is identical (status / control / reason / finalText / usage
 * tokens+cost / step count / per-step control+stopReason / tool sequence+inputs) plus
 * the usage-record accounting sequence (seq + source + tokens each provider call).
 *
 * L3 (manifest / llm_review / confidence) is deliberately out of the loop-core
 * projection — every scenario runs with requireDeliverable:false + reviewDeliverable:
 * false to isolate the engine. Allowed differences are documented in ALLOWED_DIFFS.
 *
 * ALLOWED DIFFERENCES (validated to NOT affect loop-core, hence excluded from the
 * projection):
 *   1. usage.secondsUsed — wall clock; excluded from projectLoopCore.
 *   2. step timestamps (startedAt/endedAt) — loop.ts uses per-turn now(); loop2 uses
 *      message reconstruction time. Excluded (only step COUNT + control + tool order
 *      are compared).
 *   3. manifest / review / reviewFailed / handoff details — L3, excluded.
 *   4. emitted event stream granularity — loop.ts emits per-step agentRunStep /
 *      stepToolResult / stream_event; loop2 defers those to an AgentEvent subscriber
 *      (Phase 3). Only load-bearing lifecycle events (started/compacting/escalated)
 *      are emitted by loop2, asserted where relevant.
 *   5. compaction pruned-message shape — loop.ts compacts LlmMessage[]; loop2 compacts
 *      pi AgentMessage[]. With a scripted client this never changes model output, so
 *      loop-core stays identical; the outbound request payloads differ (not asserted).
 *   6. dynamic tool visibility — loop.ts re-resolves tools per turn; loop2 resolves
 *      once. Equivalent for static tool sets (all scenarios here).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { errorToolResult, okToolResult, type ToolExecutionContext, type ToolResult } from "@workhub/tools";

import { createAgentLoop } from "../loop/index.js";
import type { AgentLoopBudget, AgentLoopInput, AgentLoopResult } from "../loop/types.js";
import type { LlmCreateParams, LlmCreateResponse } from "../providers/types.js";
import { assertLoopCoreEquivalent, loopCoreDiffs, runAgentLoop2 } from "./config-builder.js";

// --- scenario harness ------------------------------------------------------

type CapturedCall = {
	seq: number | undefined;
	source: string | undefined;
	inputTokens: number;
	outputTokens: number;
	estimatedCostCny: string | undefined;
};

type ToolSpec = { name: string; description: string; input_schema: unknown };

type Scenario = {
	responses: LlmCreateResponse[];
	toolSpecs?: ToolSpec[];
	execute?: (toolId: string, input: unknown, ctx: ToolExecutionContext) => ToolResult;
	budget?: Partial<AgentLoopBudget>;
};

type Harness = {
	input: AgentLoopInput;
	calls: CapturedCall[];
	requests: LlmCreateParams[];
	compactionEvents: number;
	escalatedEvents: number;
};

const DEFAULT_BUDGET: AgentLoopBudget = {
	maxSteps: 15,
	totalTimeoutSeconds: 300,
	maxTokens: 1_000_000,
	maxCostCny: "0", // <=0 means "cost dimension unlimited" (checkLoopBudget)
	contextWindowTokens: 100_000,
};

function makeHarness(scenario: Scenario): Harness {
	const calls: CapturedCall[] = [];
	const requests: LlmCreateParams[] = [];
	const queue = [...scenario.responses];
	const harness: Harness = { input: undefined as never, calls, requests, compactionEvents: 0, escalatedEvents: 0 };

	const input: AgentLoopInput = {
		runId: "run-eqv",
		workItemId: "wi-eqv",
		workdir: "/tmp/loop2-eqv",
		systemPrompt: "you are a worker",
		initialUserMessage: "please do the task",
		client: {
			model: "deepseek-x",
			provider: "deepseek",
			messages: {
				create: async (params: LlmCreateParams) => {
					requests.push(params);
					const next = queue.shift();
					if (!next) throw new Error("scenario: no scripted response left");
					calls.push({
						seq: params.seq,
						source: params.source,
						inputTokens: next.usage?.inputTokens ?? 0,
						outputTokens: next.usage?.outputTokens ?? 0,
						estimatedCostCny: next.usageRecord?.estimatedCostCny,
					});
					return next;
				},
			},
		},
		tools: {
			toModelTools: () => scenario.toolSpecs ?? [],
			execute: (toolId, toolInput, ctx) =>
				scenario.execute ? scenario.execute(toolId, toolInput, ctx) : okToolResult(`ran ${toolId}`),
		},
		budget: { ...DEFAULT_BUDGET, ...scenario.budget },
		// Isolate loop-core: no deliverable gate, no manifest, no llm_review.
		requireDeliverable: false,
		reviewDeliverable: false,
		emit: (event) => {
			if (event.type === "agent_run.compacting") harness.compactionEvents += 1;
			if (event.type === "agent_run.escalated") harness.escalatedEvents += 1;
		},
	};
	harness.input = input;
	return harness;
}

/** Run the scenario through both engines and assert loop-core + usage-record equivalence. */
async function runBoth(scenario: Scenario): Promise<{ legacy: AgentLoopResult; loop2: AgentLoopResult; legacyH: Harness; loop2H: Harness }> {
	const legacyH = makeHarness(scenario);
	const loop2H = makeHarness(scenario);
	const legacy = await createAgentLoop().run(legacyH.input);
	const loop2 = await runAgentLoop2(loop2H.input);

	assert.deepEqual(
		loopCoreDiffs(legacy, loop2),
		[],
		`loop-core diverged:\n${loopCoreDiffs(legacy, loop2).join("\n")}`,
	);
	assertLoopCoreEquivalent(legacy, loop2);
	// usage-record accounting: same (seq, source, tokens, cost) sequence the usageSink would see.
	assert.deepEqual(loop2H.calls, legacyH.calls, "usage-record accounting sequence diverged");
	return { legacy, loop2, legacyH, loop2H };
}

// --- fixtures --------------------------------------------------------------

const ECHO_TOOL: ToolSpec = {
	name: "echo",
	description: "Echo the message back.",
	input_schema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
};
const FAIL_TOOL: ToolSpec = {
	name: "boom",
	description: "Always fails.",
	input_schema: { type: "object", properties: {} },
};

function usageRecord(estimatedCostCny: string, inputTokens: number, outputTokens: number) {
	return {
		provider: "deepseek",
		model: "deepseek-x",
		task: "worker" as const,
		inputTokens,
		outputTokens,
		estimatedCostCny,
		source: "agent_step" as const,
		createdAt: "2026-07-15T00:00:00.000Z",
	};
}

function textResponse(id: string, text: string, inTok = 5, outTok = 5, cost = "0.01"): LlmCreateResponse {
	return {
		id,
		content: [{ type: "text", text }],
		usage: { inputTokens: inTok, outputTokens: outTok },
		usageRecord: usageRecord(cost, inTok, outTok),
		stopReason: "end_turn",
	};
}

function toolResponse(id: string, calls: { id: string; name: string; input: unknown }[], inTok = 10, outTok = 10, cost = "0.02"): LlmCreateResponse {
	return {
		id,
		content: calls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: call.input })),
		usage: { inputTokens: inTok, outputTokens: outTok },
		usageRecord: usageRecord(cost, inTok, outTok),
		stopReason: "tool_use",
	};
}

// --- scenarios -------------------------------------------------------------

test("equivalence: pure text completion", async () => {
	const { legacy, loop2 } = await runBoth({ responses: [textResponse("m1", "done")] });
	assert.equal(legacy.status, "succeeded");
	assert.equal(loop2.status, "succeeded");
	assert.equal(loop2.finalText, "done");
	assert.equal(loop2.steps.length, 1);
});

test("equivalence: single tool then completion", async () => {
	const executed: string[] = [];
	const { loop2 } = await runBoth({
		responses: [
			toolResponse("m1", [{ id: "c1", name: "echo", input: { message: "hi" } }]),
			textResponse("m2", "all done"),
		],
		toolSpecs: [ECHO_TOOL],
		execute: (_id, input) => {
			executed.push((input as { message: string }).message);
			return okToolResult(`echo: ${(input as { message: string }).message}`);
		},
	});
	assert.equal(loop2.steps.length, 2);
	assert.equal(loop2.steps[0]?.toolResults[0]?.content, "echo: hi");
	assert.equal(loop2.status, "succeeded");
});

test("equivalence: multiple tools, sequential order within and across turns", async () => {
	const { loop2 } = await runBoth({
		responses: [
			toolResponse("m1", [
				{ id: "c1", name: "echo", input: { message: "a" } },
				{ id: "c2", name: "echo", input: { message: "b" } },
			]),
			toolResponse("m2", [{ id: "c3", name: "echo", input: { message: "c" } }]),
			textResponse("m3", "done"),
		],
		toolSpecs: [ECHO_TOOL],
		execute: (_id, input) => okToolResult(`echo: ${(input as { message: string }).message}`),
	});
	assert.equal(loop2.steps.length, 3);
	const toolSeq = loop2.steps.flatMap((step) => step.toolCalls.map((call) => call.name));
	assert.deepEqual(toolSeq, ["echo", "echo", "echo"]);
});

test("equivalence: tool error propagates isError", async () => {
	const { legacy, loop2 } = await runBoth({
		responses: [
			toolResponse("m1", [{ id: "c1", name: "boom", input: {} }]),
			textResponse("m2", "recovered from error"),
		],
		toolSpecs: [FAIL_TOOL],
		execute: () => errorToolResult("kaboom"),
	});
	assert.equal(legacy.steps[0]?.toolResults[0]?.isError, true);
	assert.equal(loop2.steps[0]?.toolResults[0]?.isError, true);
	assert.equal(loop2.status, "succeeded");
});

test("equivalence: max_tokens truncated tool batch — sanitized resend + error tool_result", async () => {
	const executed: string[] = [];
	const { legacy, loop2, loop2H } = await runBoth({
		responses: [
			{
				id: "m1",
				// A stream cut off by max_tokens leaves tool_use.input a degenerate partial-JSON string.
				content: [{ type: "tool_use", id: "c1", name: "echo", input: '{"message":"hi' }],
				usage: { inputTokens: 8, outputTokens: 4 },
				usageRecord: usageRecord("0.01", 8, 4),
				stopReason: "max_tokens",
			},
			textResponse("m2", "recovered"),
		],
		toolSpecs: [ECHO_TOOL],
		execute: (_id, input) => {
			executed.push(String((input as { message?: string }).message));
			return okToolResult("should not run");
		},
	});
	// Neither engine executed the truncated call; both surfaced an error tool_result.
	assert.deepEqual(executed, [], "truncated tool call must not execute");
	assert.equal(legacy.steps[0]?.toolResults[0]?.isError, true);
	assert.equal(loop2.steps[0]?.toolResults[0]?.isError, true);
	assert.equal(loop2.status, "succeeded");
	assert.equal(loop2.finalText, "recovered");

	// loop2's SECOND provider request must carry the assistant tool_use with input sanitized to
	// an OBJECT ({}), not the truncated string — echoing the string to a real provider 400s.
	const secondRequest = loop2H.requests[1];
	assert.ok(secondRequest, "loop2 made a second provider request");
	const assistantMsg = secondRequest.messages.find((m) => m.role === "assistant");
	assert.ok(assistantMsg && Array.isArray(assistantMsg.content), "second request has the assistant echo");
	const toolUse = (assistantMsg.content as Record<string, unknown>[]).find((b) => b.type === "tool_use");
	assert.ok(toolUse, "assistant echo carries the tool_use");
	assert.equal(typeof toolUse.input, "object", "tool_use.input sanitized to an object");
	assert.deepEqual(toolUse.input, {}, "truncated string input replaced with {}");
	// Paired error tool_result is present (tool_use/tool_result invariant preserved).
	const userMsg = secondRequest.messages.find(
		(m) => m.role === "user" && Array.isArray(m.content) && (m.content as Record<string, unknown>[]).some((b) => b.type === "tool_result"),
	);
	assert.ok(userMsg, "the error tool_result was echoed back");
});

test("equivalence: budget stop escalates with handoff (maxSteps=1)", async () => {
	const { legacy, loop2 } = await runBoth({
		responses: [toolResponse("m1", [{ id: "c1", name: "echo", input: { message: "x" } }])],
		toolSpecs: [ECHO_TOOL],
		execute: () => okToolResult("ok"),
		budget: { maxSteps: 1 },
	});
	assert.equal(legacy.status, "escalated");
	assert.equal(loop2.status, "escalated");
	assert.equal(loop2.control, "escalate");
	assert.equal(loop2.reason, legacy.reason);
	// handoff is L3 but both engines synthesize it from buildStructuredHandoff — assert parity.
	assert.equal(loop2.handoff?.budgetHit, "steps");
	assert.equal(legacy.handoff?.budgetHit, "steps");
});

test("equivalence: context-window compaction triggers on both engines", async () => {
	// contextWindow 100 * 0.8 = 80 token threshold; two 60-token turns cross it before turn 3.
	const { legacy, loop2, legacyH, loop2H } = await runBoth({
		responses: [
			toolResponse("m1", [{ id: "c1", name: "echo", input: { message: "a" } }], 30, 30, "0.03"),
			toolResponse("m2", [{ id: "c2", name: "echo", input: { message: "b" } }], 30, 30, "0.03"),
			textResponse("m3", "finished", 5, 5, "0.01"),
		],
		toolSpecs: [ECHO_TOOL],
		execute: () => okToolResult("ok"),
		budget: { contextWindowTokens: 100, compactThreshold: 0.8, maxCompactions: 2 },
	});
	assert.equal(legacy.status, "succeeded");
	assert.equal(loop2.status, "succeeded");
	assert.equal(loop2.steps.length, 3);
	// Both engines emitted at least one compaction event (the trigger fired on both).
	assert.ok(legacyH.compactionEvents >= 1, "legacy compacted");
	assert.ok(loop2H.compactionEvents >= 1, "loop2 compacted");
});
