import type {
  ActionSpec,
  ApprovalCenterVM,
  ApprovalDetailVM,
  AttentionAction,
  AttentionHomeVM,
  AttentionItem,
  CostDashboardVM,
  CalendarPageVM,
  DeliverableChange,
  DeliverableCheck,
  DrivePageVM,
  EvidenceBubble,
  EvidenceRef,
  ProposalConflict,
  ProposalDetailVM,
  MeetingPageVM,
  NotificationPageVM,
  ProjectHealthPageVM,
  ProjectListVM,
  ReplayTraceVM,
  SessionVM,
  SettingsPageVM,
  TeamSkillsPageVM,
  GoldPathSurfaceVM,
  WorkItemDetailVM
} from "@workhub/contracts";

import { renderAgentRunReplay } from "../replay/index.js";
import { proposalCss, renderProposalConflictCards } from "../proposal/index.js";
import {
  createCostReactRouteComponent,
  createHomeReactRouteComponent,
  createProposalReactRouteComponent,
  createReplayReactRouteComponent,
  createSettingsReactRouteComponent,
  reactRouteComponentMarkerAttrs,
  type WebReactRouteComponentAdapter
} from "./route-react-components.js";
import {
  changeTypeLabel,
  checkStatusLabel,
  deliverableTargetLabel,
  evidenceSourceLabel,
  previewKindLabel,
  uiCount,
  uiT,
  workItemStatusLabel
} from "../i18n.js";
import { goldPathT, normalizeWorkHubLocale, type WorkHubLocale } from "./i18n.js";
import type { GoldPathRenderedPage } from "./render.js";

// "skills"/"projects" 是 live-only 路由（不在 gold-path 静态 surface 渲染里），故单独并入而非走 Extract。
export type WebRouteComponentKey = Extract<GoldPathRenderedPage["key"], "home" | "intake" | "approvals" | "workitem" | "proposal" | "drive" | "meetings" | "notifications" | "calendar" | "health" | "replay" | "cost" | "knowledge" | "settings"> | "skills" | "projects";

export type WebRouteComponent = {
  key: WebRouteComponentKey;
  html: string;
  css: string;
  primaryHrefs: string[];
  hydration: WebRouteHydrationBoundary;
  reactComponent?: WebReactRouteComponentAdapter;
};

export type WebRouteComponentMap = Partial<Record<GoldPathRenderedPage["key"], WebRouteComponent>>;

type RouteComponentOptions = {
  locale?: WorkHubLocale | undefined;
};

export type WebRouteHydrationMode = "html-fallback";

export type WebRouteComponentSource = "page-vm" | "session-vm" | "evidence-bubble" | "project-bootstrap";

export type WebRouteHydrationBoundary = {
  rootId: string;
  routeKey: WebRouteComponentKey;
  mode: WebRouteHydrationMode;
  source: WebRouteComponentSource;
  locale: WorkHubLocale;
  pageVm: string;
  actionHrefCount: number;
  adapter: "route-component-v1";
};

type CreateWebRouteComponentInput = {
  key: WebRouteComponentKey;
  css: string;
  primaryHrefs: string[];
  html: string;
  source: WebRouteComponentSource;
  locale: WorkHubLocale;
  pageVm: string;
  reactComponent?: WebReactRouteComponentAdapter;
};

type ProposalConflictSurface = GoldPathSurfaceVM & {
  conflicts?: ProposalConflict[];
  proposal_conflicts?: ProposalConflict[];
};

type R4RouteSurface = ProposalConflictSurface & {
  intake_session?: SessionVM;
  knowledge_evidence?: EvidenceBubble;
};

export const webRouteComponentCss = [
  ".wh-r4-route{display:grid;gap:16px;min-width:0;max-width:100%;overflow:hidden}",
  ".wh-r4-route,.wh-r4-route *{box-sizing:border-box;min-width:0}",
  ".wh-r4-route-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:end}",
  ".wh-r4-route-head h2{margin:4px 0 0;font-size:24px;line-height:1.35;letter-spacing:0;overflow-wrap:anywhere}",
  ".wh-r4-route-head p{margin:6px 0 0;color:var(--wh-product-muted,#66728c);line-height:1.5;overflow-wrap:anywhere}",
  ".wh-r4-route-kicker{color:var(--wh-product-blue,#355cff);font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0}",
  ".wh-r4-route-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(260px,.8fr);gap:14px;align-items:start}",
  ".wh-r4-route-stack{display:grid;gap:12px;min-width:0}",
  ".wh-r4-route-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start;border-top:1px solid var(--wh-product-line,#dce4f1);padding-top:12px}",
  ".wh-r4-route-row--stacked{grid-template-columns:1fr;gap:8px}",
  ".wh-r4-route-row:first-child{border-top:0;padding-top:0}",
  ".wh-r4-route-row p,.wh-r4-route-row h3,.wh-r4-route-row strong{margin:0;overflow-wrap:anywhere}",
  ".wh-r4-route-row p{color:var(--wh-product-muted,#66728c);line-height:1.45}",
  ".wh-r4-route-card{display:grid;gap:10px;min-width:0;max-width:100%;overflow:hidden}",
  ".wh-r4-route-card h3{margin:0;font-size:16px;line-height:1.35;overflow-wrap:anywhere}",
  ".wh-r4-route-card p{margin:0;color:var(--wh-product-muted,#66728c);line-height:1.5;overflow-wrap:anywhere}",
  ".wh-r4-route-card--accent{border-color:rgba(53,92,255,.22);box-shadow:0 12px 28px rgba(37,51,79,.06)}",
  ".wh-r4-route-card[data-intake-option-selected=true]{border-color:var(--wh-product-blue,#355cff);box-shadow:0 0 0 1px rgba(53,92,255,.22),0 12px 28px rgba(37,51,79,.08)}",
  ".wh-r4-route-table{display:grid;gap:8px;min-width:0}",
  ".wh-r4-route-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-start}",
  ".wh-r4-route-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}",
  ".wh-r4-route .wh-btn,.wh-r4-route .wh-pill{max-width:100%;white-space:normal;text-align:left;overflow-wrap:anywhere}",
  ".wh-r4-route details:not([open])>*:not(summary){display:none}",
  ".wh-r4-intake-free-text{width:100%;min-height:92px;resize:vertical;border:1px solid var(--wh-product-line,#dce4f1);border-radius:8px;padding:10px 12px;font:inherit;line-height:1.45;color:var(--wh-product-ink,#172033);background:#fff;overflow-wrap:anywhere}",
  ".wh-r4-knowledge-search{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 4px;min-width:0;max-width:100%}.wh-r4-knowledge-search input{flex:1 1 220px;min-width:0;max-width:100%;box-sizing:border-box;font:inherit;line-height:1.45;border:1px solid var(--wh-product-line,#dce4f1);border-radius:8px;padding:9px 12px;color:var(--wh-product-ink,#172033);background:#fff}.wh-r4-knowledge-search .wh-btn{flex:0 0 auto}",
  ".wh-r4-project-create{display:flex;gap:8px;flex-wrap:wrap;align-items:center;min-width:0;max-width:100%}.wh-r4-project-create input{flex:1 1 220px;min-width:0;max-width:100%;box-sizing:border-box;font:inherit;line-height:1.45;border:1px solid var(--wh-product-line,#dce4f1);border-radius:8px;padding:9px 12px;color:var(--wh-product-ink,#172033);background:#fff}.wh-r4-project-create .wh-btn{flex:0 0 auto}",
  ".wh-r5-notif-mute summary{cursor:pointer;font-weight:800;font-size:14px;color:var(--wh-product-ink,#172033)}.wh-r5-notif-mute-list{display:grid;gap:8px;margin-top:8px;min-width:0}.wh-r5-notif-mute-row{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:1.4;color:var(--wh-product-secondary,#5B616E);min-width:0;overflow-wrap:anywhere}.wh-r5-notif-mute-row input{margin-top:2px;flex:0 0 auto}.wh-r5-notif-mute-row span{min-width:0}.wh-r5-notif-mute-status{margin:8px 0 0;font-size:12.5px}",
  ".wh-r4-route-count{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--wh-product-line,#dce4f1);border-radius:8px;background:#fff;padding:8px 10px;color:var(--wh-product-ink,#172033);font-weight:900;line-height:1}",
  ".wh-r4-route-timeline{display:grid;gap:8px}",
  ".wh-r4-route-meter{height:8px;border-radius:999px;background:#e7edf7;overflow:hidden}.wh-r4-route-meter span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--wh-product-green,#24a66a),var(--wh-product-amber,#d98b16));max-width:100%}",
  ".wh-r5-meeting-text{margin:0;max-height:260px;overflow:auto;white-space:pre-wrap;color:var(--wh-product-muted,#66728c);font-family:\"Aptos\",\"Segoe UI\",sans-serif;font-size:13px;line-height:1.55;overflow-wrap:anywhere}",
  ".wh-r4-home-banner{display:flex;align-items:center;gap:10px;padding:11px 14px;border:1px solid #F1DC9C;border-radius:12px;background:#FEFBF0;color:#8A7330;font-size:13.5px;font-weight:700;flex-wrap:wrap;line-height:1.5}.wh-r4-home-banner b{color:#1A1D26;font-weight:900}.wh-r4-home-banner-cat{width:18px;height:18px;border-radius:50% 50% 45% 45%;background:#1A1D26;position:relative;flex:0 0 auto}.wh-r4-home-banner-cat::before,.wh-r4-home-banner-cat::after{content:\"\";position:absolute;top:6px;width:4px;height:4px;border-radius:999px;background:#F4D35E}.wh-r4-home-banner-cat::before{left:4px}.wh-r4-home-banner-cat::after{right:4px}.wh-r4-home-kao{color:var(--wh-product-blue,#4F46E5)}",
  ".wh-r4-home-chips{display:flex;gap:10px;flex-wrap:wrap}.wh-r4-home-chip{display:flex;align-items:center;gap:8px;padding:11px 14px;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:12px;background:#fff;font-size:12.5px;font-weight:700;color:var(--wh-product-secondary,#5B616E);min-width:118px}.wh-r4-home-chip b{font-size:22px;font-weight:900;color:var(--wh-product-ink,#1A1D26);line-height:1}.wh-r4-home-chip--accent{border-color:var(--wh-product-blue-pale,#D9DBF5);background:var(--wh-product-blue-tint,#F5F5FE);color:var(--wh-product-blue,#4F46E5)}.wh-r4-home-chip--accent b{color:var(--wh-product-blue,#4F46E5)}.wh-r4-home-chip--ok b{color:var(--wh-product-green,#15A05A)}",
  ".wh-r4-decision{position:relative;border-color:var(--wh-product-blue-pale,#D9DBF5);overflow:hidden}.wh-r4-decision .wh-r4-decision-top{position:absolute;top:0;left:0;right:0;height:3px;background:var(--wh-product-blue,#4F46E5)}.wh-r4-decision h3{font-size:18px}",
  ".wh-r4-prio{font-weight:800}.wh-r4-prio--danger{background:var(--wh-product-red-light,#FCECEC);color:var(--wh-product-red,#E5484D)}.wh-r4-prio--warn{background:var(--wh-product-amber-light,#FCF3E6);color:var(--wh-product-amber,#E0892A)}.wh-r4-prio--muted{background:var(--wh-product-blue-light,#EEF0FE);color:var(--wh-product-blue,#4F46E5)}",
  ".wh-r4-status{display:flex;gap:14px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--wh-product-line-alt,#EEF0F3);font-size:12.5px;font-weight:700;color:var(--wh-product-secondary,#5B616E)}",
  ".wh-r4-run{display:flex;align-items:center;gap:10px;justify-content:space-between;border-top:1px solid var(--wh-product-line-alt,#EEF0F3);padding-top:10px}.wh-r4-run:first-child{border-top:0;padding-top:0}.wh-r4-run-main{min-width:0}.wh-r4-run-main strong{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wh-r4-run-main p{margin:2px 0 0;color:var(--wh-product-muted,#9AA0AC);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wh-r4-runstate{flex:0 0 auto;font-weight:800}.wh-r4-runstate--accent{background:var(--wh-product-blue-light,#EEF0FE);color:var(--wh-product-blue,#4F46E5)}.wh-r4-runstate--warn{background:var(--wh-product-amber-light,#FCF3E6);color:var(--wh-product-amber,#E0892A)}.wh-r4-runstate--danger{background:var(--wh-product-red-light,#FCECEC);color:var(--wh-product-red,#E5484D)}",
  ".wh-r4-approvals-grid{grid-template-columns:minmax(220px,.85fr) minmax(0,1.3fr) minmax(240px,.85fr)}",
  ".wh-r4-approval-list-item{cursor:default}.wh-r4-approval-list-item h3{font-size:14px}.wh-r4-approval-list-item p{font-size:12.5px}.wh-r4-approval-list-item[data-r4-approval-selected=true]{border-color:var(--wh-product-blue,#4F46E5);box-shadow:inset 3px 0 0 var(--wh-product-blue,#4F46E5)}",
  ".wh-r4-approval-detail h4{margin:4px 0 0;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.02em;color:var(--wh-product-secondary,#5B616E)}",
  ".wh-r4-approval-evidence{list-style:none;margin:0;padding:0;display:grid;gap:6px}.wh-r4-approval-evidence li{display:grid;gap:2px;font-size:13px;line-height:1.4}.wh-r4-approval-evidence .wh-subtle{font-size:12px}",
  ".wh-r4-approval-detail-panel[hidden]{display:none}.wh-r4-approval-detail-panel section{display:grid;gap:6px}.wh-r4-approval-field{display:grid;gap:4px}.wh-r4-approval-reason,.wh-r4-approval-comment-input{width:100%;max-width:100%;box-sizing:border-box;min-width:0;resize:vertical;font:inherit;border:1px solid var(--wh-product-line,#E6E7EB);border-radius:8px;padding:6px;overflow-wrap:anywhere}.wh-r4-approval-remember{display:flex;gap:6px;align-items:flex-start;font-size:13px;color:var(--wh-product-secondary,#5B616E)}.wh-r4-approval-comment-form{display:grid;gap:6px}",
  ".wh-r4-approval-detail .wh-r4-route-row{grid-template-columns:1fr}.wh-r4-approval-detail .wh-r4-route-row p,.wh-r4-approval-detail .wh-r4-route-row strong{overflow-wrap:anywhere;white-space:normal}.wh-r4-approval-detail .wh-r4-route-meta{justify-content:flex-start}",
  "@media (max-width:1040px){.wh-r4-approvals-grid{grid-template-columns:1fr}}",
  "@media (max-width:860px){.wh-r4-route-head,.wh-r4-route-grid,.wh-r4-route-row{grid-template-columns:1fr}.wh-r4-route-head{align-items:start}.wh-r4-route-count{width:max-content}.wh-r4-route-actions{align-items:flex-start}}"
].join("");

type RouteCopyKey =
  | "workitem.context"
  | "workitem.trace"
  | "workitem.deliverables"
  | "workitem.driveSource"
  | "workitem.meetingSource"
  | "workitem.openProposal"
  | "workitem.openReplay"
  | "workitem.startRun"
  | "intake.summary"
  | "intake.progress"
  | "intake.freeText"
  | "intake.createWorkItem"
  | "intake.continue"
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
  | "proposal.summary"
  | "proposal.review"
  | "proposal.rollback"
  | "proposal.files"
  | "drive.kicker"
  | "drive.allProjects"
  | "drive.switchProject"
  | "drive.files"
  | "drive.versions"
  | "drive.accepted"
  | "drive.comments"
  | "drive.recycle"
  | "drive.operations"
  | "drive.empty"
  | "drive.upload"
  | "drive.delete"
  | "drive.preview"
  | "drive.download"
  | "drive.restore"
  | "drive.current"
  | "drive.pendingDrafts"
  | "drive.createDraft"
  | "drive.openDraft"
  | "drive.openProposal"
  | "drive.status.pending_llm"
  | "drive.status.draft_created"
  | "drive.status.proposal_created"
  | "drive.status.dismissed"
  | "meeting.kicker"
  | "meeting.transcript"
  | "meeting.minutes"
  | "meeting.insights"
  | "meeting.evidence"
  | "meeting.createDraft"
  | "meeting.dismiss"
  | "meeting.openDraft"
  | "meeting.openProposal"
  | "meeting.reason"
  | "meeting.approvalSafe"
  | "meeting.empty"
  | "meeting.status.ready"
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
  | "knowledge.fromNotice"
  | "health.kicker"
  | "health.summary"
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
  | "skills.kicker"
  | "skills.title"
  | "skills.summary"
  | "skills.empty"
  | "skills.active"
  | "skills.aiAuthored"
  | "skills.refined"
  | "skills.version"
  | "skills.confidence"
  | "skills.refinedFrom"
  | "skills.authoredBy"
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
  | "settings.lease"
  | "settings.recovery"
  | "settings.provider"
  | "settings.model"
  | "settings.apiKey"
  | "settings.baseUrl"
  | "settings.secretSafe"
  | "settings.activeLocale"
  | "settings.preferenceLocale"
  | "settings.preferenceSource"
  | "settings.preferenceSync"
  | "settings.updateEndpoint"
  | "settings.supported"
  | "settings.storage"
  | "settings.localExecution"
  | "settings.independentPet"
  | "settings.petBoundary"
  | "settings.desktopGate"
  | "settings.webLocalActions"
  | "settings.restore";

