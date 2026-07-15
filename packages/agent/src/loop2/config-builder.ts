/**
 * loop2 Phase 2 — configBuilder + shadow switch (R15 批 C 绞杀者迁移).
 *
 * `runAgentLoop2` assembles a WorkHub `AgentLoopInput` (the shape the production
 * `AgentLoop.run` consumes) into a vendored-pi `AgentLoopConfig` + drives the
 * vendored `runAgentLoop`, then folds the terminal transcript back into a WorkHub
 * `AgentLoopResult`. It is a drop-in stand-in for `AgentLoop.run` so the caller
 * (`agent-runner`) can dispatch to either implementation behind a feature flag.
 *
 * Callback mapping (WorkHub loop-core → pi `AgentLoopConfig`):
 *
 *   | WorkHub concern                | pi callback / seam                              |
 *   |--------------------------------|-------------------------------------------------|
 *   | provider stream + usage seq    | `streamFn` = createProviderStreamFn(nextSeq)    |
 *   | tool execution (return-based)  | `tools[].execute` → input.tools.execute (stash) |
 *   | sequential tool order          | `toolExecution: "sequential"`                   |
 *   | isError propagation            | `afterToolCall: workhubAfterToolCall`           |
 *   | truncation sanitize (400 fix)  | `convertToLlm` cleans non-object tool_use args  |
 *   | budget stop (steps/time/tok/$) | `shouldStopAfterTurn` = checkLoopBudget         |
 *   | doom-loop escalate             | `shouldStopAfterTurn` = DoomLoopDetector        |
 *   | context compaction             | `transformContext` (threshold + mechanical sum) |
 *   | overflow self-heal (text trunc)| `shouldStopAfterTurn` + `getFollowUpMessages`   |
 *   | human-reserved before-guard    | preserved inside injected `input.tools.execute` |
 *   | L3: deliverable/manifest/review| reuse `loop.ts` `finalizeL3` (single source)    |
 *   | result fold                    | `toAgentLoopResult` + L3/escalation overrides   |
 *
 * See ./NOTICE.md for the vendored-loop provenance and 03-batch-c-engine.md §Phase 2.
 */

import { errorToolResult, type ToolExecutionContext, type ToolResult } from "@workhub/tools";
import { eventTypes } from "@workhub/contracts";

import type { LlmMessage } from "../providers/types.js";
import { checkLoopBudget, controlFromAssistant, createInitialUsage, DoomLoopDetector } from "../loop/control.js";
import { buildStructuredHandoff } from "../loop/handoff.js";
import { finalizeL3 } from "../loop/loop.js";
import type {
	AgentAssistantBlock,
	AgentLoopInput,
	AgentLoopResult,
	AgentLoopStep,
	AgentLoopUsage,
	StructuredHandoff,
} from "../loop/types.js";
import {
	type AgentContext,
	type AgentLoopConfig,
	type AgentMessage,
	type AgentTool,
	type AgentToolResult,
	type AssistantMessage,
	type JsonSchema,
	type Message,
	type Model,
	runAgentLoop,
	type ToolResultMessage,
} from "./index.js";
import { createProviderStreamFn, readWorkhubUsage } from "./adapters/stream-fn.js";
import { piAssistantContentToBlocks, toAgentLoopResult, toWorkhubStopReason } from "./adapters/result.js";
import { extractWorkhubToolResult, workhubAfterToolCall, workhubToolResultToPi } from "./adapters/tools.js";

// --- CNY / usage math (replicated from loop/loop.ts to keep identical formatting,
//     same precedent as adapters/result.ts) -----------------------------------

function parseCny(value: string | undefined): number {
	const parsed = Number.parseFloat(value ?? "0");
	return Number.isFinite(parsed) ? parsed : 0;
}

function formatCny(value: number): string {
	return value.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "") || "0";
}

function addUsage(usage: AgentLoopUsage, inputTokens: number, outputTokens: number, estimatedCostCny?: string): void {
	usage.tokenIn += inputTokens;
	usage.tokenOut += outputTokens;
	usage.totalTokens += inputTokens + outputTokens;
	usage.estimatedCostCny = formatCny(parseCny(usage.estimatedCostCny) + parseCny(estimatedCostCny));
}

function elapsedSeconds(startedAt: number): number {
	return (Date.now() - startedAt) / 1000;
}

