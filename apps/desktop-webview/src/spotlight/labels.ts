// 桌面 Spotlight 视图共用的枚举→本地化标签（避免给用户直接渲染 in_progress / urgent / running 等裸枚举）。
// 文案与 web 端 packages/ui i18n 同口径；约定签名 (value, zh) 与各 view 既有 helper 一致。
//
// 对照表本身住在 locales.ts（用户可见文案由 locale 独占，见 scripts/dev/check-ui-i18n.ts）；
// 这里只剩「查不到怎么办」的决定与各枚举的具名入口。

import { spotlightEnumLabel, spotlightT } from "./locales.js";

export function workItemStatusLabel(status: string, zh: boolean): string {
  return spotlightEnumLabel("workItemStatus", status, zh) ?? status;
}

export function workItemPriorityLabel(priority: string, zh: boolean): string {
  return spotlightEnumLabel("workItemPriority", priority, zh) ?? priority;
}

// R17 G3（#34）：agentRunStatuses 契约只有 queued/running/succeeded/failed/escalated/cancelled——
// budget_exhausted 从来不是合法的 AgentRunStatus（那是 budget notice reason 的枚举，不是 run 状态），
// 这条标签永远匹配不到任何真实 run 状态，是死标签，删掉。
export function agentRunStatusLabel(status: string, zh: boolean): string {
  return spotlightEnumLabel("agentRunStatus", status, zh) ?? status;
}

// AI 执行阶段：与 web packages/ui i18n.ts agentStepPhaseLabels 同口径。真枚举是 think/tool_call/tool_result/final
// （contracts enums.ts agentStepPhases）——曾在 workitem/replay 两视图被裸渲或用错键的 map 漏掉。
// 这一条的兜底不是裸值而是「步骤」：阶段枚举对用户没有阅读价值。
export function agentStepPhaseLabel(phase: string, zh: boolean): string {
  return spotlightEnumLabel("agentStepPhase", phase, zh) ?? spotlightT(zh, "step");
}

export function agentStepPublicSummary(
  step: { phase?: string | undefined; tool_name?: string | undefined; output_excerpt?: string | undefined },
  zh: boolean
): string {
  switch (step.phase) {
    case "think":
      return spotlightT(zh, "aiIsOrganizingTheMaterialsAnd");
    case "tool_call":
      return spotlightT(zh, "callingATool");
    case "tool_result":
      return spotlightT(zh, "toolResultReceivedAiIsOrganizing");
    case "final":
      return step.output_excerpt ?? spotlightT(zh, "finalOutputIsReady");
    default:
      return step.output_excerpt ?? spotlightT(zh, "recordedOneStep");
  }
}

// 选项风险等级（contracts riskLevel low/medium/high）：与 web route-components localizedEnumLabel 同口径。
export function riskHintLabel(level: string, zh: boolean): string {
  return spotlightEnumLabel("riskHint", level, zh) ?? level;
}

// F-06：改动快照种类（contracts snapshotSchema.kind: pre_step/merge/manual/base）——与
// packages/ui/src/replay/render.ts 的 replay.snapshotKind* 词典同口径，供桌面 Spotlight 回放视图
// 的快照区使用。
export function snapshotKindLabel(kind: string, zh: boolean): string {
  return spotlightEnumLabel("snapshotKind", kind, zh) ?? kind;
}

// F-09：会议记录状态（contracts MeetingRecordVM.status：transcribed/processing/ready/failed）——与 web
// packages/ui route-components.ts meetingRecordStatusLabel 同枚举，桌面侧措辞与 search.ts 的会议搜索
// 结果状态词保持内部一致，优先于跨端逐字对齐（同一枚举值在本客户端只应有一种说法）。
export function meetingRecordStatusLabel(status: string, zh: boolean): string {
  return spotlightEnumLabel("meetingRecordStatus", status, zh) ?? status;
}

// 会议洞察种类（contracts MeetingInsightVM.kind）：与 web meetingInsightKindLabel 同口径。
export function meetingInsightKindLabel(kind: string, zh: boolean): string {
  return spotlightEnumLabel("meetingInsightKind", kind, zh) ?? kind;
}

// 会议洞察状态（contracts MeetingInsightVM.status）：与记录状态是两个不相交的枚举取值域，分开建表。
export function meetingInsightStatusLabel(status: string, zh: boolean): string {
  return spotlightEnumLabel("meetingInsightStatus", status, zh) ?? status;
}