const routeCopy: Record<WorkHubLocale, Record<RouteCopyKey, string>> = {
  "zh-CN": {
    "workitem.context": "任务上下文",
    "workitem.trace": "AI 工作过程",
    "workitem.deliverables": "交付物入口",
    "workitem.driveSource": "网盘评论来源",
    "workitem.meetingSource": "会议洞察来源",
    "workitem.openProposal": "查看变更申请",
    "workitem.openReplay": "查看回放",
    "workitem.startRun": "开始 AI 执行",
    "intake.summary": "接入摘要",
    "intake.progress": "澄清进度",
    "intake.freeText": "也可以展开手动输入（可选）",
    "intake.createWorkItem": "创建工作项",
    "intake.continue": "继续澄清",
    "intake.startKicker": "试点工作入口",
    "intake.startTitle": "从真实项目开始派活",
    "intake.startBody": "WorkHub 会先准备好试点项目，再进入选项优先的需求澄清；不会改动已确认的交付物。",
    "intake.startProject": "试点项目",
    "intake.startAction": "开始派活",
    "intake.startNext": "下一步：选择工作类型，让 AI 开始干活。",
    "intake.startEvidence": "证据与成本会进入回放和成本页。",
    "intake.startIntent": "真实任务",
    "intake.startIntentPlaceholder": "例如：整理今天的试点反馈，输出阻塞问题、采纳建议和下一步负责人。",
    "knowledge.kicker": "知识库",
    "knowledge.sources": "证据来源",
    "knowledge.missing": "没有可靠证据，不会编造来源。",
    "knowledge.open": "打开证据",
    "knowledge.searchPlaceholder": "搜索证据、文档、会议纪要…",
    "knowledge.searchLabel": "搜索知识库证据",
    "knowledge.searchSubmit": "搜索",
    "proposal.summary": "AI 摘要",
    "proposal.review": "审阅动作",
    "proposal.rollback": "回滚路径",
    "proposal.files": "文件与对象变化",
    "drive.kicker": "项目网盘",
    "drive.allProjects": "所有项目",
    "drive.switchProject": "切换项目",
    "drive.files": "文件列表",
    "drive.versions": "版本历史",
    "drive.accepted": "正式交付物",
    "drive.comments": "评论草稿",
    "drive.recycle": "回收站",
    "drive.operations": "操作日志",
    "drive.empty": "这个项目还没有正式交付物。",
    "drive.upload": "上传样例",
    "drive.delete": "移到回收站",
    "drive.preview": "预览",
    "drive.download": "下载",
    "drive.restore": "还原",
    "drive.current": "当前",
    "drive.pendingDrafts": "待处理草稿",
    "drive.createDraft": "生成草稿",
    "drive.openDraft": "打开草稿",
    "drive.openProposal": "打开提议",
    "drive.status.pending_llm": "待生成草稿",
    "drive.status.draft_created": "已生成草稿",
    "drive.status.proposal_created": "已生成提议",
    "drive.status.dismissed": "已忽略",
    "meeting.kicker": "会议洞察",
    "meeting.transcript": "转写",
    "meeting.minutes": "纪要",
    "meeting.insights": "洞察",
    "meeting.evidence": "会议证据",
    "meeting.createDraft": "生成草稿",
    "meeting.dismiss": "忽略",
    "meeting.openDraft": "打开草稿",
    "meeting.openProposal": "打开提议",
    "meeting.reason": "AI 推荐理由",
    "meeting.approvalSafe": "审批安全：确认前不会修改正式资料。",
    "meeting.empty": "这个项目还没有会议洞察。",
    "meeting.status.ready": "已生成",
    "meeting.status.processing": "处理中",
    "meeting.status.failed": "处理失败",
    "meeting.status.pending": "待确认",
    "meeting.status.confirmed": "已确认",
    "meeting.status.dismissed": "已忽略",
    "notifications.kicker": "通知中心",
    "notifications.needsDecision": "需要你决定",
    "notifications.fyi": "仅供了解",
    "notifications.done": "已处理",
    "notifications.markAllRead": "全部已读",
    "notifications.empty": "通知箱是空的。",
    "notifications.muteTitle": "通知静音偏好",
    "notifications.muteHelp": "勾选的类型将不再给你发通知（默认全部接收）。",
    "notifications.open": "打开",
    "notifications.unread": "未读",
    "notifications.read": "已读",
    "notifications.completed": "已处理",
    "notifications.source": "来源",
    "notifications.groundingWhy": "为什么提醒我",
    "knowledge.fromNotice": "来自通知的相关资料",
    "health.kicker": "项目健康",
    "health.summary": "项目",
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
    "cost.trend": "趋势",
    "cost.remaining": "剩余",
    "cost.laborSplit": "干活 vs 自进化",
    "cost.laborProduction": "干活花费",
    "cost.laborSelfImprovement": "自进化花费",
    "cost.laborSelfImprovementRatio": "自进化占比",
    "skills.kicker": "团队技能库",
    "skills.title": "团队技能",
    "skills.summary": "AI 沉淀并持续打磨的可复用技能",
    "skills.empty": "还没有沉淀出团队技能。AI 会在夜间从真实工作里蒸馏。",
    "projects.kicker": "项目即产品",
    "projects.title": "项目",
    "projects.summary": "把每个项目当成一个产品来管理：进行中工作项、负责人和最近更新一目了然。",
    "projects.empty": "还没有项目。新建一个项目就能开始派活。",
    "projects.new": "新建项目",
    "projects.namePlaceholder": "新项目名称",
    "projects.create": "创建",
    "projects.open": "打开项目",
    "projects.archived": "已归档",
    "projects.openItems": "进行中",
    "projects.updated": "更新于",
    "skills.active": "在用",
    "skills.aiAuthored": "AI 蒸馏",
    "skills.refined": "已精修",
    "skills.version": "版本",
    "skills.confidence": "置信",
    "skills.refinedFrom": "精修自 v",
    "skills.authoredBy": "来源",
    "settings.runtime": "运行时",
    "settings.llm": "AI 运行配置",
    "settings.language": "语言",
    "settings.device": "桌面与本地能力",
    "settings.configured": "已配置",
    "settings.notConfigured": "未配置",
    "settings.ready": "就绪",
    "settings.needsAttention": "需要处理",
    "settings.synced": "已同步",
    "settings.needsSync": "待同步",
    "settings.worker": "工作进程数",
    "settings.broker": "消息服务",
    "settings.database": "数据库",
    "settings.runtimeStatus": "运行状态",
    "settings.lease": "执行租约",
    "settings.recovery": "恢复间隔",
    "settings.provider": "提供方",
    "settings.model": "模型",
    "settings.apiKey": "密钥状态",
    "settings.baseUrl": "服务地址状态",
    "settings.secretSafe": "密钥安全",
    "settings.activeLocale": "当前语言",
    "settings.preferenceLocale": "服务端偏好",
    "settings.preferenceSource": "偏好来源",
    "settings.preferenceSync": "同步状态",
    "settings.updateEndpoint": "保存地址",
    "settings.supported": "支持语言",
    "settings.storage": "本地键",
    "settings.localExecution": "本地执行边界",
    "settings.independentPet": "独立桌宠窗口",
    "settings.petBoundary": "桌宠形象在独立窗口里设置",
    "settings.desktopGate": "桌面功能开关",
    "settings.webLocalActions": "网页端本地操作",
    "settings.restore": "恢复入口"
  },
  "en-US": {
    "workitem.context": "Task context",
    "workitem.trace": "AI execution trace",
    "workitem.deliverables": "Deliverable entry",
    "workitem.driveSource": "Drive comment source",
    "workitem.meetingSource": "Meeting insight source",
    "workitem.openProposal": "Open change request",
    "workitem.openReplay": "Open replay",
    "workitem.startRun": "Start AI run",
    "intake.summary": "Intake summary",
    "intake.progress": "Clarification progress",
    "intake.freeText": "Typing stays a collapsed fallback",
    "intake.createWorkItem": "Create work item",
    "intake.continue": "Continue intake",
    "intake.startKicker": "Pilot work entry",
    "intake.startTitle": "Start from a real project",
    "intake.startBody": "WorkHub prepares the pilot project context first, then opens option-first intake. It will not use old smoke seed ids or modify accepted deliverables directly.",
    "intake.startProject": "Pilot project context",
    "intake.startAction": "Start work intake",
    "intake.startNext": "Next: pick a work type, then let AI do the work.",
    "intake.startEvidence": "Evidence and cost will appear in Replay and Cost.",
    "intake.startIntent": "Real task",
    "intake.startIntentPlaceholder": "Example: turn today's pilot feedback into blocker issues, adoption notes, and next owners.",
    "knowledge.kicker": "Knowledge fallback",
    "knowledge.sources": "Evidence sources",
    "knowledge.missing": "No reliable evidence found. WorkHub will not invent sources.",
    "knowledge.open": "Open evidence",
    "knowledge.searchPlaceholder": "Search evidence, docs, meeting notes…",
    "knowledge.searchLabel": "Search knowledge evidence",
    "knowledge.searchSubmit": "Search",
    "proposal.summary": "AI summary",
    "proposal.review": "Review actions",
    "proposal.rollback": "Rollback path",
    "proposal.files": "Files and object changes",
    "drive.kicker": "Project drive",
    "drive.allProjects": "All projects",
    "drive.switchProject": "Switch project",
    "drive.files": "File tree",
    "drive.versions": "Version history",
    "drive.accepted": "Accepted deliverables",
    "drive.comments": "Comment drafts",
    "drive.recycle": "Recycle",
    "drive.operations": "Operation log",
    "drive.empty": "This project does not have accepted deliverables yet.",
    "drive.upload": "Upload sample",
    "drive.delete": "Move to recycle",
    "drive.preview": "Preview",
    "drive.download": "Download",
    "drive.restore": "Restore",
    "drive.current": "Current",
    "drive.pendingDrafts": "Pending drafts",
    "drive.createDraft": "Create draft",
    "drive.openDraft": "Open draft",
    "drive.openProposal": "Open proposal",
    "drive.status.pending_llm": "Pending draft",
    "drive.status.draft_created": "Draft created",
    "drive.status.proposal_created": "Proposal created",
    "drive.status.dismissed": "Dismissed",
    "meeting.kicker": "Meeting insights",
    "meeting.transcript": "Transcript",
    "meeting.minutes": "Minutes",
    "meeting.insights": "Insights",
    "meeting.evidence": "Meeting evidence",
    "meeting.createDraft": "Create draft",
    "meeting.dismiss": "Dismiss",
    "meeting.openDraft": "Open draft",
    "meeting.openProposal": "Open proposal",
    "meeting.reason": "AI rationale",
    "meeting.approvalSafe": "Approval-safe: official project state will not change until you confirm.",
    "meeting.empty": "This project does not have meeting insights yet.",
    "meeting.status.ready": "Ready",
    "meeting.status.processing": "Processing",
    "meeting.status.failed": "Failed",
    "meeting.status.pending": "Pending",
    "meeting.status.confirmed": "Confirmed",
    "meeting.status.dismissed": "Dismissed",
    "notifications.kicker": "Notifications",
    "notifications.needsDecision": "Needs your decision",
    "notifications.fyi": "FYI",
    "notifications.done": "Done",
    "notifications.markAllRead": "Mark all as read",
    "notifications.empty": "Your inbox is empty.",
    "notifications.muteTitle": "Notification mute preferences",
    "notifications.muteHelp": "Checked types stop notifying you (everything is on by default).",
    "notifications.open": "Open",
    "notifications.unread": "Unread",
    "notifications.read": "Read",
    "notifications.completed": "Done",
    "notifications.source": "Source",
    "notifications.groundingWhy": "Why am I seeing this",
    "knowledge.fromNotice": "Search context from a notification",
    "health.kicker": "Project health",
    "health.summary": "Projects",
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
    "cost.trend": "Trend",
    "cost.remaining": "Remaining",
    "cost.laborSplit": "Work vs self-improvement",
    "cost.laborProduction": "Production spend",
    "cost.laborSelfImprovement": "Self-improvement spend",
    "cost.laborSelfImprovementRatio": "Self-improvement share",
    "skills.kicker": "Team skill library",
    "skills.title": "Team skills",
    "skills.summary": "Reusable skills the AI distills and keeps refining",
    "skills.empty": "No team skills yet. The AI distills them nightly from real work.",
    "projects.kicker": "Projects as products",
    "projects.title": "Projects",
    "projects.summary": "Treat every project like a product: open work, owner, and latest activity at a glance.",
    "projects.empty": "No projects yet. Create one to start assigning work.",
    "projects.new": "New project",
    "projects.namePlaceholder": "New project name",
    "projects.create": "Create",
    "projects.open": "Open project",
    "projects.archived": "Archived",
    "projects.openItems": "Open",
    "projects.updated": "Updated",
    "skills.active": "Active",
    "skills.aiAuthored": "AI-distilled",
    "skills.refined": "Refined",
    "skills.version": "Version",
    "skills.confidence": "Confidence",
    "skills.refinedFrom": "refined from v",
    "skills.authoredBy": "Source",
    "settings.runtime": "Runtime",
    "settings.llm": "AI runtime config",
    "settings.language": "Language",
    "settings.device": "Desktop and local capability",
    "settings.configured": "Configured",
    "settings.notConfigured": "Not configured",
    "settings.ready": "Ready",
    "settings.needsAttention": "Needs attention",
    "settings.synced": "Synced",
    "settings.needsSync": "Needs sync",
    "settings.worker": "Worker",
    "settings.broker": "Event broker",
    "settings.database": "Database",
    "settings.runtimeStatus": "Runtime status",
    "settings.lease": "Run lease",
    "settings.recovery": "Recovery interval",
    "settings.provider": "Provider",
    "settings.model": "Model",
    "settings.apiKey": "Key status",
    "settings.baseUrl": "Service URL status",
    "settings.secretSafe": "Secret safety",
    "settings.activeLocale": "Active locale",
    "settings.preferenceLocale": "Server preference",
    "settings.preferenceSource": "Preference source",
    "settings.preferenceSync": "Sync state",
    "settings.updateEndpoint": "Save endpoint",
    "settings.supported": "Supported locales",
    "settings.storage": "Storage key",
    "settings.localExecution": "Local execution boundary",
    "settings.independentPet": "Independent pet window",
    "settings.petBoundary": "Pet look is not configured in the Web main window",
    "settings.desktopGate": "Desktop capability gate",
    "settings.webLocalActions": "Web local actions",
    "settings.restore": "Recovery entry"
  }
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

// 契约/外部来源的 href（evidence.href、preview_ref.href）可能带 javascript:/data: → XSS。
// 只放行相对路径与 http/https/mailto，其余拦成 "#"。仍需再过 escapeHtml。
function safeHref(value: unknown): string {
  const v = String(value ?? "").trim();
  if ((v.startsWith("/") && !v.startsWith("//")) || /^(?:https?:|mailto:)/iu.test(v)) {
    return v;
  }
  return "#";
}

function dataAttrs(attrs: Record<string, string>) {
  return Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
    .join("");
}

function createWebRouteComponent(input: CreateWebRouteComponentInput): WebRouteComponent {
  const hydration: WebRouteHydrationBoundary = {
    rootId: `wh-r4-hydration-${input.key}`,
    routeKey: input.key,
    mode: "html-fallback",
    source: input.source,
    locale: input.locale,
    pageVm: input.pageVm,
    actionHrefCount: input.primaryHrefs.length,
    adapter: "route-component-v1"
  };
  const reactBoundary = input.reactComponent
    ? dataAttrs({
      "data-r4-hydration-react-component": input.reactComponent.componentName,
      "data-r4-hydration-react-component-route": input.reactComponent.routeKey,
      "data-r4-hydration-react-component-mode": input.reactComponent.mode,
      "data-r4-hydration-react-component-props-source": input.reactComponent.propsSource,
      "data-r4-hydration-react-component-fallback": String(input.reactComponent.htmlFallback),
      "data-r4-hydration-react-component-adapter": input.reactComponent.adapter,
      "data-r4-hydration-react-component-fingerprint": input.reactComponent.propsFingerprint
    })
    : "";
  const html = `<div class="wh-r4-hydration-root" id="${escapeHtml(hydration.rootId)}" data-r4-hydration-boundary="true" data-r4-hydration-route="${escapeHtml(hydration.routeKey)}" data-r4-hydration-mode="${escapeHtml(hydration.mode)}" data-r4-hydration-source="${escapeHtml(hydration.source)}" data-r4-hydration-locale="${escapeHtml(hydration.locale)}" data-r4-hydration-page-vm="${escapeHtml(hydration.pageVm)}" data-r4-hydration-action-count="${escapeHtml(String(hydration.actionHrefCount))}" data-r4-hydration-adapter="${escapeHtml(hydration.adapter)}"${reactBoundary}>${input.html}</div>`;
  return {
    key: input.key,
    css: input.css,
    primaryHrefs: input.primaryHrefs,
    hydration,
    ...(input.reactComponent ? { reactComponent: input.reactComponent } : {}),
    html
  };
}

function routeT(locale: WorkHubLocale, key: RouteCopyKey) {
  return routeCopy[locale][key];
}

// findings[#low]：动态拼出的 copy-key（如 meeting.status.${status}）此前用 `as RouteCopyKey`
// 硬转，契约枚举新增值时会查不到、渲染空 label。改走守卫查找：未命中就 humanize 回退
// （如 "pending_llm" → "Pending Llm"），而不是吐空串。
function routeTOrHumanize(locale: WorkHubLocale, key: string, fallbackToken: string): string {
  const map = routeCopy[locale] as Record<string, string>;
  return map[key] ?? humanizeToken(fallbackToken);
}

function stripMarkdown(value: string | undefined) {
  return (value ?? "").replace(/[#*_`>-]/gu, " ").replace(/\s+/gu, " ").trim();
}

function boolLabel(value: boolean, locale: WorkHubLocale) {
  return routeT(locale, value ? "settings.configured" : "settings.notConfigured");
}

function runtimeStatusLabel(value: SettingsPageVM["runtime"]["runtime_status"], locale: WorkHubLocale) {
  return routeT(locale, value === "ready" ? "settings.ready" : "settings.needsAttention");
}

function syncLabel(value: boolean, locale: WorkHubLocale) {
  return routeT(locale, value ? "settings.synced" : "settings.needsSync");
}

function actionClass(action: AttentionAction | ActionSpec, index: number) {
  if (("style" in action && action.style === "danger") || action.id === "request_changes") {
    return "wh-btn wh-btn-danger";
  }
  return index === 0 ? "wh-btn wh-btn-primary" : "wh-btn";
}

function renderActions(actions: (AttentionAction | ActionSpec)[]) {
  if (actions.length === 0) {
    return "";
  }
  return `<div class="wh-r4-route-actions">${actions
    .map((action, index) => {
      const reason = action.requires_reason ? " data-requires-reason=\"true\"" : "";
      const method = "method" in action ? ` data-method="${escapeHtml(action.method)}"` : "";
      const desktop = action.requires_desktop ? " data-requires-desktop=\"true\"" : "";
      const postRunNext = action.id === "open_proposal"
        ? " data-s1-day2-post-run-next-action=\"proposal\""
        : action.id === "open_replay"
          ? " data-s1-day2-post-run-next-action=\"replay\""
          : "";
      return `<a class="${actionClass(action, index)}" href="${escapeHtml(safeHref(action.href))}" data-action-id="${escapeHtml(action.id)}"${reason}${method}${desktop}${postRunNext}>${escapeHtml(action.label)}</a>`;
    })
    .join("")}</div>`;
}

function jsonAttr(value: unknown) {
  return escapeHtml(JSON.stringify(value));
}

function renderAttentionRows(items: AttentionItem[], emptyCopy: string, zh: boolean) {
  if (items.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(emptyCopy)}</p>`;
  }
  return items
    .slice(0, 4)
    .map((item) => `<div class="wh-r4-route-row" data-r4-route-attention-item="${escapeHtml(item.id)}">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.summary_text)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(attentionPriorityLabel(item.priority, zh))}</span>
    </div>`)
    .join("");
}

function approvalRouteLabel(routedToUserId: string | undefined, locale: WorkHubLocale) {
  if (!routedToUserId) {
    return goldPathT(locale, "approvals.unrouted");
  }
  return locale === "zh-CN" ? "已路由" : "Routed";
}

function homePriorityPill(priority: string, zh: boolean): string {
  const map: Record<string, [string, string]> = zh
    ? { urgent: ["紧急", "danger"], high: ["较高", "warn"], normal: ["常规", "muted"], low: ["低", "muted"] }
    : { urgent: ["Urgent", "danger"], high: ["High", "warn"], normal: ["Normal", "muted"], low: ["Low", "muted"] };
  const [label, tone] = map[priority] ?? [priority, "muted"];
  return `<span class="wh-pill wh-r4-prio wh-r4-prio--${tone}">${escapeHtml(label)}</span>`;
}

// M23：把机器枚举值翻成给人看的本地化标签（可见 pill 用；data-* 标记仍保留原值供 smoke/脚本断言）。
// 未知值回退为去下划线、首字母大写的形式，至少比 "proposal_review" 友好。
function humanizeToken(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/gu, (char) => char.toUpperCase());
}

function localizedEnumLabel(value: string, zh: boolean, zhMap: Record<string, string>, enMap: Record<string, string>): string {
  if (zh) {
    return zhMap[value] ?? enMap[value] ?? humanizeToken(value);
  }
  return enMap[value] ?? humanizeToken(value);
}

function attentionPriorityLabel(priority: string, zh: boolean): string {
  return localizedEnumLabel(
    priority,
    zh,
    { urgent: "紧急", high: "较高", normal: "常规", low: "低" },
    { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" }
  );
}

function attentionKindLabel(kind: string, zh: boolean): string {
  return localizedEnumLabel(
    kind,
    zh,
    {
      clarification: "待澄清",
      approval: "待审批",
      proposal_review: "待审查",
      escalation: "已升级",
      sync_conflict: "撞车冲突",
      knowledge_result: "知识结果",
      budget: "预算",
      delivery_ready: "可交付",
      system_health: "系统状态"
    },
    {
      clarification: "Clarification",
      approval: "Approval",
      proposal_review: "Review",
      escalation: "Escalated",
      sync_conflict: "Conflict",
      knowledge_result: "Knowledge",
      budget: "Budget",
      delivery_ready: "Ready",
      system_health: "System"
    }
  );
}

function notificationSeverityLabel(severity: string, zh: boolean): string {
  return localizedEnumLabel(
    severity,
    zh,
    { urgent: "紧急", high: "重要", normal: "常规" },
    { urgent: "Urgent", high: "High", normal: "Normal" }
  );
}

function notificationTypeLabel(type: string, zh: boolean): string {
  return localizedEnumLabel(
    type,
    zh,
    {
      proposal_review: "待审查",
      escalation: "已升级",
      sync_conflict: "撞车冲突",
      delivery_ready: "可交付",
      budget_warning: "预算预警",
      knowledge_result: "知识结果",
      milestone: "里程碑"
    },
    {}
  );
}

function driveItemKindLabel(kind: string, zh: boolean): string {
  return localizedEnumLabel(kind, zh, { file: "文件", folder: "文件夹" }, { file: "File", folder: "Folder" });
}

function driveOpTypeLabel(op: string, zh: boolean): string {
  return localizedEnumLabel(
    op,
    zh,
    {
      upload_file: "上传文件",
      delete_item: "删除",
      restore_item: "恢复",
      restore_version: "恢复版本",
      rename_item: "重命名",
      comment_to_draft: "评论转草稿",
      draft_to_proposal: "草稿转申请"
    },
    {
      upload_file: "Upload",
      delete_item: "Delete",
      restore_item: "Restore",
      restore_version: "Restore version",
      rename_item: "Rename",
      comment_to_draft: "Comment → draft",
      draft_to_proposal: "Draft → proposal"
    }
  );
}

function driveVersionSourceLabel(source: string, zh: boolean): string {
  return localizedEnumLabel(
    source,
    zh,
    { accepted_deliverable: "已采纳交付", manual_upload: "手动上传", comment_draft: "评论草稿" },
    { accepted_deliverable: "Accepted", manual_upload: "Upload", comment_draft: "Comment draft" }
  );
}

function meetingInsightKindLabel(kind: string, zh: boolean): string {
  return localizedEnumLabel(
    kind,
    zh,
    { new_requirement: "新需求", requirement_change: "需求变更", normal_note: "普通记录" },
    { new_requirement: "New requirement", requirement_change: "Requirement change", normal_note: "Note" }
  );
}

function homeRunStateLabel(state: string, zh: boolean): string {
  const map: Record<string, string> = zh
    ? { queued: "排队中", running: "进行中", waiting_for_user: "等你拍板", failed: "出错了" }
    : { queued: "Queued", running: "Running", waiting_for_user: "Needs you", failed: "Failed" };
  return map[state] ?? state;
}

function homeRunStateTone(state: string): string {
  return state === "failed" ? "danger" : state === "waiting_for_user" ? "warn" : "accent";
}

function renderHomeRouteComponent(vm: AttentionHomeVM, locale: WorkHubLocale): WebRouteComponent {
  const reactComponent = createHomeReactRouteComponent(vm, locale);
  const reactAttrs = dataAttrs(reactRouteComponentMarkerAttrs(reactComponent));
  const primary = vm.primary;
  const primaryActions = primary?.actions ?? [];
  const zh = locale === "zh-CN";
  // 契约去歧义：fixture 里 primary 与 queue 不相交，但 live /api/pages/attention 把 primary=queue[0] 留在 queue 里。
  // 按 id 去重得到「除首决策外的剩余队列」，避免首决策被重复计数 + 重复渲染（对两种来源都正确）。
  const queueWithoutPrimary = primary ? vm.queue.filter((item) => item.id !== primary.id) : vm.queue;
  const decideCount = queueWithoutPrimary.length + (primary ? 1 : 0);
  const workingCount = vm.background_runs.length;
  const evidenceCount = primary?.evidence_refs?.length ?? 0;
  const worklog = vm.worklog;

  // R8：今日「自进化」——只在确有新增/精修时显示，避免零活动时刷存在感。
  const selfEvolved = (worklog?.skills_promoted_today ?? 0) + (worklog?.skills_refined_today ?? 0);
  const selfEvolveLine = worklog && selfEvolved > 0
    ? `<span class="wh-r4-home-banner-evolve" data-r4-home-self-evolve="true" data-r4-home-skills-promoted="${escapeHtml(String(worklog.skills_promoted_today))}" data-r4-home-skills-refined="${escapeHtml(String(worklog.skills_refined_today))}">${escapeHtml(zh ? "还顺手自我精进：技能 +" : "Also leveled up: skills +")}${escapeHtml(String(worklog.skills_promoted_today))}${escapeHtml(zh ? " · 精修 " : " · refined ")}${escapeHtml(String(worklog.skills_refined_today))}</span>`
    : "";
  const worklogBanner = worklog
    ? `<div class="wh-r4-home-banner" data-r4-home-worklog="true">
        <span class="wh-r4-home-banner-cat" aria-hidden="true"></span>
        <span>${escapeHtml(zh ? "今天我替你扛了" : "AI handled today:")} <b>${escapeHtml(String(worklog.accepted_today))}</b> ${escapeHtml(zh ? "件 · 自主率" : "done · autonomy")} <b>${escapeHtml(String(worklog.autonomy_rate))}%</b> · ${escapeHtml(zh ? "约省" : "saved ≈")} <b>${escapeHtml(String(worklog.saved_hours_estimate))}</b> ${escapeHtml(zh ? "小时" : "h")} <span class="wh-r4-home-kao">٩(◜◡◝)۶</span></span>
        ${selfEvolveLine}
      </div>`
    : "";

  // 真实风险计数：升级/同步冲突/预算类事项，或任何紧急项（替代之前硬编码的 0）。
  const riskKinds = new Set(["escalation", "sync_conflict", "budget"]);
  const isRisk = (item: AttentionItem) => item.priority === "urgent" || riskKinds.has(item.kind);
  const riskCount = [...(primary ? [primary] : []), ...queueWithoutPrimary].filter(isRisk).length;
  const chips = `<div class="wh-r4-home-chips">
      <span class="wh-r4-home-chip wh-r4-home-chip--accent"><b>${escapeHtml(String(decideCount))}</b>${escapeHtml(goldPathT(locale, "home.decisionTitle"))}</span>
      <span class="wh-r4-home-chip"><b>${escapeHtml(String(workingCount))}</b>${escapeHtml(goldPathT(locale, "home.aiWorkingTitle"))}</span>
      <span class="wh-r4-home-chip ${riskCount === 0 ? "wh-r4-home-chip--ok" : "wh-r4-prio--danger"}"><b>${escapeHtml(String(riskCount))}</b>${escapeHtml(riskCount === 0 ? (zh ? "风险 ✓ 安心" : "Risk ✓") : (zh ? "风险待看" : "Risk"))}</span>
    </div>`;

  const decisionCard = primary
    ? `<section class="wh-card wh-r4-route-card wh-r4-decision" data-r4-home-decision="true">
        <div class="wh-r4-decision-top"></div>
        <div class="wh-r4-route-meta">${homePriorityPill(primary.priority, zh)}<span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "home.decisionTitle"))}</span></div>
        <h3>${escapeHtml(primary.title)}</h3>
        <p>${escapeHtml(primary.reason_text ?? primary.summary_text)}</p>
        ${evidenceCount > 0 ? `<div class="wh-r4-status"><span>${escapeHtml(zh ? `用到证据 ${evidenceCount} 条` : `${evidenceCount} evidence`)}</span></div>` : ""}
        ${renderActions(primaryActions)}
      </section>`
    : `<section class="wh-card wh-r4-route-card wh-r4-decision" data-r4-home-decision="true">
        <div class="wh-r4-decision-top"></div>
        <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "home.decisionTitle"))}</span>
        <h3>${escapeHtml(goldPathT(locale, "home.emptyTitle"))}</h3>
        <p>${escapeHtml(goldPathT(locale, "home.emptySummary"))}</p>
        <div class="wh-r4-route-actions">
          <a class="wh-btn wh-btn-primary" href="/intake" data-wh-route="/intake" data-r4-home-intake-cta="true">${escapeHtml(goldPathT(locale, "home.emptyCta"))}</a>
        </div>
      </section>`;

  const runRows = vm.background_runs.length
    ? vm.background_runs.slice(0, 4).map((run) => `<div class="wh-r4-run" data-r4-home-background-run="${escapeHtml(run.run_id)}">
        <div class="wh-r4-run-main"><strong>${escapeHtml(run.title)}</strong><p>${escapeHtml(run.preview_text)}</p></div>
        <span class="wh-pill wh-r4-runstate wh-r4-runstate--${homeRunStateTone(run.state)}">${escapeHtml(homeRunStateLabel(run.state, zh))}</span>
      </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "home.aiWorkingEmpty"))}</p>`;

  const evidenceRows = primary?.evidence_refs?.length
    ? primary.evidence_refs.slice(0, 3).map((ref) => `<div class="wh-r4-route-row" data-r4-home-evidence="${escapeHtml(ref.id)}">
        <div>
          <strong>${escapeHtml(ref.title)}</strong>
          <p>${escapeHtml(ref.excerpt ?? ref.source_id)}</p>
        </div>
        <span class="wh-pill">${escapeHtml(ref.source_type)}</span>
      </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "empty.evidence"))}</p>`;

  return createWebRouteComponent({
    key: "home",
    css: webRouteComponentCss,
    primaryHrefs: reactComponent.primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "attention",
    reactComponent,
    html: `<section class="wh-r4-route" data-r4-route-component="home" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}"${reactAttrs} data-r4-home-primary="${escapeHtml(String(Boolean(primary)))}">
      ${worklogBanner}
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "home.kicker"))}</span>
          <h2>${escapeHtml(goldPathT(locale, "home.inboxTitle"))}</h2>
          <p>${escapeHtml(goldPathT(locale, "home.inboxSummary"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(decideCount))}</span>
      </header>
      ${chips}
      <div class="wh-r4-route-grid">
        ${decisionCard}
        <section class="wh-card wh-r4-route-card" data-r4-home-ai-working="true">
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "home.aiWorkingTitle"))}</span>
          <div class="wh-r4-route-timeline">${runRows}</div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r4-home-queue="true">
          <h3>${escapeHtml(goldPathT(locale, "home.entryTitle"))}</h3>
          ${renderAttentionRows(queueWithoutPrimary, goldPathT(locale, "home.entryText"), locale === "zh-CN")}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-home-evidence-list="true">
          <h3>${escapeHtml(goldPathT(locale, "empty.evidence"))}</h3>
          ${evidenceRows}
        </section>
      </div>
    </section>`
  });
}

function intakeProgressRows(vm: SessionVM) {
  return vm.question.progress
    .map((step) => `<div class="wh-r4-route-row" data-r4-intake-progress-step="${escapeHtml(step.key)}" data-r4-intake-progress-state="${escapeHtml(step.state)}">
      <strong>${escapeHtml(step.label)}</strong>
      <span class="wh-pill">${escapeHtml(step.state)}</span>
    </div>`)
    .join("");
}

function renderIntakeStartRouteComponent(locale: WorkHubLocale): WebRouteComponent {
  const bootstrapPayload = {
    name: "Pilot Project",
    slug: "pilot-project",
    description: "Pilot project context created from the WorkHub intake entry."
  };
  return createWebRouteComponent({
    key: "intake",
    css: webRouteComponentCss,
    primaryHrefs: ["/api/projects/bootstrap"],
    source: "project-bootstrap",
    locale,
    pageVm: "project_bootstrap",
    html: `<section class="wh-r4-route" data-r4-route-component="intake" data-r4-route-component-source="project-bootstrap" data-r4-route-component-locale="${escapeHtml(locale)}" data-s1-day0-intake-start="true">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "intake.startKicker"))}</span>
          <h2>${escapeHtml(routeT(locale, "intake.startTitle"))}</h2>
          <p>${escapeHtml(routeT(locale, "intake.startBody"))}</p>
        </div>
        <span class="wh-r4-route-count">D0</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-s1-day0-project-context-card="true">
          <h3>${escapeHtml(routeT(locale, "intake.startProject"))}</h3>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(locale === "zh-CN" ? "试点项目" : "Pilot project")}</span>
            <span class="wh-pill">${escapeHtml(locale === "zh-CN" ? "实时数据" : "Live data")}</span>
          </div>
          <p>${escapeHtml(routeT(locale, "intake.startNext"))}</p>
          <label class="wh-r4-route-stack">
            <strong>${escapeHtml(routeT(locale, "intake.startIntent"))}</strong>
            <textarea class="wh-r4-intake-free-text" data-s1-day1-intent-input="true" maxlength="280" aria-label="${escapeHtml(routeT(locale, "intake.startIntent"))}" placeholder="${escapeHtml(routeT(locale, "intake.startIntentPlaceholder"))}"></textarea>
          </label>
        </section>
        <aside class="wh-r4-route-stack">
          <section class="wh-card wh-r4-route-card" data-s1-day0-intake-evidence="true">
            <h3>${escapeHtml(routeT(locale, "intake.progress"))}</h3>
            <div class="wh-r4-route-timeline">
              <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "intake.startProject"))}</strong><span class="wh-pill">${escapeHtml(locale === "zh-CN" ? "已就绪" : "Ready")}</span></div>
              <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "intake.summary"))}</strong><span class="wh-pill">${escapeHtml(locale === "zh-CN" ? "待进行" : "Next")}</span></div>
            </div>
            <p>${escapeHtml(routeT(locale, "intake.startEvidence"))}</p>
          </section>
        </aside>
      </div>
      <div class="wh-r4-route-actions">
        <a class="wh-btn wh-btn-primary" href="/api/projects/bootstrap" data-action-id="start_intake" data-method="POST" data-s1-day0-start-intake="true" data-request-json="${jsonAttr(bootstrapPayload)}">${escapeHtml(routeT(locale, "intake.startAction"))}</a>
      </div>
    </section>`
  });
}

function renderIntakeRouteComponent(vm: SessionVM, locale: WorkHubLocale): WebRouteComponent {
  const question = {
    ...vm.question,
    session_id: vm.question.session_id ?? vm.session_id,
    work_item_id: vm.question.work_item_id ?? vm.work_item_id
  };
  const recommended = new Set(question.recommended_option_ids ?? []);
  const allowMulti = question.input_mode === "multi_choice" || question.input_mode === "rank";
  const optionCards = question.options
    .map((option) => {
      const description = option.description ?? option.impact ?? "";
      return `<button class="wh-card wh-r4-route-card" type="button" data-option-id="${escapeHtml(option.id)}" data-intake-option-id="${escapeHtml(option.id)}" data-intake-option-selected="false" data-intake-option-mode="${escapeHtml(question.input_mode)}" data-intake-option-multi="${escapeHtml(String(allowMulti))}" data-recommended="${escapeHtml(String(recommended.has(option.id)))}">
        <div class="wh-r4-route-meta"><span class="wh-pill">${escapeHtml(recommended.has(option.id) ? goldPathT(locale, "intake.recommended") : option.risk_hint ?? question.input_mode)}</span></div>
        <h3>${escapeHtml(option.label)}</h3>
        <p>${escapeHtml(description)}</p>
      </button>`;
    })
    .join("");
  const freeText = question.free_text.enabled
    ? `<details class="wh-card wh-r4-route-card" data-r4-intake-free-text="true" ${question.free_text.collapsed_by_default ? "" : "open"}>
      <summary>${escapeHtml(routeT(locale, "intake.freeText"))}</summary>
      <p>${escapeHtml(question.free_text.placeholder ?? goldPathT(locale, "intake.freeTextFallback"))}</p>
      <textarea class="wh-r4-intake-free-text" data-intake-free-text-input="true" ${question.free_text.max_length ? `maxlength="${escapeHtml(String(question.free_text.max_length))}"` : ""} placeholder="${escapeHtml(question.free_text.placeholder ?? goldPathT(locale, "intake.freeTextFallback"))}"></textarea>
    </details>`
    : "";
  const continuePayload = { selected_option_ids: [] as string[] };
  const createPayload = { session_id: vm.session_id, selected_option_ids: [] as string[] };
  const createAction = question.input_mode === "confirm"
    ? `<a class="wh-btn wh-btn-primary" href="/api/workitems" data-action-id="create_workitem" data-method="POST" data-intake-create-workitem="true" data-session-id="${escapeHtml(vm.session_id)}" data-request-json="${jsonAttr(createPayload)}">${escapeHtml(routeT(locale, "intake.createWorkItem"))}</a>`
    : "";

  return createWebRouteComponent({
    key: "intake",
    css: webRouteComponentCss,
    primaryHrefs: [question.submit.href, ...(question.input_mode === "confirm" ? ["/api/workitems"] : [])],
    source: "session-vm",
    locale,
    pageVm: "session",
    html: `<section class="wh-r4-route" data-r4-route-component="intake" data-r4-route-component-source="session-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r4-intake-session-id="${escapeHtml(vm.session_id)}" data-r4-intake-workitem-id="${escapeHtml(vm.work_item_id ?? "")}" data-r4-intake-option-count="${escapeHtml(String(question.options.length))}" data-r4-intake-progress-count="${escapeHtml(String(question.progress.length))}" data-r4-intake-free-text-collapsed="${escapeHtml(String(question.free_text.collapsed_by_default))}" data-r4-intake-input-mode="${escapeHtml(question.input_mode)}" data-r4-intake-option-first="true">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "intake.kicker"))}</span>
          <h2>${escapeHtml(question.title)}</h2>
          <p>${escapeHtml(question.body ?? goldPathT(locale, "intake.bodyFallback"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(question.options.length))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-r4-route-stack" data-r4-intake-options="true" data-r4-intake-allow-multi="${escapeHtml(String(allowMulti))}">
          ${optionCards}
        </section>
        <aside class="wh-r4-route-stack">
          <section class="wh-card wh-r4-route-card" data-r4-intake-summary="true">
            <h3>${escapeHtml(routeT(locale, "intake.summary"))}</h3>
            <div class="wh-r4-route-meta">
              <span class="wh-pill">${escapeHtml(vm.topic)}</span>
              <span class="wh-pill">${escapeHtml(vm.stream_href)}</span>
            </div>
            <p>${escapeHtml(routeT(locale, "intake.freeText"))}</p>
          </section>
          <section class="wh-card wh-r4-route-card" data-r4-intake-progress="true">
            <h3>${escapeHtml(routeT(locale, "intake.progress"))}</h3>
            <div class="wh-r4-route-timeline">${intakeProgressRows(vm)}</div>
          </section>
        </aside>
      </div>
      ${freeText}
      <div class="wh-r4-route-actions">
        <a class="wh-btn" href="${escapeHtml(safeHref(question.submit.href))}" data-action-id="intake_continue" data-method="${escapeHtml(question.submit.method)}" data-intake-submit="next-question" data-session-id="${escapeHtml(vm.session_id)}" data-request-json="${jsonAttr(continuePayload)}">${escapeHtml(routeT(locale, "intake.continue"))}</a>
        ${createAction}
      </div>
    </section>`
  });
}

function approvalEvidenceConfidenceLabel(hint: string, zh: boolean): string {
  return localizedEnumLabel(
    hint,
    zh,
    { found: "证据充分", weak: "证据较弱", missing: "缺证据" },
    { found: "Found", weak: "Weak", missing: "Missing" }
  );
}

// 2026-06-14T10:24:00.000Z → 2026-06-14 10:24（确定性、不解析 Date、不卷时区，smoke 安全；比裸 ISO 友好）。
function formatApprovalTimestamp(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u.exec(iso);
  return match ? `${match[1]} ${match[2]}` : iso;
}

function approvalStepStatusLabel(status: string, zh: boolean): string {
  return localizedEnumLabel(
    status,
    zh,
    { done: "已完成", current: "进行中", pending: "待处理" },
    { done: "Done", current: "Current", pending: "Pending" }
  );
}

// W2 中栏：单个事项的「变更详情」面板。deliverable 渲染 diff 表+合规检查+AI 解释+冲突；
// permission/tool 渲染影响目标。再叠加证据、审批流程时间线、相关讨论。非选中项 hidden（不计入溢出测量）。
function renderApprovalDetailPanel(
  item: AttentionItem,
  detail: ApprovalDetailVM | undefined,
  locale: WorkHubLocale,
  selected: boolean
): string {
  const zh = locale === "zh-CN";
  const evidence = item.evidence_refs?.length
    ? `<ul class="wh-r4-approval-evidence" data-r4-approval-evidence-list="true">${item.evidence_refs
        .slice(0, 4)
        .map((ev) => `<li>${ev.href ? `<a href="${escapeHtml(safeHref(ev.href))}">${escapeHtml(ev.title)}</a>` : escapeHtml(ev.title)}${ev.excerpt ? `<span class="wh-subtle">${escapeHtml(ev.excerpt)}</span>` : ""}${ev.confidence_hint ? `<span class="wh-pill" data-r4-approval-evidence-confidence="${escapeHtml(ev.confidence_hint)}">${escapeHtml(approvalEvidenceConfidenceLabel(ev.confidence_hint, zh))}</span>` : ""}</li>`)
        .join("")}</ul>`
    : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "approvals.evidenceEmpty"))}</p>`;

  const isDeliverable = detail?.kind === "deliverable" && detail.manifest_changes.length > 0;
  const diffSection = isDeliverable
    ? `<section data-r4-approval-diff="true"><h4>${escapeHtml(goldPathT(locale, "approvals.diffTitle"))}</h4><div class="wh-r4-route-timeline">${detail.manifest_changes.map((change) => renderChange(change, locale)).join("")}</div></section>`
    : (detail?.affected_targets.length
        ? `<section data-r4-approval-affected="true"><h4>${escapeHtml(goldPathT(locale, "approvals.affectedTitle"))}</h4><div class="wh-r4-route-meta">${detail.affected_targets.map((target) => `<span class="wh-pill">${escapeHtml(target)}</span>`).join("")}</div></section>`
        : "");
  const checksSection = detail?.checks.length
    ? `<section data-r4-approval-checks="true"><h4>${escapeHtml(goldPathT(locale, "approvals.checksTitle"))}</h4><div class="wh-r4-route-timeline">${detail.checks.map((check) => renderCheck(check, locale)).join("")}</div></section>`
    : "";
  const aiSection = (detail?.ai_reason || detail?.expected_benefit || detail?.risk_label)
    ? `<section data-r4-approval-ai="true"><h4>${escapeHtml(goldPathT(locale, "approvals.aiTitle"))}</h4>${detail?.ai_reason ? `<p>${escapeHtml(detail.ai_reason)}</p>` : ""}${detail?.expected_benefit ? `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "approvals.benefitTitle"))}: ${escapeHtml(detail.expected_benefit)}</p>` : ""}${detail?.risk_label ? `<span class="wh-pill wh-r4-prio wh-r4-prio--warn">${escapeHtml(detail.risk_label)}</span>` : ""}</section>`
    : "";
  const conflictsSection = detail?.conflicts.length
    ? `<section data-r4-approval-conflicts="true"><h4>${escapeHtml(goldPathT(locale, "approvals.conflictsTitle"))}</h4>${detail.conflicts.map((conflict) => `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r4-approval-conflict="true"><strong>${escapeHtml(conflict.description)}</strong>${conflict.impact ? `<p class="wh-subtle">${escapeHtml(conflict.impact)}</p>` : ""}${conflict.suggestion ? `<p>${escapeHtml(conflict.suggestion)}</p>` : ""}</div>`).join("")}</section>`
    : "";
  const timelineSection = detail?.timeline.length
    ? `<section data-r4-approval-timeline="true"><h4>${escapeHtml(goldPathT(locale, "approvals.timelineTitle"))}</h4><div class="wh-r4-route-timeline">${detail.timeline.map((step) => {
        // L#W2-18：把合成的时间戳/每步 SLA 真正显示出来（之前只算不渲染）。
        const sub = [step.actor_label, formatApprovalTimestamp(step.at)].filter(Boolean).join(" · ");
        return `<div class="wh-r4-route-row" data-r4-approval-timeline-step="${escapeHtml(step.kind)}" data-status="${escapeHtml(step.status)}"><div><strong>${escapeHtml(step.label)}</strong>${sub ? `<p class="wh-subtle">${escapeHtml(sub)}</p>` : ""}</div><div class="wh-r4-route-meta">${step.sla_due_at ? `<span class="wh-pill" data-r4-approval-step-sla="true">SLA ${escapeHtml(formatApprovalTimestamp(step.sla_due_at))}</span>` : ""}<span class="wh-pill">${escapeHtml(approvalStepStatusLabel(step.status, zh))}</span></div></div>`;
      }).join("")}</div></section>`
    : "";
  const comments = detail?.comments ?? [];
  const commentsSection = `<section data-r4-approval-discussion="true"><h4>${escapeHtml(goldPathT(locale, "approvals.discussionTitle"))}</h4>${comments.length
    ? comments.map((comment) => `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r4-approval-comment="${escapeHtml(comment.id)}"><strong>${escapeHtml(comment.author_label)}</strong><p>${escapeHtml(comment.body)}</p></div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "approvals.commentsEmpty"))}</p>`}<form class="wh-r4-approval-comment-form" data-r4-approval-comment-form="${escapeHtml(item.id)}"><textarea class="wh-r4-approval-comment-input" data-r4-approval-comment-input rows="2" placeholder="${escapeHtml(goldPathT(locale, "approvals.commentPlaceholder"))}"></textarea><button type="submit" class="wh-btn" data-r4-approval-comment-submit="${escapeHtml(item.id)}">${escapeHtml(goldPathT(locale, "approvals.commentSubmit"))}</button></form></section>`;

  return `<article class="wh-card wh-r4-route-card wh-r4-route-card--accent wh-r4-approval-detail-panel" data-r4-approval-detail-for="${escapeHtml(item.id)}" data-r4-approval-detail-kind="${escapeHtml(detail?.kind ?? "permission")}"${selected ? "" : " hidden"}>
      <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "approvals.detailTitle"))}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.summary_text)}</p>
      ${item.reason_text ? `<p class="wh-subtle">${escapeHtml(item.reason_text)}</p>` : ""}
      ${diffSection}
      ${checksSection}
      ${aiSection}
      ${conflictsSection}
      <h4>${escapeHtml(goldPathT(locale, "approvals.evidenceTitle"))}</h4>
      ${evidence}
      ${timelineSection}
      ${commentsSection}
      ${item.work_item_id ? `<a class="wh-btn" href="/workitems/${escapeHtml(item.work_item_id)}" data-r4-approval-workitem-link="${escapeHtml(item.work_item_id)}">${escapeHtml(zh ? "查看任务" : "View task")}</a>` : ""}
    </article>`;
}

