import type { GoldPathAppShell, GoldPathAppShellOptions } from "./app-shell.js";
import { buildGoldPathRouteMap, resolveGoldPathPageKey } from "./app-shell.js";
import { goldPathT, normalizeWorkHubLocale, workHubLocaleOptions, type WorkHubLocale } from "./i18n.js";
import type { GoldPathRenderedPage, GoldPathRenderedSurface } from "./render.js";
import type { WebRouteComponentMap } from "./route-components.js";

export type WebProductMetric = {
  id: string;
  label: string;
  value: string;
};

export type WebProductShellPage = GoldPathRenderedPage & {
  metrics?: WebProductMetric[] | undefined;
};

export type WebProductShellSurface = Omit<GoldPathRenderedSurface, "pages" | "vm"> & {
  vm?: GoldPathRenderedSurface["vm"] | undefined;
  pages: WebProductShellPage[];
};

export type WebProductShellCurrentUser = {
  nickname: string;
  isAdmin: boolean;
};

export type WebProductShellOptions = GoldPathAppShellOptions & {
  currentUser?: WebProductShellCurrentUser | undefined;
  routeComponents?: WebRouteComponentMap | undefined;
  renderActivePanelOnly?: boolean | undefined;
};

type ProductShellCopyKey =
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
  | "topbar.rest"
  | "topbar.admin"
  | "topbar.logout"
  | "rail.now"
  | "rail.source"
  | "rail.refresh"
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
  | "masthead.home"
  | "masthead.projects"
  | "masthead.approvals"
  | "masthead.workitem"
  | "masthead.proposal"
  | "masthead.drive"
  | "masthead.meetings"
  | "masthead.notifications"
  | "masthead.calendar"
  | "masthead.replay"
  | "masthead.cost"
  | "masthead.settings"
  | "masthead.intake"
  | "masthead.health"
  | "masthead.knowledge"
  | "masthead.skills"
  | "masthead.memory"
  | "metric.primary"
  | "metric.queue"
  | "metric.running"
  | "metric.pending"
  | "metric.requests"
  | "metric.trace"
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

