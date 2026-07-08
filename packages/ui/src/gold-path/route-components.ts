import type {
  ActionSpec,
  AgentArmyDashboardVM,
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
  ProjectHomePageVM,
  ProjectListVM,
  ReplayTraceVM,
  SessionVM,
  SettingsPageVM,
  TeamSkillsPageVM,
  TaskPlanVM,
  GoldPathSurfaceVM,
  WorkItemAgentTeamVM,
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
  agentStepPhaseLabel,
  agentStepPublicSummary,
  budgetStatusLabel,
  changeTypeLabel,
  checkStatusLabel,
  deliverableTargetLabel,
  evidenceSourceLabel,
  previewKindLabel,
  proposalStatusLabel,
  taskPlanItemRoleLabel,
  taskPlanItemStatusLabel,
  taskPlanStatusLabel,
  uiCount,
  uiFormatCny,
  uiHumanize,
  uiT,
  workItemStatusLabel
} from "../i18n.js";
import { approvalQueuePageInfoText, goldPathT, normalizeWorkHubLocale, type WorkHubLocale } from "./i18n.js";
import type { GoldPathRenderedPage } from "./render.js";

// "agents"/"skills"/"projects"/"project-home" 是 live-only 路由（不在 gold-path 静态 surface 渲染里），故单独并入而非走 Extract。
export type WebRouteComponentKey = Extract<GoldPathRenderedPage["key"], "home" | "intake" | "approvals" | "workitem" | "proposal" | "drive" | "meetings" | "notifications" | "calendar" | "health" | "replay" | "cost" | "knowledge" | "settings"> | "agents" | "skills" | "projects" | "project-home";

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
  ".wh-r4-route-head h1{margin:4px 0 0;font-size:24px;line-height:1.35;letter-spacing:0;overflow-wrap:anywhere}",
  ".wh-r4-route-head p{margin:6px 0 0;color:var(--wh-product-muted,#66728c);line-height:1.5;overflow-wrap:anywhere}",
  ".wh-r4-route-kicker{color:var(--wh-product-blue,#355cff);font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0}",
  ".wh-r4-route-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(260px,.8fr);gap:14px;align-items:start}",
  ".wh-r4-route-stack{display:grid;gap:12px;min-width:0}",
  ".wh-r4-route-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start;border-top:1px solid var(--wh-product-line,#dce4f1);padding-top:12px}",
  ".wh-r4-route-row--stacked{grid-template-columns:1fr;gap:8px}",
  ".wh-r4-route-row:first-child{border-top:0;padding-top:0}",
  ".wh-r4-route-row p,.wh-r4-route-row h3,.wh-r4-route-row strong{margin:0;overflow-wrap:anywhere}",
  ".wh-r4-route-row p{color:var(--wh-product-muted,#66728c);line-height:1.45}",
  ".wh-r4-route-row-title{color:var(--wh-product-accent,#2f6df0);text-decoration:none}",
  ".wh-r4-route-row-title:hover,.wh-r4-route-row-title:focus-visible{text-decoration:underline}",
  ".wh-r4-drive-item-link{display:block;color:inherit;text-decoration:none}",
  ".wh-r4-drive-item-link strong{color:var(--wh-product-accent,#2f6df0)}",
  ".wh-r4-drive-item-link:hover strong,.wh-r4-drive-item-link:focus-visible strong{text-decoration:underline}",
  // L6：项目主页「最近文件」深链到网盘并高亮该文件,但选中行以前和普通行长得一模一样(没有任何 CSS)。
  // 仿审批选中行给一道左内边线 + 浅底,让被深链点中的文件真的看得出来。
  ".wh-r4-route-row[data-r4-drive-item-selected=\"true\"]{border-radius:8px;box-shadow:inset 3px 0 0 var(--wh-product-blue,#4F46E5);background:var(--wh-product-blue-tint,#F5F5FE)}",
  // L7：网盘标题写着「File tree」,但行从不按层级缩进(depth 数据有、CSS 没有),折叠不出树形。按 depth 缩进,让嵌套可见。
  ".wh-r4-route-row[data-r4-drive-item-depth=\"1\"]{padding-left:18px}",
  ".wh-r4-route-row[data-r4-drive-item-depth=\"2\"]{padding-left:36px}",
  ".wh-r4-route-row[data-r4-drive-item-depth=\"3\"]{padding-left:54px}",
  ".wh-r4-route-row[data-r4-drive-item-depth=\"4\"]{padding-left:72px}",
  ".wh-r4-route-row[data-r4-drive-item-depth=\"5\"]{padding-left:90px}",
  ".wh-r4-route-row[data-r4-drive-item-depth=\"6\"]{padding-left:108px}",
  ".wh-r4-route-card{display:grid;gap:10px;min-width:0;max-width:100%;overflow:hidden}",
  ".wh-r4-route-card h3{margin:0;font-size:16px;line-height:1.35;overflow-wrap:anywhere}",
  ".wh-r4-route-card p{margin:0;color:var(--wh-product-muted,#66728c);line-height:1.5;overflow-wrap:anywhere}",
  ".wh-r4-route-card--accent{border-color:rgba(53,92,255,.22);box-shadow:0 12px 28px rgba(37,51,79,.06)}",
  ".wh-r4-route-card[data-intake-option-selected=true]{border-color:var(--wh-product-blue,#355cff);box-shadow:0 0 0 1px rgba(53,92,255,.22),0 12px 28px rgba(37,51,79,.08)}",
  ".wh-r4-route-table{display:grid;gap:8px;min-width:0}",
  ".wh-r4-route-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-start}",
  ".wh-r4-route-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}",
  ".wh-r4-route .wh-btn,.wh-r4-route .wh-pill{max-width:100%;white-space:normal;text-align:left;overflow-wrap:anywhere}",
  ".wh-drive-upload-control{display:inline-flex;gap:8px;flex-wrap:wrap;align-items:center;max-width:100%}.wh-drive-upload-label{position:relative;cursor:pointer}.wh-drive-upload-input{position:absolute;inline-size:1px;block-size:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}",
  ".wh-r5-drive-preview-panel{grid-column:1/-1}.wh-r5-drive-preview-body{margin:0;max-height:420px;overflow:auto;white-space:pre-wrap;word-break:break-word;border:1px solid var(--wh-product-line,#dce4f1);border-radius:8px;padding:12px;background:rgba(247,250,254,.82);color:var(--wh-product-ink,#172033);font:13px/1.55 \"SFMono-Regular\",\"Cascadia Mono\",Consolas,monospace}",
  ".wh-r4-route details:not([open])>*:not(summary){display:none}",
  ".wh-r4-intake-free-text{width:100%;min-height:92px;resize:vertical;border:1px solid var(--wh-product-line,#dce4f1);border-radius:8px;padding:10px 12px;font:inherit;line-height:1.45;color:var(--wh-product-ink,#172033);background:#fff;overflow-wrap:anywhere}",
  ".wh-r4-knowledge-search{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 4px;min-width:0;max-width:100%}.wh-r4-knowledge-search input{flex:1 1 220px;min-width:0;max-width:100%;box-sizing:border-box;font:inherit;line-height:1.45;border:1px solid var(--wh-product-line,#dce4f1);border-radius:8px;padding:9px 12px;color:var(--wh-product-ink,#172033);background:#fff}.wh-r4-knowledge-search .wh-btn{flex:0 0 auto}",
  ".wh-r4-project-create{display:flex;gap:8px;flex-wrap:wrap;align-items:center;min-width:0;max-width:100%}.wh-r4-project-create input{flex:1 1 220px;min-width:0;max-width:100%;box-sizing:border-box;font:inherit;line-height:1.45;border:1px solid var(--wh-product-line,#dce4f1);border-radius:8px;padding:9px 12px;color:var(--wh-product-ink,#172033);background:#fff}.wh-r4-project-create .wh-btn{flex:0 0 auto}",
  ".wh-r5-notif-mute summary{cursor:pointer;font-weight:800;font-size:14px;color:var(--wh-product-ink,#172033)}.wh-r5-notif-mute-list{display:grid;gap:8px;margin-top:8px;min-width:0}.wh-r5-notif-mute-row{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:1.4;color:var(--wh-product-secondary,#5B616E);min-width:0;overflow-wrap:anywhere}.wh-r5-notif-mute-row input{margin-top:2px;flex:0 0 auto}.wh-r5-notif-mute-row span{min-width:0}.wh-r5-notif-mute-status{margin:8px 0 0;font-size:12.5px}",
  ".wh-r4-route-count{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--wh-product-line,#dce4f1);border-radius:8px;background:#fff;padding:8px 10px;color:var(--wh-product-ink,#172033);font-weight:900;line-height:1}",
  ".wh-r4-route-timeline{display:grid;gap:8px}",
  // UX-M12（规格 §3.6 移动端）：KPI 行窄屏保持 2×2，不塌单列。
  "[data-r9-agent-dashboard-kpis=true]{grid-template-columns:repeat(4,minmax(0,1fr))}",
  "@media (max-width:860px){[data-r9-agent-dashboard-kpis=true]{grid-template-columns:repeat(2,minmax(0,1fr))}}",
  ".wh-r4-route-meter{height:8px;border-radius:999px;background:#e7edf7;overflow:hidden}.wh-r4-route-meter span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--wh-product-green,#24a66a),var(--wh-product-amber,#d98b16));max-width:100%}",
  // B-R9.6 UX 审计（视觉语义假接线）：燃烧条 tone / 军团状态点 / 审批黄条的 data hook 早就渲出，
  // 但全库无 CSS 消费——五种点一个样、超限不变红。补齐消费端规则（规格 §3.1 状态点色板+呼吸动画）。
  "[data-r9-agent-team-burn=ok] span,[data-r9-cost-army-burn=ok] span{background:var(--wh-product-blue,#4F46E5)}",
  "[data-r9-agent-team-burn=warning] span,[data-r9-cost-army-burn=warning] span{background:var(--wh-product-amber,#d98b16)}",
  "[data-r9-agent-team-burn=danger] span,[data-r9-cost-army-burn=danger] span{background:var(--wh-product-red,#d64545)}",
  ".wh-pill[data-r9-agent-team-state-dot]{color:transparent;position:relative;min-width:22px}.wh-pill[data-r9-agent-team-state-dot]::after{content:\"\";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:10px;height:10px;border-radius:999px}",
  ".wh-pill[data-r9-agent-team-state-dot=pending]::after{background:transparent;border:2px solid #9aa4b8}",
  ".wh-pill[data-r9-agent-team-state-dot=dispatched]::after{background:var(--wh-product-blue,#4F46E5);animation:wh-r9-dot-breathe 1.6s ease-in-out infinite}",
  ".wh-pill[data-r9-agent-team-state-dot=succeeded]::after{background:var(--wh-product-green,#15A05A)}",
  ".wh-pill[data-r9-agent-team-state-dot=failed]::after{background:var(--wh-product-red,#d64545)}",
  ".wh-pill[data-r9-agent-team-state-dot=needs_human]::after{background:var(--wh-product-amber,#d98b16)}",
  ".wh-pill[data-r9-agent-team-state-dot=skipped]::after{background:linear-gradient(135deg,#9aa4b8 45%,#fff 45%,#fff 55%,#9aa4b8 55%)}",
  "@keyframes wh-r9-dot-breathe{0%,100%{opacity:1}50%{opacity:.35}}",
  "@media (prefers-reduced-motion:reduce){.wh-pill[data-r9-agent-team-state-dot=dispatched]::after{animation:none}}",
  // 审批黄条复用 home banner 视觉（黄底+深字）；依赖未解锁行按规格降 60% 不透明度；超限红字。
  "[data-r9-task-plan-awaiting-approval]{border:1px solid #F1DC9C!important;border-radius:12px;background:#FEFBF0;color:#8A7330}",
  "[data-r9-agent-team-waiting=true]{opacity:.6}",
  ".wh-pill-danger{background:#fff1ef;color:#d64545}",
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
  | "workitem.createTaskPlan"
  | "workitem.startRun"
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
  | "drive.pendingDrafts"
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
  | "agents.kicker"
  | "agents.title"
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
  | "agents.roles"
  | "agents.statuses"
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
  | "projects.owner"
  | "projectHome.kicker"
  | "projectHome.openWork"
  | "projectHome.empty"
  | "projectHome.back"
  | "projectHome.files"
  | "projectHome.noFiles"
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
    "workitem.deliverables": "AI 提议的改动",
    "workitem.driveSource": "网盘评论来源",
    "workitem.meetingSource": "会议洞察来源",
    "workitem.openProposal": "查看变更申请",
    "workitem.openReplay": "查看回放",
    "workitem.createTaskPlan": "生成任务计划",
    "workitem.startRun": "开始 AI 执行",
    "intake.summary": "接入摘要",
    "intake.progress": "澄清进度",
    "intake.freeText": "也可以展开手动输入（可选）",
    "intake.createWorkItem": "创建工作项",
    "intake.continue": "继续澄清",
    "intake.stateDone": "已完成",
    "intake.stateActive": "进行中",
    "intake.statePending": "待进行",
    "intake.startKicker": "试点工作入口",
    "intake.startTitle": "从真实项目开始新任务",
    "intake.startBody": "WorkHub 会先准备好试点项目，再进入选项优先的需求澄清；不会改动已确认的交付物。",
    "intake.startProject": "试点项目",
    "intake.startAction": "开始新任务",
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
    "knowledge.scopeLandingCta": "去项目列表",
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
    "drive.pendingDrafts": "待处理草稿",
    "drive.createDraft": "生成草稿",
    "drive.openDraft": "打开草稿",
    "drive.openProposal": "打开提议",
    "drive.requestedMissing": "找不到该文件，已回到默认视图。",
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
    "notifications.done": "已归档",
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
    "health.title": "健康总览",
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
    "cost.trend": "统计天数",
    "cost.remaining": "剩余",
    "cost.laborSplit": "干活 vs 自进化",
    "cost.laborProduction": "干活花费",
    "cost.laborSelfImprovement": "自进化花费",
    "cost.laborSelfImprovementRatio": "自进化占比",
    "agents.kicker": "军团",
    "agents.title": "军团",
    "agents.summary": "观察正在推进的分工计划；需要人决定的事仍回到总览处理。",
    "agents.active": "进行中军团",
    "agents.waiting": "等你决策",
    "agents.todayCost": "今日成本",
    "agents.autonomy": "自治率",
    "agents.plans": "活跃计划",
    "agents.recent": "最近升级",
    "agents.noRecent": "还没有升级动态。",
    "agents.empty": "还没有军团在跑。下次遇到大任务，系统会先生成一份分工计划。",
    "agents.start": "发起新任务",
    "agents.cost": "成本",
    "agents.costDetails": "查看成本",
    "agents.objective": "目标",
    "agents.capPlans": "当前只显示前 {limit} 个军团；继续处理后列表会刷新。",
    "agents.capRows": "部分子任务、运行或升级记录已按上限截断，进入工作项可看完整上下文。",
    "agents.judge": "复核通过率",
    "agents.roles": "角色",
    "agents.statuses": "状态",
    "skills.kicker": "团队技能库",
    "skills.title": "团队技能",
    "skills.summary": "AI 沉淀并持续打磨的可复用技能",
    "skills.empty": "还没有沉淀出团队技能。AI 会在夜间从真实工作里蒸馏。",
    "projects.kicker": "项目即产品",
    "projects.title": "项目",
    "projects.summary": "把每个项目当成一个产品来管理：进行中工作项、负责人和最近更新一目了然。",
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
    "skills.active": "在用",
    "skills.aiAuthored": "AI 蒸馏",
    "skills.refined": "已精修",
    "skills.version": "版本",
    "skills.readiness": "成熟度",
    "skills.refinedFrom": "精修自 v",
    "skills.authoredBy": "来源",
    "settings.runtime": "运行时",
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
    "workitem.deliverables": "Proposed changes",
    "workitem.driveSource": "Drive comment source",
    "workitem.meetingSource": "Meeting insight source",
    "workitem.openProposal": "Open change request",
    "workitem.openReplay": "Open replay",
    "workitem.createTaskPlan": "Draft task plan",
    "workitem.startRun": "Start AI run",
    "intake.summary": "Intake summary",
    "intake.progress": "Clarification progress",
    "intake.freeText": "Or type your own answer (optional)",
    "intake.createWorkItem": "Create work item",
    "intake.continue": "Continue intake",
    "intake.stateDone": "Done",
    "intake.stateActive": "In progress",
    "intake.statePending": "Pending",
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
    "knowledge.scopeLandingCta": "Go to projects",
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
    "drive.pendingDrafts": "Pending drafts",
    "drive.createDraft": "Create draft",
    "drive.openDraft": "Open draft",
    "drive.openProposal": "Open proposal",
    "drive.requestedMissing": "We could not find that file, so the drive is back at the default view.",
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
    "notifications.done": "Archived",
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
    "health.title": "Health overview",
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
    "cost.trend": "Days tracked",
    "cost.remaining": "Remaining",
    "cost.laborSplit": "Work vs self-improvement",
    "cost.laborProduction": "Production spend",
    "cost.laborSelfImprovement": "Self-improvement spend",
    "cost.laborSelfImprovementRatio": "Self-improvement share",
    "agents.kicker": "Agent teams",
    "agents.title": "Agent teams",
    "agents.summary": "Observe active task plans; decisions still go through the overview inbox.",
    "agents.active": "Active teams",
    "agents.waiting": "Needs your decision",
    "agents.todayCost": "Today cost",
    "agents.autonomy": "Autonomy",
    "agents.plans": "Active plans",
    "agents.recent": "Recent escalations",
    "agents.noRecent": "No escalations yet.",
    "agents.empty": "No agent teams are running yet. Next time there is a large task, WorkHub will draft a task plan first.",
    "agents.start": "Start a task",
    "agents.cost": "Cost",
    "agents.costDetails": "View cost",
    "agents.objective": "Objective",
    "agents.capPlans": "Showing the first {limit} agent teams; the list refreshes as work moves forward.",
    "agents.capRows": "Some task, run, or escalation rows are capped; open the work item for full context.",
    "agents.judge": "Review pass rate",
    "agents.roles": "Roles",
    "agents.statuses": "Statuses",
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
    "projects.owner": "Owner",
    "projectHome.kicker": "Project home",
    "projectHome.openWork": "Open work",
    "projectHome.empty": "No open work in this project yet. Hit “New task” to assign some.",
    "projectHome.back": "← Back to projects",
    "projectHome.files": "Recent files",
    "projectHome.noFiles": "No files in the drive yet.",
    "skills.active": "Active",
    "skills.aiAuthored": "AI-distilled",
    "skills.refined": "Refined",
    "skills.version": "Version",
    "skills.readiness": "Readiness",
    "skills.refinedFrom": "refined from v",
    "skills.authoredBy": "Source",
    "settings.runtime": "Runtime",
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
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

