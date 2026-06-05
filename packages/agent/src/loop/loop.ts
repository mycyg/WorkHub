import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { LlmMessage } from "../providers/types.js";
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

function terminalResult(input: {
  status: AgentLoopResult["status"];
  reason: string;
  control: AgentLoopResult["control"];
  usage: AgentLoopUsage;
  steps: AgentLoopStep[];
  finalText?: string;
  handoff?: StructuredHandoff;
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
  return result;
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
      type: "agent_run.started",
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
          type: "agent_run.escalated",
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
      const response = await input.client.messages.create({
        system: input.systemPrompt,
        messages,
        tools,
        maxTokens: input.maxTokensPerStep ?? 4096,
        source: "agent_step"
      });
      const usageTokens = response.usage ?? { inputTokens: 0, outputTokens: 0 };
      addUsage(usage, usageTokens.inputTokens, usageTokens.outputTokens);

      const assistant = response.content.map(parseBlock);
      const toolCalls = assistant.filter((block): block is Extract<AgentAssistantBlock, { type: "tool_use" }> => block.type === "tool_use");
      const toolResults = [];
      for (const toolCall of toolCalls) {
        const result = await input.tools.execute(toolCall.name, toolCall.input, ctx);
        toolResults.push(result);
        await input.emit?.({
          type: "step.tool_result",
          previewText: result.content.slice(0, 200),
          data: {
            run_id: input.runId,
            step_no: usage.stepsUsed + 1,
            tool_id: toolCall.name,
            ok: result.ok,
            is_error: result.isError
          }
        });
      }

      const control = controlFromAssistant(assistant, response.stopReason);
      const step: AgentLoopStep = {
        index: usage.stepsUsed + 1,
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
      }

      steps.push(step);
      usage.stepsUsed = steps.length;
      await input.recorder?.recordStep(step);
      await input.emit?.({
        type: "agent_run.step",
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
          type: "agent_run.failed",
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

      return terminalResult({
        status: "succeeded",
        reason: finalText || "AgentRun completed",
        control: "stop",
        usage,
        steps,
        finalText
      });
    }

    const handoff = buildStructuredHandoff({
      steps,
      budgetHit: "steps",
      reason: "步数预算已耗尽"
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