const productShellCopy: Record<WorkHubLocale, Record<ProductShellCopyKey, string>> = {
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
    "nav.agents": "军团",
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
    "topbar.rest": "实时数据",
    "topbar.admin": "管理员",
    "topbar.logout": "退出",
    "rail.now": "当前焦点",
    "rail.source": "数据源",
    "rail.refresh": "有新动态会自动刷新，数据以后台为准。",
    "rail.boundary": "本地执行、文件同步和桌宠都在桌面客户端里 (=^･ω･^=)",
    "rail.next": "下一步",
    "rail.nextHome": "先挑最要紧的一件，其他的我在后台盯着 (๑˃ᴗ˂)",
    "rail.nextProjects": "把每个项目当产品看，打开一个继续推进，或新建一个。",
    "rail.nextApprovals": "打回理由会回灌给 AI 继续改。",
    "rail.nextWorkitem": "核对验收项、AI 轨迹和交付物。",
    "rail.nextProposal": "审查风险、证据和可回滚路径。",
    "rail.nextConversation": "这是只读镜像，完整协作请回桌面工作台。",
    "rail.nextDrive": "检查正式交付物、版本历史和评论草稿入口。",
    "rail.nextMeetings": "确认待处理洞察，再进入草稿与提议链路。",
    "rail.nextNotifications": "先处理需要你决定的通知，再归档普通消息。",
    "rail.nextCalendar": "看今天和本周的截止时间，优先处理逾期事项。",
    "rail.nextReplay": "回看执行、成本、快照和决策记录。",
    "rail.nextCost": "看预算风险和用量异常。",
    "rail.nextSettings": "确认语言、设备和运行时边界。",
    "rail.nextIntake": "先选方向，需要时再展开手动补充。",
    "rail.nextHealth": "先看红黄风险项，再决定要不要拍板介入。",
    "rail.nextKnowledge": "按证据来源核对，再回到对应任务或审批。",
    "rail.nextSearch": "跨会话、网盘、任务、会议一起搜——点结果直达原处，会话内容去桌面工作台看。",
    "rail.nextSkills": "看团队技能战绩与自进化记录，再决定要不要调整。",
    "rail.nextMemory": "看 AI 助手记住的关于你的偏好，或团队技能库的沿革。",
    "masthead.home": "默认只把最该你拿主意的一件事放在最前，其它在后台安静运行。",
    "masthead.projects": "项目即产品：每个项目汇总进行中工作项、负责人和最近更新，像仓库索引一样一眼看全。",
    "masthead.approvals": "把需要你拍板的审批、理由、超时提醒和后续操作集中在一起。",
    "masthead.workitem": "任务详情把验收项、证据、AI 工作过程和最近变更放在一起。",
    "masthead.proposal": "变更申请像代码评审一样清楚，但面向文档、表格、文件和版本。",
    "masthead.drive": "项目网盘汇总正式交付物、当前版本、历史版本，以及由评论生成的草稿。",
    "masthead.meetings": "会议洞察把转写、纪要、AI 推荐理由和草稿入口放在同一个项目里。",
    "masthead.notifications": "通知中心按‘待决定’‘了解一下’‘已处理’分组，每条都能回到原始事项。",
    "masthead.calendar": "日程汇总会议后续、任务截止时间和可安排的时间段。",
    "masthead.replay": "完整回看 AI 当时怎么做、花了多少、采纳和回退了什么。",
    "masthead.cost": "成本页按成员、团队、任务和模型拆解预算情况。",
    "masthead.settings": "设置页只管运行和设备，桌宠形象在独立窗口里设置。",
    "masthead.intake": "提需求先选方向，也可以展开手动输入补充。",
    "masthead.health": "项目健康把风险信号、阻塞项和需要你介入的地方汇总在一起。",
    "masthead.knowledge": "证据检索把来源、片段和回链放在一起，便于核对事实。",
    "masthead.skills": "团队技能页汇总成员技能、AI 自进化战绩和成本分账。",
    "masthead.memory": "关于我记录 AI 助手学到的关于你的偏好；团队技能是团队共享的可复用技能库。",
    "metric.primary": "当前焦点",
    "metric.queue": "队列",
    "metric.running": "后台运行",
    "metric.pending": "待处理",
    "metric.requests": "请求",
    "metric.trace": "轨迹",
    "metric.deliverables": "交付物",
    "metric.files": "文件",
    "metric.folders": "文件夹",
    "metric.versions": "版本",
    "metric.evidence": "证据",
    "metric.checks": "检查",
    "metric.comments": "评论",
    "metric.steps": "步骤",
    "metric.decisions": "决策",
    "metric.snapshots": "快照",
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
    "nav.agents": "Agent teams",
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
    "topbar.rest": "Live data",
    "topbar.admin": "Admin",
    "topbar.logout": "Sign out",
    "rail.now": "Focus",
    "rail.source": "Data source",
    "rail.refresh": "Updates refresh automatically; the backend stays the source of truth.",
    "rail.boundary": "Local execution, file sync, and the desktop pet all live in the desktop client (=^･ω･^=)",
    "rail.next": "Next",
    "rail.nextHome": "Grab the most blocking item first — I'll watch the rest (๑˃ᴗ˂)",
    "rail.nextProjects": "Treat each project as a product — open one to start work or create a new one.",
    "rail.nextApprovals": "Rejection reasons flow back into AI work.",
    "rail.nextWorkitem": "Review acceptance, trace, and deliverables.",
    "rail.nextProposal": "Check risk, evidence, and rollback path.",
    "rail.nextConversation": "This is a read-only mirror — collaborate in the desktop workbench.",
    "rail.nextDrive": "Inspect accepted deliverables, version history, and comment draft entry points.",
    "rail.nextMeetings": "Confirm pending insights, then continue into draft and proposal review.",
    "rail.nextNotifications": "Handle decisions first, then archive routine updates.",
    "rail.nextCalendar": "Review today and this week, starting with overdue work.",
    "rail.nextReplay": "Review execution, cost, snapshots, and decisions.",
    "rail.nextCost": "Inspect budget risk and usage anomalies.",
    "rail.nextSettings": "Confirm locale, device, and runtime boundaries.",
    "rail.nextIntake": "Pick a direction first; typing stays a collapsed fallback.",
    "rail.nextHealth": "Scan red/amber risks first, then decide whether to step in.",
    "rail.nextKnowledge": "Verify against sources, then jump back to the task or approval.",
    "rail.nextSearch": "Search chat, drive, tasks, and meetings together — click a result to jump to it; conversations open in the desktop workbench.",
    "rail.nextSkills": "Review team skills and self-evolution records before adjusting.",
    "rail.nextMemory": "Review what the AI assistant remembers about you, or the team skill library's history.",
    "masthead.home": "The default view offers one decision first while background work stays secondary.",
    "masthead.projects": "Projects as products: each project rolls up open work, owner, and latest activity like a repo index.",
    "masthead.approvals": "A blocking inbox for approvals, reasons, SLA, and follow-up execution.",
    "masthead.workitem": "Task detail keeps acceptance, evidence, AI trace, and recent change together.",
    "masthead.proposal": "Change requests read like PRs, but cover documents, sheets, files, and versions.",
    "masthead.drive": "Project drive shows accepted deliverables, current versions, history, and comment-to-draft signals.",
    "masthead.meetings": "Meeting insights keep transcript, minutes, AI rationale, and draft actions in one project context.",
    "masthead.notifications": "Notifications group decisions, FYI updates, and done items while actions link back to source facts.",
    "masthead.calendar": "Calendar gathers meeting follow-ups, task due dates, and review windows.",
    "masthead.replay": "A read-only explanation of how AI executed, spent, accepted, and rolled back.",
    "masthead.cost": "Cost breaks budget risk down by person, team, task, and model.",
    "masthead.settings": "Settings are for runtime and device controls, not character presentation.",
    "masthead.intake": "Intake starts with choices; typing remains a collapsed fallback.",
    "masthead.health": "Project health gathers risk signals, blockers, and spots that need your call.",
    "masthead.knowledge": "Evidence search keeps sources, snippets, and back-links together for fact-checking.",
    "masthead.skills": "Team skills summarize member skills, AI self-evolution records, and cost split.",
    "masthead.memory": "About me tracks what the AI assistant has learned about you; team skills is the shared, reusable skill library.",
    "metric.primary": "Focus",
    "metric.queue": "Queue",
    "metric.running": "Background",
    "metric.pending": "Pending",
    "metric.requests": "Requests",
    "metric.trace": "Trace",
    "metric.deliverables": "Deliverables",
    "metric.files": "Files",
    "metric.folders": "Folders",
    "metric.versions": "Versions",
    "metric.evidence": "Evidence",
    "metric.checks": "Checks",
    "metric.comments": "Comments",
    "metric.steps": "Steps",
    "metric.decisions": "Decisions",
    "metric.snapshots": "Snapshots",
    "metric.tokens": "Tokens",
    "metric.cost": "Cost",
    "metric.budget": "Budget",
    "metric.locale": "Locale"
  }
};

