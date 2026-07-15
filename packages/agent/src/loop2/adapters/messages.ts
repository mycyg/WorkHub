/**
 * loop2 Phase 1 — Adapter 2: message conversion.
 *
 * Bridges WorkHub's wire-format `LlmMessage` (Anthropic-shaped: `role` +
 * `content` as a string or a block array) and pi's `Message` union
 * (`UserMessage` / `AssistantMessage` / `ToolResultMessage`).
 *
 * Two structural mismatches drive the design:
 *
 *  1. **tool results.** WorkHub carries every tool result as a `tool_result`
 *     block inside a single `user` message (Anthropic wire convention, see
 *     `loop/loop.ts` where it pushes `{ role: "user", content: [{ type:
 *     "tool_result", tool_use_id, content, is_error }] }`). pi models each tool
 *     result as its own `ToolResultMessage` carrying `toolCallId` + `toolName`.
 *     The `toolName` is NOT present on the WorkHub `tool_result` block, so the
 *     list-level converter resolves it from the id→name map built out of the
 *     preceding assistant `tool_use` blocks. The reverse direction re-collapses
 *     consecutive `ToolResultMessage`s back into one `user` message.
 *
 *  2. **assistant metadata.** A WorkHub `LlmMessage` only has `role` + `content`;
 *     pi's `AssistantMessage` additionally requires `api`/`provider`/`model`/
 *     `usage`/`stopReason`/`timestamp`. When converting WorkHub→pi we synthesize
 *     conservative placeholders for those (documented on the helper). This
 *     direction is used to *seed* a transcript; the authoritative assistant
 *     metadata is produced by the streamFn adapter from a live provider call.
 *
 * Both directions are total (never throw) so they can run inside the loop's
 * `convertToLlm`, which contractually must not reject.
 */

import type { LlmMessage } from "../../providers/types.js";
import type {
	AssistantMessage,
	ImageContent,
	Message,
	TextContent,
	ThinkingContent,
	ToolCall,
	ToolResultMessage,
	UserMessage,
} from "../index.js";

// --- primitive coercion ---------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function zeroUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

// --- content block mapping ------------------------------------------------

/**
 * WorkHub assistant content (Anthropic block array or bare string) → pi
 * assistant content blocks. Recognizes `text`, `thinking`/`redacted_thinking`,
 * and `tool_use`. `tool_use.input` is passed through unchanged, including the
 * degenerate string form that a `max_tokens`-truncated stream leaves behind
 * (the pi loop's `stopReason === "length"` path fails such calls without ever
 * inspecting the argument shape). Blocks pi cannot represent are dropped.
 */
export function workhubAssistantContentToPi(content: unknown): (TextContent | ThinkingContent | ToolCall)[] {
	if (typeof content === "string") {
		return content.length > 0 ? [{ type: "text", text: content }] : [];
	}
	if (!Array.isArray(content)) {
		return [];
	}
	const blocks: (TextContent | ThinkingContent | ToolCall)[] = [];
	for (const raw of content) {
		const block = asRecord(raw);
		if (!block) continue;
		if (block.type === "text" && typeof block.text === "string") {
			blocks.push({ type: "text", text: block.text });
		} else if (block.type === "thinking") {
			const thinking: ThinkingContent = { type: "thinking", thinking: asString(block.thinking) };
			if (typeof block.signature === "string") thinking.thinkingSignature = block.signature;
			blocks.push(thinking);
		} else if (block.type === "redacted_thinking") {
			blocks.push({ type: "thinking", thinking: "", redacted: true });
		} else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
			blocks.push({
				type: "toolCall",
				id: block.id,
				name: block.name,
				// Pass input through verbatim (object, or truncated partial-JSON string).
				arguments: block.input as Record<string, unknown> as Record<string, never>,
			});
		}
	}
	return blocks;
}

