import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

export type CuuLocaleOptions = {
  locale?: WorkHubLocale | undefined;
};

export type CuuCopyKey =
  | "agentRun.doneTitle"
  | "agentRun.attentionTitle"
  | "agentRun.startedTitle"
  | "agentRun.workingTitle"
  | "agentRun.progressFallback"
  | "agentRun.viewReplay"
  | "agentRun.openWorkItem"
  | "agentRun.abort"
  | "agentRun.progressSection"
  | "agentRun.budgetSection"
  | "agentRun.handoffSection"
  | "agentRun.queued"
  | "question.bodyFallback"
  | "question.submit"
  | "evidence.missingSection"
  | "evidence.titleFound"
  | "evidence.titleDefault"
  | "proposal.changesSection"
  | "proposal.riskSection"
  | "proposal.rollbackAvailable"
  | "proposal.rollbackUnavailable"
  | "proposal.checksSection"
  | "proposal.conflictTitle"
  | "proposal.conflictOpenProposal"
  | "proposal.conflictKeepCurrent"
  | "proposal.conflictAcceptIncoming"
  | "proposal.conflictAiFusion"
  | "proposal.conflictApplyAiFusion"
  | "proposal.conflictTargetSection"
  | "proposal.conflictVersionSection"
  | "workItem.open"
  | "workItem.openProposal"
  | "workItem.viewReplay"
  | "workItem.startAgent"
  | "workItem.statusSection"
  | "workItem.readyFallback"
  | "workItem.acceptanceSection"
  | "workItem.acceptanceFallback"
  | "workItem.startedFallback"
  | "budget.scope.workitem"
  | "budget.scope.user"
  | "budget.scope.team"
  | "budget.scope.eval"
  | "budget.handle"
  | "budget.view"
  | "budget.exhaustedTitle"
  | "budget.warningTitle"
  | "budget.usageDescription"
  | "cost.summarySection"
  | "cost.risksSection"
  | "cost.total"
  | "cost.input"
  | "cost.output"
  | "cost.remaining"
  | "cost.title"
  | "cost.notConnected"
  | "cost.usedToday"
  | "replay.summarySection"
  | "replay.costSection"
  | "replay.title"
  | "replay.readyFallback"
  | "event.defaultTitle"
  | "event.defaultMessage"
  | "offline.retryingTitle"
  | "offline.closedTitle"
  | "offline.retryingMessage"
  | "offline.closedMessage"
  | "offline.retryingChip"
  | "offline.closedChip"
  | "state.idle"
  | "state.thinking"
  | "state.asking_approval"
  | "state.carrying_document"
  | "state.searching_evidence"
  | "state.syncing_files"
  | "state.worried"
  | "state.revision_requested"
  | "state.celebrating"
  | "state.offline"
  | "notice.prefix"
  | "action.reasonRequired"
  | "action.approved"
  | "action.denied"
  | "action.evidenceFound"
  | "action.noEvidence"
  | "action.evidenceBound"
  | "action.nextQuestion"
  | "pet.aria"
  | "pet.windowModeExpanding"
  | "pet.reducedMotionOffline"
  | "pet.selectedWithLabel"
  | "pet.selectedFallback"
  | "pet.optionRequired"
  | "pet.reasonRequired"
  | "pet.reasonDefault"
  | "pet.actionFail"
  | "pet.reject.evidence"
  | "pet.reject.scope"
  | "pet.reject.format"
  | "pet.evidenceTitle"
  | "pet.evidenceMore"
  | "pet.input.optionWithText"
  | "pet.input.optionOnly"
  | "pet.input.textNeeded"
  | "pet.kind.question"
  | "pet.kind.approval"
  | "pet.kind.proposal"
  | "pet.kind.evidence"
  | "pet.kind.budget"
  | "pet.kind.sync"
  | "pet.kind.trace"
  | "pet.kind.completion"
  | "pet.kind.offline"
  | "pet.kind.bubble"
  | "pet.priority.urgent"
  | "pet.priority.high"
  | "pet.priority.low"
  | "pet.priority.normal";