const productShellCss = [
  // R10-S1 液态玻璃：web 与桌面 .wh-ds 同源基调——柔和渐变底 + 半透明玻璃层(backdrop-filter 在普通
  // 浏览器可用,Tauri 透明窗的限制不适用于 web) + 大圆角分级(lg=18/md=12)。语义色不动；
  // muted 从 #9AA0AC 提到 #646E7E(白底约 5:1,玻璃上仍达标)。不支持 backdrop-filter 或
  // prefers-reduced-transparency 时在文末降级为实底。
  ":root{color-scheme:light;--wh-product-ink:#1A1D26;--wh-product-secondary:#5B616E;--wh-product-muted:#646E7E;--wh-product-faint:#C8CCD4;--wh-product-line:#E6E7EB;--wh-product-line-alt:#EEF0F3;--wh-product-blue:#4F46E5;--wh-product-accent:#4F46E5;--wh-product-blue-light:#EEF0FE;--wh-product-blue-tint:#F5F5FE;--wh-product-blue-pale:#D9DBF5;--wh-product-green:#15A05A;--wh-product-green-light:#E7F0EA;--wh-product-green-lighter:#E7F6EE;--wh-product-red:#E5484D;--wh-product-red-light:#FCECEC;--wh-product-coral:#ee6b5f;--wh-product-amber:#E0892A;--wh-product-amber-light:#FCF3E6;--wh-product-paper:#fff;--wh-product-panel:#fff;--wh-product-page:#F3F5F9;--wh-product-soft:#F5F5FE;--wh-glass:rgba(255,255,255,.58);--wh-glass-strong:rgba(255,255,255,.76);--wh-glass-line:rgba(255,255,255,.72);--wh-glass-blur:saturate(1.5) blur(20px);--wh-radius-lg:18px;--wh-radius-md:12px}",
  "body{margin:0;background:radial-gradient(1100px 640px at 6% -8%,rgba(79,70,229,.10) 0%,rgba(79,70,229,0) 55%),radial-gradient(900px 560px at 102% -2%,rgba(21,160,90,.08) 0%,rgba(21,160,90,0) 52%),radial-gradient(760px 520px at 88% 104%,rgba(238,107,95,.07) 0%,rgba(238,107,95,0) 55%),var(--wh-product-page);background-attachment:fixed;color:var(--wh-product-ink);overflow-x:hidden}",
  ".wh-product-root{min-height:100vh;background:transparent;font-family:\"Segoe UI\",system-ui,-apple-system,\"Microsoft YaHei\",\"PingFang SC\",sans-serif;color:var(--wh-product-ink)}",
  ".wh-product-root,.wh-product-root *{box-sizing:border-box;min-width:0}",
  ".wh-product-topbar{position:sticky;top:0;z-index:30;height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--wh-glass-line);background:var(--wh-glass-strong);backdrop-filter:var(--wh-glass-blur);-webkit-backdrop-filter:var(--wh-glass-blur);box-shadow:0 10px 30px rgba(37,51,79,.06);padding:0 22px;overflow:hidden}",
  ".wh-product-brand{display:flex;align-items:center;gap:10px;color:var(--wh-product-ink);text-decoration:none;font-weight:900;min-width:0}.wh-product-brand-mark{position:relative;width:30px;height:30px;border-radius:10px;background:linear-gradient(145deg,#6D8BFF 0%,var(--wh-product-blue) 48%,#7C3AED 100%);box-shadow:0 8px 22px rgba(79,70,229,.32),inset 0 1px 1px rgba(255,255,255,.65);overflow:hidden;flex:0 0 auto}.wh-product-brand-mark::before{content:\"\";position:absolute;inset:0;background:radial-gradient(130% 90% at 18% -4%,rgba(255,255,255,.6) 0%,rgba(255,255,255,.14) 42%,rgba(255,255,255,0) 62%)}.wh-product-brand-mark::after{content:\"\";position:absolute;left:8px;top:8px;width:14px;height:14px;border-radius:6px;background:rgba(255,255,255,.28);border:1px solid rgba(255,255,255,.75);box-shadow:inset 0 1px 3px rgba(255,255,255,.6),0 3px 8px rgba(30,27,75,.28)}.wh-product-brand span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-product-top-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;min-width:0;flex:1 1 auto}.wh-product-user{display:flex;align-items:center;gap:8px;min-width:0;max-width:240px}.wh-product-user-name{color:var(--wh-product-ink);font-size:12px;font-weight:850;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wh-product-user .wh-product-rail-tag{flex:0 0 auto}.wh-product-logout{border:1px solid var(--wh-product-line);border-radius:999px;background:#fff;color:var(--wh-product-muted);font-size:11px;font-weight:850;line-height:1.35;padding:5px 10px;cursor:pointer;flex:0 0 auto;font-family:inherit}.wh-product-logout:hover{color:var(--wh-product-ink)}.wh-product-runtime{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0;max-width:100%;overflow:hidden;color:var(--wh-product-muted);font-size:12px;font-weight:800}.wh-product-runtime span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wh-product-runtime-dot{width:8px;height:8px;border-radius:999px;background:var(--wh-product-green);box-shadow:0 0 0 4px rgba(36,166,106,.12);flex:0 0 auto}",
  ".wh-locale-toggle{display:grid;grid-template-columns:repeat(2,42px);gap:2px;border:1px solid var(--wh-glass-line);border-radius:var(--wh-radius-md);background:rgba(238,243,249,.72);padding:2px;flex:0 0 auto}.wh-locale-toggle button{height:28px;border:0;border-radius:9px;background:transparent;color:var(--wh-product-muted);font-weight:850;font-size:12px;line-height:1.35;cursor:pointer}.wh-locale-toggle button[aria-pressed=true]{background:#fff;color:var(--wh-product-blue);box-shadow:0 5px 14px rgba(37,51,79,.1)}",
  ".wh-product-layout{display:grid;grid-template-columns:218px minmax(0,1fr) 276px;gap:0;min-height:calc(100vh - 64px);width:100%;overflow:hidden}.wh-product-nav{display:grid;gap:18px;align-content:start;border-right:1px solid var(--wh-glass-line);background:rgba(255,255,255,.42);backdrop-filter:var(--wh-glass-blur);-webkit-backdrop-filter:var(--wh-glass-blur);padding:18px 12px;overflow-y:auto;overflow-x:hidden}.wh-product-nav-group{display:grid;gap:4px}.wh-product-nav-title{margin:2px 10px 4px;color:var(--wh-product-muted);font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.wh-product-nav-list{display:grid;gap:4px}.wh-product-nav a.wh-product-nav-cta{display:flex;flex-direction:row;align-items:center;justify-content:center;gap:6px;margin:0 2px 2px;border-radius:var(--wh-radius-md);background:var(--wh-product-blue);color:#fff;font-size:14px;font-weight:850;text-decoration:none;padding:11px 12px;box-shadow:0 10px 26px rgba(79,70,229,.28)}.wh-product-nav a.wh-product-nav-cta:hover{filter:brightness(1.06);background:var(--wh-product-blue)}.wh-product-nav a.wh-product-nav-cta[aria-current=page]{box-shadow:0 0 0 2px rgba(79,70,229,.35),0 10px 26px rgba(79,70,229,.28);background:var(--wh-product-blue);color:#fff}.wh-product-nav-group-toggle{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;margin:0;border:0;background:transparent;padding:8px 10px;border-radius:var(--wh-radius-md);color:var(--wh-product-muted);font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.04em;cursor:pointer;font-family:inherit}.wh-product-nav-group-toggle:hover{background:rgba(255,255,255,.7);color:var(--wh-product-ink)}.wh-product-nav-chevron{transition:transform .16s ease}.wh-product-nav-group[data-nav-collapsed=true] .wh-product-nav-chevron{transform:rotate(-90deg)}.wh-product-nav-group[data-nav-collapsed=true]>.wh-product-nav-list{display:none}.wh-product-nav a{display:grid;grid-template-columns:minmax(0,1fr);align-items:center;gap:3px;border-radius:var(--wh-radius-md);padding:10px 12px;color:var(--wh-product-ink);font-size:14px;font-weight:800;text-decoration:none;transition:background .16s ease}.wh-product-nav a span,.wh-product-nav a small{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wh-product-nav a:hover{background:rgba(255,255,255,.85)}.wh-product-nav a[aria-current=page]{background:rgba(255,255,255,.92);color:var(--wh-product-blue);box-shadow:0 0 0 1px rgba(79,70,229,.16),0 10px 24px rgba(37,51,79,.07)}.wh-product-nav small{color:var(--wh-product-faint);font-size:11px;font-weight:800}.wh-product-nav-more{display:none}",
  ".wh-product-main{min-width:0;max-width:100%;overflow:hidden;padding:24px clamp(14px,2vw,28px)}.wh-product-masthead{display:flex;justify-content:flex-end;max-width:1120px;margin:0 auto 14px}.wh-product-kicker{margin:0 0 8px;color:var(--wh-product-blue);font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0}.wh-product-main h1[tabindex]:focus{outline:none}.wh-product-masthead h1{margin:0;color:var(--wh-product-ink);font-size:clamp(24px,2.4vw,34px);line-height:1.35;letter-spacing:0;overflow-wrap:anywhere}.wh-product-masthead p{margin:8px 0 0;color:var(--wh-product-muted);font-size:14px;line-height:1.55;max-width:760px;overflow-wrap:anywhere}",
  ".wh-product-metrics{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;align-items:flex-end;max-width:390px}.wh-product-metric{display:grid;gap:2px;border:1px solid var(--wh-glass-line);border-radius:var(--wh-radius-md);background:var(--wh-glass);backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);padding:8px 10px;min-width:78px;box-shadow:0 10px 28px rgba(37,51,79,.06)}.wh-product-metric strong{font-size:17px;line-height:1.35;overflow-wrap:anywhere}.wh-product-metric span{color:var(--wh-product-muted);font-size:11px;font-weight:850;line-height:1.35;overflow-wrap:anywhere}",
  ".wh-product-route-panels{max-width:1120px;margin:0 auto;min-width:0}.wh-route-panel{min-width:0;max-width:100%;overflow:hidden}.wh-route-panel[hidden]{display:none}.wh-product-route-panels .wh-shell{padding:0;background:transparent;min-height:0}.wh-product-route-panels .wh-stage{max-width:none;margin:0}.wh-product-route-panels .wh-panel{box-shadow:0 16px 42px rgba(37,51,79,.07)}",
  ".wh-product-rail{border-left:1px solid var(--wh-glass-line);background:rgba(255,255,255,.36);backdrop-filter:var(--wh-glass-blur);-webkit-backdrop-filter:var(--wh-glass-blur);padding:24px 16px;display:grid;align-content:start;gap:12px;overflow:auto}.wh-product-rail-block{border:1px solid var(--wh-glass-line);border-radius:var(--wh-radius-lg);background:var(--wh-glass);padding:13px 14px;display:grid;gap:6px}.wh-product-rail-block--static{border:0;background:transparent;padding:4px 2px}.wh-product-rail-block--static h2{font-size:12px;color:var(--wh-product-muted);font-weight:700}.wh-product-rail-block--static p{font-size:11px}.wh-product-rail-block h2{margin:0;color:var(--wh-product-ink);font-size:13px;line-height:1.35}.wh-product-rail-block p{margin:0;color:var(--wh-product-muted);font-size:12px;line-height:1.45;overflow-wrap:anywhere}.wh-product-rail-tag{display:inline-flex;align-items:center;width:max-content;max-width:100%;border-radius:999px;background:#eef4ff;color:var(--wh-product-blue);font-size:11px;font-weight:900;padding:4px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-app-notice{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:40;display:grid;gap:4px;width:max-content;max-width:min(420px,calc(100vw - 36px));border:1px solid rgba(79,70,229,.22);background:rgba(255,255,255,.88);backdrop-filter:var(--wh-glass-blur);-webkit-backdrop-filter:var(--wh-glass-blur);border-radius:var(--wh-radius-lg);box-shadow:0 18px 60px rgba(37,51,79,.16);padding:12px 14px;color:var(--wh-product-ink);font-weight:750;overflow-wrap:anywhere}.wh-app-notice[hidden]{display:none}.wh-app-notice[data-r4-notice-tone=success]{border-color:rgba(36,166,106,.42);box-shadow:0 18px 60px rgba(36,166,106,.16)}.wh-app-notice[data-r4-notice-tone=warning]{border-color:rgba(217,139,22,.45);box-shadow:0 18px 60px rgba(217,139,22,.15)}.wh-app-notice[data-r4-notice-tone=danger]{border-color:rgba(238,107,95,.45);box-shadow:0 18px 60px rgba(238,107,95,.16)}.wh-app-notice-title{display:block;font-size:13px;line-height:1.35;color:var(--wh-product-ink);font-weight:900}.wh-app-notice-body{display:block;color:var(--wh-product-muted);font-size:12px;line-height:1.45;max-width:100%;overflow-wrap:anywhere}.wh-app-action-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}.wh-app-action-row button{border:1px solid var(--wh-product-line);border-radius:12px;background:rgba(255,255,255,.92);padding:9px 12px;font-weight:750;color:var(--wh-product-ink);cursor:pointer}.wh-app-action-row button:first-child{background:var(--wh-product-blue);border-color:var(--wh-product-blue);color:#fff}",
  "@media (max-width:1120px){.wh-product-layout{grid-template-columns:206px minmax(0,1fr)}.wh-product-rail{display:none}.wh-product-masthead{grid-template-columns:1fr}.wh-product-metrics{justify-content:flex-start;max-width:100%}}",
  // R10-S1 玻璃降级门：不支持 backdrop-filter 的浏览器与 prefers-reduced-transparency 用户回实底，
  // 保证文字对比与可读不依赖毛玻璃效果。
  "@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.wh-product-topbar,.wh-product-nav,.wh-product-rail{background:rgba(255,255,255,.95)}.wh-product-metric,.wh-product-rail-block,.wh-app-notice{background:rgba(255,255,255,.97)}}",
  "@media (prefers-reduced-transparency:reduce){body{background:var(--wh-product-page)}.wh-product-topbar,.wh-product-nav,.wh-product-rail,.wh-product-metric,.wh-product-rail-block,.wh-app-notice{background:#fff;backdrop-filter:none;-webkit-backdrop-filter:none}}",
  "@media (prefers-reduced-motion:reduce){.wh-product-nav a{transition:none}.wh-product-nav-chevron{transition:none}}",
  "@media (max-width:780px){.wh-product-topbar{height:auto;min-height:62px;padding:10px 12px;align-items:flex-start}.wh-product-top-actions{flex-wrap:wrap}.wh-product-runtime{order:2;flex-basis:100%;justify-content:flex-start}.wh-product-layout{grid-template-columns:1fr;min-height:calc(100vh - 62px)}.wh-product-nav{position:static;border-right:0;border-bottom:1px solid var(--wh-product-line);padding:10px;min-width:0}.wh-product-nav{gap:8px}.wh-product-nav-title{display:none}.wh-product-nav-list{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;min-width:0}.wh-product-nav a{grid-template-columns:minmax(0,1fr);justify-items:center;text-align:center;padding:9px 8px;font-size:13px;white-space:normal}.wh-product-nav:not([data-nav-expanded=true]) .wh-product-nav-group:not([data-nav-group=work]):not(:has(a[aria-current=page])){display:none}.wh-product-nav[data-nav-expanded=true] .wh-product-nav-group>.wh-product-nav-list{display:grid}.wh-product-nav[data-nav-expanded=true] .wh-product-nav-group-toggle{pointer-events:none}.wh-product-nav-more{display:block;width:100%;margin-top:6px;border:1px solid var(--wh-glass-line);border-radius:12px;background:rgba(255,255,255,.85);padding:7px;font-size:12px;font-weight:800;color:var(--wh-product-muted);cursor:pointer}.wh-product-nav small{display:none}.wh-product-main{padding:18px 12px}.wh-product-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%}.wh-product-metric{min-width:0}.wh-product-route-panels .wh-main{padding:18px}.wh-locale-toggle{grid-template-columns:repeat(2,36px)}}"
].join("");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function productT(locale: WorkHubLocale, key: ProductShellCopyKey) {
  return productShellCopy[locale][key];
}