function renderApprovalsRouteComponent(vm: ApprovalCenterVM, locale: WorkHubLocale): WebRouteComponent {
  const zh = locale === "zh-CN";
  const primary = vm.items[0];
  const pendingCount = vm.counts["pending"] ?? vm.items.length;
  const selectedRequest = primary ? vm.requests.find((req) => req.id === primary.id) : undefined;
  // 左栏：待审批列表（紧凑可点选行 + 每行 SLA，primary 默认高亮）。操作按钮统一放右栏，避免重复 data-action-id。
  const queueRows = vm.items
    .map((item) => {
      const itemRequest = vm.requests.find((req) => req.id === item.id);
      // 嵌入该事项的 respond href，供左栏选择时把右栏决策按钮重绑到选中项（避免误批 items[0]）。
      const respondHref = item.actions.find((action) => action.href.includes("/respond"))?.href;
      return `<article class="wh-card wh-r4-route-card wh-r4-approval-list-item" data-r4-approval-item="${escapeHtml(item.id)}" data-r4-approval-selected="${escapeHtml(String(item.id === primary?.id))}"${respondHref ? ` data-r4-approval-respond-href="${escapeHtml(safeHref(respondHref))}"` : ""}>
      <div class="wh-r4-route-meta"><span class="wh-pill" data-tone="${escapeHtml(item.priority)}">${escapeHtml(attentionPriorityLabel(item.priority, zh))}</span><span class="wh-pill">${escapeHtml(attentionKindLabel(item.kind, zh))}</span></div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.summary_text)}</p>
      ${itemRequest?.sla_due_at ? `<span class="wh-pill" data-r4-approval-sla="${escapeHtml(item.id)}">SLA ${escapeHtml(formatApprovalTimestamp(itemRequest.sla_due_at))}</span>` : ""}
      ${item.work_item_id ? `<a class="wh-btn" href="/workitems/${escapeHtml(item.work_item_id)}" data-r4-approval-item-link="${escapeHtml(item.id)}">${escapeHtml(zh ? "去处理" : "Open")}</a>` : ""}
    </article>`;
    })
    .join("");
  // 中栏：每个事项一张详情面板，仅选中项可见（其余 hidden）。
  const detailPanels = vm.items.length
    ? vm.items.map((item) => renderApprovalDetailPanel(item, vm.items_detail[item.id], locale, item.id === primary?.id)).join("")
    : `<article class="wh-card wh-r4-route-card"><p class="wh-subtle">${escapeHtml(goldPathT(locale, "approvals.noSelection"))}</p></article>`;
  // 右栏事实区：审批请求路由状态（保留 data-r4-approval-routed / Routed 标记）。
  const requestRows = vm.requests
    .map((item) => `<div class="wh-r4-route-row" data-r4-approval-request="${escapeHtml(item.id)}">
      <div>
        <strong>${escapeHtml(item.action_pattern)}</strong>
        <p>${escapeHtml(item.status)}${item.sla_due_at ? ` SLA ${escapeHtml(item.sla_due_at)}` : ""}</p>
      </div>
      <span class="wh-pill" data-r4-approval-routed="${escapeHtml(String(Boolean(item.routed_to_user_id)))}">${escapeHtml(approvalRouteLabel(item.routed_to_user_id, locale))}</span>
    </div>`)
    .join("");

  return createWebRouteComponent({
    key: "approvals",
    css: webRouteComponentCss,
    primaryHrefs: primary?.actions.map((action) => action.href) ?? [],
    source: "page-vm",
    locale,
    pageVm: "approvals",
    html: `<section class="wh-r4-route" data-r4-route-component="approvals" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r4-approval-pending="${escapeHtml(String(pendingCount))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "approvals.kicker"))}</span>
          <h2>${escapeHtml(primary?.title ?? goldPathT(locale, "approvals.emptyTitle"))}</h2>
          <p>${escapeHtml(primary?.reason_text ?? goldPathT(locale, "approvals.reasonFallback"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(pendingCount))}</span>
      </header>
      <div class="wh-r4-route-grid wh-r4-approvals-grid">
        <section class="wh-r4-route-stack wh-r4-approval-list" data-r4-approval-queue="true">
          ${queueRows || `<article class="wh-card wh-r4-route-card"><p>${escapeHtml(goldPathT(locale, "approvals.reasonFallback"))}</p></article>`}
        </section>
        <section class="wh-r4-route-stack wh-r4-approval-detail" data-r4-approval-detail="true">
          ${detailPanels}
        </section>
        <aside class="wh-r4-route-stack wh-r4-approval-actions" data-r4-approval-action-panel="true">
          <section class="wh-card wh-r4-route-card">
            <h3>${escapeHtml(goldPathT(locale, "approvals.myActions"))}</h3>
            ${primary ? renderActions(primary.actions) : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "approvals.noSelection"))}</p>`}
            ${primary ? `<label class="wh-r4-approval-field"><span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "approvals.reasonLabel"))}</span><textarea class="wh-r4-approval-reason" data-r4-approval-reason rows="2" placeholder="${escapeHtml(goldPathT(locale, "approvals.reasonPlaceholder"))}"></textarea></label>
            <label class="wh-r4-approval-remember"><input type="checkbox" data-r4-approval-remember /> <span>${escapeHtml(goldPathT(locale, "approvals.rememberLabel"))}</span></label>` : ""}
          </section>
          <section class="wh-card wh-r4-route-card">
            <h3>${escapeHtml(goldPathT(locale, "approvals.ruleTitle"))}</h3>
            <p>${escapeHtml(goldPathT(locale, "approvals.ruleText"))}</p>
          </section>
          <section class="wh-card wh-r4-route-card">
            <h3>${escapeHtml(goldPathT(locale, "approvals.slaTitle"))}</h3>
            <p>${escapeHtml(selectedRequest?.sla_due_at ?? goldPathT(locale, "approvals.slaEmpty"))}</p>
          </section>
          <section class="wh-card wh-r4-route-card">
            <h3>${escapeHtml(goldPathT(locale, "approvals.factsTitle"))}</h3>
            <div class="wh-r4-route-timeline">${requestRows || `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "approvals.unrouted"))}</p>`}</div>
          </section>
        </aside>
      </div>
    </section>`
  });
}

function acceptanceRows(items: WorkItemDetailVM["acceptance"], locale: WorkHubLocale) {
  if (items.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(uiT(locale, "workitem.emptyAcceptance"))}</p>`;
  }
  return items
    .map((item, index) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const title = String(record["title"] ?? `${uiT(locale, "workitem.acceptanceItem")} ${index + 1}`);
      const status = String(record["status"] ?? "open");
      return `<div class="wh-r4-route-row" data-r4-workitem-acceptance-item="${escapeHtml(String(record["id"] ?? index))}">
        <strong>${escapeHtml(title)}</strong>
        <span class="wh-pill">${escapeHtml(checkStatusLabel(locale, status))}</span>
      </div>`;
    })
    .join("");
}