// 给用户看的能力布尔值用「是/否」而不是裸 true/false（设置页设备能力行）。
// 与既有 boolLabel(已配置/未配置) 区分：设备能力不是「配置与否」语义。
function yesNoLabel(locale: WorkHubLocale, value: boolean) {
  return routeT(locale, value ? "settings.boolYes" : "settings.boolNo");
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

// rank1：转交他人(delegate)在 web 尚无选人 UI/分类器——会落到「功能开发中」toast 的死按钮。
// 桌面已隐藏(attention.ts/pet-surface)，web 在此一并隐藏，两端一致;待选人 UI 落地再放开。
// href 形如 /api/approvals/{id}/delegate。
function isUnsupportedWebAction(href: string): boolean {
  return /\/delegate(?:[/?#]|$)/u.test(href);
}

function renderActions(actions: (AttentionAction | ActionSpec)[]) {
  const shown = actions.filter((action) => !isUnsupportedWebAction(action.href));
  if (shown.length === 0) {
    return "";
  }
  return `<div class="wh-r4-route-actions">${shown
    .map((action, index) => {
      const reason = action.requires_reason ? " data-requires-reason=\"true\"" : "";
      const method = "method" in action ? ` data-method="${escapeHtml(action.method)}"` : "";
      const desktop = action.requires_desktop ? " data-requires-desktop=\"true\"" : "";
      const requestJson = action.request_json ? ` data-request-json="${jsonAttr(action.request_json)}"` : "";
      const postRunNext = action.id === "open_proposal"
        ? " data-s1-day2-post-run-next-action=\"proposal\""
        : action.id === "open_replay"
          ? " data-s1-day2-post-run-next-action=\"replay\""
          : "";
      return `<a class="${actionClass(action, index)}" href="${escapeHtml(safeHref(action.href))}" data-action-id="${escapeHtml(action.id)}"${reason}${method}${desktop}${requestJson}${postRunNext}>${escapeHtml(action.label)}</a>`;
    })
    .join("")}</div>`;
}

function jsonAttr(value: unknown) {
  return escapeHtml(JSON.stringify(value));
}

// M3：决策队列里每条都要能点进去处理,不能是死文本。优先用第一个导航(GET)动作的 href,
// 否则退回工作项/项目详情路由;实在没有目标时才退化为不可点的 div(不造死链)。
function attentionRowHref(item: AttentionItem): string | undefined {
  const navAction = item.actions.find((action) => action.method === "GET" && action.href);
  if (navAction) return navAction.href;
  if (item.work_item_id) return `/workitems/${item.work_item_id}`;
  if (item.project_id) return `/projects/${item.project_id}`;
  return undefined;
}

function renderAttentionRows(items: AttentionItem[], emptyCopy: string, zh: boolean) {
  if (items.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(emptyCopy)}</p>`;
  }
  // 普通用户审查：芯片报 12、列表只见 4，剩下的去哪了没人说——超出展示上限时明说还有几件。
  const overflowNote = items.length > 4
    ? `<p class="wh-subtle" data-r9-attention-overflow="${escapeHtml(String(items.length - 4))}">${escapeHtml(zh
      ? `还有 ${items.length - 4} 件排在后面，处理完上面的会自动顶上来。`
      : `${items.length - 4} more waiting — they surface as you clear the ones above.`)}</p>`
    : "";
  return items
    .slice(0, 4)
    .map((item) => {
      const href = attentionRowHref(item);
      const inner = `<div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.summary_text)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(attentionPriorityLabel(item.priority, zh))}</span>`;
      return href
        ? `<a class="wh-r4-route-row" href="${escapeHtml(safeHref(href))}" data-r4-route-attention-item="${escapeHtml(item.id)}">${inner}</a>`
        : `<div class="wh-r4-route-row" data-r4-route-attention-item="${escapeHtml(item.id)}">${inner}</div>`;
    })
    .join("") + overflowNote;
}

function approvalRouteLabel(routedToUserId: string | undefined, locale: WorkHubLocale) {
  if (!routedToUserId) {
    return goldPathT(locale, "approvals.unrouted");
  }
  return locale === "zh-CN" ? "已路由" : "Routed";
}

function approvalActionLabel(actionPattern: string, locale: WorkHubLocale) {
  const zh = locale === "zh-CN";
  const normalized = actionPattern.toLowerCase();
  if (normalized.startsWith("tool.")) {
    return zh ? "工具审批" : "Tool approval";
  }
  if (normalized.includes("permission") || normalized.includes("policy")) {
    return zh ? "权限审批" : "Permission approval";
  }
  if (normalized.includes("budget") || normalized.includes("cost")) {
    return zh ? "预算审批" : "Budget approval";
  }
  if (normalized.includes("proposal") || normalized.includes("deliverable") || normalized.includes("document")) {
    return zh ? "变更审批" : "Change approval";
  }
  return zh ? "审批请求" : "Approval request";
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
      plan_review: "计划审阅",
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
      plan_review: "Plan review",
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

// 通知类型是点分命名空间(comment.mention / workitem.escalated / agent_run.succeeded / proposal.ready …)。
// rank7：旧 map 的 key(proposal_review 等)与真实类型对不上 + en map 为空 → 两种语言都掉进 humanizeToken
// 渲出「Workitem.ai Working」式机器 token。改为：精确类型映射(双语) → 命名空间前缀兜底(双语) → 最后才 humanize。
function notificationTypeLabel(type: string, zh: boolean): string {
  const exact: Record<string, [string, string]> = {
    "comment.mention": ["提到你", "Mention"],
    "workitem.claimed": ["已认领", "Claimed"],
    "workitem.escalated": ["已升级", "Escalated"],
    "escalation.opened": ["已升级", "Escalated"],
    "proposal.ready": ["改动待审", "Proposal ready"],
    "proposal.opened": ["改动待审", "Proposal ready"],
    "agent_run.step": ["AI 进展", "AI progress"],
    "agent_run.succeeded": ["AI 完成", "AI done"],
    "agent_run.failed": ["AI 失败", "AI failed"],
    "approval.decided": ["审批已定", "Decided"],
    "approval.delegated": ["审批转交", "Delegated"],
    "approval.expired": ["审批过期", "Expired"],
    "approval.commented": ["审批评论", "Comment"],
    "meeting.insight.pending": ["会议待办", "Meeting insight"],
    "drive.page": ["网盘更新", "Drive"],
    "system.notice": ["系统通知", "System"],
    milestone: ["里程碑", "Milestone"],
    "notification.created": ["新通知", "Update"]
  };
  const hit = exact[type];
  if (hit) {
    return zh ? hit[0] : hit[1];
  }
  const prefix: Record<string, [string, string]> = {
    comment: ["评论", "Comment"],
    workitem: ["工作项", "Work item"],
    agent_run: ["AI 运行", "AI run"],
    approval: ["审批", "Approval"],
    proposal: ["改动", "Proposal"],
    escalation: ["升级", "Escalation"],
    drive: ["网盘", "Drive"],
    drive_comment: ["网盘评论", "Drive comment"],
    meeting: ["会议", "Meeting"],
    budget: ["预算", "Budget"],
    system: ["系统", "System"]
  };
  const ns = prefix[type.split(".")[0] ?? type];
  if (ns) {
    return zh ? ns[0] : ns[1];
  }
  return humanizeToken(type.replace(/\./gu, " "));
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

// F4：把 language 卡的 preference_source 枚举(server|request|fallback)译成用户能懂的话,而不是原始内部枚举。
function preferenceSourceLabel(source: string, zh: boolean): string {
  return localizedEnumLabel(
    source,
    zh,
    { server: "已保存在服务端", request: "本次请求设定", fallback: "默认回退" },
    { server: "Saved on server", request: "This request", fallback: "Default fallback" }
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

function renderHomeRouteComponent(
  vm: AttentionHomeVM,
  locale: WorkHubLocale,
  projects?: ProjectListVM | undefined
): WebRouteComponent {
  const reactComponent = createHomeReactRouteComponent(vm, locale);
  const reactAttrs = dataAttrs(reactRouteComponentMarkerAttrs(reactComponent));
  const primary = vm.primary;
  const primaryActions = primary?.actions ?? [];
  const zh = locale === "zh-CN";
  const sourceWarnings = vm.source_warnings ?? [];
  // 契约去歧义：fixture 里 primary 与 queue 不相交，但 live /api/pages/attention 把 primary=queue[0] 留在 queue 里。
  // 按 id 去重得到「除首决策外的剩余队列」，避免首决策被重复计数 + 重复渲染（对两种来源都正确）。
  const queueWithoutPrimary = primary ? vm.queue.filter((item) => item.id !== primary.id) : vm.queue;
  const decideCount = queueWithoutPrimary.length + (primary ? 1 : 0);
  // 「AI 正在做」只数真正在跑的(running/queued)；background_runs 还含 failed / waiting_for_user，
  // 列表里那些会标「失败 / 需要你」药丸——把它们算进「正在做」会和正文自相矛盾。
  const workingCount = vm.background_runs.filter((run) => run.state === "running" || run.state === "queued").length;
  const evidenceCount = primary?.evidence_refs?.length ?? 0;
  const worklog = vm.worklog;
  const projectList = projects?.projects ?? [];
  const topProject = projectList[0];
  const projectCountLabel = projects ? String(projectList.length) : (zh ? "项目" : "Projects");
  const projectRows = projectList.length
    ? projectList.slice(0, 4).map((project) => `<div class="wh-r4-route-row" data-r8-home-project="${escapeHtml(project.id)}" data-r8-home-project-open-items="${escapeHtml(String(project.open_work_item_count))}">
        <div>
          <strong><a class="wh-r4-route-row-title" href="/projects/${escapeHtml(encodeURIComponent(project.id))}">${escapeHtml(project.name)}</a></strong>
          ${project.description ? `<p>${escapeHtml(project.description)}</p>` : ""}
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(`${routeT(locale, "projects.owner")} · ${project.owner_nickname}`)}</span>
            <span class="wh-pill">${escapeHtml(`${routeT(locale, "projects.openItems")} ${project.open_work_item_count}`)}</span>
            <span class="wh-pill">${escapeHtml(`${routeT(locale, "projects.updated")} ${project.updated_at.slice(0, 10)}`)}</span>
          </div>
        </div>
        <a class="wh-btn" href="/projects/${escapeHtml(encodeURIComponent(project.id))}" data-r8-home-open-project="${escapeHtml(project.id)}">${escapeHtml(routeT(locale, "projects.open"))}</a>
      </div>`).join("")
    : `<p class="wh-subtle" data-r8-home-projects-empty="true">${escapeHtml(zh ? "还没有项目。先新建或打开一个项目，任务、文件和版本都会收在同一个工作区里。" : "No projects yet. Create or open a project first; tasks, files, and versions will live in that workspace.")}</p>`;
  const projectDriveHref = topProject ? `/drive?project_id=${encodeURIComponent(topProject.id)}` : "/projects";
  const projectIntakeHref = topProject ? `/intake?project_id=${encodeURIComponent(topProject.id)}` : "/intake";
  const projectDesk = `<section class="wh-card wh-r4-route-card wh-r4-route-card--accent wh-r8-home-project-desk" data-r8-home-project-desk="true" data-r8-home-project-count="${escapeHtml(String(projectList.length))}" data-r8-home-projects-loaded="${escapeHtml(String(Boolean(projects)))}">
      <div class="wh-r4-route-meta">
        <span class="wh-r4-route-kicker">${escapeHtml(zh ? "项目与网盘" : "Projects and drive")}</span>
        <span class="wh-pill">${escapeHtml(projects ? (zh ? `项目 ${projectList.length}` : `${projectList.length} projects`) : (zh ? "项目清单稍后同步" : "Project list syncing"))}</span>
      </div>
      <h3>${escapeHtml(zh ? "先进入项目，再处理任务和文件" : "Start from a project, then work through tasks and files")}</h3>
      <p>${escapeHtml(zh ? "每个项目像一个仓库：进行中的任务、最近文件、版本历史和网盘入口都围绕它组织。" : "Each project behaves like a repo: open work, recent files, version history, and the drive stay organized around it.")}</p>
      <div class="wh-r4-route-actions">
        <a class="wh-btn wh-btn-primary" href="/projects" data-r8-home-projects-cta="true">${escapeHtml(zh ? "打开项目" : "Open projects")}</a>
        <a class="wh-btn" href="${escapeHtml(safeHref(projectDriveHref))}" data-r8-home-drive-cta="true">${escapeHtml(zh ? "打开网盘" : "Open drive")}</a>
        <a class="wh-btn" href="${escapeHtml(safeHref(projectIntakeHref))}" data-r4-home-intake-cta="true" data-r8-home-new-work-cta="true">${escapeHtml(zh ? "新建任务" : "New task")}</a>
      </div>
      <div class="wh-r4-route-timeline">${projectRows}</div>
    </section>`;

  // R8：今日「自进化」——只在确有新增/精修时显示，避免零活动时刷存在感。
  const selfEvolved = (worklog?.skills_promoted_today ?? 0) + (worklog?.skills_refined_today ?? 0);
  const selfEvolveLine = worklog && selfEvolved > 0
    ? `<span class="wh-r4-home-banner-evolve" data-r4-home-self-evolve="true" data-r4-home-skills-promoted="${escapeHtml(String(worklog.skills_promoted_today))}" data-r4-home-skills-refined="${escapeHtml(String(worklog.skills_refined_today))}">${escapeHtml(zh ? "还顺手自我精进：技能 +" : "Also leveled up: skills +")}${escapeHtml(String(worklog.skills_promoted_today))}${escapeHtml(zh ? " · 精修 " : " · refined ")}${escapeHtml(String(worklog.skills_refined_today))}</span>`
    : "";
  // M1：战绩主行只在今天真有完成量时才显示，否则零活跃新用户首屏会读到「今天我替你扛了 0 件·自主率 0%·约省 0 小时」
  // 这种自夸 0 的尴尬文案（与自进化行的 selfEvolved>0 门同口径）。自进化行独立成立。
  const worklogMainLine = worklog && worklog.accepted_today > 0
    ? `<span>${escapeHtml(zh ? "今天我搞定了" : "AI handled today:")} <b>${escapeHtml(String(worklog.accepted_today))}</b> ${escapeHtml(zh ? "件 · 自治率" : "done · autonomy")} <b>${escapeHtml(String(worklog.autonomy_rate))}%</b> · ${escapeHtml(zh ? "约省" : "saved ≈")} <b>${escapeHtml(String(worklog.saved_hours_estimate))}</b> ${escapeHtml(zh ? "小时" : "h")} <span class="wh-r4-home-kao">٩(◜◡◝)۶</span></span>`
    : "";
  const worklogBanner = (worklogMainLine || selfEvolveLine)
    ? `<div class="wh-r4-home-banner" data-r4-home-worklog="true">
        <span class="wh-r4-home-banner-cat" aria-hidden="true"></span>
        ${worklogMainLine}
        ${selfEvolveLine}
      </div>`
    : "";
  const sourceWarningBanner = sourceWarnings.length
    ? `<section class="wh-card wh-r4-route-card wh-r4-home-source-warning" data-r4-home-source-warning="true" data-r4-home-source-warning-count="${escapeHtml(String(sourceWarnings.length))}">
        <span class="wh-r4-route-kicker">${escapeHtml(zh ? "数据未完整加载" : "Some data did not load")}</span>
        <div class="wh-r4-route-timeline">
          ${sourceWarnings.map((warning) => `<p class="wh-subtle" data-r4-home-source-warning-source="${escapeHtml(warning.source)}">${escapeHtml(warning.message)}</p>`).join("")}
        </div>
      </section>`
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

  // B-R9.6 §3.7：sync_conflict 主卡的「合并成一条（可编辑）」——merge 动作带 request_json.value_md
  // 合并草稿，这里渲成可编辑文本框；提交时 web 端以框内内容覆盖 value_md（人裁决，不是读转述）。
  const primaryMergeDraft = primary?.kind === "sync_conflict"
    ? primary.actions.find((action) => action.id === "merge_both")?.request_json?.["value_md"]
    : undefined;
  const mergeEditor = typeof primaryMergeDraft === "string"
    ? `<label class="wh-subtle" data-r9-sync-merge-label="true">${escapeHtml(zh ? "合并草稿（可编辑，点「合并成一条」提交）" : "Merge draft (editable — submit via Merge into one)")}</label>
       <textarea class="wh-r4-approval-comment-input" data-r9-sync-merge-value="true" rows="3">${escapeHtml(primaryMergeDraft)}</textarea>`
    : "";
  const decisionCard = primary
    ? `<section class="wh-card wh-r4-route-card wh-r4-decision" data-r4-home-decision="true">
        <div class="wh-r4-decision-top"></div>
        <div class="wh-r4-route-meta">${homePriorityPill(primary.priority, zh)}<span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "home.decisionTitle"))}</span></div>
        <h3>${escapeHtml(primary.title)}</h3>
        <p style="white-space:pre-line">${escapeHtml(primary.reason_text ?? primary.summary_text)}</p>
        ${mergeEditor}
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
          <a class="wh-btn" href="/projects" data-wh-route="/projects" data-r4-home-projects-cta="true">${escapeHtml(zh ? "浏览项目" : "Browse projects")}</a>
        </div>
      </section>`;

  const runRows = vm.background_runs.length
    ? vm.background_runs.slice(0, 4).map((run) => `<div class="wh-r4-run" data-r4-home-background-run="${escapeHtml(run.run_id)}">
        <div class="wh-r4-run-main"><strong>${escapeHtml(run.title)}</strong><p>${escapeHtml(run.preview_text)}</p></div>
        <span class="wh-pill wh-r4-runstate wh-r4-runstate--${homeRunStateTone(run.state)}">${escapeHtml(homeRunStateLabel(run.state, zh))}</span>
      </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "home.aiWorkingEmpty"))}</p>`;
  // 普通用户审查（首页布局）：每天拍板的人不该先滚过两张常青说明卡——决策区提到项目桌之上。
  const decisionGrid = `<div class="wh-r4-route-grid">
        ${decisionCard}
        <section class="wh-card wh-r4-route-card" data-r4-home-ai-working="true">
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "home.aiWorkingTitle"))}</span>
          <div class="wh-r4-route-timeline">${runRows}</div>
        </section>
      </div>`;

  const evidenceRows = primary?.evidence_refs?.length
    ? primary.evidence_refs.slice(0, 3).map((ref) => `<div class="wh-r4-route-row" data-r4-home-evidence="${escapeHtml(ref.id)}">
        <div>
          <strong>${escapeHtml(ref.title)}</strong>
          <p>${escapeHtml(ref.excerpt ?? ref.source_id)}</p>
        </div>
        <span class="wh-pill">${escapeHtml(evidenceSourceLabel(locale, ref.source_type))}</span>
      </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "empty.evidence"))}</p>`;

  // 当收件箱完全为空(无主决策、无队列)时,「当前入口」+「支撑证据」两区只会渲染占位文案——
  // 「专注处理它就好」却没有「它」,「没有找到证据」也无所指,对一无所知的用户像在描述并不存在的当前项。
  // 此时隐藏这一行,空态决策卡(含提需求 CTA)已自足;有任一决策时照常显示。
  const secondaryGrid = decideCount > 0
    ? `<div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r4-home-queue="true">
          <h3>${escapeHtml(goldPathT(locale, "home.entryTitle"))}</h3>
          ${renderAttentionRows(queueWithoutPrimary, goldPathT(locale, "home.entryText"), locale === "zh-CN")}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-home-evidence-list="true">
          <h3>${escapeHtml(goldPathT(locale, "home.evidenceTitle"))}</h3>
          ${evidenceRows}
        </section>
      </div>`
    : "";

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
          <span class="wh-r4-route-kicker">${escapeHtml(zh ? "项目工作台" : "Project workspace")}</span>
          <h1>${escapeHtml(zh ? "项目、网盘和待办" : "Projects, drive, and attention")}</h1>
          <p>${escapeHtml(zh ? "先从项目进入：任务、文件、版本和 AI 待办都会回到同一个项目脉络里。" : "Start from the project: tasks, files, versions, and AI attention all resolve back into one project context.")}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(projectCountLabel)}</span>
      </header>
      ${chips}
      ${sourceWarningBanner}
      ${decisionGrid}
      <div class="wh-r4-route-grid">
        ${projectDesk}
        <section class="wh-card wh-r4-route-card" data-r8-home-drive-principle="true">
          <span class="wh-r4-route-kicker">${escapeHtml(zh ? "文件同步" : "File sync")}</span>
          <h3>${escapeHtml(zh ? "网盘跟着项目走" : "The drive follows the project")}</h3>
          <p>${escapeHtml(zh ? "上传、版本、交付物恢复和评论草稿都在项目网盘里闭环，避免把文件散在全局入口。" : "Uploads, versions, deliverable restore, and comment drafts close the loop inside each project drive instead of a loose global bucket.")}</p>
          <a class="wh-r4-route-kicker" href="${escapeHtml(safeHref(projectDriveHref))}" data-r8-home-drive-principle-link="true">${escapeHtml(zh ? "查看项目网盘 →" : "View project drive →")}</a>
        </section>
      </div>
      ${secondaryGrid}
    </section>`
  });
}