function labelForPage(page: { key: string; title: string }, locale: WorkHubLocale) {
  const key = `nav.${page.key}` as ProductShellCopyKey;
  return productShellCopy[locale][key] ?? page.title;
}

function nextForPage(pageKey: GoldPathRenderedPage["key"], locale: WorkHubLocale) {
  const key = `rail.next${pageKey[0]?.toUpperCase() ?? ""}${pageKey.slice(1)}` as ProductShellCopyKey;
  return productShellCopy[locale][key] ?? productShellCopy[locale]["rail.nextHome"];
}

function renderLocaleToggle(locale: WorkHubLocale) {
  return `<div class="wh-locale-toggle" role="group" aria-label="${escapeHtml(goldPathT(locale, "shell.localeAria"))}">${workHubLocaleOptions
    .map(
      (option) =>
        `<button type="button" data-wh-locale="${option.locale}" aria-pressed="${option.locale === locale ? "true" : "false"}" title="${escapeHtml(option.label)}">${escapeHtml(option.shortLabel)}</button>`
    )
    .join("")}</div>`;
}

function renderProductMetrics(page: WebProductShellPage, rendered: WebProductShellSurface, locale: WorkHubLocale) {
  const metrics = pageMetrics(page, rendered, locale).slice(0, 4);
  return `<div class="wh-product-metrics" data-r4-product-metrics="true">${metrics
    .map(
      (metric) =>
        `<div class="wh-product-metric" data-r4-product-metric="${escapeHtml(metric.id)}"><strong>${escapeHtml(metric.value)}</strong><span>${escapeHtml(metric.label)}</span></div>`
    )
    .join("")}</div>`;
}

