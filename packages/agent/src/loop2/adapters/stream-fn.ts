/**
 * loop2 Phase 1 — Adapter 1: provider `streamFn`.
 *
 * Wraps a WorkHub provider client (`MeasuredLlmClient`-shaped: `messages.create`
 * / `messages.stream` taking `LlmCreateParams`, see `providers/measured-client.ts`)
 * into the pi loop's injectable `StreamFn`. The returned stream follows pi's
 * `AssistantMessageEventStream` protocol: a `start`, optional incremental deltas,
 * then a terminal `done` (success) or `error` (failure/abort).
 *
 * Design notes / trade-offs:
 *
 *  - **Never throws.** The `StreamFn` contract requires request/model/runtime
 *    failures to be encoded in the returned stream, not thrown. The async pump is
 *    fully wrapped; any error becomes an `error` event with an `AssistantMessage`
 *    whose `stopReason` is `"aborted"` (when the signal fired) or `"error"`.
 *
 *  - **stopReason normalization** (WorkHub → pi):
 *      end_turn      → stop
 *      max_tokens    → length
 *      tool_use      → toolUse
 *      (absent)      → toolUse if the message carries tool calls, else stop
 *      anything else → toolUse if tool calls present, else stop  (e.g. stop_sequence)
 *    Error/abort stopReasons are produced only on the failure path, never mapped
 *    from a provider `stop_reason`.
 *
 *  - **Usage side-channel.** pi's `Usage` has no notion of CNY cost; WorkHub's
 *    money accounting lives on `usageRecord.estimatedCostCny`. Rather than pollute
 *    the vendored `Usage` type, the WorkHub usage/cost is attached to the final
 *    `AssistantMessage` via a module-level `WeakMap` keyed on the message object
 *    (`attachWorkhubUsage`/`readWorkhubUsage`). The pi loop preserves the exact
 *    final-message object identity end to end (it stores and returns the object
 *    produced for the `done` event without cloning it — only `message_start` /
 *    `message_update` spread partials), so the result adapter can recover the CNY
 *    cost from the same object it reads out of the returned transcript. Trade-off:
 *    a WeakMap needs object identity to survive; verified above against the vendor
 *    loop. pi's `Usage.cost` (USD) is left at zero to avoid a misleading number.
 *
 *  - **Streaming vs buffered.** When the client exposes `messages.stream`, the
 *    pump iterates the Anthropic SSE events, maps them to pi delta events for the
 *    UI path, then calls `getFinalMessage()` — which is where `MeasuredStream`
 *    records usage — and builds the authoritative final message from that result.
 *    When only `messages.create` exists it emits `start` + `done` off the buffered
 *    response (usage is recorded inside `create`). Partial (delta) messages are
 *    best-effort; the authoritative content always comes from the final response.
 */

import type { UsageRecord, UsageSource } from "@workhub/cost";

import type { LlmCreateParams, LlmCreateResponse, LlmStream, LlmStreamEvent } from "../../providers/types.js";
import {
	AssistantMessageEventStream,
	type AssistantMessage,
	type Context,
	type Model,
	type SimpleStreamOptions,
	type StopReason,
	type StreamFn,
	type TextContent,
	type ThinkingContent,
	type Tool,
	type ToolCall,
	type Usage,
} from "../index.js";
import { piMessagesToWorkhub, workhubAssistantContentToPi } from "./messages.js";

// --- usage side-channel ---------------------------------------------------

/** WorkHub usage/cost attached to a pi `AssistantMessage` out-of-band. */
export type WorkhubMessageUsage = {
	usageRecord?: UsageRecord;
	estimatedCostCny?: string;
	inputTokens: number;
	outputTokens: number;
};

const usageByMessage = new WeakMap<object, WorkhubMessageUsage>();

/** Attach WorkHub usage/cost to a message object (does not mutate the message). */
export function attachWorkhubUsage(message: object, usage: WorkhubMessageUsage): void {
	usageByMessage.set(message, usage);
}

/** Read the WorkHub usage/cost attached to a message object, if any. */
export function readWorkhubUsage(message: object): WorkhubMessageUsage | undefined {
	return usageByMessage.get(message);
}

// --- stopReason / usage mapping -------------------------------------------

/** WorkHub stop reason → pi `StopReason` (success path only). */
export function toPiStopReason(workhubStopReason: string | undefined, hasToolCalls: boolean): Extract<StopReason, "stop" | "length" | "toolUse"> {
	switch (workhubStopReason) {
		case "end_turn":
			return "stop";
		case "max_tokens":
			return "length";
		case "tool_use":
			return "toolUse";
		default:
			return hasToolCalls ? "toolUse" : "stop";
	}
}