// 澄清进度步骤状态：之前把 done/active/pending 英文 token 直接渲染给中文用户。
function intakeStepStateLabel(locale: WorkHubLocale, state: string) {
  if (state === "done") return routeT(locale, "intake.stateDone");
  if (state === "active") return routeT(locale, "intake.stateActive");
  if (state === "pending") return routeT(locale, "intake.statePending");
  return uiHumanize(state);
}

function intakeProgressRows(vm: SessionVM, locale: WorkHubLocale) {
  return vm.question.progress
    .map((step) => `<div class="wh-r4-route-row" data-r4-intake-progress-step="${escapeHtml(step.key)}" data-r4-intake-progress-state="${escapeHtml(step.state)}">
      <strong>${escapeHtml(step.label)}</strong>
      <span class="wh-pill">${escapeHtml(intakeStepStateLabel(locale, step.state))}</span>
    </div>`)
    .join("");
}

function renderIntakeStartRouteComponent(
  locale: WorkHubLocale,
  project?: { id: string; name: string } | undefined,
  projectUnavailable?: boolean | undefined
): WebRouteComponent {
  const zh = locale === "zh-CN";
  const bootstrapPayload = {
    name: "Pilot Project",
    slug: "pilot-project",
    description: "Pilot project context created from the WorkHub intake entry."
  };
  // 带项目上下文(从项目主页「新任务」进来)：展示真实项目名、绑定到该项目、跳过「试点项目」bootstrap。
  const projectName = project ? project.name : (zh ? "试点项目" : "Pilot project");
  // 文案随是否绑定项目切换——绑定时不再说「准备试点项目」(那条 bootstrap 路径已被跳过)，避免与真实项目名自相矛盾。
  const kicker = project ? (zh ? "项目工作入口" : "Project work entry") : routeT(locale, "intake.startKicker");
  const title = project ? (zh ? `在「${project.name}」里新建任务` : `Start work in ${project.name}`) : routeT(locale, "intake.startTitle");
  const body = project
    ? (zh ? "新任务会直接绑定到这个项目，进入选项优先的需求澄清；不会改动已确认的交付物。" : "This task binds directly to this project, then opens option-first intake. It won't touch accepted deliverables.")
    : routeT(locale, "intake.startBody");
  const projectCardHeading = project ? (zh ? "项目上下文" : "Project context") : routeT(locale, "intake.startProject");
  // start 动作：有项目则带 data-s4b-project-id（browser 据此 createSession 直绑该项目、不 bootstrap）；
  // 无项目则保留原 bootstrap 负载（新建/复用「试点项目」）。两路都走 start_intake 调度。
  const startAction = project
    ? `<a class="wh-btn wh-btn-primary" href="/api/projects/bootstrap" data-action-id="start_intake" data-method="POST" data-s1-day0-start-intake="true" data-s4b-project-id="${escapeHtml(project.id)}">${escapeHtml(routeT(locale, "intake.startAction"))}</a>`
    : `<a class="wh-btn wh-btn-primary" href="/api/projects/bootstrap" data-action-id="start_intake" data-method="POST" data-s1-day0-start-intake="true" data-request-json="${jsonAttr(bootstrapPayload)}">${escapeHtml(routeT(locale, "intake.startAction"))}</a>`;
  // 来自的项目无法访问(已删/无权限/旧链接)时不静默切换：给一条明确提示，再退化为通用起点。
  const unavailableNotice = projectUnavailable
    ? `<p class="wh-subtle" data-s4b-project-unavailable="true">${escapeHtml(zh ? "你来自的项目暂时不可用（可能已删除或无访问权限），已切换到通用工作起点。" : "The project you came from is unavailable (deleted or no access); switched to a generic work start.")}</p>`
    : "";
  return createWebRouteComponent({
    key: "intake",
    css: webRouteComponentCss,
    primaryHrefs: ["/api/projects/bootstrap"],
    source: "project-bootstrap",
    locale,
    pageVm: "project_bootstrap",
    html: `<section class="wh-r4-route" data-r4-route-component="intake" data-r4-route-component-source="project-bootstrap" data-r4-route-component-locale="${escapeHtml(locale)}" data-s1-day0-intake-start="true"${project ? ` data-s4b-intake-project="${escapeHtml(project.id)}"` : ""}>
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(kicker)}</span>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(body)}</p>
        </div>
        <span class="wh-r4-route-count" data-r8-intake-badge="true">${escapeHtml(zh ? "新任务" : "New")}</span>
      </header>
      ${unavailableNotice}
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-s1-day0-project-context-card="true">
          <h3>${escapeHtml(projectCardHeading)}</h3>
          <div class="wh-r4-route-meta">
            <span class="wh-pill" data-s4b-intake-project-name="${escapeHtml(projectName)}">${escapeHtml(projectName)}</span>
            <span class="wh-pill">${escapeHtml(zh ? "实时数据" : "Live data")}</span>
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
              <div class="wh-r4-route-row"><strong>${escapeHtml(projectCardHeading)}</strong><span class="wh-pill">${escapeHtml(zh ? "已就绪" : "Ready")}</span></div>
              <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "intake.summary"))}</strong><span class="wh-pill">${escapeHtml(zh ? "待进行" : "Next")}</span></div>
            </div>
            <p>${escapeHtml(routeT(locale, "intake.startEvidence"))}</p>
          </section>
        </aside>
      </div>
      <div class="wh-r4-route-actions">
        ${startAction}
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
      // 选项药丸：推荐项显示「推荐」；否则有风险提示就显示本地化风险等级。
      // 此前回退到 option.risk_hint(裸 low/medium 枚举)甚至 question.input_mode(字面 "confirm"),
      // 让一无所知用户在 AI 让他二选一的卡片上读到内部 token——无提示时干脆不渲药丸。
      const pillText = recommended.has(option.id)
        ? goldPathT(locale, "intake.recommended")
        : option.risk_hint
          ? localizedEnumLabel(
              option.risk_hint,
              locale === "zh-CN",
              { low: "低风险", medium: "中风险", high: "高风险" },
              { low: "Low risk", medium: "Medium risk", high: "High risk" }
            )
          : "";
      const pill = pillText
        ? `<div class="wh-r4-route-meta"><span class="wh-pill">${escapeHtml(pillText)}</span></div>`
        : "";
      return `<button class="wh-card wh-r4-route-card" type="button" data-option-id="${escapeHtml(option.id)}" data-intake-option-id="${escapeHtml(option.id)}" data-intake-option-selected="false" data-intake-option-mode="${escapeHtml(question.input_mode)}" data-intake-option-multi="${escapeHtml(String(allowMulti))}" data-recommended="${escapeHtml(String(recommended.has(option.id)))}">
        ${pill}
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
  // L11：进度速览卡别把内部管道(SSE topic / stream_href)当药丸暴露给用户;改显「当前在澄清哪一步」这种人话。
  const activeStepLabel = question.progress.find((step) => step.state === "active")?.label ?? "";
  const createAction = question.input_mode === "confirm"
    ? `<a class="wh-btn wh-btn-primary" href="/api/workitems" data-action-id="create_workitem" data-method="POST" data-intake-create-workitem="true" data-session-id="${escapeHtml(vm.session_id)}" data-request-json="${jsonAttr(createPayload)}">${escapeHtml(routeT(locale, "intake.createWorkItem"))}</a>`
    : "";
  // L16：澄清步骤里「继续」常是用户唯一的前进按钮（非 confirm 步没有「创建任务」主按钮）。
  // 当它是唯一前进动作时给它主按钮样式，别让第一道问题的前进键看着像被弱化的次要按钮；
  // 到了 confirm 步则让位给「创建任务」主按钮，自身回落为次要。
  const continueClass = createAction ? "wh-btn" : "wh-btn wh-btn-primary";

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
          <h1>${escapeHtml(question.title)}</h1>
          <p>${escapeHtml(question.body ?? goldPathT(locale, "intake.bodyFallback"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(question.options.length))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-r4-route-stack" data-r4-intake-options="true" data-r4-intake-allow-multi="${escapeHtml(String(allowMulti))}">
          ${optionCards}
        </section>
        <aside class="wh-r4-route-stack">
          <section class="wh-card wh-r4-route-card" data-r4-intake-progress="true">
            <h3>${escapeHtml(routeT(locale, "intake.progress"))}</h3>
            ${activeStepLabel ? `<p class="wh-subtle" data-r4-intake-active-step="true">${escapeHtml(locale === "zh-CN" ? `当前：${activeStepLabel}` : `Now: ${activeStepLabel}`)}</p>` : ""}
            <div class="wh-r4-route-timeline">${intakeProgressRows(vm, locale)}</div>
          </section>
        </aside>
      </div>
      ${freeText}
      <div class="wh-r4-route-actions">
        <a class="${continueClass}" href="${escapeHtml(safeHref(question.submit.href))}" data-action-id="intake_continue" data-method="${escapeHtml(question.submit.method)}" data-intake-submit="next-question" data-session-id="${escapeHtml(vm.session_id)}" data-request-json="${jsonAttr(continuePayload)}">${escapeHtml(routeT(locale, "intake.continue"))}</a>
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

// #13：审批请求状态(pending/approved/denied/expired/delegated)右栏事实区原样吐枚举 token,这里本地化。
function approvalRequestStatusLabel(status: string, zh: boolean): string {
  return localizedEnumLabel(
    status,
    zh,
    { pending: "待处理", approved: "已通过", denied: "已打回", expired: "已过期", delegated: "已转交" },
    { pending: "Pending", approved: "Approved", denied: "Denied", expired: "Expired", delegated: "Delegated" }
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
  const commentsOverflow = detail?.comments_page_info?.has_more
    ? `<p class="wh-subtle" data-r4-approval-comments-overflow="true">${escapeHtml(goldPathT(locale, "approvals.commentsOverflow"))}</p>`
    : "";
  const commentsSection = `<section data-r4-approval-discussion="true"><h4>${escapeHtml(goldPathT(locale, "approvals.discussionTitle"))}</h4>${commentsOverflow}${comments.length
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

function approvalPendingDisplayCount(vm: ApprovalCenterVM) {
  const total = vm.counts["pending_total"];
  if (typeof total === "number" && Number.isFinite(total)) {
    return Math.max(0, total);
  }
  return vm.counts["pending"] ?? vm.items.length;
}

function approvalNextPageHref(pageInfo: ApprovalCenterVM["page_info"]) {
  if (!pageInfo?.has_more) {
    return "";
  }
  const offset = Math.max(0, pageInfo.offset ?? 0);
  const limit = Math.max(1, pageInfo.limit);
  const nextOffset = offset + Math.max(pageInfo.returned, limit);
  const params = new URLSearchParams({ offset: String(nextOffset) });
  if (limit !== 100) {
    params.set("limit", String(limit));
  }
  return `/approvals?${params.toString()}`;
}

function renderApprovalsRouteComponent(vm: ApprovalCenterVM, locale: WorkHubLocale): WebRouteComponent {
  const zh = locale === "zh-CN";
  // 零审批时不渲三栏 master-detail——否则详情栏「左边选一条」无可选、右栏「你来拍板」重复同句、
  // 「审批事实: 未路由」是对不存在选择的怪占位(扮一无所知用户复审发现)。改渲一张安心空态卡 + 通用规则卡,
  // 仍是审批路由组件、仍在产品外壳内(保留左导航),不塌成通用空卡。
  if (vm.items.length === 0) {
    return createWebRouteComponent({
      key: "approvals",
      css: webRouteComponentCss,
      primaryHrefs: [],
      source: "page-vm",
      locale,
      pageVm: "approvals",
      html: `<section class="wh-r4-route" data-r4-route-component="approvals" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r4-approval-pending="0" data-r4-approval-empty="true">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "approvals.kicker"))}</span>
          <h1>${escapeHtml(goldPathT(locale, "approvals.emptyTitle"))}</h1>
          <p>${escapeHtml(goldPathT(locale, "approvals.reasonFallback"))}</p>
        </div>
        <span class="wh-r4-route-count">0</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-approval-empty-card="true">
          <p>${escapeHtml(zh ? "有需要你拍板的，Cuu 会第一时间端到这里；先安心忙别的吧 (=^･ω･^=)" : "When something needs your call, Cuu will bring it here first — carry on for now (=^･ω･^=)")}</p>
        </section>
        <section class="wh-card wh-r4-route-card">
          <h3>${escapeHtml(goldPathT(locale, "approvals.ruleTitle"))}</h3>
          <p>${escapeHtml(goldPathT(locale, "approvals.ruleText"))}</p>
        </section>
      </div>
    </section>`
    });
  }
  const primary = vm.items[0];
  const pendingCount = approvalPendingDisplayCount(vm);
  const pageInfoNote = approvalQueuePageInfoText(locale, vm.page_info, vm.counts);
  const nextPageHref = approvalNextPageHref(vm.page_info);
  const pageInfoAttrs = vm.page_info
    ? ` data-r4-approval-page-info="true" data-r4-approval-page-limit="${escapeHtml(String(vm.page_info.limit))}" data-r4-approval-page-offset="${escapeHtml(String(vm.page_info.offset ?? 0))}" data-r4-approval-page-returned="${escapeHtml(String(vm.page_info.returned))}" data-r4-approval-page-has-more="${escapeHtml(String(vm.page_info.has_more))}"`
    : "";
  const nextPageAction = nextPageHref
    ? `<div class="wh-r4-route-actions"><a class="wh-btn" href="${escapeHtml(safeHref(nextPageHref))}" data-r4-approval-load-more="true" data-r4-approval-next-page-href="${escapeHtml(safeHref(nextPageHref))}">${escapeHtml(zh ? "查看更多审批" : "Load more approvals")}</a></div>`
    : "";
  // E4：删掉右栏那张独立「截止时间」卡——它绑定到 primary(首项)且服务端烘焙,客户端切换审批项时
  // 只换了详情面板与按钮 href,这张卡不更新 → 选了 B 仍显 A 的 SLA(和正确的每行 SLA 药丸打架)。
  // SLA 已在左栏每行药丸(选中行高亮)+ 详情时间线每步 SLA 里如实显示,这张卡纯冗余,移除即消除陈旧。
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
        <strong>${escapeHtml(approvalActionLabel(item.action_pattern, locale))}</strong>
        <p>${escapeHtml(approvalRequestStatusLabel(item.status, locale === "zh-CN"))}${item.sla_due_at ? ` · SLA ${escapeHtml(formatApprovalTimestamp(item.sla_due_at))}` : ""}</p>
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
    html: `<section class="wh-r4-route" data-r4-route-component="approvals" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r4-approval-pending="${escapeHtml(String(pendingCount))}"${pageInfoAttrs}>
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "approvals.kicker"))}</span>
          <h1>${escapeHtml(primary?.title ?? goldPathT(locale, "approvals.emptyTitle"))}</h1>
          <p>${escapeHtml(primary?.reason_text ?? goldPathT(locale, "approvals.reasonFallback"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(pendingCount))}</span>
      </header>
      ${pageInfoNote ? `<p class="wh-subtle" data-r4-approval-page-info-note="true">${escapeHtml(pageInfoNote)}</p>` : ""}
      ${nextPageAction}
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
            <label class="wh-r4-approval-remember"><input type="checkbox" data-r4-approval-remember /> <span>${escapeHtml(goldPathT(locale, "approvals.rememberLabel"))}</span></label>
            <p class="wh-subtle" data-r4-approval-remember-help="true">${escapeHtml(goldPathT(locale, "approvals.rememberHelp"))}</p>` : ""}
          </section>
          <section class="wh-card wh-r4-route-card">
            <h3>${escapeHtml(goldPathT(locale, "approvals.ruleTitle"))}</h3>
            <p>${escapeHtml(goldPathT(locale, "approvals.ruleText"))}</p>
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

// L22：空轨迹/空交付物文案必须看状态。一条「已完成 / 已采纳 / 已取消 / 需要负责人介入」却没留下轨迹的
// 任务，再说「AI 已准备好，下一步会开始读取证据」就和状态徽标直接打架——一无所知的用户没法把「已完成」
// 和「AI 即将开始」对上。终态/升级态给出贴合状态的说明，乐观文案只留给真正还在推进的状态。
function emptyTraceCopy(status: string, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  if (status === "done" || status === "merged") {
    return zh ? "这条任务已结束，没有记录到 AI 执行步骤。" : "This work item is finished; no AI execution steps were recorded.";
  }
  if (status === "cancelled") {
    return zh ? "这条任务已取消，没有执行步骤。" : "This work item was cancelled; there are no execution steps.";
  }
  if (status === "escalated") {
    return zh ? "已升级给负责人接手，暂无 AI 执行步骤。" : "Escalated to an owner to take over; no AI steps yet.";
  }
  return uiT(locale, "workitem.emptyTrace");
}

function emptyDeliverableCopy(status: string, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  if (status === "done" || status === "merged") {
    return zh ? "这条任务已结束，没有待审批的交付物。" : "This work item is finished; nothing is awaiting approval.";
  }
  if (status === "cancelled") {
    return zh ? "这条任务已取消，没有交付物。" : "This work item was cancelled; there is no deliverable.";
  }
  if (status === "escalated") {
    return zh ? "已升级给负责人，暂无可供审批的交付物。" : "Escalated to an owner; no deliverable to approve yet.";
  }
  return uiT(locale, "workitem.willReadEvidence");
}

function traceRows(vm: WorkItemDetailVM, locale: WorkHubLocale) {
  if (vm.agent_trace_preview.length === 0) {
    return `<p class="wh-subtle" data-r4-workitem-empty-trace-status="${escapeHtml(vm.workitem.status)}">${escapeHtml(emptyTraceCopy(vm.workitem.status, locale))}</p>`;
  }
  return vm.agent_trace_preview.slice(0, 5)
    .map((step) => `<div class="wh-r4-route-row" data-r4-workitem-trace-step="${escapeHtml(step.id)}">
      <div>
        <strong>${escapeHtml(`${step.step_no}. ${agentStepPhaseLabel(locale, step.phase)}`)}</strong>
        <p>${escapeHtml(agentStepPublicSummary(locale, step))}</p>
      </div>
      <span class="wh-pill">${escapeHtml(formatApprovalTimestamp(step.created_at) || agentStepPhaseLabel(locale, step.phase))}</span>
    </div>`)
    .join("");
}

function workItemActions(vm: WorkItemDetailVM, locale: WorkHubLocale): ActionSpec[] {
  const proposalId = vm.latest_proposal?.proposal_id;
  const runId = vm.agent_trace_preview[0]?.agent_run_id;
  const canDraftTaskPlan =
    vm.workitem.status === "spec_ready" &&
    !proposalId &&
    !vm.task_plan &&
    !vm.agent_team &&
    vm.agent_trace_preview.length === 0;
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
    canDraftTaskPlan
      ? {
        id: "create_task_plan",
        label: routeT(locale, "workitem.createTaskPlan"),
        method: "POST" as const,
        href: `/api/workitems/${vm.workitem.id}/task-plan`
      }
      : undefined
  ];
  return actions.filter((action): action is ActionSpec => Boolean(action));
}

function taskPlanDependencyLabel(plan: TaskPlanVM, item: TaskPlanVM["items"][number], locale: WorkHubLocale) {
  if (item.depends_on.length === 0) {
    return locale === "zh-CN" ? "无依赖" : "No dependencies";
  }
  const sequenceById = new Map(plan.items.map((candidate, index) => [candidate.id, index + 1]));
  return item.depends_on
    .map((id) => {
      const seq = sequenceById.get(id);
      return seq ? `#${seq}` : (locale === "zh-CN" ? "未知" : "Unknown");
    })
    .join(", ");
}

