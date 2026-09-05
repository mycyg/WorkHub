import type { WorkHubLocale } from "@workhub/contracts";

export type PageCopyKey =
  | "attention.running"
  | "attention.queued"
  | "cost.scope.me"
  | "cost.scope.team"
  | "cost.scope.teamMonth"
  | "cost.label.currentUser"
  | "cost.label.teamBudget"
  | "cost.label.system"
  | "cost.notice.warning"
  | "cost.notice.exhausted"
  | "cost.action.downgrade"
  | "cost.action.pause"
  | "cost.action.askAdmin"
  | "proposal.action.requestChanges"
  | "proposal.action.requestPlanChanges"
  | "proposal.action.approve"
  | "proposal.action.approvePlan"
  | "proposal.action.approvePlanAndStart"
  | "proposal.action.approvePlanHold"
  | "proposal.action.skipPlanSingleRun"
  | "proposal.action.merge"
  | "proposal.action.mergePlan"
  | "proposal.action.view"
  | "proposal.action.viewPlan"
  | "attention.proposalReview.opened"
  | "attention.proposalReview.reviewed"
  | "attention.planReview.opened"
  | "attention.planReview.reviewed"
  | "proposal.author.ai"
  | "proposal.author.human"
  | "replay.handoff.done"
  | "replay.handoff.remaining"
  | "replay.handoff.next"
  | "replay.handoff.blockers"
  | "replay.scope.userRun"
  | "replay.notice.warning"
  | "replay.notice.exhausted"
  | "replay.action.openCost"
  | "cost.label.removedMember"
  | "cost.label.untitledWorkItem"
  | "audit.workItemCreated"
  | "audit.workItemUpdated"
  | "audit.workItemAssigned"
  | "audit.workItemClaimed"
  | "audit.snapshotCreated"
  | "audit.snapshotReverted"
  | "audit.proposalOpened"
  | "audit.proposalMerged"
  | "audit.proposalRejected"
  | "audit.approvalApproved"
  | "audit.approvalRejected"
  | "audit.projectArchived"
  | "audit.projectDeleted"
  | "audit.genericChange";