// --- mechanical compaction summary (mirrors loop/loop.ts summarizeStepsForCompaction;
//     structured-summary-via-compactionClient is deferred to a later phase) ------

function previewUnknown(value: unknown, maxLength = 80): string {
	if (typeof value === "string") return value.slice(0, maxLength);
	try {
		return JSON.stringify(value).slice(0, maxLength);
	} catch {
		return String(value).slice(0, maxLength);
	}
}

function summarizeStepsMechanical(steps: AgentLoopStep[], maxChars = 4000): string {
	const lines: string[] = [];
	for (const step of steps) {
		const text = step.assistant
			.filter((block): block is Extract<AgentAssistantBlock, { type: "text" }> => block.type === "text")
			.map((block) => block.text.trim())
			.join(" ")
			.slice(0, 120);
		if (step.toolCalls.length === 0) {
			lines.push(`step ${step.index}: ${text || "(无工具调用)"}`);
			continue;
		}
		for (let index = 0; index < step.toolCalls.length; index += 1) {
			const call = step.toolCalls[index]!;
			const result = step.toolResults[index];
			const outcome = result ? (result.isError ? "error" : "ok") : "pending";
			lines.push(`step ${step.index}: ${call.name}(${previewUnknown(call.input, 80)}) -> ${outcome}`);
		}
	}
	const summary = lines.join("\n");
	if (summary.length <= maxChars) return summary;
	const headChars = Math.floor(maxChars * 0.7);
	const tailChars = Math.floor(maxChars * 0.2);
	return `${summary.slice(0, headChars)}\n…[摘要中段省略]\n${summary.slice(summary.length - tailChars)}`;
}

// --- pi-message helpers ----------------------------------------------------

function isAssistant(message: AgentMessage): message is AssistantMessage {
	return (message as { role?: string }).role === "assistant";
}

function lastAssistant(messages: AgentMessage[]): AssistantMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message && isAssistant(message)) return message;
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

/**
 * Truncation sanitize (补丁3 semantics, ported to pi message shape). A `max_tokens`
 * cut-off leaves a tool_use's streamed arguments a degenerate partial-JSON string;
 * echoing that string input back to a real provider 400s ("tool_use.input must be an
 * object"). Replace only non-object toolCall arguments with `{}`, keeping every other
 * block (text / thinking / redacted_thinking) verbatim so extended-thinking echoes stay
 * valid. Runs inside `convertToLlm`, before the streamFn re-serializes to the wire.
 */
function sanitizePiTruncatedContent(messages: AgentMessage[]): Message[] {
	return (messages as Message[]).map((message) => {
		if (message.role !== "assistant") return message;
		let changed = false;
		const content = message.content.map((block) => {
			if (block.type === "toolCall") {
				const args: unknown = block.arguments;
				if (!args || typeof args !== "object" || Array.isArray(args)) {
					changed = true;
					return { ...block, arguments: {} as Record<string, never> };
				}
			}
			return block;
		});
		return changed ? { ...message, content } : message;
	});
}

/**
 * Drop a tool-result message whose tool_use has no matching assistant toolCall left in
 * the retained tail, and vice versa — the pi analogue of loop.ts dropDanglingToolUse,
 * so a compacted transcript never ends on a dangling tool_use / orphan tool_result
 * (either 400s a real provider). Only exercised by compaction; pairs are cut together
 * at the assistant boundary so this is a belt-and-suspenders pass.
 */
function dropDanglingPiPairs(tail: AgentMessage[]): AgentMessage[] {
	const toolCallIds = new Set<string>();
	for (const message of tail) {
		if (isAssistant(message)) {
			for (const block of message.content) {
				if (block.type === "toolCall") toolCallIds.add(block.id);
			}
		}
	}
	const resultIds = new Set<string>();
	for (const message of tail) {
		if ((message as { role?: string }).role === "toolResult") {
			resultIds.add((message as ToolResultMessage).toolCallId);
		}
	}
	const kept: AgentMessage[] = [];
	for (const message of tail) {
		if ((message as { role?: string }).role === "toolResult") {
			// Orphan tool_result (no matching assistant toolCall in tail) → drop.
			if (toolCallIds.has((message as ToolResultMessage).toolCallId)) kept.push(message);
			continue;
		}
		if (isAssistant(message)) {
			const content = message.content.filter((block) => block.type !== "toolCall" || resultIds.has(block.id));
			if (content.length === 0) continue; // empty assistant turn is illegal — drop it
			kept.push(content.length === message.content.length ? message : { ...message, content });
			continue;
		}
		kept.push(message);
	}
	return kept;
}

