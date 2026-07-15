/**
 * Minimal closure of the `@earendil-works/pi-ai` message/model type surface that
 * the vendored agent loop (`agent-loop.ts`) and its config contract (`types.ts`)
 * depend on. Extracted near-verbatim from `reference-pi/packages/ai/src/types.ts`
 * (MIT, commit dcfe36c7); see ../NOTICE.md for the full provenance and the list
 * of deliberate reductions.
 *
 * WorkHub does not adopt typebox: pi's `Tool.parameters` (`TSchema`) is collapsed
 * to a plain JSON Schema object shape here, and downstream tool argument typing
 * becomes `Record<string, unknown>`. Real schema validation is delegated to zod
 * in the Phase 1 tool wrapper, not in this vendor layer.
 */

/**
 * Provider API identifier. pi enumerates a `KnownApi` union; the loop only ever
 * treats this as an opaque string, so the vendor collapses it to `string`.
 */
export type Api = string;

/**
 * Provider identifier. pi enumerates a `KnownProvider` union; the loop only ever
 * passes it to `getApiKey(provider)` as an opaque string, so the vendor collapses
 * it to `string`.
 */
export type ProviderId = string;

/**
 * Thinking/reasoning level for models that support it. Note the pi-ai variant has
 * no `"off"` member; the agent-level `ThinkingLevel` in `./types.ts` adds `"off"`.
 */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ModelThinkingLevel = "off" | ThinkingLevel;
export type ThinkingLevelMap = Partial<Record<ModelThinkingLevel, string | null>>;

/** Token budgets for each thinking level (token-based providers only). */
export interface ThinkingBudgets {
	minimal?: number;
	low?: number;
	medium?: number;
	high?: number;
}

export type CacheRetention = "none" | "short" | "long";
export type Transport = "sse" | "websocket" | "websocket-cached" | "auto";
export type ProviderEnv = Record<string, string>;
export type ProviderHeaders = Record<string, string | null>;

export interface ProviderResponse {
	status: number;
	headers: Record<string, string>;
}

/**
 * Base stream options shared by all providers. Trimmed to the subset the loop and
 * its config contract reference; provider-implementation callbacks
 * (`onPayload`/`onResponse`/websocket knobs) are dropped from the vendor closure.
 *
 * `apiKey` and `signal` are widened to include `undefined` (vs pi's exact optional)
 * so the loop can pass a resolved-or-undefined key and the abort signal through
 * under WorkHub's `exactOptionalPropertyTypes`.
 */
export interface StreamOptions {
	temperature?: number;
	maxTokens?: number;
	signal?: AbortSignal | undefined;
	apiKey?: string | undefined;
	transport?: Transport;
	cacheRetention?: CacheRetention;
	sessionId?: string;
	headers?: ProviderHeaders;
	timeoutMs?: number;
	maxRetries?: number;
	metadata?: Record<string, unknown>;
	env?: ProviderEnv;
}

/** Unified options passed to streamSimple(): base options plus reasoning. */
export interface SimpleStreamOptions extends StreamOptions {
	/** Widened to include `undefined` so the loop can clear reasoning for a next turn. */
	reasoning?: ThinkingLevel | undefined;
	/** Custom token budgets for thinking levels (token-based providers only). */
	thinkingBudgets?: ThinkingBudgets;
}

export interface TextContent {
	type: "text";
	text: string;
	textSignature?: string;
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	thinkingSignature?: string;
	/** When true, the thinking content was redacted by safety filters. */
	redacted?: boolean;
}

export interface ImageContent {
	type: "image";
	data: string; // base64 encoded image data
	mimeType: string; // e.g., "image/jpeg", "image/png"
}

export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, any>;
	thoughtSignature?: string; // Google-specific: opaque signature for reusing thought context
}

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Subset of `cacheWrite` written with 1h retention. Only Anthropic reports this split. */
	cacheWrite1h?: number;
	/** Reasoning/thinking tokens, when the provider reports them. Subset of `output`. */
	reasoning?: number;
	totalTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	timestamp: number; // Unix timestamp in milliseconds
}

export interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ThinkingContent | ToolCall)[];
	api: Api;
	provider: ProviderId;
	model: string;
	responseModel?: string;
	responseId?: string;
	/** Redacted provider/runtime diagnostics. Typed opaquely in the vendor closure. */
	diagnostics?: unknown[];
	usage: Usage;
	stopReason: StopReason;
	errorMessage?: string;
	timestamp: number; // Unix timestamp in milliseconds
}

export interface ToolResultMessage<TDetails = any> {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[]; // Supports text and images
	details?: TDetails;
	/** Names from `Context.tools` that became available after this result. */
	addedToolNames?: string[];
	isError: boolean;
	timestamp: number; // Unix timestamp in milliseconds
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

/**
 * JSON Schema object shape. Replaces pi's typebox `TSchema` as the type of
 * `Tool.parameters` in the WorkHub vendor.
 */
export type JsonSchema = Record<string, unknown>;

export interface Tool<TParameters extends JsonSchema = JsonSchema> {
	name: string;
	description: string;
	parameters: TParameters;
}

export interface Context {
	systemPrompt?: string;
	messages: Message[];
	/** Widened to include `undefined` for WorkHub's `exactOptionalPropertyTypes`. */
	tools?: Tool[] | undefined;
}

/**
 * Event protocol for AssistantMessageEventStream.
 *
 * Streams emit `start` before partial updates, then terminate with either `done`
 * (final successful AssistantMessage) or `error` (final AssistantMessage with
 * stopReason "error"/"aborted").
 */
export type AssistantMessageEvent =
	| { type: "start"; partial: AssistantMessage }
	| { type: "text_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
	| { type: "done"; reason: Extract<StopReason, "stop" | "length" | "toolUse">; message: AssistantMessage }
	| { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };

export interface ModelCostRates {
	input: number; // $/million tokens
	output: number; // $/million tokens
	cacheRead: number; // $/million tokens
	cacheWrite: number; // $/million tokens
}

export interface ModelCostTier extends ModelCostRates {
	/** Use this tier for requests whose total input usage exceeds this token count. */
	inputTokensAbove: number;
}

export interface ModelCost extends ModelCostRates {
	/** Request-wide pricing tiers. The highest matching input threshold applies to the full request. */
	tiers?: ModelCostTier[];
}

/**
 * Model interface for the unified model system. pi's per-API `compat` union is
 * collapsed to `unknown` here: the loop never inspects it, only `model.api`,
 * `model.provider`, and `model.id`. A default type parameter (`= Api`) is added
 * for call-site convenience.
 */
export interface Model<TApi extends Api = Api> {
	id: string;
	name: string;
	api: TApi;
	provider: ProviderId;
	baseUrl: string;
	reasoning: boolean;
	thinkingLevelMap?: ThinkingLevelMap;
	input: ("text" | "image")[];
	cost: ModelCost;
	contextWindow: number;
	maxTokens: number;
	headers?: Record<string, string>;
	compat?: unknown;
}

// Re-export the stream class type so `./types.ts` can pull the whole ai closure
// (types + stream) from a single vendor module.
export type { AssistantMessageEventStream } from "./event-stream.js";

import type { AssistantMessageEventStream as AssistantMessageEventStreamType } from "./event-stream.js";

/**
 * Generic StreamFunction with typed options.
 *
 * Contract:
 * - Must return an AssistantMessageEventStream.
 * - Once invoked, request/model/runtime failures should be encoded in the
 *   returned stream, not thrown.
 * - Error termination must produce an AssistantMessage with stopReason
 *   "error" or "aborted" and errorMessage, emitted via the stream protocol.
 */
export type StreamFunction<TApi extends Api = Api, TOptions extends StreamOptions = StreamOptions> = (
	model: Model<TApi>,
	context: Context,
	options?: TOptions,
) => AssistantMessageEventStreamType;