function pageMetrics(page: WebProductShellPage, rendered: WebProductShellSurface, locale: WorkHubLocale): WebProductMetric[] {
  if (page.metrics) {
    return page.metrics;
  }
  const fallback = [{ id: "locale", label: productT(locale, "metric.locale"), value: locale }];
  const vm = rendered.vm?.page_vms;
  if (!vm) {
    return fallback;
  }
  if (page.key === "home") {
    const attention = vm.attention;
    return [
      { id: "primary", label: productT(locale, "metric.primary"), value: attention.primary ? "1" : "0" },
      { id: "queue", label: productT(locale, "metric.queue"), value: String(attention.queue.length) },
      { id: "running", label: productT(locale, "metric.running"), value: String(attention.background_runs.length) }
    ];
  }
  if (page.key === "approvals") {
    const approvals = vm.approvals;
    return [
      { id: "pending", label: productT(locale, "metric.pending"), value: String(approvals.counts.pending ?? approvals.items.length) },
      { id: "requests", label: productT(locale, "metric.requests"), value: String(approvals.requests.length) },
      { id: "queue", label: productT(locale, "metric.queue"), value: String(approvals.items.length) }
    ];
  }
  if (page.key === "workitem") {
    const workitem = vm.workitem;
    return [
      { id: "trace", label: productT(locale, "metric.trace"), value: String(workitem.agent_trace_preview.length) },
      { id: "deliverables", label: productT(locale, "metric.deliverables"), value: String(workitem.accepted_deliverables.length) },
      { id: "evidence", label: productT(locale, "metric.evidence"), value: String(workitem.evidence_refs.length) }
    ];
  }
  if (page.key === "proposal") {
    const proposal = vm.proposal;
    return [
      { id: "checks", label: productT(locale, "metric.checks"), value: String(proposal.manifest.checks.length) },
      { id: "evidence", label: productT(locale, "metric.evidence"), value: String(proposal.evidence_refs.length) },
      { id: "comments", label: productT(locale, "metric.comments"), value: String(proposal.comments.length) }
    ];
  }
  if (page.key === "replay") {
    const replay = vm.replay;
    return [
      { id: "steps", label: productT(locale, "metric.steps"), value: String(replay.steps.length) },
      { id: "decisions", label: productT(locale, "metric.decisions"), value: String(replay.merge_timeline.length) },
      { id: "snapshots", label: productT(locale, "metric.snapshots"), value: String(replay.snapshots.length) }
    ];
  }
  if (page.key === "cost") {
    const cost = vm.cost;
    const totalTokens = cost.token_in + cost.token_out;
    return [
      { id: "tokens", label: productT(locale, "metric.tokens"), value: String(totalTokens) },
      { id: "cost", label: productT(locale, "metric.cost"), value: cost.currency === "CNY" ? `¥${cost.total_cost_cny}` : cost.total_cost_cny },
      { id: "budget", label: productT(locale, "metric.budget"), value: String(cost.budget.length) }
    ];
  }
  return fallback;
}