// B-R9.6 UX 审计（H1 卡位）：同一个卡位按数据形态切换，不双渲。军团已获批/推进/暂停/终态
// → 军团面板；草稿/待审/已取消（或无军团）→ 计划快照面板（含审批黄条/已取消状态 pill）。
const AGENT_TEAM_PANEL_STATUSES = new Set(["approved", "dispatching", "paused", "done"]);

function renderWorkItemPlanSlot(
  vm: WorkItemDetailVM,
  latestProposal: WorkItemDetailVM["latest_proposal"],
  locale: WorkHubLocale
) {
  if (vm.agent_team && AGENT_TEAM_PANEL_STATUSES.has(vm.agent_team.status)) {
    return renderAgentTeamPanel(vm.agent_team, locale);
  }
  return renderTaskPlanPanel(vm.task_plan, latestProposal, locale);
}

function renderTaskPlanPanel(
  plan: TaskPlanVM | undefined,
  latestProposal: WorkItemDetailVM["latest_proposal"],
  locale: WorkHubLocale
) {
  if (!plan) {
    return "";
  }
  const waitingForApproval = plan.status === "draft" || plan.status === "proposed";
  const reviewHref = latestProposal?.proposal_id ? `/proposals/${latestProposal.proposal_id}` : undefined;
  const reviewBanner = waitingForApproval
    ? `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r9-task-plan-awaiting-approval="true">
        <strong>${escapeHtml(locale === "zh-CN" ? "计划等你批准" : "Plan awaiting approval")}</strong>
        ${reviewHref ? `<a class="wh-pill" href="${escapeHtml(safeHref(reviewHref))}">${escapeHtml(locale === "zh-CN" ? "去审批" : "Review")}</a>` : ""}
      </div>`
    : "";
  const rows = plan.items.length
    ? plan.items.map((item, index) => {
        const dependsLabel = taskPlanDependencyLabel(plan, item, locale);
        const displaySeq = index + 1;
        return `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r9-task-plan-item="${escapeHtml(item.id)}" data-r9-task-plan-role="${escapeHtml(item.role)}" data-r9-task-plan-budget="${escapeHtml(String(item.budget_share_pct))}" data-r9-task-plan-depends="${escapeHtml(dependsLabel)}">
          <div>
            <strong>${escapeHtml(`${displaySeq}. ${item.title}`)}</strong>
            <p>${escapeHtml(item.acceptance_md)}</p>
          </div>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(taskPlanItemRoleLabel(locale, item.role))}</span>
            <span class="wh-pill">${escapeHtml(taskPlanItemStatusLabel(locale, item.status))}</span>
            <span class="wh-pill">${escapeHtml(`${item.budget_share_pct}%`)}</span>
            <span class="wh-pill">${escapeHtml(dependsLabel)}</span>
          </div>
        </div>`;
      }).join("")
    : `<p class="wh-subtle">${escapeHtml(locale === "zh-CN" ? "暂无子任务。" : "No subtasks yet.")}</p>`;
  const capped = plan.items_capped
    ? `<p class="wh-subtle" data-r9-task-plan-items-capped-note="true">${escapeHtml(locale === "zh-CN" ? "仅显示前 50 个子任务。" : "Showing the first 50 subtasks.")}</p>`
    : "";
  return `<section class="wh-card wh-r4-route-card" data-r9-task-plan-panel="true" data-r9-task-plan-status="${escapeHtml(plan.status)}" data-r9-task-plan-items-capped="${escapeHtml(String(plan.items_capped))}">
    <h3>${escapeHtml(locale === "zh-CN" ? "任务计划" : "Task plan")}</h3>
    <div class="wh-r4-route-meta">
      <span class="wh-pill">${escapeHtml(taskPlanStatusLabel(locale, plan.status))}</span>
      <span class="wh-pill">${escapeHtml(uiCount(locale, plan.items.length, "个子任务", "subtask"))}</span>
    </div>
    ${reviewBanner}
    <div class="wh-r4-route-timeline">${rows}</div>
    ${capped}
  </section>`;
}

function agentTeamTitle(team: WorkItemAgentTeamVM, locale: WorkHubLocale) {
  const ratio = `${team.completed_count}/${team.total_count}`;
  if (team.status === "done") {
    // 有子任务没成也喊「已完成」是撒谎——差额时明说部分完成。
    return team.completed_count < team.total_count
      ? (locale === "zh-CN" ? `军团部分完成 ${ratio}` : `Team partially done ${ratio}`)
      : (locale === "zh-CN" ? `军团已完成 ${ratio}` : `Team completed ${ratio}`);
  }
  // B-R9.6 §3.1：暂停态要在头行说清楚——否则用户按了暂停，面板还喊「推进中」在撒谎。
  if (team.status === "paused") {
    return locale === "zh-CN" ? `军团已暂停 ${ratio}` : `Team paused ${ratio}`;
  }
  if (team.status === "approved") {
    return locale === "zh-CN" ? `军团待出发 ${ratio}` : `Team ready ${ratio}`;
  }
  return locale === "zh-CN" ? `军团推进中 ${ratio}` : `Team in progress ${ratio}`;
}

function agentTeamItemStatusLabel(status: WorkItemAgentTeamVM["items"][number]["status"], locale: WorkHubLocale) {
  const labels: Record<WorkItemAgentTeamVM["items"][number]["status"], { "zh-CN": string; "en-US": string }> = {
    pending: { "zh-CN": "待开始", "en-US": "Waiting" },
    dispatched: { "zh-CN": "进行中", "en-US": "In progress" },
    succeeded: { "zh-CN": "已成功", "en-US": "Succeeded" },
    failed: { "zh-CN": "失败", "en-US": "Failed" },
    needs_human: { "zh-CN": "等你决定", "en-US": "Needs decision" },
    skipped: { "zh-CN": "已跳过", "en-US": "Skipped" }
  };
  return labels[status][locale];
}

function renderAgentTeamPanel(team: WorkItemAgentTeamVM | undefined, locale: WorkHubLocale) {
  if (!team) {
    return "";
  }
  const burnPct = team.cost_burn_pct ?? 0;
  const burnTone = burnPct > 100 ? "danger" : burnPct >= 70 ? "warning" : "ok";
  const burnStyle = `width:${Math.min(Math.max(burnPct, 0), 100)}%`;
  const rows = team.items.length
    ? team.items.map((item) => {
        const traceLink = !item.action && item.replay_href
          ? `<a class="wh-pill" href="${escapeHtml(safeHref(item.replay_href))}" data-r9-agent-team-trace="${escapeHtml(item.task_plan_item_id)}">${escapeHtml(locale === "zh-CN" ? "看轨迹" : "View trace")}</a>`
          : "";
        const waiting = item.waiting_for_seq.length
          ? `<p>${escapeHtml(locale === "zh-CN" ? `等待 ${item.waiting_for_seq.map((seq) => `#${seq}`).join(", ")} 完成` : `Waiting for ${item.waiting_for_seq.map((seq) => `#${seq}`).join(", ")}`)}</p>`
          : "";
        const action = item.action
          ? `<a class="wh-pill" href="${escapeHtml(safeHref(item.action.href))}" data-r9-agent-team-action="${escapeHtml(item.action.kind)}">${escapeHtml(item.action.label)}</a>`
          : "";
        const cost = item.cost_estimate_cny
          ? `<span class="wh-pill">${escapeHtml(uiFormatCny(item.cost_estimate_cny))}</span>`
          : "";
        return `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r9-agent-team-item="${escapeHtml(item.task_plan_item_id)}" data-r9-agent-team-status="${escapeHtml(item.status)}" data-r9-agent-team-role="${escapeHtml(item.role)}"${item.waiting_for_seq.length ? ' data-r9-agent-team-waiting="true"' : ""}>
          <div>
            <strong>${escapeHtml(`#${item.seq} ${item.title}`)}</strong>
            ${waiting}
          </div>
          <div class="wh-r4-route-meta">
            <span class="wh-pill" data-r9-agent-team-state-dot="${escapeHtml(item.status)}">●</span>
            <span class="wh-pill">${escapeHtml(taskPlanItemRoleLabel(locale, item.role))}</span>
            <span class="wh-pill">${escapeHtml(agentTeamItemStatusLabel(item.status, locale))}</span>
            ${cost}
            ${action}
            ${traceLink}
          </div>
        </div>`;
      }).join("")
    : `<p class="wh-subtle">${escapeHtml(locale === "zh-CN" ? "暂无子运行。" : "No child runs yet.")}</p>`;
  const capped = team.runs_capped
    ? `<p class="wh-subtle" data-r9-agent-team-runs-capped-note="true">${escapeHtml(locale === "zh-CN" ? "仅显示前 100 个子运行。" : "Showing the first 100 child runs.")}</p>`
    : "";
  // UX-M13（规格 §1.2）：有子任务等人拍板时面板顶部黄条——「N 个子任务需要你拍板 → 去决策」，
  // 处理完（needs_human 清零）黄条自然消失。
  const needsHumanCount = team.items.filter((item) => item.status === "needs_human").length;
  const decisionBanner = needsHumanCount > 0
    ? `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r9-agent-team-banner="needs_human" data-r9-task-plan-awaiting-approval="true">
        <strong>${escapeHtml(locale === "zh-CN" ? `${needsHumanCount} 个子任务需要你拍板` : `${needsHumanCount} subtask${needsHumanCount === 1 ? "" : "s"} need${needsHumanCount === 1 ? "s" : ""} your decision`)}</strong>
        <a class="wh-pill" href="/attention">${escapeHtml(locale === "zh-CN" ? "去决策" : "Decide")}</a>
      </div>`
    : "";
  // UX-M2（规格 §3.1 尾行）：终态复盘摘要一行——成功/失败/跳过/花费。复盘专页尚不存在，
  // 只给诚实的数字行，不放假「查看复盘」链接。
  const retroLine = team.status === "done"
    ? (() => {
      const succeeded = team.items.filter((item) => item.status === "succeeded").length;
      const failed = team.items.filter((item) => item.status === "failed").length;
      const skipped = team.items.filter((item) => item.status === "skipped").length;
      const summary = locale === "zh-CN"
        ? `复盘：成功 ${succeeded} · 失败 ${failed} · 跳过 ${skipped} · 花费 ${uiFormatCny(team.cost_used_cny)}`
        : `Retro: ${succeeded} succeeded · ${failed} failed · ${skipped} skipped · spent ${uiFormatCny(team.cost_used_cny)}`;
      return `<p class="wh-subtle" data-r9-agent-team-retro="true">${escapeHtml(summary)}</p>`;
    })()
    : "";
  // B-R9.6 §3.1：头行「暂停派发/恢复派发」次级按钮——VM 给控制才渲，终态军团无按钮。
  const dispatchControl = team.dispatch_control
    ? `<a class="wh-btn" href="${escapeHtml(safeHref(team.dispatch_control.href))}" data-method="${escapeHtml(team.dispatch_control.method)}" data-action-id="${escapeHtml(`${team.dispatch_control.kind}_dispatch`)}" data-r9-agent-team-dispatch-control="${escapeHtml(team.dispatch_control.kind)}" title="${escapeHtml(team.dispatch_control.kind === "pause"
      ? (locale === "zh-CN" ? "只停新派发；在跑的子任务会跑完，不会被打断。" : "Stops new dispatches only; running subtasks finish unharmed.")
      : (locale === "zh-CN" ? "就绪的子任务会立即继续派出。" : "Ready subtasks resume dispatching immediately."))}">${escapeHtml(team.dispatch_control.label)}</a>`
    : "";
  return `<section class="wh-card wh-r4-route-card" data-r9-agent-team-panel="true" data-r9-agent-team-plan-id="${escapeHtml(team.plan_id)}" data-r9-agent-team-status="${escapeHtml(team.status)}">
    <div class="wh-r4-route-card-head">
      <h3>${escapeHtml(agentTeamTitle(team, locale))}</h3>
      ${dispatchControl}
    </div>
    ${decisionBanner}
    <div class="wh-r4-route-meta">
      <span class="wh-pill">${escapeHtml(uiFormatCny(team.cost_used_cny))}</span>
      ${team.cost_budget_cny ? `<span class="wh-pill">${escapeHtml(`${burnPct}%`)}</span>` : ""}
    </div>
    ${team.cost_budget_cny ? `<div class="wh-r4-route-meter" data-r9-agent-team-burn="${escapeHtml(burnTone)}" aria-label="${escapeHtml(`${burnPct}%`)}"><span style="${escapeHtml(burnStyle)}"></span></div>` : ""}
    <div class="wh-r4-route-timeline">${rows}</div>
    ${retroLine}
    ${capped}
  </section>`;
}