function evidenceRows(refs: EvidenceRef[], locale: WorkHubLocale, marker: string) {
  if (refs.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(uiT(locale, "generic.noEvidence"))}</p>`;
  }
  return refs.slice(0, 5)
    .map((ref) => `<div class="wh-r4-route-row" data-${marker}="${escapeHtml(ref.id)}">
      <div>
        <strong>${escapeHtml(ref.title)}</strong>
        <p>${escapeHtml(ref.excerpt ?? ref.source_id)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(evidenceSourceLabel(locale, ref.source_type))}</span>
    </div>`)
    .join("");
}

function traceRows(vm: WorkItemDetailVM, locale: WorkHubLocale) {
  if (vm.agent_trace_preview.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(uiT(locale, "workitem.emptyTrace"))}</p>`;
  }
  return vm.agent_trace_preview.slice(0, 5)
    .map((step) => `<div class="wh-r4-route-row" data-r4-workitem-trace-step="${escapeHtml(step.id)}">
      <div>
        <strong>${escapeHtml(`${step.step_no}. ${step.phase}`)}</strong>
        <p>${escapeHtml(step.output_excerpt ?? step.tool_name ?? uiT(locale, "workitem.stepFallback"))}</p>
      </div>
      <span class="wh-pill">${escapeHtml(step.tool_name ?? step.created_at)}</span>
    </div>`)
    .join("");
}

function workItemActions(vm: WorkItemDetailVM, locale: WorkHubLocale): ActionSpec[] {
  const proposalId = vm.latest_proposal?.proposal_id;
  const runId = vm.agent_trace_preview[0]?.agent_run_id;
  const canStartRun = vm.workitem.status === "spec_ready" && !proposalId && vm.agent_trace_preview.length === 0;
  const actions: Array<ActionSpec | undefined> = [
    vm.actions.create_proposal_draft,
    proposalId
      ? {
        id: "open_proposal",
        label: routeT(locale, "workitem.openProposal"),
        method: "GET" as const,
        href: `/proposals/${proposalId}`
      }
      : undefined,
    runId
      ? {
        id: "open_replay",
        label: routeT(locale, "workitem.openReplay"),
        method: "GET" as const,
        href: `/agent-runs/${runId}/replay`
      }
      : undefined,
    canStartRun
      ? {
        id: "start_agent_run",
        label: routeT(locale, "workitem.startRun"),
        method: "POST" as const,
        href: `/api/workitems/${vm.workitem.id}/agent-runs`
      }
      : undefined
  ];
  return actions.filter((action): action is ActionSpec => Boolean(action));
}

function renderWorkItemSourceContext(vm: WorkItemDetailVM, locale: WorkHubLocale) {
  const source = vm.source_context;
  if (!source) {
    return "";
  }
  if (source.source_type === "drive_comment") {
    const folder = source.folder_path ? `<span class="wh-pill">${escapeHtml(source.folder_path)}</span>` : "";
    const proposal = source.proposal_href
      ? `<a class="wh-pill" href="${escapeHtml(safeHref(source.proposal_href))}" data-r5-workitem-source-proposal-link="true">${escapeHtml(routeT(locale, "workitem.openProposal"))}</a>`
      : "";
    return `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r5-workitem-source-context="${escapeHtml(source.source_type)}" data-r5-workitem-source-comment-id="${escapeHtml(source.comment_id)}" data-r5-workitem-source-proposal-id="${escapeHtml(source.proposal_id ?? "")}" data-r5-workitem-create-proposal-action="${escapeHtml(String(Boolean(vm.actions.create_proposal_draft)))}">
      <div>
        <strong>${escapeHtml(routeT(locale, "workitem.driveSource"))}</strong>
        <p>${escapeHtml(source.body)}</p>
      </div>
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(source.author_label)}</span>
        <span class="wh-pill">${escapeHtml(driveCommentStatusLabel(source.status, locale))}</span>
        ${folder}
        ${proposal}
      </div>
    </div>`;
  }
  const proposal = source.proposal_href
    ? `<a class="wh-pill" href="${escapeHtml(safeHref(source.proposal_href))}" data-r5-workitem-source-proposal-link="true" data-r5-workitem-source-proposal-id="${escapeHtml(source.proposal_id ?? "")}" data-r5-workitem-source-proposal-status="${escapeHtml(source.proposal_status ?? "")}">${escapeHtml(routeT(locale, "workitem.openProposal"))}</a>`
    : "";
  const evidence = source.evidence_refs.length
    ? source.evidence_refs.slice(0, 3).map((ref) => `<span class="wh-pill" data-r5-workitem-source-evidence="${escapeHtml(ref.id)}">${escapeHtml(ref.title)}</span>`).join("")
    : "";
  return `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r5-workitem-source-context="${escapeHtml(source.source_type)}" data-r5-workitem-source-meeting-id="${escapeHtml(source.meeting_id)}" data-r5-workitem-source-insight-id="${escapeHtml(source.insight_id)}" data-r5-workitem-source-proposal-id="${escapeHtml(source.proposal_id ?? "")}" data-r5-workitem-create-proposal-action="${escapeHtml(String(Boolean(vm.actions.create_proposal_draft)))}">
    <div>
      <strong>${escapeHtml(routeT(locale, "workitem.meetingSource"))}</strong>
      <p>${escapeHtml(`${source.meeting_title}: ${source.description}`)}</p>
      <p>${escapeHtml(routeT(locale, "meeting.reason"))}: ${escapeHtml(source.confidence_reason)}</p>
    </div>
    <div class="wh-r4-route-meta">
      <span class="wh-pill">${escapeHtml(meetingInsightStatusLabel(source.status, locale))}</span>
      <span class="wh-pill">${escapeHtml(source.insight_kind)}</span>
      ${evidence}
      ${proposal}
    </div>
  </div>`;
}

