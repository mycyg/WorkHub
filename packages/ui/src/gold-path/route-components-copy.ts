// 网页路由组件（工作项 / 澄清 / 成本 / AI 小组 / 技能 / 设置 / 记忆…）的用户可见文案单一来源。
// 文案 locale 独占门禁：含汉字的字面量只许住在词典文件里，见 scripts/dev/check-ui-i18n.ts。

import type { WorkHubLocale } from "@workhub/contracts";

export type RouteCopyKey =
  | "workitem.context"
  | "workitem.trace"
  | "workitem.deliverables"
  | "workitem.driveSource"
  | "workitem.meetingSource"
  | "workitem.observerSource"
  | "workitem.observerSourceBody"
  | "workitem.openProposal"
  | "workitem.openReplay"
  | "workitem.createTaskPlan"
  | "intake.summary"
  | "intake.progress"
  | "intake.freeText"
  | "intake.createWorkItem"
  | "intake.continue"
  | "intake.stateDone"
  | "intake.stateActive"
  | "intake.statePending"
  | "health.title"
  | "settings.boolYes"
  | "settings.boolNo"
  | "intake.startKicker"
  | "intake.startTitle"
  | "intake.startBody"
  | "intake.startProject"
  | "intake.startAction"
  | "intake.startNext"
  | "intake.startEvidence"
  | "intake.startIntent"
  | "intake.startIntentPlaceholder"
  | "knowledge.kicker"
  | "knowledge.sources"
  | "knowledge.missing"
  | "knowledge.open"
  | "knowledge.searchPlaceholder"
  | "knowledge.searchLabel"
  | "knowledge.searchSubmit"
  | "knowledge.scopeLandingCta"
  | "search.kicker"
  | "search.title"
  | "search.summary"
  | "search.placeholder"
  | "search.label"
  | "search.submit"
  | "search.promptEmpty"
  | "search.promptShort"
  | "search.loading"
  | "search.groupConversations"
  | "search.groupDrive"
  | "search.groupWorkItems"
  | "search.groupMeetings"
  | "search.desktopOnlyNote"
  | "conversation.kicker"
  | "conversation.title"
  | "conversation.readonlyBanner"
  | "conversation.readonlyHint"
  | "conversation.empty"
  | "conversation.older"
  | "conversation.newer"
  | "conversation.latest"
  | "conversation.refresh"
  | "conversation.senderCuu"
  | "conversation.senderSystem"
  | "conversation.senderUnknown"
  | "conversation.edited"
  | "conversation.pinned"
  | "conversation.deleted"
  | "conversation.replyDeleted"
  | "conversation.clarifyBadge"
  | "conversation.toolNote"
  | "conversation.systemFallback"
  | "conversation.riskDigest"
  | "conversation.fileCard"
  | "proposal.summary"
  | "proposal.review"
  | "proposal.files"
  | "drive.kicker"
  | "drive.allProjects"
  | "drive.switchProject"
  | "drive.files"
  | "drive.versions"
  | "drive.comments"
  | "drive.recycle"
  | "drive.operations"
  | "drive.empty"
  | "drive.emptyFiles"
  | "drive.emptyVersions"
  | "drive.emptyRecycle"
  | "drive.emptyOperations"
  | "drive.selectFile"
  | "drive.upload"
  | "drive.delete"
  | "drive.preview"
  | "drive.download"
  | "drive.restore"
  | "drive.current"
  | "drive.createDraft"
  | "drive.openDraft"
  | "drive.openProposal"
  | "drive.requestedMissing"
  | "drive.status.pending_llm"
  | "drive.status.draft_created"
  | "drive.status.proposal_created"
  | "drive.status.dismissed"
  | "meeting.kicker"
  | "meeting.transcript"
  | "meeting.minutes"
  | "meeting.insights"
  | "meeting.createDraft"
  | "meeting.dismiss"
  | "meeting.openDraft"
  | "meeting.openProposal"
  | "meeting.reason"
  | "meeting.approvalSafe"
  | "meeting.reanalyze"
  | "meeting.aiNotConfigured"
  | "meeting.minutesQueued"
  | "meeting.minutesNotConfigured"
  | "meeting.empty"
  | "meeting.status.ready"
  | "meeting.status.transcribed"
  | "meeting.status.processing"
  | "meeting.status.failed"
  | "meeting.status.pending"
  | "meeting.status.confirmed"
  | "meeting.status.dismissed"
  | "notifications.kicker"
  | "notifications.needsDecision"
  | "notifications.fyi"
  | "notifications.done"
  | "notifications.markAllRead"
  | "notifications.empty"
  | "notifications.open"
  | "notifications.unread"
  | "notifications.muteTitle"
  | "notifications.muteHelp"
  | "notifications.read"
  | "notifications.completed"
  | "notifications.source"
  | "notifications.groundingWhy"
  | "notifications.conversationLinked"
  | "notifications.conversationOpen"
  | "notifications.snooze"
  | "notifications.snoozed"
  | "knowledge.fromNotice"
  | "health.kicker"
  | "health.healthy"
  | "health.attention"
  | "health.critical"
  | "health.empty"
  | "health.bandsOnly"
  | "health.openProject"
  | "health.signal.open_work_items"
  | "health.signal.overdue_work_items"
  | "health.signal.pending_approvals"
  | "health.signal.failed_runs"
  | "health.signal.pending_insights"
  | "calendar.kicker"
  | "calendar.today"
  | "calendar.week"
  | "calendar.empty"
  | "calendar.upcoming"
  | "calendar.overdue"
  | "calendar.done"
  | "calendar.allDay"
  | "calendar.workItemDue"
  | "calendar.meetingFollowup"
  | "calendar.scheduleEvent"
  | "calendar.reviewWindow"
  | "cost.scopes"
  | "cost.risks"
  | "cost.models"
  | "cost.trend"
  | "cost.remaining"
  | "cost.laborSplit"
  | "cost.laborProduction"
  | "cost.laborSelfImprovement"
  | "cost.laborSelfImprovementRatio"
  | "cost.trendTitle"
  | "cost.byWorkitem"
  | "cost.byTeam"
  | "agents.kicker"
  | "agents.summary"
  | "agents.active"
  | "agents.waiting"
  | "agents.todayCost"
  | "agents.autonomy"
  | "agents.plans"
  | "agents.recent"
  | "agents.noRecent"
  | "agents.empty"
  | "agents.start"
  | "agents.cost"
  | "agents.costDetails"
  | "agents.objective"
  | "agents.capPlans"
  | "agents.capRows"
  | "agents.judge"
  | "skills.kicker"
  | "skills.title"
  | "skills.summary"
  | "skills.empty"
  | "skills.active"
  | "skills.aiAuthored"
  | "skills.refined"
  | "skills.version"
  | "skills.readiness"
  | "skills.refinedFrom"
  | "skills.curationTitle"
  | "skills.curationOffSetting"
  | "skills.curationRunning"
  | "skills.curationIdle"
  | "skills.curationLastRun"
  | "skills.curationNeverRun"
  | "skills.curateNow"
  | "skills.curateNowConfirm"
  | "skills.curateNowStarted"
  | "skills.curateNowFailed"
  | "projects.kicker"
  | "projects.title"
  | "projects.summary"
  | "projects.empty"
  | "projects.new"
  | "projects.namePlaceholder"
  | "projects.create"
  | "projects.open"
  | "projects.archived"
  | "projects.openItems"
  | "projects.updated"
  | "projects.owner"
  | "projectHome.kicker"
  | "projectHome.openWork"
  | "projectHome.empty"
  | "projectHome.back"
  | "projectHome.files"
  | "projectHome.noFiles"
  | "projectHome.github"
  | "projectHome.githubEmpty"
  | "settings.runtime"
  | "settings.llm"
  | "settings.language"
  | "settings.device"
  | "settings.configured"
  | "settings.notConfigured"
  | "settings.ready"
  | "settings.needsAttention"
  | "settings.synced"
  | "settings.needsSync"
  | "settings.worker"
  | "settings.broker"
  | "settings.database"
  | "settings.runtimeStatus"
  | "settings.provider"
  | "settings.model"
  | "settings.apiKey"
  | "settings.baseUrl"
  | "settings.activeLocale"
  | "settings.preferenceLocale"
  | "settings.preferenceSource"
  | "settings.preferenceSync"
  | "settings.supported"
  | "settings.localExecution"
  | "settings.independentPet"
  | "settings.petBoundary"
  | "settings.desktopGate"
  | "settings.webLocalActions"
  | "settings.restore"
  // R14 批 MEM（记忆可见可治理）：/settings/memory 两 tab（关于我/团队技能）静态文案。
  | "memory.kicker"
  | "memory.title"
  | "memory.summary"
  | "memory.tabProfile"
  | "memory.tabSkills"
  | "memory.profileEmpty"
  | "memory.category.preference"
  | "memory.category.correction"
  | "memory.category.recurring_context"
  | "memory.provenanceUnknown"
  | "memory.edit"
  | "memory.save"
  | "memory.cancel"
  | "memory.delete"
  | "memory.deleteConfirm"
  | "memory.deleteHint"
  | "memory.skillsEmpty"
  | "memory.status.draft"
  | "memory.status.active"
  | "memory.status.deprecated"
  | "memory.deactivate"
  | "memory.deactivateConfirm"
  | "memory.adminOnlyNote"
  | "memory.humanEdited"
  | "memory.reasonPlaceholder"
  | "agents.teamPartiallyDone"
  | "agents.teamCompleted"
  | "agents.teamPaused"
  | "agents.teamReady"
  | "agents.teamInProgress"
  | "drive.filesShown"
  | "drive.recycleShown"
  | "projectHome.handleableSummary"
  | "projectHome.collapsedSummary"
  | "projectHome.armyPill"
  | "cost.subtaskCount"
  | "cost.armyCapped"
  | "plan.shareShort"
  | "plan.shareOver";