// R10-S1.5→Nav-v2 导航信息架构：「提需求」是动作不是地点——升为置顶主 CTA；工作组(总览/项目/审批
// +detail-only 激活页)常驻无标题；项目资产/团队/管理三组默认折叠(当前页所在组自动展开)，点组名展开。
// 普通成员默认视野=1 CTA + 3 项 + 3 个组名。
// G-web 止血批：导出供 apps/web/src/routes.test.ts 做「路由第 4 个同步点」门禁——校验
// webRouteRegistry 的每个 key 都能在这里的某个组里找到导航入口（intake 走置顶 CTA，是唯一
// 允许不在任何组 keys 里的例外，见下方 renderProductNav 的 intake 特判）。
export const productNavGroups: ReadonlyArray<{
  id: string;
  titleKey: ProductShellCopyKey;
  keys: ReadonlySet<string>;
  adminOnly?: boolean;
  collapsible?: boolean;
}> = [
  { id: "work", titleKey: "nav.group.work", keys: new Set(["home", "projects", "project-home", "project-timeline", "approvals", "workitem", "proposal", "conversation", "replay"]) },
  { id: "assets", titleKey: "nav.group.assets", keys: new Set(["drive", "meetings", "knowledge", "search"]), collapsible: true },
  // R14 批 MEM：记忆管理面对全体成员可读（团队技能 tab 的编辑/停用才收管理员），不进 adminOnly
  // 的 admin 组——否则普通成员连「关于我」自己的记忆都点不到导航入口（见 03-mem-design §6.1）。
  // R20 P1-06：settings 同理移出 adminOnly——个人设置（头像/资料/语言/AI 模式）人人可用，此前误锁进 admin
  // 组致普通成员根本进不了自己的资料页；页内「团队成员/邀请」子区仍按 isAdmin 门控（renderSettingsRouteComponent）。
  { id: "team", titleKey: "nav.group.team", keys: new Set(["notifications", "calendar", "health", "memory", "settings"]), collapsible: true },
  { id: "admin", titleKey: "nav.group.admin", keys: new Set(["cost", "agents", "skills"]), adminOnly: true, collapsible: true }
];

