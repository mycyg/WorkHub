/**
 * loop2 Phase 1 — Adapter 3: tool wrapper.
 *
 * Turns a WorkHub `ToolRegistry` (zod-schema tools with snapshot / side-effect
 * gating) into pi `AgentTool[]`.
 *
 *  - **parameters** reuse the registry's existing zod→JSONSchema projection via
 *    `registry.toModelTools(ctx)` (same shape the production loop already feeds
 *    the model), so there is a single source of truth for the schema surface.
 *
 *  - **execute** delegates to `registry.execute`, which internally runs the zod
 *    `safeParse`, the snapshot gate, and the side-effect guard. Because that path
 *    is *return-based* (it returns an `errorToolResult` instead of throwing) and
 *    carries structured fields (`snapshotId`, `data`, `isError`), the wrapper does
 *    NOT throw on error — throwing would route through the loop's
 *    `createErrorToolResult` and discard `snapshotId`/`data`. Instead the full
 *    WorkHub `ToolResult` is stashed on `AgentToolResult.details`, giving the
 *    result adapter a lossless reconstruction (including `isError` and the
 *    reversibility `snapshotId` the confidence scorer reads).
 *
 *  - **isError propagation.** pi's `AgentToolResult` has no `isError` field; pi
 *    surfaces tool errors via the loop's throw→`isError:true` path. To keep pi's
 *    `ToolResultMessage.isError` in lockstep with WorkHub's without losing data,
 *    this module exports {@link workhubAfterToolCall}: an `afterToolCall` hook
 *    that reads the stashed `ToolResult` and returns `{ isError }`. The Phase 2
 *    config builder wires it in one line. (Kept out of `execute` on purpose —
 *    `execute` cannot set a per-result error flag in pi's model.)
 *
 *  - **No `setToolArgumentValidator` injection.** `registry.execute` already runs
 *    `schema.safeParse` and returns a schema-mismatch `errorToolResult` *before*
 *    the snapshot gate, matching WorkHub semantics exactly. Injecting a second
 *    (zod) validator into the loop's pre-execute `validateToolArguments` seam
 *    would double-validate and could double-report; the Phase 0 passthrough stub
 *    is left in place.
 */

import type { ToolExecutionContext, ToolRegistry, ToolResult } from "@workhub/tools";

import type { AgentLoopConfig, AgentTool, AgentToolResult, JsonSchema } from "../index.js";

/** `AgentToolResult.details` payload: the untouched WorkHub `ToolResult`. */
export type WorkhubToolDetails = ToolResult;

function isWorkhubToolResult(value: unknown): value is ToolResult {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return typeof record.ok === "boolean" && typeof record.isError === "boolean" && typeof record.content === "string";
}

/** Recover the stashed WorkHub `ToolResult` from a pi tool-result `details`, if present. */
export function extractWorkhubToolResult(details: unknown): ToolResult | undefined {
	return isWorkhubToolResult(details) ? details : undefined;
}

/** WorkHub `ToolResult` → pi `AgentToolResult` (content mapped, full result stashed). */
export function workhubToolResultToPi(result: ToolResult): AgentToolResult<ToolResult> {
	return {
		content: [{ type: "text", text: result.content }],
		details: result,
	};
}

/**
 * Build pi `AgentTool[]` from a WorkHub `ToolRegistry` for a given execution
 * context. Visibility (`canUse`), the zod→JSONSchema projection, snapshot gating,
 * and side-effect enforcement all remain inside `registry`.
 */
export async function workhubToolsToPi(registry: ToolRegistry, ctx: ToolExecutionContext): Promise<AgentTool[]> {
	const modelTools = await registry.toModelTools(ctx);
	return modelTools.map((tool) => {
		const parameters: JsonSchema =
			tool.input_schema && typeof tool.input_schema === "object"
				? (tool.input_schema as JsonSchema)
				: { type: "object" };
		return {
			name: tool.name,
			description: tool.description,
			parameters,
			label: tool.name,
			// Note: WorkHub `registry.execute` does not accept an AbortSignal, so an
			// in-flight tool is not interrupted mid-execution; the loop still honors
			// the signal at the call boundaries. WorkHub tools are short file/IO ops.
			execute: async (_toolCallId, params) => {
				const result = await registry.execute(tool.name, params, ctx);
				return workhubToolResultToPi(result);
			},
		} satisfies AgentTool;
	});
}

/**
 * `afterToolCall` hook that propagates the stashed WorkHub `ToolResult.isError`
 * to pi's `ToolResultMessage.isError`. Returns `undefined` for results this
 * wrapper did not produce (e.g. a `beforeToolCall` block, or a tool-not-found
 * error created by the loop), leaving their loop-derived error flag untouched.
 */
export const workhubAfterToolCall: NonNullable<AgentLoopConfig["afterToolCall"]> = async ({ result }) => {
	const workhub = extractWorkhubToolResult(result.details);
	if (!workhub) return undefined;
	return { isError: workhub.isError };
};