// --- tool ctx (mirrors loop/loop.ts run() ctx assembly) ---------------------

function buildToolCtx(input: AgentLoopInput): ToolExecutionContext {
	return {
		workdir: input.workdir,
		...(input.actorId ? { actorId: input.actorId } : {}),
		runId: input.runId,
		workItemId: input.workItemId,
		sandboxBudget: {
			maxFiles: input.budget.maxFiles ?? 800,
			maxBytes: input.budget.maxBytes ?? 200 * 1024 * 1024,
			commandTimeoutSeconds: input.budget.commandTimeoutSeconds ?? 45,
		},
		...(input.snapshot ? { snapshot: input.snapshot } : {}),
		...(input.commandRunner ? { commandRunner: input.commandRunner } : {}),
	};
}

function toolResultFromMessage(message: ToolResultMessage): ToolResult {
	const stashed = extractWorkhubToolResult(message.details);
	if (stashed) return stashed;
	const text = message.content
		.filter((block): block is Extract<ToolResultMessage["content"][number], { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	return { ok: !message.isError, content: text, isError: message.isError };
}

// --- the runner ------------------------------------------------------------

/** Terminal escalation captured by the loop hooks (folded into the result after the run). */
type Escalation = {
	/** AgentLoopResult.reason (matches loop.ts terminalResult reason). */
	resultReason: string;
	/** StructuredHandoff.blockers reason (matches loop.ts handoff reason). */
	handoffReason: string;
	budgetHit: StructuredHandoff["budgetHit"];
	control: AgentLoopResult["control"];
};

/**
 * Drive the vendored pi loop for one WorkHub AgentRun and return a WorkHub
 * `AgentLoopResult`. Drop-in replacement for `AgentLoop.run`.
 */
export async function runAgentLoop2(input: AgentLoopInput): Promise<AgentLoopResult> {
	const now = input.now ?? (() => new Date());
	const startedAt = Date.now();
	const requireDeliverable = input.requireDeliverable ?? true;
	const maxCompactions = input.budget.maxCompactions ?? 2;

	// Shared mutable state accumulated across turns (mirrors loop.ts run() locals).
	const usage = createInitialUsage();
	const steps: AgentLoopStep[] = [];
	const doomLoop = new DoomLoopDetector(input.budget.doomLoopWindow ?? 3);
	let compactions = 0;
	let nextCompactionAtTokens = 0;
	let forceCompactBeforeNext = false; // overflow self-heal: text-only max_tokens
	let wantOverflowRetry = false;
	let escalation: Escalation | undefined;
	// A throw from input.tools.execute (e.g. human-reserved 409). pi swallows tool throws into
	// error tool_results, so capture + abort + re-throw after the loop to stay a faithful stand-in
	// for AgentLoop.run (whose input.tools.execute throws propagate out and fail the run).
	let fatalToolError: unknown;

	// Merge the caller signal with an internal controller so a fatal tool error stops promptly.
	const runController = new AbortController();
	const forwardAbort = () => runController.abort(input.signal?.reason);
	if (input.signal) {
		if (input.signal.aborted) runController.abort(input.signal.reason);
		else input.signal.addEventListener("abort", forwardAbort, { once: true });
	}

	const model: Model = {
		id: input.client.model,
		name: input.client.model,
		api: "anthropic",
		provider: input.client.provider ?? "deepseek",
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: input.budget.contextWindowTokens ?? 0,
		maxTokens: input.maxTokensPerStep ?? 4096,
	};

	// nextSeq feeds the real 1-based agent step number into usage-record dedup (findings[19]);
	// mirrors loop.ts `seq: params.stepNo` (stepNo = usage.stepsUsed + 1, one per worker turn).
	let stepSeq = 0;
	const streamFn = createProviderStreamFn({
		client: input.client,
		source: "agent_step",
		...(input.maxTokensPerStep !== undefined ? { maxTokens: input.maxTokensPerStep } : {}),
		nextSeq: () => {
			stepSeq += 1;
			return stepSeq;
		},
	});

	// Tools resolved once for the run (pi holds context.tools static across turns; loop.ts
	// re-resolves per turn — a documented allowed difference for dynamic tool visibility).
	const ctx = buildToolCtx(input);
	const modelTools = await input.tools.toModelTools(ctx);
	const tools: AgentTool[] = modelTools.map((raw) => {
		const spec = raw as { name: string; description?: string; input_schema?: unknown };
		const parameters: JsonSchema =
			spec.input_schema && typeof spec.input_schema === "object" ? (spec.input_schema as JsonSchema) : { type: "object" };
		return {
			name: spec.name,
			description: spec.description ?? "",
			parameters,
			label: spec.name,
			execute: async (_toolCallId: string, params: Record<string, unknown>): Promise<AgentToolResult<ToolResult>> => {
				try {
					const result = await input.tools.execute(spec.name, params, ctx);
					return workhubToolResultToPi(result);
				} catch (error) {
					// Legacy loop.run lets input.tools.execute throws propagate out. Capture, abort, and
					// re-throw after the loop; return an error result so the current batch finishes cleanly.
					fatalToolError = error;
					runController.abort(error);
					return workhubToolResultToPi(errorToolResult(error instanceof Error ? error.message : String(error)));
				}
			},
		} satisfies AgentTool;
	});

	const compactionThreshold = (): number =>
		Math.max(1, Math.floor((input.budget.contextWindowTokens ?? 0) * (input.budget.compactThreshold ?? 0.8)));

	const doCompactBookkeeping = async (trigger: "context_window" | "max_tokens"): Promise<void> => {
		compactions += 1;
		nextCompactionAtTokens = usage.totalTokens + compactionThreshold();
		await input.emit?.({
			type: eventTypes.agentRunCompacting,
			previewText: `上下文已压缩（第 ${compactions} 次，触发=${trigger}）`,
			data: { run_id: input.runId, trigger, compactions, summary_kind: "mechanical" },
		});
	};

	const compactPiContext = (messages: AgentMessage[]): AgentMessage[] => {
		const keep = 6;
		let cut = Math.max(1, messages.length - keep);
		while (cut < messages.length && (messages[cut] as { role?: string }).role !== "assistant") cut += 1;
		const tail = dropDanglingPiPairs(messages.slice(cut));
		const summary = summarizeStepsMechanical(steps);
		const summaryMessage: AgentMessage = {
			role: "user",
			content: `${input.initialUserMessage}\n\n[上下文已压缩。此前执行摘要]\n${summary}\n[摘要结束。请基于以上进度继续完成任务。]`,
			timestamp: Date.now(),
		};
		return [summaryMessage, ...tail];
	};

	const config: AgentLoopConfig = {
		model,
		toolExecution: "sequential",
		afterToolCall: workhubAfterToolCall,
		convertToLlm: (messages) => sanitizePiTruncatedContent(messages),
		transformContext: async (messages) => {
			if (forceCompactBeforeNext) {
				forceCompactBeforeNext = false;
				await doCompactBookkeeping("max_tokens");
				return compactPiContext(messages);
			}
			const decision = checkLoopBudget(usage, input.budget);
			if (decision?.signal === "compact" && usage.totalTokens >= nextCompactionAtTokens && compactions < maxCompactions) {
				await doCompactBookkeeping("context_window");
				return compactPiContext(messages);
			}
			return messages;
		},
		getFollowUpMessages: async () => {
			if (!wantOverflowRetry) return [];
			wantOverflowRetry = false;
			forceCompactBeforeNext = true; // transformContext compacts before the retry turn
			return [
				{
					role: "user",
					content: "你的上一条回复因长度限制被截断。请基于摘要中的进度继续完成任务，并控制单次输出长度；完成后自然结束。",
					timestamp: Date.now(),
				},
			];
		},
		shouldStopAfterTurn: async ({ message, toolResults }) => {
			if (!isAssistant(message)) return false;
			// Accumulate usage (tokens + CNY side-channel) and record the reconstructed step.
			const workhubUsage = readWorkhubUsage(message);
			addUsage(usage, message.usage.input, message.usage.output, workhubUsage?.estimatedCostCny);
			const stepNo = steps.length + 1;
			const blocks = piAssistantContentToBlocks(message.content);
			const toolCalls = blocks.filter(
				(block): block is Extract<AgentAssistantBlock, { type: "tool_use" }> => block.type === "tool_use",
			);
			const stopReason = toWorkhubStopReason(message.stopReason);
			const workhubResults = (toolResults as ToolResultMessage[]).map(toolResultFromMessage);
			const step: AgentLoopStep = {
				index: stepNo,
				assistant: blocks,
				toolCalls,
				toolResults: workhubResults,
				control: controlFromAssistant(blocks, stopReason),
				startedAt: now().toISOString(),
				endedAt: now().toISOString(),
			};
			if (stopReason) step.stopReason = stopReason;
			const snapshotId = workhubResults.find((result) => result.snapshotId)?.snapshotId;
			if (snapshotId) step.snapshotId = snapshotId;
			steps.push(step);
			usage.stepsUsed = steps.length;
			usage.secondsUsed = elapsedSeconds(startedAt);
			await input.recorder?.recordStep(step);
			input.recorder?.recordUsage?.(usage);

			if (fatalToolError) return true; // re-thrown after the loop

			// Doom loop (identical fingerprint / window as loop.ts).
			if (doomLoop.push(step)) {
				escalation = {
					resultReason: "doom_loop",
					handoffReason: "连续多步执行了相同动作，已自动升级。",
					budgetHit: "doom_loop",
					control: "escalate",
				};
				return true;
			}

			// Budget escalate (steps / timeout / tokens / cost) — same predicate + timing as loop.ts
			// (loop.ts checks at loop top before the next turn; here after the turn == same boundary).
			const decision = checkLoopBudget(usage, input.budget);
			if (decision?.signal === "escalate") {
				escalation = {
					resultReason: decision.reason,
					handoffReason: decision.reason,
					budgetHit: decision.budgetHit,
					control: "escalate",
				};
				return true;
			}
			// Compaction-budget exhausted (context-window compaction wanted but out of budget).
			if (
				decision?.signal === "compact" &&
				usage.totalTokens >= nextCompactionAtTokens &&
				compactions >= maxCompactions
			) {
				escalation = {
					resultReason: "compact_budget_exhausted",
					handoffReason: "上下文压缩次数已用尽",
					budgetHit: "tokens",
					control: "escalate",
				};
				return true;
			}

			// Overflow self-heal: a text-only max_tokens turn (control === "compact") compacts and
			// retries; if compaction budget is spent, escalate compact_required (mirrors loop.ts).
			if (step.control === "compact") {
				if (compactions < maxCompactions) {
					wantOverflowRetry = true; // getFollowUpMessages injects the continue prompt
					return false;
				}
				escalation = {
					resultReason: "compact_required",
					handoffReason: "模型响应被截断且压缩次数已用尽。",
					budgetHit: "tokens",
					control: "compact",
				};
				return true;
			}
			return false;
		},
	};

	await input.emit?.({
		type: eventTypes.agentRunStarted,
		previewText: "AgentRun started",
		data: { run_id: input.runId, work_item_id: input.workItemId, budget: input.budget },
	});

	const context: AgentContext = { systemPrompt: input.systemPrompt, messages: [], tools };
	const promptMessage: AgentMessage = { role: "user", content: input.initialUserMessage, timestamp: Date.now() };
	const transcript = await runAgentLoop(
		[promptMessage],
		context,
		config,
		() => {},
		runController.signal,
		streamFn,
	);

	// A fatal tool throw (human-reserved 409 etc.) propagates like the legacy loop.
	if (fatalToolError) throw fatalToolError;

	// A provider failure is encoded as a terminal assistant message (streamFn never throws);
	// re-throw it so agent-runner's catch handles it exactly as it does for the legacy loop.
	const last = lastAssistant(transcript);
	if (last && (last.stopReason === "error" || last.stopReason === "aborted")) {
		throw new Error(last.errorMessage ?? (last.stopReason === "aborted" ? "aborted" : "provider error"));
	}

	if (escalation) {
		const handoff = buildStructuredHandoff({ steps, budgetHit: escalation.budgetHit, reason: escalation.handoffReason });
		await input.emit?.({
			type: eventTypes.agentRunEscalated,
			previewText: escalation.handoffReason,
			data: { run_id: input.runId, handoff },
		});
		return toAgentLoopResult({
			messages: transcript,
			usage,
			status: "escalated",
			control: escalation.control,
			reason: escalation.resultReason,
			handoff,
		});
	}

	// Natural stop → L3 finalization (deliverable gate + manifest + review), reusing loop.ts.
	const finalText = last ? textFromBlocks(piAssistantContentToBlocks(last.content)) : "";
	const l3 = await finalizeL3(input, { finalText, usage, steps, requireDeliverable });
	if (l3.status === "failed") {
		return toAgentLoopResult({
			messages: transcript,
			usage,
			status: "failed",
			control: "stop",
			reason: l3.reason,
			finalText: l3.finalText,
		});
	}
	return toAgentLoopResult({
		messages: transcript,
		usage,
		status: "succeeded",
		control: "stop",
		reason: l3.reason,
		finalText: l3.finalText,
		...(l3.manifest ? { manifest: l3.manifest } : {}),
		...(l3.review ? { review: l3.review } : {}),
		...(l3.reviewFailed ? { reviewFailed: true } : {}),
	});
}

// --- shadow dispatch + loop-core equivalence -------------------------------

export type AgentRunLoop2Mode = "off" | "shadow-assert" | "on";

/** The loop-core fields whose equivalence Phase 2 validates (L3 manifest/review excluded). */
export type LoopCoreProjection = {
	status: AgentLoopResult["status"];
	control: AgentLoopResult["control"];
	reason: string;
	finalText: string;
	stepsUsed: number;
	tokenIn: number;
	tokenOut: number;
	totalTokens: number;
	estimatedCostCny: string;
	stepCount: number;
	stepControls: string[];
	stepStopReasons: (string | undefined)[];
	toolSequence: string[];
	toolInputs: string;
};

export function projectLoopCore(result: AgentLoopResult): LoopCoreProjection {
	const toolSequence: string[] = [];
	for (const step of result.steps) {
		for (const call of step.toolCalls) toolSequence.push(call.name);
	}
	return {
		status: result.status,
		control: result.control,
		reason: result.reason,
		finalText: result.finalText ?? "",
		stepsUsed: result.usage.stepsUsed,
		tokenIn: result.usage.tokenIn,
		tokenOut: result.usage.tokenOut,
		totalTokens: result.usage.totalTokens,
		estimatedCostCny: result.usage.estimatedCostCny,
		stepCount: result.steps.length,
		stepControls: result.steps.map((step) => step.control),
		stepStopReasons: result.steps.map((step) => step.stopReason),
		toolSequence,
		toolInputs: JSON.stringify(result.steps.map((step) => step.toolCalls.map((call) => call.input))),
	};
}

/** Compare two runs' loop-core projections; returns the list of differing fields (empty = equal). */
export function loopCoreDiffs(legacy: AgentLoopResult, loop2: AgentLoopResult): string[] {
	const a = projectLoopCore(legacy) as unknown as Record<string, unknown>;
	const b = projectLoopCore(loop2) as unknown as Record<string, unknown>;
	const diffs: string[] = [];
	for (const key of Object.keys(a)) {
		if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
			diffs.push(`${key}: legacy=${JSON.stringify(a[key])} loop2=${JSON.stringify(b[key])}`);
		}
	}
	return diffs;
}

/** Throw when the two runs disagree on any loop-core field. */
export function assertLoopCoreEquivalent(legacy: AgentLoopResult, loop2: AgentLoopResult): void {
	const diffs = loopCoreDiffs(legacy, loop2);
	if (diffs.length > 0) {
		throw new Error(`loop2 shadow divergence:\n${diffs.join("\n")}`);
	}
}

/**
 * Dispatch a WorkHub AgentRun to the legacy loop, loop2, or both (shadow-assert).
 *
 * - `off` (production default): call `legacy` unchanged — zero behavior change.
 * - `on`: single-path loop2.
 * - `shadow-assert` (test-only): run both on the SAME input and assert loop-core
 *   equivalence, returning the legacy result. Requires a deterministic, replayable
 *   stub client (both runs must see identical provider responses); never use with a
 *   real provider — it would double-charge.
 */
export async function runAgentLoopDispatch(
	input: AgentLoopInput,
	mode: AgentRunLoop2Mode,
	legacy: (input: AgentLoopInput) => Promise<AgentLoopResult>,
): Promise<AgentLoopResult> {
	if (mode === "on") return runAgentLoop2(input);
	if (mode === "shadow-assert") {
		const legacyResult = await legacy(input);
		const loop2Result = await runAgentLoop2(input);
		assertLoopCoreEquivalent(legacyResult, loop2Result);
		return legacyResult;
	}
	return legacy(input);
}