// R10-S3：状态壳(loading/error/403/404)只需要 key/route/title 渲导航——放宽到最小形状，
// ready 壳传完整 GoldPathRenderedPage 不受影响。
type ProductNavPage = Pick<GoldPathRenderedPage, "route" | "title"> & { key: string };

function renderProductNav(
  pages: ProductNavPage[],
  activeKey: string,
  locale: WorkHubLocale,
  isAdmin: boolean
) {
  const link = (page: ProductNavPage) => {
    const active = page.key === activeKey;
    return `<a href="${escapeHtml(page.route)}" data-wh-route="${escapeHtml(page.route)}" data-wh-page-key="${page.key}" aria-current="${active ? "page" : "false"}"><span>${escapeHtml(labelForPage(page, locale))}</span></a>`;
  };
  const assigned = new Set<string>();
  // Nav-v2：「提需求」是高频动作——从列表项升为置顶主 CTA。
  const intakePage = pages.find((page) => page.key === "intake");
  if (intakePage) {
    assigned.add("intake");
  }
  const cta = intakePage
    ? `<a class="wh-product-nav-cta" href="${escapeHtml(intakePage.route)}" data-wh-route="${escapeHtml(intakePage.route)}" data-wh-page-key="intake" aria-current="${activeKey === "intake" ? "page" : "false"}"><span aria-hidden="true">＋</span><span>${escapeHtml(labelForPage(intakePage, locale))}</span></a>`
    : "";
  const groups = productNavGroups
    .map((group) => {
      const groupPages = pages.filter((page) => group.keys.has(page.key));
      groupPages.forEach((page) => assigned.add(page.key));
      if (groupPages.length === 0) {
        return "";
      }
      // 角色化披露：管理组(成本/军团/技能/设置)不进普通成员的日常导航——深链与服务端权限不受影响；
      // 非 admin 恰好深链停在管理组页面时仍渲该组,保证当前页在导航中有锚点。
      const containsActive = groupPages.some((page) => page.key === activeKey);
      if (group.adminOnly && !isAdmin && !containsActive) {
        return "";
      }
      // Nav-v2：工作组无标题常驻；可折叠组默认收起（当前页所在组自动展开），组名即开关。
      if (!group.collapsible) {
        return `<div class="wh-product-nav-group" data-nav-group="${group.id}"><div class="wh-product-nav-list">${groupPages.map(link).join("")}</div></div>`;
      }
      const collapsed = !containsActive;
      return `<div class="wh-product-nav-group" data-nav-group="${group.id}" data-nav-collapsed="${collapsed ? "true" : "false"}">
        <button type="button" class="wh-product-nav-group-toggle" data-nav-group-toggle="${group.id}" aria-expanded="${collapsed ? "false" : "true"}"><span>${escapeHtml(productT(locale, group.titleKey))}</span><span class="wh-product-nav-chevron" aria-hidden="true">▾</span></button>
        <div class="wh-product-nav-list">${groupPages.map(link).join("")}</div>
      </div>`;
    })
    .filter(Boolean)
    .join("");
  // 未落组的新页面兜底可见——加新路由忘了归组时绝不静默消失。
  const leftovers = pages.filter((page) => !assigned.has(page.key));
  const leftoverGroup = leftovers.length
    ? `<div class="wh-product-nav-group" data-nav-group="other"><div class="wh-product-nav-list">${leftovers.map(link).join("")}</div></div>`
    : "";
  return cta + groups + leftoverGroup;
}

function renderRoutePanel(page: GoldPathRenderedPage, active: boolean, routeComponents?: WebRouteComponentMap) {
  const routeComponent = routeComponents?.[page.key];
  const componentMarker = routeComponent
    ? ` data-r4-route-component-panel="${page.key}" data-r4-route-component-active="${active ? "true" : "false"}"`
    : "";
  const hydrationMarker = routeComponent
    ? ` data-r4-hydration-panel="true" data-r4-hydration-root-id="${escapeHtml(routeComponent.hydration.rootId)}" data-r4-hydration-route="${escapeHtml(routeComponent.hydration.routeKey)}" data-r4-hydration-mode="${escapeHtml(routeComponent.hydration.mode)}" data-r4-hydration-page-vm="${escapeHtml(routeComponent.hydration.pageVm)}" data-r4-hydration-action-count="${escapeHtml(String(routeComponent.hydration.actionHrefCount))}"`
    : "";
  return `<section class="wh-route-panel" data-wh-panel="${page.key}"${componentMarker}${hydrationMarker} ${active ? "" : "hidden"}>${routeComponent?.html ?? page.html}</section>`;
}

function renderProductTopbar(locale: WorkHubLocale, appName: string, currentUser?: WebProductShellCurrentUser) {
  return `<header class="wh-product-topbar">
        <a class="wh-product-brand" href="/" data-wh-route="/" data-wh-page-key="home"><span class="wh-product-brand-mark" aria-hidden="true"></span><span>${escapeHtml(appName)}</span></a>
        <div class="wh-product-top-actions">
          <div class="wh-product-runtime" aria-label="${escapeHtml(productT(locale, "topbar.scope"))}"><span class="wh-product-runtime-dot" aria-hidden="true"></span><span>${escapeHtml(productT(locale, "topbar.scope"))}</span></div>
          ${currentUser ? `<div class="wh-product-user" data-wh-current-user="${escapeHtml(currentUser.nickname)}" data-wh-current-user-admin="${escapeHtml(String(currentUser.isAdmin))}"><span class="wh-product-user-name">${escapeHtml(currentUser.nickname)}</span>${currentUser.isAdmin ? `<span class="wh-product-rail-tag">${escapeHtml(productT(locale, "topbar.admin"))}</span>` : ""}<button type="button" class="wh-product-logout" data-wh-logout="true" data-action-id="logout">${escapeHtml(productT(locale, "topbar.logout"))}</button></div>` : ""}
          ${renderLocaleToggle(locale)}
        </div>
      </header>`;
}