// M15：某些状态(已升级/进行中/待审阅/终态…)在无变更申请、无运行、非待派活时本就没有用户动作。
// 别留一个零按钮零说明的死卡——按状态给一句「为什么没动作 + 接下来会怎样」的说明。
function workItemActionHint(status: string, zh: boolean): string {
  const map: Record<string, [string, string]> = {
    intake: ["AI 正在接收这条需求，稍后会请你澄清。", "AI is taking in this request; it will ask you to clarify soon."],
    ai_clarifying: ["AI 正在和你澄清需求，去「提需求」入口继续。", "AI is clarifying with you — continue from the intake flow."],
    in_progress: ["AI 正在处理，有进展会更新到这里。", "AI is working on this; progress will appear here."],
    in_review: ["等待审阅，相关变更会以审批 / 变更申请的形式找你。", "Awaiting review — changes will reach you as an approval / change request."],
    // 普通用户审查：升级恰恰是「需要人拿主意」的状态，写「无需你额外操作」在撒谎——重试/接手按钮在收件箱。
    escalated: ["AI 卡住了，需要有人拿主意——去首页收件箱处理（可让它重试/转成我来做/取消）。", "The AI is stuck and needs a human call — handle it from the home inbox (retry / take over / cancel)."],
    delivery_ready: ["交付物已就绪，等待采纳。", "The deliverable is ready, awaiting acceptance."],
    accepted: ["这条已采纳。", "This one was accepted."],
    done: ["这条已完成。", "This one is done."],
    cancelled: ["这条已取消。", "This one was cancelled."]
  };
  const entry = map[status];
  return entry ? (zh ? entry[0] : entry[1]) : (zh ? "暂时没有需要你操作的动作。" : "Nothing needs your action right now.");
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
      <span class="wh-pill">${escapeHtml(meetingInsightKindLabel(source.insight_kind, locale === "zh-CN"))}</span>
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
    : `<p class="wh-subtle" data-r4-workitem-empty-deliverable-status="${escapeHtml(vm.workitem.status)}">${escapeHtml(emptyDeliverableCopy(vm.workitem.status, locale))}</p>`;

  return createWebRouteComponent({
    key: "workitem",
    css: webRouteComponentCss,
    primaryHrefs: actions.map((action) => action.href),
    source: "page-vm",
    locale,
    pageVm: "workitem",
    html: `<section class="wh-r4-route" data-r4-route-component="workitem" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r4-workitem-id="${escapeHtml(vm.workitem.id)}" data-r4-workitem-trace-count="${escapeHtml(String(vm.agent_trace_preview.length))}" data-r4-workitem-evidence-count="${escapeHtml(String(vm.evidence_refs.length))}" data-r4-workitem-acceptance-count="${escapeHtml(String(vm.acceptance.length))}" data-r4-workitem-deliverable-count="${escapeHtml(String(latestProposal?.changes.length ?? 0))}">
      <header class="wh-r4-route-head">
        <div>
          ${vm.project_name && vm.workitem.project_id ? `<a class="wh-r4-route-kicker" href="${escapeHtml(safeHref(`/projects/${vm.workitem.project_id}`))}" data-r4-workitem-project-link="${escapeHtml(vm.workitem.project_id)}">← ${escapeHtml(vm.project_name)}</a>` : `<span class="wh-r4-route-kicker">${escapeHtml(uiT(locale, "workitem.kicker"))}</span>`}
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(summary)}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(vm.agent_team && AGENT_TEAM_PANEL_STATUSES.has(vm.agent_team.status)
          ? agentTeamTitle(vm.agent_team, locale)
          : workItemStatusLabel(locale, vm.workitem.status))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-workitem-context="true">
          <h3>${escapeHtml(routeT(locale, "workitem.context"))}</h3>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(vm.workitem.code)}</span>
            <span class="wh-pill">${escapeHtml(attentionPriorityLabel(vm.workitem.priority, locale === "zh-CN"))}</span>
            <span class="wh-pill">${escapeHtml(localizedEnumLabel(vm.workitem.mode, locale === "zh-CN", { worker: "执行", pm: "项目管理" }, { worker: "Worker", pm: "PM" }))}</span>
          </div>
          ${(() => {
    // L25：上下文卡正文别和头部 summary 重复(都源自 raw_description 时)；两者都空也别渲一个空 <p>。
    const body = vm.workitem.planning_note ?? vm.workitem.raw_description ?? "";
    return body && stripMarkdown(body) !== summary ? `<p>${escapeHtml(body)}</p>` : "";
  })()}
          ${renderWorkItemSourceContext(vm, locale)}
          ${actions.length
    ? renderActions(actions)
    : `<p class="wh-subtle" data-r4-workitem-action-hint="${escapeHtml(vm.workitem.status)}">${escapeHtml(workItemActionHint(vm.workitem.status, locale === "zh-CN"))}</p>`}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-workitem-deliverables="true">
          <h3>${escapeHtml(routeT(locale, "workitem.deliverables"))}</h3>
          <div class="wh-r4-route-timeline">${deliverableRows}</div>
        </section>
      </div>
      ${renderWorkItemPlanSlot(vm, latestProposal, locale)}
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
  if (vm.status === "opened") {
    return [vm.review_actions.approve, vm.review_actions.request_changes];
  }
  if (vm.status === "reviewed" && vm.review_actions.merge) {
    return [
      vm.review_actions.merge,
      ...(vm.review_actions.approve_hold ? [vm.review_actions.approve_hold] : [])
    ];
  }
  return [];
}

// R9.1 workbench-read：计划提议的行级子任务视图（序号/角色徽章/标题/验收/预算份额/依赖）。
// 数据源=manifest machine_summary.task_plan_items（7.154 打通的结构化清单），markdown 只是摘要。
// UX-L（integrate 泄英文）：自造三角色表漏了 integrate，中文界面渲「Integrate」。
// 改走 canonical i18n 角色表（四角色齐），未知值才回退 humanizeToken。
function taskPlanItemRoleBadge(role: string, locale: WorkHubLocale): string {
  if (role === "research" || role === "produce" || role === "review" || role === "integrate") {
    return taskPlanItemRoleLabel(locale, role);
  }
  return humanizeToken(role);
}

function renderTaskPlanItemsPanel(vm: ProposalDetailVM, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  const planChange = vm.manifest.changes.find((change) =>
    change.target_kind === "structured_record" && change.target_ref.entity_type === "task_plan");
  const items = planChange?.machine_summary?.task_plan_items ?? [];
  if (items.length === 0) {
    return "";
  }
  const ordered = [...items].sort((a, b) => a.seq - b.seq);
  const seqById = new Map(ordered.map((item, index) => [item.id, index + 1]));
  const rows = ordered.map((item, index) => {
    const deps = (item.depends_on ?? [])
      .map((dependencyId) => seqById.get(dependencyId))
      .filter((seq): seq is number => typeof seq === "number")
      .map((seq) => `#${seq}`);
    return `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r9-plan-item="${escapeHtml(item.id)}" data-r9-plan-item-role="${escapeHtml(item.role)}">
      <div>
        <strong>#${index + 1} ${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(zh ? "验收：" : "Acceptance: ")}${escapeHtml(item.acceptance_md)}</p>
      </div>
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(taskPlanItemRoleBadge(item.role, locale))}</span>
        <span class="wh-pill" data-r9-plan-item-share="${escapeHtml(String(item.budget_share_pct))}">${escapeHtml(zh ? `预算 ${item.budget_share_pct}%` : `Budget ${item.budget_share_pct}%`)}</span>
        ${deps.length ? `<span class="wh-pill">${escapeHtml(zh ? `依赖 ${deps.join(" ")}` : `Depends on ${deps.join(" ")}`)}</span>` : ""}
      </div>
    </div>`;
  }).join("");
  // §3.2 防呆（读侧红字）：份额和 ≠100% 时如实标红——「批准并派发」的硬门在合入事务里。
  const totalShare = ordered.reduce((sum, item) => sum + item.budget_share_pct, 0);
  const shareNote = totalShare === 100
    ? `<p class="wh-subtle" data-r9-plan-share-total="100">${escapeHtml(zh ? "预算份额合计 100%。" : "Budget shares add up to 100%.")}</p>`
    : `<p class="wh-pill-danger" data-r9-plan-share-total="${escapeHtml(String(totalShare))}" data-r9-plan-share-invalid="true">${escapeHtml(zh
      ? `预算份额加起来是 ${totalShare}%，${totalShare < 100 ? `还差 ${100 - totalShare}%` : `超出 ${totalShare - 100}%`}，修正后才能批准并派发。`
      : `Budget shares add up to ${totalShare}%, ${totalShare < 100 ? `${100 - totalShare}% short` : `${totalShare - 100}% over`} — fix them before approving and dispatching.`)}</p>`;
  return `<section class="wh-card wh-r4-route-card" data-r9-plan-items="true" data-r9-plan-item-count="${escapeHtml(String(ordered.length))}">
      <h3>${escapeHtml(zh ? "子任务清单" : "Subtasks")}</h3>
      <div class="wh-r4-route-timeline">${rows}</div>
      ${shareNote}
    </section>`;
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
      <span class="wh-pill">${escapeHtml(formatApprovalTimestamp(comment.created_at))}</span>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(locale === "zh-CN" ? "暂无评论" : "No comments yet")}</p>`;
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
          <h1>${escapeHtml(vm.title)}</h1>
          <p>${escapeHtml(summary)}</p>
        </div>
        <span class="wh-r4-route-count" data-r4-proposal-status="${escapeHtml(vm.status)}">${escapeHtml(proposalStatusLabel(locale, vm.status))}</span>
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
      ${renderTaskPlanItemsPanel(vm, locale)}
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

function driveResourceActionLinks(
  item: { preview_href?: string | undefined; download_href?: string | undefined },
  locale: WorkHubLocale
) {
  const links: string[] = [];
  if (item.preview_href) {
    links.push(`<a class="wh-btn" href="${escapeHtml(safeHref(item.preview_href))}" data-action-id="drive_preview" data-drive-preview-link="true">${escapeHtml(routeT(locale, "drive.preview"))}</a>`);
  }
  if (item.download_href) {
    links.push(`<a class="wh-btn" href="${escapeHtml(safeHref(item.download_href))}" data-action-id="drive_download" data-native-resource-link="true" target="_blank" rel="noreferrer">${escapeHtml(routeT(locale, "drive.download"))}</a>`);
  }
  return links;
}

function driveActionLinks(
  item: NonNullable<DrivePageVM["items"][number]["accepted_deliverable"]>,
  locale: WorkHubLocale
) {
  const links = driveResourceActionLinks(item, locale);
  if (item.restore_href) {
    links.push(`<a class="wh-btn" href="${escapeHtml(safeHref(item.restore_href))}" data-action-id="drive_restore" data-method="POST">${escapeHtml(routeT(locale, "drive.restore"))}</a>`);
  }
  const accessNotice = item.access_notice
    ? `<p class="wh-subtle" data-r5-drive-accepted-access-note="true">${escapeHtml(item.access_notice)}</p>`
    : "";
  return links.length || accessNotice ? `<div class="wh-r4-route-actions">${links.join("")}${accessNotice}</div>` : "";
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
  const selectedActiveItem = vm.items.find((item) => item.id === vm.selected_item_id);
  const selectedDeletedItem = vm.deleted_items.find((item) => item.id === vm.selected_item_id);
  const selectedItem = selectedActiveItem ?? (selectedDeletedItem || vm.requested_item_missing ? undefined : vm.items.find((item) => item.kind === "file") ?? vm.items[0]);
  const requestedMissingNotice = vm.requested_item_missing
    ? `<p class="wh-subtle" data-r9-drive-requested-missing="true">${escapeHtml(routeT(locale, "drive.requestedMissing"))}</p>`
    : "";
  const deleteTargetId = vm.actions.delete_item ? driveItemMutationIdFromHref(vm.actions.delete_item.href) : undefined;
  const deleteTarget = deleteTargetId ? vm.items.find((item) => item.id === deleteTargetId) : undefined;
  const deletePayload = {
    expected_current_version_id: deleteTarget?.current_version_id ?? null
  };
  // M8: a destructive action must name its target. The server picks the delete target
  // (most-recently-touched manual file); without its name the user can't tell what a
  // bare "移到回收站" will remove. Surface the name in the button (and a data attr the
  // browser handler echoes into the success/recovery notice).
  const deleteLabel = deleteTarget
    ? (locale === "zh-CN" ? `移到回收站：${deleteTarget.name}` : `Move “${deleteTarget.name}” to recycle`)
    : routeT(locale, "drive.delete");
  const uploadFolders = vm.items.filter((item) => item.kind === "folder");
  const selectedUploadParentId = selectedItem?.kind === "folder" ? selectedItem.id : selectedItem?.parent_id ?? "";
  const uploadParentSelect = uploadFolders.length
    ? `<select class="wh-pill" data-drive-upload-parent-select="true" aria-label="${escapeHtml(locale === "zh-CN" ? "上传到文件夹" : "Upload to folder")}"><option value="">${escapeHtml(locale === "zh-CN" ? "网盘根目录" : "Drive root")}</option>${uploadFolders.map((folder) => {
      const selected = folder.id === selectedUploadParentId ? " selected" : "";
      return `<option value="${escapeHtml(folder.id)}"${selected}>${escapeHtml(folder.name)}</option>`;
    }).join("")}</select>`
    : "";
  const driveManageActions = [
    vm.actions.upload_file ? `<span class="wh-drive-upload-control" data-drive-upload-control="true"><label class="wh-btn wh-btn-primary wh-drive-upload-label"><span>${escapeHtml(routeT(locale, "drive.upload"))}</span><input class="wh-drive-upload-input" type="file" data-drive-upload-picker="true" data-action-id="drive_upload_file" data-method="POST" data-action-href="${escapeHtml(safeHref(vm.actions.upload_file.href))}" /></label>${uploadParentSelect}</span>` : "",
    vm.actions.delete_item ? `<a class="wh-btn" href="${escapeHtml(safeHref(vm.actions.delete_item.href))}" data-action-id="drive_delete_item" data-method="POST" data-r5-drive-delete-target="${escapeHtml(deleteTargetId ?? "")}" data-r5-drive-delete-name="${escapeHtml(deleteTarget?.name ?? "")}" data-request-json="${jsonAttr(deletePayload)}">${escapeHtml(deleteLabel)}</a>` : ""
  ].filter(Boolean).join("");
  const fileRows = vm.items.length
    ? vm.items.map((item) => {
      const current = item.current_version;
      const size = current ? formatBytes(current.size_bytes, locale) : "";
      const itemHref = safeHref(`/drive?project_id=${encodeURIComponent(vm.project?.id ?? item.project_id)}&item_id=${encodeURIComponent(item.id)}`);
      const resourceActions = driveResourceActionLinks(item, locale).join("");
      return `<div class="wh-r4-route-row" data-r4-drive-item="${escapeHtml(item.id)}" data-r4-drive-item-kind="${escapeHtml(item.kind)}" data-r4-drive-item-depth="${escapeHtml(String(item.depth))}" data-r4-drive-item-selected="${escapeHtml(String(item.id === selectedItem?.id))}">
        <a class="wh-r4-drive-item-link" href="${escapeHtml(itemHref)}" data-r5-drive-item-link="true" data-r5-drive-item-link-id="${escapeHtml(item.id)}">
          <strong>${escapeHtml(item.name)}</strong>
          <p>${escapeHtml(item.path)}</p>
        </a>
        <div class="wh-r4-route-meta">
          <span class="wh-pill">${escapeHtml(driveItemKindLabel(item.kind, locale === "zh-CN"))}</span>
          ${current ? `<span class="wh-pill">v${escapeHtml(String(current.version_no))}</span>` : ""}
          ${size ? `<span class="wh-pill">${escapeHtml(size)}</span>` : ""}
          ${resourceActions}
          ${item.delete_href ? `<a class="wh-btn" href="${escapeHtml(safeHref(item.delete_href))}" data-action-id="drive_delete_item" data-method="POST" data-r5-drive-row-delete="${escapeHtml(item.id)}" data-r5-drive-delete-name="${escapeHtml(item.name)}" data-request-json="${jsonAttr({ expected_current_version_id: item.current_version_id ?? null })}">${escapeHtml(routeT(locale, "drive.delete"))}</a>` : ""}
        </div>
      </div>`;
    }).join("")
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "drive.emptyFiles"))}</p>`;
  // L9：masthead 的「文件 N」与大号标题数字用的是 file_count(不含文件夹),但文件列表渲染的是 items(文件夹+文件),
  // 数字和可见行数对不上。在列表标题上挑明「文件夹 N · 文件 M」,让标题数字与列表内容自洽。
  const driveFolderCount = vm.items.filter((item) => item.kind === "folder").length;
  const driveListedFileCount = vm.items.length - driveFolderCount;
  const driveFilesHeading = `${routeT(locale, "drive.files")} · ${locale === "zh-CN" ? `文件夹 ${driveFolderCount} · 文件 ${driveListedFileCount}` : `${driveFolderCount} folders · ${driveListedFileCount} files`}`;
  // file_count 是项目内文件总数(全量);文件树本页最多加载一批有限行。两者不等时挑明「本页只加载了前 N 个」,
  // 让顶部「文件 N」chip(总数,与项目主页一致)和列表(本页加载数)不再像「文件丢了」。
  const driveHiddenFileCount = vm.summary.file_count - driveListedFileCount;
  const driveMoreFilesNote = driveHiddenFileCount > 0
    ? `<p class="wh-subtle" data-r4-drive-more-files="${escapeHtml(String(driveHiddenFileCount))}">${escapeHtml(locale === "zh-CN" ? `本页只加载了前 ${driveListedFileCount} 个文件，共 ${vm.summary.file_count} 个。` : `Showing the first ${driveListedFileCount} of ${vm.summary.file_count} files.`)}</p>`
    : "";
  const selectedFileVersions = selectedItem?.kind === "file"
    ? vm.versions.filter((version) => version.item_id === selectedItem.id)
    : vm.versions;
  const driveVersionsHeading = selectedItem?.kind === "file"
    ? `${routeT(locale, "drive.versions")} · ${selectedItem.name}`
    : routeT(locale, "drive.versions");
  const versionRows = selectedFileVersions.length
    ? selectedFileVersions.slice(0, 8).map((version) => `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r4-drive-version="${escapeHtml(version.id)}" data-r4-drive-version-current="${escapeHtml(String(version.current))}">
      <div>
        <strong>${escapeHtml(`${version.filename} · v${version.version_no}`)}</strong>
        <p>${escapeHtml(`${formatBytes(version.size_bytes, locale)} · ${version.created_at.slice(0, 10)}`)}</p>
      </div>
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(driveVersionSourceLabel(version.source, locale === "zh-CN"))}</span>
        ${version.current ? `<span class="wh-pill">${escapeHtml(routeT(locale, "drive.current"))}</span>` : ""}
      </div>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "drive.emptyVersions"))}</p>`;
  const acceptedRows = vm.accepted_deliverables.length
    ? vm.accepted_deliverables.slice(0, 6).map((accepted) => `<article class="wh-card wh-r4-route-card" data-r4-drive-accepted-deliverable="${escapeHtml(accepted.id)}">
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(deliverableTargetLabel(locale, accepted.target_kind))}</span>
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
    : `<p class="wh-subtle">${escapeHtml(locale === "zh-CN" ? "还没有评论。写一条，之后可以让 AI 按它改文件。" : "No comments yet. Leave one — AI can act on it later.")}</p>`;
  // UX-U3（评论闭环缺口）：产品到处承诺「评论生成草稿」，但从没有写评论的入口。补 composer：
  // 发一条评论（pending_llm）→ 列表里出现 →「生成草稿」按既有链路让 AI 接手。
  const commentComposer = currentProjectId
    ? `<form class="wh-r4-approval-comment-form" data-r9-drive-comment-form="${escapeHtml(currentProjectId)}">
        <textarea class="wh-r4-approval-comment-input" data-r9-drive-comment-input rows="2" maxlength="4000" placeholder="${escapeHtml(locale === "zh-CN" ? "对这个项目的文件说点什么，比如「第二节数据要更新」…" : "Say something about these files, e.g. update the data in section 2…")}"></textarea>
        <button type="submit" class="wh-btn" data-r9-drive-comment-submit="true">${escapeHtml(locale === "zh-CN" ? "发评论" : "Comment")}</button>
      </form>`
    : "";
  const recycleRows = vm.deleted_items.length
    ? vm.deleted_items.map((item) => `<div class="wh-r4-route-row" data-r5-drive-recycle-item="${escapeHtml(item.id)}" data-r5-drive-recycle-selected="${escapeHtml(String(item.id === selectedDeletedItem?.id))}">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <p>${escapeHtml(item.path)}</p>
      </div>
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(driveItemKindLabel(item.kind, locale === "zh-CN"))}</span>
        ${item.deleted_at ? `<span class="wh-pill">${escapeHtml(item.deleted_at.slice(0, 10))}</span>` : ""}
        ${item.restore_href ? `<a class="wh-btn" href="${escapeHtml(safeHref(item.restore_href))}" data-action-id="drive_restore_item" data-method="POST" data-r5-drive-recycle-restore="${escapeHtml(item.id)}">${escapeHtml(routeT(locale, "drive.restore"))}</a>` : ""}
      </div>
    </div>`).join("")
    : "";
  const hiddenRecycleCount = Math.max(0, vm.summary.deleted_item_count - vm.deleted_items.length);
  const recycleMoreNote = hiddenRecycleCount > 0
    ? `<p class="wh-subtle" data-r9-drive-recycle-hidden-count="${escapeHtml(String(hiddenRecycleCount))}" data-r9-drive-recycle-loaded-count="${escapeHtml(String(vm.deleted_items.length))}">${escapeHtml(locale === "zh-CN" ? `本页先显示 ${vm.deleted_items.length} 项；还有 ${hiddenRecycleCount} 项未加载。请通过对应文件链接打开后还原。` : `Showing ${vm.deleted_items.length} recycle-bin items on this page; ${hiddenRecycleCount} more are not loaded. Open the specific file link to restore one that is not shown here.`)}</p>`
    : "";
  const recycleEmpty = vm.deleted_items.length || hiddenRecycleCount > 0
    ? ""
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "drive.emptyRecycle"))}</p>`;
  const operationRows = vm.operations.length
    ? vm.operations.slice(0, 6).map((operation) => `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r5-drive-operation="${escapeHtml(operation.id)}" data-r5-drive-operation-type="${escapeHtml(operation.op_type)}">
      <div>
        <strong>${escapeHtml(operation.summary_text)}</strong>
        <p>${escapeHtml(operation.created_at.slice(0, 10))}</p>
      </div>
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(driveOpTypeLabel(operation.op_type, locale === "zh-CN"))}</span>
        ${operation.target_path ? `<span class="wh-pill">${escapeHtml(operation.target_path)}</span>` : ""}
      </div>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "drive.emptyOperations"))}</p>`;
  const primaryHrefs = uniqueStrings([
    vm.actions.upload_file?.href,
    vm.actions.delete_item?.href,
    ...vm.items.flatMap((item) => [
      item.preview_href,
      item.download_href,
      item.delete_href
    ]),
    ...vm.accepted_deliverables.flatMap((accepted) => [
      accepted.preview_href,
      accepted.download_href,
      accepted.restore_href
    ]),
    ...vm.deleted_items.map((item) => item.restore_href),
    ...vm.comments.map((comment) => comment.draft_action?.href),
    ...vm.comments.map((comment) => comment.draft_href),
    ...vm.comments.map((comment) => comment.proposal_href)
  ].filter((value): value is string => Boolean(value)));

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
          <h1>${escapeHtml(projectTitle)}</h1>
          <p>${escapeHtml(selectedItem?.path ?? routeT(locale, vm.items.length === 0 ? "drive.emptyFiles" : "drive.selectFile"))}</p>
          ${requestedMissingNotice}
          ${driveManageActions ? `<div class="wh-r4-route-actions" data-r5-drive-manage-actions="true">${driveManageActions}</div>` : ""}
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(vm.summary.file_count))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-drive-files="true" data-r4-drive-folder-count="${escapeHtml(String(driveFolderCount))}" data-r4-drive-listed-file-count="${escapeHtml(String(driveListedFileCount))}">
          <h3>${escapeHtml(driveFilesHeading)}</h3>
          <div class="wh-r4-route-timeline">${fileRows}</div>
          ${driveMoreFilesNote}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-drive-versions="true">
          <h3>${escapeHtml(driveVersionsHeading)}</h3>
          <div class="wh-r4-route-timeline">${versionRows}</div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-r4-route-stack" data-r4-drive-accepted="true">
          ${acceptedRows}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-drive-comments="true">
          <h3>${escapeHtml(routeT(locale, "drive.comments"))}</h3>
          <div class="wh-r4-route-timeline">${commentRows}
          ${commentComposer}</div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r5-drive-recycle="true">
          <h3>${escapeHtml(routeT(locale, "drive.recycle"))}</h3>
          <div class="wh-r4-route-timeline">${recycleRows}${recycleEmpty}</div>
          ${recycleMoreNote}
        </section>
        <section class="wh-card wh-r4-route-card" data-r5-drive-operations="true">
          <h3>${escapeHtml(routeT(locale, "drive.operations"))}</h3>
          <div class="wh-r4-route-timeline">${operationRows}</div>
        </section>
      </div>
    </section>`
  });
}

// L27：转写/纪要为空时不能再共用「这个项目还没有会议洞察」——那是讲洞察、不是讲转写，且会议只是还在
// 处理(processing)/处理失败(failed)时这句是错的。按会议状态给出贴合的占位，让用户分得清「还在生成 / 生成失败 / 真的没有」。
function meetingContentFallback(kind: "transcript" | "minutes", status: string | undefined, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  const noun = kind === "transcript" ? (zh ? "转写" : "Transcript") : (zh ? "纪要" : "Minutes");
  if (status === "processing") {
    return zh ? `${noun}还在准备中，稍后回来查看。` : `${noun} is still being prepared — check back shortly.`;
  }
  if (status === "failed") {
    return zh ? `${noun}没有生成成功。` : `${noun} could not be generated.`;
  }
  return zh ? `这次会议还没有${noun}内容。` : `This meeting has no ${kind} yet.`;
}

function renderMeetingRouteComponent(vm: MeetingPageVM, locale: WorkHubLocale): WebRouteComponent {
  const projectTitle = vm.project?.name ?? (locale === "zh-CN" ? "会议洞察" : "Meeting insights");
  const selectedMeeting = vm.meetings.find((meeting) => meeting.id === vm.selected_meeting_id) ?? vm.meetings[0];
  const meetingRows = vm.meetings.length
    ? vm.meetings.slice(0, 10).map((meeting) => `<a class="wh-r4-route-row" href="/meetings?project_id=${escapeHtml(meeting.project_id)}&m=${escapeHtml(meeting.id)}" data-r5-meeting-id="${escapeHtml(meeting.id)}" data-r5-meeting-status="${escapeHtml(meeting.status)}" data-r5-meeting-selected="${escapeHtml(String(meeting.id === selectedMeeting?.id))}">
      <div>
        <strong>${escapeHtml(meeting.title)}</strong>
        <p>${escapeHtml(`${formatApprovalTimestamp(meeting.created_at)} · ${meeting.uploaded_by_label}`)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(meetingRecordStatusLabel(meeting.status, locale))}</span>
    </a>`).join("")
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "meeting.empty"))}</p>`;
  const transcript = selectedMeeting?.transcript_text?.trim() || meetingContentFallback("transcript", selectedMeeting?.status, locale);
  const minutes = selectedMeeting?.minutes_md?.trim() || meetingContentFallback("minutes", selectedMeeting?.status, locale);
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
          <h1>${escapeHtml(projectTitle)}</h1>
          <p>${escapeHtml(selectedMeeting?.title ?? routeT(locale, "meeting.empty"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(vm.summary.pending_insight_count))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r5-meeting-list="true">
          <h3>${escapeHtml(routeT(locale, "meeting.kicker"))}</h3>
          <div class="wh-r4-route-timeline">${meetingRows}</div>
        </section>
        ${selectedMeeting ? `<aside class="wh-r4-route-stack" data-r5-meeting-insight-panel="true">
          <section class="wh-card wh-r4-route-card">
            <h3>${escapeHtml(routeT(locale, "meeting.insights"))}</h3>
            <div class="wh-r4-route-stack">${insightRows}</div>
            <p>${escapeHtml(routeT(locale, "meeting.approvalSafe"))}</p>
          </section>
        </aside>` : ""}
      </div>
      ${selectedMeeting ? `<div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r5-meeting-transcript="true">
          <h3>${escapeHtml(routeT(locale, "meeting.transcript"))}</h3>
          <pre class="wh-r5-meeting-text">${escapeHtml(transcript)}</pre>
        </section>
        <section class="wh-card wh-r4-route-card" data-r5-meeting-minutes="true">
          <h3>${escapeHtml(routeT(locale, "meeting.minutes"))}</h3>
          <pre class="wh-r5-meeting-text">${escapeHtml(minutes)}</pre>
        </section>
      </div>` : `<div class="wh-r4-route-grid"><article class="wh-card wh-r4-route-card" data-r5-meeting-empty="true"><h3>${escapeHtml(routeT(locale, "meeting.empty"))}</h3><p class="wh-subtle">${escapeHtml(vm.can_manage ? (locale === "zh-CN" ? "会议录音或转写接入后，Cuu 会自动整理出纪要和待办洞察，并显示在这里。" : "Once a meeting recording or transcript is brought in, Cuu drafts the minutes and action insights here.") : (locale === "zh-CN" ? "团队的会议接入后，这里会出现转写、纪要和洞察。" : "Once a team meeting is brought in, its transcript, minutes and insights show up here."))}</p></article></div>`}
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
  // F3：剩下的 system 来源,其 label 是原始点分类型串(如 system.notice / agent_run.succeeded),过一遍
  // 本地化器给用户看友好名,而不是机器枚举。notificationTypeLabel 对未知串也有前缀/humanize 兜底。
  return notificationTypeLabel(source.label, locale === "zh-CN");
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
        <p>${escapeHtml(formatApprovalTimestamp(item.created_at))}</p>
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
          <h1>${escapeHtml(routeT(locale, "notifications.kicker"))}</h1>
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
          <h1>${escapeHtml(routeT(locale, "health.title"))}</h1>
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
  // 时间药丸：全天 → 「全天」；否则把 ISO 时间戳格式化成「YYYY-MM-DD HH:MM」(之前直接渲染裸 ISO)。
  const timePill = block.all_day
    ? routeT(locale, "calendar.allDay")
    : [formatApprovalTimestamp(block.starts_at), formatApprovalTimestamp(block.ends_at)].filter(Boolean).join(" – ");
  return `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r5-calendar-block="${escapeHtml(block.id)}" data-r5-calendar-block-kind="${escapeHtml(block.kind)}" data-r5-calendar-block-status="${escapeHtml(block.status)}" data-r5-calendar-block-severity="${escapeHtml(block.severity)}">
    <div>
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(scheduleKindLabel(block.kind, locale))}</span>
        <span class="wh-pill">${escapeHtml(scheduleStatusLabel(block.status, locale))}</span>
        ${timePill ? `<span class="wh-pill">${escapeHtml(timePill)}</span>` : ""}
      </div>
      <strong>${escapeHtml(block.title)}</strong>
      ${block.description ? `<p>${escapeHtml(block.description)}</p>` : ""}
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
          <h1>${escapeHtml(routeT(locale, "calendar.kicker"))}</h1>
          <p>${escapeHtml(`${routeT(locale, "calendar.week")} · ${vm.scope.range_start.slice(0, 10)} - ${vm.scope.range_end.slice(0, 10)}`)}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(vm.summary.block_count))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r5-calendar-upcoming="true">
          <h3>${escapeHtml(routeT(locale, "calendar.upcoming"))}</h3>
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
  return uiFormatCny(value);
}

function renderBudgetRows(vm: CostDashboardVM, locale: WorkHubLocale) {
  if (vm.budget.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "cost.statusFallback"))}</p>`;
  }
  return vm.budget.slice(0, 5).map((usage, index) => {
    if (usage.enabled === false) {
      return `<div class="wh-r4-route-row" data-r4-cost-budget-row="${escapeHtml(String(index))}" data-r4-cost-budget-status="${escapeHtml(usage.status)}" data-r4-cost-budget-enabled="false">
      <div>
        <strong>${escapeHtml(usage.scope_label)}</strong>
        <p>${escapeHtml(locale === "zh-CN" ? "预算未启用" : "Budget not enabled")}</p>
      </div>
      <span class="wh-pill">${escapeHtml(locale === "zh-CN" ? "未启用" : "Not enabled")}</span>
    </div>`;
    }
    const ratio = usage.max_tokens > 0 ? Math.round((usage.total_tokens / usage.max_tokens) * 100) : 0;
    return `<div class="wh-r4-route-row" data-r4-cost-budget-row="${escapeHtml(String(index))}" data-r4-cost-budget-status="${escapeHtml(usage.status)}" data-r4-cost-budget-enabled="true">
      <div>
        <strong>${escapeHtml(usage.scope_label)}</strong>
        <p>${escapeHtml(`${usage.total_tokens}/${usage.max_tokens} tokens · ${costAmount(usage.estimated_cost_cny)}/${costAmount(usage.max_cost_cny)}`)}</p>
        <div class="wh-r4-route-meter" aria-hidden="true"><span style="width:${escapeHtml(String(Math.min(100, ratio)))}%"></span></div>
      </div>
      <span class="wh-pill">${escapeHtml(budgetStatusLabel(locale, usage.status))}</span>
    </div>`;
  }).join("");
}

function agentDashboardStatusLabel(locale: WorkHubLocale, status: string) {
  const labels: Record<string, Record<WorkHubLocale, string>> = {
    pending: { "zh-CN": "待开始", "en-US": "Waiting" },
    dispatched: { "zh-CN": "进行中", "en-US": "In progress" },
    succeeded: { "zh-CN": "已成功", "en-US": "Succeeded" },
    failed: { "zh-CN": "失败", "en-US": "Failed" },
    skipped: { "zh-CN": "已跳过", "en-US": "Skipped" },
    needs_human: { "zh-CN": "需要你判断", "en-US": "Needs review" }
  };
  return labels[status]?.[locale] ?? taskPlanItemStatusLabel(locale, status);
}

function pctWidth(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return String(Math.max(0, Math.min(100, Math.round(value ?? 0))));
}

function renderAgentArmyRouteComponent(vm: AgentArmyDashboardVM, locale: WorkHubLocale): WebRouteComponent {
  const kpis = [
    { id: "active_team_count", label: routeT(locale, "agents.active"), value: String(vm.kpis.active_team_count) },
    { id: "waiting_decision", label: routeT(locale, "agents.waiting"), value: String(vm.kpis.waiting_decision_count), href: "/" },
    // UX-M11：今日成本口径=当前可见的活跃军团账目，不是全组织今日总账——标签说清楚，不冒充。
    { id: "today_cost", label: routeT(locale, "agents.todayCost"), value: costAmount(vm.kpis.today_cost_cny), note: locale === "zh-CN" ? "仅含当前可见军团" : "Visible teams only" },
    // 普通用户审查：「自治率」没人看得懂——注明口径（当日 AI 判官复核通过率，无审阅回退 run 成功率）。
    { id: "autonomy_rate", label: routeT(locale, "agents.autonomy"), value: `${vm.kpis.autonomy_rate_pct}%`, note: locale === "zh-CN" ? "今日 AI 复核通过率" : "Today's AI review pass rate" }
  ].map((item: { id: string; label: string; value: string; href?: string; note?: string }) => {
    const body = `<strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.label)}</span>${item.note ? `<span class="wh-subtle" data-r9-agent-kpi-note="true">${escapeHtml(item.note)}</span>` : ""}`;
    return item.href
      ? `<a class="wh-card wh-r4-route-card" data-r9-agent-kpi="${escapeHtml(item.id)}" href="${escapeHtml(safeHref(item.href))}">${body}</a>`
      : `<section class="wh-card wh-r4-route-card" data-r9-agent-kpi="${escapeHtml(item.id)}">${body}</section>`;
  }).join("");
  const sourceWarnings = vm.source_warnings ?? [];
  const warningStrip = sourceWarnings.length
    ? `<section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r9-agent-source-warnings="${escapeHtml(String(sourceWarnings.length))}">
        <h3>${escapeHtml(locale === "zh-CN" ? "决策数据未完全加载" : "Decision data is partially loaded")}</h3>
        <div class="wh-r4-route-timeline">${sourceWarnings.map((warning) => `<p class="wh-subtle" data-r9-agent-source-warning="${escapeHtml(warning.source)}">${escapeHtml(warning.message)}</p>`).join("")}</div>
      </section>`
    : "";
  const capMessages = [
    vm.page_info.plans_capped
      ? routeT(locale, "agents.capPlans").replace("{limit}", String(vm.page_info.plan_limit))
      : "",
    vm.page_info.items_capped || vm.page_info.runs_capped || vm.page_info.escalations_capped
      ? routeT(locale, "agents.capRows")
      : ""
  ].filter(Boolean);
  const capWarning = capMessages.length
    ? `<section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r9-agent-dashboard-cap-warning="true">
        <div class="wh-r4-route-timeline">${capMessages.map((message) => `<p class="wh-subtle">${escapeHtml(message)}</p>`).join("")}</div>
      </section>`
    : "";

  const planCards = vm.plans.map((plan) => {
    const roles = plan.roles.map((role) => `<span class="wh-pill">${escapeHtml(`${taskPlanItemRoleLabel(locale, role.role)} ${role.count}`)}</span>`).join("");
    const statuses = plan.statuses.map((status) => `<span class="wh-pill">${escapeHtml(`${agentDashboardStatusLabel(locale, status.status)} ${status.count}`)}</span>`).join("");
    const burn = plan.cost.burn_pct ?? 0;
    const objective = plan.objective_title
      ? `<p class="wh-subtle" data-r9-agent-plan-objective="${escapeHtml(plan.objective_id ?? plan.plan_id)}">${escapeHtml(`${routeT(locale, "agents.objective")} · ${plan.objective_title}${plan.objective_progress_pct !== undefined ? ` · ${plan.objective_progress_pct}%` : ""}`)}</p>`
      : "";
    const budgetLink = plan.budget_href
      ? `<a class="wh-pill" data-r9-agent-plan-budget-link="${escapeHtml(plan.plan_id)}" href="${escapeHtml(safeHref(plan.budget_href))}">${escapeHtml(routeT(locale, "agents.costDetails"))}</a>`
      : "";
    const blocker = plan.oldest_blocker
      ? `<p class="wh-subtle" data-r9-agent-plan-blocker="true">${escapeHtml(plan.oldest_blocker.label)}</p>`
      : "";
    // 新鲜度：最近活动相对时间——「刚在动」还是「卡了三天」一眼分清。
    const freshness = plan.last_activity_at
      ? (() => {
        const ageMs = Date.now() - Date.parse(plan.last_activity_at);
        const minutes = Math.max(1, Math.floor(ageMs / 60000));
        const label = minutes < 60
          ? (locale === "zh-CN" ? `${minutes} 分钟前有动静` : `active ${minutes}m ago`)
          : minutes < 60 * 24
            ? (locale === "zh-CN" ? `${Math.floor(minutes / 60)} 小时前有动静` : `active ${Math.floor(minutes / 60)}h ago`)
            : (locale === "zh-CN" ? `${Math.floor(minutes / 1440)} 天没动静了` : `no activity for ${Math.floor(minutes / 1440)}d`);
        return `<span class="wh-subtle" data-r9-agent-plan-freshness="true">${escapeHtml(label)}</span>`;
      })()
      : "";
    return `<section class="wh-card wh-r4-route-card" data-r9-agent-plan-card="${escapeHtml(plan.plan_id)}">
      <div class="wh-r4-route-row">
        <div>
          <a href="${escapeHtml(safeHref(plan.work_item_href))}"><strong>${escapeHtml(plan.work_item_title)}</strong></a>
          <p>${escapeHtml(`${plan.work_item_code} · ${taskPlanStatusLabel(locale, plan.status)}`)}</p>
          ${objective}
        </div>
        <span class="wh-pill">${escapeHtml(plan.progress.label)}</span>
      </div>
      <div class="wh-r4-route-meter" data-r9-agent-team-burn="${escapeHtml(burn > 100 ? "danger" : burn >= 70 ? "warning" : "ok")}" aria-hidden="true"><span style="width:${escapeHtml(pctWidth(burn))}%"></span></div>
      <div class="wh-r4-route-meta" data-r9-agent-plan-roles="true">${roles}</div>
      <div class="wh-r4-route-meta" data-r9-agent-plan-statuses="true">${statuses}</div>
      <div class="wh-r4-route-meta">
        <span class="wh-subtle">${escapeHtml(`${routeT(locale, "agents.cost")}: ${costAmount(plan.cost.used_cny)}${plan.cost.budget_cny ? `/${costAmount(plan.cost.budget_cny)}` : ""} · ${routeT(locale, "agents.judge")}: ${plan.judge.pass_rate_pct}%`)}</span>
        ${freshness}
        ${budgetLink}
      </div>
      ${blocker}
    </section>`;
  }).join("");

  const empty = vm.empty_state === "no_agent_armies"
    ? `<section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r9-agent-dashboard-empty="no_agent_armies">
        <p>${escapeHtml(routeT(locale, "agents.empty"))}</p>
        <div class="wh-r4-route-actions"><a class="wh-btn wh-btn-primary" href="/intake">${escapeHtml(routeT(locale, "agents.start"))}</a></div>
      </section>`
    : "";
  const recent = vm.recent_escalations.length
    ? vm.recent_escalations.map((item) => `<div class="wh-r4-route-row" data-r9-agent-recent-item="${escapeHtml(item.id)}">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.reason_preview)}</p>
      </div>
      <a class="wh-pill" href="${escapeHtml(safeHref(item.href))}">${escapeHtml(routeT(locale, "agents.waiting"))}</a>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(routeT(locale, "agents.noRecent"))}</p>`;

  return createWebRouteComponent({
    key: "agents",
    css: webRouteComponentCss,
    primaryHrefs: [
      "/",
      ...vm.plans.map((plan) => plan.work_item_href),
      ...vm.plans.map((plan) => plan.budget_href).filter((href): href is string => Boolean(href)),
      ...vm.recent_escalations.map((item) => item.href)
    ],
    source: "page-vm",
    locale,
    pageVm: "agents",
    html: `<section class="wh-r4-route" data-r4-route-component="agents" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r9-agent-dashboard="true" data-r9-agent-dashboard-mobile="single-column" data-r9-agent-dashboard-plan-count="${escapeHtml(String(vm.plans.length))}" data-r9-agent-dashboard-recent-count="${escapeHtml(String(vm.recent_escalations.length))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "agents.kicker"))}</span>
          <h1>${escapeHtml(routeT(locale, "agents.title"))}</h1>
          <p>${escapeHtml(routeT(locale, "agents.summary"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(vm.kpis.active_team_count))}</span>
      </header>
      <div class="wh-r4-route-grid" data-r9-agent-dashboard-kpis="true">${kpis}</div>
      ${warningStrip}
      ${capWarning}
      ${empty}
      <div class="wh-r4-route-grid">
        <section class="wh-r4-route-card" data-r9-agent-dashboard-plans="true">
          <h3>${escapeHtml(routeT(locale, "agents.plans"))}</h3>
          <div class="wh-r4-route-grid">${planCards}</div>
        </section>
        <details class="wh-card wh-r4-route-card" data-r9-agent-recent-activity="accordion" open>
          <summary>${escapeHtml(routeT(locale, "agents.recent"))}</summary>
          <div class="wh-r4-route-timeline">${recent}</div>
        </details>
      </div>
    </section>`
  });
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
            ? `<span class="wh-pill">${escapeHtml(`${routeT(locale, "skills.readiness")} ${Math.round(skill.confidence_score * 100)}%`)}</span>`
            : "",
          skill.provenance
            ? `<span class="wh-pill wh-pill--accent" data-r8-skill-refined="true" data-r8-skill-refined-ops="${escapeHtml(String(skill.provenance.op_count))}">${escapeHtml(`${routeT(locale, "skills.refinedFrom")}${skill.provenance.refined_from_version} · ${locale === "zh-CN" ? `改了 ${skill.provenance.op_count} 处` : `${skill.provenance.op_count} ${skill.provenance.op_count === 1 ? "edit" : "edits"}`}`)}</span>`
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
          <h1>${escapeHtml(routeT(locale, "skills.title"))}</h1>
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
      // L2：更新时间是每个项目都该有的元信息——以前它只在「没有描述」时顶替描述出现，
      // 有描述的项目就再也看不到更新时间，列表元信息前后不一致。改为始终作为一枚 pill 渲染。
      const descriptionLine = project.description
        ? `<p>${escapeHtml(project.description)}</p>`
        : "";
      const updatedLabel = `${routeT(locale, "projects.updated")} ${project.updated_at.slice(0, 10)}`;
      const projectHref = `/projects/${encodeURIComponent(project.id)}`;
      return `<div class="wh-r4-route-row" data-r8-project="${escapeHtml(project.id)}" data-r8-project-slug="${escapeHtml(project.slug)}" data-r8-project-archived="${escapeHtml(String(project.archived))}" data-r8-project-open-items="${escapeHtml(String(project.open_work_item_count))}">
      <div>
        <strong><a class="wh-r4-route-row-title" href="${escapeHtml(safeHref(projectHref))}">${escapeHtml(project.name)}</a></strong>
        ${descriptionLine}
        <div class="wh-r4-route-meta">
          <span class="wh-pill">${escapeHtml(`${routeT(locale, "projects.owner")} · ${project.owner_nickname}`)}</span>
          <span class="wh-pill">${escapeHtml(openLabel)}</span>
          <span class="wh-pill" data-r8-project-updated="true">${escapeHtml(updatedLabel)}</span>
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
          <h1>${escapeHtml(routeT(locale, "projects.title"))}</h1>
          <p>${escapeHtml(routeT(locale, "projects.summary"))}</p>
        </div>
        <form class="wh-r4-project-create" data-r8-project-create-form="true">
          <input type="text" data-r8-project-name-input="true" name="project_name" autocomplete="off" maxlength="128" placeholder="${escapeHtml(routeT(locale, "projects.namePlaceholder"))}" aria-label="${escapeHtml(routeT(locale, "projects.new"))}" />
          <a class="wh-btn wh-btn-primary" href="/api/projects/bootstrap" role="button" data-action-id="create_named_project" data-method="POST" data-r8-project-new="true" data-r8-project-create="true">${escapeHtml(routeT(locale, "projects.create"))}</a>
        </form>
      </header>
      <section class="wh-card wh-r4-route-card" data-r8-projects-list="true">
        <div class="wh-r4-route-timeline">${rows}</div>
      </section>
    </section>`
  });
}

