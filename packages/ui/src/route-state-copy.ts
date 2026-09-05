// 路由态卡片（加载/空/错误/无权限/未找到）的用户可见文案与路由标签单一来源。
// 文案 locale 独占门禁：含汉字的字面量只许住在词典文件里，见 scripts/dev/check-ui-i18n.ts。

import type { WorkHubLocale } from "@workhub/contracts";

import type { R4WebRouteKey, RouteStateKind } from "./route-state.js";

export const routeInfo: Record<WorkHubLocale, Record<R4WebRouteKey, { label: string; route: string }>> = {
  "zh-CN": {
    home: { label: "总览", route: "/" },
    projects: { label: "项目", route: "/projects" },
    "project-home": { label: "项目主页", route: "/projects/:id" },
    "project-timeline": { label: "时间线", route: "/projects/:id/timeline" },
    intake: { label: "快捷入口", route: "/intake/:sessionId" },
    approvals: { label: "审批中心", route: "/approvals" },
    workitem: { label: "任务详情", route: "/workitems/:id" },
    proposal: { label: "变更申请", route: "/proposals/:id" },
    conversation: { label: "会话镜像", route: "/conversations/:id" },
    drive: { label: "项目网盘", route: "/drive" },
    meetings: { label: "会议洞察", route: "/meetings" },
    notifications: { label: "通知中心", route: "/notifications" },
    calendar: { label: "日程", route: "/calendar" },
    health: { label: "项目健康", route: "/dashboard/health" },
    replay: { label: "执行回放", route: "/agent-runs/:id/replay" },
    cost: { label: "成本仪表盘", route: "/dashboard/cost" },
    agents: { label: "AI 小组", route: "/dashboard/agents" },
    knowledge: { label: "证据检索", route: "/knowledge/search" },
    search: { label: "搜索", route: "/dashboard/search" },
    skills: { label: "团队技能", route: "/dashboard/skills" },
    settings: { label: "设置", route: "/settings" },
    memory: { label: "记忆管理", route: "/settings/memory" }
  },
  "en-US": {
    home: { label: "Overview", route: "/" },
    projects: { label: "Projects", route: "/projects" },
    "project-home": { label: "Project home", route: "/projects/:id" },
    "project-timeline": { label: "Timeline", route: "/projects/:id/timeline" },
    intake: { label: "Intake", route: "/intake/:sessionId" },
    approvals: { label: "Approval center", route: "/approvals" },
    workitem: { label: "Task detail", route: "/workitems/:id" },
    proposal: { label: "Change request", route: "/proposals/:id" },
    conversation: { label: "Conversation mirror", route: "/conversations/:id" },
    drive: { label: "Project drive", route: "/drive" },
    meetings: { label: "Meeting insights", route: "/meetings" },
    notifications: { label: "Notifications", route: "/notifications" },
    calendar: { label: "Calendar", route: "/calendar" },
    health: { label: "Project health", route: "/dashboard/health" },
    replay: { label: "Run replay", route: "/agent-runs/:id/replay" },
    cost: { label: "Cost dashboard", route: "/dashboard/cost" },
    agents: { label: "AI teams", route: "/dashboard/agents" },
    knowledge: { label: "Evidence search", route: "/knowledge/search" },
    search: { label: "Search", route: "/dashboard/search" },
    skills: { label: "Team skills", route: "/dashboard/skills" },
    settings: { label: "Settings", route: "/settings" },
    memory: { label: "Memory", route: "/settings/memory" }
  }
};

export const stateCopy: Record<WorkHubLocale, Record<RouteStateKind, { title: string; body: string; action: string }>> = {
  "zh-CN": {
    loading: {
      title: "正在加载",
      body: "正在读取最新数据，稍等一下。",
      action: "保持等待"
    },
    empty: {
      title: "现在没有需要处理的任务",
      body: "这里暂时没有内容，可以新建、返回或查看历史。",
      action: "回到总览"
    },
    error: {
      title: "页面暂时加载失败",
      body: "已记录出错信息，你可以重试；需要时把这一页发给技术同事帮忙排查。",
      action: "重试"
    },
    forbidden: {
      title: "你没有权限查看",
      body: "这部分内容需要授权，请联系有权限的人开通。",
      action: "申请访问"
    },
    notFound: {
      title: "没有找到这个页面",
      body: "链接可能已经失效，或这条内容已被删除、移动。",
      action: "返回首页"
    }
  },
  "en-US": {
    loading: {
      title: "Loading",
      body: "Fetching the latest from the server.",
      action: "Keep waiting"
    },
    empty: {
      title: "Nothing needs action right now",
      body: "Nothing here yet. Create something new, or head back to the overview.",
      action: "Back to overview"
    },
    error: {
      title: "This page failed to load",
      body: "The error is recorded. Try again — if it keeps failing, send this page to your admin.",
      action: "Retry"
    },
    forbidden: {
      title: "You do not have access",
      body: "This area needs permission. Ask someone with access to grant it.",
      action: "Request access"
    },
    notFound: {
      title: "We couldn't find this page",
      body: "The link may be broken, or this item was moved or deleted.",
      action: "Back to home"
    }
  }
};
