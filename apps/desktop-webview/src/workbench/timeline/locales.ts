// apps/desktop-webview/src/workbench/timeline 的用户可见文案单一来源。
//
// 形状照 deepseek-harness 的 per-package `locales.ts`（MIT, Copyright (c) 2026 DeepSeek）：
// **中文对象是 key 集的事实源**，英文对象用 `satisfies Record<keyof typeof zh, string>` 做
// 编译期对齐——少一个键或多一个键都编译不过，不需要额外的门禁脚本来盯对称性。
//
// 这些字符串原本以 `zh ? "中文" : "English"` 内联在渲染代码里；搬进来时一个字都没改。
// 门禁见 scripts/dev/check-ui-i18n.ts（含汉字的字面量只许住在词典文件里）。

import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

const zh = {
  addDependency: "加依赖",
  attachToMilestone: "挂到里程碑",
  blocksDownstreamWork: "阻塞后续工作项",
  cancel: "取消",
  couldnTLoadTheTimelineRetry: "没能加载时间线，稍后重试",
  create: "新建",
  createAFewMilestonesThenAttach: "先建几个里程碑，再把工作项挂上去、连出依赖，就能看到排期条和关键路径。",
  deleteMilestone: "删除里程碑",
  deleteThisMilestoneItsWorkItems: "删除这个里程碑？挂在它下面的工作项会变回未挂里程碑。",
  dueDate: "截止日期",
  editMilestone: "编辑里程碑",
  jumpToThisRow: "定位到这一行",
  loadingTimeline: "正在加载时间线…",
  markReached: "标记达成",
  milestoneName: "里程碑名称",
  milestoneNameCanTBeEmpty: "里程碑名称不能为空。",
  needs: "依赖",
  needs2: "+ 依赖",
  newMilestone: "新建里程碑",
  noDate: "未定期",
  noMilestone: "未挂里程碑",
  noTimelineYet: "还没有时间线",
  noWorkItemsHaveStartDue: "还没有工作项带开始/截止日期——填上日期后这里会画出排期条。",
  noWorkItemsUnderThisMilestone: "这个里程碑下还没有工作项",
  reached: "已达成",
  removeDependency: "解除依赖",
  reopen: "重开里程碑",
  retry: "重试",
  save: "保存",
  thatDidnTGoThroughPlease: "操作没成功，稍后再试。",
  theseOverdueItemsBlockOthers: "这些逾期项卡着别人",
  timeline: "时间线",
  today: "今天",
  unassigned: "未指派",
  unscheduled: "未排期",
  wantCuuToDraftTheWhole: "想让 Cuu 起草整份计划？切到左侧「日程」标签，点「用 Cuu 起草计划」。",
  youDonTHavePermissionFor: "你没有权限做这个改动。",
} as const;

const en = {
  addDependency: "Add dependency",
  attachToMilestone: "Attach to milestone",
  blocksDownstreamWork: "Blocks downstream work",
  cancel: "Cancel",
  couldnTLoadTheTimelineRetry: "Couldn't load the timeline — retry",
  create: "Create",
  createAFewMilestonesThenAttach: "Create a few milestones, then attach work items and link dependencies to see the schedule and critical path.",
  deleteMilestone: "Delete milestone",
  deleteThisMilestoneItsWorkItems: "Delete this milestone? Its work items go back to unassigned.",
  dueDate: "Due date",
  editMilestone: "Edit milestone",
  jumpToThisRow: "Jump to this row",
  loadingTimeline: "Loading timeline…",
  markReached: "Mark reached",
  milestoneName: "Milestone name",
  milestoneNameCanTBeEmpty: "Milestone name can't be empty.",
  needs: "needs",
  needs2: "+ needs",
  newMilestone: "New milestone",
  noDate: "No date",
  noMilestone: "No milestone",
  noTimelineYet: "No timeline yet",
  noWorkItemsHaveStartDue: "No work items have start/due dates yet — add dates to draw the schedule bars.",
  noWorkItemsUnderThisMilestone: "No work items under this milestone",
  reached: "Reached",
  removeDependency: "Remove dependency",
  reopen: "Reopen",
  retry: "Retry",
  save: "Save",
  thatDidnTGoThroughPlease: "That didn't go through — please try again.",
  theseOverdueItemsBlockOthers: "These overdue items block others",
  timeline: "Timeline",
  today: "Today",
  unassigned: "Unassigned",
  unscheduled: "Unscheduled",
  wantCuuToDraftTheWhole: "Want Cuu to draft the whole plan? Switch to the “Schedule” tab and use “Draft a plan with Cuu”.",
  youDonTHavePermissionFor: "You don't have permission for this change.",
} as const satisfies Record<keyof typeof zh, string>;

export type TimelineCopyKey = keyof typeof zh;

// 第一参数收 `boolean` 是过渡口子：这一层的渲染函数历史上大量以 `zh: boolean` 传语言，
// 把这些签名一起改成 `locale` 是另一件事，不该和「文案搬家」混在一批里。
export function timelineT(locale: WorkHubLocale | boolean, key: TimelineCopyKey): string {
  const isZh = typeof locale === "boolean" ? locale : normalizeWorkHubLocale(locale) === "zh-CN";
  return (isZh ? zh : en)[key];
}