function renderProjectHomeRouteComponent(vm: ProjectHomePageVM, locale: WorkHubLocale): WebRouteComponent {
  // GitHub 式项目主页：项目头（名称 + 描述 + 负责人 + 状态 + 进行中计数）+ 入口动作（新任务 / 打开网盘）
  // + 进行中工作清单（每条链到 /workitems/:id，带状态/优先级徽标）+ 空态。动作 href/label 取自服务端 VM（已本地化）。
  const zh = locale === "zh-CN";
  const project = vm.project;
  const archivedPill = project.status === "archived"
    ? `<span class="wh-pill" data-r8-project-home-archived="true">${escapeHtml(routeT(locale, "projects.archived"))}</span>`
    : "";
  const descriptionLine = project.description
    ? `<p>${escapeHtml(project.description)}</p>`
    : "";
  // M5：头部进行中数对齐 /projects 列表卡的全量口径(total_open_work_item_count)。当存在因可见性隐藏的
  // 他人私有态事项时(total > 可见数),显示「进行中 8 · 你可处理 3」,既不和列表卡的 8 打架,又诚实标出
  // 用户实际能处理的 3。旧 fixture 不带 total 时回落为只显可见数(与原行为一致)。
  const viewableOpen = vm.summary.open_work_item_count;
  const totalOpen = vm.summary.total_open_work_item_count ?? viewableOpen;
  const openCountLabel = totalOpen > viewableOpen
    ? `${routeT(locale, "projects.openItems")} ${totalOpen} · ${zh ? "你可处理" : "you can handle"} ${viewableOpen}`
    : `${routeT(locale, "projects.openItems")} ${totalOpen}`;
  // 隐藏量拆成两类：total > viewable 是权限/职责范围过滤，viewable > 本页 rows 是主页摘要折叠。
  // 旧文案让用户「进入项目查看全部」，但当前页面已经是项目主页，不能指向不存在的隐藏工作项入口。
  const shownOpen = vm.open_work_items.length;
  const filteredHiddenCount = Math.max(0, totalOpen - viewableOpen);
  const collapsedOpenCount = Math.max(0, viewableOpen - shownOpen);
  const hiddenCount = filteredHiddenCount + collapsedOpenCount;
  const moreNoteCopy = hiddenCount > 0
    ? (() => {
      const parts: string[] = [];
      if (viewableOpen > 0) {
        parts.push(zh
          ? `项目主页摘要展示你可处理的 ${shownOpen} / ${viewableOpen} 条进行中工作`
          : `Project home shows ${shownOpen} of ${viewableOpen} open items you can handle`);
      } else {
        parts.push(zh ? "本页没有可处理的进行中工作" : "No open items are currently in your handleable list");
      }
      if (collapsedOpenCount > 0) {
        parts.push(zh
          ? `其余 ${collapsedOpenCount} 条不会在此页展开`
          : `${collapsedOpenCount} ${collapsedOpenCount === 1 ? "is" : "are"} not expanded on this page`);
      }
      if (filteredHiddenCount > 0) {
        parts.push(zh
          ? `另有 ${filteredHiddenCount} 条因权限或职责范围未显示`
          : `${filteredHiddenCount} more ${filteredHiddenCount === 1 ? "is" : "are"} outside your permissions or assignment scope`);
      }
      return `${parts.join(zh ? "；" : "; ")}${zh ? "。" : "."}`;
    })()
    : "";
  const moreNote = hiddenCount > 0
    ? `<p class="wh-subtle" data-r8-project-home-more="${escapeHtml(String(hiddenCount))}" data-r8-project-home-filtered="${escapeHtml(String(filteredHiddenCount))}" data-r8-project-home-collapsed="${escapeHtml(String(collapsedOpenCount))}">${escapeHtml(moreNoteCopy)}</p>`
    : "";
  const fileCountLabel = `${routeT(locale, "projectHome.files")} ${vm.drive.file_count}`;
  // L4：文件标题用的是总文件数(file_count)，列表只显示最近若干条；以前没有「还有 N 个未显示」的提示，
  // 让人以为列表就是全部。仿照上方进行中工作清单的 moreNote 补一条溢出说明。
  const hiddenFiles = vm.drive.file_count - vm.drive.recent_files.length;
  const filesMoreNote = hiddenFiles > 0
    ? `<p class="wh-subtle" data-r8-project-home-files-more="${escapeHtml(String(hiddenFiles))}">${escapeHtml(zh ? `还有 ${hiddenFiles} 个文件未显示，前往网盘查看全部。` : `+${hiddenFiles} more files not shown — open the drive to see all.`)}</p>`
    : "";
  const fileRows = vm.drive.recent_files.length
    ? vm.drive.recent_files.map((file) => `<a class="wh-r4-route-row" href="${escapeHtml(safeHref(file.href))}" data-r8-project-home-file="${escapeHtml(file.id)}">
      <div><strong>${escapeHtml(file.name)}</strong></div>
      <div class="wh-r4-route-meta">
        <span class="wh-pill">${escapeHtml(file.updated_at.slice(0, 10))}</span>
        <span class="wh-pill">${escapeHtml(zh ? "在网盘中查看" : "View in drive")}</span>
      </div>
    </a>`).join("")
    : `<p class="wh-subtle" data-r8-project-home-no-files="true">${escapeHtml(routeT(locale, "projectHome.noFiles"))}</p>`;
  const rows = vm.open_work_items.length
    ? vm.open_work_items.map((item) => `<a class="wh-r4-route-row" href="${escapeHtml(safeHref(item.href))}" data-r8-project-home-item="${escapeHtml(item.id)}" data-r8-project-home-item-code="${escapeHtml(item.code)}">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <div class="wh-r4-route-meta">
          <span class="wh-pill">${escapeHtml(item.code)}</span>
          <span class="wh-pill" data-tone="${escapeHtml(item.status)}">${escapeHtml(workItemStatusLabel(locale, item.status))}</span>
          <span class="wh-pill">${escapeHtml(attentionPriorityLabel(item.priority, zh))}</span>
          ${item.army ? `<span class="wh-pill" data-r9-project-army-pill="${escapeHtml(item.id)}">${escapeHtml(zh ? `军团 ${item.army.done}/${item.army.total}` : `Army ${item.army.done}/${item.army.total}`)}</span>` : ""}
        </div>
      </div>
    </a>`).join("")
    : `<p class="wh-subtle" data-r8-project-home-empty="true">${escapeHtml(routeT(locale, "projectHome.empty"))}</p>`;
  return createWebRouteComponent({
    key: "project-home",
    css: webRouteComponentCss,
    primaryHrefs: [vm.actions.new_task.href, vm.actions.open_drive.href],
    source: "page-vm",
    locale,
    pageVm: "project-home",
    html: `<section class="wh-r4-route" data-r4-route-component="project-home" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r8-project-home="${escapeHtml(project.id)}" data-r8-project-home-slug="${escapeHtml(project.slug)}" data-r8-project-home-status="${escapeHtml(project.status)}" data-r8-project-home-open-count="${escapeHtml(String(vm.summary.open_work_item_count))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "projectHome.kicker"))}</span>
          <h1>${escapeHtml(project.name)}</h1>
          ${descriptionLine}
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(`${routeT(locale, "projects.owner")} · ${project.owner_label}`)}</span>
            <span class="wh-pill">${escapeHtml(openCountLabel)}</span>
            ${archivedPill}
          </div>
        </div>
        <div class="wh-r4-route-actions">
          <a class="wh-btn wh-btn-primary" href="${escapeHtml(safeHref(vm.actions.new_task.href))}" data-action-id="${escapeHtml(vm.actions.new_task.id)}" data-method="${escapeHtml(vm.actions.new_task.method)}" data-r8-project-home-new-task="true">${escapeHtml(vm.actions.new_task.label)}</a>
          <a class="wh-btn" href="${escapeHtml(safeHref(vm.actions.open_drive.href))}" data-action-id="${escapeHtml(vm.actions.open_drive.id)}" data-method="${escapeHtml(vm.actions.open_drive.method)}" data-r8-project-home-open-drive="true">${escapeHtml(vm.actions.open_drive.label)}</a>
        </div>
      </header>
      <section class="wh-card wh-r4-route-card" data-r8-project-home-list="true">
        <h3>${escapeHtml(routeT(locale, "projectHome.openWork"))}</h3>
        <div class="wh-r4-route-table">${rows}</div>
        ${moreNote}
      </section>
      <section class="wh-card wh-r4-route-card" data-r8-project-home-files="${escapeHtml(String(vm.drive.file_count))}">
        <h3>${escapeHtml(fileCountLabel)}</h3>
        <div class="wh-r4-route-table">${fileRows}</div>
        ${filesMoreNote}
        <a class="wh-r4-route-kicker" href="${escapeHtml(safeHref(vm.actions.open_drive.href))}" data-r8-project-home-files-all="true">${escapeHtml(vm.actions.open_drive.label)} →</a>
      </section>
      <a class="wh-r4-route-kicker" href="/projects" data-r8-project-home-back="true">${escapeHtml(routeT(locale, "projectHome.back"))}</a>
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
      <span class="wh-pill">${escapeHtml(budgetStatusLabel(locale, risk.status))}</span>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "cost.statusFallback"))}</p>`;
  const zhNotice = locale === "zh-CN";
  const notices = vm.notices.length
    // M24：预算通知要把推荐动作(降级模型/暂停/联系管理员)当按钮渲出来,而不是只给一个跳回本页的自指链接;
    // 标题用本地化严重度,而不是裸 "warning"。
    ? vm.notices.map((notice) => {
      const options = notice.options ?? [];
      // INT-2：成本看板是聚合总览,这里的「降级模型/暂停/找管理员」是**建议**——真正能点的暂停/降级在具体工作项页与
      // Cuu 卡上(那里 action_href 指向 /api/workitems/:id/pause|downgrade);看板层没有可作用的单一目标。原来给它们
      // 配自指 href(/dashboard/cost)渲成按钮,点了只跳回本页=假动作。改成诚实的「可以这样应对」建议文字,不再撒谎。
      const optionButtons = options.length
        ? `<span class="wh-subtle">${escapeHtml(zhNotice ? "可以这样应对：" : "What you can do: ")}</span>${options.map((option) => `<span class="wh-pill" data-r4-cost-notice-option="${escapeHtml(option.id)}">${escapeHtml(option.label)}</span>`).join("")}`
        : "";
      const severityLabel = localizedEnumLabel(
        notice.severity,
        zhNotice,
        { info: "提示", warning: "提醒", critical: "严重" },
        { info: "Info", warning: "Warning", critical: "Critical" }
      );
      return `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r4-cost-notice="${escapeHtml(notice.code)}" data-r4-cost-notice-severity="${escapeHtml(notice.severity)}">
      <div>
        <strong>${escapeHtml(severityLabel)}</strong>
        <p>${escapeHtml(notice.message)}</p>
      </div>
      ${optionButtons ? `<div class="wh-r4-route-actions">${optionButtons}</div>` : ""}
    </div>`;
    }).join("")
    : "";
  const models = vm.model_breakdown.slice(0, 5)
    .map((item) => `<div class="wh-r4-route-row" data-r4-cost-model="${escapeHtml(`${item.provider}:${item.model}`)}">
      <div>
        <strong>${escapeHtml(item.model)}</strong>
        <p>${escapeHtml(`${item.provider} · ${item.count} ${locale === "zh-CN" ? "次调用" : item.count === 1 ? "call" : "calls"}`)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(costAmount(item.cost_cny))}</span>
    </div>`)
    .join("");
  // B-R9.6 §3.5（成本页军团分组）：by_task_plan 早在 VM 里（仅管理员非空），但前端从没渲过——
  // 军团跑掉的钱在成本页无处可看。UX-H4 补齐规格行结构：名称 + 燃烧条（<70 蓝/70-100 橙/超 红）
  // + 子运行数 + 状态；超限行红字 +「去处理」链到本页预算卡。
  const armyRows = vm.by_task_plan.slice(0, 8)
    .map((item) => {
      const burnPct = item.burn_pct;
      const burnTone = burnPct === undefined ? undefined : burnPct > 100 ? "danger" : burnPct >= 70 ? "warning" : "ok";
      const burnMeter = burnPct !== undefined
        ? `<div class="wh-r4-route-meter" data-r9-cost-army-burn="${escapeHtml(burnTone ?? "ok")}" aria-label="${escapeHtml(`${burnPct}%`)}"><span style="${escapeHtml(`width:${Math.min(Math.max(burnPct, 0), 100)}%`)}"></span></div>`
        : "";
      const overBudget = burnPct !== undefined && burnPct > 100
        ? `<p class="wh-pill-danger" data-r9-cost-army-over="${escapeHtml(item.task_plan_id)}">${escapeHtml(zhNotice
          ? `已超预算（${burnPct}%${item.budget_cny ? `，上限 ${costAmount(item.budget_cny)}` : ""}）`
          : `Over budget (${burnPct}%${item.budget_cny ? `, cap ${costAmount(item.budget_cny)}` : ""})`)} <a href="#wh-cost-budget" data-r9-cost-army-handle="true">${escapeHtml(zhNotice ? "去处理" : "Handle it")}</a></p>`
        : "";
      const statusPill = item.status
        ? `<span class="wh-pill" data-tone="${escapeHtml(item.status)}">${escapeHtml(taskPlanStatusLabel(locale, item.status as Parameters<typeof taskPlanStatusLabel>[1]))}</span>`
        : "";
      return `<div class="wh-r4-route-row wh-r4-route-row--stacked" data-r9-cost-army-plan="${escapeHtml(item.task_plan_id)}">
      <div>
        <strong>${escapeHtml(item.label ?? (zhNotice ? "军团任务计划" : "Task plan"))}</strong>
        <p>${escapeHtml(zhNotice
          ? `${item.child_runs} 个子运行 · ${item.task_plan_id.slice(0, 8)}`
          : `${item.child_runs} child ${item.child_runs === 1 ? "run" : "runs"} · ${item.task_plan_id.slice(0, 8)}`)}</p>
        ${burnMeter}
        ${overBudget}
      </div>
      <div class="wh-r4-route-meta">
        ${statusPill}
        <span class="wh-pill">${escapeHtml(costAmount(item.cost_cny))}</span>
      </div>
    </div>`;
    })
    .join("");
  // 静默截断=撒谎：超过 8 个计划时明说只显示最烧钱的前 8。
  const armyCapNote = vm.by_task_plan.length > 8
    ? `<p class="wh-subtle" data-r9-cost-army-capped="true">${escapeHtml(zhNotice
      ? `按花费只显示前 8 个军团（共 ${vm.by_task_plan.length} 个）。`
      : `Showing the 8 costliest teams of ${vm.by_task_plan.length}.`)}</p>`
    : "";
  const armyCard = vm.by_task_plan.length
    ? `<section class="wh-card wh-r4-route-card" data-r9-cost-army="true" data-r9-cost-army-count="${escapeHtml(String(vm.by_task_plan.length))}">
          <h3>${escapeHtml(zhNotice ? "军团花费" : "Agent team spend")}</h3>
          <p class="wh-subtle">${escapeHtml(zhNotice ? "按任务计划分组的 AI 军团开销。" : "AI team cost grouped by task plan.")}</p>
          <div class="wh-r4-route-timeline">${armyRows}</div>
          ${armyCapNote}
          <div class="wh-r4-route-actions"><a class="wh-btn" href="/dashboard/agents" data-r9-cost-army-cta="true">${escapeHtml(zhNotice ? "去指挥台看军团" : "Open the command deck")}</a></div>
        </section>`
    : "";
  // UX-M10（规格 §3.5 三维分组）：按人 / 按军团计划 / 按目标三个维度都要在成本页可达。
  // 静态渲染架构下做成并排卡（有数据才渲），不做假 tab。
  const byUserRows = vm.by_user.slice(0, 8)
    .map((item) => `<div class="wh-r4-route-row" data-r9-cost-user="${escapeHtml(item.user_id)}">
      <div><strong>${escapeHtml(item.label)}</strong></div>
      <span class="wh-pill">${escapeHtml(costAmount(item.cost_cny))}</span>
    </div>`)
    .join("");
  const byUserCard = vm.by_user.length
    ? `<section class="wh-card wh-r4-route-card" data-r9-cost-by-user="true">
          <h3>${escapeHtml(zhNotice ? "按人花费" : "Spend by person")}</h3>
          <div class="wh-r4-route-timeline">${byUserRows}</div>
        </section>`
    : "";
  const byObjectiveRows = vm.by_objective.slice(0, 8)
    .map((item) => `<div class="wh-r4-route-row" data-r9-cost-objective="${escapeHtml(item.objective_id)}">
      <div><strong>${escapeHtml(item.label ?? (zhNotice ? `目标 ${item.objective_id.slice(0, 8)}` : `Objective ${item.objective_id.slice(0, 8)}`))}</strong></div>
      <span class="wh-pill">${escapeHtml(costAmount(item.cost_cny))}</span>
    </div>`)
    .join("");
  const byObjectiveCard = vm.by_objective.length
    ? `<section class="wh-card wh-r4-route-card" data-r9-cost-by-objective="true">
          <h3>${escapeHtml(zhNotice ? "目标花费" : "Spend by objective")}</h3>
          <div class="wh-r4-route-timeline">${byObjectiveRows}</div>
        </section>`
    : "";
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
  // L32：没有任何用量时，整页会显示「本期用量 0 / 估算成本 ¥0 / 风险 ok」一片零——一无所知的用户分不清
  // 究竟是 AI 免费、还没跑过、还是成本统计坏了。loader 已设 empty_state(no_agent_runs/usage_not_connected)，
  // 这里据此显式给出可操作说明，而不是默默摆一堆 0。
  const emptyStateCard = vm.empty_state
    ? `<section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-cost-empty-state="${escapeHtml(vm.empty_state)}">
          <h3>${escapeHtml(vm.empty_state === "usage_not_connected"
            ? (zhNotice ? "用量统计还没接入" : "Usage tracking not connected")
            : (zhNotice ? "还没有 AI 用量记录" : "No AI usage yet"))}</h3>
          <p>${escapeHtml(vm.empty_state === "usage_not_connected"
            ? (zhNotice
              ? "下面的数字暂时都是 0，因为用量统计还没接好；接入后这里会显示真实成本。"
              : "The figures below read 0 because usage tracking isn't connected yet — real cost will appear once it is.")
            : (zhNotice
              ? "下面的数字暂时都是 0。派一个任务让 AI 跑一次，这里就会出现成本。"
              : "The figures below read 0 for now. Assign a task and let AI run once — cost will show up here."))}</p>
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
          <h1>${escapeHtml(goldPathT(locale, "cost.title"))}</h1>
          <p>${escapeHtml(goldPathT(locale, "cost.summary"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(costAmount(props.totalCostCny))}</span>
      </header>
      ${emptyStateCard}
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-cost-metrics="true">
          <h3>${escapeHtml(goldPathT(locale, "cost.estimatedTitle"))}</h3>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(`${goldPathT(locale, "cost.tokenTitle")}: ${props.totalTokens} ${locale === "zh-CN" ? "个 token" : "tokens"}`)}</span>
            <span class="wh-pill">${escapeHtml(goldPathT(locale, "cost.estimatedTitle"))}: ${escapeHtml(costAmount(props.totalCostCny))}</span>
            <span class="wh-pill" data-r4-cost-trend-days="${escapeHtml(String(props.trendCount))}">${escapeHtml(`${routeT(locale, "cost.trend")}: ${props.trendCount}`)}</span>
          </div>
          ${notices}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-cost-risks="true">
          <h3>${escapeHtml(routeT(locale, "cost.risks"))}</h3>
          <div class="wh-r4-route-timeline">${risks}</div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" id="wh-cost-budget" data-r4-cost-budget="true">
          <h3>${escapeHtml(routeT(locale, "cost.scopes"))}</h3>
          <div class="wh-r4-route-timeline">${renderBudgetRows(vm, locale)}</div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-cost-models="true">
          <h3>${escapeHtml(routeT(locale, "cost.models"))}</h3>
          <div class="wh-r4-route-timeline">${models || `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "cost.statusFallback"))}</p>`}</div>
        </section>
      </div>
      ${armyCard || laborSplitCard ? `<div class="wh-r4-route-grid">${armyCard}${laborSplitCard}</div>` : ""}
      ${byUserCard || byObjectiveCard ? `<div class="wh-r4-route-grid">${byUserCard}${byObjectiveCard}</div>` : ""}
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

function renderKnowledgeRouteComponent(vm: EvidenceBubble, locale: WorkHubLocale, sourceRef?: string, scopeLanding?: boolean): WebRouteComponent {
  const refs = vm.evidence_refs;
  // L34：非管理员、无项目/工作项范围时落到这张「检索需先锚定范围」的引导页。此时再摆一个全局搜索框只会
  // 让用户输入后再次 403 撞回同一页(死循环)。改为只给一条与引导文案一致的出路——去项目列表。
  const searchBlock = scopeLanding
    ? `<div class="wh-r4-route-actions" data-r4-knowledge-scope-landing="true"><a class="wh-btn wh-btn-primary" href="/projects" data-r4-knowledge-scope-cta="true">${escapeHtml(routeT(locale, "knowledge.scopeLandingCta"))}</a></div>`
    : `<form class="wh-r4-knowledge-search" method="get" action="/knowledge/search" role="search" data-r4-knowledge-search-form="true">
        <input type="search" name="q" value="${escapeHtml(vm.query_text ?? "")}" placeholder="${escapeHtml(routeT(locale, "knowledge.searchPlaceholder"))}" aria-label="${escapeHtml(routeT(locale, "knowledge.searchLabel"))}" autocomplete="off" />
        <button class="wh-btn wh-btn-primary" type="submit">${escapeHtml(routeT(locale, "knowledge.searchSubmit"))}</button>
      </form>`;
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
          <h1>${escapeHtml(routeT(locale, "knowledge.sources"))}</h1>
          <p>${escapeHtml(vm.summary_text)}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(refs.length))}</span>
      </header>
      ${searchBlock}
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
          <h1>${escapeHtml(goldPathT(locale, "settings.title"))}</h1>
          <p>${escapeHtml(goldPathT(locale, "settings.summary"))}</p>
        </div>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-settings-runtime="true">
          <h3>${escapeHtml(routeT(locale, "settings.runtime"))}</h3>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.runtimeStatus"))}</strong><span class="wh-pill">${escapeHtml(runtimeStatusLabel(props.runtimeStatus, locale))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.worker"))}</strong><span class="wh-pill">${escapeHtml(String(props.workerCount))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.broker"))}</strong><span class="wh-pill">${escapeHtml(boolLabel(props.brokerConfigured, locale))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.database"))}</strong><span class="wh-pill">${escapeHtml(boolLabel(props.databaseConfigured, locale))}</span></div>
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
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.preferenceSource"))}</strong><span class="wh-pill">${escapeHtml(preferenceSourceLabel(props.preferenceSource, locale === "zh-CN"))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.preferenceSync"))}</strong><span class="wh-pill">${escapeHtml(syncLabel(props.preferenceSynced, locale))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.supported"))}</strong><span class="wh-pill">${escapeHtml(props.supportedLocales.join(" / "))}</span></div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-settings-device="true">
          <h3>${escapeHtml(routeT(locale, "settings.device"))}</h3>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.localExecution"))}</strong><span class="wh-pill">${escapeHtml(yesNoLabel(locale, props.localExecutionBoundary))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.independentPet"))}</strong><span class="wh-pill">${escapeHtml(yesNoLabel(locale, props.independentPetWindow))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.petBoundary"))}</strong><span class="wh-pill">${escapeHtml(yesNoLabel(locale, !props.petModelSettingsInWeb))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.desktopGate"))}</strong><span class="wh-pill">${escapeHtml(yesNoLabel(locale, props.restoreRequiresDesktop))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.webLocalActions"))}</strong><span class="wh-pill">${escapeHtml(yesNoLabel(locale, props.webLocalActionsEnabled))}</span></div>
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
  | { key: "home"; attention: AttentionHomeVM; projects?: ProjectListVM | undefined }
  | { key: "projects"; projects: ProjectListVM }
  | { key: "project-home"; project: ProjectHomePageVM }
  | { key: "intake"; session: SessionVM }
  | { key: "intake"; start: true; project?: { id: string; name: string } | undefined; projectUnavailable?: boolean | undefined }
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
  | { key: "agents"; agents: AgentArmyDashboardVM }
  | { key: "knowledge"; evidence: EvidenceBubble; sourceRef?: string | undefined; scopeLanding?: boolean | undefined }
  | { key: "skills"; skills: TeamSkillsPageVM }
  | { key: "settings"; settings: SettingsPageVM };

export function renderWebRouteComponent(
  input: WebRouteComponentInput,
  options: RouteComponentOptions = {}
): WebRouteComponent {
  const locale = normalizeWorkHubLocale(options.locale);
  switch (input.key) {
    case "home":
      return renderHomeRouteComponent(input.attention, locale, input.projects);
    case "projects":
      return renderProjectsRouteComponent(input.projects, locale);
    case "project-home":
      return renderProjectHomeRouteComponent(input.project, locale);
    case "intake":
      if ("start" in input) {
        return renderIntakeStartRouteComponent(locale, input.project, input.projectUnavailable);
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
    case "agents":
      return renderAgentArmyRouteComponent(input.agents, locale);
    case "knowledge":
      return renderKnowledgeRouteComponent(input.evidence, locale, input.sourceRef, input.scopeLanding);
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