export const routeCopy: Record<WorkHubLocale, Record<RouteCopyKey, string>> = {
  "zh-CN": {
    "workitem.context": "任务上下文",
    "workitem.trace": "AI 工作过程", // term-allow：key 名是词典标识符，不是用户文案（值已人话）。
    "workitem.deliverables": "AI 提议的改动",
    "workitem.driveSource": "网盘评论来源",
    "workitem.meetingSource": "会议洞察来源",
    "workitem.observerSource": "会话观察者来源",
    "workitem.observerSourceBody": "由项目群聊的 Cuu 观察者创建。",
    "workitem.openProposal": "查看变更申请",
    "workitem.openReplay": "查看回放",
    "workitem.createTaskPlan": "生成任务计划",
    "intake.summary": "接入摘要",
    "intake.progress": "澄清进度",
    "intake.freeText": "展开手动输入回答",
    "intake.createWorkItem": "创建任务",
    "intake.continue": "继续澄清",
    "intake.stateDone": "已完成",
    "intake.stateActive": "进行中",
    "intake.statePending": "待进行",
    "intake.startKicker": "新任务入口",
    "intake.startTitle": "从真实项目开始新任务",
    "intake.startBody": "先给你几个选项把任务问清楚；在你确认前，不会改动已采纳的交付物。",
    "intake.startProject": "默认项目",
    "intake.startAction": "开始新任务",
    "intake.startNext": "下一步：选择工作类型，让 AI 开始干活。",
    "intake.startEvidence": "证据与成本会进入回放和成本页。",
    "intake.startIntent": "真实任务",
    "intake.startIntentPlaceholder": "例如：整理今天的客户反馈，输出待解决问题、采纳建议和下一步负责人。",
    "knowledge.kicker": "知识库",
    "knowledge.sources": "证据来源",
    "knowledge.missing": "没有可靠证据，不会编造来源。",
    "knowledge.open": "打开证据",
    "knowledge.searchPlaceholder": "搜索证据、文档、会议纪要…",
    "knowledge.searchLabel": "搜索知识库证据",
    "knowledge.searchSubmit": "搜索",
    "knowledge.scopeLandingCta": "去项目列表",
    "search.kicker": "全局搜索",
    "search.title": "搜索",
    "search.summary": "跨会话、网盘、工单、会议搜索。",
    "search.placeholder": "搜索关键词…",
    "search.label": "搜索全部",
    "search.submit": "搜索",
    "search.promptEmpty": "输入至少 2 个字符开始搜索。",
    "search.promptShort": "搜索词至少需要 2 个字符。",
    "search.loading": "正在搜索…",
    "search.groupConversations": "会话",
    "search.groupDrive": "网盘",
    "search.groupWorkItems": "任务",
    "search.groupMeetings": "会议",
    "search.desktopOnlyNote": "在线镜像只读——点开某条即可查看只读会话镜像，完整协作请回桌面工作台。",
    "conversation.kicker": "只读镜像",
    "conversation.title": "会话镜像",
    "conversation.readonlyBanner": "只读镜像 · 完整协作请在桌面工作台",
    "conversation.readonlyHint": "这里只镜像消息，不能发言、反应或标记已读——不会改动任何人的未读状态。",
    "conversation.empty": "这个会话还没有可显示的消息。",
    "conversation.older": "查看更早",
    "conversation.newer": "查看更新",
    "conversation.latest": "回到最新",
    "conversation.refresh": "刷新",
    "conversation.senderCuu": "Cuu",
    "conversation.senderSystem": "系统",
    "conversation.senderUnknown": "未知成员",
    "conversation.edited": "已编辑",
    "conversation.pinned": "已置顶",
    "conversation.deleted": "此消息已删除",
    "conversation.replyDeleted": "原消息已删除",
    "conversation.clarifyBadge": "Cuu 在问",
    "conversation.toolNote": "（一次工具调用）",
    "conversation.systemFallback": "系统事件",
    "conversation.riskDigest": "今日风险巡检",
    "conversation.fileCard": "文件卡片",
    "proposal.summary": "AI 摘要",
    "proposal.review": "审阅动作",
    "proposal.files": "文件与对象变化",
    "drive.kicker": "项目网盘",
    "drive.allProjects": "所有项目",
    "drive.switchProject": "切换项目",
    "drive.files": "文件列表",
    "drive.versions": "版本历史",
    "drive.comments": "评论",
    "drive.recycle": "回收站",
    "drive.operations": "操作日志",
    "drive.empty": "这个项目还没有正式交付物。",
    "drive.emptyFiles": "这个项目的网盘还是空的，上传或生成文件后会出现在这里。",
    "drive.emptyVersions": "还没有历史版本。",
    "drive.emptyRecycle": "回收站是空的。",
    "drive.emptyOperations": "还没有操作记录。",
    "drive.selectFile": "从左侧选一个文件查看详情。",
    "drive.upload": "上传文件",
    "drive.delete": "移到回收站",
    "drive.preview": "预览",
    "drive.download": "下载",
    "drive.restore": "还原",
    "drive.current": "当前",
    "drive.createDraft": "生成草稿",
    "drive.openDraft": "打开草稿",
    "drive.openProposal": "查看变更申请",
    "drive.requestedMissing": "找不到该文件，已回到默认视图。",
    "drive.status.pending_llm": "待生成草稿",
    "drive.status.draft_created": "已生成草稿",
    "drive.status.proposal_created": "已生成提议",
    "drive.status.dismissed": "已忽略",
    "meeting.kicker": "会议洞察",
    "meeting.transcript": "转写",
    "meeting.minutes": "纪要",
    "meeting.insights": "洞察",
    "meeting.createDraft": "生成草稿",
    "meeting.dismiss": "忽略",
    "meeting.openDraft": "打开草稿",
    "meeting.openProposal": "查看变更申请",
    "meeting.reason": "AI 推荐理由",
    "meeting.approvalSafe": "审批安全：确认前不会修改正式资料。",
    "meeting.reanalyze": "重新生成纪要",
    "meeting.aiNotConfigured": "这个部署还没有配置 AI：导入的会议只会保存转写，纪要和洞察不会自动生成。",
    "meeting.minutesQueued": "纪要还在生成，稍后回来查看。",
    "meeting.minutesNotConfigured": "AI 还没有配置，这场会议只保存了转写。",
    "meeting.empty": "这个项目还没有会议洞察。",
    "meeting.status.ready": "已生成",
    "meeting.status.transcribed": "转写已导入",
    "meeting.status.processing": "处理中",
    "meeting.status.failed": "处理失败",
    "meeting.status.pending": "待确认",
    "meeting.status.confirmed": "已确认",
    "meeting.status.dismissed": "已忽略",
    "notifications.kicker": "通知中心",
    "notifications.needsDecision": "需要你决定",
    "notifications.fyi": "仅供了解",
    "notifications.done": "已归档",
    "notifications.markAllRead": "全部已读（不含待决策）",
    "notifications.empty": "通知箱是空的。",
    "notifications.muteTitle": "通知静音偏好",
    "notifications.muteHelp": "勾选的类型将不再给你发通知（默认全部接收）。",
    "notifications.open": "打开",
    "notifications.unread": "未读",
    "notifications.read": "已读",
    "notifications.completed": "已处理",
    "notifications.source": "来源",
    "notifications.groundingWhy": "为什么提醒我",
    // G-web 止血批：web 没有会话 UI——旧文案「打开后能看到相关上下文」会让人以为点开就能看会话内容，
    // 实际跳转目标只是既有的工作项/审批页（带 ?conversation_id= 查询串），补一句诚实指路。
    "notifications.conversationLinked": "这条通知关联一段讨论——查看只读镜像，完整协作在桌面工作台",
    "notifications.conversationOpen": "查看只读镜像",
    "notifications.snooze": "暂停提醒",
    "notifications.snoozed": "已暂停",
    "knowledge.fromNotice": "来自通知的相关资料",
    "health.kicker": "项目健康",
    "health.title": "健康总览",
    "health.healthy": "健康",
    "health.attention": "需要关注",
    "health.critical": "告急",
    "health.empty": "还没有可见的项目。",
    "health.bandsOnly": "你看到的是分级视图，具体数值仅管理员可见。",
    "health.openProject": "打开项目",
    "health.signal.open_work_items": "进行中事项",
    "health.signal.overdue_work_items": "逾期事项",
    "health.signal.pending_approvals": "待审批",
    "health.signal.failed_runs": "失败运行",
    "health.signal.pending_insights": "待确认洞察",
    "calendar.kicker": "日程",
    "calendar.today": "今天",
    "calendar.week": "本周",
    "calendar.empty": "这段时间没有日程。",
    "calendar.upcoming": "即将到来",
    "calendar.overdue": "已逾期",
    "calendar.done": "已完成",
    "calendar.allDay": "全天",
    "calendar.workItemDue": "任务截止",
    "calendar.meetingFollowup": "会议建议",
    "calendar.scheduleEvent": "日程事项",
    "calendar.reviewWindow": "审阅窗口",
    "cost.scopes": "预算范围",
    "cost.risks": "预算风险",
    "cost.models": "模型拆解",
    "cost.trend": "统计天数",
    "cost.remaining": "剩余",
    "cost.laborSplit": "干活 vs 自进化",
    "cost.laborProduction": "干活花费",
    "cost.laborSelfImprovement": "自进化花费",
    "cost.laborSelfImprovementRatio": "自进化占比",
    "cost.trendTitle": "花费趋势",
    "cost.byWorkitem": "按工作项分账",
    "cost.byTeam": "按团队分账",
    "agents.kicker": "AI 小组",
    "agents.summary": "观察正在推进的任务计划；需要人决定的事仍回到总览处理。",
    "agents.active": "进行中的小组",
    "agents.waiting": "等你决策",
    "agents.todayCost": "今日成本",
    "agents.autonomy": "自主率",
    "agents.plans": "活跃计划",
    "agents.recent": "最近升级",
    "agents.noRecent": "还没有升级动态。",
    "agents.empty": "还没有 AI 小组在跑。下次遇到大任务，会先生成一份任务计划。",
    "agents.start": "发起新任务",
    "agents.cost": "成本",
    "agents.costDetails": "查看成本",
    "agents.objective": "目标",
    "agents.capPlans": "当前只显示前 {limit} 个小组；继续处理后列表会刷新。",
    "agents.capRows": "部分子任务、执行或转人工记录已按上限截断，打开任务可看完整上下文。",
    "agents.judge": "复核通过率",
    "skills.kicker": "团队技能库",
    "skills.title": "团队技能",
    "skills.summary": "AI 从真实工作里攒下并持续打磨的可复用技能",
    "skills.empty": "还没有攒下团队技能。AI 会在夜间从真实工作里总结。",
    "projects.kicker": "项目",
    "projects.title": "项目",
    "projects.summary": "每个项目里有进行中的任务、负责人和最近更新。",
    "projects.empty": "还没有项目。新建一个项目就能开始任务。",
    "projects.new": "新建项目",
    "projects.namePlaceholder": "新项目名称",
    "projects.create": "创建",
    "projects.open": "打开项目",
    "projects.archived": "已归档",
    "projects.openItems": "进行中",
    "projects.updated": "更新于",
    "projects.owner": "负责人",
    "projectHome.kicker": "项目主页",
    "projectHome.openWork": "进行中的工作",
    "projectHome.empty": "这个项目暂时没有进行中的工作。点「新任务」创建下一项工作。",
    "projectHome.back": "← 返回项目列表",
    "projectHome.files": "最近文件",
    "projectHome.noFiles": "网盘里还没有文件。",
    "projectHome.github": "最近 GitHub 动态",
    "projectHome.githubEmpty": "在桌面客户端项目设置中绑定 GitHub 后可见。",
    "skills.active": "在用",
    "skills.aiAuthored": "AI 总结",
    "skills.refined": "已精修",
    "skills.version": "版本",
    "skills.readiness": "成熟度",
    "skills.refinedFrom": "精修自 v",
    "skills.curationTitle": "AI 自学",
    "skills.curationOffSetting": "AI 自学没有开启，技能库不会自己增长。",
    "skills.curationRunning": "AI 正在自学，稍后回来看看。",
    "skills.curationIdle": "已开启：任务队列闲下来时，AI 会从做完的工作里总结新技能。",
    "skills.curationLastRun": "上次自学",
    "skills.curationNeverRun": "还没有自学记录。",
    "skills.curateNow": "立即自学一轮",
    "skills.curateNowConfirm": "确认开始？再点一次",
    "skills.curateNowStarted": "已开始自学，跑完刷新这一页就能看到结果。",
    "skills.curateNowFailed": "没能开始，请稍后再试。",
    "settings.runtime": "服务状态",
    "settings.llm": "AI 运行配置",
    "settings.language": "语言",
    "settings.device": "桌面与本地能力",
    "settings.boolYes": "是",
    "settings.boolNo": "否",
    "settings.configured": "已配置",
    "settings.notConfigured": "未配置",
    "settings.ready": "就绪",
    "settings.needsAttention": "需要处理",
    "settings.synced": "已同步",
    "settings.needsSync": "待同步",
    "settings.worker": "并发处理能力",
    "settings.broker": "消息通道",
    "settings.database": "数据存储",
    "settings.runtimeStatus": "运行状态",
    "settings.provider": "提供方",
    "settings.model": "模型",
    "settings.apiKey": "密钥状态",
    "settings.baseUrl": "服务地址状态",
    "settings.activeLocale": "当前语言",
    "settings.preferenceLocale": "服务端偏好",
    "settings.preferenceSource": "偏好来源",
    "settings.preferenceSync": "同步状态",
    "settings.supported": "支持语言",
    "settings.localExecution": "本地执行边界",
    "settings.independentPet": "独立桌宠窗口",
    "settings.petBoundary": "桌宠形象在独立窗口里设置",
    "settings.desktopGate": "桌面功能开关",
    "settings.webLocalActions": "网页端本地操作",
    "settings.restore": "恢复入口",
    "memory.kicker": "记忆与技能",
    "memory.title": "记忆管理",
    "memory.summary": "查看并管理 AI 助手记住的关于你的偏好，以及团队共享的技能库。",
    "memory.tabProfile": "关于我",
    "memory.tabSkills": "团队技能",
    "memory.profileEmpty": "AI 助手还没有记住关于你的任何偏好。",
    "memory.category.preference": "偏好",
    "memory.category.correction": "纠正",
    "memory.category.recurring_context": "常用上下文",
    "memory.provenanceUnknown": "早期记录，出处不明",
    "memory.edit": "编辑",
    "memory.save": "保存",
    "memory.cancel": "取消",
    "memory.delete": "删除",
    "memory.deleteConfirm": "确定删除？再点一次",
    "memory.deleteHint": "删除后 AI 助手将忘记这条。",
    "memory.skillsEmpty": "还没有攒下团队技能。",
    "memory.status.draft": "草稿",
    "memory.status.active": "在用",
    "memory.status.deprecated": "已停用",
    "memory.deactivate": "停用",
    "memory.deactivateConfirm": "确定停用？再点一次",
    "memory.adminOnlyNote": "编辑与停用仅管理员可操作。",
    "memory.humanEdited": "管理员手改",
    "memory.reasonPlaceholder": "停用原因（可选）",
    "agents.teamPartiallyDone": "AI 小组部分完成 {ratio}",
    "agents.teamCompleted": "AI 小组已完成 {ratio}",
    "agents.teamPaused": "AI 小组已暂停 {ratio}",
    "agents.teamReady": "AI 小组待出发 {ratio}",
    "agents.teamInProgress": "AI 小组进行中 {ratio}",
    "drive.filesShown": "已显示前 {shown} 个文件，共 {total} 个。",
    "drive.recycleShown": "已显示 {shown} 项，还有 {hidden} 项。打开对应文件即可还原。",
    "projectHome.handleableSummary": "你可以处理其中 {shown} 条（共 {total} 条进行中）",
    "projectHome.collapsedSummary": "另有 {count} 条这里没有展开",
    "projectHome.armyPill": "AI 小组子任务 {done}/{total}",
    "cost.subtaskCount": "{count} 个子任务",
    "cost.armyCapped": "按花费只显示前 8 个 AI 小组（共 {total} 个）。",
    "plan.shareShort": "预算份额加起来是 {total}%，还差 {delta}%，修正后才能批准并开始。",
    "plan.shareOver": "预算份额加起来是 {total}%，超出 {delta}%，修正后才能批准并开始。"
  },
  "en-US": {
    "workitem.context": "Task context",
    "workitem.trace": "AI work replay",
    "workitem.deliverables": "Proposed changes",
    "workitem.driveSource": "Drive comment source",
    "workitem.meetingSource": "Meeting insight source",
    "workitem.observerSource": "Conversation observer source",
    "workitem.observerSourceBody": "Created by Cuu, the project chat observer.",
    "workitem.openProposal": "Open change request",
    "workitem.openReplay": "Open replay",
    "workitem.createTaskPlan": "Draft task plan",
    "intake.summary": "Intake summary",
    "intake.progress": "Clarification progress",
    "intake.freeText": "Type your answer",
    "intake.createWorkItem": "Create task",
    "intake.continue": "Continue intake",
    "intake.stateDone": "Done",
    "intake.stateActive": "In progress",
    "intake.statePending": "Pending",
    "intake.startKicker": "New task",
    "intake.startTitle": "Start from a real project",
    "intake.startBody": "Pick a direction and AI starts from there. Accepted deliverables stay untouched until you approve a change.",
    "intake.startProject": "Default project",
    "intake.startAction": "Start work intake",
    "intake.startNext": "Next: pick a work type, then let AI do the work.",
    "intake.startEvidence": "Evidence and cost will appear in Replay and Cost.",
    "intake.startIntent": "Real task",
    "intake.startIntentPlaceholder": "Example: turn today's customer feedback into open issues, adoption notes, and next owners.",
    "knowledge.kicker": "Knowledge fallback",
    "knowledge.sources": "Evidence sources",
    "knowledge.missing": "No reliable evidence found. WorkHub will not invent sources.",
    "knowledge.open": "Open evidence",
    "knowledge.searchPlaceholder": "Search evidence, docs, meeting notes…",
    "knowledge.searchLabel": "Search knowledge evidence",
    "knowledge.searchSubmit": "Search",
    "knowledge.scopeLandingCta": "Go to projects",
    "search.kicker": "Global search",
    "search.title": "Search",
    "search.summary": "Search across chat, drive, tasks, and meetings.",
    "search.placeholder": "Search keyword…",
    "search.label": "Search everything",
    "search.submit": "Search",
    "search.promptEmpty": "Type at least 2 characters to start searching.",
    "search.promptShort": "Your search needs at least 2 characters.",
    "search.loading": "Searching…",
    "search.groupConversations": "Chat",
    "search.groupDrive": "Drive",
    "search.groupWorkItems": "Tasks",
    "search.groupMeetings": "Meetings",
    "search.desktopOnlyNote": "The online mirror is read-only — open a hit to view the conversation mirror; collaborate in the desktop workbench.",
    "conversation.kicker": "Read-only mirror",
    "conversation.title": "Conversation mirror",
    "conversation.readonlyBanner": "Read-only mirror · Collaborate in the desktop workbench",
    "conversation.readonlyHint": "This mirrors messages only — no sending, reactions, or read receipts, and it never changes anyone's unread state.",
    "conversation.empty": "This conversation has no messages to show yet.",
    "conversation.older": "Older",
    "conversation.newer": "Newer",
    "conversation.latest": "Jump to latest",
    "conversation.refresh": "Refresh",
    "conversation.senderCuu": "Cuu",
    "conversation.senderSystem": "System",
    "conversation.senderUnknown": "Unknown member",
    "conversation.edited": "edited",
    "conversation.pinned": "Pinned",
    "conversation.deleted": "This message was deleted",
    "conversation.replyDeleted": "Original message deleted",
    "conversation.clarifyBadge": "Cuu is asking",
    "conversation.toolNote": "(a tool call)",
    "conversation.systemFallback": "System update",
    "conversation.riskDigest": "Today's risk digest",
    "conversation.fileCard": "File card",
    "proposal.summary": "AI summary",
    "proposal.review": "Review actions",
    "proposal.files": "Files and object changes",
    "drive.kicker": "Project drive",
    "drive.allProjects": "All projects",
    "drive.switchProject": "Switch project",
    "drive.files": "File tree",
    "drive.versions": "Version history",
    "drive.comments": "Comments",
    "drive.recycle": "Recycle",
    "drive.operations": "Operation log",
    "drive.empty": "This project does not have accepted deliverables yet.",
    "drive.emptyFiles": "This project's drive is empty — uploaded or generated files will show up here.",
    "drive.emptyVersions": "No version history yet.",
    "drive.emptyRecycle": "The recycle bin is empty.",
    "drive.emptyOperations": "No operations yet.",
    "drive.selectFile": "Pick a file on the left to see its details.",
    "drive.upload": "Upload file",
    "drive.delete": "Move to recycle",
    "drive.preview": "Preview",
    "drive.download": "Download",
    "drive.restore": "Restore",
    "drive.current": "Current",
    "drive.createDraft": "Create draft",
    "drive.openDraft": "Open draft",
    "drive.openProposal": "Open change request",
    "drive.requestedMissing": "We could not find that file, so the drive is back at the default view.",
    "drive.status.pending_llm": "Pending draft",
    "drive.status.draft_created": "Draft created",
    "drive.status.proposal_created": "Proposal created",
    "drive.status.dismissed": "Dismissed",
    "meeting.kicker": "Meeting insights",
    "meeting.transcript": "Transcript",
    "meeting.minutes": "Minutes",
    "meeting.insights": "Insights",
    "meeting.createDraft": "Create draft",
    "meeting.dismiss": "Dismiss",
    "meeting.openDraft": "Open draft",
    "meeting.openProposal": "Open change request",
    "meeting.reason": "AI rationale",
    "meeting.approvalSafe": "Approval-safe: official project state will not change until you confirm.",
    "meeting.reanalyze": "Regenerate minutes",
    "meeting.aiNotConfigured": "This deployment has no AI configured: imported meetings keep their transcript only — minutes and insights are not generated.",
    "meeting.minutesQueued": "Minutes are still being generated — check back shortly.",
    "meeting.minutesNotConfigured": "AI is not configured, so this meeting only has its transcript.",
    "meeting.empty": "This project does not have meeting insights yet.",
    "meeting.status.ready": "Ready",
    "meeting.status.transcribed": "Transcript imported",
    "meeting.status.processing": "Processing",
    "meeting.status.failed": "Failed",
    "meeting.status.pending": "Pending",
    "meeting.status.confirmed": "Confirmed",
    "meeting.status.dismissed": "Dismissed",
    "notifications.kicker": "Notifications",
    "notifications.needsDecision": "Needs your decision",
    "notifications.fyi": "FYI",
    "notifications.done": "Archived",
    "notifications.markAllRead": "Mark all read (skips decisions)",
    "notifications.empty": "Your inbox is empty.",
    "notifications.muteTitle": "Notification mute preferences",
    "notifications.muteHelp": "Checked types stop notifying you (everything is on by default).",
    "notifications.open": "Open",
    "notifications.unread": "Unread",
    "notifications.read": "Read",
    "notifications.completed": "Done",
    "notifications.source": "Source",
    "notifications.groundingWhy": "Why am I seeing this",
    "notifications.conversationLinked": "This notification is tied to a discussion — view the read-only mirror; collaborate in the desktop workbench",
    "notifications.conversationOpen": "View read-only mirror",
    "notifications.snooze": "Snooze",
    "notifications.snoozed": "Snoozed",
    "knowledge.fromNotice": "Search context from a notification",
    "health.kicker": "Project health",
    "health.title": "Health overview",
    "health.healthy": "Healthy",
    "health.attention": "Needs attention",
    "health.critical": "Critical",
    "health.empty": "No visible projects yet.",
    "health.bandsOnly": "You see band labels; numbers are admin-only.",
    "health.openProject": "Open project",
    "health.signal.open_work_items": "Open items",
    "health.signal.overdue_work_items": "Overdue items",
    "health.signal.pending_approvals": "Pending approvals",
    "health.signal.failed_runs": "Failed runs",
    "health.signal.pending_insights": "Pending insights",
    "calendar.kicker": "Calendar",
    "calendar.today": "Today",
    "calendar.week": "This week",
    "calendar.empty": "No events in this period.",
    "calendar.upcoming": "Upcoming",
    "calendar.overdue": "Overdue",
    "calendar.done": "Done",
    "calendar.allDay": "All-day",
    "calendar.workItemDue": "Work item due",
    "calendar.meetingFollowup": "Meeting insight",
    "calendar.scheduleEvent": "Schedule event",
    "calendar.reviewWindow": "Review window",
    "cost.scopes": "Budget scopes",
    "cost.risks": "Budget risks",
    "cost.models": "Model breakdown",
    "cost.trend": "Days tracked",
    "cost.remaining": "Remaining",
    "cost.laborSplit": "Work vs self-improvement",
    "cost.laborProduction": "Production spend",
    "cost.laborSelfImprovement": "Self-improvement spend",
    "cost.laborSelfImprovementRatio": "Self-improvement share",
    "cost.trendTitle": "Spend trend",
    "cost.byWorkitem": "Spend by work item",
    "cost.byTeam": "Spend by team",
    "agents.kicker": "AI teams",
    "agents.summary": "Observe active task plans; decisions still go through the overview inbox.",
    "agents.active": "Active teams",
    "agents.waiting": "Needs your decision",
    "agents.todayCost": "Today cost",
    "agents.autonomy": "Autonomy",
    "agents.plans": "Active plans",
    "agents.recent": "Recent escalations",
    "agents.noRecent": "No escalations yet.",
    "agents.empty": "No AI teams are running yet. Next time a task is large, WorkHub drafts a task plan first.",
    "agents.start": "Start a task",
    "agents.cost": "Cost",
    "agents.costDetails": "View cost",
    "agents.objective": "Objective",
    "agents.capPlans": "Showing the first {limit} teams; the list refreshes as work moves forward.",
    "agents.capRows": "Some subtask, run or handover rows are capped; open the task for the full picture.",
    "agents.judge": "Review pass rate",
    "skills.kicker": "Team skill library",
    "skills.title": "Team skills",
    "skills.summary": "Reusable skills the AI picks up from real work and keeps refining",
    "skills.empty": "No team skills yet. The AI sums them up nightly from real work.",
    "projects.kicker": "Projects",
    "projects.title": "Projects",
    "projects.summary": "Each project holds its open tasks, its owner and its latest activity.",
    "projects.empty": "No projects yet. Create one to start assigning work.",
    "projects.new": "New project",
    "projects.namePlaceholder": "New project name",
    "projects.create": "Create",
    "projects.open": "Open project",
    "projects.archived": "Archived",
    "projects.openItems": "Open",
    "projects.updated": "Updated",
    "projects.owner": "Owner",
    "projectHome.kicker": "Project home",
    "projectHome.openWork": "Open work",
    "projectHome.empty": "No open work in this project yet. Hit “New task” to assign some.",
    "projectHome.back": "← Back to projects",
    "projectHome.files": "Recent files",
    "projectHome.noFiles": "No files in the drive yet.",
    "projectHome.github": "Recent GitHub activity",
    "projectHome.githubEmpty": "Bind GitHub in the desktop client's project settings to see this.",
    "skills.active": "Active",
    "skills.aiAuthored": "AI learned",
    "skills.refined": "Refined",
    "skills.version": "Version",
    "skills.readiness": "Readiness",
    "skills.refinedFrom": "refined from v",
    "skills.curationTitle": "AI self-learning",
    "skills.curationOffSetting": "AI self-learning is off, so the skill library won't grow on its own.",
    "skills.curationRunning": "The AI is learning right now — check back shortly.",
    "skills.curationIdle": "On: whenever the task queue goes idle, the AI sums up new skills from finished work.",
    "skills.curationLastRun": "Last learned",
    "skills.curationNeverRun": "No self-learning has run yet.",
    "skills.curateNow": "Learn a round now",
    "skills.curateNowConfirm": "Start now? Click again",
    "skills.curateNowStarted": "Started. Refresh this page once it finishes to see what changed.",
    "skills.curateNowFailed": "Could not start. Try again in a moment.",
    "settings.runtime": "Service status",
    "settings.llm": "AI runtime config",
    "settings.language": "Language",
    "settings.device": "Desktop and local capability",
    "settings.boolYes": "Yes",
    "settings.boolNo": "No",
    "settings.configured": "Configured",
    "settings.notConfigured": "Not configured",
    "settings.ready": "Ready",
    "settings.needsAttention": "Needs attention",
    "settings.synced": "Synced",
    "settings.needsSync": "Needs sync",
    "settings.worker": "Concurrency",
    "settings.broker": "Messaging",
    "settings.database": "Storage",
    "settings.runtimeStatus": "Runtime status",
    "settings.provider": "Provider",
    "settings.model": "Model",
    "settings.apiKey": "Key status",
    "settings.baseUrl": "Service URL status",
    "settings.activeLocale": "Active locale",
    "settings.preferenceLocale": "Server preference",
    "settings.preferenceSource": "Preference source",
    "settings.preferenceSync": "Sync state",
    "settings.supported": "Supported locales",
    "settings.localExecution": "Local execution boundary",
    "settings.independentPet": "Independent pet window",
    "settings.petBoundary": "Pet look is not configured in the Web main window",
    "settings.desktopGate": "Desktop capability gate",
    "settings.webLocalActions": "Web local actions",
    "settings.restore": "Recovery entry",
    "memory.kicker": "Memory & skills",
    "memory.title": "Memory management",
    "memory.summary": "Review and manage what the AI assistant remembers about you, plus the team's shared skill library.",
    "memory.tabProfile": "About me",
    "memory.tabSkills": "Team skills",
    "memory.profileEmpty": "The AI assistant hasn't learned any preferences about you yet.",
    "memory.category.preference": "Preference",
    "memory.category.correction": "Correction",
    "memory.category.recurring_context": "Recurring context",
    "memory.provenanceUnknown": "Early record, source unknown",
    "memory.edit": "Edit",
    "memory.save": "Save",
    "memory.cancel": "Cancel",
    "memory.delete": "Delete",
    "memory.deleteConfirm": "Really delete? Click again",
    "memory.deleteHint": "The AI assistant will forget this once deleted.",
    "memory.skillsEmpty": "No team skills yet.",
    "memory.status.draft": "Draft",
    "memory.status.active": "Active",
    "memory.status.deprecated": "Deprecated",
    "memory.deactivate": "Deactivate",
    "memory.deactivateConfirm": "Really deactivate? Click again",
    "memory.adminOnlyNote": "Editing and deactivating are admin-only.",
    "memory.humanEdited": "Manually edited",
    "memory.reasonPlaceholder": "Deactivation reason (optional)",
    "agents.teamPartiallyDone": "AI team partially done {ratio}",
    "agents.teamCompleted": "AI team completed {ratio}",
    "agents.teamPaused": "AI team paused {ratio}",
    "agents.teamReady": "AI team ready {ratio}",
    "agents.teamInProgress": "AI team in progress {ratio}",
    "drive.filesShown": "Showing the first {shown} of {total} files.",
    "drive.recycleShown": "Showing {shown} items; {hidden} more. Open the file itself to restore it.",
    "projectHome.handleableSummary": "You can act on {shown} of {total} open items",
    "projectHome.collapsedSummary": "{count} more not shown here",
    "projectHome.armyPill": "AI team {done}/{total}",
    "cost.subtaskCount": "{count} subtasks",
    "cost.armyCapped": "Showing the 8 costliest AI teams of {total}.",
    "plan.shareShort": "Budget shares add up to {total}% — {delta}% short. Fix them before approving.",
    "plan.shareOver": "Budget shares add up to {total}% — {delta}% over. Fix them before approving."
  }
};
