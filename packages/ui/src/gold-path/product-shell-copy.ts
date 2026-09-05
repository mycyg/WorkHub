// 网页产品外壳（导航 / 顶栏 / 右栏 / 指标）的用户可见文案单一来源。
// 文案 locale 独占门禁：含汉字的字面量只许住在词典文件里，见 scripts/dev/check-ui-i18n.ts。

import type { WorkHubLocale } from "@workhub/contracts";

export type ProductShellCopyKey =
  | "nav.title"
  | "nav.group.work"
  | "nav.group.assets"
  | "nav.group.team"
  | "nav.group.admin"
  | "nav.home"
  | "nav.projects"
  | "nav.approvals"
  | "nav.workitem"
  | "nav.proposal"
  | "nav.drive"
  | "nav.meetings"
  | "nav.notifications"
  | "nav.calendar"
  | "nav.replay"
  | "nav.cost"
  | "nav.agents"
  | "nav.settings"
  | "nav.intake"
  | "nav.health"
  | "nav.knowledge"
  | "nav.search"
  | "nav.skills"
  | "nav.memory"
  | "nav.project-home"
  | "nav.project-timeline"
  | "topbar.scope"
  | "topbar.admin"
  | "topbar.logout"
  | "rail.now"
  | "rail.boundary"
  | "rail.next"
  | "rail.nextHome"
  | "rail.nextProjects"
  | "rail.nextApprovals"
  | "rail.nextWorkitem"
  | "rail.nextProposal"
  | "rail.nextConversation"
  | "rail.nextDrive"
  | "rail.nextMeetings"
  | "rail.nextNotifications"
  | "rail.nextCalendar"
  | "rail.nextReplay"
  | "rail.nextCost"
  | "rail.nextSettings"
  | "rail.nextIntake"
  | "rail.nextHealth"
  | "rail.nextKnowledge"
  | "rail.nextSearch"
  | "rail.nextSkills"
  | "rail.nextMemory"
  | "metric.primary"
  | "metric.queue"
  | "metric.running"
  | "metric.pending"
  | "metric.requests"
  | "metric.deliverables"
  | "metric.files"
  | "metric.folders"
  | "metric.versions"
  | "metric.evidence"
  | "metric.checks"
  | "metric.comments"
  | "metric.steps"
  | "metric.decisions"
  | "metric.snapshots"
  | "metric.tokens"
  | "metric.cost"
  | "metric.budget"
  | "metric.locale";

