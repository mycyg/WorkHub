import type { WorkHubLocale } from "@workhub/contracts";

type PageCopyKey =
  | "attention.running"
  | "attention.queued"
  | "cost.scope.me"
  | "cost.scope.team"
  | "cost.scope.teamMonth"
  | "cost.label.currentUser"
  | "cost.label.teamBudget"
  | "cost.notice.warning"
  | "cost.notice.exhausted"
  | "cost.action.downgrade"
  | "cost.action.pause"
  | "cost.action.askAdmin"
  | "proposal.action.requestChanges"
  | "proposal.action.approve"
  | "proposal.action.merge"
  | "proposal.action.view"
  | "attention.proposalReview.opened"
  | "attention.proposalReview.reviewed"
  | "proposal.author.ai"
  | "proposal.author.human"
  | "replay.handoff.done"
  | "replay.handoff.remaining"
  | "replay.handoff.next"
  | "replay.handoff.blockers"
  | "replay.scope.userRun"
  | "replay.notice.warning"
  | "replay.notice.exhausted"
  | "replay.action.openCost";

const pageCopy: Record<WorkHubLocale, Record<PageCopyKey, string>> = {
  "zh-CN": {
    "attention.running": "AI 正在处理这个事项。",
    "attention.queued": "AI 已排队等待开始。",
    "cost.scope.me": "我的今日 AI 预算",
    "cost.scope.team": "团队今日 AI 预算",
    "cost.scope.teamMonth": "团队本月 AI 预算",
    "cost.label.currentUser": "当前用户",
    "cost.label.teamBudget": "团队预算",
    "cost.notice.warning": "AI 预算快用完了，建议先选择更省的执行方式。",
    "cost.notice.exhausted": "AI 预算已经用完，先暂停新的自动执行。",
    "cost.action.downgrade": "降级模型继续",
    "cost.action.pause": "先暂停",
    "cost.action.askAdmin": "找管理员",
    "proposal.action.requestChanges": "打回并说明原因",
    "proposal.action.approve": "确认通过",
    "proposal.action.merge": "合入交付物",
    "proposal.action.view": "查看变更",
    "attention.proposalReview.opened": "AI 交付了一份变更，等你确认。",
    "attention.proposalReview.reviewed": "已通过确认，可以采纳到正式版了。",
    "proposal.author.ai": "AI Reviewer",
    "proposal.author.human": "负责人",
    "replay.handoff.done": "已完成",
    "replay.handoff.remaining": "还剩",
    "replay.handoff.next": "下一步",
    "replay.handoff.blockers": "阻塞",
    "replay.scope.userRun": "我的当前 AI 执行预算",
    "replay.notice.warning": "本次 AI 预算快用完了。",
    "replay.notice.exhausted": "本次 AI 预算已经用完。",
    "replay.action.openCost": "查看预算"
  },
  "en-US": {
    "attention.running": "AI is working on this item.",
    "attention.queued": "AI is queued and waiting to start.",
    "cost.scope.me": "My AI budget today",
    "cost.scope.team": "Team AI budget today",
    "cost.scope.teamMonth": "Team AI budget this month",
    "cost.label.currentUser": "Current user",
    "cost.label.teamBudget": "Team budget",
    "cost.notice.warning": "AI budget is nearly used up. Choose a cheaper run mode first.",
    "cost.notice.exhausted": "AI budget is exhausted. Pause new automated runs first.",
    "cost.action.downgrade": "Use a cheaper model",
    "cost.action.pause": "Pause for now",
    "cost.action.askAdmin": "Ask an admin",
    "proposal.action.requestChanges": "Request changes with a reason",
    "proposal.action.approve": "Mark approved",
    "proposal.action.merge": "Merge deliverable",
    "proposal.action.view": "View changes",
    "attention.proposalReview.opened": "AI delivered a change — review it.",
    "attention.proposalReview.reviewed": "Approved — ready to accept into the official version.",
    "proposal.author.ai": "AI Reviewer",
    "proposal.author.human": "Owner",
    "replay.handoff.done": "Done",
    "replay.handoff.remaining": "Remaining",
    "replay.handoff.next": "Next",
    "replay.handoff.blockers": "Blocked",
    "replay.scope.userRun": "My current AI run budget",
    "replay.notice.warning": "This AI run is close to its budget.",
    "replay.notice.exhausted": "This AI run has used its budget.",
    "replay.action.openCost": "View budget"
  }
};

export function pageT(locale: WorkHubLocale | undefined, key: PageCopyKey) {
  return pageCopy[locale ?? "zh-CN"][key];
}
