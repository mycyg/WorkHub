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