const cuuCopy = {
  "zh-CN": {
    "agentRun.doneTitle": "这次执行完成了",
    "agentRun.attentionTitle": "这次执行需要关注",
    "agentRun.startedTitle": "Cuu 开始处理了",
    "agentRun.workingTitle": "Cuu 正在处理",
    "agentRun.progressFallback": "Cuu 正在整理执行进度。",
    "agentRun.viewReplay": "查看回放",
    "agentRun.openWorkItem": "回到任务",
    "agentRun.abort": "取消执行",
    "agentRun.progressSection": "执行进度",
    "agentRun.budgetSection": "预算",
    "agentRun.handoffSection": "交接",
    "agentRun.queued": "Cuu 已排队，稍后开始处理。",
    "question.bodyFallback": "点一个选项，Cuu 就继续往下做。",
    "question.submit": "确认选项",
    "evidence.missingSection": "缺口",
    "evidence.titleFound": "找到和「{query}」相关的证据",
    "evidence.titleDefault": "Cuu 找到了证据",
    "proposal.changesSection": "这次改了什么",
    "proposal.riskSection": "风险与回滚",
    "proposal.rollbackAvailable": "可回滚",
    "proposal.rollbackUnavailable": "不可完整回滚",
    "proposal.checksSection": "检查结果",
    "proposal.conflictTitle": "变更撞车了",
    "proposal.conflictOpenProposal": "打开变更",
    "proposal.conflictKeepCurrent": "保留正式版",
    "proposal.conflictAcceptIncoming": "采纳这次版本",
    "proposal.conflictAiFusion": "AI 融合建议",
    "proposal.conflictApplyAiFusion": "采用 AI 融合稿",
    "proposal.conflictTargetSection": "撞车对象",
    "proposal.conflictVersionSection": "版本选择",
    "workItem.open": "查看任务",
    "workItem.openProposal": "查看变更",
    "workItem.viewReplay": "查看回放",
    "workItem.startAgent": "开始 AI 执行",
    "workItem.statusSection": "当前状态",
    "workItem.readyFallback": "Cuu 已准备继续处理。",
    "workItem.acceptanceSection": "验收",
    "workItem.acceptanceFallback": "验收项 {index}",
    "workItem.startedFallback": "Cuu 开始处理这件事了。",
    "budget.scope.workitem": "任务预算",
    "budget.scope.user": "个人预算",
    "budget.scope.team": "团队预算",
    "budget.scope.eval": "评测预算",
    "budget.handle": "处理预算",
    "budget.view": "查看预算",
    "budget.exhaustedTitle": "预算用完了",
    "budget.warningTitle": "预算快到线了",
    "budget.usageDescription": "预算使用率",
    "cost.summarySection": "今日成本",
    "cost.risksSection": "预算风险",
    "cost.total": "总成本",
    "cost.input": "输入",
    "cost.output": "输出",
    "cost.remaining": "还剩 ¥{cost}",
    "cost.title": "AI 成本与预算",
    "cost.notConnected": "成本数据还没有接入。",
    "cost.usedToday": "今天已使用 ¥{cost}。",
    "replay.summarySection": "Replay 摘要",
    "replay.costSection": "成本",
    "replay.title": "执行回放已就绪",
    "replay.readyFallback": "Cuu 整理好了这次执行轨迹。",
    "event.defaultTitle": "WorkHub 更新",
    "event.defaultMessage": "Cuu 收到一条新的状态更新。",
    "offline.retryingTitle": "连接有点不稳",
    "offline.closedTitle": "WorkHub 连接断开了",
    "offline.retryingMessage": "Cuu 正在重新连接，恢复后会继续把提醒送到你这里。",
    "offline.closedMessage": "Cuu 会安静等连接回来，重要事项不会被丢掉。",
    "offline.retryingChip": "重连中",
    "offline.closedChip": "已断开",
    "state.idle": "待命",
    "state.thinking": "思考中",
    "state.asking_approval": "等你点选",
    "state.carrying_document": "拿来变更",
    "state.searching_evidence": "找到证据",
    "state.syncing_files": "同步中",
    "state.worried": "需要留意",
    "state.revision_requested": "继续修改",
    "state.celebrating": "完成了",
    "state.offline": "离线",
    "notice.prefix": "Cuu：{title}",
    "action.reasonRequired": "打回需要先选择一个原因。",
    "action.approved": "Cuu 已收到：这步已批准。",
    "action.denied": "Cuu 已带着原因打回，会继续改。",
    "action.evidenceFound": "Cuu 找到了一组项目证据。",
    "action.noEvidence": "这张证据卡里没有可绑定的证据。",
    "action.evidenceBound": "Cuu 已把这些证据放进当前任务。",
    "action.nextQuestion": "下一题：{title}",
    "pet.aria": "Cuu 桌宠",
    "pet.windowModeExpanding": "Cuu 轻卡窗口正在展开。",
    "pet.reducedMotionOffline": "Cuu 遇到连接问题，正在提醒你。",
    "pet.selectedWithLabel": "已选：{label}，点确认继续。",
    "pet.selectedFallback": "已调整选项，点确认继续。",
    "pet.optionRequired": "先点一个选项，Cuu 再继续。",
    "pet.reasonRequired": "先点一个原因，Cuu 会带着它继续改。",
    "pet.reasonDefault": "需要调整",
    "pet.actionFail": "动作提交失败，请稍后再试。",
    "pet.reject.evidence": "证据不足",
    "pet.reject.scope": "范围太大",
    "pet.reject.format": "交付格式要改",
    "pet.evidenceTitle": "证据",
    "pet.evidenceMore": "还有 {count} 条证据",
    "pet.input.optionWithText": "点选项即可，补充文字已折叠",
    "pet.input.optionOnly": "点选项即可继续",
    "pet.input.textNeeded": "Cuu 需要你补一句",
    "pet.kind.question": "澄清",
    "pet.kind.approval": "审批",
    "pet.kind.proposal": "变更",
    "pet.kind.evidence": "证据",
    "pet.kind.budget": "预算",
    "pet.kind.sync": "同步",
    "pet.kind.trace": "进度",
    "pet.kind.completion": "完成",
    "pet.kind.offline": "离线",
    "pet.kind.bubble": "提醒",
    "pet.priority.urgent": "急",
    "pet.priority.high": "高",
    "pet.priority.low": "低",
    "pet.priority.normal": "普通"
  },
  "en-US": {
    "agentRun.doneTitle": "This run is complete",
    "agentRun.attentionTitle": "This run needs attention",
    "agentRun.startedTitle": "Cuu started working",
    "agentRun.workingTitle": "Cuu is working",
    "agentRun.progressFallback": "Cuu is organizing the run progress.",
    "agentRun.viewReplay": "View replay",
    "agentRun.openWorkItem": "Back to task",
    "agentRun.abort": "Cancel run",
    "agentRun.progressSection": "Run progress",
    "agentRun.budgetSection": "Budget",
    "agentRun.handoffSection": "Handoff",
    "agentRun.queued": "Cuu is queued and will start shortly.",
    "question.bodyFallback": "Pick one option and Cuu will keep going.",
    "question.submit": "Confirm option",
    "evidence.missingSection": "Gap",
    "evidence.titleFound": "Evidence related to \"{query}\"",
    "evidence.titleDefault": "Cuu found evidence",
    "proposal.changesSection": "What changed",
    "proposal.riskSection": "Risk and rollback",
    "proposal.rollbackAvailable": "Rollback available",
    "proposal.rollbackUnavailable": "Not fully rollbackable",
    "proposal.checksSection": "Check results",
    "proposal.conflictTitle": "Change conflict",
    "proposal.conflictOpenProposal": "Open change",
    "proposal.conflictKeepCurrent": "Keep current",
    "proposal.conflictAcceptIncoming": "Use this version",
    "proposal.conflictAiFusion": "AI fusion draft",
    "proposal.conflictApplyAiFusion": "Use AI fusion draft",
    "proposal.conflictTargetSection": "Conflicting item",
    "proposal.conflictVersionSection": "Version choice",
    "workItem.open": "Open task",
    "workItem.openProposal": "Open change",
    "workItem.viewReplay": "View replay",
    "workItem.startAgent": "Start AI run",
    "workItem.statusSection": "Current status",
    "workItem.readyFallback": "Cuu is ready to continue.",
    "workItem.acceptanceSection": "Acceptance",
    "workItem.acceptanceFallback": "Acceptance item {index}",
    "workItem.startedFallback": "Cuu started working on this task.",
    "budget.scope.workitem": "Task budget",
    "budget.scope.user": "Personal budget",
    "budget.scope.team": "Team budget",
    "budget.scope.eval": "Eval budget",
    "budget.handle": "Handle budget",
    "budget.view": "View budget",
    "budget.exhaustedTitle": "Budget exhausted",
    "budget.warningTitle": "Budget is close to the limit",
    "budget.usageDescription": "Budget usage",
    "cost.summarySection": "Today's cost",
    "cost.risksSection": "Budget risks",
    "cost.total": "Total cost",
    "cost.input": "Input",
    "cost.output": "Output",
    "cost.remaining": "¥{cost} remaining",
    "cost.title": "AI cost and budget",
    "cost.notConnected": "Cost data is not connected yet.",
    "cost.usedToday": "Used ¥{cost} today.",
    "replay.summarySection": "Replay summary",
    "replay.costSection": "Cost",
    "replay.title": "Execution replay is ready",
    "replay.readyFallback": "Cuu organized this execution trace.",
    "event.defaultTitle": "WorkHub update",
    "event.defaultMessage": "Cuu received a new status update.",
    "offline.retryingTitle": "Connection is unstable",
    "offline.closedTitle": "WorkHub is disconnected",
    "offline.retryingMessage": "Cuu is reconnecting and will keep bringing important reminders back.",
    "offline.closedMessage": "Cuu will wait quietly for the connection to recover. Important items will not be lost.",
    "offline.retryingChip": "Reconnecting",
    "offline.closedChip": "Disconnected",
    "state.idle": "Idle",
    "state.thinking": "Thinking",
    "state.asking_approval": "Waiting for you",
    "state.carrying_document": "Change ready",
    "state.searching_evidence": "Evidence found",
    "state.syncing_files": "Syncing",
    "state.worried": "Needs attention",
    "state.revision_requested": "Revising",
    "state.celebrating": "Done",
    "state.offline": "Offline",
    "notice.prefix": "Cuu: {title}",
    "action.reasonRequired": "Choose a reason before sending it back.",
    "action.approved": "Cuu got it: this step is approved.",
    "action.denied": "Cuu sent it back with your reason and will keep revising.",
    "action.evidenceFound": "Cuu found a set of project evidence.",
    "action.noEvidence": "This evidence card has nothing bindable yet.",
    "action.evidenceBound": "Cuu added this evidence to the current task.",
    "action.nextQuestion": "Next question: {title}",
    "pet.aria": "Cuu desktop pet",
    "pet.windowModeExpanding": "Cuu is expanding the light card window.",
    "pet.reducedMotionOffline": "Cuu hit a connection issue and is notifying you.",
    "pet.selectedWithLabel": "Selected: {label}. Confirm to continue.",
    "pet.selectedFallback": "Selection updated. Confirm to continue.",
    "pet.optionRequired": "Choose one option before Cuu continues.",
    "pet.reasonRequired": "Choose one reason so Cuu can revise with it.",
    "pet.reasonDefault": "Needs adjustment",
    "pet.actionFail": "Action failed. Please try again later.",
    "pet.reject.evidence": "Not enough evidence",
    "pet.reject.scope": "Scope is too large",
    "pet.reject.format": "Delivery format needs work",
    "pet.evidenceTitle": "Evidence",
    "pet.evidenceMore": "{count} more evidence item(s)",
    "pet.input.optionWithText": "Choose an option; text is folded away",
    "pet.input.optionOnly": "Choose an option to continue",
    "pet.input.textNeeded": "Cuu needs one short note",
    "pet.kind.question": "Clarify",
    "pet.kind.approval": "Approval",
    "pet.kind.proposal": "Change",
    "pet.kind.evidence": "Evidence",
    "pet.kind.budget": "Budget",
    "pet.kind.sync": "Sync",
    "pet.kind.trace": "Progress",
    "pet.kind.completion": "Done",
    "pet.kind.offline": "Offline",
    "pet.kind.bubble": "Notice",
    "pet.priority.urgent": "Urgent",
    "pet.priority.high": "High",
    "pet.priority.low": "Low",
    "pet.priority.normal": "Normal"
  }
} as const satisfies Record<WorkHubLocale, Record<CuuCopyKey, string>>;

export function cuuT(locale: unknown, key: CuuCopyKey): string {
  return cuuCopy[normalizeWorkHubLocale(locale)][key];
}

export function cuuFormat(locale: unknown, key: CuuCopyKey, values: Record<string, string | number>) {
  let copy = cuuT(locale, key);
  for (const [name, value] of Object.entries(values)) {
    copy = copy.replaceAll(`{${name}}`, String(value));
  }
  return copy;
}
