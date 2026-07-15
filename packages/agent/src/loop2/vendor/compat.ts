/**
 * Vendor compatibility barrel mirroring the slice of `@earendil-works/pi-ai/compat`
 * that pi's `agent-loop.ts` imports:
 *
 *   import { AssistantMessage, Context, EventStream, streamSimple,
 *            ToolResultMessage, validateToolArguments } from "@earendil-works/pi-ai/compat";
 *
 * Phase 0 provides only the minimal closure the loop needs. The `streamSimple`
 * default is a stub: the loop uses `streamFn || streamSimple`, and every Phase 0
 * caller (and every test) injects an explicit `streamFn`, so the default is never
 * reached. Phase 1 replaces it with the real provider-backed adapter.
 */

export type { AssistantMessage, Context, ToolResultMessage } from "./ai-types.js";
export { EventStream } from "./event-stream.js";
export { setToolArgumentValidator, validateToolArguments } from "./validation.js";

import type { Api, Context as LlmContext, Model, SimpleStreamOptions } from "./ai-types.js";
import { AssistantMessageEventStream } from "./event-stream.js";

/**
 * Phase 0 placeholder for the default stream function. Never invoked while callers
 * inject their own `streamFn`; throws with a clear message if the default path is
 * ever hit so a missing adapter fails loudly instead of silently.
 */
export function streamSimple(
	_model: Model<Api>,
	_context: LlmContext,
	_options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	throw new Error(
		"loop2 vendor (Phase 0): no default stream function is bundled. Pass an explicit streamFn to agentLoop/runAgentLoop.",
	);
}
