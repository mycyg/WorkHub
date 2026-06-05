import type { AgentLoopStep, StructuredHandoff } from "./types.js";

function summarizeStep(step: AgentLoopStep) {
  const toolNames = step.toolCalls.map((tool) => tool.name);
  if (toolNames.length > 0) {
    return `Step ${step.index}: used ${toolNames.join(", ")}`;
  }
  const text = step.assistant
    .filter((block) => block.type === "text" || block.type === "thinking")
    .map((block) => block.text)
    .join(" ")
    .trim();
  return text ? `Step ${step.index}: ${text.slice(0, 120)}` : `Step ${step.index}: no visible action`;
}

function artifactPaths(steps: AgentLoopStep[]) {
  const paths = new Set<string>();
  for (const step of steps) {
    for (const result of step.toolResults) {
      const data = result.data;
      if (data && typeof data === "object" && "path" in data && typeof data.path === "string") {
        paths.add(data.path);
      }
    }
  }
  return [...paths];
}

export function buildStructuredHandoff(input: {
  steps: AgentLoopStep[];
  budgetHit: StructuredHandoff["budgetHit"];
  reason: string;
}): StructuredHandoff {
  return {
    done: input.steps.slice(-5).map(summarizeStep),
    remaining: ["需要人工或经理模式确认剩余目标是否仍成立。"],
    nextSteps: ["查看 AgentRun trace", "确认已有半成品", "决定继续、打回或转人工处理"],
    blockers: [input.reason],
    artifacts: artifactPaths(input.steps),
    budgetHit: input.budgetHit
  };
}
