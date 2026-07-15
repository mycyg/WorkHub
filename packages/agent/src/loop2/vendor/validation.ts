/**
 * Tool-argument validation seam for the vendored agent loop.
 *
 * pi's `validateToolArguments` (`reference-pi/packages/ai/src/utils/validation.ts`)
 * compiles the tool's typebox `TSchema` and coerces/validates arguments against it.
 * WorkHub does not adopt typebox, so this vendor ships a JSON-schema-free stub that
 * simply passes the arguments through (deep-cloned so the loop cannot mutate the
 * assistant message's tool-call block).
 *
 * The stub is injectable: Phase 1's tool wrapper will replace it with a zod-backed
 * validator via `setToolArgumentValidator`, and the agent loop keeps calling the
 * exported `validateToolArguments` binding unchanged. Throwing from a validator
 * surfaces as an immediate error tool result inside the loop's `prepareToolCall`.
 */

import type { Tool, ToolCall } from "./ai-types.js";

export type ToolArgumentValidator = (tool: Tool, toolCall: ToolCall) => unknown;

/**
 * Phase 0 default: pass the raw arguments through, deep-cloned. No schema is
 * consulted. Callers that need real validation inject their own validator.
 */
function passthroughValidator(_tool: Tool, toolCall: ToolCall): unknown {
	return structuredClone(toolCall.arguments);
}

let activeValidator: ToolArgumentValidator = passthroughValidator;

/**
 * Replace the active tool-argument validator. Pass `null` to restore the built-in
 * passthrough stub. Intended for Phase 1 (zod delegation) and for tests that need
 * to exercise the loop's validation-failure branch.
 */
export function setToolArgumentValidator(validator: ToolArgumentValidator | null): void {
	activeValidator = validator ?? passthroughValidator;
}

/**
 * Validate (or, in the Phase 0 stub, pass through) tool call arguments. Returns the
 * validated arguments; throws to signal a validation failure.
 */
export function validateToolArguments(tool: Tool, toolCall: ToolCall): unknown {
	return activeValidator(tool, toolCall);
}
