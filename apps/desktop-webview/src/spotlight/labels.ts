// 桌面 Spotlight 视图共用的枚举→本地化标签（避免给用户直接渲染 in_progress / urgent / running 等裸枚举）。
// 文案与 web 端 packages/ui i18n 同口径；约定签名 (value, zh) 与各 view 既有 helper 一致。

function pick(map: Record<string, [string, string]>, value: string, zh: boolean): string {
  const entry = map[value];
  return entry ? (zh ? entry[0] : entry[1]) : value;
}

const workItemStatusMap: Record<string, [string, string]> = {
  intake: ["接收中", "Intake"],
  ai_clarifying: ["澄清中", "Clarifying"],
  spec_ready: ["规格已就绪", "Spec ready"],
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

// R17 G3（#34）：agentRunStatuses 契约只有 queued/running/succeeded/failed/escalated/cancelled——
// budget_exhausted 从来不是合法的 AgentRunStatus（那是 budget notice reason 的枚举，不是 run 状态），
// 这条标签永远匹配不到任何真实 run 状态，是死标签，删掉。
const agentRunStatusMap: Record<string, [string, string]> = {
  queued: ["排队中", "Queued"],
  running: ["进行中", "In progress"],
  succeeded: ["已完成", "Succeeded"],
  failed: ["失败", "Failed"],
  escalated: ["已升级", "Escalated"],
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
  switch (step.phase) {
    case "think":
      return zh ? "AI 正在整理材料，稍后给你下一步。" : "AI is organizing the materials and preparing the next step.";
    case "tool_call":
      return zh ? "正在调用工具。" : "Calling a tool.";
    case "tool_result":
      return zh ? "工具已返回，AI 正在整理下一步。" : "Tool result received; AI is organizing the next step.";
    case "final":
      return step.output_excerpt ?? (zh ? "最终输出已生成。" : "Final output is ready.");
    default:
      return step.output_excerpt ?? (zh ? "记录了一个步骤。" : "Recorded one step.");
  }
}

export function riskHintLabel(level: string, zh: boolean): string {
  return pick(riskHintMap, level, zh);
}

// F-06：改动快照种类（contracts snapshotSchema.kind: pre_step/merge/manual/base）——与
// packages/ui/src/replay/render.ts 的 replay.snapshotKind* 词典同口径，供桌面 Spotlight 回放视图
// 的快照区使用。
const snapshotKindMap: Record<string, [string, string]> = {
  pre_step: ["执行前快照", "Pre-step snapshot"],
  merge: ["合并快照", "Merge snapshot"],
  manual: ["手动快照", "Manual snapshot"],
  base: ["基线快照", "Base snapshot"]
};

export function snapshotKindLabel(kind: string, zh: boolean): string {
  return pick(snapshotKindMap, kind, zh);
}

// F-09：会议记录状态（contracts MeetingRecordVM.status：processing/ready/failed）——与 web packages/ui
// route-components.ts meetingRecordStatusLabel 同枚举，桌面侧措辞与 search.ts 的会议搜索结果状态词
// （原地定义、现改从这里派生）保持内部一致，优先于跨端逐字对齐（同一枚举值在本客户端只应有一种说法）。
const meetingRecordStatusMap: Record<string, [string, string]> = {
  // 集成补：会议分析链路（SA-02）放出了 transcribed（AI 未配置/未分析时只保存了转写），与 web「转写已导入」同口径。
  transcribed: ["转写已导入", "Transcript imported"],
  processing: ["处理中", "Processing"],
  ready: ["已就绪", "Ready"],
  failed: ["失败", "Failed"]
};

// 会议洞察种类（contracts MeetingInsightVM.kind）：与 web meetingInsightKindLabel 同口径。
const meetingInsightKindMap: Record<string, [string, string]> = {
  new_requirement: ["新需求", "New requirement"],
  requirement_change: ["需求变更", "Requirement change"],
  normal_note: ["普通记录", "Note"]
};

// 会议洞察状态（contracts MeetingInsightVM.status）：与记录状态是两个不相交的枚举取值域，分开建表。
const meetingInsightStatusMap: Record<string, [string, string]> = {
  pending: ["待确认", "Pending"],
  confirmed: ["已确认", "Confirmed"],
  dismissed: ["已忽略", "Dismissed"]
};

export function meetingRecordStatusLabel(status: string, zh: boolean): string {
  return pick(meetingRecordStatusMap, status, zh);
}

export function meetingInsightKindLabel(kind: string, zh: boolean): string {
  return pick(meetingInsightKindMap, kind, zh);
}

export function meetingInsightStatusLabel(status: string, zh: boolean): string {
  return pick(meetingInsightStatusMap, status, zh);
}