/** pi assistant content blocks → WorkHub Anthropic block array. */
export function piAssistantContentToWorkhub(content: (TextContent | ThinkingContent | ToolCall)[]): unknown[] {
	return content.map((block) => {
		if (block.type === "text") {
			return { type: "text", text: block.text };
		}
		if (block.type === "thinking") {
			if (block.redacted) {
				return { type: "redacted_thinking", data: "" };
			}
			const out: Record<string, unknown> = { type: "thinking", thinking: block.thinking };
			if (block.thinkingSignature) out.signature = block.thinkingSignature;
			return out;
		}
		// toolCall
		return { type: "tool_use", id: block.id, name: block.name, input: block.arguments };
	});
}

/** WorkHub user content (string or text/image block array) → pi user content. */
function workhubUserContentToPi(content: unknown): string | (TextContent | ImageContent)[] {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const blocks: (TextContent | ImageContent)[] = [];
	for (const raw of content) {
		const block = asRecord(raw);
		if (!block) continue;
		if (block.type === "text" && typeof block.text === "string") {
			blocks.push({ type: "text", text: block.text });
		} else if (block.type === "image") {
			const source = asRecord(block.source);
			if (source) {
				blocks.push({ type: "image", data: asString(source.data), mimeType: asString(source.media_type) });
			}
		}
	}
	return blocks;
}

/** pi user content → WorkHub Anthropic user content (keeps strings as strings). */
function piUserContentToWorkhub(content: string | (TextContent | ImageContent)[]): unknown {
	if (typeof content === "string") return content;
	return content.map((block) =>
		block.type === "text"
			? { type: "text", text: block.text }
			: { type: "image", source: { type: "base64", media_type: block.mimeType, data: block.data } },
	);
}

/** WorkHub `tool_result` block content (string or block array) → pi content blocks. */
function toolResultContentToPi(content: unknown): (TextContent | ImageContent)[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	if (!Array.isArray(content)) return [];
	const blocks: (TextContent | ImageContent)[] = [];
	for (const raw of content) {
		const block = asRecord(raw);
		if (!block) continue;
		if (block.type === "text" && typeof block.text === "string") {
			blocks.push({ type: "text", text: block.text });
		} else if (block.type === "image") {
			const source = asRecord(block.source);
			if (source) blocks.push({ type: "image", data: asString(source.data), mimeType: asString(source.media_type) });
		}
	}
	return blocks;
}

/**
 * pi `ToolResultMessage.content` → WorkHub `tool_result` block content. Uses a
 * plain string when the content is entirely text (the overwhelmingly common
 * case, and what `loop/loop.ts` writes to the wire); falls back to an Anthropic
 * block array when an image is present.
 */
function piToolResultContentToWire(content: (TextContent | ImageContent)[]): string | unknown[] {
	if (content.every((block) => block.type === "text")) {
		return content.map((block) => (block as TextContent).text).join("\n");
	}
	return content.map((block) =>
		block.type === "text"
			? { type: "text", text: block.text }
			: { type: "image", source: { type: "base64", media_type: block.mimeType, data: block.data } },
	);
}

// --- list-level converters ------------------------------------------------

function buildToolNameMap(messages: LlmMessage[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const message of messages) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const raw of message.content) {
			const block = asRecord(raw);
			if (block?.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
				map.set(block.id, block.name);
			}
		}
	}
	return map;
}

/**
 * WorkHub `LlmMessage[]` → pi `Message[]`.
 *
 * - `assistant` messages become `AssistantMessage`s with synthesized metadata
 *   (empty api/provider/model, zero usage, `stop` stopReason). These fields are
 *   absent from the WorkHub wire message; a caller that seeds a transcript this
 *   way and then continues the run gets authoritative metadata from the next
 *   live turn.
 * - `user` messages carrying `tool_result` blocks are split: each `tool_result`
 *   becomes a `ToolResultMessage` (its `toolName` resolved from the id→name map),
 *   and any interleaved text/image blocks are flushed as `UserMessage`s in place.
 * - `tool` role is treated as a tool-result carrier; `system` is mapped to a
 *   `UserMessage` (a stray transcript `system` message is not expected — the
 *   system prompt travels via `Context.systemPrompt`).
 */
