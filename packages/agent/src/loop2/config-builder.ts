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
	type AgentEvent,
	type AgentEventSink,
	type AgentLoopConfig,
	type AgentMessage,
	type AgentTool,
	type AgentToolResult,
	type AssistantMessage,
	type AssistantMessageEvent,
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

// --- trace preview + mechanical compaction summary --------------------------
// (previewUnknown default 200 mirrors loop/loop.ts previewUnknown for trace input_preview.)

/** stream_event bus-write throttle: at most one heartbeat per second, matching loop.ts callModel. */
const STREAM_EMIT_THROTTLE_MS = 1000;

function previewUnknown(value: unknown, maxLength = 200): string {
	if (typeof value === "string") return value.slice(0, maxLength);
	try {
		return JSON.stringify(value).slice(0, maxLength);
	} catch {
		return String(value).slice(0, maxLength);
	}
}

/** stream_event 增量预览：抽取 pi assistantMessageEvent 的 delta 文本（对齐 loop.ts previewStreamEvent 口径）。 */
function previewPiStreamEvent(event: AssistantMessageEvent): string {
	const delta = (event as { delta?: unknown }).delta;
	if (typeof delta === "string") return delta.slice(0, 200);
	return previewUnknown((event as { type?: unknown }).type ?? "");
}

/**
 * pi 流式事件类型 → loop.ts 侧的 Anthropic SSE 词汇（stream_event.provider_event_type 对齐）。
 * 仅在真流式下出现（确定性缓冲测试不触发）；具体节流边界属墙钟差异。
 */
function piStreamEventType(piType: string): string {
	if (piType.endsWith("_start")) return "content_block_start";
	if (piType.endsWith("_delta")) return "content_block_delta";
	if (piType.endsWith("_end")) return "content_block_stop";
	return piType;
}