function renderWorkItemRouteComponent(vm: WorkItemDetailVM, locale: WorkHubLocale): WebRouteComponent {
  const title = vm.workitem.title ?? vm.workitem.code;
  const summary = stripMarkdown(vm.workitem.summary_md ?? vm.workitem.raw_description ?? uiT(locale, "workitem.defaultSummary"));
  const actions = workItemActions(vm, locale);
  const latestProposal = vm.latest_proposal;
  const deliverableRows = latestProposal?.changes.length
    ? latestProposal.changes.slice(0, 4).map((change) => `<div class="wh-r4-route-row" data-r4-workitem-deliverable-change="${escapeHtml(change.id)}">
      <div>
        <strong>${escapeHtml(change.human_summary)}</strong>
        <p>${escapeHtml(change.target_ref.path ?? change.target_ref.entity_id ?? change.target_ref.entity_type)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(deliverableTargetLabel(locale, change.target_kind))}</span>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(uiT(locale, "workitem.willReadEvidence"))}</p>`;

  return createWebRouteComponent({
    key: "workitem",
    css: webRouteComponentCss,
    primaryHrefs: actions.map((action) => action.href),
    source: "page-vm",
    locale,
    pageVm: "workitem",
    html: `<section class="wh-r4-route" data-r4-route-component="workitem" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r4-workitem-id="${escapeHtml(vm.workitem.id)}" data-r4-workitem-trace-count="${escapeHtml(String(vm.agent_trace_preview.length))}" data-r4-workitem-evidence-count="${escapeHtml(String(vm.evidence_refs.length))}" data-r4-workitem-acceptance-count="${escapeHtml(String(vm.acceptance.length))}" data-r4-workitem-deliverable-count="${escapeHtml(String(vm.accepted_deliverables.length + (latestProposal?.changes.length ?? 0)))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(uiT(locale, "workitem.kicker"))}</span>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(summary)}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(workItemStatusLabel(locale, vm.workitem.status))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-workitem-context="true">
          <h3>${escapeHtml(routeT(locale, "workitem.context"))}</h3>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(vm.workitem.code)}</span>
            <span class="wh-pill">${escapeHtml(vm.workitem.priority)}</span>
            <span class="wh-pill">${escapeHtml(vm.workitem.mode)}</span>
          </div>
          <p>${escapeHtml(vm.workitem.planning_note ?? vm.workitem.raw_description)}</p>
          ${renderWorkItemSourceContext(vm, locale)}
          ${renderActions(actions)}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-workitem-deliverables="true">
          <h3>${escapeHtml(routeT(locale, "workitem.deliverables"))}</h3>
          <div class="wh-r4-route-timeline">${deliverableRows}</div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r4-workitem-acceptance="true">
          <h3>${escapeHtml(uiT(locale, "workitem.acceptanceTitle"))}</h3>
          <div class="wh-r4-route-table">${acceptanceRows(vm.acceptance, locale)}</div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-workitem-trace="true">
          <h3>${escapeHtml(routeT(locale, "workitem.trace"))}</h3>
          <div class="wh-r4-route-timeline">${traceRows(vm, locale)}</div>
        </section>
      </div>
      <section class="wh-card wh-r4-route-card" data-r4-workitem-evidence="true">
        <h3>${escapeHtml(uiT(locale, "generic.evidence"))}</h3>
        <div class="wh-r4-route-timeline">${evidenceRows(vm.evidence_refs, locale, "r4-workitem-evidence-ref")}</div>
      </section>
    </section>`
  });
}

function renderChange(change: DeliverableChange, locale: WorkHubLocale) {
  const path = change.target_ref.path ?? change.target_ref.entity_id ?? change.target_ref.entity_type;
  const preview = change.preview_ref
    ? `<a class="wh-pill" href="${escapeHtml(safeHref(change.preview_ref.href))}">${escapeHtml(previewKindLabel(locale, change.preview_ref.kind))}</a>`
    : "";
  return `<div class="wh-r4-route-row" data-r4-proposal-change="${escapeHtml(change.id)}" data-r4-proposal-change-kind="${escapeHtml(change.target_kind)}" data-r4-proposal-change-type="${escapeHtml(change.change_type)}">
    <div>
      <strong>${escapeHtml(change.human_summary)}</strong>
      <p>${escapeHtml(path)}</p>
    </div>
    <div class="wh-r4-route-meta">
      <span class="wh-pill">${escapeHtml(deliverableTargetLabel(locale, change.target_kind))}</span>
      <span class="wh-pill">${escapeHtml(changeTypeLabel(locale, change.change_type))}</span>
      ${preview}
    </div>
  </div>`;
}

function renderCheck(check: DeliverableCheck, locale: WorkHubLocale) {
  return `<div class="wh-r4-route-row" data-r4-proposal-check="${escapeHtml(check.id)}" data-r4-proposal-check-status="${escapeHtml(check.status)}">
    <div>
      <strong>${escapeHtml(check.label)}</strong>
      <p>${escapeHtml(check.detail ?? checkStatusLabel(locale, check.status))}</p>
    </div>
    <span class="wh-pill">${escapeHtml(checkStatusLabel(locale, check.status))}</span>
  </div>`;
}

function proposalActions(vm: ProposalDetailVM) {
  // A merged proposal is read-only: hide all write actions. Otherwise surface the
  // full review set (approve / request changes / merge) so reviewers can act in one place.
  if (vm.status === "merged") {
    return [];
  }
  return [
    vm.review_actions.approve,
    vm.review_actions.request_changes,
    ...(vm.review_actions.merge ? [vm.review_actions.merge] : [])
  ];
}

function renderProposalRouteComponent(
  vm: ProposalDetailVM,
  locale: WorkHubLocale,
  conflicts: ProposalConflict[] = []
): WebRouteComponent {
  const actions = proposalActions(vm);
  const conflictCards = renderProposalConflictCards(conflicts, { locale });
  // findings[28]：探测真实编辑器标记时带上开引号（真实标记总写成 data-...="true"），否则冲突文本
  // （headline/summary_text/target_path 等，仅经 escapeHtml）里若出现裸 `data-route-line-editor=` 字样会
  // 误判挂载空编辑器宿主。escapeHtml 把 " 转成 &quot;，故带引号的探针无法被冲突文本伪造。
  const hasLineEditor = conflictCards.html.includes("data-route-line-editor=\"");
  const hasFieldEditor = conflictCards.html.includes("data-proposal-structured-field-editor=\"");
  const hasSubrecordEditor = conflictCards.html.includes("data-proposal-subrecord-item-diff=\"");
  const reactComponent = createProposalReactRouteComponent(vm, conflicts, locale, {
    actionHrefs: conflictCards.actionHrefs,
    lineEditor: hasLineEditor,
    fieldEditor: hasFieldEditor,
    subrecordEditor: hasSubrecordEditor
  });
  const reactAttrs = dataAttrs(reactRouteComponentMarkerAttrs(reactComponent));
  const props = reactComponent.props;
  const summary = stripMarkdown(vm.manifest.summary_md).slice(0, 320);
  const rollbackClass = vm.manifest.rollback.available ? "wh-pill" : "wh-pill wh-pill-danger";
  const comments = vm.comments.length
    ? vm.comments.map((comment) => `<div class="wh-r4-route-row" data-r4-proposal-comment="${escapeHtml(comment.id)}">
      <div>
        <strong>${escapeHtml(comment.author_label)}</strong>
        <p>${escapeHtml(comment.body)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(comment.created_at)}</span>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(uiT(locale, "proposal.comments"))}</p>`;
  const reactMutationEditorHost = hasFieldEditor
    ? `<div class="wh-field-editor wh-field-editor--react" data-r4-proposal-react-mutation-editor-host="structured-field-scalar" data-r4-proposal-react-mutation-editor-mounted="false" data-r4-proposal-react-mutation-editor-fallback-hidden="false"></div>`
    : "";
  const reactLineEditorHost = hasLineEditor
    ? `<div class="wh-line-editor wh-line-editor--react" data-r4-proposal-react-line-editor-host="text-hunk" data-r4-proposal-react-line-editor-mounted="false" data-r4-proposal-react-line-editor-fallback-hidden="false"></div>`
    : "";
  const advancedConflictReview = conflictCards.html
    ? `<section class="wh-r4-route-card" data-r4-proposal-advanced-review="true" data-r4-proposal-advanced-source="workitem-conflicts" data-r4-proposal-advanced-fallback="true" data-r4-proposal-advanced-fallback-source="${escapeHtml(props.advancedFallbackSource)}" data-r4-proposal-advanced-fallback-action-count="${escapeHtml(String(props.advancedFallbackActionCount))}" data-r4-proposal-conflicts="${escapeHtml(String(conflictCards.conflictCount))}" data-r4-proposal-line-editor="${escapeHtml(String(hasLineEditor))}" data-r4-proposal-field-editor="${escapeHtml(String(hasFieldEditor))}" data-r4-proposal-subrecord-editor="${escapeHtml(String(hasSubrecordEditor))}">${reactMutationEditorHost}${reactLineEditorHost}${conflictCards.html}</section>`
    : "";

  return createWebRouteComponent({
    key: "proposal",
    css: `${webRouteComponentCss}${proposalCss}`,
    primaryHrefs: reactComponent.primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "proposal",
    reactComponent,
    html: `<section class="wh-r4-route" data-r4-route-component="proposal" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}"${reactAttrs} data-r4-proposal-id="${escapeHtml(props.proposalId)}" data-r4-proposal-workitem-id="${escapeHtml(props.workItemId)}" data-r4-proposal-change-count="${escapeHtml(String(props.changeCount))}" data-r4-proposal-check-count="${escapeHtml(String(props.checkCount))}" data-r4-proposal-evidence-count="${escapeHtml(String(props.evidenceRefCount))}" data-r4-proposal-action-count="${escapeHtml(String(actions.length))}" data-r4-proposal-comment-count="${escapeHtml(String(props.commentCount))}" data-r4-proposal-conflict-count="${escapeHtml(String(props.conflictCount))}" data-r4-proposal-split-adapter="true" data-r4-proposal-readonly-review-action-count="${escapeHtml(String(props.reviewActionCount))}" data-r4-proposal-advanced-fallback-preserved="${escapeHtml(String(props.advancedFallbackPreserved))}" data-r4-proposal-advanced-fallback-action-count="${escapeHtml(String(props.advancedFallbackActionCount))}" data-r4-proposal-line-editor-fallback="${escapeHtml(String(props.lineEditorFallback))}" data-r4-proposal-field-editor-fallback="${escapeHtml(String(props.fieldEditorFallback))}" data-r4-proposal-subrecord-editor-fallback="${escapeHtml(String(props.subrecordEditorFallback))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(uiT(locale, "proposal.kicker"))}</span>
          <h2>${escapeHtml(vm.title)}</h2>
          <p>${escapeHtml(summary)}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(vm.status)}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-proposal-summary="true">
          <h3>${escapeHtml(routeT(locale, "proposal.summary"))}</h3>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(uiT(locale, "generic.risk"))}: ${escapeHtml(vm.manifest.risk.human_label)}</span>
            <span class="${rollbackClass}" data-r4-proposal-rollback-available="${escapeHtml(String(vm.manifest.rollback.available))}">${escapeHtml(vm.manifest.rollback.available ? uiT(locale, "proposal.rollbackAvailable") : uiT(locale, "proposal.rollbackUnavailable"))}</span>
          </div>
          <p>${escapeHtml(vm.manifest.rollback.description)}</p>
          ${renderActions(actions)}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-proposal-review="true">
          <h3>${escapeHtml(routeT(locale, "proposal.review"))}</h3>
          <div class="wh-r4-route-timeline">${vm.manifest.checks.slice(0, 3).map((check) => renderCheck(check, locale)).join("")}</div>
        </section>
      </div>
      <section class="wh-card wh-r4-route-card" data-r4-proposal-changes="true">
        <h3>${escapeHtml(routeT(locale, "proposal.files"))}</h3>
        <div class="wh-r4-route-table">${vm.manifest.changes.map((change) => renderChange(change, locale)).join("")}</div>
      </section>
      ${advancedConflictReview}
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r4-proposal-evidence="true">
          <h3>${escapeHtml(uiT(locale, "generic.evidence"))}</h3>
          <div class="wh-r4-route-timeline">${evidenceRows(vm.evidence_refs, locale, "r4-proposal-evidence-ref")}</div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-proposal-comments="true">
          <h3>${escapeHtml(uiT(locale, "proposal.comments"))}</h3>
          <div class="wh-r4-route-timeline">${comments}</div>
        </section>
      </div>
    </section>`
  });
}

function proposalConflictsFromSurface(vm: ProposalConflictSurface) {
  const conflicts = vm.proposal_conflicts ?? vm.conflicts ?? [];
  return conflicts.filter((conflict) => conflict.proposal_id === vm.page_vms.proposal.proposal_id);
}

function formatBytes(value: number, locale: WorkHubLocale) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(locale === "zh-CN" ? 0 : 1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function driveActionLinks(
  item: NonNullable<DrivePageVM["items"][number]["accepted_deliverable"]>,
  locale: WorkHubLocale
) {
  const links: string[] = [];
  if (item.preview_href) {
    links.push(`<a class="wh-btn" href="${escapeHtml(safeHref(item.preview_href))}" data-action-id="drive_preview">${escapeHtml(routeT(locale, "drive.preview"))}</a>`);
  }
  if (item.download_href) {
    links.push(`<a class="wh-btn" href="${escapeHtml(safeHref(item.download_href))}" data-action-id="drive_download">${escapeHtml(routeT(locale, "drive.download"))}</a>`);
  }
  if (item.restore_href) {
    links.push(`<a class="wh-btn" href="${escapeHtml(safeHref(item.restore_href))}" data-action-id="drive_restore" data-method="POST">${escapeHtml(routeT(locale, "drive.restore"))}</a>`);
  }
  return links.length ? `<div class="wh-r4-route-actions">${links.join("")}</div>` : "";
}

function driveItemMutationIdFromHref(href: string) {
  try {
    const path = new URL(href, "http://workhub.local").pathname;
    const match = /^\/api\/drive\/projects\/[^/]+\/items\/([^/]+)\/(?:delete|restore)$/u.exec(path);
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

function driveCommentStatusLabel(status: DrivePageVM["comments"][number]["status"], locale: WorkHubLocale) {
  if (status === "draft_created") {
    return routeT(locale, "drive.status.draft_created");
  }
  if (status === "proposal_created") {
    return routeT(locale, "drive.status.proposal_created");
  }
  if (status === "dismissed") {
    return routeT(locale, "drive.status.dismissed");
  }
  return routeT(locale, "drive.status.pending_llm");
}

function meetingRecordStatusLabel(status: MeetingPageVM["meetings"][number]["status"], locale: WorkHubLocale) {
  return routeTOrHumanize(locale, `meeting.status.${status}`, status);
}

function meetingInsightStatusLabel(status: MeetingPageVM["meetings"][number]["insights"][number]["status"], locale: WorkHubLocale) {
  return routeTOrHumanize(locale, `meeting.status.${status}`, status);
}

function renderDriveRouteComponent(
  vm: DrivePageVM,
  locale: WorkHubLocale,
  projects?: ProjectListVM | undefined
): WebRouteComponent {
  const projectTitle = vm.project?.name ?? (locale === "zh-CN" ? "项目网盘" : "Project drive");
  // 网盘是 GitHub 式核心:头部带「← 所有项目」回链 + 当前项目名 + 紧凑项目切换器。
  // 纯增量——既有 data-r4-*/data-r5-* 标记一律保留;无项目/≤1 项目时只渲当前项目名,不出切换器。
  const projectList = projects?.projects ?? [];
  const currentProjectId = vm.project?.id ?? "";
  // M3：当前项目不在清单里时(归档/跨工作区直链)，原生 <select> 会显示第一项名字，与下方标题不符。
  // 补一个 value 为空、选中的「当前项目」占位项，避免错配（选它不导航）。
  const currentInList = projectList.some((project) => project.id === currentProjectId);
  const switcherOptions = projectList.length > 1
    ? `${currentInList ? "" : `<option value="" selected>${escapeHtml(vm.project?.name ?? "")}</option>`}${projectList.map((project) => {
      const selected = project.id === currentProjectId ? " selected" : "";
      return `<option value="${escapeHtml(safeHref(`/drive?project_id=${encodeURIComponent(project.id)}`))}"${selected}>${escapeHtml(project.name)}</option>`;
    }).join("")}`
    : "";
  const driveProjectNav = `<nav class="wh-r4-route-meta" data-r8-drive-project-nav="true" data-r8-drive-current-project="${escapeHtml(currentProjectId)}" data-r8-drive-project-count="${escapeHtml(String(projectList.length))}">
        <a class="wh-pill" href="/projects" data-r8-drive-all-projects="true">&#8592; ${escapeHtml(routeT(locale, "drive.allProjects"))}</a>
        <strong data-r8-drive-current-project-name="true">${escapeHtml(vm.project?.name ?? routeT(locale, "drive.kicker"))}</strong>
        ${switcherOptions ? `<select class="wh-pill" data-r8-drive-project-switcher="true" aria-label="${escapeHtml(routeT(locale, "drive.switchProject"))}">${switcherOptions}</select>` : ""}
      </nav>`;
  const selectedItem = vm.items.find((item) => item.id === vm.selected_item_id) ?? vm.items.find((item) => item.kind === "file") ?? vm.items[0];
  const deleteTargetId = vm.actions.delete_item ? driveItemMutationIdFromHref(vm.actions.delete_item.href) : undefined;
  const deleteTarget = deleteTargetId ? vm.items.find((item) => item.id === deleteTargetId) : undefined;
  const deletePayload = {
    expected_current_version_id: deleteTarget?.current_version_id ?? null
  };
  const uploadPayload = {
    filename: locale === "zh-CN" ? "R5-上传样例.md" : "r5-upload-sample.md",
    mime: "text/markdown",
    parsed_text: locale === "zh-CN" ? "# R5 上传样例\n\n这是一份可审计的项目资料上传样例。" : "# R5 upload sample\n\nA small auditable project drive upload sample."
  };
  const driveManageActions = [
    vm.actions.upload_file ? `<a class="wh-btn wh-btn-primary" href="${escapeHtml(safeHref(vm.actions.upload_file.href))}" data-action-id="drive_upload_file" data-method="POST" data-request-json="${jsonAttr(uploadPayload)}">${escapeHtml(routeT(locale, "drive.upload"))}</a>` : "",
    vm.actions.delete_item ? `<a class="wh-btn" href="${escapeHtml(safeHref(vm.actions.delete_item.href))}" data-action-id="drive_delete_item" data-method="POST" data-r5-drive-delete-target="${escapeHtml(deleteTargetId ?? "")}" data-request-json="${jsonAttr(deletePayload)}">${escapeHtml(routeT(locale, "drive.delete"))}</a>` : "",
    vm.actions.restore_item ? `<a class="wh-btn" href="${escapeHtml(safeHref(vm.actions.restore_item.href))}" data-action-id="drive_restore_item" data-method="POST">${escapeHtml(routeT(locale, "drive.restore"))}</a>` : ""
  ].filter(Boolean).join("");
  const fileRows = vm.items.length
    ? vm.items.slice(0, 12).map((item) => {
      const current = item.current_version;
      const size = current ? formatBytes(current.size_bytes, locale) : "";
      return `<div class="wh-r4-route-row" data-r4-drive-item="${escapeHtml(item.id)}" data-r4-drive-item-kind="${escapeHtml(item.kind)}" data-r4-drive-item-depth="${escapeHtml(String(item.depth))}" data-r4-drive-item-selected="${escapeHtml(String(item.id === selectedItem?.id))}">
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <p>${escapeHtml(item.path)}</p>
        </div>
        <div class="wh-r4-route-meta">
          <span class="wh-pill">${escapeHtml(driveItemKindLabel(item.kind, locale === "zh-CN"))}</span>
          ${current ? `<span class="wh-pill">v${escapeHtml(String(current.version_no))}</span>` : ""}
          ${size ? `<span class="wh-pill">${escapeHtml(size)}</span>` : ""}
        </div>
      </div>`;
    }).join("")
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "drive.empty"))}</p>`;
  const versionRows = vm.versions.length
    ? vm.versions.slice(0, 8).map((version) => `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r4-drive-version="${escapeHtml(version.id)}" data-r4-drive-version-current="${escapeHtml(String(version.current))}">
      <div>
        <strong>${escapeHtml(`${version.filename} · v${version.version_no}`)}</strong>
        <p>${escapeHtml(`${formatBytes(version.size_bytes, locale)} · ${version.created_at}`)}</p>
      </div>
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(driveVersionSourceLabel(version.source, locale === "zh-CN"))}</span>
        ${version.current ? `<span class="wh-pill">${escapeHtml(routeT(locale, "drive.current"))}</span>` : ""}
      </div>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "drive.empty"))}</p>`;
  const acceptedRows = vm.accepted_deliverables.length
    ? vm.accepted_deliverables.slice(0, 6).map((accepted) => `<article class="wh-card wh-r4-route-card" data-r4-drive-accepted-deliverable="${escapeHtml(accepted.id)}">
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(accepted.target_kind)}</span>
        <span class="wh-pill">v${escapeHtml(String(accepted.accepted_version))}</span>
      </div>
      <h3>${escapeHtml(accepted.filename ?? accepted.target_path ?? accepted.target_key)}</h3>
      <p>${escapeHtml(accepted.target_path ?? accepted.target_key)}</p>
      ${driveActionLinks(accepted, locale)}
    </article>`).join("")
    : `<article class="wh-card wh-r4-route-card"><p>${escapeHtml(routeT(locale, "drive.empty"))}</p></article>`;
  const commentRows = vm.comments.length
    ? vm.comments.slice(0, 5).map((comment) => `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r4-drive-comment="${escapeHtml(comment.id)}" data-r4-drive-comment-status="${escapeHtml(comment.status)}">
      <div>
        <strong>${escapeHtml(comment.author_label)}</strong>
        <p>${escapeHtml(comment.body)}</p>
      </div>
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(driveCommentStatusLabel(comment.status, locale))}</span>
        ${comment.draft_action ? `<a class="wh-btn" href="${escapeHtml(safeHref(comment.draft_action.href))}" data-action-id="comment_to_draft" data-method="POST">${escapeHtml(routeT(locale, "drive.createDraft"))}</a>` : ""}
        ${comment.draft_href ? `<a class="wh-pill" href="${escapeHtml(safeHref(comment.draft_href))}">${escapeHtml(routeT(locale, "drive.openDraft"))}</a>` : ""}
        ${comment.proposal_href ? `<a class="wh-pill" href="${escapeHtml(safeHref(comment.proposal_href))}" data-r5-drive-proposal-link="true" data-r5-drive-proposal-id="${escapeHtml(comment.proposal_id ?? "")}" data-r5-drive-proposal-status="${escapeHtml(comment.proposal_status ?? "")}">${escapeHtml(routeT(locale, "drive.openProposal"))}</a>` : ""}
      </div>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "drive.pendingDrafts"))}: 0</p>`;
  const recycleRows = vm.deleted_items.length
    ? vm.deleted_items.slice(0, 5).map((item) => `<div class="wh-r4-route-row" data-r5-drive-recycle-item="${escapeHtml(item.id)}">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <p>${escapeHtml(item.path)}</p>
      </div>
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(driveItemKindLabel(item.kind, locale === "zh-CN"))}</span>
        ${item.deleted_at ? `<span class="wh-pill">${escapeHtml(item.deleted_at)}</span>` : ""}
      </div>
    </div>`).join("")
    : `<p class="wh-subtle">0</p>`;
  const operationRows = vm.operations.length
    ? vm.operations.slice(0, 6).map((operation) => `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r5-drive-operation="${escapeHtml(operation.id)}" data-r5-drive-operation-type="${escapeHtml(operation.op_type)}">
      <div>
        <strong>${escapeHtml(operation.summary_text)}</strong>
        <p>${escapeHtml(operation.created_at)}</p>
      </div>
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(driveOpTypeLabel(operation.op_type, locale === "zh-CN"))}</span>
        ${operation.target_path ? `<span class="wh-pill">${escapeHtml(operation.target_path)}</span>` : ""}
      </div>
    </div>`).join("")
    : `<p class="wh-subtle">0</p>`;
  const primaryHrefs = [
    vm.actions.upload_file?.href,
    vm.actions.delete_item?.href,
    vm.actions.restore_item?.href,
    ...vm.accepted_deliverables.flatMap((accepted) => [
      accepted.preview_href,
      accepted.download_href,
      accepted.restore_href
    ]),
    ...vm.comments.map((comment) => comment.draft_action?.href),
    ...vm.comments.map((comment) => comment.draft_href),
    ...vm.comments.map((comment) => comment.proposal_href)
  ].filter((value): value is string => Boolean(value));

  return createWebRouteComponent({
    key: "drive",
    css: webRouteComponentCss,
    primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "drive",
    html: `<section class="wh-r4-route" data-r4-route-component="drive" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r4-drive-project-id="${escapeHtml(vm.project?.id ?? "")}" data-r4-drive-item-count="${escapeHtml(String(vm.summary.item_count))}" data-r4-drive-version-count="${escapeHtml(String(vm.summary.version_count))}" data-r4-drive-accepted-count="${escapeHtml(String(vm.summary.accepted_deliverable_count))}" data-r4-drive-comment-count="${escapeHtml(String(vm.comments.length))}" data-r5-drive-deleted-count="${escapeHtml(String(vm.summary.deleted_item_count))}" data-r5-drive-operation-count="${escapeHtml(String(vm.summary.operation_count))}" data-r5-drive-can-manage="${escapeHtml(String(vm.can_manage))}">
      <header class="wh-r4-route-head">
        <div>
          ${driveProjectNav}
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "drive.kicker"))}</span>
          <h2>${escapeHtml(projectTitle)}</h2>
          <p>${escapeHtml(selectedItem?.path ?? routeT(locale, "drive.empty"))}</p>
          ${driveManageActions ? `<div class="wh-r4-route-actions" data-r5-drive-manage-actions="true">${driveManageActions}</div>` : ""}
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(vm.summary.file_count))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-drive-files="true">
          <h3>${escapeHtml(routeT(locale, "drive.files"))}</h3>
          <div class="wh-r4-route-timeline">${fileRows}</div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-drive-versions="true">
          <h3>${escapeHtml(routeT(locale, "drive.versions"))}</h3>
          <div class="wh-r4-route-timeline">${versionRows}</div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-r4-route-stack" data-r4-drive-accepted="true">
          ${acceptedRows}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-drive-comments="true">
          <h3>${escapeHtml(routeT(locale, "drive.comments"))}</h3>
          <div class="wh-r4-route-timeline">${commentRows}</div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r5-drive-recycle="true">
          <h3>${escapeHtml(routeT(locale, "drive.recycle"))}</h3>
          <div class="wh-r4-route-timeline">${recycleRows}</div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r5-drive-operations="true">
          <h3>${escapeHtml(routeT(locale, "drive.operations"))}</h3>
          <div class="wh-r4-route-timeline">${operationRows}</div>
        </section>
      </div>
    </section>`
  });
}

function renderMeetingRouteComponent(vm: MeetingPageVM, locale: WorkHubLocale): WebRouteComponent {
  const projectTitle = vm.project?.name ?? (locale === "zh-CN" ? "会议洞察" : "Meeting insights");
  const selectedMeeting = vm.meetings.find((meeting) => meeting.id === vm.selected_meeting_id) ?? vm.meetings[0];
  const meetingRows = vm.meetings.length
    ? vm.meetings.slice(0, 10).map((meeting) => `<a class="wh-r4-route-row" href="/meetings?project_id=${escapeHtml(meeting.project_id)}&m=${escapeHtml(meeting.id)}" data-r5-meeting-id="${escapeHtml(meeting.id)}" data-r5-meeting-status="${escapeHtml(meeting.status)}" data-r5-meeting-selected="${escapeHtml(String(meeting.id === selectedMeeting?.id))}">
      <div>
        <strong>${escapeHtml(meeting.title)}</strong>
        <p>${escapeHtml(`${meeting.created_at} · ${meeting.uploaded_by_label}`)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(meetingRecordStatusLabel(meeting.status, locale))}</span>
    </a>`).join("")
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "meeting.empty"))}</p>`;
  const transcript = selectedMeeting?.transcript_text?.trim() || routeT(locale, "meeting.empty");
  const minutes = selectedMeeting?.minutes_md?.trim() || routeT(locale, "meeting.empty");
  const insightRows = selectedMeeting?.insights.length
    ? selectedMeeting.insights.map((insight) => {
      const createDraftAction = insight.actions?.create_draft;
      const dismissInsightAction = insight.actions?.dismiss;
      const createAction = createDraftAction
        ? `<a class="wh-btn wh-btn-primary" href="${escapeHtml(safeHref(createDraftAction.href))}" data-action-id="${escapeHtml(createDraftAction.id)}" data-method="${escapeHtml(createDraftAction.method)}" data-r5-meeting-insight-create-draft="true">${escapeHtml(createDraftAction.label ?? routeT(locale, "meeting.createDraft"))}</a>`
        : "";
      const dismissAction = dismissInsightAction
        ? `<a class="wh-btn" href="${escapeHtml(safeHref(dismissInsightAction.href))}" data-action-id="${escapeHtml(dismissInsightAction.id)}" data-method="${escapeHtml(dismissInsightAction.method)}" data-r5-meeting-insight-dismiss="true">${escapeHtml(dismissInsightAction.label ?? routeT(locale, "meeting.dismiss"))}</a>`
        : "";
      const draftLink = insight.draft_href
        ? `<a class="wh-pill" href="${escapeHtml(safeHref(insight.draft_href))}" data-r5-meeting-draft-link="true">${escapeHtml(routeT(locale, "meeting.openDraft"))}</a>`
        : "";
      const proposalLink = insight.proposal_href
        ? `<a class="wh-pill" href="${escapeHtml(safeHref(insight.proposal_href))}" data-r5-meeting-proposal-link="true" data-r5-meeting-proposal-id="${escapeHtml(insight.proposal_id ?? "")}" data-r5-meeting-proposal-status="${escapeHtml(insight.proposal_status ?? "")}">${escapeHtml(routeT(locale, "meeting.openProposal"))}</a>`
        : "";
      const evidence = insight.evidence_refs.length
        ? insight.evidence_refs.slice(0, 3).map((ref) => `<span class="wh-pill" data-r5-meeting-evidence-ref="${escapeHtml(ref.id)}">${escapeHtml(ref.title)}</span>`).join("")
        : "";
      return `<article class="wh-card wh-r4-route-card" data-r5-meeting-insight="${escapeHtml(insight.id)}" data-r5-meeting-insight-status="${escapeHtml(insight.status)}" data-r5-meeting-insight-kind="${escapeHtml(insight.kind)}">
        <div class="wh-r4-route-meta">
          <span class="wh-pill">${escapeHtml(meetingInsightKindLabel(insight.kind, locale === "zh-CN"))}</span>
          <span class="wh-pill">${escapeHtml(meetingInsightStatusLabel(insight.status, locale))}</span>
          ${draftLink}
          ${proposalLink}
        </div>
        <h3>${escapeHtml(insight.title)}</h3>
        <p>${escapeHtml(insight.description)}</p>
        <p>${escapeHtml(routeT(locale, "meeting.reason"))}: ${escapeHtml(insight.confidence_reason)}</p>
        <div class="wh-r4-route-meta">${evidence}</div>
        <div class="wh-r4-route-actions">${createAction}${dismissAction}</div>
      </article>`;
    }).join("")
    : `<article class="wh-card wh-r4-route-card"><p>${escapeHtml(routeT(locale, "meeting.empty"))}</p></article>`;
  const primaryHrefs = [
    ...vm.meetings.flatMap((meeting) => meeting.insights.flatMap((insight) => [
      insight.actions?.create_draft?.href,
      insight.actions?.dismiss?.href,
      insight.draft_href,
      insight.proposal_href
    ]))
  ].filter((value): value is string => Boolean(value));

  return createWebRouteComponent({
    key: "meetings",
    css: webRouteComponentCss,
    primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "meetings",
    html: `<section class="wh-r4-route" data-r4-route-component="meetings" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r5-meetings-route="true" data-r5-meetings-project-id="${escapeHtml(vm.project?.id ?? "")}" data-r5-meeting-selected-id="${escapeHtml(selectedMeeting?.id ?? "")}" data-r5-meeting-count="${escapeHtml(String(vm.summary.meeting_count))}" data-r5-meeting-pending-insights="${escapeHtml(String(vm.summary.pending_insight_count))}" data-r5-meeting-confirmed-insights="${escapeHtml(String(vm.summary.confirmed_insight_count))}" data-r5-meeting-dismissed-insights="${escapeHtml(String(vm.summary.dismissed_insight_count))}" data-r5-meeting-can-manage="${escapeHtml(String(vm.can_manage))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "meeting.kicker"))}</span>
          <h2>${escapeHtml(projectTitle)}</h2>
          <p>${escapeHtml(selectedMeeting?.title ?? routeT(locale, "meeting.empty"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(vm.summary.pending_insight_count))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r5-meeting-list="true">
          <h3>${escapeHtml(routeT(locale, "meeting.kicker"))}</h3>
          <div class="wh-r4-route-timeline">${meetingRows}</div>
        </section>
        <aside class="wh-r4-route-stack" data-r5-meeting-insight-panel="true">
          <section class="wh-card wh-r4-route-card">
            <h3>${escapeHtml(routeT(locale, "meeting.insights"))}</h3>
            <div class="wh-r4-route-stack">${insightRows}</div>
            <p>${escapeHtml(routeT(locale, "meeting.approvalSafe"))}</p>
          </section>
        </aside>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r5-meeting-transcript="true">
          <h3>${escapeHtml(routeT(locale, "meeting.transcript"))}</h3>
          <pre class="wh-r5-meeting-text">${escapeHtml(transcript)}</pre>
        </section>
        <section class="wh-card wh-r4-route-card" data-r5-meeting-minutes="true">
          <h3>${escapeHtml(routeT(locale, "meeting.minutes"))}</h3>
          <pre class="wh-r5-meeting-text">${escapeHtml(minutes)}</pre>
        </section>
      </div>
    </section>`
  });
}

