// apps/desktop-webview/src/workbench/kanban 的用户可见文案单一来源。
//
// 形状照 deepseek-harness 的 per-package `locales.ts`（MIT, Copyright (c) 2026 DeepSeek）：
// **中文对象是 key 集的事实源**，英文对象用 `satisfies Record<keyof typeof zh, string>` 做
// 编译期对齐——少一个键或多一个键都编译不过，不需要额外的门禁脚本来盯对称性。
//
// 这些字符串原本以 `zh ? "中文" : "English"` 内联在渲染代码里；搬进来时一个字都没改。
// 门禁见 scripts/dev/check-ui-i18n.ts（含汉字的字面量只许住在词典文件里）。

import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

const zh = {
  allAssignees: "全部负责人",
  blocksDownstreamWork: "阻塞后续工作项",
  clear: "清除筛选",
  completedItemsCanTBeDragged: "已完成的项不能拖回进行中。",
  couldnTLoadTheBoardRetry: "没能加载任务看板，稍后重试",
  describeTheWorkInTheProject: "在项目主区对话里把要做的事讲清楚，澄清完成后就会作为工作项出现在这里的「待认领」列。",
  dragAReadyCardIntoIn: "拖「待开工」卡到「进行中」即派 AI 开工；其它移动会说明该去哪儿办",
  filterByAssignee: "按负责人筛选",
  filterByKeyword: "按关键词筛选",
  itemsAlreadyInProgressReviewDone: "已经开工/评审/完成的项不能拖回待认领。要退回重做，请在右栏「提议」面板点「要求修改」。",
  itemsInReviewAreCompletedBy: "评审中的项要在右栏「提议」面板批准合并，通过后才算完成——不能直接拖到已完成。",
  loadingBoard: "正在加载任务看板…",
  noDate: "未定期",
  noItemsInThisColumn: "这一列还没有工作项",
  noMatchingTasks: "没有匹配的任务",
  noTasksYet: "还没有任务",
  openThisItemOnTheTimeline: "点击查看这件在时间线上的位置",
  overdue: "逾期",
  retry: "重试",
  reviewIsEnteredAutomaticallyWhenThe: "评审是 AI 跑完自动进入的——AI 完成后会把成果提交评审并开出提议，不用手动拖到这里。",
  searchTitleCode: "搜索标题 / 编号",
  thatDidnTGoThroughPlease: "操作没成功，稍后再试。",
  thisItemIsStillBeingClarified: "这件还在澄清阶段（需求还没聊清楚）。先在项目主区对话里把它澄清成「待开工」，才能派给 AI 开工。",
  toSendAReviewingItemBack: "评审中的项要退回重做，请在右栏「提议」面板点「要求修改」并写明原因，不能直接拖回进行中。",
  tryAnotherAssigneeOrKeywordOr: "换个负责人或关键词，或清除筛选。",
  unassigned: "未指派",
  workItemsReachDoneOnlyAfter: "工作项要先开工、提交评审、评审通过合并后才算完成，不能直接标记完成。",
  youDonTHavePermissionTo: "你没有权限在这件工作项上启动 AI。",
} as const;

const en = {
  allAssignees: "All assignees",
  blocksDownstreamWork: "Blocks downstream work",
  clear: "Clear",
  completedItemsCanTBeDragged: "Completed items can't be dragged back to In progress.",
  couldnTLoadTheBoardRetry: "Couldn't load the board — retry",
  describeTheWorkInTheProject: "Describe the work in the project chat — once it's clarified it shows up here as a work item in To do.",
  dragAReadyCardIntoIn: "Drag a Ready card into In progress to start the AI; other moves explain where to go",
  filterByAssignee: "Filter by assignee",
  filterByKeyword: "Filter by keyword",
  itemsAlreadyInProgressReviewDone: "Items already in progress/review/done can't be dragged back. To send work back, use “Request changes” on its proposal.",
  itemsInReviewAreCompletedBy: "Items in review are completed by approving their proposal in the side panel — you can't drag them straight to Done.",
  loadingBoard: "Loading board…",
  noDate: "No date",
  noItemsInThisColumn: "No items in this column",
  noMatchingTasks: "No matching tasks",
  noTasksYet: "No tasks yet",
  openThisItemOnTheTimeline: "Open this item on the timeline",
  overdue: "overdue",
  retry: "Retry",
  reviewIsEnteredAutomaticallyWhenThe: "Review is entered automatically when the AI finishes and opens a proposal — you can't drag an item into review.",
  searchTitleCode: "Search title / code",
  thatDidnTGoThroughPlease: "That didn't go through — please try again.",
  thisItemIsStillBeingClarified: "This item is still being clarified. Finish clarifying it in the project chat until it's Ready, then start the AI on it.",
  toSendAReviewingItemBack: "To send a reviewing item back for rework, use “Request changes” on its proposal — dragging won't do it.",
  tryAnotherAssigneeOrKeywordOr: "Try another assignee or keyword, or clear the filter.",
  unassigned: "Unassigned",
  workItemsReachDoneOnlyAfter: "Work items reach Done only after being worked, reviewed, and merged — not by dragging.",
  youDonTHavePermissionTo: "You don't have permission to start the AI on this item.",
} as const satisfies Record<keyof typeof zh, string>;

export type KanbanCopyKey = keyof typeof zh;

// 第一参数收 `boolean` 是过渡口子：这一层的渲染函数历史上大量以 `zh: boolean` 传语言，
// 把这些签名一起改成 `locale` 是另一件事，不该和「文案搬家」混在一批里。
export function kanbanT(locale: WorkHubLocale | boolean, key: KanbanCopyKey): string {
  const isZh = typeof locale === "boolean" ? locale : normalizeWorkHubLocale(locale) === "zh-CN";
  return (isZh ? zh : en)[key];
}
