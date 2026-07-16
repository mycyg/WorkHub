import assert from "node:assert/strict";
import test from "node:test";

import {
	type AnyToolSpec,
	type SnapshotHook,
	type ToolExecutionContext,
	createToolRegistry,
	errorToolResult,
	okToolResult,
} from "@workhub/tools";
import { z } from "zod";

import { extractWorkhubToolResult, workhubAfterToolCall, workhubToolResultToPi, workhubToolsToPi } from "./tools.js";

const echoSpec: AnyToolSpec = {
	id: "echo",
	description: "Echo the message back to the caller.",
	schema: z.object({ message: z.string() }),
	sideEffect: "none",
	execute: (input: { message: string }) => okToolResult(`echo: ${input.message}`),
};

const writeSpec: AnyToolSpec = {
	id: "write_note",
	description: "Write a note (business_write side effect).",
	schema: z.object({ text: z.string() }),
	sideEffect: "business_write",
	execute: () => okToolResult("written", { snapshotId: "snap-from-tool" }),
};

const ctx: ToolExecutionContext = { workdir: "/tmp/workdir" };

// --- schema + description projection --------------------------------------

test("workhubToolsToPi projects zod schema to JSONSchema parameters", async () => {
	const registry = createToolRegistry([echoSpec]);
	const tools = await workhubToolsToPi(registry, ctx);
	assert.equal(tools.length, 1);
	const tool = tools[0];
	assert.equal(tool?.name, "echo");
	assert.equal(tool?.description, "Echo the message back to the caller.");
	assert.equal(tool?.label, "echo");
	const params = tool?.parameters as Record<string, unknown>;
	assert.equal(params.type, "object");
	assert.ok((params.properties as Record<string, unknown>)?.message, "message property present in schema");
});

// --- execute delegation + result mapping ----------------------------------

test("execute delegates to registry.execute and stashes the full ToolResult in details", async () => {
	const registry = createToolRegistry([echoSpec]);
	const [tool] = await workhubToolsToPi(registry, ctx);
	const result = await tool!.execute("call-1", { message: "hi" }, undefined, undefined);
	assert.deepEqual(result.content, [{ type: "text", text: "echo: hi" }]);
	const stashed = extractWorkhubToolResult(result.details);
	assert.ok(stashed, "the WorkHub ToolResult is recoverable from details");
	assert.equal(stashed?.isError, false);
	assert.equal(stashed?.content, "echo: hi");
});

test("a zod schema mismatch surfaces as an error ToolResult (validated inside registry.execute)", async () => {
	const registry = createToolRegistry([echoSpec]);
	const [tool] = await workhubToolsToPi(registry, ctx);
	const result = await tool!.execute("call-1", { message: 123 }, undefined, undefined);
	const stashed = extractWorkhubToolResult(result.details);
	assert.equal(stashed?.isError, true);
	assert.match(stashed?.content ?? "", /does not match schema/);
});

// --- snapshot gate is preserved -------------------------------------------

test("a side-effect tool without a snapshot gate fails before execution", async () => {
	const registry = createToolRegistry([writeSpec]);
	const [tool] = await workhubToolsToPi(registry, ctx);
	const result = await tool!.execute("call-1", { text: "note" }, undefined, undefined);
	const stashed = extractWorkhubToolResult(result.details);
	assert.equal(stashed?.isError, true);
	assert.match(stashed?.content ?? "", /snapshot gate/);
});

test("a side-effect tool with a snapshot gate executes and carries a snapshotId", async () => {
	const snapshot: SnapshotHook = () => ({ snapshotId: "snap-1" });
	const registry = createToolRegistry([writeSpec]);
	const [tool] = await workhubToolsToPi(registry, { ...ctx, snapshot });
	const result = await tool!.execute("call-1", { text: "note" }, undefined, undefined);
	const stashed = extractWorkhubToolResult(result.details);
	assert.equal(stashed?.isError, false);
	assert.equal(stashed?.snapshotId, "snap-from-tool");
});

// --- visibility -----------------------------------------------------------

test("workhubToolsToPi honors registry visibility (canUse)", async () => {
	const registry = createToolRegistry([echoSpec, writeSpec], { canUse: (spec) => spec.id === "echo" });
	const tools = await workhubToolsToPi(registry, ctx);
	assert.deepEqual(
		tools.map((t) => t.name),
		["echo"],
		"only the visible tool is exposed",
	);
});

// --- isError propagation companion ----------------------------------------

test("workhubAfterToolCall propagates the stashed isError flag", async () => {
	const errorResult = workhubToolResultToPi(errorToolResult("it failed"));
	const override = await workhubAfterToolCall(
		{ result: errorResult } as unknown as Parameters<typeof workhubAfterToolCall>[0],
		undefined,
	);
	assert.deepEqual(override, { isError: true });
});

test("workhubAfterToolCall leaves non-wrapper results untouched", async () => {
	// A result the loop itself created (e.g. beforeToolCall block) carries details {}.
	const override = await workhubAfterToolCall(
		{ result: { content: [{ type: "text", text: "blocked" }], details: {} } } as unknown as Parameters<typeof workhubAfterToolCall>[0],
		undefined,
	);
	assert.equal(override, undefined);
});
