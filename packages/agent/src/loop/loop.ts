import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { eventTypes } from "@workhub/contracts";

import {
  buildDeliverableChangeManifestFromOutputs,
  type BuildDeliverableChangeManifestInput
} from "../deliverables/index.js";
import type { LlmMessage, LlmStreamEvent } from "../providers/types.js";
import { checkLoopBudget, controlFromAssistant, createInitialUsage, DoomLoopDetector } from "./control.js";
import { buildStructuredHandoff } from "./handoff.js";
import type {
  AgentAssistantBlock,
  AgentLoopInput,
  AgentLoopResult,
  AgentLoopStep,
  AgentLoopUsage,
  StructuredHandoff
} from "./types.js";

function parseBlock(raw: unknown): AgentAssistantBlock {
  if (!raw || typeof raw !== "object") {
    return { type: "unknown", raw };
  }
  const block = raw as Record<string, unknown>;
  if (block.type === "tool_use" && typeof block.name === "string" && typeof block.id === "string") {
    return {
      type: "tool_use",
      id: block.id,
      name: block.name,
      input: block.input
    };
  }
  if (block.type === "text" && typeof block.text === "string") {
    return { type: "text", text: block.text };
  }
  if (block.type === "thinking") {
    const text = typeof block.thinking === "string" ? block.thinking : typeof block.text === "string" ? block.text : "";
    return { type: "thinking", text };
  }
  return { type: "unknown", raw };
}

function textFromBlocks(blocks: AgentAssistantBlock[]) {
  return blocks
    .filter((block): block is Extract<AgentAssistantBlock, { type: "text" | "thinking" }> =>
      block.type === "text" || block.type === "thinking"
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function hasDeliverables(workdir: string) {
  const outputs = path.join(workdir, "outputs");
  try {
    const outputStat = await stat(outputs);
    if (!outputStat.isDirectory()) {
      return false;
    }
    const entries = await readdir(outputs);
    return entries.length > 0;
  } catch {
    return false;
  }
}

function addUsage(usage: AgentLoopUsage, inputTokens: number, outputTokens: number) {
  usage.tokenIn += inputTokens;
  usage.tokenOut += outputTokens;
  usage.totalTokens += inputTokens + outputTokens;
}

function elapsedSeconds(startedAt: number) {
  return (Date.now() - startedAt) / 1000;
}

function previewUnknown(value: unknown, maxLength = 200) {
  if (typeof value === "string") {
    return value.slice(0, maxLength);
  }
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

function previewStreamEvent(event: LlmStreamEvent) {
  if (event.data && typeof event.data === "object") {
    const value = event.data as Record<string, unknown>;
    const delta = value.delta;
    if (delta && typeof delta === "object") {
      const deltaRecord = delta as Record<string, unknown>;
      if (typeof deltaRecord.text === "string") {
        return deltaRecord.text.slice(0, 200);
      }
      if (typeof deltaRecord.thinking === "string") {
        return deltaRecord.thinking.slice(0, 200);
      }
    }
  }
  return previewUnknown(event.data ?? event.type);
}

async function callModel(input: AgentLoopInput, params: {
  stepNo: number;
  system: string;
  messages: LlmMessage[];
  tools: unknown[];
  maxTokens: number;
}) {
  const request = {
    system: params.system,
    messages: params.messages,
    tools: params.tools,
    maxTokens: params.maxTokens,
    source: "agent_step" as const
  };
  const stream = input.client.messages.stream;
  if (!stream) {
    return input.client.messages.create(request);
  }

  const responseStream = await stream(request);
  for await (const event of responseStream) {
    await input.emit?.({
      type: eventTypes.agentRunStep,
      previewText: previewStreamEvent(event),
      data: {
        run_id: input.runId,
        step_no: params.stepNo,
        kind: "stream_event",
        provider_event_type: event.type
      }
    });
  }
  return responseStream.getFinalMessage();
}

async function emitAssistantTrace(input: AgentLoopInput, stepNo: number, assistant: AgentAssistantBlock[]) {
  for (const block of assistant) {
    if (block.type === "thinking") {
      await input.emit?.({
        type: eventTypes.agentRunStep,
        previewText: block.text.slice(0, 200),
        data: {
          run_id: input.runId,
          step_no: stepNo,
          kind: "thinking"
        }
      });
    } else if (block.type === "text") {
      await input.emit?.({
        type: eventTypes.agentRunStep,
        previewText: block.text.slice(0, 200),
        data: {
          run_id: input.runId,
          step_no: stepNo,
          kind: "text"
        }
      });
    } else if (block.type === "tool_use") {
      const inputPreview = previewUnknown(block.input);
      await input.emit?.({
        type: eventTypes.agentRunStep,
        previewText: `${block.name} ${inputPreview}`.slice(0, 200),
        data: {
          run_id: input.runId,
          step_no: stepNo,
          kind: "tool_call",
          tool_id: block.name,
          input_preview: inputPreview
        }
      });
    }
  }
}

function terminalResult(input: {
  status: AgentLoopResult["status"];
  reason: string;
  control: AgentLoopResult["control"];
  usage: AgentLoopUsage;
  steps: AgentLoopStep[];
  finalText?: string;
  handoff?: StructuredHandoff;
  manifest?: AgentLoopResult["manifest"];
}): AgentLoopResult {
  const result: AgentLoopResult = {
    status: input.status,
    reason: input.reason,
    control: input.control,
    usage: input.usage,
    steps: input.steps
  };
  if (input.finalText) {
    result.finalText = input.finalText;
  }
  if (input.handoff) {
    result.handoff = input.handoff;
  }
  if (input.manifest) {
    result.manifest = input.manifest;
  }
  return result;
}

function latestSnapshotId(steps: AgentLoopStep[]) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step?.snapshotId) {
      return step.snapshotId;
    }
  }
  return undefined;
}