function toPiUsage(usage: LlmCreateResponse["usage"]): Usage {
	const input = usage?.inputTokens ?? 0;
	const output = usage?.outputTokens ?? 0;
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		// WorkHub cost accounting is CNY and lives in the usage side-channel;
		// pi's USD cost is intentionally left at zero.
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

// --- final message assembly -----------------------------------------------

function buildAssistantMessage(model: Model, response: LlmCreateResponse): AssistantMessage {
	const content = workhubAssistantContentToPi(response.content);
	const hasToolCalls = content.some((block) => block.type === "toolCall");
	const message: AssistantMessage = {
		role: "assistant",
		content,
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: toPiUsage(response.usage),
		stopReason: toPiStopReason(response.stopReason, hasToolCalls),
		timestamp: Date.now(),
	};
	if (response.id) message.responseId = response.id;
	return message;
}

function attachIfCost(message: AssistantMessage, response: LlmCreateResponse): void {
	if (!response.usage && !response.usageRecord) return;
	const usage: WorkhubMessageUsage = {
		inputTokens: response.usage?.inputTokens ?? 0,
		outputTokens: response.usage?.outputTokens ?? 0,
	};
	if (response.usageRecord) {
		usage.usageRecord = response.usageRecord;
		usage.estimatedCostCny = response.usageRecord.estimatedCostCny;
	}
	attachWorkhubUsage(message, usage);
}

function buildErrorMessage(model: Model, error: unknown, aborted: boolean): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: toPiUsage(undefined),
		stopReason: aborted ? "aborted" : "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

function doneReason(stopReason: StopReason): Extract<StopReason, "stop" | "length" | "toolUse"> {
	return stopReason === "length" ? "length" : stopReason === "toolUse" ? "toolUse" : "stop";
}

function isAbortLike(error: unknown): boolean {
	if (error instanceof Error) {
		return error.name === "AbortError" || error.name === "TimeoutError" || error.name === "llm_request_timeout";
	}
	return false;
}

// --- request building -----------------------------------------------------

/** A WorkHub provider client, as returned by `ProviderRegistry.get(...)`. */
export type ProviderStreamClient = {
	provider?: string;
	model?: string;
	messages: {
		create: (params: LlmCreateParams) => Promise<LlmCreateResponse>;
		stream?: (params: LlmCreateParams) => Promise<LlmStream>;
	};
};

export type CreateProviderStreamFnOptions = {
	/** WorkHub provider client (model/provider/actor/usageSink already bound). */
	client: ProviderStreamClient;
	/** Fallback max output tokens when the loop options / model do not specify one. */
	maxTokens?: number;
	/** Usage-record source attribution (defaults to the provider's own default). */
	source?: UsageSource;
	/**
	 * Per-call monotonic sequence for usage-record dedup (findings[19]). Defaults
	 * to an internal 1-based counter incremented once per provider request.
	 */
	nextSeq?: () => number | undefined;
	/** Use `messages.stream` when the client exposes it (default true). */
	streaming?: boolean;
};

function piToolsToWire(tools: Tool[] | undefined): unknown[] {
	return (tools ?? []).map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.parameters,
	}));
}

function buildParams(
	model: Model,
	context: Context,
	streamOptions: SimpleStreamOptions | undefined,
	options: CreateProviderStreamFnOptions,
	seq: number | undefined,
): LlmCreateParams {
	const params: LlmCreateParams = {
		model: model.id,
		maxTokens: streamOptions?.maxTokens ?? options.maxTokens ?? model.maxTokens ?? 4096,
		messages: piMessagesToWorkhub(context.messages),
	};
	if (context.systemPrompt) params.system = context.systemPrompt;
	const tools = piToolsToWire(context.tools);
	if (tools.length > 0) params.tools = tools;
	if (options.source) params.source = options.source;
	if (seq !== undefined) params.seq = seq;
	if (streamOptions?.signal) params.signal = streamOptions.signal;
	if (streamOptions?.timeoutMs !== undefined) params.timeoutMs = streamOptions.timeoutMs;
	return params;
}

// --- streaming increment mapping ------------------------------------------