/** Text of a pi AgentToolResult (for stepToolResult previewText when no WorkHub result was stashed). */
function piToolResultText(result: unknown): string {
	const content = (result as { content?: unknown } | undefined)?.content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } => (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string")
		.map((block) => block.text)
		.join("\n");
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
	/**
	 * The compact_required overflow-escalation carries the truncated step index so the terminal emit
	 * mirrors loop.ts (which emits agentRunCompacting with step_no, not agentRunEscalated). Absent for
	 * every other escalation (doom/budget/compact_budget_exhausted → agentRunEscalated).
	 */
	compactRequiredStepNo?: number;
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
	// P3a event-adapter state (shared by the AgentEvent sink + the compaction hook). `sinkStepNo`
	// is the 1-based worker step being emitted (incremented per pi `turn_start`; equals loop.ts
	// `usage.stepsUsed + 1` at the loop top). `lastStreamEmitAt` throttles stream_event to the same
	// cadence as loop.ts (STREAM_EMIT_THROTTLE_MS), reset per step. `lastTruncatedStepNo` remembers the
	// text-only max_tokens step so the overflow (max_tokens) compaction emit carries its index, not the
	// retry turn's — mirroring loop.ts `compactNow("max_tokens", step.index)`.
	let sinkStepNo = 0;
	let lastStreamEmitAt = 0;
	let lastTruncatedStepNo = 0;
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

	// stepNo mirrors loop.ts compactNow: context_window → the upcoming step; max_tokens → the truncated
	// step that overflowed. summary_kind is "mechanical" until the structured summary lands (P3b).
	const doCompactBookkeeping = async (trigger: "context_window" | "max_tokens", stepNo: number): Promise<void> => {
		compactions += 1;
		nextCompactionAtTokens = usage.totalTokens + compactionThreshold();
		await input.emit?.({
			type: eventTypes.agentRunCompacting,
			previewText: `上下文已压缩（第 ${compactions} 次，触发=${trigger}）`,
			data: { run_id: input.runId, step_no: stepNo, trigger, compactions, summary_kind: "mechanical" },
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
				// Overflow (max_tokens) compaction: step_no is the truncated step, not this retry turn.
				await doCompactBookkeeping("max_tokens", lastTruncatedStepNo);
				return compactPiContext(messages);
			}
			const decision = checkLoopBudget(usage, input.budget);
			if (decision?.signal === "compact" && usage.totalTokens >= nextCompactionAtTokens && compactions < maxCompactions) {
				// Context-window compaction fires before the upcoming turn's model call; step_no is that
				// upcoming step (sinkStepNo was bumped by this turn's turn_start).
				await doCompactBookkeeping("context_window", sinkStepNo);
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
			// recordUsage mirrors loop.ts: right after the model turn's usage is added, BEFORE stepsUsed is
			// bumped (so the recorder sees the same usage snapshot — stepsUsed still reflects prior steps).
			input.recorder?.recordUsage?.(usage);
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
			// recordStep after the step is built + counted (mirrors loop.ts). Per step the recorder sees
			// usage(N) then step(N), with any compaction usage(C) slotting in before the step it compacts
			// for (that recordUsage lives in tryGenerateStructuredSummary).
			await input.recorder?.recordStep(step);

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
					lastTruncatedStepNo = step.index; // the overflow compaction emit carries this step's index
					return false;
				}
				escalation = {
					resultReason: "compact_required",
					handoffReason: "模型响应被截断且压缩次数已用尽。",
					budgetHit: "tokens",
					control: "compact",
					compactRequiredStepNo: step.index,
				};
				return true;
			}
			return false;
		},
	};

	// P3a: adapt the pi AgentEvent stream into WorkHub's per-step emit calls, in loop.ts's exact schema
	// and field names, so the SSE frontend + trace recorder cannot tell which engine ran. Mapping:
	//   message_update      → agentRunStep(kind:"stream_event")   incremental, throttled like loop.ts
	//   message_end (asst)  → agentRunStep(kind: thinking|text|tool_call)   loop.ts emitAssistantTrace
	//   tool_execution_end  → stepToolResult(tool_id/ok/is_error)  per tool
	//   turn_end            → stepSnapshot (first snapshotId) then agentRunStep(control)  step summary
	// Lifecycle events (started/compacting/escalated/failed) stay on the config/finalizeL3 side, so there
	// is no double emit. Error/aborted turns are skipped (loop.ts throws before emitting their trace).
	const isTerminalErrorTurn = (message: AgentMessage): boolean =>
		isAssistant(message) && (message.stopReason === "error" || message.stopReason === "aborted");

	const emitAssistantTrace = async (message: AssistantMessage): Promise<void> => {
		for (const block of piAssistantContentToBlocks(message.content)) {
			if (block.type === "thinking") {
				await input.emit?.({
					type: eventTypes.agentRunStep,
					previewText: block.text.slice(0, 200),
					data: { run_id: input.runId, step_no: sinkStepNo, kind: "thinking" },
				});
			} else if (block.type === "text") {
				await input.emit?.({
					type: eventTypes.agentRunStep,
					previewText: block.text.slice(0, 200),
					data: { run_id: input.runId, step_no: sinkStepNo, kind: "text" },
				});
			} else if (block.type === "tool_use") {
				const inputPreview = previewUnknown(block.input);
				await input.emit?.({
					type: eventTypes.agentRunStep,
					previewText: `${block.name} ${inputPreview}`.slice(0, 200),
					data: { run_id: input.runId, step_no: sinkStepNo, kind: "tool_call", tool_id: block.name, input_preview: inputPreview },
				});
			}
		}
	};

	const emitSink: AgentEventSink = async (event: AgentEvent): Promise<void> => {
		switch (event.type) {
			case "turn_start":
				sinkStepNo += 1;
				lastStreamEmitAt = 0; // reset per-step throttle (loop.ts callModel resets lastStreamEmitAt)
				return;
			case "message_update": {
				const at = Date.now();
				if (at - lastStreamEmitAt < STREAM_EMIT_THROTTLE_MS) return;
				lastStreamEmitAt = at;
				await input.emit?.({
					type: eventTypes.agentRunStep,
					previewText: previewPiStreamEvent(event.assistantMessageEvent),
					data: {
						run_id: input.runId,
						step_no: sinkStepNo,
						kind: "stream_event",
						provider_event_type: piStreamEventType(event.assistantMessageEvent.type),
					},
				});
				return;
			}
			case "message_end":
				if (isAssistant(event.message) && !isTerminalErrorTurn(event.message)) await emitAssistantTrace(event.message);
				return;
			case "tool_execution_end": {
				const workhub = extractWorkhubToolResult(event.result?.details);
				const content = workhub ? workhub.content : piToolResultText(event.result);
				const ok = workhub ? workhub.ok : !event.isError;
				await input.emit?.({
					type: eventTypes.stepToolResult,
					previewText: content.slice(0, 200),
					data: { run_id: input.runId, step_no: sinkStepNo, tool_id: event.toolName, ok, is_error: event.isError },
				});
				return;
			}
			case "turn_end": {
				if (isTerminalErrorTurn(event.message)) return; // loop.ts throws before the step summary
				const results = (event.toolResults as ToolResultMessage[]).map(toolResultFromMessage);
				const snapshotId = results.find((result) => result.snapshotId)?.snapshotId;
				if (snapshotId) {
					await input.emit?.({
						type: eventTypes.stepSnapshot,
						previewText: "Snapshot captured",
						data: { run_id: input.runId, step_no: sinkStepNo, snapshot_id: snapshotId },
					});
				}
				if (isAssistant(event.message)) {
					const blocks = piAssistantContentToBlocks(event.message.content);
					await input.emit?.({
						type: eventTypes.agentRunStep,
						previewText: textFromBlocks(blocks).slice(0, 200),
						data: {
							run_id: input.runId,
							step_no: sinkStepNo,
							control: controlFromAssistant(blocks, toWorkhubStopReason(event.message.stopReason)),
						},
					});
				}
				return;
			}
			default:
				return;
		}
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
		emitSink,
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
		// compact_required (text-only max_tokens with compaction budget spent) emits agentRunCompacting
		// with the truncated step's index — mirroring loop.ts, which does NOT emit agentRunEscalated for
		// this path. Every other escalation (doom/budget/compact_budget_exhausted) emits agentRunEscalated.
		if (escalation.compactRequiredStepNo !== undefined) {
			await input.emit?.({
				type: eventTypes.agentRunCompacting,
				previewText: escalation.handoffReason,
				data: { run_id: input.runId, step_no: escalation.compactRequiredStepNo, handoff },
			});
		} else {
			await input.emit?.({
				type: eventTypes.agentRunEscalated,
				previewText: escalation.handoffReason,
				data: { run_id: input.runId, handoff },
			});
		}
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
