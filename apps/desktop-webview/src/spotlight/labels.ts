// 桌面 Spotlight 视图共用的枚举→本地化标签（避免给用户直接渲染 in_progress / urgent / running 等裸枚举）。
// 文案与 web 端 packages/ui i18n 同口径；约定签名 (value, zh) 与各 view 既有 helper 一致。

function pick(map: Record<string, [string, string]>, value: string, zh: boolean): string {
  const entry = map[value];
  return entry ? (zh ? entry[0] : entry[1]) : value;
}

const workItemStatusMap: Record<string, [string, string]> = {
  intake: ["接收中", "Intake"],
  ai_clarifying: ["澄清中", "Clarifying"],
  spec_ready: ["待派活", "Ready to run"],
  ai_working: ["AI 正在处理", "AI working"],
  in_progress: ["进行中", "In progress"],
  in_review: ["待审阅", "In review"],
  delivery_ready: ["待交付", "Delivery ready"],
  escalated: ["已升级", "Escalated"],
  pm_mode: ["人工处理", "PM mode"],
  merged: ["已合并", "Merged"],
  accepted: ["已采纳", "Accepted"],
  done: ["已完成", "Done"],
  cancelled: ["已取消", "Cancelled"]
};

const workItemPriorityMap: Record<string, [string, string]> = {
  low: ["低", "Low"],
  normal: ["普通", "Normal"],
  high: ["高", "High"],
  urgent: ["紧急", "Urgent"]
};

const agentRunStatusMap: Record<string, [string, string]> = {
  queued: ["排队中", "Queued"],
  running: ["执行中", "Running"],
  succeeded: ["已完成", "Succeeded"],
  failed: ["失败", "Failed"],
  escalated: ["已升级", "Escalated"],
  budget_exhausted: ["预算已用尽", "Budget exhausted"],
  cancelled: ["已取消", "Cancelled"]
};

export function workItemStatusLabel(status: string, zh: boolean): string {
  return pick(workItemStatusMap, status, zh);
}

export function workItemPriorityLabel(priority: string, zh: boolean): string {
  return pick(workItemPriorityMap, priority, zh);
}

export function agentRunStatusLabel(status: string, zh: boolean): string {
  return pick(agentRunStatusMap, status, zh);
}

// AI 执行阶段：与 web packages/ui i18n.ts agentStepPhaseLabels 同口径。真枚举是 think/tool_call/tool_result/final
// （contracts enums.ts agentStepPhases）——曾在 workitem/replay 两视图被裸渲或用错键的 map 漏掉。
const agentStepPhaseMap: Record<string, [string, string]> = {
  think: ["思考", "Thinking"],
  tool_call: ["调用工具", "Tool call"],
  tool_result: ["工具结果", "Tool result"],
  final: ["最终整理", "Final"]
};

// 选项风险等级（contracts riskLevel low/medium/high）：与 web route-components localizedEnumLabel 同口径。
const riskHintMap: Record<string, [string, string]> = {
  low: ["低风险", "Low risk"],
  medium: ["中风险", "Medium risk"],
  high: ["高风险", "High risk"]
};

export function agentStepPhaseLabel(phase: string, zh: boolean): string {
  return agentStepPhaseMap[phase]?.[zh ? 0 : 1] ?? (zh ? "步骤" : "Step");
}

export function agentStepPublicSummary(
  step: { phase?: string | undefined; tool_name?: string | undefined; output_excerpt?: string | undefined },
  zh: boolean
): string {
  const tool = step.tool_name?.trim();
  const separator = zh ? "：" : ": ";
  switch (step.phase) {
    case "think":
      return zh ? "AI 正在整理材料，稍后给你下一步。" : "AI is organizing the materials and preparing the next step.";
    case "tool_call":
      return tool ? `${zh ? "工具调用" : "Tool call"}${separator}${tool}` : zh ? "正在调用工具。" : "Calling a tool.";
    case "tool_result":
      return tool
        ? `${zh ? "工具已返回" : "Tool result received"}${separator}${tool}`
        : zh ? "工具已返回，AI 正在整理下一步。" : "Tool result received; AI is organizing the next step.";
    case "final":
      return step.output_excerpt ?? (zh ? "最终输出已生成。" : "Final output is ready.");
    default:
      return step.output_excerpt ?? tool ?? (zh ? "记录了一个步骤。" : "Recorded one step.");
  }
}

export function riskHintLabel(level: string, zh: boolean): string {
  return pick(riskHintMap, level, zh);
}