function partialBase(model: Model): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: toPiUsage(undefined),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function numberOf(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

type PiBlock = TextContent | ThinkingContent | ToolCall;

/**
 * Map one Anthropic SSE event to pi delta events, maintaining a per-index block
 * map so each emitted `partial` snapshot is coherent. Best-effort: tool-call
 * arguments stay `{}` in partials (the authoritative object comes from the final
 * response); only text/thinking deltas accumulate.
 */
function mapStreamEvent(
	event: LlmStreamEvent,
	base: AssistantMessage,
	blocks: Map<number, PiBlock>,
	push: (piEvent: import("../index.js").AssistantMessageEvent) => void,
): void {
	const data = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : undefined;
	const snapshot = (): AssistantMessage => ({
		...base,
		content: [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block),
	});

	switch (event.type) {
		case "content_block_start": {
			const index = numberOf(data?.index);
			const cb = data?.content_block && typeof data.content_block === "object" ? (data.content_block as Record<string, unknown>) : undefined;
			if (index === undefined || !cb) return;
			if (cb.type === "text") {
				blocks.set(index, { type: "text", text: typeof cb.text === "string" ? cb.text : "" });
				push({ type: "text_start", contentIndex: index, partial: snapshot() });
			} else if (cb.type === "thinking" || cb.type === "redacted_thinking") {
				blocks.set(index, { type: "thinking", thinking: typeof cb.thinking === "string" ? cb.thinking : "" });
				push({ type: "thinking_start", contentIndex: index, partial: snapshot() });
			} else if (cb.type === "tool_use") {
				blocks.set(index, {
					type: "toolCall",
					id: typeof cb.id === "string" ? cb.id : "",
					name: typeof cb.name === "string" ? cb.name : "",
					arguments: {} as Record<string, never>,
				});
				push({ type: "toolcall_start", contentIndex: index, partial: snapshot() });
			}
			return;
		}
		case "content_block_delta": {
			const index = numberOf(data?.index);
			const delta = data?.delta && typeof data.delta === "object" ? (data.delta as Record<string, unknown>) : undefined;
			if (index === undefined || !delta) return;
			const block = blocks.get(index);
			if (!block) return;
			if (delta.type === "text_delta" && block.type === "text" && typeof delta.text === "string") {
				block.text += delta.text;
				push({ type: "text_delta", contentIndex: index, delta: delta.text, partial: snapshot() });
			} else if (delta.type === "thinking_delta" && block.type === "thinking" && typeof delta.thinking === "string") {
				block.thinking += delta.thinking;
				push({ type: "thinking_delta", contentIndex: index, delta: delta.thinking, partial: snapshot() });
			} else if (delta.type === "input_json_delta" && block.type === "toolCall" && typeof delta.partial_json === "string") {
				push({ type: "toolcall_delta", contentIndex: index, delta: delta.partial_json, partial: snapshot() });
			}
			return;
		}
		case "content_block_stop": {
			const index = numberOf(data?.index);
			if (index === undefined) return;
			const block = blocks.get(index);
			if (!block) return;
			if (block.type === "text") {
				push({ type: "text_end", contentIndex: index, content: block.text, partial: snapshot() });
			} else if (block.type === "thinking") {
				push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: snapshot() });
			} else {
				push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: snapshot() });
			}
			return;
		}
		default:
			// message_start / message_delta / message_stop / ping — usage and stop
			// reason are read authoritatively from getFinalMessage().
			return;
	}
}

// --- pump -----------------------------------------------------------------

async function pumpStreaming(
	stream: AssistantMessageEventStream,
	model: Model,
	params: LlmCreateParams,
	streamFn: NonNullable<ProviderStreamClient["messages"]["stream"]>,
): Promise<void> {
	const llmStream = await streamFn(params);
	const base = partialBase(model);
	const blocks = new Map<number, PiBlock>();
	stream.push({ type: "start", partial: { ...base, content: [] } });
	for await (const event of llmStream) {
		mapStreamEvent(event, base, blocks, (piEvent) => stream.push(piEvent));
	}
	const response = await llmStream.getFinalMessage();
	const finalMessage = buildAssistantMessage(model, response);
	attachIfCost(finalMessage, response);
	stream.push({ type: "done", reason: doneReason(finalMessage.stopReason), message: finalMessage });
}

async function pumpBuffered(
	stream: AssistantMessageEventStream,
	model: Model,
	params: LlmCreateParams,
	create: ProviderStreamClient["messages"]["create"],
): Promise<void> {
	const response = await create(params);
	const finalMessage = buildAssistantMessage(model, response);
	attachIfCost(finalMessage, response);
	stream.push({ type: "start", partial: { ...finalMessage, content: [] } });
	stream.push({ type: "done", reason: doneReason(finalMessage.stopReason), message: finalMessage });
}

async function pump(
	stream: AssistantMessageEventStream,
	model: Model,
	params: LlmCreateParams,
	options: CreateProviderStreamFnOptions,
	signal: AbortSignal | undefined,
): Promise<void> {
	try {
		const streamFn = options.client.messages.stream;
		if ((options.streaming ?? true) && typeof streamFn === "function") {
			await pumpStreaming(stream, model, params, streamFn.bind(options.client.messages));
		} else {
			await pumpBuffered(stream, model, params, options.client.messages.create.bind(options.client.messages));
		}
	} catch (error) {
		const aborted = Boolean(signal?.aborted) || isAbortLike(error);
		stream.push({ type: "error", reason: aborted ? "aborted" : "error", error: buildErrorMessage(model, error, aborted) });
	}
}

/**
 * Build a pi `StreamFn` backed by a WorkHub provider client. The returned
 * function synchronously returns an `AssistantMessageEventStream` and drives the
 * provider call on a detached async pump (matching how the vendored `agentLoop`
 * itself produces its event stream).
 */
export function createProviderStreamFn(options: CreateProviderStreamFnOptions): StreamFn {
	let seqCounter = 0;
	const resolveSeq =
		options.nextSeq ??
		(() => {
			seqCounter += 1;
			return seqCounter;
		});

	return (model, context, streamOptions) => {
		const stream = new AssistantMessageEventStream();
		const params = buildParams(model, context, streamOptions, options, resolveSeq());
		void pump(stream, model, params, options, streamOptions?.signal);
		return stream;
	};
}