function notificationBucketTitle(bucket: NotificationPageVM["items"][number]["inbox_bucket"], locale: WorkHubLocale) {
  if (bucket === "needs_decision") {
    return routeT(locale, "notifications.needsDecision");
  }
  if (bucket === "done") {
    return routeT(locale, "notifications.done");
  }
  return routeT(locale, "notifications.fyi");
}

function notificationStatusLabel(status: NotificationPageVM["items"][number]["status"], locale: WorkHubLocale) {
  if (status === "unread") {
    return routeT(locale, "notifications.unread");
  }
  if (status === "done") {
    return routeT(locale, "notifications.completed");
  }
  return routeT(locale, "notifications.read");
}

function sourceContextLabel(source: NotificationPageVM["items"][number]["source_context"], locale: WorkHubLocale) {
  if (!source) {
    return routeT(locale, "notifications.source");
  }
  if (source.source_type === "work_item") {
    return `${source.code ?? ""} ${source.title}`.trim();
  }
  if (source.source_type === "meeting_insight") {
    return `${source.meeting_title} · ${source.title}`;
  }
  if (source.source_type === "schedule_event") {
    return `${routeT(locale, "calendar.scheduleEvent")} · ${source.title}`;
  }
  return source.label;
}

function notificationActionLinks(item: NotificationPageVM["items"][number], locale: WorkHubLocale) {
  const links = [
    item.actions.open ? `<a class="wh-btn wh-btn-primary" href="${escapeHtml(safeHref(item.actions.open.href))}" data-action-id="${escapeHtml(item.actions.open.id)}">${escapeHtml(item.actions.open.label || routeT(locale, "notifications.open"))}</a>` : "",
    item.actions.mark_read ? `<a class="wh-btn" href="${escapeHtml(safeHref(item.actions.mark_read.href))}" data-action-id="${escapeHtml(item.actions.mark_read.id)}" data-method="${escapeHtml(item.actions.mark_read.method)}" data-r5-notification-mark-read="true">${escapeHtml(item.actions.mark_read.label)}</a>` : "",
    item.actions.dismiss ? `<a class="wh-btn" href="${escapeHtml(safeHref(item.actions.dismiss.href))}" data-action-id="${escapeHtml(item.actions.dismiss.id)}" data-method="${escapeHtml(item.actions.dismiss.method)}" data-r5-notification-dismiss="true">${escapeHtml(item.actions.dismiss.label)}</a>` : "",
    item.actions.complete ? `<a class="wh-btn" href="${escapeHtml(safeHref(item.actions.complete.href))}" data-action-id="${escapeHtml(item.actions.complete.id)}" data-method="${escapeHtml(item.actions.complete.method)}" data-r5-notification-complete="true">${escapeHtml(item.actions.complete.label)}</a>` : ""
  ].filter(Boolean);
  return links.length ? `<div class="wh-r4-route-actions">${links.join("")}</div>` : "";
}

function renderNotificationGrounding(item: NotificationPageVM["items"][number], locale: WorkHubLocale) {
  const grounding = item.grounding;
  if (!grounding) {
    return "";
  }
  const refs = grounding.evidence_refs.map((ref) =>
    `<a class="wh-btn" href="${escapeHtml(safeHref(ref.href))}" data-action-id="notification_evidence_${escapeHtml(ref.kind)}" data-r5-7-notification-evidence-ref="${escapeHtml(ref.kind)}">${escapeHtml(ref.label)}</a>`
  ).join("");
  return `<div class="wh-r4-route-meta" data-r5-7-notification-grounding="true" data-r5-7-notification-evidence-count="${escapeHtml(String(grounding.evidence_refs.length))}">
    <span class="wh-pill">${escapeHtml(routeT(locale, "notifications.groundingWhy"))}: ${escapeHtml(grounding.reason_text)}</span>
    ${refs}
  </div>`;
}