const pageCopy: Record<WorkHubLocale, Record<PageCopyKey, string>> = {
  "zh-CN": {
    "attention.running": "AI 正在处理这个任务。",
    "attention.queued": "AI 已排队等待开始。",
    "cost.scope.me": "我的今日 AI 预算",
    "cost.scope.team": "团队今日 AI 预算",
    "cost.scope.teamMonth": "团队本月 AI 预算",
    "cost.label.currentUser": "当前用户",
    "cost.label.teamBudget": "团队预算",
    "cost.label.system": "系统（无执行者）",
    "cost.notice.warning": "AI 预算快用完了，建议先选择更省的执行方式。",
    "cost.notice.exhausted": "AI 预算已经用完，先暂停新的自动执行。",
    "cost.action.downgrade": "降级模型继续",
    "cost.action.pause": "先暂停",
    "cost.action.askAdmin": "找管理员",
    "proposal.action.requestChanges": "打回并说明原因",
    "proposal.action.requestPlanChanges": "打回重拆",
    "proposal.action.approve": "确认通过",
    "proposal.action.approvePlan": "确认计划",
    "proposal.action.approvePlanAndStart": "批准并开始执行",
    "proposal.action.approvePlanHold": "批准但先不跑",
    "proposal.action.skipPlanSingleRun": "先不拆，单个 AI 跑",
    "proposal.action.merge": "采纳进正式版",
    "proposal.action.mergePlan": "批准任务计划",
    "proposal.action.view": "查看变更",
    "proposal.action.viewPlan": "查看计划提议",
    "attention.proposalReview.opened": "AI 交付了一份变更，等你确认。",
    "attention.proposalReview.reviewed": "已通过确认，可以采纳到正式版了。",
    "attention.planReview.opened": "任务已拆成任务计划，等你确认后再开始执行。",
    "attention.planReview.reviewed": "计划已确认，可以批准为待开始计划。",
    "proposal.author.ai": "AI 审阅员",
    "proposal.author.human": "负责人",
    "replay.handoff.done": "已完成",
    "replay.handoff.remaining": "还剩",
    "replay.handoff.next": "下一步",
    "replay.handoff.blockers": "阻塞",
    "replay.scope.userRun": "我的当前 AI 执行预算",
    "replay.notice.warning": "本次 AI 预算快用完了。",
    "replay.notice.exhausted": "本次 AI 预算已经用完。",
    "replay.action.openCost": "查看预算",
    "cost.label.removedMember": "已停用成员",
    "cost.label.untitledWorkItem": "未命名任务",
    "audit.workItemCreated": "创建了任务",
    "audit.workItemUpdated": "更新了任务",
    "audit.workItemAssigned": "指派了任务",
    "audit.workItemClaimed": "认领了任务",
    "audit.snapshotCreated": "保存了还原点",
    "audit.snapshotReverted": "还原了文件",
    "audit.proposalOpened": "提出了这次改动",
    "audit.proposalMerged": "采纳了这次改动",
    "audit.proposalRejected": "打回了这次改动",
    "audit.approvalApproved": "通过了审批",
    "audit.approvalRejected": "打回了审批",
    "audit.projectArchived": "归档了项目",
    "audit.projectDeleted": "删除了项目",
    "audit.genericChange": "记录了一次改动"
  },
  "en-US": {
    "attention.running": "AI is working on this item.",
    "attention.queued": "AI is queued and waiting to start.",
    "cost.scope.me": "My AI budget today",
    "cost.scope.team": "Team AI budget today",
    "cost.scope.teamMonth": "Team AI budget this month",
    "cost.label.currentUser": "Current user",
    "cost.label.teamBudget": "Team budget",
    "cost.label.system": "System (no run owner)",
    "cost.notice.warning": "AI budget is nearly used up. Choose a cheaper run mode first.",
    "cost.notice.exhausted": "AI budget is exhausted. Pause new automated runs first.",
    "cost.action.downgrade": "Use a cheaper model",
    "cost.action.pause": "Pause for now",
    "cost.action.askAdmin": "Ask an admin",
    "proposal.action.requestChanges": "Request changes with a reason",
    "proposal.action.requestPlanChanges": "Request replan",
    "proposal.action.approve": "Mark approved",
    "proposal.action.approvePlan": "Approve plan",
    "proposal.action.approvePlanAndStart": "Approve and start",
    "proposal.action.approvePlanHold": "Approve but hold",
    "proposal.action.skipPlanSingleRun": "Skip the plan — run one AI",
    "proposal.action.merge": "Adopt into the official version",
    "proposal.action.mergePlan": "Approve task plan",
    "proposal.action.view": "View changes",
    "proposal.action.viewPlan": "View plan proposal",
    "attention.proposalReview.opened": "AI delivered a change — review it.",
    "attention.proposalReview.reviewed": "Approved — ready to accept into the official version.",
    "attention.planReview.opened": "AI decomposed this into a task plan. Review it before work starts.",
    "attention.planReview.reviewed": "Plan reviewed — approve it when you are ready to start.",
    "proposal.author.ai": "AI Reviewer",
    "proposal.author.human": "Owner",
    "replay.handoff.done": "Done",
    "replay.handoff.remaining": "Remaining",
    "replay.handoff.next": "Next",
    "replay.handoff.blockers": "Blocked",
    "replay.scope.userRun": "My current AI run budget",
    "replay.notice.warning": "This AI run is close to its budget.",
    "replay.notice.exhausted": "This AI run has used its budget.",
    "replay.action.openCost": "View budget",
    "cost.label.removedMember": "Removed member",
    "cost.label.untitledWorkItem": "Untitled task",
    "audit.workItemCreated": "Created the task",
    "audit.workItemUpdated": "Updated the task",
    "audit.workItemAssigned": "Assigned the task",
    "audit.workItemClaimed": "Claimed the task",
    "audit.snapshotCreated": "Saved a restore point",
    "audit.snapshotReverted": "Restored the files",
    "audit.proposalOpened": "Proposed this change",
    "audit.proposalMerged": "Adopted this change",
    "audit.proposalRejected": "Sent this change back",
    "audit.approvalApproved": "Approved the request",
    "audit.approvalRejected": "Sent the request back",
    "audit.projectArchived": "Archived the project",
    "audit.projectDeleted": "Deleted the project",
    "audit.genericChange": "Recorded a change"
  }
};

export function pageT(locale: WorkHubLocale | undefined, key: PageCopyKey) {
  return pageCopy[locale ?? "zh-CN"][key];
}