export function workhubMessagesToPi(messages: LlmMessage[]): Message[] {
	const toolNames = buildToolNameMap(messages);
	const out: Message[] = [];

	for (const message of messages) {
		if (message.role === "assistant") {
			out.push({
				role: "assistant",
				content: workhubAssistantContentToPi(message.content),
				api: "",
				provider: "",
				model: "",
				usage: zeroUsage(),
				stopReason: "stop",
				timestamp: Date.now(),
			});
			continue;
		}

		if (message.role === "tool") {
			pushToolResults(out, message.content, toolNames);
			continue;
		}

		// user / system
		if (Array.isArray(message.content) && message.content.some((raw) => asRecord(raw)?.type === "tool_result")) {
			let pending: (TextContent | ImageContent)[] = [];
			const flushPending = () => {
				if (pending.length > 0) {
					out.push({ role: "user", content: pending, timestamp: Date.now() });
					pending = [];
				}
			};
			for (const raw of message.content) {
				const block = asRecord(raw);
				if (block?.type === "tool_result") {
					flushPending();
					out.push(toolResultMessageFromBlock(block, toolNames));
				} else if (block?.type === "text" && typeof block.text === "string") {
					pending.push({ type: "text", text: block.text });
				} else if (block?.type === "image") {
					const source = asRecord(block.source);
					if (source) pending.push({ type: "image", data: asString(source.data), mimeType: asString(source.media_type) });
				}
			}
			flushPending();
			continue;
		}

		out.push({ role: "user", content: workhubUserContentToPi(message.content), timestamp: Date.now() });
	}

	return out;
}

function toolResultMessageFromBlock(block: Record<string, unknown>, toolNames: Map<string, string>): ToolResultMessage {
	const toolCallId = asString(block.tool_use_id);
	return {
		role: "toolResult",
		toolCallId,
		toolName: toolNames.get(toolCallId) ?? "",
		content: toolResultContentToPi(block.content),
		isError: block.is_error === true,
		timestamp: Date.now(),
	};
}

function pushToolResults(out: Message[], content: unknown, toolNames: Map<string, string>): void {
	if (Array.isArray(content)) {
		for (const raw of content) {
			const block = asRecord(raw);
			if (block?.type === "tool_result") out.push(toolResultMessageFromBlock(block, toolNames));
		}
		return;
	}
	// bare string tool payload with no id to pair — best effort.
	out.push({
		role: "toolResult",
		toolCallId: "",
		toolName: "",
		content: [{ type: "text", text: asString(content) }],
		isError: false,
		timestamp: Date.now(),
	});
}

/**
 * pi `Message[]` → WorkHub `LlmMessage[]`. Consecutive `ToolResultMessage`s are
 * collapsed into one `user` message whose content is an array of `tool_result`
 * blocks (Anthropic requires all tool results for one assistant turn to live in
 * a single following user message).
 */
export function piMessagesToWorkhub(messages: Message[]): LlmMessage[] {
	const out: LlmMessage[] = [];
	let pendingToolResults: unknown[] = [];

	const flushToolResults = () => {
		if (pendingToolResults.length > 0) {
			out.push({ role: "user", content: pendingToolResults });
			pendingToolResults = [];
		}
	};

	for (const message of messages) {
		if (message.role === "toolResult") {
			pendingToolResults.push({
				type: "tool_result",
				tool_use_id: message.toolCallId,
				content: piToolResultContentToWire(message.content),
				is_error: message.isError,
			});
			continue;
		}
		flushToolResults();
		if (message.role === "assistant") {
			out.push({ role: "assistant", content: piAssistantContentToWorkhub(message.content) });
		} else {
			out.push({ role: "user", content: piUserContentToWorkhub(message.content) });
		}
	}
	flushToolResults();

	return out;
}

/** Convenience single-message converter (tool-result pairing needs list context). */
export function piMessageToWorkhub(message: Exclude<Message, ToolResultMessage>): LlmMessage {
	return message.role === "assistant"
		? { role: "assistant", content: piAssistantContentToWorkhub(message.content) }
		: { role: "user", content: piUserContentToWorkhub((message as UserMessage).content) };
}

/** Type guard used by the result adapter to detect assistant messages. */
export function isAssistantMessage(message: Message): message is AssistantMessage {
	return message.role === "assistant";
}