function renderNotificationBucket(
  bucket: NotificationPageVM["items"][number]["inbox_bucket"],
  items: NotificationPageVM["items"],
  locale: WorkHubLocale
) {
  const rows = items.length
    ? items.map((item) => `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r5-notification-item="${escapeHtml(item.id)}" data-r5-notification-status="${escapeHtml(item.status)}" data-r5-notification-severity="${escapeHtml(item.severity)}" data-r5-notification-type="${escapeHtml(item.type)}" data-r5-notification-source-type="${escapeHtml(item.source_context?.source_type ?? "")}">
      <div>
        <div class="wh-r4-route-meta">
          <span class="wh-pill">${escapeHtml(notificationStatusLabel(item.status, locale))}</span>
          <span class="wh-pill">${escapeHtml(notificationSeverityLabel(item.severity, locale === "zh-CN"))}</span>
          <span class="wh-pill">${escapeHtml(notificationTypeLabel(item.type, locale === "zh-CN"))}</span>
        </div>
        <strong>${escapeHtml(item.title)}</strong>
        ${item.body ? `<p>${escapeHtml(item.body)}</p>` : ""}
        <p>${escapeHtml(routeT(locale, "notifications.source"))}: ${escapeHtml(sourceContextLabel(item.source_context, locale))}</p>
        ${renderNotificationGrounding(item, locale)}
        <p>${escapeHtml(item.created_at)}</p>
      </div>
      ${notificationActionLinks(item, locale)}
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "notifications.empty"))}</p>`;
  return `<section class="wh-card wh-r4-route-card" data-r5-notification-bucket="${escapeHtml(bucket)}" data-r5-notification-bucket-count="${escapeHtml(String(items.length))}">
    <h3>${escapeHtml(notificationBucketTitle(bucket, locale))}</h3>
    <div class="wh-r4-route-timeline">${rows}</div>
  </section>`;
}

// 团队就绪 must-have（缺口②）：可静音的通知类型清单。每一项的 `type` 必须与后端真正在
// `flushDraft` 里按 `draft.type` 做静音判定的字符串完全一致——否则勾选了却照发就是骗用户。
// 来源：packages/events/src/lifecycle.ts 的 6 个 workitem.* 里程碑 + notifications.ts 的 comment.mention
// + schedule-notify-pages.ts 的 meeting.insight.pending。新增可静音类型时同步这里。
const MUTABLE_NOTIFICATION_TYPES: ReadonlyArray<{ type: string; zh: string; en: string }> = [
  { type: "workitem.ai_working", zh: "AI 开始处理工作项", en: "AI started working on an item" },
  { type: "workitem.in_review", zh: "工作项待审查", en: "An item is ready for review" },
  { type: "workitem.escalated", zh: "工作项升级给人处理", en: "An item was escalated to a human" },
  { type: "workitem.pm_mode", zh: "工作项转 PM 协作模式", en: "An item switched to PM mode" },
  { type: "workitem.merged", zh: "工作项已合并交付", en: "An item was merged" },
  { type: "workitem.cancelled", zh: "工作项已取消", en: "An item was cancelled" },
  { type: "comment.mention", zh: "评论里 @ 了我", en: "Someone mentioned me in a comment" },
  { type: "meeting.insight.pending", zh: "会议洞察待确认", en: "A meeting insight needs confirmation" }
];

// 静音偏好面板：SSR 出一个折叠的 <details>（默认收起→不占版面、不触溢出门），开关默认全不勾（诚实
// default-off）。browser.ts 在通知路由 ready 后拉 GET /api/notifications/preferences 回填勾选态、change 调 PUT。
function renderNotificationMutePanel(locale: WorkHubLocale): string {
  const rows = MUTABLE_NOTIFICATION_TYPES.map(
    (entry) =>
      `<label class="wh-r5-notif-mute-row"><input type="checkbox" data-r5-notification-mute-type="${escapeHtml(entry.type)}" /><span>${escapeHtml(locale === "zh-CN" ? entry.zh : entry.en)}</span></label>`
  ).join("");
  return `<details class="wh-card wh-r4-route-card wh-r5-notif-mute" data-r5-notification-mute-panel="true">
        <summary>${escapeHtml(routeT(locale, "notifications.muteTitle"))}</summary>
        <p class="wh-subtle">${escapeHtml(routeT(locale, "notifications.muteHelp"))}</p>
        <div class="wh-r5-notif-mute-list">${rows}</div>
        <p class="wh-subtle wh-r5-notif-mute-status" data-r5-notification-mute-status="idle" hidden></p>
      </details>`;
}

function renderNotificationsRouteComponent(vm: NotificationPageVM, locale: WorkHubLocale): WebRouteComponent {
  const markAll = vm.actions.mark_all_read
    ? `<a class="wh-btn" href="${escapeHtml(safeHref(vm.actions.mark_all_read.href))}" data-action-id="${escapeHtml(vm.actions.mark_all_read.id)}" data-method="${escapeHtml(vm.actions.mark_all_read.method)}" data-r5-notification-mark-all-read="true">${escapeHtml(vm.actions.mark_all_read.label || routeT(locale, "notifications.markAllRead"))}</a>`
    : "";
  const primaryHrefs = [
    vm.actions.mark_all_read?.href,
    ...vm.items.flatMap((item) => [
      item.actions.open?.href,
      item.actions.mark_read?.href,
      item.actions.dismiss?.href,
      item.actions.complete?.href
    ])
  ].filter((value): value is string => Boolean(value));

  return createWebRouteComponent({
    key: "notifications",
    css: webRouteComponentCss,
    primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "notifications",
    html: `<section class="wh-r4-route" data-r4-route-component="notifications" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r5-notifications-route="true" data-r5-notification-total-count="${escapeHtml(String(vm.summary.total_count))}" data-r5-notification-unread-count="${escapeHtml(String(vm.summary.unread_count))}" data-r5-notification-needs-decision-count="${escapeHtml(String(vm.summary.needs_decision_count))}" data-r5-notification-fyi-count="${escapeHtml(String(vm.summary.fyi_count))}" data-r5-notification-done-count="${escapeHtml(String(vm.summary.done_count))}" data-r5-notification-urgent-count="${escapeHtml(String(vm.summary.urgent_count))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "notifications.kicker"))}</span>
          <h2>${escapeHtml(routeT(locale, "notifications.kicker"))}</h2>
          <p>${escapeHtml(`${notificationBucketTitle("needs_decision", locale)} ${vm.summary.needs_decision_count} · ${notificationBucketTitle("fyi", locale)} ${vm.summary.fyi_count} · ${notificationBucketTitle("done", locale)} ${vm.summary.done_count}`)}</p>
        </div>
        <div class="wh-r4-route-actions">${markAll}<span class="wh-r4-route-count">${escapeHtml(String(vm.summary.unread_count))}</span></div>
      </header>
      ${renderNotificationMutePanel(locale)}
      <div class="wh-r4-route-grid">
        ${renderNotificationBucket("needs_decision", vm.buckets.needs_decision, locale)}
        ${renderNotificationBucket("fyi", vm.buckets.fyi, locale)}
      </div>
      ${renderNotificationBucket("done", vm.buckets.done, locale)}
    </section>`
  });
}

function healthBandLabel(band: ProjectHealthPageVM["cards"][number]["band"], locale: WorkHubLocale) {
  if (band === "critical") {
    return routeT(locale, "health.critical");
  }
  if (band === "attention") {
    return routeT(locale, "health.attention");
  }
  return routeT(locale, "health.healthy");
}

function renderHealthSignal(
  signal: ProjectHealthPageVM["cards"][number]["signals"][number],
  numbersVisible: boolean,
  locale: WorkHubLocale
) {
  const label = routeTOrHumanize(locale, `health.signal.${signal.key}`, signal.key);
  const value = numbersVisible ? `${label}: ${signal.count}` : `${label}: ${healthBandLabel(signal.band, locale)}`;
  const inner = `<span class="wh-pill" data-r5-7-health-signal="${escapeHtml(signal.key)}" data-r5-7-health-signal-band="${escapeHtml(signal.band)}">${escapeHtml(value)}</span>`;
  return signal.target_href
    ? `<a href="${escapeHtml(safeHref(signal.target_href))}" data-action-id="health_signal_${escapeHtml(signal.key)}">${inner}</a>`
    : inner;
}

function renderHealthCard(card: ProjectHealthPageVM["cards"][number], locale: WorkHubLocale) {
  const open = card.target_href
    ? `<a class="wh-btn wh-btn-primary" href="${escapeHtml(safeHref(card.target_href))}" data-action-id="health_open_project" data-r5-7-health-open-project="true">${escapeHtml(routeT(locale, "health.openProject"))}</a>`
    : "";
  return `<section class="wh-card wh-r4-route-card" data-r5-7-health-card="${escapeHtml(card.project_id)}" data-r5-7-health-card-band="${escapeHtml(card.band)}" data-r5-7-health-numbers-visible="${escapeHtml(String(card.numbers_visible))}">
    <div class="wh-r4-route-meta">
      <span class="wh-pill">${escapeHtml(healthBandLabel(card.band, locale))}</span>
    </div>
    <h3>${escapeHtml(card.project_name)}</h3>
    <div class="wh-r4-route-meta">${card.signals.map((signal) => renderHealthSignal(signal, card.numbers_visible, locale)).join("")}</div>
    ${open ? `<div class="wh-r4-route-actions">${open}</div>` : ""}
  </section>`;
}

function renderHealthRouteComponent(vm: ProjectHealthPageVM, locale: WorkHubLocale): WebRouteComponent {
  const primaryHrefs = [
    ...vm.cards.map((card) => card.target_href),
    ...vm.cards.flatMap((card) => card.signals.map((signal) => signal.target_href))
  ].filter((value): value is string => Boolean(value));
  const cards = vm.cards.length
    ? vm.cards.map((card) => renderHealthCard(card, locale)).join("")
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "health.empty"))}</p>`;
  const memberNote = vm.viewer_scope === "member"
    ? `<p class="wh-subtle" data-r5-7-health-bands-only="true">${escapeHtml(routeT(locale, "health.bandsOnly"))}</p>`
    : "";
  return createWebRouteComponent({
    key: "health",
    css: webRouteComponentCss,
    primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "health",
    html: `<section class="wh-r4-route" data-r4-route-component="health" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r5-7-health-route="true" data-r5-7-health-viewer-scope="${escapeHtml(vm.viewer_scope)}" data-r5-7-health-project-count="${escapeHtml(String(vm.summary.project_count))}" data-r5-7-health-attention-count="${escapeHtml(String(vm.summary.attention_count))}" data-r5-7-health-critical-count="${escapeHtml(String(vm.summary.critical_count))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "health.kicker"))}</span>
          <h2>${escapeHtml(routeT(locale, "health.kicker"))}</h2>
          <p>${escapeHtml(`${routeT(locale, "health.summary")} ${vm.summary.project_count} · ${routeT(locale, "health.attention")} ${vm.summary.attention_count} · ${routeT(locale, "health.critical")} ${vm.summary.critical_count}`)}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(vm.summary.project_count))}</span>
      </header>
      ${memberNote}
      <div class="wh-r4-route-grid">${cards}</div>
    </section>`
  });
}

function scheduleStatusLabel(status: CalendarPageVM["blocks"][number]["status"], locale: WorkHubLocale) {
  if (status === "overdue") {
    return routeT(locale, "calendar.overdue");
  }
  if (status === "done") {
    return routeT(locale, "calendar.done");
  }
  if (status === "today") {
    return routeT(locale, "calendar.today");
  }
  return routeT(locale, "calendar.upcoming");
}

function scheduleKindLabel(kind: CalendarPageVM["blocks"][number]["kind"], locale: WorkHubLocale) {
  if (kind === "work_item_due") {
    return routeT(locale, "calendar.workItemDue");
  }
  if (kind === "meeting_followup") {
    return routeT(locale, "calendar.meetingFollowup");
  }
  if (kind === "review_window") {
    return routeT(locale, "calendar.reviewWindow");
  }
  return routeT(locale, "calendar.scheduleEvent");
}

function renderCalendarBlock(block: CalendarPageVM["blocks"][number], locale: WorkHubLocale) {
  const link = block.target_href
    ? `<a class="wh-btn wh-btn-primary" href="${escapeHtml(safeHref(block.target_href))}" data-action-id="calendar_open_target" data-r5-calendar-open-target="true">${escapeHtml(routeT(locale, "notifications.open"))}</a>`
    : "";
  return `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r5-calendar-block="${escapeHtml(block.id)}" data-r5-calendar-block-kind="${escapeHtml(block.kind)}" data-r5-calendar-block-status="${escapeHtml(block.status)}" data-r5-calendar-block-severity="${escapeHtml(block.severity)}">
    <div>
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(scheduleKindLabel(block.kind, locale))}</span>
        <span class="wh-pill">${escapeHtml(scheduleStatusLabel(block.status, locale))}</span>
        <span class="wh-pill">${escapeHtml(block.all_day ? routeT(locale, "calendar.allDay") : (block.starts_at ?? block.ends_at))}</span>
      </div>
      <strong>${escapeHtml(block.title)}</strong>
      ${block.description ? `<p>${escapeHtml(block.description)}</p>` : ""}
      <p>${escapeHtml(block.ends_at)}</p>
    </div>
    ${link ? `<div class="wh-r4-route-actions">${link}</div>` : ""}
  </div>`;
}

function renderCalendarRouteComponent(vm: CalendarPageVM, locale: WorkHubLocale): WebRouteComponent {
  const primaryHrefs = vm.blocks.map((block) => block.target_href).filter((value): value is string => Boolean(value));
  const dayRows = vm.days.map((day) => `<section class="wh-card wh-r4-route-card" data-r5-calendar-day="${escapeHtml(day.date)}" data-r5-calendar-day-count="${escapeHtml(String(day.blocks.length))}">
    <h3>${escapeHtml(day.date)}</h3>
    <div class="wh-r4-route-timeline">${day.blocks.length ? day.blocks.map((block) => renderCalendarBlock(block, locale)).join("") : `<p class="wh-subtle">${escapeHtml(routeT(locale, "calendar.empty"))}</p>`}</div>
  </section>`).join("");

  return createWebRouteComponent({
    key: "calendar",
    css: webRouteComponentCss,
    primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "calendar",
    html: `<section class="wh-r4-route" data-r4-route-component="calendar" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r5-calendar-route="true" data-r5-calendar-date="${escapeHtml(vm.scope.date)}" data-r5-calendar-view="${escapeHtml(vm.scope.view)}" data-r5-calendar-block-count="${escapeHtml(String(vm.summary.block_count))}" data-r5-calendar-overdue-count="${escapeHtml(String(vm.summary.overdue_count))}" data-r5-calendar-today-count="${escapeHtml(String(vm.summary.today_count))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "calendar.kicker"))}</span>
          <h2>${escapeHtml(routeT(locale, "calendar.kicker"))}</h2>
          <p>${escapeHtml(`${routeT(locale, "calendar.week")} · ${vm.scope.range_start} - ${vm.scope.range_end}`)}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(vm.summary.block_count))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r5-calendar-upcoming="true">
          <h3>${escapeHtml(routeT(locale, "calendar.today"))}</h3>
          <div class="wh-r4-route-timeline">${vm.blocks.length ? vm.blocks.slice(0, 6).map((block) => renderCalendarBlock(block, locale)).join("") : `<p class="wh-subtle">${escapeHtml(routeT(locale, "calendar.empty"))}</p>`}</div>
        </section>
        <section class="wh-r4-route-stack" data-r5-calendar-days="true">
          ${dayRows}
        </section>
      </div>
    </section>`
  });
}

function costAmount(value: string) {
  return `¥${value}`;
}

function renderBudgetRows(vm: CostDashboardVM, locale: WorkHubLocale) {
  if (vm.budget.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "cost.statusFallback"))}</p>`;
  }
  return vm.budget.slice(0, 5).map((usage) => {
    const ratio = usage.max_tokens > 0 ? Math.round((usage.total_tokens / usage.max_tokens) * 100) : 0;
    return `<div class="wh-r4-route-row" data-r4-cost-budget-scope="${escapeHtml(usage.policy_id)}" data-r4-cost-budget-status="${escapeHtml(usage.status)}">
      <div>
        <strong>${escapeHtml(usage.scope_label)}</strong>
        <p>${escapeHtml(`${usage.total_tokens}/${usage.max_tokens} tokens · ${costAmount(usage.estimated_cost_cny)}/${costAmount(usage.max_cost_cny)}`)}</p>
        <div class="wh-r4-route-meter" aria-hidden="true"><span style="width:${escapeHtml(String(Math.min(100, ratio)))}%"></span></div>
      </div>
      <span class="wh-pill">${escapeHtml(usage.status)}</span>
    </div>`;
  }).join("");
}

function renderTeamSkillsRouteComponent(vm: TeamSkillsPageVM, locale: WorkHubLocale): WebRouteComponent {
  const cards = vm.skills.length
    ? vm.skills.map((skill) => {
        const badges = [
          `<span class="wh-pill">${escapeHtml(`${routeT(locale, "skills.version")} v${skill.version}`)}</span>`,
          skill.created_by_kind === "ai"
            ? `<span class="wh-pill">${escapeHtml(routeT(locale, "skills.aiAuthored"))}</span>`
            : "",
          skill.confidence_score !== undefined
            ? `<span class="wh-pill">${escapeHtml(`${routeT(locale, "skills.confidence")} ${Math.round(skill.confidence_score * 100)}%`)}</span>`
            : "",
          skill.provenance
            ? `<span class="wh-pill wh-pill--accent" data-r8-skill-refined="true">${escapeHtml(`${routeT(locale, "skills.refinedFrom")}${skill.provenance.refined_from_version} · +${skill.provenance.op_count}`)}</span>`
            : ""
        ].filter(Boolean).join("");
        const rationale = skill.provenance?.rationale_md
          ? `<p class="wh-subtle">${escapeHtml(skill.provenance.rationale_md)}</p>`
          : "";
        return `<section class="wh-card wh-r4-route-card" data-r8-skill="${escapeHtml(skill.skill_key)}" data-r8-skill-version="${escapeHtml(String(skill.version))}">
          <h3>${escapeHtml(skill.name)}</h3>
          <p>${escapeHtml(skill.when_to_use)}</p>
          <div class="wh-r4-route-meta">${badges}</div>
          ${rationale}
        </section>`;
      }).join("")
    : `<p class="wh-subtle" data-r8-skills-empty="true">${escapeHtml(routeT(locale, "skills.empty"))}</p>`;

  return createWebRouteComponent({
    key: "skills",
    css: webRouteComponentCss,
    primaryHrefs: [],
    source: "page-vm",
    locale,
    pageVm: "skills",
    html: `<section class="wh-r4-route" data-r4-route-component="skills" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r8-skills-active="${escapeHtml(String(vm.totals.active))}" data-r8-skills-ai-authored="${escapeHtml(String(vm.totals.ai_authored))}" data-r8-skills-refined="${escapeHtml(String(vm.totals.refined))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "skills.kicker"))}</span>
          <h2>${escapeHtml(routeT(locale, "skills.title"))}</h2>
          <p>${escapeHtml(`${routeT(locale, "skills.summary")} · ${routeT(locale, "skills.active")} ${vm.totals.active} · ${routeT(locale, "skills.refined")} ${vm.totals.refined}`)}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(vm.totals.active))}</span>
      </header>
      <div class="wh-r4-route-grid">${cards}</div>
    </section>`
  });
}

function renderProjectsRouteComponent(vm: ProjectListVM, locale: WorkHubLocale): WebRouteComponent {
  // GitHub 式仓库索引：每个项目一行卡片（名称 + 负责人 + 进行中工作项 + 归档徽标 + 更新时间），
  // 头部带「新建项目」表单（输入项目名 → POST /api/projects/bootstrap，bootstrap 按 slug 派生新建/复用，
  // 唯一名 → 唯一 slug → 新项目）。动作 id=create_named_project，由 browser 调度读 sibling 输入框真名提交。
  const projects = vm.projects;
  const rows = projects.length
    ? projects.map((project) => {
      const openLabel = `${routeT(locale, "projects.openItems")} ${project.open_work_item_count}`;
      const archivedPill = project.archived
        ? `<span class="wh-pill" data-r8-project-archived="true">${escapeHtml(routeT(locale, "projects.archived"))}</span>`
        : "";
      const descriptionLine = project.description
        ? `<p>${escapeHtml(project.description)}</p>`
        : `<p>${escapeHtml(`${routeT(locale, "projects.updated")} ${project.updated_at.slice(0, 10)}`)}</p>`;
      const projectHref = `/drive?project_id=${encodeURIComponent(project.id)}`;
      return `<div class="wh-r4-route-row" data-r8-project="${escapeHtml(project.id)}" data-r8-project-slug="${escapeHtml(project.slug)}" data-r8-project-archived="${escapeHtml(String(project.archived))}" data-r8-project-open-items="${escapeHtml(String(project.open_work_item_count))}">
      <div>
        <strong>${escapeHtml(project.name)}</strong>
        ${descriptionLine}
        <div class="wh-r4-route-meta">
          <span class="wh-pill">${escapeHtml(project.owner_nickname)}</span>
          <span class="wh-pill">${escapeHtml(openLabel)}</span>
          ${archivedPill}
        </div>
      </div>
      <a class="wh-btn" href="${escapeHtml(safeHref(projectHref))}" data-action-id="open_project" data-method="GET" data-r8-project-open="${escapeHtml(project.id)}">${escapeHtml(routeT(locale, "projects.open"))}</a>
    </div>`;
    }).join("")
    : `<p class="wh-subtle" data-r8-projects-empty="true">${escapeHtml(routeT(locale, "projects.empty"))}</p>`;
  return createWebRouteComponent({
    key: "projects",
    css: webRouteComponentCss,
    primaryHrefs: ["/api/projects/bootstrap"],
    source: "page-vm",
    locale,
    pageVm: "projects",
    html: `<section class="wh-r4-route" data-r4-route-component="projects" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r8-projects-count="${escapeHtml(String(projects.length))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "projects.kicker"))}</span>
          <h2>${escapeHtml(routeT(locale, "projects.title"))}</h2>
          <p>${escapeHtml(routeT(locale, "projects.summary"))}</p>
        </div>
        <form class="wh-r4-project-create" data-r8-project-create-form="true">
          <input type="text" data-r8-project-name-input="true" name="project_name" autocomplete="off" maxlength="128" placeholder="${escapeHtml(routeT(locale, "projects.namePlaceholder"))}" aria-label="${escapeHtml(routeT(locale, "projects.new"))}" />
          <a class="wh-btn wh-btn-primary" href="/api/projects/bootstrap" data-action-id="create_named_project" data-method="POST" data-r8-project-new="true" data-r8-project-create="true">${escapeHtml(routeT(locale, "projects.create"))}</a>
        </form>
      </header>
      <section class="wh-card wh-r4-route-card" data-r8-projects-list="true">
        <div class="wh-r4-route-timeline">${rows}</div>
      </section>
    </section>`
  });
}