export const productShellCopy: Record<WorkHubLocale, Record<ProductShellCopyKey, string>> = {
  "zh-CN": {
    "nav.title": "工作入口",
    "nav.group.work": "工作",
    "nav.group.assets": "项目资产",
    "nav.group.team": "团队",
    "nav.group.admin": "管理",
    "nav.home": "总览",
    "nav.projects": "项目",
    "nav.approvals": "审批",
    "nav.workitem": "任务",
    "nav.proposal": "变更",
    "nav.drive": "网盘",
    "nav.meetings": "会议",
    "nav.notifications": "通知",
    "nav.calendar": "日程",
    "nav.replay": "回放",
    "nav.cost": "成本",
    "nav.agents": "AI 小组",
    "nav.settings": "设置",
    "nav.intake": "提需求",
    "nav.health": "项目健康",
    "nav.knowledge": "知识",
    "nav.search": "搜索",
    "nav.skills": "技能",
    "nav.memory": "记忆",
    "nav.project-home": "本项目",
    "nav.project-timeline": "时间线",
    "topbar.scope": "网页版",
    "topbar.admin": "管理员",
    "topbar.logout": "退出",
    "rail.now": "当前焦点",
    "rail.boundary": "本地执行、文件同步和桌宠都在桌面客户端里 (=^･ω･^=)",
    "rail.next": "下一步",
    "rail.nextHome": "先挑最要紧的一件，其他的我在后台盯着 (๑˃ᴗ˂)",
    "rail.nextProjects": "打开一个项目继续推进，或新建一个。",
    "rail.nextApprovals": "写清打回原因，AI 会照着改。",
    "rail.nextWorkitem": "核对验收项、AI 轨迹和交付物。",
    "rail.nextProposal": "审查风险、证据和可回滚路径。",
    "rail.nextConversation": "这是只读镜像，完整协作请回桌面工作台。",
    "rail.nextDrive": "检查正式交付物、版本历史和评论草稿入口。",
    "rail.nextMeetings": "确认待处理洞察，再进入草稿与提议链路。",
    "rail.nextNotifications": "先处理需要你决定的通知，再归档普通消息。",
    "rail.nextCalendar": "看今天和本周的截止时间，优先处理逾期事项。",
    "rail.nextReplay": "回看执行、成本、还原点和决策记录。",
    "rail.nextCost": "看预算风险和用量异常。",
    "rail.nextSettings": "确认语言、已登录设备，以及哪些操作只能在桌面端做。",
    "rail.nextIntake": "先选方向，需要时再展开手动补充。",
    "rail.nextHealth": "先看红黄风险项，再决定要不要拍板介入。",
    "rail.nextKnowledge": "按证据来源核对，再回到对应任务或审批。",
    "rail.nextSearch": "跨会话、网盘、任务、会议一起搜——点结果直达原处，会话内容去桌面工作台看。",
    "rail.nextSkills": "看团队技能战绩与自进化记录，再决定要不要调整。",
    "rail.nextMemory": "看 AI 助手记住的关于你的偏好，或团队技能库的沿革。",
    "metric.primary": "当前焦点",
    "metric.queue": "队列",
    "metric.running": "后台运行",
    "metric.pending": "待处理",
    "metric.requests": "请求",
    "metric.deliverables": "交付物",
    "metric.files": "文件",
    "metric.folders": "文件夹",
    "metric.versions": "版本",
    "metric.evidence": "证据",
    "metric.checks": "检查",
    "metric.comments": "评论",
    "metric.steps": "步骤",
    "metric.decisions": "决策",
    "metric.snapshots": "还原点",
    "metric.tokens": "Tokens",
    "metric.cost": "成本",
    "metric.budget": "预算",
    "metric.locale": "语言"
  },
  "en-US": {
    "nav.title": "Work entry",
    "nav.group.work": "Work",
    "nav.group.assets": "Project assets",
    "nav.group.team": "Team",
    "nav.group.admin": "Admin",
    "nav.home": "Overview",
    "nav.projects": "Projects",
    "nav.approvals": "Approvals",
    "nav.workitem": "Tasks",
    "nav.proposal": "Changes",
    "nav.drive": "Drive",
    "nav.meetings": "Meetings",
    "nav.notifications": "Inbox",
    "nav.calendar": "Calendar",
    "nav.replay": "Replay",
    "nav.cost": "Cost",
    "nav.agents": "AI teams",
    "nav.settings": "Settings",
    "nav.intake": "New request",
    "nav.health": "Project health",
    "nav.knowledge": "Knowledge",
    "nav.search": "Search",
    "nav.skills": "Skills",
    "nav.memory": "Memory",
    "nav.project-home": "This project",
    "nav.project-timeline": "Timeline",
    "topbar.scope": "Web manager",
    "topbar.admin": "Admin",
    "topbar.logout": "Sign out",
    "rail.now": "Focus",
    "rail.boundary": "Local execution, file sync, and the desktop pet all live in the desktop client (=^･ω･^=)",
    "rail.next": "Next",
    "rail.nextHome": "Grab the most blocking item first — I'll watch the rest (๑˃ᴗ˂)",
    "rail.nextProjects": "Treat each project as a product — open one to start work or create a new one.",
    "rail.nextApprovals": "Say why you're sending it back — AI revises with your reason.",
    "rail.nextWorkitem": "Review acceptance, trace, and deliverables.",
    "rail.nextProposal": "Check risk, evidence, and rollback path.",
    "rail.nextConversation": "This is a read-only mirror — collaborate in the desktop workbench.",
    "rail.nextDrive": "Inspect accepted deliverables, version history, and comment draft entry points.",
    "rail.nextMeetings": "Confirm pending insights, then continue into draft and proposal review.",
    "rail.nextNotifications": "Handle decisions first, then archive routine updates.",
    "rail.nextCalendar": "Review today and this week, starting with overdue work.",
    "rail.nextReplay": "Review execution, cost, snapshots, and decisions.",
    "rail.nextCost": "Inspect budget risk and usage anomalies.",
    "rail.nextSettings": "Check your language, signed-in devices, and which actions need the desktop app.",
    "rail.nextIntake": "Pick a direction first; typing stays a collapsed fallback.",
    "rail.nextHealth": "Scan red/amber risks first, then decide whether to step in.",
    "rail.nextKnowledge": "Verify against sources, then jump back to the task or approval.",
    "rail.nextSearch": "Search chat, drive, tasks, and meetings together — click a result to jump to it; conversations open in the desktop workbench.",
    "rail.nextSkills": "Review team skills and self-evolution records before adjusting.",
    "rail.nextMemory": "Review what the AI assistant remembers about you, or the team skill library's history.",
    "metric.primary": "Focus",
    "metric.queue": "Queue",
    "metric.running": "Background",
    "metric.pending": "Pending",
    "metric.requests": "Requests",
    "metric.deliverables": "Deliverables",
    "metric.files": "Files",
    "metric.folders": "Folders",
    "metric.versions": "Versions",
    "metric.evidence": "Evidence",
    "metric.checks": "Checks",
    "metric.comments": "Comments",
    "metric.steps": "Steps",
    "metric.decisions": "Decisions",
    "metric.snapshots": "Restore points",
    "metric.tokens": "Tokens",
    "metric.cost": "Cost",
    "metric.budget": "Budget",
    "metric.locale": "Locale"
  }
};
