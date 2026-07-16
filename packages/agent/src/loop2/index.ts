/**
 * loop2: WorkHub's Phase 0 vendor of the pi agent loop.
 *
 * This module re-exports the vendored pi agent loop (`agent-loop.ts`), its config
 * contract and event types (`types.ts`), the event-stream primitives, and the
 * tool-argument validation seam. It is NOT wired into `@workhub/agent`'s package
 * entry point; the production loop (`../loop`) and turns (`../turns`) are untouched.
 * Consumers reach loop2 via this internal path only. See ./NOTICE.md for provenance.
 */

// Loop entry points (pi keeps `runLoop` itself private; these are the public runners).
export { agentLoop, agentLoopContinue, runAgentLoop, runAgentLoopContinue } from "./vendor/agent-loop.js";
export type { AgentEventSink } from "./vendor/agent-loop.js";

// Config contract, agent-level message/tool/event types.
export type {
	AfterToolCallContext,
	AfterToolCallResult,
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentLoopTurnUpdate,
	AgentMessage,
	AgentState,
	AgentTool,
	AgentToolCall,
	AgentToolResult,
	AgentToolUpdateCallback,
	BeforeToolCallContext,
	BeforeToolCallResult,
	CustomAgentMessages,
	PrepareNextTurnContext,
	QueueMode,
	ShouldStopAfterTurnContext,
	StreamFn,
	ThinkingLevel,
	ToolExecutionMode,
} from "./vendor/types.js";

// Event-stream primitives (useful for building streamFn adapters and test stubs).
export { AssistantMessageEventStream, EventStream, createAssistantMessageEventStream } from "./vendor/event-stream.js";

// Tool-argument validation seam. Phase 0 ships a passthrough stub; Phase 1 injects zod.
export { setToolArgumentValidator, validateToolArguments } from "./vendor/validation.js";
export type { ToolArgumentValidator } from "./vendor/validation.js";

// Phase 4 (conversation turns) reuses three Phase 1 adapter helpers from apps/api's
// `runConversationTurnLoop2`: the pi→wire message converter (with tool_result collapsing),
// the WorkHub-content→pi-block converter (text + tool_use), and the stop-reason mapping.
// Re-exported here so the conversation runner reaches them via the same `@workhub/agent/loop2`
// subpath as everything else, instead of reaching into adapter internals.
export { piMessagesToWorkhub, workhubAssistantContentToPi } from "./adapters/messages.js";
export { toPiStopReason } from "./adapters/stream-fn.js";

// Phase 2 configBuilder + shadow dispatch. `runAgentLoop2` is a drop-in stand-in for
// `AgentLoop.run`; `runAgentLoopDispatch` gates it behind AGENT_RUN_LOOP2_MODE. The main
// package entry (`@workhub/agent`) stays untouched — this reaches consumers via the
// dedicated `@workhub/agent/loop2` subpath only.
export {
	assertLoopCoreEquivalent,
	loopCoreDiffs,
	projectLoopCore,
	runAgentLoop2,
	runAgentLoopDispatch,
} from "./config-builder.js";
export type { AgentRunLoop2Mode, LoopCoreProjection } from "./config-builder.js";

// The minimal pi-ai message/model type closure the config contract is built on.
// (ThinkingLevel is intentionally not re-exported here: the agent-level variant
// from ./vendor/types.js, which includes "off", is the one exported above.)
export type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	ImageContent,
	JsonSchema,
	Message,
	Model,
	ModelCost,
	ModelThinkingLevel,
	ProviderId,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingBudgets,
	ThinkingContent,
	ThinkingLevelMap,
	Tool,
	ToolCall,
	ToolResultMessage,
	Usage,
	UserMessage,
} from "./vendor/ai-types.js";