// R10-S3（P2-6）：loading/error/403/404 不再渲成脱壳裸页——身份可用时保留顶栏+分组导航，
// 状态卡渲进主内容区。用户在异常态仍知道自己在 WorkHub 的哪里、还能去哪。
export type WebProductStateShellInput = {
  locale: WorkHubLocale;
  appName: string;
  currentRoute: string;
  activeKey: string;
  entries: Array<{ key: string; route: string; title: string }>;
  currentUser?: WebProductShellCurrentUser | undefined;
  contentHtml: string;
};

export function renderWebProductStateShell(input: WebProductStateShellInput): { css: string; html: string } {
  const locale = normalizeWorkHubLocale(input.locale);
  const nav = renderProductNav(input.entries, input.activeKey, locale, input.currentUser ? input.currentUser.isAdmin : true);
  return {
    css: `${productShellCss}${productStateShellCss}`,
    html: `<div class="wh-product-root" data-wh-surface="web" data-r4-product-shell="true" data-r4-product-state-shell="true" data-r4-product-route-key="${escapeHtml(input.activeKey)}" data-r4-product-link-mode="path">
      ${renderProductTopbar(locale, input.appName, input.currentUser)}
      <div class="wh-product-layout wh-product-layout--state">
        <nav class="wh-product-nav" aria-label="${escapeHtml(goldPathT(locale, "shell.navAria"))}">
          ${nav}
          <button type="button" class="wh-product-nav-more" data-nav-more aria-expanded="false">${escapeHtml(locale === "en-US" ? "More" : "更多")}</button>
        </nav>
        <main class="wh-product-main">
          <div class="wh-product-route-panels">${input.contentHtml}</div>
        </main>
      </div>
      <aside class="wh-app-notice" data-wh-app-notice hidden aria-live="polite"></aside>
    </div>`
  };
}

const productStateShellCss = ".wh-product-layout--state{grid-template-columns:218px minmax(0,1fr)}.wh-product-layout--state .wh-product-main{display:grid;align-content:start}@media (max-width:780px){.wh-product-layout--state{grid-template-columns:1fr}}";

export function renderWebProductShell(
  rendered: WebProductShellSurface,
  options: WebProductShellOptions
): GoldPathAppShell {
  const locale = normalizeWorkHubLocale(options.locale);
  const routeMap = buildGoldPathRouteMap(rendered.pages);
  const activeKey = resolveGoldPathPageKey(routeMap, options.currentRoute ?? "") ?? rendered.pages[0]?.key ?? "home";
  const activePage = rendered.pages.find((page) => page.key === activeKey) ?? rendered.pages[0];
  const nav = renderProductNav(rendered.pages, activeKey, locale, options.currentUser ? options.currentUser.isAdmin : true);
  const routeComponentCss = [...new Set(Object.values(options.routeComponents ?? {})
    .map((component) => component.css)
    .filter(Boolean))]
    .join("");
  const panelPages = options.renderActivePanelOnly && activePage ? [activePage] : rendered.pages;
  const panels = panelPages.map((page) => renderRoutePanel(page, page.key === activeKey, options.routeComponents)).join("");
  const metrics = activePage ? renderProductMetrics(activePage, rendered, locale) : "";
  const activeTitle = activePage?.title ?? options.appName;
  const activeNext = activePage ? nextForPage(activePage.key, locale) : productT(locale, "rail.nextHome");

  return {
    routeMap,
    css: `${productShellCss}${rendered.css}${routeComponentCss}`,
    html: `<div class="wh-product-root" data-wh-surface="${rendered.surface}" data-r4-product-shell="true" data-r4-product-route-key="${escapeHtml(activeKey)}" data-r4-product-link-mode="path">
      ${renderProductTopbar(locale, options.appName, options.currentUser)}
      <div class="wh-product-layout">
        <nav class="wh-product-nav" aria-label="${escapeHtml(goldPathT(locale, "shell.navAria"))}">
          ${nav}
          <button type="button" class="wh-product-nav-more" data-nav-more aria-expanded="false">${escapeHtml(locale === "en-US" ? "More" : "更多")}</button>
        </nav>
        <main class="wh-product-main">
          ${activeKey === "home" ? "" : `<section class="wh-product-masthead" data-r4-product-masthead="true" aria-label="${escapeHtml(activeTitle)}">
            ${metrics}
          </section>`}
          <div class="wh-product-route-panels">${panels}</div>
        </main>
        <aside class="wh-product-rail" aria-label="${escapeHtml(productT(locale, "rail.now"))}">
          <section class="wh-product-rail-block wh-product-rail-block--static">
            <span class="wh-product-rail-tag">${escapeHtml(productT(locale, "rail.source"))}</span>
            <h2>${escapeHtml(productT(locale, "topbar.rest"))}</h2>
            <p>${escapeHtml(productT(locale, "rail.refresh"))}</p>
          </section>
          <section class="wh-product-rail-block">
            <span class="wh-product-rail-tag">${escapeHtml(productT(locale, "rail.next"))}</span>
            <h2>${escapeHtml(activePage ? labelForPage(activePage, locale) : options.appName)}</h2>
            <p>${escapeHtml(activeNext)}</p>
          </section>
          <section class="wh-product-rail-block wh-product-rail-block--static">
            <span class="wh-product-rail-tag">${escapeHtml(productT(locale, "topbar.scope"))}</span>
            <p>${escapeHtml(productT(locale, "rail.boundary"))}</p>
          </section>
        </aside>
      </div>
      <div class="wh-app-notice" role="status" aria-live="polite" aria-atomic="true" data-wh-app-notice ${options.notice ? "" : "hidden"}>${escapeHtml(options.notice ?? "")}</div>
    </div>`
  };
}
