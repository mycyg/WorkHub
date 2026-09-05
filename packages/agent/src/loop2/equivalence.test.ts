/**
 * loop2 Phase 3 — double-run equivalence.
 *
 * For each scenario the same deterministic scripted client + tools drive BOTH the
 * production loop (`AgentLoop.run`) and loop2 (`runAgentLoop2`), and we assert:
 *   - the loop-core projection is identical (status / control / reason / finalText /
 *     usage tokens+cost / step count / per-step control+stopReason / tool seq+inputs);
 *   - the usage-record accounting sequence (seq + source + tokens each provider call);
 *   - (P3a) the emitted per-step EVENT sequence is identical (type + key data fields);
 *   - the recorder call sequence (recordUsage/recordStep order + values) is identical.
 *
 * L3 (manifest / llm_review / confidence) is deliberately out of the loop-core
 * projection — every scenario runs with requireDeliverable:false + reviewDeliverable:
 * false to isolate the engine. Allowed differences are documented in ALLOWED_DIFFS.
 *
 * ALLOWED DIFFERENCES after Phase 3 (validated to NOT affect loop-core or the emitted
 * event sequence, hence excluded from the projections) — only wall-clock, timestamps,
 * and L3 detail remain:
 *   1. WALL CLOCK — usage.secondsUsed; and, under REAL streaming only (never the
 *      buffered deterministic client here), the stream_event throttle boundaries
 *      (which deltas land) and heartbeat count. Excluded from both projections.
 *   2. TIMESTAMPS — step startedAt/endedAt (loop.ts per-turn now() vs loop2 message
 *      reconstruction time), and the compaction tail's message `timestamp` fields
 *      (Date.now() stamped by the pi↔wire converters). The compaction summary TEXT is
 *      identical (both engines share tryGenerateStructuredSummary +
 *      summarizeStepsForCompaction); the pruned tail converts to semantically equal
 *      wire messages differing only by these timestamps. Neither is asserted.
 *   3. L3 DETAIL — manifest / review / reviewFailed content and handoff body (built by
 *      the L3 layer from workdir outputs, never fabricated in loop-core). The event
 *      projection compares scalar data fields, not the handoff object.
 *
 * (Removed in Phase 3: event-stream granularity — P3a now emits the full per-step
 * agentRunStep/stepToolResult/stepSnapshot/stream_event trace via the AgentEvent sink;
 * structured-summary deferral — P3b ports it; dynamic tool visibility — P3c re-resolves
 * tools every turn via prepareNextTurn.)
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { errorToolResult, okToolResult, type ToolExecutionContext, type ToolResult } from "@workhub/tools";

import { createAgentLoop } from "../loop/index.js";
import type { AgentLoopBudget, AgentLoopInput, AgentLoopResult } from "../loop/types.js";
import type { LlmCreateParams, LlmCreateResponse, LlmMessage } from "../providers/types.js";
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

type EmittedEvent = { type: string; previewText?: string | undefined; data: Record<string, unknown> };

/** Recorder call capture: recordUsage → usage snapshot; recordStep → step index. */
type RecorderEntry = { kind: "usage"; totalTokens: number; stepsUsed: number } | { kind: "step"; index: number };

/** A scripted provider FAILURE: the harness client throws this value instead of returning. */
type ScriptedThrow = { scriptedError: unknown };

type ScriptedResponse = LlmCreateResponse | ScriptedThrow;

function isScriptedThrow(value: ScriptedResponse): value is ScriptedThrow {
	return "scriptedError" in value;
}

type Scenario = {
	responses: ScriptedResponse[];
	toolSpecs?: ToolSpec[];
	/** Dynamic tool set (P3c): overrides `toolSpecs` and is re-invoked each turn. */
	toModelTools?: () => ToolSpec[];
	execute?: (toolId: string, input: unknown, ctx: ToolExecutionContext) => ToolResult;
	budget?: Partial<AgentLoopBudget>;
	/** Scripted compaction-summary responses (P3b): wires a compactionClient when present. */
	compactionResponses?: LlmCreateResponse[];
	/** Run workdir (B10 spill writes under `<workdir>/.spill/`); defaults to a fixed path. */
	workdir?: string;
};

