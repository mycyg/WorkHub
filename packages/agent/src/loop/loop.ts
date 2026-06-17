import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { eventTypes } from "@workhub/contracts";

import {
  buildDeliverableChangeManifestFromOutputs,
  type BuildDeliverableChangeManifestInput
} from "../deliverables/index.js";
import type { LlmMessage, LlmStreamEvent } from "../providers/types.js";
import { checkLoopBudget, controlFromAssistant, createInitialUsage, DoomLoopDetector } from "./control.js";
import { nextRetryDecision } from "../providers/retry.js";
import { buildStructuredHandoff } from "./handoff.js";
import type {
  AgentAssistantBlock,
  AgentLoopInput,
  AgentLoopResult,
  AgentLoopStep,
  AgentLoopUsage,
  AgentRunReview,
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

function parseCny(value: string | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCny(value: number) {
  return value.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "") || "0";
}

function addUsage(usage: AgentLoopUsage, inputTokens: number, outputTokens: number, estimatedCostCny?: string) {
  usage.tokenIn += inputTokens;
  usage.tokenOut += outputTokens;
  usage.totalTokens += inputTokens + outputTokens;
  usage.estimatedCostCny = formatCny(parseCny(usage.estimatedCostCny) + parseCny(estimatedCostCny));
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
    source: "agent_step" as const,
    // findings[19]：把单调步号带进用量记账去重键——同 run 内两步即便 token/毫秒相同也不被误并、少记成本。
    seq: params.stepNo
  };
  const stream = input.client.messages.stream;
  if (!stream) {
    return input.client.messages.create(request);
  }

  const responseStream = await stream(request);
  // M16：流式增量不再每个 delta 都发一条持久总线事件——否则长回复会产生成百上千次 awaited publish，
  // 既把流式消费串行卡在 publish 延迟上，又用 per-token 记录淹没事件存储/SSE 订阅者。
  // 节流成最多每秒一条心跳：保留"正在生成"的活跃感，把总线写入降到 O(时长) 而非 O(token 数)。
  const STREAM_EMIT_THROTTLE_MS = 1000;
  let lastStreamEmitAt = 0;
  for await (const event of responseStream) {
    const at = Date.now();
    if (at - lastStreamEmitAt < STREAM_EMIT_THROTTLE_MS) {
      continue;
    }
    lastStreamEmitAt = at;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callModelWithRetry(input: AgentLoopInput, params: Parameters<typeof callModel>[1]) {
  let attempt = 0;
  for (;;) {
    try {
      return await callModel(input, params);
    } catch (error) {
      const decision = nextRetryDecision(
        error as { status?: number; headers?: { get: (name: string) => string | null } },
        attempt,
        { baseDelayMs: input.budget.providerRetryBaseDelayMs ?? 500 }
      );
      if (!decision.retry) {
        throw error;
      }
      attempt += 1;
      await input.emit?.({
        type: eventTypes.agentRunStep,
        previewText: `provider 瞬态错误，第 ${attempt} 次重试（${decision.reason}）`,
        data: {
          run_id: input.runId,
          step_no: params.stepNo,
          kind: "provider_retry",
          attempt,
          retry_reason: decision.reason,
          delay_ms: decision.delayMs
        }
      });
      await sleep(decision.delayMs);
    }
  }
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

function truncateForContext(content: string, maxChars: number) {
  if (content.length <= maxChars) {
    return content;
  }
  const headChars = Math.floor(maxChars * 0.75);
  const tailChars = Math.floor(maxChars * 0.15);
  const omitted = content.length - headChars - tailChars;
  return `${content.slice(0, headChars)}\n…[已截断 ${omitted} 字符，完整内容见 trace]\n${content.slice(content.length - tailChars)}`;
}

function summarizeStepsForCompaction(steps: AgentLoopStep[], maxChars = 4000) {
  const lines: string[] = [];
  for (const step of steps) {
    const text = step.assistant
      .filter((block): block is Extract<AgentAssistantBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text.trim())
      .join(" ")
      .slice(0, 120);
    if (step.toolCalls.length === 0) {
      lines.push(`step ${step.index}: ${text || "(无工具调用)"}`);
      continue;
    }
    for (let index = 0; index < step.toolCalls.length; index += 1) {
      const call = step.toolCalls[index]!;
      const result = step.toolResults[index];
      const outcome = result ? (result.isError ? "error" : "ok") : "pending";
      lines.push(`step ${step.index}: ${call.name}(${previewUnknown(call.input, 80)}) -> ${outcome}`);
    }
  }
  const summary = lines.join("\n");
  return summary.length > maxChars ? `${summary.slice(0, maxChars)}\n…[摘要已截断]` : summary;
}

export function compactConversation(input: {
  messages: LlmMessage[];
  initialUserMessage: string;
  steps: AgentLoopStep[];
  keepTailEntries?: number;
}): LlmMessage[] {
  const keep = input.keepTailEntries ?? 6;
  // 尾部保留必须从 assistant 边界开始，保证 tool_use/tool_result 配对完整。
  let cut = Math.max(1, input.messages.length - keep);
  while (cut < input.messages.length && input.messages[cut]?.role !== "assistant") {
    cut += 1;
  }
  const tail = input.messages.slice(cut);
  const summary = summarizeStepsForCompaction(input.steps);
  return [
    {
      role: "user",
      content: `${input.initialUserMessage}\n\n[上下文已压缩。此前执行摘要]\n${summary}\n[摘要结束。请基于以上进度继续完成任务。]`
    },
    ...tail
  ];
}

function parseReviewJson(text: string): { grade: 1 | 2 | 3 | 4 | 5; rationale: string } | undefined {
  const match = /\{[\s\S]*\}/u.exec(text);
  if (!match) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(match[0]) as { grade?: unknown; rationale?: unknown };
    const grade = Number(parsed.grade);
    if (!Number.isInteger(grade) || grade < 1 || grade > 5) {
      return undefined;
    }
    const rationale = typeof parsed.rationale === "string" && parsed.rationale.trim()
      ? parsed.rationale.trim().slice(0, 500)
      : "";
    if (!rationale) {
      return undefined;
    }
    return { grade: grade as 1 | 2 | 3 | 4 | 5, rationale };
  } catch {
    return undefined;
  }
}

async function reviewDeliverable(input: AgentLoopInput, params: {
  finalText: string;
  manifest: AgentLoopResult["manifest"];
  usage: AgentLoopUsage;
}): Promise<AgentRunReview | undefined> {
  const changeLines = (params.manifest?.changes ?? [])
    .slice(0, 20)
    .map((change) => `- ${change.target_ref.path ?? change.target_ref.entity_type}: ${change.human_summary}`)
    .join("\n");
  try {
    const response = await input.client.messages.create({
      system: "你是 WorkHub 的交付物评审员。只输出一个 JSON 对象，不要输出任何其他文本。",
      messages: [{
        role: "user",
        content: [
          `任务：${input.initialUserMessage.split("\n")[0] ?? ""}`,
          "",
          "交付物变更：",
          changeLines || "(无变更清单)",
          "",
          "工人最终陈述：",
          params.finalText.slice(0, 1500) || "(无)",
          "",
          "请按五档评审交付物与任务的匹配度（1=完全不可用，2=大量返工，3=可用但需修改，4=基本可直接采纳，5=可直接采纳），输出严格 JSON：",
          "{\"grade\": 1-5 的整数, \"rationale\": \"一句人话理由\"}"
        ].join("\n")
      }],
      maxTokens: 300,
      source: "review"
    });
    const usageTokens = response.usage ?? { inputTokens: 0, outputTokens: 0 };
    addUsage(params.usage, usageTokens.inputTokens, usageTokens.outputTokens, response.usageRecord?.estimatedCostCny);
    const text = response.content
      .map(parseBlock)
      .filter((block): block is Extract<AgentAssistantBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const parsed = parseReviewJson(text);
    if (!parsed) {
      return undefined;
    }
    return {
      source: "llm_review",
      grade: parsed.grade,
      rationale: parsed.rationale,
      model: input.client.model
    };
  } catch {
    // 评审失败静默降级：置信度回退启发式，绝不阻塞主流程。
    return undefined;
  }
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
    const maxCompactions = input.budget.maxCompactions ?? 2;
    const toolResultContextChars = input.budget.toolResultContextChars ?? 8000;
    let nextCompactionAtTokens = 0;

    const compactNow = async (trigger: "context_window" | "max_tokens", stepNo: number) => {
      usage.compactions = (usage.compactions ?? 0) + 1;
      const window = input.budget.contextWindowTokens ?? 0;
      nextCompactionAtTokens = usage.totalTokens + Math.max(1, Math.floor(window * (input.budget.compactThreshold ?? 0.8)));
      const compacted = compactConversation({
        messages,
        initialUserMessage: input.initialUserMessage,
        steps
      });
      messages.length = 0;
      messages.push(...compacted);
      await input.emit?.({
        type: eventTypes.agentRunCompacting,
        previewText: `上下文已压缩（第 ${usage.compactions} 次，触发=${trigger}）`,
        data: {
          run_id: input.runId,
          step_no: stepNo,
          trigger,
          compactions: usage.compactions
        }
      });
    };

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
      if (budgetDecision?.signal === "compact" && usage.totalTokens >= nextCompactionAtTokens) {
        if ((usage.compactions ?? 0) >= maxCompactions) {
          const handoff = buildStructuredHandoff({
            steps,
            budgetHit: "tokens",
            reason: "上下文压缩次数已用尽"
          });
          await input.emit?.({
            type: eventTypes.agentRunEscalated,
            previewText: "上下文压缩次数已用尽",
            data: { run_id: input.runId, handoff }
          });
          return terminalResult({
            status: "escalated",
            reason: "compact_budget_exhausted",
            control: "escalate",
            usage,
            steps,
            handoff
          });
        }
        await compactNow("context_window", usage.stepsUsed + 1);
      }
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
        ...(input.snapshot ? { snapshot: input.snapshot } : {}),
        ...(input.commandRunner ? { commandRunner: input.commandRunner } : {})
      };
      const tools = await input.tools.toModelTools(ctx);
      const stepNo = usage.stepsUsed + 1;
      const response = await callModelWithRetry(input, {
        stepNo,
        system: input.systemPrompt,
        messages,
        tools,
        maxTokens: input.maxTokensPerStep ?? 4096
      });
      const usageTokens = response.usage ?? { inputTokens: 0, outputTokens: 0 };
      addUsage(usage, usageTokens.inputTokens, usageTokens.outputTokens, response.usageRecord?.estimatedCostCny);
      // 立刻把累计用量回传宿主：若本步后续（工具执行/下一次模型调用）抛错，失败 run 仍能记到真实 token/成本。
      input.recorder?.recordUsage?.(usage);

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
            content: truncateForContext(result.content, toolResultContextChars),
            is_error: result.isError
          }))
        });
        continue;
      }

      if (control === "compact") {
        if ((usage.compactions ?? 0) < maxCompactions) {
          await compactNow("max_tokens", step.index);
          messages.push({
            role: "user",
            content: "你的上一条回复因长度限制被截断。请基于摘要中的进度继续完成任务，并控制单次输出长度；完成后自然结束。"
          });
          continue;
        }
        const handoff = buildStructuredHandoff({
          steps,
          budgetHit: "tokens",
          reason: "模型响应被截断且压缩次数已用尽。"
        });
        await input.emit?.({
          type: eventTypes.agentRunCompacting,
          previewText: "模型响应被截断且压缩次数已用尽。",
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

      let review: AgentRunReview | undefined;
      if (input.reviewDeliverable ?? true) {
        review = await reviewDeliverable(input, { finalText, manifest, usage });
        if (review) {
          await input.emit?.({
            type: eventTypes.agentRunStep,
            previewText: `llm_review: grade=${review.grade} ${review.rationale.slice(0, 120)}`,
            data: {
              run_id: input.runId,
              step_no: usage.stepsUsed,
              kind: "llm_review",
              grade: review.grade
            }
          });
        }
      }

      const result = terminalResult({
        status: "succeeded",
        reason: finalText || "AgentRun completed",
        control: "stop",
        usage,
        steps,
        finalText,
        ...(manifest ? { manifest } : {})
      });
      if (review) {
        result.review = review;
      }
      return result;
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