function renderCostRouteComponent(vm: CostDashboardVM, locale: WorkHubLocale): WebRouteComponent {
  const reactComponent = createCostReactRouteComponent(vm, locale);
  const reactAttrs = dataAttrs(reactRouteComponentMarkerAttrs(reactComponent));
  const props = reactComponent.props;
  const risks = vm.top_exhaustion_risks.length
    ? vm.top_exhaustion_risks.map((risk) => `<div class="wh-r4-route-row" data-r4-cost-risk="${escapeHtml(risk.label)}" data-r4-cost-risk-status="${escapeHtml(risk.status)}">
      <div>
        <strong>${escapeHtml(risk.label)}</strong>
        <p>${escapeHtml(`${routeT(locale, "cost.remaining")}: ${costAmount(risk.remaining_cost_cny)}`)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(risk.status)}</span>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "cost.statusFallback"))}</p>`;
  const notices = vm.notices.length
    ? vm.notices.map((notice) => `<div class="wh-r4-route-row" data-r4-cost-notice="${escapeHtml(notice.code)}" data-r4-cost-notice-severity="${escapeHtml(notice.severity)}">
      <div>
        <strong>${escapeHtml(notice.severity)}</strong>
        <p>${escapeHtml(notice.message)}</p>
      </div>
      ${notice.action_href ? `<a class="wh-pill" href="${escapeHtml(safeHref(notice.action_href))}">${escapeHtml(goldPathT(locale, "cost.title"))}</a>` : ""}
    </div>`).join("")
    : "";
  const models = vm.model_breakdown.slice(0, 5)
    .map((item) => `<div class="wh-r4-route-row" data-r4-cost-model="${escapeHtml(`${item.provider}:${item.model}`)}">
      <div>
        <strong>${escapeHtml(item.model)}</strong>
        <p>${escapeHtml(`${item.provider} · ${item.count}`)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(costAmount(item.cost_cny))}</span>
    </div>`)
    .join("");
  // K5：「干活 vs 自进化」分账卡——把夜间技能自迭代的开销显性化（复利劳动力的自我打磨成本）。
  const laborSplitCard = vm.labor_split
    ? `<section class="wh-card wh-r4-route-card" data-r4-cost-labor-split="true" data-r4-cost-self-improvement-ratio="${escapeHtml(String(vm.labor_split.self_improvement_ratio))}">
          <h3>${escapeHtml(routeT(locale, "cost.laborSplit"))}</h3>
          <div class="wh-r4-route-timeline">
            <div class="wh-r4-route-row" data-r4-cost-labor="production">
              <div><strong>${escapeHtml(routeT(locale, "cost.laborProduction"))}</strong></div>
              <span class="wh-pill">${escapeHtml(costAmount(vm.labor_split.production_cost_cny))}</span>
            </div>
            <div class="wh-r4-route-row" data-r4-cost-labor="self_improvement">
              <div>
                <strong>${escapeHtml(routeT(locale, "cost.laborSelfImprovement"))}</strong>
                <p>${escapeHtml(`${routeT(locale, "cost.laborSelfImprovementRatio")}: ${Math.round(vm.labor_split.self_improvement_ratio * 100)}%`)}</p>
              </div>
              <span class="wh-pill">${escapeHtml(costAmount(vm.labor_split.self_improvement_cost_cny))}</span>
            </div>
          </div>
        </section>`
    : "";

  return createWebRouteComponent({
    key: "cost",
    css: webRouteComponentCss,
    primaryHrefs: reactComponent.primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "cost",
    reactComponent,
    html: `<section class="wh-r4-route" data-r4-route-component="cost" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}"${reactAttrs} data-r4-cost-total-tokens="${escapeHtml(String(props.totalTokens))}" data-r4-cost-total-cny="${escapeHtml(props.totalCostCny)}" data-r4-cost-budget-count="${escapeHtml(String(props.budgetCount))}" data-r4-cost-risk-count="${escapeHtml(String(props.riskCount))}" data-r4-cost-model-count="${escapeHtml(String(props.modelCount))}" data-r4-cost-trend-count="${escapeHtml(String(props.trendCount))}" data-r4-cost-notice-count="${escapeHtml(String(props.noticeCount))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "cost.kicker"))}</span>
          <h2>${escapeHtml(goldPathT(locale, "cost.title"))}</h2>
          <p>${escapeHtml(goldPathT(locale, "cost.summary"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(costAmount(props.totalCostCny))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-cost-metrics="true">
          <h3>${escapeHtml(goldPathT(locale, "cost.estimatedTitle"))}</h3>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(goldPathT(locale, "cost.tokenTitle"))}: ${escapeHtml(String(props.totalTokens))}</span>
            <span class="wh-pill">${escapeHtml(goldPathT(locale, "cost.estimatedTitle"))}: ${escapeHtml(costAmount(props.totalCostCny))}</span>
            <span class="wh-pill">${escapeHtml(routeT(locale, "cost.trend"))}: ${escapeHtml(String(props.trendCount))}</span>
          </div>
          ${notices}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-cost-risks="true">
          <h3>${escapeHtml(routeT(locale, "cost.risks"))}</h3>
          <div class="wh-r4-route-timeline">${risks}</div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r4-cost-budget="true">
          <h3>${escapeHtml(routeT(locale, "cost.scopes"))}</h3>
          <div class="wh-r4-route-timeline">${renderBudgetRows(vm, locale)}</div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-cost-models="true">
          <h3>${escapeHtml(routeT(locale, "cost.models"))}</h3>
          <div class="wh-r4-route-timeline">${models || `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "cost.statusFallback"))}</p>`}</div>
        </section>
      </div>
      ${laborSplitCard ? `<div class="wh-r4-route-grid">${laborSplitCard}</div>` : ""}
    </section>`
  });
}

function renderKnowledgeAction(action: EvidenceBubble["actions"][number], vm: EvidenceBubble) {
  if (!action.href) {
    return "";
  }
  const payload = action.id === "use_for_current_task"
    ? { evidence_bubble_id: vm.id, evidence_refs: vm.evidence_refs }
    : undefined;
  return `<a class="wh-btn${action.id === "use_for_current_task" ? " wh-btn-primary" : ""}" href="${escapeHtml(safeHref(action.href))}" data-action-id="${escapeHtml(action.id)}"${action.method ? ` data-method="${escapeHtml(action.method)}"` : ""}${payload ? ` data-request-json="${jsonAttr(payload)}"` : ""}>${escapeHtml(action.label)}</a>`;
}

function renderKnowledgeRouteComponent(vm: EvidenceBubble, locale: WorkHubLocale, sourceRef?: string): WebRouteComponent {
  const refs = vm.evidence_refs;
  const sourceRows = refs.length
    ? refs.slice(0, 6).map((ref) => `<div class="wh-r4-route-row" data-r4-knowledge-evidence-ref="${escapeHtml(ref.id)}" data-r4-knowledge-source-type="${escapeHtml(ref.source_type)}">
      <div>
        <strong>${escapeHtml(ref.title)}</strong>
        <p>${escapeHtml(ref.excerpt ?? ref.source_id)}</p>
      </div>
      ${ref.href ? `<a class="wh-pill" href="${escapeHtml(safeHref(ref.href))}">${escapeHtml(routeT(locale, "knowledge.open"))}</a>` : `<span class="wh-pill">${escapeHtml(evidenceSourceLabel(locale, ref.source_type))}</span>`}
    </div>`).join("")
    : `<p class="wh-subtle" data-r4-knowledge-missing-note="true">${escapeHtml(vm.missing_evidence_note ?? routeT(locale, "knowledge.missing"))}</p>`;
  const actions = vm.actions.map((action) => renderKnowledgeAction(action, vm)).join("");

  return createWebRouteComponent({
    key: "knowledge",
    css: webRouteComponentCss,
    primaryHrefs: vm.actions.map((action) => action.href).filter((value): value is string => Boolean(value)),
    source: "evidence-bubble",
    locale,
    pageVm: "evidence",
    html: `<section class="wh-r4-route" data-r4-route-component="knowledge" data-r4-route-component-source="evidence-bubble" data-r4-route-component-locale="${escapeHtml(locale)}" data-r4-knowledge-bubble-id="${escapeHtml(vm.id)}" data-r4-knowledge-query="${escapeHtml(vm.query_text ?? "")}" data-r4-knowledge-evidence-count="${escapeHtml(String(refs.length))}" data-r4-knowledge-missing="${escapeHtml(String(refs.length === 0))}" data-r4-knowledge-action-count="${escapeHtml(String(vm.actions.length))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "knowledge.kicker"))}</span>
          <h2>${escapeHtml(routeT(locale, "knowledge.sources"))}</h2>
          <p>${escapeHtml(vm.summary_text)}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(refs.length))}</span>
      </header>
      <form class="wh-r4-knowledge-search" method="get" action="/knowledge/search" role="search" data-r4-knowledge-search-form="true">
        <input type="search" name="q" value="${escapeHtml(vm.query_text ?? "")}" placeholder="${escapeHtml(routeT(locale, "knowledge.searchPlaceholder"))}" aria-label="${escapeHtml(routeT(locale, "knowledge.searchLabel"))}" autocomplete="off" />
        <button class="wh-btn wh-btn-primary" type="submit">${escapeHtml(routeT(locale, "knowledge.searchSubmit"))}</button>
      </form>
      ${sourceRef ? `<p class="wh-subtle" data-r5-7-knowledge-source-ref="${escapeHtml(sourceRef)}">${escapeHtml(routeT(locale, "knowledge.fromNotice"))}: ${escapeHtml(sourceRef)}</p>` : ""}
      <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-knowledge-fallback="true">
        <h3>${escapeHtml(routeT(locale, "knowledge.sources"))}</h3>
        <div class="wh-r4-route-timeline">${sourceRows}</div>
        <div class="wh-r4-route-actions">${actions}</div>
      </section>
    </section>`
  });
}

function renderSettingsRouteComponent(vm: SettingsPageVM, locale: WorkHubLocale): WebRouteComponent {
  const reactComponent = createSettingsReactRouteComponent(vm, locale);
  const reactAttrs = dataAttrs(reactRouteComponentMarkerAttrs(reactComponent));
  const props = reactComponent.props;
  return createWebRouteComponent({
    key: "settings",
    css: webRouteComponentCss,
    primaryHrefs: reactComponent.primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "settings",
    reactComponent,
    html: `<section class="wh-r4-route" data-r4-route-component="settings" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}"${reactAttrs} data-r4-settings-generated-at="${escapeHtml(props.generatedAt)}" data-r4-settings-runtime-status="${escapeHtml(props.runtimeStatus)}" data-r4-settings-broker="${escapeHtml(props.brokerBackend)}" data-r4-settings-worker-count="${escapeHtml(String(props.workerCount))}" data-r4-settings-active-locale="${escapeHtml(props.activeLocale)}" data-r4-settings-preference-locale="${escapeHtml(props.preferenceLocale)}" data-r4-settings-preference-source="${escapeHtml(props.preferenceSource)}" data-r4-settings-preference-synced="${escapeHtml(String(props.preferenceSynced))}" data-r4-settings-secret-safe="${escapeHtml(String(props.secretSafe))}" data-r4-settings-pet-model-in-web="${escapeHtml(String(props.petModelSettingsInWeb))}" data-r4-settings-desktop-client="${escapeHtml(props.desktopClient)}" data-r4-settings-local-boundary="${escapeHtml(String(props.localExecutionBoundary))}" data-r4-settings-restore-requires-desktop="${escapeHtml(String(props.restoreRequiresDesktop))}" data-r4-settings-web-local-actions="${escapeHtml(String(props.webLocalActionsEnabled))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "settings.kicker"))}</span>
          <h2>${escapeHtml(goldPathT(locale, "settings.title"))}</h2>
          <p>${escapeHtml(goldPathT(locale, "settings.summary"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(props.appEnv)}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-settings-runtime="true">
          <h3>${escapeHtml(routeT(locale, "settings.runtime"))}</h3>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.runtimeStatus"))}</strong><span class="wh-pill">${escapeHtml(runtimeStatusLabel(props.runtimeStatus, locale))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.worker"))}</strong><span class="wh-pill">${escapeHtml(String(props.workerCount))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.broker"))}</strong><span class="wh-pill">${escapeHtml(props.brokerBackend)} · ${escapeHtml(boolLabel(props.brokerConfigured, locale))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.database"))}</strong><span class="wh-pill">${escapeHtml(boolLabel(props.databaseConfigured, locale))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.lease"))}</strong><span class="wh-pill">${escapeHtml(String(props.agentRunLeaseMs))}ms</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.recovery"))}</strong><span class="wh-pill">${escapeHtml(String(props.agentRunRecoveryIntervalMs))}ms</span></div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-settings-llm="true">
          <h3>${escapeHtml(routeT(locale, "settings.llm"))}</h3>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.provider"))}</strong><span class="wh-pill">${escapeHtml(props.defaultProvider)}</span></div>
          <div class="wh-r4-route-row"><div><strong>${escapeHtml(routeT(locale, "settings.model"))}</strong><p>${escapeHtml(props.defaultModel)}</p></div><span class="wh-pill">${escapeHtml(String(props.providerCount))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.apiKey"))}</strong><span class="wh-pill">${escapeHtml(boolLabel(props.apiKeyConfigured, locale))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.baseUrl"))}</strong><span class="wh-pill">${escapeHtml(boolLabel(props.baseUrlConfigured, locale))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.secretSafe"))}</strong><span class="wh-pill">${escapeHtml(boolLabel(props.secretSafe, locale))}</span></div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r4-settings-language="true">
          <h3>${escapeHtml(routeT(locale, "settings.language"))}</h3>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.activeLocale"))}</strong><span class="wh-pill">${escapeHtml(props.activeLocale)}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.preferenceLocale"))}</strong><span class="wh-pill">${escapeHtml(props.preferenceLocale)}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.preferenceSource"))}</strong><span class="wh-pill">${escapeHtml(props.preferenceSource)}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.preferenceSync"))}</strong><span class="wh-pill">${escapeHtml(syncLabel(props.preferenceSynced, locale))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.supported"))}</strong><span class="wh-pill">${escapeHtml(props.supportedLocales.join(" / "))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.storage"))}</strong><span class="wh-pill">${escapeHtml(props.storageKey)}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.updateEndpoint"))}</strong><span class="wh-pill">${escapeHtml(props.updateHref)}</span></div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-settings-device="true">
          <h3>${escapeHtml(routeT(locale, "settings.device"))}</h3>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.localExecution"))}</strong><span class="wh-pill">${escapeHtml(String(props.localExecutionBoundary))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.independentPet"))}</strong><span class="wh-pill">${escapeHtml(String(props.independentPetWindow))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.petBoundary"))}</strong><span class="wh-pill">${escapeHtml(String(!props.petModelSettingsInWeb))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.desktopGate"))}</strong><span class="wh-pill">${escapeHtml(String(props.restoreRequiresDesktop))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.webLocalActions"))}</strong><span class="wh-pill">${escapeHtml(String(props.webLocalActionsEnabled))}</span></div>
          <a class="wh-btn" href="${escapeHtml(safeHref(props.restoreHref))}" data-action-id="open_desktop_settings" data-method="GET" data-requires-desktop="${escapeHtml(String(props.restoreRequiresDesktop))}">${escapeHtml(routeT(locale, "settings.restore"))}</a>
        </section>
      </div>
    </section>`
  });
}

function renderReplayRouteComponent(vm: ReplayTraceVM, locale: WorkHubLocale): WebRouteComponent {
  const rendered = renderAgentRunReplay(vm, "web", { locale });
  const reactComponent = createReplayReactRouteComponent(rendered, locale);
  const reactAttrs = dataAttrs(reactRouteComponentMarkerAttrs(reactComponent));
  return createWebRouteComponent({
    key: "replay",
    css: `${webRouteComponentCss}${rendered.css}`,
    primaryHrefs: reactComponent.primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "replay",
    reactComponent,
    html: `<section class="wh-r4-route" data-r4-route-component="replay" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}"${reactAttrs} data-r4-replay-run-id="${escapeHtml(reactComponent.props.runId)}" data-r4-replay-workitem-id="${escapeHtml(reactComponent.props.workItemId)}" data-r4-replay-step-count="${escapeHtml(String(reactComponent.props.stepCount))}" data-r4-replay-accepted-deliverable-count="${escapeHtml(String(reactComponent.props.acceptedDeliverableCount))}" data-r4-replay-merge-attempt-count="${escapeHtml(String(reactComponent.props.mergeAttemptCount))}" data-r4-replay-structured-audit-count="${escapeHtml(String(reactComponent.props.structuredAuditCount))}">${rendered.html}</section>`
  });
}

export type WebRouteComponentInput =
  | { key: "home"; attention: AttentionHomeVM }
  | { key: "projects"; projects: ProjectListVM }
  | { key: "intake"; session: SessionVM }
  | { key: "intake"; start: true }
  | { key: "approvals"; approvals: ApprovalCenterVM }
  | { key: "workitem"; workitem: WorkItemDetailVM }
  | { key: "proposal"; proposal: ProposalDetailVM; proposalConflicts?: ProposalConflict[] | undefined }
  | { key: "drive"; drive: DrivePageVM; projects?: ProjectListVM | undefined }
  | { key: "meetings"; meetings: MeetingPageVM }
  | { key: "notifications"; notifications: NotificationPageVM }
  | { key: "calendar"; calendar: CalendarPageVM }
  | { key: "health"; health: ProjectHealthPageVM }
  | { key: "replay"; replay: ReplayTraceVM }
  | { key: "cost"; cost: CostDashboardVM }
  | { key: "knowledge"; evidence: EvidenceBubble; sourceRef?: string | undefined }
  | { key: "skills"; skills: TeamSkillsPageVM }
  | { key: "settings"; settings: SettingsPageVM };

export function renderWebRouteComponent(
  input: WebRouteComponentInput,
  options: RouteComponentOptions = {}
): WebRouteComponent {
  const locale = normalizeWorkHubLocale(options.locale);
  switch (input.key) {
    case "home":
      return renderHomeRouteComponent(input.attention, locale);
    case "projects":
      return renderProjectsRouteComponent(input.projects, locale);
    case "intake":
      if ("start" in input) {
        return renderIntakeStartRouteComponent(locale);
      }
      return renderIntakeRouteComponent(input.session, locale);
    case "approvals":
      return renderApprovalsRouteComponent(input.approvals, locale);
    case "workitem":
      return renderWorkItemRouteComponent(input.workitem, locale);
    case "proposal":
      return renderProposalRouteComponent(input.proposal, locale, input.proposalConflicts ?? []);
    case "drive":
      return renderDriveRouteComponent(input.drive, locale, input.projects);
    case "meetings":
      return renderMeetingRouteComponent(input.meetings, locale);
    case "notifications":
      return renderNotificationsRouteComponent(input.notifications, locale);
    case "calendar":
      return renderCalendarRouteComponent(input.calendar, locale);
    case "health":
      return renderHealthRouteComponent(input.health, locale);
    case "replay":
      return renderReplayRouteComponent(input.replay, locale);
    case "cost":
      return renderCostRouteComponent(input.cost, locale);
    case "knowledge":
      return renderKnowledgeRouteComponent(input.evidence, locale, input.sourceRef);
    case "skills":
      return renderTeamSkillsRouteComponent(input.skills, locale);
    case "settings":
      return renderSettingsRouteComponent(input.settings, locale);
  }
}

export function renderWebRouteComponents(
  vm: GoldPathSurfaceVM,
  options: RouteComponentOptions = {}
): WebRouteComponentMap {
  const locale = normalizeWorkHubLocale(options.locale);
  const routeSurface = vm as R4RouteSurface;
  return {
    home: renderHomeRouteComponent(vm.page_vms.attention, locale),
    ...(routeSurface.intake_session ? { intake: renderIntakeRouteComponent(routeSurface.intake_session, locale) } : {}),
    approvals: renderApprovalsRouteComponent(vm.page_vms.approvals, locale),
    workitem: renderWorkItemRouteComponent(vm.page_vms.workitem, locale),
    proposal: renderProposalRouteComponent(vm.page_vms.proposal, locale, proposalConflictsFromSurface(routeSurface)),
    replay: renderReplayRouteComponent(vm.page_vms.replay, locale),
    cost: renderCostRouteComponent(vm.page_vms.cost, locale),
    ...(routeSurface.knowledge_evidence ? { knowledge: renderKnowledgeRouteComponent(routeSurface.knowledge_evidence, locale) } : {}),
    ...(vm.page_vms.settings ? { settings: renderSettingsRouteComponent(vm.page_vms.settings, locale) } : {})
  };
}