function titleFromFinalText(finalText: string) {
  const title = finalText.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
  return title ? title.slice(0, 80) : "AgentRun 交付物变更草案";
}

export class AgentLoop {
  async run(input: AgentLoopInput): Promise<AgentLoopResult> {
    const now = input.now ?? (() => new Date());
    const startedAt = Date.now();
    const usage = createInitialUsage();
    const steps: AgentLoopStep[] = [];
    const messages: LlmMessage[] = [
      {
        role: "user",
        content: input.initialUserMessage
      }
    ];
    const doomLoop = new DoomLoopDetector(input.budget.doomLoopWindow ?? 3);
    const requireDeliverable = input.requireDeliverable ?? true;

    await input.emit?.({
      type: eventTypes.agentRunStarted,
      previewText: "AgentRun started",
      data: {
        run_id: input.runId,
        work_item_id: input.workItemId,
        budget: input.budget
      }
    });

    while (usage.stepsUsed < input.budget.maxSteps) {
      usage.secondsUsed = elapsedSeconds(startedAt);
      const budgetDecision = checkLoopBudget(usage, input.budget);
      if (budgetDecision?.signal === "escalate") {
        const handoff = buildStructuredHandoff({
          steps,
          budgetHit: budgetDecision.budgetHit,
          reason: budgetDecision.reason
        });
        await input.emit?.({
          type: eventTypes.agentRunEscalated,
          previewText: budgetDecision.reason,
          data: { run_id: input.runId, handoff }
        });
        return terminalResult({
          status: "escalated",
          reason: budgetDecision.reason,
          control: "escalate",
          usage,
          steps,
          handoff
        });
      }

      const stepStarted = now();
      const ctx = {
        workdir: input.workdir,
        ...(input.actorId ? { actorId: input.actorId } : {}),
        runId: input.runId,
        workItemId: input.workItemId,
        sandboxBudget: {
          maxFiles: input.budget.maxFiles ?? 800,
          maxBytes: input.budget.maxBytes ?? 200 * 1024 * 1024,
          commandTimeoutSeconds: input.budget.commandTimeoutSeconds ?? 45
        },
        ...(input.snapshot ? { snapshot: input.snapshot } : {})
      };
      const tools = await input.tools.toModelTools(ctx);
      const stepNo = usage.stepsUsed + 1;
      const response = await callModel(input, {
        stepNo,
        system: input.systemPrompt,
        messages,
        tools,
        maxTokens: input.maxTokensPerStep ?? 4096
      });
      const usageTokens = response.usage ?? { inputTokens: 0, outputTokens: 0 };
      addUsage(usage, usageTokens.inputTokens, usageTokens.outputTokens);

      const assistant = response.content.map(parseBlock);
      await emitAssistantTrace(input, stepNo, assistant);
      const toolCalls = assistant.filter((block): block is Extract<AgentAssistantBlock, { type: "tool_use" }> => block.type === "tool_use");
      const toolResults = [];
      for (const toolCall of toolCalls) {
        const result = await input.tools.execute(toolCall.name, toolCall.input, ctx);
        toolResults.push(result);
        await input.emit?.({
          type: eventTypes.stepToolResult,
          previewText: result.content.slice(0, 200),
          data: {
            run_id: input.runId,
            step_no: stepNo,
            tool_id: toolCall.name,
            ok: result.ok,
            is_error: result.isError
          }
        });
      }

      const control = controlFromAssistant(assistant, response.stopReason);
      const step: AgentLoopStep = {
        index: stepNo,
        assistant,
        toolCalls,
        toolResults,
        control,
        startedAt: stepStarted.toISOString(),
        endedAt: now().toISOString()
      };
      if (response.stopReason) {
        step.stopReason = response.stopReason;
      }
      const snapshotId = toolResults.find((result) => result.snapshotId)?.snapshotId;
      if (snapshotId) {
        step.snapshotId = snapshotId;
        await input.emit?.({
          type: eventTypes.stepSnapshot,
          previewText: "Snapshot captured",
          data: {
            run_id: input.runId,
            step_no: step.index,
            snapshot_id: snapshotId
          }
        });
      }

      steps.push(step);
      usage.stepsUsed = steps.length;
      await input.recorder?.recordStep(step);
      await input.emit?.({
        type: eventTypes.agentRunStep,
        previewText: textFromBlocks(assistant).slice(0, 200),
        data: {
          run_id: input.runId,
          step_no: step.index,
          control
        }
      });

      const loopSignature = doomLoop.push(step);
      if (loopSignature) {
        const handoff = buildStructuredHandoff({
          steps,
          budgetHit: "doom_loop",
          reason: "连续多步执行了相同动作，已自动升级。"
        });
        await input.emit?.({
          type: eventTypes.agentRunEscalated,
          previewText: "doom_loop",
          data: {
            run_id: input.runId,
            handoff
          }
        });
        return terminalResult({
          status: "escalated",
          reason: "doom_loop",
          control: "escalate",
          usage,
          steps,
          handoff
        });
      }

      messages.push({
        role: "assistant",
        content: response.content
      });

      if (toolResults.length > 0) {
        messages.push({
          role: "user",
          content: toolResults.map((result, index) => ({
            type: "tool_result",
            tool_use_id: toolCalls[index]?.id,
            content: result.content,
            is_error: result.isError
          }))
        });
        continue;
      }

      if (control === "compact") {
        const handoff = buildStructuredHandoff({
          steps,
          budgetHit: "tokens",
          reason: "模型响应被截断，需要上下文压缩。"
        });
        await input.emit?.({
          type: eventTypes.agentRunCompacting,
          previewText: "模型响应被截断，需要上下文压缩。",
          data: {
            run_id: input.runId,
            step_no: step.index,
            handoff
          }
        });
        return terminalResult({
          status: "escalated",
          reason: "compact_required",
          control: "compact",
          usage,
          steps,
          handoff
        });
      }

      const finalText = textFromBlocks(assistant);
      if (requireDeliverable && !(await hasDeliverables(input.workdir))) {
        await input.emit?.({
          type: eventTypes.agentRunFailed,
          previewText: "AI 没产出交付物",
          data: { run_id: input.runId }
        });
        return terminalResult({
          status: "failed",
          reason: "AI 没产出交付物",
          control: "stop",
          usage,
          steps,
          finalText
        });
      }

      let manifest: AgentLoopResult["manifest"];
      if (requireDeliverable) {
        const manifestInput: BuildDeliverableChangeManifestInput = {
          workdir: input.workdir,
          workItemId: input.workItemId,
          title: input.manifest?.title ?? titleFromFinalText(finalText)
        };
        const manifestSnapshotId = input.manifest?.snapshotId ?? latestSnapshotId(steps);
        if (input.manifest?.proposalId) {
          manifestInput.proposalId = input.manifest.proposalId;
        }
        if (input.manifest?.branchId) {
          manifestInput.branchId = input.manifest.branchId;
        }
        if (manifestSnapshotId) {
          manifestInput.snapshotId = manifestSnapshotId;
        }
        if (input.manifest?.branchHeadRef) {
          manifestInput.branchHeadRef = input.manifest.branchHeadRef;
        }
        if (input.manifest?.author) {
          manifestInput.author = input.manifest.author;
        }
        if (input.manifest?.evidenceRefs) {
          manifestInput.evidenceRefs = input.manifest.evidenceRefs;
        }
        if (input.manifest?.createdAt) {
          manifestInput.createdAt = input.manifest.createdAt;
        }
        if (input.manifest?.downloadHrefForPath) {
          manifestInput.downloadHrefForPath = input.manifest.downloadHrefForPath;
        }
        if (input.manifest?.previewHrefForPath) {
          manifestInput.previewHrefForPath = input.manifest.previewHrefForPath;
        }
        manifest = await buildDeliverableChangeManifestFromOutputs(manifestInput);
      }

      return terminalResult({
        status: "succeeded",
        reason: finalText || "AgentRun completed",
        control: "stop",
        usage,
        steps,
        finalText,
        ...(manifest ? { manifest } : {})
      });
    }

    const handoff = buildStructuredHandoff({
      steps,
      budgetHit: "steps",
      reason: "步数预算已耗尽"
    });
    await input.emit?.({
      type: eventTypes.agentRunEscalated,
      previewText: "步数预算已耗尽",
      data: {
        run_id: input.runId,
        handoff
      }
    });
    return terminalResult({
      status: "escalated",
      reason: "步数预算已耗尽",
      control: "escalate",
      usage,
      steps,
      handoff
    });
  }
}

export function createAgentLoop() {
  return new AgentLoop();
}