type Harness = {
	input: AgentLoopInput;
	calls: CapturedCall[];
	requests: LlmCreateParams[];
	/**
	 * Per-call DEEP COPY of the wire messages. `requests` cannot serve this for the legacy engine:
	 * loop.ts passes its single live `messages` array to every call, so every captured params object
	 * points at the same (final) array. A snapshot per call is what lets a test compare the two
	 * engines' full model-visible transcripts turn by turn.
	 */
	requestMessages: LlmMessage[][];
	compactionEvents: number;
	escalatedEvents: number;
	/** Every WorkHub event emitted, in order (P3a event-sequence equivalence). */
	emittedEvents: EmittedEvent[];
	/** Recorder calls in order (recordUsage/recordStep timing alignment). */
	recorderLog: RecorderEntry[];
	/** Provider requests the compactionClient saw (P3b). */
	compactionRequests: LlmCreateParams[];
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
	const requestMessages: LlmMessage[][] = [];
	const emittedEvents: EmittedEvent[] = [];
	const recorderLog: RecorderEntry[] = [];
	const compactionRequests: LlmCreateParams[] = [];
	const queue = [...scenario.responses];
	const compactionQueue = [...(scenario.compactionResponses ?? [])];
	const harness: Harness = {
		input: undefined as never,
		calls,
		requests,
		requestMessages,
		compactionEvents: 0,
		escalatedEvents: 0,
		emittedEvents,
		recorderLog,
		compactionRequests,
	};

	const input: AgentLoopInput = {
		runId: "run-eqv",
		workItemId: "wi-eqv",
		workdir: scenario.workdir ?? "/tmp/loop2-eqv",
		systemPrompt: "you are a worker",
		initialUserMessage: "please do the task",
		client: {
			model: "deepseek-x",
			provider: "deepseek",
			messages: {
				create: async (params: LlmCreateParams) => {
					requests.push(params);
					requestMessages.push(JSON.parse(JSON.stringify(params.messages)) as LlmMessage[]);
					const next = queue.shift();
					if (!next) throw new Error("scenario: no scripted response left");
					// A scripted failure: throw without recording usage (a real failed request records
					// nothing — the throw precedes any usage read, same as loop.ts / the measured client).
					if (isScriptedThrow(next)) throw next.scriptedError;
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
			toModelTools: () => (scenario.toModelTools ? scenario.toModelTools() : scenario.toolSpecs ?? []),
			execute: (toolId, toolInput, ctx) =>
				scenario.execute ? scenario.execute(toolId, toolInput, ctx) : okToolResult(`ran ${toolId}`),
		},
		budget: { ...DEFAULT_BUDGET, ...scenario.budget },
		// Isolate loop-core: no deliverable gate, no manifest, no llm_review.
		requireDeliverable: false,
		reviewDeliverable: false,
		recorder: {
			recordStep: (step) => {
				recorderLog.push({ kind: "step", index: step.index });
			},
			recordUsage: (usage) => {
				recorderLog.push({ kind: "usage", totalTokens: usage.totalTokens, stepsUsed: usage.stepsUsed });
			},
		},
		emit: (event) => {
			emittedEvents.push({ type: event.type, previewText: event.previewText, data: event.data });
			if (event.type === "agent_run.compacting") harness.compactionEvents += 1;
			if (event.type === "agent_run.escalated") harness.escalatedEvents += 1;
		},
	};
	if (scenario.compactionResponses) {
		input.compactionClient = {
			model: "deepseek-compact",
			provider: "deepseek",
			messages: {
				create: async (params: LlmCreateParams) => {
					compactionRequests.push(params);
					const next = compactionQueue.shift();
					if (!next) throw new Error("scenario: no scripted compaction response left");
					return next;
				},
			},
		};
	}
	harness.input = input;
	return harness;
}

// Event-sequence projection (P3a): compare event TYPE + stable scalar data fields only. Excludes
// previewText (content-preview, e.g. the truncated tool_result error text differs by language) and
// object fields (budget / handoff — L3) and timestamps.
const EVENT_DATA_KEYS = [
	"step_no",
	"kind",
	"tool_id",
	"input_preview",
	"ok",
	"is_error",
	"control",
	"snapshot_id",
	"trigger",
	"compactions",
	"summary_kind",
	// B10: the free-pruning path emits summary_kind "pruned" plus what it freed.
	"pruned_results",
	"pruned_chars",
	// 剪后上下文规模：两侧投影口径一旦漂移，这一项立刻不等。
	"context_chars",
	"provider_event_type",
	// provider_retry fields (delay_ms is deterministic: nextRetryDecision has no jitter).
	"attempt",
	"retry_reason",
	"delay_ms",
	// B6 观测面: agent_run.reminded facts (tier/repeats/shape/tool ids are deterministic per engine).
	"tier",
	"repeats",
	"shape",
	"tool_ids",
] as const;

function projectEvents(events: EmittedEvent[]): Record<string, unknown>[] {
	return events.map((event) => {
		const picked: Record<string, unknown> = { type: event.type };
		for (const key of EVENT_DATA_KEYS) {
			if (event.data && key in event.data) picked[key] = event.data[key];
		}
		return picked;
	});
}

/**
 * Run the scenario through both engines and assert loop-core + usage-record + emitted-event +
 * recorder equivalence. Accepts a Scenario, or a factory `() => Scenario` for stateful scenarios
 * (dynamic tools / compaction) that need independent closure state per engine run.
 */
async function runBoth(
	scenarioOrFactory: Scenario | (() => Scenario),
): Promise<{ legacy: AgentLoopResult; loop2: AgentLoopResult; legacyH: Harness; loop2H: Harness }> {
	const make = typeof scenarioOrFactory === "function" ? scenarioOrFactory : () => scenarioOrFactory;
	const legacyH = makeHarness(make());
	const loop2H = makeHarness(make());
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
	// P3a: the per-step emitted event sequence is identical (type + key data fields).
	assert.deepEqual(
		projectEvents(loop2H.emittedEvents),
		projectEvents(legacyH.emittedEvents),
		"emitted event sequence diverged",
	);
	// Recorder call sequence (recordUsage/recordStep order + values) is identical.
	assert.deepEqual(loop2H.recorderLog, legacyH.recorderLog, "recorder call sequence diverged");
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
const LOAD_SKILL_TOOL: ToolSpec = {
	name: "load_skill",
	description: "Mount a skill's tools for the rest of the run.",
	input_schema: { type: "object", properties: { skill: { type: "string" } }, required: ["skill"] },
};
const PDF_TOOL: ToolSpec = {
	name: "pdf",
	description: "Render a PDF (mounted by load_skill).",
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

/** A scripted structured-summary response returned by the compactionClient stub (P3b). */
function compactionSummaryResponse(summary: string, inTok = 12, outTok = 20, cost = "0.05"): LlmCreateResponse {
	return {
		id: "compact-1",
		content: [{ type: "text", text: summary }],
		usage: { inputTokens: inTok, outputTokens: outTok },
		usageRecord: { ...usageRecord(cost, inTok, outTok), source: "compact" },
		stopReason: "end_turn",
	};
}

/** Project a compaction request to its meaningful fields (excludes the per-engine AbortSignal). */
function projectCompactionRequest(params: LlmCreateParams): Record<string, unknown> {
	return { system: params.system, messages: params.messages, maxTokens: params.maxTokens, source: params.source };
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

// --- (P3b) structured compaction summary via compactionClient --------------

test("equivalence: structured compaction summary — injected compactionClient", async () => {
	// Same context-window trigger as above, but with a compactionClient that returns a fixed structured
	// summary. Both engines must: make the identical compaction request, fold the summary usage in the
	// same order, and report summary_kind="structured".
	const summary = "## 目标（Goal）\n完成 echo 任务\n\n## 进度（Progress）\n### 已完成（Done）\n- [x] 调用了 echo";
	const scenario: Scenario = {
		responses: [
			toolResponse("m1", [{ id: "c1", name: "echo", input: { message: "a" } }], 30, 30, "0.03"),
			toolResponse("m2", [{ id: "c2", name: "echo", input: { message: "b" } }], 30, 30, "0.03"),
			textResponse("m3", "finished", 5, 5, "0.01"),
		],
		toolSpecs: [ECHO_TOOL],
		execute: () => okToolResult("ok"),
		budget: { contextWindowTokens: 100, compactThreshold: 0.8, maxCompactions: 2 },
		compactionResponses: [compactionSummaryResponse(summary)],
	};
	const { legacy, loop2, legacyH, loop2H } = await runBoth(scenario);

	assert.equal(legacy.status, "succeeded");
	assert.equal(loop2.status, "succeeded");
	// Exactly one compaction-summary call each, with an identical request shape (source="compact").
	assert.equal(legacyH.compactionRequests.length, 1, "legacy made one compaction call");
	assert.equal(loop2H.compactionRequests.length, 1, "loop2 made one compaction call");
	assert.equal(loop2H.compactionRequests[0]?.source, "compact");
	assert.deepEqual(
		projectCompactionRequest(loop2H.compactionRequests[0]!),
		projectCompactionRequest(legacyH.compactionRequests[0]!),
		"compaction request diverged",
	);
	// summary_kind="structured" on both compacting events (runBoth already asserted the event sequence).
	const legacyKind = legacyH.emittedEvents.find((e) => e.type === "agent_run.compacting")?.data.summary_kind;
	const loop2Kind = loop2H.emittedEvents.find((e) => e.type === "agent_run.compacting")?.data.summary_kind;
	assert.equal(legacyKind, "structured");
	assert.equal(loop2Kind, "structured");
	// The fixed summary text landed in the post-compaction worker request (turn 3, first message).
	const req3First = loop2H.requests[2]?.messages[0];
	const body = typeof req3First?.content === "string" ? req3First.content : JSON.stringify(req3First?.content);
	assert.match(body, /完成 echo 任务/, "structured summary injected into the compacted transcript");
	// The compaction usage (12+20 tokens, ¥0.05) is folded into the final total on both (loop-core equal).
	assert.equal(loop2.usage.estimatedCostCny, legacy.usage.estimatedCostCny);
	assert.ok(Number(loop2.usage.estimatedCostCny) > 0.1, "worker (0.07) + compaction (0.05) cost folded in");
	assert.equal(loop2.usage.totalTokens, legacy.usage.totalTokens);
});

// --- (P3c) dynamic tool visibility -----------------------------------------

test("equivalence: dynamic tool visibility — load_skill mounts a tool mid-run", async () => {
	// A load_skill call in turn 1 mounts the pdf tool; turn 2's request must expose it — on BOTH engines.
	// Factory: fresh `skillLoaded` state per engine run (runBoth builds two independent harnesses).
	const scenario = (): Scenario => {
		let skillLoaded = false;
		return {
			responses: [
				toolResponse("m1", [{ id: "c1", name: "load_skill", input: { skill: "pdf" } }]),
				textResponse("m2", "done"),
			],
			toModelTools: () => (skillLoaded ? [LOAD_SKILL_TOOL, PDF_TOOL] : [LOAD_SKILL_TOOL]),
			execute: (toolId) => {
				if (toolId === "load_skill") skillLoaded = true;
				return okToolResult(`ran ${toolId}`);
			},
		};
	};
	const { loop2, legacyH, loop2H } = await runBoth(scenario);

	assert.equal(loop2.status, "succeeded");
	const toolNames = (req: LlmCreateParams | undefined): string[] =>
		(req?.tools ?? []).map((tool) => (tool as { name: string }).name).sort();
	// Turn 1 saw only load_skill; turn 2's request reflects the mounted pdf tool — both engines identical.
	assert.deepEqual(toolNames(legacyH.requests[0]), ["load_skill"], "legacy turn-1 tools");
	assert.deepEqual(toolNames(legacyH.requests[1]), ["load_skill", "pdf"], "legacy turn-2 tools reflect the mount");
	assert.deepEqual(toolNames(loop2H.requests[0]), ["load_skill"], "loop2 turn-1 tools");
	assert.deepEqual(toolNames(loop2H.requests[1]), ["load_skill", "pdf"], "loop2 turn-2 tools reflect the mount");
});

// --- transient provider retry ------------------------------------------------

test("equivalence: transient provider error (429) — one retry then success on both engines", async () => {
	// Attempt 1 throws a retryable 429; attempt 2 succeeds. Factory: a fresh Error object per engine run.
	// providerRetryBaseDelayMs=1 keeps the backoff sleep at 1ms (nextRetryDecision: 1 * 2^0, no jitter).
	const scenario = (): Scenario => ({
		responses: [
			{ scriptedError: Object.assign(new Error("429 rate limited"), { status: 429 }) },
			textResponse("m1", "recovered after retry"),
		],
		budget: { providerRetryBaseDelayMs: 1 },
	});
	const { legacy, loop2, legacyH, loop2H } = await runBoth(scenario);

	assert.equal(legacy.status, "succeeded");
	assert.equal(loop2.status, "succeeded");
	assert.equal(loop2.finalText, "recovered after retry");
	// Both engines made two provider requests (failed attempt + successful retry), same seq on both
	// attempts (the failed request records no usage — runBoth already asserted the calls sequence).
	assert.equal(legacyH.requests.length, 2, "legacy retried the request");
	assert.equal(loop2H.requests.length, 2, "loop2 retried the request");
	assert.equal(legacyH.requests[0]?.seq, legacyH.requests[1]?.seq, "legacy retry reuses the step seq");
	assert.equal(loop2H.requests[0]?.seq, loop2H.requests[1]?.seq, "loop2 retry reuses the step seq");
	// Exactly one provider_retry event each, identical shape (runBoth compared the full sequences —
	// including attempt / retry_reason / delay_ms via EVENT_DATA_KEYS).
	const retryEvents = (h: Harness) => h.emittedEvents.filter((e) => e.data.kind === "provider_retry");
	assert.equal(retryEvents(legacyH).length, 1, "legacy emitted one provider_retry");
	assert.equal(retryEvents(loop2H).length, 1, "loop2 emitted one provider_retry");
	const event = retryEvents(loop2H)[0]!;
	assert.equal(event.type, "agent_run.step");
	assert.equal(event.data.step_no, 1);
	assert.equal(event.data.attempt, 1);
	assert.equal(event.data.retry_reason, "transient");
	assert.equal(event.data.delay_ms, 1);
});

test("equivalence: non-retryable provider error (400) — both engines fail immediately, no retry", async () => {
	const make = () =>
		makeHarness({
			responses: [{ scriptedError: Object.assign(new Error("400 bad request"), { status: 400 }) }],
			budget: { providerRetryBaseDelayMs: 1 },
		});
	const legacyH = make();
	const loop2H = make();

	// CORE-09：两引擎都不再裸抛（旧契约：throw 给 agent-runner 的 catch）——统一走 settleRunException
	// 按 status:"failed" 正常收尾（recordUsage + agent_run.failed + 结构化 handoff，budgetHit="unknown"）。
	const legacy = await createAgentLoop().run(legacyH.input);
	const loop2 = await runAgentLoop2(loop2H.input);
	assert.equal(legacy.status, "failed");
	assert.equal(loop2.status, "failed");
	assert.match(legacy.reason, /400 bad request/);
	assert.match(loop2.reason, /400 bad request/);
	assert.equal(legacy.handoff?.budgetHit, "unknown");
	assert.equal(loop2.handoff?.budgetHit, "unknown");
	assert.equal(legacyH.emittedEvents.some((e) => e.type === "agent_run.failed"), true, "legacy emitted agent_run.failed");
	assert.equal(loop2H.emittedEvents.some((e) => e.type === "agent_run.failed"), true, "loop2 emitted agent_run.failed");

	// No retry on a 4xx: exactly one provider request, zero provider_retry events, on both engines.
	assert.equal(legacyH.requests.length, 1, "legacy did not retry");
	assert.equal(loop2H.requests.length, 1, "loop2 did not retry");
	assert.deepEqual(
		projectEvents(loop2H.emittedEvents),
		projectEvents(legacyH.emittedEvents),
		"emitted event sequence diverged on the failure path",
	);
	assert.deepEqual(loop2H.recorderLog, legacyH.recorderLog, "recorder call sequence diverged");
	assert.deepEqual(loop2H.calls, legacyH.calls, "usage-record accounting diverged (must be empty on both)");
	assert.deepEqual(loop2H.calls, [], "a failed request records no usage");
});

// --- (B6) repeat-tool reminder tiers ---------------------------------------

/** The reminder messages B6 injects (a user message whose whole body is a string). */
function reminderBodies(messages: LlmMessage[]): string[] {
	return messages
		.filter((message) => message.role === "user" && typeof message.content === "string")
		.map((message) => message.content as string)
		.filter((content) => content.startsWith("[自动提醒]"));
}

test("equivalence: B6 repeat-tool reminder — nudge at 3 and 5, escalate at 8, same wire text on both", async () => {
	// Behaviour change (not a bug fix): before B6 the third identical step escalated outright.
	const repeated = () =>
		Array.from({ length: 8 }, (_, index) =>
			toolResponse(`m${index + 1}`, [{ id: `call-${index + 1}`, name: "echo", input: { message: "same" } }]),
		);
	const { legacy, loop2, legacyH, loop2H } = await runBoth(() => ({
		responses: repeated(),
		toolSpecs: [ECHO_TOOL],
	}));

	// Eight steps ran; only the eighth escalated.
	assert.equal(legacy.status, "escalated");
	assert.equal(loop2.status, "escalated");
	assert.equal(legacy.reason, "doom_loop");
	assert.equal(loop2.reason, "doom_loop");
	assert.equal(legacy.usage.stepsUsed, 8);
	assert.equal(loop2.usage.stepsUsed, 8);
	assert.equal(legacyH.requests.length, 8);
	assert.equal(loop2H.requests.length, 8);

	// The FULL model-visible transcript is identical turn by turn — same reminder text, same user
	// role, same position after that turn's tool_result (loop.ts appends it; loop2 steers it in).
	assert.deepEqual(loop2H.requestMessages, legacyH.requestMessages, "wire transcript diverged");

	// Tier 1 lands after step 3, tier 2 after step 5, and steps 4/6/7 do not re-nudge.
	const nudgesPerTurn = loop2H.requestMessages.map((messages) => reminderBodies(messages).length);
	assert.deepEqual(nudgesPerTurn, [0, 0, 0, 1, 1, 2, 2, 2]);
	const [gentle, detailed] = reminderBodies(loop2H.requestMessages[7] ?? []);
	assert.match(gentle ?? "", /连续 3 步重复同一个动作/);
	assert.match(detailed ?? "", /连续 5 步重复同一个动作/);
	assert.match(detailed ?? "", /重复的工具：echo/);
	assert.match(detailed ?? "", /echo\(\{"message":"same"\}\)/);
});

test("equivalence: B6 观测面 — 两套引擎在同一步发同一形状的 agent_run.reminded，tier 3 只发 escalated", async () => {
	// runBoth 已逐条比过完整事件序列（projectEvents 现在也带上 tier/repeats/shape/tool_ids），这里再把
	// 「谁在第几步、发了什么」摊开断言一遍：一条重复链路只该有两条 reminded（第 3、5 步），第 8 步升级
	// 走 agent_run.escalated，不再补发第三条 reminded。
	const { legacyH, loop2H } = await runBoth(() => ({
		responses: Array.from({ length: 8 }, (_, index) =>
			toolResponse(`m${index + 1}`, [{ id: `call-${index + 1}`, name: "echo", input: { message: "same" } }]),
		),
		toolSpecs: [ECHO_TOOL],
	}));

	const reminded = (harness: Harness) =>
		harness.emittedEvents.filter((event) => event.type === "agent_run.reminded").map((event) => event.data);
	const expected = [
		{ run_id: "run-eqv", step_no: 3, tier: 1, repeats: 3, shape: "identical", tool_id: "echo" },
		{ run_id: "run-eqv", step_no: 5, tier: 2, repeats: 5, shape: "identical", tool_id: "echo" },
	];
	assert.deepEqual(reminded(legacyH), expected);
	assert.deepEqual(reminded(loop2H), expected);
	// 单工具重复不带 tool_ids（同一事实不存两份）。
	assert.equal(reminded(loop2H).every((data) => !("tool_ids" in data)), true);
	// 第三档不重复发：升级只有 agent_run.escalated 一条。
	assert.equal(legacyH.escalatedEvents, 1);
	assert.equal(loop2H.escalatedEvents, 1);

	// reminded 紧跟在该步的 agent_run.step(control) 之后——两套引擎的时间线插入位置相同。
	for (const harness of [legacyH, loop2H]) {
		const types = harness.emittedEvents.map((event) => event.type);
		for (const index of types.flatMap((type, i) => (type === "agent_run.reminded" ? [i] : []))) {
			assert.equal(types[index - 1], "agent_run.step");
			assert.equal(harness.emittedEvents[index - 1]?.data["control"], "continue");
		}
	}
});

test("equivalence: B6 观测面 — 交替重复（A-B-A-B）两侧都报 shape=alternating 并带上两个工具名", async () => {
	// 交替形态需要 4 步才判定，第一档阈值 3 因此被越过 → 首条 reminded 直接是 tier 1、repeats 4。
	const alternating = () =>
		Array.from({ length: 6 }, (_, index) =>
			index % 2 === 0
				? toolResponse(`m${index + 1}`, [{ id: `call-${index + 1}`, name: "echo", input: { message: "a" } }])
				: toolResponse(`m${index + 1}`, [{ id: `call-${index + 1}`, name: "boom", input: {} }]),
		);
	const { loop2H, legacyH } = await runBoth(() => ({
		responses: alternating(),
		toolSpecs: [ECHO_TOOL, FAIL_TOOL],
		execute: (toolId: string) => okToolResult(`ran ${toolId}`),
	}));

	const first = loop2H.emittedEvents.find((event) => event.type === "agent_run.reminded")?.data;
	assert.equal(first?.["shape"], "alternating");
	assert.equal(first?.["tier"], 1);
	assert.equal(first?.["repeats"], 4);
	assert.deepEqual(first?.["tool_ids"], ["echo", "boom"]);
	assert.equal(first?.["tool_id"], "echo");
	assert.deepEqual(
		legacyH.emittedEvents.filter((event) => event.type === "agent_run.reminded").map((event) => event.data),
		loop2H.emittedEvents.filter((event) => event.type === "agent_run.reminded").map((event) => event.data),
	);
});

test("equivalence: B6 nudges never outrun the step budget — steps run out first, both engines", async () => {
	// The extra steps a nudge buys must not break the budget path: with maxSteps below the
	// escalation tier the run still ends on "步数预算已耗尽" (budgetHit "steps"), not doom_loop.
	const { legacy, loop2, legacyH, loop2H } = await runBoth(() => ({
		responses: Array.from({ length: 4 }, (_, index) =>
			toolResponse(`m${index + 1}`, [{ id: `call-${index + 1}`, name: "echo", input: { message: "same" } }]),
		),
		toolSpecs: [ECHO_TOOL],
		budget: { maxSteps: 4 },
	}));

	assert.equal(legacy.status, "escalated");
	assert.equal(loop2.status, "escalated");
	assert.equal(legacy.reason, "步数预算已耗尽");
	assert.equal(loop2.reason, "步数预算已耗尽");
	assert.equal(legacy.handoff?.budgetHit, "steps");
	assert.equal(loop2.handoff?.budgetHit, "steps");
	assert.equal(legacyH.requests.length, 4, "no extra provider call after the budget is spent");
	assert.equal(loop2H.requests.length, 4);
	// Exactly one nudge got in before the budget ended the run.
	assert.equal(reminderBodies(loop2H.requestMessages[3] ?? []).length, 1);
	assert.deepEqual(loop2H.requestMessages, legacyH.requestMessages, "wire transcript diverged");
});

// --- (B10) 两段式压缩：剪枝标记 / spill 提示 / 摘要请求数 --------------------

test("equivalence: B10 spill — 超大工具结果落盘后，两套引擎的截断文本与定位提示逐字相同", async () => {
	// 单条上下文预算 500 字符，工具吐 9000 字符：两套引擎都得先落盘到 <workdir>/.spill/0001-echo.txt，
	// 再把「截断正文 + 中英各一句定位提示」写进对话。两次运行共用同一个 workdir——写的是同样的
	// 内容、同样的文件名，正好顺带证明落盘是确定性的。
	const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-eqv-spill-"));
	const huge = "料".repeat(9000);
	const { loop2H, legacyH } = await runBoth(() => ({
		responses: [toolResponse("m1", [{ id: "c1", name: "echo", input: { message: "大" } }]), textResponse("m2", "done")],
		toolSpecs: [ECHO_TOOL],
		execute: () => okToolResult(huge),
		budget: { toolResultContextChars: 500 },
		workdir,
	}));

	assert.deepEqual(loop2H.requestMessages, legacyH.requestMessages, "wire transcript diverged");
	const body = JSON.stringify(loop2H.requestMessages[1] ?? []);
	assert.match(body, /…\[已截断 8550 字符，中段省略\]/u);
	assert.match(body, /\[完整内容已保存到 \.spill\/0001-echo\.txt，需要时用 read_file 读取它\]/u);
	assert.match(body, /\[The full output is saved at \.spill\/0001-echo\.txt; use read_file to read the rest\.\]/u);
	// 完整原文落在盘上，不在对话里。
	assert.equal((await readFile(path.join(workdir, ".spill", "0001-echo.txt"), "utf8")).length, 9000);
});

test("equivalence: B10 剪枝够用 — 两套引擎都跳过摘要请求，剪枝标记逐字相同", async () => {
	// 4 步各产 5000 字符工具结果、每步 5000 token：累计 token 第 4 步后越过 20000 × 0.8 的压缩线，
	// 但剪掉最老 3 条之后历史只剩约 1.1 万字符（≈5500 token），远在线下 → 两边都不发摘要请求。
	// compactionResponses 照样挂上：真发了请求就会被计数抓到，比「没配 client」是更强的断言。
	const chunk = "料".repeat(5000);
	const { loop2H, legacyH } = await runBoth(() => ({
		responses: [
			toolResponse("m1", [{ id: "c1", name: "echo", input: { message: "1" } }], 5000, 0),
			toolResponse("m2", [{ id: "c2", name: "echo", input: { message: "2" } }], 5000, 0),
			toolResponse("m3", [{ id: "c3", name: "echo", input: { message: "3" } }], 5000, 0),
			toolResponse("m4", [{ id: "c4", name: "echo", input: { message: "4" } }], 5000, 0),
			textResponse("m5", "done", 5000, 0),
		],
		toolSpecs: [ECHO_TOOL],
		execute: () => okToolResult(chunk),
		budget: { contextWindowTokens: 20000, compactThreshold: 0.8, maxCompactions: 2 },
		compactionResponses: [compactionSummaryResponse("不该被用到的摘要")],
	}));

	assert.equal(legacyH.compactionRequests.length, 0, "legacy 不该发摘要请求");
	assert.equal(loop2H.compactionRequests.length, 0, "loop2 不该发摘要请求");
	const kinds = (harness: typeof loop2H) =>
		harness.emittedEvents.filter((event) => event.type === "agent_run.compacting").map((event) => event.data.summary_kind);
	assert.deepEqual(kinds(legacyH), ["pruned"]);
	assert.deepEqual(kinds(loop2H), ["pruned"]);
	// 剪枝省下的字符量必须一模一样——两侧的上下文投影口径若漂了，这里立刻红。
	const prunedChars = (harness: typeof loop2H) =>
		harness.emittedEvents.find((event) => event.type === "agent_run.compacting")?.data.pruned_chars;
	assert.equal(prunedChars(loop2H), prunedChars(legacyH));
	assert.deepEqual(loop2H.requestMessages, legacyH.requestMessages, "wire transcript diverged");
	// 最后一次请求里：老结果带剪枝标记，最近一条原样保留。
	const last = JSON.stringify(loop2H.requestMessages[loop2H.requestMessages.length - 1] ?? []);
	assert.match(last, /…\[中段已剪枝：为节省上下文省略 \d+ 个字符；这是运行环境删的，不是原始输出缺失。需要完整内容请重新执行产生它的那一步。\]/u);
	assert.match(last, /…\[middle pruned: \d+ characters were removed here to save context/u);
});

test("equivalence: B10 剪枝不够 — 两套引擎都恰好发一次摘要请求", async () => {
	// 压缩线 = 6000 × 0.8 = 4800 token = 9600 字符；3 条 8000 字符的结果剪完仍有约 1.2 万字符 → 不够。
	const chunk = "料".repeat(8000);
	const { loop2H, legacyH } = await runBoth(() => ({
		responses: [
			toolResponse("m1", [{ id: "c1", name: "echo", input: { message: "1" } }], 2000, 0),
			toolResponse("m2", [{ id: "c2", name: "echo", input: { message: "2" } }], 2000, 0),
			toolResponse("m3", [{ id: "c3", name: "echo", input: { message: "3" } }], 2000, 0),
			textResponse("m4", "done", 2000, 0),
		],
		toolSpecs: [ECHO_TOOL],
		execute: () => okToolResult(chunk),
		budget: { contextWindowTokens: 6000, compactThreshold: 0.8, maxCompactions: 2 },
		compactionResponses: [compactionSummaryResponse("## 目标（Goal）\n继续整理")],
	}));

	assert.equal(legacyH.compactionRequests.length, 1);
	assert.equal(loop2H.compactionRequests.length, 1);
	assert.equal(loop2H.compactionRequests[0]?.source, "compact");
	const kind = (harness: typeof loop2H) =>
		harness.emittedEvents.find((event) => event.type === "agent_run.compacting")?.data.summary_kind;
	assert.equal(kind(legacyH), "structured");
	assert.equal(kind(loop2H), "structured");
});
