// 网页金路径页面标题的用户可见文案单一来源。
// 文案 locale 独占门禁：含汉字的字面量只许住在词典文件里，见 scripts/dev/check-ui-i18n.ts。

import type { WorkHubLocale } from "@workhub/contracts";

import type { GoldPathRenderedPage } from "./render.js";

export const pageTitles: Record<WorkHubLocale, Record<GoldPathRenderedPage["key"], string>> = {
  "zh-CN": {
    home: "总览",
    projects: "项目",
    "project-home": "项目主页",
    "project-timeline": "时间线",
    intake: "新任务",
    approvals: "审批中心",
    workitem: "任务详情",
    proposal: "变更申请",
    conversation: "会话镜像",
    drive: "项目网盘",
    meetings: "会议洞察",
    notifications: "通知中心",
    calendar: "日程",
    health: "项目健康",
    replay: "执行回放",
    cost: "成本",
    agents: "AI 小组",
    knowledge: "证据检索",
    search: "搜索",
    skills: "团队技能",
    settings: "设置",
    memory: "记忆管理"
  },
  "en-US": {
    home: "Overview",
    projects: "Projects",
    "project-home": "Project Home",
    "project-timeline": "Timeline",
    intake: "New task",
    approvals: "Approval Center",
    workitem: "Task detail",
    proposal: "Change request",
    conversation: "Conversation Mirror",
    drive: "Project Drive",
    meetings: "Meeting Insights",
    notifications: "Notifications",
    calendar: "Calendar",
    health: "Project Health",
    replay: "Replay Work",
    cost: "Cost",
    agents: "AI teams",
    knowledge: "Evidence Search",
    search: "Search",
    skills: "Team Skills",
    settings: "Settings",
    memory: "Memory"
  }
};
